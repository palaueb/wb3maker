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
const catalogId = 'world-room-entity-renderable-frame-fixture-catalog-2026-06-25';
const reportId = 'room-entity-renderable-frame-fixture-audit-2026-06-25';
const toolName = 'tools/world-room-entity-renderable-frame-fixture-audit.mjs';

const sourceCatalogIds = {
  subrecordCoverage: 'world-room-entity-frame-subrecord-coverage-catalog-2026-06-25',
  tracePriority: 'world-room-entity-frame-trace-priority-catalog-2026-06-25',
  dynamicTiles: 'world-room-entity-dynamic-tile-catalog-2026-06-25',
  frameAssets: 'world-room-entity-frame-asset-link-catalog-2026-06-25',
};

const renderableStatuses = new Set([
  'all_observed_uploads_cover_frame_subrecord',
  'empty_frame_no_tile_coverage_required',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requireCatalog(mapData, key, id) {
  const catalog = (mapData[key] || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required catalog ${key}.${id}`);
  return catalog;
}

function fixtureStatus(subrecord) {
  if (subrecord.status === 'empty_frame_no_tile_coverage_required') return 'empty_frame_no_tile_upload_required';
  return 'dynamic_upload_backed';
}

function compactSubrecord(subrecord) {
  return {
    id: subrecord.subrecordId || '',
    offset: subrecord.offset || '',
    endOffsetInclusive: subrecord.endOffsetInclusive || '',
    sourceRegionId: subrecord.regionId || '',
    pieceRecordCount: Number(subrecord.pieceRecordCount || 0),
    referenceCount: Number(subrecord.referenceCount || 0),
    frameTileByteRange: subrecord.frameTileByteRange || null,
    observedUploadCount: Number(subrecord.observedUploadCount || 0),
    coveredUploadCount: Number(subrecord.coveredUploadCount || 0),
    partialUploadCount: Number(subrecord.partialUploadCount || 0),
    uncoveredUploadCount: Number(subrecord.uncoveredUploadCount || 0),
    parseIssueCount: Number(subrecord.parseIssueCount || 0),
    coverageStatus: subrecord.status || '',
  };
}

function buildFixture(entity, subrecord, fixtureIndex) {
  const compact = compactSubrecord(subrecord);
  return {
    fixtureId: `renderable_frame_fixture_${String(entity.entityType || 'unknown').replace(/^0x/i, '').toUpperCase()}_${String(compact.offset || 'unknown').replace(/^0x/i, '').toUpperCase()}`,
    fixtureIndex,
    entityType: entity.entityType || '',
    selectorTypeHex: entity.selectorTypeHex || '',
    priorityRank: Number(entity.priorityRank || 0),
    highBitVariant: Boolean(entity.highBitVariant),
    usageClass: entity.usageClass || '',
    renderStatus: fixtureStatus(subrecord),
    renderPolicy: 'metadata_only_renderable_frame_fixture',
    confidence: compact.parseIssueCount ? 'low' : 'medium',
    dynamicTile: {
      tableId: entity.dynamicTile?.tableId || '',
      entryOffset: entity.dynamicTile?.entryOffset || '',
      remapRow: Number(entity.dynamicTile?.remapRow || 0),
      streamRomOffset: entity.dynamicTile?.streamRomOffset || '',
      streamRegionId: entity.dynamicTile?.streamRegionId || '',
      assignedTileCountRange: entity.assignedTileCountRange || null,
      observedUploadCount: Number(entity.observedUploadCount || 0),
    },
    frameSubrecord: compact,
    blockersCleared: [
      'frame_subrecord_asset_link_confirmed',
      subrecord.status === 'empty_frame_no_tile_coverage_required'
        ? 'no_frame_tiles_required'
        : 'all_observed_dynamic_upload_ranges_cover_frame_tiles',
    ],
    persistedTileByteCount: 0,
    persistedPixelCount: 0,
    persistedCoordinateCount: 0,
    evidence: [
      'world-room-entity-frame-subrecord-coverage-catalog-2026-06-25 marks this frame subrecord renderable without additional tile-base trace.',
      'world-room-entity-frame-trace-priority-catalog-2026-06-25 supplies the entity trace priority and dynamic tile stream metadata.',
      '_LABEL_65B9_ copies the room entity tile-base byte from IY+5 to IX+63.',
      '_LABEL_792_ adds IX+63 to each frame tile byte before writing OAM tile ids.',
    ],
  };
}

function buildCatalog(mapData) {
  const subrecordCoverage = requireCatalog(mapData, 'metaspriteCatalogs', sourceCatalogIds.subrecordCoverage);
  requireCatalog(mapData, 'metaspriteCatalogs', sourceCatalogIds.tracePriority);
  requireCatalog(mapData, 'entityDataCatalogs', sourceCatalogIds.dynamicTiles);
  requireCatalog(mapData, 'metaspriteCatalogs', sourceCatalogIds.frameAssets);

  let fixtureIndex = 0;
  const entities = [];
  const fixtures = [];
  for (const entity of subrecordCoverage.entities || []) {
    const entityFixtures = [];
    for (const subrecord of entity.subrecordCoverage || []) {
      if (!renderableStatuses.has(subrecord.status)) continue;
      const fixture = buildFixture(entity, subrecord, fixtureIndex++);
      entityFixtures.push(fixture);
      fixtures.push(fixture);
    }
    if (!entityFixtures.length) continue;
    entities.push({
      entityType: entity.entityType || '',
      selectorTypeHex: entity.selectorTypeHex || '',
      priorityRank: Number(entity.priorityRank || 0),
      highBitVariant: Boolean(entity.highBitVariant),
      usageClass: entity.usageClass || '',
      fixtureCount: entityFixtures.length,
      dynamicUploadBackedFixtureCount: entityFixtures
        .filter(fixture => fixture.renderStatus === 'dynamic_upload_backed').length,
      emptyFrameFixtureCount: entityFixtures
        .filter(fixture => fixture.renderStatus === 'empty_frame_no_tile_upload_required').length,
      totalFrameSubrecordCount: Number(entity.frameSubrecordCount || 0),
      blockedSubrecordCount: Number(entity.notCoveredSubrecordCount || 0),
      partialSubrecordCount: Number(entity.mixedOrPartialSubrecordCount || 0),
      parseIssueSubrecordCount: Number(entity.parseIssueSubrecordCount || 0),
      dynamicCoveredFramePercent: Number(entity.dynamicCoveredFramePercent || 0),
      dynamicTile: entity.dynamicTile || null,
      fixtures: entityFixtures,
    });
  }

  const topEntityType = subrecordCoverage.summary?.topEntityType || entities[0]?.entityType || '';
  const topEntity = entities.find(entity => entity.entityType === topEntityType) || entities[0] || null;
  const blockedOrPartialSubrecordCount = Number(subrecordCoverage.summary?.totalMixedOrPartialSubrecords || 0)
    + Number(subrecordCoverage.summary?.totalNotCoveredSubrecords || 0);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    summary: {
      fixtureEntityTypeCount: entities.length,
      fixtureCount: fixtures.length,
      dynamicUploadBackedFixtureCount: fixtures
        .filter(fixture => fixture.renderStatus === 'dynamic_upload_backed').length,
      emptyFrameFixtureCount: fixtures
        .filter(fixture => fixture.renderStatus === 'empty_frame_no_tile_upload_required').length,
      sourceFrameSubrecordCount: Number(subrecordCoverage.summary?.totalFrameSubrecords || 0),
      sourceRenderableFrameSubrecordCount: Number(subrecordCoverage.summary?.totalRenderableWithoutAdditionalTileTraceSubrecords || 0),
      blockedOrPartialSubrecordCount,
      partialSubrecordCount: Number(subrecordCoverage.summary?.totalMixedOrPartialSubrecords || 0),
      blockedSubrecordCount: Number(subrecordCoverage.summary?.totalNotCoveredSubrecords || 0),
      parseIssueSubrecordCount: Number(subrecordCoverage.summary?.parseIssueSubrecordCount || 0),
      topEntityType,
      topEntityFixtureCount: topEntity?.fixtureCount || 0,
      topEntityBlockedSubrecordCount: topEntity?.blockedSubrecordCount || 0,
      persistedTileByteCount: 0,
      persistedPixelCount: 0,
      persistedCoordinateCount: 0,
      assetPolicy: 'Metadata only: entity type ids, frame subrecord ids/offsets, counts, ranges, source region ids, fixture statuses, and evidence. No ROM bytes, decoded graphics, pixels, coordinates, screenshots, or rendered sprites are embedded.',
    },
    entities,
    fixtures,
    evidence: [
      'world-room-entity-frame-subrecord-coverage-catalog-2026-06-25 supplies per-frame-subrecord dynamic upload coverage.',
      'Fixtures include only all_observed_uploads_cover_frame_subrecord and empty_frame_no_tile_coverage_required statuses.',
      'world-room-entity-frame-trace-priority-catalog-2026-06-25 supplies entity priority and tile-base trace labels.',
      'world-room-entity-dynamic-tile-catalog-2026-06-25 supplies dynamic upload stream metadata and assigned ranges.',
      'ASM lines 14843-14844 in _LABEL_65B9_ copy (IY+5) to IX+63.',
      'ASM lines 2026-2028 in _LABEL_792_ add IX+63 to frame tile bytes before writing OAM tile ids.',
    ],
    nextLeads: [
      'Use these fixtures as the allowlist for an initial metadata-gated metasprite preview path.',
      'Keep partial and not-covered frame subrecords hidden until static or alternate tile-base provenance is traced.',
      'Trace priority entity 0x8A not-covered frame subrecords against static preloads and alternate dynamic tile streams.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(item => item.id !== catalogId);
  mapData.metaspriteCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'room_entity_renderable_frame_fixture_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    sampleEntities: catalog.entities.slice(0, 8).map(entity => ({
      entityType: entity.entityType,
      priorityRank: entity.priorityRank,
      fixtureCount: entity.fixtureCount,
      dynamicUploadBackedFixtureCount: entity.dynamicUploadBackedFixtureCount,
      emptyFrameFixtureCount: entity.emptyFrameFixtureCount,
      blockedSubrecordCount: entity.blockedSubrecordCount,
      partialSubrecordCount: entity.partialSubrecordCount,
    })),
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
    sampleEntities: catalog.entities.slice(0, 6).map(entity => ({
      entityType: entity.entityType,
      priorityRank: entity.priorityRank,
      fixtureCount: entity.fixtureCount,
      blockedSubrecordCount: entity.blockedSubrecordCount,
      sampleFixtures: entity.fixtures.slice(0, 4).map(fixture => ({
        fixtureId: fixture.fixtureId,
        renderStatus: fixture.renderStatus,
        frameSubrecord: fixture.frameSubrecord,
      })),
    })),
  }, null, 2));
}

main();
