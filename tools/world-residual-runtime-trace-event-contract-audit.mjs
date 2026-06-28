#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FORBIDDEN_TRACE_PAYLOAD_KEYS,
  RESIDUAL_TRACE_EVENT_FIELDS,
} from '../shared/wb3/residual-runtime-trace-events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const hookPlanCatalogId = 'world-residual-runtime-trace-hook-plan-catalog-2026-06-26';
const fixtureCatalogId = 'world-residual-runtime-trace-fixture-catalog-2026-06-26';
const evaluatorCatalogId = 'world-residual-runtime-trace-evaluator-catalog-2026-06-26';
const confirmationCatalogId = 'world-residual-runtime-trace-confirmation-catalog-2026-06-26';
const catalogId = 'world-residual-runtime-trace-event-contract-catalog-2026-06-26';
const reportId = 'residual-runtime-trace-event-contract-audit-2026-06-26';
const toolName = 'tools/world-residual-runtime-trace-event-contract-audit.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
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

function findRegion(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function buildCatalog(mapData) {
  const hookPlan = requireCatalog(mapData, hookPlanCatalogId);
  const fixture = requireCatalog(mapData, fixtureCatalogId);
  const evaluator = requireCatalog(mapData, evaluatorCatalogId);
  const confirmation = requireCatalog(mapData, confirmationCatalogId);
  const hookSpecs = hookPlan.hookSpecs || [];
  const tracePlans = hookPlan.tracePlans || [];
  const hookIds = uniqueSorted(hookSpecs.map(hook => hook.id));
  const tracePlanRegionIds = uniqueSorted(tracePlans.map(plan => plan.region?.id));
  const hookRegionIds = uniqueSorted(hookSpecs.map(hook => hook.regionId));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [hookPlanCatalogId, fixtureCatalogId, evaluatorCatalogId, confirmationCatalogId],
    sourceModules: [
      'shared/wb3/residual-runtime-trace-events.js',
      'shared/wb3/residual-runtime-trace-evaluator.js',
    ],
    assetPolicy: 'Metadata-only residual trace event contract. It stores hook ids, field names, aliases, region ids, offsets, counts, and policy flags only. It stores no ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples.',
    summary: {
      tracePlanCount: tracePlans.length,
      hookSpecCount: hookSpecs.length,
      runtimeHookSpecCount: hookSpecs.filter(hook => hook.hookClass === 'runtime_trace_hook').length,
      promotionGateCount: hookSpecs.filter(hook => hook.hookClass === 'metadata_promotion_gate').length,
      allowedFieldCount: RESIDUAL_TRACE_EVENT_FIELDS.length,
      forbiddenPayloadKeyCount: FORBIDDEN_TRACE_PAYLOAD_KEYS.length,
      tracePlanRegionCount: tracePlanRegionIds.length,
      hookRegionCount: hookRegionIds.length,
      fixtureReadyForRuntimeHarness: Boolean(fixture.summary?.readyForRuntimeHarness),
      baselineEvaluatorDecisionCount: evaluator.summary?.evaluatedPlanCount || 0,
      baselineConfirmationDecisionCount: confirmation.summary?.decisionCount || 0,
      eventInputForms: ['raw_event_array', 'object_with_events_array', 'collector_bundle'],
      normalizesAliases: true,
      policyRejectsForbiddenPayloads: true,
      collectorEmitRejectsForbiddenPayloadSnapshots: true,
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
    eventContract: {
      allowedFields: RESIDUAL_TRACE_EVENT_FIELDS,
      forbiddenPayloadKeys: FORBIDDEN_TRACE_PAYLOAD_KEYS,
      normalizedAliases: {
        hook_id: 'hookId',
        id: 'hookId',
        traceId: 'same_frame_trace_id',
        frameTraceId: 'same_frame_trace_id',
        sameFrameTraceId: 'same_frame_trace_id',
        targetBoundaryOffset: 'target_offset',
      },
      offsetFields: [
        'computed_record_offset',
        'computed_record_end_exclusive',
        'loader_source_offset',
        'cursor_offset',
        'physical_rom_offset',
        'loaded_hl_offset',
        'read_offset',
        'target_offset',
      ],
      collectorApi: [
        'createResidualRuntimeTraceCollector(options)',
        'collector.nextTraceId()',
        'collector.emit(hookId, fields, same_frame_trace_id)',
        'collector.events()',
        'collector.bundle(extraMetadata)',
      ],
    },
    hooks: hookSpecs.map(hook => ({
      id: hook.id,
      label: hook.label,
      offset: hook.offset,
      regionId: hook.regionId || null,
      eventKind: hook.eventKind,
      hookClass: hook.hookClass,
      appliesToRegionIds: hook.appliesToRegionIds || [],
      captureFields: hook.captureFields || [],
      mcpBreakpointOffsets: hook.mcpBreakpointOffsets || [],
    })),
    tracePlans: tracePlans.map(plan => ({
      id: plan.id,
      regionId: plan.region?.id || '',
      classId: plan.classId || '',
      targetOffsets: plan.targetOffsets || [],
      requiredRuntimeHookIds: plan.requiredRuntimeHookIds || [],
      optionalRuntimeHookIds: plan.optionalRuntimeHookIds || [],
    })),
    regionParticipation: uniqueSorted([...tracePlanRegionIds, ...hookRegionIds]).map(regionId => ({
      regionId,
      tracePlanIds: tracePlans.filter(plan => plan.region?.id === regionId).map(plan => plan.id),
      hookIds: hookSpecs.filter(hook => hook.regionId === regionId).map(hook => hook.id),
    })),
    hookEventKindCounts: countBy(hookSpecs, hook => hook.eventKind),
    evidence: [
      `${hookPlanCatalogId} defines the hook ids and residual trace plans.`,
      `${fixtureCatalogId} verifies the hook fixtures are ready for runtime harness use.`,
      'shared/wb3/residual-runtime-trace-events.js implements the collector and normalizer used by future clean-emulator hook emission.',
      'shared/wb3/residual-runtime-trace-events.js rejects collector.emit() snapshots containing forbidden payload keys before storing an event.',
      'shared/wb3/residual-runtime-trace-evaluator.js consumes the normalized event bundle and rejects forbidden payload keys before promotion decisions.',
    ],
    nextLeads: [
      'Wire clean-emulator callbacks to createResidualRuntimeTraceCollector().emit() using the hook ids in this catalog.',
      'Save only collector.bundle() output as temporary local trace input; do not commit trace bundles containing user ROM-derived payload data.',
      'Feed metadata-only bundles into tools/world-residual-runtime-trace-confirmation-audit.mjs --events before mutating residual proof catalogs.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const item of catalog.regionParticipation || []) {
    const region = findRegion(mapData, item.regionId);
    if (!region) {
      missingRegions.push({ id: item.regionId, role: 'residual_runtime_trace_event_contract' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.residualRuntimeTraceEventContractAudit = {
      catalogId,
      kind: 'residual_runtime_trace_event_contract',
      confidence: catalog.summary.fixtureReadyForRuntimeHarness ? 'medium_high' : 'medium',
      tracePlanIds: item.tracePlanIds,
      hookIds: item.hookIds,
      collectorModule: 'shared/wb3/residual-runtime-trace-events.js',
      allowedFieldCount: catalog.summary.allowedFieldCount,
      forbiddenPayloadKeyCount: catalog.summary.forbiddenPayloadKeyCount,
      policyRejectsForbiddenPayloads: true,
      summary: 'Region participates in the metadata-only residual runtime trace event contract.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      tracePlanIds: item.tracePlanIds,
      hookIds: item.hookIds,
    });
  }

  mapData.runtimeTraceEventContractCatalogs = (mapData.runtimeTraceEventContractCatalogs || []).filter(item => item.id !== catalogId);
  mapData.runtimeTraceEventContractCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'residual_runtime_trace_event_contract_audit',
    generatedAt: now,
    schemaVersion: 1,
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
  staticMap.summary.residualRuntimeTraceEventContractCatalog = catalogId;
  staticMap.summary.residualRuntimeTraceEventContractHooks = catalog.summary.hookSpecCount;
  staticMap.summary.residualRuntimeTraceEventContractFields = catalog.summary.allowedFieldCount;
  staticMap.summary.residualRuntimeTraceEventContractPolicyRejectsForbidden = true;
  staticMap.summary.residualRuntimeTraceCollectorEmitRejectsForbiddenPayloadSnapshots = catalog.summary.collectorEmitRejectsForbiddenPayloadSnapshots;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use shared/wb3/residual-runtime-trace-events.js as the metadata-only event collector for residual clean-emulator hook output.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let annotation = { changedRegions: [], missingRegions: [] };
  if (apply) {
    annotation = applyCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
