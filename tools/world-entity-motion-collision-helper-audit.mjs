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
const catalogId = 'world-entity-motion-collision-helper-catalog-2026-06-25';
const reportId = 'entity-motion-collision-helper-audit-2026-06-25';
const toolName = 'tools/world-entity-motion-collision-helper-audit.mjs';
const structCatalogId = 'world-entity-runtime-struct-field-catalog-2026-06-25';

function field(register, offset, access, detail, role = null) {
  return { register, offset, token: `${register}+${offset}`, access, role, detail };
}

function helper(offset, label, role, category, summary, options = {}) {
  return {
    offset,
    label,
    role,
    category,
    type: 'code',
    confidence: options.confidence || 'high',
    calls: options.calls || [],
    constants: options.constants || [],
    fieldRefs: options.fieldRefs || [],
    globalRamRefs: options.globalRamRefs || [],
    frameEffect: options.frameEffect || summary,
    summary,
    evidence: [
      `${label} is an ASM code label at ROM offset ${hex(offset)}.`,
      ...(options.evidence || []),
    ],
  };
}

const HELPERS = [
  helper(0x012D5, '_LABEL_12D5_', 'integrate_coordinate_b_then_coordinate_a', 'motion_integrator',
    'Wrapper that applies the coordinate-B velocity integrator and then falls into the coordinate-A velocity integrator.', {
      calls: ['_LABEL_12F8_', '_LABEL_12D8_'],
      fieldRefs: [
        field('IX', 5, 'read_write_add_velocity', 'Coordinate-B subpixel/fraction byte updated by _LABEL_12F8_.', 'coordinate_b_subpixel'),
        field('IX', 6, 'read_write_add_velocity', 'Coordinate-B low byte updated by _LABEL_12F8_.', 'coordinate_word_b_low'),
        field('IX', 7, 'read_write_carry_sign_extend', 'Coordinate-B high byte receives the signed carry from velocity B.', 'coordinate_word_b_high'),
        field('IX', 10, 'read_signed_velocity', 'Velocity-B low byte read by _LABEL_12F8_.', 'vertical_velocity_low'),
        field('IX', 11, 'read_signed_velocity', 'Velocity-B high/sign byte read by _LABEL_12F8_.', 'vertical_velocity_high'),
        field('IX', 2, 'read_write_add_velocity', 'Coordinate-A subpixel/fraction byte updated by _LABEL_12D8_.', 'coordinate_a_subpixel'),
        field('IX', 3, 'read_write_add_velocity', 'Coordinate-A low byte updated by _LABEL_12D8_.', 'coordinate_word_a_low'),
        field('IX', 4, 'read_write_carry_sign_extend', 'Coordinate-A high byte receives the signed carry from velocity A.', 'coordinate_word_a_high'),
        field('IX', 8, 'read_signed_velocity', 'Velocity-A low byte read by _LABEL_12D8_.', 'horizontal_velocity_low'),
        field('IX', 9, 'read_signed_velocity', 'Velocity-A high/sign byte read by _LABEL_12D8_.', 'horizontal_velocity_high'),
      ],
      evidence: [
        'ASM lines 3672-3673 call _LABEL_12F8_ and fall through to _LABEL_12D8_.',
        'ASM lines 3674-3696 and 3698-3720 perform signed 16-bit velocity addition into 24-bit coordinate accumulators.',
      ],
    }),
  helper(0x012D8, '_LABEL_12D8_', 'coordinate_a_velocity_integrator', 'motion_integrator',
    'Adds signed velocity word A in IX+8/IX+9 into the 24-bit coordinate-A accumulator at IX+2/IX+3/IX+4.', {
      fieldRefs: [
        field('IX', 2, 'read_write_add_velocity', 'Coordinate-A subpixel/fraction byte.'),
        field('IX', 3, 'read_write_add_velocity', 'Coordinate-A low byte.'),
        field('IX', 4, 'read_write_carry_sign_extend', 'Coordinate-A high byte.'),
        field('IX', 8, 'read_signed_velocity', 'Velocity-A low byte.'),
        field('IX', 9, 'read_signed_velocity', 'Velocity-A high/sign byte.'),
      ],
      evidence: [
        'ASM lines 3674-3696 sign-extend IX+8/IX+9, add it to IX+2/IX+3, and store carry into IX+4.',
      ],
    }),
  helper(0x012F8, '_LABEL_12F8_', 'coordinate_b_velocity_integrator', 'motion_integrator',
    'Adds signed velocity word B in IX+10/IX+11 into the 24-bit coordinate-B accumulator at IX+5/IX+6/IX+7.', {
      fieldRefs: [
        field('IX', 5, 'read_write_add_velocity', 'Coordinate-B subpixel/fraction byte.'),
        field('IX', 6, 'read_write_add_velocity', 'Coordinate-B low byte.'),
        field('IX', 7, 'read_write_carry_sign_extend', 'Coordinate-B high byte.'),
        field('IX', 10, 'read_signed_velocity', 'Velocity-B low byte.'),
        field('IX', 11, 'read_signed_velocity', 'Velocity-B high/sign byte.'),
      ],
      evidence: [
        'ASM lines 3698-3720 sign-extend IX+10/IX+11, add it to IX+5/IX+6, and store carry into IX+7.',
      ],
    }),
  helper(0x017AB, '_LABEL_17AB_', 'actor_full_collision_pipeline', 'collision_pipeline',
    'Full actor collision sweep: clears contact state, integrates coordinate A, probes/snaps coordinate A, integrates coordinate B, probes/snaps coordinate B, and stops vertical velocity on contact.', {
      calls: ['_LABEL_12D8_', '_LABEL_186F_', '_LABEL_1951_', '_LABEL_12F8_', '_LABEL_181D_', '_LABEL_18DC_'],
      fieldRefs: [
        field('IX', 1, 'clear_bits1_2_then_response_writes', 'State/contact bits are cleared before collision response helpers set accepted contacts.'),
        field('IX', 27, 'clear_then_probe_bits', 'Contact flags are cleared and then populated by coordinate probes.'),
      ],
      evidence: [
        'ASM lines 4378-4393 clear IX+27, clear IX+1 bits 1/2, then call _LABEL_12D8_, _LABEL_186F_, _LABEL_1951_, _LABEL_12F8_, _LABEL_181D_, and _LABEL_18DC_.',
      ],
    }),
  helper(0x017FE, '_LABEL_17FE_', 'actor_bounce_collision_pipeline', 'collision_pipeline',
    'Collision sweep variant that uses the coordinate-B bounce response instead of always clearing velocity B.', {
      calls: ['_LABEL_12D8_', '_LABEL_186F_', '_LABEL_1951_', '_LABEL_12F8_', '_LABEL_181D_', '_LABEL_18EE_'],
      fieldRefs: [
        field('IX', 1, 'clear_bits1_2_then_response_writes', 'State/contact bits are cleared before collision response helpers set accepted contacts.'),
        field('IX', 27, 'clear_then_probe_bits', 'Contact flags are cleared and then populated by coordinate probes.'),
      ],
      evidence: [
        'ASM lines 4407-4422 mirror _LABEL_17AB_ but call _LABEL_18EE_ for coordinate-B bounce response.',
      ],
    }),
  helper(0x0181D, '_LABEL_181D_', 'coordinate_b_contact_probe', 'collision_probe',
    'Probes the coordinate-B leading edge against the collision buffer and sets IX+27 bit 0 or 1 when a blocking tile is found.', {
      calls: ['_LABEL_141F_'],
      constants: [
        { name: 'solid_tile_threshold', value: '0x10', meaning: 'Tile values below this threshold are treated as blocking for the probe.' },
      ],
      fieldRefs: [
        field('IX', 3, 'read_probe_coordinate', 'Coordinate-A low byte for the probe column.'),
        field('IX', 4, 'read_probe_coordinate', 'Coordinate-A high byte for the probe column.'),
        field('IX', 6, 'read_probe_coordinate', 'Coordinate-B low byte.'),
        field('IX', 7, 'read_probe_coordinate', 'Coordinate-B high byte.'),
        field('IX', 11, 'read_motion_sign', 'Velocity-B sign chooses which edge is probed.'),
        field('IX', 21, 'read_hitbox_edge', 'Coordinate-B inner edge/extent byte.'),
        field('IX', 23, 'read_hitbox_edge', 'Coordinate-B offset/extent byte.'),
        field('IX', 27, 'set_bit0_or_bit1', 'Contact bit 0 or bit 1 is set depending on velocity-B sign.'),
      ],
      globalRamRefs: ['_RAM_D0F0_', '_RAM_D01A_'],
      evidence: [
        'ASM lines 4425-4475 compute a coordinate-B edge from IX+6/7, IX+21, IX+23, and IX+11 sign, then call _LABEL_141F_.',
        'ASM lines 4476-4487 set IX+27 bit 0 or bit 1 when the probed tile is below 0x10.',
      ],
    }),
  helper(0x0186F, '_LABEL_186F_', 'coordinate_a_contact_probe', 'collision_probe',
    'Probes the coordinate-A leading edge against the collision buffer and sets IX+27 bit 2 or 3 when a blocking tile is found.', {
      calls: ['_LABEL_141F_'],
      constants: [
        { name: 'solid_tile_threshold', value: '0x10', meaning: 'Tile values below this threshold are treated as blocking for the probe.' },
      ],
      fieldRefs: [
        field('IX', 3, 'read_probe_coordinate', 'Coordinate-A low byte.'),
        field('IX', 4, 'read_probe_coordinate', 'Coordinate-A high byte.'),
        field('IX', 6, 'read_probe_coordinate', 'Coordinate-B low byte for probe row.'),
        field('IX', 7, 'read_probe_coordinate', 'Coordinate-B high byte for probe row.'),
        field('IX', 8, 'read_motion_sign', 'Velocity-A low byte.'),
        field('IX', 9, 'read_motion_sign', 'Velocity-A sign byte chooses probe side when velocity is nonzero.'),
        field('IX', 17, 'read_direction_fallback', 'Facing bit chooses probe side when velocity A is zero.'),
        field('IX', 20, 'read_hitbox_extent', 'Coordinate-A extent byte.'),
        field('IX', 22, 'read_hitbox_offset', 'Signed coordinate-A hitbox offset.'),
        field('IX', 27, 'set_bit2_or_bit3', 'Contact bit 2 or bit 3 is set depending on side.'),
      ],
      globalRamRefs: ['_RAM_D0F2_', '_RAM_D01A_'],
      evidence: [
        'ASM lines 4490-4520 compute the coordinate-A edge from IX+3/4, IX+20, IX+22, velocity A sign, and facing fallback.',
        'ASM lines 4521-4559 probe the collision buffer and set IX+27 bit 2 or bit 3 on blocking tiles.',
      ],
    }),
  helper(0x018DC, '_LABEL_18DC_', 'coordinate_b_stop_response', 'collision_response',
    'If coordinate-B contact bits are set, snaps coordinate B through _LABEL_1927_ and clears velocity B.', {
      calls: ['_LABEL_1927_'],
      fieldRefs: [
        field('IX', 10, 'write_clear_word', 'Velocity-B low byte cleared on coordinate-B contact.'),
        field('IX', 11, 'write_clear_word', 'Velocity-B high byte cleared on coordinate-B contact.'),
        field('IX', 27, 'read_bits0_1', 'Only responds when coordinate-B contact bits are set.'),
      ],
      evidence: [
        'ASM lines 4562-4567 test IX+27 bits 0/1, call _LABEL_1927_, and clear IX+10/IX+11.',
      ],
    }),
  helper(0x018EE, '_LABEL_18EE_', 'coordinate_b_bounce_response', 'collision_response',
    'If coordinate-B contact bits are set, snaps coordinate B and either clears or damped-negates velocity B depending on its sign.', {
      calls: ['_LABEL_1927_'],
      fieldRefs: [
        field('IX', 10, 'read_write_clear_or_bounce', 'Velocity-B low byte is cleared or transformed into a damped rebound.'),
        field('IX', 11, 'read_write_clear_or_bounce', 'Velocity-B high/sign byte controls clear-vs-bounce behavior.'),
        field('IX', 27, 'read_bits0_1', 'Only responds when coordinate-B contact bits are set.'),
      ],
      evidence: [
        'ASM lines 4570-4591 call _LABEL_1927_, clear IX+10/IX+11 for one direction, or compute a damped two-complement rebound for the other.',
      ],
    }),
  helper(0x01927, '_LABEL_1927_', 'coordinate_b_tile_snap_helper', 'collision_response',
    'Snaps coordinate B to a 0x10 tile boundary after a coordinate-B contact.', {
      constants: [{ name: 'tile_snap_size', value: '0x10', meaning: 'Coordinate-B snap boundary size.' }],
      fieldRefs: [
        field('IX', 1, 'set_bit1', 'Marks accepted coordinate-B contact.'),
        field('IX', 5, 'write_clear', 'Coordinate-B subpixel/fraction byte cleared.'),
        field('IX', 6, 'read_write_snap', 'Coordinate-B low byte snapped to tile boundary.'),
        field('IX', 27, 'read_bits0_1_via_A', 'Contact side bits select the snap direction.'),
      ],
      globalRamRefs: ['_RAM_D0F0_'],
      evidence: [
        'ASM lines 4594-4619 set IX+1 bit 1, clear IX+5, and either mask IX+6 with 0xF0 or adjust from _RAM_D0F0_.',
      ],
    }),
  helper(0x01951, '_LABEL_1951_', 'coordinate_a_tile_snap_helper', 'collision_response',
    'Snaps coordinate A to a 0x10 tile boundary and clears or reverses velocity A after coordinate-A contact.', {
      constants: [{ name: 'tile_snap_size', value: '0x10', meaning: 'Coordinate-A snap boundary size.' }],
      fieldRefs: [
        field('IX', 1, 'set_bit2_read_bit7', 'Marks coordinate-A contact and uses bit 7 to decide clear vs reverse velocity.'),
        field('IX', 2, 'write_clear', 'Coordinate-A subpixel/fraction byte cleared.'),
        field('IX', 3, 'read_write_snap', 'Coordinate-A low byte snapped to tile boundary.'),
        field('IX', 4, 'read_write_snap', 'Coordinate-A high byte preserved/updated through the snap.'),
        field('IX', 8, 'write_clear_or_negate', 'Velocity-A low byte cleared or two-complement negated.'),
        field('IX', 9, 'write_clear_or_negate', 'Velocity-A high byte cleared or two-complement negated.'),
        field('IX', 27, 'read_bits2_3', 'Only responds when coordinate-A contact bits are set.'),
      ],
      globalRamRefs: ['_RAM_D0F2_'],
      evidence: [
        'ASM lines 4621-4655 test IX+27 bits 2/3, set IX+1 bit 2, clear IX+2, snap IX+3/IX+4 from _RAM_D0F2_, and clear or negate IX+8/IX+9.',
      ],
    }),
  helper(0x01B25, '_LABEL_1B25_', 'packed_coordinate_b_velocity_delta', 'motion_integrator',
    'Decodes a packed signed fractional delta from IX+31 and adds it to velocity B at IX+10/IX+11.', {
      constants: [{ name: 'packed_nibble_rotate_count', value: '4 rrca', meaning: 'The parameter byte is rotated four times to form a signed 16-bit delta.' }],
      fieldRefs: [
        field('IX', 10, 'read_write_add_packed_delta', 'Velocity-B low byte receives the decoded delta.'),
        field('IX', 11, 'read_write_add_packed_delta', 'Velocity-B high byte receives the decoded delta.'),
        field('IX', 31, 'read_packed_delta', 'Packed signed fractional velocity-B delta source.'),
      ],
      evidence: [
        'ASM lines 4884-4907 rotate IX+31 four times, sign-extend bit 3, combine integer/fraction parts, add to IX+10/IX+11, and store the result.',
      ],
    }),
  helper(0x01B4B, '_LABEL_1B4B_', 'packed_coordinate_a_velocity_delta', 'motion_integrator',
    'Decodes a packed signed fractional delta from IX+30 and adds it to velocity A at IX+8/IX+9.', {
      constants: [{ name: 'packed_nibble_rotate_count', value: '4 rrca', meaning: 'The parameter byte is rotated four times to form a signed 16-bit delta.' }],
      fieldRefs: [
        field('IX', 8, 'read_write_add_packed_delta', 'Velocity-A low byte receives the decoded delta.'),
        field('IX', 9, 'read_write_add_packed_delta', 'Velocity-A high byte receives the decoded delta.'),
        field('IX', 30, 'read_packed_delta', 'Packed signed fractional velocity-A delta source.'),
      ],
      evidence: [
        'ASM lines 4909-4932 rotate IX+30 four times, sign-extend bit 3, combine integer/fraction parts, add to IX+8/IX+9, and store the result.',
      ],
    }),
  helper(0x01C98, '_LABEL_1C98_', 'actor_aabb_overlap_test', 'overlap_test',
    'Actor-vs-actor AABB overlap test using coordinate, size, and offset fields from IX and IY.', {
      calls: ['_LABEL_1CFE_'],
      fieldRefs: [
        field('IX', 3, 'read_bounds_coordinate', 'Actor coordinate-A low byte.'),
        field('IX', 4, 'read_bounds_coordinate', 'Actor coordinate-A high byte.'),
        field('IX', 6, 'read_bounds_coordinate', 'Actor coordinate-B low byte.'),
        field('IX', 7, 'read_bounds_coordinate', 'Actor coordinate-B high byte.'),
        field('IX', 20, 'read_bounds_size', 'Actor coordinate-A extent.'),
        field('IX', 21, 'read_bounds_size', 'Actor coordinate-B extent.'),
        field('IX', 22, 'read_signed_bounds_offset', 'Actor coordinate-A signed offset.'),
        field('IX', 23, 'read_signed_bounds_offset', 'Actor coordinate-B signed offset.'),
        field('IY', 3, 'read_bounds_coordinate', 'Other actor coordinate-A low byte.'),
        field('IY', 4, 'read_bounds_coordinate', 'Other actor coordinate-A high byte.'),
        field('IY', 6, 'read_bounds_coordinate', 'Other actor coordinate-B low byte.'),
        field('IY', 7, 'read_bounds_coordinate', 'Other actor coordinate-B high byte.'),
        field('IY', 20, 'read_bounds_size', 'Other actor coordinate-A extent.'),
        field('IY', 21, 'read_bounds_size', 'Other actor coordinate-B extent.'),
        field('IY', 22, 'read_signed_bounds_offset', 'Other actor coordinate-A signed offset.'),
        field('IY', 23, 'read_signed_bounds_offset', 'Other actor coordinate-B signed offset.'),
      ],
      evidence: [
        'ASM lines 5054-5110 compare IX and IY coordinate intervals using +3/+4, +6/+7, +20/+21, and +22/+23 with _LABEL_1CFE_.',
      ],
    }),
  helper(0x01D10, '_LABEL_1D10_', 'actor_extended_hitbox_overlap_test', 'overlap_test',
    'Actor-vs-extended-hitbox overlap test using IX regular bounds and IY+36..39 extended attack/damage bounds.', {
      calls: ['_LABEL_1CFE_'],
      fieldRefs: [
        field('IX', 3, 'read_bounds_coordinate', 'Actor coordinate-A low byte.'),
        field('IX', 4, 'read_bounds_coordinate', 'Actor coordinate-A high byte.'),
        field('IX', 6, 'read_bounds_coordinate', 'Actor coordinate-B low byte.'),
        field('IX', 7, 'read_bounds_coordinate', 'Actor coordinate-B high byte.'),
        field('IX', 20, 'read_bounds_size', 'Actor coordinate-A extent.'),
        field('IX', 21, 'read_bounds_size', 'Actor coordinate-B extent.'),
        field('IX', 22, 'read_signed_bounds_offset', 'Actor coordinate-A signed offset.'),
        field('IX', 23, 'read_signed_bounds_offset', 'Actor coordinate-B signed offset.'),
        field('IY', 36, 'read_extended_bounds_size', 'Other actor extended coordinate-A extent.'),
        field('IY', 37, 'read_extended_bounds_size', 'Other actor extended coordinate-B extent.'),
        field('IY', 38, 'read_signed_extended_bounds_offset', 'Other actor extended coordinate-A signed offset.'),
        field('IY', 39, 'read_signed_extended_bounds_offset', 'Other actor extended coordinate-B signed offset.'),
      ],
      evidence: [
        'ASM lines 5131-5187 mirror _LABEL_1C98_ but use IY+36/IY+37 sizes and IY+38/IY+39 offsets for the extended hitbox.',
      ],
    }),
  helper(0x01D76, '_LABEL_1D76_', 'entity_player_body_contact_handler', 'contact_handler',
    'Tests entity body overlap against the player and marks contact/damage metadata on both structs.', {
      calls: ['_LABEL_1C98_'],
      fieldRefs: [
        field('IX', 0, 'set_contact_bit2', 'Entity contact flag set on overlap.'),
        field('IX', 1, 'write_side_bit3', 'Entity side bit updated from overlap direction.'),
        field('IX', 24, 'read_contact_payload', 'Entity contact/damage metadata copied to player IY+28.'),
        field('IY', 0, 'set_contact_bit2', 'Player contact flag set on overlap.'),
        field('IY', 1, 'write_side_bit3', 'Player side bit updated from overlap direction.'),
        field('IY', 28, 'write_contact_payload', 'Player receives entity IX+24 payload.'),
      ],
      globalRamRefs: ['_RAM_C240_'],
      evidence: [
        'ASM lines 5189-5209 set IY to _RAM_C240_, call _LABEL_1C98_, set IX/IY bit 2, copy IX+24 to IY+28, and update side bits from C bit 0.',
      ],
    }),
  helper(0x01DAB, '_LABEL_1DAB_', 'player_attack_hitbox_contact_handler', 'contact_handler',
    'Tests the player extended attack hitbox against the current entity and writes hit metadata into the entity.', {
      calls: ['_LABEL_1D10_'],
      fieldRefs: [
        field('IX', 0, 'clear_then_set_hit_bit3', 'Entity attack-hit bit cleared at entry and set on overlap.'),
        field('IX', 1, 'write_side_bit3', 'Entity side bit updated from overlap direction.'),
        field('IX', 47, 'write_attack_payload', 'Entity receives player attack stat from _RAM_C258_.'),
        field('IY', 1, 'read_write_player_attack_state', 'Player attack state gates and is cleared on hit.'),
        field('IY', 36, 'read_extended_hitbox_size', 'Player extended hitbox size A.'),
        field('IY', 37, 'read_extended_hitbox_size', 'Player extended hitbox size B.'),
      ],
      globalRamRefs: ['_RAM_C240_', '_RAM_C24F_', '_RAM_C251_', '_RAM_C258_'],
      evidence: [
        'ASM lines 5211-5249 clear IX bit 3, require a live player attack hitbox, call _LABEL_1D10_, set IX bit 3, clear player attack state, write _RAM_C258_ to IX+47, and update side bits.',
      ],
    }),
  helper(0x01E02, '_LABEL_1E02_', 'entity_attack_player_contact_handler', 'contact_handler',
    'Tests the current entity extended attack/contact hitbox against the player and writes contact metadata into the player.', {
      calls: ['_LABEL_1D10_'],
      fieldRefs: [
        field('IX', 0, 'clear_then_set_hit_bit3', 'Entity hit/contact bit cleared at entry and set on overlap.'),
        field('IX', 1, 'write_side_bit3', 'Entity side bit updated from overlap direction.'),
        field('IX', 17, 'read_direction_filter', 'Entity direction can reject same-facing contact.'),
        field('IX', 24, 'read_contact_payload', 'Entity contact/damage metadata copied to player IY+29.'),
        field('IY', 0, 'set_contact_bit3', 'Player contact flag set on overlap.'),
        field('IY', 1, 'read_write_player_attack_state', 'Player state gates and receives side bit update.'),
        field('IY', 29, 'write_contact_payload', 'Player receives entity IX+24 payload.'),
      ],
      globalRamRefs: ['_RAM_C240_', '_RAM_C271_'],
      evidence: [
        'ASM lines 5251-5283 gate contact by player attack state, entity direction, and _RAM_C271_, call _LABEL_1D10_, set IX/IY contact bits, copy IX+24 to IY+29, and update side bits.',
      ],
    }),
  helper(0x01E4E, '_LABEL_1E4E_', 'subentity_collision_contact_handler', 'contact_handler',
    'Tests the current entity against auxiliary player/subentity slots at _RAM_C2C0_ and _RAM_C300_.', {
      calls: ['_LABEL_1C98_'],
      fieldRefs: [
        field('IX', 0, 'set_hit_bit3', 'Entity contact bit set on auxiliary overlap.'),
        field('IX', 1, 'write_side_bit3', 'Entity side bit updated from overlap direction.'),
        field('IX', 47, 'write_contact_payload', 'Entity receives auxiliary slot payload from IY+24.'),
        field('IY', 0, 'read_write_aux_slot_flags', 'Auxiliary slot active/contact flags tested and set.'),
        field('IY', 1, 'write_side_bit3', 'Auxiliary slot side bit updated from overlap direction.'),
        field('IY', 24, 'read_contact_payload', 'Auxiliary contact payload copied to IX+47.'),
      ],
      globalRamRefs: ['_RAM_C2C0_', '_RAM_C300_'],
      evidence: [
        'ASM lines 5285-5318 test _RAM_C2C0_ then _RAM_C300_ active slots, call _LABEL_1C98_, set contact flags, copy IY+24 to IX+47, and update side bits.',
      ],
    }),
  helper(0x01E9F, '_LABEL_1E9F_', 'form1_auxiliary_contact_marker', 'contact_handler',
    'For player form 1, marks contact between the current entity and the _RAM_C300_ auxiliary slot.', {
      calls: ['_LABEL_1C98_'],
      fieldRefs: [
        field('IX', 0, 'set_contact_bit2', 'Entity contact flag set on overlap.'),
        field('IY', 0, 'read_write_aux_slot_flags', 'Auxiliary slot active flag tested and contact flag set.'),
      ],
      globalRamRefs: ['_RAM_C24F_', '_RAM_C300_'],
      evidence: [
        'ASM lines 5320-5331 require _RAM_C24F_=1, test _RAM_C300_ active, call _LABEL_1C98_, and set IX/IY bit 2 on overlap.',
      ],
    }),
  helper(0x01EBB, '_LABEL_1EBB_', 'player_overlap_contact_marker', 'contact_handler',
    'Marks a simple current entity vs player overlap by setting IX bit 2 on contact.', {
      calls: ['_LABEL_1C98_'],
      fieldRefs: [
        field('IX', 0, 'set_contact_bit2', 'Entity contact flag set on overlap.'),
        field('IY', 0, 'read_player_flags', 'Player slot is the overlap target.'),
      ],
      globalRamRefs: ['_RAM_C240_'],
      evidence: [
        'ASM lines 5333-5338 set IY to _RAM_C240_, call _LABEL_1C98_, and set IX bit 2 when carry reports overlap.',
      ],
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

function findCatalog(mapData, id) {
  const found = Object.keys(mapData)
    .filter(key => Array.isArray(mapData[key]) && /catalog/i.test(key))
    .flatMap(key => mapData[key])
    .find(catalog => catalog?.id === id);
  return found || null;
}

function structFieldMap(mapData) {
  const catalog = findCatalog(mapData, structCatalogId);
  const map = new Map();
  for (const item of catalog?.fields || []) {
    map.set(`${item.register}+${item.offset}`, item);
  }
  return map;
}

function enrichFieldRefs(fieldRefs, fieldMap) {
  return fieldRefs.map(ref => {
    const known = fieldMap.get(`${ref.register}+${ref.offset}`);
    return {
      ...ref,
      knownStructRole: known?.role || null,
      knownFieldGroup: known?.fieldGroup || null,
      knownConfidence: known?.confidence || null,
    };
  });
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function buildCatalog(mapData) {
  const fields = structFieldMap(mapData);
  const helpers = HELPERS.map(item => ({
    ...item,
    offset: hex(item.offset),
    region: regionRef(findContainingRegion(mapData, item.offset)),
    fieldRefs: enrichFieldRefs(item.fieldRefs, fields),
  }));
  const fieldTokens = unique(helpers.flatMap(item => item.fieldRefs.map(ref => ref.token))).sort();
  const categoryCounts = {};
  for (const item of helpers) categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: {
      structFields: structCatalogId,
    },
    summary: {
      helperCount: helpers.length,
      categoryCounts,
      uniqueFieldTokenCount: fieldTokens.length,
      ixFieldTokenCount: fieldTokens.filter(token => token.startsWith('IX+')).length,
      iyFieldTokenCount: fieldTokens.filter(token => token.startsWith('IY+')).length,
      globalRamRefCount: unique(helpers.flatMap(item => item.globalRamRefs)).length,
      assetPolicy: 'Metadata only: ASM labels, offsets, helper roles, field offsets, RAM labels, scalar constants, and evidence. No ROM bytes, decoded graphics, music, text, or gameplay asset payloads are embedded.',
    },
    helpers,
    fieldTokens,
    evidence: [
      'ASM labels _LABEL_12D5_/_LABEL_12D8_/_LABEL_12F8_ show signed velocity integration into 24-bit coordinate accumulators.',
      'ASM labels _LABEL_17AB_/_LABEL_17FE_ dispatch the shared actor collision pipelines.',
      'ASM labels _LABEL_181D_/_LABEL_186F_/_LABEL_1927_/_LABEL_1951_ show contact flag, snap, and velocity response semantics.',
      'ASM labels _LABEL_1C98_/_LABEL_1D10_/_LABEL_1D76_/_LABEL_1DAB_/_LABEL_1E02_/_LABEL_1E4E_/_LABEL_1E9F_/_LABEL_1EBB_ show overlap/contact handling against player and auxiliary actor slots.',
    ],
  };
}

function annotateRegion(region, helper) {
  region.analysis = region.analysis || {};
  region.analysis.entityMotionCollisionHelperAudit = {
    catalogId,
    kind: helper.role,
    category: helper.category,
    confidence: helper.confidence,
    label: helper.label,
    calls: helper.calls,
    fieldRefs: helper.fieldRefs,
    globalRamRefs: helper.globalRamRefs,
    constants: helper.constants,
    frameEffect: helper.frameEffect,
    summary: helper.summary,
    evidence: helper.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
    label: helper.label,
    role: helper.role,
    category: helper.category,
    fieldTokens: unique(helper.fieldRefs.map(ref => ref.token)).sort(),
  };
}

function applyAnnotations(mapData, catalog) {
  const annotated = [];
  const missing = [];
  for (const helper of catalog.helpers) {
    const offset = parseInt(helper.offset, 16);
    const region = findContainingRegion(mapData, offset);
    if (!region) {
      missing.push({ label: helper.label, offset: helper.offset, role: helper.role });
      continue;
    }
    annotated.push(annotateRegion(region, helper));
  }
  return { annotated, missing };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let changes = { annotated: [], missing: [] };

  if (apply) {
    changes = applyAnnotations(mapData, catalog);
    mapData.entityMotionCollisionCatalogs = (mapData.entityMotionCollisionCatalogs || []).filter(item => item.id !== catalogId);
    mapData.entityMotionCollisionCatalogs.push(buildCatalog(mapData));
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'entity_motion_collision_helper_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegions: changes.annotated.length,
        missingRegions: changes.missing.length,
      },
      annotatedRegions: changes.annotated,
      missingRegions: changes.missing,
      nextLeads: [
        'Trace call-site IX bases for _LABEL_17AB_/_LABEL_17FE_ to distinguish C3C0, C600, C740, and bank-2 scene actor collision usage.',
        'Use emulator/frame traces to confirm coordinate-A maps to screen X and coordinate-B maps to screen Y across player and entity slots.',
        'Model the collision buffer producer that fills _RAM_CB00_ so tile collision values can be connected to room/screen data.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: changes.annotated.length,
      missingRegions: changes.missing.length,
    },
    missingRegions: changes.missing,
  }, null, 2));
}

main();
