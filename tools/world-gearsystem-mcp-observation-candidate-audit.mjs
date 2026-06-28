#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_RESIDUAL_RUNTIME_CAPTURE_FIELD_RULES,
} from '../shared/wb3/residual-runtime-observation-review.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-observation-candidates.local.json');
const cleanHookGapCatalogId = 'world-gearsystem-mcp-clean-hook-gap-catalog-2026-06-26';
const catalogId = 'world-gearsystem-mcp-observation-candidate-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-observation-candidate-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-observation-candidate-audit.mjs';
const now = '2026-06-26T00:00:00Z';

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

function requiredFieldsForHook(hookId) {
  const rule = REQUIRED_RESIDUAL_RUNTIME_CAPTURE_FIELD_RULES[hookId] || {};
  const trueGroupFields = (rule.requiredTrueFieldGroups || []).flatMap(fields => fields);
  return uniqueSorted([...(rule.requiredFields || []), ...trueGroupFields]);
}

function fieldValueIsFilled(value) {
  return value !== undefined && value !== null && value !== '';
}

function candidateTraceId(regionId, report, hookId, index) {
  const routeId = (report.routeIds || [])[0] || 'route';
  const opId = (report.matchedOperationIds || [])[0] || 'operation';
  return `mcp-candidate-${regionId}-${hookId}-${routeId}-${opId}-${String(index + 1).padStart(2, '0')}`;
}

function candidateFieldsForHook(regionRecord, report, hookId, index) {
  const fields = {
    hookId,
    same_frame_trace_id: candidateTraceId(regionRecord.regionId, report, hookId, index),
  };
  if (hookId === 'residual_palette_tail_cursor_watch') {
    fields.cursor_region_id = regionRecord.regionId;
    fields.access_role = 'read_range_breakpoint_inference';
    fields.inside_palette_tail_region = true;
  } else if (hookId === 'residual_bank7_sidecar_direct_watch') {
    fields.read_region_id = regionRecord.regionId;
    fields.access_role = 'read_range_breakpoint_inference';
  } else if (hookId === 'residual_overlay_cf64_index_read') {
    fields.computed_record_offset = (regionRecord.targetOffsets || [])[0] || null;
  } else if (hookId === 'residual_room_overlay_loader_entry') {
    fields.loader_source_region_id = regionRecord.regionId;
    fields.loader_source_offset = (regionRecord.targetOffsets || [])[0] || null;
  }
  return fields;
}

function buildCandidateForHit(regionRecord, report, hookId, index) {
  const requiredFields = requiredFieldsForHook(hookId);
  const fields = candidateFieldsForHook(regionRecord, report, hookId, index);
  const filledFields = requiredFields.filter(field => fieldValueIsFilled(fields[field]));
  const missingFields = requiredFields.filter(field => !fieldValueIsFilled(fields[field]));
  return {
    regionId: regionRecord.regionId,
    hookId,
    reportPath: report.path,
    routeIds: report.routeIds || [],
    matchedOperationIds: report.matchedOperationIds || [],
    matchedLabels: report.matchedLabels || [],
    matchedHookBreakpointRoles: report.matchedHookBreakpointRoles || [],
    targetOffsets: regionRecord.targetOffsets || [],
    requiredFields,
    filledRequiredFields: filledFields,
    missingRequiredFields: missingFields,
    filledRequiredFieldCount: filledFields.length,
    missingRequiredFieldCount: missingFields.length,
    candidateOnly: true,
    reviewStatus: 'not_runtime_evidence',
    observation: fields,
    evidence: [
      `${report.path} is a sanitized Gearsystem MCP macro report with forbidden persisted payload counters at zero.`,
      'The candidate fields come from report metadata and target-region metadata only; no ROM bytes, memory bytes, register traces, VDP port values, pixels, screenshots, audio bytes, samples, or instruction bytes are embedded.',
      missingFields.length
        ? 'The candidate is incomplete and must not be used for closure until the missing fields are captured by real clean-runtime callbacks.'
        : 'The candidate still requires review before any closure use because it was derived from sanitized report metadata rather than callback field values.',
    ],
  };
}

function buildRegionCandidateRecord(regionRecord) {
  const hitReports = (regionRecord.macroReports || []).filter(report =>
    report.byteClean &&
    Number(report.matchedReadRangeInferenceHitCount || 0) > 0 &&
    Number(report.unmatchedBreakpointHitCount || 0) === 0);
  const candidates = [];
  for (const report of hitReports) {
    const hookIds = report.matchedHookIds || [];
    hookIds.forEach((hookId, index) => {
      candidates.push(buildCandidateForHit(regionRecord, report, hookId, index));
    });
  }
  const filledRequiredFieldCount = candidates.reduce((sum, candidate) => sum + candidate.filledRequiredFieldCount, 0);
  const missingRequiredFieldCount = candidates.reduce((sum, candidate) => sum + candidate.missingRequiredFieldCount, 0);
  return {
    regionId: regionRecord.regionId,
    status: candidates.length
      ? 'observation_candidates_from_sanitized_mcp_hits'
      : regionRecord.captureAdapterScaffoldReady
        ? 'capture_scaffold_ready_no_candidate_hit'
        : 'capture_scaffold_missing',
    sourceStatus: regionRecord.status,
    readRangeHitObserved: regionRecord.readRangeHitObserved === true,
    captureAdapterScaffoldReady: regionRecord.captureAdapterScaffoldReady === true,
    candidateCount: candidates.length,
    candidateHookIds: uniqueSorted(candidates.map(candidate => candidate.hookId)),
    filledRequiredFieldCount,
    missingRequiredFieldCount,
    runtimeObservationReady: false,
    reviewReady: false,
    closureReady: false,
    semanticPromotionReady: false,
    candidates,
    nextLead: candidates.length
      ? 'Use these candidates as a checklist for the debugger callback fields that still need real clean-runtime capture.'
      : 'Find a route/save-state that reaches the scaffolded hook before attempting clean observation capture.',
  };
}

function buildCatalog(mapData) {
  const cleanGapCatalog = requireCatalog(mapData, cleanHookGapCatalogId);
  const records = (cleanGapCatalog.records || []).map(buildRegionCandidateRecord);
  const candidateObservations = records.flatMap(record => record.candidates.map(candidate => candidate.observation));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [cleanHookGapCatalogId],
    candidateOnly: true,
    eventKind: 'wb3_gearsystem_mcp_observation_candidates',
    assetPolicy: 'Metadata only: region ids, hook ids, route ids, operation ids, labels, field names, booleans, and inferred offsets from existing metadata. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      residualRegionCount: records.length,
      candidateRegionCount: records.filter(record => record.candidateCount > 0).length,
      candidateObservationCount: candidateObservations.length,
      candidateHookIds: uniqueSorted(records.flatMap(record => record.candidateHookIds)),
      filledRequiredFieldCount: records.reduce((sum, record) => sum + record.filledRequiredFieldCount, 0),
      missingRequiredFieldCount: records.reduce((sum, record) => sum + record.missingRequiredFieldCount, 0),
      runtimeObservationReadyCount: 0,
      reviewReadyCount: 0,
      closureReadyCount: 0,
      semanticPromotionReadyCount: 0,
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
    observations: candidateObservations,
    records,
    nextLeads: [
      'Do not feed this candidate file to the residual closure pipeline; it is a metadata checklist, not reviewed runtime evidence.',
      'Capture active_bank, exact cursor/read offsets, consumer labels, and promotion-gate fields from real debugger callbacks.',
      'Run the local observation audit and closure pipeline only after replacing candidate-only fields with real clean-runtime observations.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  for (const record of catalog.records || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === record.regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpObservationCandidateAudit = {
      catalogId,
      kind: 'gearsystem_mcp_observation_candidate_audit',
      status: record.status,
      candidateOnly: true,
      readRangeHitObserved: record.readRangeHitObserved,
      captureAdapterScaffoldReady: record.captureAdapterScaffoldReady,
      candidateCount: record.candidateCount,
      candidateHookIds: record.candidateHookIds,
      filledRequiredFieldCount: record.filledRequiredFieldCount,
      missingRequiredFieldCount: record.missingRequiredFieldCount,
      runtimeObservationReady: false,
      reviewReady: false,
      closureReady: false,
      semanticPromotionReady: false,
      reportPaths: uniqueSorted(record.candidates.map(candidate => candidate.reportPath)),
      nextLead: record.nextLead,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      status: record.status,
      candidateCount: record.candidateCount,
      missingRequiredFieldCount: record.missingRequiredFieldCount,
    });
  }
  mapData.gearsystemMcpObservationCandidateCatalogs = (mapData.gearsystemMcpObservationCandidateCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpObservationCandidateCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_observation_candidate_audit',
    generatedAt: now,
    schemaVersion: catalog.schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      changedRegionCount: changedRegions.length,
    },
    changedRegions,
    nextLeads: catalog.nextLeads,
    assetPolicy: catalog.assetPolicy,
  });
  mapData.updatedAt = now;
  return changedRegions;
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.gearsystemMcpObservationCandidateCatalog = catalogId;
  staticMap.summary.gearsystemMcpObservationCandidateRegionCount = catalog.summary.candidateRegionCount;
  staticMap.summary.gearsystemMcpObservationCandidateObservationCount = catalog.summary.candidateObservationCount;
  staticMap.summary.gearsystemMcpObservationCandidateFilledRequiredFieldCount = catalog.summary.filledRequiredFieldCount;
  staticMap.summary.gearsystemMcpObservationCandidateMissingRequiredFieldCount = catalog.summary.missingRequiredFieldCount;
  staticMap.summary.gearsystemMcpObservationCandidateRuntimeObservationReadyCount = catalog.summary.runtimeObservationReadyCount;
  staticMap.summary.gearsystemMcpObservationCandidateReviewReadyCount = catalog.summary.reviewReadyCount;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-observation-candidate-catalog-2026-06-26 as a metadata-only checklist before collecting reviewed residual runtime observations.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (!noWrite) writeJson(outputPath, catalog);
  let changedRegions = [];
  if (apply) {
    changedRegions = applyCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }
  console.log(JSON.stringify({
    ok: true,
    applied: apply,
    output: noWrite ? null : relative(outputPath),
    catalogId,
    summary: catalog.summary,
    changedRegions,
    assetPolicy: catalog.assetPolicy,
  }, null, 2));
}

main();
