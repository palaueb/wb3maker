#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-player-a48-dynamic-seed-link-audit.mjs';
const catalogId = 'world-player-a48-dynamic-seed-link-catalog-2026-06-26';
const reportId = 'player-a48-dynamic-seed-link-audit-2026-06-26';
const schemaVersion = 1;
const targetSourceBank = 0x0B;

const sourceCatalogIds = {
  dynamicSeed: 'world-graphics-dynamic-source-trace-seed-catalog-2026-06-26',
  playerA48TileStream: 'world-player-a48-tile-stream-catalog-2026-06-26',
  playerA48GapCandidate: 'world-player-a48-gap-candidate-catalog-2026-06-26',
  playerFormStateMatrix: 'world-player-form-state-matrix-catalog-2026-06-26',
};

const ramTraceSeedSymbols = [
  { symbol: '_RAM_C24C_', address: '$C24C', role: 'player_frame_pointer_latch_for_command_stream', confidence: 'high' },
  { symbol: '_RAM_C24F_', address: '$C24F', role: 'outer_player_form_dispatch_selector', confidence: 'medium_high' },
  { symbol: '_RAM_C252_', address: '$C252', role: 'next_player_command_cursor', confidence: 'high' },
  { symbol: '_RAM_C260_', address: '$C260', role: 'inner_player_state_dispatch_selector', confidence: 'medium_high' },
  { symbol: '_RAM_C27F_', address: '$C27F', role: 'a48_vram_destination_base_selector', confidence: 'high' },
  { symbol: '_RAM_DFFF_', address: '$DFFF', role: 'previous_mapper_bank_restore_context', confidence: 'medium_high' },
  { symbol: '_RAM_FFFF_', address: '$FFFF', role: 'mapper_page2_bank_write_from_a48_source_record', confidence: 'high' },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value.replace(/^\$/, '0x'), 16);
  return NaN;
}

function offsetOf(region) {
  return parseOffset(region?.offset);
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

function sumBy(items, valueFn) {
  return (items || []).reduce((sum, item) => sum + valueFn(item), 0);
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value != null && value !== ''))].sort((a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
  });
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
  if (!catalog) throw new Error(`Missing required catalog: ${id}`);
  return catalog;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRegionByName(mapData, name) {
  return (mapData.regions || []).find(region => (
    region.name === name ||
    region.label === name ||
    String(region.name || '').startsWith(`${name} `)
  )) || null;
}

function findRamByAddress(mapData, address) {
  const normalized = String(address || '').toUpperCase().replace(/^0X/, '$');
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === normalized) || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function mergeIntervals(intervals) {
  const sorted = (intervals || [])
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

function overlapIntervals(intervals, start, endExclusive) {
  return mergeIntervals((intervals || [])
    .map(interval => overlapRange(start, endExclusive, interval.start, interval.endExclusive))
    .filter(Boolean));
}

function subtractIntervals(baseIntervals, blockerIntervals) {
  const blockers = mergeIntervals(blockerIntervals || []);
  const out = [];
  for (const base of mergeIntervals(baseIntervals || [])) {
    let pending = [{ ...base }];
    for (const blocker of blockers) {
      const nextPending = [];
      for (const item of pending) {
        const overlap = overlapRange(item.start, item.endExclusive, blocker.start, blocker.endExclusive);
        if (!overlap) {
          nextPending.push(item);
          continue;
        }
        if (item.start < overlap.start) {
          nextPending.push({ start: item.start, endExclusive: overlap.start });
        }
        if (overlap.endExclusive < item.endExclusive) {
          nextPending.push({ start: overlap.endExclusive, endExclusive: item.endExclusive });
        }
      }
      pending = nextPending;
      if (!pending.length) break;
    }
    out.push(...pending);
  }
  return mergeIntervals(out);
}

function compactIntervals(intervals, limit = 16) {
  return mergeIntervals(intervals).slice(0, limit).map(interval => ({
    start: hex(interval.start),
    endExclusive: hex(interval.endExclusive),
    sizeBytes: interval.endExclusive - interval.start,
  }));
}

function sourceBankOfOffset(offset) {
  return Math.floor(offset / 0x4000);
}

function intervalFromSpan(span, extra = {}) {
  const start = parseOffset(span?.sourceRomOffset ?? span?.start);
  const endExclusive = parseOffset(span?.sourceEndExclusive ?? span?.endExclusive);
  if (!Number.isFinite(start) || !Number.isFinite(endExclusive) || endExclusive <= start) return null;
  return {
    start,
    endExclusive,
    sourceBank: Number.isFinite(span?.sourceBank) ? span.sourceBank : sourceBankOfOffset(start),
    sourceRegionId: span?.sourceRegion?.id || span?.sourceRegionId || '',
    ...extra,
  };
}

function intervalsFromRegionSummaries(summaries, regionIds) {
  const allowed = regionIds ? new Set(regionIds) : null;
  const intervals = [];
  for (const summary of summaries || []) {
    const region = summary.region || null;
    if (allowed && !allowed.has(region?.id)) continue;
    for (const span of summary.spans || []) {
      const start = parseOffset(span.start);
      const endExclusive = parseOffset(span.endExclusive);
      if (!Number.isFinite(start) || !Number.isFinite(endExclusive) || endExclusive <= start) continue;
      intervals.push({
        start,
        endExclusive,
        sourceBank: sourceBankOfOffset(start),
        sourceRegionId: region?.id || '',
        region,
      });
    }
  }
  return mergeIntervals(intervals);
}

function intervalsFromGapCandidates(gapCatalog, acceptedGapIds) {
  const allowedGaps = new Set(acceptedGapIds || []);
  const intervals = [];
  for (const stream of gapCatalog.a48GapCandidateStreams || []) {
    if (allowedGaps.size && !allowedGaps.has(stream.gapId)) continue;
    for (const span of stream.sourceSpanPreview || []) {
      const interval = intervalFromSpan(span, {
        streamOffset: stream.streamOffset,
        streamRegion: stream.streamRegion,
        streamId: stream.id,
        gapId: stream.gapId,
        confidence: stream.confidence,
        kind: 'accepted_gap_candidate_stream_source_span',
      });
      if (interval && interval.sourceBank === targetSourceBank) intervals.push(interval);
    }
  }
  return intervals;
}

function hasOverlapWithAny(spans, start, endExclusive) {
  return (spans || []).some(span => {
    const interval = intervalFromSpan(span);
    return interval && overlapRange(start, endExclusive, interval.start, interval.endExclusive);
  });
}

function streamSpanOverlaps(stream, start, endExclusive) {
  return (stream.sourceSpanPreview || stream.sourceSpans || [])
    .map(span => {
      const interval = intervalFromSpan(span);
      if (!interval) return null;
      const overlap = overlapRange(start, endExclusive, interval.start, interval.endExclusive);
      if (!overlap) return null;
      return {
        sourceWordOffset: span.sourceWordOffset || null,
        sourceWord: span.sourceWord || null,
        sourceBank: span.sourceBank,
        sourceRomOffset: span.sourceRomOffset,
        sourceEndExclusive: span.sourceEndExclusive,
        overlap: {
          start: hex(overlap.start),
          endExclusive: hex(overlap.endExclusive),
          sizeBytes: overlap.endExclusive - overlap.start,
        },
        tileBlocks: span.tileBlocks,
        sourceRegion: span.sourceRegion || null,
      };
    })
    .filter(Boolean);
}

function findOverlappingA48Streams(a48Catalog, start, endExclusive) {
  const samples = [];
  for (const stream of a48Catalog.a48TileStreams || []) {
    const overlaps = streamSpanOverlaps(stream, start, endExclusive);
    if (!overlaps.length) continue;
    samples.push({
      streamOffset: stream.streamOffset,
      streamRegion: stream.streamRegion,
      confidence: stream.confidence,
      hasHighConfidenceCommandReference: Boolean(stream.hasHighConfidenceCommandReference),
      referencedByCount: stream.referencedByCount,
      referencedByConfidences: stream.referencedByConfidences || [],
      sourceRecordCount: stream.sourceRecordCount,
      issueCount: stream.issueCount,
      overlapSpanCount: overlaps.length,
      overlappingSourceSpans: overlaps.slice(0, 4),
    });
  }
  return samples
    .sort((a, b) => Number(Boolean(a.hasHighConfidenceCommandReference)) - Number(Boolean(b.hasHighConfidenceCommandReference))
      || parseOffset(a.streamOffset) - parseOffset(b.streamOffset))
    .slice(0, 12);
}

function findOverlappingGapStreams(gapCatalog, start, endExclusive) {
  const samples = [];
  for (const stream of gapCatalog.a48GapCandidateStreams || []) {
    const overlaps = streamSpanOverlaps(stream, start, endExclusive);
    if (!overlaps.length) continue;
    samples.push({
      id: stream.id,
      gapId: stream.gapId,
      streamOffset: stream.streamOffset,
      streamRegion: stream.streamRegion,
      confidence: stream.confidence,
      hasKnownPointerReference: Boolean(stream.hasKnownPointerReference),
      boundedBy: stream.boundedBy,
      sourceRecordCount: stream.sourceRecordCount,
      zeroFillTileBlocks: stream.zeroFillTileBlocks,
      totalTileBlocks: stream.totalTileBlocks,
      overlapSpanCount: overlaps.length,
      overlappingSourceSpans: overlaps.slice(0, 4),
    });
  }
  return samples.sort((a, b) => parseOffset(a.streamOffset) - parseOffset(b.streamOffset)).slice(0, 12);
}

function classifySeed(seed, overlaps, sizeBytes) {
  if (overlaps.confirmedBytes === sizeBytes) {
    return {
      classification: 'confirmed_a48_source_overlap_reconcile_queue',
      recommendedNextAction: 'reconcile_seed_with_confirmed_a48_source_coverage',
      confidence: 'high',
    };
  }
  if (overlaps.acceptedGapCandidateBytes === sizeBytes && overlaps.allKnownA48Bytes === sizeBytes) {
    return {
      classification: 'accepted_gap_candidate_exact_match_needs_selector_trace',
      recommendedNextAction: 'trace_or_disprove_player_command_selector_for_accepted_a48_gap_candidate',
      confidence: 'medium',
    };
  }
  if (overlaps.allKnownA48Bytes === sizeBytes && overlaps.confirmedBytes === 0) {
    return {
      classification: 'known_a48_stream_source_gap_needs_command_confidence_trace',
      recommendedNextAction: 'raise_a48_stream_confidence_by_tracing_player_command_selector',
      confidence: 'medium',
    };
  }
  if (overlaps.allKnownA48Bytes === sizeBytes) {
    return {
      classification: 'mixed_a48_source_coverage_needs_reconcile',
      recommendedNextAction: 'split_seed_between_confirmed_and_unconfirmed_a48_stream_sources',
      confidence: 'medium',
    };
  }
  if (overlaps.allKnownA48Bytes > 0) {
    return {
      classification: 'known_a48_partial_overlap_needs_stream_boundary_trace',
      recommendedNextAction: 'trace_stream_boundaries_then_check_non_a48_dynamic_or_decompression_path',
      confidence: 'medium',
    };
  }
  return {
    classification: 'no_a48_source_interval_match_needs_other_dynamic_or_decompression_trace',
    recommendedNextAction: 'trace_8fb_998_dynamic_or_decompression_producer_before_promoting_coverage',
    confidence: seed.recommendedAction === 'trace_real_consumer_before_coverage' ? 'low' : 'medium',
  };
}

function compactSeed(seed, coverage, classification, a48Catalog, gapCatalog) {
  const start = parseOffset(seed.range?.start);
  const endExclusive = parseOffset(seed.range?.endExclusive);
  const sizeBytes = endExclusive - start;
  const a48StreamSamples = findOverlappingA48Streams(a48Catalog, start, endExclusive);
  const acceptedGapStreamSamples = findOverlappingGapStreams(gapCatalog, start, endExclusive);
  return {
    id: seed.id,
    spanId: seed.spanId,
    region: seed.region,
    range: seed.range,
    tileCount: seed.tileCount || Math.ceil(sizeBytes / 32),
    nonblankTileCount: seed.nonblankTileCount || 0,
    sourceBank: seed.sourceBank,
    sourceRecordHighBytes: seed.sourceRecordHighBytes || [],
    sourceRecordWordChunks: seed.sourceRecordWordChunks || [],
    originalRecommendedAction: seed.recommendedAction,
    originalActionConfidence: seed.actionConfidence,
    classification: classification.classification,
    recommendedNextAction: classification.recommendedNextAction,
    confidence: classification.confidence,
    overlapSummary: {
      sizeBytes,
      confirmedA48Bytes: coverage.confirmedBytes,
      knownUnconfirmedA48Bytes: coverage.knownUnconfirmedBytes,
      acceptedGapCandidateBytes: coverage.acceptedGapCandidateBytes,
      allKnownA48Bytes: coverage.allKnownA48Bytes,
      uncoveredByA48Bytes: Math.max(0, sizeBytes - coverage.allKnownA48Bytes),
    },
    overlaps: {
      confirmedA48: compactIntervals(coverage.confirmedOverlap),
      knownUnconfirmedA48: compactIntervals(coverage.knownUnconfirmedOverlap),
      acceptedGapCandidate: compactIntervals(coverage.acceptedGapCandidateOverlap),
      allKnownA48: compactIntervals(coverage.allKnownA48Overlap),
    },
    a48StreamSamples,
    acceptedGapStreamSamples,
    evidenceCatalogs: [
      sourceCatalogIds.dynamicSeed,
      sourceCatalogIds.playerA48TileStream,
      sourceCatalogIds.playerA48GapCandidate,
    ],
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
  };
}

function buildRegionInputs(seeds, confirmedIntervals, knownUnconfirmedIntervals, acceptedGapCandidateIntervals) {
  const regionIds = uniqueSorted(seeds.map(seed => seed.region?.id));
  return regionIds.map(regionId => {
    const regionSeeds = seeds.filter(seed => seed.region?.id === regionId);
    const ranges = regionSeeds.map(seed => ({
      start: parseOffset(seed.range?.start),
      endExclusive: parseOffset(seed.range?.endExclusive),
    }));
    const bounds = {
      start: Math.min(...ranges.map(range => range.start)),
      endExclusive: Math.max(...ranges.map(range => range.endExclusive)),
    };
    return {
      regionId,
      seedCount: regionSeeds.length,
      seedNonblankTileCount: sumBy(regionSeeds, seed => seed.nonblankTileCount || 0),
      seedRangeEnvelope: {
        start: hex(bounds.start),
        endExclusive: hex(bounds.endExclusive),
      },
      confirmedA48SourceSpans: compactIntervals(overlapIntervals(confirmedIntervals, bounds.start, bounds.endExclusive), 32),
      knownUnconfirmedA48SourceSpans: compactIntervals(overlapIntervals(knownUnconfirmedIntervals, bounds.start, bounds.endExclusive), 32),
      acceptedGapCandidateSourceSpans: compactIntervals(overlapIntervals(acceptedGapCandidateIntervals, bounds.start, bounds.endExclusive), 32),
    };
  });
}

function buildCatalog(mapData) {
  const dynamicSeedCatalog = requireCatalog(mapData, sourceCatalogIds.dynamicSeed);
  const a48Catalog = requireCatalog(mapData, sourceCatalogIds.playerA48TileStream);
  const gapCatalog = requireCatalog(mapData, sourceCatalogIds.playerA48GapCandidate);
  findCatalog(mapData, sourceCatalogIds.playerFormStateMatrix);

  const bankSeeds = (dynamicSeedCatalog.seeds || [])
    .filter(seed => seed.sourceBank === hex(targetSourceBank, 2))
    .sort((a, b) => parseOffset(a.range?.start) - parseOffset(b.range?.start));
  const regionIds = uniqueSorted(bankSeeds.map(seed => seed.region?.id));
  const acceptedGapIds = (gapCatalog.acceptedGaps || []).filter(gap => gap.accepted !== false).map(gap => gap.id);

  const confirmedIntervals = intervalsFromRegionSummaries(a48Catalog.sourceGraphicsRegions || [], regionIds);
  const candidateIntervals = intervalsFromRegionSummaries(a48Catalog.candidateSourceGraphicsRegions || [], regionIds);
  const knownUnconfirmedIntervals = subtractIntervals(candidateIntervals, confirmedIntervals);
  const acceptedGapCandidateIntervals = intervalsFromGapCandidates(gapCatalog, acceptedGapIds);

  const links = bankSeeds.map(seed => {
    const start = parseOffset(seed.range?.start);
    const endExclusive = parseOffset(seed.range?.endExclusive);
    const confirmedOverlap = overlapIntervals(confirmedIntervals, start, endExclusive);
    const knownUnconfirmedOverlap = overlapIntervals(knownUnconfirmedIntervals, start, endExclusive);
    const acceptedGapCandidateOverlap = overlapIntervals(acceptedGapCandidateIntervals, start, endExclusive);
    const allKnownA48Overlap = mergeIntervals([
      ...confirmedOverlap,
      ...knownUnconfirmedOverlap,
      ...acceptedGapCandidateOverlap,
    ]);
    const coverage = {
      confirmedOverlap,
      knownUnconfirmedOverlap,
      acceptedGapCandidateOverlap,
      allKnownA48Overlap,
      confirmedBytes: intervalBytes(confirmedOverlap),
      knownUnconfirmedBytes: intervalBytes(knownUnconfirmedOverlap),
      acceptedGapCandidateBytes: intervalBytes(acceptedGapCandidateOverlap),
      allKnownA48Bytes: intervalBytes(allKnownA48Overlap),
    };
    const classification = classifySeed(seed, coverage, endExclusive - start);
    return compactSeed(seed, coverage, classification, a48Catalog, gapCatalog);
  });

  const a48StreamRegionIds = uniqueSorted(links.flatMap(link => [
    ...link.a48StreamSamples.map(stream => stream.streamRegion?.id),
    ...link.acceptedGapStreamSamples.map(stream => stream.streamRegion?.id),
  ]));
  const classificationCounts = countBy(links, link => link.classification);
  const sourceRecordHighBytes = uniqueSorted(links.flatMap(link => link.sourceRecordHighBytes || []));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: offsets, ranges, labels, region ids, RAM symbols, counts, classifications, and catalog references. No ROM bytes, decoded graphics, screenshots, hashes, pixels, audio, text, or ASM instruction bytes are embedded.',
    target: {
      sourceBank: hex(targetSourceBank, 2),
      sourceRecordHighBytes,
      rationale: 'Bank 0x0B has the largest remaining dynamic graphics seed group and overlaps the _LABEL_A48_ player/form tile-stream source-bank formula.',
    },
    summary: {
      bank0BSeedCount: links.length,
      bank0BRegionCount: regionIds.length,
      bank0BRegionIds: regionIds,
      bank0BTileCount: sumBy(links, link => link.tileCount),
      bank0BNonblankTileCount: sumBy(links, link => link.nonblankTileCount),
      bank0BSeedBytes: sumBy(links, link => link.overlapSummary.sizeBytes),
      classificationCounts,
      acceptedGapCandidateExactSeedCount: classificationCounts.accepted_gap_candidate_exact_match_needs_selector_trace || 0,
      knownA48FullCoverageSeedCount: classificationCounts.known_a48_stream_source_gap_needs_command_confidence_trace || 0,
      mixedA48CoverageSeedCount: classificationCounts.mixed_a48_source_coverage_needs_reconcile || 0,
      knownA48PartialSeedCount: classificationCounts.known_a48_partial_overlap_needs_stream_boundary_trace || 0,
      noA48MatchSeedCount: classificationCounts.no_a48_source_interval_match_needs_other_dynamic_or_decompression_trace || 0,
      confirmedA48OverlapSeedCount: classificationCounts.confirmed_a48_source_overlap_reconcile_queue || 0,
      confirmedA48OverlapBytes: sumBy(links, link => link.overlapSummary.confirmedA48Bytes),
      knownUnconfirmedA48OverlapBytes: sumBy(links, link => link.overlapSummary.knownUnconfirmedA48Bytes),
      acceptedGapCandidateOverlapBytes: sumBy(links, link => link.overlapSummary.acceptedGapCandidateBytes),
      allKnownA48OverlapBytes: sumBy(links, link => link.overlapSummary.allKnownA48Bytes),
      uncoveredByA48Bytes: sumBy(links, link => link.overlapSummary.uncoveredByA48Bytes),
      a48StreamRegionIds,
      a48StreamRegionCount: a48StreamRegionIds.length,
      ramTraceSeedCount: ramTraceSeedSymbols.length,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    coverageInputs: {
      sourceRegionInputs: buildRegionInputs(bankSeeds, confirmedIntervals, knownUnconfirmedIntervals, acceptedGapCandidateIntervals),
      confirmedA48SourceIntervalBytes: intervalBytes(confirmedIntervals),
      knownUnconfirmedA48SourceIntervalBytes: intervalBytes(knownUnconfirmedIntervals),
      acceptedGapCandidateSourceIntervalBytes: intervalBytes(acceptedGapCandidateIntervals),
      acceptedGapIds,
    },
    links,
    topLinks: links
      .slice()
      .sort((a, b) => b.nonblankTileCount - a.nonblankTileCount || parseOffset(a.range?.start) - parseOffset(b.range?.start))
      .slice(0, 12),
    ramTraceSeeds: ramTraceSeedSymbols,
    evidence: [
      `${sourceCatalogIds.dynamicSeed} supplies the bank 0x0B dynamic graphics trace seeds and sourceRecordHighByte values.`,
      `${sourceCatalogIds.playerA48TileStream} supplies confirmed and candidate _LABEL_A48_ source interval summaries; merged interval math is used so repeated stream references do not inflate byte counts.`,
      `${sourceCatalogIds.playerA48GapCandidate} supplies the accepted unreferenced A48-shaped gap candidate bounded by confirmed neighboring streams.`,
      '_LABEL_A48_ record semantics derive source bank from the source word high bits and use _RAM_C27F_ to choose the VRAM tile base.',
      'This catalog only links existing metadata and promotes no graphics byte range to confirmed coverage.',
    ],
    nextLeads: [
      'Trace the accepted A48 gap candidate exact match at r2645 0x2D300-0x2D540 from player command selectors before promoting it as runtime-covered graphics.',
      'For full known-A48 seed matches, raise command-stream confidence by tracing _RAM_C24F_, _RAM_C260_, and _RAM_C252_ into _LABEL_13A6_ and _LABEL_A48_.',
      'For partial/no-match bank 0x0B seeds, trace _LABEL_998_/_LABEL_A97_ dynamic decode or another decompression producer before assigning coverage.',
    ],
  };
}

function buildRegionDetails(links) {
  const details = new Map();
  for (const link of links) {
    const regionId = link.region?.id;
    if (!regionId) continue;
    if (!details.has(regionId)) {
      details.set(regionId, {
        seedCount: 0,
        nonblankTileCount: 0,
        seedBytes: 0,
        classificationCounts: {},
        sourceRecordHighBytes: new Set(),
        acceptedGapCandidateOverlapBytes: 0,
        knownUnconfirmedA48OverlapBytes: 0,
        uncoveredByA48Bytes: 0,
        sampleLinks: [],
      });
    }
    const detail = details.get(regionId);
    detail.seedCount++;
    detail.nonblankTileCount += link.nonblankTileCount;
    detail.seedBytes += link.overlapSummary.sizeBytes;
    detail.classificationCounts[link.classification] = (detail.classificationCounts[link.classification] || 0) + 1;
    detail.acceptedGapCandidateOverlapBytes += link.overlapSummary.acceptedGapCandidateBytes;
    detail.knownUnconfirmedA48OverlapBytes += link.overlapSummary.knownUnconfirmedA48Bytes;
    detail.uncoveredByA48Bytes += link.overlapSummary.uncoveredByA48Bytes;
    for (const highByte of link.sourceRecordHighBytes || []) detail.sourceRecordHighBytes.add(highByte);
    detail.sampleLinks.push({
      spanId: link.spanId,
      range: link.range,
      classification: link.classification,
      recommendedNextAction: link.recommendedNextAction,
      overlapSummary: link.overlapSummary,
    });
  }
  return details;
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const details = buildRegionDetails(catalog.links);

  for (const [regionId, detail] of details) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'bank0b_dynamic_graphics_seed_region' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48DynamicSeedLinkAudit = {
        catalogId,
        role: 'bank0b_dynamic_graphics_seed_region',
        confidence: 'medium',
        summary: 'Bank 0x0B dynamic graphics trace seeds were classified against confirmed, candidate, and accepted-gap _LABEL_A48_ source intervals.',
        detail: {
          seedCount: detail.seedCount,
          nonblankTileCount: detail.nonblankTileCount,
          seedBytes: detail.seedBytes,
          classificationCounts: detail.classificationCounts,
          sourceRecordHighBytes: [...detail.sourceRecordHighBytes].sort(),
          acceptedGapCandidateOverlapBytes: detail.acceptedGapCandidateOverlapBytes,
          knownUnconfirmedA48OverlapBytes: detail.knownUnconfirmedA48OverlapBytes,
          uncoveredByA48Bytes: detail.uncoveredByA48Bytes,
          sampleLinks: detail.sampleLinks.slice(0, 8),
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      role: 'bank0b_dynamic_graphics_seed_region',
      seedCount: detail.seedCount,
      nonblankTileCount: detail.nonblankTileCount,
      classificationCounts: detail.classificationCounts,
    });
  }

  const streamRegionDetails = new Map();
  for (const link of catalog.links) {
    const streamSamples = [
      ...link.a48StreamSamples.map(stream => ({ kind: 'known_a48_stream', stream })),
      ...link.acceptedGapStreamSamples.map(stream => ({ kind: 'accepted_gap_candidate_stream', stream })),
    ];
    for (const item of streamSamples) {
      const regionId = item.stream.streamRegion?.id;
      if (!regionId) continue;
      if (!streamRegionDetails.has(regionId)) {
        streamRegionDetails.set(regionId, { sampleCount: 0, classifications: {}, streamOffsets: new Set(), linkSpanIds: new Set() });
      }
      const detail = streamRegionDetails.get(regionId);
      detail.sampleCount++;
      detail.classifications[link.classification] = (detail.classifications[link.classification] || 0) + 1;
      detail.streamOffsets.add(item.stream.streamOffset);
      detail.linkSpanIds.add(link.spanId);
    }
  }

  for (const [regionId, detail] of streamRegionDetails) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'player_a48_stream_region_for_bank0b_seed_link' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48DynamicSeedLinkAudit = {
        catalogId,
        role: 'player_a48_stream_region_for_bank0b_seed_link',
        confidence: 'medium',
        summary: 'Region contains _LABEL_A48_ stream metadata whose source-span previews overlap bank 0x0B dynamic graphics trace seeds.',
        detail: {
          sampleCount: detail.sampleCount,
          classificationCounts: detail.classifications,
          streamOffsets: [...detail.streamOffsets].sort().slice(0, 24),
          linkedSpanIds: [...detail.linkSpanIds].sort().slice(0, 24),
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      role: 'player_a48_stream_region_for_bank0b_seed_link',
      sampleCount: detail.sampleCount,
    });
  }

  const routineLabels = [
    { label: '_LABEL_A48_', role: 'a48_tile_stream_uploader' },
    { label: '_LABEL_13A6_', role: 'player_command_stream_parser_calling_a48' },
  ];
  for (const routine of routineLabels) {
    const region = findRegionByName(mapData, routine.label);
    if (!region) {
      missingRegions.push({ name: routine.label, role: routine.role });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48DynamicSeedLinkAudit = {
        catalogId,
        role: routine.role,
        confidence: 'high',
        summary: 'Routine participates in the _LABEL_A48_ player tile-stream path used to classify bank 0x0B dynamic graphics seeds.',
        detail: {
          targetSourceBank: catalog.target.sourceBank,
          sourceRecordHighBytes: catalog.target.sourceRecordHighBytes,
          classificationCounts: catalog.summary.classificationCounts,
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      role: routine.role,
    });
  }

  const changedRam = [];
  for (const seed of catalog.ramTraceSeeds) {
    const ramEntry = findRamByAddress(mapData, seed.address);
    if (!ramEntry) continue;
    if (apply) {
      ramEntry.analysis = ramEntry.analysis || {};
      ramEntry.analysis.playerA48DynamicSeedLinkAudit = {
        catalogId,
        symbol: seed.symbol,
        role: seed.role,
        confidence: seed.confidence,
        summary: 'RAM value is a trace seed for linking player/form command selection to bank 0x0B _LABEL_A48_ graphics source spans.',
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      id: ramEntry.id,
      address: ramEntry.address,
      name: ramEntry.name || '',
      symbol: seed.symbol,
      role: seed.role,
      confidence: seed.confidence,
    });
  }

  return { changedRegions, missingRegions, changedRam };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    target: catalog.target,
    topLinks: catalog.topLinks.slice(0, 8).map(link => ({
      spanId: link.spanId,
      region: link.region,
      range: link.range,
      classification: link.classification,
      recommendedNextAction: link.recommendedNextAction,
      overlapSummary: link.overlapSummary,
      sourceRecordHighBytes: link.sourceRecordHighBytes,
      a48StreamSampleCount: link.a48StreamSamples.length,
      acceptedGapStreamSampleCount: link.acceptedGapStreamSamples.length,
    })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
  mapData.graphicsCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'player_a48_dynamic_seed_link_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    sample: reportSample(catalog),
    assetPolicy: catalog.assetPolicy,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);
  if (apply) {
    applyCatalog(mapData, catalog, annotation);
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    sample: reportSample(catalog),
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
  }, null, 2));
}

main();
