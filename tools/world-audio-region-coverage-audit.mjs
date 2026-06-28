#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-audio-region-coverage-catalog-2026-06-25';
const reportId = 'audio-region-coverage-audit-2026-06-25';
const toolName = 'tools/world-audio-region-coverage-audit.mjs';

const audioCatalogId = 'world-audio-catalog-2026-06-24';
const streamGraphCatalogId = 'world-audio-stream-graph-catalog-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return parseHex(region.offset);
}

function endExclusiveOf(region) {
  return offsetOf(region) + (region.size || 0);
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

function regionRef(region) {
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function intervalsForRegion(region, intervals) {
  const start = offsetOf(region);
  const end = endExclusiveOf(region);
  return intervals.filter(interval => interval.start < end && interval.endExclusive > start);
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(interval => interval.endExclusive > interval.start)
    .sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.endExclusive) {
      last.endExclusive = Math.max(last.endExclusive, interval.endExclusive);
    } else {
      merged.push({ start: interval.start, endExclusive: interval.endExclusive });
    }
  }
  return merged;
}

function clippedCoverageBytes(region, intervals) {
  const regionStart = offsetOf(region);
  const regionEnd = endExclusiveOf(region);
  const clipped = intervalsForRegion(region, intervals).map(interval => ({
    start: Math.max(regionStart, interval.start),
    endExclusive: Math.min(regionEnd, interval.endExclusive),
  }));
  return mergeIntervals(clipped).reduce((total, interval) => total + interval.endExclusive - interval.start, 0);
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function streamIntervals(audioCatalog) {
  return (audioCatalog.streams || []).map(stream => {
    const start = parseHex(stream.startOffset);
    const endInclusive = parseHex(stream.endOffset);
    return {
      start,
      endExclusive: endInclusive == null ? null : endInclusive + 1,
      id: stream.id,
      regionId: stream.region?.id || null,
      consumedBytes: stream.consumedBytes || 0,
      warningCount: (stream.warnings || []).length,
    };
  }).filter(interval => interval.start != null && interval.endExclusive != null);
}

function headerIntervals(audioCatalog) {
  return (audioCatalog.songs || []).map(song => {
    const start = parseHex(song.romOffset);
    const headerBytes = song.header?.headerBytes || 0;
    return {
      start,
      endExclusive: start == null ? null : start + headerBytes,
      requestId: song.index,
      requestIdHex: hex(song.index, 2),
      regionId: song.region?.id || null,
      channelCount: (song.header?.channels || []).length,
    };
  }).filter(interval => interval.start != null && interval.endExclusive != null && interval.endExclusive > interval.start);
}

function graphRefsByRegion(streamGraphCatalog) {
  const header = new Map();
  const stream = new Map();
  for (const graph of streamGraphCatalog.graphs || []) {
    if (graph.headerRegion?.id) {
      if (!header.has(graph.headerRegion.id)) header.set(graph.headerRegion.id, []);
      header.get(graph.headerRegion.id).push(graph);
    }
    for (const regionId of graph.streamRegionIds || []) {
      if (!stream.has(regionId)) stream.set(regionId, []);
      stream.get(regionId).push(graph);
    }
  }
  return { header, stream };
}

function streamByStartOffset(audioCatalog) {
  const byStart = new Map();
  for (const stream of audioCatalog.streams || []) {
    const start = parseHex(stream.startOffset);
    if (start != null) byStart.set(start, stream);
  }
  return byStart;
}

function graphReachableStreamIntervals(audioCatalog, streamGraphCatalog) {
  const streamsByStart = streamByStartOffset(audioCatalog);
  const refsByStart = new Map();
  for (const graph of streamGraphCatalog.graphs || []) {
    for (const offsetText of graph.reachableStreamOffsets || []) {
      const start = parseHex(offsetText);
      if (start == null) continue;
      if (!refsByStart.has(start)) refsByStart.set(start, []);
      refsByStart.get(start).push({
        requestId: graph.requestId,
        requestIdHex: graph.requestIdHex,
        headerOffset: graph.headerOffset,
        classification: graph.classification?.kind || null,
      });
    }
  }

  const intervals = [];
  for (const [start, requestRefs] of refsByStart.entries()) {
    const stream = streamsByStart.get(start);
    if (!stream) continue;
    const endInclusive = parseHex(stream.endOffset);
    if (endInclusive == null) continue;
    intervals.push({
      start,
      endExclusive: endInclusive + 1,
      id: stream.id,
      regionId: stream.region?.id || null,
      consumedBytes: stream.consumedBytes || 0,
      warningCount: (stream.warnings || []).length,
      requestRefs: requestRefs
        .sort((a, b) => a.requestId - b.requestId)
        .slice(0, 24),
    });
  }
  return intervals.sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
}

function graphRequestHeaderIntervals(audioCatalog, streamGraphCatalog) {
  const songsByRequestId = new Map((audioCatalog.songs || []).map(song => [song.index, song]));
  return (streamGraphCatalog.graphs || []).map(graph => {
    const song = songsByRequestId.get(graph.requestId);
    const start = parseHex(graph.headerOffset || song?.romOffset);
    const headerBytes = song?.header?.headerBytes || 0;
    return {
      start,
      endExclusive: start == null ? null : start + headerBytes,
      requestId: graph.requestId,
      requestIdHex: graph.requestIdHex,
      headerRegionId: graph.headerRegion?.id || song?.region?.id || null,
      channelCount: graph.channelCount || (song?.header?.channels || []).length,
      classification: graph.classification?.kind || null,
    };
  }).filter(interval => interval.start != null && interval.endExclusive != null && interval.endExclusive > interval.start);
}

function classifyRegion(region, item) {
  const analysis = region.analysis || {};
  if (item.streamGraphRefs > 0) return 'graph_reachable_stream_region';
  if (item.headerGraphRefs > 0) return 'request_header_region';
  if (analysis.audioHeaderFalseDwAudit) return 'audio_header_false_dw_fragment';
  if (item.graphStreamOverlapCount > 0) return 'graph_reachable_stream_tail_region';
  if (item.graphHeaderOverlapCount > 0) return 'request_header_tail_region';
  if (item.parsedStreamCount > 0) return 'parsed_stream_not_reached_by_request_graph';
  if (item.parsedHeaderCount > 0) return 'parsed_header_not_reached_by_request_graph';
  if (analysis.audioHeaderFalseDwTargetAudit) return 'false_header_dw_target_stream_like_fragment';
  if (analysis.audioOrphanStreamFragmentAudit) return 'pointer_table_backed_orphan_stream_fragment';
  if (analysis.audioCrossbankFragmentAudit) return 'crossbank_audio_fragment';
  if (analysis.audioRequestTaxonomyAudit) return 'request_table_or_header_fragment';
  if ((region.name || '').toLowerCase().includes('pointer table')) return 'audio_pointer_table_fragment';
  if ((region.size || 0) <= 8) return 'small_audio_fragment_unresolved';
  if (analysis.asmFalseSplitLabelAudit) return 'false_split_music_label_fragment';
  return 'music_region_without_graph_or_header_evidence';
}

function buildCatalog(mapData) {
  const audioCatalog = requireCatalog(mapData, audioCatalogId);
  const streamGraphCatalog = requireCatalog(mapData, streamGraphCatalogId);
  const streams = streamIntervals(audioCatalog);
  const headers = headerIntervals(audioCatalog);
  const graphRefs = graphRefsByRegion(streamGraphCatalog);
  const graphStreams = graphReachableStreamIntervals(audioCatalog, streamGraphCatalog);
  const graphHeaders = graphRequestHeaderIntervals(audioCatalog, streamGraphCatalog);

  const musicRegions = (mapData.regions || [])
    .filter(region => region.type === 'music')
    .sort((a, b) => offsetOf(a) - offsetOf(b));

  const regionCoverage = musicRegions.map(region => {
    const regionStart = offsetOf(region);
    const regionStreams = intervalsForRegion(region, streams);
    const regionHeaders = intervalsForRegion(region, headers);
    const regionGraphStreams = intervalsForRegion(region, graphStreams);
    const regionGraphHeaders = intervalsForRegion(region, graphHeaders);
    const streamCoverageBytes = clippedCoverageBytes(region, streams);
    const headerCoverageBytes = clippedCoverageBytes(region, headers);
    const graphStreamCoverageBytes = clippedCoverageBytes(region, graphStreams);
    const graphHeaderCoverageBytes = clippedCoverageBytes(region, graphHeaders);
    const item = {
      region: regionRef(region),
      streamGraphRefs: (graphRefs.stream.get(region.id) || []).length,
      headerGraphRefs: (graphRefs.header.get(region.id) || []).length,
      graphStreamOverlapCount: regionGraphStreams.length,
      graphStreamTailCount: regionGraphStreams.filter(stream => stream.start < regionStart).length,
      graphHeaderOverlapCount: regionGraphHeaders.length,
      graphHeaderTailCount: regionGraphHeaders.filter(header => header.start < regionStart).length,
      parsedStreamCount: regionStreams.length,
      parsedHeaderCount: regionHeaders.length,
      streamCoverageBytes,
      headerCoverageBytes,
      graphStreamCoverageBytes,
      graphHeaderCoverageBytes,
      streamCoverageRatio: Number((streamCoverageBytes / Math.max(1, region.size || 0)).toFixed(4)),
      headerCoverageRatio: Number((headerCoverageBytes / Math.max(1, region.size || 0)).toFixed(4)),
      graphStreamCoverageRatio: Number((graphStreamCoverageBytes / Math.max(1, region.size || 0)).toFixed(4)),
      graphHeaderCoverageRatio: Number((graphHeaderCoverageBytes / Math.max(1, region.size || 0)).toFixed(4)),
      streamSamples: regionStreams.slice(0, 12).map(stream => ({
        id: stream.id,
        startOffset: hex(stream.start),
        endOffsetExclusive: hex(stream.endExclusive),
        consumedBytes: stream.consumedBytes,
        warningCount: stream.warningCount,
      })),
      graphStreamSamples: regionGraphStreams.slice(0, 12).map(stream => ({
        id: stream.id,
        startOffset: hex(stream.start),
        endOffsetExclusive: hex(stream.endExclusive),
        consumedBytes: stream.consumedBytes,
        warningCount: stream.warningCount,
        startsBeforeRegion: stream.start < regionStart,
        sourceRegionId: stream.regionId,
        requestRefs: stream.requestRefs,
      })),
      graphHeaderSamples: regionGraphHeaders.slice(0, 12).map(header => ({
        requestId: header.requestId,
        requestIdHex: header.requestIdHex,
        startOffset: hex(header.start),
        endOffsetExclusive: hex(header.endExclusive),
        channelCount: header.channelCount,
        startsBeforeRegion: header.start < regionStart,
        sourceRegionId: header.headerRegionId,
        classification: header.classification,
      })),
      headerSamples: regionHeaders.slice(0, 12).map(header => ({
        requestId: header.requestId,
        requestIdHex: header.requestIdHex,
        startOffset: hex(header.start),
        endOffsetExclusive: hex(header.endExclusive),
        channelCount: header.channelCount,
      })),
    };
    item.coverageClass = classifyRegion(region, item);
    item.confidence = item.streamGraphRefs || item.headerGraphRefs || item.graphStreamOverlapCount || item.graphHeaderOverlapCount
      ? 'high'
      : item.parsedStreamCount || item.parsedHeaderCount
        ? 'medium'
        : region.analysis?.audioHeaderFalseDwAudit?.confidence
          || region.analysis?.audioHeaderFalseDwTargetAudit?.streamLikeParse?.parserConfidence
          || region.analysis?.audioHeaderFalseDwTargetAudit?.confidence
          || region.analysis?.audioOrphanStreamFragmentAudit?.confidence
          || region.analysis?.audioCrossbankFragmentAudit?.confidence
          || 'low';
    return item;
  });

  const streamBackedRegions = regionCoverage.filter(item => item.streamGraphRefs > 0);
  const graphStreamOverlapRegions = regionCoverage.filter(item => item.graphStreamOverlapCount > 0);
  const graphStreamTailOverlapRegions = regionCoverage.filter(item => item.streamGraphRefs === 0 && item.graphStreamOverlapCount > 0);
  const graphReachableStreamTailRegions = regionCoverage.filter(item => item.coverageClass === 'graph_reachable_stream_tail_region');
  const graphHeaderOverlapRegions = regionCoverage.filter(item => item.graphHeaderOverlapCount > 0);
  const graphHeaderTailOverlapRegions = regionCoverage.filter(item => item.headerGraphRefs === 0 && item.graphHeaderOverlapCount > 0);
  const requestHeaderTailRegions = regionCoverage.filter(item => item.coverageClass === 'request_header_tail_region');
  const headerOnlyRegions = regionCoverage.filter(item => item.streamGraphRefs === 0 && item.headerGraphRefs > 0);
  const unbackedRegions = regionCoverage.filter(item =>
    item.streamGraphRefs === 0 &&
    item.headerGraphRefs === 0 &&
    item.graphStreamOverlapCount === 0
  );
  const parsedStreamRegionIds = new Set(streams.map(stream => stream.regionId).filter(Boolean));
  const graphStreamRegionIds = new Set([...graphRefs.stream.keys()]);

  return {
    id: catalogId,
    schemaVersion: 2,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [audioCatalogId, streamGraphCatalogId],
    summary: {
      musicRegionCount: musicRegions.length,
      streamBackedRegionCount: streamBackedRegions.length,
      graphStreamOverlapRegionCount: graphStreamOverlapRegions.length,
      graphStreamTailOverlapRegionCount: graphStreamTailOverlapRegions.length,
      graphReachableStreamTailRegionCount: graphReachableStreamTailRegions.length,
      graphHeaderOverlapRegionCount: graphHeaderOverlapRegions.length,
      graphHeaderTailOverlapRegionCount: graphHeaderTailOverlapRegions.length,
      requestHeaderTailRegionCount: requestHeaderTailRegions.length,
      headerOnlyRegionCount: headerOnlyRegions.length,
      unbackedRegionCount: unbackedRegions.length,
      parsedStreamRegionCount: parsedStreamRegionIds.size,
      graphStreamRegionCount: graphStreamRegionIds.size,
      parsedStreamCount: streams.length,
      parsedHeaderCount: headers.length,
      streamGraphCount: (streamGraphCatalog.graphs || []).length,
      coverageClassCounts: countBy(regionCoverage, item => item.coverageClass),
      confidenceCounts: countBy(regionCoverage, item => item.confidence),
      streamBytesCoveredInMusicRegions: regionCoverage.reduce((total, item) => total + item.streamCoverageBytes, 0),
      graphReachableStreamBytesCoveredInMusicRegions: regionCoverage.reduce((total, item) => total + item.graphStreamCoverageBytes, 0),
      headerBytesCoveredInMusicRegions: regionCoverage.reduce((total, item) => total + item.headerCoverageBytes, 0),
      graphRequestHeaderBytesCoveredInMusicRegions: regionCoverage.reduce((total, item) => total + item.graphHeaderCoverageBytes, 0),
      assetPolicy: 'Metadata only: region ids, offsets, stream/header counts, coverage byte counts, graph refs, and classifications. No ROM bytes, decoded music, samples, or PSG/FM data are embedded.',
    },
    regionCoverage,
    priorityLeads: unbackedRegions
      .sort((a, b) => b.region.size - a.region.size)
      .slice(0, 40),
    evidence: [
      `${audioCatalogId} parses _DATA_D139_ request headers and static stream spans with zero parser warnings.`,
      `${streamGraphCatalogId} links request channel roots plus $F6/$FA branch targets into 62 request graphs with no missing targets.`,
      `${streamGraphCatalogId} stores reachable stream offsets; this audit expands those offsets back to parsed stream byte spans so split tail regions are not mistaken for unreachable data.`,
      `${streamGraphCatalogId} stores one graph per request; this audit expands graph header offsets back to parsed header byte spans so split pointer-field regions remain tied to their request header.`,
      'Coverage classes distinguish graph-reachable stream payloads, request headers, cross-bank fragments, pointer fragments, and unresolved inferred music spans.',
    ],
    nextLeads: [
      'Split high-confidence request header regions away from adjacent stream payloads where a region contains both header and stream coverage.',
      'Resolve unbacked music regions by checking whether they are support tables, false split labels, or currently unparsed stream branch targets.',
      'Promote graph-reachable stream spans to a browser audio preview model using existing opcode and frame-step catalogs.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const byId = new Map((mapData.regions || []).map(region => [region.id, region]));
  const annotated = [];
  const missing = [];
  for (const item of catalog.regionCoverage) {
    const region = byId.get(item.region.id);
    if (!region) {
      missing.push(item.region);
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.audioRegionCoverageAudit = {
        catalogId,
        kind: item.coverageClass,
        confidence: item.confidence,
        summary: 'Audio map-region coverage classification derived from parsed request headers, reachable stream graphs, and stream/header byte spans.',
        detail: {
          streamGraphRefs: item.streamGraphRefs,
          headerGraphRefs: item.headerGraphRefs,
          graphStreamOverlapCount: item.graphStreamOverlapCount,
          graphStreamTailCount: item.graphStreamTailCount,
          graphHeaderOverlapCount: item.graphHeaderOverlapCount,
          graphHeaderTailCount: item.graphHeaderTailCount,
          parsedStreamCount: item.parsedStreamCount,
          parsedHeaderCount: item.parsedHeaderCount,
          streamCoverageBytes: item.streamCoverageBytes,
          headerCoverageBytes: item.headerCoverageBytes,
          graphStreamCoverageBytes: item.graphStreamCoverageBytes,
          graphHeaderCoverageBytes: item.graphHeaderCoverageBytes,
          streamCoverageRatio: item.streamCoverageRatio,
          headerCoverageRatio: item.headerCoverageRatio,
          graphStreamCoverageRatio: item.graphStreamCoverageRatio,
          graphHeaderCoverageRatio: item.graphHeaderCoverageRatio,
        },
        evidence: catalog.evidence,
        generatedAt: now,
        tool: toolName,
      };
    }
    annotated.push({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      coverageClass: item.coverageClass,
      confidence: item.confidence,
      streamGraphRefs: item.streamGraphRefs,
      headerGraphRefs: item.headerGraphRefs,
      graphStreamOverlapCount: item.graphStreamOverlapCount,
      graphStreamTailCount: item.graphStreamTailCount,
      graphHeaderOverlapCount: item.graphHeaderOverlapCount,
      graphHeaderTailCount: item.graphHeaderTailCount,
      parsedStreamCount: item.parsedStreamCount,
      parsedHeaderCount: item.parsedHeaderCount,
    });
  }
  return { annotated, missing };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotations = annotateMap(mapData, catalog);

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_region_coverage_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotations.annotated.length,
        missingRegions: annotations.missing.length,
      },
      priorityLeads: catalog.priorityLeads,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: annotations.annotated.length,
    missingRegions: annotations.missing.length,
    priorityLeads: catalog.priorityLeads.slice(0, 10),
  }, null, 2));
}

main();
