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
const toolName = 'tools/world-graphics-source-word-context-audit.mjs';
const remainingLeadCatalogId = 'world-graphics-remaining-lead-reconciliation-catalog-2026-06-26';
const resolverCatalogId = 'world-graphics-loader-like-word-hit-resolver-catalog-2026-06-26';
const catalogId = 'world-graphics-source-word-context-catalog-2026-06-26';
const reportId = 'graphics-source-word-context-audit-2026-06-26';
const tileSizeBytes = 32;
const loaderLikeTypes = new Set(['vram_loader_8fb', 'vram_loader_998', 'dynamic_tile_loader']);
const structuredLeadTypes = new Set([
  'pointer_table',
  'data_table',
  'room_data',
  'room_subrecord',
  'room_seq_table',
  'item_data',
  'entity_data',
  'entity_behavior_table',
  'entity_anim_table',
  'screen_prog',
  'screen_prog_table',
  'vdp_stream',
  'palette_script',
  'palette_script_table',
  'input_script',
  'effect_script',
  'audio_driver_data',
]);
const payloadLikeTypes = new Set([
  'gfx_tiles',
  'tile_map',
  'meta_sprite',
  'music',
  'entity_anim_script',
  'text',
  'palette',
  'null',
  'code',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function offsetOf(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 16);
  return NaN;
}

function regionStart(region) {
  return offsetOf(region.offset);
}

function regionEnd(region) {
  return regionStart(region) + Number(region.size || 0);
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

function containingRegion(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
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

function topCounts(counts, limit = 10) {
  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function tileIsBlank(rom, offset) {
  if (offset < 0 || offset + tileSizeBytes > rom.length) return false;
  for (let cursor = offset; cursor < offset + tileSizeBytes; cursor++) {
    if (rom[cursor] !== 0) return false;
  }
  return true;
}

function sourceWordForOffset(offset) {
  const bank = Math.floor(offset / 0x4000);
  const blockIndex = Math.floor((offset % 0x4000) / tileSizeBytes);
  return {
    word: (blockIndex & 0xFF) | (((bank << 1) | ((blockIndex >> 8) & 0x01)) << 8),
    bank,
    blockIndex,
  };
}

function collectSpanTiles(rom, entry) {
  const tiles = [];
  const start = offsetOf(entry.start);
  const endExclusive = offsetOf(entry.endExclusive);
  const tileCount = Math.floor((endExclusive - start) / tileSizeBytes);
  for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
    const tileOffset = start + tileIndex * tileSizeBytes;
    if (tileIsBlank(rom, tileOffset)) continue;
    const source = sourceWordForOffset(tileOffset);
    tiles.push({
      tileOffset,
      sourceWord: source.word,
      sourceBank: source.bank,
      sourceBlockIndex: source.blockIndex,
    });
  }
  return tiles;
}

function scanOccurrences(rom, mapData, targetWords) {
  const byWord = new Map();
  for (let offset = 0; offset + 1 < rom.length; offset++) {
    const word = rom[offset] | (rom[offset + 1] << 8);
    if (!targetWords.has(word)) continue;
    const sourceRegion = containingRegion(mapData, offset);
    if (!byWord.has(word)) byWord.set(word, []);
    byWord.get(word).push({
      offset,
      sourceRegion: compactRegion(sourceRegion),
    });
  }
  return byWord;
}

function resolverBySpan(resolverCatalog) {
  const bySpan = new Map();
  for (const resolution of resolverCatalog.resolutions || []) {
    const spanId = resolution.target?.spanId;
    if (!spanId) continue;
    if (!bySpan.has(spanId)) bySpan.set(spanId, []);
    bySpan.get(spanId).push(resolution);
  }
  return bySpan;
}

function classifyContext(entry, stats, resolverCounts) {
  if (stats.rawOccurrenceCount === 0) {
    return {
      kind: 'no_raw_source_word_occurrences',
      confidence: 'medium_high',
      priority: 'trace_direct_copy_or_decompression',
      reason: 'None of the span source words occur elsewhere in the ROM as raw little-endian words.',
    };
  }

  if (resolverCounts.static_loader_record_non_source_word_overlap || resolverCounts.dynamic_loader_record_non_source_word_overlap) {
    return {
      kind: 'loader_like_hits_resolved_non_source_plus_context',
      confidence: 'medium_high',
      priority: 'trace_direct_copy_or_decompression',
      reason: 'Loader-like hits for this span are already resolved as parsed non-source fields; remaining raw hits are context-only leads.',
    };
  }

  if (stats.structuredOccurrenceCount > 0) {
    return {
      kind: 'non_loader_structured_data_occurrences_need_trace',
      confidence: 'low',
      priority: 'inspect_structured_occurrences',
      reason: 'At least one raw source-word occurrence lands in a non-loader structured data region.',
    };
  }

  if (stats.payloadLikeOccurrenceCount === stats.rawOccurrenceCount) {
    return {
      kind: 'raw_hits_only_in_payload_or_code_regions',
      confidence: 'medium',
      priority: entry.classification?.priorityGroup || 'trace_non_loader_occurrences',
      reason: 'All raw source-word occurrences are in payload-like or executable regions rather than structured pointer/data regions.',
    };
  }

  return {
    kind: 'mixed_non_loader_context',
    confidence: 'low',
    priority: entry.classification?.priorityGroup || 'manual_review',
    reason: 'Raw source-word occurrences have mixed context and need manual review.',
  };
}

function buildSpanContext(entry, tiles, occurrencesByWord, resolverResolutions) {
  const occurrences = [];
  const tileWordsWithOccurrences = new Set();
  const tileWordsWithStructuredOccurrences = new Set();
  const sourceWordCounts = {};

  for (const tile of tiles) {
    const wordOccurrences = occurrencesByWord.get(tile.sourceWord) || [];
    if (wordOccurrences.length) tileWordsWithOccurrences.add(tile.sourceWord);
    sourceWordCounts[hex(tile.sourceWord, 4)] = wordOccurrences.length;
    for (const occurrence of wordOccurrences) {
      const sourceType = occurrence.sourceRegion?.type || 'unmapped';
      if (structuredLeadTypes.has(sourceType)) tileWordsWithStructuredOccurrences.add(tile.sourceWord);
      occurrences.push({
        ...occurrence,
        targetTileOffset: tile.tileOffset,
        sourceWord: tile.sourceWord,
      });
    }
  }

  const regionTypeCounts = countBy(occurrences, item => item.sourceRegion?.type || 'unmapped');
  const sourceRegionCounts = countBy(occurrences, item => item.sourceRegion?.id || 'unmapped');
  const loaderLikeOccurrenceCount = occurrences.filter(item => loaderLikeTypes.has(item.sourceRegion?.type || '')).length;
  const structuredOccurrenceCount = occurrences.filter(item => structuredLeadTypes.has(item.sourceRegion?.type || '')).length;
  const payloadLikeOccurrenceCount = occurrences.filter(item => payloadLikeTypes.has(item.sourceRegion?.type || '')).length;
  const targetRegionOccurrenceCount = occurrences.filter(item => item.sourceRegion?.id === entry.region?.id).length;
  const resolverCounts = countBy(resolverResolutions, item => item.resolutionKind);
  const stats = {
    targetTileCount: tiles.length,
    uniqueSourceWordCount: new Set(tiles.map(tile => tile.sourceWord)).size,
    rawOccurrenceCount: occurrences.length,
    tileWordsWithOccurrences: tileWordsWithOccurrences.size,
    tileWordsWithNoOccurrences: new Set(tiles.map(tile => tile.sourceWord)).size - tileWordsWithOccurrences.size,
    tileWordsWithStructuredOccurrences: tileWordsWithStructuredOccurrences.size,
    loaderLikeOccurrenceCount,
    nonLoaderOccurrenceCount: occurrences.length - loaderLikeOccurrenceCount,
    structuredOccurrenceCount,
    payloadLikeOccurrenceCount,
    targetRegionOccurrenceCount,
  };
  const classification = classifyContext(entry, stats, resolverCounts);
  const sourceRegionRefs = new Map();
  for (const occurrence of occurrences) {
    if (occurrence.sourceRegion?.id && !sourceRegionRefs.has(occurrence.sourceRegion.id)) {
      sourceRegionRefs.set(occurrence.sourceRegion.id, occurrence.sourceRegion);
    }
  }

  return {
    id: `${entry.spanId}_source_word_context`,
    spanId: entry.spanId,
    region: entry.region,
    start: entry.start,
    endExclusive: entry.endExclusive,
    sizeBytes: Number(entry.sizeBytes || 0),
    nonblankTileCount: Number(entry.nonblankTileCount || 0),
    targetTileCount: stats.targetTileCount,
    uniqueSourceWordCount: stats.uniqueSourceWordCount,
    rawOccurrenceCount: stats.rawOccurrenceCount,
    tileWordsWithOccurrences: stats.tileWordsWithOccurrences,
    tileWordsWithNoOccurrences: stats.tileWordsWithNoOccurrences,
    tileWordsWithStructuredOccurrences: stats.tileWordsWithStructuredOccurrences,
    loaderLikeOccurrenceCount: stats.loaderLikeOccurrenceCount,
    nonLoaderOccurrenceCount: stats.nonLoaderOccurrenceCount,
    structuredOccurrenceCount: stats.structuredOccurrenceCount,
    payloadLikeOccurrenceCount: stats.payloadLikeOccurrenceCount,
    targetRegionOccurrenceCount: stats.targetRegionOccurrenceCount,
    occurrenceRegionTypeCounts: regionTypeCounts,
    topOccurrenceRegionTypes: topCounts(regionTypeCounts),
    topOccurrenceRegions: topCounts(sourceRegionCounts, 12).map(item => ({
      ...item,
      region: sourceRegionRefs.get(item.key) || null,
    })),
    resolverCounts,
    priorLeadClassification: entry.classification || null,
    classification,
    sourceWordOccurrenceCountSample: Object.entries(sourceWordCounts)
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .slice(0, 12)
      .map(([sourceWord, occurrenceCount]) => ({ sourceWord, occurrenceCount })),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    evidence: [
      `Target span comes from ${remainingLeadCatalogId}.`,
      `Loader-like hit resolution comes from ${resolverCatalogId}.`,
      'The local ROM was scanned only for little-endian source-word occurrence counts and containing mapped region ids/types.',
      'No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.',
    ],
  };
}

function groupRegions(entries) {
  const byRegion = new Map();
  for (const entry of entries) {
    const regionId = entry.region?.id;
    if (!regionId) continue;
    if (!byRegion.has(regionId)) {
      byRegion.set(regionId, {
        region: entry.region,
        spanCount: 0,
        targetTileCount: 0,
        rawOccurrenceCount: 0,
        structuredOccurrenceCount: 0,
        payloadLikeOccurrenceCount: 0,
        classificationCounts: {},
        topSpans: [],
      });
    }
    const group = byRegion.get(regionId);
    group.spanCount++;
    group.targetTileCount += entry.targetTileCount;
    group.rawOccurrenceCount += entry.rawOccurrenceCount;
    group.structuredOccurrenceCount += entry.structuredOccurrenceCount;
    group.payloadLikeOccurrenceCount += entry.payloadLikeOccurrenceCount;
    group.classificationCounts[entry.classification.kind] = (group.classificationCounts[entry.classification.kind] || 0) + 1;
    group.topSpans.push({
      spanId: entry.spanId,
      start: entry.start,
      endExclusive: entry.endExclusive,
      rawOccurrenceCount: entry.rawOccurrenceCount,
      structuredOccurrenceCount: entry.structuredOccurrenceCount,
      classification: entry.classification,
    });
  }
  for (const group of byRegion.values()) {
    group.topSpans.sort((a, b) => b.rawOccurrenceCount - a.rawOccurrenceCount || offsetOf(a.start) - offsetOf(b.start));
    group.topSpans = group.topSpans.slice(0, 8);
  }
  return [...byRegion.values()].sort((a, b) => b.targetTileCount - a.targetTileCount || offsetOf(a.region.offset) - offsetOf(b.region.offset));
}

function buildCatalog(mapData, rom) {
  const remainingLeadCatalog = requireCatalog(mapData, remainingLeadCatalogId);
  const resolverCatalog = requireCatalog(mapData, resolverCatalogId);
  const resolverIndex = resolverBySpan(resolverCatalog);
  const leadEntries = (remainingLeadCatalog.entries || [])
    .filter(entry => Number(entry.nonblankTileCount || 0) > 0);
  const tilesBySpan = new Map();
  const targetWords = new Set();
  for (const entry of leadEntries) {
    const tiles = collectSpanTiles(rom, entry);
    tilesBySpan.set(entry.spanId, tiles);
    for (const tile of tiles) targetWords.add(tile.sourceWord);
  }
  const occurrencesByWord = scanOccurrences(rom, mapData, targetWords);
  const entries = leadEntries.map(entry => buildSpanContext(
    entry,
    tilesBySpan.get(entry.spanId) || [],
    occurrencesByWord,
    resolverIndex.get(entry.spanId) || [],
  ));
  const regions = groupRegions(entries);
  const summary = {
    sourceCatalogs: [remainingLeadCatalogId, resolverCatalogId],
    targetSpanCount: entries.length,
    targetRegionCount: regions.length,
    targetTileCount: entries.reduce((sum, entry) => sum + entry.targetTileCount, 0),
    uniqueSourceWordCount: targetWords.size,
    rawOccurrenceCount: entries.reduce((sum, entry) => sum + entry.rawOccurrenceCount, 0),
    loaderLikeOccurrenceCount: entries.reduce((sum, entry) => sum + entry.loaderLikeOccurrenceCount, 0),
    structuredOccurrenceCount: entries.reduce((sum, entry) => sum + entry.structuredOccurrenceCount, 0),
    payloadLikeOccurrenceCount: entries.reduce((sum, entry) => sum + entry.payloadLikeOccurrenceCount, 0),
    classificationCounts: countBy(entries, entry => entry.classification.kind),
    priorityCounts: countBy(entries, entry => entry.classification.priority),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    assetPolicy: 'Metadata only: source-word occurrence counts, containing region ids/types, resolver counts, and classification labels. No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [remainingLeadCatalogId, resolverCatalogId],
    summary,
    regions,
    entries,
    topStructuredLeads: entries
      .filter(entry => entry.structuredOccurrenceCount > 0)
      .sort((a, b) => b.structuredOccurrenceCount - a.structuredOccurrenceCount || b.rawOccurrenceCount - a.rawOccurrenceCount || offsetOf(a.start) - offsetOf(b.start))
      .slice(0, 16)
      .map(entry => ({
        spanId: entry.spanId,
        region: entry.region,
        start: entry.start,
        endExclusive: entry.endExclusive,
        structuredOccurrenceCount: entry.structuredOccurrenceCount,
        rawOccurrenceCount: entry.rawOccurrenceCount,
        topOccurrenceRegionTypes: entry.topOccurrenceRegionTypes,
        classification: entry.classification,
      })),
    topNoiseOnlySpans: entries
      .filter(entry => entry.classification.kind === 'raw_hits_only_in_payload_or_code_regions')
      .sort((a, b) => b.rawOccurrenceCount - a.rawOccurrenceCount || offsetOf(a.start) - offsetOf(b.start))
      .slice(0, 16)
      .map(entry => ({
        spanId: entry.spanId,
        region: entry.region,
        start: entry.start,
        endExclusive: entry.endExclusive,
        rawOccurrenceCount: entry.rawOccurrenceCount,
        topOccurrenceRegionTypes: entry.topOccurrenceRegionTypes,
        classification: entry.classification,
      })),
    evidence: [
      'This audit re-scans unresolved graphics source words and aggregates the mapped region context of each raw little-endian occurrence.',
      'Occurrences inside loader-like regions remain governed by the loader-like word-hit resolver catalog.',
      'Occurrence context is only triage evidence and does not prove asset consumption.',
      'No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.',
    ],
    nextLeads: [
      'Inspect topStructuredLeads first when looking for non-loader consumers, because those hits land in structured data rather than payload-like byte streams.',
      'Treat raw_hits_only_in_payload_or_code_regions spans as lower-confidence source-word evidence until a code path is found.',
      'For no_raw_source_word_occurrences spans, search direct-copy/decompression routines instead of pointer/source-word tables.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  for (const group of catalog.regions) {
    const region = findRegionById(mapData, group.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.graphicsSourceWordContextAudit = {
      catalogId,
      kind: 'graphics_source_word_context',
      confidence: group.structuredOccurrenceCount ? 'low' : 'medium',
      spanCount: group.spanCount,
      targetTileCount: group.targetTileCount,
      rawOccurrenceCount: group.rawOccurrenceCount,
      structuredOccurrenceCount: group.structuredOccurrenceCount,
      payloadLikeOccurrenceCount: group.payloadLikeOccurrenceCount,
      classificationCounts: group.classificationCounts,
      topSpans: group.topSpans,
      summary: `${group.spanCount} remaining span(s) have source-word context aggregated by containing region type.`,
      evidence: [
        `Derived from ${catalogId}; occurrence context is triage evidence only.`,
        'No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      region: compactRegion(region),
      spanCount: group.spanCount,
      targetTileCount: group.targetTileCount,
      rawOccurrenceCount: group.rawOccurrenceCount,
      structuredOccurrenceCount: group.structuredOccurrenceCount,
      classificationCounts: group.classificationCounts,
    });
  }
  return annotatedRegions;
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [];

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_source_word_context_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      topStructuredLeads: catalog.topStructuredLeads,
      topNoiseOnlySpans: catalog.topNoiseOnlySpans,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      annotatedRegions,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotatedRegions.length,
    },
    topStructuredLeads: catalog.topStructuredLeads.slice(0, 8),
    topNoiseOnlySpans: catalog.topNoiseOnlySpans.slice(0, 8),
    annotatedRegions,
  }, null, 2));
}

main();
