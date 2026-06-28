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
const catalogId = 'world-room-entity-frame-trace-priority-catalog-2026-06-25';
const reportId = 'room-entity-frame-trace-priority-audit-2026-06-25';
const toolName = 'tools/world-room-entity-frame-trace-priority-audit.mjs';

const sourceCatalogIds = {
  frameCoverage: 'world-room-entity-dynamic-frame-coverage-catalog-2026-06-25',
  dynamicTiles: 'world-room-entity-dynamic-tile-catalog-2026-06-25',
  frameAssets: 'world-room-entity-frame-asset-link-catalog-2026-06-25',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requireCatalog(mapData, key, id) {
  const catalog = (mapData[key] || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required catalog ${key}.${id}`);
  return catalog;
}

function compactRange(range) {
  if (!range) return null;
  return {
    count: Number(range.count || 0),
    min: range.min || null,
    max: range.max || null,
    uniqueCount: Number(range.uniqueCount || 0),
    segmentCount: Array.isArray(range.segments) ? range.segments.length : 0,
  };
}

function priorityScore(entity) {
  const uploads = Number(entity.uploadCount || 0);
  const partials = Number(entity.partialCoverageUploadCount || 0);
  const assigned = Number(entity.maxAssignedTileCount || 0);
  const uniqueFrameTiles = Number(entity.frameTileByteRange?.uniqueCount || 0);
  const framePieces = Number(entity.frameTileByteRange?.count || 0);
  return uploads * 10000 + partials * 1000 + uniqueFrameTiles * 10 + Math.min(framePieces, 999) + assigned;
}

function buildCatalog(mapData) {
  const frameCoverage = requireCatalog(mapData, 'metaspriteCatalogs', sourceCatalogIds.frameCoverage);
  requireCatalog(mapData, 'entityDataCatalogs', sourceCatalogIds.dynamicTiles);
  requireCatalog(mapData, 'metaspriteCatalogs', sourceCatalogIds.frameAssets);

  const priorities = (frameCoverage.entityFrameCoverage || [])
    .filter(entity => entity.coverageStatus === 'needs_frame_tile_base_trace')
    .map(entity => ({
      entityType: entity.entityType || '',
      selectorTypeHex: entity.selectorTypeHex || '',
      highBitVariant: Boolean(entity.highBitVariant),
      usageClass: entity.usageClass || '',
      priorityScore: priorityScore(entity),
      uploadCount: Number(entity.uploadCount || 0),
      frameLinkedUploadCount: Number(entity.frameLinkedUploadCount || 0),
      partialCoverageUploadCount: Number(entity.partialCoverageUploadCount || 0),
      coveredUploadCount: Number(entity.coveredUploadCount || 0),
      assignedTileCountRange: {
        min: Number(entity.minAssignedTileCount || 0),
        max: Number(entity.maxAssignedTileCount || 0),
      },
      frameTileByteRange: compactRange(entity.frameTileByteRange),
      frameAsset: {
        status: entity.frameAsset?.status || '',
        selectorPair: entity.frameAsset?.selectorPair || null,
        subrecordCount: Number(entity.frameAsset?.subrecordCount || 0),
        pieceRecordCount: Number(entity.frameAsset?.pieceRecordCount || 0),
        frameRegionCount: Number(entity.frameAsset?.frameRegionCount || 0),
        confidence: entity.frameAsset?.confidence || '',
      },
      dynamicTile: {
        tableId: entity.dynamicTile?.tableId || '',
        entryOffset: entity.dynamicTile?.entryOffset || '',
        remapRow: Number(entity.dynamicTile?.remapRow || 0),
        streamRomOffset: entity.dynamicTile?.streamRomOffset || '',
        streamRegionId: entity.dynamicTile?.streamRegion?.id || '',
        streamRegionType: entity.dynamicTile?.streamRegion?.type || '',
        zeroPadding: Boolean(entity.dynamicTile?.zeroPadding),
      },
      exampleRoomSubrecords: (entity.exampleRoomSubrecords || []).slice(0, 10),
      traceTargets: [
        {
          label: '_LABEL_65B9_',
          focus: 'Confirm the room entity record tile-base byte copied from IY+5 into IX+63 for this entity type.',
          evidence: 'ASM lines 14843-14844 copy (IY+5) to (IX+63).',
        },
        {
          label: '_LABEL_792_',
          focus: 'Confirm final OAM tile ids after adding IX+63 to each metasprite frame tile byte.',
          evidence: 'ASM lines 2026-2028 load a frame tile byte, add (IX+63), and store the OAM tile id.',
        },
        {
          label: entity.dynamicTile?.streamRegion?.id || '',
          focus: 'Compare traced final OAM tile ids against this entity dynamic upload stream and assigned VRAM tile range.',
          evidence: 'world-room-entity-dynamic-tile-catalog-2026-06-25 supplies first-seen upload ranges and dynamic stream metadata.',
        },
      ].filter(target => target.label),
      confidence: 'medium',
      status: 'trace_required_before_sprite_render',
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore || a.entityType.localeCompare(b.entityType))
    .map((entry, index) => ({ priorityRank: index + 1, ...entry }));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    summary: {
      tracePriorityEntityTypeCount: priorities.length,
      highBitVariantCount: priorities.filter(entry => entry.highBitVariant).length,
      reachedAndOrphanCount: priorities.filter(entry => entry.usageClass === 'reached_and_orphan').length,
      reachedOnlyCount: priorities.filter(entry => entry.usageClass === 'reached_only').length,
      topEntityType: priorities[0]?.entityType || '',
      topUploadCount: priorities[0]?.uploadCount || 0,
      totalPriorityUploads: priorities.reduce((sum, entry) => sum + entry.uploadCount, 0),
      totalPartialCoverageUploads: priorities.reduce((sum, entry) => sum + entry.partialCoverageUploadCount, 0),
      assetPolicy: 'Metadata only: entity type ids, selector ids, counts, ranges, source region ids, trace labels, and evidence. No ROM bytes, decoded graphics, pixels, coordinates, screenshots, or rendered sprites are embedded.',
    },
    priorities,
    evidence: [
      'world-room-entity-dynamic-frame-coverage-catalog-2026-06-25 marks these entity types as needs_frame_tile_base_trace from partial dynamic-upload coverage.',
      'world-room-entity-dynamic-tile-catalog-2026-06-25 supplies first-seen dynamic upload ranges and stream region metadata.',
      'world-room-entity-frame-asset-link-catalog-2026-06-25 supplies high-confidence raw entity type to frame-subrecord links.',
      'ASM lines 14843-14844 in _LABEL_65B9_ copy (IY+5) to IX+63.',
      'ASM lines 2026-2028 in _LABEL_792_ add IX+63 to frame tile bytes before writing OAM tile ids.',
    ],
    nextLeads: [
      'Trace priority rank 1 first because it covers the most observed partial uploads.',
      'Record final IX+63 and OAM tile-id ranges per priority entity type before treating its metasprite frames as render-ready.',
      'Use confirmed final tile coverage to split dynamic-upload-backed sprites from static-preloaded or alternate-animation sprites.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(item => item.id !== catalogId);
  mapData.metaspriteCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'room_entity_frame_trace_priority_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    samplePriorities: catalog.priorities.slice(0, 8),
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
    samplePriorities: catalog.priorities.slice(0, 12),
  }, null, 2));
}

main();
