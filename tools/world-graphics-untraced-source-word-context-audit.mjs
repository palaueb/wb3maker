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
const toolName = 'tools/world-graphics-untraced-source-word-context-audit.mjs';
const shapeCatalogId = 'world-graphics-combined-unreferenced-shape-catalog-2026-06-26';
const sourceWordCatalogId = 'world-graphics-untraced-source-word-catalog-2026-06-26';
const reconciliationCatalogId = 'world-graphics-remaining-lead-reconciliation-catalog-2026-06-26';
const catalogId = 'world-graphics-untraced-source-word-context-catalog-2026-06-26';
const reportId = 'graphics-untraced-source-word-context-audit-2026-06-26';
const tileSizeBytes = 32;
const loaderLikeTypes = new Set(['vram_loader_8fb', 'vram_loader_998', 'dynamic_tile_loader']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
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
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => value != null && value !== ''))].sort();
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

function tileIsBlank(rom, offset) {
  if (offset < 0 || offset + tileSizeBytes > rom.length) return false;
  for (let cursor = offset; cursor < offset + tileSizeBytes; cursor++) {
    if (rom[cursor] !== 0) return false;
  }
  return true;
}

function leadBySpan(reconciliationCatalog) {
  return new Map((reconciliationCatalog.entries || []).map(entry => [entry.spanId, entry]));
}

function collectTargetTiles(shapeCatalog, reconciliationCatalog, rom) {
  const leads = leadBySpan(reconciliationCatalog);
  const tiles = [];
  for (const span of shapeCatalog.spans || []) {
    if ((span.shapeStats?.nonblankTileCount || 0) <= 0) continue;
    const start = offsetOf(span.start);
    const tileCount = Math.floor((span.sizeBytes || 0) / tileSizeBytes);
    for (let index = 0; index < tileCount; index++) {
      const tileOffset = start + index * tileSizeBytes;
      if (tileIsBlank(rom, tileOffset)) continue;
      const source = sourceWordForOffset(tileOffset);
      const lead = leads.get(span.id) || null;
      tiles.push({
        id: `${span.id}_tile_${String(index).padStart(3, '0')}`,
        spanId: span.id,
        targetRegion: span.region,
        tileOffset,
        tileEndExclusive: tileOffset + tileSizeBytes,
        tileIndexInSpan: index,
        encodedSourceWord: source.word,
        sourceBank: source.bank,
        sourceBlockIndex: source.blockIndex,
        leadClassification: lead?.classification || null,
        leadPriorityScore: lead?.priorityScore || 0,
      });
    }
  }
  return tiles;
}

function contextClassForRegion(region) {
  const type = region?.type || 'unmapped';
  if (loaderLikeTypes.has(type)) return 'loader_like_already_parsed_elsewhere';
  if (type === 'gfx_tiles') return 'graphics_data_false_positive_likely';
  if (type === 'code') return 'code_bytes_or_immediates';
  if (type === 'music' || type === 'audio_driver_data') return 'audio_data_false_positive_likely';
  if (type === 'null') return 'padding_or_null';
  return 'mapped_data_or_table_context';
}

function actionPriorityForContext(contextClass) {
  if (contextClass === 'mapped_data_or_table_context') return 4;
  if (contextClass === 'code_bytes_or_immediates') return 3;
  if (contextClass === 'loader_like_already_parsed_elsewhere') return 2;
  if (contextClass === 'graphics_data_false_positive_likely') return 1;
  return 0;
}

function scanOccurrences(rom, mapData, targetByWord) {
  const occurrences = [];
  for (let offset = 0; offset + 1 < rom.length; offset++) {
    const word = rom[offset] | (rom[offset + 1] << 8);
    const targets = targetByWord.get(word);
    if (!targets) continue;
    const sourceRegion = containingRegion(mapData, offset);
    const contextClass = contextClassForRegion(sourceRegion);
    for (const target of targets) {
      occurrences.push({
        occurrenceOffset: offset,
        occurrenceOffsetHex: hex(offset),
        sourceRegion: compactRegion(sourceRegion),
        sourceRegionId: sourceRegion?.id || 'unmapped',
        sourceRegionType: sourceRegion?.type || 'unmapped',
        contextClass,
        targetTileId: target.id,
        targetSpanId: target.spanId,
        targetRegion: target.targetRegion,
        targetTileOffset: hex(target.tileOffset),
        encodedSourceWord: hex(word, 4),
        sourceBank: target.sourceBank,
        sourceBlockIndex: hex(target.sourceBlockIndex, 3),
        leadClassification: target.leadClassification,
        leadPriorityScore: target.leadPriorityScore,
      });
    }
  }
  return occurrences;
}

function groupOccurrencesBySourceRegion(occurrences) {
  const byRegion = new Map();
  for (const occurrence of occurrences) {
    const key = occurrence.sourceRegionId || 'unmapped';
    if (!byRegion.has(key)) {
      byRegion.set(key, {
        sourceRegion: occurrence.sourceRegion,
        sourceRegionId: key,
        sourceRegionType: occurrence.sourceRegionType,
        contextClass: occurrence.contextClass,
        occurrences: [],
      });
    }
    byRegion.get(key).occurrences.push(occurrence);
  }
  return [...byRegion.values()].map(group => {
    const targetTiles = uniqueSorted(group.occurrences.map(item => item.targetTileId));
    const targetSpans = uniqueSorted(group.occurrences.map(item => item.targetSpanId));
    const targetRegions = uniqueSorted(group.occurrences.map(item => item.targetRegion?.id));
    const priority = actionPriorityForContext(group.contextClass) * 1000
      + targetSpans.length * 50
      + targetTiles.length * 5
      + group.occurrences.length;
    return {
      sourceRegion: group.sourceRegion,
      sourceRegionId: group.sourceRegionId,
      sourceRegionType: group.sourceRegionType,
      contextClass: group.contextClass,
      occurrenceCount: group.occurrences.length,
      targetTileCount: targetTiles.length,
      targetSpanCount: targetSpans.length,
      targetRegionCount: targetRegions.length,
      targetSpanIds: targetSpans.slice(0, 32),
      targetRegionIds: targetRegions,
      encodedSourceWordCount: uniqueSorted(group.occurrences.map(item => item.encodedSourceWord)).length,
      leadClassificationCounts: countBy(group.occurrences, item => item.leadClassification?.kind),
      priorityScore: priority,
      occurrenceSamples: group.occurrences
        .sort((a, b) => offsetOf(a.occurrenceOffsetHex) - offsetOf(b.occurrenceOffsetHex))
        .slice(0, 24)
        .map(item => ({
          occurrenceOffset: item.occurrenceOffsetHex,
          encodedSourceWord: item.encodedSourceWord,
          targetSpanId: item.targetSpanId,
          targetTileOffset: item.targetTileOffset,
          targetRegion: item.targetRegion,
          contextClass: item.contextClass,
        })),
    };
  }).sort((a, b) => b.priorityScore - a.priorityScore || String(a.sourceRegion?.offset || '').localeCompare(String(b.sourceRegion?.offset || '')));
}

function groupOccurrencesByTargetRegion(occurrences) {
  const byRegion = new Map();
  for (const occurrence of occurrences) {
    const key = occurrence.targetRegion?.id || 'unknown';
    if (!byRegion.has(key)) {
      byRegion.set(key, {
        targetRegion: occurrence.targetRegion,
        occurrences: [],
      });
    }
    byRegion.get(key).occurrences.push(occurrence);
  }
  return [...byRegion.values()].map(group => ({
    targetRegion: group.targetRegion,
    occurrenceCount: group.occurrences.length,
    targetTileCount: uniqueSorted(group.occurrences.map(item => item.targetTileId)).length,
    targetSpanCount: uniqueSorted(group.occurrences.map(item => item.targetSpanId)).length,
    encodedSourceWordCount: uniqueSorted(group.occurrences.map(item => item.encodedSourceWord)).length,
    contextClassCounts: countBy(group.occurrences, item => item.contextClass),
    sourceRegionTypeCounts: countBy(group.occurrences, item => item.sourceRegionType),
    topSourceRegions: groupOccurrencesBySourceRegion(group.occurrences).slice(0, 12).map(source => ({
      sourceRegion: source.sourceRegion,
      contextClass: source.contextClass,
      occurrenceCount: source.occurrenceCount,
      targetTileCount: source.targetTileCount,
      targetSpanCount: source.targetSpanCount,
      priorityScore: source.priorityScore,
    })),
  })).sort((a, b) => b.occurrenceCount - a.occurrenceCount || String(a.targetRegion?.offset || '').localeCompare(String(b.targetRegion?.offset || '')));
}

function buildCatalog(rom, mapData) {
  const shapeCatalog = requireCatalog(mapData, shapeCatalogId);
  const sourceWordCatalog = requireCatalog(mapData, sourceWordCatalogId);
  const reconciliationCatalog = requireCatalog(mapData, reconciliationCatalogId);
  const targetTiles = collectTargetTiles(shapeCatalog, reconciliationCatalog, rom);
  const targetByWord = new Map();
  for (const tile of targetTiles) {
    if (!targetByWord.has(tile.encodedSourceWord)) targetByWord.set(tile.encodedSourceWord, []);
    targetByWord.get(tile.encodedSourceWord).push(tile);
  }
  const occurrences = scanOccurrences(rom, mapData, targetByWord);
  const sourceRegionContexts = groupOccurrencesBySourceRegion(occurrences);
  const targetRegionContexts = groupOccurrencesByTargetRegion(occurrences);
  const actionable = sourceRegionContexts.filter(group =>
    group.contextClass === 'mapped_data_or_table_context' || group.contextClass === 'code_bytes_or_immediates'
  );

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [shapeCatalog.id, sourceWordCatalog.id, reconciliationCatalog.id],
    assetPolicy: 'Metadata only: target tile offsets, encoded source-word values, occurrence offsets, containing region ids/types, counts, and evidence. No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are embedded.',
    scanSemantics: {
      sourceWordFormula: 'word = low block index byte | (((bank << 1) | blockIndex bit 8) << 8), using 32-byte SMS tile blocks.',
      purpose: 'Groups raw encoded source-word occurrences for untraced graphics spans by containing mapped region so likely direct-copy/decompression consumers can be inspected first.',
      caution: 'Raw two-byte occurrences outside parsed source fields are false-positive-prone; this catalog is lead prioritization, not confirmed source coverage.',
    },
    summary: {
      targetTileCount: targetTiles.length,
      targetSpanCount: uniqueSorted(targetTiles.map(tile => tile.spanId)).length,
      encodedSourceWordCount: targetByWord.size,
      rawOccurrenceCount: occurrences.length,
      sourceRegionContextCount: sourceRegionContexts.length,
      actionableSourceRegionContextCount: actionable.length,
      contextClassCounts: countBy(sourceRegionContexts, item => item.contextClass),
      occurrenceContextClassCounts: countBy(occurrences, item => item.contextClass),
      sourceRegionTypeCounts: countBy(occurrences, item => item.sourceRegionType),
      targetRegionCount: targetRegionContexts.length,
      sourceWordCatalogRawOccurrenceCount: sourceWordCatalog.summary?.rawOccurrenceCount || 0,
      sourceWordCatalogNonLoaderRawOccurrenceCount: sourceWordCatalog.summary?.nonLoaderRawOccurrenceCount || 0,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: target tile offsets, encoded source-word values, occurrence offsets, containing region ids/types, counts, and evidence. No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are embedded.',
    },
    sourceRegionContexts,
    targetRegionContexts,
    evidence: [
      `${shapeCatalogId} supplies the unreferenced nonblank graphics spans.`,
      `${sourceWordCatalogId} establishes the source-word encoding and raw occurrence strategy.`,
      `${reconciliationCatalogId} supplies lead classifications and priority scores for the same spans.`,
      'This catalog stores offsets/counts only and does not persist ROM bytes, decoded graphics, pixels, screenshots, or hashes.',
    ],
    nextLeads: [
      'Inspect the highest-priority mapped_data_or_table_context regions for direct VDP copy tables or decompression parameters.',
      'Treat graphics_data_false_positive_likely contexts as low priority unless a code routine is later found to read from that data as a pointer table.',
      'Promote a remaining graphics span to confirmed coverage only after a routine trace links a source-word occurrence to a real copy/decompression path.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  for (const region of mapData.regions || []) {
    if (region.analysis?.graphicsUntracedSourceWordContextAudit?.catalogId === catalogId) {
      delete region.analysis.graphicsUntracedSourceWordContextAudit;
    }
  }

  const annotatedRegions = [];
  for (const context of catalog.sourceRegionContexts.slice(0, 64)) {
    if (!context.sourceRegion?.id) continue;
    const region = findRegionById(mapData, context.sourceRegion.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.graphicsUntracedSourceWordContextAudit = {
      catalogId,
      kind: 'untraced_graphics_source_word_occurrence_context',
      confidence: context.contextClass === 'mapped_data_or_table_context' ? 'low_medium' : 'low',
      summary: 'Region contains raw encoded source-word occurrences for currently untraced graphics tiles; this is lead evidence, not confirmed source coverage.',
      contextClass: context.contextClass,
      occurrenceCount: context.occurrenceCount,
      targetTileCount: context.targetTileCount,
      targetSpanCount: context.targetSpanCount,
      targetRegionIds: context.targetRegionIds,
      encodedSourceWordCount: context.encodedSourceWordCount,
      priorityScore: context.priorityScore,
      occurrenceSamples: context.occurrenceSamples,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      region: compactRegion(region),
      contextClass: context.contextClass,
      occurrenceCount: context.occurrenceCount,
      targetSpanCount: context.targetSpanCount,
      priorityScore: context.priorityScore,
    });
  }

  for (const context of catalog.targetRegionContexts) {
    if (!context.targetRegion?.id) continue;
    const region = findRegionById(mapData, context.targetRegion.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    const existing = region.analysis.graphicsUntracedSourceWordContextAudit || {};
    region.analysis.graphicsUntracedSourceWordContextAudit = {
      ...existing,
      catalogId,
      kind: existing.kind || 'untraced_graphics_target_context',
      confidence: existing.confidence || 'low',
      summary: existing.summary || 'Target graphics region has untraced tiles whose encoded source-word occurrences are grouped by containing ROM context.',
      targetContext: {
        occurrenceCount: context.occurrenceCount,
        targetTileCount: context.targetTileCount,
        targetSpanCount: context.targetSpanCount,
        encodedSourceWordCount: context.encodedSourceWordCount,
        contextClassCounts: context.contextClassCounts,
        sourceRegionTypeCounts: context.sourceRegionTypeCounts,
        topSourceRegions: context.topSourceRegions,
      },
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
  }

  mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
  mapData.graphicsCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'graphics_untraced_source_word_context_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedSourceRegions: annotatedRegions.length,
      annotatedTargetRegions: catalog.targetRegionContexts.length,
    },
    topSourceRegionContexts: catalog.sourceRegionContexts.slice(0, 24),
    targetRegionContexts: catalog.targetRegionContexts,
    scanSemantics: catalog.scanSemantics,
    annotatedRegions,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
  return { annotatedRegions };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  let changes = { annotatedRegions: [] };
  if (apply) {
    changes = applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: changes.annotatedRegions.length,
    topSourceRegionContexts: catalog.sourceRegionContexts.slice(0, 12).map(context => ({
      sourceRegion: context.sourceRegion,
      contextClass: context.contextClass,
      occurrenceCount: context.occurrenceCount,
      targetSpanCount: context.targetSpanCount,
      priorityScore: context.priorityScore,
    })),
  }, null, 2));
}

main();
