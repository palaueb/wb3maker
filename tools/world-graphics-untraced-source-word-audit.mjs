#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-graphics-untraced-source-word-audit.mjs';
const sourceCatalogId = 'world-graphics-combined-unreferenced-shape-catalog-2026-06-26';
const combinedCoverageCatalogId = 'world-graphics-combined-source-coverage-catalog-2026-06-26';
const catalogId = 'world-graphics-untraced-source-word-catalog-2026-06-26';
const reportId = 'graphics-untraced-source-word-audit-2026-06-26';
const tileSizeBytes = 32;
const loaderLikeTypes = new Set(['vram_loader_8fb', 'vram_loader_998', 'dynamic_tile_loader']);

function hex(value, pad = 5) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(value) {
  if (typeof value === 'number') return value;
  return parseInt(value, 16);
}

function regionStart(region) {
  return offsetOf(region.offset);
}

function regionEnd(region) {
  return regionStart(region) + (region.size || 0);
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
    const catalog = value.find(item => item && item.id === id);
    if (catalog) return catalog;
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
    .sort((a, b) => (a.size || 0) - (b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function sourceWordForOffset(offset) {
  const bank = Math.floor(offset / 0x4000);
  const blockIndex = Math.floor((offset % 0x4000) / tileSizeBytes);
  const lo = blockIndex & 0xFF;
  const hi = (bank << 1) | ((blockIndex >> 8) & 0x01);
  return {
    word: lo | (hi << 8),
    bank,
    blockIndex,
  };
}

function classificationForTile(tile, occurrences, asmLiteralCount) {
  const loaderLike = occurrences.filter(item => loaderLikeTypes.has(item.sourceRegion?.type || ''));
  if (loaderLike.length) {
    return {
      kind: 'loader_like_source_word_hit_needs_trace',
      confidence: 'low',
      reason: 'The encoded source word appears in a mapped loader-like region, but no parsed source range currently covers this tile.',
    };
  }
  if (asmLiteralCount > 0) {
    return {
      kind: 'asm_literal_source_word_hit_non_loader_context',
      confidence: 'low',
      reason: 'The encoded source word appears as an ASM literal, but not in a confirmed parsed loader source field.',
    };
  }
  if (occurrences.length) {
    return {
      kind: 'non_loader_source_word_shape_hits_only',
      confidence: 'low',
      reason: 'The encoded source word appears only in non-loader mapped regions and is retained as false-positive-prone lead evidence.',
    };
  }
  return {
    kind: 'no_encoded_source_word_hits',
    confidence: 'medium',
    reason: 'No raw encoded source-word occurrence was found anywhere in the ROM for this untraced source tile.',
  };
}

function tileIsBlank(rom, offset) {
  if (offset < 0 || offset + tileSizeBytes > rom.length) return false;
  for (let cursor = offset; cursor < offset + tileSizeBytes; cursor++) {
    if (rom[cursor] !== 0) return false;
  }
  return true;
}

function collectTargetTiles(shapeCatalog, rom) {
  const tiles = [];
  for (const span of shapeCatalog.spans || []) {
    if ((span.shapeStats?.nonblankTileCount || 0) <= 0) continue;
    const start = offsetOf(span.start);
    const count = Math.floor((span.sizeBytes || 0) / tileSizeBytes);
    for (let index = 0; index < count; index++) {
      const tileOffset = start + index * tileSizeBytes;
      if (tileIsBlank(rom, tileOffset)) continue;
      const shapeIndex = index + 1;
      const nonblankCount = span.shapeStats?.nonblankTileCount || 0;
      const blankCount = span.shapeStats?.blankTileCount || 0;
      const maybeBlank = blankCount > 0 && nonblankCount < count;
      const source = sourceWordForOffset(tileOffset);
      tiles.push({
        id: `${span.id}_tile_${String(index).padStart(3, '0')}`,
        spanId: span.id,
        region: span.region,
        tileOffset,
        tileEndExclusive: tileOffset + tileSizeBytes,
        tileIndexInSpan: index,
        tileOrdinalInSpan: shapeIndex,
        sourceWord: source.word,
        sourceBank: source.bank,
        sourceBlockIndex: source.blockIndex,
        maybeBlankInMixedSpan: maybeBlank,
        spanClassification: span.classification,
      });
    }
  }
  return tiles;
}

function scanRomWordOccurrences(rom, mapData, targetWords) {
  const occurrencesByWord = new Map();
  for (let offset = 0; offset + 1 < rom.length; offset++) {
    const word = rom[offset] | (rom[offset + 1] << 8);
    if (!targetWords.has(word)) continue;
    const sourceRegion = containingRegion(mapData, offset);
    const occurrence = {
      offset,
      sourceRegion: compactRegion(sourceRegion),
      classification: loaderLikeTypes.has(sourceRegion?.type || '')
        ? 'loader_like_region_word_hit'
        : 'non_loader_region_word_shape_hit',
    };
    if (!occurrencesByWord.has(word)) occurrencesByWord.set(word, []);
    occurrencesByWord.get(word).push(occurrence);
  }
  return occurrencesByWord;
}

function scanAsmLiteralOccurrences(asmText, targetWords) {
  const counts = new Map();
  const samples = new Map();
  const lines = asmText.split(/\r?\n/);
  for (const [lineIndex, line] of lines.entries()) {
    const code = String(line).split(';')[0];
    if (!code.trim()) continue;
    const matches = code.matchAll(/\$([0-9A-F]{4})\b/gi);
    for (const match of matches) {
      const word = parseInt(match[1], 16);
      if (!targetWords.has(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
      if (!samples.has(word)) samples.set(word, []);
      const wordSamples = samples.get(word);
      if (wordSamples.length < 4) {
        wordSamples.push({
          line: lineIndex + 1,
          context: code.trim().slice(0, 160),
        });
      }
    }
  }
  return { counts, samples };
}

function buildTileSummaries(targetTiles, occurrencesByWord, asmHits) {
  return targetTiles.map(tile => {
    const occurrences = occurrencesByWord.get(tile.sourceWord) || [];
    const asmLiteralCount = asmHits.counts.get(tile.sourceWord) || 0;
    const classification = classificationForTile(tile, occurrences, asmLiteralCount);
    return {
      id: tile.id,
      spanId: tile.spanId,
      region: tile.region,
      tileOffset: hex(tile.tileOffset),
      tileEndExclusive: hex(tile.tileEndExclusive),
      sourceBank: tile.sourceBank,
      sourceBlockIndex: hex(tile.sourceBlockIndex, 3),
      encodedSourceWord: hex(tile.sourceWord, 4),
      rawOccurrenceCount: occurrences.length,
      loaderLikeRawOccurrenceCount: occurrences.filter(item => item.classification === 'loader_like_region_word_hit').length,
      nonLoaderRawOccurrenceCount: occurrences.filter(item => item.classification === 'non_loader_region_word_shape_hit').length,
      asmLiteralCount,
      occurrenceCountsByRegionType: countBy(occurrences, item => item.sourceRegion?.type || 'unmapped'),
      occurrenceSamples: occurrences.slice(0, 6).map(item => ({
        offset: hex(item.offset),
        sourceRegion: item.sourceRegion,
        classification: item.classification,
      })),
      asmLiteralSamples: (asmHits.samples.get(tile.sourceWord) || []).slice(0, 4),
      classification,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    };
  });
}

function buildSpanSummaries(shapeCatalog, tileSummaries) {
  const tilesBySpan = new Map();
  for (const tile of tileSummaries) {
    if (!tilesBySpan.has(tile.spanId)) tilesBySpan.set(tile.spanId, []);
    tilesBySpan.get(tile.spanId).push(tile);
  }
  const spans = [];
  for (const span of shapeCatalog.spans || []) {
    const tiles = tilesBySpan.get(span.id) || [];
    if (!tiles.length) continue;
    const loaderLikeTileCount = tiles.filter(tile => tile.loaderLikeRawOccurrenceCount > 0).length;
    const asmLiteralTileCount = tiles.filter(tile => tile.asmLiteralCount > 0).length;
    const rawHitTileCount = tiles.filter(tile => tile.rawOccurrenceCount > 0).length;
    const classificationCounts = countBy(tiles, tile => tile.classification.kind);
    const status = loaderLikeTileCount
      ? 'has_loader_like_source_word_leads'
      : asmLiteralTileCount
        ? 'has_asm_literal_source_word_leads'
        : rawHitTileCount
          ? 'non_loader_word_shape_hits_only'
          : 'no_encoded_source_word_hits';
    spans.push({
      id: span.id,
      region: span.region,
      start: span.start,
      endExclusive: span.endExclusive,
      sizeBytes: span.sizeBytes,
      tileCount: span.tileCount,
      nonblankTileCount: span.shapeStats?.nonblankTileCount || 0,
      rawHitTileCount,
      loaderLikeTileCount,
      asmLiteralTileCount,
      status,
      classificationCounts,
      tileSamples: tiles.slice(0, 12).map(tile => ({
        tileOffset: tile.tileOffset,
        encodedSourceWord: tile.encodedSourceWord,
        rawOccurrenceCount: tile.rawOccurrenceCount,
        loaderLikeRawOccurrenceCount: tile.loaderLikeRawOccurrenceCount,
        asmLiteralCount: tile.asmLiteralCount,
        classification: tile.classification,
      })),
    });
  }
  return spans.sort((a, b) => b.sizeBytes - a.sizeBytes || offsetOf(a.start) - offsetOf(b.start));
}

function groupByRegion(spanSummaries) {
  const groups = new Map();
  for (const span of spanSummaries) {
    if (!groups.has(span.region.id)) {
      groups.set(span.region.id, {
        region: span.region,
        spanCount: 0,
        sizeBytes: 0,
        tileCount: 0,
        nonblankTileCount: 0,
        rawHitTileCount: 0,
        loaderLikeTileCount: 0,
        asmLiteralTileCount: 0,
        statusCounts: {},
        classificationCounts: {},
        largestSpan: null,
      });
    }
    const group = groups.get(span.region.id);
    group.spanCount++;
    group.sizeBytes += span.sizeBytes;
    group.tileCount += span.tileCount;
    group.nonblankTileCount += span.nonblankTileCount;
    group.rawHitTileCount += span.rawHitTileCount;
    group.loaderLikeTileCount += span.loaderLikeTileCount;
    group.asmLiteralTileCount += span.asmLiteralTileCount;
    group.statusCounts[span.status] = (group.statusCounts[span.status] || 0) + 1;
    for (const [kind, count] of Object.entries(span.classificationCounts)) {
      group.classificationCounts[kind] = (group.classificationCounts[kind] || 0) + count;
    }
    if (!group.largestSpan || span.sizeBytes > group.largestSpan.sizeBytes) {
      group.largestSpan = {
        id: span.id,
        start: span.start,
        endExclusive: span.endExclusive,
        sizeBytes: span.sizeBytes,
        tileCount: span.tileCount,
        status: span.status,
      };
    }
  }
  return [...groups.values()].sort((a, b) => b.sizeBytes - a.sizeBytes || offsetOf(a.region.offset) - offsetOf(b.region.offset));
}

function buildCatalog(mapData, rom, asmText) {
  const shapeCatalog = requireCatalog(mapData, sourceCatalogId);
  requireCatalog(mapData, combinedCoverageCatalogId);
  const targetTiles = collectTargetTiles(shapeCatalog, rom);
  const targetWords = new Set(targetTiles.map(tile => tile.sourceWord));
  const occurrencesByWord = scanRomWordOccurrences(rom, mapData, targetWords);
  const asmHits = scanAsmLiteralOccurrences(asmText, targetWords);
  const tileSummaries = buildTileSummaries(targetTiles, occurrencesByWord, asmHits);
  const spanSummaries = buildSpanSummaries(shapeCatalog, tileSummaries);
  const regions = groupByRegion(spanSummaries);

  const summary = tileSummaries.reduce((acc, tile) => {
    acc.targetTileCount++;
    acc.rawOccurrenceCount += tile.rawOccurrenceCount;
    acc.loaderLikeRawOccurrenceCount += tile.loaderLikeRawOccurrenceCount;
    acc.nonLoaderRawOccurrenceCount += tile.nonLoaderRawOccurrenceCount;
    acc.asmLiteralCount += tile.asmLiteralCount;
    if (tile.rawOccurrenceCount > 0) acc.tilesWithRawOccurrences++;
    if (tile.loaderLikeRawOccurrenceCount > 0) acc.tilesWithLoaderLikeRawOccurrences++;
    if (tile.asmLiteralCount > 0) acc.tilesWithAsmLiteralOccurrences++;
    acc.classificationCounts[tile.classification.kind] = (acc.classificationCounts[tile.classification.kind] || 0) + 1;
    return acc;
  }, {
    sourceCatalogId,
    combinedCoverageCatalogId,
    targetSpanCount: spanSummaries.length,
    targetRegionCount: regions.length,
    targetTileCount: 0,
    uniqueEncodedSourceWordCount: targetWords.size,
    rawOccurrenceCount: 0,
    tilesWithRawOccurrences: 0,
    loaderLikeRawOccurrenceCount: 0,
    tilesWithLoaderLikeRawOccurrences: 0,
    nonLoaderRawOccurrenceCount: 0,
    asmLiteralCount: 0,
    tilesWithAsmLiteralOccurrences: 0,
    classificationCounts: {},
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    assetPolicy: 'Metadata only: source tile offsets, encoded source words, occurrence counts, region ids/types, ASM line numbers, and classifications. No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are embedded.',
  });

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceCatalogId, combinedCoverageCatalogId],
    summary,
    regions,
    spans: spanSummaries,
    priorityLoaderLikeSpans: spanSummaries
      .filter(span => span.loaderLikeTileCount > 0)
      .slice(0, 16),
    priorityNoHitSpans: spanSummaries
      .filter(span => span.status === 'no_encoded_source_word_hits')
      .slice(0, 16),
    tileSummarySample: tileSummaries
      .filter(tile => tile.loaderLikeRawOccurrenceCount > 0 || tile.asmLiteralCount > 0)
      .slice(0, 32),
    evidence: [
      `${sourceCatalogId} supplies the current remaining nonblank graphics-source spans after confirmed source coverage is merged.`,
      'Each target tile was converted to the same bank/block encoded source word used by _LABEL_8FB_/_LABEL_998_ and dynamic tile source records.',
      'Raw word occurrences are classified by containing map region; non-loader hits are retained only as low-confidence leads.',
      'No ROM bytes, tile bytes, hashes, pixels, screenshots, or decoded graphics are stored.',
    ],
    nextLeads: [
      'For spans with loader-like raw word hits, inspect the containing loader-like region to determine whether the parser missed a source field or the hit is incidental data.',
      'For spans with no encoded source-word hits, prioritize direct-copy/decompression routines or alternate source-address calculations instead of loader-table searches.',
      'Do not promote non-loader word-shaped hits to source coverage until a routine or table consumer is traced.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  for (const group of catalog.regions) {
    const region = findRegionById(mapData, group.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.graphicsUntracedSourceWordAudit = {
      catalogId,
      kind: 'untraced_graphics_source_word_scan',
      confidence: group.loaderLikeTileCount > 0 ? 'low' : 'medium',
      sourceCatalogId,
      combinedCoverageCatalogId,
      spanCount: group.spanCount,
      tileCount: group.tileCount,
      nonblankTileCount: group.nonblankTileCount,
      rawHitTileCount: group.rawHitTileCount,
      loaderLikeTileCount: group.loaderLikeTileCount,
      asmLiteralTileCount: group.asmLiteralTileCount,
      statusCounts: group.statusCounts,
      classificationCounts: group.classificationCounts,
      largestSpan: group.largestSpan,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      evidence: [
        `Derived from ${sourceCatalogId}; source-word hits are leads, not confirmed consumers.`,
        'No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      spanCount: group.spanCount,
      tileCount: group.tileCount,
      loaderLikeTileCount: group.loaderLikeTileCount,
      statusCounts: group.statusCounts,
    });
  }
  return annotatedRegions;
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, rom, asmText);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : catalog.regions.map(group => ({
    id: group.region.id,
    offset: group.region.offset,
    name: group.region.name || '',
    spanCount: group.spanCount,
    tileCount: group.tileCount,
    loaderLikeTileCount: group.loaderLikeTileCount,
    statusCounts: group.statusCounts,
  }));

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_untraced_source_word_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      annotatedRegions,
      priorityLoaderLikeSpans: catalog.priorityLoaderLikeSpans,
      priorityNoHitSpans: catalog.priorityNoHitSpans,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegionCount: annotatedRegions.length,
    priorityLoaderLikeSpans: catalog.priorityLoaderLikeSpans.slice(0, 8),
    priorityNoHitSpans: catalog.priorityNoHitSpans.slice(0, 8),
  }, null, 2));
}

main();
