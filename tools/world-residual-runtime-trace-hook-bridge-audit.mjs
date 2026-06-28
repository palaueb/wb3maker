#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildResidualRuntimeTraceHookManifest } from '../shared/wb3/residual-runtime-trace-hooks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const eventContractCatalogId = 'world-residual-runtime-trace-event-contract-catalog-2026-06-26';
const confirmationCatalogId = 'world-residual-runtime-trace-confirmation-catalog-2026-06-26';
const catalogId = 'world-residual-runtime-trace-hook-bridge-catalog-2026-06-26';
const reportId = 'residual-runtime-trace-hook-bridge-audit-2026-06-26';
const toolName = 'tools/world-residual-runtime-trace-hook-bridge-audit.mjs';

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

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function buildCatalog(mapData) {
  const eventContract = requireCatalog(mapData, eventContractCatalogId);
  const confirmation = requireCatalog(mapData, confirmationCatalogId);
  const manifest = buildResidualRuntimeTraceHookManifest(eventContract);
  const regionIds = uniqueSorted([
    ...manifest.hooks.map(hook => hook.regionId),
    ...manifest.tracePlans.map(plan => plan.regionId),
  ]);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [eventContractCatalogId, confirmationCatalogId],
    sourceModules: [
      'shared/wb3/residual-runtime-trace-hooks.js',
      'shared/wb3/residual-runtime-trace-events.js',
      'shared/wb3/residual-runtime-observation-review.js',
      'tools/world-residual-runtime-trace-local-bundle.mjs',
      'tools/world-residual-runtime-trace-observation-audit.mjs',
    ],
    assetPolicy: 'Metadata-only hook bridge manifest. It stores hook ids, labels, offsets, region ids, capture field names, readiness flags, and counts only. No ROM bytes, decoded graphics, tile ids, palette values, VDP port values, register traces, pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are embedded.',
    summary: {
      hookCount: manifest.hookCount,
      runtimeHookCount: manifest.runtimeHookCount,
      promotionGateCount: manifest.promotionGateCount,
      tracePlanCount: manifest.tracePlanCount,
      bridgeRegionCount: regionIds.length,
      readyForCleanRuntimeBridge: manifest.readyForCleanRuntimeBridge,
      captureFieldIssueCount: manifest.captureFieldIssues.length,
      baselineConfirmationDecisionCount: confirmation.summary?.decisionCount || 0,
      baselineConfirmationPendingCount: confirmation.summary?.pendingInsufficientCount || 0,
      localBundleBuilderReady: true,
      localBundleRejectsForbiddenPayloadInput: true,
      localBundleSupportsReviewedRuntimeObservationMarker: true,
      localBundleReviewedRuntimeObservationFlag: '--reviewed-runtime-observations',
      localBundleReviewedRuntimeObservationMarkerRequiresCleanGate: true,
      localBundleReviewedRuntimeObservationGateModule: 'shared/wb3/residual-runtime-observation-review.js',
      localBundleReviewedRuntimeObservationGateChecks: [
        'no_template_input',
        'no_forbidden_payload_keys',
        'no_unknown_hooks',
        'no_unsupported_review_fields',
        'no_unfilled_placeholders',
        'required_capture_fields_present',
        'promotion_gate_coherent_with_same_frame_hooks',
        'at_least_one_complete_runtime_trace_group',
      ],
      localObservationTemplateReady: true,
      localObservationTemplateDefaultOutput: 'tmp/local-hook-observations.template.json',
      localObservationAuditReady: true,
      localObservationAuditDefaultOutput: 'tmp/world-residual-runtime-trace-observation-audit.local.json',
      localBundleDefaultOutput: 'tmp/world-residual-runtime-trace-events.local.json',
      hookBridgeRejectsForbiddenPayloadSnapshots: true,
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
    manifest,
    regionParticipation: regionIds.map(regionId => ({
      regionId,
      hookIds: manifest.hooks.filter(hook => hook.regionId === regionId).map(hook => hook.hookId),
      tracePlanIds: manifest.tracePlans.filter(plan => plan.regionId === regionId).map(plan => plan.planId),
    })),
    evidence: [
      `${eventContractCatalogId} defines the allowed metadata event fields and hook ids.`,
      'shared/wb3/residual-runtime-trace-hooks.js builds the clean-runtime hook manifest and emits whitelisted metadata events through the collector.',
      'shared/wb3/residual-runtime-trace-hooks.js rejects hook snapshots that include forbidden payload keys before collector emission.',
      'shared/wb3/residual-runtime-observation-review.js is the single reviewed-observation gate used by both the local bundle reviewed marker and the local observation audit.',
      'tools/world-residual-runtime-trace-local-bundle.mjs turns local clean-runtime hook observations into a metadata-only collector bundle under repo tmp/.',
      'tools/world-residual-runtime-trace-local-bundle.mjs rejects local observation input containing forbidden payload keys before writing any event bundle.',
      'tools/world-residual-runtime-trace-local-bundle.mjs can mark a real reviewed metadata event bundle with reviewedRuntimeObservations=true via --reviewed-runtime-observations only after local review-gate checks pass; templates cannot be marked reviewed.',
      'tools/world-residual-runtime-trace-local-bundle.mjs --template emits a metadata-only local observation skeleton under repo tmp/ without runtime payloads.',
      'tools/world-residual-runtime-trace-observation-audit.mjs validates filled local observations before bundling, checking forbidden payload keys and required hook groups.',
      `${confirmationCatalogId} remains pending until real collector bundles are supplied.`,
    ],
    nextLeads: [
      'Attach bridge.emitHook() calls to clean-runtime callbacks at each manifest label/offset.',
      'For watchpoint hooks, call bridge.emitHook() from the memory/address observer when the target residual offset is accessed.',
      'Run tools/world-residual-runtime-trace-local-bundle.mjs --template --out tmp/local-hook-observations.template.json, copy it to tmp/local-hook-observations.json, and fill it with real metadata-only observations.',
      'Run tools/world-residual-runtime-trace-observation-audit.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-trace-observation-audit.local.json before bundling.',
      'Use tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-trace-events.local.json to normalize local trace observations.',
      'After reviewing a clean observation audit, rerun the bundler with --reviewed-runtime-observations before applying proof metadata.',
      'Use bridge.bundle() output as local input to tools/world-residual-runtime-trace-confirmation-audit.mjs --events.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const item of catalog.regionParticipation || []) {
    const region = findRegion(mapData, item.regionId);
    if (!region) {
      missingRegions.push({ id: item.regionId, role: 'residual_runtime_trace_hook_bridge' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.residualRuntimeTraceHookBridgeAudit = {
      catalogId,
      kind: 'residual_runtime_trace_hook_bridge',
      confidence: catalog.summary.readyForCleanRuntimeBridge ? 'medium_high' : 'medium',
      hookIds: item.hookIds,
      tracePlanIds: item.tracePlanIds,
      bridgeModule: 'shared/wb3/residual-runtime-trace-hooks.js',
      readyForCleanRuntimeBridge: catalog.summary.readyForCleanRuntimeBridge,
      localBundleSupportsReviewedRuntimeObservationMarker: catalog.summary.localBundleSupportsReviewedRuntimeObservationMarker,
      localBundleReviewedRuntimeObservationFlag: catalog.summary.localBundleReviewedRuntimeObservationFlag,
      localBundleReviewedRuntimeObservationMarkerRequiresCleanGate: catalog.summary.localBundleReviewedRuntimeObservationMarkerRequiresCleanGate,
      localBundleReviewedRuntimeObservationGateModule: catalog.summary.localBundleReviewedRuntimeObservationGateModule,
      captureFieldIssueCount: catalog.summary.captureFieldIssueCount,
      summary: 'Region participates in the residual clean-runtime hook bridge manifest.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      hookIds: item.hookIds,
      tracePlanIds: item.tracePlanIds,
    });
  }

  mapData.runtimeTraceHookBridgeCatalogs = (mapData.runtimeTraceHookBridgeCatalogs || []).filter(item => item.id !== catalogId);
  mapData.runtimeTraceHookBridgeCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'residual_runtime_trace_hook_bridge_audit',
    generatedAt: now,
    schemaVersion: 1,
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
  staticMap.summary.residualRuntimeTraceHookBridgeCatalog = catalogId;
  staticMap.summary.residualRuntimeTraceHookBridgeHooks = catalog.summary.hookCount;
  staticMap.summary.residualRuntimeTraceHookBridgeReady = catalog.summary.readyForCleanRuntimeBridge;
  staticMap.summary.residualRuntimeTraceLocalBundleBuilderReady = catalog.summary.localBundleBuilderReady;
  staticMap.summary.residualRuntimeTraceLocalBundleRejectsForbiddenPayloadInput = catalog.summary.localBundleRejectsForbiddenPayloadInput;
  staticMap.summary.residualRuntimeTraceLocalBundleSupportsReviewedRuntimeObservationMarker = catalog.summary.localBundleSupportsReviewedRuntimeObservationMarker;
  staticMap.summary.residualRuntimeTraceLocalBundleReviewedRuntimeObservationFlag = catalog.summary.localBundleReviewedRuntimeObservationFlag;
  staticMap.summary.residualRuntimeTraceLocalBundleReviewedRuntimeObservationMarkerRequiresCleanGate = catalog.summary.localBundleReviewedRuntimeObservationMarkerRequiresCleanGate;
  staticMap.summary.residualRuntimeTraceLocalBundleReviewedRuntimeObservationGateModule = catalog.summary.localBundleReviewedRuntimeObservationGateModule;
  staticMap.summary.residualRuntimeTraceLocalObservationTemplateReady = catalog.summary.localObservationTemplateReady;
  staticMap.summary.residualRuntimeTraceLocalObservationTemplateDefaultOutput = catalog.summary.localObservationTemplateDefaultOutput;
  staticMap.summary.residualRuntimeTraceLocalObservationAuditReady = catalog.summary.localObservationAuditReady;
  staticMap.summary.residualRuntimeTraceLocalObservationAuditDefaultOutput = catalog.summary.localObservationAuditDefaultOutput;
  staticMap.summary.residualRuntimeTraceLocalBundleDefaultOutput = catalog.summary.localBundleDefaultOutput;
  staticMap.summary.residualRuntimeTraceHookBridgeRejectsForbiddenPayloadSnapshots = catalog.summary.hookBridgeRejectsForbiddenPayloadSnapshots;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use shared/wb3/residual-runtime-trace-hooks.js to bridge clean-runtime callbacks into metadata-only residual trace collector events.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  const bundleLead = 'Use tools/world-residual-runtime-trace-local-bundle.mjs to normalize local clean-runtime hook observations into repo-local tmp/ bundles before running confirmation audits.';
  if (!staticMap.nextLeads.includes(bundleLead)) staticMap.nextLeads.push(bundleLead);
  const reviewedBundleLead = 'Use tools/world-residual-runtime-trace-local-bundle.mjs --reviewed-runtime-observations only after reviewing a clean local observation audit; this marks the metadata event bundle as apply-eligible for proof planning.';
  if (!staticMap.nextLeads.includes(reviewedBundleLead)) staticMap.nextLeads.push(reviewedBundleLead);
  const templateLead = 'Generate tmp/local-hook-observations.template.json with tools/world-residual-runtime-trace-local-bundle.mjs --template, then fill a separate tmp/local-hook-observations.json from real clean-runtime hook observations.';
  if (!staticMap.nextLeads.includes(templateLead)) staticMap.nextLeads.push(templateLead);
  const auditLead = 'Validate filled residual trace observations with tools/world-residual-runtime-trace-observation-audit.mjs before bundling or running confirmation audits.';
  if (!staticMap.nextLeads.includes(auditLead)) staticMap.nextLeads.push(auditLead);
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
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
