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
const catalogId = 'world-room-entity-list-catalog-2026-06-25';
const reportId = 'room-entity-list-audit-2026-06-25';
const toolName = 'tools/world-room-entity-list-audit.mjs';

const subrecordTable = {
  regionId: 'r0341',
  bank: 4,
  start: 0x1072C,
  stride: 18,
  count: 76,
  entityPointerOffset: 4,
};

const previousMixedRegion = {
  id: 'r2818',
  start: 0x12D90,
  endExclusive: 0x13AD0,
};

const splitPlan = {
  sentinel: {
    start: 0x12D90,
    size: 1,
    type: 'entity_data',
    name: 'empty room entity list sentinel @ 0x12D90',
    role: 'room_entity_empty_list_sentinel',
    confidence: 'high',
  },
  unresolvedMiddle: {
    start: 0x12D91,
    size: 0x0728,
    type: 'data_table',
    name: 'unreached room-entity-list gap @ 0x12D91',
    role: 'room_entity_list_gap_unresolved',
    confidence: 'low',
  },
  entityLists: {
    start: 0x134B9,
    size: 0x0617,
    type: 'entity_data',
    name: 'room entity source lists @ 0x134B9',
    role: 'room_entity_source_lists',
    confidence: 'high',
  },
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

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offset >= offsetOf(region) && offset < endOf(region)) || null;
}

function nextRegionNumber(mapData) {
  let maxId = 0;
  for (const region of mapData.regions || []) {
    const match = /^r(\d+)$/.exec(region.id || '');
    if (match) maxId = Math.max(maxId, Number(match[1]));
  }
  return maxId + 1;
}

function formatRegionId(n) {
  return 'r' + String(n).padStart(4, '0');
}

function normalizeDynamicSourceWord(word) {
  return {
    remapRow: (word >>> 14) & 0x03,
    streamZ80Address: (word & 0x3FFF) | 0x8000,
    streamRomOffset: bankedZ80ToRom(7, (word & 0x3FFF) | 0x8000),
  };
}

function readDynamicTableEntry(rom, tableId, index) {
  const table = tableId === 'alternate'
    ? { base: 0x1DE00, slots: 16, catalogId: 'entity_dynamic_tiles_alternate' }
    : { base: 0x1DD60, slots: 80, catalogId: 'entity_dynamic_tiles_normal' };
  if (index < 0 || index >= table.slots) return null;
  const entryOffset = table.base + index * 2;
  const word = readWordLE(rom, entryOffset);
  const normalized = normalizeDynamicSourceWord(word);
  return {
    table: tableId,
    catalogTableId: table.catalogId,
    index,
    entryOffset,
    word,
    isZeroPadding: word === 0,
    ...normalized,
  };
}

function decodeEntityList(rom, mapData, startOffset) {
  let cursor = startOffset;
  const records = [];
  const entityTypeCounts = new Map();
  const dynamicIndexCounts = new Map();
  let terminated = false;
  let warning = null;

  for (let step = 0; step < 128 && cursor < rom.length; step++) {
    const recordOffset = cursor;
    const entityType = rom[cursor++];
    if (entityType === 0xFF) {
      terminated = true;
      break;
    }
    const alternate = Boolean(entityType & 0x80);
    const table = alternate ? 'alternate' : 'normal';
    const tableIndex = (entityType & 0x7F) - 1;
    entityTypeCounts.set(entityType, (entityTypeCounts.get(entityType) || 0) + 1);
    dynamicIndexCounts.set(`${table}:${tableIndex}`, (dynamicIndexCounts.get(`${table}:${tableIndex}`) || 0) + 1);
    if (!alternate) {
      if (cursor + 2 >= rom.length) {
        warning = `truncated normal room entity record at ${hex(recordOffset)}`;
        break;
      }
      cursor += 3;
    }
    records.push({ recordOffset, entityType, table, tableIndex });
  }

  if (!terminated && !warning) warning = `room entity list did not terminate within 128 records at ${hex(startOffset)}`;
  const containingRegion = findContainingRegion(mapData, startOffset);
  return {
    startOffset,
    endExclusive: cursor,
    terminatorOffset: terminated ? cursor - 1 : null,
    terminated,
    warning,
    recordCount: records.length,
    containingRegion: regionRef(containingRegion),
    entityTypeCounts,
    dynamicIndexCounts,
    recordPreview: records.slice(0, 8).map(record => ({
      recordOffset: hex(record.recordOffset),
      entityType: hex(record.entityType, 2),
      table: record.table,
      tableIndex: record.tableIndex,
    })),
  };
}

function buildCatalog(mapData, rom) {
  const pointerRefs = [];
  const listMap = new Map();
  const entityTypeUsage = new Map();
  const dynamicIndexUsage = new Map();
  const warnings = [];

  for (let index = 0; index < subrecordTable.count; index++) {
    const subrecordOffset = subrecordTable.start + index * subrecordTable.stride;
    const z80Pointer = readWordLE(rom, subrecordOffset + subrecordTable.entityPointerOffset);
    const romOffset = bankedZ80ToRom(subrecordTable.bank, z80Pointer);
    const subrecordRegion = findContainingRegion(mapData, subrecordOffset);
    const listRegion = romOffset == null ? null : findContainingRegion(mapData, romOffset);
    pointerRefs.push({
      subrecordIndex: index,
      subrecordOffset,
      z80Pointer,
      romOffset,
      subrecordRegion: regionRef(subrecordRegion),
      listRegion: regionRef(listRegion),
    });
    if (romOffset == null) {
      warnings.push({ subrecordIndex: index, warning: `entity pointer ${hex(z80Pointer, 4)} is outside the bank-4 $8000-$BFFF window` });
      continue;
    }
    if (!listMap.has(romOffset)) {
      const decoded = decodeEntityList(rom, mapData, romOffset);
      listMap.set(romOffset, {
        z80Pointer,
        romOffset,
        subrecordIndexes: [],
        decoded,
      });
      if (decoded.warning) warnings.push({ listOffset: hex(romOffset), warning: decoded.warning });
    }
    listMap.get(romOffset).subrecordIndexes.push(index);
  }

  for (const list of listMap.values()) {
    for (const [entityType, count] of list.decoded.entityTypeCounts) {
      const item = entityTypeUsage.get(entityType) || {
        entityType,
        table: entityType & 0x80 ? 'alternate' : 'normal',
        tableIndex: (entityType & 0x7F) - 1,
        occurrenceCount: 0,
        listOffsets: new Set(),
        subrecordIndexes: new Set(),
      };
      item.occurrenceCount += count;
      item.listOffsets.add(list.romOffset);
      for (const subrecordIndex of list.subrecordIndexes) item.subrecordIndexes.add(subrecordIndex);
      entityTypeUsage.set(entityType, item);
    }
    for (const [key, count] of list.decoded.dynamicIndexCounts) {
      const item = dynamicIndexUsage.get(key) || { key, occurrenceCount: 0, listOffsets: new Set(), subrecordIndexes: new Set() };
      item.occurrenceCount += count;
      item.listOffsets.add(list.romOffset);
      for (const subrecordIndex of list.subrecordIndexes) item.subrecordIndexes.add(subrecordIndex);
      dynamicIndexUsage.set(key, item);
    }
  }

  const lists = [...listMap.values()].sort((a, b) => a.romOffset - b.romOffset);
  const intervals = lists.map(list => ({
    start: list.decoded.startOffset,
    endExclusive: list.decoded.endExclusive,
  }));
  const mergedIntervals = [];
  for (const interval of intervals.sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive)) {
    const last = mergedIntervals[mergedIntervals.length - 1];
    if (!last || interval.start > last.endExclusive) {
      mergedIntervals.push({ ...interval });
    } else if (interval.endExclusive > last.endExclusive) {
      last.endExclusive = interval.endExclusive;
    }
  }

  const entityTypes = [...entityTypeUsage.values()]
    .sort((a, b) => a.entityType - b.entityType)
    .map(item => {
      const tableEntry = readDynamicTableEntry(rom, item.table, item.tableIndex);
      const streamRegion = tableEntry?.streamRomOffset == null ? null : findContainingRegion(mapData, tableEntry.streamRomOffset);
      return {
        entityType: hex(item.entityType, 2),
        table: item.table,
        tableIndex: item.tableIndex,
        occurrenceCount: item.occurrenceCount,
        listRefCount: item.listOffsets.size,
        subrecordRefCount: item.subrecordIndexes.size,
        dynamicTableEntry: tableEntry ? {
          tableId: tableEntry.catalogTableId,
          entryOffset: hex(tableEntry.entryOffset),
          word: hex(tableEntry.word, 4),
          remapRow: tableEntry.remapRow,
          streamZ80Address: hex(tableEntry.streamZ80Address, 4),
          streamRomOffset: hex(tableEntry.streamRomOffset),
          streamRegion: regionRef(streamRegion),
          zeroPadding: tableEntry.isZeroPadding,
        } : null,
      };
    });

  const dynamicIndexes = [...dynamicIndexUsage.values()]
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
    .map(item => {
      const [table, indexText] = item.key.split(':');
      const tableIndex = Number(indexText);
      const tableEntry = readDynamicTableEntry(rom, table, tableIndex);
      const streamRegion = tableEntry?.streamRomOffset == null ? null : findContainingRegion(mapData, tableEntry.streamRomOffset);
      return {
        table,
        tableIndex,
        occurrenceCount: item.occurrenceCount,
        listRefCount: item.listOffsets.size,
        subrecordRefCount: item.subrecordIndexes.size,
        tableEntry: tableEntry ? {
          entryOffset: hex(tableEntry.entryOffset),
          word: hex(tableEntry.word, 4),
          remapRow: tableEntry.remapRow,
          streamRomOffset: hex(tableEntry.streamRomOffset),
          streamRegion: regionRef(streamRegion),
          zeroPadding: tableEntry.isZeroPadding,
        } : null,
      };
    });

  const emptyList = listMap.get(splitPlan.sentinel.start);
  const entityListBlock = {
    start: splitPlan.entityLists.start,
    endExclusive: splitPlan.entityLists.start + splitPlan.entityLists.size,
  };
  const listsInBlock = lists.filter(list => list.romOffset >= entityListBlock.start && list.romOffset < entityListBlock.endExclusive);
  const pointerRefsIntoPreviousRegion = pointerRefs.filter(ref => (
    ref.romOffset >= previousMixedRegion.start && ref.romOffset < previousMixedRegion.endExclusive
  ));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: ['world-room-subrecord-catalog-2026-06-25', 'world-dynamic-tile-source-table-catalog-2026-06-25'],
    layout: {
      subrecordTable: {
        regionId: subrecordTable.regionId,
        start: hex(subrecordTable.start),
        stride: subrecordTable.stride,
        count: subrecordTable.count,
        entityPointerField: {
          offsetInSubrecord: subrecordTable.entityPointerOffset,
          copiedToRam: '_RAM_CF62_/_RAM_CF63_',
        },
      },
      splitPlan: {
        sentinel: { start: hex(splitPlan.sentinel.start), size: splitPlan.sentinel.size },
        unresolvedMiddle: { start: hex(splitPlan.unresolvedMiddle.start), size: splitPlan.unresolvedMiddle.size },
        entityLists: { start: hex(splitPlan.entityLists.start), size: splitPlan.entityLists.size },
      },
      decodedListCoverage: mergedIntervals.map(span => ({
        start: hex(span.start),
        endInclusive: hex(span.endExclusive - 1),
        size: span.endExclusive - span.start,
      })),
    },
    summary: {
      subrecordCount: subrecordTable.count,
      subrecordsWithEntityPointer: pointerRefsIntoPreviousRegion.length,
      uniqueEntityListPointers: lists.length,
      emptyListPointerRefs: emptyList?.subrecordIndexes.length || 0,
      entityListBlockPointerCount: listsInBlock.length,
      decodedEntityRecords: lists.reduce((sum, list) => sum + list.decoded.recordCount, 0),
      uniqueEntityTypeBytes: entityTypes.length,
      uniqueDynamicTableIndexes: dynamicIndexes.length,
      decodedUniqueBytes: mergedIntervals.reduce((sum, span) => sum + (span.endExclusive - span.start), 0),
      unresolvedMiddleBytes: splitPlan.unresolvedMiddle.size,
      warningCount: warnings.length,
      assetPolicy: 'Metadata only: pointers, offsets, entity type ids, counts, table indexes, region ids, and evidence. Entity placement bytes/coordinates and ROM data are not embedded.',
    },
    pointerFieldSemantics: {
      copiedBy: '_LABEL_26F4_',
      consumedBy: '_LABEL_2948_/_LABEL_2963_',
      sourceBank: 4,
      recordFormat: [
        '0xFF terminates a room entity list.',
        'If entity type bit 7 is set, the source record is one byte and selects the alternate $9E00 dynamic tile table.',
        'If entity type bit 7 is clear, the source record is four bytes and selects the normal $9D60 dynamic tile table.',
        'The dynamic table index is (entityType & 0x7F) - 1.',
      ],
    },
    entityTypes,
    dynamicTableUsage: dynamicIndexes,
    entityLists: lists.map(list => ({
      z80Pointer: hex(list.z80Pointer, 4),
      romOffset: hex(list.romOffset),
      subrecordIndexes: list.subrecordIndexes,
      subrecordRefCount: list.subrecordIndexes.length,
      recordCount: list.decoded.recordCount,
      terminated: list.decoded.terminated,
      terminatorOffset: list.decoded.terminatorOffset == null ? null : hex(list.decoded.terminatorOffset),
      endExclusive: hex(list.decoded.endExclusive),
      containingRegion: list.decoded.containingRegion,
      uniqueEntityTypes: [...list.decoded.entityTypeCounts.keys()].sort((a, b) => a - b).map(value => hex(value, 2)),
      recordPreview: list.decoded.recordPreview,
    })),
    pointerRefs: pointerRefs.map(ref => ({
      subrecordIndex: ref.subrecordIndex,
      subrecordOffset: hex(ref.subrecordOffset),
      z80Pointer: hex(ref.z80Pointer, 4),
      romOffset: ref.romOffset == null ? null : hex(ref.romOffset),
      listRegion: ref.listRegion,
    })),
    warnings,
    evidence: [
      'ASM lines 6472-6474 copy eight bytes from the selected room subrecord into _RAM_CF5E_ through _RAM_CF65_; the word at offsets +4/+5 lands in _RAM_CF62_/_RAM_CF63_.',
      'ASM lines 6800-6811 switch to bank 4, load HL from _RAM_CF62_, and seed _RAM_D0DE_ for room entity decoding.',
      'ASM lines 6811-6891 decode bit-7 entity bytes as one-byte records and normal entity bytes as four-byte records until 0xFF.',
      'ASM lines 6893-6925 map the entity type byte to $9D60/$9E00 dynamic tile table entries and call _LABEL_A97_.',
    ],
    nextLeads: [
      'Identify the unresolved 0x12D91-0x134B8 middle span by pointer scans and neighboring loader references.',
      'Name entity type ids by linking _DATA_668E_ behavior table selectors and visible sprite animation families.',
      'Use decoded room entity list counts to seed a scene/entity browser that shows entity ids without embedding coordinates.',
    ],
  };
}

function appendNote(region, note) {
  const existing = region.notes || '';
  if (existing.includes(note)) return;
  region.notes = existing ? `${existing} ${note}` : note;
}

function roomEntityAudit(kind, summary, confidence, extra = {}) {
  return {
    catalogId,
    kind,
    confidence,
    summary,
    evidence: [
      'ASM lines 6472-6474 copy room subrecord bytes into _RAM_CF5E_ through _RAM_CF65_.',
      'ASM lines 6800-6811 read _RAM_CF62_ as the bank-4 room entity list pointer.',
      'ASM lines 6811-6891 decode room entity source lists into _RAM_D030_ seven-byte records.',
    ],
    generatedAt: now,
    tool: toolName,
    ...extra,
  };
}

function buildSplitRegion(id, def) {
  return {
    id,
    offset: hex(def.start),
    size: def.size,
    type: def.type,
    name: def.name,
    confidence: def.confidence,
    source: 'analysis',
    splitFromOffset: hex(previousMixedRegion.start),
    notes: def.role === 'room_entity_list_gap_unresolved'
      ? 'Formerly part of the low-confidence r2818 inline graphics candidate; this middle span is not reached by the confirmed CF62 room entity list pointers.'
      : '',
    analysis: {
      roomEntityListAudit: roomEntityAudit(def.role, def.role === 'room_entity_list_gap_unresolved'
        ? 'Unresolved middle span left after splitting confirmed room entity list ranges out of the previous mixed candidate region.'
        : 'Confirmed bank-4 room entity source list range reached through the room subrecord CF62 pointer field.',
      def.confidence),
    },
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const blocked = [];
  const existingSentinel = findExactRegion(mapData, splitPlan.sentinel.start);
  const existingMiddle = findExactRegion(mapData, splitPlan.unresolvedMiddle.start);
  const existingEntityLists = findExactRegion(mapData, splitPlan.entityLists.start);

  if (existingSentinel && existingSentinel.size === splitPlan.sentinel.size && existingEntityLists) {
    if (existingMiddle && existingMiddle.id === existingEntityLists.id) {
      const before = regionRef(existingEntityLists);
      existingEntityLists.id = formatRegionId(nextRegionNumber(mapData));
      changedRegions.push({
        before,
        after: regionRef(existingEntityLists),
        role: 'repair_duplicate_region_id_after_room_entity_split',
      });
    }
    for (const region of [existingSentinel, existingMiddle, existingEntityLists].filter(Boolean)) {
      changedRegions.push(regionRef(region));
    }
  } else {
    const source = findRegionById(mapData, previousMixedRegion.id);
    if (!source) {
      missingRegions.push({ id: previousMixedRegion.id, offset: hex(previousMixedRegion.start) });
    } else if (offsetOf(source) !== previousMixedRegion.start || endOf(source) !== previousMixedRegion.endExclusive) {
      blocked.push({
        id: source.id,
        offset: source.offset,
        size: source.size || 0,
        reason: 'Previous mixed region was already changed and does not match the expected pre-split range.',
      });
    } else {
      const before = regionRef(source);
      source.size = splitPlan.sentinel.size;
      source.type = splitPlan.sentinel.type;
      source.name = splitPlan.sentinel.name;
      source.confidence = splitPlan.sentinel.confidence;
      appendNote(source, 'Confirmed as a shared empty room entity list sentinel used through _RAM_CF62_.');
      source.analysis = source.analysis || {};
      source.analysis.roomEntityListAudit = roomEntityAudit(
        splitPlan.sentinel.role,
        'A single 0xFF terminator used as the empty room entity list by multiple room subrecords.',
        'high',
        { subrecordRefCount: catalog.summary.emptyListPointerRefs },
      );
      if (source.analysis.unresolvedAssetConsumerAudit) {
        source.analysis.unresolvedAssetConsumerAudit.consumerStatus = 'consumer_confirmed_room_entity_empty_list';
        source.analysis.unresolvedAssetConsumerAudit.resolvedBy = catalogId;
        source.analysis.unresolvedAssetConsumerAudit.resolution = 'The 0x12D90 byte is the shared 0xFF empty room entity list terminator selected through _RAM_CF62_.';
      }
      if (source.analysis.roomSubrecordAudit) {
        source.analysis.roomSubrecordAudit.supersededBy = catalogId;
        source.analysis.roomSubrecordAudit.supersededReason = 'The old full-span inline graphics candidate has been split; confirmed room entity list ranges are now modeled separately.';
      }
      let nextId = nextRegionNumber(mapData);
      const middle = buildSplitRegion(formatRegionId(nextId++), splitPlan.unresolvedMiddle);
      middle.analysis.unresolvedAssetConsumerAudit = {
        catalogId,
        kind: 'room_entity_list_gap_unresolved',
        confidence: 'low',
        summary: 'Middle span from the old r2818 candidate is not reached by confirmed room entity list pointers and still needs a consumer.',
        consumerStatus: 'consumer_unresolved_after_room_entity_split',
        range: {
          start: hex(splitPlan.unresolvedMiddle.start),
          endInclusive: hex(splitPlan.unresolvedMiddle.start + splitPlan.unresolvedMiddle.size - 1),
          size: splitPlan.unresolvedMiddle.size,
          bank: 4,
        },
        evidence: catalog.evidence,
        generatedAt: now,
        tool: toolName,
      };
      const entityLists = buildSplitRegion(formatRegionId(nextId++), splitPlan.entityLists);
      entityLists.analysis.roomEntityListAudit.decodedListCount = catalog.summary.entityListBlockPointerCount;
      entityLists.analysis.roomEntityListAudit.decodedEntityRecords = catalog.summary.decodedEntityRecords;
      entityLists.analysis.roomEntityListAudit.uniqueEntityTypeBytes = catalog.summary.uniqueEntityTypeBytes;
      const index = mapData.regions.findIndex(region => region.id === source.id);
      mapData.regions.splice(index + 1, 0, middle, entityLists);
      changedRegions.push({ before, after: regionRef(source), role: splitPlan.sentinel.role });
      changedRegions.push({ after: regionRef(middle), role: splitPlan.unresolvedMiddle.role });
      changedRegions.push({ after: regionRef(entityLists), role: splitPlan.entityLists.role });
    }
  }

  const entityRegion = findExactRegion(mapData, splitPlan.entityLists.start);
  if (entityRegion) {
    entityRegion.analysis = entityRegion.analysis || {};
    entityRegion.analysis.roomEntityListAudit = {
      ...(entityRegion.analysis.roomEntityListAudit || {}),
      catalogId,
      kind: splitPlan.entityLists.role,
      confidence: 'high',
      summary: 'Bank-4 room entity source lists selected by room subrecord CF62 pointers and decoded by _LABEL_2948_/_LABEL_2963_.',
      decodedListCount: catalog.summary.entityListBlockPointerCount,
      decodedEntityRecords: catalog.summary.decodedEntityRecords,
      uniqueEntityTypeBytes: catalog.summary.uniqueEntityTypeBytes,
      uniqueDynamicTableIndexes: catalog.summary.uniqueDynamicTableIndexes,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
  }

  mapData.entityDataCatalogs = (mapData.entityDataCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityDataCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'room_entity_list_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    summary: {
      ...catalog.summary,
      changedRegions: changedRegions.length,
      missingRegions: missingRegions.length,
      blockedChanges: blocked.length,
    },
    changedRegions,
    missingRegions,
    blockedChanges: blocked,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });

  return { changedRegions, missingRegions, blocked };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, rom);
  let changes = { changedRegions: [], missingRegions: [], blocked: [] };

  if (apply) {
    changes = applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    decodedListCoverage: catalog.layout.decodedListCoverage,
    topEntityTypes: catalog.entityTypes
      .slice()
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
      .slice(0, 12),
    changedRegionCount: changes.changedRegions.length,
    missingRegionCount: changes.missingRegions.length,
    blockedChangeCount: changes.blocked.length,
  }, null, 2));
}

main();
