#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLocalAudioRuntimeOutputBundle,
  buildLocalAudioRuntimeOutputObservationTemplate,
} from './world-audio-runtime-output-local-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-audio-runtime-output-local-bundle-audit.mjs';
const catalogId = 'world-audio-runtime-output-local-bundle-catalog-2026-06-26';
const reportId = 'audio-runtime-output-local-bundle-audit-2026-06-26';
const fixtureCatalogId = 'world-audio-runtime-output-fixture-catalog-2026-06-26';
const eventContractCatalogId = 'world-audio-runtime-output-event-contract-catalog-2026-06-26';
const emitterCatalogId = 'world-audio-runtime-output-event-emitter-catalog-2026-06-26';
const portCoverageCatalogId = 'world-audio-port-write-coverage-catalog-2026-06-26';
const smokeCommand = 'node tools/world-audio-runtime-output-local-bundle-smoke.mjs';

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

function bundleRejects(mapData, observation) {
  try {
    buildLocalAudioRuntimeOutputBundle(mapData, { observations: [observation] });
    return false;
  } catch {
    return true;
  }
}

function buildCatalog(mapData) {
  const fixtureCatalog = requireCatalog(mapData, fixtureCatalogId);
  const eventContract = requireCatalog(mapData, eventContractCatalogId);
  const emitterCatalog = requireCatalog(mapData, emitterCatalogId);
  const portCoverage = requireCatalog(mapData, portCoverageCatalogId);
  const template = buildLocalAudioRuntimeOutputObservationTemplate(mapData);
  const sampleObservations = [
    {
      ...template.observations.find(item => item.kind === 'phase'),
      frame: 0,
      activeChannel: 'audit_sample',
      sourceEventKind: 'local_bundle_audit_phase_sample',
      sourceEventRole: 'runtime_phase_sample',
    },
    {
      ...template.observations.find(item => item.kind === 'write'),
      frame: 0,
      activeChannel: 'audit_sample',
      sourceEventKind: 'local_bundle_audit_write_sample',
      sourceEventRole: 'runtime_write_sample',
    },
  ].map(item => {
    const copy = { ...item };
    delete copy.templateIndex;
    return copy;
  });
  const sampleBundle = buildLocalAudioRuntimeOutputBundle(mapData, {
    schemaVersion: 1,
    source: 'world-audio-runtime-output-local-bundle-audit-sample',
    observations: sampleObservations,
  });
  const templateRejected = (() => {
    try {
      buildLocalAudioRuntimeOutputBundle(mapData, template);
      return false;
    } catch {
      return true;
    }
  })();
  const reviewedTemplateRejected = (() => {
    try {
      buildLocalAudioRuntimeOutputBundle(mapData, template, {
        allowTemplateInput: true,
        reviewedRuntimeObservations: true,
      });
      return false;
    } catch {
      return true;
    }
  })();
  const rejectsRegisterValue = bundleRejects(mapData, { ...sampleObservations[1], registerValue: 0 });
  const rejectsPortValue = bundleRejects(mapData, { ...sampleObservations[1], portValue: 0 });
  const rejectsHash = bundleRejects(mapData, { ...sampleObservations[1], hash: 'not-allowed' });
  const regionParticipation = buildRegionParticipation(portCoverage);
  const validationIssues = [];
  if (fixtureCatalog.summary?.readyForRuntimeHarness !== true) validationIssues.push(`${fixtureCatalogId} is not ready`);
  if (eventContract.summary?.readyForRuntimeHarness !== true) validationIssues.push(`${eventContractCatalogId} is not ready`);
  if (emitterCatalog.summary?.readyForRuntimeHarness !== true) validationIssues.push(`${emitterCatalogId} is not ready`);
  if (portCoverage.summary?.readyForRuntimeHarness !== true) validationIssues.push(`${portCoverageCatalogId} is not ready`);
  if (template.summary.observationCount !== 53) validationIssues.push('template does not cover all 53 phase/write fixture observations');
  if (sampleBundle.validationIssueCount !== 0) validationIssues.push(`sample local bundle has ${sampleBundle.validationIssueCount} validation issue(s)`);
  if (!templateRejected) validationIssues.push('template input was accepted as runtime evidence');
  if (!reviewedTemplateRejected) validationIssues.push('template input was accepted as reviewed runtime evidence');
  if (!rejectsRegisterValue) validationIssues.push('registerValue payload input was not rejected');
  if (!rejectsPortValue) validationIssues.push('portValue payload input was not rejected');
  if (!rejectsHash) validationIssues.push('hash payload input was not rejected');

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [fixtureCatalogId, eventContractCatalogId, emitterCatalogId, portCoverageCatalogId],
    sourceModules: [
      'shared/wb3/audio-runtime-output-events.js',
      'tools/world-audio-runtime-output-local-bundle.mjs',
    ],
    assetPolicy: 'Metadata only: local bundle templates and audits store fixture ids, phase ids, region ids, routine labels, offsets, port names, frame ids, field-name lists, counts, validation summaries, and command paths. No ROM bytes, opcodes, decoded music streams, register values, register traces, port values, audio bytes, samples, screenshots, or hashes are embedded.',
    target: {
      tool: 'tools/world-audio-runtime-output-local-bundle.mjs',
      templateCommand: 'node tools/world-audio-runtime-output-local-bundle.mjs --template --out tmp/local-audio-output-observations.template.json',
      bundleCommand: 'node tools/world-audio-runtime-output-local-bundle.mjs --observations tmp/local-audio-output-observations.json --out tmp/world-audio-runtime-output-events.local.json',
      reviewedBundleCommand: 'node tools/world-audio-runtime-output-local-bundle.mjs --observations tmp/local-audio-output-observations.json --reviewed-runtime-observations --out tmp/world-audio-runtime-output-events.local.json',
      smokeCommand,
    },
    summary: {
      fixtureCatalogReady: fixtureCatalog.summary?.readyForRuntimeHarness === true,
      eventContractReady: eventContract.summary?.readyForRuntimeHarness === true,
      emitterCatalogReady: emitterCatalog.summary?.readyForRuntimeHarness === true,
      portCoverageReady: portCoverage.summary?.readyForRuntimeHarness === true,
      templateObservationCount: template.summary.observationCount,
      phaseTemplateObservationCount: template.summary.phaseObservationCount,
      writeTemplateObservationCount: template.summary.writeObservationCount,
      sampleBundleObservationCount: sampleBundle.observationCount,
      sampleBundleEventCount: sampleBundle.emittedEventCount,
      sampleBundleValidationIssueCount: sampleBundle.validationIssueCount,
      rejectsTemplateAsRuntimeEvidence: templateRejected,
      rejectsReviewedTemplates: reviewedTemplateRejected,
      rejectsRegisterValue,
      rejectsPortValue,
      rejectsHash,
      supportsReviewedRuntimeObservationMarker: true,
      regionParticipationCount: regionParticipation.length,
      validationIssueCount: validationIssues.length,
      readyForRuntimeHarness: validationIssues.length === 0,
      defaultTemplatePath: 'tmp/local-audio-output-observations.template.json',
      defaultFilledObservationPath: 'tmp/local-audio-output-observations.json',
      defaultBundleOutputPath: 'tmp/world-audio-runtime-output-events.local.json',
      smokeCommand,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPortValueCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
      persistedHashCount: 0,
    },
    templateSummary: template.summary,
    sampleBundleSummary: {
      sinkSummary: sampleBundle.sinkSummary,
      derivedModelSummaries: sampleBundle.derivedModelSummaries,
      validation: sampleBundle.validation,
    },
    validation: {
      issueCount: validationIssues.length,
      issues: validationIssues,
    },
    regionParticipation,
    evidence: [
      `${fixtureCatalogId} supplies 14 output phase fixtures and 39 port-write fixtures.`,
      `${eventContractCatalogId} defines required metadata-only event keys and forbidden payload keys for PSG/FM output events.`,
      `${emitterCatalogId} validates the shared metadata-only audio output event emitter.`,
      `${portCoverageCatalogId} proves all 39 ASM sound-chip writes are covered by fixture ids.`,
      'tools/world-audio-runtime-output-local-bundle.mjs rejects generated templates as runtime evidence unless explicitly allowed for simulation.',
      'tools/world-audio-runtime-output-local-bundle.mjs rejects templates marked as reviewed runtime evidence.',
      'tools/world-audio-runtime-output-local-bundle.mjs rejects registerValue, portValue, hash, and other forbidden payload keys before event emission.',
      `${smokeCommand} exercises template generation, template rejection, local two-event bundling, derived-model validation, and forbidden-payload rejection.`,
    ],
    nextLeads: [
      'Connect clean browser PSG/FM output callbacks to tmp/local-audio-output-observations.json using fixture ids and frame metadata only.',
      'Run reviewed local bundles from real audio preview sessions to confirm phase/write fixture coverage with runtime frame ordering.',
      'Use reviewed local bundles to drive a transient PSG/FM register timeline player that computes values locally without persisting them.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const item of catalog.regionParticipation || []) {
    const region = findRegion(mapData, item.regionId);
    if (!region) {
      missingRegions.push({ id: item.regionId, role: 'audio_runtime_output_local_bundle' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.audioRuntimeOutputLocalBundleAudit = {
      catalogId,
      kind: 'audio_runtime_output_local_observation_bundle',
      confidence: catalog.summary.readyForRuntimeHarness ? 'high' : 'medium',
      tool: 'tools/world-audio-runtime-output-local-bundle.mjs',
      writeCount: item.writeCount,
      ports: item.ports,
      phaseIds: item.phaseIds,
      fixtureIds: item.fixtureIds,
      asmLines: item.asmLines,
      routineLabels: item.routineLabels,
      bundleReady: catalog.summary.readyForRuntimeHarness,
      rejectsRegisterValue: catalog.summary.rejectsRegisterValue,
      rejectsPortValue: catalog.summary.rejectsPortValue,
      rejectsHash: catalog.summary.rejectsHash,
      defaultTemplatePath: catalog.summary.defaultTemplatePath,
      defaultBundleOutputPath: catalog.summary.defaultBundleOutputPath,
      summary: 'Routine can be confirmed by metadata-only local PSG/FM output observation bundles keyed by fixture id.',
      evidence: [
        `${catalogId} provides the metadata-only local observation bundler for audio output fixture ids.`,
        `${portCoverageCatalogId} matches this routine's ASM line(s) ${item.asmLines.join(', ')} to audio port-write fixtures.`,
        'The local bundler stores ids, labels, ports, counts, and frame metadata only; register values, port values, audio bytes, samples, ROM bytes, and hashes are rejected.',
      ],
      generatedAt: now,
      auditTool: toolName,
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
    type: 'audio_runtime_output_local_bundle_audit',
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
  staticMap.summary.audioRuntimeOutputLocalBundleCatalog = catalogId;
  staticMap.summary.audioRuntimeOutputLocalBundleTool = catalog.target.tool;
  staticMap.summary.audioRuntimeOutputLocalBundleTemplateObservations = catalog.summary.templateObservationCount;
  staticMap.summary.audioRuntimeOutputLocalBundlePhaseTemplates = catalog.summary.phaseTemplateObservationCount;
  staticMap.summary.audioRuntimeOutputLocalBundleWriteTemplates = catalog.summary.writeTemplateObservationCount;
  staticMap.summary.audioRuntimeOutputLocalBundleValidationIssues = catalog.summary.validationIssueCount;
  staticMap.summary.audioRuntimeOutputLocalBundleReady = catalog.summary.readyForRuntimeHarness;
  staticMap.summary.audioRuntimeOutputLocalBundleRejectsRegisterValue = catalog.summary.rejectsRegisterValue;
  staticMap.summary.audioRuntimeOutputLocalBundleRejectsPortValue = catalog.summary.rejectsPortValue;
  staticMap.summary.audioRuntimeOutputLocalBundleRejectsHash = catalog.summary.rejectsHash;
  staticMap.summary.audioRuntimeOutputLocalBundleSmokeCommand = catalog.summary.smokeCommand;
  staticMap.summary.audioRuntimeOutputLocalBundleRegionParticipation = catalog.summary.regionParticipationCount;
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
  for (const lead of catalog.nextLeads || []) {
    if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  }
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
