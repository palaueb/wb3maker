#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-residual-live-closure-status-index.local.json');
const catalogId = 'world-residual-live-closure-status-index-catalog-2026-06-26';
const reportId = 'residual-live-closure-status-index-audit-2026-06-26';
const toolName = 'tools/world-residual-live-closure-status-index-audit.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;

const targetRegionIds = ['r2815', 'r2816', 'r2817', 'r2813', 'r0749'];
const sourceCatalogIds = [
  'world-residual-runtime-proof-closure-index-catalog-2026-06-26',
  'world-r2813-overlay-closure-observation-assembler-catalog-2026-06-26',
  'world-palette-tail-closure-capture-coordinator-catalog-2026-06-26',
  'world-r0749-sidecar-closure-observation-assembler-catalog-2026-06-26',
  'world-gearsystem-mcp-callback-capture-plan-catalog-2026-06-26',
  'world-gearsystem-mcp-read-range-hook-binding-catalog-2026-06-26',
  'world-residual-runtime-closure-pipeline-catalog-2026-06-26',
];

const forbiddenCounterNames = [
  'persistedRomByteCount',
  'persistedStreamByteCount',
  'persistedTileIdCount',
  'persistedPaletteByteCount',
  'persistedPortValueCount',
  'persistedRegisterTraceCount',
  'persistedProgramCounterCount',
  'persistedPixelCount',
  'persistedAudioByteCount',
  'persistedInstructionByteCount',
  'persistedHashCount',
];

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
}

function relative(filePath) {
  return filePath ? path.relative(repoRoot, filePath) : null;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value !== null && value !== undefined && value !== ''))].sort();
}

function countBy(values) {
  const counts = {};
  for (const value of values || []) {
    if (!value) continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function forbiddenCounters() {
  return Object.fromEntries(forbiddenCounterNames.map(name => [name, 0]));
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData || {})) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function regionById(mapData, regionId) {
  return (mapData.regions || []).find(region => region.id === regionId) || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    confidence: region.confidence || null,
    name: region.name || null,
  };
}

function recordsByRegion(catalog) {
  return new Map((catalog?.records || catalog?.entries || []).map(record => [
    record.regionId || record.region?.id,
    record,
  ]));
}

function residualFamily(regionId) {
  if (regionId === 'r2813') return 'room_overlay_tail';
  if (['r2815', 'r2816', 'r2817'].includes(regionId)) return 'palette_tail';
  if (regionId === 'r0749') return 'bank7_sidecar';
  return 'unknown_residual';
}

function primaryAudit(region) {
  const analysis = region?.analysis || {};
  if (region?.id === 'r2813') return analysis.r2813OverlayClosureObservationAssemblerAudit || null;
  if (['r2815', 'r2816', 'r2817'].includes(region?.id)) return analysis.paletteTailClosureCaptureCoordinatorAudit || null;
  if (region?.id === 'r0749') return analysis.r0749SidecarClosureObservationAssemblerAudit || null;
  return null;
}

function nextRequiredEvidence(regionId, audit) {
  if (regionId === 'r2813') {
    return 'capture_cf64_index_and_room_overlay_loader_execution_hooks_same_frame';
  }
  if (['r2815', 'r2816', 'r2817'].includes(regionId)) {
    return 'capture_palette_parser_entry_and_physical_source_same_frame';
  }
  if (regionId === 'r0749') {
    return 'find_route_and_capture_bank7_sidecar_execution_read_hooks_same_frame';
  }
  return audit?.completeObservationGroupReady ? 'run_residual_closure_pipeline_review' : 'review_residual_runtime_gate';
}

function priorityBucket(regionId, audit) {
  if (['r2815', 'r2816', 'r2817'].includes(regionId) && audit?.tailHookObservationReady === true) return 1;
  if (regionId === 'r2813' && audit?.readRangeHitObserved === true) return 2;
  if (regionId === 'r0749') return 3;
  return 4;
}

function shortCommands(audit) {
  const commands = audit?.commands || {};
  return Object.fromEntries(Object.entries(commands).filter(([key]) => [
    'callbackAwareMacroMonitor',
    'captureParserEntry',
    'capturePhysicalSource',
    'assembleClosure',
    'validateClosureObservations',
    'runClosurePipeline',
    'generateTemplate',
  ].includes(key)));
}

function pipelineStatus(region) {
  const audit = region?.analysis?.residualRuntimeClosurePipelineAudit || {};
  return {
    status: audit.status || null,
    realMapMutatedByThisPipeline: audit.realMapMutatedByThisPipeline === true,
    semanticDispositionMutatedByThisPipeline: audit.semanticDispositionMutatedByThisPipeline === true,
    coverageChangedByThisPipeline: audit.coverageChangedByThisPipeline === true,
  };
}

function buildRegionRecord(mapData, lookups, regionId) {
  const region = regionById(mapData, regionId);
  const audit = primaryAudit(region);
  const callbackPlan = lookups.callbackByRegion.get(regionId) || region?.analysis?.gearsystemMcpCallbackCapturePlanAudit || null;
  const readRange = lookups.readRangeByRegion.get(regionId) || region?.analysis?.gearsystemMcpReadRangeHookBindingAudit || null;
  const staticClosure = lookups.staticClosureByRegion.get(regionId) || region?.analysis?.residualRuntimeProofClosureIndexAudit || null;
  const blockedReasons = uniqueSorted(audit?.blockedReasons || []);
  const closureReady = audit?.completeObservationGroupReady === true || audit?.closureReady === true;
  const outputCandidateOnly = audit?.outputCandidateOnly !== false || closureReady === false;
  const status = audit?.status || audit?.closureStatus || 'residual_live_closure_status_missing';
  const nextAction = nextRequiredEvidence(regionId, audit);
  return {
    region: compactRegion(region) || { id: regionId },
    residualFamily: residualFamily(regionId),
    status,
    liveClosureStatus: closureReady
      ? 'live_observation_group_ready_for_pipeline_review'
      : 'waiting_for_live_runtime_evidence',
    nextRequiredEvidence: nextAction,
    priorityBucket: priorityBucket(regionId, audit),
    closureReady,
    semanticPromotionReady: false,
    outputCandidateOnly,
    completeObservationGroupReady: audit?.completeObservationGroupReady === true,
    blockedReasons,
    firstBlockedReason: blockedReasons[0] || null,
    readRangeStatus: readRange?.status || null,
    readRangeHitObserved: readRange?.readRangeHitObserved === true,
    readRangeUnbound: readRange?.unbound === true || audit?.readRangeUnbound === true,
    callbackCapturePlanStatus: callbackPlan?.status || null,
    callbackRemainingRequiredFieldCount: callbackPlan?.remainingRequiredFieldCount ?? audit?.callbackRemainingRequiredFieldCount ?? null,
    callbackWaitingForRouteTaskCount: callbackPlan?.waitingForRouteTaskCount ?? audit?.callbackWaitingForRouteTaskCount ?? null,
    staticClosureStatus: staticClosure?.closureStatus || null,
    defaultDecoderExcluded: staticClosure?.defaultDecoderExcluded === true,
    pipeline: pipelineStatus(region),
    commandKeys: Object.keys(shortCommands(audit)),
    commands: shortCommands(audit),
    evidence: [
      audit?.catalogId ? `${audit.catalogId} supplies the current per-region live closure status.` : 'No per-region live closure assembler/coordinator audit was found.',
      callbackPlan?.catalogId ? `${callbackPlan.catalogId} supplies callback task readiness and remaining field counts.` : null,
      readRange?.catalogId ? `${readRange.catalogId} supplies read-range reachability and hook-binding status.` : null,
      staticClosure?.catalogId ? `${staticClosure.catalogId} keeps the residual excluded from default decoders until runtime proof exists.` : null,
      'Candidate-only outputs are not treated as runtime proof and cannot mutate residual semantic disposition.',
    ].filter(Boolean),
  };
}

export function buildCatalog(mapData) {
  const catalogs = Object.fromEntries(sourceCatalogIds.map(id => [id, findCatalog(mapData, id)]));
  const lookups = {
    callbackByRegion: recordsByRegion(catalogs['world-gearsystem-mcp-callback-capture-plan-catalog-2026-06-26']),
    readRangeByRegion: recordsByRegion(catalogs['world-gearsystem-mcp-read-range-hook-binding-catalog-2026-06-26']),
    staticClosureByRegion: recordsByRegion(catalogs['world-residual-runtime-proof-closure-index-catalog-2026-06-26']),
  };
  const records = targetRegionIds.map(regionId => buildRegionRecord(mapData, lookups, regionId))
    .sort((a, b) => (a.priorityBucket - b.priorityBucket) || a.region.id.localeCompare(b.region.id));
  const blockedReasons = records.flatMap(record => record.blockedReasons || []);
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    eventKind: 'wb3_residual_live_closure_status_index',
    sourceCatalogs: sourceCatalogIds.filter(id => catalogs[id]),
    missingSourceCatalogs: sourceCatalogIds.filter(id => !catalogs[id]),
    assetPolicy: 'Metadata only: region ids, offsets, types, statuses, hook/capture command names, command strings, blocker labels, counts, booleans, and evidence summaries. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, program counters, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      residualRegionCount: records.length,
      liveClosureReadyCount: records.filter(record => record.closureReady).length,
      waitingForLiveEvidenceCount: records.filter(record => !record.closureReady).length,
      outputCandidateOnlyCount: records.filter(record => record.outputCandidateOnly).length,
      semanticPromotionReadyCount: 0,
      readRangeHitObservedCount: records.filter(record => record.readRangeHitObserved).length,
      unboundReadRangeHitCount: records.filter(record => record.readRangeHitObserved && record.readRangeUnbound).length,
      defaultDecoderExcludedCount: records.filter(record => record.defaultDecoderExcluded).length,
      candidateOnlyPipelineRejectedCount: records.filter(record => record.pipeline.status === 'blocked_candidate_only_input_not_runtime_evidence').length,
      pipelineMapMutationCount: records.filter(record => record.pipeline.realMapMutatedByThisPipeline).length,
      familyCounts: countBy(records.map(record => record.residualFamily)),
      nextRequiredEvidenceCounts: countBy(records.map(record => record.nextRequiredEvidence)),
      blockedReasonCounts: countBy(blockedReasons),
      priorityOrderRegionIds: records.map(record => record.region.id),
      missingSourceCatalogCount: sourceCatalogIds.filter(id => !catalogs[id]).length,
      missingSourceCatalogs: sourceCatalogIds.filter(id => !catalogs[id]),
      ...forbiddenCounters(),
    },
    records,
    evidence: [
      'This index joins the current per-residual live closure assemblers/coordinators with callback, read-range, and static closure metadata.',
      'It is a status and routing catalog only; residual type, confidence, and proof metadata are not promoted by this tool.',
      'All five residuals remain blocked on reviewed same-frame runtime evidence before semantic promotion.',
    ],
    nextLeads: [
      'Close r2815-r2817 first: their tail hooks and read ranges are already reached, but parser-entry and physical-source same-frame evidence are missing.',
      'Close r2813 through the accepted CF64 indexed overlay execution-hook path; keep its unbound read-range hit reachability-only.',
      'Find a route/save-state for r0749 that hits the bank-7 sidecar controller, alias loader, and direct watch in the same frame trace group.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = regionById(mapData, record.region.id);
    if (!region) {
      missingRegions.push({ id: record.region.id, role: 'residual_live_closure_status_target' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.residualLiveClosureStatusIndexAudit = {
      catalogId,
      kind: 'residual_live_closure_status_index',
      status: record.status,
      liveClosureStatus: record.liveClosureStatus,
      nextRequiredEvidence: record.nextRequiredEvidence,
      priorityBucket: record.priorityBucket,
      closureReady: record.closureReady,
      semanticPromotionReady: false,
      outputCandidateOnly: record.outputCandidateOnly,
      blockedReasons: record.blockedReasons,
      readRangeStatus: record.readRangeStatus,
      readRangeHitObserved: record.readRangeHitObserved,
      readRangeUnbound: record.readRangeUnbound,
      callbackCapturePlanStatus: record.callbackCapturePlanStatus,
      callbackRemainingRequiredFieldCount: record.callbackRemainingRequiredFieldCount,
      callbackWaitingForRouteTaskCount: record.callbackWaitingForRouteTaskCount,
      staticClosureStatus: record.staticClosureStatus,
      defaultDecoderExcluded: record.defaultDecoderExcluded,
      commandKeys: record.commandKeys,
      summary: 'Unified residual live-closure status; residual remains excluded from semantic promotion until same-frame runtime proof passes closure review.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      status: record.status,
      liveClosureStatus: record.liveClosureStatus,
      nextRequiredEvidence: record.nextRequiredEvidence,
      priorityBucket: record.priorityBucket,
      closureReady: record.closureReady,
      outputCandidateOnly: record.outputCandidateOnly,
    });
  }

  mapData.residualLiveClosureStatusCatalogs = (mapData.residualLiveClosureStatusCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.residualLiveClosureStatusCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'residual_live_closure_status_index_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    missingSourceCatalogs: catalog.missingSourceCatalogs,
    summary: {
      ...catalog.summary,
      changedRegionCount: changedRegions.length,
      missingRegionCount: missingRegions.length,
    },
    changedRegions,
    missingRegions,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
    assetPolicy: catalog.assetPolicy,
  });
  mapData.updatedAt = now;
  return { changedRegions, missingRegions };
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.residualLiveClosureStatusCatalog = catalogId;
  staticMap.summary.residualLiveClosureStatusRegionCount = catalog.summary.residualRegionCount;
  staticMap.summary.residualLiveClosureStatusReadyCount = catalog.summary.liveClosureReadyCount;
  staticMap.summary.residualLiveClosureStatusWaitingForLiveEvidenceCount = catalog.summary.waitingForLiveEvidenceCount;
  staticMap.summary.residualLiveClosureStatusOutputCandidateOnlyCount = catalog.summary.outputCandidateOnlyCount;
  staticMap.summary.residualLiveClosureStatusReadRangeHitObservedCount = catalog.summary.readRangeHitObservedCount;
  staticMap.summary.residualLiveClosureStatusUnboundReadRangeHitCount = catalog.summary.unboundReadRangeHitCount;
  staticMap.summary.residualLiveClosureStatusPriorityOrderRegionIds = catalog.summary.priorityOrderRegionIds;
  staticMap.summary.residualLiveClosureStatusNextRequiredEvidenceCounts = catalog.summary.nextRequiredEvidenceCounts;
  staticMap.summary.residualLiveClosureStatusBlockedReasonCounts = catalog.summary.blockedReasonCounts;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`residualLiveClosureStatus${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-residual-live-closure-status-index-catalog-2026-06-26 as the current priority queue for the five runtime-proof-blocked residuals.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (!noWrite) writeJson(outputPath, catalog);
  let annotation = { changedRegions: [], missingRegions: [] };
  if (apply) {
    annotation = applyCatalog(mapData, catalog);
    if (!noWrite) {
      writeJson(mapPath, mapData);
      updateStaticMap(catalog);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    applied: apply,
    output: noWrite ? null : relative(outputPath),
    catalogId,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    assetPolicy: catalog.assetPolicy,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      ...forbiddenCounters(),
    }, null, 2));
    process.exitCode = 1;
  }
}
