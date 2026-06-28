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
const toolName = 'tools/world-room-entity-below56-a48-prereq-audit.mjs';
const catalogId = 'world-room-entity-below56-a48-prereq-catalog-2026-06-26';
const reportId = 'room-entity-below56-a48-prereq-audit-2026-06-26';

const sourceCatalogIds = {
  frameGapVramWriter: 'world-room-entity-frame-gap-vram-writer-catalog-2026-06-26',
  playerA48: 'world-player-a48-tile-stream-catalog-2026-06-26',
  zoneCommonPrereq: 'world-zone-common-prereq-provenance-catalog-2026-06-25',
  statusTileSource: 'world-status-tile-source-range-catalog-2026-06-26',
  spriteTileRange: 'world-animation-sprite-tile-range-catalog-2026-06-25',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function hex(value, pad = 2) {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(pad, '0')}`;
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
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function valuesFromSegments(segments) {
  const values = [];
  for (const segment of segments || []) {
    const start = parseHex(segment.start);
    const end = parseHex(segment.end);
    if (start == null || end == null || end < start) continue;
    for (let value = start; value <= end; value++) values.push(value);
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

function compactSegments(values) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (!sorted.length) return [];
  const segments = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const value = sorted[i];
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    segments.push({ start: hex(start, 2), end: hex(previous, 2), count: previous - start + 1 });
    start = value;
    previous = value;
  }
  segments.push({ start: hex(start, 2), end: hex(previous, 2), count: previous - start + 1 });
  return segments;
}

function bump(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function countObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function topCounts(map, limit = 12) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
    .slice(0, limit);
}

function confirmedA48Streams(playerA48) {
  return (playerA48.a48TileStreams || [])
    .filter(stream => stream.confidence === 'high' && stream.hasHighConfidenceCommandReference)
    .map(stream => ({
      streamOffset: stream.streamOffset,
      streamRegion: stream.streamRegion || null,
      referencedByCount: Number(stream.referencedByCount || 0),
      referencedBy: (stream.referencedBy || []).slice(0, 8),
      totalTileBlocks: Number(stream.totalTileBlocks || 0),
      finalZeroExclusive: parseHex(stream.finalVramTileIfC27fZeroExclusive),
      finalNonzeroExclusive: parseHex(stream.finalVramTileIfC27fNonzeroExclusive),
      sourceRegionIds: stream.sourceRegionIds || [],
      sourceBanks: stream.sourceBanks || [],
    }));
}

function writerMatches(streams, slot) {
  const matches = [];
  for (const stream of streams) {
    if (stream.finalZeroExclusive != null && slot >= 0 && slot < stream.finalZeroExclusive) {
      matches.push({
        mode: 'c27f_zero',
        streamOffset: stream.streamOffset,
        streamRegionId: stream.streamRegion?.id || '',
        referencedByCount: stream.referencedByCount,
        totalTileBlocks: stream.totalTileBlocks,
        sourceRegionIds: stream.sourceRegionIds,
        slotRange: {
          start: '0x00',
          end: hex(stream.finalZeroExclusive - 1, 2),
          count: stream.finalZeroExclusive,
        },
      });
    }
    if (stream.finalNonzeroExclusive != null && slot >= 0x10 && slot < stream.finalNonzeroExclusive) {
      matches.push({
        mode: 'c27f_nonzero',
        streamOffset: stream.streamOffset,
        streamRegionId: stream.streamRegion?.id || '',
        referencedByCount: stream.referencedByCount,
        totalTileBlocks: stream.totalTileBlocks,
        sourceRegionIds: stream.sourceRegionIds,
        slotRange: {
          start: '0x10',
          end: hex(stream.finalNonzeroExclusive - 1, 2),
          count: Math.max(0, stream.finalNonzeroExclusive - 0x10),
        },
      });
    }
  }
  return matches.sort((a, b) =>
    b.totalTileBlocks - a.totalTileBlocks ||
    b.referencedByCount - a.referencedByCount ||
    a.streamOffset.localeCompare(b.streamOffset)
  );
}

function uniqueWriterSamples(matches) {
  const seen = new Set();
  const samples = [];
  for (const match of matches) {
    const key = `${match.mode}:${match.streamOffset}:${match.slotRange.start}:${match.slotRange.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push(match);
    if (samples.length >= 10) break;
  }
  return samples;
}

function classifySlot(slot, streams) {
  const matches = writerMatches(streams, slot);
  if (!matches.length) {
    return {
      kind: 'below56_no_confirmed_player_a48_or_common_writer',
      confidence: 'medium_high',
      slot,
      writerMatches: [],
    };
  }
  const modes = new Set(matches.map(match => match.mode));
  const kind = modes.size > 1
    ? 'below56_overlaps_confirmed_player_a48_both_c27f_modes'
    : modes.has('c27f_zero')
      ? 'below56_overlaps_confirmed_player_a48_c27f_zero'
      : 'below56_overlaps_confirmed_player_a48_c27f_nonzero';
  return {
    kind,
    confidence: 'medium_high',
    slot,
    writerMatches: matches,
  };
}

function extractBelowChecks(frameGapCatalog, streams) {
  const checks = [];
  for (const check of frameGapCatalog.checks || []) {
    const group = (check.groupedTiles || []).find(item => item.kind === 'below_room_dynamic_start_common_sprite_prereq_candidate');
    if (!group) continue;
    const slots = valuesFromSegments(group.segments || []);
    const classifications = slots.map(slot => classifySlot(slot, streams));
    const classCounts = new Map();
    const slotSamplesByKind = new Map();
    const writerStreams = new Map();
    for (const classification of classifications) {
      bump(classCounts, classification.kind);
      if (!slotSamplesByKind.has(classification.kind)) slotSamplesByKind.set(classification.kind, []);
      if (slotSamplesByKind.get(classification.kind).length < 24) {
        slotSamplesByKind.get(classification.kind).push(classification.slot);
      }
      for (const writer of classification.writerMatches) bump(writerStreams, `${writer.mode}:${writer.streamOffset}`);
    }
    checks.push({
      subrecordIndex: check.subrecordIndex,
      entityType: check.entityType,
      selectorTypeHex: check.selectorTypeHex || '',
      roomEntityList: check.roomEntityList || null,
      roomDynamicTileStart: check.roomDynamicTileStart || '0x056',
      sourceClassification: 'below_room_dynamic_start_common_sprite_prereq_candidate',
      slotCount: slots.length,
      slotSegments: compactSegments(slots).slice(0, 32),
      classificationCounts: countObject(classCounts),
      classifiedSlotGroups: [...slotSamplesByKind.entries()].map(([kind, values]) => {
        const writerSamples = uniqueWriterSamples(
          classifications.filter(item => item.kind === kind).flatMap(item => item.writerMatches)
        );
        return {
          kind,
          slotCount: Number(classCounts.get(kind) || 0),
          slotSegments: compactSegments(values).slice(0, 16),
          writerSamples,
        };
      }).sort((a, b) => b.slotCount - a.slotCount || a.kind.localeCompare(b.kind)),
      topA48WriterStreams: topCounts(writerStreams, 8),
      confidence: 'medium_high',
    });
  }
  return checks.sort((a, b) => b.slotCount - a.slotCount || a.entityType.localeCompare(b.entityType));
}

function coverageFromStreams(streams) {
  const zero = new Set();
  const nonzero = new Set();
  for (const stream of streams) {
    for (let slot = 0; stream.finalZeroExclusive != null && slot < stream.finalZeroExclusive; slot++) zero.add(slot);
    for (let slot = 0x10; stream.finalNonzeroExclusive != null && slot < stream.finalNonzeroExclusive; slot++) nonzero.add(slot);
  }
  const either = new Set([...zero, ...nonzero]);
  return {
    c27fZero: [...zero].sort((a, b) => a - b),
    c27fNonzero: [...nonzero].sort((a, b) => a - b),
    either: [...either].sort((a, b) => a - b),
  };
}

function buildNegativeEvidence(zoneCommon, statusSource, spriteRange) {
  return {
    zoneCommonPrereqSlots: (zoneCommon.resolvedSlotUsage || []).map(item => item.slot).sort(),
    zoneCommonPrereqSlotMin: (zoneCommon.resolvedSlotUsage || []).map(item => parseHex(item.slot)).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null,
    statusTileDestination: statusSource.scope?.vramDestination || '',
    statusTileUploadBytes: statusSource.scope?.uploadByteCount || statusSource.summary?.uploadByteCount || 0,
    spriteTileRangeConfirmedPreload: (spriteRange.parameterTableRanges || []).flatMap(range => range.confirmedLoaderOverlaps || []).length,
    spriteTileRangeNotes: [
      'zone common prerequisite render provenance resolves background/name-table slots, not below-0x56 sprite OAM tile ids.',
      'status tile source upload writes to VRAM address 0x6200, outside below-0x56 sprite tile ids.',
      'animation sprite tile range confirmed preload currently documents _DATA_BF51_ coverage for 0x56-0x8B, not below 0x56.',
    ],
  };
}

function buildCatalog(mapData) {
  const frameGapCatalog = requireCatalog(mapData, sourceCatalogIds.frameGapVramWriter);
  const playerA48 = requireCatalog(mapData, sourceCatalogIds.playerA48);
  const zoneCommon = requireCatalog(mapData, sourceCatalogIds.zoneCommonPrereq);
  const statusSource = requireCatalog(mapData, sourceCatalogIds.statusTileSource);
  const spriteRange = requireCatalog(mapData, sourceCatalogIds.spriteTileRange);
  const streams = confirmedA48Streams(playerA48);
  const coverage = coverageFromStreams(streams);
  const checks = extractBelowChecks(frameGapCatalog, streams);
  const classTileCounts = new Map();
  const entityCounts = new Map();
  let totalSlots = 0;
  for (const check of checks) {
    totalSlots += check.slotCount;
    bump(entityCounts, check.entityType);
    for (const [kind, count] of Object.entries(check.classificationCounts)) bump(classTileCounts, kind, count);
  }
  const uniqueSlots = new Set();
  for (const check of checks) {
    for (const segment of check.slotSegments || []) {
      for (const slot of valuesFromSegments([segment])) uniqueSlots.add(slot);
    }
  }
  const resolvedKinds = new Set([
    'below56_overlaps_confirmed_player_a48_both_c27f_modes',
    'below56_overlaps_confirmed_player_a48_c27f_zero',
    'below56_overlaps_confirmed_player_a48_c27f_nonzero',
  ]);
  const playerA48ResolvedSlotRefs = [...classTileCounts.entries()]
    .filter(([kind]) => resolvedKinds.has(kind))
    .reduce((sum, [, count]) => sum + count, 0);
  const unresolvedSlotRefs = Number(classTileCounts.get('below56_no_confirmed_player_a48_or_common_writer') || 0);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: entity type ids, room subrecord indexes, VRAM tile-slot ids/ranges, stream offsets, source region ids, counts, and evidence. No ROM bytes, decoded graphics, sprites, pixels, screenshots, coordinates, music, text, or gameplay payloads are embedded.',
    semantics: {
      purpose: 'Refine below-0x56 room-entity frame tile gaps by comparing them with confirmed player/form _LABEL_A48_ VRAM slot writer ranges.',
      conservativeRule: 'A slot is treated as player-A48-covered only when at least one high-confidence _LABEL_A48_ stream is reached from a high-confidence player command stream.',
      c27fMeaning: '_LABEL_A48_ writes from tile slot 0x00 when _RAM_C27F_ is zero, and from tile slot 0x10 when _RAM_C27F_ is nonzero.',
      caution: 'A slot overlap is a provenance lead for existing VRAM contents, not proof that the room entity intentionally depends on the player form tile stream.',
    },
    playerA48Coverage: {
      confirmedStreamCount: streams.length,
      c27fZeroSlotSegments: compactSegments(coverage.c27fZero),
      c27fNonzeroSlotSegments: compactSegments(coverage.c27fNonzero),
      eitherModeSlotSegments: compactSegments(coverage.either),
      topStreamsByCoverage: streams
        .slice()
        .sort((a, b) => b.totalTileBlocks - a.totalTileBlocks || b.referencedByCount - a.referencedByCount || a.streamOffset.localeCompare(b.streamOffset))
        .slice(0, 16)
        .map(stream => ({
          streamOffset: stream.streamOffset,
          streamRegionId: stream.streamRegion?.id || '',
          referencedByCount: stream.referencedByCount,
          totalTileBlocks: stream.totalTileBlocks,
          finalVramTileIfC27fZeroExclusive: stream.finalZeroExclusive == null ? null : hex(stream.finalZeroExclusive, 3),
          finalVramTileIfC27fNonzeroExclusive: stream.finalNonzeroExclusive == null ? null : hex(stream.finalNonzeroExclusive, 3),
          sourceRegionIds: stream.sourceRegionIds,
        })),
    },
    nonCandidateEvidence: buildNegativeEvidence(zoneCommon, statusSource, spriteRange),
    checks,
    summary: {
      below56CheckCount: checks.length,
      totalBelow56SlotRefs: totalSlots,
      uniqueBelow56SlotCount: uniqueSlots.size,
      uniqueBelow56SlotSegments: compactSegments([...uniqueSlots]).slice(0, 32),
      playerA48ResolvedSlotRefs,
      unresolvedBelow56SlotRefs: unresolvedSlotRefs,
      classificationTileCounts: countObject(classTileCounts),
      topEntityTypes: topCounts(entityCounts, 12),
      confirmedA48StreamCount: streams.length,
      confirmedA48C27fZeroSlotCount: coverage.c27fZero.length,
      confirmedA48C27fNonzeroSlotCount: coverage.c27fNonzero.length,
      confirmedA48EitherModeSlotCount: coverage.either.length,
      persistedRomByteCount: 0,
      persistedTileByteCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: no ROM bytes, decoded graphics, sprites, pixels, screenshots, coordinates, music, text, or gameplay payloads are embedded.',
    },
    evidence: [
      'world-room-entity-frame-gap-vram-writer-catalog-2026-06-26 identifies 267 below-0x56 room-entity frame tile refs.',
      'world-player-a48-tile-stream-catalog-2026-06-26 records _LABEL_A48_ destination slot ranges for both _RAM_C27F_ modes.',
      'ASM lines 2391-2448 show _LABEL_A48_ selecting VRAM address 0x0000 or 0x0200 based on _RAM_C27F_ and copying tile blocks until a zero terminator.',
      'world-zone-common-prereq-provenance-catalog-2026-06-25 resolves zone common slots at 0x100+ and is therefore not a direct below-0x56 sprite-slot source.',
      'world-status-tile-source-range-catalog-2026-06-26 derives status upload destination 0x6200 and is therefore not a below-0x56 sprite-slot source.',
      'world-animation-sprite-tile-range-catalog-2026-06-25 confirms _DATA_BF51_ coverage for 0x56-0x8B, not below 0x56.',
    ],
    nextLeads: [
      'Trace non-player common sprite preload writers for slots 0x20-0x55; the current high-confidence A48 coverage only reaches 0x00-0x1F.',
      'Tie _RAM_C27F_ values to player form/state so c27f_zero versus c27f_nonzero coverage can become frame-context-specific.',
      'For below-0x56 overlaps, inspect whether the room entity frame links are over-broad or whether actors intentionally reference player/common sprite slots.',
    ],
  };
}

function annotateA48Regions(mapData, catalog) {
  const streamRefs = new Map();
  for (const check of catalog.checks || []) {
    for (const group of check.classifiedSlotGroups || []) {
      const regionIds = [...new Set((group.writerSamples || []).map(writer => writer.streamRegionId).filter(Boolean))];
      for (const regionId of regionIds) {
        const ref = streamRefs.get(regionId) || {
          sourceCheckKeys: new Set(),
          classifiedSlotGroupKeys: new Set(),
          slotRefCount: 0,
          entityTypes: new Set(),
          streamOffsets: new Set(),
        };
        ref.sourceCheckKeys.add(`${check.subrecordIndex}:${check.entityType}`);
        ref.classifiedSlotGroupKeys.add(`${check.subrecordIndex}:${check.entityType}:${group.kind}`);
        ref.slotRefCount += group.slotCount;
        ref.entityTypes.add(check.entityType);
        for (const writer of group.writerSamples || []) {
          if (writer.streamRegionId === regionId) ref.streamOffsets.add(writer.streamOffset);
        }
        streamRefs.set(regionId, ref);
      }
    }
  }
  let annotated = 0;
  for (const [regionId, ref] of streamRefs.entries()) {
    const region = findRegionById(mapData, regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.roomEntityBelow56A48PrereqAudit = {
      catalogId,
      kind: 'player_a48_slot_overlap_for_below56_room_entity_frame_refs',
      confidence: 'medium_high',
      checkCount: ref.sourceCheckKeys.size,
      classifiedSlotGroupCount: ref.classifiedSlotGroupKeys.size,
      slotRefCount: ref.slotRefCount,
      entityTypes: [...ref.entityTypes].sort(),
      streamOffsets: [...ref.streamOffsets].sort(),
      summary: 'Confirmed player/form _LABEL_A48_ streams write VRAM slots that overlap some below-0x56 room entity frame tile refs.',
      evidence: [
        'world-room-entity-below56-a48-prereq-catalog-2026-06-26 cross-references below-0x56 frame tile refs with confirmed _LABEL_A48_ destination ranges.',
        'This is metadata-only VRAM-slot provenance; no ROM bytes or decoded graphics are embedded.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated++;
  }
  return annotated;
}

function applyCatalog(mapData, catalog) {
  const annotatedA48StreamRegionCount = annotateA48Regions(mapData, catalog);
  mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(item => item.id !== catalogId);
  mapData.metaspriteCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'room_entity_below56_a48_prereq_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedA48StreamRegionCount,
    },
    topChecks: catalog.checks.slice(0, 24).map(check => ({
      subrecordIndex: check.subrecordIndex,
      entityType: check.entityType,
      slotCount: check.slotCount,
      classificationCounts: check.classificationCounts,
      topA48WriterStreams: check.topA48WriterStreams,
    })),
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
  return { annotatedA48StreamRegionCount };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let applySummary = { annotatedA48StreamRegionCount: 0 };
  if (apply) {
    applySummary = applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    id: catalog.id,
    summary: {
      ...catalog.summary,
      ...applySummary,
    },
    playerA48Coverage: catalog.playerA48Coverage,
    topChecks: catalog.checks.slice(0, 8).map(check => ({
      subrecordIndex: check.subrecordIndex,
      entityType: check.entityType,
      slotCount: check.slotCount,
      classificationCounts: check.classificationCounts,
      topA48WriterStreams: check.topA48WriterStreams,
      classifiedSlotGroups: check.classifiedSlotGroups.map(group => ({
        kind: group.kind,
        slotCount: group.slotCount,
        slotSegments: group.slotSegments.slice(0, 4),
        writerModes: [...new Set(group.writerSamples.map(writer => writer.mode))],
        writerStreamOffsets: [...new Set(group.writerSamples.map(writer => writer.streamOffset))].slice(0, 6),
      })),
    })),
  }, null, 2));
}

main();
