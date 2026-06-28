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
const defaultOutputPath = path.join(repoRoot, 'tmp/world-r2813-direct-read-hook-decision.local.json');
const hookPlanCatalogId = 'world-residual-runtime-trace-hook-plan-catalog-2026-06-26';
const eventContractCatalogId = 'world-residual-runtime-trace-event-contract-catalog-2026-06-26';
const readRangeBindingCatalogId = 'world-gearsystem-mcp-read-range-hook-binding-catalog-2026-06-26';
const staticBoundProofCatalogId = 'world-room-overlay-tail-static-bound-proof-catalog-2026-06-26';
const indexBoundCatalogId = 'world-room-overlay-index-bound-catalog-2026-06-25';
const catalogId = 'world-r2813-direct-read-hook-decision-catalog-2026-06-26';
const reportId = 'r2813-direct-read-hook-decision-audit-2026-06-26';
const toolName = 'tools/world-r2813-direct-read-hook-decision-audit.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;
const regionId = 'r2813';
const readRangeOperationId = 'read-r2813-8718-8719';

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

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData || {})) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function regionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function forbiddenCounters() {
  return Object.fromEntries(forbiddenCounterNames.map(name => [name, 0]));
}

function hookPlanForRegion(hookPlanCatalog) {
  return (hookPlanCatalog?.tracePlans || []).find(plan => plan.region?.id === regionId || plan.regionId === regionId) || null;
}

function hookSpecIds(hookPlanCatalog) {
  return (hookPlanCatalog?.hookSpecs || hookPlanCatalog?.hooks || []).map(hook => hook.id || hook.hookId).filter(Boolean);
}

function eventContractHookIds(eventContractCatalog) {
  return (eventContractCatalog?.hooks || []).map(hook => hook.id || hook.hookId).filter(Boolean);
}

function bindingRecord(bindingCatalog) {
  return (bindingCatalog?.records || []).find(record =>
    record.regionId === regionId && record.operationId === readRangeOperationId) || null;
}

function buildCatalog(mapData) {
  const region = regionById(mapData, regionId);
  const hookPlanCatalog = findCatalog(mapData, hookPlanCatalogId);
  const eventContractCatalog = findCatalog(mapData, eventContractCatalogId);
  const bindingCatalog = findCatalog(mapData, readRangeBindingCatalogId);
  const staticBoundProofCatalog = findCatalog(mapData, staticBoundProofCatalogId);
  const indexBoundCatalog = findCatalog(mapData, indexBoundCatalogId);
  const plan = hookPlanForRegion(hookPlanCatalog);
  const binding = bindingRecord(bindingCatalog);
  const currentRequiredHooks = plan?.requiredRuntimeHookIds || [];
  const currentHookSpecIds = hookSpecIds(hookPlanCatalog);
  const contractHookIds = eventContractHookIds(eventContractCatalog);
  const directWatchHookId = 'residual_overlay_tail_direct_watch';
  const directWatchHookAlreadyExists = currentHookSpecIds.includes(directWatchHookId) || contractHookIds.includes(directWatchHookId);
  const readRangeHitObserved = binding?.readRangeHitObserved === true;
  const readRangeIsUnbound = binding?.unbound === true || binding?.hookBound === false;
  const currentGateRemainsAuthoritative = currentRequiredHooks.includes('residual_overlay_cf64_index_read') &&
    currentRequiredHooks.includes('residual_room_overlay_loader_entry') &&
    currentRequiredHooks.includes('residual_runtime_promotion_gate') &&
    !directWatchHookAlreadyExists;
  const requiredForFutureDirectHook = [
    'Define residual_overlay_tail_direct_watch in the hook plan and event contract.',
    'Bind read-r2813-8718-8719 to that hook with required same_frame_trace_id, active_bank, consumer_label, read_offset, read_region_id, and access_role fields.',
    'Extend review-gate coherence and evaluator logic so a direct-watch promotion gate is supported only when the same-frame hook proves a direct consumer.',
    'Capture those fields from a live callback without persisting PC, registers, ROM bytes, memory dumps, pixels, screenshots, VDP port values, audio, or instruction bytes.',
  ];
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    eventKind: 'wb3_r2813_direct_read_hook_decision_audit',
    sourceCatalogs: [
      hookPlanCatalogId,
      eventContractCatalogId,
      readRangeBindingCatalogId,
      staticBoundProofCatalogId,
      indexBoundCatalogId,
    ],
    assetPolicy: 'Metadata only: region ids, operation ids, hook ids, field names, labels, offsets, statuses, counts, booleans, and evidence summaries. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, program counters, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      regionId,
      readRangeOperationId,
      directWatchHookAlreadyExists,
      readRangeHitObserved,
      readRangeIsUnbound,
      currentGateRemainsAuthoritative,
      decision: currentGateRemainsAuthoritative && readRangeIsUnbound
        ? 'defer_direct_read_hook_contract_keep_cf64_index_gate_authoritative'
        : 'review_required_before_changing_r2813_hook_contract',
      closureReadyCount: 0,
      semanticPromotionReadyCount: 0,
      futureDirectHookRequiredStepCount: requiredForFutureDirectHook.length,
      ...forbiddenCounters(),
    },
    record: {
      region: region ? {
        id: region.id,
        offset: region.offset,
        size: region.size,
        type: region.type,
        confidence: region.confidence || null,
        name: region.name || null,
      } : null,
      currentTracePlan: plan ? {
        id: plan.id,
        classId: plan.classId,
        targetOffsets: plan.targetOffsets || [],
        requiredRuntimeHookIds: currentRequiredHooks,
      } : null,
      readRangeBinding: binding ? {
        status: binding.status,
        operationId: binding.operationId,
        hookBound: binding.hookBound,
        unbound: binding.unbound,
        readRangeHitObserved: binding.readRangeHitObserved,
        hookIds: binding.hookIds || [],
        requiredCaptureFields: binding.requiredCaptureFields || [],
        liveProbe: binding.liveProbe || null,
      } : null,
      staticProofStatus: staticBoundProofCatalog?.summary?.status || region?.analysis?.roomOverlayTailStaticBoundProofAudit?.status || null,
      indexBoundStatus: indexBoundCatalog?.summary?.status || region?.analysis?.roomOverlayIndexBoundAudit?.status || null,
      requiredForFutureDirectHook,
      rejectedShortcut: 'Do not convert the sanitized read-range hit into proof or a promotion gate without a hook contract and reviewed same-frame fields.',
    },
    evidence: [
      `${readRangeBindingCatalogId} records ${readRangeOperationId} as an unbound read-range operation with a sanitized hit.`,
      `${hookPlanCatalogId} currently requires residual_overlay_cf64_index_read, residual_room_overlay_loader_entry, and residual_runtime_promotion_gate for r2813.`,
      `${eventContractCatalogId} does not define residual_overlay_tail_direct_watch, so the current event review and evaluator cannot treat the read-range hit as a clean hook.`,
      'The static room-overlay audits keep r2813 quarantined unless runtime _RAM_CF64_ index proof or a reviewed future direct hook proves a consumer.',
    ],
    nextLeads: [
      'Keep read-r2813-8718-8719 as reachability-only until a direct-watch hook contract is deliberately added.',
      'Prioritize live callbacks for residual_overlay_cf64_index_read and residual_room_overlay_loader_entry because they are already accepted by the closure pipeline.',
      'If future emulator support can capture consumer_label and active_bank for the read range, add residual_overlay_tail_direct_watch and update review/evaluator smokes in one batch.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const region = regionById(mapData, regionId);
  if (!region) {
    missingRegions.push({ id: regionId, role: 'r2813_direct_read_hook_decision' });
  } else {
    region.analysis = region.analysis || {};
    region.analysis.r2813DirectReadHookDecisionAudit = {
      catalogId,
      kind: 'r2813_direct_read_hook_decision',
      status: catalog.summary.decision,
      readRangeOperationId,
      readRangeHitObserved: catalog.summary.readRangeHitObserved,
      readRangeIsUnbound: catalog.summary.readRangeIsUnbound,
      directWatchHookAlreadyExists: catalog.summary.directWatchHookAlreadyExists,
      currentGateRemainsAuthoritative: catalog.summary.currentGateRemainsAuthoritative,
      requiredForFutureDirectHook: catalog.record.requiredForFutureDirectHook,
      closureReady: false,
      semanticPromotionReady: false,
      summary: 'r2813 read-range hit remains reachability-only; current closure proof still requires the _RAM_CF64_ indexed overlay gate unless a future direct-watch hook contract is added.',
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      status: catalog.summary.decision,
      readRangeHitObserved: catalog.summary.readRangeHitObserved,
      readRangeIsUnbound: catalog.summary.readRangeIsUnbound,
    });
  }

  mapData.r2813DirectReadHookDecisionCatalogs = (mapData.r2813DirectReadHookDecisionCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.r2813DirectReadHookDecisionCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'r2813_direct_read_hook_decision_audit',
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
  staticMap.summary.r2813DirectReadHookDecisionCatalog = catalogId;
  staticMap.summary.r2813DirectReadHookDecision = catalog.summary.decision;
  staticMap.summary.r2813DirectReadHookReadRangeHitObserved = catalog.summary.readRangeHitObserved === true;
  staticMap.summary.r2813DirectReadHookReadRangeIsUnbound = catalog.summary.readRangeIsUnbound === true;
  staticMap.summary.r2813DirectReadHookCurrentGateRemainsAuthoritative = catalog.summary.currentGateRemainsAuthoritative === true;
  staticMap.summary.r2813DirectReadHookFutureRequiredStepCount = catalog.summary.futureDirectHookRequiredStepCount;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`r2813DirectReadHookDecision${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-r2813-direct-read-hook-decision-catalog-2026-06-26 to keep the r2813 read-range hit reachability-only until a direct-watch hook contract exists.';
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
