#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const setupPlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-setup-plan.json');
const defaultPlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-macro-monitor-plan.json');
const defaultReportPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-macro-monitor.local.json');
const toolName = 'tools/world-gearsystem-mcp-macro-monitor.mjs';
const now = '2026-06-26T00:00:00Z';
const callbackCapturePlanCatalogId = 'world-gearsystem-mcp-callback-capture-plan-catalog-2026-06-26';

const routeCatalog = [
  {
    id: 'boot_start_idle_probe',
    label: 'Boot start idle probe',
    purpose: 'Get past title/start handling and leave the game running long enough to catch boot-time residual consumers.',
    commands: [
      { wait: 60 },
      { tap: 'start' },
      { wait: 240 },
    ],
    targetRegionIds: ['r2813', 'r2815', 'r2816', 'r2817', 'r0749'],
  },
  {
    id: 'boot_start_right_probe',
    label: 'Boot start right-walk probe',
    purpose: 'Exercise early player control after start using right movement without asserting any room/state claim.',
    commands: [
      { wait: 60 },
      { tap: 'start' },
      { wait: 180 },
      { press: 'right' },
      { wait: 360 },
      { release: 'right' },
      { wait: 60 },
    ],
    targetRegionIds: ['r2813', 'r2815', 'r2816', 'r2817', 'r0749'],
  },
  {
    id: 'boot_start_right_jump_probe',
    label: 'Boot start right+jump probe',
    purpose: 'Exercise early movement plus button-1 jump/action timing; this is a controller route seed, not proof of residual use.',
    commands: [
      { wait: 60 },
      { tap: 'start' },
      { wait: 180 },
      { press: 'right' },
      { wait: 120 },
      { tap: '1' },
      { wait: 240 },
      { release: 'right' },
      { wait: 60 },
    ],
    targetRegionIds: ['r2813', 'r2815', 'r2816', 'r2817', 'r0749'],
  },
];

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function argValues(name) {
  const values = [];
  process.argv.forEach((arg, index) => {
    if (arg === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  });
  return values;
}

function hasArg(name) {
  return process.argv.includes(name);
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeLogicalAddress(value) {
  const text = String(value || '').trim().replace(/^\$/, '').replace(/^0x/i, '');
  if (!text) return '';
  return `0x${text.toUpperCase().padStart(4, '0')}`;
}

function operationLogicalAddress(operation) {
  return normalizeLogicalAddress(operation.source?.logicalAddress || operation.arguments?.address || '');
}

function buildExecutionOperationIndex(setupPlan) {
  const byAddress = new Map();
  for (const operation of setupPlan.operations || []) {
    if (operation.kind !== 'execution_breakpoint') continue;
    const address = operationLogicalAddress(operation);
    if (!address) continue;
    if (!byAddress.has(address)) byAddress.set(address, []);
    byAddress.get(address).push(operation);
  }
  return byAddress;
}

function compactOperation(operation) {
  return {
    operationId: operation.id,
    kind: operation.kind,
    regionIds: operation.regionIds || operation.source?.regionIds || (operation.source?.regionId ? [operation.source.regionId] : []),
    hookIds: operation.source?.hookIds || [],
    labels: operation.source?.labels || [],
    hookOffsets: operation.source?.hookOffsets || [],
    hookBreakpointRoles: operation.source?.hookBreakpointRoles || [],
    captureFields: operation.source?.captureFields || [],
    requiredCaptureFields: operation.source?.requiredCaptureFields || [],
    expectedBank: operation.source?.bank || null,
  };
}

function operationRegionIds(operation) {
  return [
    ...(operation.regionIds || []),
    ...(operation.source?.regionIds || []),
    operation.source?.regionId,
  ].filter(Boolean);
}

function filterSetupPlanOperations(setupPlan, options = {}) {
  const regionFilters = new Set(normalizeFilters(options.regionIds || []));
  const operationFilters = new Set(normalizeFilters(options.operationIds || []));
  const filtersActive = regionFilters.size > 0 || operationFilters.size > 0;
  if (!filtersActive) return setupPlan;
  const operations = (setupPlan.operations || []).filter(operation => {
    if (operationFilters.size && !operationFilters.has(operation.id)) return false;
    if (!regionFilters.size) return operationFilters.size > 0;
    return operationRegionIds(operation).some(regionId => regionFilters.has(regionId));
  });
  return {
    ...setupPlan,
    summary: {
      ...(setupPlan.summary || {}),
      operationCount: operations.length,
      executionBreakpointCount: operations.filter(operation => operation.kind === 'execution_breakpoint').length,
      readRangeBreakpointCount: operations.filter(operation => operation.kind === 'read_range_breakpoint').length,
      executionCaptureFieldNameCount: new Set(operations
        .filter(operation => operation.kind === 'execution_breakpoint')
        .flatMap(operation => operation.source?.captureFields || [])).size,
      executionRequiredCaptureFieldNameCount: new Set(operations
        .filter(operation => operation.kind === 'execution_breakpoint')
        .flatMap(operation => operation.source?.requiredCaptureFields || [])).size,
      readRangeAdapterHookCount: new Set(operations
        .filter(operation => operation.kind === 'read_range_breakpoint')
        .flatMap(operation => operation.source?.hookIds || [])).size,
      readRangeCaptureFieldNameCount: new Set(operations
        .filter(operation => operation.kind === 'read_range_breakpoint')
        .flatMap(operation => operation.source?.captureFields || [])).size,
      readRangeRequiredCaptureFieldNameCount: new Set(operations
        .filter(operation => operation.kind === 'read_range_breakpoint')
        .flatMap(operation => operation.source?.requiredCaptureFields || [])).size,
      operationFilterApplied: true,
      operationFilterRegionIds: [...regionFilters].sort(),
      operationFilterOperationIds: [...operationFilters].sort(),
    },
    operations,
  };
}

function compactRoute(route) {
  const buttons = [];
  let waitFrameCount = 0;
  for (const command of route.commands || []) {
    if (command.wait != null) waitFrameCount += Number(command.wait) || 0;
    for (const key of ['tap', 'press', 'release']) {
      if (command[key]) buttons.push(`${key}:${command[key]}`);
    }
  }
  return {
    id: route.id,
    label: route.label,
    purpose: route.purpose,
    targetRegionIds: route.targetRegionIds || [],
    commandCount: route.commands?.length || 0,
    waitFrameCount,
    buttons: [...new Set(buttons)].sort(),
    commands: route.commands || [],
  };
}

function normalizeFilters(values) {
  return [...new Set((values || [])
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim())
    .filter(Boolean))].sort();
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

function loadCallbackCapturePlanCatalog(options = {}) {
  if (options.disableCallbackCapturePlan || !fs.existsSync(mapPath)) return null;
  try {
    return findCatalog(readJson(mapPath), callbackCapturePlanCatalogId);
  } catch {
    return null;
  }
}

function compactCallbackCaptureTask(task) {
  return {
    regionId: task.regionId,
    hookId: task.hookId,
    operationKind: task.operationKind,
    status: task.status,
    operationIds: task.operationIds || [],
    requiredFields: task.requiredFields || [],
    remainingCallbackFields: task.remainingCallbackFields || [],
    remainingDerivationFields: task.remainingDerivationFields || [],
    candidateFilledFields: task.candidateFilledFields || [],
    candidateOnly: task.candidateOnly === true,
    canWriteRuntimeObservationNow: task.canWriteRuntimeObservationNow === true,
    closureReady: task.closureReady === true,
    semanticPromotionReady: task.semanticPromotionReady === true,
  };
}

function buildCallbackCaptureTaskIndex(catalog) {
  const byOperationId = new Map();
  const tasks = [];
  for (const record of catalog?.records || []) {
    for (const task of record.tasks || []) {
      const compact = compactCallbackCaptureTask(task);
      tasks.push(compact);
      for (const operationId of compact.operationIds || []) {
        if (!byOperationId.has(operationId)) byOperationId.set(operationId, []);
        byOperationId.get(operationId).push(compact);
      }
    }
  }
  return { byOperationId, tasks };
}

function callbackTasksForMatchedOperations(matched, callbackCaptureTaskIndex) {
  const byKey = new Map();
  for (const match of matched || []) {
    for (const task of callbackCaptureTaskIndex?.byOperationId?.get(match.operationId) || []) {
      const key = `${task.regionId}:${task.hookId}:${task.operationKind}`;
      if (!byKey.has(key)) byKey.set(key, task);
    }
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.regionId}:${a.hookId}:${a.operationKind}`.localeCompare(`${b.regionId}:${b.hookId}:${b.operationKind}`));
}

function selectRoutes(routeIds, allRoutes) {
  const filters = normalizeFilters(routeIds);
  if (allRoutes || !filters.length) return routeCatalog;
  const filterSet = new Set(filters);
  return routeCatalog.filter(route => filterSet.has(route.id));
}

async function rpc(baseUrl, method, params = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 1000000),
      method,
      params,
    }),
  });
  let json = null;
  try {
    const text = await response.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    ok: response.ok && !json?.error,
    status: response.status,
    json,
  };
}

async function callTool(baseUrl, name, args = {}) {
  return rpc(baseUrl, 'tools/call', {
    name,
    arguments: args,
  });
}

function sanitizeRpcResult(result) {
  const json = result.json || {};
  const content = Array.isArray(json.result?.content) ? json.result.content : [];
  return {
    ok: result.ok === true,
    status: result.status,
    hasResult: Boolean(json.result),
    resultKeys: json.result && typeof json.result === 'object' ? Object.keys(json.result).sort() : [],
    contentItemCount: content.length,
    contentTypes: [...new Set(content.map(item => item?.type).filter(Boolean))].sort(),
    errorCode: json.error?.code ?? null,
    errorMessage: json.error?.message || null,
  };
}

function parseToolTextJson(result) {
  const text = result.json?.result?.content?.find(item => item?.type === 'text')?.text || '{}';
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function statusSnapshot(result) {
  const status = parseToolTextJson(result);
  return {
    requestOk: result.ok === true,
    responseStatus: result.status,
    paused: status.paused === true,
    atBreakpoint: status.at_breakpoint === true,
    transientPc: normalizeLogicalAddress(status.pc || ''),
  };
}

function matchExecutionOperations(snapshot, operationIndex) {
  if (!snapshot.atBreakpoint || !snapshot.transientPc) return [];
  return (operationIndex.get(snapshot.transientPc) || []).map(compactOperation);
}

function compactHitSnapshot(snapshot, matches, routeId, pollIndex, elapsedMs, readRangeInferenceOperations = [], callbackCaptureTaskIndex = null) {
  const inferredReadMatches = !matches.length && snapshot.atBreakpoint && readRangeInferenceOperations.length === 1
    ? readRangeInferenceOperations.map(compactOperation)
    : [];
  const matched = matches.length ? matches : inferredReadMatches;
  const callbackCaptureTasks = callbackTasksForMatchedOperations(matched, callbackCaptureTaskIndex);
  return {
    routeId,
    pollIndex,
    elapsedMs,
    atBreakpoint: snapshot.atBreakpoint,
    paused: snapshot.paused,
    matchKind: matches.length
      ? 'execution_breakpoint_pc_match'
      : inferredReadMatches.length
        ? 'single_active_read_range_breakpoint_inference'
        : 'breakpoint_hit_no_persisted_pc_match',
    matchedOperationIds: matched.map(item => item.operationId),
    matchedRegionIds: [...new Set(matched.flatMap(item => item.regionIds || []))].sort(),
    matchedHookIds: [...new Set(matched.flatMap(item => item.hookIds || []))].sort(),
    matchedLabels: [...new Set(matched.flatMap(item => item.labels || []))].sort(),
    matchedHookOffsets: [...new Set(matched.flatMap(item => item.hookOffsets || []))].sort(),
    matchedHookBreakpointRoles: [...new Set(matched.flatMap(item => item.hookBreakpointRoles || []))].sort(),
    matchedCaptureFields: [...new Set(matched.flatMap(item => item.captureFields || []))].sort(),
    matchedRequiredCaptureFields: [...new Set(matched.flatMap(item => item.requiredCaptureFields || []))].sort(),
    expectedBanks: [...new Set(matched.map(item => item.expectedBank).filter(Boolean))].sort(),
    callbackCapturePlanCatalogId: callbackCaptureTaskIndex ? callbackCapturePlanCatalogId : null,
    matchedCallbackCaptureTaskCount: callbackCaptureTasks.length,
    matchedCallbackCaptureTasks: callbackCaptureTasks,
    matchedRemainingCallbackFields: uniqueSorted(callbackCaptureTasks.flatMap(task => task.remainingCallbackFields || [])),
    matchedRemainingDerivationFields: uniqueSorted(callbackCaptureTasks.flatMap(task => task.remainingDerivationFields || [])),
    callbackCapturePlanMatched: callbackCaptureTasks.length > 0,
    captureFieldValuePersistence: matched.length
      ? 'field_names_only_values_not_persisted'
      : 'no_matched_capture_field_plan',
  };
}

async function initialize(baseUrl) {
  return rpc(baseUrl, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'wb3-world-gearsystem-macro-monitor', version: '1' },
  });
}

async function installBreakpoints(baseUrl, setupPlan) {
  const results = [];
  for (const operation of setupPlan.operations || []) {
    const called = await callTool(baseUrl, operation.tool, operation.arguments || {});
    results.push({
      operationId: operation.id,
      kind: operation.kind,
      result: sanitizeRpcResult(called),
    });
  }
  return results;
}

function removeArgumentsForOperation(operation) {
  const args = operation.arguments || {};
  if (operation.kind === 'read_range_breakpoint' && args.start_address) {
    return {
      address: args.start_address,
      end_address: args.end_address,
      memory_area: args.memory_area || 'rom_ram',
    };
  }
  return {
    address: args.address || args.start_address,
    memory_area: args.memory_area || 'rom_ram',
  };
}

async function clearBreakpoints(baseUrl, setupPlan) {
  const results = [];
  for (const operation of setupPlan.operations || []) {
    const args = removeArgumentsForOperation(operation);
    if (!args.address) continue;
    const called = await callTool(baseUrl, 'remove_breakpoint', args);
    results.push({
      operationId: operation.id,
      kind: `clear:${operation.kind}`,
      result: sanitizeRpcResult(called),
    });
  }
  return results;
}

async function pollForHits(baseUrl, routeId, operationIndex, options = {}) {
  const hitSnapshots = [];
  const statusSummaries = [];
  const readRangeInferenceOperations = options.readRangeInferenceOperations || [];
  const started = Date.now();
  const pollCount = Math.max(1, Number(options.pollCount || 20));
  const pollMs = Math.max(10, Number(options.pollMs || 100));
  for (let index = 0; index < pollCount; index++) {
    if (index > 0) await sleep(pollMs);
    const statusResult = await callTool(baseUrl, 'debug_get_status', {});
    const snapshot = statusSnapshot(statusResult);
    const elapsedMs = Date.now() - started;
    statusSummaries.push({
      pollIndex: index,
      elapsedMs,
      requestOk: snapshot.requestOk,
      paused: snapshot.paused,
      atBreakpoint: snapshot.atBreakpoint,
    });
    if (snapshot.atBreakpoint) {
      const matches = matchExecutionOperations(snapshot, operationIndex);
      hitSnapshots.push(compactHitSnapshot(
        snapshot,
        matches,
        routeId,
        index,
        elapsedMs,
        readRangeInferenceOperations,
        options.callbackCaptureTaskIndex || null,
      ));
      if (options.stopOnHit) break;
    }
  }
  return { hitSnapshots, statusSummaries };
}

async function runRoute(baseUrl, setupPlan, route, options = {}) {
  const operationIndex = buildExecutionOperationIndex(setupPlan);
  const readRangeInferenceOperations = (setupPlan.operations || []).filter(operation => operation.kind === 'read_range_breakpoint');
  const controlResults = [];
  if (options.resetBeforeRoute) {
    const reset = await callTool(baseUrl, 'debug_reset', {});
    controlResults.push({ kind: 'debug_reset', result: sanitizeRpcResult(reset) });
  }
  if (options.clearExistingBreakpoints) {
    const clearResults = await clearBreakpoints(baseUrl, options.clearSetupPlan || setupPlan);
    controlResults.push(...clearResults.map(result => ({ kind: result.kind, result: result.result })));
  }
  if (options.setupBreakpoints) {
    const setupResults = await installBreakpoints(baseUrl, setupPlan);
    controlResults.push(...setupResults.map(result => ({ kind: `setup:${result.kind}`, result: result.result })));
  }
  const continued = await callTool(baseUrl, 'debug_continue', {});
  controlResults.push({ kind: 'debug_continue', result: sanitizeRpcResult(continued) });
  if (!continued.ok) return { route, controlResults, hitSnapshots: [], statusSummaries: [] };

  const macro = await callTool(baseUrl, 'controller_macro', {
    commands: route.commands || [],
  });
  controlResults.push({ kind: 'controller_macro', result: sanitizeRpcResult(macro) });

  const polled = await pollForHits(baseUrl, route.id, operationIndex, {
    ...options,
    readRangeInferenceOperations,
  });
  if (options.pauseAtEnd) {
    const paused = await callTool(baseUrl, 'debug_pause', {});
    controlResults.push({ kind: 'debug_pause_end', result: sanitizeRpcResult(paused) });
  }
  return {
    route,
    controlResults,
    hitSnapshots: polled.hitSnapshots,
    statusSummaries: polled.statusSummaries,
  };
}

function buildPlan(setupPlan, options = {}) {
  const selectedRoutes = selectRoutes(options.routeIds || [], options.allRoutes);
  const callbackCaptureCatalog = options.callbackCapturePlanCatalog || null;
  const callbackCaptureTaskIndex = buildCallbackCaptureTaskIndex(callbackCaptureCatalog);
  return {
    schemaVersion: 1,
    eventKind: 'wb3_gearsystem_mcp_macro_monitor_plan',
    generatedAt: now,
    generatedBy: toolName,
    sourceSetupPlan: 'gearsystem/world-residual-mcp-setup-plan.json',
    sourceCallbackCapturePlanCatalog: callbackCaptureCatalog?.id || null,
    baseUrl: options.baseUrl || setupPlan.baseUrl || 'http://127.0.0.1:7777',
    executed: false,
    summary: {
      routeCount: selectedRoutes.length,
      catalogRouteCount: routeCatalog.length,
      setupOperationCount: setupPlan.summary?.operationCount || 0,
      monitoredExecutionBreakpointCount: setupPlan.summary?.executionBreakpointCount || 0,
      monitoredReadRangeBreakpointCount: setupPlan.summary?.readRangeBreakpointCount || 0,
      monitoredExecutionCaptureFieldNameCount: setupPlan.summary?.executionCaptureFieldNameCount || 0,
      monitoredExecutionRequiredCaptureFieldNameCount: setupPlan.summary?.executionRequiredCaptureFieldNameCount || 0,
      monitoredReadRangeAdapterHookCount: setupPlan.summary?.readRangeAdapterHookCount || 0,
      monitoredReadRangeCaptureFieldNameCount: setupPlan.summary?.readRangeCaptureFieldNameCount || 0,
      monitoredReadRangeRequiredCaptureFieldNameCount: setupPlan.summary?.readRangeRequiredCaptureFieldNameCount || 0,
      callbackCapturePlanLoaded: Boolean(callbackCaptureCatalog),
      callbackCapturePlanCatalogId: callbackCaptureCatalog?.id || null,
      callbackCapturePlanTaskCount: callbackCaptureCatalog?.summary?.captureTaskCount || callbackCaptureTaskIndex.tasks.length,
      callbackCapturePlanCallbackTaskCount: callbackCaptureCatalog?.summary?.callbackTaskCount || callbackCaptureTaskIndex.tasks.filter(task => task.operationKind !== 'same_frame_derivation').length,
      callbackCapturePlanRemainingCallbackFieldCount: callbackCaptureCatalog?.summary?.remainingCallbackFieldCount || 0,
      operationFilterApplied: setupPlan.summary?.operationFilterApplied === true,
      operationFilterRegionIds: setupPlan.summary?.operationFilterRegionIds || [],
      operationFilterOperationIds: setupPlan.summary?.operationFilterOperationIds || [],
      totalRouteCommandCount: selectedRoutes.reduce((sum, route) => sum + (route.commands?.length || 0), 0),
      totalRouteWaitFrameCount: selectedRoutes.reduce((sum, route) => sum + compactRoute(route).waitFrameCount, 0),
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
    routes: selectedRoutes.map(compactRoute),
    commands: {
      launch: 'node tools/world-gearsystem-launch.mjs --port 7777',
      runFirstRoute: 'node tools/world-gearsystem-mcp-macro-monitor.mjs --execute --setup --reset --route boot_start_idle_probe --port 7777 --out tmp/world-gearsystem-mcp-macro-monitor.local.json',
      runAllRoutes: 'node tools/world-gearsystem-mcp-macro-monitor.mjs --execute --setup --reset --all-routes --port 7777 --out tmp/world-gearsystem-mcp-macro-monitor.local.json',
      runAllRoutesClean: 'node tools/world-gearsystem-mcp-macro-monitor.mjs --execute --setup --clear-existing --reset --all-routes --port 7777 --out tmp/world-gearsystem-mcp-macro-monitor.local.json',
    },
    assetPolicy: 'Metadata only: route ids, controller button names, wait-frame counts, route command kinds, matched operation ids, region ids, hook ids, labels, hook roles, capture field names, callback task statuses, expected banks, and sanitized MCP call summaries. The tool may use PC transiently to match known execution breakpoints, but it does not persist PC/register values, memory bytes, trace-log entries, VDP port values, screenshots, pixels, audio bytes, samples, or instruction bytes.',
  };
}

function buildReport(setupPlan, results, options = {}) {
  const callbackCaptureCatalog = options.callbackCapturePlanCatalog || null;
  const callbackCaptureTaskIndex = buildCallbackCaptureTaskIndex(callbackCaptureCatalog);
  const routeReports = results.map(result => {
    const controlResults = result.controlResults || [];
    const hitSnapshots = result.hitSnapshots || [];
    const statusSummaries = result.statusSummaries || [];
    return {
      route: compactRoute(result.route),
      summary: {
        controlResultCount: controlResults.length,
        failedControlResultCount: controlResults.filter(item => item.result?.ok !== true).length,
        pollCount: statusSummaries.length,
        requestOkPollCount: statusSummaries.filter(item => item.requestOk).length,
        breakpointHitCount: hitSnapshots.length,
        matchedExecutionHitCount: hitSnapshots.filter(item => item.matchKind === 'execution_breakpoint_pc_match').length,
        matchedReadRangeInferenceHitCount: hitSnapshots.filter(item => item.matchKind === 'single_active_read_range_breakpoint_inference').length,
        unmatchedBreakpointHitCount: hitSnapshots.filter(item => item.matchedOperationIds.length === 0).length,
      },
      hitSnapshots,
      controlResults,
    };
  });
  const allHits = routeReports.flatMap(route => route.hitSnapshots || []);
  const allControlResults = routeReports.flatMap(route => route.controlResults || []);
  const allMatchedCallbackTasks = allHits.flatMap(hit => hit.matchedCallbackCaptureTasks || []);
  return {
    schemaVersion: 1,
    eventKind: 'wb3_gearsystem_mcp_macro_monitor_report',
    generatedAt: now,
    generatedBy: toolName,
    sourceSetupPlan: 'gearsystem/world-residual-mcp-setup-plan.json',
    sourceCallbackCapturePlanCatalog: callbackCaptureCatalog?.id || null,
    baseUrl: options.baseUrl || setupPlan.baseUrl || 'http://127.0.0.1:7777',
    executed: true,
    summary: {
      routeCount: routeReports.length,
      setupBreakpoints: options.setupBreakpoints === true,
      clearExistingBreakpoints: options.clearExistingBreakpoints === true,
      resetBeforeRoute: options.resetBeforeRoute === true,
      pollCount: routeReports.reduce((sum, route) => sum + route.summary.pollCount, 0),
      requestedPollCountPerRoute: options.pollCount,
      pollMs: options.pollMs,
      stopOnHit: options.stopOnHit === true,
      pauseAtEnd: options.pauseAtEnd === true,
      controlResultCount: allControlResults.length,
      failedControlResultCount: allControlResults.filter(item => item.result?.ok !== true).length,
      breakpointHitCount: allHits.length,
      matchedExecutionHitCount: allHits.filter(item => item.matchKind === 'execution_breakpoint_pc_match').length,
      matchedReadRangeInferenceHitCount: allHits.filter(item => item.matchKind === 'single_active_read_range_breakpoint_inference').length,
      unmatchedBreakpointHitCount: allHits.filter(item => item.matchedOperationIds.length === 0).length,
      monitoredExecutionBreakpointCount: setupPlan.summary?.executionBreakpointCount || 0,
      monitoredReadRangeBreakpointCount: setupPlan.summary?.readRangeBreakpointCount || 0,
      monitoredExecutionCaptureFieldNameCount: setupPlan.summary?.executionCaptureFieldNameCount || 0,
      monitoredExecutionRequiredCaptureFieldNameCount: setupPlan.summary?.executionRequiredCaptureFieldNameCount || 0,
      monitoredReadRangeAdapterHookCount: setupPlan.summary?.readRangeAdapterHookCount || 0,
      monitoredReadRangeCaptureFieldNameCount: setupPlan.summary?.readRangeCaptureFieldNameCount || 0,
      monitoredReadRangeRequiredCaptureFieldNameCount: setupPlan.summary?.readRangeRequiredCaptureFieldNameCount || 0,
      callbackCapturePlanLoaded: Boolean(callbackCaptureCatalog),
      callbackCapturePlanCatalogId: callbackCaptureCatalog?.id || null,
      callbackCapturePlanTaskCount: callbackCaptureCatalog?.summary?.captureTaskCount || callbackCaptureTaskIndex.tasks.length,
      callbackCapturePlanCallbackTaskCount: callbackCaptureCatalog?.summary?.callbackTaskCount || callbackCaptureTaskIndex.tasks.filter(task => task.operationKind !== 'same_frame_derivation').length,
      callbackCapturePlanRemainingCallbackFieldCount: callbackCaptureCatalog?.summary?.remainingCallbackFieldCount || 0,
      callbackCapturePlanMatchedHitCount: allHits.filter(hit => hit.callbackCapturePlanMatched).length,
      callbackCapturePlanMatchedTaskCount: allMatchedCallbackTasks.length,
      callbackCapturePlanMatchedRemainingCallbackFields: uniqueSorted(allMatchedCallbackTasks.flatMap(task => task.remainingCallbackFields || [])),
      operationFilterApplied: setupPlan.summary?.operationFilterApplied === true,
      operationFilterRegionIds: setupPlan.summary?.operationFilterRegionIds || [],
      operationFilterOperationIds: setupPlan.summary?.operationFilterOperationIds || [],
      macroMonitorUsable: allControlResults.length > 0 && allControlResults.every(item => item.result?.ok === true),
      runtimeObservationPromotionReady: false,
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
    routeReports,
    nextLeads: allHits.length
      ? [
          'Use matched route/hook metadata to fill only the required local observation fields that can be supported by real runtime evidence.',
          'Run the local observation audit before applying any residual proof metadata.',
        ]
      : [
          'No residual breakpoint hit was observed in these starter macro routes; add deeper route/save-state seeds.',
          'Keep all five residual regions quarantined until reviewed local observations pass the closure pipeline.',
        ],
    assetPolicy: 'Metadata only: route ids, controller button names, wait-frame counts, route command kinds, matched operation ids, region ids, hook ids, labels, hook roles, capture field names, callback task statuses, expected banks, and sanitized MCP call summaries. The tool may use PC transiently to match known execution breakpoints, but it does not persist PC/register values, memory bytes, trace-log entries, VDP port values, screenshots, pixels, audio bytes, samples, or instruction bytes.',
  };
}

async function main() {
  const execute = hasArg('--execute');
  const setupBreakpoints = hasArg('--setup');
  const clearExistingBreakpoints = hasArg('--clear-existing');
  const resetBeforeRoute = hasArg('--reset');
  const allRoutes = hasArg('--all-routes');
  const stopOnHit = !hasArg('--no-stop-on-hit');
  const pauseAtEnd = !hasArg('--no-pause-at-end');
  const pollCount = Number(argValue('--polls') || argValue('--poll-count') || 20);
  const pollMs = Number(argValue('--poll-ms') || 100);
  const baseUrl = argValue('--url') || `http://${argValue('--address') || '127.0.0.1'}:${argValue('--port') || '7777'}`;
  const routeIds = normalizeFilters([...argValues('--route'), ...argValues('--routes')]);
  const regionIds = normalizeFilters([...argValues('--region'), ...argValues('--regions')]);
  const operationIds = normalizeFilters([...argValues('--operation'), ...argValues('--operations')]);
  const outputPath = resolveRepoPath(argValue('--out')) || (execute ? defaultReportPath : defaultPlanPath);
  const baseSetupPlan = readJson(setupPlanPath);
  const callbackCapturePlanCatalog = loadCallbackCapturePlanCatalog({
    disableCallbackCapturePlan: hasArg('--no-callback-capture-plan'),
  });
  const callbackCaptureTaskIndex = buildCallbackCaptureTaskIndex(callbackCapturePlanCatalog);
  const setupPlan = filterSetupPlanOperations(baseSetupPlan, {
    regionIds,
    operationIds,
  });
  const selectedRoutes = selectRoutes(routeIds, allRoutes);
  if (!selectedRoutes.length) throw new Error(`No macro routes matched: ${routeIds.join(', ')}`);

  if (!execute) {
    const plan = buildPlan(setupPlan, {
      baseUrl,
      routeIds,
      allRoutes,
      callbackCapturePlanCatalog,
    });
    writeJson(outputPath, plan);
    console.log(JSON.stringify({
      ok: true,
      executed: false,
      output: path.relative(repoRoot, outputPath),
      summary: plan.summary,
      assetPolicy: plan.assetPolicy,
    }, null, 2));
    return;
  }

  const init = await initialize(baseUrl);
  if (!init.ok) {
    const report = buildReport(setupPlan, [{
      route: selectedRoutes[0],
      controlResults: [{ kind: 'initialize', result: sanitizeRpcResult(init) }],
      hitSnapshots: [],
      statusSummaries: [],
    }], {
      baseUrl,
      setupBreakpoints,
      clearExistingBreakpoints,
      clearSetupPlan: baseSetupPlan,
      resetBeforeRoute,
      pollCount,
      pollMs,
      stopOnHit,
      pauseAtEnd,
      callbackCapturePlanCatalog,
    });
    writeJson(outputPath, report);
    console.log(JSON.stringify({ ok: false, output: path.relative(repoRoot, outputPath), summary: report.summary }, null, 2));
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const route of selectedRoutes) {
    results.push(await runRoute(baseUrl, setupPlan, route, {
      setupBreakpoints,
      clearExistingBreakpoints,
      clearSetupPlan: baseSetupPlan,
      resetBeforeRoute,
      pollCount,
      pollMs,
      stopOnHit,
      pauseAtEnd,
      callbackCaptureTaskIndex,
    }));
  }
  if (results.length) {
    results[0].controlResults = [
      { kind: 'initialize', result: sanitizeRpcResult(init) },
      ...(results[0].controlResults || []),
    ];
  }
  const report = buildReport(setupPlan, results, {
    baseUrl,
    setupBreakpoints,
    clearExistingBreakpoints,
    resetBeforeRoute,
    pollCount,
    pollMs,
    stopOnHit,
    pauseAtEnd,
    callbackCapturePlanCatalog,
  });
  writeJson(outputPath, report);
  console.log(JSON.stringify({
    ok: report.summary.macroMonitorUsable,
    executed: true,
    output: path.relative(repoRoot, outputPath),
    summary: report.summary,
    assetPolicy: report.assetPolicy,
  }, null, 2));
  if (!report.summary.macroMonitorUsable) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      hint: 'Start Gearsystem first: node tools/world-gearsystem-launch.mjs --port 7777',
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
  });
}

export {
  buildCallbackCaptureTaskIndex,
  compactHitSnapshot,
  compactOperation,
};
