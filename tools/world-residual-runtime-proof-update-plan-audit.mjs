#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildResidualRuntimeTraceObservationAudit } from './world-residual-runtime-trace-observation-audit.mjs';
import { buildCatalog as buildConfirmationCatalog } from './world-residual-runtime-trace-confirmation-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-residual-runtime-proof-update-plan.local.json');
const now = '2026-06-26T00:00:00Z';
const catalogId = 'world-residual-runtime-proof-update-plan-catalog-2026-06-26';
const reportId = 'residual-runtime-proof-update-plan-audit-2026-06-26';
const toolName = 'tools/world-residual-runtime-proof-update-plan-audit.mjs';
const schemaVersion = 1;

const sourceCatalogs = [
  'world-residual-runtime-proof-closure-index-catalog-2026-06-26',
  'world-residual-runtime-trace-confirmation-catalog-2026-06-26',
  'world-residual-runtime-trace-observation-audit-catalog-2026-06-26',
  'world-residual-runtime-trace-event-contract-catalog-2026-06-26',
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

function findRegion(mapData, id) {
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

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
}

function relativeRepoPath(filePath) {
  return path.relative(repoRoot, filePath);
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

function eventSourceKind(input, source) {
  if (!input || source === 'none') return 'none';
  if (input.templateOnly || input.eventKind === 'wb3_residual_runtime_trace_observation_template') {
    return 'template_not_runtime_evidence';
  }
  if (input.eventKind === 'wb3_residual_runtime_trace_observation_audit') {
    return 'observation_audit_not_event_bundle';
  }
  if (input.sourceKind) return input.sourceKind;
  if (input.eventKind === 'wb3_residual_runtime_trace_events') return 'metadata_event_bundle';
  if (Array.isArray(input)) return 'raw_event_array';
  if (Array.isArray(input.events)) return 'metadata_event_bundle';
  return 'unknown_input';
}

function eventPayloadForConfirmation(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (input.eventKind === 'wb3_residual_runtime_trace_events') return input;
  if (Array.isArray(input.events)) return input;
  return [];
}

function loadEventBundleFromArgs() {
  const eventArg = argValue('--events') || argValue('--input');
  const reviewedRuntimeObservations = process.argv.includes('--reviewed-runtime-observations');
  if (!eventArg) {
    return {
      source: 'none',
      sourceKind: 'none',
      events: [],
      input: null,
      reviewedRuntimeObservations,
    };
  }
  const fullPath = resolveRepoPath(eventArg);
  const input = readJson(fullPath);
  return {
    source: relativeRepoPath(fullPath),
    sourceKind: eventSourceKind(input, relativeRepoPath(fullPath)),
    events: eventPayloadForConfirmation(input),
    input,
    reviewedRuntimeObservations: reviewedRuntimeObservations ||
      input.reviewedRuntimeObservations === true ||
      input.reviewStatus === 'reviewed_runtime_observations',
  };
}

function countBy(items, keyFn) {
  return (items || []).reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function compactDecision(decision, region) {
  return {
    planId: decision.planId,
    regionId: decision.regionId,
    offset: region?.offset || null,
    type: region?.type || 'unknown',
    classId: decision.classId,
    targetOffsets: decision.targetOffsets || [],
    decision: decision.decision,
    finalStatus: decision.finalStatus,
    confidence: decision.confidence,
    promotionAction: decision.promotionAction,
    runtimeTraceConfirmed: decision.runtimeTraceConfirmed,
    promotionReady: decision.promotionReady,
    fieldOrAliasOnlyRejected: decision.fieldOrAliasOnlyRejected,
    selectedTraceIds: decision.selectedTraceIds || [],
    rejectedTraceIds: decision.rejectedTraceIds || [],
    insufficientTraceIds: decision.insufficientTraceIds || [],
  };
}

function proofUpdatePaths(regionId) {
  return {
    planAudit: `regions.${regionId}.analysis.residualRuntimeProofUpdatePlanAudit`,
    triageStatus: `regions.${regionId}.analysis.lowConfidenceResidualTriageAudit.runtimeProofUpdateStatus`,
    closurePromotionReady: `regions.${regionId}.analysis.residualRuntimeProofClosureIndexAudit.promotionReady`,
    closureBlockedBy: `regions.${regionId}.analysis.residualRuntimeProofClosureIndexAudit.promotionBlockedBy`,
  };
}

function proposedUpdateForDecision(decision, region, eventSource) {
  const paths = proofUpdatePaths(decision.regionId);
  if (decision.decision === 'confirmed_direct_consumer_ready_for_residual_update') {
    return {
      regionId: decision.regionId,
      offset: region?.offset || null,
      type: region?.type || 'unknown',
      planId: decision.planId,
      classId: decision.classId,
      targetOffsets: decision.targetOffsets || [],
      planStatus: 'ready_to_record_runtime_direct_consumer_confirmation',
      proposedAction: 'record_runtime_direct_consumer_proof_and_unblock_followup_semantic_review',
      eventSource,
      selectedTraceIds: decision.selectedTraceIds || [],
      rejectedTraceIds: [],
      wouldSet: [
        { path: paths.planAudit, value: 'runtime_direct_consumer_confirmed_metadata_only' },
        { path: paths.triageStatus, value: 'runtime_direct_consumer_confirmed' },
        { path: paths.closurePromotionReady, value: true },
        { path: paths.closureBlockedBy, value: 'none_after_verified_runtime_trace' },
      ],
      wouldNotSet: [
        'region.offset',
        'region.size',
        'region.type',
        'region.confidence',
        'decoded asset data',
        'coverage intervals',
      ],
      semanticDispositionMutatedByThisPlan: false,
      coverageChangedByThisPlan: false,
      evidence: [
        'Confirmation decision is confirmed_direct_consumer_ready_for_residual_update.',
        'The selected same-frame trace ids are metadata-only identifiers from the supplied event bundle.',
        'This planner records the exact follow-up metadata paths but does not mutate semantic type or coverage.',
      ],
    };
  }
  if (decision.decision === 'confirmed_field_or_alias_rejection_keep_quarantined') {
    return {
      regionId: decision.regionId,
      offset: region?.offset || null,
      type: region?.type || 'unknown',
      planId: decision.planId,
      classId: decision.classId,
      targetOffsets: decision.targetOffsets || [],
      planStatus: 'ready_to_record_field_or_alias_rejection',
      proposedAction: 'record_runtime_rejection_and_keep_residual_quarantined',
      eventSource,
      selectedTraceIds: [],
      rejectedTraceIds: decision.rejectedTraceIds || [],
      wouldSet: [
        { path: paths.planAudit, value: 'runtime_field_or_alias_rejected_keep_quarantined_metadata_only' },
        { path: paths.triageStatus, value: 'runtime_field_or_alias_rejected_keep_quarantined' },
        { path: paths.closurePromotionReady, value: false },
        { path: paths.closureBlockedBy, value: 'confirmed_field_or_alias_only_or_indirect_use' },
      ],
      wouldNotSet: [
        'region.offset',
        'region.size',
        'region.type',
        'region.confidence',
        'decoded asset data',
        'coverage intervals',
      ],
      semanticDispositionMutatedByThisPlan: false,
      coverageChangedByThisPlan: false,
      evidence: [
        'Confirmation decision is confirmed_field_or_alias_rejection_keep_quarantined.',
        'The rejected same-frame trace ids are metadata-only identifiers from the supplied event bundle.',
        'This planner records quarantine evidence paths but does not promote semantic type or coverage.',
      ],
    };
  }
  return null;
}

function guardStatusFor(sourceKind, confirmation, proposedUpdates, observationAudit, reviewedRuntimeObservations) {
  if (sourceKind === 'template_not_runtime_evidence') return 'blocked_template_not_runtime_evidence';
  if (sourceKind === 'observation_audit_not_event_bundle') return 'blocked_input_is_audit_not_event_bundle';
  if (sourceKind === 'unknown_input') return 'blocked_unknown_input_shape';
  if ((confirmation.summary?.forbiddenPayloadKeyCount || 0) > 0) return 'blocked_forbidden_payload_keys';
  if (observationAudit?.summary?.inputHasUnfilledTemplatePlaceholders === true) return 'blocked_unfilled_template_placeholders_present';
  if (observationAudit?.summary?.inputHasMissingRequiredCaptureFields === true) return 'blocked_required_capture_fields_missing';
  if (observationAudit?.summary?.inputHasIncoherentPromotionGates === true) return 'blocked_promotion_gate_coherence_failed';
  if (sourceKind === 'none') return 'ready_waiting_for_runtime_event_bundle';
  if (!proposedUpdates.length) return 'ready_no_confirmed_or_rejected_decisions';
  if (sourceKind === 'metadata_event_bundle') {
    return reviewedRuntimeObservations
      ? 'plan_ready_from_reviewed_metadata_event_bundle'
      : 'plan_ready_waiting_for_reviewed_runtime_observations';
  }
  return 'plan_built_from_nonbundle_events_not_apply_eligible';
}

function mutationEligibleFor(sourceKind, guardStatus, proposedUpdates, reviewedRuntimeObservations) {
  return sourceKind === 'metadata_event_bundle' &&
    reviewedRuntimeObservations === true &&
    guardStatus === 'plan_ready_from_reviewed_metadata_event_bundle' &&
    proposedUpdates.length > 0;
}

function duplicateIds(ids) {
  const seen = new Set();
  const duplicates = new Set();
  for (const id of ids || []) {
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

function applyCatalogIntegrityFor(catalog) {
  const targetRegionIds = (catalog.targetPlans || []).map(item => item.regionId).filter(Boolean);
  const proposedRegionIds = (catalog.proposedUpdates || []).map(item => item.regionId).filter(Boolean);
  const targetRegionIdSet = new Set(targetRegionIds);
  const regionFilter = normalizeRegionFilters(catalog.summary?.regionFilter || catalog.regionFilter || []);
  const filterSet = new Set(regionFilter);
  const outOfScopeTargetRegionIds = regionFilter.length
    ? uniqueSorted(targetRegionIds.filter(regionId => !filterSet.has(regionId)))
    : [];
  const outOfScopeProposedRegionIds = regionFilter.length
    ? uniqueSorted(proposedRegionIds.filter(regionId => !filterSet.has(regionId)))
    : [];
  const proposalWithoutTargetRegionIds = uniqueSorted(proposedRegionIds.filter(regionId => !targetRegionIdSet.has(regionId)));
  const issues = [
    ...duplicateIds(targetRegionIds).map(regionId => ({
      kind: 'duplicate_target_plan_region_id',
      regionId,
    })),
    ...duplicateIds(proposedRegionIds).map(regionId => ({
      kind: 'duplicate_proposed_update_region_id',
      regionId,
    })),
    ...outOfScopeTargetRegionIds.map(regionId => ({
      kind: 'target_plan_outside_focused_region_filter',
      regionId,
      regionFilter,
    })),
    ...outOfScopeProposedRegionIds.map(regionId => ({
      kind: 'proposed_update_outside_focused_region_filter',
      regionId,
      regionFilter,
    })),
    ...proposalWithoutTargetRegionIds.map(regionId => ({
      kind: 'proposed_update_without_target_plan',
      regionId,
    })),
  ];

  const summaryTargetRegionCount = catalog.summary?.targetRegionCount;
  if (summaryTargetRegionCount !== undefined && summaryTargetRegionCount !== uniqueSorted(targetRegionIds).length) {
    issues.push({
      kind: 'summary_target_region_count_mismatch',
      expected: uniqueSorted(targetRegionIds).length,
      actual: summaryTargetRegionCount,
    });
  }
  const summaryProposedRegionUpdateCount = catalog.summary?.proposedRegionUpdateCount;
  if (summaryProposedRegionUpdateCount !== undefined && summaryProposedRegionUpdateCount !== proposedRegionIds.length) {
    issues.push({
      kind: 'summary_proposed_region_update_count_mismatch',
      expected: proposedRegionIds.length,
      actual: summaryProposedRegionUpdateCount,
    });
  }

  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
    regionFilter,
    targetRegionIds: uniqueSorted(targetRegionIds),
    proposedRegionIds: uniqueSorted(proposedRegionIds),
    outOfScopeTargetRegionIds,
    outOfScopeProposedRegionIds,
    proposalWithoutTargetRegionIds,
  };
}

function annotateApplyCatalogIntegrity(catalog) {
  const integrity = applyCatalogIntegrityFor(catalog);
  catalog.summary.applyCatalogIntegrityOk = integrity.ok;
  catalog.summary.applyCatalogIntegrityIssueCount = integrity.issueCount;
  catalog.summary.applyCatalogRegionFilterScopeEnforced = true;
  catalog.summary.applyCatalogProposalsRequireTargetPlans = true;
  catalog.summary.applyCatalogOutOfScopeTargetCount = integrity.outOfScopeTargetRegionIds.length;
  catalog.summary.applyCatalogOutOfScopeProposalCount = integrity.outOfScopeProposedRegionIds.length;
  catalog.summary.applyCatalogProposalWithoutTargetCount = integrity.proposalWithoutTargetRegionIds.length;
  catalog.applyCatalogIntegrityIssues = integrity.issues;
  return catalog;
}

export function buildProofUpdatePlanCatalog(mapData, eventBundle = { events: [], source: 'none', sourceKind: 'none' }) {
  for (const id of sourceCatalogs) requireCatalog(mapData, id);

  const sourceKind = eventBundle.sourceKind || 'none';
  const reviewedRuntimeObservations = eventBundle.reviewedRuntimeObservations === true;
  const regionFilter = normalizeRegionFilters(eventBundle.regionIds || eventBundle.regionFilter || []);
  const observationAudit = buildResidualRuntimeTraceObservationAudit(mapData, eventBundle.events || [], {
    source: eventBundle.source || 'proof_update_event_bundle_validation',
    regionIds: regionFilter,
  });
  const confirmation = buildConfirmationCatalog(mapData, {
    events: eventBundle.events || [],
    source: eventBundle.source || 'none',
    regionIds: regionFilter,
  });
  const targetPlans = (confirmation.decisions || []).map(decision => compactDecision(decision, findRegion(mapData, decision.regionId)));
  const proposedUpdates = (confirmation.decisions || [])
    .map(decision => proposedUpdateForDecision(decision, findRegion(mapData, decision.regionId), confirmation.eventSource))
    .filter(Boolean);
  const guardStatus = guardStatusFor(sourceKind, confirmation, proposedUpdates, observationAudit, reviewedRuntimeObservations);
  const mutationEligible = mutationEligibleFor(sourceKind, guardStatus, proposedUpdates, reviewedRuntimeObservations);
  const targetRegionIds = uniqueSorted(targetPlans.map(item => item.regionId));

  return annotateApplyCatalogIntegrity({
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    eventSource: confirmation.eventSource,
    eventSourceKind: sourceKind,
    assetPolicy: 'Metadata only: region ids, offsets, plan ids, hook-derived decisions, trace ids, proposed metadata paths, booleans, counts, command paths, and policy flags. No ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      plannerReady: true,
      guardStatus,
      eventSourceProvided: confirmation.eventSource !== 'none',
      eventSourceUsableAsRuntimeEvidence: mutationEligible,
      reviewedRuntimeObservations,
      requiresReviewedRuntimeObservationsForApply: true,
      targetRegionCount: targetRegionIds.length,
      confirmationDecisionCount: confirmation.summary?.decisionCount || 0,
      decisionCounts: confirmation.summary?.decisionCounts || countBy(confirmation.decisions || [], item => item.decision),
      runtimeTraceConfirmedCount: confirmation.summary?.runtimeTraceConfirmedCount || 0,
      promotionReadyCount: confirmation.summary?.promotionReadyCount || 0,
      fieldOrAliasOnlyRejectedCount: confirmation.summary?.fieldOrAliasOnlyRejectedCount || 0,
      pendingInsufficientCount: confirmation.summary?.pendingInsufficientCount || 0,
      forbiddenPayloadKeyCount: confirmation.summary?.forbiddenPayloadKeyCount || 0,
      rejectsUnfilledTemplatePlaceholders: true,
      rejectsMissingRequiredCaptureFields: true,
      rejectsIncoherentPromotionGates: true,
      inputHasUnfilledTemplatePlaceholders: observationAudit.summary?.inputHasUnfilledTemplatePlaceholders === true,
      unresolvedPlaceholderCount: observationAudit.summary?.unresolvedPlaceholderCount || 0,
      templateTraceIdCount: observationAudit.summary?.templateTraceIdCount || 0,
      inputHasMissingRequiredCaptureFields: observationAudit.summary?.inputHasMissingRequiredCaptureFields === true,
      requiredFieldIssueCount: observationAudit.summary?.requiredFieldIssueCount || 0,
      missingRequiredFieldCount: observationAudit.summary?.missingRequiredFieldCount || 0,
      missingRequiredTrueFieldGroupCount: observationAudit.summary?.missingRequiredTrueFieldGroupCount || 0,
      inputHasIncoherentPromotionGates: observationAudit.summary?.inputHasIncoherentPromotionGates === true,
      promotionGateCoherenceIssueCount: observationAudit.summary?.promotionGateCoherenceIssueCount || 0,
      unsupportedDirectConsumerPromotionGateCount: observationAudit.summary?.unsupportedDirectConsumerPromotionGateCount || 0,
      unsupportedFieldOrAliasRejectionGateCount: observationAudit.summary?.unsupportedFieldOrAliasRejectionGateCount || 0,
      proposedRegionUpdateCount: proposedUpdates.length,
      mutationEligibleCount: mutationEligible ? proposedUpdates.length : 0,
      safeProofMetadataUpdateEligibleCount: mutationEligible ? proposedUpdates.length : 0,
      semanticDispositionMutatedByThisTool: false,
      coverageChangedByThisTool: false,
      defaultEventInputPath: 'tmp/world-residual-runtime-trace-events.local.json',
      defaultPlanOutputPath: 'tmp/world-residual-runtime-proof-update-plan.local.json',
      regionFilter,
      regionFilterApplied: regionFilter.length > 0,
      evaluatedTracePlanCount: confirmation.summary?.evaluatedTracePlanCount || 0,
      missingRegionIds: confirmation.summary?.missingRegionIds || [],
      focusedRegionFilterScopeEnforcedOnApply: true,
      proposedUpdatesMustMatchTargetPlansOnApply: true,
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
    targetPlans,
    proposedUpdates,
    guardIssues: [
      sourceKind === 'template_not_runtime_evidence'
        ? 'Template input is not runtime evidence; fill tmp/local-hook-observations.json from real clean-runtime callbacks and rebuild the bundle.'
        : null,
      sourceKind === 'observation_audit_not_event_bundle'
        ? 'Observation-audit output is not an event bundle; pass tmp/world-residual-runtime-trace-events.local.json instead.'
        : null,
      (confirmation.summary?.forbiddenPayloadKeyCount || 0) > 0
        ? 'Forbidden payload keys are present; remove raw payload fields before proof planning.'
        : null,
      observationAudit.summary?.inputHasUnfilledTemplatePlaceholders === true
        ? 'Unfilled template placeholders are present; replace residual-template trace ids and null/empty placeholders before proof planning.'
        : null,
      observationAudit.summary?.inputHasMissingRequiredCaptureFields === true
        ? 'Required capture fields are missing; validate tmp/local-hook-observations.json before proof planning.'
        : null,
      observationAudit.summary?.inputHasIncoherentPromotionGates === true
        ? 'Promotion gate decisions are not supported by same-frame hook observations; correct the observation input before proof planning.'
        : null,
      sourceKind === 'metadata_event_bundle' && proposedUpdates.length > 0 && !reviewedRuntimeObservations
        ? 'The metadata event bundle has proposed proof updates but is not marked reviewed; rerun with --reviewed-runtime-observations after review before applying proof metadata.'
        : null,
      confirmation.eventSource === 'none'
        ? 'No runtime event bundle was supplied; this catalog is readiness metadata only.'
        : null,
      confirmation.eventSource !== 'none' && !proposedUpdates.length && (confirmation.summary?.forbiddenPayloadKeyCount || 0) === 0
        ? 'No confirmed direct-consumer or field/alias rejection decision was found in the supplied events.'
        : null,
    ].filter(Boolean),
    commands: {
      generateTemplate: 'node tools/world-residual-runtime-trace-local-bundle.mjs --template --out tmp/local-hook-observations.template.json',
      validateObservations: 'node tools/world-residual-runtime-trace-observation-audit.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-trace-observation-audit.local.json',
      buildBundle: 'node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-trace-events.local.json',
      confirmBundle: 'node tools/world-residual-runtime-trace-confirmation-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json',
      writePlan: 'node tools/world-residual-runtime-proof-update-plan-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json --out tmp/world-residual-runtime-proof-update-plan.local.json',
      focusedConfirmBundleExample: 'node tools/world-residual-runtime-trace-confirmation-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json --region r2813',
      focusedWritePlanExample: 'node tools/world-residual-runtime-proof-update-plan-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json --region r2813 --out tmp/world-residual-runtime-proof-update-plan.local.json',
      recordReadinessCatalog: 'node tools/world-residual-runtime-proof-update-plan-audit.mjs --apply',
      recordRealPlanMetadata: 'node tools/world-residual-runtime-proof-update-plan-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json --reviewed-runtime-observations --apply',
    },
    evidence: [
      'The planner consumes tools/world-residual-runtime-trace-confirmation-audit.mjs decisions and the residual runtime proof closure index.',
      'It refuses template inputs, observation-audit outputs, unknown input shapes, bundles with forbidden payload keys, unfilled template placeholders, missing required capture fields, incoherent promotion gates, or unreviewed metadata event bundles as mutation evidence.',
      'Apply-time catalog integrity checks enforce that focused plans cannot write target or proposal rows outside the selected region filter.',
      'It only plans metadata path changes; this tool does not change region offsets, sizes, semantic types, confidence, coverage, or decoded asset data.',
    ],
    nextLeads: [
      'Capture real metadata-only residual runtime observations into tmp/local-hook-observations.json.',
      'Validate observations, build tmp/world-residual-runtime-trace-events.local.json, and run this planner against that bundle.',
      'Review proposedUpdates, then use --reviewed-runtime-observations before applying proof metadata or running any later semantic promotion audit.',
    ],
  });
}

function metadataStatusForProposal(proposal) {
  if (!proposal) return 'pending_runtime_trace_confirmation';
  if (proposal.planStatus === 'ready_to_record_runtime_direct_consumer_confirmation') {
    return 'runtime_direct_consumer_confirmed';
  }
  if (proposal.planStatus === 'ready_to_record_field_or_alias_rejection') {
    return 'runtime_field_or_alias_rejected_keep_quarantined';
  }
  return proposal.planStatus;
}

function proofTraceIds(item, proposal) {
  return uniqueSorted([
    ...(item.selectedTraceIds || []),
    ...(item.rejectedTraceIds || []),
    ...(proposal?.selectedTraceIds || []),
    ...(proposal?.rejectedTraceIds || []),
  ]);
}

function applySafeProofMetadata(region, item, proposal, catalog) {
  if (!catalog.summary.eventSourceUsableAsRuntimeEvidence || !proposal) {
    return { applied: false, appliedPaths: [] };
  }

  const analysis = region.analysis = region.analysis || {};
  const traceIds = proofTraceIds(item, proposal);
  const metadataStatus = metadataStatusForProposal(proposal);
  const appliedPaths = [];

  const triage = analysis.lowConfidenceResidualTriageAudit = analysis.lowConfidenceResidualTriageAudit || {};
  triage.runtimeProofUpdateCatalogId = catalogId;
  triage.runtimeProofUpdateStatus = metadataStatus;
  triage.runtimeProofUpdateDecision = item.decision;
  triage.runtimeProofUpdateEventSource = catalog.eventSource;
  triage.runtimeProofUpdateTraceIds = traceIds;
  triage.runtimeProofSemanticDispositionMutated = false;
  triage.runtimeProofCoverageChanged = false;
  appliedPaths.push(
    'analysis.lowConfidenceResidualTriageAudit.runtimeProofUpdateCatalogId',
    'analysis.lowConfidenceResidualTriageAudit.runtimeProofUpdateStatus',
    'analysis.lowConfidenceResidualTriageAudit.runtimeProofUpdateDecision',
    'analysis.lowConfidenceResidualTriageAudit.runtimeProofUpdateEventSource',
    'analysis.lowConfidenceResidualTriageAudit.runtimeProofUpdateTraceIds',
    'analysis.lowConfidenceResidualTriageAudit.runtimeProofSemanticDispositionMutated',
    'analysis.lowConfidenceResidualTriageAudit.runtimeProofCoverageChanged'
  );

  const closure = analysis.residualRuntimeProofClosureIndexAudit = analysis.residualRuntimeProofClosureIndexAudit || {};
  closure.runtimeProofUpdateCatalogId = catalogId;
  closure.runtimeProofUpdateStatus = metadataStatus;
  closure.runtimeProofUpdateDecision = item.decision;
  closure.runtimeProofUpdateEventSource = catalog.eventSource;
  closure.runtimeProofUpdateTraceIds = traceIds;
  closure.runtimeProofConfirmed = item.runtimeTraceConfirmed === true;
  closure.runtimeProofRejectedAsFieldOrAlias = item.fieldOrAliasOnlyRejected === true;
  closure.semanticDispositionMutatedByRuntimeProofUpdate = false;
  closure.coverageChangedByRuntimeProofUpdate = false;
  appliedPaths.push(
    'analysis.residualRuntimeProofClosureIndexAudit.runtimeProofUpdateCatalogId',
    'analysis.residualRuntimeProofClosureIndexAudit.runtimeProofUpdateStatus',
    'analysis.residualRuntimeProofClosureIndexAudit.runtimeProofUpdateDecision',
    'analysis.residualRuntimeProofClosureIndexAudit.runtimeProofUpdateEventSource',
    'analysis.residualRuntimeProofClosureIndexAudit.runtimeProofUpdateTraceIds',
    'analysis.residualRuntimeProofClosureIndexAudit.runtimeProofConfirmed',
    'analysis.residualRuntimeProofClosureIndexAudit.runtimeProofRejectedAsFieldOrAlias',
    'analysis.residualRuntimeProofClosureIndexAudit.semanticDispositionMutatedByRuntimeProofUpdate',
    'analysis.residualRuntimeProofClosureIndexAudit.coverageChangedByRuntimeProofUpdate'
  );

  if (item.decision === 'confirmed_direct_consumer_ready_for_residual_update') {
    closure.promotionReady = true;
    closure.promotionBlockedBy = 'none_after_verified_runtime_trace';
    closure.runtimeProofClosureStatus = 'runtime_proof_satisfied_semantic_review_required';
    appliedPaths.push(
      'analysis.residualRuntimeProofClosureIndexAudit.promotionReady',
      'analysis.residualRuntimeProofClosureIndexAudit.promotionBlockedBy',
      'analysis.residualRuntimeProofClosureIndexAudit.runtimeProofClosureStatus'
    );
  } else if (item.decision === 'confirmed_field_or_alias_rejection_keep_quarantined') {
    closure.promotionReady = false;
    closure.promotionBlockedBy = 'confirmed_field_or_alias_only_or_indirect_use';
    closure.runtimeProofClosureStatus = 'runtime_rejection_recorded_keep_quarantined';
    appliedPaths.push(
      'analysis.residualRuntimeProofClosureIndexAudit.promotionReady',
      'analysis.residualRuntimeProofClosureIndexAudit.promotionBlockedBy',
      'analysis.residualRuntimeProofClosureIndexAudit.runtimeProofClosureStatus'
    );
  }

  return { applied: true, appliedPaths };
}

export function applyProofUpdatePlanCatalog(mapData, catalog) {
  const integrity = applyCatalogIntegrityFor(catalog);
  if (!integrity.ok) {
    throw new Error(`Refusing to apply proof-update catalog with integrity issues: ${integrity.issues.map(issue => issue.kind).join(', ')}`);
  }
  const changedRegions = [];
  const missingRegions = [];
  let proofMetadataAppliedCount = 0;
  for (const item of catalog.targetPlans || []) {
    const region = findRegion(mapData, item.regionId);
    if (!region) {
      missingRegions.push({ id: item.regionId, role: 'residual_runtime_proof_update_plan_target' });
      continue;
    }
    const proposal = (catalog.proposedUpdates || []).find(update => update.regionId === item.regionId) || null;
    region.analysis = region.analysis || {};
    const proofMetadata = applySafeProofMetadata(region, item, proposal, catalog);
    if (proofMetadata.applied) proofMetadataAppliedCount += 1;
    region.analysis.residualRuntimeProofUpdatePlanAudit = {
      catalogId,
      kind: 'residual_runtime_proof_update_plan',
      status: proposal?.planStatus || 'pending_runtime_trace_confirmation',
      confidence: item.decision === 'pending_insufficient_runtime_evidence' ? 'medium_pending_events' : item.confidence,
      planId: item.planId,
      classId: item.classId,
      targetOffsets: item.targetOffsets,
      decision: item.decision,
      finalStatus: item.finalStatus,
      eventSource: catalog.eventSource,
      eventSourceKind: catalog.eventSourceKind,
      guardStatus: catalog.summary.guardStatus,
      applyCatalogIntegrityOk: catalog.summary.applyCatalogIntegrityOk === true,
      applyCatalogRegionFilterScopeEnforced: catalog.summary.applyCatalogRegionFilterScopeEnforced === true,
      applyCatalogProposalsRequireTargetPlans: catalog.summary.applyCatalogProposalsRequireTargetPlans === true,
      reviewedRuntimeObservations: catalog.summary.reviewedRuntimeObservations === true,
      requiresReviewedRuntimeObservationsForApply: catalog.summary.requiresReviewedRuntimeObservationsForApply === true,
      proposedAction: proposal?.proposedAction || 'none',
      selectedTraceIds: item.selectedTraceIds,
      rejectedTraceIds: item.rejectedTraceIds,
      mutationEligible: catalog.summary.eventSourceUsableAsRuntimeEvidence && Boolean(proposal),
      proofMetadataAppliedByThisTool: proofMetadata.applied,
      appliedMetadataPaths: proofMetadata.appliedPaths,
      semanticDispositionMutatedByThisTool: false,
      coverageChangedByThisTool: false,
      defaultEventInputPath: catalog.summary.defaultEventInputPath,
      defaultPlanOutputPath: catalog.summary.defaultPlanOutputPath,
      summary: proposal
        ? 'A metadata-only proof update can be planned from the supplied confirmation decision; no semantic mutation is performed by this tool.'
        : 'Proof update planning is wired, but this residual still lacks a confirmed direct-consumer or field/alias rejection decision.',
      evidence: proposal?.evidence || catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      decision: item.decision,
      planStatus: proposal?.planStatus || 'pending_runtime_trace_confirmation',
      mutationEligible: catalog.summary.eventSourceUsableAsRuntimeEvidence && Boolean(proposal),
      proofMetadataApplied: proofMetadata.applied,
    });
  }

  mapData.residualProofUpdatePlanCatalogs = (mapData.residualProofUpdatePlanCatalogs || []).filter(item => item.id !== catalogId);
  mapData.residualProofUpdatePlanCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'residual_runtime_proof_update_plan_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    eventSource: catalog.eventSource,
    eventSourceKind: catalog.eventSourceKind,
    summary: {
      ...catalog.summary,
      changedRegionCount: changedRegions.length,
      missingRegionCount: missingRegions.length,
      proofMetadataAppliedCount,
    },
    changedRegions,
    missingRegions,
    proposedUpdates: catalog.proposedUpdates,
    guardIssues: catalog.guardIssues,
    applyCatalogIntegrityIssues: catalog.applyCatalogIntegrityIssues || [],
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
    assetPolicy: catalog.assetPolicy,
  });
  mapData.updatedAt = now;
  return { changedRegions, missingRegions, proofMetadataAppliedCount };
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.residualRuntimeProofUpdatePlanCatalog = catalogId;
  staticMap.summary.residualRuntimeProofUpdatePlanReady = catalog.summary.plannerReady;
  staticMap.summary.residualRuntimeProofUpdatePlanTargets = catalog.summary.targetRegionCount;
  staticMap.summary.residualRuntimeProofUpdatePlanCurrentProposals = catalog.summary.proposedRegionUpdateCount;
  staticMap.summary.residualRuntimeProofUpdatePlanRejectsUnfilledTemplatePlaceholders = catalog.summary.rejectsUnfilledTemplatePlaceholders;
  staticMap.summary.residualRuntimeProofUpdatePlanRejectsMissingRequiredCaptureFields = catalog.summary.rejectsMissingRequiredCaptureFields;
  staticMap.summary.residualRuntimeProofUpdatePlanRejectsIncoherentPromotionGates = catalog.summary.rejectsIncoherentPromotionGates;
  staticMap.summary.residualRuntimeProofUpdatePlanRequiresReviewedRuntimeObservationsForApply = catalog.summary.requiresReviewedRuntimeObservationsForApply;
  staticMap.summary.residualRuntimeProofUpdatePlanApplyCatalogIntegrityOk = catalog.summary.applyCatalogIntegrityOk;
  staticMap.summary.residualRuntimeProofUpdatePlanApplyCatalogRegionFilterScopeEnforced = catalog.summary.applyCatalogRegionFilterScopeEnforced;
  staticMap.summary.residualRuntimeProofUpdatePlanApplyCatalogProposalsRequireTargetPlans = catalog.summary.applyCatalogProposalsRequireTargetPlans;
  staticMap.summary.residualRuntimeProofUpdatePlanDefaultInput = catalog.summary.defaultEventInputPath;
  staticMap.summary.residualRuntimeProofUpdatePlanDefaultOutput = catalog.summary.defaultPlanOutputPath;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-residual-runtime-proof-update-plan-catalog-2026-06-26 to convert real metadata-only residual trace confirmations into reviewed proof-update plans before semantic promotion.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const apply = process.argv.includes('--apply');
  const noWrite = process.argv.includes('--no-write');
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const mapData = readJson(mapPath);
  const eventBundle = loadEventBundleFromArgs();
  eventBundle.regionIds = normalizeRegionFilters([
    ...argValues('--region'),
    ...argValues('--regions'),
  ]);
  const catalog = buildProofUpdatePlanCatalog(mapData, eventBundle);
  const blocked = catalog.summary.guardStatus.startsWith('blocked_');
  const unsafeProposalApply = apply &&
    catalog.proposedUpdates.length > 0 &&
    !catalog.summary.eventSourceUsableAsRuntimeEvidence;
  let annotation = { changedRegions: [], missingRegions: [] };

  if (apply) {
    if (blocked) throw new Error(`Refusing to apply blocked proof-update plan: ${catalog.summary.guardStatus}`);
    if (unsafeProposalApply) {
      throw new Error(`Refusing to apply non-bundle proof-update proposals: ${catalog.summary.guardStatus}`);
    }
    annotation = applyProofUpdatePlanCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }

  const shouldWriteOutput = !noWrite && !blocked && (Boolean(argValue('--out')) || (eventBundle.source !== 'none' && !apply));
  if (shouldWriteOutput) writeJson(outputPath, catalog);

  console.log(JSON.stringify({
    ok: !blocked,
    applied: apply,
    output: shouldWriteOutput ? relativeRepoPath(outputPath) : null,
    catalogId,
    eventSource: catalog.eventSource,
    eventSourceKind: catalog.eventSourceKind,
    summary: catalog.summary,
    guardIssues: catalog.guardIssues,
    proposedUpdates: catalog.proposedUpdates,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    proofMetadataAppliedCount: annotation.proofMetadataAppliedCount || 0,
  }, null, 2));

  if (blocked) process.exitCode = 1;
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
