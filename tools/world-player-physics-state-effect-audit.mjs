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
const catalogId = 'world-player-physics-state-effect-catalog-2026-06-25';
const reportId = 'player-physics-state-effect-audit-2026-06-25';
const toolName = 'tools/world-player-physics-state-effect-audit.mjs';

const playerStructCatalogId = 'world-player-struct-catalog-2026-06-25';
const playerPhysicsRoutineCatalogId = 'world-player-physics-routine-catalog-2026-06-25';

const EFFECT_DEFS = [
  {
    label: '_LABEL_141F_',
    offset: 0x0141F,
    role: 'collision_tile_lookup_cb00',
    category: 'collision_tile_lookup',
    confidence: 'high',
    routineSummary: 'Converts a coordinate pair into a collision-buffer tile value read from _RAM_CB00_.',
    frameEffect: 'Pure lookup helper; returns the probed collision tile in A without mutating player state.',
    constants: [
      { name: 'collision_buffer_base', value: '$CB00', meaning: 'Decompressed collision/tile buffer base.' },
      { name: 'tile_pixel_size', value: '0x10', meaning: 'Coordinate-to-tile shift and row alignment size.' },
      { name: 'visible_y_bias', value: '0x10', meaning: 'E is biased down by 0x10 before row lookup.' },
    ],
    reads: [],
    writes: [],
    globalRamRefs: ['$CB00'],
    evidence: [
      'ASM lines 3868-3894 subtract 0x10 from E, align the row with 0xF0, shift HL right four times for the column, add _RAM_CB00_, and load A from the computed address.',
    ],
  },
  {
    label: '_LABEL_1446_',
    offset: 0x01446,
    role: 'player_collision_sweep_dispatch',
    category: 'player_collision_pipeline',
    confidence: 'high',
    routineSummary: 'Per-frame player collision sweep dispatcher for normal and alternate collision modes.',
    frameEffect: 'Clears special-contact and contact flags, clears selected state bits, probes both coordinate axes, and dispatches to the relevant collision response helper.',
    constants: [
      { name: 'lower_coordinate_b_bound', value: '0x10', meaning: 'Minimum coordinate-B byte after initial position integration.' },
      { name: 'alternate_collision_flag_ram', value: '$CF8B', meaning: 'Nonzero routes to the alternate collision response path.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x01, fieldRole: 'player_struct_state_flags', access: 'read_write_bits', detail: 'AND 0xF9 clears bits 1 and 2 before collision response.' },
      { kind: 'struct', offset: 0x06, fieldRole: 'player_struct_coordinate_word_b', access: 'clamp_low_byte', detail: 'IX+6 is clamped to 0x10 in the normal path.' },
      { kind: 'struct', offset: 0x31, fieldRole: 'player_struct_vector_substate', access: 'read_bit0', detail: 'IX+49 selects whether coordinate-A or coordinate-B integration is run first.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x1B, inferredField: 'contact_flags', access: 'clear', detail: 'IX+27 is cleared at the start of the sweep.' },
      { kind: 'global', address: '$D01B', access: 'clear', detail: 'Special collision tile latch is cleared at the start of the sweep.' },
    ],
    globalRamRefs: ['$CF8B', '$D01B'],
    calls: ['_LABEL_12D8_', '_LABEL_12F8_', '_LABEL_1551_', '_LABEL_166C_', '_LABEL_16E2_'],
    evidence: [
      'ASM lines 3896-3905 clear _RAM_D01B_, IX+27, and bits in IX+1, then route to _LABEL_16E2_ when _RAM_CF8B_ is nonzero.',
      'ASM lines 3906-3933 choose integration/probe order from IX+49 bit 0 and call _LABEL_1551_/_LABEL_166C_.',
      'ASM lines 3913-3918 and 3925-3930 clamp IX+6 to 0x10 before the coordinate-B response.',
    ],
  },
  {
    label: '_LABEL_1551_',
    offset: 0x01551,
    role: 'coordinate_b_collision_response',
    category: 'collision_response',
    confidence: 'high',
    routineSummary: 'Sweeps coordinate-B edge probes against solid collision tiles and resolves coordinate-B contact.',
    frameEffect: 'On solid tile contact, sets coordinate-B contact bits, snaps coordinate B to a 0x10 boundary, records special tile contacts, and clears motion word B.',
    constants: [
      { name: 'solid_tile_threshold', value: '0x10', meaning: 'Tile values below 0x10 are treated as blocking/contact tiles.' },
      { name: 'special_tile_value', value: '0x05', meaning: 'Captured by _LABEL_16D0_ for later special collision handling.' },
      { name: 'coordinate_b_min', value: '0x10', meaning: 'Probe lower bound.' },
      { name: 'coordinate_b_max_exclusive', value: '0xC0', meaning: 'Probe upper bound.' },
      { name: 'tile_snap_size', value: '0x10', meaning: 'Coordinate-B is snapped to tile boundaries on contact.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x03, fieldRole: 'player_struct_coordinate_word_a', access: 'read_probe_axis', detail: 'Coordinate A is used while sweeping across the actor width.' },
      { kind: 'struct', offset: 0x06, fieldRole: 'player_struct_coordinate_word_b', access: 'read_write_snap', detail: 'Coordinate B is probed and then snapped on contact.' },
      { kind: 'struct', offset: 0x0A, fieldRole: 'player_struct_motion_word_b', access: 'read_sign_write_clear', detail: 'Motion B sign chooses contact side; motion B is cleared after contact response.' },
      { kind: 'struct', offset: 0x14, inferredField: 'hitbox_extent_a', access: 'read', detail: 'IX+20 contributes to the sweep span.' },
      { kind: 'struct', offset: 0x15, inferredField: 'hitbox_extent_b_inner', access: 'read', detail: 'IX+21 contributes to coordinate-B edge math.' },
      { kind: 'struct', offset: 0x17, inferredField: 'hitbox_offset_b', access: 'read', detail: 'IX+23 contributes to coordinate-B edge math.' },
      { kind: 'struct', offset: 0x31, fieldRole: 'player_struct_vector_substate', access: 'read_direction_variant', detail: 'IX+49 alters side selection for form/state 2 paths.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x01, fieldRole: 'player_struct_state_flags', access: 'set_bit1', detail: 'Marks coordinate-B contact state.' },
      { kind: 'struct', offset: 0x05, inferredField: 'coordinate_b_contact_latch', access: 'clear', detail: 'Cleared when coordinate-B contact is accepted.' },
      { kind: 'struct', offset: 0x06, fieldRole: 'player_struct_coordinate_word_b', access: 'snap_to_tile', detail: 'Snaps low byte to the blocking tile boundary.' },
      { kind: 'struct', offset: 0x0A, fieldRole: 'player_struct_motion_word_b', access: 'clear_word', detail: 'Clears _RAM_C24A_/motion word B after contact response.' },
      { kind: 'struct', offset: 0x1B, inferredField: 'contact_flags', access: 'set_bit0_or_bit1', detail: 'Bit 0 marks one coordinate-B side; bit 1 marks the opposite side.' },
      { kind: 'global', address: '$D01B', access: 'increment_or_set', detail: 'Incremented for one contact side and set by special tile capture.' },
    ],
    globalRamRefs: ['$D0EE', '$D0F0', '$D0DF', '$D0E1', '$D01A', '$D01B'],
    calls: ['_LABEL_141F_', '_LABEL_16D0_', '_LABEL_1797_'],
    evidence: [
      'ASM lines 4057-4095 derive probe bounds from _RAM_C246_, IX+20/21/23, and store sweep counts.',
      'ASM lines 4135-4147 call _LABEL_141F_, treat tile values below 0x10 as contact, call _LABEL_16D0_, and latch a hit.',
      'ASM lines 4160-4209 set IX+1 bit 1, set IX+27 bit 0 or 1, snap _RAM_C246_, increment _RAM_D01B_ or call _LABEL_1797_, and clear _RAM_C24A_.',
    ],
  },
  {
    label: '_LABEL_166C_',
    offset: 0x0166C,
    role: 'coordinate_a_collision_response',
    category: 'collision_response',
    confidence: 'high',
    routineSummary: 'Resolves coordinate-A contact by setting contact flags, snapping coordinate A, and clearing motion word A.',
    frameEffect: 'On coordinate-A collision, sets state/contact bits, snaps coordinate A to the blocking tile boundary, and clears motion word A.',
    constants: [
      { name: 'tile_snap_size', value: '0x10', meaning: 'Coordinate-A is snapped to tile boundaries on contact.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x03, fieldRole: 'player_struct_coordinate_word_a', access: 'read_write_snap', detail: 'Coordinate A is adjusted from the probe position in _RAM_D0F2_.' },
      { kind: 'struct', offset: 0x08, fieldRole: 'player_struct_motion_word_a', access: 'read_sign_write_clear', detail: 'Motion A sign chooses the contact side; motion A is cleared after response.' },
      { kind: 'struct', offset: 0x11, fieldRole: 'player_struct_facing_direction', access: 'read_bit0', detail: 'Direction bit participates in side selection when motion A is zero.' },
      { kind: 'struct', offset: 0x31, fieldRole: 'player_struct_vector_substate', access: 'read_direction_variant', detail: 'IX+49 alters side selection for form/state 2 paths.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x01, fieldRole: 'player_struct_state_flags', access: 'set_bit2', detail: 'Marks coordinate-A contact state.' },
      { kind: 'struct', offset: 0x02, inferredField: 'coordinate_a_contact_latch', access: 'clear', detail: 'Cleared when coordinate-A contact is accepted.' },
      { kind: 'struct', offset: 0x03, fieldRole: 'player_struct_coordinate_word_a', access: 'snap_to_tile', detail: 'Snaps coordinate A to the blocking tile boundary.' },
      { kind: 'struct', offset: 0x08, fieldRole: 'player_struct_motion_word_a', access: 'clear_word', detail: 'Clears _RAM_C248_/motion word A after response.' },
      { kind: 'struct', offset: 0x1B, inferredField: 'contact_flags', access: 'set_bit2_or_bit3', detail: 'Bit 2 marks one coordinate-A side; bit 3 marks the opposite side.' },
    ],
    globalRamRefs: ['$D0F2'],
    evidence: [
      'ASM lines 4212-4235 choose side from motion A, facing/state, and _RAM_D0F2_.',
      'ASM lines 4236-4262 set IX+27 bit 2 or 3, snap _RAM_C243_, and clear _RAM_C248_.',
    ],
  },
  {
    label: '_LABEL_16D0_',
    offset: 0x016D0,
    role: 'special_collision_tile_capture',
    category: 'collision_special_tile',
    confidence: 'high',
    routineSummary: 'Captures the current probe coordinates when the collision tile value is 0x05.',
    frameEffect: 'If A equals 0x05, stores the probe coordinate pair and sets the special collision latch.',
    constants: [
      { name: 'special_tile_value', value: '0x05', meaning: 'Tile value that triggers coordinate capture.' },
    ],
    reads: [],
    writes: [
      { kind: 'global', address: '$D01B', access: 'set_1', detail: 'Marks that a special collision tile was seen.' },
      { kind: 'global', address: '$D01C', access: 'write_word', detail: 'Stores HL probe coordinate.' },
      { kind: 'global', address: '$D01E', access: 'write_word', detail: 'Stores DE probe coordinate.' },
    ],
    globalRamRefs: ['$D01B', '$D01C', '$D01E'],
    evidence: [
      'ASM lines 4265-4274 compare A with 0x05, store HL to _RAM_D01C_, store DE to _RAM_D01E_, and set _RAM_D01B_ to 1.',
    ],
  },
  {
    label: '_LABEL_16E2_',
    offset: 0x016E2,
    role: 'alternate_collision_sweep_response',
    category: 'collision_response',
    confidence: 'high',
    routineSummary: 'Alternate collision/bounds response used while _RAM_CF8B_ is active.',
    frameEffect: 'Applies alternate coordinate bounds, sets coordinate-A contact bits, clears motion A, then falls through to the coordinate-B floor clamp.',
    constants: [
      { name: 'alternate_coordinate_b_min', value: '0x30', meaning: 'Minimum IX+6 low byte in alternate mode.' },
      { name: 'alternate_coordinate_a_bound', value: '0x08', meaning: 'Small bound used by one side of alternate coordinate-A contact.' },
      { name: 'floor_coordinate_b_max', value: '0xB0', meaning: 'Floor clamp handled by _LABEL_1773_.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x03, fieldRole: 'player_struct_coordinate_word_a', access: 'read_write_bounds', detail: 'Coordinate A is adjusted against alternate bounds.' },
      { kind: 'struct', offset: 0x06, fieldRole: 'player_struct_coordinate_word_b', access: 'clamp_low_byte', detail: 'IX+6 is clamped to at least 0x30, then checked by floor clamp.' },
      { kind: 'struct', offset: 0x08, fieldRole: 'player_struct_motion_word_a', access: 'read_sign_write_clear', detail: 'Motion A sign chooses alternate side response; motion A is cleared.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x01, fieldRole: 'player_struct_state_flags', access: 'set_bit2', detail: 'Set for one alternate coordinate-A contact side.' },
      { kind: 'struct', offset: 0x03, fieldRole: 'player_struct_coordinate_word_a', access: 'adjust_bounds', detail: 'Adjusted to stay within alternate bounds.' },
      { kind: 'struct', offset: 0x08, fieldRole: 'player_struct_motion_word_a', access: 'clear_word', detail: 'Clears _RAM_C248_/motion word A on alternate coordinate-A contact.' },
      { kind: 'struct', offset: 0x1B, inferredField: 'contact_flags', access: 'set_bit2_or_bit3', detail: 'Sets coordinate-A contact side bits.' },
    ],
    globalRamRefs: ['$CF8B'],
    calls: ['_LABEL_12D5_', '_LABEL_1773_'],
    evidence: [
      'ASM lines 4276-4317 clamp IX+6 to 0x30 and resolve one alternate coordinate-A side.',
      'ASM lines 4318-4351 set IX+27 bit 2 or 3, adjust _RAM_C243_, and clear _RAM_C248_.',
      'ASM lines 4352-4366 are the fall-through floor clamp that can set coordinate-B contact and clear _RAM_C24A_.',
    ],
  },
  {
    label: '_LABEL_1773_',
    offset: 0x01773,
    role: 'coordinate_b_floor_clamp',
    category: 'bounds_response',
    confidence: 'high',
    routineSummary: 'Clamps coordinate B to the lower screen/world floor when descending past 0xB0.',
    frameEffect: 'If motion word B is non-negative and coordinate B reaches 0xB0, marks lower contact, clamps coordinate B, and clears motion B.',
    constants: [
      { name: 'floor_coordinate_b_max', value: '0xB0', meaning: 'Coordinate-B floor clamp value.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x0B, inferredField: 'motion_word_b_high', access: 'read_sign', detail: '_RAM_C24B sign gates floor response.' },
      { kind: 'struct', offset: 0x06, fieldRole: 'player_struct_coordinate_word_b', access: 'read_write_clamp', detail: 'Low byte is clamped to 0xB0.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x01, fieldRole: 'player_struct_state_flags', access: 'set_bit1', detail: 'Marks coordinate-B contact state.' },
      { kind: 'struct', offset: 0x05, inferredField: 'coordinate_b_contact_latch', access: 'clear', detail: 'Cleared on floor contact.' },
      { kind: 'struct', offset: 0x06, fieldRole: 'player_struct_coordinate_word_b', access: 'set_low_byte_0xB0', detail: 'Clamps coordinate B to 0xB0.' },
      { kind: 'struct', offset: 0x0A, fieldRole: 'player_struct_motion_word_b', access: 'clear_word', detail: 'Clears _RAM_C24A_/motion word B.' },
      { kind: 'struct', offset: 0x1B, inferredField: 'contact_flags', access: 'set_bit0', detail: 'Marks floor/lower coordinate-B contact.' },
    ],
    evidence: [
      'ASM lines 4352-4366 check _RAM_C24B sign, compare _RAM_C246_ to 0xB0, set IX+1 bit 1 and IX+27 bit 0, set _RAM_C246_ to 0xB0, and clear _RAM_C24A_.',
    ],
  },
  {
    label: '_LABEL_1927_',
    offset: 0x01927,
    role: 'coordinate_b_tile_snap_helper',
    category: 'collision_response',
    confidence: 'high',
    routineSummary: 'Shared coordinate-B tile snap helper for actor collision paths.',
    frameEffect: 'Sets coordinate-B contact state and snaps IX+6 to the appropriate 0x10 tile boundary based on contact side.',
    constants: [
      { name: 'tile_snap_size', value: '0x10', meaning: 'Coordinate-B snap boundary size.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x06, fieldRole: 'player_struct_coordinate_word_b', access: 'read_write_snap', detail: 'IX+6 is snapped to a tile boundary.' },
      { kind: 'struct', offset: 0x1B, inferredField: 'contact_flags', access: 'read_bits0_1_via_A', detail: 'A carries lower contact bits from caller.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x01, fieldRole: 'player_struct_state_flags', access: 'set_bit1', detail: 'Marks coordinate-B contact state.' },
      { kind: 'struct', offset: 0x05, inferredField: 'coordinate_b_contact_latch', access: 'clear', detail: 'Cleared before coordinate snap.' },
      { kind: 'struct', offset: 0x06, fieldRole: 'player_struct_coordinate_word_b', access: 'snap_to_tile', detail: 'Snaps coordinate B to the selected boundary.' },
    ],
    globalRamRefs: ['$D0F0'],
    evidence: [
      'ASM lines 4569-4592 set IX+1 bit 1, clear IX+5, and either mask IX+6 with 0xF0 or adjust it from _RAM_D0F0_.',
    ],
  },
  {
    label: '_LABEL_1951_',
    offset: 0x01951,
    role: 'coordinate_a_tile_snap_helper',
    category: 'collision_response',
    confidence: 'high',
    routineSummary: 'Shared coordinate-A tile snap helper for actor collision paths.',
    frameEffect: 'If coordinate-A contact bits are set, snaps coordinate A and either clears or reverses motion word A.',
    constants: [
      { name: 'tile_snap_size', value: '0x10', meaning: 'Coordinate-A snap boundary size.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x01, fieldRole: 'player_struct_state_flags', access: 'read_bit7', detail: 'Bit 7 controls whether motion A is reversed instead of cleared.' },
      { kind: 'struct', offset: 0x03, fieldRole: 'player_struct_coordinate_word_a', access: 'read_write_snap', detail: 'Coordinate A is snapped from _RAM_D0F2_.' },
      { kind: 'struct', offset: 0x08, fieldRole: 'player_struct_motion_word_a', access: 'read_write_clear_or_negate', detail: 'Motion A is cleared or two-complement negated.' },
      { kind: 'struct', offset: 0x1B, inferredField: 'contact_flags', access: 'read_bits2_3', detail: 'Only runs when coordinate-A contact bits are set.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x01, fieldRole: 'player_struct_state_flags', access: 'set_bit2', detail: 'Marks coordinate-A contact state.' },
      { kind: 'struct', offset: 0x02, inferredField: 'coordinate_a_contact_latch', access: 'clear', detail: 'Cleared before coordinate snap.' },
      { kind: 'struct', offset: 0x03, fieldRole: 'player_struct_coordinate_word_a', access: 'snap_to_tile', detail: 'Snaps coordinate A to the selected boundary.' },
      { kind: 'struct', offset: 0x08, fieldRole: 'player_struct_motion_word_a', access: 'clear_or_negate_word', detail: 'Clears IX+8/9 unless IX+1 bit 7 asks for bounce/reversal.' },
    ],
    globalRamRefs: ['$D0F2'],
    evidence: [
      'ASM lines 4594-4628 test IX+27 bits 2/3, set IX+1 bit 2, clear IX+2, and snap IX+3/4 from _RAM_D0F2_.',
      'ASM lines 4629-4647 clear IX+8/9 or two-complement negate it depending on IX+1 bit 7.',
    ],
  },
  {
    label: '_LABEL_19B6_',
    offset: 0x019B6,
    role: 'coordinate_b_velocity_accel_clamp',
    category: 'motion_acceleration',
    confidence: 'high',
    routineSummary: 'Gravity-like coordinate-B acceleration and clamp helper.',
    frameEffect: 'Optionally doubles upward/negative motion B in selected states, then adds state-dependent acceleration and clamps positive terminal speed.',
    constants: [
      { name: 'negative_motion_floor', value: '0xF400', meaning: 'Minimum negative motion word after special upward doubling.' },
      { name: 'normal_acceleration', value: '0x0100', meaning: 'Default acceleration added to motion word B.' },
      { name: 'flagged_acceleration', value: '0x0040', meaning: 'Reduced acceleration when IX+1 has bits 5/6 set.' },
      { name: 'form5_state8_acceleration', value: '0x0020', meaning: 'Smallest acceleration for form/state 5/8 path.' },
      { name: 'normal_positive_high_clamp', value: '0x08', meaning: 'Default positive high-byte clamp.' },
      { name: 'reduced_positive_high_clamp', value: '0x03', meaning: 'Positive high-byte clamp for reduced acceleration modes.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x01, fieldRole: 'player_struct_state_flags', access: 'read_bits5_6', detail: 'Bits 5/6 reduce acceleration and clamp.' },
      { kind: 'struct', offset: 0x0A, fieldRole: 'player_struct_motion_word_b', access: 'read_write_accumulate', detail: 'IX+10/11 is accelerated and clamped.' },
      { kind: 'struct', offset: 0x0F, fieldRole: 'player_struct_outer_form_state', access: 'read', detail: '_RAM_C24F_ form 5 plus inner state 8 selects 0x0020 acceleration.' },
      { kind: 'struct', offset: 0x20, fieldRole: 'player_struct_inner_state', access: 'read_low_nibble', detail: 'Low nibble is compared with state 8 for the reduced acceleration path.' },
      { kind: 'struct', offset: 0x30, inferredField: 'motion_b_special_flags', access: 'read_bits5_6', detail: 'IX+48 gates negative-motion doubling.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x0A, fieldRole: 'player_struct_motion_word_b', access: 'accelerate_and_clamp_word', detail: 'Updates IX+10/11.' },
      { kind: 'global', address: '$D0A4', access: 'set_1', detail: 'Set when negative motion was doubled and clamped.' },
    ],
    globalRamRefs: ['$D0A4'],
    evidence: [
      'ASM lines 4649-4670 double negative IX+10/11 under IX+48 and IX+1 flag conditions, clamp to 0xF400, and set _RAM_D0A4_.',
      'ASM lines 4672-4691 choose acceleration 0x0100, 0x0040, or 0x0020 and high-byte clamp 0x08 or 0x03.',
      'ASM lines 4692-4705 add acceleration to IX+10/11 and clamp positive high byte.',
    ],
  },
  {
    label: '_LABEL_1A28_',
    offset: 0x01A28,
    role: 'coordinate_b_motion_accel_wrapper',
    category: 'motion_acceleration',
    confidence: 'high',
    routineSummary: 'Applies the shared signed acceleration/clamp helper to player motion word B.',
    frameEffect: 'Adds signed IX+31 to _RAM_C24A_, with state-dependent +/-0x0400 or +/-0x0300 clamp behavior inherited from the shared tail.',
    constants: [
      { name: 'normal_motion_clamp', value: '+/-0x0400', meaning: 'Default signed clamp.' },
      { name: 'flagged_motion_clamp', value: '+/-0x0300', meaning: 'Clamp after halving the acceleration byte when selected state flags are active.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x0A, fieldRole: 'player_struct_motion_word_b', access: 'read_write_accumulate', detail: '_RAM_C24A_ is the target word.' },
      { kind: 'struct', offset: 0x1F, fieldRole: 'player_struct_motion_parameter_high', access: 'read_signed_acceleration', detail: 'IX+31 is sign-extended and added to motion word B.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x0A, fieldRole: 'player_struct_motion_word_b', access: 'signed_accumulate_clamp_word', detail: 'Writes the clamped result back to _RAM_C24A_.' },
    ],
    evidence: [
      'ASM lines 4707-4712 load _RAM_C24A_, use IX+31 as E, call the shared tail, and store DE back to _RAM_C24A_.',
      'ASM lines 4721-4805 sign-extend, add, and clamp to +/-0x0400 or +/-0x0300 depending on form/state flags.',
    ],
  },
  {
    label: '_LABEL_1A36_',
    offset: 0x01A36,
    role: 'coordinate_a_motion_accel_wrapper',
    category: 'motion_acceleration',
    confidence: 'high',
    routineSummary: 'Applies the shared signed acceleration/clamp helper to player motion word A.',
    frameEffect: 'Adds signed IX+30 to _RAM_C248_, with state-dependent +/-0x0400 or +/-0x0300 clamp behavior inherited from the shared tail.',
    constants: [
      { name: 'normal_motion_clamp', value: '+/-0x0400', meaning: 'Default signed clamp.' },
      { name: 'flagged_motion_clamp', value: '+/-0x0300', meaning: 'Clamp after halving the acceleration byte when selected state flags are active.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x08, fieldRole: 'player_struct_motion_word_a', access: 'read_write_accumulate', detail: '_RAM_C248_ is the target word.' },
      { kind: 'struct', offset: 0x1E, fieldRole: 'player_struct_motion_parameter_low', access: 'read_signed_acceleration', detail: 'IX+30 is sign-extended and added to motion word A.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x08, fieldRole: 'player_struct_motion_word_a', access: 'signed_accumulate_clamp_word', detail: 'Writes the clamped result back to _RAM_C248_.' },
    ],
    evidence: [
      'ASM lines 4714-4719 load _RAM_C248_, use IX+30 as E, call the shared tail, and store DE back to _RAM_C248_.',
      'ASM lines 4721-4805 sign-extend, add, and clamp to +/-0x0400 or +/-0x0300 depending on form/state flags.',
    ],
  },
  {
    label: '_LABEL_1AB6_',
    offset: 0x01AB6,
    role: 'coordinate_a_motion_damping',
    category: 'motion_damping',
    confidence: 'high',
    routineSummary: 'Reduces motion word A toward zero with state-dependent damping steps.',
    frameEffect: 'If _RAM_C248_ is nonzero, subtracts or adds a selected damping step toward zero and clamps through zero.',
    constants: [
      { name: 'default_damping_step', value: '0x0070', meaning: 'Default step toward zero.' },
      { name: 'state_flag_damping_step', value: '0x0080', meaning: 'Step when _RAM_C241_ bits 5/6 are set.' },
      { name: 'form3_state8_damping_step', value: '0x0050', meaning: 'Step for form 3 inner state 8.' },
      { name: 'ix_bit4_damping_step', value: '0x0030', meaning: 'Step when IX+1 bit 4 is set and state flags do not select the other path.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x08, fieldRole: 'player_struct_motion_word_a', access: 'read_write_toward_zero', detail: '_RAM_C248_ is damped toward zero.' },
      { kind: 'struct', offset: 0x01, fieldRole: 'player_struct_state_flags', access: 'read_bits4_5_6', detail: 'Bits select damping step.' },
      { kind: 'struct', offset: 0x0F, fieldRole: 'player_struct_outer_form_state', access: 'read', detail: 'Form 3 participates in special damping path.' },
      { kind: 'struct', offset: 0x20, fieldRole: 'player_struct_inner_state', access: 'read_low_nibble', detail: 'Inner state 8 participates in special damping path.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x08, fieldRole: 'player_struct_motion_word_a', access: 'damp_toward_zero_word', detail: 'Stores the damped value to _RAM_C248_.' },
    ],
    evidence: [
      'ASM lines 4815-4839 select damping step 0x70, 0x80, 0x50, or 0x30 from _RAM_C241_, _RAM_C24F_, _RAM_C260_, and IX+1 bit 4.',
      'ASM lines 4840-4856 subtract/add the step toward zero and store _RAM_C248_.',
    ],
  },
  {
    label: '_LABEL_1AFF_',
    offset: 0x01AFF,
    role: 'coordinate_b_motion_damping',
    category: 'motion_damping',
    confidence: 'high',
    routineSummary: 'Reduces motion word B toward zero with a fixed damping step.',
    frameEffect: 'If _RAM_C24A_ is nonzero, adds or subtracts 0x0060 toward zero and clamps through zero.',
    constants: [
      { name: 'damping_step', value: '0x0060', meaning: 'Fixed step toward zero.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x0A, fieldRole: 'player_struct_motion_word_b', access: 'read_write_toward_zero', detail: '_RAM_C24A_ is damped toward zero.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x0A, fieldRole: 'player_struct_motion_word_b', access: 'damp_toward_zero_word', detail: 'Stores the damped value to _RAM_C24A_.' },
    ],
    evidence: [
      'ASM lines 4858-4880 use fixed step 0x0060 to move _RAM_C24A_ toward zero and clamp through zero.',
    ],
  },
  {
    label: '_LABEL_1B25_',
    offset: 0x01B25,
    role: 'packed_motion_integrator_coordinate_b',
    category: 'motion_integrator',
    confidence: 'high',
    routineSummary: 'Interprets packed nibbles in IX+31 as signed fractional acceleration and adds it to motion word B.',
    frameEffect: 'Decodes IX+31 into a signed 16-bit delta and adds it to IX+10/11.',
    constants: [
      { name: 'fraction_nibble_shift', value: '4 rotates', meaning: 'High and low nibbles are rearranged into a signed delta.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x0A, fieldRole: 'player_struct_motion_word_b', access: 'read_write_add_delta', detail: 'IX+10/11 receives the packed delta.' },
      { kind: 'struct', offset: 0x1F, fieldRole: 'player_struct_motion_parameter_high', access: 'read_packed_delta', detail: 'IX+31 provides packed signed fractional acceleration.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x0A, fieldRole: 'player_struct_motion_word_b', access: 'add_packed_delta_word', detail: 'Stores updated IX+10/11.' },
    ],
    evidence: [
      'ASM lines 4884-4907 rotate IX+31 four times, sign-extend bit 3, combine integer/fraction parts, add to IX+10/11, and store the result.',
    ],
  },
  {
    label: '_LABEL_1B4B_',
    offset: 0x01B4B,
    role: 'packed_motion_integrator_coordinate_a',
    category: 'motion_integrator',
    confidence: 'high',
    routineSummary: 'Interprets packed nibbles in IX+30 as signed fractional acceleration and adds it to motion word A.',
    frameEffect: 'Decodes IX+30 into a signed 16-bit delta and adds it to IX+8/9.',
    constants: [
      { name: 'fraction_nibble_shift', value: '4 rotates', meaning: 'High and low nibbles are rearranged into a signed delta.' },
    ],
    reads: [
      { kind: 'struct', offset: 0x08, fieldRole: 'player_struct_motion_word_a', access: 'read_write_add_delta', detail: 'IX+8/9 receives the packed delta.' },
      { kind: 'struct', offset: 0x1E, fieldRole: 'player_struct_motion_parameter_low', access: 'read_packed_delta', detail: 'IX+30 provides packed signed fractional acceleration.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x08, fieldRole: 'player_struct_motion_word_a', access: 'add_packed_delta_word', detail: 'Stores updated IX+8/9.' },
    ],
    evidence: [
      'ASM lines 4909-4932 rotate IX+30 four times, sign-extend bit 3, combine integer/fraction parts, add to IX+8/9, and store the result.',
    ],
  },
  {
    label: '_LABEL_1C98_',
    offset: 0x01C98,
    role: 'actor_aabb_overlap_test',
    category: 'overlap_test',
    confidence: 'high',
    routineSummary: 'Regular actor-vs-actor AABB overlap test using coordinate, size, and offset fields.',
    frameEffect: 'Computes two interval overlaps and returns carry on overlap; does not mutate actor state.',
    reads: [
      { kind: 'struct', offset: 0x03, fieldRole: 'player_struct_coordinate_word_a', access: 'read', detail: 'IX/IY+3/4 are coordinate-A words.' },
      { kind: 'struct', offset: 0x06, fieldRole: 'player_struct_coordinate_word_b', access: 'read', detail: 'IX/IY+6/7 are coordinate-B words.' },
      { kind: 'struct', offset: 0x14, inferredField: 'hitbox_size_a', access: 'read', detail: 'IX/IY+20 contribute horizontal/coordinate-A extent.' },
      { kind: 'struct', offset: 0x15, inferredField: 'hitbox_size_b', access: 'read', detail: 'IX/IY+21 contribute vertical/coordinate-B extent.' },
      { kind: 'struct', offset: 0x16, inferredField: 'hitbox_offset_a', access: 'read', detail: 'IX/IY+22 are signed coordinate-A offsets.' },
      { kind: 'struct', offset: 0x17, inferredField: 'hitbox_offset_b', access: 'read', detail: 'IX/IY+23 are signed coordinate-B offsets.' },
    ],
    writes: [],
    calls: ['_LABEL_1CFE_'],
    evidence: [
      'ASM lines 5054-5110 compare IX and IY coordinate intervals using offsets +20/+21/+22/+23 and _LABEL_1CFE_.',
    ],
  },
  {
    label: '_LABEL_1D10_',
    offset: 0x01D10,
    role: 'actor_extended_hitbox_overlap_test',
    category: 'overlap_test',
    confidence: 'high',
    routineSummary: 'Actor-vs-extended-hitbox overlap test using IY offsets +36..+39 for the second rectangle.',
    frameEffect: 'Computes overlap between IX regular bounds and IY extended attack/damage bounds; returns carry on overlap.',
    reads: [
      { kind: 'struct', offset: 0x14, inferredField: 'hitbox_size_a', access: 'read', detail: 'IX+20 contributes coordinate-A extent.' },
      { kind: 'struct', offset: 0x15, inferredField: 'hitbox_size_b', access: 'read', detail: 'IX+21 contributes coordinate-B extent.' },
      { kind: 'struct', offset: 0x24, inferredField: 'extended_hitbox_size_a', access: 'read', detail: 'IY+36 contributes extended coordinate-A extent.' },
      { kind: 'struct', offset: 0x25, inferredField: 'extended_hitbox_size_b', access: 'read', detail: 'IY+37 contributes extended coordinate-B extent.' },
      { kind: 'struct', offset: 0x26, inferredField: 'extended_hitbox_offset_a', access: 'read', detail: 'IY+38 is signed coordinate-A offset.' },
      { kind: 'struct', offset: 0x27, inferredField: 'extended_hitbox_offset_b', access: 'read', detail: 'IY+39 is signed coordinate-B offset.' },
    ],
    writes: [],
    calls: ['_LABEL_1CFE_'],
    evidence: [
      'ASM lines 5131-5187 mirror _LABEL_1C98_ but use IY+36/IY+37 sizes and IY+38/IY+39 offsets for the extended hitbox.',
    ],
  },
  {
    label: '_LABEL_1D76_',
    offset: 0x01D76,
    role: 'entity_player_body_contact_handler',
    category: 'contact_handler',
    confidence: 'high',
    routineSummary: 'Entity body overlap against the player body.',
    frameEffect: 'On body overlap, marks contact on both structs, copies entity contact/damage metadata to player IX/IY fields, and sets facing-side bits.',
    reads: [
      { kind: 'struct', offset: 0x00, fieldRole: 'player_struct_flags', access: 'read_write_contact_bits', detail: 'IX/IY+0 contact bits are read and set.' },
      { kind: 'struct', offset: 0x01, fieldRole: 'player_struct_state_flags', access: 'read_write_side_bits', detail: 'IX/IY+1 side bits are updated from overlap direction.' },
      { kind: 'struct', offset: 0x18, inferredField: 'contact_payload', access: 'read', detail: 'IX+24 is copied to player IY+28.' },
      { kind: 'struct', offset: 0x1C, fieldRole: 'player_struct_damage_lookup_input', access: 'write', detail: 'Player IY+28 receives entity contact payload.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x00, fieldRole: 'player_struct_flags', access: 'set_bit2', detail: 'Marks overlap/contact on IX and IY.' },
      { kind: 'struct', offset: 0x1C, fieldRole: 'player_struct_damage_lookup_input', access: 'write_contact_payload', detail: 'Writes entity IX+24 into player IY+28.' },
    ],
    globalRamRefs: ['$C240'],
    calls: ['_LABEL_1C98_'],
    evidence: [
      'ASM lines 5189-5209 set IY to _RAM_C240_, call _LABEL_1C98_, set IX/IY bit 2, copy IX+24 to IY+28, and update side bits from C bit 0.',
    ],
  },
  {
    label: '_LABEL_1DAB_',
    offset: 0x01DAB,
    role: 'player_attack_hitbox_contact_handler',
    category: 'contact_handler',
    confidence: 'high',
    routineSummary: 'Entity overlap against the player attack extended hitbox.',
    frameEffect: 'When the current form and attack hitbox allow it, marks entity hit state, clears the player attack-active bit, copies player attack metadata to the entity, and sets side bits.',
    reads: [
      { kind: 'struct', offset: 0x0F, fieldRole: 'player_struct_outer_form_state', access: 'read', detail: 'Form 1 skips this attack hitbox path.' },
      { kind: 'struct', offset: 0x24, inferredField: 'extended_hitbox_size_a', access: 'read_nonzero', detail: 'Player IY+36 must be nonzero.' },
      { kind: 'struct', offset: 0x25, inferredField: 'extended_hitbox_size_b', access: 'read_nonzero', detail: 'Player IY+37 must be nonzero.' },
      { kind: 'global', address: '$C258', access: 'read', detail: 'Copied into entity IX+47 as attack/contact metadata.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x00, fieldRole: 'player_struct_flags', access: 'set_ix_bit3', detail: 'Marks entity as hit by player attack.' },
      { kind: 'struct', offset: 0x01, fieldRole: 'player_struct_state_flags', access: 'clear_iy_bit0_and_side_bits', detail: 'Clears player attack-active bit and updates side bits.' },
      { kind: 'struct', offset: 0x2F, inferredField: 'contact_damage_metadata', access: 'write', detail: 'Entity IX+47 receives _RAM_C258_.' },
    ],
    globalRamRefs: ['$C240', '$C258'],
    calls: ['_LABEL_1D10_'],
    evidence: [
      'ASM lines 5211-5229 skip form 1, require player attack bits and extended hitbox size, call _LABEL_1D10_, set IX+0 bit 3, clear IY+1 bit 0, and copy _RAM_C258_ to IX+47.',
      'ASM lines 5230-5249 choose side bits from player form/direction and overlap direction.',
    ],
  },
  {
    label: '_LABEL_1E02_',
    offset: 0x01E02,
    role: 'entity_attack_player_contact_handler',
    category: 'contact_handler',
    confidence: 'high',
    routineSummary: 'Entity extended-hitbox overlap against the player.',
    frameEffect: 'On valid entity attack overlap, marks entity and player contact, copies entity damage/contact payload to player IY+29, and sets side bits.',
    reads: [
      { kind: 'struct', offset: 0x11, fieldRole: 'player_struct_facing_direction', access: 'read_compare', detail: 'Compared against entity IX+17 in one gating path.' },
      { kind: 'struct', offset: 0x18, inferredField: 'contact_payload', access: 'read', detail: 'IX+24 is copied to player IY+29.' },
      { kind: 'struct', offset: 0x24, inferredField: 'extended_hitbox_size_a', access: 'read_nonzero', detail: 'Player IY+36 must be nonzero.' },
      { kind: 'struct', offset: 0x25, inferredField: 'extended_hitbox_size_b', access: 'read_nonzero', detail: 'Player IY+37 must be nonzero.' },
      { kind: 'struct', offset: 0x31, fieldRole: 'player_struct_vector_substate', access: 'read_gate', detail: '_RAM_C271_ gates the direction-comparison path.' },
    ],
    writes: [
      { kind: 'struct', offset: 0x00, fieldRole: 'player_struct_flags', access: 'set_ix_bit3_and_iy_bit3', detail: 'Marks entity attack hit and player contact.' },
      { kind: 'struct', offset: 0x1D, inferredField: 'player_received_contact_payload', access: 'write', detail: 'Player IY+29 receives IX+24.' },
      { kind: 'struct', offset: 0x01, fieldRole: 'player_struct_state_flags', access: 'update_side_bits', detail: 'Side bits are updated from overlap direction.' },
    ],
    globalRamRefs: ['$C240', '$C271'],
    calls: ['_LABEL_1D10_'],
    evidence: [
      'ASM lines 5251-5268 set IY to _RAM_C240_, validate player state, hitbox size, _RAM_C271_, and facing/direction before calling _LABEL_1D10_.',
      'ASM lines 5269-5283 set IX+0 bit 3 and IY+0 bit 3, copy IX+24 to IY+29, and update side bits from C bit 0.',
    ],
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function normalizeAddress(address) {
  return String(address || '').toUpperCase().replace(/^0X/, '$');
}

function parseRamAddress(address) {
  const match = normalizeAddress(address).match(/^\$([0-9A-F]+)$/);
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
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

function findRamEntry(mapData, address) {
  const normalized = normalizeAddress(address);
  return (mapData.ram || []).find(entry => normalizeAddress(entry.address) === normalized) || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function structFieldByOffset(playerStructCatalog) {
  const out = new Map();
  for (const field of playerStructCatalog?.fields || []) {
    if (typeof field.offsetInStruct === 'number') out.set(field.offsetInStruct, field);
  }
  return out;
}

function enrichAccessList(accessList, structFields, mapData) {
  return (accessList || []).map(item => {
    if (item.kind === 'struct') {
      const field = structFields.get(item.offset) || null;
      return {
        ...item,
        offsetHex: '$' + item.offset.toString(16).toUpperCase().padStart(2, '0'),
        catalogFieldRole: field?.role || null,
        catalogFieldConfidence: field?.confidence || null,
        catalogFieldAddress: field?.address || null,
        ram: field?.ram || null,
      };
    }
    if (item.kind === 'global') {
      const entry = findRamEntry(mapData, item.address);
      return {
        ...item,
        ram: ramRef(entry),
      };
    }
    return item;
  });
}

function buildCatalog(mapData) {
  const playerStructCatalog = findCatalog(mapData, playerStructCatalogId);
  const physicsRoutineCatalog = findCatalog(mapData, playerPhysicsRoutineCatalogId);
  const structFields = structFieldByOffset(playerStructCatalog);
  const existingRoutineLabels = new Set((physicsRoutineCatalog?.routines || []).map(routine => routine.label));
  const missingFromRoutineCatalog = [];

  const effects = EFFECT_DEFS.map(def => {
    if (!existingRoutineLabels.has(def.label)) missingFromRoutineCatalog.push(def.label);
    const region = findContainingRegion(mapData, def.offset);
    const reads = enrichAccessList(def.reads, structFields, mapData);
    const writes = enrichAccessList(def.writes, structFields, mapData);
    const fieldOffsets = [...new Set([...reads, ...writes]
      .filter(item => item.kind === 'struct')
      .map(item => item.offset))]
      .sort((a, b) => a - b);
    const globalRamRefs = [...new Set([
      ...(def.globalRamRefs || []),
      ...[...reads, ...writes].filter(item => item.kind === 'global').map(item => item.address),
    ])].map(address => {
      const entry = findRamEntry(mapData, address);
      return {
        address,
        ram: ramRef(entry),
      };
    });
    return {
      id: `${def.label}_${def.role}`,
      label: def.label,
      offset: hex(def.offset),
      role: def.role,
      category: def.category,
      confidence: def.confidence,
      region: regionRef(region),
      routineSummary: def.routineSummary,
      frameEffect: def.frameEffect,
      constants: def.constants || [],
      reads,
      writes,
      touchedStructOffsets: fieldOffsets.map(offset => ({
        offset,
        offsetHex: '$' + offset.toString(16).toUpperCase().padStart(2, '0'),
        field: structFields.get(offset)?.role || null,
        fieldAddress: structFields.get(offset)?.address || null,
      })),
      globalRamRefs,
      calls: def.calls || [],
      evidence: def.evidence,
    };
  });

  const constantsByName = new Map();
  for (const effect of effects) {
    for (const constant of effect.constants) {
      const key = `${constant.name}|${constant.value}`;
      const current = constantsByName.get(key) || {
        name: constant.name,
        value: constant.value,
        meanings: [],
        usedBy: [],
      };
      if (!current.meanings.includes(constant.meaning)) current.meanings.push(constant.meaning);
      current.usedBy.push(effect.label);
      constantsByName.set(key, current);
    }
  }

  const fieldUsage = new Map();
  for (const effect of effects) {
    for (const access of [...effect.reads, ...effect.writes]) {
      if (access.kind !== 'struct') continue;
      const key = access.offsetHex;
      const current = fieldUsage.get(key) || {
        offset: access.offset,
        offsetHex: access.offsetHex,
        fieldRole: access.fieldRole || access.catalogFieldRole || access.inferredField || null,
        catalogFieldRole: access.catalogFieldRole,
        catalogFieldAddress: access.catalogFieldAddress,
        readCount: 0,
        writeCount: 0,
        routines: [],
      };
      if (effect.reads.includes(access)) current.readCount++;
      if (effect.writes.includes(access)) current.writeCount++;
      if (!current.routines.includes(effect.label)) current.routines.push(effect.label);
      fieldUsage.set(key, current);
    }
  }

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      ...(playerStructCatalog ? [playerStructCatalogId] : []),
      ...(physicsRoutineCatalog ? [playerPhysicsRoutineCatalogId] : []),
    ],
    semantics: {
      coordinateNames: 'The ROM evidence in this catalog proves paired coordinate/motion axes, but exact screen X/Y naming remains intentionally coordinate_a/coordinate_b until frame traces confirm orientation in multiple rooms.',
      contactFlags: 'IX+27 is treated as contact_flags: bits 0/1 are coordinate-B contact sides, and bits 2/3 are coordinate-A contact sides, based on _LABEL_1551_, _LABEL_166C_, _LABEL_181D_, _LABEL_186F_, _LABEL_1927_, and _LABEL_1951_.',
      solidTilePolicy: 'Tile values below 0x10 are blocking/contact tiles in these routines; tile value 0x05 additionally captures special collision probe coordinates.',
      scalarPolicy: 'Small numeric constants are ASM-derived behavior constants only. No ROM byte streams, lookup table contents, or decoded assets are embedded.',
    },
    summary: {
      effectCount: effects.length,
      categoryCounts: effects.reduce((counts, effect) => {
        counts[effect.category] = (counts[effect.category] || 0) + 1;
        return counts;
      }, {}),
      uniqueStructOffsetsTouched: fieldUsage.size,
      globalRamRefs: new Set(effects.flatMap(effect => effect.globalRamRefs.map(ref => ref.address))).size,
      constantsRecorded: constantsByName.size,
      missingRegions: effects.filter(effect => !effect.region).length,
      missingFromRoutineCatalog: missingFromRoutineCatalog.length,
      assetPolicy: 'Metadata only: routine labels, offsets, state effects, RAM/struct field refs, scalar constants, and ASM evidence. No ROM bytes, decoded graphics, music, tables, or gameplay asset payloads are embedded.',
    },
    effects,
    fieldUsage: [...fieldUsage.values()].sort((a, b) => a.offset - b.offset),
    constants: [...constantsByName.values()].sort((a, b) => a.name.localeCompare(b.name) || a.value.localeCompare(b.value)),
    validationIssues: [
      ...effects.filter(effect => !effect.region).map(effect => ({
        kind: 'missing_region',
        label: effect.label,
        offset: effect.offset,
      })),
      ...missingFromRoutineCatalog.map(label => ({
        kind: 'missing_from_player_physics_routine_catalog',
        label,
      })),
    ],
  };
}

function compactEffectRef(effect) {
  return {
    catalogId,
    label: effect.label,
    offset: effect.offset,
    role: effect.role,
    category: effect.category,
    confidence: effect.confidence,
    frameEffect: effect.frameEffect,
    constants: effect.constants,
    touchedStructOffsets: effect.touchedStructOffsets,
    globalRamRefs: effect.globalRamRefs.map(ref => ({
      address: ref.address,
      ramId: ref.ram?.id || null,
    })),
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const ramRefsByAddress = new Map();

  for (const effect of catalog.effects) {
    if (effect.region) {
      const region = (mapData.regions || []).find(item => item.id === effect.region.id);
      if (region) {
        region.analysis = region.analysis || {};
        region.analysis.playerPhysicsStateEffectAudit = {
          catalogId,
          kind: effect.role,
          category: effect.category,
          label: effect.label,
          confidence: effect.confidence,
          summary: effect.routineSummary,
          frameEffect: effect.frameEffect,
          constants: effect.constants,
          reads: effect.reads,
          writes: effect.writes,
          touchedStructOffsets: effect.touchedStructOffsets,
          globalRamRefs: effect.globalRamRefs,
          calls: effect.calls,
          evidence: effect.evidence,
          generatedAt: now,
          tool: toolName,
        };
        annotatedRegions.push({
          id: region.id,
          offset: region.offset,
          label: effect.label,
          role: effect.role,
          category: effect.category,
        });
      }
    }

    for (const access of [...effect.reads, ...effect.writes]) {
      if (access.kind === 'struct' && access.catalogFieldAddress) {
        if (!ramRefsByAddress.has(access.catalogFieldAddress)) ramRefsByAddress.set(access.catalogFieldAddress, []);
        ramRefsByAddress.get(access.catalogFieldAddress).push({
          ...compactEffectRef(effect),
          access: {
            kind: access.kind,
            offsetHex: access.offsetHex,
            fieldRole: access.fieldRole || access.catalogFieldRole || access.inferredField || null,
            access: access.access,
            detail: access.detail,
          },
        });
      } else if (access.kind === 'global' && access.address) {
        if (!ramRefsByAddress.has(access.address)) ramRefsByAddress.set(access.address, []);
        ramRefsByAddress.get(access.address).push({
          ...compactEffectRef(effect),
          access: {
            kind: access.kind,
            address: access.address,
            access: access.access,
            detail: access.detail,
          },
        });
      }
    }
  }

  const annotatedRamEntries = [];
  for (const [address, refs] of ramRefsByAddress.entries()) {
    const ram = findRamEntry(mapData, address);
    if (!ram) continue;
    ram.analysis = ram.analysis || {};
    ram.analysis.playerPhysicsStateEffectAudit = {
      catalogId,
      kind: 'player_physics_state_effect_field_usage',
      confidence: refs.some(ref => ref.confidence === 'medium') ? 'medium' : 'high',
      summary: 'RAM field is read or written by confirmed player physics, collision, motion, or contact state effects.',
      refs: refs.slice(0, 96),
      generatedAt: now,
      tool: toolName,
    };
    annotatedRamEntries.push({
      id: ram.id,
      address: ram.address,
      name: ram.name || '',
      refCount: refs.length,
    });
  }

  return { annotatedRegions, annotatedRamEntries };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotations = apply
    ? annotateMap(mapData, catalog)
    : { annotatedRegions: [], annotatedRamEntries: [] };

  if (apply) {
    mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(item => item.id !== catalogId);
    mapData.playerCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_physics_state_effect_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotations.annotatedRegions.length,
        annotatedRamEntries: annotations.annotatedRamEntries.length,
      },
      semantics: catalog.semantics,
      fieldUsage: catalog.fieldUsage,
      constants: catalog.constants,
      validationIssues: catalog.validationIssues,
      annotatedRegions: annotations.annotatedRegions,
      annotatedRamEntries: annotations.annotatedRamEntries,
      nextLeads: [
        'Frame-trace _LABEL_1446_ in rooms with known camera coordinates to prove whether coordinate_a is X and coordinate_b is Y.',
        'Extend this state-effect catalog to the player state handlers at _LABEL_50F3_, _LABEL_51FB_, _LABEL_52D8_, and _LABEL_4EBD_ so input, jump, fall, and transformation transitions become frame-readable.',
        'Use contact handler effects to split player damage, player attack, enemy body contact, item collection, and auxiliary entity contact into separate engine modules.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotations.annotatedRegions.length,
      annotatedRamEntries: annotations.annotatedRamEntries.length,
    },
    validationIssues: catalog.validationIssues,
    firstEffects: catalog.effects.slice(0, 6).map(effect => ({
      label: effect.label,
      role: effect.role,
      category: effect.category,
      constants: effect.constants.map(constant => `${constant.name}=${constant.value}`),
      readCount: effect.reads.length,
      writeCount: effect.writes.length,
    })),
  }, null, 2));
}

main();
