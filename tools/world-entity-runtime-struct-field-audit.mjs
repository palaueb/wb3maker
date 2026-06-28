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
const catalogId = 'world-entity-runtime-struct-field-catalog-2026-06-25';
const reportId = 'entity-runtime-struct-field-audit-2026-06-25';
const toolName = 'tools/world-entity-runtime-struct-field-audit.mjs';

const sourceCatalogIds = {
  behaviorTargets: 'world-entity-behavior-table-target-catalog-2026-06-25',
  runtimeRoutines: 'world-entity-runtime-routine-catalog-2026-06-25',
  bank0Behavior: 'world-bank0-entity-behavior-catalog-2026-06-25',
  animationCallsites: 'world-animation-callsite-catalog-2026-06-25',
  animationTileBase: 'world-animation-tile-base-catalog-2026-06-25',
  motionCollision: 'world-entity-motion-collision-helper-catalog-2026-06-25',
};

const SLOT_FAMILIES = [
  {
    id: 'c3c0_room_entity_slots',
    baseAddress: 0xC3C0,
    baseLabel: '_RAM_C3C0_',
    slotSize: 0x40,
    role: 'active room entity runtime slots',
    confidence: 'high',
    evidence: [
      '_LABEL_64CD_ calls the room-record scanner, active C3C0 dispatcher, and C600 secondary scheduler every gameplay loop.',
      '_LABEL_6509_ scans _RAM_D030_ records, finds a free _RAM_C3C0_ slot, and initializes it through _LABEL_65B9_.',
      '_LABEL_660D_ iterates active C3C0 slots and dispatches behavior through IX+38/IX+39 and IX+32.',
    ],
  },
  {
    id: 'c600_secondary_object_slots',
    baseAddress: 0xC600,
    baseLabel: '_RAM_C600_',
    slotSize: 0x40,
    role: 'secondary object runtime slots',
    confidence: 'high',
    evidence: [
      '_LABEL_7C65_ updates secondary object slots in reverse from _RAM_C600_.',
      '_LABEL_7D45_ dispatches IX+52 through _DATA_7D49_.',
      '_DATA_7D49_ contains four confirmed secondary-object state handlers.',
    ],
  },
  {
    id: 'c640_c680_d0a4_pair_slots',
    baseAddress: 0xC640,
    baseLabels: ['_RAM_C640_', '_RAM_C680_'],
    slotSize: 0x40,
    slotCount: 2,
    role: 'D0A4 auxiliary actor pair slots',
    confidence: 'medium',
    evidence: [
      '_LABEL_61CE_ initializes the two 0x40-byte slots at _RAM_C640_ and _RAM_C680_ when _RAM_D0A4_ requests an effect.',
      '_LABEL_6268_ updates the active pair slots and clears them when IX+20 expires.',
    ],
  },
  {
    id: 'c6c0_c700_d222_periodic_slots',
    baseAddress: 0xC6C0,
    baseLabels: ['_RAM_C6C0_', '_RAM_C700_'],
    slotSize: 0x40,
    slotCount: 2,
    role: 'D222 periodic spawned slots',
    confidence: 'medium',
    evidence: [
      '_LABEL_6401_ gates periodic spawning through _RAM_D222_/_RAM_D223_ and initializes _RAM_C6C0_/_RAM_C700_.',
      '_LABEL_6498_ updates the active D222 slots using IX+24/IX+25 pattern bytes, IX+9 velocity, and IX+32/IX+33 state fields.',
    ],
  },
  {
    id: 'c740_twelve_slot_groups',
    baseAddress: 0xC740,
    baseLabel: '_RAM_C740_',
    slotSize: 0x40,
    slotCount: 12,
    role: 'D21D requested twelve-slot effect groups',
    confidence: 'medium',
    evidence: [
      '_LABEL_627A_ consumes _RAM_D21D_ requests and seeds slots in _RAM_C740_.',
      '_LABEL_62C6_ iterates twelve 0x40-byte C740 slots and clears off-window slots through _LABEL_6718_.',
    ],
  },
  {
    id: 'd030_room_entity_records',
    baseAddress: 0xD030,
    baseLabel: '_RAM_D030_',
    recordSize: 7,
    role: 'room entity source records',
    confidence: 'high',
    evidence: [
      '_LABEL_6509_ scans seven-byte room entity records at _RAM_D030_.',
      '_LABEL_65B9_ copies IY+0..5 into a runtime IX slot and writes IY+6=$80 to mark the source record spawned.',
    ],
  },
];

function field(register, offset, role, summary, options = {}) {
  return {
    register,
    offset,
    token: `${register}+${offset}`,
    role,
    fieldGroup: options.fieldGroup || role,
    size: options.size || 1,
    confidence: options.confidence || 'medium',
    families: options.families || ['current_ix_entity_slot'],
    summary,
    evidence: options.evidence || [],
  };
}

const FIELD_DEFS = [
  field('IX', 0, 'slot_flags_active', 'Active/visibility/control flags for the current runtime slot; multiple schedulers clear IX+0 to retire a slot.', {
    confidence: 'high',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots', 'c640_c680_d0a4_pair_slots', 'c6c0_c700_d222_periodic_slots', 'c740_twelve_slot_groups'],
    evidence: ['_LABEL_6268_, _LABEL_660D_, _LABEL_7D51_, and related handlers read or clear IX+0 as the active slot flag byte.'],
  }),
  field('IX', 1, 'state_flags_first_tick', 'State/first-tick flags; C3C0 initialization and C600 first-tick setup write and clear this byte.', {
    confidence: 'high',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots'],
    evidence: ['_LABEL_667C_ sets IX+1 during C3C0 behavior initialization; _LABEL_7E41_ clears IX+1 during C600 first-tick setup.'],
  }),
  field('IX', 2, 'coordinate_word_a_subpixel', 'Subpixel/fraction byte for coordinate word A; velocity A is integrated through IX+2 before carrying into IX+3/IX+4.', {
    confidence: 'high',
    fieldGroup: 'coordinate_word_a',
    families: ['current_ix_entity_slot', 'c3c0_room_entity_slots', 'c600_secondary_object_slots', 'animation_runtime_fields'],
    evidence: ['_LABEL_12D8_ adds signed velocity A in IX+8/IX+9 to the 24-bit coordinate-A accumulator IX+2/IX+3/IX+4.'],
  }),
  field('IX', 3, 'coordinate_word_a_low', 'Low byte of a coordinate word; window checks and floor responses compare this word against the active screen/player position.', {
    confidence: 'high',
    fieldGroup: 'coordinate_word_a',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots'],
    evidence: ['_LABEL_6718_ checks IX+3/IX+4 as the horizontal screen-window coordinate.'],
  }),
  field('IX', 4, 'coordinate_word_a_high', 'High byte of the IX+3/IX+4 coordinate word used by screen-window and position response helpers.', {
    confidence: 'high',
    fieldGroup: 'coordinate_word_a',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots'],
    evidence: ['_LABEL_6718_ checks IX+3/IX+4 as the horizontal screen-window coordinate.'],
  }),
  field('IX', 5, 'coordinate_word_b_subpixel', 'Subpixel/fraction byte for coordinate word B; velocity B is integrated through IX+5 before carrying into IX+6/IX+7.', {
    confidence: 'high',
    fieldGroup: 'coordinate_word_b',
    families: ['current_ix_entity_slot', 'c3c0_room_entity_slots', 'c600_secondary_object_slots', 'c6c0_c700_d222_periodic_slots'],
    evidence: ['_LABEL_12F8_ adds signed velocity B in IX+10/IX+11 to the 24-bit coordinate-B accumulator IX+5/IX+6/IX+7.'],
  }),
  field('IX', 6, 'coordinate_word_b_low', 'Low byte of a second coordinate word, used by vertical thresholds, floor responses, and secondary object first-tick setup.', {
    confidence: 'medium',
    fieldGroup: 'coordinate_word_b',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots', 'c6c0_c700_d222_periodic_slots'],
    evidence: ['_LABEL_6022_, _LABEL_7E41_, _LABEL_7E9C_, and _LABEL_7EE1_ use IX+6 with vertical/position logic.'],
  }),
  field('IX', 7, 'coordinate_word_b_high', 'High byte of the IX+6/IX+7 coordinate word used by vertical and window predicates.', {
    confidence: 'medium',
    fieldGroup: 'coordinate_word_b',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots'],
    evidence: ['_LABEL_6022_ tests IX+7 sign before comparing IX+6 to IX+35.'],
  }),
  field('IX', 8, 'horizontal_velocity_low', 'Low byte of the signed horizontal velocity word.', {
    confidence: 'high',
    fieldGroup: 'horizontal_velocity_word',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots'],
    evidence: ['_LABEL_68C7_ caps IX+8/IX+9 against IX+49; _LABEL_6919_ clears IX+8/IX+9 and IX+10/IX+11.'],
  }),
  field('IX', 9, 'horizontal_velocity_high', 'High byte of the signed horizontal velocity word.', {
    confidence: 'high',
    fieldGroup: 'horizontal_velocity_word',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots', 'c6c0_c700_d222_periodic_slots'],
    evidence: ['_LABEL_68C7_ caps IX+8/IX+9 against IX+49; _LABEL_6498_ writes IX+9 from the D222 pattern stream.'],
  }),
  field('IX', 10, 'vertical_velocity_low', 'Low byte of the signed vertical/motion velocity word.', {
    confidence: 'high',
    fieldGroup: 'vertical_velocity_word',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots'],
    evidence: ['_LABEL_6919_ clears IX+10/IX+11 along with the horizontal velocity word.'],
  }),
  field('IX', 11, 'vertical_velocity_high', 'High byte/sign byte of the signed vertical/motion velocity word.', {
    confidence: 'high',
    fieldGroup: 'vertical_velocity_word',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots'],
    evidence: ['_LABEL_5E1C_ tests IX+11 bit 7 while waiting for item/entity falling motion to end.'],
  }),
  field('IX', 12, 'animation_frame_pointer_low', 'Low byte of the decoded frame/metasprite stream pointer consumed by the sprite frame renderer.', {
    confidence: 'high',
    fieldGroup: 'animation_frame_pointer_word',
    families: ['current_ix_entity_slot', 'animation_runtime_fields'],
    evidence: ['_LABEL_1347_ stores the decoded frame pointer into IX+12/IX+13 after reading a bank-6 animation command stream.'],
  }),
  field('IX', 13, 'animation_frame_pointer_high', 'High byte of the decoded frame/metasprite stream pointer consumed by the sprite frame renderer.', {
    confidence: 'high',
    fieldGroup: 'animation_frame_pointer_word',
    families: ['current_ix_entity_slot', 'animation_runtime_fields'],
    evidence: ['_LABEL_1347_ stores the decoded frame pointer into IX+12/IX+13 after reading a bank-6 animation command stream.'],
  }),
  field('IX', 14, 'animation_root_selector', 'Root selector used by _LABEL_1318_ to choose the bank-6 animation child table.', {
    confidence: 'high',
    families: ['current_ix_entity_slot', 'animation_runtime_fields'],
    evidence: ['_LABEL_1318_ reads IX+14 before indexing _DATA_18718_ through RST $08/RST $18.'],
  }),
  field('IX', 15, 'entity_type_or_initializer_index', 'Entity type/id byte used to select metadata and the C3C0 initialization dispatch entry.', {
    confidence: 'high',
    families: ['c3c0_room_entity_slots', 'animation_runtime_fields'],
    evidence: ['_LABEL_65B9_ copies source record data into IX+15; _LABEL_667C_ indexes _DATA_668E_ from IX+15 after _LABEL_676D_; _LABEL_1318_ also reads IX+15 as the animation child selector.'],
  }),
  field('IX', 16, 'animation_delay_or_reward_timer', 'Animation delay/state byte reused by item and reward handlers.', {
    confidence: 'high',
    families: ['c3c0_room_entity_slots', 'animation_runtime_fields'],
    evidence: ['_LABEL_1330_ decrements IX+16 as the animation frame delay; _LABEL_1347_ writes the next delay from the command byte; _LABEL_5FB0_ also tests IX+16 in reward movement logic.'],
  }),
  field('IX', 17, 'facing_direction', 'Facing/direction byte used by animation start, spawn setup, and screen/window cleanup paths.', {
    confidence: 'high',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots', 'c740_twelve_slot_groups'],
    evidence: ['_LABEL_65B9_ seeds IX+17 from the room entity record; C600 floor responses and first-tick setup use IX+17 for direction decisions.'],
  }),
  field('IX', 18, 'animation_next_command_pointer_low', 'Low byte of the next bank-6 animation command pointer saved after decoding the current command.', {
    confidence: 'high',
    fieldGroup: 'animation_next_command_pointer_word',
    families: ['current_ix_entity_slot', 'animation_runtime_fields'],
    evidence: ['_LABEL_1330_ loads IX+18/IX+19 when an animation delay expires; _LABEL_1347_ stores the next command pointer back into IX+18/IX+19.'],
  }),
  field('IX', 19, 'animation_next_command_pointer_high', 'High byte of the next bank-6 animation command pointer saved after decoding the current command.', {
    confidence: 'high',
    fieldGroup: 'animation_next_command_pointer_word',
    families: ['current_ix_entity_slot', 'animation_runtime_fields'],
    evidence: ['_LABEL_1330_ loads IX+18/IX+19 when an animation delay expires; _LABEL_1347_ stores the next command pointer back into IX+18/IX+19.'],
  }),
  field('IX', 20, 'lifetime_countdown', 'Lifetime/countdown byte for the D0A4 auxiliary pair-slot update path.', {
    confidence: 'medium',
    families: ['c640_c680_d0a4_pair_slots', 'animation_runtime_fields'],
    evidence: ['_LABEL_6268_ clears the active pair slot when IX+20 expires; _LABEL_1347_ also stores the first optional animation motion/offset word into IX+20/IX+21 when bit 7 of the command byte is set.'],
  }),
  field('IX', 21, 'animation_optional_word_a_high', 'High byte of the first optional animation motion/offset word decoded by _LABEL_1347_.', {
    confidence: 'medium',
    fieldGroup: 'animation_optional_word_a',
    families: ['current_ix_entity_slot', 'animation_runtime_fields'],
    evidence: ['_LABEL_1347_ stores an optional DE word into IX+20/IX+21 when bit 7 of the animation command byte is set.'],
  }),
  field('IX', 22, 'animation_optional_word_b_low', 'Low byte of the second optional animation motion/offset word decoded by _LABEL_1347_.', {
    confidence: 'medium',
    fieldGroup: 'animation_optional_word_b',
    families: ['current_ix_entity_slot', 'animation_runtime_fields'],
    evidence: ['_LABEL_1347_ stores a second optional DE word into IX+22/IX+23 when bit 7 of the animation command byte is set.'],
  }),
  field('IX', 23, 'animation_optional_word_b_high', 'High byte of the second optional animation motion/offset word decoded by _LABEL_1347_.', {
    confidence: 'medium',
    fieldGroup: 'animation_optional_word_b',
    families: ['current_ix_entity_slot', 'animation_runtime_fields'],
    evidence: ['_LABEL_1347_ stores a second optional DE word into IX+22/IX+23 when bit 7 of the animation command byte is set.'],
  }),
  field('IX', 24, 'metadata_or_pattern_low', 'Low byte of a metadata/pattern pointer or pattern cursor depending on slot family.', {
    confidence: 'medium',
    fieldGroup: 'metadata_or_pattern_word',
    families: ['c3c0_room_entity_slots', 'c6c0_c700_d222_periodic_slots'],
    evidence: ['_LABEL_676D_ stores metadata into IX+24/IX+25; _LABEL_6498_ advances the D222 pattern through IX+24/IX+25.'],
  }),
  field('IX', 25, 'metadata_or_pattern_high', 'High byte of the IX+24/IX+25 metadata/pattern word.', {
    confidence: 'medium',
    fieldGroup: 'metadata_or_pattern_word',
    families: ['c3c0_room_entity_slots', 'c6c0_c700_d222_periodic_slots'],
    evidence: ['_LABEL_676D_ stores metadata into IX+24/IX+25; _LABEL_6498_ advances the D222 pattern through IX+24/IX+25.'],
  }),
  field('IX', 27, 'collision_contact_flags', 'Collision/contact flag byte tested by secondary object state handlers and floor responses.', {
    confidence: 'high',
    families: ['c600_secondary_object_slots'],
    evidence: ['_LABEL_7DD4_ and _LABEL_7DFD_ branch to floor response helpers when IX+27 bit 0 is set.'],
  }),
  field('IX', 28, 'damage_meter_low', 'Low byte of the entity damage/meter word loaded from metadata and decremented on hits.', {
    confidence: 'high',
    fieldGroup: 'damage_meter_word',
    families: ['c3c0_room_entity_slots'],
    evidence: ['_LABEL_676D_ loads IX+28/IX+29 from entity metadata; _LABEL_6793_ applies damage to IX+28/IX+29.'],
  }),
  field('IX', 29, 'damage_meter_high', 'High byte of the entity damage/meter word loaded from metadata and decremented on hits.', {
    confidence: 'high',
    fieldGroup: 'damage_meter_word',
    families: ['c3c0_room_entity_slots'],
    evidence: ['_LABEL_676D_ loads IX+28/IX+29 from entity metadata; _LABEL_6793_ applies damage to IX+28/IX+29.'],
  }),
  field('IX', 30, 'motion_collision_param_low', 'C600 motion/collision parameter byte used by secondary state movement and floor responses.', {
    confidence: 'medium',
    families: ['c600_secondary_object_slots'],
    evidence: ['_LABEL_7D51_, _LABEL_7DA3_, _LABEL_7E9C_, and _LABEL_7EE1_ reference IX+30/IX+31 around C600 movement responses.'],
  }),
  field('IX', 31, 'motion_timer_or_collision_param', 'Timer, animation seed, or motion/collision parameter depending on behavior family.', {
    confidence: 'medium',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots'],
    evidence: ['Many _DATA_668E_ initializer entries seed IX+31; C600 state handlers also reference IX+31 during movement.'],
  }),
  field('IX', 32, 'behavior_state', 'Primary behavior state byte; C3C0 dispatcher indexes behavior pointers with IX+32 and several helpers rewrite it.', {
    confidence: 'high',
    families: ['c3c0_room_entity_slots', 'c6c0_c700_d222_periodic_slots'],
    evidence: ['_LABEL_660D_ dispatches behavior from IX+38/IX+39 using IX+32; _LABEL_6793_ switches IX+32 after partial damage.'],
  }),
  field('IX', 33, 'timer_age_counter', 'General timer/age/lifetime counter used by C3C0, C600, C740, and effect-slot handlers.', {
    confidence: 'medium',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots', 'c6c0_c700_d222_periodic_slots', 'c740_twelve_slot_groups'],
    evidence: ['_LABEL_634B_ increments IX+33 as a projectile age counter; _LABEL_7E79_ uses IX+33 in C600 cleanup.'],
  }),
  field('IX', 34, 'reward_value', 'Reward/item value parameter consumed by reward collection logic.', {
    confidence: 'medium',
    families: ['c3c0_room_entity_slots'],
    evidence: ['_LABEL_5FB0_ awards IX+34 through _LABEL_2441_ on contact.'],
  }),
  field('IX', 35, 'vertical_threshold', 'Vertical threshold byte compared against IX+6 during shared state advancement.', {
    confidence: 'medium',
    families: ['c3c0_room_entity_slots'],
    evidence: ['_LABEL_6022_ advances IX+48 when IX+6 reaches IX+35 and IX+7 is not negative.'],
  }),
  field('IX', 37, 'behavior_speed_threshold_param', 'Initializer-seeded behavior parameter used as a speed, threshold, or tuning constant.', {
    confidence: 'medium',
    families: ['c3c0_room_entity_slots'],
    evidence: ['Many _DATA_668E_ initializer entries seed IX+37 alongside behavior pointer and motion fields.'],
  }),
  field('IX', 38, 'behavior_pointer_low', 'Low byte of the behavior pointer/list used by the C3C0 active entity dispatcher.', {
    confidence: 'high',
    fieldGroup: 'behavior_pointer_word',
    families: ['c3c0_room_entity_slots'],
    evidence: ['_LABEL_660D_ dispatches through the behavior pointer table stored in IX+38/IX+39.'],
  }),
  field('IX', 39, 'behavior_pointer_high', 'High byte of the behavior pointer/list used by the C3C0 active entity dispatcher.', {
    confidence: 'high',
    fieldGroup: 'behavior_pointer_word',
    families: ['c3c0_room_entity_slots'],
    evidence: ['_LABEL_660D_ dispatches through the behavior pointer table stored in IX+38/IX+39.'],
  }),
  field('IX', 40, 'aux_motion_word_a_low', 'Low byte of an initializer-seeded auxiliary motion/parameter word.', {
    confidence: 'medium',
    fieldGroup: 'aux_motion_word_a',
    families: ['c3c0_room_entity_slots'],
    evidence: ['Multiple _DATA_668E_ initializer entries seed IX+40/IX+41 as paired constants.'],
  }),
  field('IX', 41, 'aux_motion_word_a_high', 'High byte of the IX+40/IX+41 auxiliary motion/parameter word.', {
    confidence: 'medium',
    fieldGroup: 'aux_motion_word_a',
    families: ['c3c0_room_entity_slots'],
    evidence: ['Multiple _DATA_668E_ initializer entries seed IX+40/IX+41 as paired constants.'],
  }),
  field('IX', 42, 'aux_motion_word_b_low', 'Low byte of a second initializer-seeded auxiliary motion/parameter word.', {
    confidence: 'medium',
    fieldGroup: 'aux_motion_word_b',
    families: ['c3c0_room_entity_slots'],
    evidence: ['Multiple _DATA_668E_ initializer entries seed IX+42/IX+43 as paired constants.'],
  }),
  field('IX', 43, 'aux_motion_word_b_high', 'High byte of the IX+42/IX+43 auxiliary motion/parameter word.', {
    confidence: 'medium',
    fieldGroup: 'aux_motion_word_b',
    families: ['c3c0_room_entity_slots'],
    evidence: ['Multiple _DATA_668E_ initializer entries seed IX+42/IX+43 as paired constants.'],
  }),
  field('IX', 44, 'timer_threshold', 'Timer/threshold byte seeded by selected C3C0 initializer entries.', {
    confidence: 'medium',
    families: ['c3c0_room_entity_slots'],
    evidence: ['Selected _DATA_668E_ initializer entries write IX+44 alongside timer and behavior parameters.'],
  }),
  field('IX', 46, 'source_room_entity_record_index', 'Index/back-reference to the source room entity record used when clearing spawned/active state.', {
    confidence: 'high',
    families: ['c3c0_room_entity_slots'],
    evidence: ['_LABEL_65B9_ stores source record metadata into IX+46; _LABEL_6741_ and _LABEL_6757_ clear source record bytes derived from IX+46.'],
  }),
  field('IX', 47, 'active_dispatch_aux_flag', 'Auxiliary flag byte used by the C3C0 active entity dispatcher.', {
    confidence: 'medium',
    families: ['c3c0_room_entity_slots'],
    evidence: ['_LABEL_660D_ references IX+47 during active entity dispatch.'],
  }),
  field('IX', 48, 'state_or_pointer_low', 'Family-specific state byte or pointer low byte; item/reward states increment it, while C600 initialization uses it as part of object setup.', {
    confidence: 'medium',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots'],
    evidence: ['Item/reward handlers advance IX+48 as a state byte; _LABEL_7C65_ references IX+48 during C600 secondary object initialization.'],
  }),
  field('IX', 49, 'speed_cap_or_pointer_high', 'Family-specific speed cap, timer, direction parameter, or pointer high byte.', {
    confidence: 'medium',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots'],
    evidence: ['_LABEL_68C7_ caps IX+8/IX+9 against IX+49; _DATA_668E_ initializers also seed IX+49 for behavior-specific tuning.'],
  }),
  field('IX', 50, 'secondary_object_record_pointer_low', 'Low byte of a C600 secondary object record pointer or behavior-family parameter.', {
    confidence: 'medium',
    fieldGroup: 'secondary_object_record_pointer',
    families: ['c600_secondary_object_slots', 'c3c0_room_entity_slots'],
    evidence: ['_LABEL_7C65_ initializes pending C600 slots from IX+48/IX+50 record pointers.'],
  }),
  field('IX', 51, 'secondary_object_record_pointer_high', 'High byte of a C600 secondary object record pointer.', {
    confidence: 'medium',
    fieldGroup: 'secondary_object_record_pointer',
    families: ['c600_secondary_object_slots'],
    evidence: ['_LABEL_7C65_ initializes pending C600 slots from IX+48/IX+50 record pointers and references IX+51.'],
  }),
  field('IX', 52, 'secondary_object_state', 'C600 secondary object state byte dispatched through _DATA_7D49_.', {
    confidence: 'high',
    families: ['c600_secondary_object_slots'],
    evidence: ['_LABEL_7D45_ loads IX+52 and dispatches through the four-entry _DATA_7D49_ table.'],
  }),
  field('IX', 53, 'variant_subtype_parameter', 'Entity variant/subtype/parameter byte seeded heavily by C3C0 initializers and C600 setup.', {
    confidence: 'high',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots'],
    evidence: ['Many _DATA_668E_ initializer entries seed IX+53; _LABEL_7C65_ also references IX+53 during C600 setup.'],
  }),
  field('IX', 54, 'variant_aux_parameter', 'Auxiliary variant/parameter byte seeded by selected C3C0 initializers and C600 setup.', {
    confidence: 'medium',
    families: ['c3c0_room_entity_slots', 'c600_secondary_object_slots'],
    evidence: ['Selected _DATA_668E_ initializer entries seed IX+54; _LABEL_7C65_ references IX+54 for secondary object setup.'],
  }),
  field('IX', 55, 'secondary_lifetime_or_start_aux', 'C600 secondary-object lifetime/start-position auxiliary byte.', {
    confidence: 'medium',
    families: ['c600_secondary_object_slots'],
    evidence: ['_LABEL_7D51_, _LABEL_7E41_, and _LABEL_7E9C_ reference IX+55 during C600 secondary object update and cleanup.'],
  }),
  field('IX', 56, 'secondary_start_position_aux', 'C600 secondary-object start-position/auxiliary byte seeded on first tick.', {
    confidence: 'medium',
    families: ['c600_secondary_object_slots', 'c3c0_room_entity_slots'],
    evidence: ['_LABEL_7E41_ stores a starting coordinate in IX+56; selected initializers also seed IX+56.'],
  }),
  field('IX', 62, 'item_equipment_effect_id', 'Item/equipment effect id consumed by special pickup apply logic.', {
    confidence: 'medium',
    families: ['c3c0_room_entity_slots'],
    evidence: ['_LABEL_5ED4_ masks IX+62 and passes the result to _LABEL_3763_ before clearing the slot.'],
  }),
  field('IX', 63, 'sprite_tile_base', 'Tile-base offset added to each decoded sprite frame tile byte before OAM output.', {
    confidence: 'high',
    families: ['current_ix_entity_slot', 'animation_runtime_fields', 'c3c0_room_entity_slots'],
    evidence: ['_LABEL_792_ reads one tile byte from the frame stream, adds IX+63, and stores the result as the OAM tile id.'],
  }),
  field('IY', 6, 'room_entity_record_spawned_flag', 'Spawned/active marker byte in the seven-byte source room entity record.', {
    confidence: 'high',
    families: ['d030_room_entity_records'],
    evidence: ['_LABEL_65B9_ writes IY+6=$80 after copying a room entity source record into a C3C0 runtime slot.'],
  }),
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function ramHex(n) {
  return '$' + n.toString(16).toUpperCase().padStart(4, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function regionBounds(region) {
  const start = offsetOf(region);
  return { start, end: start + (region.size || 0) };
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
  }) || null;
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
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

function ramRef(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || 'byte',
    name: entry.name || '',
  };
}

function findRamEntry(mapData, address) {
  const wanted = ramHex(address);
  return (mapData.ram || []).find(entry => entry.address === wanted) || null;
}

function findCatalog(mapData, id) {
  const catalogs = Object.keys(mapData)
    .filter(key => Array.isArray(mapData[key]) && /catalog/i.test(key))
    .flatMap(key => mapData[key].map(catalog => ({ bucket: key, catalog })));
  const found = catalogs.find(item => item.catalog?.id === id);
  return found || null;
}

function parseIndexedRef(ref) {
  const match = /^(IX|IY)\+(\d+)$/i.exec(ref || '');
  if (!match) return null;
  return { register: match[1].toUpperCase(), offset: Number(match[2]) };
}

function unique(items) {
  return Array.from(new Set(items));
}

function compactList(items, limit = 24) {
  return unique(items.filter(Boolean)).slice(0, limit);
}

function fieldKey(register, offset) {
  return `${register}+${offset}`;
}

const fieldDefsByKey = new Map(FIELD_DEFS.map(def => [fieldKey(def.register, def.offset), def]));

function guessUsageFamily(usage) {
  const text = [
    usage.tableLabel,
    usage.sourceRole,
    usage.sourceFamily,
    usage.sourceLabel,
  ].filter(Boolean).join(' ').toLowerCase();
  if (usage.register === 'IY') return 'd030_room_entity_records';
  if (text.includes('animation') || text.includes('tile_base') || text.includes('_label_792_') || text.includes('_label_1318_') || text.includes('_label_1330_') || text.includes('_label_1347_')) return 'animation_runtime_fields';
  if (usage.tableLabel === '_DATA_668E_' || text.includes('c3c0') || text.includes('entity_init')) return 'c3c0_room_entity_slots';
  if (usage.tableLabel === '_DATA_7D49_' || text.includes('c600') || text.includes('secondary_object')) return 'c600_secondary_object_slots';
  if (text.includes('d0a4') || text.includes('c640') || text.includes('c680')) return 'c640_c680_d0a4_pair_slots';
  if (text.includes('d222') || text.includes('c6c0') || text.includes('c700')) return 'c6c0_c700_d222_periodic_slots';
  if (text.includes('c740') || text.includes('d21d') || text.includes('twelve')) return 'c740_twelve_slot_groups';
  if (text.includes('room_entity_record')) return 'd030_room_entity_records';
  return 'current_ix_entity_slot';
}

function normalizeSourceRegion(mapData, source) {
  if (source.region) return source.region;
  const offset = typeof source.sourceOffset === 'string' ? parseInt(source.sourceOffset, 16) : source.sourceOffset;
  if (Number.isFinite(offset)) return regionRef(findContainingRegion(mapData, offset));
  const labelBasedOffset = labelOffset(source.sourceLabel);
  if (labelBasedOffset != null) return regionRef(findContainingRegion(mapData, labelBasedOffset));
  return null;
}

function collectUsages(mapData, catalogs) {
  const usages = [];
  const seen = new Set();

  function addUsage(raw) {
    if (!Number.isInteger(raw.offset)) return;
    const token = fieldKey(raw.register, raw.offset);
    const usage = {
      ...raw,
      token,
      family: raw.family || guessUsageFamily(raw),
    };
    usage.region = normalizeSourceRegion(mapData, usage);
    const key = [
      usage.sourceCatalogId,
      usage.sourceKind,
      usage.sourceLabel,
      usage.tableLabel || '',
      usage.register,
      usage.offset,
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    usages.push(usage);
  }

  const targetCatalog = catalogs.behaviorTargets?.catalog;
  for (const table of targetCatalog?.tables || []) {
    for (const group of table.targetGroups || []) {
      for (const offset of group.asm?.ixOffsets || []) {
        addUsage({
          sourceCatalogId: targetCatalog.id,
          sourceKind: 'behavior_table_target_asm_scan',
          sourceLabel: group.targetLabel,
          sourceOffset: group.targetOffset,
          sourceRole: group.role?.kind || null,
          sourceConfidence: group.role?.confidence || null,
          tableLabel: table.label,
          tableIndexes: group.entryIndexes || [],
          register: 'IX',
          offset,
          evidence: (group.evidence || []).slice(0, 3),
        });
      }
      for (const offset of group.asm?.iyOffsets || []) {
        addUsage({
          sourceCatalogId: targetCatalog.id,
          sourceKind: 'behavior_table_target_asm_scan',
          sourceLabel: group.targetLabel,
          sourceOffset: group.targetOffset,
          sourceRole: group.role?.kind || null,
          sourceConfidence: group.role?.confidence || null,
          tableLabel: table.label,
          tableIndexes: group.entryIndexes || [],
          register: 'IY',
          offset,
          evidence: (group.evidence || []).slice(0, 3),
        });
      }
    }
  }

  for (const catalogRef of [catalogs.runtimeRoutines, catalogs.bank0Behavior].filter(Boolean)) {
    const catalog = catalogRef.catalog;
    for (const entry of catalog.entries || []) {
      for (const ref of entry.ramRefs || []) {
        const parsed = parseIndexedRef(ref);
        if (!parsed) continue;
        addUsage({
          sourceCatalogId: catalog.id,
          sourceKind: 'routine_indexed_ram_ref',
          sourceLabel: entry.label,
          sourceOffset: entry.offset,
          sourceRole: entry.role,
          sourceFamily: entry.family,
          sourceConfidence: entry.confidence || 'high',
          tableLabel: entry.table || null,
          tableIndexes: entry.tableIndex == null ? [] : [entry.tableIndex],
          register: parsed.register,
          offset: parsed.offset,
          evidence: (entry.evidence || []).slice(0, 3),
        });
      }
    }
  }

  const animationCallsites = catalogs.animationCallsites?.catalog;
  for (const routine of animationCallsites?.routines || []) {
    for (const access of routine.selectorAccesses || []) {
      const parsed = parseIndexedRef(access.selector);
      if (!parsed) continue;
      addUsage({
        sourceCatalogId: animationCallsites.id,
        sourceKind: 'animation_selector_access',
        sourceLabel: routine.label,
        sourceOffset: routine.offset,
        sourceRole: access.role || null,
        sourceFamily: 'animation_callsite',
        sourceConfidence: 'high',
        tableLabel: null,
        tableIndexes: [],
        register: parsed.register,
        offset: parsed.offset,
        evidence: [
          `ASM line ${access.line}: ${access.code}`,
          `${access.selector} is cataloged as ${access.role || 'an animation selector'} by ${animationCallsites.id}.`,
        ],
      });
    }
  }

  const animationTileBase = catalogs.animationTileBase?.catalog;
  for (const write of animationTileBase?.writes || []) {
    const parsed = parseIndexedRef(write.target);
    if (!parsed) continue;
    addUsage({
      sourceCatalogId: animationTileBase.id,
      sourceKind: 'animation_tile_base_write',
      sourceLabel: write.label,
      sourceOffset: write.labelOffset,
      sourceRole: write.role,
      sourceFamily: 'animation_tile_base',
      sourceConfidence: write.confidence || 'high',
      tableLabel: null,
      tableIndexes: [],
      register: parsed.register,
      offset: parsed.offset,
      evidence: (write.evidence || []).slice(0, 3),
    });
  }

  const motionCollision = catalogs.motionCollision?.catalog;
  for (const helper of motionCollision?.helpers || []) {
    for (const ref of helper.fieldRefs || []) {
      if (ref.register !== 'IX') continue;
      addUsage({
        sourceCatalogId: motionCollision.id,
        sourceKind: 'motion_collision_helper_field_ref',
        sourceLabel: helper.label,
        sourceOffset: helper.offset,
        sourceRole: helper.role,
        sourceFamily: helper.category,
        sourceConfidence: helper.confidence || 'high',
        tableLabel: null,
        tableIndexes: [],
        register: ref.register,
        offset: ref.offset,
        evidence: (helper.evidence || []).slice(0, 3),
      });
    }
  }

  for (const usage of [
    {
      sourceLabel: '_LABEL_792_',
      sourceOffset: '0x00792',
      sourceRole: 'sprite_frame_record_decoder',
      register: 'IX',
      offsets: [63],
      evidence: ['ASM lines 2021-2023 read a frame tile byte, add (IX+63), and write the result to OAM via IY+2.'],
    },
    {
      sourceLabel: '_LABEL_1318_',
      sourceOffset: '0x01318',
      sourceRole: 'entity_animation_start_from_bank6_tables',
      register: 'IX',
      offsets: [14, 15],
      evidence: ['ASM lines 3712-3717 read IX+14 and IX+15 to index _DATA_18718_ and its selected child table through RST $08/RST $18.'],
    },
    {
      sourceLabel: '_LABEL_1330_',
      sourceOffset: '0x01330',
      sourceRole: 'entity_animation_tick',
      register: 'IX',
      offsets: [16, 18, 19],
      evidence: ['ASM lines 3725-3734 decrement IX+16 and load the next animation command pointer from IX+18/IX+19 when the delay expires.'],
    },
    {
      sourceLabel: '_LABEL_1347_',
      sourceOffset: '0x01347',
      sourceRole: 'entity_animation_script_decoder',
      register: 'IX',
      offsets: [12, 13, 16, 18, 19, 20, 21, 22, 23],
      evidence: ['ASM lines 3735-3764 decode bank-6 animation commands, store IX+16 delay, optional IX+20..23 words, frame pointer IX+12/IX+13, and next command pointer IX+18/IX+19.'],
    },
  ]) {
    for (const offset of usage.offsets) {
      addUsage({
        sourceCatalogId: 'asm-direct-animation-loader-semantics-2026-06-25',
        sourceKind: 'direct_asm_loader_field_use',
        sourceLabel: usage.sourceLabel,
        sourceOffset: usage.sourceOffset,
        sourceRole: usage.sourceRole,
        sourceFamily: 'animation_runtime_fields',
        sourceConfidence: 'high',
        tableLabel: null,
        tableIndexes: [],
        register: usage.register,
        offset,
        evidence: usage.evidence,
      });
    }
  }

  return usages.sort((a, b) => a.register.localeCompare(b.register) || a.offset - b.offset || String(a.sourceLabel).localeCompare(String(b.sourceLabel)));
}

function buildFieldRecords(usages) {
  const usagesByField = new Map();
  for (const usage of usages) {
    const list = usagesByField.get(usage.token) || [];
    list.push(usage);
    usagesByField.set(usage.token, list);
  }

  return FIELD_DEFS.map(def => {
    const fieldUsages = usagesByField.get(def.token) || [];
    return {
      ...def,
      usageCount: fieldUsages.length,
      usageFamilies: compactList(fieldUsages.map(usage => usage.family), 12),
      sourceCatalogs: compactList(fieldUsages.map(usage => usage.sourceCatalogId), 8),
      sourceLabels: compactList(fieldUsages.map(usage => usage.sourceLabel), 32),
      tableLabels: compactList(fieldUsages.map(usage => usage.tableLabel), 12),
      usageRefs: fieldUsages.slice(0, 40).map(usage => ({
        sourceCatalogId: usage.sourceCatalogId,
        sourceKind: usage.sourceKind,
        sourceLabel: usage.sourceLabel,
        sourceOffset: usage.sourceOffset || null,
        sourceRole: usage.sourceRole || null,
        sourceFamily: usage.sourceFamily || null,
        tableLabel: usage.tableLabel || null,
        tableIndexes: usage.tableIndexes || [],
        family: usage.family,
        region: usage.region || null,
        evidence: usage.evidence || [],
      })),
    };
  });
}

function buildSlotFamilies(mapData) {
  return SLOT_FAMILIES.map(family => {
    const baseLabels = family.baseLabels || [family.baseLabel];
    const ramBases = baseLabels.map((label, index) => {
      const address = family.baseAddress + index * (family.slotSize || 0);
      return {
        label,
        address: ramHex(address),
        ram: ramRef(findRamEntry(mapData, address)),
      };
    });
    return {
      ...family,
      baseAddress: ramHex(family.baseAddress),
      ramBases,
    };
  });
}

function buildCatalog(mapData) {
  const catalogs = Object.fromEntries(Object.entries(sourceCatalogIds).map(([key, id]) => [key, findCatalog(mapData, id)]));
  const missingSourceCatalogs = Object.entries(catalogs)
    .filter(([, value]) => !value)
    .map(([key]) => ({ key, id: sourceCatalogIds[key] }));
  const usages = collectUsages(mapData, catalogs);
  const fields = buildFieldRecords(usages);
  const unknownOffsetCounts = {};
  for (const usage of usages) {
    if (fieldDefsByKey.has(usage.token)) continue;
    unknownOffsetCounts[usage.token] = (unknownOffsetCounts[usage.token] || 0) + 1;
  }
  const slotFamilies = buildSlotFamilies(mapData);
  const ramBaseMissing = slotFamilies
    .flatMap(family => family.ramBases.map(base => ({ familyId: family.id, ...base })))
    .filter(base => !base.ram)
    .map(base => ({ familyId: base.familyId, label: base.label, address: base.address }));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.fromEntries(Object.entries(catalogs).map(([key, ref]) => [key, ref ? { bucket: ref.bucket, id: ref.catalog.id } : null])),
    summary: {
      slotFamilyCount: slotFamilies.length,
      fieldCount: fields.length,
      indexedUsageCount: usages.length,
      ixFieldCount: fields.filter(field => field.register === 'IX').length,
      iyFieldCount: fields.filter(field => field.register === 'IY').length,
      usedFieldCount: fields.filter(field => field.usageCount > 0).length,
      unknownIndexedOffsetCount: Object.keys(unknownOffsetCounts).length,
      missingSourceCatalogs: missingSourceCatalogs.length,
      ramBaseMissingCount: ramBaseMissing.length,
      assetPolicy: 'Metadata only: slot-family base addresses, field offsets, roles, source labels, table refs, RAM labels, and evidence. No ROM bytes or decoded assets are embedded.',
    },
    slotFamilies,
    fields,
    unknownIndexedOffsets: Object.entries(unknownOffsetCounts).map(([token, count]) => ({ token, count })),
    missingSourceCatalogs,
    ramBaseMissing,
    evidence: [
      'world-entity-runtime-routine-catalog-2026-06-25 records the C3C0/C600/C640/C680/C6C0/C700/C740 schedulers and their indexed RAM refs.',
      'world-entity-behavior-table-target-catalog-2026-06-25 scans _DATA_668E_ and _DATA_7D49_ target ASM blocks and records IX/IY offsets per target label.',
      'world-bank0-entity-behavior-catalog-2026-06-25 records item/reward/initializer routines with dispatch-table and IX field evidence.',
    ],
  };
}

function fieldSummaryForUsage(usage) {
  const def = fieldDefsByKey.get(usage.token);
  return {
    register: usage.register,
    offset: usage.offset,
    token: usage.token,
    role: def?.role || 'unclassified_indexed_field',
    fieldGroup: def?.fieldGroup || null,
    confidence: def?.confidence || 'unknown',
    family: usage.family,
  };
}

function annotateRegions(mapData, usages) {
  const byRegion = new Map();
  for (const usage of usages) {
    if (!usage.region?.id) continue;
    const list = byRegion.get(usage.region.id) || [];
    list.push(usage);
    byRegion.set(usage.region.id, list);
  }

  const annotated = [];
  for (const [regionId, regionUsages] of byRegion.entries()) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    const fieldRefs = [];
    const seenFields = new Set();
    for (const usage of regionUsages) {
      const summary = fieldSummaryForUsage(usage);
      const key = `${summary.token}:${summary.family}`;
      if (seenFields.has(key)) continue;
      seenFields.add(key);
      fieldRefs.push(summary);
    }
    fieldRefs.sort((a, b) => a.register.localeCompare(b.register) || a.offset - b.offset || a.family.localeCompare(b.family));
    const sourceCatalogs = compactList(regionUsages.map(usage => usage.sourceCatalogId), 6);
    const tableLabels = compactList(regionUsages.map(usage => usage.tableLabel), 10);
    const families = compactList(regionUsages.map(usage => usage.family), 10);
    region.analysis.entityRuntimeStructFieldAudit = {
      catalogId,
      kind: 'entity_runtime_struct_field_usage',
      confidence: fieldRefs.some(ref => ref.confidence === 'unknown') ? 'mixed' : 'medium',
      fieldRefs,
      usageCount: regionUsages.length,
      families,
      sourceCatalogs,
      tableLabels,
      summary: `${region.name || region.id} references ${fieldRefs.map(ref => ref.token).join(', ')} in entity/runtime indexed structs.`,
      evidence: compactList(regionUsages.flatMap(usage => usage.evidence || []), 6),
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      fieldRefs,
      usageCount: regionUsages.length,
      families,
      sourceCatalogs,
      tableLabels,
    });
  }
  return annotated.sort((a, b) => parseInt(a.offset, 16) - parseInt(b.offset, 16));
}

function annotateRamBases(mapData, slotFamilies) {
  const annotated = [];
  for (const family of slotFamilies) {
    for (const base of family.ramBases) {
      if (!base.ram?.id) continue;
      const entry = (mapData.ram || []).find(item => item.id === base.ram.id);
      if (!entry) continue;
      entry.analysis = entry.analysis || {};
      entry.analysis.entityRuntimeStructFieldAudit = {
        catalogId,
        kind: 'entity_runtime_slot_family_base',
        familyId: family.id,
        role: family.role,
        confidence: family.confidence,
        slotSize: family.slotSize || null,
        recordSize: family.recordSize || null,
        slotCount: family.slotCount || null,
        label: base.label,
        summary: `${base.label} is the mapped base address for ${family.role}.`,
        evidence: family.evidence,
        generatedAt: now,
        tool: toolName,
      };
      annotated.push({
        id: entry.id,
        address: entry.address,
        name: entry.name || '',
        familyId: family.id,
        role: family.role,
        label: base.label,
        confidence: family.confidence,
      });
    }
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const usages = collectUsages(mapData, Object.fromEntries(Object.entries(sourceCatalogIds).map(([key, id]) => [key, findCatalog(mapData, id)])));
  let annotatedRegions = [];
  let annotatedRamBases = [];

  if (apply) {
    annotatedRegions = annotateRegions(mapData, usages);
    annotatedRamBases = annotateRamBases(mapData, catalog.slotFamilies);
    mapData.entityRuntimeStructCatalogs = (mapData.entityRuntimeStructCatalogs || []).filter(item => item.id !== catalogId);
    mapData.entityRuntimeStructCatalogs.push(buildCatalog(mapData));
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'entity_runtime_struct_field_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
        annotatedRamBases: annotatedRamBases.length,
      },
      annotatedRegions,
      annotatedRamBases,
      unknownIndexedOffsets: catalog.unknownIndexedOffsets,
      ramBaseMissing: catalog.ramBaseMissing,
      nextLeads: [
        'Trace _LABEL_1318_, _LABEL_1330_, and _LABEL_1347_ animation loaders into IX+12/IX+13/IX+16/IX+18/IX+19/IX+20..23 fields and connect them to metasprite/frame catalogs.',
        'Trace room loading assignments to _RAM_D0A0_/_RAM_D0A2_/_RAM_D0A3_ so slot counts and room entity record counts can be tied back to scene recipes.',
        'Use frame-by-frame traces for _LABEL_12D5_, _LABEL_1B25_, and _LABEL_17AB_ to split coordinate and velocity words into exact axis semantics.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotatedRegions.length,
      annotatedRamBases: annotatedRamBases.length,
    },
    unknownIndexedOffsets: catalog.unknownIndexedOffsets,
    ramBaseMissing: catalog.ramBaseMissing,
  }, null, 2));
}

main();
