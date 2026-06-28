#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import {
  createResidualRuntimeTraceCollector,
  normalizeResidualRuntimeTraceEvents,
  normalizeResidualTraceOffset,
} from '../shared/wb3/residual-runtime-trace-events.js';
import { evaluateResidualRuntimeTracePlans } from '../shared/wb3/residual-runtime-trace-evaluator.js';

assert.equal(normalizeResidualTraceOffset('$1e337'), '0x1E337');
assert.equal(normalizeResidualTraceOffset(0x10718), '0x10718');

const normalized = normalizeResidualRuntimeTraceEvents({
  events: [
    {
      hook_id: 'residual_overlay_cf64_index_read',
      traceId: 'raw-1',
      overlay_record_index: '227',
      computed_record_offset: '$10718',
      debugNote: 'dropped',
    },
    {
      hookId: 'residual_room_overlay_loader_entry',
      sameFrameTraceId: 'raw-1',
      loader_source_region_id: 'r2813',
    },
    {
      hookId: 'residual_runtime_promotion_gate',
      frameTraceId: 'raw-1',
      target_region_id: 'r2813',
      promotion_ready: true,
    },
  ],
}, {
  knownHookIds: [
    'residual_overlay_cf64_index_read',
    'residual_room_overlay_loader_entry',
    'residual_runtime_promotion_gate',
  ],
});
assert.equal(normalized.summary.rawEventCount, 3);
assert.equal(normalized.summary.normalizedEventCount, 3);
assert.equal(normalized.summary.droppedFieldCount, 1);
assert.equal(normalized.events[0].same_frame_trace_id, 'raw-1');
assert.equal(normalized.events[0].computed_record_offset, '0x10718');
assert.equal(normalized.events[0].overlay_record_index, 227);

const collector = createResidualRuntimeTraceCollector({
  tracePrefix: 'smoke',
  knownHookIds: [
    'residual_bank7_sidecar_controller_entry',
    'residual_bank7_alias_loader_call',
    'residual_bank7_sidecar_direct_watch',
    'residual_runtime_promotion_gate',
  ],
});
const traceId = collector.nextTraceId();
const forbiddenEmit = collector.emit('residual_bank7_sidecar_controller_entry', {
  active_bank: 7,
  romBytes: 'forbidden-test-payload',
}, traceId);
assert.equal(forbiddenEmit.event.hookId, undefined);
assert.equal(forbiddenEmit.validationIssues[0].kind, 'forbidden_payload_key');
assert.equal(collector.events().length, 0);
collector.emit('residual_bank7_sidecar_controller_entry', { active_bank: 7 }, traceId);
collector.emit('residual_bank7_alias_loader_call', { source_region_id: 'r2721' }, traceId);
collector.emit('residual_bank7_sidecar_direct_watch', { read_region_id: 'r0749', direct_bank7_consumer: false }, traceId);
collector.emit('residual_runtime_promotion_gate', { target_region_id: 'r0749' }, traceId);
const bundle = collector.bundle({ source: 'synthetic_smoke' });
assert.equal(bundle.events.length, 4);
assert.equal(bundle.events[0].same_frame_trace_id, traceId);

const plan = {
  id: 'residual_runtime_trace_plan_r0749',
  region: { id: 'r0749' },
  classId: 'bank7_entity_sequence_sidecar',
  targetOffsets: ['0x1E337'],
  requiredRuntimeHookIds: [
    'residual_bank7_sidecar_controller_entry',
    'residual_bank7_alias_loader_call',
    'residual_bank7_sidecar_direct_watch',
    'residual_runtime_promotion_gate',
  ],
};
const evaluated = evaluateResidualRuntimeTracePlans([plan], bundle);
assert.equal(evaluated.fieldOrAliasOnlyRejectedCount, 1);

const forbidden = normalizeResidualRuntimeTraceEvents([
  { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'bad', romBytes: [0, 1] },
]);
assert.deepEqual(forbidden.forbiddenPayloadKeys, ['[0].romBytes']);

console.log('residual runtime trace event collector smoke ok');
