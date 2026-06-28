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
const catalogId = 'world-room-subrecord-catalog-2026-06-25';
const reportId = 'room-subrecord-audit-2026-06-25';
const zoneGraphId = 'world-zone-graph-2026-06-24';

const tableRegionOffset = 0x1072A;
const subrecordStart = 0x1072C;
const subrecordStride = 18;
const subrecordCount = 76;
const subrecordEndExclusive = subrecordStart + subrecordStride * subrecordCount;
const tableEndExclusive = 0x10C90;

const managedRanges = [
  {
    start: 0x12707,
    endExclusive: 0x12727,
    reason: 'orphan_room_subrecords_resolve_previous_gap',
  },
  {
    start: 0x127DD,
    endExclusive: 0x12827,
    reason: 'orphan_room_subrecords_resolve_previous_gap',
  },
  {
    start: 0x12CD2,
    endExclusive: 0x13AF0,
    reason: 'orphan_room_subrecord_resolves_previous_tail_prefix',
  },
];

const roomTailShape = {
  start: 0x12D8C,
  prefixEnd: 0x12D90,
  suffixStart: 0x13AD0,
  endExclusive: 0x13AF0,
  tileRecordBytes: 32,
};

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
}

function endOf(region) {
  return offsetOf(region) + (region.size || 0);
}

function isAllZero(rom, offset, size) {
  for (let i = offset; i < offset + size; i++) {
    if (rom[i] !== 0) return false;
  }
  return true;
}

function byteClassStats(rom, offset, size) {
  const bytes = rom.subarray(offset, offset + size);
  let zeroBytes = 0;
  let ffBytes = 0;
  let printableAsciiBytes = 0;
  let highBitBytes = 0;
  let controlBytes = 0;
  for (const byte of bytes) {
    if (byte === 0) zeroBytes++;
    if (byte === 0xFF) ffBytes++;
    if (byte >= 0x20 && byte <= 0x7E) printableAsciiBytes++;
    if (byte >= 0x80) highBitBytes++;
    if (byte < 0x20 && byte !== 0) controlBytes++;
  }
  return {
    size,
    zeroBytes,
    nonZeroBytes: size - zeroBytes,
    ffBytes,
    printableAsciiBytes,
    highBitBytes,
    controlBytes,
    zeroRatio: Number((zeroBytes / Math.max(1, size)).toFixed(4)),
    ffRatio: Number((ffBytes / Math.max(1, size)).toFixed(4)),
  };
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
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

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nextRegionNumber(mapData) {
  let maxId = 0;
  for (const region of mapData.regions || []) {
    const match = /^r(\d+)$/.exec(region.id || '');
    if (match) maxId = Math.max(maxId, Number(match[1]));
  }
  return maxId + 1;
}

function formatRegionId(number) {
  return 'r' + String(number).padStart(4, '0');
}

function inBank4Z80(z80) {
  return z80 >= 0x8000 && z80 < 0xC000;
}

function bank4Z80ToRom(z80) {
  return z80 + 0x8000;
}

function decodeVramLoader8fb(rom, offset) {
  const entries = [];
  const warnings = [];
  let pc = offset;
  let curVramTile = 0;
  let curBank = 8;
  let curBlockIdx = 0;
  let totalTiles = 0;
  let maxVramTile = 0;
  let terminated = false;

  for (let entryIndex = 0; entryIndex < 256 && pc < rom.length; entryIndex++) {
    const entryOffset = pc;
    const count = rom[pc++];
    if (count === 0) {
      terminated = true;
      break;
    }
    if (pc + 3 >= rom.length) {
      warnings.push(`entry ${entryIndex} truncated at ${hex(entryOffset)}`);
      break;
    }

    const vramLo = rom[pc++];
    const vramHi = rom[pc++];
    const srcLo = rom[pc++];
    const srcHi = rom[pc++];
    const vramWord = vramLo | (vramHi << 8);
    const srcWord = srcLo | (srcHi << 8);
    if (vramWord !== 0xFFFF) curVramTile = vramWord;
    if (srcWord !== 0xFFFF) {
      curBank = srcHi >> 1;
      curBlockIdx = ((srcHi & 1) << 8) | srcLo;
    }

    const sourceStart = curBank * 0x4000 + curBlockIdx * 32;
    const sourceEnd = sourceStart + count * 32 - 1;
    if (count > 0x80) warnings.push(`entry ${entryIndex} unusually large tile count ${count}`);
    if (curVramTile + count > 0x200) warnings.push(`entry ${entryIndex} exceeds SMS tile slot range`);
    if (sourceEnd >= rom.length) warnings.push(`entry ${entryIndex} source exceeds ROM at ${hex(sourceStart)}-${hex(sourceEnd)}`);

    entries.push({
      entryIndex,
      entryOffset: hex(entryOffset),
      count,
      vramTileRange: {
        start: hex(curVramTile, 3),
        end: hex(curVramTile + count - 1, 3),
        count,
      },
      source: {
        bank: curBank,
        block: hex(curBlockIdx, 3),
        romRange: [hex(sourceStart), hex(sourceEnd)],
      },
    });
    totalTiles += count;
    maxVramTile = Math.max(maxVramTile, curVramTile + count - 1);
    curVramTile += count;
    curBlockIdx += count;
  }

  return {
    format: '8fb',
    valid: terminated && entries.length > 0 && warnings.length === 0,
    terminated,
    consumedBytes: pc - offset,
    entries: entries.length,
    totalTiles,
    maxVramTile: hex(maxVramTile, 3),
    sourceRanges: entries.map(entry => entry.source.romRange),
    warnings,
    entryPreview: entries.slice(0, 8),
  };
}

function decodeVramLoader998SourceRanges(rom, offset) {
  const ranges = [];
  let pc = offset;
  let curVramTile = 0;
  for (let entryIndex = 0; entryIndex < 256 && pc < rom.length; entryIndex++) {
    const entryOffset = pc;
    const control = rom[pc++];
    if (control === 0) break;
    if (pc + 1 >= rom.length) break;
    const lo = rom[pc++];
    const hi = rom[pc++];
    if (control & 0x80) {
      curVramTile = lo | (hi << 8);
      continue;
    }
    const count = control;
    const bank = hi >> 1;
    const block = ((hi & 1) << 8) | lo;
    const start = bank * 0x4000 + block * 32;
    ranges.push({
      entryIndex,
      entryOffset,
      start,
      endExclusive: start + count * 32,
      count,
      vramTileStart: curVramTile,
    });
    curVramTile += count;
  }
  return ranges;
}

function loaderSourceOverlaps(rom, mapData, start, endExclusive) {
  const hits = [];
  for (const region of mapData.regions || []) {
    if (region.type !== 'vram_loader_8fb' && region.type !== 'vram_loader_998') continue;
    const regionOffset = offsetOf(region);
    const ranges = region.type === 'vram_loader_8fb'
      ? decodeVramLoader8fb(rom, regionOffset).sourceRanges.map((range, entryIndex) => ({
        entryIndex,
        start: parseInt(range[0], 16),
        endExclusive: parseInt(range[1], 16) + 1,
      }))
      : decodeVramLoader998SourceRanges(rom, regionOffset);
    for (const range of ranges) {
      if (range.start < endExclusive && range.endExclusive > start) {
        hits.push({
          loaderRegion: regionRef(region),
          loaderType: region.type,
          entryIndex: range.entryIndex,
          sourceRange: [hex(range.start), hex(range.endExclusive - 1)],
          overlapRange: [hex(Math.max(range.start, start)), hex(Math.min(range.endExclusive, endExclusive) - 1)],
        });
      }
    }
  }
  return hits;
}

function parseDoorTableMeta(rom, doorRomOffset) {
  const warnings = [];
  let entryCount = 0;
  let terminatorOffset = null;
  let off = doorRomOffset;
  for (; entryCount < 64 && off + 6 < rom.length; entryCount++) {
    if (rom[off] === 0xFF) {
      terminatorOffset = off;
      break;
    }
    const destZ80 = rom[off + 5] | (rom[off + 6] << 8);
    if (!inBank4Z80(destZ80)) warnings.push(`door ${entryCount} destination outside bank 4 Z80 window: ${hex(destZ80, 4)}`);
    off += 7;
  }
  if (terminatorOffset == null) warnings.push(`door table did not terminate within 64 entries from ${hex(doorRomOffset)}`);
  return {
    romOffset: hex(doorRomOffset),
    entryCount,
    terminatorOffset: terminatorOffset == null ? null : hex(terminatorOffset),
    warnings,
  };
}

function graphSubrecordOffsets(mapData) {
  const graph = (mapData.zoneGraphs || []).find(item => item.id === zoneGraphId);
  const offsets = new Set();
  for (const descriptor of graph?.descriptors || []) {
    const offset = parseInt(descriptor.subrecord?.romOffset || '', 16);
    if (Number.isFinite(offset)) offsets.add(offset);
  }
  return offsets;
}

function parseSubrecords(rom, mapData) {
  const reachedOffsets = graphSubrecordOffsets(mapData);
  const records = [];
  for (let index = 0; index < subrecordCount; index++) {
    const offset = subrecordStart + index * subrecordStride;
    const doorZ80 = rom[offset] | (rom[offset + 1] << 8);
    const vramLoaderZ80 = rom[offset + 8] | (rom[offset + 9] << 8);
    const dc2Indices = Array.from(rom.slice(offset + 10, offset + 16));
    const flags = rom[offset + 16];
    const paletteIndex = flags & 0x3F;
    const audioRequestId = rom[offset + 17];
    const doorRomOffset = inBank4Z80(doorZ80) ? bank4Z80ToRom(doorZ80) : null;
    const loaderRomOffset = inBank4Z80(vramLoaderZ80) ? bank4Z80ToRom(vramLoaderZ80) : null;
    const loader = loaderRomOffset == null ? null : decodeVramLoader8fb(rom, loaderRomOffset);
    const doorTable = doorRomOffset == null ? null : parseDoorTableMeta(rom, doorRomOffset);
    const issues = [];
    if (doorRomOffset == null) issues.push(`door table pointer ${hex(doorZ80, 4)} outside bank 4 Z80 window`);
    if (loaderRomOffset == null) issues.push(`8FB loader pointer ${hex(vramLoaderZ80, 4)} outside bank 4 Z80 window`);
    if (loader && !loader.valid) issues.push(`8FB loader at ${hex(loaderRomOffset)} did not validate cleanly`);
    if (!dc2Indices.every(value => value <= 0xAF || value === 0xFF)) issues.push('one or more DC2 indices outside expected range');
    if (doorTable?.warnings.length) issues.push(...doorTable.warnings.map(warning => `door table: ${warning}`));

    records.push({
      index,
      offset: hex(offset),
      status: reachedOffsets.has(offset) ? 'zone_graph_reached' : 'structural_orphan',
      doorTable: doorRomOffset == null ? null : {
        z80Pointer: hex(doorZ80, 4),
        romOffset: hex(doorRomOffset),
        entryCount: doorTable.entryCount,
        terminatorOffset: doorTable.terminatorOffset,
        warnings: doorTable.warnings,
      },
      vramLoader8fb: loaderRomOffset == null ? null : {
        z80Pointer: hex(vramLoaderZ80, 4),
        romOffset: hex(loaderRomOffset),
        valid: loader.valid,
        consumedBytes: loader.consumedBytes,
        entries: loader.entries,
        totalTiles: loader.totalTiles,
        maxVramTile: loader.maxVramTile,
        warnings: loader.warnings,
        entryPreview: loader.entryPreview,
      },
      dc2Indices: dc2Indices.map(value => hex(value, 2)),
      flags: hex(flags, 2),
      paletteIndex,
      audioRequestId,
      audioRequestIdHex: hex(audioRequestId, 2),
      audioRequestInTable: audioRequestId < 62,
      issues,
    });
  }
  return records;
}

function groupLoaderReferences(records) {
  const byOffset = new Map();
  for (const record of records) {
    const loader = record.vramLoader8fb;
    if (!loader?.valid) continue;
    if (!byOffset.has(loader.romOffset)) {
      byOffset.set(loader.romOffset, {
        romOffset: loader.romOffset,
        z80Pointer: loader.z80Pointer,
        consumedBytes: loader.consumedBytes,
        entries: loader.entries,
        totalTiles: loader.totalTiles,
        maxVramTile: loader.maxVramTile,
        sourceRanges: loader.entryPreview.map(entry => entry.source.romRange),
        referenceCount: 0,
        zoneGraphReachedReferences: 0,
        structuralOrphanReferences: 0,
        subrecordOffsets: [],
      });
    }
    const entry = byOffset.get(loader.romOffset);
    entry.referenceCount++;
    if (record.status === 'zone_graph_reached') entry.zoneGraphReachedReferences++;
    else entry.structuralOrphanReferences++;
    entry.subrecordOffsets.push(record.offset);
  }
  return [...byOffset.values()].sort((a, b) => parseInt(a.romOffset, 16) - parseInt(b.romOffset, 16));
}

function tailShapeSegments(rom, mapData, start, endExclusive, range) {
  if (!rom || start !== roomTailShape.start || endExclusive !== roomTailShape.endExclusive) return null;
  const prefixSize = roomTailShape.prefixEnd - roomTailShape.start;
  const candidateSize = roomTailShape.suffixStart - roomTailShape.prefixEnd;
  const suffixSize = roomTailShape.endExclusive - roomTailShape.suffixStart;
  if (!isAllZero(rom, roomTailShape.start, prefixSize)) return null;
  if (!isAllZero(rom, roomTailShape.suffixStart, suffixSize)) return null;
  if (candidateSize <= 0 || candidateSize % roomTailShape.tileRecordBytes !== 0) return null;

  const entitySentinel = mapData ? findExactRegion(mapData, roomTailShape.prefixEnd) : null;
  const entityGap = mapData ? findExactRegion(mapData, roomTailShape.prefixEnd + 1) : null;
  const entityLists = mapData ? findExactRegion(mapData, 0x134B9) : null;
  const entityGapIsConfirmed =
    entityGap &&
    (entityGap.type === 'data_table' ||
      (entityGap.type === 'entity_data' && entityGap.analysis?.roomEntityOrphanListAudit));
  const hasConfirmedEntitySplit = Boolean(
    entitySentinel &&
    entitySentinel.type === 'entity_data' &&
    entitySentinel.analysis?.roomEntityListAudit &&
    entityGapIsConfirmed &&
    entityLists &&
    entityLists.type === 'entity_data' &&
    entityLists.analysis?.roomEntityListAudit &&
    offsetOf(entitySentinel) === roomTailShape.prefixEnd &&
    endOf(entityLists) === roomTailShape.suffixStart
  );

  if (hasConfirmedEntitySplit) {
    return [
      {
        kind: 'room_subrecord_tail_zero_prefix',
        start: roomTailShape.start,
        size: prefixSize,
        range,
        byteClassStats: byteClassStats(rom, roomTailShape.start, prefixSize),
      },
      {
        kind: 'room_subrecord_tail_entity_empty_list_sentinel',
        start: offsetOf(entitySentinel),
        size: entitySentinel.size || 0,
        range,
        entityRegion: regionRef(entitySentinel),
      },
      {
        kind: entityGap.analysis?.roomEntityOrphanListAudit
          ? 'room_subrecord_tail_orphan_entity_source_lists'
          : 'room_subrecord_tail_entity_gap_unresolved',
        start: offsetOf(entityGap),
        size: entityGap.size || 0,
        range,
        entityRegion: regionRef(entityGap),
        byteClassStats: byteClassStats(rom, offsetOf(entityGap), entityGap.size || 0),
      },
      {
        kind: 'room_subrecord_tail_entity_source_lists',
        start: offsetOf(entityLists),
        size: entityLists.size || 0,
        range,
        entityRegion: regionRef(entityLists),
      },
      {
        kind: 'room_subrecord_tail_zero_suffix',
        start: roomTailShape.suffixStart,
        size: suffixSize,
        range,
        byteClassStats: byteClassStats(rom, roomTailShape.suffixStart, suffixSize),
      },
    ];
  }

  const loaderSourceHits = mapData
    ? loaderSourceOverlaps(rom, mapData, roomTailShape.prefixEnd, roomTailShape.suffixStart)
    : [];
  return [
    {
      kind: 'room_subrecord_tail_zero_prefix',
      start: roomTailShape.start,
      size: prefixSize,
      range,
      byteClassStats: byteClassStats(rom, roomTailShape.start, prefixSize),
    },
    {
      kind: 'room_subrecord_tail_gfx_tile_candidate',
      start: roomTailShape.prefixEnd,
      size: candidateSize,
      range,
      tileShape: {
        recordBytes: roomTailShape.tileRecordBytes,
        recordCount: candidateSize / roomTailShape.tileRecordBytes,
        byteClassStats: byteClassStats(rom, roomTailShape.prefixEnd, candidateSize),
        currentLoaderSourceHitCount: loaderSourceHits.length,
        currentLoaderSourceHits: loaderSourceHits.slice(0, 16),
        consumerStatus: loaderSourceHits.length ? 'loader_source_overlap_found' : 'unresolved_no_current_loader_source_hits',
      },
    },
    {
      kind: 'room_subrecord_tail_zero_suffix',
      start: roomTailShape.suffixStart,
      size: suffixSize,
      range,
      byteClassStats: byteClassStats(rom, roomTailShape.suffixStart, suffixSize),
    },
  ];
}

function plannedSegments(loaderReferences, rom = null, mapData = null) {
  const loaderByOffset = new Map(loaderReferences.map(ref => [parseInt(ref.romOffset, 16), ref]));
  const segments = [];
  for (const range of managedRanges) {
    let cursor = range.start;
    const loaderStarts = [...loaderByOffset.keys()]
      .filter(offset => offset >= range.start && offset < range.endExclusive)
      .sort((a, b) => a - b);

    for (const start of loaderStarts) {
      if (start > cursor) {
        segments.push({
          kind: 'unresolved_data_between_room_subrecord_loaders',
          start: cursor,
          size: start - cursor,
          range,
        });
      }
      const loader = loaderByOffset.get(start);
      segments.push({
        kind: 'room_subrecord_vram_loader_8fb',
        start,
        size: loader.consumedBytes,
        range,
        loader,
      });
      cursor = start + loader.consumedBytes;
    }

    if (cursor < range.endExclusive) {
      const shapedTail = tailShapeSegments(rom, mapData, cursor, range.endExclusive, range);
      if (shapedTail) segments.push(...shapedTail);
      else {
        segments.push({
          kind: range.start === 0x12CD2 ? 'unresolved_tail_after_room_subrecord_loader' : 'unresolved_data_between_room_subrecord_loaders',
          start: cursor,
          size: range.endExclusive - cursor,
          range,
        });
      }
    }
  }
  return segments;
}

function buildCatalog(rom, mapData) {
  const records = parseSubrecords(rom, mapData);
  const loaderReferences = groupLoaderReferences(records);
  const segments = plannedSegments(loaderReferences, rom, mapData);
  const invalidRecords = records.filter(record => record.issues.length);
  const orphanRecords = records.filter(record => record.status === 'structural_orphan');
  const resolvedLoaderOffsets = new Set(
    segments
      .filter(segment => segment.kind === 'room_subrecord_vram_loader_8fb')
      .map(segment => hex(segment.start))
  );

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-room-subrecord-audit.mjs',
    summary: {
      tableRegionOffset: hex(tableRegionOffset),
      tableRegionEndExclusive: hex(tableEndExclusive),
      subrecordStart: hex(subrecordStart),
      subrecordEndExclusive: hex(subrecordEndExclusive),
      subrecordStride,
      subrecordCount: records.length,
      zoneGraphReachedSubrecords: records.filter(record => record.status === 'zone_graph_reached').length,
      structuralOrphanSubrecords: orphanRecords.length,
      invalidSubrecords: invalidRecords.length,
      uniqueLoaderReferences: loaderReferences.length,
      newlyResolvedLoaderOffsets: [...resolvedLoaderOffsets],
      managedRangeCount: managedRanges.length,
      plannedSegments: segments.length,
      tailShapeSegments: segments.filter(segment => segment.kind.startsWith('room_subrecord_tail_')).length,
      assetPolicy: 'Metadata only: offsets, field roles, pointer targets, decoded loader counts, and evidence. No ROM bytes, decoded graphics, maps, or room content are embedded.',
    },
    layout: {
      prefixRange: {
        offset: hex(tableRegionOffset),
        size: subrecordStart - tableRegionOffset,
        status: 'unresolved_prefix_before_aligned_subrecords',
      },
      subrecordRange: {
        offset: hex(subrecordStart),
        endExclusive: hex(subrecordEndExclusive),
        stride: subrecordStride,
        count: subrecordCount,
      },
      suffixRange: {
        offset: hex(subrecordEndExclusive),
        size: tableEndExclusive - subrecordEndExclusive,
        status: 'unresolved_suffix_after_aligned_subrecords',
      },
    },
    evidence: [
      'ASM lines 6363-6422: _LABEL_2620_ consumes a 6-byte room descriptor and calls _LABEL_26F4_ with HL pointing at the selected subrecord.',
      'ASM lines 6472-6478: _LABEL_26F4_ copies 8 bytes from the subrecord, stores the following pointer position, then calls _LABEL_8FB_ using the subrecord-selected loader pointer.',
      'ASM lines 6479-6484: _LABEL_26F4_ resumes at the saved pointer and calls _LABEL_DC2_ before reading flags at +16.',
      'ASM lines 6486-6493: flags bits select the additional _LABEL_998_ loader path.',
      'ASM lines 6486-6502: the flags byte at subrecord +16 selects the extra 998 loader path and is masked to 6 bits before _LABEL_8B2_ receives the palette index.',
      'ASM lines 6503-6520: the byte at subrecord +17 is compared with _RAM_CFF9_, cached, and passed to _LABEL_104B_ as an audio request when it changes.',
      `Zone graph ${zoneGraphId} already validates ${records.filter(record => record.status === 'zone_graph_reached').length} subrecords inside this range.`,
    ],
    records,
    loaderReferences,
    plannedSegments: segments.map(segment => ({
      kind: segment.kind,
      offset: hex(segment.start),
      endInclusive: hex(segment.start + segment.size - 1),
      size: segment.size,
      reason: segment.range.reason,
      loader: segment.loader ? {
        romOffset: segment.loader.romOffset,
        z80Pointer: segment.loader.z80Pointer,
        consumedBytes: segment.loader.consumedBytes,
        entries: segment.loader.entries,
        totalTiles: segment.loader.totalTiles,
        maxVramTile: segment.loader.maxVramTile,
        referenceCount: segment.loader.referenceCount,
        structuralOrphanReferences: segment.loader.structuralOrphanReferences,
        subrecordOffsets: segment.loader.subrecordOffsets,
      } : null,
    })),
  };
}

function annotateTableRegion(mapData, catalog) {
  const region = findExactRegion(mapData, tableRegionOffset);
  if (!region) return null;
  const typeBefore = region.type || 'unknown';
  const supersededAnalyses = [];
  if (region.analysis?.screenProgAudit) {
    supersededAnalyses.push({
      key: 'screenProgAudit',
      summary: region.analysis.screenProgAudit.summary || '',
      confidence: region.analysis.screenProgAudit.confidence || '',
    });
    delete region.analysis.screenProgAudit;
  }
  if (region.analysis?.screenProgReachabilityAudit) {
    supersededAnalyses.push({
      key: 'screenProgReachabilityAudit',
      summary: region.analysis.screenProgReachabilityAudit.summary || '',
      confidence: region.analysis.screenProgReachabilityAudit.confidence || '',
    });
    delete region.analysis.screenProgReachabilityAudit;
  }
  if (region.params?.screenProg) {
    supersededAnalyses.push({
      key: 'params.screenProg',
      summary: 'Removed stale simulator screen_prog params after room subrecord table was confirmed.',
      confidence: 'high',
    });
    delete region.params.screenProg;
    if (!Object.keys(region.params).length) delete region.params;
  }

  region.type = 'room_subrecord';
  region.name = 'bank-4 room subrecord table';
  region.confidence = 'high';
  region.notes = 'Aligned room subrecord table used by _LABEL_2620_/_LABEL_26F4_; not an independent _LABEL_604_ screen program.';
  region.analysis = region.analysis || {};
  region.analysis.roomSubrecordAudit = {
    catalogId,
    kind: 'room_subrecord_table',
    confidence: 'high',
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type,
    changedType: typeBefore !== region.type,
    layout: catalog.layout,
    summary: `${catalog.summary.subrecordCount} aligned 18-byte room subrecords; ${catalog.summary.zoneGraphReachedSubrecords} reached by ${zoneGraphId}, ${catalog.summary.structuralOrphanSubrecords} structural orphans.`,
    supersededAnalyses,
    evidence: catalog.evidence,
    generatedAt: now,
    tool: 'tools/world-room-subrecord-audit.mjs',
  };
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    typeBefore,
    typeAfter: region.type,
    changedType: typeBefore !== region.type,
    supersededAnalyses: supersededAnalyses.map(item => item.key),
  };
}

function segmentRegionName(segment) {
  if (segment.kind === 'room_subrecord_vram_loader_8fb') return `room subrecord 8FB loader @ ${hex(segment.start)}`;
  if (segment.kind === 'room_subrecord_tail_zero_prefix') return `zero separator after room subrecord 8FB loader @ ${hex(segment.start)}`;
  if (segment.kind === 'room_subrecord_tail_gfx_tile_candidate') return `candidate inline SMS tile records after room loader @ ${hex(segment.start)}`;
  if (segment.kind === 'room_subrecord_tail_entity_empty_list_sentinel') return `empty room entity list sentinel @ ${hex(segment.start)}`;
  if (segment.kind === 'room_subrecord_tail_entity_gap_unresolved') return `unreached room-entity-list gap @ ${hex(segment.start)}`;
  if (segment.kind === 'room_subrecord_tail_orphan_entity_source_lists') return `orphan room entity source lists @ ${hex(segment.start)}`;
  if (segment.kind === 'room_subrecord_tail_entity_source_lists') return `room entity source lists @ ${hex(segment.start)}`;
  if (segment.kind === 'room_subrecord_tail_zero_suffix') return `zero padding before _DATA_13AF0_ @ ${hex(segment.start)}`;
  if (segment.kind === 'unresolved_tail_after_room_subrecord_loader') return `unresolved data after room subrecord 8FB loader @ ${hex(segment.start)}`;
  return `unresolved data between room subrecord loaders @ ${hex(segment.start)}`;
}

function segmentRegionType(segment) {
  if (segment.kind === 'room_subrecord_vram_loader_8fb') return 'vram_loader_8fb';
  if (segment.kind === 'room_subrecord_tail_zero_prefix' || segment.kind === 'room_subrecord_tail_zero_suffix') return 'null';
  if (segment.kind === 'room_subrecord_tail_gfx_tile_candidate') return 'gfx_tiles';
  if (segment.kind === 'room_subrecord_tail_entity_empty_list_sentinel') return 'entity_data';
  if (segment.kind === 'room_subrecord_tail_entity_source_lists') return 'entity_data';
  if (segment.kind === 'room_subrecord_tail_orphan_entity_source_lists') return 'entity_data';
  if (segment.kind === 'room_subrecord_tail_entity_gap_unresolved') return 'data_table';
  return 'data_table';
}

function segmentConfidence(segment) {
  if (segment.kind === 'room_subrecord_vram_loader_8fb') return 'high';
  if (segment.kind === 'room_subrecord_tail_zero_prefix' || segment.kind === 'room_subrecord_tail_zero_suffix') return 'high';
  if (segment.kind === 'room_subrecord_tail_entity_empty_list_sentinel') return 'high';
  if (segment.kind === 'room_subrecord_tail_entity_source_lists') return 'high';
  if (segment.kind === 'room_subrecord_tail_orphan_entity_source_lists') return 'high';
  return 'low';
}

function buildSegmentAnalysis(segment, previousRegion) {
  const isLoader = segment.kind === 'room_subrecord_vram_loader_8fb';
  const isTailZero = segment.kind === 'room_subrecord_tail_zero_prefix' || segment.kind === 'room_subrecord_tail_zero_suffix';
  const isTileCandidate = segment.kind === 'room_subrecord_tail_gfx_tile_candidate';
  const isEntitySentinel = segment.kind === 'room_subrecord_tail_entity_empty_list_sentinel';
  const isEntityGap = segment.kind === 'room_subrecord_tail_entity_gap_unresolved';
  const isOrphanEntityLists = segment.kind === 'room_subrecord_tail_orphan_entity_source_lists';
  const isEntityLists = segment.kind === 'room_subrecord_tail_entity_source_lists';
  return {
    catalogId,
    kind: segment.kind,
    confidence: segmentConfidence(segment),
    typeBeforeAudit: previousRegion?.type || 'covered_by_previous_region',
    typeAfterAudit: segmentRegionType(segment),
    offsetBeforeAudit: previousRegion?.offset || null,
    sizeBeforeAudit: previousRegion?.size || 0,
    offsetAfterAudit: hex(segment.start),
    sizeAfterAudit: segment.size,
    changedType: (previousRegion?.type || '') !== segmentRegionType(segment),
    changedRange: !previousRegion || offsetOf(previousRegion) !== segment.start || (previousRegion.size || 0) !== segment.size,
    summary: isLoader
      ? 'Room subrecord pointer selects this _LABEL_8FB_ loader; loader decodes cleanly and is now split from the previous unresolved range.'
      : isTailZero
        ? 'All-zero separator/padding split from the unresolved tail after the room-subrecord-selected _LABEL_8FB_ loader.'
        : isTileCandidate
          ? 'Low-confidence inline SMS tile-record candidate: byte count is an exact multiple of 32, but no current mapped loader source overlap confirms a runtime consumer.'
          : isEntitySentinel
            ? 'Confirmed room entity empty-list sentinel preserved inside the room-subrecord loader tail.'
            : isEntityGap
              ? 'Middle span left unresolved after the confirmed room entity list split; no room entity pointer reaches it yet.'
              : isOrphanEntityLists
                ? 'Structurally confirmed orphan room entity source lists; no room subrecord pointer reaches this span.'
              : isEntityLists
                ? 'Confirmed room entity source lists selected by the room subrecord CF62 pointer field.'
                : 'Remaining bytes are preserved as unresolved data after splitting room-subrecord-selected _LABEL_8FB_ loaders.',
    loader: isLoader ? {
      romOffset: segment.loader.romOffset,
      z80Pointer: segment.loader.z80Pointer,
      consumedBytes: segment.loader.consumedBytes,
      entries: segment.loader.entries,
      totalTiles: segment.loader.totalTiles,
      maxVramTile: segment.loader.maxVramTile,
      referenceCount: segment.loader.referenceCount,
      structuralOrphanReferences: segment.loader.structuralOrphanReferences,
      subrecordOffsets: segment.loader.subrecordOffsets,
    } : null,
    tileShape: isTileCandidate ? segment.tileShape : undefined,
    entityRegion: (isEntitySentinel || isEntityGap || isOrphanEntityLists || isEntityLists) ? segment.entityRegion : undefined,
    byteClassStats: isEntityGap ? segment.byteClassStats : isTailZero ? segment.byteClassStats : undefined,
    supersededAnalyses: previousRegion?.analysis ? Object.keys(previousRegion.analysis) : [],
    evidence: isLoader
      ? [
        `Room subrecord(s) ${segment.loader.subrecordOffsets.join(', ')} contain loader pointer ${segment.loader.z80Pointer}, mapping to ROM ${segment.loader.romOffset}.`,
        `_LABEL_26F4_ calls _LABEL_8FB_ after loading the subrecord-selected pointer (ASM lines 6472-6478).`,
        `The _LABEL_8FB_ decoder validates ${segment.loader.entries} entries, ${segment.loader.totalTiles} tile(s), and ${segment.loader.consumedBytes} consumed byte(s) from this offset.`,
      ]
      : isTailZero
        ? [
          'Adjacent room-subrecord-selected _LABEL_8FB_ loaders were split using decoded terminators.',
          `Local ROM byte-class scan shows ${segment.size} all-zero byte(s) in this segment.`,
          'ASM defines the containing _DATA_12337_ incbin through 0x13AEF, followed by the labeled _DATA_13AF0_ loader.',
        ]
        : isTileCandidate
          ? [
            'Adjacent room-subrecord-selected _LABEL_8FB_ loaders were split using decoded terminators.',
            `The segment is ${segment.size} byte(s), exactly ${segment.tileShape.recordCount} candidate 32-byte SMS tile record(s).`,
            'Current mapped vram_loader_8fb/vram_loader_998 source scans do not overlap this segment, so the runtime consumer remains unresolved.',
            'ASM defines the containing _DATA_12337_ incbin through 0x13AEF, followed by the labeled _DATA_13AF0_ loader.',
          ]
          : isEntitySentinel
            ? [
              'world-room-entity-list-catalog-2026-06-25 confirms this byte as the shared 0xFF empty room entity list sentinel selected through _RAM_CF62_.',
              'The previous whole-tail inline graphics candidate is superseded by the room entity list split.',
              'ASM defines the containing _DATA_12337_ incbin through 0x13AEF, followed by the labeled _DATA_13AF0_ loader.',
            ]
            : isEntityGap
              ? [
                'world-room-entity-list-catalog-2026-06-25 splits confirmed room entity list ranges out of the old whole-tail candidate.',
                'No confirmed room entity pointer, loader source overlap, or direct ASM label currently reaches this middle span.',
                'The span remains a low-confidence data_table until another consumer is traced.',
              ]
              : isOrphanEntityLists
                ? [
                  'world-room-entity-orphan-list-catalog-2026-06-25 decodes this span completely as terminated room entity source lists using the confirmed _LABEL_2948_/_LABEL_2963_ record format.',
                  'No confirmed room subrecord CF62 pointer reaches this span, so it is preserved as orphan/unreached entity data.',
                  'ASM defines the containing _DATA_12337_ incbin through 0x13AEF, followed by the labeled _DATA_13AF0_ loader.',
                ]
              : isEntityLists
                ? [
                  'world-room-entity-list-catalog-2026-06-25 confirms bank-4 room entity source lists selected by the room subrecord CF62 pointer field.',
                  '_LABEL_2948_/_LABEL_2963_ decode those lists into runtime entity records.',
                  'The previous whole-tail inline graphics candidate is superseded by the room entity list split.',
                ]
          : [
            'Adjacent room-subrecord-selected _LABEL_8FB_ loaders were split using decoded terminators.',
            'No room subrecord, zone graph descriptor, or direct ASM consumer has been confirmed for this remaining byte range yet.',
          ],
    generatedAt: now,
    tool: 'tools/world-room-subrecord-audit.mjs',
  };
}

function applySegmentRanges(mapData, catalog, rom) {
  const segments = plannedSegments(catalog.loaderReferences, rom, mapData).sort((a, b) => a.start - b.start);
  let nextId = nextRegionNumber(mapData);
  const changed = [];
  const evidenceOnly = [];
  const missingContainers = [];

  for (const range of managedRanges) {
    const rangeSegments = segments.filter(segment => segment.range.start === range.start);
    const alreadySplit = rangeSegments.every(segment => {
      const exact = findExactRegion(mapData, segment.start);
      return exact && (exact.size || 0) === segment.size && (exact.type || 'unknown') === segmentRegionType(segment);
    });

    if (alreadySplit) {
      for (const segment of rangeSegments) {
        const exact = findExactRegion(mapData, segment.start);
        exact.analysis = exact.analysis || {};
        exact.analysis.roomSubrecordAudit = buildSegmentAnalysis(segment, exact);
        exact.name = segmentRegionName(segment);
        exact.confidence = segmentConfidence(segment);
        evidenceOnly.push(regionRef(exact));
      }
      continue;
    }

    const pendingByContainer = new Map();
    for (const segment of rangeSegments) {
      const exact = findExactRegion(mapData, segment.start);
      if (exact && (exact.size || 0) === segment.size && (exact.type || 'unknown') === segmentRegionType(segment)) {
        exact.analysis = exact.analysis || {};
        exact.analysis.roomSubrecordAudit = buildSegmentAnalysis(segment, exact);
        exact.name = segmentRegionName(segment);
        exact.confidence = segmentConfidence(segment);
        evidenceOnly.push(regionRef(exact));
        continue;
      }
      const container = findContainingRegion(mapData, segment.start);
      if (!container || endOf(container) < segment.start + segment.size) {
        missingContainers.push({
          offset: hex(segment.start),
          size: segment.size,
          kind: segment.kind,
          expectedType: segmentRegionType(segment),
          range: [hex(range.start), hex(range.endExclusive - 1)],
        });
        continue;
      }
      if (!pendingByContainer.has(container.id)) {
        pendingByContainer.set(container.id, {
          container,
          previous: {
            id: container.id,
            offset: container.offset,
            size: container.size || 0,
            type: container.type || 'unknown',
            name: container.name || '',
            analysis: cloneJson(container.analysis || {}),
          },
          segments: [],
        });
      }
      pendingByContainer.get(container.id).segments.push(segment);
    }

    for (const group of pendingByContainer.values()) {
      const { container, previous } = group;
      const groupSegments = group.segments.sort((a, b) => a.start - b.start);
      if (groupSegments[0]?.start !== offsetOf(container)) {
        for (const segment of groupSegments) {
          missingContainers.push({
            offset: hex(segment.start),
            size: segment.size,
            kind: segment.kind,
            expectedType: segmentRegionType(segment),
            range: [hex(offsetOf(container)), hex(endOf(container) - 1)],
            reason: 'segment does not start at the beginning of its current container; non-destructive split would need a leading segment',
          });
        }
        continue;
      }

      for (const [index, segment] of groupSegments.entries()) {
      if (index === 0) {
        container.size = segment.size;
        container.type = segmentRegionType(segment);
        container.name = segmentRegionName(segment);
        container.confidence = segmentConfidence(segment);
        container.notes = segment.kind === 'room_subrecord_vram_loader_8fb'
          ? 'Split from prior unresolved range after room subrecord pointer validation.'
          : segment.kind === 'room_subrecord_tail_gfx_tile_candidate'
            ? 'Low-confidence 32-byte-record graphics candidate after room-subrecord loader; consumer not identified yet.'
            : segment.kind.startsWith('room_subrecord_tail_zero_')
              ? 'All-zero separator/padding split from tail after room-subrecord loader.'
              : 'Tail after room-subrecord-selected loader; consumer not identified yet.';
        container.analysis = container.analysis || {};
        container.analysis.roomSubrecordAudit = buildSegmentAnalysis(segment, previous);
        changed.push({ before: previous, after: regionRef(container) });
        continue;
      }

      const newRegion = {
        id: formatRegionId(nextId++),
        offset: hex(segment.start),
        size: segment.size,
        type: segmentRegionType(segment),
        name: segmentRegionName(segment),
        confidence: segmentConfidence(segment),
        notes: segment.kind === 'room_subrecord_vram_loader_8fb'
          ? 'Split from prior unresolved range after room subrecord pointer validation.'
          : segment.kind === 'room_subrecord_tail_gfx_tile_candidate'
            ? 'Low-confidence 32-byte-record graphics candidate after room-subrecord loader; consumer not identified yet.'
            : segment.kind.startsWith('room_subrecord_tail_zero_')
              ? 'All-zero separator/padding split from tail after room-subrecord loader.'
              : 'Tail after room-subrecord-selected loader; consumer not identified yet.',
        analysis: {
          roomSubrecordAudit: buildSegmentAnalysis(segment, previous),
        },
      };
      mapData.regions.push(newRegion);
      changed.push({ before: previous, after: regionRef(newRegion) });
    }
    }
  }

  mapData.regions.sort((a, b) => offsetOf(a) - offsetOf(b) || (a.size || 0) - (b.size || 0));
  return { changed, evidenceOnly, missingContainers };
}

function annotateLoaderReferences(mapData, catalog) {
  const annotated = [];
  for (const loader of catalog.loaderReferences) {
    const region = findExactRegion(mapData, parseInt(loader.romOffset, 16));
    if (!region || (region.type || '') !== 'vram_loader_8fb') continue;
    region.analysis = region.analysis || {};
    region.analysis.roomSubrecordLoaderRefs = {
      catalogId,
      kind: 'room_subrecord_loader_reference',
      confidence: 'high',
      referenceCount: loader.referenceCount,
      zoneGraphReachedReferences: loader.zoneGraphReachedReferences,
      structuralOrphanReferences: loader.structuralOrphanReferences,
      subrecordOffsets: loader.subrecordOffsets,
      evidence: [
        'Room subrecord layout is parsed from _LABEL_26F4_ field usage.',
        'Each referenced loader decodes cleanly with the _LABEL_8FB_ model.',
      ],
      generatedAt: now,
      tool: 'tools/world-room-subrecord-audit.mjs',
    };
    annotated.push(regionRef(region));
  }
  return annotated;
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);

  const tableChange = apply ? annotateTableRegion(mapData, catalog) : null;
  const segmentChanges = apply ? applySegmentRanges(mapData, catalog, rom) : { changed: [], evidenceOnly: [], missingContainers: [] };
  const loaderAnnotations = apply ? annotateLoaderReferences(mapData, catalog) : [];

  if (apply) {
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_subrecord_audit',
      generatedAt: now,
      tool: 'tools/world-room-subrecord-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        tableRegionChanged: Boolean(tableChange?.changedType),
        segmentChanges: segmentChanges.changed.length,
        segmentEvidenceOnly: segmentChanges.evidenceOnly.length,
        missingContainers: segmentChanges.missingContainers.length,
        annotatedLoaderRegions: loaderAnnotations.length,
      },
      tableRegion: tableChange,
      changedSegments: segmentChanges.changed,
      evidenceOnlySegments: segmentChanges.evidenceOnly,
      missingContainers: segmentChanges.missingContainers,
      annotatedLoaderRegions: loaderAnnotations,
      supersedes: [
        {
          catalogId: 'world-screen-prog-reachability-catalog-2026-06-24',
          reason: 'r0341 is no longer an unexplained screen_prog candidate; the room subrecord table has a confirmed _LABEL_2620_/_LABEL_26F4_ consumer model.',
        },
        {
          catalogId: 'world-zone-loader-boundary-catalog-2026-06-25',
          reason: 'The previously unresolved 0x12707, 0x127DD, and 0x12CD2 ranges now have room-subrecord-selected _LABEL_8FB_ loader evidence.',
        },
      ],
      nextLeads: [
        'Trace whether the seven structural-orphan subrecords are selected by non-door game-state transitions, special rooms, or disabled content.',
        'Decode the unresolved prefix/suffix around the aligned 0x1072C subrecord table.',
        'Use subrecord audioRequestId metadata to connect room entries with _DATA_D139_ audio request taxonomy.',
        'Find a runtime consumer for the low-confidence 0x12D90-0x13ACF candidate tile-record span before treating it as active room graphics.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    layout: catalog.layout,
    orphanRecords: catalog.records
      .filter(record => record.status === 'structural_orphan')
      .map(record => ({
        index: record.index,
        offset: record.offset,
        doorTableOffset: record.doorTable?.romOffset || null,
        loaderOffset: record.vramLoader8fb?.romOffset || null,
        loaderConsumedBytes: record.vramLoader8fb?.consumedBytes || null,
        loaderEntries: record.vramLoader8fb?.entries || null,
        loaderTotalTiles: record.vramLoader8fb?.totalTiles || null,
        issues: record.issues,
      })),
    plannedSegments: catalog.plannedSegments,
    tableChange,
    segmentChanges,
    annotatedLoaderRegions: loaderAnnotations.length,
  }, null, 2));
}

main();
