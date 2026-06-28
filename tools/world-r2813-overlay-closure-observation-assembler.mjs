#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  collectForbiddenTracePayloadKeys,
  normalizeResidualRuntimeTraceEvents,
  normalizeResidualTraceOffset,
} from '../shared/wb3/residual-runtime-trace-events.js';
import { buildResidualRuntimeTraceObservationAudit } from './world-residual-runtime-trace-observation-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const defaultInputPath = path.join(repoRoot, 'tmp/local-hook-observations.r2813-overlay.raw.local.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-r2813-overlay-closure-observation-assembler.local.json');
const defaultObservationsPath = path.join(repoRoot, 'tmp/local-hook-observations.r2813-overlay.local.json');

const targetRegionId = 'r2813';
const targetOffset = '0x10718';
const targetIndex = 227;
const schemaVersion = 1;
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-r2813-overlay-closure-observation-assembler.mjs';
const catalogId = 'world-r2813-overlay-closure-observation-assembler-catalog-2026-06-26';
const reportId = 'r2813-overlay-closure-observation-assembler-2026-06-26';
const callbackPlanCatalogId = 'world-gearsystem-mcp-callback-capture-plan-catalog-2026-06-26';
const readRangeHookBindingCatalogId = 'world-gearsystem-mcp-read-range-hook-binding-catalog-2026-06-26';
const directReadDecisionCatalogId = 'world-r2813-direct-read-hook-decision-catalog-2026-06-26';
const eventContractCatalogId = 'world-residual-runtime-trace-event-contract-catalog-2026-06-26';

const requiredHookIds = [
  'residual_overlay_cf64_index_read',
  'residual_room_overlay_loader_entry',
  'residual_runtime_promotion_gate',
];
const callbackHookIds = requiredHookIds.filter(id => id !== 'residual_runtime_promotion_gate');

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
  'persistedHashCount',
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

function readJsonMaybe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { exists: false, path: filePath, value: null };
  }
  return { exists: true, path: filePath, value: readJson(filePath) };
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
  return filePath ? path.relative(repoRoot, filePath) : null;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value !== null && value !== undefined && value !== ''))].sort();
}

function countBy(values) {
  const counts = {};
  for (const value of values || []) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function primaryBlocker(reasons) {
  const priority = [
    'callback_plan_waiting_for_execution_hits',
    'missing_same_frame_required_hook',
    'cf64_index_read_did_not_select_target_tail',
    'room_overlay_loader_entry_did_not_load_target_tail',
    'unbound_read_range_reachability_only_cf64_gate_authoritative',
    'callback_capture_fields_remaining',
  ];
  return priority.find(reason => (reasons || []).includes(reason)) || reasons?.[0] || 'no_complete_observation_group';
}

function forbiddenCounters() {
  return Object.fromEntries(forbiddenCounterNames.map(name => [name, 0]));
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData || {})) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function regionById(mapData, regionId) {
  return (mapData.regions || []).find(region => region.id === regionId) || null;
}

function recordsByRegion(catalog) {
  return new Map((catalog?.records || []).map(record => [record.regionId, record]));
}

function observationsFromInput(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  if (Array.isArray(input.observations)) return input.observations;
  if (Array.isArray(input.events)) return input.events;
  if (Array.isArray(input.hooks)) return input.hooks;
  return [];
}

function numberFromHexLike(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const match = text.match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? Number.parseInt(match[1], 16) : Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeOffset(value) {
  return normalizeResidualTraceOffset(value);
}

function traceId(event) {
  return event?.same_frame_trace_id || event?.sameFrameTraceId || event?.traceId || event?.frameTraceId || '';
}

function byTraceId(events) {
  const groups = new Map();
  for (const event of events || []) {
    const id = traceId(event);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(event);
  }
  return groups;
}

function firstByHook(events, hookId) {
  return (events || []).find(event => event.hookId === hookId || event.hook_id === hookId) || null;
}

function sourceDescriptor(source) {
  return {
    exists: source.exists,
    path: relative(source.path),
    eventKind: source.value?.eventKind || null,
    candidateOnly: source.value?.candidateOnly === true,
    observationCount: observationsFromInput(source.value).length,
    forbiddenPayloadKeyCount: collectForbiddenTracePayloadKeys(observationsFromInput(source.value)).length,
  };
}

function normalizeInputObservations(inputSource) {
  const rawObservations = observationsFromInput(inputSource.value);
  const forbiddenPayloadKeys = collectForbiddenTracePayloadKeys(rawObservations);
  if (forbiddenPayloadKeys.length) {
    return {
      rawObservations,
      forbiddenPayloadKeys,
      normalizedEvents: [],
      droppedFields: [],
      validationIssues: [],
      summary: {
        rawEventCount: rawObservations.length,
        normalizedEventCount: 0,
        traceGroupCount: 0,
        forbiddenPayloadKeyCount: forbiddenPayloadKeys.length,
      },
    };
  }
  const normalized = normalizeResidualRuntimeTraceEvents(rawObservations, {
    knownHookIds: callbackHookIds,
  });
  return {
    rawObservations,
    forbiddenPayloadKeys,
    normalizedEvents: normalized.events,
    droppedFields: normalized.droppedFields,
    validationIssues: normalized.validationIssues,
    summary: normalized.summary,
  };
}

function missingFieldReasons(prefix, event, fields) {
  const reasons = [];
  for (const field of fields) {
    if (event?.[field] === undefined || event?.[field] === null || event?.[field] === '') {
      reasons.push(`${prefix}_${field}_missing`);
    }
  }
  return reasons;
}

function hookCompleteness(events) {
  const indexRead = firstByHook(events, 'residual_overlay_cf64_index_read');
  const loaderEntry = firstByHook(events, 'residual_room_overlay_loader_entry');
  const missingHooks = [];
  if (!indexRead) missingHooks.push('residual_overlay_cf64_index_read');
  if (!loaderEntry) missingHooks.push('residual_room_overlay_loader_entry');
  return { indexRead, loaderEntry, missingHooks };
}

function bankMismatchReasons(indexRead, loaderEntry) {
  const banks = [indexRead?.active_bank, loaderEntry?.active_bank]
    .filter(value => value !== undefined && value !== null && value !== '')
    .map(numberFromHexLike)
    .filter(value => value !== null);
  if (banks.length > 1 && new Set(banks).size > 1) {
    return ['same_frame_active_bank_mismatch'];
  }
  return [];
}

function selectorMatchesTarget(indexRead) {
  return Number(indexRead?.overlay_record_index) === targetIndex ||
    normalizeOffset(indexRead?.computed_record_offset) === normalizeOffset(targetOffset);
}

function loaderMatchesTarget(loaderEntry) {
  return loaderEntry?.loader_source_region_id === targetRegionId ||
    normalizeOffset(loaderEntry?.loader_source_offset) === normalizeOffset(targetOffset);
}

function groupRecord(traceGroupId, events) {
  const { indexRead, loaderEntry, missingHooks } = hookCompleteness(events);
  const blockedReasons = [];
  if (missingHooks.length) blockedReasons.push('missing_same_frame_required_hook');
  blockedReasons.push(...missingHooks.map(hookId => `missing_${hookId}`));
  blockedReasons.push(...missingFieldReasons('cf64_index_read', indexRead, [
    'active_bank',
    '_RAM_CF64_',
    'overlay_record_index',
    'computed_record_offset',
    'same_frame_trace_id',
  ]));
  blockedReasons.push(...missingFieldReasons('room_overlay_loader_entry', loaderEntry, [
    'active_bank',
    'loader_source_region_id',
    'loader_source_offset',
    'same_frame_trace_id',
  ]));
  blockedReasons.push(...bankMismatchReasons(indexRead, loaderEntry));

  const selectorTarget = Boolean(indexRead && selectorMatchesTarget(indexRead));
  const loaderTarget = Boolean(loaderEntry && loaderMatchesTarget(loaderEntry));
  if (!missingHooks.length && blockedReasons.length === 0) {
    if (!selectorTarget) blockedReasons.push('cf64_index_read_did_not_select_target_tail');
    if (!loaderTarget) blockedReasons.push('room_overlay_loader_entry_did_not_load_target_tail');
  }

  const completeObservationGroupReady = blockedReasons.length === 0 && selectorTarget && loaderTarget;
  const observations = completeObservationGroupReady ? [
    {
      hookId: 'residual_overlay_cf64_index_read',
      same_frame_trace_id: traceGroupId,
      active_bank: numberFromHexLike(indexRead.active_bank),
      _RAM_CF64_: numberFromHexLike(indexRead._RAM_CF64_),
      overlay_record_index: Number(indexRead.overlay_record_index),
      computed_record_offset: normalizeOffset(indexRead.computed_record_offset),
      computed_record_end_exclusive: indexRead.computed_record_end_exclusive ? normalizeOffset(indexRead.computed_record_end_exclusive) : undefined,
      _RAM_D0DE_: indexRead._RAM_D0DE_ === undefined ? undefined : numberFromHexLike(indexRead._RAM_D0DE_),
    },
    {
      hookId: 'residual_room_overlay_loader_entry',
      same_frame_trace_id: traceGroupId,
      active_bank: numberFromHexLike(loaderEntry.active_bank),
      _RAM_CF5E_: loaderEntry._RAM_CF5E_ === undefined ? undefined : numberFromHexLike(loaderEntry._RAM_CF5E_),
      _RAM_D0FE_: loaderEntry._RAM_D0FE_ === undefined ? undefined : numberFromHexLike(loaderEntry._RAM_D0FE_),
      loader_source_region_id: loaderEntry.loader_source_region_id,
      loader_source_offset: normalizeOffset(loaderEntry.loader_source_offset),
    },
    {
      hookId: 'residual_runtime_promotion_gate',
      same_frame_trace_id: traceGroupId,
      target_region_id: targetRegionId,
      target_offset: targetOffset,
      runtime_trace_kind: 'runtime_ram_index_bound_trace',
      direct_consumer_confirmed: true,
      field_or_alias_only_rejected: false,
      promotion_ready: true,
    },
  ].map(event => Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined && value !== null))) : [];

  return {
    traceId: traceGroupId,
    status: completeObservationGroupReady
      ? 'closure_observation_group_ready_for_direct_consumer_review'
      : `blocked_${uniqueSorted(blockedReasons)[0] || 'missing_same_frame_required_hook'}`,
    completeObservationGroupReady,
    blockedReasons: uniqueSorted(blockedReasons),
    presentHookIds: uniqueSorted(events.map(event => event.hookId)),
    missingHookIds: missingHooks,
    selectorTarget,
    loaderTarget,
    observations,
  };
}

function emptyGroupRecord(blockedReasons) {
  return {
    traceId: null,
    status: `blocked_${blockedReasons[0] || 'missing_observation_input'}`,
    completeObservationGroupReady: false,
    blockedReasons: uniqueSorted(blockedReasons),
    presentHookIds: [],
    missingHookIds: callbackHookIds,
    selectorTarget: false,
    loaderTarget: false,
    observations: [],
  };
}

function operationIds(callbackRecord) {
  return uniqueSorted(callbackRecord?.operationIds || [
    'exec-11fc-residual_overlay_cf64_index_read-cf64_index_read_instruction',
    'exec-120b-residual_overlay_cf64_index_read-d0de_computed_overlay_pointer_store',
    'exec-26f4-residual_room_overlay_loader_entry-hook_entry',
  ]);
}

function buildObservationInput(catalog, observationsPath) {
  const observations = catalog.records.flatMap(record => record.observations || []);
  const complete = catalog.summary.completeObservationGroupCount > 0;
  return {
    schemaVersion: 1,
    eventKind: complete
      ? 'wb3_r2813_overlay_closure_runtime_observations'
      : 'wb3_gearsystem_mcp_observation_candidates',
    candidateOnly: !complete,
    generatedBy: toolName,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceReports: catalog.sourceReports,
    observations,
    assetPolicy: 'Metadata-only r2813 overlay observations: hook ids, trace ids, region ids, offsets, bank numbers, scalar RAM values explicitly allowed by the residual contract, booleans, and derived disposition fields only. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, program counters, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      completeObservationGroupCount: catalog.summary.completeObservationGroupCount,
      observationCount: observations.length,
      candidateOnly: !complete,
      observationsOutputPath: relative(observationsPath),
      ...forbiddenCounters(),
    },
  };
}

export function buildCatalog(mapData, options = {}) {
  const inputPath = resolveRepoPath(options.observationsInputPath) || defaultInputPath;
  const observationsPath = resolveRepoPath(options.observationsPath) || defaultObservationsPath;
  const inputSource = readJsonMaybe(inputPath);
  const input = normalizeInputObservations(inputSource);
  const callbackCatalog = findCatalog(mapData, callbackPlanCatalogId);
  const readRangeCatalog = findCatalog(mapData, readRangeHookBindingCatalogId);
  const directDecisionCatalog = findCatalog(mapData, directReadDecisionCatalogId);
  const eventContractCatalog = findCatalog(mapData, eventContractCatalogId);
  const callbackRecord = recordsByRegion(callbackCatalog).get(targetRegionId) || null;
  const readRangeRecord = recordsByRegion(readRangeCatalog).get(targetRegionId) || null;
  const groups = byTraceId(input.normalizedEvents);
  const groupRecords = [...groups.entries()].map(([id, events]) => groupRecord(id, events));
  const contextBlockedReasons = [];
  if (!inputSource.exists) contextBlockedReasons.push('missing_observation_input');
  if (input.forbiddenPayloadKeys.length) contextBlockedReasons.push('forbidden_payload_key_present');
  if (!groups.size) contextBlockedReasons.push('missing_same_frame_required_hook');
  if (callbackRecord?.waitingForRouteTaskCount > 0) contextBlockedReasons.push('callback_plan_waiting_for_execution_hits');
  if (callbackRecord?.remainingRequiredFieldCount > 0) contextBlockedReasons.push('callback_capture_fields_remaining');
  if (readRangeRecord?.unbound === true && directDecisionCatalog?.summary?.currentGateRemainsAuthoritative === true) {
    contextBlockedReasons.push('unbound_read_range_reachability_only_cf64_gate_authoritative');
  }

  const records = groupRecords.length ? groupRecords : [emptyGroupRecord(contextBlockedReasons)];
  const completeRecords = records.filter(record => record.completeObservationGroupReady);
  const selectedRecords = completeRecords.length ? completeRecords : [];
  const selectedObservations = selectedRecords.flatMap(record => record.observations);
  const blockedReasons = completeRecords.length ? [] : contextBlockedReasons;
  const allBlockedReasons = uniqueSorted([
    ...blockedReasons,
    ...records.flatMap(record => record.blockedReasons || []),
  ]);
  const completeObservationGroupCount = completeRecords.length;
  const region = regionById(mapData, targetRegionId);
  const catalog = {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    eventKind: 'wb3_r2813_overlay_closure_observation_assembler',
    targetRegionId,
    sourceCatalogs: [
      callbackPlanCatalogId,
      readRangeHookBindingCatalogId,
      directReadDecisionCatalogId,
      eventContractCatalogId,
    ],
    sourceReports: [sourceDescriptor(inputSource)],
    assetPolicy: 'Metadata only: report paths, statuses, hook ids, trace ids, region ids, offsets, bank numbers, allowed scalar RAM values, booleans, field names, counts, and sanitized summaries. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, program counters, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      assemblerReady: true,
      targetRegionId,
      targetOffset,
      targetIndex,
      targetRegionType: region?.type || null,
      requiredRuntimeHookIds: requiredHookIds,
      callbackHookIds,
      sourceCatalogPresentCount: [
        callbackCatalog,
        readRangeCatalog,
        directDecisionCatalog,
        eventContractCatalog,
      ].filter(Boolean).length,
      sourceObservationCount: input.rawObservations.length,
      normalizedObservationCount: input.normalizedEvents.length,
      traceGroupCount: groups.size,
      completeObservationGroupCount,
      emittedObservationCount: selectedObservations.length,
      outputCandidateOnly: completeObservationGroupCount === 0,
      guardStatus: completeObservationGroupCount > 0
        ? 'closure_observation_groups_ready_for_review'
        : `blocked_${primaryBlocker(allBlockedReasons)}`,
      blockedReasons: allBlockedReasons,
      blockedReasonCounts: countBy(allBlockedReasons),
      callbackCapturePlanStatus: callbackRecord?.status || null,
      callbackWaitingForRouteTaskCount: callbackRecord?.waitingForRouteTaskCount || 0,
      callbackRemainingRequiredFieldCount: callbackRecord?.remainingRequiredFieldCount || 0,
      readRangeHookBindingStatus: readRangeRecord?.status || null,
      readRangeHitObserved: readRangeRecord?.readRangeHitObserved === true,
      readRangeUnbound: readRangeRecord?.unbound === true,
      directReadHookDecision: directDecisionCatalog?.summary?.decision || null,
      currentGateRemainsAuthoritative: directDecisionCatalog?.summary?.currentGateRemainsAuthoritative === true,
      operationIds: operationIds(callbackRecord),
      rejectsUnboundReadRangeAsProof: true,
      requiresCf64IndexTarget: true,
      requiresRoomOverlayLoaderTarget: true,
      rejectsForbiddenPayloads: true,
      rejectsIncompleteSameFrameHooks: true,
      observationsOutputPath: relative(observationsPath),
      ...forbiddenCounters(),
    },
    records: records.map(record => ({
      regionId: targetRegionId,
      regionOffset: region?.offset || targetOffset,
      regionType: region?.type || null,
      ...record,
      observations: selectedRecords.includes(record) ? record.observations : [],
      evidence: [
        `${eventContractCatalogId} defines the required r2813 hook set.`,
        `${callbackPlanCatalogId} lists the execution callback fields that must be captured before closure.`,
        `${directReadDecisionCatalogId} keeps the unbound read-range hit reachability-only and leaves this CF64 gate authoritative.`,
        'Assembler output is candidate-only until the CF64 index and room-overlay loader entry select the r2813 target in the same trace group.',
      ],
    })),
    droppedFields: input.droppedFields,
    validationIssues: input.validationIssues,
    forbiddenPayloadKeys: input.forbiddenPayloadKeys,
    evidence: [
      'r2813 remains quarantined because static room-overlay sources do not select the tail index and the apparent direct read is an unbound reachability-only hit.',
      'The accepted runtime proof path requires residual_overlay_cf64_index_read plus residual_room_overlay_loader_entry in one same-frame trace group.',
      'This assembler derives a direct-consumer promotion gate only when both execution hooks select the r2813 target; it never promotes the unbound read-range hit.',
    ],
    nextLeads: [
      'Start Gearsystem MCP and capture execution callbacks for _LABEL_11F4_+0x08/_LABEL_11F4_+0x17 and _LABEL_26F4_ with one same_frame_trace_id.',
      'Verify overlay_record_index 227 or computed_record_offset 0x10718 and loader_source_region_id r2813 or loader_source_offset 0x10718.',
      'Rerun this assembler, then feed the non-candidate observation output to the residual closure pipeline for review.',
    ],
    commands: {
      callbackAwareMacroMonitor: 'node tools/world-gearsystem-mcp-macro-monitor.mjs --execute --setup --clear-existing --reset --route boot_start_idle_probe --region r2813 --port 7777 --out tmp/world-gearsystem-mcp-macro-monitor.r2813.callback-plan.local.json',
      generateTemplate: 'node tools/world-residual-runtime-trace-local-bundle.mjs --template --region r2813 --out tmp/local-hook-observations.r2813.template.json',
      assembleClosure: `${toolName} --observations tmp/local-hook-observations.r2813-overlay.raw.local.json --out tmp/world-r2813-overlay-closure-observation-assembler.local.json --observations-out tmp/local-hook-observations.r2813-overlay.local.json`,
      validateClosureObservations: 'node tools/world-residual-runtime-trace-observation-audit.mjs --observations tmp/local-hook-observations.r2813-overlay.local.json --region r2813 --out tmp/world-residual-runtime-trace-observation-audit.r2813-overlay.local.json',
      runClosurePipeline: 'node tools/world-residual-runtime-closure-pipeline-audit.mjs --observations tmp/local-hook-observations.r2813-overlay.local.json --region r2813 --out tmp/world-residual-runtime-closure-pipeline.r2813-overlay.local.json',
    },
  };
  catalog.observationInput = buildObservationInput(catalog, observationsPath);
  catalog.observationAuditSummary = buildResidualRuntimeTraceObservationAudit(mapData, catalog.observationInput, {
    source: relative(observationsPath),
    regionIds: [targetRegionId],
  }).summary;
  return catalog;
}

function applyCatalog(mapData, catalog) {
  const region = regionById(mapData, targetRegionId);
  const missingRegions = [];
  const changedRegions = [];
  const record = catalog.records[0] || {};
  if (!region) {
    missingRegions.push({ id: targetRegionId, role: 'r2813_overlay_closure_observation_assembler_target' });
  } else {
    region.analysis = region.analysis || {};
    region.analysis.r2813OverlayClosureObservationAssemblerAudit = {
      catalogId,
      kind: 'r2813_overlay_closure_observation_assembler',
      status: catalog.summary.guardStatus || record.status,
      completeObservationGroupReady: catalog.summary.completeObservationGroupCount > 0,
      outputCandidateOnly: catalog.summary.outputCandidateOnly,
      blockedReasons: catalog.summary.blockedReasons,
      callbackCapturePlanStatus: catalog.summary.callbackCapturePlanStatus,
      callbackWaitingForRouteTaskCount: catalog.summary.callbackWaitingForRouteTaskCount,
      readRangeHookBindingStatus: catalog.summary.readRangeHookBindingStatus,
      readRangeHitObserved: catalog.summary.readRangeHitObserved,
      readRangeUnbound: catalog.summary.readRangeUnbound,
      directReadHookDecision: catalog.summary.directReadHookDecision,
      currentGateRemainsAuthoritative: catalog.summary.currentGateRemainsAuthoritative,
      requiredRuntimeHookIds: requiredHookIds,
      operationIds: catalog.summary.operationIds,
      observationsOutputPath: catalog.summary.observationsOutputPath,
      commands: catalog.commands,
      summary: 'Strict r2813 overlay closure assembler status; residual remains quarantined until the CF64 index path and room-overlay loader select the tail in one same-frame trace group.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      status: region.analysis.r2813OverlayClosureObservationAssemblerAudit.status,
      completeObservationGroupReady: catalog.summary.completeObservationGroupCount > 0,
      outputCandidateOnly: catalog.summary.outputCandidateOnly,
      blockedReasons: catalog.summary.blockedReasons,
      readRangeHitObserved: catalog.summary.readRangeHitObserved,
      readRangeUnbound: catalog.summary.readRangeUnbound,
    });
  }

  mapData.r2813OverlayClosureObservationAssemblerCatalogs = (mapData.r2813OverlayClosureObservationAssemblerCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.r2813OverlayClosureObservationAssemblerCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'r2813_overlay_closure_observation_assembler',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceReports: catalog.sourceReports,
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
  staticMap.summary.r2813OverlayClosureObservationAssemblerCatalog = catalogId;
  staticMap.summary.r2813OverlayClosureObservationAssemblerReady = catalog.summary.assemblerReady === true;
  staticMap.summary.r2813OverlayClosureObservationAssemblerStatus = catalog.summary.guardStatus;
  staticMap.summary.r2813OverlayClosureCompleteObservationGroupCount = catalog.summary.completeObservationGroupCount;
  staticMap.summary.r2813OverlayClosureOutputCandidateOnly = catalog.summary.outputCandidateOnly === true;
  staticMap.summary.r2813OverlayClosureReadRangeHitObserved = catalog.summary.readRangeHitObserved === true;
  staticMap.summary.r2813OverlayClosureReadRangeUnbound = catalog.summary.readRangeUnbound === true;
  staticMap.summary.r2813OverlayClosureCurrentGateRemainsAuthoritative = catalog.summary.currentGateRemainsAuthoritative === true;
  staticMap.summary.r2813OverlayClosureBlockedReasons = catalog.summary.blockedReasons;
  staticMap.summary.r2813OverlayClosureBlockedReasonCounts = catalog.summary.blockedReasonCounts;
  staticMap.summary.r2813OverlayClosureOperationIds = catalog.summary.operationIds;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`r2813OverlayClosure${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-r2813-overlay-closure-observation-assembler-catalog-2026-06-26 after CF64 overlay and room-overlay loader callbacks share one trace id.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const observationsPath = resolveRepoPath(argValue('--observations-out')) || defaultObservationsPath;
  const observationsInputPath = resolveRepoPath(argValue('--observations') || argValue('--input')) || defaultInputPath;
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, {
    observationsInputPath,
    observationsPath,
  });
  if (!noWrite) {
    writeJson(outputPath, catalog);
    writeJson(observationsPath, catalog.observationInput);
  }
  let annotation = { changedRegions: [], missingRegions: [] };
  if (apply) {
    annotation = applyCatalog(mapData, catalog);
    if (!noWrite) {
      writeJson(mapPath, mapData);
      updateStaticMap(catalog);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    applied: apply,
    output: noWrite ? null : relative(outputPath),
    observationsOutput: noWrite ? null : relative(observationsPath),
    catalogId,
    summary: catalog.summary,
    observationAuditSummary: catalog.observationAuditSummary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    assetPolicy: catalog.assetPolicy,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      ...forbiddenCounters(),
    }, null, 2));
    process.exitCode = 1;
  }
}
