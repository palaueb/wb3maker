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
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-mapper-state-tracker.local.json');
const catalogId = 'world-gearsystem-mcp-mapper-state-tracker-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-mapper-state-tracker-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-mapper-state-tracker-audit.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;

const defaultTargetRegionIds = ['r2815', 'r2816', 'r2817'];
const mapperWriteAddress = '0xFFFF';
const mapperWriteSymbol = '_RAM_FFFF_';
const mapperMirrorSymbol = '_RAM_DFFF_';

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
  {
    id: 'boot_start_right_jump_probe',
    label: 'Boot start right+jump probe',
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

function operationRegionIds(operation) {
  return [
    ...(operation.regionIds || []),
    ...(operation.source?.regionIds || []),
    operation.source?.regionId,
  ].filter(Boolean);
}

function operationRange(operation) {
  const start = parseHex(operation.arguments?.start_address || operation.arguments?.address);
  const end = parseHex(operation.arguments?.end_address || operation.arguments?.address);
  if (start == null || end == null || end < start) return null;
  return { start, end };
}

function targetReadOperations(setupPlan, regionIds) {
  const requestedRegionIds = normalizeFilters(regionIds || []);
  const filters = new Set(requestedRegionIds.length ? requestedRegionIds : defaultTargetRegionIds);
  return (setupPlan.operations || []).filter(operation => {
    if (operation.kind !== 'read_range_breakpoint') return false;
    const ids = operationRegionIds(operation);
    if (filters.size && !ids.some(id => filters.has(id))) return false;
    return (operation.source?.requiredCaptureFields || []).includes('active_bank');
  });
}

function selectedRoutes(routeIds, allRoutes) {
  const filters = normalizeFilters(routeIds || []);
  if (allRoutes || !filters.length) return [routeCatalog[0]];
  const set = new Set(filters);
  return routeCatalog.filter(route => set.has(route.id));
}

function compactRoute(route) {
  return {
    id: route.id,
    label: route.label,
    commandCount: route.commands.length,
    waitFrameCount: route.commands.reduce((sum, command) => sum + Number(command.wait || 0), 0),
    buttons: uniqueSorted(route.commands.flatMap(command =>
      ['tap', 'press', 'release'].map(key => command[key] ? `${key}:${command[key]}` : null))),
  };
}

function scanMapperWrites() {
  const lines = fs.readFileSync(asmPath, 'utf8').split(/\r?\n/);
  let currentLabel = null;
  const writes = [];
  lines.forEach((line, index) => {
    const label = line.match(/^(_(?:LABEL|DATA)_[0-9A-FA-F]+_):/);
    if (label) currentLabel = label[1];
    if (/ld\s+\(_RAM_FFFF_\),\s*a/i.test(line)) {
      writes.push({
        asmLine: index + 1,
        enclosingLabel: currentLabel,
        instructionShape: 'ld (_RAM_FFFF_), a',
      });
    }
  });
  return writes;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData || {})) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function buildTarget(operation, mapData) {
  const regionId = operation.source?.regionId || operationRegionIds(operation)[0] || null;
  const region = (mapData.regions || []).find(candidate => candidate.id === regionId);
  const range = operationRange(operation);
  return {
    regionId,
    operationId: operation.id,
    hookIds: operation.source?.hookIds || [],
    sourceBank: operation.source?.bank || null,
    logicalStart: range ? hex(range.start) : null,
    logicalEndInclusive: range ? hex(range.end) : null,
    singleAddress: range ? hex(range.start) : null,
    regionOffset: region?.offset || null,
    regionType: region?.type || null,
  };
}

function buildTargets(setupPlan, mapData, options = {}) {
  return targetReadOperations(setupPlan, options.regionIds).map(operation => buildTarget(operation, mapData));
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

function targetByPcLabel(targets, label) {
  if (label !== '_LABEL_919_') return null;
  const matches = targets.filter(target => target.hookIds.includes('residual_palette_tail_cursor_watch'));
  return matches.length === 1 ? matches[0] : null;
}

function resolvePcLabel(status) {
  const pc = parseHex(status.pc || status.PC || '');
  if (pc == null) return null;
  if (pc >= 0x0919 && pc < 0x098F) return '_LABEL_919_';
  if (pc >= 0x1023 && pc < 0x1036) return '_LABEL_1023_';
  if (pc >= 0x1036 && pc < 0x1044) return '_LABEL_1036_';
  return null;
}

async function clearBreakpoints(baseUrl, targets) {
  const results = [];
  const mapperClear = await callTool(baseUrl, 'remove_breakpoint', {
    address: mapperWriteAddress,
    memory_area: 'rom_ram',
  });
  results.push({ kind: 'clear:mapper_write_watchpoint', result: sanitizeRpcResult(mapperClear) });
  for (const target of targets) {
    if (!target.singleAddress) continue;
    const clear = await callTool(baseUrl, 'remove_breakpoint', {
      address: target.singleAddress,
      memory_area: 'rom_ram',
    });
    results.push({ kind: 'clear:target_read_watchpoint', operationId: target.operationId, result: sanitizeRpcResult(clear) });
  }
  return results;
}

async function setupBreakpoints(baseUrl, targets) {
  const results = [];
  const mapper = await callTool(baseUrl, 'set_breakpoint', {
    address: mapperWriteAddress,
    memory_area: 'rom_ram',
    read: false,
    write: true,
    execute: false,
  });
  results.push({ kind: 'setup:mapper_write_watchpoint', result: sanitizeRpcResult(mapper) });
  for (const target of targets) {
    if (!target.singleAddress) continue;
    const read = await callTool(baseUrl, 'set_breakpoint', {
      address: target.singleAddress,
      memory_area: 'rom_ram',
      read: true,
      write: false,
      execute: false,
    });
    results.push({ kind: 'setup:target_read_watchpoint', operationId: target.operationId, result: sanitizeRpcResult(read) });
  }
  return results;
}

async function runTracker(baseUrl, plan, route, options = {}) {
  const controlResults = [];
  const init = await rpc(baseUrl, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'wb3-world-gearsystem-mapper-state-tracker', version: '1' },
  });
  controlResults.push({ kind: 'initialize', result: sanitizeRpcResult(init) });
  if (!init.ok) {
    return { controlResults, hitSummaries: [], status: 'initialize_failed' };
  }
  if (options.resetBeforeRoute) {
    controlResults.push({ kind: 'debug_reset', result: sanitizeRpcResult(await callTool(baseUrl, 'debug_reset', {})) });
  }
  if (options.clearExistingBreakpoints) {
    controlResults.push(...await clearBreakpoints(baseUrl, plan.targets));
  }
  controlResults.push(...await setupBreakpoints(baseUrl, plan.targets));
  controlResults.push({ kind: 'debug_continue', result: sanitizeRpcResult(await callTool(baseUrl, 'debug_continue', {})) });
  controlResults.push({ kind: 'controller_macro', result: sanitizeRpcResult(await callTool(baseUrl, 'controller_macro', { commands: route.commands })) });

  let activeBank = null;
  const hitSummaries = [];
  const pollCount = Math.max(1, Number(options.pollCount || 40));
  const pollMs = Math.max(10, Number(options.pollMs || 100));
  for (let pollIndex = 0; pollIndex < pollCount; pollIndex++) {
    if (pollIndex) await new Promise(resolve => setTimeout(resolve, pollMs));
    const debug = parseToolTextJson(await callTool(baseUrl, 'debug_get_status', {}));
    if (debug.at_breakpoint !== true) continue;
    const z80 = parseToolTextJson(await callTool(baseUrl, 'get_z80_status', {}));
    const label = resolvePcLabel(debug);
    const target = targetByPcLabel(plan.targets, label);
    if (target) {
      hitSummaries.push({
        kind: 'target_read_hit',
        routeId: route.id,
        regionId: target.regionId,
        operationId: target.operationId,
        hookIds: target.hookIds,
        targetLabel: label,
        activeBankResolved: activeBank != null,
        active_bank: activeBank == null ? null : activeBank,
        activeBankSource: activeBank == null ? null : 'transient_mapper_write_watchpoint_state',
        persistedRegisterTraceCount: 0,
        persistedProgramCounterCount: 0,
      });
      break;
    }
    const a = parseHex(z80.A);
    if (a != null) {
      activeBank = a;
      hitSummaries.push({
        kind: 'mapper_write_hit',
        routeId: route.id,
        mapperWriteAddress,
        mapperWriteSymbol,
        activeBankStateUpdated: true,
        activeBankValuePersisted: false,
        source: 'transient_z80_A_at_mapper_write_watchpoint',
        persistedRegisterTraceCount: 0,
        persistedProgramCounterCount: 0,
      });
    } else {
      hitSummaries.push({
        kind: 'breakpoint_hit_unclassified',
        routeId: route.id,
        activeBankStateUpdated: false,
        activeBankValuePersisted: false,
        persistedRegisterTraceCount: 0,
        persistedProgramCounterCount: 0,
      });
    }
    await callTool(baseUrl, 'debug_continue', {});
  }
  controlResults.push({ kind: 'debug_pause_end', result: sanitizeRpcResult(await callTool(baseUrl, 'debug_pause', {})) });
  controlResults.push(...await clearBreakpoints(baseUrl, plan.targets));
  return {
    controlResults,
    hitSummaries,
    status: hitSummaries.some(hit => hit.kind === 'target_read_hit' && hit.activeBankResolved)
      ? 'target_read_active_bank_resolved'
      : hitSummaries.some(hit => hit.kind === 'target_read_hit')
        ? 'target_read_hit_active_bank_unresolved'
        : hitSummaries.some(hit => hit.kind === 'mapper_write_hit')
          ? 'mapper_write_hits_no_target_read'
          : 'no_breakpoint_hits',
  };
}

function buildPlan(mapData, setupPlan, options = {}) {
  const mapperWrites = scanMapperWrites();
  const targets = buildTargets(setupPlan, mapData, options);
  const routes = selectedRoutes(options.routeIds, options.allRoutes);
  return {
    schemaVersion,
    eventKind: 'wb3_gearsystem_mcp_mapper_state_tracker_plan',
    generatedAt: now,
    generatedBy: toolName,
    executed: false,
    sourceFiles: [
      'projects/WORLD/map.json',
      'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm',
      'gearsystem/world-residual-mcp-setup-plan.json',
    ],
    mapperWriteWatchpoint: {
      address: mapperWriteAddress,
      symbol: mapperWriteSymbol,
      mode: 'write',
      transientValueSource: 'z80_A_at_write_breakpoint',
      persistedValuePolicy: 'do_not_persist_write_values_unless_promoted_as_reviewed_active_bank_on_target_hit',
    },
    mapperWriteStaticEvidence: {
      writeInstructionShape: 'ld (_RAM_FFFF_), a',
      writeSiteCount: mapperWrites.length,
      helperLabels: ['_LABEL_1023_', '_LABEL_1036_'],
      mirrorSymbol: mapperMirrorSymbol,
      sampleWriteSites: mapperWrites.slice(0, 12),
    },
    targets,
    routes: routes.map(compactRoute),
    summary: {
      targetRegionCount: uniqueSorted(targets.map(target => target.regionId)).length,
      targetReadWatchpointCount: targets.length,
      routeCount: routes.length,
      mapperWriteStaticSiteCount: mapperWrites.length,
      helperLabelCount: 2,
      trackerScaffoldReady: true,
      activeBankObservationReadyCount: 0,
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
    assetPolicy: 'Metadata only: mapper watchpoint address/symbol, ASM line numbers, labels, region ids, operation ids, hook ids, counts, statuses, booleans, and reviewed active_bank values only if a target read hit is reached. The tool may read Z80 A and PC transiently while paused, but it does not persist register traces, PC values, memory bytes, ROM bytes, VDP port values, pixels, screenshots, audio bytes, samples, or instruction bytes.',
  };
}

async function buildExecutionReport(plan, options = {}) {
  const baseUrl = options.baseUrl;
  const routeReports = [];
  for (const route of selectedRoutes(options.routeIds, options.allRoutes)) {
    routeReports.push({
      route: compactRoute(route),
      ...(await runTracker(baseUrl, plan, route, options)),
    });
  }
  const hitSummaries = routeReports.flatMap(report => report.hitSummaries || []);
  const controlResults = routeReports.flatMap(report => report.controlResults || []);
  return {
    ...plan,
    eventKind: 'wb3_gearsystem_mcp_mapper_state_tracker_report',
    executed: true,
    routeReports,
    summary: {
      ...plan.summary,
      controlResultCount: controlResults.length,
      failedControlResultCount: controlResults.filter(item => item.result?.ok !== true).length,
      breakpointHitCount: hitSummaries.length,
      mapperWriteHitCount: hitSummaries.filter(hit => hit.kind === 'mapper_write_hit').length,
      targetReadHitCount: hitSummaries.filter(hit => hit.kind === 'target_read_hit').length,
      activeBankObservationReadyCount: hitSummaries.filter(hit => hit.kind === 'target_read_hit' && hit.activeBankResolved).length,
      macroProbeUsable: controlResults.length > 0 && controlResults.every(item => item.result?.ok === true),
      requestedPollCountPerRoute: Number(options.pollCount || 40),
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
  };
}

function catalogRecords(mapData, planOrReport) {
  const reportHits = (planOrReport.routeReports || []).flatMap(route => route.hitSummaries || []);
  const readyByRegion = new Map();
  for (const hit of reportHits) {
    if (hit.kind !== 'target_read_hit' || !hit.activeBankResolved || !hit.regionId) continue;
    readyByRegion.set(hit.regionId, hit);
  }
  return defaultTargetRegionIds.map(regionId => {
    const region = (mapData.regions || []).find(candidate => candidate.id === regionId);
    const target = (planOrReport.targets || []).find(candidate => candidate.regionId === regionId) || null;
    const ready = readyByRegion.get(regionId) || null;
    return {
      regionId,
      regionOffset: region?.offset || null,
      regionType: region?.type || null,
      status: ready
        ? 'mapper_state_tracker_active_bank_observation_ready'
        : 'mapper_state_tracker_scaffold_ready_waiting_for_target_hit',
      trackerScaffoldReady: true,
      activeBankObservationReady: Boolean(ready),
      operationId: target?.operationId || null,
      hookIds: target?.hookIds || [],
      logicalStart: target?.logicalStart || null,
      activeBankSource: ready?.activeBankSource || null,
      active_bank: ready?.active_bank ?? null,
      evidence: ready
        ? [
            'A target read hit was observed after at least one transient mapper-write watchpoint updated active bank state.',
            'Only the reviewed active_bank value is persisted; raw register values and PC values are not persisted.',
          ]
        : [
            'The mapper-state tracker scaffold can watch writes to _RAM_FFFF_ and target read watchpoints, but no reviewed active_bank observation is available for this region yet.',
            'This is a capture path, not residual closure evidence.',
          ],
    };
  });
}

function buildCatalog(mapData, planOrReport) {
  const records = catalogRecords(mapData, planOrReport);
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceFiles: planOrReport.sourceFiles || [],
    sourceLocalReports: planOrReport.sourceLocalReports || [],
    eventKind: 'wb3_gearsystem_mcp_mapper_state_tracker',
    assetPolicy: planOrReport.assetPolicy,
    mapperWriteWatchpoint: planOrReport.mapperWriteWatchpoint,
    mapperWriteStaticEvidence: planOrReport.mapperWriteStaticEvidence,
    summary: {
      targetRegionCount: records.length,
      trackerScaffoldReadyRegionCount: records.filter(record => record.trackerScaffoldReady).length,
      activeBankObservationReadyCount: records.filter(record => record.activeBankObservationReady).length,
      mapperWriteStaticSiteCount: planOrReport.mapperWriteStaticEvidence?.writeSiteCount || 0,
      executed: planOrReport.executed === true,
      mapperWriteHitCount: planOrReport.summary?.mapperWriteHitCount || 0,
      targetReadHitCount: planOrReport.summary?.targetReadHitCount || 0,
      regionIds: records.map(record => record.regionId),
      operationIds: uniqueSorted(records.map(record => record.operationId)),
      hookIds: uniqueSorted(records.flatMap(record => record.hookIds || [])),
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
      plan: `node ${toolName} --out tmp/world-gearsystem-mcp-mapper-state-tracker.local.json`,
      execute: `node ${toolName} --execute --port 7777 --out tmp/world-gearsystem-mcp-mapper-state-tracker.local.json`,
      apply: `node ${toolName} --apply --report tmp/world-gearsystem-mcp-mapper-state-tracker.local.json`,
    },
    evidence: [
      'ASM contains direct writes to _RAM_FFFF_ using ld (_RAM_FFFF_), a.',
      '_LABEL_1023_ pushes the previous bank and writes requested A to _RAM_FFFF_; _LABEL_1036_ restores a saved bank to _RAM_FFFF_.',
      'The tracker uses this write-watchpoint path as an alternative to an explicit emulator mapper-slot field.',
    ],
    nextLeads: [
      'Run the mapper-state tracker from a save-state or route that reliably reaches r2815-r2817 target reads.',
      'If the tracker produces active_bank observations, pass them through the residual observation audit before proof closure.',
      'Keep active_bank unresolved for regions without a target read hit in the same tracked run.',
    ],
  };
}

function mergeReports(reports) {
  const base = reports[0] || {};
  const routeReports = reports.flatMap(report => report.routeReports || []);
  const targetsByKey = new Map();
  for (const report of reports) {
    for (const target of report.targets || []) {
      const key = `${target.regionId}:${target.operationId}`;
      if (!targetsByKey.has(key)) targetsByKey.set(key, target);
    }
  }
  const hitSummaries = routeReports.flatMap(route => route.hitSummaries || []);
  const controlResults = routeReports.flatMap(route => route.controlResults || []);
  return {
    ...base,
    eventKind: 'wb3_gearsystem_mcp_mapper_state_tracker_merged_report',
    executed: reports.some(report => report.executed === true),
    sourceLocalReports: reports.map(report => report.sourceLocalReport || report.outputPath).filter(Boolean),
    targets: [...targetsByKey.values()],
    routeReports,
    summary: {
      ...(base.summary || {}),
      controlResultCount: controlResults.length,
      failedControlResultCount: controlResults.filter(item => item.result?.ok !== true).length,
      breakpointHitCount: hitSummaries.length,
      mapperWriteHitCount: hitSummaries.filter(hit => hit.kind === 'mapper_write_hit').length,
      targetReadHitCount: hitSummaries.filter(hit => hit.kind === 'target_read_hit').length,
      activeBankObservationReadyCount: hitSummaries.filter(hit => hit.kind === 'target_read_hit' && hit.activeBankResolved).length,
      macroProbeUsable: controlResults.length > 0 && controlResults.every(item => item.result?.ok === true),
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
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'gearsystem_mcp_mapper_state_tracker' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpMapperStateTrackerAudit = {
      catalogId,
      kind: 'gearsystem_mcp_mapper_state_tracker',
      status: record.status,
      trackerScaffoldReady: record.trackerScaffoldReady,
      activeBankObservationReady: record.activeBankObservationReady,
      operationId: record.operationId,
      hookIds: record.hookIds,
      logicalStart: record.logicalStart,
      activeBankSource: record.activeBankSource,
      active_bank: record.active_bank,
      summary: 'Mapper-state tracker scaffold for deriving active_bank from transient _RAM_FFFF_ write watchpoints and target read hits.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: record.regionId,
      status: record.status,
      trackerScaffoldReady: record.trackerScaffoldReady,
      activeBankObservationReady: record.activeBankObservationReady,
    });
  }
  mapData.gearsystemMcpMapperStateTrackerCatalogs = (mapData.gearsystemMcpMapperStateTrackerCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpMapperStateTrackerCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_mapper_state_tracker_audit',
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
  staticMap.summary.gearsystemMcpMapperStateTrackerCatalog = catalogId;
  staticMap.summary.gearsystemMcpMapperStateTrackerScaffoldReadyRegionCount = catalog.summary.trackerScaffoldReadyRegionCount;
  staticMap.summary.gearsystemMcpMapperStateTrackerActiveBankObservationReadyCount = catalog.summary.activeBankObservationReadyCount;
  staticMap.summary.gearsystemMcpMapperStateTrackerMapperWriteStaticSiteCount = catalog.summary.mapperWriteStaticSiteCount;
  staticMap.summary.gearsystemMcpMapperStateTrackerMapperWriteHitCount = catalog.summary.mapperWriteHitCount;
  staticMap.summary.gearsystemMcpMapperStateTrackerTargetReadHitCount = catalog.summary.targetReadHitCount;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`gearsystemMcpMapperStateTracker${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-mapper-state-tracker-catalog-2026-06-26 to derive active_bank from transient mapper-write watchpoints when target reads are reachable.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

async function main() {
  const execute = hasArg('--execute');
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const reportPaths = argValues('--report').map(resolveRepoPath);
  const reportPath = reportPaths[0] || outputPath;
  const baseUrl = argValue('--url') || `http://${argValue('--address') || '127.0.0.1'}:${argValue('--port') || '7777'}`;
  const options = {
    baseUrl,
    regionIds: normalizeFilters([...argValues('--region'), ...argValues('--regions')]),
    routeIds: normalizeFilters([...argValues('--route'), ...argValues('--routes')]),
    allRoutes: hasArg('--all-routes'),
    resetBeforeRoute: !hasArg('--no-reset'),
    clearExistingBreakpoints: !hasArg('--no-clear-existing'),
    pollCount: Number(argValue('--polls') || argValue('--poll-count') || 40),
    pollMs: Number(argValue('--poll-ms') || 100),
  };
  const mapData = readJson(mapPath);
  const setupPlan = readJson(setupPlanPath);
  let planOrReport = buildPlan(mapData, setupPlan, options);
  if (execute) planOrReport = await buildExecutionReport(planOrReport, options);
  if (!execute && apply) {
    const reports = (reportPaths.length ? reportPaths : [reportPath]).map(filePath => ({
      ...readJson(filePath),
      sourceLocalReport: relative(filePath),
    }));
    planOrReport = reports.length === 1 ? reports[0] : mergeReports(reports);
  }
  const catalog = buildCatalog(mapData, planOrReport);

  let result = { changedRegions: [], missingRegions: [] };
  if (apply) {
    result = applyCatalog(mapData, catalog);
    if (!noWrite) {
      writeJson(mapPath, mapData);
      updateStaticMap(catalog);
    }
  }
  if (!noWrite) writeJson(outputPath, execute ? planOrReport : catalog);
  console.log(JSON.stringify({
    ok: true,
    executed: execute,
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
