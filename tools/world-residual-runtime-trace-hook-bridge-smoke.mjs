#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildResidualRuntimeTraceHookManifest,
  createResidualRuntimeTraceHookBridge,
} from '../shared/wb3/residual-runtime-trace-hooks.js';
import { buildCatalog as buildConfirmationCatalog } from './world-residual-runtime-trace-confirmation-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const eventContractCatalogId = 'world-residual-runtime-trace-event-contract-catalog-2026-06-26';

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const eventContract = findCatalog(mapData, eventContractCatalogId);
assert.ok(eventContract, `missing ${eventContractCatalogId}`);

const manifest = buildResidualRuntimeTraceHookManifest(eventContract);
assert.equal(manifest.readyForCleanRuntimeBridge, true);
assert.equal(manifest.hookCount, 8);
assert.equal(manifest.captureFieldIssues.length, 0);

const bridge = createResidualRuntimeTraceHookBridge(eventContract, { tracePrefix: 'bridge-smoke' });
const traceId = bridge.collector.nextTraceId();
const forbiddenSnapshot = bridge.emitHook('residual_overlay_cf64_index_read', {
  same_frame_trace_id: traceId,
  active_bank: 4,
  _RAM_CF64_: 227,
  overlay_record_index: 227,
  computed_record_offset: '$10718',
  computed_record_end_exclusive: 0x1071a,
  _RAM_D0DE_: 0,
  romBytes: 'forbidden-test-payload',
}, traceId);
assert.equal(forbiddenSnapshot.event.hookId, undefined);
assert.equal(forbiddenSnapshot.validationIssues[0].kind, 'forbidden_payload_key');

bridge.emitHook('residual_overlay_cf64_index_read', {
  same_frame_trace_id: traceId,
  active_bank: 4,
  _RAM_CF64_: 227,
  overlay_record_index: 227,
  computed_record_offset: '$10718',
  computed_record_end_exclusive: 0x1071a,
  _RAM_D0DE_: 0,
}, traceId);
bridge.emitHook('residual_room_overlay_loader_entry', {
  active_bank: 4,
  loader_source_region_id: 'r2813',
  loader_source_offset: '0x10718',
}, traceId);
bridge.emitPromotionGate('r2813', {
  runtime_trace_kind: 'runtime_ram_index_bound_trace',
  direct_consumer_confirmed: true,
  promotion_ready: true,
}, traceId);

const bundle = bridge.bundle({ source: 'synthetic_bridge_smoke' });
assert.equal(bundle.events.length, 3);
assert.equal(bundle.events[0].computed_record_offset, '0x10718');
assert.equal(Object.prototype.hasOwnProperty.call(bundle.events[0], 'romBytes'), false);

const confirmation = buildConfirmationCatalog(mapData, { events: bundle, source: 'synthetic_bridge_smoke' });
assert.equal(confirmation.summary.decisionCounts.confirmed_direct_consumer_ready_for_residual_update, 1);
assert.equal(confirmation.summary.promotionReadyCount, 1);
assert.equal(confirmation.summary.forbiddenPayloadKeyCount, 0);

const unknown = bridge.emitHook('not_a_real_hook', {}, traceId);
assert.equal(unknown.validationIssues[0].kind, 'unknown_hook_id');

console.log('residual runtime trace hook bridge smoke ok');
