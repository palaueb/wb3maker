#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-entity-c3c0-frame-step-trace-catalog-2026-06-25';
const reportId = 'entity-c3c0-frame-step-trace-audit-2026-06-25';
const toolName = 'tools/world-entity-c3c0-frame-step-trace-audit.mjs';

const sourceCatalogIds = {
  frameStepDiagnostic: 'world-entity-c3c0-frame-step-diagnostic-catalog-2026-06-25',
  controlFlow: 'world-entity-c3c0-frame-step-control-flow-catalog-2026-06-25',
};

const timerFieldRoles = new Set([
  'timer_age_counter',
  'variant_aux_parameter',
  'secondary_lifetime_or_start_aux',
  'animation_delay_or_reward_timer',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function findCatalog(mapData, id) {
  for (const [key, value] of Object.entries(mapData)) {
    if (!Array.isArray(value) || !/catalog/i.test(key)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function unique(items) {
  return [...new Set((items || []).filter(item => item !== '' && item != null))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (key === '' || key == null) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function helperStubClass(role) {
  if (/animation/.test(role || '')) return 'animation_helper_stub';
  if (/collision|contact/.test(role || '')) return 'collision_helper_stub';
  if (/velocity|motion|packed/.test(role || '')) return 'motion_helper_stub';
  if (/direction|distance|side/.test(role || '')) return 'steering_helper_stub';
  if (/object_record/.test(role || '')) return 'object_record_helper_stub';
  if (/clear|active/.test(role || '')) return 'slot_lifecycle_helper_stub';
  return 'generic_role_known_helper_stub';
}

function helperStub(call) {
  return {
    stepType: 'helper_stub',
    offset: call.callOffset || '',
    callKind: call.callKind || 'call',
    targetOffset: call.targetOffset || '',
    targetLabel: call.targetLabel || '',
    role: call.role || '',
    stubClass: helperStubClass(call.role || ''),
    resolutionStatus: call.resolutionStatus || '',
    confidence: call.confidence || '',
    executionStatus: 'not_executed_read_only_trace',
    valuePolicy: 'helper_effects_not_evaluated',
    persistedGameplayValueCount: 0,
  };
}

function fieldTouch(operation) {
  return {
    stepType: 'field_touch',
    offset: operation.offset || '',
    kind: operation.kind || '',
    token: operation.token || '',
    fieldRole: operation.fieldRole || '',
    fieldGroup: operation.fieldGroup || '',
    access: operation.access || '',
    bitRole: operation.bitRole || '',
    valuePolicy: operation.valuePolicy || 'no_literal_value_persisted',
    traceStatus: 'touch_recorded_value_not_evaluated',
    persistedGameplayValueCount: 0,
  };
}

function conditionalControl(control) {
  const predicate = control.predicate || {};
  return {
    stepType: 'conditional_control',
    offset: control.offset || '',
    kind: control.kind || '',
    condition: control.condition || '',
    targetOffset: control.targetOffset || '',
    targetRelation: control.targetRelation || '',
    targetInSegment: control.targetInSegment ?? null,
    predicateStatus: predicate.status || '',
    predicateKind: predicate.kind || '',
    predicateToken: predicate.token || '',
    predicateFieldRole: predicate.fieldRole || '',
    predicateBitRole: predicate.bitRole || '',
    helperRole: predicate.helperRole || '',
    helperTargetOffset: predicate.helperTargetOffset || '',
    valuePolicy: predicate.valuePolicy || 'no_literal_value_persisted',
    outcomeStatus: 'not_evaluated_no_runtime_values',
    persistedGameplayValueCount: 0,
  };
}

function traceSortKey(step) {
  const offset = parseHex(step.offset) ?? 0;
  const rank = step.stepType === 'field_touch' ? 0 : step.stepType === 'helper_stub' ? 1 : 2;
  return offset * 10 + rank;
}

function buildTraceSteps(fieldTouches, helperStubs, conditionalControls) {
  return [...fieldTouches, ...helperStubs, ...conditionalControls]
    .sort((a, b) => traceSortKey(a) - traceSortKey(b))
    .map((step, index) => ({
      sequenceIndex: index,
      ...step,
    }));
}

function diagnosticStateByIndex(diagnostic) {
  return new Map((diagnostic.readOnlyDiagnostic?.stateModels || []).map(state => [state.behaviorStateIndex, state]));
}

function firstTickGuardCount(controls) {
  return controls.filter(control =>
    control.predicateKind === 'indexed_field_bit_test' &&
    control.predicateToken === 'IX+32' &&
    control.predicateBitRole === 'high_bit'
  ).length;
}

function buildStateTraceModel(controlState, diagnosticState) {
  const touches = (controlState.fieldOperations || []).map(fieldTouch);
  const helpers = (diagnosticState?.callPlan || []).map(helperStub);
  const controls = [
    ...(controlState.relativeBranches || []).filter(branch => branch.conditional),
    ...(controlState.conditionalExits || []),
  ].map(conditionalControl);
  const traceSteps = buildTraceSteps(touches, helpers, controls);
  const behaviorStateTouches = touches.filter(touch => touch.token === 'IX+32');
  const timerTouches = touches.filter(touch => timerFieldRoles.has(touch.fieldRole));
  const literalWithheldTouches = touches.filter(touch => /withheld/.test(touch.valuePolicy || ''));
  const helperRoleKnownCount = helpers.filter(helper =>
    !/pending|unresolved/i.test(helper.resolutionStatus || '') && helper.role
  ).length;
  const symbolicPredicateCount = controls.filter(control => control.predicateStatus === 'symbolic').length;
  const unresolvedPredicateCount = controls.filter(control => control.predicateStatus !== 'symbolic').length;

  return {
    behaviorStateIndex: controlState.behaviorStateIndex,
    targetOffset: controlState.targetOffset,
    targetRegion: controlState.targetRegion || null,
    controlRole: controlState.controlRole || '',
    modelRole: controlState.modelRole || diagnosticState?.modelRole || '',
    traceStepCount: traceSteps.length,
    fieldTouchCount: touches.length,
    helperStubCount: helpers.length,
    helperRoleKnownCount,
    conditionalControlCount: controls.length,
    symbolicPredicateCount,
    unresolvedPredicateCount,
    behaviorStateFieldTouchCount: behaviorStateTouches.length,
    timerFieldTouchCount: timerTouches.length,
    literalWithheldFieldTouchCount: literalWithheldTouches.length,
    firstTickGuardCount: firstTickGuardCount(controls),
    fieldTokens: unique(touches.map(touch => touch.token)),
    fieldRoles: unique(touches.map(touch => touch.fieldRole)),
    helperRoles: unique(helpers.map(helper => helper.role)),
    predicateKinds: unique(controls.map(control => control.predicateKind)),
    fieldTouchKindCounts: countBy(touches, touch => touch.kind),
    helperStubClassCounts: countBy(helpers, helper => helper.stubClass),
    predicateKindCounts: countBy(controls, control => control.predicateKind),
    traceSteps,
    fieldTouches: touches,
    helperStubs: helpers,
    conditionalControls: controls,
    frameExactStatus: 'trace_skeleton_only_no_runtime_values',
    traceReadinessStatus: unresolvedPredicateCount
      ? 'predicate_source_pending_not_frame_exact'
      : 'read_only_trace_skeleton_ready_not_frame_exact',
    persistedRomByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedTileByteCount: 0,
    persistedPixelCount: 0,
    persistedCoordinateCount: 0,
    persistedGameplayValueCount: 0,
    evidence: [
      `${sourceCatalogIds.controlFlow} supplies ordered field touches and symbolic conditional controls for state ${controlState.behaviorStateIndex}.`,
      `${sourceCatalogIds.frameStepDiagnostic} supplies role-resolved helper call stubs for state ${controlState.behaviorStateIndex}.`,
      'Trace steps store metadata only; helper effects, branch outcomes, and literal values are not evaluated.',
    ],
  };
}

function summarizeStateModels(stateModels, diagnostic, controlFlow) {
  const fieldTouches = stateModels.flatMap(state => state.fieldTouches || []);
  const helperStubs = stateModels.flatMap(state => state.helperStubs || []);
  const controls = stateModels.flatMap(state => state.conditionalControls || []);
  const traceSteps = stateModels.flatMap(state => state.traceSteps || []);
  const unresolvedPredicateCount = stateModels.reduce((sum, state) => sum + state.unresolvedPredicateCount, 0);
  return {
    candidateEntityType: diagnostic.summary?.candidateEntityType || controlFlow.summary?.candidateEntityType || '',
    candidateSeedLabel: diagnostic.summary?.candidateSeedLabel || controlFlow.summary?.candidateSeedLabel || '',
    candidateSeedRegionId: diagnostic.summary?.candidateSeedRegionId || '',
    behaviorListSource: diagnostic.summary?.behaviorListSource || controlFlow.summary?.behaviorListSource || '',
    behaviorStateCount: stateModels.length,
    traceStepCount: traceSteps.length,
    fieldTouchCount: fieldTouches.length,
    helperStubCount: helperStubs.length,
    helperRoleKnownCount: helperStubs.filter(helper => helper.role).length,
    conditionalControlCount: controls.length,
    symbolicPredicateCount: controls.filter(control => control.predicateStatus === 'symbolic').length,
    unresolvedPredicateCount,
    firstTickGuardCount: stateModels.reduce((sum, state) => sum + state.firstTickGuardCount, 0),
    behaviorStateFieldTouchCount: stateModels.reduce((sum, state) => sum + state.behaviorStateFieldTouchCount, 0),
    timerFieldTouchCount: stateModels.reduce((sum, state) => sum + state.timerFieldTouchCount, 0),
    literalWithheldFieldTouchCount: stateModels.reduce((sum, state) => sum + state.literalWithheldFieldTouchCount, 0),
    statesWithHelperStubs: stateModels.filter(state => state.helperStubCount > 0).length,
    statesWithFieldTouches: stateModels.filter(state => state.fieldTouchCount > 0).length,
    statesWithConditionalControls: stateModels.filter(state => state.conditionalControlCount > 0).length,
    statesWithAllSymbolicPredicates: stateModels.filter(state => state.conditionalControlCount === state.symbolicPredicateCount).length,
    fieldTokenCount: unique(fieldTouches.map(touch => touch.token)).length,
    helperRoleCount: unique(helperStubs.map(helper => helper.role)).length,
    predicateKindCount: unique(controls.map(control => control.predicateKind)).length,
    helperStubClassCounts: countBy(helperStubs, helper => helper.stubClass),
    fieldTouchKindCounts: countBy(fieldTouches, touch => touch.kind),
    predicateKindCounts: countBy(controls, control => control.predicateKind),
    frameExactStateCount: 0,
    traceReadinessStatus: unresolvedPredicateCount
      ? 'predicate_source_pending_not_frame_exact'
      : 'read_only_trace_skeleton_ready_not_frame_exact',
    persistedRomByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedTileByteCount: 0,
    persistedPixelCount: 0,
    persistedCoordinateCount: 0,
    persistedGameplayValueCount: 0,
    assetPolicy: 'Metadata only: actor ids, labels, offsets, field tokens, helper roles, symbolic predicate categories, step counts, statuses, and evidence. No ROM bytes, decoded instruction streams, graphics, coordinates, screenshots, music, text, runtime values, or gameplay constants are embedded.',
  };
}

function buildCatalog(mapData) {
  const diagnostic = requireCatalog(mapData, sourceCatalogIds.frameStepDiagnostic);
  const controlFlow = requireCatalog(mapData, sourceCatalogIds.controlFlow);
  const diagnosticByIndex = diagnosticStateByIndex(diagnostic);
  const stateModels = (controlFlow.stateModels || []).map(controlState =>
    buildStateTraceModel(controlState, diagnosticByIndex.get(controlState.behaviorStateIndex))
  );
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    summary: summarizeStateModels(stateModels, diagnostic, controlFlow),
    stateModels,
    evidence: [
      `${sourceCatalogIds.controlFlow} provides symbolic branch and field-touch metadata for actor 0x26.`,
      `${sourceCatalogIds.frameStepDiagnostic} provides helper call plans with role-resolved stubs.`,
      'This trace model is read-only and does not evaluate branch outcomes, helper effects, RAM values, or literal operands.',
    ],
    nextLeads: [
      'Use this trace skeleton in the browser to step actor 0x26 state models with helper stubs and collect field-token touch logs.',
      'Join actor 0x26 room fixtures and dynamic-frame coverage to trace steps that touch animation and behavior-state fields.',
      'Only after runtime behavior is verified, promote specific helper stubs into clean JavaScript modules with documented inputs and outputs.',
    ],
  };
}

function annotateSeedRegion(region, catalog) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.c3c0FrameStepTraceAudit = {
    catalogId,
    kind: 'c3c0_frame_step_read_only_trace_skeleton',
    confidence: catalog.summary.unresolvedPredicateCount ? 'medium' : 'high',
    entityType: catalog.summary.candidateEntityType,
    seedLabel: catalog.summary.candidateSeedLabel,
    behaviorListSource: catalog.summary.behaviorListSource,
    behaviorStateCount: catalog.summary.behaviorStateCount,
    traceStepCount: catalog.summary.traceStepCount,
    fieldTouchCount: catalog.summary.fieldTouchCount,
    helperStubCount: catalog.summary.helperStubCount,
    conditionalControlCount: catalog.summary.conditionalControlCount,
    symbolicPredicateCount: catalog.summary.symbolicPredicateCount,
    unresolvedPredicateCount: catalog.summary.unresolvedPredicateCount,
    traceReadinessStatus: catalog.summary.traceReadinessStatus,
    persistedRomByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedGameplayValueCount: 0,
    summary: `${catalog.summary.candidateEntityType} / ${catalog.summary.candidateSeedLabel} has a metadata-only read-only trace skeleton with ${catalog.summary.traceStepCount} step(s) across ${catalog.summary.behaviorStateCount} behavior state(s).`,
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return regionRef(region);
}

function annotateTargetRegions(mapData, catalog) {
  const byRegion = new Map();
  for (const state of catalog.stateModels || []) {
    const regionId = state.targetRegion?.id;
    if (!regionId) continue;
    if (!byRegion.has(regionId)) byRegion.set(regionId, []);
    byRegion.get(regionId).push(state);
  }
  const annotated = [];
  for (const [regionId, states] of byRegion) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.c3c0FrameStepTraceTargetAudit = {
      catalogId,
      kind: 'c3c0_frame_step_read_only_trace_target_region',
      confidence: states.some(state => state.unresolvedPredicateCount) ? 'medium' : 'high',
      entityType: catalog.summary.candidateEntityType,
      seedLabel: catalog.summary.candidateSeedLabel,
      behaviorStateIndexes: states.map(state => state.behaviorStateIndex),
      targetOffsets: states.map(state => state.targetOffset),
      traceStepCount: states.reduce((sum, state) => sum + state.traceStepCount, 0),
      fieldTouchCount: states.reduce((sum, state) => sum + state.fieldTouchCount, 0),
      helperStubCount: states.reduce((sum, state) => sum + state.helperStubCount, 0),
      conditionalControlCount: states.reduce((sum, state) => sum + state.conditionalControlCount, 0),
      symbolicPredicateCount: states.reduce((sum, state) => sum + state.symbolicPredicateCount, 0),
      unresolvedPredicateCount: states.reduce((sum, state) => sum + state.unresolvedPredicateCount, 0),
      persistedRomByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedGameplayValueCount: 0,
      summary: `${states.length} actor 0x26 state target(s) in this region now have metadata-only frame-step trace skeletons.`,
      evidence: [
        `${catalog.id} maps state target offsets to ordered field-touch/helper/conditional trace skeletons.`,
        'Only offsets, field tokens, role names, symbolic predicate classes, counts, statuses, and evidence are stored.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      region: regionRef(region),
      behaviorStateIndexes: states.map(state => state.behaviorStateIndex),
      targetOffsets: states.map(state => state.targetOffset),
      traceStepCount: states.reduce((sum, state) => sum + state.traceStepCount, 0),
      fieldTouchCount: states.reduce((sum, state) => sum + state.fieldTouchCount, 0),
      helperStubCount: states.reduce((sum, state) => sum + state.helperStubCount, 0),
      conditionalControlCount: states.reduce((sum, state) => sum + state.conditionalControlCount, 0),
    });
  }
  return annotated;
}

function applyCatalog(mapData, catalog) {
  mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityBehaviorCatalogs.push(catalog);

  const seedRegion = (mapData.regions || []).find(region => region.id === catalog.summary.candidateSeedRegionId);
  const annotatedSeedRegion = annotateSeedRegion(seedRegion, catalog);
  const annotatedTargetRegions = annotateTargetRegions(mapData, catalog);

  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_c3c0_frame_step_trace_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedSeedRegionCount: annotatedSeedRegion ? 1 : 0,
      annotatedTargetRegionCount: annotatedTargetRegions.length,
    },
    annotatedSeedRegion,
    annotatedTargetRegions,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (apply) {
    applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    id: catalog.id,
    summary: catalog.summary,
    stateModels: catalog.stateModels.map(state => ({
      behaviorStateIndex: state.behaviorStateIndex,
      targetOffset: state.targetOffset,
      controlRole: state.controlRole,
      traceStepCount: state.traceStepCount,
      fieldTouchCount: state.fieldTouchCount,
      helperStubCount: state.helperStubCount,
      conditionalControlCount: state.conditionalControlCount,
      symbolicPredicateCount: state.symbolicPredicateCount,
      unresolvedPredicateCount: state.unresolvedPredicateCount,
      traceReadinessStatus: state.traceReadinessStatus,
    })),
  }, null, 2));
}

main();
