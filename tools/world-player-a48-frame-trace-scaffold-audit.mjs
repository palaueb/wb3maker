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
const toolName = 'tools/world-player-a48-frame-trace-scaffold-audit.mjs';
const catalogId = 'world-player-a48-frame-trace-scaffold-catalog-2026-06-26';
const reportId = 'player-a48-frame-trace-scaffold-audit-2026-06-26';
const schemaVersion = 1;

const sourceCatalogIds = {
  selectorQueue: 'world-player-a48-selector-trace-queue-catalog-2026-06-26',
  dynamicRoutePriority: 'world-graphics-dynamic-route-priority-catalog-2026-06-26',
  playerFormStateMatrix: 'world-player-form-state-matrix-catalog-2026-06-26',
  runtimeEffectIndex: 'world-runtime-effect-index-catalog-2026-06-26',
  runtimeRamTraceSeed: 'world-runtime-ram-trace-seed-catalog-2026-06-26',
};

const traceProofFields = [
  'same_frame_selector_context',
  'command_cursor_before_after',
  'matched_command_pointer_offset',
  'a48_stream_offset',
  'source_record_word',
  'source_record_high_byte',
  'mapper_bank_write',
  'vdp_destination_base',
  'local_source_formula_verified',
];

const eventPointSpecs = [
  {
    id: 'a48_selector_context_sample',
    label: '_LABEL_137C_',
    regionId: 'r2136',
    offset: '0x0137C',
    asmLineEvidence: [3776, 3782],
    eventKind: 'selector_context',
    captureFields: ['_RAM_C24F_', '_RAM_C260_', '_RAM_C250_', 'active_form_state_row'],
    reason: 'Samples the outer player form selector path immediately before jumping to the animation command decoder.',
  },
  {
    id: 'a48_command_cursor_sample',
    label: '_LABEL_13A6_',
    regionId: 'r2138',
    offset: '0x013A6',
    asmLineEvidence: [3793, 3821],
    eventKind: 'command_cursor',
    captureFields: ['_RAM_C252_ before', '_RAM_C252_ after', 'command_pointer_offset', 'matched_catalog_pointer_offset'],
    reason: 'Proves which player animation command stream and pointer slot selected the A48 upload stream.',
  },
  {
    id: 'a48_vram_base_sample',
    label: '_LABEL_13A6_',
    regionId: 'r2138',
    offset: '0x013D5',
    asmLineEvidence: [3829, 3835],
    eventKind: 'vram_base_selector',
    captureFields: ['_RAM_C27F_ before', '_RAM_C27F_ after', 'expected_vdp_base'],
    reason: 'Captures the animation upload destination selector before _LABEL_A48_ writes VDP data.',
  },
  {
    id: 'a48_call_sample',
    label: '_LABEL_13A6_',
    regionId: 'r2138',
    offset: '0x013ED',
    asmLineEvidence: [3837],
    eventKind: 'a48_call',
    captureFields: ['call_target', 'current_command_cursor', 'same_frame_trace_id'],
    reason: 'Binds the decoded player command stream to the _LABEL_A48_ upload call in the same frame.',
  },
  {
    id: 'a48_stream_entry_sample',
    label: '_LABEL_A48_',
    regionId: 'r2099',
    offset: '0x00A48',
    asmLineEvidence: [2391],
    eventKind: 'a48_stream_entry',
    captureFields: ['stream_offset', 'source_record_word', 'tile_block_count', 'zero_fill_block_count', 'hl', 'de'],
    reason: 'Captures the A48 stream record that names the graphics source word and transfer length.',
  },
  {
    id: 'a48_source_bank_sample',
    label: '_LABEL_A48_',
    regionId: 'r2099',
    offset: '0x00A6F',
    asmLineEvidence: [2431, 2435],
    eventKind: 'source_bank_derivation',
    captureFields: ['source_record_high_byte', 'expected_source_bank = source_record_high_byte >> 1', '_RAM_FFFF_ write'],
    reason: 'Verifies the mapper bank used for the source record before any graphics coverage is promoted.',
  },
  {
    id: 'a48_mapper_write_sample',
    label: '_LABEL_A48_',
    regionId: 'r2099',
    offset: '0x00A6C',
    asmLineEvidence: [2431, 2435, 2450],
    eventKind: 'mapper_write_restore',
    captureFields: ['_RAM_DFFF_ previous_bank', '_RAM_FFFF_ source_bank_write', '_RAM_FFFF_ restore_write'],
    reason: 'Proves the upload used the bank expected from the source record and restored the previous bank.',
  },
  {
    id: 'a48_vdp_destination_sample',
    label: '_LABEL_A48_',
    regionId: 'r2099',
    offset: '0x00A4A',
    asmLineEvidence: [2392, 2393, 2396, 2400],
    eventKind: 'vdp_destination',
    captureFields: ['_RAM_C27F_', 'vdp_base $4000 or $4200', 'vram_slot_range', 'byte_count'],
    reason: 'Connects the upload stream to the synthetic SMS VRAM tile slots that the renderer later consumes.',
  },
  {
    id: 'a48_promotion_gate',
    label: 'metadata_gate',
    regionId: null,
    offset: null,
    asmLineEvidence: [],
    eventKind: 'coverage_promotion_gate',
    captureFields: traceProofFields,
    reason: 'Promotes no coverage until selector, stream, mapper, source, and VDP evidence all agree for the same frame.',
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

function compactStream(stream) {
  return {
    streamOffset: stream.streamOffset,
    streamRegion: compactRegion(stream.streamRegion),
    confidence: stream.confidence || '',
    sourceWords: stream.sourceWords || [],
    sourceRecordCount: stream.sourceRecordCount || 0,
    totalTileBlocks: stream.totalTileBlocks || 0,
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
    runtimeHookStatus: spec.id === 'a48_promotion_gate'
      ? 'metadata_gate_ready_runtime_trace_pending'
      : 'runtime_hook_needed',
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedInstructionByteCount: 0,
  };
}

function expectedVdpDestinationModel() {
  return {
    selectorRam: '_RAM_C27F_',
    zeroSelectorVdpCommandHighByte: '$40',
    nonzeroSelectorVdpCommandHighByte: '$42',
    model: '_LABEL_A48_ loads VDP command high byte $40 when _RAM_C27F_ is zero and $42 when it is nonzero; trace must convert this into concrete VRAM tile slot ranges.',
    unresolvedUntilRuntimeTrace: true,
  };
}

function buildTracePlanEntry(entry, eventPointIds) {
  const isAcceptedGap = entry.queueKind === 'accepted_a48_gap_selector_trace';
  const knownStreams = (entry.a48StreamEvidence?.knownStreams || []).map(compactStream);
  const gapStreams = (entry.a48StreamEvidence?.acceptedGapStreams || []).map(stream => ({
    ...compactStream(stream),
    gapId: stream.gapId || '',
    hasKnownPointerReference: Boolean(stream.hasKnownPointerReference),
    previousStreamOffset: stream.previousStreamOffset || '',
    nextStreamOffset: stream.nextStreamOffset || '',
    neighborsHaveHighConfidenceCommandReferences: Boolean(stream.neighborsHaveHighConfidenceCommandReferences),
  }));

  return {
    id: `${entry.spanId}_a48_frame_trace_scaffold`,
    spanId: entry.spanId,
    sourceQueueEntryId: entry.id,
    queueKind: entry.queueKind,
    priority: entry.priority,
    traceStatus: isAcceptedGap
      ? 'accepted_gap_frame_trace_scaffold_ready_runtime_trace_pending'
      : 'known_a48_frame_trace_scaffold_ready_runtime_trace_pending',
    region: entry.region,
    range: entry.range,
    sourceBank: entry.sourceBank,
    sourceRecordHighBytes: entry.sourceRecordHighBytes || [],
    sourceRecordWords: entry.sourceRecordWords || [],
    expectedSourceBank: entry.sourceBank,
    expectedSourceRecordHighBytes: entry.sourceRecordHighBytes || [],
    localVerification: entry.localVerification,
    candidateA48Streams: {
      knownStreamCount: knownStreams.length,
      knownStreams,
      acceptedGapCandidateStreamCount: gapStreams.length,
      acceptedGapCandidateStreams: gapStreams,
      allStreamOffsets: uniqueSorted([
        ...knownStreams.map(stream => stream.streamOffset),
        ...gapStreams.map(stream => stream.streamOffset),
      ]),
    },
    commandSelectorInputs: {
      status: entry.commandSelectorEvidence?.status || '',
      commandPointerOffsets: entry.commandSelectorEvidence?.uniquePointerOffsets || [],
      commandStreamOffsets: entry.commandSelectorEvidence?.uniquePlayerCommandStreamOffsets || [],
      selectedByFormIndices: entry.commandSelectorEvidence?.selectedByFormIndices || [],
      selectedByVariantCount: entry.commandSelectorEvidence?.selectedByVariantCount || 0,
      formStateContext: entry.formStateContext || null,
    },
    traceEventPointIds: eventPointIds,
    expectedVdpDestinationModel: expectedVdpDestinationModel(),
    acceptedGapGuard: isAcceptedGap
      ? {
          status: 'guarded_unpromoted_gap_candidate',
          knownPointerReferenceCount: entry.a48StreamEvidence?.acceptedGapKnownPointerReferenceCount || 0,
          candidateStreamOffsets: gapStreams.map(stream => stream.streamOffset),
          rule: 'Do not promote this source span until a frame trace proves that one accepted gap stream is reached by the player command selector and uploads the matching source record.',
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
      sourceCatalogIds.selectorQueue,
      sourceCatalogIds.dynamicRoutePriority,
      sourceCatalogIds.playerFormStateMatrix,
      sourceCatalogIds.runtimeEffectIndex,
      sourceCatalogIds.runtimeRamTraceSeed,
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
  const selectorQueue = requireCatalog(mapData, sourceCatalogIds.selectorQueue);
  for (const id of Object.values(sourceCatalogIds)) requireCatalog(mapData, id);

  const traceEventPoints = eventPointSpecs.map(spec => compactEventPoint(mapData, spec));
  const eventPointIds = traceEventPoints.map(point => point.id);
  const tracePlans = (selectorQueue.entries || []).map(entry => buildTracePlanEntry(entry, eventPointIds));
  const knownPlans = tracePlans.filter(plan => plan.queueKind === 'known_a48_command_selector_trace');
  const acceptedGapPlans = tracePlans.filter(plan => plan.queueKind === 'accepted_a48_gap_selector_trace');
  const allKnownStreams = tracePlans.flatMap(plan => plan.candidateA48Streams.knownStreams || []);
  const allGapStreams = tracePlans.flatMap(plan => plan.candidateA48Streams.acceptedGapCandidateStreams || []);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: offsets, labels, region ids, RAM symbols, form/variant indexes, stream offsets, counts, ASM line references, trace fields, and proof gates. No ROM bytes, decoded graphics, pixels, screenshots, hashes, audio, text, or ASM instruction bytes are embedded.',
    target: {
      upstreamCatalogId: sourceCatalogIds.selectorQueue,
      reason: 'Turn the A48 selector trace queue into concrete frame-trace event points so dynamic player graphics can be proven before coverage promotion.',
    },
    summary: {
      tracePlanEntryCount: tracePlans.length,
      knownA48TracePlanCount: knownPlans.length,
      acceptedGapTracePlanCount: acceptedGapPlans.length,
      traceEventPointCount: traceEventPoints.length,
      selectorRamTraceSeedCount: (selectorQueue.selectorRamTraceSeeds || []).length,
      sourceByteCount: sumBy(tracePlans, plan => plan.localVerification?.sourceByteCount || 0),
      localNonzeroByteCount: sumBy(tracePlans, plan => plan.localVerification?.nonzeroByteCount || 0),
      candidateA48StreamCount: uniqueSorted([
        ...allKnownStreams.map(stream => stream.streamOffset),
        ...allGapStreams.map(stream => stream.streamOffset),
      ]).length,
      knownA48StreamCount: uniqueSorted(allKnownStreams.map(stream => stream.streamOffset)).length,
      acceptedGapCandidateStreamCount: uniqueSorted(allGapStreams.map(stream => stream.streamOffset)).length,
      commandStreamCount: uniqueSorted(tracePlans.flatMap(plan => plan.commandSelectorInputs.commandStreamOffsets || [])).length,
      commandPointerOffsetCount: uniqueSorted(tracePlans.flatMap(plan => plan.commandSelectorInputs.commandPointerOffsets || [])).length,
      selectedByFormIndices: uniqueSorted(tracePlans.flatMap(plan => plan.commandSelectorInputs.selectedByFormIndices || [])),
      queueKindCounts: countBy(tracePlans, plan => plan.queueKind),
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
    selectorRamTraceSeeds: selectorQueue.selectorRamTraceSeeds || [],
    tracePlans,
    evidence: [
      `${sourceCatalogIds.selectorQueue} supplies 11 A48-primary dynamic graphics entries and the RAM variables required for selector traces.`,
      'ASM line evidence ties _LABEL_137C_ to selector context sampling, _LABEL_13A6_ to command cursor/VRAM-base/call flow, and _LABEL_A48_ to stream records, mapper writes, and VDP byte output.',
      'The scaffold records runtime hooks and proof gates only. Runtime confirmation and coverage promotion remain zero until same-frame traces prove the actual path.',
    ],
    nextLeads: [
      'Instrument _LABEL_137C_, _LABEL_13A6_, and _LABEL_A48_ in the analyzer emulator trace harness so each A48 upload emits selector, command cursor, stream, mapper, and VDP destination events.',
      'Trace the 10 known-A48 entries first and require all proof fields in the same frame before marking their graphics source spans as runtime confirmed.',
      'Trace or reject the accepted gap candidate streams 0x1BD89, 0x1BD8D, and 0x1BD96 before promoting the 576-byte r2645 span.',
    ],
  };
}

function addRegionDetail(details, regionId, role, plan = null) {
  if (!regionId) return;
  if (!details.has(regionId)) {
    details.set(regionId, {
      roles: new Set(),
      spanIds: new Set(),
      queueKinds: new Set(),
      eventPointIds: new Set(),
      sourceByteCount: 0,
      streamOffsets: new Set(),
      commandStreamOffsets: new Set(),
      commandPointerOffsets: new Set(),
    });
  }
  const detail = details.get(regionId);
  detail.roles.add(role);
  if (!plan) return;
  detail.spanIds.add(plan.spanId);
  detail.queueKinds.add(plan.queueKind);
  detail.sourceByteCount += plan.localVerification?.sourceByteCount || 0;
  for (const id of plan.traceEventPointIds || []) detail.eventPointIds.add(id);
  for (const offset of plan.candidateA48Streams?.allStreamOffsets || []) detail.streamOffsets.add(offset);
  for (const offset of plan.commandSelectorInputs?.commandStreamOffsets || []) detail.commandStreamOffsets.add(offset);
  for (const offset of plan.commandSelectorInputs?.commandPointerOffsets || []) detail.commandPointerOffsets.add(offset);
}

function annotateRegions(mapData, catalog) {
  const details = new Map();
  const changedRegions = [];
  const missingRegions = [];

  for (const point of catalog.traceEventPoints || []) {
    addRegionDetail(details, point.region?.id, `a48_frame_trace_${point.eventKind}_event_point`);
    if (point.region?.id) details.get(point.region.id).eventPointIds.add(point.id);
  }

  for (const plan of catalog.tracePlans || []) {
    addRegionDetail(details, plan.region?.id, 'a48_frame_trace_seed_graphics_region', plan);
    for (const stream of plan.candidateA48Streams?.knownStreams || []) {
      addRegionDetail(details, stream.streamRegion?.id, 'a48_frame_trace_known_stream_region', plan);
    }
    for (const stream of plan.candidateA48Streams?.acceptedGapCandidateStreams || []) {
      addRegionDetail(details, stream.streamRegion?.id, 'a48_frame_trace_accepted_gap_stream_region', plan);
    }
    for (const regionId of (findCatalog(mapData, sourceCatalogIds.selectorQueue)?.entries || [])
      .find(entry => entry.spanId === plan.spanId)?.commandSelectorEvidence?.playerCommandStreamRegionIds || []) {
      addRegionDetail(details, regionId, 'a48_frame_trace_player_command_stream_region', plan);
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
      region.analysis.playerA48FrameTraceScaffoldAudit = {
        catalogId,
        role: [...detail.roles].sort().join(','),
        confidence: detail.roles.has('a48_frame_trace_accepted_gap_stream_region') ? 'medium' : 'medium_high',
        summary: 'Region is part of the A48 frame-trace scaffold that will prove selector context, command stream, source record, mapper bank, and VDP destination before dynamic player graphics coverage is promoted.',
        detail: {
          spanIds: uniqueSorted([...detail.spanIds]),
          queueKinds: uniqueSorted([...detail.queueKinds]),
          eventPointIds: uniqueSorted([...detail.eventPointIds]),
          sourceByteCount: detail.sourceByteCount,
          streamOffsets: uniqueSorted([...detail.streamOffsets]),
          commandStreamOffsets: uniqueSorted([...detail.commandStreamOffsets]),
          commandPointerOffsets: uniqueSorted([...detail.commandPointerOffsets]),
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
      eventPointIds: uniqueSorted([...detail.eventPointIds]),
    });
  }

  return { changedRegions, missingRegions };
}

function annotateRam(mapData, catalog) {
  const changedRam = [];
  const missingRam = [];
  for (const seed of catalog.selectorRamTraceSeeds || []) {
    const ram = findRamByAddress(mapData, seed.address);
    if (!ram) {
      missingRam.push({ address: seed.address, symbol: seed.symbol, role: seed.role });
      continue;
    }
    if (apply) {
      ram.analysis = ram.analysis || {};
      ram.analysis.playerA48FrameTraceScaffoldAudit = {
        catalogId,
        symbol: seed.symbol,
        role: seed.role,
        confidence: seed.confidence || 'medium_high',
        summary: 'RAM variable must be captured in same-frame A48 player-animation traces before dynamic graphics source spans can be promoted.',
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
      confidence: seed.confidence || 'medium_high',
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
      queueKind: plan.queueKind,
      priority: plan.priority,
      range: plan.range,
      sourceBank: plan.sourceBank,
      sourceRecordWords: plan.sourceRecordWords,
      candidateA48Streams: plan.candidateA48Streams.allStreamOffsets,
      commandStreamOffsets: plan.commandSelectorInputs.commandStreamOffsets,
      commandPointerOffsets: plan.commandSelectorInputs.commandPointerOffsets,
      selectedByFormIndices: plan.commandSelectorInputs.selectedByFormIndices,
      traceStatus: plan.traceStatus,
    })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(item => item.id !== catalogId);
  mapData.playerCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'player_a48_frame_trace_scaffold_audit',
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
  staticMap.summary.playerA48FrameTraceScaffoldCatalog = catalogId;
  staticMap.summary.playerA48FrameTraceScaffoldEntries = catalog.summary.tracePlanEntryCount;
  staticMap.summary.playerA48FrameTraceScaffoldEventPoints = catalog.summary.traceEventPointCount;
  staticMap.summary.playerA48FrameTraceScaffoldKnownEntries = catalog.summary.knownA48TracePlanCount;
  staticMap.summary.playerA48FrameTraceScaffoldAcceptedGapEntries = catalog.summary.acceptedGapTracePlanCount;
  staticMap.summary.playerA48FrameTraceScaffoldCandidateStreams = catalog.summary.candidateA48StreamCount;
  staticMap.summary.playerA48FrameTraceScaffoldRuntimeConfirmed = catalog.summary.runtimeTraceConfirmedCount;
  staticMap.summary.playerA48FrameTraceScaffoldCoverageChanged = catalog.summary.coverageChangedByThisAudit;

  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.graphics = insertAfter(
    staticMap.primaryCatalogs.graphics,
    sourceCatalogIds.selectorQueue,
    catalogId
  );
  staticMap.primaryCatalogs.gameplay = insertAfter(
    staticMap.primaryCatalogs.gameplay,
    sourceCatalogIds.selectorQueue,
    catalogId
  );
  staticMap.primaryCatalogs.coverage = insertAfter(
    staticMap.primaryCatalogs.coverage,
    sourceCatalogIds.selectorQueue,
    catalogId
  );

  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  const note = 'Use world-player-a48-frame-trace-scaffold-catalog-2026-06-26 to instrument _LABEL_137C_, _LABEL_13A6_, and _LABEL_A48_ before promoting the 11 A48-primary dynamic player graphics spans.';
  const anchor = staticMap.nextLeads.findIndex(noteText => noteText.includes(sourceCatalogIds.selectorQueue));
  if (anchor === -1) staticMap.nextLeads.push(note);
  else staticMap.nextLeads.splice(anchor + 1, 0, note);

  writeJson(staticMapPath, staticMap);
  return {
    staticMapPath: path.relative(repoRoot, staticMapPath),
    summaryFieldsUpdated: [
      'playerA48FrameTraceScaffoldCatalog',
      'playerA48FrameTraceScaffoldEntries',
      'playerA48FrameTraceScaffoldEventPoints',
      'playerA48FrameTraceScaffoldKnownEntries',
      'playerA48FrameTraceScaffoldAcceptedGapEntries',
      'playerA48FrameTraceScaffoldCandidateStreams',
      'playerA48FrameTraceScaffoldRuntimeConfirmed',
      'playerA48FrameTraceScaffoldCoverageChanged',
    ],
    primaryCatalogBucketsUpdated: ['graphics', 'gameplay', 'coverage'],
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
