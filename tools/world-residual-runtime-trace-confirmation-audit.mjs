#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateResidualRuntimeTracePlans } from '../shared/wb3/residual-runtime-trace-evaluator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const tracePlanCatalogId = 'world-residual-runtime-trace-hook-plan-catalog-2026-06-26';
const fixtureCatalogId = 'world-residual-runtime-trace-fixture-catalog-2026-06-26';
const evaluatorCatalogId = 'world-residual-runtime-trace-evaluator-catalog-2026-06-26';
const closureCatalogId = 'world-residual-runtime-proof-closure-index-catalog-2026-06-26';
const catalogId = 'world-residual-runtime-trace-confirmation-catalog-2026-06-26';
const reportId = 'residual-runtime-trace-confirmation-audit-2026-06-26';
const toolName = 'tools/world-residual-runtime-trace-confirmation-audit.mjs';
const schemaVersion = 1;

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

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function argValues(name) {
  const values = [];
  process.argv.forEach((arg, index) => {
    if (arg === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  });
  return values;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function normalizeRegionFilters(values) {
  return uniqueSorted((values || [])
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim())
    .filter(Boolean));
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

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function tracePlanRegionId(plan) {
  return plan?.regionId || plan?.region?.id || '';
}

function compactEvaluation(item) {
  return {
    planId: item.planId,
    regionId: item.regionId,
    classId: item.classId,
    targetOffsets: item.targetOffsets,
    finalStatus: item.finalStatus,
    confidence: item.confidence,
    runtimeTraceConfirmed: item.runtimeTraceConfirmed,
    promotionReady: item.promotionReady,
    fieldOrAliasOnlyRejected: item.fieldOrAliasOnlyRejected,
    selectedTraceIds: item.selectedTraceIds,
    rejectedTraceIds: item.rejectedTraceIds,
    insufficientTraceIds: item.insufficientTraceIds,
  };
}

function decisionForEvaluation(item, forbiddenPayloadKeys) {
  if (forbiddenPayloadKeys.length || item.finalStatus === 'runtime_trace_rejected_for_forbidden_payload') {
    return {
      decision: 'rejected_for_forbidden_payload',
      confidence: 'high',
      promotionAction: 'none',
      reason: 'Trace event input contains forbidden payload keys and cannot be used as persisted evidence.',
    };
  }
  if (item.runtimeTraceConfirmed && item.promotionReady) {
    return {
      decision: 'confirmed_direct_consumer_ready_for_residual_update',
      confidence: item.confidence,
      promotionAction: 'update_region_specific_residual_proof_in_followup_audit',
      reason: 'Evaluator found a complete same-frame hook set proving direct runtime selection or direct consumer use for this residual.',
    };
  }
  if (item.fieldOrAliasOnlyRejected) {
    return {
      decision: 'confirmed_field_or_alias_rejection_keep_quarantined',
      confidence: item.confidence,
      promotionAction: 'none',
      reason: 'Evaluator found the residual only in parser-field or alias-loader context, not as a direct consumer target.',
    };
  }
  return {
    decision: 'pending_insufficient_runtime_evidence',
    confidence: item.confidence,
    promotionAction: 'none',
    reason: 'No complete direct-consumer confirmation or field/alias-only rejection exists for this plan in the supplied events.',
  };
}

export function buildCatalog(mapData, eventBundle) {
  const regionFilter = normalizeRegionFilters(eventBundle.regionIds || eventBundle.regionFilter || []);
  const regionFilterSet = new Set(regionFilter);
  const tracePlanCatalog = requireCatalog(mapData, tracePlanCatalogId);
  const fixtureCatalog = requireCatalog(mapData, fixtureCatalogId);
  const evaluatorCatalog = requireCatalog(mapData, evaluatorCatalogId);
  const closureCatalog = requireCatalog(mapData, closureCatalogId);
  const sourceTracePlans = tracePlanCatalog.tracePlans || [];
  const evaluatedTracePlans = regionFilter.length
    ? sourceTracePlans.filter(plan => regionFilterSet.has(tracePlanRegionId(plan)))
    : sourceTracePlans;
  const missingRegionIds = regionFilter.filter(regionId => !evaluatedTracePlans.some(plan => tracePlanRegionId(plan) === regionId));
  const evaluation = evaluateResidualRuntimeTracePlans(evaluatedTracePlans, eventBundle.events || []);
  const decisions = (evaluation.evaluations || []).map(item => ({
    ...compactEvaluation(item),
    ...decisionForEvaluation(item, evaluation.forbiddenPayloadKeys || []),
  }));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [tracePlanCatalogId, fixtureCatalogId, evaluatorCatalogId, closureCatalogId],
    eventSource: eventBundle.source,
    assetPolicy: 'Metadata only: plan ids, region ids, offsets, trace ids, decisions, counts, booleans, and policy flags. No ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      sourceTracePlanCount: tracePlanCatalog.summary?.tracePlanCount || 0,
      evaluatedTracePlanCount: evaluatedTracePlans.length,
      regionFilter,
      regionFilterApplied: regionFilter.length > 0,
      missingRegionIds,
      residualClosureCount: closureCatalog.summary?.residualCount || 0,
      residualClosureRuntimeProofRequiredCount: closureCatalog.summary?.runtimeProofRequiredCount || 0,
      fixtureReadyForRuntimeHarness: Boolean(fixtureCatalog.summary?.readyForRuntimeHarness),
      baselineEvaluatorCatalogId: evaluatorCatalogId,
      eventCount: evaluation.eventCount,
      normalizedEventCount: evaluation.normalizedEventCount,
      traceGroupCount: evaluation.traceGroupCount,
      decisionCount: decisions.length,
      decisionCounts: countBy(decisions, item => item.decision),
      runtimeTraceConfirmedCount: decisions.filter(item => item.runtimeTraceConfirmed).length,
      promotionReadyCount: decisions.filter(item => item.promotionReady).length,
      fieldOrAliasOnlyRejectedCount: decisions.filter(item => item.fieldOrAliasOnlyRejected).length,
      pendingInsufficientCount: decisions.filter(item => item.decision === 'pending_insufficient_runtime_evidence').length,
      forbiddenPayloadKeyCount: (evaluation.forbiddenPayloadKeys || []).length,
      forbiddenPayloadKeys: evaluation.forbiddenPayloadKeys || [],
      droppedFieldCount: evaluation.droppedFields?.length || 0,
      validationIssueCount: evaluation.validationIssues?.length || 0,
      residualSemanticDispositionMutated: false,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    decisions,
    eventNormalizationSummary: evaluation.eventNormalizationSummary,
    droppedFields: evaluation.droppedFields || [],
    validationIssues: evaluation.validationIssues || [],
    evaluatorSummary: {
      evaluatedPlanCount: evaluation.evaluatedPlanCount,
      statusCounts: evaluation.statusCounts,
      runtimeTraceConfirmedCount: evaluation.runtimeTraceConfirmedCount,
      promotionReadyCount: evaluation.promotionReadyCount,
      fieldOrAliasOnlyRejectedCount: evaluation.fieldOrAliasOnlyRejectedCount,
    },
    evidence: [
      `${tracePlanCatalogId} supplies the five residual target plans and runtime hook ids.`,
      `${fixtureCatalogId} verifies all required hook fixtures are present for runtime-harness use.`,
      `${evaluatorCatalogId} supplies the baseline evaluator contract and policy constraints.`,
      `${closureCatalogId} remains unchanged by this audit; confirmed updates require a follow-up proof mutation audit.`,
    ],
    nextLeads: [
      'If decisions contain confirmed_direct_consumer_ready_for_residual_update, update the region-specific residual proof catalog in a follow-up audit.',
      'If decisions contain confirmed_field_or_alias_rejection_keep_quarantined, keep the residual quarantined and attach trace ids as rejection evidence without promoting coverage.',
      'Keep no-event and insufficient-event runs as readiness metadata only.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const decision of catalog.decisions || []) {
    const region = findRegionById(mapData, decision.regionId);
    if (!region) {
      missingRegions.push({ id: decision.regionId, role: 'residual_runtime_trace_confirmation' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.residualRuntimeTraceConfirmationAudit = {
        catalogId,
        kind: 'residual_runtime_trace_confirmation',
        confidence: decision.decision === 'pending_insufficient_runtime_evidence' ? 'medium' : decision.confidence,
        summary: 'Metadata-only confirmation decisions for residual runtime trace events; residual semantic disposition is not mutated by this audit.',
        detail: {
          eventSource: catalog.eventSource,
          decision: decision.decision,
          reason: decision.reason,
          promotionAction: decision.promotionAction,
          finalStatus: decision.finalStatus,
          runtimeTraceConfirmed: decision.runtimeTraceConfirmed,
          promotionReady: decision.promotionReady,
          fieldOrAliasOnlyRejected: decision.fieldOrAliasOnlyRejected,
          selectedTraceIds: decision.selectedTraceIds,
          rejectedTraceIds: decision.rejectedTraceIds,
          insufficientTraceIds: decision.insufficientTraceIds,
          forbiddenPayloadKeyCount: catalog.summary.forbiddenPayloadKeyCount,
          residualSemanticDispositionMutated: false,
          coverageChangedByThisAudit: false,
        },
        evidence: catalog.evidence,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      decision: decision.decision,
      finalStatus: decision.finalStatus,
      role: 'residual_runtime_trace_confirmation',
    });
  }
  return { changedRegions, missingRegions };
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.residualRuntimeTraceConfirmationCatalog = catalogId;
  staticMap.summary.residualRuntimeTraceConfirmationDecisionCount = catalog.summary.decisionCount;
  staticMap.summary.residualRuntimeTraceConfirmationPromotionReady = catalog.summary.promotionReadyCount;
  staticMap.summary.residualRuntimeTraceConfirmationRejected = catalog.summary.fieldOrAliasOnlyRejectedCount;
  staticMap.summary.residualRuntimeTraceConfirmationPending = catalog.summary.pendingInsufficientCount;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-residual-runtime-trace-confirmation-catalog-2026-06-26 to turn clean-emulator residual trace events into confirm/reject decisions before mutating residual proof catalogs.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const eventBundle = loadEvents();
  eventBundle.regionIds = normalizeRegionFilters([
    ...argValues('--region'),
    ...argValues('--regions'),
  ]);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, eventBundle);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.runtimeTraceConfirmationCatalogs = (mapData.runtimeTraceConfirmationCatalogs || []).filter(item => item.id !== catalogId);
    mapData.runtimeTraceConfirmationCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'residual_runtime_trace_confirmation_audit',
      generatedAt: now,
      schemaVersion,
      tool: `${toolName} --apply`,
      catalogId,
      sourceCatalogs: catalog.sourceCatalogs,
      eventSource: catalog.eventSource,
      summary: catalog.summary,
      changedRegions: annotation.changedRegions,
      missingRegions: annotation.missingRegions,
      decisions: catalog.decisions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      assetPolicy: catalog.assetPolicy,
    });
    mapData.updatedAt = now;
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    eventSource: catalog.eventSource,
    summary: catalog.summary,
    decisions: catalog.decisions,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
