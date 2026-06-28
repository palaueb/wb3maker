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
const toolName = 'tools/world-player-a48-gap-candidate-audit.mjs';
const catalogId = 'world-player-a48-gap-candidate-catalog-2026-06-26';
const reportId = 'player-a48-gap-candidate-audit-2026-06-26';

const playerA48TileStreamCatalogId = 'world-player-a48-tile-stream-catalog-2026-06-26';
const MAX_GAP_BYTES = 64;
const MAX_A48_RECORDS = 128;
const BANK6_START = 0x18000;
const BANK6_END_EXCLUSIVE = 0x1C000;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function hexByte(value) {
  return hex(value & 0xFF, 2);
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 16);
  return NaN;
}

function readWordLE(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function bankedZ80ToRom(bank, z80Address) {
  if (z80Address < 0x8000 || z80Address > 0xBFFF) return null;
  return bank * 0x4000 + (z80Address - 0x8000);
}

function offsetOf(region) {
  return parseOffset(region.offset);
}

function endOf(region) {
  return offsetOf(region) + Number(region.size || 0);
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= offsetOf(region) && offset < endOf(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => value != null && value !== ''))].sort((a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
  });
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.endExclusive) && item.endExclusive > item.start)
    .sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.endExclusive) {
      merged.push({ start: interval.start, endExclusive: interval.endExclusive });
    } else if (interval.endExclusive > last.endExclusive) {
      last.endExclusive = interval.endExclusive;
    }
  }
  return merged;
}

function overlapRange(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(aStart, bStart);
  const endExclusive = Math.min(aEnd, bEnd);
  return start < endExclusive ? { start, endExclusive } : null;
}

function intervalBytes(intervals) {
  return mergeIntervals(intervals).reduce((sum, item) => sum + item.endExclusive - item.start, 0);
}

function sourceWordToSpan(mapData, sourceWord, tileBlocks) {
  const sourceBank = sourceWord >>> 9;
  const sourceTileIndex = sourceWord & 0x01FF;
  const sourceZ80Address = 0x8000 + sourceTileIndex * 32;
  const sourceRomOffset = bankedZ80ToRom(sourceBank, sourceZ80Address);
  const byteCount = tileBlocks * 32;
  const sourceEndExclusive = sourceRomOffset == null ? null : sourceRomOffset + byteCount;
  const sourceRegion = sourceRomOffset == null ? null : findContainingRegion(mapData, sourceRomOffset);
  return {
    sourceBank,
    sourceTileIndex,
    sourceZ80Address,
    sourceRomOffset,
    sourceEndExclusive,
    byteCount,
    sourceRegion,
  };
}

function issue(kind, severity, detail = {}) {
  return { kind, severity, ...detail };
}

function streamInterval(stream) {
  const start = parseOffset(stream.streamOffset);
  const endInclusive = parseOffset(stream.endInclusive);
  return {
    stream,
    regionId: stream.streamRegion?.id || '',
    start,
    endExclusive: endInclusive + 1,
  };
}

function compactNeighbor(stream) {
  return {
    streamOffset: stream.streamOffset,
    endInclusive: stream.endInclusive,
    confidence: stream.confidence,
    referencedByCount: stream.referencedByCount,
    hasHighConfidenceCommandReference: Boolean(stream.hasHighConfidenceCommandReference),
  };
}

function recordVramRange(startSlot, count) {
  return {
    start: hex(startSlot, 3),
    endInclusive: hex(startSlot + count - 1, 3),
    count,
  };
}

function parseA48CandidateStream(rom, mapData, startOffset, gapEndExclusive) {
  const records = [];
  const sourceSpans = [];
  const issues = [];
  let cursor = startOffset;
  let terminated = false;
  let sourceRecordCount = 0;
  let invalidSourceRecordCount = 0;
  let zeroFillTileBlocks = 0;
  let totalTileBlocks = 0;
  let vramSlotIfC27fZero = 0;
  let vramSlotIfC27fNonzero = 16;

  for (let recordIndex = 0; recordIndex < MAX_A48_RECORDS && cursor < gapEndExclusive; recordIndex++) {
    if (cursor < BANK6_START || cursor >= BANK6_END_EXCLUSIVE || cursor >= rom.length) {
      issues.push(issue('left_bank6_range', 'high', { atOffset: hex(cursor) }));
      break;
    }

    const recordOffset = cursor;
    const opcode = rom[cursor++];
    if (opcode === 0x00) {
      records.push({
        index: records.length,
        recordOffset: hex(recordOffset),
        kind: 'terminator',
      });
      terminated = true;
      break;
    }

    if (opcode === 0xFF) {
      records.push({
        index: records.length,
        recordOffset: hex(recordOffset),
        kind: 'zero_fill_tile_block',
        opcode: '0xFF',
        tileBlocks: 1,
        vramTileRangeIfC27fZero: recordVramRange(vramSlotIfC27fZero, 1),
        vramTileRangeIfC27fNonzero: recordVramRange(vramSlotIfC27fNonzero, 1),
      });
      zeroFillTileBlocks++;
      totalTileBlocks++;
      vramSlotIfC27fZero++;
      vramSlotIfC27fNonzero++;
      continue;
    }

    if (cursor + 1 >= gapEndExclusive || cursor + 1 >= rom.length || cursor + 1 >= BANK6_END_EXCLUSIVE) {
      issues.push(issue('truncated_source_word', 'high', {
        recordOffset: hex(recordOffset),
        sourceWordOffset: hex(cursor),
        gapEndExclusive: hex(gapEndExclusive),
      }));
      break;
    }

    const sourceWordOffset = cursor;
    const sourceWord = readWordLE(rom, cursor);
    cursor += 2;
    const tileBlocks = opcode;
    const span = sourceWordToSpan(mapData, sourceWord, tileBlocks);
    const sourceInRom = (
      span.sourceRomOffset != null &&
      span.sourceRomOffset >= 0 &&
      span.sourceEndExclusive != null &&
      span.sourceEndExclusive <= rom.length
    );

    records.push({
      index: records.length,
      recordOffset: hex(recordOffset),
      kind: 'source_tile_copy',
      opcode: hexByte(opcode),
      tileBlocks,
      sourceWordOffset: hex(sourceWordOffset),
      sourceWord: hex(sourceWord, 4),
      sourceBank: span.sourceBank,
      sourceTileIndex: span.sourceTileIndex,
      sourceRomOffset: span.sourceRomOffset == null ? null : hex(span.sourceRomOffset),
      sourceRegionId: span.sourceRegion?.id || null,
      sourceInRom,
      vramTileRangeIfC27fZero: recordVramRange(vramSlotIfC27fZero, tileBlocks),
      vramTileRangeIfC27fNonzero: recordVramRange(vramSlotIfC27fNonzero, tileBlocks),
    });

    if (sourceInRom) {
      sourceSpans.push({
        sourceWordOffset: hex(sourceWordOffset),
        sourceWord: hex(sourceWord, 4),
        sourceBank: span.sourceBank,
        sourceTileIndex: span.sourceTileIndex,
        sourceZ80Address: hex(span.sourceZ80Address, 4),
        sourceRomOffset: hex(span.sourceRomOffset),
        sourceEndExclusive: hex(span.sourceEndExclusive),
        byteCount: span.byteCount,
        tileBlocks,
        sourceRegion: regionRef(span.sourceRegion),
        sourceInRom,
      });
    } else {
      invalidSourceRecordCount++;
      issues.push(issue('invalid_source_range', 'high', {
        recordOffset: hex(recordOffset),
        sourceWordOffset: hex(sourceWordOffset),
        sourceWord: hex(sourceWord, 4),
        sourceBank: span.sourceBank,
        sourceRomOffset: span.sourceRomOffset == null ? null : hex(span.sourceRomOffset),
        sourceEndExclusive: span.sourceEndExclusive == null ? null : hex(span.sourceEndExclusive),
        byteCount: span.byteCount,
      }));
    }

    sourceRecordCount++;
    totalTileBlocks += tileBlocks;
    vramSlotIfC27fZero += tileBlocks;
    vramSlotIfC27fNonzero += tileBlocks;
  }

  if (!terminated && records.length >= MAX_A48_RECORDS) {
    issues.push(issue('record_limit_reached', 'high', { recordLimit: MAX_A48_RECORDS }));
  }
  if (!terminated && cursor >= gapEndExclusive) {
    issues.push(issue('unterminated_before_gap_end', 'medium', { gapEndExclusive: hex(gapEndExclusive) }));
  }

  const validCandidate = terminated && issues.length === 0 && sourceRecordCount > 0 && cursor <= gapEndExclusive;
  const sourceBanks = uniqueSorted(sourceSpans.map(span => span.sourceBank));
  const sourceRegionIds = uniqueSorted(sourceSpans.map(span => span.sourceRegion?.id));
  const sourceIntervals = sourceSpans
    .map(span => ({ start: parseOffset(span.sourceRomOffset), endExclusive: parseOffset(span.sourceEndExclusive) }))
    .filter(span => Number.isFinite(span.start) && Number.isFinite(span.endExclusive));

  return {
    streamOffset: hex(startOffset),
    streamRegion: regionRef(findContainingRegion(mapData, startOffset)),
    consumedBytes: cursor - startOffset,
    endInclusive: cursor > startOffset ? hex(cursor - 1) : hex(startOffset),
    endExclusive: hex(cursor),
    terminated,
    recordCount: records.length,
    sourceRecordCount,
    invalidSourceRecordCount,
    zeroFillTileBlocks,
    totalTileBlocks,
    sourceBanks,
    sourceRegionIds,
    uniqueSourceBytes: intervalBytes(sourceIntervals),
    finalVramTileIfC27fZeroExclusive: hex(vramSlotIfC27fZero, 3),
    finalVramTileIfC27fNonzeroExclusive: hex(vramSlotIfC27fNonzero, 3),
    issueCount: issues.length,
    issueCounts: countBy(issues, item => item.kind),
    issues,
    sourceSpans,
    recordPreview: records.slice(0, 12),
    validCandidate,
  };
}

function parseGapPartition(rom, mapData, gap) {
  const candidates = [];
  const unparsedRanges = [];
  let cursor = gap.start;
  let unparsedStart = null;

  function flushUnparsed(at) {
    if (unparsedStart == null) return;
    unparsedRanges.push({
      start: hex(unparsedStart),
      endExclusive: hex(at),
      sizeBytes: at - unparsedStart,
    });
    unparsedStart = null;
  }

  while (cursor < gap.endExclusive) {
    const parsed = parseA48CandidateStream(rom, mapData, cursor, gap.endExclusive);
    if (parsed.validCandidate) {
      flushUnparsed(cursor);
      candidates.push(parsed);
      cursor = parseOffset(parsed.endExclusive);
    } else {
      if (unparsedStart == null) unparsedStart = cursor;
      cursor++;
    }
  }
  flushUnparsed(cursor);

  const coveredBytes = candidates.reduce((sum, candidate) => sum + Number(candidate.consumedBytes || 0), 0);
  return {
    candidates,
    unparsedRanges,
    coveredBytes,
    fullyCovered: candidates.length > 0 && coveredBytes === gap.sizeBytes && unparsedRanges.length === 0,
  };
}

function discoverSmallGaps(playerA48Catalog) {
  const byRegion = new Map();
  for (const stream of playerA48Catalog.a48TileStreams || []) {
    if (!stream.terminated || !stream.streamRegion?.id) continue;
    const interval = streamInterval(stream);
    if (!Number.isFinite(interval.start) || !Number.isFinite(interval.endExclusive) || interval.endExclusive <= interval.start) continue;
    if (!byRegion.has(interval.regionId)) byRegion.set(interval.regionId, []);
    byRegion.get(interval.regionId).push(interval);
  }

  const gaps = [];
  for (const [regionId, intervals] of byRegion.entries()) {
    intervals.sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
    for (let index = 1; index < intervals.length; index++) {
      const previous = intervals[index - 1];
      const next = intervals[index];
      if (next.start <= previous.endExclusive) continue;
      const sizeBytes = next.start - previous.endExclusive;
      if (sizeBytes > MAX_GAP_BYTES) continue;
      gaps.push({
        id: `a48_gap_${hex(previous.endExclusive).replace(/^0x/i, '')}_${hex(next.start).replace(/^0x/i, '')}`,
        regionId,
        sourceRegion: previous.stream.streamRegion,
        start: previous.endExclusive,
        endExclusive: next.start,
        sizeBytes,
        previousStream: previous.stream,
        nextStream: next.stream,
      });
    }
  }
  return gaps.sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
}

function buildSourceRegionSummaries(mapData, candidateStreams) {
  const sourceIntervals = candidateStreams.flatMap(stream => stream.sourceSpans || [])
    .map(span => ({ start: parseOffset(span.sourceRomOffset), endExclusive: parseOffset(span.sourceEndExclusive) }))
    .filter(span => Number.isFinite(span.start) && Number.isFinite(span.endExclusive));
  const byRegion = new Map();
  for (const interval of sourceIntervals) {
    for (const region of mapData.regions || []) {
      if ((region.type || '') !== 'gfx_tiles') continue;
      const overlap = overlapRange(interval.start, interval.endExclusive, offsetOf(region), endOf(region));
      if (!overlap) continue;
      if (!byRegion.has(region.id)) byRegion.set(region.id, { region, overlaps: [] });
      byRegion.get(region.id).overlaps.push(overlap);
    }
  }

  return [...byRegion.values()]
    .map(entry => {
      const merged = mergeIntervals(entry.overlaps);
      return {
        region: regionRef(entry.region),
        uniqueBytes: intervalBytes(merged),
        tileBlocks: Math.ceil(intervalBytes(merged) / 32),
        spanCount: merged.length,
        spans: merged.slice(0, 24).map(span => ({
          start: hex(span.start),
          endExclusive: hex(span.endExclusive),
          sizeBytes: span.endExclusive - span.start,
        })),
      };
    })
    .sort((a, b) => parseOffset(a.region.offset) - parseOffset(b.region.offset));
}

function compactCandidateStream(candidate, gap, index) {
  return {
    id: `a48_gap_candidate_${hex(parseOffset(candidate.streamOffset)).replace(/^0x/i, '')}`,
    kind: 'unreferenced_a48_gap_candidate',
    gapId: gap.id,
    gapRange: {
      startOffset: hex(gap.start),
      endExclusive: hex(gap.endExclusive),
      sizeBytes: gap.sizeBytes,
    },
    streamOffset: candidate.streamOffset,
    streamRegion: candidate.streamRegion,
    referencedByCount: 0,
    hasKnownPointerReference: false,
    confidence: 'medium',
    consumedBytes: candidate.consumedBytes,
    endInclusive: candidate.endInclusive,
    endExclusive: candidate.endExclusive,
    terminated: candidate.terminated,
    recordCount: candidate.recordCount,
    sourceRecordCount: candidate.sourceRecordCount,
    invalidSourceRecordCount: candidate.invalidSourceRecordCount,
    zeroFillTileBlocks: candidate.zeroFillTileBlocks,
    totalTileBlocks: candidate.totalTileBlocks,
    sourceBanks: candidate.sourceBanks,
    sourceRegionIds: candidate.sourceRegionIds,
    uniqueSourceBytes: candidate.uniqueSourceBytes,
    finalVramTileIfC27fZeroExclusive: candidate.finalVramTileIfC27fZeroExclusive,
    finalVramTileIfC27fNonzeroExclusive: candidate.finalVramTileIfC27fNonzeroExclusive,
    issueCount: candidate.issueCount,
    issueCounts: candidate.issueCounts,
    gapPartitionIndex: index,
    boundedBy: {
      previousStream: compactNeighbor(gap.previousStream),
      nextStream: compactNeighbor(gap.nextStream),
      bothNeighborsHaveHighConfidenceCommandReferences: Boolean(gap.previousStream.hasHighConfidenceCommandReference && gap.nextStream.hasHighConfidenceCommandReference),
    },
    recordPreview: candidate.recordPreview,
    sourceSpanPreview: candidate.sourceSpans.slice(0, 24),
    evidence: [
      `Candidate bytes are a valid, terminated _LABEL_A48_ record stream inside ${gap.id}.`,
      `The containing gap is bounded by existing ${playerA48TileStreamCatalogId} streams at ${gap.previousStream.streamOffset} and ${gap.nextStream.streamOffset}.`,
      'No current player command pointer reference has been found for this candidate start; treat as candidate metadata, not confirmed runtime coverage.',
    ],
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
  };
}

function buildCatalog(rom, mapData) {
  const playerA48Catalog = findCatalog(mapData, playerA48TileStreamCatalogId);
  if (!playerA48Catalog) throw new Error(`Missing required catalog ${playerA48TileStreamCatalogId}`);

  const gaps = discoverSmallGaps(playerA48Catalog);
  const acceptedGaps = [];
  const rejectedGaps = [];
  const candidateStreams = [];

  for (const gap of gaps) {
    const partition = parseGapPartition(rom, mapData, gap);
    const boundedByHighConfidenceRefs = Boolean(gap.previousStream.hasHighConfidenceCommandReference && gap.nextStream.hasHighConfidenceCommandReference);
    const accepted = partition.fullyCovered && boundedByHighConfidenceRefs;
    const gapEntry = {
      id: gap.id,
      kind: accepted ? 'fully_partitioned_a48_gap_candidate' : 'rejected_or_partial_a48_gap_candidate',
      sourceRegion: gap.sourceRegion,
      startOffset: hex(gap.start),
      endExclusive: hex(gap.endExclusive),
      sizeBytes: gap.sizeBytes,
      previousStream: compactNeighbor(gap.previousStream),
      nextStream: compactNeighbor(gap.nextStream),
      boundedByHighConfidenceRefs,
      candidateStreamCount: partition.candidates.length,
      coveredBytes: partition.coveredBytes,
      unparsedRanges: partition.unparsedRanges,
      accepted,
      confidence: accepted ? 'medium' : 'low',
      reason: accepted
        ? 'Small gap is fully covered by a contiguous partition of valid, terminated _LABEL_A48_-shaped streams and both neighboring streams have high-confidence command references.'
        : 'Gap either is not fully covered by valid candidate streams or is not bounded by high-confidence command-referenced streams.',
    };

    if (accepted) {
      const streams = partition.candidates.map((candidate, index) => compactCandidateStream(candidate, gap, index));
      gapEntry.candidateStreamIds = streams.map(stream => stream.id);
      acceptedGaps.push(gapEntry);
      candidateStreams.push(...streams);
    } else if (partition.candidates.length) {
      rejectedGaps.push(gapEntry);
    }
  }

  const sourceGraphicsRegions = buildSourceRegionSummaries(mapData, candidateStreams.flatMap(stream => ({
    sourceSpans: stream.sourceSpanPreview,
  })));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [playerA48TileStreamCatalogId],
    assetPolicy: 'Metadata only: candidate stream offsets, parser record counts, source-word metadata, source ranges, region ids, and gap summaries. No ROM bytes, decoded graphics, screenshots, hashes, pixels, audio, or text payloads are embedded.',
    semantics: {
      parser: '_LABEL_A48_ animation tile stream uploader',
      recordShape: '_LABEL_A48_ terminates on 0x00, writes one zero-filled tile for 0xFF, otherwise treats the byte as a tile-block count followed by a source word whose high bits select the source bank and whose low 9 bits select the source tile.',
      candidateRule: 'Only small gaps between existing terminated A48 streams are considered. A gap is accepted only when it is fully partitioned by valid, terminated A48-shaped candidate streams and both neighboring streams have high-confidence player command references.',
      confidenceBoundary: 'Accepted entries are still candidates because no current player command pointer references their start offsets.',
    },
    acceptedGaps,
    rejectedGapSamples: rejectedGaps.slice(0, 16),
    a48GapCandidateStreams: candidateStreams,
    sourceGraphicsRegions,
    summary: {
      scannedSmallGapCount: gaps.length,
      acceptedGapCount: acceptedGaps.length,
      rejectedGapWithCandidateShapeCount: rejectedGaps.length,
      candidateStreamCount: candidateStreams.length,
      candidateByteCount: candidateStreams.reduce((sum, stream) => sum + Number(stream.consumedBytes || 0), 0),
      sourceRecordCount: candidateStreams.reduce((sum, stream) => sum + Number(stream.sourceRecordCount || 0), 0),
      zeroFillTileBlocks: candidateStreams.reduce((sum, stream) => sum + Number(stream.zeroFillTileBlocks || 0), 0),
      totalTileBlocks: candidateStreams.reduce((sum, stream) => sum + Number(stream.totalTileBlocks || 0), 0),
      sourceBanks: uniqueSorted(candidateStreams.flatMap(stream => stream.sourceBanks || [])),
      sourceRegionIds: uniqueSorted(candidateStreams.flatMap(stream => stream.sourceRegionIds || [])),
      sourceGraphicsRegionCount: sourceGraphicsRegions.length,
      sourceGraphicsRegionIds: sourceGraphicsRegions.map(entry => entry.region.id),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: no ROM bytes, decoded graphics, screenshots, hashes, pixels, audio, or text payloads are embedded.',
    },
    evidence: [
      `${playerA48TileStreamCatalogId} supplies existing _LABEL_A48_ stream boundaries and command-reference confidence.`,
      'ASM lines 2391-2452 document _LABEL_A48_ record semantics used by this parser: 0x00 terminator, 0xFF zero-fill record, and count/source-word tile-copy records.',
      'Accepted candidates are bounded by high-confidence command-referenced A48 streams but have no direct command pointer reference themselves.',
      'No ROM bytes, hashes, decoded graphics, pixels, screenshots, rendered tiles, audio, or text payloads are stored.',
    ],
    nextLeads: [
      'Trace additional player command variant selectors near the accepted gap to determine whether hidden form/state branches point at these candidate streams.',
      'Use the candidate intervals only as parser-context evidence until a pointer or control-flow reference is found.',
      'If future traces confirm a candidate start offset, promote the stream into the main player A48 tile stream catalog and update source coverage.',
    ],
  };
}

function appendNote(region, note) {
  if (!note) return;
  const current = region.notes || '';
  if (current.includes(note)) return;
  region.notes = current ? `${current} ${note}` : note;
}

function annotateMap(mapData, catalog) {
  for (const region of mapData.regions || []) {
    if (region.analysis?.playerA48GapCandidateAudit?.catalogId === catalogId) {
      delete region.analysis.playerA48GapCandidateAudit;
    }
  }

  const byRegion = new Map();
  for (const gap of catalog.acceptedGaps || []) {
    const regionId = gap.sourceRegion?.id;
    if (!regionId) continue;
    if (!byRegion.has(regionId)) byRegion.set(regionId, { gaps: [], streams: [] });
    byRegion.get(regionId).gaps.push(gap);
  }
  for (const stream of catalog.a48GapCandidateStreams || []) {
    const regionId = stream.streamRegion?.id;
    if (!regionId) continue;
    if (!byRegion.has(regionId)) byRegion.set(regionId, { gaps: [], streams: [] });
    byRegion.get(regionId).streams.push({
      id: stream.id,
      streamOffset: stream.streamOffset,
      endInclusive: stream.endInclusive,
      consumedBytes: stream.consumedBytes,
      sourceRecordCount: stream.sourceRecordCount,
      zeroFillTileBlocks: stream.zeroFillTileBlocks,
      totalTileBlocks: stream.totalTileBlocks,
      sourceBanks: stream.sourceBanks,
      sourceRegionIds: stream.sourceRegionIds,
      confidence: stream.confidence,
      hasKnownPointerReference: stream.hasKnownPointerReference,
    });
  }

  const annotatedRegions = [];
  for (const [regionId, entry] of byRegion.entries()) {
    const region = findRegionById(mapData, regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.playerA48GapCandidateAudit = {
      kind: 'unreferenced_player_a48_gap_candidate_region',
      catalogId,
      confidence: 'medium',
      summary: 'Region contains a small gap between confirmed _LABEL_A48_ streams that is fully partitioned by valid, terminated but currently unreferenced A48-shaped candidate streams.',
      acceptedGapCount: entry.gaps.length,
      candidateStreamCount: entry.streams.length,
      acceptedGaps: entry.gaps.map(gap => ({
        id: gap.id,
        startOffset: gap.startOffset,
        endExclusive: gap.endExclusive,
        sizeBytes: gap.sizeBytes,
        previousStream: gap.previousStream,
        nextStream: gap.nextStream,
        candidateStreamIds: gap.candidateStreamIds,
      })),
      candidateStreams: entry.streams.slice(0, 32),
      evidence: [
        `${catalogId} parsed the gap using documented _LABEL_A48_ record semantics.`,
        `Neighboring stream references come from ${playerA48TileStreamCatalogId}.`,
        'No direct player command pointer reference currently targets these candidate starts.',
        'No ROM bytes, decoded graphics, screenshots, hashes, pixels, audio, or text payloads are embedded.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    appendNote(region, 'Contains unreferenced but shape-valid _LABEL_A48_ gap candidate tile streams bounded by confirmed player/form A48 streams.');
    annotatedRegions.push({
      region: regionRef(region),
      acceptedGapCount: entry.gaps.length,
      candidateStreamCount: entry.streams.length,
    });
  }

  return { annotatedRegions };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotations = apply ? annotateMap(mapData, catalog) : { annotatedRegions: [] };

  if (apply) {
    mapData.tileSourceCatalogs = (mapData.tileSourceCatalogs || []).filter(item => item.id !== catalogId);
    mapData.tileSourceCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_a48_gap_candidate_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotations.annotatedRegions.length,
      },
      acceptedGaps: catalog.acceptedGaps,
      rejectedGapSamples: catalog.rejectedGapSamples,
      sourceGraphicsRegions: catalog.sourceGraphicsRegions,
      annotatedRegions: annotations.annotatedRegions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotations.annotatedRegions.length,
    },
    acceptedGaps: catalog.acceptedGaps,
    rejectedGapSamples: catalog.rejectedGapSamples,
  }, null, 2));
}

main();
