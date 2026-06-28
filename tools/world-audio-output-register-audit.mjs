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
const catalogId = 'world-audio-output-register-catalog-2026-06-25';
const reportId = 'audio-output-register-audit-2026-06-25';
const toolName = 'tools/world-audio-output-register-audit.mjs';

const driverCatalogId = 'world-audio-driver-routine-catalog-2026-06-24';
const ramCatalogId = 'world-audio-ram-state-catalog-2026-06-25';

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

function streamField(fieldName, relationship, confidence = 'medium') {
  return { kind: 'stream_field', fieldName, relationship, confidence };
}

function hardwareField(fieldName, relationship, confidence = 'medium') {
  return { kind: 'hardware_shadow_field', fieldName, relationship, confidence };
}

function globalRam(role, relationship, confidence = 'high') {
  return { kind: 'global_ram', role, relationship, confidence };
}

function supportData(name, relationship, confidence = 'medium') {
  return { kind: 'support_data', name, relationship, confidence };
}

function lineRange(start, end) {
  return end ? `ASM lines ${start}-${end}` : `ASM line ${start}`;
}

function phase(def) {
  return {
    confidence: 'medium',
    ...def,
    writeCount: def.writes.length,
  };
}

const PHASES = [
  phase({
    id: 'audio_init_register_reset',
    chip: 'mixed',
    routineLabel: '_LABEL_C000_',
    routineRole: 'fm_psg_init',
    summary: 'Initializes FM support registers from _DATA_C02D_ and silences all four PSG channels.',
    trigger: 'Audio initialization entry _LABEL_C000_.',
    registerFamily: 'FM initialization registers and SN76489 PSG attenuation latches',
    registerFormula: 'FM address/data pairs are loaded from _DATA_C02D_; PSG receives $9F/$BF/$DF/$FF maximum attenuation latches.',
    writes: [
      { line: 21564, port: 'Port_FMAddress', purpose: 'FM initialization register address from _DATA_C02D_' },
      { line: 21567, port: 'Port_FMData', purpose: 'FM initialization register data from _DATA_C02D_' },
      { line: 21575, port: 'Port_PSG', purpose: 'PSG channel 0 maximum attenuation latch' },
      { line: 21577, port: 'Port_PSG', purpose: 'PSG channel 1 maximum attenuation latch' },
      { line: 21579, port: 'Port_PSG', purpose: 'PSG channel 2 maximum attenuation latch' },
      { line: 21581, port: 'Port_PSG', purpose: 'PSG channel 3/noise maximum attenuation latch' },
    ],
    fieldRefs: [
      supportData('_DATA_C02D_', 'FM initialization address/data table consumed before PSG channels are silenced', 'high'),
    ],
    evidence: [
      `${lineRange(21564, 21581)} write FM initialization address/data bytes, then write PSG attenuation latches $9F/$BF/$DF/$FF.`,
    ],
  }),
  phase({
    id: 'psg_channel_silence_latch',
    chip: 'psg',
    routineLabel: '_LABEL_C4C1_',
    routineRole: 'psg_channel_update_dispatch',
    summary: 'Silences one PSG channel when hardware flag bit 2 requests a forced off/update state.',
    trigger: 'IY+0 bit 2 set in the active hardware shadow struct.',
    registerFamily: 'SN76489 attenuation latch',
    registerFormula: 'Port_PSG receives $9F + active_channel_index * $20.',
    writes: [{ line: 22187, port: 'Port_PSG', purpose: 'maximum attenuation latch for selected PSG channel' }],
    fieldRefs: [
      hardwareField('hardware_flags', 'bit 2 gates this silence latch', 'high'),
      globalRam('active_audio_channel_index', 'selects the PSG channel latch prefix'),
    ],
    evidence: [
      `${lineRange(22178, 22188)} clear IY+0 bit 2, derive $9F + channel*0x20 from _RAM_C220_, and write Port_PSG.`,
    ],
  }),
  phase({
    id: 'psg_tone_period_write',
    chip: 'psg',
    routineLabel: '_LABEL_C56A_',
    routineRole: 'psg_port_writer',
    summary: 'Computes a PSG tone period from the hardware pitch accumulator/step and writes the two-byte SN76489 tone period.',
    trigger: 'Tone channel update after stream pitch/envelope state is refreshed.',
    registerFamily: 'SN76489 tone period latch/data',
    registerFormula: 'First Port_PSG byte uses $80 + active_channel_index * $20 plus low period nibble; second byte carries the high period bits.',
    writes: [
      { line: 22355, port: 'Port_PSG', purpose: 'tone period low nibble latch' },
      { line: 22357, port: 'Port_PSG', purpose: 'tone period high bits' },
    ],
    fieldRefs: [
      hardwareField('pitch_accumulator_or_period', 'IY+2/IY+3 are combined with the pitch step before lookup', 'high'),
      hardwareField('pitch_delta_or_step', 'IY+4/IY+5 are added into the pitch accumulator path', 'high'),
      globalRam('active_audio_channel_index', 'selects the PSG tone channel latch prefix'),
      supportData('psg_pitch_lookup_table_8A85', 'Z80 $8A85 lookup table converts the accumulator into period bytes'),
    ],
    evidence: [
      `${lineRange(22290, 22357)} combine IY+2/IY+3 with IY+4/IY+5, index Z80 $8A85, and write two Port_PSG bytes.`,
    ],
  }),
  phase({
    id: 'psg_volume_envelope_write',
    chip: 'psg',
    routineLabel: '_LABEL_C5F6_',
    routineRole: 'psg_port_writer',
    summary: 'Computes PSG attenuation from the active envelope byte, hardware volume, and shared PSG bias byte.',
    trigger: 'Envelope step expires or a fresh volume nibble is needed.',
    registerFamily: 'SN76489 volume attenuation latch',
    registerFormula: 'Port_PSG receives $90 + active_channel_index * $20 + clamped attenuation nibble.',
    writes: [{ line: 22413, port: 'Port_PSG', purpose: 'volume attenuation latch' }],
    fieldRefs: [
      hardwareField('volume_or_attenuation', 'IY+1 is added to the stream/envelope volume nibble', 'high'),
      globalRam('psg_volume_bias_shared_byte', '_RAM_C23C_ adds shared PSG attenuation bias before clamping', 'medium'),
      globalRam('active_audio_channel_index', 'selects the PSG volume latch prefix'),
    ],
    evidence: [
      `${lineRange(22360, 22413)} combine envelope data with IY+1 and _RAM_C23C_, clamp to $0F, and write Port_PSG.`,
    ],
  }),
  phase({
    id: 'psg_volume_refresh_write',
    chip: 'psg',
    routineLabel: '_LABEL_C656_',
    routineRole: 'psg_volume_refresh',
    summary: 'Refreshes the current PSG attenuation nibble without advancing the full envelope path.',
    trigger: 'Envelope counter remains active and only the current attenuation must be resent.',
    registerFamily: 'SN76489 volume attenuation latch',
    registerFormula: 'Port_PSG receives $90 + active_channel_index * $20 + clamped attenuation nibble.',
    writes: [{ line: 22443, port: 'Port_PSG', purpose: 'volume attenuation refresh' }],
    fieldRefs: [
      globalRam('psg_volume_bias_shared_byte', '_RAM_C23C_ biases the cached attenuation before output', 'medium'),
      globalRam('active_audio_channel_index', 'selects the PSG volume latch prefix'),
    ],
    evidence: [
      `${lineRange(22425, 22443)} add _RAM_C23C_ to the cached attenuation and write Port_PSG.`,
    ],
  }),
  phase({
    id: 'psg_noise_state_write',
    chip: 'psg',
    routineLabel: '_LABEL_C671_',
    routineRole: 'psg_noise_state_update',
    summary: 'Updates PSG noise-channel control from the active hardware shadow and the _DATA_C6F3_ support table.',
    trigger: 'PSG channel 3/noise path enters the bit-0 hardware shadow update path.',
    registerFamily: 'SN76489 noise control latch',
    registerFormula: 'Port_PSG receives the third byte from a _DATA_C6F3_ three-byte noise state record.',
    writes: [{ line: 22512, port: 'Port_PSG', purpose: 'noise control latch' }],
    fieldRefs: [
      hardwareField('hardware_flags', 'IY+0 flags select/reset the noise update path', 'medium'),
      hardwareField('pitch_accumulator_or_period', 'IY+3 bits are tested to choose the _DATA_C6F3_ noise record', 'medium'),
      globalRam('active_audio_channel_index', 'channel 3 selects the PSG noise path'),
      supportData('_DATA_C6F3_', 'three-byte PSG noise support records consumed by _LABEL_C671_'),
    ],
    evidence: [
      `${lineRange(22446, 22526)} derive a _DATA_C6F3_ record from IY+3 bits and write its third byte to Port_PSG.`,
    ],
  }),
  phase({
    id: 'psg_envelope_release_write',
    chip: 'psg',
    routineLabel: '_LABEL_C748_',
    routineRole: 'psg_envelope_update',
    summary: 'Advances/release-clamps the PSG envelope nibble and writes the resulting attenuation.',
    trigger: 'Hardware flag bit 4 or bit 1 envelope/release paths reach _LABEL_C748_.',
    registerFamily: 'SN76489 volume attenuation latch',
    registerFormula: 'Port_PSG receives $90 + active_channel_index * $20 + clamped attenuation nibble.',
    writes: [{ line: 22585, port: 'Port_PSG', purpose: 'envelope/release attenuation latch' }],
    fieldRefs: [
      hardwareField('hardware_flags', 'IY+0 bits 3/4 govern envelope/release state reset', 'medium'),
      globalRam('psg_volume_bias_shared_byte', '_RAM_C23C_ biases the envelope attenuation before output', 'medium'),
      globalRam('active_audio_channel_index', 'selects the PSG volume latch prefix'),
    ],
    evidence: [
      `${lineRange(22536, 22585)} update the envelope nibble, apply _RAM_C23C_, and write Port_PSG.`,
    ],
  }),
  phase({
    id: 'fm_channel_silence_pair',
    chip: 'fm',
    routineLabel: '_LABEL_C78F_',
    routineRole: 'fm_channel_update_dispatch',
    summary: 'Writes FM registers for a forced channel-off/silence state when hardware flag bit 2 is set.',
    trigger: 'IY+0 bit 2 set in the active hardware shadow struct.',
    registerFamily: 'YM2413 melodic channel key/f-number and volume/instrument registers',
    registerFormula: 'Port_FMAddress receives $20 + channel and $30 + channel; Port_FMData receives masked cached state and muted volume data.',
    writes: [
      { line: 22625, port: 'Port_FMAddress', purpose: 'melodic channel pitch/key register address' },
      { line: 22631, port: 'Port_FMData', purpose: 'masked key/f-number data' },
      { line: 22642, port: 'Port_FMAddress', purpose: 'melodic channel instrument/volume register address' },
      { line: 22645, port: 'Port_FMData', purpose: 'muted instrument/volume data' },
    ],
    fieldRefs: [
      hardwareField('hardware_flags', 'bit 2 gates this forced FM silence path', 'high'),
      globalRam('active_audio_channel_index', 'selects the FM melodic channel register pair'),
    ],
    evidence: [
      `${lineRange(22619, 22649)} clear IY+0 bit 2 and write FM address/data pairs for $20+channel and $30+channel.`,
    ],
  }),
  phase({
    id: 'fm_volume_table_write',
    chip: 'fm',
    routineLabel: '_LABEL_C7FD_',
    routineRole: 'fm_channel_operator_update',
    summary: 'Rewrites FM initialization/operator data using the active hardware volume nibble.',
    trigger: 'FM channel 3/special path sees IY+1 volume change relative to the stream-side cache.',
    registerFamily: 'YM2413 operator/register initialization table',
    registerFormula: 'Port_FMAddress receives bytes from _DATA_C02D_; Port_FMData receives table data folded with IY+1 volume.',
    writes: [
      { line: 22678, port: 'Port_FMAddress', purpose: 'FM operator/register address from _DATA_C02D_' },
      { line: 22704, port: 'Port_FMData', purpose: 'volume-adjusted FM operator/register data' },
    ],
    fieldRefs: [
      hardwareField('volume_or_attenuation', 'IY+1 is folded into each FM data byte before output', 'high'),
      supportData('_DATA_C02D_', 'FM init/operator address/data table consumed by _LABEL_C7FD_'),
    ],
    evidence: [
      `${lineRange(22651, 22719)} compare the cached volume nibble, iterate _DATA_C02D_, and write FM address/data pairs.`,
    ],
  }),
  phase({
    id: 'fm_channel_volume_write',
    chip: 'fm',
    routineLabel: '_LABEL_C86B_',
    routineRole: 'fm_instrument_frequency_update',
    summary: 'Updates the YM2413 $30+channel instrument/volume register when the hardware volume nibble changes.',
    trigger: 'IY+1 low nibble differs from the stream-side FM cache.',
    registerFamily: 'YM2413 melodic channel instrument/volume register',
    registerFormula: 'Port_FMAddress receives $30 + channel; Port_FMData receives cached high nibble plus IY+1 low nibble.',
    writes: [
      { line: 22734, port: 'Port_FMAddress', purpose: 'instrument/volume register address' },
      { line: 22742, port: 'Port_FMData', purpose: 'instrument/volume register data' },
    ],
    fieldRefs: [
      hardwareField('volume_or_attenuation', 'IY+1 supplies the output volume nibble', 'high'),
      globalRam('active_audio_channel_index', 'selects the FM melodic channel register'),
    ],
    evidence: [
      `${lineRange(22721, 22743)} compare IY+1 with the cached nibble and write $30+channel through Port_FMAddress/Port_FMData.`,
    ],
  }),
  phase({
    id: 'fm_instrument_load_write',
    chip: 'fm',
    routineLabel: '_LABEL_C86B_',
    routineRole: 'fm_instrument_frequency_update',
    summary: 'Loads an FM instrument/effect selector and optionally streams custom operator bytes to FM registers.',
    trigger: 'IY+6 instrument/effect id changes, or id $09-$0B forces a reload.',
    registerFamily: 'YM2413 instrument/volume and optional custom instrument operator registers',
    registerFormula: 'Port_FMAddress receives $30 + channel for the instrument/volume byte, then optional sequential operator register numbers via register port $F0/$F1.',
    writes: [
      { line: 22803, port: 'Port_FMAddress', purpose: 'instrument/volume register address' },
      { line: 22806, port: 'Port_FMData', purpose: 'instrument/volume register data' },
      { line: 22827, port: 'Port_FMAddress', purpose: 'custom operator register address via out (c), e' },
      { line: 22829, port: 'Port_FMData', purpose: 'custom operator register data via out (c), a' },
    ],
    fieldRefs: [
      hardwareField('instrument_or_effect_id', 'IY+6 selects the FM instrument/operator support data', 'high'),
      hardwareField('volume_or_attenuation', 'IY+1 is ORed into the instrument/volume register data', 'medium'),
      streamField('psg_instrument_or_effect_cache', 'HL cache byte is compared with IY+6 before loading support data', 'medium'),
      supportData('fm_instrument_pointer_table_8DEB', 'Z80 $8DEB pointer table selects FM instrument/operator support records'),
    ],
    evidence: [
      `${lineRange(22747, 22839)} compare IY+6 with the cache, load a support pointer near Z80 $8DEB, and write FM instrument/operator registers.`,
    ],
  }),
  phase({
    id: 'fm_pitch_period_write',
    chip: 'fm',
    routineLabel: '_LABEL_C928_',
    routineRole: 'fm_port_writer',
    summary: 'Computes FM pitch/f-number state and writes changed high/low register bytes.',
    trigger: 'Pitch accumulator changes after stream pitch step processing.',
    registerFamily: 'YM2413 melodic channel f-number/block registers',
    registerFormula: 'Changed high byte writes $20 + channel; changed low byte writes $10 + channel.',
    writes: [
      { line: 22973, port: 'Port_FMAddress', purpose: 'high pitch/block register address' },
      { line: 22976, port: 'Port_FMData', purpose: 'high pitch/block register data' },
      { line: 22987, port: 'Port_FMAddress', purpose: 'low f-number register address' },
      { line: 22990, port: 'Port_FMData', purpose: 'low f-number register data' },
    ],
    fieldRefs: [
      hardwareField('pitch_accumulator_or_period', 'IY+2/IY+3 combine with step fields and are compared against cached output bytes', 'high'),
      hardwareField('pitch_delta_or_step', 'IY+4/IY+5 feed the FM pitch accumulator before lookup', 'high'),
      hardwareField('hardware_flags', 'IY+0 bits 6/7 track high/low pitch-byte changes before output', 'medium'),
      globalRam('active_audio_channel_index', 'selects the FM melodic channel pitch registers'),
      supportData('fm_pitch_lookup_table_8C1D', 'Z80 $8C1D lookup table converts the accumulator into FM pitch bytes'),
    ],
    evidence: [
      `${lineRange(22850, 22992)} combine IY+2/IY+3 with IY+4/IY+5, index Z80 $8C1D, set IY+0 change bits, and write changed FM pitch bytes.`,
    ],
  }),
  phase({
    id: 'fm_key_release_write',
    chip: 'fm',
    routineLabel: '_LABEL_C9EB_',
    routineRole: 'fm_keyoff_release_update',
    summary: 'Handles FM key/release transitions, including melodic channel key state and rhythm/noise register $0E paths.',
    trigger: 'Hardware flag bit 0 path reaches FM release/update handling.',
    registerFamily: 'YM2413 key/block and rhythm control registers',
    registerFormula: 'Melodic channels write $20 + channel; channel 3 special path writes register $0E.',
    writes: [
      { line: 23010, port: 'Port_FMAddress', purpose: 'melodic key/block register address' },
      { line: 23013, port: 'Port_FMData', purpose: 'melodic key/block data with key bit cleared' },
      { line: 23032, port: 'Port_FMAddress', purpose: 'rhythm/noise control register $0E address' },
      { line: 23034, port: 'Port_FMData', purpose: 'rhythm/noise control data $20' },
      { line: 23041, port: 'Port_FMAddress', purpose: 'rhythm/noise control register $0E address' },
      { line: 23044, port: 'Port_FMData', purpose: 'rhythm/noise data from IY+3 with bit 5 set' },
    ],
    fieldRefs: [
      hardwareField('hardware_flags', 'IY+0 bits are cleared as release/key state is handled', 'medium'),
      hardwareField('pitch_accumulator_or_period', 'IY+3 is used in the channel 3 rhythm/noise register path', 'medium'),
      globalRam('active_audio_channel_index', 'selects melodic versus channel 3 special FM path'),
    ],
    evidence: [
      `${lineRange(22994, 23048)} write $20+channel or FM register $0E depending on active channel and IY+3 bit state.`,
    ],
  }),
  phase({
    id: 'fm_keyoff_helper_write',
    chip: 'fm',
    routineLabel: '_LABEL_CA53_',
    routineRole: 'fm_keyoff_helper',
    summary: 'Clears FM key/release state and writes the resulting channel register data.',
    trigger: 'Hardware flag bit 1 path reaches _LABEL_CA53_.',
    registerFamily: 'YM2413 key/block helper registers',
    registerFormula: 'Melodic channels write $20 + channel then data; channel 3 special path writes register $0E and then $20 to the FM address port as observed.',
    writes: [
      { line: 23059, port: 'Port_FMAddress', purpose: 'melodic key/block register address' },
      { line: 23069, port: 'Port_FMData', purpose: 'melodic key/block data with key bit cleared' },
      { line: 23076, port: 'Port_FMAddress', purpose: 'rhythm/noise control register $0E address' },
      { line: 23079, port: 'Port_FMAddress', purpose: 'observed second FM address-port write of $20 in channel 3 path' },
    ],
    fieldRefs: [
      hardwareField('hardware_flags', 'IY+0 bit 1 is cleared before this helper writes FM state', 'medium'),
      globalRam('active_audio_channel_index', 'selects melodic versus channel 3 special helper path'),
    ],
    evidence: [
      `${lineRange(23050, 23082)} clear IY+0 bit 1, write melodic channel key/block data, or execute the channel 3 special $0E/$20 FM address-port path.`,
    ],
  }),
];

function routineByLabel(driverCatalog) {
  return new Map((driverCatalog.routines || []).map(routine => [routine.label, routine]));
}

function validatePhaseRefs(ramCatalog, phaseDef) {
  const issues = [];
  const streamFields = new Set((ramCatalog.streamChannelStruct?.fields || []).map(field => field.name));
  const hardwareFields = new Set((ramCatalog.hardwareShadowStruct?.fields || []).map(field => field.name));
  const globals = new Set((ramCatalog.globalRam || []).map(item => item.role));
  for (const ref of phaseDef.fieldRefs || []) {
    if (ref.kind === 'stream_field' && !streamFields.has(ref.fieldName)) issues.push(`missing stream field ${ref.fieldName}`);
    if (ref.kind === 'hardware_shadow_field' && !hardwareFields.has(ref.fieldName)) issues.push(`missing hardware shadow field ${ref.fieldName}`);
    if (ref.kind === 'global_ram' && !globals.has(ref.role)) issues.push(`missing global RAM role ${ref.role}`);
  }
  return issues;
}

function buildCatalog(mapData) {
  const driverCatalog = requireCatalog(mapData, driverCatalogId);
  const ramCatalog = requireCatalog(mapData, ramCatalogId);
  const routines = routineByLabel(driverCatalog);
  const outputPhases = PHASES.map(item => {
    const routine = routines.get(item.routineLabel) || null;
    const validationIssues = [
      ...(routine ? [] : [`missing routine ${item.routineLabel} in ${driverCatalogId}`]),
      ...validatePhaseRefs(ramCatalog, item),
    ];
    return {
      ...item,
      routine: routine ? {
        id: routine.id,
        label: routine.label,
        offset: routine.offset,
        role: routine.role,
        region: routine.region,
      } : null,
      validationIssues,
    };
  });
  const summary = outputPhases.reduce((acc, item) => {
    acc.phaseCount++;
    acc.writeCount += item.writeCount;
    if (item.chip === 'psg') acc.psgPhaseCount++;
    if (item.chip === 'fm') acc.fmPhaseCount++;
    if (item.chip === 'mixed') acc.mixedPhaseCount++;
    if (item.validationIssues.length) acc.validationIssueCount += item.validationIssues.length;
    for (const write of item.writes) acc.portWriteCounts[write.port] = (acc.portWriteCounts[write.port] || 0) + 1;
    return acc;
  }, {
    phaseCount: 0,
    psgPhaseCount: 0,
    fmPhaseCount: 0,
    mixedPhaseCount: 0,
    writeCount: 0,
    validationIssueCount: 0,
    portWriteCounts: {},
    sourceDriverRoutineCount: driverCatalog.routines?.length || 0,
    sourceStreamFieldCount: ramCatalog.streamChannelStruct?.fields?.length || 0,
    sourceHardwareFieldCount: ramCatalog.hardwareShadowStruct?.fields?.length || 0,
    assetPolicy: 'Metadata only: output phase ids, ASM labels/lines, port names, register formulas, RAM field names, support-data names, and confidence. No ROM bytes, decoded music, audio samples, or register traces are embedded.',
  });

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [driverCatalogId, ramCatalogId],
    assetPolicy: summary.assetPolicy,
    semantics: {
      purpose: 'Names the PSG/FM output phases that consume decoded audio stream state and write SMS audio ports.',
      fieldRefs: 'Field refs are metadata templates resolved per active stream or hardware-shadow channel by later trace tools.',
      caution: 'Register formulas are static descriptions of the observed ASM write paths; this is not yet a frame-accurate audio emulator.',
    },
    summary,
    outputPhases,
    evidence: [
      `${driverCatalogId} provides direct OUT instruction lines and routine/region references.`,
      `${ramCatalogId} provides the stream, hardware shadow, and global RAM field names consumed by these output phases.`,
      'ASM line references come from the local WORLD disassembly; no ROM bytes or decoded audio assets are embedded.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const byRegion = new Map();
  for (const phaseDef of catalog.outputPhases) {
    const region = phaseDef.routine?.region;
    if (!region?.id) continue;
    if (!byRegion.has(region.id)) byRegion.set(region.id, []);
    byRegion.get(region.id).push({
      id: phaseDef.id,
      chip: phaseDef.chip,
      summary: phaseDef.summary,
      writeCount: phaseDef.writeCount,
      writes: phaseDef.writes,
      registerFamily: phaseDef.registerFamily,
      confidence: phaseDef.confidence,
    });
  }

  const annotated = [];
  for (const [regionId, phases] of byRegion) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.audioOutputRegisterAudit = {
      catalogId,
      kind: 'audio_output_register_phase_host',
      confidence: phases.every(item => item.confidence === 'high') ? 'high' : 'medium',
      phaseCount: phases.length,
      phases,
      summary: `Hosts ${phases.length} PSG/FM output register phase(s).`,
      evidence: phases.flatMap(item => item.writes.map(write => `ASM line ${write.line}: ${write.port} ${write.purpose}`)),
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      phaseIds: phases.map(item => item.id),
    });
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [];

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_output_register_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      annotatedRegions,
      validationIssues: catalog.outputPhases.flatMap(item =>
        item.validationIssues.map(issue => ({ phaseId: item.id, issue }))
      ),
      nextLeads: [
        'Use outputPhases plus the event-RAM links to build a read-only frame trace of stream state to PSG/FM writes.',
        'Split the FM channel 3 rhythm/noise paths from melodic-channel paths once concrete request traces prove when they are used.',
        'Add analyzer UI that groups decoded audio stream events with the output register phases that would consume their updated fields.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    validationIssues: catalog.outputPhases.flatMap(item =>
      item.validationIssues.map(issue => ({ phaseId: item.id, issue }))
    ),
    annotatedRegions,
  }, null, 2));
}

main();
