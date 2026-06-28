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
const catalogId = 'world-zone-audio-graph-link-catalog-2026-06-25';
const reportId = 'zone-audio-graph-link-audit-2026-06-25';
const toolName = 'tools/world-zone-audio-graph-link-audit.mjs';

const streamGraphCatalogId = 'world-audio-stream-graph-catalog-2026-06-25';
const taxonomyCatalogId = 'world-audio-request-taxonomy-catalog-2026-06-25';
const zoneRecipeCatalogId = 'world-zone-recipe-catalog-2026-06-25';
const inlineRecipeCatalogId = 'world-inline-transition-recipe-catalog-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 2) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
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

function compactRegionRef(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function compactChannel(channel) {
  if (!channel) return null;
  return {
    channelIndex: channel.channelIndex,
    channelIdHex: channel.channelIdHex,
    priorityHex: channel.priorityHex,
    rootStreamOffset: channel.rootStreamOffset,
    rootStreamRegion: compactRegionRef(channel.rootStreamRegion),
    reachableStreamCount: channel.reachableStreamCount,
    branchEdgeCount: channel.branchEdgeCount,
    maxBranchDepth: channel.maxBranchDepth,
    missingTargetCount: channel.missingTargetCount,
  };
}

function compactGraph(graph) {
  if (!graph) return null;
  return {
    kind: 'audio_stream_graph_ref',
    catalogId: streamGraphCatalogId,
    graphId: graph.id,
    requestId: graph.requestId,
    requestIdHex: graph.requestIdHex,
    headerOffset: graph.headerOffset,
    headerRegion: compactRegionRef(graph.headerRegion),
    classification: graph.classification || null,
    channelCount: graph.channelCount,
    rootChannels: (graph.rootChannels || []).map(compactChannel).filter(Boolean),
    reachableStreamCount: graph.reachableStreamCount,
    reachableStreamOffsetSample: (graph.reachableStreamOffsets || []).slice(0, 16),
    streamRegionCount: graph.streamRegionCount,
    streamRegionIds: graph.streamRegionIds || [],
    branchEdgeCount: graph.branchEdgeCount,
    immediatePointerCallEdgeCount: graph.immediatePointerCallEdgeCount,
    jumpPointerEdgeCount: graph.jumpPointerEdgeCount,
    maxBranchDepth: graph.maxBranchDepth,
    missingTargetCount: graph.missingTargetCount,
    opcodeTotals: graph.opcodeTotals || {},
    endReasonCounts: graph.endReasonCounts || {},
    confidence: graph.missingTargetCount ? 'medium' : 'high',
    evidence: [
      `${streamGraphCatalogId} derives this request graph from channel stream roots and $F6/$FA pointer edges.`,
      'The recipe audio request id comes from room subrecord byte +17 and is cached/passed to _LABEL_104B_ when changed.',
      'This compact reference stores offsets, counts, region ids, and opcode totals only; no stream bytes or decoded audio are embedded.',
    ],
  };
}

function recipeKind(recipe) {
  return recipe?.recipeType === 'inline_transition_room_zone_render'
    ? 'inline_transition_recipe'
    : 'zone_recipe';
}

function recipeDescriptorOffset(recipe) {
  return recipe?.descriptor?.romOffset || null;
}

function recipeAudioRequestId(recipe) {
  const value = recipe?.dependencies?.audioRequest?.requestId;
  return Number.isInteger(value) ? value : null;
}

function linkRecipe(recipe, graphByRequestId) {
  const requestId = recipeAudioRequestId(recipe);
  const graph = requestId == null ? null : graphByRequestId.get(requestId);
  if (!recipe.dependencies) recipe.dependencies = {};
  if (!recipe.dependencies.audioRequest) recipe.dependencies.audioRequest = {};
  if (graph) {
    recipe.dependencies.audioRequest.streamGraph = compactGraph(graph);
    recipe.dependencies.audioRequest.streamGraphResolved = true;
    recipe.dependencies.audioRequest.streamGraphSourceCatalogId = streamGraphCatalogId;
  } else {
    recipe.dependencies.audioRequest.streamGraph = null;
    recipe.dependencies.audioRequest.streamGraphResolved = false;
    recipe.dependencies.audioRequest.streamGraphSourceCatalogId = streamGraphCatalogId;
  }
  return {
    recipeId: recipe.id || '',
    recipeKind: recipeKind(recipe),
    descriptorOffset: recipeDescriptorOffset(recipe),
    requestId,
    requestIdHex: requestId == null ? null : hex(requestId),
    graphId: graph?.id || null,
    linked: Boolean(graph),
    reachableStreamCount: graph?.reachableStreamCount || 0,
    branchEdgeCount: graph?.branchEdgeCount || 0,
    maxBranchDepth: graph?.maxBranchDepth || 0,
    missingTargetCount: graph?.missingTargetCount || 0,
  };
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function buildCatalog(mapData, recipeLinks) {
  const linkedLinks = recipeLinks.filter(link => link.linked);
  const missingLinks = recipeLinks.filter(link => !link.linked);
  const byRequest = new Map();
  for (const link of linkedLinks) {
    if (!byRequest.has(link.requestId)) {
      byRequest.set(link.requestId, {
        requestId: link.requestId,
        requestIdHex: link.requestIdHex,
        graphId: link.graphId,
        recipeCount: 0,
        zoneRecipeCount: 0,
        inlineTransitionRecipeCount: 0,
        reachableStreamCount: link.reachableStreamCount,
        branchEdgeCount: link.branchEdgeCount,
        maxBranchDepth: link.maxBranchDepth,
        missingTargetCount: link.missingTargetCount,
        sampleRecipeIds: [],
        sampleDescriptorOffsets: [],
      });
    }
    const usage = byRequest.get(link.requestId);
    usage.recipeCount++;
    if (link.recipeKind === 'inline_transition_recipe') usage.inlineTransitionRecipeCount++;
    else usage.zoneRecipeCount++;
    if (usage.sampleRecipeIds.length < 16) usage.sampleRecipeIds.push(link.recipeId);
    if (usage.sampleDescriptorOffsets.length < 16 && link.descriptorOffset) {
      usage.sampleDescriptorOffsets.push(link.descriptorOffset);
    }
  }

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      streamGraphCatalogId,
      taxonomyCatalogId,
      zoneRecipeCatalogId,
      inlineRecipeCatalogId,
    ],
    assetPolicy: 'Metadata only: recipe ids, request ids, graph ids, offsets, counts, region ids, and evidence. No ROM bytes, stream bytes, decoded music, samples, or copyrighted assets are embedded.',
    semantics: {
      linkSource: 'Recipe dependencies.audioRequest.requestId is read from room subrecord byte +17.',
      graphSource: `${streamGraphCatalogId} statically follows request header stream roots plus $F6/$FA stream pointer edges.`,
      caution: 'These links are static graph references for inspection and future playback modeling; they are not frame-accurate PSG/FM playback traces.',
    },
    summary: {
      recipeCount: recipeLinks.length,
      zoneRecipeCount: recipeLinks.filter(link => link.recipeKind === 'zone_recipe').length,
      inlineTransitionRecipeCount: recipeLinks.filter(link => link.recipeKind === 'inline_transition_recipe').length,
      linkedRecipeCount: linkedLinks.length,
      missingGraphRecipeCount: missingLinks.length,
      uniqueLinkedRequestCount: byRequest.size,
      recipesWithBranchingAudioGraph: linkedLinks.filter(link => link.branchEdgeCount > 0).length,
      recipesWithMissingAudioGraphTargets: linkedLinks.filter(link => link.missingTargetCount > 0).length,
      maxReachableStreamsForLinkedRecipe: Math.max(0, ...linkedLinks.map(link => link.reachableStreamCount)),
      maxBranchEdgesForLinkedRecipe: Math.max(0, ...linkedLinks.map(link => link.branchEdgeCount)),
      recipeKindCounts: countBy(recipeLinks, link => link.recipeKind),
    },
    usageByRequest: [...byRequest.values()].sort((a, b) => a.requestId - b.requestId),
    missingGraphRecipes: missingLinks.slice(0, 64),
    evidence: [
      'world-zone-recipe-audit.mjs and world-inline-transition-recipe-audit.mjs preserve the room subrecord audio request byte in recipe dependencies.',
      `${streamGraphCatalogId} provides one static stream graph per _DATA_D139_ audio request table entry.`,
      'All recipe audio request ids used by current zone and inline transition recipes resolve to graph records in the stream graph catalog when missingGraphRecipeCount is zero.',
    ],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const streamGraphCatalog = requireCatalog(mapData, streamGraphCatalogId);
  requireCatalog(mapData, taxonomyCatalogId);
  const graphByRequestId = new Map((streamGraphCatalog.graphs || []).map(graph => [graph.requestId, graph]));
  const recipes = [
    ...(mapData.zoneRecipes || []),
    ...(mapData.inlineTransitionRecipes || []),
  ];
  const recipeLinks = recipes.map(recipe => linkRecipe(recipe, graphByRequestId));
  const catalog = buildCatalog(mapData, recipeLinks);

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_audio_graph_link_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      usageByRequest: catalog.usageByRequest,
      missingGraphRecipes: catalog.missingGraphRecipes,
      evidence: catalog.evidence,
      nextLeads: [
        'Render audio stream graph counts and branch edges in the simulator recipe diagnostics.',
        'Use linked graph ids to build a read-only browser audio stream event preview per recipe without dumping stream bytes.',
        'Trace repeat/return behavior for $F7/$F9/$FB-$FF so static graph links can feed a frame-aware audio interpreter.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    usageByRequest: catalog.usageByRequest,
    missingGraphRecipes: catalog.missingGraphRecipes,
  }, null, 2));
}

main();
