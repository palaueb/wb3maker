#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from './world-residual-live-closure-status-index-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapData = JSON.parse(fs.readFileSync(path.join(repoRoot, 'projects/WORLD/map.json'), 'utf8'));
const catalog = buildCatalog(mapData);

assert.equal(catalog.summary.residualRegionCount, 5);
assert.equal(catalog.summary.liveClosureReadyCount, 0);
assert.equal(catalog.summary.waitingForLiveEvidenceCount, 5);
assert.equal(catalog.summary.outputCandidateOnlyCount, 5);
assert.equal(catalog.summary.semanticPromotionReadyCount, 0);
assert.equal(catalog.summary.readRangeHitObservedCount, 4);
assert.equal(catalog.summary.unboundReadRangeHitCount, 1);
assert.deepEqual(catalog.summary.priorityOrderRegionIds, ['r2815', 'r2816', 'r2817', 'r2813', 'r0749']);

const byId = new Map(catalog.records.map(record => [record.region.id, record]));
assert.equal(byId.get('r2813').nextRequiredEvidence, 'capture_cf64_index_and_room_overlay_loader_execution_hooks_same_frame');
assert.equal(byId.get('r2813').readRangeUnbound, true);
assert.equal(byId.get('r2815').nextRequiredEvidence, 'capture_palette_parser_entry_and_physical_source_same_frame');
assert.equal(byId.get('r2816').nextRequiredEvidence, 'capture_palette_parser_entry_and_physical_source_same_frame');
assert.equal(byId.get('r2817').nextRequiredEvidence, 'capture_palette_parser_entry_and_physical_source_same_frame');
assert.equal(byId.get('r0749').nextRequiredEvidence, 'find_route_and_capture_bank7_sidecar_execution_read_hooks_same_frame');
assert.equal(byId.get('r0749').readRangeHitObserved, false);

for (const record of catalog.records) {
  assert.equal(record.closureReady, false);
  assert.equal(record.outputCandidateOnly, true);
  assert.equal(record.semanticPromotionReady, false);
}

console.log('residual live closure status index smoke ok');
