#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectForbiddenAudioRuntimeOutputPayloadKeys,
} from '../shared/wb3/audio-runtime-output-events.js';
import {
  buildLocalAudioRuntimeOutputBundle,
  buildLocalAudioRuntimeOutputObservationTemplate,
} from './world-audio-runtime-output-local-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');

const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const template = buildLocalAudioRuntimeOutputObservationTemplate(mapData);
assert.equal(template.templateOnly, true);
assert.equal(template.summary.observationCount, 53);
assert.equal(template.summary.phaseObservationCount, 14);
assert.equal(template.summary.writeObservationCount, 39);
assert.deepEqual(collectForbiddenAudioRuntimeOutputPayloadKeys(template.observations), []);

assert.throws(
  () => buildLocalAudioRuntimeOutputBundle(mapData, template),
  /template input is not runtime evidence/
);
assert.throws(
  () => buildLocalAudioRuntimeOutputBundle(mapData, template, {
    allowTemplateInput: true,
    reviewedRuntimeObservations: true,
  }),
  /templates cannot be marked as reviewed runtime evidence/
);

const phaseObservation = {
  ...template.observations.find(item => item.kind === 'phase'),
  frame: 7,
  activeChannel: 'audio_output_smoke',
  sourceEventKind: 'local_runtime_smoke_phase',
  sourceEventRole: 'runtime_phase_smoke',
  sourceTraceOperationKinds: ['callback_entry'],
  sourceTraceTargetLabels: ['audio_runtime_output_phase'],
};
const writeObservation = {
  ...template.observations.find(item => item.kind === 'write'),
  frame: 7,
  activeChannel: 'audio_output_smoke',
  sourceEventKind: 'local_runtime_smoke_write',
  sourceEventRole: 'runtime_write_smoke',
  sourceTraceOperationKinds: ['port_write_callback'],
  sourceTraceTargetLabels: ['audio_runtime_output_write'],
};
delete phaseObservation.templateIndex;
delete writeObservation.templateIndex;

const bundle = buildLocalAudioRuntimeOutputBundle(mapData, {
  schemaVersion: 1,
  source: 'world-audio-runtime-output-local-bundle-smoke',
  observations: [phaseObservation, writeObservation],
});
assert.equal(bundle.eventKind, 'wb3_audio_runtime_output_local_bundle');
assert.equal(bundle.observationCount, 2);
assert.equal(bundle.emittedEventCount, 2);
assert.equal(bundle.validationIssueCount, 0);
assert.equal(bundle.droppedFieldCount, 0);
assert.equal(bundle.unknownObservationKindCount, 0);
assert.equal(bundle.sinkSummary.phaseEventCount, 1);
assert.equal(bundle.sinkSummary.writeEventCount, 1);
assert.equal(bundle.sinkSummary.rejectedEventCount, 0);
assert.equal(bundle.persistedRegisterValueCount, 0);
assert.equal(bundle.persistedRegisterTraceCount, 0);
assert.equal(bundle.persistedPortValueCount, 0);
assert.equal(bundle.persistedSampleCount, 0);
assert.equal(bundle.persistedAudioByteCount, 0);
assert.equal(bundle.persistedRomByteCount, 0);
assert.deepEqual(collectForbiddenAudioRuntimeOutputPayloadKeys(bundle.events), []);
assert.equal(bundle.validation.eventContractValidation.readyForRuntimeHarness, true);
assert.equal(bundle.derivedModelSummaries.runtime_output_channel_port_intent.writeEventCount, 1);

assert.throws(
  () => buildLocalAudioRuntimeOutputBundle(mapData, {
    observations: [{ ...writeObservation, registerValue: 0 }],
  }),
  /Forbidden audio output payload keys/
);
assert.throws(
  () => buildLocalAudioRuntimeOutputBundle(mapData, {
    observations: [{ ...writeObservation, portValue: 0 }],
  }),
  /Forbidden audio output payload keys/
);
assert.throws(
  () => buildLocalAudioRuntimeOutputBundle(mapData, {
    observations: [{ ...writeObservation, hash: 'not-allowed' }],
  }),
  /Forbidden audio output payload keys/
);

console.log('audio runtime output local bundle smoke ok');
