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
const catalogId = 'world-player-runtime-routine-catalog-2026-06-25';
const reportId = 'player-runtime-routine-audit-2026-06-25';
const toolName = 'tools/world-player-runtime-routine-audit.mjs';

function entry(offset, label, role, name, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name,
    type: options.type || 'code',
    family: options.family || 'player_runtime',
    confidence: options.confidence || 'high',
    dispatchTable: options.dispatchTable || null,
    dispatchIndex: options.dispatchIndex ?? null,
    indexRam: options.indexRam || null,
    calls: options.calls || [],
    ramRefs: options.ramRefs || [],
    evidence: [
      `${label} is an ASM ${options.type === 'pointer_table' ? 'data' : 'code'} label at ROM offset ${hex(offset)}.`,
      ...(options.dispatchTable ? [`${options.dispatchTable} dispatches to ${label}${options.dispatchIndex == null ? '' : ` as entry ${options.dispatchIndex}`} using ${options.indexRam || 'an indexed state byte'}.`] : []),
      ...(options.evidence || []),
    ],
  };
}

const ENTRIES = [
  entry(0x04A08, '_LABEL_4A08_', 'player_special_state_timer_gate', '_LABEL_4A08_ player special-state timer gate', 'Counts sustained _RAM_D279_ input/state bits into IX+47 and forces player inner state 7 when the gate reaches 10 frames.', {
    calls: [],
    ramRefs: ['_RAM_D279_', '_RAM_C260_', '_RAM_C24F_', 'IX+1', 'IX+32', 'IX+47'],
    evidence: ['ASM lines 11268-11295 test IX+1, _RAM_D279_, _RAM_C260_, and _RAM_C24F_; otherwise IX+47 increments until IX+32 is set to $07.'],
  }),
  entry(0x04A42, '_LABEL_4A42_', 'player_timer_flag_decay', '_LABEL_4A42_ player timer flag decay', 'Decrements _RAM_C268_ while _RAM_C240_ bit 1 is set, then clears _RAM_C27E_ and that player-state bit when the timer expires.', {
    ramRefs: ['_RAM_C240_', '_RAM_C268_', '_RAM_C27E_'],
    evidence: ['ASM lines 11297-11313 show _RAM_C268_ as a countdown gated by _RAM_C240_ bit 1.'],
  }),
  entry(0x04A5E, '_LABEL_4A5E_', 'player_damage_and_recoil_gate', '_LABEL_4A5E_ player damage/recoil gate', 'Handles player damage/recoil flags, computes damage lookup results, queues sound/effect 0x12, and resets the inner state to 0.', {
    calls: ['_LABEL_4AEB_', '_LABEL_4AB6_', '_LABEL_1EC8_', '_LABEL_104B_'],
    ramRefs: ['_RAM_C27D_', '_RAM_C240_', '_RAM_C27E_', '_RAM_CF8B_', '_RAM_C262_', '_RAM_C25C_', 'IX+0', 'IX+32'],
    evidence: ['Existing damageLookupAudit records this routine as a damage lookup consumer; ASM lines 11315-11357 write _RAM_C262_ and set IX+32 to 0.'],
  }),
  entry(0x04AB6, '_LABEL_4AB6_', 'player_environment_recoil_check', '_LABEL_4AB6_ player environment recoil check', 'Applies a fixed recoil/damage word when player flags, form, and room/equipment conditions match.', {
    calls: ['_LABEL_104B_'],
    ramRefs: ['_RAM_C240_', '_RAM_C24F_', '_RAM_CF68_', '_RAM_C262_', 'IX+0', 'IX+1', 'IX+32'],
    evidence: ['ASM lines 11359-11386 test player flags and form-specific conditions, store $0060 in _RAM_C262_, set IX+0 bit 4, and queue sound/effect 0x12.'],
  }),
  entry(0x04AEB, '_LABEL_4AEB_', 'player_hit_pushback_adjust', '_LABEL_4AEB_ player hit pushback adjust', 'Clears _RAM_C240_ bit 3, plays a hit effect, and adjusts _RAM_C248_ horizontally when the player is not already in vector substate motion.', {
    calls: ['_LABEL_104B_'],
    ramRefs: ['_RAM_C240_', '_RAM_C271_', '_RAM_C248_', 'IX+17'],
    evidence: ['ASM lines 11388-11404 choose +/-0x0200 from IX+17 and add it to _RAM_C248_.'],
  }),
  entry(0x04B0E, '_LABEL_4B0E_', 'player_item_use_request_gate', '_LABEL_4B0E_ player item-use request gate', 'Detects an item/use input combination and copies the equipped item id into _RAM_D023_ for later handling.', {
    ramRefs: ['_RAM_C260_', '_RAM_CF95_', '_RAM_D279_', '_RAM_C271_', '_RAM_CF69_', '_RAM_D023_'],
    evidence: ['ASM lines 11406-11424 gate on nonzero _RAM_C260_, input bit 5, _RAM_D279_ bit 1, and _RAM_CF69_ before writing _RAM_D023_.'],
  }),
  entry(0x04B31, '_LABEL_4B31_', 'player_damage_knockback_setup', '_LABEL_4B31_ player damage knockback setup', 'Initializes damage knockback state, selects velocity data from _DATA_4BF8_, and then runs common movement/contact update code.', {
    dispatchTable: 'inner player state tables',
    dispatchIndex: 0,
    indexRam: '_RAM_C260_',
    calls: ['_LABEL_2506_', '_LABEL_137C_', '_LABEL_1446_', '_LABEL_1AB6_', '_LABEL_19B6_', '_LABEL_242B_', '_LABEL_2B73_', '_LABEL_38AD_', '_LABEL_24DE_'],
    ramRefs: ['_RAM_C260_', '_RAM_C262_', '_RAM_C26A_', '_RAM_C268_', '_RAM_C261_', '_RAM_C24A_', '_RAM_C24F_', '_RAM_C241_', '_RAM_C248_', '_RAM_C300_', '_RAM_CF52_', '_RAM_CF4A_', '_RAM_D275_', '_RAM_CF68_', '_RAM_CF3D_', '_RAM_CF8B_', '_RAM_D1AF_', '_RAM_C240_'],
    evidence: ['Existing gameplayLookupDataAudit identifies _DATA_4BF8_ as the player knockback velocity table consumed here.', 'ASM lines 11426-11523 initialize state flags and transition out through _LABEL_4BD7_ or _RAM_C240_=$83.'],
  }),
  entry(0x04B9D, '_LABEL_4B9D_', 'player_damage_knockback_update', '_LABEL_4B9D_ player damage knockback active update', 'Active update continuation for _LABEL_4B31_; runs collision/motion helpers until the knockback timer expires.', {
    calls: ['_LABEL_1446_', '_LABEL_1AB6_', '_LABEL_19B6_', '_LABEL_242B_', '_LABEL_2B73_', '_LABEL_38AD_', '_LABEL_24DE_'],
    ramRefs: ['_RAM_C261_', '_RAM_CF52_', '_RAM_CF4A_', '_RAM_D275_', '_RAM_CF68_', '_RAM_CF3D_', '_RAM_CF8B_', '_RAM_D1AF_', '_RAM_C260_', '_RAM_C240_'],
    evidence: ['ASM lines 11474-11523 are the post-initialization path for _LABEL_4B31_.'],
  }),
  entry(0x04BD7, '_LABEL_4BD7_', 'player_damage_knockback_end', '_LABEL_4BD7_ player damage knockback end', 'Ends the damage knockback branch by setting _RAM_C260_ to $83.', {
    ramRefs: ['_RAM_C260_'],
    evidence: ['ASM lines 11504-11507 store $83 in _RAM_C260_ and return.'],
  }),
  entry(0x04C28, '_LABEL_4C28_', 'player_transition_delay_decay', '_LABEL_4C28_ player transition delay decay', 'Decrements _RAM_C27D_ when nonzero.', {
    ramRefs: ['_RAM_C27D_'],
    evidence: ['ASM lines 11535-11541 show this as a simple nonzero countdown helper.'],
  }),
  entry(0x04C32, '_LABEL_4C32_', 'room_transition_state_handler', '_LABEL_4C32_ room transition state handler', 'Handles room transition positioning, item/key side effects, and dispatches a 30-entry transition opcode table selected by _RAM_C26E_.', {
    dispatchTable: 'inner player state tables',
    dispatchIndex: 7,
    indexRam: '_RAM_C260_',
    calls: ['_LABEL_104B_', '_LABEL_1004_', '_LABEL_1C5C_', '_LABEL_20_', '_DATA_4CAD_'],
    ramRefs: ['_RAM_C260_', 'IX+48', 'IX+49', '_RAM_C243_', '_RAM_D221_', '_RAM_C246_', '_RAM_C26E_', '_RAM_CF49_', '_RAM_CF5C_', '_RAM_CF5D_'],
    evidence: ['ASM lines 11543-11613 align player coordinates, process side effects, and RST $20 through _DATA_4CAD_ after masking _RAM_C26E_.'],
  }),
  entry(0x04CAD, '_DATA_4CAD_', 'room_transition_opcode_jump_table', '_DATA_4CAD_ room transition opcode jump table', 'Thirty-entry jump table selected from _RAM_C26E_ by _LABEL_4C32_; this is pointer data, not executable code.', {
    type: 'pointer_table',
    family: 'player_runtime_table',
    calls: ['_LABEL_4CED_', '_LABEL_4D72_', '_LABEL_4E05_', '_LABEL_4E49_', '_LABEL_4E25_', '_LABEL_4D08_', '_LABEL_4D3A_', '_LABEL_4EA7_', '_LABEL_4CE9_', '_LABEL_4EB0_'],
    ramRefs: ['_RAM_C26E_'],
    evidence: ['ASM lines 11608-11613 identify _DATA_4CAD_ as a 30-entry jump table indexed by _RAM_C26E_.'],
  }),
  entry(0x04CE9, '_LABEL_4CE9_', 'room_transition_clear_form_stage', '_LABEL_4CE9_ room transition clear form stage', 'Clears _RAM_CF5B_ and falls into the standard room-load transition handler.', {
    dispatchTable: '_DATA_4CAD_',
    dispatchIndex: 27,
    indexRam: '_RAM_C26E_',
    calls: ['_LABEL_4CED_'],
    ramRefs: ['_RAM_CF5B_'],
    evidence: ['ASM lines 11615-11620 show entry 27 clearing _RAM_CF5B_ before falling into _LABEL_4CED_.'],
  }),
  entry(0x04CED, '_LABEL_4CED_', 'room_transition_load_current_room', '_LABEL_4CED_ room transition load current room', 'Standard room transition handler: fades/clears, reloads player animation state, loads the room at _RAM_C26C_, and refreshes display.', {
    dispatchTable: '_DATA_4CAD_',
    calls: ['_LABEL_822_', '_LABEL_137C_', '_LABEL_1F28_', '_LABEL_2620_', '_LABEL_849_'],
    ramRefs: ['_RAM_C251_', '_RAM_C26C_', '_RAM_CFE1_'],
    evidence: ['ASM lines 11620-11630 call _LABEL_2620_ with _RAM_C26C_ and set _RAM_CFE1_.'],
  }),
  entry(0x04D08, '_LABEL_4D08_', 'room_transition_wait_for_script', '_LABEL_4D08_ room transition wait for script', 'Loads a room, waits for _RAM_C237_ script completion, restores animation/player state, and returns.', {
    dispatchTable: '_DATA_4CAD_',
    calls: ['_LABEL_822_', '_LABEL_2620_', '_LABEL_849_', '_LABEL_1C5C_', '_LABEL_104B_', '_LABEL_FF9_', '_LABEL_137C_', '_LABEL_1F28_'],
    ramRefs: ['_RAM_CFFC_', '_RAM_C26C_', '_RAM_CFE1_', '_RAM_C237_', '_RAM_CFF9_', '_RAM_C251_'],
    evidence: ['ASM lines 11633-11653 wait until _RAM_C237_ clears after _LABEL_1C5C_, then restore state through _LABEL_137C_/_LABEL_1F28_.'],
  }),
  entry(0x04D3A, '_LABEL_4D3A_', 'room_transition_position_restore', '_LABEL_4D3A_ room transition position restore', 'Reads a room transition coordinate record from _RAM_C26C_, writes player position/motion fields, and restores animation state.', {
    dispatchTable: '_DATA_4CAD_',
    calls: ['_LABEL_1C5C_', '_LABEL_FF9_', '_LABEL_137C_', '_LABEL_1F28_'],
    ramRefs: ['_RAM_FFFF_', '_RAM_C26C_', '_RAM_C243_', '_RAM_C246_', 'IX+1', '_RAM_C242_', '_RAM_C245_', '_RAM_C247_', '_RAM_C248_', '_RAM_C24A_', '_RAM_C251_'],
    evidence: ['ASM lines 11656-11677 read a word/byte record, reset motion words, and refresh player state.'],
  }),
  entry(0x04D72, '_LABEL_4D72_', 'room_transition_equipment_menu', '_LABEL_4D72_ room transition equipment menu', 'Runs the equipment selection menu from a room transition, using _LABEL_4D98_ setup and _LABEL_4DBA_ restore.', {
    dispatchTable: '_DATA_4CAD_',
    calls: ['_LABEL_822_', '_LABEL_4D98_', '_LABEL_27D6_', '_LABEL_3105_', '_LABEL_4DBA_', '_LABEL_849_', '_LABEL_104B_'],
    ramRefs: ['_RAM_CFFC_', '_RAM_FFFF_', '_RAM_C26C_', '_RAM_CFF9_'],
    evidence: ['ASM lines 11680-11694 capture display context, run _LABEL_3105_ with _RAM_C26C_, restore the room context, and play the return effect.'],
  }),
  entry(0x04D98, '_LABEL_4D98_', 'room_transition_menu_context_capture', '_LABEL_4D98_ room transition menu context capture', 'Captures CFF5/CFF7 display pointers into _RAM_CFF1_, resets display state, and plays menu-open effect 0x0B.', {
    calls: ['_LABEL_5B6_', '_LABEL_DB5_', '_LABEL_104B_'],
    ramRefs: ['_RAM_CFF1_', '_RAM_CFF5_', '_RAM_CFF7_'],
    evidence: ['ASM lines 11696-11708 copy CFF5/CFF7 into _RAM_CFF1_, call display reset helpers, and queue effect 0x0B.'],
  }),
  entry(0x04DBA, '_LABEL_4DBA_', 'room_transition_menu_context_restore', '_LABEL_4DBA_ room transition menu context restore', 'Restores room display/player context after a nested menu or password screen.', {
    calls: ['_LABEL_8FB_', '_LABEL_8B2_', '_LABEL_FA1_', '_LABEL_E83_', '_LABEL_10BC_', '_LABEL_137C_', '_LABEL_1F28_', '_LABEL_6E7_'],
    ramRefs: ['_RAM_C248_', '_RAM_C24A_', '_RAM_CFF1_', '_RAM_FFFF_', '_RAM_D006_', '_RAM_CF65_', '_RAM_C251_', '_RAM_CFE1_'],
    evidence: ['ASM lines 11710-11736 replay _DATA_2A55_, restore CFF1 pointers, run scroll/palette helpers, refresh player state, and set _RAM_CFE1_.'],
  }),
  entry(0x04E05, '_LABEL_4E05_', 'room_transition_shop_purchase_menu', '_LABEL_4E05_ room transition shop/purchase menu', 'Runs the shop purchase screen from a room transition and restores room context afterward.', {
    dispatchTable: '_DATA_4CAD_',
    calls: ['_LABEL_822_', '_LABEL_4D98_', '_LABEL_383B_', '_LABEL_4DBA_', '_LABEL_849_', '_LABEL_104B_'],
    ramRefs: ['_RAM_CFFC_', '_RAM_FFFF_', '_RAM_CFF9_'],
    evidence: ['ASM lines 11739-11751 call _LABEL_383B_ between the common menu context capture/restore helpers.'],
  }),
  entry(0x04E25, '_LABEL_4E25_', 'room_transition_password_menu', '_LABEL_4E25_ room transition password menu', 'Runs the password display/entry screen from a room transition, clears _RAM_CF86_, and restores room context afterward.', {
    dispatchTable: '_DATA_4CAD_',
    calls: ['_LABEL_822_', '_LABEL_4D98_', '_LABEL_3ACF_', '_LABEL_4DBA_', '_LABEL_849_', '_LABEL_104B_'],
    ramRefs: ['_RAM_CFFC_', '_RAM_FFFF_', '_RAM_CF86_', '_RAM_CFF9_'],
    evidence: ['ASM lines 11754-11768 call _LABEL_3ACF_ between the common menu context capture/restore helpers.'],
  }),
  entry(0x04E49, '_LABEL_4E49_', 'room_transition_form_stage_or_room_load', '_LABEL_4E49_ room transition form-stage/room-load handler', 'Consumes a room transition byte from _RAM_C26C_; either requests bank-2 form transition via _RAM_CF6A_ or skips ahead and loads the next room.', {
    dispatchTable: '_DATA_4CAD_',
    calls: ['_LABEL_104B_', '_LABEL_822_', '_LABEL_2620_', '_LABEL_849_', '_LABEL_1C5C_', '_LABEL_FF9_', '_LABEL_137C_', '_LABEL_1F28_'],
    ramRefs: ['_RAM_FFFF_', '_RAM_C26C_', '_RAM_CF5B_', '_RAM_D1AE_', '_RAM_D1AF_', '_RAM_CF6A_', '_RAM_CFE1_', '_RAM_C237_', '_RAM_CFF9_', '_RAM_C251_'],
    evidence: ['ASM lines 11771-11816 branch between setting _RAM_D1AE_/_RAM_D1AF_/_RAM_CF6A_ and loading a follow-up room through _LABEL_2620_.'],
  }),
  entry(0x04EA7, '_LABEL_4EA7_', 'room_transition_overlay_done_flag', '_LABEL_4EA7_ room transition overlay done flag', 'Runs the player overlay helper and sets _RAM_D245_ to signal completion.', {
    dispatchTable: '_DATA_4CAD_',
    calls: ['_LABEL_2324_'],
    ramRefs: ['_RAM_D245_'],
    evidence: ['ASM lines 11818-11823 call _LABEL_2324_ and write _RAM_D245_=1.'],
  }),
  entry(0x04EB0, '_LABEL_4EB0_', 'room_transition_overlay_delay_then_wait', '_LABEL_4EB0_ room transition overlay delay then script wait', 'Runs the player overlay helper, delays 16 frames, then jumps into the script-wait transition handler.', {
    dispatchTable: '_DATA_4CAD_',
    calls: ['_LABEL_2324_', '_LABEL_1004_', '_LABEL_4D08_'],
    evidence: ['ASM lines 11825-11832 call _LABEL_2324_, delay B=$10 frames, and jump to _LABEL_4D08_.'],
  }),
  entry(0x04EBD, '_LABEL_4EBD_', 'player_state_airborne_entry', '_LABEL_4EBD_ player airborne/control state entry', 'Initializes and updates the shared airborne/control state used by several player forms.', {
    dispatchTable: 'inner player state tables',
    dispatchIndex: 5,
    indexRam: '_RAM_C260_',
    calls: ['_LABEL_137C_', '_LABEL_104B_', '_LABEL_1392_', '_LABEL_1446_', '_LABEL_502D_', '_LABEL_1AB6_', '_LABEL_1AFF_', '_LABEL_19B6_'],
    ramRefs: ['_RAM_C260_', 'IX+1', 'IX+33', '_RAM_C251_', '_RAM_C24F_', '_RAM_D024_', '_RAM_CF66_', '_RAM_CF91_', '_RAM_C241_', '_RAM_C27D_', '_RAM_C250_', 'IX+27', '_RAM_CF95_', '_RAM_D279_'],
    evidence: ['ASM lines 11835-11966 initialize the state on first entry and then branch based on contact, input, and form-specific conditions.'],
  }),
  entry(0x04F0E, '_LABEL_4F0E_', 'player_state_airborne_update', '_LABEL_4F0E_ player airborne/control active update', 'Active-update continuation of _LABEL_4EBD_ that runs animation, collision/movement helpers, and input-driven state transitions.', {
    calls: ['_LABEL_1392_', '_LABEL_1446_', '_LABEL_502D_', '_LABEL_1AB6_', '_LABEL_1AFF_', '_LABEL_19B6_', '_LABEL_137C_'],
    ramRefs: ['_RAM_C27D_', '_RAM_C24F_', '_RAM_C241_', 'IX+1', '_RAM_C250_', 'IX+27', '_RAM_CF95_', '_RAM_C260_', '_RAM_D279_', '_RAM_C251_'],
    evidence: ['ASM lines 11875-11966 are the active path reached after _LABEL_4EBD_ has set bit 7 in _RAM_C260_.'],
  }),
  entry(0x04F9B, '_LABEL_4F9B_', 'player_state_airborne_contact_flag_update', '_LABEL_4F9B_ player airborne contact-flag update', 'Updates IX+1 bit 4 based on IX+27 contact bit 0 during the airborne/control state.', {
    ramRefs: ['IX+27', 'IX+1'],
    evidence: ['ASM lines 11958-11966 set or reset IX+1 bit 4 from IX+27 bit 0.'],
  }),
  entry(0x04FAB, '_LABEL_4FAB_', 'player_state_extra_vector_entry_a', '_LABEL_4FAB_ player extra vector state A', 'Extra state handler used by player outer dispatchers 0/1; initializes animation, runs movement/contact helpers, and returns to state 1/3/4/83 based on input.', {
    dispatchTable: '_DATA_5069_/_DATA_5081_',
    dispatchIndex: 8,
    indexRam: '_RAM_C260_',
    calls: ['_LABEL_137C_', '_LABEL_104B_', '_LABEL_1392_', '_LABEL_1446_', '_LABEL_502D_', '_LABEL_1AB6_', '_LABEL_19B6_'],
    ramRefs: ['_RAM_C260_', 'IX+1', 'IX+33', '_RAM_C251_', '_RAM_C24F_', '_RAM_D024_', '_RAM_C250_', 'IX+27', '_RAM_CF95_', '_RAM_D279_'],
    evidence: ['ASM lines 11968-12035 are an extra state-8 handler in _DATA_5069_ and _DATA_5081_.'],
  }),
  entry(0x0502D, '_LABEL_502D_', 'player_tile_interaction_probe', '_LABEL_502D_ player tile-interaction probe', 'When the player form allows it and IX+36/37 are nonzero, offsets player coordinates by IX+38/39 and calls _LABEL_118D_ to update the map tile/interact state.', {
    calls: ['_LABEL_118D_'],
    ramRefs: ['_RAM_C24F_', 'IX+36', 'IX+37', 'IX+3', 'IX+4', 'IX+38', 'IX+6', 'IX+7', 'IX+39'],
    evidence: ['ASM lines 12037-12066 build offset HL/DE coordinate pairs and call _LABEL_118D_.'],
  }),
  entry(0x054CB, '_LABEL_54CB_', 'player_state_vector_jump_entry', '_LABEL_54CB_ player vector jump state entry', 'Initializes a vector/jump state, indexes _DATA_55C1_ by _RAM_C271_ and flag bits, stores a motion word, and enters _LABEL_5515_ active update.', {
    dispatchTable: '_DATA_5099_',
    dispatchIndex: 3,
    indexRam: '_RAM_C260_',
    calls: ['_LABEL_137C_', '_LABEL_104B_', '_LABEL_5515_'],
    ramRefs: ['_RAM_C260_', 'IX+1', '_RAM_C251_', '_RAM_C271_', '_RAM_C241_', '_RAM_C248_', '_RAM_C24A_', 'IX+49'],
    evidence: ['Existing playerStateAudit identifies _DATA_55C1_ as the table consumed here; ASM lines 12686-12723 show the table index and motion-word store.'],
  }),
  entry(0x05515, '_LABEL_5515_', 'player_state_vector_jump_update', '_LABEL_5515_ player vector jump active update', 'Active-update continuation of _LABEL_54CB_; runs collision/movement, uses _LABEL_1F3E_ to switch vector substate, and handles input-driven transitions.', {
    calls: ['_LABEL_1392_', '_LABEL_1446_', '_LABEL_1F3E_', '_LABEL_19B6_', '_LABEL_1AB6_', '_LABEL_137C_', '_LABEL_1A36_'],
    ramRefs: ['IX+1', 'IX+27', '_RAM_D279_', '_RAM_C272_', '_RAM_C271_', 'IX+32', 'IX+49', '_RAM_CF95_', '_RAM_C260_', '_RAM_C251_', '_RAM_C25E_'],
    evidence: ['ASM lines 12724-12819 are the active path reached after _LABEL_54CB_ sets bit 7 in _RAM_C260_.'],
  }),
  entry(0x05650, '_LABEL_5650_', 'player_vector_transition_update_tail', '_LABEL_5650_ player vector transition update tail', 'Shared tail for _LABEL_55C9_ and _LABEL_5611_; runs collision/vector update and lets input switch back to state 3 or state 8.', {
    calls: ['_LABEL_1446_', '_LABEL_21B6_'],
    ramRefs: ['_RAM_C260_', '_RAM_CF95_'],
    evidence: ['ASM lines 12893-12916 call _LABEL_1446_ and _LABEL_21B6_, then test _RAM_CF95_ bits 5/4 to set _RAM_C260_.'],
  }),
  entry(0x05684, '_LABEL_5684_', 'player_state_vector_extra_update', '_LABEL_5684_ player vector extra update', 'Extra vector state handler in _DATA_5099_ that animates, probes tile interactions, runs vector substate updates, and eventually returns to state 6.', {
    dispatchTable: '_DATA_5099_',
    dispatchIndex: 8,
    indexRam: '_RAM_C260_',
    calls: ['_LABEL_137C_', '_LABEL_104B_', '_LABEL_1392_', '_LABEL_1446_', '_LABEL_502D_', '_LABEL_21B6_'],
    ramRefs: ['_RAM_C260_', 'IX+1', 'IX+33', '_RAM_C251_', '_RAM_C271_', '_RAM_C250_', '_RAM_CF95_', '_RAM_D279_'],
    evidence: ['ASM lines 12922-12983 initialize state $88, call the shared update helpers, and return to state 6 on input or timeout.'],
  }),
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
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

function wasInferredOnlyBeforeThisAudit(region) {
  if (!region) return false;
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'playerRuntimeRoutineAudit');
  return keys.length === 1 && keys[0] === 'inferred';
}

function shouldRetype(region, targetType) {
  if (!region || !targetType) return false;
  const current = region.type || 'unknown';
  if (current === targetType) return false;
  if (targetType === 'pointer_table') return ['code', 'data_table', 'unknown'].includes(current);
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
      routineCount: ENTRIES.filter(item => item.type === 'code').length,
      jumpTableCount: ENTRIES.filter(item => item.type === 'pointer_table').length,
      assetPolicy: 'Metadata only: ASM labels, offsets, routine roles, dispatch tables, calls, RAM references, and evidence. No ROM bytes or decoded assets are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    evidence: [
      'ASM lines 11268-11523 show player timers, damage/recoil gates, item-use request gating, and knockback setup/update.',
      'ASM lines 11543-11832 show _LABEL_4C32_ dispatching room-transition opcodes through _DATA_4CAD_.',
      'ASM lines 11835-12983 show active player inner-state handlers and shared vector transition tails.',
      'Existing player-state, player-form, damage-lookup, and gameplay-lookup audits provide companion table/RAM evidence for this runtime cluster.',
    ],
  };
}

function annotateRegion(region, item) {
  const typeBefore = region.type || 'unknown';
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  const changedType = shouldRetype(region, item.type);
  if (changedType) region.type = item.type;
  if (item.name && (!region.name || region.name.startsWith('Jump Table @'))) region.name = item.name;
  if (item.summary && !region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.playerRuntimeRoutineAudit = {
    catalogId,
    kind: item.role,
    family: item.family,
    label: item.label,
    confidence: item.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    dispatchTable: item.dispatchTable,
    dispatchIndex: item.dispatchIndex,
    indexRam: item.indexRam,
    calls: item.calls,
    ramRefs: item.ramRefs,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    label: item.label,
    role: item.role,
    confidence: item.confidence,
    typeBefore,
    typeAfter: region.type || typeBefore,
    changedType,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
  };
}

function applyAnnotations(mapData) {
  const annotated = [];
  const missing = [];
  for (const item of ENTRIES) {
    const region = findExactRegion(mapData, item.offset);
    if (!region) {
      missing.push({ offset: hex(item.offset), label: item.label, role: item.role });
      continue;
    }
    annotated.push(annotateRegion(region, item));
  }
  return { annotated, missing };
}

function main() {
  const mapData = readJson(mapPath);
  let changes = { annotated: [], missing: [] };

  if (apply) {
    changes = applyAnnotations(mapData);
    const finalCatalog = buildCatalog(mapData);
    mapData.playerRuntimeCatalogs = (mapData.playerRuntimeCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.playerRuntimeCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_runtime_routine_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: changes.annotated.length,
        missingRegions: changes.missing.length,
        inferredOnlyRegionsCovered: changes.annotated.filter(change => change.wasInferredOnlyBeforeAudit).length,
        retypedTables: changes.annotated.filter(change => change.changedType && change.typeAfter === 'pointer_table').length,
      },
      annotatedRegions: changes.annotated,
      missingRegions: changes.missing,
      nextLeads: [
        'Trace _RAM_C260_ state transitions into a state graph grouped by _RAM_C24F_ form dispatcher.',
        'Resolve exact axis semantics for _RAM_C248_/_RAM_C24A_/_RAM_C25E_/_RAM_C25F_ by following _LABEL_19B6_, _LABEL_1A36_, _LABEL_1AB6_, and _LABEL_1AFF_.',
        'Model _DATA_4CAD_ room-transition opcodes as structured transition records tied back to room trigger handlers.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  const catalog = buildCatalog(apply ? readJson(mapPath) : mapData);
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: changes.annotated.length,
      missingRegions: changes.missing.length,
      inferredOnlyRegionsCovered: changes.annotated.filter(change => change.wasInferredOnlyBeforeAudit).length,
      retypedTables: changes.annotated.filter(change => change.changedType && change.typeAfter === 'pointer_table').length,
    },
    missingRegions: changes.missing,
  }, null, 2));
}

main();
