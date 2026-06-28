#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const setupPlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-setup-plan.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-palette-tail-bank-context.local.json');
const mapperTrackerCatalogId = 'world-gearsystem-mcp-mapper-state-tracker-catalog-2026-06-26';
const paletteTailObservationCatalogId = 'world-gearsystem-mcp-palette-tail-observation-catalog-2026-06-26';
const catalogId = 'world-gearsystem-mcp-palette-tail-bank-context-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-palette-tail-bank-context-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-palette-tail-bank-context-audit.mjs';
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

function readJsonIfExists(filePath, fallback) {
  return fs.existsSync(filePath) ? readJson(filePath) : fallback;
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
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^0x[0-9a-f]+$/i.test(trimmed)) return parseInt(trimmed, 16);
  if (/^[0-9]+$/.test(trimmed)) return parseInt(trimmed, 10);
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

function operationRegionIds(operation) {
  return [
    operation.source?.regionId,
    ...(operation.source?.regionIds || []),
    ...(operation.regionIds || []),
  ].filter(Boolean);
}

function setupOperationsByRegion(setupPlan) {
  const byRegion = new Map();
  for (const operation of setupPlan.operations || []) {
    if (!(operation.source?.hookIds || []).includes('residual_palette_tail_cursor_watch')) continue;
    for (const regionId of operationRegionIds(operation)) {
      if (!byRegion.has(regionId)) byRegion.set(regionId, []);
      byRegion.get(regionId).push(operation);
    }
  }
  return byRegion;
}

function regionStart(region) {
  return parseNumber(region?.offset);
}

function regionEndExclusive(region) {
  const start = regionStart(region);
  const size = parseNumber(region?.size);
  return start === null || size === null ? null : start + size;
}

function bankFromOffset(offset) {
  return offset === null ? null : Math.floor(offset / 0x4000);
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

function activeBankPhysicalOffset(logicalAddress, activeBank) {
  if (logicalAddress === null || activeBank === null) return null;
  if (logicalAddress >= 0x8000 && logicalAddress <= 0xBFFF) {
    return activeBank * 0x4000 + (logicalAddress - 0x8000);
  }
  return null;
}

function compactSetupOperation(operation) {
  if (!operation) return null;
  return {
    operationId: operation.id || null,
    sourceBank: operation.source?.bank || null,
    logicalStartAddress: operation.source?.logicalStartAddress || operation.arguments?.start_address || null,
    logicalEndAddress: operation.source?.logicalEndAddress || operation.arguments?.end_address || null,
    romStartOffset: operation.source?.romStartOffset || null,
    romEndOffset: operation.source?.romEndOffset || null,
    labels: operation.source?.labels || [],
    hookIds: operation.source?.hookIds || [],
  };
}

function compactObservation(record) {
  const observation = record?.observation || {};
  return {
    hookId: observation.hookId || null,
    traceId: observation.same_frame_trace_id || null,
    active_bank: observation.active_bank ?? null,
    consumer_label: observation.consumer_label || null,
    cursor_offset: observation.cursor_offset || null,
    cursor_region_id: observation.cursor_region_id || null,
    access_role: observation.access_role || null,
    inside_palette_tail_region: observation.inside_palette_tail_region === true,
  };
}

function buildRecord(mapData, setupByRegion, mapperByRegion, paletteByRegion, regionId) {
  const region = (mapData.regions || []).find(candidate => candidate.id === regionId);
  const setupOperation = (setupByRegion.get(regionId) || [])[0] || null;
  const mapperRecord = mapperByRegion.get(regionId);
  const paletteRecord = paletteByRegion.get(regionId);
  const observation = compactObservation(paletteRecord);
  const setup = compactSetupOperation(setupOperation);
  const sourceBank = parseNumber(setup?.sourceBank);
  const start = regionStart(region);
  const expectedBank = sourceBank ?? bankFromOffset(start);
  const logicalStart = parseNumber(setup?.logicalStartAddress || mapperRecord?.logicalStart);
  const logicalEnd = parseNumber(setup?.logicalEndAddress || setup?.logicalStartAddress || mapperRecord?.logicalStart);
  const observedActiveBank = parseNumber(mapperRecord?.active_bank ?? observation.active_bank);
  const bankAgreement = expectedBank !== null && observedActiveBank !== null && expectedBank === observedActiveBank;
  const candidatePhysicalStart = activeBankPhysicalOffset(logicalStart, observedActiveBank);
  const candidatePhysicalEnd = activeBankPhysicalOffset(logicalEnd, observedActiveBank);
  const candidateRegion = containingRegion(mapData, candidatePhysicalStart);
  const samePhysicalRegion = candidateRegion?.id === regionId;
  const hasMismatch = expectedBank !== null && observedActiveBank !== null && !bankAgreement;
  const candidateAlias = hasMismatch && candidateRegion && !samePhysicalRegion;
  const promotionGateAllowed = bankAgreement &&
    observation.access_role === 'direct_consumer' &&
    observation.inside_palette_tail_region === true;
  const status = observedActiveBank === null
    ? 'tail_cursor_bank_context_missing_active_bank'
    : bankAgreement
      ? 'tail_cursor_bank_context_agrees_with_source_region'
      : 'tail_cursor_observed_with_bank_context_mismatch';
  const candidateRange = candidatePhysicalStart === null
    ? null
    : {
      start: hex(candidatePhysicalStart, 5),
      endInclusive: hex(candidatePhysicalEnd ?? candidatePhysicalStart, 5),
    };
  return {
    regionId,
    status,
    sourceRegion: compactRegion(region),
    setupOperation: setup,
    observation,
    expectedSourceBank: expectedBank,
    expectedSourceBankHex: hex(expectedBank, 2),
    expectedBankSource: sourceBank === null ? 'region_offset' : 'gearsystem_setup_plan_source_bank',
    observedActiveBank,
    observedActiveBankHex: hex(observedActiveBank, 2),
    observedActiveBankSource: mapperRecord?.activeBankSource || null,
    bankAgreement,
    promotionGateAllowed,
    promotionBlockedReason: promotionGateAllowed
      ? null
      : hasMismatch
        ? 'observed_active_bank_does_not_match_expected_source_bank'
        : observation.access_role !== 'direct_consumer'
          ? 'tail_cursor_access_role_not_direct_consumer'
          : 'insufficient_bank_context',
    logicalWatchRange: logicalStart === null
      ? null
      : {
        start: hex(logicalStart, 4),
        endInclusive: hex(logicalEnd ?? logicalStart, 4),
      },
    candidatePhysicalRangeIfObservedBankMapsLogicalAddress: candidateRange,
    candidatePhysicalTargetRegion: compactRegion(candidateRegion),
    candidateLogicalAliasTargetRegionId: candidateAlias ? candidateRegion.id : null,
    candidateLogicalAliasTargetType: candidateAlias ? candidateRegion.type : null,
    needsPhysicalRomOffsetEvidence: !bankAgreement,
    evidence: [
      `${paletteTailObservationCatalogId} records a metadata-only cursor watch observation for ${regionId} with consumer ${observation.consumer_label || 'unknown'}.`,
      `${mapperTrackerCatalogId} records active_bank ${hex(observedActiveBank, 2) || 'unknown'} from transient mapper-write watchpoint state.`,
      setup?.sourceBank
        ? `gearsystem/world-residual-mcp-setup-plan.json expects source bank ${setup.sourceBank} for this watchpoint.`
        : 'The expected source bank was derived from the region offset.',
      candidateAlias
        ? `Applying active_bank ${hex(observedActiveBank, 2)} to the watched logical range points at ${candidateRegion.id}, not ${regionId}; this blocks promotion until a physical-ROM-offset callback confirms the real source.`
        : bankAgreement
          ? 'The observed active bank agrees with the expected source bank.'
          : 'The current observation lacks enough mapper context for promotion.',
    ],
  };
}

function buildCatalog(mapData) {
  const mapperCatalog = requireCatalog(mapData, mapperTrackerCatalogId);
  const paletteCatalog = requireCatalog(mapData, paletteTailObservationCatalogId);
  const setupPlan = readJsonIfExists(setupPlanPath, { operations: [] });
  const setupByRegion = setupOperationsByRegion(setupPlan);
  const mapperByRegion = recordByRegion(mapperCatalog);
  const paletteByRegion = recordByRegion(paletteCatalog);
  const records = targetRegionIds.map(regionId =>
    buildRecord(mapData, setupByRegion, mapperByRegion, paletteByRegion, regionId));
  const forbiddenCounters = Object.fromEntries(forbiddenCounterNames.map(name => [name, 0]));
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    eventKind: 'wb3_gearsystem_mcp_palette_tail_bank_context_audit',
    sourceCatalogs: [mapperTrackerCatalogId, paletteTailObservationCatalogId],
    sourceFiles: ['gearsystem/world-residual-mcp-setup-plan.json'],
    assetPolicy: 'Metadata-only bank-context audit: region ids, offsets, bank ids, logical addresses, labels, booleans, counts, and derived candidate physical offsets. No ROM bytes, stream bytes, memory dumps, register traces, PC values, tile ids, palette values, VDP port values, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      targetRegionCount: records.length,
      activeBankObservedCount: records.filter(record => record.observedActiveBank !== null).length,
      bankAgreementCount: records.filter(record => record.bankAgreement).length,
      bankMismatchCount: records.filter(record => record.observedActiveBank !== null && !record.bankAgreement).length,
      promotionGateAllowedCount: records.filter(record => record.promotionGateAllowed).length,
      promotionBlockedCount: records.filter(record => !record.promotionGateAllowed).length,
      needsPhysicalRomOffsetEvidenceCount: records.filter(record => record.needsPhysicalRomOffsetEvidence).length,
      candidateLogicalAliasTargetRegionIds: uniqueSorted(records.map(record => record.candidateLogicalAliasTargetRegionId)),
      observedActiveBanks: uniqueSorted(records.map(record => record.observedActiveBankHex)),
      expectedSourceBanks: uniqueSorted(records.map(record => record.expectedSourceBankHex)),
      statuses: uniqueSorted(records.map(record => record.status)),
      regionIds: records.map(record => record.regionId),
      ...forbiddenCounters,
    },
    records,
    evidence: [
      'The existing residual evaluator requires same-bank direct-consumer evidence before r2815-r2817 can be promoted.',
      'The mapper-state tracker observed active_bank 0x08 for the target read hits while the setup plan source bank is 0x07.',
      'When active_bank 0x08 is applied to the watched logical addresses, the derived physical offsets land inside r0754 (_DATA_20000_, gfx_tiles).',
    ],
    nextLeads: [
      'Add an MCP callback or emulator debugger field that reports physical ROM offset for read breakpoints in mapped ROM.',
      'Re-run r2815-r2817 tail watchpoints and verify whether the physical source is bank 7 or the bank 8 r0754 graphics region.',
      'Do not create residual_runtime_promotion_gate observations for r2815-r2817 until the bank-context mismatch is resolved.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const aliasTargetRegionIds = uniqueSorted(catalog.records.map(record => record.candidateLogicalAliasTargetRegionId));

  for (const record of catalog.records || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'palette_tail_bank_context_source' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpPaletteTailBankContextAudit = {
      catalogId,
      kind: 'gearsystem_mcp_palette_tail_bank_context_audit',
      status: record.status,
      expectedSourceBank: record.expectedSourceBankHex,
      expectedBankSource: record.expectedBankSource,
      observedActiveBank: record.observedActiveBankHex,
      observedActiveBankSource: record.observedActiveBankSource,
      bankAgreement: record.bankAgreement,
      promotionGateAllowed: record.promotionGateAllowed,
      promotionBlockedReason: record.promotionBlockedReason,
      logicalWatchRange: record.logicalWatchRange,
      candidatePhysicalRangeIfObservedBankMapsLogicalAddress: record.candidatePhysicalRangeIfObservedBankMapsLogicalAddress,
      candidateLogicalAliasTargetRegionId: record.candidateLogicalAliasTargetRegionId,
      candidateLogicalAliasTargetType: record.candidateLogicalAliasTargetType,
      needsPhysicalRomOffsetEvidence: record.needsPhysicalRomOffsetEvidence,
      summary: record.bankAgreement
        ? 'Observed active bank agrees with the expected source bank; promotion still depends on direct-consumer access-role evidence.'
        : 'Observed active bank does not match the expected source bank, so this watchpoint is treated as bank-context unresolved and cannot promote the residual yet.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: record.regionId,
      status: record.status,
      expectedSourceBank: record.expectedSourceBankHex,
      observedActiveBank: record.observedActiveBankHex,
      candidateLogicalAliasTargetRegionId: record.candidateLogicalAliasTargetRegionId,
      promotionGateAllowed: record.promotionGateAllowed,
    });
  }

  for (const aliasRegionId of aliasTargetRegionIds) {
    const region = (mapData.regions || []).find(candidate => candidate.id === aliasRegionId);
    if (!region) {
      missingRegions.push({ id: aliasRegionId, role: 'palette_tail_bank_context_alias_target' });
      continue;
    }
    const sourceRecords = catalog.records.filter(record => record.candidateLogicalAliasTargetRegionId === aliasRegionId);
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpPaletteTailBankContextAliasTargetAudit = {
      catalogId,
      kind: 'gearsystem_mcp_palette_tail_bank_context_alias_target',
      status: 'candidate_logical_alias_target_for_tail_watchpoints',
      candidateSourceRegionIds: sourceRecords.map(record => record.regionId),
      observedActiveBanks: uniqueSorted(sourceRecords.map(record => record.observedActiveBankHex)),
      candidatePhysicalRanges: sourceRecords.map(record => record.candidatePhysicalRangeIfObservedBankMapsLogicalAddress),
      confidence: 'medium',
      summary: 'Candidate physical source region when the observed active bank is applied to r2815-r2817 logical watchpoint addresses; requires emulator physical-ROM-offset confirmation.',
      evidence: sourceRecords.map(record =>
        `${record.regionId} watchpoint used logical range ${record.logicalWatchRange?.start || 'unknown'}-${record.logicalWatchRange?.endInclusive || 'unknown'} with active bank ${record.observedActiveBankHex || 'unknown'}, deriving a candidate physical range in ${aliasRegionId}.`),
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: aliasRegionId,
      status: 'candidate_logical_alias_target_for_tail_watchpoints',
      candidateSourceRegionIds: sourceRecords.map(record => record.regionId),
    });
  }

  mapData.gearsystemMcpPaletteTailBankContextCatalogs = (mapData.gearsystemMcpPaletteTailBankContextCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpPaletteTailBankContextCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_palette_tail_bank_context_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceFiles: catalog.sourceFiles,
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
  staticMap.summary.gearsystemMcpPaletteTailBankContextCatalog = catalogId;
  staticMap.summary.gearsystemMcpPaletteTailBankContextTargetRegionCount = catalog.summary.targetRegionCount;
  staticMap.summary.gearsystemMcpPaletteTailBankContextBankMismatchCount = catalog.summary.bankMismatchCount;
  staticMap.summary.gearsystemMcpPaletteTailBankContextPromotionBlockedCount = catalog.summary.promotionBlockedCount;
  staticMap.summary.gearsystemMcpPaletteTailBankContextNeedsPhysicalRomOffsetEvidenceCount = catalog.summary.needsPhysicalRomOffsetEvidenceCount;
  staticMap.summary.gearsystemMcpPaletteTailBankContextCandidateLogicalAliasTargetRegionIds = catalog.summary.candidateLogicalAliasTargetRegionIds;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`gearsystemMcpPaletteTailBankContext${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Resolve the r2815-r2817 palette-tail bank-context mismatch with a physical-ROM-offset read breakpoint callback before residual promotion.';
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
