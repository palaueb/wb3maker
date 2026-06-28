#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLocalResidualRuntimeTraceObservationTemplate } from './world-residual-runtime-trace-local-bundle.mjs';
import { buildResidualRuntimeClosurePipelineCatalog } from './world-residual-runtime-closure-pipeline-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const outputPath = path.join(repoRoot, 'tmp/world-residual-runtime-closure-pipeline-smoke-output.json');

function readMap() {
  return JSON.parse(fs.readFileSync(mapPath, 'utf8'));
}

const mapData = readMap();

const waiting = buildResidualRuntimeClosurePipelineCatalog(mapData);
assert.equal(waiting.summary.guardStatus, 'waiting_for_observation_input');
assert.equal(waiting.summary.realMapMutatedByThisPipeline, false);
assert.equal(waiting.summary.targetRegionCount, 5);
assert.equal(waiting.summary.rejectsIncoherentPromotionGates, true);

const template = buildLocalResidualRuntimeTraceObservationTemplate(mapData);
const templatePipeline = buildResidualRuntimeClosurePipelineCatalog(mapData, template, {
  source: 'tmp/local-hook-observations.template.json',
});
assert.equal(templatePipeline.summary.guardStatus, 'blocked_template_input_not_runtime_evidence');
assert.equal(templatePipeline.summary.proofPlanProposedUpdateCount, 0);

const copiedTemplate = JSON.parse(JSON.stringify(template));
delete copiedTemplate.templateOnly;
copiedTemplate.eventKind = 'wb3_residual_runtime_trace_observations';
copiedTemplate.source = 'synthetic_copied_unfilled_template_pipeline_smoke';
const copiedTemplatePipeline = buildResidualRuntimeClosurePipelineCatalog(mapData, copiedTemplate, {
  source: 'tmp/local-hook-observations.json',
});
assert.equal(copiedTemplatePipeline.summary.guardStatus, 'blocked_unfilled_template_placeholders_present');
assert.equal(copiedTemplatePipeline.summary.observationInputUsableAsRuntimeEvidence, false);
assert.equal(copiedTemplatePipeline.summary.unresolvedPlaceholderCount > 16, true);
assert.equal(copiedTemplatePipeline.summary.proofPlanProposedUpdateCount, 0);

const candidateOnlyObservation = {
  schemaVersion: 1,
  eventKind: 'wb3_gearsystem_mcp_observation_candidates',
  candidateOnly: true,
  source: 'synthetic_candidate_only_pipeline_smoke',
  observations: [
    { hookId: 'residual_palette_parser_entry', same_frame_trace_id: 'candidate-only', active_bank: 8, palette_script_entry_index: 25 },
    { hookId: 'residual_palette_tail_cursor_watch', same_frame_trace_id: 'candidate-only', active_bank: 8, consumer_label: '_LABEL_919_', cursor_region_id: 'r2815', cursor_offset: '0x1CBB9', access_role: 'direct_consumer', inside_palette_tail_region: true },
    { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'candidate-only', target_region_id: 'r2815', runtime_trace_kind: 'same_bank_or_physical_source_palette_tail_trace', field_or_alias_only_rejected: true },
  ],
};
const candidateOnlyPipeline = buildResidualRuntimeClosurePipelineCatalog(mapData, candidateOnlyObservation, {
  source: 'tmp/local-hook-observations.palette-tail-physical-source-candidates.local.json',
  regionIds: ['r2815'],
});
assert.equal(candidateOnlyPipeline.summary.guardStatus, 'blocked_candidate_only_input_not_runtime_evidence');
assert.equal(candidateOnlyPipeline.summary.inputHasCandidateOnlyEvidence, true);
assert.equal(candidateOnlyPipeline.summary.observationInputUsableAsRuntimeEvidence, false);
assert.equal(candidateOnlyPipeline.summary.rejectsCandidateOnlyEvidence, true);
assert.equal(candidateOnlyPipeline.summary.bundleEventCount, 0);
assert.equal(candidateOnlyPipeline.summary.proofMetadataWouldApplyOnCloneCount, 0);

const copiedCandidateObservation = {
  schemaVersion: 1,
  eventKind: 'wb3_residual_runtime_trace_observations',
  source: 'synthetic_copied_candidate_trace_pipeline_smoke',
  observations: [
    { hookId: 'residual_palette_parser_entry', same_frame_trace_id: 'mcp-physical-source-candidate-r2815-01', active_bank: 8, palette_script_entry_index: 25 },
    { hookId: 'residual_palette_tail_cursor_watch', same_frame_trace_id: 'mcp-physical-source-candidate-r2815-01', active_bank: 8, consumer_label: '_LABEL_919_', cursor_region_id: 'r2815', cursor_offset: '0x1CBB9', physical_rom_region_id: 'r0754', physical_rom_offset: '0x20BB9', mapped_source_bank: 8, bank_context_matches_source: false, access_role: 'direct_consumer', inside_palette_tail_region: true },
    { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'mcp-physical-source-candidate-r2815-01', target_region_id: 'r2815', runtime_trace_kind: 'same_bank_or_physical_source_palette_tail_trace', field_or_alias_only_rejected: true },
  ],
};
const copiedCandidatePipeline = buildResidualRuntimeClosurePipelineCatalog(mapData, copiedCandidateObservation, {
  source: 'tmp/local-hook-observations.json',
  regionIds: ['r2815'],
});
assert.equal(copiedCandidatePipeline.summary.guardStatus, 'blocked_generated_candidate_trace_ids_present');
assert.equal(copiedCandidatePipeline.summary.inputHasGeneratedCandidateTraceIds, true);
assert.equal(copiedCandidatePipeline.summary.generatedCandidateTraceIdCount, 3);
assert.equal(copiedCandidatePipeline.summary.completePlanCount, 1);
assert.equal(copiedCandidatePipeline.summary.bundleEventCount, 0);
assert.equal(copiedCandidatePipeline.summary.proofMetadataWouldApplyOnCloneCount, 0);

const directObservation = {
  schemaVersion: 1,
  eventKind: 'wb3_residual_runtime_trace_observations',
  source: 'synthetic_smoke_direct_observation',
  observations: [
    { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'direct', active_bank: 4, _RAM_CF64_: 227, overlay_record_index: 227, computed_record_offset: '0x10718' },
    { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'direct', active_bank: 4, loader_source_region_id: 'r2813', loader_source_offset: '0x10718' },
    { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'direct', target_region_id: 'r2813', runtime_trace_kind: 'runtime_ram_index_bound_trace', direct_consumer_confirmed: true, promotion_ready: true },
  ],
};
const directPipeline = buildResidualRuntimeClosurePipelineCatalog(mapData, directObservation, {
  source: 'tmp/local-hook-observations.json',
});
assert.equal(directPipeline.summary.guardStatus, 'pipeline_ready_for_reviewed_proof_update');
assert.equal(directPipeline.summary.completePlanCount, 1);
assert.equal(directPipeline.summary.inputHasMissingRequiredCaptureFields, false);
assert.equal(directPipeline.summary.confirmationPromotionReadyCount, 1);
assert.equal(directPipeline.summary.proofPlanProposedUpdateCount, 1);
assert.equal(directPipeline.summary.proofMetadataWouldApplyOnCloneCount, 1);
assert.equal(directPipeline.summary.proofCloneDryRunAssumesReviewedRuntimeObservations, true);
assert.equal(directPipeline.summary.requiresReviewedRuntimeObservationsForRealProofApply, true);
assert.equal(directPipeline.summary.semanticPromotionReadyAfterCloneProofCount, 1);
assert.equal(directPipeline.summary.realMapMutatedByThisPipeline, false);
assert.equal(directPipeline.summary.semanticDispositionMutatedByThisPipeline, false);
assert.equal(directPipeline.summary.coverageChangedByThisPipeline, false);

const focusedDirectPipeline = buildResidualRuntimeClosurePipelineCatalog(mapData, directObservation, {
  source: 'tmp/local-hook-observations.json',
  regionIds: ['r2813'],
});
assert.equal(focusedDirectPipeline.summary.guardStatus, 'pipeline_ready_for_reviewed_proof_update');
assert.deepEqual(focusedDirectPipeline.summary.regionFilter, ['r2813']);
assert.equal(focusedDirectPipeline.summary.regionFilterApplied, true);
assert.equal(focusedDirectPipeline.summary.targetRegionCount, 1);
assert.equal(focusedDirectPipeline.targetRegions.length, 1);
assert.equal(focusedDirectPipeline.targetRegions[0].id, 'r2813');
assert.equal(focusedDirectPipeline.summary.completePlanCount, 1);
assert.equal(focusedDirectPipeline.summary.incompletePlanCount, 0);
assert.equal(focusedDirectPipeline.summary.confirmationPromotionReadyCount, 1);
assert.equal(focusedDirectPipeline.summary.confirmationPendingCount, 0);
assert.equal(focusedDirectPipeline.confirmationDecisions.length, 1);
assert.equal(focusedDirectPipeline.commands.runPipeline.includes('--region r2813'), true);

const rejectionObservation = {
  schemaVersion: 1,
  eventKind: 'wb3_residual_runtime_trace_observations',
  source: 'synthetic_smoke_rejection_observation',
  observations: [
    { hookId: 'residual_bank7_sidecar_controller_entry', same_frame_trace_id: 'reject', active_bank: 7, controller_phase: 'sequence_controller_entry' },
    { hookId: 'residual_bank7_alias_loader_call', same_frame_trace_id: 'reject', active_bank: 7, loaded_hl_offset: '0x12337', called_loader_label: '_LABEL_8FB_', source_region_id: 'r2721' },
    { hookId: 'residual_bank7_sidecar_direct_watch', same_frame_trace_id: 'reject', active_bank: 7, read_offset: '0x1E337', read_region_id: 'r0749', direct_bank7_consumer: false },
    { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'reject', target_region_id: 'r0749', runtime_trace_kind: 'runtime_alias_rejection_trace', field_or_alias_only_rejected: true },
  ],
};
const rejectionPipeline = buildResidualRuntimeClosurePipelineCatalog(mapData, rejectionObservation, {
  source: 'tmp/local-hook-observations.json',
});
assert.equal(rejectionPipeline.summary.guardStatus, 'pipeline_ready_for_reviewed_proof_update');
assert.equal(rejectionPipeline.summary.inputHasMissingRequiredCaptureFields, false);
assert.equal(rejectionPipeline.summary.confirmationRejectedCount, 1);
assert.equal(rejectionPipeline.summary.proofMetadataWouldApplyOnCloneCount, 1);
assert.equal(rejectionPipeline.summary.runtimeRejectionKeepQuarantinedAfterCloneProofCount, 1);

const forbiddenObservation = {
  observations: [
    { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'bad', overlay_record_index: 227, computed_record_offset: '0x10718', romBytes: [0, 1] },
    { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'bad', loader_source_region_id: 'r2813' },
    { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'bad', target_region_id: 'r2813' },
  ],
};
const forbiddenPipeline = buildResidualRuntimeClosurePipelineCatalog(mapData, forbiddenObservation, {
  source: 'tmp/local-hook-observations.json',
});
assert.equal(forbiddenPipeline.summary.guardStatus, 'blocked_forbidden_payload_keys_present');
assert.equal(forbiddenPipeline.summary.proofMetadataWouldApplyOnCloneCount, 0);

const missingFieldObservation = {
  observations: [
    { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'missing-field', active_bank: 4, overlay_record_index: 227, computed_record_offset: '0x10718' },
    { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'missing-field', active_bank: 4, loader_source_region_id: 'r2813', loader_source_offset: '0x10718' },
    { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'missing-field', target_region_id: 'r2813', runtime_trace_kind: 'runtime_ram_index_bound_trace', direct_consumer_confirmed: true, promotion_ready: true },
  ],
};
const missingFieldPipeline = buildResidualRuntimeClosurePipelineCatalog(mapData, missingFieldObservation, {
  source: 'tmp/local-hook-observations.json',
});
assert.equal(missingFieldPipeline.summary.guardStatus, 'blocked_required_capture_fields_missing');
assert.equal(missingFieldPipeline.summary.requiredFieldIssueCount, 1);
assert.equal(missingFieldPipeline.summary.proofMetadataWouldApplyOnCloneCount, 0);

const incoherentGateObservation = {
  observations: [
    { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'incoherent-gate', active_bank: 4, _RAM_CF64_: 226, overlay_record_index: 226, computed_record_offset: '0x10716' },
    { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'incoherent-gate', active_bank: 4, loader_source_region_id: 'r2800', loader_source_offset: '0x10716' },
    { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'incoherent-gate', target_region_id: 'r2813', runtime_trace_kind: 'runtime_ram_index_bound_trace', direct_consumer_confirmed: true, promotion_ready: true },
  ],
};
const incoherentGatePipeline = buildResidualRuntimeClosurePipelineCatalog(mapData, incoherentGateObservation, {
  source: 'tmp/local-hook-observations.json',
});
assert.equal(incoherentGatePipeline.summary.guardStatus, 'blocked_promotion_gate_coherence_failed');
assert.equal(incoherentGatePipeline.summary.inputHasIncoherentPromotionGates, true);
assert.equal(incoherentGatePipeline.summary.promotionGateCoherenceIssueCount, 1);
assert.equal(incoherentGatePipeline.summary.proofMetadataWouldApplyOnCloneCount, 0);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({
  ok: true,
  waiting: waiting.summary,
  template: templatePipeline.summary,
  copiedTemplate: copiedTemplatePipeline.summary,
  candidateOnly: candidateOnlyPipeline.summary,
  copiedCandidate: copiedCandidatePipeline.summary,
  direct: directPipeline.summary,
  focusedDirect: focusedDirectPipeline.summary,
  rejection: rejectionPipeline.summary,
  forbidden: forbiddenPipeline.summary,
  missingField: missingFieldPipeline.summary,
  incoherentGate: incoherentGatePipeline.summary,
}, null, 2)}\n`);

console.log('residual runtime closure pipeline smoke ok');
