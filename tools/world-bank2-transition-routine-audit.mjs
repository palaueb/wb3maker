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
const catalogId = 'world-bank2-transition-routine-catalog-2026-06-25';
const reportId = 'bank2-transition-routine-audit-2026-06-25';
const toolName = 'tools/world-bank2-transition-routine-audit.mjs';

function routine(offset, label, role, name, summary, options = {}) {
  return {
    offset,
    label,
    type: options.type || 'code',
    role,
    name,
    family: options.family || 'bank2_transition_runtime',
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
  routine(0x0B3C0, '_LABEL_B3C0_', 'transition_request_dispatcher', '_LABEL_B3C0_ transition request dispatcher', 'Consumes _RAM_CF6A_ transition requests from the gameplay loop and dispatches one of three transition entry routines.', {
    calls: ['_LABEL_20_', '_DATA_B3CD_'],
    ramRefs: ['_RAM_CF6A_'],
    evidence: ['ASM lines 20043-20055 clear _RAM_CF6A_, decrement the saved request id, and RST $20 through _DATA_B3CD_.'],
  }),
  routine(0x0B3CD, '_DATA_B3CD_', 'transition_request_jump_table', '_DATA_B3CD_ transition request jump table', 'Three-entry jump table for _RAM_CF6A_ transition requests; this is pointer data, not executable code.', {
    type: 'pointer_table',
    family: 'bank2_transition_table',
    calls: ['_LABEL_B3D3_', '_LABEL_B44F_', '_LABEL_B6B0_'],
    ramRefs: ['_RAM_CF6A_'],
    evidence: ['ASM lines 20053-20055 identify _DATA_B3CD_ as a three-entry jump table indexed by _RAM_CF6A_.'],
  }),
  routine(0x0B3D3, '_LABEL_B3D3_', 'transition_new_game_bootstrap', '_LABEL_B3D3_ new-game transition bootstrap', 'Initializes a new-game/transition context, runs the scripted transition controller, prepares menu/equipment defaults, loads VRAM scripts, and enters the target room.', {
    dispatchTable: '_DATA_B3CD_',
    dispatchIndex: 0,
    indexRam: '_RAM_CF6A_',
    calls: ['_LABEL_822_', '_LABEL_104B_', '_LABEL_10A4_', '_LABEL_4486_', '_LABEL_106E_', '_LABEL_23F1_', '_LABEL_8B2_', '_LABEL_8FB_', '_LABEL_998_', '_LABEL_1C31_', '_LABEL_291F_', '_LABEL_2620_', '_LABEL_849_'],
    ramRefs: ['_RAM_C243_', '_RAM_C251_', '_RAM_CF20_', '_RAM_CF21_', '_RAM_CF2A_', '_RAM_CF2B_', '_RAM_CF34_', '_RAM_CF35_', '_RAM_CF52_', '_RAM_CF54_', '_RAM_CF69_', '_RAM_CF88_', '_RAM_CF8A_', '_RAM_CFE1_', '_RAM_CFF9_', '_RAM_CFFA_', '_RAM_CFFC_', '_RAM_D005_'],
    evidence: ['ASM lines 20058-20104 show reset/default writes, calls to _LABEL_4486_, _DATA_2A55_/_DATA_2AE2_ loader calls, and room load through _LABEL_2620_.'],
  }),
  routine(0x0B44F, '_LABEL_B44F_', 'transition_room_sequence_entry', '_LABEL_B44F_ transition room-sequence entry', 'Loads the next transition room record, runs the bank-2 scene loop, dispatches a form-transition branch, then loads the following room record and resumes gameplay state.', {
    dispatchTable: '_DATA_B3CD_',
    dispatchIndex: 1,
    indexRam: '_RAM_CF6A_',
    calls: ['_LABEL_822_', '_LABEL_137C_', '_LABEL_1F28_', '_LABEL_2620_', '_LABEL_998_', '_LABEL_8000_', '_LABEL_104B_', '_LABEL_849_', '_LABEL_B4DF_', '_LABEL_B511_', '_LABEL_1C5C_', '_LABEL_FF9_'],
    ramRefs: ['_RAM_C237_', '_RAM_C251_', '_RAM_C26C_', '_RAM_CF8B_', '_RAM_CFE1_', '_RAM_CFF9_', '_RAM_D02C_'],
    evidence: ['ASM lines 20107-20152 show two room loads through _RAM_C26C_, a _DATA_B4C5_ 998 loader, a bank-2 scene tick, and cleanup of _RAM_CF8B_.'],
  }),
  routine(0x0B4DF, '_LABEL_B4DF_', 'transition_scene_loop_until_complete', '_LABEL_B4DF_ transition scene loop until complete', 'Frame loop for the bank-2 transition scene: updates input/effects/player/runtime objects until the player aborts or _RAM_D1AF_ reaches $FF.', {
    calls: ['_LABEL_FEE_', '_LABEL_BFD_', '_LABEL_2855_', '_LABEL_4746_', '_LABEL_5788_', '_LABEL_10BC_', '_LABEL_8000_', '_LABEL_6E7_'],
    ramRefs: ['_RAM_C240_', '_RAM_CFE1_', '_RAM_D1AF_'],
    evidence: ['ASM lines 20159-20181 recurse through _LABEL_B4DF_ after the bank-2 scene tick and return only on player-state bit 0 or _RAM_D1AF_=$FF.'],
  }),
  routine(0x0B511, '_LABEL_B511_', 'transition_scene_branch_dispatcher', '_LABEL_B511_ transition scene branch dispatcher', 'Dispatches one of six transition-scene branch routines from _RAM_D1AE_.', {
    calls: ['_LABEL_20_', '_DATA_B515_'],
    ramRefs: ['_RAM_D1AE_'],
    evidence: ['ASM lines 20183-20188 load _RAM_D1AE_ and dispatch through _DATA_B515_.'],
  }),
  routine(0x0B515, '_DATA_B515_', 'transition_scene_branch_jump_table', '_DATA_B515_ transition scene branch jump table', 'Six-entry jump table for transition scene branches selected by _RAM_D1AE_; this is pointer data, not executable code.', {
    type: 'pointer_table',
    family: 'bank2_transition_table',
    calls: ['_LABEL_B521_', '_LABEL_B539_', '_LABEL_B551_', '_LABEL_B569_', '_LABEL_B581_', '_LABEL_B599_'],
    ramRefs: ['_RAM_D1AE_'],
    evidence: ['ASM lines 20186-20188 identify _DATA_B515_ as a six-entry jump table indexed by _RAM_D1AE_.'],
  }),
  routine(0x0B521, '_LABEL_B521_', 'transition_branch_0_form_change', '_LABEL_B521_ transition branch 0 form change', 'Runs the shared playable transition loop, stores branch id 1, executes the form-transition setup, delays, then marks _RAM_D005_.', {
    dispatchTable: '_DATA_B515_',
    dispatchIndex: 0,
    indexRam: '_RAM_D1AE_',
    calls: ['_LABEL_B656_', '_LABEL_B6CA_', '_LABEL_1004_'],
    ramRefs: ['_RAM_D005_', '_RAM_D10E_'],
  }),
  routine(0x0B539, '_LABEL_B539_', 'transition_branch_1_form_change', '_LABEL_B539_ transition branch 1 form change', 'Runs the shared playable transition loop, records transition stage 1, executes form-transition setup, and delays before returning.', {
    dispatchTable: '_DATA_B515_',
    dispatchIndex: 1,
    indexRam: '_RAM_D1AE_',
    calls: ['_LABEL_B656_', '_LABEL_B6CA_', '_LABEL_1004_'],
    ramRefs: ['_RAM_CF5B_', '_RAM_D10E_'],
  }),
  routine(0x0B551, '_LABEL_B551_', 'transition_branch_2_form_change', '_LABEL_B551_ transition branch 2 form change', 'Runs the shared playable transition loop, records transition stage 2, executes form-transition setup, and delays before returning.', {
    dispatchTable: '_DATA_B515_',
    dispatchIndex: 2,
    indexRam: '_RAM_D1AE_',
    calls: ['_LABEL_B656_', '_LABEL_B6CA_', '_LABEL_1004_'],
    ramRefs: ['_RAM_CF5B_', '_RAM_D10E_'],
  }),
  routine(0x0B569, '_LABEL_B569_', 'transition_branch_3_form_change', '_LABEL_B569_ transition branch 3 form change', 'Runs the shared playable transition loop, records transition stage 3, executes form-transition setup, and delays before returning.', {
    dispatchTable: '_DATA_B515_',
    dispatchIndex: 3,
    indexRam: '_RAM_D1AE_',
    calls: ['_LABEL_B656_', '_LABEL_B6CA_', '_LABEL_1004_'],
    ramRefs: ['_RAM_CF5B_', '_RAM_D10E_'],
  }),
  routine(0x0B581, '_LABEL_B581_', 'transition_branch_4_form_change', '_LABEL_B581_ transition branch 4 form change', 'Runs the shared playable transition loop, records transition stage 4, executes form-transition setup, and delays before returning.', {
    dispatchTable: '_DATA_B515_',
    dispatchIndex: 4,
    indexRam: '_RAM_D1AE_',
    calls: ['_LABEL_B656_', '_LABEL_B6CA_', '_LABEL_1004_'],
    ramRefs: ['_RAM_CF5B_', '_RAM_D10E_'],
  }),
  routine(0x0B599, '_LABEL_B599_', 'transition_branch_finale_sequence', '_LABEL_B599_ transition finale sequence', 'Final transition branch that chains the falling actor setup, text/effect stream, C3C0 object sequence, and ending/starfield setup.', {
    dispatchTable: '_DATA_B515_',
    dispatchIndex: 5,
    indexRam: '_RAM_D1AE_',
    calls: ['_LABEL_B9BA_', '_LABEL_FF9_', '_LABEL_BA62_', '_LABEL_BBD8_', '_LABEL_822_', '_LABEL_BB64_', '_LABEL_BC31_', '_LABEL_1004_', '_LABEL_BC9B_', '_LABEL_BE0B_'],
    ramRefs: ['_RAM_C3C1_', '_RAM_CF5B_', '_RAM_CFCD_', '_RAM_CFDA_', '_RAM_CFE2_', '_RAM_D10E_'],
    evidence: ['ASM lines 20261-20295 chain the final branch through _LABEL_B9BA_, _LABEL_BB64_, _LABEL_BC31_, _LABEL_BC9B_, and _LABEL_BE0B_.'],
  }),
  routine(0x0B643, '_LABEL_B643_', 'transition_screen_mode_helper', '_LABEL_B643_ transition screen mode helper', 'Writes a small screen program and clears VDP register-0 bit 6 for the transition display mode.', {
    calls: ['_LABEL_604_', '_LABEL_107D_'],
    evidence: ['ASM lines 20334-20342 load _DATA_B64D_ into BC, call _LABEL_604_, then call _LABEL_107D_.'],
  }),
  routine(0x0B656, '_LABEL_B656_', 'transition_playable_loop', '_LABEL_B656_ transition playable loop', 'Shared loop that keeps the current room playable while transition actors, player runtime, VDP streams, and bank-2 scene objects update.', {
    calls: ['_LABEL_FF9_', '_LABEL_BFD_', '_LABEL_2855_', '_LABEL_4746_', '_LABEL_5788_', '_LABEL_10BC_', '_LABEL_1004_', '_LABEL_B84F_', '_LABEL_B79C_', '_LABEL_46D9_', '_LABEL_6E7_', '_LABEL_BBD8_'],
    ramRefs: ['_RAM_C240_', '_RAM_C280_', '_RAM_CF91_', '_RAM_CFE0_', '_RAM_D02D_', '_RAM_D02E_'],
    evidence: ['ASM lines 20344-20385 loop until player state bit 0 or transition actor flags request exit.'],
  }),
  routine(0x0B6B0, '_LABEL_B6B0_', 'transition_form_index_clamp', '_LABEL_B6B0_ transition form index clamp', 'Selects the next form-transition index from player form and current transition stage before invoking _LABEL_B6CA_.', {
    dispatchTable: '_DATA_B3CD_',
    dispatchIndex: 2,
    indexRam: '_RAM_CF6A_',
    calls: ['_LABEL_B6CA_'],
    ramRefs: ['_RAM_C24F_', '_RAM_CF5B_', '_RAM_D10E_'],
    evidence: ['ASM lines 20387-20404 compare _RAM_C24F_ and _RAM_CF5B_, clamp the selected form index, write _RAM_D10E_, then call _LABEL_B6CA_.'],
  }),
  routine(0x0B6CA, '_LABEL_B6CA_', 'form_transition_setup', '_LABEL_B6CA_ form transition setup', 'Captures source and target player display state, initializes _DATA_B77D_ timing, starts VDP stream id 6, and enters the alternating transition timing loop.', {
    calls: ['_LABEL_137C_', '_LABEL_6E7_', '_LABEL_1004_', '_LABEL_104B_', '_LABEL_FEE_', '_LABEL_10BC_', '_LABEL_1F28_', '_LABEL_2767_'],
    ramRefs: ['_RAM_C24C_', '_RAM_C24F_', '_RAM_C251_', '_RAM_C260_', '_RAM_C27F_', '_RAM_C2C0_', '_RAM_C300_', '_RAM_CF65_', '_RAM_D0FE_', '_RAM_D100_', '_RAM_D102_', '_RAM_D103_', '_RAM_D104_', '_RAM_D10E_'],
    evidence: ['Existing uiPlayerTransitionTableAudit records _DATA_B77D_ as the timing sequence consumed by _LABEL_B718_.'],
  }),
  routine(0x0B718, '_LABEL_B718_', 'form_transition_timing_driver', '_LABEL_B718_ form transition timing driver', 'Alternates saved and target display states for each duration byte in _DATA_B77D_ until the $FF terminator, then restores player runtime state.', {
    calls: ['_LABEL_FEE_', '_LABEL_10BC_', '_LABEL_6E7_', '_LABEL_1F28_', '_LABEL_2767_', '_LABEL_1004_'],
    ramRefs: ['_RAM_C24C_', '_RAM_C248_', '_RAM_C260_', '_RAM_C27F_', '_RAM_CF65_', '_RAM_D0FE_', '_RAM_D100_', '_RAM_D102_', '_RAM_D103_', '_RAM_D104_'],
    evidence: ['ASM lines 20436-20484 consume _RAM_D104_ timing records and exit when a $FF duration is read.'],
  }),
  routine(0x0B79C, '_LABEL_B79C_', 'transition_trail_slot_scheduler', '_LABEL_B79C_ transition trail slot scheduler', 'Ticks ten C3C0 object slots, periodically spawns transition trail actors around the bank-2 scene position, and stops when the countdown reaches zero.', {
    calls: ['_LABEL_5D6A_'],
    ramRefs: ['_RAM_C3C0_', '_RAM_D02D_', '_RAM_D02E_', '_RAM_D0FE_', '_RAM_D151_', '_RAM_D154_', '_RAM_D1AE_'],
    evidence: ['ASM lines 20493-20560 iterate ten 0x40-byte slots and initialize new C3C0 slots from _RAM_D151_/_RAM_D154_.'],
  }),
  routine(0x0B82E, '_LABEL_B82E_', 'transition_trail_behavior_dispatch', '_LABEL_B82E_ transition trail behavior dispatch', 'Dispatches active transition trail slots through one of two behavior tables depending on IX+32.', {
    calls: ['_LABEL_20_', '_DATA_B839_', '_DATA_B845_'],
    ramRefs: ['IX+0', 'IX+32', 'IX+48'],
    evidence: ['ASM lines 20562-20577 select _DATA_B839_ or _DATA_B845_ and dispatch on IX+48.'],
  }),
  routine(0x0B84F, '_LABEL_B84F_', 'transition_actor_scheduler', '_LABEL_B84F_ transition actor scheduler', 'Initializes and updates the C280 transition actor used during form/scene transitions.', {
    calls: ['_LABEL_1318_', '_LABEL_20_', '_DATA_B89E_'],
    ramRefs: ['_RAM_C280_', '_RAM_C283_', '_RAM_C286_', '_RAM_C2A0_', '_RAM_C2A2_', '_RAM_D151_', '_RAM_D154_'],
    evidence: ['ASM lines 20579-20618 initialize _RAM_C280_ fields, set a countdown, then dispatch _RAM_C2A0_ through _DATA_B89E_.'],
  }),
  routine(0x0B8A2, '_LABEL_B8A2_', 'transition_actor_phase_wait', '_LABEL_B8A2_ transition actor phase wait', 'First transition actor phase; initializes a phase timer, advances animation, and switches to phase 1 when the timer expires.', {
    dispatchTable: '_DATA_B89E_',
    dispatchIndex: 0,
    indexRam: '_RAM_C2A0_',
    calls: ['_LABEL_1330_', '_LABEL_1EBB_'],
    ramRefs: ['IX+32', 'IX+33', 'IX+34', 'IX+35'],
  }),
  routine(0x0B8CA, '_LABEL_B8CA_', 'transition_actor_phase_launch', '_LABEL_B8CA_ transition actor launch phase', 'Computes actor velocity from player and transition actor positions, seeds motion state, and enters the moving update path.', {
    dispatchTable: '_DATA_B89E_',
    dispatchIndex: 1,
    indexRam: '_RAM_C2A0_',
    calls: ['_LABEL_B966_'],
    ramRefs: ['_RAM_C243_', '_RAM_C246_', '_RAM_C257_', '_RAM_C283_', '_RAM_C286_', '_RAM_C288_', '_RAM_C28A_', 'IX+6', 'IX+30', 'IX+31', 'IX+32', 'IX+34', 'IX+35', 'IX+36', 'IX+37'],
    evidence: ['ASM lines 20641-20729 calculate signed motion fields and fall through to _LABEL_B966_.'],
  }),
  routine(0x0B966, '_LABEL_B966_', 'transition_actor_motion_update', '_LABEL_B966_ transition actor motion update', 'Updates the launched transition actor through animation, packed motion, collision, and signed velocity clamp handling.', {
    calls: ['_LABEL_1330_', '_LABEL_12D5_', '_LABEL_1B4B_', '_LABEL_1B25_', '_LABEL_1EBB_'],
    ramRefs: ['_RAM_C288_', '_RAM_C29E_', '_RAM_C2A5_', 'IX+11', 'IX+32', 'IX+36'],
  }),
  routine(0x0B9BA, '_LABEL_B9BA_', 'finale_falling_actor_loop', '_LABEL_B9BA_ finale falling actor loop', 'Runs VDP stream id 0x16 while spawning/updating a C280 actor until it collides/lands and the stream is ended.', {
    calls: ['_LABEL_10BC_', '_LABEL_FF9_', '_LABEL_BFD_', '_LABEL_4746_', '_LABEL_1004_', '_LABEL_6E7_', '_LABEL_1318_', '_LABEL_1330_', '_LABEL_12D5_', '_LABEL_17AB_', '_LABEL_1EBB_', '_LABEL_BBD8_'],
    ramRefs: ['_RAM_C240_', '_RAM_C280_', '_RAM_C282_', '_RAM_C283_', '_RAM_C285_', '_RAM_C286_', '_RAM_C288_', '_RAM_C289_', '_RAM_C28A_', '_RAM_C28E_', '_RAM_C29B_', '_RAM_C2BF_', '_RAM_CF65_'],
    evidence: ['ASM lines 20774-20855 initialize a C280 actor, update it through collision, and return carry when it lands/finishes.'],
  }),
  routine(0x0BA62, '_LABEL_BA62_', 'finale_form_countdown_setup', '_LABEL_BA62_ finale form-countdown setup', 'Runs timed VDP stream and delay phases, then starts a countdown loop that decrements player form state and spawns a C3C0 actor per form.', {
    calls: ['_LABEL_1004_', '_LABEL_10BC_', '_LABEL_BBD8_', '_LABEL_104B_', '_LABEL_10A4_', '_LABEL_998_', '_LABEL_137C_', '_LABEL_BB13_', '_LABEL_FF9_', '_LABEL_6E7_'],
    ramRefs: ['_RAM_C24F_', '_RAM_CFE0_', '_RAM_CF65_', '_RAM_CFF9_'],
    evidence: ['ASM lines 20857-20911 set VDP streams, decrement _RAM_C24F_, and call _LABEL_BB13_ when the C3C0 slot is free.'],
  }),
  routine(0x0BA95, '_LABEL_BA95_', 'finale_form_countdown_loop', '_LABEL_BA95_ finale form-countdown loop', 'Loop body for the finale form countdown; decrements the form selector, initializes C3C0 actor state when needed, and updates the actor until offscreen.', {
    calls: ['_LABEL_BBD8_', '_LABEL_137C_', '_LABEL_BB13_', '_LABEL_FF9_', '_LABEL_6E7_', '_LABEL_1330_', '_LABEL_12D5_', '_LABEL_6718_'],
    ramRefs: ['_RAM_C24F_', '_RAM_C3C0_', '_RAM_CFE0_'],
  }),
  routine(0x0BAB5, '_LABEL_BAB5_', 'finale_form_actor_update', '_LABEL_BAB5_ finale form actor update', 'Updates the spawned C3C0 finale actor, toggling a flag, stepping animation/motion, applying oscillator velocity, and clearing the slot outside the active window.', {
    calls: ['_LABEL_FF9_', '_LABEL_6E7_', '_LABEL_1330_', '_LABEL_12D5_', '_LABEL_6718_'],
    ramRefs: ['_RAM_C3C0_', 'IX+0', 'IX+8', 'IX+9', 'IX+30'],
  }),
  routine(0x0BB13, '_LABEL_BB13_', 'finale_form_actor_initializer', '_LABEL_BB13_ finale form actor initializer', 'Initializes the C3C0 finale actor from _DATA_BFB0_ using the current form selector.', {
    calls: ['_LABEL_1318_', '_LABEL_1004_', '_LABEL_6E7_'],
    ramRefs: ['_DATA_BFB0_', '_RAM_C24F_', '_RAM_C243_', '_RAM_C246_', '_RAM_C3C0_', '_RAM_C3C2_', '_RAM_C3C3_', '_RAM_C3C5_', '_RAM_C3C6_', '_RAM_C3C7_', '_RAM_C3C8_', '_RAM_C3C9_', '_RAM_C3CA_', '_RAM_C3CB_', '_RAM_C3CE_', '_RAM_C3CF_', '_RAM_C3DE_', '_RAM_C3DF_', '_RAM_C3FF_'],
    evidence: ['Existing playerFormAudit identifies _LABEL_BB13_ as a player-form entity initializer using _DATA_BFB0_.'],
  }),
  routine(0x0BB64, '_LABEL_BB64_', 'finale_effect_stream_scene', '_LABEL_BB64_ finale effect-stream scene', 'Initializes the _DATA_BBDE_ timed command stream and runs player/effect updates until stream completion, then plays a sequence of VDP stream ids.', {
    calls: ['_LABEL_BFED_', '_LABEL_FF9_', '_LABEL_BFBA_', '_LABEL_4746_', '_LABEL_56F4_', '_LABEL_10BC_', '_LABEL_FA1_', '_LABEL_EB3_', '_LABEL_6E7_', '_LABEL_BBD8_', '_LABEL_1004_', '_LABEL_5EB_'],
    ramRefs: ['_DATA_BBDE_', '_RAM_CF65_', '_RAM_CFE1_', '_RAM_D245_'],
    evidence: ['Existing bank2EffectScriptAudit proves _DATA_BBDE_ is initialized by _LABEL_BFED_ and updated by _LABEL_BFBA_.'],
  }),
  routine(0x0BBD8, '_LABEL_BBD8_', 'transition_delay_frames', '_LABEL_BBD8_ transition delay helper', 'Busy-waits B frames by calling the frame pump _LABEL_1004_ once per loop.', {
    calls: ['_LABEL_1004_'],
    confidence: 'high',
    evidence: ['ASM lines 21038-21041 are a direct B-counted _LABEL_1004_ delay loop.'],
  }),
  routine(0x0BC31, '_LABEL_BC31_', 'finale_c3c0_actor_scheduler', '_LABEL_BC31_ finale C3C0 actor scheduler', 'Initializes a C3C0 actor with _DATA_BF6A_ and updates it through animation, movement, and screen-window checks until it exits.', {
    calls: ['_LABEL_998_', '_LABEL_1318_', '_LABEL_FF9_', '_LABEL_1330_', '_LABEL_12D5_', '_LABEL_1B25_', '_LABEL_6718_', '_LABEL_6E7_'],
    ramRefs: ['_DATA_BF6A_', '_RAM_C3C0_', '_RAM_C3C1_', '_RAM_C3C2_', '_RAM_C3C3_', '_RAM_C3C5_', '_RAM_C3C6_', '_RAM_C3C8_', '_RAM_C3CA_', '_RAM_C3CE_', '_RAM_C3DF_', '_RAM_C3FF_'],
    evidence: ['ASM lines 21052-21094 call _DATA_BF6A_ through _LABEL_998_, seed C3C0 fields, and update until _LABEL_6718_ reports outside-window.'],
  }),
  routine(0x0BC7E, '_LABEL_BC7E_', 'finale_c3c0_actor_active_update', '_LABEL_BC7E_ finale C3C0 actor active update', 'Active update path for the C3C0 finale actor initialized by _LABEL_BC31_.', {
    calls: ['_LABEL_FF9_', '_LABEL_1330_', '_LABEL_12D5_', '_LABEL_1B25_', '_LABEL_6718_', '_LABEL_6E7_'],
    ramRefs: ['_RAM_C3C0_', '_RAM_C3C1_'],
  }),
  routine(0x0BC9B, '_LABEL_BC9B_', 'finale_form_parade_setup', '_LABEL_BC9B_ finale form-parade setup', 'Clears state, resets form selector, queues sound/effect 0x0A, then enters the form parade loop.', {
    calls: ['_LABEL_DB5_', '_LABEL_108C_', '_LABEL_104B_', '_LABEL_BD26_', '_LABEL_1004_', '_LABEL_1330_', '_LABEL_6E7_', '_LABEL_822_', '_LABEL_4700_', '_LABEL_1318_', '_LABEL_5EB_'],
    ramRefs: ['_RAM_C24F_', '_RAM_C3C0_', '_RAM_C3E1_', '_RAM_C3E2_', '_RAM_CFF9_', '_RAM_D0FE_', '_RAM_D100_'],
  }),
  routine(0x0BCAD, '_LABEL_BCAD_', 'finale_form_parade_loop', '_LABEL_BCAD_ finale form-parade loop', 'Loops through all six player forms, initializing each with _LABEL_BD26_, running animation/movement timing, and advancing _RAM_C24F_ until the final form exits.', {
    calls: ['_LABEL_6E7_', '_LABEL_1004_', '_LABEL_BD26_', '_LABEL_1330_', '_LABEL_822_', '_LABEL_4700_', '_LABEL_1318_', '_LABEL_5EB_'],
    ramRefs: ['_RAM_C24F_', '_RAM_C3C0_', '_RAM_C3E1_', '_RAM_C3E2_', '_RAM_D0FE_', '_RAM_D100_'],
    evidence: ['ASM lines 21104-21141 repeatedly calls _LABEL_BD26_ and increments _RAM_C24F_ until form index 5 completes.'],
  }),
  routine(0x0BD26, '_LABEL_BD26_', 'finale_form_record_loader', '_LABEL_BD26_ finale form record loader', 'Loads form-specific VRAM and transition-record fields selected by _RAM_C24F_, seeds C3C0 actor state, and applies _DATA_BF82_.', {
    calls: ['_LABEL_12C9_', '_LABEL_2A49_', '_LABEL_E83_', '_LABEL_8FB_', '_LABEL_10BC_', '_LABEL_849_', '_LABEL_1004_'],
    ramRefs: ['_DATA_BF76_', '_DATA_BDB1_', '_DATA_BF82_', '_RAM_C24F_', '_RAM_C26E_', '_RAM_C3C0_', '_RAM_C3C1_', '_RAM_C3C2_', '_RAM_C3C3_', '_RAM_C3C5_', '_RAM_C3C6_', '_RAM_C3CE_', '_RAM_C3CF_', '_RAM_C3E1_', '_RAM_C3E2_', '_RAM_C3FF_', '_RAM_CF8C_', '_RAM_CFD8_', '_RAM_CFE1_', '_RAM_CFE2_', '_RAM_D00F_', '_RAM_D0FE_', '_RAM_D100_'],
    evidence: ['Existing playerFormAudit details _DATA_BDB1_ and _DATA_BF76_ pointer tables consumed by _LABEL_BD26_.'],
  }),
  routine(0x0BE0B, '_LABEL_BE0B_', 'finale_ending_starfield_entry', '_LABEL_BE0B_ finale ending/starfield entry', 'Clears display/player state, loads finale tiles, initializes a CA40 starfield-style table, and enters the non-returning ending update loop.', {
    calls: ['_LABEL_DB5_', '_LABEL_556_', '_LABEL_107D_', '_LABEL_108C_', '_LABEL_6E7_', '_LABEL_8FB_', '_LABEL_849_', '_LABEL_1004_', '_LABEL_FF9_', '_LABEL_BE97_', '_LABEL_5EB_', '_LABEL_BF35_', '_LABEL_D36_', '_LABEL_104B_'],
    ramRefs: ['_DATA_BF82_', '_RAM_C23C_', '_RAM_CA40_', '_RAM_CFD8_', '_RAM_CFE0_', '_RAM_CFE2_', '_RAM_D10E_', '_RAM_D113_'],
    evidence: ['ASM lines 21260-21338 load _DATA_BF82_, initialize _RAM_CA40_ records from random bytes, and enter the BE97/BF35 update loops.'],
  }),
  routine(0x0BE97, '_LABEL_BE97_', 'finale_starfield_update', '_LABEL_BE97_ finale starfield update', 'Updates the 0x40 three-byte records at _RAM_CA40_ with speed gating from _RAM_D10E_, then flags the frame update.', {
    ramRefs: ['_RAM_CA40_', '_RAM_CFE0_', '_RAM_D10E_'],
    evidence: ['ASM lines 21340-21391 iterate 0x40 records at _RAM_CA40_ with stride three and update their first byte based on bit flags.'],
  }),
  routine(0x0BEDE, '_LABEL_BEDE_', 'finale_vdp_rectangle_writer', '_LABEL_BEDE_ finale VDP rectangle writer', 'Writes the outline/fill points for a rectangular VDP area using row and column helpers.', {
    calls: ['_LABEL_BF04_', '_LABEL_BF10_'],
    ramRefs: ['_RAM_CF82_', '_RAM_D0FE_', '_RAM_D100_'],
    evidence: ['ASM lines 21393-21408 store HL/DE work values, call row/column helper pairs with interrupts disabled, and clear _RAM_CF82_.'],
  }),
  routine(0x0BF04, '_LABEL_BF04_', 'finale_vdp_horizontal_edge_writer', '_LABEL_BF04_ finale VDP horizontal edge writer', 'Writes horizontal VDP edge points by repeatedly advancing the name-table address with _LABEL_BF26_.', {
    calls: ['_LABEL_BF26_'],
    ramRefs: [],
  }),
  routine(0x0BF10, '_LABEL_BF10_', 'finale_vdp_vertical_edge_writer', '_LABEL_BF10_ finale VDP vertical edge writer', 'Writes vertical VDP edge points by repeatedly adding one name-table row to HL.', {
    ramRefs: [],
  }),
  routine(0x0BF26, '_LABEL_BF26_', 'finale_vdp_horizontal_advance', '_LABEL_BF26_ finale VDP horizontal advance helper', 'Advances a VDP name-table address by one tile pair and wraps at the row edge.', {
    ramRefs: [],
  }),
  routine(0x0BF35, '_LABEL_BF35_', 'finale_music_countdown', '_LABEL_BF35_ finale music countdown', 'Counts down _RAM_D113_, increments _RAM_C23C_ until 0x0C, then requests sound/effect 0 and clears carry to end the loop phase.', {
    calls: ['_LABEL_104B_'],
    ramRefs: ['_RAM_C23C_', '_RAM_D113_'],
  }),
  routine(0x0BFBA, '_LABEL_BFBA_', 'timed_effect_stream_update', '_LABEL_BFBA_ timed effect stream update', 'Updates the timed effect command stream initialized by _LABEL_BFED_, producing input/effect flags and setting completion when the stream terminates.', {
    ramRefs: ['_RAM_CFEE_', '_RAM_CF95_', '_RAM_CFF0_', '_RAM_D226_', '_RAM_D279_'],
    evidence: ['Existing bank2EffectScriptAudit identifies _LABEL_BFBA_ as the stream updater for _DATA_BBDE_.'],
  }),
  routine(0x0BFED, '_LABEL_BFED_', 'timed_effect_stream_init', '_LABEL_BFED_ timed effect stream initializer', 'Initializes the timed effect stream delay, pointer, and status flags from HL.', {
    ramRefs: ['_RAM_CFEE_', '_RAM_CFF0_', '_RAM_D225_', '_RAM_D226_'],
    evidence: ['Existing bank2EffectScriptAudit identifies _LABEL_BFED_ as the initializer for _DATA_BBDE_.'],
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
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank2TransitionRoutineAudit');
  return keys.length === 1 && keys[0] === 'inferred';
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      entryCount: ENTRIES.length,
      routineCount: ENTRIES.filter(entry => entry.type === 'code').length,
      jumpTableCount: ENTRIES.filter(entry => entry.type === 'pointer_table').length,
      assetPolicy: 'Metadata only: ASM labels, offsets, routine roles, dispatch tables, calls, RAM references, and evidence. No ROM bytes or decoded assets are embedded.',
    },
    entries: ENTRIES.map(entry => ({
      ...entry,
      offset: hex(entry.offset),
      region: regionRef(findExactRegion(mapData, entry.offset)),
    })),
    evidence: [
      'ASM lines 20043-20055 prove _DATA_B3CD_ is the _RAM_CF6A_ transition request jump table.',
      'ASM lines 20183-20188 prove _DATA_B515_ is the _RAM_D1AE_ transition branch jump table.',
      'ASM lines 20344-21542 show the transition/finale routines updating player runtime, VDP streams, form-transition records, timed effect streams, and finale state.',
      'Existing tile-source, player-form, and bank2-effect-script audits already classify the referenced loader/effect data without embedding ROM bytes.',
    ],
  };
}

function shouldRetype(region, targetType) {
  if (!region || !targetType) return false;
  const current = region.type || 'unknown';
  if (current === targetType) return false;
  if (targetType === 'pointer_table') return ['code', 'data_table', 'unknown'].includes(current);
  if (targetType === 'code') return ['unknown'].includes(current);
  return false;
}

function annotateRegion(region, entry) {
  const typeBefore = region.type || 'unknown';
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  const changedType = shouldRetype(region, entry.type);
  if (changedType) region.type = entry.type;
  if (entry.name && (!region.name || /^Jump Table @/.test(region.name) || /^_LABEL_/.test(region.name) === false)) {
    region.name = entry.name;
  }
  if (entry.summary && !region.notes) region.notes = entry.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank2TransitionRoutineAudit = {
    catalogId,
    kind: entry.role,
    family: entry.family,
    label: entry.label,
    confidence: entry.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    dispatchTable: entry.dispatchTable,
    dispatchIndex: entry.dispatchIndex,
    indexRam: entry.indexRam,
    calls: entry.calls,
    ramRefs: entry.ramRefs,
    summary: entry.summary,
    evidence: entry.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    role: entry.role,
    label: entry.label,
    confidence: entry.confidence,
    typeBefore,
    typeAfter: region.type || typeBefore,
    changedType,
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

function main() {
  const mapData = readJson(mapPath);
  let changes = { annotated: [], missing: [] };

  if (apply) {
    changes = applyAnnotations(mapData);
    const finalCatalog = buildCatalog(mapData);
    mapData.transitionRoutineCatalogs = (mapData.transitionRoutineCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.transitionRoutineCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_transition_routine_audit',
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
        'Split the _RAM_CA40_ ending table layout into named three-byte fields by tracing _LABEL_BE0B_ initialization and _LABEL_BE97_ updates.',
        'Build a read-only parser for the _LABEL_BFED_/_LABEL_BFBA_ timed effect stream format and summarize commands without exposing bytes.',
        'Trace how _RAM_CF6A_ requests are set outside _LABEL_B3C0_ to connect room triggers and bank-2 transition requests.',
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
