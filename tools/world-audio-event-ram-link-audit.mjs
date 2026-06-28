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
const catalogId = 'world-audio-event-ram-link-catalog-2026-06-25';
const reportId = 'audio-event-ram-link-audit-2026-06-25';
const toolName = 'tools/world-audio-event-ram-link-audit.mjs';

const ramCatalogId = 'world-audio-ram-state-catalog-2026-06-25';
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

function streamField(name, relationship, confidence = 'high', notes = '') {
  return { kind: 'stream_field', fieldName: name, relationship, confidence, notes };
}

function hardwareField(name, relationship, confidence = 'medium', notes = '') {
  return { kind: 'hardware_shadow_field', fieldName: name, relationship, confidence, notes };
}

function globalRam(role, relationship, confidence = 'high', notes = '') {
  return { kind: 'global_ram', role, relationship, confidence, notes };
}

function unresolved(name, relationship, confidence = 'medium', notes = '') {
  return { kind: 'unresolved_stream_field', fieldName: name, relationship, confidence, notes };
}

function opcodeLink(opcode, refs, unresolvedRefs = []) {
  return { opcode, fieldRefs: refs, unresolvedRefs };
}

function buildCatalog(mapData) {
  const ramCatalog = requireCatalog(mapData, ramCatalogId);
  const opcodeCatalog = requireCatalog(mapData, opcodeCatalogId);
  const opcodeLinks = [
    opcodeLink('$F0', [
      streamField('current_stream_pointer', 'event fetch and post-handler continuation context'),
      streamField('stream_instrument_or_effect_selector', 'handler writes the control byte into stream field +12 before optional hardware-shadow mirroring', 'medium'),
      streamField('psg_instrument_or_effect_cache', 'PSG instrument/effect cache compared by the PSG update path', 'medium'),
      hardwareField('instrument_or_effect_id', 'handler can mirror the argument into IY+6 when stream flag bit 1 is clear'),
      globalRam('active_audio_channel_index', 'selects the active stream/hardware channel context'),
    ]),
    opcodeLink('$F1', [
      streamField('current_stream_pointer', 'event fetch and post-handler continuation context'),
      streamField('period_low_base_or_pair_param_0', 'handler stores the first pair-parameter byte into stream field +11', 'medium'),
      streamField('period_high_base_or_pair_param_1', 'handler stores the second pair-parameter byte into stream field +9', 'medium'),
      globalRam('active_audio_channel_index', 'selects the active stream/hardware channel context'),
    ]),
    opcodeLink('$F2', [
      streamField('current_stream_pointer', 'event fetch and post-handler continuation context'),
      streamField('period_low_base_or_pair_param_0', 'handler adds the first pair-parameter byte into stream field +11', 'medium'),
      streamField('period_high_base_or_pair_param_1', 'handler adds the second pair-parameter byte into stream field +9', 'medium'),
      globalRam('active_audio_channel_index', 'selects the active stream/hardware channel context'),
    ]),
    opcodeLink('$F3', [
      streamField('current_stream_pointer', 'event fetch and post-handler continuation context'),
      streamField('single_stream_parameter', 'handler stores one control/parameter byte into stream field +16', 'medium'),
      globalRam('active_audio_channel_index', 'selects the active stream/hardware channel context'),
    ]),
    opcodeLink('$F4', [
      streamField('current_stream_pointer', 'event fetch and post-handler continuation context'),
      streamField('single_stream_parameter', 'handler adds/clamps one control/parameter byte into stream field +16', 'medium'),
      globalRam('active_audio_channel_index', 'selects the active stream/hardware channel context'),
    ]),
    opcodeLink('$F5', [
      streamField('current_stream_pointer', 'event fetch and post-handler continuation context'),
      streamField('support_table_output_or_note_shift', 'handler stores one support-table lookup byte into stream field +7', 'medium'),
      globalRam('active_audio_channel_index', 'selects the active stream/hardware channel context'),
    ]),
    opcodeLink('$F6', [
      streamField('current_stream_pointer', 'event fetch and post-handler continuation context'),
      streamField('call_return_pointer', 'handler stores caller continuation BC into stream fields +17/+18 before loading the target pointer'),
      streamField('call_repeat_control_counter', 'handler stores the byte after the pointer argument into stream field +19', 'medium'),
      globalRam('active_audio_channel_index', 'selects the active stream/hardware channel context'),
    ]),
    opcodeLink('$F7', [
      streamField('current_stream_pointer', 'shared repeat/return handler reloads BC from saved stream state or stream data'),
      streamField('call_return_pointer', 'shared handler can reload BC from saved call-return fields +17/+18', 'high'),
      streamField('call_repeat_control_counter', 'shared handler tests/decrements stream field +19 before return/end handling', 'medium'),
      streamField('stream_flags', 'shared stream-end path can clear the stream flags field', 'medium'),
      globalRam('active_audio_channel_index', 'selects the active stream/hardware channel context'),
    ]),
    opcodeLink('$F8', [
      streamField('current_stream_pointer', 'repeat setup stores the current stream pointer as repeat body context'),
      streamField('repeat_counter', 'handler stores the repeat count into stream field +15'),
      streamField('repeat_body_pointer', 'handler stores current BC into stream fields +13/+14 as the repeat body pointer'),
      globalRam('active_audio_channel_index', 'selects the active stream/hardware channel context'),
    ]),
    opcodeLink('$F9', [
      streamField('current_stream_pointer', 'repeat tail may reload BC from saved repeat-body pointer fields'),
      streamField('repeat_counter', 'handler decrements stream field +15 and branches on zero', 'medium'),
      streamField('repeat_body_pointer', 'handler reloads BC from stream fields +13/+14 while the repeat counter remains active', 'medium'),
      globalRam('active_audio_channel_index', 'selects the active stream/hardware channel context'),
    ]),
    opcodeLink('$FA', [
      streamField('current_stream_pointer', 'jump target replaces BC and becomes the next stream continuation context'),
      globalRam('active_audio_channel_index', 'selects the active stream/hardware channel context'),
    ]),
  ];

  for (const opcode of ['$FB', '$FC', '$FD', '$FE', '$FF']) {
    opcodeLinks.push(opcodeLink(opcode, [
      streamField('current_stream_pointer', 'shared repeat/return/end handler uses the stream continuation context', 'medium'),
      streamField('call_return_pointer', 'shared handler can reload BC from saved call-return fields +17/+18', 'medium'),
      streamField('call_repeat_control_counter', 'shared handler tests/decrements stream field +19 before return/end handling', 'medium'),
      streamField('stream_flags', 'shared stream-end path can clear the stream flags field', 'medium'),
      globalRam('active_audio_channel_index', 'selects the active stream/hardware channel context'),
    ]));
  }

  const noteOrRest = {
    eventKind: 'note_or_rest_byte',
    fieldRefs: [
      streamField('note_delay_counter', 'shared stream interpreter delay gating before reading the next event'),
      streamField('current_stream_pointer', 'event fetch and post-event continuation context'),
      hardwareField('volume_or_attenuation', 'note/rest event output path uses the active hardware volume/attenuation shadow', 'high'),
      hardwareField('pitch_delta_or_step', 'note/rest event output path uses pitch step/delta shadow for tone updates', 'medium'),
      globalRam('active_audio_channel_index', 'selects the active stream/hardware channel context'),
    ],
    evidence: [
      'world-audio-ram-state-catalog-2026-06-25 names note_delay_counter, current_stream_pointer, volume_or_attenuation, pitch_delta_or_step, and active_audio_channel_index.',
      'The stream interpreter loads/stores current_stream_pointer around event parsing and exits through the PSG/FM dispatch selected by _RAM_C232_.',
    ],
  };

  const opcodesById = new Map((opcodeCatalog.opcodes || []).map(op => [op.opcode, op]));
  for (const link of opcodeLinks) {
    const opcode = opcodesById.get(link.opcode);
    link.opcodeName = opcode?.name || '';
    link.parserAction = opcode?.metadataParserAction || '';
    link.argSemantics = opcode?.argSemantics || [];
    link.streamStructEffects = opcode?.streamStructEffects || [];
    link.hardwareShadowEffects = opcode?.hardwareShadowEffects || [];
    link.evidence = [
      ...(opcode?.evidence || []).slice(0, 3),
      'Field refs are templates resolved per active stream/hardware channel by the browser analyzer; no RAM snapshots or stream bytes are embedded.',
    ];
  }

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [ramCatalogId, opcodeCatalogId],
    assetPolicy: 'Metadata only: event kinds, opcode ids, RAM field names, relationships, confidence, and evidence. No ROM bytes, stream bytes, decoded music, or audio samples are embedded.',
    semantics: {
      fieldRefTemplates: 'Refs use field names from the audio RAM state catalog and are resolved to concrete addresses per active channel at preview/runtime analysis time.',
      unresolvedRefs: 'Unresolved refs are reserved for known handler effects whose exact stream struct offsets have not yet been named; this catalog version resolves the previously generic HL-relative audio opcode fields to concrete stream struct offsets.',
      caution: 'This catalog describes static event-to-state relationships for inspection; it is not a cycle-accurate or frame-accurate audio interpreter.',
    },
    summary: {
      opcodeLinkCount: opcodeLinks.length,
      noteOrRestLinkCount: 1,
      exactFieldRefCount: opcodeLinks.reduce((sum, link) => sum + link.fieldRefs.length, 0) + noteOrRest.fieldRefs.length,
      unresolvedFieldRefCount: opcodeLinks.reduce((sum, link) => sum + link.unresolvedRefs.length, 0),
      sourceStreamFieldCount: ramCatalog.streamChannelStruct?.fields?.length || 0,
      sourceHardwareFieldCount: ramCatalog.hardwareShadowStruct?.fields?.length || 0,
      sourceOpcodeCount: opcodeCatalog.opcodes?.length || 0,
    },
    noteOrRest,
    opcodeLinks,
    evidence: [
      'world-audio-ram-state-catalog-2026-06-25 provides named stream, hardware shadow, global RAM, and priority-table fields.',
      'world-audio-opcode-state-effect-catalog-2026-06-25 provides handler-derived opcode semantics, argument counts, parser actions, and state-effect descriptions.',
      'Opcode field refs are tied to concrete stream struct offsets in world-audio-ram-state-catalog-2026-06-25 using handler start addresses and ASM line evidence.',
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
      type: 'audio_event_ram_link_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      nextLeads: [
        'Validate the newly named $F0-$F9/$FB-$FF stream fields with a frame-step trace against concrete channel bases.',
        'Use this event-to-RAM catalog as the source for synthetic audio RAM state traces in the analyzer.',
        'Feed exact field changes into a PSG/FM register preview once repeat/return flow is modeled.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    unresolvedRefs: catalog.opcodeLinks.flatMap(link =>
      (link.unresolvedRefs || []).map(ref => ({ opcode: link.opcode, fieldName: ref.fieldName, confidence: ref.confidence }))
    ),
  }, null, 2));
}

main();
