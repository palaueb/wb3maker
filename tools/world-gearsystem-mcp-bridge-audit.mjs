#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const binaryPath = path.join(repoRoot, 'gearsystem/Gearsystem-3.9.10-desktop-ubuntu24.04-x64/gearsystem');
const symbolPath = path.join(repoRoot, 'gearsystem/wb3-world.sym');
const symbolManifestPath = path.join(repoRoot, 'gearsystem/wb3-world-symbols.manifest.json');
const tracePlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-trace-plan.json');
const setupPlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-setup-plan.json');
const setupReportPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-residual-setup.local.json');
const hitMonitorPlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-hit-monitor-plan.json');
const hitMonitorReportPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-hit-monitor.local.json');
const macroMonitorPlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-macro-monitor-plan.json');
const macroMonitorReportPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-macro-monitor.local.json');
const localReportDir = path.join(repoRoot, 'tmp');
const localSdlRuntimeDir = path.join(repoRoot, 'gearsystem/sdl3-runtime/lib');
const localSdlRuntimeLib = path.join(localSdlRuntimeDir, 'libSDL3.so.0');
const catalogId = 'world-gearsystem-mcp-bridge-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-bridge-audit-2026-06-26';
const eventContractCatalogId = 'world-residual-runtime-trace-event-contract-catalog-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-bridge-audit.mjs';
const now = '2026-06-26T00:00:00Z';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function relative(filePath) {
  return path.relative(repoRoot, filePath);
}

function fileStatus(filePath) {
  if (!fs.existsSync(filePath)) return { path: relative(filePath), exists: false, sizeBytes: 0 };
  const stat = fs.statSync(filePath);
  return { path: relative(filePath), exists: true, sizeBytes: stat.size };
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function localMacroRegionReportPaths() {
  if (!fs.existsSync(localReportDir)) return [];
  return fs.readdirSync(localReportDir)
    .filter(name => /^world-gearsystem-mcp-macro-monitor\.[^.]+\.local\.json$/.test(name))
    .sort()
    .map(name => path.join(localReportDir, name));
}

function forbiddenPayloadCounterNames() {
  return [
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
}

function compactMacroRegionReport(filePath) {
  const report = readJson(filePath);
  const summary = report.summary || {};
  const routeReports = Array.isArray(report.routeReports) ? report.routeReports : [];
  const hitSnapshots = routeReports.flatMap(route => Array.isArray(route.hitSnapshots) ? route.hitSnapshots : []);
  const forbiddenCounters = Object.fromEntries(forbiddenPayloadCounterNames()
    .map(name => [name, Number(summary[name] || 0)]));
  return {
    path: relative(filePath),
    eventKind: report.eventKind || null,
    generatedBy: report.generatedBy || null,
    routeIds: uniqueSorted(routeReports.map(route => route.route?.id)),
    operationFilterRegionIds: uniqueSorted(summary.operationFilterRegionIds || []),
    operationFilterOperationIds: uniqueSorted(summary.operationFilterOperationIds || []),
    matchedRegionIds: uniqueSorted(hitSnapshots.flatMap(hit => hit.matchedRegionIds || [])),
    matchedOperationIds: uniqueSorted(hitSnapshots.flatMap(hit => hit.matchedOperationIds || [])),
    matchedHookIds: uniqueSorted(hitSnapshots.flatMap(hit => hit.matchedHookIds || [])),
    matchedLabels: uniqueSorted(hitSnapshots.flatMap(hit => hit.matchedLabels || [])),
    expectedBanks: uniqueSorted(hitSnapshots.flatMap(hit => hit.expectedBanks || [])),
    matchKinds: uniqueSorted(hitSnapshots.map(hit => hit.matchKind)),
    routeCount: Number(summary.routeCount || 0),
    breakpointHitCount: Number(summary.breakpointHitCount || 0),
    matchedExecutionHitCount: Number(summary.matchedExecutionHitCount || 0),
    matchedReadRangeInferenceHitCount: Number(summary.matchedReadRangeInferenceHitCount || 0),
    unmatchedBreakpointHitCount: Number(summary.unmatchedBreakpointHitCount || 0),
    monitoredExecutionBreakpointCount: Number(summary.monitoredExecutionBreakpointCount || 0),
    monitoredReadRangeBreakpointCount: Number(summary.monitoredReadRangeBreakpointCount || 0),
    macroMonitorUsable: summary.macroMonitorUsable === true,
    runtimeObservationPromotionReady: summary.runtimeObservationPromotionReady === true,
    forbiddenPayloadPersisted: Object.values(forbiddenCounters).some(count => count !== 0),
    forbiddenCounters,
  };
}

function buildMacroRegionReportSummary(reports) {
  return {
    reportCount: reports.length,
    usableReportCount: reports.filter(report => report.macroMonitorUsable).length,
    byteCleanReportCount: reports.filter(report => !report.forbiddenPayloadPersisted).length,
    breakpointHitCount: reports.reduce((sum, report) => sum + report.breakpointHitCount, 0),
    matchedExecutionHitCount: reports.reduce((sum, report) => sum + report.matchedExecutionHitCount, 0),
    matchedReadRangeInferenceHitCount: reports.reduce((sum, report) => sum + report.matchedReadRangeInferenceHitCount, 0),
    unmatchedBreakpointHitCount: reports.reduce((sum, report) => sum + report.unmatchedBreakpointHitCount, 0),
    filteredRegionIds: uniqueSorted(reports.flatMap(report => report.operationFilterRegionIds)),
    matchedRegionIds: uniqueSorted(reports.flatMap(report => report.matchedRegionIds)),
    matchedOperationIds: uniqueSorted(reports.flatMap(report => report.matchedOperationIds)),
    matchedHookIds: uniqueSorted(reports.flatMap(report => report.matchedHookIds)),
    expectedBanks: uniqueSorted(reports.flatMap(report => report.expectedBanks)),
    reportsReadyForReview: reports.length > 0 &&
      reports.every(report => report.macroMonitorUsable) &&
      reports.every(report => !report.forbiddenPayloadPersisted) &&
      reports.every(report => report.unmatchedBreakpointHitCount === 0),
  };
}

function findCatalog(mapData, id) {
  if (!mapData) return null;
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function buildResidualTracePlanIndex(mapData) {
  const eventContract = findCatalog(mapData, eventContractCatalogId);
  const tracePlans = eventContract?.tracePlans || [];
  return new Map(tracePlans.map(plan => [plan.regionId, {
    planId: plan.id,
    regionId: plan.regionId,
    classId: plan.classId || null,
    targetOffsets: plan.targetOffsets || [],
    requiredRuntimeHookIds: plan.requiredRuntimeHookIds || [],
    optionalRuntimeHookIds: plan.optionalRuntimeHookIds || [],
  }]));
}

function buildMacroRegionProbeRecords(mapData, reports) {
  const tracePlanByRegion = buildResidualTracePlanIndex(mapData);
  return reports.flatMap(report => {
    const regionIds = uniqueSorted([
      ...(report.operationFilterRegionIds || []),
      ...(report.matchedRegionIds || []),
    ]);
    return regionIds.map(regionId => {
      const tracePlan = tracePlanByRegion.get(regionId) || null;
      const readRangeHitObserved = report.macroMonitorUsable &&
        !report.forbiddenPayloadPersisted &&
        report.matchedReadRangeInferenceHitCount > 0 &&
        report.unmatchedBreakpointHitCount === 0;
      return {
        regionId,
        reportPath: report.path,
        status: readRangeHitObserved
          ? 'runtime_read_range_hit_observed_needs_clean_hook_capture'
          : 'no_usable_runtime_read_range_hit_from_report',
        readRangeHitObserved,
        semanticPromotionReadyFromMcpReport: false,
        runtimeObservationPromotionReadyFromMcpReport: false,
        routeIds: report.routeIds || [],
        matchKinds: report.matchKinds || [],
        matchedOperationIds: report.matchedOperationIds || [],
        expectedBanks: report.expectedBanks || [],
        breakpointHitCount: report.breakpointHitCount,
        matchedReadRangeInferenceHitCount: report.matchedReadRangeInferenceHitCount,
        unmatchedBreakpointHitCount: report.unmatchedBreakpointHitCount,
        tracePlanId: tracePlan?.planId || null,
        targetOffsets: tracePlan?.targetOffsets || [],
        requiredRuntimeHookIds: tracePlan?.requiredRuntimeHookIds || [],
        missingCleanRuntimeHookIds: tracePlan?.requiredRuntimeHookIds || [],
        nextCaptureRequirement: tracePlan
          ? 'Capture the listed requiredRuntimeHookIds as one same-frame clean-runtime observation group before closure proof or semantic promotion.'
          : 'No residual runtime trace plan was found for this region in the event contract catalog.',
        evidence: [
          `${report.path} is a sanitized Gearsystem MCP macro-monitor report for ${regionId}.`,
          'The report has no persisted ROM bytes, stream bytes, tile ids, palette bytes, port values, register traces, pixels, audio bytes, or instruction bytes.',
          'A single active read-range breakpoint inference is reachability evidence only; it does not provide same-frame hook fields required by the closure pipeline.',
        ],
      };
    });
  });
}

function runtimeEnv() {
  return {
    ...process.env,
    LD_LIBRARY_PATH: [localSdlRuntimeDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  };
}

function dependencyStatus() {
  if (!fs.existsSync(binaryPath)) {
    return {
      binaryRunnable: false,
      missingDependencies: ['gearsystem_binary_missing'],
      detail: 'Gearsystem binary is not present.',
    };
  }
  const ldd = spawnSync('ldd', [binaryPath], { encoding: 'utf8', env: runtimeEnv() });
  const text = `${ldd.stdout || ''}\n${ldd.stderr || ''}`;
  const missingDependencies = text
    .split(/\r?\n/)
    .map(line => line.match(/^\s*(\S+)\s+=>\s+not found/))
    .filter(Boolean)
    .map(match => match[1]);
  return {
    binaryRunnable: missingDependencies.length === 0,
    missingDependencies,
    localSdlRuntimeAvailable: fs.existsSync(localSdlRuntimeLib),
    localSdlRuntimeDir: relative(localSdlRuntimeDir),
    detail: missingDependencies.length
      ? `Missing runtime dependencies: ${missingDependencies.join(', ')}`
      : 'All dynamic runtime dependencies found by ldd.',
  };
}

function buildCatalog(mapData = null) {
  const symbolManifest = fs.existsSync(symbolManifestPath) ? readJson(symbolManifestPath) : null;
  const tracePlan = fs.existsSync(tracePlanPath) ? readJson(tracePlanPath) : null;
  const setupPlan = fs.existsSync(setupPlanPath) ? readJson(setupPlanPath) : null;
  const setupReport = fs.existsSync(setupReportPath) ? readJson(setupReportPath) : null;
  const hitMonitorPlan = fs.existsSync(hitMonitorPlanPath) ? readJson(hitMonitorPlanPath) : null;
  const hitMonitorReport = fs.existsSync(hitMonitorReportPath) ? readJson(hitMonitorReportPath) : null;
  const macroMonitorPlan = fs.existsSync(macroMonitorPlanPath) ? readJson(macroMonitorPlanPath) : null;
  const macroMonitorReport = fs.existsSync(macroMonitorReportPath) ? readJson(macroMonitorReportPath) : null;
  const macroRegionReports = localMacroRegionReportPaths().map(compactMacroRegionReport);
  const macroRegionReportSummary = buildMacroRegionReportSummary(macroRegionReports);
  const macroRegionProbeRecords = buildMacroRegionProbeRecords(mapData, macroRegionReports);
  const dependency = dependencyStatus();
  const files = {
    gearsystemBinary: fileStatus(binaryPath),
    symbolFile: fileStatus(symbolPath),
    symbolManifest: fileStatus(symbolManifestPath),
    residualTracePlan: fileStatus(tracePlanPath),
    residualMcpSetupPlan: fileStatus(setupPlanPath),
    residualMcpSetupReport: fileStatus(setupReportPath),
    residualMcpHitMonitorPlan: fileStatus(hitMonitorPlanPath),
    residualMcpHitMonitorReport: fileStatus(hitMonitorReportPath),
    residualMcpMacroMonitorPlan: fileStatus(macroMonitorPlanPath),
    residualMcpMacroMonitorReport: fileStatus(macroMonitorReportPath),
    localSdlRuntime: fileStatus(localSdlRuntimeLib),
  };
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    assetPolicy: 'Metadata only: file paths, existence booleans, sizes, dependency names, command paths, symbol counts, target counts, and readiness flags. No ROM bytes, decoded assets, register traces, VDP port values, pixels, screenshots, audio bytes, samples, or instruction bytes are persisted.',
    summary: {
      gearsystemDownloaded: files.gearsystemBinary.exists,
      gearsystemBinaryRunnable: dependency.binaryRunnable,
      localSdlRuntimeAvailable: dependency.localSdlRuntimeAvailable === true,
      localSdlRuntimeDir: dependency.localSdlRuntimeDir,
      missingDependencyCount: dependency.missingDependencies.length,
      missingDependencies: dependency.missingDependencies,
      symbolFileReady: files.symbolFile.exists,
      symbolCount: symbolManifest?.summary?.symbolCount || 0,
      residualTracePlanReady: tracePlan?.summary?.readyForMcpRuntimeTracing === true,
      residualTraceTargetCount: tracePlan?.summary?.targetCount || 0,
      residualMcpSetupPlanReady: setupPlan?.eventKind === 'wb3_gearsystem_mcp_residual_setup_plan' &&
        setupPlan?.summary?.targetCount === tracePlan?.summary?.targetCount,
      residualMcpSetupOperationCount: setupPlan?.summary?.operationCount || 0,
      residualMcpSetupExecutionBreakpointCount: setupPlan?.summary?.executionBreakpointCount || 0,
      residualMcpSetupReadRangeBreakpointCount: setupPlan?.summary?.readRangeBreakpointCount || 0,
      residualMcpSetupExecutionCaptureFieldNameCount: setupPlan?.summary?.executionCaptureFieldNameCount || 0,
      residualMcpSetupExecutionRequiredCaptureFieldNameCount: setupPlan?.summary?.executionRequiredCaptureFieldNameCount || 0,
      residualMcpSetupReadRangeAdapterHookCount: setupPlan?.summary?.readRangeAdapterHookCount || 0,
      residualMcpSetupReadRangeCaptureFieldNameCount: setupPlan?.summary?.readRangeCaptureFieldNameCount || 0,
      residualMcpSetupReadRangeRequiredCaptureFieldNameCount: setupPlan?.summary?.readRangeRequiredCaptureFieldNameCount || 0,
      residualMcpSetupLastExecutionUsable: setupReport?.summary?.setupUsable === true,
      residualMcpSetupLastExecutionResultCount: setupReport?.summary?.resultCount || 0,
      residualMcpSetupLastExecutionFailedResultCount: setupReport?.summary?.failedResultCount || 0,
      residualMcpHitMonitorPlanReady: hitMonitorPlan?.eventKind === 'wb3_gearsystem_mcp_hit_monitor_plan',
      residualMcpHitMonitorLastExecutionUsable: hitMonitorReport?.summary?.monitorUsable === true,
      residualMcpHitMonitorLastPollCount: hitMonitorReport?.summary?.pollCount || 0,
      residualMcpHitMonitorLastBreakpointHitCount: hitMonitorReport?.summary?.breakpointHitCount || 0,
      residualMcpHitMonitorLastMatchedExecutionHitCount: hitMonitorReport?.summary?.matchedExecutionHitCount || 0,
      residualMcpMacroMonitorPlanReady: macroMonitorPlan?.eventKind === 'wb3_gearsystem_mcp_macro_monitor_plan',
      residualMcpMacroMonitorRouteCount: macroMonitorPlan?.summary?.routeCount || 0,
      residualMcpMacroMonitorLastExecutionUsable: macroMonitorReport?.summary?.macroMonitorUsable === true,
      residualMcpMacroMonitorLastRouteCount: macroMonitorReport?.summary?.routeCount || 0,
      residualMcpMacroMonitorLastBreakpointHitCount: macroMonitorReport?.summary?.breakpointHitCount || 0,
      residualMcpMacroMonitorLastMatchedExecutionHitCount: macroMonitorReport?.summary?.matchedExecutionHitCount || 0,
      residualMcpMacroMonitorLastMatchedReadRangeInferenceHitCount: macroMonitorReport?.summary?.matchedReadRangeInferenceHitCount || 0,
      residualMcpMacroMonitorRegionReportCount: macroRegionReportSummary.reportCount,
      residualMcpMacroMonitorRegionUsableReportCount: macroRegionReportSummary.usableReportCount,
      residualMcpMacroMonitorRegionByteCleanReportCount: macroRegionReportSummary.byteCleanReportCount,
      residualMcpMacroMonitorRegionBreakpointHitCount: macroRegionReportSummary.breakpointHitCount,
      residualMcpMacroMonitorRegionMatchedExecutionHitCount: macroRegionReportSummary.matchedExecutionHitCount,
      residualMcpMacroMonitorRegionMatchedReadRangeInferenceHitCount: macroRegionReportSummary.matchedReadRangeInferenceHitCount,
      residualMcpMacroMonitorRegionUnmatchedBreakpointHitCount: macroRegionReportSummary.unmatchedBreakpointHitCount,
      residualMcpMacroMonitorRegionFilteredRegionIds: macroRegionReportSummary.filteredRegionIds,
      residualMcpMacroMonitorRegionMatchedRegionIds: macroRegionReportSummary.matchedRegionIds,
      residualMcpMacroMonitorRegionMatchedOperationIds: macroRegionReportSummary.matchedOperationIds,
      residualMcpMacroMonitorRegionMatchedHookIds: macroRegionReportSummary.matchedHookIds,
      residualMcpMacroMonitorRegionExpectedBanks: macroRegionReportSummary.expectedBanks,
      residualMcpMacroMonitorRegionReportsReadyForReview: macroRegionReportSummary.reportsReadyForReview,
      residualMcpMacroMonitorRegionProbeRecordCount: macroRegionProbeRecords.length,
      residualMcpMacroMonitorRegionProbeReadRangeHitObservedCount: macroRegionProbeRecords.filter(record => record.readRangeHitObserved).length,
      residualMcpMacroMonitorRegionProbeSemanticPromotionReadyCount: macroRegionProbeRecords.filter(record => record.semanticPromotionReadyFromMcpReport).length,
      readyForMcpRuntimeTracing: dependency.binaryRunnable &&
        files.symbolFile.exists &&
        tracePlan?.summary?.readyForMcpRuntimeTracing === true &&
        setupPlan?.eventKind === 'wb3_gearsystem_mcp_residual_setup_plan' &&
        hitMonitorPlan?.eventKind === 'wb3_gearsystem_mcp_hit_monitor_plan' &&
        macroMonitorPlan?.eventKind === 'wb3_gearsystem_mcp_macro_monitor_plan',
      launchCommand: 'node tools/world-gearsystem-launch.mjs --port 7777',
      probeCommand: 'node tools/world-gearsystem-mcp-probe.mjs --port 7777',
      symbolBuildCommand: 'node tools/world-gearsystem-symbols.mjs',
      tracePlanBuildCommand: 'node tools/world-gearsystem-residual-trace-plan.mjs',
      setupPlanCommand: 'node tools/world-gearsystem-mcp-residual-setup.mjs',
      setupExecuteCommand: 'node tools/world-gearsystem-mcp-residual-setup.mjs --execute --port 7777 --out tmp/world-gearsystem-mcp-residual-setup.local.json',
      hitMonitorPlanCommand: 'node tools/world-gearsystem-mcp-hit-monitor.mjs',
      hitMonitorExecuteCommand: 'node tools/world-gearsystem-mcp-hit-monitor.mjs --execute --port 7777 --polls 120 --poll-ms 100 --out tmp/world-gearsystem-mcp-hit-monitor.local.json',
      macroMonitorPlanCommand: 'node tools/world-gearsystem-mcp-macro-monitor.mjs',
      macroMonitorExecuteCommand: 'node tools/world-gearsystem-mcp-macro-monitor.mjs --execute --setup --reset --all-routes --port 7777 --out tmp/world-gearsystem-mcp-macro-monitor.local.json',
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    files,
    dependency,
    residualTraceTargets: (tracePlan?.targets || []).map(target => ({
      regionId: target.regionId,
      offset: target.offset,
      type: target.type,
      classId: target.classId,
      traceKind: target.traceKind,
      requiredRuntimeHookIds: target.requiredRuntimeHookIds,
      requiredHookCount: target.requiredRuntimeHookIds?.length || 0,
      commandKeys: Object.keys(target.commands || {}).filter(key => target.commands[key]),
    })),
    residualMcpSetupOperations: (setupPlan?.operations || []).map(operation => ({
      id: operation.id,
      kind: operation.kind,
      tool: operation.tool,
      regionIds: operation.regionIds || [],
      bank: operation.source?.bank || null,
      logicalAddress: operation.source?.logicalAddress || operation.source?.logicalStartAddress || null,
      logicalEndAddress: operation.source?.logicalEndAddress || null,
      hookIds: operation.source?.hookIds || [],
      evidence: operation.evidence,
    })),
    residualMcpHitMonitor: hitMonitorPlan
      ? {
          eventKind: hitMonitorPlan.eventKind,
          executed: hitMonitorPlan.executed === true,
          summary: hitMonitorPlan.summary,
          commandKeys: Object.keys(hitMonitorPlan.commands || {}).sort(),
        }
      : null,
    residualMcpMacroMonitor: macroMonitorPlan
      ? {
          eventKind: macroMonitorPlan.eventKind,
          executed: macroMonitorPlan.executed === true,
          summary: macroMonitorPlan.summary,
          routeIds: (macroMonitorPlan.routes || []).map(route => route.id),
          commandKeys: Object.keys(macroMonitorPlan.commands || {}).sort(),
        }
      : null,
    residualMcpMacroRegionReports: {
      summary: macroRegionReportSummary,
      reports: macroRegionReports,
    },
    residualMcpMacroRegionProbeRecords: macroRegionProbeRecords,
    evidence: [
      'Gearsystem release files are stored under the repo-local gearsystem/ folder provided by the user.',
      'The Gearsystem binary strings expose --headless, --mcp-http, --mcp-http-port, --mcp-http-address, and --mcp-stdio flags.',
      'tools/world-gearsystem-symbols.mjs generated a Gearsystem .sym file from ASM labels only.',
      'tools/world-gearsystem-residual-trace-plan.mjs generated a metadata-only residual trace plan from existing capture checklist metadata.',
      'tools/world-gearsystem-mcp-residual-setup.mjs generated a metadata-only MCP breakpoint setup plan from the residual trace plan.',
      'tools/world-gearsystem-mcp-hit-monitor.mjs generated a metadata-only breakpoint-hit monitor plan from the residual MCP setup plan.',
      'tools/world-gearsystem-mcp-macro-monitor.mjs generated metadata-only controller macro routes for repeatable residual tracing.',
      dependency.localSdlRuntimeAvailable
        ? 'gearsystem/sdl3-runtime/lib/libSDL3.so.0 is available and used through LD_LIBRARY_PATH for ldd and launch.'
        : 'No repo-local SDL3 runtime library was found under gearsystem/sdl3-runtime/lib.',
      setupReport?.summary?.setupUsable === true
        ? 'tmp/world-gearsystem-mcp-residual-setup.local.json records a sanitized successful MCP setup run.'
        : 'No sanitized successful residual MCP setup report is available yet.',
      hitMonitorReport?.summary?.monitorUsable === true
        ? 'tmp/world-gearsystem-mcp-hit-monitor.local.json records a sanitized Gearsystem MCP hit-monitor run.'
        : 'No sanitized Gearsystem MCP hit-monitor run is available yet.',
      macroMonitorReport?.summary?.macroMonitorUsable === true
        ? 'tmp/world-gearsystem-mcp-macro-monitor.local.json records a sanitized Gearsystem MCP macro-monitor run.'
        : 'No sanitized Gearsystem MCP macro-monitor run is available yet.',
      macroRegionReportSummary.reportCount
        ? `tmp/world-gearsystem-mcp-macro-monitor.*.local.json provides ${macroRegionReportSummary.reportCount} sanitized per-region residual macro-monitor report(s) for review.`
        : 'No sanitized per-region residual macro-monitor reports are available yet.',
      dependency.detail,
    ],
    nextLeads: dependency.binaryRunnable
      ? [
          'Start Gearsystem MCP with node tools/world-gearsystem-launch.mjs --port 7777.',
          'Probe tools with node tools/world-gearsystem-mcp-probe.mjs --port 7777.',
          'Install residual execution/read breakpoints with node tools/world-gearsystem-mcp-residual-setup.mjs --execute --port 7777 --out tmp/world-gearsystem-mcp-residual-setup.local.json.',
          'Monitor residual breakpoint hits with node tools/world-gearsystem-mcp-hit-monitor.mjs --execute --port 7777 --polls 120 --poll-ms 100 --out tmp/world-gearsystem-mcp-hit-monitor.local.json.',
          'Run controller macro route probes with node tools/world-gearsystem-mcp-macro-monitor.mjs --execute --setup --reset --all-routes --port 7777 --out tmp/world-gearsystem-mcp-macro-monitor.local.json.',
          'Use the residual trace plan to capture metadata-only observations for r2813, r2815-r2817, and r0749.',
        ]
      : [
          'Install or provide libSDL3.so.0, then rerun node tools/world-gearsystem-mcp-bridge-audit.mjs --apply.',
          'After Gearsystem launches, probe MCP and capture metadata-only residual observations.',
        ],
  };
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.gearsystemMcpBridgeCatalog = catalogId;
  staticMap.summary.gearsystemMcpBridgeDownloaded = catalog.summary.gearsystemDownloaded;
  staticMap.summary.gearsystemMcpBridgeRunnable = catalog.summary.gearsystemBinaryRunnable;
  staticMap.summary.gearsystemMcpBridgeLocalSdlRuntimeAvailable = catalog.summary.localSdlRuntimeAvailable;
  staticMap.summary.gearsystemMcpBridgeMissingDependencyCount = catalog.summary.missingDependencyCount;
  staticMap.summary.gearsystemMcpBridgeSymbolCount = catalog.summary.symbolCount;
  staticMap.summary.gearsystemMcpBridgeResidualTraceTargets = catalog.summary.residualTraceTargetCount;
  staticMap.summary.gearsystemMcpBridgeResidualSetupPlanReady = catalog.summary.residualMcpSetupPlanReady;
  staticMap.summary.gearsystemMcpBridgeResidualSetupOperationCount = catalog.summary.residualMcpSetupOperationCount;
  staticMap.summary.gearsystemMcpBridgeResidualSetupExecutionCaptureFieldNameCount = catalog.summary.residualMcpSetupExecutionCaptureFieldNameCount;
  staticMap.summary.gearsystemMcpBridgeResidualSetupExecutionRequiredCaptureFieldNameCount = catalog.summary.residualMcpSetupExecutionRequiredCaptureFieldNameCount;
  staticMap.summary.gearsystemMcpBridgeResidualSetupReadRangeAdapterHookCount = catalog.summary.residualMcpSetupReadRangeAdapterHookCount;
  staticMap.summary.gearsystemMcpBridgeResidualSetupReadRangeCaptureFieldNameCount = catalog.summary.residualMcpSetupReadRangeCaptureFieldNameCount;
  staticMap.summary.gearsystemMcpBridgeResidualSetupReadRangeRequiredCaptureFieldNameCount = catalog.summary.residualMcpSetupReadRangeRequiredCaptureFieldNameCount;
  staticMap.summary.gearsystemMcpBridgeResidualSetupLastExecutionUsable = catalog.summary.residualMcpSetupLastExecutionUsable;
  staticMap.summary.gearsystemMcpBridgeResidualHitMonitorPlanReady = catalog.summary.residualMcpHitMonitorPlanReady;
  staticMap.summary.gearsystemMcpBridgeResidualHitMonitorLastExecutionUsable = catalog.summary.residualMcpHitMonitorLastExecutionUsable;
  staticMap.summary.gearsystemMcpBridgeResidualHitMonitorLastBreakpointHitCount = catalog.summary.residualMcpHitMonitorLastBreakpointHitCount;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorPlanReady = catalog.summary.residualMcpMacroMonitorPlanReady;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorLastExecutionUsable = catalog.summary.residualMcpMacroMonitorLastExecutionUsable;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorLastBreakpointHitCount = catalog.summary.residualMcpMacroMonitorLastBreakpointHitCount;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorLastMatchedReadRangeInferenceHitCount = catalog.summary.residualMcpMacroMonitorLastMatchedReadRangeInferenceHitCount;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionReportCount = catalog.summary.residualMcpMacroMonitorRegionReportCount;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionUsableReportCount = catalog.summary.residualMcpMacroMonitorRegionUsableReportCount;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionByteCleanReportCount = catalog.summary.residualMcpMacroMonitorRegionByteCleanReportCount;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionBreakpointHitCount = catalog.summary.residualMcpMacroMonitorRegionBreakpointHitCount;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionMatchedExecutionHitCount = catalog.summary.residualMcpMacroMonitorRegionMatchedExecutionHitCount;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionMatchedReadRangeInferenceHitCount = catalog.summary.residualMcpMacroMonitorRegionMatchedReadRangeInferenceHitCount;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionUnmatchedBreakpointHitCount = catalog.summary.residualMcpMacroMonitorRegionUnmatchedBreakpointHitCount;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionFilteredRegionIds = catalog.summary.residualMcpMacroMonitorRegionFilteredRegionIds;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionMatchedRegionIds = catalog.summary.residualMcpMacroMonitorRegionMatchedRegionIds;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionMatchedOperationIds = catalog.summary.residualMcpMacroMonitorRegionMatchedOperationIds;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionMatchedHookIds = catalog.summary.residualMcpMacroMonitorRegionMatchedHookIds;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionExpectedBanks = catalog.summary.residualMcpMacroMonitorRegionExpectedBanks;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionReportsReadyForReview = catalog.summary.residualMcpMacroMonitorRegionReportsReadyForReview;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionProbeRecordCount = catalog.summary.residualMcpMacroMonitorRegionProbeRecordCount;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionProbeReadRangeHitObservedCount = catalog.summary.residualMcpMacroMonitorRegionProbeReadRangeHitObservedCount;
  staticMap.summary.gearsystemMcpBridgeResidualMacroMonitorRegionProbeSemanticPromotionReadyCount = catalog.summary.residualMcpMacroMonitorRegionProbeSemanticPromotionReadyCount;
  staticMap.summary.gearsystemMcpBridgeReadyForRuntimeTracing = catalog.summary.readyForMcpRuntimeTracing;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-bridge-catalog-2026-06-26 to launch Gearsystem MCP and collect metadata-only runtime traces for the final five residual regions.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function annotateMacroRegionProbeRecords(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.residualMcpMacroRegionProbeRecords || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'gearsystem_mcp_macro_region_probe' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpMacroRegionProbeAudit = {
      catalogId,
      kind: 'gearsystem_mcp_macro_region_probe',
      status: record.status,
      confidence: record.readRangeHitObserved ? 'medium_runtime_reachability' : 'low_no_runtime_hit',
      readRangeHitObserved: record.readRangeHitObserved,
      semanticPromotionReadyFromMcpReport: false,
      runtimeObservationPromotionReadyFromMcpReport: false,
      routeIds: record.routeIds,
      matchKinds: record.matchKinds,
      matchedOperationIds: record.matchedOperationIds,
      expectedBanks: record.expectedBanks,
      breakpointHitCount: record.breakpointHitCount,
      matchedReadRangeInferenceHitCount: record.matchedReadRangeInferenceHitCount,
      unmatchedBreakpointHitCount: record.unmatchedBreakpointHitCount,
      tracePlanId: record.tracePlanId,
      targetOffsets: record.targetOffsets,
      requiredRuntimeHookIds: record.requiredRuntimeHookIds,
      missingCleanRuntimeHookIds: record.missingCleanRuntimeHookIds,
      nextCaptureRequirement: record.nextCaptureRequirement,
      reportPath: record.reportPath,
      summary: 'Gearsystem MCP isolated macro probe reached this residual read range, but the report is reachability evidence only and does not replace clean same-frame hook observations.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      status: record.status,
      readRangeHitObserved: record.readRangeHitObserved,
    });
  }
  return { changedRegions, missingRegions };
}

function main() {
  const apply = process.argv.includes('--apply');
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (apply) {
    const annotation = annotateMacroRegionProbeRecords(mapData, catalog);
    mapData.gearsystemMcpBridgeCatalogs = (mapData.gearsystemMcpBridgeCatalogs || []).filter(item => item.id !== catalogId);
    mapData.gearsystemMcpBridgeCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'gearsystem_mcp_bridge_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      catalogId,
      summary: catalog.summary,
      residualTraceTargets: catalog.residualTraceTargets,
      residualMcpMacroRegionReports: catalog.residualMcpMacroRegionReports,
      residualMcpMacroRegionProbeRecords: catalog.residualMcpMacroRegionProbeRecords,
      changedRegions: annotation.changedRegions,
      missingRegions: annotation.missingRegions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      assetPolicy: catalog.assetPolicy,
    });
    mapData.updatedAt = now;
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }
  console.log(JSON.stringify({
    ok: true,
    applied: apply,
    catalogId,
    summary: catalog.summary,
    missingDependencies: catalog.dependency.missingDependencies,
  }, null, 2));
  if (!catalog.summary.readyForMcpRuntimeTracing) process.exitCode = apply ? 0 : 1;
}

main();
