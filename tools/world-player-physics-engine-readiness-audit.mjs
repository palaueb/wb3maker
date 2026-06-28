#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const physicsEffectCatalogId = 'world-player-physics-state-effect-catalog-2026-06-25';
const physicsFlowCatalogId = 'world-player-state-physics-flow-catalog-2026-06-25';
const catalogId = 'world-player-physics-engine-readiness-catalog-2026-06-26';
const reportId = 'player-physics-engine-readiness-audit-2026-06-26';
const toolName = 'tools/world-player-physics-engine-readiness-audit.mjs';
const schemaVersion = 1;

const moduleTargetsByCategory = {
  collision_tile_lookup: ['shared/wb3/collision.js'],
  player_collision_pipeline: ['shared/wb3/collision.js', 'shared/wb3/player-physics.js'],
  collision_response: ['shared/wb3/collision.js'],
  collision_special_tile: ['shared/wb3/collision.js', 'shared/wb3/room-loader.js'],
  bounds_response: ['shared/wb3/collision.js'],
  motion_acceleration: ['shared/wb3/player-physics.js'],
  motion_damping: ['shared/wb3/player-physics.js'],
  motion_integrator: ['shared/wb3/player-physics.js'],
  overlap_test: ['shared/wb3/collision.js', 'shared/wb3/entities.js'],
  contact_handler: ['shared/wb3/collision.js', 'shared/wb3/entities.js', 'shared/wb3/player-state.js'],
};

const pureHelperCategories = new Set(['collision_tile_lookup', 'motion_acceleration', 'motion_damping', 'motion_integrator']);
const stateMutationCategories = new Set(['collision_response', 'collision_special_tile', 'bounds_response']);
const entitySchemaCategories = new Set(['overlap_test', 'contact_handler']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    if (!key) return counts;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function collectFlowUsage(flowCatalog) {
  const usage = new Map();
  for (const flow of flowCatalog.flows || []) {
    for (const component of flow.components || []) {
      for (const call of component.physicsCalls || []) {
        const current = usage.get(call.label) || {
          label: call.label,
          callCount: 0,
          flowIds: new Set(),
          componentLabels: new Set(),
          stateSlots: new Set(),
          categories: new Set(),
        };
        current.callCount++;
        current.flowIds.add(flow.flowId);
        current.componentLabels.add(component.label);
        current.stateSlots.add(String(flow.stateSlot));
        if (call.category) current.categories.add(call.category);
        usage.set(call.label, current);
      }
    }
  }
  return new Map([...usage.entries()].map(([label, item]) => [label, {
    label,
    callCount: item.callCount,
    flowIds: [...item.flowIds].sort(),
    componentLabels: [...item.componentLabels].sort(),
    stateSlots: [...item.stateSlots].sort((a, b) => Number(a) - Number(b)),
    categories: [...item.categories].sort(),
  }]));
}

function fieldRoles(effect, side) {
  return [...new Set((effect[side] || [])
    .map(access => access.fieldRole || access.catalogFieldRole || access.inferredField || access.address)
    .filter(Boolean))]
    .sort();
}

function readinessForEffect(effect) {
  const calls = effect.calls || [];
  const blockers = [];

  if (effect.category === 'player_collision_pipeline') {
    blockers.push('Needs frame trace through room collision buffer and camera coordinates before direct engine port.');
    blockers.push('Composes multiple collision response helpers, so helper parity should be proven first.');
    return {
      readiness: 'needs_frame_trace_before_engine_port',
      confidence: 'medium',
      blockers,
    };
  }

  if (entitySchemaCategories.has(effect.category)) {
    blockers.push('Entity and player hitbox struct field parity must be traced across representative enemy/object slots.');
    return {
      readiness: calls.length ? 'ready_for_composed_collision_scaffold_needs_entity_trace' : 'ready_for_collision_helper_scaffold_needs_entity_trace',
      confidence: 'medium',
      blockers,
    };
  }

  if (stateMutationCategories.has(effect.category)) {
    blockers.push('Coordinate_a/coordinate_b naming is intentionally unresolved until multi-room frame traces confirm screen orientation.');
    return {
      readiness: calls.length ? 'ready_for_composed_state_mutation_helper_after_axis_trace' : 'ready_for_state_mutation_helper_after_axis_trace',
      confidence: 'high',
      blockers,
    };
  }

  if (pureHelperCategories.has(effect.category) && !calls.length) {
    return {
      readiness: 'ready_for_pure_helper_extraction',
      confidence: 'high',
      blockers,
    };
  }

  if (calls.length) {
    blockers.push('Callee parity should be represented before extracting this composed helper.');
    return {
      readiness: 'ready_for_composed_helper_scaffold',
      confidence: 'medium',
      blockers,
    };
  }

  return {
    readiness: 'mapped_effect_needs_engine_design_review',
    confidence: effect.confidence || 'medium',
    blockers,
  };
}

function buildCatalog(mapData) {
  const effectCatalog = requireCatalog(mapData, physicsEffectCatalogId);
  const flowCatalog = requireCatalog(mapData, physicsFlowCatalogId);
  const flowUsageByLabel = collectFlowUsage(flowCatalog);

  const effects = (effectCatalog.effects || []).map(effect => {
    const classification = readinessForEffect(effect);
    const flowUsage = flowUsageByLabel.get(effect.label) || {
      label: effect.label,
      callCount: 0,
      flowIds: [],
      componentLabels: [],
      stateSlots: [],
      categories: [],
    };
    return {
      id: `${effect.label}_${effect.role}`,
      label: effect.label,
      offset: effect.offset,
      region: effect.region,
      role: effect.role,
      category: effect.category,
      effectConfidence: effect.confidence,
      engineReadiness: classification.readiness,
      readinessConfidence: classification.confidence,
      moduleTargets: moduleTargetsByCategory[effect.category] || ['shared/wb3/player-physics.js'],
      blockers: classification.blockers,
      callCount: (effect.calls || []).length,
      calls: effect.calls || [],
      flowUsage,
      readFieldRoles: fieldRoles(effect, 'reads'),
      writeFieldRoles: fieldRoles(effect, 'writes'),
      constantNames: [...new Set((effect.constants || []).map(constant => constant.name))].sort(),
      evidence: [
        `${physicsEffectCatalogId} maps frame effects, reads/writes, constants, and ASM evidence for ${effect.label}.`,
        flowUsage.callCount
          ? `${physicsFlowCatalogId} observes ${flowUsage.callCount} state-flow call(s) to ${effect.label}.`
          : `${physicsFlowCatalogId} has no direct player-state flow call to ${effect.label}; it may be helper-only or entity/contact-path-only.`,
      ],
    };
  });

  const readyPure = effects.filter(effect => effect.engineReadiness === 'ready_for_pure_helper_extraction');
  const axisTrace = effects.filter(effect => effect.engineReadiness.includes('axis_trace'));
  const entityTrace = effects.filter(effect => effect.engineReadiness.includes('entity_trace'));
  const frameTrace = effects.filter(effect => effect.engineReadiness === 'needs_frame_trace_before_engine_port');
  const directFlowEffects = effects.filter(effect => effect.flowUsage.callCount > 0);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [physicsEffectCatalogId, physicsFlowCatalogId],
    semantics: {
      extractionPolicy: 'This catalog is a readiness index, not an implementation. It marks which mapped effects can be extracted as pure helpers and which require axis, entity, or frame traces first.',
      coordinatePolicy: 'The existing physics catalog intentionally uses coordinate_a/coordinate_b until runtime traces prove screen-axis naming across multiple rooms.',
      assetPolicy: 'Metadata only: labels, offsets, routine roles, module targets, readiness classes, counts, and evidence references. No ROM bytes, decoded graphics, audio, table payloads, or instruction bytes are embedded.',
    },
    summary: {
      effectCount: effects.length,
      directPlayerStateFlowEffectCount: directFlowEffects.length,
      directPlayerStatePhysicsCallCount: directFlowEffects.reduce((sum, effect) => sum + effect.flowUsage.callCount, 0),
      categoryCounts: countBy(effects, effect => effect.category),
      readinessCounts: countBy(effects, effect => effect.engineReadiness),
      moduleTargetCounts: countBy(effects.flatMap(effect => effect.moduleTargets), target => target),
      readyPureHelperCount: readyPure.length,
      axisTraceRequiredCount: axisTrace.length,
      entityTraceRequiredCount: entityTrace.length,
      frameTraceRequiredCount: frameTrace.length,
      effectsWithNoDirectPlayerStateFlowCount: effects.filter(effect => effect.flowUsage.callCount === 0).length,
      validationIssueCount: (effectCatalog.validationIssues || []).length,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    effects,
    extractionGroups: [
      {
        id: 'pure_player_motion_helpers',
        readiness: 'ready_for_pure_helper_extraction',
        moduleTarget: 'shared/wb3/player-physics.js',
        effectLabels: readyPure.filter(effect => effect.moduleTargets.includes('shared/wb3/player-physics.js')).map(effect => effect.label),
      },
      {
        id: 'pure_collision_lookup_helpers',
        readiness: 'ready_for_pure_helper_extraction',
        moduleTarget: 'shared/wb3/collision.js',
        effectLabels: readyPure.filter(effect => effect.moduleTargets.includes('shared/wb3/collision.js')).map(effect => effect.label),
      },
      {
        id: 'collision_state_mutation_helpers',
        readiness: 'ready_after_axis_trace',
        moduleTarget: 'shared/wb3/collision.js',
        effectLabels: axisTrace.map(effect => effect.label),
      },
      {
        id: 'entity_contact_collision_helpers',
        readiness: 'ready_after_entity_struct_trace',
        moduleTarget: 'shared/wb3/entities.js',
        effectLabels: entityTrace.map(effect => effect.label),
      },
      {
        id: 'full_player_collision_pipeline',
        readiness: 'needs_frame_trace_before_engine_port',
        moduleTarget: 'shared/wb3/player-physics.js',
        effectLabels: frameTrace.map(effect => effect.label),
      },
    ],
    evidence: [
      `${physicsEffectCatalogId} contains 21 high-confidence player physics/collision/contact state effects with RAM fields, constants, and ASM line evidence.`,
      `${physicsFlowCatalogId} links player-state handlers to direct physics effect calls and gives call counts by state flow.`,
      'No code-generation or behavior-port claim is made for routines that still require axis, entity, or frame traces.',
    ],
    nextLeads: [
      'Frame-trace _LABEL_1446_ in two known rooms to prove coordinate_a/coordinate_b orientation and collision-buffer indexing before engine port.',
      'Trace entity-slot hitbox fields through _LABEL_1C98_/_LABEL_1D10_ before extracting contact handlers into shared/wb3/entities.js.',
      'Extract only the ready pure motion helpers first, with tests derived from ASM semantics rather than ROM payload bytes.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  for (const effect of catalog.effects) {
    const region = effect.region?.id ? findRegionById(mapData, effect.region.id) : null;
    if (!region) continue;
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerPhysicsEngineReadinessAudit = {
        catalogId,
        kind: 'player_physics_engine_readiness',
        label: effect.label,
        role: effect.role,
        category: effect.category,
        confidence: effect.readinessConfidence,
        engineReadiness: effect.engineReadiness,
        moduleTargets: effect.moduleTargets,
        blockers: effect.blockers,
        flowUsage: effect.flowUsage,
        readFieldRoles: effect.readFieldRoles,
        writeFieldRoles: effect.writeFieldRoles,
        evidence: effect.evidence,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      label: effect.label,
      role: effect.role,
      engineReadiness: effect.engineReadiness,
    });
  }
  return { changedRegions, missingRegions: [] };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotations = annotateMap(mapData, catalog);

  if (apply) {
    mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(item => item.id !== catalogId);
    mapData.playerCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_physics_engine_readiness_audit',
      generatedAt: now,
      schemaVersion,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotations.changedRegions.length,
      },
      semantics: catalog.semantics,
      extractionGroups: catalog.extractionGroups,
      changedRegions: annotations.changedRegions,
      missingRegions: annotations.missingRegions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    extractionGroups: catalog.extractionGroups,
    changedRegions: annotations.changedRegions,
    missingRegions: annotations.missingRegions,
  }, null, 2));
}

main();
