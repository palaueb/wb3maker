#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from './world-r2813-overlay-closure-observation-assembler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapData = JSON.parse(fs.readFileSync(path.join(repoRoot, 'projects/WORLD/map.json'), 'utf8'));

const missingCatalog = buildCatalog(mapData, {
  observationsInputPath: path.join(repoRoot, 'tmp/world-r2813-overlay-smoke-missing.local.json'),
  observationsPath: path.join(repoRoot, 'tmp/local-hook-observations.r2813-overlay.smoke-missing.local.json'),
});

assert.equal(missingCatalog.summary.outputCandidateOnly, true);
assert.equal(missingCatalog.summary.completeObservationGroupCount, 0);
assert.equal(missingCatalog.summary.readRangeHitObserved, true);
assert.equal(missingCatalog.summary.readRangeUnbound, true);
assert.equal(missingCatalog.summary.currentGateRemainsAuthoritative, true);
assert.ok(missingCatalog.summary.blockedReasons.includes('unbound_read_range_reachability_only_cf64_gate_authoritative'));
assert.equal(missingCatalog.observationAuditSummary.inputHasCandidateOnlyEvidence, true);

const directInputPath = path.join(repoRoot, 'tmp/local-hook-observations.r2813-overlay.smoke-direct.local.json');
fs.mkdirSync(path.dirname(directInputPath), { recursive: true });
fs.writeFileSync(directInputPath, `${JSON.stringify({
  schemaVersion: 1,
  eventKind: 'wb3_r2813_overlay_smoke_observations',
  assetPolicy: 'Metadata-only smoke observations. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are present.',
  observations: [
    {
      hookId: 'residual_overlay_cf64_index_read',
      same_frame_trace_id: 'smoke-r2813-direct',
      active_bank: 4,
      _RAM_CF64_: 227,
      overlay_record_index: 227,
      computed_record_offset: '0x10718',
    },
    {
      hookId: 'residual_room_overlay_loader_entry',
      same_frame_trace_id: 'smoke-r2813-direct',
      active_bank: 4,
      loader_source_region_id: 'r2813',
      loader_source_offset: '0x10718',
    },
  ],
}, null, 2)}\n`);

const directCatalog = buildCatalog(mapData, {
  observationsInputPath: directInputPath,
  observationsPath: path.join(repoRoot, 'tmp/local-hook-observations.r2813-overlay.smoke-direct.out.local.json'),
});

assert.equal(directCatalog.summary.outputCandidateOnly, false);
assert.equal(directCatalog.summary.completeObservationGroupCount, 1);
assert.equal(directCatalog.summary.emittedObservationCount, 3);
assert.equal(directCatalog.records[0].selectorTarget, true);
assert.equal(directCatalog.records[0].loaderTarget, true);
assert.equal(directCatalog.observationAuditSummary.inputUsableAsRuntimeEvidence, true);
assert.equal(directCatalog.observationAuditSummary.confirmationPromotionReadyCount, 1);

console.log('r2813 overlay closure observation assembler smoke ok');
