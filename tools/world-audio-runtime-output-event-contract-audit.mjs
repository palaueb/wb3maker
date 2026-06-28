#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const panelSimulatorPath = path.join(repoRoot, 'tools/js/panel-simulator.js');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-audio-runtime-output-event-contract-audit.mjs';
const fixtureCatalogId = 'world-audio-runtime-output-fixture-catalog-2026-06-26';
const catalogId = 'world-audio-runtime-output-event-contract-catalog-2026-06-26';
const reportId = 'audio-runtime-output-event-contract-audit-2026-06-26';
const schemaVersion = 1;

const requiredEventKeys = [
  'kind',
  'phaseFixtureId',
  'writeFixtureId',
  'frame',
  'frameStatus',
  'pc',
  'chip',
  'port',
  'activeChannel',
  'inputFieldKeys',
  'branchId',
  'selectedByOutputModeFilter',
  'fixtureCatalogId',
  'sourcePhaseId',
  'sourceRoutineLabel',
  'sourceRoutineOffset',
  'sourceRegionId',
  'sourceEventKind',
  'sourceEventRole',
  'sourceParserAction',
  'sourceTraceOperationKinds',
  'sourceTraceTargetLabels',
  'sourceRamFieldKeys',
  'valuePolicy',
  'assetPolicy',
];

const optionalEventKeys = [
  'sourceUnresolvedRamFieldKeys',
  'writeIndex',
  'asmLine',
  'purpose',
];

const forbiddenPayloadKeys = [
  'romByte',
  'romBytes',
  'streamByte',
  'streamBytes',
  'opcode',
  'opcodes',
  'arg',
  'args',
  'argHex',
  'argsHex',
  'byteHex',
  'encodedHex',
  'registerValue',
  'registerValues',
  'registerTrace',
  'registerTraces',
  'portValue',
  'sample',
  'samples',
  'audioByte',
  'audioBytes',
];

const derivedModels = [
  {
    id: 'runtime_output_event_sink',
    builder: 'zoneAudioCreateRuntimeOutputEventSink',
    emitter: 'zoneAudioEmitRuntimeOutputFixtureEvents',
    windowName: 'zoneAudioLastRuntimeOutputEventSink',
    datasetPrefix: 'zoneAudioPreviewRuntimeOutputSink',
    purpose: 'Collect metadata-only audio_output_phase_fixture and audio_port_write_fixture events emitted during local ROM stream preview.',
    requiredSummaryKeys: [
      'eventCount',
      'phaseEventCount',
      'writeEventCount',
      'selectedPhaseEventCount',
      'selectedWriteEventCount',
      'missingPhaseFixtureCount',
      'missingWriteFixtureCount',
      'frameLinkedEventCount',
      'frameUnlinkedEventCount',
      'persistedRegisterValueCount',
      'persistedRegisterTraceCount',
      'persistedSampleCount',
      'persistedAudioByteCount',
      'persistedRomByteCount',
    ],
  },
  {
    id: 'runtime_output_state_accumulator',
    builder: 'zoneAudioBuildRuntimeOutputStateAccumulator',
    windowName: 'zoneAudioLastRuntimeOutputStateAccumulator',
    datasetPrefix: 'zoneAudioPreviewRuntimeOutputAccumulator',
    purpose: 'Group phase/write fixture events by frame key while retaining only ids, counts, ports, branches, channels, and field keys.',
    requiredSummaryKeys: [
      'eventCount',
      'phaseEventCount',
      'writeEventCount',
      'frameGroupCount',
      'uniquePhaseFixtureCount',
      'uniqueWriteFixtureCount',
      'portKindCount',
      'branchKindCount',
      'inputFieldKeyCount',
      'activeChannelCount',
      'persistedRegisterValueCount',
      'persistedRegisterTraceCount',
      'persistedSampleCount',
      'persistedAudioByteCount',
      'persistedRomByteCount',
    ],
  },
  {
    id: 'runtime_output_frame_timeline',
    builder: 'zoneAudioBuildRuntimeOutputFrameTimeline',
    windowName: 'zoneAudioLastRuntimeOutputFrameTimeline',
    datasetPrefix: 'zoneAudioPreviewRuntimeOutputFrameTimeline',
    purpose: 'Sort accumulated output fixture groups into a metadata-only per-frame timeline for PSG/FM intent checks.',
    requiredSummaryKeys: [
      'frameCount',
      'frameLinkedCount',
      'frameUnlinkedCount',
      'eventCount',
      'phaseEventCount',
      'writeEventCount',
      'psgWriteEventCount',
      'fmWriteEventCount',
      'uniquePhaseFixtureCount',
      'uniqueWriteFixtureCount',
      'persistedRegisterValueCount',
      'persistedRegisterTraceCount',
      'persistedSampleCount',
      'persistedAudioByteCount',
      'persistedRomByteCount',
    ],
  },
  {
    id: 'runtime_output_register_intent',
    builder: 'zoneAudioBuildRuntimeOutputRegisterIntentModel',
    windowName: 'zoneAudioLastRuntimeOutputRegisterIntentModel',
    datasetPrefix: 'zoneAudioPreviewRuntimeOutputRegisterIntent',
    purpose: 'Classify frame groups as PSG-only, FM-only, mixed, or idle without storing register values.',
    requiredSummaryKeys: [
      'frameCount',
      'psgOnlyFrameCount',
      'fmOnlyFrameCount',
      'mixedFrameCount',
      'noWriteFrameCount',
      'writeEventCount',
      'psgWriteEventCount',
      'fmWriteEventCount',
      'uniquePhaseFixtureCount',
      'uniqueWriteFixtureCount',
      'persistedRegisterValueCount',
      'persistedRegisterTraceCount',
      'persistedSampleCount',
      'persistedAudioByteCount',
      'persistedRomByteCount',
    ],
  },
  {
    id: 'runtime_output_channel_port_intent',
    builder: 'zoneAudioBuildRuntimeOutputChannelPortIntentModel',
    windowName: 'zoneAudioLastRuntimeOutputChannelPortIntentModel',
    datasetPrefix: 'zoneAudioPreviewRuntimeOutputChannelPortIntent',
    purpose: 'Group write events by frame, channel, chip, port, and branch so PSG/FM output behavior can be compared without values.',
    requiredSummaryKeys: [
      'groupCount',
      'frameCount',
      'writeEventCount',
      'selectedWriteEventCount',
      'psgWriteEventCount',
      'fmWriteEventCount',
      'fmAddressWriteEventCount',
      'fmDataWriteEventCount',
      'uniquePhaseFixtureCount',
      'uniqueWriteFixtureCount',
      'portKindCount',
      'branchKindCount',
      'inputFieldKeyCount',
      'activeChannelCount',
      'sourceEventKindCount',
      'sourceEventRoleCount',
      'sourceTraceOperationKindCount',
      'sourceRamFieldKeyCount',
      'persistedRegisterValueCount',
      'persistedRegisterTraceCount',
      'persistedSampleCount',
      'persistedAudioByteCount',
      'persistedRomByteCount',
    ],
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
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
  if (!catalog) throw new Error(`Missing required catalog: ${id}`);
  return catalog;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value != null && value !== ''))].sort();
}

function policyZeroChecks(fixtureCatalog) {
  const rows = [];
  const add = (scope, id, item) => {
    const keys = [
      'persistedRomByteCount',
      'persistedStreamByteCount',
      'persistedRegisterValueCount',
      'persistedRegisterTraceCount',
      'persistedSampleCount',
      'persistedAudioByteCount',
    ];
    for (const key of keys) {
      if (item?.[key] == null) continue;
      rows.push({ scope, id, key, value: Number(item[key] || 0) });
    }
  };
  add('fixture_catalog_summary', fixtureCatalog.id, fixtureCatalog.summary || {});
  for (const phase of fixtureCatalog.phaseFixtures || []) add('phase_fixture', phase.id, phase);
  for (const write of fixtureCatalog.portWriteFixtures || []) add('port_write_fixture', write.id, write);
  return rows;
}

function buildCatalog(mapData) {
  const fixtureCatalog = requireCatalog(mapData, fixtureCatalogId);
  const panelSimulatorSource = fs.existsSync(panelSimulatorPath)
    ? fs.readFileSync(panelSimulatorPath, 'utf8')
    : '';
  const fixtureSummary = fixtureCatalog.summary || {};
  const allAllowedKeys = uniqueSorted([
    ...requiredEventKeys,
    ...optionalEventKeys,
  ]);
  const keyOverlap = forbiddenPayloadKeys.filter(key => allAllowedKeys.includes(key));
  const zeroChecks = policyZeroChecks(fixtureCatalog);
  const nonZeroPersisted = zeroChecks.filter(check => check.value !== 0);
  const validationIssues = [
    ...keyOverlap.map(key => `forbidden payload key is also allowed: ${key}`),
    ...nonZeroPersisted.map(check => `${check.scope} ${check.id} ${check.key} is ${check.value}`),
  ];
  if (!fixtureSummary.readyForRuntimeHarness) {
    validationIssues.push(`${fixtureCatalogId} is not ready for runtime harness use`);
  }
  if (Number(fixtureSummary.validationIssueCount || 0) !== 0) {
    validationIssues.push(`${fixtureCatalogId} has ${fixtureSummary.validationIssueCount} validation issue(s)`);
  }
  const analyzerConsumer = {
    sourceFile: 'tools/js/panel-simulator.js',
    validationFunction: 'zoneAudioValidateRuntimeOutputEventContract',
    summaryFunction: 'zoneAudioRuntimeOutputEventContractValidationSummaryHtml',
    windowDiagnostic: 'zoneAudioLastRuntimeOutputEventContractValidation',
    datasetPrefix: 'zoneAudioPreviewRuntimeOutputEventContract',
    requiredSourceMarkers: [
      'zoneAudioValidateRuntimeOutputEventContract',
      'zoneAudioRuntimeOutputEventContractValidationSummaryHtml',
      'zoneAudioLastRuntimeOutputEventContractValidation',
      'zoneAudioPreviewRuntimeOutputEventContractReady',
      'zoneAudioPreviewRuntimeOutputEventContractValidationIssueCount',
    ],
  };
  const missingAnalyzerMarkers = analyzerConsumer.requiredSourceMarkers
    .filter(marker => !panelSimulatorSource.includes(marker));
  if (missingAnalyzerMarkers.length) {
    validationIssues.push(`analyzer event-contract consumer missing markers: ${missingAnalyzerMarkers.join(',')}`);
  }

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [fixtureCatalogId],
    assetPolicy: 'Metadata only: event key names, model names, fixture catalog ids, function names, dataset prefixes, counts, and persistence policy. No ROM bytes, stream bytes, decoded music, PSG/FM register values, port values, register traces, samples, or generated audio are embedded.',
    target: {
      purpose: 'Make the analyzer audio-output callback contract reusable outside the browser smoke tests before implementing an audible SMS PSG/YM2413 runtime.',
      runtimeValuePolicy: 'Runtime output values may exist only in memory during local user ROM previews and must not be written into repository metadata.',
    },
    summary: {
      sourceFixtureCatalogId: fixtureCatalogId,
      fixtureCatalogReady: fixtureSummary.readyForRuntimeHarness === true,
      outputPhaseFixtureCount: Number(fixtureSummary.outputPhaseFixtureCount || 0),
      portWriteFixtureCount: Number(fixtureSummary.portWriteFixtureCount || 0),
      requiredEventKeyCount: requiredEventKeys.length,
      optionalEventKeyCount: optionalEventKeys.length,
      forbiddenPayloadKeyCount: forbiddenPayloadKeys.length,
      derivedModelCount: derivedModels.length,
      derivedModelIds: derivedModels.map(model => model.id),
      analyzerConsumerBacked: missingAnalyzerMarkers.length === 0,
      analyzerConsumerMarkerCount: analyzerConsumer.requiredSourceMarkers.length,
      analyzerConsumerMissingMarkerCount: missingAnalyzerMarkers.length,
      validationIssueCount: validationIssues.length,
      readyForRuntimeHarness: validationIssues.length === 0,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
    },
    eventContract: {
      eventKinds: [
        'audio_output_phase_fixture',
        'audio_port_write_fixture',
      ],
      requiredEventKeys,
      optionalEventKeys,
      forbiddenPayloadKeys,
      valuePolicyField: 'runtime_port_value_not_persisted',
      assetPolicyField: 'metadata_only_runtime_event_ids_no_register_values_or_samples',
      outputModeGate: 'Use audio_output_mode_select ($C232 bit 0) branch ids from the fixture catalog to classify PSG versus FM paths.',
    },
    analyzerConsumer: {
      ...analyzerConsumer,
      status: missingAnalyzerMarkers.length === 0
        ? 'panel_simulator_runtime_preview_validates_contract'
        : 'panel_simulator_runtime_preview_contract_validation_incomplete',
      missingSourceMarkers: missingAnalyzerMarkers,
      evidence: missingAnalyzerMarkers.length === 0
        ? 'tools/js/panel-simulator.js exposes metadata-only runtime output event contract validation in preview dataset fields and a window diagnostic object.'
        : 'tools/js/panel-simulator.js does not yet expose every expected contract validation marker.',
    },
    derivedModels,
    validation: {
      issueCount: validationIssues.length,
      issues: validationIssues,
      forbiddenAllowedKeyOverlap: keyOverlap,
      nonZeroPersistedCounts: nonZeroPersisted,
      readyForRuntimeHarness: validationIssues.length === 0,
    },
    evidence: [
      `${fixtureCatalogId} supplies the 14 output phase fixtures and 39 write fixtures consumed by this event contract.`,
      'tools/js/panel-simulator.js emits audio_output_phase_fixture and audio_port_write_fixture objects through zoneAudioEmitRuntimeOutputFixtureEvents.',
      'tools/js/panel-simulator.js validates runtime output events and derived models against this catalog through zoneAudioValidateRuntimeOutputEventContract.',
      'tools/world-audio-runtime-output-fixture-timeline-browser-smoke.mjs validates the same metadata-only event objects and derived models during full audio-backed zone/inline recipe sweeps.',
    ],
    nextLeads: [
      'Use this catalog as the acceptance contract when adding emulator callbacks for live audio output tracing.',
      'Keep register values, stream bytes, samples, and generated audio out of map metadata; only ids and counts from live user-ROM previews may be summarized.',
      'After runtime callbacks satisfy this contract, connect the event stream to an in-memory SMS PSG/YM2413 emulator.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
  mapData.audioCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'audio_runtime_output_event_contract_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    validation: catalog.validation,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
    assetPolicy: catalog.assetPolicy,
  });
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function applyStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return null;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.audioRuntimeOutputEventContractCatalog = catalogId;
  staticMap.summary.audioRuntimeOutputEventContractRequiredKeys = catalog.summary.requiredEventKeyCount;
  staticMap.summary.audioRuntimeOutputEventContractOptionalKeys = catalog.summary.optionalEventKeyCount;
  staticMap.summary.audioRuntimeOutputEventContractForbiddenKeys = catalog.summary.forbiddenPayloadKeyCount;
  staticMap.summary.audioRuntimeOutputEventContractDerivedModels = catalog.summary.derivedModelCount;
  staticMap.summary.audioRuntimeOutputEventContractAnalyzerConsumerBacked = catalog.summary.analyzerConsumerBacked;
  staticMap.summary.audioRuntimeOutputEventContractAnalyzerConsumerMissingMarkers = catalog.summary.analyzerConsumerMissingMarkerCount;
  staticMap.summary.audioRuntimeOutputEventContractValidationIssues = catalog.summary.validationIssueCount;
  staticMap.summary.audioRuntimeOutputEventContractReady = catalog.summary.readyForRuntimeHarness;

  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  for (const bucket of ['audio', 'gameplay', 'coverage']) {
    staticMap.primaryCatalogs[bucket] = insertAfter(
      staticMap.primaryCatalogs[bucket],
      fixtureCatalogId,
      catalogId
    );
  }

  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  const note = 'Use world-audio-runtime-output-event-contract-catalog-2026-06-26 to validate metadata-only PSG/FM output callback events before connecting an audible browser sound engine.';
  const anchor = staticMap.nextLeads.findIndex(noteText => noteText.includes(fixtureCatalogId));
  if (anchor === -1) staticMap.nextLeads.push(note);
  else staticMap.nextLeads.splice(anchor + 1, 0, note);

  writeJson(staticMapPath, staticMap);
  return {
    staticMapPath: path.relative(repoRoot, staticMapPath),
    summaryFieldsUpdated: [
      'audioRuntimeOutputEventContractCatalog',
      'audioRuntimeOutputEventContractRequiredKeys',
      'audioRuntimeOutputEventContractOptionalKeys',
      'audioRuntimeOutputEventContractForbiddenKeys',
      'audioRuntimeOutputEventContractDerivedModels',
      'audioRuntimeOutputEventContractAnalyzerConsumerBacked',
      'audioRuntimeOutputEventContractAnalyzerConsumerMissingMarkers',
      'audioRuntimeOutputEventContractValidationIssues',
      'audioRuntimeOutputEventContractReady',
    ],
    primaryCatalogBucketsUpdated: ['audio', 'gameplay', 'coverage'],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let staticMapUpdate = null;
  if (apply) {
    applyCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    staticMapUpdate = applyStaticMap(catalog);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    validation: catalog.validation,
    sourceCatalogs: catalog.sourceCatalogs,
    staticMapUpdate,
  }, null, 2));
}

main();
