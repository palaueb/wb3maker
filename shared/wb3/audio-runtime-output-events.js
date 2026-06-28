'use strict';

export const AUDIO_RUNTIME_OUTPUT_ASSET_POLICY = 'metadata_only_runtime_event_ids_no_register_values_or_samples';
export const AUDIO_RUNTIME_OUTPUT_VALUE_POLICY = 'runtime_port_value_not_persisted';

export const AUDIO_RUNTIME_OUTPUT_FORBIDDEN_PAYLOAD_KEYS = [
  'romByte',
  'romBytes',
  'streamByte',
  'streamBytes',
  'opcode',
  'opcodes',
  'arg',
  'args',
  'argHex',
  'argsHex',
  'byteHex',
  'encodedHex',
  'registerValue',
  'registerValues',
  'registerTrace',
  'registerTraces',
  'portValue',
  'sample',
  'samples',
  'audioByte',
  'audioBytes',
];

export const AUDIO_RUNTIME_OUTPUT_EVENT_KINDS = [
  'audio_output_phase_fixture',
  'audio_port_write_fixture',
];

export const AUDIO_RUNTIME_OUTPUT_REQUIRED_EVENT_KEYS = [
  'kind',
  'phaseFixtureId',
  'writeFixtureId',
  'frame',
  'frameStatus',
  'pc',
  'chip',
  'port',
  'activeChannel',
  'inputFieldKeys',
  'branchId',
  'selectedByOutputModeFilter',
  'fixtureCatalogId',
  'sourcePhaseId',
  'sourceRoutineLabel',
  'sourceRoutineOffset',
  'sourceRegionId',
  'sourceEventKind',
  'sourceEventRole',
  'sourceParserAction',
  'sourceTraceOperationKinds',
  'sourceTraceTargetLabels',
  'sourceRamFieldKeys',
  'valuePolicy',
  'assetPolicy',
];

export const AUDIO_RUNTIME_OUTPUT_OPTIONAL_EVENT_KEYS = [
  'sourceUnresolvedRamFieldKeys',
  'writeIndex',
  'asmLine',
  'purpose',
];

const arrayFields = new Set([
  'inputFieldKeys',
  'sourceTraceOperationKinds',
  'sourceTraceTargetLabels',
  'sourceRamFieldKeys',
  'sourceUnresolvedRamFieldKeys',
]);
const booleanFields = new Set(['selectedByOutputModeFilter']);
const numberFields = new Set(['frame', 'writeIndex', 'asmLine']);
const offsetFields = new Set(['pc', 'sourceRoutineOffset']);

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value != null && value !== '').map(value => String(value)))]
    .sort((a, b) => a.localeCompare(b));
}

function countObjectKey(object, key, amount = 1) {
  const normalized = key || 'unclassified';
  object[normalized] = (object[normalized] || 0) + amount;
}

function normalizeArray(value) {
  if (value == null || value === '') return [];
  const items = Array.isArray(value) ? value : [value];
  return uniqueSorted(items);
}

function normalizeOffset(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `0x${value.toString(16).toUpperCase().padStart(5, '0')}`;
  }
  const text = String(value).trim();
  const match = text.match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  if (!match) return text;
  return `0x${Number.parseInt(match[1], 16).toString(16).toUpperCase().padStart(5, '0')}`;
}

function normalizeFieldValue(key, value) {
  if (arrayFields.has(key)) return normalizeArray(value);
  if (booleanFields.has(key)) return value === true || value === 'true' || value === 1;
  if (numberFields.has(key)) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (offsetFields.has(key)) return normalizeOffset(value);
  return value == null ? '' : value;
}

function contractEventKeys(eventContractCatalog = null) {
  const contract = eventContractCatalog?.eventContract || eventContractCatalog || {};
  return {
    eventKinds: contract.eventKinds || AUDIO_RUNTIME_OUTPUT_EVENT_KINDS,
    requiredEventKeys: contract.requiredEventKeys || AUDIO_RUNTIME_OUTPUT_REQUIRED_EVENT_KEYS,
    optionalEventKeys: contract.optionalEventKeys || AUDIO_RUNTIME_OUTPUT_OPTIONAL_EVENT_KEYS,
    forbiddenPayloadKeys: contract.forbiddenPayloadKeys || AUDIO_RUNTIME_OUTPUT_FORBIDDEN_PAYLOAD_KEYS,
  };
}

export function collectForbiddenAudioRuntimeOutputPayloadKeys(value, forbiddenKeys = AUDIO_RUNTIME_OUTPUT_FORBIDDEN_PAYLOAD_KEYS, path = '') {
  if (!value || typeof value !== 'object') return [];
  const forbiddenSet = new Set(forbiddenKeys);
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(...collectForbiddenAudioRuntimeOutputPayloadKeys(item, forbiddenKeys, `${path}[${index}]`));
    });
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (forbiddenSet.has(key)) found.push(childPath);
    found.push(...collectForbiddenAudioRuntimeOutputPayloadKeys(child, forbiddenKeys, childPath));
  }
  return found;
}

export function normalizeAudioRuntimeOutputEvent(rawEvent, eventContractCatalog = null, index = 0) {
  const { eventKinds, requiredEventKeys, optionalEventKeys, forbiddenPayloadKeys } = contractEventKeys(eventContractCatalog);
  const allowedKeys = new Set([...requiredEventKeys, ...optionalEventKeys]);
  const allowedKinds = new Set(eventKinds);
  const event = {};
  const droppedFields = [];
  const validationIssues = [];

  if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
    return {
      event,
      droppedFields,
      forbiddenPayloadKeys: [],
      validationIssues: [{ kind: 'invalid_event_object', index }],
    };
  }

  const forbidden = collectForbiddenAudioRuntimeOutputPayloadKeys(rawEvent, forbiddenPayloadKeys);
  if (forbidden.length) {
    return {
      event,
      droppedFields,
      forbiddenPayloadKeys: forbidden,
      validationIssues: forbidden.map(field => ({ kind: 'forbidden_payload_key', field, index })),
    };
  }

  for (const [key, value] of Object.entries(rawEvent)) {
    if (!allowedKeys.has(key)) {
      droppedFields.push({ index, field: key });
      continue;
    }
    event[key] = normalizeFieldValue(key, value);
  }

  if (!event.kind) validationIssues.push({ kind: 'missing_event_kind', index });
  else if (allowedKinds.size && !allowedKinds.has(event.kind)) validationIssues.push({ kind: 'invalid_event_kind', index, kind: event.kind });
  for (const key of requiredEventKeys) {
    if (!Object.prototype.hasOwnProperty.call(event, key)) {
      validationIssues.push({ kind: 'missing_required_key', index, key, eventKind: event.kind || '' });
    }
  }

  return {
    event,
    droppedFields,
    forbiddenPayloadKeys: [],
    validationIssues,
  };
}

export function createAudioRuntimeOutputEventSink(options = {}) {
  return {
    id: options.id || 'audio_runtime_output_event_sink',
    recipeId: options.recipeId || '',
    requestId: options.requestId || '',
    outputModeFilter: options.outputModeFilter || 'all',
    fixtureCatalogId: options.fixtureCatalogId || '',
    eventContractCatalogId: options.eventContractCatalogId || '',
    events: [],
    rejectedEvents: [],
    droppedFields: [],
    validationIssues: [],
    summary: {
      eventCount: 0,
      phaseEventCount: 0,
      writeEventCount: 0,
      selectedPhaseEventCount: 0,
      selectedWriteEventCount: 0,
      missingPhaseFixtureCount: 0,
      missingWriteFixtureCount: 0,
      psgEventCount: 0,
      fmEventCount: 0,
      mixedEventCount: 0,
      frameLinkedEventCount: 0,
      frameUnlinkedEventCount: 0,
      rejectedEventCount: 0,
      droppedFieldCount: 0,
      validationIssueCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
      persistedRomByteCount: 0,
      assetPolicy: AUDIO_RUNTIME_OUTPUT_ASSET_POLICY,
    },
  };
}

export function appendAudioRuntimeOutputEvent(sink, rawEvent, eventContractCatalog = null) {
  const normalized = normalizeAudioRuntimeOutputEvent(rawEvent, eventContractCatalog, sink?.summary?.eventCount || 0);
  if (!sink) return normalized;
  sink.droppedFields.push(...normalized.droppedFields);
  sink.summary.droppedFieldCount = sink.droppedFields.length;
  if (normalized.forbiddenPayloadKeys.length || normalized.validationIssues.some(issue => issue.kind === 'forbidden_payload_key')) {
    sink.rejectedEvents.push({
      kind: rawEvent?.kind || '',
      forbiddenPayloadKeys: normalized.forbiddenPayloadKeys,
      validationIssues: normalized.validationIssues,
    });
    sink.summary.rejectedEventCount = sink.rejectedEvents.length;
    sink.validationIssues.push(...normalized.validationIssues);
    sink.summary.validationIssueCount = sink.validationIssues.length;
    return normalized;
  }

  const event = normalized.event;
  sink.events.push(event);
  sink.validationIssues.push(...normalized.validationIssues);
  sink.summary.validationIssueCount = sink.validationIssues.length;
  sink.summary.eventCount++;
  if (event.kind === 'audio_output_phase_fixture') {
    sink.summary.phaseEventCount++;
    if (event.selectedByOutputModeFilter) sink.summary.selectedPhaseEventCount++;
  } else if (event.kind === 'audio_port_write_fixture') {
    sink.summary.writeEventCount++;
    if (event.selectedByOutputModeFilter) sink.summary.selectedWriteEventCount++;
  }
  if (event.frameStatus === 'frame_step_linked') sink.summary.frameLinkedEventCount++;
  else sink.summary.frameUnlinkedEventCount++;
  if (event.chip === 'psg') sink.summary.psgEventCount++;
  else if (event.chip === 'fm') sink.summary.fmEventCount++;
  else sink.summary.mixedEventCount++;
  return normalized;
}

function phaseInputFieldKeys(phaseFixture) {
  return uniqueSorted((phaseFixture?.fieldInputRefs || []).map(ref => ref.key || ref.label || ''));
}

function sourceRegionId(region) {
  return region?.id || '';
}

function defaultEventFields(fixtureCatalog, phaseFixture, writeFixture, fields = {}) {
  const phase = phaseFixture || {};
  const write = writeFixture || {};
  const region = write.region || phase.routineRegion || {};
  return {
    frame: Number.isInteger(fields.frame) ? fields.frame : null,
    frameStatus: fields.frameStatus || 'fixture_static_coverage',
    pc: fields.pc || write.routineOffset || phase.routineOffset || '',
    chip: fields.chip || write.chip || phase.chip || '',
    port: fields.port || write.port || '',
    activeChannel: fields.activeChannel || '',
    inputFieldKeys: fields.inputFieldKeys || phaseInputFieldKeys(phase),
    branchId: fields.branchId || (phase.branchIds || [])[0] || '',
    selectedByOutputModeFilter: fields.selectedByOutputModeFilter == null ? true : fields.selectedByOutputModeFilter,
    fixtureCatalogId: fixtureCatalog?.id || fields.fixtureCatalogId || '',
    sourcePhaseId: fields.sourcePhaseId || write.sourcePhaseId || phase.sourcePhaseId || '',
    sourceRoutineLabel: fields.sourceRoutineLabel || write.routineLabel || phase.routineLabel || '',
    sourceRoutineOffset: fields.sourceRoutineOffset || write.routineOffset || phase.routineOffset || '',
    sourceRegionId: fields.sourceRegionId || sourceRegionId(region),
    sourceEventKind: fields.sourceEventKind || '',
    sourceEventRole: fields.sourceEventRole || 'audio_output_fixture_static_coverage',
    sourceParserAction: fields.sourceParserAction || '',
    sourceTraceOperationKinds: fields.sourceTraceOperationKinds || [],
    sourceTraceTargetLabels: fields.sourceTraceTargetLabels || [],
    sourceRamFieldKeys: fields.sourceRamFieldKeys || [],
    sourceUnresolvedRamFieldKeys: fields.sourceUnresolvedRamFieldKeys || [],
    valuePolicy: AUDIO_RUNTIME_OUTPUT_VALUE_POLICY,
    assetPolicy: AUDIO_RUNTIME_OUTPUT_ASSET_POLICY,
  };
}

function indexFixtureCatalog(fixtureCatalog) {
  const phaseById = new Map();
  const phaseBySourceId = new Map();
  const writeById = new Map();
  const writesBySourcePhase = new Map();

  for (const phase of fixtureCatalog?.phaseFixtures || []) {
    if (phase.id) phaseById.set(phase.id, phase);
    if (phase.sourcePhaseId) phaseBySourceId.set(phase.sourcePhaseId, phase);
  }
  for (const write of fixtureCatalog?.portWriteFixtures || []) {
    if (write.id) writeById.set(write.id, write);
    if (!writesBySourcePhase.has(write.sourcePhaseId)) writesBySourcePhase.set(write.sourcePhaseId, []);
    writesBySourcePhase.get(write.sourcePhaseId).push(write);
  }

  return { phaseById, phaseBySourceId, writeById, writesBySourcePhase };
}

export function createAudioRuntimeOutputFixtureEmitter(fixtureCatalog, eventContractCatalog, options = {}) {
  const index = indexFixtureCatalog(fixtureCatalog);
  const { forbiddenPayloadKeys } = contractEventKeys(eventContractCatalog);
  const sink = options.sink || createAudioRuntimeOutputEventSink({
    id: options.id || 'audio_runtime_output_fixture_emitter_sink',
    recipeId: options.recipeId || '',
    requestId: options.requestId || '',
    outputModeFilter: options.outputModeFilter || 'all',
    fixtureCatalogId: fixtureCatalog?.id || '',
    eventContractCatalogId: eventContractCatalog?.id || '',
  });

  function phaseForId(phaseFixtureId) {
    return index.phaseById.get(phaseFixtureId) || index.phaseBySourceId.get(phaseFixtureId) || null;
  }

  function rejectForbiddenFields(fields, context) {
    const forbidden = collectForbiddenAudioRuntimeOutputPayloadKeys(fields, forbiddenPayloadKeys);
    if (!forbidden.length) return null;
    const validationIssues = forbidden.map(field => ({
      kind: 'forbidden_payload_key',
      field,
      ...context,
    }));
    sink.rejectedEvents.push({
      kind: context.kind || '',
      forbiddenPayloadKeys: forbidden,
      validationIssues,
    });
    sink.validationIssues.push(...validationIssues);
    sink.summary.rejectedEventCount = sink.rejectedEvents.length;
    sink.summary.validationIssueCount = sink.validationIssues.length;
    return {
      event: {},
      droppedFields: [],
      forbiddenPayloadKeys: forbidden,
      validationIssues,
    };
  }

  function emitPhase(phaseFixtureId, fields = {}) {
    const forbidden = rejectForbiddenFields(fields, { kind: 'audio_output_phase_fixture', phaseFixtureId });
    if (forbidden) return forbidden;
    const phase = phaseForId(phaseFixtureId);
    if (!phase) {
      sink.summary.missingPhaseFixtureCount++;
      return {
        event: {},
        validationIssues: [{ kind: 'unknown_phase_fixture', phaseFixtureId }],
        droppedFields: [],
        forbiddenPayloadKeys: [],
      };
    }
    const event = {
      kind: 'audio_output_phase_fixture',
      phaseFixtureId: phase.id || '',
      writeFixtureId: '',
      ...defaultEventFields(fixtureCatalog, phase, null, fields),
    };
    return appendAudioRuntimeOutputEvent(sink, event, eventContractCatalog);
  }

  function emitWrite(writeFixtureId, fields = {}) {
    const forbidden = rejectForbiddenFields(fields, { kind: 'audio_port_write_fixture', writeFixtureId });
    if (forbidden) return forbidden;
    const write = index.writeById.get(writeFixtureId);
    if (!write) {
      sink.summary.missingWriteFixtureCount++;
      return {
        event: {},
        validationIssues: [{ kind: 'unknown_write_fixture', writeFixtureId }],
        droppedFields: [],
        forbiddenPayloadKeys: [],
      };
    }
    const phase = phaseForId(write.sourcePhaseId);
    const event = {
      kind: 'audio_port_write_fixture',
      phaseFixtureId: phase?.id || '',
      writeFixtureId: write.id || '',
      ...defaultEventFields(fixtureCatalog, phase, write, fields),
      writeIndex: Number.isInteger(write.writeIndex) ? write.writeIndex : null,
      asmLine: Number.isInteger(write.asmLine) ? write.asmLine : null,
      purpose: write.purpose || '',
    };
    return appendAudioRuntimeOutputEvent(sink, event, eventContractCatalog);
  }

  function emitFixtureCatalogCoverage(options = {}) {
    const frameStart = Number.isInteger(options.frameStart) ? options.frameStart : 0;
    const frameStatus = options.frameStatus || 'fixture_static_coverage';
    const activeChannel = options.activeChannel || 'fixture_coverage';
    const phases = (fixtureCatalog?.phaseFixtures || []).slice()
      .sort((a, b) => String(a.routineOffset || '').localeCompare(String(b.routineOffset || '')) || String(a.id || '').localeCompare(String(b.id || '')));
    phases.forEach((phase, index) => {
      const frame = frameStart + index;
      emitPhase(phase.id, { ...options.fields, frame, frameStatus, activeChannel });
      for (const writeId of phase.writeFixtureIds || []) {
        emitWrite(writeId, { ...options.fields, frame, frameStatus, activeChannel });
      }
    });
    return sink;
  }

  return {
    sink,
    knownPhaseFixtureIds: [...index.phaseById.keys()].sort(),
    knownWriteFixtureIds: [...index.writeById.keys()].sort(),
    emitPhase,
    emitWrite,
    emitFixtureCatalogCoverage,
  };
}

function runtimeFrameKey(event) {
  return Number.isInteger(event.frame) ? `f${event.frame}` : (event.frameStatus || 'linear');
}

function portPhaseKind(port) {
  if (port === 'Port_PSG') return 'psg_data';
  if (port === 'Port_FMAddress') return 'fm_address';
  if (port === 'Port_FMData') return 'fm_data';
  return port ? 'other_port' : 'unresolved_port';
}

export function buildAudioRuntimeOutputStateAccumulator(sink) {
  const frameGroups = new Map();
  const phaseFixtureIds = new Set();
  const writeFixtureIds = new Set();
  const branches = new Set();
  const inputFields = new Set();
  const channels = new Set();
  const summary = {
    eventCount: 0,
    phaseEventCount: 0,
    writeEventCount: 0,
    selectedEventCount: 0,
    selectedPhaseEventCount: 0,
    selectedWriteEventCount: 0,
    psgEventCount: 0,
    fmEventCount: 0,
    mixedEventCount: 0,
    psgWriteEventCount: 0,
    fmWriteEventCount: 0,
    mixedWriteEventCount: 0,
    frameGroupCount: 0,
    frameLinkedGroupCount: 0,
    frameUnlinkedGroupCount: 0,
    uniquePhaseFixtureCount: 0,
    uniqueWriteFixtureCount: 0,
    portKindCount: 0,
    branchKindCount: 0,
    inputFieldKeyCount: 0,
    activeChannelCount: 0,
    chipCounts: {},
    portCounts: {},
    branchCounts: {},
    activeChannelCounts: {},
    inputFieldKeyCounts: {},
    persistedRegisterValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedSampleCount: 0,
    persistedAudioByteCount: 0,
    persistedRomByteCount: 0,
    assetPolicy: 'metadata_only_psg_fm_accumulator_no_values_or_samples',
  };

  for (const event of sink?.events || []) {
    const frameKey = runtimeFrameKey(event);
    let frame = frameGroups.get(frameKey);
    if (!frame) {
      frame = {
        frame: Number.isInteger(event.frame) ? event.frame : null,
        frameKey,
        frameStatus: event.frameStatus || '',
        eventCount: 0,
        phaseEventCount: 0,
        writeEventCount: 0,
        selectedEventCount: 0,
        selectedPhaseEventCount: 0,
        selectedWriteEventCount: 0,
        psgEventCount: 0,
        fmEventCount: 0,
        mixedEventCount: 0,
        portCounts: {},
        branchCounts: {},
        activeChannelCounts: {},
        inputFieldKeyCounts: {},
        phaseFixtureIds: new Set(),
        writeFixtureIds: new Set(),
      };
      frameGroups.set(frameKey, frame);
    }
    const isPhase = event.kind === 'audio_output_phase_fixture';
    const isWrite = event.kind === 'audio_port_write_fixture';
    const selected = Boolean(event.selectedByOutputModeFilter);
    summary.eventCount++;
    frame.eventCount++;
    if (selected) {
      summary.selectedEventCount++;
      frame.selectedEventCount++;
    }
    if (isPhase) {
      summary.phaseEventCount++;
      frame.phaseEventCount++;
      if (selected) {
        summary.selectedPhaseEventCount++;
        frame.selectedPhaseEventCount++;
      }
    } else if (isWrite) {
      summary.writeEventCount++;
      frame.writeEventCount++;
      if (selected) {
        summary.selectedWriteEventCount++;
        frame.selectedWriteEventCount++;
      }
    }
    if (event.chip === 'psg') {
      summary.psgEventCount++;
      frame.psgEventCount++;
      if (isWrite) summary.psgWriteEventCount++;
    } else if (event.chip === 'fm') {
      summary.fmEventCount++;
      frame.fmEventCount++;
      if (isWrite) summary.fmWriteEventCount++;
    } else {
      summary.mixedEventCount++;
      frame.mixedEventCount++;
      if (isWrite) summary.mixedWriteEventCount++;
    }
    countObjectKey(summary.chipCounts, event.chip || 'mixed');
    if (event.port) {
      countObjectKey(summary.portCounts, event.port);
      countObjectKey(frame.portCounts, event.port);
    }
    if (event.branchId) {
      countObjectKey(summary.branchCounts, event.branchId);
      countObjectKey(frame.branchCounts, event.branchId);
      branches.add(event.branchId);
    }
    if (event.activeChannel) {
      countObjectKey(summary.activeChannelCounts, event.activeChannel);
      countObjectKey(frame.activeChannelCounts, event.activeChannel);
      channels.add(event.activeChannel);
    }
    for (const key of event.inputFieldKeys || []) {
      countObjectKey(summary.inputFieldKeyCounts, key);
      countObjectKey(frame.inputFieldKeyCounts, key);
      inputFields.add(key);
    }
    if (event.phaseFixtureId) {
      phaseFixtureIds.add(event.phaseFixtureId);
      frame.phaseFixtureIds.add(event.phaseFixtureId);
    }
    if (event.writeFixtureId) {
      writeFixtureIds.add(event.writeFixtureId);
      frame.writeFixtureIds.add(event.writeFixtureId);
    }
  }

  summary.frameGroupCount = frameGroups.size;
  summary.frameLinkedGroupCount = [...frameGroups.values()].filter(frame => frame.frameStatus === 'frame_step_linked').length;
  summary.frameUnlinkedGroupCount = frameGroups.size - summary.frameLinkedGroupCount;
  summary.uniquePhaseFixtureCount = phaseFixtureIds.size;
  summary.uniqueWriteFixtureCount = writeFixtureIds.size;
  summary.portKindCount = Object.keys(summary.portCounts).length;
  summary.branchKindCount = branches.size;
  summary.inputFieldKeyCount = inputFields.size;
  summary.activeChannelCount = channels.size;

  return {
    id: 'audio_runtime_output_state_accumulator',
    sinkId: sink?.id || '',
    recipeId: sink?.recipeId || '',
    requestId: sink?.requestId || '',
    outputModeFilter: sink?.outputModeFilter || 'all',
    frameGroups: [...frameGroups.values()].map(frame => ({
      ...frame,
      phaseFixtureIds: [...frame.phaseFixtureIds].sort(),
      writeFixtureIds: [...frame.writeFixtureIds].sort(),
    })),
    summary,
    assetPolicy: summary.assetPolicy,
  };
}

export function buildAudioRuntimeOutputFrameTimeline(accumulator) {
  const phaseFixtureIds = new Set();
  const writeFixtureIds = new Set();
  const ports = new Set();
  const branches = new Set();
  const inputFields = new Set();
  const channels = new Set();
  const summary = {
    frameCount: 0,
    frameLinkedCount: 0,
    frameUnlinkedCount: 0,
    eventCount: 0,
    phaseEventCount: 0,
    writeEventCount: 0,
    selectedEventCount: 0,
    selectedPhaseEventCount: 0,
    selectedWriteEventCount: 0,
    psgEventCount: 0,
    fmEventCount: 0,
    mixedEventCount: 0,
    psgWriteEventCount: 0,
    fmWriteEventCount: 0,
    mixedWriteEventCount: 0,
    uniquePhaseFixtureCount: 0,
    uniqueWriteFixtureCount: 0,
    portKindCount: 0,
    branchKindCount: 0,
    inputFieldKeyCount: 0,
    activeChannelCount: 0,
    persistedRegisterValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedSampleCount: 0,
    persistedAudioByteCount: 0,
    persistedRomByteCount: 0,
    assetPolicy: 'metadata_only_output_frame_timeline_no_values_or_samples',
  };

  const frames = (accumulator?.frameGroups || []).slice().sort((a, b) => {
    const af = Number.isInteger(a.frame) ? a.frame : Number.MAX_SAFE_INTEGER;
    const bf = Number.isInteger(b.frame) ? b.frame : Number.MAX_SAFE_INTEGER;
    return af - bf || String(a.frameKey || '').localeCompare(String(b.frameKey || ''));
  }).map((frame, index) => {
    const portCounts = frame.portCounts || {};
    const psgWriteEventCount = portCounts.Port_PSG || 0;
    const fmWriteEventCount = (portCounts.Port_FMAddress || 0) + (portCounts.Port_FMData || 0);
    const mixedWriteEventCount = Math.max(0, (frame.writeEventCount || 0) - psgWriteEventCount - fmWriteEventCount);
    summary.frameCount++;
    if (frame.frameStatus === 'frame_step_linked') summary.frameLinkedCount++;
    else summary.frameUnlinkedCount++;
    for (const key of [
      'eventCount',
      'phaseEventCount',
      'writeEventCount',
      'selectedEventCount',
      'selectedPhaseEventCount',
      'selectedWriteEventCount',
      'psgEventCount',
      'fmEventCount',
      'mixedEventCount',
    ]) summary[key] += frame[key] || 0;
    summary.psgWriteEventCount += psgWriteEventCount;
    summary.fmWriteEventCount += fmWriteEventCount;
    summary.mixedWriteEventCount += mixedWriteEventCount;
    for (const port of Object.keys(portCounts)) ports.add(port);
    for (const branch of Object.keys(frame.branchCounts || {})) branches.add(branch);
    for (const key of Object.keys(frame.inputFieldKeyCounts || {})) inputFields.add(key);
    for (const channel of Object.keys(frame.activeChannelCounts || {})) channels.add(channel);
    for (const id of frame.phaseFixtureIds || []) phaseFixtureIds.add(id);
    for (const id of frame.writeFixtureIds || []) writeFixtureIds.add(id);
    return {
      index,
      frame: Number.isInteger(frame.frame) ? frame.frame : null,
      frameKey: frame.frameKey || '',
      frameStatus: frame.frameStatus || '',
      eventCount: frame.eventCount || 0,
      phaseEventCount: frame.phaseEventCount || 0,
      writeEventCount: frame.writeEventCount || 0,
      selectedEventCount: frame.selectedEventCount || 0,
      selectedPhaseEventCount: frame.selectedPhaseEventCount || 0,
      selectedWriteEventCount: frame.selectedWriteEventCount || 0,
      psgEventCount: frame.psgEventCount || 0,
      fmEventCount: frame.fmEventCount || 0,
      mixedEventCount: frame.mixedEventCount || 0,
      psgWriteEventCount,
      fmWriteEventCount,
      mixedWriteEventCount,
      portCounts,
      branchCounts: frame.branchCounts || {},
      inputFieldKeyCounts: frame.inputFieldKeyCounts || {},
      activeChannelCounts: frame.activeChannelCounts || {},
      phaseFixtureIds: frame.phaseFixtureIds || [],
      writeFixtureIds: frame.writeFixtureIds || [],
      assetPolicy: summary.assetPolicy,
    };
  });

  summary.uniquePhaseFixtureCount = phaseFixtureIds.size;
  summary.uniqueWriteFixtureCount = writeFixtureIds.size;
  summary.portKindCount = ports.size;
  summary.branchKindCount = branches.size;
  summary.inputFieldKeyCount = inputFields.size;
  summary.activeChannelCount = channels.size;

  return {
    id: 'audio_runtime_output_frame_timeline',
    accumulatorId: accumulator?.id || '',
    recipeId: accumulator?.recipeId || '',
    requestId: accumulator?.requestId || '',
    outputModeFilter: accumulator?.outputModeFilter || 'all',
    frames,
    summary,
    assetPolicy: summary.assetPolicy,
  };
}

function registerIntentKind(frame) {
  if (!frame?.writeEventCount) return 'no_writes';
  if (frame.psgWriteEventCount && !frame.fmWriteEventCount && !frame.mixedWriteEventCount) return 'psg_only';
  if (frame.fmWriteEventCount && !frame.psgWriteEventCount && !frame.mixedWriteEventCount) return 'fm_only';
  return 'mixed_psg_fm';
}

export function buildAudioRuntimeOutputRegisterIntentModel(frameTimeline) {
  const summary = {
    frameCount: 0,
    psgOnlyFrameCount: 0,
    fmOnlyFrameCount: 0,
    mixedFrameCount: 0,
    noWriteFrameCount: 0,
    eventCount: 0,
    phaseEventCount: 0,
    writeEventCount: 0,
    selectedEventCount: 0,
    selectedPhaseEventCount: 0,
    selectedWriteEventCount: 0,
    psgEventCount: 0,
    fmEventCount: 0,
    mixedEventCount: 0,
    psgWriteEventCount: 0,
    fmWriteEventCount: 0,
    mixedWriteEventCount: 0,
    uniquePhaseFixtureCount: 0,
    uniqueWriteFixtureCount: 0,
    portKindCount: 0,
    branchKindCount: 0,
    inputFieldKeyCount: 0,
    activeChannelCount: 0,
    intentKindCounts: {},
    portCounts: {},
    branchCounts: {},
    activeChannelCounts: {},
    inputFieldKeyCounts: {},
    persistedRegisterValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedSampleCount: 0,
    persistedAudioByteCount: 0,
    persistedRomByteCount: 0,
    assetPolicy: 'metadata_only_register_intent_no_values_or_samples',
  };
  const phaseFixtureIds = new Set();
  const writeFixtureIds = new Set();
  const ports = new Set();
  const branches = new Set();
  const inputFields = new Set();
  const channels = new Set();
  const frames = (frameTimeline?.frames || []).map((frame, index) => {
    const intentKind = registerIntentKind(frame);
    summary.frameCount++;
    if (intentKind === 'psg_only') summary.psgOnlyFrameCount++;
    else if (intentKind === 'fm_only') summary.fmOnlyFrameCount++;
    else if (intentKind === 'mixed_psg_fm') summary.mixedFrameCount++;
    else summary.noWriteFrameCount++;
    countObjectKey(summary.intentKindCounts, intentKind);
    for (const key of [
      'eventCount',
      'phaseEventCount',
      'writeEventCount',
      'selectedEventCount',
      'selectedPhaseEventCount',
      'selectedWriteEventCount',
      'psgEventCount',
      'fmEventCount',
      'mixedEventCount',
      'psgWriteEventCount',
      'fmWriteEventCount',
      'mixedWriteEventCount',
    ]) summary[key] += frame[key] || 0;
    for (const [port, count] of Object.entries(frame.portCounts || {})) {
      ports.add(port);
      countObjectKey(summary.portCounts, port, count);
    }
    for (const [branch, count] of Object.entries(frame.branchCounts || {})) {
      branches.add(branch);
      countObjectKey(summary.branchCounts, branch, count);
    }
    for (const [key, count] of Object.entries(frame.inputFieldKeyCounts || {})) {
      inputFields.add(key);
      countObjectKey(summary.inputFieldKeyCounts, key, count);
    }
    for (const [channel, count] of Object.entries(frame.activeChannelCounts || {})) {
      channels.add(channel);
      countObjectKey(summary.activeChannelCounts, channel, count);
    }
    for (const id of frame.phaseFixtureIds || []) phaseFixtureIds.add(id);
    for (const id of frame.writeFixtureIds || []) writeFixtureIds.add(id);
    return {
      ...frame,
      index: Number.isInteger(frame.index) ? frame.index : index,
      intentKind,
      assetPolicy: summary.assetPolicy,
    };
  });
  summary.uniquePhaseFixtureCount = phaseFixtureIds.size;
  summary.uniqueWriteFixtureCount = writeFixtureIds.size;
  summary.portKindCount = ports.size;
  summary.branchKindCount = branches.size;
  summary.inputFieldKeyCount = inputFields.size;
  summary.activeChannelCount = channels.size;
  return {
    id: 'audio_runtime_output_register_intent',
    frameTimelineId: frameTimeline?.id || '',
    recipeId: frameTimeline?.recipeId || '',
    requestId: frameTimeline?.requestId || '',
    outputModeFilter: frameTimeline?.outputModeFilter || 'all',
    frames,
    summary,
    assetPolicy: summary.assetPolicy,
  };
}

function channelPortGroupKey(event) {
  return [
    runtimeFrameKey(event),
    event.activeChannel || 'unclassified_channel',
    event.chip || 'mixed',
    event.port || 'unresolved_port',
    portPhaseKind(event.port || ''),
    event.branchId || 'unclassified_branch',
  ].join('|');
}

export function buildAudioRuntimeOutputChannelPortIntentModel(sink) {
  const groups = new Map();
  const frames = new Set();
  const phaseFixtureIds = new Set();
  const writeFixtureIds = new Set();
  const ports = new Set();
  const branches = new Set();
  const inputFields = new Set();
  const channels = new Set();
  const phaseKinds = new Set();
  const sourceEventKinds = new Set();
  const sourceEventRoles = new Set();
  const sourceTraceOperationKinds = new Set();
  const sourceTraceTargets = new Set();
  const sourceRamFields = new Set();
  const sourceUnresolvedRamFields = new Set();
  const summary = {
    groupCount: 0,
    frameCount: 0,
    frameLinkedGroupCount: 0,
    frameUnlinkedGroupCount: 0,
    writeEventCount: 0,
    selectedWriteEventCount: 0,
    psgWriteEventCount: 0,
    fmWriteEventCount: 0,
    fmAddressWriteEventCount: 0,
    fmDataWriteEventCount: 0,
    mixedWriteEventCount: 0,
    uniquePhaseFixtureCount: 0,
    uniqueWriteFixtureCount: 0,
    portKindCount: 0,
    branchKindCount: 0,
    inputFieldKeyCount: 0,
    activeChannelCount: 0,
    phaseKindCount: 0,
    sourceEventKindCount: 0,
    sourceEventRoleCount: 0,
    sourceTraceOperationKindCount: 0,
    sourceTraceTargetCount: 0,
    sourceRamFieldKeyCount: 0,
    sourceUnresolvedRamFieldKeyCount: 0,
    sourceTraceLinkedWriteCount: 0,
    sourceRamLinkedWriteCount: 0,
    sourceUnresolvedRamLinkedWriteCount: 0,
    portCounts: {},
    branchCounts: {},
    activeChannelCounts: {},
    inputFieldKeyCounts: {},
    phaseKindCounts: {},
    sourceEventKindCounts: {},
    sourceEventRoleCounts: {},
    sourceTraceOperationKindCounts: {},
    sourceTraceTargetCounts: {},
    sourceRamFieldKeyCounts: {},
    sourceUnresolvedRamFieldKeyCounts: {},
    persistedRegisterValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedSampleCount: 0,
    persistedAudioByteCount: 0,
    persistedRomByteCount: 0,
    assetPolicy: 'metadata_only_channel_port_intent_no_values_or_samples',
  };

  for (const event of sink?.events || []) {
    if (event.kind !== 'audio_port_write_fixture') continue;
    const frameKey = runtimeFrameKey(event);
    const phaseKind = portPhaseKind(event.port || '');
    const groupKey = channelPortGroupKey(event);
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        groupKey,
        frame: Number.isInteger(event.frame) ? event.frame : null,
        frameKey,
        frameStatus: event.frameStatus || '',
        activeChannel: event.activeChannel || '',
        chip: event.chip || '',
        port: event.port || '',
        phaseKind,
        branchId: event.branchId || '',
        writeEventCount: 0,
        selectedWriteEventCount: 0,
        psgWriteEventCount: 0,
        fmWriteEventCount: 0,
        fmAddressWriteEventCount: 0,
        fmDataWriteEventCount: 0,
        mixedWriteEventCount: 0,
        inputFieldKeyCounts: {},
        sourceEventKindCounts: {},
        sourceEventRoleCounts: {},
        sourceTraceOperationKindCounts: {},
        sourceTraceTargetCounts: {},
        sourceRamFieldKeyCounts: {},
        sourceUnresolvedRamFieldKeyCounts: {},
        phaseFixtureIds: new Set(),
        writeFixtureIds: new Set(),
      };
      groups.set(groupKey, group);
      if (group.frameStatus === 'frame_step_linked') summary.frameLinkedGroupCount++;
      else summary.frameUnlinkedGroupCount++;
    }
    frames.add(frameKey);
    summary.writeEventCount++;
    group.writeEventCount++;
    if (event.selectedByOutputModeFilter) {
      summary.selectedWriteEventCount++;
      group.selectedWriteEventCount++;
    }
    if (event.chip === 'psg') {
      summary.psgWriteEventCount++;
      group.psgWriteEventCount++;
    } else if (event.chip === 'fm') {
      summary.fmWriteEventCount++;
      group.fmWriteEventCount++;
    } else {
      summary.mixedWriteEventCount++;
      group.mixedWriteEventCount++;
    }
    if (phaseKind === 'fm_address') {
      summary.fmAddressWriteEventCount++;
      group.fmAddressWriteEventCount++;
    } else if (phaseKind === 'fm_data') {
      summary.fmDataWriteEventCount++;
      group.fmDataWriteEventCount++;
    }
    if (event.port) {
      ports.add(event.port);
      countObjectKey(summary.portCounts, event.port);
    }
    if (event.branchId) {
      branches.add(event.branchId);
      countObjectKey(summary.branchCounts, event.branchId);
    }
    if (event.activeChannel) {
      channels.add(event.activeChannel);
      countObjectKey(summary.activeChannelCounts, event.activeChannel);
    }
    phaseKinds.add(phaseKind);
    countObjectKey(summary.phaseKindCounts, phaseKind);
    if (event.sourceEventKind) {
      sourceEventKinds.add(event.sourceEventKind);
      countObjectKey(summary.sourceEventKindCounts, event.sourceEventKind);
      countObjectKey(group.sourceEventKindCounts, event.sourceEventKind);
    }
    if (event.sourceEventRole) {
      sourceEventRoles.add(event.sourceEventRole);
      countObjectKey(summary.sourceEventRoleCounts, event.sourceEventRole);
      countObjectKey(group.sourceEventRoleCounts, event.sourceEventRole);
    }
    if ((event.sourceTraceOperationKinds || []).length || (event.sourceTraceTargetLabels || []).length) summary.sourceTraceLinkedWriteCount++;
    if ((event.sourceRamFieldKeys || []).length) summary.sourceRamLinkedWriteCount++;
    if ((event.sourceUnresolvedRamFieldKeys || []).length) summary.sourceUnresolvedRamLinkedWriteCount++;
    for (const kind of event.sourceTraceOperationKinds || []) {
      sourceTraceOperationKinds.add(kind);
      countObjectKey(summary.sourceTraceOperationKindCounts, kind);
      countObjectKey(group.sourceTraceOperationKindCounts, kind);
    }
    for (const target of event.sourceTraceTargetLabels || []) {
      sourceTraceTargets.add(target);
      countObjectKey(summary.sourceTraceTargetCounts, target);
      countObjectKey(group.sourceTraceTargetCounts, target);
    }
    for (const key of event.sourceRamFieldKeys || []) {
      sourceRamFields.add(key);
      countObjectKey(summary.sourceRamFieldKeyCounts, key);
      countObjectKey(group.sourceRamFieldKeyCounts, key);
    }
    for (const key of event.sourceUnresolvedRamFieldKeys || []) {
      sourceUnresolvedRamFields.add(key);
      countObjectKey(summary.sourceUnresolvedRamFieldKeyCounts, key);
      countObjectKey(group.sourceUnresolvedRamFieldKeyCounts, key);
    }
    for (const key of event.inputFieldKeys || []) {
      inputFields.add(key);
      countObjectKey(summary.inputFieldKeyCounts, key);
      countObjectKey(group.inputFieldKeyCounts, key);
    }
    if (event.phaseFixtureId) {
      phaseFixtureIds.add(event.phaseFixtureId);
      group.phaseFixtureIds.add(event.phaseFixtureId);
    }
    if (event.writeFixtureId) {
      writeFixtureIds.add(event.writeFixtureId);
      group.writeFixtureIds.add(event.writeFixtureId);
    }
  }

  summary.groupCount = groups.size;
  summary.frameCount = frames.size;
  summary.uniquePhaseFixtureCount = phaseFixtureIds.size;
  summary.uniqueWriteFixtureCount = writeFixtureIds.size;
  summary.portKindCount = ports.size;
  summary.branchKindCount = branches.size;
  summary.inputFieldKeyCount = inputFields.size;
  summary.activeChannelCount = channels.size;
  summary.phaseKindCount = phaseKinds.size;
  summary.sourceEventKindCount = sourceEventKinds.size;
  summary.sourceEventRoleCount = sourceEventRoles.size;
  summary.sourceTraceOperationKindCount = sourceTraceOperationKinds.size;
  summary.sourceTraceTargetCount = sourceTraceTargets.size;
  summary.sourceRamFieldKeyCount = sourceRamFields.size;
  summary.sourceUnresolvedRamFieldKeyCount = sourceUnresolvedRamFields.size;

  const sortedGroups = [...groups.values()].sort((a, b) => {
    const af = Number.isInteger(a.frame) ? a.frame : Number.MAX_SAFE_INTEGER;
    const bf = Number.isInteger(b.frame) ? b.frame : Number.MAX_SAFE_INTEGER;
    return af - bf ||
      String(a.frameKey || '').localeCompare(String(b.frameKey || '')) ||
      String(a.activeChannel || '').localeCompare(String(b.activeChannel || '')) ||
      String(a.port || '').localeCompare(String(b.port || '')) ||
      String(a.branchId || '').localeCompare(String(b.branchId || ''));
  }).map((group, index) => ({
    ...group,
    index,
    phaseFixtureIds: [...group.phaseFixtureIds].sort(),
    writeFixtureIds: [...group.writeFixtureIds].sort(),
    assetPolicy: summary.assetPolicy,
  }));

  return {
    id: 'audio_runtime_output_channel_port_intent',
    sinkId: sink?.id || '',
    recipeId: sink?.recipeId || '',
    requestId: sink?.requestId || '',
    outputModeFilter: sink?.outputModeFilter || 'all',
    groups: sortedGroups,
    summary,
    assetPolicy: summary.assetPolicy,
  };
}

export function buildAudioRuntimeOutputDerivedModels(sink) {
  const runtimeOutputAccumulator = buildAudioRuntimeOutputStateAccumulator(sink);
  const runtimeOutputFrameTimeline = buildAudioRuntimeOutputFrameTimeline(runtimeOutputAccumulator);
  const runtimeOutputRegisterIntent = buildAudioRuntimeOutputRegisterIntentModel(runtimeOutputFrameTimeline);
  const runtimeOutputChannelPortIntent = buildAudioRuntimeOutputChannelPortIntentModel(sink);
  return {
    runtimeOutputAccumulator,
    runtimeOutputFrameTimeline,
    runtimeOutputRegisterIntent,
    runtimeOutputChannelPortIntent,
  };
}

function modelMap(sink, derivedModels) {
  return {
    runtime_output_event_sink: sink,
    runtime_output_state_accumulator: derivedModels?.runtimeOutputAccumulator || null,
    runtime_output_frame_timeline: derivedModels?.runtimeOutputFrameTimeline || null,
    runtime_output_register_intent: derivedModels?.runtimeOutputRegisterIntent || null,
    runtime_output_channel_port_intent: derivedModels?.runtimeOutputChannelPortIntent || null,
  };
}

export function validateAudioRuntimeOutputEventContract(sink, derivedModels, eventContractCatalog) {
  const { eventKinds, requiredEventKeys, optionalEventKeys, forbiddenPayloadKeys } = contractEventKeys(eventContractCatalog);
  const allowedKinds = new Set(eventKinds);
  const derivedContracts = eventContractCatalog?.derivedModels || [];
  const summary = {
    catalogBacked: Boolean(eventContractCatalog),
    catalogId: eventContractCatalog?.id || '',
    catalogReady: eventContractCatalog?.summary?.readyForRuntimeHarness === true,
    requiredEventKeyCount: requiredEventKeys.length,
    optionalEventKeyCount: optionalEventKeys.length,
    forbiddenPayloadKeyCount: forbiddenPayloadKeys.length,
    derivedModelCount: derivedContracts.length,
    eventCount: (sink?.events || []).length,
    eventMissingRequiredKeyCount: 0,
    eventForbiddenPayloadKeyCount: 0,
    invalidEventKindCount: 0,
    modelMissingSummaryKeyCount: 0,
    modelForbiddenPayloadKeyCount: 0,
    missingModelCount: 0,
    nonZeroPersistedPayloadCount: 0,
    validationIssueCount: 0,
    readyForRuntimeHarness: false,
    assetPolicy: 'metadata_only_audio_runtime_output_event_contract_validation',
  };
  const issues = [];
  if (!eventContractCatalog) issues.push('audio runtime output event contract catalog missing');

  for (const event of sink?.events || []) {
    const missing = requiredEventKeys.filter(key => !Object.prototype.hasOwnProperty.call(event, key));
    summary.eventMissingRequiredKeyCount += missing.length;
    if (missing.length) issues.push(`event ${event.kind || '?'} missing ${missing.join(',')}`);
    const forbidden = collectForbiddenAudioRuntimeOutputPayloadKeys(event, forbiddenPayloadKeys);
    summary.eventForbiddenPayloadKeyCount += forbidden.length;
    if (forbidden.length) issues.push(`event ${event.kind || '?'} has forbidden payload key(s): ${forbidden.join(',')}`);
    if (allowedKinds.size && !allowedKinds.has(event.kind || '')) {
      summary.invalidEventKindCount++;
      issues.push(`event kind ${event.kind || '?'} is not allowed by contract`);
    }
  }

  const models = modelMap(sink, derivedModels);
  for (const contract of derivedContracts) {
    const model = models[contract.id] || null;
    if (!model) {
      summary.missingModelCount++;
      issues.push(`derived model ${contract.id || '?'} is missing`);
      continue;
    }
    for (const key of contract.requiredSummaryKeys || []) {
      if (!Object.prototype.hasOwnProperty.call(model.summary || {}, key)) {
        summary.modelMissingSummaryKeyCount++;
        issues.push(`derived model ${contract.id || '?'} missing summary ${key}`);
      }
    }
    const forbidden = collectForbiddenAudioRuntimeOutputPayloadKeys(model, forbiddenPayloadKeys);
    summary.modelForbiddenPayloadKeyCount += forbidden.length;
    if (forbidden.length) issues.push(`derived model ${contract.id || '?'} has forbidden payload key(s): ${forbidden.join(',')}`);
    for (const [key, value] of Object.entries(model.summary || {})) {
      if (key.startsWith('persisted') && Number(value || 0) !== 0) {
        summary.nonZeroPersistedPayloadCount += Number(value || 0);
        issues.push(`derived model ${contract.id || '?'} ${key} is ${value}`);
      }
    }
  }

  summary.validationIssueCount = issues.length;
  summary.readyForRuntimeHarness = summary.catalogReady && issues.length === 0;
  return {
    catalog: eventContractCatalog || null,
    summary,
    issues,
  };
}
