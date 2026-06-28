#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-graphics-dynamic-route-priority-audit.mjs';
const catalogId = 'world-graphics-dynamic-route-priority-catalog-2026-06-26';
const reportId = 'graphics-dynamic-route-priority-audit-2026-06-26';
const schemaVersion = 1;

const sourceCatalogIds = {
  localVerifier: 'world-graphics-dynamic-source-local-verifier-catalog-2026-06-26',
  dynamicTraceSeed: 'world-graphics-dynamic-source-trace-seed-catalog-2026-06-26',
  playerA48DynamicSeedLink: 'world-player-a48-dynamic-seed-link-catalog-2026-06-26',
  playerA48CommandConfidenceTrace: 'world-player-a48-command-confidence-trace-catalog-2026-06-26',
  playerA48NonmatchDynamicRoute: 'world-player-a48-nonmatch-dynamic-route-catalog-2026-06-26',
  playerA48NonmatchFalse8fbGuard: 'world-player-a48-nonmatch-false-8fb-guard-catalog-2026-06-26',
  playerA48NonmatchA97TraceSeed: 'world-player-a48-nonmatch-a97-trace-seed-catalog-2026-06-26',
  playerA97TraceLocalVerifier: 'world-player-a97-trace-local-verifier-catalog-2026-06-26',
  dynamicVdpUploadCaller: 'world-dynamic-vdp-upload-caller-catalog-2026-06-26',
  dynamicVdpBankVariable: 'world-dynamic-vdp-bank-variable-catalog-2026-06-26',
};

const a48TraceRamSeeds = [
  { symbol: '_RAM_C24C_', address: '$C24C', role: 'player_frame_pointer_latch_for_command_stream' },
  { symbol: '_RAM_C24F_', address: '$C24F', role: 'outer_player_form_dispatch_selector' },
  { symbol: '_RAM_C252_', address: '$C252', role: 'next_player_command_cursor' },
  { symbol: '_RAM_C260_', address: '$C260', role: 'inner_player_state_dispatch_selector' },
  { symbol: '_RAM_C27F_', address: '$C27F', role: 'a48_vram_destination_base_selector' },
  { symbol: '_RAM_DFFF_', address: '$DFFF', role: 'previous_mapper_bank_restore_context' },
  { symbol: '_RAM_FFFF_', address: '$FFFF', role: 'mapper_page2_bank_write_from_a48_source_record' },
];

const dynamicTraceRamSeeds = [
  { symbol: '_RAM_D0F3_', address: '$D0F3', role: 'record_derived_source_bank_latch_for_919_99b_a97_paths' },
  { symbol: '_RAM_D0E0_', address: '$D0E0', role: 'entity_dynamic_decode_selector_context' },
  { symbol: '_RAM_D0E1_', address: '$D0E1', role: 'entity_dynamic_decode_selector_context' },
  { symbol: '_RAM_D0E2_', address: '$D0E2', role: 'entity_dynamic_decode_selector_context' },
  { symbol: '_RAM_D0EC_', address: '$D0EC', role: 'entity_dynamic_decode_selector_context' },
  { symbol: '_RAM_D0ED_', address: '$D0ED', role: 'entity_dynamic_decode_selector_context' },
  { symbol: '_RAM_D02A_', address: '$D02A', role: 'item_vram_record_destination_context' },
  { symbol: '_RAM_DFFF_', address: '$DFFF', role: 'previous_mapper_bank_restore_context' },
  { symbol: '_RAM_FFFF_', address: '$FFFF', role: 'mapper_page2_bank_write' },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function bySpanId(items) {
  return new Map((items || []).map(item => [item.spanId, item]));
}

function routeById(dynamicSeedCatalog) {
  return new Map((dynamicSeedCatalog.routes || []).map(route => [route.id, route]));
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

function compactRoute(route, routePriority) {
  if (!route) return null;
  return {
    id: route.id,
    priority: routePriority,
    routineLabels: route.routineLabels || [],
    parserLabels: route.parserLabels || [],
    callerLabels: route.callerLabels || [],
    bankFormula: route.bankFormula || '',
    traceStatus: route.traceStatus || '',
    selectorState: route.selectorState || [],
    confidence: route.confidence || '',
    routines: (route.routines || []).map(routine => ({
      label: routine.label,
      region: compactRegion(routine.region),
      role: routine.role,
      eventCounts: routine.eventCounts || {},
    })),
    callsites: (route.callsites || []).map(callsite => ({
      callerLabel: callsite.callerLabel,
      callerRegion: compactRegion(callsite.callerRegion),
      target: callsite.target,
      line: callsite.line,
      classification: callsite.classification,
      selectorState: callsite.selectorState || [],
      bankContext: callsite.bankContext,
    })),
  };
}

function routeOrder(routeIds, routes) {
  const priorities = ['primary', 'secondary', 'tertiary', 'candidate'];
  return routeIds
    .map((routeId, index) => compactRoute(routes.get(routeId), priorities[index] || 'candidate'))
    .filter(Boolean);
}

function chooseAvailableRoute(candidateRoutes, preferredRouteIds) {
  for (const routeId of preferredRouteIds) {
    if ((candidateRoutes || []).includes(routeId)) return routeId;
  }
  return (candidateRoutes || [])[0] || '';
}

function priorityDecision(localEntry, context) {
  const {
    link,
    commandTrace,
    false8fbGuard,
    a97TraceSeed,
    a97LocalVerifier,
    routes,
  } = context;
  const classification = link?.classification || '';
  const candidateRoutes = localEntry.candidateRoutes || [];

  if (classification === 'known_a48_stream_source_gap_needs_command_confidence_trace') {
    return {
      priorityAction: 'trace_player_a48_command_selector',
      primaryRouteId: 'record_derived_a48_player_animation_path',
      routeOrder: routeOrder([
        'record_derived_a48_player_animation_path',
        'record_derived_998_or_dynamic_decode_path',
        'record_derived_8fb_path',
      ].filter(routeId => candidateRoutes.includes(routeId)), routes),
      confidence: 'medium_high',
      status: 'local_verified_known_a48_source_runtime_command_trace_pending',
      reason: 'The A48 seed-link catalog fully covers this local-verified source range with known but command-unconfirmed _LABEL_A48_ stream source intervals.',
      tracePrerequisites: a48TraceRamSeeds,
      selectorTrace: commandTrace ? {
        catalogId: sourceCatalogIds.playerA48CommandConfidenceTrace,
        priority: commandTrace.priority,
        traceStatus: commandTrace.traceStatus,
        a48StreamCount: commandTrace.a48StreamCount,
        playerCommandStreamReferenceCount: commandTrace.playerCommandStreamReferenceCount,
        recommendedTrace: commandTrace.recommendedTrace,
      } : null,
      rejectedRoutes: [],
    };
  }

  if (classification === 'accepted_gap_candidate_exact_match_needs_selector_trace') {
    return {
      priorityAction: 'trace_accepted_a48_gap_selector',
      primaryRouteId: 'record_derived_a48_player_animation_path',
      routeOrder: routeOrder([
        'record_derived_a48_player_animation_path',
        'record_derived_998_or_dynamic_decode_path',
        'record_derived_8fb_path',
      ].filter(routeId => candidateRoutes.includes(routeId)), routes),
      confidence: 'medium',
      status: 'local_verified_accepted_a48_gap_runtime_selector_trace_pending',
      reason: 'The A48 seed-link catalog records an exact accepted A48 gap candidate match, but the selector path still needs runtime proof before promotion.',
      tracePrerequisites: a48TraceRamSeeds,
      selectorTrace: null,
      rejectedRoutes: [],
    };
  }

  if (classification === 'no_a48_source_interval_match_needs_other_dynamic_or_decompression_trace') {
    const hasA97Evidence = Boolean(a97TraceSeed && a97LocalVerifier);
    return {
      priorityAction: hasA97Evidence ? 'trace_a97_dynamic_decode_route' : 'trace_non_a48_dynamic_or_decompression_route',
      primaryRouteId: 'record_derived_998_or_dynamic_decode_path',
      routeOrder: routeOrder([
        'record_derived_998_or_dynamic_decode_path',
        'record_derived_8fb_path',
      ].filter(routeId => candidateRoutes.includes(routeId)), routes),
      confidence: hasA97Evidence ? 'medium_high' : 'medium',
      status: hasA97Evidence
        ? 'local_verified_a97_decode_formula_runtime_trace_pending'
        : 'local_verified_non_a48_dynamic_route_runtime_trace_pending',
      reason: hasA97Evidence
        ? 'The span has no A48 interval match, has a retained _LABEL_9C3_/_LABEL_A97_ trace seed, passes the A97 local verifier, and is guarded away from the false bank-7 8FB candidate.'
        : 'The span has no A48 interval match and should be traced through non-A48 dynamic loader/decompression routes before any coverage promotion.',
      tracePrerequisites: dynamicTraceRamSeeds,
      selectorTrace: a97TraceSeed ? {
        catalogId: sourceCatalogIds.playerA48NonmatchA97TraceSeed,
        primaryPath: a97TraceSeed.retainedRoute?.primaryPath || [],
        alternateRawPath: a97TraceSeed.retainedRoute?.alternateRawPath || [],
        primaryCallsite: a97TraceSeed.retainedRoute?.primaryCallsite || null,
        sourceRecordWord: a97LocalVerifier?.sourceRecordWord || a97TraceSeed.sourceRecord?.sourceRecordWordStart || '',
        expectedD0F3: a97LocalVerifier?.expectedD0F3 || a97TraceSeed.sourceRecord?.expectedD0F3 || '',
        expectedMapperWrite: a97LocalVerifier?.expectedMapperWrite || a97TraceSeed.sourceRecord?.expectedMapperWrite || '',
        a97DecodedNonzeroRowCount: a97LocalVerifier?.localVerification?.a97DecodedNonzeroRowCount || 0,
        a97DecodedNonzeroByteCount: a97LocalVerifier?.localVerification?.a97DecodedNonzeroByteCount || 0,
      } : null,
      rejectedRoutes: [
        {
          id: 'record_derived_a48_player_animation_path',
          reason: 'A48 dynamic seed link found zero confirmed, candidate, or accepted-gap source interval overlap for this span.',
          evidenceCatalogId: sourceCatalogIds.playerA48DynamicSeedLink,
        },
        false8fbGuard ? {
          id: 'record_derived_8fb_path',
          reason: 'False-8FB guard rejects candidate_8fb_1E337 as a coverage source and retains the 998/A97 route.',
          evidenceCatalogId: sourceCatalogIds.playerA48NonmatchFalse8fbGuard,
        } : null,
      ].filter(Boolean),
    };
  }

  if (localEntry.recommendedAction === 'trace_real_consumer_before_coverage') {
    const primaryRouteId = chooseAvailableRoute(candidateRoutes, [
      'record_derived_998_or_dynamic_decode_path',
      'record_derived_a48_player_animation_path',
      'record_derived_8fb_path',
    ]);
    return {
      priorityAction: 'trace_real_consumer_before_coverage',
      primaryRouteId,
      routeOrder: routeOrder([primaryRouteId, ...candidateRoutes.filter(routeId => routeId !== primaryRouteId)], routes),
      confidence: 'medium',
      status: 'local_verified_candidate_payload_consumer_runtime_trace_pending',
      reason: 'The source bytes verify locally, but the upstream queue marks this as a candidate payload span that needs a concrete runtime consumer before coverage promotion.',
      tracePrerequisites: primaryRouteId === 'record_derived_a48_player_animation_path' ? a48TraceRamSeeds : dynamicTraceRamSeeds,
      selectorTrace: null,
      rejectedRoutes: [],
    };
  }

  const primaryRouteId = chooseAvailableRoute(candidateRoutes, [
    'record_derived_998_or_dynamic_decode_path',
    'record_derived_8fb_path',
    'record_derived_a48_player_animation_path',
  ]);
  return {
    priorityAction: 'trace_verified_dynamic_bank_route',
    primaryRouteId,
    routeOrder: routeOrder([primaryRouteId, ...candidateRoutes.filter(routeId => routeId !== primaryRouteId)], routes),
    confidence: 'medium',
    status: 'local_verified_dynamic_bank_runtime_trace_pending',
    reason: 'The source-record formula and local source range are verified, but no specific runtime consumer has been proven; trace the highest-confidence dynamic-bank route first.',
    tracePrerequisites: primaryRouteId === 'record_derived_a48_player_animation_path' ? a48TraceRamSeeds : dynamicTraceRamSeeds,
    selectorTrace: null,
    rejectedRoutes: [],
  };
}

function buildEntry(localEntry, indexes) {
  const dynamicSeed = indexes.dynamicSeeds.get(localEntry.spanId) || null;
  const link = indexes.links.get(localEntry.spanId) || null;
  const commandTrace = indexes.commandTraces.get(localEntry.spanId) || null;
  const false8fbGuard = indexes.false8fbGuards.get(localEntry.spanId) || null;
  const a97TraceSeed = indexes.a97TraceSeeds.get(localEntry.spanId) || null;
  const a97LocalVerifier = indexes.a97LocalVerifiers.get(localEntry.spanId) || null;
  const decision = priorityDecision(localEntry, {
    link,
    commandTrace,
    false8fbGuard,
    a97TraceSeed,
    a97LocalVerifier,
    routes: indexes.routes,
  });

  return {
    id: `${localEntry.spanId}_dynamic_route_priority`,
    spanId: localEntry.spanId,
    region: localEntry.region,
    range: localEntry.range,
    tileCount: localEntry.tileCount || 0,
    nonblankTileCount: localEntry.nonblankTileCount || 0,
    sourceBank: localEntry.sourceBank,
    sourceRecordHighBytes: localEntry.sourceRecordHighBytes || [],
    sourceRecordWords: localEntry.sourceRecordWords || [],
    sourceRegionIds: localEntry.localVerification?.sourceRegionIds || [],
    localVerification: {
      status: localEntry.localVerification?.status || '',
      sourceByteCount: localEntry.localVerification?.sourceByteCount || 0,
      nonzeroByteCount: localEntry.localVerification?.nonzeroByteCount || 0,
      formulaMatchesRange: Boolean(localEntry.localVerification?.formulaMatchesRange),
      allChunksInRange: Boolean(localEntry.localVerification?.allChunksInRange),
      allBanksMatchHighByteFormula: Boolean(localEntry.localVerification?.allBanksMatchHighByteFormula),
      runtimeTraceConfirmed: Boolean(localEntry.localVerification?.runtimeTraceConfirmed),
      promotionReady: Boolean(localEntry.localVerification?.promotionReady),
    },
    upstream: {
      localVerifierCatalogId: sourceCatalogIds.localVerifier,
      dynamicTraceSeedCatalogId: dynamicSeed ? sourceCatalogIds.dynamicTraceSeed : null,
      originalRecommendedAction: localEntry.recommendedAction,
      originalActionConfidence: localEntry.actionConfidence,
      kind: localEntry.kind,
      candidateRoutes: localEntry.candidateRoutes || [],
      a48Classification: link?.classification || null,
      a48RecommendedNextAction: link?.recommendedNextAction || null,
      a48OverlapSummary: link?.overlapSummary || null,
    },
    routePriority: decision,
    evidenceCatalogs: uniqueSorted([
      sourceCatalogIds.localVerifier,
      sourceCatalogIds.dynamicTraceSeed,
      ...(localEntry.evidenceCatalogs || []),
      ...(link?.evidenceCatalogs || []),
      ...(dynamicSeed?.evidenceCatalogs || []),
      link ? sourceCatalogIds.playerA48DynamicSeedLink : null,
      commandTrace ? sourceCatalogIds.playerA48CommandConfidenceTrace : null,
      false8fbGuard ? sourceCatalogIds.playerA48NonmatchFalse8fbGuard : null,
      a97TraceSeed ? sourceCatalogIds.playerA48NonmatchA97TraceSeed : null,
      a97LocalVerifier ? sourceCatalogIds.playerA97TraceLocalVerifier : null,
      sourceCatalogIds.dynamicVdpUploadCaller,
      sourceCatalogIds.dynamicVdpBankVariable,
    ]),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
  };
}

function buildBankGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const bank = entry.sourceBank || 'unknown';
    if (!groups.has(bank)) {
      groups.set(bank, {
        sourceBank: bank,
        entryCount: 0,
        sourceByteCount: 0,
        nonzeroByteCount: 0,
        nonblankTileCount: 0,
        seedRegionIds: new Set(),
        sourceRegionIds: new Set(),
        sourceRecordHighBytes: new Set(),
        priorityActionCounts: {},
        primaryRouteCounts: {},
        topEntries: [],
      });
    }
    const group = groups.get(bank);
    group.entryCount++;
    group.sourceByteCount += entry.localVerification.sourceByteCount || 0;
    group.nonzeroByteCount += entry.localVerification.nonzeroByteCount || 0;
    group.nonblankTileCount += entry.nonblankTileCount || 0;
    if (entry.region?.id) group.seedRegionIds.add(entry.region.id);
    for (const regionId of entry.sourceRegionIds || []) group.sourceRegionIds.add(regionId);
    for (const highByte of entry.sourceRecordHighBytes || []) group.sourceRecordHighBytes.add(highByte);
    group.priorityActionCounts[entry.routePriority.priorityAction] = (group.priorityActionCounts[entry.routePriority.priorityAction] || 0) + 1;
    group.primaryRouteCounts[entry.routePriority.primaryRouteId] = (group.primaryRouteCounts[entry.routePriority.primaryRouteId] || 0) + 1;
    group.topEntries.push({
      spanId: entry.spanId,
      range: entry.range,
      sourceRecordWords: entry.sourceRecordWords,
      sourceByteCount: entry.localVerification.sourceByteCount,
      priorityAction: entry.routePriority.priorityAction,
      primaryRouteId: entry.routePriority.primaryRouteId,
      confidence: entry.routePriority.confidence,
    });
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      seedRegionIds: uniqueSorted([...group.seedRegionIds]),
      sourceRegionIds: uniqueSorted([...group.sourceRegionIds]),
      sourceRecordHighBytes: uniqueSorted([...group.sourceRecordHighBytes]),
      topEntries: group.topEntries
        .sort((a, b) => b.sourceByteCount - a.sourceByteCount || String(a.spanId).localeCompare(String(b.spanId)))
        .slice(0, 8),
    }))
    .sort((a, b) => parseOffset(a.sourceBank) - parseOffset(b.sourceBank));
}

function routeRegionIds(entries) {
  return uniqueSorted(entries.flatMap(entry => (entry.routePriority.routeOrder || []).flatMap(route => [
    ...(route.routines || []).map(routine => routine.region?.id),
    ...(route.callsites || []).map(callsite => callsite.callerRegion?.id),
  ])));
}

function buildCatalog(mapData) {
  const localVerifier = requireCatalog(mapData, sourceCatalogIds.localVerifier);
  const dynamicTraceSeed = requireCatalog(mapData, sourceCatalogIds.dynamicTraceSeed);
  const playerA48DynamicSeedLink = requireCatalog(mapData, sourceCatalogIds.playerA48DynamicSeedLink);
  const playerA48CommandConfidenceTrace = requireCatalog(mapData, sourceCatalogIds.playerA48CommandConfidenceTrace);
  requireCatalog(mapData, sourceCatalogIds.playerA48NonmatchDynamicRoute);
  const playerA48NonmatchFalse8fbGuard = requireCatalog(mapData, sourceCatalogIds.playerA48NonmatchFalse8fbGuard);
  const playerA48NonmatchA97TraceSeed = requireCatalog(mapData, sourceCatalogIds.playerA48NonmatchA97TraceSeed);
  const playerA97TraceLocalVerifier = requireCatalog(mapData, sourceCatalogIds.playerA97TraceLocalVerifier);
  requireCatalog(mapData, sourceCatalogIds.dynamicVdpUploadCaller);
  requireCatalog(mapData, sourceCatalogIds.dynamicVdpBankVariable);

  const indexes = {
    dynamicSeeds: bySpanId(dynamicTraceSeed.seeds || []),
    links: bySpanId(playerA48DynamicSeedLink.links || []),
    commandTraces: bySpanId(playerA48CommandConfidenceTrace.entries || []),
    false8fbGuards: bySpanId(playerA48NonmatchFalse8fbGuard.entries || []),
    a97TraceSeeds: bySpanId(playerA48NonmatchA97TraceSeed.entries || []),
    a97LocalVerifiers: bySpanId(playerA97TraceLocalVerifier.entries || []),
    routes: routeById(dynamicTraceSeed),
  };

  const entries = (localVerifier.entries || [])
    .map(entry => buildEntry(entry, indexes))
    .sort((a, b) => parseOffset(a.range?.start) - parseOffset(b.range?.start));
  const bankGroups = buildBankGroups(entries);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: offsets, source-record words, route ids, labels, region ids, RAM symbols, counts, and evidence catalog ids. No ROM bytes, decoded graphics, pixels, screenshots, hashes, audio, text, or ASM instruction bytes are embedded.',
    target: {
      upstreamCatalogId: sourceCatalogIds.localVerifier,
      reason: 'Rank each locally verified dynamic graphics source seed by the best currently evidenced runtime trace route before any coverage promotion.',
    },
    summary: {
      priorityEntryCount: entries.length,
      localVerifiedSeedCount: entries.filter(entry => entry.localVerification.status === 'local_source_verified_runtime_trace_pending').length,
      seedRegionCount: new Set(entries.map(entry => entry.region?.id).filter(Boolean)).size,
      seedRegionIds: uniqueSorted(entries.map(entry => entry.region?.id)),
      sourceRegionCount: new Set(entries.flatMap(entry => entry.sourceRegionIds || [])).size,
      sourceRegionIds: uniqueSorted(entries.flatMap(entry => entry.sourceRegionIds || [])),
      sourceBankCount: new Set(entries.map(entry => entry.sourceBank).filter(Boolean)).size,
      sourceBanks: uniqueSorted(entries.map(entry => entry.sourceBank)),
      sourceRecordHighBytes: uniqueSorted(entries.flatMap(entry => entry.sourceRecordHighBytes || [])),
      sourceByteCount: sumBy(entries, entry => entry.localVerification.sourceByteCount),
      localNonzeroByteCount: sumBy(entries, entry => entry.localVerification.nonzeroByteCount),
      nonblankTileCount: sumBy(entries, entry => entry.nonblankTileCount),
      priorityActionCounts: countBy(entries, entry => entry.routePriority.priorityAction),
      primaryRouteCounts: countBy(entries, entry => entry.routePriority.primaryRouteId),
      routeConfidenceCounts: countBy(entries, entry => entry.routePriority.confidence),
      routeStatusCounts: countBy(entries, entry => entry.routePriority.status),
      routeRoutineRegionIds: routeRegionIds(entries),
      runtimeTraceConfirmedCount: entries.filter(entry => entry.localVerification.runtimeTraceConfirmed).length,
      promotionReadyCount: entries.filter(entry => entry.localVerification.promotionReady).length,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    bankGroups,
    entries,
    evidence: [
      `${sourceCatalogIds.localVerifier} proves all 31 dynamic graphics seeds match local source formulas, source bounds, bank derivation, and nonblank source counts.`,
      `${sourceCatalogIds.playerA48DynamicSeedLink} splits the bank 0x0B seeds into known-A48, accepted A48 gap, and non-A48 trace classes.`,
      `${sourceCatalogIds.playerA48CommandConfidenceTrace} supplies the selector-trace work queue for known-A48 player animation source matches.`,
      `${sourceCatalogIds.playerA48NonmatchA97TraceSeed} and ${sourceCatalogIds.playerA97TraceLocalVerifier} retain the _LABEL_9C3_/_LABEL_A97_ route for the four r2656 single-tile non-A48 gaps.`,
      `${sourceCatalogIds.playerA48NonmatchFalse8fbGuard} prevents the rejected bank-7 8FB candidate from being promoted as coverage for those four gaps.`,
    ],
    nextLeads: [
      'Trace the 10 known-A48 entries through _LABEL_13A6_/_LABEL_A48_ and the listed player selector RAM before promoting their graphics coverage.',
      'Trace the accepted A48 gap candidate separately; it has exact source coverage but still needs selector proof.',
      'Trace the four A97-priority r2656 single-tile gaps through _LABEL_9C3_/_LABEL_A97_ with source word, _RAM_D0F3_, mapper write, and VDP destination captured.',
      'Trace non-bank-0x0B dynamic-bank entries through the 998/A97 route first, falling back to 8FB only when the runtime caller proves that parser path.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const changedRam = [];
  const missingRam = [];
  const byRegion = new Map();
  const byRam = new Map();

  function ensureRegion(regionId) {
    if (!byRegion.has(regionId)) {
      byRegion.set(regionId, {
        roles: new Set(),
        spanIds: new Set(),
        sourceBanks: new Set(),
        sourceRecordHighBytes: new Set(),
        priorityActions: new Set(),
        primaryRouteIds: new Set(),
        routeIds: new Set(),
        sourceByteCount: 0,
      });
    }
    return byRegion.get(regionId);
  }

  function addRegion(regionId, role, entry, routeId = '') {
    if (!regionId) return;
    const detail = ensureRegion(regionId);
    detail.roles.add(role);
    if (routeId) detail.routeIds.add(routeId);
    if (entry) {
      detail.spanIds.add(entry.spanId);
      if (entry.sourceBank) detail.sourceBanks.add(entry.sourceBank);
      for (const highByte of entry.sourceRecordHighBytes || []) detail.sourceRecordHighBytes.add(highByte);
      if (entry.routePriority?.priorityAction) detail.priorityActions.add(entry.routePriority.priorityAction);
      if (entry.routePriority?.primaryRouteId) detail.primaryRouteIds.add(entry.routePriority.primaryRouteId);
      detail.sourceByteCount += entry.localVerification?.sourceByteCount || 0;
    }
  }

  function addRam(seed, priorityAction, primaryRouteId) {
    const key = seed.address;
    if (!byRam.has(key)) {
      byRam.set(key, {
        seed,
        priorityActions: new Set(),
        primaryRouteIds: new Set(),
        roles: new Set(),
      });
    }
    const detail = byRam.get(key);
    detail.priorityActions.add(priorityAction);
    detail.primaryRouteIds.add(primaryRouteId);
    detail.roles.add(seed.role);
  }

  for (const entry of catalog.entries) {
    addRegion(entry.region?.id, 'dynamic_route_priority_seed_region', entry);
    for (const sourceRegionId of entry.sourceRegionIds || []) {
      addRegion(sourceRegionId, 'dynamic_route_priority_source_region', entry);
    }
    for (const route of entry.routePriority.routeOrder || []) {
      const priorityRole = route.priority === 'primary'
        ? 'dynamic_route_priority_primary_routine_or_caller'
        : 'dynamic_route_priority_secondary_routine_or_caller';
      for (const routine of route.routines || []) addRegion(routine.region?.id, priorityRole, entry, route.id);
      for (const callsite of route.callsites || []) addRegion(callsite.callerRegion?.id, priorityRole, entry, route.id);
    }
    for (const seed of entry.routePriority.tracePrerequisites || []) {
      addRam(seed, entry.routePriority.priorityAction, entry.routePriority.primaryRouteId);
    }
  }

  for (const [regionId, detail] of byRegion) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: [...detail.roles].sort().join(',') });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.graphicsDynamicRoutePriorityAudit = {
        catalogId,
        role: [...detail.roles].sort().join(','),
        confidence: detail.primaryRouteIds.has('record_derived_a48_player_animation_path') ||
          detail.primaryRouteIds.has('record_derived_998_or_dynamic_decode_path') ? 'medium_high' : 'medium',
        summary: 'Dynamic graphics seed/source/route region participates in the verified local-source route-priority queue; runtime trace and coverage promotion remain pending.',
        detail: {
          spanIds: uniqueSorted([...detail.spanIds]),
          sourceBanks: uniqueSorted([...detail.sourceBanks]),
          sourceRecordHighBytes: uniqueSorted([...detail.sourceRecordHighBytes]),
          priorityActions: uniqueSorted([...detail.priorityActions]),
          primaryRouteIds: uniqueSorted([...detail.primaryRouteIds]),
          routeIds: uniqueSorted([...detail.routeIds]),
          sourceByteCount: detail.sourceByteCount,
          runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
          promotionReadyCount: catalog.summary.promotionReadyCount,
          coverageChangedByThisAudit: false,
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
      role: [...detail.roles].sort().join(','),
      spanCount: detail.spanIds.size,
      priorityActions: uniqueSorted([...detail.priorityActions]),
      primaryRouteIds: uniqueSorted([...detail.primaryRouteIds]),
      routeIds: uniqueSorted([...detail.routeIds]),
    });
  }

  for (const [address, detail] of byRam) {
    const ramEntry = findRamByAddress(mapData, address);
    if (!ramEntry) {
      missingRam.push({ address, symbol: detail.seed.symbol, role: [...detail.roles].sort().join(',') });
      continue;
    }
    if (apply) {
      ramEntry.analysis = ramEntry.analysis || {};
      ramEntry.analysis.graphicsDynamicRoutePriorityAudit = {
        catalogId,
        symbol: detail.seed.symbol,
        role: [...detail.roles].sort().join(','),
        confidence: 'medium_high',
        summary: 'RAM variable is a trace prerequisite for locally verified dynamic graphics route priorities; names and lifetimes still need frame traces.',
        priorityActions: uniqueSorted([...detail.priorityActions]),
        primaryRouteIds: uniqueSorted([...detail.primaryRouteIds]),
        runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      address,
      symbol: detail.seed.symbol,
      role: [...detail.roles].sort().join(','),
      priorityActions: uniqueSorted([...detail.priorityActions]),
      primaryRouteIds: uniqueSorted([...detail.primaryRouteIds]),
    });
  }

  return { changedRegions, missingRegions, changedRam, missingRam };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    bankGroups: catalog.bankGroups,
    topEntries: catalog.entries
      .slice()
      .sort((a, b) => b.localVerification.sourceByteCount - a.localVerification.sourceByteCount)
      .slice(0, 14)
      .map(entry => ({
        spanId: entry.spanId,
        region: entry.region,
        range: entry.range,
        sourceBank: entry.sourceBank,
        sourceRecordHighBytes: entry.sourceRecordHighBytes,
        sourceRecordWords: entry.sourceRecordWords,
        localVerification: entry.localVerification,
        priorityAction: entry.routePriority.priorityAction,
        primaryRouteId: entry.routePriority.primaryRouteId,
        confidence: entry.routePriority.confidence,
        status: entry.routePriority.status,
        reason: entry.routePriority.reason,
      })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
  mapData.graphicsCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'graphics_dynamic_route_priority_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    missingRam: annotation.missingRam,
    sample: reportSample(catalog),
    assetPolicy: catalog.assetPolicy,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) {
    out.push(newId);
  } else {
    out.splice(index + 1, 0, newId);
  }
  return out;
}

function applyStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return null;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.graphicsDynamicRoutePriorityCatalog = catalogId;
  staticMap.summary.graphicsDynamicRoutePriorityEntries = catalog.summary.priorityEntryCount;
  staticMap.summary.graphicsDynamicRoutePriorityLocalVerified = catalog.summary.localVerifiedSeedCount;
  staticMap.summary.graphicsDynamicRoutePriorityA48Primary =
    catalog.summary.primaryRouteCounts.record_derived_a48_player_animation_path || 0;
  staticMap.summary.graphicsDynamicRoutePriorityDynamicDecodePrimary =
    catalog.summary.primaryRouteCounts.record_derived_998_or_dynamic_decode_path || 0;
  staticMap.summary.graphicsDynamicRoutePriorityRuntimeConfirmed = catalog.summary.runtimeTraceConfirmedCount;
  staticMap.summary.graphicsDynamicRoutePriorityCoverageChanged = catalog.summary.coverageChangedByThisAudit;

  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.graphics = insertAfter(
    staticMap.primaryCatalogs.graphics,
    sourceCatalogIds.localVerifier,
    catalogId
  );
  staticMap.primaryCatalogs.gameplay = insertAfter(
    staticMap.primaryCatalogs.gameplay,
    sourceCatalogIds.playerA97TraceLocalVerifier,
    catalogId
  );
  staticMap.primaryCatalogs.coverage = insertAfter(
    staticMap.primaryCatalogs.coverage,
    sourceCatalogIds.localVerifier,
    catalogId
  );

  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.splice(5, 0, 'Use world-graphics-dynamic-route-priority-catalog-2026-06-26 as the ordered trace queue for all 31 locally verified dynamic graphics seeds: 11 A48-primary entries, 20 998/A97-primary entries, runtime confirmation still zero.');

  writeJson(staticMapPath, staticMap);
  return {
    staticMapPath: path.relative(repoRoot, staticMapPath),
    summaryFieldsUpdated: [
      'graphicsDynamicRoutePriorityCatalog',
      'graphicsDynamicRoutePriorityEntries',
      'graphicsDynamicRoutePriorityLocalVerified',
      'graphicsDynamicRoutePriorityA48Primary',
      'graphicsDynamicRoutePriorityDynamicDecodePrimary',
      'graphicsDynamicRoutePriorityRuntimeConfirmed',
      'graphicsDynamicRoutePriorityCoverageChanged',
    ],
    primaryCatalogBucketsUpdated: ['graphics', 'gameplay', 'coverage'],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);
  let staticMapUpdate = null;
  if (apply) {
    applyCatalog(mapData, catalog, annotation);
    writeJson(mapPath, mapData);
    staticMapUpdate = applyStaticMap(catalog);
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
    missingRam: annotation.missingRam,
    staticMapUpdate,
  }, null, 2));
}

main();
