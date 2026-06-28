#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-player-collision-frame-trace-scaffold-audit.mjs';
const catalogId = 'world-player-collision-frame-trace-scaffold-catalog-2026-06-26';
const reportId = 'player-collision-frame-trace-scaffold-audit-2026-06-26';
const schemaVersion = 1;

const sourceCatalogIds = {
  physicsEffects: 'world-player-physics-state-effect-catalog-2026-06-25',
  physicsFlows: 'world-player-state-physics-flow-catalog-2026-06-25',
  engineReadiness: 'world-player-physics-engine-readiness-catalog-2026-06-26',
  helperParity: 'world-player-physics-helper-parity-catalog-2026-06-26',
  collisionBufferProvenance: 'world-collision-buffer-provenance-catalog-2026-06-25',
  runtimeMechanicIndex: 'world-runtime-mechanic-index-catalog-2026-06-26',
  runtimeRamVariableIndex: 'world-runtime-ram-variable-index-catalog-2026-06-26',
};

const targetLabel = '_LABEL_1446_';
const relatedEffectLabels = [
  '_LABEL_141F_',
  '_LABEL_1446_',
  '_LABEL_1551_',
  '_LABEL_166C_',
  '_LABEL_16D0_',
  '_LABEL_16E2_',
];

const requiredProofFields = [
  'same_frame_trace_id',
  'source_flow_id',
  'component_label',
  'call_line',
  'player_state_slot',
  '_RAM_C260_ state before/after',
  '_RAM_C24F_ form context',
  '_RAM_C241_ state flags before/after',
  'IX+27 contact flags before/after',
  '_RAM_CF8B_ alternate collision flag',
  '_RAM_C271_ bit0 order selector',
  '_RAM_C243_ coordinate_a before/after',
  '_RAM_C246_ coordinate_b before/after',
  '_RAM_C248_ coordinate_a motion before/after',
  '_RAM_C24A_ coordinate_b motion before/after',
  '_RAM_D01A_ collision column bound',
  '_RAM_CB00_ collision-buffer provenance id',
  '_LABEL_141F_ lookup count and coordinate classes',
  '_RAM_D01B_ special collision latch before/after',
  'response_call_sequence labels',
  'runtime_only_no_tile_values_persisted',
];

const forbiddenPersistedFields = [
  'romBytes',
  'decodedTiles',
  'tileValues',
  'collisionCellValues',
  'pixels',
  'screenshots',
  'audioSamples',
  'instructionBytes',
  'registerTracePayloads',
  'hashes',
];

const eventPointSpecs = [
  {
    id: 'collision_pipeline_entry',
    label: '_LABEL_1446_',
    eventKind: 'collision_pipeline_entry',
    asmLineEvidence: [3896, 3905],
    captureFields: [
      'same_frame_trace_id',
      'source_flow_id',
      'component_label',
      'call_line',
      '_RAM_C260_',
      '_RAM_C24F_',
      '_RAM_C241_ before clear',
      'IX+27 before clear',
      '_RAM_D01B_ before clear',
      '_RAM_CF8B_',
      '_RAM_C243_',
      '_RAM_C246_',
      '_RAM_C248_',
      '_RAM_C24A_',
      '_RAM_C271_',
      '_RAM_D01A_',
      '_RAM_CB00_ provenance id only',
    ],
    reason: 'Binds each player-state call site to the collision dispatcher and captures the state cleared before collision response.',
  },
  {
    id: 'collision_path_order_select',
    label: '_LABEL_1446_',
    eventKind: 'collision_path_order_select',
    asmLineEvidence: [3904, 3933],
    captureFields: [
      '_RAM_CF8B_ normal-or-alternate branch',
      '_RAM_C271_ bit0 order selector',
      'selected branch: normal or alternate',
      'selected response call order labels',
      'early return from _LABEL_12F8_',
    ],
    reason: 'Proves whether the frame used the alternate path or the normal coordinate-A/coordinate-B probe order.',
  },
  {
    id: 'collision_probe_span_setup',
    label: '_LABEL_1446_',
    eventKind: 'collision_probe_span_setup',
    asmLineEvidence: [3935, 4054],
    captureFields: [
      '_RAM_D0EE_ probe coordinate scratch',
      '_RAM_D0E0_ probe span count',
      '_RAM_D0F2_ coordinate_a response scratch',
      '_RAM_D01A_ collision bound',
      'probe loop count only',
      '_LABEL_141F_ call count',
    ],
    reason: 'Captures the local probe span setup that leads to coordinate-A collision response without persisting tile/cell values.',
  },
  {
    id: 'collision_tile_lookup_call',
    label: '_LABEL_141F_',
    eventKind: 'collision_tile_lookup_call',
    asmLineEvidence: [3868, 3894],
    captureFields: [
      'lookup_call_sequence_index',
      'coordinate_a_class',
      'coordinate_b_class',
      '_RAM_CB00_ provenance id only',
      'returned_cell_class only',
      'no persisted collision cell value',
    ],
    reason: 'Links collision responses to the decompressed room cell buffer while keeping runtime cell values ephemeral.',
  },
  {
    id: 'coordinate_b_response_entry',
    label: '_LABEL_1551_',
    eventKind: 'coordinate_b_response',
    asmLineEvidence: [4057, 4210],
    captureFields: [
      '_RAM_C246_ before/after',
      '_RAM_C24A_ before/after',
      '_RAM_C241_ flags before/after',
      'IX+27 contact bits 0/1 before/after',
      '_RAM_D0DF_ probe span count',
      '_RAM_D0E1_ hit-found flag',
      '_RAM_D01B_ special collision latch',
      '_LABEL_16D0_ call count',
    ],
    reason: 'Proves coordinate-B collision response, contact flags, motion clearing, and special-tile capture routing.',
  },
  {
    id: 'coordinate_a_response_entry',
    label: '_LABEL_166C_',
    eventKind: 'coordinate_a_response',
    asmLineEvidence: [4212, 4263],
    captureFields: [
      '_RAM_C243_ before/after',
      '_RAM_C248_ before/after',
      '_RAM_C241_ flags before/after',
      'IX+27 contact bits 2/3 before/after',
      '_RAM_D0F2_ coordinate_a scratch',
    ],
    reason: 'Proves coordinate-A collision response and contact flag/motion clearing behavior.',
  },
  {
    id: 'special_tile_capture_entry',
    label: '_LABEL_16D0_',
    eventKind: 'special_tile_capture',
    asmLineEvidence: [4265, 4274],
    captureFields: [
      'special_tile_match boolean',
      '_RAM_D01B_ latch before/after',
      '_RAM_D01C_ coordinate scratch role',
      '_RAM_D01E_ coordinate scratch role',
      'no persisted tile value',
    ],
    reason: 'Confirms whether the special collision tile latch was set without persisting the raw collision cell value.',
  },
  {
    id: 'alternate_collision_entry',
    label: '_LABEL_16E2_',
    eventKind: 'alternate_collision_response',
    asmLineEvidence: [4276, 4347],
    captureFields: [
      '_RAM_CF8B_ alternate branch source',
      '_RAM_C246_ lower-bound clamp before/after',
      '_RAM_C243_ before/after',
      '_RAM_C248_ before/after',
      '_RAM_C24A_ before/after',
      'IX+27 contact bits before/after',
      '_RAM_C24B_ floor guard',
    ],
    reason: 'Captures the alternate collision response path selected when _RAM_CF8B_ is nonzero.',
  },
  {
    id: 'collision_pipeline_exit',
    label: '_LABEL_1446_',
    eventKind: 'collision_pipeline_exit',
    asmLineEvidence: [3919, 3933, 4054, 4347],
    captureFields: [
      '_RAM_C260_ state after caller resumes',
      '_RAM_C241_ state flags after',
      'IX+27 contact flags after',
      '_RAM_C243_ after',
      '_RAM_C246_ after',
      '_RAM_C248_ after',
      '_RAM_C24A_ after',
      '_RAM_D01B_ after',
      'response_call_sequence labels',
    ],
    reason: 'Provides the state snapshot needed to compare the eventual JavaScript pipeline against the original frame behavior.',
  },
  {
    id: 'collision_pipeline_promotion_gate',
    label: 'metadata_gate',
    eventKind: 'engine_port_promotion_gate',
    asmLineEvidence: [],
    captureFields: requiredProofFields,
    reason: 'No collision-pipeline engine port is promoted until entry, path selection, lookup provenance, response helpers, and exit state agree in the same frame.',
  },
];

const requiredRamSpecs = [
  { address: '$C241', symbol: '_RAM_C241_', role: 'player_struct_state_flags', confidence: 'high' },
  { address: '$C243', symbol: '_RAM_C243_', role: 'player_struct_coordinate_word_a', confidence: 'medium' },
  { address: '$C246', symbol: '_RAM_C246_', role: 'player_struct_coordinate_word_b', confidence: 'medium' },
  { address: '$C248', symbol: '_RAM_C248_', role: 'player_struct_motion_word_a', confidence: 'medium_high' },
  { address: '$C24A', symbol: '_RAM_C24A_', role: 'player_struct_motion_word_b', confidence: 'medium_high' },
  { address: '$C24B', symbol: '_RAM_C24B_', role: 'alternate_floor_guard_input', confidence: 'medium' },
  { address: '$C24F', symbol: '_RAM_C24F_', role: 'player_form_context', confidence: 'high' },
  { address: '$C260', symbol: '_RAM_C260_', role: 'player_inner_state', confidence: 'high' },
  { address: '$C271', symbol: '_RAM_C271_', role: 'player_vector_substate_order_selector', confidence: 'high' },
  { address: '$CB00', symbol: '_RAM_CB00_', role: 'dc2_collision_room_cell_buffer_provenance_only', confidence: 'high' },
  { address: '$CF8B', symbol: '_RAM_CF8B_', role: 'alternate_collision_path_flag', confidence: 'medium_high' },
  { address: '$D01A', symbol: '_RAM_D01A_', role: 'collision_lookup_column_bound', confidence: 'medium_high' },
  { address: '$D01B', symbol: '_RAM_D01B_', role: 'special_collision_tile_latch', confidence: 'high' },
  { address: '$D01C', symbol: '_RAM_D01C_', role: 'special_collision_coordinate_a_scratch', confidence: 'medium' },
  { address: '$D01E', symbol: '_RAM_D01E_', role: 'special_collision_coordinate_b_scratch', confidence: 'medium' },
  { address: '$D0DF', symbol: '_RAM_D0DF_', role: 'coordinate_b_probe_span_count_scratch', confidence: 'medium' },
  { address: '$D0E0', symbol: '_RAM_D0E0_', role: 'coordinate_a_probe_span_count_scratch', confidence: 'medium' },
  { address: '$D0E1', symbol: '_RAM_D0E1_', role: 'coordinate_b_probe_hit_found_scratch', confidence: 'medium' },
  { address: '$D0EE', symbol: '_RAM_D0EE_', role: 'coordinate_b_response_probe_scratch', confidence: 'medium' },
  { address: '$D0F0', symbol: '_RAM_D0F0_', role: 'coordinate_b_response_edge_scratch', confidence: 'medium' },
  { address: '$D0F2', symbol: '_RAM_D0F2_', role: 'coordinate_a_response_probe_scratch', confidence: 'medium' },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  return parseInt(value.replace(/^\$/, '0x'), 16);
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value != null && value !== ''))].sort((a, b) => {
    const aNum = parseOffset(a);
    const bNum = parseOffset(b);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    return String(a).localeCompare(String(b));
  });
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
  if (!catalog) throw new Error(`Missing required catalog: ${id}`);
  return catalog;
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findContainingRegion(mapData, offset) {
  if (!Number.isFinite(offset)) return null;
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + Number(region.size || 0);
  }) || null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRamByAddress(mapData, address) {
  const normalized = String(address || '').toUpperCase().replace(/^0X/, '$');
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === normalized) || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function compactRam(entry) {
  if (!entry) return null;
  return {
    id: entry.id || '',
    address: entry.address || '',
    size: Number(entry.size || 0),
    type: entry.type || 'byte',
    name: entry.name || '',
  };
}

function compactEffect(effect) {
  if (!effect) return null;
  return {
    label: effect.label,
    offset: effect.offset,
    role: effect.role,
    category: effect.category,
    confidence: effect.confidence || effect.effectConfidence || '',
    region: effect.region || null,
    calls: effect.calls || [],
  };
}

function buildEventPoint(mapData, spec) {
  const offset = labelOffset(spec.label);
  const region = spec.label === 'metadata_gate' ? null : compactRegion(findContainingRegion(mapData, offset));
  return {
    id: spec.id,
    label: spec.label,
    region,
    offset: Number.isFinite(offset) ? `0x${offset.toString(16).toUpperCase().padStart(5, '0')}` : null,
    eventKind: spec.eventKind,
    asmLineEvidence: spec.asmLineEvidence,
    captureFields: spec.captureFields,
    reason: spec.reason,
    runtimeHookStatus: spec.eventKind === 'engine_port_promotion_gate'
      ? 'metadata_gate_ready_runtime_trace_pending'
      : 'runtime_hook_needed',
    persistencePolicy: {
      storeOnly: 'labels, offsets, call lines, branch names, counts, classifications, and provenance ids',
      forbiddenPersistedFields,
    },
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedRegisterTraceCount: 0,
  };
}

function buildFlowCallsitePlan(flow, eventPointIds) {
  const callSites = [];
  for (const component of flow.components || []) {
    const componentRegion = compactRegion(component.region);
    for (const call of component.physicsCalls || []) {
      if (call.label !== targetLabel) continue;
      callSites.push({
        componentLabel: component.label,
        componentRegion,
        line: call.line,
        op: call.op,
        sequenceIndex: call.sequenceIndex,
        label: call.label,
        role: call.role,
        category: call.category,
      });
    }
  }

  const coOccurringPhysicsCalls = (flow.physicsCalls || [])
    .filter(call => call.label !== targetLabel)
    .map(call => ({
      componentLabel: call.componentLabel,
      line: call.line,
      op: call.op,
      sequenceIndex: call.sequenceIndex,
      label: call.label,
      role: call.role,
      category: call.category,
    }));

  return {
    id: `${flow.flowId}_collision_frame_trace_scaffold`,
    flowId: flow.flowId,
    stateSlot: flow.stateSlot,
    primaryLabel: flow.primaryLabel,
    role: flow.role,
    summary: flow.summary,
    confidence: flow.confidence || 'medium_high',
    componentLabels: flow.componentLabels || [],
    callSites,
    callSiteCount: callSites.length,
    coOccurringPhysicsCalls,
    coOccurringPhysicsCallLabels: uniqueSorted(coOccurringPhysicsCalls.map(call => call.label)),
    transitionTargets: flow.transitionTargets || [],
    transitionWriteCount: (flow.transitionWrites || []).length,
    motionWriteCount: (flow.motionWrites || []).length,
    inputReadCount: (flow.inputReads || []).length,
    environmentFlagReadCount: (flow.environmentFlagReads || []).length,
    contactFlagReadCount: (flow.contactFlagReads || []).length,
    traceEventPointIds: eventPointIds,
    requiredProofFields,
    requiredRamAddresses: requiredRamSpecs.map(spec => spec.address),
    collisionBufferProvenanceRequirement: {
      catalogId: sourceCatalogIds.collisionBufferProvenance,
      requiredRam: '$CB00',
      rule: 'Persist only the collision-buffer provenance id and lookup counts/classes; do not persist cell values or decoded room payload bytes.',
    },
    promotionGate: {
      sameFrameRequired: true,
      runtimeTraceConfirmed: false,
      axisNamingConfirmed: false,
      collisionBufferProvenanceConfirmed: false,
      enginePortReady: false,
      helperParityCatalog: sourceCatalogIds.helperParity,
      coverageChangedByThisAudit: false,
    },
    evidenceCatalogs: Object.values(sourceCatalogIds),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedRegisterTraceCount: 0,
  };
}

function buildCatalog(mapData) {
  const physicsEffects = requireCatalog(mapData, sourceCatalogIds.physicsEffects);
  const physicsFlows = requireCatalog(mapData, sourceCatalogIds.physicsFlows);
  const engineReadiness = requireCatalog(mapData, sourceCatalogIds.engineReadiness);
  for (const id of Object.values(sourceCatalogIds)) requireCatalog(mapData, id);

  const effectsByLabel = new Map((physicsEffects.effects || []).map(effect => [effect.label, effect]));
  const readinessTarget = (engineReadiness.effects || []).find(effect => effect.label === targetLabel) || null;
  const traceEventPoints = eventPointSpecs.map(spec => buildEventPoint(mapData, spec));
  const eventPointIds = traceEventPoints.map(point => point.id);
  const tracePlans = (physicsFlows.flows || [])
    .filter(flow => (flow.physicsCalls || []).some(call => call.label === targetLabel))
    .map(flow => buildFlowCallsitePlan(flow, eventPointIds));
  const flowCallsites = tracePlans.flatMap(plan => plan.callSites.map(site => ({
    flowId: plan.flowId,
    stateSlot: plan.stateSlot,
    primaryLabel: plan.primaryLabel,
    ...site,
  })));
  const requiredRam = requiredRamSpecs.map(spec => ({
    ...spec,
    ram: compactRam(findRamByAddress(mapData, spec.address)),
    capturePolicy: spec.address === '$CB00'
      ? 'provenance_only_no_collision_cell_values'
      : 'runtime_value_may_be_observed_locally_but_not_persisted_in_project_metadata',
  }));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: ASM labels, offsets, line numbers, RAM symbols, flow ids, event names, proof fields, counts, classifications, and provenance ids. No ROM bytes, decoded graphics, screen pixels, audio, collision cell values, runtime register payloads, hashes, or instruction bytes are embedded.',
    target: {
      label: targetLabel,
      effect: compactEffect(effectsByLabel.get(targetLabel)),
      readiness: readinessTarget ? {
        engineReadiness: readinessTarget.engineReadiness,
        blockers: readinessTarget.blockers || [],
        flowUsage: readinessTarget.flowUsage || null,
      } : null,
      reason: 'Convert the existing needs_frame_trace_before_engine_port blocker into concrete same-frame instrumentation targets for the full player collision pipeline.',
    },
    summary: {
      tracePlanCount: tracePlans.length,
      flowCallsiteCount: flowCallsites.length,
      stateSlotCount: uniqueSorted(tracePlans.map(plan => String(plan.stateSlot))).length,
      traceEventPointCount: traceEventPoints.length,
      runtimeHookNeededCount: traceEventPoints.filter(point => point.runtimeHookStatus === 'runtime_hook_needed').length,
      promotionGateCount: traceEventPoints.filter(point => point.runtimeHookStatus === 'metadata_gate_ready_runtime_trace_pending').length,
      requiredRamCount: requiredRam.length,
      requiredRamFoundCount: requiredRam.filter(item => item.ram).length,
      relatedEffectCount: relatedEffectLabels.length,
      relatedEffectsFoundCount: relatedEffectLabels.filter(label => effectsByLabel.has(label)).length,
      coOccurringPhysicsCallCount: tracePlans.reduce((sum, plan) => sum + plan.coOccurringPhysicsCalls.length, 0),
      coOccurringPhysicsCallLabels: uniqueSorted(tracePlans.flatMap(plan => plan.coOccurringPhysicsCallLabels)),
      stateSlots: uniqueSorted(tracePlans.map(plan => String(plan.stateSlot))),
      eventKindCounts: countBy(traceEventPoints, point => point.eventKind),
      runtimeHookStatusCounts: countBy(traceEventPoints, point => point.runtimeHookStatus),
      runtimeTraceConfirmedCount: 0,
      enginePortReady: false,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
      persistedCollisionCellValueCount: 0,
    },
    requiredProofFields,
    forbiddenPersistedFields,
    relatedEffects: relatedEffectLabels.map(label => compactEffect(effectsByLabel.get(label))).filter(Boolean),
    traceEventPoints,
    tracePlans,
    flowCallsites,
    requiredRam,
    validationIssues: [
      ...relatedEffectLabels
        .filter(label => !effectsByLabel.has(label))
        .map(label => ({ severity: 'error', issue: 'missing_related_effect', label })),
      ...requiredRam
        .filter(item => !item.ram)
        .map(item => ({ severity: 'error', issue: 'missing_required_ram', address: item.address, symbol: item.symbol })),
      ...traceEventPoints
        .filter(point => point.label !== 'metadata_gate' && !point.region)
        .map(point => ({ severity: 'error', issue: 'missing_event_point_region', id: point.id, label: point.label })),
    ],
    evidence: [
      `${sourceCatalogIds.physicsEffects} maps ${targetLabel} as player_collision_sweep_dispatch with high-confidence reads, writes, constants, calls, and ASM line evidence.`,
      `${sourceCatalogIds.physicsFlows} records ${tracePlans.length} player state flows and ${flowCallsites.length} call sites that reach ${targetLabel}.`,
      `${sourceCatalogIds.engineReadiness} marks ${targetLabel} as needs_frame_trace_before_engine_port, so this scaffold records proof requirements instead of porting behavior.`,
      `${sourceCatalogIds.collisionBufferProvenance} proves _LABEL_141F_ consumes _RAM_CB00_; this scaffold requires provenance ids and lookup classes, not persisted cell values.`,
      `${sourceCatalogIds.helperParity} confirms the already extracted pure helpers are parity-gated before composed collision behavior is ported.`,
    ],
    nextLeads: [
      'Instrument _LABEL_1446_, _LABEL_141F_, _LABEL_1551_, _LABEL_166C_, _LABEL_16D0_, and _LABEL_16E2_ in a local runtime trace harness using the event ids in this catalog.',
      'Capture at least one same-frame trace for grounded, airborne, vector, and alternate-collision flows before naming coordinate_a/coordinate_b as screen X/Y.',
      'After reviewed runtime traces pass the promotion gate, extract the composed collision pipeline into shared/wb3/player-physics.js and shared/wb3/collision.js with parity fixtures derived from the trace fields.',
    ],
  };
}

function ensureRegionDetail(details, regionId) {
  if (!regionId) return null;
  if (!details.has(regionId)) {
    details.set(regionId, {
      roles: new Set(),
      flowIds: new Set(),
      stateSlots: new Set(),
      componentLabels: new Set(),
      callLines: new Set(),
      eventPointIds: new Set(),
    });
  }
  return details.get(regionId);
}

function annotateRegions(mapData, catalog) {
  const details = new Map();
  const changedRegions = [];
  const missingRegions = [];

  for (const point of catalog.traceEventPoints || []) {
    const detail = ensureRegionDetail(details, point.region?.id);
    if (!detail) continue;
    detail.roles.add(`collision_frame_trace_${point.eventKind}_event_point`);
    detail.eventPointIds.add(point.id);
  }

  for (const effect of catalog.relatedEffects || []) {
    const detail = ensureRegionDetail(details, effect.region?.id);
    if (!detail) continue;
    detail.roles.add(effect.label === targetLabel
      ? 'collision_frame_trace_pipeline_target'
      : 'collision_frame_trace_related_effect');
  }

  for (const plan of catalog.tracePlans || []) {
    for (const site of plan.callSites || []) {
      const detail = ensureRegionDetail(details, site.componentRegion?.id);
      if (!detail) continue;
      detail.roles.add('collision_frame_trace_state_flow_callsite');
      detail.flowIds.add(plan.flowId);
      detail.stateSlots.add(String(plan.stateSlot));
      detail.componentLabels.add(site.componentLabel);
      detail.callLines.add(String(site.line));
      for (const pointId of plan.traceEventPointIds || []) detail.eventPointIds.add(pointId);
    }
  }

  for (const [regionId, detail] of details) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: [...detail.roles].sort().join(',') });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerCollisionFrameTraceScaffoldAudit = {
        catalogId,
        role: [...detail.roles].sort().join(','),
        confidence: 'medium_high',
        summary: 'Region participates in the metadata-only player collision frame-trace scaffold. Runtime traces must prove path selection, collision-buffer provenance, response helper effects, and exit state before the composed collision pipeline is ported.',
        detail: {
          flowIds: uniqueSorted([...detail.flowIds]),
          stateSlots: uniqueSorted([...detail.stateSlots]),
          componentLabels: uniqueSorted([...detail.componentLabels]),
          callLines: uniqueSorted([...detail.callLines]),
          eventPointIds: uniqueSorted([...detail.eventPointIds]),
          requiredProofFields,
          runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
          enginePortReady: catalog.summary.enginePortReady,
          coverageChangedByThisAudit: false,
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      role: [...detail.roles].sort().join(','),
      flowIds: uniqueSorted([...detail.flowIds]),
      eventPointIds: uniqueSorted([...detail.eventPointIds]),
    });
  }

  return { changedRegions, missingRegions };
}

function annotateRam(mapData, catalog) {
  const changedRam = [];
  const missingRam = [];

  for (const spec of catalog.requiredRam || []) {
    const ram = findRamByAddress(mapData, spec.address);
    if (!ram) {
      missingRam.push({ address: spec.address, symbol: spec.symbol, role: spec.role });
      continue;
    }
    if (apply) {
      ram.analysis = ram.analysis || {};
      ram.analysis.playerCollisionFrameTraceScaffoldAudit = {
        catalogId,
        symbol: spec.symbol,
        role: spec.role,
        confidence: spec.confidence,
        summary: 'RAM variable is required by the player collision frame-trace scaffold. Project metadata may store labels, roles, counts, classes, and provenance ids only; runtime values remain local observations.',
        capturePolicy: spec.capturePolicy,
        tracePlanCount: catalog.summary.tracePlanCount,
        traceEventPointCount: catalog.summary.traceEventPointCount,
        runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
        enginePortReady: catalog.summary.enginePortReady,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      id: ram.id,
      address: ram.address,
      name: ram.name || '',
      type: ram.type || 'byte',
      role: spec.role,
      confidence: spec.confidence,
      capturePolicy: spec.capturePolicy,
    });
  }

  return { changedRam, missingRam };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    traceEventPoints: catalog.traceEventPoints.map(point => ({
      id: point.id,
      label: point.label,
      regionId: point.region?.id || null,
      eventKind: point.eventKind,
      runtimeHookStatus: point.runtimeHookStatus,
      captureFieldCount: point.captureFields.length,
    })),
    tracePlans: catalog.tracePlans.map(plan => ({
      id: plan.id,
      flowId: plan.flowId,
      stateSlot: plan.stateSlot,
      primaryLabel: plan.primaryLabel,
      callSiteCount: plan.callSiteCount,
      callLines: plan.callSites.map(site => site.line),
      coOccurringPhysicsCallLabels: plan.coOccurringPhysicsCallLabels,
      transitionWriteCount: plan.transitionWriteCount,
      motionWriteCount: plan.motionWriteCount,
      enginePortReady: plan.promotionGate.enginePortReady,
    })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(item => item.id !== catalogId);
  mapData.playerCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'player_collision_frame_trace_scaffold_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      changedRegionCount: annotation.changedRegions.length,
      changedRamCount: annotation.changedRam.length,
      validationIssueCount: catalog.validationIssues.length,
    },
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    missingRam: annotation.missingRam,
    sample: reportSample(catalog),
    assetPolicy: catalog.assetPolicy,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function applyStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return null;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.playerCollisionFrameTraceScaffoldCatalog = catalogId;
  staticMap.summary.playerCollisionFrameTraceScaffoldPlans = catalog.summary.tracePlanCount;
  staticMap.summary.playerCollisionFrameTraceScaffoldFlowCallsites = catalog.summary.flowCallsiteCount;
  staticMap.summary.playerCollisionFrameTraceScaffoldEventPoints = catalog.summary.traceEventPointCount;
  staticMap.summary.playerCollisionFrameTraceScaffoldRequiredRam = catalog.summary.requiredRamCount;
  staticMap.summary.playerCollisionFrameTraceScaffoldRequiredRamFound = catalog.summary.requiredRamFoundCount;
  staticMap.summary.playerCollisionFrameTraceScaffoldRuntimeConfirmed = catalog.summary.runtimeTraceConfirmedCount;
  staticMap.summary.playerCollisionFrameTraceScaffoldEnginePortReady = catalog.summary.enginePortReady;
  staticMap.summary.playerCollisionFrameTraceScaffoldCoverageChanged = catalog.summary.coverageChangedByThisAudit;

  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.gameplay = insertAfter(
    staticMap.primaryCatalogs.gameplay,
    sourceCatalogIds.helperParity,
    catalogId
  );
  staticMap.primaryCatalogs.coverage = insertAfter(
    staticMap.primaryCatalogs.coverage,
    sourceCatalogIds.helperParity,
    catalogId
  );

  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  const note = 'Use world-player-collision-frame-trace-scaffold-catalog-2026-06-26 to instrument _LABEL_1446_, _LABEL_141F_, _LABEL_1551_, _LABEL_166C_, _LABEL_16D0_, and _LABEL_16E2_ before porting the composed player collision pipeline.';
  const anchor = staticMap.nextLeads.findIndex(noteText => noteText.includes(sourceCatalogIds.helperParity));
  if (anchor === -1) staticMap.nextLeads.push(note);
  else staticMap.nextLeads.splice(anchor + 1, 0, note);

  writeJson(staticMapPath, staticMap);
  return {
    staticMapPath: path.relative(repoRoot, staticMapPath),
    summaryFieldsUpdated: [
      'playerCollisionFrameTraceScaffoldCatalog',
      'playerCollisionFrameTraceScaffoldPlans',
      'playerCollisionFrameTraceScaffoldFlowCallsites',
      'playerCollisionFrameTraceScaffoldEventPoints',
      'playerCollisionFrameTraceScaffoldRequiredRam',
      'playerCollisionFrameTraceScaffoldRequiredRamFound',
      'playerCollisionFrameTraceScaffoldRuntimeConfirmed',
      'playerCollisionFrameTraceScaffoldEnginePortReady',
      'playerCollisionFrameTraceScaffoldCoverageChanged',
    ],
    primaryCatalogBucketsUpdated: ['gameplay', 'coverage'],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const regionAnnotation = annotateRegions(mapData, catalog);
  const ramAnnotation = annotateRam(mapData, catalog);
  const annotation = { ...regionAnnotation, ...ramAnnotation };
  let staticMapUpdate = null;

  if (apply) {
    applyCatalog(mapData, catalog, annotation);
    writeJson(mapPath, mapData);
    staticMapUpdate = applyStaticMap(catalog);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    validationIssues: catalog.validationIssues,
    sample: reportSample(catalog),
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    missingRam: annotation.missingRam,
    staticMapUpdate,
  }, null, 2));
}

main();
