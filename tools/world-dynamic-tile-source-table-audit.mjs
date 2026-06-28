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
const catalogId = 'world-dynamic-tile-source-table-catalog-2026-06-25';
const reportId = 'dynamic-tile-source-table-audit-2026-06-25';
const toolName = 'tools/world-dynamic-tile-source-table-audit.mjs';

const TABLES = [
  {
    id: 'entity_dynamic_tiles_normal',
    label: '$9D60 normal entity dynamic tile source table',
    selector: 'bit 7 clear in entity id at (ix+0)',
    z80Base: 0x9D60,
    romBase: 0x1DD60,
    wordSlots: 80,
    expectedLiveEntries: 69,
  },
  {
    id: 'entity_dynamic_tiles_alternate',
    label: '$9E00 alternate entity dynamic tile source table',
    selector: 'bit 7 set in entity id at (ix+0), then id is masked with 0x7F',
    z80Base: 0x9E00,
    romBase: 0x1DE00,
    wordSlots: 16,
    expectedLiveEntries: 16,
  },
];

const TABLE_CARRIER_REGION_IDS = ['r2712', 'r2713', 'r2747', 'r2715', 'r2748'];
const STREAM_BUNDLE_REGION_IDS = ['r2749', 'r2717', 'r2719', 'r2720'];
const SOURCE_GRAPHICS_REGION_IDS = ['r0754', 'r0756', 'r0758', 'r0759', 'r0760', 'r0761'];

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

function readWordLE(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function bankedZ80ToRom(bank, z80Address) {
  if (z80Address < 0x8000 || z80Address > 0xBFFF) return null;
  return bank * 0x4000 + (z80Address - 0x8000);
}

function normalizeDynamicSourceWord(word) {
  const remapRow = (word >>> 14) & 0x03;
  const streamZ80Address = (word & 0x3FFF) | 0x8000;
  return {
    word,
    remapRow,
    streamZ80Address,
    streamRomOffset: bankedZ80ToRom(7, streamZ80Address),
  };
}

function sourceWordToSpan(word, count) {
  const sourceBank = word >>> 9;
  const tileIndex = word & 0x01FF;
  const sourceZ80Address = 0x8000 + tileIndex * 32;
  const sourceRomOffset = bankedZ80ToRom(sourceBank, sourceZ80Address);
  return {
    sourceBank,
    tileIndex,
    sourceZ80Address,
    sourceRomOffset,
    byteCount: count * 32,
  };
}

function decodeDynamicLoaderStream(rom, mapData, startOffset) {
  let cursor = startOffset;
  const records = [];
  const sourceSpans = [];
  let recordCount = 0;
  let sourceRecordCount = 0;
  let destinationResetCount = 0;
  let zeroFillTileBlocks = 0;
  let totalTileBlocks = 0;
  let terminated = false;
  const warnings = [];

  for (let step = 0; step < 256 && cursor < rom.length; step++) {
    const opcodeOffset = cursor;
    let count = rom[cursor++];
    if (count === 0x00) {
      terminated = true;
      break;
    }

    let destinationTile = null;
    if (count & 0x80) {
      count &= 0x7F;
      destinationTile = rom[cursor++];
      destinationResetCount++;
    }

    if (count === 0x7F) {
      zeroFillTileBlocks++;
      totalTileBlocks++;
      records.push({
        opcodeOffset: hex(opcodeOffset),
        kind: 'zero_fill_tile_block',
        destinationTile,
        tileBlocks: 1,
      });
      continue;
    }

    const sourceWord = readWordLE(rom, cursor);
    cursor += 2;
    const span = sourceWordToSpan(sourceWord, count);
    const sourceRegion = findContainingRegion(mapData, span.sourceRomOffset);
    const sourceSpan = {
      ...span,
      sourceRomOffset: hex(span.sourceRomOffset),
      sourceZ80Address: hex(span.sourceZ80Address, 4),
      sourceEndExclusive: hex(span.sourceRomOffset + span.byteCount),
      sourceRegion: regionRef(sourceRegion),
    };
    sourceSpans.push(sourceSpan);
    sourceRecordCount++;
    totalTileBlocks += count;
    recordCount++;
    records.push({
      opcodeOffset: hex(opcodeOffset),
      kind: 'source_tile_record',
      destinationTile,
      tileBlocks: count,
      sourceBank: span.sourceBank,
      sourceTileIndex: span.tileIndex,
      sourceRomOffset: sourceSpan.sourceRomOffset,
      sourceRegionId: sourceRegion?.id || null,
    });
  }

  if (!terminated) warnings.push('loader stream did not terminate within 256 parser steps');

  return {
    startOffset,
    endExclusive: cursor,
    consumedBytes: cursor - startOffset,
    terminated,
    recordCount,
    sourceRecordCount,
    destinationResetCount,
    zeroFillTileBlocks,
    totalTileBlocks,
    sourceSpans,
    sourceBanks: [...new Set(sourceSpans.map(span => span.sourceBank))].sort((a, b) => a - b),
    sourceRegionIds: [...new Set(sourceSpans.map(span => span.sourceRegion?.id).filter(Boolean))].sort(),
    warnings,
    recordPreview: records.slice(0, 6),
  };
}

function decodeTable(rom, mapData, table) {
  const entries = [];
  for (let index = 0; index < table.wordSlots; index++) {
    const entryOffset = table.romBase + index * 2;
    const word = readWordLE(rom, entryOffset);
    const normalized = normalizeDynamicSourceWord(word);
    const targetRegion = normalized.streamRomOffset == null ? null : findContainingRegion(mapData, normalized.streamRomOffset);
    entries.push({
      tableId: table.id,
      index,
      entryOffset,
      word,
      isZeroPadding: word === 0x0000,
      remapRow: normalized.remapRow,
      streamZ80Address: normalized.streamZ80Address,
      streamRomOffset: normalized.streamRomOffset,
      targetRegion: regionRef(targetRegion),
    });
  }
  return entries;
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(item => item.endExclusive > item.start)
    .sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
  const merged = [];
  for (const item of sorted) {
    const last = merged[merged.length - 1];
    if (!last || item.start > last.endExclusive) {
      merged.push({ start: item.start, endExclusive: item.endExclusive });
    } else if (item.endExclusive > last.endExclusive) {
      last.endExclusive = item.endExclusive;
    }
  }
  return merged;
}

function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function regionOverlapSummary(region, intervals) {
  const start = offsetOf(region);
  const end = endOf(region);
  const clipped = [];
  for (const interval of intervals) {
    const overlapStart = Math.max(start, interval.start);
    const overlapEnd = Math.min(end, interval.endExclusive);
    if (overlapStart < overlapEnd) clipped.push({ start: overlapStart, endExclusive: overlapEnd });
  }
  const merged = mergeIntervals(clipped);
  return {
    region: regionRef(region),
    uniqueBytes: merged.reduce((sum, span) => sum + (span.endExclusive - span.start), 0),
    spanCount: merged.length,
    spans: merged.slice(0, 12).map(span => ({
      start: hex(span.start),
      endInclusive: hex(span.endExclusive - 1),
      size: span.endExclusive - span.start,
    })),
  };
}

function buildCatalog(mapData, rom) {
  const tableEntries = TABLES.flatMap(table => decodeTable(rom, mapData, table));
  const liveEntries = tableEntries.filter(entry => !entry.isZeroPadding);
  const zeroPaddingEntries = tableEntries.filter(entry => entry.isZeroPadding);
  const streamMap = new Map();

  for (const entry of liveEntries) {
    if (entry.streamRomOffset == null) continue;
    const key = String(entry.streamRomOffset);
    if (!streamMap.has(key)) {
      const decoded = decodeDynamicLoaderStream(rom, mapData, entry.streamRomOffset);
      streamMap.set(key, {
        streamRomOffset: entry.streamRomOffset,
        streamZ80Address: entry.streamZ80Address,
        targetRegion: entry.targetRegion,
        referencedBy: [],
        remapRows: new Set(),
        decoded,
      });
    }
    const stream = streamMap.get(key);
    stream.referencedBy.push({ tableId: entry.tableId, index: entry.index, entryOffset: entry.entryOffset });
    stream.remapRows.add(entry.remapRow);
  }

  const streams = [...streamMap.values()].sort((a, b) => a.streamRomOffset - b.streamRomOffset);
  const streamIntervals = streams.map(stream => ({
    start: stream.decoded.startOffset,
    endExclusive: stream.decoded.endExclusive,
  }));
  const sourceIntervals = streams.flatMap(stream => stream.decoded.sourceSpans.map(span => ({
    start: parseInt(span.sourceRomOffset, 16),
    endExclusive: parseInt(span.sourceEndExclusive, 16),
  })));
  const mergedSourceIntervals = mergeIntervals(sourceIntervals);

  const sourceRegionSummaries = SOURCE_GRAPHICS_REGION_IDS
    .map(id => findRegionById(mapData, id))
    .filter(Boolean)
    .map(region => regionOverlapSummary(region, sourceIntervals))
    .filter(summary => summary.uniqueBytes > 0);

  const tableRangeIntervals = TABLES.map(table => ({
    tableId: table.id,
    start: table.romBase,
    endExclusive: table.romBase + table.wordSlots * 2,
  }));
  const tableCarrierSummaries = TABLE_CARRIER_REGION_IDS
    .map(id => findRegionById(mapData, id))
    .filter(Boolean)
    .map(region => {
      const start = offsetOf(region);
      const end = endOf(region);
      const ranges = [];
      for (const tableRange of tableRangeIntervals) {
        const overlapStart = Math.max(start, tableRange.start);
        const overlapEnd = Math.min(end, tableRange.endExclusive);
        if (overlapStart < overlapEnd) {
          const firstIndex = Math.floor((overlapStart - tableRange.start) / 2);
          const lastIndex = Math.floor((overlapEnd - tableRange.start - 1) / 2);
          const entriesInRange = tableEntries.filter(entry => (
            entry.tableId === tableRange.tableId &&
            entry.entryOffset >= overlapStart &&
            entry.entryOffset + 2 <= overlapEnd
          ));
          ranges.push({
            tableId: tableRange.tableId,
            start: hex(overlapStart),
            endInclusive: hex(overlapEnd - 1),
            entryIndexStart: firstIndex,
            entryIndexEnd: lastIndex,
            wordSlots: entriesInRange.length,
            liveEntries: entriesInRange.filter(entry => !entry.isZeroPadding).length,
            zeroPaddingEntries: entriesInRange.filter(entry => entry.isZeroPadding).length,
          });
        }
      }
      return {
        region: regionRef(region),
        ranges,
        liveEntries: ranges.reduce((sum, range) => sum + range.liveEntries, 0),
        zeroPaddingEntries: ranges.reduce((sum, range) => sum + range.zeroPaddingEntries, 0),
      };
    })
    .filter(summary => summary.ranges.length > 0);

  const streamBundleSummaries = STREAM_BUNDLE_REGION_IDS
    .map(id => findRegionById(mapData, id))
    .filter(Boolean)
    .map(region => {
      const start = offsetOf(region);
      const end = endOf(region);
      const coveringStreams = streams.filter(stream => intervalsOverlap(
        stream.decoded.startOffset,
        stream.decoded.endExclusive,
        start,
        end,
      ));
      const directTargets = streams.filter(stream => stream.streamRomOffset >= start && stream.streamRomOffset < end);
      return {
        region: regionRef(region),
        streamCoverage: regionOverlapSummary(region, streamIntervals),
        directStreamEntryCount: directTargets.length,
        coveringStreamCount: coveringStreams.length,
        tableReferenceCount: coveringStreams.reduce((sum, stream) => sum + stream.referencedBy.length, 0),
        directStreamOffsets: directTargets.slice(0, 16).map(stream => hex(stream.streamRomOffset)),
      };
    })
    .filter(summary => summary.coveringStreamCount > 0);

  const tableSummaries = TABLES.map(table => {
    const entries = tableEntries.filter(entry => entry.tableId === table.id);
    const live = entries.filter(entry => !entry.isZeroPadding);
    const byRegion = {};
    const byRemapRow = {};
    for (const entry of entries) {
      const regionId = entry.isZeroPadding ? 'zero_padding' : (entry.targetRegion?.id || 'unmapped');
      byRegion[regionId] = (byRegion[regionId] || 0) + 1;
      if (!entry.isZeroPadding) byRemapRow[entry.remapRow] = (byRemapRow[entry.remapRow] || 0) + 1;
    }
    return {
      id: table.id,
      label: table.label,
      selector: table.selector,
      z80Base: hex(table.z80Base, 4),
      romBase: hex(table.romBase),
      wordSlots: table.wordSlots,
      liveEntries: live.length,
      zeroPaddingEntries: entries.length - live.length,
      expectedLiveEntries: table.expectedLiveEntries,
      remapRowCounts: byRemapRow,
      targetRegionCounts: byRegion,
      entryPreview: entries.slice(0, 8).map(entry => ({
        index: entry.index,
        entryOffset: hex(entry.entryOffset),
        word: hex(entry.word, 4),
        remapRow: entry.remapRow,
        streamZ80Address: hex(entry.streamZ80Address, 4),
        streamRomOffset: hex(entry.streamRomOffset),
        targetRegionId: entry.targetRegion?.id || null,
        zeroPadding: entry.isZeroPadding,
      })),
    };
  });

  const sourceRecordCount = streams.reduce((sum, stream) => sum + stream.decoded.sourceRecordCount, 0);
  const totalTileBlocks = streams.reduce((sum, stream) => sum + stream.decoded.totalTileBlocks, 0);
  const sourceBanks = [...new Set(streams.flatMap(stream => stream.decoded.sourceBanks))].sort((a, b) => a - b);
  const streamTargetRegionIds = [...new Set(streams.map(stream => stream.targetRegion?.id).filter(Boolean))].sort();
  const warnings = streams.flatMap(stream => stream.decoded.warnings.map(warning => ({
    streamRomOffset: hex(stream.streamRomOffset),
    warning,
  })));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      tableCount: TABLES.length,
      tableWordSlots: tableEntries.length,
      liveTableEntries: liveEntries.length,
      zeroPaddingEntries: zeroPaddingEntries.length,
      uniqueDynamicLoaderStreams: streams.length,
      streamTargetRegionCount: streamTargetRegionIds.length,
      streamTargetRegionIds,
      sourceRecordCount,
      totalTileBlocks,
      sourceBanks,
      sourceGraphicsRegionCount: sourceRegionSummaries.length,
      sourceGraphicsRegionIds: sourceRegionSummaries.map(summary => summary.region.id),
      uniqueSourceBytes: mergedSourceIntervals.reduce((sum, span) => sum + (span.endExclusive - span.start), 0),
      warningCount: warnings.length,
      assetPolicy: 'Metadata only: offsets, pointers, labels, counts, range summaries, and routine evidence. No ROM bytes, decoded graphics, screenshots, or rendered assets are embedded.',
    },
    evidence: [
      'ASM lines 6893-6925 switch to bank 7, index $9D60 or $9E00 using the entity id at (ix+0), read a word with RST $18, normalize the low 14 bits to $8000-$BFFF, derive _RAM_D0EC_ from the high two bits, and call _LABEL_A97_.',
      'ASM lines 2288-2360 show _LABEL_998_/_LABEL_99B_ and _LABEL_9C3_ sharing the same tile-loader record parser used by _LABEL_A97_.',
      'ASM lines 2453-2566 show _LABEL_A97_ consuming the parsed source records through the _DATA_B4F_ remap table before VDP writes.',
      'ASM lines 28527-28554 place the bank-7 word tables and loader stream bundle at 0x1DD60-0x1E14D.',
    ],
    routines: [
      {
        label: '_LABEL_29E6_ local ++++ caller',
        role: 'entity_dynamic_tile_source_table_consumer',
        confidence: 'high',
      },
      {
        label: '_LABEL_A97_',
        role: 'dynamic_tile_decode_upload',
        confidence: 'high',
      },
      {
        label: '_LABEL_9C3_',
        role: 'tile_loader_record_parser',
        confidence: 'high',
      },
    ],
    tables: tableSummaries,
    tableCarrierRegions: tableCarrierSummaries,
    streamBundleRegions: streamBundleSummaries,
    sourceGraphicsRegions: sourceRegionSummaries,
    streams: streams.map(stream => ({
      streamRomOffset: hex(stream.streamRomOffset),
      streamZ80Address: hex(stream.streamZ80Address, 4),
      targetRegion: stream.targetRegion,
      referencedByCount: stream.referencedBy.length,
      referencedBy: stream.referencedBy.map(ref => ({
        tableId: ref.tableId,
        index: ref.index,
        entryOffset: hex(ref.entryOffset),
      })),
      remapRows: [...stream.remapRows].sort((a, b) => a - b),
      decoded: {
        consumedBytes: stream.decoded.consumedBytes,
        endInclusive: hex(stream.decoded.endExclusive - 1),
        terminated: stream.decoded.terminated,
        sourceRecordCount: stream.decoded.sourceRecordCount,
        destinationResetCount: stream.decoded.destinationResetCount,
        zeroFillTileBlocks: stream.decoded.zeroFillTileBlocks,
        totalTileBlocks: stream.decoded.totalTileBlocks,
        sourceBanks: stream.decoded.sourceBanks,
        sourceRegionIds: stream.decoded.sourceRegionIds,
        warnings: stream.decoded.warnings,
        recordPreview: stream.decoded.recordPreview,
      },
    })),
    warnings,
    nextLeads: [
      'Use room entity records to prove which entity ids select each $9D60/$9E00 table entry and name entries by entity/form.',
      'Add a browser-local _LABEL_A97_ dynamic tile decoder that populates synthetic VRAM tile provenance from these table entries.',
      'Split the mixed table/stream bundle regions only after adjacent scripts agree on boundaries and no manual annotations would be lost.',
    ],
  };
}

function appendNote(region, note) {
  if (!note) return;
  const existing = region.notes || '';
  if (existing.includes(note)) return;
  region.notes = existing ? `${existing} ${note}` : note;
}

function setSupersededCandidate(region, reason) {
  if (!region.analysis) return;
  for (const key of ['bank7VdpStreamAudit', 'pauseStatusStreamLoaderDisambiguationAudit', 'pauseStatusLoaderBundleAudit']) {
    if (!region.analysis[key]) continue;
    region.analysis[key].supersededBy = catalogId;
    region.analysis[key].supersededReason = reason;
  }
}

function annotateTableCarrier(region, summary) {
  const before = regionRef(region);
  const isR2712 = region.id === 'r2712';
  if (!isR2712) {
    region.type = 'pointer_table';
    region.confidence = 'high';
  }
  const names = {
    r2713: '_DATA_1DD64_ dynamic tile source table entry',
    r2747: 'dynamic tile source table entries @ 0x1DD66',
    r2715: '_DATA_1DE04_ dynamic tile source table entry',
    r2748: 'dynamic tile source table entries @ 0x1DE06',
  };
  if (names[region.id]) region.name = names[region.id];
  appendNote(region, isR2712
    ? 'Tail bytes 0x1DD60-0x1DD63 are also bank-7 dynamic tile source table entries selected by _LABEL_29E6_.'
    : 'Bank-7 dynamic tile source table words selected by _LABEL_29E6_ and consumed by _LABEL_A97_.');
  region.analysis = region.analysis || {};
  region.analysis.dynamicTileSourceTableAudit = {
    catalogId,
    kind: isR2712 ? 'screen_prog_with_trailing_dynamic_tile_source_entries' : 'dynamic_tile_source_pointer_table_entries',
    confidence: 'high',
    summary: isR2712
      ? 'The mapped pause screen program ends with two words that are also the first $9D60 dynamic tile source table entries.'
      : 'Word entries in the $9D60/$9E00 bank-7 dynamic tile source tables consumed by the entity loader path.',
    tableRanges: summary.ranges,
    liveEntries: summary.liveEntries,
    zeroPaddingEntries: summary.zeroPaddingEntries,
    evidence: [
      'ASM lines 6893-6925 index $9D60/$9E00 in bank 7 and call _LABEL_A97_ with the selected stream pointer.',
      'ASM lines 28527-28554 define the adjacent bank-7 table and stream data at this ROM range.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  if (region.analysis.unresolvedAssetConsumerAudit) {
    region.analysis.unresolvedAssetConsumerAudit.consumerStatus = 'consumer_confirmed_dynamic_tile_source_table';
    region.analysis.unresolvedAssetConsumerAudit.resolvedBy = catalogId;
    region.analysis.unresolvedAssetConsumerAudit.resolution = 'Consumed as bank-7 dynamic tile source table entries by _LABEL_29E6_ and _LABEL_A97_.';
  }
  setSupersededCandidate(region, 'Confirmed as dynamic tile source table entries, not a pause/status VDP stream payload.');
  return { before, after: regionRef(region), role: region.analysis.dynamicTileSourceTableAudit.kind };
}

function annotateStreamBundle(region, summary) {
  const before = regionRef(region);
  region.type = 'dynamic_tile_loader';
  region.confidence = 'high';
  const names = {
    r2749: '_DATA_1DE20_ dynamic tile loader stream bundle',
    r2717: 'dynamic tile loader stream bundle fragment @ 0x1DE9F',
    r2719: 'dynamic tile loader stream bundle fragment @ 0x1DEAF',
    r2720: 'dynamic tile loader stream bundle fragment @ 0x1DF2A',
  };
  if (names[region.id]) region.name = names[region.id];
  appendNote(region, 'Consumed by _LABEL_A97_ through $9D60/$9E00 dynamic tile source table pointers; metadata only, no tile bytes embedded.');
  region.analysis = region.analysis || {};
  region.analysis.dynamicTileSourceTableAudit = {
    catalogId,
    kind: 'dynamic_tile_loader_stream_bundle',
    confidence: 'high',
    summary: 'Zero-terminated _LABEL_9C3_ loader streams selected by bank-7 dynamic tile source table entries and decoded by _LABEL_A97_.',
    directStreamEntryCount: summary.directStreamEntryCount,
    coveringStreamCount: summary.coveringStreamCount,
    tableReferenceCount: summary.tableReferenceCount,
    streamCoverage: summary.streamCoverage,
    directStreamOffsets: summary.directStreamOffsets,
    evidence: [
      'ASM lines 6893-6925 normalize table words into stream pointers and call _LABEL_A97_.',
      'ASM lines 2310-2360 parse the loader records; ASM lines 2453-2566 decode/upload them through the dynamic remap path.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  setSupersededCandidate(region, 'Confirmed as dynamic tile loader streams selected by $9D60/$9E00, not a pause/status VDP stream bundle.');
  return { before, after: regionRef(region), role: 'dynamic_tile_loader_stream_bundle' };
}

function annotateSourceGraphics(region, summary) {
  const before = regionRef(region);
  region.analysis = region.analysis || {};
  region.analysis.dynamicTileSourceTableAudit = {
    catalogId,
    kind: 'dynamic_tile_loader_graphics_source',
    confidence: 'high',
    summary: 'Graphics source range referenced by dynamic tile loader records selected from the bank-7 $9D60/$9E00 tables.',
    uniqueBytes: summary.uniqueBytes,
    spanCount: summary.spanCount,
    spans: summary.spans,
    evidence: [
      'ASM lines 2310-2360 decode source bank/tile pointers from loader records.',
      'ASM lines 2453-2566 read those source bytes through _LABEL_A97_ before writing transformed tile data to VDP.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  return { before, after: regionRef(region), role: 'dynamic_tile_loader_graphics_source' };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];

  for (const summary of catalog.tableCarrierRegions) {
    const region = findRegionById(mapData, summary.region.id);
    if (!region) {
      missingRegions.push(summary.region);
      continue;
    }
    changedRegions.push(annotateTableCarrier(region, summary));
  }

  for (const summary of catalog.streamBundleRegions) {
    const region = findRegionById(mapData, summary.region.id);
    if (!region) {
      missingRegions.push(summary.region);
      continue;
    }
    changedRegions.push(annotateStreamBundle(region, summary));
  }

  for (const summary of catalog.sourceGraphicsRegions) {
    const region = findRegionById(mapData, summary.region.id);
    if (!region) {
      missingRegions.push(summary.region);
      continue;
    }
    changedRegions.push(annotateSourceGraphics(region, summary));
  }

  mapData.tileSourceCatalogs = (mapData.tileSourceCatalogs || []).filter(item => item.id !== catalogId);
  mapData.tileSourceCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'dynamic_tile_source_table_audit',
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
    tables: catalog.tables.map(table => ({
      id: table.id,
      z80Base: table.z80Base,
      romBase: table.romBase,
      wordSlots: table.wordSlots,
      liveEntries: table.liveEntries,
      zeroPaddingEntries: table.zeroPaddingEntries,
      remapRowCounts: table.remapRowCounts,
      targetRegionCounts: table.targetRegionCounts,
    })),
    streamBundleRegions: catalog.streamBundleRegions.map(summary => ({
      id: summary.region.id,
      directStreamEntryCount: summary.directStreamEntryCount,
      coveringStreamCount: summary.coveringStreamCount,
      tableReferenceCount: summary.tableReferenceCount,
      uniqueCoverageBytes: summary.streamCoverage.uniqueBytes,
    })),
    sourceGraphicsRegions: catalog.sourceGraphicsRegions.map(summary => ({
      id: summary.region.id,
      uniqueBytes: summary.uniqueBytes,
      spanCount: summary.spanCount,
    })),
    changedRegionCount: changes.changedRegions.length,
    missingRegionCount: changes.missingRegions.length,
  }, null, 2));
}

main();
