#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from './world-bank2-vdp-runtime-trace-confirmation-audit.mjs';

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

function runConfirmation(events) {
  return buildCatalog(mapData, { events, source: 'synthetic_smoke' });
}

const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const traceCatalog = findCatalog(mapData, sourceCatalogId);
assert.ok(traceCatalog, `missing ${sourceCatalogId}`);
const [first, second, third] = traceCatalog.tracePlans;
assert.ok(first && second && third);

const selected = runConfirmation([
  { hookId: 'bank2_vdp_978e_renderer_entry', same_frame_trace_id: 'selected' },
  { hookId: 'bank2_vdp_97d9_pointer_list_reader', same_frame_trace_id: 'selected', selected_segment_offset: first.targetBoundaryOffsets[0] },
  { hookId: 'bank2_vdp_97e6_segment_entry', same_frame_trace_id: 'selected', segment_entry_offset: first.targetBoundaryOffsets[0] },
  { hookId: 'bank2_vdp_9812_draw_field_step', same_frame_trace_id: 'selected', segment_entry_offset: first.targetBoundaryOffsets[0], field_offset: first.targetBoundaryOffsets[0], field_role: 'segment_entry_setup', field_is_inside_target_gap: true },
]);
assert.equal(selected.summary.decisionCounts.confirmed_selected_boundary_ready_for_residual_update, 1);
assert.equal(selected.summary.promotionReadyCount, 1);

const fieldOnly = runConfirmation([
  { hookId: 'bank2_vdp_978e_renderer_entry', same_frame_trace_id: 'field-only' },
  { hookId: 'bank2_vdp_97d9_pointer_list_reader', same_frame_trace_id: 'field-only', selected_segment_offset: '0x09F90' },
  { hookId: 'bank2_vdp_97e6_segment_entry', same_frame_trace_id: 'field-only', segment_entry_offset: '0x09F90' },
  { hookId: 'bank2_vdp_9812_draw_field_step', same_frame_trace_id: 'field-only', segment_entry_offset: '0x09F90', field_offset: second.targetBoundaryOffsets[0], field_role: 'tile_word_pair', field_is_inside_target_gap: true },
]);
assert.equal(fieldOnly.summary.decisionCounts.confirmed_field_only_rejection_keep_unpromoted, 1);
assert.equal(fieldOnly.summary.fieldOnlyRejectedCount, 1);

const insufficient = runConfirmation([
  { hookId: 'bank2_vdp_978e_renderer_entry', same_frame_trace_id: 'insufficient' },
]);
assert.equal(insufficient.summary.decisionCounts.pending_insufficient_runtime_evidence, traceCatalog.tracePlans.length);

const forbidden = runConfirmation([
  { hookId: 'bank2_vdp_978e_renderer_entry', same_frame_trace_id: 'bad', streamBytes: [1, 2, 3] },
]);
assert.equal(forbidden.summary.decisionCounts.rejected_for_forbidden_payload, traceCatalog.tracePlans.length);
assert.equal(forbidden.summary.forbiddenPayloadKeyCount, 1);

console.log('bank2 vdp runtime trace confirmation smoke ok');
