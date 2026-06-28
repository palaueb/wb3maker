#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { evaluateBank2VdpTracePlans } from '../shared/wb3/bank2-vdp-trace-evaluator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const sourceCatalogId = 'world-bank2-vdp-runtime-trace-hook-plan-catalog-2026-06-26';
const fixtureCatalogId = 'world-bank2-vdp-runtime-trace-fixture-catalog-2026-06-26';
const catalogId = 'world-bank2-vdp-runtime-trace-evaluator-catalog-2026-06-26';
const reportId = 'bank2-vdp-runtime-trace-evaluator-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-runtime-trace-evaluator.mjs';
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

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function buildCatalog(mapData, eventBundle) {
  const sourceCatalog = requireCatalog(mapData, sourceCatalogId);
  const fixtureCatalog = requireCatalog(mapData, fixtureCatalogId);
  const evaluation = evaluateBank2VdpTracePlans(sourceCatalog.tracePlans || [], eventBundle.events || []);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceCatalogId, fixtureCatalogId],
    eventSource: eventBundle.source,
    assetPolicy: 'Metadata-only evaluator contract. The evaluator accepts only hook ids, trace ids, offsets, field roles, and booleans; forbidden payload keys reject the evaluation and no ROM bytes, stream bytes, opcodes, VDP port values, register traces, decoded pixels, samples, or asset payloads are persisted.',
    evaluatorModule: 'shared/wb3/bank2-vdp-trace-evaluator.js',
    summary: {
      sourceTracePlanCount: sourceCatalog.summary?.tracePlanCount || 0,
      fixtureReadyForRuntimeHarness: Boolean(fixtureCatalog.summary?.readyForRuntimeHarness),
      evaluatedPlanCount: evaluation.evaluatedPlanCount,
      eventCount: evaluation.eventCount,
      traceGroupCount: evaluation.traceGroupCount,
      statusCounts: evaluation.statusCounts,
      runtimeTraceConfirmedCount: evaluation.runtimeTraceConfirmedCount,
      promotionReadyCount: evaluation.promotionReadyCount,
      fieldOnlyRejectedCount: evaluation.fieldOnlyRejectedCount,
      forbiddenPayloadKeyCount: evaluation.forbiddenPayloadKeys.length,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedOpcodeCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
    },
    evaluation,
    evaluatorRules: [
      'A plan is confirmed only when _LABEL_97D9_ selected_segment_offset matches a target boundary and _LABEL_97E6_ segment_entry_offset matches it in the same frame trace.',
      'A target reached only as a _LABEL_9812_ field_offset from another segment_entry_offset is rejected as field-only context.',
      'Missing renderer, pointer-list, or segment-entry hook events leave the plan insufficient.',
      'Any forbidden payload key rejects the evaluation for persistence.',
    ],
    evidence: [
      `${sourceCatalogId} supplies the target boundary offsets and required hook ids.`,
      `${fixtureCatalogId} confirms the hook/plan/gate fixture contract is internally complete.`,
      'shared/wb3/bank2-vdp-trace-evaluator.js implements the metadata-only promotion-gate rules.',
    ],
    nextLeads: [
      'Feed real clean-emulator hook events into this evaluator with --events.',
      'When selected-boundary confirmations exist, write a separate confirmation audit that updates residual final disposition.',
      'When field-only rejections exist, keep boundaries unpromoted and document the rejected trace ids without storing payload bytes.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegionById(mapData, 'r0186');
  const changedRegions = [];
  const missingRegions = [];
  if (!region) {
    missingRegions.push({ id: 'r0186', role: 'bank2_vdp_runtime_trace_evaluator' });
  } else {
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.bank2VdpRuntimeTraceEvaluatorAudit = {
        catalogId,
        kind: 'bank2_vdp_runtime_trace_evaluator',
        confidence: catalog.summary.fixtureReadyForRuntimeHarness ? 'medium_high' : 'medium',
        summary: 'Metadata-only evaluator for bank-2 VDP residual runtime trace events.',
        detail: {
          evaluatedPlanCount: catalog.summary.evaluatedPlanCount,
          eventCount: catalog.summary.eventCount,
          traceGroupCount: catalog.summary.traceGroupCount,
          statusCounts: catalog.summary.statusCounts,
          runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
          promotionReadyCount: catalog.summary.promotionReadyCount,
          fieldOnlyRejectedCount: catalog.summary.fieldOnlyRejectedCount,
          forbiddenPayloadKeyCount: catalog.summary.forbiddenPayloadKeyCount,
          coverageChangedByThisAudit: catalog.summary.coverageChangedByThisAudit,
        },
        evaluatorModule: catalog.evaluatorModule,
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
      role: 'bank2_vdp_runtime_trace_evaluator',
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
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_runtime_trace_evaluator_audit',
      generatedAt: now,
      schemaVersion,
      tool: `${toolName} --apply`,
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
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
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
