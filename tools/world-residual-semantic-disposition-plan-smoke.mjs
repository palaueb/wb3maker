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
import {
  applyResidualSemanticDispositionPlanCatalog,
  buildResidualSemanticDispositionPlanCatalog,
} from './world-residual-semantic-disposition-plan-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const outputPath = path.join(repoRoot, 'tmp/world-residual-semantic-disposition-plan-smoke-output.json');

function readMap() {
  return JSON.parse(fs.readFileSync(mapPath, 'utf8'));
}

const mapData = readMap();

const baseline = buildResidualSemanticDispositionPlanCatalog(mapData);
assert.equal(baseline.summary.residualCount, 5);
assert.equal(baseline.summary.semanticPromotionReadyCount, 0);
assert.equal(baseline.summary.pendingRuntimeProofMetadataCount, 5);
assert.equal(baseline.summary.topLevelTypeMutationAllowedByThisTool, false);
assert.equal(baseline.summary.topLevelConfidenceMutationAllowedByThisTool, false);

const directClone = JSON.parse(JSON.stringify(mapData));
const directProof = buildProofUpdatePlanCatalog(directClone, {
  source: 'tmp/world-residual-runtime-trace-events.local.json',
  sourceKind: 'metadata_event_bundle',
  reviewedRuntimeObservations: true,
  events: {
    eventKind: 'wb3_residual_runtime_trace_events',
    source: 'semantic_smoke_direct_bundle',
    events: [
      { hookId: 'residual_overlay_cf64_index_read', same_frame_trace_id: 'direct', active_bank: 4, _RAM_CF64_: 227, overlay_record_index: 227, computed_record_offset: '0x10718' },
      { hookId: 'residual_room_overlay_loader_entry', same_frame_trace_id: 'direct', active_bank: 4, loader_source_region_id: 'r2813', loader_source_offset: '0x10718' },
      { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'direct', target_region_id: 'r2813', runtime_trace_kind: 'runtime_ram_index_bound_trace', direct_consumer_confirmed: true, promotion_ready: true },
    ],
  },
});
assert.equal(directProof.summary.eventSourceUsableAsRuntimeEvidence, true);
assert.equal(directProof.summary.applyCatalogIntegrityOk, true);
applyProofUpdatePlanCatalog(directClone, directProof);
const directCatalog = buildResidualSemanticDispositionPlanCatalog(directClone);
assert.equal(directCatalog.summary.semanticPromotionReadyCount, 1);
assert.equal(directCatalog.summary.pendingRuntimeProofMetadataCount, 4);
const directEntry = directCatalog.entries.find(entry => entry.region.id === 'r2813');
assert.equal(directEntry.status, 'runtime_direct_consumer_confirmed_semantic_review_required');
assert.equal(directEntry.topLevelTypeMutationAllowedByThisTool, false);
assert.equal(directEntry.topLevelConfidenceMutationAllowedByThisTool, false);
const beforeType = directClone.regions.find(region => region.id === 'r2813').type;
const beforeConfidence = directClone.regions.find(region => region.id === 'r2813').confidence;
applyResidualSemanticDispositionPlanCatalog(directClone, directCatalog);
const afterDirectRegion = directClone.regions.find(region => region.id === 'r2813');
assert.equal(afterDirectRegion.type, beforeType);
assert.equal(afterDirectRegion.confidence, beforeConfidence);
assert.equal(afterDirectRegion.analysis.residualSemanticDispositionPlanAudit.semanticPromotionReady, true);
assert.equal(afterDirectRegion.analysis.residualSemanticDispositionPlanAudit.semanticDispositionMutatedByThisTool, false);
assert.equal(afterDirectRegion.analysis.residualSemanticDispositionPlanAudit.coverageChangedByThisTool, false);

const rejectedClone = JSON.parse(JSON.stringify(mapData));
const rejectedProof = buildProofUpdatePlanCatalog(rejectedClone, {
  source: 'tmp/world-residual-runtime-trace-events.local.json',
  sourceKind: 'metadata_event_bundle',
  reviewedRuntimeObservations: true,
  events: {
    eventKind: 'wb3_residual_runtime_trace_events',
    source: 'semantic_smoke_rejection_bundle',
    events: [
      { hookId: 'residual_bank7_sidecar_controller_entry', same_frame_trace_id: 'reject', active_bank: 7, controller_phase: 'sequence_controller_entry' },
      { hookId: 'residual_bank7_alias_loader_call', same_frame_trace_id: 'reject', active_bank: 7, loaded_hl_offset: '0x12337', called_loader_label: '_LABEL_8FB_', source_region_id: 'r2721' },
      { hookId: 'residual_bank7_sidecar_direct_watch', same_frame_trace_id: 'reject', active_bank: 7, read_offset: '0x1E337', read_region_id: 'r0749', direct_bank7_consumer: false },
      { hookId: 'residual_runtime_promotion_gate', same_frame_trace_id: 'reject', target_region_id: 'r0749', runtime_trace_kind: 'runtime_alias_rejection_trace', field_or_alias_only_rejected: true },
    ],
  },
});
assert.equal(rejectedProof.summary.eventSourceUsableAsRuntimeEvidence, true);
assert.equal(rejectedProof.summary.applyCatalogIntegrityOk, true);
applyProofUpdatePlanCatalog(rejectedClone, rejectedProof);
const rejectedCatalog = buildResidualSemanticDispositionPlanCatalog(rejectedClone);
assert.equal(rejectedCatalog.summary.runtimeRejectionKeepQuarantinedCount, 1);
const rejectedEntry = rejectedCatalog.entries.find(entry => entry.region.id === 'r0749');
assert.equal(rejectedEntry.status, 'runtime_rejection_keep_quarantined');
assert.equal(rejectedEntry.keepQuarantined, true);
assert.equal(rejectedEntry.semanticPromotionReady, false);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({
  ok: true,
  baseline: baseline.summary,
  direct: directCatalog.summary,
  rejected: rejectedCatalog.summary,
}, null, 2)}\n`);

console.log('residual semantic disposition plan smoke ok');
