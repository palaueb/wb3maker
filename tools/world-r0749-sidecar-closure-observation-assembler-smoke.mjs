#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from './world-r0749-sidecar-closure-observation-assembler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

const missingInputPath = path.join(repoRoot, 'tmp/world-r0749-sidecar-smoke-missing.local.json');
const missingCatalog = buildCatalog(mapData, {
  observationsInputPath: missingInputPath,
  observationsPath: path.join(repoRoot, 'tmp/local-hook-observations.r0749-sidecar.smoke-missing.local.json'),
});

assert.equal(missingCatalog.summary.outputCandidateOnly, true);
assert.equal(missingCatalog.summary.completeObservationGroupCount, 0);
assert.ok(missingCatalog.summary.blockedReasons.includes('missing_observation_input'));
assert.equal(missingCatalog.observationAuditSummary.inputHasCandidateOnlyEvidence, true);

const directInputPath = path.join(repoRoot, 'tmp/local-hook-observations.r0749-sidecar.smoke-direct.local.json');
fs.mkdirSync(path.dirname(directInputPath), { recursive: true });
fs.writeFileSync(directInputPath, `${JSON.stringify({
  schemaVersion: 1,
  eventKind: 'wb3_r0749_sidecar_smoke_observations',
  assetPolicy: 'Metadata-only smoke observations. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are present.',
  observations: [
    {
      hookId: 'residual_bank7_sidecar_controller_entry',
      same_frame_trace_id: 'smoke-r0749-direct',
      active_bank: 7,
      controller_phase: 'entry',
    },
    {
      hookId: 'residual_bank7_alias_loader_call',
      same_frame_trace_id: 'smoke-r0749-direct',
      active_bank: 7,
      called_loader_label: '_LABEL_8FB_',
      loaded_hl_label: '_DATA_1E337_',
      loaded_hl_offset: '0x1E337',
      source_region_id: 'r0749',
    },
    {
      hookId: 'residual_bank7_sidecar_direct_watch',
      same_frame_trace_id: 'smoke-r0749-direct',
      active_bank: 7,
      consumer_label: '_LABEL_1E200_',
      read_offset: '0x1E337',
      read_region_id: 'r0749',
      access_role: 'direct_consumer',
      direct_bank7_consumer: true,
    },
  ],
}, null, 2)}\n`);

const directCatalog = buildCatalog(mapData, {
  observationsInputPath: directInputPath,
  observationsPath: path.join(repoRoot, 'tmp/local-hook-observations.r0749-sidecar.smoke-direct.out.local.json'),
});

assert.equal(directCatalog.summary.outputCandidateOnly, false);
assert.equal(directCatalog.summary.completeObservationGroupCount, 1);
assert.equal(directCatalog.summary.emittedObservationCount, 4);
assert.equal(directCatalog.records[0].disposition, 'direct_consumer');
assert.equal(directCatalog.observationAuditSummary.inputUsableAsRuntimeEvidence, true);
assert.equal(directCatalog.observationAuditSummary.confirmationPromotionReadyCount, 1);

console.log('r0749 sidecar closure observation assembler smoke ok');
