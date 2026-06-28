'use strict';

export const PLAYER_COLLISION_FORBIDDEN_TRACE_PAYLOAD_KEYS = [
  'romBytes',
  'bytes',
  'streamBytes',
  'tileBytes',
  'tileIds',
  'tileValues',
  'collisionCellValues',
  'collisionCellBytes',
  'decodedRoomBytes',
  'decodedTiles',
  'paletteBytes',
  'paletteValues',
  'pixels',
  'screenshot',
  'imageData',
  'portValues',
  'registerTrace',
  'registerTracePayloads',
  'registerValues',
  'ramSnapshot',
  'ramValues',
  'audioBytes',
  'audioSamples',
  'samples',
  'instructionBytes',
  'hashes',
];

export const PLAYER_COLLISION_TRACE_EVENT_FIELDS = [
  'hookId',
  'sourceHookId',
  'hookFixtureId',
  'same_frame_trace_id',
  'frame',
  'pc',
  'sourceFamily',
  'flowId',
  'stateSlot',
  'eventKind',
  'capturedFieldNames',
  'planFixtureIds',
  'callLine',
  'componentLabel',
  'branchClass',
  'responseCallSequenceLabels',
  'lookupCount',
  'coordinateAClass',
  'coordinateBClass',
  'returnedCellClass',
  'specialTileMatch',
  'collisionBufferProvenanceId',
  'promotionReady',
  'enginePortReady',
  'axisNamingConfirmed',
  'collisionBufferProvenanceConfirmed',
];

const allowedFieldSet = new Set(PLAYER_COLLISION_TRACE_EVENT_FIELDS);
const forbiddenFieldSet = new Set(PLAYER_COLLISION_FORBIDDEN_TRACE_PAYLOAD_KEYS);
const numberFields = new Set(['frame', 'stateSlot', 'callLine', 'lookupCount']);
const booleanFields = new Set([
  'specialTileMatch',
  'promotionReady',
  'enginePortReady',
  'axisNamingConfirmed',
  'collisionBufferProvenanceConfirmed',
]);
const arrayFields = new Set(['capturedFieldNames', 'planFixtureIds', 'responseCallSequenceLabels']);
const offsetFields = new Set(['pc']);

export function normalizePlayerCollisionTraceOffset(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `0x${value.toString(16).toUpperCase().padStart(5, '0')}`;
  }
  const text = String(value).trim();
  const match = text.match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  if (!match) return text;
  return `0x${Number.parseInt(match[1], 16).toString(16).toUpperCase().padStart(5, '0')}`;
}

export function collectForbiddenPlayerCollisionTracePayloadKeys(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(...collectForbiddenPlayerCollisionTracePayloadKeys(item, `${path}[${index}]`));
    });
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (forbiddenFieldSet.has(key)) found.push(childPath);
    found.push(...collectForbiddenPlayerCollisionTracePayloadKeys(child, childPath));
  }
  return found;
}

function normalizeKey(key) {
  if (key === 'hook_id' || key === 'id') return 'hookId';
  if (key === 'source_hook_id') return 'sourceHookId';
  if (key === 'hook_fixture_id') return 'hookFixtureId';
  if (key === 'sameFrameTraceId' || key === 'frameTraceId' || key === 'traceId') return 'same_frame_trace_id';
  if (key === 'source_family') return 'sourceFamily';
  if (key === 'flow_id') return 'flowId';
  if (key === 'state_slot') return 'stateSlot';
  if (key === 'event_kind') return 'eventKind';
  if (key === 'capturedFields' || key === 'captured_field_names') return 'capturedFieldNames';
  if (key === 'planIds' || key === 'plan_fixture_ids') return 'planFixtureIds';
  if (key === 'call_line') return 'callLine';
  if (key === 'component_label') return 'componentLabel';
  if (key === 'branch_class') return 'branchClass';
  if (key === 'response_call_sequence_labels') return 'responseCallSequenceLabels';
  if (key === 'lookup_count') return 'lookupCount';
  if (key === 'coordinate_a_class') return 'coordinateAClass';
  if (key === 'coordinate_b_class') return 'coordinateBClass';
  if (key === 'returned_cell_class') return 'returnedCellClass';
  if (key === 'special_tile_match') return 'specialTileMatch';
  if (key === 'collision_buffer_provenance_id') return 'collisionBufferProvenanceId';
  if (key === 'promotion_ready') return 'promotionReady';
  if (key === 'engine_port_ready') return 'enginePortReady';
  if (key === 'axis_naming_confirmed') return 'axisNamingConfirmed';
  if (key === 'collision_buffer_provenance_confirmed') return 'collisionBufferProvenanceConfirmed';
  return key;
}

function normalizeArray(value) {
  const items = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  return [...new Set(items.map(item => String(item)).filter(Boolean))].sort();
}

function normalizeFieldValue(key, value) {
  if (offsetFields.has(key)) return normalizePlayerCollisionTraceOffset(value);
  if (numberFields.has(key)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (booleanFields.has(key)) return value === true || value === 'true' || value === 1;
  if (arrayFields.has(key)) return normalizeArray(value);
  return value;
}

export function normalizePlayerCollisionRuntimeTraceEvent(rawEvent, index = 0, knownHookIds = null) {
  const event = {};
  const droppedFields = [];
  const validationIssues = [];
  if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
    return {
      event,
      droppedFields,
      validationIssues: [{ kind: 'invalid_event_object', index }],
    };
  }

  for (const [rawKey, value] of Object.entries(rawEvent)) {
    const key = normalizeKey(rawKey);
    if (!allowedFieldSet.has(key)) {
      if (!forbiddenFieldSet.has(rawKey)) droppedFields.push({ index, field: rawKey });
      continue;
    }
    event[key] = normalizeFieldValue(key, value);
  }

  if (!event.hookId) validationIssues.push({ kind: 'missing_hook_id', index });
  if (!event.same_frame_trace_id) validationIssues.push({ kind: 'missing_same_frame_trace_id', index, hookId: event.hookId || '' });
  if (knownHookIds && event.hookId && !knownHookIds.has(event.hookId)) {
    validationIssues.push({ kind: 'unknown_hook_id', index, hookId: event.hookId });
  }

  return { event, droppedFields, validationIssues };
}

export function normalizePlayerCollisionRuntimeTraceEvents(input, options = {}) {
  const rawEvents = Array.isArray(input) ? input : input?.events || [];
  const knownHookIds = options.knownHookIds ? new Set(options.knownHookIds) : null;
  const forbiddenPayloadKeys = collectForbiddenPlayerCollisionTracePayloadKeys(rawEvents);
  const events = [];
  const droppedFields = [];
  const validationIssues = [];

  rawEvents.forEach((rawEvent, index) => {
    const normalized = normalizePlayerCollisionRuntimeTraceEvent(rawEvent, index, knownHookIds);
    droppedFields.push(...normalized.droppedFields);
    validationIssues.push(...normalized.validationIssues);
    if (normalized.event.hookId && normalized.event.same_frame_trace_id) events.push(normalized.event);
  });

  const traceIds = new Set(events.map(event => event.same_frame_trace_id));
  return {
    events,
    forbiddenPayloadKeys,
    droppedFields,
    validationIssues,
    summary: {
      rawEventCount: rawEvents.length,
      normalizedEventCount: events.length,
      traceGroupCount: traceIds.size,
      forbiddenPayloadKeyCount: forbiddenPayloadKeys.length,
      droppedFieldCount: droppedFields.length,
      validationIssueCount: validationIssues.length,
    },
  };
}

export function createPlayerCollisionRuntimeTraceCollector(options = {}) {
  const events = [];
  let nextTraceIndex = 0;
  const tracePrefix = options.tracePrefix || 'player-collision-trace';
  const knownHookIds = options.knownHookIds || null;

  function nextTraceId() {
    nextTraceIndex += 1;
    return `${tracePrefix}-${String(nextTraceIndex).padStart(4, '0')}`;
  }

  return {
    nextTraceId,
    emit(hookId, fields = {}, sameFrameTraceId = fields.same_frame_trace_id || fields.traceId || fields.frameTraceId || nextTraceId()) {
      const raw = { ...fields, hookId, same_frame_trace_id: sameFrameTraceId };
      const forbiddenPayloadKeys = collectForbiddenPlayerCollisionTracePayloadKeys(raw);
      if (forbiddenPayloadKeys.length) {
        return {
          event: {},
          droppedFields: [],
          validationIssues: forbiddenPayloadKeys.map(field => ({
            kind: 'forbidden_payload_key',
            field,
            hookId,
          })),
          forbiddenPayloadKeys,
        };
      }
      const normalized = normalizePlayerCollisionRuntimeTraceEvent(raw, events.length, knownHookIds ? new Set(knownHookIds) : null);
      if (normalized.event.hookId && normalized.event.same_frame_trace_id) events.push(normalized.event);
      return normalized;
    },
    events() {
      return events.map(event => ({ ...event }));
    },
    bundle(extra = {}) {
      return {
        schemaVersion: 1,
        eventKind: 'wb3_player_collision_runtime_trace_events',
        assetPolicy: 'Metadata-only player collision runtime trace events. No ROM bytes, decoded room bytes, collision cell values, tile values, register traces, pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are present.',
        ...extra,
        events: events.map(event => ({ ...event })),
      };
    },
  };
}

function groupEventsByTrace(events) {
  const groups = new Map();
  for (const event of events || []) {
    const traceId = event.same_frame_trace_id || '';
    if (!traceId) continue;
    if (!groups.has(traceId)) groups.set(traceId, []);
    groups.get(traceId).push(event);
  }
  return groups;
}

function eventHookFixtureIds(event) {
  return [event.hookFixtureId].filter(Boolean);
}

function eventPlanFixtureIds(event) {
  return normalizeArray(event.planFixtureIds);
}

function traceGroupSummary(events) {
  return {
    hookIds: normalizeArray(events.map(event => event.hookId)),
    hookFixtureIds: normalizeArray(events.flatMap(eventHookFixtureIds)),
    planFixtureIds: normalizeArray(events.flatMap(eventPlanFixtureIds)),
    flowIds: normalizeArray(events.map(event => event.flowId)),
    stateSlots: normalizeArray(events.map(event => event.stateSlot).filter(value => value !== undefined).map(String)),
    eventKinds: normalizeArray(events.map(event => event.eventKind)),
  };
}

function traceGroupMatchesPlan(group, plan) {
  if ((group.planFixtureIds || []).includes(plan.id)) return true;
  if (plan.flowId && (group.flowIds || []).includes(plan.flowId)) return true;
  if (plan.stateSlot != null && (group.stateSlots || []).includes(String(plan.stateSlot))) return true;
  return false;
}

function missingIds(required, present) {
  const presentSet = new Set(present || []);
  return (required || []).filter(id => !presentSet.has(id));
}

function evaluateCollisionPlan(plan, groups) {
  const requiredRuntime = plan.runtimeHookFixtureIds || [];
  const requiredGates = plan.promotionGateFixtureIds || [];
  const candidates = [];
  for (const [traceId, events] of groups.entries()) {
    const group = traceGroupSummary(events);
    if (!traceGroupMatchesPlan(group, plan)) continue;
    const missingRuntimeHookFixtureIds = missingIds(requiredRuntime, group.hookFixtureIds);
    const missingPromotionGateFixtureIds = missingIds(requiredGates, group.hookFixtureIds);
    const gateEvents = events.filter(event => requiredGates.includes(event.hookFixtureId));
    const promotionReady = gateEvents.some(event => event.promotionReady === true);
    const enginePortReady = gateEvents.some(event => event.enginePortReady === true);
    const complete = missingRuntimeHookFixtureIds.length === 0 && missingPromotionGateFixtureIds.length === 0;
    candidates.push({
      traceId,
      hookFixtureIds: group.hookFixtureIds,
      eventKinds: group.eventKinds,
      complete,
      promotionReady,
      enginePortReady,
      missingRuntimeHookFixtureIds,
      missingPromotionGateFixtureIds,
    });
  }

  const completeTraceIds = candidates.filter(candidate => candidate.complete).map(candidate => candidate.traceId);
  const promotionReadyTraceIds = candidates
    .filter(candidate => candidate.complete && candidate.promotionReady)
    .map(candidate => candidate.traceId);
  const engineReadyTraceIds = candidates
    .filter(candidate => candidate.complete && candidate.enginePortReady)
    .map(candidate => candidate.traceId);
  return {
    planFixtureId: plan.id,
    sourcePlanId: plan.sourcePlanId || '',
    flowId: plan.flowId || '',
    stateSlot: plan.stateSlot,
    finalStatus: engineReadyTraceIds.length
      ? 'engine_port_ready_for_supplied_events'
      : promotionReadyTraceIds.length
        ? 'same_frame_trace_promotion_ready_for_supplied_events'
        : completeTraceIds.length
          ? 'same_frame_trace_group_complete_pending_review'
          : candidates.length
            ? 'partial_same_frame_trace_group'
            : 'runtime_trace_pending_or_missing',
    runtimeTraceComplete: completeTraceIds.length > 0,
    promotionReady: promotionReadyTraceIds.length > 0,
    enginePortReady: engineReadyTraceIds.length > 0,
    completeTraceIds,
    promotionReadyTraceIds,
    engineReadyTraceIds,
    candidateTraceIds: candidates.map(candidate => candidate.traceId),
    bestCandidateTraceIds: candidates
      .sort((a, b) => (
        a.missingRuntimeHookFixtureIds.length + a.missingPromotionGateFixtureIds.length
      ) - (
        b.missingRuntimeHookFixtureIds.length + b.missingPromotionGateFixtureIds.length
      ))
      .slice(0, 3)
      .map(candidate => ({
        traceId: candidate.traceId,
        missingRuntimeHookFixtureIds: candidate.missingRuntimeHookFixtureIds,
        missingPromotionGateFixtureIds: candidate.missingPromotionGateFixtureIds,
      })),
  };
}

export function evaluatePlayerCollisionRuntimeTracePlans(planFixtures, events = []) {
  const knownHookIds = normalizeArray((planFixtures || []).flatMap(plan => [
    ...(plan.runtimeHookFixtureIds || []),
    ...(plan.promotionGateFixtureIds || []),
  ]));
  const normalized = normalizePlayerCollisionRuntimeTraceEvents(events, { knownHookIds: null });
  const groups = groupEventsByTrace(normalized.events);
  const evaluations = normalized.forbiddenPayloadKeys.length
    ? (planFixtures || []).map(plan => ({
      planFixtureId: plan.id,
      sourcePlanId: plan.sourcePlanId || '',
      flowId: plan.flowId || '',
      stateSlot: plan.stateSlot,
      finalStatus: 'runtime_trace_rejected_for_forbidden_payload',
      runtimeTraceComplete: false,
      promotionReady: false,
      enginePortReady: false,
      completeTraceIds: [],
      promotionReadyTraceIds: [],
      engineReadyTraceIds: [],
      candidateTraceIds: [],
      bestCandidateTraceIds: [],
    }))
    : (planFixtures || []).map(plan => evaluateCollisionPlan(plan, groups));

  return {
    evaluatedPlanCount: evaluations.length,
    eventCount: normalized.summary.rawEventCount,
    normalizedEventCount: normalized.summary.normalizedEventCount,
    traceGroupCount: groups.size,
    knownHookFixtureIdCount: knownHookIds.length,
    forbiddenPayloadKeys: normalized.forbiddenPayloadKeys,
    droppedFields: normalized.droppedFields,
    validationIssues: normalized.validationIssues,
    eventNormalizationSummary: normalized.summary,
    statusCounts: evaluations.reduce((counts, item) => {
      counts[item.finalStatus] = (counts[item.finalStatus] || 0) + 1;
      return counts;
    }, {}),
    runtimeTraceCompleteCount: evaluations.filter(item => item.runtimeTraceComplete).length,
    promotionReadyCount: evaluations.filter(item => item.promotionReady).length,
    enginePortReadyCount: evaluations.filter(item => item.enginePortReady).length,
    evaluations,
  };
}
