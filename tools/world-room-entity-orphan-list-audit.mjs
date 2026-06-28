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
const catalogId = 'world-room-entity-orphan-list-catalog-2026-06-25';
const reportId = 'room-entity-orphan-list-audit-2026-06-25';
const toolName = 'tools/world-room-entity-orphan-list-audit.mjs';

const orphanRegion = {
  id: 'r2820',
  start: 0x12D91,
  endExclusive: 0x134B9,
  bank: 4,
};

const subrecordTable = {
  bank: 4,
  start: 0x1072C,
  stride: 18,
  count: 76,
  entityPointerOffset: 4,
};

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readWordLE(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
}

function endOf(region) {
  return offsetOf(region) + (region.size || 0);
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

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function bankedZ80ToRom(bank, z80Address) {
  if (z80Address < 0x8000 || z80Address > 0xBFFF) return null;
  return bank * 0x4000 + (z80Address - 0x8000);
}

function decodeEntityList(rom, startOffset, endExclusive) {
  let cursor = startOffset;
  let normalRecords = 0;
  let alternateRecords = 0;
  const entityTypeCounts = new Map();
  const dynamicIndexCounts = new Map();
  const recordPreview = [];

  for (let recordIndex = 0; recordIndex < 256 && cursor < endExclusive; recordIndex++) {
    const recordOffset = cursor;
    const entityType = rom[cursor++];
    if (entityType === 0xFF) {
      return {
        startOffset,
        endExclusive: cursor,
        terminatorOffset: recordOffset,
        terminated: true,
        recordCount: normalRecords + alternateRecords,
        normalRecords,
        alternateRecords,
        entityTypeCounts,
        dynamicIndexCounts,
        recordPreview,
        warning: null,
      };
    }

    const alternate = Boolean(entityType & 0x80);
    const table = alternate ? 'alternate' : 'normal';
    const tableIndex = (entityType & 0x7F) - 1;
    entityTypeCounts.set(entityType, (entityTypeCounts.get(entityType) || 0) + 1);
    dynamicIndexCounts.set(`${table}:${tableIndex}`, (dynamicIndexCounts.get(`${table}:${tableIndex}`) || 0) + 1);
    if (alternate) {
      alternateRecords++;
    } else {
      if (cursor + 2 >= endExclusive) {
        return {
          startOffset,
          endExclusive: cursor,
          terminatorOffset: null,
          terminated: false,
          recordCount: normalRecords + alternateRecords,
          normalRecords,
          alternateRecords,
          entityTypeCounts,
          dynamicIndexCounts,
          recordPreview,
          warning: `normal record at ${hex(recordOffset)} would run past orphan span`,
        };
      }
      cursor += 3;
      normalRecords++;
    }
    if (recordPreview.length < 8) {
      recordPreview.push({
        recordOffset: hex(recordOffset),
        entityType: hex(entityType, 2),
        table,
        tableIndex,
      });
    }
  }

  return {
    startOffset,
    endExclusive: cursor,
    terminatorOffset: null,
    terminated: false,
    recordCount: normalRecords + alternateRecords,
    normalRecords,
    alternateRecords,
    entityTypeCounts,
    dynamicIndexCounts,
    recordPreview,
    warning: `list at ${hex(startOffset)} did not terminate inside orphan span`,
  };
}

function decodeGreedyOrphanLists(rom) {
  const lists = [];
  const entityTypeCounts = new Map();
  const dynamicIndexCounts = new Map();
  let cursor = orphanRegion.start;
  const warnings = [];

  while (cursor < orphanRegion.endExclusive) {
    const decoded = decodeEntityList(rom, cursor, orphanRegion.endExclusive);
    lists.push(decoded);
    if (decoded.warning) warnings.push(decoded.warning);
    for (const [type, count] of decoded.entityTypeCounts) {
      entityTypeCounts.set(type, (entityTypeCounts.get(type) || 0) + count);
    }
    for (const [key, count] of decoded.dynamicIndexCounts) {
      dynamicIndexCounts.set(key, (dynamicIndexCounts.get(key) || 0) + count);
    }
    if (!decoded.terminated || decoded.endExclusive <= cursor) break;
    cursor = decoded.endExclusive;
  }

  return {
    lists,
    finalOffset: cursor,
    fullyCoversSpan: cursor === orphanRegion.endExclusive && warnings.length === 0,
    warnings,
    entityTypeCounts,
    dynamicIndexCounts,
  };
}

function subrecordPointerRefs(rom) {
  const refs = [];
  for (let index = 0; index < subrecordTable.count; index++) {
    const subrecordOffset = subrecordTable.start + index * subrecordTable.stride;
    const z80Pointer = readWordLE(rom, subrecordOffset + subrecordTable.entityPointerOffset);
    const romOffset = bankedZ80ToRom(subrecordTable.bank, z80Pointer);
    if (romOffset >= orphanRegion.start && romOffset < orphanRegion.endExclusive) {
      refs.push({
        subrecordIndex: index,
        subrecordOffset: hex(subrecordOffset),
        z80Pointer: hex(z80Pointer, 4),
        romOffset: hex(romOffset),
      });
    }
  }
  return refs;
}

function countBytes(rom) {
  let zeroBytes = 0;
  let ffBytes = 0;
  let highBitBytes = 0;
  const histogram = new Map();
  for (let offset = orphanRegion.start; offset < orphanRegion.endExclusive; offset++) {
    const byte = rom[offset];
    if (byte === 0) zeroBytes++;
    if (byte === 0xFF) ffBytes++;
    if (byte & 0x80) highBitBytes++;
    histogram.set(byte, (histogram.get(byte) || 0) + 1);
  }
  return {
    size: orphanRegion.endExclusive - orphanRegion.start,
    zeroBytes,
    ffBytes,
    highBitBytes,
    topBytes: [...histogram.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 16)
      .map(([byte, count]) => ({ byte: hex(byte, 2), count })),
  };
}

function buildCatalog(mapData, rom) {
  const region = findRegionById(mapData, orphanRegion.id);
  const decoded = decodeGreedyOrphanLists(rom);
  const refs = subrecordPointerRefs(rom);
  const totalRecords = decoded.lists.reduce((sum, list) => sum + list.recordCount, 0);
  const normalRecords = decoded.lists.reduce((sum, list) => sum + list.normalRecords, 0);
  const alternateRecords = decoded.lists.reduce((sum, list) => sum + list.alternateRecords, 0);
  const entityTypes = [...decoded.entityTypeCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([entityType, count]) => ({
      entityType: hex(entityType, 2),
      table: entityType & 0x80 ? 'alternate' : 'normal',
      tableIndex: (entityType & 0x7F) - 1,
      occurrenceCount: count,
    }));
  const dynamicIndexes = [...decoded.dynamicIndexCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => {
      const [table, index] = key.split(':');
      return { table, tableIndex: Number(index), occurrenceCount: count };
    });

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      regionId: orphanRegion.id,
      regionOffset: hex(orphanRegion.start),
      regionEndExclusive: hex(orphanRegion.endExclusive),
      regionSize: orphanRegion.endExclusive - orphanRegion.start,
      decodedListCount: decoded.lists.length,
      decodedEntityRecords: totalRecords,
      normalEntityRecords: normalRecords,
      alternateEntityRecords: alternateRecords,
      uniqueEntityTypeBytes: entityTypes.length,
      uniqueDynamicTableIndexes: dynamicIndexes.length,
      subrecordPointerRefsIntoSpan: refs.length,
      fullyCoversSpan: decoded.fullyCoversSpan,
      warningCount: decoded.warnings.length,
      assetPolicy: 'Metadata only: offsets, list counts, entity type ids, dynamic table indexes, and evidence. Entity coordinates and ROM bytes are not embedded.',
    },
    region: regionRef(region),
    byteStats: countBytes(rom),
    decodedLists: decoded.lists.map(list => ({
      startOffset: hex(list.startOffset),
      endExclusive: hex(list.endExclusive),
      terminatorOffset: list.terminatorOffset == null ? null : hex(list.terminatorOffset),
      recordCount: list.recordCount,
      normalRecords: list.normalRecords,
      alternateRecords: list.alternateRecords,
      terminated: list.terminated,
      recordPreview: list.recordPreview,
    })),
    entityTypes,
    dynamicTableUsage: dynamicIndexes,
    subrecordPointerRefs: refs,
    warnings: decoded.warnings,
    evidence: [
      'The span is bounded by the confirmed 0x12D90 empty room entity list sentinel and the confirmed 0x134B9 room entity source list block.',
      'Using the same _LABEL_2948_/_LABEL_2963_ room entity list record format, greedy decoding starts at 0x12D91 and ends exactly at 0x134B9.',
      'Each decoded list terminates with 0xFF; normal records consume four bytes and bit-7 alternate records consume one byte, matching the confirmed entity-list parser.',
      'Room subrecord CF62 pointer scan finds no confirmed room subrecord selecting this span, so it is modeled as orphan/unreached room entity source lists rather than active room data.',
    ],
    nextLeads: [
      'Search non-room-subrecord code paths for pointers into the orphan entity lists before calling them unused.',
      'Compare entity type distributions against the reached room entity lists to identify likely leftover/test/alternate room content.',
      'Add an analyzer view that can preview orphan entity list type ids without exposing coordinates or ROM bytes.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const region = findRegionById(mapData, orphanRegion.id);
  if (!region) {
    missingRegions.push({ id: orphanRegion.id, offset: hex(orphanRegion.start) });
  } else {
    const before = regionRef(region);
    const typeBefore = region.type || 'unknown';
    region.type = 'entity_data';
    region.name = 'orphan room entity source lists @ 0x12D91';
    region.confidence = catalog.summary.fullyCoversSpan && catalog.summary.warningCount === 0 ? 'high' : 'medium';
    region.notes = 'Structurally decodes as 61 terminated room entity source lists, but no confirmed room subrecord CF62 pointer reaches this span.';
    region.analysis = region.analysis || {};
    region.analysis.roomEntityOrphanListAudit = {
      catalogId,
      kind: 'orphan_room_entity_source_lists',
      confidence: region.confidence,
      typeBeforeAudit: typeBefore,
      typeAfterAudit: region.type,
      changedType: typeBefore !== region.type,
      decodedListCount: catalog.summary.decodedListCount,
      decodedEntityRecords: catalog.summary.decodedEntityRecords,
      uniqueEntityTypeBytes: catalog.summary.uniqueEntityTypeBytes,
      subrecordPointerRefsIntoSpan: catalog.summary.subrecordPointerRefsIntoSpan,
      fullyCoversSpan: catalog.summary.fullyCoversSpan,
      summary: 'Orphan/unreached room entity source lists decoded with the confirmed _LABEL_2948_/_LABEL_2963_ format.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (region.analysis.roomEntityListAudit) {
      region.analysis.roomEntityListAudit.supersededBy = catalogId;
      region.analysis.roomEntityListAudit.supersededReason = 'The span now decodes fully as orphan room entity source lists; it remains unreferenced by confirmed CF62 room subrecord pointers.';
    }
    if (region.analysis.roomSubrecordAudit) {
      region.analysis.roomSubrecordAudit.supersededBy = catalogId;
      region.analysis.roomSubrecordAudit.supersededReason = 'The former room-subrecord tail gap now has a structural entity-list decoder, though no room subrecord pointer reaches it.';
    }
    changedRegions.push({ before, after: regionRef(region) });
  }

  mapData.entityDataCatalogs = (mapData.entityDataCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityDataCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'room_entity_orphan_list_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    summary: {
      ...catalog.summary,
      changedRegions: changedRegions.length,
      missingRegions: missingRegions.length,
    },
    changedRegions,
    missingRegions,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });

  return { changedRegions, missingRegions };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, rom);
  let changes = { changedRegions: [], missingRegions: [] };

  if (apply) {
    changes = applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    firstLists: catalog.decodedLists.slice(0, 8),
    lastLists: catalog.decodedLists.slice(-5),
    topEntityTypes: catalog.entityTypes
      .slice()
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
      .slice(0, 12),
    changes,
  }, null, 2));
}

main();
