#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateBank2VdpTracePlans } from '../shared/wb3/bank2-vdp-trace-evaluator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const sourceCatalogId = 'world-bank2-vdp-runtime-trace-hook-plan-catalog-2026-06-26';

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const sourceCatalog = findCatalog(mapData, sourceCatalogId);
assert.ok(sourceCatalog, `missing ${sourceCatalogId}`);

const plans = sourceCatalog.tracePlans.slice(0, 3);
assert.equal(plans.length, 3);

const events = [
  {
    hookId: 'bank2_vdp_978e_renderer_entry',
    same_frame_trace_id: 'selected',
  },
  {
    hookId: 'bank2_vdp_97d9_pointer_list_reader',
    same_frame_trace_id: 'selected',
    selected_segment_offset: plans[0].targetBoundaryOffsets[0],
  },
  {
    hookId: 'bank2_vdp_97e6_segment_entry',
    same_frame_trace_id: 'selected',
    segment_entry_offset: plans[0].targetBoundaryOffsets[0],
  },
  {
    hookId: 'bank2_vdp_9812_draw_field_step',
    same_frame_trace_id: 'selected',
    segment_entry_offset: plans[0].targetBoundaryOffsets[0],
    field_offset: plans[0].targetBoundaryOffsets[0],
    field_role: 'segment_entry_setup',
    field_is_inside_target_gap: true,
  },
  {
    hookId: 'bank2_vdp_978e_renderer_entry',
    same_frame_trace_id: 'field-only',
  },
  {
    hookId: 'bank2_vdp_97d9_pointer_list_reader',
    same_frame_trace_id: 'field-only',
    selected_segment_offset: '0x09F90',
  },
  {
    hookId: 'bank2_vdp_97e6_segment_entry',
    same_frame_trace_id: 'field-only',
    segment_entry_offset: '0x09F90',
  },
  {
    hookId: 'bank2_vdp_9812_draw_field_step',
    same_frame_trace_id: 'field-only',
    segment_entry_offset: '0x09F90',
    field_offset: plans[1].targetBoundaryOffsets[0],
    field_role: 'tile_word_pair',
    field_is_inside_target_gap: true,
  },
  {
    hookId: 'bank2_vdp_978e_renderer_entry',
    same_frame_trace_id: 'insufficient',
  },
];

const evaluation = evaluateBank2VdpTracePlans(plans, events);
assert.equal(evaluation.evaluatedPlanCount, 3);
assert.equal(evaluation.forbiddenPayloadKeys.length, 0);

const byPlan = new Map(evaluation.evaluations.map(item => [item.planId, item]));
assert.equal(byPlan.get(plans[0].id).finalStatus, 'runtime_selected_boundary_confirmed');
assert.equal(byPlan.get(plans[0].id).runtimeTraceConfirmed, true);
assert.equal(byPlan.get(plans[1].id).finalStatus, 'runtime_field_only_boundary_rejected');
assert.equal(byPlan.get(plans[1].id).fieldOnlyRejected, true);
assert.equal(byPlan.get(plans[2].id).finalStatus, 'runtime_trace_pending_or_insufficient');

const forbidden = evaluateBank2VdpTracePlans([plans[0]], [{ ...events[0], streamBytes: [1, 2, 3] }]);
assert.equal(forbidden.evaluations[0].finalStatus, 'runtime_trace_rejected_for_forbidden_payload');
assert.deepEqual(forbidden.forbiddenPayloadKeys, ['0.streamBytes']);

console.log('bank2 vdp runtime trace evaluator smoke ok');
