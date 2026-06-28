'use strict';

import {
  RESIDUAL_TRACE_EVENT_FIELDS,
  collectForbiddenTracePayloadKeys,
  normalizeResidualTraceOffset,
} from './residual-runtime-trace-events.js';

export const REQUIRED_RESIDUAL_RUNTIME_CAPTURE_FIELD_RULES = {
  residual_overlay_cf64_index_read: {
    requiredFields: ['same_frame_trace_id', 'active_bank', '_RAM_CF64_', 'overlay_record_index', 'computed_record_offset'],
  },
  residual_room_overlay_loader_entry: {
    requiredFields: ['same_frame_trace_id', 'active_bank', 'loader_source_region_id', 'loader_source_offset'],
  },
  residual_palette_parser_entry: {
    requiredFields: ['same_frame_trace_id', 'active_bank', 'palette_script_entry_index'],
  },
  residual_palette_tail_cursor_watch: {
    requiredFields: ['same_frame_trace_id', 'active_bank', 'consumer_label', 'cursor_offset', 'cursor_region_id', 'access_role', 'inside_palette_tail_region'],
  },
  residual_bank7_sidecar_controller_entry: {
    requiredFields: ['same_frame_trace_id', 'active_bank', 'controller_phase'],
  },
  residual_bank7_alias_loader_call: {
    requiredFields: ['same_frame_trace_id', 'active_bank', 'loaded_hl_offset', 'called_loader_label', 'source_region_id'],
  },
  residual_bank7_sidecar_direct_watch: {
    requiredFields: ['same_frame_trace_id', 'active_bank', 'read_offset', 'read_region_id', 'direct_bank7_consumer'],
  },
  residual_runtime_promotion_gate: {
    requiredFields: ['same_frame_trace_id', 'target_region_id', 'runtime_trace_kind'],
    requiredTrueFieldGroups: [['direct_consumer_confirmed', 'promotion_ready', 'field_or_alias_only_rejected']],
  },
};

const allowedReviewFieldSet = new Set(RESIDUAL_TRACE_EVENT_FIELDS);
const generatedCandidateTraceIdPrefixes = [
  'mcp-physical-source-candidate-',
  'candidate-only',
];

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function normalizeRegionFilters(values) {
  return uniqueSorted((values || [])
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim())
    .filter(Boolean));
}

export function hookIdFromObservation(observation) {
  if (observation?.kind === 'promotion_gate') return 'residual_runtime_promotion_gate';
  return observation?.hookId || observation?.hook_id || observation?.id || observation?.fields?.hookId || '';
}

export function traceIdFromObservation(observation) {
  return observation?.same_frame_trace_id ||
    observation?.sameFrameTraceId ||
    observation?.traceId ||
    observation?.frameTraceId ||
    observation?.fields?.same_frame_trace_id ||
    observation?.fields?.sameFrameTraceId ||
    observation?.fields?.traceId ||
    observation?.fields?.frameTraceId ||
    '';
}

export function normalizedObservationFields(observation) {
  const fields = { ...(observation?.fields || {}) };
  if (!observation || typeof observation !== 'object') return fields;
  for (const [key, value] of Object.entries(observation)) {
    if ([
      'fields',
      'hookId',
      'hook_id',
      'id',
      'kind',
      'regionId',
      'targetRegionId',
    ].includes(key)) continue;
    fields[key] = value;
  }
  return fields;
}

export function observationFieldValue(observation, field) {
  if (field === 'hookId') return hookIdFromObservation(observation);
  if (field === 'same_frame_trace_id') return traceIdFromObservation(observation);
  if (field === 'target_region_id') {
    return observation?.target_region_id ??
      observation?.targetRegionId ??
      observation?.regionId ??
      normalizedObservationFields(observation).target_region_id;
  }
  return normalizedObservationFields(observation)[field];
}

export function isUnfilledPlaceholderValue(value) {
  return value === null || value === '';
}

export function hasFilledObservationField(observation, field) {
  const value = observationFieldValue(observation, field);
  return value !== undefined && !isUnfilledPlaceholderValue(value);
}

export function isTrueObservationField(observation, field) {
  const value = observationFieldValue(observation, field);
  return value === true || value === 'true' || value === 1;
}

export function findUnfilledPlaceholders(observations) {
  const placeholderFields = [];
  const templateTraceIds = [];
  const generatedCandidateTraceIds = [];
  observations.forEach((observation, index) => {
    const hookId = hookIdFromObservation(observation);
    const traceId = traceIdFromObservation(observation);
    if (String(traceId || '').startsWith('residual-template-')) {
      templateTraceIds.push({ index, hookId, traceId });
    }
    const candidatePrefix = generatedCandidateTraceIdPrefixes.find(prefix => String(traceId || '').startsWith(prefix));
    if (candidatePrefix) {
      generatedCandidateTraceIds.push({
        index,
        hookId,
        traceId,
        prefix: candidatePrefix,
      });
    }
    const fields = normalizedObservationFields(observation);
    for (const [field, value] of Object.entries(fields)) {
      if (!isUnfilledPlaceholderValue(value)) continue;
      placeholderFields.push({ index, hookId, traceId, field });
    }
  });
  const placeholderObservationIndexes = [...new Set(
    placeholderFields.map(item => item.index).concat(templateTraceIds.map(item => item.index))
  )].sort((a, b) => a - b);
  return {
    placeholderFields,
    templateTraceIds,
    generatedCandidateTraceIds,
    placeholderObservationIndexes,
    unresolvedPlaceholderCount: placeholderFields.length + templateTraceIds.length,
  };
}

export function validateRequiredObservationFields(observations) {
  const issues = [];
  const completeObservationIndexes = [];
  const incompleteObservationIndexes = [];
  observations.forEach((observation, index) => {
    const hookId = hookIdFromObservation(observation);
    const traceId = traceIdFromObservation(observation);
    const rules = REQUIRED_RESIDUAL_RUNTIME_CAPTURE_FIELD_RULES[hookId];
    if (!rules) return;
    const startIssueCount = issues.length;
    for (const field of rules.requiredFields || []) {
      if (!hasFilledObservationField(observation, field)) {
        issues.push({ index, hookId, traceId, kind: 'missing_required_capture_field', field });
      }
    }
    for (const fields of rules.requiredTrueFieldGroups || []) {
      if (!fields.some(field => isTrueObservationField(observation, field))) {
        issues.push({ index, hookId, traceId, kind: 'missing_required_true_capture_field_group', fields });
      }
    }
    if (issues.length === startIssueCount) completeObservationIndexes.push(index);
    else incompleteObservationIndexes.push(index);
  });
  return {
    issues,
    completeObservationIndexes,
    incompleteObservationIndexes,
    missingRequiredFieldCount: issues.filter(item => item.kind === 'missing_required_capture_field').length,
    missingRequiredTrueFieldGroupCount: issues.filter(item => item.kind === 'missing_required_true_capture_field_group').length,
  };
}

function observationRegionIds(observation) {
  return [
    observation?.regionId,
    observation?.targetRegionId,
    observation?.target_region_id,
    observation?.cursor_region_id,
    observation?.physical_rom_region_id,
    observation?.read_region_id,
    observation?.source_region_id,
    observation?.loader_source_region_id,
    observation?.fields?.target_region_id,
    observation?.fields?.cursor_region_id,
    observation?.fields?.physical_rom_region_id,
    observation?.fields?.read_region_id,
    observation?.fields?.source_region_id,
    observation?.fields?.loader_source_region_id,
  ].filter(Boolean);
}

function observationOffsets(observation) {
  return [
    observation?.target_offset,
    observation?.targetBoundaryOffset,
    observation?.cursor_offset,
    observation?.physical_rom_offset,
    observation?.read_offset,
    observation?.computed_record_offset,
    observation?.loader_source_offset,
    observation?.fields?.target_offset,
    observation?.fields?.targetBoundaryOffset,
    observation?.fields?.cursor_offset,
    observation?.fields?.physical_rom_offset,
    observation?.fields?.read_offset,
    observation?.fields?.computed_record_offset,
    observation?.fields?.loader_source_offset,
  ].map(normalizeResidualTraceOffset).filter(Boolean);
}

export function groupObservationHooks(observations) {
  const groups = new Map();
  observations.forEach((observation, index) => {
    const traceId = traceIdFromObservation(observation);
    if (!traceId) return;
    if (!groups.has(traceId)) groups.set(traceId, { traceId, observationIndexes: [], hookIds: [], regionIds: [], offsets: [] });
    const group = groups.get(traceId);
    group.observationIndexes.push(index);
    group.hookIds.push(hookIdFromObservation(observation));
    group.regionIds.push(...observationRegionIds(observation));
    group.offsets.push(...observationOffsets(observation));
  });
  return [...groups.values()].map(group => ({
    ...group,
    hookIds: [...new Set(group.hookIds.filter(Boolean))].sort(),
    regionIds: [...new Set(group.regionIds.filter(Boolean))].sort(),
    offsets: [...new Set(group.offsets.filter(Boolean))].sort(),
  }));
}

export function filterResidualRuntimeObservationsForRegions(manifest, observations, regionIds = []) {
  const sourceObservations = Array.isArray(observations) ? observations : [];
  const regionFilter = normalizeRegionFilters(regionIds);
  if (!regionFilter.length) {
    return {
      observations: sourceObservations,
      regionFilter,
      regionFilterApplied: false,
      sourceObservationCount: sourceObservations.length,
      filteredObservationCount: sourceObservations.length,
      droppedObservationCount: 0,
      selectedTraceIds: [],
      selectedTracePlanCount: manifest?.tracePlans?.length || 0,
      missingRegionIds: [],
    };
  }

  const filterSet = new Set(regionFilter);
  const selectedPlans = (manifest?.tracePlans || []).filter(plan => filterSet.has(plan.regionId));
  const missingRegionIds = regionFilter.filter(regionId => !selectedPlans.some(plan => plan.regionId === regionId));
  const targetOffsets = new Set(selectedPlans.flatMap(plan => plan.targetOffsets || []).map(normalizeResidualTraceOffset));
  const traceGroups = groupObservationHooks(sourceObservations);
  const selectedTraceIds = new Set(traceGroups
    .filter(group =>
      (group.regionIds || []).some(regionId => filterSet.has(regionId)) ||
      (group.offsets || []).some(offset => targetOffsets.has(offset)))
    .map(group => group.traceId));

  const filteredObservations = sourceObservations.filter(observation => {
    const traceId = traceIdFromObservation(observation);
    if (traceId && selectedTraceIds.has(traceId)) return true;
    if (observationRegionIds(observation).some(regionId => filterSet.has(regionId))) return true;
    return observationOffsets(observation).some(offset => targetOffsets.has(offset));
  });

  return {
      observations: filteredObservations,
    regionFilter,
    regionFilterApplied: true,
    sourceObservationCount: sourceObservations.length,
      filteredObservationCount: filteredObservations.length,
      droppedObservationCount: sourceObservations.length - filteredObservations.length,
    selectedTraceIds: [...selectedTraceIds].sort(),
    selectedTracePlanCount: selectedPlans.length,
    missingRegionIds,
  };
}

export function evaluatePlanCompleteness(plan, traceGroups) {
  const requiredHookIds = plan.requiredRuntimeHookIds || [];
  const targetOffsets = new Set((plan.targetOffsets || []).map(normalizeResidualTraceOffset));
  const candidates = traceGroups.map(group => {
    const present = new Set(group.hookIds || []);
    const missingHookIds = requiredHookIds.filter(id => !present.has(id));
    const targetMatched =
      (group.regionIds || []).includes(plan.regionId) ||
      (group.offsets || []).some(offset => targetOffsets.has(offset));
    return {
      traceId: group.traceId,
      hookIds: group.hookIds,
      regionIds: group.regionIds,
      offsets: group.offsets,
      observationIndexes: group.observationIndexes,
      complete: missingHookIds.length === 0 && targetMatched,
      targetMatched,
      missingHookIds,
    };
  });
  return {
    planId: plan.planId,
    regionId: plan.regionId,
    classId: plan.classId,
    targetOffsets: plan.targetOffsets || [],
    requiredRuntimeHookIds: requiredHookIds,
    completeTraceIds: candidates.filter(item => item.complete).map(item => item.traceId),
    bestCandidateTraceIds: candidates
      .filter(item => item.hookIds.some(id => requiredHookIds.includes(id)))
      .sort((a, b) => a.missingHookIds.length - b.missingHookIds.length)
      .slice(0, 3)
      .map(item => ({
        traceId: item.traceId,
        presentHookCount: item.hookIds.filter(id => requiredHookIds.includes(id)).length,
        targetMatched: item.targetMatched,
        missingHookIds: item.missingHookIds,
      })),
    completeObservationGroupCount: candidates.filter(item => item.complete).length,
    observationGroupStatus: candidates.some(item => item.complete)
      ? 'complete_required_hook_group_present'
      : candidates.some(item => item.hookIds.some(id => requiredHookIds.includes(id)))
        ? 'partial_required_hook_group_present'
        : 'no_required_hook_group_present',
  };
}

function observationsByTraceId(observations) {
  const groups = new Map();
  observations.forEach((observation, index) => {
    const traceId = traceIdFromObservation(observation);
    if (!traceId) return;
    if (!groups.has(traceId)) groups.set(traceId, []);
    groups.get(traceId).push({ observation, index });
  });
  return groups;
}

function observationHookIs(observation, hookId) {
  return hookIdFromObservation(observation) === hookId;
}

function observationFieldEquals(observation, field, value) {
  return observationFieldValue(observation, field) === value;
}

function observationOffsetMatchesPlan(observation, plan, fields) {
  const targetOffsets = new Set((plan.targetOffsets || []).map(normalizeResidualTraceOffset));
  return fields.some(field => targetOffsets.has(normalizeResidualTraceOffset(observationFieldValue(observation, field))));
}

function numberFromHexLike(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const match = text.match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? Number.parseInt(match[1], 16) : null;
}

function expectedSourceBank(plan) {
  const targetOffset = (plan.targetOffsets || []).map(numberFromHexLike).find(value => value !== null);
  return targetOffset === undefined ? null : Math.floor(targetOffset / 0x4000);
}

function observationBankContextMatchesPlan(observation, plan) {
  const physicalRegionId = observationFieldValue(observation, 'physical_rom_region_id');
  if (physicalRegionId) return physicalRegionId === plan.regionId;
  if (isTrueObservationField(observation, 'bank_context_matches_source')) return true;
  if (observationFieldValue(observation, 'bank_context_matches_source') === false ||
    observationFieldValue(observation, 'bank_context_matches_source') === 'false') return false;
  const expectedBank = expectedSourceBank(plan);
  if (expectedBank === null) return false;
  const mappedBank = numberFromHexLike(observationFieldValue(observation, 'mapped_source_bank') ??
    observationFieldValue(observation, 'active_bank'));
  return mappedBank !== null && mappedBank === expectedBank;
}

function supportsDirectConsumer(plan, traceEntries) {
  const observations = traceEntries.map(item => item.observation);
  if (plan.regionId === 'r2813') {
    return observations.some(observation => observationHookIs(observation, 'residual_overlay_cf64_index_read') &&
      (observationOffsetMatchesPlan(observation, plan, ['computed_record_offset']) ||
        Number(observationFieldValue(observation, 'overlay_record_index')) === 227)) ||
      observations.some(observation => observationHookIs(observation, 'residual_room_overlay_loader_entry') &&
        (observationFieldEquals(observation, 'loader_source_region_id', plan.regionId) ||
          observationOffsetMatchesPlan(observation, plan, ['loader_source_offset'])));
  }
  if (['r2815', 'r2816', 'r2817'].includes(plan.regionId)) {
    return observations.some(observation => observationHookIs(observation, 'residual_palette_tail_cursor_watch') &&
      observationFieldEquals(observation, 'cursor_region_id', plan.regionId) &&
      observationFieldEquals(observation, 'access_role', 'direct_consumer') &&
      observationBankContextMatchesPlan(observation, plan) &&
      isTrueObservationField(observation, 'inside_palette_tail_region'));
  }
  if (plan.regionId === 'r0749') {
    return observations.some(observation => observationHookIs(observation, 'residual_bank7_sidecar_direct_watch') &&
      observationFieldEquals(observation, 'read_region_id', plan.regionId) &&
      isTrueObservationField(observation, 'direct_bank7_consumer'));
  }
  return false;
}

function supportsFieldOrAliasRejection(plan, traceEntries) {
  const observations = traceEntries.map(item => item.observation);
  if (plan.regionId === 'r2813') {
    const hasOverlayOrLoader = observations.some(observation =>
      observationHookIs(observation, 'residual_overlay_cf64_index_read') ||
      observationHookIs(observation, 'residual_room_overlay_loader_entry'));
    return hasOverlayOrLoader && !supportsDirectConsumer(plan, traceEntries);
  }
  if (['r2815', 'r2816', 'r2817'].includes(plan.regionId)) {
    return observations.some(observation => observationHookIs(observation, 'residual_palette_tail_cursor_watch') &&
      observationFieldEquals(observation, 'cursor_region_id', plan.regionId) &&
      (observationFieldEquals(observation, 'consumer_label', '_LABEL_10BC_') ||
        !observationBankContextMatchesPlan(observation, plan) ||
        observationFieldValue(observation, 'access_role') !== 'direct_consumer' ||
        !isTrueObservationField(observation, 'inside_palette_tail_region')));
  }
  if (plan.regionId === 'r0749') {
    return observations.some(observation => observationHookIs(observation, 'residual_bank7_alias_loader_call') &&
      hasFilledObservationField(observation, 'source_region_id') &&
      !observationFieldEquals(observation, 'source_region_id', plan.regionId)) ||
      observations.some(observation => observationHookIs(observation, 'residual_bank7_sidecar_direct_watch') &&
        observationFieldEquals(observation, 'read_region_id', plan.regionId) &&
        !isTrueObservationField(observation, 'direct_bank7_consumer'));
  }
  return false;
}

export function validatePromotionGateCoherence(observations, manifest) {
  const issues = [];
  const planByRegionId = new Map((manifest.tracePlans || []).map(plan => [plan.regionId, plan]));
  const groups = observationsByTraceId(observations);
  const gateIndexes = [];
  const coherentGateIndexes = [];
  const incoherentGateIndexes = [];

  observations.forEach((observation, index) => {
    if (hookIdFromObservation(observation) !== 'residual_runtime_promotion_gate') return;
    gateIndexes.push(index);
    const traceId = traceIdFromObservation(observation);
    const targetRegionId = observationFieldValue(observation, 'target_region_id');
    const plan = planByRegionId.get(targetRegionId);
    const directConsumerConfirmed = isTrueObservationField(observation, 'direct_consumer_confirmed');
    const promotionReady = isTrueObservationField(observation, 'promotion_ready');
    const fieldOrAliasOnlyRejected = isTrueObservationField(observation, 'field_or_alias_only_rejected');
    const traceEntries = groups.get(traceId) || [];
    const startIssueCount = issues.length;

    if (!plan && targetRegionId) {
      issues.push({ index, hookId: 'residual_runtime_promotion_gate', traceId, targetRegionId, kind: 'unknown_target_region_promotion_gate' });
    }
    if ((directConsumerConfirmed || promotionReady) && fieldOrAliasOnlyRejected) {
      issues.push({ index, hookId: 'residual_runtime_promotion_gate', traceId, targetRegionId, kind: 'ambiguous_promotion_gate_decision' });
    }
    if (directConsumerConfirmed !== promotionReady) {
      issues.push({ index, hookId: 'residual_runtime_promotion_gate', traceId, targetRegionId, kind: 'partial_direct_consumer_promotion_gate' });
    }
    if (plan && directConsumerConfirmed && promotionReady && !supportsDirectConsumer(plan, traceEntries)) {
      issues.push({ index, hookId: 'residual_runtime_promotion_gate', traceId, targetRegionId, kind: 'unsupported_direct_consumer_promotion_gate' });
    }
    if (plan && fieldOrAliasOnlyRejected && !supportsFieldOrAliasRejection(plan, traceEntries)) {
      issues.push({ index, hookId: 'residual_runtime_promotion_gate', traceId, targetRegionId, kind: 'unsupported_field_or_alias_rejection_gate' });
    }

    if (issues.length === startIssueCount) coherentGateIndexes.push(index);
    else incoherentGateIndexes.push(index);
  });

  return {
    issues,
    gateIndexes,
    coherentGateIndexes,
    incoherentGateIndexes,
    directConsumerIssueCount: issues.filter(item => item.kind === 'unsupported_direct_consumer_promotion_gate').length,
    fieldOrAliasIssueCount: issues.filter(item => item.kind === 'unsupported_field_or_alias_rejection_gate').length,
    ambiguousDecisionIssueCount: issues.filter(item => item.kind === 'ambiguous_promotion_gate_decision').length,
    partialDecisionIssueCount: issues.filter(item => item.kind === 'partial_direct_consumer_promotion_gate').length,
  };
}

export function findUnsupportedReviewFields(observations) {
  const issues = [];
  observations.forEach((observation, index) => {
    const hookId = hookIdFromObservation(observation);
    const traceId = traceIdFromObservation(observation);
    const fields = normalizedObservationFields(observation);
    for (const field of Object.keys(fields)) {
      if (!allowedReviewFieldSet.has(field)) {
        issues.push({ index, hookId, traceId, kind: 'unsupported_review_field', field });
      }
    }
  });
  return issues;
}

export function findUnknownObservationHooks(observations, manifest) {
  const knownHookIds = new Set(manifest.knownHookIds || []);
  const issues = [];
  observations.forEach((observation, index) => {
    const hookId = hookIdFromObservation(observation);
    const traceId = traceIdFromObservation(observation);
    if (!hookId || !knownHookIds.has(hookId)) {
      issues.push({ index, hookId, traceId, kind: 'unknown_hook_id' });
    }
  });
  return issues;
}

export function buildResidualRuntimeObservationReviewGate(manifest, observations) {
  const forbiddenPayloadKeys = collectForbiddenTracePayloadKeys(observations);
  const forbiddenPayloadIssues = forbiddenPayloadKeys.map(field => ({
    kind: 'forbidden_payload_key',
    field,
  }));
  const unknownHookIssues = findUnknownObservationHooks(observations, manifest);
  const unsupportedFieldIssues = findUnsupportedReviewFields(observations);
  const placeholderAudit = findUnfilledPlaceholders(observations);
  const placeholderIssues = [
    ...placeholderAudit.templateTraceIds.map(item => ({ ...item, kind: 'template_trace_id_placeholder' })),
    ...placeholderAudit.placeholderFields.map(item => ({ ...item, kind: 'unfilled_placeholder_field' })),
  ];
  const generatedCandidateTraceIdIssues = placeholderAudit.generatedCandidateTraceIds.map(item => ({
    ...item,
    kind: 'generated_candidate_trace_id_not_runtime_evidence',
  }));
  const requiredFieldAudit = validateRequiredObservationFields(observations);
  const traceGroups = groupObservationHooks(observations);
  const planCompleteness = (manifest.tracePlans || []).map(plan => evaluatePlanCompleteness(plan, traceGroups));
  const completePlanCount = planCompleteness.filter(item => item.completeObservationGroupCount > 0).length;
  const completenessIssues = completePlanCount > 0
    ? []
    : [{ kind: 'no_complete_runtime_trace_group' }];
  const promotionGateCoherenceAudit = validatePromotionGateCoherence(observations, manifest);
  const issues = [
    ...forbiddenPayloadIssues,
    ...unknownHookIssues,
    ...unsupportedFieldIssues,
    ...placeholderIssues,
    ...generatedCandidateTraceIdIssues,
    ...requiredFieldAudit.issues,
    ...promotionGateCoherenceAudit.issues,
    ...completenessIssues,
  ];

  return {
    ok: issues.length === 0,
    issues,
    summary: {
      reviewedObservationGateReady: issues.length === 0,
      observationCount: observations.length,
      traceGroupCount: traceGroups.length,
      completePlanCount,
      forbiddenPayloadKeyCount: forbiddenPayloadKeys.length,
      unknownHookIssueCount: unknownHookIssues.length,
      unsupportedFieldIssueCount: unsupportedFieldIssues.length,
      placeholderIssueCount: placeholderIssues.length,
      generatedCandidateTraceIdIssueCount: generatedCandidateTraceIdIssues.length,
      requiredFieldIssueCount: requiredFieldAudit.issues.length,
      promotionGateCoherenceIssueCount: promotionGateCoherenceAudit.issues.length,
      completenessIssueCount: completenessIssues.length,
    },
    forbiddenPayloadKeys,
    unknownHookIssues,
    unsupportedFieldIssues,
    placeholderAudit,
    generatedCandidateTraceIdIssues,
    requiredFieldAudit,
    promotionGateCoherenceAudit,
    traceGroups,
    planCompleteness,
  };
}
