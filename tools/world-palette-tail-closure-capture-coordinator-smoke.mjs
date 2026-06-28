#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from './world-palette-tail-closure-capture-coordinator-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapData = JSON.parse(fs.readFileSync(path.join(repoRoot, 'projects/WORLD/map.json'), 'utf8'));
const catalog = buildCatalog(mapData);

assert.equal(catalog.summary.targetRegionCount, 3);
assert.equal(catalog.summary.tailHookObservationReadyCount, 3);
assert.equal(catalog.summary.parserCaptureSupportsSameFrameTraceId, true);
assert.equal(catalog.summary.physicalCompareSupportsSameFrameTraceId, true);
assert.equal(catalog.summary.parserEntrySameFrameReadyCount, 0);
assert.equal(catalog.summary.physicalUniqueSourceReadyCount, 0);
assert.equal(catalog.summary.closureReadyCount, 0);
assert.equal(catalog.summary.outputCandidateOnly, true);
assert.ok(catalog.summary.blockedReasons.includes('parser_entry_same_frame_observation_missing'));
assert.ok(catalog.summary.blockedReasons.includes('physical_source_unique_match_missing'));
for (const record of catalog.records) {
  assert.equal(record.capturePlanOnly, true);
  assert.equal(record.tailHookObservationReady, true);
  assert.equal(record.closureReady, false);
  assert.match(record.commands.captureParserEntry, /--same-frame-trace-id <same_frame_trace_id_from_r281[567]_same_frame_tail_read>/);
  assert.match(record.commands.capturePhysicalSource, /physical-source-byte-compare-plan-audit/);
}

console.log('palette tail closure capture coordinator smoke ok');
