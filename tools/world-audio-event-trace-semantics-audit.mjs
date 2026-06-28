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
const catalogId = 'world-audio-event-trace-semantics-catalog-2026-06-25';
const reportId = 'audio-event-trace-semantics-audit-2026-06-25';
const toolName = 'tools/world-audio-event-trace-semantics-audit.mjs';

const eventRamCatalogId = 'world-audio-event-ram-link-catalog-2026-06-25';
const eventOutputCatalogId = 'world-audio-event-output-phase-link-catalog-2026-06-25';
const opcodeCatalogId = 'world-audio-opcode-state-effect-catalog-2026-06-25';

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

function stream(fieldName) {
  return { kind: 'stream_field', fieldName };
}

function hardware(fieldName) {
  return { kind: 'hardware_shadow_field', fieldName };
}

function global(role) {
  return { kind: 'global_ram', role };
}

function op(kind, target, extra = {}) {
  return {
    kind,
    target,
    confidence: 'medium',
    ...extra,
  };
}

function eventTrace(key, operations, extra = {}) {
  return {
    eventKey: key,
    eventKind: key === 'note_or_rest_byte' ? 'note_or_rest_byte' : 'control_opcode',
    operations,
    ...extra,
  };
}

const TRACE_DEFS = [
  eventTrace('note_or_rest_byte', [
    op('reload_or_decrement_delay', stream('note_delay_counter'), {
      valueSource: 'decoded note/rest timing path',
      confidence: 'medium',
      summary: 'The interpreter gates event fetch with the per-stream note delay counter and updates it from decoded note timing.',
    }),
    op('advance_stream_pointer', stream('current_stream_pointer'), {
      valueSource: 'post-event continuation pointer',
      confidence: 'high',
      summary: 'Normal note/rest handling stores the advanced stream pointer for the next event fetch.',
    }),
    op('touch_output_volume', hardware('volume_or_attenuation'), {
      valueSource: 'decoded note/rest volume path',
      confidence: 'medium',
      summary: 'The event path feeds hardware volume/attenuation state consumed by PSG/FM volume phases.',
    }),
    op('touch_output_pitch_step', hardware('pitch_delta_or_step'), {
      valueSource: 'decoded note/rest pitch path',
      confidence: 'medium',
      summary: 'The event path feeds pitch step/delta state consumed by PSG/FM pitch phases.',
    }),
  ], {
    summary: 'Trace note/rest event timing, stream continuation, and hardware-shadow output fields.',
    evidence: [
      'world-audio-event-ram-link-catalog-2026-06-25 links note/rest bytes to note_delay_counter, current_stream_pointer, volume_or_attenuation, and pitch_delta_or_step.',
      'world-audio-event-output-phase-link-catalog-2026-06-25 links note/rest bytes to PSG/FM tone, volume, and pitch output phases.',
    ],
  }),
  eventTrace('$F0', [
    op('advance_stream_pointer', stream('current_stream_pointer'), {
      valueSource: 'post-handler continuation pointer',
      confidence: 'high',
      summary: 'Control handler resumes at the stream interpreter tail after consuming one argument byte.',
    }),
    op('store_arg', stream('stream_instrument_or_effect_selector'), {
      argIndex: 0,
      confidence: 'medium',
      summary: 'Stores the instrument/effect selector byte into the stream-side selector field.',
    }),
    op('conditional_store_arg', hardware('instrument_or_effect_id'), {
      argIndex: 0,
      confidence: 'medium',
      condition: 'stream flag bit 1 clear',
      summary: 'May mirror the selector byte into the hardware shadow instrument/effect id.',
    }),
    op('touch_compare_cache', stream('psg_instrument_or_effect_cache'), {
      valueSource: 'later PSG/FM update cache comparison',
      confidence: 'medium',
      summary: 'The cache field is compared by output update paths before loading instrument/effect support data.',
    }),
  ], {
    summary: 'Trace instrument/effect selector state for PSG/FM instrument loading.',
  }),
  eventTrace('$F1', [
    op('advance_stream_pointer', stream('current_stream_pointer'), { valueSource: 'post-handler continuation pointer', confidence: 'high' }),
    op('store_arg', stream('period_low_base_or_pair_param_0'), { argIndex: 0, summary: 'Stores pair parameter byte 0 into the low-period base field.' }),
    op('store_arg', stream('period_high_base_or_pair_param_1'), { argIndex: 1, summary: 'Stores pair parameter byte 1 into the high-period base field.' }),
  ]),
  eventTrace('$F2', [
    op('advance_stream_pointer', stream('current_stream_pointer'), { valueSource: 'post-handler continuation pointer', confidence: 'high' }),
    op('add_arg', stream('period_low_base_or_pair_param_0'), { argIndex: 0, summary: 'Adds pair parameter delta byte 0 into the low-period base field.' }),
    op('add_arg', stream('period_high_base_or_pair_param_1'), { argIndex: 1, summary: 'Adds pair parameter delta byte 1 into the high-period base field.' }),
  ]),
  eventTrace('$F3', [
    op('advance_stream_pointer', stream('current_stream_pointer'), { valueSource: 'post-handler continuation pointer', confidence: 'high' }),
    op('store_arg', stream('single_stream_parameter'), { argIndex: 0, summary: 'Stores one parameter byte into the single stream parameter field.' }),
  ]),
  eventTrace('$F4', [
    op('advance_stream_pointer', stream('current_stream_pointer'), { valueSource: 'post-handler continuation pointer', confidence: 'high' }),
    op('add_arg_clamped', stream('single_stream_parameter'), { argIndex: 0, clampMax: 0x0F, summary: 'Adds one parameter byte and clamps through the handler path.' }),
  ]),
  eventTrace('$F5', [
    op('advance_stream_pointer', stream('current_stream_pointer'), { valueSource: 'post-handler continuation pointer', confidence: 'high' }),
    op('lookup_store', stream('support_table_output_or_note_shift'), {
      argIndex: 0,
      lookup: 'bank3_support_table_8423',
      confidence: 'medium',
      summary: 'Uses the argument as a support-table index and stores the fetched byte into the note-shift/control field.',
    }),
  ]),
  eventTrace('$F6', [
    op('save_pointer_context', stream('call_return_pointer'), {
      valueSource: 'caller continuation pointer context',
      confidence: 'high',
      summary: 'Saves caller continuation state before loading the target stream pointer.',
    }),
    op('store_context_byte', stream('call_repeat_control_counter'), {
      valueSource: 'handler byte after pointer argument',
      confidence: 'medium',
      summary: 'Stores a handler-context byte into the call/repeat control counter field.',
    }),
    op('branch_pointer_arg', stream('current_stream_pointer'), {
      argIndices: [0, 1],
      confidence: 'high',
      summary: 'Loads the immediate pointer target into the stream interpreter context.',
    }),
  ]),
  eventTrace('$F7', [
    op('test_decrement', stream('call_repeat_control_counter'), { confidence: 'medium', summary: 'Tests/decrements the shared call/repeat control counter.' }),
    op('maybe_reload_pointer', stream('call_return_pointer'), { confidence: 'medium', summary: 'May reload BC from the saved call-return pointer fields.' }),
    op('maybe_clear', stream('stream_flags'), { confidence: 'medium', summary: 'The shared return/end path can clear stream flags.' }),
  ]),
  eventTrace('$F8', [
    op('store_arg', stream('repeat_counter'), { argIndex: 0, confidence: 'high', summary: 'Stores the repeat count byte.' }),
    op('save_pointer_context', stream('repeat_body_pointer'), { valueSource: 'repeat body continuation pointer', confidence: 'high', summary: 'Stores the stream pointer for the repeat body.' }),
    op('advance_stream_pointer', stream('current_stream_pointer'), { valueSource: 'post-handler continuation pointer', confidence: 'high' }),
  ]),
  eventTrace('$F9', [
    op('test_decrement', stream('repeat_counter'), { confidence: 'medium', summary: 'Decrements the repeat counter and branches on zero.' }),
    op('maybe_reload_pointer', stream('repeat_body_pointer'), { confidence: 'medium', summary: 'May reload BC from saved repeat-body pointer fields.' }),
    op('advance_or_loop_stream_pointer', stream('current_stream_pointer'), { valueSource: 'repeat branch decision', confidence: 'medium' }),
  ]),
  eventTrace('$FA', [
    op('branch_pointer_arg', stream('current_stream_pointer'), {
      argIndices: [0, 1],
      confidence: 'high',
      summary: 'Jumps to the immediate stream pointer target without saving a return pointer.',
    }),
  ]),
  ...['$FB', '$FC', '$FD', '$FE', '$FF'].map(key => eventTrace(key, [
    op('test_decrement', stream('call_repeat_control_counter'), { confidence: 'medium', summary: 'Shares the $F7 repeat/return/end control path.' }),
    op('maybe_reload_pointer', stream('call_return_pointer'), { confidence: 'medium', summary: 'May reload BC from saved call-return pointer fields.' }),
    op('maybe_clear', stream('stream_flags'), { confidence: 'medium', summary: 'The shared path can clear stream flags.' }),
  ])),
];

function refKey(ref) {
  if (!ref) return '';
  if (ref.kind === 'stream_field') return `stream:${ref.fieldName}`;
  if (ref.kind === 'hardware_shadow_field') return `hardware:${ref.fieldName}`;
  if (ref.kind === 'global_ram') return `global:${ref.role}`;
  return `${ref.kind || 'unknown'}:${ref.fieldName || ref.role || ''}`;
}

function linkRefsByEvent(eventCatalog) {
  const entries = new Map();
  entries.set('note_or_rest_byte', eventCatalog.noteOrRest?.fieldRefs || []);
  for (const link of eventCatalog.opcodeLinks || []) entries.set(link.opcode, link.fieldRefs || []);
  return entries;
}

function buildCatalog(mapData) {
  const eventCatalog = requireCatalog(mapData, eventRamCatalogId);
  const outputCatalog = requireCatalog(mapData, eventOutputCatalogId);
  const opcodeCatalog = requireCatalog(mapData, opcodeCatalogId);
  const eventRefs = linkRefsByEvent(eventCatalog);
  const outputLinks = new Map((outputCatalog.eventOutputLinks || []).map(link => [link.eventKey, link]));
  const opcodeInfo = new Map((opcodeCatalog.opcodes || []).map(opcode => [opcode.opcode, opcode]));

  const traceSemantics = TRACE_DEFS.map(def => {
    const refs = eventRefs.get(def.eventKey) || [];
    const validKeys = new Set(refs.map(refKey));
    const validationIssues = [];
    for (const operation of def.operations || []) {
      const key = refKey(operation.target);
      if (key && !validKeys.has(key)) {
        validationIssues.push(`operation target ${key} is not present in ${eventRamCatalogId} for ${def.eventKey}`);
      }
    }
    const outputLink = outputLinks.get(def.eventKey);
    const opcode = opcodeInfo.get(def.eventKey);
    return {
      ...def,
      opcodeName: opcode?.name || def.opcodeName || '',
      parserAction: opcode?.metadataParserAction || opcode?.parserAction || '',
      directOutputPhaseCount: outputLink?.directOutputPhaseCount || 0,
      directOutputPhaseIds: (outputLink?.matchedOutputPhases || []).map(phase => phase.phaseId),
      validationIssues,
      evidence: [
        ...(def.evidence || []),
        `${eventRamCatalogId} provides the event field refs validated by this trace semantic entry.`,
        `${eventOutputCatalogId} provides direct output phase ids where available.`,
        ...(opcode?.evidence || []).slice(0, 2),
      ],
    };
  });

  const summary = traceSemantics.reduce((acc, item) => {
    acc.eventKindCount++;
    acc.operationCount += item.operations.length;
    acc.directOutputPhaseLinkedEventCount += item.directOutputPhaseCount ? 1 : 0;
    acc.validationIssueCount += item.validationIssues.length;
    for (const opItem of item.operations) {
      acc.operationKindCounts[opItem.kind] = (acc.operationKindCounts[opItem.kind] || 0) + 1;
      if (opItem.target?.kind === 'stream_field') acc.streamOperationCount++;
      if (opItem.target?.kind === 'hardware_shadow_field') acc.hardwareShadowOperationCount++;
      if (opItem.target?.kind === 'global_ram') acc.globalRamOperationCount++;
    }
    return acc;
  }, {
    eventKindCount: 0,
    operationCount: 0,
    directOutputPhaseLinkedEventCount: 0,
    validationIssueCount: 0,
    streamOperationCount: 0,
    hardwareShadowOperationCount: 0,
    globalRamOperationCount: 0,
    operationKindCounts: {},
    sourceEventRefCount: eventCatalog.summary?.exactFieldRefCount || 0,
    sourceOutputLinkCount: outputCatalog.summary?.totalDirectOutputPhaseLinks || 0,
    assetPolicy: 'Metadata only: event ids, operation kinds, RAM field names, argument indices, branch semantics, confidence, and evidence refs. No ROM bytes, stream argument values, decoded music, audio samples, or register traces are embedded.',
  });

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [eventRamCatalogId, eventOutputCatalogId, opcodeCatalogId],
    assetPolicy: summary.assetPolicy,
    semantics: {
      purpose: 'Defines browser-only trace operations for decoded audio events; the browser fills in argument values from the user-loaded local ROM.',
      valuePolicy: 'No argument bytes or derived stream values are stored in this catalog. Values are shown only in the live analyzer from local ROM memory.',
      caution: 'This is a static semantic trace scaffold, not a cycle-accurate Z80 interpreter or audible PSG/FM emulation.',
    },
    summary,
    traceSemantics,
    evidence: [
      `${eventRamCatalogId} supplies field refs for each decoded event kind.`,
      `${eventOutputCatalogId} supplies direct output phase links for display and future trace grouping.`,
      `${opcodeCatalogId} supplies handler-derived opcode parser actions and ASM evidence.`,
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
      type: 'audio_event_trace_semantics_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      validationIssues: catalog.traceSemantics.flatMap(item =>
        item.validationIssues.map(issue => ({ eventKey: item.eventKey, issue }))
      ),
      nextLeads: [
        'Use this trace semantics catalog in the analyzer to show per-event stream/hardware-shadow state operations with local ROM argument values.',
        'Promote operations from static semantics to frame-accurate effects after implementing the stream interpreter delay/repeat paths.',
        'Connect traced hardware-shadow writes to PSG/FM register preview rows from world-audio-output-register-catalog-2026-06-25.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    validationIssues: catalog.traceSemantics.flatMap(item =>
      item.validationIssues.map(issue => ({ eventKey: item.eventKey, issue }))
    ),
  }, null, 2));
}

main();
