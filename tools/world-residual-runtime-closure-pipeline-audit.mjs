#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLocalResidualRuntimeTraceBundle } from './world-residual-runtime-trace-local-bundle.mjs';
import { buildResidualRuntimeTraceObservationAudit } from './world-residual-runtime-trace-observation-audit.mjs';
import { buildCatalog as buildConfirmationCatalog } from './world-residual-runtime-trace-confirmation-audit.mjs';
import {
  applyProofUpdatePlanCatalog,
  buildProofUpdatePlanCatalog,
} from './world-residual-runtime-proof-update-plan-audit.mjs';
import {
  applyResidualSemanticDispositionPlanCatalog,
  buildResidualSemanticDispositionPlanCatalog,
} from './world-residual-semantic-disposition-plan-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const defaultObservationPath = path.join(repoRoot, 'tmp/local-hook-observations.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-residual-runtime-closure-pipeline.local.json');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-residual-runtime-closure-pipeline-audit.mjs';
const catalogId = 'world-residual-runtime-closure-pipeline-catalog-2026-06-26';
const reportId = 'residual-runtime-closure-pipeline-audit-2026-06-26';
const schemaVersion = 1;

const sourceCatalogs = [
  'world-residual-runtime-trace-observation-audit-catalog-2026-06-26',
  'world-residual-runtime-trace-confirmation-catalog-2026-06-26',
  'world-residual-runtime-proof-update-plan-catalog-2026-06-26',
  'world-residual-semantic-disposition-plan-catalog-2026-06-26',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
}

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isTemplateInput(input) {
  return Boolean(input?.templateOnly || input?.eventKind === 'wb3_residual_runtime_trace_observation_template');
}

function isCandidateInput(input) {
  return Boolean(input?.candidateOnly || input?.eventKind === 'wb3_gearsystem_mcp_observation_candidates');
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

function residualTargetRegions(mapData, regionIds = []) {
  const regionFilter = normalizeRegionFilters(regionIds);
  const filterSet = new Set(regionFilter);
  return (mapData.regions || [])
    .filter(region => region.analysis?.lowConfidenceResidualTriageAudit?.proofPlan)
    .filter(region => !regionFilter.length || filterSet.has(region.id))
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: Number(region.size || 0),
      type: region.type || 'unknown',
      confidence: region.confidence || null,
    }));
}

function summarizeConfirmation(confirmation) {
  return {
    eventSource: confirmation.eventSource,
    decisionCount: confirmation.summary?.decisionCount || 0,
    decisionCounts: confirmation.summary?.decisionCounts || {},
    promotionReadyCount: confirmation.summary?.promotionReadyCount || 0,
    fieldOrAliasOnlyRejectedCount: confirmation.summary?.fieldOrAliasOnlyRejectedCount || 0,
    pendingInsufficientCount: confirmation.summary?.pendingInsufficientCount || 0,
    forbiddenPayloadKeyCount: confirmation.summary?.forbiddenPayloadKeyCount || 0,
  };
}

function summarizeProofPlan(proofPlan) {
  return {
    eventSource: proofPlan.eventSource,
    eventSourceKind: proofPlan.eventSourceKind,
    guardStatus: proofPlan.summary?.guardStatus || '',
    eventSourceUsableAsRuntimeEvidence: proofPlan.summary?.eventSourceUsableAsRuntimeEvidence === true,
    proposedRegionUpdateCount: proofPlan.summary?.proposedRegionUpdateCount || 0,
    safeProofMetadataUpdateEligibleCount: proofPlan.summary?.safeProofMetadataUpdateEligibleCount || 0,
    forbiddenPayloadKeyCount: proofPlan.summary?.forbiddenPayloadKeyCount || 0,
  };
}

function summarizeSemanticPlan(semanticPlan) {
  return {
    semanticPromotionReadyCount: semanticPlan.summary?.semanticPromotionReadyCount || 0,
    keepQuarantinedCount: semanticPlan.summary?.keepQuarantinedCount || 0,
    pendingRuntimeProofMetadataCount: semanticPlan.summary?.pendingRuntimeProofMetadataCount || 0,
    runtimeRejectionKeepQuarantinedCount: semanticPlan.summary?.runtimeRejectionKeepQuarantinedCount || 0,
    statusCounts: semanticPlan.summary?.statusCounts || {},
    topLevelTypeMutationAllowedByThisTool: semanticPlan.summary?.topLevelTypeMutationAllowedByThisTool === true,
    topLevelConfidenceMutationAllowedByThisTool: semanticPlan.summary?.topLevelConfidenceMutationAllowedByThisTool === true,
    semanticDispositionMutatedByThisTool: semanticPlan.summary?.semanticDispositionMutatedByThisTool === true,
    coverageChangedByThisTool: semanticPlan.summary?.coverageChangedByThisTool === true,
  };
}

function assetPolicy() {
  return 'Metadata only: tool paths, region ids, offsets, trace ids, hook ids, decisions, counts, booleans, guard statuses, and command paths. No ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.';
}

function regionFlag(regionIds) {
  const filters = normalizeRegionFilters(regionIds);
  return filters.map(regionId => ` --region ${regionId}`).join('');
}

function pipelineCommands(regionIds = []) {
  const scopedRegionFlag = regionFlag(regionIds);
  return {
    generateTemplate: `node tools/world-residual-runtime-trace-local-bundle.mjs --template${scopedRegionFlag} --out tmp/local-hook-observations.template.json`,
    validateObservations: `node tools/world-residual-runtime-trace-observation-audit.mjs --observations tmp/local-hook-observations.json${scopedRegionFlag} --out tmp/world-residual-runtime-trace-observation-audit.local.json`,
    buildBundle: 'node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-trace-events.local.json',
    confirmBundle: `node tools/world-residual-runtime-trace-confirmation-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json${scopedRegionFlag}`,
    planProofUpdate: `node tools/world-residual-runtime-proof-update-plan-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json${scopedRegionFlag} --out tmp/world-residual-runtime-proof-update-plan.local.json`,
    runPipeline: `node tools/world-residual-runtime-closure-pipeline-audit.mjs --observations tmp/local-hook-observations.json${scopedRegionFlag} --out tmp/world-residual-runtime-closure-pipeline.local.json`,
    applyProofMetadataAfterReview: `node tools/world-residual-runtime-proof-update-plan-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json${scopedRegionFlag} --apply`,
    refreshSemanticDispositionAfterProofMetadata: 'node tools/world-residual-semantic-disposition-plan-audit.mjs --apply',
  };
}

function buildWaitingCatalog(mapData, options = {}) {
  const regionFilter = normalizeRegionFilters(options.regionIds || []);
  const targetRegions = residualTargetRegions(mapData, regionFilter);
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: assetPolicy(),
    summary: {
      pipelineReady: true,
      guardStatus: 'waiting_for_observation_input',
      observationSource: 'none',
      targetRegionCount: targetRegions.length,
      regionFilter,
      regionFilterApplied: regionFilter.length > 0,
      observationInputUsableAsRuntimeEvidence: false,
      rejectsCandidateOnlyEvidence: true,
      rejectsGeneratedCandidateTraceIds: true,
      rejectsIncoherentPromotionGates: true,
      requiresReviewedRuntimeObservationsForRealProofApply: true,
      completePlanCount: 0,
      bundleEventCount: 0,
      confirmationPromotionReadyCount: 0,
      confirmationRejectedCount: 0,
      proofPlanProposedUpdateCount: 0,
      proofMetadataWouldApplyOnCloneCount: 0,
      semanticPromotionReadyAfterCloneProofCount: 0,
      runtimeRejectionKeepQuarantinedAfterCloneProofCount: 0,
      realMapMutatedByThisPipeline: false,
      semanticDispositionMutatedByThisPipeline: false,
      coverageChangedByThisPipeline: false,
      defaultObservationInputPath: 'tmp/local-hook-observations.json',
      defaultPipelineOutputPath: 'tmp/world-residual-runtime-closure-pipeline.local.json',
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
    targetRegions,
    commands: pipelineCommands(regionFilter),
    evidence: [
      'Pipeline readiness is recorded without local observation input.',
      'No proof metadata, semantic disposition, top-level type, confidence, offset, size, or coverage mutation is performed by this pipeline catalog.',
    ],
    nextLeads: [
      'Fill tmp/local-hook-observations.json with real metadata-only clean-runtime observations.',
      'Run the pipeline command to produce tmp/world-residual-runtime-closure-pipeline.local.json.',
      'Only after reviewing a clean pipeline report should proof metadata be applied with the dedicated proof-update tool.',
    ],
  };
}

export function buildResidualRuntimeClosurePipelineCatalog(mapData, input = null, options = {}) {
  for (const id of sourceCatalogs) requireCatalog(mapData, id);
  const regionFilter = normalizeRegionFilters(options.regionIds || []);
  const targetRegions = residualTargetRegions(mapData, regionFilter);
  if (!input) return buildWaitingCatalog(mapData, { regionIds: regionFilter });

  const source = options.source || 'local_observation_input';
  const observationAudit = buildResidualRuntimeTraceObservationAudit(mapData, input, {
    source,
    regionIds: regionFilter,
  });
  const templateInput = isTemplateInput(input);
  const candidateInput = isCandidateInput(input);
  const blockedReasons = [];
  if (templateInput) blockedReasons.push('template_input_not_runtime_evidence');
  if (candidateInput || observationAudit.summary?.inputHasCandidateOnlyEvidence === true) blockedReasons.push('candidate_only_input_not_runtime_evidence');
  if (observationAudit.summary?.inputHasGeneratedCandidateTraceIds === true) blockedReasons.push('generated_candidate_trace_ids_present');
  if ((observationAudit.summary?.forbiddenPayloadKeyCount || 0) > 0) blockedReasons.push('forbidden_payload_keys_present');
  if (observationAudit.summary?.inputHasUnfilledTemplatePlaceholders === true) blockedReasons.push('unfilled_template_placeholders_present');
  if (observationAudit.summary?.inputHasMissingRequiredCaptureFields === true) blockedReasons.push('required_capture_fields_missing');
  if (observationAudit.summary?.inputHasIncoherentPromotionGates === true) blockedReasons.push('promotion_gate_coherence_failed');
  if (observationAudit.summary?.bundleError) blockedReasons.push('bundle_error');
  if ((observationAudit.summary?.completePlanCount || 0) === 0) blockedReasons.push('no_complete_runtime_trace_group');

  let bundleResult = null;
  let confirmation = null;
  let proofPlan = null;
  let cloneProofApply = { proofMetadataAppliedCount: 0, changedRegions: [] };
  let semanticPlanAfterCloneProof = null;
  let semanticApplyAfterCloneProof = { changedRegions: [] };

  if (!blockedReasons.includes('template_input_not_runtime_evidence') &&
      !blockedReasons.includes('candidate_only_input_not_runtime_evidence') &&
      !blockedReasons.includes('generated_candidate_trace_ids_present') &&
      !blockedReasons.includes('forbidden_payload_keys_present') &&
      !blockedReasons.includes('unfilled_template_placeholders_present') &&
      !blockedReasons.includes('required_capture_fields_missing') &&
      !blockedReasons.includes('promotion_gate_coherence_failed') &&
      !blockedReasons.includes('bundle_error')) {
    bundleResult = buildLocalResidualRuntimeTraceBundle(mapData, input, { source });
    confirmation = buildConfirmationCatalog(mapData, {
      events: bundleResult.bundle,
      source: 'tmp/world-residual-runtime-trace-events.local.json',
      regionIds: regionFilter,
    });
    proofPlan = buildProofUpdatePlanCatalog(mapData, {
      events: bundleResult.bundle,
      source: 'tmp/world-residual-runtime-trace-events.local.json',
      sourceKind: 'metadata_event_bundle',
      reviewedRuntimeObservations: true,
      regionIds: regionFilter,
    });
    const clone = cloneJson(mapData);
    cloneProofApply = applyProofUpdatePlanCatalog(clone, proofPlan);
    semanticPlanAfterCloneProof = buildResidualSemanticDispositionPlanCatalog(clone);
    semanticApplyAfterCloneProof = applyResidualSemanticDispositionPlanCatalog(clone, semanticPlanAfterCloneProof);
  }

  const proofSummary = proofPlan ? summarizeProofPlan(proofPlan) : null;
  const semanticSummary = semanticPlanAfterCloneProof ? summarizeSemanticPlan(semanticPlanAfterCloneProof) : null;
  const guardStatus = blockedReasons.length
    ? `blocked_${blockedReasons[0]}`
    : proofSummary?.eventSourceUsableAsRuntimeEvidence
      ? 'pipeline_ready_for_reviewed_proof_update'
      : 'pipeline_complete_no_proof_update_ready';

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    observationSource: source,
    assetPolicy: assetPolicy(),
    summary: {
      pipelineReady: true,
      guardStatus,
      observationSource: source,
      targetRegionCount: targetRegions.length,
      regionFilter,
      regionFilterApplied: regionFilter.length > 0,
      observationInputUsableAsRuntimeEvidence: observationAudit.summary.inputUsableAsRuntimeEvidence === true,
      inputHasCandidateOnlyEvidence: observationAudit.summary.inputHasCandidateOnlyEvidence === true,
      inputHasGeneratedCandidateTraceIds: observationAudit.summary.inputHasGeneratedCandidateTraceIds === true,
      completePlanCount: observationAudit.summary.completePlanCount || 0,
      incompletePlanCount: observationAudit.summary.incompletePlanCount || 0,
      forbiddenPayloadKeyCount: observationAudit.summary.forbiddenPayloadKeyCount || 0,
      inputHasUnfilledTemplatePlaceholders: observationAudit.summary.inputHasUnfilledTemplatePlaceholders === true,
      unresolvedPlaceholderCount: observationAudit.summary.unresolvedPlaceholderCount || 0,
      templateTraceIdCount: observationAudit.summary.templateTraceIdCount || 0,
      generatedCandidateTraceIdCount: observationAudit.summary.generatedCandidateTraceIdCount || 0,
      inputHasMissingRequiredCaptureFields: observationAudit.summary.inputHasMissingRequiredCaptureFields === true,
      requiredFieldIssueCount: observationAudit.summary.requiredFieldIssueCount || 0,
      missingRequiredFieldCount: observationAudit.summary.missingRequiredFieldCount || 0,
      missingRequiredTrueFieldGroupCount: observationAudit.summary.missingRequiredTrueFieldGroupCount || 0,
      inputHasIncoherentPromotionGates: observationAudit.summary.inputHasIncoherentPromotionGates === true,
      promotionGateCoherenceIssueCount: observationAudit.summary.promotionGateCoherenceIssueCount || 0,
      unsupportedDirectConsumerPromotionGateCount: observationAudit.summary.unsupportedDirectConsumerPromotionGateCount || 0,
      unsupportedFieldOrAliasRejectionGateCount: observationAudit.summary.unsupportedFieldOrAliasRejectionGateCount || 0,
      rejectsIncoherentPromotionGates: true,
      rejectsCandidateOnlyEvidence: true,
      rejectsGeneratedCandidateTraceIds: true,
      bundleEventCount: bundleResult?.bundle?.events?.length || 0,
      confirmationPromotionReadyCount: confirmation?.summary?.promotionReadyCount || 0,
      confirmationRejectedCount: confirmation?.summary?.fieldOrAliasOnlyRejectedCount || 0,
      confirmationPendingCount: confirmation?.summary?.pendingInsufficientCount || 0,
      proofPlanProposedUpdateCount: proofPlan?.summary?.proposedRegionUpdateCount || 0,
      proofPlanSafeUpdateEligibleCount: proofPlan?.summary?.safeProofMetadataUpdateEligibleCount || 0,
      proofMetadataWouldApplyOnCloneCount: cloneProofApply.proofMetadataAppliedCount || 0,
      proofCloneDryRunAssumesReviewedRuntimeObservations: true,
      requiresReviewedRuntimeObservationsForRealProofApply: true,
      semanticPromotionReadyAfterCloneProofCount: semanticPlanAfterCloneProof?.summary?.semanticPromotionReadyCount || 0,
      runtimeRejectionKeepQuarantinedAfterCloneProofCount: semanticPlanAfterCloneProof?.summary?.runtimeRejectionKeepQuarantinedCount || 0,
      realMapMutatedByThisPipeline: false,
      semanticDispositionMutatedByThisPipeline: false,
      coverageChangedByThisPipeline: false,
      defaultObservationInputPath: 'tmp/local-hook-observations.json',
      defaultPipelineOutputPath: 'tmp/world-residual-runtime-closure-pipeline.local.json',
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
    blockedReasons,
    targetRegions,
    observationAuditSummary: observationAudit.summary,
    planCompleteness: observationAudit.planCompleteness,
    confirmationSummary: confirmation ? summarizeConfirmation(confirmation) : null,
    confirmationDecisions: confirmation?.decisions || [],
    proofPlanSummary: proofSummary,
    proofPlanProposedUpdates: proofPlan?.proposedUpdates || [],
    cloneProofApplySummary: {
      proofMetadataAppliedCount: cloneProofApply.proofMetadataAppliedCount || 0,
      changedRegions: cloneProofApply.changedRegions || [],
    },
    semanticDispositionAfterCloneProofSummary: semanticSummary,
    semanticDispositionAfterCloneProofChangedRegions: semanticApplyAfterCloneProof.changedRegions || [],
    commands: pipelineCommands(regionFilter),
    evidence: [
      'Observation audit validates same-frame hook completeness and forbidden payload policy before bundling.',
      'The local bundle builder emits metadata-only residual runtime trace events from filled local observations.',
      'Proof update and semantic-disposition effects are evaluated on a cloned map inside this pipeline; the real project map is not mutated by the pipeline report.',
    ],
    nextLeads: [
      'Review proofPlanProposedUpdates and semanticDispositionAfterCloneProofSummary before applying proof metadata to the real map.',
      'Use the dedicated proof-update tool for reviewed real bundles, then refresh semantic disposition with the dedicated semantic planner.',
      'If blockedReasons is nonempty, fix the local observations before running confirmation or proof update.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const item of catalog.targetRegions || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === item.id);
    if (!region) {
      missingRegions.push({ id: item.id, role: 'residual_runtime_closure_pipeline_target' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.residualRuntimeClosurePipelineAudit = {
      catalogId,
      kind: 'residual_runtime_closure_pipeline',
      status: catalog.summary.guardStatus,
      confidence: 'medium_high_tooling',
      observationSource: catalog.summary.observationSource,
      completePlanCount: catalog.summary.completePlanCount,
      proofPlanProposedUpdateCount: catalog.summary.proofPlanProposedUpdateCount,
      rejectsIncoherentPromotionGates: catalog.summary.rejectsIncoherentPromotionGates === true,
      rejectsCandidateOnlyEvidence: catalog.summary.rejectsCandidateOnlyEvidence === true,
      rejectsGeneratedCandidateTraceIds: catalog.summary.rejectsGeneratedCandidateTraceIds === true,
      requiresReviewedRuntimeObservationsForRealProofApply: catalog.summary.requiresReviewedRuntimeObservationsForRealProofApply === true,
      proofMetadataWouldApplyOnCloneCount: catalog.summary.proofMetadataWouldApplyOnCloneCount,
      semanticPromotionReadyAfterCloneProofCount: catalog.summary.semanticPromotionReadyAfterCloneProofCount,
      realMapMutatedByThisPipeline: false,
      semanticDispositionMutatedByThisPipeline: false,
      coverageChangedByThisPipeline: false,
      defaultObservationInputPath: catalog.summary.defaultObservationInputPath,
      defaultPipelineOutputPath: catalog.summary.defaultPipelineOutputPath,
      summary: 'Residual closure pipeline is available for end-to-end local observation validation; this audit does not mutate proof metadata or semantic disposition.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      status: catalog.summary.guardStatus,
    });
  }

  mapData.residualRuntimeClosurePipelineCatalogs = (mapData.residualRuntimeClosurePipelineCatalogs || []).filter(item => item.id !== catalogId);
  mapData.residualRuntimeClosurePipelineCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'residual_runtime_closure_pipeline_audit',
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
  staticMap.summary.residualRuntimeClosurePipelineCatalog = catalogId;
  staticMap.summary.residualRuntimeClosurePipelineReady = catalog.summary.pipelineReady;
  staticMap.summary.residualRuntimeClosurePipelineTargets = catalog.summary.targetRegionCount;
  staticMap.summary.residualRuntimeClosurePipelineRegionFilter = catalog.summary.regionFilter || [];
  staticMap.summary.residualRuntimeClosurePipelineRegionFilterApplied = catalog.summary.regionFilterApplied === true;
  staticMap.summary.residualRuntimeClosurePipelineStatus = catalog.summary.guardStatus;
  staticMap.summary.residualRuntimeClosurePipelineRejectsIncoherentPromotionGates = catalog.summary.rejectsIncoherentPromotionGates === true;
  staticMap.summary.residualRuntimeClosurePipelineRejectsCandidateOnlyEvidence = catalog.summary.rejectsCandidateOnlyEvidence === true;
  staticMap.summary.residualRuntimeClosurePipelineRejectsGeneratedCandidateTraceIds = catalog.summary.rejectsGeneratedCandidateTraceIds === true;
  staticMap.summary.residualRuntimeClosurePipelineRequiresReviewedRuntimeObservationsForRealProofApply = catalog.summary.requiresReviewedRuntimeObservationsForRealProofApply === true;
  staticMap.summary.residualRuntimeClosurePipelineDefaultInput = catalog.summary.defaultObservationInputPath;
  staticMap.summary.residualRuntimeClosurePipelineDefaultOutput = catalog.summary.defaultPipelineOutputPath;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-residual-runtime-closure-pipeline-catalog-2026-06-26 to validate filled local residual observations end to end before applying proof metadata.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const apply = process.argv.includes('--apply');
  const noWrite = process.argv.includes('--no-write');
  const observationsArg = argValue('--observations') || argValue('--input');
  const observationsPath = resolveRepoPath(observationsArg);
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const regionIds = normalizeRegionFilters([
    ...argValues('--region'),
    ...argValues('--regions'),
  ]);
  const mapData = readJson(mapPath);
  const input = observationsPath ? readJson(observationsPath) : null;
  const catalog = buildResidualRuntimeClosurePipelineCatalog(mapData, input, {
    source: observationsPath ? repoRelative(observationsPath) : 'none',
    regionIds,
  });

  let annotation = { changedRegions: [], missingRegions: [] };
  if (apply) {
    annotation = applyCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }

  const shouldWriteOutput = !noWrite && !apply && (Boolean(observationsPath) || Boolean(argValue('--out')));
  if (shouldWriteOutput) writeJson(outputPath, catalog);

  console.log(JSON.stringify({
    ok: !String(catalog.summary.guardStatus || '').startsWith('blocked_'),
    applied: apply,
    output: shouldWriteOutput ? repoRelative(outputPath) : null,
    catalogId,
    summary: catalog.summary,
    blockedReasons: catalog.blockedReasons || [],
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));

  if (String(catalog.summary.guardStatus || '').startsWith('blocked_')) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    }, null, 2));
    process.exitCode = 1;
  }
}
