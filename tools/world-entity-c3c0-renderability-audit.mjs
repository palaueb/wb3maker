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
const catalogId = 'world-entity-c3c0-renderability-catalog-2026-06-25';
const reportId = 'entity-c3c0-renderability-audit-2026-06-25';
const toolName = 'tools/world-entity-c3c0-renderability-audit.mjs';

const sourceCatalogIds = {
  actorFamily: 'world-entity-c3c0-actor-family-catalog-2026-06-25',
  dynamicFrameCoverage: 'world-room-entity-dynamic-frame-coverage-catalog-2026-06-25',
  frameTracePriority: 'world-room-entity-frame-trace-priority-catalog-2026-06-25',
  frameSubrecordCoverage: 'world-room-entity-frame-subrecord-coverage-catalog-2026-06-25',
  renderableFrameFixture: 'world-room-entity-renderable-frame-fixture-catalog-2026-06-25',
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
    if (key) map.set(key, item);
  }
  return map;
}

function compactRange(range) {
  if (!range) return null;
  return {
    count: Number(range.count || 0),
    min: range.min || null,
    max: range.max || null,
    uniqueCount: Number(range.uniqueCount || 0),
  };
}

function compactFrameAsset(frameAsset) {
  if (!frameAsset) return null;
  return {
    status: frameAsset.status || '',
    subrecordCount: Number(frameAsset.subrecordCount || 0),
    frameRegionCount: Number(frameAsset.frameRegionCount || 0),
    pieceRecordCount: Number(frameAsset.pieceRecordCount || 0),
    referenceCount: Number(frameAsset.referenceCount || 0),
    confidence: frameAsset.confidence || '',
    regionIds: frameAsset.regionIds || [],
  };
}

function compactDynamicTile(dynamicTile) {
  if (!dynamicTile) return null;
  return {
    tableId: dynamicTile.tableId || '',
    entryOffset: dynamicTile.entryOffset || '',
    remapRow: dynamicTile.remapRow ?? null,
    streamRomOffset: dynamicTile.streamRomOffset || '',
    streamRegionId: dynamicTile.streamRegion?.id || dynamicTile.streamRegionId || '',
    zeroPadding: Boolean(dynamicTile.zeroPadding),
  };
}

function renderabilityStatus(actor, subrecordEntity, fixtureEntity) {
  const frameStatus = actor.frameAsset?.status || '';
  const coverageStatus = actor.dynamicFrameCoverage?.coverageStatus || '';
  if (frameStatus !== 'linked_high_confidence_frame_subrecords') return 'no_high_confidence_frame_asset';
  if (!actor.dynamicUpload) return 'frame_linked_without_observed_dynamic_upload';
  if (coverageStatus === 'all_observed_uploads_cover_frame_tiles') return 'fully_dynamic_upload_renderable';
  if (coverageStatus === 'needs_frame_tile_base_trace') {
    if (Number(subrecordEntity?.renderableWithoutAdditionalTileTraceSubrecordCount || 0) > 0) {
      return 'partially_dynamic_upload_renderable';
    }
    return 'blocked_pending_tile_base_trace';
  }
  if (fixtureEntity?.fixtureCount) return 'fixture_allowlist_renderable';
  return coverageStatus || 'unclassified_renderability';
}

function frameStepCandidateScore(actor) {
  const status = actor.renderabilityStatus;
  if (status !== 'fully_dynamic_upload_renderable') return 0;
  const tags = new Set(actor.targetSemantics?.semanticTags || []);
  let score = 100000;
  if (tags.has('collision_pipeline')) score += 20000;
  if (tags.has('velocity_integrator')) score += 10000;
  if (tags.has('animation_tick')) score += 5000;
  if (tags.has('behavior_state_write')) score += 5000;
  score += Number(actor.dynamicFrameCoverage?.uploadCount || 0) * 1000;
  score += Number(actor.frameAsset?.subrecordCount || 0) * 100;
  score += Number(actor.frameAsset?.pieceRecordCount || 0);
  return score;
}

function compactSubrecordSummary(entity) {
  if (!entity) return null;
  return {
    frameSubrecordCount: Number(entity.frameSubrecordCount || 0),
    renderableWithoutAdditionalTileTraceSubrecordCount: Number(entity.renderableWithoutAdditionalTileTraceSubrecordCount || 0),
    dynamicCoveredSubrecordCount: Number(entity.dynamicCoveredSubrecordCount || 0),
    emptyFrameSubrecordCount: Number(entity.emptyFrameSubrecordCount || 0),
    mixedOrPartialSubrecordCount: Number(entity.mixedOrPartialSubrecordCount || 0),
    notCoveredSubrecordCount: Number(entity.notCoveredSubrecordCount || 0),
    dynamicCoveredFramePercent: Number(entity.dynamicCoveredFramePercent || 0),
    status: entity.status || '',
  };
}

function compactFixtureSummary(entity) {
  if (!entity) return null;
  return {
    fixtureCount: Number(entity.fixtureCount || 0),
    dynamicUploadBackedFixtureCount: Number(entity.dynamicUploadBackedFixtureCount || 0),
    emptyFrameFixtureCount: Number(entity.emptyFrameFixtureCount || 0),
    blockedSubrecordCount: Number(entity.blockedSubrecordCount || 0),
    partialSubrecordCount: Number(entity.partialSubrecordCount || 0),
    sampleFixtureIds: (entity.fixtures || []).slice(0, 6).map(fixture => fixture.fixtureId),
  };
}

function buildActorEntry(actor, indexes) {
  const tracePriority = indexes.traceByEntity.get(actor.entityTypeHex) || null;
  const subrecordEntity = indexes.subrecordByEntity.get(actor.entityTypeHex) || null;
  const fixtureEntity = indexes.fixtureByEntity.get(actor.entityTypeHex) || null;
  const status = renderabilityStatus(actor, subrecordEntity, fixtureEntity);
  const dynamicCoverage = actor.dynamicFrameCoverage || null;
  const entry = {
    entityType: actor.entityTypeHex,
    selectorTypeHex: actor.dispatchSelector?.entityTypeHex || '',
    highBitVariant: Boolean(actor.dispatchSelector?.highBitVariant),
    usageClass: actor.usageClass || '',
    seedLabel: actor.c3c0Seed?.effectiveSeedLabel || '',
    seedRegion: actor.c3c0Seed?.seedRegion || null,
    seedResolution: actor.c3c0Seed?.seedResolution || '',
    behaviorListSourceExpressions: actor.c3c0Seed?.behaviorListSourceExpressions || [],
    renderabilityStatus: status,
    frameAsset: compactFrameAsset(actor.frameAsset),
    dynamicTile: compactDynamicTile(actor.dynamicTile),
    dynamicUpload: actor.dynamicUpload || null,
    dynamicFrameCoverage: dynamicCoverage
      ? {
          coverageStatus: dynamicCoverage.coverageStatus || '',
          uploadCount: Number(dynamicCoverage.uploadCount || 0),
          coveredUploadCount: Number(dynamicCoverage.coveredUploadCount || 0),
          partialCoverageUploadCount: Number(dynamicCoverage.partialCoverageUploadCount || 0),
          noFrameAssetUploadCount: Number(dynamicCoverage.noFrameAssetUploadCount || 0),
          assignedTileCountRange: {
            min: Number(dynamicCoverage.minAssignedTileCount || 0),
            max: Number(dynamicCoverage.maxAssignedTileCount || 0),
          },
          frameTileByteRange: compactRange(dynamicCoverage.frameTileByteRange),
        }
      : null,
    tracePriority: tracePriority
      ? {
          priorityRank: Number(tracePriority.priorityRank || 0),
          priorityScore: Number(tracePriority.priorityScore || 0),
          status: tracePriority.status || '',
          traceTargetLabels: (tracePriority.traceTargets || []).map(target => target.label),
        }
      : null,
    subrecordCoverage: compactSubrecordSummary(subrecordEntity),
    fixtureCoverage: compactFixtureSummary(fixtureEntity),
    targetSemantics: {
      semanticTags: actor.targetSemantics?.semanticTags || [],
      targetOffsetCount: Number(actor.targetSemantics?.targetOffsetCount || 0),
      targetRegionIds: actor.targetSemantics?.targetRegionIds || [],
      helperCallLabelCounts: actor.targetSemantics?.helperCallLabelCounts || {},
      warningTargetCount: Number(actor.targetSemantics?.warningTargetCount || 0),
    },
    frameStepCandidateScore: 0,
    persistedRomByteCount: 0,
    persistedTileByteCount: 0,
    persistedPixelCount: 0,
    persistedCoordinateCount: 0,
    persistedGameplayValueCount: 0,
    evidence: [
      `${sourceCatalogIds.actorFamily} links ${actor.entityTypeHex} to C3C0 seed ${actor.c3c0Seed?.effectiveSeedLabel || '?'}.`,
      `${sourceCatalogIds.dynamicFrameCoverage} supplies dynamic upload/frame coverage status ${dynamicCoverage?.coverageStatus || 'none'}.`,
      subrecordEntity
        ? `${sourceCatalogIds.frameSubrecordCoverage} supplies per-frame-subrecord renderability counts for ${actor.entityTypeHex}.`
        : `${sourceCatalogIds.frameSubrecordCoverage} has no priority subrecord coverage entry for ${actor.entityTypeHex}.`,
      fixtureEntity
        ? `${sourceCatalogIds.renderableFrameFixture} supplies ${fixtureEntity.fixtureCount || 0} metadata-only renderable fixture(s).`
        : `${sourceCatalogIds.renderableFrameFixture} has no renderable fixture allowlist entry for ${actor.entityTypeHex}.`,
    ],
  };
  entry.frameStepCandidateScore = frameStepCandidateScore(entry);
  return entry;
}

function buildSeedGroups(actors) {
  const groups = new Map();
  for (const actor of actors) {
    const key = `${actor.seedLabel}|${actor.behaviorListSourceExpressions.join('+')}|${actor.seedResolution}`;
    if (!groups.has(key)) {
      groups.set(key, {
        seedLabel: actor.seedLabel,
        seedRegion: actor.seedRegion,
        seedResolution: actor.seedResolution,
        behaviorListSourceExpressions: actor.behaviorListSourceExpressions,
        actors: [],
      });
    }
    groups.get(key).actors.push(actor);
  }
  return [...groups.values()].map(group => ({
    seedLabel: group.seedLabel,
    seedRegion: group.seedRegion,
    seedResolution: group.seedResolution,
    behaviorListSourceExpressions: group.behaviorListSourceExpressions,
    actorTypeCount: group.actors.length,
    actorTypes: group.actors.map(actor => actor.entityType),
    statusCounts: countBy(group.actors, actor => actor.renderabilityStatus),
    fullyRenderableActorTypeCount: group.actors.filter(actor => actor.renderabilityStatus === 'fully_dynamic_upload_renderable').length,
    partiallyRenderableActorTypeCount: group.actors.filter(actor => actor.renderabilityStatus === 'partially_dynamic_upload_renderable').length,
    blockedActorTypeCount: group.actors.filter(actor => actor.renderabilityStatus === 'blocked_pending_tile_base_trace').length,
    noFrameAssetActorTypeCount: group.actors.filter(actor => actor.renderabilityStatus === 'no_high_confidence_frame_asset').length,
    topFrameStepCandidate: group.actors.slice()
      .filter(actor => actor.frameStepCandidateScore > 0)
      .sort((a, b) => b.frameStepCandidateScore - a.frameStepCandidateScore || String(a.entityType).localeCompare(String(b.entityType)))[0]?.entityType || '',
  })).sort((a, b) => (parseHex(a.seedRegion?.offset) || 0) - (parseHex(b.seedRegion?.offset) || 0)
    || a.behaviorListSourceExpressions.join('').localeCompare(b.behaviorListSourceExpressions.join('')));
}

function buildCatalog(mapData) {
  const actorCatalog = requireCatalog(mapData, sourceCatalogIds.actorFamily);
  const dynamicFrameCoverage = requireCatalog(mapData, sourceCatalogIds.dynamicFrameCoverage);
  const tracePriority = requireCatalog(mapData, sourceCatalogIds.frameTracePriority);
  const frameSubrecordCoverage = requireCatalog(mapData, sourceCatalogIds.frameSubrecordCoverage);
  const fixtureCatalog = requireCatalog(mapData, sourceCatalogIds.renderableFrameFixture);
  const oamSemantics = requireCatalog(mapData, sourceCatalogIds.oamSemantics);

  const indexes = {
    traceByEntity: indexBy(tracePriority.priorities || [], item => item.entityType),
    subrecordByEntity: indexBy(frameSubrecordCoverage.entities || [], item => item.entityType),
    fixtureByEntity: indexBy(fixtureCatalog.entities || [], item => item.entityType),
  };
  const actors = (actorCatalog.actorFamilies || [])
    .map(actor => buildActorEntry(actor, indexes))
    .sort((a, b) => (parseHex(a.entityType) || 0) - (parseHex(b.entityType) || 0));
  const seedGroups = buildSeedGroups(actors);
  const frameLinkedActors = actors.filter(actor => actor.frameAsset?.status === 'linked_high_confidence_frame_subrecords');
  const bestFrameStepCandidate = actors.slice()
    .filter(actor => actor.frameStepCandidateScore > 0)
    .sort((a, b) => b.frameStepCandidateScore - a.frameStepCandidateScore || String(a.entityType).localeCompare(String(b.entityType)))[0] || null;

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    summary: {
      actorTypeCount: actors.length,
      frameLinkedActorTypeCount: frameLinkedActors.length,
      dynamicUploadedActorTypeCount: actors.filter(actor => actor.dynamicUpload).length,
      fullyRenderableActorTypeCount: actors.filter(actor => actor.renderabilityStatus === 'fully_dynamic_upload_renderable').length,
      partiallyRenderableActorTypeCount: actors.filter(actor => actor.renderabilityStatus === 'partially_dynamic_upload_renderable').length,
      blockedPendingTileBaseTraceActorTypeCount: actors.filter(actor => actor.renderabilityStatus === 'blocked_pending_tile_base_trace').length,
      noHighConfidenceFrameAssetActorTypeCount: actors.filter(actor => actor.renderabilityStatus === 'no_high_confidence_frame_asset').length,
      frameLinkedWithoutObservedDynamicUploadActorTypeCount: actors.filter(actor => actor.renderabilityStatus === 'frame_linked_without_observed_dynamic_upload').length,
      renderableFixtureActorTypeCount: actors.filter(actor => actor.fixtureCoverage).length,
      renderableFixtureCount: actors.reduce((sum, actor) => sum + Number(actor.fixtureCoverage?.fixtureCount || 0), 0),
      dynamicUploadBackedFixtureCount: actors.reduce((sum, actor) => sum + Number(actor.fixtureCoverage?.dynamicUploadBackedFixtureCount || 0), 0),
      seedGroupCount: seedGroups.length,
      statusCounts: countBy(actors, actor => actor.renderabilityStatus),
      c3c0PartialTraceEntityTypes: actors
        .filter(actor => actor.renderabilityStatus === 'partially_dynamic_upload_renderable')
        .map(actor => actor.entityType),
      c3c0BlockedTraceEntityTypes: actors
        .filter(actor => actor.renderabilityStatus === 'blocked_pending_tile_base_trace')
        .map(actor => actor.entityType),
      bestFrameStepCandidate: bestFrameStepCandidate?.entityType || '',
      bestFrameStepCandidateSeed: bestFrameStepCandidate?.seedLabel || '',
      bestFrameStepCandidateScore: bestFrameStepCandidate?.frameStepCandidateScore || 0,
      oamTileBaseField: oamSemantics.summary?.tileBaseField || '',
      oamFrameStreamRoutine: oamSemantics.summary?.frameStreamRoutine || '',
      oamPositionProducerRoutine: oamSemantics.summary?.positionProducerRoutine || '',
      persistedRomByteCount: 0,
      persistedTileByteCount: 0,
      persistedPixelCount: 0,
      persistedCoordinateCount: 0,
      persistedGameplayValueCount: 0,
      assetPolicy: 'Metadata only: C3C0 actor type ids, seed labels, renderability statuses, frame/dynamic tile counts, tile-slot ranges, semantic tags, fixture ids, and evidence. No ROM bytes, decoded graphics, pixels, coordinates, screenshots, music, text, or gameplay tables are embedded.',
    },
    actors,
    seedGroups,
    bestFrameStepCandidate: bestFrameStepCandidate
      ? {
          entityType: bestFrameStepCandidate.entityType,
          selectorTypeHex: bestFrameStepCandidate.selectorTypeHex,
          seedLabel: bestFrameStepCandidate.seedLabel,
          seedRegion: bestFrameStepCandidate.seedRegion,
          behaviorListSourceExpressions: bestFrameStepCandidate.behaviorListSourceExpressions,
          frameStepCandidateScore: bestFrameStepCandidate.frameStepCandidateScore,
          renderabilityStatus: bestFrameStepCandidate.renderabilityStatus,
          targetSemantics: bestFrameStepCandidate.targetSemantics,
          frameAsset: bestFrameStepCandidate.frameAsset,
          dynamicTile: bestFrameStepCandidate.dynamicTile,
          dynamicFrameCoverage: bestFrameStepCandidate.dynamicFrameCoverage,
          evidence: [
            'Selected by scoring fully_dynamic_upload_renderable C3C0 actors with collision, velocity, animation, behavior-state, upload-count, and frame complexity metadata.',
            `${sourceCatalogIds.actorFamily}, ${sourceCatalogIds.dynamicFrameCoverage}, and ${sourceCatalogIds.oamSemantics} supply the linked evidence.`,
          ],
        }
      : null,
    evidence: [
      `${sourceCatalogIds.actorFamily} links raw room entity types to C3C0 behavior/seed families.`,
      `${sourceCatalogIds.dynamicFrameCoverage} supplies entity-level dynamic-upload/frame coverage status.`,
      `${sourceCatalogIds.frameSubrecordCoverage} and ${sourceCatalogIds.renderableFrameFixture} supply per-frame-subrecord renderability for priority actors.`,
      `${sourceCatalogIds.oamSemantics} confirms the IX+63 tile-base field and OAM frame stream path used by renderable fixtures.`,
    ],
    nextLeads: [
      'Use bestFrameStepCandidate as the first C3C0 actor for a small JavaScript frame-step model.',
      'Trace c3c0BlockedTraceEntityTypes against static preloads or alternate tile-base setup before enabling full sprite rendering for those actors.',
      'For c3c0PartialTraceEntityTypes, gate only the mixed/partial subrecords while allowing already-covered fixture subrecords in metadata-backed previews.',
    ],
  };
}

function annotateSeedRegion(region, group) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.c3c0RenderabilityAudit = {
    catalogId,
    kind: 'c3c0_actor_renderability_seed_group',
    confidence: group.blockedActorTypeCount ? 'medium' : 'high',
    seedLabel: group.seedLabel,
    seedResolution: group.seedResolution,
    behaviorListSourceExpressions: group.behaviorListSourceExpressions,
    actorTypeCount: group.actorTypeCount,
    actorTypes: group.actorTypes,
    statusCounts: group.statusCounts,
    fullyRenderableActorTypeCount: group.fullyRenderableActorTypeCount,
    partiallyRenderableActorTypeCount: group.partiallyRenderableActorTypeCount,
    blockedActorTypeCount: group.blockedActorTypeCount,
    noFrameAssetActorTypeCount: group.noFrameAssetActorTypeCount,
    topFrameStepCandidate: group.topFrameStepCandidate,
    persistedRomByteCount: 0,
    persistedTileByteCount: 0,
    persistedPixelCount: 0,
    persistedCoordinateCount: 0,
    persistedGameplayValueCount: 0,
    summary: `${group.actorTypeCount} C3C0 actor type(s) in this seed group: ${group.fullyRenderableActorTypeCount} fully renderable, ${group.partiallyRenderableActorTypeCount} partially renderable, ${group.blockedActorTypeCount} blocked by tile-base trace, ${group.noFrameAssetActorTypeCount} without high-confidence frame assets.`,
    evidence: [
      `${sourceCatalogIds.actorFamily} links this seed group to raw entity types.`,
      `${sourceCatalogIds.dynamicFrameCoverage} and ${sourceCatalogIds.frameSubrecordCoverage} supply renderability status counts.`,
    ],
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    seedLabel: group.seedLabel,
    actorTypeCount: group.actorTypeCount,
    statusCounts: group.statusCounts,
    topFrameStepCandidate: group.topFrameStepCandidate,
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityBehaviorCatalogs.push(catalog);

  const annotatedSeedRegions = [];
  const seenRegionIds = new Set();
  for (const group of catalog.seedGroups || []) {
    const offset = parseHex(group.seedRegion?.offset);
    const region = offset == null ? null : findContainingRegion(mapData, offset);
    if (!region || seenRegionIds.has(region.id)) continue;
    const relatedGroups = catalog.seedGroups.filter(item => item.seedRegion?.id === group.seedRegion?.id);
    const merged = {
      ...group,
      actorTypeCount: relatedGroups.reduce((sum, item) => sum + item.actorTypeCount, 0),
      actorTypes: unique(relatedGroups.flatMap(item => item.actorTypes)),
      behaviorListSourceExpressions: unique(relatedGroups.flatMap(item => item.behaviorListSourceExpressions)),
      statusCounts: countBy(relatedGroups.flatMap(item =>
        Object.entries(item.statusCounts).flatMap(([status, count]) => Array.from({ length: count }, () => status))
      ), status => status),
      fullyRenderableActorTypeCount: relatedGroups.reduce((sum, item) => sum + item.fullyRenderableActorTypeCount, 0),
      partiallyRenderableActorTypeCount: relatedGroups.reduce((sum, item) => sum + item.partiallyRenderableActorTypeCount, 0),
      blockedActorTypeCount: relatedGroups.reduce((sum, item) => sum + item.blockedActorTypeCount, 0),
      noFrameAssetActorTypeCount: relatedGroups.reduce((sum, item) => sum + item.noFrameAssetActorTypeCount, 0),
      topFrameStepCandidate: relatedGroups.find(item => item.topFrameStepCandidate)?.topFrameStepCandidate || '',
    };
    const annotated = annotateSeedRegion(region, merged);
    if (annotated) {
      annotatedSeedRegions.push(annotated);
      seenRegionIds.add(region.id);
    }
  }

  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_c3c0_renderability_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedSeedRegionCount: annotatedSeedRegions.length,
    },
    bestFrameStepCandidate: catalog.bestFrameStepCandidate,
    annotatedSeedRegions,
    sampleActors: catalog.actors
      .filter(actor => actor.renderabilityStatus !== 'no_high_confidence_frame_asset')
      .slice(0, 12),
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
    bestFrameStepCandidate: catalog.bestFrameStepCandidate,
    nonTrivialActors: catalog.actors
      .filter(actor => actor.renderabilityStatus !== 'no_high_confidence_frame_asset')
      .map(actor => ({
        entityType: actor.entityType,
        seedLabel: actor.seedLabel,
        renderabilityStatus: actor.renderabilityStatus,
        frameStepCandidateScore: actor.frameStepCandidateScore,
        fixtureCount: actor.fixtureCoverage?.fixtureCount || 0,
        dynamicCoverageStatus: actor.dynamicFrameCoverage?.coverageStatus || '',
      })),
  }, null, 2));
}

main();
