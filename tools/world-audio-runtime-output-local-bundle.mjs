#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const defaultOutputPath = path.join(repoRoot, 'tmp/world-audio-runtime-output-events.local.json');
const defaultTemplatePath = path.join(repoRoot, 'tmp/local-audio-output-observations.template.json');
const toolName = 'tools/world-audio-runtime-output-local-bundle.mjs';
const fixtureCatalogId = 'world-audio-runtime-output-fixture-catalog-2026-06-26';
const eventContractCatalogId = 'world-audio-runtime-output-event-contract-catalog-2026-06-26';

const localForbiddenPayloadKeys = [
  'value',
  'values',
  'payload',
  'payloads',
  'raw',
  'rawValue',
  'rawValues',
  'rawByte',
  'rawBytes',
  'byte',
  'bytes',
  'data',
  'register',
  'registers',
  'trace',
  'traces',
  'snapshot',
  'snapshots',
  'hash',
  'hashes',
  'tileId',
  'tileIds',
  'paletteValue',
  'paletteValues',
  'vdpPortValue',
  'vdpRegisterValue',
  'decodedPixels',
  'pixels',
  'screenshot',
  'screenshots',
  'instructionByte',
  'instructionBytes',
];

const observationFieldKeys = [
  'frame',
  'frameStatus',
  'pc',
  'activeChannel',
  'inputFieldKeys',
  'branchId',
  'selectedByOutputModeFilter',
  'sourceEventKind',
  'sourceEventRole',
  'sourceParserAction',
  'sourceTraceOperationKinds',
  'sourceTraceTargetLabels',
  'sourceRamFieldKeys',
  'sourceUnresolvedRamFieldKeys',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

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
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
}

function observationsFromInput(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  return input.observations || input.events || [];
}

function isTemplateInput(input) {
  return Boolean(input?.templateOnly || input?.eventKind === 'wb3_audio_runtime_output_observation_template');
}

function sourceFromInput(input, inputPath) {
  if (input && typeof input === 'object' && !Array.isArray(input) && input.source) return input.source;
  return inputPath ? path.relative(repoRoot, inputPath) : 'none';
}

function fixtureInputFieldKeys(phaseFixture) {
  return (phaseFixture?.fieldInputRefs || [])
    .map(ref => ref.key || ref.label || '')
    .filter(Boolean)
    .sort();
}

function firstBranchId(fixture) {
  return (fixture?.branchIds || [])[0] || '';
}

function buildPhaseObservationTemplate(phaseFixture, index) {
  return {
    kind: 'phase',
    phaseFixtureId: phaseFixture.id,
    frame: null,
    frameStatus: 'frame_step_linked',
    activeChannel: null,
    inputFieldKeys: fixtureInputFieldKeys(phaseFixture),
    branchId: firstBranchId(phaseFixture),
    selectedByOutputModeFilter: true,
    sourceEventKind: 'local_runtime_audio_output_phase_observation',
    sourceEventRole: 'runtime_audio_output_phase',
    sourceParserAction: '',
    sourceTraceOperationKinds: [],
    sourceTraceTargetLabels: [],
    sourceRamFieldKeys: [],
    sourceUnresolvedRamFieldKeys: [],
    templateIndex: index,
  };
}

function buildWriteObservationTemplate(writeFixture, index) {
  return {
    kind: 'write',
    writeFixtureId: writeFixture.id,
    frame: null,
    frameStatus: 'frame_step_linked',
    activeChannel: null,
    selectedByOutputModeFilter: true,
    sourceEventKind: 'local_runtime_audio_port_write_observation',
    sourceEventRole: 'runtime_audio_port_write',
    sourceParserAction: '',
    sourceTraceOperationKinds: [],
    sourceTraceTargetLabels: [],
    sourceRamFieldKeys: [],
    sourceUnresolvedRamFieldKeys: [],
    templateIndex: index,
  };
}

export function buildLocalAudioRuntimeOutputObservationTemplate(mapData) {
  const fixtureCatalog = requireCatalog(mapData, fixtureCatalogId);
  const eventContract = requireCatalog(mapData, eventContractCatalogId);
  const observations = [];
  (fixtureCatalog.phaseFixtures || []).forEach((phaseFixture, index) => {
    observations.push(buildPhaseObservationTemplate(phaseFixture, observations.length));
    for (const writeId of phaseFixture.writeFixtureIds || []) {
      const writeFixture = (fixtureCatalog.portWriteFixtures || []).find(item => item.id === writeId);
      if (writeFixture) observations.push(buildWriteObservationTemplate(writeFixture, observations.length));
    }
  });
  const phaseObservationCount = observations.filter(item => item.kind === 'phase').length;
  const writeObservationCount = observations.filter(item => item.kind === 'write').length;
  return {
    schemaVersion: 1,
    eventKind: 'wb3_audio_runtime_output_observation_template',
    templateOnly: true,
    generatedBy: toolName,
    sourceCatalogs: [fixtureCatalogId, eventContractCatalogId],
    assetPolicy: 'Metadata-only local audio output observation template. It contains fixture ids, labels by reference, allowed field names, booleans, null placeholders, and command paths only. Do not add ROM bytes, stream bytes, opcodes, register values, port values, register traces, decoded pixels, screenshots, hashes, audio bytes, or samples.',
    valuePolicy: AUDIO_RUNTIME_OUTPUT_VALUE_POLICY,
    instructions: [
      'Copy this template to tmp/local-audio-output-observations.json before filling it with real clean-runtime PSG/FM output observations.',
      'For phase observations, keep phaseFixtureId and fill frame/activeChannel/source metadata when observed.',
      'For write observations, keep writeFixtureId and fill frame/activeChannel/source metadata when observed.',
      'Do not add forbidden payload fields or raw values such as register values, port values, register traces, opcodes, stream bytes, ROM bytes, audio bytes, samples, screenshots, hashes, tile ids, or palette values.',
      'After filling real observations, run: node tools/world-audio-runtime-output-local-bundle.mjs --observations tmp/local-audio-output-observations.json --out tmp/world-audio-runtime-output-events.local.json',
    ],
    summary: {
      observationCount: observations.length,
      phaseObservationCount,
      writeObservationCount,
      fixtureCatalogPhaseCount: (fixtureCatalog.phaseFixtures || []).length,
      fixtureCatalogWriteCount: (fixtureCatalog.portWriteFixtures || []).length,
      eventContractReady: eventContract.summary?.readyForRuntimeHarness === true,
      defaultFilledObservationPath: 'tmp/local-audio-output-observations.json',
      defaultBundleOutputPath: 'tmp/world-audio-runtime-output-events.local.json',
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPortValueCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
      persistedHashCount: 0,
    },
    observations,
  };
}

function collectForbiddenLocalPayloadKeys(value, eventContractCatalog) {
  return [
    ...collectForbiddenAudioRuntimeOutputPayloadKeys(value, eventContractCatalog?.eventContract?.forbiddenPayloadKeys),
    ...collectForbiddenAudioRuntimeOutputPayloadKeys(value, localForbiddenPayloadKeys),
  ].filter((field, index, values) => values.indexOf(field) === index).sort();
}

function observationKind(observation) {
  if (observation?.kind === 'audio_output_phase_fixture' || observation?.kind === 'phase') return 'phase';
  if (observation?.kind === 'audio_port_write_fixture' || observation?.kind === 'write') return 'write';
  if (observation?.phaseFixtureId) return 'phase';
  if (observation?.writeFixtureId) return 'write';
  return 'unknown';
}

function fieldsFromObservation(observation) {
  const fields = {};
  for (const key of observationFieldKeys) {
    if (Object.prototype.hasOwnProperty.call(observation, key)) fields[key] = observation[key];
  }
  return fields;
}

function compactEmitResult(result, index, kind, fixtureId) {
  return {
    index,
    kind,
    fixtureId,
    emitted: Boolean(result.event?.kind),
    droppedFieldCount: result.droppedFields?.length || 0,
    validationIssueCount: result.validationIssues?.length || 0,
    validationIssueKinds: (result.validationIssues || []).map(issue => issue.kind),
    forbiddenPayloadKeys: result.forbiddenPayloadKeys || [],
  };
}

function buildModelSummaries(sink, derivedModels) {
  return {
    runtime_output_event_sink: sink.summary,
    runtime_output_state_accumulator: derivedModels.runtimeOutputAccumulator?.summary || null,
    runtime_output_frame_timeline: derivedModels.runtimeOutputFrameTimeline?.summary || null,
    runtime_output_register_intent: derivedModels.runtimeOutputRegisterIntent?.summary || null,
    runtime_output_channel_port_intent: derivedModels.runtimeOutputChannelPortIntent?.summary || null,
  };
}

export function buildLocalAudioRuntimeOutputBundle(mapData, input, options = {}) {
  if (isTemplateInput(input) && options.reviewedRuntimeObservations) {
    throw new Error('Audio output observation templates cannot be marked as reviewed runtime evidence. Fill real observations, audit them, then bundle with --reviewed-runtime-observations after review.');
  }
  if (isTemplateInput(input) && !options.allowTemplateInput) {
    throw new Error('Audio output observation template input is not runtime evidence. Copy it to tmp/local-audio-output-observations.json, fill it with real metadata-only observations, and rerun the bundler.');
  }

  const fixtureCatalog = requireCatalog(mapData, fixtureCatalogId);
  const eventContract = requireCatalog(mapData, eventContractCatalogId);
  const observations = observationsFromInput(input);
  const forbiddenPayloadKeys = collectForbiddenLocalPayloadKeys(observations, eventContract);
  if (forbiddenPayloadKeys.length) {
    throw new Error(`Forbidden audio output payload keys are not allowed in local observation input: ${forbiddenPayloadKeys.join(', ')}`);
  }

  const emitter = createAudioRuntimeOutputFixtureEmitter(fixtureCatalog, eventContract, {
    id: options.sinkId || 'audio-runtime-output-local-bundle',
    requestId: options.requestId || 'local_audio_output_observations',
    outputModeFilter: options.outputModeFilter || 'all',
  });
  const emitResults = [];
  observations.forEach((observation, index) => {
    const kind = observationKind(observation);
    const fields = fieldsFromObservation(observation);
    let result;
    let fixtureId = '';
    if (kind === 'phase') {
      fixtureId = observation.phaseFixtureId || '';
      result = emitter.emitPhase(fixtureId, fields);
    } else if (kind === 'write') {
      fixtureId = observation.writeFixtureId || '';
      result = emitter.emitWrite(fixtureId, fields);
    } else {
      result = {
        event: {},
        droppedFields: [],
        forbiddenPayloadKeys: [],
        validationIssues: [{ kind: 'unknown_audio_output_observation_kind', index }],
      };
    }
    emitResults.push(compactEmitResult(result, index, kind, fixtureId));
  });

  const sink = emitter.sink;
  const derivedModels = buildAudioRuntimeOutputDerivedModels(sink);
  const validation = validateAudioRuntimeOutputEventContract(sink, derivedModels, eventContract);
  const emitValidationIssueCount = emitResults.reduce((sum, item) => sum + item.validationIssueCount, 0);
  const droppedFieldCount = emitResults.reduce((sum, item) => sum + item.droppedFieldCount, 0);
  const unknownObservationKindCount = emitResults.filter(item => item.validationIssueKinds.includes('unknown_audio_output_observation_kind')).length;
  const validationIssueCount = emitValidationIssueCount + validation.summary.validationIssueCount;
  const reviewedRuntimeObservations = options.reviewedRuntimeObservations === true;

  return {
    schemaVersion: 1,
    eventKind: 'wb3_audio_runtime_output_local_bundle',
    generatedBy: toolName,
    source: options.source || 'local_audio_output_observations',
    localBundleBuilder: toolName,
    sourceCatalogs: [fixtureCatalogId, eventContractCatalogId],
    assetPolicy: 'Metadata-only local audio output event bundle. It stores fixture ids, routine labels, offsets, port names, frame ids, source field names, counts, and validation summaries only. Runtime register values, port values, register traces, opcodes, stream bytes, ROM bytes, audio bytes, samples, screenshots, and hashes are rejected and not persisted.',
    valuePolicy: AUDIO_RUNTIME_OUTPUT_VALUE_POLICY,
    reviewedRuntimeObservations,
    reviewStatus: reviewedRuntimeObservations
      ? 'reviewed_runtime_observations'
      : 'unreviewed_runtime_observations',
    reviewPolicy: 'Set reviewedRuntimeObservations only after a human review confirms the metadata-only observations came from real clean-runtime PSG/FM output callbacks.',
    observationCount: observations.length,
    emittedEventCount: sink.summary.eventCount,
    rejectedEventCount: sink.summary.rejectedEventCount,
    validationIssueCount,
    droppedFieldCount,
    unknownObservationKindCount,
    sinkSummary: sink.summary,
    derivedModelSummaries: buildModelSummaries(sink, derivedModels),
    validation: {
      issueCount: validationIssueCount,
      eventContractValidation: validation.summary,
      issues: validation.issues,
    },
    emitResults,
    events: sink.events,
    rejectedEvents: sink.rejectedEvents,
    persistedRomByteCount: 0,
    persistedStreamByteCount: 0,
    persistedRegisterValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedPortValueCount: 0,
    persistedSampleCount: 0,
    persistedAudioByteCount: 0,
    persistedHashCount: 0,
  };
}

function main() {
  const inputArg = argValue('--observations') || argValue('--input') || argValue('--events');
  const outputArg = argValue('--out');
  const noWrite = process.argv.includes('--no-write');
  const writeTemplate = process.argv.includes('--template');
  const allowTemplateInput = process.argv.includes('--allow-template-input');
  const reviewedRuntimeObservations = process.argv.includes('--reviewed-runtime-observations');
  const inputPath = resolveRepoPath(inputArg);
  const outputPath = resolveRepoPath(outputArg) || (writeTemplate ? defaultTemplatePath : defaultOutputPath);
  const mapData = readJson(mapPath);

  if (writeTemplate) {
    if (reviewedRuntimeObservations) {
      throw new Error('Cannot combine --template with --reviewed-runtime-observations.');
    }
    const template = buildLocalAudioRuntimeOutputObservationTemplate(mapData);
    if (!noWrite) writeJson(outputPath, template);
    console.log(JSON.stringify({
      ok: true,
      output: noWrite ? null : path.relative(repoRoot, outputPath),
      summary: template.summary,
      assetPolicy: template.assetPolicy,
    }, null, 2));
    return;
  }

  if (!inputPath) {
    const template = buildLocalAudioRuntimeOutputObservationTemplate(mapData);
    console.log(JSON.stringify({
      ok: true,
      usage: `${toolName} --observations tmp/local-audio-output-observations.json --out tmp/world-audio-runtime-output-events.local.json`,
      reviewedUsage: `${toolName} --observations tmp/local-audio-output-observations.json --reviewed-runtime-observations --out tmp/world-audio-runtime-output-events.local.json`,
      templateUsage: `${toolName} --template --out tmp/local-audio-output-observations.template.json`,
      defaultOutput: path.relative(repoRoot, defaultOutputPath),
      defaultTemplate: path.relative(repoRoot, defaultTemplatePath),
      summary: template.summary,
      assetPolicy: template.assetPolicy,
    }, null, 2));
    return;
  }

  const input = readJson(inputPath);
  const bundle = buildLocalAudioRuntimeOutputBundle(mapData, input, {
    source: sourceFromInput(input, inputPath),
    allowTemplateInput,
    reviewedRuntimeObservations,
  });

  if (!noWrite) writeJson(outputPath, bundle);
  console.log(JSON.stringify({
    ok: true,
    input: path.relative(repoRoot, inputPath),
    output: noWrite ? null : path.relative(repoRoot, outputPath),
    summary: {
      observationCount: bundle.observationCount,
      emittedEventCount: bundle.emittedEventCount,
      reviewedRuntimeObservations: bundle.reviewedRuntimeObservations,
      reviewStatus: bundle.reviewStatus,
      validationIssueCount: bundle.validationIssueCount,
      droppedFieldCount: bundle.droppedFieldCount,
      unknownObservationKindCount: bundle.unknownObservationKindCount,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPortValueCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
      persistedHashCount: 0,
    },
    emitResults: bundle.emitResults,
  }, null, 2));
  if (bundle.validationIssueCount) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPortValueCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
      persistedHashCount: 0,
    }, null, 2));
    process.exitCode = 1;
  }
}
