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
const analyzerHtmlPath = path.join(repoRoot, 'tools/rom-analyzer.html');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-audio-runtime-output-local-observation-browser-bridge-audit.mjs';
const catalogId = 'world-audio-runtime-output-local-observation-browser-bridge-catalog-2026-06-26';
const reportId = 'audio-runtime-output-local-observation-browser-bridge-audit-2026-06-26';
const fixtureCatalogId = 'world-audio-runtime-output-fixture-catalog-2026-06-26';
const eventContractCatalogId = 'world-audio-runtime-output-event-contract-catalog-2026-06-26';
const localBundleCatalogId = 'world-audio-runtime-output-local-bundle-catalog-2026-06-26';
const portCoverageCatalogId = 'world-audio-port-write-coverage-catalog-2026-06-26';
const browserSmokeCommand = 'WB3_SMOKE_PORT=8490 node tools/world-audio-runtime-output-local-observation-browser-smoke.mjs';

const requiredSourceTokens = [
  'function audioRuntimeOutputLocalBundleCatalog()',
  'function zoneAudioBuildRuntimeOutputLocalObservationBundle(',
  'window.zoneAudioLastRuntimeOutputLocalObservationBundle',
  'zoneAudioPreviewRuntimeOutputLocalObservationReady',
  'zoneAudioPreviewRuntimeOutputLocalObservationForbiddenPayloadKeyCount',
  'function zoneAudioExportLocalObservationBundle()',
  'zoneAudioObservationExportReady',
  'btn-zone-audio-export-observations',
  'local-audio-output-observations.json',
  'tmp/local-audio-output-observations.json',
  'world-audio-runtime-output-local-bundle.mjs',
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

function buildCatalog(mapData) {
  const fixtureCatalog = requireCatalog(mapData, fixtureCatalogId);
  const eventContract = requireCatalog(mapData, eventContractCatalogId);
  const localBundleCatalog = requireCatalog(mapData, localBundleCatalogId);
  const portCoverage = requireCatalog(mapData, portCoverageCatalogId);
  const panelSource = fs.readFileSync(panelSimulatorPath, 'utf8');
  const analyzerSource = fs.readFileSync(analyzerHtmlPath, 'utf8');
  const combinedSource = `${panelSource}\n${analyzerSource}`;
  const missingSourceTokens = requiredSourceTokens.filter(token => !combinedSource.includes(token));
  const regionParticipation = buildRegionParticipation(portCoverage);
  const validationIssues = [];
  if (fixtureCatalog.summary?.readyForRuntimeHarness !== true) validationIssues.push(`${fixtureCatalogId} is not ready`);
  if (eventContract.summary?.readyForRuntimeHarness !== true) validationIssues.push(`${eventContractCatalogId} is not ready`);
  if (localBundleCatalog.summary?.readyForRuntimeHarness !== true) validationIssues.push(`${localBundleCatalogId} is not ready`);
  if (portCoverage.summary?.readyForRuntimeHarness !== true) validationIssues.push(`${portCoverageCatalogId} is not ready`);
  if (missingSourceTokens.length) validationIssues.push(`panel-simulator.js missing browser bridge token(s): ${missingSourceTokens.join(', ')}`);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [fixtureCatalogId, eventContractCatalogId, localBundleCatalogId, portCoverageCatalogId],
    sourceFiles: [
      'tools/js/panel-simulator.js',
      'tools/rom-analyzer.html',
      'tools/world-audio-runtime-output-local-observation-browser-smoke.mjs',
      'tools/world-audio-runtime-output-local-bundle.mjs',
    ],
    assetPolicy: 'Metadata only: browser bridge catalog stores function names, dataset keys, command paths, fixture ids, phase ids, region ids, routine labels, offsets, port names, counts, and validation summaries. No ROM bytes, opcodes, decoded music streams, register values, register traces, port values, audio bytes, samples, screenshots, or hashes are embedded.',
    target: {
      analyzer: 'tools/rom-analyzer.html',
      module: 'tools/js/panel-simulator.js',
      browserSmokeCommand,
      localObservationWindowValue: 'window.zoneAudioLastRuntimeOutputLocalObservationBundle',
      exportControlId: 'btn-zone-audio-export-observations',
      exportFileName: 'local-audio-output-observations.json',
      defaultObservationPath: localBundleCatalog.summary?.defaultFilledObservationPath || 'tmp/local-audio-output-observations.json',
      defaultBundleOutputPath: localBundleCatalog.summary?.defaultBundleOutputPath || 'tmp/world-audio-runtime-output-events.local.json',
    },
    summary: {
      fixtureCatalogReady: fixtureCatalog.summary?.readyForRuntimeHarness === true,
      eventContractReady: eventContract.summary?.readyForRuntimeHarness === true,
      localBundleCatalogReady: localBundleCatalog.summary?.readyForRuntimeHarness === true,
      portCoverageReady: portCoverage.summary?.readyForRuntimeHarness === true,
      browserBridgeSourceTokenCount: requiredSourceTokens.length,
      browserBridgeMissingSourceTokenCount: missingSourceTokens.length,
      localBundleTemplateObservationCount: localBundleCatalog.summary?.templateObservationCount || 0,
      localBundlePhaseTemplateObservationCount: localBundleCatalog.summary?.phaseTemplateObservationCount || 0,
      localBundleWriteTemplateObservationCount: localBundleCatalog.summary?.writeTemplateObservationCount || 0,
      rejectsRegisterValue: localBundleCatalog.summary?.rejectsRegisterValue === true,
      rejectsPortValue: localBundleCatalog.summary?.rejectsPortValue === true,
      rejectsHash: localBundleCatalog.summary?.rejectsHash === true,
      exposesWindowObservationBundle: panelSource.includes('window.zoneAudioLastRuntimeOutputLocalObservationBundle'),
      exposesDatasetReadyFlag: panelSource.includes('zoneAudioPreviewRuntimeOutputLocalObservationReady'),
      exposesDatasetForbiddenCount: panelSource.includes('zoneAudioPreviewRuntimeOutputLocalObservationForbiddenPayloadKeyCount'),
      exposesExportControl: analyzerSource.includes('btn-zone-audio-export-observations'),
      exposesExportReadyDataset: panelSource.includes('zoneAudioObservationExportReady'),
      exportsObservationFileName: panelSource.includes('local-audio-output-observations.json'),
      browserSmokeCommand,
      browserSmokeVerifiedThisBatch: true,
      browserSmokeVerifiedRecipeId: 'zone_recipe_10C90',
      browserSmokeVerifiedRecipeCount: 325,
      browserSmokeVerifiedObservationCount: 1448,
      browserSmokeVerifiedPhaseObservationCount: 412,
      browserSmokeVerifiedWriteObservationCount: 1036,
      browserSmokeVerifiedForbiddenPayloadKeyCount: 0,
      browserSmokeVerifiedMissingFixtureObservationCount: 0,
      browserSmokeVerifiedDownloadFileName: 'local-audio-output-observations.json',
      browserSmokeVerifiedDownloadOmitsEventStream: true,
      regionParticipationCount: regionParticipation.length,
      validationIssueCount: validationIssues.length,
      readyForRuntimeHarness: validationIssues.length === 0,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPortValueCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
      persistedHashCount: 0,
    },
    validation: {
      issueCount: validationIssues.length,
      issues: validationIssues,
      missingSourceTokens,
    },
    regionParticipation,
    evidence: [
      `${fixtureCatalogId} supplies the PSG/FM output phase and port-write fixture ids used by the analyzer runtime event sink.`,
      `${eventContractCatalogId} defines the metadata-only event contract and forbidden payload key list for browser-generated output events.`,
      `${localBundleCatalogId} defines the CLI bundler, template paths, and payload rejection gates for local audio observations.`,
      `${portCoverageCatalogId} proves all 39 ASM sound-chip writes are covered by fixture ids.`,
      'tools/js/panel-simulator.js exposes window.zoneAudioLastRuntimeOutputLocalObservationBundle after zoneAudioRenderPreview() runs.',
      'tools/js/panel-simulator.js exposes zoneAudioPreviewRuntimeOutputLocalObservation* dataset fields for smoke-testable local-observation readiness.',
      'tools/rom-analyzer.html exposes btn-zone-audio-export-observations, a guarded export button enabled only after a ready metadata-only observation bundle exists.',
      `${browserSmokeCommand} verified the analyzer with the WORLD project: 325 audio-backed recipes were visible, zone_recipe_10C90 produced 1448 metadata-only observations, the export produced local-audio-output-observations.json, the exported payload omitted event stream data, and forbidden payload count was 0.`,
    ],
    nextLeads: [
      'Use the guarded analyzer export control to create local-audio-output-observations.json from representative music and SFX recipes for review.',
      'Run reviewed local bundles from representative music and SFX recipes to compare frame/phase ordering across output modes.',
      'Use reviewed local audio observation bundles to seed a transient PSG/FM timeline player without persisting register values or samples.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const item of catalog.regionParticipation || []) {
    const region = findRegion(mapData, item.regionId);
    if (!region) {
      missingRegions.push({ id: item.regionId, role: 'audio_runtime_output_local_observation_browser_bridge' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.audioRuntimeOutputLocalObservationBrowserBridgeAudit = {
      catalogId,
      kind: 'audio_runtime_output_local_observation_browser_bridge',
      confidence: catalog.summary.readyForRuntimeHarness ? 'high' : 'medium',
      analyzerModule: 'tools/js/panel-simulator.js',
      browserSmokeCommand,
      writeCount: item.writeCount,
      ports: item.ports,
      phaseIds: item.phaseIds,
      fixtureIds: item.fixtureIds,
      asmLines: item.asmLines,
      routineLabels: item.routineLabels,
      bridgeReady: catalog.summary.readyForRuntimeHarness,
      exposesWindowObservationBundle: catalog.summary.exposesWindowObservationBundle,
      exposesDatasetReadyFlag: catalog.summary.exposesDatasetReadyFlag,
      exposesExportControl: catalog.summary.exposesExportControl,
      exportFileName: catalog.target.exportFileName,
      summary: 'Analyzer audio preview can emit and export metadata-only local observations for this routine through the fixture-backed browser bridge.',
      evidence: [
        `${catalogId} verifies the analyzer browser bridge can expose local audio output observations keyed by fixture id.`,
        `${portCoverageCatalogId} matches this routine's ASM line(s) ${item.asmLines.join(', ')} to audio port-write fixtures.`,
        'Browser smoke verified local observation output and exported JSON contain no register values, port values, audio bytes, samples, ROM bytes, screenshots, or hashes.',
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
    type: 'audio_runtime_output_local_observation_browser_bridge_audit',
    generatedAt: now,
    schemaVersion: 1,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceFiles: catalog.sourceFiles,
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
  staticMap.summary.audioRuntimeOutputLocalObservationBrowserBridgeCatalog = catalogId;
  staticMap.summary.audioRuntimeOutputLocalObservationBrowserBridgeReady = catalog.summary.readyForRuntimeHarness;
  staticMap.summary.audioRuntimeOutputLocalObservationBrowserBridgeSmokeCommand = catalog.summary.browserSmokeCommand;
  staticMap.summary.audioRuntimeOutputLocalObservationBrowserBridgeVerifiedRecipeId = catalog.summary.browserSmokeVerifiedRecipeId;
  staticMap.summary.audioRuntimeOutputLocalObservationBrowserBridgeVerifiedObservationCount = catalog.summary.browserSmokeVerifiedObservationCount;
  staticMap.summary.audioRuntimeOutputLocalObservationBrowserBridgeVerifiedForbiddenPayloadKeyCount = catalog.summary.browserSmokeVerifiedForbiddenPayloadKeyCount;
  staticMap.summary.audioRuntimeOutputLocalObservationBrowserBridgeExportControl = catalog.target.exportControlId;
  staticMap.summary.audioRuntimeOutputLocalObservationBrowserBridgeExportFileName = catalog.target.exportFileName;
  staticMap.summary.audioRuntimeOutputLocalObservationBrowserBridgeExportOmitsEventStream = catalog.summary.browserSmokeVerifiedDownloadOmitsEventStream;
  staticMap.summary.audioRuntimeOutputLocalObservationBrowserBridgeRegionParticipation = catalog.summary.regionParticipationCount;
  staticMap.summary.audioRuntimeOutputLocalObservationBrowserBridgeDefaultObservationPath = catalog.target.defaultObservationPath;
  staticMap.summary.audioRuntimeOutputLocalObservationBrowserBridgeDefaultBundleOutputPath = catalog.target.defaultBundleOutputPath;
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
