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
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-read-range-hook-binding.local.json');
const cleanHookGapCatalogId = 'world-gearsystem-mcp-clean-hook-gap-catalog-2026-06-26';
const callbackLiveProbeCatalogId = 'world-gearsystem-mcp-callback-live-probe-catalog-2026-06-26';
const callbackCapturePlanCatalogId = 'world-gearsystem-mcp-callback-capture-plan-catalog-2026-06-26';
const catalogId = 'world-gearsystem-mcp-read-range-hook-binding-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-read-range-hook-binding-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-read-range-hook-binding-audit.mjs';
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
  return [...new Set((values || []).filter(value => value !== null && value !== undefined && value !== ''))].sort();
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData || {})) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function recordsByRegion(catalog) {
  return new Map((catalog?.records || []).map(record => [record.regionId, record]));
}

function regionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function forbiddenCounters() {
  return Object.fromEntries(forbiddenCounterNames.map(name => [name, 0]));
}

function compactOperation(operation) {
  return {
    operationId: operation.id,
    kind: operation.kind,
    regionId: operation.source?.regionId || operation.regionIds?.[0] || null,
    classId: operation.classId || null,
    traceKind: operation.traceKind || null,
    targetOffsets: operation.targetOffsets || [],
    logicalStartAddress: operation.source?.logicalStartAddress || operation.arguments?.start_address || operation.arguments?.address || null,
    logicalEndAddress: operation.source?.logicalEndAddress || operation.arguments?.end_address || operation.arguments?.address || null,
    sourceBank: operation.source?.bank || null,
    hookIds: operation.source?.hookIds || [],
    labels: operation.source?.labels || [],
    hookBreakpointRoles: operation.source?.hookBreakpointRoles || [],
    captureFields: operation.source?.captureFields || [],
    requiredCaptureFields: operation.source?.requiredCaptureFields || [],
  };
}

function liveProbeForOperation(liveRecord, operationId) {
  const matched = (liveRecord?.matchedOperationIds || []).includes(operationId);
  const hit = (liveRecord?.hits || []).find(item => (item.matchedOperationIds || []).includes(operationId)) || null;
  return {
    reportPath: liveRecord?.reportPath || null,
    byteClean: liveRecord?.byteClean === true,
    status: liveRecord?.status || null,
    matched,
    matchedReadRangeInferenceHitCount: matched ? Number(liveRecord?.matchedReadRangeInferenceHitCount || 0) : 0,
    matchedHookIds: hit?.matchedHookIds || liveRecord?.matchedHookIds || [],
    matchedRequiredCaptureFields: hit?.matchedRequiredCaptureFields || liveRecord?.matchedRequiredCaptureFields || [],
    routeIds: hit?.routeId ? [hit.routeId] : (liveRecord?.routeIds || []),
  };
}

function buildRecord(operation, liveByRegion, cleanByRegion, captureByRegion) {
  const compact = compactOperation(operation);
  const live = liveProbeForOperation(liveByRegion.get(compact.regionId), compact.operationId);
  const hookBound = compact.hookIds.length > 0 && compact.requiredCaptureFields.length > 0;
  const readRangeHitObserved = live.matched === true && live.matchedReadRangeInferenceHitCount > 0;
  const unbound = !hookBound;
  const status = hookBound
    ? readRangeHitObserved
      ? 'read_range_bound_to_clean_hook_and_reached'
      : 'read_range_bound_to_clean_hook_waiting_for_hit'
    : readRangeHitObserved
      ? 'read_range_reached_without_clean_hook_binding'
      : 'read_range_unbound_waiting_for_hook_decision';
  return {
    ...compact,
    status,
    hookBound,
    unbound,
    readRangeHitObserved,
    cleanHookGapStatus: cleanByRegion.get(compact.regionId)?.status || null,
    callbackCapturePlanStatus: captureByRegion.get(compact.regionId)?.status || null,
    liveProbe: live,
    closureReady: false,
    semanticPromotionReady: false,
    nextAction: unbound
      ? 'Review whether this read-range should remain reachability-only or be bound to a clean runtime hook before closure evidence can use it.'
      : 'Capture only the listed required fields when this read-range hook is reached; do not persist runtime payloads.',
    evidence: [
      `${setupPlanPath.replace(`${repoRoot}/`, '')} defines this read-range breakpoint operation.`,
      hookBound
        ? 'The operation is bound to at least one clean runtime hook id and required capture-field list.'
        : 'The operation has no clean runtime hook id or required capture-field list, so a read-range hit is reachability evidence only.',
      readRangeHitObserved
        ? `${live.reportPath || 'callback live probe report'} reports a sanitized read-range hit for this operation.`
        : 'No sanitized callback live-probe hit is currently recorded for this operation.',
    ],
  };
}

function buildCatalog(mapData, setupPlan) {
  const cleanHookGap = findCatalog(mapData, cleanHookGapCatalogId);
  const callbackLiveProbe = findCatalog(mapData, callbackLiveProbeCatalogId);
  const callbackCapturePlan = findCatalog(mapData, callbackCapturePlanCatalogId);
  const cleanByRegion = recordsByRegion(cleanHookGap);
  const liveByRegion = recordsByRegion(callbackLiveProbe);
  const captureByRegion = recordsByRegion(callbackCapturePlan);
  const records = (setupPlan.operations || [])
    .filter(operation => operation.kind === 'read_range_breakpoint')
    .map(operation => buildRecord(operation, liveByRegion, cleanByRegion, captureByRegion));
  const unboundRecords = records.filter(record => record.unbound);
  const unboundHitRecords = unboundRecords.filter(record => record.readRangeHitObserved);
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    eventKind: 'wb3_gearsystem_mcp_read_range_hook_binding_audit',
    sourceFiles: ['gearsystem/world-residual-mcp-setup-plan.json'],
    sourceCatalogs: [
      cleanHookGapCatalogId,
      callbackLiveProbeCatalogId,
      callbackCapturePlanCatalogId,
    ],
    assetPolicy: 'Metadata only: operation ids, hook ids, field names, labels, logical addresses, banks, region ids, report paths, statuses, counts, and booleans. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, program counters, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      readRangeOperationCount: records.length,
      boundReadRangeOperationCount: records.filter(record => record.hookBound).length,
      unboundReadRangeOperationCount: unboundRecords.length,
      readRangeHitObservedCount: records.filter(record => record.readRangeHitObserved).length,
      unboundReadRangeHitObservedCount: unboundHitRecords.length,
      unboundRegionIds: uniqueSorted(unboundRecords.map(record => record.regionId)),
      unboundHitRegionIds: uniqueSorted(unboundHitRecords.map(record => record.regionId)),
      closureReadyCount: 0,
      semanticPromotionReadyCount: 0,
      requiresHookDecisionBeforeClosureCount: unboundRecords.length,
      ...forbiddenCounters(),
    },
    records,
    evidence: [
      'Read-range operations with no hook ids are preserved as reachability probes, not clean runtime observations.',
      'A read-range hit without a hook binding cannot satisfy the residual closure pipeline because required fields and promotion-gate semantics are undefined.',
      'Bound read-range hooks are still not proof by themselves; they require reviewed same-frame metadata fields.',
    ],
    nextLeads: [
      'For r2813, decide whether read-r2813-8718-8719 should remain a reachability-only probe or become a clean direct-watch hook with explicit required fields.',
      'Keep r2813 quarantined until either the existing _RAM_CF64_ index proof fires or a reviewed direct-watch hook contract is added and captured.',
      'For bound read ranges, continue using the callback capture plan and closure pipeline.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = regionById(mapData, record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'gearsystem_mcp_read_range_hook_binding' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpReadRangeHookBindingAudit = {
      catalogId,
      kind: 'gearsystem_mcp_read_range_hook_binding',
      status: record.status,
      operationId: record.operationId,
      hookBound: record.hookBound,
      unbound: record.unbound,
      readRangeHitObserved: record.readRangeHitObserved,
      hookIds: record.hookIds,
      requiredCaptureFields: record.requiredCaptureFields,
      logicalStartAddress: record.logicalStartAddress,
      logicalEndAddress: record.logicalEndAddress,
      sourceBank: record.sourceBank,
      cleanHookGapStatus: record.cleanHookGapStatus,
      callbackCapturePlanStatus: record.callbackCapturePlanStatus,
      liveProbe: record.liveProbe,
      closureReady: false,
      semanticPromotionReady: false,
      summary: record.unbound
        ? 'Read-range operation is not bound to a clean hook; any hit is reachability-only until a hook decision is made.'
        : 'Read-range operation is bound to clean hook metadata but still requires reviewed runtime field capture.',
      evidence: record.evidence,
      nextAction: record.nextAction,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      status: record.status,
      hookBound: record.hookBound,
      readRangeHitObserved: record.readRangeHitObserved,
    });
  }

  mapData.gearsystemMcpReadRangeHookBindingCatalogs = (mapData.gearsystemMcpReadRangeHookBindingCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpReadRangeHookBindingCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_read_range_hook_binding_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceFiles: catalog.sourceFiles,
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
  staticMap.summary.gearsystemMcpReadRangeHookBindingCatalog = catalogId;
  staticMap.summary.gearsystemMcpReadRangeHookBindingOperationCount = catalog.summary.readRangeOperationCount;
  staticMap.summary.gearsystemMcpReadRangeHookBindingBoundCount = catalog.summary.boundReadRangeOperationCount;
  staticMap.summary.gearsystemMcpReadRangeHookBindingUnboundCount = catalog.summary.unboundReadRangeOperationCount;
  staticMap.summary.gearsystemMcpReadRangeHookBindingHitCount = catalog.summary.readRangeHitObservedCount;
  staticMap.summary.gearsystemMcpReadRangeHookBindingUnboundHitCount = catalog.summary.unboundReadRangeHitObservedCount;
  staticMap.summary.gearsystemMcpReadRangeHookBindingUnboundRegionIds = catalog.summary.unboundRegionIds;
  staticMap.summary.gearsystemMcpReadRangeHookBindingUnboundHitRegionIds = catalog.summary.unboundHitRegionIds;
  staticMap.summary.gearsystemMcpReadRangeHookBindingRequiresHookDecisionBeforeClosureCount = catalog.summary.requiresHookDecisionBeforeClosureCount;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`gearsystemMcpReadRangeHookBinding${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-read-range-hook-binding-catalog-2026-06-26 to keep unbound read-range hits out of closure proof until a clean hook contract exists.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const mapData = readJson(mapPath);
  const setupPlan = readJson(setupPlanPath);
  const catalog = buildCatalog(mapData, setupPlan);
  if (!noWrite) writeJson(outputPath, catalog);
  let result = { changedRegions: [], missingRegions: [] };
  if (apply) {
    result = applyCatalog(mapData, catalog);
    if (!noWrite) {
      writeJson(mapPath, mapData);
      updateStaticMap(catalog);
    }
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
