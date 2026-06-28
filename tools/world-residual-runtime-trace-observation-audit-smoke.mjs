#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLocalResidualRuntimeTraceObservationTemplate } from './world-residual-runtime-trace-local-bundle.mjs';
import { buildResidualRuntimeTraceObservationAudit } from './world-residual-runtime-trace-observation-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const tmpDir = path.join(repoRoot, 'tmp');
const outputPath = path.join(tmpDir, 'world-residual-runtime-trace-observation-audit-smoke-output.json');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const template = buildLocalResidualRuntimeTraceObservationTemplate(mapData);
const templateAudit = buildResidualRuntimeTraceObservationAudit(mapData, template, {
  source: 'synthetic_template_observation_audit_smoke',
});
assert.equal(templateAudit.summary.templateOnly, true);
assert.equal(templateAudit.summary.inputUsableAsRuntimeEvidence, false);
assert.equal(templateAudit.summary.observationCount, 16);
assert.equal(templateAudit.summary.completePlanCount, 5);
assert.equal(templateAudit.summary.inputHasUnfilledTemplatePlaceholders, true);
assert.equal(templateAudit.summary.templateTraceIdCount, 16);
assert.equal(templateAudit.summary.unresolvedPlaceholderCount > 16, true);
assert.equal(templateAudit.summary.confirmationPromotionReadyCount, 0);

const copiedTemplate = JSON.parse(JSON.stringify(template));
delete copiedTemplate.templateOnly;
copiedTemplate.eventKind = 'wb3_residual_runtime_trace_observations';
copiedTemplate.source = 'synthetic_copied_unfilled_template_smoke';
const copiedTemplateAudit = buildResidualRuntimeTraceObservationAudit(mapData, copiedTemplate, {
  source: copiedTemplate.source,
});
assert.equal(copiedTemplateAudit.summary.templateOnly, false);
assert.equal(copiedTemplateAudit.summary.completePlanCount, 5);
assert.equal(copiedTemplateAudit.summary.inputHasUnfilledTemplatePlaceholders, true);
assert.equal(copiedTemplateAudit.summary.inputUsableAsRuntimeEvidence, false);
assert.equal(copiedTemplateAudit.summary.templateTraceIdCount, 16);

const cleanObservations = {
  source: 'synthetic_clean_observation_audit_smoke',
  observations: [
    {
      hookId: 'residual_overlay_cf64_index_read',
      same_frame_trace_id: 'audit-smoke-0001',
      active_bank: 4,
      _RAM_CF64_: 227,
      overlay_record_index: 227,
      computed_record_offset: '0x10718',
      computed_record_end_exclusive: '0x1071A',
      _RAM_D0DE_: 0,
    },
    {
      hookId: 'residual_room_overlay_loader_entry',
      same_frame_trace_id: 'audit-smoke-0001',
      active_bank: 4,
      _RAM_CF5E_: 0,
      _RAM_D0FE_: 0,
      loader_source_region_id: 'r2813',
      loader_source_offset: '0x10718',
    },
    {
      kind: 'promotion_gate',
      regionId: 'r2813',
      same_frame_trace_id: 'audit-smoke-0001',
      target_region_id: 'r2813',
      runtime_trace_kind: 'runtime_ram_index_bound_trace',
      direct_consumer_confirmed: true,
      promotion_ready: true,
    },
  ],
};
const cleanAudit = buildResidualRuntimeTraceObservationAudit(mapData, cleanObservations, {
  source: cleanObservations.source,
});
writeJson(outputPath, cleanAudit);
assert.equal(cleanAudit.summary.templateOnly, false);
assert.equal(cleanAudit.summary.inputUsableAsRuntimeEvidence, true);
assert.equal(cleanAudit.summary.completePlanCount, 1);
assert.equal(cleanAudit.summary.inputHasMissingRequiredCaptureFields, false);
assert.equal(cleanAudit.summary.requiredFieldIssueCount, 0);
assert.equal(cleanAudit.summary.inputHasIncoherentPromotionGates, false);
assert.equal(cleanAudit.summary.promotionGateCoherenceIssueCount, 0);
assert.equal(cleanAudit.summary.confirmationPromotionReadyCount, 1);
assert.equal(cleanAudit.summary.forbiddenPayloadKeyCount, 0);
assert.equal(cleanAudit.planCompleteness.find(item => item.regionId === 'r2813').completeObservationGroupCount, 1);

const focusedCleanAudit = buildResidualRuntimeTraceObservationAudit(mapData, cleanObservations, {
  source: cleanObservations.source,
  regionIds: ['r2813'],
});
assert.deepEqual(focusedCleanAudit.summary.regionFilter, ['r2813']);
assert.equal(focusedCleanAudit.summary.regionFilterApplied, true);
assert.equal(focusedCleanAudit.summary.tracePlanCount, 1);
assert.equal(focusedCleanAudit.summary.manifestTracePlanCount, 5);
assert.equal(focusedCleanAudit.summary.completePlanCount, 1);
assert.equal(focusedCleanAudit.summary.incompletePlanCount, 0);
assert.equal(focusedCleanAudit.summary.inputUsableAsRuntimeEvidence, true);
assert.equal(focusedCleanAudit.summary.sourceObservationCount, 3);
assert.equal(focusedCleanAudit.summary.focusedObservationFilterDroppedCount, 0);
assert.deepEqual(focusedCleanAudit.summary.selectedTraceIds, ['audit-smoke-0001']);
assert.equal(focusedCleanAudit.summary.confirmationDecisionCount, 1);
assert.equal(focusedCleanAudit.summary.confirmationPromotionReadyCount, 1);
assert.equal(focusedCleanAudit.summary.confirmationPendingCount, 0);
assert.equal(focusedCleanAudit.planCompleteness.length, 1);
assert.equal(focusedCleanAudit.planCompleteness[0].regionId, 'r2813');

const wrongFocusedCleanAudit = buildResidualRuntimeTraceObservationAudit(mapData, cleanObservations, {
  source: cleanObservations.source,
  regionIds: ['r0749'],
});
assert.deepEqual(wrongFocusedCleanAudit.summary.regionFilter, ['r0749']);
assert.equal(wrongFocusedCleanAudit.summary.tracePlanCount, 1);
assert.equal(wrongFocusedCleanAudit.summary.completePlanCount, 0);
assert.equal(wrongFocusedCleanAudit.summary.inputUsableAsRuntimeEvidence, false);
assert.equal(wrongFocusedCleanAudit.summary.sourceObservationCount, 3);
assert.equal(wrongFocusedCleanAudit.summary.observationCount, 0);
assert.equal(wrongFocusedCleanAudit.summary.focusedObservationFilterDroppedCount, 3);
assert.deepEqual(wrongFocusedCleanAudit.summary.selectedTraceIds, []);
assert.equal(wrongFocusedCleanAudit.summary.confirmationDecisionCount, 1);
assert.equal(wrongFocusedCleanAudit.summary.confirmationPromotionReadyCount, 0);
assert.equal(wrongFocusedCleanAudit.summary.confirmationPendingCount, 1);

const missingFieldAudit = buildResidualRuntimeTraceObservationAudit(mapData, {
  source: 'synthetic_missing_required_field_observation_audit_smoke',
  observations: [
    {
      hookId: 'residual_overlay_cf64_index_read',
      same_frame_trace_id: 'audit-smoke-missing-field',
      active_bank: 4,
      overlay_record_index: 227,
      computed_record_offset: '0x10718',
    },
    {
      hookId: 'residual_room_overlay_loader_entry',
      same_frame_trace_id: 'audit-smoke-missing-field',
      active_bank: 4,
      loader_source_region_id: 'r2813',
      loader_source_offset: '0x10718',
    },
    {
      kind: 'promotion_gate',
      regionId: 'r2813',
      same_frame_trace_id: 'audit-smoke-missing-field',
      target_region_id: 'r2813',
      runtime_trace_kind: 'runtime_ram_index_bound_trace',
      direct_consumer_confirmed: true,
      promotion_ready: true,
    },
  ],
}, {
  source: 'synthetic_missing_required_field_observation_audit_smoke',
});
assert.equal(missingFieldAudit.summary.completePlanCount, 1);
assert.equal(missingFieldAudit.summary.inputHasMissingRequiredCaptureFields, true);
assert.equal(missingFieldAudit.summary.inputUsableAsRuntimeEvidence, false);
assert.equal(missingFieldAudit.summary.missingRequiredFieldCount, 1);
assert.equal(missingFieldAudit.requiredFieldIssues[0].field, '_RAM_CF64_');

const incoherentGateAudit = buildResidualRuntimeTraceObservationAudit(mapData, {
  source: 'synthetic_incoherent_promotion_gate_observation_audit_smoke',
  observations: [
    {
      hookId: 'residual_overlay_cf64_index_read',
      same_frame_trace_id: 'audit-smoke-incoherent-gate',
      active_bank: 4,
      _RAM_CF64_: 226,
      overlay_record_index: 226,
      computed_record_offset: '0x10716',
    },
    {
      hookId: 'residual_room_overlay_loader_entry',
      same_frame_trace_id: 'audit-smoke-incoherent-gate',
      active_bank: 4,
      loader_source_region_id: 'r2800',
      loader_source_offset: '0x10716',
    },
    {
      kind: 'promotion_gate',
      regionId: 'r2813',
      same_frame_trace_id: 'audit-smoke-incoherent-gate',
      target_region_id: 'r2813',
      runtime_trace_kind: 'runtime_ram_index_bound_trace',
      direct_consumer_confirmed: true,
      promotion_ready: true,
    },
  ],
}, {
  source: 'synthetic_incoherent_promotion_gate_observation_audit_smoke',
});
assert.equal(incoherentGateAudit.summary.completePlanCount, 1);
assert.equal(incoherentGateAudit.summary.inputHasMissingRequiredCaptureFields, false);
assert.equal(incoherentGateAudit.summary.inputHasIncoherentPromotionGates, true);
assert.equal(incoherentGateAudit.summary.inputUsableAsRuntimeEvidence, false);
assert.equal(incoherentGateAudit.summary.unsupportedDirectConsumerPromotionGateCount, 1);
assert.equal(incoherentGateAudit.promotionGateCoherenceIssues[0].kind, 'unsupported_direct_consumer_promotion_gate');

const forbiddenAudit = buildResidualRuntimeTraceObservationAudit(mapData, {
  source: 'synthetic_forbidden_observation_audit_smoke',
  observations: [
    {
      hookId: 'residual_overlay_cf64_index_read',
      same_frame_trace_id: 'audit-smoke-0002',
      active_bank: 4,
      romBytes: [0, 1],
    },
  ],
}, {
  source: 'synthetic_forbidden_observation_audit_smoke',
});
assert.equal(forbiddenAudit.summary.inputUsableAsRuntimeEvidence, false);
assert.equal(forbiddenAudit.summary.forbiddenPayloadKeyCount, 1);
assert.equal(forbiddenAudit.summary.bundleEventCount, 0);

console.log('residual runtime trace observation audit smoke ok');
