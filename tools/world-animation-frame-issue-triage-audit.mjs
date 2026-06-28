#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-animation-frame-issue-triage-audit.mjs';
const catalogId = 'world-animation-frame-issue-triage-catalog-2026-06-26';
const reportId = 'animation-frame-issue-triage-audit-2026-06-26';
const frameCatalogId = 'world-animation-frame-stream-catalog-2026-06-25';
const commandCatalogId = 'world-animation-command-stream-catalog-2026-06-25';
const frameTerminator = 0x80;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function hex(value, pad = 5) {
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

function regionStart(region) {
  return parseHex(region?.offset ?? region?.start);
}

function regionEndExclusive(region) {
  const start = regionStart(region);
  const size = Number(region?.size || 0);
  if (start == null || !Number.isFinite(size)) return null;
  return start + size;
}

function roleTags(region) {
  const tags = [];
  const analysis = region?.analysis || {};
  if (analysis.dc2TilePairLookupAudit) tags.push('dc2_tile_pair_lookup_dual_use');
  if (analysis.playerA48TileStreamAudit) tags.push('player_a48_tile_stream_region');
  if (analysis.c34eMetaspriteFamilyAudit) tags.push('c34e_metasprite_family_target');
  if (analysis.overlapAudit) tags.push('overlap_annotated_region');
  if (analysis.animationBehaviorFamilyAudit) tags.push('behavior_animation_family_linked');
  if (analysis.roomEntityFrameAssetLinkAudit) tags.push('room_entity_frame_asset_linked');
  if (!tags.length) tags.push('metasprite_region_no_special_role');
  return tags;
}

function classifyFrame(region, frame) {
  const tags = roleTags(region);
  if (tags.includes('dc2_tile_pair_lookup_dual_use')) {
    return 'unbounded_target_inside_dual_use_dc2_tile_pair_lookup_region';
  }
  if (tags.includes('player_a48_tile_stream_region') || tags.includes('c34e_metasprite_family_target')) {
    return 'unbounded_target_inside_player_or_c34e_metasprite_region';
  }
  return `unbounded_target_inside_${region?.type || 'unknown'}_region`;
}

function commandIndex(commandCatalog) {
  const index = new Map();
  for (const stream of commandCatalog.streams || []) index.set(stream.offset, stream);
  return index;
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort());
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => value != null))].sort();
}

function alignedTerminatorSearch(rom, frameOffset, regionEnd, maxControls = 512) {
  if (frameOffset == null || regionEnd == null || frameOffset >= regionEnd) {
    return { searchedControlCount: 0, firstAlignedTerminatorOffset: null, reachedRegionEnd: true };
  }
  let searched = 0;
  for (let offset = frameOffset; offset < regionEnd && searched < maxControls; offset += 3) {
    searched++;
    if (rom[offset] === frameTerminator) {
      return {
        searchedControlCount: searched,
        firstAlignedTerminatorOffset: hex(offset),
        reachedRegionEnd: false,
      };
    }
  }
  return {
    searchedControlCount: searched,
    firstAlignedTerminatorOffset: null,
    reachedRegionEnd: frameOffset + searched * 3 >= regionEnd,
  };
}

function buildEntry(mapData, rom, commandByOffset, frame) {
  const frameOffset = parseHex(frame.offset);
  const region = frame.region?.id ? findRegionById(mapData, frame.region.id) : null;
  const start = regionStart(region);
  const endExclusive = regionEndExclusive(region);
  const estimatedParserEndExclusive = frameOffset == null ? null : frameOffset + Number(frame.pieceRecordCount || 0) * 3;
  const sourceCommandOffsets = uniqueSorted((frame.references || []).map(ref => ref.sourceCommandStream));
  const sourceCommands = sourceCommandOffsets.map(offset => commandByOffset.get(offset)).filter(Boolean);
  const sourceFamilies = uniqueSorted((frame.references || []).flatMap(ref =>
    (ref.sourceFamilies || []).map(family => family.familyId || `${family.entityType ?? 'unknown'}:${family.dispatchLabel || 'unknown'}`)
  ));

  return {
    frameOffset: frame.offset,
    region: region ? {
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
    } : frame.region || null,
    classification: classifyFrame(region, frame),
    confidence: 'medium',
    termination: frame.termination,
    referenceCount: Number(frame.referenceCount || 0),
    pieceRecordCount: Number(frame.pieceRecordCount || 0),
    estimatedParserEndExclusive: estimatedParserEndExclusive == null ? null : hex(estimatedParserEndExclusive),
    containingRegionEndExclusive: endExclusive == null ? null : hex(endExclusive),
    crossesContainingRegion: estimatedParserEndExclusive != null && endExclusive != null
      ? estimatedParserEndExclusive > endExclusive
      : null,
    bytesRemainingInContainingRegion: frameOffset != null && endExclusive != null
      ? Math.max(0, endExclusive - frameOffset)
      : null,
    alignedTerminatorSearch: alignedTerminatorSearch(rom, frameOffset, endExclusive),
    regionRoleTags: roleTags(region),
    sourceCommandSummary: {
      sourceCommandStreamCount: sourceCommandOffsets.length,
      sourceCommandStreams: sourceCommandOffsets.slice(0, 32),
      confidenceCounts: countBy(sourceCommands, command => command.confidence || 'unknown'),
      issueStreamCount: sourceCommands.filter(command => (command.issueCount || 0) > 0).length,
      issueKindCounts: countBy(sourceCommands.flatMap(command => command.issues || []), issue => issue.kind || 'unknown'),
      sourceFamilies: sourceFamilies.slice(0, 32),
    },
    evidence: [
      'Source frame stream is low-confidence in world-animation-frame-stream-catalog-2026-06-25.',
      'The triage stores offsets, region ids, counts, source command ids, and parser outcomes only.',
      'No ROM bytes or decoded sprite graphics are embedded.',
    ],
  };
}

function buildCatalog(mapData, rom) {
  const frameCatalog = requireCatalog(mapData, frameCatalogId);
  const commandCatalog = requireCatalog(mapData, commandCatalogId);
  const commandByOffset = commandIndex(commandCatalog);
  const entries = (frameCatalog.frameStreams || [])
    .filter(frame => frame.confidence === 'low' && !frame.quarantined)
    .map(frame => buildEntry(mapData, rom, commandByOffset, frame));

  const classificationCounts = countBy(entries, entry => entry.classification);
  const regionCounts = countBy(entries, entry => entry.region?.id || 'unmapped');
  const roleCounts = countBy(entries.flatMap(entry => entry.regionRoleTags), tag => tag);

  return {
    id: catalogId,
    generatedAt: now,
    tool: toolName,
    schemaVersion: 1,
    type: 'animation_frame_issue_triage_catalog',
    sourceCatalogs: [frameCatalogId, commandCatalogId],
    summary: {
      lowFrameStreamCount: entries.length,
      crossedContainingRegionCount: entries.filter(entry => entry.crossesContainingRegion).length,
      alignedTerminatorFoundAfterLimitCount: entries.filter(entry => entry.alignedTerminatorSearch.firstAlignedTerminatorOffset).length,
      classificationCounts,
      regionCounts,
      roleCounts,
      persistedRomByteCount: 0,
      persistedTileByteCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: frame offsets, region ids, parser counts, source command ids, and evidence. No ROM bytes, decoded graphics, sprites, pixels, screenshots, coordinates, music, text, or gameplay payloads are embedded.',
    },
    entries,
    evidence: [
      'world-animation-frame-stream-catalog-2026-06-25 supplies the remaining low-confidence frame targets after blank/non-metasprite quarantine.',
      'Aligned terminator search reads the local ROM but persists only counts and offsets.',
      'Region role tags come from existing map analyses such as dc2TilePairLookupAudit, playerA48TileStreamAudit, c34eMetaspriteFamilyAudit, and overlapAudit.',
    ],
    nextLeads: [
      'For _DATA_18000_ lows, resolve whether animation pointers intentionally target the dual-use DC2 tile-pair lookup or whether command parsing over-collects frame pointers.',
      'For _DATA_1B486_ low frame target 0x1BBF3, trace the single source command stream and nearby _LABEL_A48_ player/form tile stream boundaries.',
      'Add region-boundary-aware frame parsing only after these low targets are proven false frame starts or a second frame terminator rule is confirmed.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  for (const region of mapData.regions || []) {
    if (region.analysis?.animationFrameIssueTriageAudit?.catalogId === catalogId) {
      delete region.analysis.animationFrameIssueTriageAudit;
    }
  }

  const refsByRegion = new Map();
  for (const entry of catalog.entries) {
    const regionId = entry.region?.id;
    if (!regionId) continue;
    if (!refsByRegion.has(regionId)) refsByRegion.set(regionId, []);
    refsByRegion.get(regionId).push(entry);
  }

  let annotatedRegionCount = 0;
  for (const [regionId, entries] of refsByRegion.entries()) {
    const region = findRegionById(mapData, regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.animationFrameIssueTriageAudit = {
      catalogId,
      kind: 'low_confidence_frame_stream_triage_region',
      confidence: 'medium',
      lowFrameStreamCount: entries.length,
      classifications: countBy(entries, entry => entry.classification),
      frameOffsets: entries.map(entry => entry.frameOffset).sort(),
      crossedContainingRegionCount: entries.filter(entry => entry.crossesContainingRegion).length,
      sourceCommandStreamCount: new Set(entries.flatMap(entry => entry.sourceCommandSummary.sourceCommandStreams)).size,
      regionRoleTags: uniqueSorted(entries.flatMap(entry => entry.regionRoleTags)),
      summary: 'Remaining low-confidence _LABEL_792_ frame stream targets in this region require runtime or format-boundary tracing before being treated as confirmed sprite frames.',
      evidence: [
        'world-animation-frame-issue-triage-catalog-2026-06-26 records low-confidence frame offsets and parser outcomes.',
        'Metadata-only triage; no ROM bytes or decoded sprite graphics are embedded.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegionCount++;
  }
  return { annotatedRegionCount };
}

function applyCatalog(mapData, catalog) {
  const annotation = annotateMap(mapData, catalog);
  mapData.animationFrameStreamCatalogs = (mapData.animationFrameStreamCatalogs || []).filter(item => item.id !== catalogId);
  mapData.animationFrameStreamCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'animation_frame_issue_triage_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotation.annotatedRegionCount,
    },
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
  return annotation;
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotation = apply ? applyCatalog(mapData, catalog) : { annotatedRegionCount: 0 };
  if (apply) fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotation.annotatedRegionCount,
    },
    entries: catalog.entries.map(entry => ({
      frameOffset: entry.frameOffset,
      region: entry.region,
      classification: entry.classification,
      crossesContainingRegion: entry.crossesContainingRegion,
      alignedTerminatorSearch: entry.alignedTerminatorSearch,
      sourceCommandSummary: entry.sourceCommandSummary,
    })),
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
