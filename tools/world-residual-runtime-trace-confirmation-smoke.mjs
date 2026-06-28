#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from './world-residual-runtime-trace-confirmation-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const sourceCatalogId = 'world-residual-runtime-trace-hook-plan-catalog-2026-06-26';

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function runConfirmation(events, options = {}) {
  return buildCatalog(mapData, { events, source: 'synthetic_smoke', ...options });
}

const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const traceCatalog = findCatalog(mapData, sourceCatalogId);
assert.ok(traceCatalog, `missing ${sourceCatalogId}`);
assert.equal(traceCatalog.tracePlans.length, 5);

const selected = runConfirmation([
  { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'selected', overlay_record_index: 227, computed_record_offset: '0x10718' },
  { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'selected', loader_source_region_id: 'r2813' },
  { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'selected', target_region_id: 'r2813' },
]);
assert.equal(selected.summary.decisionCounts.confirmed_direct_consumer_ready_for_residual_update, 1);
assert.equal(selected.summary.promotionReadyCount, 1);

const focusedSelected = runConfirmation([
  { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'selected', overlay_record_index: 227, computed_record_offset: '0x10718' },
  { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'selected', loader_source_region_id: 'r2813' },
  { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'selected', target_region_id: 'r2813' },
], { regionIds: ['r2813'] });
assert.deepEqual(focusedSelected.summary.regionFilter, ['r2813']);
assert.equal(focusedSelected.summary.regionFilterApplied, true);
assert.equal(focusedSelected.summary.evaluatedTracePlanCount, 1);
assert.equal(focusedSelected.summary.decisionCount, 1);
assert.equal(focusedSelected.summary.pendingInsufficientCount, 0);
assert.equal(focusedSelected.decisions.length, 1);
assert.equal(focusedSelected.decisions[0].regionId, 'r2813');

const paletteTailSameBank = runConfirmation([
  { hookId: 'residual_palette_parser_entry', same_frame_trace_id: 'palette-same-bank', active_bank: 7, palette_script_entry_index: 25 },
  { hookId: 'residual_palette_tail_cursor_watch', same_frame_trace_id: 'palette-same-bank', active_bank: 7, consumer_label: '_LABEL_919_', cursor_region_id: 'r2815', cursor_offset: '0x1CBB9', access_role: 'direct_consumer', inside_palette_tail_region: true },
  { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'palette-same-bank', target_region_id: 'r2815' },
], { regionIds: ['r2815'] });
assert.equal(paletteTailSameBank.summary.decisionCounts.confirmed_direct_consumer_ready_for_residual_update, 1);
assert.equal(paletteTailSameBank.summary.promotionReadyCount, 1);

const paletteTailBankAlias = runConfirmation([
  { hookId: 'residual_palette_parser_entry', same_frame_trace_id: 'palette-bank-alias', active_bank: 8, palette_script_entry_index: 25 },
  { hookId: 'residual_palette_tail_cursor_watch', same_frame_trace_id: 'palette-bank-alias', active_bank: 8, consumer_label: '_LABEL_919_', cursor_region_id: 'r2815', cursor_offset: '0x1CBB9', access_role: 'direct_consumer', inside_palette_tail_region: true },
  { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'palette-bank-alias', target_region_id: 'r2815' },
], { regionIds: ['r2815'] });
assert.equal(paletteTailBankAlias.summary.decisionCounts.confirmed_field_or_alias_rejection_keep_quarantined, 1);
assert.equal(paletteTailBankAlias.summary.promotionReadyCount, 0);
assert.equal(paletteTailBankAlias.decisions[0].finalStatus, 'field_or_alias_only_rejected');

const paletteTailPhysicalRegion = runConfirmation([
  { hookId: 'residual_palette_parser_entry', same_frame_trace_id: 'palette-physical-region', active_bank: 8, palette_script_entry_index: 25 },
  { hookId: 'residual_palette_tail_cursor_watch', same_frame_trace_id: 'palette-physical-region', active_bank: 8, physical_rom_region_id: 'r2815', physical_rom_offset: '0x1CBB9', consumer_label: '_LABEL_919_', cursor_region_id: 'r2815', cursor_offset: '0x1CBB9', access_role: 'direct_consumer', inside_palette_tail_region: true },
  { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'palette-physical-region', target_region_id: 'r2815' },
], { regionIds: ['r2815'] });
assert.equal(paletteTailPhysicalRegion.summary.decisionCounts.confirmed_direct_consumer_ready_for_residual_update, 1);
assert.equal(paletteTailPhysicalRegion.summary.promotionReadyCount, 1);

const aliasRejected = runConfirmation([
  { hookId: 'residual_bank7_sidecar_controller_entry', same_frame_trace_id: 'alias', active_bank: 7 },
  { hookId: 'residual_bank7_alias_loader_call', same_frame_trace_id: 'alias', source_region_id: 'r2721' },
  { hookId: 'residual_bank7_sidecar_direct_watch', same_frame_trace_id: 'alias', read_region_id: 'r0749', direct_bank7_consumer: false },
  { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'alias', target_region_id: 'r0749' },
]);
assert.equal(aliasRejected.summary.decisionCounts.confirmed_field_or_alias_rejection_keep_quarantined, 1);
assert.equal(aliasRejected.summary.fieldOrAliasOnlyRejectedCount, 1);

const insufficient = runConfirmation([
  { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'insufficient', loader_source_region_id: 'r2813' },
]);
assert.equal(insufficient.summary.decisionCounts.pending_insufficient_runtime_evidence, traceCatalog.tracePlans.length);

const forbidden = runConfirmation([
  { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'bad', overlay_record_index: 227, computed_record_offset: '0x10718', romBytes: [0, 1] },
  { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'bad', loader_source_region_id: 'r2813' },
  { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'bad', target_region_id: 'r2813' },
]);
assert.equal(forbidden.summary.decisionCounts.rejected_for_forbidden_payload, traceCatalog.tracePlans.length);
assert.equal(forbidden.summary.forbiddenPayloadKeyCount, 1);
assert.equal(forbidden.summary.promotionReadyCount, 0);

console.log('residual runtime trace confirmation smoke ok');
