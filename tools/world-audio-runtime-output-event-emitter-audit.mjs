#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_RUNTIME_OUTPUT_ASSET_POLICY,
  buildAudioRuntimeOutputDerivedModels,
  createAudioRuntimeOutputFixtureEmitter,
  validateAudioRuntimeOutputEventContract,
} from '../shared/wb3/audio-runtime-output-events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-audio-runtime-output-event-emitter-audit.mjs';
const catalogId = 'world-audio-runtime-output-event-emitter-catalog-2026-06-26';
const reportId = 'audio-runtime-output-event-emitter-audit-2026-06-26';
const fixtureCatalogId = 'world-audio-runtime-output-fixture-catalog-2026-06-26';
const eventContractCatalogId = 'world-audio-runtime-output-event-contract-catalog-2026-06-26';
const portCoverageCatalogId = 'world-audio-port-write-coverage-catalog-2026-06-26';
const smokeCommand = 'node tools/world-audio-runtime-output-event-emitter-smoke.mjs';

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
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegion(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean).map(value => String(value)))].sort();
}

function modelSummaries(derivedModels) {
  return {
    runtime_output_event_sink: null,
    runtime_output_state_accumulator: derivedModels.runtimeOutputAccumulator?.summary || null,
    runtime_output_frame_timeline: derivedModels.runtimeOutputFrameTimeline?.summary || null,
    runtime_output_register_intent: derivedModels.runtimeOutputRegisterIntent?.summary || null,
    runtime_output_channel_port_intent: derivedModels.runtimeOutputChannelPortIntent?.summary || null,
  };
}

function buildRegionParticipation(portCoverage) {
  return (portCoverage.coverage?.regionCoverage || []).map(item => ({
    regionId: item.regionId,
    region: item.region,
    writeCount: item.writeCount,
    ports: item.ports || [],
    phaseIds: item.phaseIds || [],
    fixtureIds: item.fixtureIds || [],
    asmLines: item.asmLines || [],
    routineLabels: item.routineLabels || [],
  }));
}

function buildCatalog(mapData) {
  const fixtureCatalog = requireCatalog(mapData, fixtureCatalogId);
  const eventContractCatalog = requireCatalog(mapData, eventContractCatalogId);
  const portCoverage = requireCatalog(mapData, portCoverageCatalogId);
  const emitter = createAudioRuntimeOutputFixtureEmitter(fixtureCatalog, eventContractCatalog, {
    id: 'audio-runtime-output-event-emitter-audit',
    requestId: 'fixture-coverage-audit',
    outputModeFilter: 'all',
  });
  emitter.emitFixtureCatalogCoverage({
    frameStatus: 'fixture_static_coverage',
    activeChannel: 'fixture_coverage',
  });
  const sink = emitter.sink;
  const derivedModels = buildAudioRuntimeOutputDerivedModels(sink);
  const validation = validateAudioRuntimeOutputEventContract(sink, derivedModels, eventContractCatalog);
  const validationIssues = [
    ...(validation.issues || []),
  ];
  if (sink.summary.rejectedEventCount) validationIssues.push(`sink rejected ${sink.summary.rejectedEventCount} event(s) during fixture coverage emission`);
  if (portCoverage.summary?.readyForRuntimeHarness !== true) validationIssues.push(`${portCoverageCatalogId} is not ready`);
  if (fixtureCatalog.summary?.readyForRuntimeHarness !== true) validationIssues.push(`${fixtureCatalogId} is not ready`);
  if (eventContractCatalog.summary?.readyForRuntimeHarness !== true) validationIssues.push(`${eventContractCatalogId} is not ready`);

  const regionParticipation = buildRegionParticipation(portCoverage);
  const channelPort = derivedModels.runtimeOutputChannelPortIntent?.summary || {};

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [fixtureCatalogId, eventContractCatalogId, portCoverageCatalogId],
    sourceModules: ['shared/wb3/audio-runtime-output-events.js'],
    assetPolicy: 'Metadata only: emitter module names, event ids/counts, fixture ids, phase ids, region ids, ASM line numbers, labels, port names, branch ids, validation counts, and derived-model summaries. No ROM bytes, decoded music streams, register values, register traces, port values, audio bytes, samples, or hashes are embedded.',
    target: {
      module: 'shared/wb3/audio-runtime-output-events.js',
      smokeCommand,
      eventKinds: eventContractCatalog.eventContract?.eventKinds || [],
      valuePolicy: eventContractCatalog.eventContract?.valuePolicyField || 'runtime_port_value_not_persisted',
      assetPolicy: AUDIO_RUNTIME_OUTPUT_ASSET_POLICY,
    },
    summary: {
      sourceFixtureCatalogId: fixtureCatalogId,
      sourceEventContractCatalogId: eventContractCatalogId,
      sourcePortCoverageCatalogId: portCoverageCatalogId,
      fixtureCatalogReady: fixtureCatalog.summary?.readyForRuntimeHarness === true,
      eventContractReady: eventContractCatalog.summary?.readyForRuntimeHarness === true,
      portCoverageReady: portCoverage.summary?.readyForRuntimeHarness === true,
      knownPhaseFixtureCount: emitter.knownPhaseFixtureIds.length,
      knownWriteFixtureCount: emitter.knownWriteFixtureIds.length,
      emittedEventCount: sink.summary.eventCount,
      emittedPhaseEventCount: sink.summary.phaseEventCount,
      emittedWriteEventCount: sink.summary.writeEventCount,
      rejectedEventCount: sink.summary.rejectedEventCount,
      selectedPhaseEventCount: sink.summary.selectedPhaseEventCount,
      selectedWriteEventCount: sink.summary.selectedWriteEventCount,
      derivedModelCount: eventContractCatalog.summary?.derivedModelCount || (eventContractCatalog.derivedModels || []).length,
      channelPortGroupCount: channelPort.groupCount || 0,
      psgWriteEventCount: channelPort.psgWriteEventCount || 0,
      fmWriteEventCount: channelPort.fmWriteEventCount || 0,
      mixedWriteEventCount: channelPort.mixedWriteEventCount || 0,
      fmAddressWriteEventCount: channelPort.fmAddressWriteEventCount || 0,
      fmDataWriteEventCount: channelPort.fmDataWriteEventCount || 0,
      psgPortWriteCount: channelPort.portCounts?.Port_PSG || 0,
      portKindCount: channelPort.portKindCount || 0,
      regionParticipationCount: regionParticipation.length,
      eventContractValidationIssueCount: validation.summary.validationIssueCount,
      validationIssueCount: validationIssues.length,
      readyForRuntimeHarness: validationIssues.length === 0 && validation.summary.readyForRuntimeHarness === true,
      rejectsForbiddenPayloadSnapshots: true,
      smokeCommand,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPortValueCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
    },
    derivedModelSummaries: {
      ...modelSummaries(derivedModels),
      runtime_output_event_sink: sink.summary,
    },
    validation: {
      issueCount: validationIssues.length,
      issues: validationIssues,
      eventContractValidation: validation.summary,
    },
    regionParticipation,
    evidence: [
      `${fixtureCatalogId} supplies 14 output phase fixtures and 39 port-write fixtures.`,
      `${eventContractCatalogId} defines required metadata-only event keys and forbidden payload keys for PSG/FM output events.`,
      `${portCoverageCatalogId} proves all 39 ASM sound-chip writes are covered by fixture ids.`,
      'shared/wb3/audio-runtime-output-events.js emits phase/write fixture events without register values, port values, stream bytes, audio bytes, samples, or ROM bytes.',
      'shared/wb3/audio-runtime-output-events.js rejects forbidden payload keys before storing an event.',
      `${smokeCommand} emits synthetic fixture-coverage events for all 14 phases and 39 writes and validates the five derived event models.`,
    ],
    nextLeads: [
      'Wire clean audio runtime PSG/FM output callbacks to createAudioRuntimeOutputFixtureEmitter().emitWrite() using fixture ids.',
      'Emit local metadata-only event bundles while previewing representative music and SFX requests.',
      'Use validated channel/port intent groups to build a PSG/FM register timeline player that computes values locally but does not persist them.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const item of catalog.regionParticipation || []) {
    const region = findRegion(mapData, item.regionId);
    if (!region) {
      missingRegions.push({ id: item.regionId, role: 'audio_runtime_output_event_emitter' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.audioRuntimeOutputEventEmitterAudit = {
      catalogId,
      kind: 'audio_runtime_output_event_emitter',
      confidence: catalog.summary.readyForRuntimeHarness ? 'high' : 'medium',
      module: 'shared/wb3/audio-runtime-output-events.js',
      writeCount: item.writeCount,
      ports: item.ports,
      phaseIds: item.phaseIds,
      fixtureIds: item.fixtureIds,
      asmLines: item.asmLines,
      routineLabels: item.routineLabels,
      eventContractReady: catalog.summary.eventContractReady,
      emitterReady: catalog.summary.readyForRuntimeHarness,
      rejectsForbiddenPayloadSnapshots: catalog.summary.rejectsForbiddenPayloadSnapshots,
      summary: 'Routine participates in the reusable metadata-only PSG/FM output event emitter.',
      evidence: [
        `${catalogId} emits metadata-only audio output events for fixture ids covering this routine.`,
        `${portCoverageCatalogId} matches this routine's ASM line(s) ${item.asmLines.join(', ')} to audio port-write fixtures.`,
        'The shared emitter stores ids, labels, ports, and counts only; runtime register/port values are rejected and not persisted.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      writeCount: item.writeCount,
      ports: item.ports,
    });
  }

  mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
  mapData.audioCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'audio_runtime_output_event_emitter_audit',
    generatedAt: now,
    schemaVersion: 1,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceModules: catalog.sourceModules,
    summary: {
      ...catalog.summary,
      changedRegionCount: changedRegions.length,
      missingRegionCount: missingRegions.length,
    },
    changedRegions,
    missingRegions,
    validation: catalog.validation,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
    assetPolicy: catalog.assetPolicy,
  });
  mapData.updatedAt = now;
  return { changedRegions, missingRegions };
}

function addPrimary(staticMap, group, id) {
  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs[group] = Array.isArray(staticMap.primaryCatalogs[group])
    ? staticMap.primaryCatalogs[group]
    : [];
  if (!staticMap.primaryCatalogs[group].includes(id)) staticMap.primaryCatalogs[group].push(id);
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.audioRuntimeOutputEventEmitterCatalog = catalogId;
  staticMap.summary.audioRuntimeOutputEventEmitterModule = catalog.target.module;
  staticMap.summary.audioRuntimeOutputEventEmitterEvents = catalog.summary.emittedEventCount;
  staticMap.summary.audioRuntimeOutputEventEmitterPhases = catalog.summary.emittedPhaseEventCount;
  staticMap.summary.audioRuntimeOutputEventEmitterWrites = catalog.summary.emittedWriteEventCount;
  staticMap.summary.audioRuntimeOutputEventEmitterKnownPhaseFixtures = catalog.summary.knownPhaseFixtureCount;
  staticMap.summary.audioRuntimeOutputEventEmitterKnownWriteFixtures = catalog.summary.knownWriteFixtureCount;
  staticMap.summary.audioRuntimeOutputEventEmitterValidationIssues = catalog.summary.validationIssueCount;
  staticMap.summary.audioRuntimeOutputEventEmitterReady = catalog.summary.readyForRuntimeHarness;
  staticMap.summary.audioRuntimeOutputEventEmitterRejectsForbidden = catalog.summary.rejectsForbiddenPayloadSnapshots;
  staticMap.summary.audioRuntimeOutputEventEmitterSmokeCommand = catalog.summary.smokeCommand;
  staticMap.summary.audioRuntimeOutputEventEmitterRegionParticipation = catalog.summary.regionParticipationCount;
  staticMap.summary.audioRuntimeOutputEventEmitterPsgPortWrites = catalog.summary.psgPortWriteCount;
  staticMap.summary.audioRuntimeOutputEventEmitterFmAddressWrites = catalog.summary.fmAddressWriteEventCount;
  staticMap.summary.audioRuntimeOutputEventEmitterFmDataWrites = catalog.summary.fmDataWriteEventCount;
  addPrimary(staticMap, 'audio', catalogId);
  addPrimary(staticMap, 'gameplay', catalogId);
  addPrimary(staticMap, 'coverage', catalogId);
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use shared/wb3/audio-runtime-output-events.js as the metadata-only PSG/FM output event emitter before building audible browser playback.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  const smokeLead = `Use ${smokeCommand} to verify all audio output fixtures emit contract-valid metadata events.`;
  if (!staticMap.nextLeads.includes(smokeLead)) staticMap.nextLeads.push(smokeLead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let annotation = { changedRegions: [], missingRegions: [] };
  if (apply) {
    annotation = applyCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    validation: catalog.validation,
    changedRegionCount: annotation.changedRegions.length,
    missingRegionCount: annotation.missingRegions.length,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
  if (catalog.validation.issueCount) process.exitCode = 1;
}

main();
