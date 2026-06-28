#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_RUNTIME_OUTPUT_ASSET_POLICY,
  AUDIO_RUNTIME_OUTPUT_VALUE_POLICY,
  buildAudioRuntimeOutputDerivedModels,
  collectForbiddenAudioRuntimeOutputPayloadKeys,
  createAudioRuntimeOutputFixtureEmitter,
  validateAudioRuntimeOutputEventContract,
} from '../shared/wb3/audio-runtime-output-events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const fixtureCatalogId = 'world-audio-runtime-output-fixture-catalog-2026-06-26';
const eventContractCatalogId = 'world-audio-runtime-output-event-contract-catalog-2026-06-26';

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  assert.ok(catalog, `missing ${id}`);
  return catalog;
}

const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const fixtureCatalog = requireCatalog(mapData, fixtureCatalogId);
const eventContractCatalog = requireCatalog(mapData, eventContractCatalogId);

const emitter = createAudioRuntimeOutputFixtureEmitter(fixtureCatalog, eventContractCatalog, {
  id: 'audio-runtime-output-emitter-smoke',
  requestId: 'fixture-coverage-smoke',
  outputModeFilter: 'all',
});
emitter.emitFixtureCatalogCoverage({
  frameStatus: 'fixture_static_coverage',
  activeChannel: 'fixture_coverage',
});

const sink = emitter.sink;
assert.equal(sink.summary.eventCount, 53);
assert.equal(sink.summary.phaseEventCount, 14);
assert.equal(sink.summary.writeEventCount, 39);
assert.equal(sink.summary.selectedPhaseEventCount, 14);
assert.equal(sink.summary.selectedWriteEventCount, 39);
assert.equal(sink.summary.missingPhaseFixtureCount, 0);
assert.equal(sink.summary.missingWriteFixtureCount, 0);
assert.equal(sink.summary.rejectedEventCount, 0);
assert.equal(sink.summary.validationIssueCount, 0);
assert.equal(sink.summary.persistedRegisterValueCount, 0);
assert.equal(sink.summary.persistedRegisterTraceCount, 0);
assert.equal(sink.summary.persistedSampleCount, 0);
assert.equal(sink.summary.persistedAudioByteCount, 0);
assert.equal(sink.summary.persistedRomByteCount, 0);
assert.equal(sink.summary.assetPolicy, AUDIO_RUNTIME_OUTPUT_ASSET_POLICY);

for (const event of sink.events) {
  assert.equal(event.valuePolicy, AUDIO_RUNTIME_OUTPUT_VALUE_POLICY);
  assert.equal(event.assetPolicy, AUDIO_RUNTIME_OUTPUT_ASSET_POLICY);
  assert.deepEqual(collectForbiddenAudioRuntimeOutputPayloadKeys(event, eventContractCatalog.eventContract.forbiddenPayloadKeys), []);
}

const derivedModels = buildAudioRuntimeOutputDerivedModels(sink);
const validation = validateAudioRuntimeOutputEventContract(sink, derivedModels, eventContractCatalog);
assert.equal(validation.summary.readyForRuntimeHarness, true);
assert.equal(validation.summary.validationIssueCount, 0);
assert.equal(validation.summary.eventCount, 53);
assert.deepEqual(validation.issues, []);

assert.equal(derivedModels.runtimeOutputAccumulator.summary.uniquePhaseFixtureCount, 14);
assert.equal(derivedModels.runtimeOutputAccumulator.summary.uniqueWriteFixtureCount, 39);
assert.equal(derivedModels.runtimeOutputFrameTimeline.summary.frameCount, 14);
assert.equal(derivedModels.runtimeOutputRegisterIntent.summary.frameCount, 14);
assert.equal(derivedModels.runtimeOutputChannelPortIntent.summary.writeEventCount, 39);
assert.equal(derivedModels.runtimeOutputChannelPortIntent.summary.fmAddressWriteEventCount, 15);
assert.equal(derivedModels.runtimeOutputChannelPortIntent.summary.fmDataWriteEventCount, 13);
assert.equal(derivedModels.runtimeOutputChannelPortIntent.summary.portCounts.Port_PSG, 11);
assert.equal(derivedModels.runtimeOutputChannelPortIntent.summary.portKindCount, 3);

const rejected = emitter.emitWrite(fixtureCatalog.portWriteFixtures[0].id, {
  registerValue: 0,
  frame: 99,
});
assert.equal(rejected.event && Object.keys(rejected.event).length, 0);
assert.deepEqual(rejected.forbiddenPayloadKeys, ['registerValue']);
assert.equal(sink.summary.eventCount, 53);
assert.equal(sink.summary.rejectedEventCount, 1);
assert.equal(sink.summary.validationIssueCount, 1);

console.log('audio runtime output event emitter smoke ok');
