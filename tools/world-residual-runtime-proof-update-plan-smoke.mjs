#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyProofUpdatePlanCatalog,
  buildProofUpdatePlanCatalog,
} from './world-residual-runtime-proof-update-plan-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const outputPath = path.join(repoRoot, 'tmp/world-residual-runtime-proof-update-plan-smoke-output.json');

function readMap() {
  return JSON.parse(fs.readFileSync(mapPath, 'utf8'));
}

const mapData = readMap();

const baseline = buildProofUpdatePlanCatalog(mapData, {
  events: [],
  source: 'none',
  sourceKind: 'none',
});
assert.equal(baseline.summary.guardStatus, 'ready_waiting_for_runtime_event_bundle');
assert.equal(baseline.summary.proposedRegionUpdateCount, 0);
assert.equal(baseline.summary.eventSourceUsableAsRuntimeEvidence, false);

const selected = buildProofUpdatePlanCatalog(mapData, {
  source: 'synthetic_smoke',
  sourceKind: 'synthetic_smoke',
  events: [
    { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'selected', active_bank: 4, _RAM_CF64_: 227, overlay_record_index: 227, computed_record_offset: '0x10718' },
    { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'selected', active_bank: 4, loader_source_region_id: 'r2813', loader_source_offset: '0x10718' },
    { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'selected', target_region_id: 'r2813', runtime_trace_kind: 'runtime_ram_index_bound_trace', direct_consumer_confirmed: true, promotion_ready: true },
  ],
});
assert.equal(selected.summary.proposedRegionUpdateCount, 1);
assert.equal(selected.summary.guardStatus, 'plan_built_from_nonbundle_events_not_apply_eligible');
assert.equal(selected.summary.eventSourceUsableAsRuntimeEvidence, false);
assert.equal(selected.summary.inputHasMissingRequiredCaptureFields, false);
assert.equal(selected.proposedUpdates[0].regionId, 'r2813');
assert.equal(selected.proposedUpdates[0].semanticDispositionMutatedByThisPlan, false);
assert.equal(selected.proposedUpdates[0].coverageChangedByThisPlan, false);

const focusedSelected = buildProofUpdatePlanCatalog(mapData, {
  source: 'synthetic_smoke',
  sourceKind: 'synthetic_smoke',
  regionIds: ['r2813'],
  events: [
    { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'selected', active_bank: 4, _RAM_CF64_: 227, overlay_record_index: 227, computed_record_offset: '0x10718' },
    { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'selected', active_bank: 4, loader_source_region_id: 'r2813', loader_source_offset: '0x10718' },
    { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'selected', target_region_id: 'r2813', runtime_trace_kind: 'runtime_ram_index_bound_trace', direct_consumer_confirmed: true, promotion_ready: true },
  ],
});
assert.deepEqual(focusedSelected.summary.regionFilter, ['r2813']);
assert.equal(focusedSelected.summary.regionFilterApplied, true);
assert.equal(focusedSelected.summary.evaluatedTracePlanCount, 1);
assert.equal(focusedSelected.summary.targetRegionCount, 1);
assert.equal(focusedSelected.summary.confirmationDecisionCount, 1);
assert.equal(focusedSelected.summary.pendingInsufficientCount, 0);
assert.equal(focusedSelected.summary.proposedRegionUpdateCount, 1);
assert.equal(focusedSelected.targetPlans.length, 1);
assert.equal(focusedSelected.targetPlans[0].regionId, 'r2813');
assert.equal(focusedSelected.summary.applyCatalogIntegrityOk, true);
assert.equal(focusedSelected.summary.applyCatalogRegionFilterScopeEnforced, true);
assert.equal(focusedSelected.summary.applyCatalogProposalsRequireTargetPlans, true);

const selectedBundleUnreviewed = buildProofUpdatePlanCatalog(mapData, {
  source: 'tmp/world-residual-runtime-trace-events.local.json',
  sourceKind: 'metadata_event_bundle',
  events: {
    eventKind: 'wb3_residual_runtime_trace_events',
    source: 'synthetic_smoke_bundle',
    events: [
      { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'selected', active_bank: 4, _RAM_CF64_: 227, overlay_record_index: 227, computed_record_offset: '0x10718' },
      { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'selected', active_bank: 4, loader_source_region_id: 'r2813', loader_source_offset: '0x10718' },
      { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'selected', target_region_id: 'r2813', runtime_trace_kind: 'runtime_ram_index_bound_trace', direct_consumer_confirmed: true, promotion_ready: true },
    ],
  },
});
assert.equal(selectedBundleUnreviewed.summary.guardStatus, 'plan_ready_waiting_for_reviewed_runtime_observations');
assert.equal(selectedBundleUnreviewed.summary.eventSourceUsableAsRuntimeEvidence, false);
assert.equal(selectedBundleUnreviewed.summary.reviewedRuntimeObservations, false);
assert.equal(selectedBundleUnreviewed.summary.safeProofMetadataUpdateEligibleCount, 0);
assert.equal(selectedBundleUnreviewed.summary.proposedRegionUpdateCount, 1);
const unreviewedCloneForApply = JSON.parse(JSON.stringify(mapData));
const unreviewedApplied = applyProofUpdatePlanCatalog(unreviewedCloneForApply, selectedBundleUnreviewed);
assert.equal(unreviewedApplied.proofMetadataAppliedCount, 0);

const selectedBundle = buildProofUpdatePlanCatalog(mapData, {
  source: 'tmp/world-residual-runtime-trace-events.local.json',
  sourceKind: 'metadata_event_bundle',
  reviewedRuntimeObservations: true,
  events: {
    eventKind: 'wb3_residual_runtime_trace_events',
    source: 'synthetic_smoke_bundle',
    events: [
      { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'selected', active_bank: 4, _RAM_CF64_: 227, overlay_record_index: 227, computed_record_offset: '0x10718' },
      { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'selected', active_bank: 4, loader_source_region_id: 'r2813', loader_source_offset: '0x10718' },
      { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'selected', target_region_id: 'r2813', runtime_trace_kind: 'runtime_ram_index_bound_trace', direct_consumer_confirmed: true, promotion_ready: true },
    ],
  },
});
assert.equal(selectedBundle.summary.guardStatus, 'plan_ready_from_reviewed_metadata_event_bundle');
assert.equal(selectedBundle.summary.eventSourceUsableAsRuntimeEvidence, true);
assert.equal(selectedBundle.summary.reviewedRuntimeObservations, true);
assert.equal(selectedBundle.summary.inputHasMissingRequiredCaptureFields, false);
assert.equal(selectedBundle.summary.safeProofMetadataUpdateEligibleCount, 1);

const cloneForApply = JSON.parse(JSON.stringify(mapData));
const applied = applyProofUpdatePlanCatalog(cloneForApply, selectedBundle);
assert.equal(applied.proofMetadataAppliedCount, 1);
const appliedRegion = cloneForApply.regions.find(region => region.id === 'r2813');
assert.equal(appliedRegion.type, 'data_table');
assert.equal(appliedRegion.offset, '0x10718');
assert.equal(appliedRegion.analysis.lowConfidenceResidualTriageAudit.runtimeProofUpdateStatus, 'runtime_direct_consumer_confirmed');
assert.equal(appliedRegion.analysis.lowConfidenceResidualTriageAudit.runtimeProofSemanticDispositionMutated, false);
assert.equal(appliedRegion.analysis.lowConfidenceResidualTriageAudit.runtimeProofCoverageChanged, false);
assert.equal(appliedRegion.analysis.residualRuntimeProofClosureIndexAudit.promotionReady, true);
assert.equal(appliedRegion.analysis.residualRuntimeProofClosureIndexAudit.promotionBlockedBy, 'none_after_verified_runtime_trace');
assert.equal(appliedRegion.analysis.residualRuntimeProofUpdatePlanAudit.proofMetadataAppliedByThisTool, true);
assert.equal(appliedRegion.analysis.residualRuntimeProofUpdatePlanAudit.semanticDispositionMutatedByThisTool, false);
assert.equal(appliedRegion.analysis.residualRuntimeProofUpdatePlanAudit.coverageChangedByThisTool, false);
assert.equal(appliedRegion.analysis.residualRuntimeProofUpdatePlanAudit.applyCatalogIntegrityOk, true);

const rejected = buildProofUpdatePlanCatalog(mapData, {
  source: 'synthetic_smoke',
  sourceKind: 'synthetic_smoke',
  events: [
    { hookId: 'residual_bank7_sidecar_controller_entry', same_frame_trace_id: 'alias', active_bank: 7, controller_phase: 'sequence_controller_entry' },
    { hookId: 'residual_bank7_alias_loader_call', same_frame_trace_id: 'alias', active_bank: 7, loaded_hl_offset: '0x12337', called_loader_label: '_LABEL_8FB_', source_region_id: 'r2721' },
    { hookId: 'residual_bank7_sidecar_direct_watch', same_frame_trace_id: 'alias', active_bank: 7, read_offset: '0x1E337', read_region_id: 'r0749', direct_bank7_consumer: false },
    { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'alias', target_region_id: 'r0749', runtime_trace_kind: 'runtime_alias_rejection_trace', field_or_alias_only_rejected: true },
  ],
});
assert.equal(rejected.summary.proposedRegionUpdateCount, 1);
assert.equal(rejected.proposedUpdates[0].regionId, 'r0749');
assert.equal(rejected.proposedUpdates[0].planStatus, 'ready_to_record_field_or_alias_rejection');

const mixedFocusedBundle = buildProofUpdatePlanCatalog(mapData, {
  source: 'tmp/world-residual-runtime-trace-events.local.json',
  sourceKind: 'metadata_event_bundle',
  reviewedRuntimeObservations: true,
  regionIds: ['r2813'],
  events: {
    eventKind: 'wb3_residual_runtime_trace_events',
    source: 'synthetic_mixed_focus_bundle',
    events: [
      { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'selected', active_bank: 4, _RAM_CF64_: 227, overlay_record_index: 227, computed_record_offset: '0x10718' },
      { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'selected', active_bank: 4, loader_source_region_id: 'r2813', loader_source_offset: '0x10718' },
      { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'selected', target_region_id: 'r2813', runtime_trace_kind: 'runtime_ram_index_bound_trace', direct_consumer_confirmed: true, promotion_ready: true },
      { hookId: 'residual_bank7_sidecar_controller_entry', same_frame_trace_id: 'alias', active_bank: 7, controller_phase: 'sequence_controller_entry' },
      { hookId: 'residual_bank7_alias_loader_call', same_frame_trace_id: 'alias', active_bank: 7, loaded_hl_offset: '0x12337', called_loader_label: '_LABEL_8FB_', source_region_id: 'r2721' },
      { hookId: 'residual_bank7_sidecar_direct_watch', same_frame_trace_id: 'alias', active_bank: 7, read_offset: '0x1E337', read_region_id: 'r0749', direct_bank7_consumer: false },
      { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'alias', target_region_id: 'r0749', runtime_trace_kind: 'runtime_alias_rejection_trace', field_or_alias_only_rejected: true },
    ],
  },
});
assert.deepEqual(mixedFocusedBundle.summary.regionFilter, ['r2813']);
assert.equal(mixedFocusedBundle.summary.targetRegionCount, 1);
assert.equal(mixedFocusedBundle.summary.proposedRegionUpdateCount, 1);
assert.equal(mixedFocusedBundle.targetPlans.length, 1);
assert.equal(mixedFocusedBundle.targetPlans[0].regionId, 'r2813');
assert.equal(mixedFocusedBundle.proposedUpdates[0].regionId, 'r2813');
assert.equal(mixedFocusedBundle.summary.applyCatalogIntegrityOk, true);
const mixedFocusedClone = JSON.parse(JSON.stringify(mapData));
const mixedFocusedApplied = applyProofUpdatePlanCatalog(mixedFocusedClone, mixedFocusedBundle);
assert.equal(mixedFocusedApplied.proofMetadataAppliedCount, 1);
assert.equal(mixedFocusedApplied.changedRegions.length, 1);
assert.equal(mixedFocusedApplied.changedRegions[0].id, 'r2813');

const tamperedFocusedCatalog = JSON.parse(JSON.stringify(mixedFocusedBundle));
tamperedFocusedCatalog.targetPlans.push(rejected.targetPlans.find(item => item.regionId === 'r0749'));
tamperedFocusedCatalog.proposedUpdates.push(rejected.proposedUpdates[0]);
tamperedFocusedCatalog.summary.targetRegionCount = 2;
tamperedFocusedCatalog.summary.proposedRegionUpdateCount = 2;
assert.throws(
  () => applyProofUpdatePlanCatalog(JSON.parse(JSON.stringify(mapData)), tamperedFocusedCatalog),
  /target_plan_outside_focused_region_filter/
);

const proposalWithoutTargetCatalog = JSON.parse(JSON.stringify(mixedFocusedBundle));
proposalWithoutTargetCatalog.proposedUpdates.push({ ...rejected.proposedUpdates[0], regionId: 'r0749' });
proposalWithoutTargetCatalog.summary.proposedRegionUpdateCount = 2;
assert.throws(
  () => applyProofUpdatePlanCatalog(JSON.parse(JSON.stringify(mapData)), proposalWithoutTargetCatalog),
  /proposed_update_outside_focused_region_filter/
);

const forbidden = buildProofUpdatePlanCatalog(mapData, {
  source: 'synthetic_bad_payload',
  sourceKind: 'synthetic_smoke',
  events: [
    { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'bad', overlay_record_index: 227, computed_record_offset: '0x10718', romBytes: [0, 1] },
    { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'bad', loader_source_region_id: 'r2813' },
    { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'bad', target_region_id: 'r2813' },
  ],
});
assert.equal(forbidden.summary.guardStatus, 'blocked_forbidden_payload_keys');
assert.equal(forbidden.summary.proposedRegionUpdateCount, 0);

const missingFieldBundle = buildProofUpdatePlanCatalog(mapData, {
  source: 'tmp/world-residual-runtime-trace-events.local.json',
  sourceKind: 'metadata_event_bundle',
  events: {
    eventKind: 'wb3_residual_runtime_trace_events',
    source: 'synthetic_missing_field_bundle',
    events: [
      { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'missing-field', active_bank: 4, overlay_record_index: 227, computed_record_offset: '0x10718' },
      { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'missing-field', active_bank: 4, loader_source_region_id: 'r2813', loader_source_offset: '0x10718' },
      { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'missing-field', target_region_id: 'r2813', runtime_trace_kind: 'runtime_ram_index_bound_trace', direct_consumer_confirmed: true, promotion_ready: true },
    ],
  },
});
assert.equal(missingFieldBundle.summary.guardStatus, 'blocked_required_capture_fields_missing');
assert.equal(missingFieldBundle.summary.proposedRegionUpdateCount, 1);
assert.equal(missingFieldBundle.summary.eventSourceUsableAsRuntimeEvidence, false);
assert.equal(missingFieldBundle.summary.requiredFieldIssueCount, 1);

const incoherentGateBundle = buildProofUpdatePlanCatalog(mapData, {
  source: 'tmp/world-residual-runtime-trace-events.local.json',
  sourceKind: 'metadata_event_bundle',
  events: {
    eventKind: 'wb3_residual_runtime_trace_events',
    source: 'synthetic_incoherent_gate_bundle',
    events: [
      { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'incoherent-gate', active_bank: 4, _RAM_CF64_: 226, overlay_record_index: 226, computed_record_offset: '0x10716' },
      { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'incoherent-gate', active_bank: 4, loader_source_region_id: 'r2800', loader_source_offset: '0x10716' },
      { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'incoherent-gate', target_region_id: 'r2813', runtime_trace_kind: 'runtime_ram_index_bound_trace', direct_consumer_confirmed: true, promotion_ready: true },
    ],
  },
});
assert.equal(incoherentGateBundle.summary.guardStatus, 'blocked_promotion_gate_coherence_failed');
assert.equal(incoherentGateBundle.summary.proposedRegionUpdateCount, 1);
assert.equal(incoherentGateBundle.summary.eventSourceUsableAsRuntimeEvidence, false);
assert.equal(incoherentGateBundle.summary.inputHasIncoherentPromotionGates, true);
assert.equal(incoherentGateBundle.summary.promotionGateCoherenceIssueCount, 1);

const template = buildProofUpdatePlanCatalog(mapData, {
  source: 'tmp/local-hook-observations.template.json',
  sourceKind: 'template_not_runtime_evidence',
  events: [],
});
assert.equal(template.summary.guardStatus, 'blocked_template_not_runtime_evidence');
assert.equal(template.summary.proposedRegionUpdateCount, 0);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({
  ok: true,
  baseline: baseline.summary,
  selected: selected.summary,
  focusedSelected: focusedSelected.summary,
  selectedBundleUnreviewed: selectedBundleUnreviewed.summary,
  selectedBundle: selectedBundle.summary,
  mixedFocusedBundle: mixedFocusedBundle.summary,
  applied: {
    proofMetadataAppliedCount: applied.proofMetadataAppliedCount,
    changedRegionCount: applied.changedRegions.length,
  },
  mixedFocusedApplied: {
    proofMetadataAppliedCount: mixedFocusedApplied.proofMetadataAppliedCount,
    changedRegionCount: mixedFocusedApplied.changedRegions.length,
  },
  rejected: rejected.summary,
  forbidden: forbidden.summary,
  missingFieldBundle: missingFieldBundle.summary,
  incoherentGateBundle: incoherentGateBundle.summary,
  template: template.summary,
}, null, 2)}\n`);

console.log('residual runtime proof update plan smoke ok');
