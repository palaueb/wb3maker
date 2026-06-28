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
const catalogId = 'world-room-entity-dynamic-tile-catalog-2026-06-25';
const reportId = 'room-entity-dynamic-tile-audit-2026-06-25';
const toolName = 'tools/world-room-entity-dynamic-tile-audit.mjs';

const subrecordTable = {
  bank: 4,
  start: 0x1072C,
  stride: 18,
  count: 76,
  entityPointerOffset: 4,
};

const dynamicTables = {
  normal: {
    id: 'entity_dynamic_tiles_normal',
    z80Base: 0x9D60,
    romBase: 0x1DD60,
    slots: 80,
  },
  alternate: {
    id: 'entity_dynamic_tiles_alternate',
    z80Base: 0x9E00,
    romBase: 0x1DE00,
    slots: 16,
  },
};

const dynamicTileStart = 0x56;
const knownRegions = {
  roomEntityLists: 'r2821',
  dynamicLoaderBundles: ['r2749', 'r2717', 'r2719', 'r2720'],
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

function bankedZ80ToRom(bank, z80Address) {
  if (z80Address < 0x8000 || z80Address > 0xBFFF) return null;
  return bank * 0x4000 + (z80Address - 0x8000);
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

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offset >= offsetOf(region) && offset < endOf(region)) || null;
}

function mergeRanges(ranges) {
  const sorted = ranges
    .filter(range => range.end >= range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end + 1) {
      merged.push({ ...range });
    } else if (range.end > last.end) {
      last.end = range.end;
    }
  }
  return merged;
}

function decodeRoomEntityList(rom, startOffset) {
  let cursor = startOffset;
  const records = [];
  let terminated = false;
  let warning = null;

  for (let index = 0; index < 128 && cursor < rom.length; index++) {
    const recordOffset = cursor;
    const entityType = rom[cursor++];
    if (entityType === 0xFF) {
      terminated = true;
      break;
    }
    const table = (entityType & 0x80) ? 'alternate' : 'normal';
    const tableIndex = (entityType & 0x7F) - 1;
    if (table === 'normal') {
      if (cursor + 2 >= rom.length) {
        warning = `truncated normal entity record at ${hex(recordOffset)}`;
        break;
      }
      cursor += 3;
    }
    records.push({ index, recordOffset, entityType, table, tableIndex });
  }

  if (!terminated && !warning) warning = `room entity list did not terminate within 128 records at ${hex(startOffset)}`;
  return { startOffset, endExclusive: cursor, terminated, warning, records };
}

function dynamicEntryForEntity(rom, entityType) {
  const tableName = (entityType & 0x80) ? 'alternate' : 'normal';
  const tableIndex = (entityType & 0x7F) - 1;
  const table = dynamicTables[tableName];
  if (!table || tableIndex < 0 || tableIndex >= table.slots) return null;
  const entryOffset = table.romBase + tableIndex * 2;
  const word = readWordLE(rom, entryOffset);
  const remapRow = (word >>> 14) & 0x03;
  const streamZ80Address = (word & 0x3FFF) | 0x8000;
  return {
    tableName,
    tableId: table.id,
    tableIndex,
    entryOffset,
    word,
    remapRow,
    streamZ80Address,
    streamRomOffset: bankedZ80ToRom(7, streamZ80Address),
    zeroPadding: word === 0,
  };
}

function sourceWordToSpan(word, count, mapData) {
  const sourceBank = word >>> 9;
  const tileIndex = word & 0x01FF;
  const sourceZ80Address = 0x8000 + tileIndex * 32;
  const sourceRomOffset = bankedZ80ToRom(sourceBank, sourceZ80Address);
  const sourceRegion = sourceRomOffset == null ? null : findContainingRegion(mapData, sourceRomOffset);
  return {
    sourceBank,
    sourceTileIndex: tileIndex,
    sourceZ80Address,
    sourceRomOffset,
    byteCount: count * 32,
    sourceRegion: regionRef(sourceRegion),
  };
}

function decodeDynamicStreamRuntime(rom, mapData, streamOffset, initialTile) {
  let cursor = streamOffset;
  let vramPtr = initialTile * 32;
  let uploadedTileBlocks = 0;
  let sourceRecordCount = 0;
  let zeroFillTileBlocks = 0;
  let destinationResetCount = 0;
  let terminated = false;
  let warning = null;
  const writeRanges = [];
  const sourceRegions = new Set();

  for (let step = 0; step < 256 && cursor < rom.length; step++) {
    let count = rom[cursor++];
    if (count === 0x00) {
      terminated = true;
      break;
    }

    const setDestination = Boolean(count & 0x80);
    count &= 0x7F;
    if (setDestination) {
      const tileSlot = rom[cursor++];
      vramPtr = tileSlot * 32;
      destinationResetCount++;
    }

    const tileStart = vramPtr >> 5;
    if (count === 0x7F) {
      writeRanges.push({ start: tileStart, end: tileStart });
      vramPtr += 32;
      uploadedTileBlocks++;
      zeroFillTileBlocks++;
      continue;
    }

    const sourceWord = readWordLE(rom, cursor);
    cursor += 2;
    const source = sourceWordToSpan(sourceWord, count, mapData);
    if (source.sourceRegion?.id) sourceRegions.add(source.sourceRegion.id);
    writeRanges.push({ start: tileStart, end: tileStart + count - 1 });
    vramPtr += count * 32;
    uploadedTileBlocks += count;
    sourceRecordCount++;
  }

  if (!terminated && !warning) warning = `dynamic stream did not terminate within 256 parser steps at ${hex(streamOffset)}`;
  return {
    streamOffset,
    endExclusive: cursor,
    consumedBytes: cursor - streamOffset,
    terminated,
    warning,
    uploadedTileBlocks,
    sourceRecordCount,
    zeroFillTileBlocks,
    destinationResetCount,
    writeRanges: mergeRanges(writeRanges),
    sourceRegionIds: [...sourceRegions].sort(),
  };
}

function objectIncrement(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function sortedObjectFromMap(map, keyFormatter = key => key) {
  return Object.fromEntries(
    [...map.entries()]
      .sort((a, b) => {
        const ak = typeof a[0] === 'number' ? a[0] : String(a[0]);
        const bk = typeof b[0] === 'number' ? b[0] : String(b[0]);
        return ak < bk ? -1 : ak > bk ? 1 : 0;
      })
      .map(([key, value]) => [keyFormatter(key), value]),
  );
}

function buildCatalog(mapData, rom) {
  const roomSummaries = [];
  const streamUsage = new Map();
  const streamTileTotals = new Map();
  const entityUploadUsage = new Map();
  const finalTileHistogram = new Map();
  const sourceRegionUsage = new Map();
  const warnings = [];
  let totalEntityRecords = 0;
  let totalUploads = 0;
  let maxUploadsPerRoom = 0;
  let maxFinalTile = dynamicTileStart;

  for (let subrecordIndex = 0; subrecordIndex < subrecordTable.count; subrecordIndex++) {
    const subrecordOffset = subrecordTable.start + subrecordIndex * subrecordTable.stride;
    const entityListZ80 = readWordLE(rom, subrecordOffset + subrecordTable.entityPointerOffset);
    const entityListRom = bankedZ80ToRom(subrecordTable.bank, entityListZ80);
    const listRegion = entityListRom == null ? null : findContainingRegion(mapData, entityListRom);
    const decodedList = entityListRom == null ? { records: [], terminated: false, warning: 'entity list pointer outside bank window' } : decodeRoomEntityList(rom, entityListRom);
    if (decodedList.warning) warnings.push({ subrecordIndex, warning: decodedList.warning });

    const seenEntityTypes = new Set();
    let nextTile = dynamicTileStart;
    const uploads = [];

    for (const record of decodedList.records) {
      totalEntityRecords++;
      if (seenEntityTypes.has(record.entityType)) continue;
      seenEntityTypes.add(record.entityType);
      const entry = dynamicEntryForEntity(rom, record.entityType);
      if (!entry || entry.streamRomOffset == null || entry.zeroPadding) {
        warnings.push({
          subrecordIndex,
          entityType: hex(record.entityType, 2),
          warning: 'entity type does not resolve to a live dynamic tile table entry',
        });
        continue;
      }
      const streamRegion = findContainingRegion(mapData, entry.streamRomOffset);
      const decodedStream = decodeDynamicStreamRuntime(rom, mapData, entry.streamRomOffset, nextTile);
      if (decodedStream.warning) {
        warnings.push({
          subrecordIndex,
          entityType: hex(record.entityType, 2),
          streamRomOffset: hex(entry.streamRomOffset),
          warning: decodedStream.warning,
        });
      }

      const assignedStart = nextTile;
      const assignedEnd = nextTile + decodedStream.uploadedTileBlocks - 1;
      const upload = {
        entityType: hex(record.entityType, 2),
        firstRecordIndex: record.index,
        firstRecordOffset: hex(record.recordOffset),
        table: entry.tableName,
        tableIndex: entry.tableIndex,
        tableEntryOffset: hex(entry.entryOffset),
        remapRow: entry.remapRow,
        streamRomOffset: hex(entry.streamRomOffset),
        streamRegion: regionRef(streamRegion),
        assignedTileRange: {
          start: hex(assignedStart, 3),
          end: hex(assignedEnd, 3),
          count: decodedStream.uploadedTileBlocks,
        },
        actualWriteRanges: decodedStream.writeRanges.map(range => ({
          start: hex(range.start, 3),
          end: hex(range.end, 3),
          count: range.end - range.start + 1,
        })),
        sourceRecordCount: decodedStream.sourceRecordCount,
        zeroFillTileBlocks: decodedStream.zeroFillTileBlocks,
        destinationResetCount: decodedStream.destinationResetCount,
        sourceRegionIds: decodedStream.sourceRegionIds,
      };
      uploads.push(upload);
      totalUploads++;
      objectIncrement(streamUsage, entry.streamRomOffset);
      objectIncrement(streamTileTotals, entry.streamRomOffset, decodedStream.uploadedTileBlocks);
      objectIncrement(entityUploadUsage, record.entityType);
      for (const sourceRegionId of decodedStream.sourceRegionIds) objectIncrement(sourceRegionUsage, sourceRegionId);
      nextTile += decodedStream.uploadedTileBlocks;
    }

    objectIncrement(finalTileHistogram, nextTile);
    maxFinalTile = Math.max(maxFinalTile, nextTile);
    maxUploadsPerRoom = Math.max(maxUploadsPerRoom, uploads.length);
    roomSummaries.push({
      subrecordIndex,
      subrecordOffset: hex(subrecordOffset),
      entityList: {
        z80Pointer: hex(entityListZ80, 4),
        romOffset: entityListRom == null ? null : hex(entityListRom),
        region: regionRef(listRegion),
        recordCount: decodedList.records.length,
        uniqueEntityTypeCount: seenEntityTypes.size,
        terminated: decodedList.terminated,
      },
      dynamicTileStart: hex(dynamicTileStart, 3),
      finalNextTile: hex(nextTile, 3),
      uploadCount: uploads.length,
      uploads,
    });
  }

  const streamSummaries = [...streamUsage.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([streamOffset, uploadCount]) => {
      const region = findContainingRegion(mapData, streamOffset);
      return {
        streamRomOffset: hex(streamOffset),
        streamRegion: regionRef(region),
        uploadCount,
        uploadedTileBlocks: streamTileTotals.get(streamOffset) || 0,
      };
    });

  const entityUploadSummaries = [...entityUploadUsage.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([entityType, uploadCount]) => ({
      entityType: hex(entityType, 2),
      table: (entityType & 0x80) ? 'alternate' : 'normal',
      tableIndex: (entityType & 0x7F) - 1,
      uploadCount,
    }));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      'world-room-entity-list-catalog-2026-06-25',
      'world-dynamic-tile-source-table-catalog-2026-06-25',
      'world-dynamic-tile-upload-catalog-2026-06-25',
    ],
    runtimeModel: {
      routine: '_LABEL_2948_/_LABEL_2963_ local ++++ dynamic upload path',
      initialDynamicTile: hex(dynamicTileStart, 3),
      dedupeRule: 'Within one room entity list, the first occurrence of an entity type uploads dynamic tiles; later occurrences reuse the first tile base stored in the seven-byte _RAM_D030_ record.',
      tileAdvanceRule: '_RAM_D0E1_ is advanced by _RAM_D0ED_ after _LABEL_A97_ returns.',
      tableSelectRule: 'Entity type bit 7 selects $9E00 alternate table; otherwise $9D60 normal table. Index is (entityType & 0x7F) - 1.',
    },
    summary: {
      subrecordCount: subrecordTable.count,
      totalEntityRecords,
      totalFirstSeenEntityUploads: totalUploads,
      uniqueEntityTypesUploaded: entityUploadUsage.size,
      uniqueDynamicStreamsUsed: streamUsage.size,
      maxUploadsPerRoom,
      initialDynamicTile: hex(dynamicTileStart, 3),
      maxFinalNextTile: hex(maxFinalTile, 3),
      maxAssignedTileInclusive: hex(maxFinalTile - 1, 3),
      finalNextTileHistogram: sortedObjectFromMap(finalTileHistogram, value => hex(value, 3)),
      sourceRegionUsage: sortedObjectFromMap(sourceRegionUsage),
      warningCount: warnings.length,
      assetPolicy: 'Metadata only: entity type ids, room subrecord indexes, stream offsets, tile-slot ranges, counts, and region ids. No ROM bytes, graphics, coordinates, decoded pixels, screenshots, or rendered assets are embedded.',
    },
    streamUsage: streamSummaries,
    entityUploadUsage: entityUploadSummaries,
    roomSummaries,
    warnings,
    evidence: [
      'ASM lines 6800-6811 initialize _RAM_D030_, load the room entity list pointer from _RAM_CF62_, clear counters, and seed _RAM_D0E1_ with 0x56.',
      'ASM lines 6811-6891 decode room entity records and scan previous records so duplicate entity types reuse the existing tile base instead of uploading again.',
      'ASM lines 6893-6925 select bank 7, index $9D60/$9E00 by entity type, derive _RAM_D0EC_, convert _RAM_D0E1_ to a VDP byte address through _LABEL_B8F_, and call _LABEL_A97_.',
      'ASM lines 6926-6930 add _RAM_D0ED_ to _RAM_D0E1_ after the dynamic tile upload.',
    ],
    nextLeads: [
      'Expose this runtime model in the simulator so selecting a room subrecord can populate dynamic entity tiles before rendering sprites.',
      'Connect entity type ids to _DATA_668E_ behavior table families and animation tile-base audits to name enemy/object classes.',
      'Investigate the unresolved r2820 middle span with bank-4 pointer-flow scans now that confirmed entity-list coverage is separated.',
    ],
  };
}

function annotateRegion(region, audit) {
  region.analysis = region.analysis || {};
  region.analysis.roomEntityDynamicTileAudit = audit;
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const entityRegion = findRegionById(mapData, knownRegions.roomEntityLists);
  if (entityRegion) {
    annotateRegion(entityRegion, {
      catalogId,
      kind: 'room_entity_dynamic_tile_runtime_model',
      confidence: 'high',
      summary: 'Models _LABEL_2948_ first-seen entity dynamic tile uploads from room entity lists into VRAM tile slots starting at $56.',
      totalFirstSeenEntityUploads: catalog.summary.totalFirstSeenEntityUploads,
      uniqueDynamicStreamsUsed: catalog.summary.uniqueDynamicStreamsUsed,
      maxFinalNextTile: catalog.summary.maxFinalNextTile,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    });
    changedRegions.push(regionRef(entityRegion));
  } else {
    missingRegions.push({ id: knownRegions.roomEntityLists, role: 'room_entity_source_lists' });
  }

  for (const regionId of knownRegions.dynamicLoaderBundles) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'dynamic_tile_loader_bundle' });
      continue;
    }
    const streams = catalog.streamUsage.filter(item => item.streamRegion?.id === regionId);
    annotateRegion(region, {
      catalogId,
      kind: 'room_entity_dynamic_tile_stream_usage',
      confidence: streams.length ? 'high' : 'medium',
      summary: streams.length
        ? 'Dynamic tile loader streams in this region are reached by first-seen room entity type uploads.'
        : 'No first-seen room entity uploads currently target this dynamic loader region.',
      streamCount: streams.length,
      uploadCount: streams.reduce((sum, item) => sum + item.uploadCount, 0),
      uploadedTileBlocks: streams.reduce((sum, item) => sum + item.uploadedTileBlocks, 0),
      streamOffsets: streams.slice(0, 24).map(item => item.streamRomOffset),
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    });
    changedRegions.push(regionRef(region));
  }

  mapData.entityDataCatalogs = (mapData.entityDataCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityDataCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'room_entity_dynamic_tile_audit',
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
    topStreams: catalog.streamUsage.slice(0, 12),
    topEntityUploads: catalog.entityUploadUsage.slice(0, 12),
    roomSample: catalog.roomSummaries.slice(0, 6).map(room => ({
      subrecordIndex: room.subrecordIndex,
      entityList: room.entityList,
      finalNextTile: room.finalNextTile,
      uploadCount: room.uploadCount,
      uploads: room.uploads.map(upload => ({
        entityType: upload.entityType,
        streamRomOffset: upload.streamRomOffset,
        assignedTileRange: upload.assignedTileRange,
      })),
    })),
    changedRegionCount: changes.changedRegions.length,
    missingRegionCount: changes.missingRegions.length,
  }, null, 2));
}

main();
