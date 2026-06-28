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
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const setupPlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-setup-plan.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-physical-source-byte-compare-plan.local.json');
const physicalSourceCandidateCatalogId = 'world-gearsystem-mcp-physical-source-candidate-catalog-2026-06-26';
const catalogId = 'world-gearsystem-mcp-physical-source-byte-compare-plan-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-physical-source-byte-compare-plan-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-physical-source-byte-compare-plan-audit.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;
const targetRegionIds = ['r2815', 'r2816', 'r2817'];
const fullRomAreaId = 16;
const mappedSlotAreaId = 6;
const mappedSlotName = 'ROM2';
const defaultMaxCompareLength = 32;

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
  'persistedHashCount',
];

function hasArg(name) {
  return process.argv.includes(name);
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

function forbiddenCounters() {
  return Object.fromEntries(forbiddenCounterNames.map(name => [name, 0]));
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

function regionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function readOperationByRegion(setupPlan) {
  const out = new Map();
  for (const operation of setupPlan.operations || []) {
    if (operation.kind !== 'read_range_breakpoint') continue;
    const regionId = operation.source?.regionId || operation.regionIds?.[0];
    if (!targetRegionIds.includes(regionId)) continue;
    out.set(regionId, operation);
  }
  return out;
}

function candidateRecordByRegion(catalog) {
  return new Map((catalog.records || []).map(record => [record.regionId, record]));
}

function bankCountForRom(rom) {
  return Math.floor(rom.length / 0x4000);
}

function compareSlices(rom, a, b, length) {
  let differingPositionCount = 0;
  let firstDifferingIndex = null;
  for (let index = 0; index < length; index++) {
    if (rom[a + index] === rom[b + index]) continue;
    differingPositionCount += 1;
    if (firstDifferingIndex === null) firstDifferingIndex = index;
  }
  return {
    equal: differingPositionCount === 0,
    differingPositionCount,
    firstDifferingIndex,
  };
}

function matchingBankOffsetsForSlice(rom, sourceOffset, logicalSlotOffset, length) {
  const bankCount = bankCountForRom(rom);
  const matches = [];
  for (let bank = 0; bank < bankCount; bank++) {
    const candidateOffset = bank * 0x4000 + logicalSlotOffset;
    if (candidateOffset < 0 || candidateOffset + length > rom.length) continue;
    if (compareSlices(rom, sourceOffset, candidateOffset, length).equal) {
      matches.push({
        bank,
        bankHex: hex(bank, 2),
        physicalRomOffset: hex(candidateOffset, 5),
      });
    }
  }
  return matches;
}

function buildRecord(mapData, setupOperations, candidateByRegion, rom, regionId, options = {}) {
  const region = regionById(mapData, regionId);
  const operation = setupOperations.get(regionId);
  const candidate = candidateByRegion.get(regionId);
  const sourceOffset = regionStart(region);
  const regionSize = parseNumber(region?.size) || 0;
  const logicalStart = parseNumber(operation?.source?.logicalStartAddress || operation?.arguments?.start_address);
  const logicalSlotOffset = logicalStart === null ? null : logicalStart - 0x8000;
  const expectedBank = Math.floor(sourceOffset / 0x4000);
  const aliasOffset = parseNumber(candidate?.derivedPhysicalRomOffset);
  const aliasRegion = containingRegion(mapData, aliasOffset);
  const maxCompareLength = Math.max(1, Number(options.maxCompareLength || defaultMaxCompareLength));
  const compareLength = Math.max(0, Math.min(regionSize, maxCompareLength));
  const canCompare = sourceOffset !== null &&
    aliasOffset !== null &&
    logicalSlotOffset !== null &&
    compareLength > 0 &&
    sourceOffset + compareLength <= rom.length &&
    aliasOffset + compareLength <= rom.length;
  const targetAliasDiff = canCompare
    ? compareSlices(rom, sourceOffset, aliasOffset, compareLength)
    : { equal: false, differingPositionCount: 0, firstDifferingIndex: null };
  const expectedSliceMatches = canCompare
    ? matchingBankOffsetsForSlice(rom, sourceOffset, logicalSlotOffset, compareLength)
    : [];
  const aliasSliceMatches = canCompare
    ? matchingBankOffsetsForSlice(rom, aliasOffset, logicalSlotOffset, compareLength)
    : [];
  const expectedMatchRegionIds = expectedSliceMatches
    .map(match => containingRegion(mapData, parseNumber(match.physicalRomOffset))?.id)
    .filter(Boolean);
  const aliasMatchRegionIds = aliasSliceMatches
    .map(match => containingRegion(mapData, parseNumber(match.physicalRomOffset))?.id)
    .filter(Boolean);
  const status = !canCompare
    ? 'byte_compare_plan_unavailable'
    : targetAliasDiff.equal
      ? 'byte_compare_cannot_distinguish_target_and_alias'
      : expectedSliceMatches.length === 1 && aliasSliceMatches.length === 1
        ? 'byte_compare_can_distinguish_target_and_alias'
        : 'byte_compare_distinguishes_target_alias_but_slice_has_bank_aliases';
  return {
    regionId,
    status,
    sourceRegion: compactRegion(region),
    readRangeOperationId: operation?.id || null,
    logicalWatchRange: {
      start: operation?.source?.logicalStartAddress || operation?.arguments?.start_address || null,
      endInclusive: operation?.source?.logicalEndAddress || operation?.arguments?.end_address || null,
      mappedSlotAreaId,
      mappedSlotName,
      mappedSlotOffset: logicalSlotOffset === null ? null : hex(logicalSlotOffset, 4),
    },
    expectedSource: {
      bank: expectedBank,
      bankHex: hex(expectedBank, 2),
      physicalRomOffset: hex(sourceOffset, 5),
      regionId,
    },
    currentAliasCandidate: {
      physicalRomOffset: hex(aliasOffset, 5),
      regionId: aliasRegion?.id || null,
      type: aliasRegion?.type || null,
      bank: aliasOffset === null ? null : Math.floor(aliasOffset / 0x4000),
      bankHex: aliasOffset === null ? null : hex(Math.floor(aliasOffset / 0x4000), 2),
    },
    comparePlan: {
      compareLength,
      maxCompareLength,
      fullRomAreaId,
      mappedSlotAreaId,
      mappedSlotName,
      readMappedSlotArguments: logicalSlotOffset === null
        ? null
        : {
            area: mappedSlotAreaId,
            offset: hex(logicalSlotOffset, 4),
            size: compareLength,
          },
      comparePolicy: 'read mapped slot bytes transiently, compare to local/full ROM candidates transiently, persist only matching banks/offsets/region ids and distinctness counts',
    },
    targetAliasComparison: {
      canCompare,
      targetAliasDistinct: canCompare ? !targetAliasDiff.equal : false,
      differingPositionCount: targetAliasDiff.differingPositionCount,
      firstDifferingIndex: targetAliasDiff.firstDifferingIndex,
    },
    expectedSliceMatches: {
      matchCount: expectedSliceMatches.length,
      banks: expectedSliceMatches.map(match => match.bankHex),
      physicalRomOffsets: expectedSliceMatches.map(match => match.physicalRomOffset),
      regionIds: uniqueSorted(expectedMatchRegionIds),
      uniqueBank: expectedSliceMatches.length === 1,
    },
    aliasSliceMatches: {
      matchCount: aliasSliceMatches.length,
      banks: aliasSliceMatches.map(match => match.bankHex),
      physicalRomOffsets: aliasSliceMatches.map(match => match.physicalRomOffset),
      regionIds: uniqueSorted(aliasMatchRegionIds),
      uniqueBank: aliasSliceMatches.length === 1,
    },
    closureUse: {
      canResolvePhysicalSourceFromLiveMappedSlotCompare: canCompare && !targetAliasDiff.equal,
      safeForAutomaticPromotion: false,
      requiresReviewedRuntimeHit: true,
      requiresSameFrameParserEntry: true,
    },
    evidence: [
      `${physicalSourceCandidateCatalogId} derives ${regionId} logical watchpoint to ${aliasRegion?.id || 'unknown'} using the observed active bank.`,
      canCompare
        ? `A transient ${compareLength}-byte compare can test the mapped ${mappedSlotName} slot against FULL ROM candidate offsets without persisting bytes.`
        : 'The local ROM and setup metadata are insufficient to build a transient byte-compare plan for this region.',
      canCompare && !targetAliasDiff.equal
        ? `The expected bank-7 slice and current alias slice differ at ${targetAliasDiff.differingPositionCount} compared position(s); no byte values are persisted.`
        : 'The expected slice and alias slice are not distinguishable by this compare window.',
    ],
  };
}

function assetPolicy() {
  return 'Metadata only: region ids, ROM offsets, bank ids, logical addresses, memory-area ids, compare lengths, distinct/ambiguous counts, booleans, commands, sanitized MCP call summaries, and evidence text. The tool may compare local ROM bytes and live mapped-slot bytes transiently, but persists no ROM bytes, byte arrays, decoded assets, hashes, stream bytes, tile ids, palette values, VDP port values, register traces, pixels, screenshots, instruction bytes, audio bytes, or samples.';
}

function buildCatalog(mapData, setupPlan, rom, options = {}) {
  const physicalSourceCandidates = requireCatalog(mapData, physicalSourceCandidateCatalogId);
  const setupOperations = readOperationByRegion(setupPlan);
  const candidateByRegion = candidateRecordByRegion(physicalSourceCandidates);
  const records = targetRegionIds.map(regionId =>
    buildRecord(mapData, setupOperations, candidateByRegion, rom, regionId, options));
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    eventKind: 'wb3_gearsystem_mcp_physical_source_byte_compare_plan_audit',
    sourceCatalogs: [physicalSourceCandidateCatalogId],
    sourceFiles: [
      'projects/WORLD/map.json',
      'gearsystem/world-residual-mcp-setup-plan.json',
      'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms',
    ],
    assetPolicy: assetPolicy(),
    summary: {
      targetRegionCount: records.length,
      liveExecutionAdapterReady: true,
      comparePlanReadyCount: records.filter(record => record.targetAliasComparison.canCompare).length,
      targetAliasDistinctCount: records.filter(record => record.targetAliasComparison.targetAliasDistinct).length,
      uniqueExpectedSliceCount: records.filter(record => record.expectedSliceMatches.uniqueBank).length,
      uniqueAliasSliceCount: records.filter(record => record.aliasSliceMatches.uniqueBank).length,
      liveMappedSlotCompareCanResolveCount: records.filter(record => record.closureUse.canResolvePhysicalSourceFromLiveMappedSlotCompare).length,
      liveReportSupportsSameFrameTraceId: true,
      safeForAutomaticPromotionCount: 0,
      requiresReviewedRuntimeHitCount: records.length,
      requiresSameFrameParserEntryCount: records.length,
      fullRomAreaId,
      mappedSlotAreaId,
      mappedSlotName,
      maxCompareLength: Math.max(1, Number(options.maxCompareLength || defaultMaxCompareLength)),
      regionIds: records.map(record => record.regionId),
      candidateAliasRegionIds: uniqueSorted(records.map(record => record.currentAliasCandidate.regionId)),
      ...forbiddenCounters(),
    },
    records,
    commands: {
      plan: 'node tools/world-gearsystem-mcp-physical-source-byte-compare-plan-audit.mjs --out tmp/world-gearsystem-mcp-physical-source-byte-compare-plan.local.json',
      executeLiveCompareR2815: 'node tools/world-gearsystem-mcp-physical-source-byte-compare-plan-audit.mjs --execute --region r2815 --out tmp/world-gearsystem-mcp-physical-source-byte-compare-live.local.json',
      executeLiveCompareR2815WithTraceId: 'node tools/world-gearsystem-mcp-physical-source-byte-compare-plan-audit.mjs --execute --region r2815 --same-frame-trace-id <same_frame_trace_id> --out tmp/world-gearsystem-mcp-physical-source-byte-compare-live.local.json',
      executeLiveCompareAll: 'node tools/world-gearsystem-mcp-physical-source-byte-compare-plan-audit.mjs --execute --out tmp/world-gearsystem-mcp-physical-source-byte-compare-live.local.json',
      liveCapturePrereq: 'Run Gearsystem MCP to a palette-tail read breakpoint, then read mapped slot ROM2 transiently and compare against FULL ROM candidates; persist only the matched physical_rom_offset/physical_rom_region_id.',
      closureAfterReview: 'node tools/world-residual-runtime-closure-pipeline-audit.mjs --observations tmp/local-hook-observations.json --region r2815 --out tmp/world-residual-runtime-closure-pipeline.local.json',
    },
    evidence: [
      'The audit performs local ROM byte comparisons only transiently and records no byte values or hashes.',
      'The compare plan is designed to resolve whether a live mapped ROM2 read corresponds to the expected bank-7 residual region or the derived bank-8 alias region.',
      'The result is a capture plan and ambiguity analysis only; it does not promote residuals or write runtime proof metadata.',
    ],
    nextLeads: [
      'Run the live MCP byte-compare command while paused at a palette-tail read breakpoint to record only the matching physical source metadata.',
      'Combine physical source metadata with the parser-entry observation in the same trace group before closure.',
      'Keep r2815-r2817 quarantined until reviewed observations pass the residual closure pipeline.',
    ],
  };
}

async function rpc(baseUrl, method, params = {}) {
  try {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 1000000),
        method,
        params,
      }),
    });
    let json = null;
    try {
      const text = await response.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok && !json?.error,
      status: response.status,
      json,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      json: {
        error: {
          message: 'fetch failed',
        },
      },
    };
  }
}

async function callTool(baseUrl, name, args = {}) {
  return rpc(baseUrl, 'tools/call', {
    name,
    arguments: args,
  });
}

function parseToolTextJson(result) {
  const text = result.json?.result?.content?.find(item => item?.type === 'text')?.text || '{}';
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function sanitizeRpcResult(result) {
  const json = result.json || {};
  const content = Array.isArray(json.result?.content) ? json.result.content : [];
  return {
    ok: result.ok === true,
    status: result.status,
    hasResult: Boolean(json.result),
    resultKeys: json.result && typeof json.result === 'object' ? Object.keys(json.result).sort() : [],
    contentItemCount: content.length,
    contentTypes: uniqueSorted(content.map(item => item?.type)),
    errorCode: json.error?.code ?? null,
    errorMessage: json.error?.message || null,
  };
}

function arraysFromUnknown(value) {
  if (!value || typeof value !== 'object') return [];
  const arrays = [];
  if (Array.isArray(value)) arrays.push(value);
  for (const key of ['data', 'values', 'memory', 'bytes']) {
    if (Array.isArray(value[key])) arrays.push(value[key]);
  }
  return arrays;
}

function mappedBytesFromReadMemoryResult(result, expectedSize) {
  if (!result.ok) {
    return {
      ok: false,
      status: 'read_memory_failed',
      bytes: [],
      observedByteCount: 0,
    };
  }
  const parsed = parseToolTextJson(result);
  const arrays = arraysFromUnknown(parsed);
  const source = arrays.find(array => array.length >= expectedSize);
  if (!source) {
    return {
      ok: false,
      status: 'read_memory_shape_unrecognized',
      bytes: [],
      observedByteCount: 0,
    };
  }
  const bytes = source.slice(0, expectedSize).map(value => Number(value));
  if (bytes.length !== expectedSize || bytes.some(value => !Number.isFinite(value) || value < 0 || value > 255)) {
    return {
      ok: false,
      status: 'read_memory_values_not_byte_scalars',
      bytes: [],
      observedByteCount: bytes.length,
    };
  }
  return {
    ok: true,
    status: 'mapped_slot_bytes_read_transiently',
    bytes,
    observedByteCount: bytes.length,
  };
}

function compareMappedBytesToRom(mappedBytes, rom, logicalSlotOffset) {
  const bankCount = bankCountForRom(rom);
  const matches = [];
  for (let bank = 0; bank < bankCount; bank++) {
    const physicalOffset = bank * 0x4000 + logicalSlotOffset;
    if (physicalOffset < 0 || physicalOffset + mappedBytes.length > rom.length) continue;
    let equal = true;
    for (let index = 0; index < mappedBytes.length; index++) {
      if (rom[physicalOffset + index] === mappedBytes[index]) continue;
      equal = false;
      break;
    }
    if (equal) {
      matches.push({
        bank,
        bankHex: hex(bank, 2),
        physicalRomOffset: hex(physicalOffset, 5),
      });
    }
  }
  return matches;
}

function regionFiltersFromArgs() {
  const indexValues = [];
  process.argv.forEach((arg, index) => {
    if ((arg === '--region' || arg === '--regions') && process.argv[index + 1]) {
      indexValues.push(...String(process.argv[index + 1]).split(','));
    }
  });
  return uniqueSorted(indexValues.map(value => value.trim()).filter(Boolean));
}

function sameFrameTraceIdOptionsFromArgs() {
  const byRegion = new Map();
  let globalTraceId = null;
  for (const value of [...argValues('--same-frame-trace-id'), ...argValues('--trace-id')]) {
    const text = String(value || '').trim();
    if (!text) continue;
    const splitAt = text.indexOf('=');
    if (splitAt > 0) {
      const regionId = text.slice(0, splitAt).trim();
      const traceId = text.slice(splitAt + 1).trim();
      if (regionId && traceId) byRegion.set(regionId, traceId);
    } else {
      globalTraceId = text;
    }
  }
  return { byRegion, globalTraceId };
}

function sameFrameTraceInfoForRecord(record, selectedRecords, options = {}) {
  const byRegion = options.sameFrameTraceIdsByRegion || new Map();
  if (byRegion.has(record.regionId)) {
    return {
      same_frame_trace_id: byRegion.get(record.regionId),
      sameFrameTraceIdSource: 'reviewed_cli_region_mapping',
    };
  }
  if (options.sameFrameTraceId && selectedRecords.length === 1) {
    return {
      same_frame_trace_id: options.sameFrameTraceId,
      sameFrameTraceIdSource: 'reviewed_cli_single_region',
    };
  }
  return {
    same_frame_trace_id: null,
    sameFrameTraceIdSource: 'none',
  };
}

async function executeLiveCompare(catalog, mapData, rom, options = {}) {
  const selectedRegionIds = options.regionIds?.length ? new Set(options.regionIds) : null;
  const selectedRecords = selectedRegionIds
    ? (catalog.records || []).filter(record => selectedRegionIds.has(record.regionId))
    : catalog.records || [];
  const baseUrl = options.baseUrl;
  const traceInfoByRegion = new Map(selectedRecords.map(record => [
    record.regionId,
    sameFrameTraceInfoForRecord(record, selectedRecords, options),
  ]));
  const sameFrameTraceIdProvidedCount = [...traceInfoByRegion.values()]
    .filter(info => info.same_frame_trace_id).length;
  const init = await rpc(baseUrl, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'wb3-world-physical-source-byte-compare-live', version: '1' },
  });
  const controlResults = [{ kind: 'initialize', result: sanitizeRpcResult(init) }];
  if (!init.ok) {
    return {
      id: `${catalogId}-live-report`,
      schemaVersion,
      generatedAt: now,
      tool: toolName,
      eventKind: 'wb3_gearsystem_mcp_physical_source_byte_compare_live_report',
      sourceCatalog: catalogId,
      executed: true,
      assetPolicy: assetPolicy(),
      summary: {
        status: 'initialize_failed',
        initialized: false,
        selectedRegionCount: selectedRecords.length,
        sameFrameTraceIdProvidedCount,
        readMemoryOkCount: 0,
        liveMatchRecordCount: 0,
        uniquePhysicalSourceMatchCount: 0,
        expectedRegionMatchCount: 0,
        aliasRegionMatchCount: 0,
        ambiguousMatchCount: 0,
        unresolvedMatchCount: selectedRecords.length,
        controlResultCount: controlResults.length,
        failedControlResultCount: 1,
        baseUrl,
        ...forbiddenCounters(),
      },
      records: selectedRecords.map(record => ({
        ...traceInfoByRegion.get(record.regionId),
        regionId: record.regionId,
        status: 'initialize_failed',
        readMappedSlotArguments: record.comparePlan.readMappedSlotArguments,
        matchedPhysicalSources: [],
        uniquePhysicalSource: false,
        physical_rom_offset: null,
        physical_rom_region_id: null,
      })),
      controlResults,
      evidence: ['Gearsystem MCP initialize failed; no memory was read.'],
    };
  }

  const records = [];
  for (const record of selectedRecords) {
    const traceInfo = traceInfoByRegion.get(record.regionId);
    const args = record.comparePlan.readMappedSlotArguments;
    if (!args) {
      records.push({
        ...traceInfo,
        regionId: record.regionId,
        status: 'read_plan_missing',
        readMappedSlotArguments: null,
        matchedPhysicalSources: [],
        uniquePhysicalSource: false,
        physical_rom_offset: null,
        physical_rom_region_id: null,
      });
      continue;
    }
    const readArgs = {
      area: Number(args.area),
      offset: parseNumber(args.offset),
      size: Number(args.size),
    };
    const readResult = await callTool(baseUrl, 'read_memory', readArgs);
    const readSummary = sanitizeRpcResult(readResult);
    const transient = mappedBytesFromReadMemoryResult(readResult, readArgs.size);
    const logicalSlotOffset = parseNumber(record.logicalWatchRange.mappedSlotOffset);
    const matches = transient.ok && logicalSlotOffset !== null
      ? compareMappedBytesToRom(transient.bytes, rom, logicalSlotOffset)
      : [];
    const matchedPhysicalSources = matches.map(match => {
      const offset = parseNumber(match.physicalRomOffset);
      const region = containingRegion(mapData, offset);
      return {
        bank: match.bank,
        bankHex: match.bankHex,
        physicalRomOffset: match.physicalRomOffset,
        physicalRomRegionId: region?.id || null,
        physicalRomRegionType: region?.type || null,
      };
    });
    const unique = matchedPhysicalSources.length === 1;
    const matched = unique ? matchedPhysicalSources[0] : null;
    const matchedExpected = matched?.physicalRomRegionId === record.expectedSource.regionId;
    const matchedAlias = matched?.physicalRomRegionId === record.currentAliasCandidate.regionId;
    records.push({
      ...traceInfo,
      regionId: record.regionId,
      status: !transient.ok
        ? transient.status
        : unique
          ? 'live_mapped_slot_unique_physical_source_match'
          : matchedPhysicalSources.length
            ? 'live_mapped_slot_ambiguous_physical_source_match'
            : 'live_mapped_slot_no_full_rom_match',
      readMappedSlotArguments: {
        area: readArgs.area,
        offset: hex(readArgs.offset, 4),
        size: readArgs.size,
      },
      readMemoryResult: readSummary,
      observedByteCount: transient.observedByteCount,
      matchedPhysicalSources,
      matchCount: matchedPhysicalSources.length,
      uniquePhysicalSource: unique,
      physical_rom_offset: matched?.physicalRomOffset || null,
      physical_rom_region_id: matched?.physicalRomRegionId || null,
      matchedExpectedSource: matchedExpected,
      matchedAliasCandidate: matchedAlias,
      expectedSource: record.expectedSource,
      currentAliasCandidate: record.currentAliasCandidate,
      closureUse: {
        canSupplyPhysicalSourceFields: unique,
        safeForAutomaticPromotion: false,
        requiresReviewedRuntimeHit: true,
        requiresSameFrameParserEntry: true,
      },
      evidence: [
        transient.ok
          ? `Mapped ${mappedSlotName} slot bytes were read transiently for ${record.regionId}; byte values were discarded before writing this report.`
          : `Mapped ${mappedSlotName} read failed or returned an unrecognized scalar shape for ${record.regionId}.`,
        unique
          ? `The transient mapped-slot slice matched exactly one FULL ROM candidate: ${matched.physicalRomOffset} in ${matched.physicalRomRegionId || 'unknown region'}.`
          : 'The transient mapped-slot slice did not resolve to a unique physical source.',
      ],
    });
  }

  const uniqueRecords = records.filter(record => record.uniquePhysicalSource);
  const failedControlResultCount = controlResults.filter(item => item.result?.ok !== true).length;
  return {
    id: `${catalogId}-live-report`,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    eventKind: 'wb3_gearsystem_mcp_physical_source_byte_compare_live_report',
    sourceCatalog: catalogId,
    executed: true,
    assetPolicy: assetPolicy(),
    summary: {
      status: 'live_compare_executed',
      initialized: true,
      selectedRegionCount: selectedRecords.length,
      sameFrameTraceIdProvidedCount,
      readMemoryOkCount: records.filter(record => record.readMemoryResult?.ok === true).length,
      liveMatchRecordCount: records.filter(record => record.matchCount > 0).length,
      uniquePhysicalSourceMatchCount: uniqueRecords.length,
      expectedRegionMatchCount: records.filter(record => record.matchedExpectedSource).length,
      aliasRegionMatchCount: records.filter(record => record.matchedAliasCandidate).length,
      ambiguousMatchCount: records.filter(record => record.matchCount > 1).length,
      unresolvedMatchCount: records.filter(record => !record.uniquePhysicalSource).length,
      controlResultCount: controlResults.length,
      failedControlResultCount,
      baseUrl,
      ...forbiddenCounters(),
    },
    records,
    controlResults,
    evidence: [
      'Mapped slot bytes, if read, were used only transiently for comparison and are not present in this report.',
      'same_frame_trace_id is optional reviewed operator metadata used only to align this physical-source report with parser-entry and tail-watch observations.',
      'Unique physical-source matches still require review and same-frame parser-entry context before residual closure.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = regionById(mapData, record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'physical_source_byte_compare_target' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpPhysicalSourceByteComparePlanAudit = {
      catalogId,
      kind: 'gearsystem_mcp_physical_source_byte_compare_plan',
      status: record.status,
      readRangeOperationId: record.readRangeOperationId,
      logicalWatchRange: record.logicalWatchRange,
      expectedSource: record.expectedSource,
      currentAliasCandidate: record.currentAliasCandidate,
      comparePlan: record.comparePlan,
      targetAliasComparison: record.targetAliasComparison,
      expectedSliceMatches: record.expectedSliceMatches,
      aliasSliceMatches: record.aliasSliceMatches,
      canResolvePhysicalSourceFromLiveMappedSlotCompare: record.closureUse.canResolvePhysicalSourceFromLiveMappedSlotCompare,
      liveExecutionAdapterReady: true,
      liveReportSupportsSameFrameTraceId: true,
      safeForAutomaticPromotion: false,
      requiresReviewedRuntimeHit: true,
      requiresSameFrameParserEntry: true,
      summary: 'Transient byte-compare plan for resolving the physical ROM source of a live palette-tail read; no byte values or hashes are persisted.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      status: record.status,
      targetAliasDistinct: record.targetAliasComparison.targetAliasDistinct,
      canResolvePhysicalSourceFromLiveMappedSlotCompare: record.closureUse.canResolvePhysicalSourceFromLiveMappedSlotCompare,
    });
  }

  for (const aliasRegionId of catalog.summary.candidateAliasRegionIds || []) {
    const aliasRegion = regionById(mapData, aliasRegionId);
    if (!aliasRegion) {
      missingRegions.push({ id: aliasRegionId, role: 'physical_source_byte_compare_alias_target' });
      continue;
    }
    aliasRegion.analysis = aliasRegion.analysis || {};
    const sourceRecords = catalog.records.filter(record => record.currentAliasCandidate.regionId === aliasRegionId);
    aliasRegion.analysis.gearsystemMcpPhysicalSourceByteCompareAliasAudit = {
      catalogId,
      kind: 'gearsystem_mcp_physical_source_byte_compare_alias_target',
      status: 'byte_compare_alias_candidate_for_palette_tail_watchpoints',
      sourceRegionIds: sourceRecords.map(record => record.regionId),
      aliasPhysicalRomOffsets: sourceRecords.map(record => record.currentAliasCandidate.physicalRomOffset),
      targetAliasDistinctCount: sourceRecords.filter(record => record.targetAliasComparison.targetAliasDistinct).length,
      summary: 'Alias target participates in the transient byte-compare plan for palette-tail physical source resolution.',
      evidence: sourceRecords.map(record =>
        `${record.regionId} can compare expected ${record.expectedSource.physicalRomOffset} against alias ${record.currentAliasCandidate.physicalRomOffset} without persisting bytes.`),
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: aliasRegion.id,
      status: 'byte_compare_alias_candidate_for_palette_tail_watchpoints',
    });
  }

  mapData.gearsystemMcpPhysicalSourceByteComparePlanCatalogs = (mapData.gearsystemMcpPhysicalSourceByteComparePlanCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpPhysicalSourceByteComparePlanCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_physical_source_byte_compare_plan_audit',
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
  staticMap.summary.gearsystemMcpPhysicalSourceByteComparePlanCatalog = catalogId;
  staticMap.summary.gearsystemMcpPhysicalSourceByteCompareLiveExecutionAdapterReady = catalog.summary.liveExecutionAdapterReady === true;
  staticMap.summary.gearsystemMcpPhysicalSourceByteCompareLiveReportSupportsSameFrameTraceId = catalog.summary.liveReportSupportsSameFrameTraceId === true;
  staticMap.summary.gearsystemMcpPhysicalSourceByteComparePlanReadyCount = catalog.summary.comparePlanReadyCount;
  staticMap.summary.gearsystemMcpPhysicalSourceByteCompareTargetAliasDistinctCount = catalog.summary.targetAliasDistinctCount;
  staticMap.summary.gearsystemMcpPhysicalSourceByteCompareLiveMappedSlotResolveCount = catalog.summary.liveMappedSlotCompareCanResolveCount;
  staticMap.summary.gearsystemMcpPhysicalSourceByteCompareMappedSlotAreaId = catalog.summary.mappedSlotAreaId;
  staticMap.summary.gearsystemMcpPhysicalSourceByteCompareMappedSlotName = catalog.summary.mappedSlotName;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`gearsystemMcpPhysicalSourceByteCompare${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-physical-source-byte-compare-plan-catalog-2026-06-26 to resolve palette-tail physical source with transient mapped-slot byte comparison while persisting no bytes.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

async function main() {
  const execute = hasArg('--execute');
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const maxCompareLength = Number(argValue('--max-compare-length') || defaultMaxCompareLength);
  const baseUrl = argValue('--url') || `http://${argValue('--address') || '127.0.0.1'}:${argValue('--port') || '7777'}`;
  const regionIds = regionFiltersFromArgs();
  const sameFrameTraceIds = sameFrameTraceIdOptionsFromArgs();
  const mapData = readJson(mapPath);
  const setupPlan = readJson(setupPlanPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, setupPlan, rom, { maxCompareLength });
  const output = execute
    ? await executeLiveCompare(catalog, mapData, rom, {
        baseUrl,
        regionIds,
        sameFrameTraceId: sameFrameTraceIds.globalTraceId,
        sameFrameTraceIdsByRegion: sameFrameTraceIds.byRegion,
      })
    : catalog;
  let annotation = { changedRegions: [], missingRegions: [] };
  if (apply) {
    annotation = applyCatalog(mapData, catalog);
    if (!noWrite) {
      writeJson(mapPath, mapData);
      updateStaticMap(catalog);
    }
  }
  if (!noWrite) writeJson(outputPath, output);
  console.log(JSON.stringify({
    ok: execute ? output.summary?.status !== 'initialize_failed' : true,
    executed: execute,
    applied: apply,
    output: noWrite ? null : relative(outputPath),
    catalogId,
    summary: output.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    assetPolicy: output.assetPolicy,
  }, null, 2));
  if (execute && output.summary?.status === 'initialize_failed') process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    ...forbiddenCounters(),
  }, null, 2));
  process.exitCode = 1;
});
