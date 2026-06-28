#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildResidualRuntimeTraceHookManifest } from '../shared/wb3/residual-runtime-trace-hooks.js';
import {
  buildResidualRuntimeObservationReviewGate,
  filterResidualRuntimeObservationsForRegions,
} from '../shared/wb3/residual-runtime-observation-review.js';
import { collectForbiddenTracePayloadKeys } from '../shared/wb3/residual-runtime-trace-events.js';
import { buildLocalResidualRuntimeTraceBundle } from './world-residual-runtime-trace-local-bundle.mjs';
import { buildCatalog as buildConfirmationCatalog } from './world-residual-runtime-trace-confirmation-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const defaultInputPath = path.join(repoRoot, 'tmp/local-hook-observations.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-residual-runtime-trace-observation-audit.local.json');
const eventContractCatalogId = 'world-residual-runtime-trace-event-contract-catalog-2026-06-26';
const toolName = 'tools/world-residual-runtime-trace-observation-audit.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function normalizeRegionFilters(values) {
  return uniqueSorted((values || [])
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim())
    .filter(Boolean));
}

function scopedPlanCompleteness(planCompleteness, regionIds) {
  const filters = normalizeRegionFilters(regionIds);
  if (!filters.length) return planCompleteness || [];
  const filterSet = new Set(filters);
  return (planCompleteness || []).filter(item => filterSet.has(item.regionId));
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

function observationsFromInput(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  return input.observations || input.hooks || input.events || [];
}

function isTemplateInput(input) {
  return Boolean(input?.templateOnly || input?.eventKind === 'wb3_residual_runtime_trace_observation_template');
}

function isCandidateInput(input) {
  return Boolean(input?.candidateOnly || input?.eventKind === 'wb3_gearsystem_mcp_observation_candidates');
}

export function buildResidualRuntimeTraceObservationAudit(mapData, input, options = {}) {
  const eventContract = requireCatalog(mapData, eventContractCatalogId);
  const manifest = buildResidualRuntimeTraceHookManifest(eventContract);
  const templateOnly = isTemplateInput(input);
  const candidateOnly = isCandidateInput(input);
  const sourceObservations = observationsFromInput(input);
  const regionFilter = normalizeRegionFilters(options.regionIds || []);
  const focusedObservationFilter = filterResidualRuntimeObservationsForRegions(manifest, sourceObservations, regionFilter);
  const observations = focusedObservationFilter.observations;
  const reviewGate = buildResidualRuntimeObservationReviewGate(manifest, observations);
  const forbiddenPayloadKeys = collectForbiddenTracePayloadKeys(sourceObservations);
  const placeholderAudit = reviewGate.placeholderAudit;
  const requiredFieldAudit = reviewGate.requiredFieldAudit;
  const traceGroups = reviewGate.traceGroups;
  const planCompleteness = scopedPlanCompleteness(reviewGate.planCompleteness, regionFilter);
  const promotionGateCoherenceAudit = reviewGate.promotionGateCoherenceAudit;
  const completePlanCount = planCompleteness.filter(item => item.completeObservationGroupCount > 0).length;
  const tracePlanCount = planCompleteness.length;
  const inputHasUnfilledTemplatePlaceholders = placeholderAudit.unresolvedPlaceholderCount > 0;
  const inputHasGeneratedCandidateTraceIds = (reviewGate.generatedCandidateTraceIdIssues || []).length > 0;
  const inputHasMissingRequiredCaptureFields = requiredFieldAudit.issues.length > 0;
  const inputHasIncoherentPromotionGates = promotionGateCoherenceAudit.issues.length > 0;
  const inputHasUnknownHooks = reviewGate.unknownHookIssues.length > 0;
  const inputHasUnsupportedReviewFields = reviewGate.unsupportedFieldIssues.length > 0;
  const inputPotentiallyUsableAsRuntimeEvidence = !templateOnly &&
    !candidateOnly &&
    reviewGate.ok &&
    forbiddenPayloadKeys.length === 0 &&
    focusedObservationFilter.missingRegionIds.length === 0 &&
    completePlanCount > 0;

  let bundleSummary = null;
  let confirmationSummary = null;
  let decisions = [];
  let bundleError = null;
  if (candidateOnly) {
    bundleError = 'candidate_only_input_not_runtime_evidence';
  } else if (!templateOnly && forbiddenPayloadKeys.length === 0) {
    try {
      const built = buildLocalResidualRuntimeTraceBundle(mapData, input, {
        source: options.source || 'local_observation_audit',
      });
      bundleSummary = {
        eventCount: built.bundle.events.length,
        observationCount: built.bundle.observationCount,
        emittedEventCount: built.bundle.emittedEventCount,
        validationIssueCount: built.bundle.validationIssueCount,
        droppedFieldCount: built.bundle.droppedFieldCount,
        unknownHookCount: built.bundle.unknownHookCount,
      };
      const confirmation = buildConfirmationCatalog(mapData, {
        events: built.bundle,
        source: options.source || 'local_observation_audit',
        regionIds: regionFilter,
      });
      confirmationSummary = confirmation.summary;
      decisions = confirmation.decisions || [];
    } catch (error) {
      bundleError = error.message;
    }
  }

  return {
    schemaVersion: 1,
    eventKind: 'wb3_residual_runtime_trace_observation_audit',
    generatedBy: toolName,
    source: options.source || 'local_observation_audit',
    assetPolicy: 'Metadata-only local observation audit. It stores hook ids, trace ids, region ids, plan ids, counts, booleans, missing-hook names, decisions, and policy flags only. No ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      templateOnly,
      candidateOnly,
      inputHasCandidateOnlyEvidence: candidateOnly,
      inputUsableAsRuntimeEvidence: inputPotentiallyUsableAsRuntimeEvidence && !bundleError,
      observationCount: observations.length,
      sourceObservationCount: focusedObservationFilter.sourceObservationCount,
      focusedObservationFilterDroppedCount: focusedObservationFilter.droppedObservationCount,
      selectedTraceIds: focusedObservationFilter.selectedTraceIds,
      missingRegionIds: focusedObservationFilter.missingRegionIds,
      traceGroupCount: traceGroups.length,
      tracePlanCount,
      manifestTracePlanCount: manifest.tracePlanCount,
      regionFilter,
      regionFilterApplied: regionFilter.length > 0,
      completePlanCount,
      incompletePlanCount: tracePlanCount - completePlanCount,
      forbiddenPayloadKeyCount: forbiddenPayloadKeys.length,
      inputHasUnknownHooks,
      unknownHookIssueCount: reviewGate.unknownHookIssues.length,
      inputHasUnsupportedReviewFields,
      unsupportedReviewFieldIssueCount: reviewGate.unsupportedFieldIssues.length,
      inputHasUnfilledTemplatePlaceholders,
      inputHasGeneratedCandidateTraceIds,
      unresolvedPlaceholderCount: placeholderAudit.unresolvedPlaceholderCount,
      nullPlaceholderFieldCount: placeholderAudit.placeholderFields.length,
      templateTraceIdCount: placeholderAudit.templateTraceIds.length,
      generatedCandidateTraceIdCount: placeholderAudit.generatedCandidateTraceIds?.length || 0,
      placeholderObservationCount: placeholderAudit.placeholderObservationIndexes.length,
      inputHasMissingRequiredCaptureFields,
      requiredFieldIssueCount: requiredFieldAudit.issues.length,
      missingRequiredFieldCount: requiredFieldAudit.missingRequiredFieldCount,
      missingRequiredTrueFieldGroupCount: requiredFieldAudit.missingRequiredTrueFieldGroupCount,
      fieldCompleteObservationCount: requiredFieldAudit.completeObservationIndexes.length,
      fieldIncompleteObservationCount: requiredFieldAudit.incompleteObservationIndexes.length,
      inputHasIncoherentPromotionGates,
      promotionGateCoherenceIssueCount: promotionGateCoherenceAudit.issues.length,
      promotionGateCount: promotionGateCoherenceAudit.gateIndexes.length,
      coherentPromotionGateCount: promotionGateCoherenceAudit.coherentGateIndexes.length,
      incoherentPromotionGateCount: promotionGateCoherenceAudit.incoherentGateIndexes.length,
      unsupportedDirectConsumerPromotionGateCount: promotionGateCoherenceAudit.directConsumerIssueCount,
      unsupportedFieldOrAliasRejectionGateCount: promotionGateCoherenceAudit.fieldOrAliasIssueCount,
      ambiguousPromotionGateDecisionCount: promotionGateCoherenceAudit.ambiguousDecisionIssueCount,
      partialPromotionGateDecisionCount: promotionGateCoherenceAudit.partialDecisionIssueCount,
      bundleEventCount: bundleSummary?.eventCount || 0,
      confirmationDecisionCount: confirmationSummary?.decisionCount || 0,
      confirmationPromotionReadyCount: confirmationSummary?.promotionReadyCount || 0,
      confirmationPendingCount: confirmationSummary?.pendingInsufficientCount || 0,
      confirmationRejectedCount: confirmationSummary?.fieldOrAliasOnlyRejectedCount || 0,
      bundleError,
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
    forbiddenPayloadKeys,
    unknownHookIssues: reviewGate.unknownHookIssues,
      unsupportedReviewFieldIssues: reviewGate.unsupportedFieldIssues,
    placeholderFields: placeholderAudit.placeholderFields,
    templateTraceIds: placeholderAudit.templateTraceIds,
    generatedCandidateTraceIds: placeholderAudit.generatedCandidateTraceIds,
    generatedCandidateTraceIdIssues: reviewGate.generatedCandidateTraceIdIssues,
    placeholderObservationIndexes: placeholderAudit.placeholderObservationIndexes,
    requiredFieldIssues: requiredFieldAudit.issues,
    fieldCompleteObservationIndexes: requiredFieldAudit.completeObservationIndexes,
    fieldIncompleteObservationIndexes: requiredFieldAudit.incompleteObservationIndexes,
    promotionGateCoherenceIssues: promotionGateCoherenceAudit.issues,
    coherentPromotionGateIndexes: promotionGateCoherenceAudit.coherentGateIndexes,
    incoherentPromotionGateIndexes: promotionGateCoherenceAudit.incoherentGateIndexes,
    traceGroups,
    planCompleteness,
    bundleSummary,
    confirmationSummary,
    decisions,
    nextLeads: [
      'If templateOnly is true, copy the template to tmp/local-hook-observations.json and fill it with real clean-runtime observations before bundling.',
      'If candidateOnly is true, use the file only as a metadata checklist; replace it with real clean-runtime observations before bundling or proof planning.',
      'If inputHasGeneratedCandidateTraceIds is true, replace generated candidate trace ids with real trace ids from clean-runtime callbacks before bundling.',
      'If inputHasUnfilledTemplatePlaceholders is true, replace residual-template trace ids and null/empty placeholders with real metadata-only observations or omit unknown optional fields.',
      'If inputHasMissingRequiredCaptureFields is true, fill the required metadata fields for each observed hook before running the closure pipeline.',
      'If inputHasIncoherentPromotionGates is true, make the promotion gate agree with same-frame hook observations before bundling or proof planning.',
      'If forbiddenPayloadKeyCount is nonzero, remove forbidden payload fields before running the local bundle or confirmation audit.',
      'If completePlanCount is zero or lower than five, inspect planCompleteness missingHookIds and capture the missing hook observations in the same frame trace group.',
      'When confirmationPromotionReadyCount is nonzero for real observations, update residual proof metadata with a follow-up audit.',
    ],
  };
}

function main() {
  const inputPath = resolveRepoPath(argValue('--observations') || argValue('--input')) || defaultInputPath;
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const noWrite = process.argv.includes('--no-write');
  const regionIds = normalizeRegionFilters([
    ...argValues('--region'),
    ...argValues('--regions'),
  ]);
  const mapData = readJson(mapPath);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Observation input not found: ${path.relative(repoRoot, inputPath)}`);
  }
  const input = readJson(inputPath);
  const audit = buildResidualRuntimeTraceObservationAudit(mapData, input, {
    source: path.relative(repoRoot, inputPath),
    regionIds,
  });
  if (!noWrite) writeJson(outputPath, audit);
  console.log(JSON.stringify({
    ok: true,
    input: path.relative(repoRoot, inputPath),
    output: noWrite ? null : path.relative(repoRoot, outputPath),
    summary: audit.summary,
    forbiddenPayloadKeys: audit.forbiddenPayloadKeys,
    planCompleteness: audit.planCompleteness,
  }, null, 2));
  if (audit.summary.forbiddenPayloadKeyCount > 0 ||
      audit.summary.templateOnly ||
      audit.summary.inputHasUnfilledTemplatePlaceholders ||
      audit.summary.inputHasMissingRequiredCaptureFields ||
      audit.summary.inputHasIncoherentPromotionGates ||
      audit.summary.completePlanCount === 0) {
    process.exitCode = 1;
  }
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
