#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import { evaluateResidualRuntimeTracePlans } from '../shared/wb3/residual-runtime-trace-evaluator.js';

const plans = [
  {
    id: 'residual_runtime_trace_plan_r2813',
    region: { id: 'r2813' },
    classId: 'room_overlay_tail',
    targetOffsets: ['0x10718'],
    requiredRuntimeHookIds: [
      'residual_overlay_cf64_index_read',
      'residual_room_overlay_loader_entry',
      'residual_runtime_promotion_gate',
    ],
  },
  {
    id: 'residual_runtime_trace_plan_r2815',
    region: { id: 'r2815' },
    classId: 'post_palette_tail_short_fragment',
    targetOffsets: ['0x1CBB9'],
    requiredRuntimeHookIds: [
      'residual_palette_parser_entry',
      'residual_palette_tail_cursor_watch',
      'residual_runtime_promotion_gate',
    ],
  },
  {
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
  },
];

const noEvents = evaluateResidualRuntimeTracePlans(plans, []);
assert.equal(noEvents.evaluatedPlanCount, 3);
assert.equal(noEvents.runtimeTraceConfirmedCount, 0);
assert.equal(noEvents.statusCounts.runtime_trace_pending_or_insufficient, 3);

const confirmOverlay = evaluateResidualRuntimeTracePlans([plans[0]], [
  { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'f1', overlay_record_index: 227, computed_record_offset: '0x10718' },
  { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'f1', loader_source_region_id: 'r2813' },
  { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'f1', target_region_id: 'r2813' },
]);
assert.equal(confirmOverlay.runtimeTraceConfirmedCount, 1);
assert.equal(confirmOverlay.promotionReadyCount, 1);
assert.equal(confirmOverlay.evaluations[0].finalStatus, 'runtime_trace_confirmed');

const confirmPaletteTailSameBank = evaluateResidualRuntimeTracePlans([plans[1]], [
  { hookId: 'residual_palette_parser_entry', same_frame_trace_id: 'f2', active_bank: 7, palette_script_entry_index: 25 },
  { hookId: 'residual_palette_tail_cursor_watch', same_frame_trace_id: 'f2', active_bank: 7, consumer_label: '_LABEL_919_', cursor_region_id: 'r2815', cursor_offset: '0x1CBB9', access_role: 'direct_consumer', inside_palette_tail_region: true },
  { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'f2', target_region_id: 'r2815' },
]);
assert.equal(confirmPaletteTailSameBank.runtimeTraceConfirmedCount, 1);
assert.equal(confirmPaletteTailSameBank.evaluations[0].finalStatus, 'runtime_trace_confirmed');

const rejectPaletteTailBankAlias = evaluateResidualRuntimeTracePlans([plans[1]], [
  { hookId: 'residual_palette_parser_entry', same_frame_trace_id: 'f3', active_bank: 8, palette_script_entry_index: 25 },
  { hookId: 'residual_palette_tail_cursor_watch', same_frame_trace_id: 'f3', active_bank: 8, consumer_label: '_LABEL_919_', cursor_region_id: 'r2815', cursor_offset: '0x1CBB9', access_role: 'direct_consumer', inside_palette_tail_region: true },
  { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'f3', target_region_id: 'r2815' },
]);
assert.equal(rejectPaletteTailBankAlias.runtimeTraceConfirmedCount, 0);
assert.equal(rejectPaletteTailBankAlias.fieldOrAliasOnlyRejectedCount, 1);
assert.equal(rejectPaletteTailBankAlias.evaluations[0].finalStatus, 'field_or_alias_only_rejected');

const confirmPaletteTailPhysicalRegion = evaluateResidualRuntimeTracePlans([plans[1]], [
  { hookId: 'residual_palette_parser_entry', same_frame_trace_id: 'f4', active_bank: 8, palette_script_entry_index: 25 },
  { hookId: 'residual_palette_tail_cursor_watch', same_frame_trace_id: 'f4', active_bank: 8, physical_rom_region_id: 'r2815', physical_rom_offset: '0x1CBB9', consumer_label: '_LABEL_919_', cursor_region_id: 'r2815', cursor_offset: '0x1CBB9', access_role: 'direct_consumer', inside_palette_tail_region: true },
  { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'f4', target_region_id: 'r2815' },
]);
assert.equal(confirmPaletteTailPhysicalRegion.runtimeTraceConfirmedCount, 1);
assert.equal(confirmPaletteTailPhysicalRegion.evaluations[0].finalStatus, 'runtime_trace_confirmed');

const rejectAlias = evaluateResidualRuntimeTracePlans([plans[2]], [
  { hookId: 'residual_bank7_sidecar_controller_entry', same_frame_trace_id: 'f2', active_bank: 7 },
  { hookId: 'residual_bank7_alias_loader_call', same_frame_trace_id: 'f2', source_region_id: 'r2721' },
  { hookId: 'residual_bank7_sidecar_direct_watch', same_frame_trace_id: 'f2', read_region_id: 'r0749', direct_bank7_consumer: false },
  { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'f2', target_region_id: 'r0749' },
]);
assert.equal(rejectAlias.fieldOrAliasOnlyRejectedCount, 1);
assert.equal(rejectAlias.evaluations[0].finalStatus, 'field_or_alias_only_rejected');

const forbidden = evaluateResidualRuntimeTracePlans([plans[0]], [
  { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'bad', overlay_record_index: 227, computed_record_offset: '0x10718', romBytes: [0, 1] },
  { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'bad', loader_source_region_id: 'r2813' },
  { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'bad', target_region_id: 'r2813' },
]);
assert.equal(forbidden.forbiddenPayloadKeys.length, 1);
assert.equal(forbidden.runtimeTraceConfirmedCount, 0);
assert.equal(forbidden.promotionReadyCount, 0);
assert.equal(forbidden.evaluations[0].finalStatus, 'runtime_trace_rejected_for_forbidden_payload');

console.log('residual runtime trace evaluator smoke ok');
