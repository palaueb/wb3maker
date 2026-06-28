#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildResidualRuntimeTraceHookManifest } from '../shared/wb3/residual-runtime-trace-hooks.js';
import { REQUIRED_RESIDUAL_RUNTIME_CAPTURE_FIELD_RULES } from '../shared/wb3/residual-runtime-observation-review.js';
import {
  buildLocalResidualRuntimeTraceObservationTemplate,
  buildLocalResidualRuntimeTraceObservationTemplatePack,
} from './world-residual-runtime-trace-local-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const now = '2026-06-26T00:00:00Z';
const eventContractCatalogId = 'world-residual-runtime-trace-event-contract-catalog-2026-06-26';
const closurePipelineCatalogId = 'world-residual-runtime-closure-pipeline-catalog-2026-06-26';
const catalogId = 'world-residual-runtime-capture-checklist-catalog-2026-06-26';
const reportId = 'residual-runtime-capture-checklist-audit-2026-06-26';
const toolName = 'tools/world-residual-runtime-capture-checklist-audit.mjs';
const schemaVersion = 1;

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

function regionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function compactRegion(region) {
  return {
    id: region?.id || '',
    offset: region?.offset || '',
    size: Number(region?.size || 0),
    type: region?.type || '',
    confidence: region?.confidence || null,
    name: region?.name || '',
  };
}

function staticEvidence(region) {
  const evidence = [];
  const triage = region?.analysis?.lowConfidenceResidualTriageAudit;
  if (triage?.kind) evidence.push(`lowConfidenceResidualTriageAudit classifies ${region.id} as ${triage.kind}.`);
  if (triage?.proofPlan?.requiredProof) evidence.push(triage.proofPlan.requiredProof);
  const unresolved = region?.analysis?.unresolvedAssetConsumerAudit;
  if (unresolved?.consumerStatus) evidence.push(`unresolvedAssetConsumerAudit status is ${unresolved.consumerStatus}.`);
  for (const line of unresolved?.negativeEvidence || []) evidence.push(line);
  const semantic = region?.analysis?.residualSemanticDispositionPlanAudit;
  if (semantic?.status) evidence.push(`residualSemanticDispositionPlanAudit status is ${semantic.status}; semanticPromotionReady=${semantic.semanticPromotionReady === true}.`);
  const closure = region?.analysis?.residualRuntimeClosurePipelineAudit;
  if (closure?.status) evidence.push(`residualRuntimeClosurePipelineAudit status is ${closure.status}.`);
  return uniqueSorted(evidence).slice(0, 8);
}

function outcomeRulesForPlan(plan) {
  const common = [
    'All requiredRuntimeHookIds must be observed in the same same_frame_trace_id.',
    'The trace group must match the target region id or one of the target offsets.',
    'The promotion gate must be set only from reviewed metadata-only runtime observations.',
  ];
  if (plan.regionId === 'r2813') {
    return {
      confirmation: [
        ...common,
        'Confirm only when the overlay index/read hook selects the target record offset, or the overlay loader hook reports this residual as the loader source.',
        'A reviewed promotion gate must set direct_consumer_confirmed=true and promotion_ready=true for the same trace group.',
      ],
      rejection: [
        'Keep quarantined if the overlay hooks are present but do not select the target offset.',
        'A reviewed promotion gate may set field_or_alias_only_rejected=true only when the same trace proves non-selection or field-only use.',
      ],
    };
  }
  if (['r2815', 'r2816', 'r2817'].includes(plan.regionId)) {
    return {
      confirmation: [
        ...common,
        'Confirm only when palette_tail_cursor_watch observes the target region with access_role=direct_consumer and same-bank or explicit physical-ROM-source evidence.',
        'The palette parser entry alone is not sufficient; it must be paired with a direct tail cursor watch in the same trace group.',
      ],
      rejection: [
        'Reject as field-only when the cursor watch only identifies the normal _LABEL_10BC_ palette parser context for the target.',
        'Reject as alias-only when the cursor watch hits the target logical address while mapped_source_bank/active_bank does not match the target source bank and no physical_rom_region_id confirms the target.',
        'Keep quarantined if the tail cursor is not reached or the access role is missing.',
      ],
    };
  }
  if (plan.regionId === 'r0749') {
    return {
      confirmation: [
        ...common,
        'Confirm only when the bank-7 sidecar direct watch reports read_region_id=r0749 with direct_bank7_consumer=true.',
        'The bank-7 controller entry must share the same trace group as the direct watch.',
      ],
      rejection: [
        'Reject as alias-only when the alias loader call resolves to a source region other than r0749.',
        'Keep quarantined if only the controller entry is observed without a direct read or alias resolution.',
      ],
    };
  }
  return {
    confirmation: common,
    rejection: ['Keep quarantined until a region-specific runtime rule is added.'],
  };
}

function hookChecklist(plan, manifest, template) {
  const hooksById = new Map((manifest.hooks || []).map(hook => [hook.hookId, hook]));
  const group = (template.traceGroups || []).find(item => item.regionId === plan.regionId);
  return (plan.requiredRuntimeHookIds || []).map(hookId => {
    const hook = hooksById.get(hookId) || {};
    const templateObservationIndex = (group?.observationIndexes || []).find(index => template.observations?.[index]?.hookId === hookId);
    return {
      hookId,
      label: hook.label || null,
      offset: hook.offset || null,
      regionId: hook.regionId || null,
      hookClass: hook.hookClass || '',
      eventKind: hook.eventKind || '',
      mcpBreakpointOffsets: hook.mcpBreakpointOffsets || [],
      required: true,
      templateObservationIndex: Number.isInteger(templateObservationIndex) ? templateObservationIndex : null,
      captureFields: hook.captureFields || [],
      requiredCaptureFields: REQUIRED_RESIDUAL_RUNTIME_CAPTURE_FIELD_RULES[hookId]?.requiredFields || [],
      requiredTrueFieldGroups: REQUIRED_RESIDUAL_RUNTIME_CAPTURE_FIELD_RULES[hookId]?.requiredTrueFieldGroups || [],
    };
  });
}

function buildChecklistEntry(mapData, plan, manifest, template, templatePack) {
  const region = regionById(mapData, plan.regionId);
  const group = (template.traceGroups || []).find(item => item.regionId === plan.regionId);
  const templatePackEntry = (templatePack.templates || []).find(item => item.regionId === plan.regionId) || {};
  const workflowCommands = templatePack.commands || {};
  const rules = outcomeRulesForPlan(plan);
  return {
    planId: plan.planId || plan.id,
    region: compactRegion(region),
    classId: plan.classId || '',
    targetOffsets: plan.targetOffsets || [],
    sameFrameTraceTemplateId: group?.same_frame_trace_id || null,
    requiredRuntimeHookIds: plan.requiredRuntimeHookIds || [],
    requiredObservationCount: (plan.requiredRuntimeHookIds || []).length,
    regionTemplateCommand: `node tools/world-residual-runtime-trace-local-bundle.mjs --template --region ${plan.regionId} --out tmp/local-hook-observations.${plan.regionId}.template.json`,
    templatePackOutputPath: templatePackEntry.outputPath || null,
    templatePackIndexOutputPath: templatePack.summary?.indexOutputPath || null,
    filledObservationPath: workflowCommands.filledObservationPath || 'tmp/local-hook-observations.json',
    observationAuditCommand: workflowCommands.auditCommand || 'node tools/world-residual-runtime-trace-observation-audit.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-trace-observation-audit.local.json',
    bundleCommand: workflowCommands.bundleCommand || 'node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-trace-events.local.json',
    reviewedBundleCommand: workflowCommands.reviewedBundleCommand || 'node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --reviewed-runtime-observations --out tmp/world-residual-runtime-trace-events.local.json',
    confirmationCommand: workflowCommands.confirmationCommand || 'node tools/world-residual-runtime-trace-confirmation-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json',
    focusedObservationAuditCommand: `node tools/world-residual-runtime-trace-observation-audit.mjs --observations tmp/local-hook-observations.json --region ${plan.regionId} --out tmp/world-residual-runtime-trace-observation-audit.local.json`,
    focusedBundleCommand: `node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --region ${plan.regionId} --out tmp/world-residual-runtime-trace-events.local.json`,
    focusedReviewedBundleCommand: `node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --reviewed-runtime-observations --region ${plan.regionId} --out tmp/world-residual-runtime-trace-events.local.json`,
    focusedConfirmationCommand: `node tools/world-residual-runtime-trace-confirmation-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json --region ${plan.regionId}`,
    focusedProofPlanCommand: `node tools/world-residual-runtime-proof-update-plan-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json --region ${plan.regionId} --out tmp/world-residual-runtime-proof-update-plan.local.json`,
    focusedClosurePipelineCommand: `node tools/world-residual-runtime-closure-pipeline-audit.mjs --observations tmp/local-hook-observations.json --region ${plan.regionId} --out tmp/world-residual-runtime-closure-pipeline.local.json`,
    hookChecklist: hookChecklist(plan, manifest, template),
    completionCriteria: [
      'Use one same_frame_trace_id per residual target.',
      'Fill metadata-only fields from clean runtime observation; leave raw bytes, tile ids, palette values, VDP port values, register dumps, pixels, screenshots, hashes, instruction bytes, audio bytes, and samples out of the file.',
      'Run the closure pipeline after filling tmp/local-hook-observations.json.',
    ],
    confirmationCriteria: rules.confirmation,
    rejectionCriteria: rules.rejection,
    staticEvidence: staticEvidence(region),
    status: 'waiting_for_real_metadata_only_runtime_observation',
  };
}

function assetPolicy() {
  return 'Metadata only: region ids, offsets, hook ids, labels, field names, trace template ids, decisions, commands, counts, booleans, and evidence summaries. No ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.';
}

export function buildResidualRuntimeCaptureChecklistCatalog(mapData) {
  const eventContract = requireCatalog(mapData, eventContractCatalogId);
  const closurePipeline = requireCatalog(mapData, closurePipelineCatalogId);
  const manifest = buildResidualRuntimeTraceHookManifest(eventContract);
  const template = buildLocalResidualRuntimeTraceObservationTemplate(mapData);
  const templatePack = buildLocalResidualRuntimeTraceObservationTemplatePack(mapData);
  const tracePlans = manifest.tracePlans || [];
  const checklists = tracePlans.map(plan => buildChecklistEntry(mapData, plan, manifest, template, templatePack));
  const requiredHookIds = uniqueSorted(checklists.flatMap(item => item.requiredRuntimeHookIds));
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [eventContractCatalogId, closurePipelineCatalogId],
    assetPolicy: assetPolicy(),
    summary: {
      targetRegionCount: checklists.length,
      tracePlanCount: tracePlans.length,
      requiredObservationCount: checklists.reduce((sum, item) => sum + item.requiredObservationCount, 0),
      uniqueRequiredHookCount: requiredHookIds.length,
      templateObservationCount: template.summary.observationCount,
      templateTraceGroupCount: template.summary.tracePlanCount,
      supportsRegionScopedTemplates: true,
      supportsRegionTemplatePacks: true,
      supportsRegionScopedBundles: true,
      focusedBundlesFilterObservationGroups: true,
      supportsRegionScopedClosurePipeline: true,
      templatePackEntryCount: templatePack.summary.templateCount,
      closurePipelineReady: closurePipeline.summary?.pipelineReady === true,
      closurePipelineStatus: closurePipeline.summary?.guardStatus || '',
      defaultTemplateOutputPath: 'tmp/local-hook-observations.template.json',
      defaultTemplatePackDir: templatePack.summary.outputDir,
      defaultTemplatePackIndexOutputPath: templatePack.summary.indexOutputPath,
      defaultObservationInputPath: 'tmp/local-hook-observations.json',
      defaultObservationAuditOutputPath: templatePack.summary.defaultObservationAuditOutputPath,
      defaultBundleOutputPath: templatePack.summary.defaultBundleOutputPath,
      defaultClosurePipelineOutputPath: 'tmp/world-residual-runtime-closure-pipeline.local.json',
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
    requiredHookIds,
    commands: {
      generateTemplate: 'node tools/world-residual-runtime-trace-local-bundle.mjs --template --out tmp/local-hook-observations.template.json',
      generateRegionTemplateExample: 'node tools/world-residual-runtime-trace-local-bundle.mjs --template --region r2813 --out tmp/local-hook-observations.r2813.template.json',
      generateRegionBundleExample: 'node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --region r2813 --out tmp/world-residual-runtime-trace-events.local.json',
      generateRegionTemplatePack: 'node tools/world-residual-runtime-trace-local-bundle.mjs --template-pack --out tmp/local-hook-observations.templates',
      runChecklistAudit: 'node tools/world-residual-runtime-capture-checklist-audit.mjs --apply',
      runClosurePipeline: 'node tools/world-residual-runtime-closure-pipeline-audit.mjs --observations tmp/local-hook-observations.json --out tmp/world-residual-runtime-closure-pipeline.local.json',
    },
    checklists,
    evidence: [
      `${eventContractCatalogId} supplies the required runtime hook ids and allowed metadata-only capture fields.`,
      `${closurePipelineCatalogId} supplies the end-to-end local observation validation command and current waiting status.`,
      'Checklist entries are derived from the existing observation template and residual evaluator semantics; no residual type, confidence, coverage, or proof metadata is changed.',
    ],
    nextLeads: [
      'Generate the observation template, fill tmp/local-hook-observations.json with real clean-runtime metadata observations, then run the closure pipeline.',
      'Use the confirmation and proof-update tools only after reviewing a pipeline report generated from real observations.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const item of catalog.checklists || []) {
    const region = regionById(mapData, item.region.id);
    if (!region) {
      missingRegions.push({ id: item.region.id, role: 'residual_runtime_capture_checklist_target' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.residualRuntimeCaptureChecklistAudit = {
      catalogId,
      kind: 'residual_runtime_capture_checklist',
      status: item.status,
      confidence: 'medium_high_tooling',
      planId: item.planId,
      classId: item.classId,
      targetOffsets: item.targetOffsets,
      requiredRuntimeHookIds: item.requiredRuntimeHookIds,
      requiredObservationCount: item.requiredObservationCount,
      regionTemplateCommand: item.regionTemplateCommand,
      templatePackOutputPath: item.templatePackOutputPath,
      templatePackIndexOutputPath: item.templatePackIndexOutputPath,
      filledObservationPath: item.filledObservationPath,
      observationAuditCommand: item.observationAuditCommand,
      bundleCommand: item.bundleCommand,
      reviewedBundleCommand: item.reviewedBundleCommand,
      confirmationCommand: item.confirmationCommand,
      focusedObservationAuditCommand: item.focusedObservationAuditCommand,
      focusedBundleCommand: item.focusedBundleCommand,
      focusedReviewedBundleCommand: item.focusedReviewedBundleCommand,
      focusedBundlesFilterObservationGroups: catalog.summary.focusedBundlesFilterObservationGroups,
      focusedConfirmationCommand: item.focusedConfirmationCommand,
      focusedProofPlanCommand: item.focusedProofPlanCommand,
      focusedClosurePipelineCommand: item.focusedClosurePipelineCommand,
      sameFrameTraceTemplateId: item.sameFrameTraceTemplateId,
      defaultObservationInputPath: catalog.summary.defaultObservationInputPath,
      defaultObservationAuditOutputPath: catalog.summary.defaultObservationAuditOutputPath,
      defaultBundleOutputPath: catalog.summary.defaultBundleOutputPath,
      defaultClosurePipelineOutputPath: catalog.summary.defaultClosurePipelineOutputPath,
      semanticDispositionMutatedByThisTool: false,
      coverageChangedByThisTool: false,
      summary: 'Metadata-only residual capture checklist is ready; region promotion still requires real runtime observations and proof-update review.',
      evidence: item.staticEvidence.slice(0, 5).concat([
        `${eventContractCatalogId} defines the same-frame hook set for this residual.`,
      ]),
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      confidence: region.confidence || null,
      requiredObservationCount: item.requiredObservationCount,
      status: item.status,
    });
  }
  mapData.residualRuntimeCaptureChecklistCatalogs = (mapData.residualRuntimeCaptureChecklistCatalogs || []).filter(item => item.id !== catalogId);
  mapData.residualRuntimeCaptureChecklistCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'residual_runtime_capture_checklist_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      changedRegionCount: changedRegions.length,
      missingRegionCount: missingRegions.length,
      semanticDispositionMutatedByThisTool: false,
      coverageChangedByThisTool: false,
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
  staticMap.summary.residualRuntimeCaptureChecklistCatalog = catalogId;
  staticMap.summary.residualRuntimeCaptureChecklistTargets = catalog.summary.targetRegionCount;
  staticMap.summary.residualRuntimeCaptureChecklistRequiredObservations = catalog.summary.requiredObservationCount;
  staticMap.summary.residualRuntimeCaptureChecklistSupportsRegionScopedTemplates = catalog.summary.supportsRegionScopedTemplates;
  staticMap.summary.residualRuntimeCaptureChecklistSupportsRegionTemplatePacks = catalog.summary.supportsRegionTemplatePacks;
  staticMap.summary.residualRuntimeCaptureChecklistSupportsRegionScopedBundles = catalog.summary.supportsRegionScopedBundles;
  staticMap.summary.residualRuntimeCaptureChecklistFocusedBundlesFilterObservationGroups = catalog.summary.focusedBundlesFilterObservationGroups;
  staticMap.summary.residualRuntimeCaptureChecklistSupportsRegionScopedClosurePipeline = catalog.summary.supportsRegionScopedClosurePipeline;
  staticMap.summary.residualRuntimeCaptureChecklistTemplatePackEntries = catalog.summary.templatePackEntryCount;
  staticMap.summary.residualRuntimeCaptureChecklistTemplatePackDir = catalog.summary.defaultTemplatePackDir;
  staticMap.summary.residualRuntimeCaptureChecklistTemplatePackIndex = catalog.summary.defaultTemplatePackIndexOutputPath;
  staticMap.summary.residualRuntimeCaptureChecklistDefaultInput = catalog.summary.defaultObservationInputPath;
  staticMap.summary.residualRuntimeCaptureChecklistObservationAuditOutput = catalog.summary.defaultObservationAuditOutputPath;
  staticMap.summary.residualRuntimeCaptureChecklistBundleOutput = catalog.summary.defaultBundleOutputPath;
  staticMap.summary.residualRuntimeCaptureChecklistPipelineOutput = catalog.summary.defaultClosurePipelineOutputPath;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-residual-runtime-capture-checklist-catalog-2026-06-26 to fill metadata-only residual observations before running the residual closure pipeline.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  const regionTemplateLead = 'Use tools/world-residual-runtime-trace-local-bundle.mjs --template --region <regionId> to generate focused residual observation templates for one runtime-proof target at a time.';
  if (!staticMap.nextLeads.includes(regionTemplateLead)) staticMap.nextLeads.push(regionTemplateLead);
  const templatePackLead = 'Use tools/world-residual-runtime-trace-local-bundle.mjs --template-pack --out tmp/local-hook-observations.templates to generate one metadata-only template per residual proof target.';
  if (!staticMap.nextLeads.includes(templatePackLead)) staticMap.nextLeads.push(templatePackLead);
  const focusedBundleLead = 'Use tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --region <regionId> to persist focused residual region filters into metadata-only event bundles.';
  if (!staticMap.nextLeads.includes(focusedBundleLead)) staticMap.nextLeads.push(focusedBundleLead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const apply = process.argv.includes('--apply');
  const noWrite = process.argv.includes('--no-write');
  const outputIndex = process.argv.indexOf('--out');
  const outputPath = outputIndex === -1 ? null : path.resolve(repoRoot, process.argv[outputIndex + 1] || '');
  const mapData = readJson(mapPath);
  const catalog = buildResidualRuntimeCaptureChecklistCatalog(mapData);
  let annotation = { changedRegions: [], missingRegions: [] };
  if (apply) {
    annotation = applyCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }
  if (!noWrite && outputPath && !apply) writeJson(outputPath, catalog);
  console.log(JSON.stringify({
    ok: true,
    applied: apply,
    output: outputPath && !apply && !noWrite ? path.relative(repoRoot, outputPath) : null,
    catalogId,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
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
