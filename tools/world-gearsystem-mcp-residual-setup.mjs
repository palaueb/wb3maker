#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tracePlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-trace-plan.json');
const defaultPlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-setup-plan.json');
const defaultReportPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-residual-setup.local.json');
const symbolPath = path.join(repoRoot, 'gearsystem/wb3-world.sym');
const toolName = 'tools/world-gearsystem-mcp-residual-setup.mjs';
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

function parseHex(value) {
  if (typeof value === 'number') return value;
  const text = String(value || '').trim();
  if (!text) return NaN;
  return Number.parseInt(text.replace(/^\$/, '').replace(/^0x/i, ''), 16);
}

function hex(value, width = 4) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(width, '0')}`;
}

function gearsystemLogicalFromRomOffset(offset) {
  const value = parseHex(offset);
  if (!Number.isFinite(value)) return null;
  const bank = value < 0x4000 ? 0 : Math.floor(value / 0x4000);
  const logical = value < 0x4000 ? value : 0x8000 + (value % 0x4000);
  return {
    romOffset: hex(value, value > 0xFFFF ? 5 : 4),
    bank: hex(bank, 2),
    logicalAddress: hex(logical, 4),
  };
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function executionBreakpointsForHook(hook) {
  if (Array.isArray(hook.mcpBreakpointOffsets) && hook.mcpBreakpointOffsets.length) {
    return hook.mcpBreakpointOffsets;
  }
  if (hook.offset && String(hook.label || '').startsWith('_LABEL_')) {
    return [{ role: 'hook_entry', offset: hook.offset, label: hook.label || hook.hookId }];
  }
  return [];
}

function readRangeAdapterHooksForTarget(target) {
  return (target.hookChecklist || []).filter(hook =>
    hook.required === true &&
    hook.hookId !== 'residual_runtime_promotion_gate' &&
    executionBreakpointsForHook(hook).length === 0);
}

function operationBase(kind, target, extra = {}) {
  return {
    kind,
    regionIds: target?.regionId ? [target.regionId] : [],
    targetOffsets: target?.targetOffsets || [],
    classId: target?.classId || '',
    traceKind: target?.traceKind || '',
    ...extra,
  };
}

function buildExecutionBreakpointOperations(targets) {
  const hookEntries = [];
  for (const target of targets) {
    for (const hook of target.hookChecklist || []) {
      const breakpoints = executionBreakpointsForHook(hook);
      for (const breakpoint of breakpoints) {
        const address = gearsystemLogicalFromRomOffset(breakpoint.offset);
        if (!address) continue;
        hookEntries.push({
          target,
          hook,
          breakpoint,
          address,
        });
      }
    }
  }

  return uniqueBy(hookEntries, entry => `${entry.address.logicalAddress}:${entry.hook.hookId}:${entry.breakpoint.role || entry.breakpoint.label || ''}`)
    .map(entry => {
      const matching = hookEntries.filter(item =>
        item.address.logicalAddress === entry.address.logicalAddress &&
        item.hook.hookId === entry.hook.hookId &&
        (item.breakpoint.role || item.breakpoint.label || '') === (entry.breakpoint.role || entry.breakpoint.label || ''));
      return operationBase('execution_breakpoint', entry.target, {
        id: `exec-${entry.address.logicalAddress.slice(2).toLowerCase()}-${String(entry.hook.hookId).replace(/[^a-z0-9_]+/gi, '_')}-${String(entry.breakpoint.role || 'hook_entry').replace(/[^a-z0-9_]+/gi, '_')}`,
        tool: 'set_breakpoint',
        arguments: {
          address: entry.address.logicalAddress,
          memory_area: 'rom_ram',
          read: false,
          write: false,
          execute: true,
        },
        source: {
          hookIds: [...new Set(matching.map(item => item.hook.hookId))].sort(),
          labels: [...new Set(matching.map(item => item.breakpoint.label || item.hook.label).filter(Boolean))].sort(),
          hookOffsets: [...new Set(matching.map(item => item.breakpoint.offset || item.hook.offset).filter(Boolean))].sort(),
          hookBreakpointRoles: [...new Set(matching.map(item => item.breakpoint.role).filter(Boolean))].sort(),
          hookBreakpointPurposes: [...new Set(matching.map(item => item.breakpoint.purpose).filter(Boolean))].sort(),
          captureFields: [...new Set(matching.flatMap(item => item.hook.captureFields || []))].sort(),
          requiredCaptureFields: [...new Set(matching.flatMap(item => item.hook.requiredCaptureFields || []))].sort(),
          regionIds: [...new Set(matching.map(item => item.target.regionId).filter(Boolean))].sort(),
          romOffset: entry.address.romOffset,
          bank: entry.address.bank,
          logicalAddress: entry.address.logicalAddress,
        },
        evidence: entry.breakpoint.role
          ? 'Execution hook offset comes from a precise mcpBreakpointOffsets entry in world-residual-mcp-trace-plan.json, derived from ASM instruction-offset evidence.'
          : 'Execution hook offset comes from world-residual-mcp-trace-plan.json, derived from existing residualRuntimeCaptureChecklist metadata.',
      });
    });
}

function buildReadRangeBreakpointOperations(targets) {
  return targets
    .map(target => {
      const adapterHooks = readRangeAdapterHooksForTarget(target);
      const start = parseHex(target.offset);
      const size = Number(target.size || 0);
      if (!Number.isFinite(start) || size <= 0) return null;
      const end = start + size - 1;
      const startAddress = gearsystemLogicalFromRomOffset(start);
      const endAddress = gearsystemLogicalFromRomOffset(end);
      if (!startAddress || !endAddress) return null;
      if (startAddress.bank !== endAddress.bank) return null;
      return operationBase('read_range_breakpoint', target, {
        id: `read-${target.regionId}-${startAddress.logicalAddress.slice(2).toLowerCase()}-${endAddress.logicalAddress.slice(2).toLowerCase()}`,
        tool: size === 1 ? 'set_breakpoint' : 'set_breakpoint_range',
        arguments: size === 1
          ? {
              address: startAddress.logicalAddress,
              memory_area: 'rom_ram',
              read: true,
              write: false,
              execute: false,
            }
          : {
              start_address: startAddress.logicalAddress,
              end_address: endAddress.logicalAddress,
              memory_area: 'rom_ram',
              read: true,
              write: false,
              execute: false,
            },
        source: {
          regionId: target.regionId,
          type: target.type,
          hookIds: [...new Set(adapterHooks.map(hook => hook.hookId).filter(Boolean))].sort(),
          labels: [...new Set(adapterHooks.map(hook => hook.label || hook.hookId).filter(Boolean))].sort(),
          hookOffsets: [...new Set(adapterHooks.map(hook => hook.offset).filter(Boolean))].sort(),
          hookBreakpointRoles: adapterHooks.length ? ['read_range_watchpoint_adapter'] : [],
          hookBreakpointPurposes: adapterHooks.length
            ? ['Anchor metadata-only watchpoint observations when this residual target read range is hit.']
            : [],
          captureFields: [...new Set(adapterHooks.flatMap(hook => hook.captureFields || []))].sort(),
          requiredCaptureFields: [...new Set(adapterHooks.flatMap(hook => hook.requiredCaptureFields || []))].sort(),
          romStartOffset: startAddress.romOffset,
          romEndOffset: endAddress.romOffset,
          bank: startAddress.bank,
          logicalStartAddress: startAddress.logicalAddress,
          logicalEndAddress: endAddress.logicalAddress,
          size,
        },
        evidence: adapterHooks.length
          ? 'Read range comes from the residual target offset and size in world-residual-mcp-trace-plan.json and anchors required non-execution watch hooks by field name only.'
          : 'Read range comes from the residual target offset and size in world-residual-mcp-trace-plan.json.',
      });
    })
    .filter(Boolean);
}

function buildUnresolvedWatchHooks(targets) {
  const unresolved = [];
  for (const target of targets) {
    for (const hook of target.hookChecklist || []) {
      if (executionBreakpointsForHook(hook).length || readRangeAdapterHooksForTarget(target).some(adapter => adapter.hookId === hook.hookId)) continue;
      unresolved.push({
        regionId: target.regionId,
        hookId: hook.hookId,
        label: hook.label || null,
        captureFields: hook.captureFields || [],
        requiredCaptureFields: hook.requiredCaptureFields || [],
        reason: hook.hookId === 'residual_runtime_promotion_gate'
          ? 'promotion_gate_is_derived_from_same_frame_observations'
          : 'no_single_execution_offset_available_use_target_read_range_breakpoint',
      });
    }
  }
  return unresolved;
}

export function buildResidualMcpSetupPlan(tracePlan, options = {}) {
  const targets = tracePlan.targets || [];
  const executionBreakpoints = buildExecutionBreakpointOperations(targets);
  const readRangeBreakpoints = options.skipReadRanges ? [] : buildReadRangeBreakpointOperations(targets);
  const operations = [
    ...executionBreakpoints,
    ...readRangeBreakpoints,
  ];
  const unresolvedWatchHooks = buildUnresolvedWatchHooks(targets);

  return {
    schemaVersion: 1,
    eventKind: 'wb3_gearsystem_mcp_residual_setup_plan',
    generatedAt: now,
    generatedBy: toolName,
    sourceTracePlan: 'gearsystem/world-residual-mcp-trace-plan.json',
    symbolFile: 'gearsystem/wb3-world.sym',
    baseUrl: options.baseUrl || 'http://127.0.0.1:7777',
    commands: {
      launch: 'node tools/world-gearsystem-launch.mjs --port 7777',
      probe: 'node tools/world-gearsystem-mcp-probe.mjs --port 7777',
      dryRun: 'node tools/world-gearsystem-mcp-residual-setup.mjs',
      execute: 'node tools/world-gearsystem-mcp-residual-setup.mjs --execute --port 7777 --out tmp/world-gearsystem-mcp-residual-setup.local.json',
      observationTemplatePack: 'node tools/world-residual-runtime-trace-local-bundle.mjs --template-pack --out tmp/local-hook-observations.templates',
    },
    summary: {
      targetCount: targets.length,
      operationCount: operations.length,
      executionBreakpointCount: executionBreakpoints.length,
      readRangeBreakpointCount: readRangeBreakpoints.length,
      unresolvedWatchHookCount: unresolvedWatchHooks.length,
      executionCaptureFieldNameCount: new Set(executionBreakpoints.flatMap(item => item.source.captureFields || [])).size,
      executionRequiredCaptureFieldNameCount: new Set(executionBreakpoints.flatMap(item => item.source.requiredCaptureFields || [])).size,
      readRangeAdapterHookCount: new Set(readRangeBreakpoints.flatMap(item => item.source.hookIds || [])).size,
      readRangeCaptureFieldNameCount: new Set(readRangeBreakpoints.flatMap(item => item.source.captureFields || [])).size,
      readRangeRequiredCaptureFieldNameCount: new Set(readRangeBreakpoints.flatMap(item => item.source.requiredCaptureFields || [])).size,
      unresolvedRequiredCaptureFieldNameCount: new Set(unresolvedWatchHooks.flatMap(item => item.requiredCaptureFields || [])).size,
      uniqueExecutionLogicalAddressCount: new Set(executionBreakpoints.map(item => item.source.logicalAddress)).size,
      uniqueReadRangeRegionCount: new Set(readRangeBreakpoints.map(item => item.source.regionId)).size,
      skipReadRanges: options.skipReadRanges === true,
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
    operations,
    unresolvedWatchHooks,
    executionNotes: [
      'Gearsystem execution/read breakpoints are logical addresses; for banked ROM targets, keep the recorded bank context and verify active_bank in local observations before promotion.',
      'This setup does not read memory, screenshots, trace logs, sprites, PSG/FM state, or VDP state.',
      'Execution breakpoint operations carry capture field names and required field names only; captured runtime values must remain in reviewed local observation files and must not include forbidden payloads.',
      'Read-range breakpoint operations may carry watchpoint adapter hook ids and field names only; they do not persist the bytes or values that caused the read.',
      'After breakpoints hit, fill tmp/local-hook-observations.json with only the capture fields required by the residual runtime observation template.',
    ],
    assetPolicy: 'Metadata only: hook ids, labels, ROM offsets, banks, logical addresses, region ids, breakpoint tool names, capture field names, counts, booleans, command paths, and setup result summaries. No ROM bytes, decoded assets, memory dumps, trace log entries, VDP port values, register traces, pixels, screenshots, audio bytes, samples, or instruction bytes are persisted.',
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

async function callTool(baseUrl, name, args = {}) {
  return rpc(baseUrl, 'tools/call', {
    name,
    arguments: args,
  });
}

async function executeSetupPlan(plan, options = {}) {
  const baseUrl = options.baseUrl || plan.baseUrl || 'http://127.0.0.1:7777';
  const results = [];
  const initialize = await rpc(baseUrl, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'wb3-world-gearsystem-residual-setup', version: '1' },
  });
  results.push({
    operationId: 'mcp-initialize',
    kind: 'mcp_initialize',
    tool: 'initialize',
    result: sanitizeRpcResult(initialize),
  });
  if (!initialize.ok) return results;

  if (options.loadSymbols) {
    const loaded = await callTool(baseUrl, 'load_symbols', {
      file_path: path.resolve(repoRoot, symbolPath),
    });
    results.push({
      operationId: 'load-symbols',
      kind: 'load_symbols',
      tool: 'load_symbols',
      result: sanitizeRpcResult(loaded),
    });
  }

  if (!options.skipPause) {
    const paused = await callTool(baseUrl, 'debug_pause', {});
    results.push({
      operationId: 'debug-pause',
      kind: 'debug_pause',
      tool: 'debug_pause',
      result: sanitizeRpcResult(paused),
    });
  }

  for (const operation of plan.operations || []) {
    const called = await callTool(baseUrl, operation.tool, operation.arguments || {});
    results.push({
      operationId: operation.id,
      kind: operation.kind,
      tool: operation.tool,
      regionIds: operation.regionIds || [],
      source: operation.source || {},
      result: sanitizeRpcResult(called),
    });
  }

  const listed = await callTool(baseUrl, 'list_breakpoints', {});
  results.push({
    operationId: 'list-breakpoints',
    kind: 'list_breakpoints',
    tool: 'list_breakpoints',
    result: sanitizeRpcResult(listed),
  });
  return results;
}

function buildReport(plan, results = [], options = {}) {
  const toolResults = results.filter(item => item.kind !== 'mcp_initialize');
  return {
    schemaVersion: 1,
    eventKind: 'wb3_gearsystem_mcp_residual_setup_report',
    generatedAt: now,
    generatedBy: toolName,
    sourceSetupPlan: 'gearsystem/world-residual-mcp-setup-plan.json',
    baseUrl: options.baseUrl || plan.baseUrl || 'http://127.0.0.1:7777',
    executed: options.executed === true,
    summary: {
      planOperationCount: plan.summary.operationCount,
      resultCount: results.length,
      okResultCount: results.filter(item => item.result?.ok === true).length,
      failedResultCount: results.filter(item => item.result?.ok !== true).length,
      toolCallResultCount: toolResults.length,
      setupUsable: results.length > 0 && results.every(item => item.result?.ok === true),
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
    planSummary: plan.summary,
    results,
    assetPolicy: plan.assetPolicy,
  };
}

async function main() {
  const execute = hasArg('--execute');
  const skipReadRanges = hasArg('--skip-read-ranges');
  const skipPause = hasArg('--skip-pause');
  const loadSymbols = hasArg('--load-symbols');
  const baseUrl = argValue('--url') || `http://${argValue('--address') || '127.0.0.1'}:${argValue('--port') || '7777'}`;
  const outputPath = resolveRepoPath(argValue('--out')) || (execute ? defaultReportPath : defaultPlanPath);
  const tracePlan = readJson(tracePlanPath);
  const plan = buildResidualMcpSetupPlan(tracePlan, {
    baseUrl,
    skipReadRanges,
  });

  if (!execute) {
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

  const results = await executeSetupPlan(plan, {
    baseUrl,
    skipPause,
    loadSymbols,
  });
  const report = buildReport(plan, results, {
    baseUrl,
    executed: true,
  });
  writeJson(outputPath, report);
  console.log(JSON.stringify({
    ok: report.summary.setupUsable,
    executed: true,
    output: path.relative(repoRoot, outputPath),
    summary: report.summary,
    assetPolicy: report.assetPolicy,
  }, null, 2));
  if (!report.summary.setupUsable) process.exitCode = 1;
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
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
  }, null, 2));
  process.exitCode = 1;
});
