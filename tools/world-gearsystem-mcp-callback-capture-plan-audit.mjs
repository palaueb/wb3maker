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
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-callback-capture-plan.local.json');
const cleanHookGapCatalogId = 'world-gearsystem-mcp-clean-hook-gap-catalog-2026-06-26';
const observationCandidateCatalogId = 'world-gearsystem-mcp-observation-candidate-catalog-2026-06-26';
const readRangeHookBindingCatalogId = 'world-gearsystem-mcp-read-range-hook-binding-catalog-2026-06-26';
const r2813DirectReadHookDecisionCatalogId = 'world-r2813-direct-read-hook-decision-catalog-2026-06-26';
const catalogId = 'world-gearsystem-mcp-callback-capture-plan-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-callback-capture-plan-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-callback-capture-plan-audit.mjs';
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

function operationKindForFieldStatus(status) {
  if (status === 'needs_debugger_callback_value_at_read_range_breakpoint') return 'read_range_breakpoint';
  if (status === 'needs_debugger_callback_value_at_execution_breakpoint') return 'execution_breakpoint';
  if (status === 'needs_same_frame_promotion_gate_derivation') return 'same_frame_derivation';
  return 'unmapped';
}

function captureSourceForFieldStatus(status) {
  if (status === 'needs_same_frame_promotion_gate_derivation') return 'derive_from_reviewed_same_frame_observations';
  if (status === 'needs_debugger_callback_value_at_read_range_breakpoint') return 'gearsystem_mcp_read_range_callback';
  if (status === 'needs_debugger_callback_value_at_execution_breakpoint') return 'gearsystem_mcp_execution_callback';
  return 'adapter_required';
}

function recordsByRegion(catalog) {
  return new Map((catalog.records || []).map(record => [record.regionId, record]));
}

function candidatesByRegion(catalog) {
  const byRegion = new Map();
  for (const record of catalog.records || []) {
    byRegion.set(record.regionId, record);
  }
  return byRegion;
}

function bindingRecordsByRegion(catalog) {
  const byRegion = new Map();
  for (const record of catalog?.records || []) {
    if (!record.regionId) continue;
    if (!byRegion.has(record.regionId)) byRegion.set(record.regionId, []);
    byRegion.get(record.regionId).push(record);
  }
  return byRegion;
}

function directReadHookDecisionByRegion(catalog) {
  const byRegion = new Map();
  if (catalog?.summary?.regionId) byRegion.set(catalog.summary.regionId, catalog);
  return byRegion;
}

function matchingOperations(record, hookId, operationKind) {
  if (operationKind === 'same_frame_derivation') return [];
  return (record.setupOperations || []).filter(operation =>
    operation.kind === operationKind &&
    (operation.hookIds || []).includes(hookId));
}

function matchingCandidateRecord(candidateRecord, hookId) {
  const candidates = (candidateRecord?.candidates || []).filter(candidate => candidate.hookId === hookId);
  if (!candidates.length) return null;
  return {
    candidateCount: candidates.length,
    reportPaths: uniqueSorted(candidates.map(candidate => candidate.reportPath)),
    matchedOperationIds: uniqueSorted(candidates.flatMap(candidate => candidate.matchedOperationIds || [])),
    filledRequiredFields: uniqueSorted(candidates.flatMap(candidate => candidate.filledRequiredFields || [])),
    missingRequiredFields: uniqueSorted(candidates.flatMap(candidate => candidate.missingRequiredFields || [])),
    reviewStatus: uniqueSorted(candidates.map(candidate => candidate.reviewStatus)),
    candidateOnly: candidates.every(candidate => candidate.candidateOnly === true),
  };
}

function taskStatus(record, hookId, operationKind, operations, candidate) {
  if (operationKind === 'same_frame_derivation') {
    return 'blocked_until_same_frame_required_hooks_complete';
  }
  if (!operations.length) {
    return 'needs_watchpoint_or_breakpoint_adapter_support';
  }
  if (operationKind === 'read_range_breakpoint') {
    if (record.readRangeHitObserved && candidate) {
      return 'reachability_hit_candidate_incomplete_needs_callback_values';
    }
    if (record.readRangeHitObserved) {
      return 'reachability_hit_needs_callback_values';
    }
    return 'scaffold_ready_waiting_for_read_range_hit';
  }
  const matchedExecutionHitCount = (record.executionProbeReports || [])
    .reduce((sum, report) => sum + Number(report.matchedExecutionHitCount || 0), 0);
  if (matchedExecutionHitCount > 0) {
    return 'execution_hit_needs_callback_values';
  }
  return 'scaffold_ready_waiting_for_execution_hit';
}

function buildCaptureTask(record, candidateRecord, hookId, rows) {
  const statuses = uniqueSorted(rows.map(row => row.status));
  const operationKinds = uniqueSorted(statuses.map(operationKindForFieldStatus));
  const operationKind = operationKinds.includes('same_frame_derivation')
    ? 'same_frame_derivation'
    : operationKinds.includes('read_range_breakpoint')
      ? 'read_range_breakpoint'
      : operationKinds.includes('execution_breakpoint')
        ? 'execution_breakpoint'
        : operationKinds[0] || 'unmapped';
  const operations = matchingOperations(record, hookId, operationKind);
  const candidate = matchingCandidateRecord(candidateRecord, hookId);
  const requiredFields = uniqueSorted(rows.map(row => row.field));
  const candidateFilledFields = candidate?.filledRequiredFields || [];
  const candidateMissingFields = candidate?.missingRequiredFields || [];
  const remainingRequiredFields = candidate
    ? uniqueSorted(requiredFields.filter(field => !candidateFilledFields.includes(field)))
    : requiredFields;
  const remainingCallbackFields = operationKind === 'same_frame_derivation' ? [] : remainingRequiredFields;
  const remainingDerivationFields = operationKind === 'same_frame_derivation' ? remainingRequiredFields : [];
  const reportPaths = uniqueSorted([
    ...(record.macroReports || []).map(report => report.path),
    ...(record.executionProbeReports || []).map(report => report.path),
    ...(candidate?.reportPaths || []),
  ]);

  return {
    regionId: record.regionId,
    hookId,
    operationKind,
    captureSource: captureSourceForFieldStatus(rows[0]?.status),
    status: taskStatus(record, hookId, operationKind, operations, candidate),
    requiredFields,
    requiredFieldCount: requiredFields.length,
    candidateFilledFields,
    candidateMissingFields,
    remainingRequiredFields,
    remainingRequiredFieldCount: remainingRequiredFields.length,
    remainingCallbackFields,
    remainingCallbackFieldCount: remainingCallbackFields.length,
    remainingDerivationFields,
    remainingDerivationFieldCount: remainingDerivationFields.length,
    operationIds: uniqueSorted([
      ...operations.map(operation => operation.id),
      ...(candidate?.matchedOperationIds || []),
    ]),
    labels: uniqueSorted(operations.flatMap(operation => operation.labels || [])),
    hookBreakpointRoles: uniqueSorted(operations.flatMap(operation => operation.hookBreakpointRoles || [])),
    logicalAddresses: uniqueSorted(operations.flatMap(operation =>
      [operation.logicalAddress, operation.logicalEndAddress].filter(Boolean))),
    reportPaths,
    candidateOnly: candidate?.candidateOnly === true,
    candidateCount: candidate?.candidateCount || 0,
    canWriteRuntimeObservationNow: false,
    closureReady: false,
    semanticPromotionReady: false,
    nextAction: operationKind === 'same_frame_derivation'
      ? 'Derive the promotion-gate fields only after all required same-frame callback observations for this region pass review.'
      : operations.length
        ? 'Capture only the named callback fields at the listed operation ids; persist field names and derived metadata only after review.'
        : 'Add a debugger watchpoint or breakpoint adapter before this hook can produce reviewed observations.',
  };
}

function buildRegionPlan(record, candidateRecord, bindingRecords = [], directReadDecision = null) {
  const rowsByHook = new Map();
  for (const row of record.missingCleanHookFields || []) {
    if (!rowsByHook.has(row.hookId)) rowsByHook.set(row.hookId, []);
    rowsByHook.get(row.hookId).push(row);
  }
  const tasks = [...rowsByHook.entries()].map(([hookId, rows]) =>
    buildCaptureTask(record, candidateRecord, hookId, rows));
  const callbackTasks = tasks.filter(task => task.operationKind !== 'same_frame_derivation');
  const derivationTasks = tasks.filter(task => task.operationKind === 'same_frame_derivation');
  const readRangeTasks = tasks.filter(task => task.operationKind === 'read_range_breakpoint');
  const executionTasks = tasks.filter(task => task.operationKind === 'execution_breakpoint');
  const waitingForRouteCount = tasks.filter(task =>
    task.status === 'scaffold_ready_waiting_for_execution_hit' ||
    task.status === 'scaffold_ready_waiting_for_read_range_hit').length;
  const candidateIncompleteCount = tasks.filter(task =>
    task.status === 'reachability_hit_candidate_incomplete_needs_callback_values').length;
  const unboundReadRangeRecords = bindingRecords.filter(item => item.unbound === true);
  const unboundReadRangeHitRecords = unboundReadRangeRecords.filter(item => item.readRangeHitObserved === true);
  const directReadHookDecision = directReadDecision?.summary?.decision || null;
  const directReadHookDeferred = directReadHookDecision === 'defer_direct_read_hook_contract_keep_cf64_index_gate_authoritative';
  return {
    regionId: record.regionId,
    status: directReadHookDeferred
      ? 'callback_plan_unbound_read_range_deferred_waiting_for_execution_hooks'
      : unboundReadRangeHitRecords.length > 0
      ? 'callback_plan_has_unbound_read_range_hit_needs_hook_decision'
      : candidateIncompleteCount > 0
      ? 'callback_plan_has_reachability_candidate_gaps'
      : waitingForRouteCount > 0
        ? 'callback_plan_waiting_for_route_hits'
        : 'callback_plan_waiting_for_clean_callback_fields',
    sourceStatus: record.status,
    readRangeHitObserved: record.readRangeHitObserved === true,
    captureAdapterScaffoldReady: record.captureAdapterScaffoldReady === true,
    tracePlanId: record.tracePlanId,
    targetOffsets: record.targetOffsets || [],
    requiredRuntimeHookIds: record.requiredRuntimeHookIds || [],
    taskCount: tasks.length,
    callbackTaskCount: callbackTasks.length,
    derivationTaskCount: derivationTasks.length,
    executionTaskCount: executionTasks.length,
    readRangeTaskCount: readRangeTasks.length,
    requiredFieldCount: tasks.reduce((sum, task) => sum + task.requiredFieldCount, 0),
    remainingRequiredFieldCount: tasks.reduce((sum, task) => sum + task.remainingRequiredFieldCount, 0),
    remainingCallbackFieldCount: tasks.reduce((sum, task) => sum + task.remainingCallbackFieldCount, 0),
    remainingDerivationFieldCount: tasks.reduce((sum, task) => sum + task.remainingDerivationFieldCount, 0),
    candidateFilledFieldCount: tasks.reduce((sum, task) => sum + task.candidateFilledFields.length, 0),
    candidateIncompleteTaskCount: candidateIncompleteCount,
    waitingForRouteTaskCount: waitingForRouteCount,
    unboundReadRangeOperationCount: unboundReadRangeRecords.length,
    unboundReadRangeHitObserved: unboundReadRangeHitRecords.length > 0,
    unboundReadRangeOperationIds: unboundReadRangeRecords.map(item => item.operationId),
    readRangeHookBindingStatuses: uniqueSorted(bindingRecords.map(item => item.status)),
    directReadHookDecision,
    directReadHookDeferred,
    reportPaths: uniqueSorted(tasks.flatMap(task => task.reportPaths || [])),
    operationIds: uniqueSorted(tasks.flatMap(task => task.operationIds || [])),
    tasks,
    closureReady: false,
    semanticPromotionReady: false,
    evidence: [
      `${cleanHookGapCatalogId} lists this region's missing clean-hook fields and setup operations.`,
      `${observationCandidateCatalogId} is used only as an incomplete metadata checklist where sanitized read-range reachability exists.`,
      bindingRecords.length ? `${readRangeHookBindingCatalogId} classifies read-range operations as bound or unbound before closure use.` : null,
      directReadDecision ? `${r2813DirectReadHookDecisionCatalogId} records the reviewed r2813 direct-read hook decision.` : null,
      'All remaining fields must come from clean debugger callbacks or same-frame review derivation before closure proof.',
    ].filter(Boolean),
  };
}

function buildCatalog(mapData) {
  const cleanGapCatalog = requireCatalog(mapData, cleanHookGapCatalogId);
  const candidateCatalog = requireCatalog(mapData, observationCandidateCatalogId);
  const readRangeBindingCatalog = findCatalog(mapData, readRangeHookBindingCatalogId);
  const directReadDecisionCatalog = findCatalog(mapData, r2813DirectReadHookDecisionCatalogId);
  const candidateIndex = candidatesByRegion(candidateCatalog);
  const bindingIndex = bindingRecordsByRegion(readRangeBindingCatalog);
  const directReadDecisionIndex = directReadHookDecisionByRegion(directReadDecisionCatalog);
  const records = (cleanGapCatalog.records || []).map(record =>
    buildRegionPlan(
      record,
      candidateIndex.get(record.regionId),
      bindingIndex.get(record.regionId) || [],
      directReadDecisionIndex.get(record.regionId) || null
    ));
  const tasks = records.flatMap(record => record.tasks || []);
  const callbackTasks = tasks.filter(task => task.operationKind !== 'same_frame_derivation');
  const derivationTasks = tasks.filter(task => task.operationKind === 'same_frame_derivation');
  const statusCounts = {};
  const remainingFieldCountByHook = {};
  for (const task of tasks) {
    statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
    remainingFieldCountByHook[task.hookId] = (remainingFieldCountByHook[task.hookId] || 0) + task.remainingRequiredFieldCount;
  }
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [cleanHookGapCatalogId, observationCandidateCatalogId]
      .concat(readRangeBindingCatalog ? [readRangeHookBindingCatalogId] : [])
      .concat(directReadDecisionCatalog ? [r2813DirectReadHookDecisionCatalogId] : []),
    capturePlanOnly: true,
    eventKind: 'wb3_gearsystem_mcp_callback_capture_plan',
    assetPolicy: 'Metadata only: region ids, hook ids, field names, operation ids, labels, logical addresses, report paths, counts, booleans, and statuses. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, program counters from traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      residualRegionCount: records.length,
      planRegionCount: records.length,
      captureTaskCount: tasks.length,
      callbackTaskCount: callbackTasks.length,
      derivationTaskCount: derivationTasks.length,
      executionCallbackTaskCount: tasks.filter(task => task.operationKind === 'execution_breakpoint').length,
      readRangeCallbackTaskCount: tasks.filter(task => task.operationKind === 'read_range_breakpoint').length,
      candidateIncompleteTaskCount: tasks.filter(task => task.status === 'reachability_hit_candidate_incomplete_needs_callback_values').length,
      unboundReadRangeHitRegionCount: records.filter(record => record.unboundReadRangeHitObserved).length,
      unboundReadRangeOperationCount: records.reduce((sum, record) => sum + record.unboundReadRangeOperationCount, 0),
      directReadHookDeferredRegionCount: records.filter(record => record.directReadHookDeferred).length,
      waitingForRouteTaskCount: tasks.filter(task =>
        task.status === 'scaffold_ready_waiting_for_execution_hit' ||
        task.status === 'scaffold_ready_waiting_for_read_range_hit').length,
      remainingRequiredFieldCount: records.reduce((sum, record) => sum + record.remainingRequiredFieldCount, 0),
      remainingCallbackFieldCount: records.reduce((sum, record) => sum + record.remainingCallbackFieldCount, 0),
      remainingDerivationFieldCount: records.reduce((sum, record) => sum + record.remainingDerivationFieldCount, 0),
      candidateFilledFieldCount: records.reduce((sum, record) => sum + record.candidateFilledFieldCount, 0),
      closureReadyCount: 0,
      semanticPromotionReadyCount: 0,
      statusCounts,
      remainingFieldCountByHook,
      unboundReadRangeHitRegionIds: records.filter(record => record.unboundReadRangeHitObserved).map(record => record.regionId),
      directReadHookDeferredRegionIds: records.filter(record => record.directReadHookDeferred).map(record => record.regionId),
      regionIds: records.map(record => record.regionId),
      hookIds: uniqueSorted(tasks.map(task => task.hookId)),
      operationIds: uniqueSorted(tasks.flatMap(task => task.operationIds || [])),
      reportPaths: uniqueSorted(records.flatMap(record => record.reportPaths || [])),
      macroMonitorCallbackPlanIntegrationReady: true,
      macroMonitorCallbackPlanSmokeReady: true,
      readRangeHookBindingCatalogPresent: Boolean(readRangeBindingCatalog),
      directReadHookDecisionCatalogPresent: Boolean(directReadDecisionCatalog),
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
      refreshCleanHookGapAudit: 'node tools/world-gearsystem-mcp-clean-hook-gap-audit.mjs --apply',
      refreshObservationCandidates: 'node tools/world-gearsystem-mcp-observation-candidate-audit.mjs --apply',
      runThisAudit: `node ${toolName}`,
      applyThisAudit: `node ${toolName} --apply`,
      callbackAwareMacroMonitorPlan: 'node tools/world-gearsystem-mcp-macro-monitor.mjs --route boot_start_idle_probe --out tmp/world-gearsystem-mcp-macro-monitor.callback-plan.local.json',
      callbackAwareMacroMonitorSmoke: 'node tools/world-gearsystem-mcp-macro-monitor-callback-plan-smoke.mjs',
      closurePipeline: 'node tools/world-residual-runtime-closure-pipeline-audit.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-closure-pipeline.local.json',
    },
    evidence: [
      `${cleanHookGapCatalogId} provides the current residual callback field gap list.`,
      `${observationCandidateCatalogId} provides candidate-only read-range reachability gaps and is explicitly not closure evidence.`,
      readRangeBindingCatalog
        ? `${readRangeHookBindingCatalogId} prevents unbound read-range hits from being treated as callback-ready clean hooks.`
        : `${readRangeHookBindingCatalogId} has not been applied yet; unbound read-range hook diagnostics are unavailable in this plan.`,
      directReadDecisionCatalog
        ? `${r2813DirectReadHookDecisionCatalogId} decides the r2813 unbound read-range hit remains reachability-only for this plan.`
        : `${r2813DirectReadHookDecisionCatalogId} has not been applied yet; r2813 direct-read hook decision remains open.`,
      'tools/world-gearsystem-mcp-macro-monitor.mjs loads this catalog to annotate matched breakpoint hits with remaining callback field names only.',
      'This plan records callback requirements only; it does not assert a semantic type for residual regions.',
    ],
    nextLeads: [
      'Run the callback-aware macro monitor plan or live monitor to inspect matched callback task field names before filling local observations.',
      'Add debugger callback emission for the listed execution and read-range tasks without persisting register traces or memory dumps.',
      'Use candidateIncompleteTaskCount to prioritize r2815-r2817 palette-tail callbacks, because those already have clean read-range reachability.',
      'Use waitingForRouteTaskCount to seed routes/save-states that hit r2813 execution hooks and the r0749 bank-7 sidecar watch.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const records = recordsByRegion(catalog);
  for (const [regionId, record] of records) {
    const region = (mapData.regions || []).find(candidate => candidate.id === regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'gearsystem_mcp_callback_capture_plan' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpCallbackCapturePlanAudit = {
      catalogId,
      kind: 'gearsystem_mcp_callback_capture_plan',
      status: record.status,
      capturePlanOnly: true,
      readRangeHitObserved: record.readRangeHitObserved,
      captureAdapterScaffoldReady: record.captureAdapterScaffoldReady,
      tracePlanId: record.tracePlanId,
      targetOffsets: record.targetOffsets,
      requiredRuntimeHookIds: record.requiredRuntimeHookIds,
      taskCount: record.taskCount,
      callbackTaskCount: record.callbackTaskCount,
      derivationTaskCount: record.derivationTaskCount,
      executionTaskCount: record.executionTaskCount,
      readRangeTaskCount: record.readRangeTaskCount,
      requiredFieldCount: record.requiredFieldCount,
      remainingRequiredFieldCount: record.remainingRequiredFieldCount,
      remainingCallbackFieldCount: record.remainingCallbackFieldCount,
      remainingDerivationFieldCount: record.remainingDerivationFieldCount,
      candidateFilledFieldCount: record.candidateFilledFieldCount,
      candidateIncompleteTaskCount: record.candidateIncompleteTaskCount,
      waitingForRouteTaskCount: record.waitingForRouteTaskCount,
      unboundReadRangeOperationCount: record.unboundReadRangeOperationCount,
      unboundReadRangeHitObserved: record.unboundReadRangeHitObserved,
      unboundReadRangeOperationIds: record.unboundReadRangeOperationIds,
      readRangeHookBindingStatuses: record.readRangeHookBindingStatuses,
      directReadHookDecision: record.directReadHookDecision,
      directReadHookDeferred: record.directReadHookDeferred,
      operationIds: record.operationIds,
      reportPaths: record.reportPaths,
      taskStatuses: uniqueSorted((record.tasks || []).map(task => task.status)),
      closureReady: false,
      semanticPromotionReady: false,
      summary: 'Lists the exact Gearsystem/MCP callback fields still needed before residual runtime closure or semantic promotion.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      status: record.status,
      taskCount: record.taskCount,
      remainingRequiredFieldCount: record.remainingRequiredFieldCount,
      remainingCallbackFieldCount: record.remainingCallbackFieldCount,
      remainingDerivationFieldCount: record.remainingDerivationFieldCount,
      unboundReadRangeHitObserved: record.unboundReadRangeHitObserved,
      directReadHookDeferred: record.directReadHookDeferred,
    });
  }

  mapData.gearsystemMcpCallbackCapturePlanCatalogs = (mapData.gearsystemMcpCallbackCapturePlanCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpCallbackCapturePlanCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_callback_capture_plan_audit',
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
  staticMap.summary.gearsystemMcpCallbackCapturePlanCatalog = catalogId;
  staticMap.summary.gearsystemMcpCallbackCapturePlanRegionCount = catalog.summary.planRegionCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanTaskCount = catalog.summary.captureTaskCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanCallbackTaskCount = catalog.summary.callbackTaskCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanDerivationTaskCount = catalog.summary.derivationTaskCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanRemainingRequiredFieldCount = catalog.summary.remainingRequiredFieldCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanRemainingFieldCount = catalog.summary.remainingCallbackFieldCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanRemainingCallbackFieldCount = catalog.summary.remainingCallbackFieldCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanRemainingDerivationFieldCount = catalog.summary.remainingDerivationFieldCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanCandidateIncompleteTaskCount = catalog.summary.candidateIncompleteTaskCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanUnboundReadRangeHitRegionCount = catalog.summary.unboundReadRangeHitRegionCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanUnboundReadRangeOperationCount = catalog.summary.unboundReadRangeOperationCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanUnboundReadRangeHitRegionIds = catalog.summary.unboundReadRangeHitRegionIds;
  staticMap.summary.gearsystemMcpCallbackCapturePlanReadRangeHookBindingCatalogPresent = catalog.summary.readRangeHookBindingCatalogPresent === true;
  staticMap.summary.gearsystemMcpCallbackCapturePlanDirectReadHookDeferredRegionCount = catalog.summary.directReadHookDeferredRegionCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanDirectReadHookDeferredRegionIds = catalog.summary.directReadHookDeferredRegionIds;
  staticMap.summary.gearsystemMcpCallbackCapturePlanDirectReadHookDecisionCatalogPresent = catalog.summary.directReadHookDecisionCatalogPresent === true;
  staticMap.summary.gearsystemMcpCallbackCapturePlanWaitingForRouteTaskCount = catalog.summary.waitingForRouteTaskCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanClosureReadyCount = catalog.summary.closureReadyCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanSemanticPromotionReadyCount = catalog.summary.semanticPromotionReadyCount;
  staticMap.summary.gearsystemMcpCallbackCapturePlanMacroMonitorIntegrationReady = catalog.summary.macroMonitorCallbackPlanIntegrationReady;
  staticMap.summary.gearsystemMcpCallbackCapturePlanMacroMonitorSmokeReady = catalog.summary.macroMonitorCallbackPlanSmokeReady;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`gearsystemMcpCallbackCapturePlan${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-callback-capture-plan-catalog-2026-06-26 to implement debugger callbacks for residual runtime proof without storing protected runtime payloads.';
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
