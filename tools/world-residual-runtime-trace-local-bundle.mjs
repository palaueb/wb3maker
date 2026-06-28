#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildResidualRuntimeTraceHookManifest,
  createResidualRuntimeTraceHookBridge,
} from '../shared/wb3/residual-runtime-trace-hooks.js';
import {
  collectForbiddenTracePayloadKeys,
} from '../shared/wb3/residual-runtime-trace-events.js';
import {
  buildResidualRuntimeObservationReviewGate,
  filterResidualRuntimeObservationsForRegions,
  hookIdFromObservation,
  normalizedObservationFields as observationFields,
} from '../shared/wb3/residual-runtime-observation-review.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-residual-runtime-trace-events.local.json');
const defaultTemplatePath = path.join(repoRoot, 'tmp/local-hook-observations.template.json');
const defaultTemplatePackDir = path.join(repoRoot, 'tmp/local-hook-observations.templates');
const eventContractCatalogId = 'world-residual-runtime-trace-event-contract-catalog-2026-06-26';
const toolName = 'tools/world-residual-runtime-trace-local-bundle.mjs';

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

function requireEventContract(mapData) {
  const catalog = findCatalog(mapData, eventContractCatalogId);
  if (!catalog) throw new Error(`Missing required catalog ${eventContractCatalogId}`);
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

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function normalizeRegionFilters(values) {
  return uniqueSorted((values || [])
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim())
    .filter(Boolean));
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

function sourceFromInput(input, inputPath) {
  if (input && typeof input === 'object' && !Array.isArray(input) && input.source) return input.source;
  return inputPath ? path.relative(repoRoot, inputPath) : 'none';
}

function isPromotionGate(observation, hookId) {
  return hookId === 'residual_runtime_promotion_gate' || observation?.kind === 'promotion_gate';
}

function traceIdFromFields(fields, fallback = null) {
  return fields.same_frame_trace_id || fields.traceId || fields.frameTraceId || fallback;
}

function compactEmitResult(result, index, hookId) {
  return {
    index,
    hookId,
    emitted: Boolean(result.event?.hookId && result.event?.same_frame_trace_id),
    droppedFieldCount: result.droppedFields?.length || 0,
    validationIssueCount: result.validationIssues?.length || 0,
    validationIssueKinds: (result.validationIssues || []).map(issue => issue.kind),
  };
}

function fieldTemplateValue(field, hook, plan) {
  if (field === 'same_frame_trace_id') return undefined;
  if (field === 'target_region_id') return plan.regionId || null;
  if (field === 'target_offset') return plan.targetOffsets?.[0] || null;
  if (field === 'runtime_trace_kind') return null;
  if (field === 'direct_consumer_confirmed') return false;
  if (field === 'field_or_alias_only_rejected') return false;
  if (field === 'promotion_ready') return false;
  if (field === 'loader_source_region_id') return plan.regionId || null;
  if (field === 'loader_source_offset') return plan.targetOffsets?.[0] || null;
  if (field === 'cursor_region_id') return plan.regionId || null;
  if (field === 'physical_rom_offset') return null;
  if (field === 'physical_rom_region_id') return null;
  if (field === 'mapped_source_bank') return null;
  if (field === 'bank_context_matches_source') return null;
  if (field === 'read_region_id') return plan.regionId || null;
  if (field.endsWith('_offset') || field === 'computed_record_end_exclusive') return plan.targetOffsets?.[0] || null;
  if (field === 'access_role') return null;
  if (field === 'consumer_label') return hook.label || null;
  return null;
}

function buildObservationTemplate(hook, plan, traceId) {
  const observation = {
    hookId: hook.hookId,
    same_frame_trace_id: traceId,
  };
  if (hook.hookId === 'residual_runtime_promotion_gate') {
    observation.kind = 'promotion_gate';
    observation.regionId = plan.regionId;
  }
  for (const field of hook.captureFields || []) {
    const value = fieldTemplateValue(field, hook, plan);
    if (value !== undefined) observation[field] = value;
  }
  return observation;
}

export function buildLocalResidualRuntimeTraceObservationTemplate(mapData, options = {}) {
  const eventContract = requireEventContract(mapData);
  const manifest = buildResidualRuntimeTraceHookManifest(eventContract);
  const hookById = new Map(manifest.hooks.map(hook => [hook.hookId, hook]));
  const tracePrefix = options.tracePrefix || 'residual-template';
  const regionFilter = normalizeRegionFilters(options.regionIds || (options.regionId ? [options.regionId] : []));
  const regionFilterSet = new Set(regionFilter);
  const selectedTracePlans = regionFilter.length
    ? manifest.tracePlans.filter(plan => regionFilterSet.has(plan.regionId))
    : manifest.tracePlans;
  const missingRegionIds = regionFilter.filter(regionId => !selectedTracePlans.some(plan => plan.regionId === regionId));
  if (regionFilter.length && selectedTracePlans.length === 0) {
    throw new Error(`No residual runtime trace plans matched requested region filter: ${regionFilter.join(', ')}`);
  }
  const observations = [];
  const traceGroups = [];

  selectedTracePlans.forEach((plan, index) => {
    const traceId = `${tracePrefix}-${String(index + 1).padStart(4, '0')}`;
    const requiredHookIds = plan.requiredRuntimeHookIds || [];
    const observationIndexes = [];
    for (const hookId of requiredHookIds) {
      const hook = hookById.get(hookId);
      if (!hook) continue;
      observationIndexes.push(observations.length);
      observations.push(buildObservationTemplate(hook, plan, traceId));
    }
    traceGroups.push({
      planId: plan.planId,
      regionId: plan.regionId,
      classId: plan.classId,
      targetOffsets: plan.targetOffsets || [],
      same_frame_trace_id: traceId,
      requiredRuntimeHookIds: requiredHookIds,
      observationIndexes,
    });
  });

  return {
    schemaVersion: 1,
    eventKind: 'wb3_residual_runtime_trace_observation_template',
    templateOnly: true,
    sourceCatalog: eventContractCatalogId,
    generatedBy: toolName,
    assetPolicy: 'Metadata-only local observation template. It contains hook ids, labels, offsets, region ids, allowed capture field names, booleans, null placeholders, and command paths only. Do not add ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples.',
    instructions: [
      'Copy this template to tmp/local-hook-observations.json before filling it with real clean-runtime hook observations.',
      'Keep same_frame_trace_id identical across observations that prove the same runtime frame/path.',
      'Replace null placeholders with metadata-only values observed by the clean runtime.',
      'Do not add forbidden payload fields or raw values such as ROM bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples.',
      'After filling real observations, run: node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-trace-events.local.json',
    ],
    summary: {
      tracePlanCount: selectedTracePlans.length,
      manifestTracePlanCount: manifest.tracePlanCount,
      regionFilter,
      missingRegionIds,
      observationCount: observations.length,
      hookCount: manifest.hookCount,
      runtimeHookCount: manifest.runtimeHookCount,
      promotionGateCount: manifest.promotionGateCount,
      defaultFilledObservationPath: 'tmp/local-hook-observations.json',
      defaultBundleOutputPath: 'tmp/world-residual-runtime-trace-events.local.json',
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
    traceGroups,
    observations,
  };
}

function templateFileNameForRegion(regionId) {
  return `${regionId}.template.json`;
}

function localObservationWorkflowCommands(options = {}) {
  const observationPath = options.observationPath || 'tmp/local-hook-observations.json';
  const auditOutputPath = options.auditOutputPath || 'tmp/world-residual-runtime-trace-observation-audit.local.json';
  const bundleOutputPath = options.bundleOutputPath || 'tmp/world-residual-runtime-trace-events.local.json';
  return {
    filledObservationPath: observationPath,
    observationAuditOutputPath: auditOutputPath,
    bundleOutputPath,
    auditCommand: `node tools/world-residual-runtime-trace-observation-audit.mjs --observations ${observationPath} --out ${auditOutputPath}`,
    bundleCommand: `node ${toolName} --observations ${observationPath} --out ${bundleOutputPath}`,
    reviewedBundleCommand: `node ${toolName} --observations ${observationPath} --reviewed-runtime-observations --out ${bundleOutputPath}`,
    confirmationCommand: `node tools/world-residual-runtime-trace-confirmation-audit.mjs --events ${bundleOutputPath}`,
  };
}

export function buildLocalResidualRuntimeTraceObservationTemplatePack(mapData, options = {}) {
  const fullTemplate = buildLocalResidualRuntimeTraceObservationTemplate(mapData, options);
  const outputDir = options.outputDir || 'tmp/local-hook-observations.templates';
  const workflow = localObservationWorkflowCommands(options.workflow || {});
  const templates = fullTemplate.traceGroups.map(group => {
    const template = buildLocalResidualRuntimeTraceObservationTemplate(mapData, {
      regionIds: [group.regionId],
      tracePrefix: options.tracePrefix || `residual-${group.regionId}-template`,
    });
    const relativeOutputPath = path.posix.join(outputDir.replace(/\\/g, '/'), templateFileNameForRegion(group.regionId));
    return {
      regionId: group.regionId,
      planId: group.planId,
      classId: group.classId,
      targetOffsets: group.targetOffsets || [],
      requiredRuntimeHookIds: group.requiredRuntimeHookIds || [],
      observationCount: template.summary.observationCount,
      tracePlanCount: template.summary.tracePlanCount,
      outputPath: relativeOutputPath,
      command: `node ${toolName} --template --region ${group.regionId} --out ${relativeOutputPath}`,
      filledObservationPath: workflow.filledObservationPath,
      auditCommand: workflow.auditCommand,
      bundleCommand: workflow.bundleCommand,
      reviewedBundleCommand: workflow.reviewedBundleCommand,
      confirmationCommand: workflow.confirmationCommand,
      template,
    };
  });
  return {
    schemaVersion: 1,
    eventKind: 'wb3_residual_runtime_trace_observation_template_pack',
    templateOnly: true,
    generatedBy: toolName,
    sourceCatalog: eventContractCatalogId,
    assetPolicy: 'Metadata-only residual observation template pack. It contains template file names, hook ids, region ids, offsets, field names, booleans, null placeholders, and command paths only. Do not add ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples.',
    instructions: [
      'Use one region template at a time as the starting point for tmp/local-hook-observations.json.',
      'Fill observations only from real clean-runtime callbacks before bundling.',
      'Do not mark generated templates as reviewed runtime evidence.',
    ],
    summary: {
      templateCount: templates.length,
      tracePlanCount: fullTemplate.summary.tracePlanCount,
      manifestTracePlanCount: fullTemplate.summary.manifestTracePlanCount,
      observationCount: templates.reduce((sum, item) => sum + item.observationCount, 0),
      regionFilter: fullTemplate.summary.regionFilter || [],
      missingRegionIds: fullTemplate.summary.missingRegionIds || [],
      outputDir,
      indexOutputPath: path.posix.join(outputDir.replace(/\\/g, '/'), 'index.json'),
      defaultFilledObservationPath: workflow.filledObservationPath,
      defaultObservationAuditOutputPath: workflow.observationAuditOutputPath,
      defaultBundleOutputPath: workflow.bundleOutputPath,
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
    commands: workflow,
    templates: templates.map(({ template, ...entry }) => entry),
    templateFiles: templates.map(item => ({
      regionId: item.regionId,
      outputPath: item.outputPath,
      template: item.template,
    })),
  };
}

export function writeLocalResidualRuntimeTraceObservationTemplatePack(repoRootPath, pack) {
  const written = [];
  for (const item of pack.templateFiles || []) {
    const filePath = path.resolve(repoRootPath, item.outputPath);
    writeJson(filePath, item.template);
    written.push(path.relative(repoRootPath, filePath));
  }
  const indexPath = path.resolve(repoRootPath, pack.summary.indexOutputPath);
  const { templateFiles, ...index } = pack;
  writeJson(indexPath, index);
  written.push(path.relative(repoRootPath, indexPath));
  return written;
}

export function buildLocalResidualRuntimeTraceBundle(mapData, input, options = {}) {
  if (isTemplateInput(input) && options.reviewedRuntimeObservations) {
    throw new Error('Observation templates cannot be marked as reviewed runtime evidence. Fill real observations, audit them, then bundle with --reviewed-runtime-observations after review.');
  }
  if (isTemplateInput(input) && !options.allowTemplateInput) {
    throw new Error('Observation template input is not runtime evidence. Copy it to tmp/local-hook-observations.json, fill it with real metadata-only observations, and rerun the bundler.');
  }
  if (isCandidateInput(input)) {
    throw new Error('Observation candidate input is not runtime evidence. Use it only as a metadata-only checklist, then capture real clean-runtime observations before bundling.');
  }
  const eventContract = requireEventContract(mapData);
  const bridge = createResidualRuntimeTraceHookBridge(eventContract, {
    tracePrefix: options.tracePrefix || 'residual-local',
  });
  const regionFilter = normalizeRegionFilters(options.regionIds || (options.regionId ? [options.regionId] : []));
  const sourceObservations = observationsFromInput(input);
  const forbiddenPayloadKeys = collectForbiddenTracePayloadKeys(sourceObservations);
  if (forbiddenPayloadKeys.length) {
    throw new Error(`Forbidden residual trace payload keys are not allowed in local observation input: ${forbiddenPayloadKeys.join(', ')}`);
  }
  const focusedObservationFilter = filterResidualRuntimeObservationsForRegions(bridge.manifest, sourceObservations, regionFilter);
  if (focusedObservationFilter.missingRegionIds.length) {
    throw new Error(`No residual runtime trace plans matched requested region filter: ${focusedObservationFilter.missingRegionIds.join(', ')}`);
  }
  const observations = focusedObservationFilter.observations;
  const reviewedRuntimeObservations = options.reviewedRuntimeObservations === true;
  const reviewGate = reviewedRuntimeObservations
    ? buildResidualRuntimeObservationReviewGate(bridge.manifest, observations)
    : null;
  if (reviewGate && !reviewGate.ok) {
    throw new Error(`Reviewed residual trace bundle requires clean observation input: ${JSON.stringify(reviewGate.summary)}`);
  }
  const emitResults = [];

  observations.forEach((observation, index) => {
    const hookId = hookIdFromObservation(observation);
    const fields = observationFields(observation);
    const traceId = traceIdFromFields(fields);
    const result = isPromotionGate(observation, hookId)
      ? bridge.emitPromotionGate(
        observation.regionId || observation.targetRegionId || fields.target_region_id,
        fields,
        traceId
      )
      : bridge.emitHook(hookId, fields, traceId);
    emitResults.push(compactEmitResult(result, index, hookId));
  });

  const validationIssueCount = emitResults.reduce((sum, item) => sum + item.validationIssueCount, 0);
  const droppedFieldCount = emitResults.reduce((sum, item) => sum + item.droppedFieldCount, 0);
  const unknownHookCount = emitResults.filter(item => item.validationIssueKinds.includes('unknown_hook_id')).length;

  return {
    manifest: bridge.manifest,
    bundle: bridge.bundle({
      source: options.source || 'local_residual_runtime_trace_observations',
      localBundleBuilder: toolName,
      regionIds: regionFilter,
      regionFilter,
      regionFilterApplied: regionFilter.length > 0,
      sourceObservationCount: focusedObservationFilter.sourceObservationCount,
      focusedObservationFilterDroppedCount: focusedObservationFilter.droppedObservationCount,
      selectedTraceIds: focusedObservationFilter.selectedTraceIds,
      missingRegionIds: focusedObservationFilter.missingRegionIds,
      reviewedRuntimeObservations,
      reviewStatus: reviewedRuntimeObservations
        ? 'reviewed_runtime_observations'
        : 'unreviewed_runtime_observations',
      reviewPolicy: 'Set reviewedRuntimeObservations only after a human review confirms the metadata-only observations came from real clean-runtime callbacks and pass the observation audit.',
      observationCount: observations.length,
      emittedEventCount: bridge.events().length,
      validationIssueCount,
      droppedFieldCount,
      unknownHookCount,
      reviewedObservationGateSummary: reviewGate?.summary || null,
    }),
    emitResults,
  };
}

function main() {
  const inputArg = argValue('--observations') || argValue('--input') || argValue('--events');
  const outputArg = argValue('--out');
  const showManifest = process.argv.includes('--manifest');
  const noWrite = process.argv.includes('--no-write');
  const writeTemplate = process.argv.includes('--template');
  const writeTemplatePack = process.argv.includes('--template-pack');
  const allowTemplateInput = process.argv.includes('--allow-template-input');
  const reviewedRuntimeObservations = process.argv.includes('--reviewed-runtime-observations');
  const regionIds = normalizeRegionFilters([
    ...argValues('--region'),
    ...argValues('--regions'),
  ]);
  const inputPath = resolveRepoPath(inputArg);
  const outputPath = resolveRepoPath(outputArg) || (writeTemplatePack ? defaultTemplatePackDir : writeTemplate ? defaultTemplatePath : defaultOutputPath);
  const mapData = readJson(mapPath);
  const eventContract = requireEventContract(mapData);
  const manifest = buildResidualRuntimeTraceHookManifest(eventContract);

  if (writeTemplatePack) {
    if (reviewedRuntimeObservations) {
      throw new Error('Cannot combine --template-pack with --reviewed-runtime-observations.');
    }
    const outputDir = path.relative(repoRoot, outputPath).replace(/\\/g, '/') || 'tmp/local-hook-observations.templates';
    const pack = buildLocalResidualRuntimeTraceObservationTemplatePack(mapData, {
      regionIds,
      outputDir,
    });
    const written = noWrite ? [] : writeLocalResidualRuntimeTraceObservationTemplatePack(repoRoot, pack);
    console.log(JSON.stringify({
      ok: true,
      outputDir,
      written,
      summary: pack.summary,
      templates: pack.templates,
      assetPolicy: pack.assetPolicy,
    }, null, 2));
    return;
  }

  if (writeTemplate) {
    if (reviewedRuntimeObservations) {
      throw new Error('Cannot combine --template with --reviewed-runtime-observations.');
    }
    const template = buildLocalResidualRuntimeTraceObservationTemplate(mapData, { regionIds });
    if (!noWrite) writeJson(outputPath, template);
    console.log(JSON.stringify({
      ok: true,
      output: noWrite ? null : path.relative(repoRoot, outputPath),
      summary: template.summary,
      assetPolicy: template.assetPolicy,
    }, null, 2));
    return;
  }

  if (showManifest || !inputPath) {
    console.log(JSON.stringify({
      ok: true,
      manifest,
      usage: `${toolName} --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-trace-events.local.json`,
      reviewedUsage: `${toolName} --observations tmp/local-hook-observations.json --reviewed-runtime-observations --out tmp/world-residual-runtime-trace-events.local.json`,
      templateUsage: `${toolName} --template --out tmp/local-hook-observations.template.json`,
      regionTemplateUsage: `${toolName} --template --region r2813 --out tmp/local-hook-observations.r2813.template.json`,
      templatePackUsage: `${toolName} --template-pack --out tmp/local-hook-observations.templates`,
      defaultOutput: path.relative(repoRoot, defaultOutputPath),
      defaultTemplate: path.relative(repoRoot, defaultTemplatePath),
      defaultTemplatePackDir: path.relative(repoRoot, defaultTemplatePackDir),
      assetPolicy: manifest.assetPolicy,
    }, null, 2));
    if (!inputPath) return;
  }

  const input = readJson(inputPath);
  const built = buildLocalResidualRuntimeTraceBundle(mapData, input, {
    source: sourceFromInput(input, inputPath),
    allowTemplateInput,
    reviewedRuntimeObservations,
    regionIds,
  });

  if (!noWrite) writeJson(outputPath, built.bundle);
  console.log(JSON.stringify({
    ok: true,
    input: path.relative(repoRoot, inputPath),
    output: noWrite ? null : path.relative(repoRoot, outputPath),
    summary: {
      manifestReady: built.manifest.readyForCleanRuntimeBridge,
      observationCount: built.bundle.observationCount,
      emittedEventCount: built.bundle.emittedEventCount,
      reviewedRuntimeObservations: built.bundle.reviewedRuntimeObservations === true,
      reviewStatus: built.bundle.reviewStatus || 'unreviewed_runtime_observations',
      regionFilter: built.bundle.regionFilter || [],
      regionFilterApplied: built.bundle.regionFilterApplied === true,
      sourceObservationCount: built.bundle.sourceObservationCount,
      focusedObservationFilterDroppedCount: built.bundle.focusedObservationFilterDroppedCount || 0,
      selectedTraceIds: built.bundle.selectedTraceIds || [],
      reviewedObservationGateSummary: built.bundle.reviewedObservationGateSummary || null,
      validationIssueCount: built.bundle.validationIssueCount,
      droppedFieldCount: built.bundle.droppedFieldCount,
      unknownHookCount: built.bundle.unknownHookCount,
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
    emitResults: built.emitResults,
  }, null, 2));
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
