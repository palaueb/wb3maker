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
const toolName = 'tools/world-graphics-998-a97-frame-trace-scaffold-audit.mjs';
const catalogId = 'world-graphics-998-a97-frame-trace-scaffold-catalog-2026-06-26';
const reportId = 'graphics-998-a97-frame-trace-scaffold-audit-2026-06-26';
const schemaVersion = 1;

const sourceCatalogIds = {
  dynamicRoutePriority: 'world-graphics-dynamic-route-priority-catalog-2026-06-26',
  dynamicSourceLocalVerifier: 'world-graphics-dynamic-source-local-verifier-catalog-2026-06-26',
  playerA48NonmatchA97TraceSeed: 'world-player-a48-nonmatch-a97-trace-seed-catalog-2026-06-26',
  playerA97TraceLocalVerifier: 'world-player-a97-trace-local-verifier-catalog-2026-06-26',
  runtimeEffectIndex: 'world-runtime-effect-index-catalog-2026-06-26',
  runtimeRamTraceSeed: 'world-runtime-ram-trace-seed-catalog-2026-06-26',
};

const targetRouteId = 'record_derived_998_or_dynamic_decode_path';

const traceProofFields = [
  'same_frame_selector_context',
  'item_or_entity_consumer_callsite',
  'record_parser_9c3_source_record',
  'd0f3_source_bank_latch',
  'source_record_word',
  'mapper_bank_switch_1023',
  'vdp_destination_d0f0',
  'raw_or_decoded_transfer_loop',
  'local_source_formula_verified',
];

const eventPointSpecs = [
  {
    id: 'dynamic_item_consumer_sample',
    label: '_LABEL_1BE0_',
    regionId: 'r1765',
    offset: '0x01BE0',
    asmLineEvidence: [4998, 4999],
    eventKind: 'item_consumer_selector',
    captureFields: ['A item id', '_RAM_D02A_', 'target _LABEL_99B_'],
    reason: 'Captures the item VRAM record loader path that jumps to the raw 998 upload wrapper.',
  },
  {
    id: 'dynamic_entity_consumer_sample',
    label: '_LABEL_29E6_',
    regionId: 'r2088',
    offset: '0x029E6',
    asmLineEvidence: [6920, 6921, 6925],
    eventKind: 'entity_consumer_selector',
    captureFields: ['_RAM_D0E0_', '_RAM_D0E1_', '_RAM_D0E2_', '_RAM_D0EC_', '_RAM_D0ED_', 'target _LABEL_A97_'],
    reason: 'Captures the entity dynamic tile decode path before it calls _LABEL_A97_.',
  },
  {
    id: 'dynamic_998_entry_sample',
    label: '_LABEL_998_',
    regionId: 'r2644',
    offset: '0x00998',
    asmLineEvidence: [2291, 2292],
    eventKind: 'vram_998_entry',
    captureFields: ['HL record stream', 'DE destination reset'],
    reason: 'Captures direct 998 loader entry state before the shared _LABEL_99B_ wrapper.',
  },
  {
    id: 'dynamic_99b_wrapper_sample',
    label: '_LABEL_99B_',
    regionId: 'r2726',
    offset: '0x0099B',
    asmLineEvidence: [2293, 2294, 2299, 2301, 2303, 2305],
    eventKind: 'vram_99b_wrapper',
    captureFields: ['_RAM_D0F0_', '_RAM_D0EE_', '_RAM_D0F3_', '_RAM_D0ED_', 'call _LABEL_9C3_'],
    reason: 'Captures raw upload setup, default bank latch, record-parser call, bank switch, and restore flow.',
  },
  {
    id: 'dynamic_9c3_record_parse_sample',
    label: '_LABEL_9C3_',
    regionId: 'r2727',
    offset: '0x009C3',
    asmLineEvidence: [2310, 2311, 2346, 2349, 2351, 2353, 2359],
    eventKind: 'record_parser_source_bank',
    captureFields: ['HL record cursor', '_RAM_D0F2_', 'source record word', 'sourceRecordHighByte >> 1', '_RAM_D0F3_', '_RAM_D0EE_'],
    reason: 'Parses the dynamic source record and derives the source bank latch used by 998/A97 uploads.',
  },
  {
    id: 'dynamic_9c3_zero_fill_sample',
    label: '_LABEL_9C3_',
    regionId: 'r2727',
    offset: '0x009E0',
    asmLineEvidence: [2328, 2333, 2335, 2340, 2343],
    eventKind: 'record_parser_zero_fill',
    captureFields: ['zero-fill marker $7F', '_RAM_D0F0_', '_RAM_D0ED_', 'VDP zero block'],
    reason: 'Separates real source-record transfers from zero-fill records so source coverage is not over-promoted.',
  },
  {
    id: 'dynamic_a14_raw_upload_sample',
    label: '_LABEL_A14_',
    regionId: 'r2728',
    offset: '0x00A14',
    asmLineEvidence: [2362, 2367, 2373, 2375, 2379, 2384],
    eventKind: 'raw_tile_transfer_loop',
    captureFields: ['_RAM_D0F0_', '_RAM_D0EE_', '_RAM_D0F2_', 'VDP bytes written by rst $30'],
    reason: 'Captures the raw 998 tile-block upload loop after _LABEL_9C3_ has selected the source bank.',
  },
  {
    id: 'dynamic_a97_decode_entry_sample',
    label: '_LABEL_A97_',
    regionId: 'r2100',
    offset: '0x00A97',
    asmLineEvidence: [2453, 2454, 2459, 2461, 2463, 2465],
    eventKind: 'a97_decode_entry',
    captureFields: ['DE destination', '_RAM_D0F0_', '_RAM_D0F3_', '_RAM_D0ED_', 'call _LABEL_9C3_'],
    reason: 'Captures the decoded upload route that reuses _LABEL_9C3_ source-record parsing.',
  },
  {
    id: 'dynamic_a97_vdp_destination_sample',
    label: '_LABEL_A97_',
    regionId: 'r2100',
    offset: '0x00AAE',
    asmLineEvidence: [2472, 2474, 2476, 2479, 2487, 2494, 2496, 2497],
    eventKind: 'a97_vdp_destination',
    captureFields: ['_RAM_D0F0_', 'VDP address', '_RAM_D0ED_', '_RAM_D0F2_', 'decoded row transfer'],
    reason: 'Connects decoded A97 output to the synthetic SMS VRAM destination slots.',
  },
  {
    id: 'dynamic_919_alternate_guard_sample',
    label: '_LABEL_919_',
    regionId: 'r2006',
    offset: '0x00919',
    asmLineEvidence: [2211, 2220, 2231, 2244, 2252, 2255, 2263, 2271],
    eventKind: 'alternate_8fb_record_guard',
    captureFields: ['_RAM_D0F2_', '_RAM_D0F0_', '_RAM_D0F3_', '_RAM_D0EE_', 'VDP raw upload'],
    reason: 'Records the secondary 8FB-style record route as a guardrail when the priority queue prefers 998/A97.',
  },
  {
    id: 'dynamic_998_a97_promotion_gate',
    label: 'metadata_gate',
    regionId: null,
    offset: null,
    asmLineEvidence: [],
    eventKind: 'coverage_promotion_gate',
    captureFields: traceProofFields,
    reason: 'Promotes no dynamic graphics coverage until selector, parser, bank, transfer, VDP, and local-source evidence agree in the same frame.',
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  return parseInt(value.replace(/^\$/, '0x'), 16);
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value != null && value !== ''))].sort((a, b) => {
    const aNum = parseOffset(a);
    const bNum = parseOffset(b);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    return String(a).localeCompare(String(b));
  });
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

function compactEventPoint(mapData, spec) {
  const region = spec.regionId ? compactRegion(findRegionById(mapData, spec.regionId)) : null;
  return {
    id: spec.id,
    label: spec.label,
    region,
    offset: spec.offset,
    asmLineEvidence: spec.asmLineEvidence,
    eventKind: spec.eventKind,
    captureFields: spec.captureFields,
    reason: spec.reason,
    runtimeHookStatus: spec.id === 'dynamic_998_a97_promotion_gate'
      ? 'metadata_gate_ready_runtime_trace_pending'
      : 'runtime_hook_needed',
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedInstructionByteCount: 0,
  };
}

function routeForEntry(entry, routeId = targetRouteId) {
  return (entry.routePriority?.routeOrder || []).find(route => route.id === routeId) || null;
}

function compactRoute(route) {
  if (!route) return null;
  return {
    id: route.id,
    priority: route.priority,
    routineLabels: route.routineLabels || [],
    parserLabels: route.parserLabels || [],
    callerLabels: route.callerLabels || [],
    bankFormula: route.bankFormula || '',
    traceStatus: route.traceStatus || '',
    selectorState: route.selectorState || [],
    confidence: route.confidence || '',
    routines: route.routines || [],
    callsites: route.callsites || [],
  };
}

function expectedSourceBankFromHighBytes(highBytes) {
  return uniqueSorted((highBytes || []).map(value => {
    const parsed = parseOffset(value);
    if (!Number.isFinite(parsed)) return null;
    return `0x${(parsed >> 1).toString(16).toUpperCase().padStart(2, '0')}`;
  }));
}

function a97VerifierEntriesBySpan(a97Verifier) {
  const entries = a97Verifier?.entries || a97Verifier?.verificationEntries || [];
  return new Map(entries.map(entry => [entry.spanId || entry.id, entry]));
}

function buildTracePlan(entry, eventPointIds, a97VerifierBySpan) {
  const primaryRoute = routeForEntry(entry, targetRouteId);
  const alternateRoutes = (entry.routePriority?.routeOrder || [])
    .filter(route => route.id !== targetRouteId)
    .map(compactRoute);
  const sourceRecordHighBytes = entry.sourceRecordHighBytes || [];
  const expectedSourceBanks = expectedSourceBankFromHighBytes(sourceRecordHighBytes);
  const a97Local = a97VerifierBySpan.get(entry.spanId) || null;
  const isA97Focus = entry.routePriority?.priorityAction === 'trace_a97_dynamic_decode_route';
  const isConsumerProofNeeded = entry.routePriority?.priorityAction === 'trace_real_consumer_before_coverage';

  return {
    id: `${entry.spanId}_998_a97_frame_trace_scaffold`,
    spanId: entry.spanId,
    sourcePriorityEntryId: entry.id || '',
    routeId: targetRouteId,
    priorityAction: entry.routePriority?.priorityAction || '',
    traceStatus: `${entry.routePriority?.priorityAction || 'dynamic_route'}_frame_trace_scaffold_ready_runtime_trace_pending`,
    region: entry.region,
    range: entry.range,
    sourceBank: entry.sourceBank,
    sourceRecordHighBytes,
    sourceRecordWords: entry.sourceRecordWords || [],
    expectedSourceBanks,
    expectedD0F3Values: expectedSourceBanks,
    localVerification: entry.localVerification || null,
    nonblankTileCount: entry.nonblankTileCount || 0,
    primaryRoute: compactRoute(primaryRoute),
    alternateRoutes,
    candidateConsumers: {
      itemRawUploadCallsite: (primaryRoute?.callsites || []).find(callsite => callsite.callerLabel === '_LABEL_1BE0_') || null,
      entityA97DecodeCallsite: (primaryRoute?.callsites || []).find(callsite => callsite.callerLabel === '_LABEL_29E6_') || null,
      alternate8fbRoute: alternateRoutes.find(route => route?.id === 'record_derived_8fb_path') || null,
    },
    ramTraceSeeds: entry.routePriority?.tracePrerequisites || [],
    traceEventPointIds: eventPointIds,
    expectedVdpDestinationModel: {
      destinationRam: '_RAM_D0F0_',
      sourcePointerRam: '_RAM_D0EE_',
      tileCountRam: '_RAM_D0F2_',
      progressRam: '_RAM_D0ED_',
      bankLatchRam: '_RAM_D0F3_',
      rawUploadRoutine: '_LABEL_A14_',
      decodedUploadRoutine: '_LABEL_A97_',
      unresolvedUntilRuntimeTrace: true,
    },
    a97DecodeGuard: isA97Focus
      ? {
          status: 'a97_decode_route_local_verified_runtime_trace_pending',
          sourceRecordWords: entry.sourceRecordWords || [],
          localVerifierCatalogId: sourceCatalogIds.playerA97TraceLocalVerifier,
          localVerification: a97Local?.localVerification || a97Local || null,
          rule: 'Promote only if the same-frame trace proves _LABEL_A97_ consumed the matching _LABEL_9C3_ source record and wrote the expected VDP destination.',
        }
      : null,
    consumerProofGuard: isConsumerProofNeeded
      ? {
          status: 'real_consumer_required_before_coverage',
          rule: 'The local source bytes verify, but coverage remains blocked until a concrete item/entity caller path is traced to the matching source record.',
        }
      : null,
    promotionGate: {
      sameFrameRequired: true,
      requiredEvidence: traceProofFields,
      runtimeTraceConfirmed: false,
      promotionReady: false,
      coverageChangedByThisAudit: false,
    },
    evidenceCatalogs: uniqueSorted([
      sourceCatalogIds.dynamicRoutePriority,
      sourceCatalogIds.dynamicSourceLocalVerifier,
      sourceCatalogIds.runtimeEffectIndex,
      sourceCatalogIds.runtimeRamTraceSeed,
      ...(isA97Focus ? [
        sourceCatalogIds.playerA48NonmatchA97TraceSeed,
        sourceCatalogIds.playerA97TraceLocalVerifier,
      ] : []),
      ...(entry.evidenceCatalogs || []),
    ]),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
  };
}

function buildCatalog(mapData) {
  const routeCatalog = requireCatalog(mapData, sourceCatalogIds.dynamicRoutePriority);
  for (const id of Object.values(sourceCatalogIds)) requireCatalog(mapData, id);
  const a97Verifier = requireCatalog(mapData, sourceCatalogIds.playerA97TraceLocalVerifier);
  const a97BySpan = a97VerifierEntriesBySpan(a97Verifier);
  const traceEventPoints = eventPointSpecs.map(spec => compactEventPoint(mapData, spec));
  const eventPointIds = traceEventPoints.map(point => point.id);
  const tracePlans = (routeCatalog.entries || [])
    .filter(entry => entry.routePriority?.primaryRouteId === targetRouteId)
    .map(entry => buildTracePlan(entry, eventPointIds, a97BySpan))
    .sort((a, b) => {
      const actionRank = {
        trace_real_consumer_before_coverage: 0,
        trace_a97_dynamic_decode_route: 1,
        trace_verified_dynamic_bank_route: 2,
      };
      return (actionRank[a.priorityAction] ?? 9) - (actionRank[b.priorityAction] ?? 9) ||
        (b.localVerification?.sourceByteCount || 0) - (a.localVerification?.sourceByteCount || 0) ||
        parseOffset(a.range?.start) - parseOffset(b.range?.start);
    });

  const allRamSeeds = [...new Map(tracePlans
    .flatMap(plan => plan.ramTraceSeeds || [])
    .map(seed => [seed.address || seed.symbol, seed])).values()];
  const routeRoutineRegionIds = uniqueSorted(tracePlans.flatMap(plan =>
    [
      ...(plan.primaryRoute?.routines || []).map(routine => routine.region?.id),
      ...(plan.alternateRoutes || []).flatMap(route => (route?.routines || []).map(routine => routine.region?.id)),
    ]
  ));
  const routeCallerRegionIds = uniqueSorted(tracePlans.flatMap(plan =>
    (plan.primaryRoute?.callsites || []).map(callsite => callsite.callerRegion?.id)
  ));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: offsets, labels, region ids, RAM symbols, source-record words, route ids, counts, ASM line references, trace fields, and proof gates. No ROM bytes, decoded graphics, pixels, screenshots, hashes, audio, text, or ASM instruction bytes are embedded.',
    target: {
      upstreamCatalogId: sourceCatalogIds.dynamicRoutePriority,
      routeId: targetRouteId,
      reason: 'Turn the 20 non-A48 dynamic graphics route-priority entries into concrete 998/A97 frame-trace event points so source spans can be proven before coverage promotion.',
    },
    summary: {
      tracePlanEntryCount: tracePlans.length,
      traceEventPointCount: traceEventPoints.length,
      candidatePayloadConsumerTraceCount: tracePlans.filter(plan => plan.priorityAction === 'trace_real_consumer_before_coverage').length,
      verifiedDynamicBankTraceCount: tracePlans.filter(plan => plan.priorityAction === 'trace_verified_dynamic_bank_route').length,
      a97DynamicDecodeTraceCount: tracePlans.filter(plan => plan.priorityAction === 'trace_a97_dynamic_decode_route').length,
      seedRegionCount: new Set(tracePlans.map(plan => plan.region?.id).filter(Boolean)).size,
      seedRegionIds: uniqueSorted(tracePlans.map(plan => plan.region?.id)),
      sourceBankCount: new Set(tracePlans.map(plan => plan.sourceBank).filter(Boolean)).size,
      sourceBanks: uniqueSorted(tracePlans.map(plan => plan.sourceBank)),
      sourceRecordHighBytes: uniqueSorted(tracePlans.flatMap(plan => plan.sourceRecordHighBytes || [])),
      sourceRecordWords: uniqueSorted(tracePlans.flatMap(plan => plan.sourceRecordWords || [])),
      sourceByteCount: sumBy(tracePlans, plan => plan.localVerification?.sourceByteCount || plan.range?.sizeBytes || 0),
      localNonzeroByteCount: sumBy(tracePlans, plan => plan.localVerification?.nonzeroByteCount || 0),
      nonblankTileCount: sumBy(tracePlans, plan => plan.nonblankTileCount || 0),
      routeRoutineRegionIds,
      routeCallerRegionIds,
      ramTraceSeedCount: allRamSeeds.length,
      priorityActionCounts: countBy(tracePlans, plan => plan.priorityAction),
      traceStatusCounts: countBy(tracePlans, plan => plan.traceStatus),
      eventKindCounts: countBy(traceEventPoints, point => point.eventKind),
      runtimeHookStatusCounts: countBy(traceEventPoints, point => point.runtimeHookStatus),
      runtimeTraceConfirmedCount: 0,
      promotionReadyCount: 0,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    traceEventPoints,
    ramTraceSeeds: allRamSeeds,
    tracePlans,
    evidence: [
      `${sourceCatalogIds.dynamicRoutePriority} marks 20 locally verified dynamic graphics entries with ${targetRouteId} as the primary route.`,
      'ASM line evidence ties _LABEL_99B_ and _LABEL_A97_ to _LABEL_9C3_ parsing, _RAM_D0F3_ bank latching, _LABEL_1023_ bank switching, and VDP output via _LABEL_A14_ or the A97 decoded loop.',
      'This scaffold records runtime hooks and proof gates only. Runtime confirmation and coverage promotion remain zero until same-frame traces prove a real item/entity consumer path.',
    ],
    nextLeads: [
      'Instrument _LABEL_1BE0_, _LABEL_29E6_, _LABEL_99B_, _LABEL_9C3_, _LABEL_A14_, and _LABEL_A97_ so each dynamic upload emits selector, source-record, bank, and VDP destination events.',
      'Trace the two candidate-payload entries first because their local bytes are verified but the real consumer is still unproven.',
      'Use the four A97-focused r2656 single-tile seeds to verify decoded-row output and then generalize the trace hook to the remaining dynamic-bank entries.',
    ],
  };
}

function addRegionDetail(details, regionId, role, plan = null) {
  if (!regionId) return;
  if (!details.has(regionId)) {
    details.set(regionId, {
      roles: new Set(),
      spanIds: new Set(),
      priorityActions: new Set(),
      eventPointIds: new Set(),
      sourceByteCount: 0,
      sourceRecordWords: new Set(),
      sourceBanks: new Set(),
    });
  }
  const detail = details.get(regionId);
  detail.roles.add(role);
  if (!plan) return;
  detail.spanIds.add(plan.spanId);
  detail.priorityActions.add(plan.priorityAction);
  detail.sourceByteCount += plan.localVerification?.sourceByteCount || plan.range?.sizeBytes || 0;
  for (const id of plan.traceEventPointIds || []) detail.eventPointIds.add(id);
  for (const word of plan.sourceRecordWords || []) detail.sourceRecordWords.add(word);
  if (plan.sourceBank) detail.sourceBanks.add(plan.sourceBank);
}

function annotateRegions(mapData, catalog) {
  const details = new Map();
  const changedRegions = [];
  const missingRegions = [];

  for (const point of catalog.traceEventPoints || []) {
    addRegionDetail(details, point.region?.id, `dynamic_998_a97_${point.eventKind}_event_point`);
    if (point.region?.id) details.get(point.region.id).eventPointIds.add(point.id);
  }

  for (const plan of catalog.tracePlans || []) {
    addRegionDetail(details, plan.region?.id, 'dynamic_998_a97_seed_graphics_region', plan);
    for (const routine of plan.primaryRoute?.routines || []) {
      addRegionDetail(details, routine.region?.id, 'dynamic_998_a97_primary_route_routine', plan);
    }
    for (const callsite of plan.primaryRoute?.callsites || []) {
      addRegionDetail(details, callsite.callerRegion?.id, 'dynamic_998_a97_primary_route_caller', plan);
    }
    for (const route of plan.alternateRoutes || []) {
      for (const routine of route?.routines || []) {
        addRegionDetail(details, routine.region?.id, 'dynamic_998_a97_alternate_route_guard_routine', plan);
      }
    }
  }

  for (const [regionId, detail] of details) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: [...detail.roles].sort().join(',') });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.graphics998A97FrameTraceScaffoldAudit = {
        catalogId,
        role: [...detail.roles].sort().join(','),
        confidence: detail.roles.has('dynamic_998_a97_seed_graphics_region') ? 'medium' : 'medium_high',
        summary: 'Region participates in the 998/A97 dynamic graphics frame-trace scaffold that must prove consumer, parser, source bank, transfer loop, and VDP destination before coverage promotion.',
        detail: {
          spanIds: uniqueSorted([...detail.spanIds]),
          priorityActions: uniqueSorted([...detail.priorityActions]),
          eventPointIds: uniqueSorted([...detail.eventPointIds]),
          sourceByteCount: detail.sourceByteCount,
          sourceBanks: uniqueSorted([...detail.sourceBanks]),
          sourceRecordWords: uniqueSorted([...detail.sourceRecordWords]),
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
      eventPointIds: uniqueSorted([...detail.eventPointIds]),
    });
  }

  return { changedRegions, missingRegions };
}

function annotateRam(mapData, catalog) {
  const changedRam = [];
  const missingRam = [];
  for (const seed of catalog.ramTraceSeeds || []) {
    const ram = findRamByAddress(mapData, seed.address);
    if (!ram) {
      missingRam.push({ address: seed.address, symbol: seed.symbol, role: seed.role });
      continue;
    }
    if (apply) {
      ram.analysis = ram.analysis || {};
      ram.analysis.graphics998A97FrameTraceScaffoldAudit = {
        catalogId,
        symbol: seed.symbol,
        role: seed.role,
        confidence: 'medium_high',
        summary: 'RAM variable is part of the same-frame 998/A97 dynamic graphics trace proof before source coverage can be promoted.',
        tracePlanEntryCount: catalog.summary.tracePlanEntryCount,
        traceEventPointCount: catalog.summary.traceEventPointCount,
        runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      address: seed.address,
      symbol: seed.symbol,
      role: seed.role,
      confidence: 'medium_high',
    });
  }
  return { changedRam, missingRam };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    traceEventPoints: catalog.traceEventPoints.map(point => ({
      id: point.id,
      label: point.label,
      regionId: point.region?.id || null,
      eventKind: point.eventKind,
      runtimeHookStatus: point.runtimeHookStatus,
      captureFields: point.captureFields,
    })),
    topTracePlans: catalog.tracePlans.slice(0, 12).map(plan => ({
      spanId: plan.spanId,
      priorityAction: plan.priorityAction,
      range: plan.range,
      sourceBank: plan.sourceBank,
      sourceRecordWords: plan.sourceRecordWords,
      primaryRoutineLabels: plan.primaryRoute?.routineLabels || [],
      primaryCallerLabels: plan.primaryRoute?.callerLabels || [],
      expectedD0F3Values: plan.expectedD0F3Values,
      traceStatus: plan.traceStatus,
    })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
  mapData.graphicsCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'graphics_998_a97_frame_trace_scaffold_audit',
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
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function applyStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return null;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.graphics998A97FrameTraceScaffoldCatalog = catalogId;
  staticMap.summary.graphics998A97FrameTraceScaffoldEntries = catalog.summary.tracePlanEntryCount;
  staticMap.summary.graphics998A97FrameTraceScaffoldEventPoints = catalog.summary.traceEventPointCount;
  staticMap.summary.graphics998A97FrameTraceScaffoldCandidatePayloadEntries = catalog.summary.candidatePayloadConsumerTraceCount;
  staticMap.summary.graphics998A97FrameTraceScaffoldDynamicBankEntries = catalog.summary.verifiedDynamicBankTraceCount;
  staticMap.summary.graphics998A97FrameTraceScaffoldA97Entries = catalog.summary.a97DynamicDecodeTraceCount;
  staticMap.summary.graphics998A97FrameTraceScaffoldSourceBytes = catalog.summary.sourceByteCount;
  staticMap.summary.graphics998A97FrameTraceScaffoldRuntimeConfirmed = catalog.summary.runtimeTraceConfirmedCount;
  staticMap.summary.graphics998A97FrameTraceScaffoldCoverageChanged = catalog.summary.coverageChangedByThisAudit;

  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.graphics = insertAfter(
    staticMap.primaryCatalogs.graphics,
    sourceCatalogIds.dynamicRoutePriority,
    catalogId
  );
  staticMap.primaryCatalogs.rendering = insertAfter(
    staticMap.primaryCatalogs.rendering,
    'world-residual-fragment-confidence-backfill-catalog-2026-06-26',
    catalogId
  );
  staticMap.primaryCatalogs.coverage = insertAfter(
    staticMap.primaryCatalogs.coverage,
    sourceCatalogIds.dynamicRoutePriority,
    catalogId
  );

  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  const note = 'Use world-graphics-998-a97-frame-trace-scaffold-catalog-2026-06-26 to instrument _LABEL_1BE0_, _LABEL_29E6_, _LABEL_99B_, _LABEL_9C3_, _LABEL_A14_, and _LABEL_A97_ before promoting the 20 non-A48 dynamic graphics spans.';
  const anchor = staticMap.nextLeads.findIndex(noteText => noteText.includes(sourceCatalogIds.dynamicRoutePriority));
  if (anchor === -1) staticMap.nextLeads.push(note);
  else staticMap.nextLeads.splice(anchor + 1, 0, note);

  writeJson(staticMapPath, staticMap);
  return {
    staticMapPath: path.relative(repoRoot, staticMapPath),
    summaryFieldsUpdated: [
      'graphics998A97FrameTraceScaffoldCatalog',
      'graphics998A97FrameTraceScaffoldEntries',
      'graphics998A97FrameTraceScaffoldEventPoints',
      'graphics998A97FrameTraceScaffoldCandidatePayloadEntries',
      'graphics998A97FrameTraceScaffoldDynamicBankEntries',
      'graphics998A97FrameTraceScaffoldA97Entries',
      'graphics998A97FrameTraceScaffoldSourceBytes',
      'graphics998A97FrameTraceScaffoldRuntimeConfirmed',
      'graphics998A97FrameTraceScaffoldCoverageChanged',
    ],
    primaryCatalogBucketsUpdated: ['graphics', 'rendering', 'coverage'],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const regionAnnotation = annotateRegions(mapData, catalog);
  const ramAnnotation = annotateRam(mapData, catalog);
  const annotation = { ...regionAnnotation, ...ramAnnotation };
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
