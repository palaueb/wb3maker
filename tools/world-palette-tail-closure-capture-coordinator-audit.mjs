#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-palette-tail-closure-capture-coordinator.local.json');
const catalogId = 'world-palette-tail-closure-capture-coordinator-catalog-2026-06-26';
const reportId = 'palette-tail-closure-capture-coordinator-audit-2026-06-26';
const toolName = 'tools/world-palette-tail-closure-capture-coordinator-audit.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;

const targetRegionIds = ['r2815', 'r2816', 'r2817'];
const paletteTailObservationCatalogId = 'world-gearsystem-mcp-palette-tail-observation-catalog-2026-06-26';
const paletteTailClosureAssemblerCatalogId = 'world-gearsystem-mcp-palette-tail-closure-observation-assembler-catalog-2026-06-26';
const parserEntryCaptureCatalogId = 'world-gearsystem-mcp-palette-parser-entry-observation-capture-catalog-2026-06-26';
const physicalSourceCompareCatalogId = 'world-gearsystem-mcp-physical-source-byte-compare-plan-catalog-2026-06-26';
const callbackCapturePlanCatalogId = 'world-gearsystem-mcp-callback-capture-plan-catalog-2026-06-26';
const readRangeHookBindingCatalogId = 'world-gearsystem-mcp-read-range-hook-binding-catalog-2026-06-26';

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
  'persistedHashCount',
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
  return filePath ? path.relative(repoRoot, filePath) : null;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value !== null && value !== undefined && value !== ''))].sort();
}

function countBy(values) {
  const counts = {};
  for (const value of values || []) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function primaryBlocker(reasons) {
  const priority = [
    'parser_entry_same_frame_observation_missing',
    'physical_live_report_initialize_failed',
    'physical_source_unique_match_missing',
    'physical_source_same_frame_trace_missing',
    'callback_capture_fields_remaining',
  ];
  return priority.find(reason => (reasons || []).includes(reason)) || reasons?.[0] || 'missing_palette_tail_closure_evidence';
}

function forbiddenCounters() {
  return Object.fromEntries(forbiddenCounterNames.map(name => [name, 0]));
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

function recordsByRegion(catalog) {
  return new Map((catalog?.records || []).map(record => [record.regionId, record]));
}

function regionById(mapData, regionId) {
  return (mapData.regions || []).find(region => region.id === regionId) || null;
}

function placeholder(regionId, field) {
  return `<${field}_from_${regionId}_same_frame_tail_read>`;
}

function commandSet(regionId) {
  const trace = placeholder(regionId, 'same_frame_trace_id');
  const activeBank = placeholder(regionId, 'reviewed_active_bank');
  return {
    callbackAwareMacroMonitor: `node tools/world-gearsystem-mcp-macro-monitor.mjs --execute --setup --clear-existing --reset --route boot_start_idle_probe --region ${regionId} --port 7777 --out tmp/world-gearsystem-mcp-macro-monitor.${regionId}.callback-plan.local.json`,
    captureParserEntry: `node tools/world-gearsystem-mcp-palette-parser-entry-observation-capture.mjs --execute --setup --reset --same-frame-trace-id ${trace} --active-bank ${activeBank} --route boot_start_idle_probe --port 7777 --out tmp/world-gearsystem-mcp-palette-parser-entry-observation.${regionId}.local.json --observation-out tmp/local-hook-observations.palette-parser-entry.${regionId}.local.json`,
    capturePhysicalSource: `node tools/world-gearsystem-mcp-physical-source-byte-compare-plan-audit.mjs --execute --region ${regionId} --same-frame-trace-id ${trace} --port 7777 --out tmp/world-gearsystem-mcp-physical-source-byte-compare-live.${regionId}.local.json`,
    assembleClosure: `node tools/world-gearsystem-mcp-palette-tail-closure-observation-assembler.mjs --parser-observations tmp/local-hook-observations.palette-parser-entry.${regionId}.local.json --physical-live-report tmp/world-gearsystem-mcp-physical-source-byte-compare-live.${regionId}.local.json --out tmp/world-gearsystem-mcp-palette-tail-closure-observation-assembler.${regionId}.local.json --observations-out tmp/local-hook-observations.palette-tail-closure.${regionId}.local.json`,
    validateClosureObservations: `node tools/world-residual-runtime-trace-observation-audit.mjs --observations tmp/local-hook-observations.palette-tail-closure.${regionId}.local.json --region ${regionId} --out tmp/world-residual-runtime-trace-observation-audit.${regionId}.palette-tail.local.json`,
    runClosurePipeline: `node tools/world-residual-runtime-closure-pipeline-audit.mjs --observations tmp/local-hook-observations.palette-tail-closure.${regionId}.local.json --region ${regionId} --out tmp/world-residual-runtime-closure-pipeline.${regionId}.palette-tail.local.json`,
  };
}

function buildRegionRecord(mapData, lookups, regionId) {
  const region = regionById(mapData, regionId);
  const tailRecord = lookups.tailByRegion.get(regionId) || null;
  const closureRecord = lookups.closureByRegion.get(regionId) || null;
  const physicalRecord = lookups.physicalByRegion.get(regionId) || null;
  const callbackRecord = lookups.callbackByRegion.get(regionId) || null;
  const readRangeRecord = lookups.readRangeByRegion.get(regionId) || null;
  const parserSummary = lookups.parserCatalog.summary || {};
  const physicalSummary = lookups.physicalCatalog.summary || {};
  const blockedReasons = [];

  if (tailRecord?.tailHookObservationReady !== true) blockedReasons.push('tail_hook_observation_missing');
  if (parserSummary.captureSupportsSameFrameTraceId !== true) blockedReasons.push('parser_capture_missing_same_frame_trace_support');
  if (closureRecord?.parserEntryTraceMatched !== true) blockedReasons.push('parser_entry_same_frame_observation_missing');
  if (physicalSummary.liveReportSupportsSameFrameTraceId !== true) blockedReasons.push('physical_compare_missing_same_frame_trace_support');
  if (closureRecord?.physicalLiveStatus !== 'physical_live_report_executed') {
    blockedReasons.push(closureRecord?.physicalLiveStatus || 'physical_live_report_missing');
  }
  if (closureRecord?.physicalUniqueSourceReady !== true) blockedReasons.push('physical_source_unique_match_missing');
  if (closureRecord?.physicalSameFrameTraceReady !== true) blockedReasons.push('physical_source_same_frame_trace_missing');
  if (callbackRecord?.remainingRequiredFieldCount > 0) blockedReasons.push('callback_capture_fields_remaining');

  const status = blockedReasons.length
    ? `palette_tail_closure_capture_waiting_for_${primaryBlocker(blockedReasons)}`
    : 'palette_tail_closure_capture_ready_for_pipeline_review';

  return {
    regionId,
    regionOffset: region?.offset || null,
    regionSize: region?.size || null,
    regionType: region?.type || null,
    status,
    capturePlanOnly: true,
    closureReady: blockedReasons.length === 0,
    semanticPromotionReady: false,
    blockedReasons: uniqueSorted(blockedReasons),
    tailHookObservationReady: tailRecord?.tailHookObservationReady === true,
    parserCaptureSupportsSameFrameTraceId: parserSummary.captureSupportsSameFrameTraceId === true,
    parserEntrySameFrameReady: closureRecord?.parserEntryTraceMatched === true,
    physicalCompareSupportsSameFrameTraceId: physicalSummary.liveReportSupportsSameFrameTraceId === true,
    physicalLiveStatus: closureRecord?.physicalLiveStatus || null,
    physicalUniqueSourceReady: closureRecord?.physicalUniqueSourceReady === true,
    physicalSameFrameTraceReady: closureRecord?.physicalSameFrameTraceReady === true,
    callbackCapturePlanStatus: callbackRecord?.status || null,
    callbackRemainingRequiredFieldCount: callbackRecord?.remainingRequiredFieldCount || 0,
    callbackWaitingForRouteTaskCount: callbackRecord?.waitingForRouteTaskCount || 0,
    readRangeHookBindingStatus: readRangeRecord?.status || null,
    readRangeHitObserved: readRangeRecord?.readRangeHitObserved === true,
    sameFrameTraceIdPlaceholder: placeholder(regionId, 'same_frame_trace_id'),
    reviewedActiveBankPlaceholder: placeholder(regionId, 'reviewed_active_bank'),
    commands: commandSet(regionId),
    evidence: [
      `${paletteTailObservationCatalogId} supplies the current tail-hook observation readiness.`,
      `${paletteTailClosureAssemblerCatalogId} supplies the strict closure blockers for same-frame parser and physical-source evidence.`,
      `${parserEntryCaptureCatalogId} supports reviewed same-frame trace ids but has no ready parser-entry observation yet.`,
      `${physicalSourceCompareCatalogId} supports same-frame physical-source comparison but the current live report is not usable closure evidence.`,
      `${callbackCapturePlanCatalogId} lists remaining callback fields and route status for this region.`,
    ],
  };
}

export function buildCatalog(mapData) {
  const tailCatalog = requireCatalog(mapData, paletteTailObservationCatalogId);
  const closureCatalog = requireCatalog(mapData, paletteTailClosureAssemblerCatalogId);
  const parserCatalog = requireCatalog(mapData, parserEntryCaptureCatalogId);
  const physicalCatalog = requireCatalog(mapData, physicalSourceCompareCatalogId);
  const callbackCatalog = requireCatalog(mapData, callbackCapturePlanCatalogId);
  const readRangeCatalog = requireCatalog(mapData, readRangeHookBindingCatalogId);
  const lookups = {
    tailByRegion: recordsByRegion(tailCatalog),
    closureByRegion: recordsByRegion(closureCatalog),
    physicalByRegion: recordsByRegion(physicalCatalog),
    callbackByRegion: recordsByRegion(callbackCatalog),
    readRangeByRegion: recordsByRegion(readRangeCatalog),
    parserCatalog,
    physicalCatalog,
  };
  const records = targetRegionIds.map(regionId => buildRegionRecord(mapData, lookups, regionId));
  const blockedReasons = uniqueSorted(records.flatMap(record => record.blockedReasons || []));
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    eventKind: 'wb3_palette_tail_closure_capture_coordinator_audit',
    capturePlanOnly: true,
    sourceCatalogs: [
      paletteTailObservationCatalogId,
      paletteTailClosureAssemblerCatalogId,
      parserEntryCaptureCatalogId,
      physicalSourceCompareCatalogId,
      callbackCapturePlanCatalogId,
      readRangeHookBindingCatalogId,
    ],
    assetPolicy: 'Metadata only: region ids, offsets, statuses, hook ids, placeholder names, command paths, report paths, counts, booleans, and evidence summaries. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, program counters, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      targetRegionCount: records.length,
      capturePlanOnly: true,
      tailHookObservationReadyCount: records.filter(record => record.tailHookObservationReady).length,
      parserCaptureSupportsSameFrameTraceId: parserCatalog.summary?.captureSupportsSameFrameTraceId === true,
      parserEntrySameFrameReadyCount: records.filter(record => record.parserEntrySameFrameReady).length,
      physicalCompareSupportsSameFrameTraceId: physicalCatalog.summary?.liveReportSupportsSameFrameTraceId === true,
      physicalUniqueSourceReadyCount: records.filter(record => record.physicalUniqueSourceReady).length,
      physicalSameFrameTraceReadyCount: records.filter(record => record.physicalSameFrameTraceReady).length,
      readRangeHitObservedCount: records.filter(record => record.readRangeHitObserved).length,
      closureReadyCount: records.filter(record => record.closureReady).length,
      semanticPromotionReadyCount: 0,
      outputCandidateOnly: records.some(record => !record.closureReady),
      guardStatus: records.every(record => record.closureReady)
        ? 'palette_tail_closure_capture_ready_for_pipeline_review'
        : `blocked_${primaryBlocker(blockedReasons)}`,
      blockedReasons,
      blockedReasonCounts: countBy(records.flatMap(record => record.blockedReasons || [])),
      regionIds: records.map(record => record.regionId),
      ...forbiddenCounters(),
    },
    records,
    evidence: [
      'r2815-r2817 already have tail-hook read reachability and complete tail-hook metadata, but not full residual closure.',
      'Parser-entry and physical-source reports must share the same real trace id as the tail read; placeholder trace ids in this coordinator are not evidence.',
      'The coordinator records command sequencing only and does not mutate residual confidence or semantic type.',
    ],
    nextLeads: [
      'Start Gearsystem MCP, run the callback-aware macro monitor for each palette-tail residual, and capture the real same-frame trace id at the tail read.',
      'Run parser-entry capture and physical-source compare with that same trace id and reviewed active bank.',
      'Rerun the palette-tail closure assembler and closure pipeline; only then update residual proof metadata.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = regionById(mapData, record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'palette_tail_closure_capture_coordinator_target' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.paletteTailClosureCaptureCoordinatorAudit = {
      catalogId,
      kind: 'palette_tail_closure_capture_coordinator',
      status: record.status,
      capturePlanOnly: true,
      closureReady: record.closureReady,
      semanticPromotionReady: false,
      blockedReasons: record.blockedReasons,
      tailHookObservationReady: record.tailHookObservationReady,
      parserEntrySameFrameReady: record.parserEntrySameFrameReady,
      physicalLiveStatus: record.physicalLiveStatus,
      physicalUniqueSourceReady: record.physicalUniqueSourceReady,
      physicalSameFrameTraceReady: record.physicalSameFrameTraceReady,
      callbackCapturePlanStatus: record.callbackCapturePlanStatus,
      callbackRemainingRequiredFieldCount: record.callbackRemainingRequiredFieldCount,
      readRangeHookBindingStatus: record.readRangeHookBindingStatus,
      readRangeHitObserved: record.readRangeHitObserved,
      sameFrameTraceIdPlaceholder: record.sameFrameTraceIdPlaceholder,
      reviewedActiveBankPlaceholder: record.reviewedActiveBankPlaceholder,
      commands: record.commands,
      summary: 'Metadata-only capture coordinator for closing palette-tail residuals; no semantic promotion is claimed until same-frame parser-entry and physical-source evidence pass closure review.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      status: record.status,
      closureReady: record.closureReady,
      tailHookObservationReady: record.tailHookObservationReady,
      parserEntrySameFrameReady: record.parserEntrySameFrameReady,
      physicalUniqueSourceReady: record.physicalUniqueSourceReady,
      blockedReasons: record.blockedReasons,
    });
  }

  mapData.paletteTailClosureCaptureCoordinatorCatalogs = (mapData.paletteTailClosureCaptureCoordinatorCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.paletteTailClosureCaptureCoordinatorCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'palette_tail_closure_capture_coordinator_audit',
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
  staticMap.summary.paletteTailClosureCaptureCoordinatorCatalog = catalogId;
  staticMap.summary.paletteTailClosureCaptureCoordinatorStatus = catalog.summary.guardStatus;
  staticMap.summary.paletteTailClosureCaptureCoordinatorTargetRegionCount = catalog.summary.targetRegionCount;
  staticMap.summary.paletteTailClosureCaptureCoordinatorTailHookReadyCount = catalog.summary.tailHookObservationReadyCount;
  staticMap.summary.paletteTailClosureCaptureCoordinatorParserEntrySameFrameReadyCount = catalog.summary.parserEntrySameFrameReadyCount;
  staticMap.summary.paletteTailClosureCaptureCoordinatorPhysicalUniqueSourceReadyCount = catalog.summary.physicalUniqueSourceReadyCount;
  staticMap.summary.paletteTailClosureCaptureCoordinatorClosureReadyCount = catalog.summary.closureReadyCount;
  staticMap.summary.paletteTailClosureCaptureCoordinatorOutputCandidateOnly = catalog.summary.outputCandidateOnly === true;
  staticMap.summary.paletteTailClosureCaptureCoordinatorBlockedReasons = catalog.summary.blockedReasons;
  staticMap.summary.paletteTailClosureCaptureCoordinatorBlockedReasonCounts = catalog.summary.blockedReasonCounts;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`paletteTailClosureCaptureCoordinator${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-palette-tail-closure-capture-coordinator-catalog-2026-06-26 to run same-frame parser-entry and physical-source capture for r2815-r2817.';
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
  let annotation = { changedRegions: [], missingRegions: [] };
  if (apply) {
    annotation = applyCatalog(mapData, catalog);
    if (!noWrite) {
      writeJson(mapPath, mapData);
      updateStaticMap(catalog);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    applied: apply,
    output: noWrite ? null : relative(outputPath),
    catalogId,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    assetPolicy: catalog.assetPolicy,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      ...forbiddenCounters(),
    }, null, 2));
    process.exitCode = 1;
  }
}
