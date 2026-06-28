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
const defaultOutputPath = path.join(repoRoot, 'tmp/world-r0749-sidecar-closure-observation-assembler.local.json');
const defaultInputPath = path.join(repoRoot, 'tmp/local-hook-observations.r0749-sidecar.raw.local.json');
const defaultObservationsPath = path.join(repoRoot, 'tmp/local-hook-observations.r0749-sidecar.local.json');

const targetRegionId = 'r0749';
const targetOffset = '0x1E337';
const expectedBank = 7;
const schemaVersion = 1;
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-r0749-sidecar-closure-observation-assembler.mjs';
const catalogId = 'world-r0749-sidecar-closure-observation-assembler-catalog-2026-06-26';
const reportId = 'r0749-sidecar-closure-observation-assembler-2026-06-26';
const callbackPlanCatalogId = 'world-gearsystem-mcp-callback-capture-plan-catalog-2026-06-26';
const readRangeHookBindingCatalogId = 'world-gearsystem-mcp-read-range-hook-binding-catalog-2026-06-26';
const cleanHookGapCatalogId = 'world-gearsystem-mcp-clean-hook-gap-catalog-2026-06-26';
const eventContractCatalogId = 'world-residual-runtime-trace-event-contract-catalog-2026-06-26';

const requiredHookIds = [
  'residual_bank7_sidecar_controller_entry',
  'residual_bank7_alias_loader_call',
  'residual_bank7_sidecar_direct_watch',
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
  if (Array.isArray(input.observationInput?.observations)) return input.observationInput.observations;
  return [];
}

function normalizeOffset(value) {
  return normalizeResidualTraceOffset(value);
}

function numberFromHexLike(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const match = text.match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? Number.parseInt(match[1], 16) : Number.isFinite(Number(value)) ? Number(value) : null;
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

function compactOperationList(planRecord, bindingRecord) {
  return uniqueSorted([
    ...(planRecord?.operationIds || []),
    ...(bindingRecord?.operationId ? [bindingRecord.operationId] : []),
  ]);
}

function missingFieldReasons(prefix, event, requiredFields) {
  const reasons = [];
  for (const field of requiredFields) {
    if (event?.[field] === undefined || event?.[field] === null || event?.[field] === '') {
      reasons.push(`${prefix}_${field}_missing`);
    }
  }
  return reasons;
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

function hookCompleteness(events) {
  const controller = firstByHook(events, 'residual_bank7_sidecar_controller_entry');
  const alias = firstByHook(events, 'residual_bank7_alias_loader_call');
  const direct = firstByHook(events, 'residual_bank7_sidecar_direct_watch');
  const missingHooks = [];
  if (!controller) missingHooks.push('residual_bank7_sidecar_controller_entry');
  if (!alias) missingHooks.push('residual_bank7_alias_loader_call');
  if (!direct) missingHooks.push('residual_bank7_sidecar_direct_watch');
  return { controller, alias, direct, missingHooks };
}

function bankMismatchReasons(controller, alias, direct) {
  const banks = [controller, alias, direct]
    .map(event => event?.active_bank)
    .filter(value => value !== undefined && value !== null && value !== '');
  const numeric = banks.map(numberFromHexLike).filter(value => value !== null);
  const reasons = [];
  if (numeric.length && numeric.some(value => value !== expectedBank)) {
    reasons.push('active_bank_not_bank_7');
  }
  if (numeric.length > 1 && new Set(numeric).size > 1) {
    reasons.push('same_frame_active_bank_mismatch');
  }
  return reasons;
}

function deriveDisposition(alias, direct) {
  const directRegionMatch = direct?.read_region_id === targetRegionId;
  const directOffsetMatch = normalizeOffset(direct?.read_offset) === normalizeOffset(targetOffset);
  const directConsumer = direct?.direct_bank7_consumer === true;
  const aliasSourceRegion = alias?.source_region_id || '';
  const aliasSourceMatchesTarget = aliasSourceRegion === targetRegionId;
  const aliasLoadedTarget = normalizeOffset(alias?.loaded_hl_offset) === normalizeOffset(targetOffset);

  if (directRegionMatch && directOffsetMatch && directConsumer) {
    return {
      kind: 'direct_consumer',
      direct_consumer_confirmed: true,
      field_or_alias_only_rejected: false,
      promotion_ready: true,
      runtime_trace_kind: 'direct_bank7_consumer_trace',
    };
  }
  if (aliasSourceRegion && (!aliasSourceMatchesTarget || !aliasLoadedTarget || direct?.direct_bank7_consumer === false)) {
    return {
      kind: 'field_or_alias_only_rejection',
      direct_consumer_confirmed: false,
      field_or_alias_only_rejected: true,
      promotion_ready: false,
      runtime_trace_kind: 'direct_bank7_consumer_trace',
    };
  }
  return {
    kind: 'unsupported_runtime_disposition',
    direct_consumer_confirmed: false,
    field_or_alias_only_rejected: false,
    promotion_ready: false,
    runtime_trace_kind: 'direct_bank7_consumer_trace',
  };
}

function groupRecord(traceGroupId, events) {
  const { controller, alias, direct, missingHooks } = hookCompleteness(events);
  const blockedReasons = [];
  if (missingHooks.length) blockedReasons.push('missing_same_frame_required_hook');
  blockedReasons.push(...missingHooks.map(hookId => `missing_${hookId}`));
  blockedReasons.push(...missingFieldReasons('controller_entry', controller, [
    'active_bank',
    'controller_phase',
    'same_frame_trace_id',
  ]));
  blockedReasons.push(...missingFieldReasons('alias_loader', alias, [
    'active_bank',
    'called_loader_label',
    'loaded_hl_offset',
    'same_frame_trace_id',
    'source_region_id',
  ]));
  blockedReasons.push(...missingFieldReasons('direct_watch', direct, [
    'active_bank',
    'direct_bank7_consumer',
    'read_offset',
    'read_region_id',
    'same_frame_trace_id',
  ]));
  blockedReasons.push(...bankMismatchReasons(controller, alias, direct));

  const disposition = missingHooks.length || blockedReasons.length
    ? null
    : deriveDisposition(alias, direct);
  if (disposition?.kind === 'unsupported_runtime_disposition') {
    blockedReasons.push('unsupported_runtime_disposition');
  }

  const completeObservationGroupReady = blockedReasons.length === 0 && Boolean(disposition);
  const observations = completeObservationGroupReady ? [
    {
      hookId: 'residual_bank7_sidecar_controller_entry',
      same_frame_trace_id: traceGroupId,
      active_bank: numberFromHexLike(controller.active_bank),
      controller_phase: controller.controller_phase,
    },
    {
      hookId: 'residual_bank7_alias_loader_call',
      same_frame_trace_id: traceGroupId,
      active_bank: numberFromHexLike(alias.active_bank),
      called_loader_label: alias.called_loader_label,
      loaded_hl_label: alias.loaded_hl_label || null,
      loaded_hl_offset: normalizeOffset(alias.loaded_hl_offset),
      source_region_id: alias.source_region_id,
    },
    {
      hookId: 'residual_bank7_sidecar_direct_watch',
      same_frame_trace_id: traceGroupId,
      active_bank: numberFromHexLike(direct.active_bank),
      direct_bank7_consumer: direct.direct_bank7_consumer === true,
      read_offset: normalizeOffset(direct.read_offset),
      read_region_id: direct.read_region_id,
      consumer_label: direct.consumer_label || null,
      access_role: direct.access_role || null,
    },
    {
      hookId: 'residual_runtime_promotion_gate',
      same_frame_trace_id: traceGroupId,
      target_region_id: targetRegionId,
      target_offset: targetOffset,
      runtime_trace_kind: disposition.runtime_trace_kind,
      direct_consumer_confirmed: disposition.direct_consumer_confirmed,
      field_or_alias_only_rejected: disposition.field_or_alias_only_rejected,
      promotion_ready: disposition.promotion_ready,
    },
  ].map(event => Object.fromEntries(Object.entries(event).filter(([, value]) => value !== null && value !== undefined))) : [];

  return {
    traceId: traceGroupId,
    status: completeObservationGroupReady
      ? disposition.kind === 'direct_consumer'
        ? 'closure_observation_group_ready_for_direct_consumer_review'
        : 'closure_observation_group_ready_for_alias_rejection_review'
      : `blocked_${uniqueSorted(blockedReasons)[0] || 'missing_same_frame_required_hook'}`,
    completeObservationGroupReady,
    blockedReasons: uniqueSorted(blockedReasons),
    presentHookIds: uniqueSorted(events.map(event => event.hookId)),
    missingHookIds: missingHooks,
    disposition: disposition?.kind || null,
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
    disposition: null,
    observations: [],
  };
}

function buildObservationInput(catalog, observationsPath) {
  const observations = catalog.records.flatMap(record => record.observations || []);
  const complete = catalog.summary.completeObservationGroupCount > 0;
  return {
    schemaVersion: 1,
    eventKind: complete
      ? 'wb3_r0749_sidecar_closure_runtime_observations'
      : 'wb3_gearsystem_mcp_observation_candidates',
    candidateOnly: !complete,
    generatedBy: toolName,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceReports: catalog.sourceReports,
    observations,
    assetPolicy: 'Metadata-only r0749 sidecar observations: hook ids, trace ids, region ids, offsets, labels, bank numbers, booleans, and derived disposition fields only. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, program counters, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      completeObservationGroupCount: catalog.summary.completeObservationGroupCount,
      observationCount: observations.length,
      candidateOnly: !complete,
      observationsOutputPath: relative(observationsPath),
      ...forbiddenCounters(),
    },
  };
}

function buildCatalog(mapData, options = {}) {
  const inputPath = resolveRepoPath(options.observationsInputPath) || defaultInputPath;
  const observationsPath = resolveRepoPath(options.observationsPath) || defaultObservationsPath;
  const inputSource = readJsonMaybe(inputPath);
  const input = normalizeInputObservations(inputSource);
  const callbackPlanCatalog = findCatalog(mapData, callbackPlanCatalogId);
  const readRangeCatalog = findCatalog(mapData, readRangeHookBindingCatalogId);
  const cleanHookGapCatalog = findCatalog(mapData, cleanHookGapCatalogId);
  const eventContractCatalog = findCatalog(mapData, eventContractCatalogId);
  const callbackPlanRecord = recordsByRegion(callbackPlanCatalog).get(targetRegionId) || null;
  const readRangeRecord = recordsByRegion(readRangeCatalog).get(targetRegionId) || null;
  const cleanHookRecord = recordsByRegion(cleanHookGapCatalog).get(targetRegionId) || null;
  const groups = byTraceId(input.normalizedEvents);
  const groupRecords = [...groups.entries()].map(([id, events]) => groupRecord(id, events));
  const contextBlockedReasons = [];
  if (!inputSource.exists) contextBlockedReasons.push('missing_observation_input');
  if (input.forbiddenPayloadKeys.length) contextBlockedReasons.push('forbidden_payload_key_present');
  if (!groups.size) contextBlockedReasons.push('missing_same_frame_required_hook');
  if (readRangeRecord && readRangeRecord.readRangeHitObserved !== true) contextBlockedReasons.push('waiting_for_route_hit');
  if (callbackPlanRecord?.waitingForRouteTaskCount > 0) contextBlockedReasons.push('callback_plan_waiting_for_route_hits');
  if (cleanHookRecord?.cleanHookObservationReady !== true) contextBlockedReasons.push('clean_hook_observation_not_ready');

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
    eventKind: 'wb3_r0749_sidecar_closure_observation_assembler',
    targetRegionId,
    sourceCatalogs: [
      callbackPlanCatalogId,
      readRangeHookBindingCatalogId,
      cleanHookGapCatalogId,
      eventContractCatalogId,
    ],
    sourceReports: [sourceDescriptor(inputSource)],
    assetPolicy: 'Metadata only: report paths, statuses, hook ids, trace ids, region ids, offsets, labels, bank numbers, booleans, field names, counts, and sanitized summaries. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, program counters, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      assemblerReady: true,
      targetRegionId,
      targetOffset,
      targetRegionType: region?.type || null,
      requiredRuntimeHookIds: requiredHookIds,
      callbackHookIds,
      sourceCatalogPresentCount: [
        callbackPlanCatalog,
        readRangeCatalog,
        cleanHookGapCatalog,
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
        : `blocked_${allBlockedReasons[0] || 'no_complete_observation_group'}`,
      blockedReasons: allBlockedReasons,
      blockedReasonCounts: countBy(allBlockedReasons),
      readRangeHookBindingStatus: readRangeRecord?.status || null,
      readRangeHitObserved: readRangeRecord?.readRangeHitObserved === true,
      callbackCapturePlanStatus: callbackPlanRecord?.status || null,
      callbackCaptureWaitingForRouteTaskCount: callbackPlanRecord?.waitingForRouteTaskCount || 0,
      cleanHookGapStatus: cleanHookRecord?.status || null,
      cleanHookObservationReady: cleanHookRecord?.cleanHookObservationReady === true,
      operationIds: compactOperationList(callbackPlanRecord, readRangeRecord),
      supportsDirectConsumerClosure: true,
      supportsAliasRejectionClosure: true,
      rejectsMissingRouteHit: true,
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
        `${eventContractCatalogId} defines the required r0749 hook set.`,
        `${callbackPlanCatalogId} lists the execution/read-range fields that must be captured before closure.`,
        `${readRangeHookBindingCatalogId} shows the r0749 read range is bound to a clean hook but is still waiting for a route hit in current reports.`,
        'Assembler output is candidate-only until all required same-frame hooks are present and the derived promotion gate is coherent.',
      ],
    })),
    droppedFields: input.droppedFields,
    validationIssues: input.validationIssues,
    forbiddenPayloadKeys: input.forbiddenPayloadKeys,
    evidence: [
      'r0749 was kept as a low-confidence sidecar because static loader-shape evidence resolves to a bank alias, not a confirmed consumer.',
      'The runtime evaluator confirms r0749 only from residual_bank7_sidecar_direct_watch with read_region_id r0749 and direct_bank7_consumer true.',
      'This assembler derives the promotion gate only from same-frame callback observations and does not promote semantic type by itself.',
    ],
    nextLeads: [
      'Find or create a Gearsystem route/save-state that reaches _LABEL_1E200_ and the r0749 read range in bank 7.',
      'Capture residual_bank7_sidecar_controller_entry, residual_bank7_alias_loader_call, and residual_bank7_sidecar_direct_watch with one same_frame_trace_id.',
      'Rerun this assembler, then feed the non-candidate observation output to the residual closure pipeline for review.',
    ],
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
    missingRegions.push({ id: targetRegionId, role: 'r0749_sidecar_closure_observation_assembler_target' });
  } else {
    region.analysis = region.analysis || {};
    region.analysis.r0749SidecarClosureObservationAssemblerAudit = {
      catalogId,
      kind: 'r0749_sidecar_closure_observation_assembler',
      status: catalog.summary.guardStatus || record.status,
      completeObservationGroupReady: catalog.summary.completeObservationGroupCount > 0,
      outputCandidateOnly: catalog.summary.outputCandidateOnly,
      blockedReasons: catalog.summary.blockedReasons,
      readRangeHookBindingStatus: catalog.summary.readRangeHookBindingStatus,
      readRangeHitObserved: catalog.summary.readRangeHitObserved,
      callbackCapturePlanStatus: catalog.summary.callbackCapturePlanStatus,
      callbackCaptureWaitingForRouteTaskCount: catalog.summary.callbackCaptureWaitingForRouteTaskCount,
      cleanHookGapStatus: catalog.summary.cleanHookGapStatus,
      cleanHookObservationReady: catalog.summary.cleanHookObservationReady,
      requiredRuntimeHookIds: requiredHookIds,
      operationIds: catalog.summary.operationIds,
      observationsOutputPath: catalog.summary.observationsOutputPath,
      summary: 'Strict r0749 sidecar closure assembler status; residual remains quarantined until direct bank-7 same-frame hook observations prove or reject the candidate.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      status: region.analysis.r0749SidecarClosureObservationAssemblerAudit.status,
      completeObservationGroupReady: catalog.summary.completeObservationGroupCount > 0,
      outputCandidateOnly: catalog.summary.outputCandidateOnly,
      blockedReasons: catalog.summary.blockedReasons,
      readRangeHitObserved: catalog.summary.readRangeHitObserved,
    });
  }

  mapData.r0749SidecarClosureObservationAssemblerCatalogs = (mapData.r0749SidecarClosureObservationAssemblerCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.r0749SidecarClosureObservationAssemblerCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'r0749_sidecar_closure_observation_assembler',
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
  staticMap.summary.r0749SidecarClosureObservationAssemblerCatalog = catalogId;
  staticMap.summary.r0749SidecarClosureObservationAssemblerReady = catalog.summary.assemblerReady === true;
  staticMap.summary.r0749SidecarClosureObservationAssemblerStatus = catalog.summary.guardStatus;
  staticMap.summary.r0749SidecarClosureCompleteObservationGroupCount = catalog.summary.completeObservationGroupCount;
  staticMap.summary.r0749SidecarClosureOutputCandidateOnly = catalog.summary.outputCandidateOnly === true;
  staticMap.summary.r0749SidecarClosureReadRangeHitObserved = catalog.summary.readRangeHitObserved === true;
  staticMap.summary.r0749SidecarClosureReadRangeHookBindingStatus = catalog.summary.readRangeHookBindingStatus;
  staticMap.summary.r0749SidecarClosureCallbackCapturePlanStatus = catalog.summary.callbackCapturePlanStatus;
  staticMap.summary.r0749SidecarClosureWaitingForRouteTaskCount = catalog.summary.callbackCaptureWaitingForRouteTaskCount;
  staticMap.summary.r0749SidecarClosureBlockedReasons = catalog.summary.blockedReasons;
  staticMap.summary.r0749SidecarClosureBlockedReasonCounts = catalog.summary.blockedReasonCounts;
  staticMap.summary.r0749SidecarClosureOperationIds = catalog.summary.operationIds;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`r0749SidecarClosure${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-r0749-sidecar-closure-observation-assembler-catalog-2026-06-26 after a bank-7 route hits the sidecar read hook.';
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

export {
  buildCatalog,
};

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
