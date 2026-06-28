#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildResidualRuntimeTraceObservationAudit } from './world-residual-runtime-trace-observation-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-physical-source-candidate.local.json');
const defaultObservationsPath = path.join(repoRoot, 'tmp/local-hook-observations.palette-tail-physical-source-candidates.local.json');
const paletteTailObservationCatalogId = 'world-gearsystem-mcp-palette-tail-observation-catalog-2026-06-26';
const bankContextCatalogId = 'world-gearsystem-mcp-palette-tail-bank-context-catalog-2026-06-26';
const promotionGuardCatalogId = 'world-residual-bank-context-promotion-guard-catalog-2026-06-26';
const catalogId = 'world-gearsystem-mcp-physical-source-candidate-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-physical-source-candidate-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-physical-source-candidate-audit.mjs';
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

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (/^0x[0-9a-f]+$/i.test(text)) return parseInt(text, 16);
  if (/^\$[0-9a-f]+$/i.test(text)) return parseInt(text.slice(1), 16);
  if (/^[0-9]+$/.test(text)) return parseInt(text, 10);
  return null;
}

function hex(value, width = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `0x${value.toString(16).toUpperCase().padStart(width, '0')}`;
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

function regionStart(region) {
  return parseNumber(region?.offset);
}

function regionEndExclusive(region) {
  const start = regionStart(region);
  const size = parseNumber(region?.size);
  return start === null || size === null ? null : start + size;
}

function containingRegion(mapData, offset) {
  if (offset === null) return null;
  return (mapData.regions || []).find(region => {
    const start = regionStart(region);
    const end = regionEndExclusive(region);
    return start !== null && end !== null && offset >= start && offset < end;
  }) || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size,
    type: region.type,
    name: region.name || null,
    confidence: region.confidence || null,
  };
}

function logicalAddressFromRomOffset(romOffset) {
  if (romOffset === null) return null;
  return romOffset < 0x4000 ? romOffset : 0x8000 + (romOffset % 0x4000);
}

function physicalOffsetFromMappedBank(logicalAddress, mappedBank) {
  if (logicalAddress === null || mappedBank === null) return null;
  if (logicalAddress < 0x8000 || logicalAddress > 0xBFFF) return null;
  return mappedBank * 0x4000 + (logicalAddress - 0x8000);
}

function expectedBankFromRegion(region) {
  const start = regionStart(region);
  return start === null ? null : Math.floor(start / 0x4000);
}

function tailObservationFromRecord(record) {
  return record?.observation || {};
}

function buildRecord(mapData, observationByRegion, bankByRegion, guardByRegion, regionId) {
  const sourceRegion = (mapData.regions || []).find(region => region.id === regionId);
  const observationRecord = observationByRegion.get(regionId);
  const bankRecord = bankByRegion.get(regionId);
  const guardRecord = guardByRegion.get(regionId);
  const observed = tailObservationFromRecord(observationRecord);
  const sourceOffset = parseNumber(sourceRegion?.offset);
  const logicalAddress = parseNumber(bankRecord?.logicalWatchRange?.start) ?? logicalAddressFromRomOffset(sourceOffset);
  const expectedBank = parseNumber(bankRecord?.expectedSourceBank ?? bankRecord?.expectedSourceBankHex) ?? expectedBankFromRegion(sourceRegion);
  const observedActiveBank = parseNumber(bankRecord?.observedActiveBank ?? bankRecord?.observedActiveBankHex ?? observed.active_bank);
  const derivedPhysicalOffset = physicalOffsetFromMappedBank(logicalAddress, observedActiveBank);
  const physicalRegion = containingRegion(mapData, derivedPhysicalOffset);
  const physicalRegionMatchesSource = physicalRegion?.id === regionId;
  const bankContextMatchesSource = expectedBank !== null &&
    observedActiveBank !== null &&
    expectedBank === observedActiveBank &&
    physicalRegionMatchesSource;
  const sameFrameTraceId = `mcp-physical-source-candidate-${regionId}-01`;
  const tailObservation = {
    hookId: 'residual_palette_tail_cursor_watch',
    same_frame_trace_id: sameFrameTraceId,
    active_bank: observedActiveBank,
    consumer_label: observed.consumer_label || '_LABEL_919_',
    cursor_offset: observed.cursor_offset || sourceRegion?.offset || null,
    cursor_region_id: regionId,
    physical_rom_offset: hex(derivedPhysicalOffset, 5),
    physical_rom_region_id: physicalRegion?.id || null,
    mapped_source_bank: observedActiveBank,
    bank_context_matches_source: bankContextMatchesSource,
    access_role: observed.access_role || 'single_address_read_breakpoint_with_mapper_write_tracking',
    inside_palette_tail_region: observed.inside_palette_tail_region === true,
  };
  const promotionGateCandidate = {
    hookId: 'residual_runtime_promotion_gate',
    kind: 'promotion_gate',
    regionId,
    same_frame_trace_id: sameFrameTraceId,
    target_region_id: regionId,
    runtime_trace_kind: 'same_bank_or_physical_source_palette_tail_trace',
    direct_consumer_confirmed: false,
    field_or_alias_only_rejected: true,
    promotion_ready: false,
  };
  const status = physicalRegion && !physicalRegionMatchesSource
    ? 'derived_physical_source_alias_candidate_ready'
    : physicalRegionMatchesSource
      ? 'derived_physical_source_matches_target_needs_emulator_confirmation'
      : 'derived_physical_source_unresolved';
  return {
    regionId,
    status,
    sourceRegion: compactRegion(sourceRegion),
    expectedSourceBank: expectedBank,
    expectedSourceBankHex: hex(expectedBank, 2),
    observedActiveBank,
    observedActiveBankHex: hex(observedActiveBank, 2),
    logicalWatchAddress: hex(logicalAddress, 4),
    derivedPhysicalRomOffset: hex(derivedPhysicalOffset, 5),
    derivedPhysicalRomRegion: compactRegion(physicalRegion),
    physicalRegionMatchesSource,
    bankContextMatchesSource,
    candidateLogicalAliasTargetRegionId: physicalRegion && !physicalRegionMatchesSource ? physicalRegion.id : null,
    candidateLogicalAliasTargetType: physicalRegion && !physicalRegionMatchesSource ? physicalRegion.type : null,
    physicalSourceDerivation: 'derived_from_observed_active_bank_and_logical_watch_address',
    physicalSourceEvidenceStrength: 'derived_candidate_not_emulator_native_physical_callback',
    currentPromotionGateAllowed: false,
    remainingClosureBlockers: [
      'residual_palette_parser_entry_same_frame_context_missing',
      'emulator_native_physical_rom_source_callback_missing',
    ],
    tailObservationCandidate: tailObservation,
    promotionGateCandidate,
    guardStatus: guardRecord?.status || null,
    guardRejectsObservedBankMismatch: guardRecord?.guardRejectsObservedBankMismatch === true,
    evidence: [
      `${paletteTailObservationCatalogId} supplies the logical cursor watch fields for ${regionId}.`,
      `${bankContextCatalogId} supplies observed active bank ${hex(observedActiveBank, 2) || 'unknown'} and the expected bank-context mismatch.`,
      derivedPhysicalOffset !== null
        ? `Applying active bank ${hex(observedActiveBank, 2)} to logical address ${hex(logicalAddress, 4)} derives physical ROM offset ${hex(derivedPhysicalOffset, 5)}.`
        : 'The physical ROM offset could not be derived from the available logical address and active bank.',
      physicalRegion
        ? `The derived physical offset is contained by ${physicalRegion.id} (${physicalRegion.type}).`
        : 'No mapped region contains the derived physical offset.',
      'This is a derived candidate for review; it does not replace a native emulator physical-ROM-source callback.',
    ],
  };
}

function buildCatalog(mapData) {
  const observationCatalog = requireCatalog(mapData, paletteTailObservationCatalogId);
  const bankContextCatalog = requireCatalog(mapData, bankContextCatalogId);
  const guardCatalog = requireCatalog(mapData, promotionGuardCatalogId);
  const observationByRegion = recordByRegion(observationCatalog);
  const bankByRegion = recordByRegion(bankContextCatalog);
  const guardByRegion = recordByRegion(guardCatalog);
  const records = targetRegionIds.map(regionId =>
    buildRecord(mapData, observationByRegion, bankByRegion, guardByRegion, regionId));
  const observations = records.flatMap(record => [
    record.tailObservationCandidate,
    record.promotionGateCandidate,
  ]);
  const observationInput = {
    schemaVersion: 1,
    eventKind: 'wb3_palette_tail_physical_source_candidate_observations',
    candidateOnly: true,
    generatedBy: toolName,
    sourceCatalogs: [paletteTailObservationCatalogId, bankContextCatalogId, promotionGuardCatalogId],
    observations,
    assetPolicy: 'Metadata-only physical-source candidate observations: hook ids, trace ids, labels, ROM offsets, region ids, bank ids, booleans, and candidate decisions. No ROM bytes, stream bytes, memory dumps, register traces, PC values, tile ids, palette values, VDP port values, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
  };
  const observationAudit = buildResidualRuntimeTraceObservationAudit(mapData, observationInput, {
    source: 'world-gearsystem-mcp-physical-source-candidate-audit',
    regionIds: targetRegionIds,
  });
  const forbiddenCounters = Object.fromEntries(forbiddenCounterNames.map(name => [name, 0]));
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    eventKind: 'wb3_gearsystem_mcp_physical_source_candidate_audit',
    sourceCatalogs: [paletteTailObservationCatalogId, bankContextCatalogId, promotionGuardCatalogId],
    observationsOutputPath: relative(defaultObservationsPath),
    assetPolicy: observationInput.assetPolicy,
    summary: {
      targetRegionCount: records.length,
      derivedPhysicalSourceCandidateCount: records.filter(record => record.derivedPhysicalRomOffset).length,
      aliasCandidateCount: records.filter(record => record.candidateLogicalAliasTargetRegionId).length,
      targetPhysicalMatchCount: records.filter(record => record.physicalRegionMatchesSource).length,
      bankContextMatchesSourceCount: records.filter(record => record.bankContextMatchesSource).length,
      currentPromotionGateAllowedCount: records.filter(record => record.currentPromotionGateAllowed).length,
      observationCandidateCount: observations.length,
      observationAuditInputUsableAsRuntimeEvidence: observationAudit.summary.inputUsableAsRuntimeEvidence,
      observationAuditCompletePlanCount: observationAudit.summary.completePlanCount,
      observationAuditIncompletePlanCount: observationAudit.summary.incompletePlanCount,
      observationAuditPromotionGateCoherenceIssueCount: observationAudit.summary.promotionGateCoherenceIssueCount,
      observationAuditRequiredFieldIssueCount: observationAudit.summary.requiredFieldIssueCount,
      observationAuditConfirmationRejectedCount: observationAudit.summary.confirmationRejectedCount,
      observationAuditBundleError: observationAudit.summary.bundleError || null,
      candidateOnlyRejectedByBundle: /candidate input is not runtime evidence/i.test(observationAudit.summary.bundleError || ''),
      missingClosureHookIds: ['residual_palette_parser_entry'],
      candidateLogicalAliasTargetRegionIds: uniqueSorted(records.map(record => record.candidateLogicalAliasTargetRegionId)),
      expectedSourceBanks: uniqueSorted(records.map(record => record.expectedSourceBankHex)),
      observedActiveBanks: uniqueSorted(records.map(record => record.observedActiveBankHex)),
      regionIds: records.map(record => record.regionId),
      ...forbiddenCounters,
    },
    records,
    observationInput,
    observationAuditSummary: observationAudit.summary,
    observationPlanCompleteness: observationAudit.planCompleteness,
    evidence: [
      'Existing MCP logical watch observations and mapper-state tracking can derive candidate physical source regions without persisting protected bytes.',
      'For r2815-r2817, the derived physical source points at r0754, not the bank-7 residual target regions.',
      'The generated observations are candidate-only and incomplete for closure until same-frame parser-entry context or native physical-source callback evidence is captured.',
    ],
    nextLeads: [
      'Capture residual_palette_parser_entry in the same trace group as the physical-source tail watch candidate.',
      'Replace derived physical-source candidates with emulator-native physical_rom_offset/physical_rom_region_id fields when the MCP bridge exposes them.',
      'Run the closure pipeline only after the candidate-only input is replaced by reviewed real runtime observations.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'physical_source_candidate_source' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpPhysicalSourceCandidateAudit = {
      catalogId,
      kind: 'gearsystem_mcp_physical_source_candidate',
      status: record.status,
      expectedSourceBank: record.expectedSourceBankHex,
      observedActiveBank: record.observedActiveBankHex,
      logicalWatchAddress: record.logicalWatchAddress,
      derivedPhysicalRomOffset: record.derivedPhysicalRomOffset,
      derivedPhysicalRomRegionId: record.derivedPhysicalRomRegion?.id || null,
      physicalRegionMatchesSource: record.physicalRegionMatchesSource,
      bankContextMatchesSource: record.bankContextMatchesSource,
      physicalSourceDerivation: record.physicalSourceDerivation,
      physicalSourceEvidenceStrength: record.physicalSourceEvidenceStrength,
      currentPromotionGateAllowed: false,
      remainingClosureBlockers: record.remainingClosureBlockers,
      observationCandidateTraceId: record.tailObservationCandidate.same_frame_trace_id,
      summary: 'Derived physical-source candidate for the logical palette-tail watchpoint; useful for alias triage but not a replacement for native emulator physical-ROM-source evidence.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: record.regionId,
      status: record.status,
      derivedPhysicalRomOffset: record.derivedPhysicalRomOffset,
      derivedPhysicalRomRegionId: record.derivedPhysicalRomRegion?.id || null,
      currentPromotionGateAllowed: false,
    });
  }
  for (const aliasRegionId of catalog.summary.candidateLogicalAliasTargetRegionIds || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === aliasRegionId);
    if (!region) {
      missingRegions.push({ id: aliasRegionId, role: 'physical_source_candidate_alias_target' });
      continue;
    }
    const sourceRecords = catalog.records.filter(record => record.candidateLogicalAliasTargetRegionId === aliasRegionId);
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpPhysicalSourceCandidateAliasTargetAudit = {
      catalogId,
      kind: 'gearsystem_mcp_physical_source_candidate_alias_target',
      status: 'derived_alias_target_for_palette_tail_watchpoints',
      sourceRegionIds: sourceRecords.map(record => record.regionId),
      derivedPhysicalRomOffsets: sourceRecords.map(record => record.derivedPhysicalRomOffset),
      observedActiveBanks: uniqueSorted(sourceRecords.map(record => record.observedActiveBankHex)),
      confidence: 'medium_derived_candidate',
      summary: 'Candidate physical ROM source region for the palette-tail logical watchpoints when the observed mapper bank is applied.',
      evidence: sourceRecords.map(record =>
        `${record.regionId} logical watch ${record.logicalWatchAddress} with active bank ${record.observedActiveBankHex} derives ${record.derivedPhysicalRomOffset} in ${aliasRegionId}.`),
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: aliasRegionId,
      status: 'derived_alias_target_for_palette_tail_watchpoints',
      sourceRegionIds: sourceRecords.map(record => record.regionId),
    });
  }
  mapData.gearsystemMcpPhysicalSourceCandidateCatalogs = (mapData.gearsystemMcpPhysicalSourceCandidateCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpPhysicalSourceCandidateCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_physical_source_candidate_audit',
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
  staticMap.summary.gearsystemMcpPhysicalSourceCandidateCatalog = catalogId;
  staticMap.summary.gearsystemMcpPhysicalSourceCandidateTargetRegionCount = catalog.summary.targetRegionCount;
  staticMap.summary.gearsystemMcpPhysicalSourceCandidateAliasCandidateCount = catalog.summary.aliasCandidateCount;
  staticMap.summary.gearsystemMcpPhysicalSourceCandidateCurrentPromotionGateAllowedCount = catalog.summary.currentPromotionGateAllowedCount;
  staticMap.summary.gearsystemMcpPhysicalSourceCandidateObservationAuditCompletePlanCount = catalog.summary.observationAuditCompletePlanCount;
  staticMap.summary.gearsystemMcpPhysicalSourceCandidateCandidateOnlyRejectedByBundle = catalog.summary.candidateOnlyRejectedByBundle;
  staticMap.summary.gearsystemMcpPhysicalSourceCandidateMissingClosureHookIds = catalog.summary.missingClosureHookIds;
  staticMap.summary.gearsystemMcpPhysicalSourceCandidateAliasTargetRegionIds = catalog.summary.candidateLogicalAliasTargetRegionIds;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`gearsystemMcpPhysicalSourceCandidate${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-physical-source-candidate-catalog-2026-06-26 as derived alias evidence for r2815-r2817, but require native physical-ROM-source or parser-entry trace evidence before closure.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const observationsPath = resolveRepoPath(argValue('--observations-out')) || defaultObservationsPath;
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (!noWrite) {
    writeJson(outputPath, catalog);
    writeJson(observationsPath, catalog.observationInput);
  }
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
    observationsOutput: noWrite ? null : relative(observationsPath),
    catalogId,
    summary: catalog.summary,
    changedRegions: result.changedRegions,
    missingRegions: result.missingRegions,
    assetPolicy: catalog.assetPolicy,
  }, null, 2));
}

main();
