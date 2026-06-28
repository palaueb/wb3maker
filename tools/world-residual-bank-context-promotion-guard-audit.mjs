#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { evaluateResidualRuntimeTracePlans } from '../shared/wb3/residual-runtime-trace-evaluator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-residual-bank-context-promotion-guard.local.json');
const tracePlanCatalogId = 'world-residual-runtime-trace-hook-plan-catalog-2026-06-26';
const bankContextCatalogId = 'world-gearsystem-mcp-palette-tail-bank-context-catalog-2026-06-26';
const paletteTailObservationCatalogId = 'world-gearsystem-mcp-palette-tail-observation-catalog-2026-06-26';
const catalogId = 'world-residual-bank-context-promotion-guard-catalog-2026-06-26';
const reportId = 'residual-bank-context-promotion-guard-audit-2026-06-26';
const toolName = 'tools/world-residual-bank-context-promotion-guard-audit.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;
const targetRegionIds = ['r2815', 'r2816', 'r2817'];

const forbiddenCounterNames = [
  'persistedRomByteCount',
  'persistedStreamByteCount',
  'persistedTileIdCount',
  'persistedPaletteByteCount',
  'persistedPortValueCount',
  'persistedRegisterTraceCount',
  'persistedProgramCounterCount',
  'persistedPixelCount',
  'persistedAudioByteCount',
  'persistedInstructionByteCount',
];

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
}

function relative(filePath) {
  return path.relative(repoRoot, filePath);
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value !== null && value !== undefined && value !== ''))].sort();
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData || {})) {
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

function recordByRegion(catalog) {
  return new Map((catalog.records || []).map(record => [record.regionId, record]));
}

function planByRegion(catalog) {
  return new Map((catalog.tracePlans || []).map(plan => [plan.region?.id || plan.regionId, plan]));
}

function numberFromHexLike(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const match = text.match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? Number.parseInt(match[1], 16) : null;
}

function hex(value, width = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `0x${value.toString(16).toUpperCase().padStart(width, '0')}`;
}

function firstTargetOffset(plan) {
  return (plan?.targetOffsets || []).find(Boolean) || plan?.region?.offset || null;
}

function expectedBankFromPlan(plan) {
  const offset = numberFromHexLike(firstTargetOffset(plan));
  return offset === null ? null : Math.floor(offset / 0x4000);
}

function oneEvaluation(plan, events) {
  return evaluateResidualRuntimeTracePlans([plan], events).evaluations[0] || {};
}

function traceId(regionId, suffix) {
  return `synthetic-bank-context-${regionId}-${suffix}`;
}

function buildEvents(plan, observation, activeBank, variant) {
  const regionId = plan.region?.id || plan.regionId;
  const id = traceId(regionId, variant);
  const targetOffset = firstTargetOffset(plan);
  const tailEvent = {
    hookId: 'residual_palette_tail_cursor_watch',
    same_frame_trace_id: id,
    active_bank: activeBank,
    consumer_label: observation.consumer_label || '_LABEL_919_',
    cursor_region_id: regionId,
    cursor_offset: observation.cursor_offset || targetOffset,
    access_role: 'direct_consumer',
    inside_palette_tail_region: true,
  };
  if (variant === 'physical-region') {
    tailEvent.physical_rom_region_id = regionId;
    tailEvent.physical_rom_offset = targetOffset;
  }
  if (variant === 'same-bank') {
    tailEvent.mapped_source_bank = expectedBankFromPlan(plan);
  }
  return [
    {
      hookId: 'residual_palette_parser_entry',
      same_frame_trace_id: id,
      active_bank: activeBank,
      palette_script_entry_index: 25,
    },
    tailEvent,
    {
      hookId: 'residual_runtime_promotion_gate',
      same_frame_trace_id: id,
      target_region_id: regionId,
    },
  ];
}

function buildRecord(regionId, plan, bankRecord, observationRecord) {
  const observation = observationRecord?.observation || {};
  const observedActiveBank = numberFromHexLike(bankRecord?.observedActiveBank ?? observation.active_bank);
  const expectedBank = expectedBankFromPlan(plan);
  const mismatchEvents = buildEvents(plan, observation, observedActiveBank, 'mismatch');
  const sameBankEvents = buildEvents(plan, observation, expectedBank, 'same-bank');
  const physicalRegionEvents = buildEvents(plan, observation, observedActiveBank, 'physical-region');
  const mismatchEvaluation = oneEvaluation(plan, mismatchEvents);
  const sameBankEvaluation = oneEvaluation(plan, sameBankEvents);
  const physicalRegionEvaluation = oneEvaluation(plan, physicalRegionEvents);
  const guardRejectsMismatch = mismatchEvaluation.runtimeTraceConfirmed === false &&
    mismatchEvaluation.fieldOrAliasOnlyRejected === true;
  const guardAllowsSameBank = sameBankEvaluation.runtimeTraceConfirmed === true &&
    sameBankEvaluation.promotionReady === true;
  const guardAllowsPhysicalRegion = physicalRegionEvaluation.runtimeTraceConfirmed === true &&
    physicalRegionEvaluation.promotionReady === true;
  return {
    regionId,
    status: guardRejectsMismatch && guardAllowsSameBank && guardAllowsPhysicalRegion
      ? 'bank_context_promotion_guard_verified'
      : 'bank_context_promotion_guard_incomplete',
    expectedSourceBank: expectedBank,
    expectedSourceBankHex: hex(expectedBank, 2),
    observedActiveBank,
    observedActiveBankHex: hex(observedActiveBank, 2),
    bankContextMismatchStatus: bankRecord?.status || null,
    candidateLogicalAliasTargetRegionId: bankRecord?.candidateLogicalAliasTargetRegionId || null,
    evaluatorOutcomes: {
      observedBankDirectConsumer: {
        finalStatus: mismatchEvaluation.finalStatus || null,
        runtimeTraceConfirmed: mismatchEvaluation.runtimeTraceConfirmed === true,
        fieldOrAliasOnlyRejected: mismatchEvaluation.fieldOrAliasOnlyRejected === true,
        promotionReady: mismatchEvaluation.promotionReady === true,
      },
      sameBankDirectConsumer: {
        finalStatus: sameBankEvaluation.finalStatus || null,
        runtimeTraceConfirmed: sameBankEvaluation.runtimeTraceConfirmed === true,
        fieldOrAliasOnlyRejected: sameBankEvaluation.fieldOrAliasOnlyRejected === true,
        promotionReady: sameBankEvaluation.promotionReady === true,
      },
      physicalRegionDirectConsumer: {
        finalStatus: physicalRegionEvaluation.finalStatus || null,
        runtimeTraceConfirmed: physicalRegionEvaluation.runtimeTraceConfirmed === true,
        fieldOrAliasOnlyRejected: physicalRegionEvaluation.fieldOrAliasOnlyRejected === true,
        promotionReady: physicalRegionEvaluation.promotionReady === true,
      },
    },
    guardRejectsObservedBankMismatch: guardRejectsMismatch,
    guardAllowsSameBankDirectConsumer: guardAllowsSameBank,
    guardAllowsPhysicalRegionDirectConsumer: guardAllowsPhysicalRegion,
    promotionGateAllowedForCurrentObservation: false,
    requiredFutureEvidence: [
      'same-bank mapped source bank that matches the target ROM offset bank',
      'or explicit physical_rom_region_id/physical_rom_offset from the emulator callback',
    ],
    evidence: [
      `${bankContextCatalogId} records observed active_bank ${hex(observedActiveBank, 2) || 'unknown'} against expected source bank ${hex(expectedBank, 2) || 'unknown'}.`,
      'Synthetic evaluator regression events contain only hook ids, trace ids, offsets, region ids, labels, booleans, and bank ids.',
      `The current observed-bank direct-consumer shape evaluates as ${mismatchEvaluation.finalStatus || 'unknown'}, so it cannot promote ${regionId}.`,
      `Same-bank and explicit physical-region variants evaluate as ${sameBankEvaluation.finalStatus || 'unknown'} and ${physicalRegionEvaluation.finalStatus || 'unknown'}, defining the required future proof.`,
    ],
  };
}

function buildCatalog(mapData) {
  const tracePlanCatalog = requireCatalog(mapData, tracePlanCatalogId);
  const bankContextCatalog = requireCatalog(mapData, bankContextCatalogId);
  const observationCatalog = requireCatalog(mapData, paletteTailObservationCatalogId);
  const plans = planByRegion(tracePlanCatalog);
  const bankByRegion = recordByRegion(bankContextCatalog);
  const observationByRegion = recordByRegion(observationCatalog);
  const records = targetRegionIds.map(regionId => {
    const plan = plans.get(regionId);
    if (!plan) throw new Error(`Missing trace plan for ${regionId}`);
    return buildRecord(regionId, plan, bankByRegion.get(regionId), observationByRegion.get(regionId));
  });
  const forbiddenCounters = Object.fromEntries(forbiddenCounterNames.map(name => [name, 0]));
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    eventKind: 'wb3_residual_bank_context_promotion_guard_audit',
    sourceCatalogs: [tracePlanCatalogId, bankContextCatalogId, paletteTailObservationCatalogId],
    sourceModules: [
      'shared/wb3/residual-runtime-trace-events.js',
      'shared/wb3/residual-runtime-trace-evaluator.js',
      'shared/wb3/residual-runtime-observation-review.js',
    ],
    assetPolicy: 'Metadata-only evaluator guard audit: hook ids, trace ids, labels, ROM offsets, region ids, bank ids, booleans, counts, and evaluator statuses. No ROM bytes, stream bytes, memory dumps, register traces, PC values, tile ids, palette values, VDP port values, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      targetRegionCount: records.length,
      guardVerifiedCount: records.filter(record => record.status === 'bank_context_promotion_guard_verified').length,
      observedBankMismatchRejectedCount: records.filter(record => record.guardRejectsObservedBankMismatch).length,
      sameBankDirectConsumerAllowedCount: records.filter(record => record.guardAllowsSameBankDirectConsumer).length,
      physicalRegionDirectConsumerAllowedCount: records.filter(record => record.guardAllowsPhysicalRegionDirectConsumer).length,
      promotionGateAllowedForCurrentObservationCount: records.filter(record => record.promotionGateAllowedForCurrentObservation).length,
      expectedSourceBanks: uniqueSorted(records.map(record => record.expectedSourceBankHex)),
      observedActiveBanks: uniqueSorted(records.map(record => record.observedActiveBankHex)),
      candidateLogicalAliasTargetRegionIds: uniqueSorted(records.map(record => record.candidateLogicalAliasTargetRegionId)),
      regionIds: records.map(record => record.regionId),
      ...forbiddenCounters,
    },
    records,
    evidence: [
      'The residual evaluator now requires r2815-r2817 palette-tail direct-consumer evidence to agree with the target source bank or carry explicit physical ROM region evidence.',
      'The current observed active bank is 0x08 while the target source bank is 0x07, so the current observation shape is rejected as alias/bank-context evidence.',
      'A same-bank or physical-region callback remains accepted, preserving the intended path for future emulator proof.',
    ],
    nextLeads: [
      'Extend the Gearsystem MCP callback to emit physical_rom_offset and physical_rom_region_id for mapped ROM read breakpoints.',
      'Re-run r2815-r2817 watchpoints and rebuild reviewed observations with physical source fields.',
      'Only apply residual_runtime_promotion_gate after this guard reports same-bank or physical-region direct-consumer evidence from real observations.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'bank_context_promotion_guard' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.residualBankContextPromotionGuardAudit = {
      catalogId,
      kind: 'residual_bank_context_promotion_guard',
      status: record.status,
      expectedSourceBank: record.expectedSourceBankHex,
      observedActiveBank: record.observedActiveBankHex,
      candidateLogicalAliasTargetRegionId: record.candidateLogicalAliasTargetRegionId,
      guardRejectsObservedBankMismatch: record.guardRejectsObservedBankMismatch,
      guardAllowsSameBankDirectConsumer: record.guardAllowsSameBankDirectConsumer,
      guardAllowsPhysicalRegionDirectConsumer: record.guardAllowsPhysicalRegionDirectConsumer,
      promotionGateAllowedForCurrentObservation: false,
      evaluatorOutcomes: record.evaluatorOutcomes,
      requiredFutureEvidence: record.requiredFutureEvidence,
      summary: 'Residual promotion is guarded against logical-address aliases: current observed-bank hits are rejected until same-bank or explicit physical-ROM-source evidence is captured.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: record.regionId,
      status: record.status,
      guardRejectsObservedBankMismatch: record.guardRejectsObservedBankMismatch,
      promotionGateAllowedForCurrentObservation: false,
    });
  }
  mapData.runtimeTraceBankContextPromotionGuardCatalogs = (mapData.runtimeTraceBankContextPromotionGuardCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.runtimeTraceBankContextPromotionGuardCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'residual_bank_context_promotion_guard_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceModules: catalog.sourceModules,
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
  staticMap.summary.residualBankContextPromotionGuardCatalog = catalogId;
  staticMap.summary.residualBankContextPromotionGuardTargetRegionCount = catalog.summary.targetRegionCount;
  staticMap.summary.residualBankContextPromotionGuardVerifiedCount = catalog.summary.guardVerifiedCount;
  staticMap.summary.residualBankContextPromotionGuardObservedBankMismatchRejectedCount = catalog.summary.observedBankMismatchRejectedCount;
  staticMap.summary.residualBankContextPromotionGuardSameBankDirectConsumerAllowedCount = catalog.summary.sameBankDirectConsumerAllowedCount;
  staticMap.summary.residualBankContextPromotionGuardPhysicalRegionDirectConsumerAllowedCount = catalog.summary.physicalRegionDirectConsumerAllowedCount;
  staticMap.summary.residualBankContextPromotionGuardPromotionGateAllowedForCurrentObservationCount = catalog.summary.promotionGateAllowedForCurrentObservationCount;
  staticMap.summary.residualBankContextPromotionGuardCandidateLogicalAliasTargetRegionIds = catalog.summary.candidateLogicalAliasTargetRegionIds;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`residualBankContextPromotionGuard${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use residualBankContextPromotionGuard metadata to require same-bank or physical-ROM-source proof before promoting r2815-r2817.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (!noWrite) writeJson(outputPath, catalog);
  let result = { changedRegions: [], missingRegions: [] };
  if (apply) {
    result = applyCatalog(mapData, catalog);
    if (!noWrite) {
      writeJson(mapPath, mapData);
      updateStaticMap(catalog);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    applied: apply,
    output: noWrite ? null : relative(outputPath),
    catalogId,
    summary: catalog.summary,
    changedRegions: result.changedRegions,
    missingRegions: result.missingRegions,
    assetPolicy: catalog.assetPolicy,
  }, null, 2));
}

main();
