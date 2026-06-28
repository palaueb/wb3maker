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
const toolName = 'tools/world-player-a48-selector-trace-queue-audit.mjs';
const catalogId = 'world-player-a48-selector-trace-queue-catalog-2026-06-26';
const reportId = 'player-a48-selector-trace-queue-audit-2026-06-26';
const schemaVersion = 1;

const sourceCatalogIds = {
  dynamicRoutePriority: 'world-graphics-dynamic-route-priority-catalog-2026-06-26',
  playerA48DynamicSeedLink: 'world-player-a48-dynamic-seed-link-catalog-2026-06-26',
  playerA48CommandConfidenceTrace: 'world-player-a48-command-confidence-trace-catalog-2026-06-26',
  playerFormStateMatrix: 'world-player-form-state-matrix-catalog-2026-06-26',
  playerA48TileStream: 'world-player-a48-tile-stream-catalog-2026-06-26',
  playerA48GapCandidate: 'world-player-a48-gap-candidate-catalog-2026-06-26',
};

const a48PrimaryRouteId = 'record_derived_a48_player_animation_path';
const knownA48Action = 'trace_player_a48_command_selector';
const acceptedGapAction = 'trace_accepted_a48_gap_selector';

const selectorRamTraceSeeds = [
  { symbol: '_RAM_C24F_', address: '$C24F', role: 'outer_player_form_dispatch_selector', confidence: 'high' },
  { symbol: '_RAM_C260_', address: '$C260', role: 'inner_player_state_dispatch_selector', confidence: 'high' },
  { symbol: '_RAM_C250_', address: '$C250', role: 'player_animation_delay_counter', confidence: 'medium_high' },
  { symbol: '_RAM_C24C_', address: '$C24C', role: 'player_frame_pointer_latch', confidence: 'high' },
  { symbol: '_RAM_C252_', address: '$C252', role: 'next_player_command_cursor', confidence: 'high' },
  { symbol: '_RAM_C27F_', address: '$C27F', role: 'a48_vram_destination_base_selector', confidence: 'high' },
  { symbol: '_RAM_DFFF_', address: '$DFFF', role: 'previous_mapper_bank_restore_context', confidence: 'medium_high' },
  { symbol: '_RAM_FFFF_', address: '$FFFF', role: 'mapper_page2_bank_write_from_a48_source_record', confidence: 'high' },
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

function compactSelectedBy(selectedBy) {
  return (selectedBy || []).slice(0, 32).map(item => ({
    formIndex: item.formIndex,
    formEntryOffset: item.formEntryOffset,
    variantIndex: item.variantIndex,
    variantPointerOffset: item.variantPointerOffset,
    streamZ80Pointer: item.streamZ80Pointer,
  }));
}

function selectedByFromCommandTrace(commandTrace) {
  return (commandTrace?.a48Streams || [])
    .flatMap(stream => stream.commandStreams || [])
    .flatMap(stream => stream.selectedBy || []);
}

function commandStreamsFromCommandTrace(commandTrace) {
  return (commandTrace?.a48Streams || []).flatMap(stream => stream.commandStreams || []);
}

function commandReferencesFromCommandTrace(commandTrace) {
  return (commandTrace?.a48Streams || []).flatMap(stream => stream.commandReferences || []);
}

function knownA48Streams(commandTrace) {
  return (commandTrace?.a48Streams || []).map(stream => ({
    streamOffset: stream.streamOffset,
    streamRegion: compactRegion(stream.streamRegion),
    confidence: stream.confidence || '',
    hasHighConfidenceCommandReference: Boolean(stream.hasHighConfidenceCommandReference),
    referencedByCount: stream.referencedByCount || 0,
    referencedByConfidences: stream.referencedByConfidences || [],
    sourceRecordCount: stream.sourceRecordCount || 0,
    totalTileBlocks: stream.totalTileBlocks || 0,
    issueCount: stream.issueCount || 0,
    overlappingSourceSpanCount: (stream.overlappingSourceSpans || []).length,
    sourceWords: uniqueSorted((stream.overlappingSourceSpans || []).map(span => span.sourceWord)),
  }));
}

function acceptedGapStreams(link) {
  return (link?.acceptedGapStreamSamples || []).map(stream => ({
    streamOffset: stream.streamOffset,
    streamRegion: compactRegion(stream.streamRegion),
    gapId: stream.gapId,
    confidence: stream.confidence || '',
    hasKnownPointerReference: Boolean(stream.hasKnownPointerReference),
    previousStreamOffset: stream.boundedBy?.previousStream?.streamOffset || '',
    nextStreamOffset: stream.boundedBy?.nextStream?.streamOffset || '',
    neighborsHaveHighConfidenceCommandReferences: Boolean(stream.boundedBy?.bothNeighborsHaveHighConfidenceCommandReferences),
    sourceRecordCount: stream.sourceRecordCount || 0,
    zeroFillTileBlocks: stream.zeroFillTileBlocks || 0,
    totalTileBlocks: stream.totalTileBlocks || 0,
    overlapSpanCount: stream.overlapSpanCount || 0,
    sourceWords: uniqueSorted((stream.overlappingSourceSpans || []).map(span => span.sourceWord)),
  }));
}

function formStateContext(formMatrix, formIndices) {
  const selected = new Set((formIndices || []).map(String));
  const outerRows = (formMatrix.outerRows || []).filter(row => selected.has(String(row.outerIndex)));
  const matrixRows = (formMatrix.matrixRows || []).filter(row => selected.has(String(row.outerIndex)));
  return {
    catalogId: sourceCatalogIds.playerFormStateMatrix,
    outerSelectorRam: formMatrix.dispatchModel?.outerSelectorRam || '_RAM_C24F_',
    outerSelectorMask: formMatrix.dispatchModel?.outerSelectorMask || '$07',
    innerSelectorRam: formMatrix.dispatchModel?.innerSelectorRam || '_RAM_C260_',
    innerSelectorMask: formMatrix.dispatchModel?.innerSelectorMask || '$0F',
    selectedOuterRows: outerRows.map(row => ({
      outerIndex: row.outerIndex,
      selectorValue: row.selectorValue,
      targetLabel: row.targetLabel,
      targetRegion: compactRegion(row.targetRegion),
      innerTableLabel: row.innerTableLabel,
      isNull: Boolean(row.isNull),
    })),
    selectedMatrixRowCount: matrixRows.length,
    selectedConcreteMatrixRowCount: matrixRows.filter(row => !row.isNull).length,
    selectedMechanicGroups: uniqueSorted(matrixRows.map(row => row.resolvedFlow?.mechanicGroup).filter(Boolean)),
    selectedFlowIds: uniqueSorted(matrixRows.map(row => row.resolvedFlow?.flowId).filter(Boolean)),
    limitation: 'Static form/state context narrows selector candidates but does not prove runtime reachability without frame traces.',
  };
}

function compactRouteRoutine(entry, label) {
  const route = (entry.routePriority?.routeOrder || []).find(item => item.id === a48PrimaryRouteId) || null;
  return (route?.routines || []).find(routine => routine.label === label) || null;
}

function compactRouteCallsite(entry, label) {
  const route = (entry.routePriority?.routeOrder || []).find(item => item.id === a48PrimaryRouteId) || null;
  return (route?.callsites || []).find(callsite => callsite.callerLabel === label) || null;
}

function buildEntry(routeEntry, link, commandTrace, formMatrix) {
  const isAcceptedGap = routeEntry.routePriority?.priorityAction === acceptedGapAction;
  const selectedBy = selectedByFromCommandTrace(commandTrace);
  const selectedFormIndices = uniqueSorted(selectedBy.map(item => item.formIndex).filter(value => value != null));
  const commandStreams = commandStreamsFromCommandTrace(commandTrace);
  const commandRefs = commandReferencesFromCommandTrace(commandTrace);
  const knownStreams = knownA48Streams(commandTrace);
  const gapStreams = acceptedGapStreams(link);
  const commandStreamRegions = uniqueSorted(commandStreams.map(stream => stream.streamRegion?.id));
  const knownStreamRegions = uniqueSorted(knownStreams.map(stream => stream.streamRegion?.id));
  const gapStreamRegions = uniqueSorted(gapStreams.map(stream => stream.streamRegion?.id));

  return {
    id: `${routeEntry.spanId}_a48_selector_trace_queue`,
    spanId: routeEntry.spanId,
    queueKind: isAcceptedGap
      ? 'accepted_a48_gap_selector_trace'
      : 'known_a48_command_selector_trace',
    priority: isAcceptedGap ? 'high_gap_resolution' : (commandTrace?.priority || routeEntry.routePriority?.confidence || 'medium_high'),
    traceStatus: isAcceptedGap
      ? 'accepted_gap_selector_trace_pending'
      : 'known_a48_command_selector_trace_pending',
    region: routeEntry.region,
    range: routeEntry.range,
    sourceBank: routeEntry.sourceBank,
    sourceRecordHighBytes: routeEntry.sourceRecordHighBytes || [],
    sourceRecordWords: routeEntry.sourceRecordWords || [],
    nonblankTileCount: routeEntry.nonblankTileCount || 0,
    localVerification: routeEntry.localVerification,
    route: {
      primaryRouteId: a48PrimaryRouteId,
      priorityAction: routeEntry.routePriority?.priorityAction,
      confidence: routeEntry.routePriority?.confidence || '',
      routine: compactRouteRoutine(routeEntry, '_LABEL_A48_'),
      caller: compactRouteCallsite(routeEntry, '_LABEL_13A6_'),
      proofCriterion: isAcceptedGap
        ? 'Promote only if a runtime trace proves that a player command selector reaches one of the accepted gap A48 streams and _LABEL_A48_ uploads this source span.'
        : 'Promote only if a runtime trace proves _RAM_C24F_, _RAM_C260_, _RAM_C252_, command pointer offset, A48 stream offset, source word, mapper write, and VDP destination for the same upload event.',
    },
    upstream: {
      routePriorityCatalogId: sourceCatalogIds.dynamicRoutePriority,
      a48DynamicSeedLinkCatalogId: sourceCatalogIds.playerA48DynamicSeedLink,
      commandConfidenceCatalogId: commandTrace ? sourceCatalogIds.playerA48CommandConfidenceTrace : null,
      classification: link?.classification || routeEntry.upstream?.a48Classification || '',
      recommendedNextAction: link?.recommendedNextAction || '',
      overlapSummary: link?.overlapSummary || routeEntry.upstream?.a48OverlapSummary || {},
    },
    a48StreamEvidence: {
      knownStreamCount: knownStreams.length,
      knownStreams,
      acceptedGapStreamCount: gapStreams.length,
      acceptedGapStreams: gapStreams,
      streamRegionIds: uniqueSorted([...knownStreamRegions, ...gapStreamRegions]),
      streamOffsets: uniqueSorted([
        ...knownStreams.map(stream => stream.streamOffset),
        ...gapStreams.map(stream => stream.streamOffset),
      ]),
      streamConfidenceCounts: countBy([...knownStreams, ...gapStreams], stream => stream.confidence || 'unknown'),
      highConfidenceCommandReferenceCount: knownStreams.filter(stream => stream.hasHighConfidenceCommandReference).length,
      acceptedGapKnownPointerReferenceCount: gapStreams.filter(stream => stream.hasKnownPointerReference).length,
    },
    commandSelectorEvidence: {
      status: commandTrace
        ? 'command_pointer_refs_indexed_runtime_trace_pending'
        : 'no_command_pointer_refs_for_accepted_gap_runtime_trace_required',
      commandReferenceCount: commandRefs.length,
      uniquePointerOffsets: uniqueSorted(commandRefs.map(ref => ref.pointerOffset)),
      uniquePlayerCommandStreamOffsets: uniqueSorted(commandStreams.map(stream => stream.streamOffset)),
      playerCommandStreamRegionIds: commandStreamRegions,
      playerCommandStreamReferenceCount: commandStreams.length,
      commandStreamConfidenceCounts: countBy(commandStreams, stream => stream.confidence || 'unknown'),
      referenceConfidenceCounts: countBy(commandRefs, ref => ref.sourcePlayerCommandStreamConfidence || 'unknown'),
      selectedByCount: selectedBy.length,
      selectedByFormIndices: selectedFormIndices,
      selectedByVariantCount: uniqueSorted(selectedBy.map(item => `${item.formIndex}:${item.variantIndex}`)).length,
      selectedBySamples: compactSelectedBy(selectedBy),
    },
    formStateContext: formStateContext(formMatrix, selectedFormIndices),
    selectorRamTraceSeeds,
    runtimeTraceConfirmed: false,
    promotionReady: false,
    evidenceCatalogs: uniqueSorted([
      sourceCatalogIds.dynamicRoutePriority,
      sourceCatalogIds.playerA48DynamicSeedLink,
      sourceCatalogIds.playerFormStateMatrix,
      sourceCatalogIds.playerA48TileStream,
      sourceCatalogIds.playerA48GapCandidate,
      commandTrace ? sourceCatalogIds.playerA48CommandConfidenceTrace : null,
      ...(routeEntry.evidenceCatalogs || []),
      ...(link?.evidenceCatalogs || []),
      ...(commandTrace?.evidenceCatalogs || []),
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
  const linkCatalog = requireCatalog(mapData, sourceCatalogIds.playerA48DynamicSeedLink);
  const commandCatalog = requireCatalog(mapData, sourceCatalogIds.playerA48CommandConfidenceTrace);
  const formMatrix = requireCatalog(mapData, sourceCatalogIds.playerFormStateMatrix);
  requireCatalog(mapData, sourceCatalogIds.playerA48TileStream);
  requireCatalog(mapData, sourceCatalogIds.playerA48GapCandidate);

  const links = bySpanId(linkCatalog.links || []);
  const commandTraces = bySpanId(commandCatalog.entries || []);
  const entries = (routeCatalog.entries || [])
    .filter(entry => entry.routePriority?.primaryRouteId === a48PrimaryRouteId)
    .filter(entry => entry.routePriority?.priorityAction === knownA48Action || entry.routePriority?.priorityAction === acceptedGapAction)
    .map(entry => buildEntry(entry, links.get(entry.spanId), commandTraces.get(entry.spanId), formMatrix))
    .sort((a, b) => {
      const aRank = a.queueKind === 'known_a48_command_selector_trace' ? 0 : 1;
      const bRank = b.queueKind === 'known_a48_command_selector_trace' ? 0 : 1;
      return aRank - bRank || (b.localVerification?.sourceByteCount || 0) - (a.localVerification?.sourceByteCount || 0) ||
        parseOffset(a.range?.start) - parseOffset(b.range?.start);
    });

  const knownEntries = entries.filter(entry => entry.queueKind === 'known_a48_command_selector_trace');
  const acceptedEntries = entries.filter(entry => entry.queueKind === 'accepted_a48_gap_selector_trace');
  const allKnownStreams = entries.flatMap(entry => entry.a48StreamEvidence.knownStreams || []);
  const allGapStreams = entries.flatMap(entry => entry.a48StreamEvidence.acceptedGapStreams || []);
  const uniqueKnownStreams = [...new Map(allKnownStreams.map(stream => [stream.streamOffset, stream])).values()];
  const uniqueGapStreams = [...new Map(allGapStreams.map(stream => [stream.streamOffset, stream])).values()];
  const allCommandOffsets = entries.flatMap(entry => entry.commandSelectorEvidence.uniquePlayerCommandStreamOffsets || []);
  const allPointerOffsets = entries.flatMap(entry => entry.commandSelectorEvidence.uniquePointerOffsets || []);
  const allSelectedForms = entries.flatMap(entry => entry.commandSelectorEvidence.selectedByFormIndices || []);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: offsets, labels, route ids, region ids, RAM symbols, form/variant indexes, command pointer offsets, counts, and trace blockers. No ROM bytes, decoded graphics, pixels, screenshots, hashes, audio, text, or ASM instruction bytes are embedded.',
    target: {
      upstreamCatalogId: sourceCatalogIds.dynamicRoutePriority,
      primaryRouteId: a48PrimaryRouteId,
      reason: 'The route-priority catalog has 11 A48-primary dynamic graphics seeds; this queue separates the 10 known command-selector traces from the accepted A48 gap trace.',
    },
    summary: {
      selectorTraceEntryCount: entries.length,
      knownA48CommandTraceEntryCount: knownEntries.length,
      acceptedGapSelectorTraceEntryCount: acceptedEntries.length,
      seedRegionCount: new Set(entries.map(entry => entry.region?.id).filter(Boolean)).size,
      seedRegionIds: uniqueSorted(entries.map(entry => entry.region?.id)),
      sourceBankCount: new Set(entries.map(entry => entry.sourceBank).filter(Boolean)).size,
      sourceBanks: uniqueSorted(entries.map(entry => entry.sourceBank)),
      sourceRecordHighBytes: uniqueSorted(entries.flatMap(entry => entry.sourceRecordHighBytes || [])),
      sourceByteCount: sumBy(entries, entry => entry.localVerification?.sourceByteCount || 0),
      localNonzeroByteCount: sumBy(entries, entry => entry.localVerification?.nonzeroByteCount || 0),
      nonblankTileCount: sumBy(entries, entry => entry.nonblankTileCount || 0),
      knownA48StreamCount: uniqueKnownStreams.length,
      acceptedGapCandidateStreamCount: uniqueGapStreams.length,
      acceptedGapCandidateKnownPointerReferenceCount: uniqueGapStreams.filter(stream => stream.hasKnownPointerReference).length,
      uniquePlayerCommandStreamCount: uniqueSorted(allCommandOffsets).length,
      uniquePointerOffsetCount: uniqueSorted(allPointerOffsets).length,
      selectedByVariantCount: uniqueSorted(entries.flatMap(entry => entry.commandSelectorEvidence.selectedBySamples || []).map(item => `${item.formIndex}:${item.variantIndex}`)).length,
      selectedByFormIndices: uniqueSorted(allSelectedForms),
      queueKindCounts: countBy(entries, entry => entry.queueKind),
      traceStatusCounts: countBy(entries, entry => entry.traceStatus),
      commandSelectorStatusCounts: countBy(entries, entry => entry.commandSelectorEvidence.status),
      priorityCounts: countBy(entries, entry => entry.priority),
      streamConfidenceCounts: countBy([...uniqueKnownStreams, ...uniqueGapStreams], stream => stream.confidence || 'unknown'),
      commandStreamConfidenceCounts: commandCatalog.summary?.commandStreamConfidenceCounts || {},
      referenceConfidenceCounts: commandCatalog.summary?.referenceConfidenceCounts || {},
      selectorRamTraceSeedCount: selectorRamTraceSeeds.length,
      runtimeTraceConfirmedCount: entries.filter(entry => entry.runtimeTraceConfirmed).length,
      promotionReadyCount: entries.filter(entry => entry.promotionReady).length,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    entries,
    selectorRamTraceSeeds,
    evidence: [
      `${sourceCatalogIds.dynamicRoutePriority} identifies 11 A48-primary dynamic graphics source seeds.`,
      `${sourceCatalogIds.playerA48CommandConfidenceTrace} supplies command pointer references for the 10 known-A48 spans, including 14 A48 streams and 19 player command streams.`,
      `${sourceCatalogIds.playerA48DynamicSeedLink} supplies the accepted A48 gap candidate and separates it from the known-A48 command-selector set.`,
      `${sourceCatalogIds.playerFormStateMatrix} supplies static _RAM_C24F_ and _RAM_C260_ selector context for the referenced player command streams.`,
      'This audit is a selector trace queue only. It records no ROM payload and does not promote graphics coverage until runtime frame traces prove the actual command path.',
    ],
    nextLeads: [
      'Trace high-byte 0x17 r2656 known-A48 entries first because they cover the largest source spans and multiple command streams.',
      'For each known-A48 entry, capture _RAM_C24F_, _RAM_C260_, _RAM_C252_, command pointer offset, A48 stream offset, source word, _RAM_FFFF_ write, and VRAM destination in the same frame.',
      'For the accepted A48 gap, specifically prove or reject the candidate stream offsets 0x1BD89, 0x1BD8D, and 0x1BD96 before treating that 576-byte source span as player-animation coverage.',
    ],
  };
}

function addRegionDetail(details, regionId, role, entry, extra = {}) {
  if (!regionId) return;
  if (!details.has(regionId)) {
    details.set(regionId, {
      roles: new Set(),
      spanIds: new Set(),
      queueKinds: new Set(),
      sourceByteCount: 0,
      knownA48StreamOffsets: new Set(),
      acceptedGapStreamOffsets: new Set(),
      commandStreamOffsets: new Set(),
      pointerOffsets: new Set(),
      selectedByFormIndices: new Set(),
    });
  }
  const detail = details.get(regionId);
  detail.roles.add(role);
  if (entry) {
    detail.spanIds.add(entry.spanId);
    detail.queueKinds.add(entry.queueKind);
    detail.sourceByteCount += entry.localVerification?.sourceByteCount || 0;
    for (const offset of entry.a48StreamEvidence.knownStreams.map(stream => stream.streamOffset)) detail.knownA48StreamOffsets.add(offset);
    for (const offset of entry.a48StreamEvidence.acceptedGapStreams.map(stream => stream.streamOffset)) detail.acceptedGapStreamOffsets.add(offset);
    for (const offset of entry.commandSelectorEvidence.uniquePlayerCommandStreamOffsets || []) detail.commandStreamOffsets.add(offset);
    for (const offset of entry.commandSelectorEvidence.uniquePointerOffsets || []) detail.pointerOffsets.add(offset);
    for (const index of entry.commandSelectorEvidence.selectedByFormIndices || []) detail.selectedByFormIndices.add(index);
  }
  if (extra.knownA48StreamOffset) detail.knownA48StreamOffsets.add(extra.knownA48StreamOffset);
  if (extra.acceptedGapStreamOffset) detail.acceptedGapStreamOffsets.add(extra.acceptedGapStreamOffset);
  if (extra.commandStreamOffset) detail.commandStreamOffsets.add(extra.commandStreamOffset);
}

function annotateRegions(mapData, catalog) {
  const details = new Map();
  const changedRegions = [];
  const missingRegions = [];

  for (const entry of catalog.entries) {
    addRegionDetail(details, entry.region?.id, 'a48_selector_trace_seed_graphics_region', entry);
    for (const stream of entry.a48StreamEvidence.knownStreams || []) {
      addRegionDetail(details, stream.streamRegion?.id, 'a48_selector_trace_known_stream_region', entry, { knownA48StreamOffset: stream.streamOffset });
    }
    for (const stream of entry.a48StreamEvidence.acceptedGapStreams || []) {
      addRegionDetail(details, stream.streamRegion?.id, 'a48_selector_trace_accepted_gap_stream_region', entry, { acceptedGapStreamOffset: stream.streamOffset });
    }
    for (const regionId of entry.commandSelectorEvidence.playerCommandStreamRegionIds || []) {
      addRegionDetail(details, regionId, 'a48_selector_trace_player_command_stream_region', entry);
    }
    addRegionDetail(details, entry.route.routine?.region?.id, 'a48_selector_trace_upload_routine', entry);
    addRegionDetail(details, entry.route.caller?.callerRegion?.id, 'a48_selector_trace_command_decoder_routine', entry);
  }

  for (const [regionId, detail] of details) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: [...detail.roles].sort().join(',') });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48SelectorTraceQueueAudit = {
        catalogId,
        role: [...detail.roles].sort().join(','),
        confidence: detail.queueKinds.has('accepted_a48_gap_selector_trace') ? 'medium' : 'medium_high',
        summary: 'Region participates in the A48 selector trace queue that links dynamic graphics source spans to player command streams, A48 upload streams, and RAM selector prerequisites.',
        detail: {
          spanIds: uniqueSorted([...detail.spanIds]),
          queueKinds: uniqueSorted([...detail.queueKinds]),
          sourceByteCount: detail.sourceByteCount,
          knownA48StreamOffsets: uniqueSorted([...detail.knownA48StreamOffsets]),
          acceptedGapStreamOffsets: uniqueSorted([...detail.acceptedGapStreamOffsets]),
          commandStreamOffsets: uniqueSorted([...detail.commandStreamOffsets]),
          pointerOffsets: uniqueSorted([...detail.pointerOffsets]),
          selectedByFormIndices: uniqueSorted([...detail.selectedByFormIndices]),
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
      queueKinds: uniqueSorted([...detail.queueKinds]),
    });
  }

  return { changedRegions, missingRegions };
}

function annotateRam(mapData, catalog) {
  const changedRam = [];
  const missingRam = [];
  for (const seed of selectorRamTraceSeeds) {
    const ram = findRamByAddress(mapData, seed.address);
    if (!ram) {
      missingRam.push({ address: seed.address, symbol: seed.symbol, role: seed.role });
      continue;
    }
    if (apply) {
      ram.analysis = ram.analysis || {};
      ram.analysis.playerA48SelectorTraceQueueAudit = {
        catalogId,
        symbol: seed.symbol,
        role: seed.role,
        confidence: seed.confidence,
        summary: 'RAM variable is part of the required frame trace for proving A48 player-animation graphics uploads before coverage promotion.',
        selectorTraceEntryCount: catalog.summary.selectorTraceEntryCount,
        knownA48CommandTraceEntryCount: catalog.summary.knownA48CommandTraceEntryCount,
        acceptedGapSelectorTraceEntryCount: catalog.summary.acceptedGapSelectorTraceEntryCount,
        runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      address: seed.address,
      symbol: seed.symbol,
      role: seed.role,
      confidence: seed.confidence,
    });
  }
  return { changedRam, missingRam };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    topEntries: catalog.entries.slice(0, 12).map(entry => ({
      spanId: entry.spanId,
      queueKind: entry.queueKind,
      priority: entry.priority,
      range: entry.range,
      sourceBank: entry.sourceBank,
      sourceRecordWords: entry.sourceRecordWords,
      knownA48StreamOffsets: entry.a48StreamEvidence.knownStreams.map(stream => stream.streamOffset),
      acceptedGapStreamOffsets: entry.a48StreamEvidence.acceptedGapStreams.map(stream => stream.streamOffset),
      commandStreamOffsets: entry.commandSelectorEvidence.uniquePlayerCommandStreamOffsets,
      selectedByFormIndices: entry.commandSelectorEvidence.selectedByFormIndices,
      selectedByVariantCount: entry.commandSelectorEvidence.selectedByVariantCount,
      traceStatus: entry.traceStatus,
    })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(item => item.id !== catalogId);
  mapData.playerCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'player_a48_selector_trace_queue_audit',
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
  staticMap.summary.playerA48SelectorTraceQueueCatalog = catalogId;
  staticMap.summary.playerA48SelectorTraceQueueEntries = catalog.summary.selectorTraceEntryCount;
  staticMap.summary.playerA48SelectorTraceQueueKnownA48Entries = catalog.summary.knownA48CommandTraceEntryCount;
  staticMap.summary.playerA48SelectorTraceQueueAcceptedGapEntries = catalog.summary.acceptedGapSelectorTraceEntryCount;
  staticMap.summary.playerA48SelectorTraceQueueSourceBytes = catalog.summary.sourceByteCount;
  staticMap.summary.playerA48SelectorTraceQueueKnownStreams = catalog.summary.knownA48StreamCount;
  staticMap.summary.playerA48SelectorTraceQueueAcceptedGapStreams = catalog.summary.acceptedGapCandidateStreamCount;
  staticMap.summary.playerA48SelectorTraceQueueCommandStreams = catalog.summary.uniquePlayerCommandStreamCount;
  staticMap.summary.playerA48SelectorTraceQueueRuntimeConfirmed = catalog.summary.runtimeTraceConfirmedCount;
  staticMap.summary.playerA48SelectorTraceQueueCoverageChanged = catalog.summary.coverageChangedByThisAudit;

  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.graphics = insertAfter(
    staticMap.primaryCatalogs.graphics,
    sourceCatalogIds.playerA48CommandConfidenceTrace,
    catalogId
  );
  staticMap.primaryCatalogs.gameplay = insertAfter(
    staticMap.primaryCatalogs.gameplay,
    sourceCatalogIds.playerA48CommandConfidenceTrace,
    catalogId
  );
  staticMap.primaryCatalogs.coverage = insertAfter(
    staticMap.primaryCatalogs.coverage,
    sourceCatalogIds.playerA48CommandConfidenceTrace,
    catalogId
  );

  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  const note = 'Use world-player-a48-selector-trace-queue-catalog-2026-06-26 to trace the 11 A48-primary dynamic graphics seeds: 10 known command-selector entries and one accepted gap candidate, with runtime confirmation still zero.';
  const anchor = staticMap.nextLeads.findIndex(noteText => noteText.includes(sourceCatalogIds.playerA48CommandConfidenceTrace));
  if (anchor === -1) staticMap.nextLeads.push(note);
  else staticMap.nextLeads.splice(anchor + 1, 0, note);

  writeJson(staticMapPath, staticMap);
  return {
    staticMapPath: path.relative(repoRoot, staticMapPath),
    summaryFieldsUpdated: [
      'playerA48SelectorTraceQueueCatalog',
      'playerA48SelectorTraceQueueEntries',
      'playerA48SelectorTraceQueueKnownA48Entries',
      'playerA48SelectorTraceQueueAcceptedGapEntries',
      'playerA48SelectorTraceQueueSourceBytes',
      'playerA48SelectorTraceQueueKnownStreams',
      'playerA48SelectorTraceQueueAcceptedGapStreams',
      'playerA48SelectorTraceQueueCommandStreams',
      'playerA48SelectorTraceQueueRuntimeConfirmed',
      'playerA48SelectorTraceQueueCoverageChanged',
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
