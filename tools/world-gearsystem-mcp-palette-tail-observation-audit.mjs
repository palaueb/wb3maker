#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildResidualRuntimeTraceObservationAudit } from './world-residual-runtime-trace-observation-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-palette-tail-observation.local.json');
const defaultObservationsPath = path.join(repoRoot, 'tmp/local-hook-observations.palette-tail.local.json');
const fieldProbeCatalogId = 'world-gearsystem-mcp-callback-field-probe-catalog-2026-06-26';
const mapperTrackerCatalogId = 'world-gearsystem-mcp-mapper-state-tracker-catalog-2026-06-26';
const catalogId = 'world-gearsystem-mcp-palette-tail-observation-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-palette-tail-observation-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-palette-tail-observation-audit.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;
const targetRegionIds = ['r2815', 'r2816', 'r2817'];

const forbiddenCounterNames = [
  'persistedRomByteCount',
  'persistedStreamByteCount',
  'persistedTileIdCount',
  'persistedPaletteByteCount',
  'persistedPortValueCount',
  'persistedRegisterTraceCount',
  'persistedProgramCounterCount',
  'persistedPixelCount',
  'persistedAudioByteCount',
  'persistedInstructionByteCount',
];

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
}

function relative(filePath) {
  return path.relative(repoRoot, filePath);
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData || {})) {
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

function recordByRegion(catalog) {
  return new Map((catalog.records || []).map(record => [record.regionId, record]));
}

function firstValue(values) {
  return (values || []).find(value => value !== undefined && value !== null && value !== '') ?? null;
}

function observationForRegion(regionId, fieldRecord, mapperRecord) {
  const activeBankReady = mapperRecord?.activeBankObservationReady === true && mapperRecord.active_bank != null;
  const requiredFieldValues = {
    hookId: 'residual_palette_tail_cursor_watch',
    same_frame_trace_id: `mcp-palette-tail-${regionId}-read-watch-01`,
    active_bank: activeBankReady ? mapperRecord.active_bank : null,
    consumer_label: firstValue(fieldRecord?.consumerLabels),
    cursor_offset: firstValue(fieldRecord?.resolvedOffsets),
    cursor_region_id: regionId,
    access_role: 'single_address_read_breakpoint_with_mapper_write_tracking',
    inside_palette_tail_region: true,
  };
  const missingFields = Object.entries(requiredFieldValues)
    .filter(([key, value]) => key !== 'hookId' && (value === null || value === ''))
    .map(([key]) => key);
  return {
    observation: requiredFieldValues,
    missingFields,
    ready: missingFields.length === 0,
  };
}

function buildRecords(mapData, fieldProbeCatalog, mapperTrackerCatalog) {
  const fieldByRegion = recordByRegion(fieldProbeCatalog);
  const mapperByRegion = recordByRegion(mapperTrackerCatalog);
  return targetRegionIds.map(regionId => {
    const region = (mapData.regions || []).find(candidate => candidate.id === regionId);
    const fieldRecord = fieldByRegion.get(regionId);
    const mapperRecord = mapperByRegion.get(regionId);
    const built = observationForRegion(regionId, fieldRecord, mapperRecord);
    return {
      regionId,
      regionOffset: region?.offset || null,
      regionType: region?.type || null,
      status: built.ready
        ? 'palette_tail_runtime_hook_observation_ready'
        : 'palette_tail_runtime_hook_observation_incomplete',
      tailHookObservationReady: built.ready,
      fullResidualPlanReady: false,
      missingTailHookFields: built.missingFields,
      missingResidualPlanHooks: ['residual_palette_parser_entry', 'residual_runtime_promotion_gate'],
      sourceFieldProbeStatus: fieldRecord?.status || null,
      sourceMapperTrackerStatus: mapperRecord?.status || null,
      observation: built.observation,
      evidence: [
        `${fieldProbeCatalogId} supplies consumer_label, cursor_offset, cursor_region_id, access_role, and inside-region evidence.`,
        `${mapperTrackerCatalogId} supplies active_bank from transient mapper-write watchpoint state where ready.`,
        'This record completes only residual_palette_tail_cursor_watch; parser-entry and promotion-gate hooks are still required for residual closure.',
      ],
    };
  });
}

function buildCatalog(mapData) {
  const fieldProbeCatalog = requireCatalog(mapData, fieldProbeCatalogId);
  const mapperTrackerCatalog = requireCatalog(mapData, mapperTrackerCatalogId);
  const records = buildRecords(mapData, fieldProbeCatalog, mapperTrackerCatalog);
  const observations = records.filter(record => record.tailHookObservationReady).map(record => record.observation);
  const observationInput = {
    schemaVersion: 1,
    eventKind: 'wb3_palette_tail_runtime_observations',
    generatedBy: toolName,
    sourceCatalogs: [fieldProbeCatalogId, mapperTrackerCatalogId],
    observations,
    assetPolicy: 'Metadata-only local observations: hook ids, trace ids, region ids, offsets, labels, booleans, access roles, and reviewed active_bank values. No ROM bytes, stream bytes, memory dumps, register traces, PC values, tile ids, palette values, VDP port values, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
  };
  const observationAudit = buildResidualRuntimeTraceObservationAudit(mapData, observationInput, {
    source: 'world-gearsystem-mcp-palette-tail-observation-audit',
    regionIds: targetRegionIds,
  });
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    eventKind: 'wb3_gearsystem_mcp_palette_tail_observation_audit',
    sourceCatalogs: [fieldProbeCatalogId, mapperTrackerCatalogId],
    assetPolicy: observationInput.assetPolicy,
    observationsOutputPath: relative(defaultObservationsPath),
    summary: {
      targetRegionCount: records.length,
      tailHookObservationReadyCount: records.filter(record => record.tailHookObservationReady).length,
      fullResidualPlanReadyCount: 0,
      missingResidualPlanHookIds: uniqueSorted(records.flatMap(record => record.missingResidualPlanHooks || [])),
      observationAuditInputUsableAsRuntimeEvidence: observationAudit.summary.inputUsableAsRuntimeEvidence,
      observationAuditCompletePlanCount: observationAudit.summary.completePlanCount,
      observationAuditRequiredFieldIssueCount: observationAudit.summary.requiredFieldIssueCount,
      observationAuditForbiddenPayloadKeyCount: observationAudit.summary.forbiddenPayloadKeyCount,
      observationAuditBundleEventCount: observationAudit.summary.bundleEventCount,
      observationAuditConfirmationPromotionReadyCount: observationAudit.summary.confirmationPromotionReadyCount,
      regionIds: records.map(record => record.regionId),
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedProgramCounterCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    records,
    observationInput,
    observationAuditSummary: observationAudit.summary,
    evidence: [
      'Field-probe and mapper-state tracker catalogs together provide complete residual_palette_tail_cursor_watch observations for r2815-r2817.',
      'The residual observation audit accepts the tail-hook fields, but complete residual proof still needs parser-entry and promotion-gate observations.',
      'No protected runtime payloads are persisted.',
    ],
    nextLeads: [
      'Capture residual_palette_parser_entry for r2815-r2817 in the same trace groups.',
      'Add promotion-gate observations after deciding whether each tail read is a direct consumer or field/alias-only rejection.',
      'Run the residual closure pipeline only after the parser-entry and promotion-gate hooks are filled.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'gearsystem_mcp_palette_tail_observation' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpPaletteTailObservationAudit = {
      catalogId,
      kind: 'gearsystem_mcp_palette_tail_observation_audit',
      status: record.status,
      tailHookObservationReady: record.tailHookObservationReady,
      fullResidualPlanReady: false,
      missingTailHookFields: record.missingTailHookFields,
      missingResidualPlanHooks: record.missingResidualPlanHooks,
      observation: record.observation,
      summary: 'Complete metadata-only observation for residual_palette_tail_cursor_watch; full residual closure still needs parser-entry and promotion-gate observations.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: record.regionId,
      status: record.status,
      tailHookObservationReady: record.tailHookObservationReady,
      fullResidualPlanReady: false,
      missingResidualPlanHooks: record.missingResidualPlanHooks,
    });
  }
  mapData.gearsystemMcpPaletteTailObservationCatalogs = (mapData.gearsystemMcpPaletteTailObservationCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpPaletteTailObservationCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_palette_tail_observation_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      changedRegionCount: changedRegions.length,
      missingRegionCount: missingRegions.length,
    },
    changedRegions,
    missingRegions,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
    assetPolicy: catalog.assetPolicy,
  });
  mapData.updatedAt = now;
  return { changedRegions, missingRegions };
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.gearsystemMcpPaletteTailObservationCatalog = catalogId;
  staticMap.summary.gearsystemMcpPaletteTailObservationReadyCount = catalog.summary.tailHookObservationReadyCount;
  staticMap.summary.gearsystemMcpPaletteTailObservationFullResidualPlanReadyCount = catalog.summary.fullResidualPlanReadyCount;
  staticMap.summary.gearsystemMcpPaletteTailObservationMissingResidualPlanHookIds = catalog.summary.missingResidualPlanHookIds;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`gearsystemMcpPaletteTailObservation${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-palette-tail-observation-catalog-2026-06-26 to fill parser-entry and promotion-gate hooks for r2815-r2817 before closure.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const observationsPath = resolveRepoPath(argValue('--observations-out')) || defaultObservationsPath;
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (!noWrite) {
    writeJson(outputPath, catalog);
    writeJson(observationsPath, catalog.observationInput);
  }
  let result = { changedRegions: [], missingRegions: [] };
  if (apply) {
    result = applyCatalog(mapData, catalog);
    if (!noWrite) {
      writeJson(mapPath, mapData);
      updateStaticMap(catalog);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    applied: apply,
    output: noWrite ? null : relative(outputPath),
    observationsOutput: noWrite ? null : relative(observationsPath),
    catalogId,
    summary: catalog.summary,
    changedRegions: result.changedRegions,
    missingRegions: result.missingRegions,
    assetPolicy: catalog.assetPolicy,
  }, null, 2));
}

main();
