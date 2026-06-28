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
const catalogId = 'world-room-entity-frame-tile-gap-catalog-2026-06-26';
const reportId = 'room-entity-frame-tile-gap-audit-2026-06-26';
const toolName = 'tools/world-room-entity-frame-tile-gap-audit.mjs';

const sourceCatalogIds = {
  dynamicFrameCoverage: 'world-room-entity-dynamic-frame-coverage-catalog-2026-06-25',
  tracePriority: 'world-room-entity-frame-trace-priority-catalog-2026-06-25',
  tileBase: 'world-animation-tile-base-catalog-2026-06-25',
  oamSemantics: 'world-metasprite-oam-writer-semantics-catalog-2026-06-25',
};

const gapStatuses = new Set([
  'partial_dynamic_upload_coverage',
  'frame_tiles_outside_dynamic_upload',
]);

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

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function hex(value, pad = 2) {
  return '0x' + (value >>> 0).toString(16).toUpperCase().padStart(pad, '0');
}

function byCountDescThenKey(a, b) {
  return b.count - a.count || String(a.key).localeCompare(String(b.key));
}

function bump(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function countObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function topCounts(map, limit = 12) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort(byCountDescThenKey)
    .slice(0, limit);
}

function segmentValues(segments) {
  const values = [];
  for (const segment of segments || []) {
    const start = parseHex(segment.start);
    const end = parseHex(segment.end);
    if (start == null || end == null) continue;
    values.push({ start, end, count: Math.max(0, end - start + 1) });
  }
  return values;
}

function classifyGap(check) {
  const range = check.dynamicAssignedTileRange || {};
  const start = parseHex(range.start);
  const end = parseHex(range.end);
  const assignedCount = Number(range.count || 0);
  const frameRange = check.frameTileByteRange || {};
  const finalRange = check.finalTileRange || {};
  const frameUniqueCount = Number(frameRange.uniqueCount || 0);
  const frameMax = parseHex(frameRange.max);
  const finalMin = parseHex(finalRange.min);
  const finalMax = parseHex(finalRange.max);
  const segments = segmentValues(check.uncoveredFinalTileSegments || []);

  let belowAssignedRangeCount = 0;
  let aboveAssignedRangeCount = 0;
  let insideAssignedRangeCount = 0;
  for (const segment of segments) {
    if (start != null && segment.end < start) belowAssignedRangeCount += segment.count;
    else if (end != null && segment.start > end) aboveAssignedRangeCount += segment.count;
    else insideAssignedRangeCount += segment.count;
  }

  let kind = 'unknown_frame_tile_gap';
  if (aboveAssignedRangeCount && belowAssignedRangeCount) kind = 'mixed_above_and_below_dynamic_upload_range';
  else if (aboveAssignedRangeCount) kind = 'frame_tiles_above_dynamic_upload_range';
  else if (belowAssignedRangeCount) kind = 'frame_tiles_below_dynamic_upload_range';
  else if (insideAssignedRangeCount) kind = 'uncovered_segments_overlap_dynamic_upload_range';

  const frameSpanExceedsUpload = frameUniqueCount > assignedCount || (frameMax != null && assignedCount && frameMax >= assignedCount);
  const finalSpanExceedsUpload = start != null && end != null && (
    (finalMax != null && finalMax > end) || (finalMin != null && finalMin < start)
  );
  const likelyNeedsAdditionalTileSource = frameSpanExceedsUpload || finalSpanExceedsUpload;

  return {
    kind,
    confidence: kind === 'unknown_frame_tile_gap' ? 'low' : 'medium_high',
    assignedCount,
    frameUniqueCount,
    uncoveredUniqueTileCount: Number(check.uncoveredUniqueTileCount || 0),
    coveredUniqueTileCount: Number(check.coveredUniqueTileCount || 0),
    belowAssignedRangeCount,
    aboveAssignedRangeCount,
    insideAssignedRangeCount,
    frameSpanExceedsUpload,
    finalSpanExceedsUpload,
    likelyNeedsAdditionalTileSource,
    reason: likelyNeedsAdditionalTileSource
      ? 'Frame tile ids extend beyond the dynamic upload range proven for the room entity instance; keep static/additional source provenance unresolved.'
      : 'The dynamic upload range and frame tile id relationship is still not fully explained by existing metadata.',
  };
}

function compactDynamicTile(dynamicTile) {
  if (!dynamicTile) return null;
  const streamRegion = dynamicTile.streamRegion || {};
  return {
    tableId: dynamicTile.tableId || '',
    entryOffset: dynamicTile.entryOffset || '',
    remapRow: Number(dynamicTile.remapRow || 0),
    streamRomOffset: dynamicTile.streamRomOffset || '',
    streamRegionId: dynamicTile.streamRegionId || streamRegion.id || '',
    streamRegionType: dynamicTile.streamRegionType || streamRegion.type || '',
    zeroPadding: Boolean(dynamicTile.zeroPadding),
  };
}

function buildCatalog(mapData) {
  const dynamicFrameCoverage = requireCatalog(mapData, sourceCatalogIds.dynamicFrameCoverage);
  const tracePriority = requireCatalog(mapData, sourceCatalogIds.tracePriority);
  const tileBase = requireCatalog(mapData, sourceCatalogIds.tileBase);
  const oamSemantics = requireCatalog(mapData, sourceCatalogIds.oamSemantics);

  const coverageByEntityType = new Map((dynamicFrameCoverage.entityFrameCoverage || []).map(item => [item.entityType, item]));
  const priorityByEntityType = new Map((tracePriority.priorities || tracePriority.samplePriorities || []).map(item => [item.entityType, item]));
  const gapChecks = (dynamicFrameCoverage.roomUploadChecks || []).filter(check => gapStatuses.has(check.status));
  const checksByEntityType = new Map();
  const classificationCounts = new Map();
  const streamRegionCounts = new Map();
  const streamRegionEntityTypes = new Map();
  let totalUncoveredUniqueTileRefs = 0;
  let totalCoveredUniqueTileRefs = 0;
  let likelyAdditionalSourceUploadCount = 0;

  for (const check of gapChecks) {
    const classification = classifyGap(check);
    check._classification = classification;
    bump(classificationCounts, classification.kind);
    totalUncoveredUniqueTileRefs += classification.uncoveredUniqueTileCount;
    totalCoveredUniqueTileRefs += classification.coveredUniqueTileCount;
    if (classification.likelyNeedsAdditionalTileSource) likelyAdditionalSourceUploadCount++;
    if (!checksByEntityType.has(check.entityType)) checksByEntityType.set(check.entityType, []);
    checksByEntityType.get(check.entityType).push(check);
  }

  const entities = [...checksByEntityType.entries()].map(([entityType, checks]) => {
    const coverage = coverageByEntityType.get(entityType) || {};
    const priority = priorityByEntityType.get(entityType) || {};
    const dynamicTile = compactDynamicTile(priority.dynamicTile || coverage.dynamicTile);
    if (dynamicTile?.streamRegionId) {
      bump(streamRegionCounts, dynamicTile.streamRegionId, checks.length);
      if (!streamRegionEntityTypes.has(dynamicTile.streamRegionId)) streamRegionEntityTypes.set(dynamicTile.streamRegionId, new Set());
      streamRegionEntityTypes.get(dynamicTile.streamRegionId).add(entityType);
    }
    const entityClassificationCounts = new Map();
    let uncoveredUniqueTileRefs = 0;
    let coveredUniqueTileRefs = 0;
    let likelyAdditionalSourceCount = 0;
    for (const check of checks) {
      const classification = check._classification;
      bump(entityClassificationCounts, classification.kind);
      uncoveredUniqueTileRefs += classification.uncoveredUniqueTileCount;
      coveredUniqueTileRefs += classification.coveredUniqueTileCount;
      if (classification.likelyNeedsAdditionalTileSource) likelyAdditionalSourceCount++;
    }
    return {
      entityType,
      selectorTypeHex: coverage.selectorTypeHex || priority.selectorTypeHex || '',
      priorityRank: Number(priority.priorityRank || 0),
      highBitVariant: Boolean(coverage.highBitVariant || priority.highBitVariant),
      usageClass: coverage.usageClass || priority.usageClass || '',
      uploadGapCount: checks.length,
      uncoveredUniqueTileRefs,
      coveredUniqueTileRefs,
      likelyAdditionalSourceCount,
      classificationCounts: countObject(entityClassificationCounts),
      frameAsset: coverage.frameAsset || priority.frameAsset || null,
      dynamicTile,
      traceTargets: priority.traceTargets || [],
      sampleGaps: checks.slice(0, 10).map(check => ({
        subrecordIndex: check.subrecordIndex,
        status: check.status,
        classification: check._classification,
        dynamicAssignedTileRange: check.dynamicAssignedTileRange || null,
        frameTileByteRange: check.frameTileByteRange || null,
        finalTileRange: check.finalTileRange || null,
        uncoveredFinalTileSegments: check.uncoveredFinalTileSegments || [],
      })),
      confidence: 'medium',
      evidence: [
        'world-room-entity-dynamic-frame-coverage-catalog-2026-06-25 supplies the partial upload checks.',
        'world-room-entity-frame-trace-priority-catalog-2026-06-25 supplies entity priority, dynamic stream metadata, and trace targets.',
        'world-animation-tile-base-catalog-2026-06-25 confirms room entity tile base is copied from IY+5 to IX+63.',
        'world-metasprite-oam-writer-semantics-catalog-2026-06-25 confirms _LABEL_792_ adds IX+63 to frame tile bytes before OAM output.',
      ],
    };
  }).sort((a, b) =>
    (a.priorityRank || 9999) - (b.priorityRank || 9999) ||
    b.uploadGapCount - a.uploadGapCount ||
    a.entityType.localeCompare(b.entityType)
  );

  const streamRegions = [...streamRegionCounts.entries()]
    .map(([regionId, gapUploadCount]) => ({
      regionId,
      gapUploadCount,
      entityTypes: [...(streamRegionEntityTypes.get(regionId) || new Set())].sort(),
    }))
    .sort((a, b) => b.gapUploadCount - a.gapUploadCount || a.regionId.localeCompare(b.regionId));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    summary: {
      gapEntityTypeCount: entities.length,
      gapUploadCount: gapChecks.length,
      likelyAdditionalSourceUploadCount,
      totalUncoveredUniqueTileRefs,
      totalCoveredUniqueTileRefs,
      classificationCounts: countObject(classificationCounts),
      topStreamRegions: topCounts(streamRegionCounts, 8),
      tileBaseWriterCatalogBacked: tileBase.summary?.roomEntityRecordTileBaseWrites === 1,
      oamTileBaseField: oamSemantics.summary?.tileBaseField || 'IX+63',
      persistedRomByteCount: 0,
      persistedTileByteCount: 0,
      persistedPixelCount: 0,
      persistedCoordinateCount: 0,
      assetPolicy: 'Metadata only: entity type ids, upload counts, tile-slot ranges, gap classifications, stream region ids, trace labels, and evidence. No ROM bytes, decoded sprites, graphics, pixels, screenshots, coordinates, music, text, or gameplay payloads are embedded.',
    },
    streamRegions,
    entities,
    evidence: [
      'Partial upload checks come from world-room-entity-dynamic-frame-coverage-catalog-2026-06-25.',
      '_LABEL_65B9_ copies the room entity record tile-base byte from IY+5 to IX+63.',
      '_LABEL_792_ adds IX+63 to each frame-stream tile byte before writing the OAM tile id.',
      'This catalog intentionally does not mark gaps renderable; it separates dynamic upload coverage gaps from static/additional source provenance that still needs tracing.',
    ],
    nextLeads: [
      'Trace static/common sprite tile preload sources for the highest-ranked gap entities before enabling sprite render previews for them.',
      'Start with entity 0x8A and 0x83 because they have many repeated partial uploads and high-confidence frame assets.',
      'When a static or additional upload source is confirmed, extend dynamic-frame coverage to include that source family instead of weakening the current dynamic-only coverage rule.',
    ],
  };
}

function annotateRegions(mapData, catalog) {
  const byId = new Map((mapData.regions || []).map(region => [region.id, region]));
  let annotated = 0;
  for (const stream of catalog.streamRegions) {
    const region = byId.get(stream.regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.roomEntityFrameTileGapAudit = {
      catalogId,
      gapUploadCount: stream.gapUploadCount,
      entityTypes: stream.entityTypes,
      confidence: 'medium',
      evidence: [
        'world-room-entity-frame-tile-gap-catalog-2026-06-26 links this dynamic tile stream region to room entity frame tile gaps.',
        'The gaps are dynamic-upload coverage gaps only; no static/additional source is claimed here.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated++;
  }
  return annotated;
}

function applyCatalog(mapData, catalog) {
  mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(item => item.id !== catalogId);
  mapData.metaspriteCatalogs.push(catalog);
  const annotatedStreamRegionCount = annotateRegions(mapData, catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'room_entity_frame_tile_gap_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedStreamRegionCount,
    },
    topEntities: catalog.entities.slice(0, 12).map(entity => ({
      entityType: entity.entityType,
      selectorTypeHex: entity.selectorTypeHex,
      priorityRank: entity.priorityRank,
      uploadGapCount: entity.uploadGapCount,
      uncoveredUniqueTileRefs: entity.uncoveredUniqueTileRefs,
      dynamicStreamRegionId: entity.dynamicTile?.streamRegionId || '',
      classificationCounts: entity.classificationCounts,
    })),
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
  return annotatedStreamRegionCount;
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let annotatedStreamRegionCount = 0;
  if (apply) {
    annotatedStreamRegionCount = applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    id: catalog.id,
    summary: {
      ...catalog.summary,
      annotatedStreamRegionCount,
    },
    topEntities: catalog.entities.slice(0, 8).map(entity => ({
      entityType: entity.entityType,
      selectorTypeHex: entity.selectorTypeHex,
      priorityRank: entity.priorityRank,
      uploadGapCount: entity.uploadGapCount,
      uncoveredUniqueTileRefs: entity.uncoveredUniqueTileRefs,
      dynamicTile: entity.dynamicTile,
      classificationCounts: entity.classificationCounts,
      sampleGaps: entity.sampleGaps.slice(0, 2).map(gap => ({
        subrecordIndex: gap.subrecordIndex,
        status: gap.status,
        classificationKind: gap.classification.kind,
        assignedCount: gap.classification.assignedCount,
        frameUniqueCount: gap.classification.frameUniqueCount,
        coveredUniqueTileCount: gap.classification.coveredUniqueTileCount,
        uncoveredUniqueTileCount: gap.classification.uncoveredUniqueTileCount,
        likelyNeedsAdditionalTileSource: gap.classification.likelyNeedsAdditionalTileSource,
        dynamicAssignedTileRange: gap.dynamicAssignedTileRange,
        finalTileRange: gap.finalTileRange,
        uncoveredSegmentCount: gap.uncoveredFinalTileSegments.length,
        uncoveredFinalTileSegmentsSample: gap.uncoveredFinalTileSegments.slice(0, 4),
      })),
    })),
  }, null, 2));
}

main();
