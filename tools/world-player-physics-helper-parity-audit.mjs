#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const readinessCatalogId = 'world-player-physics-engine-readiness-catalog-2026-06-26';
const helperModuleCatalogId = 'world-player-physics-pure-helper-module-catalog-2026-06-26';
const catalogId = 'world-player-physics-helper-parity-catalog-2026-06-26';
const reportId = 'player-physics-helper-parity-audit-2026-06-26';
const toolName = 'tools/world-player-physics-helper-parity-audit.mjs';
const schemaVersion = 1;

const playerPhysicsModule = 'shared/wb3/player-physics.js';
const collisionModule = 'shared/wb3/collision.js';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    if (!key) return counts;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function expectedMatches(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([key, value]) => expectedMatches(actual[key], value));
  }
  return actual === expected;
}

function serializableActual(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && actual && typeof actual === 'object') {
    return Object.fromEntries(Object.keys(expected).map(key => [key, actual[key]]));
  }
  return actual;
}

function buildVectors(player, collision) {
  const buffer = new Uint8Array(0x80);
  buffer[0x63] = 0x0f;
  return [
    {
      id: 'signed_s16_negative_one',
      moduleTarget: playerPhysicsModule,
      functionName: 's16',
      sourceEffectLabels: ['_LABEL_1A28_', '_LABEL_1A36_'],
      scenario: 'signed word helper preserves negative one',
      inputClass: 'synthetic_word_edge',
      expected: -1,
      run: () => player.s16(0xffff),
    },
    {
      id: 'unsigned_u16_negative_clamp_word',
      moduleTarget: playerPhysicsModule,
      functionName: 'u16',
      sourceEffectLabels: ['_LABEL_19B6_'],
      scenario: 'unsigned word helper wraps negative clamp value',
      inputClass: 'synthetic_word_edge',
      expected: 0xfd00,
      run: () => player.u16(-0x300),
    },
    {
      id: 'signed_s8_minimum',
      moduleTarget: playerPhysicsModule,
      functionName: 's8',
      sourceEffectLabels: ['_LABEL_1A28_', '_LABEL_1A36_'],
      scenario: 'signed byte helper maps 0x80 to -128',
      inputClass: 'synthetic_byte_edge',
      expected: -128,
      run: () => player.s8(0x80),
    },
    {
      id: 'word_little_endian_pair',
      moduleTarget: playerPhysicsModule,
      functionName: 'word',
      sourceEffectLabels: ['_LABEL_19B6_'],
      scenario: 'little-endian byte pair forms a word',
      inputClass: 'synthetic_byte_pair',
      expected: 0x1234,
      run: () => player.word(0x34, 0x12),
    },
    {
      id: 'motion_accel_form_full_limit',
      moduleTarget: playerPhysicsModule,
      functionName: 'motionAccelClampLimit',
      sourceEffectLabels: ['_LABEL_1A28_', '_LABEL_1A36_'],
      scenario: 'forms 1 and 3 use the full signed motion clamp',
      inputClass: 'synthetic_form_state',
      expected: 0x0400,
      run: () => player.motionAccelClampLimit({ playerForm: 0x03, stateFlags: 0x60 }),
    },
    {
      id: 'motion_accel_state_half_limit',
      moduleTarget: playerPhysicsModule,
      functionName: 'motionAccelClampLimit',
      sourceEffectLabels: ['_LABEL_1A28_', '_LABEL_1A36_'],
      scenario: 'state flag bits 5/6 reduce the signed motion clamp for other forms',
      inputClass: 'synthetic_form_state',
      expected: 0x0300,
      run: () => player.motionAccelClampLimit({ playerForm: 0x02, stateFlags: 0x20 }),
    },
    {
      id: 'signed_accel_positive_clamp',
      moduleTarget: playerPhysicsModule,
      functionName: 'applySignedByteAcceleration',
      sourceEffectLabels: ['_LABEL_1A28_', '_LABEL_1A36_'],
      scenario: 'positive byte acceleration clamps at +0x0400',
      inputClass: 'synthetic_motion_word',
      expected: 0x0400,
      run: () => player.applySignedByteAcceleration(0x03f8, 0x20, { playerForm: 0x01, stateFlags: 0 }),
    },
    {
      id: 'signed_accel_negative_reduced_clamp',
      moduleTarget: playerPhysicsModule,
      functionName: 'applySignedByteAcceleration',
      sourceEffectLabels: ['_LABEL_1A28_', '_LABEL_1A36_'],
      scenario: 'reduced-clamp negative acceleration saturates at -0x0300',
      inputClass: 'synthetic_motion_word',
      expected: 0xfd00,
      run: () => player.applySignedByteAcceleration(0xfd10, 0x80, { playerForm: 0x02, stateFlags: 0x60 }),
    },
    {
      id: 'coordinate_b_accel_wrapper',
      moduleTarget: playerPhysicsModule,
      functionName: 'applyCoordinateBMotionAccel',
      sourceEffectLabels: ['_LABEL_1A28_'],
      scenario: 'coordinate-B wrapper updates motionB only',
      inputClass: 'synthetic_motion_state',
      expected: { motionB: 0x0010 },
      run: () => player.applyCoordinateBMotionAccel({ motionB: 0x0000, accelB: 0x10, playerForm: 0x01, stateFlags: 0 }),
    },
    {
      id: 'coordinate_a_accel_wrapper_negative',
      moduleTarget: playerPhysicsModule,
      functionName: 'applyCoordinateAMotionAccel',
      sourceEffectLabels: ['_LABEL_1A36_'],
      scenario: 'coordinate-A wrapper applies signed negative byte acceleration',
      inputClass: 'synthetic_motion_state',
      expected: { motionA: 0xfff0 },
      run: () => player.applyCoordinateAMotionAccel({ motionA: 0x0000, accelA: 0xf0, playerForm: 0x01, stateFlags: 0 }),
    },
    {
      id: 'coordinate_a_damping_form3_inner8',
      moduleTarget: playerPhysicsModule,
      functionName: 'coordinateADampingStep',
      sourceEffectLabels: ['_LABEL_1AB6_'],
      scenario: 'form 3 inner state 8 uses the smaller flagged damping step',
      inputClass: 'synthetic_form_state',
      expected: 0x50,
      run: () => player.coordinateADampingStep({ stateFlags: 0x60, playerForm: 0x03, innerState: 0x08 }),
    },
    {
      id: 'coordinate_a_damping_motion_flag_step',
      moduleTarget: playerPhysicsModule,
      functionName: 'coordinateADampingStep',
      sourceEffectLabels: ['_LABEL_1AB6_'],
      scenario: 'motion flag bit 4 selects the small unflagged damping step',
      inputClass: 'synthetic_flag_state',
      expected: 0x30,
      run: () => player.coordinateADampingStep({ stateFlags: 0, motionFlags: 0x10 }),
    },
    {
      id: 'coordinate_a_damp_positive_to_residual',
      moduleTarget: playerPhysicsModule,
      functionName: 'dampCoordinateAMotion',
      sourceEffectLabels: ['_LABEL_1AB6_'],
      scenario: 'positive coordinate-A motion damps toward zero by selected step',
      inputClass: 'synthetic_motion_word',
      expected: 0x0010,
      run: () => player.dampCoordinateAMotion(0x0040, { stateFlags: 0, motionFlags: 0x10 }),
    },
    {
      id: 'coordinate_a_damp_negative_to_zero',
      moduleTarget: playerPhysicsModule,
      functionName: 'dampCoordinateAMotion',
      sourceEffectLabels: ['_LABEL_1AB6_'],
      scenario: 'negative coordinate-A motion does not cross below zero',
      inputClass: 'synthetic_motion_word',
      expected: 0x0000,
      run: () => player.dampCoordinateAMotion(0xffd0, { stateFlags: 0, motionFlags: 0x10 }),
    },
    {
      id: 'coordinate_b_damp_positive_to_zero',
      moduleTarget: playerPhysicsModule,
      functionName: 'dampCoordinateBMotion',
      sourceEffectLabels: ['_LABEL_1AFF_'],
      scenario: 'coordinate-B damping step clamps small positive values to zero',
      inputClass: 'synthetic_motion_word',
      expected: 0x0000,
      run: () => player.dampCoordinateBMotion(0x0040),
    },
    {
      id: 'coordinate_b_damp_positive_residual',
      moduleTarget: playerPhysicsModule,
      functionName: 'dampCoordinateBMotion',
      sourceEffectLabels: ['_LABEL_1AFF_'],
      scenario: 'coordinate-B damping leaves a positive residual when value exceeds the step',
      inputClass: 'synthetic_motion_word',
      expected: 0x00a0,
      run: () => player.dampCoordinateBMotion(0x0100),
    },
    {
      id: 'packed_delta_positive',
      moduleTarget: playerPhysicsModule,
      functionName: 'packedNibbleMotionDelta',
      sourceEffectLabels: ['_LABEL_1B25_', '_LABEL_1B4B_'],
      scenario: 'packed nibble delta preserves a positive high-nibble step',
      inputClass: 'synthetic_packed_motion_byte',
      expected: 0x0120,
      run: () => player.packedNibbleMotionDelta(0x12),
    },
    {
      id: 'packed_delta_negative',
      moduleTarget: playerPhysicsModule,
      functionName: 'packedNibbleMotionDelta',
      sourceEffectLabels: ['_LABEL_1B25_', '_LABEL_1B4B_'],
      scenario: 'packed nibble delta sign-extends a negative high-nibble step',
      inputClass: 'synthetic_packed_motion_byte',
      expected: 0xff20,
      run: () => player.packedNibbleMotionDelta(0xf2),
    },
    {
      id: 'packed_delta_min_negative',
      moduleTarget: playerPhysicsModule,
      functionName: 'packedNibbleMotionDelta',
      sourceEffectLabels: ['_LABEL_1B25_', '_LABEL_1B4B_'],
      scenario: 'packed nibble delta handles the minimum signed nibble',
      inputClass: 'synthetic_packed_motion_byte',
      expected: 0xf800,
      run: () => player.packedNibbleMotionDelta(0x80),
    },
    {
      id: 'packed_integrate_wraps_signed_delta',
      moduleTarget: playerPhysicsModule,
      functionName: 'integratePackedMotion',
      sourceEffectLabels: ['_LABEL_1B25_', '_LABEL_1B4B_'],
      scenario: 'packed integrator wraps the signed delta into a 16-bit motion word',
      inputClass: 'synthetic_motion_word',
      expected: 0x0020,
      run: () => player.integratePackedMotion(0x0100, 0xf2),
    },
    {
      id: 'coordinate_b_packed_integrator_wrapper',
      moduleTarget: playerPhysicsModule,
      functionName: 'applyPackedCoordinateBIntegrator',
      sourceEffectLabels: ['_LABEL_1B25_'],
      scenario: 'coordinate-B packed integrator wrapper updates motionB',
      inputClass: 'synthetic_motion_state',
      expected: { motionB: 0x0020 },
      run: () => player.applyPackedCoordinateBIntegrator({ motionB: 0x0100, packedAccelB: 0xf2 }),
    },
    {
      id: 'coordinate_a_packed_integrator_wrapper',
      moduleTarget: playerPhysicsModule,
      functionName: 'applyPackedCoordinateAIntegrator',
      sourceEffectLabels: ['_LABEL_1B4B_'],
      scenario: 'coordinate-A packed integrator wrapper updates motionA',
      inputClass: 'synthetic_motion_state',
      expected: { motionA: 0x0020 },
      run: () => player.applyPackedCoordinateAIntegrator({ motionA: 0x0100, packedAccelA: 0xf2 }),
    },
    {
      id: 'gravity_default_step',
      moduleTarget: playerPhysicsModule,
      functionName: 'coordinateBGravityStep',
      sourceEffectLabels: ['_LABEL_19B6_'],
      scenario: 'default coordinate-B gravity step uses the high clamp',
      inputClass: 'synthetic_form_state',
      expected: { delta: 0x0100, positiveClampHighByte: 0x08 },
      run: () => player.coordinateBGravityStep({ motionFlags: 0, playerForm: 0, innerState: 0 }),
    },
    {
      id: 'gravity_motion_flag_step',
      moduleTarget: playerPhysicsModule,
      functionName: 'coordinateBGravityStep',
      sourceEffectLabels: ['_LABEL_19B6_'],
      scenario: 'motion flag bits 5/6 select the smaller gravity step',
      inputClass: 'synthetic_flag_state',
      expected: { delta: 0x0040, positiveClampHighByte: 0x03 },
      run: () => player.coordinateBGravityStep({ motionFlags: 0x60, playerForm: 0, innerState: 0 }),
    },
    {
      id: 'gravity_form5_inner8_step',
      moduleTarget: playerPhysicsModule,
      functionName: 'coordinateBGravityStep',
      sourceEffectLabels: ['_LABEL_19B6_'],
      scenario: 'form 5 inner state 8 selects the smallest gravity step',
      inputClass: 'synthetic_form_state',
      expected: { delta: 0x0020, positiveClampHighByte: 0x03 },
      run: () => player.coordinateBGravityStep({ motionFlags: 0, playerForm: 0x05, innerState: 0x08 }),
    },
    {
      id: 'coordinate_b_velocity_positive_clamp',
      moduleTarget: playerPhysicsModule,
      functionName: 'applyCoordinateBVelocityAccelClamp',
      sourceEffectLabels: ['_LABEL_19B6_'],
      scenario: 'positive coordinate-B velocity clamps at the default high byte',
      inputClass: 'synthetic_motion_state',
      expected: { motionB: 0x0800, specialAccelerationEvent: false },
      run: () => player.applyCoordinateBVelocityAccelClamp({
        motionB: 0x0780,
        motionBFlags: 0,
        motionFlags: 0,
        playerForm: 0,
        innerState: 0,
      }),
    },
    {
      id: 'coordinate_b_velocity_special_negative_accel',
      moduleTarget: playerPhysicsModule,
      functionName: 'applyCoordinateBVelocityAccelClamp',
      sourceEffectLabels: ['_LABEL_19B6_'],
      scenario: 'special negative acceleration doubles upward speed before gravity step',
      inputClass: 'synthetic_motion_state',
      expected: { motionB: 0xff00, specialAccelerationEvent: true },
      run: () => player.applyCoordinateBVelocityAccelClamp({
        motionB: 0xff00,
        motionBFlags: 0x60,
        motionFlags: 0,
        playerForm: 0,
        innerState: 0,
      }),
    },
    {
      id: 'coordinate_b_velocity_special_negative_floor',
      moduleTarget: playerPhysicsModule,
      functionName: 'applyCoordinateBVelocityAccelClamp',
      sourceEffectLabels: ['_LABEL_19B6_'],
      scenario: 'special negative acceleration floors extreme upward speed before gravity step',
      inputClass: 'synthetic_motion_state',
      expected: { motionB: 0xf500, specialAccelerationEvent: true },
      run: () => player.applyCoordinateBVelocityAccelClamp({
        motionB: 0xf000,
        motionBFlags: 0x60,
        motionFlags: 0,
        playerForm: 0,
        innerState: 0,
      }),
    },
    {
      id: 'coordinate_b_velocity_reduced_positive_clamp',
      moduleTarget: playerPhysicsModule,
      functionName: 'applyCoordinateBVelocityAccelClamp',
      sourceEffectLabels: ['_LABEL_19B6_'],
      scenario: 'reduced gravity path clamps positive coordinate-B velocity at 0x0300',
      inputClass: 'synthetic_motion_state',
      expected: { motionB: 0x0300, specialAccelerationEvent: false },
      run: () => player.applyCoordinateBVelocityAccelClamp({
        motionB: 0x02f0,
        motionBFlags: 0,
        motionFlags: 0x60,
        playerForm: 0,
        innerState: 0,
      }),
    },
    {
      id: 'collision_index_origin_tile',
      moduleTarget: collisionModule,
      functionName: 'collisionBufferIndex',
      sourceEffectLabels: ['_LABEL_141F_'],
      scenario: 'collision buffer origin probe resolves to the first cell',
      inputClass: 'synthetic_collision_coordinate',
      expected: 0x0000,
      run: () => collision.collisionBufferIndex(0x0000, 0x0010),
    },
    {
      id: 'collision_index_offset_tile',
      moduleTarget: collisionModule,
      functionName: 'collisionBufferIndex',
      sourceEffectLabels: ['_LABEL_141F_'],
      scenario: 'collision buffer row stride and coordinate-A high nibble match ASM formula',
      inputClass: 'synthetic_collision_coordinate',
      expected: 0x0063,
      run: () => collision.collisionBufferIndex(0x0030, 0x0020),
    },
    {
      id: 'collision_lookup_present_tile',
      moduleTarget: collisionModule,
      functionName: 'lookupCollisionTile',
      sourceEffectLabels: ['_LABEL_141F_'],
      scenario: 'collision lookup returns the caller-provided buffer value',
      inputClass: 'synthetic_collision_buffer',
      expected: 0x0f,
      run: () => collision.lookupCollisionTile(buffer, 0x0030, 0x0020),
    },
    {
      id: 'collision_lookup_missing_tile_defaults_zero',
      moduleTarget: collisionModule,
      functionName: 'lookupCollisionTile',
      sourceEffectLabels: ['_LABEL_141F_'],
      scenario: 'collision lookup outside caller buffer defaults to zero',
      inputClass: 'synthetic_collision_buffer',
      expected: 0x00,
      run: () => collision.lookupCollisionTile(new Uint8Array(1), 0x0030, 0x0020),
    },
  ];
}

async function exportedNames(modulePath) {
  const module = await import(pathToFileURL(path.join(repoRoot, modulePath)).href);
  return Object.keys(module).sort();
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || '',
    name: region.name || '',
  };
}

function extractedRegionByLabel(helperCatalog, mapData) {
  const out = new Map();
  for (const effect of helperCatalog.extractedEffects || []) {
    const region = effect.region?.id
      ? (mapData.regions || []).find(item => item.id === effect.region.id)
      : null;
    if (effect.label) out.set(effect.label, compactRegion(region || effect.region));
  }
  return out;
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

async function buildCatalog(mapData) {
  const readinessCatalog = requireCatalog(mapData, readinessCatalogId);
  const helperCatalog = requireCatalog(mapData, helperModuleCatalogId);
  const player = await import(pathToFileURL(path.join(repoRoot, playerPhysicsModule)).href);
  const collision = await import(pathToFileURL(path.join(repoRoot, collisionModule)).href);
  const exportsByModule = {
    [playerPhysicsModule]: await exportedNames(playerPhysicsModule),
    [collisionModule]: await exportedNames(collisionModule),
  };
  const sourceRegions = extractedRegionByLabel(helperCatalog, mapData);
  const extractedLabels = new Set((helperCatalog.extractedEffects || []).map(effect => effect.label).filter(Boolean));

  const vectorResults = buildVectors(player, collision).map(vector => {
    const actual = vector.run();
    const passed = expectedMatches(actual, vector.expected);
    return {
      id: vector.id,
      moduleTarget: vector.moduleTarget,
      functionName: vector.functionName,
      sourceEffectLabels: vector.sourceEffectLabels,
      sourceRegionIds: uniqueSorted(vector.sourceEffectLabels.map(label => sourceRegions.get(label)?.id)),
      scenario: vector.scenario,
      inputClass: vector.inputClass,
      expected: vector.expected,
      status: passed ? 'passed' : 'failed',
      actualOnFailure: passed ? undefined : serializableActual(actual, vector.expected),
      evidence: [
        `${helperModuleCatalogId} extracts ${vector.sourceEffectLabels.join('/')} into ${vector.moduleTarget}.${vector.functionName}.`,
        'Synthetic parity vector; no ROM bytes, decoded assets, instruction bytes, or table payloads are used.',
      ],
    };
  }).map(result => Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined)));

  const failed = vectorResults.filter(result => result.status !== 'passed');
  const coveredExtractedEffectLabels = uniqueSorted(vectorResults.flatMap(result => result.sourceEffectLabels)
    .filter(label => extractedLabels.has(label)));
  const functionNames = uniqueSorted(vectorResults.map(result => result.functionName));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [readinessCatalogId, helperModuleCatalogId],
    sourceFiles: [
      playerPhysicsModule,
      collisionModule,
      'tools/world-player-physics-helper-smoke.mjs',
    ],
    assetPolicy: 'Metadata and synthetic parity vectors only. No ROM bytes, decoded graphics, music, sound samples, table payloads, hashes, screenshots, or instruction bytes are embedded.',
    summary: {
      parityVectorCount: vectorResults.length,
      passingVectorCount: vectorResults.length - failed.length,
      failingVectorCount: failed.length,
      physicsEffectCount: readinessCatalog.summary?.effectCount || 0,
      coveredExtractedEffectCount: coveredExtractedEffectLabels.length,
      extractedReadyPureHelperCount: helperCatalog.summary?.readyPureHelperCoverage?.extractedReadyPureHelperCount || 0,
      readyPureHelperCount: readinessCatalog.summary?.readyPureHelperCount || 0,
      functionCount: functionNames.length,
      moduleCount: Object.keys(exportsByModule).length,
      functionVectorCounts: countBy(vectorResults, result => result.functionName),
      moduleVectorCounts: countBy(vectorResults, result => result.moduleTarget),
      statusCounts: countBy(vectorResults, result => result.status),
      validationIssueCount: failed.length,
      parityReady: failed.length === 0 && coveredExtractedEffectLabels.length === (helperCatalog.summary?.readyPureHelperCoverage?.extractedReadyPureHelperCount || 0),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    modules: Object.entries(exportsByModule).map(([moduleTarget, exports]) => ({
      moduleTarget,
      exports,
      parityVectorCount: vectorResults.filter(result => result.moduleTarget === moduleTarget).length,
      sourceEffectLabels: uniqueSorted(vectorResults
        .filter(result => result.moduleTarget === moduleTarget)
        .flatMap(result => result.sourceEffectLabels)),
    })),
    coveredExtractedEffectLabels,
    vectorResults,
    validation: {
      issueCount: failed.length,
      failingVectorIds: failed.map(result => result.id),
      ready: failed.length === 0,
    },
    evidence: [
      `${readinessCatalogId} marks 8 effects as ready_for_pure_helper_extraction.`,
      `${helperModuleCatalogId} confirms all 8 ready pure helpers are exported from shared/wb3 modules with no missing exports.`,
      'This audit executes synthetic boundary vectors against those exports to guard helper parity before larger player-state engine work.',
    ],
    nextLeads: [
      'Use this parity catalog as the gate before adding composed collision response helpers that still need axis traces.',
      'Frame-trace _LABEL_1446_ in representative rooms before replacing the full player collision pipeline.',
      'Extend helper parity vectors when _LABEL_1C98_/_LABEL_1D10_ contact handlers are split into player attack, damage, and item-collection modules.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const byLabel = new Map();
  for (const vector of catalog.vectorResults || []) {
    for (const label of vector.sourceEffectLabels || []) {
      const current = byLabel.get(label) || {
        vectorIds: new Set(),
        functionNames: new Set(),
        moduleTargets: new Set(),
        statusCounts: {},
      };
      current.vectorIds.add(vector.id);
      current.functionNames.add(vector.functionName);
      current.moduleTargets.add(vector.moduleTarget);
      current.statusCounts[vector.status] = (current.statusCounts[vector.status] || 0) + 1;
      byLabel.set(label, current);
    }
  }
  const changedRegions = [];
  const missingRegions = [];
  for (const effect of catalog.coveredExtractedEffectLabels || []) {
    const region = (mapData.regions || []).find(item => {
      const analysis = item.analysis || {};
      return analysis.playerPhysicsPureHelperModuleAudit?.label === effect
        || analysis.playerPhysicsEngineReadinessAudit?.label === effect
        || analysis.playerPhysicsStateEffectAudit?.label === effect
        || item.name?.includes(effect);
    });
    const detail = byLabel.get(effect);
    if (!region || !detail) {
      missingRegions.push({ label: effect, role: 'player_physics_helper_parity_source' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerPhysicsHelperParityAudit = {
        catalogId,
        kind: 'player_physics_helper_parity',
        label: effect,
        parityStatus: (detail.statusCounts.failed || 0) ? 'failed' : 'passed',
        vectorIds: uniqueSorted([...detail.vectorIds]),
        functionNames: uniqueSorted([...detail.functionNames]),
        moduleTargets: uniqueSorted([...detail.moduleTargets]),
        statusCounts: detail.statusCounts,
        generatedAt: now,
        tool: toolName,
        evidence: [
          `${catalogId} executes synthetic helper parity vectors for ${effect}.`,
          `${helperModuleCatalogId} links this ASM label to the exported helper module surface.`,
        ],
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      label: effect,
      parityStatus: (detail.statusCounts.failed || 0) ? 'failed' : 'passed',
      vectorCount: detail.vectorIds.size,
      functionNames: uniqueSorted([...detail.functionNames]),
    });
  }
  return { changedRegions, missingRegions };
}

function applyStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return null;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.playerPhysicsEngineReadinessCatalog = readinessCatalogId;
  staticMap.summary.playerPhysicsEngineReadinessEffects = catalog.summary.physicsEffectCount;
  staticMap.summary.playerPhysicsEngineReadinessReadyPureHelpers = catalog.summary.readyPureHelperCount;
  staticMap.summary.playerPhysicsPureHelperModuleCatalog = helperModuleCatalogId;
  staticMap.summary.playerPhysicsPureHelperExtractedEffects = catalog.summary.extractedReadyPureHelperCount;
  staticMap.summary.playerPhysicsHelperParityCatalog = catalogId;
  staticMap.summary.playerPhysicsHelperParityVectors = catalog.summary.parityVectorCount;
  staticMap.summary.playerPhysicsHelperParityPassingVectors = catalog.summary.passingVectorCount;
  staticMap.summary.playerPhysicsHelperParityFailingVectors = catalog.summary.failingVectorCount;
  staticMap.summary.playerPhysicsHelperParityCoveredEffects = catalog.summary.coveredExtractedEffectCount;
  staticMap.summary.playerPhysicsHelperParityFunctions = catalog.summary.functionCount;
  staticMap.summary.playerPhysicsHelperParityReady = catalog.summary.parityReady;

  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  const gameplay = insertAfter(staticMap.primaryCatalogs.gameplay, 'world-player-physics-routine-catalog-2026-06-25', readinessCatalogId);
  const withHelper = insertAfter(gameplay, readinessCatalogId, helperModuleCatalogId);
  staticMap.primaryCatalogs.gameplay = insertAfter(withHelper, helperModuleCatalogId, catalogId);
  const coverage = insertAfter(staticMap.primaryCatalogs.coverage, 'world-runtime-mechanic-index-catalog-2026-06-26', readinessCatalogId);
  const coverageWithHelper = insertAfter(coverage, readinessCatalogId, helperModuleCatalogId);
  staticMap.primaryCatalogs.coverage = insertAfter(coverageWithHelper, helperModuleCatalogId, catalogId);

  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  const note = 'Use world-player-physics-helper-parity-catalog-2026-06-26 as the parity gate for extracted player motion/collision pure helpers before porting composed collision or state handlers.';
  const anchor = staticMap.nextLeads.findIndex(noteText => noteText.includes(helperModuleCatalogId));
  if (anchor === -1) staticMap.nextLeads.push(note);
  else staticMap.nextLeads.splice(anchor + 1, 0, note);

  writeJson(staticMapPath, staticMap);
  return {
    staticMapPath: path.relative(repoRoot, staticMapPath),
    summaryFieldsUpdated: [
      'playerPhysicsEngineReadinessCatalog',
      'playerPhysicsEngineReadinessEffects',
      'playerPhysicsEngineReadinessReadyPureHelpers',
      'playerPhysicsPureHelperModuleCatalog',
      'playerPhysicsPureHelperExtractedEffects',
      'playerPhysicsHelperParityCatalog',
      'playerPhysicsHelperParityVectors',
      'playerPhysicsHelperParityPassingVectors',
      'playerPhysicsHelperParityFailingVectors',
      'playerPhysicsHelperParityCoveredEffects',
      'playerPhysicsHelperParityFunctions',
      'playerPhysicsHelperParityReady',
    ],
    primaryCatalogBucketsUpdated: ['gameplay', 'coverage'],
  };
}

async function main() {
  const mapData = readJson(mapPath);
  const catalog = await buildCatalog(mapData);
  const annotations = annotateMap(mapData, catalog);
  let staticMapUpdate = null;
  if (apply) {
    mapData.engineModuleCatalogs = (mapData.engineModuleCatalogs || []).filter(item => item.id !== catalogId);
    mapData.engineModuleCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_physics_helper_parity_audit',
      generatedAt: now,
      schemaVersion,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      sourceFiles: catalog.sourceFiles,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotations.changedRegions.length,
        missingRegions: annotations.missingRegions.length,
      },
      changedRegions: annotations.changedRegions,
      missingRegions: annotations.missingRegions,
      validation: catalog.validation,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      assetPolicy: catalog.assetPolicy,
    });
    writeJson(mapPath, mapData);
    staticMapUpdate = applyStaticMap(catalog);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    validation: catalog.validation,
    changedRegions: annotations.changedRegions,
    missingRegions: annotations.missingRegions,
    staticMapUpdate,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
