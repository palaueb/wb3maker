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
const catalogId = 'world-audio-stream-graph-catalog-2026-06-25';
const reportId = 'audio-stream-graph-audit-2026-06-25';
const toolName = 'tools/world-audio-stream-graph-audit.mjs';

const audioCatalogId = 'world-audio-catalog-2026-06-24';
const taxonomyCatalogId = 'world-audio-request-taxonomy-catalog-2026-06-25';
const opcodeEffectCatalogId = 'world-audio-opcode-state-effect-catalog-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
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

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function pushUnique(list, value, limit = 24) {
  if (value != null && list.length < limit && !list.includes(value)) list.push(value);
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function addCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = (target[key] || 0) + value;
  }
}

function compactStream(stream) {
  if (!stream) return null;
  return {
    id: stream.id,
    startOffset: stream.startOffset,
    endOffset: stream.endOffset,
    consumedBytes: stream.consumedBytes,
    region: stream.region || null,
    noteBytes: stream.noteBytes,
    highFlagNoteBytes: stream.highFlagNoteBytes,
    restOrSpecialBytes: stream.restOrSpecialBytes,
    opcodeCounts: stream.opcodeCounts || {},
    branchTargetCount: (stream.branchTargets || []).length,
    endReason: stream.endReason,
    warningCount: (stream.warnings || []).length,
  };
}

function branchKind(opcode) {
  if (opcode === '$F6') return 'call_stream_pointer';
  if (opcode === '$FA') return 'jump_stream_pointer';
  return 'branch_or_loop_control';
}

function buildStreamIndexes(audioCatalog) {
  const byOffset = new Map();
  const byId = new Map();
  for (const stream of audioCatalog.streams || []) {
    const offset = parseHex(stream.startOffset);
    if (offset != null) byOffset.set(offset, stream);
    if (stream.id) byId.set(stream.id, stream);
  }
  return { byOffset, byId };
}

function walkStreamGraph(rootOffset, indexes) {
  const stack = [{ offset: rootOffset, depth: 0, via: null }];
  const visited = new Set();
  const streamOrder = [];
  const edges = [];
  const missingTargets = [];
  let maxDepth = 0;

  while (stack.length && visited.size < 768) {
    const item = stack.pop();
    if (item.offset == null) continue;
    if (visited.has(item.offset)) continue;
    const stream = indexes.byOffset.get(item.offset);
    if (!stream) {
      missingTargets.push({
        targetOffset: hex(item.offset),
        via: item.via,
      });
      continue;
    }
    visited.add(item.offset);
    maxDepth = Math.max(maxDepth, item.depth);
    streamOrder.push(stream);

    for (const target of stream.branchTargets || []) {
      const targetOffset = parseHex(target.romTarget);
      const edge = {
        fromStreamId: stream.id,
        fromStartOffset: stream.startOffset,
        opcode: target.opcode,
        kind: branchKind(target.opcode),
        opcodeOffset: target.opcodeOffset,
        z80Target: target.z80Target,
        targetOffset: target.romTarget,
        targetRegion: target.targetRegion || null,
      };
      edges.push(edge);
      if (targetOffset == null) {
        missingTargets.push({
          targetOffset: target.romTarget || null,
          via: edge,
          reason: 'non-rom-target',
        });
        continue;
      }
      if (!visited.has(targetOffset)) stack.push({ offset: targetOffset, depth: item.depth + 1, via: edge });
    }
  }

  return {
    rootOffset: hex(rootOffset),
    streams: streamOrder,
    edges,
    missingTargets,
    maxDepth,
  };
}

function buildRequestGraph(mapData, audioCatalog, taxonomyByRequestId, indexes, requestIndex) {
  const song = audioCatalog.songs[requestIndex];
  const taxonomy = taxonomyByRequestId.get(requestIndex) || null;
  const rootChannels = (song.header?.channels || []).map(channel => {
    const rootOffset = parseHex(channel.streamRomOffset);
    const walk = rootOffset == null ? null : walkStreamGraph(rootOffset, indexes);
    const streamOffsets = walk ? walk.streams.map(stream => stream.startOffset) : [];
    const opcodeTotals = {};
    for (const stream of walk?.streams || []) addCounts(opcodeTotals, stream.opcodeCounts);
    return {
      channelIndex: channel.index,
      channelId: channel.channelId,
      channelIdHex: channel.channelIdHex,
      priority: channel.priority,
      priorityHex: channel.priorityHex,
      rootStreamOffset: channel.streamRomOffset,
      rootStreamRegion: channel.streamRegion || null,
      reachableStreamCount: streamOffsets.length,
      reachableStreamOffsets: streamOffsets,
      branchEdgeCount: walk?.edges.length || 0,
      maxBranchDepth: walk?.maxDepth || 0,
      opcodeTotals,
      missingTargetCount: walk?.missingTargets.length || 0,
    };
  });

  const streamByOffset = new Map();
  const edgeByKey = new Map();
  const missingTargets = [];
  let maxBranchDepth = 0;
  for (const channel of rootChannels) {
    const rootOffset = parseHex(channel.rootStreamOffset);
    const walk = rootOffset == null ? null : walkStreamGraph(rootOffset, indexes);
    for (const stream of walk?.streams || []) streamByOffset.set(stream.startOffset, stream);
    for (const edge of walk?.edges || []) {
      const key = `${edge.fromStartOffset}|${edge.opcodeOffset}|${edge.targetOffset}`;
      edgeByKey.set(key, edge);
    }
    for (const missing of walk?.missingTargets || []) missingTargets.push(missing);
    maxBranchDepth = Math.max(maxBranchDepth, walk?.maxDepth || 0);
  }

  const streams = [...streamByOffset.values()].sort((a, b) => parseHex(a.startOffset) - parseHex(b.startOffset));
  const edges = [...edgeByKey.values()].sort((a, b) => parseHex(a.opcodeOffset) - parseHex(b.opcodeOffset));
  const opcodeTotals = {};
  let noteBytes = 0;
  let highFlagNoteBytes = 0;
  let restOrSpecialBytes = 0;
  let consumedBytes = 0;
  const streamRegionIds = new Set();
  const endReasons = [];

  for (const stream of streams) {
    addCounts(opcodeTotals, stream.opcodeCounts);
    noteBytes += stream.noteBytes || 0;
    highFlagNoteBytes += stream.highFlagNoteBytes || 0;
    restOrSpecialBytes += stream.restOrSpecialBytes || 0;
    consumedBytes += stream.consumedBytes || 0;
    if (stream.region?.id) streamRegionIds.add(stream.region.id);
    if (stream.endReason) endReasons.push(stream.endReason);
  }

  const headerOffset = parseHex(song.romOffset);
  const headerRegion = song.region || regionRef(findContainingRegion(mapData, headerOffset));
  return {
    id: `audio_stream_graph_${requestIndex.toString(16).toUpperCase().padStart(2, '0')}`,
    requestId: requestIndex,
    requestIdHex: hex(requestIndex, 2),
    tableEntryOffset: song.tableEntryOffset,
    headerOffset: song.romOffset,
    headerRegion,
    classification: taxonomy?.classification || null,
    roomRecipeUsage: taxonomy?.roomRecipeUsage || null,
    immediateCallSiteCount: taxonomy?.immediateCallSiteCount || 0,
    candidateCallSiteCount: taxonomy?.candidateCallSiteCount || 0,
    channelCount: rootChannels.length,
    rootChannels,
    reachableStreamCount: streams.length,
    reachableStreamOffsets: streams.map(stream => stream.startOffset),
    reachableStreamSamples: streams.slice(0, 24).map(compactStream),
    streamRegionCount: streamRegionIds.size,
    streamRegionIds: [...streamRegionIds].sort(),
    branchEdgeCount: edges.length,
    branchEdges: edges.slice(0, 96),
    immediatePointerCallEdgeCount: edges.filter(edge => edge.opcode === '$F6').length,
    jumpPointerEdgeCount: edges.filter(edge => edge.opcode === '$FA').length,
    maxBranchDepth,
    consumedBytes,
    noteBytes,
    highFlagNoteBytes,
    restOrSpecialBytes,
    opcodeTotals,
    endReasonCounts: countBy(endReasons, value => value),
    missingTargetCount: missingTargets.length,
    missingTargets: missingTargets.slice(0, 24),
    evidence: [
      `${audioCatalogId} parses the _DATA_D139_ request headers and branch targets from $F6/$FA stream opcodes.`,
      `${opcodeEffectCatalogId} confirms $F6 as call_stream_pointer and $FA as jump_stream_pointer, both using two-byte bank-3 stream pointer arguments.`,
      'This graph stores offsets, counts, stream ids, and region refs only; it does not embed stream bytes or decoded audio.',
    ],
  };
}

function buildCatalog(mapData) {
  const audioCatalog = requireCatalog(mapData, audioCatalogId);
  const taxonomyCatalog = findCatalog(mapData, taxonomyCatalogId);
  const opcodeEffectCatalog = findCatalog(mapData, opcodeEffectCatalogId);
  const indexes = buildStreamIndexes(audioCatalog);
  const taxonomyByRequestId = new Map((taxonomyCatalog?.requests || []).map(request => [request.requestId, request]));
  const graphs = [];
  for (let i = 0; i < (audioCatalog.songs || []).length; i++) {
    graphs.push(buildRequestGraph(mapData, audioCatalog, taxonomyByRequestId, indexes, i));
  }

  const edgeCounts = graphs.map(graph => graph.branchEdgeCount);
  const reachableCounts = graphs.map(graph => graph.reachableStreamCount);
  const missingTargetCount = graphs.reduce((sum, graph) => sum + graph.missingTargetCount, 0);
  const opcodeTotals = {};
  for (const graph of graphs) addCounts(opcodeTotals, graph.opcodeTotals);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      audioCatalogId,
      ...(taxonomyCatalog ? [taxonomyCatalogId] : []),
      ...(opcodeEffectCatalog ? [opcodeEffectCatalogId] : []),
    ],
    semantics: {
      graphRoots: 'Each request graph starts from the stream pointers in that request header channel records.',
      branchEdges: '$F6 and $FA targets are taken from the parsed stream branchTargets in world-audio-catalog-2026-06-24.',
      traversalPolicy: 'Static graph traversal follows branch targets once per stream offset and records cycles as edges without recursively expanding them forever.',
      caution: 'This is a static reachability graph, not a frame-accurate audio interpreter. Repeat counters, returns, and timing still need runtime modeling.',
    },
    summary: {
      requestGraphCount: graphs.length,
      requestGraphsWithBranches: graphs.filter(graph => graph.branchEdgeCount > 0).length,
      requestGraphsWithMissingTargets: graphs.filter(graph => graph.missingTargetCount > 0).length,
      missingTargetCount,
      totalReachableStreamRefs: graphs.reduce((sum, graph) => sum + graph.reachableStreamCount, 0),
      uniqueReachableStreams: new Set(graphs.flatMap(graph => graph.reachableStreamOffsets)).size,
      totalBranchEdges: graphs.reduce((sum, graph) => sum + graph.branchEdgeCount, 0),
      totalImmediatePointerCallEdges: graphs.reduce((sum, graph) => sum + graph.immediatePointerCallEdgeCount, 0),
      totalJumpPointerEdges: graphs.reduce((sum, graph) => sum + graph.jumpPointerEdgeCount, 0),
      maxReachableStreamsPerRequest: Math.max(...reachableCounts),
      maxBranchEdgesPerRequest: Math.max(...edgeCounts),
      maxBranchDepth: Math.max(...graphs.map(graph => graph.maxBranchDepth)),
      classificationCounts: countBy(graphs, graph => graph.classification?.kind || 'unclassified'),
      opcodeTotals,
      assetPolicy: 'Metadata only: request ids, offsets, stream ids, branch edge offsets, counts, and region refs. No ROM bytes, decoded music, audio samples, or generated assets are embedded.',
    },
    graphs,
  };
}

function compactGraphRef(graph) {
  return {
    catalogId,
    requestId: graph.requestId,
    requestIdHex: graph.requestIdHex,
    headerOffset: graph.headerOffset,
    classification: graph.classification,
    channelCount: graph.channelCount,
    reachableStreamCount: graph.reachableStreamCount,
    branchEdgeCount: graph.branchEdgeCount,
    immediatePointerCallEdgeCount: graph.immediatePointerCallEdgeCount,
    jumpPointerEdgeCount: graph.jumpPointerEdgeCount,
    maxBranchDepth: graph.maxBranchDepth,
    missingTargetCount: graph.missingTargetCount,
    roomRecipeUsage: graph.roomRecipeUsage || null,
  };
}

function annotateMap(mapData, catalog) {
  const headerRefsByRegion = new Map();
  const streamRefsByRegion = new Map();
  const missingRegions = [];

  function addRef(map, regionLike, fallbackOffset, ref, role) {
    let region = regionLike?.id ? findRegionById(mapData, regionLike.id) : null;
    const offset = parseHex(fallbackOffset);
    if (!region && offset != null) region = findContainingRegion(mapData, offset);
    if (!region) {
      missingRegions.push({ role, offset: fallbackOffset, requestId: ref.requestId });
      return;
    }
    if (!map.has(region.id)) map.set(region.id, { region, refs: [] });
    map.get(region.id).refs.push(ref);
  }

  for (const graph of catalog.graphs) {
    addRef(headerRefsByRegion, graph.headerRegion, graph.headerOffset, compactGraphRef(graph), 'audio_request_graph_header');
    for (const regionId of graph.streamRegionIds) {
      const region = findRegionById(mapData, regionId);
      addRef(streamRefsByRegion, region, region?.offset || null, {
        ...compactGraphRef(graph),
        reachableStreamOffsetsSample: graph.reachableStreamOffsets.slice(0, 12),
      }, 'audio_request_graph_stream_region');
    }
  }

  const annotatedHeaderRegions = [];
  for (const { region, refs } of headerRefsByRegion.values()) {
    region.analysis = region.analysis || {};
    region.analysis.audioStreamGraphAudit = {
      catalogId,
      kind: 'audio_request_header_graphs',
      confidence: refs.some(ref => ref.missingTargetCount) ? 'medium' : 'high',
      summary: 'Region contains one or more audio request headers with static stream reachability graphs.',
      requestGraphs: refs.sort((a, b) => a.requestId - b.requestId).slice(0, 96),
      evidence: [
        '_DATA_D139_ request headers provide graph roots via channel stream pointers.',
        'Branch edges come from $F6/$FA stream pointer opcodes parsed by the audio catalog and validated by the opcode state-effect catalog.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedHeaderRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      requestGraphRefs: refs.length,
    });
  }

  const annotatedStreamRegions = [];
  for (const { region, refs } of streamRefsByRegion.values()) {
    region.analysis = region.analysis || {};
    region.analysis.audioStreamGraphUsageAudit = {
      catalogId,
      kind: 'audio_stream_region_graph_usage',
      confidence: refs.some(ref => ref.missingTargetCount) ? 'medium' : 'high',
      summary: 'Region contains stream segments reachable from one or more audio request graphs.',
      requestGraphs: refs.sort((a, b) => a.requestId - b.requestId).slice(0, 128),
      evidence: [
        'Reachability is computed from request channel roots plus $F6/$FA branch target offsets.',
        'Stored graph usage is metadata-only: offsets, ids, counts, and region references.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedStreamRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      requestGraphRefs: refs.length,
    });
  }

  return { annotatedHeaderRegions, annotatedStreamRegions, missingRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotations = apply
    ? annotateMap(mapData, catalog)
    : { annotatedHeaderRegions: [], annotatedStreamRegions: [], missingRegions: [] };

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_stream_graph_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedHeaderRegions: annotations.annotatedHeaderRegions.length,
        annotatedStreamRegions: annotations.annotatedStreamRegions.length,
        missingRegions: annotations.missingRegions.length,
      },
      semantics: catalog.semantics,
      graphSummary: catalog.graphs.map(graph => ({
        requestId: graph.requestId,
        requestIdHex: graph.requestIdHex,
        headerOffset: graph.headerOffset,
        classification: graph.classification,
        channelCount: graph.channelCount,
        reachableStreamCount: graph.reachableStreamCount,
        branchEdgeCount: graph.branchEdgeCount,
        immediatePointerCallEdgeCount: graph.immediatePointerCallEdgeCount,
        jumpPointerEdgeCount: graph.jumpPointerEdgeCount,
        maxBranchDepth: graph.maxBranchDepth,
        missingTargetCount: graph.missingTargetCount,
      })),
      annotatedHeaderRegions: annotations.annotatedHeaderRegions,
      annotatedStreamRegions: annotations.annotatedStreamRegions,
      missingRegions: annotations.missingRegions,
      nextLeads: [
        'Use graph edges to generate per-request stream control-flow views in the analyzer without dumping stream bytes.',
        'Trace $F6 return behavior and repeat counters dynamically so graph reachability can become frame-accurate playback state.',
        'Connect room/zone audio request usage to these stream graphs so each scene recipe can explain its music/SFX graph footprint.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedHeaderRegions: annotations.annotatedHeaderRegions.length,
      annotatedStreamRegions: annotations.annotatedStreamRegions.length,
      missingRegions: annotations.missingRegions.length,
    },
    firstGraphs: catalog.graphs.slice(0, 6).map(graph => ({
      requestId: graph.requestIdHex,
      classification: graph.classification?.kind || null,
      channelCount: graph.channelCount,
      reachableStreamCount: graph.reachableStreamCount,
      branchEdgeCount: graph.branchEdgeCount,
      missingTargetCount: graph.missingTargetCount,
    })),
  }, null, 2));
}

main();
