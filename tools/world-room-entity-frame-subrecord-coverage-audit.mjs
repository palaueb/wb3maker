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
const catalogId = 'world-room-entity-frame-subrecord-coverage-catalog-2026-06-25';
const reportId = 'room-entity-frame-subrecord-coverage-audit-2026-06-25';
const toolName = 'tools/world-room-entity-frame-subrecord-coverage-audit.mjs';

const sourceCatalogIds = {
  tracePriority: 'world-room-entity-frame-trace-priority-catalog-2026-06-25',
  frameCoverage: 'world-room-entity-dynamic-frame-coverage-catalog-2026-06-25',
  dynamicTiles: 'world-room-entity-dynamic-tile-catalog-2026-06-25',
  frameAssets: 'world-room-entity-frame-asset-link-catalog-2026-06-25',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 2) {
  return '0x' + (value >>> 0).toString(16).toUpperCase().padStart(pad, '0');
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
  for (let index = 0; index < recordLimit; index++) {
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
    return { count: 0, min: null, max: null, uniqueCount: 0 };
  }
  return {
    count: values.length,
    min: hex(Math.min(...values), 2),
    max: hex(Math.max(...values), 2),
    uniqueCount: new Set(values).size,
  };
}

function uploadCoversSubrecord(upload, tileBytes) {
  if (!tileBytes.length) {
    return {
      status: 'no_tile_bytes_no_upload_required',
      coveredTileCount: 0,
      uncoveredTileCount: 0,
    };
  }
  const start = parseHex(upload.assignedTileRange?.start);
  const end = parseHex(upload.assignedTileRange?.end);
  if (start == null || end == null) {
    return {
      status: 'missing_dynamic_upload_range',
      coveredTileCount: 0,
      uncoveredTileCount: tileBytes.length,
    };
  }
  let coveredTileCount = 0;
  let uncoveredTileCount = 0;
  for (const tile of tileBytes) {
    const finalTile = (start + tile) & 0xFF;
    if (finalTile >= start && finalTile <= end) coveredTileCount++;
    else uncoveredTileCount++;
  }
  return {
    status: uncoveredTileCount
      ? (coveredTileCount ? 'partial_dynamic_upload_coverage' : 'not_covered_by_dynamic_upload')
      : 'covered_by_dynamic_upload',
    coveredTileCount,
    uncoveredTileCount,
  };
}

function summarizeSubrecordCoverage(subrecord, parsed, uploads) {
  let coveredUploadCount = 0;
  let partialUploadCount = 0;
  let uncoveredUploadCount = 0;
  let missingRangeUploadCount = 0;
  let noTileUploadCount = 0;
  let coveredTileTotal = 0;
  let uncoveredTileTotal = 0;

  for (const upload of uploads) {
    const coverage = uploadCoversSubrecord(upload, parsed.tileBytes);
    coveredTileTotal += coverage.coveredTileCount;
    uncoveredTileTotal += coverage.uncoveredTileCount;
    if (coverage.status === 'covered_by_dynamic_upload') coveredUploadCount++;
    else if (coverage.status === 'partial_dynamic_upload_coverage') partialUploadCount++;
    else if (coverage.status === 'missing_dynamic_upload_range') missingRangeUploadCount++;
    else if (coverage.status === 'no_tile_bytes_no_upload_required') noTileUploadCount++;
    else uncoveredUploadCount++;
  }

  const observedUploadCount = uploads.length;
  const status = observedUploadCount && noTileUploadCount === observedUploadCount
    ? 'empty_frame_no_tile_coverage_required'
    : (observedUploadCount && coveredUploadCount === observedUploadCount
    ? 'all_observed_uploads_cover_frame_subrecord'
    : (coveredUploadCount || partialUploadCount
      ? 'mixed_or_partial_frame_subrecord_coverage'
      : 'not_covered_by_dynamic_upload'));

  return {
    subrecordId: subrecord.id || '',
    offset: subrecord.offset || '',
    endOffsetInclusive: subrecord.endOffsetInclusive || '',
    regionId: subrecord.region?.id || '',
    pieceRecordCount: Number(subrecord.pieceRecordCount || 0),
    referenceCount: Number(subrecord.referenceCount || 0),
    frameTileByteRange: byteStats(parsed.tileBytes),
    observedUploadCount,
    coveredUploadCount,
    partialUploadCount,
    uncoveredUploadCount,
    missingRangeUploadCount,
    noTileUploadCount,
    coveredTileTotal,
    uncoveredTileTotal,
    parseIssueCount: parsed.terminated ? parsed.issues.length : parsed.issues.length + 1,
    status,
  };
}

function buildEntityCoverage(priority, link, uploads, rom) {
  const subrecords = link?.frameAsset?.subrecords || [];
  const subrecordCoverage = subrecords.map(subrecord => {
    const offset = parseHex(subrecord.offset);
    const parsed = offset == null
      ? { tileBytes: [], terminated: false, issues: [{ kind: 'missing_offset' }] }
      : framePieceTileBytes(rom, offset);
    return summarizeSubrecordCoverage(subrecord, parsed, uploads);
  });

  const dynamicCoveredSubrecordCount = subrecordCoverage
    .filter(item => item.status === 'all_observed_uploads_cover_frame_subrecord').length;
  const emptyFrameSubrecordCount = subrecordCoverage
    .filter(item => item.status === 'empty_frame_no_tile_coverage_required').length;
  const mixedOrPartialSubrecordCount = subrecordCoverage
    .filter(item => item.status === 'mixed_or_partial_frame_subrecord_coverage').length;
  const notCoveredSubrecordCount = subrecordCoverage
    .filter(item => item.status === 'not_covered_by_dynamic_upload').length;
  const parseIssueSubrecordCount = subrecordCoverage
    .filter(item => item.parseIssueCount > 0).length;

  return {
    entityType: priority.entityType || '',
    selectorTypeHex: priority.selectorTypeHex || '',
    priorityRank: Number(priority.priorityRank || 0),
    highBitVariant: Boolean(priority.highBitVariant),
    usageClass: priority.usageClass || '',
    observedUploadCount: uploads.length,
    assignedTileCountRange: priority.assignedTileCountRange || null,
    frameSubrecordCount: subrecordCoverage.length,
    dynamicCoveredSubrecordCount,
    emptyFrameSubrecordCount,
    renderableWithoutAdditionalTileTraceSubrecordCount: dynamicCoveredSubrecordCount + emptyFrameSubrecordCount,
    mixedOrPartialSubrecordCount,
    notCoveredSubrecordCount,
    parseIssueSubrecordCount,
    dynamicCoveredFramePercent: subrecordCoverage.length
      ? Math.round((dynamicCoveredSubrecordCount / subrecordCoverage.length) * 1000) / 10
      : 0,
    status: parseIssueSubrecordCount
      ? 'frame_subrecord_parse_issues'
      : (dynamicCoveredSubrecordCount || emptyFrameSubrecordCount
        ? 'partially_renderable_from_dynamic_upload'
        : 'requires_static_or_alternate_tile_base_trace'),
    frameAsset: {
      status: link?.frameAsset?.status || '',
      subrecordCount: Number(link?.frameAsset?.subrecordCount || 0),
      pieceRecordCount: Number(link?.frameAsset?.pieceRecordCount || 0),
      frameRegionCount: Number(link?.frameAsset?.frameRegionCount || 0),
      confidence: link?.frameAsset?.confidence || '',
    },
    dynamicTile: {
      tableId: priority.dynamicTile?.tableId || '',
      entryOffset: priority.dynamicTile?.entryOffset || '',
      remapRow: Number(priority.dynamicTile?.remapRow || 0),
      streamRomOffset: priority.dynamicTile?.streamRomOffset || '',
      streamRegionId: priority.dynamicTile?.streamRegionId || '',
    },
    subrecordCoverage,
    evidence: [
      'Frame subrecords were parsed from the local ROM to derive counts and ranges only; no frame bytes or pixels are persisted.',
      'Assigned dynamic upload ranges come from world-room-entity-dynamic-tile-catalog-2026-06-25.',
      '_LABEL_65B9_ copies the room entity tile-base byte from IY+5 to IX+63.',
      '_LABEL_792_ adds IX+63 to each frame tile byte before writing OAM tile ids.',
    ],
  };
}

function buildCatalog(mapData, rom) {
  const tracePriority = requireCatalog(mapData, 'metaspriteCatalogs', sourceCatalogIds.tracePriority);
  const frameCoverage = requireCatalog(mapData, 'metaspriteCatalogs', sourceCatalogIds.frameCoverage);
  const dynamicTiles = requireCatalog(mapData, 'entityDataCatalogs', sourceCatalogIds.dynamicTiles);
  const frameAssets = requireCatalog(mapData, 'metaspriteCatalogs', sourceCatalogIds.frameAssets);

  const linkByEntityType = new Map((frameAssets.links || []).map(link => [link.entityTypeHex, link]));
  const uploadsByEntityType = new Map();
  for (const room of dynamicTiles.roomSummaries || []) {
    for (const upload of room.uploads || []) {
      if (!uploadsByEntityType.has(upload.entityType)) uploadsByEntityType.set(upload.entityType, []);
      uploadsByEntityType.get(upload.entityType).push({
        subrecordIndex: room.subrecordIndex,
        firstRecordIndex: upload.firstRecordIndex,
        firstRecordOffset: upload.firstRecordOffset,
        assignedTileRange: upload.assignedTileRange,
        actualWriteRanges: upload.actualWriteRanges || [],
      });
    }
  }

  const entities = (tracePriority.priorities || []).map(priority => {
    const link = linkByEntityType.get(priority.entityType);
    const uploads = uploadsByEntityType.get(priority.entityType) || [];
    return buildEntityCoverage(priority, link, uploads, rom);
  });

  const topEntity = entities.find(entity => entity.entityType === tracePriority.summary?.topEntityType) || entities[0] || null;
  const totalFrameSubrecords = entities.reduce((sum, entity) => sum + entity.frameSubrecordCount, 0);
  const totalDynamicCoveredSubrecords = entities.reduce((sum, entity) => sum + entity.dynamicCoveredSubrecordCount, 0);
  const totalEmptyFrameSubrecords = entities.reduce((sum, entity) => sum + entity.emptyFrameSubrecordCount, 0);
  const totalRenderableWithoutAdditionalTileTraceSubrecords = entities
    .reduce((sum, entity) => sum + entity.renderableWithoutAdditionalTileTraceSubrecordCount, 0);
  const totalMixedOrPartialSubrecords = entities.reduce((sum, entity) => sum + entity.mixedOrPartialSubrecordCount, 0);
  const totalNotCoveredSubrecords = entities.reduce((sum, entity) => sum + entity.notCoveredSubrecordCount, 0);
  const parseIssueSubrecordCount = entities.reduce((sum, entity) => sum + entity.parseIssueSubrecordCount, 0);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    summary: {
      tracedPriorityEntityTypeCount: entities.length,
      totalFrameSubrecords,
      totalDynamicCoveredSubrecords,
      totalEmptyFrameSubrecords,
      totalRenderableWithoutAdditionalTileTraceSubrecords,
      totalMixedOrPartialSubrecords,
      totalNotCoveredSubrecords,
      parseIssueSubrecordCount,
      partiallyRenderableEntityTypeCount: entities
        .filter(entity => entity.status === 'partially_renderable_from_dynamic_upload').length,
      topEntityType: topEntity?.entityType || '',
      topEntityFrameSubrecordCount: topEntity?.frameSubrecordCount || 0,
      topEntityDynamicCoveredSubrecordCount: topEntity?.dynamicCoveredSubrecordCount || 0,
      topEntityRenderableWithoutAdditionalTileTraceSubrecordCount: topEntity?.renderableWithoutAdditionalTileTraceSubrecordCount || 0,
      topEntityNotCoveredSubrecordCount: topEntity?.notCoveredSubrecordCount || 0,
      topEntityDynamicCoveredFramePercent: topEntity?.dynamicCoveredFramePercent || 0,
      assetPolicy: 'Metadata only: entity type ids, frame subrecord ids/offsets, counts, ranges, coverage statuses, source region ids, and evidence. No ROM bytes, decoded graphics, pixels, coordinates, screenshots, or rendered sprites are embedded.',
    },
    entities,
    evidence: [
      'world-room-entity-frame-trace-priority-catalog-2026-06-25 supplies the trace-priority entity queue.',
      'world-room-entity-dynamic-frame-coverage-catalog-2026-06-25 supplies the entity-level partial dynamic upload status.',
      'world-room-entity-dynamic-tile-catalog-2026-06-25 supplies observed dynamic upload ranges for each room entity type.',
      'world-room-entity-frame-asset-link-catalog-2026-06-25 supplies high-confidence frame stream subrecords.',
      'ASM lines 14843-14844 in _LABEL_65B9_ copy (IY+5) to IX+63.',
      'ASM lines 2026-2028 in _LABEL_792_ add IX+63 to frame tile bytes before writing OAM tile ids.',
    ],
    nextLeads: [
      'Render only dynamic-covered frame subrecords first; keep not-covered frame subrecords gated behind static/alternate tile-base trace.',
      'For entity 0x8A, trace the not-covered frame subrecords to determine whether they use static preloads or alternate tile-base setup.',
      'Extend the metasprite preview to accept per-subrecord coverage statuses before drawing dynamic entity sprites.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(item => item.id !== catalogId);
  mapData.metaspriteCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'room_entity_frame_subrecord_coverage_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    sampleEntities: catalog.entities.slice(0, 6).map(entity => ({
      entityType: entity.entityType,
      priorityRank: entity.priorityRank,
      frameSubrecordCount: entity.frameSubrecordCount,
      dynamicCoveredSubrecordCount: entity.dynamicCoveredSubrecordCount,
      notCoveredSubrecordCount: entity.notCoveredSubrecordCount,
      dynamicCoveredFramePercent: entity.dynamicCoveredFramePercent,
      status: entity.status,
    })),
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
    sampleEntities: catalog.entities.slice(0, 6).map(entity => ({
      entityType: entity.entityType,
      priorityRank: entity.priorityRank,
      frameSubrecordCount: entity.frameSubrecordCount,
      dynamicCoveredSubrecordCount: entity.dynamicCoveredSubrecordCount,
      notCoveredSubrecordCount: entity.notCoveredSubrecordCount,
      dynamicCoveredFramePercent: entity.dynamicCoveredFramePercent,
      status: entity.status,
      sampleSubrecords: entity.subrecordCoverage.slice(0, 5),
    })),
  }, null, 2));
}

main();
