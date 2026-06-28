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
const setupPlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-setup-plan.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-palette-parser-entry-observation.local.json');
const defaultObservationPath = path.join(repoRoot, 'tmp/local-hook-observations.palette-parser-entry.local.json');
const catalogId = 'world-gearsystem-mcp-palette-parser-entry-observation-capture-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-palette-parser-entry-observation-capture-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-palette-parser-entry-observation-capture.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;
const parserOperationId = 'exec-10bc-residual_palette_parser_entry-hook_entry';
const parserRoutineRegionId = 'r1976';
const targetRegionIds = ['r2815', 'r2816', 'r2817'];

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

const routeCatalog = [
  {
    id: 'boot_start_idle_probe',
    label: 'Boot start idle probe',
    commands: [
      { wait: 60 },
      { tap: 'start' },
      { wait: 240 },
    ],
  },
  {
    id: 'boot_start_right_probe',
    label: 'Boot start right-walk probe',
    commands: [
      { wait: 60 },
      { tap: 'start' },
      { wait: 180 },
      { press: 'right' },
      { wait: 360 },
      { release: 'right' },
      { wait: 60 },
    ],
  },
];

const ramScalarFields = [
  {
    field: '_RAM_CF65_',
    address: '$CF65',
    ramOffset: '0x0F65',
    size: 1,
    role: 'palette_script_selector_or_sentinel',
  },
  {
    field: '_RAM_D020_',
    address: '$D020',
    ramOffset: '0x1020',
    size: 2,
    endian: 'little',
    role: 'active_palette_script_pointer',
  },
  {
    field: '_RAM_D022_',
    address: '$D022',
    ramOffset: '0x1022',
    size: 1,
    role: 'palette_script_delay_counter',
  },
];

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function sameFrameTraceIdArg() {
  return argValue('--same-frame-trace-id') || argValue('--trace-id');
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

function parseHex(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '').trim().replace(/^\$/, '').replace(/^0x/i, '');
  if (!text) return null;
  const parsed = Number.parseInt(text, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

function hex(value, width = 4) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(width, '0')}`;
}

function numberArg(name) {
  const value = argValue(name);
  if (value == null) return null;
  return parseHex(value);
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value !== null && value !== undefined && value !== ''))].sort();
}

function compactRoute(route) {
  return {
    id: route.id,
    label: route.label,
    commandCount: route.commands.length,
    waitFrameCount: route.commands.reduce((sum, command) => sum + Number(command.wait || 0), 0),
    buttons: uniqueSorted(route.commands.flatMap(command => ['tap', 'press', 'release']
      .filter(key => command[key])
      .map(key => `${key}:${command[key]}`))),
    commands: route.commands,
  };
}

function selectedRoute(routeId) {
  const route = routeCatalog.find(candidate => candidate.id === (routeId || 'boot_start_idle_probe'));
  if (!route) throw new Error(`Unknown parser-entry capture route ${routeId}`);
  return route;
}

function findOperation(setupPlan) {
  return (setupPlan.operations || []).find(operation => operation.id === parserOperationId) || null;
}

function compactOperation(operation) {
  return {
    operationId: operation?.id || null,
    kind: operation?.kind || null,
    logicalAddress: operation?.source?.logicalAddress || operation?.arguments?.address || null,
    romOffset: operation?.source?.romOffset || null,
    bank: operation?.source?.bank || null,
    labels: operation?.source?.labels || [],
    hookIds: operation?.source?.hookIds || [],
    regionIds: operation?.source?.regionIds || operation?.regionIds || [],
    captureFields: operation?.source?.captureFields || [],
    requiredCaptureFields: operation?.source?.requiredCaptureFields || [],
  };
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size,
    type: region.type,
    name: region.name || null,
    confidence: region.confidence || null,
  };
}

function regionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function forbiddenCounters() {
  return Object.fromEntries(forbiddenCounterNames.map(name => [name, 0]));
}

function assetPolicy() {
  return 'Metadata only: route ids, operation ids, hook ids, labels, RAM symbol names, RAM scalar values for explicitly allowed one/two-byte fields, derived palette_script_entry_index, counts, booleans, statuses, and sanitized MCP call summaries. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, program counters, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.';
}

function buildPlan(mapData, setupPlan, options = {}) {
  const route = selectedRoute(options.routeId);
  const operation = findOperation(setupPlan);
  const ramArea = options.ramArea ?? 7;
  const ramAreaName = options.ramAreaName || 'RAM';
  return {
    id: catalogId,
    schemaVersion,
    eventKind: 'wb3_gearsystem_mcp_palette_parser_entry_observation_capture_plan',
    generatedAt: now,
    tool: toolName,
    sourceFiles: ['gearsystem/world-residual-mcp-setup-plan.json'],
    assetPolicy: assetPolicy(),
    executed: false,
    baseUrl: options.baseUrl,
    route: compactRoute(route),
    executionBreakpoint: compactOperation(operation),
    parserRoutineRegion: compactRegion(regionById(mapData, parserRoutineRegionId)),
    targetRegions: targetRegionIds.map(regionId => compactRegion(regionById(mapData, regionId))),
    safeRamScalarPlan: ramScalarFields.map(field => ({
      ...field,
      ramArea,
      ramAreaName,
      readMemoryArguments: {
        area: ramArea,
        offset: field.ramOffset,
        size: field.size,
      },
      persistPolicy: 'persist_scalar_value_only_no_memory_dump',
    })),
    summary: {
      captureAdapterReady: Boolean(operation),
      executionBreakpointReady: Boolean(operation),
      targetRegionCount: targetRegionIds.length,
      safeRamScalarFieldCount: ramScalarFields.length,
      readMemoryScalarReadCount: ramScalarFields.length,
      captureSupportsSameFrameTraceId: true,
      observationReadyCount: 0,
      closureReadyCount: 0,
      semanticPromotionReadyCount: 0,
      defaultOutputPath: 'tmp/world-gearsystem-mcp-palette-parser-entry-observation.local.json',
      defaultObservationPath: 'tmp/local-hook-observations.palette-parser-entry.local.json',
      ...forbiddenCounters(),
    },
    commands: {
      launch: 'node tools/world-gearsystem-launch.mjs --port 7777',
      plan: 'node tools/world-gearsystem-mcp-palette-parser-entry-observation-capture.mjs --out tmp/world-gearsystem-mcp-palette-parser-entry-observation.local.json',
      execute: 'node tools/world-gearsystem-mcp-palette-parser-entry-observation-capture.mjs --execute --setup --reset --route boot_start_idle_probe --port 7777 --out tmp/world-gearsystem-mcp-palette-parser-entry-observation.local.json',
      executeWithReviewedTraceAndActiveBank: 'node tools/world-gearsystem-mcp-palette-parser-entry-observation-capture.mjs --execute --setup --reset --same-frame-trace-id <same_frame_trace_id> --active-bank <reviewed_active_bank> --route boot_start_idle_probe --port 7777 --out tmp/world-gearsystem-mcp-palette-parser-entry-observation.local.json --observation-out tmp/local-hook-observations.palette-parser-entry.local.json',
      auditObservation: 'node tools/world-residual-runtime-trace-observation-audit.mjs --observations tmp/local-hook-observations.palette-parser-entry.local.json --region r2815',
    },
    evidence: [
      'gearsystem/world-residual-mcp-setup-plan.json defines exec-10bc-residual_palette_parser_entry-hook_entry at _LABEL_10BC_.',
      'The residual parser-entry contract allows only named scalar RAM fields _RAM_CF65_, _RAM_D020_, and _RAM_D022_ plus active_bank, palette_script_entry_index, and same_frame_trace_id.',
      'This adapter reads one/two-byte RAM scalar fields only when MCP is live and does not persist raw memory arrays or dumps.',
    ],
    nextLeads: [
      'Run the execute command with Gearsystem MCP live and review the scalar parser-entry observation.',
      'Supply active_bank only from a trusted same-frame mapper source before closure.',
      'Combine the parser-entry observation with native physical-source tail watch observations and rerun the residual closure pipeline.',
    ],
  };
}

async function rpc(baseUrl, method, params = {}) {
  try {
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
  } catch {
    return {
      ok: false,
      status: 0,
      json: {
        error: {
          message: 'fetch failed',
        },
      },
    };
  }
}

async function callTool(baseUrl, name, args = {}) {
  return rpc(baseUrl, 'tools/call', {
    name,
    arguments: args,
  });
}

function parseToolTextJson(result) {
  const text = result.json?.result?.content?.find(item => item?.type === 'text')?.text || '{}';
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
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
    contentTypes: uniqueSorted(content.map(item => item?.type)),
    errorCode: json.error?.code ?? null,
    errorMessage: json.error?.message || null,
  };
}

function normalizeLogicalAddress(value) {
  const text = String(value || '').trim().replace(/^\$/, '').replace(/^0x/i, '');
  return text ? `0x${text.toUpperCase().padStart(4, '0')}` : '';
}

function statusSnapshot(result) {
  const status = parseToolTextJson(result);
  return {
    requestOk: result.ok === true,
    paused: status.paused === true,
    atBreakpoint: status.at_breakpoint === true,
    transientPc: normalizeLogicalAddress(status.pc || ''),
  };
}

function arraysFromUnknown(value) {
  if (!value || typeof value !== 'object') return [];
  const arrays = [];
  for (const key of ['data', 'values', 'memory']) {
    if (Array.isArray(value[key])) arrays.push(value[key]);
  }
  if (Array.isArray(value)) arrays.push(value);
  return arrays;
}

function scalarFromReadMemory(result, size) {
  const parsed = parseToolTextJson(result);
  const arrays = arraysFromUnknown(parsed);
  const first = arrays.find(array => array.length >= size);
  if (!first) return { status: 'scalar_unavailable_unrecognized_read_memory_shape', value: null };
  const values = first.slice(0, size).map(item => Number(item));
  if (values.some(value => !Number.isFinite(value))) {
    return { status: 'scalar_unavailable_non_numeric_read_memory_values', value: null };
  }
  const value = size === 1 ? values[0] : values.reduce((sum, item, index) => sum + ((item & 0xff) << (index * 8)), 0);
  return {
    status: 'scalar_value_captured',
    value,
  };
}

async function pollForParserHit(baseUrl, operation, options = {}) {
  const targetPc = normalizeLogicalAddress(operation?.source?.logicalAddress || operation?.arguments?.address || '');
  const pollCount = Math.max(1, Number(options.pollCount || 40));
  const pollMs = Math.max(10, Number(options.pollMs || 100));
  const summaries = [];
  for (let index = 0; index < pollCount; index++) {
    if (index > 0) await new Promise(resolve => setTimeout(resolve, pollMs));
    const result = await callTool(baseUrl, 'debug_get_status', {});
    const snapshot = statusSnapshot(result);
    summaries.push({
      pollIndex: index,
      requestOk: snapshot.requestOk,
      paused: snapshot.paused,
      atBreakpoint: snapshot.atBreakpoint,
    });
    if (snapshot.atBreakpoint && (!targetPc || snapshot.transientPc === targetPc)) {
      return {
        hit: true,
        matchedOperationId: operation?.id || null,
        pollSummaries: summaries,
      };
    }
    if (snapshot.atBreakpoint) {
      return {
        hit: false,
        unmatchedBreakpointHit: true,
        pollSummaries: summaries,
      };
    }
  }
  return {
    hit: false,
    unmatchedBreakpointHit: false,
    pollSummaries: summaries,
  };
}

async function executeCapture(plan, setupPlan, options = {}) {
  const operation = findOperation(setupPlan);
  const baseUrl = options.baseUrl;
  const route = selectedRoute(options.routeId);
  const controlResults = [];
  const init = await rpc(baseUrl, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'wb3-world-palette-parser-entry-capture', version: '1' },
  });
  controlResults.push({ kind: 'initialize', result: sanitizeRpcResult(init) });
  if (!init.ok || !operation) {
    return buildExecutedReport(plan, {
      status: init.ok ? 'parser_operation_missing' : 'initialize_failed',
      hit: false,
      route,
      controlResults,
      pollSummaries: [],
      scalarReads: [],
      observation: null,
      sameFrameTraceId: options.traceId || null,
      sameFrameTraceIdSource: options.traceId ? 'reviewed_cli_argument' : 'none',
      activeBankSource: 'none',
      evidence: [init.ok ? 'Parser-entry setup operation was not found.' : 'Gearsystem MCP initialize failed.'],
    }, options);
  }

  if (options.resetBeforeRoute) {
    controlResults.push({ kind: 'debug_reset', result: sanitizeRpcResult(await callTool(baseUrl, 'debug_reset', {})) });
  }
  if (options.setupBreakpoint) {
    controlResults.push({
      kind: 'setup:execution_breakpoint',
      operationId: operation.id,
      result: sanitizeRpcResult(await callTool(baseUrl, operation.tool, operation.arguments || {})),
    });
  }
  controlResults.push({ kind: 'debug_continue', result: sanitizeRpcResult(await callTool(baseUrl, 'debug_continue', {})) });
  controlResults.push({ kind: 'controller_macro', result: sanitizeRpcResult(await callTool(baseUrl, 'controller_macro', { commands: route.commands })) });
  const hit = await pollForParserHit(baseUrl, operation, options);
  if (!hit.hit) {
    if (options.pauseAtEnd) {
      controlResults.push({ kind: 'debug_pause_end', result: sanitizeRpcResult(await callTool(baseUrl, 'debug_pause', {})) });
    }
    return buildExecutedReport(plan, {
      status: hit.unmatchedBreakpointHit ? 'unmatched_breakpoint_hit_no_parser_capture' : 'parser_entry_no_hit_on_route',
      hit: false,
      route,
      controlResults,
      pollSummaries: hit.pollSummaries,
      scalarReads: [],
      observation: null,
      sameFrameTraceId: options.traceId || null,
      sameFrameTraceIdSource: options.traceId ? 'reviewed_cli_argument' : 'none',
      activeBankSource: 'none',
      evidence: [hit.unmatchedBreakpointHit
        ? 'A breakpoint was hit, but it did not match the parser-entry logical address; raw PC was not persisted.'
        : `No _LABEL_10BC_ parser-entry breakpoint hit was observed on route ${route.id}.`],
    }, options);
  }

  const scalarReads = [];
  const sameFrameTraceIdSource = options.traceId ? 'reviewed_cli_argument' : 'generated_parser_hit_trace_id';
  const observation = {
    hookId: 'residual_palette_parser_entry',
    same_frame_trace_id: options.traceId || `mcp-parser-entry-${route.id}-hit-01`,
  };
  for (const field of ramScalarFields) {
    const readResult = await callTool(baseUrl, 'read_memory', {
      area: options.ramArea,
      offset: parseHex(field.ramOffset),
      size: field.size,
    });
    const scalar = readResult.ok ? scalarFromReadMemory(readResult, field.size) : { status: 'read_memory_failed', value: null };
    const captured = scalar.status === 'scalar_value_captured';
    if (captured) observation[field.field] = scalar.value;
    scalarReads.push({
      field: field.field,
      address: field.address,
      ramArea: options.ramArea,
      ramOffset: field.ramOffset,
      size: field.size,
      status: scalar.status,
      value: captured ? scalar.value : null,
      result: sanitizeRpcResult(readResult),
    });
  }
  if (Number.isFinite(observation._RAM_CF65_) && observation._RAM_CF65_ !== 0xfe && observation._RAM_CF65_ !== 0xff) {
    observation.palette_script_entry_index = observation._RAM_CF65_;
  }
  if (Number.isFinite(options.activeBank)) {
    observation.active_bank = options.activeBank;
  }

  if (options.pauseAtEnd) {
    controlResults.push({ kind: 'debug_pause_end', result: sanitizeRpcResult(await callTool(baseUrl, 'debug_pause', {})) });
  }

  const requiredFields = operation.source?.requiredCaptureFields || [];
  const missingRequiredFields = requiredFields.filter(field => observation[field] === undefined || observation[field] === null || observation[field] === '');
  return buildExecutedReport(plan, {
    status: missingRequiredFields.length
      ? 'parser_entry_hit_scalar_capture_incomplete'
      : 'parser_entry_hit_observation_ready_for_review',
    hit: true,
    route,
    matchedOperationId: operation.id,
    controlResults,
    pollSummaries: hit.pollSummaries,
    scalarReads,
    observation,
    sameFrameTraceId: observation.same_frame_trace_id,
    sameFrameTraceIdSource,
    missingRequiredFields,
    activeBankSource: Number.isFinite(options.activeBank) ? 'reviewed_cli_argument' : 'missing_trusted_source',
    evidence: [
      `_LABEL_10BC_ parser-entry breakpoint hit on route ${route.id}.`,
      'Only the named scalar RAM fields were read through MCP read_memory; no memory arrays or dumps are persisted.',
      Number.isFinite(options.activeBank)
        ? 'active_bank was supplied by explicit reviewed CLI argument.'
        : 'active_bank remains missing because no trusted mapper-bank source was supplied.',
    ],
  }, options);
}

function buildExecutedReport(plan, capture, options = {}) {
  const scalarCapturedCount = (capture.scalarReads || []).filter(item => item.status === 'scalar_value_captured').length;
  const observationReady = capture.status === 'parser_entry_hit_observation_ready_for_review';
  return {
    ...plan,
    eventKind: 'wb3_gearsystem_mcp_palette_parser_entry_observation_capture_report',
    executed: true,
    summary: {
      ...plan.summary,
      status: capture.status,
      parserEntryHit: capture.hit === true,
      matchedOperationId: capture.matchedOperationId || null,
      pollCount: (capture.pollSummaries || []).length,
      controlResultCount: (capture.controlResults || []).length,
      failedControlResultCount: (capture.controlResults || []).filter(item => item.result?.ok !== true).length,
      scalarCapturedCount,
      scalarMissingCount: ramScalarFields.length - scalarCapturedCount,
      sameFrameTraceIdProvided: Boolean(capture.sameFrameTraceId),
      sameFrameTraceIdSource: capture.sameFrameTraceIdSource || 'none',
      activeBankSource: capture.activeBankSource || 'none',
      missingRequiredFields: capture.missingRequiredFields || [],
      observationReadyCount: observationReady ? 1 : 0,
      closureReadyCount: 0,
      semanticPromotionReadyCount: 0,
      ...forbiddenCounters(),
    },
    capture: {
      status: capture.status,
      route: compactRoute(capture.route),
      matchedOperationId: capture.matchedOperationId || null,
      sameFrameTraceId: capture.sameFrameTraceId || null,
      sameFrameTraceIdSource: capture.sameFrameTraceIdSource || 'none',
      scalarReads: capture.scalarReads || [],
      observation: capture.observation,
      missingRequiredFields: capture.missingRequiredFields || [],
      controlResults: capture.controlResults || [],
      pollSummaries: capture.pollSummaries || [],
      evidence: capture.evidence || [],
    },
    nextLeads: observationReady
      ? [
          'Review this parser-entry observation and combine it with same-frame native tail watch observations.',
          'Run the residual observation audit before bundling proof metadata.',
        ]
      : [
          'Capture active_bank from a trusted same-frame mapper source before using parser-entry data for closure.',
          'Re-run this tool with Gearsystem MCP live if no parser-entry hit was observed.',
        ],
  };
}

function buildObservationBundle(report) {
  const observation = report.capture?.observation;
  return {
    schemaVersion: 1,
    eventKind: 'wb3_residual_runtime_trace_observations',
    source: 'tmp/world-gearsystem-mcp-palette-parser-entry-observation.local.json',
    reviewedRuntimeObservations: false,
    reviewStatus: 'unreviewed_parser_entry_scalar_capture',
    assetPolicy: 'Metadata-only local parser-entry observation. It contains hook ids, same-frame trace id, safe scalar RAM values, active_bank only if reviewed, and derived palette_script_entry_index only. No ROM bytes, stream bytes, memory dumps, register traces, VDP port values, pixels, screenshots, audio bytes, samples, or instruction bytes.',
    observations: observation ? [observation] : [],
    summary: {
      observationCount: observation ? 1 : 0,
      parserEntryObservationReadyForReview: report.summary?.observationReadyCount === 1,
      missingRequiredFields: report.summary?.missingRequiredFields || [],
      ...forbiddenCounters(),
    },
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const regionId of targetRegionIds) {
    const region = regionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'palette_parser_entry_observation_capture_target' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpPaletteParserEntryObservationCaptureAudit = {
      catalogId,
      kind: 'gearsystem_mcp_palette_parser_entry_observation_capture',
      status: catalog.summary.captureAdapterReady
        ? 'parser_entry_observation_capture_adapter_ready'
        : 'parser_entry_observation_capture_adapter_missing_operation',
      executionBreakpoint: catalog.executionBreakpoint,
      safeRamScalarPlan: catalog.safeRamScalarPlan,
      targetRegionIds,
      observationReadyCount: catalog.summary.observationReadyCount || 0,
      closureReadyCount: 0,
      summary: 'Parser-entry observation capture adapter is ready; real MCP runtime capture is still required before closure.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({ id: region.id, status: region.analysis.gearsystemMcpPaletteParserEntryObservationCaptureAudit.status });
  }
  const parserRegion = regionById(mapData, parserRoutineRegionId);
  if (parserRegion) {
    parserRegion.analysis = parserRegion.analysis || {};
    parserRegion.analysis.gearsystemMcpPaletteParserEntryObservationCaptureAudit = {
      catalogId,
      kind: 'gearsystem_mcp_palette_parser_entry_observation_capture_routine',
      status: 'parser_entry_safe_scalar_capture_adapter_ready',
      executionBreakpoint: catalog.executionBreakpoint,
      safeRamScalarPlan: catalog.safeRamScalarPlan,
      appliesToRegionIds: targetRegionIds,
      summary: '_LABEL_10BC_ parser-entry capture adapter can read only approved scalar RAM fields when MCP is live.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({ id: parserRoutineRegionId, status: 'parser_entry_safe_scalar_capture_adapter_ready' });
  } else {
    missingRegions.push({ id: parserRoutineRegionId, role: 'palette_parser_entry_observation_capture_routine' });
  }

  mapData.gearsystemMcpPaletteParserEntryObservationCaptureCatalogs = (mapData.gearsystemMcpPaletteParserEntryObservationCaptureCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpPaletteParserEntryObservationCaptureCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_palette_parser_entry_observation_capture_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
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
  staticMap.summary.gearsystemMcpPaletteParserEntryObservationCaptureCatalog = catalogId;
  staticMap.summary.gearsystemMcpPaletteParserEntryObservationCaptureAdapterReady = catalog.summary.captureAdapterReady === true;
  staticMap.summary.gearsystemMcpPaletteParserEntryObservationCaptureSafeRamScalarFieldCount = catalog.summary.safeRamScalarFieldCount;
  staticMap.summary.gearsystemMcpPaletteParserEntryObservationCaptureSupportsSameFrameTraceId = catalog.summary.captureSupportsSameFrameTraceId === true;
  staticMap.summary.gearsystemMcpPaletteParserEntryObservationCaptureObservationReadyCount = catalog.summary.observationReadyCount;
  staticMap.summary.gearsystemMcpPaletteParserEntryObservationCaptureDefaultOutput = catalog.summary.defaultOutputPath;
  staticMap.summary.gearsystemMcpPaletteParserEntryObservationCaptureDefaultObservationPath = catalog.summary.defaultObservationPath;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`gearsystemMcpPaletteParserEntryObservationCapture${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-palette-parser-entry-observation-capture-catalog-2026-06-26 to capture _LABEL_10BC_ scalar parser-entry observations without memory dumps.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

async function main() {
  const execute = hasArg('--execute');
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const writeObservations = hasArg('--write-observations') || Boolean(argValue('--observation-out'));
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const observationPath = resolveRepoPath(argValue('--observation-out')) || defaultObservationPath;
  const baseUrl = argValue('--url') || `http://${argValue('--address') || '127.0.0.1'}:${argValue('--port') || '7777'}`;
  const setupPlan = readJson(setupPlanPath);
  const mapData = readJson(mapPath);
  const plan = buildPlan(mapData, setupPlan, {
    baseUrl,
    routeId: argValue('--route'),
    ramArea: numberArg('--ram-area') ?? 7,
    ramAreaName: argValue('--ram-area-name') || 'RAM',
  });

  const output = execute
    ? await executeCapture(plan, setupPlan, {
        baseUrl,
        routeId: argValue('--route'),
        setupBreakpoint: hasArg('--setup'),
        resetBeforeRoute: hasArg('--reset'),
        pauseAtEnd: !hasArg('--no-pause-at-end'),
        pollCount: Number(argValue('--polls') || argValue('--poll-count') || 40),
        pollMs: Number(argValue('--poll-ms') || 100),
        ramArea: numberArg('--ram-area') ?? 7,
        activeBank: numberArg('--active-bank'),
        traceId: sameFrameTraceIdArg(),
      })
    : plan;

  let annotation = { changedRegions: [], missingRegions: [] };
  if (apply) {
    annotation = applyCatalog(mapData, plan);
    if (!noWrite) {
      writeJson(mapPath, mapData);
      updateStaticMap(plan);
    }
  }

  if (!noWrite) writeJson(outputPath, output);
  if (writeObservations && execute && !noWrite) writeJson(observationPath, buildObservationBundle(output));

  console.log(JSON.stringify({
    ok: execute ? output.summary?.status !== 'initialize_failed' : true,
    executed: execute,
    applied: apply,
    output: noWrite ? null : relative(outputPath),
    observationOutput: writeObservations && execute && !noWrite ? relative(observationPath) : null,
    catalogId,
    summary: output.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    assetPolicy: output.assetPolicy,
  }, null, 2));
  if (execute && output.summary?.status === 'initialize_failed') process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    ...forbiddenCounters(),
  }, null, 2));
  process.exitCode = 1;
});
