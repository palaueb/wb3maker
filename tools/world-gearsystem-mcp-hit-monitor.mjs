#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const setupPlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-setup-plan.json');
const defaultPlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-hit-monitor-plan.json');
const defaultReportPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-hit-monitor.local.json');
const toolName = 'tools/world-gearsystem-mcp-hit-monitor.mjs';
const now = '2026-06-26T00:00:00Z';

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
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
    expectedBank: operation.source?.bank || null,
    traceKind: operation.traceKind || '',
  };
}

function compactSetupPlan(setupPlan) {
  return {
    setupPlanEventKind: setupPlan.eventKind,
    sourceSetupPlan: 'gearsystem/world-residual-mcp-setup-plan.json',
    targetCount: setupPlan.summary?.targetCount || 0,
    operationCount: setupPlan.summary?.operationCount || 0,
    executionBreakpointCount: setupPlan.summary?.executionBreakpointCount || 0,
    readRangeBreakpointCount: setupPlan.summary?.readRangeBreakpointCount || 0,
    executionOperations: (setupPlan.operations || [])
      .filter(operation => operation.kind === 'execution_breakpoint')
      .map(compactOperation),
    readRangeOperations: (setupPlan.operations || [])
      .filter(operation => operation.kind === 'read_range_breakpoint')
      .map(compactOperation),
  };
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

function compactHitSnapshot(snapshot, matches, pollIndex, elapsedMs) {
  return {
    pollIndex,
    elapsedMs,
    atBreakpoint: snapshot.atBreakpoint,
    paused: snapshot.paused,
    matchKind: matches.length ? 'execution_breakpoint_pc_match' : 'breakpoint_hit_no_persisted_pc_match',
    matchedOperationIds: matches.map(item => item.operationId),
    matchedRegionIds: [...new Set(matches.flatMap(item => item.regionIds || []))].sort(),
    matchedHookIds: [...new Set(matches.flatMap(item => item.hookIds || []))].sort(),
    matchedLabels: [...new Set(matches.flatMap(item => item.labels || []))].sort(),
    expectedBanks: [...new Set(matches.map(item => item.expectedBank).filter(Boolean))].sort(),
  };
}

async function initialize(baseUrl) {
  return rpc(baseUrl, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'wb3-world-gearsystem-hit-monitor', version: '1' },
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

async function monitor(setupPlan, options = {}) {
  const baseUrl = options.baseUrl || setupPlan.baseUrl || 'http://127.0.0.1:7777';
  const operationIndex = buildExecutionOperationIndex(setupPlan);
  const controlResults = [];
  const hitSnapshots = [];
  const statusSummaries = [];

  const init = await initialize(baseUrl);
  controlResults.push({ kind: 'initialize', result: sanitizeRpcResult(init) });
  if (!init.ok) {
    return { controlResults, hitSnapshots, statusSummaries };
  }

  if (options.setupBreakpoints) {
    const setupResults = await installBreakpoints(baseUrl, setupPlan);
    controlResults.push(...setupResults.map(result => ({ kind: `setup:${result.kind}`, result: result.result })));
  }

  const continued = await callTool(baseUrl, 'debug_continue', {});
  controlResults.push({ kind: 'debug_continue', result: sanitizeRpcResult(continued) });
  if (!continued.ok) {
    return { controlResults, hitSnapshots, statusSummaries };
  }

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
      hitSnapshots.push(compactHitSnapshot(snapshot, matches, index, elapsedMs));
      if (options.stopOnHit) break;
    }
  }

  if (options.pauseAtEnd) {
    const paused = await callTool(baseUrl, 'debug_pause', {});
    controlResults.push({ kind: 'debug_pause_end', result: sanitizeRpcResult(paused) });
  }

  return { controlResults, hitSnapshots, statusSummaries };
}

function buildDryRunReport(setupPlan, options = {}) {
  const compactPlan = compactSetupPlan(setupPlan);
  return {
    schemaVersion: 1,
    eventKind: 'wb3_gearsystem_mcp_hit_monitor_plan',
    generatedAt: now,
    generatedBy: toolName,
    baseUrl: options.baseUrl || setupPlan.baseUrl || 'http://127.0.0.1:7777',
    executed: false,
    summary: {
      targetCount: compactPlan.targetCount,
      operationCount: compactPlan.operationCount,
      executionBreakpointCount: compactPlan.executionBreakpointCount,
      readRangeBreakpointCount: compactPlan.readRangeBreakpointCount,
      canMatchExecutionHitsWithoutPersistingPc: true,
      canDetectUnmatchedBreakpointHitsWithoutPersistingPc: true,
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
    setupPlan: compactPlan,
    commands: {
      launch: 'node tools/world-gearsystem-launch.mjs --port 7777',
      installBreakpoints: 'node tools/world-gearsystem-mcp-residual-setup.mjs --execute --port 7777 --out tmp/world-gearsystem-mcp-residual-setup.local.json',
      monitor: 'node tools/world-gearsystem-mcp-hit-monitor.mjs --execute --port 7777 --polls 120 --poll-ms 100 --out tmp/world-gearsystem-mcp-hit-monitor.local.json',
      monitorWithSetup: 'node tools/world-gearsystem-mcp-hit-monitor.mjs --execute --setup --port 7777 --polls 120 --poll-ms 100 --out tmp/world-gearsystem-mcp-hit-monitor.local.json',
    },
    assetPolicy: 'Metadata only: poll counts, booleans, matched operation ids, region ids, hook ids, labels, expected banks, and sanitized MCP call result summaries. The monitor may use PC transiently to match known execution breakpoints, but it does not persist PC/register values, memory bytes, trace-log entries, VDP port values, screenshots, pixels, audio bytes, samples, or instruction bytes.',
  };
}

function buildExecutionReport(setupPlan, monitorResult, options = {}) {
  const statusSummaries = monitorResult.statusSummaries || [];
  const hitSnapshots = monitorResult.hitSnapshots || [];
  const controlResults = monitorResult.controlResults || [];
  const matchedHitCount = hitSnapshots.filter(item => item.matchedOperationIds.length > 0).length;
  const unmatchedHitCount = hitSnapshots.length - matchedHitCount;
  return {
    schemaVersion: 1,
    eventKind: 'wb3_gearsystem_mcp_hit_monitor_report',
    generatedAt: now,
    generatedBy: toolName,
    baseUrl: options.baseUrl || setupPlan.baseUrl || 'http://127.0.0.1:7777',
    executed: true,
    sourceSetupPlan: 'gearsystem/world-residual-mcp-setup-plan.json',
    summary: {
      setupBreakpoints: options.setupBreakpoints === true,
      pollCount: statusSummaries.length,
      requestedPollCount: options.pollCount,
      pollMs: options.pollMs,
      stopOnHit: options.stopOnHit === true,
      pauseAtEnd: options.pauseAtEnd === true,
      controlResultCount: controlResults.length,
      failedControlResultCount: controlResults.filter(item => item.result?.ok !== true).length,
      breakpointHitCount: hitSnapshots.length,
      matchedExecutionHitCount: matchedHitCount,
      unmatchedBreakpointHitCount: unmatchedHitCount,
      monitoredExecutionBreakpointCount: setupPlan.summary?.executionBreakpointCount || 0,
      monitoredReadRangeBreakpointCount: setupPlan.summary?.readRangeBreakpointCount || 0,
      monitorUsable: controlResults.length > 0 && controlResults.every(item => item.result?.ok === true),
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
    hitSnapshots,
    statusSummaryCounts: {
      requestOkCount: statusSummaries.filter(item => item.requestOk).length,
      pausedCount: statusSummaries.filter(item => item.paused).length,
      atBreakpointCount: statusSummaries.filter(item => item.atBreakpoint).length,
    },
    controlResults,
    nextLeads: hitSnapshots.length
      ? [
          'Use matchedOperationIds to decide which residual observation template fields need manual metadata capture.',
          'Do not promote residual regions from this monitor report alone; it proves breakpoint reachability only, not required field completeness.',
        ]
      : [
          'No residual breakpoint hit was observed in this monitor window; drive the game to relevant scenes or use a save-state/macro path.',
          'Keep the residual regions quarantined until a filled local observation audit passes.',
        ],
    assetPolicy: 'Metadata only: poll counts, booleans, matched operation ids, region ids, hook ids, labels, expected banks, and sanitized MCP call result summaries. The monitor may use PC transiently to match known execution breakpoints, but it does not persist PC/register values, memory bytes, trace-log entries, VDP port values, screenshots, pixels, audio bytes, samples, or instruction bytes.',
  };
}

async function main() {
  const execute = hasArg('--execute');
  const setupBreakpoints = hasArg('--setup');
  const stopOnHit = !hasArg('--no-stop-on-hit');
  const pauseAtEnd = !hasArg('--no-pause-at-end');
  const pollCount = Number(argValue('--polls') || argValue('--poll-count') || 20);
  const pollMs = Number(argValue('--poll-ms') || 100);
  const baseUrl = argValue('--url') || `http://${argValue('--address') || '127.0.0.1'}:${argValue('--port') || '7777'}`;
  const outputPath = resolveRepoPath(argValue('--out')) || (execute ? defaultReportPath : defaultPlanPath);
  const setupPlan = readJson(setupPlanPath);

  if (!execute) {
    const report = buildDryRunReport(setupPlan, { baseUrl });
    writeJson(outputPath, report);
    console.log(JSON.stringify({
      ok: true,
      executed: false,
      output: path.relative(repoRoot, outputPath),
      summary: report.summary,
      assetPolicy: report.assetPolicy,
    }, null, 2));
    return;
  }

  const result = await monitor(setupPlan, {
    baseUrl,
    setupBreakpoints,
    pollCount,
    pollMs,
    stopOnHit,
    pauseAtEnd,
  });
  const report = buildExecutionReport(setupPlan, result, {
    baseUrl,
    setupBreakpoints,
    pollCount,
    pollMs,
    stopOnHit,
    pauseAtEnd,
  });
  writeJson(outputPath, report);
  console.log(JSON.stringify({
    ok: report.summary.monitorUsable,
    executed: true,
    output: path.relative(repoRoot, outputPath),
    summary: report.summary,
    assetPolicy: report.assetPolicy,
  }, null, 2));
  if (!report.summary.monitorUsable) process.exitCode = 1;
}

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
