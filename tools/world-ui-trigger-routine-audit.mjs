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
const catalogId = 'world-ui-trigger-routine-catalog-2026-06-25';
const reportId = 'ui-trigger-routine-audit-2026-06-25';
const toolName = 'tools/world-ui-trigger-routine-audit.mjs';

const ENTRIES = [
  {
    offset: 0x02324,
    label: '_LABEL_2324_',
    type: 'code',
    role: 'player_overlay_vdp_clear_and_refresh',
    name: '_LABEL_2324_ player overlay VDP clear/refresh',
    family: 'vdp_ui_helper',
    calls: ['_LABEL_115D_', '_LABEL_1004_', '_LABEL_98F_', '_LABEL_6E7_'],
    ramRefs: ['_DATA_23D1_', '_DATA_23E1_', '_RAM_C240_', '_RAM_C243_', '_RAM_C246_', '_RAM_C27F_', '_RAM_CF5B_', '_RAM_CF66_', '_RAM_CF82_', '_RAM_D0DE_', '_RAM_D0E0_'],
    summary: 'Draws a 4x4 overlay tile block near the player, clears a larger VDP name-table area over several frames, refreshes sprites, and updates player state flags.',
    evidence: ['_LABEL_2324_ writes VDP addresses/data through RST $28/RST $30, uses _DATA_23D1_ or _DATA_23E1_ as tile pairs, then calls _LABEL_6E7_ before changing _RAM_C240_ flags.'],
  },
  {
    offset: 0x034E2,
    label: '_LABEL_34E2_',
    type: 'code',
    role: 'vdp_tile_block_border_writer',
    name: '_LABEL_34E2_ VDP tile-block border writer',
    family: 'vdp_ui_helper',
    calls: ['_LABEL_359F_', '_LABEL_35A5_'],
    ramRefs: ['_RAM_CF82_', '_RAM_D0DE_', '_RAM_D0E0_', '_RAM_D0E2_'],
    summary: 'Writes a rectangular VDP tile-block frame from a 16-byte tile-pair descriptor, using BC as dimensions, DE as the name-table address, and HL as tile-pair source.',
    evidence: ['Multiple menu/status routines call _LABEL_34E2_ with BC dimensions, DE VDP name-table addresses, and _DATA_35AD_/_DATA_35BD_ tile descriptors.', '_LABEL_34E2_ stores BC/DE/HL in _RAM_D0DE_.._RAM_D0E2_, writes corners/edges through _LABEL_359F_/_LABEL_35A5_, then clears _RAM_CF82_.'],
  },
  {
    offset: 0x0359F,
    label: '_LABEL_359F_',
    type: 'code',
    role: 'vdp_address_then_tile_pair_write',
    name: '_LABEL_359F_ VDP address and tile-pair write helper',
    family: 'vdp_ui_helper',
    calls: ['_LABEL_35A5_'],
    ramRefs: [],
    summary: 'Writes the DE VDP address through RST $28, then falls through to write one tile/attribute pair from HL.',
    evidence: ['_LABEL_34E2_ calls _LABEL_359F_ for the first tile of each row/column segment.'],
  },
  {
    offset: 0x035A5,
    label: '_LABEL_35A5_',
    type: 'code',
    role: 'vdp_tile_pair_write',
    name: '_LABEL_35A5_ VDP tile-pair write helper',
    family: 'vdp_ui_helper',
    calls: [],
    ramRefs: [],
    summary: 'Writes two bytes from HL to VDP data through RST $30, used as the shared tile/attribute-pair output helper.',
    evidence: ['_LABEL_34E2_ and _LABEL_359F_ share _LABEL_35A5_ for tile-pair writes.'],
  },
  {
    offset: 0x035CD,
    label: '_LABEL_35CD_',
    type: 'code',
    role: 'tile_id_to_vdp_macro_writer',
    name: '_LABEL_35CD_ tile-id VDP macro writer',
    family: 'vdp_ui_helper',
    calls: ['_LABEL_2804_', '_LABEL_33FB_', '_LABEL_3698_'],
    ramRefs: ['_RAM_D0DE_', '_RAM_D0E0_', '_RAM_D0E2_', '_RAM_D0E3_'],
    summary: 'Converts a tile/object id into a small VDP macro stream and writes it through the _LABEL_33FB_ stream writer.',
    evidence: ['The inventory/status code calls _LABEL_35CD_ when a byte value needs to be expanded into VDP tile bytes.', '_LABEL_35CD_ indexes a tile table, prepares _RAM_D0DE_.._RAM_D0E3_, and jumps to _LABEL_33FB_.'],
  },
  {
    offset: 0x03655,
    label: '_LABEL_3655_',
    type: 'code',
    role: 'tile_id_to_table_macro_writer',
    name: '_LABEL_3655_ tile-id table macro writer',
    family: 'vdp_ui_helper',
    calls: [],
    ramRefs: ['_DATA_1C270_', '_RAM_D0DE_', '_RAM_D0E2_'],
    summary: 'Variant tile-id macro writer that indexes _DATA_1C270_ and prepares a VDP/table macro stream.',
    evidence: ['_LABEL_3655_ mirrors _LABEL_35CD_ structure but uses _DATA_1C270_ as the source table.'],
  },
  {
    offset: 0x04464,
    label: '_LABEL_4464_',
    type: 'code',
    role: 'transition_actor_slot_update',
    name: '_LABEL_4464_ transition actor slot updater',
    family: 'scripted_transition',
    calls: ['_LABEL_12D8_'],
    ramRefs: ['_RAM_C280_'],
    summary: 'Updates five 0x40-byte transition actor slots at _RAM_C280_ and clamps one coordinate state during the scripted transition.',
    evidence: ['_LABEL_4486_ and _LABEL_4548_ call _LABEL_4464_ while rendering transition frames and sprites.'],
  },
  {
    offset: 0x04486,
    label: '_LABEL_4486_',
    type: 'code',
    role: 'scripted_transition_controller',
    name: '_LABEL_4486_ scripted transition controller',
    family: 'scripted_transition',
    calls: ['_LABEL_107D_', '_LABEL_FEE_', '_LABEL_423A_', '_LABEL_8FB_', '_LABEL_849_', '_LABEL_104B_', '_LABEL_4586_', '_LABEL_43B8_', '_LABEL_4464_', '_LABEL_6E7_', '_LABEL_1004_', '_LABEL_4548_', '_LABEL_456F_', '_LABEL_822_'],
    ramRefs: ['_DATA_453D_', '_DATA_4537_', '_DATA_464B_', '_RAM_CF85_', '_RAM_CF8C_', '_RAM_CF8D_', '_RAM_CFE1_', '_RAM_D0FE_', '_RAM_D102_', '_RAM_D108_', '_RAM_C3C0_'],
    summary: 'Runs a scripted transition sequence: resets scroll/state, loads a VRAM tile recipe, interprets _DATA_464B_, spawns transition actors from _DATA_4537_, then plays several VDP stream IDs.',
    evidence: ['_LABEL_B3D3_ calls _LABEL_4486_ during a game-state transition.', '_LABEL_4486_ loads _DATA_453D_ through _LABEL_8FB_, stores _DATA_464B_ in _RAM_D102_, repeatedly calls _LABEL_4586_, and dispatches transition actor records through _LABEL_43B8_.'],
  },
  {
    offset: 0x04548,
    label: '_LABEL_4548_',
    type: 'code',
    role: 'transition_vdp_stream_runner',
    name: '_LABEL_4548_ transition VDP stream runner',
    family: 'scripted_transition',
    calls: ['_LABEL_456F_', '_LABEL_10BC_', '_LABEL_FEE_', '_LABEL_5EB_', '_LABEL_4464_', '_LABEL_6E7_'],
    ramRefs: ['_RAM_CF65_'],
    summary: 'Runs one transition VDP stream id while ticking palette/effect scripts, transition actors, and sprite output until _RAM_CF65_ reaches $FF.',
    evidence: ['_LABEL_4486_ calls _LABEL_4548_ for stream ids $11, $12, $13/$15, and $14.'],
  },
  {
    offset: 0x0456F,
    label: '_LABEL_456F_',
    type: 'code',
    role: 'transition_nametable_clear',
    name: '_LABEL_456F_ transition name-table clear',
    family: 'scripted_transition',
    calls: [],
    ramRefs: [],
    summary: 'Clears a 0x0100-word VDP name-table region at $7800 with tile $60/attribute $01 pairs.',
    evidence: ['_LABEL_4486_ and _LABEL_4548_ call _LABEL_456F_ before transition VDP streams are shown.'],
  },
  {
    offset: 0x04586,
    label: '_LABEL_4586_',
    type: 'code',
    role: 'transition_scroll_script_tick',
    name: '_LABEL_4586_ transition scroll script tick',
    family: 'scripted_transition',
    calls: ['_LABEL_FEE_'],
    ramRefs: ['_DATA_464B_', '_RAM_CF8C_', '_RAM_CF8D_', '_RAM_D007_', '_RAM_D008_', '_RAM_D0FE_'],
    summary: 'Interprets the transition movement script pointed to by _RAM_D0FE_+4/5, producing signed scroll deltas in _RAM_CF8C_/_RAM_CF8D_ over timed frames.',
    evidence: ['_LABEL_4486_ stores _DATA_464B_ in _RAM_D102_ and calls _LABEL_4586_ once per transition frame.', '_LABEL_4586_ reads script records, sets bit 7 in _RAM_D0FE_, updates _RAM_CF8C_/_RAM_CF8D_, and waits through _LABEL_FEE_.'],
  },
  {
    offset: 0x04746,
    label: '_LABEL_4746_',
    type: 'code',
    role: 'player_runtime_dispatch_entry',
    name: '_LABEL_4746_ player runtime dispatch entry',
    family: 'room_trigger_runtime',
    calls: ['_LABEL_47FE_', '_LABEL_4A08_', '_LABEL_4A42_', '_LABEL_13F6_', '_LABEL_4A5E_', '_LABEL_4B0E_', '_LABEL_4C28_'],
    ramRefs: ['_RAM_C240_', '_RAM_C24F_', '_RAM_CF89_'],
    summary: 'Main player runtime entry called from the gameplay loop; it scans room triggers, updates player state helpers, and dispatches form/state-specific handlers.',
    evidence: ['_LABEL_4BD_ calls _LABEL_4746_ before room entities and auxiliary schedulers.', '_LABEL_4746_ uses _RAM_C24F_ to dispatch through the player state table at _DATA_4770_.'],
  },
  {
    offset: 0x047FE,
    label: '_LABEL_47FE_',
    type: 'code',
    role: 'room_trigger_scan_entry',
    name: '_LABEL_47FE_ room trigger scan entry',
    family: 'room_trigger_runtime',
    calls: ['_LABEL_4816_'],
    ramRefs: ['_RAM_C241_', '_RAM_C270_', '_RAM_CF5E_', '_RAM_CF8B_', '_RAM_FFFF_'],
    summary: 'Prepares bank-4 room trigger scanning from the pointer in _RAM_CF5E_, preserving player flags and skipping scanning when _RAM_CF8B_ is active.',
    evidence: ['_LABEL_4746_ calls _LABEL_47FE_ at the start of normal player runtime updates.'],
  },
  {
    offset: 0x04816,
    label: '_LABEL_4816_',
    type: 'code',
    role: 'room_trigger_record_scanner',
    name: '_LABEL_4816_ room trigger record scanner',
    family: 'room_trigger_runtime',
    calls: ['_LABEL_48A9_'],
    ramRefs: ['_RAM_CF5E_', '_RAM_CF6A_', '_RAM_CF6B_', '_RAM_C243_', '_RAM_C246_', '_RAM_D0DE_', '_RAM_D0E0_', '_RAM_D0E1_', '_RAM_D0E2_', '_RAM_D0E3_'],
    summary: 'Scans trigger records from _RAM_CF5E_, performs player bounds checks, and dispatches matching trigger opcodes through _LABEL_48A9_.',
    evidence: ['_LABEL_4816_ terminates records at $FF, calculates trigger x/y extents against _RAM_C243_/_RAM_C246_, stores overlap depth in _RAM_D0E3_, and calls _LABEL_48A9_ for matched records.'],
  },
  {
    offset: 0x048A9,
    label: '_LABEL_48A9_',
    type: 'code',
    role: 'room_trigger_opcode_dispatcher',
    name: '_LABEL_48A9_ room trigger opcode dispatcher',
    family: 'room_trigger_runtime',
    calls: ['_LABEL_4903_', '_LABEL_492B_', '_LABEL_4942_', '_LABEL_4961_', '_LABEL_497A_', '_LABEL_4980_', '_LABEL_4988_', '_LABEL_4995_', '_LABEL_49A9_', '_LABEL_49AF_', '_LABEL_49F8_'],
    ramRefs: ['_DATA_48C5_', '_RAM_CFFA_', '_RAM_D0DE_', '_RAM_C27D_'],
    summary: 'Dispatches the current room trigger opcode through the 31-entry 0x48C5 table after storing the record pointer and target pointer in RAM.',
    evidence: ['_LABEL_48A9_ masks the trigger opcode with $1F and dispatches through _DATA_48C5_ with RST $20.'],
  },
  {
    offset: 0x048C5,
    label: '_DATA_48C5_',
    type: 'pointer_table',
    role: 'room_trigger_opcode_dispatch_table',
    name: '_DATA_48C5_ room trigger opcode dispatch table',
    family: 'room_trigger_table',
    calls: ['_LABEL_4903_', '_LABEL_492B_', '_LABEL_4942_', '_LABEL_4961_', '_LABEL_497A_', '_LABEL_4980_', '_LABEL_4988_', '_LABEL_4995_', '_LABEL_49A9_', '_LABEL_49AF_', '_LABEL_49D4_', '_LABEL_49DD_', '_LABEL_49E6_', '_LABEL_49EF_', '_LABEL_49F8_'],
    ramRefs: [],
    summary: 'Thirty-one-entry room trigger opcode table used by _LABEL_48A9_; this is pointer data, not executable code.',
    evidence: ['The ASM comments identify _DATA_48C5_ as a 31-entry jump table, and _LABEL_48A9_ dispatches to it with RST $20 after masking the opcode.'],
  },
  {
    offset: 0x04903,
    label: '_LABEL_4903_',
    type: 'code',
    role: 'room_trigger_room_load',
    name: '_LABEL_4903_ room trigger room-load handler',
    family: 'room_trigger_handler',
    calls: ['_LABEL_822_', '_LABEL_2620_', '_LABEL_6E7_', '_LABEL_849_'],
    ramRefs: ['_RAM_C26E_', '_RAM_CFFC_', '_RAM_CFE1_', '_RAM_CFFA_', '_RAM_FFFF_'],
    summary: 'Trigger handler that stores the trigger id, optionally marks a transition flag, loads a room through _LABEL_2620_, refreshes sprites, and returns to bank 2.',
    evidence: ['_DATA_48C5_ maps opcodes 0, 22-25 to _LABEL_4903_.'],
  },
  {
    offset: 0x0492B,
    label: '_LABEL_492B_',
    type: 'code',
    role: 'room_trigger_player_state_setter',
    name: '_LABEL_492B_ room trigger player-state setter',
    family: 'room_trigger_handler',
    calls: [],
    ramRefs: ['_RAM_C241_', '_RAM_C26C_', '_RAM_C26E_', '_RAM_D0E3_', '_RAM_D221_'],
    summary: 'Common trigger handler that records the trigger id, marks _RAM_C241_ bit 7, stores a pointer in _RAM_C26C_, and captures overlap depth in _RAM_D221_.',
    evidence: ['Many _DATA_48C5_ entries point directly to _LABEL_492B_ or branch to it after gate checks.'],
  },
  {
    offset: 0x04942,
    label: '_LABEL_4942_',
    type: 'code',
    role: 'room_trigger_d0a4_spawn_gate_a',
    name: '_LABEL_4942_ room trigger D0A4 spawn gate A',
    family: 'room_trigger_handler',
    calls: [],
    ramRefs: ['_RAM_C241_', '_RAM_C27D_', '_RAM_D0A4_', '_RAM_D0E3_', '_RAM_D222_', 'IX+48'],
    summary: 'Sets _RAM_C241_ bit 6, stores _RAM_D222_, and raises _RAM_D0A4_ when form/state gates permit the auxiliary pair scheduler.',
    evidence: ['_DATA_48C5_ entry 6 points to _LABEL_4942_, and _LABEL_61CE_ consumes _RAM_D0A4_ requests.'],
  },
  {
    offset: 0x04961,
    label: '_LABEL_4961_',
    type: 'code',
    role: 'room_trigger_d0a4_spawn_gate_b',
    name: '_LABEL_4961_ room trigger D0A4 spawn gate B',
    family: 'room_trigger_handler',
    calls: [],
    ramRefs: ['_RAM_C241_', '_RAM_D0A4_', '_RAM_D0E3_', '_RAM_D222_', 'IX+48'],
    summary: 'Alternate D0A4 trigger gate that sets _RAM_C241_ bit 5 and requests the auxiliary pair scheduler when allowed.',
    evidence: ['_DATA_48C5_ entry 7 points to _LABEL_4961_, and _LABEL_61CE_ consumes _RAM_D0A4_ requests.'],
  },
  {
    offset: 0x0497A,
    label: '_LABEL_497A_',
    type: 'code',
    role: 'room_trigger_cf6a_request_1',
    name: '_LABEL_497A_ room trigger CF6A request 1',
    family: 'room_trigger_handler',
    calls: [],
    ramRefs: ['_RAM_CF6A_'],
    summary: 'Trigger handler that sets _RAM_CF6A_ to request action 1.',
    evidence: ['_DATA_48C5_ entry 8 points to _LABEL_497A_.'],
  },
  {
    offset: 0x04980,
    label: '_LABEL_4980_',
    type: 'code',
    role: 'room_trigger_d000_gate',
    name: '_LABEL_4980_ room trigger D000 gate',
    family: 'room_trigger_handler',
    calls: ['_LABEL_492B_'],
    ramRefs: ['_RAM_D000_'],
    summary: 'Gate handler that only enters the common player-state setter when _RAM_D000_ is nonzero.',
    evidence: ['_DATA_48C5_ entries 9 and 10 point to _LABEL_4980_.'],
  },
  {
    offset: 0x04988,
    label: '_LABEL_4988_',
    type: 'code',
    role: 'room_trigger_cf49_gate',
    name: '_LABEL_4988_ room trigger CF49 gate',
    family: 'room_trigger_handler',
    calls: ['_LABEL_492B_'],
    ramRefs: ['_RAM_CF49_', '_RAM_CF5D_'],
    summary: 'Gate handler that requires a nonzero _RAM_CF49_ low seven-bit value, clears _RAM_CF5D_, and enters the common player-state setter.',
    evidence: ['_DATA_48C5_ entries 11 and 12 point to _LABEL_4988_.'],
  },
  {
    offset: 0x04995,
    label: '_LABEL_4995_',
    type: 'code',
    role: 'room_trigger_d1b0_script_start',
    name: '_LABEL_4995_ room trigger D1B0 script start',
    family: 'room_trigger_handler',
    calls: [],
    ramRefs: ['_RAM_D1B0_', '_RAM_D1B1_', '_RAM_D1BA_'],
    summary: 'Starts a one-shot script/request by reading a byte and pointer into _RAM_D1B0_/_RAM_D1B1_ and setting _RAM_D1BA_.',
    evidence: ['_DATA_48C5_ entry 16 points to _LABEL_4995_.'],
  },
  {
    offset: 0x049A9,
    label: '_LABEL_49A9_',
    type: 'code',
    role: 'room_trigger_cf6a_request_3',
    name: '_LABEL_49A9_ room trigger CF6A request 3',
    family: 'room_trigger_handler',
    calls: [],
    ramRefs: ['_RAM_CF6A_'],
    summary: 'Trigger handler that sets _RAM_CF6A_ to request action 3.',
    evidence: ['_DATA_48C5_ entry 17 points to _LABEL_49A9_.'],
  },
  {
    offset: 0x049AF,
    label: '_LABEL_49AF_',
    type: 'code',
    role: 'room_trigger_inventory_gate_1',
    name: '_LABEL_49AF_ room trigger inventory gate 1',
    family: 'room_trigger_handler',
    calls: ['_LABEL_492B_'],
    ramRefs: ['_RAM_CF49_', '_RAM_CF5C_', '_RAM_CF5D_'],
    summary: 'Inventory/flag gate handler that tests _RAM_CF5C_ bit 0 and either rewrites the trigger id or records _RAM_CF5D_ before entering the common setter.',
    evidence: ['_DATA_48C5_ entry 18 points to _LABEL_49AF_; nearby handlers _LABEL_49D4_/_LABEL_49DD_/_LABEL_49E6_ share the same branch tail for bits 1-3.'],
  },
  {
    offset: 0x049D4,
    label: '_LABEL_49D4_',
    type: 'code',
    role: 'room_trigger_inventory_gate_2',
    name: '_LABEL_49D4_ room trigger inventory gate 2',
    family: 'room_trigger_handler',
    calls: ['_LABEL_49AF_ tail'],
    ramRefs: ['_RAM_CF5C_', '_RAM_CF5D_'],
    summary: 'Inventory/flag gate variant using _RAM_CF5C_ bit 1 and CF5D value $02.',
    evidence: ['_DATA_48C5_ entry 19 points to _LABEL_49D4_, which falls into the shared gate logic at _LABEL_49AF_.'],
  },
  {
    offset: 0x049DD,
    label: '_LABEL_49DD_',
    type: 'code',
    role: 'room_trigger_inventory_gate_4',
    name: '_LABEL_49DD_ room trigger inventory gate 4',
    family: 'room_trigger_handler',
    calls: ['_LABEL_49AF_ tail'],
    ramRefs: ['_RAM_CF5C_', '_RAM_CF5D_'],
    summary: 'Inventory/flag gate variant using _RAM_CF5C_ bit 2 and CF5D value $04.',
    evidence: ['_DATA_48C5_ entry 20 points to _LABEL_49DD_, which falls into the shared gate logic at _LABEL_49AF_.'],
  },
  {
    offset: 0x049E6,
    label: '_LABEL_49E6_',
    type: 'code',
    role: 'room_trigger_inventory_gate_8',
    name: '_LABEL_49E6_ room trigger inventory gate 8',
    family: 'room_trigger_handler',
    calls: ['_LABEL_49AF_ tail'],
    ramRefs: ['_RAM_CF5C_', '_RAM_CF5D_'],
    summary: 'Inventory/flag gate variant using _RAM_CF5C_ bit 3 and CF5D value $08.',
    evidence: ['_DATA_48C5_ entry 21 points to _LABEL_49E6_, which falls into the shared gate logic at _LABEL_49AF_.'],
  },
  {
    offset: 0x049EF,
    label: '_LABEL_49EF_',
    type: 'code',
    role: 'room_trigger_money_gate',
    name: '_LABEL_49EF_ room trigger money gate',
    family: 'room_trigger_handler',
    calls: ['_LABEL_492B_'],
    ramRefs: ['_RAM_CF48_'],
    summary: 'Gate handler that requires _RAM_CF48_ to be at least $63 before entering the common player-state setter.',
    evidence: ['_DATA_48C5_ entry 28 points to _LABEL_49EF_.'],
  },
  {
    offset: 0x049F8,
    label: '_LABEL_49F8_',
    type: 'code',
    role: 'room_trigger_d246_request',
    name: '_LABEL_49F8_ room trigger D246 request',
    family: 'room_trigger_handler',
    calls: ['_LABEL_104B_'],
    ramRefs: ['_RAM_D246_'],
    summary: 'One-shot trigger handler that sets _RAM_D246_ and queues sound/effect $3B.',
    evidence: ['_DATA_48C5_ entry 29 points to _LABEL_49F8_.'],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
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

function wasInferredOnly(region) {
  if (!region) return false;
  const keys = Object.keys(region.analysis || {});
  return keys.length === 1 && keys[0] === 'inferred';
}

function wasInferredOnlyBeforeThisAudit(region) {
  const existing = region?.analysis?.uiTriggerRoutineAudit;
  if (existing?.catalogId === catalogId && typeof existing.wasInferredOnlyBeforeAudit === 'boolean') {
    return existing.wasInferredOnlyBeforeAudit;
  }
  return wasInferredOnly(region);
}

function shouldRetype(region, targetType) {
  if (!region || !targetType || region.type === targetType) return false;
  if (targetType === 'pointer_table') return ['code', 'data_table', 'unknown', 'raw_byte'].includes(region.type || 'unknown');
  return false;
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      entryCount: ENTRIES.length,
      vdpUiHelpers: ENTRIES.filter(entry => entry.family === 'vdp_ui_helper').length,
      scriptedTransitionEntries: ENTRIES.filter(entry => entry.family === 'scripted_transition').length,
      roomTriggerRuntimeEntries: ENTRIES.filter(entry => entry.family === 'room_trigger_runtime').length,
      roomTriggerHandlers: ENTRIES.filter(entry => entry.family === 'room_trigger_handler').length,
      dispatchTables: ENTRIES.filter(entry => entry.family === 'room_trigger_table').length,
      assetPolicy: 'Metadata only: ASM labels, offsets, routine roles, dispatch-table provenance, calls, RAM references, and evidence. No ROM bytes or decoded assets are embedded.',
    },
    entries: ENTRIES.map(entry => {
      const region = findExactRegion(mapData, entry.offset);
      return {
        offset: hex(entry.offset),
        label: entry.label,
        type: entry.type,
        role: entry.role,
        name: entry.name,
        family: entry.family,
        confidence: 'high',
        calls: entry.calls,
        ramRefs: entry.ramRefs,
        summary: entry.summary,
        evidence: entry.evidence,
        region: regionRef(region),
        wasInferredOnlyBeforeAudit: wasInferredOnlyBeforeThisAudit(region),
      };
    }),
  };
}

function annotateRegion(region, entry) {
  const typeBefore = region.type || 'unknown';
  const changedType = shouldRetype(region, entry.type);
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  if (changedType) region.type = entry.type;
  const previousName = region.name || '';
  if (!region.name || previousName.startsWith('Jump Table @') || previousName.startsWith('Data @')) {
    region.name = entry.name;
  }
  region.analysis = region.analysis || {};
  region.analysis.uiTriggerRoutineAudit = {
    catalogId,
    family: entry.family,
    role: entry.role,
    confidence: 'high',
    label: entry.label,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    calls: entry.calls,
    ramRefs: entry.ramRefs,
    summary: entry.summary,
    evidence: entry.evidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    label: entry.label,
    role: entry.role,
    family: entry.family,
    typeBefore,
    typeAfter: region.type || typeBefore,
    changedType,
    previousName,
    name: region.name || '',
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
  };
}

function applyAnnotations(mapData) {
  const annotated = [];
  const missing = [];
  for (const entry of ENTRIES) {
    const region = findExactRegion(mapData, entry.offset);
    if (!region) {
      missing.push({ offset: hex(entry.offset), label: entry.label, role: entry.role });
      continue;
    }
    annotated.push(annotateRegion(region, entry));
  }
  return { annotated, missing };
}

function annotatedRegionRefs(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.uiTriggerRoutineAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      role: region.analysis.uiTriggerRoutineAudit.role,
      family: region.analysis.uiTriggerRoutineAudit.family,
      confidence: region.analysis.uiTriggerRoutineAudit.confidence,
      changedType: region.analysis.uiTriggerRoutineAudit.changedType,
      wasInferredOnlyBeforeAudit: region.analysis.uiTriggerRoutineAudit.wasInferredOnlyBeforeAudit,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const changes = applyAnnotations(mapData);
  const catalog = buildCatalog(mapData);

  if (apply) {
    mapData.uiTransitionCatalogs = (mapData.uiTransitionCatalogs || []).filter(item => item.id !== catalogId);
    mapData.uiTransitionCatalogs.push(catalog);
    const annotatedRegions = annotatedRegionRefs(mapData);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'ui_trigger_routine_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
        missingRegions: changes.missing.length,
        inferredOnlyRegionsCovered: annotatedRegions.filter(region => region.wasInferredOnlyBeforeAudit).length,
        retypedTables: annotatedRegions.filter(region => region.changedType).length,
      },
      annotatedRegions,
      missingRegions: changes.missing,
      nextLeads: [
        'Trace the record format at _RAM_CF5E_ to formalize room trigger rectangles and opcodes as data structures.',
        'Connect _LABEL_4486_ transition sequence ids $11-$15 to screen/room state transitions by tracing callers and _RAM_CF85_.',
        'Model _LABEL_34E2_ as a reusable browser-side VDP tile-block writer for analyzer diagnostics.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: changes.annotated,
    missingRegions: changes.missing,
  }, null, 2));
}

main();
