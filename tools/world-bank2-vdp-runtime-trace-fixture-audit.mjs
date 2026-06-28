#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const sourceCatalogId = 'world-bank2-vdp-runtime-trace-hook-plan-catalog-2026-06-26';
const catalogId = 'world-bank2-vdp-runtime-trace-fixture-catalog-2026-06-26';
const reportId = 'bank2-vdp-runtime-trace-fixture-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-runtime-trace-fixture-audit.mjs';
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

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value != null && value !== ''))].sort();
}

function normalizeHookFixture(hook) {
  return {
    id: `${hook.id}_fixture`,
    hookId: hook.id,
    label: hook.label,
    offset: hook.offset,
    eventKind: hook.eventKind,
    hookClass: hook.hookClass,
    runtimeHookStatus: hook.hookClass === 'runtime_trace_hook' ? 'runtime_hook_needed' : 'metadata_gate_ready',
    captureFields: hook.captureFields || [],
    triggerModel: hook.hookClass === 'runtime_trace_hook'
      ? 'Emit a metadata-only event when the clean emulator reaches the hook label with the capture fields available.'
      : 'Evaluate after same-frame runtime events have been collected for one trace plan.',
    outputPolicy: {
      persistOffsets: true,
      persistRoles: true,
      persistBooleans: true,
      persistRomBytes: false,
      persistStreamBytes: false,
      persistOpcodes: false,
      persistPortValues: false,
      persistRegisterTrace: false,
      persistPixels: false,
    },
    evidence: hook.asmLineEvidence || [],
  };
}

function normalizePlanFixture(plan, hookById) {
  const required = plan.requiredRuntimeHookIds || [];
  const optional = plan.optionalRuntimeHookIds || [];
  const gateId = 'bank2_vdp_residual_promotion_gate';
  const missingRequiredHookIds = required.filter(id => !hookById.has(id));
  const missingOptionalHookIds = optional.filter(id => !hookById.has(id));
  const hookEdges = [
    ...required.map(id => ({ hookId: id, required: true, present: hookById.has(id) })),
    ...optional.map(id => ({ hookId: id, required: false, present: hookById.has(id) })),
  ];
  return {
    id: `${plan.id}_fixture`,
    planId: plan.id,
    parentGapId: plan.parentGapId,
    parentGapRange: plan.parentGapRange,
    targetBoundaryOffsets: plan.targetBoundaryOffsets || [],
    traceStatus: plan.traceStatus,
    requiredRuntimeHookIds: required,
    optionalRuntimeHookIds: optional,
    hookEdges,
    gateEdges: [{ gateHookId: gateId, present: hookById.has(gateId), sameFrameRequired: true }],
    validation: {
      missingRequiredHookIds,
      missingOptionalHookIds,
      readyForRuntimeHarness: missingRequiredHookIds.length === 0,
      runtimeTraceConfirmed: false,
      promotionReady: false,
    },
    promotionGate: plan.promotionGate,
    persistedRomByteCount: 0,
    persistedStreamByteCount: 0,
    persistedOpcodeCount: 0,
    persistedPortValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedPixelCount: 0,
  };
}

function buildCatalog(mapData) {
  const sourceCatalog = requireCatalog(mapData, sourceCatalogId);
  const hookById = new Map((sourceCatalog.hookSpecs || []).map(hook => [hook.id, hook]));
  const hookFixtures = (sourceCatalog.runtimeHooks || []).map(normalizeHookFixture);
  const promotionGateFixtures = (sourceCatalog.promotionGates || []).map(normalizeHookFixture);
  const planFixtures = (sourceCatalog.tracePlans || []).map(plan => normalizePlanFixture(plan, hookById));
  const allHookEdges = planFixtures.flatMap(plan => plan.hookEdges || []);
  const allGateEdges = planFixtures.flatMap(plan => plan.gateEdges || []);
  const validationIssues = [
    ...planFixtures.flatMap(plan => (plan.validation.missingRequiredHookIds || []).map(hookId => ({
      kind: 'missing_required_hook',
      planId: plan.planId,
      hookId,
    }))),
    ...allGateEdges.filter(edge => !edge.present).map(edge => ({
      kind: 'missing_promotion_gate',
      gateHookId: edge.gateHookId,
    })),
  ];

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceCatalogId],
    assetPolicy: 'Metadata-only runtime fixture contract. No ROM bytes, stream bytes, opcodes, VDP port values, register traces, decoded pixels, screenshots, hashes, or copyrighted asset payloads are embedded.',
    summary: {
      sourceTracePlanCount: sourceCatalog.summary?.tracePlanCount || 0,
      tracePlanFixtureCount: planFixtures.length,
      runtimeHookFixtureCount: hookFixtures.length,
      promotionGateFixtureCount: promotionGateFixtures.length,
      planHookEdgeCount: allHookEdges.length,
      requiredPlanHookEdgeCount: allHookEdges.filter(edge => edge.required).length,
      optionalPlanHookEdgeCount: allHookEdges.filter(edge => !edge.required).length,
      planGateEdgeCount: allGateEdges.length,
      uniqueCaptureFieldCount: uniqueSorted([...hookFixtures, ...promotionGateFixtures].flatMap(hook => hook.captureFields)).length,
      uniqueCaptureFields: uniqueSorted([...hookFixtures, ...promotionGateFixtures].flatMap(hook => hook.captureFields)),
      targetBoundaryCount: sourceCatalog.summary?.targetBoundaryCount || 0,
      ramTraceSeedCount: sourceCatalog.summary?.ramTraceSeedCount || 0,
      readyForRuntimeHarness: validationIssues.length === 0,
      validationIssueCount: validationIssues.length,
      runtimeTraceConfirmedCount: 0,
      promotionReadyCount: 0,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedOpcodeCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
    },
    hookFixtures,
    promotionGateFixtures,
    planFixtures,
    validationIssues,
    evidence: [
      `${sourceCatalogId} supplies hook specs, promotion gate, RAM seeds, and trace plans for the four bank-2 VDP weak residual leads.`,
      'Each plan fixture requires same-frame _LABEL_978E_, _LABEL_97D9_, _LABEL_97E6_, and _LABEL_9812_ metadata events before any promotion gate can pass.',
      'All fixtures explicitly prohibit persisted stream bytes, VDP port values, register traces, and decoded pixels.',
    ],
    nextLeads: [
      'Wire these fixtures into the clean emulator trace harness and emit events using hookId/planId identifiers.',
      'Add a promotion-gate evaluator that accepts only metadata booleans and offsets, never stream byte values.',
      'After runtime evidence is captured, update the source hook-plan catalog and rerun residual final disposition.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegionById(mapData, 'r0186');
  const changedRegions = [];
  const missingRegions = [];
  if (!region) {
    missingRegions.push({ id: 'r0186', role: 'bank2_vdp_runtime_trace_fixture' });
  } else {
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.bank2VdpRuntimeTraceFixtureAudit = {
        catalogId,
        kind: 'bank2_vdp_runtime_trace_fixture',
        confidence: catalog.summary.readyForRuntimeHarness ? 'medium_high' : 'medium',
        summary: 'Runtime fixture contract for proving or rejecting four bank-2 VDP weak residual draw-boundary leads.',
        detail: {
          tracePlanFixtureCount: catalog.summary.tracePlanFixtureCount,
          runtimeHookFixtureCount: catalog.summary.runtimeHookFixtureCount,
          promotionGateFixtureCount: catalog.summary.promotionGateFixtureCount,
          planHookEdgeCount: catalog.summary.planHookEdgeCount,
          targetBoundaryCount: catalog.summary.targetBoundaryCount,
          readyForRuntimeHarness: catalog.summary.readyForRuntimeHarness,
          validationIssueCount: catalog.summary.validationIssueCount,
          runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
          promotionReadyCount: catalog.summary.promotionReadyCount,
          coverageChangedByThisAudit: catalog.summary.coverageChangedByThisAudit,
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
      role: 'bank2_vdp_runtime_trace_fixture',
    });
  }
  return { changedRegions, missingRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.runtimeTraceHookFixtureCatalogs = (mapData.runtimeTraceHookFixtureCatalogs || []).filter(item => item.id !== catalogId);
    mapData.runtimeTraceHookFixtureCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_runtime_trace_fixture_audit',
      generatedAt: now,
      schemaVersion,
      tool: `${toolName} --apply`,
      catalogId,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      changedRegions: annotation.changedRegions,
      missingRegions: annotation.missingRegions,
      validationIssues: catalog.validationIssues,
      sample: {
        hookFixtures: catalog.hookFixtures.map(hook => ({
          id: hook.id,
          hookId: hook.hookId,
          eventKind: hook.eventKind,
          captureFieldCount: hook.captureFields.length,
        })),
        planFixtures: catalog.planFixtures.map(plan => ({
          id: plan.id,
          planId: plan.planId,
          parentGapId: plan.parentGapId,
          targetBoundaryOffsets: plan.targetBoundaryOffsets,
          readyForRuntimeHarness: plan.validation.readyForRuntimeHarness,
        })),
      },
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      assetPolicy: catalog.assetPolicy,
    });
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    validationIssues: catalog.validationIssues,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
