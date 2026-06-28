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
const catalogId = 'world-entity-c3c0-frame-step-diagnostic-catalog-2026-06-25';
const reportId = 'entity-c3c0-frame-step-diagnostic-audit-2026-06-25';
const toolName = 'tools/world-entity-c3c0-frame-step-diagnostic-audit.mjs';

const sourceCatalogIds = {
  frameStepSeed: 'world-entity-c3c0-frame-step-seed-catalog-2026-06-25',
  helperGap: 'world-entity-c3c0-frame-step-helper-gap-catalog-2026-06-25',
  targetSemantics: 'world-entity-c3c0-behavior-target-semantics-catalog-2026-06-25',
  collisionInternalHelpers: 'world-entity-collision-fragment-internal-helper-catalog-2026-06-25',
  localSubroutines: 'world-entity-c3c0-frame-step-local-subroutine-catalog-2026-06-25',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function hex(value, width = 5) {
  return `0x${Number(value || 0).toString(16).toUpperCase().padStart(width, '0')}`;
}

function offsetOf(region) {
  return typeof region?.offset === 'number' ? region.offset : parseHex(region?.offset) || 0;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + Number(region.size || 0);
  }) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function findCatalog(mapData, id) {
  for (const [key, value] of Object.entries(mapData)) {
    if (!Array.isArray(value) || !/catalog/i.test(key)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function unique(items) {
  return [...new Set((items || []).filter(item => item !== '' && item != null))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (key === '' || key == null) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function compactScan(scan) {
  return {
    scanMode: scan?.scanMode || '',
    instructionCount: Number(scan?.instructionCount || 0),
    pathCount: Number(scan?.pathCount || 0),
    reachableByteCount: Number(scan?.reachableByteCount || 0),
    unreachedSegmentByteCount: Number(scan?.unreachedSegmentByteCount || 0),
    callCount: Number(scan?.callCount || 0),
    jumpCount: Number(scan?.jumpCount || 0),
    relativeBranchCount: Number(scan?.relativeBranchCount || 0),
    returnCount: Number(scan?.returnCount || 0),
    indexedFieldReferenceCount: Number(scan?.indexedFieldReferenceCount || 0),
    warningCount: (scan?.warnings || []).length,
  };
}

function helperTargetsBySource(helperGap) {
  const bySource = new Map();
  for (const helper of helperGap.helperTargets || []) {
    for (const source of helper.sourceTargetOffsets || []) {
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source).push(helper);
    }
  }
  return bySource;
}

function helperTargetByOffset(helperGap) {
  return new Map((helperGap.helperTargets || []).map(helper => [helper.targetOffset, helper]));
}

function targetSemanticsByOffset(targetSemantics) {
  return new Map((targetSemantics.targets || []).map(target => [target.targetOffset, target]));
}

function helperRoleForCall(call, helperByOffset) {
  if (call.targetRole) {
    return {
      role: call.targetRole,
      resolutionStatus: 'known_catalog_helper_call',
      sourceCatalog: call.sourceCatalog || '',
      confidence: 'high',
    };
  }
  const resolved = helperByOffset.get(call.targetOffset);
  if (resolved) {
    return {
      role: resolved.roleClass || '',
      resolutionStatus: resolved.roleResolutionStatus || '',
      sourceCatalog: '',
      confidence: resolved.confidence || 'medium',
    };
  }
  if (call.targetInSegment) {
    return {
      role: 'local_behavior_state_subroutine_role_pending',
      resolutionStatus: 'local_target_inside_behavior_state_segment_pending',
      sourceCatalog: '',
      confidence: 'medium',
    };
  }
  return {
    role: call.targetLabel ? 'labeled_external_helper_role_pending' : 'external_helper_role_pending',
    resolutionStatus: call.targetLabel ? 'label_known_role_pending' : 'target_region_unclassified',
    sourceCatalog: '',
    confidence: 'low',
  };
}

function callPlanForTarget(targetModel, semantics, helperByOffset) {
  return (semantics?.callTargets || []).map(call => {
    const role = helperRoleForCall(call, helperByOffset);
    return {
      callOffset: call.offset || '',
      callKind: call.kind || 'call',
      targetOffset: call.targetOffset || '',
      targetLabel: call.targetLabel || '',
      targetInSegment: Boolean(call.targetInSegment),
      role: role.role,
      resolutionStatus: role.resolutionStatus,
      sourceCatalog: role.sourceCatalog,
      confidence: role.confidence,
    };
  }).sort((a, b) => (parseHex(a.callOffset) || 0) - (parseHex(b.callOffset) || 0));
}

function buildStateModel(targetModel, semantics, helperBySource, helperByOffset) {
  const resolvedHelpers = helperBySource.get(targetModel.targetOffset) || [];
  const callPlan = callPlanForTarget(targetModel, semantics, helperByOffset);
  const unresolvedCallPlanCount = callPlan.filter(call =>
    ![
      'known_catalog_helper_call',
      'region_entry_role_known',
      'internal_helper_entry_role_known',
      'local_behavior_subroutine_role_known',
    ].includes(call.resolutionStatus)
  ).length;
  return {
    behaviorStateIndex: targetModel.behaviorStateIndex,
    targetOffset: targetModel.targetOffset,
    targetRegion: targetModel.targetRegion || null,
    modelRole: targetModel.modelRole || '',
    semanticTags: targetModel.semanticTags || [],
    indexedFieldTokens: targetModel.indexedFieldTokens || [],
    helperCallLabels: targetModel.helperCallLabels || [],
    helperTargetRoles: unique(resolvedHelpers.map(helper => helper.roleClass)),
    helperTargetOffsets: resolvedHelpers.map(helper => helper.targetOffset),
    helperRoleResolutionStatuses: unique(resolvedHelpers.map(helper => helper.roleResolutionStatus)),
    callPlan,
    callPlanCount: callPlan.length,
    unresolvedCallPlanCount,
    branchPredicateTraceStatus: 'pending_branch_predicate_and_literal_timing_trace',
    stateDiagnosticStatus: unresolvedCallPlanCount
      ? 'helper_roles_incomplete'
      : 'helper_call_plan_ready_not_frame_exact',
    scan: compactScan(targetModel.scan),
    persistedRomByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedGameplayValueCount: 0,
    evidence: [
      `Frame-step seed target model maps behavior state ${targetModel.behaviorStateIndex} to ${targetModel.targetOffset}.`,
      `${sourceCatalogIds.targetSemantics} supplies callsite order, helper labels, semantic tags, field tokens, and bounded scan counts without persisting instruction bytes.`,
      `${sourceCatalogIds.helperGap} resolves ${resolvedHelpers.length} roleless helper target(s) used by this state.`,
    ],
  };
}

function annotateSeedRegion(region, catalog) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.c3c0FrameStepDiagnosticAudit = {
    catalogId,
    kind: 'c3c0_frame_step_read_only_diagnostic',
    confidence: catalog.summary.unresolvedCallPlanCount ? 'medium' : 'high',
    entityType: catalog.summary.candidateEntityType,
    seedLabel: catalog.summary.candidateSeedLabel,
    behaviorListSource: catalog.summary.behaviorListSource,
    behaviorStateCount: catalog.summary.behaviorStateCount,
    callPlanEntryCount: catalog.summary.callPlanEntryCount,
    helperRoleResolvedTargetCount: catalog.summary.helperRoleResolvedTargetCount,
    exactSemanticsPendingHelperTargetCount: catalog.summary.exactSemanticsPendingHelperTargetCount,
    diagnosticStatus: catalog.summary.diagnosticStatus,
    persistedRomByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedGameplayValueCount: 0,
    summary: `${catalog.summary.candidateEntityType} / ${catalog.summary.candidateSeedLabel} now has a role-resolved metadata call plan for ${catalog.summary.behaviorStateCount} behavior state(s); frame-exact branch/timer trace is still pending.`,
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return regionRef(region);
}

function annotateTargetRegion(region, states, catalog) {
  if (!region || !states.length) return null;
  region.analysis = region.analysis || {};
  region.analysis.c3c0FrameStepDiagnosticTargetAudit = {
    catalogId,
    kind: 'c3c0_frame_step_diagnostic_target_region',
    confidence: states.some(state => state.unresolvedCallPlanCount) ? 'medium' : 'high',
    entityType: catalog.summary.candidateEntityType,
    seedLabel: catalog.summary.candidateSeedLabel,
    behaviorStateIndexes: states.map(state => state.behaviorStateIndex),
    targetOffsets: states.map(state => state.targetOffset),
    modelRoles: unique(states.map(state => state.modelRole)),
    callPlanEntryCount: states.reduce((sum, state) => sum + state.callPlanCount, 0),
    unresolvedCallPlanCount: states.reduce((sum, state) => sum + state.unresolvedCallPlanCount, 0),
    persistedRomByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedGameplayValueCount: 0,
    summary: `${states.length} actor 0x26 diagnostic behavior state target(s) resolve to this code region.`,
    evidence: [
      `${catalog.id} maps behavior state target offsets to metadata-only call plans.`,
      'Only labels, offsets, role names, field tokens, counts, and evidence are stored.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    behaviorStateIndexes: states.map(state => state.behaviorStateIndex),
    targetOffsets: states.map(state => state.targetOffset),
    callPlanEntryCount: states.reduce((sum, state) => sum + state.callPlanCount, 0),
    unresolvedCallPlanCount: states.reduce((sum, state) => sum + state.unresolvedCallPlanCount, 0),
  };
}

function buildCatalog(mapData) {
  const frameStepSeed = requireCatalog(mapData, sourceCatalogIds.frameStepSeed);
  const helperGap = requireCatalog(mapData, sourceCatalogIds.helperGap);
  const targetSemantics = requireCatalog(mapData, sourceCatalogIds.targetSemantics);
  const collisionInternalHelpers = requireCatalog(mapData, sourceCatalogIds.collisionInternalHelpers);
  const localSubroutines = requireCatalog(mapData, sourceCatalogIds.localSubroutines);
  const targetModels = frameStepSeed.seedModel?.targetModels || [];
  const helperBySource = helperTargetsBySource(helperGap);
  const helperByOffset = helperTargetByOffset(helperGap);
  const semanticsByOffset = targetSemanticsByOffset(targetSemantics);
  const stateModels = targetModels.map(target =>
    buildStateModel(target, semanticsByOffset.get(target.targetOffset), helperBySource, helperByOffset)
  );
  const unresolvedCallPlanCount = stateModels.reduce((sum, state) => sum + state.unresolvedCallPlanCount, 0);
  const callPlanEntryCount = stateModels.reduce((sum, state) => sum + state.callPlanCount, 0);
  const helperRoleResolvedTargetCount = Number(helperGap.summary?.roleKnownTargetCount || 0);
  const exactSemanticsPendingHelperTargetCount = Number(helperGap.summary?.exactSemanticsPendingTargetCount || 0);
  const targetRegionIds = unique(stateModels.map(state => state.targetRegion?.id));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    summary: {
      candidateEntityType: frameStepSeed.summary?.candidateEntityType || '',
      candidateSeedLabel: frameStepSeed.summary?.candidateSeedLabel || '',
      candidateSeedRegionId: frameStepSeed.summary?.candidateSeedRegionId || '',
      behaviorListSource: frameStepSeed.summary?.behaviorListSource || '',
      behaviorStateCount: stateModels.length,
      targetRegionCount: targetRegionIds.length,
      callPlanEntryCount,
      unresolvedCallPlanCount,
      helperTargetCount: Number(helperGap.summary?.uniqueHelperTargetCount || 0),
      helperRoleResolvedTargetCount,
      exactSemanticsPendingHelperTargetCount,
      internalHelperEntryRoleKnownTargetCount: Number(helperGap.summary?.internalHelperEntryRoleKnownTargetCount || 0),
      localBehaviorSubroutineRoleKnownTargetCount: Number(helperGap.summary?.localBehaviorSubroutineRoleKnownTargetCount || 0),
      regionEntryRoleKnownTargetCount: Number(helperGap.summary?.exactRegionRoleKnownTargetCount || 0),
      behaviorStatesWithAnimationTick: stateModels.filter(state => state.semanticTags.includes('animation_tick')).length,
      behaviorStatesWithCollisionPipeline: stateModels.filter(state => state.semanticTags.includes('collision_pipeline')).length,
      behaviorStatesWithPackedMotionDeltaConsumer: stateModels.filter(state => state.semanticTags.includes('packed_motion_delta_consumer')).length,
      behaviorStatesWithBehaviorStateWrite: stateModels.filter(state => state.semanticTags.includes('behavior_state_write')).length,
      behaviorStatesWithTimerCounterWrite: stateModels.filter(state => state.semanticTags.includes('timer_counter_write')).length,
      fieldTokenCount: unique(stateModels.flatMap(state => state.indexedFieldTokens)).length,
      branchPredicatePendingStateCount: stateModels.length,
      frameExactStateCount: 0,
      collisionInternalHelperCatalogBacked: Boolean(collisionInternalHelpers),
      localSubroutineCatalogBacked: Boolean(localSubroutines),
      diagnosticStatus: unresolvedCallPlanCount || exactSemanticsPendingHelperTargetCount
        ? 'helper_roles_incomplete'
        : 'metadata_call_plan_ready_not_frame_exact',
      persistedRomByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedTileByteCount: 0,
      persistedPixelCount: 0,
      persistedCoordinateCount: 0,
      persistedGameplayValueCount: 0,
      assetPolicy: 'Metadata only: actor ids, labels, offsets, callsite offsets, role names, field tokens, counts, statuses, and evidence. No ROM bytes, decoded instruction streams, graphics, coordinates, screenshots, music, text, or gameplay constants are embedded.',
    },
    readOnlyDiagnostic: {
      entityType: frameStepSeed.summary?.candidateEntityType || '',
      seedLabel: frameStepSeed.summary?.candidateSeedLabel || '',
      behaviorListSource: frameStepSeed.summary?.behaviorListSource || '',
      dispatchModel: frameStepSeed.seedModel?.reusableFrameStepSkeleton?.dispatchModel || '',
      stateModels,
      helperResolution: {
        catalogId: helperGap.id,
        roleResolutionStatusCounts: helperGap.summary?.roleResolutionStatusCounts || {},
        roleClassCounts: helperGap.summary?.roleClassCounts || {},
        helperTargets: (helperGap.helperTargets || []).map(helper => ({
          targetOffset: helper.targetOffset,
          targetLabel: helper.targetLabel || '',
          roleClass: helper.roleClass,
          roleResolutionStatus: helper.roleResolutionStatus,
          sourceBehaviorStateIndexes: helper.sourceBehaviorStateIndexes || [],
          sourceCallCount: Number(helper.sourceCallCount || 0),
          confidence: helper.confidence || '',
        })),
      },
      blockedComponents: [
        'branch predicates and literal timing constants are intentionally not promoted by this metadata catalog',
        'runtime ordering still needs a frame trace against IX+32 behavior-state transitions',
        'helper call stubs are named, but frame-exact JavaScript behavior is not generated yet',
      ],
      recommendedNextTool: 'Build a browser diagnostic that steps these stateModels, records helper stub calls and field-token touches, and compares transitions against live ROM-derived traces.',
    },
    targetRegionIds,
    evidence: [
      `${sourceCatalogIds.frameStepSeed} selected actor 0x26 / _LABEL_6D13_ and provides the five behavior-state target models.`,
      `${sourceCatalogIds.helperGap} resolves all roleless helper targets used by those state targets; exactSemanticsPendingTargetCount is ${exactSemanticsPendingHelperTargetCount}.`,
      `${sourceCatalogIds.targetSemantics} supplies metadata-only callsite order, helper labels, field tokens, and scan counts.`,
      `${sourceCatalogIds.collisionInternalHelpers} and ${sourceCatalogIds.localSubroutines} backfill exact roles for the previously pending internal/local helper entries.`,
    ],
    nextLeads: [
      'Expose this diagnostic in the analyzer so actor 0x26 state call plans are visible without reading raw ASM.',
      'Trace branch predicates and timer constants for the five state targets, storing only symbolic roles and evidence.',
      'Join room fixtures and dynamic-frame coverage to the state call plans to validate visual frame transitions.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityBehaviorCatalogs.push(catalog);

  const seedRegion = (mapData.regions || []).find(region => region.id === catalog.summary.candidateSeedRegionId);
  const annotatedSeedRegion = annotateSeedRegion(seedRegion, catalog);

  const statesByRegion = new Map();
  for (const state of catalog.readOnlyDiagnostic.stateModels || []) {
    const regionId = state.targetRegion?.id;
    if (!regionId) continue;
    if (!statesByRegion.has(regionId)) statesByRegion.set(regionId, []);
    statesByRegion.get(regionId).push(state);
  }
  const annotatedTargetRegions = [];
  for (const [regionId, states] of statesByRegion) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    const annotated = annotateTargetRegion(region, states, catalog);
    if (annotated) annotatedTargetRegions.push(annotated);
  }

  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_c3c0_frame_step_diagnostic_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedSeedRegionCount: annotatedSeedRegion ? 1 : 0,
      annotatedTargetRegionCount: annotatedTargetRegions.length,
    },
    annotatedSeedRegion,
    annotatedTargetRegions,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (apply) {
    applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    id: catalog.id,
    summary: catalog.summary,
    stateModels: catalog.readOnlyDiagnostic.stateModels.map(state => ({
      behaviorStateIndex: state.behaviorStateIndex,
      targetOffset: state.targetOffset,
      modelRole: state.modelRole,
      callPlanCount: state.callPlanCount,
      unresolvedCallPlanCount: state.unresolvedCallPlanCount,
      stateDiagnosticStatus: state.stateDiagnosticStatus,
      helperTargetRoles: state.helperTargetRoles,
    })),
  }, null, 2));
}

main();
