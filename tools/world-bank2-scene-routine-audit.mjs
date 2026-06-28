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
const catalogId = 'world-bank2-scene-routine-catalog-2026-06-25';
const reportId = 'bank2-scene-routine-audit-2026-06-25';
const toolName = 'tools/world-bank2-scene-routine-audit.mjs';

function routine(offset, label, role, name, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name,
    summary,
    family: options.family || 'bank2_scene_controller',
    confidence: options.confidence || 'high',
    dispatchTable: options.dispatchTable || null,
    dispatchIndex: options.dispatchIndex ?? null,
    indexRam: options.indexRam || null,
    calls: options.calls || [],
    ramRefs: options.ramRefs || [],
    evidence: [
      `${label} is an ASM code label at ROM offset ${hex(offset)}.`,
      ...(options.dispatchTable ? [`${options.dispatchTable} lists ${label}${options.dispatchIndex == null ? '' : ` as entry ${options.dispatchIndex}`} and is dispatched with RST $20${options.indexRam ? ` using ${options.indexRam}` : ''}.`] : []),
      ...(options.evidence || []),
    ],
  };
}

const TOP_LEVEL = [
  routine(0x08000, '_LABEL_8000_', 'bank2_scene_entry_dispatcher', '_LABEL_8000_ bank-2 scene entry dispatcher', 'Bank-2 scene entry point that dispatches the active scene controller through _RAM_D1AE_, then updates scroll/HUD shadow state.', {
    calls: ['_LABEL_8026_', '_LABEL_82A7_', '_LABEL_8682_', '_LABEL_898F_', '_LABEL_8D0D_', '_LABEL_901B_'],
    ramRefs: ['_RAM_D1AE_', '_RAM_D151_', '_RAM_CF8C_', '_RAM_CF8D_', '_RAM_CFE1_'],
    evidence: ['_LABEL_8000_ dispatches through the six-entry _DATA_801A_ table indexed by _RAM_D1AE_.'],
  }),
  routine(0x08026, '_LABEL_8026_', 'bank2_scene_0_setup_tick', '_LABEL_8026_ bank-2 scene 0 setup/tick', 'First top-level bank-2 scene controller; initializes the shared D15x/D16x scene state from _DATA_9AE0_ and then ticks its state, VDP stream, and object slots.', {
    dispatchTable: '_DATA_801A_',
    dispatchIndex: 0,
    indexRam: '_RAM_D1AE_',
    calls: ['_LABEL_80A1_', '_LABEL_96FE_', '_LABEL_978E_', '_LABEL_81C8_', '_LABEL_9A9F_'],
    ramRefs: ['_RAM_D1AF_', '_RAM_D15A_', '_RAM_D151_', '_RAM_D154_', '_RAM_D16E_', '_RAM_D17E_', '_RAM_D17F_', '_RAM_D186_'],
  }),
  routine(0x082A7, '_LABEL_82A7_', 'bank2_scene_1_setup_tick', '_LABEL_82A7_ bank-2 scene 1 setup/tick', 'Second top-level bank-2 scene controller; initializes alternate D15x/D19x state and ticks the 0x833C state table, VDP stream, and slot scheduler.', {
    dispatchTable: '_DATA_801A_',
    dispatchIndex: 1,
    indexRam: '_RAM_D1AE_',
    calls: ['_LABEL_8338_', '_LABEL_96FE_', '_LABEL_978E_', '_LABEL_848F_', '_LABEL_9A9F_'],
    ramRefs: ['_RAM_D1AF_', '_RAM_D15A_', '_RAM_D151_', '_RAM_D154_', '_RAM_D16C_', '_RAM_D16E_', '_RAM_D17E_', '_RAM_D17F_', '_RAM_D198_', '_RAM_D19A_'],
  }),
  routine(0x08682, '_LABEL_8682_', 'bank2_scene_2_setup_tick', '_LABEL_8682_ bank-2 scene 2 setup/tick', 'Third top-level bank-2 scene controller; initializes D15x/D18x state and ticks the 0x86D7 state table, VDP stream, and object slots.', {
    dispatchTable: '_DATA_801A_',
    dispatchIndex: 2,
    indexRam: '_RAM_D1AE_',
    calls: ['_LABEL_86D3_', '_LABEL_96FE_', '_LABEL_978E_', '_LABEL_88A9_', '_LABEL_9A9F_'],
    ramRefs: ['_RAM_D1AF_', '_RAM_D15A_', '_RAM_D151_', '_RAM_D154_', '_RAM_D16E_', '_RAM_D17E_', '_RAM_D17F_', '_RAM_D18E_'],
  }),
  routine(0x0898F, '_LABEL_898F_', 'bank2_scene_3_setup_tick', '_LABEL_898F_ bank-2 scene 3 setup/tick', 'Fourth top-level bank-2 scene controller; initializes D15x/D18x state and ticks the 0x89E2 state table, VDP stream, and object slots.', {
    dispatchTable: '_DATA_801A_',
    dispatchIndex: 3,
    indexRam: '_RAM_D1AE_',
    calls: ['_LABEL_89DE_', '_LABEL_96FE_', '_LABEL_978E_', '_LABEL_8BB9_', '_LABEL_9A9F_'],
    ramRefs: ['_RAM_D1AF_', '_RAM_D15A_', '_RAM_D151_', '_RAM_D154_', '_RAM_D16E_', '_RAM_D17E_', '_RAM_D17F_', '_RAM_D18A_'],
  }),
  routine(0x08D0D, '_LABEL_8D0D_', 'bank2_scene_4_setup_tick', '_LABEL_8D0D_ bank-2 scene 4 setup/tick', 'Fifth top-level bank-2 scene controller; initializes D15x/D18x state and ticks the 0x8D60 state table, VDP stream, and object slots.', {
    dispatchTable: '_DATA_801A_',
    dispatchIndex: 4,
    indexRam: '_RAM_D1AE_',
    calls: ['_LABEL_8D5C_', '_LABEL_96FE_', '_LABEL_978E_', '_LABEL_8E98_', '_LABEL_9A9F_'],
    ramRefs: ['_RAM_D1AF_', '_RAM_D15A_', '_RAM_D151_', '_RAM_D154_', '_RAM_D16E_', '_RAM_D17E_', '_RAM_D17F_'],
  }),
  routine(0x0901B, '_LABEL_901B_', 'bank2_scene_5_setup_tick', '_LABEL_901B_ bank-2 scene 5 setup/tick', 'Sixth top-level bank-2 scene controller; selects one six-byte init record from the 0x9096 table, jumps through its routine pointer, and ticks the 0x90CA state table and slot scheduler.', {
    dispatchTable: '_DATA_801A_',
    dispatchIndex: 5,
    indexRam: '_RAM_D1AE_',
    calls: ['_LABEL_90C6_', '_LABEL_96FE_', '_LABEL_978E_', '_LABEL_9566_', '_LABEL_9A9F_'],
    ramRefs: ['_RAM_D1AF_', '_RAM_D15A_', '_RAM_D151_', '_RAM_D154_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D17E_', '_RAM_D17F_', '_RAM_D18E_'],
    evidence: ['The companion bank2StateMachineAudit confirms that _LABEL_901B_ reads six-byte init records starting at 0x9096.'],
  }),
];

function state(offset, label, index, table, role, name, summary, calls = [], ramRefs = []) {
  return routine(offset, label, role, name, summary, {
    family: 'bank2_scene_state_handler',
    dispatchTable: table,
    dispatchIndex: index,
    indexRam: '_RAM_D16E_',
    calls,
    ramRefs,
  });
}

const CONTROLLER0_STATES = [
  routine(0x080A1, '_LABEL_80A1_', 'bank2_scene_0_state_dispatcher', '_LABEL_80A1_ bank-2 scene 0 state dispatcher', 'Dispatches scene-0 state handlers through the 0x80A5 table indexed by _RAM_D16E_.', {
    family: 'bank2_scene_state_dispatcher',
    calls: ['_LABEL_80AF_', '_LABEL_80BF_', '_LABEL_80E4_', '_LABEL_810D_', '_LABEL_816A_'],
    ramRefs: ['_RAM_D16E_'],
    evidence: ['_LABEL_80A1_ loads _RAM_D16E_ and dispatches through _DATA_80A5_ with RST $20.'],
  }),
  state(0x080AF, '_LABEL_80AF_', 2, '_DATA_80A5_', 'bank2_scene_0_wait_state', '_LABEL_80AF_ bank-2 scene 0 wait state', 'Runs the shared scene transition guard and motion helper, then advances _RAM_D16E_ when _RAM_D186_ expires.', ['_LABEL_81AB_', '_LABEL_98DA_'], ['_RAM_D16E_', '_RAM_D186_']),
  state(0x080BF, '_LABEL_80BF_', 3, '_DATA_80A5_', 'bank2_scene_0_proximity_transition_state', '_LABEL_80BF_ bank-2 scene 0 proximity transition', 'Waits for the shared proximity/motion test, sets a spawn request in _RAM_D17E_, and advances to the next scene state.', ['_LABEL_81AB_', '_LABEL_994A_'], ['_RAM_D15D_', '_RAM_D16E_', '_RAM_D17E_', '_RAM_D17F_', '_RAM_D186_']),
  state(0x080E4, '_LABEL_80E4_', 4, '_DATA_80A5_', 'bank2_scene_0_target_reset_state', '_LABEL_80E4_ bank-2 scene 0 target reset', 'After a countdown, chooses a target side using _LABEL_847F_, rewrites the D18E/D18F target pair, and returns to state 2.', ['_LABEL_81AB_', '_LABEL_847F_'], ['_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D18E_', '_RAM_D186_']),
  state(0x0810D, '_LABEL_810D_', 1, '_DATA_80A5_', 'bank2_scene_0_entry_complete_state', '_LABEL_810D_ bank-2 scene 0 entry complete', 'Completes the scene-0 entry motion, initializes _RAM_D16C_ and _RAM_D186_, and advances to state 2.', ['_LABEL_9980_', '_LABEL_994A_'], ['_RAM_D15D_', '_RAM_D16C_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D186_']),
];

const SHARED_STATES = [
  routine(0x08131, '_LABEL_8131_', 'bank2_scene_shared_recovery_transition', '_LABEL_8131_ bank-2 shared recovery transition', 'Shared transition path that adjusts _RAM_D15D_, _RAM_D156_, _RAM_D16C_, and state flags when a controller branches into the recovery/retreat mode.', {
    family: 'bank2_scene_shared_state',
    calls: ['_LABEL_104B_'],
    ramRefs: ['_RAM_D14F_', '_RAM_D15D_', '_RAM_D156_', '_RAM_D16C_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_CF65_'],
    evidence: ['Multiple bank-2 state guards branch to _LABEL_8131_ after testing _RAM_D14E_ flags.'],
  }),
  routine(0x0816A, '_LABEL_816A_', 'bank2_scene_expire_controller', '_LABEL_816A_ bank-2 shared controller expire', 'Shared state-table entry that waits on _RAM_D186_, marks _RAM_D17E_ bit 1, and forces _RAM_D1AF_ to reinitialize the top-level scene controller.', {
    family: 'bank2_scene_shared_state',
    ramRefs: ['_RAM_D17E_', '_RAM_D186_', '_RAM_D1AF_'],
    evidence: ['_LABEL_816A_ is entry 0 in multiple _RAM_D16E_ dispatch tables.'],
  }),
  routine(0x0817A, '_LABEL_817A_', 'bank2_scene_shared_advance_transition', '_LABEL_817A_ bank-2 shared advance transition', 'Shared transition path that adjusts _RAM_D15D_, clears part of _RAM_D14E_, sets _RAM_D17E_ bits, and starts the next timed phase.', {
    family: 'bank2_scene_shared_state',
    calls: ['_LABEL_104B_'],
    ramRefs: ['_RAM_D14E_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D17E_', '_RAM_D17F_', '_RAM_D186_', '_RAM_CF65_'],
    evidence: ['_LABEL_81AB_ and _LABEL_8467_ branch to _LABEL_817A_ when the first _RAM_D14E_ flag is set.'],
  }),
  routine(0x081AB, '_LABEL_81AB_', 'bank2_scene_0_guard_helper', '_LABEL_81AB_ bank-2 scene 0 guard helper', 'Shared scene-0 helper that runs the object-list consumer, checks _RAM_D14E_ flags, and tail-jumps into the shared transition handlers.', {
    family: 'bank2_scene_shared_state',
    calls: ['_LABEL_9980_', '_LABEL_99A1_', '_LABEL_817A_', '_LABEL_8131_'],
    ramRefs: ['_RAM_D14E_'],
  }),
  routine(0x08467, '_LABEL_8467_', 'bank2_scene_guard_helper', '_LABEL_8467_ bank-2 scene guard helper', 'Shared bank-2 helper that runs the object-list consumer and damage/contact handler, then diverts to the shared transition handlers when _RAM_D14E_ flags are set.', {
    family: 'bank2_scene_shared_state',
    calls: ['_LABEL_9980_', '_LABEL_99A1_', '_LABEL_817A_', '_LABEL_8131_'],
    ramRefs: ['_RAM_D14E_'],
  }),
  routine(0x0847F, '_LABEL_847F_', 'bank2_player_side_compare', '_LABEL_847F_ player-side compare helper', 'Compares the player X coordinate in _RAM_C243_ with the scene X coordinate in _RAM_D151_ and returns the carry/result used to choose a side.', {
    family: 'bank2_scene_shared_state',
    ramRefs: ['_RAM_C243_', '_RAM_D151_'],
  }),
];

const SLOT_ROUTINES = [
  routine(0x081C8, '_LABEL_81C8_', 'bank2_scene_0_slot_scheduler', '_LABEL_81C8_ bank-2 scene 0 slot scheduler', 'Ticks the eight 0x40-byte object slots at _RAM_C3C0_, spawning or clearing the slot group based on _RAM_D17E_ flags.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_12D5_', '_LABEL_1330_', '_LABEL_1D76_', '_LABEL_8220_', '_LABEL_82A2_', '_LABEL_962F_'],
    ramRefs: ['_RAM_C3C0_', '_RAM_D17E_', 'IX+0', 'IX+33', 'IX+48'],
  }),
  routine(0x08220, '_LABEL_8220_', 'bank2_scene_0_slot_burst_init', '_LABEL_8220_ bank-2 scene 0 slot burst initializer', 'Initializes one object slot, clones its base fields into seven more slots, and staggers IX+33 timers across the slot group.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_1318_'],
    ramRefs: ['_RAM_C3C0_', '_RAM_D151_', '_RAM_D154_', '_RAM_D15D_', '_RAM_D17E_', 'IX+0', 'IX+8', 'IX+10', 'IX+15', 'IX+24', 'IX+33'],
  }),
  routine(0x082A2, '_LABEL_82A2_', 'bank2_scene_slot_clear_request', '_LABEL_82A2_ bank-2 slot clear request', 'Clears eight object slots through _LABEL_9AC2_.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_9AC2_'],
    ramRefs: ['_RAM_C3C0_', '_RAM_D17E_'],
  }),
  routine(0x0848F, '_LABEL_848F_', 'bank2_scene_1_slot_scheduler', '_LABEL_848F_ bank-2 scene 1 slot scheduler', 'Eight-slot scheduler for scene 1; initializes slots from _RAM_D15D_ and _RAM_D154_, then updates active slots through collision and movement helpers.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_1318_', '_LABEL_D36_', '_LABEL_1D76_', '_LABEL_1E02_', '_LABEL_12D5_', '_LABEL_1330_', '_LABEL_8595_', '_LABEL_8577_', '_LABEL_962F_'],
    ramRefs: ['_RAM_C3C0_', '_RAM_D151_', '_RAM_D154_', '_RAM_D15D_', '_RAM_D17E_', 'IX+0', 'IX+8', 'IX+10', 'IX+15', 'IX+24', 'IX+33', 'IX+48'],
  }),
  routine(0x08558, '_LABEL_8558_', 'bank2_scene_1_active_slot_update', '_LABEL_8558_ bank-2 scene 1 active slot update', 'Updates an active scene-1 object slot, applying contact, movement, and bounds checks before clearing the slot.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_1E02_', '_LABEL_1D76_', '_LABEL_12D5_', '_LABEL_1330_', '_LABEL_8595_'],
    ramRefs: ['IX+0'],
  }),
  routine(0x08577, '_LABEL_8577_', 'bank2_scene_1_slot_spawn_timer', '_LABEL_8577_ bank-2 scene 1 slot spawn timer', 'Consumes the _RAM_D187_ spawn counter and initializes IX+33/IX+48 for a newly requested scene-1 object slot.', {
    family: 'bank2_object_slot_driver',
    ramRefs: ['_RAM_D17E_', '_RAM_D187_', 'IX+0', 'IX+33', 'IX+48'],
  }),
  routine(0x08595, '_LABEL_8595_', 'bank2_slot_bounds_check', '_LABEL_8595_ bank-2 slot bounds check', 'Checks IX+4/IX+5 bounds and returns carry when the object has left the allowed horizontal range.', {
    family: 'bank2_object_slot_driver',
    ramRefs: ['IX+4', 'IX+5'],
  }),
  routine(0x088A9, '_LABEL_88A9_', 'bank2_scene_2_slot_scheduler', '_LABEL_88A9_ bank-2 scene 2 slot scheduler', 'Eight-slot scheduler for scene 2; spawns slots from _RAM_D17E_ bit 0 and updates active slots through collision/motion helpers.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_8917_', '_LABEL_1E02_', '_LABEL_1D76_', '_LABEL_1B25_', '_LABEL_12D5_', '_LABEL_1330_', '_LABEL_8595_', '_LABEL_962F_'],
    ramRefs: ['_RAM_C3C0_', '_RAM_D15D_', '_RAM_D17E_', '_RAM_D187_', 'IX+0', 'IX+8', 'IX+10', 'IX+15', 'IX+24'],
  }),
  routine(0x08917, '_LABEL_8917_', 'bank2_scene_2_slot_spawn', '_LABEL_8917_ bank-2 scene 2 slot spawn', 'Initializes a scene-2 object slot around _RAM_D151_/_RAM_D154_, sets signed velocities from _RAM_D187_, and queues sound/effect $2C.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_1318_', '_LABEL_D36_', '_LABEL_104B_'],
    ramRefs: ['_RAM_D151_', '_RAM_D154_', '_RAM_D15D_', '_RAM_D17E_', '_RAM_D187_', 'IX+0', 'IX+8', 'IX+10', 'IX+15', 'IX+24', 'IX+31'],
  }),
  routine(0x08BB9, '_LABEL_8BB9_', 'bank2_scene_3_slot_scheduler', '_LABEL_8BB9_ bank-2 scene 3 slot scheduler', 'Eight-slot scheduler for scene 3; spawns slots from _RAM_D17E_ bit 0 and updates active slots with collision, bounce, and bounds handling.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_8C3E_', '_LABEL_1E02_', '_LABEL_1D76_', '_LABEL_1B25_', '_LABEL_12D5_', '_LABEL_1330_', '_LABEL_8595_'],
    ramRefs: ['_RAM_C3C0_', '_RAM_D15D_', '_RAM_D17E_', 'IX+0', 'IX+8', 'IX+10', 'IX+15', 'IX+24', 'IX+31'],
  }),
  routine(0x08C3E, '_LABEL_8C3E_', 'bank2_scene_3_slot_spawn', '_LABEL_8C3E_ bank-2 scene 3 slot spawn', 'Initializes a scene-3 object slot beside _RAM_D151_, assigns direction and vertical speed, and queues sound/effect $2C.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_1318_', '_LABEL_104B_'],
    ramRefs: ['_RAM_D151_', '_RAM_D154_', '_RAM_D15D_', '_RAM_D17E_', 'IX+0', 'IX+8', 'IX+10', 'IX+15', 'IX+24', 'IX+31'],
  }),
  routine(0x08E98, '_LABEL_8E98_', 'bank2_scene_4_slot_scheduler', '_LABEL_8E98_ bank-2 scene 4 slot scheduler', 'Scene-4 object slot scheduler; initializes a base slot on _RAM_D17E_ bit 0, spawns a four-slot fan-out through _LABEL_8F06_, and updates active slots through _LABEL_8FD6_.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_8F06_', '_LABEL_8FD6_', '_LABEL_1318_', '_LABEL_962F_'],
    ramRefs: ['_RAM_C3C0_', '_RAM_D151_', '_RAM_D154_', '_RAM_D15D_', '_RAM_D17E_', 'IX+0', 'IX+15', 'IX+24', 'IX+30', 'IX+31', 'IX+33', 'IX+48'],
  }),
  routine(0x08F06, '_LABEL_8F06_', 'bank2_scene_4_slot_fanout_spawn', '_LABEL_8F06_ bank-2 scene 4 slot fan-out spawn', 'After a countdown, initializes one slot from _RAM_D151_/_RAM_D154_, clones it into following slots, and assigns fan-out velocities through _RAM_D0DE_/_RAM_D0E2_.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_1318_', '_LABEL_104B_'],
    ramRefs: ['_RAM_D0DE_', '_RAM_D0E0_', '_RAM_D0E2_', '_RAM_D151_', '_RAM_D154_', '_RAM_D15D_', 'IX+0', 'IX+8', 'IX+10', 'IX+15', 'IX+24', 'IX+30', 'IX+31', 'IX+33', 'IX+48'],
  }),
  routine(0x08FD6, '_LABEL_8FD6_', 'bank2_scene_4_active_slot_update', '_LABEL_8FD6_ bank-2 scene 4 active slot update', 'Updates scene-4 active slots, applying collision, vertical motion, horizontal stopping, and offscreen/terminal cleanup.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_1E02_', '_LABEL_1D76_', '_LABEL_12D5_', '_LABEL_1B25_', '_LABEL_1330_', '_LABEL_1B4B_'],
    ramRefs: ['IX+0', 'IX+7', 'IX+8', 'IX+9', 'IX+30'],
  }),
  routine(0x09566, '_LABEL_9566_', 'bank2_scene_5_slot_scheduler', '_LABEL_9566_ bank-2 scene 5 slot scheduler', 'Scene-5 object slot scheduler; spawns velocity-selected slots from the _DATA_9627_ table and updates active slots through movement/collision helpers.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_D36_', '_LABEL_1318_', '_LABEL_104B_', '_LABEL_1E02_', '_LABEL_1D76_', '_LABEL_12D8_', '_LABEL_1330_', '_LABEL_8595_', '_LABEL_962F_'],
    ramRefs: ['_DATA_9627_', '_RAM_C3C0_', '_RAM_D151_', '_RAM_D154_', '_RAM_D15D_', '_RAM_D17E_', '_RAM_D18E_', 'IX+0', 'IX+8', 'IX+15', 'IX+24'],
  }),
  routine(0x0962F, '_LABEL_962F_', 'bank2_shared_slot_reset_or_update', '_LABEL_962F_ bank-2 shared slot reset/update', 'Shared object-slot reset/update path used when _RAM_D17E_ requests the fallback slot pattern or slot cleanup.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_12D5_', '_LABEL_1330_', '_LABEL_1318_', '_LABEL_96F9_'],
    ramRefs: ['_DATA_96E9_', '_RAM_C3C0_', '_RAM_D151_', '_RAM_D154_', '_RAM_D17E_', 'IX+0', 'IX+9', 'IX+11', 'IX+15', 'IX+33', 'IX+48'],
  }),
  routine(0x096F9, '_LABEL_96F9_', 'bank2_shared_slot_clear', '_LABEL_96F9_ bank-2 shared slot clear', 'Clears eight object slots through _LABEL_9AC2_.', {
    family: 'bank2_object_slot_driver',
    calls: ['_LABEL_9AC2_'],
    ramRefs: ['_RAM_C3C0_', '_RAM_D17E_'],
  }),
];

const CONTROLLER1_STATES = [
  routine(0x08304, '_LABEL_8304_', 'bank2_scene_1_phase_reset', '_LABEL_8304_ bank-2 scene 1 phase reset', 'Resets the scene-1 phase state, randomizes part of the D18E/D18F script selector, and ticks the VDP stream/render path.', {
    family: 'bank2_scene_state_handler',
    calls: ['_LABEL_D36_', '_LABEL_96FE_', '_LABEL_978E_'],
    ramRefs: ['_RAM_D15D_', '_RAM_D16E_', '_RAM_D17E_', '_RAM_D17F_', '_RAM_D18E_', '_RAM_D154_'],
  }),
  routine(0x08338, '_LABEL_8338_', 'bank2_scene_1_state_dispatcher', '_LABEL_8338_ bank-2 scene 1 state dispatcher', 'Dispatches scene-1 state handlers through the 0x833C table indexed by _RAM_D16E_.', {
    family: 'bank2_scene_state_dispatcher',
    calls: ['_LABEL_834A_', '_LABEL_8381_', '_LABEL_839D_', '_LABEL_83B5_', '_LABEL_83D4_', '_LABEL_8404_', '_LABEL_816A_'],
    ramRefs: ['_RAM_D16E_'],
    evidence: ['_LABEL_8338_ loads _RAM_D16E_ and dispatches through _DATA_833C_ with RST $20.'],
  }),
  state(0x0834A, '_LABEL_834A_', 2, '_DATA_833C_', 'bank2_scene_1_path_arrival_state', '_LABEL_834A_ bank-2 scene 1 path-arrival state', 'Runs the shared guard/path helper, waits for _RAM_D193_ arrival, updates side/direction state, and requests a slot spawn.', ['_LABEL_8467_', '_LABEL_85E9_', '_LABEL_847F_', '_LABEL_D36_'], ['_RAM_D15D_', '_RAM_D16E_', '_RAM_D17E_', '_RAM_D17F_', '_RAM_D186_', '_RAM_D187_', '_RAM_D193_']),
  state(0x08381, '_LABEL_8381_', 3, '_DATA_833C_', 'bank2_scene_1_countdown_state', '_LABEL_8381_ bank-2 scene 1 countdown state', 'Waits on _RAM_D186_, rewrites _RAM_D18F_, and advances to the next scene state.', ['_LABEL_8467_'], ['_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D186_', '_RAM_D18F_']),
  state(0x0839D, '_LABEL_839D_', 4, '_DATA_833C_', 'bank2_scene_1_horizontal_threshold_state', '_LABEL_839D_ bank-2 scene 1 horizontal threshold state', 'Runs the path helper and advances once _RAM_D151_/_RAM_D152_ crosses the horizontal threshold.', ['_LABEL_8467_', '_LABEL_85E9_'], ['_RAM_D151_', '_RAM_D152_', '_RAM_D16E_']),
  state(0x083B5, '_LABEL_83B5_', 5, '_DATA_833C_', 'bank2_scene_1_random_delay_state', '_LABEL_83B5_ bank-2 scene 1 random delay state', 'Waits for the proximity helper, randomizes _RAM_D186_, and advances to the next state.', ['_LABEL_8467_', '_LABEL_994A_', '_LABEL_D36_'], ['_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D186_']),
  state(0x083D4, '_LABEL_83D4_', 6, '_DATA_833C_', 'bank2_scene_1_waypoint_loop_state', '_LABEL_83D4_ bank-2 scene 1 waypoint loop state', 'Moves between _RAM_D198_/_RAM_D19A_ waypoints, toggles _RAM_D19D_, and re-enters the phase reset path.', ['_LABEL_8467_', '_LABEL_85AD_', '_LABEL_8304_'], ['_RAM_D154_', '_RAM_D16E_', '_RAM_D186_', '_RAM_D198_', '_RAM_D19D_']),
  state(0x08404, '_LABEL_8404_', 1, '_DATA_833C_', 'bank2_scene_1_entry_motion_state', '_LABEL_8404_ bank-2 scene 1 entry motion state', 'Runs entry motion, compares _RAM_D151_ against a threshold, writes a script selector in _RAM_D18E_, and selects the next state.', ['_LABEL_9980_', '_LABEL_994A_'], ['_RAM_D151_', '_RAM_D154_', '_RAM_D15D_', '_RAM_D16C_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D18E_', '_RAM_D19A_']),
];

const CONTROLLER2_STATES = [
  routine(0x086D3, '_LABEL_86D3_', 'bank2_scene_2_state_dispatcher', '_LABEL_86D3_ bank-2 scene 2 state dispatcher', 'Dispatches scene-2 state handlers through the 0x86D7 table indexed by _RAM_D16E_.', {
    family: 'bank2_scene_state_dispatcher',
    calls: ['_LABEL_86E5_', '_LABEL_876B_', '_LABEL_87A0_', '_LABEL_87DD_', '_LABEL_8844_', '_LABEL_888E_', '_LABEL_816A_'],
    ramRefs: ['_RAM_D16E_'],
    evidence: ['_LABEL_86D3_ loads _RAM_D16E_ and dispatches through _DATA_86D7_ with RST $20.'],
  }),
  state(0x086E5, '_LABEL_86E5_', 2, '_DATA_86D7_', 'bank2_scene_2_edge_probe_state', '_LABEL_86E5_ bank-2 scene 2 edge probe state', 'Integrates motion, checks edge thresholds around _RAM_D151_, and advances to a timed vertical state when conditions are met.', ['_LABEL_9980_', '_LABEL_98A9_'], ['_RAM_C243_', '_RAM_D151_', '_RAM_D154_', '_RAM_D156_', '_RAM_D158_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D187_', '_RAM_D18E_']),
  state(0x0876B, '_LABEL_876B_', 3, '_DATA_86D7_', 'bank2_scene_2_vertical_arrival_state', '_LABEL_876B_ bank-2 scene 2 vertical arrival state', 'Waits for _RAM_D154_ to reach $68, counts down _RAM_D186_, then chooses direction from _LABEL_847F_.', ['_LABEL_9980_', '_LABEL_937F_', '_LABEL_847F_'], ['_RAM_D154_', '_RAM_D158_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D186_']),
  state(0x087A0, '_LABEL_87A0_', 4, '_DATA_86D7_', 'bank2_scene_2_tracking_delay_state', '_LABEL_87A0_ bank-2 scene 2 tracking delay', 'Tracks the player-side compare while a timer runs, then sets velocity and spawn counters for state 5.', ['_LABEL_8467_', '_LABEL_847F_', '_LABEL_8898_'], ['_RAM_D15D_', '_RAM_D156_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D186_', '_RAM_D187_']),
  state(0x087DD, '_LABEL_87DD_', 5, '_DATA_86D7_', 'bank2_scene_2_spawn_loop_state', '_LABEL_87DD_ bank-2 scene 2 spawn loop', 'Runs motion, updates direction toward the player, sets _RAM_D17E_ spawn requests, and exits through the recovery state when bounds are crossed.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_8898_', '_LABEL_D36_'], ['_RAM_D151_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D17E_', '_RAM_D17F_', '_RAM_D186_', '_RAM_D187_']),
  state(0x08824, '_LABEL_8824_', 6, '_DATA_86D7_', 'bank2_scene_2_recovery_setup_state', '_LABEL_8824_ bank-2 scene 2 recovery setup', 'Sets a short recovery timer, velocity, and state bits before entering state 6.', [], ['_RAM_D156_', '_RAM_D158_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D186_']),
  state(0x08844, '_LABEL_8844_', 6, '_DATA_86D7_', 'bank2_scene_2_vertical_return_state', '_LABEL_8844_ bank-2 scene 2 vertical return', 'Waits for _RAM_D154_ to return to $98 and then restarts the scene-2 motion loop via _LABEL_885F_.', ['_LABEL_9980_', '_LABEL_937F_', '_LABEL_885F_'], ['_RAM_D154_', '_RAM_D158_', '_RAM_D186_']),
  routine(0x0885F, '_LABEL_885F_', 'bank2_scene_2_loop_restart', '_LABEL_885F_ bank-2 scene 2 loop restart', 'Resets scene-2 counters, chooses direction/velocity from player-side compare, randomizes _RAM_D18E_, and jumps back to state 2.', {
    family: 'bank2_scene_state_handler',
    calls: ['_LABEL_847F_', '_LABEL_D36_'],
    ramRefs: ['_RAM_D15D_', '_RAM_D156_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D187_', '_RAM_D18E_'],
  }),
  state(0x0888E, '_LABEL_888E_', 1, '_DATA_86D7_', 'bank2_scene_2_entry_complete_state', '_LABEL_888E_ bank-2 scene 2 entry complete', 'Runs the entry-complete motion test and branches to recovery setup when the test succeeds.', ['_LABEL_9980_', '_LABEL_994A_', '_LABEL_8824_'], []),
  routine(0x08898, '_LABEL_8898_', 'bank2_scene_2_direction_velocity_helper', '_LABEL_8898_ bank-2 scene 2 direction velocity helper', 'Returns a left/right state code and signed horizontal velocity based on _LABEL_847F_.', {
    family: 'bank2_scene_state_handler',
    calls: ['_LABEL_847F_'],
  }),
];

const CONTROLLER3_STATES = [
  routine(0x089DE, '_LABEL_89DE_', 'bank2_scene_3_state_dispatcher', '_LABEL_89DE_ bank-2 scene 3 state dispatcher', 'Dispatches scene-3 state handlers through the 0x89E2 table indexed by _RAM_D16E_.', {
    family: 'bank2_scene_state_dispatcher',
    calls: ['_LABEL_89F0_', '_LABEL_8A40_', '_LABEL_8AB4_', '_LABEL_8AFF_', '_LABEL_8B27_', '_LABEL_8B50_', '_LABEL_816A_'],
    ramRefs: ['_RAM_D16E_'],
    evidence: ['_LABEL_89DE_ loads _RAM_D16E_ and dispatches through _DATA_89E2_ with RST $20.'],
  }),
  state(0x089F0, '_LABEL_89F0_', 2, '_DATA_89E2_', 'bank2_scene_3_hover_to_drop_state', '_LABEL_89F0_ bank-2 scene 3 hover-to-drop state', 'Runs guard/vertical motion, updates direction, requests spawns periodically, and transitions into the drop state at the y threshold.', ['_LABEL_8467_', '_LABEL_937F_', '_LABEL_8BAE_', '_LABEL_8B94_'], ['_RAM_D153_', '_RAM_D154_', '_RAM_D158_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D17E_', '_RAM_D17F_', '_RAM_D186_']),
  state(0x08A40, '_LABEL_8A40_', 3, '_DATA_89E2_', 'bank2_scene_3_floor_wait_state', '_LABEL_8A40_ bank-2 scene 3 floor wait', 'Waits at _RAM_D154_=$60, counts down _RAM_D186_, then selects horizontal direction and enters the arc state.', ['_LABEL_8467_', '_LABEL_937F_', '_LABEL_8B9F_'], ['_RAM_D151_', '_RAM_D153_', '_RAM_D154_', '_RAM_D158_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D186_', '_RAM_D18A_', '_RAM_D18C_', '_RAM_D18D_']),
  routine(0x08A92, '_LABEL_8A92_', 'bank2_scene_3_arc_start_tail', '_LABEL_8A92_ bank-2 scene 3 arc-start tail', 'Shared tail used by scene-3 states to install arc velocity, clear fractional accumulators, and enter state 4.', {
    family: 'bank2_scene_state_handler',
    ramRefs: ['_RAM_D153_', '_RAM_D154_', '_RAM_D156_', '_RAM_D158_', '_RAM_D16E_', '_RAM_D18A_', '_RAM_D18C_', '_RAM_D18D_'],
    evidence: ['_LABEL_8A40_ and _LABEL_8AB4_ branch to _LABEL_8A92_ after choosing a signed horizontal velocity.'],
  }),
  state(0x08AB4, '_LABEL_8AB4_', 4, '_DATA_89E2_', 'bank2_scene_3_arc_motion_state', '_LABEL_8AB4_ bank-2 scene 3 arc motion', 'Runs arc integration through _LABEL_8CAD_ and either enters the arc-start tail or waits before the next state.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_8CAD_', '_LABEL_D36_', '_LABEL_8B9F_'], ['_RAM_D151_', '_RAM_D154_', '_RAM_D159_', '_RAM_D16E_', '_RAM_D186_']),
  state(0x08AFF, '_LABEL_8AFF_', 5, '_DATA_89E2_', 'bank2_scene_3_recover_wait_state', '_LABEL_8AFF_ bank-2 scene 3 recover wait', 'Waits on _RAM_D186_ while maintaining direction, then resets through _LABEL_8B0A_.', ['_LABEL_8467_', '_LABEL_8B9F_', '_LABEL_8B0A_'], ['_RAM_D186_']),
  routine(0x08B0A, '_LABEL_8B0A_', 'bank2_scene_3_loop_reset', '_LABEL_8B0A_ bank-2 scene 3 loop reset', 'Resets scene-3 vertical velocity, chooses a direction with _LABEL_8BAE_, and returns to state 2.', {
    family: 'bank2_scene_state_handler',
    calls: ['_LABEL_8BAE_'],
    ramRefs: ['_RAM_D153_', '_RAM_D154_', '_RAM_D158_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_'],
  }),
  state(0x08B27, '_LABEL_8B27_', 6, '_DATA_89E2_', 'bank2_scene_3_landing_state', '_LABEL_8B27_ bank-2 scene 3 landing state', 'Runs arc motion until the object passes the vertical threshold, then enters a timed recovery state.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_8CAD_', '_LABEL_8B9F_'], ['_RAM_D154_', '_RAM_D159_', '_RAM_D16E_', '_RAM_D186_']),
  state(0x08B50, '_LABEL_8B50_', 1, '_DATA_89E2_', 'bank2_scene_3_entry_complete_state', '_LABEL_8B50_ bank-2 scene 3 entry complete', 'Completes scene-3 entry by deriving horizontal velocity from _RAM_D151_ and entering the landing/recovery state.', ['_LABEL_9980_', '_LABEL_994A_'], ['_RAM_D151_', '_RAM_D153_', '_RAM_D154_', '_RAM_D156_', '_RAM_D158_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D18A_', '_RAM_D18C_', '_RAM_D18D_']),
  routine(0x08B94, '_LABEL_8B94_', 'bank2_side_to_state_0_1', '_LABEL_8B94_ bank-2 side-to-state helper 0/1', 'Returns state code 0 or 1 from the player-side compare helper.', {
    family: 'bank2_scene_state_handler',
    calls: ['_LABEL_847F_'],
  }),
  routine(0x08B9F, '_LABEL_8B9F_', 'bank2_side_state_change_request', '_LABEL_8B9F_ bank-2 side state-change request', 'Updates _RAM_D15D_ from _LABEL_8B94_ and sets _RAM_D17F_ bit 0 when the side state changes.', {
    family: 'bank2_scene_state_handler',
    calls: ['_LABEL_8B94_'],
    ramRefs: ['_RAM_D15D_', '_RAM_D17F_'],
  }),
  routine(0x08BAE, '_LABEL_8BAE_', 'bank2_side_to_state_2_3', '_LABEL_8BAE_ bank-2 side-to-state helper 2/3', 'Returns state code 2 or 3 from the player-side compare helper.', {
    family: 'bank2_scene_state_handler',
    calls: ['_LABEL_847F_'],
  }),
  routine(0x08CAD, '_LABEL_8CAD_', 'bank2_scene_3_arc_integrator', '_LABEL_8CAD_ bank-2 scene 3 arc integrator', 'Integrates signed vertical speed and fractional position for scene-3 arc motion, clamping speed and deriving _RAM_D154_ from the fixed-point accumulator.', {
    family: 'bank2_scene_state_handler',
    calls: ['_LABEL_9AD3_'],
    ramRefs: ['_RAM_D153_', '_RAM_D154_', '_RAM_D155_', '_RAM_D158_', '_RAM_D159_', '_RAM_D18A_', '_RAM_D18C_', '_RAM_D18D_'],
  }),
];

const CONTROLLER4_STATES = [
  routine(0x08D5C, '_LABEL_8D5C_', 'bank2_scene_4_state_dispatcher', '_LABEL_8D5C_ bank-2 scene 4 state dispatcher', 'Dispatches scene-4 state handlers through the 0x8D60 table indexed by _RAM_D16E_.', {
    family: 'bank2_scene_state_dispatcher',
    calls: ['_LABEL_8D6E_', '_LABEL_8DAB_', '_LABEL_8E08_', '_LABEL_8E30_', '_LABEL_8E56_', '_LABEL_8E6F_', '_LABEL_8E8C_', '_LABEL_816A_'],
    ramRefs: ['_RAM_D16E_'],
    evidence: ['_LABEL_8D5C_ loads _RAM_D16E_ and dispatches through _DATA_8D60_ with RST $20.'],
  }),
  state(0x08D6E, '_LABEL_8D6E_', 2, '_DATA_8D60_', 'bank2_scene_4_spawn_delay_state', '_LABEL_8D6E_ bank-2 scene 4 spawn delay', 'Runs the scene guard, waits on _RAM_D186_/_RAM_D187_, requests a slot spawn when possible, then selects horizontal velocity.', ['_LABEL_8467_', '_LABEL_847F_'], ['_RAM_C480_', '_RAM_D15D_', '_RAM_D156_', '_RAM_D16E_', '_RAM_D17E_', '_RAM_D17F_', '_RAM_D186_', '_RAM_D187_']),
  state(0x08DAB, '_LABEL_8DAB_', 3, '_DATA_8D60_', 'bank2_scene_4_approach_state', '_LABEL_8DAB_ bank-2 scene 4 approach state', 'Approaches the player/center threshold, flips direction and velocity as needed, and enters a dash/impact state with sound/effect $36.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_847F_', '_LABEL_104B_'], ['_RAM_C243_', '_RAM_D151_', '_RAM_D15D_', '_RAM_D156_', '_RAM_D16E_', '_RAM_D17F_']),
  state(0x08E08, '_LABEL_8E08_', 4, '_DATA_8D60_', 'bank2_scene_4_rebound_state', '_LABEL_8E08_ bank-2 scene 4 rebound state', 'Waits for _RAM_D17F_ bit 7, reverses _RAM_D156_, normalizes _RAM_D15D_, and advances state.', ['_LABEL_8467_'], ['_RAM_D156_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_']),
  state(0x08E30, '_LABEL_8E30_', 5, '_DATA_8D60_', 'bank2_scene_4_exit_threshold_state', '_LABEL_8E30_ bank-2 scene 4 exit threshold', 'Runs motion until _RAM_D151_ crosses a side-specific threshold, then resets through _LABEL_8E56_.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_8E56_'], ['_RAM_D151_', '_RAM_D157_']),
  routine(0x08E56, '_LABEL_8E56_', 'bank2_scene_4_loop_reset', '_LABEL_8E56_ bank-2 scene 4 loop reset', 'Resets scene-4 direction, spawn counters, and state to the timed spawn delay.', {
    family: 'bank2_scene_state_handler',
    calls: ['_LABEL_8BAE_'],
    ramRefs: ['_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D186_', '_RAM_D187_'],
  }),
  state(0x08E6F, '_LABEL_8E6F_', 1, '_DATA_8D60_', 'bank2_scene_4_entry_complete_state', '_LABEL_8E6F_ bank-2 scene 4 entry complete', 'Completes scene-4 entry and sets the initial direction/state for the loop reset path.', ['_LABEL_9980_', '_LABEL_994A_', '_LABEL_847F_'], ['_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_']),
  state(0x08E8C, '_LABEL_8E8C_', 6, '_DATA_8D60_', 'bank2_scene_4_retrigger_state', '_LABEL_8E8C_ bank-2 scene 4 retrigger state', 'Waits for _RAM_D17F_ bit 7 and then returns to the loop reset path.', ['_LABEL_8467_', '_LABEL_8E56_'], ['_RAM_D17F_']),
];

const CONTROLLER5_STATES = [
  routine(0x090C6, '_LABEL_90C6_', 'bank2_scene_5_state_dispatcher', '_LABEL_90C6_ bank-2 scene 5 state dispatcher', 'Dispatches scene-5 state handlers through the 16-entry 0x90CA table indexed by _RAM_D16E_.', {
    family: 'bank2_scene_state_dispatcher',
    calls: ['_LABEL_90EA_', '_LABEL_911B_', '_LABEL_913C_', '_LABEL_9160_', '_LABEL_9181_', '_LABEL_91A5_', '_LABEL_91C6_', '_LABEL_91EA_', '_LABEL_920B_', '_LABEL_922F_', '_LABEL_924E_', '_LABEL_9259_', '_LABEL_9278_', '_LABEL_9283_', '_LABEL_929D_', '_LABEL_816A_'],
    ramRefs: ['_RAM_D16E_'],
    evidence: ['_LABEL_90C6_ loads _RAM_D16E_ and dispatches through _DATA_90CA_ with RST $20.'],
  }),
  state(0x090EA, '_LABEL_90EA_', 1, '_DATA_90CA_', 'bank2_scene_5_entry_complete_state', '_LABEL_90EA_ bank-2 scene 5 entry complete', 'Completes scene-5 entry, toggles _RAM_D191_, clears _RAM_D14F_ bit 7, and chooses the next transition family from random bits and player side.', ['_LABEL_9980_', '_LABEL_994A_', '_LABEL_D36_', '_LABEL_847F_', '_LABEL_92DF_', '_LABEL_9310_', '_LABEL_9332_', '_LABEL_9369_'], ['_RAM_D14F_', '_RAM_D191_']),
  state(0x0911B, '_LABEL_911B_', 2, '_DATA_90CA_', 'bank2_scene_5_transition_choice_state_2', '_LABEL_911B_ bank-2 scene 5 transition-choice state 2', 'Runs motion/bounds helpers and, once _RAM_D14F_ bit 7 is set, selects a next state from the 0x9134 choice table.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_94A4_', '_LABEL_93DA_', '_LABEL_92B7_'], ['_RAM_D14F_']),
  state(0x0913C, '_LABEL_913C_', 3, '_DATA_90CA_', 'bank2_scene_5_transition_choice_state_3', '_LABEL_913C_ bank-2 scene 5 transition-choice state 3', 'Runs motion/bounds helpers and selects a next state from the 0x9158 choice table after the transition flag is set.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_941F_', '_LABEL_94A4_', '_LABEL_92B7_'], ['_RAM_D14F_']),
  state(0x09160, '_LABEL_9160_', 4, '_DATA_90CA_', 'bank2_scene_5_transition_choice_state_4', '_LABEL_9160_ bank-2 scene 5 transition-choice state 4', 'Runs motion/bounds helpers and selects a next state from the 0x9179 choice table after the transition flag is set.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_93DA_', '_LABEL_92B7_'], ['_RAM_D14F_']),
  state(0x09181, '_LABEL_9181_', 5, '_DATA_90CA_', 'bank2_scene_5_transition_choice_state_5', '_LABEL_9181_ bank-2 scene 5 transition-choice state 5', 'Runs motion/bounds helpers and selects a next state from the 0x919D choice table after the transition flag is set.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_941F_', '_LABEL_92B7_'], ['_RAM_D14F_']),
  state(0x091A5, '_LABEL_91A5_', 6, '_DATA_90CA_', 'bank2_scene_5_transition_choice_state_6', '_LABEL_91A5_ bank-2 scene 5 transition-choice state 6', 'Runs motion/bounds helpers and selects a next state from the 0x91BE choice table after the transition flag is set.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_93DA_', '_LABEL_92B7_'], ['_RAM_D14F_']),
  state(0x091C6, '_LABEL_91C6_', 7, '_DATA_90CA_', 'bank2_scene_5_transition_choice_state_7', '_LABEL_91C6_ bank-2 scene 5 transition-choice state 7', 'Runs motion/bounds helpers and selects a next state from the 0x91E2 choice table after the transition flag is set.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_941F_', '_LABEL_92B7_'], ['_RAM_D14F_']),
  state(0x091EA, '_LABEL_91EA_', 8, '_DATA_90CA_', 'bank2_scene_5_transition_choice_state_8', '_LABEL_91EA_ bank-2 scene 5 transition-choice state 8', 'Runs motion/bounds helpers and selects a next state from the 0x9203 choice table after the transition flag is set.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_93DA_', '_LABEL_92B7_'], ['_RAM_D14F_']),
  state(0x0920B, '_LABEL_920B_', 9, '_DATA_90CA_', 'bank2_scene_5_transition_choice_state_9', '_LABEL_920B_ bank-2 scene 5 transition-choice state 9', 'Runs motion/bounds helpers and selects a next state from the 0x9227 choice table after the transition flag is set.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_941F_', '_LABEL_92B7_'], ['_RAM_D14F_']),
  state(0x0922F, '_LABEL_922F_', 10, '_DATA_90CA_', 'bank2_scene_5_timed_motion_state_10', '_LABEL_922F_ bank-2 scene 5 timed motion state 10', 'Runs a timed motion state that decrements _RAM_D18E_ and branches into the 0x924E/0x9259 continuation handlers.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_94A4_', '_LABEL_924E_', '_LABEL_9259_'], ['_RAM_D18E_']),
  state(0x0924E, '_LABEL_924E_', 14, '_DATA_90CA_', 'bank2_scene_5_left_continuation', '_LABEL_924E_ bank-2 scene 5 left continuation', 'Continuation helper that sets _RAM_D17E_ bit 0 and clears _RAM_D14F_ bit 7 before returning to the scene-5 state table.', [], ['_RAM_D14F_', '_RAM_D17E_']),
  state(0x09259, '_LABEL_9259_', 11, '_DATA_90CA_', 'bank2_scene_5_timed_motion_state_11', '_LABEL_9259_ bank-2 scene 5 timed motion state 11', 'Runs the mirrored timed motion state that decrements _RAM_D18E_ and branches into the 0x9278 continuation when finished.', ['_LABEL_8467_', '_LABEL_98A9_', '_LABEL_941F_', '_LABEL_9278_'], ['_RAM_D18E_']),
  state(0x09278, '_LABEL_9278_', 15, '_DATA_90CA_', 'bank2_scene_5_right_continuation', '_LABEL_9278_ bank-2 scene 5 right continuation', 'Continuation helper paired with _LABEL_9259_; sets spawn/transition flags after the timed motion completes.', [], ['_RAM_D14F_', '_RAM_D17E_']),
  state(0x09283, '_LABEL_9283_', 12, '_DATA_90CA_', 'bank2_scene_5_delay_then_state_10', '_LABEL_9283_ bank-2 scene 5 delay to state 10', 'Delay state that waits on _RAM_D186_ and then enters state 10.', ['_LABEL_8467_'], ['_RAM_D16E_', '_RAM_D186_']),
  state(0x0929D, '_LABEL_929D_', 13, '_DATA_90CA_', 'bank2_scene_5_delay_then_state_11', '_LABEL_929D_ bank-2 scene 5 delay to state 11', 'Delay state that waits on _RAM_D186_ and then enters state 11.', ['_LABEL_8467_'], ['_RAM_D16E_', '_RAM_D186_']),
  routine(0x092B7, '_LABEL_92B7_', 'bank2_scene_5_transition_choice_dispatcher', '_LABEL_92B7_ bank-2 scene 5 transition-choice dispatcher', 'Indexes a caller-provided eight-entry transition-choice table with a random low-three-bit value and dispatches through the 0x92C8 transition table.', {
    family: 'bank2_scene_state_handler',
    calls: ['_LABEL_D36_'],
    ramRefs: ['_DATA_92C8_'],
    evidence: ['The bank2StateMachineAudit confirms the choice tables at 0x9134, 0x9158, 0x9179, 0x919D, 0x91BE, 0x91E2, 0x9203, and 0x9227.'],
  }),
  routine(0x092DD, '_LABEL_92DD_', 'bank2_scene_5_init_record_noop', '_LABEL_92DD_ bank-2 scene 5 init-record return', 'Return-only routine used as one scene-5 init-record pointer.', {
    family: 'bank2_scene_state_handler',
    evidence: ['_DATA_90A0_ contains a pointer to _LABEL_92DD_ inside the 0x9096 init-record stream.'],
  }),
];

const TRANSITION_HELPERS = [
  routine(0x092DF, '_LABEL_92DF_', 'bank2_scene_5_transition_0A', '_LABEL_92DF_ bank-2 scene 5 transition 0A', 'Transition helper that stores state $0A and horizontal/vertical motion parameters, then marks _RAM_D17F_ bit 0.', {
    family: 'bank2_scene_state_handler',
    ramRefs: ['_RAM_D156_', '_RAM_D158_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D18E_'],
  }),
  routine(0x09310, '_LABEL_9310_', 'bank2_scene_5_transition_0B', '_LABEL_9310_ bank-2 scene 5 transition 0B', 'Transition helper paired with _LABEL_92DF_ that stores state $0B and mirrored motion parameters.', {
    family: 'bank2_scene_state_handler',
    ramRefs: ['_RAM_D156_', '_RAM_D158_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D18E_'],
  }),
  routine(0x09332, '_LABEL_9332_', 'bank2_scene_5_transition_0C', '_LABEL_9332_ bank-2 scene 5 transition 0C', 'Transition helper that enters state $0C, sets a delay and motion parameters, and marks the render-state dirty flag.', {
    family: 'bank2_scene_state_handler',
    ramRefs: ['_RAM_D156_', '_RAM_D158_', '_RAM_D15D_', '_RAM_D16E_', '_RAM_D17F_', '_RAM_D186_'],
  }),
  routine(0x09369, '_LABEL_9369_', 'bank2_scene_5_transition_0D', '_LABEL_9369_ bank-2 scene 5 transition 0D', 'Transition helper paired with _LABEL_9332_ for the alternate state $0D path.', {
    family: 'bank2_scene_state_handler',
    ramRefs: ['_RAM_D15D_', '_RAM_D16E_'],
  }),
  routine(0x0937F, '_LABEL_937F_', 'bank2_vertical_motion_helper', '_LABEL_937F_ bank-2 vertical motion helper', 'Applies signed vertical velocity _RAM_D158_ to the D153/D154 fixed-point position.', {
    family: 'bank2_scene_motion_helper',
    ramRefs: ['_RAM_D153_', '_RAM_D154_', '_RAM_D155_', '_RAM_D158_', '_RAM_D159_'],
  }),
  routine(0x09399, '_LABEL_9399_', 'bank2_scene_5_random_spawn_gate', '_LABEL_9399_ bank-2 scene 5 random spawn gate', 'Uses the 0x93D2 mask table and the pseudo-random byte to decide whether to set a spawn/transition request.', {
    family: 'bank2_scene_motion_helper',
    calls: ['_LABEL_D36_'],
    ramRefs: ['_DATA_93D2_', '_RAM_D17E_', '_RAM_D18E_', '_RAM_D18F_'],
  }),
  routine(0x093DA, '_LABEL_93DA_', 'bank2_scene_5_horizontal_bounds_left', '_LABEL_93DA_ bank-2 scene 5 horizontal bounds helper', 'Applies horizontal motion and sets _RAM_D14F_ bit 7 when the D151 position crosses side-specific bounds.', {
    family: 'bank2_scene_motion_helper',
    ramRefs: ['_RAM_D14F_', '_RAM_D150_', '_RAM_D151_', '_RAM_D156_', '_RAM_D157_', '_RAM_D191_'],
  }),
  routine(0x0941F, '_LABEL_941F_', 'bank2_scene_5_horizontal_bounds_right', '_LABEL_941F_ bank-2 scene 5 mirrored horizontal bounds helper', 'Mirrored horizontal bounds helper paired with _LABEL_93DA_; it applies horizontal motion and sets _RAM_D14F_ bit 7 on boundary contact.', {
    family: 'bank2_scene_motion_helper',
    ramRefs: ['_RAM_D14F_', '_RAM_D150_', '_RAM_D151_', '_RAM_D156_', '_RAM_D157_', '_RAM_D191_'],
  }),
  routine(0x094A4, '_LABEL_94A4_', 'bank2_scene_5_vertical_bounds_helper', '_LABEL_94A4_ bank-2 scene 5 vertical bounds helper', 'Applies vertical motion/bounds and sets the transition flag when D154 crosses the configured bound.', {
    family: 'bank2_scene_motion_helper',
    ramRefs: ['_RAM_D14F_', '_RAM_D153_', '_RAM_D154_', '_RAM_D158_'],
  }),
  routine(0x094BF, '_LABEL_94BF_', 'bank2_scene_5_x_threshold_test_low', '_LABEL_94BF_ bank-2 scene 5 low X-threshold test', 'Tests _RAM_D151_ against a low signed threshold.', {
    family: 'bank2_scene_motion_helper',
    ramRefs: ['_RAM_D151_'],
  }),
  routine(0x094CB, '_LABEL_94CB_', 'bank2_scene_5_y_threshold_C0', '_LABEL_94CB_ bank-2 scene 5 Y threshold $C0', 'Shared Y-threshold helper that uses $00C0 as the clamp/test bound.', {
    family: 'bank2_scene_motion_helper',
    ramRefs: ['_RAM_D153_', '_RAM_D154_'],
  }),
  routine(0x094D0, '_LABEL_94D0_', 'bank2_scene_5_y_threshold_60', '_LABEL_94D0_ bank-2 scene 5 Y threshold $60', 'Shared Y-threshold helper that uses $0060 as the clamp/test bound.', {
    family: 'bank2_scene_motion_helper',
    ramRefs: ['_RAM_D153_', '_RAM_D154_'],
  }),
  routine(0x094EB, '_LABEL_94EB_', 'bank2_scene_5_y_compare_48', '_LABEL_94EB_ bank-2 scene 5 Y compare $48', 'Compares _RAM_D154_ against $0048 and returns the carry result.', {
    family: 'bank2_scene_motion_helper',
    ramRefs: ['_RAM_D154_'],
  }),
  routine(0x094F9, '_LABEL_94F9_', 'bank2_scene_5_y_low_bound_FEC1', '_LABEL_94F9_ bank-2 scene 5 low Y bound $FEC1', 'Y lower-bound helper using $FEC1.', {
    family: 'bank2_scene_motion_helper',
    ramRefs: ['_RAM_D153_', '_RAM_D154_'],
  }),
  routine(0x094FE, '_LABEL_94FE_', 'bank2_scene_5_y_low_bound_FF19', '_LABEL_94FE_ bank-2 scene 5 low Y bound $FF19', 'Y lower-bound helper using $FF19.', {
    family: 'bank2_scene_motion_helper',
    ramRefs: ['_RAM_D153_', '_RAM_D154_'],
  }),
  routine(0x0951A, '_LABEL_951A_', 'bank2_scene_5_y_threshold_FF31', '_LABEL_951A_ bank-2 scene 5 Y threshold $FF31', 'Compares _RAM_D154_ against $FF31.', {
    family: 'bank2_scene_motion_helper',
    ramRefs: ['_RAM_D154_'],
  }),
  routine(0x09526, '_LABEL_9526_', 'bank2_scene_5_random_y_lookup', '_LABEL_9526_ bank-2 scene 5 random Y lookup', 'Indexes the 0x9540 Y-position lookup with a random low-three-bit value and stores the result in _RAM_D154_/_RAM_D153_.', {
    family: 'bank2_scene_motion_helper',
    calls: ['_LABEL_D36_'],
    ramRefs: ['_DATA_9540_', '_RAM_D153_', '_RAM_D154_'],
  }),
  routine(0x09548, '_LABEL_9548_', 'bank2_scene_5_random_x_lookup', '_LABEL_9548_ bank-2 scene 5 random X lookup', 'Indexes the 0x955E X-position lookup with a random low-three-bit value and stores the result in _RAM_D151_.', {
    family: 'bank2_scene_motion_helper',
    calls: ['_LABEL_D36_'],
    ramRefs: ['_DATA_955E_', '_RAM_D151_'],
  }),
];

const VDP_STREAM_AND_MATH = [
  routine(0x096FE, '_LABEL_96FE_', 'bank2_vdp_stream_script_tick', '_LABEL_96FE_ bank-2 VDP stream script tick', 'Ticks the scene VDP stream script pointer in _RAM_D170_, resolves control opcodes through the 0x9749 table, and updates tile/script pointers used by _LABEL_978E_.', {
    family: 'bank2_vdp_stream_runtime',
    calls: ['_LABEL_972B_'],
    ramRefs: ['_RAM_D15A_', '_RAM_D15D_', '_RAM_D15E_', '_RAM_D16F_', '_RAM_D170_', '_RAM_D172_', '_RAM_D174_', '_RAM_D176_', '_RAM_D180_', '_RAM_D182_'],
  }),
  routine(0x0972B, '_LABEL_972B_', 'bank2_vdp_stream_record_loader', '_LABEL_972B_ bank-2 VDP stream record loader', 'Loads the next VDP stream record, either installing delay/pointer words or dispatching an $F1+ control opcode.', {
    family: 'bank2_vdp_stream_runtime',
    calls: ['_LABEL_9755_', '_LABEL_9762_', '_LABEL_9767_', '_LABEL_976D_', '_LABEL_977B_', '_LABEL_9785_'],
    ramRefs: ['_RAM_D15E_', '_RAM_D16F_', '_RAM_D170_', '_RAM_D172_', '_RAM_D174_', '_RAM_D176_', '_RAM_D180_', '_RAM_D182_'],
  }),
  routine(0x09755, '_LABEL_9755_', 'bank2_vdp_stream_control_end', '_LABEL_9755_ bank-2 VDP stream control end', 'VDP stream control handler that clears the delay and marks _RAM_D17F_ bit 7.', {
    family: 'bank2_vdp_stream_runtime',
    dispatchTable: '_DATA_9749_',
    dispatchIndex: 0,
    ramRefs: ['_RAM_D15E_', '_RAM_D17F_'],
  }),
  routine(0x09762, '_LABEL_9762_', 'bank2_vdp_stream_control_restart', '_LABEL_9762_ bank-2 VDP stream control restart', 'VDP stream control handler that jumps back to the saved _RAM_D172_ stream pointer.', {
    family: 'bank2_vdp_stream_runtime',
    dispatchTable: '_DATA_9749_',
    dispatchIndex: 1,
    calls: ['_LABEL_972B_'],
    ramRefs: ['_RAM_D172_'],
  }),
  routine(0x0978E, '_LABEL_978E_', 'bank2_vdp_stream_renderer', '_LABEL_978E_ bank-2 VDP stream renderer', 'Renders the current VDP stream into the name table region, applying horizontal clipping from _RAM_D151_ and tile-row base from _RAM_D154_.', {
    family: 'bank2_vdp_stream_runtime',
    ramRefs: ['_RAM_D151_', '_RAM_D152_', '_RAM_D154_', '_RAM_D176_', '_RAM_D178_', '_RAM_D17A_', '_RAM_D17B_'],
    evidence: ['_LABEL_978E_ writes to Port_VDPAddress and Port_VDPData while interpreting stream control bytes >= $F0.'],
  }),
  routine(0x098A9, '_LABEL_98A9_', 'bank2_horizontal_position_integrator', '_LABEL_98A9_ bank-2 horizontal position integrator', 'Applies signed velocity _RAM_D156_ to the D150/D151/D152 fixed-point horizontal position.', {
    family: 'bank2_scene_motion_helper',
    calls: ['_LABEL_9AD3_'],
    ramRefs: ['_RAM_D150_', '_RAM_D151_', '_RAM_D152_', '_RAM_D156_'],
  }),
  routine(0x098BD, '_LABEL_98BD_', 'bank2_horizontal_acceleration_helper', '_LABEL_98BD_ bank-2 horizontal acceleration helper', 'Scales _RAM_D16C_ into a signed acceleration and applies it to _RAM_D156_.', {
    family: 'bank2_scene_motion_helper',
    ramRefs: ['_RAM_D156_', '_RAM_D16C_'],
  }),
  routine(0x098DA, '_LABEL_98DA_', 'bank2_bounded_horizontal_oscillator', '_LABEL_98DA_ bank-2 bounded horizontal oscillator', 'Integrates horizontal position, flips _RAM_D16C_ at D18F/D190 bounds, and clamps _RAM_D156_ against _RAM_D191_.', {
    family: 'bank2_scene_motion_helper',
    calls: ['_LABEL_98A9_', '_LABEL_98BD_'],
    ramRefs: ['_RAM_D151_', '_RAM_D156_', '_RAM_D16C_', '_RAM_D18E_', '_RAM_D18F_', '_RAM_D190_', '_RAM_D191_', '_RAM_D193_'],
  }),
  routine(0x0994A, '_LABEL_994A_', 'bank2_signed_deceleration_helper', '_LABEL_994A_ bank-2 signed deceleration helper', 'Integrates horizontal position and damps _RAM_D156_ toward zero using _RAM_D16C_.', {
    family: 'bank2_scene_motion_helper',
    calls: ['_LABEL_98A9_'],
    ramRefs: ['_RAM_D156_', '_RAM_D157_', '_RAM_D16C_'],
  }),
  routine(0x09980, '_LABEL_9980_', 'bank2_object_list_consumer', '_LABEL_9980_ bank-2 object-list consumer', 'Consumes object-list records from _RAM_D180_, copies them to _RAM_D162_, and tests them through _LABEL_1D76_.', {
    family: 'bank2_scene_motion_helper',
    calls: ['_LABEL_1D76_'],
    ramRefs: ['_RAM_D14E_', '_RAM_D162_', '_RAM_D180_'],
  }),
  routine(0x099A1, '_LABEL_99A1_', 'bank2_damage_contact_consumer', '_LABEL_99A1_ bank-2 damage/contact consumer', 'Consumes contact records from _RAM_D182_, applies player overlap checks, updates the D16A meter, and redraws it through _LABEL_9A44_.', {
    family: 'bank2_scene_motion_helper',
    calls: ['_LABEL_1E4E_', '_LABEL_1EC8_', '_LABEL_1D10_', '_LABEL_9A44_'],
    ramRefs: ['_RAM_C240_', '_RAM_C24F_', '_RAM_C258_', '_RAM_D14E_', '_RAM_D162_', '_RAM_D16A_', '_RAM_D17D_', '_RAM_D182_'],
  }),
  routine(0x09A9F, '_LABEL_9A9F_', 'bank2_meter_vdp_init', '_LABEL_9A9F_ bank-2 meter VDP initializer', 'Runs the 0x9AA8 VDP stream and then redraws the D16A meter.', {
    family: 'bank2_vdp_stream_runtime',
    calls: ['_LABEL_604_', '_LABEL_9A44_'],
    ramRefs: ['_DATA_9AA8_'],
  }),
  routine(0x09AC2, '_LABEL_9AC2_', 'bank2_clear_object_slots', '_LABEL_9AC2_ bank-2 clear object slots', 'Clears B 0x40-byte object slots starting at IX and resets _RAM_D17E_ bit 1.', {
    family: 'bank2_object_slot_driver',
    ramRefs: ['_RAM_D17E_', 'IX+0'],
  }),
  routine(0x09AD3, '_LABEL_9AD3_', 'bank2_signed_24bit_add_helper', '_LABEL_9AD3_ bank-2 signed 24-bit add helper', 'Shared helper that adds signed DE into HL with A as the high byte, preserving sign/carry semantics for fixed-point movement.', {
    family: 'bank2_scene_motion_helper',
  }),
];

const ROUTINES = [
  ...TOP_LEVEL,
  ...CONTROLLER0_STATES,
  ...SHARED_STATES,
  ...SLOT_ROUTINES,
  ...CONTROLLER1_STATES,
  ...CONTROLLER2_STATES,
  ...CONTROLLER3_STATES,
  ...CONTROLLER4_STATES,
  ...CONTROLLER5_STATES,
  ...TRANSITION_HELPERS,
  ...VDP_STREAM_AND_MATH,
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
  if (!region || region.type !== 'code') return false;
  const keys = Object.keys(region.analysis || {});
  return keys.length === 1 && keys[0] === 'inferred';
}

function wasInferredOnlyBeforeThisAudit(region) {
  const existing = region?.analysis?.bank2SceneRoutineAudit;
  if (existing?.catalogId === catalogId && typeof existing.wasInferredOnlyBeforeAudit === 'boolean') {
    return existing.wasInferredOnlyBeforeAudit;
  }
  return wasInferredOnly(region);
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      routineCount: ROUTINES.length,
      topLevelControllers: TOP_LEVEL.length,
      stateHandlers: ROUTINES.filter(r => r.family === 'bank2_scene_state_handler').length,
      stateDispatchers: ROUTINES.filter(r => r.family === 'bank2_scene_state_dispatcher').length,
      objectSlotDrivers: ROUTINES.filter(r => r.family === 'bank2_object_slot_driver').length,
      vdpRuntimeRoutines: ROUTINES.filter(r => r.family === 'bank2_vdp_stream_runtime').length,
      motionHelpers: ROUTINES.filter(r => r.family === 'bank2_scene_motion_helper').length,
      assetPolicy: 'Metadata only: ASM labels, offsets, routine roles, RAM references, dispatch-table provenance, calls, and evidence. No ROM bytes or decoded assets are embedded.',
    },
    entries: ROUTINES.map(item => {
      const region = findExactRegion(mapData, item.offset);
      return {
        offset: hex(item.offset),
        label: item.label,
        type: 'code',
        role: item.role,
        name: item.name,
        family: item.family,
        confidence: item.confidence,
        dispatchTable: item.dispatchTable,
        dispatchIndex: item.dispatchIndex,
        indexRam: item.indexRam,
        calls: item.calls,
        ramRefs: item.ramRefs,
        summary: item.summary,
        evidence: item.evidence,
        region: regionRef(region),
        wasInferredOnlyBeforeAudit: wasInferredOnlyBeforeThisAudit(region),
      };
    }),
  };
}

function annotateRegion(region, item) {
  const previousName = region.name || '';
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  if (!region.name) region.name = item.name;
  region.analysis = region.analysis || {};
  region.analysis.bank2SceneRoutineAudit = {
    catalogId,
    family: item.family,
    role: item.role,
    confidence: item.confidence,
    label: item.label,
    dispatchTable: item.dispatchTable,
    dispatchIndex: item.dispatchIndex,
    indexRam: item.indexRam,
    calls: item.calls,
    ramRefs: item.ramRefs,
    summary: item.summary,
    evidence: item.evidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    label: item.label,
    role: item.role,
    family: item.family,
    previousName,
    name: region.name || '',
    wasInferredOnlyBeforeAudit: region.analysis.bank2SceneRoutineAudit.wasInferredOnlyBeforeAudit,
  };
}

function applyAnnotations(mapData) {
  const annotated = [];
  const missing = [];
  for (const item of ROUTINES) {
    const region = findExactRegion(mapData, item.offset);
    if (!region) {
      missing.push({ offset: hex(item.offset), label: item.label, role: item.role });
      continue;
    }
    annotated.push(annotateRegion(region, item));
  }
  return { annotated, missing };
}

function annotatedRegionRefs(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.bank2SceneRoutineAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      role: region.analysis.bank2SceneRoutineAudit.role,
      family: region.analysis.bank2SceneRoutineAudit.family,
      confidence: region.analysis.bank2SceneRoutineAudit.confidence,
      wasInferredOnlyBeforeAudit: region.analysis.bank2SceneRoutineAudit.wasInferredOnlyBeforeAudit,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const changes = applyAnnotations(mapData);
  const catalog = buildCatalog(mapData);

  if (apply) {
    mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(item => item.id !== catalogId);
    mapData.entityBehaviorCatalogs.push(catalog);
    const annotatedRegions = annotatedRegionRefs(mapData);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_scene_routine_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
        missingRegions: changes.missing.length,
        inferredOnlyRegionsCovered: annotatedRegions.filter(region => region.wasInferredOnlyBeforeAudit).length,
      },
      annotatedRegions,
      missingRegions: changes.missing,
      nextLeads: [
        'Correlate the six top-level _RAM_D1AE_ scene controllers with actual rooms/screens by tracing callers that assign _RAM_D1AE_.',
        'Build a read-only D15x/D16x scene-state visualizer for _LABEL_96FE_/_LABEL_978E_ streams before porting these routines to JavaScript.',
        'Trace the eight 0x40-byte object slots at _RAM_C3C0_ during these controllers to name the emitted projectile/enemy families.',
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
