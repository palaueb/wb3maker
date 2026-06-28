#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-residual-semantic-disposition-plan-audit.mjs';
const catalogId = 'world-residual-semantic-disposition-plan-catalog-2026-06-26';
const reportId = 'residual-semantic-disposition-plan-audit-2026-06-26';
const schemaVersion = 1;

const sourceCatalogs = [
  'world-low-confidence-residual-triage-catalog-2026-06-26',
  'world-residual-runtime-proof-closure-index-catalog-2026-06-26',
  'world-residual-runtime-proof-update-plan-catalog-2026-06-26',
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

function residualRegions(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.lowConfidenceResidualTriageAudit?.proofPlan)
    .sort((a, b) => Number.parseInt(a.offset, 16) - Number.parseInt(b.offset, 16));
}

function countBy(items, keyFn) {
  return (items || []).reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function compactRegion(region) {
  return {
    id: region.id,
    offset: region.offset,
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    confidence: region.confidence || null,
    name: region.name || '',
  };
}

function proofState(region) {
  const analysis = region.analysis || {};
  const triage = analysis.lowConfidenceResidualTriageAudit || {};
  const closure = analysis.residualRuntimeProofClosureIndexAudit || {};
  const proofUpdate = analysis.residualRuntimeProofUpdatePlanAudit || {};
  return {
    classId: proofUpdate.classId || triage.classId || triage.kind || 'unknown_residual_class',
    triageStatus: triage.status || '',
    triageRuntimeProofUpdateStatus: triage.runtimeProofUpdateStatus || '',
    closurePromotionReady: closure.promotionReady === true,
    closurePromotionBlockedBy: closure.promotionBlockedBy || '',
    closureRuntimeProofConfirmed: closure.runtimeProofConfirmed === true,
    closureRuntimeProofRejectedAsFieldOrAlias: closure.runtimeProofRejectedAsFieldOrAlias === true,
    closureRuntimeProofUpdateStatus: closure.runtimeProofUpdateStatus || '',
    proofUpdateStatus: proofUpdate.status || '',
    proofUpdateDecision: proofUpdate.decision || '',
    proofMetadataApplied: proofUpdate.proofMetadataAppliedByThisTool === true,
    semanticDispositionMutatedByProofUpdate: proofUpdate.semanticDispositionMutatedByThisTool === true,
    coverageChangedByProofUpdate: proofUpdate.coverageChangedByThisTool === true,
    mutationEligible: proofUpdate.mutationEligible === true,
    eventSource: proofUpdate.eventSource || 'none',
    selectedTraceIds: proofUpdate.selectedTraceIds || [],
    rejectedTraceIds: proofUpdate.rejectedTraceIds || [],
  };
}

function dispositionFor(state) {
  if (state.semanticDispositionMutatedByProofUpdate || state.coverageChangedByProofUpdate) {
    return {
      status: 'blocked_unexpected_prior_mutation',
      confidence: 'high_policy_block',
      proposedAction: 'manual_audit_required',
      semanticPromotionReady: false,
      keepQuarantined: true,
      reason: 'A prior proof-update record claims semantic or coverage mutation; residual disposition must be manually audited before proceeding.',
    };
  }
  if (!state.proofMetadataApplied) {
    return {
      status: 'pending_runtime_proof_metadata',
      confidence: 'medium_pending_events',
      proposedAction: 'wait_for_real_runtime_proof_update',
      semanticPromotionReady: false,
      keepQuarantined: true,
      reason: 'No safe proof metadata has been applied from a real metadata-only runtime event bundle.',
    };
  }
  if (state.proofUpdateDecision === 'confirmed_field_or_alias_rejection_keep_quarantined' ||
      state.triageRuntimeProofUpdateStatus === 'runtime_field_or_alias_rejected_keep_quarantined' ||
      state.closureRuntimeProofRejectedAsFieldOrAlias) {
    return {
      status: 'runtime_rejection_keep_quarantined',
      confidence: 'high_for_supplied_runtime_proof',
      proposedAction: 'keep_low_confidence_and_excluded_from_default_decoders',
      semanticPromotionReady: false,
      keepQuarantined: true,
      reason: 'Runtime proof metadata confirms only field, alias, or indirect use; this residual should remain quarantined.',
    };
  }
  if (state.proofUpdateDecision === 'confirmed_direct_consumer_ready_for_residual_update' &&
      state.triageRuntimeProofUpdateStatus === 'runtime_direct_consumer_confirmed' &&
      state.closurePromotionReady &&
      state.closureRuntimeProofConfirmed) {
    return {
      status: 'runtime_direct_consumer_confirmed_semantic_review_required',
      confidence: 'high_for_supplied_runtime_proof',
      proposedAction: 'review_consumer_specific_role_before_top_level_type_or_confidence_change',
      semanticPromotionReady: true,
      keepQuarantined: false,
      reason: 'Runtime proof metadata confirms a direct consumer, but this planner does not infer the final consumer-specific semantic role or mutate top-level type/confidence.',
    };
  }
  return {
    status: 'pending_or_inconsistent_runtime_proof_metadata',
    confidence: 'medium_pending_review',
    proposedAction: 'inspect_proof_update_metadata_before_semantic_change',
    semanticPromotionReady: false,
    keepQuarantined: true,
    reason: 'Proof metadata exists but does not satisfy the direct-consumer promotion gate or explicit quarantine rejection gate.',
  };
}

function entryFor(region) {
  const state = proofState(region);
  const disposition = dispositionFor(state);
  return {
    region: compactRegion(region),
    classId: state.classId,
    proofState: state,
    status: disposition.status,
    confidence: disposition.confidence,
    proposedAction: disposition.proposedAction,
    semanticPromotionReady: disposition.semanticPromotionReady,
    keepQuarantined: disposition.keepQuarantined,
    topLevelTypeBefore: region.type || 'unknown',
    topLevelConfidenceBefore: region.confidence || null,
    topLevelTypeMutationAllowedByThisTool: false,
    topLevelConfidenceMutationAllowedByThisTool: false,
    semanticDispositionMutatedByThisTool: false,
    coverageChangedByThisTool: false,
    proposedFollowup: disposition.semanticPromotionReady
      ? 'Run a consumer-specific semantic audit that names the runtime consumer, role, parser/decoder contract, and expected top-level type before changing region type or confidence.'
      : 'Keep the current region type/confidence and continue runtime trace collection or quarantine review.',
    evidence: [
      `lowConfidenceResidualTriageAudit classifies ${region.id} as ${state.classId}.`,
      `residualRuntimeProofUpdatePlanAudit decision is ${state.proofUpdateDecision || 'none'} with proofMetadataAppliedByThisTool=${state.proofMetadataApplied}.`,
      `residualRuntimeProofClosureIndexAudit promotionReady=${state.closurePromotionReady} and promotionBlockedBy=${state.closurePromotionBlockedBy || 'none'}.`,
      disposition.reason,
    ],
  };
}

export function buildResidualSemanticDispositionPlanCatalog(mapData) {
  for (const id of sourceCatalogs) requireCatalog(mapData, id);
  const entries = residualRegions(mapData).map(entryFor);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: region ids, offsets, sizes, classes, proof statuses, trace ids, dispositions, booleans, and policy flags. No ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      residualCount: entries.length,
      semanticPromotionReadyCount: entries.filter(entry => entry.semanticPromotionReady).length,
      keepQuarantinedCount: entries.filter(entry => entry.keepQuarantined).length,
      pendingRuntimeProofMetadataCount: entries.filter(entry => entry.status === 'pending_runtime_proof_metadata').length,
      runtimeRejectionKeepQuarantinedCount: entries.filter(entry => entry.status === 'runtime_rejection_keep_quarantined').length,
      blockedUnexpectedPriorMutationCount: entries.filter(entry => entry.status === 'blocked_unexpected_prior_mutation').length,
      statusCounts: countBy(entries, entry => entry.status),
      classCounts: countBy(entries, entry => entry.classId),
      topLevelTypeMutationAllowedByThisTool: false,
      topLevelConfidenceMutationAllowedByThisTool: false,
      semanticDispositionMutatedByThisTool: false,
      coverageChangedByThisTool: false,
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
    entries,
    evidence: [
      'This planner consumes low-confidence residual triage, residual runtime closure, and residual proof-update plan metadata.',
      'It does not mutate top-level type, top-level confidence, region offsets, region sizes, coverage, or decoded asset data.',
      'Direct-consumer runtime proof only moves a residual to consumer-specific semantic review; a separate audit must name the final role before promotion.',
    ],
    nextLeads: [
      'After real runtime proof metadata is applied, inspect semanticPromotionReady entries and build a consumer-specific semantic audit.',
      'Keep runtime_rejection_keep_quarantined entries excluded from default decoders and high-confidence asset readiness.',
      'Pending entries still need metadata-only runtime trace observations before any semantic disposition can change.',
    ],
  };
}

export function applyResidualSemanticDispositionPlanCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const entry of catalog.entries || []) {
    const region = (mapData.regions || []).find(item => item.id === entry.region.id);
    if (!region) {
      missingRegions.push({ id: entry.region.id, role: 'residual_semantic_disposition_plan_target' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.residualSemanticDispositionPlanAudit = {
      catalogId,
      kind: 'residual_semantic_disposition_plan',
      status: entry.status,
      confidence: entry.confidence,
      classId: entry.classId,
      proposedAction: entry.proposedAction,
      semanticPromotionReady: entry.semanticPromotionReady,
      keepQuarantined: entry.keepQuarantined,
      topLevelTypeBefore: entry.topLevelTypeBefore,
      topLevelConfidenceBefore: entry.topLevelConfidenceBefore,
      topLevelTypeMutationAllowedByThisTool: false,
      topLevelConfidenceMutationAllowedByThisTool: false,
      semanticDispositionMutatedByThisTool: false,
      coverageChangedByThisTool: false,
      proposedFollowup: entry.proposedFollowup,
      proofDecision: entry.proofState.proofUpdateDecision,
      proofMetadataApplied: entry.proofState.proofMetadataApplied,
      eventSource: entry.proofState.eventSource,
      selectedTraceIds: entry.proofState.selectedTraceIds,
      rejectedTraceIds: entry.proofState.rejectedTraceIds,
      summary: entry.semanticPromotionReady
        ? 'Direct runtime proof metadata is present; consumer-specific semantic review is required before top-level type/confidence changes.'
        : 'Residual semantic disposition remains pending or quarantined; no top-level type/confidence mutation is allowed by this planner.',
      evidence: entry.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      confidence: region.confidence || null,
      status: entry.status,
      semanticPromotionReady: entry.semanticPromotionReady,
      keepQuarantined: entry.keepQuarantined,
    });
  }

  mapData.residualSemanticDispositionPlanCatalogs = (mapData.residualSemanticDispositionPlanCatalogs || []).filter(item => item.id !== catalogId);
  mapData.residualSemanticDispositionPlanCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'residual_semantic_disposition_plan_audit',
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
  staticMap.summary.residualSemanticDispositionPlanCatalog = catalogId;
  staticMap.summary.residualSemanticDispositionPlanTargets = catalog.summary.residualCount;
  staticMap.summary.residualSemanticDispositionPromotionReady = catalog.summary.semanticPromotionReadyCount;
  staticMap.summary.residualSemanticDispositionKeepQuarantined = catalog.summary.keepQuarantinedCount;
  staticMap.summary.residualSemanticDispositionPending = catalog.summary.pendingRuntimeProofMetadataCount;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-residual-semantic-disposition-plan-catalog-2026-06-26 after real residual proof metadata is applied; it plans semantic review without mutating top-level type, confidence, or coverage.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildResidualSemanticDispositionPlanCatalog(mapData);
  let result = { changedRegions: [], missingRegions: [] };
  if (apply) {
    result = applyResidualSemanticDispositionPlanCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    changedRegions: result.changedRegions,
    missingRegions: result.missingRegions,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
