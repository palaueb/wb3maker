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
const toolName = 'tools/world-player-a48-command-confidence-trace-audit.mjs';
const catalogId = 'world-player-a48-command-confidence-trace-catalog-2026-06-26';
const reportId = 'player-a48-command-confidence-trace-audit-2026-06-26';
const schemaVersion = 1;
const targetClassification = 'known_a48_stream_source_gap_needs_command_confidence_trace';

const sourceCatalogIds = {
  playerA48DynamicSeedLink: 'world-player-a48-dynamic-seed-link-catalog-2026-06-26',
  playerA48TileStream: 'world-player-a48-tile-stream-catalog-2026-06-26',
  playerFormStateMatrix: 'world-player-form-state-matrix-catalog-2026-06-26',
};

const ramTraceSeedSymbols = [
  { symbol: '_RAM_C24F_', address: '$C24F', role: 'outer_player_form_dispatch_selector', confidence: 'high' },
  { symbol: '_RAM_C260_', address: '$C260', role: 'inner_player_state_dispatch_selector', confidence: 'high' },
  { symbol: '_RAM_C250_', address: '$C250', role: 'player_animation_delay_counter', confidence: 'medium_high' },
  { symbol: '_RAM_C24C_', address: '$C24C', role: 'player_frame_pointer_latch', confidence: 'high' },
  { symbol: '_RAM_C252_', address: '$C252', role: 'next_player_command_cursor', confidence: 'high' },
  { symbol: '_RAM_C27F_', address: '$C27F', role: 'a48_vram_destination_base_selector', confidence: 'high' },
  { symbol: '_RAM_FFFF_', address: '$FFFF', role: 'mapper_page2_bank_write_from_a48_source_record', confidence: 'high' },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
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

function findRegionByName(mapData, name) {
  return (mapData.regions || []).find(region => (
    region.name === name ||
    region.label === name ||
    String(region.name || '').startsWith(`${name} `)
  )) || null;
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

function streamByOffset(streams) {
  return new Map((streams || []).map(stream => [stream.streamOffset, stream]));
}

function commandStreamsByOffset(commandStreams) {
  return new Map((commandStreams || []).map(stream => [stream.streamOffset, stream]));
}

function compactSelectedBy(selectedBy) {
  return (selectedBy || []).slice(0, 24).map(entry => ({
    formIndex: entry.formIndex,
    formEntryOffset: entry.formEntryOffset,
    variantIndex: entry.variantIndex,
    variantPointerOffset: entry.variantPointerOffset,
    streamZ80Pointer: entry.streamZ80Pointer,
  }));
}

function compactReferencedBy(refs) {
  return (refs || []).slice(0, 32).map(ref => ({
    sourcePlayerCommandStream: ref.sourcePlayerCommandStream,
    sourcePlayerCommandStreamConfidence: ref.sourcePlayerCommandStreamConfidence,
    sourceCommandOffset: ref.sourceCommandOffset,
    pointerOffset: ref.pointerOffset,
    z80Pointer: ref.z80Pointer,
  }));
}

function compactCommandStream(commandStream) {
  if (!commandStream) return null;
  return {
    streamOffset: commandStream.streamOffset,
    streamRegion: commandStream.streamRegion,
    selectedByCount: commandStream.selectedByCount || 0,
    selectedBy: compactSelectedBy(commandStream.selectedBy),
    confidence: commandStream.confidence,
    termination: commandStream.termination,
    commandCount: commandStream.commandCount,
    jumpCount: commandStream.jumpCount,
    frameTargetCount: commandStream.frameTargetCount,
    a48TargetCount: commandStream.a48TargetCount,
    issueCount: commandStream.issueCount,
    issueCounts: commandStream.issueCounts || {},
  };
}

function commandReferencesForA48Stream(a48Stream, commandStreamMap) {
  const refs = compactReferencedBy(a48Stream?.referencedBy || []);
  const commandStreams = [];
  const seen = new Set();
  for (const ref of refs) {
    if (!ref.sourcePlayerCommandStream || seen.has(ref.sourcePlayerCommandStream)) continue;
    seen.add(ref.sourcePlayerCommandStream);
    const commandStream = commandStreamMap.get(ref.sourcePlayerCommandStream);
    commandStreams.push(compactCommandStream(commandStream) || {
      streamOffset: ref.sourcePlayerCommandStream,
      streamRegion: null,
      selectedByCount: 0,
      selectedBy: [],
      confidence: ref.sourcePlayerCommandStreamConfidence || 'unknown',
      missingFromCatalog: true,
    });
  }
  return {
    referencedByCount: a48Stream?.referencedByCount || refs.length,
    referencedByConfidences: a48Stream?.referencedByConfidences || uniqueSorted(refs.map(ref => ref.sourcePlayerCommandStreamConfidence)),
    references: refs,
    commandStreams,
  };
}

function buildTraceEntry(link, a48StreamMap, commandStreamMap) {
  const a48Streams = [];
  for (const sample of link.a48StreamSamples || []) {
    const stream = a48StreamMap.get(sample.streamOffset) || sample;
    const references = commandReferencesForA48Stream(stream, commandStreamMap);
    a48Streams.push({
      streamOffset: stream.streamOffset,
      streamRegion: stream.streamRegion,
      confidence: stream.confidence,
      hasHighConfidenceCommandReference: Boolean(stream.hasHighConfidenceCommandReference),
      referencedByCount: stream.referencedByCount || references.referencedByCount,
      referencedByConfidences: stream.referencedByConfidences || references.referencedByConfidences,
      sourceRecordCount: stream.sourceRecordCount,
      totalTileBlocks: stream.totalTileBlocks,
      issueCount: stream.issueCount,
      issueCounts: stream.issueCounts || {},
      overlappingSourceSpans: sample.overlappingSourceSpans || [],
      commandReferences: references.references,
      commandStreams: references.commandStreams,
    });
  }

  const commandStreams = a48Streams.flatMap(stream => stream.commandStreams || []);
  const selectedBy = commandStreams.flatMap(stream => stream.selectedBy || []);
  const referencedBy = a48Streams.flatMap(stream => stream.commandReferences || []);
  const priority = (
    link.nonblankTileCount >= 16 ? 'high'
      : selectedBy.length ? 'medium_high'
        : 'medium'
  );

  return {
    id: `${link.spanId}_a48_command_confidence_trace`,
    spanId: link.spanId,
    seedRegion: link.region,
    range: link.range,
    nonblankTileCount: link.nonblankTileCount,
    sourceRecordHighBytes: link.sourceRecordHighBytes || [],
    upstreamClassification: link.classification,
    priority,
    traceStatus: 'needs_player_command_selector_confidence',
    recommendedTrace: 'Trace _RAM_C24F_ outer form, _RAM_C260_ inner state, _RAM_C252_ command cursor, and the listed command pointer offsets into _LABEL_13A6_/_LABEL_A48_.',
    overlapSummary: link.overlapSummary,
    a48StreamCount: a48Streams.length,
    a48Streams,
    uniqueA48StreamOffsets: uniqueSorted(a48Streams.map(stream => stream.streamOffset)),
    uniquePlayerCommandStreamOffsets: uniqueSorted(commandStreams.map(stream => stream.streamOffset)),
    uniquePointerOffsets: uniqueSorted(referencedBy.map(ref => ref.pointerOffset)),
    selectedByCount: selectedBy.length,
    selectedByFormIndices: uniqueSorted(selectedBy.map(entry => entry.formIndex).filter(value => value != null)),
    selectedByVariantCount: uniqueSorted(selectedBy.map(entry => `${entry.formIndex}:${entry.variantIndex}`)).length,
    selectorRamTraceSeeds: ramTraceSeedSymbols.map(seed => seed.symbol),
    evidenceCatalogs: [
      sourceCatalogIds.playerA48DynamicSeedLink,
      sourceCatalogIds.playerA48TileStream,
      sourceCatalogIds.playerFormStateMatrix,
    ],
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
  };
}

function buildCatalog(mapData) {
  const linkCatalog = requireCatalog(mapData, sourceCatalogIds.playerA48DynamicSeedLink);
  const a48Catalog = requireCatalog(mapData, sourceCatalogIds.playerA48TileStream);
  requireCatalog(mapData, sourceCatalogIds.playerFormStateMatrix);

  const a48StreamMap = streamByOffset(a48Catalog.a48TileStreams || []);
  const commandStreamMap = commandStreamsByOffset(a48Catalog.playerCommandStreams || []);
  const targetLinks = (linkCatalog.links || [])
    .filter(link => link.classification === targetClassification)
    .sort((a, b) => b.nonblankTileCount - a.nonblankTileCount || parseOffset(a.range?.start) - parseOffset(b.range?.start));
  const entries = targetLinks.map(link => buildTraceEntry(link, a48StreamMap, commandStreamMap));
  const allA48Streams = entries.flatMap(entry => entry.a48Streams || []);
  const allCommandStreams = entries.flatMap(entry => entry.a48Streams.flatMap(stream => stream.commandStreams || []));
  const uniqueA48Streams = [...new Map(allA48Streams.map(stream => [stream.streamOffset, stream])).values()];
  const uniqueCommandStreams = [...new Map(allCommandStreams.map(stream => [stream.streamOffset, stream])).values()];
  const allSelectedBy = uniqueCommandStreams.flatMap(stream => stream.selectedBy || []);

  const uniqueA48StreamOffsets = uniqueSorted(entries.flatMap(entry => entry.uniqueA48StreamOffsets));
  const uniqueCommandStreamOffsets = uniqueSorted(entries.flatMap(entry => entry.uniquePlayerCommandStreamOffsets));
  const uniqueCommandRegions = uniqueSorted(uniqueCommandStreams.map(stream => stream.streamRegion?.id));
  const uniqueA48Regions = uniqueSorted(uniqueA48Streams.map(stream => stream.streamRegion?.id));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: offsets, labels, region ids, RAM symbols, command-stream references, form/variant indexes, counts, and trace statuses. No ROM bytes, decoded graphics, screenshots, hashes, pixels, audio, text, or ASM instruction bytes are embedded.',
    target: {
      upstreamCatalogId: sourceCatalogIds.playerA48DynamicSeedLink,
      upstreamClassification: targetClassification,
      reason: 'These bank 0x0B graphics seeds are fully covered by known _LABEL_A48_ source intervals, but the existing A48 streams do not yet have high-confidence player command selector coverage.',
    },
    summary: {
      traceEntryCount: entries.length,
      seedRegionCount: new Set(entries.map(entry => entry.seedRegion?.id).filter(Boolean)).size,
      seedRegionIds: uniqueSorted(entries.map(entry => entry.seedRegion?.id)),
      nonblankTileCount: sumBy(entries, entry => entry.nonblankTileCount || 0),
      linkedSourceBytes: sumBy(entries, entry => entry.overlapSummary?.allKnownA48Bytes || 0),
      a48StreamReferenceCount: allA48Streams.length,
      uniqueA48StreamCount: uniqueA48StreamOffsets.length,
      uniqueA48StreamOffsets,
      a48StreamRegionCount: uniqueA48Regions.length,
      a48StreamRegionIds: uniqueA48Regions,
      playerCommandStreamReferenceCount: allCommandStreams.length,
      uniquePlayerCommandStreamCount: uniqueCommandStreamOffsets.length,
      playerCommandStreamRegionCount: uniqueCommandRegions.length,
      playerCommandStreamRegionIds: uniqueCommandRegions,
      selectedByVariantCount: uniqueSorted(allSelectedBy.map(entry => `${entry.formIndex}:${entry.variantIndex}`)).length,
      selectedByFormIndices: uniqueSorted(allSelectedBy.map(entry => entry.formIndex).filter(value => value != null)),
      a48StreamConfidenceCounts: countBy(uniqueA48Streams, stream => stream.confidence || 'unknown'),
      a48StreamHighConfidenceCommandRefCount: uniqueA48Streams.filter(stream => stream.hasHighConfidenceCommandReference).length,
      commandStreamConfidenceCounts: countBy(uniqueCommandStreams, stream => stream.confidence || 'unknown'),
      referenceConfidenceCounts: countBy(allA48Streams.flatMap(stream => stream.commandReferences || []), ref => ref.sourcePlayerCommandStreamConfidence || 'unknown'),
      priorityCounts: countBy(entries, entry => entry.priority),
      ramTraceSeedCount: ramTraceSeedSymbols.length,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    entries,
    topEntries: entries.slice(0, 12),
    ramTraceSeeds: ramTraceSeedSymbols,
    evidence: [
      `${sourceCatalogIds.playerA48DynamicSeedLink} identifies the 10 bank 0x0B seed spans already covered by known but command-unconfirmed _LABEL_A48_ source intervals.`,
      `${sourceCatalogIds.playerA48TileStream} supplies the A48 stream offsets, command pointer offsets, command stream selectors, and form/variant table references.`,
      `${sourceCatalogIds.playerFormStateMatrix} supplies the outer _RAM_C24F_ and inner _RAM_C260_ dispatch context needed to turn command references into form/state behavior.`,
      'This catalog is a trace queue only; it does not promote source bytes to confirmed coverage or persist ROM payload.',
    ],
    nextLeads: [
      'Start with high-priority entries whose selectedBy variants span multiple forms, then trace _RAM_C24F_ and _RAM_C260_ at _LABEL_137C_/_LABEL_13A6_.',
      'For each A48 stream offset, confirm whether the listed command pointer offset is reached at runtime before promoting the graphics source span.',
      'Once a command path is confirmed, attach frame-by-frame VRAM slot provenance through _RAM_C27F_ and _LABEL_A48_ before translating the player animation loader to JavaScript.',
    ],
  };
}

function detailForRegions(entries, selector) {
  const details = new Map();
  for (const entry of entries) {
    const regions = selector(entry);
    for (const region of regions) {
      if (!region?.id) continue;
      if (!details.has(region.id)) {
        details.set(region.id, {
          region,
          entryCount: 0,
          nonblankTileCount: 0,
          a48StreamOffsets: new Set(),
          commandStreamOffsets: new Set(),
          spanIds: new Set(),
          priorityCounts: {},
        });
      }
      const detail = details.get(region.id);
      detail.entryCount++;
      detail.nonblankTileCount += entry.nonblankTileCount || 0;
      detail.spanIds.add(entry.spanId);
      detail.priorityCounts[entry.priority] = (detail.priorityCounts[entry.priority] || 0) + 1;
      for (const offset of entry.uniqueA48StreamOffsets || []) detail.a48StreamOffsets.add(offset);
      for (const offset of entry.uniquePlayerCommandStreamOffsets || []) detail.commandStreamOffsets.add(offset);
    }
  }
  return details;
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];

  const seedRegionDetails = detailForRegions(catalog.entries, entry => [entry.seedRegion]);
  for (const [regionId, detail] of seedRegionDetails) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'a48_command_confidence_seed_graphics_region' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48CommandConfidenceTraceAudit = {
        catalogId,
        role: 'a48_command_confidence_seed_graphics_region',
        confidence: 'medium',
        summary: 'Graphics source region has bank 0x0B seed spans fully covered by known _LABEL_A48_ intervals that still need player command selector confirmation.',
        detail: {
          entryCount: detail.entryCount,
          nonblankTileCount: detail.nonblankTileCount,
          priorityCounts: detail.priorityCounts,
          a48StreamOffsets: [...detail.a48StreamOffsets].sort().slice(0, 32),
          commandStreamOffsets: [...detail.commandStreamOffsets].sort().slice(0, 32),
          spanIds: [...detail.spanIds].sort().slice(0, 32),
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
      role: 'a48_command_confidence_seed_graphics_region',
      entryCount: detail.entryCount,
      nonblankTileCount: detail.nonblankTileCount,
    });
  }

  const a48RegionDetails = detailForRegions(catalog.entries, entry => entry.a48Streams.map(stream => stream.streamRegion));
  for (const [regionId, detail] of a48RegionDetails) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'a48_stream_region_needing_command_confidence' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48CommandConfidenceTraceAudit = {
        catalogId,
        role: 'a48_stream_region_needing_command_confidence',
        confidence: 'medium',
        summary: 'Region contains _LABEL_A48_ tile streams whose source intervals cover bank 0x0B graphics seeds but require stronger command selector proof.',
        detail: {
          entryCount: detail.entryCount,
          priorityCounts: detail.priorityCounts,
          a48StreamOffsets: [...detail.a48StreamOffsets].sort().slice(0, 48),
          commandStreamOffsets: [...detail.commandStreamOffsets].sort().slice(0, 48),
          spanIds: [...detail.spanIds].sort().slice(0, 48),
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
      role: 'a48_stream_region_needing_command_confidence',
      entryCount: detail.entryCount,
    });
  }

  const commandRegionDetails = detailForRegions(catalog.entries, entry => (
    entry.a48Streams.flatMap(stream => (stream.commandStreams || []).map(command => command.streamRegion)).filter(Boolean)
  ));
  for (const [regionId, detail] of commandRegionDetails) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'player_command_stream_region_for_a48_confidence' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48CommandConfidenceTraceAudit = {
        catalogId,
        role: 'player_command_stream_region_for_a48_confidence',
        confidence: 'medium',
        summary: 'Region contains player command streams that reference _LABEL_A48_ tile streams covering bank 0x0B graphics seed spans.',
        detail: {
          entryCount: detail.entryCount,
          priorityCounts: detail.priorityCounts,
          a48StreamOffsets: [...detail.a48StreamOffsets].sort().slice(0, 48),
          commandStreamOffsets: [...detail.commandStreamOffsets].sort().slice(0, 48),
          spanIds: [...detail.spanIds].sort().slice(0, 48),
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
      role: 'player_command_stream_region_for_a48_confidence',
      entryCount: detail.entryCount,
    });
  }

  for (const routine of [
    { label: '_LABEL_137C_', role: 'player_form_animation_entry_selector' },
    { label: '_LABEL_13A6_', role: 'player_command_stream_parser_calling_a48' },
    { label: '_LABEL_A48_', role: 'a48_tile_stream_uploader' },
  ]) {
    const region = findRegionByName(mapData, routine.label);
    if (!region) {
      missingRegions.push({ name: routine.label, role: routine.role });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48CommandConfidenceTraceAudit = {
        catalogId,
        role: routine.role,
        confidence: 'high',
        summary: 'Routine is on the player command selector path needed to confirm _LABEL_A48_ graphics source coverage.',
        detail: {
          traceEntryCount: catalog.summary.traceEntryCount,
          uniqueA48StreamCount: catalog.summary.uniqueA48StreamCount,
          uniquePlayerCommandStreamCount: catalog.summary.uniquePlayerCommandStreamCount,
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
      role: routine.role,
    });
  }

  const changedRam = [];
  for (const seed of catalog.ramTraceSeeds) {
    const ramEntry = findRamByAddress(mapData, seed.address);
    if (!ramEntry) continue;
    if (apply) {
      ramEntry.analysis = ramEntry.analysis || {};
      ramEntry.analysis.playerA48CommandConfidenceTraceAudit = {
        catalogId,
        symbol: seed.symbol,
        role: seed.role,
        confidence: seed.confidence,
        summary: 'RAM value is part of the trace path for proving player command selector coverage of _LABEL_A48_ graphics source spans.',
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
    topEntries: catalog.topEntries.slice(0, 8).map(entry => ({
      spanId: entry.spanId,
      seedRegion: entry.seedRegion,
      range: entry.range,
      priority: entry.priority,
      nonblankTileCount: entry.nonblankTileCount,
      a48StreamCount: entry.a48StreamCount,
      uniqueA48StreamOffsets: entry.uniqueA48StreamOffsets,
      uniquePlayerCommandStreamOffsets: entry.uniquePlayerCommandStreamOffsets.slice(0, 16),
      selectedByCount: entry.selectedByCount,
      selectedByFormIndices: entry.selectedByFormIndices,
    })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(item => item.id !== catalogId);
  mapData.playerCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'player_a48_command_confidence_trace_audit',
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
