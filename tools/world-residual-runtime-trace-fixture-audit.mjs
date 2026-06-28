#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-residual-runtime-trace-fixture-audit.mjs';
const sourceCatalogId = 'world-residual-runtime-trace-hook-plan-catalog-2026-06-26';
const catalogId = 'world-residual-runtime-trace-fixture-catalog-2026-06-26';
const reportId = 'residual-runtime-trace-fixture-audit-2026-06-26';

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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function normalizeHookFixture(hook) {
  return {
    id: `${hook.id}_fixture`,
    hookId: hook.id,
    label: hook.label,
    offset: hook.offset,
    regionId: hook.regionId || null,
    eventKind: hook.eventKind,
    hookClass: hook.hookClass,
    appliesToRegionIds: hook.appliesToRegionIds || [],
    captureFields: hook.captureFields || [],
    runtimeHookStatus: hook.hookClass === 'metadata_promotion_gate' ? 'metadata_gate_ready' : 'runtime_hook_needed',
    triggerModel: hook.hookClass === 'metadata_promotion_gate'
      ? 'Evaluate after same-frame residual runtime events have been collected for one trace plan.'
      : 'Emit a metadata-only event when the clean emulator reaches this hook label or watchpoint.',
    outputPolicy: {
      persistOffsets: true,
      persistLabels: true,
      persistRegionIds: true,
      persistBooleans: true,
      persistRomBytes: false,
      persistStreamBytes: false,
      persistTileIds: false,
      persistPaletteValues: false,
      persistPortValues: false,
      persistRegisterTrace: false,
      persistPixels: false,
    },
    evidence: hook.asmEvidence || [],
  };
}

function normalizePlanFixture(plan, hookById) {
  const required = plan.requiredRuntimeHookIds || [];
  const optional = plan.optionalRuntimeHookIds || [];
  const missingRequiredHookIds = required.filter(id => !hookById.has(id));
  const missingOptionalHookIds = optional.filter(id => !hookById.has(id));
  return {
    id: `${plan.id}_fixture`,
    planId: plan.id,
    regionId: plan.region?.id || '',
    classId: plan.classId || '',
    targetOffsets: plan.targetOffsets || [],
    traceStatus: plan.traceStatus,
    requiredRuntimeHookIds: required,
    optionalRuntimeHookIds: optional,
    hookEdges: [
      ...required.map(id => ({ hookId: id, required: true, present: hookById.has(id) })),
      ...optional.map(id => ({ hookId: id, required: false, present: hookById.has(id) })),
    ],
    validation: {
      missingRequiredHookIds,
      missingOptionalHookIds,
      readyForRuntimeHarness: missingRequiredHookIds.length === 0,
      runtimeTraceConfirmed: false,
      promotionReady: false,
    },
    promotionGate: plan.promotionGate || {},
    persistedRomByteCount: 0,
    persistedStreamByteCount: 0,
    persistedTileIdCount: 0,
    persistedPaletteByteCount: 0,
    persistedPortValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedPixelCount: 0,
  };
}

function buildCatalog(mapData) {
  const source = requireCatalog(mapData, sourceCatalogId);
  const hookById = new Map((source.hookSpecs || []).map(hook => [hook.id, hook]));
  const hookFixtures = (source.runtimeHooks || []).map(normalizeHookFixture);
  const promotionGateFixtures = (source.promotionGates || []).map(normalizeHookFixture);
  const planFixtures = (source.tracePlans || []).map(plan => normalizePlanFixture(plan, hookById));
  const hookEdges = planFixtures.flatMap(plan => plan.hookEdges || []);
  const validationIssues = [
    ...planFixtures.flatMap(plan => (plan.validation.missingRequiredHookIds || []).map(hookId => ({
      kind: 'missing_required_hook',
      planId: plan.planId,
      hookId,
    }))),
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceCatalogId],
    assetPolicy: 'Metadata-only runtime fixture contract. No ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are embedded.',
    summary: {
      sourceTracePlanCount: source.summary?.tracePlanCount || 0,
      tracePlanFixtureCount: planFixtures.length,
      runtimeHookFixtureCount: hookFixtures.length,
      promotionGateFixtureCount: promotionGateFixtures.length,
      requiredPlanHookEdgeCount: hookEdges.filter(edge => edge.required).length,
      optionalPlanHookEdgeCount: hookEdges.filter(edge => !edge.required).length,
      uniqueCaptureFieldCount: uniqueSorted([...hookFixtures, ...promotionGateFixtures].flatMap(hook => hook.captureFields)).length,
      targetOffsetCount: source.summary?.targetOffsetCount || 0,
      readyForRuntimeHarness: validationIssues.length === 0,
      validationIssueCount: validationIssues.length,
      fixtureRegionCount: new Set(planFixtures.map(plan => plan.regionId).filter(Boolean)).size,
      hookEventKindCounts: countBy(hookFixtures, hook => hook.eventKind),
      runtimeTraceConfirmedCount: 0,
      promotionReadyCount: 0,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
    },
    hookFixtures,
    promotionGateFixtures,
    planFixtures,
    validationIssues,
    evidence: [
      `${sourceCatalogId} supplies the residual hook specs and five trace plans.`,
      'Each plan fixture requires its region-specific hooks plus the metadata promotion gate before any semantic update can be considered.',
      'All fixtures explicitly prohibit persisted payload bytes, VDP port values, register traces, decoded pixels, screenshots, audio bytes, and samples.',
    ],
    nextLeads: [
      'Feed clean-emulator metadata events into shared/wb3/residual-runtime-trace-evaluator.js.',
      'Add a confirmation audit after real events prove direct-consumer confirmation or field/alias-only rejection.',
      'Keep residual semantic confidence low until a confirmation audit changes the specific residual proof catalog.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const regionIds = uniqueSorted([
    ...catalog.planFixtures.map(plan => plan.regionId),
    ...catalog.hookFixtures.map(hook => hook.regionId),
  ]);
  for (const id of regionIds) {
    const region = findRegion(mapData, id);
    if (!region) {
      missingRegions.push({ id, role: 'residual_runtime_trace_fixture' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.residualRuntimeTraceFixtureAudit = {
        catalogId,
        kind: 'residual_runtime_trace_fixture_participant',
        confidence: catalog.summary.readyForRuntimeHarness ? 'medium_high' : 'medium',
        readyForRuntimeHarness: catalog.summary.readyForRuntimeHarness,
        validationIssueCount: catalog.summary.validationIssueCount,
        promotionReady: false,
        coverageChangedByThisAudit: false,
        summary: 'Region participates in the residual runtime trace fixture contract; no semantic promotion is made by this audit.',
        evidence: catalog.evidence,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({ id: region.id, offset: region.offset, type: region.type });
  }
  return { changedRegions, missingRegions };
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.residualRuntimeTraceFixtureCatalog = catalogId;
  staticMap.summary.residualRuntimeTraceFixturePlans = catalog.summary.tracePlanFixtureCount;
  staticMap.summary.residualRuntimeTraceFixtureHooks = catalog.summary.runtimeHookFixtureCount;
  staticMap.summary.residualRuntimeTraceFixtureReady = catalog.summary.readyForRuntimeHarness;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-residual-runtime-trace-fixture-catalog-2026-06-26 with shared/wb3/residual-runtime-trace-evaluator.js when clean-emulator residual trace events are available.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);
  if (apply) {
    mapData.runtimeTraceHookFixtureCatalogs = (mapData.runtimeTraceHookFixtureCatalogs || []).filter(item => item.id !== catalogId);
    mapData.runtimeTraceHookFixtureCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      generatedAt: now,
      tool: toolName,
      schemaVersion: 1,
      catalogId,
      sourceCatalogs: [sourceCatalogId],
      summary: {
        ...catalog.summary,
        changedRegionCount: annotation.changedRegions.length,
        missingRegionCount: annotation.missingRegions.length,
      },
      changedRegions: annotation.changedRegions,
      missingRegions: annotation.missingRegions,
      validationIssues: catalog.validationIssues,
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
    reportId,
    summary: catalog.summary,
    validationIssues: catalog.validationIssues,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
