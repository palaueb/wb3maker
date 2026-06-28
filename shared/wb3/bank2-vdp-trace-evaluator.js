// Metadata-only evaluator for bank-2 VDP residual trace events.
// Events must contain offsets, hook ids, roles, booleans, and trace ids only.

export const FORBIDDEN_TRACE_PAYLOAD_KEYS = [
  'romByte',
  'romBytes',
  'streamByte',
  'streamBytes',
  'opcode',
  'opcodes',
  'portValue',
  'portValues',
  'registerTrace',
  'registerValue',
  'registerValues',
  'pixel',
  'pixels',
  'tilePixels',
  'sample',
  'samples',
  'audioByte',
  'audioBytes',
];

export function normalizeOffset(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `0x${value.toString(16).toUpperCase().padStart(5, '0')}`;
  }
  const text = String(value).trim();
  const match = text.match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  if (!match) return null;
  return `0x${Number.parseInt(match[1], 16).toString(16).toUpperCase().padStart(5, '0')}`;
}

export function findForbiddenTracePayloadKeys(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  const hits = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_TRACE_PAYLOAD_KEYS.includes(key)) hits.push(childPath);
    if (child && typeof child === 'object') hits.push(...findForbiddenTracePayloadKeys(child, childPath));
  }
  return hits;
}

function eventTraceId(event) {
  return event.same_frame_trace_id || event.sameFrameTraceId || event.traceId || null;
}

function eventHookId(event) {
  return event.hookId || event.hook_id || event.id || null;
}

function groupEventsByTraceId(events) {
  const groups = new Map();
  for (const event of events || []) {
    const traceId = eventTraceId(event);
    if (!traceId) continue;
    if (!groups.has(traceId)) groups.set(traceId, []);
    groups.get(traceId).push(event);
  }
  return groups;
}

function hasHook(events, hookId) {
  return events.some(event => eventHookId(event) === hookId);
}

function selectedSegmentOffsets(events) {
  return events
    .filter(event => eventHookId(event) === 'bank2_vdp_97d9_pointer_list_reader')
    .map(event => normalizeOffset(event.selected_segment_offset || event.selectedSegmentOffset))
    .filter(Boolean);
}

function segmentEntryOffsets(events) {
  return events
    .filter(event => eventHookId(event) === 'bank2_vdp_97e6_segment_entry')
    .map(event => normalizeOffset(event.segment_entry_offset || event.segmentEntryOffset))
    .filter(Boolean);
}

function fieldOffsetsBySegment(events) {
  return events
    .filter(event => eventHookId(event) === 'bank2_vdp_9812_draw_field_step')
    .map(event => ({
      fieldOffset: normalizeOffset(event.field_offset || event.fieldOffset),
      segmentEntryOffset: normalizeOffset(event.segment_entry_offset || event.segmentEntryOffset),
      fieldRole: event.field_role || event.fieldRole || null,
      insideTargetGap: Boolean(event.field_is_inside_target_gap || event.fieldIsInsideTargetGap),
    }))
    .filter(event => event.fieldOffset);
}

function evaluatePlanInTrace(plan, traceId, events) {
  const targetOffsets = new Set((plan.targetBoundaryOffsets || []).map(normalizeOffset).filter(Boolean));
  const selected = selectedSegmentOffsets(events).filter(offset => targetOffsets.has(offset));
  const entries = segmentEntryOffsets(events).filter(offset => targetOffsets.has(offset));
  const directMatches = selected.filter(offset => entries.includes(offset));
  const fields = fieldOffsetsBySegment(events).filter(field => targetOffsets.has(field.fieldOffset));
  const fieldOnly = fields.filter(field => !targetOffsets.has(field.segmentEntryOffset));
  const hasRenderer = hasHook(events, 'bank2_vdp_978e_renderer_entry');
  const hasPointerReader = hasHook(events, 'bank2_vdp_97d9_pointer_list_reader');
  const hasSegmentEntry = hasHook(events, 'bank2_vdp_97e6_segment_entry');

  if (directMatches.length && hasRenderer && hasPointerReader && hasSegmentEntry) {
    return {
      traceId,
      status: 'runtime_selected_boundary_confirmed',
      confidence: 'high',
      selectedBoundaryOffsets: [...new Set(directMatches)].sort(),
      fieldOnlyBoundaryOffsets: [...new Set(fieldOnly.map(field => field.fieldOffset))].sort(),
      evidence: [
        'same_frame_trace_id has renderer, pointer-list reader, and matching segment-entry events.',
        'A selected_segment_offset from _LABEL_97D9_ matches a target boundary and _LABEL_97E6_ enters the same offset.',
      ],
    };
  }

  if (fieldOnly.length && hasRenderer && hasPointerReader) {
    return {
      traceId,
      status: 'runtime_field_only_boundary_rejected',
      confidence: 'medium_high',
      selectedBoundaryOffsets: [],
      fieldOnlyBoundaryOffsets: [...new Set(fieldOnly.map(field => field.fieldOffset))].sort(),
      evidence: [
        'Target boundary appears only as a _LABEL_9812_ field offset from another segment entry.',
        'No _LABEL_97D9_ selected_segment_offset plus _LABEL_97E6_ segment_entry_offset pair reaches the target boundary.',
      ],
    };
  }

  return {
    traceId,
    status: 'runtime_trace_insufficient_for_boundary',
    confidence: 'low',
    selectedBoundaryOffsets: [],
    fieldOnlyBoundaryOffsets: [...new Set(fieldOnly.map(field => field.fieldOffset))].sort(),
    missingRequiredRuntimeHooks: [
      !hasRenderer ? 'bank2_vdp_978e_renderer_entry' : null,
      !hasPointerReader ? 'bank2_vdp_97d9_pointer_list_reader' : null,
      !hasSegmentEntry ? 'bank2_vdp_97e6_segment_entry' : null,
    ].filter(Boolean),
    evidence: ['Runtime events do not yet prove selection or field-only rejection for this target boundary.'],
  };
}

export function evaluateBank2VdpTracePlans(tracePlans, events) {
  const forbiddenPayloadKeys = findForbiddenTracePayloadKeys(events);
  const groups = groupEventsByTraceId(events);
  const evaluations = [];

  for (const plan of tracePlans || []) {
    const traceEvaluations = [...groups.entries()].map(([traceId, groupedEvents]) => (
      evaluatePlanInTrace(plan, traceId, groupedEvents)
    ));
    const selected = traceEvaluations.filter(item => item.status === 'runtime_selected_boundary_confirmed');
    const fieldOnly = traceEvaluations.filter(item => item.status === 'runtime_field_only_boundary_rejected');
    const finalStatus = forbiddenPayloadKeys.length
      ? 'runtime_trace_rejected_for_forbidden_payload'
      : selected.length
        ? 'runtime_selected_boundary_confirmed'
        : fieldOnly.length
          ? 'runtime_field_only_boundary_rejected'
          : 'runtime_trace_pending_or_insufficient';
    evaluations.push({
      planId: plan.id,
      parentGapId: plan.parentGapId,
      targetBoundaryOffsets: (plan.targetBoundaryOffsets || []).map(normalizeOffset).filter(Boolean),
      finalStatus,
      confidence: selected.length ? 'high' : fieldOnly.length ? 'medium_high' : 'low',
      runtimeTraceConfirmed: selected.length > 0 && forbiddenPayloadKeys.length === 0,
      promotionReady: selected.length > 0 && forbiddenPayloadKeys.length === 0,
      fieldOnlyRejected: selected.length === 0 && fieldOnly.length > 0 && forbiddenPayloadKeys.length === 0,
      selectedTraceIds: selected.map(item => item.traceId),
      fieldOnlyTraceIds: fieldOnly.map(item => item.traceId),
      traceEvaluations,
    });
  }

  return {
    evaluatedPlanCount: evaluations.length,
    eventCount: (events || []).length,
    traceGroupCount: groups.size,
    forbiddenPayloadKeys,
    statusCounts: evaluations.reduce((counts, item) => {
      counts[item.finalStatus] = (counts[item.finalStatus] || 0) + 1;
      return counts;
    }, {}),
    runtimeTraceConfirmedCount: evaluations.filter(item => item.runtimeTraceConfirmed).length,
    promotionReadyCount: evaluations.filter(item => item.promotionReady).length,
    fieldOnlyRejectedCount: evaluations.filter(item => item.fieldOnlyRejected).length,
    evaluations,
  };
}
