#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-player-state-catalog-2026-06-24';
const reportId = 'player-state-audit-2026-06-24';

const OUTER_TABLE = {
  label: '_DATA_4770_',
  offset: 0x04770,
  selectorRam: '_RAM_C24F_',
  selectorMask: '$07',
  callerLabel: '_LABEL_4746_',
  summary: '_RAM_C24F_ selects one of six outer player/form dispatchers.',
};

const INNER_TABLES = [
  { label: '_DATA_5069_', offset: 0x05069, callerLabel: '_LABEL_5063_', outerIndex: 0 },
  { label: '_DATA_5081_', offset: 0x05081, callerLabel: '_LABEL_507B_', outerIndex: 1 },
  { label: '_DATA_5099_', offset: 0x05099, callerLabel: '_LABEL_5093_', outerIndex: 2 },
  { label: '_DATA_50B3_', offset: 0x050B3, callerLabel: '_LABEL_50AD_', outerIndex: 3 },
  { label: '_DATA_50CB_', offset: 0x050CB, callerLabel: '_LABEL_50C5_', outerIndex: 4 },
  { label: '_DATA_50E1_', offset: 0x050E1, callerLabel: '_LABEL_50DB_', outerIndex: 5 },
];

const SUBSTATE_TABLE = {
  label: '_DATA_21BC_',
  offset: 0x021BC,
  selectorRam: '_RAM_C271_',
  selectorMask: '$03',
  callerLabel: '_LABEL_21B6_',
  summary: '_RAM_C271_ selects one of four vector/probe substates used by _DATA_5099_ vector handlers.',
};

const DATA_TABLES = [
  {
    label: '_DATA_55C1_',
    offset: 0x055C1,
    role: 'player_transition_velocity_table',
    entryCount: 8,
    entryStride: 1,
    usedBy: ['_LABEL_54CB_'],
    summary: 'Eight one-byte high-vector values selected from _RAM_C271_ plus player flag bits during one player state transition.',
    evidence: [
      '_LABEL_54CB_ loads _DATA_55C1_, indexes it with _RAM_C271_ and _RAM_C241_ state bits, shifts the byte into the high half of HL, and stores HL to _RAM_C248_ or _RAM_C24A_.',
    ],
  },
  {
    label: '_DATA_5674_',
    offset: 0x05674,
    role: 'player_transition_vector_table',
    entryCount: 8,
    entryStride: 2,
    usedBy: ['_LABEL_55C9_', '_LABEL_5611_'],
    summary: 'Eight two-byte vector/parameter pairs selected from _RAM_C271_ plus _RAM_C251_ and stored in _RAM_C25E_/_RAM_C25F_.',
    evidence: [
      '_LABEL_55C9_ and _LABEL_5611_ compute ((_RAM_C271_ * 2) + _RAM_C251_) * 2, index _DATA_5674_, and store the selected pair in _RAM_C25E_/_RAM_C25F_.',
      'The 0x05674 region is not screen_prog for this path; it is reached as an HL data table, not through _LABEL_604_.',
    ],
  },
];

const ROUTINES = [
  { label: '_LABEL_4746_', role: 'player_frame_dispatch', summary: 'Top-level player update dispatch; masks _RAM_C24F_ and jumps through _DATA_4770_.' },
  { label: '_LABEL_5063_', role: 'player_outer_dispatch_0', summary: 'Outer player/form dispatcher 0; masks _RAM_C260_ and jumps through _DATA_5069_.' },
  { label: '_LABEL_507B_', role: 'player_outer_dispatch_1', summary: 'Outer player/form dispatcher 1; masks _RAM_C260_ and jumps through _DATA_5081_.' },
  { label: '_LABEL_5093_', role: 'player_outer_dispatch_2', summary: 'Outer player/form dispatcher 2; masks _RAM_C260_ and jumps through _DATA_5099_.' },
  { label: '_LABEL_50AD_', role: 'player_outer_dispatch_3', summary: 'Outer player/form dispatcher 3; masks _RAM_C260_ and jumps through _DATA_50B3_.' },
  { label: '_LABEL_50C5_', role: 'player_outer_dispatch_4', summary: 'Outer player/form dispatcher 4; masks _RAM_C260_ and jumps through _DATA_50CB_.' },
  { label: '_LABEL_50DB_', role: 'player_outer_dispatch_5', summary: 'Outer player/form dispatcher 5; masks _RAM_C260_ and jumps through _DATA_50E1_.' },
  { label: '_LABEL_4B31_', role: 'player_state_handler_0', summary: 'Shared state handler entered from inner table slot 0; initializes state flags and velocity/table values before setting _RAM_C260_ to $83.' },
  { label: '_LABEL_50F3_', role: 'player_state_handler_1', summary: 'Shared state handler entered from slot 1; reads _RAM_D279_ input bits and transitions _RAM_C260_ among movement states.' },
  { label: '_LABEL_5170_', role: 'player_state_handler_2', summary: 'Shared state handler entered from slot 2; updates _RAM_C25E_ from facing direction and calls the movement helper _LABEL_1A36_.' },
  { label: '_LABEL_51FB_', role: 'player_state_handler_3_jump_variant', summary: 'Shared state handler entered from slot 3 for most forms; initializes _RAM_C24A_ to a jump/fall vector and sets airborne state flags.' },
  { label: '_LABEL_54CB_', role: 'player_state_handler_3_transition_variant', summary: 'Form-specific slot-3 handler in _DATA_5099_; indexes _DATA_55C1_ to seed _RAM_C248_ or _RAM_C24A_.' },
  { label: '_LABEL_52D8_', role: 'player_state_handler_4', summary: 'Shared slot-4 handler; branches on _RAM_CF95_ and _RAM_D279_ and may return to slot 1 or slot 5/8.' },
  { label: '_LABEL_4EBD_', role: 'player_state_handler_5', summary: 'Shared slot-5 handler; handles state entry, contact checks, and optional _RAM_C24F_ transformation cycling.' },
  { label: '_LABEL_5611_', role: 'player_state_handler_6_vector_variant', summary: 'Form-specific slot-6 handler in _DATA_5099_; selects _DATA_5674_ vector pairs from _RAM_C271_ and _RAM_C251_.' },
  { label: '_LABEL_4C32_', role: 'player_state_handler_7_transition', summary: 'Shared slot-7 handler; performs room/transition logic through _DATA_4CAD_ and coordinate state.' },
  { label: '_LABEL_4FAB_', role: 'player_state_handler_8_variant_a', summary: 'Extra slot-8 handler for outer dispatchers 0 and 1; reuses movement/contact checks and _RAM_D279_ input.' },
  { label: '_LABEL_533C_', role: 'player_state_handler_8_variant_b', summary: 'Extra slot-8 handler for outer dispatcher 3; initializes _RAM_C24A_ and branches through contact/input flags.' },
  { label: '_LABEL_540A_', role: 'player_state_handler_8_variant_c', summary: 'Extra slot-8 handler for outer dispatcher 5; similar to _LABEL_533C_ with different transition gating.' },
  { label: '_LABEL_55C9_', role: 'player_state_handler_9_vector_restore', summary: 'Extra slot-9 handler in _DATA_5099_; indexes _DATA_5674_ and restores _RAM_C243_/_RAM_C246_ from saved coordinates.' },
  { label: '_LABEL_5684_', role: 'player_state_handler_8_vector_variant', summary: 'Extra slot-8 handler in _DATA_5099_; uses _RAM_C271_ with animation selection and contact/input transitions.' },
  { label: '_LABEL_21B6_', role: 'player_vector_substate_dispatch', summary: 'Vector substate dispatcher; masks _RAM_C271_ with $03 and jumps through _DATA_21BC_.' },
  { label: '_LABEL_21C4_', role: 'player_vector_substate_0', summary: 'First _RAM_C271_ vector handler; probes mask $02, handles input bits $0C/bit 1, and may update _RAM_C271_ and _RAM_C251_.' },
  { label: '_LABEL_2207_', role: 'player_vector_substate_1', summary: 'Second _RAM_C271_ vector handler; probes mask $04, handles input bits $03/bit 2, and may update _RAM_C271_ and _RAM_C251_.' },
  { label: '_LABEL_2248_', role: 'player_vector_substate_2', summary: 'Third _RAM_C271_ vector handler; probes mask $01, handles input bits $0C/bit 0, and may update _RAM_C271_ and _RAM_C251_.' },
  { label: '_LABEL_228C_', role: 'player_vector_substate_3', summary: 'Fourth _RAM_C271_ vector handler; probes mask $08, handles input bits $03/bit 3, and may update _RAM_C271_ and _RAM_C251_.' },
  { label: '_LABEL_1F47_', role: 'player_vector_probe_helper', summary: 'Common vector probe helper; stores candidate _RAM_C273_/_RAM_C275_ coordinates and returns carry based on _LABEL_141F_ collision/probe result.' },
  { label: '_LABEL_1FCA_', role: 'player_vector_adjust_helper_0', summary: 'Coordinate-adjust helper called from _RAM_C271_ substate 0; updates _RAM_C273_/_RAM_C275_ and IX+49 when a probe crosses a threshold.' },
  { label: '_LABEL_2046_', role: 'player_vector_adjust_helper_2', summary: 'Coordinate-adjust helper called from _RAM_C271_ substate 2; updates _RAM_C273_/_RAM_C275_ and IX+49 when a probe crosses a threshold.' },
  { label: '_LABEL_20C0_', role: 'player_vector_adjust_helper_1', summary: 'Coordinate-adjust helper called from _RAM_C271_ substate 1; updates _RAM_C273_/_RAM_C275_ and IX+49 when a probe crosses a threshold.' },
  { label: '_LABEL_213D_', role: 'player_vector_adjust_helper_3', summary: 'Coordinate-adjust helper called from _RAM_C271_ substate 3; updates _RAM_C273_/_RAM_C275_ and IX+49 when a probe crosses a threshold.' },
  { label: '_LABEL_22CE_', role: 'player_vector_snap_x_helper', summary: 'Snap/align helper used by vector substates 0 and 2; adjusts _RAM_C243_ and _RAM_C273_ to a tile boundary.' },
  { label: '_LABEL_22F9_', role: 'player_vector_snap_y_helper', summary: 'Snap/align helper used by vector substates 1 and 3; adjusts _RAM_C246_ and _RAM_C275_ to a tile boundary.' },
  { label: '_LABEL_1A28_', role: 'player_movement_helper_variant_candidate', summary: 'Movement helper variant called by vertical/vector substates before direction comparison; exact physics semantics still pending.' },
  { label: '_LABEL_1AFF_', role: 'player_input_motion_helper_candidate', summary: 'Input/motion helper called by vertical/vector substates and shared player state handlers; exact physics semantics still pending.' },
  { label: '_LABEL_1446_', role: 'player_position_integrator_candidate', summary: 'Common routine called by player state handlers after state setup; exact physics semantics still pending.' },
  { label: '_LABEL_19B6_', role: 'player_collision_contact_candidate', summary: 'Common routine called by player state handlers before checking IX+27 contact flags; exact collision semantics still pending.' },
  { label: '_LABEL_1A36_', role: 'player_movement_helper_candidate', summary: 'Common helper called after _RAM_C25E_ updates in directional movement paths; exact semantics still pending.' },
  { label: '_LABEL_1AB6_', role: 'player_input_idle_helper_candidate', summary: 'Common helper used when no directional input bits are active; exact semantics still pending.' },
];

const RAM_ROLES = [
  { address: '$C24F', label: '_RAM_C24F_', role: 'player_transformation_outer_state', confidence: 'high', summary: 'Outer player/form selector; _LABEL_4746_ masks it with $07 and dispatches through _DATA_4770_.' },
  { address: '$C260', label: '_RAM_C260_', role: 'player_inner_state', confidence: 'high', summary: 'Inner player state selector; outer dispatchers mask it with $0F and state handlers use bit 7 as an entry-initialized flag.' },
  { address: '$C271', label: '_RAM_C271_', role: 'player_substate_vector_index', confidence: 'high', summary: 'Substate/vector index used by the _DATA_55C1_ and _DATA_5674_ player transition tables.' },
  { address: '$C251', label: '_RAM_C251_', role: 'player_facing_direction', confidence: 'high', summary: 'Facing direction selector combined with _RAM_C271_ for _DATA_5674_ and written from _RAM_D279_ directional bits.' },
  { address: '$C248', label: '_RAM_C248_', role: 'player_motion_word_candidate', confidence: 'medium', summary: 'Movement/velocity word written by _LABEL_54CB_, _LABEL_55C9_, _LABEL_5611_, and several shared state handlers; axis semantics still pending.' },
  { address: '$C24A', label: '_RAM_C24A_', role: 'player_motion_word_candidate', confidence: 'medium', summary: 'Movement/velocity word written by jump/vector state handlers including _LABEL_51FB_ and _LABEL_54CB_; axis semantics still pending.' },
  { address: '$C25E', label: '_RAM_C25E_', role: 'player_motion_parameter', confidence: 'medium', summary: 'Byte parameter written from facing direction and _DATA_5674_ before movement helper calls; exact meaning pending.' },
  { address: '$C25F', label: '_RAM_C25F_', role: 'player_motion_parameter_pair_hi', confidence: 'medium', summary: 'Second byte of the _DATA_5674_ selected pair written by _LABEL_55C9_ and _LABEL_5611_; exact meaning pending.' },
  { address: '$C241', label: '_RAM_C241_', role: 'player_state_flags', confidence: 'medium', summary: 'Player flag byte; bits $20/$40 alter the _DATA_55C1_ table index in _LABEL_54CB_.' },
  { address: '$CF95', label: '_RAM_CF95_', role: 'player_contact_or_environment_flags', confidence: 'medium', summary: 'Flag byte tested by multiple player state handlers; bit 5 and bit 4 gate transitions to _RAM_C260_ states 3, 5, and 8.' },
  { address: '$D279', label: '_RAM_D279_', role: 'player_input_bits', confidence: 'high', summary: 'Input bitfield read by state handlers; low nibble and bits $0C drive idle, direction, and transition decisions.' },
  { address: '$C243', label: '_RAM_C243_', role: 'player_coordinate_word_candidate', confidence: 'medium', summary: 'Coordinate/state word restored from _RAM_C273_ by _LABEL_55C9_; exact coordinate axis pending.' },
  { address: '$C246', label: '_RAM_C246_', role: 'player_coordinate_word_candidate', confidence: 'medium', summary: 'Coordinate/state bytes restored from _RAM_C275_ by _LABEL_55C9_; ASM declares a byte but this routine stores a word.' },
  { address: '$C273', label: '_RAM_C273_', role: 'player_saved_coordinate_word_candidate', confidence: 'medium', summary: 'Saved coordinate/state word copied into _RAM_C243_ by _LABEL_55C9_.' },
  { address: '$C275', label: '_RAM_C275_', role: 'player_saved_coordinate_word_candidate', confidence: 'medium', summary: 'Saved coordinate/state word copied into _RAM_C246_ by _LABEL_55C9_.' },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readWordLE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function regionBounds(region) {
  const start = parseInt(region.offset, 16);
  return { start, end: start + (region.size || 0) };
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
  }) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function normalizeAddress(address) {
  return String(address || '').toUpperCase().replace(/^0X/, '$');
}

function findRamEntry(mapData, address) {
  const normalized = normalizeAddress(address);
  return (mapData.ram || []).find(entry => normalizeAddress(entry.address) === normalized) || null;
}

function ramRef(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || '',
    name: entry.name || '',
  };
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function buildAsmIndex(asmText) {
  const lines = asmText.split(/\r?\n/);
  const labelsByOffset = new Map();
  const labelLines = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_(?:LABEL|DATA)_[0-9A-F]+_):/.exec(lines[i]);
    if (!match) continue;
    const offset = labelOffset(match[1]);
    if (offset == null) continue;
    labelsByOffset.set(offset, match[1]);
    labelLines.set(match[1], i + 1);
  }
  return { lines, labelsByOffset, labelLines };
}

function scanLabelBlock(asmIndex, label) {
  const startLine = asmIndex.labelLines.get(label);
  if (!startLine) return null;
  const lines = asmIndex.lines;
  const body = [];
  for (let i = startLine; i < lines.length; i++) {
    if (i > startLine && /^_(?:LABEL|DATA)_[0-9A-F]+_:/.test(lines[i])) break;
    body.push({ line: i + 1, code: cleanCode(lines[i]) });
  }
  const readsRAM = new Set();
  const writesRAM = new Set();
  const calls = new Set();
  const dataRefs = new Set();
  for (const item of body) {
    if (!item.code) continue;
    const callMatch = /\bcall\s+(_LABEL_[0-9A-F]+_)/i.exec(item.code);
    if (callMatch) calls.add(callMatch[1]);
    let dataMatch;
    const dataRe = /_DATA_[0-9A-F]+_/gi;
    while ((dataMatch = dataRe.exec(item.code)) !== null) dataRefs.add(dataMatch[0]);
    let ramMatch;
    const ramRe = /_RAM_[0-9A-F]+_/gi;
    while ((ramMatch = ramRe.exec(item.code)) !== null) {
      const ref = ramMatch[0];
      const before = item.code.slice(0, ramMatch.index);
      if (/\bld\s+\($/i.test(before) || /\bld\s+\([^)]*$/i.test(before)) writesRAM.add(ref);
      else readsRAM.add(ref);
    }
  }
  return {
    startLine,
    lineCount: body.length,
    calls: [...calls].sort(),
    dataRefs: [...dataRefs].sort(),
    readsRAM: [...readsRAM].sort(),
    writesRAM: [...writesRAM].sort(),
  };
}

function buildPointerTable(mapData, romBytes, asmIndex, def, kind) {
  const region = findContainingRegion(mapData, def.offset);
  const entryCount = Math.floor((region?.size || 0) / 2);
  const entries = [];
  for (let index = 0; index < entryCount; index++) {
    const pointerOffset = def.offset + index * 2;
    const pointer = readWordLE(romBytes, pointerOffset);
    const targetLabel = pointer ? (asmIndex.labelsByOffset.get(pointer) || null) : null;
    const targetRegion = pointer ? findContainingRegion(mapData, pointer) : null;
    entries.push({
      index,
      pointerOffset: hex(pointerOffset),
      z80Pointer: pointer ? hex(pointer, 4) : '$0000',
      targetLabel,
      targetRegion: regionRef(targetRegion),
      isNull: pointer === 0,
    });
  }
  const line = asmIndex.labelLines.get(def.label) || null;
  return {
    label: def.label,
    offset: hex(def.offset),
    kind,
    region: regionRef(region),
    callerLabel: def.callerLabel,
    outerIndex: def.outerIndex,
    selectorRam: def.selectorRam || (kind === 'outer_player_dispatch_table' ? OUTER_TABLE.selectorRam : '_RAM_C260_'),
    selectorMask: def.selectorMask || (kind === 'outer_player_dispatch_table' ? OUTER_TABLE.selectorMask : '$0F'),
    entryCount,
    entries,
    evidence: [
      line ? `ASM line ${line}: ${def.label} is emitted as a .dw jump table.` : `${def.label} is emitted as a .dw jump table in ASM.`,
      `${def.callerLabel} masks ${def.selectorRam || (kind === 'outer_player_dispatch_table' ? OUTER_TABLE.selectorRam : '_RAM_C260_')} and dispatches through this table using rst $20.`,
      'Pointer entries are stored as labels/offsets only; no ROM bytes are embedded.',
    ],
  };
}

function buildDataTable(mapData, asmIndex, def) {
  const region = findContainingRegion(mapData, def.offset);
  const line = asmIndex.labelLines.get(def.label) || null;
  return {
    label: def.label,
    offset: hex(def.offset),
    role: def.role,
    region: regionRef(region),
    entryCount: def.entryCount,
    entryStride: def.entryStride,
    usedBy: def.usedBy,
    summary: def.summary,
    evidence: [
      line ? `ASM line ${line}: ${def.label} data table starts at ${hex(def.offset)}.` : `${def.label} data table starts at ${hex(def.offset)}.`,
      ...def.evidence,
      'Catalog stores only table layout, offsets, and routine evidence; raw table bytes are not embedded.',
    ],
  };
}

function buildRoutine(mapData, asmIndex, def) {
  const offset = labelOffset(def.label);
  const region = offset == null ? null : findContainingRegion(mapData, offset);
  const scan = scanLabelBlock(asmIndex, def.label);
  return {
    label: def.label,
    offset: offset == null ? null : hex(offset),
    role: def.role,
    summary: def.summary,
    region: regionRef(region),
    asmLine: scan?.startLine || null,
    calls: scan?.calls || [],
    dataRefs: scan?.dataRefs || [],
    readsRAM: scan?.readsRAM || [],
    writesRAM: scan?.writesRAM || [],
    evidence: [
      scan?.startLine ? `ASM line ${scan.startLine}: ${def.label} routine entry.` : `${def.label} routine entry was not located in ASM index.`,
      def.summary,
    ],
  };
}

function buildRam(mapData, def) {
  const entry = findRamEntry(mapData, def.address);
  return {
    ...def,
    ram: ramRef(entry),
    evidence: [
      `${def.label} is referenced by the player dispatch/state routines cataloged in ${catalogId}.`,
      def.summary,
    ],
  };
}

function buildCatalog(mapData, asmText, romBytes) {
  const asmIndex = buildAsmIndex(asmText);
  const outerTable = buildPointerTable(mapData, romBytes, asmIndex, OUTER_TABLE, 'outer_player_dispatch_table');
  const innerTables = INNER_TABLES.map(def => buildPointerTable(mapData, romBytes, asmIndex, def, 'inner_player_state_dispatch_table'));
  const substateTable = buildPointerTable(mapData, romBytes, asmIndex, SUBSTATE_TABLE, 'player_vector_substate_dispatch_table');
  const dataTables = DATA_TABLES.map(def => buildDataTable(mapData, asmIndex, def));
  const routines = ROUTINES.map(def => buildRoutine(mapData, asmIndex, def));
  const ramVariables = RAM_ROLES.map(def => buildRam(mapData, def));
  const allTables = [outerTable, ...innerTables, substateTable];
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-player-state-audit.mjs',
    summary: {
      dispatchTables: allTables.length,
      dispatchEntries: allTables.reduce((sum, table) => sum + table.entryCount, 0),
      nullDispatchEntries: allTables.reduce((sum, table) => sum + table.entries.filter(entry => entry.isNull).length, 0),
      dataTables: dataTables.length,
      routines: routines.length,
      ramVariables: ramVariables.length,
      missingRegions: allTables.concat(dataTables, routines).filter(item => !item.region).length,
      missingRamEntries: ramVariables.filter(item => !item.ram).length,
      assetPolicy: 'Metadata only: ASM labels, ROM offsets, pointer targets, RAM addresses, routine references, and layout counts. No ROM bytes, decoded graphics, music, or gameplay assets are embedded.',
    },
    rootDispatcher: {
      label: OUTER_TABLE.callerLabel,
      selectorRam: OUTER_TABLE.selectorRam,
      selectorMask: OUTER_TABLE.selectorMask,
      tableLabel: OUTER_TABLE.label,
      summary: OUTER_TABLE.summary,
      evidence: [
        '_LABEL_4746_ loads _RAM_C24F_, masks with $07, and dispatches via rst $20 into _DATA_4770_.',
      ],
    },
    outerTable,
    innerTables,
    substateTable,
    dataTables,
    routines,
    ramVariables,
  };
}

function pointerTableSummary(table) {
  return `${table.label} is a ${table.entryCount}-entry ${table.kind.replaceAll('_', ' ')} indexed by ${table.selectorRam}.`;
}

function annotatePointerTableRegion(region, table) {
  const typeBefore = region.type || 'unknown';
  region.type = 'pointer_table';
  region.analysis = region.analysis || {};
  region.analysis.inferred = {
    kind: table.kind,
    summary: pointerTableSummary(table),
    confidence: 'high',
    tags: ['player-dispatch', 'jump-table'],
    relations: {
      calledBy: [table.callerLabel].filter(Boolean),
      entries: table.entries.map(entry => entry.targetLabel || (entry.isNull ? '$0000' : entry.z80Pointer)),
    },
    evidence: table.evidence,
  };
  region.analysis.playerStateAudit = {
    catalogId,
    kind: table.kind,
    summary: pointerTableSummary(table),
    confidence: 'high',
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type,
    changedType: typeBefore !== region.type,
    table: {
      label: table.label,
      offset: table.offset,
      selectorRam: table.selectorRam,
      selectorMask: table.selectorMask,
      entryCount: table.entryCount,
      nullEntries: table.entries.filter(entry => entry.isNull).length,
      targets: table.entries.map(entry => ({
        index: entry.index,
        targetLabel: entry.targetLabel,
        targetOffset: entry.targetRegion?.offset || null,
        isNull: entry.isNull,
      })),
    },
    evidence: table.evidence,
    generatedAt: now,
    tool: 'tools/world-player-state-audit.mjs',
  };
}

function annotateDataRegion(region, table) {
  const typeBefore = region.type || 'unknown';
  region.type = 'data_table';
  region.analysis = region.analysis || {};
  if (region.analysis.screenProgAudit) delete region.analysis.screenProgAudit;
  region.analysis.inferred = {
    kind: table.role,
    summary: table.summary,
    confidence: 'high',
    tags: ['player-state', 'data-table'],
    relations: {
      calledBy: table.usedBy,
      relatedRegions: table.usedBy,
    },
    evidence: table.evidence,
  };
  region.analysis.playerStateAudit = {
    catalogId,
    kind: table.role,
    summary: table.summary,
    confidence: 'high',
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type,
    changedType: typeBefore !== region.type,
    table: {
      label: table.label,
      offset: table.offset,
      entryCount: table.entryCount,
      entryStride: table.entryStride,
      usedBy: table.usedBy,
    },
    evidence: table.evidence,
    generatedAt: now,
    tool: 'tools/world-player-state-audit.mjs',
  };
}

function annotateRoutineRegion(region, routine) {
  region.analysis = region.analysis || {};
  region.analysis.playerStateAudit = {
    catalogId,
    kind: routine.role,
    summary: routine.summary,
    confidence: routine.role.endsWith('_candidate') ? 'medium' : 'high',
    label: routine.label,
    readsRAM: routine.readsRAM,
    writesRAM: routine.writesRAM,
    calls: routine.calls,
    dataRefs: routine.dataRefs,
    evidence: routine.evidence,
    generatedAt: now,
    tool: 'tools/world-player-state-audit.mjs',
  };
}

function annotateRamEntry(entry, ram) {
  entry.analysis = entry.analysis || {};
  entry.analysis.playerStateAudit = {
    catalogId,
    kind: ram.role,
    summary: ram.summary,
    confidence: ram.confidence,
    label: ram.label,
    evidence: ram.evidence,
    generatedAt: now,
    tool: 'tools/world-player-state-audit.mjs',
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const annotatedRegions = [];
  const annotatedRam = [];
  for (const table of [catalog.outerTable, ...catalog.innerTables, catalog.substateTable]) {
    if (!table.region) continue;
    const region = mapData.regions.find(item => item.id === table.region.id);
    if (!region) continue;
    const before = region.type || 'unknown';
    annotatePointerTableRegion(region, table);
    annotatedRegions.push({ id: region.id, offset: region.offset, label: table.label, kind: table.kind, typeBefore: before, typeAfter: region.type });
    if (before !== region.type) changedRegions.push({ id: region.id, offset: region.offset, label: table.label, typeBefore: before, typeAfter: region.type, kind: table.kind });
  }
  for (const table of catalog.dataTables) {
    if (!table.region) continue;
    const region = mapData.regions.find(item => item.id === table.region.id);
    if (!region) continue;
    const before = region.type || 'unknown';
    annotateDataRegion(region, table);
    annotatedRegions.push({ id: region.id, offset: region.offset, label: table.label, kind: table.role, typeBefore: before, typeAfter: region.type });
    if (before !== region.type) changedRegions.push({ id: region.id, offset: region.offset, label: table.label, typeBefore: before, typeAfter: region.type, kind: table.role });
  }
  for (const routine of catalog.routines) {
    if (!routine.region) continue;
    const region = mapData.regions.find(item => item.id === routine.region.id);
    if (!region) continue;
    annotateRoutineRegion(region, routine);
    annotatedRegions.push({ id: region.id, offset: region.offset, label: routine.label, kind: routine.role, typeBefore: region.type || 'unknown', typeAfter: region.type || 'unknown' });
  }
  for (const ram of catalog.ramVariables) {
    if (!ram.ram) continue;
    const entry = (mapData.ram || []).find(item => item.id === ram.ram.id);
    if (!entry) continue;
    annotateRamEntry(entry, ram);
    annotatedRam.push({ id: entry.id, address: entry.address, label: ram.label, kind: ram.role, confidence: ram.confidence });
  }
  return { changedRegions, annotatedRegions, annotatedRam };
}

function main() {
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const romBytes = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, asmText, romBytes);
  const annotation = apply
    ? annotateMap(mapData, catalog)
    : {
      changedRegions: [catalog.outerTable, ...catalog.innerTables, catalog.substateTable, ...catalog.dataTables]
        .filter(item => item.region && item.region.type !== (item.kind ? 'pointer_table' : 'data_table'))
        .map(item => ({ id: item.region.id, offset: item.region.offset, label: item.label, currentType: item.region.type, inferredType: item.kind ? 'pointer_table' : 'data_table' })),
      annotatedRegions: [],
      annotatedRam: [],
    };

  if (apply) {
    const finalCatalog = buildCatalog(mapData, asmText, romBytes);
    mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(catalogEntry => catalogEntry.id !== catalogId);
    mapData.playerCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_state_audit',
      generatedAt: now,
      tool: 'tools/world-player-state-audit.mjs --apply',
      schemaVersion: 1,
      summary: finalCatalog.summary,
      changedRegions: annotation.changedRegions,
      annotatedRegions: annotation.annotatedRegions,
      annotatedRam: annotation.annotatedRam,
      nextLeads: [
        'Trace _LABEL_1446_, _LABEL_1A36_, and _LABEL_19B6_ to split coordinate integration, acceleration, and collision flags into frame-level mechanics.',
        'Map the _RAM_C240_ player struct field layout so IX+ offsets used by the state handlers have stable names.',
        'Decode the _RAM_C271_ four-entry jump table at 0x21BC and connect it to _DATA_55C1_/_DATA_5674_ vector states.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    annotatedRegions: annotation.annotatedRegions,
    annotatedRam: annotation.annotatedRam,
  }, null, 2));
}

main();
