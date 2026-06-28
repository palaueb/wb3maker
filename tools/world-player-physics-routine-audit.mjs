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
const catalogId = 'world-player-physics-routine-catalog-2026-06-25';
const reportId = 'player-physics-routine-audit-2026-06-25';
const toolName = 'tools/world-player-physics-routine-audit.mjs';

const ROUTINES = [
  {
    offset: 0x0141F,
    label: '_LABEL_141F_',
    role: 'collision_tile_lookup_cb00',
    name: '_LABEL_141F_ collision tile lookup',
    summary: 'Converts a coordinate pair in HL/DE into an index in the decompressed collision/tile buffer at _RAM_CB00_ and returns the tile value in A.',
    calls: [],
    ramRefs: ['_RAM_CB00_'],
    evidence: ['_LABEL_141F_ subtracts $10 from E, masks to a tile row, shifts HL right four times for the column, adds _RAM_CB00_, and loads A from the computed address.'],
  },
  {
    offset: 0x01446,
    label: '_LABEL_1446_',
    role: 'player_collision_sweep_dispatch',
    name: '_LABEL_1446_ player collision sweep dispatcher',
    summary: 'Clears per-frame contact flags, integrates movement helpers, probes collision tiles, and dispatches to coordinate response helpers that set IX+27 contact bits.',
    calls: ['_LABEL_12D8_', '_LABEL_12F8_', '_LABEL_1551_', '_LABEL_16E2_'],
    ramRefs: ['_RAM_D01B_', '_RAM_CF8B_', '_RAM_C243_', '_RAM_C246_', '_RAM_D0EE_', '_RAM_D0F2_', '_RAM_D01A_'],
    evidence: ['_LABEL_1446_ clears _RAM_D01B_ and IX+27, masks IX+1, probes _RAM_CF8B_, and calls _LABEL_1551_ or _LABEL_16E2_ after tile checks.'],
  },
  {
    offset: 0x01551,
    label: '_LABEL_1551_',
    role: 'coordinate_b_collision_response',
    name: '_LABEL_1551_ coordinate-B collision response',
    summary: 'Sweeps tile probes across the actor extent, sets lower contact bits in IX+27, aligns _RAM_C246_ to a tile boundary, and clears the _RAM_C24A_ motion word on contact.',
    calls: ['_LABEL_141F_', '_LABEL_16D0_', '_LABEL_1797_'],
    ramRefs: ['_RAM_C243_', '_RAM_C246_', '_RAM_C24A_', '_RAM_D0EE_', '_RAM_D0F0_', '_RAM_D0DF_', '_RAM_D0E1_', '_RAM_D01A_', '_RAM_D01B_'],
    evidence: ['_LABEL_1551_ repeatedly calls _LABEL_141F_, treats tile values below $10 as contact, sets IX+27 bit 0 or 1, snaps _RAM_C246_, and zeroes _RAM_C24A_.'],
  },
  {
    offset: 0x0166C,
    label: '_LABEL_166C_',
    role: 'coordinate_a_collision_response',
    name: '_LABEL_166C_ coordinate-A collision response',
    summary: 'Handles coordinate-A collision resolution by setting upper contact bits in IX+27, snapping _RAM_C243_ to a tile boundary, and clearing _RAM_C248_.',
    calls: [],
    ramRefs: ['_RAM_C243_', '_RAM_C248_', '_RAM_D0F2_', '_RAM_C24F_'],
    evidence: ['_LABEL_166C_ sets IX+1 bit 2, chooses IX+27 bit 2 or 3 from movement direction, adjusts _RAM_C243_ using _RAM_D0F2_, and zeroes _RAM_C248_.'],
  },
  {
    offset: 0x016D0,
    label: '_LABEL_16D0_',
    role: 'special_collision_tile_capture',
    name: '_LABEL_16D0_ special collision tile capture',
    summary: 'Captures collision probe coordinates when tile value $05 is found, storing them for the later entity/transition effect path.',
    calls: [],
    ramRefs: ['_RAM_D01B_', '_RAM_D01C_', '_RAM_D01E_'],
    evidence: ['_LABEL_16D0_ returns unless A is $05; on match it stores HL to _RAM_D01C_, DE to _RAM_D01E_, and sets _RAM_D01B_ to $01.'],
  },
  {
    offset: 0x016E2,
    label: '_LABEL_16E2_',
    role: 'alternate_collision_sweep_response',
    name: '_LABEL_16E2_ alternate collision sweep response',
    summary: 'Alternate collision response path used when _RAM_CF8B_ is active; clamps coordinate words and sets contact flags without the full tile-sweep path.',
    calls: ['_LABEL_12D5_'],
    ramRefs: ['_RAM_CF8B_', '_RAM_C243_', '_RAM_C246_', '_RAM_C248_', '_RAM_C24A_', '_RAM_C24F_'],
    evidence: ['_LABEL_16E2_ is reached from _LABEL_1446_ when _RAM_CF8B_ is nonzero; it adjusts _RAM_C243_/_RAM_C246_, sets IX+27 contact bits, and clears motion words on bounds contact.'],
  },
  {
    offset: 0x01773,
    label: '_LABEL_1773_',
    role: 'coordinate_b_floor_clamp',
    name: '_LABEL_1773_ coordinate-B floor clamp',
    summary: 'Clamps the second coordinate word to $B0 when descending past the boundary and records a lower contact flag.',
    calls: [],
    ramRefs: ['_RAM_C246_', '_RAM_C24A_', '_RAM_C24B_'],
    evidence: ['_LABEL_1773_ tests _RAM_C24B_ sign, clamps _RAM_C246_ to $B0, sets IX+27 bit 0, and zeroes _RAM_C24A_.'],
  },
  {
    offset: 0x01797,
    label: '_LABEL_1797_',
    role: 'form_specific_collision_tile_patch',
    name: '_LABEL_1797_ form-specific collision tile patch',
    summary: 'For player form 1, writes a collision/tile update at the current probe coordinate through _LABEL_118D_.',
    calls: ['_LABEL_118D_'],
    ramRefs: ['_RAM_C24F_', '_RAM_D0EE_'],
    evidence: ['_LABEL_1797_ returns unless _RAM_C24F_ equals $01, then loads IX+3/4 and _RAM_D0EE_ and calls _LABEL_118D_.'],
  },
  {
    offset: 0x017AB,
    label: '_LABEL_17AB_',
    role: 'actor_collision_full_pipeline',
    name: '_LABEL_17AB_ actor collision full pipeline',
    summary: 'Generic actor collision pipeline that clears flags, runs coordinate probes, applies contact response, and handles coordinate-B post-response.',
    calls: ['_LABEL_12D8_', '_LABEL_186F_', '_LABEL_1951_', '_LABEL_12F8_', '_LABEL_181D_', '_LABEL_18DC_'],
    ramRefs: ['IX+27', 'IX+1'],
    evidence: ['_LABEL_17AB_ clears IX+27 and IX+1 bits, calls _LABEL_186F_/_LABEL_181D_ probes, then _LABEL_1951_ and _LABEL_18DC_ response helpers.'],
  },
  {
    offset: 0x017CA,
    label: '_LABEL_17CA_',
    role: 'actor_collision_horizontal_pipeline',
    name: '_LABEL_17CA_ actor coordinate-A collision pipeline',
    summary: 'Collision pipeline variant that preserves lower contact bits and only runs coordinate-A probe/response work.',
    calls: ['_LABEL_12D8_', '_LABEL_186F_', '_LABEL_1951_'],
    ramRefs: ['IX+27', 'IX+1'],
    evidence: ['_LABEL_17CA_ masks IX+27 to lower bits, clears IX+1 bit 2, then calls _LABEL_186F_ and _LABEL_1951_.'],
  },
  {
    offset: 0x017FE,
    label: '_LABEL_17FE_',
    role: 'actor_collision_bounce_pipeline',
    name: '_LABEL_17FE_ actor collision bounce pipeline',
    summary: 'Full actor collision pipeline variant that applies the damped/reversed coordinate-B response helper.',
    calls: ['_LABEL_12D8_', '_LABEL_186F_', '_LABEL_1951_', '_LABEL_12F8_', '_LABEL_181D_', '_LABEL_18EE_'],
    ramRefs: ['IX+27', 'IX+1'],
    evidence: ['_LABEL_17FE_ mirrors _LABEL_17AB_ but calls _LABEL_18EE_, which damps or clears IX+10/IX+11 after contact.'],
  },
  {
    offset: 0x0181D,
    label: '_LABEL_181D_',
    role: 'coordinate_b_contact_probe',
    name: '_LABEL_181D_ coordinate-B contact probe',
    summary: 'Probes one coordinate-B edge against the collision map and sets IX+27 bit 0 or 1 when a solid tile is hit.',
    calls: ['_LABEL_141F_'],
    ramRefs: ['_RAM_D0F0_', '_RAM_D01A_'],
    evidence: ['_LABEL_181D_ derives a probe point from IX+6/7 and IX+23/21, calls _LABEL_141F_, and sets IX+27 bit 0 or 1 for tile values below $10.'],
  },
  {
    offset: 0x0186F,
    label: '_LABEL_186F_',
    role: 'coordinate_a_contact_probe',
    name: '_LABEL_186F_ coordinate-A contact probe',
    summary: 'Probes one coordinate-A edge against the collision map and sets IX+27 bit 2 or 3 when a solid tile is hit.',
    calls: ['_LABEL_141F_'],
    ramRefs: ['_RAM_D0F2_', '_RAM_D01A_'],
    evidence: ['_LABEL_186F_ derives a probe point from IX+3/4 and IX+22/20, calls _LABEL_141F_, and sets IX+27 bit 2 or 3 for tile values below $10.'],
  },
  {
    offset: 0x018DC,
    label: '_LABEL_18DC_',
    role: 'coordinate_b_contact_stop_response',
    name: '_LABEL_18DC_ coordinate-B stop response',
    summary: 'If lower contact bits are set, snaps coordinate-B through _LABEL_1927_ and clears IX+10/IX+11 velocity.',
    calls: ['_LABEL_1927_'],
    ramRefs: ['IX+10', 'IX+11', 'IX+27'],
    evidence: ['_LABEL_18DC_ checks IX+27 & $03, calls _LABEL_1927_, then stores zero to IX+10 and IX+11.'],
  },
  {
    offset: 0x018EE,
    label: '_LABEL_18EE_',
    role: 'coordinate_b_contact_bounce_response',
    name: '_LABEL_18EE_ coordinate-B bounce response',
    summary: 'If lower contact bits are set, snaps coordinate-B and either damps/reverses IX+10/IX+11 or clears it based on sign.',
    calls: ['_LABEL_1927_'],
    ramRefs: ['IX+10', 'IX+11', 'IX+27'],
    evidence: ['_LABEL_18EE_ checks IX+27 & $03, calls _LABEL_1927_, and for positive IX+10/11 computes a reduced negated value; negative values are cleared.'],
  },
  {
    offset: 0x01927,
    label: '_LABEL_1927_',
    role: 'coordinate_b_tile_snap_helper',
    name: '_LABEL_1927_ coordinate-B tile snap helper',
    summary: 'Sets contact state and snaps IX+6 to the relevant tile boundary after a coordinate-B collision.',
    calls: [],
    ramRefs: ['_RAM_D0F0_', 'IX+1', 'IX+5', 'IX+6'],
    evidence: ['_LABEL_1927_ sets IX+1 bit 1, clears IX+5, and either masks IX+6 to a tile boundary or adjusts it from _RAM_D0F0_.'],
  },
  {
    offset: 0x01951,
    label: '_LABEL_1951_',
    role: 'coordinate_a_tile_snap_helper',
    name: '_LABEL_1951_ coordinate-A tile snap helper',
    summary: 'Snaps IX+3/4 to a tile boundary after a coordinate-A collision and either clears or reverses IX+8/9 velocity.',
    calls: [],
    ramRefs: ['_RAM_D0F2_', 'IX+1', 'IX+2', 'IX+3', 'IX+4', 'IX+8', 'IX+9', 'IX+27'],
    evidence: ['_LABEL_1951_ checks IX+27 & $0C, adjusts IX+3/4 from _RAM_D0F2_, and either clears IX+8/9 or negates it when IX+1 bit 7 is set.'],
  },
  {
    offset: 0x019B6,
    label: '_LABEL_19B6_',
    role: 'coordinate_b_velocity_accel_clamp',
    name: '_LABEL_19B6_ coordinate-B velocity acceleration/clamp',
    summary: 'Applies gravity-like acceleration to IX+10/IX+11 with alternate clamps for state/form flags, and flags special acceleration events in _RAM_D0A4_.',
    calls: [],
    ramRefs: ['_RAM_C24F_', '_RAM_C260_', '_RAM_D0A4_', 'IX+1', 'IX+10', 'IX+11', 'IX+48'],
    evidence: ['_LABEL_19B6_ doubles negative IX+10/11 in selected states, clamps to $F400, then adds $0100/$0040/$0020 and clamps the high byte by state.'],
  },
  {
    offset: 0x01A28,
    label: '_LABEL_1A28_',
    role: 'coordinate_b_motion_accel_wrapper',
    name: '_LABEL_1A28_ coordinate-B motion acceleration wrapper',
    summary: 'Applies the shared signed acceleration/clamp helper to _RAM_C24A_ using IX+31 as the acceleration byte.',
    calls: ['_LABEL_1A36_ shared tail'],
    ramRefs: ['_RAM_C24A_', '_RAM_C24F_', '_RAM_C241_'],
    evidence: ['_LABEL_1A28_ loads _RAM_C24A_, uses IX+31 as E, enters the shared helper, and stores the resulting DE back to _RAM_C24A_.'],
  },
  {
    offset: 0x01A36,
    label: '_LABEL_1A36_',
    role: 'coordinate_a_motion_accel_wrapper',
    name: '_LABEL_1A36_ coordinate-A motion acceleration wrapper',
    summary: 'Applies the shared signed acceleration/clamp helper to _RAM_C248_ using IX+30 as the acceleration byte.',
    calls: [],
    ramRefs: ['_RAM_C248_', '_RAM_C24F_', '_RAM_C241_'],
    evidence: ['_LABEL_1A36_ loads _RAM_C248_, uses IX+30 as E, and clamps the resulting motion word to +/-$0400 or +/-$0300 depending on player/form flags.'],
  },
  {
    offset: 0x01AB6,
    label: '_LABEL_1AB6_',
    role: 'coordinate_a_motion_damping',
    name: '_LABEL_1AB6_ coordinate-A motion damping',
    summary: 'Reduces _RAM_C248_ toward zero using state-dependent step values.',
    calls: [],
    ramRefs: ['_RAM_C248_', '_RAM_C241_', '_RAM_C24F_', '_RAM_C260_'],
    evidence: ['_LABEL_1AB6_ returns if _RAM_C248_ is zero, selects a step of $70/$80/$50/$30 from state flags, and adds/subtracts it toward zero.'],
  },
  {
    offset: 0x01AFF,
    label: '_LABEL_1AFF_',
    role: 'coordinate_b_motion_damping',
    name: '_LABEL_1AFF_ coordinate-B motion damping',
    summary: 'Reduces _RAM_C24A_ toward zero using a fixed $60 step.',
    calls: [],
    ramRefs: ['_RAM_C24A_'],
    evidence: ['_LABEL_1AFF_ returns if _RAM_C24A_ is zero, then adds or subtracts $0060 toward zero based on the sign bit.'],
  },
  {
    offset: 0x01B22,
    label: '_LABEL_1B22_',
    role: 'packed_motion_integrator_both_axes',
    name: '_LABEL_1B22_ packed motion integrator both axes',
    summary: 'Runs both packed acceleration integrators, first for IX+8/9 then for IX+10/11.',
    calls: ['_LABEL_1B4B_', '_LABEL_1B25_'],
    ramRefs: ['IX+8', 'IX+9', 'IX+10', 'IX+11', 'IX+30', 'IX+31'],
    evidence: ['_LABEL_1B22_ calls _LABEL_1B4B_ and falls through into _LABEL_1B25_.'],
  },
  {
    offset: 0x01B25,
    label: '_LABEL_1B25_',
    role: 'packed_motion_integrator_coordinate_b',
    name: '_LABEL_1B25_ packed coordinate-B motion integrator',
    summary: 'Interprets packed nibbles in IX+31 as signed fractional acceleration and adds the decoded value to IX+10/IX+11.',
    calls: [],
    ramRefs: ['IX+10', 'IX+11', 'IX+31'],
    evidence: ['_LABEL_1B25_ rotates IX+31 nibbles, sign-extends bit 3, combines integer/fraction parts, and adds the value to IX+10/IX+11.'],
  },
  {
    offset: 0x01B4B,
    label: '_LABEL_1B4B_',
    role: 'packed_motion_integrator_coordinate_a',
    name: '_LABEL_1B4B_ packed coordinate-A motion integrator',
    summary: 'Interprets packed nibbles in IX+30 as signed fractional acceleration and adds the decoded value to IX+8/IX+9.',
    calls: [],
    ramRefs: ['IX+8', 'IX+9', 'IX+30'],
    evidence: ['_LABEL_1B4B_ rotates IX+30 nibbles, sign-extends bit 3, combines integer/fraction parts, and adds the value to IX+8/IX+9.'],
  },
  {
    offset: 0x01BBA,
    label: '_LABEL_1BBA_',
    role: 'vertical_bounds_then_viewport_check',
    name: '_LABEL_1BBA_ vertical bounds plus viewport check',
    summary: 'Checks an upper coordinate byte before falling into the viewport-range helper.',
    calls: ['_LABEL_1BBF_'],
    ramRefs: ['IX+7'],
    evidence: ['_LABEL_1BBA_ compares IX+7 against zero and falls through to _LABEL_1BBF_ when the bounds test passes.'],
  },
  {
    offset: 0x01BBF,
    label: '_LABEL_1BBF_',
    role: 'viewport_range_check',
    name: '_LABEL_1BBF_ viewport range check',
    summary: 'Checks whether an actor coordinate window is within the camera-relative range based on _RAM_D00F_.',
    calls: [],
    ramRefs: ['_RAM_D00F_', 'IX+3', 'IX+4'],
    evidence: ['_LABEL_1BBF_ compares IX+3/4 plus $10 against _RAM_D00F_, then compares the actor position against _RAM_D00F_+$0110 and returns carry from the range test.'],
  },
  {
    offset: 0x01C98,
    label: '_LABEL_1C98_',
    role: 'actor_aabb_overlap_test',
    name: '_LABEL_1C98_ actor AABB overlap test',
    summary: 'Tests overlap between IX and IY actor rectangles using position, offset, and size fields, returning carry on overlap.',
    calls: ['_LABEL_1CFE_'],
    ramRefs: ['IX+3', 'IX+4', 'IX+6', 'IX+7', 'IX+20', 'IX+21', 'IX+22', 'IX+23', 'IY+3', 'IY+4', 'IY+6', 'IY+7', 'IY+20', 'IY+21', 'IY+22', 'IY+23'],
    evidence: ['_LABEL_1C98_ compares coordinate intervals on two axes via _LABEL_1CFE_, then checks combined IX/IY size fields before returning carry status.'],
  },
  {
    offset: 0x01CFE,
    label: '_LABEL_1CFE_',
    role: 'signed_interval_delta_helper',
    name: '_LABEL_1CFE_ signed interval delta helper',
    summary: 'Computes the signed difference between HL and DE, normalizes negative deltas, and records the sign in B.',
    calls: [],
    ramRefs: [],
    evidence: ['_LABEL_1CFE_ subtracts DE from HL, returns immediately on non-negative result, otherwise two-complements DE and increments B as a sign marker.'],
  },
  {
    offset: 0x01D10,
    label: '_LABEL_1D10_',
    role: 'actor_extended_hitbox_overlap_test',
    name: '_LABEL_1D10_ actor extended-hitbox overlap test',
    summary: 'Tests IX actor bounds against IY extended hitbox fields at offsets 36-39, returning carry on overlap.',
    calls: ['_LABEL_1CFE_'],
    ramRefs: ['IX+20', 'IX+21', 'IX+22', 'IX+23', 'IY+36', 'IY+37', 'IY+38', 'IY+39'],
    evidence: ['_LABEL_1D10_ mirrors _LABEL_1C98_ but uses IY+36/IY+37 dimensions and IY+38/IY+39 offsets for the second rectangle.'],
  },
  {
    offset: 0x01D76,
    label: '_LABEL_1D76_',
    role: 'entity_player_body_contact_handler',
    name: '_LABEL_1D76_ entity/player body contact handler',
    summary: 'Checks entity IX against player IY=_RAM_C240_ using the regular AABB test and propagates contact flags/direction bits on overlap.',
    calls: ['_LABEL_1C98_'],
    ramRefs: ['_RAM_C240_', 'IX+0', 'IX+1', 'IX+24', 'IY+0', 'IY+1', 'IY+28'],
    evidence: ['_LABEL_1D76_ sets IY to _RAM_C240_, calls _LABEL_1C98_, then sets IX/IY contact bits and copies IX+24 into IY+28 when overlap carries.'],
  },
  {
    offset: 0x01DAB,
    label: '_LABEL_1DAB_',
    role: 'player_attack_hitbox_contact_handler',
    name: '_LABEL_1DAB_ player attack hitbox contact handler',
    summary: 'Checks entity IX against the player extended hitbox and records entity hit/direction state when the current form can attack.',
    calls: ['_LABEL_1D10_'],
    ramRefs: ['_RAM_C240_', '_RAM_C24F_', '_RAM_C258_', 'IX+0', 'IX+1', 'IX+47', 'IY+1', 'IY+36', 'IY+37'],
    evidence: ['_LABEL_1DAB_ skips form 1, requires player attack fields IY+36/37, calls _LABEL_1D10_, sets IX+0 bit 3, copies _RAM_C258_ to IX+47, and sets facing bits.'],
  },
  {
    offset: 0x01E02,
    label: '_LABEL_1E02_',
    role: 'entity_attack_player_contact_handler',
    name: '_LABEL_1E02_ entity attack/player contact handler',
    summary: 'Checks an entity extended hitbox against the player and records player damage/contact metadata on overlap.',
    calls: ['_LABEL_1D10_'],
    ramRefs: ['_RAM_C240_', '_RAM_C271_', 'IX+0', 'IX+1', 'IX+17', 'IX+24', 'IY+0', 'IY+1', 'IY+17', 'IY+29', 'IY+36', 'IY+37'],
    evidence: ['_LABEL_1E02_ sets IY to _RAM_C240_, validates player state and direction, calls _LABEL_1D10_, then sets contact bits and copies IX+24 into IY+29.'],
  },
  {
    offset: 0x01E4E,
    label: '_LABEL_1E4E_',
    role: 'subentity_collision_contact_handler',
    name: '_LABEL_1E4E_ subentity collision contact handler',
    summary: 'Checks IX against the two auxiliary entity slots at _RAM_C2C0_ and _RAM_C300_, then records contact flags and damage metadata.',
    calls: ['_LABEL_1C98_'],
    ramRefs: ['_RAM_C2C0_', '_RAM_C300_', 'IX+0', 'IX+1', 'IX+47', 'IY+0', 'IY+1', 'IY+24'],
    evidence: ['_LABEL_1E4E_ tests active auxiliary slots _RAM_C2C0_ and _RAM_C300_ with _LABEL_1C98_, sets IX+0 bit 3 and IY+0 bit 2, and copies IY+24 into IX+47.'],
  },
  {
    offset: 0x01E9F,
    label: '_LABEL_1E9F_',
    role: 'form1_auxiliary_contact_marker',
    name: '_LABEL_1E9F_ form-1 auxiliary contact marker',
    summary: 'For player form 1, checks overlap with auxiliary slot _RAM_C300_ and marks contact on both structs.',
    calls: ['_LABEL_1C98_'],
    ramRefs: ['_RAM_C24F_', '_RAM_C300_', 'IX+0', 'IY+0'],
    evidence: ['_LABEL_1E9F_ returns unless _RAM_C24F_ is $01, sets IY to _RAM_C300_, calls _LABEL_1C98_, then sets bit 2 on IX+0 and IY+0.'],
  },
  {
    offset: 0x01EBB,
    label: '_LABEL_1EBB_',
    role: 'player_overlap_contact_marker',
    name: '_LABEL_1EBB_ player overlap contact marker',
    summary: 'Checks IX against the player body and marks IX contact bit 2 on overlap.',
    calls: ['_LABEL_1C98_'],
    ramRefs: ['_RAM_C240_', 'IX+0'],
    evidence: ['_LABEL_1EBB_ sets IY to _RAM_C240_, calls _LABEL_1C98_, and sets IX+0 bit 2 when carry indicates overlap.'],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(region => {
    const start = parseInt(region.offset, 16);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id,
    name: region.name || '',
    type: region.type || 'unknown',
    offset: region.offset,
    size: region.size || 0,
  };
}

function buildCatalog(mapData) {
  const routines = ROUTINES.map(def => {
    const region = findContainingRegion(mapData, def.offset);
    return {
      id: `${def.label}_${def.role}`,
      label: def.label,
      offset: hex(def.offset),
      role: def.role,
      proposedName: def.name,
      summary: def.summary,
      confidence: 'high',
      region: regionRef(region),
      wasGenericCodeRegion: Boolean(region && !hasNonInferredAnalysisOtherThanSelf(region)),
      calls: def.calls || [],
      ramRefs: def.ramRefs || [],
      evidence: def.evidence,
    };
  });

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    routines,
    summary: {
      routineCount: routines.length,
      missingRegions: routines.filter(routine => !routine.region).length,
      genericCodeRegionsCovered: routines.filter(routine => routine.wasGenericCodeRegion).length,
      assetPolicy: 'Metadata only: ASM labels, offsets, routine roles, calls, RAM/struct references, and evidence. No ROM bytes or gameplay values are embedded.',
    },
  };
}

function hasNonInferredAnalysisOtherThanSelf(region) {
  return Boolean(region && Object.keys(region.analysis || {}).some(key => (
    key !== 'inferred' && key !== 'playerPhysicsRoutineAudit'
  )));
}

function annotateRegion(region, routine) {
  const previousName = region.name || '';
  if (!previousName && routine.proposedName) region.name = routine.proposedName;
  region.analysis = region.analysis || {};
  region.analysis.playerPhysicsRoutineAudit = {
    kind: routine.role,
    label: routine.label,
    summary: routine.summary,
    confidence: routine.confidence,
    catalogId,
    nameBeforeAudit: previousName,
    nameAfterAudit: region.name || '',
    detail: {
      routineOffset: routine.offset,
      regionOffset: region.offset,
      calls: routine.calls,
      ramRefs: routine.ramRefs,
    },
    evidence: routine.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    label: routine.label,
    role: routine.role,
    previousName,
    name: region.name || '',
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const missingRegions = catalog.routines
    .filter(routine => !routine.region)
    .map(routine => ({ label: routine.label, offset: routine.offset, role: routine.role }));
  const annotatedRegions = [];

  if (apply) {
    for (const routine of catalog.routines) {
      if (!routine.region) continue;
      const region = mapData.regions.find(item => item.id === routine.region.id);
      annotatedRegions.push(annotateRegion(region, routine));
    }

    const finalCatalog = buildCatalog(mapData);
    mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(item => item.id !== catalogId);
    mapData.playerCatalogs.push(finalCatalog);

    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_physics_routine_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
      routines: finalCatalog.routines,
      annotatedRegions,
      missingRegions,
      nextLeads: [
        'Frame-trace _LABEL_1446_ with known room coordinates to rename coordinate-A/coordinate-B to screen X/Y with evidence.',
        'Connect IX+20..IX+23 and IY+36..IY+39 struct fields to hitbox dimensions in the player/entity RAM schema.',
        'Use _LABEL_1C98_/_LABEL_1D10_ consumers to classify enemy damage, player attack, auxiliary entity, and item collection interactions by caller.',
      ],
    });

    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: apply ? annotatedRegions : catalog.routines
      .filter(routine => routine.region)
      .map(routine => ({
        id: routine.region.id,
        offset: routine.region.offset,
        label: routine.label,
        role: routine.role,
        currentName: routine.region.name || '',
        proposedName: routine.proposedName,
      })),
    missingRegions,
  }, null, 2));
}

main();
