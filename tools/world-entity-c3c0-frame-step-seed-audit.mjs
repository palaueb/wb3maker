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
const catalogId = 'world-entity-c3c0-frame-step-seed-catalog-2026-06-25';
const reportId = 'entity-c3c0-frame-step-seed-audit-2026-06-25';
const toolName = 'tools/world-entity-c3c0-frame-step-seed-audit.mjs';

const sourceCatalogIds = {
  renderability: 'world-entity-c3c0-renderability-catalog-2026-06-25',
  targetLinks: 'world-entity-c3c0-motion-seed-target-link-catalog-2026-06-25',
  targetSemantics: 'world-entity-c3c0-behavior-target-semantics-catalog-2026-06-25',
  runtimeStruct: 'world-entity-runtime-struct-field-catalog-2026-06-25',
  motionDelta: 'world-entity-motion-delta-field-provenance-catalog-2026-06-25',
  velocity: 'world-entity-velocity-field-provenance-catalog-2026-06-25',
  positionIntegrator: 'world-entity-position-integrator-catalog-2026-06-25',
  oamSemantics: 'world-metasprite-oam-writer-semantics-catalog-2026-06-25',
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

function compactRegion(region) {
  return region ? {
    id: region.id || '',
    name: region.name || '',
    type: region.type || '',
    offset: region.offset || '',
    size: region.size || 0,
  } : null;
}

function compactSegment(segment) {
  return segment ? {
    start: segment.start || '',
    endExclusive: segment.endExclusive || '',
    sizeBytes: Number(segment.sizeBytes || 0),
    boundarySource: segment.boundarySource || '',
  } : null;
}

function compactScan(scan) {
  return scan ? {
    scanMode: scan.scanMode || '',
    instructionCount: Number(scan.instructionCount || 0),
    pathCount: Number(scan.pathCount || 0),
    reachableByteCount: Number(scan.reachableByteCount || 0),
    unreachedSegmentByteCount: Number(scan.unreachedSegmentByteCount || 0),
    callCount: Number(scan.callCount || 0),
    relativeBranchCount: Number(scan.relativeBranchCount || 0),
    returnCount: Number(scan.returnCount || 0),
    indexedFieldReferenceCount: Number(scan.indexedFieldReferenceCount || 0),
    warningCount: (scan.warnings || []).length,
  } : null;
}

function compactHelperCall(call) {
  return {
    offset: call.offset || '',
    targetOffset: call.targetOffset || '',
    targetLabel: call.targetLabel || '',
    targetRole: call.targetRole || '',
    targetCategory: call.targetCategory || '',
    sourceCatalog: call.sourceCatalog || '',
  };
}

function compactFieldRef(ref) {
  return {
    token: ref.token || `${ref.register || 'IX'}+${ref.fieldOffset}`,
    access: ref.access || '',
    role: ref.knownRole || null,
    fieldGroup: ref.knownFieldGroup || null,
    confidence: ref.knownRole ? 'catalog_backed' : 'unresolved_role',
  };
}

function classifyTarget(entry, semantics) {
  const tags = new Set(semantics?.semanticTags || []);
  const helperLabels = new Set((semantics?.helperCalls || []).map(call => call.targetLabel).filter(Boolean));
  if (!helperLabels.size && !tags.size) return 'setup_guard_or_local_helper_target';
  if (tags.has('collision_pipeline') && tags.has('packed_motion_delta_consumer')) return 'collision_motion_animation_update';
  if (tags.has('animation_start') && tags.has('timer_counter_write')) return 'animation_transition_timer_update';
  if (tags.has('animation_tick') && tags.has('behavior_state_write')) return 'animation_state_update';
  if (tags.has('animation_tick')) return 'animation_tick_update';
  return `behavior_state_${entry.index}_metadata_target`;
}

function externalUnknownCallCount(semantics) {
  return (semantics?.callTargets || []).filter(call =>
    !call.targetLabel && !call.targetRole && call.targetInSegment === false
  ).length;
}

function buildTargetModel(entry, semantics) {
  const helperCalls = (semantics?.helperCalls || []).map(compactHelperCall);
  const fieldRefs = (semantics?.indexedFieldRefs || []).map(compactFieldRef);
  return {
    behaviorStateIndex: entry.index,
    entryOffset: entry.entryOffset,
    targetOffset: entry.romOffset,
    targetRegion: compactRegion(entry.targetRegion),
    modelRole: classifyTarget(entry, semantics),
    semanticTags: semantics?.semanticTags || [],
    helperCalls,
    helperCallLabels: unique(helperCalls.map(call => call.targetLabel)),
    indexedFieldTokens: semantics?.indexedFieldTokens || [],
    indexedFieldRefs: fieldRefs,
    fieldRoleCount: fieldRefs.filter(ref => ref.role).length,
    unresolvedFieldRoleCount: fieldRefs.filter(ref => !ref.role).length,
    unknownExternalCallCount: externalUnknownCallCount(semantics),
    scan: compactScan(semantics?.scan),
    segment: compactSegment(semantics?.segment),
    referenceCount: Number(semantics?.referenceCount || 0),
    confidence: semantics?.confidence || 'unknown',
    readiness: externalUnknownCallCount(semantics) === 0 && !(semantics?.scan?.warnings || []).length
      ? 'metadata_frame_step_component_ready'
      : 'needs_local_helper_or_branch_trace',
    persistedRomByteCount: 0,
    persistedGameplayValueCount: 0,
    evidence: [
      `Behavior table entry ${entry.index} in _DATA_6D47_ points to ${entry.romOffset}.`,
      ...(semantics?.evidence || []).slice(0, 3),
    ],
  };
}

function compactActor(actor) {
  return {
    entityType: actor.entityType,
    selectorTypeHex: actor.selectorTypeHex,
    seedLabel: actor.seedLabel,
    renderabilityStatus: actor.renderabilityStatus,
    frameStepCandidateScore: Number(actor.frameStepCandidateScore || 0),
    frameAsset: actor.frameAsset ? {
      status: actor.frameAsset.status || '',
      subrecordCount: Number(actor.frameAsset.subrecordCount || 0),
      frameRegionCount: Number(actor.frameAsset.frameRegionCount || 0),
      pieceRecordCount: Number(actor.frameAsset.pieceRecordCount || 0),
      referenceCount: Number(actor.frameAsset.referenceCount || 0),
      regionIds: actor.frameAsset.regionIds || [],
    } : null,
    dynamicTile: actor.dynamicTile ? {
      tableId: actor.dynamicTile.tableId || '',
      entryOffset: actor.dynamicTile.entryOffset || '',
      remapRow: actor.dynamicTile.remapRow ?? null,
      streamRomOffset: actor.dynamicTile.streamRomOffset || '',
      streamRegionId: actor.dynamicTile.streamRegionId || '',
      zeroPadding: Boolean(actor.dynamicTile.zeroPadding),
    } : null,
    dynamicFrameCoverage: actor.dynamicFrameCoverage ? {
      coverageStatus: actor.dynamicFrameCoverage.coverageStatus || '',
      uploadCount: Number(actor.dynamicFrameCoverage.uploadCount || 0),
      coveredUploadCount: Number(actor.dynamicFrameCoverage.coveredUploadCount || 0),
      partialCoverageUploadCount: Number(actor.dynamicFrameCoverage.partialCoverageUploadCount || 0),
      assignedTileCountRange: actor.dynamicFrameCoverage.assignedTileCountRange || null,
      frameTileByteRange: actor.dynamicFrameCoverage.frameTileByteRange || null,
    } : null,
  };
}

function buildCatalog(mapData) {
  const renderability = requireCatalog(mapData, sourceCatalogIds.renderability);
  const targetLinks = requireCatalog(mapData, sourceCatalogIds.targetLinks);
  const targetSemantics = requireCatalog(mapData, sourceCatalogIds.targetSemantics);
  const runtimeStruct = requireCatalog(mapData, sourceCatalogIds.runtimeStruct);
  const motionDelta = requireCatalog(mapData, sourceCatalogIds.motionDelta);
  const velocity = requireCatalog(mapData, sourceCatalogIds.velocity);
  const positionIntegrator = requireCatalog(mapData, sourceCatalogIds.positionIntegrator);
  const oamSemantics = requireCatalog(mapData, sourceCatalogIds.oamSemantics);

  const candidateEntityType = renderability.summary?.bestFrameStepCandidate || '';
  const actor = (renderability.actors || []).find(item => item.entityType === candidateEntityType);
  if (!actor) throw new Error(`Best frame-step candidate ${candidateEntityType || '(missing)'} is not present in ${sourceCatalogIds.renderability}`);
  const seedLink = (targetLinks.seedTargetLinks || []).find(item => item.seedLabel === actor.seedLabel);
  if (!seedLink) throw new Error(`Seed ${actor.seedLabel} is not present in ${sourceCatalogIds.targetLinks}`);
  const sourceLink = (seedLink.sourceLinks || []).find(link =>
    (actor.behaviorListSourceExpressions || []).includes(link.sourceExpression)
  ) || seedLink.sourceLinks?.[0];
  if (!sourceLink) throw new Error(`Seed ${actor.seedLabel} has no linked behavior-list source`);

  const targetModels = (sourceLink.entries || []).map(entry => {
    const semantics = (targetSemantics.targets || []).find(target => target.targetOffset === entry.romOffset);
    return buildTargetModel(entry, semantics);
  });
  const helperLabelCounts = countBy(targetModels.flatMap(target => target.helperCallLabels), label => label);
  const semanticTagCounts = countBy(targetModels.flatMap(target => target.semanticTags), tag => tag);
  const fieldTokens = unique(targetModels.flatMap(target => target.indexedFieldTokens));
  const unresolvedTargetCount = targetModels.filter(target => target.readiness !== 'metadata_frame_step_component_ready').length;
  const unknownExternalCallCount = targetModels.reduce((sum, target) => sum + target.unknownExternalCallCount, 0);
  const seedRegion = findContainingRegion(mapData, parseHex(actor.seedRegion?.offset) || 0);
  const seedFieldRefs = seedRegion?.analysis?.entityRuntimeStructFieldAudit?.fieldRefs || [];
  const seedFieldTokens = unique(seedFieldRefs.map(ref => ref.token));
  const targetRegionIds = unique(targetModels.map(target => target.targetRegion?.id));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    summary: {
      candidateEntityType,
      candidateSeedLabel: actor.seedLabel,
      candidateSeedRegionId: actor.seedRegion?.id || '',
      behaviorListSource: sourceLink.sourceExpression || '',
      behaviorTargetCount: targetModels.length,
      targetRegionCount: targetRegionIds.length,
      metadataReadyTargetCount: targetModels.length - unresolvedTargetCount,
      needsLocalHelperOrBranchTraceTargetCount: unresolvedTargetCount,
      unknownExternalCallCount,
      helperCallLabelCounts: helperLabelCounts,
      semanticTagCounts,
      indexedFieldTokenCount: fieldTokens.length,
      seedIndexedFieldTokenCount: seedFieldTokens.length,
      fullyDynamicUploadRenderable: actor.renderabilityStatus === 'fully_dynamic_upload_renderable',
      dynamicUploadCount: Number(actor.dynamicFrameCoverage?.uploadCount || 0),
      coveredDynamicUploadCount: Number(actor.dynamicFrameCoverage?.coveredUploadCount || 0),
      frameAssetSubrecordCount: Number(actor.frameAsset?.subrecordCount || 0),
      frameAssetPieceRecordCount: Number(actor.frameAsset?.pieceRecordCount || 0),
      oamFrameStreamRoutine: oamSemantics.summary?.frameStreamRoutine || '',
      oamTileBaseField: oamSemantics.summary?.tileBaseField || '',
      positionIntegratorBothAxesRoutine: positionIntegrator.summary?.bothAxesRoutine || '',
      xVelocityFields: velocity.summary?.xVelocityFields || '',
      yVelocityFields: velocity.summary?.yVelocityFields || '',
      xMotionDeltaField: motionDelta.summary?.xDeltaField || '',
      yMotionDeltaField: motionDelta.summary?.yDeltaField || '',
      frameStepExtractionStatus: 'metadata_skeleton_ready_not_frame_exact',
      persistedRomByteCount: 0,
      persistedTileByteCount: 0,
      persistedPixelCount: 0,
      persistedCoordinateCount: 0,
      persistedGameplayValueCount: 0,
      assetPolicy: 'Metadata only: actor ids, labels, offsets, region ids, helper labels, field-role tokens, counts, statuses, and evidence. No ROM bytes, decoded graphics, sprite pixels, coordinates, screenshots, music, text, or gameplay tables are embedded.',
    },
    seedModel: {
      entityType: actor.entityType,
      selectorTypeHex: actor.selectorTypeHex,
      seedLabel: actor.seedLabel,
      seedRegion: actor.seedRegion,
      seedResolution: actor.seedResolution,
      behaviorListSource: sourceLink.sourceExpression || '',
      behaviorTable: {
        id: sourceLink.behaviorTable?.id || '',
        label: sourceLink.behaviorTable?.label || '',
        offset: sourceLink.behaviorTable?.offset || '',
        role: sourceLink.behaviorTable?.role || '',
        setupRoutine: sourceLink.behaviorTable?.setupRoutine || '',
        entryCount: Number(sourceLink.behaviorTable?.entryCount || 0),
        region: compactRegion(sourceLink.behaviorTable?.region),
      },
      initialization: {
        dispatchTable: seedRegion?.analysis?.bank0EntityBehaviorAudit?.dispatchTable || '',
        dispatchIndex: seedRegion?.analysis?.bank0EntityBehaviorAudit?.dispatchIndex ?? null,
        animationStartRoutine: '_LABEL_1318_',
        animationSelectorSource: seedRegion?.analysis?.animationBehaviorFamilyAudit?.families?.[0]?.variantSelector || '',
        seedFieldTokens,
        seedFieldRoles: seedFieldRefs.map(ref => ({
          token: ref.token,
          role: ref.role,
          fieldGroup: ref.fieldGroup,
          confidence: ref.confidence,
        })),
        motionSeedFields: seedLink.motionFields || [],
        persistedGameplayValueCount: 0,
        evidence: [
          ...(seedRegion?.analysis?.bank0EntityBehaviorAudit?.evidence || []).slice(0, 3),
          ...(seedRegion?.analysis?.c3c0MotionSeedFamilyAudit?.evidence || []).slice(0, 3),
        ],
      },
      renderability: compactActor(actor),
      targetModels,
      reusableFrameStepSkeleton: {
        dispatchModel: 'Behavior list _DATA_6D47_ provides five target offsets; IX+32 is the catalog-backed behavior_state field referenced by every target except pure setup helpers.',
        supportedComponents: unique([
          'entity_animation_start',
          'entity_animation_tick',
          'actor_full_collision_pipeline',
          'packed_coordinate_b_velocity_delta',
          'behavior_state_write',
          'timer_counter_write',
          'dynamic_tile_upload_covered_frame_assets',
        ]),
        blockedComponents: [
          'literal branch predicates and timing constants are not promoted into engine code by this metadata-only catalog',
          'unknown external/local helper roles must be traced before a frame-exact JavaScript entity update is generated',
          'frame-step ordering still needs runtime trace verification against IX+32 transitions',
        ],
        recommendedFirstImplementation: 'Build a read-only JS diagnostic that follows targetModels by behaviorStateIndex, invokes named helper stubs, and records field tokens touched per frame without simulating literal constants.',
      },
      evidence: [
        `${sourceCatalogIds.renderability} selected ${actor.entityType} as the best fully renderable C3C0 frame-step candidate.`,
        `${sourceCatalogIds.targetLinks} links ${actor.seedLabel} to ${sourceLink.sourceExpression} and ${targetModels.length} behavior target entries.`,
        `${sourceCatalogIds.targetSemantics} supplies helper labels, IX field-role tokens, bounded scan counts, and branch/call readiness statuses.`,
      ],
    },
    targetRegionIds,
    fieldTokens,
    evidence: [
      `${sourceCatalogIds.renderability} confirms ${actor.entityType} has fully covered dynamic uploads and high-confidence frame subrecords.`,
      `${sourceCatalogIds.targetLinks} decodes the behavior-list target offsets for ${actor.seedLabel}.`,
      `${sourceCatalogIds.targetSemantics} scans those targets without embedding instruction byte streams.`,
      `${sourceCatalogIds.runtimeStruct}, ${sourceCatalogIds.motionDelta}, ${sourceCatalogIds.velocity}, and ${sourceCatalogIds.positionIntegrator} provide the field-role vocabulary used by the skeleton.`,
    ],
    nextLeads: [
      'Trace unknown external/local helper calls inside the five target models, especially setup_guard_or_local_helper_target and animation_transition_timer_update states.',
      'Build a read-only browser frame-step diagnostic for entity 0x26 that dispatches by behaviorStateIndex and records helper stubs/field tokens per frame.',
      'After branch predicates are traced, promote only named helper stubs into shared/wb3/entities.js; keep literal timing/motion constants out until frame traces confirm them.',
    ],
  };
}

function annotateSeedRegion(region, catalog) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.c3c0FrameStepSeedAudit = {
    catalogId,
    kind: 'c3c0_frame_step_seed_model',
    confidence: catalog.summary.needsLocalHelperOrBranchTraceTargetCount ? 'medium' : 'high',
    entityType: catalog.summary.candidateEntityType,
    seedLabel: catalog.summary.candidateSeedLabel,
    behaviorListSource: catalog.summary.behaviorListSource,
    behaviorTargetCount: catalog.summary.behaviorTargetCount,
    metadataReadyTargetCount: catalog.summary.metadataReadyTargetCount,
    needsLocalHelperOrBranchTraceTargetCount: catalog.summary.needsLocalHelperOrBranchTraceTargetCount,
    helperCallLabelCounts: catalog.summary.helperCallLabelCounts,
    indexedFieldTokenCount: catalog.summary.indexedFieldTokenCount,
    frameStepExtractionStatus: catalog.summary.frameStepExtractionStatus,
    persistedRomByteCount: 0,
    persistedTileByteCount: 0,
    persistedPixelCount: 0,
    persistedCoordinateCount: 0,
    persistedGameplayValueCount: 0,
    summary: `${catalog.summary.candidateEntityType} / ${catalog.summary.candidateSeedLabel} is the first metadata-backed C3C0 frame-step seed: ${catalog.summary.behaviorTargetCount} target(s), ${catalog.summary.metadataReadyTargetCount} metadata-ready, ${catalog.summary.needsLocalHelperOrBranchTraceTargetCount} needing helper/branch trace.`,
    evidence: catalog.seedModel.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return regionRef(region);
}

function annotateBehaviorTableRegion(region, catalog) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.c3c0FrameStepSeedBehaviorTableAudit = {
    catalogId,
    kind: 'c3c0_frame_step_seed_behavior_table',
    confidence: 'high',
    entityType: catalog.summary.candidateEntityType,
    seedLabel: catalog.summary.candidateSeedLabel,
    behaviorListSource: catalog.summary.behaviorListSource,
    behaviorTargetCount: catalog.summary.behaviorTargetCount,
    targetOffsets: catalog.seedModel.targetModels.map(target => target.targetOffset),
    persistedRomByteCount: 0,
    persistedGameplayValueCount: 0,
    summary: `${catalog.summary.behaviorListSource} is the behavior-list source for frame-step seed ${catalog.summary.candidateEntityType}; target offsets are metadata-only references.`,
    evidence: [
      `${sourceCatalogIds.targetLinks} decodes ${catalog.summary.behaviorListSource} into ${catalog.summary.behaviorTargetCount} target entries.`,
      'Only offsets and region ids are stored; behavior-list bytes remain in the local ROM.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  return regionRef(region);
}

function annotateTargetRegion(region, targetModels, catalog) {
  if (!region || !targetModels.length) return null;
  region.analysis = region.analysis || {};
  const helperLabels = unique(targetModels.flatMap(target => target.helperCallLabels));
  region.analysis.c3c0FrameStepSeedTargetAudit = {
    catalogId,
    kind: 'c3c0_frame_step_seed_target_region',
    confidence: targetModels.some(target => target.readiness !== 'metadata_frame_step_component_ready') ? 'medium' : 'high',
    entityType: catalog.summary.candidateEntityType,
    seedLabel: catalog.summary.candidateSeedLabel,
    behaviorListSource: catalog.summary.behaviorListSource,
    targetCount: targetModels.length,
    targetOffsets: targetModels.map(target => target.targetOffset),
    modelRoles: unique(targetModels.map(target => target.modelRole)),
    helperCallLabels: helperLabels,
    unknownExternalCallCount: targetModels.reduce((sum, target) => sum + target.unknownExternalCallCount, 0),
    persistedRomByteCount: 0,
    persistedGameplayValueCount: 0,
    summary: `${targetModels.length} target(s) from ${catalog.summary.behaviorListSource} are inside this code region for frame-step seed ${catalog.summary.candidateEntityType}.`,
    evidence: [
      `${sourceCatalogIds.targetSemantics} supplies bounded opcode-scan metadata for these target offsets.`,
      'Only target offsets, helper labels, field tokens, and counts are stored.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  return regionRef(region);
}

function applyCatalog(mapData, catalog) {
  mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityBehaviorCatalogs.push(catalog);

  const seedRegion = findContainingRegion(mapData, parseHex(catalog.seedModel.seedRegion?.offset) || 0);
  const behaviorTableRegion = findContainingRegion(mapData, parseHex(catalog.seedModel.behaviorTable.offset) || 0);
  const annotatedSeedRegion = annotateSeedRegion(seedRegion, catalog);
  const annotatedBehaviorTableRegion = annotateBehaviorTableRegion(behaviorTableRegion, catalog);

  const annotatedTargetRegions = [];
  const targetsByRegion = new Map();
  for (const target of catalog.seedModel.targetModels) {
    const regionId = target.targetRegion?.id;
    if (!regionId) continue;
    if (!targetsByRegion.has(regionId)) targetsByRegion.set(regionId, []);
    targetsByRegion.get(regionId).push(target);
  }
  for (const [regionId, targets] of targetsByRegion) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    const annotated = annotateTargetRegion(region, targets, catalog);
    if (annotated) annotatedTargetRegions.push(annotated);
  }

  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_c3c0_frame_step_seed_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedSeedRegionCount: annotatedSeedRegion ? 1 : 0,
      annotatedBehaviorTableRegionCount: annotatedBehaviorTableRegion ? 1 : 0,
      annotatedTargetRegionCount: annotatedTargetRegions.length,
    },
    seedModel: catalog.seedModel,
    annotatedSeedRegion,
    annotatedBehaviorTableRegion,
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
    targetModels: catalog.seedModel.targetModels.map(target => ({
      behaviorStateIndex: target.behaviorStateIndex,
      targetOffset: target.targetOffset,
      modelRole: target.modelRole,
      readiness: target.readiness,
      helperCallLabels: target.helperCallLabels,
      indexedFieldTokens: target.indexedFieldTokens,
      unknownExternalCallCount: target.unknownExternalCallCount,
    })),
  }, null, 2));
}

main();
