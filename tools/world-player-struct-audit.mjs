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
const catalogId = 'world-player-struct-catalog-2026-06-25';
const reportId = 'player-struct-audit-2026-06-25';

const PLAYER_STRUCT = {
  base: 0xC240,
  endInclusive: 0xC27F,
  size: 0x40,
  label: '_RAM_C240_',
  role: 'primary_player_state_struct',
  confidence: 'high',
  summary: 'Primary 64-byte player state struct. _LABEL_4746_ loads IX with _RAM_C240_ before shared player update/collision/state dispatch and many helpers address fields as IX+offset.',
  evidence: [
    'ASM line 10886 loads IX with _RAM_C240_ at the top-level player frame dispatcher _LABEL_4746_.',
    'ASM lines 10887-10901 read _RAM_C240_, run the player update pipeline, then dispatch through _DATA_4770_ using _RAM_C24F_.',
    'ASM RAM declarations reserve contiguous player fields from _RAM_C240_ through _RAM_C27F_ before the next actor/state block at _RAM_C280_.',
  ],
};

const FIELDS = [
  {
    address: 0xC240,
    size: 1,
    role: 'player_struct_flags',
    confidence: 'medium',
    summary: 'Primary player flags byte; bit 0 changes the _LABEL_4746_ frame dispatch path and collision helpers set/clear other IX+0 bits.',
    evidence: [
      'ASM line 10887 reads _RAM_C240_ and tests bit 0 before the normal player pipeline.',
      'ASM lines 5190-5220 and nearby collision helpers use IX/IY+0 flag bits while IX/IY point at actor/player structs.',
    ],
  },
  {
    address: 0xC241,
    size: 1,
    role: 'player_struct_state_flags',
    confidence: 'high',
    summary: 'Player state flag byte; state handlers and table indexes test and rewrite this byte.',
    evidence: [
      'ASM line 10922 reads _RAM_C241_ in the _LABEL_4746_ local state path.',
      'Existing player-state audit records _RAM_C241_ as player_state_flags.',
    ],
  },
  {
    address: 0xC243,
    size: 2,
    role: 'player_struct_coordinate_word_a',
    confidence: 'medium',
    summary: 'Player coordinate/state word candidate restored from the saved vector word at _RAM_C273_. Axis semantics still need frame tracing.',
    evidence: [
      'Existing player-state audit records _RAM_C243_ as a coordinate/state word restored from _RAM_C273_.',
      'ASM line 12853 stores _RAM_C273_ into _RAM_C243_ in a vector restore path.',
    ],
  },
  {
    address: 0xC246,
    size: 2,
    role: 'player_struct_coordinate_word_b',
    confidence: 'medium',
    summary: 'Player coordinate/state word candidate restored from the saved vector word at _RAM_C275_. Axis semantics still need frame tracing.',
    evidence: [
      'Existing player-state audit records _RAM_C246_ as a coordinate/state word restored from _RAM_C275_.',
      'ASM line 12855 stores _RAM_C275_ into _RAM_C246_ in a vector restore path.',
    ],
  },
  {
    address: 0xC248,
    size: 2,
    role: 'player_struct_motion_word_a',
    confidence: 'medium',
    summary: 'Player motion/velocity word candidate written by movement and knockback paths.',
    evidence: [
      'Existing player-state audit records _RAM_C248_ as a movement/velocity word written by state handlers.',
      'Existing gameplay lookup audit records _RAM_C248_ as the selected player knockback velocity word.',
    ],
  },
  {
    address: 0xC24A,
    size: 2,
    role: 'player_struct_motion_word_b',
    confidence: 'medium',
    summary: 'Second player motion/velocity word candidate written by jump/vector and knockback paths.',
    evidence: [
      'Existing player-state audit records _RAM_C24A_ as a movement/velocity word written by jump/vector state handlers.',
      'Existing gameplay lookup audit records _RAM_C24A_ as part of the player knockback velocity metadata.',
    ],
  },
  {
    address: 0xC24F,
    size: 1,
    role: 'player_struct_outer_form_state',
    confidence: 'high',
    summary: 'Outer player/form selector; _LABEL_4746_ masks it with $07 and dispatches through the six-entry _DATA_4770_ table.',
    evidence: [
      'ASM line 10901 starts the _DATA_4770_ jump table indexed by _RAM_C24F_.',
      'Existing player-state audit records _RAM_C24F_ as player_transformation_outer_state.',
    ],
  },
  {
    address: 0xC250,
    size: 1,
    role: 'player_struct_secondary_anim_delay',
    confidence: 'medium',
    summary: 'Delay/counter byte for the secondary animation/control stream handled by _LABEL_1392_.',
    evidence: [
      'ASM lines 3785-3793 read, decrement, and update _RAM_C250_ before loading the stream pointer from _RAM_C252_.',
    ],
  },
  {
    address: 0xC251,
    size: 1,
    role: 'player_struct_facing_direction',
    confidence: 'high',
    summary: 'Facing/direction selector combined with _RAM_C271_ by player vector state handlers.',
    evidence: [
      'Existing player-state audit records _RAM_C251_ as player_facing_direction.',
      'ASM lines 5800, 5836, 5875, and 5912 write _RAM_C251_ from vector substate decisions.',
    ],
  },
  {
    address: 0xC252,
    size: 2,
    role: 'player_struct_secondary_anim_stream_pointer',
    confidence: 'medium',
    summary: 'Pointer saved by _LABEL_1392_ while advancing the secondary animation/control stream.',
    evidence: [
      'ASM lines 3793 and 3821 load and store _RAM_C252_ as the stream pointer around _LABEL_1392_.',
    ],
  },
  {
    address: 0xC254,
    size: 4,
    role: 'player_struct_secondary_anim_frame_block_a',
    confidence: 'medium',
    summary: 'Four-byte block filled from the secondary stream when the high bit of the frame byte is set.',
    evidence: [
      'ASM lines 3811-3815 copy four bytes into _RAM_C254_ and four bytes into _RAM_C264_ from the stream path.',
    ],
  },
  {
    address: 0xC25C,
    size: 1,
    role: 'player_struct_damage_lookup_input',
    confidence: 'medium',
    summary: 'Input byte passed to _LABEL_1EC8_ in the player collision damage path.',
    evidence: [
      'Damage lookup audit records _RAM_C25C_ as player_damage_lookup_input.',
      'ASM lines 11348-11350 load _RAM_C25C_ before calling _LABEL_1EC8_.',
    ],
  },
  {
    address: 0xC25E,
    size: 1,
    role: 'player_struct_motion_parameter_low',
    confidence: 'medium',
    summary: 'Motion parameter byte written from facing direction and vector table outputs before movement helpers run.',
    evidence: [
      'Existing player-state audit records _RAM_C25E_ as player_motion_parameter.',
      'ASM lines 12843 and nearby vector-state code write _RAM_C25E_ from table/input decisions.',
    ],
  },
  {
    address: 0xC25F,
    size: 1,
    role: 'player_struct_motion_parameter_high',
    confidence: 'medium',
    summary: 'Second byte of the _DATA_5674_ selected pair used with _RAM_C25E_.',
    evidence: [
      'Existing player-state audit records _RAM_C25F_ as player_motion_parameter_pair_hi.',
      'ASM lines 12843-12845 write _RAM_C25E_ and _RAM_C25F_ together in vector-state code.',
    ],
  },
  {
    address: 0xC260,
    size: 1,
    role: 'player_struct_inner_state',
    confidence: 'high',
    summary: 'Inner player state selector; outer dispatchers mask it with $0F and jump through state tables.',
    evidence: [
      'Existing player-state audit records _RAM_C260_ as player_inner_state.',
      'ASM comments around lines 11426 and 12685 identify jump tables indexed by _RAM_C260_.',
    ],
  },
  {
    address: 0xC262,
    size: 2,
    role: 'player_struct_damage_lookup_result',
    confidence: 'medium',
    summary: 'Result word from the player collision damage lookup path.',
    evidence: [
      'Damage lookup audit records _RAM_C262_ as player_collision_damage_lookup_result.',
      'ASM lines 11348-11355 call _LABEL_1EC8_ and store HL into _RAM_C262_.',
    ],
  },
  {
    address: 0xC271,
    size: 1,
    role: 'player_struct_vector_substate',
    confidence: 'high',
    summary: 'Vector substate selector; _LABEL_21B6_ masks it with $03 and dispatches through _DATA_21BC_.',
    evidence: [
      'ASM lines 5759-5762 read _RAM_C271_ and dispatch through _DATA_21BC_.',
      'Existing player-state audit records _RAM_C271_ as player_substate_vector_index.',
    ],
  },
  {
    address: 0xC273,
    size: 2,
    role: 'player_struct_saved_coordinate_word_a',
    confidence: 'medium',
    summary: 'Saved/candidate coordinate word written by vector probe helpers and restored to _RAM_C243_.',
    evidence: [
      'ASM lines 5472-5473 store candidate HL/DE coordinates into _RAM_C273_ and _RAM_C275_.',
      'ASM line 12853 restores _RAM_C273_ to _RAM_C243_.',
    ],
  },
  {
    address: 0xC275,
    size: 2,
    role: 'player_struct_saved_coordinate_word_b',
    confidence: 'medium',
    summary: 'Saved/candidate coordinate word written by vector probe helpers and restored to _RAM_C246_.',
    evidence: [
      'ASM lines 5472-5473 store candidate HL/DE coordinates into _RAM_C273_ and _RAM_C275_.',
      'ASM line 12855 restores _RAM_C275_ to _RAM_C246_.',
    ],
  },
  {
    address: 0xC27F,
    size: 1,
    role: 'player_struct_update_latch_shared',
    confidence: 'medium',
    summary: 'Shared player update latch touched by animation/update paths; exact bit semantics still pending.',
    evidence: [
      'ASM lines 3829-3835 use _RAM_C27F_ while initializing the secondary animation/control stream.',
      'Existing player-state routines reference _RAM_C27F_ alongside player animation and state update helpers.',
    ],
  },
];

function hex(n, pad = 4) {
  return '$' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeAddress(address) {
  return String(address || '').toUpperCase().replace(/^0X/, '$');
}

function findRamEntry(mapData, address) {
  const normalized = hex(address);
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

function buildCatalog(mapData) {
  const fieldEntries = FIELDS.map(field => {
    const ramEntry = findRamEntry(mapData, field.address);
    return {
      ...field,
      address: hex(field.address),
      offsetInStruct: field.address - PLAYER_STRUCT.base,
      offsetInStructHex: hex(field.address - PLAYER_STRUCT.base, 2),
      ram: ramRef(ramEntry),
    };
  });
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-player-struct-audit.mjs',
    summary: {
      structBase: hex(PLAYER_STRUCT.base),
      structEndInclusive: hex(PLAYER_STRUCT.endInclusive),
      structSizeBytes: PLAYER_STRUCT.size,
      fieldCount: fieldEntries.length,
      fieldsWithRamEntries: fieldEntries.filter(field => field.ram).length,
      missingRamEntries: fieldEntries.filter(field => !field.ram).length,
      assetPolicy: 'Metadata only: RAM addresses, struct offsets, field roles, confidence, and ASM evidence. No ROM bytes or copyrighted assets are embedded.',
    },
    struct: {
      ...PLAYER_STRUCT,
      base: hex(PLAYER_STRUCT.base),
      endInclusive: hex(PLAYER_STRUCT.endInclusive),
    },
    fields: fieldEntries,
    evidence: PLAYER_STRUCT.evidence,
    openQuestions: [
      'Trace _RAM_C243_/_RAM_C246_ and _RAM_C248_/_RAM_C24A_ frame-by-frame to name exact X/Y and velocity axes.',
      'Split flag bytes _RAM_C240_/_RAM_C241_ into named bits only after each bit has a read/write behavioral trace.',
      'Confirm whether _RAM_C280_ is the secondary player/enemy actor struct before mirroring this field layout there.',
    ],
  };
}

function applyAnnotations(mapData, catalog) {
  const annotated = [];
  const missing = [];
  for (const field of catalog.fields) {
    const ramEntry = findRamEntry(mapData, parseInt(field.address.slice(1), 16));
    if (!ramEntry) {
      missing.push({ address: field.address, role: field.role });
      continue;
    }
    ramEntry.analysis = ramEntry.analysis || {};
    ramEntry.analysis.playerStructAudit = {
      catalogId,
      kind: field.role,
      confidence: field.confidence,
      structBase: catalog.struct.base,
      offsetInStruct: field.offsetInStruct,
      offsetInStructHex: field.offsetInStructHex,
      summary: field.summary,
      evidence: field.evidence,
      generatedAt: now,
      tool: 'tools/world-player-struct-audit.mjs',
    };
    annotated.push({
      address: ramEntry.address,
      id: ramEntry.id,
      role: field.role,
      confidence: field.confidence,
      offsetInStructHex: field.offsetInStructHex,
    });
  }
  return { annotated, missing };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = applyAnnotations(mapData, catalog);

  if (apply) {
    mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(item => item.id !== catalogId);
    mapData.playerCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_struct_audit',
      generatedAt: now,
      tool: 'tools/world-player-struct-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRamEntries: annotation.annotated.length,
        missingRamEntries: annotation.missing.length,
      },
      struct: catalog.struct,
      fields: catalog.fields,
      annotatedRamEntries: annotation.annotated,
      missingRamEntries: annotation.missing,
      nextLeads: catalog.openQuestions,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRamEntries: annotation.annotated,
    missingRamEntries: annotation.missing,
  }, null, 2));
}

main();
