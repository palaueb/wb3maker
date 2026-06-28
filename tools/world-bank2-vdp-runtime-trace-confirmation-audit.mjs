#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateBank2VdpTracePlans } from '../shared/wb3/bank2-vdp-trace-evaluator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const tracePlanCatalogId = 'world-bank2-vdp-runtime-trace-hook-plan-catalog-2026-06-26';
const fixtureCatalogId = 'world-bank2-vdp-runtime-trace-fixture-catalog-2026-06-26';
const evaluatorCatalogId = 'world-bank2-vdp-runtime-trace-evaluator-catalog-2026-06-26';
const finalDispositionCatalogId = 'world-bank2-vdp-residual-final-disposition-catalog-2026-06-26';
const catalogId = 'world-bank2-vdp-runtime-trace-confirmation-catalog-2026-06-26';
const reportId = 'bank2-vdp-runtime-trace-confirmation-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-runtime-trace-confirmation-audit.mjs';
const schemaVersion = 1;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function loadEvents() {
  const eventPath = argValue('--events');
  if (!eventPath) return { events: [], source: 'none' };
  const fullPath = path.resolve(process.cwd(), eventPath);
  return {
    events: readJson(fullPath),
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

function compactEvaluation(item) {
  return {
    planId: item.planId,
    parentGapId: item.parentGapId,
    targetBoundaryOffsets: item.targetBoundaryOffsets,
    finalStatus: item.finalStatus,
    confidence: item.confidence,
    runtimeTraceConfirmed: item.runtimeTraceConfirmed,
    promotionReady: item.promotionReady,
    fieldOnlyRejected: item.fieldOnlyRejected,
    selectedTraceIds: item.selectedTraceIds,
    fieldOnlyTraceIds: item.fieldOnlyTraceIds,
  };
}

function decisionForEvaluation(item, forbiddenPayloadKeys) {
  if (forbiddenPayloadKeys.length) {
    return {
      decision: 'rejected_for_forbidden_payload',
      confidence: 'high',
      promotionAction: 'none',
      reason: 'Trace event input contains forbidden payload keys and cannot be used as persisted evidence.',
    };
  }
  if (item.runtimeTraceConfirmed && item.promotionReady) {
    return {
      decision: 'confirmed_selected_boundary_ready_for_residual_update',
      confidence: item.confidence,
      promotionAction: 'update_residual_final_disposition_in_followup_audit',
      reason: 'Evaluator found same-frame _LABEL_97D9_ selected_segment_offset and _LABEL_97E6_ segment_entry_offset matching a target boundary.',
    };
  }
  if (item.fieldOnlyRejected) {
    return {
      decision: 'confirmed_field_only_rejection_keep_unpromoted',
      confidence: item.confidence,
      promotionAction: 'none',
      reason: 'Evaluator found target boundary only as a _LABEL_9812_ field offset from another segment entry.',
    };
  }
  return {
    decision: 'pending_insufficient_runtime_evidence',
    confidence: item.confidence,
    promotionAction: 'none',
    reason: 'No selected-boundary or field-only proof exists for this plan in the supplied events.',
  };
}

export function buildCatalog(mapData, eventBundle) {
  const tracePlanCatalog = requireCatalog(mapData, tracePlanCatalogId);
  const fixtureCatalog = requireCatalog(mapData, fixtureCatalogId);
  const evaluatorCatalog = requireCatalog(mapData, evaluatorCatalogId);
  const finalDispositionCatalog = requireCatalog(mapData, finalDispositionCatalogId);
  const evaluation = evaluateBank2VdpTracePlans(tracePlanCatalog.tracePlans || [], eventBundle.events || []);
  const decisions = (evaluation.evaluations || []).map(item => ({
    ...compactEvaluation(item),
    ...decisionForEvaluation(item, evaluation.forbiddenPayloadKeys || []),
  }));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [tracePlanCatalogId, fixtureCatalogId, evaluatorCatalogId, finalDispositionCatalogId],
    eventSource: eventBundle.source,
    assetPolicy: 'Metadata only: plan ids, gap ids, offsets, trace ids, decisions, counts, and policy flags. No ROM bytes, stream bytes, opcodes, VDP port values, register traces, decoded pixels, samples, hashes, or copyrighted payloads are persisted.',
    summary: {
      sourceTracePlanCount: tracePlanCatalog.summary?.tracePlanCount || 0,
      finalDispositionUnresolvedTraceLeadCount: finalDispositionCatalog.summary?.unresolvedTraceLeadCount || 0,
      fixtureReadyForRuntimeHarness: Boolean(fixtureCatalog.summary?.readyForRuntimeHarness),
      baselineEvaluatorCatalogId: evaluatorCatalogId,
      eventCount: evaluation.eventCount,
      traceGroupCount: evaluation.traceGroupCount,
      decisionCount: decisions.length,
      decisionCounts: countBy(decisions, item => item.decision),
      runtimeTraceConfirmedCount: decisions.filter(item => item.runtimeTraceConfirmed).length,
      promotionReadyCount: decisions.filter(item => item.promotionReady).length,
      fieldOnlyRejectedCount: decisions.filter(item => item.fieldOnlyRejected).length,
      pendingInsufficientCount: decisions.filter(item => item.decision === 'pending_insufficient_runtime_evidence').length,
      forbiddenPayloadKeyCount: (evaluation.forbiddenPayloadKeys || []).length,
      forbiddenPayloadKeys: evaluation.forbiddenPayloadKeys || [],
      residualFinalDispositionMutated: false,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedOpcodeCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
    },
    decisions,
    evaluatorSummary: {
      evaluatedPlanCount: evaluation.evaluatedPlanCount,
      statusCounts: evaluation.statusCounts,
      runtimeTraceConfirmedCount: evaluation.runtimeTraceConfirmedCount,
      promotionReadyCount: evaluation.promotionReadyCount,
      fieldOnlyRejectedCount: evaluation.fieldOnlyRejectedCount,
    },
    evidence: [
      `${tracePlanCatalogId} supplies the target boundaries and runtime hook contract.`,
      `${fixtureCatalogId} verifies all required hook fixtures are present for runtime-harness use.`,
      `${evaluatorCatalogId} supplies the baseline evaluator contract and policy constraints.`,
      `${finalDispositionCatalogId} remains unchanged by this audit; confirmed updates require a follow-up mutation audit.`,
    ],
    nextLeads: [
      'If decisions contain confirmed_selected_boundary_ready_for_residual_update, run a follow-up residual disposition update audit.',
      'If decisions contain confirmed_field_only_rejection_keep_unpromoted, attach trace ids as rejection evidence without promoting coverage.',
      'Keep no-event and insufficient-event runs as baseline readiness metadata only.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegionById(mapData, 'r0186');
  const changedRegions = [];
  const missingRegions = [];
  if (!region) {
    missingRegions.push({ id: 'r0186', role: 'bank2_vdp_runtime_trace_confirmation' });
  } else {
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.bank2VdpRuntimeTraceConfirmationAudit = {
        catalogId,
        kind: 'bank2_vdp_runtime_trace_confirmation',
        confidence: catalog.summary.promotionReadyCount ? 'high' : 'medium',
        summary: 'Metadata-only confirmation decisions for bank-2 VDP residual runtime trace events; residual final disposition is not mutated by this audit.',
        detail: {
          eventSource: catalog.eventSource,
          eventCount: catalog.summary.eventCount,
          traceGroupCount: catalog.summary.traceGroupCount,
          decisionCounts: catalog.summary.decisionCounts,
          runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
          promotionReadyCount: catalog.summary.promotionReadyCount,
          fieldOnlyRejectedCount: catalog.summary.fieldOnlyRejectedCount,
          pendingInsufficientCount: catalog.summary.pendingInsufficientCount,
          forbiddenPayloadKeyCount: catalog.summary.forbiddenPayloadKeyCount,
          residualFinalDispositionMutated: false,
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
      role: 'bank2_vdp_runtime_trace_confirmation',
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
    mapData.runtimeTraceConfirmationCatalogs = (mapData.runtimeTraceConfirmationCatalogs || []).filter(item => item.id !== catalogId);
    mapData.runtimeTraceConfirmationCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_runtime_trace_confirmation_audit',
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
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
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
