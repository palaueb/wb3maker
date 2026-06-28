#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { evaluateResidualRuntimeTracePlans } from '../shared/wb3/residual-runtime-trace-evaluator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const hookPlanCatalogId = 'world-residual-runtime-trace-hook-plan-catalog-2026-06-26';
const fixtureCatalogId = 'world-residual-runtime-trace-fixture-catalog-2026-06-26';
const catalogId = 'world-residual-runtime-trace-evaluator-catalog-2026-06-26';
const reportId = 'residual-runtime-trace-evaluator-audit-2026-06-26';
const toolName = 'tools/world-residual-runtime-trace-evaluator.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item?.id === id);
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

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function loadEvents() {
  const eventPath = argValue('--events');
  if (!eventPath) return { events: [], source: 'none' };
  const fullPath = path.resolve(process.cwd(), eventPath);
  const loaded = readJson(fullPath);
  return {
    events: Array.isArray(loaded) ? loaded : loaded.events || [],
    source: path.relative(repoRoot, fullPath),
  };
}

function annotationConfidence(item) {
  if (item.finalStatus === 'runtime_trace_rejected_for_forbidden_payload') return 'high_policy_rejection';
  if (item.runtimeTraceConfirmed || item.fieldOrAliasOnlyRejected) return 'high_for_supplied_events';
  return 'medium_pending_events';
}

function buildCatalog(mapData, eventBundle) {
  const hookPlan = requireCatalog(mapData, hookPlanCatalogId);
  const fixture = requireCatalog(mapData, fixtureCatalogId);
  const evaluation = evaluateResidualRuntimeTracePlans(hookPlan.tracePlans || [], eventBundle.events || []);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [hookPlanCatalogId, fixtureCatalogId],
    eventSource: eventBundle.source,
    evaluatorModule: 'shared/wb3/residual-runtime-trace-evaluator.js',
    assetPolicy: 'Metadata-only evaluator contract. The evaluator accepts hook ids, same-frame trace ids, labels, region ids, offsets, and booleans; forbidden payload keys reject persistence. No ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, audio bytes, or samples are persisted.',
    summary: {
      sourceTracePlanCount: hookPlan.summary?.tracePlanCount || 0,
      fixtureReadyForRuntimeHarness: Boolean(fixture.summary?.readyForRuntimeHarness),
      evaluatedPlanCount: evaluation.evaluatedPlanCount,
      eventCount: evaluation.eventCount,
      normalizedEventCount: evaluation.normalizedEventCount,
      traceGroupCount: evaluation.traceGroupCount,
      statusCounts: evaluation.statusCounts,
      runtimeTraceConfirmedCount: evaluation.runtimeTraceConfirmedCount,
      promotionReadyCount: evaluation.promotionReadyCount,
      fieldOrAliasOnlyRejectedCount: evaluation.fieldOrAliasOnlyRejectedCount,
      forbiddenPayloadKeyCount: evaluation.forbiddenPayloadKeys.length,
      droppedFieldCount: evaluation.droppedFields?.length || 0,
      validationIssueCount: evaluation.validationIssues?.length || 0,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
    },
    eventNormalizationSummary: evaluation.eventNormalizationSummary,
    droppedFields: evaluation.droppedFields || [],
    validationIssues: evaluation.validationIssues || [],
    evaluation,
    evaluatorRules: [
      'r2813 confirms only when the overlay index/read event selects index 227 or target offset 0x10718 in a complete same-frame hook set.',
      'r2815-r2817 confirm only when a non-_LABEL_10BC_ direct-consumer cursor event addresses the target region and the bank context matches the source bank or explicit physical-ROM-region evidence is present.',
      'r0749 confirms only when the direct bank-7 sidecar watchpoint reads r0749 as a direct consumer.',
      'Palette-parser-only and alias-loader-only events reject as field/alias context but do not promote coverage.',
      'Any forbidden payload key rejects the event bundle for persisted evidence.',
    ],
    evidence: [
      `${hookPlanCatalogId} supplies the five residual runtime trace plans and hook ids.`,
      `${fixtureCatalogId} verifies that all required hook fixtures are present for runtime-harness use.`,
      'shared/wb3/residual-runtime-trace-evaluator.js implements the metadata-only decision rules.',
    ],
    nextLeads: [
      'Feed real clean-emulator residual hook events into this evaluator with --events.',
      'Add a confirmation audit only after supplied events produce direct-consumer confirmations or field/alias-only rejections.',
      'Keep no-event runs as readiness metadata only; do not mutate residual semantic confidence from this evaluator alone.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const item of catalog.evaluation.evaluations || []) {
    const region = findRegion(mapData, item.regionId);
    if (!region) {
      missingRegions.push({ id: item.regionId, role: 'residual_runtime_trace_evaluator' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.residualRuntimeTraceEvaluatorAudit = {
        catalogId,
        kind: 'residual_runtime_trace_evaluator',
        confidence: annotationConfidence(item),
        finalStatus: item.finalStatus,
        runtimeTraceConfirmed: item.runtimeTraceConfirmed,
        promotionReady: item.promotionReady,
        fieldOrAliasOnlyRejected: item.fieldOrAliasOnlyRejected,
        eventSource: catalog.eventSource,
        coverageChangedByThisAudit: false,
        summary: 'Metadata-only residual runtime trace evaluator decision; residual semantic disposition is not mutated by this audit.',
        evidence: catalog.evidence,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      finalStatus: item.finalStatus,
      runtimeTraceConfirmed: item.runtimeTraceConfirmed,
      promotionReady: item.promotionReady,
      fieldOrAliasOnlyRejected: item.fieldOrAliasOnlyRejected,
    });
  }
  return { changedRegions, missingRegions };
}

function main() {
  const eventBundle = loadEvents();
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, eventBundle);
  const annotation = annotateMap(mapData, catalog);
  if (apply) {
    mapData.runtimeTraceEvaluatorCatalogs = (mapData.runtimeTraceEvaluatorCatalogs || []).filter(item => item.id !== catalogId);
    mapData.runtimeTraceEvaluatorCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      generatedAt: now,
      tool: toolName,
      schemaVersion: 1,
      catalogId,
      sourceCatalogs: catalog.sourceCatalogs,
      eventSource: catalog.eventSource,
      summary: catalog.summary,
      changedRegions: annotation.changedRegions,
      missingRegions: annotation.missingRegions,
      evaluatorRules: catalog.evaluatorRules,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      assetPolicy: catalog.assetPolicy,
    });
    mapData.updatedAt = now;
    writeJson(mapPath, mapData);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    eventSource: catalog.eventSource,
    summary: catalog.summary,
    evaluations: catalog.evaluation.evaluations,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
