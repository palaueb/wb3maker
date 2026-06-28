#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLocalResidualRuntimeTraceBundle,
  buildLocalResidualRuntimeTraceObservationTemplate,
  buildLocalResidualRuntimeTraceObservationTemplatePack,
  writeLocalResidualRuntimeTraceObservationTemplatePack,
} from './world-residual-runtime-trace-local-bundle.mjs';
import { buildCatalog as buildConfirmationCatalog } from './world-residual-runtime-trace-confirmation-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const tmpDir = path.join(repoRoot, 'tmp');
const outputPath = path.join(tmpDir, 'world-residual-runtime-trace-local-bundle-smoke-output.json');
const templatePath = path.join(tmpDir, 'local-hook-observations.template.json');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const template = buildLocalResidualRuntimeTraceObservationTemplate(mapData);
writeJson(templatePath, template);
assert.equal(template.templateOnly, true);
assert.equal(template.summary.tracePlanCount, 5);
assert.deepEqual(template.summary.regionFilter, []);
assert.equal(template.summary.observationCount, 16);
assert.equal(template.observations.some(item => item.hookId === 'residual_runtime_promotion_gate'), true);
assert.equal(template.observations.some(item => Object.prototype.hasOwnProperty.call(item, 'romBytes')), false);
assert.throws(
  () => buildLocalResidualRuntimeTraceBundle(mapData, template),
  /Observation template input is not runtime evidence/
);
assert.throws(
  () => buildLocalResidualRuntimeTraceBundle(mapData, template, {
    allowTemplateInput: true,
    reviewedRuntimeObservations: true,
  }),
  /Observation templates cannot be marked as reviewed runtime evidence/
);

const r2813Template = buildLocalResidualRuntimeTraceObservationTemplate(mapData, {
  regionIds: ['r2813'],
  tracePrefix: 'residual-r2813-template',
});
assert.equal(r2813Template.summary.tracePlanCount, 1);
assert.equal(r2813Template.summary.manifestTracePlanCount, 5);
assert.deepEqual(r2813Template.summary.regionFilter, ['r2813']);
assert.deepEqual(r2813Template.summary.missingRegionIds, []);
assert.equal(r2813Template.traceGroups.length, 1);
assert.equal(r2813Template.traceGroups[0].regionId, 'r2813');
assert.equal(r2813Template.observations.length, 3);
assert.equal(r2813Template.observations.every(item => item.same_frame_trace_id === 'residual-r2813-template-0001'), true);
assert.throws(
  () => buildLocalResidualRuntimeTraceObservationTemplate(mapData, { regionIds: ['r0000'] }),
  /No residual runtime trace plans matched requested region filter/
);

const pack = buildLocalResidualRuntimeTraceObservationTemplatePack(mapData, {
  regionIds: ['r2813', 'r0749'],
  outputDir: 'tmp/local-hook-observations.templates-smoke',
});
assert.equal(pack.templateOnly, true);
assert.equal(pack.summary.templateCount, 2);
assert.equal(pack.summary.tracePlanCount, 2);
assert.equal(pack.summary.manifestTracePlanCount, 5);
assert.deepEqual(pack.summary.regionFilter, ['r0749', 'r2813']);
assert.deepEqual(pack.summary.missingRegionIds, []);
assert.equal(pack.summary.observationCount, 7);
assert.equal(pack.summary.defaultFilledObservationPath, 'tmp/local-hook-observations.json');
assert.equal(pack.summary.defaultObservationAuditOutputPath, 'tmp/world-residual-runtime-trace-observation-audit.local.json');
assert.equal(pack.summary.defaultBundleOutputPath, 'tmp/world-residual-runtime-trace-events.local.json');
assert.equal(pack.commands.auditCommand, 'node tools/world-residual-runtime-trace-observation-audit.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-trace-observation-audit.local.json');
assert.equal(pack.commands.bundleCommand, 'node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-trace-events.local.json');
assert.equal(pack.commands.reviewedBundleCommand, 'node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --reviewed-runtime-observations --out tmp/world-residual-runtime-trace-events.local.json');
assert.equal(pack.commands.confirmationCommand, 'node tools/world-residual-runtime-trace-confirmation-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json');
assert.equal(pack.templates.length, 2);
assert.equal(pack.templateFiles.length, 2);
assert.equal(pack.templates.some(item => item.regionId === 'r2813' && item.outputPath === 'tmp/local-hook-observations.templates-smoke/r2813.template.json'), true);
assert.equal(pack.templates.some(item => item.regionId === 'r0749' && item.outputPath === 'tmp/local-hook-observations.templates-smoke/r0749.template.json'), true);
assert.equal(pack.templates.every(item => item.command.startsWith('node tools/world-residual-runtime-trace-local-bundle.mjs --template --region ')), true);
assert.equal(pack.templates.every(item => item.filledObservationPath === 'tmp/local-hook-observations.json'), true);
assert.equal(pack.templates.every(item => item.auditCommand === pack.commands.auditCommand), true);
assert.equal(pack.templates.every(item => item.bundleCommand === pack.commands.bundleCommand), true);
assert.equal(pack.templates.every(item => item.reviewedBundleCommand === pack.commands.reviewedBundleCommand), true);
assert.equal(pack.templates.every(item => item.confirmationCommand === pack.commands.confirmationCommand), true);
assert.equal(JSON.stringify(pack).includes('romBytes'), false);
const writtenPackFiles = writeLocalResidualRuntimeTraceObservationTemplatePack(repoRoot, pack);
assert.deepEqual(writtenPackFiles.sort(), [
  'tmp/local-hook-observations.templates-smoke/index.json',
  'tmp/local-hook-observations.templates-smoke/r0749.template.json',
  'tmp/local-hook-observations.templates-smoke/r2813.template.json',
]);
const packIndex = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tmp/local-hook-observations.templates-smoke/index.json'), 'utf8'));
assert.equal(packIndex.summary.templateCount, 2);
assert.equal(packIndex.summary.defaultFilledObservationPath, 'tmp/local-hook-observations.json');
assert.equal(packIndex.commands.confirmationCommand, 'node tools/world-residual-runtime-trace-confirmation-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json');
assert.equal(Object.prototype.hasOwnProperty.call(packIndex, 'templateFiles'), false);
const packTemplate = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tmp/local-hook-observations.templates-smoke/r2813.template.json'), 'utf8'));
assert.equal(packTemplate.templateOnly, true);
assert.deepEqual(packTemplate.summary.regionFilter, ['r2813']);
assert.equal(packTemplate.observations.some(item => Object.prototype.hasOwnProperty.call(item, 'romBytes')), false);

const input = {
  source: 'synthetic_local_bundle_smoke',
  observations: [
    {
      hookId: 'residual_overlay_cf64_index_read',
      same_frame_trace_id: 'local-smoke-0001',
      active_bank: 4,
      _RAM_CF64_: 227,
      overlay_record_index: 227,
      computed_record_offset: '$10718',
      computed_record_end_exclusive: 0x1071a,
    },
    {
      hookId: 'residual_room_overlay_loader_entry',
      same_frame_trace_id: 'local-smoke-0001',
      active_bank: 4,
      loader_source_region_id: 'r2813',
      loader_source_offset: '0x10718',
    },
    {
      kind: 'promotion_gate',
      regionId: 'r2813',
      same_frame_trace_id: 'local-smoke-0001',
      runtime_trace_kind: 'runtime_ram_index_bound_trace',
      direct_consumer_confirmed: true,
      promotion_ready: true,
    },
  ],
};

const forbiddenInput = {
  source: 'synthetic_local_bundle_forbidden_smoke',
  observations: [
    {
      hookId: 'residual_overlay_cf64_index_read',
      same_frame_trace_id: 'local-smoke-forbidden',
      active_bank: 4,
      _RAM_CF64_: 227,
      overlay_record_index: 227,
      computed_record_offset: '$10718',
      romBytes: 'forbidden-test-payload',
    },
  ],
};
assert.throws(
  () => buildLocalResidualRuntimeTraceBundle(mapData, forbiddenInput, {
    source: forbiddenInput.source,
    tracePrefix: 'local-smoke',
  }),
  /Forbidden residual trace payload keys/
);

const built = buildLocalResidualRuntimeTraceBundle(mapData, input, {
  source: input.source,
  tracePrefix: 'local-smoke',
});
writeJson(outputPath, built.bundle);

assert.equal(built.manifest.readyForCleanRuntimeBridge, true);
assert.equal(built.bundle.events.length, 3);
assert.equal(built.bundle.observationCount, 3);
assert.equal(built.bundle.emittedEventCount, 3);
assert.equal(built.bundle.reviewedRuntimeObservations, false);
assert.equal(built.bundle.reviewStatus, 'unreviewed_runtime_observations');
assert.deepEqual(built.bundle.regionFilter, []);
assert.deepEqual(built.bundle.regionIds, []);
assert.equal(built.bundle.regionFilterApplied, false);
assert.equal(built.bundle.validationIssueCount, 0);
assert.equal(built.bundle.droppedFieldCount, 0);
assert.equal(Object.prototype.hasOwnProperty.call(built.bundle.events[0], 'romBytes'), false);
assert.equal(built.bundle.events[0].computed_record_offset, '0x10718');

const confirmation = buildConfirmationCatalog(mapData, {
  events: built.bundle,
  source: path.relative(repoRoot, outputPath),
});
assert.equal(confirmation.summary.decisionCounts.confirmed_direct_consumer_ready_for_residual_update, 1);
assert.equal(confirmation.summary.promotionReadyCount, 1);
assert.equal(confirmation.summary.forbiddenPayloadKeyCount, 0);

const focusedBuilt = buildLocalResidualRuntimeTraceBundle(mapData, input, {
  source: input.source,
  tracePrefix: 'local-smoke-focused',
  regionIds: ['r2813'],
});
assert.deepEqual(focusedBuilt.bundle.regionFilter, ['r2813']);
assert.deepEqual(focusedBuilt.bundle.regionIds, ['r2813']);
assert.equal(focusedBuilt.bundle.regionFilterApplied, true);
assert.equal(focusedBuilt.bundle.sourceObservationCount, 3);
assert.equal(focusedBuilt.bundle.focusedObservationFilterDroppedCount, 0);
assert.deepEqual(focusedBuilt.bundle.selectedTraceIds, ['local-smoke-0001']);
const focusedConfirmation = buildConfirmationCatalog(mapData, focusedBuilt.bundle);
assert.deepEqual(focusedConfirmation.summary.regionFilter, ['r2813']);
assert.equal(focusedConfirmation.summary.regionFilterApplied, true);
assert.equal(focusedConfirmation.summary.evaluatedTracePlanCount, 1);
assert.equal(focusedConfirmation.summary.promotionReadyCount, 1);
assert.equal(focusedConfirmation.summary.pendingInsufficientCount, 0);

const wrongFocusedBuilt = buildLocalResidualRuntimeTraceBundle(mapData, input, {
  source: input.source,
  tracePrefix: 'local-smoke-focused-wrong',
  regionIds: ['r0749'],
});
assert.deepEqual(wrongFocusedBuilt.bundle.regionFilter, ['r0749']);
const wrongFocusedConfirmation = buildConfirmationCatalog(mapData, wrongFocusedBuilt.bundle);
assert.deepEqual(wrongFocusedConfirmation.summary.regionFilter, ['r0749']);
assert.equal(wrongFocusedConfirmation.summary.evaluatedTracePlanCount, 1);
assert.equal(wrongFocusedConfirmation.summary.promotionReadyCount, 0);
assert.equal(wrongFocusedConfirmation.summary.pendingInsufficientCount, 1);

const r0749Trace = {
  source: 'synthetic_local_bundle_mixed_smoke',
  observations: [
    ...input.observations,
    {
      hookId: 'residual_bank7_sidecar_controller_entry',
      same_frame_trace_id: 'local-smoke-0002',
      active_bank: 7,
      _RAM_CF8A_: 1,
      _RAM_CF8B_: 0,
      controller_phase: 'setup',
    },
    {
      hookId: 'residual_bank7_alias_loader_call',
      same_frame_trace_id: 'local-smoke-0002',
      active_bank: 7,
      loaded_hl_offset: '0x12337',
      called_loader_label: '_LABEL_8FB_',
      source_region_id: 'r1907',
    },
    {
      hookId: 'residual_bank7_sidecar_direct_watch',
      same_frame_trace_id: 'local-smoke-0002',
      active_bank: 7,
      read_offset: '0x1E337',
      read_region_id: 'r0749',
      direct_bank7_consumer: false,
    },
    {
      kind: 'promotion_gate',
      regionId: 'r0749',
      same_frame_trace_id: 'local-smoke-0002',
      target_region_id: 'r0749',
      runtime_trace_kind: 'bank7_sidecar_direct_consumer_trace',
      field_or_alias_only_rejected: true,
    },
  ],
};

const mixedFocusedR2813 = buildLocalResidualRuntimeTraceBundle(mapData, r0749Trace, {
  source: r0749Trace.source,
  tracePrefix: 'local-smoke-mixed-r2813',
  regionIds: ['r2813'],
});
assert.equal(mixedFocusedR2813.bundle.sourceObservationCount, 7);
assert.equal(mixedFocusedR2813.bundle.observationCount, 3);
assert.equal(mixedFocusedR2813.bundle.events.length, 3);
assert.equal(mixedFocusedR2813.bundle.focusedObservationFilterDroppedCount, 4);
assert.deepEqual(mixedFocusedR2813.bundle.selectedTraceIds, ['local-smoke-0001']);
assert.equal(mixedFocusedR2813.bundle.events.every(event => event.same_frame_trace_id === 'local-smoke-0001'), true);

const mixedFocusedR0749 = buildLocalResidualRuntimeTraceBundle(mapData, r0749Trace, {
  source: r0749Trace.source,
  tracePrefix: 'local-smoke-mixed-r0749',
  regionIds: ['r0749'],
});
assert.equal(mixedFocusedR0749.bundle.sourceObservationCount, 7);
assert.equal(mixedFocusedR0749.bundle.observationCount, 4);
assert.equal(mixedFocusedR0749.bundle.events.length, 4);
assert.equal(mixedFocusedR0749.bundle.focusedObservationFilterDroppedCount, 3);
assert.deepEqual(mixedFocusedR0749.bundle.selectedTraceIds, ['local-smoke-0002']);
assert.equal(mixedFocusedR0749.bundle.events.every(event => event.same_frame_trace_id === 'local-smoke-0002'), true);
const mixedFocusedR0749Confirmation = buildConfirmationCatalog(mapData, mixedFocusedR0749.bundle);
assert.equal(mixedFocusedR0749Confirmation.summary.fieldOrAliasOnlyRejectedCount, 1);
assert.equal(mixedFocusedR0749Confirmation.summary.promotionReadyCount, 0);

const reviewedBuilt = buildLocalResidualRuntimeTraceBundle(mapData, input, {
  source: input.source,
  tracePrefix: 'local-smoke-reviewed',
  reviewedRuntimeObservations: true,
});
assert.equal(reviewedBuilt.bundle.reviewedRuntimeObservations, true);
assert.equal(reviewedBuilt.bundle.reviewStatus, 'reviewed_runtime_observations');
assert.equal(reviewedBuilt.bundle.reviewedObservationGateSummary.reviewedObservationGateReady, true);
assert.equal(reviewedBuilt.bundle.reviewedObservationGateSummary.completePlanCount, 1);
assert.equal(reviewedBuilt.bundle.events.length, 3);
assert.equal(Object.prototype.hasOwnProperty.call(reviewedBuilt.bundle.events[0], 'romBytes'), false);

const missingRequiredReviewedInput = JSON.parse(JSON.stringify(input));
delete missingRequiredReviewedInput.observations[0]._RAM_CF64_;
assert.throws(
  () => buildLocalResidualRuntimeTraceBundle(mapData, missingRequiredReviewedInput, {
    source: missingRequiredReviewedInput.source,
    tracePrefix: 'local-smoke-reviewed-missing',
    reviewedRuntimeObservations: true,
  }),
  /Reviewed residual trace bundle requires clean observation input/
);

const unsupportedFieldReviewedInput = JSON.parse(JSON.stringify(input));
unsupportedFieldReviewedInput.observations[0].debugNote = 'not allowed in reviewed bundle';
assert.throws(
  () => buildLocalResidualRuntimeTraceBundle(mapData, unsupportedFieldReviewedInput, {
    source: unsupportedFieldReviewedInput.source,
    tracePrefix: 'local-smoke-reviewed-unsupported',
    reviewedRuntimeObservations: true,
  }),
  /Reviewed residual trace bundle requires clean observation input/
);

console.log('residual runtime trace local bundle smoke ok');
