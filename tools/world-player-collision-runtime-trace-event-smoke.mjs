#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPlayerCollisionRuntimeTraceCollector,
  evaluatePlayerCollisionRuntimeTracePlans,
  normalizePlayerCollisionRuntimeTraceEvents,
  normalizePlayerCollisionTraceOffset,
} from '../shared/wb3/player-collision-runtime-trace-events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const fixtureCatalogId = 'world-player-collision-runtime-hook-fixture-catalog-2026-06-26';

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

assert.equal(normalizePlayerCollisionTraceOffset('$1446'), '0x01446');
assert.equal(normalizePlayerCollisionTraceOffset(0x166c), '0x0166C');

const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const fixtureCatalog = findCatalog(mapData, fixtureCatalogId);
assert.ok(fixtureCatalog, `missing ${fixtureCatalogId}`);
assert.equal(fixtureCatalog.summary.readyForRuntimeHarness, true);

const knownHookIds = [
  ...fixtureCatalog.hookFixtures.map(hook => hook.sourceHookId),
  ...fixtureCatalog.promotionGateFixtures.map(gate => gate.sourceHookId),
];
const collector = createPlayerCollisionRuntimeTraceCollector({
  tracePrefix: 'collision-smoke',
  knownHookIds,
});
const traceId = collector.nextTraceId();
const firstPlan = fixtureCatalog.planFixtures[0];

const forbidden = collector.emit(fixtureCatalog.hookFixtures[0].sourceHookId, {
  hookFixtureId: fixtureCatalog.hookFixtures[0].id,
  planFixtureIds: [firstPlan.id],
  collisionCellValues: [1, 2, 3],
}, traceId);
assert.equal(forbidden.event.hookId, undefined);
assert.equal(forbidden.validationIssues[0].kind, 'forbidden_payload_key');
assert.equal(collector.events().length, 0);

for (const hook of fixtureCatalog.hookFixtures) {
  collector.emit(hook.sourceHookId, {
    sourceHookId: hook.sourceHookId,
    hookFixtureId: hook.id,
    frame: 12,
    pc: hook.romOffset,
    sourceFamily: hook.sourceFamily,
    flowId: firstPlan.flowId,
    stateSlot: firstPlan.stateSlot,
    eventKind: hook.eventKind,
    capturedFieldNames: hook.captureFields,
    planFixtureIds: [firstPlan.id],
    callLine: firstPlan.callSites[0]?.line,
    componentLabel: firstPlan.callSites[0]?.componentLabel,
    branchClass: hook.eventKind === 'collision_path_order_select' ? 'normal_path_order_a_then_b' : '',
    responseCallSequenceLabels: hook.eventKind === 'collision_pipeline_exit' ? ['_LABEL_1551_', '_LABEL_166C_'] : [],
    lookupCount: hook.eventKind === 'collision_tile_lookup_call' ? 2 : 0,
    coordinateAClass: hook.eventKind === 'collision_tile_lookup_call' ? 'screen_column_class' : '',
    coordinateBClass: hook.eventKind === 'collision_tile_lookup_call' ? 'screen_row_class' : '',
    returnedCellClass: hook.eventKind === 'collision_tile_lookup_call' ? 'solid_or_empty_class_only' : '',
    collisionBufferProvenanceId: 'dc2_room_cell_buffer_provenance_only',
  }, traceId);
}

const gate = fixtureCatalog.promotionGateFixtures[0];
collector.emit(gate.sourceHookId, {
  sourceHookId: gate.sourceHookId,
  hookFixtureId: gate.id,
  frame: 12,
  sourceFamily: gate.sourceFamily,
  flowId: firstPlan.flowId,
  stateSlot: firstPlan.stateSlot,
  eventKind: gate.eventKind,
  capturedFieldNames: gate.requiredEvidence,
  planFixtureIds: [firstPlan.id],
  promotionReady: true,
  axisNamingConfirmed: true,
  collisionBufferProvenanceConfirmed: true,
  enginePortReady: false,
}, traceId);

const bundle = collector.bundle({ source: 'synthetic_player_collision_smoke' });
assert.equal(bundle.events.length, fixtureCatalog.hookFixtures.length + fixtureCatalog.promotionGateFixtures.length);
assert.equal(Object.prototype.hasOwnProperty.call(bundle.events[0], 'collisionCellValues'), false);
assert.equal(bundle.events[0].pc, '0x01446');

const normalized = normalizePlayerCollisionRuntimeTraceEvents({
  events: [
    {
      hook_id: 'collision_pipeline_entry',
      frameTraceId: 'alias-smoke',
      hook_fixture_id: 'player_collision_runtime_hook_fixture_collision_pipeline_entry',
      planIds: [firstPlan.id],
      capturedFields: ['same_frame_trace_id'],
      ignoredDebugField: 'dropped',
    },
  ],
});
assert.equal(normalized.summary.normalizedEventCount, 1);
assert.equal(normalized.summary.droppedFieldCount, 1);
assert.equal(normalized.events[0].same_frame_trace_id, 'alias-smoke');
assert.deepEqual(normalized.events[0].capturedFieldNames, ['same_frame_trace_id']);

const evaluated = evaluatePlayerCollisionRuntimeTracePlans(fixtureCatalog.planFixtures, bundle);
assert.equal(evaluated.forbiddenPayloadKeys.length, 0);
assert.equal(evaluated.statusCounts.same_frame_trace_promotion_ready_for_supplied_events, 1);
assert.equal(evaluated.promotionReadyCount, 1);
assert.equal(evaluated.enginePortReadyCount, 0);
assert.equal(evaluated.evaluations[0].completeTraceIds[0], traceId);

const forbiddenEval = evaluatePlayerCollisionRuntimeTracePlans(fixtureCatalog.planFixtures, [
  { hookId: 'collision_pipeline_entry', same_frame_trace_id: 'bad', romBytes: [0, 1] },
]);
assert.equal(forbiddenEval.forbiddenPayloadKeys[0], '[0].romBytes');
assert.equal(forbiddenEval.statusCounts.runtime_trace_rejected_for_forbidden_payload, fixtureCatalog.planFixtures.length);

console.log('player collision runtime trace event smoke ok');
