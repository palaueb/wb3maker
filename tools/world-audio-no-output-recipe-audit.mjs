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
const toolName = 'tools/world-audio-no-output-recipe-audit.mjs';
const catalogId = 'world-audio-no-output-recipe-classification-catalog-2026-06-26';
const reportId = 'audio-no-output-recipe-classification-audit-2026-06-26';
const sourceReportId = 'audio-runtime-output-channel-port-trace-link-full-sweep-browser-smoke-2026-06-26';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function hex(value, pad = 2) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item) || 'unclassified';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function findReport(mapData, id) {
  return (mapData.analysisReports || []).find(report => report?.id === id) || null;
}

function allRecipes(mapData) {
  return [
    ...(mapData.zoneRecipes || []),
    ...(mapData.inlineTransitionRecipes || []),
  ];
}

function recipeKind(recipe) {
  return recipe?.recipeType === 'inline_transition_room_zone_render'
    ? 'inline_transition_recipe'
    : 'zone_recipe';
}

function classifyNoOutputRecipe(recipe) {
  const audio = recipe?.dependencies?.audioRequest || {};
  const taxonomy = audio.taxonomy || {};
  const classification = taxonomy.classification || {};
  const graph = audio.streamGraph || {};
  const requestId = Number.isInteger(audio.requestId) ? audio.requestId : null;
  const requestIdHex = audio.requestIdHex || (requestId == null ? '' : hex(requestId, 2));
  const classKind = classification.kind || '';
  const graphResolved = Boolean(audio.streamGraphResolved || graph.graphId);

  let status = 'preview_window_no_output_unclassified';
  let confidence = 'medium';
  let reason = 'Audio-backed recipe produced no output-register phases in the current analyzer preview window.';
  if (!graphResolved) {
    status = 'missing_stream_graph_linkage';
    reason = 'Recipe has an audio request but no resolved stream graph reference.';
  } else if (Number(graph.missingTargetCount || 0) > 0) {
    status = 'stream_graph_missing_target';
    reason = 'Resolved stream graph still has missing branch targets.';
  } else if (requestId === 0 && classKind === 'all_channel_silence_request') {
    status = 'confirmed_silence_request_preview_empty';
    confidence = 'high';
    reason = 'Request 0x00 is classified as all_channel_silence_request and the full preview sweep correctly produced no output-register phases.';
  } else if (String(classKind).includes('silence')) {
    status = 'silence_like_request_preview_empty';
    confidence = 'high';
    reason = 'Audio request taxonomy marks this request as silence-like and the preview produced no output-register phases.';
  }

  return {
    recipeId: recipe.id || '',
    recipeKind: recipeKind(recipe),
    descriptorOffset: recipe.descriptor?.romOffset || '',
    audioRequestId: requestId,
    audioRequestIdHex: requestIdHex,
    audioClassification: classKind,
    audioClassificationConfidence: classification.confidence || '',
    audioHeaderOffset: taxonomy.headerOffset || '',
    streamGraphId: graph.graphId || '',
    streamGraphResolved: graphResolved,
    reachableStreamCount: Number(graph.reachableStreamCount || 0),
    branchEdgeCount: Number(graph.branchEdgeCount || 0),
    missingTargetCount: Number(graph.missingTargetCount || 0),
    status,
    confidence,
    reason,
    evidence: [
      `${sourceReportId} classified this recipe as no-output in the full analyzer sweep.`,
      `Recipe audio request is ${requestIdHex || 'unknown'} from dependencies.audioRequest.`,
      classKind
        ? `Audio request taxonomy classifies the request as ${classKind} (${classification.confidence || 'confidence unknown'}).`
        : 'Audio request taxonomy classification is missing.',
      graph.graphId
        ? `Resolved stream graph ${graph.graphId} has ${Number(graph.reachableStreamCount || 0)} reachable stream(s), ${Number(graph.branchEdgeCount || 0)} branch edge(s), and ${Number(graph.missingTargetCount || 0)} missing target(s).`
        : 'No stream graph was resolved for this recipe.',
    ],
  };
}

function buildCatalog(mapData) {
  const sourceReport = findReport(mapData, sourceReportId);
  if (!sourceReport) throw new Error(`Missing source report ${sourceReportId}`);
  const recipeById = new Map(allRecipes(mapData).map(recipe => [recipe.id, recipe]));
  const noOutputRecipeIds = sourceReport.noOutputRecipeIds || [];
  const classifications = noOutputRecipeIds.map(recipeId => {
    const recipe = recipeById.get(recipeId);
    if (!recipe) {
      return {
        recipeId,
        status: 'missing_recipe_metadata',
        confidence: 'low',
        reason: 'Source report references a recipe id not present in current map.json.',
        evidence: [`${sourceReportId} listed this recipe id as no-output.`],
      };
    }
    return classifyNoOutputRecipe(recipe);
  });
  const statusCounts = countBy(classifications, item => item.status);
  const requestCounts = countBy(classifications, item => item.audioRequestIdHex || 'unknown');
  const classificationCounts = countBy(classifications, item => item.audioClassification || 'unclassified');
  const highConfidenceCount = classifications.filter(item => item.confidence === 'high').length;
  const confirmedSilenceCount = classifications.filter(item => item.status === 'confirmed_silence_request_preview_empty').length;
  return {
    id: catalogId,
    schemaVersion: 1,
    kind: 'audio_no_output_recipe_classification',
    generatedAt: now,
    tool: toolName,
    sourceReportId,
    sourceSweepMode: sourceReport.sweepMode || '',
    assetPolicy: 'metadata_only_no_rom_bytes_no_stream_bytes_no_opcodes_no_port_values_no_register_values_no_register_traces_no_samples_no_audio_bytes',
    summary: {
      fullSweepRecipeCount: sourceReport.fullSweepRecipeCount || sourceReport.counts?.fullSweepRecipeCount || 0,
      outputReadyRecipeCount: sourceReport.outputReadyRecipeCount || sourceReport.counts?.outputReadyRecipeCount || 0,
      noOutputRecipeCount: classifications.length,
      confirmedSilenceRecipeCount: confirmedSilenceCount,
      highConfidenceClassificationCount: highConfidenceCount,
      statusCounts,
      requestCounts,
      audioClassificationCounts: classificationCounts,
      missingRecipeMetadataCount: classifications.filter(item => item.status === 'missing_recipe_metadata').length,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedOpcodeCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
    },
    classifications,
    evidence: [
      `${sourceReportId} swept ${sourceReport.fullSweepRecipeCount || sourceReport.counts?.fullSweepRecipeCount || 0} audio-backed zone/inline recipe(s) through the analyzer UI.`,
      `${sourceReportId} reported ${classifications.length} no-output recipe(s) and ${(sourceReport.outputReadyRecipeCount || sourceReport.counts?.outputReadyRecipeCount || 0)} output-ready recipe(s).`,
      `${confirmedSilenceCount}/${classifications.length} no-output recipe(s) resolve to request 0x00 with taxonomy kind all_channel_silence_request.`,
      'Each classification stores recipe ids, request ids, offsets, taxonomy labels, graph ids, counts, and evidence strings only.',
    ],
    limitations: [
      'The classification is derived from the analyzer preview window and static audio request taxonomy; it does not execute the original Z80 sound driver.',
      'confirmed_silence_request_preview_empty means the preview correctly produced no output phases for a taxonomy-backed silence request, not that every runtime path has been emulated.',
    ],
    nextLeads: [
      'Trace request 0x00 in the original driver to document exact all-channel silence side effects.',
      'Promote silence/deferred-audio handling into the future PSG/FM runtime harness.',
      'Keep no-output classifications in sync when the preview window or stream execution depth changes.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalog.id);
  mapData.audioCatalogs.push(catalog);
  const byId = new Map(catalog.classifications.map(item => [item.recipeId, item]));
  for (const recipe of allRecipes(mapData)) {
    const item = byId.get(recipe.id);
    if (!item) continue;
    if (!recipe.dependencies) recipe.dependencies = {};
    if (!recipe.dependencies.audioRequest) recipe.dependencies.audioRequest = {};
    recipe.dependencies.audioRequest.noOutputPreviewClassification = {
      catalogId,
      sourceReportId,
      status: item.status,
      confidence: item.confidence,
      reason: item.reason,
      audioClassification: item.audioClassification,
      streamGraphId: item.streamGraphId,
      generatedAt: now,
      tool: toolName,
    };
  }
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'metadata_audit',
    domain: 'audio_no_output_recipe_classification',
    generatedAt: now,
    tool: toolName,
    catalogId,
    sourceReportId,
    confidence: catalog.summary.missingRecipeMetadataCount ? 'medium' : 'high',
    summary: `${catalog.summary.noOutputRecipeCount} full-sweep no-output recipe(s) classified; ${catalog.summary.confirmedSilenceRecipeCount} are request 0x00 all-channel silence previews.`,
    counts: catalog.summary,
    noOutputRecipeIds: catalog.classifications.map(item => item.recipeId),
    assetPolicy: catalog.assetPolicy,
    evidence: catalog.evidence,
    limitations: catalog.limitations,
  });
}

const mapData = readJson(mapPath);
const catalog = buildCatalog(mapData);
if (apply) {
  applyCatalog(mapData, catalog);
  writeJson(mapPath, mapData);
}

console.log(JSON.stringify({
  ok: true,
  applied: apply,
  catalogId,
  reportId,
  summary: catalog.summary,
  classifications: catalog.classifications.map(item => ({
    recipeId: item.recipeId,
    audioRequestIdHex: item.audioRequestIdHex,
    audioClassification: item.audioClassification,
    status: item.status,
    confidence: item.confidence,
    streamGraphId: item.streamGraphId,
  })),
}, null, 2));
