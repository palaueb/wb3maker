#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLocalResidualRuntimeTraceObservationTemplate } from './world-residual-runtime-trace-local-bundle.mjs';
import { buildResidualRuntimeTraceObservationAudit } from './world-residual-runtime-trace-observation-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const catalogId = 'world-residual-runtime-trace-observation-audit-catalog-2026-06-26';
const reportId = 'residual-runtime-trace-observation-audit-catalog-2026-06-26';
const hookBridgeCatalogId = 'world-residual-runtime-trace-hook-bridge-catalog-2026-06-26';
const eventContractCatalogId = 'world-residual-runtime-trace-event-contract-catalog-2026-06-26';
const confirmationCatalogId = 'world-residual-runtime-trace-confirmation-catalog-2026-06-26';
const toolName = 'tools/world-residual-runtime-trace-observation-audit-catalog.mjs';

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
  const hookBridge = requireCatalog(mapData, hookBridgeCatalogId);
  const eventContract = requireCatalog(mapData, eventContractCatalogId);
  const confirmation = requireCatalog(mapData, confirmationCatalogId);
  const template = buildLocalResidualRuntimeTraceObservationTemplate(mapData);
  const templateAudit = buildResidualRuntimeTraceObservationAudit(mapData, template, {
    source: 'tmp/local-hook-observations.template.json',
  });
  const targetRegionIds = uniqueSorted((template.traceGroups || []).map(group => group.regionId));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [hookBridgeCatalogId, eventContractCatalogId, confirmationCatalogId],
    sourceModules: [
      'tools/world-residual-runtime-trace-observation-audit.mjs',
      'tools/world-residual-runtime-trace-local-bundle.mjs',
      'shared/wb3/residual-runtime-trace-events.js',
      'shared/wb3/residual-runtime-trace-evaluator.js',
    ],
    assetPolicy: 'Metadata-only observation-audit catalog. It stores tool paths, hook ids, plan ids, region ids, target offsets, counts, booleans, and policy flags only. No ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are embedded.',
    summary: {
      observationAuditReady: true,
      templateOnlyBaselineUsableAsRuntimeEvidence: templateAudit.summary.inputUsableAsRuntimeEvidence,
      templateHasUnfilledPlaceholders: templateAudit.summary.inputHasUnfilledTemplatePlaceholders === true,
      templateUnresolvedPlaceholderCount: templateAudit.summary.unresolvedPlaceholderCount || 0,
      templateTraceIdPlaceholderCount: templateAudit.summary.templateTraceIdCount || 0,
      templateMissingRequiredFieldCount: templateAudit.summary.missingRequiredFieldCount || 0,
      templateRequiredFieldIssueCount: templateAudit.summary.requiredFieldIssueCount || 0,
      templateObservationCount: template.summary.observationCount,
      templateTraceGroupCount: templateAudit.summary.traceGroupCount,
      tracePlanCount: template.summary.tracePlanCount,
      targetRegionCount: targetRegionIds.length,
      templateCompletePlanCount: templateAudit.summary.completePlanCount,
      targetAwareCompleteness: true,
      supportsFocusedRegionFilter: true,
      focusedRegionFilterAppliesToPlanCompleteness: true,
      focusedRegionFilterAppliesToConfirmation: true,
      focusedRegionFilterFiltersObservationGroups: true,
      focusedRegionFilterKeepsSameFrameGroups: true,
      rejectsTemplateAsRuntimeEvidence: true,
      rejectsCopiedTemplatePlaceholders: true,
      rejectsMissingRequiredCaptureFields: true,
      rejectsForbiddenPayloadKeys: true,
      rejectsIncoherentPromotionGates: true,
      defaultTemplatePath: 'tmp/local-hook-observations.template.json',
      defaultObservationInputPath: 'tmp/local-hook-observations.json',
      defaultObservationAuditOutputPath: 'tmp/world-residual-runtime-trace-observation-audit.local.json',
      defaultBundleOutputPath: 'tmp/world-residual-runtime-trace-events.local.json',
      hookBridgeReady: hookBridge.summary?.readyForCleanRuntimeBridge === true,
      eventContractForbiddenPayloadKeyCount: eventContract.summary?.forbiddenPayloadKeyCount || 0,
      baselineConfirmationPendingCount: confirmation.summary?.pendingInsufficientCount || 0,
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
    targetRegions: targetRegionIds.map(regionId => {
      const group = (template.traceGroups || []).find(item => item.regionId === regionId) || {};
      const completeness = (templateAudit.planCompleteness || []).find(item => item.regionId === regionId) || {};
      return {
        regionId,
        planId: group.planId || completeness.planId || '',
        classId: group.classId || completeness.classId || '',
        targetOffsets: group.targetOffsets || completeness.targetOffsets || [],
        requiredRuntimeHookIds: group.requiredRuntimeHookIds || completeness.requiredRuntimeHookIds || [],
        templateTraceId: group.same_frame_trace_id || '',
        templateCompleteObservationGroupCount: completeness.completeObservationGroupCount || 0,
      };
    }),
    commands: {
      generateTemplate: 'node tools/world-residual-runtime-trace-local-bundle.mjs --template --out tmp/local-hook-observations.template.json',
      validateObservations: 'node tools/world-residual-runtime-trace-observation-audit.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-trace-observation-audit.local.json',
      buildBundle: 'node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-trace-events.local.json',
      confirmBundle: 'node tools/world-residual-runtime-trace-confirmation-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json',
    },
    evidence: [
      `${hookBridgeCatalogId} supplies the bridge readiness, hook manifest, and local tool paths.`,
      `${eventContractCatalogId} supplies the allowed metadata fields and forbidden payload key policy.`,
      `${confirmationCatalogId} remains pending because no real local runtime bundle has been supplied.`,
      'tools/world-residual-runtime-trace-observation-audit.mjs evaluates same-frame required-hook completeness and target region/offset matching before bundling.',
      'tools/world-residual-runtime-trace-observation-audit.mjs filters focused --region audits to matching same-frame trace groups before required-field, placeholder, and promotion-gate checks.',
      'tools/world-residual-runtime-trace-observation-audit.mjs forwards focused --region filters into the embedded confirmation summary so one-region closure runs cannot inherit decisions from other residual targets.',
      'tools/world-residual-runtime-trace-observation-audit.mjs rejects promotion gates that are not supported by same-frame region-specific hook observations.',
      'The generated template baseline is complete for the five trace plans but marked template-only and not usable as runtime evidence.',
    ],
    nextLeads: [
      'Copy tmp/local-hook-observations.template.json to tmp/local-hook-observations.json and fill it from real clean-runtime callbacks.',
      'Run the observation audit before bundling; completePlanCount should reflect real captured trace groups and forbiddenPayloadKeyCount must stay zero.',
      'Copied templates are not runtime evidence; residual-template trace ids and null/empty placeholders must be replaced before the closure pipeline can continue.',
      'Each observed hook must include the required metadata fields for its hook id before the closure pipeline can continue.',
      'Promotion gates must agree with same-frame hook fields for the same residual target before proof planning can continue.',
      'Run confirmation only on a metadata-only bundle produced from real observations, not on the template baseline.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const item of catalog.targetRegions || []) {
    const region = findRegion(mapData, item.regionId);
    if (!region) {
      missingRegions.push({ id: item.regionId, role: 'residual_runtime_trace_observation_audit_target' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.residualRuntimeTraceObservationAuditCatalog = {
      catalogId,
      kind: 'residual_runtime_trace_observation_audit_target',
      confidence: 'medium_high_tooling',
      planId: item.planId,
      requiredRuntimeHookIds: item.requiredRuntimeHookIds,
      targetOffsets: item.targetOffsets,
      targetAwareCompleteness: catalog.summary.targetAwareCompleteness,
      supportsFocusedRegionFilter: catalog.summary.supportsFocusedRegionFilter,
      focusedRegionFilterAppliesToPlanCompleteness: catalog.summary.focusedRegionFilterAppliesToPlanCompleteness,
      focusedRegionFilterAppliesToConfirmation: catalog.summary.focusedRegionFilterAppliesToConfirmation,
      focusedRegionFilterFiltersObservationGroups: catalog.summary.focusedRegionFilterFiltersObservationGroups,
      focusedRegionFilterKeepsSameFrameGroups: catalog.summary.focusedRegionFilterKeepsSameFrameGroups,
      rejectsTemplateAsRuntimeEvidence: catalog.summary.rejectsTemplateAsRuntimeEvidence,
      rejectsCopiedTemplatePlaceholders: catalog.summary.rejectsCopiedTemplatePlaceholders,
      rejectsMissingRequiredCaptureFields: catalog.summary.rejectsMissingRequiredCaptureFields,
      rejectsForbiddenPayloadKeys: catalog.summary.rejectsForbiddenPayloadKeys,
      rejectsIncoherentPromotionGates: catalog.summary.rejectsIncoherentPromotionGates,
      defaultObservationInputPath: catalog.summary.defaultObservationInputPath,
      defaultObservationAuditOutputPath: catalog.summary.defaultObservationAuditOutputPath,
      summary: 'Residual target is covered by the local observation audit contract; real runtime evidence is still required before promotion.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      planId: item.planId,
      targetOffsets: item.targetOffsets,
    });
  }

  mapData.runtimeTraceObservationAuditCatalogs = (mapData.runtimeTraceObservationAuditCatalogs || []).filter(item => item.id !== catalogId);
  mapData.runtimeTraceObservationAuditCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'residual_runtime_trace_observation_audit_catalog',
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
  staticMap.summary.residualRuntimeTraceObservationAuditCatalog = catalogId;
  staticMap.summary.residualRuntimeTraceObservationAuditReady = catalog.summary.observationAuditReady;
  staticMap.summary.residualRuntimeTraceObservationAuditTargets = catalog.summary.targetRegionCount;
  staticMap.summary.residualRuntimeTraceObservationAuditSupportsFocusedRegionFilter = catalog.summary.supportsFocusedRegionFilter;
  staticMap.summary.residualRuntimeTraceObservationAuditFocusedFilterAppliesToConfirmation = catalog.summary.focusedRegionFilterAppliesToConfirmation;
  staticMap.summary.residualRuntimeTraceObservationAuditFocusedFilterFiltersObservationGroups = catalog.summary.focusedRegionFilterFiltersObservationGroups;
  staticMap.summary.residualRuntimeTraceObservationAuditFocusedFilterKeepsSameFrameGroups = catalog.summary.focusedRegionFilterKeepsSameFrameGroups;
  staticMap.summary.residualRuntimeTraceObservationAuditTemplateOnlyUsable = catalog.summary.templateOnlyBaselineUsableAsRuntimeEvidence;
  staticMap.summary.residualRuntimeTraceObservationAuditRejectsCopiedTemplatePlaceholders = catalog.summary.rejectsCopiedTemplatePlaceholders;
  staticMap.summary.residualRuntimeTraceObservationAuditRejectsMissingRequiredCaptureFields = catalog.summary.rejectsMissingRequiredCaptureFields;
  staticMap.summary.residualRuntimeTraceObservationAuditRejectsIncoherentPromotionGates = catalog.summary.rejectsIncoherentPromotionGates;
  staticMap.summary.residualRuntimeTraceObservationAuditTemplatePlaceholderCount = catalog.summary.templateUnresolvedPlaceholderCount;
  staticMap.summary.residualRuntimeTraceObservationAuditTemplateRequiredFieldIssueCount = catalog.summary.templateRequiredFieldIssueCount;
  staticMap.summary.residualRuntimeTraceObservationAuditDefaultOutput = catalog.summary.defaultObservationAuditOutputPath;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-residual-runtime-trace-observation-audit-catalog-2026-06-26 to validate filled local residual observations before bundling or proof mutation.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
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
