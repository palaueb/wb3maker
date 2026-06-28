#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-audio-frame-gate-catalog-2026-06-25';
const reportId = 'audio-frame-gate-audit-2026-06-25';
const toolName = 'tools/world-audio-frame-gate-audit.mjs';

const ramCatalogId = 'world-audio-ram-state-catalog-2026-06-25';
const noteTimingCatalogId = 'world-audio-note-timing-support-catalog-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function fieldByName(ramCatalog, name) {
  return (ramCatalog.streamChannelStruct?.fields || []).find(field => field.name === name) || null;
}

function fieldRef(ramCatalog, name, relationship) {
  const field = fieldByName(ramCatalog, name);
  return {
    kind: 'stream_field',
    fieldName: name,
    offset: field?.offset ?? null,
    size: field?.size || 1,
    relationship,
    confidence: field?.confidence || 'medium',
  };
}

function buildCatalog(mapData) {
  const ramCatalog = requireCatalog(mapData, ramCatalogId);
  const noteTimingCatalog = requireCatalog(mapData, noteTimingCatalogId);
  const requiredFields = [
    'stream_flags',
    'note_delay_counter',
    'secondary_delay_counter',
    'current_stream_pointer',
  ];
  const missingFields = requiredFields.filter(name => !fieldByName(ramCatalog, name));
  const validationIssues = [];
  if (missingFields.length) validationIssues.push(`Missing stream field(s): ${missingFields.join(', ')}`);

  const gates = [
    {
      id: 'active_stream_flag_gate',
      order: 0,
      field: fieldRef(ramCatalog, 'stream_flags', 'bit 0 gates whether the channel interpreter runs this frame'),
      condition: 'if (stream_flags & 0x01) == 0',
      action: 'return_without_event_fetch',
      confidence: 'high',
      evidence: [
        'ASM line 21780 tests bit 0 of stream field +0.',
        'ASM line 21781 returns immediately when the active bit is clear.',
      ],
    },
    {
      id: 'primary_delay_gate',
      order: 1,
      field: fieldRef(ramCatalog, 'note_delay_counter', 'primary delay gate checked before reading the next stream event'),
      condition: 'if note_delay_counter is nonzero, decrement it; continue only when the decremented value reaches zero',
      actions: [
        {
          case: 'note_delay_counter == 0',
          next: 'secondary_delay_gate',
          stateEffect: 'no primary decrement',
        },
        {
          case: 'note_delay_counter == 1',
          next: 'secondary_delay_gate',
          stateEffect: 'note_delay_counter becomes 0',
        },
        {
          case: 'note_delay_counter > 1',
          next: 'return_without_event_fetch',
          stateEffect: 'note_delay_counter decrements by 1 and secondary_delay_counter is decremented once without a zero test',
        },
      ],
      alsoTouches: [
        fieldRef(ramCatalog, 'secondary_delay_counter', 'decremented once on the primary-delay early-return path'),
      ],
      confidence: 'high',
      evidence: [
        'ASM lines 21824-21830 read stream field +1, skip when zero, decrement when nonzero, and continue only when the result is zero.',
        'ASM lines 21831-21834 increment to field +3, decrement it, and return early when the primary delay remains nonzero.',
      ],
    },
    {
      id: 'secondary_delay_gate',
      order: 2,
      field: fieldRef(ramCatalog, 'secondary_delay_counter', 'secondary delay gate checked before reloading the current stream pointer'),
      condition: 'if secondary_delay_counter is nonzero, decrement it; continue only when the decremented value reaches zero',
      actions: [
        {
          case: 'secondary_delay_counter == 0',
          next: 'fetch_event',
          stateEffect: 'no secondary decrement',
        },
        {
          case: 'secondary_delay_counter == 1',
          next: 'fetch_event',
          stateEffect: 'secondary_delay_counter becomes 0',
        },
        {
          case: 'secondary_delay_counter > 1',
          next: 'return_without_event_fetch',
          stateEffect: 'secondary_delay_counter decrements by 1 and stream_flags are written back from the interpreter flag register',
        },
      ],
      alsoTouches: [
        fieldRef(ramCatalog, 'stream_flags', 'written back from I before returning on the secondary-delay early-return path'),
      ],
      confidence: 'high',
      evidence: [
        'ASM lines 21848-21854 read stream field +3, skip when zero, decrement when nonzero, and continue only when the result is zero.',
        'ASM lines 21855-21860 restore HL to the stream base, store I into field +0, and return when the secondary delay remains nonzero.',
      ],
    },
    {
      id: 'current_stream_pointer_fetch',
      order: 3,
      field: fieldRef(ramCatalog, 'current_stream_pointer', 'loaded into BC only after both delay gates allow event fetch'),
      condition: 'primary and secondary gates both allow continuation',
      action: 'load BC from stream fields +5/+6 and read the next event byte',
      confidence: 'high',
      evidence: [
        'ASM lines 21862-21867 increment from field +3 to +5/+6 and load C/B from current_stream_pointer.',
        'ASM lines 21868-21870 read A=(BC) after the delay gates allow the event parser to run.',
      ],
    },
  ];

  const resetPath = {
    id: 'stream_reset_bit4_path',
    condition: 'stream_flags bit 4 set at interpreter entry',
    clearedFields: [
      fieldRef(ramCatalog, 'single_stream_parameter', 'cleared on reset path'),
      fieldRef(ramCatalog, 'support_table_output_or_note_shift', 'cleared on reset path before future high-bit note timing'),
      fieldRef(ramCatalog, 'period_high_base_or_pair_param_1', 'cleared on reset path'),
      fieldRef(ramCatalog, 'period_low_base_or_pair_param_0', 'cleared on reset path'),
      fieldRef(ramCatalog, 'stream_instrument_or_effect_selector', 'cleared on reset path'),
      fieldRef(ramCatalog, 'call_repeat_control_counter', 'cleared on reset path'),
    ],
    pointerReloadField: fieldRef(ramCatalog, 'current_stream_pointer', 'loaded into BC after reset field clears'),
    confidence: 'high',
    evidence: [
      'ASM lines 21797-21800 test and clear stream_flags bit 4.',
      'ASM lines 21801-21806 clear IX+16, IX+7, IX+9, IX+11, and IX+12.',
      'ASM lines 21812-21821 clear stream field +19 and load BC from stream fields +5/+6.',
    ],
  };

  const derivedFetchRule = {
    expression: 'fetch_event_this_frame = active && (reset_path || ((note_delay_counter == 0 || --note_delay_counter == 0) && (secondary_delay_counter == 0 || --secondary_delay_counter == 0)))',
    caveat: 'The reset-bit path clears several stream fields, reloads current_stream_pointer, and fetches immediately. The primary-delay early-return path decrements secondary_delay_counter without checking for zero; this exact side effect is preserved as metadata for interpreter implementation.',
    consumedBy: [
      noteTimingCatalogId,
      'world-audio-event-trace-semantics-catalog-2026-06-25',
    ],
  };

  const summary = {
    gateCount: gates.length,
    delayGateCount: 2,
    resetClearedFieldCount: resetPath.clearedFields.length,
    validationIssueCount: validationIssues.length,
    assetPolicy: 'Metadata only: frame-gate control flow, field names, offsets, branch conditions, formulas, and ASM evidence. No ROM bytes, decoded music, timing values, or audio samples are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [ramCatalogId, noteTimingCatalogId],
    assetPolicy: summary.assetPolicy,
    summary,
    frameGate: {
      routineLabel: '_LABEL_C191_',
      routineRomOffset: '0x0C191',
      purpose: 'Decide whether one stream channel consumes a new event on this frame or only updates delay counters.',
      gates,
      resetPath,
      derivedFetchRule,
    },
    validationIssues,
    evidence: [
      '_LABEL_C191_ is the per-channel audio stream interpreter called by the bank-3 audio update loop.',
      'ASM lines 21824-21834 implement the primary delay gate on stream field +1.',
      'ASM lines 21848-21860 implement the secondary delay gate on stream field +3.',
      `${noteTimingCatalogId} explains how high-bit note and normal note paths populate the +1/+2/+3/+4 delay fields consumed here.`,
    ],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_frame_gate_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      frameGate: catalog.frameGate,
      validationIssues: catalog.validationIssues,
      nextLeads: [
        'Use this gate model to stop the preview/interpreter from consuming a new event on frames where +1 or +3 remains nonzero.',
        'Model the reset-bit path as an immediate fetch after field clears and pointer reload, not as a delay-gated frame.',
        'Promote the synthetic trace from per-event snapshots to a frame-stepped stream interpreter with active stream_flags handling.',
        'Cross-check gate outcomes against PSG/FM output phase writes once per-frame stream stepping is available.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    validationIssues: catalog.validationIssues,
  }, null, 2));
}

main();
