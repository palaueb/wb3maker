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
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-room-entity-frame-gap-vram-writer-audit.mjs';
const catalogId = 'world-room-entity-frame-gap-vram-writer-catalog-2026-06-26';
const reportId = 'room-entity-frame-gap-vram-writer-audit-2026-06-26';

const sourceCatalogIds = {
  dynamicFrameCoverage: 'world-room-entity-dynamic-frame-coverage-catalog-2026-06-25',
  dynamicTiles: 'world-room-entity-dynamic-tile-catalog-2026-06-25',
  frameGap: 'world-room-entity-frame-tile-gap-catalog-2026-06-26',
  frameAssets: 'world-room-entity-frame-asset-link-catalog-2026-06-25',
};

const gapStatuses = new Set([
  'partial_dynamic_upload_coverage',
  'frame_tiles_outside_dynamic_upload',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 2) {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
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

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function parseRange(range) {
  if (!range) return null;
  const start = parseHex(range.start);
  const end = parseHex(range.end || range.endInclusive);
  if (start == null || end == null || end < start) return null;
  return { start, end, count: end - start + 1 };
}

function valuesFromSegments(segments) {
  const values = [];
  for (const segment of segments || []) {
    const start = parseHex(segment.start);
    const end = parseHex(segment.end);
    if (start == null || end == null || end < start) continue;
    for (let value = start; value <= end; value++) values.push(value);
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

function framePieceTileBytes(rom, startOffset, recordLimit = 512) {
  const tileBytes = [];
  const issues = [];
  let pos = startOffset;
  let terminated = false;
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
  return { tileBytes, issues, terminated };
}

function frameTileBytesForEntity(rom, frameLinkCatalog, entityType) {
  const link = (frameLinkCatalog.links || []).find(item => item.entityTypeHex === entityType || item.entityType === entityType);
  const subrecords = link?.frameAsset?.subrecords || [];
  const tileBytes = [];
  const issues = [];
  for (const subrecord of subrecords) {
    const offset = parseHex(subrecord.offset);
    if (offset == null) {
      issues.push({ kind: 'missing_subrecord_offset', subrecordId: subrecord.id || '' });
      continue;
    }
    const parsed = framePieceTileBytes(rom, offset);
    tileBytes.push(...parsed.tileBytes);
    if (!parsed.terminated || parsed.issues.length) {
      issues.push({
        kind: 'frame_subrecord_parse_issue',
        subrecordId: subrecord.id || '',
        offset: subrecord.offset || '',
        terminated: parsed.terminated,
        issues: parsed.issues,
      });
    }
  }
  return {
    tileBytes,
    uniqueTileBytes: [...new Set(tileBytes)].sort((a, b) => a - b),
    issueCount: issues.length,
    issues: issues.slice(0, 8),
  };
}

function fullUncoveredTilesFromFrame(frameTiles, assignedRange) {
  if (!frameTiles || !assignedRange) return null;
  const finalTiles = frameTiles.tileBytes.map(value => (assignedRange.start + value) & 0xff);
  return [...new Set(finalTiles)]
    .filter(value => value < assignedRange.start || value > assignedRange.end)
    .sort((a, b) => a - b);
}

function compactSegments(values) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (!sorted.length) return [];
  const segments = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const value = sorted[i];
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    segments.push({ start: hex(start, 2), end: hex(previous, 2), count: previous - start + 1 });
    start = value;
    previous = value;
  }
  segments.push({ start: hex(start, 2), end: hex(previous, 2), count: previous - start + 1 });
  return segments;
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function bump(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function topCounts(map, limit = 12) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
    .slice(0, limit);
}

function roomIndex(dynamicCatalog) {
  const bySubrecord = new Map();
  for (const room of dynamicCatalog.roomSummaries || []) {
    bySubrecord.set(Number(room.subrecordIndex), room);
  }
  return bySubrecord;
}

function uploadWriters(room) {
  const writers = [];
  for (const upload of room?.uploads || []) {
    const ranges = upload.actualWriteRanges?.length ? upload.actualWriteRanges : [upload.assignedTileRange];
    for (const rangeLike of ranges) {
      const range = parseRange(rangeLike);
      if (!range) continue;
      writers.push({
        entityType: upload.entityType,
        firstRecordIndex: upload.firstRecordIndex,
        table: upload.table,
        tableIndex: upload.tableIndex,
        tableEntryOffset: upload.tableEntryOffset,
        remapRow: upload.remapRow,
        streamRomOffset: upload.streamRomOffset,
        streamRegionId: upload.streamRegion?.id || '',
        sourceRegionIds: upload.sourceRegionIds || [],
        range,
      });
    }
  }
  return writers.sort((a, b) => a.range.start - b.range.start || a.entityType.localeCompare(b.entityType));
}

function classifyTile(tile, check, room, writers) {
  const ownAssigned = parseRange(check.dynamicAssignedTileRange);
  const writerMatches = writers.filter(writer => tile >= writer.range.start && tile <= writer.range.end);
  const ownWriters = writerMatches.filter(writer => writer.entityType === check.entityType);
  const otherWriters = writerMatches.filter(writer => writer.entityType !== check.entityType);
  if (ownWriters.length) {
    return {
      kind: 'covered_by_same_entity_actual_write_range',
      confidence: 'medium',
      tile,
      writers: ownWriters,
    };
  }
  if (otherWriters.length) {
    return {
      kind: 'covered_by_other_room_dynamic_upload',
      confidence: 'medium_high',
      tile,
      writers: otherWriters,
    };
  }
  if (tile < 0x56) {
    return {
      kind: 'below_room_dynamic_start_common_sprite_prereq_candidate',
      confidence: 'medium',
      tile,
      writers: [],
    };
  }
  const finalNext = parseHex(room?.finalNextTile);
  if (finalNext != null && tile >= finalNext) {
    return {
      kind: 'outside_room_dynamic_final_range_unresolved',
      confidence: 'medium_high',
      tile,
      writers: [],
    };
  }
  if (ownAssigned && tile >= ownAssigned.start && tile <= ownAssigned.end) {
    return {
      kind: 'inside_assigned_range_but_not_in_actual_write_range_unresolved',
      confidence: 'low',
      tile,
      writers: [],
    };
  }
  return {
    kind: 'room_dynamic_hole_unresolved',
    confidence: 'medium',
    tile,
    writers: [],
  };
}

function compactWriter(writer) {
  return {
    entityType: writer.entityType,
    firstRecordIndex: writer.firstRecordIndex,
    table: writer.table,
    tableIndex: writer.tableIndex,
    tableEntryOffset: writer.tableEntryOffset,
    remapRow: writer.remapRow,
    streamRomOffset: writer.streamRomOffset,
    streamRegionId: writer.streamRegionId,
    sourceRegionIds: writer.sourceRegionIds,
    range: {
      start: hex(writer.range.start, 2),
      end: hex(writer.range.end, 2),
      count: writer.range.count,
    },
  };
}

function uniqueWriters(writers) {
  const byKey = new Map();
  for (const writer of writers || []) {
    const key = [
      writer.entityType,
      writer.tableEntryOffset,
      writer.streamRomOffset,
      writer.range?.start,
      writer.range?.end,
    ].join('|');
    if (!byKey.has(key)) byKey.set(key, writer);
  }
  return [...byKey.values()];
}

function classifyCheck(check, room, frameTilesByEntity) {
  const writers = uploadWriters(room);
  const assignedRange = parseRange(check.dynamicAssignedTileRange);
  const frameTiles = frameTilesByEntity.get(check.entityType) || null;
  const fullUncoveredTiles = fullUncoveredTilesFromFrame(frameTiles, assignedRange);
  const segmentPreviewTiles = valuesFromSegments(check.uncoveredFinalTileSegments || []);
  const tiles = fullUncoveredTiles || segmentPreviewTiles;
  const byKind = new Map();
  const writerTypes = new Map();
  const tileClassifications = [];
  for (const tile of tiles) {
    const classification = classifyTile(tile, check, room, writers);
    bump(byKind, classification.kind);
    for (const writer of classification.writers) bump(writerTypes, writer.entityType);
    tileClassifications.push(classification);
  }

  const groupedTiles = [];
  for (const [kind] of byKind) {
    const tilesForKind = tileClassifications.filter(item => item.kind === kind).map(item => item.tile);
    const writerSamples = uniqueWriters(tileClassifications
      .filter(item => item.kind === kind)
      .flatMap(item => item.writers || [])
      .slice(0, 64))
      .slice(0, 12)
      .map(compactWriter);
    groupedTiles.push({
      kind,
      tileCount: tilesForKind.length,
      segments: compactSegments(tilesForKind).slice(0, 24),
      writerSamples,
    });
  }
  groupedTiles.sort((a, b) => b.tileCount - a.tileCount || a.kind.localeCompare(b.kind));

  return {
    subrecordIndex: check.subrecordIndex,
    entityType: check.entityType,
    selectorTypeHex: check.selectorTypeHex || '',
    status: check.status,
    roomEntityList: {
      z80Pointer: room?.entityList?.z80Pointer || '',
      romOffset: room?.entityList?.romOffset || '',
      region: room?.entityList?.region || null,
      recordCount: room?.entityList?.recordCount || 0,
    },
    roomDynamicTileStart: room?.dynamicTileStart || '0x056',
    roomFinalNextTile: room?.finalNextTile || '',
    dynamicAssignedTileRange: check.dynamicAssignedTileRange || null,
    finalTileRange: check.finalTileRange || null,
    uncoveredUniqueTileCount: tiles.length,
    expectedUncoveredUniqueTileCount: Number(check.uncoveredUniqueTileCount || 0),
    tileSetSource: fullUncoveredTiles ? 'recomputed_from_frame_subrecords' : 'persisted_uncovered_segment_preview',
    tileSetComplete: Boolean(fullUncoveredTiles) && tiles.length === Number(check.uncoveredUniqueTileCount || tiles.length),
    frameParseIssueCount: frameTiles?.issueCount || 0,
    frameParseIssues: frameTiles?.issues || [],
    classificationCounts: Object.fromEntries([...byKind.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
    otherDynamicWriterEntityTypes: topCounts(writerTypes, 12),
    groupedTiles,
    writerMap: writers.slice(0, 16).map(compactWriter),
  };
}

function buildCatalog(mapData, rom) {
  const dynamicFrameCoverage = requireCatalog(mapData, sourceCatalogIds.dynamicFrameCoverage);
  const dynamicTiles = requireCatalog(mapData, sourceCatalogIds.dynamicTiles);
  requireCatalog(mapData, sourceCatalogIds.frameGap);
  const frameAssets = requireCatalog(mapData, sourceCatalogIds.frameAssets);

  const rooms = roomIndex(dynamicTiles);
  const frameTilesByEntity = new Map();
  for (const check of dynamicFrameCoverage.roomUploadChecks || []) {
    if (!gapStatuses.has(check.status) || frameTilesByEntity.has(check.entityType)) continue;
    frameTilesByEntity.set(check.entityType, frameTileBytesForEntity(rom, frameAssets, check.entityType));
  }
  const checks = (dynamicFrameCoverage.roomUploadChecks || [])
    .filter(check => gapStatuses.has(check.status))
    .map(check => classifyCheck(check, rooms.get(Number(check.subrecordIndex)), frameTilesByEntity))
    .sort((a, b) => b.uncoveredUniqueTileCount - a.uncoveredUniqueTileCount || a.entityType.localeCompare(b.entityType));

  const classificationTileCounts = new Map();
  const classificationCheckCounts = new Map();
  const entityCounts = new Map();
  const otherWriterEntityCounts = new Map();
  let totalUncoveredTileRefs = 0;
  let completeTileSetCheckCount = 0;
  let frameParseIssueCheckCount = 0;
  for (const check of checks) {
    totalUncoveredTileRefs += check.uncoveredUniqueTileCount;
    if (check.tileSetComplete) completeTileSetCheckCount++;
    if (check.frameParseIssueCount) frameParseIssueCheckCount++;
    bump(entityCounts, check.entityType);
    for (const [kind, count] of Object.entries(check.classificationCounts)) {
      bump(classificationTileCounts, kind, count);
      bump(classificationCheckCounts, kind);
    }
    for (const writer of check.otherDynamicWriterEntityTypes) {
      bump(otherWriterEntityCounts, writer.key, writer.count);
    }
  }

  const roomCoveredChecks = checks.filter(check => Number(check.classificationCounts.covered_by_other_room_dynamic_upload || 0) > 0);
  const unresolvedChecks = checks.filter(check => Object.keys(check.classificationCounts).some(kind => kind.includes('unresolved')));
  const commonPrereqChecks = checks.filter(check => Number(check.classificationCounts.below_room_dynamic_start_common_sprite_prereq_candidate || 0) > 0);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: room subrecord indexes, entity type ids, VRAM tile-slot numbers/ranges, source region ids, stream offsets, aggregate counts, and evidence. No ROM bytes, decoded sprites, pixels, screenshots, coordinates, music, text, or gameplay payloads are embedded.',
    semantics: {
      purpose: 'Classify unresolved room-entity frame tile ids against the complete same-room dynamic VRAM writer map.',
      dynamicStartTile: 'Room dynamic entity tile allocation starts at tile slot 0x56 in _LABEL_2948_.',
      writerRule: '_LABEL_A97_ writes each first-seen room entity dynamic tile stream to the current _RAM_D0E1_ tile slot and _LABEL_29E6_ advances _RAM_D0E1_ by _RAM_D0ED_.',
      caution: 'covered_by_other_room_dynamic_upload means another same-room dynamic upload writes that VRAM slot. It is a provenance lead, not yet a claim that the actor intentionally depends on that other entity.',
    },
    summary: {
      gapCheckCount: checks.length,
      roomCoveredCheckCount: roomCoveredChecks.length,
      commonPrereqCheckCount: commonPrereqChecks.length,
      unresolvedCheckCount: unresolvedChecks.length,
      totalUncoveredTileRefs,
      expectedUncoveredTileRefs: checks.reduce((sum, check) => sum + check.expectedUncoveredUniqueTileCount, 0),
      completeTileSetCheckCount,
      frameParseIssueCheckCount,
      classificationTileCounts: Object.fromEntries([...classificationTileCounts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
      classificationCheckCounts: Object.fromEntries([...classificationCheckCounts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
      topGapEntityTypes: topCounts(entityCounts, 12),
      topOtherDynamicWriterEntityTypes: topCounts(otherWriterEntityCounts, 12),
      persistedRomByteCount: 0,
      persistedTileByteCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: no ROM bytes, decoded sprites, pixels, screenshots, coordinates, music, text, or gameplay payloads are embedded.',
    },
    checks,
    evidence: [
      'world-room-entity-dynamic-frame-coverage-catalog-2026-06-25 supplies per-room gap checks and final OAM tile ids.',
      'world-room-entity-dynamic-tile-catalog-2026-06-25 supplies the complete per-room dynamic tile writer map and actual write ranges.',
      'world-room-entity-frame-asset-link-catalog-2026-06-25 supplies frame subrecord offsets used to recompute complete tile-id sets from the local ROM.',
      'ASM lines 6800-6811 initialize room entity dynamic tile allocation at tile slot 0x56.',
      'ASM lines 6893-6930 select the entity dynamic tile stream, call _LABEL_A97_, then advance _RAM_D0E1_ by _RAM_D0ED_.',
      'ASM lines 1979-2038 write OAM tile id as frame tile byte plus IX+63.',
    ],
    nextLeads: [
      'For covered_by_other_room_dynamic_upload checks, trace whether the room entity pair is mandatory or whether the frame asset link is over-broad.',
      'For below_room_dynamic_start_common_sprite_prereq_candidate checks, trace scene/player/common sprite preload slots below 0x56 before rendering those actors.',
      'For outside_room_dynamic_final_range_unresolved checks, inspect frame subrecord grouping and animation selector links for false-positive frame assets.',
    ],
  };
}

function cleanupTransientGapFields(mapData) {
  const catalog = findCatalog(mapData, sourceCatalogIds.dynamicFrameCoverage);
  let removed = 0;
  for (const check of catalog?.roomUploadChecks || []) {
    if (Object.prototype.hasOwnProperty.call(check, '_classification')) {
      delete check._classification;
      removed++;
    }
  }
  return removed;
}

function annotateRegions(mapData, catalog) {
  const touchedStreamRegions = new Map();
  for (const check of catalog.checks) {
    for (const group of check.groupedTiles || []) {
      for (const writer of group.writerSamples || []) {
        if (!writer.streamRegionId) continue;
        const entry = touchedStreamRegions.get(writer.streamRegionId) || {
          checkCount: 0,
          tileCount: 0,
          entityTypes: new Set(),
          writerEntityTypes: new Set(),
        };
        entry.checkCount++;
        entry.tileCount += group.tileCount;
        entry.entityTypes.add(check.entityType);
        entry.writerEntityTypes.add(writer.entityType);
        touchedStreamRegions.set(writer.streamRegionId, entry);
      }
    }
  }

  let annotated = 0;
  for (const [regionId, summary] of touchedStreamRegions.entries()) {
    const region = findRegionById(mapData, regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.roomEntityFrameGapVramWriterAudit = {
      catalogId,
      kind: 'same_room_dynamic_writer_for_frame_gap_slots',
      confidence: 'medium_high',
      checkCount: summary.checkCount,
      tileCount: summary.tileCount,
      entityTypes: [...summary.entityTypes].sort(),
      writerEntityTypes: [...summary.writerEntityTypes].sort(),
      summary: 'This dynamic tile stream region writes VRAM slots that overlap unresolved room-entity frame tile ids in the same room writer map.',
      evidence: [
        'world-room-entity-frame-gap-vram-writer-catalog-2026-06-26 cross-references frame gap tile ids against room dynamic writer ranges.',
        'This is a VRAM-slot provenance lead only; it does not embed or decode sprite graphics.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated++;
  }
  return annotated;
}

function applyCatalog(mapData, catalog) {
  const removedTransientClassifications = cleanupTransientGapFields(mapData);
  const annotatedStreamRegionCount = annotateRegions(mapData, catalog);
  mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(item => item.id !== catalogId);
  mapData.metaspriteCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'room_entity_frame_gap_vram_writer_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedStreamRegionCount,
      removedTransientClassifications,
    },
    topChecks: catalog.checks.slice(0, 24).map(check => ({
      subrecordIndex: check.subrecordIndex,
      entityType: check.entityType,
      status: check.status,
      uncoveredUniqueTileCount: check.uncoveredUniqueTileCount,
      classificationCounts: check.classificationCounts,
      otherDynamicWriterEntityTypes: check.otherDynamicWriterEntityTypes,
    })),
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
  return { annotatedStreamRegionCount, removedTransientClassifications };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, rom);
  let applySummary = {
    annotatedStreamRegionCount: 0,
    removedTransientClassifications: 0,
  };
  if (apply) {
    applySummary = applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    id: catalog.id,
    summary: {
      ...catalog.summary,
      ...applySummary,
    },
    topChecks: catalog.checks.slice(0, 8).map(check => ({
      subrecordIndex: check.subrecordIndex,
      entityType: check.entityType,
      uncoveredUniqueTileCount: check.uncoveredUniqueTileCount,
      classificationCounts: check.classificationCounts,
      otherDynamicWriterEntityTypes: check.otherDynamicWriterEntityTypes,
      groupedTiles: check.groupedTiles.map(group => ({
        kind: group.kind,
        tileCount: group.tileCount,
        segmentCount: group.segments.length,
        segmentSample: group.segments.slice(0, 3),
        writerSampleCount: group.writerSamples.length,
        writerEntityTypes: [...new Set(group.writerSamples.map(writer => writer.entityType))].slice(0, 8),
      })),
    })),
  }, null, 2));
}

main();
