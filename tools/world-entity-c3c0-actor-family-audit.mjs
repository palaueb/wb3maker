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
const catalogId = 'world-entity-c3c0-actor-family-catalog-2026-06-25';
const reportId = 'entity-c3c0-actor-family-audit-2026-06-25';
const toolName = 'tools/world-entity-c3c0-actor-family-audit.mjs';

const behaviorCatalogId = 'world-room-entity-behavior-link-catalog-2026-06-25';
const frameAssetCatalogId = 'world-room-entity-frame-asset-link-catalog-2026-06-25';
const dynamicTileCatalogId = 'world-room-entity-dynamic-tile-catalog-2026-06-25';
const dynamicFrameCoverageCatalogId = 'world-room-entity-dynamic-frame-coverage-catalog-2026-06-25';
const seedFamilyCatalogId = 'world-entity-c3c0-motion-seed-family-catalog-2026-06-25';
const seedTargetCatalogId = 'world-entity-c3c0-motion-seed-target-link-catalog-2026-06-25';
const targetSemanticsCatalogId = 'world-entity-c3c0-behavior-target-semantics-catalog-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return typeof region?.offset === 'number' ? region.offset : parseHex(region?.offset) || 0;
}

function regionBounds(region) {
  const start = offsetOf(region);
  return { start, end: start + (region?.size || 0) };
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

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
  }) || null;
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
  return [...new Set(items.filter(item => item !== '' && item != null))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (key === '' || key == null) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function indexBy(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (key != null && key !== '') map.set(key, item);
  }
  return map;
}

function behaviorListConstants(initHead) {
  return (initHead?.constants || [])
    .map(item => /^behaviorList=([A-Za-z0-9_+\- ]+)$/i.exec(String(item || ''))?.[1]?.trim())
    .filter(Boolean);
}

function selectSourceLinks(seedTargetLink, sourceExpressions) {
  if (!seedTargetLink) return { sourceLinks: [], missingSources: sourceExpressions || [] };
  if (!sourceExpressions?.length) {
    return { sourceLinks: seedTargetLink.sourceLinks || [], missingSources: [] };
  }
  const sourceLinks = [];
  const missingSources = [];
  for (const expression of sourceExpressions) {
    const match = (seedTargetLink.sourceLinks || []).find(source =>
      source.sourceExpression === expression || source.dataLabel === expression
    );
    if (match) sourceLinks.push(match);
    else missingSources.push(expression);
  }
  return { sourceLinks, missingSources };
}

function compactDynamicTile(dynamicTile) {
  if (!dynamicTile) return null;
  return {
    tableId: dynamicTile.tableId || '',
    tableIndex: dynamicTile.tableIndex ?? null,
    entryOffset: dynamicTile.entryOffset || '',
    remapRow: dynamicTile.remapRow ?? null,
    streamRomOffset: dynamicTile.streamRomOffset || '',
    streamRegion: dynamicTile.streamRegion ? regionRef(dynamicTile.streamRegion) : null,
    zeroPadding: Boolean(dynamicTile.zeroPadding),
    source: dynamicTile.source || '',
  };
}

function compactFrameAsset(frameAsset) {
  if (!frameAsset) return null;
  return {
    status: frameAsset.status || '',
    selectorTypeHex: frameAsset.selectorTypeHex || '',
    confidence: frameAsset.confidence || '',
    subrecordCount: frameAsset.subrecordCount || 0,
    streamOffsetCount: frameAsset.streamOffsetCount || 0,
    frameRegionCount: frameAsset.frameRegionCount || 0,
    pieceRecordCount: frameAsset.pieceRecordCount || 0,
    referenceCount: frameAsset.referenceCount || 0,
    regionIds: unique((frameAsset.regions || []).map(item => item.region?.id)),
  };
}

function compactDynamicUpload(upload) {
  if (!upload) return null;
  return {
    table: upload.table || '',
    tableIndex: upload.tableIndex ?? null,
    uploadCount: upload.uploadCount || 0,
  };
}

function compactDynamicFrameCoverage(coverage) {
  if (!coverage) return null;
  return {
    coverageStatus: coverage.coverageStatus || '',
    uploadCount: coverage.uploadCount || 0,
    frameLinkedUploadCount: coverage.frameLinkedUploadCount || 0,
    coveredUploadCount: coverage.coveredUploadCount || 0,
    partialCoverageUploadCount: coverage.partialCoverageUploadCount || 0,
    noFrameAssetUploadCount: coverage.noFrameAssetUploadCount || 0,
    minAssignedTileCount: coverage.minAssignedTileCount || 0,
    maxAssignedTileCount: coverage.maxAssignedTileCount || 0,
    frameTileByteRange: coverage.frameTileByteRange
      ? {
          count: coverage.frameTileByteRange.count || 0,
          min: coverage.frameTileByteRange.min || '',
          max: coverage.frameTileByteRange.max || '',
          uniqueCount: coverage.frameTileByteRange.uniqueCount || 0,
        }
      : null,
    frameParseIssueCount: coverage.frameParseIssueCount || 0,
  };
}

function compactSourceLink(source) {
  return {
    sourceExpression: source.sourceExpression || '',
    dataLabel: source.dataLabel || '',
    status: source.status || '',
    behaviorTable: source.behaviorTable
      ? {
          id: source.behaviorTable.id || '',
          label: source.behaviorTable.label || '',
          offset: source.behaviorTable.offset || '',
          role: source.behaviorTable.role || '',
          entryCount: source.behaviorTable.entryCount || 0,
          region: source.behaviorTable.region ? regionRef(source.behaviorTable.region) : null,
        }
      : null,
    targetEntryCount: source.targetEntryCount || 0,
    uniqueTargetRegionCount: source.uniqueTargetRegionCount || 0,
    targetOffsets: (source.entries || []).map(entry => entry.romOffset).filter(Boolean),
    targetRegionIds: unique((source.entries || []).map(entry => entry.targetRegion?.id)),
  };
}

function targetOffsetKey(targetOffset) {
  const parsed = parseHex(targetOffset);
  return parsed == null ? String(targetOffset || '') : `0x${parsed.toString(16).toUpperCase().padStart(5, '0')}`;
}

function compactTargetSemantics(target) {
  if (!target) return null;
  return {
    targetOffset: target.targetOffset || '',
    targetRegionId: target.targetRegion?.id || '',
    referenceCount: target.referenceCount || 0,
    semanticTags: target.semanticTags || [],
    helperCallLabels: unique((target.helperCalls || []).map(call => call.targetLabel || call.targetRole)),
    indexedFieldTokens: target.indexedFieldTokens || [],
    scanMode: target.scan?.scanMode || '',
    scanWarningCount: (target.scan?.warnings || []).length + (target.scan?.truncatedInstructionCount || 0),
  };
}

function aggregateTargetSemantics(targets) {
  const present = targets.filter(Boolean);
  const tags = present.flatMap(target => target.semanticTags || []);
  const helpers = present.flatMap(target => target.helperCalls || []);
  const indexedTokens = present.flatMap(target => target.indexedFieldTokens || []);
  return {
    targetOffsetCount: present.length,
    targetRegionIds: unique(present.map(target => target.targetRegion?.id)),
    targetCountWithKnownHelperCalls: present.filter(target => (target.helperCalls || []).length > 0).length,
    targetCountWithPackedMotionDeltaConsumer: present.filter(target => (target.semanticTags || []).includes('packed_motion_delta_consumer')).length,
    targetCountWithVelocityIntegrator: present.filter(target => (target.semanticTags || []).includes('velocity_integrator')).length,
    targetCountWithCollisionPipeline: present.filter(target => (target.semanticTags || []).includes('collision_pipeline')).length,
    targetCountWithAnimationTick: present.filter(target => (target.semanticTags || []).includes('animation_tick')).length,
    targetCountWithBehaviorStateWrite: present.filter(target => (target.semanticTags || []).includes('behavior_state_write')).length,
    helperCallCount: helpers.length,
    helperCallLabelCounts: countBy(helpers, call => call.targetLabel || call.targetRole || 'unknown_helper'),
    semanticTags: unique(tags),
    semanticTagCounts: countBy(tags, tag => tag),
    indexedFieldTokens: unique(indexedTokens),
    warningTargetCount: present.filter(target =>
      (target.scan?.warnings || []).length > 0 || (target.scan?.truncatedInstructionCount || 0) > 0
    ).length,
    targetSummaries: present.map(compactTargetSemantics),
  };
}

function resolveSeedLink(behaviorLink, seedByLabel) {
  const dispatchLabel = behaviorLink.dispatch?.label || '';
  if (seedByLabel.has(dispatchLabel)) {
    return {
      effectiveSeedLabel: dispatchLabel,
      seedResolution: 'direct_seed_label',
      callerLabel: dispatchLabel,
      sourceExpressions: [],
    };
  }
  const initHead = behaviorLink.initializer?.initHead;
  const tailLabel = initHead?.tailLabel || '';
  if (tailLabel && seedByLabel.has(tailLabel)) {
    return {
      effectiveSeedLabel: tailLabel,
      seedResolution: 'init_head_tail_seed',
      callerLabel: initHead.label || dispatchLabel,
      sourceExpressions: behaviorListConstants(initHead),
    };
  }
  return null;
}

function buildActorFamilyLink(context, behaviorLink) {
  const resolution = resolveSeedLink(behaviorLink, context.seedByLabel);
  if (!resolution) return null;

  const seed = context.seedByLabel.get(resolution.effectiveSeedLabel);
  const seedTargetLink = context.seedTargetByLabel.get(resolution.effectiveSeedLabel);
  const { sourceLinks, missingSources } = selectSourceLinks(seedTargetLink, resolution.sourceExpressions);
  const sourceTargets = sourceLinks.flatMap(source => source.entries || []);
  const targetOffsets = unique(sourceTargets.map(entry => entry.romOffset))
    .sort((a, b) => (parseHex(a) || 0) - (parseHex(b) || 0));
  const targets = targetOffsets.map(offset => context.targetSemanticsByOffset.get(targetOffsetKey(offset))).filter(Boolean);
  const targetSemantics = aggregateTargetSemantics(targets);
  const frameLink = context.frameByEntityType.get(behaviorLink.entityTypeHex);
  const dynamicUpload = context.dynamicUploadByEntityType.get(behaviorLink.entityTypeHex);
  const dynamicFrameCoverage = context.dynamicFrameCoverageByEntityType.get(behaviorLink.entityTypeHex);
  const selector = behaviorLink.dispatchSelector || {};
  const initHead = behaviorLink.initializer?.initHead || null;
  const frameAsset = compactFrameAsset(frameLink?.frameAsset);
  const confidence = missingSources.length || !seedTargetLink ? 'medium' : 'high';

  return {
    entityType: behaviorLink.entityType,
    entityTypeHex: behaviorLink.entityTypeHex,
    dispatchSelector: {
      entityType: selector.entityType,
      entityTypeHex: selector.entityTypeHex || '',
      highBitVariant: Boolean(selector.highBitVariant),
    },
    usageClass: behaviorLink.usageClass || '',
    roomUsage: behaviorLink.roomUsage || {},
    dispatch: {
      table: behaviorLink.dispatch?.table || '',
      tableIndex: behaviorLink.dispatch?.tableIndex ?? null,
      label: behaviorLink.dispatch?.label || '',
      selectorPair: behaviorLink.dispatch?.selectorPair || null,
    },
    initializer: {
      status: behaviorLink.initializer?.status || '',
      initHeadLabel: initHead?.label || '',
      initHeadRole: initHead?.role || '',
      initHeadTailLabel: initHead?.tailLabel || '',
      initHeadTableIndex: initHead?.tableIndex ?? null,
      behaviorListConstants: behaviorListConstants(initHead),
      routineRegion: behaviorLink.initializer?.routineRegion ? regionRef(behaviorLink.initializer.routineRegion) : null,
    },
    c3c0Seed: {
      effectiveSeedLabel: resolution.effectiveSeedLabel,
      seedOffset: seed?.offset || '',
      seedRegion: seed?.region ? regionRef(seed.region) : null,
      seedResolution: resolution.seedResolution,
      callerLabel: resolution.callerLabel,
      tableEntryIndexesZeroBased: seed?.tableEntryIndexesZeroBased || [],
      motionFields: seed?.motionFields || [],
      behaviorListStatus: seed?.behaviorListStatus || '',
      behaviorListSourceExpressions: resolution.sourceExpressions.length
        ? resolution.sourceExpressions
        : unique((seed?.behaviorListSources || []).map(source => source.expression)),
      linkedBehaviorListSourceCount: sourceLinks.length,
      missingBehaviorListSources: missingSources,
      sourceLinks: sourceLinks.map(compactSourceLink),
      targetEntryCount: sourceTargets.length,
      targetOffsets,
      targetRegionIds: unique(sourceTargets.map(entry => entry.targetRegion?.id)),
    },
    targetSemantics,
    frameAsset,
    dynamicTile: compactDynamicTile(behaviorLink.dynamicTile || frameLink?.dynamicTile),
    dynamicUpload: compactDynamicUpload(dynamicUpload),
    dynamicFrameCoverage: compactDynamicFrameCoverage(dynamicFrameCoverage),
    confidence,
    persistedRomByteCount: 0,
    persistedCoordinateCount: 0,
    persistedPixelCount: 0,
    persistedGameplayValueCount: 0,
    evidence: [
      `${behaviorCatalogId} links raw entity type ${behaviorLink.entityTypeHex} to dispatch label ${behaviorLink.dispatch?.label || '?'}.`,
      resolution.seedResolution === 'direct_seed_label'
        ? `${seedFamilyCatalogId} classifies ${resolution.effectiveSeedLabel} as a C3C0 motion seed.`
        : `${behaviorLink.dispatch?.label || '?'} reaches C3C0 motion seed ${resolution.effectiveSeedLabel} through init-head tail ${initHead?.tailLabel || '?'}.`,
      sourceLinks.length
        ? `${seedTargetCatalogId} links ${sourceLinks.length} behavior-list source(s) for ${resolution.effectiveSeedLabel}.`
        : `${seedTargetCatalogId} has no decoded behavior-list target link for ${missingSources.join(', ') || resolution.effectiveSeedLabel}.`,
      `${targetSemanticsCatalogId} supplies bounded-scan semantics for ${targetSemantics.targetOffsetCount} linked target offset(s).`,
      frameAsset?.status === 'linked_high_confidence_frame_subrecords'
        ? `${frameAssetCatalogId} links this selector to ${frameAsset.subrecordCount} high-confidence frame subrecord(s).`
        : `${frameAssetCatalogId} records frame asset status ${frameAsset?.status || 'unknown'} for this selector.`,
    ],
  };
}

function buildSeedGroups(actorFamilies) {
  const groups = new Map();
  for (const actor of actorFamilies) {
    const sourceKey = actor.c3c0Seed.behaviorListSourceExpressions.length
      ? actor.c3c0Seed.behaviorListSourceExpressions.join('+')
      : 'all_seed_sources';
    const key = `${actor.c3c0Seed.effectiveSeedLabel}|${sourceKey}|${actor.c3c0Seed.seedResolution}`;
    if (!groups.has(key)) {
      groups.set(key, {
        seedLabel: actor.c3c0Seed.effectiveSeedLabel,
        seedRegion: actor.c3c0Seed.seedRegion,
        seedResolution: actor.c3c0Seed.seedResolution,
        behaviorListSourceExpressions: actor.c3c0Seed.behaviorListSourceExpressions,
        rawEntityTypes: [],
        selectorTypes: [],
        highBitVariantCount: 0,
        usageClassCounts: {},
        targetOffsets: new Set(),
        targetRegionIds: new Set(),
        semanticTags: new Set(),
        helperCallLabels: [],
        frameLinkedEntityTypeCount: 0,
        dynamicUploadedEntityTypeCount: 0,
        fullyCoveredEntityTypeCount: 0,
        needsTraceEntityTypeCount: 0,
        missingBehaviorListSourceEntityTypes: [],
        confidence: 'high',
      });
    }
    const group = groups.get(key);
    group.rawEntityTypes.push(actor.entityTypeHex);
    group.selectorTypes.push(actor.dispatchSelector.entityTypeHex);
    if (actor.dispatchSelector.highBitVariant) group.highBitVariantCount++;
    group.usageClassCounts[actor.usageClass] = (group.usageClassCounts[actor.usageClass] || 0) + 1;
    for (const offset of actor.c3c0Seed.targetOffsets || []) group.targetOffsets.add(offset);
    for (const regionId of actor.c3c0Seed.targetRegionIds || []) group.targetRegionIds.add(regionId);
    for (const tag of actor.targetSemantics.semanticTags || []) group.semanticTags.add(tag);
    group.helperCallLabels.push(...Object.keys(actor.targetSemantics.helperCallLabelCounts || {}));
    if (actor.frameAsset?.status === 'linked_high_confidence_frame_subrecords') group.frameLinkedEntityTypeCount++;
    if (actor.dynamicUpload) group.dynamicUploadedEntityTypeCount++;
    if (actor.dynamicFrameCoverage?.coverageStatus === 'all_observed_uploads_cover_frame_tiles') group.fullyCoveredEntityTypeCount++;
    if (actor.dynamicFrameCoverage?.coverageStatus === 'needs_frame_tile_base_trace') group.needsTraceEntityTypeCount++;
    if (actor.c3c0Seed.missingBehaviorListSources.length) {
      group.confidence = 'medium';
      group.missingBehaviorListSourceEntityTypes.push(actor.entityTypeHex);
    }
  }

  return [...groups.values()].map(group => ({
    seedLabel: group.seedLabel,
    seedRegion: group.seedRegion,
    seedResolution: group.seedResolution,
    behaviorListSourceExpressions: unique(group.behaviorListSourceExpressions),
    rawEntityTypeCount: group.rawEntityTypes.length,
    rawEntityTypes: unique(group.rawEntityTypes),
    selectorTypes: unique(group.selectorTypes),
    highBitVariantCount: group.highBitVariantCount,
    usageClassCounts: Object.fromEntries(Object.entries(group.usageClassCounts).sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
    targetOffsetCount: group.targetOffsets.size,
    targetOffsets: [...group.targetOffsets].sort((a, b) => (parseHex(a) || 0) - (parseHex(b) || 0)),
    targetRegionIds: unique([...group.targetRegionIds]),
    semanticTags: unique([...group.semanticTags]),
    helperCallLabels: unique(group.helperCallLabels),
    frameLinkedEntityTypeCount: group.frameLinkedEntityTypeCount,
    dynamicUploadedEntityTypeCount: group.dynamicUploadedEntityTypeCount,
    fullyCoveredEntityTypeCount: group.fullyCoveredEntityTypeCount,
    needsTraceEntityTypeCount: group.needsTraceEntityTypeCount,
    missingBehaviorListSourceEntityTypes: unique(group.missingBehaviorListSourceEntityTypes),
    confidence: group.confidence,
  })).sort((a, b) => (parseHex(a.seedRegion?.offset) || 0) - (parseHex(b.seedRegion?.offset) || 0)
    || a.behaviorListSourceExpressions.join('').localeCompare(b.behaviorListSourceExpressions.join('')));
}

function buildCatalog(mapData) {
  const behaviorCatalog = requireCatalog(mapData, behaviorCatalogId);
  const frameAssetCatalog = requireCatalog(mapData, frameAssetCatalogId);
  const dynamicTileCatalog = requireCatalog(mapData, dynamicTileCatalogId);
  const dynamicFrameCoverageCatalog = requireCatalog(mapData, dynamicFrameCoverageCatalogId);
  const seedFamilyCatalog = requireCatalog(mapData, seedFamilyCatalogId);
  const seedTargetCatalog = requireCatalog(mapData, seedTargetCatalogId);
  const targetSemanticsCatalog = requireCatalog(mapData, targetSemanticsCatalogId);

  const context = {
    seedByLabel: indexBy(seedFamilyCatalog.seeds || [], seed => seed.label),
    seedTargetByLabel: indexBy(seedTargetCatalog.seedTargetLinks || [], link => link.seedLabel),
    targetSemanticsByOffset: indexBy(targetSemanticsCatalog.targets || [], target => targetOffsetKey(target.targetOffset)),
    frameByEntityType: indexBy(frameAssetCatalog.links || [], link => link.entityTypeHex),
    dynamicUploadByEntityType: indexBy(dynamicTileCatalog.entityUploadUsage || [], usage => usage.entityType),
    dynamicFrameCoverageByEntityType: indexBy(dynamicFrameCoverageCatalog.entityFrameCoverage || [], coverage => coverage.entityType),
  };

  const actorFamilies = (behaviorCatalog.links || [])
    .map(link => buildActorFamilyLink(context, link))
    .filter(Boolean)
    .sort((a, b) => (a.entityType || 0) - (b.entityType || 0));
  const seedGroups = buildSeedGroups(actorFamilies);
  const allTags = actorFamilies.flatMap(actor => actor.targetSemantics.semanticTags || []);
  const allHelpers = actorFamilies.flatMap(actor => Object.entries(actor.targetSemantics.helperCallLabelCounts || {})
    .flatMap(([label, count]) => Array.from({ length: count }, () => label)));
  const missingActors = actorFamilies.filter(actor => actor.c3c0Seed.missingBehaviorListSources.length > 0);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      behaviorCatalogId,
      frameAssetCatalogId,
      dynamicTileCatalogId,
      dynamicFrameCoverageCatalogId,
      seedFamilyCatalogId,
      seedTargetCatalogId,
      targetSemanticsCatalogId,
    ],
    summary: {
      rawEntityTypeCount: actorFamilies.length,
      selectorTypeCount: unique(actorFamilies.map(actor => actor.dispatchSelector.entityTypeHex)).length,
      directSeedEntityTypeCount: actorFamilies.filter(actor => actor.c3c0Seed.seedResolution === 'direct_seed_label').length,
      tailSeedEntityTypeCount: actorFamilies.filter(actor => actor.c3c0Seed.seedResolution === 'init_head_tail_seed').length,
      highBitVariantCount: actorFamilies.filter(actor => actor.dispatchSelector.highBitVariant).length,
      seedRoutineCount: unique(actorFamilies.map(actor => actor.c3c0Seed.effectiveSeedLabel)).length,
      seedGroupCount: seedGroups.length,
      behaviorListSourceExpressionCount: unique(actorFamilies.flatMap(actor => actor.c3c0Seed.behaviorListSourceExpressions)).length,
      behaviorListLinkedEntityTypeCount: actorFamilies.filter(actor => actor.c3c0Seed.linkedBehaviorListSourceCount > 0).length,
      missingBehaviorListSourceEntityTypeCount: missingActors.length,
      targetLinkedEntityTypeCount: actorFamilies.filter(actor => actor.c3c0Seed.targetEntryCount > 0).length,
      targetEntryReferenceCount: actorFamilies.reduce((sum, actor) => sum + actor.c3c0Seed.targetEntryCount, 0),
      uniqueTargetOffsetCount: unique(actorFamilies.flatMap(actor => actor.c3c0Seed.targetOffsets)).length,
      uniqueTargetRegionCount: unique(actorFamilies.flatMap(actor => actor.c3c0Seed.targetRegionIds)).length,
      actorTypesWithKnownHelperCalls: actorFamilies.filter(actor => actor.targetSemantics.targetCountWithKnownHelperCalls > 0).length,
      actorTypesWithPackedMotionDeltaConsumer: actorFamilies.filter(actor => actor.targetSemantics.targetCountWithPackedMotionDeltaConsumer > 0).length,
      actorTypesWithVelocityIntegrator: actorFamilies.filter(actor => actor.targetSemantics.targetCountWithVelocityIntegrator > 0).length,
      actorTypesWithCollisionPipeline: actorFamilies.filter(actor => actor.targetSemantics.targetCountWithCollisionPipeline > 0).length,
      actorTypesWithAnimationTick: actorFamilies.filter(actor => actor.targetSemantics.targetCountWithAnimationTick > 0).length,
      actorTypesWithBehaviorStateWrite: actorFamilies.filter(actor => actor.targetSemantics.targetCountWithBehaviorStateWrite > 0).length,
      frameLinkedEntityTypeCount: actorFamilies.filter(actor => actor.frameAsset?.status === 'linked_high_confidence_frame_subrecords').length,
      dynamicTileLinkedEntityTypeCount: actorFamilies.filter(actor => actor.dynamicTile && !actor.dynamicTile.zeroPadding).length,
      dynamicUploadedEntityTypeCount: actorFamilies.filter(actor => actor.dynamicUpload).length,
      fullyCoveredEntityTypeCount: actorFamilies.filter(actor => actor.dynamicFrameCoverage?.coverageStatus === 'all_observed_uploads_cover_frame_tiles').length,
      partialCoverageEntityTypeCount: actorFamilies.filter(actor => actor.dynamicFrameCoverage?.coverageStatus === 'needs_frame_tile_base_trace').length,
      noHighConfidenceFrameAssetEntityTypeCount: actorFamilies.filter(actor => actor.frameAsset?.status === 'dispatch_entry_without_animation_start').length,
      semanticTagCounts: countBy(allTags, tag => tag),
      helperCallLabelCounts: countBy(allHelpers, label => label),
      warningActorTypeCount: actorFamilies.filter(actor =>
        actor.c3c0Seed.missingBehaviorListSources.length > 0 || actor.targetSemantics.warningTargetCount > 0
      ).length,
      persistedRomByteCount: 0,
      persistedCoordinateCount: 0,
      persistedPixelCount: 0,
      persistedGameplayValueCount: 0,
      assetPolicy: 'Metadata only: raw entity type ids, dispatch labels, initializer/seed labels, behavior-list source labels, target offsets, region ids, frame/dynamic tile counts, tile-slot ranges, semantic tags, and evidence. No ROM bytes, decoded graphics, sprite coordinates, pixels, screenshots, music, text, or gameplay tables are embedded.',
    },
    actorFamilies,
    seedGroups,
    missingBehaviorListSourceActors: missingActors.map(actor => ({
      entityTypeHex: actor.entityTypeHex,
      dispatchLabel: actor.dispatch.label,
      effectiveSeedLabel: actor.c3c0Seed.effectiveSeedLabel,
      missingBehaviorListSources: actor.c3c0Seed.missingBehaviorListSources,
      confidence: actor.confidence,
      evidence: actor.evidence.slice(0, 3),
    })),
    evidence: [
      `${behaviorCatalogId} supplies raw room entity type to dispatch/initializer links.`,
      `${seedFamilyCatalogId} identifies C3C0 initializer seed routines and behavior-list source expressions.`,
      `${seedTargetCatalogId} links decoded behavior-list sources to target offsets, and ${targetSemanticsCatalogId} supplies bounded-scan target semantics.`,
      `${frameAssetCatalogId}, ${dynamicTileCatalogId}, and ${dynamicFrameCoverageCatalogId} supply metadata-only graphics/dynamic-upload coverage for each raw type.`,
    ],
    nextLeads: [
      'Decode the missing _DATA_6AFA_ behavior-list source used by _LABEL_6AC8_ and join it to the shared _LABEL_6ACF_ seed tail.',
      'Use the actor family groups with partial dynamic frame coverage to prioritize tile-base traces for entity types whose behavior and frame assets are already linked.',
      'Select one fully covered actor family and build a small frame-step JS model that replays IX+30/IX+31 motion deltas, velocity integration, collision helper calls, and animation ticks from catalog metadata.',
    ],
  };
}

function annotateSeedRegion(region, group) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.c3c0ActorFamilyAudit = {
    catalogId,
    kind: 'c3c0_actor_family_seed_region',
    confidence: group.confidence,
    seedLabel: group.seedLabel,
    seedResolution: group.seedResolution,
    rawEntityTypeCount: group.rawEntityTypeCount,
    rawEntityTypes: group.rawEntityTypes,
    behaviorListSourceExpressions: group.behaviorListSourceExpressions,
    targetOffsetCount: group.targetOffsetCount,
    targetRegionIds: group.targetRegionIds,
    semanticTags: group.semanticTags,
    frameLinkedEntityTypeCount: group.frameLinkedEntityTypeCount,
    dynamicUploadedEntityTypeCount: group.dynamicUploadedEntityTypeCount,
    fullyCoveredEntityTypeCount: group.fullyCoveredEntityTypeCount,
    needsTraceEntityTypeCount: group.needsTraceEntityTypeCount,
    missingBehaviorListSourceEntityTypes: group.missingBehaviorListSourceEntityTypes,
    persistedRomByteCount: 0,
    persistedCoordinateCount: 0,
    persistedPixelCount: 0,
    persistedGameplayValueCount: 0,
    summary: `${group.rawEntityTypeCount} raw room entity type(s) join this C3C0 seed group to ${group.targetOffsetCount} behavior target offset(s), ${group.frameLinkedEntityTypeCount} frame-linked type(s), and ${group.dynamicUploadedEntityTypeCount} observed dynamic-upload type(s).`,
    evidence: [
      `${behaviorCatalogId} raw entity dispatch labels resolve to ${group.seedLabel}.`,
      `${seedTargetCatalogId} and ${targetSemanticsCatalogId} provide target offset and semantic metadata for this seed group.`,
      `${frameAssetCatalogId} and ${dynamicFrameCoverageCatalogId} provide metadata-only frame/dynamic-upload coverage counts.`,
    ],
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    seedLabel: group.seedLabel,
    rawEntityTypeCount: group.rawEntityTypeCount,
    targetOffsetCount: group.targetOffsetCount,
    frameLinkedEntityTypeCount: group.frameLinkedEntityTypeCount,
    dynamicUploadedEntityTypeCount: group.dynamicUploadedEntityTypeCount,
    confidence: group.confidence,
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityBehaviorCatalogs.push(catalog);

  const annotatedSeedRegions = [];
  const annotatedRegionIds = new Set();
  for (const group of catalog.seedGroups || []) {
    const offset = parseHex(group.seedRegion?.offset);
    const region = offset == null ? null : findContainingRegion(mapData, offset);
    if (!region || annotatedRegionIds.has(region.id)) continue;
    const mergedGroup = {
      ...group,
      rawEntityTypeCount: catalog.seedGroups
        .filter(item => item.seedRegion?.id === group.seedRegion?.id)
        .reduce((sum, item) => sum + item.rawEntityTypeCount, 0),
      rawEntityTypes: unique(catalog.seedGroups
        .filter(item => item.seedRegion?.id === group.seedRegion?.id)
        .flatMap(item => item.rawEntityTypes)),
      behaviorListSourceExpressions: unique(catalog.seedGroups
        .filter(item => item.seedRegion?.id === group.seedRegion?.id)
        .flatMap(item => item.behaviorListSourceExpressions)),
      targetOffsetCount: unique(catalog.seedGroups
        .filter(item => item.seedRegion?.id === group.seedRegion?.id)
        .flatMap(item => item.targetOffsets)).length,
      targetRegionIds: unique(catalog.seedGroups
        .filter(item => item.seedRegion?.id === group.seedRegion?.id)
        .flatMap(item => item.targetRegionIds)),
      semanticTags: unique(catalog.seedGroups
        .filter(item => item.seedRegion?.id === group.seedRegion?.id)
        .flatMap(item => item.semanticTags)),
      frameLinkedEntityTypeCount: catalog.seedGroups
        .filter(item => item.seedRegion?.id === group.seedRegion?.id)
        .reduce((sum, item) => sum + item.frameLinkedEntityTypeCount, 0),
      dynamicUploadedEntityTypeCount: catalog.seedGroups
        .filter(item => item.seedRegion?.id === group.seedRegion?.id)
        .reduce((sum, item) => sum + item.dynamicUploadedEntityTypeCount, 0),
      fullyCoveredEntityTypeCount: catalog.seedGroups
        .filter(item => item.seedRegion?.id === group.seedRegion?.id)
        .reduce((sum, item) => sum + item.fullyCoveredEntityTypeCount, 0),
      needsTraceEntityTypeCount: catalog.seedGroups
        .filter(item => item.seedRegion?.id === group.seedRegion?.id)
        .reduce((sum, item) => sum + item.needsTraceEntityTypeCount, 0),
      missingBehaviorListSourceEntityTypes: unique(catalog.seedGroups
        .filter(item => item.seedRegion?.id === group.seedRegion?.id)
        .flatMap(item => item.missingBehaviorListSourceEntityTypes)),
      confidence: catalog.seedGroups
        .filter(item => item.seedRegion?.id === group.seedRegion?.id)
        .some(item => item.confidence !== 'high') ? 'medium' : 'high',
    };
    const annotated = annotateSeedRegion(region, mergedGroup);
    if (annotated) {
      annotatedSeedRegions.push(annotated);
      annotatedRegionIds.add(region.id);
    }
  }

  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_c3c0_actor_family_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    summary: {
      ...catalog.summary,
      annotatedSeedRegionCount: annotatedSeedRegions.length,
    },
    annotatedSeedRegions,
    missingBehaviorListSourceActors: catalog.missingBehaviorListSourceActors,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });

  fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  return { annotatedSeedRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const applied = apply ? applyCatalog(mapData, catalog) : { annotatedSeedRegions: [] };
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedSeedRegionCount: applied.annotatedSeedRegions.length,
    },
    seedGroups: catalog.seedGroups.map(group => ({
      seedLabel: group.seedLabel,
      sourceExpressions: group.behaviorListSourceExpressions,
      rawEntityTypeCount: group.rawEntityTypeCount,
      targetOffsetCount: group.targetOffsetCount,
      frameLinkedEntityTypeCount: group.frameLinkedEntityTypeCount,
      dynamicUploadedEntityTypeCount: group.dynamicUploadedEntityTypeCount,
      confidence: group.confidence,
    })),
    missingBehaviorListSourceActors: catalog.missingBehaviorListSourceActors,
  }, null, 2));
}

main();
