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
const symbolPath = path.join(repoRoot, 'gearsystem/wb3-world.sym');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-callback-field-probe.local.json');
const catalogId = 'world-gearsystem-mcp-callback-field-probe-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-callback-field-probe-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-callback-field-probe.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;

const defaultTargetRegionIds = ['r2815', 'r2816', 'r2817'];
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
];

function hasArg(name) {
  return process.argv.includes(name);
}

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

function normalizeFilters(values) {
  return uniqueSorted((values || [])
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim())
    .filter(Boolean));
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  const text = String(value || '').trim().replace(/^\$/, '').replace(/^0x/i, '');
  if (!text) return null;
  const parsed = Number.parseInt(text, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

function hex(value, width = 4) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(width, '0')}`;
}

function parseOffset(value) {
  return parseHex(value);
}

function operationRegionIds(operation) {
  return [
    ...(operation.regionIds || []),
    ...(operation.source?.regionIds || []),
    operation.source?.regionId,
  ].filter(Boolean);
}

function regionById(mapData) {
  return new Map((mapData.regions || []).map(region => [region.id, region]));
}

function regionRomOffset(region, logicalAddress) {
  const start = parseOffset(region?.offset);
  const size = Number(region?.size || 0);
  if (start == null || !size) return null;
  const logicalStart = 0x8000 + (start % 0x4000);
  const delta = logicalAddress - logicalStart;
  if (delta < 0 || delta >= size) return null;
  return start + delta;
}

function loadSymbols() {
  const entries = [];
  if (!fs.existsSync(symbolPath)) return entries;
  const lines = fs.readFileSync(symbolPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([0-9A-Fa-f]{2}):([0-9A-Fa-f]{4})\s+(\S+)/);
    if (!match) continue;
    entries.push({
      bank: Number.parseInt(match[1], 16),
      address: Number.parseInt(match[2], 16),
      label: match[3],
    });
  }
  entries.sort((a, b) => (a.bank - b.bank) || (a.address - b.address) || a.label.localeCompare(b.label));
  return entries;
}

function resolveConsumerLabel(symbols, transientPc) {
  const address = parseHex(transientPc);
  if (address == null) {
    return {
      consumerLabel: null,
      consumerLabelStatus: 'unavailable_no_debug_pc',
    };
  }
  const fixedBankEntries = symbols.filter(entry => entry.bank === 0 && entry.address <= address);
  const closest = fixedBankEntries[fixedBankEntries.length - 1] || null;
  if (!closest) {
    return {
      consumerLabel: null,
      consumerLabelStatus: 'unresolved_no_prior_symbol',
    };
  }
  return {
    consumerLabel: closest.label,
    consumerLabelStatus: closest.address === address
      ? 'resolved_exact_symbol_from_transient_pc'
      : 'resolved_nearest_prior_symbol_from_transient_pc',
  };
}

function selectedRoute(routeId) {
  const id = routeId || 'boot_start_idle_probe';
  const route = routeCatalog.find(candidate => candidate.id === id);
  if (!route) throw new Error(`Unknown route ${id}`);
  return route;
}

function targetReadRangeOperations(setupPlan, options = {}) {
  const requestedRegionIds = normalizeFilters(options.regionIds || []);
  const regionFilters = new Set(requestedRegionIds.length ? requestedRegionIds : defaultTargetRegionIds);
  const operationFilters = new Set(normalizeFilters(options.operationIds || []));
  return (setupPlan.operations || []).filter(operation => {
    if (operation.kind !== 'read_range_breakpoint') return false;
    if (operationFilters.size && !operationFilters.has(operation.id)) return false;
    const regionIds = operationRegionIds(operation);
    if (regionFilters.size && !regionIds.some(regionId => regionFilters.has(regionId))) return false;
    const required = operation.source?.requiredCaptureFields || [];
    return required.includes('cursor_offset') || required.includes('read_offset');
  });
}

function operationRange(operation) {
  const start = parseHex(operation.arguments?.start_address || operation.arguments?.address);
  const end = parseHex(operation.arguments?.end_address || operation.arguments?.address);
  if (start == null || end == null || end < start) throw new Error(`Invalid range for ${operation.id}`);
  return { start, end };
}

function operationOffsetField(operation) {
  const required = operation.source?.requiredCaptureFields || [];
  if (required.includes('cursor_offset')) return 'cursor_offset';
  if (required.includes('read_offset')) return 'read_offset';
  return 'offset';
}

function addressListForOperation(operation, options = {}) {
  const range = operationRange(operation);
  if (!options.fullRange) return [range.start];
  const maxAddresses = Math.max(1, Number(options.maxAddresses || 32));
  const addresses = [];
  for (let address = range.start; address <= range.end && addresses.length < maxAddresses; address++) {
    addresses.push(address);
  }
  return addresses;
}

function buildProbe(operation, address, mapData) {
  const regionId = operation.source?.regionId || operationRegionIds(operation)[0] || null;
  const region = regionById(mapData).get(regionId);
  const range = operationRange(operation);
  const romOffset = regionRomOffset(region, address);
  return {
    probeId: `${operation.id}:single-${hex(address)}`,
    regionId,
    operationId: operation.id,
    hookIds: operation.source?.hookIds || [],
    labels: operation.source?.labels || [],
    hookBreakpointRoles: operation.source?.hookBreakpointRoles || [],
    sourceBank: operation.source?.bank || null,
    sourceRange: {
      logicalStart: hex(range.start),
      logicalEndInclusive: hex(range.end),
      regionOffset: region?.offset || null,
      regionSize: region?.size || null,
    },
    singleAddress: {
      logicalAddress: hex(address),
      romOffset: romOffset == null ? null : hex(romOffset, 5),
      role: address === range.start
        ? 'range_start'
        : address === range.end
          ? 'range_end'
          : 'range_member',
    },
    offsetFieldName: operationOffsetField(operation),
    requiredFields: operation.source?.requiredCaptureFields || [],
  };
}

function buildProbes(setupPlan, mapData, options = {}) {
  const operations = targetReadRangeOperations(setupPlan, options);
  return operations.flatMap(operation =>
    addressListForOperation(operation, options).map(address => buildProbe(operation, address, mapData)));
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

async function clearSetupBreakpoints(baseUrl, setupPlan, probes) {
  const results = [];
  for (const operation of setupPlan.operations || []) {
    const args = removeArgumentsForOperation(operation);
    if (!args.address) continue;
    const called = await callTool(baseUrl, 'remove_breakpoint', args);
    results.push({ kind: `clear:${operation.kind}`, operationId: operation.id, result: sanitizeRpcResult(called) });
  }
  for (const probe of probes || []) {
    const called = await callTool(baseUrl, 'remove_breakpoint', {
      address: probe.singleAddress.logicalAddress,
      memory_area: 'rom_ram',
    });
    results.push({ kind: 'clear:single_address_read_breakpoint', probeId: probe.probeId, result: sanitizeRpcResult(called) });
  }
  return results;
}

async function pollForHit(baseUrl, options = {}) {
  const pollCount = Math.max(1, Number(options.pollCount || 20));
  const pollMs = Math.max(10, Number(options.pollMs || 100));
  const summaries = [];
  for (let index = 0; index < pollCount; index++) {
    if (index > 0) await new Promise(resolve => setTimeout(resolve, pollMs));
    const result = await callTool(baseUrl, 'debug_get_status', {});
    const status = parseToolTextJson(result);
    summaries.push({
      pollIndex: index,
      requestOk: result.ok === true,
      paused: status.paused === true,
      atBreakpoint: status.at_breakpoint === true,
    });
    if (status.at_breakpoint === true) {
      return { status, summaries };
    }
  }
  return { status: null, summaries };
}

async function runProbe(baseUrl, setupPlan, allProbes, probe, route, symbols, options = {}) {
  const controlResults = [];
  if (options.resetBeforeProbe) {
    const reset = await callTool(baseUrl, 'debug_reset', {});
    controlResults.push({ kind: 'debug_reset', result: sanitizeRpcResult(reset) });
  }
  if (options.clearExistingBreakpoints) {
    controlResults.push(...await clearSetupBreakpoints(baseUrl, setupPlan, allProbes));
  }
  const set = await callTool(baseUrl, 'set_breakpoint', {
    address: probe.singleAddress.logicalAddress,
    memory_area: 'rom_ram',
    read: true,
    write: false,
    execute: false,
  });
  controlResults.push({ kind: 'setup:single_address_read_breakpoint', probeId: probe.probeId, result: sanitizeRpcResult(set) });
  if (!set.ok) {
    return {
      ...probe,
      status: 'probe_setup_failed',
      hit: false,
      resolvedFields: [],
      unresolvedFields: probe.requiredFields,
      controlResults,
      pollSummaries: [],
      evidence: ['The single-address read breakpoint could not be installed.'],
    };
  }

  const continued = await callTool(baseUrl, 'debug_continue', {});
  controlResults.push({ kind: 'debug_continue', result: sanitizeRpcResult(continued) });
  const macro = await callTool(baseUrl, 'controller_macro', { commands: route.commands || [] });
  controlResults.push({ kind: 'controller_macro', result: sanitizeRpcResult(macro) });
  const polled = continued.ok ? await pollForHit(baseUrl, options) : { status: null, summaries: [] };
  const pause = await callTool(baseUrl, 'debug_pause', {});
  controlResults.push({ kind: 'debug_pause_end', result: sanitizeRpcResult(pause) });
  const clear = await callTool(baseUrl, 'remove_breakpoint', {
    address: probe.singleAddress.logicalAddress,
    memory_area: 'rom_ram',
  });
  controlResults.push({ kind: 'clear:single_address_read_breakpoint', probeId: probe.probeId, result: sanitizeRpcResult(clear) });

  if (!polled.status) {
    return {
      ...probe,
      status: 'single_address_probe_no_hit_on_route',
      hit: false,
      resolvedFields: [],
      unresolvedFields: probe.requiredFields,
      controlResults,
      pollSummaries: polled.summaries,
      evidence: [`No read breakpoint hit was observed for ${probe.singleAddress.logicalAddress} on route ${route.id}.`],
    };
  }

  const consumer = resolveConsumerLabel(symbols, polled.status.pc);
  const regionFieldName = probe.offsetFieldName === 'cursor_offset' ? 'cursor_region_id' : 'read_region_id';
  const insideFieldName = probe.offsetFieldName === 'cursor_offset'
    ? 'inside_palette_tail_region'
    : 'direct_bank7_consumer';
  const resolvedFields = [
    'access_role',
    insideFieldName,
    'same_frame_trace_id',
    probe.offsetFieldName,
    regionFieldName,
  ];
  if (consumer.consumerLabel) resolvedFields.push('consumer_label');
  const unresolvedFields = uniqueSorted((probe.requiredFields || []).filter(field =>
    field === 'active_bank' || !resolvedFields.includes(field)));
  return {
    ...probe,
    status: consumer.consumerLabel
      ? 'single_address_hit_consumer_label_and_offset_resolved_active_bank_unresolved'
      : 'single_address_hit_offset_resolved_consumer_label_unresolved_active_bank_unresolved',
    hit: true,
    routeId: route.id,
    resolvedFields: uniqueSorted(resolvedFields),
    unresolvedFields,
    derived: {
      access_role: 'single_address_read_breakpoint',
      [probe.offsetFieldName]: probe.singleAddress.romOffset || probe.singleAddress.logicalAddress,
      [regionFieldName]: probe.regionId,
      [insideFieldName]: true,
      same_frame_trace_id: `${probe.probeId}:${route.id}:hit-01`,
      consumer_label: consumer.consumerLabel,
      consumer_label_status: consumer.consumerLabelStatus,
      active_bank_status: 'unresolved_no_trusted_mapper_latch_source',
    },
    controlResults,
    pollSummaries: polled.summaries,
    evidence: [
      `A single-address Gearsystem MCP read breakpoint hit ${probe.singleAddress.logicalAddress} on route ${route.id}.`,
      consumer.consumerLabel
        ? `The transient debugger PC resolved to symbol label ${consumer.consumerLabel}; raw PC was not persisted.`
        : 'The transient debugger PC did not resolve to a symbol label; raw PC was not persisted.',
      'The active_bank field remains unresolved because this tool has no verified mapper-latch source.',
    ],
  };
}

function buildPlan(setupPlan, mapData, options = {}) {
  const route = selectedRoute(options.routeId);
  const probes = buildProbes(setupPlan, mapData, options);
  return {
    schemaVersion,
    eventKind: 'wb3_gearsystem_mcp_callback_field_probe_plan',
    generatedAt: now,
    generatedBy: toolName,
    sourceSetupPlan: 'gearsystem/world-residual-mcp-setup-plan.json',
    baseUrl: options.baseUrl,
    executed: false,
    route: {
      id: route.id,
      label: route.label,
      commandCount: route.commands.length,
      waitFrameCount: route.commands.reduce((sum, command) => sum + Number(command.wait || 0), 0),
    },
    probes,
    summary: {
      probeCount: probes.length,
      targetRegionIds: uniqueSorted(probes.map(probe => probe.regionId)),
      operationIds: uniqueSorted(probes.map(probe => probe.operationId)),
      fullRange: options.fullRange === true,
      maxAddresses: Number(options.maxAddresses || 32),
      resetBeforeProbe: options.resetBeforeProbe === true,
      clearExistingBreakpoints: options.clearExistingBreakpoints === true,
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
    assetPolicy: 'Metadata only: region ids, operation ids, hook ids, labels, logical addresses, ROM offsets, counts, booleans, statuses, and sanitized MCP call summaries. The tool may use PC transiently to resolve a symbol label, but it does not persist PC/register values, memory bytes, trace-log entries, VDP port values, screenshots, pixels, audio bytes, samples, or instruction bytes.',
  };
}

function buildReport(plan, probeResults, options = {}) {
  const hitResults = probeResults.filter(result => result.hit);
  const allControlResults = probeResults.flatMap(result => result.controlResults || []);
  return {
    ...plan,
    eventKind: 'wb3_gearsystem_mcp_callback_field_probe_report',
    executed: true,
    summary: {
      ...plan.summary,
      pollCount: probeResults.reduce((sum, result) => sum + (result.pollSummaries?.length || 0), 0),
      controlResultCount: allControlResults.length,
      failedControlResultCount: allControlResults.filter(item => item.result?.ok !== true).length,
      probeHitCount: hitResults.length,
      hitRegionCount: uniqueSorted(hitResults.map(result => result.regionId)).length,
      consumerLabelResolvedCount: hitResults.filter(result => result.derived?.consumer_label).length,
      offsetResolvedCount: hitResults.filter(result => result.derived?.cursor_offset || result.derived?.read_offset).length,
      activeBankResolvedCount: 0,
      activeBankStatus: 'unresolved_no_trusted_mapper_latch_source',
      runtimeObservationReadyCount: 0,
      closureReadyCount: 0,
      semanticPromotionReadyCount: 0,
      macroProbeUsable: allControlResults.length > 0 && allControlResults.every(item => item.result?.ok === true),
      requestedPollCountPerProbe: Number(options.pollCount || 20),
      pollMs: Number(options.pollMs || 100),
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
    records: probeResults.map(result => ({
      regionId: result.regionId,
      probeId: result.probeId,
      operationId: result.operationId,
      hookIds: result.hookIds,
      labels: result.labels,
      hookBreakpointRoles: result.hookBreakpointRoles,
      sourceBank: result.sourceBank,
      sourceRange: result.sourceRange,
      singleAddress: result.singleAddress,
      offsetFieldName: result.offsetFieldName,
      routeId: result.routeId || plan.route.id,
      status: result.status,
      hit: result.hit,
      resolvedFields: result.resolvedFields,
      unresolvedFields: result.unresolvedFields,
      derived: result.derived || {},
      pollCount: result.pollSummaries?.length || 0,
      requestOkPollCount: (result.pollSummaries || []).filter(item => item.requestOk).length,
      controlResultCount: result.controlResults?.length || 0,
      failedControlResultCount: (result.controlResults || []).filter(item => item.result?.ok !== true).length,
      controlResults: result.controlResults,
      evidence: result.evidence,
    })),
    nextLeads: [
      'Use these single-address hits to review consumer_label and cursor_offset for r2815-r2817.',
      'Do not promote residual semantics until active_bank has a trusted mapper-latch source or an emulator callback supplies a reviewed bank value.',
      'Add deeper route/save-state seeds for r2813 execution hooks and r0749 bank-7 sidecar reads.',
    ],
  };
}

async function executePlan(plan, setupPlan, options = {}) {
  const baseUrl = options.baseUrl;
  const route = selectedRoute(options.routeId);
  const init = await rpc(baseUrl, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'wb3-world-gearsystem-callback-field-probe', version: '1' },
  });
  if (!init.ok) {
    return buildReport(plan, [{
      ...plan.probes[0],
      status: 'initialize_failed',
      hit: false,
      resolvedFields: [],
      unresolvedFields: plan.probes[0]?.requiredFields || [],
      controlResults: [{ kind: 'initialize', result: sanitizeRpcResult(init) }],
      pollSummaries: [],
      evidence: ['Gearsystem MCP initialize failed.'],
    }], options);
  }
  const symbols = loadSymbols();
  const results = [];
  for (const probe of plan.probes) {
    results.push(await runProbe(baseUrl, setupPlan, plan.probes, probe, route, symbols, options));
  }
  if (results.length) {
    results[0].controlResults = [
      { kind: 'initialize', result: sanitizeRpcResult(init) },
      ...(results[0].controlResults || []),
    ];
  }
  return buildReport(plan, results, options);
}

function reportByteClean(report) {
  return forbiddenCounterNames.every(name => Number(report.summary?.[name] || 0) === 0);
}

function buildCatalogFromReport(reportPath, report) {
  const recordsByRegionId = new Map();
  for (const record of report.records || []) {
    if (!recordsByRegionId.has(record.regionId)) recordsByRegionId.set(record.regionId, []);
    recordsByRegionId.get(record.regionId).push(record);
  }
  const records = [...recordsByRegionId.entries()].map(([regionId, regionRecords]) => {
    const hitRecords = regionRecords.filter(record => record.hit);
    const resolvedFields = uniqueSorted(hitRecords.flatMap(record => record.resolvedFields || []));
    const unresolvedFields = uniqueSorted(regionRecords.flatMap(record => record.unresolvedFields || []));
    const consumerLabels = uniqueSorted(hitRecords.map(record => record.derived?.consumer_label));
    const offsets = uniqueSorted(hitRecords.map(record =>
      record.derived?.cursor_offset || record.derived?.read_offset));
    return {
      regionId,
      status: hitRecords.length
        ? 'field_probe_hit_consumer_and_offset_resolved_active_bank_unresolved'
        : 'field_probe_no_hit_on_route',
      reportPath: relative(reportPath),
      byteClean: reportByteClean(report),
      macroProbeUsable: report.summary?.macroProbeUsable === true,
      probeCount: regionRecords.length,
      hitCount: hitRecords.length,
      operationIds: uniqueSorted(regionRecords.map(record => record.operationId)),
      hookIds: uniqueSorted(regionRecords.flatMap(record => record.hookIds || [])),
      sourceBanks: uniqueSorted(regionRecords.map(record => record.sourceBank)),
      consumerLabels,
      resolvedOffsets: offsets,
      resolvedFields,
      unresolvedFields,
      activeBankStatus: 'unresolved_no_trusted_mapper_latch_source',
      runtimeObservationReady: false,
      closureReady: false,
      semanticPromotionReady: false,
      probes: regionRecords.map(record => ({
        probeId: record.probeId,
        operationId: record.operationId,
        singleAddress: record.singleAddress,
        status: record.status,
        hit: record.hit,
        resolvedFields: record.resolvedFields,
        unresolvedFields: record.unresolvedFields,
        derived: record.derived,
      })),
      evidence: hitRecords.length
        ? [
            `${relative(reportPath)} contains a byte-clean single-address read breakpoint hit for this region.`,
            'The hit resolves the cursor/read offset because only one logical address was watched for that probe.',
            'The consumer label is derived from a transient debugger PC symbol lookup; raw PC is not persisted.',
            'active_bank remains unresolved because no trusted mapper-latch source is available in this report.',
          ]
        : [
            `${relative(reportPath)} contains no single-address read breakpoint hit for this region on the selected route.`,
          ],
    };
  });
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceLocalReports: [relative(reportPath)],
    eventKind: 'wb3_gearsystem_mcp_callback_field_probe',
    assetPolicy: report.assetPolicy,
    summary: {
      reportByteClean: reportByteClean(report),
      reportMacroProbeUsable: report.summary?.macroProbeUsable === true,
      probedRegionCount: records.length,
      probedSingleAddressCount: (report.records || []).length,
      hitRegionCount: records.filter(record => record.hitCount > 0).length,
      hitCount: records.reduce((sum, record) => sum + record.hitCount, 0),
      consumerLabelResolvedRegionCount: records.filter(record => record.consumerLabels.length > 0).length,
      offsetResolvedRegionCount: records.filter(record => record.resolvedOffsets.length > 0).length,
      activeBankResolvedRegionCount: 0,
      runtimeObservationReadyCount: 0,
      closureReadyCount: 0,
      semanticPromotionReadyCount: 0,
      regionIds: records.map(record => record.regionId),
      operationIds: uniqueSorted(records.flatMap(record => record.operationIds || [])),
      hookIds: uniqueSorted(records.flatMap(record => record.hookIds || [])),
      consumerLabels: uniqueSorted(records.flatMap(record => record.consumerLabels || [])),
      resolvedFields: uniqueSorted(records.flatMap(record => record.resolvedFields || [])),
      unresolvedFields: uniqueSorted(records.flatMap(record => record.unresolvedFields || [])),
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
      launch: 'node tools/world-gearsystem-launch.mjs --port 7777',
      plan: `node ${toolName} --out tmp/world-gearsystem-mcp-callback-field-probe.plan.local.json`,
      runStartOnly: `node ${toolName} --execute --port 7777 --out tmp/world-gearsystem-mcp-callback-field-probe.local.json`,
      apply: `node ${toolName} --apply --report tmp/world-gearsystem-mcp-callback-field-probe.local.json`,
    },
    evidence: [
      'Single-address read breakpoints are used to resolve cursor/read offsets without persisting memory bytes.',
      'Consumer labels are symbol names derived from transient debugger PC values; raw PC values are not persisted.',
      'active_bank remains unresolved until Gearsystem/MCP exposes a trusted mapper-latch value or equivalent callback field.',
    ],
    nextLeads: [
      'Review these field probes as local observations for consumer_label and cursor_offset on r2815-r2817.',
      'Add a mapper-latch callback source before filling active_bank.',
      'Continue route/save-state work for r2813 and r0749, which still need direct execution/read hits.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'gearsystem_mcp_callback_field_probe' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpCallbackFieldProbeAudit = {
      catalogId,
      kind: 'gearsystem_mcp_callback_field_probe',
      status: record.status,
      reportPath: record.reportPath,
      byteClean: record.byteClean,
      macroProbeUsable: record.macroProbeUsable,
      probeCount: record.probeCount,
      hitCount: record.hitCount,
      operationIds: record.operationIds,
      hookIds: record.hookIds,
      sourceBanks: record.sourceBanks,
      consumerLabels: record.consumerLabels,
      resolvedOffsets: record.resolvedOffsets,
      resolvedFields: record.resolvedFields,
      unresolvedFields: record.unresolvedFields,
      activeBankStatus: record.activeBankStatus,
      runtimeObservationReady: false,
      closureReady: false,
      semanticPromotionReady: false,
      summary: 'Single-address Gearsystem/MCP read probe metadata; resolves consumer labels and cursor/read offsets where hit, but keeps active_bank unresolved.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      status: record.status,
      hitCount: record.hitCount,
      consumerLabels: record.consumerLabels,
      resolvedOffsets: record.resolvedOffsets,
      unresolvedFields: record.unresolvedFields,
    });
  }

  mapData.gearsystemMcpCallbackFieldProbeCatalogs = (mapData.gearsystemMcpCallbackFieldProbeCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpCallbackFieldProbeCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_callback_field_probe_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
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
  staticMap.summary.gearsystemMcpCallbackFieldProbeCatalog = catalogId;
  staticMap.summary.gearsystemMcpCallbackFieldProbeHitRegionCount = catalog.summary.hitRegionCount;
  staticMap.summary.gearsystemMcpCallbackFieldProbeConsumerLabelResolvedRegionCount = catalog.summary.consumerLabelResolvedRegionCount;
  staticMap.summary.gearsystemMcpCallbackFieldProbeOffsetResolvedRegionCount = catalog.summary.offsetResolvedRegionCount;
  staticMap.summary.gearsystemMcpCallbackFieldProbeActiveBankResolvedRegionCount = catalog.summary.activeBankResolvedRegionCount;
  staticMap.summary.gearsystemMcpCallbackFieldProbeRuntimeObservationReadyCount = catalog.summary.runtimeObservationReadyCount;
  staticMap.summary.gearsystemMcpCallbackFieldProbeClosureReadyCount = catalog.summary.closureReadyCount;
  staticMap.summary.gearsystemMcpCallbackFieldProbeSemanticPromotionReadyCount = catalog.summary.semanticPromotionReadyCount;
  staticMap.summary.gearsystemMcpCallbackFieldProbeConsumerLabels = catalog.summary.consumerLabels;
  staticMap.summary.gearsystemMcpCallbackFieldProbeResolvedFields = catalog.summary.resolvedFields;
  staticMap.summary.gearsystemMcpCallbackFieldProbeUnresolvedFields = catalog.summary.unresolvedFields;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`gearsystemMcpCallbackFieldProbe${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-callback-field-probe-catalog-2026-06-26 to review r2815-r2817 consumer_label and cursor_offset, while keeping active_bank unresolved.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

async function main() {
  const execute = hasArg('--execute');
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const baseUrl = argValue('--url') || `http://${argValue('--address') || '127.0.0.1'}:${argValue('--port') || '7777'}`;
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const reportPath = resolveRepoPath(argValue('--report')) || outputPath;
  const mapData = readJson(mapPath);
  const setupPlan = readJson(setupPlanPath);
  const options = {
    baseUrl,
    regionIds: normalizeFilters([...argValues('--region'), ...argValues('--regions')]),
    operationIds: normalizeFilters([...argValues('--operation'), ...argValues('--operations')]),
    routeId: argValue('--route') || 'boot_start_idle_probe',
    fullRange: hasArg('--full-range'),
    maxAddresses: Number(argValue('--max-addresses') || 32),
    resetBeforeProbe: !hasArg('--no-reset'),
    clearExistingBreakpoints: !hasArg('--no-clear-existing'),
    pollCount: Number(argValue('--polls') || argValue('--poll-count') || 20),
    pollMs: Number(argValue('--poll-ms') || 100),
  };
  const plan = buildPlan(setupPlan, mapData, options);

  if (execute) {
    const report = await executePlan(plan, setupPlan, options);
    if (!noWrite) writeJson(outputPath, report);
    console.log(JSON.stringify({
      ok: report.summary.macroProbeUsable,
      executed: true,
      output: noWrite ? null : relative(outputPath),
      summary: report.summary,
      assetPolicy: report.assetPolicy,
    }, null, 2));
    if (!report.summary.macroProbeUsable) process.exitCode = 1;
    if (!apply) return;
  } else if (!apply) {
    if (!noWrite) writeJson(outputPath, plan);
    console.log(JSON.stringify({
      ok: true,
      executed: false,
      output: noWrite ? null : relative(outputPath),
      summary: plan.summary,
      assetPolicy: plan.assetPolicy,
    }, null, 2));
    return;
  }

  const report = execute && !noWrite && outputPath === reportPath
    ? readJson(outputPath)
    : readJson(reportPath);
  const catalog = buildCatalogFromReport(reportPath, report);
  let result = { changedRegions: [], missingRegions: [] };
  if (apply) {
    result = applyCatalog(mapData, catalog);
    if (!noWrite) {
      writeJson(mapPath, mapData);
      updateStaticMap(catalog);
    }
  }
  if (!noWrite) writeJson(outputPath, execute ? report : catalog);
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

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    hint: 'Start Gearsystem first for --execute: node tools/world-gearsystem-launch.mjs --port 7777',
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
