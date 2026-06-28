#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  REQUIRED_RESIDUAL_RUNTIME_CAPTURE_FIELD_RULES,
} from '../shared/wb3/residual-runtime-observation-review.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const setupPlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-setup-plan.json');
const localReportDir = path.join(repoRoot, 'tmp');
const eventContractCatalogId = 'world-residual-runtime-trace-event-contract-catalog-2026-06-26';
const bridgeCatalogId = 'world-gearsystem-mcp-bridge-catalog-2026-06-26';
const catalogId = 'world-gearsystem-mcp-clean-hook-gap-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-clean-hook-gap-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-clean-hook-gap-audit.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;

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

function localMacroRegionReportPaths() {
  if (!fs.existsSync(localReportDir)) return [];
  return fs.readdirSync(localReportDir)
    .filter(name => /^world-gearsystem-mcp-macro-monitor\.[^.]+\.local\.json$/.test(name))
    .sort()
    .map(name => path.join(localReportDir, name));
}

function localExecutionProbeReportPaths() {
  if (!fs.existsSync(localReportDir)) return [];
  return fs.readdirSync(localReportDir)
    .filter(name => /^world-gearsystem-mcp-exec-probe\..*\.local\.json$/.test(name))
    .sort()
    .map(name => path.join(localReportDir, name));
}

function compactMacroReport(filePath) {
  const report = readJson(filePath);
  const summary = report.summary || {};
  const routeReports = Array.isArray(report.routeReports) ? report.routeReports : [];
  const hitSnapshots = routeReports.flatMap(route => Array.isArray(route.hitSnapshots) ? route.hitSnapshots : []);
  const forbiddenCounters = Object.fromEntries(forbiddenCounterNames.map(name => [name, Number(summary[name] || 0)]));
  return {
    path: relative(filePath),
    routeIds: uniqueSorted(routeReports.map(route => route.route?.id)),
    filteredRegionIds: uniqueSorted(summary.operationFilterRegionIds || []),
    matchedRegionIds: uniqueSorted(hitSnapshots.flatMap(hit => hit.matchedRegionIds || [])),
    matchedOperationIds: uniqueSorted(hitSnapshots.flatMap(hit => hit.matchedOperationIds || [])),
    matchedHookIds: uniqueSorted(hitSnapshots.flatMap(hit => hit.matchedHookIds || [])),
    matchedLabels: uniqueSorted(hitSnapshots.flatMap(hit => hit.matchedLabels || [])),
    matchedHookBreakpointRoles: uniqueSorted(hitSnapshots.flatMap(hit => hit.matchedHookBreakpointRoles || [])),
    matchedCaptureFields: uniqueSorted(hitSnapshots.flatMap(hit => hit.matchedCaptureFields || [])),
    matchedRequiredCaptureFields: uniqueSorted(hitSnapshots.flatMap(hit => hit.matchedRequiredCaptureFields || [])),
    matchKinds: uniqueSorted(hitSnapshots.map(hit => hit.matchKind)),
    expectedBanks: uniqueSorted(hitSnapshots.flatMap(hit => hit.expectedBanks || [])),
    breakpointHitCount: Number(summary.breakpointHitCount || 0),
    matchedReadRangeInferenceHitCount: Number(summary.matchedReadRangeInferenceHitCount || 0),
    unmatchedBreakpointHitCount: Number(summary.unmatchedBreakpointHitCount || 0),
    macroMonitorUsable: summary.macroMonitorUsable === true,
    byteClean: Object.values(forbiddenCounters).every(count => count === 0),
    forbiddenCounters,
  };
}

function compactExecutionProbeReport(filePath, operationRegionIdsById) {
  const report = readJson(filePath);
  const summary = report.summary || {};
  const operationFilterOperationIds = uniqueSorted(summary.operationFilterOperationIds || []);
  const regionIdsFromOperations = uniqueSorted(operationFilterOperationIds
    .flatMap(operationId => operationRegionIdsById.get(operationId) || []));
  const forbiddenCounters = Object.fromEntries(forbiddenCounterNames.map(name => [name, Number(summary[name] || 0)]));
  return {
    path: relative(filePath),
    executed: report.executed === true,
    routeCount: Number(summary.routeCount || 0),
    setupBreakpoints: summary.setupBreakpoints === true,
    clearExistingBreakpoints: summary.clearExistingBreakpoints === true,
    operationFilterRegionIds: uniqueSorted(summary.operationFilterRegionIds || []),
    operationFilterOperationIds,
    regionIds: uniqueSorted([...(summary.operationFilterRegionIds || []), ...regionIdsFromOperations]),
    monitoredExecutionBreakpointCount: Number(summary.monitoredExecutionBreakpointCount || 0),
    monitoredReadRangeBreakpointCount: Number(summary.monitoredReadRangeBreakpointCount || 0),
    breakpointHitCount: Number(summary.breakpointHitCount || 0),
    matchedExecutionHitCount: Number(summary.matchedExecutionHitCount || 0),
    matchedReadRangeInferenceHitCount: Number(summary.matchedReadRangeInferenceHitCount || 0),
    unmatchedBreakpointHitCount: Number(summary.unmatchedBreakpointHitCount || 0),
    macroMonitorUsable: summary.macroMonitorUsable === true,
    byteClean: Object.values(forbiddenCounters).every(count => count === 0),
    forbiddenCounters,
  };
}

function operationRegionIds(operation) {
  return uniqueSorted([
    ...(operation.regionIds || []),
    ...(operation.source?.regionIds || []),
    operation.source?.regionId,
  ].filter(Boolean));
}

function compactOperation(operation) {
  return {
    id: operation.id,
    kind: operation.kind,
    tool: operation.tool,
    regionIds: operationRegionIds(operation),
    hookIds: operation.source?.hookIds || [],
    labels: operation.source?.labels || [],
    hookOffsets: operation.source?.hookOffsets || [],
    hookBreakpointRoles: operation.source?.hookBreakpointRoles || [],
    captureFields: operation.source?.captureFields || [],
    requiredCaptureFields: operation.source?.requiredCaptureFields || [],
    bank: operation.source?.bank || null,
    logicalAddress: operation.source?.logicalAddress || operation.source?.logicalStartAddress || null,
    logicalEndAddress: operation.source?.logicalEndAddress || null,
    romStartOffset: operation.source?.romStartOffset || operation.source?.romOffset || null,
    romEndOffset: operation.source?.romEndOffset || operation.source?.romOffset || null,
  };
}

function buildSetupOperationIndex(setupPlan) {
  const byRegion = new Map();
  const byHook = new Map();
  const regionIdsById = new Map();
  for (const operation of setupPlan?.operations || []) {
    const compact = compactOperation(operation);
    regionIdsById.set(compact.id, compact.regionIds);
    for (const regionId of compact.regionIds) {
      if (!byRegion.has(regionId)) byRegion.set(regionId, []);
      byRegion.get(regionId).push(compact);
    }
    for (const hookId of compact.hookIds) {
      if (!byHook.has(hookId)) byHook.set(hookId, []);
      byHook.get(hookId).push(compact);
    }
  }
  return { byRegion, byHook, regionIdsById };
}

function fieldsForHook(hook) {
  const rule = REQUIRED_RESIDUAL_RUNTIME_CAPTURE_FIELD_RULES[hook.id] || {};
  return {
    hookId: hook.id,
    label: hook.label || null,
    eventKind: hook.eventKind || '',
    hookClass: hook.hookClass || '',
    captureFields: hook.captureFields || [],
    requiredFields: rule.requiredFields || [],
    requiredTrueFieldGroups: rule.requiredTrueFieldGroups || [],
  };
}

function buildRegionGapRecord(region, tracePlan, eventContract, setupIndex, macroReportsByRegion, executionProbeReportsByRegion) {
  const hooksById = new Map((eventContract.hooks || []).map(hook => [hook.id, hook]));
  const requiredHookIds = tracePlan.requiredRuntimeHookIds || [];
  const requiredHooks = requiredHookIds.map(hookId => fieldsForHook(hooksById.get(hookId) || { id: hookId }));
  const macroReports = macroReportsByRegion.get(region.id) || [];
  const executionProbeReports = executionProbeReportsByRegion.get(region.id) || [];
  const readRangeHitObserved = macroReports.some(report =>
    report.macroMonitorUsable &&
    report.byteClean &&
    report.matchedReadRangeInferenceHitCount > 0 &&
    report.unmatchedBreakpointHitCount === 0);
  const setupOperations = setupIndex.byRegion.get(region.id) || [];
  const executionBreakpointHookIds = uniqueSorted(setupOperations
    .filter(operation => operation.kind === 'execution_breakpoint')
    .flatMap(operation => operation.hookIds || []));
  const readRangeAdapterHookIds = uniqueSorted(setupOperations
    .filter(operation => operation.kind === 'read_range_breakpoint')
    .flatMap(operation => operation.hookIds || []));
  const captureAdapterHookIds = uniqueSorted(setupOperations
    .flatMap(operation => operation.hookIds || []));
  const readRangeOperationIds = uniqueSorted(setupOperations
    .filter(operation => operation.kind === 'read_range_breakpoint')
    .map(operation => operation.id));
  const missingCaptureAdapterHookIds = requiredHookIds
    .filter(hookId => hookId !== 'residual_runtime_promotion_gate')
    .filter(hookId => !captureAdapterHookIds.includes(hookId));
  const missingExecutionBreakpointHookIds = missingCaptureAdapterHookIds;
  const operationCoveringRequiredField = (hookId, field) => setupOperations.find(operation =>
    (operation.hookIds || []).includes(hookId) &&
    ((operation.requiredCaptureFields || []).includes(field) || (operation.captureFields || []).includes(field)));
  const operationCoversRequiredField = (hookId, field) => Boolean(operationCoveringRequiredField(hookId, field));
  const fieldStatusForOperation = operation => operation?.kind === 'read_range_breakpoint'
    ? 'needs_debugger_callback_value_at_read_range_breakpoint'
    : 'needs_debugger_callback_value_at_execution_breakpoint';
  const operationCoversExecutionRequiredField = (hookId, field) => setupOperations.some(operation =>
    operation.kind === 'execution_breakpoint' &&
    (operation.hookIds || []).includes(hookId) &&
    ((operation.requiredCaptureFields || []).includes(field) || (operation.captureFields || []).includes(field)));
  const missingFieldStatus = (hook, field) => {
    const coveringOperation = operationCoveringRequiredField(hook.hookId, field);
    if (coveringOperation) return fieldStatusForOperation(coveringOperation);
    if (hook.hookId === 'residual_runtime_promotion_gate') return 'needs_same_frame_promotion_gate_derivation';
    if (missingCaptureAdapterHookIds.includes(hook.hookId)) return 'needs_watchpoint_or_breakpoint_adapter_support';
    return 'not_observed_by_current_mcp_macro_report';
  };
  const missingFieldRows = requiredHooks.flatMap(hook => {
    const trueGroupFields = (hook.requiredTrueFieldGroups || []).flatMap(fields => fields);
    return uniqueSorted([...(hook.requiredFields || []), ...trueGroupFields]).map(field => ({
      hookId: hook.hookId,
      field,
      status: missingFieldStatus(hook, field),
    }));
  });
  const captureAdapterScaffoldReady = missingCaptureAdapterHookIds.length === 0;
  const executionCaptureScaffoldReady = captureAdapterScaffoldReady;
  const executionCaptureFieldNameCount = new Set(setupOperations
    .filter(operation => operation.kind === 'execution_breakpoint')
    .flatMap(operation => operation.captureFields || [])).size;
  const executionRequiredCaptureFieldNameCount = new Set(setupOperations
    .filter(operation => operation.kind === 'execution_breakpoint')
    .flatMap(operation => operation.requiredCaptureFields || [])).size;
  const readRangeCaptureFieldNameCount = new Set(setupOperations
    .filter(operation => operation.kind === 'read_range_breakpoint')
    .flatMap(operation => operation.captureFields || [])).size;
  const readRangeRequiredCaptureFieldNameCount = new Set(setupOperations
    .filter(operation => operation.kind === 'read_range_breakpoint')
    .flatMap(operation => operation.requiredCaptureFields || [])).size;
  return {
    regionId: region.id,
    offset: region.offset,
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    confidence: region.confidence || null,
    status: readRangeHitObserved
      ? 'read_range_reached_clean_hook_fields_missing'
      : 'waiting_for_mcp_read_range_evidence',
    readRangeHitObserved,
    cleanHookObservationReady: false,
    closureReady: false,
    semanticPromotionReady: false,
    tracePlanId: tracePlan.id,
    classId: tracePlan.classId || null,
    targetOffsets: tracePlan.targetOffsets || [],
    requiredRuntimeHookIds: requiredHookIds,
    requiredHookCount: requiredHookIds.length,
    requiredFieldCount: missingFieldRows.length,
    observedCleanHookFieldCount: 0,
    missingCleanHookFieldCount: missingFieldRows.length,
    missingCleanHookFields: missingFieldRows,
    executionBreakpointHookIds,
    readRangeAdapterHookIds,
    captureAdapterHookIds,
    missingExecutionBreakpointHookIds,
    missingCaptureAdapterHookIds,
    captureAdapterScaffoldReady,
    executionCaptureScaffoldReady,
    executionCaptureFieldNameCount,
    executionRequiredCaptureFieldNameCount,
    readRangeCaptureFieldNameCount,
    readRangeRequiredCaptureFieldNameCount,
    readRangeOperationIds,
    setupOperations: setupOperations.map(operation => ({
      id: operation.id,
      kind: operation.kind,
      hookIds: operation.hookIds,
      labels: operation.labels,
      hookOffsets: operation.hookOffsets,
      hookBreakpointRoles: operation.hookBreakpointRoles,
      captureFields: operation.captureFields,
      requiredCaptureFields: operation.requiredCaptureFields,
      bank: operation.bank,
      logicalAddress: operation.logicalAddress,
      logicalEndAddress: operation.logicalEndAddress,
    })),
    macroReports: macroReports.map(report => ({
      path: report.path,
      routeIds: report.routeIds,
      matchedOperationIds: report.matchedOperationIds,
      matchedHookIds: report.matchedHookIds,
      matchedLabels: report.matchedLabels,
      matchedHookBreakpointRoles: report.matchedHookBreakpointRoles,
      matchedCaptureFields: report.matchedCaptureFields,
      matchedRequiredCaptureFields: report.matchedRequiredCaptureFields,
      matchKinds: report.matchKinds,
      expectedBanks: report.expectedBanks,
      breakpointHitCount: report.breakpointHitCount,
      matchedReadRangeInferenceHitCount: report.matchedReadRangeInferenceHitCount,
      unmatchedBreakpointHitCount: report.unmatchedBreakpointHitCount,
      byteClean: report.byteClean,
    })),
    executionProbeReports: executionProbeReports.map(report => ({
      path: report.path,
      routeCount: report.routeCount,
      clearExistingBreakpoints: report.clearExistingBreakpoints,
      operationFilterOperationIds: report.operationFilterOperationIds,
      monitoredExecutionBreakpointCount: report.monitoredExecutionBreakpointCount,
      monitoredReadRangeBreakpointCount: report.monitoredReadRangeBreakpointCount,
      breakpointHitCount: report.breakpointHitCount,
      matchedExecutionHitCount: report.matchedExecutionHitCount,
      matchedReadRangeInferenceHitCount: report.matchedReadRangeInferenceHitCount,
      unmatchedBreakpointHitCount: report.unmatchedBreakpointHitCount,
      byteClean: report.byteClean,
    })),
    nextDebuggerCapability: 'Capture allowed residual hook fields from Gearsystem/MCP breakpoint callbacks as same-frame metadata events, without persisting PC/register traces, ROM bytes, memory dumps, VDP port values, pixels, or audio.',
    evidence: [
      `${bridgeCatalogId} records sanitized Gearsystem MCP setup and macro report readiness.`,
      readRangeHitObserved
        ? 'At least one sanitized isolated macro report matched this region through a single active read-range breakpoint inference.'
        : 'No sanitized isolated macro report currently proves this region read range was reached.',
      'Current MCP macro reports do not contain the clean same-frame hook fields required by the residual closure pipeline.',
    ],
  };
}

function macroReportsByRegion(reports) {
  const byRegion = new Map();
  for (const report of reports) {
    for (const regionId of uniqueSorted([...report.filteredRegionIds, ...report.matchedRegionIds])) {
      if (!byRegion.has(regionId)) byRegion.set(regionId, []);
      byRegion.get(regionId).push(report);
    }
  }
  return byRegion;
}

function executionProbeReportsByRegion(reports) {
  const byRegion = new Map();
  for (const report of reports) {
    for (const regionId of report.regionIds || []) {
      if (!byRegion.has(regionId)) byRegion.set(regionId, []);
      byRegion.get(regionId).push(report);
    }
  }
  return byRegion;
}

function buildCatalog(mapData) {
  const eventContract = requireCatalog(mapData, eventContractCatalogId);
  const setupPlan = fs.existsSync(setupPlanPath) ? readJson(setupPlanPath) : { operations: [] };
  const setupIndex = buildSetupOperationIndex(setupPlan);
  const macroReports = localMacroRegionReportPaths().map(compactMacroReport);
  const executionProbeReports = localExecutionProbeReportPaths()
    .map(filePath => compactExecutionProbeReport(filePath, setupIndex.regionIdsById))
    .filter(report => report.executed);
  const reportsByRegion = macroReportsByRegion(macroReports);
  const execReportsByRegion = executionProbeReportsByRegion(executionProbeReports);
  const records = (eventContract.tracePlans || []).map(tracePlan => {
    const region = (mapData.regions || []).find(candidate => candidate.id === tracePlan.regionId) || {
      id: tracePlan.regionId,
      offset: tracePlan.targetOffsets?.[0] || null,
      size: 0,
      type: 'unknown',
    };
    return buildRegionGapRecord(region, tracePlan, eventContract, setupIndex, reportsByRegion, execReportsByRegion);
  });

  const missingFieldCountByHook = {};
  for (const record of records) {
    for (const field of record.missingCleanHookFields) {
      missingFieldCountByHook[field.hookId] = (missingFieldCountByHook[field.hookId] || 0) + 1;
    }
  }

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [eventContractCatalogId, bridgeCatalogId],
    assetPolicy: 'Metadata only: region ids, offsets, hook ids, field names, operation ids, labels, counts, booleans, banks, command paths, and policy flags. No ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      residualRegionCount: records.length,
      readRangeHitObservedCount: records.filter(record => record.readRangeHitObserved).length,
      executionCaptureScaffoldReadyCount: records.filter(record => record.executionCaptureScaffoldReady).length,
      executionCaptureScaffoldBlockedCount: records.filter(record => !record.executionCaptureScaffoldReady).length,
      captureAdapterScaffoldReadyCount: records.filter(record => record.captureAdapterScaffoldReady).length,
      captureAdapterScaffoldBlockedCount: records.filter(record => !record.captureAdapterScaffoldReady).length,
      cleanHookObservationReadyCount: records.filter(record => record.cleanHookObservationReady).length,
      closureReadyCount: records.filter(record => record.closureReady).length,
      semanticPromotionReadyCount: records.filter(record => record.semanticPromotionReady).length,
      totalRequiredHookCount: records.reduce((sum, record) => sum + record.requiredHookCount, 0),
      totalRequiredFieldCount: records.reduce((sum, record) => sum + record.requiredFieldCount, 0),
      totalExecutionRequiredCaptureFieldNameCount: records.reduce((sum, record) => sum + record.executionRequiredCaptureFieldNameCount, 0),
      totalReadRangeRequiredCaptureFieldNameCount: records.reduce((sum, record) => sum + record.readRangeRequiredCaptureFieldNameCount, 0),
      totalObservedCleanHookFieldCount: records.reduce((sum, record) => sum + record.observedCleanHookFieldCount, 0),
      totalMissingCleanHookFieldCount: records.reduce((sum, record) => sum + record.missingCleanHookFieldCount, 0),
      executionProbeReportCount: executionProbeReports.length,
      executionProbeByteCleanReportCount: executionProbeReports.filter(report => report.byteClean).length,
      executionProbeMatchedExecutionHitCount: executionProbeReports.reduce((sum, report) => sum + report.matchedExecutionHitCount, 0),
      executionProbeMatchedReadRangeInferenceHitCount: executionProbeReports.reduce((sum, report) => sum + report.matchedReadRangeInferenceHitCount, 0),
      executionProbeUnmatchedBreakpointHitCount: executionProbeReports.reduce((sum, report) => sum + report.unmatchedBreakpointHitCount, 0),
      regionIds: records.map(record => record.regionId),
      missingExecutionBreakpointHookIds: uniqueSorted(records.flatMap(record => record.missingExecutionBreakpointHookIds)),
      missingFieldCountByHook,
      requiresDebuggerCallbackFieldCapture: true,
      currentMcpMacroReportsAreReachabilityOnly: true,
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
    executionProbeReports,
    records,
    commands: {
      refreshBridgeAudit: 'node tools/world-gearsystem-mcp-bridge-audit.mjs --apply',
      runThisAudit: `node ${toolName}`,
      applyThisAudit: `node ${toolName} --apply`,
      closurePipeline: 'node tools/world-residual-runtime-closure-pipeline-audit.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-closure-pipeline.local.json',
    },
    evidence: [
      `${eventContractCatalogId} defines the residual clean-hook contract and required same-frame hook groups.`,
      `${bridgeCatalogId} records the sanitized Gearsystem MCP setup and per-region read-range macro reports.`,
      'Current Gearsystem MCP macro monitor output records breakpoint reachability and operation ids, but not the required clean hook field values.',
    ],
    nextLeads: [
      'Extend the MCP monitor/debugger bridge to emit same-frame metadata observations for the listed hook ids.',
      'Keep the existing macro reports as reachability evidence only until clean hook fields are captured.',
      'Run the residual closure pipeline only after observations include every missingCleanHookField for a target region.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'gearsystem_mcp_clean_hook_gap' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpCleanHookGapAudit = {
      catalogId,
      kind: 'gearsystem_mcp_clean_hook_gap',
      status: record.status,
      confidence: record.readRangeHitObserved ? 'medium_runtime_reachability' : 'low_waiting_for_runtime_evidence',
      readRangeHitObserved: record.readRangeHitObserved,
      cleanHookObservationReady: false,
      closureReady: false,
      semanticPromotionReady: false,
      tracePlanId: record.tracePlanId,
      targetOffsets: record.targetOffsets,
      requiredRuntimeHookIds: record.requiredRuntimeHookIds,
      requiredFieldCount: record.requiredFieldCount,
      observedCleanHookFieldCount: 0,
      missingCleanHookFieldCount: record.missingCleanHookFieldCount,
      missingCleanHookFields: record.missingCleanHookFields,
      executionBreakpointHookIds: record.executionBreakpointHookIds,
      readRangeAdapterHookIds: record.readRangeAdapterHookIds,
      captureAdapterHookIds: record.captureAdapterHookIds,
      missingExecutionBreakpointHookIds: record.missingExecutionBreakpointHookIds,
      missingCaptureAdapterHookIds: record.missingCaptureAdapterHookIds,
      captureAdapterScaffoldReady: record.captureAdapterScaffoldReady,
      executionCaptureScaffoldReady: record.executionCaptureScaffoldReady,
      executionCaptureFieldNameCount: record.executionCaptureFieldNameCount,
      executionRequiredCaptureFieldNameCount: record.executionRequiredCaptureFieldNameCount,
      readRangeCaptureFieldNameCount: record.readRangeCaptureFieldNameCount,
      readRangeRequiredCaptureFieldNameCount: record.readRangeRequiredCaptureFieldNameCount,
      readRangeOperationIds: record.readRangeOperationIds,
      matchedOperationIds: uniqueSorted(record.macroReports.flatMap(report => report.matchedOperationIds || [])),
      starterExecutionProbeReportCount: record.executionProbeReports.length,
      starterExecutionProbeMatchedExecutionHitCount: record.executionProbeReports.reduce((sum, report) => sum + report.matchedExecutionHitCount, 0),
      starterExecutionProbeMatchedReadRangeInferenceHitCount: record.executionProbeReports.reduce((sum, report) => sum + report.matchedReadRangeInferenceHitCount, 0),
      starterExecutionProbeUnmatchedBreakpointHitCount: record.executionProbeReports.reduce((sum, report) => sum + report.unmatchedBreakpointHitCount, 0),
      starterExecutionProbeReports: record.executionProbeReports,
      nextDebuggerCapability: record.nextDebuggerCapability,
      summary: 'Current Gearsystem MCP macro reports prove read-range reachability only; clean same-frame hook fields are still required before closure proof or semantic promotion.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      status: record.status,
      missingCleanHookFieldCount: record.missingCleanHookFieldCount,
    });
  }

  mapData.gearsystemMcpCleanHookGapCatalogs = (mapData.gearsystemMcpCleanHookGapCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpCleanHookGapCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_clean_hook_gap_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
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
  staticMap.summary.gearsystemMcpCleanHookGapCatalog = catalogId;
  staticMap.summary.gearsystemMcpCleanHookGapResidualRegionCount = catalog.summary.residualRegionCount;
  staticMap.summary.gearsystemMcpCleanHookGapReadRangeHitObservedCount = catalog.summary.readRangeHitObservedCount;
  staticMap.summary.gearsystemMcpCleanHookGapExecutionCaptureScaffoldReadyCount = catalog.summary.executionCaptureScaffoldReadyCount;
  staticMap.summary.gearsystemMcpCleanHookGapExecutionCaptureScaffoldBlockedCount = catalog.summary.executionCaptureScaffoldBlockedCount;
  staticMap.summary.gearsystemMcpCleanHookGapCaptureAdapterScaffoldReadyCount = catalog.summary.captureAdapterScaffoldReadyCount;
  staticMap.summary.gearsystemMcpCleanHookGapCaptureAdapterScaffoldBlockedCount = catalog.summary.captureAdapterScaffoldBlockedCount;
  staticMap.summary.gearsystemMcpCleanHookGapCleanHookObservationReadyCount = catalog.summary.cleanHookObservationReadyCount;
  staticMap.summary.gearsystemMcpCleanHookGapClosureReadyCount = catalog.summary.closureReadyCount;
  staticMap.summary.gearsystemMcpCleanHookGapSemanticPromotionReadyCount = catalog.summary.semanticPromotionReadyCount;
  staticMap.summary.gearsystemMcpCleanHookGapTotalRequiredFieldCount = catalog.summary.totalRequiredFieldCount;
  staticMap.summary.gearsystemMcpCleanHookGapTotalExecutionRequiredCaptureFieldNameCount = catalog.summary.totalExecutionRequiredCaptureFieldNameCount;
  staticMap.summary.gearsystemMcpCleanHookGapTotalReadRangeRequiredCaptureFieldNameCount = catalog.summary.totalReadRangeRequiredCaptureFieldNameCount;
  staticMap.summary.gearsystemMcpCleanHookGapTotalMissingCleanHookFieldCount = catalog.summary.totalMissingCleanHookFieldCount;
  staticMap.summary.gearsystemMcpCleanHookGapExecutionProbeReportCount = catalog.summary.executionProbeReportCount;
  staticMap.summary.gearsystemMcpCleanHookGapExecutionProbeByteCleanReportCount = catalog.summary.executionProbeByteCleanReportCount;
  staticMap.summary.gearsystemMcpCleanHookGapExecutionProbeMatchedExecutionHitCount = catalog.summary.executionProbeMatchedExecutionHitCount;
  staticMap.summary.gearsystemMcpCleanHookGapExecutionProbeMatchedReadRangeInferenceHitCount = catalog.summary.executionProbeMatchedReadRangeInferenceHitCount;
  staticMap.summary.gearsystemMcpCleanHookGapExecutionProbeUnmatchedBreakpointHitCount = catalog.summary.executionProbeUnmatchedBreakpointHitCount;
  staticMap.summary.gearsystemMcpCleanHookGapRequiresDebuggerCallbackFieldCapture = catalog.summary.requiresDebuggerCallbackFieldCapture;
  staticMap.summary.gearsystemMcpCleanHookGapCurrentMcpMacroReportsAreReachabilityOnly = catalog.summary.currentMcpMacroReportsAreReachabilityOnly;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-clean-hook-gap-catalog-2026-06-26 to extend Gearsystem MCP from read-range reachability into clean same-frame residual hook observations.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const apply = process.argv.includes('--apply');
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let annotation = { changedRegions: [], missingRegions: [] };
  if (apply) {
    annotation = applyCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }
  console.log(JSON.stringify({
    ok: true,
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
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
    }, null, 2));
    process.exitCode = 1;
  }
}
