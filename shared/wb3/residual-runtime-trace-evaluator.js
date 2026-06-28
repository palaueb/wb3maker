'use strict';

import {
  FORBIDDEN_TRACE_PAYLOAD_KEYS,
  normalizeResidualRuntimeTraceEvents,
  normalizeResidualTraceOffset,
} from './residual-runtime-trace-events.js';

export { FORBIDDEN_TRACE_PAYLOAD_KEYS };

function eventTraceId(event) {
  return event.same_frame_trace_id || event.traceId || event.frameTraceId || '';
}

function eventHookId(event) {
  return event.hookId || event.hook_id || '';
}

function normalizeOffset(value) {
  return normalizeResidualTraceOffset(value);
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

function eventBankContextMatchesPlan(plan, event) {
  if (event.physical_rom_region_id) return event.physical_rom_region_id === plan.region?.id;
  if (event.bank_context_matches_source === true) return true;
  if (event.bank_context_matches_source === false) return false;
  const expectedBank = expectedSourceBank(plan);
  if (expectedBank === null) return false;
  const mappedBank = numberFromHexLike(event.mapped_source_bank ?? event.active_bank);
  return mappedBank !== null && mappedBank === expectedBank;
}

function eventOffsets(event) {
  return [
    event.computed_record_offset,
    event.read_offset,
    event.cursor_offset,
    event.physical_rom_offset,
    event.target_offset,
    event.targetBoundaryOffset,
  ].map(normalizeOffset).filter(Boolean);
}

function eventRegionIds(event) {
  return [
    event.target_region_id,
    event.cursor_region_id,
    event.physical_rom_region_id,
    event.read_region_id,
    event.source_region_id,
  ].filter(Boolean);
}

function groupEventsByTrace(events) {
  const groups = new Map();
  for (const event of events || []) {
    const traceId = eventTraceId(event);
    if (!traceId) continue;
    if (!groups.has(traceId)) groups.set(traceId, []);
    groups.get(traceId).push(event);
  }
  return groups;
}

function hasRequiredHooks(events, requiredHookIds) {
  const present = new Set(events.map(eventHookId));
  return (requiredHookIds || []).every(id => present.has(id));
}

function hasTargetOffset(event, targetOffsets) {
  const offsets = new Set(eventOffsets(event));
  return (targetOffsets || []).some(offset => offsets.has(normalizeOffset(offset)));
}

function hasTargetRegion(event, regionId) {
  return eventRegionIds(event).includes(regionId);
}

function eventConfirmsPlan(plan, event) {
  const hookId = eventHookId(event);
  if (event.direct_consumer_confirmed === true || event.promotion_ready === true) return hasTargetRegion(event, plan.region?.id) || hasTargetOffset(event, plan.targetOffsets);
  if (plan.region?.id === 'r2813') {
    return hookId === 'residual_overlay_cf64_index_read' &&
      (hasTargetOffset(event, plan.targetOffsets) || Number(event.overlay_record_index) === 227);
  }
  if (['r2815', 'r2816', 'r2817'].includes(plan.region?.id)) {
    return hookId === 'residual_palette_tail_cursor_watch' &&
      hasTargetRegion(event, plan.region.id) &&
      event.consumer_label !== '_LABEL_10BC_' &&
      event.access_role === 'direct_consumer' &&
      eventBankContextMatchesPlan(plan, event);
  }
  if (plan.region?.id === 'r0749') {
    return hookId === 'residual_bank7_sidecar_direct_watch' &&
      hasTargetRegion(event, plan.region.id) &&
      event.direct_bank7_consumer === true;
  }
  return false;
}

function eventRejectsAsFieldOrAlias(plan, event) {
  const hookId = eventHookId(event);
  if (event.field_or_alias_only_rejected === true) return hasTargetRegion(event, plan.region?.id) || hasTargetOffset(event, plan.targetOffsets);
  if (['r2815', 'r2816', 'r2817'].includes(plan.region?.id)) {
    return hookId === 'residual_palette_tail_cursor_watch' &&
      hasTargetRegion(event, plan.region.id) &&
      (event.consumer_label === '_LABEL_10BC_' ||
        eventBankContextMatchesPlan(plan, event) === false);
  }
  if (plan.region?.id === 'r0749') {
    return hookId === 'residual_bank7_alias_loader_call' &&
      event.source_region_id &&
      event.source_region_id !== 'r0749';
  }
  return false;
}

function evaluatePlan(plan, eventsForTraceGroups) {
  const selectedTraceIds = [];
  const rejectedTraceIds = [];
  const insufficientTraceIds = [];
  for (const [traceId, events] of eventsForTraceGroups.entries()) {
    if (!hasRequiredHooks(events, plan.requiredRuntimeHookIds || [])) {
      insufficientTraceIds.push(traceId);
      continue;
    }
    if (events.some(event => eventConfirmsPlan(plan, event))) {
      selectedTraceIds.push(traceId);
      continue;
    }
    if (events.some(event => eventRejectsAsFieldOrAlias(plan, event))) {
      rejectedTraceIds.push(traceId);
      continue;
    }
    insufficientTraceIds.push(traceId);
  }

  const runtimeTraceConfirmed = selectedTraceIds.length > 0;
  const fieldOrAliasOnlyRejected = !runtimeTraceConfirmed && rejectedTraceIds.length > 0;
  return {
    planId: plan.id,
    regionId: plan.region?.id || '',
    classId: plan.classId || '',
    targetOffsets: plan.targetOffsets || [],
    finalStatus: runtimeTraceConfirmed
      ? 'runtime_trace_confirmed'
      : fieldOrAliasOnlyRejected
        ? 'field_or_alias_only_rejected'
        : 'runtime_trace_pending_or_insufficient',
    confidence: runtimeTraceConfirmed || fieldOrAliasOnlyRejected ? 'high_for_supplied_events' : 'medium_pending_events',
    runtimeTraceConfirmed,
    promotionReady: runtimeTraceConfirmed,
    fieldOrAliasOnlyRejected,
    selectedTraceIds,
    rejectedTraceIds,
    insufficientTraceIds,
  };
}

export function evaluateResidualRuntimeTracePlans(tracePlans, events = []) {
  const normalized = normalizeResidualRuntimeTraceEvents(events, {
    knownHookIds: [...new Set((tracePlans || []).flatMap(plan => plan.requiredRuntimeHookIds || []))],
  });
  const normalizedEvents = normalized.events;
  const forbiddenPayloadKeys = normalized.forbiddenPayloadKeys;
  const groups = groupEventsByTrace(normalizedEvents);
  const evaluations = forbiddenPayloadKeys.length
    ? (tracePlans || []).map(plan => ({
      planId: plan.id,
      regionId: plan.region?.id || '',
      classId: plan.classId || '',
      targetOffsets: plan.targetOffsets || [],
      finalStatus: 'runtime_trace_rejected_for_forbidden_payload',
      confidence: 'high_policy_rejection',
      runtimeTraceConfirmed: false,
      promotionReady: false,
      fieldOrAliasOnlyRejected: false,
      selectedTraceIds: [],
      rejectedTraceIds: [],
      insufficientTraceIds: [...groups.keys()],
    }))
    : (tracePlans || []).map(plan => evaluatePlan(plan, groups));
  return {
    evaluatedPlanCount: evaluations.length,
    eventCount: normalized.summary.rawEventCount,
    normalizedEventCount: normalized.summary.normalizedEventCount,
    traceGroupCount: groups.size,
    forbiddenPayloadKeys,
    droppedFields: normalized.droppedFields,
    validationIssues: normalized.validationIssues,
    eventNormalizationSummary: normalized.summary,
    statusCounts: evaluations.reduce((counts, item) => {
      counts[item.finalStatus] = (counts[item.finalStatus] || 0) + 1;
      return counts;
    }, {}),
    runtimeTraceConfirmedCount: evaluations.filter(item => item.runtimeTraceConfirmed).length,
    promotionReadyCount: evaluations.filter(item => item.promotionReady).length,
    fieldOrAliasOnlyRejectedCount: evaluations.filter(item => item.fieldOrAliasOnlyRejected).length,
    evaluations,
  };
}
