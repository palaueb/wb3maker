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
const catalogId = 'world-entity-runtime-routine-catalog-2026-06-25';
const reportId = 'entity-runtime-routine-audit-2026-06-25';
const toolName = 'tools/world-entity-runtime-routine-audit.mjs';

const ENTRIES = [
  {
    offset: 0x061CE,
    label: '_LABEL_61CE_',
    type: 'code',
    role: 'd0a4_pair_slot_scheduler',
    name: '_LABEL_61CE_ D0A4 pair-slot scheduler',
    family: 'entity_runtime_scheduler',
    calls: ['_LABEL_104B_', '_LABEL_1318_', '_LABEL_6268_'],
    ramRefs: ['_RAM_D0A4_', '_RAM_C640_', '_RAM_C680_', '_RAM_C232_', '_RAM_C243_', '_RAM_C246_'],
    summary: 'Main-loop scheduler for a two-slot auxiliary actor pair at _RAM_C640_/_RAM_C680_; a _RAM_D0A4_ request initializes both slots around the player and queues sound/effect $37 or $38.',
    evidence: ['_LABEL_4BD_ calls _LABEL_61CE_ every gameplay loop before the auxiliary actor and room reward schedulers.', '_LABEL_61CE_ tests _RAM_D0A4_, initializes the two 0x40-byte slots at _RAM_C640_ and _RAM_C680_, and calls _LABEL_6268_ for active updates.'],
  },
  {
    offset: 0x06268,
    label: '_LABEL_6268_',
    type: 'code',
    role: 'd0a4_pair_slot_update',
    name: '_LABEL_6268_ D0A4 pair-slot update',
    family: 'entity_runtime_scheduler',
    calls: ['_LABEL_12D5_', '_LABEL_1B4B_', '_LABEL_1B25_'],
    ramRefs: ['IX+0', 'IX+20'],
    summary: 'Active update path for the D0A4 pair slots; it runs movement/collision helpers and clears the slot when IX+20 expires.',
    evidence: ['_LABEL_61CE_ jumps to _LABEL_6268_ when IX+1 bit 0 shows the pair slot is already initialized.'],
  },
  {
    offset: 0x0627A,
    label: '_LABEL_627A_',
    type: 'code',
    role: 'd21d_twelve_slot_request_scheduler',
    name: '_LABEL_627A_ D21D twelve-slot request scheduler',
    family: 'entity_runtime_scheduler',
    calls: ['_LABEL_104B_', '_LABEL_62C6_'],
    ramRefs: ['_RAM_D21D_', '_RAM_D21E_', '_RAM_D220_', '_RAM_C740_'],
    summary: 'Main-loop scheduler that consumes _RAM_D21D_ requests, chooses the oldest C740 slot group, seeds paired slots, and then runs the twelve-slot updater at _LABEL_62C6_.',
    evidence: ['_LABEL_4BD_ calls _LABEL_627A_ every gameplay loop after room reward sequencing.', '_LABEL_627A_ scans three 0x100-byte groups at _RAM_C740_, seeds paired slots, clears _RAM_D21D_, and queues sound/effect $34.'],
  },
  {
    offset: 0x062C6,
    label: '_LABEL_62C6_',
    type: 'code',
    role: 'c740_twelve_slot_updater',
    name: '_LABEL_62C6_ C740 twelve-slot updater',
    family: 'entity_runtime_scheduler',
    calls: ['_LABEL_635D_', '_LABEL_1318_', '_LABEL_12D5_', '_LABEL_1B25_', '_LABEL_6718_'],
    ramRefs: ['_RAM_C740_', '_RAM_D0FE_', '_RAM_D21E_', '_RAM_D220_', 'IX+0', 'IX+17', 'IX+33'],
    summary: 'Runs twelve 0x40-byte slots at _RAM_C740_, initializes new slots from _RAM_D21E_/_RAM_D220_, and clears slots that leave the active window.',
    evidence: ['_LABEL_62C6_ loads _RAM_D0FE_ with $0C, iterates IX by $40, initializes inactive requested slots, and calls _LABEL_6718_ to remove off-window slots.'],
  },
  {
    offset: 0x0635D,
    label: '_LABEL_635D_',
    type: 'code',
    role: 'room_event_lookup_side_effect',
    name: '_LABEL_635D_ room event lookup side-effect helper',
    family: 'entity_runtime_helper',
    calls: [],
    ramRefs: ['_RAM_CF60_', '_RAM_D1EB_', '_RAM_D025_', '_RAM_D001_', '_RAM_D003_', '_RAM_D026_', '_RAM_D028_', '_RAM_D029_', '_RAM_D21E_', '_RAM_D220_', '_RAM_C251_'],
    summary: 'Looks up the active room-event table at _RAM_CF60_ using tile/position-derived indexes and writes event/item side-effect fields in _RAM_D001_/_RAM_D025_/_RAM_D026_.',
    evidence: ['_LABEL_62C6_ calls _LABEL_635D_ during C740 slot initialization.', '_LABEL_635D_ switches to bank 4, scans the _RAM_CF60_ table, updates _RAM_D1EB_ flags, and writes _RAM_D025_/_RAM_D026_/_RAM_D028_/_RAM_D029_.'],
  },
  {
    offset: 0x06401,
    label: '_LABEL_6401_',
    type: 'code',
    role: 'd222_periodic_slot_scheduler',
    name: '_LABEL_6401_ D222 periodic slot scheduler',
    family: 'entity_runtime_scheduler',
    calls: ['_LABEL_1318_', '_LABEL_6498_'],
    ramRefs: ['_RAM_C241_', '_RAM_C243_', '_RAM_C246_', '_RAM_C251_', '_RAM_C257_', '_RAM_C6C0_', '_RAM_C700_', '_RAM_D0DE_', '_RAM_D222_', '_RAM_D223_'],
    summary: 'Main-loop periodic spawner for two slots at _RAM_C6C0_ and _RAM_C700_; it gates spawning through _RAM_D223_ and player/state position checks.',
    evidence: ['_LABEL_4BD_ calls _LABEL_6401_ every gameplay loop immediately before the OAM/sprite writer.', '_LABEL_6401_ tests _RAM_C241_ bit 6, compares _RAM_D222_ with the player Y sum, and initializes the _RAM_C6C0_/_RAM_C700_ slots with _DATA_64C5_.'],
  },
  {
    offset: 0x06498,
    label: '_LABEL_6498_',
    type: 'code',
    role: 'd222_periodic_slot_update',
    name: '_LABEL_6498_ D222 periodic slot update',
    family: 'entity_runtime_scheduler',
    calls: ['_LABEL_12D5_'],
    ramRefs: ['_DATA_64C5_', 'IX+0', 'IX+6', 'IX+9', 'IX+24', 'IX+25', 'IX+32', 'IX+33'],
    summary: 'Updates an active D222 periodic slot by stepping through the _DATA_64C5_ velocity pattern and clearing the slot after it reaches its target or times out.',
    evidence: ['_LABEL_6401_ jumps to _LABEL_6498_ for slots with IX+0 bit 7 set.', '_LABEL_6498_ advances the IX+24/IX+25 pattern pointer, writes IX+9, calls _LABEL_12D5_, and clears IX+0 on completion.'],
  },
  {
    offset: 0x064CD,
    label: '_LABEL_64CD_',
    type: 'code',
    role: 'room_entity_runtime_entry',
    name: '_LABEL_64CD_ room entity runtime entry',
    family: 'entity_runtime_scheduler',
    calls: ['_LABEL_6509_', '_LABEL_660D_', '_LABEL_7C65_'],
    ramRefs: ['_RAM_D0A0_', '_RAM_D0A2_', '_RAM_D0A3_', '_RAM_D0FE_', '_RAM_D0FF_', '_RAM_D00F_', '_RAM_D100_', '_RAM_D102_', '_RAM_D105_', '_RAM_D224_', '_RAM_C3C0_', '_RAM_D030_'],
    summary: 'Main-loop room entity runtime entry; it scans pending room entity records into C3C0 slots, updates active C3C0 entities, then updates the secondary C600 object stream.',
    evidence: ['_LABEL_4BD_ calls _LABEL_64CD_ every gameplay loop before room reward sequencing.', '_LABEL_64CD_ calls its local room-record scanner, then _LABEL_660D_, then _LABEL_7C65_, and finally clears _RAM_D224_.'],
  },
  {
    offset: 0x06509,
    label: '_LABEL_6509_',
    type: 'code',
    role: 'room_entity_record_scanner',
    name: '_LABEL_6509_ room entity record scanner',
    family: 'entity_runtime_scheduler',
    calls: ['_LABEL_65B9_'],
    ramRefs: ['_RAM_D030_', '_RAM_D00F_', '_RAM_D0FE_', '_RAM_D0FF_', '_RAM_D100_', '_RAM_D102_', '_RAM_D104_', '_RAM_D105_', '_RAM_D224_', '_RAM_C243_', '_RAM_C3C0_'],
    summary: 'Scans seven-byte room entity records in _RAM_D030_, rejects records outside the active window, finds a free C3C0 slot, and initializes it through _LABEL_65B9_.',
    evidence: ['_LABEL_64CD_ reaches _LABEL_6509_ after setting IX to _RAM_C3C0_, IY to _RAM_D030_, and active-window bounds in _RAM_D100_/_RAM_D102_.'],
  },
  {
    offset: 0x065B2,
    label: '_LABEL_65B2_',
    type: 'code',
    role: 'room_entity_spawn_reject',
    name: '_LABEL_65B2_ room entity spawn reject',
    family: 'entity_runtime_helper',
    calls: [],
    ramRefs: [],
    summary: 'Shared carry-return reject path used when a room entity record is outside the active spawn window.',
    evidence: ['The room-record scanner branches to _LABEL_65B2_ for out-of-window records before setting carry.'],
  },
  {
    offset: 0x065B9,
    label: '_LABEL_65B9_',
    type: 'code',
    role: 'c3c0_entity_slot_initializer',
    name: '_LABEL_65B9_ C3C0 entity slot initializer',
    family: 'entity_runtime_scheduler',
    calls: [],
    ramRefs: ['_RAM_D030_', '_RAM_D104_', '_RAM_D105_', '_RAM_C3C0_', 'IX+0', 'IX+15', 'IX+17', 'IX+46', 'IY+6'],
    summary: 'Copies one room entity record into a free C3C0 runtime slot, marks the source record spawned, and stores facing/index metadata in IX+17 and IX+46.',
    evidence: ['_LABEL_6509_ calls _LABEL_65B9_ only after locating a free IX slot; _LABEL_65B9_ copies IY+0..5 fields into IX fields and writes IY+6=$80.'],
  },
  {
    offset: 0x0660D,
    label: '_LABEL_660D_',
    type: 'code',
    role: 'c3c0_active_entity_dispatcher',
    name: '_LABEL_660D_ C3C0 active entity dispatcher',
    family: 'entity_runtime_scheduler',
    calls: ['_LABEL_6718_', '_LABEL_6757_', '_LABEL_1DAB_', '_LABEL_1E4E_', '_LABEL_1D76_', '_LABEL_6793_'],
    ramRefs: ['_RAM_C3C0_', '_RAM_D0A3_', '_RAM_D0FE_', 'IX+0', 'IX+1', 'IX+32', 'IX+38', 'IX+39', 'IX+47'],
    summary: 'Iterates active C3C0 entity slots, performs screen/contact/damage checks, and dispatches the active behavior through the per-slot behavior pointer table at IX+38/IX+39.',
    evidence: ['_LABEL_64CD_ calls _LABEL_660D_ after the room-record scanner.', '_LABEL_660D_ loops _RAM_D0A3_ slots and jumps through a pointer selected from IX+38/IX+39 and IX+32.'],
  },
  {
    offset: 0x0668E,
    label: '_DATA_668E_',
    type: 'entity_behavior_table',
    role: 'c3c0_entity_init_dispatch_table',
    name: '_DATA_668E_ C3C0 entity init dispatch table',
    family: 'entity_runtime_table',
    calls: ['_LABEL_6927_', '_LABEL_6974_', '_LABEL_69BE_', '_LABEL_6A49_', '_LABEL_6A7F_', '_LABEL_6AB5_', '_LABEL_6AC8_', '_LABEL_6CAB_', '_LABEL_6F66_'],
    ramRefs: ['_RAM_C3CF_'],
    summary: 'Sixty-nine-entry initialization dispatch table used by _LABEL_667C_ after masking IX+15; this is a real behavior table, not executable code.',
    evidence: ['_LABEL_667C_ loads IX+15, masks it, decrements it, and dispatches through RST $20 directly into _DATA_668E_.', 'The ASM comments identify _DATA_668E_ as a 69-entry jump table indexed by _RAM_C3CF_.'],
  },
  {
    offset: 0x06718,
    label: '_LABEL_6718_',
    type: 'code',
    role: 'entity_screen_window_check',
    name: '_LABEL_6718_ entity screen-window check',
    family: 'entity_runtime_helper',
    calls: [],
    ramRefs: ['_RAM_D00F_', 'IX+3', 'IX+4', 'IX+7'],
    summary: 'Checks whether an entity X coordinate is inside the active horizontal window around _RAM_D00F_, returning carry when it is outside.',
    evidence: ['_LABEL_660D_, _LABEL_62C6_, and _LABEL_7E79_ call _LABEL_6718_ before clearing active entity slots.'],
  },
  {
    offset: 0x06741,
    label: '_LABEL_6741_',
    type: 'code',
    role: 'room_entity_record_clear_active',
    name: '_LABEL_6741_ room entity record clear active',
    family: 'entity_runtime_helper',
    calls: [],
    ramRefs: ['_RAM_D030_', 'IX+46'],
    summary: 'Clears the source room entity record active byte derived from IX+46 and then clears the runtime slot.',
    evidence: ['Several entity init/update paths call _LABEL_6741_ when the associated room record should be retired.'],
  },
  {
    offset: 0x06757,
    label: '_LABEL_6757_',
    type: 'code',
    role: 'room_entity_record_clear_spawned',
    name: '_LABEL_6757_ room entity record clear spawned',
    family: 'entity_runtime_helper',
    calls: [],
    ramRefs: ['_RAM_D036_', 'IX+46'],
    summary: 'Clears the spawned flag byte for the source room entity record derived from IX+46 and then clears the runtime slot.',
    evidence: ['_LABEL_660D_ calls _LABEL_6757_ when _LABEL_6718_ reports an initialized entity has left the active window.'],
  },
  {
    offset: 0x0676D,
    label: '_LABEL_676D_',
    type: 'code',
    role: 'entity_behavior_metadata_loader',
    name: '_LABEL_676D_ entity behavior metadata loader',
    family: 'entity_runtime_helper',
    calls: [],
    ramRefs: ['_DATA_17D00_', '_RAM_FFFF_', 'IX+15', 'IX+24', 'IX+25', 'IX+28', 'IX+29'],
    summary: 'Loads behavior metadata for the current entity type from the bank-5 table at _DATA_17D00_, storing animation/pointer and hit/meter words into the IX runtime slot.',
    evidence: ['_LABEL_667C_ calls _LABEL_676D_ before dispatching through the 0x668E init table.', '_LABEL_676D_ switches bank 5 and indexes _DATA_17D00_ from IX+15.'],
  },
  {
    offset: 0x06793,
    label: '_LABEL_6793_',
    type: 'code',
    role: 'entity_meter_damage_apply',
    name: '_LABEL_6793_ entity meter damage apply',
    family: 'entity_runtime_helper',
    calls: ['_LABEL_104B_'],
    ramRefs: ['IX+28', 'IX+29', 'IX+32'],
    summary: 'Applies a damage/meter decrement against the IX+28/IX+29 word, switches behavior state on partial damage, and queues sound/effect $15 or $16.',
    evidence: ['_LABEL_660D_ calls _LABEL_6793_ after collision/damage helper calls return a hit amount in DE.'],
  },
  {
    offset: 0x068C7,
    label: '_LABEL_68C7_',
    type: 'code',
    role: 'entity_horizontal_speed_cap',
    name: '_LABEL_68C7_ entity horizontal speed cap',
    family: 'entity_runtime_helper',
    calls: [],
    ramRefs: ['IX+8', 'IX+9', 'IX+49'],
    summary: 'Caps the signed horizontal velocity word in IX+8/IX+9 against IX+49 and returns carry when clamped.',
    evidence: ['_LABEL_7D51_ and _LABEL_7DA3_ call _LABEL_68C7_ when IX+49 is nonzero during secondary object movement.'],
  },
  {
    offset: 0x06919,
    label: '_LABEL_6919_',
    type: 'code',
    role: 'entity_velocity_clear',
    name: '_LABEL_6919_ entity velocity clear',
    family: 'entity_runtime_helper',
    calls: [],
    ramRefs: ['IX+8', 'IX+9', 'IX+10', 'IX+11'],
    summary: 'Clears both signed velocity words in the current IX entity slot.',
    evidence: ['_LABEL_7E9C_ and _LABEL_7EE1_ call _LABEL_6919_ before switching secondary object states.'],
  },
  {
    offset: 0x07C65,
    label: '_LABEL_7C65_',
    type: 'code',
    role: 'c600_secondary_object_scheduler',
    name: '_LABEL_7C65_ C600 secondary object scheduler',
    family: 'secondary_object_runtime',
    calls: ['_LABEL_7D45_'],
    ramRefs: ['_RAM_D0A2_', '_RAM_D0FE_', '_RAM_C600_', '_RAM_FFFF_', 'IX+48', 'IX+49', 'IX+50', 'IX+51', 'IX+52', 'IX+53', 'IX+54', 'IX+55'],
    summary: 'Updates the secondary object stream in reverse 0x40-byte slots starting at _RAM_C600_; pending slots are initialized from object record streams before dispatching through the 0x7D49 state table.',
    evidence: ['_LABEL_64CD_ calls _LABEL_7C65_ after active C3C0 entity updates.', '_LABEL_7C65_ iterates _RAM_D0A2_ slots, initializes pending slots from IX+48/IX+50 record pointers, and calls _LABEL_7D45_.'],
  },
  {
    offset: 0x07D45,
    label: '_LABEL_7D45_',
    type: 'code',
    role: 'c600_secondary_state_dispatcher',
    name: '_LABEL_7D45_ C600 secondary state dispatcher',
    family: 'secondary_object_runtime',
    calls: ['_LABEL_7D51_', '_LABEL_7DA3_', '_LABEL_7DD4_', '_LABEL_7DFD_'],
    ramRefs: ['IX+52'],
    summary: 'Dispatches the secondary object state in IX+52 through the four-entry 0x7D49 state table.',
    evidence: ['_LABEL_7D45_ loads IX+52 and dispatches through _DATA_7D49_ with RST $20.'],
  },
  {
    offset: 0x07D49,
    label: '_DATA_7D49_',
    type: 'entity_behavior_table',
    role: 'c600_secondary_state_dispatch_table',
    name: '_DATA_7D49_ C600 secondary state dispatch table',
    family: 'secondary_object_runtime_table',
    calls: ['_LABEL_7D51_', '_LABEL_7DA3_', '_LABEL_7DD4_', '_LABEL_7DFD_'],
    ramRefs: ['IX+52', '_RAM_C634_'],
    summary: 'Four-entry secondary object state dispatch table used by _LABEL_7D45_; this is a real pointer table, not executable code.',
    evidence: ['_LABEL_7D45_ loads IX+52 and dispatches through RST $20 immediately before the ASM defines _DATA_7D49_.', 'The ASM comments identify _DATA_7D49_ as a four-entry jump table indexed by _RAM_C634_.'],
  },
  {
    offset: 0x07D51,
    label: '_LABEL_7D51_',
    type: 'code',
    role: 'c600_secondary_state_0_update',
    name: '_LABEL_7D51_ C600 secondary state 0 update',
    family: 'secondary_object_runtime',
    calls: ['_LABEL_7E41_', '_LABEL_1330_', '_LABEL_17AB_', '_LABEL_12D5_', '_LABEL_1B4B_', '_LABEL_1B25_', '_LABEL_68C7_', '_LABEL_7E79_'],
    ramRefs: ['IX+0', 'IX+27', 'IX+30', 'IX+31', 'IX+49', 'IX+55', 'IX+56'],
    summary: 'Secondary object state 0 update with optional collision pipeline, velocity capping, and cleanup through _LABEL_7E79_.',
    evidence: ['_DATA_7D49_ lists _LABEL_7D51_ as entry 0.'],
  },
  {
    offset: 0x07DA3,
    label: '_LABEL_7DA3_',
    type: 'code',
    role: 'c600_secondary_state_1_update',
    name: '_LABEL_7DA3_ C600 secondary state 1 update',
    family: 'secondary_object_runtime',
    calls: ['_LABEL_7E41_', '_LABEL_1330_', '_LABEL_12D5_', '_LABEL_1B4B_', '_LABEL_1B25_', '_LABEL_68C7_', '_LABEL_7E79_'],
    ramRefs: ['IX+0', 'IX+30', 'IX+31', 'IX+49'],
    summary: 'Secondary object state 1 update path that skips the full collision pipeline but keeps movement, velocity cap, and cleanup handling.',
    evidence: ['_DATA_7D49_ lists _LABEL_7DA3_ as entry 1.'],
  },
  {
    offset: 0x07DD4,
    label: '_LABEL_7DD4_',
    type: 'code',
    role: 'c600_secondary_state_2_update',
    name: '_LABEL_7DD4_ C600 secondary state 2 update',
    family: 'secondary_object_runtime',
    calls: ['_LABEL_7E41_', '_LABEL_1330_', '_LABEL_17AB_', '_LABEL_7E9C_', '_LABEL_1B25_', '_LABEL_1B4B_', '_LABEL_7E79_'],
    ramRefs: ['IX+0', 'IX+27'],
    summary: 'Secondary object state 2 update path that switches through _LABEL_7E9C_ when floor/contact bit 0 is set.',
    evidence: ['_DATA_7D49_ lists _LABEL_7DD4_ as entry 2.'],
  },
  {
    offset: 0x07DFD,
    label: '_LABEL_7DFD_',
    type: 'code',
    role: 'c600_secondary_state_3_update',
    name: '_LABEL_7DFD_ C600 secondary state 3 update',
    family: 'secondary_object_runtime',
    calls: ['_LABEL_7E41_', '_LABEL_1330_', '_LABEL_17AB_', '_LABEL_7EE1_', '_LABEL_1B25_', '_LABEL_1B4B_', '_LABEL_7E79_'],
    ramRefs: ['IX+0', 'IX+27'],
    summary: 'Secondary object state 3 update path that switches through _LABEL_7EE1_ when floor/contact bit 0 is set.',
    evidence: ['_DATA_7D49_ lists _LABEL_7DFD_ as entry 3.'],
  },
  {
    offset: 0x07E41,
    label: '_LABEL_7E41_',
    type: 'code',
    role: 'c600_secondary_first_tick_init',
    name: '_LABEL_7E41_ C600 secondary first-tick initializer',
    family: 'secondary_object_runtime',
    calls: ['_LABEL_1318_'],
    ramRefs: ['IX+1', 'IX+6', 'IX+17', 'IX+49', 'IX+50', 'IX+55', 'IX+56'],
    summary: 'Runs once after secondary object initialization, clears IX+1, stores starting Y in IX+56, resets timers, and starts the animation for the selected facing.',
    evidence: ['All four _DATA_7D49_ state handlers call _LABEL_7E41_ before movement/collision work.'],
  },
  {
    offset: 0x07E79,
    label: '_LABEL_7E79_',
    type: 'code',
    role: 'c600_secondary_active_cleanup_check',
    name: '_LABEL_7E79_ C600 secondary active cleanup check',
    family: 'secondary_object_runtime',
    calls: ['_LABEL_6718_', '_LABEL_1E02_', '_LABEL_1D76_', '_LABEL_1E9F_'],
    ramRefs: ['IX+0', 'IX+33'],
    summary: 'Shared cleanup predicate for secondary objects; it checks active-window bounds, contact flags, and a life timer before returning carry to clear the slot.',
    evidence: ['_LABEL_7D51_, _LABEL_7DA3_, _LABEL_7DD4_, and _LABEL_7DFD_ call _LABEL_7E79_ near the end of their update paths.'],
  },
  {
    offset: 0x07E9C,
    label: '_LABEL_7E9C_',
    type: 'code',
    role: 'c600_secondary_floor_response_a',
    name: '_LABEL_7E9C_ C600 secondary floor response A',
    family: 'secondary_object_runtime',
    calls: ['_LABEL_6919_'],
    ramRefs: ['_RAM_C243_', 'IX+3', 'IX+4', 'IX+6', 'IX+7', 'IX+17', 'IX+30', 'IX+31', 'IX+33', 'IX+49', 'IX+52', 'IX+55'],
    summary: 'Floor/contact response used by secondary state 2; it clears velocity, raises the object, selects a horizontal direction relative to the player, and switches state.',
    evidence: ['_LABEL_7DD4_ jumps to _LABEL_7E9C_ when IX+27 bit 0 is set.'],
  },
  {
    offset: 0x07EE1,
    label: '_LABEL_7EE1_',
    type: 'code',
    role: 'c600_secondary_floor_response_b',
    name: '_LABEL_7EE1_ C600 secondary floor response B',
    family: 'secondary_object_runtime',
    calls: ['_LABEL_6919_'],
    ramRefs: ['IX+6', 'IX+7', 'IX+17', 'IX+30', 'IX+31', 'IX+33', 'IX+52'],
    summary: 'Floor/contact response used by secondary state 3; it clears velocity, raises the object, starts a timed state, and marks facing as neutral.',
    evidence: ['_LABEL_7DFD_ jumps to _LABEL_7EE1_ when IX+27 bit 0 is set.'],
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
  const existing = region?.analysis?.entityRuntimeRoutineAudit;
  if (existing?.catalogId === catalogId && typeof existing.wasInferredOnlyBeforeAudit === 'boolean') {
    return existing.wasInferredOnlyBeforeAudit;
  }
  return wasInferredOnly(region);
}

function shouldRetype(region, targetType) {
  if (!region || !targetType || region.type === targetType) return false;
  if (targetType === 'entity_behavior_table') return ['code', 'pointer_table', 'data_table', 'unknown', 'raw_byte'].includes(region.type || 'unknown');
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
      schedulers: ENTRIES.filter(entry => entry.family === 'entity_runtime_scheduler').length,
      helpers: ENTRIES.filter(entry => entry.family === 'entity_runtime_helper').length,
      secondaryObjectRuntimeEntries: ENTRIES.filter(entry => entry.family === 'secondary_object_runtime').length,
      dispatchTables: ENTRIES.filter(entry => entry.family.endsWith('_table')).length,
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
  region.analysis.entityRuntimeRoutineAudit = {
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
    .filter(region => region.analysis?.entityRuntimeRoutineAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      role: region.analysis.entityRuntimeRoutineAudit.role,
      family: region.analysis.entityRuntimeRoutineAudit.family,
      confidence: region.analysis.entityRuntimeRoutineAudit.confidence,
      changedType: region.analysis.entityRuntimeRoutineAudit.changedType,
      wasInferredOnlyBeforeAudit: region.analysis.entityRuntimeRoutineAudit.wasInferredOnlyBeforeAudit,
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
      type: 'entity_runtime_routine_audit',
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
        'Name the 69 C3C0 initialization entries in _DATA_668E_ by grouping their shared behavior pointer tables and IX field constants.',
        'Split or annotate the unlabeled executable helper fragments at 0x67C1 and 0x68F0, which are still emitted as data by the disassembler.',
        'Trace _RAM_D0A0_/_RAM_D0A2_/_RAM_D0A3_ assignments in room loading to connect entity slot counts to room records and scene recipes.',
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
