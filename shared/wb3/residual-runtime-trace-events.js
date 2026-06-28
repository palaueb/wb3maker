'use strict';

export const FORBIDDEN_TRACE_PAYLOAD_KEYS = [
  'romBytes',
  'bytes',
  'streamBytes',
  'tileBytes',
  'tileIds',
  'paletteBytes',
  'paletteValues',
  'pixels',
  'screenshot',
  'imageData',
  'portValues',
  'registerTrace',
  'registerValues',
  'audioBytes',
  'samples',
  'instructionBytes',
];

export const RESIDUAL_TRACE_EVENT_FIELDS = [
  'hookId',
  'same_frame_trace_id',
  'active_bank',
  '_RAM_CF64_',
  '_RAM_CF5E_',
  '_RAM_CF65_',
  '_RAM_CF8A_',
  '_RAM_CF8B_',
  '_RAM_D0DE_',
  '_RAM_D0FE_',
  '_RAM_D020_',
  '_RAM_D022_',
  'overlay_record_index',
  'computed_record_offset',
  'computed_record_end_exclusive',
  'loader_source_region_id',
  'loader_source_offset',
  'palette_script_entry_index',
  'consumer_label',
  'cursor_offset',
  'cursor_region_id',
  'physical_rom_offset',
  'physical_rom_region_id',
  'mapped_source_bank',
  'bank_context_matches_source',
  'access_role',
  'inside_palette_tail_region',
  'controller_phase',
  'loaded_hl_label',
  'loaded_hl_offset',
  'called_loader_label',
  'source_region_id',
  'read_offset',
  'read_region_id',
  'direct_bank7_consumer',
  'target_region_id',
  'target_offset',
  'runtime_trace_kind',
  'direct_consumer_confirmed',
  'field_or_alias_only_rejected',
  'promotion_ready',
];

const allowedFieldSet = new Set(RESIDUAL_TRACE_EVENT_FIELDS);
const forbiddenFieldSet = new Set(FORBIDDEN_TRACE_PAYLOAD_KEYS);
const offsetFields = new Set([
  'computed_record_offset',
  'computed_record_end_exclusive',
  'loader_source_offset',
  'cursor_offset',
  'physical_rom_offset',
  'loaded_hl_offset',
  'read_offset',
  'target_offset',
]);
const numberFields = new Set([
  'active_bank',
  '_RAM_CF64_',
  '_RAM_CF5E_',
  '_RAM_CF65_',
  '_RAM_CF8A_',
  '_RAM_CF8B_',
  '_RAM_D0DE_',
  '_RAM_D0FE_',
  '_RAM_D020_',
  '_RAM_D022_',
  'overlay_record_index',
  'palette_script_entry_index',
  'mapped_source_bank',
]);
const booleanFields = new Set([
  'inside_palette_tail_region',
  'bank_context_matches_source',
  'direct_bank7_consumer',
  'direct_consumer_confirmed',
  'field_or_alias_only_rejected',
  'promotion_ready',
]);

export function normalizeResidualTraceOffset(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `0x${value.toString(16).toUpperCase().padStart(5, '0')}`;
  }
  const text = String(value).trim();
  const match = text.match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  if (!match) return text;
  return `0x${Number.parseInt(match[1], 16).toString(16).toUpperCase().padStart(5, '0')}`;
}

export function collectForbiddenTracePayloadKeys(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(...collectForbiddenTracePayloadKeys(item, `${path}[${index}]`));
    });
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (forbiddenFieldSet.has(key)) found.push(childPath);
    found.push(...collectForbiddenTracePayloadKeys(child, childPath));
  }
  return found;
}

function normalizeKey(key) {
  if (key === 'hook_id' || key === 'id') return 'hookId';
  if (key === 'sameFrameTraceId' || key === 'frameTraceId' || key === 'traceId') return 'same_frame_trace_id';
  if (key === 'targetBoundaryOffset') return 'target_offset';
  return key;
}

function normalizeFieldValue(key, value) {
  if (offsetFields.has(key)) return normalizeResidualTraceOffset(value);
  if (numberFields.has(key)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (booleanFields.has(key)) return value === true || value === 'true' || value === 1;
  return value;
}

export function normalizeResidualRuntimeTraceEvent(rawEvent, index = 0, knownHookIds = null) {
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

export function normalizeResidualRuntimeTraceEvents(input, options = {}) {
  const rawEvents = Array.isArray(input) ? input : input?.events || [];
  const knownHookIds = options.knownHookIds ? new Set(options.knownHookIds) : null;
  const forbiddenPayloadKeys = collectForbiddenTracePayloadKeys(rawEvents);
  const events = [];
  const droppedFields = [];
  const validationIssues = [];

  rawEvents.forEach((rawEvent, index) => {
    const normalized = normalizeResidualRuntimeTraceEvent(rawEvent, index, knownHookIds);
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

export function createResidualRuntimeTraceCollector(options = {}) {
  const events = [];
  let nextTraceIndex = 0;
  const tracePrefix = options.tracePrefix || 'residual-trace';
  const knownHookIds = options.knownHookIds || null;

  function nextTraceId() {
    nextTraceIndex += 1;
    return `${tracePrefix}-${String(nextTraceIndex).padStart(4, '0')}`;
  }

  return {
    nextTraceId,
    emit(hookId, fields = {}, sameFrameTraceId = fields.same_frame_trace_id || fields.traceId || fields.frameTraceId || nextTraceId()) {
      const raw = { ...fields, hookId, same_frame_trace_id: sameFrameTraceId };
      const forbiddenPayloadKeys = collectForbiddenTracePayloadKeys(raw);
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
      const normalized = normalizeResidualRuntimeTraceEvent(raw, events.length, knownHookIds ? new Set(knownHookIds) : null);
      if (normalized.event.hookId && normalized.event.same_frame_trace_id) events.push(normalized.event);
      return normalized;
    },
    events() {
      return events.map(event => ({ ...event }));
    },
    bundle(extra = {}) {
      return {
        schemaVersion: 1,
        eventKind: 'wb3_residual_runtime_trace_events',
        assetPolicy: 'Metadata-only residual runtime trace events. No ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are present.',
        ...extra,
        events: events.map(event => ({ ...event })),
      };
    },
  };
}
