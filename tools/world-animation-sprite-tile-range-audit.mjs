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
const catalogId = 'world-animation-sprite-tile-range-catalog-2026-06-25';
const reportId = 'animation-sprite-tile-range-audit-2026-06-25';
const toolName = 'tools/world-animation-sprite-tile-range-audit.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function hexByte(n) {
  return hex(n & 0xff, 2);
}

function normOffset(value) {
  if (value == null) return null;
  if (typeof value === 'number') return hex(value);
  return '0x' + String(value).replace(/^0x/i, '').toUpperCase().padStart(5, '0');
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function requireCatalog(mapData, key, id) {
  const catalog = (mapData[key] || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required catalog ${key}.${id}`);
  return catalog;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function summarizeByteValues(values) {
  if (!values.length) {
    return {
      count: 0,
      min: null,
      max: null,
      uniqueCount: 0,
    };
  }
  return {
    count: values.length,
    min: hexByte(Math.min(...values)),
    max: hexByte(Math.max(...values)),
    uniqueCount: new Set(values).size,
  };
}

function contiguousSegments(values) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (!sorted.length) return [];
  const segments = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const value = sorted[i];
    if (value === prev + 1) {
      prev = value;
      continue;
    }
    segments.push({ start: hexByte(start), end: hexByte(prev), count: prev - start + 1 });
    start = value;
    prev = value;
  }
  segments.push({ start: hexByte(start), end: hexByte(prev), count: prev - start + 1 });
  return segments;
}

function parseFrameTileBytes(rom, startOffset, recordLimit = 128) {
  const tileBytes = [];
  const tileByteOffsets = [];
  const issues = [];
  let pos = startOffset;
  let termination = null;
  for (let i = 0; i < recordLimit; i++) {
    if (pos < 0 || pos >= rom.length) {
      issues.push({ kind: 'out_of_rom', atOffset: hex(pos) });
      termination = { kind: 'out_of_rom', normal: false, atOffset: hex(pos) };
      break;
    }
    const recordOffset = pos;
    const control = rom[pos++];
    if (control === 0x80) {
      termination = { kind: 'terminator_0x80', normal: true, terminatorOffset: hex(recordOffset) };
      break;
    }
    if (pos + 1 >= rom.length) {
      issues.push({ kind: 'truncated_piece_record', atOffset: hex(recordOffset) });
      termination = { kind: 'truncated_piece_record', normal: false, atOffset: hex(recordOffset) };
      break;
    }
    const tileOffset = pos + 1;
    tileBytes.push(rom[tileOffset]);
    tileByteOffsets.push(hex(tileOffset));
    pos += 2;
  }
  if (!termination) {
    termination = { kind: 'record_limit_reached', normal: false, recordLimit };
    issues.push({ kind: 'record_limit_reached', recordLimit });
  }
  return {
    pieceRecordCount: tileBytes.length,
    tileBytes,
    tileByteOffsets,
    termination,
    issueCount: issues.length,
    issues,
  };
}

function readWord(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function isBank6Ptr(z80Pointer) {
  return z80Pointer >= 0x8000 && z80Pointer < 0xC000;
}

function bank6Z80ToRom(z80Pointer) {
  return z80Pointer + 0x10000;
}

function indexCatalogs(mapData) {
  const commandCatalog = requireCatalog(mapData, 'animationCommandStreamCatalogs', 'world-animation-command-stream-catalog-2026-06-25');
  const frameCatalog = requireCatalog(mapData, 'animationFrameStreamCatalogs', 'world-animation-frame-stream-catalog-2026-06-25');
  const tileBaseCatalog = requireCatalog(mapData, 'animationTileBaseCatalogs', 'world-animation-tile-base-catalog-2026-06-25');
  const rootCatalog = requireCatalog(mapData, 'animationRootSemanticsCatalogs', 'world-animation-root-semantics-catalog-2026-06-25');
  const tileSourceCatalog = requireCatalog(mapData, 'tileSourceCatalogs', 'world-tile-source-catalog-2026-06-24');
  return {
    commandCatalog,
    frameCatalog,
    tileBaseCatalog,
    rootCatalog,
    tileSourceCatalog,
    streamByOffset: new Map((commandCatalog.streams || []).map(stream => [normOffset(stream.offset), stream])),
    frameByOffset: new Map((frameCatalog.frameStreams || []).map(frame => [normOffset(frame.offset), frame])),
    loaderEntries: (tileSourceCatalog.loaderEntries || []).flatMap(loader => (loader.entries || []).map(entry => ({
      loaderRegion: loader.loaderRegion,
      format: loader.format,
      loaderEntryId: loader.id,
      entryOffset: entry.entryOffset,
      kind: entry.kind,
      vramTileRange: entry.vramTileRange,
      source: entry.source || null,
      sourceRegions: loader.sourceRegions || [],
      terminated: loader.terminated,
      warningCount: (loader.warnings || []).length,
    }))),
  };
}

function compactLoaderOverlap(overlap) {
  return {
    loaderRegion: overlap.loaderRegion,
    format: overlap.format,
    entryOffset: overlap.entryOffset,
    loaderRange: overlap.loaderRange,
    overlapRange: overlap.overlapRange,
    overlapTileCount: overlap.overlapTileCount,
    source: overlap.source,
    relation: overlap.relation,
    confidence: overlap.confidence,
  };
}

function findLoaderOverlaps(loaderEntries, segments, options = {}) {
  const overlaps = [];
  for (const segment of segments) {
    const segStart = parseHex(segment.start);
    const segEnd = parseHex(segment.end);
    if (segStart == null || segEnd == null) continue;
    for (const loader of loaderEntries) {
      const loaderStart = parseHex(loader.vramTileRange?.start);
      const loaderEnd = parseHex(loader.vramTileRange?.end);
      if (loaderStart == null || loaderEnd == null) continue;
      const start = Math.max(segStart, loaderStart);
      const end = Math.min(segEnd, loaderEnd);
      if (start > end) continue;
      const relation = options.confirmedLoaderRegionId && loader.loaderRegion?.id === options.confirmedLoaderRegionId
        ? 'confirmed_preload_call_chain'
        : 'vram_range_overlap_candidate';
      const confidence = relation === 'confirmed_preload_call_chain' ? 'high' : 'low';
      overlaps.push({
        loaderRegion: loader.loaderRegion,
        format: loader.format,
        entryOffset: loader.entryOffset,
        loaderRange: loader.vramTileRange,
        overlapRange: { start: hexByte(start), end: hexByte(end), count: end - start + 1 },
        overlapTileCount: end - start + 1,
        source: loader.source ? {
          bank: loader.source.bank,
          romStart: loader.source.romStart,
          romEndExclusive: loader.source.romEndExclusive,
          overlappingRegions: (loader.source.overlappingRegions || []).slice(0, 6),
        } : null,
        relation,
        confidence,
      });
    }
  }
  return overlaps.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1;
    return b.overlapTileCount - a.overlapTileCount || (a.loaderRegion?.offset || '').localeCompare(b.loaderRegion?.offset || '');
  });
}

function frameOffsetsForStreams(streamByOffset, streamOffsets) {
  const refs = [];
  const offsets = new Set();
  for (const streamOffset of streamOffsets) {
    const stream = streamByOffset.get(normOffset(streamOffset));
    if (!stream) continue;
    for (const target of stream.frameTargets || []) {
      const frameOffset = normOffset(target.romOffset);
      if (!frameOffset) continue;
      offsets.add(frameOffset);
      refs.push({
        streamOffset: normOffset(streamOffset),
        frameOffset,
        pointerOffset: target.pointerOffset,
        sourceCommandOffset: target.sourceCommandOffset,
      });
    }
  }
  return { frameOffsets: [...offsets].sort(), frameReferences: refs };
}

function buildTileBaseRange(mapData, rom, indexes, write) {
  const tileBase = parseHex(write.source?.value);
  if (tileBase == null) return null;
  const streamOffsets = uniqueSorted((write.linkedFamilies || []).flatMap(family => family.streamOffsets || []));
  if (!streamOffsets.length) return null;
  const { frameOffsets, frameReferences } = frameOffsetsForStreams(indexes.streamByOffset, streamOffsets);
  const frameSummaries = [];
  const frameTileBytes = [];
  const finalTileValues = [];
  let lowConfidenceFrames = 0;
  let issueFrames = 0;
  let overflowCount = 0;

  for (const frameOffset of frameOffsets) {
    const frame = indexes.frameByOffset.get(frameOffset);
    const parsed = parseFrameTileBytes(rom, parseHex(frameOffset));
    const finalValues = parsed.tileBytes.map(value => {
      const total = tileBase + value;
      if (total > 0xff) overflowCount++;
      return total & 0xff;
    });
    frameTileBytes.push(...parsed.tileBytes);
    finalTileValues.push(...finalValues);
    if (frame?.confidence !== 'high' || !parsed.termination.normal) lowConfidenceFrames++;
    if ((frame?.issueCount || 0) > 0 || parsed.issueCount > 0) issueFrames++;
    frameSummaries.push({
      frameOffset,
      region: frame?.region || regionRef(findContainingRegion(mapData, parseHex(frameOffset))),
      sourceCommandStreams: uniqueSorted((frame?.references || []).map(ref => ref.sourceCommandStream)).slice(0, 12),
      confidence: frame?.confidence || (parsed.termination.normal ? 'medium' : 'low'),
      pieceRecordCount: parsed.pieceRecordCount,
      frameTileByteRange: summarizeByteValues(parsed.tileBytes),
      finalTileIndexRange: summarizeByteValues(finalValues),
      finalTileSegments: contiguousSegments(finalValues).slice(0, 16),
      termination: parsed.termination,
      issueCount: (frame?.issueCount || 0) + parsed.issueCount,
      issues: [...(frame?.issues || []), ...parsed.issues].slice(0, 8),
    });
  }

  const finalSegments = contiguousSegments(finalTileValues);
  const loaderOverlaps = findLoaderOverlaps(indexes.loaderEntries, finalSegments);
  const confidence = lowConfidenceFrames || issueFrames ? 'low' : 'high';
  return {
    id: `sprite_tile_range_${write.id}`,
    kind: 'tile_base_write_sprite_range',
    sourceWriteId: write.id,
    sourceRole: write.role,
    tileBase: hexByte(tileBase),
    sourceExpression: write.source.expression,
    selectorPair: write.selectorContext?.resolvedPair || null,
    writer: {
      label: write.label,
      line: write.line,
      target: write.target,
      region: write.region,
    },
    linkedFamilies: (write.linkedFamilies || []).map(family => ({
      sourceCatalog: family.sourceCatalog,
      familyId: family.familyId,
      familyKind: family.familyKind,
      selectorPair: family.selectorPair,
      streamOffsets: family.streamOffsets || [],
    })),
    streamOffsets,
    frameOffsets,
    frameReferenceCount: frameReferences.length,
    frameTileByteRange: summarizeByteValues(frameTileBytes),
    finalTileIndexRange: summarizeByteValues(finalTileValues),
    finalTileSegments: finalSegments.slice(0, 24),
    wrapDetected: overflowCount > 0,
    overflowCount,
    frameCount: frameOffsets.length,
    pieceRecordCount: frameTileBytes.length,
    lowConfidenceFrames,
    issueFrames,
    loaderOverlapCount: loaderOverlaps.length,
    candidateLoaderOverlaps: loaderOverlaps.slice(0, 24).map(compactLoaderOverlap),
    frameSamples: frameSummaries.slice(0, 24),
    confidence,
    evidence: [
      `Tile-base writer ${write.id} sets ${write.target} to ${write.source.value}.`,
      '_LABEL_792_ adds IX+63 to each frame-stream tile byte before writing the OAM tile id.',
      'Frame offsets come from normalized animation command stream frame pointers.',
      'Loader overlaps are VRAM destination range matches only unless marked confirmed_preload_call_chain.',
    ],
  };
}

function rootChildEntry(rootCatalog, root, child) {
  const rootIndex = parseHex(root);
  const childIndex = parseHex(child);
  const table = (rootCatalog.childTables || []).find(item => item.rootEntry === rootIndex);
  const entry = table?.entries?.find(item => item.index === childIndex) || null;
  return { table: table || null, entry };
}

function resolveStaticPlayerFormStream(mapData, rom, entry, rootEntry) {
  const tableOffset = parseHex(rootEntry?.entry?.romOffset);
  const tileBase = parseHex(entry.tileBase);
  if (tableOffset == null || tileBase == null) {
    return {
      status: 'unresolved',
      confidence: 'low',
      summary: 'Missing table offset or tile base.',
    };
  }

  const streamPointerOffset = tableOffset;
  const streamZ80Pointer = readWord(rom, streamPointerOffset);
  const streamOffset = isBank6Ptr(streamZ80Pointer) ? bank6Z80ToRom(streamZ80Pointer) : null;
  if (streamOffset == null) {
    return {
      status: 'invalid_stream_pointer',
      confidence: 'low',
      streamPointerOffset: hex(streamPointerOffset),
      streamZ80Pointer: hex(streamZ80Pointer, 4),
      summary: 'Variant entry 0 does not point into bank-6 ROM.',
    };
  }

  const control = rom[streamOffset];
  const framePointerOffset = streamOffset + 1;
  const frameZ80Pointer = readWord(rom, framePointerOffset);
  const frameOffset = isBank6Ptr(frameZ80Pointer) ? bank6Z80ToRom(frameZ80Pointer) : null;
  if (frameOffset == null) {
    return {
      status: 'invalid_frame_pointer',
      confidence: 'low',
      streamOffset: hex(streamOffset),
      control: hex(control, 2),
      framePointerOffset: hex(framePointerOffset),
      frameZ80Pointer: hex(frameZ80Pointer, 4),
      summary: 'Static stream frame pointer does not point into bank-6 ROM.',
    };
  }

  const frame = parseFrameTileBytes(rom, frameOffset);
  const finalTileValues = frame.tileBytes.map(value => (value + tileBase) & 0xff);
  return {
    status: control === 0x00 && frame.termination.normal ? 'resolved_static_frame_stream' : 'nonstandard_static_stream_candidate',
    confidence: control === 0x00 && frame.termination.normal ? 'high' : 'medium',
    variantIndex: 0,
    streamPointerOffset: hex(streamPointerOffset),
    streamZ80Pointer: hex(streamZ80Pointer, 4),
    streamOffset: hex(streamOffset),
    streamRegion: regionRef(findContainingRegion(mapData, streamOffset)),
    command: {
      commandOffset: hex(streamOffset),
      control: hex(control, 2),
      delay: control & 0x7f,
      hasMotionWords: (control & 0x80) !== 0,
      framePointerOffset: hex(framePointerOffset),
      frameZ80Pointer: hex(frameZ80Pointer, 4),
      frameOffset: hex(frameOffset),
      frameRegion: regionRef(findContainingRegion(mapData, frameOffset)),
    },
    frame: {
      frameOffset: hex(frameOffset),
      region: regionRef(findContainingRegion(mapData, frameOffset)),
      pieceRecordCount: frame.pieceRecordCount,
      frameTileByteRange: summarizeByteValues(frame.tileBytes),
      finalTileIndexRange: summarizeByteValues(finalTileValues),
      finalTileSegments: contiguousSegments(finalTileValues).slice(0, 16),
      termination: frame.termination,
      issueCount: frame.issueCount,
      issues: frame.issues,
    },
    runtimeSemantics: {
      startRoutine: '_LABEL_1318_',
      tickRoutine: '_LABEL_1330_',
      staticFrameReason: 'Control byte 0x00 makes _LABEL_1347_ store IX+16=0; _LABEL_1330_ returns immediately while IX+16 is zero, so no loop terminator is required.',
    },
    evidence: [
      '_LABEL_BB13_ calls _LABEL_1318_ with A=0 after initializing _RAM_C3CE_/_RAM_C3CF_.',
      '_LABEL_1318_ applies RST $08 to A after selecting the root/child table, so variant index 0 selects the first word in this five-byte record.',
      '_LABEL_1347_ stores the control byte into IX+16 and the frame pointer into IX+12/IX+13.',
      '_LABEL_1330_ returns without advancing the stream when IX+16 is zero.',
    ],
  };
}

function buildParameterTableRange(mapData, rom, indexes, table) {
  const confirmedLoaderRegionId = 'r0204';
  const tableRange = { start: '0x56', end: '0x8B', count: 54 };
  const confirmedOverlaps = findLoaderOverlaps(indexes.loaderEntries, [tableRange], { confirmedLoaderRegionId })
    .filter(overlap => overlap.loaderRegion?.id === confirmedLoaderRegionId);

  const entries = (table.entries || []).map(entry => {
    const rootEntry = rootChildEntry(indexes.rootCatalog, entry.animationSelector.root, entry.animationSelector.child);
    const baseSegment = { start: entry.tileBase, end: entry.tileBase, count: 1 };
    const streamResolution = resolveStaticPlayerFormStream(mapData, rom, entry, rootEntry);
    return {
      index: entry.index,
      entryOffset: entry.entryOffset,
      selectedBy: entry.selectedBy,
      tileBase: entry.tileBase,
      animationSelector: entry.animationSelector,
      rootTableTarget: rootEntry.entry ? {
        childTable: rootEntry.table ? {
          label: rootEntry.table.label,
          romOffset: rootEntry.table.romOffset,
          rootEntry: rootEntry.table.rootEntry,
        } : null,
        childEntry: {
          index: rootEntry.entry.index,
          entryOffset: rootEntry.entry.entryOffset,
          romOffset: rootEntry.entry.romOffset,
          region: rootEntry.entry.region || null,
          targetInterpretation: rootEntry.entry.targetInterpretation,
          variantEntryCount: rootEntry.entry.variantPrefix?.entryCount || null,
        },
      } : null,
      baseSlotLoaderCoverage: findLoaderOverlaps(indexes.loaderEntries, [baseSegment], { confirmedLoaderRegionId })
        .filter(overlap => overlap.loaderRegion?.id === confirmedLoaderRegionId)
        .map(compactLoaderOverlap),
      streamResolution,
    };
  });
  const resolvedEntries = entries.filter(entry => entry.streamResolution.status === 'resolved_static_frame_stream');
  const uniqueStaticStreams = uniqueSorted(resolvedEntries.map(entry => entry.streamResolution.streamOffset));
  const uniqueFrameOffsets = uniqueSorted(resolvedEntries.map(entry => entry.streamResolution.frame?.frameOffset));
  const aggregateFinalTiles = resolvedEntries.flatMap(entry => {
    const segments = entry.streamResolution.frame?.finalTileSegments || [];
    return segments.flatMap(segment => {
      const start = parseHex(segment.start);
      const end = parseHex(segment.end);
      const values = [];
      for (let value = start; value != null && end != null && value <= end; value++) values.push(value);
      return values;
    });
  });

  return {
    id: `sprite_tile_range_${table.id}`,
    kind: 'parameter_table_sprite_tile_base_range',
    sourceTableId: table.id,
    table: {
      label: table.label,
      offset: table.offset,
      region: table.region,
      indexedBy: table.indexedBy,
      consumerRoutine: table.consumerRoutine,
      consumerWriteId: table.consumerWriteId,
    },
    confirmedPreload: {
      loaderRegionId: confirmedLoaderRegionId,
      loaderRegion: regionRef(findRegionById(mapData, confirmedLoaderRegionId)),
      routine: '_LABEL_BA62_',
      callLine: 20879,
      loaderCall: 'ld hl, _DATA_BF51_; call _LABEL_998_',
      summary: '_LABEL_BA62_ uploads _DATA_BF51_ before the loop that calls _LABEL_BB13_ to initialize _RAM_C3C0_ from _DATA_BFB0_.',
      evidence: [
        'ASM line 20878: ld hl, _DATA_BF51_.',
        'ASM line 20879: call _LABEL_998_.',
        'ASM line 20893: call _LABEL_BB13_.',
        '_DATA_BF51_ tile-source audit covers VRAM slots 0x56-0x8B.',
      ],
    },
    tileBaseRange: {
      min: entries.length ? entries[0].tileBase : null,
      max: entries.length ? entries[entries.length - 1].tileBase : null,
      uniqueCount: new Set(entries.map(entry => entry.tileBase)).size,
    },
    loaderCoverageRange: tableRange,
    confirmedLoaderOverlaps: confirmedOverlaps.map(compactLoaderOverlap),
    entries,
    staticStreamSummary: {
      resolvedStaticStreams: resolvedEntries.length,
      uniqueStaticStreams: uniqueStaticStreams.length,
      uniqueFrameOffsets: uniqueFrameOffsets.length,
      streamOffsets: uniqueStaticStreams,
      frameOffsets: uniqueFrameOffsets,
      aggregateFinalTileSegments: contiguousSegments(aggregateFinalTiles).slice(0, 32),
    },
    confidence: confirmedOverlaps.length ? 'high' : 'medium',
    evidence: [
      '_DATA_BFB0_ supplies tile-base values to _RAM_C3FF_ and root-2 animation child selectors to _RAM_C3CF_.',
      '_LABEL_BA62_ uploads _DATA_BF51_ with _LABEL_998_ before _LABEL_BB13_ initializes the actor slot.',
      'The root-2 child targets are resolved through _DATA_19037_, but their command streams still need a dedicated parser pass.',
    ],
  };
}

function buildCatalog(rom, mapData) {
  const indexes = indexCatalogs(mapData);
  const tileBaseRanges = (indexes.tileBaseCatalog.writes || [])
    .map(write => buildTileBaseRange(mapData, rom, indexes, write))
    .filter(Boolean);
  const parameterTableRanges = (indexes.tileBaseCatalog.parameterTables || [])
    .map(table => buildParameterTableRange(mapData, rom, indexes, table));

  const allLoaderOverlaps = tileBaseRanges.flatMap(range => range.candidateLoaderOverlaps || []);
  const confirmedParameterOverlaps = parameterTableRanges.flatMap(range => range.confirmedLoaderOverlaps || []);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      indexes.tileBaseCatalog.id,
      indexes.commandCatalog.id,
      indexes.frameCatalog.id,
      indexes.tileSourceCatalog.id,
      indexes.rootCatalog.id,
    ],
    assetPolicy: 'Metadata only: tile-base values, aggregate tile index ranges, stream/frame offsets, loader range overlaps, region ids, and evidence. No ROM bytes, frame byte streams, decoded graphics, audio, or text payloads are embedded.',
    semantics: {
      tileIndexComputation: '_LABEL_792_ computes OAM tile id as frame_stream_tile_byte + IX+63, modulo 0x100.',
      frameRecordShape: 'Non-terminator frame records are 3 bytes; only aggregate tile-byte ranges are stored by this audit.',
      loaderOverlapMeaning: 'VRAM loader overlaps are candidate evidence unless the catalog marks a preload call chain as confirmed.',
    },
    tileBaseRanges,
    parameterTableRanges,
    summary: {
      tileBaseRangeCount: tileBaseRanges.length,
      parameterTableRangeCount: parameterTableRanges.length,
      highConfidenceTileBaseRanges: tileBaseRanges.filter(range => range.confidence === 'high').length,
      lowConfidenceTileBaseRanges: tileBaseRanges.filter(range => range.confidence === 'low').length,
      frameStreamsCovered: new Set(tileBaseRanges.flatMap(range => range.frameOffsets)).size,
      pieceRecordsAggregated: tileBaseRanges.reduce((sum, range) => sum + range.pieceRecordCount, 0),
      rangesWithWrap: tileBaseRanges.filter(range => range.wrapDetected).length,
      candidateLoaderOverlapCount: allLoaderOverlaps.length,
      confirmedLoaderOverlapCount: confirmedParameterOverlaps.length,
      parameterTableEntries: parameterTableRanges.reduce((sum, range) => sum + range.entries.length, 0),
      parameterTablesWithConfirmedPreload: parameterTableRanges.filter(range => range.confirmedLoaderOverlaps.length > 0).length,
      staticPlayerFormStreamsResolved: parameterTableRanges.reduce((sum, range) => sum + (range.staticStreamSummary?.resolvedStaticStreams || 0), 0),
      staticPlayerFormUniqueFrameOffsets: new Set(parameterTableRanges.flatMap(range => range.staticStreamSummary?.frameOffsets || [])).size,
      retaggedRegions: 1,
      assetPolicy: 'Metadata only: no ROM bytes, frame byte streams, decoded graphics, audio, or text payloads are embedded.',
    },
  };
}

function compactTileBaseRange(range) {
  return {
    catalogId,
    id: range.id,
    sourceWriteId: range.sourceWriteId,
    tileBase: range.tileBase,
    selectorPair: range.selectorPair,
    streamOffsets: range.streamOffsets,
    frameCount: range.frameCount,
    pieceRecordCount: range.pieceRecordCount,
    frameTileByteRange: range.frameTileByteRange,
    finalTileIndexRange: range.finalTileIndexRange,
    finalTileSegments: range.finalTileSegments,
    wrapDetected: range.wrapDetected,
    candidateLoaderOverlapCount: range.loaderOverlapCount,
    confidence: range.confidence,
  };
}

function compactParameterRange(range) {
  return {
    catalogId,
    id: range.id,
    sourceTableId: range.sourceTableId,
    table: range.table,
    confirmedPreload: range.confirmedPreload,
    tileBaseRange: range.tileBaseRange,
    loaderCoverageRange: range.loaderCoverageRange,
    entryCount: range.entries.length,
    confirmedLoaderOverlapCount: range.confirmedLoaderOverlaps.length,
    staticStreamSummary: range.staticStreamSummary,
    confidence: range.confidence,
  };
}

function annotateMap(mapData, catalog) {
  const refsByRegion = new Map();
  const missingRegions = [];

  function addRef(regionLike, fallbackOffset, key, ref) {
    let region = regionLike?.id ? findRegionById(mapData, regionLike.id) : null;
    if (!region && fallbackOffset) region = findContainingRegion(mapData, parseHex(fallbackOffset));
    if (!region) {
      missingRegions.push({ key, fallbackOffset, refId: ref.id || null });
      return;
    }
    if (!refsByRegion.has(region.id)) refsByRegion.set(region.id, { region, refs: { tileBaseRanges: [], parameterRanges: [], loaderRanges: [], staticStreamRanges: [], frameRanges: [] } });
    refsByRegion.get(region.id).refs[key].push(ref);
  }

  for (const range of catalog.tileBaseRanges) {
    addRef(range.writer.region, range.writer.region?.offset, 'tileBaseRanges', compactTileBaseRange(range));
  }

  for (const range of catalog.parameterTableRanges) {
    addRef(range.table.region, range.table.offset, 'parameterRanges', compactParameterRange(range));
    addRef(range.confirmedPreload.loaderRegion, range.confirmedPreload.loaderRegion?.offset, 'loaderRanges', compactParameterRange(range));
    for (const entry of range.entries || []) {
      const streamResolution = entry.streamResolution || {};
      if (streamResolution.status !== 'resolved_static_frame_stream') continue;
      const staticRef = {
        catalogId,
        sourceRangeId: range.id,
        tableEntryIndex: entry.index,
        tileBase: entry.tileBase,
        animationSelector: entry.animationSelector,
        streamOffset: streamResolution.streamOffset,
        frameOffset: streamResolution.frame?.frameOffset,
        frameTileByteRange: streamResolution.frame?.frameTileByteRange,
        finalTileIndexRange: streamResolution.frame?.finalTileIndexRange,
        finalTileSegments: streamResolution.frame?.finalTileSegments,
        confidence: streamResolution.confidence,
      };
      addRef(streamResolution.streamRegion, streamResolution.streamOffset, 'staticStreamRanges', staticRef);
      addRef(streamResolution.frame?.region, streamResolution.frame?.frameOffset, 'frameRanges', staticRef);
    }
  }

  const annotatedRegions = [];
  for (const { region, refs } of refsByRegion.values()) {
    region.analysis = region.analysis || {};
    const existing = region.analysis.animationSpriteTileRangeAudit || {};
    const existingTileBaseRanges = (existing.tileBaseRanges || []).filter(ref => ref.catalogId !== catalogId);
    const existingParameterRanges = (existing.parameterRanges || []).filter(ref => ref.catalogId !== catalogId);
    const existingLoaderRanges = (existing.loaderRanges || []).filter(ref => ref.catalogId !== catalogId);
    const existingStaticStreamRanges = (existing.staticStreamRanges || []).filter(ref => ref.catalogId !== catalogId);
    const existingFrameRanges = (existing.frameRanges || []).filter(ref => ref.catalogId !== catalogId);
    const wasBfb0 = region.id === 'r0208';
    const typeBeforeAudit = region.type || 'unknown';
    if (wasBfb0 && region.type !== 'data_table') region.type = 'data_table';
    region.analysis.animationSpriteTileRangeAudit = {
      kind: wasBfb0
        ? 'sprite_tile_base_parameter_table_region'
        : refs.loaderRanges.length
          ? 'sprite_tile_loader_region'
          : refs.staticStreamRanges.length
            ? 'sprite_static_command_stream_region'
            : refs.frameRanges.length
              ? 'sprite_static_frame_target_region'
              : 'sprite_tile_base_writer_region',
      catalogId,
      confidence: [...refs.tileBaseRanges, ...refs.parameterRanges, ...refs.loaderRanges, ...refs.staticStreamRanges, ...refs.frameRanges].some(ref => ref.confidence === 'low') ? 'low' : 'high',
      summary: wasBfb0
        ? '_DATA_BFB0_ is a two-byte parameter table: low byte is tile base, high byte is root-2 animation child selector.'
        : refs.loaderRanges.length
          ? 'VRAM loader region is confirmed as preload coverage for a sprite tile-base parameter table.'
          : refs.staticStreamRanges.length
            ? 'Region contains a variant-index-0 static command stream selected by _DATA_BFB0_ player/form animation entries.'
            : refs.frameRanges.length
              ? 'Region contains frame streams reached by _DATA_BFB0_ player/form static command streams.'
          : 'Code region writes a tile-base value whose linked animation frames now have aggregate OAM tile ranges.',
      typeBeforeAudit: wasBfb0 ? typeBeforeAudit : undefined,
      typeAfterAudit: wasBfb0 ? region.type : undefined,
      changedType: wasBfb0 ? typeBeforeAudit !== region.type : false,
      tileBaseRanges: [...existingTileBaseRanges, ...refs.tileBaseRanges].slice(0, 48),
      parameterRanges: [...existingParameterRanges, ...refs.parameterRanges].slice(0, 16),
      loaderRanges: [...existingLoaderRanges, ...refs.loaderRanges].slice(0, 16),
      staticStreamRanges: [...existingStaticStreamRanges, ...refs.staticStreamRanges].slice(0, 32),
      frameRanges: [...existingFrameRanges, ...refs.frameRanges].slice(0, 32),
      evidence: [
        '_LABEL_792_ computes OAM tile id by adding IX+63 to each frame-stream tile byte.',
        'Tile ranges are aggregate metadata only; frame byte streams and decoded graphics are not embedded.',
        '_DATA_BFB0_ retagging is supported by _LABEL_BB13_ copying selected E to _RAM_C3FF_ and selected D to _RAM_C3CF_.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      tileBaseRangeRefs: refs.tileBaseRanges.length,
      parameterRangeRefs: refs.parameterRanges.length,
      loaderRangeRefs: refs.loaderRanges.length,
      staticStreamRangeRefs: refs.staticStreamRanges.length,
      frameRangeRefs: refs.frameRanges.length,
      changedType: wasBfb0 ? typeBeforeAudit !== region.type : false,
    });
  }
  return { annotatedRegions, missingRegions };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  let annotation = { annotatedRegions: [], missingRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    const finalCatalog = buildCatalog(rom, mapData);
    mapData.animationSpriteTileRangeCatalogs = (mapData.animationSpriteTileRangeCatalogs || []).filter(item => item.id !== catalogId);
    mapData.animationSpriteTileRangeCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'animation_sprite_tile_range_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: finalCatalog.sourceCatalogs,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotation.annotatedRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      semantics: finalCatalog.semantics,
      tileBaseRangeSamples: finalCatalog.tileBaseRanges.slice(0, 32),
      parameterTableRanges: finalCatalog.parameterTableRanges,
      annotatedRegions: annotation.annotatedRegions,
      missingRegions: annotation.missingRegions,
      nextLeads: [
        'Normalize root-2 player/form selector targets 0x46-0x4A into command streams so _DATA_BFB0_ entries get exact frame tile ranges.',
        'Trace bank-2 root-4 scene routines back to their active loader recipes before promoting overlap-only loader matches to confirmed coverage.',
        'Use final tile index ranges with synthetic VRAM provenance to surface unresolved sprite tile slots in the browser preview.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: annotation.annotatedRegions.length,
    missingRegions: annotation.missingRegions.length,
  }, null, 2));
}

main();
