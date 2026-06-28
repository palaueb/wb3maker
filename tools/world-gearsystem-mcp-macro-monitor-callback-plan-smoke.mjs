#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import {
  buildCallbackCaptureTaskIndex,
  compactHitSnapshot,
} from './world-gearsystem-mcp-macro-monitor.mjs';

const catalog = {
  id: 'world-gearsystem-mcp-callback-capture-plan-catalog-2026-06-26',
  records: [
    {
      regionId: 'r2815',
      tasks: [
        {
          regionId: 'r2815',
          hookId: 'residual_palette_tail_cursor_watch',
          operationKind: 'read_range_breakpoint',
          status: 'reachability_hit_candidate_incomplete_needs_callback_values',
          operationIds: ['read-r2815-8bb9-8bbf'],
          requiredFields: ['active_bank', 'consumer_label', 'cursor_offset'],
          remainingCallbackFields: ['active_bank', 'consumer_label', 'cursor_offset'],
          remainingDerivationFields: [],
          candidateFilledFields: ['access_role', 'cursor_region_id', 'inside_palette_tail_region', 'same_frame_trace_id'],
          candidateOnly: true,
        },
      ],
    },
    {
      regionId: 'r2813',
      tasks: [
        {
          regionId: 'r2813',
          hookId: 'residual_overlay_cf64_index_read',
          operationKind: 'execution_breakpoint',
          status: 'scaffold_ready_waiting_for_execution_hit',
          operationIds: ['exec-11fc-residual_overlay_cf64_index_read-cf64_index_read_instruction'],
          requiredFields: ['_RAM_CF64_', 'active_bank', 'computed_record_offset', 'overlay_record_index', 'same_frame_trace_id'],
          remainingCallbackFields: ['_RAM_CF64_', 'active_bank', 'computed_record_offset', 'overlay_record_index', 'same_frame_trace_id'],
          remainingDerivationFields: [],
          candidateFilledFields: [],
        },
      ],
    },
  ],
};

const index = buildCallbackCaptureTaskIndex(catalog);
assert.equal(index.tasks.length, 2);

const readRangeHit = compactHitSnapshot(
  { atBreakpoint: true, paused: true },
  [],
  'boot_start_idle_probe',
  0,
  1,
  [
    {
      id: 'read-r2815-8bb9-8bbf',
      kind: 'read_range_breakpoint',
      regionIds: ['r2815'],
      source: {
        hookIds: ['residual_palette_tail_cursor_watch'],
        labels: ['residual_palette_tail_cursor_watch'],
        hookBreakpointRoles: ['read_range_watchpoint_adapter'],
        captureFields: ['active_bank', 'consumer_label', 'cursor_offset'],
        requiredCaptureFields: ['active_bank', 'consumer_label', 'cursor_offset'],
        bank: '0x07',
      },
    },
  ],
  index,
);

assert.equal(readRangeHit.matchKind, 'single_active_read_range_breakpoint_inference');
assert.equal(readRangeHit.callbackCapturePlanMatched, true);
assert.equal(readRangeHit.matchedCallbackCaptureTaskCount, 1);
assert.deepEqual(readRangeHit.matchedRemainingCallbackFields, ['active_bank', 'consumer_label', 'cursor_offset']);
assert.equal(readRangeHit.matchedCallbackCaptureTasks[0].candidateOnly, true);

const executionHit = compactHitSnapshot(
  { atBreakpoint: true, paused: true },
  [
    {
      operationId: 'exec-11fc-residual_overlay_cf64_index_read-cf64_index_read_instruction',
      kind: 'execution_breakpoint',
      regionIds: ['r2813'],
      hookIds: ['residual_overlay_cf64_index_read'],
      labels: ['_LABEL_11FC_'],
      hookOffsets: ['0x0011FC'],
      hookBreakpointRoles: ['cf64_index_read_instruction'],
      captureFields: ['_RAM_CF64_', 'active_bank', 'computed_record_offset', 'overlay_record_index', 'same_frame_trace_id'],
      requiredCaptureFields: ['_RAM_CF64_', 'active_bank', 'computed_record_offset', 'overlay_record_index', 'same_frame_trace_id'],
      expectedBank: '0x00',
    },
  ],
  'boot_start_idle_probe',
  0,
  1,
  [],
  index,
);

assert.equal(executionHit.matchKind, 'execution_breakpoint_pc_match');
assert.equal(executionHit.callbackCapturePlanMatched, true);
assert.equal(executionHit.matchedCallbackCaptureTaskCount, 1);
assert.deepEqual(executionHit.matchedRemainingCallbackFields, [
  '_RAM_CF64_',
  'active_bank',
  'computed_record_offset',
  'overlay_record_index',
  'same_frame_trace_id',
]);

console.log('gearsystem MCP macro monitor callback-plan smoke ok');
