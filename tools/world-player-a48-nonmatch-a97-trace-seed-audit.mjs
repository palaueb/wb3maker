#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-player-a48-nonmatch-a97-trace-seed-audit.mjs';
const catalogId = 'world-player-a48-nonmatch-a97-trace-seed-catalog-2026-06-26';
const reportId = 'player-a48-nonmatch-a97-trace-seed-audit-2026-06-26';
const schemaVersion = 1;
const retainedRouteId = 'record_derived_998_or_dynamic_decode_path';
const rejectedRouteId = 'record_derived_8fb_path';
const rejectedCandidateId = 'candidate_8fb_1E337';
const rejectedCandidateRegionId = 'r0749';

const sourceCatalogIds = {
  false8fbGuard: 'world-player-a48-nonmatch-false-8fb-guard-catalog-2026-06-26',
  nonmatchDynamicRoute: 'world-player-a48-nonmatch-dynamic-route-catalog-2026-06-26',
  dynamicTileUpload: 'world-dynamic-tile-upload-catalog-2026-06-25',
  dynamicVdpUploadCaller: 'world-dynamic-vdp-upload-caller-catalog-2026-06-26',
  dynamicVdpBankVariable: 'world-dynamic-vdp-bank-variable-catalog-2026-06-26',
  playerA48DynamicSeedLink: 'world-player-a48-dynamic-seed-link-catalog-2026-06-26',
};

const ramTraceSeeds = [
  { symbol: '_RAM_D0E0_', address: '$D0E0', role: 'entity_dynamic_upload_record_selector_or_source_context', expectedUse: 'Capture before _LABEL_29E6_ calls _LABEL_A97_.', confidence: 'medium_high' },
  { symbol: '_RAM_D0E1_', address: '$D0E1', role: 'entity_dynamic_upload_vram_tile_slot_selector', expectedUse: 'Converted through _LABEL_B8F_ before the dynamic tile upload destination is written.', confidence: 'medium_high' },
  { symbol: '_RAM_D0E2_', address: '$D0E2', role: 'entity_dynamic_upload_selector_state', expectedUse: 'Capture with _RAM_D0E0_/_RAM_D0E1_ to identify the active entity/frame path.', confidence: 'medium' },
  { symbol: '_RAM_D0EC_', address: '$D0EC', role: 'dynamic_tile_remap_row_index', expectedUse: '_LABEL_A97_ uses it to select the _DATA_B4F_ remap row.', confidence: 'high' },
  { symbol: '_RAM_D0ED_', address: '$D0ED', role: 'dynamic_tile_uploaded_tile_count', expectedUse: 'Should increase by the tile count consumed by _LABEL_A97_ or _LABEL_A14_.', confidence: 'high' },
  { symbol: '_RAM_D0EE_', address: '$D0EE', role: 'tile_upload_source_pointer_low', expectedUse: 'Low byte of the source pointer emitted by _LABEL_9C3_.', confidence: 'high' },
  { symbol: '_RAM_D0EF_', address: '$D0EF', role: 'tile_upload_source_pointer_high', expectedUse: 'High byte of the source pointer emitted by _LABEL_9C3_.', confidence: 'high' },
  { symbol: '_RAM_D0F0_', address: '$D0F0', role: 'tile_upload_vram_destination_low', expectedUse: 'Destination byte address used for VDP upload provenance.', confidence: 'high' },
  { symbol: '_RAM_D0F1_', address: '$D0F1', role: 'tile_upload_vram_destination_high', expectedUse: 'Destination byte address used for VDP upload provenance.', confidence: 'high' },
  { symbol: '_RAM_D0F2_', address: '$D0F2', role: 'tile_loader_record_countdown', expectedUse: '_LABEL_9C3_ count field and upload loop countdown.', confidence: 'high' },
  { symbol: '_RAM_D0F3_', address: '$D0F3', role: 'record_derived_source_bank_latch', expectedUse: 'Expected to equal sourceRecordHighByte >> 1, which is 0x0B for these seeds.', confidence: 'high' },
  { symbol: '_RAM_FFFF_', address: '$FFFF', role: 'mapper_page2_bank_write', expectedUse: 'Expected mapper write is 0x0B before reading the source tile block.', confidence: 'high' },
  { symbol: '_RAM_DFFF_', address: '$DFFF', role: 'previous_mapper_bank_restore_context', expectedUse: 'Capture to prove bank restore context after dynamic upload.', confidence: 'medium' },
  { symbol: '_RAM_CF82_', address: '$CF82', role: 'vdp_write_active_flag', expectedUse: 'Should be set during VDP data-port writes and cleared afterward.', confidence: 'high' },
  { symbol: '_RAM_D116_', address: '$D116', role: 'dynamic_decode_row_pixel_counter', expectedUse: '_LABEL_A97_ uses it while remapping one decoded tile row.', confidence: 'high' },
];

const routineRoles = {
  r2100: 'primary_dynamic_decode_upload_routine',
  r2727: 'primary_loader_record_parser',
  r2726: 'alternate_raw_record_upload_wrapper',
  r2728: 'alternate_raw_tile_block_upload_routine',
  r1755: 'tile_index_to_byte_offset_helper',
  r2094: 'vdp_address_write_helper',
};

const callerRoles = {
  r2088: 'primary_entity_dynamic_decode_caller',
  r1765: 'alternate_item_record_loader_caller',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 2) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value.replace(/^\$/, '0x'), 16);
  return NaN;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function sumBy(items, valueFn) {
  return (items || []).reduce((sum, item) => sum + valueFn(item), 0);
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value != null && value !== ''))].sort((a, b) => {
    const aNum = parseOffset(a);
    const bNum = parseOffset(b);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    return String(a).localeCompare(String(b));
  });
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
  if (!catalog) throw new Error(`Missing required catalog: ${id}`);
  return catalog;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRamByAddress(mapData, address) {
  const normalized = String(address || '').toUpperCase().replace(/^0X/, '$');
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === normalized) || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function firstChunk(entry) {
  const chunk = entry.sourceRecordWordChunks?.[0];
  if (!chunk) throw new Error(`Entry ${entry.spanId} has no sourceRecordWordChunks[0]`);
  return chunk;
}

function routeEntriesBySpan(routeCatalog) {
  return new Map((routeCatalog.entries || []).map(entry => [entry.spanId, entry]));
}

function guardEntriesBySpan(guardCatalog) {
  return new Map((guardCatalog.entries || []).map(entry => [entry.spanId, entry]));
}

function compactRoutineFromRoute(routine) {
  return {
    label: routine.label,
    region: compactRegion(routine.region),
    role: routine.role,
    eventCounts: routine.eventCounts || {},
  };
}

function compactCallsite(callsite) {
  return {
    callerLabel: callsite.callerLabel,
    callerRegion: compactRegion(callsite.callerRegion),
    target: callsite.target,
    line: callsite.line,
    classification: callsite.classification,
    selectorState: callsite.selectorState || [],
    bankContext: callsite.bankContext,
  };
}

function compactCatalogRoutine(routine) {
  return {
    regionId: routine.regionId,
    label: routine.label,
    offset: routine.offset,
    role: routine.role,
    confidence: routine.confidence,
    evidence: routine.evidence || [],
  };
}

function compactCaller(callsiteOrCaller) {
  const classification = callsiteOrCaller.classification || {};
  return {
    line: callsiteOrCaller.line,
    target: callsiteOrCaller.target,
    callerLabel: callsiteOrCaller.callerLabel || callsiteOrCaller.label,
    callerRegion: compactRegion(callsiteOrCaller.callerRegion),
    role: callsiteOrCaller.role || classification.callerRole,
    classification: classification.kind || callsiteOrCaller.classification,
    confidence: callsiteOrCaller.confidence || classification.confidence,
    selectorState: classification.selectorState || callsiteOrCaller.selectorState || [],
    evidenceLines: classification.evidenceLines || [],
  };
}

function buildSourceRecord(chunk, range) {
  const sourceRecordHighByte = parseOffset(chunk.sourceRecordHighByte);
  const sourceBank = parseOffset(chunk.sourceBank);
  const derivedBank = Number.isFinite(sourceRecordHighByte) ? sourceRecordHighByte >> 1 : NaN;
  const tileBlockStart = parseOffset(chunk.tileBlockStart);
  const computedStart = Number.isFinite(sourceBank) && Number.isFinite(tileBlockStart)
    ? (sourceBank * 0x4000) + (tileBlockStart * 0x20)
    : NaN;

  return {
    sourceBank: chunk.sourceBank || hex(derivedBank),
    sourceRecordHighByte: chunk.sourceRecordHighByte,
    sourceRecordWordStart: chunk.sourceRecordWordStart,
    sourceRecordWordEndInclusive: chunk.sourceRecordWordEndInclusive,
    tileBlockStart: chunk.tileBlockStart,
    tileBlockEndExclusive: chunk.tileBlockEndExclusive,
    tileBlockCount: chunk.tileBlockCount,
    expectedD0F3: hex(derivedBank, 2),
    expectedMapperWrite: hex(derivedBank, 2),
    sourceBankFormula: 'sourceRecordHighByte >> 1',
    sourceRangeFormula: 'sourceBank * 0x4000 + tileBlockStart * 0x20',
    computedRangeStart: hex(computedStart, 5),
    computedRangeMatchesEntry: Number.isFinite(computedStart) && computedStart === parseOffset(range?.start),
  };
}

function buildEntry(guardEntry, routeEntry) {
  const chunk = firstChunk(guardEntry);
  const sourceRecord = buildSourceRecord(chunk, guardEntry.range);
  const retainedRoute = (routeEntry?.retainedRoutes || []).find(route => route.id === retainedRouteId);
  if (!retainedRoute) throw new Error(`Missing retained ${retainedRouteId} route for ${guardEntry.spanId}`);

  const primaryCallsite = (retainedRoute.callsites || []).find(callsite => callsite.target === '_LABEL_A97_') || null;
  const alternateCallsite = (retainedRoute.callsites || []).find(callsite => callsite.target === '_LABEL_99B_') || null;

  return {
    id: `${guardEntry.spanId}_a97_trace_seed`,
    spanId: guardEntry.spanId,
    region: guardEntry.region,
    range: guardEntry.range,
    nonblankTileCount: Number(guardEntry.range?.sizeBytes || 0) / 32,
    sourceRecord,
    retainedRoute: {
      id: retainedRouteId,
      confidence: 'medium_high',
      status: 'trace_seed_not_runtime_confirmed',
      primaryPath: ['_LABEL_9C3_', '_LABEL_A97_'],
      alternateRawPath: ['_LABEL_9C3_', '_LABEL_99B_', '_LABEL_A14_'],
      routines: (retainedRoute.routines || []).map(compactRoutineFromRoute),
      callsites: (retainedRoute.callsites || []).map(compactCallsite),
      primaryCallsite: primaryCallsite ? compactCallsite(primaryCallsite) : null,
      alternateCallsite: alternateCallsite ? compactCallsite(alternateCallsite) : null,
    },
    traceConditions: [
      {
        label: '_LABEL_9C3_',
        regionId: 'r2727',
        expectation: `Parser consumes a loader record with source word ${sourceRecord.sourceRecordWordStart} and derives _RAM_D0F3_ = ${sourceRecord.expectedD0F3}.`,
      },
      {
        label: '_LABEL_A97_',
        regionId: 'r2100',
        expectation: `_LABEL_A97_ switches through _RAM_D0F3_ = ${sourceRecord.expectedD0F3}, decodes/remaps rows, and writes the resulting tile slot to VDP.`,
      },
      {
        label: '_LABEL_99B_',
        regionId: 'r2726',
        expectation: 'Accept only as an alternate raw-record path if runtime state reaches _LABEL_99B_ with the same parsed source word and mapper bank.',
      },
      {
        label: '_RAM_FFFF_',
        regionId: null,
        expectation: `Mapper page-2 write must equal ${sourceRecord.expectedMapperWrite} before source bytes are read.`,
      },
    ],
    ramWatch: ramTraceSeeds.map(seed => ({
      symbol: seed.symbol,
      address: seed.address,
      role: seed.role,
      expectedUse: seed.expectedUse,
      expectedValue: seed.address === '$D0F3' || seed.address === '$FFFF' ? sourceRecord.expectedD0F3 : undefined,
      confidence: seed.confidence,
    })),
    falseRouteGuard: {
      evidenceCatalogId: sourceCatalogIds.false8fbGuard,
      rejectedCandidateId,
      rejectedCandidateRegionId,
      rejectedRouteId,
      guardStatus: guardEntry.guardDecision?.status,
      promotionAllowed: false,
      retainedTraceRoutes: guardEntry.guardDecision?.retainedTraceRoutes || [retainedRouteId],
      deprioritizedTraceRoutes: guardEntry.guardDecision?.deprioritizedTraceRoutes || [rejectedRouteId],
      rejectedOccurrence: guardEntry.rejectedOccurrence ? {
        occurrenceOffset: guardEntry.rejectedOccurrence.occurrenceOffset,
        sourceWord: guardEntry.rejectedOccurrence.sourceWord,
      } : null,
    },
    proofCriterion: 'Promote this seed only after a runtime trace proves the source word, _RAM_D0F3_ bank, mapper write, and VDP destination tile slot for the same upload event.',
    evidenceCatalogs: Object.values(sourceCatalogIds),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
  };
}

function buildCatalog(mapData) {
  const guardCatalog = requireCatalog(mapData, sourceCatalogIds.false8fbGuard);
  const routeCatalog = requireCatalog(mapData, sourceCatalogIds.nonmatchDynamicRoute);
  const dynamicTileCatalog = requireCatalog(mapData, sourceCatalogIds.dynamicTileUpload);
  const callerCatalog = requireCatalog(mapData, sourceCatalogIds.dynamicVdpUploadCaller);
  const bankCatalog = requireCatalog(mapData, sourceCatalogIds.dynamicVdpBankVariable);
  requireCatalog(mapData, sourceCatalogIds.playerA48DynamicSeedLink);

  const routeBySpan = routeEntriesBySpan(routeCatalog);
  const entries = (guardCatalog.entries || [])
    .filter(entry => (entry.guardDecision?.retainedTraceRoutes || []).includes(retainedRouteId))
    .sort((a, b) => parseOffset(a.range?.start) - parseOffset(b.range?.start))
    .map(entry => buildEntry(entry, routeBySpan.get(entry.spanId)));

  const routeRoutineRegionIds = uniqueSorted(entries.flatMap(entry => (
    entry.retainedRoute.routines || []
  ).map(routine => routine.region?.id)));
  const routeCallerRegionIds = uniqueSorted(entries.flatMap(entry => (
    entry.retainedRoute.callsites || []
  ).map(callsite => callsite.callerRegion?.id)));
  const sourceRecordWords = uniqueSorted(entries.map(entry => entry.sourceRecord.sourceRecordWordStart));
  const expectedBanks = uniqueSorted(entries.map(entry => entry.sourceRecord.expectedD0F3));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: offsets, source-record words, labels, line numbers, formulas, RAM symbols, route ids, and trace criteria. No ROM bytes, decoded graphics, screenshots, hashes, pixels, audio, text, or ASM instruction bytes are embedded.',
    target: {
      upstreamCatalogId: sourceCatalogIds.false8fbGuard,
      routeId: retainedRouteId,
      rejectedRouteId,
      rejectedCandidateId,
      reason: 'After the false 8FB guard rejected r0749/candidate_8fb_1E337, the only retained route for the four non-A48 player tile gaps is the 998/A97 dynamic decode path.',
    },
    summary: {
      traceSeedCount: entries.length,
      seedRegionIds: uniqueSorted(entries.map(entry => entry.region?.id)),
      sourceByteCount: sumBy(entries, entry => entry.range?.sizeBytes || 0),
      nonblankTileCount: sumBy(entries, entry => entry.nonblankTileCount || 0),
      singleTileSeedCount: entries.filter(entry => entry.range?.sizeBytes === 32).length,
      sourceRecordWords,
      sourceRecordHighBytes: uniqueSorted(entries.map(entry => entry.sourceRecord.sourceRecordHighByte)),
      expectedSourceBanks: expectedBanks,
      expectedD0F3Values: expectedBanks,
      expectedMapperWriteValues: expectedBanks,
      retainedRouteId,
      rejectedRouteId,
      rejectedCandidateId,
      primaryRoutineRegionIds: uniqueSorted(['r2727', 'r2100']),
      alternateRoutineRegionIds: uniqueSorted(['r2726', 'r2728']),
      helperRoutineRegionIds: uniqueSorted(['r1755', 'r2094']),
      routeRoutineRegionIds,
      primaryCallerRegionIds: uniqueSorted(['r2088']),
      alternateCallerRegionIds: uniqueSorted(['r1765']),
      routeCallerRegionIds,
      ramTraceSeedCount: ramTraceSeeds.length,
      sourceRangeFormulaAllMatched: entries.every(entry => entry.sourceRecord.computedRangeMatchesEntry),
      traceStatusCounts: countBy(entries, entry => entry.retainedRoute.status),
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    routeEvidence: {
      dynamicTileUploadRoutines: (dynamicTileCatalog.routines || []).map(compactCatalogRoutine),
      dynamicTileUploadCallers: (dynamicTileCatalog.callers || []).map(compactCaller),
      vdpUploadCallsites: (callerCatalog.callsites || [])
        .filter(callsite => ['_LABEL_A97_', '_LABEL_99B_'].includes(callsite.target))
        .map(compactCaller),
      dynamicBankSummary: bankCatalog.summary,
    },
    entries,
    ramTraceSeeds,
    evidence: [
      `${sourceCatalogIds.false8fbGuard} blocks the bank-7 8FB-shaped candidate and leaves ${retainedRouteId} as the retained route.`,
      `${sourceCatalogIds.nonmatchDynamicRoute} supplies the four single-tile source-word seeds and the _LABEL_9C3_/_LABEL_99B_/_LABEL_A97_ route metadata.`,
      `${sourceCatalogIds.dynamicTileUpload} describes _LABEL_A97_ as a dynamic tile decode/upload routine and _LABEL_9C3_ as the parser that derives _RAM_D0F3_ from the source-record high byte.`,
      `${sourceCatalogIds.dynamicVdpUploadCaller} records _LABEL_29E6_ calling _LABEL_A97_ with entity dynamic upload selector state and _LABEL_1BE0_ as the alternate _LABEL_99B_ item path.`,
      `${sourceCatalogIds.dynamicVdpBankVariable} records _RAM_D0F3_ bank derivation and _RAM_FFFF_ mapper writes used by these upload routines.`,
    ],
    nextLeads: [
      'Instrument _LABEL_9C3_ and _LABEL_A97_ for source words 0x174E, 0x175E, 0x176C, and 0x176E, capturing _RAM_D0F3_, _RAM_FFFF_, _RAM_D0EE_/_RAM_D0EF_, and _RAM_D0F0_/_RAM_D0F1_.',
      'Treat _LABEL_1BE0_/_LABEL_99B_ as an alternate raw-record path only if a runtime trace reaches it with the same source word and bank 0x0B.',
      'Do not promote the four r2656 32-byte spans to confirmed graphics coverage until the trace records the VDP destination tile slot and upload routine provenance.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const changedRam = [];
  const seedRegionDetails = new Map();

  for (const entry of catalog.entries) {
    const regionId = entry.region?.id;
    if (!regionId) continue;
    if (!seedRegionDetails.has(regionId)) {
      seedRegionDetails.set(regionId, {
        spanIds: [],
        sourceWords: [],
        sourceByteCount: 0,
        nonblankTileCount: 0,
      });
    }
    const detail = seedRegionDetails.get(regionId);
    detail.spanIds.push(entry.spanId);
    detail.sourceWords.push(entry.sourceRecord.sourceRecordWordStart);
    detail.sourceByteCount += entry.range?.sizeBytes || 0;
    detail.nonblankTileCount += entry.nonblankTileCount || 0;
  }

  for (const [regionId, detail] of seedRegionDetails) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'a97_trace_seed_graphics_region' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48NonmatchA97TraceSeedAudit = {
        catalogId,
        role: 'a97_trace_seed_graphics_region',
        confidence: 'medium_high',
        summary: 'Region contains four guarded player tile gap seeds now queued for _LABEL_9C3_/_LABEL_A97_ dynamic decode runtime tracing.',
        detail: {
          spanIds: uniqueSorted(detail.spanIds),
          sourceRecordWords: uniqueSorted(detail.sourceWords),
          expectedD0F3Values: catalog.summary.expectedD0F3Values,
          expectedMapperWriteValues: catalog.summary.expectedMapperWriteValues,
          sourceByteCount: detail.sourceByteCount,
          nonblankTileCount: detail.nonblankTileCount,
          retainedRouteId,
          rejectedCandidateId,
          promotionAllowed: false,
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      role: 'a97_trace_seed_graphics_region',
      spanCount: detail.spanIds.length,
      sourceRecordWords: uniqueSorted(detail.sourceWords),
    });
  }

  const routineRegionIds = uniqueSorted([
    ...catalog.summary.primaryRoutineRegionIds,
    ...catalog.summary.alternateRoutineRegionIds,
    ...catalog.summary.helperRoutineRegionIds,
  ]);
  for (const regionId of routineRegionIds) {
    const region = findRegionById(mapData, regionId);
    const role = routineRoles[regionId] || 'a97_trace_seed_related_routine';
    if (!region) {
      missingRegions.push({ id: regionId, role });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48NonmatchA97TraceSeedAudit = {
        catalogId,
        role,
        confidence: ['r2100', 'r2727'].includes(regionId) ? 'high' : 'medium_high',
        summary: 'Routine is part of the retained dynamic decode/upload trace path for the four guarded bank 0x0B non-A48 player tile seeds.',
        detail: {
          retainedRouteId,
          sourceRecordWords: catalog.summary.sourceRecordWords,
          expectedD0F3Values: catalog.summary.expectedD0F3Values,
          traceSeedCount: catalog.summary.traceSeedCount,
          promotionAllowed: false,
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      role,
    });
  }

  const callerRegionIds = uniqueSorted([
    ...catalog.summary.primaryCallerRegionIds,
    ...catalog.summary.alternateCallerRegionIds,
  ]);
  for (const regionId of callerRegionIds) {
    const region = findRegionById(mapData, regionId);
    const role = callerRoles[regionId] || 'a97_trace_seed_related_caller';
    if (!region) {
      missingRegions.push({ id: regionId, role });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48NonmatchA97TraceSeedAudit = {
        catalogId,
        role,
        confidence: regionId === 'r2088' ? 'high' : 'medium_high',
        summary: 'Caller supplies runtime selector context for proving whether the guarded non-A48 tile seeds reach the retained dynamic upload route.',
        detail: {
          retainedRouteId,
          sourceRecordWords: catalog.summary.sourceRecordWords,
          expectedD0F3Values: catalog.summary.expectedD0F3Values,
          traceSeedCount: catalog.summary.traceSeedCount,
          promotionAllowed: false,
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      role,
    });
  }

  for (const seed of catalog.ramTraceSeeds) {
    const ramEntry = findRamByAddress(mapData, seed.address);
    if (!ramEntry) continue;
    if (apply) {
      ramEntry.analysis = ramEntry.analysis || {};
      ramEntry.analysis.playerA48NonmatchA97TraceSeedAudit = {
        catalogId,
        symbol: seed.symbol,
        role: seed.role,
        expectedUse: seed.expectedUse,
        confidence: seed.confidence,
        summary: 'RAM value is part of proving the retained _LABEL_9C3_/_LABEL_A97_ dynamic upload path for four guarded bank 0x0B player tile seeds.',
        detail: {
          sourceRecordWords: catalog.summary.sourceRecordWords,
          expectedD0F3Values: seed.address === '$D0F3' || seed.address === '$FFFF' ? catalog.summary.expectedD0F3Values : undefined,
          retainedRouteId,
          traceSeedCount: catalog.summary.traceSeedCount,
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      id: ramEntry.id,
      address: ramEntry.address,
      name: ramEntry.name || '',
      symbol: seed.symbol,
      role: seed.role,
      confidence: seed.confidence,
    });
  }

  return { changedRegions, missingRegions, changedRam };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    entries: catalog.entries.map(entry => ({
      spanId: entry.spanId,
      range: entry.range,
      sourceRecord: entry.sourceRecord,
      retainedRoute: {
        id: entry.retainedRoute.id,
        primaryPath: entry.retainedRoute.primaryPath,
        alternateRawPath: entry.retainedRoute.alternateRawPath,
        primaryCallsite: entry.retainedRoute.primaryCallsite,
        alternateCallsite: entry.retainedRoute.alternateCallsite,
      },
      traceConditions: entry.traceConditions,
      falseRouteGuard: entry.falseRouteGuard,
      proofCriterion: entry.proofCriterion,
    })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
  mapData.graphicsCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'player_a48_nonmatch_a97_trace_seed_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    sample: reportSample(catalog),
    assetPolicy: catalog.assetPolicy,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);
  if (apply) {
    applyCatalog(mapData, catalog, annotation);
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    sample: reportSample(catalog),
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
  }, null, 2));
}

main();
