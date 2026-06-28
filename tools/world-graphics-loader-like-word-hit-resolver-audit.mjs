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
const toolName = 'tools/world-graphics-loader-like-word-hit-resolver-audit.mjs';
const sourceWordCatalogId = 'world-graphics-untraced-source-word-catalog-2026-06-26';
const shapeCatalogId = 'world-graphics-combined-unreferenced-shape-catalog-2026-06-26';
const staticTileCatalogId = 'world-tile-source-catalog-2026-06-24';
const vram998VariantCatalogId = 'world-vram998-entrypoint-variant-catalog-2026-06-26';
const dynamicTileCatalogId = 'world-dynamic-tile-source-table-catalog-2026-06-25';
const catalogId = 'world-graphics-loader-like-word-hit-resolver-catalog-2026-06-26';
const reportId = 'graphics-loader-like-word-hit-resolver-audit-2026-06-26';
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

function regionStart(region) {
  return offsetOf(region.offset);
}

function regionEnd(region) {
  return regionStart(region) + (region.size || 0);
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
  const lo = blockIndex & 0xFF;
  const hi = (bank << 1) | ((blockIndex >> 8) & 0x01);
  return {
    word: lo | (hi << 8),
    bank,
    blockIndex,
  };
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
      const source = sourceWordForOffset(tileOffset);
      tiles.push({
        id: `${span.id}_tile_${String(index).padStart(3, '0')}`,
        spanId: span.id,
        region: span.region,
        tileOffset,
        tileEndExclusive: tileOffset + tileSizeBytes,
        sourceWord: source.word,
        sourceBank: source.bank,
        sourceBlockIndex: source.blockIndex,
      });
    }
  }
  return tiles;
}

function parseHexValue(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function sourceRangeCoversTile(source, tileOffset) {
  if (!source) return false;
  const start = parseHexValue(source.romStart ?? source.sourceRomOffset);
  const end = parseHexValue(source.romEndExclusive ?? source.sourceEndExclusive);
  return Number.isFinite(start) && Number.isFinite(end) && tileOffset >= start && tileOffset < end;
}

function sourceWordFromSource(source) {
  if (!source) return null;
  const bank = Number(source.bank ?? source.sourceBank);
  const block = parseHexValue(source.blockIndex ?? source.sourceTileIndex);
  if (!Number.isFinite(bank) || !Number.isFinite(block)) return null;
  const lo = block & 0xFF;
  const hi = (bank << 1) | ((block >> 8) & 0x01);
  return lo | (hi << 8);
}

function addStaticRecord(index, loader, entry) {
  const entryOffset = offsetOf(entry.entryOffset);
  const format = loader.format;
  const record = {
    loaderRegion: loader.loaderRegion,
    loaderFormat: format,
    loaderEntryId: loader.id,
    entryIndex: entry.entryIndex,
    entryOffset,
    entryKind: entry.kind,
    vramTileRange: entry.vramTileRange || null,
    source: entry.source || null,
  };

  const offsets = [];
  if (format === '8fb') {
    offsets.push([entryOffset, 'count_vram_low_cross_word']);
    offsets.push([entryOffset + 1, 'vram_destination_word']);
    offsets.push([entryOffset + 2, 'vram_high_source_low_cross_word']);
    offsets.push([entryOffset + 3, 'source_word_field']);
    offsets.push([entryOffset + 4, 'source_high_next_record_cross_word']);
  } else if (format === '998') {
    const hasSetPos = Boolean(entry.setPos);
    offsets.push([entryOffset, hasSetPos ? 'opcode_tile_slot_cross_word' : 'opcode_source_low_cross_word']);
    if (hasSetPos) offsets.push([entryOffset + 1, 'tile_slot_source_low_cross_word']);
    if (entry.kind === 'copy') offsets.push([entryOffset + (hasSetPos ? 2 : 1), 'source_word_field']);
  }

  for (const [offset, role] of offsets) {
    if (!index.has(offset)) index.set(offset, []);
    index.get(offset).push({ ...record, role, parserFamily: 'static_tile_loader' });
  }
}

function addVram998VariantRecords(index, variantCatalog) {
  if (!variantCatalog) return;
  for (const table of variantCatalog.variantTables || []) {
    for (const variant of table.variants || []) {
      const loader = {
        id: variant.id,
        loaderRegion: table.loaderRegion,
        format: '998',
      };
      for (const entry of variant.entries || []) {
        addStaticRecord(index, loader, {
          ...entry,
          entryIndex: `${variant.variantIndex}:${entry.entryIndex}`,
        });
      }
    }
  }
}

function buildStaticFieldIndex(staticCatalog, variantCatalog) {
  const index = new Map();
  for (const loader of staticCatalog.loaderEntries || []) {
    for (const entry of loader.entries || []) addStaticRecord(index, loader, entry);
  }
  addVram998VariantRecords(index, variantCatalog);
  return index;
}

function readWordLE(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function bankedZ80ToRom(bank, z80Address) {
  if (z80Address < 0x8000 || z80Address > 0xBFFF) return null;
  return bank * 0x4000 + (z80Address - 0x8000);
}

function dynamicSourceWordToSpan(word, count) {
  const sourceBank = word >>> 9;
  const tileIndex = word & 0x01FF;
  const sourceRomOffset = bankedZ80ToRom(sourceBank, 0x8000 + tileIndex * tileSizeBytes);
  return {
    bank: sourceBank,
    blockIndex: tileIndex,
    romStart: sourceRomOffset,
    romEndExclusive: sourceRomOffset == null ? null : sourceRomOffset + count * tileSizeBytes,
  };
}

function parseDynamicStreamRecords(rom, startOffset, maxSteps = 256) {
  const records = [];
  let cursor = startOffset;
  for (let step = 0; step < maxSteps && cursor < rom.length; step++) {
    const opcodeOffset = cursor;
    let count = rom[cursor++];
    if (count === 0x00) {
      records.push({
        opcodeOffset,
        endExclusive: cursor,
        kind: 'terminator',
      });
      break;
    }
    const rawCount = count;
    let destinationTile = null;
    if (count & 0x80) {
      count &= 0x7F;
      destinationTile = rom[cursor++];
    }
    if (count === 0x7F) {
      records.push({
        opcodeOffset,
        endExclusive: cursor,
        kind: 'zero_fill_tile_block',
        rawCount,
        destinationTile,
      });
      continue;
    }
    const sourceWordOffset = cursor;
    const sourceWord = readWordLE(rom, cursor);
    cursor += 2;
    const source = dynamicSourceWordToSpan(sourceWord, count);
    records.push({
      opcodeOffset,
      endExclusive: cursor,
      kind: 'source_tile_record',
      rawCount,
      count,
      destinationTile,
      sourceWordOffset,
      sourceWord,
      source,
    });
  }
  return records;
}

function buildDynamicFieldIndex(rom, dynamicCatalog) {
  const index = new Map();
  const seenStreamOffsets = new Set();
  for (const stream of dynamicCatalog.streams || []) {
    const startOffset = offsetOf(stream.streamRomOffset);
    if (!Number.isFinite(startOffset) || seenStreamOffsets.has(startOffset)) continue;
    seenStreamOffsets.add(startOffset);
    for (const record of parseDynamicStreamRecords(rom, startOffset)) {
      const base = {
        parserFamily: 'dynamic_tile_loader',
        loaderRegion: stream.targetRegion || null,
        loaderFormat: 'dynamic',
        streamRomOffset: hex(startOffset),
        streamZ80Address: stream.streamZ80Address || null,
        recordOffset: hex(record.opcodeOffset),
        recordKind: record.kind,
        source: record.source ? {
          bank: record.source.bank,
          blockIndex: hex(record.source.blockIndex, 3),
          romStart: record.source.romStart == null ? null : hex(record.source.romStart),
          romEndExclusive: record.source.romEndExclusive == null ? null : hex(record.source.romEndExclusive),
        } : null,
      };
      const offsets = [[record.opcodeOffset, 'opcode_record_cross_word']];
      if (record.destinationTile != null) offsets.push([record.opcodeOffset + 1, 'destination_tile_source_low_cross_word']);
      if (record.kind === 'source_tile_record') {
        offsets.push([record.sourceWordOffset, 'source_word_field']);
        offsets.push([record.sourceWordOffset + 1, 'source_high_next_record_cross_word']);
      }
      for (const [offset, role] of offsets) {
        if (!index.has(offset)) index.set(offset, []);
        index.get(offset).push({ ...base, role });
      }
    }
  }
  return index;
}

function resolutionKindForContext(context, tile) {
  if (!context) return 'loader_like_region_unparsed_word_hit';
  if (context.role === 'source_word_field') {
    if (sourceRangeCoversTile(context.source, tile.tileOffset)) return 'parsed_source_field_already_covers_target';
    const parsedWord = sourceWordFromSource(context.source);
    if (parsedWord === tile.sourceWord) return 'parsed_source_field_same_start_but_not_covered';
    return 'parsed_source_field_for_different_source';
  }
  if (context.parserFamily === 'dynamic_tile_loader') return 'dynamic_loader_record_non_source_word_overlap';
  return 'static_loader_record_non_source_word_overlap';
}

function confidenceForResolution(kind) {
  if (kind === 'parsed_source_field_already_covers_target') return 'high';
  if (kind === 'loader_like_region_unparsed_word_hit') return 'low';
  return 'medium_high';
}

function scanLoaderLikeOccurrences(rom, mapData, targetTiles) {
  const targetByWord = new Map(targetTiles.map(tile => [tile.sourceWord, tile]));
  const occurrences = [];
  for (let offset = 0; offset + 1 < rom.length; offset++) {
    const word = readWordLE(rom, offset);
    const tile = targetByWord.get(word);
    if (!tile) continue;
    const region = containingRegion(mapData, offset);
    if (!loaderLikeTypes.has(region?.type || '')) continue;
    occurrences.push({
      occurrenceOffset: offset,
      sourceRegion: region,
      tile,
    });
  }
  return occurrences;
}

function resolveOccurrences(occurrences, staticFieldIndex, dynamicFieldIndex) {
  return occurrences.map(item => {
    const staticContexts = staticFieldIndex.get(item.occurrenceOffset) || [];
    const dynamicContexts = dynamicFieldIndex.get(item.occurrenceOffset) || [];
    const contexts = [...staticContexts, ...dynamicContexts];
    const preferredContext = contexts.find(context => context.role === 'source_word_field')
      || contexts.find(context => context.loaderRegion?.id === item.sourceRegion.id)
      || contexts[0]
      || null;
    const resolutionKind = resolutionKindForContext(preferredContext, item.tile);
    return {
      occurrenceOffset: hex(item.occurrenceOffset),
      sourceRegion: compactRegion(item.sourceRegion),
      target: {
        tileOffset: hex(item.tile.tileOffset),
        tileEndExclusive: hex(item.tile.tileEndExclusive),
        targetRegion: item.tile.region,
        spanId: item.tile.spanId,
        sourceBank: item.tile.sourceBank,
        sourceBlockIndex: hex(item.tile.sourceBlockIndex, 3),
        encodedSourceWord: hex(item.tile.sourceWord, 4),
      },
      resolutionKind,
      confidence: confidenceForResolution(resolutionKind),
      contextCount: contexts.length,
      resolvedContext: preferredContext ? {
        parserFamily: preferredContext.parserFamily,
        role: preferredContext.role,
        loaderRegion: preferredContext.loaderRegion || null,
        loaderFormat: preferredContext.loaderFormat || null,
        loaderEntryId: preferredContext.loaderEntryId || null,
        entryIndex: preferredContext.entryIndex ?? null,
        entryOffset: preferredContext.entryOffset == null ? null : hex(preferredContext.entryOffset),
        entryKind: preferredContext.entryKind || null,
        streamRomOffset: preferredContext.streamRomOffset || null,
        recordOffset: preferredContext.recordOffset || null,
        recordKind: preferredContext.recordKind || null,
        parsedSource: preferredContext.source || null,
        parsedSourceCoversTarget: sourceRangeCoversTile(preferredContext.source, item.tile.tileOffset),
      } : null,
      evidence: [
        'The raw encoded source-word hit is inside a mapped loader-like region.',
        preferredContext
          ? `The hit resolves to ${preferredContext.role} in the parsed ${preferredContext.parserFamily} record layout.`
          : 'No parsed loader record field starts at this hit offset, so the hit remains an unparsed loader-like-region lead.',
        'No ROM bytes, decoded graphics, pixels, screenshots, or hashes are stored.',
      ],
    };
  });
}

function summarizeByTargetRegion(resolutions) {
  const groups = new Map();
  for (const resolution of resolutions) {
    const region = resolution.target.targetRegion;
    if (!groups.has(region.id)) {
      groups.set(region.id, {
        region,
        loaderLikeOccurrenceCount: 0,
        targetTileCount: 0,
        uniqueTargetTiles: new Set(),
        resolutionCounts: {},
        sourceRegionCounts: {},
        examples: [],
      });
    }
    const group = groups.get(region.id);
    group.loaderLikeOccurrenceCount++;
    group.uniqueTargetTiles.add(resolution.target.tileOffset);
    group.resolutionCounts[resolution.resolutionKind] = (group.resolutionCounts[resolution.resolutionKind] || 0) + 1;
    const sourceRegionId = resolution.sourceRegion?.id || 'unmapped';
    group.sourceRegionCounts[sourceRegionId] = (group.sourceRegionCounts[sourceRegionId] || 0) + 1;
    if (group.examples.length < 8) group.examples.push(resolution);
  }
  return [...groups.values()].map(group => ({
    ...group,
    targetTileCount: group.uniqueTargetTiles.size,
    uniqueTargetTiles: undefined,
  })).sort((a, b) => b.loaderLikeOccurrenceCount - a.loaderLikeOccurrenceCount || offsetOf(a.region.offset) - offsetOf(b.region.offset));
}

function buildCatalog(mapData, rom) {
  requireCatalog(mapData, sourceWordCatalogId);
  const shapeCatalog = requireCatalog(mapData, shapeCatalogId);
  const staticTileCatalog = requireCatalog(mapData, staticTileCatalogId);
  const vram998VariantCatalog = findCatalog(mapData, vram998VariantCatalogId);
  const dynamicTileCatalog = requireCatalog(mapData, dynamicTileCatalogId);
  const targetTiles = collectTargetTiles(shapeCatalog, rom);
  const loaderLikeOccurrences = scanLoaderLikeOccurrences(rom, mapData, targetTiles);
  const staticFieldIndex = buildStaticFieldIndex(staticTileCatalog, vram998VariantCatalog);
  const dynamicFieldIndex = buildDynamicFieldIndex(rom, dynamicTileCatalog);
  const resolutions = resolveOccurrences(loaderLikeOccurrences, staticFieldIndex, dynamicFieldIndex);
  const regions = summarizeByTargetRegion(resolutions);
  const summary = {
    sourceWordCatalogId,
    shapeCatalogId,
    staticTileCatalogId,
    vram998VariantCatalogId: vram998VariantCatalog ? vram998VariantCatalogId : null,
    dynamicTileCatalogId,
    targetNonblankTileCount: targetTiles.length,
    loaderLikeOccurrenceCount: resolutions.length,
    uniqueTargetTileWithLoaderLikeHitCount: new Set(resolutions.map(item => item.target.tileOffset)).size,
    uniqueTargetRegionWithLoaderLikeHitCount: regions.length,
    parsedSourceFieldAlreadyCoversTargetCount: resolutions.filter(item => item.resolutionKind === 'parsed_source_field_already_covers_target').length,
    parsedSourceFieldDifferentSourceCount: resolutions.filter(item => item.resolutionKind === 'parsed_source_field_for_different_source').length,
    parsedSourceFieldSameStartButNotCoveredCount: resolutions.filter(item => item.resolutionKind === 'parsed_source_field_same_start_but_not_covered').length,
    nonSourceFieldOverlapCount: resolutions.filter(item => item.resolutionKind.endsWith('_non_source_word_overlap')).length,
    unparsedLoaderLikeHitCount: resolutions.filter(item => item.resolutionKind === 'loader_like_region_unparsed_word_hit').length,
    resolutionCounts: countBy(resolutions, item => item.resolutionKind),
    parserFamilyCounts: countBy(resolutions, item => item.resolvedContext?.parserFamily || 'unparsed'),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    assetPolicy: 'Metadata only: offsets, source-word values, parsed field roles, loader region ids, counts, and evidence. No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are embedded.',
  };
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceWordCatalogId, shapeCatalogId, staticTileCatalogId, vram998VariantCatalog ? vram998VariantCatalogId : null, dynamicTileCatalogId].filter(Boolean),
    summary,
    regions,
    resolutions,
    evidence: [
      `${sourceWordCatalogId} identified encoded source-word hits inside mapped loader-like regions for remaining nonblank graphics-source gaps.`,
      'This audit resolves each hit against parsed static 8FB/998 loader records, fixed-stride 998 entrypoint variants when cataloged, and parsed dynamic tile-loader records.',
      'Only hits at source_word_field roles can become consumer evidence; cross-byte/non-source roles are retained as false-positive explanations.',
      'No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.',
    ],
    nextLeads: [
      'If parsed_source_field_already_covers_target is ever nonzero, repair combined graphics coverage to include that confirmed range.',
      'For non-source overlap hits, deprioritize loader-table searching and trace direct-copy/decompression paths instead.',
      'For unparsed loader-like hits, inspect the region boundary/parser before treating the word as source evidence.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  for (const group of catalog.regions) {
    const region = findRegionById(mapData, group.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.graphicsLoaderLikeWordHitResolverAudit = {
      catalogId,
      kind: 'loader_like_word_hit_resolution',
      confidence: group.resolutionCounts.parsed_source_field_already_covers_target ? 'high' : 'medium_high',
      sourceWordCatalogId,
      loaderLikeOccurrenceCount: group.loaderLikeOccurrenceCount,
      targetTileCount: group.targetTileCount,
      resolutionCounts: group.resolutionCounts,
      sourceRegionCounts: group.sourceRegionCounts,
      summary: group.resolutionCounts.parsed_source_field_already_covers_target
        ? 'At least one loader-like word hit resolves to a parsed source field that already covers the target tile.'
        : 'Loader-like word hits resolve to non-source fields or unresolved parser contexts; retained as leads, not coverage.',
      evidence: [
        `Derived from ${catalogId}; this resolves word hits against parsed loader record field roles.`,
        'No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      loaderLikeOccurrenceCount: group.loaderLikeOccurrenceCount,
      targetTileCount: group.targetTileCount,
      resolutionCounts: group.resolutionCounts,
    });
  }
  return annotatedRegions;
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : catalog.regions.map(group => ({
    id: group.region.id,
    offset: group.region.offset,
    name: group.region.name || '',
    loaderLikeOccurrenceCount: group.loaderLikeOccurrenceCount,
    targetTileCount: group.targetTileCount,
    resolutionCounts: group.resolutionCounts,
  }));

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_loader_like_word_hit_resolver_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      annotatedRegions,
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
    annotatedRegions,
    sampleResolutions: catalog.resolutions.slice(0, 12),
  }, null, 2));
}

main();
