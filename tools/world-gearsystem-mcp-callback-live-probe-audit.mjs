#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-callback-live-probe.local.json');
const callbackCapturePlanCatalogId = 'world-gearsystem-mcp-callback-capture-plan-catalog-2026-06-26';
const catalogId = 'world-gearsystem-mcp-callback-live-probe-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-callback-live-probe-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-callback-live-probe-audit.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;

const targetRegionIds = ['r2813', 'r2815', 'r2816', 'r2817', 'r0749'];
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
  return path.relative(repoRoot, filePath);
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData || {})) {
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

function reportPathForRegion(regionId) {
  return path.join(repoRoot, `tmp/world-gearsystem-mcp-macro-monitor.${regionId}.callback-plan.local.json`);
}

function forbiddenCountersFromSummary(summary = {}) {
  return Object.fromEntries(forbiddenCounterNames.map(name => [name, Number(summary[name] || 0)]));
}

function reportByteClean(summary = {}) {
  return Object.values(forbiddenCountersFromSummary(summary)).every(count => count === 0);
}

function compactTask(task = {}) {
  return {
    regionId: task.regionId || null,
    hookId: task.hookId || null,
    operationKind: task.operationKind || null,
    status: task.status || null,
    operationIds: task.operationIds || [],
    requiredFields: task.requiredFields || [],
    remainingCallbackFields: task.remainingCallbackFields || [],
    remainingDerivationFields: task.remainingDerivationFields || [],
    candidateFilledFields: task.candidateFilledFields || [],
    candidateOnly: task.candidateOnly === true,
    canWriteRuntimeObservationNow: task.canWriteRuntimeObservationNow === true,
    closureReady: false,
    semanticPromotionReady: false,
  };
}

function compactHit(hit = {}) {
  return {
    routeId: hit.routeId || null,
    matchKind: hit.matchKind || null,
    matchedOperationIds: hit.matchedOperationIds || [],
    matchedRegionIds: hit.matchedRegionIds || [],
    matchedHookIds: hit.matchedHookIds || [],
    matchedLabels: hit.matchedLabels || [],
    matchedHookBreakpointRoles: hit.matchedHookBreakpointRoles || [],
    matchedRequiredCaptureFields: hit.matchedRequiredCaptureFields || [],
    matchedCallbackCaptureTaskCount: Number(hit.matchedCallbackCaptureTaskCount || 0),
    matchedRemainingCallbackFields: hit.matchedRemainingCallbackFields || [],
    matchedRemainingDerivationFields: hit.matchedRemainingDerivationFields || [],
    matchedCallbackCaptureTasks: (hit.matchedCallbackCaptureTasks || []).map(compactTask),
    captureFieldValuePersistence: hit.captureFieldValuePersistence || 'field_names_only_values_not_persisted',
  };
}

function statusForRecord(record) {
  if (!record.reportExists) return 'live_probe_report_missing';
  if (!record.macroMonitorUsable || !record.byteClean) return 'live_probe_report_not_usable';
  if (record.breakpointHitCount === 0) return 'live_probe_no_hit_on_starter_route';
  if (record.callbackCapturePlanMatchedTaskCount > 0) return 'live_probe_callback_task_matched_missing_callback_values';
  if (record.matchedReadRangeInferenceHitCount > 0) return 'live_probe_read_range_reached_no_callback_task_match';
  return 'live_probe_hit_without_callback_plan_match';
}

function compactRegionReport(regionId) {
  const filePath = reportPathForRegion(regionId);
  if (!fs.existsSync(filePath)) {
    return {
      regionId,
      reportPath: relative(filePath),
      reportExists: false,
      status: 'live_probe_report_missing',
      byteClean: false,
      macroMonitorUsable: false,
      breakpointHitCount: 0,
      matchedExecutionHitCount: 0,
      matchedReadRangeInferenceHitCount: 0,
      callbackCapturePlanMatchedHitCount: 0,
      callbackCapturePlanMatchedTaskCount: 0,
      matchedRemainingCallbackFields: [],
      matchedOperationIds: [],
      matchedHookIds: [],
      hits: [],
      evidence: [`${relative(filePath)} is missing; no live probe metadata was available.`],
    };
  }

  const report = readJson(filePath);
  const summary = report.summary || {};
  const hits = (report.routeReports || []).flatMap(route => (route.hitSnapshots || []).map(compactHit));
  const record = {
    regionId,
    reportPath: relative(filePath),
    reportExists: true,
    reportEventKind: report.eventKind || null,
    sourceCallbackCapturePlanCatalog: report.sourceCallbackCapturePlanCatalog || summary.callbackCapturePlanCatalogId || null,
    routeIds: uniqueSorted((report.routeReports || []).map(route => route.route?.id)),
    byteClean: reportByteClean(summary),
    forbiddenCounters: forbiddenCountersFromSummary(summary),
    macroMonitorUsable: summary.macroMonitorUsable === true,
    setupBreakpoints: summary.setupBreakpoints === true,
    clearExistingBreakpoints: summary.clearExistingBreakpoints === true,
    resetBeforeRoute: summary.resetBeforeRoute === true,
    operationFilterRegionIds: summary.operationFilterRegionIds || [],
    operationFilterOperationIds: summary.operationFilterOperationIds || [],
    breakpointHitCount: Number(summary.breakpointHitCount || 0),
    matchedExecutionHitCount: Number(summary.matchedExecutionHitCount || 0),
    matchedReadRangeInferenceHitCount: Number(summary.matchedReadRangeInferenceHitCount || 0),
    unmatchedBreakpointHitCount: Number(summary.unmatchedBreakpointHitCount || 0),
    callbackCapturePlanLoaded: summary.callbackCapturePlanLoaded === true,
    callbackCapturePlanMatchedHitCount: Number(summary.callbackCapturePlanMatchedHitCount || 0),
    callbackCapturePlanMatchedTaskCount: Number(summary.callbackCapturePlanMatchedTaskCount || 0),
    matchedRemainingCallbackFields: summary.callbackCapturePlanMatchedRemainingCallbackFields || [],
    matchedOperationIds: uniqueSorted(hits.flatMap(hit => hit.matchedOperationIds || [])),
    matchedHookIds: uniqueSorted(hits.flatMap(hit => hit.matchedHookIds || [])),
    matchedLabels: uniqueSorted(hits.flatMap(hit => hit.matchedLabels || [])),
    matchedHookBreakpointRoles: uniqueSorted(hits.flatMap(hit => hit.matchedHookBreakpointRoles || [])),
    matchedRequiredCaptureFields: uniqueSorted(hits.flatMap(hit => hit.matchedRequiredCaptureFields || [])),
    matchedCallbackTaskStatuses: uniqueSorted(hits.flatMap(hit =>
      (hit.matchedCallbackCaptureTasks || []).map(task => task.status))),
    hits,
    closureReady: false,
    semanticPromotionReady: false,
  };
  record.status = statusForRecord(record);
  record.evidence = [
    `${record.reportPath} is a callback-aware Gearsystem MCP macro-monitor report generated from a local run.`,
    record.byteClean
      ? 'The report summary has all forbidden persisted payload counters at zero.'
      : 'The report summary is not byte-clean and must not be used as evidence.',
    record.callbackCapturePlanMatchedTaskCount
      ? 'The report matched callback-capture plan tasks by operation id and hook id, but it still stores field names only, not field values.'
      : 'The report did not match a callback-capture task; treat it as route/read-range reachability only.',
  ];
  return record;
}

function buildCatalog(mapData) {
  const callbackPlanCatalog = requireCatalog(mapData, callbackCapturePlanCatalogId);
  const records = targetRegionIds.map(compactRegionReport);
  const usableRecords = records.filter(record => record.reportExists && record.macroMonitorUsable && record.byteClean);
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [callbackCapturePlanCatalogId],
    sourceLocalReports: records.map(record => record.reportPath),
    eventKind: 'wb3_gearsystem_mcp_callback_live_probe',
    liveProbeOnly: true,
    assetPolicy: 'Metadata only: region ids, hook ids, operation ids, labels, route ids, hit counts, field names, task statuses, booleans, and local report paths. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, program counters from traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      residualRegionCount: targetRegionIds.length,
      liveProbeReportCount: records.filter(record => record.reportExists).length,
      usableLiveProbeReportCount: usableRecords.length,
      byteCleanLiveProbeReportCount: records.filter(record => record.byteClean).length,
      missingLiveProbeReportCount: records.filter(record => !record.reportExists).length,
      readRangeHitRegionCount: records.filter(record => record.matchedReadRangeInferenceHitCount > 0).length,
      executionHitRegionCount: records.filter(record => record.matchedExecutionHitCount > 0).length,
      callbackTaskMatchedRegionCount: records.filter(record => record.callbackCapturePlanMatchedTaskCount > 0).length,
      noHitRegionCount: records.filter(record => record.reportExists && record.breakpointHitCount === 0).length,
      reachabilityOnlyRegionCount: records.filter(record =>
        record.breakpointHitCount > 0 && record.callbackCapturePlanMatchedTaskCount === 0).length,
      totalBreakpointHitCount: records.reduce((sum, record) => sum + record.breakpointHitCount, 0),
      totalMatchedReadRangeInferenceHitCount: records.reduce((sum, record) => sum + record.matchedReadRangeInferenceHitCount, 0),
      totalMatchedExecutionHitCount: records.reduce((sum, record) => sum + record.matchedExecutionHitCount, 0),
      totalCallbackCapturePlanMatchedTaskCount: records.reduce((sum, record) => sum + record.callbackCapturePlanMatchedTaskCount, 0),
      callbackMatchedRegionIds: records.filter(record => record.callbackCapturePlanMatchedTaskCount > 0).map(record => record.regionId),
      readRangeOnlyRegionIds: records
        .filter(record => record.breakpointHitCount > 0 && record.callbackCapturePlanMatchedTaskCount === 0)
        .map(record => record.regionId),
      noHitRegionIds: records.filter(record => record.reportExists && record.breakpointHitCount === 0).map(record => record.regionId),
      matchedOperationIds: uniqueSorted(records.flatMap(record => record.matchedOperationIds || [])),
      matchedHookIds: uniqueSorted(records.flatMap(record => record.matchedHookIds || [])),
      matchedRemainingCallbackFields: uniqueSorted(records.flatMap(record => record.matchedRemainingCallbackFields || [])),
      runtimeObservationReadyCount: 0,
      closureReadyCount: 0,
      semanticPromotionReadyCount: 0,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedProgramCounterCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    records,
    commands: {
      runR2815: 'node tools/world-gearsystem-mcp-macro-monitor.mjs --execute --setup --clear-existing --reset --route boot_start_idle_probe --region r2815 --port 7777 --out tmp/world-gearsystem-mcp-macro-monitor.r2815.callback-plan.local.json',
      runR2816: 'node tools/world-gearsystem-mcp-macro-monitor.mjs --execute --setup --clear-existing --reset --route boot_start_idle_probe --region r2816 --port 7777 --out tmp/world-gearsystem-mcp-macro-monitor.r2816.callback-plan.local.json',
      runR2817: 'node tools/world-gearsystem-mcp-macro-monitor.mjs --execute --setup --clear-existing --reset --route boot_start_idle_probe --region r2817 --port 7777 --out tmp/world-gearsystem-mcp-macro-monitor.r2817.callback-plan.local.json',
      runThisAudit: `node ${toolName}`,
      applyThisAudit: `node ${toolName} --apply`,
    },
    evidence: [
      `${callbackPlanCatalog.id} defines the callback tasks and remaining allowed field names.`,
      'The live probe reports were produced by tools/world-gearsystem-mcp-macro-monitor.mjs and summarize matched breakpoints without persisted runtime values.',
      'A matched callback task is a proof obligation pointer only; closure still requires reviewed local observations with real allowed field values.',
    ],
    nextLeads: [
      'Implement debugger callback value capture for active_bank, consumer_label, and cursor_offset on r2815-r2817 read-range hits.',
      'Seed a route or save-state that reaches r2813 execution hooks instead of only the r2813 read-range tail.',
      'Seed a route or save-state that reaches r0749 bank-7 sidecar execution/read hooks.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'gearsystem_mcp_callback_live_probe' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpCallbackLiveProbeAudit = {
      catalogId,
      kind: 'gearsystem_mcp_callback_live_probe',
      status: record.status,
      liveProbeOnly: true,
      reportPath: record.reportPath,
      byteClean: record.byteClean,
      macroMonitorUsable: record.macroMonitorUsable,
      breakpointHitCount: record.breakpointHitCount,
      matchedExecutionHitCount: record.matchedExecutionHitCount,
      matchedReadRangeInferenceHitCount: record.matchedReadRangeInferenceHitCount,
      callbackCapturePlanMatchedHitCount: record.callbackCapturePlanMatchedHitCount,
      callbackCapturePlanMatchedTaskCount: record.callbackCapturePlanMatchedTaskCount,
      matchedOperationIds: record.matchedOperationIds,
      matchedHookIds: record.matchedHookIds,
      matchedRemainingCallbackFields: record.matchedRemainingCallbackFields,
      matchedCallbackTaskStatuses: record.matchedCallbackTaskStatuses,
      runtimeObservationReady: false,
      closureReady: false,
      semanticPromotionReady: false,
      summary: 'Callback-aware live probe evidence; records breakpoint/task reachability and remaining field names only, not runtime field values.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      status: record.status,
      breakpointHitCount: record.breakpointHitCount,
      callbackCapturePlanMatchedTaskCount: record.callbackCapturePlanMatchedTaskCount,
    });
  }

  mapData.gearsystemMcpCallbackLiveProbeCatalogs = (mapData.gearsystemMcpCallbackLiveProbeCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpCallbackLiveProbeCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_callback_live_probe_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceLocalReports: catalog.sourceLocalReports,
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
  staticMap.summary.gearsystemMcpCallbackLiveProbeCatalog = catalogId;
  staticMap.summary.gearsystemMcpCallbackLiveProbeReportCount = catalog.summary.liveProbeReportCount;
  staticMap.summary.gearsystemMcpCallbackLiveProbeUsableReportCount = catalog.summary.usableLiveProbeReportCount;
  staticMap.summary.gearsystemMcpCallbackLiveProbeByteCleanReportCount = catalog.summary.byteCleanLiveProbeReportCount;
  staticMap.summary.gearsystemMcpCallbackLiveProbeReadRangeHitRegionCount = catalog.summary.readRangeHitRegionCount;
  staticMap.summary.gearsystemMcpCallbackLiveProbeCallbackTaskMatchedRegionCount = catalog.summary.callbackTaskMatchedRegionCount;
  staticMap.summary.gearsystemMcpCallbackLiveProbeNoHitRegionCount = catalog.summary.noHitRegionCount;
  staticMap.summary.gearsystemMcpCallbackLiveProbeReachabilityOnlyRegionCount = catalog.summary.reachabilityOnlyRegionCount;
  staticMap.summary.gearsystemMcpCallbackLiveProbeMatchedRemainingCallbackFields = catalog.summary.matchedRemainingCallbackFields;
  staticMap.summary.gearsystemMcpCallbackLiveProbeRuntimeObservationReadyCount = catalog.summary.runtimeObservationReadyCount;
  staticMap.summary.gearsystemMcpCallbackLiveProbeClosureReadyCount = catalog.summary.closureReadyCount;
  staticMap.summary.gearsystemMcpCallbackLiveProbeSemanticPromotionReadyCount = catalog.summary.semanticPromotionReadyCount;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`gearsystemMcpCallbackLiveProbe${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-callback-live-probe-catalog-2026-06-26 to prioritize real callback value capture for r2815-r2817 before residual closure.';
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
  let result = { changedRegions: [], missingRegions: [] };
  if (apply) {
    result = applyCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }
  console.log(JSON.stringify({
    ok: true,
    applied: apply,
    output: noWrite ? null : relative(outputPath),
    catalogId,
    summary: catalog.summary,
    changedRegions: result.changedRegions,
    missingRegions: result.missingRegions,
    assetPolicy: catalog.assetPolicy,
  }, null, 2));
}

main();
