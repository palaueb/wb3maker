#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-room-entity-dynamic-frame-coverage-catalog-2026-06-25';
const reportId = 'room-entity-dynamic-frame-coverage-audit-2026-06-25';
const toolName = 'tools/world-room-entity-dynamic-frame-coverage-audit.mjs';

const sourceCatalogIds = {
  dynamicTiles: 'world-room-entity-dynamic-tile-catalog-2026-06-25',
  frameAssets: 'world-room-entity-frame-asset-link-catalog-2026-06-25',
  dynamicSourceTable: 'world-dynamic-tile-source-table-catalog-2026-06-25',
  dynamicUpload: 'world-dynamic-tile-upload-catalog-2026-06-25',
  tileBase: 'world-animation-tile-base-catalog-2026-06-25',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 2) {
  return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function requireCatalog(mapData, key, id) {
  const catalog = (mapData[key] || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required catalog ${key}.${id}`);
  return catalog;
}

function framePieceTileBytes(rom, startOffset, recordLimit = 160) {
  const tileBytes = [];
  let pos = startOffset;
  let terminated = false;
  const issues = [];
  for (let i = 0; i < recordLimit; i++) {
    if (pos < 0 || pos >= rom.length) {
      issues.push({ kind: 'out_of_rom', atOffset: hex(pos, 5) });
      break;
    }
    const control = rom[pos++];
    if (control === 0x80) {
      terminated = true;
      break;
    }
    if (pos + 1 >= rom.length) {
      issues.push({ kind: 'truncated_piece_record', atOffset: hex(pos - 1, 5) });
      break;
    }
    tileBytes.push(rom[pos + 1]);
    pos += 2;
  }
  if (!terminated && !issues.length) issues.push({ kind: 'record_limit_reached', recordLimit });
  return { tileBytes, terminated, issues };
}

function byteStats(values) {
  if (!values.length) {
    return { count: 0, min: null, max: null, uniqueCount: 0, segments: [] };
  }
  const unique = [...new Set(values)].sort((a, b) => a - b);
  const segments = [];
  let start = unique[0];
  let prev = unique[0];
  for (let i = 1; i < unique.length; i++) {
    const value = unique[i];
    if (value === prev + 1) {
      prev = value;
      continue;
    }
    segments.push({ start: hex(start, 2), end: hex(prev, 2), count: prev - start + 1 });
    start = value;
    prev = value;
  }
  segments.push({ start: hex(start, 2), end: hex(prev, 2), count: prev - start + 1 });
  return {
    count: values.length,
    min: hex(Math.min(...values), 2),
    max: hex(Math.max(...values), 2),
    uniqueCount: unique.length,
    segments: segments.slice(0, 24),
  };
}

function compactFrameAsset(frameAsset) {
  if (!frameAsset) return null;
  return {
    status: frameAsset.status || '',
    selectorTypeHex: frameAsset.selectorTypeHex || '',
    selectorPair: frameAsset.selectorPair || null,
    subrecordCount: frameAsset.subrecordCount || 0,
    pieceRecordCount: frameAsset.pieceRecordCount || 0,
    frameRegionCount: frameAsset.frameRegionCount || 0,
    confidence: frameAsset.confidence || '',
  };
}

function buildFrameStats(rom, frameAsset) {
  const tileBytes = [];
  const issues = [];
  for (const subrecord of frameAsset?.subrecords || []) {
    const offset = parseHex(subrecord.offset);
    if (offset == null) {
      issues.push({ subrecordId: subrecord.id || '', issue: 'missing_offset' });
      continue;
    }
    const parsed = framePieceTileBytes(rom, offset);
    tileBytes.push(...parsed.tileBytes);
    if (!parsed.terminated || parsed.issues.length) {
      issues.push({
        subrecordId: subrecord.id || '',
        offset: subrecord.offset || '',
        terminated: parsed.terminated,
        issues: parsed.issues,
      });
    }
  }
  return {
    tileBytes,
    stats: byteStats(tileBytes),
    issueCount: issues.length,
    issues: issues.slice(0, 8),
  };
}

function uploadCoverage(upload, frameStats) {
  const start = parseHex(upload.assignedTileRange?.start);
  const end = parseHex(upload.assignedTileRange?.end);
  const count = Number(upload.assignedTileRange?.count || 0);
  if (start == null || end == null || !count) {
    return {
      status: 'missing_dynamic_upload_range',
      coveredUniqueTileCount: 0,
      uncoveredUniqueTileCount: frameStats.stats.uniqueCount || 0,
      finalTileRange: null,
      uncoveredFinalTileSegments: [],
    };
  }
  const finalTiles = frameStats.tileBytes.map(value => (start + value) & 0xFF);
  const uniqueFinal = [...new Set(finalTiles)].sort((a, b) => a - b);
  const covered = uniqueFinal.filter(value => value >= start && value <= end);
  const uncovered = uniqueFinal.filter(value => value < start || value > end);
  const uncoveredStats = byteStats(uncovered);
  const finalStats = byteStats(finalTiles);
  return {
    status: uncovered.length ? (covered.length ? 'partial_dynamic_upload_coverage' : 'frame_tiles_outside_dynamic_upload') : 'covered_by_dynamic_upload',
    dynamicAssignedTileRange: {
      start: upload.assignedTileRange?.start || '',
      end: upload.assignedTileRange?.end || '',
      count,
    },
    frameTileByteRange: frameStats.stats,
    finalTileRange: {
      count: finalStats.count,
      min: finalStats.min,
      max: finalStats.max,
      uniqueCount: finalStats.uniqueCount,
    },
    coveredUniqueTileCount: covered.length,
    uncoveredUniqueTileCount: uncovered.length,
    uncoveredFinalTileSegments: uncoveredStats.segments,
  };
}

function buildCatalog(mapData, rom) {
  const dynamicCatalog = requireCatalog(mapData, 'entityDataCatalogs', sourceCatalogIds.dynamicTiles);
  const frameCatalog = requireCatalog(mapData, 'metaspriteCatalogs', sourceCatalogIds.frameAssets);
  requireCatalog(mapData, 'tileSourceCatalogs', sourceCatalogIds.dynamicSourceTable);
  requireCatalog(mapData, 'tileSourceCatalogs', sourceCatalogIds.dynamicUpload);
  requireCatalog(mapData, 'animationTileBaseCatalogs', sourceCatalogIds.tileBase);

  const linkByType = new Map((frameCatalog.links || []).map(link => [link.entityTypeHex, link]));
  const frameStatsByType = new Map();
  const entitySummaries = new Map();
  const roomUploadChecks = [];
  const statusCounts = new Map();
  let totalUploads = 0;
  let frameLinkedUploadCount = 0;
  let fullyCoveredUploadCount = 0;
  let partialCoverageUploadCount = 0;
  let outOfRangeUploadCount = 0;
  let noFrameAssetUploadCount = 0;
  let frameParseIssueUploadCount = 0;

  function addStatus(status) {
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
  }

  for (const room of dynamicCatalog.roomSummaries || []) {
    for (const upload of room.uploads || []) {
      totalUploads++;
      const link = linkByType.get(upload.entityType);
      const frameAsset = link?.frameAsset || null;
      let coverage = null;
      let frameStats = null;
      let status = 'no_high_confidence_frame_asset';
      if (frameAsset?.status === 'linked_high_confidence_frame_subrecords') {
        if (!frameStatsByType.has(upload.entityType)) frameStatsByType.set(upload.entityType, buildFrameStats(rom, frameAsset));
        frameStats = frameStatsByType.get(upload.entityType);
        coverage = uploadCoverage(upload, frameStats);
        status = coverage.status;
        frameLinkedUploadCount++;
        if (status === 'covered_by_dynamic_upload') fullyCoveredUploadCount++;
        else if (status === 'partial_dynamic_upload_coverage') partialCoverageUploadCount++;
        else if (status === 'frame_tiles_outside_dynamic_upload') outOfRangeUploadCount++;
        if (frameStats.issueCount) frameParseIssueUploadCount++;
      } else {
        noFrameAssetUploadCount++;
      }
      addStatus(status);

      if (!entitySummaries.has(upload.entityType)) {
        entitySummaries.set(upload.entityType, {
          entityType: upload.entityType,
          selectorTypeHex: link?.dispatchSelector?.entityTypeHex || '',
          highBitVariant: Boolean(link?.dispatchSelector?.highBitVariant),
          usageClass: link?.usageClass || '',
          frameAsset: compactFrameAsset(frameAsset),
          dynamicTile: link?.dynamicTile || null,
          uploadCount: 0,
          frameLinkedUploadCount: 0,
          coveredUploadCount: 0,
          partialCoverageUploadCount: 0,
          outOfRangeUploadCount: 0,
          noFrameAssetUploadCount: 0,
          minAssignedTileCount: null,
          maxAssignedTileCount: 0,
          frameTileByteRange: null,
          frameParseIssueCount: 0,
          exampleRoomSubrecords: [],
        });
      }
      const entity = entitySummaries.get(upload.entityType);
      const assignedCount = Number(upload.assignedTileRange?.count || 0);
      entity.uploadCount++;
      entity.minAssignedTileCount = entity.minAssignedTileCount == null ? assignedCount : Math.min(entity.minAssignedTileCount, assignedCount);
      entity.maxAssignedTileCount = Math.max(entity.maxAssignedTileCount, assignedCount);
      if (frameStats) {
        entity.frameLinkedUploadCount++;
        entity.frameTileByteRange = frameStats.stats;
        entity.frameParseIssueCount = frameStats.issueCount;
      } else {
        entity.noFrameAssetUploadCount++;
      }
      if (status === 'covered_by_dynamic_upload') entity.coveredUploadCount++;
      else if (status === 'partial_dynamic_upload_coverage') entity.partialCoverageUploadCount++;
      else if (status === 'frame_tiles_outside_dynamic_upload') entity.outOfRangeUploadCount++;
      if (entity.exampleRoomSubrecords.length < 10) entity.exampleRoomSubrecords.push(room.subrecordIndex);

      roomUploadChecks.push({
        subrecordIndex: room.subrecordIndex,
        entityType: upload.entityType,
        selectorTypeHex: link?.dispatchSelector?.entityTypeHex || '',
        status,
        dynamicAssignedTileRange: upload.assignedTileRange || null,
        frameAssetStatus: frameAsset?.status || '',
        frameSubrecordCount: frameAsset?.subrecordCount || 0,
        framePieceRecordCount: frameAsset?.pieceRecordCount || 0,
        frameTileByteRange: coverage?.frameTileByteRange || frameStats?.stats || null,
        finalTileRange: coverage?.finalTileRange || null,
        coveredUniqueTileCount: coverage?.coveredUniqueTileCount || 0,
        uncoveredUniqueTileCount: coverage?.uncoveredUniqueTileCount || 0,
        uncoveredFinalTileSegments: coverage?.uncoveredFinalTileSegments || [],
        evidence: [
          'Room entity dynamic tile catalog supplies this first-seen entity upload range.',
          frameAsset?.status === 'linked_high_confidence_frame_subrecords'
            ? 'Room entity frame asset link catalog supplies high-confidence metasprite frame subrecords.'
            : 'No high-confidence frame asset is linked for this raw entity type yet.',
          '_LABEL_65B9_ copies the room entity record tile base byte from IY+5 to IX+63.',
          '_LABEL_792_ adds IX+63 to each frame-stream tile byte before writing the OAM tile id.',
        ],
      });
    }
  }

  const entityFrameCoverage = [...entitySummaries.values()]
    .map(entity => ({
      ...entity,
      minAssignedTileCount: entity.minAssignedTileCount == null ? 0 : entity.minAssignedTileCount,
      coverageStatus: entity.frameLinkedUploadCount === 0
        ? 'no_high_confidence_frame_asset'
        : entity.outOfRangeUploadCount || entity.partialCoverageUploadCount
          ? 'needs_frame_tile_base_trace'
          : 'all_observed_uploads_cover_frame_tiles',
    }))
    .sort((a, b) => b.uploadCount - a.uploadCount || a.entityType.localeCompare(b.entityType));

  const statusObject = Object.fromEntries([...statusCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  const finalCatalog = {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    summary: {
      totalDynamicEntityUploads: totalUploads,
      frameLinkedUploadCount,
      fullyCoveredUploadCount,
      partialCoverageUploadCount,
      outOfRangeUploadCount,
      noFrameAssetUploadCount,
      frameParseIssueUploadCount,
      dynamicEntityTypeCount: entitySummaries.size,
      frameLinkedEntityTypeCount: entityFrameCoverage.filter(item => item.frameLinkedUploadCount > 0).length,
      fullyCoveredEntityTypeCount: entityFrameCoverage.filter(item => item.coverageStatus === 'all_observed_uploads_cover_frame_tiles').length,
      needsTraceEntityTypeCount: entityFrameCoverage.filter(item => item.coverageStatus === 'needs_frame_tile_base_trace').length,
      statusCounts: statusObject,
      assetPolicy: 'Metadata only: entity type ids, room subrecord indexes, tile-slot ranges, frame tile byte ranges/counts, coverage statuses, and evidence. No ROM bytes, decoded graphics, pixels, coordinates, screenshots, or rendered sprites are embedded.',
    },
    semantics: {
      dynamicTileBaseWrite: '_LABEL_65B9_ copies IY+5 to IX+63 for room entity runtime slots.',
      frameTileAdd: '_LABEL_792_ adds IX+63 to each frame-stream tile byte and writes the result to OAM.',
      coverageRule: 'A frame tile is considered covered only when (frameTileByte + assignedDynamicTileStart) & 0xFF falls inside the assigned dynamic upload range for that room entity.',
      uncertainty: 'Out-of-range results are retained as needs-trace findings because some entities may use alternate static preloads, animation variants, or additional tile-base setup not yet modeled.',
    },
    entityFrameCoverage,
    roomUploadChecks,
    evidence: [
      'world-room-entity-dynamic-tile-catalog-2026-06-25 supplies first-seen room entity dynamic upload ranges and source stream metadata.',
      'world-room-entity-frame-asset-link-catalog-2026-06-25 supplies raw entity type to high-confidence frame subrecord links.',
      'ASM line 14843 loads A from (IY+5), and ASM line 14844 stores A to (IX+63) in _LABEL_65B9_.',
      'ASM lines 2026-2028 in _LABEL_792_ load the frame tile byte, add (IX+63), and store the OAM tile id.',
      'This audit parses frame subrecords from the local ROM only to derive counts/ranges; no frame bytes or decoded sprite pixels are persisted.',
    ],
    nextLeads: [
      'Frame-trace needs_frame_tile_base_trace entity types to distinguish static preloaded sprites from dynamic-upload-backed sprites.',
      'Add a sprite render preview only after each selected room entity can prove both dynamic/static tile coverage and palette provenance.',
      'Use covered entity types as the first candidates for metadata-only metasprite render fixtures.',
    ],
  };
  return finalCatalog;
}

function applyCatalog(mapData, catalog) {
  mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(item => item.id !== catalogId);
  mapData.metaspriteCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'room_entity_dynamic_frame_coverage_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  if (apply) {
    applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    id: catalog.id,
    summary: catalog.summary,
    sampleEntityCoverage: catalog.entityFrameCoverage.slice(0, 12),
    sampleRoomUploadChecks: catalog.roomUploadChecks.slice(0, 12),
  }, null, 2));
}

main();
