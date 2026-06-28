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
const now = '2026-06-25T00:00:00Z';
const toolName = 'tools/world-graphics-sparse-source-gap-audit.mjs';
const catalogId = 'world-graphics-sparse-source-gap-catalog-2026-06-25';
const reportId = 'graphics-sparse-source-gap-audit-2026-06-25';

const target = {
  regionId: 'r2649',
  start: 0x2E0A0,
  endExclusive: 0x2E0C0,
  bank: 11,
  blockIndex: 0x105,
};

const sourceCatalogs = [
  'world-graphics-unresolved-source-probe-catalog-2026-06-25',
  'world-graphics-incbin-split-layout-catalog-2026-06-25',
  'world-tile-source-catalog-2026-06-24',
  'world-dynamic-tile-source-table-catalog-2026-06-25',
];

function hex(value, pad = 5) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function regionStart(region) {
  return parseHex(region.offset) ?? 0;
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

function findRegion(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function containingRegion(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
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

function sourceWordFor8fb(bank, blockIndex) {
  const lo = blockIndex & 0xFF;
  const hi = (bank << 1) | ((blockIndex >> 8) & 0x01);
  return lo | (hi << 8);
}

function sourceWordForOffset(offset) {
  const bank = Math.floor(offset / 0x4000);
  const blockIndex = Math.floor((offset % 0x4000) / 32);
  return sourceWordFor8fb(bank, blockIndex);
}

function cleanCode(line) {
  return String(line || '').split(';')[0].trim();
}

function directAsmReferences(asmText) {
  const label = `_DATA_${target.start.toString(16).toUpperCase()}_`;
  const fullHex = target.start.toString(16).toUpperCase();
  const bankOffset = (target.start % 0x4000).toString(16).toUpperCase().padStart(4, '0');
  const sourceWord = sourceWordFor8fb(target.bank, target.blockIndex).toString(16).toUpperCase().padStart(4, '0');
  const patterns = [
    { kind: 'direct_label', pattern: new RegExp(`\\b${label}\\b`, 'i') },
    { kind: 'rom_offset_literal', pattern: new RegExp(`\\b${fullHex}\\b`, 'i') },
    { kind: 'bank_window_literal', pattern: new RegExp(`\\$${bankOffset}\\b`, 'i') },
    { kind: 'encoded_source_word_literal', pattern: new RegExp(`\\$${sourceWord}\\b`, 'i') },
  ];
  const refs = [];
  const lines = asmText.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const code = cleanCode(line);
    if (!code) continue;
    const match = patterns.find(item => item.pattern.test(code));
    if (!match) continue;
    refs.push({
      line: index + 1,
      kind: match.kind,
      context: code.slice(0, 160),
    });
  }
  return refs;
}

function sourceRangeOfEntry(entry) {
  const source = entry.source || {};
  const start = parseHex(source.romStart);
  const endExclusive = parseHex(source.romEndExclusive);
  if (start == null || endExclusive == null) return null;
  return { start, endExclusive };
}

function tileLoaderRefs(tileCatalog) {
  const refs = [];
  for (const loader of tileCatalog.loaderEntries || []) {
    for (const entry of loader.entries || []) {
      const range = sourceRangeOfEntry(entry);
      if (!range) continue;
      if (range.start < target.endExclusive && range.endExclusive > target.start) {
        refs.push({
          loaderRegion: loader.loaderRegion,
          loaderFormat: loader.format,
          entryIndex: entry.entryIndex,
          entryOffset: entry.entryOffset,
          vramTileRange: entry.vramTileRange || null,
          sourceRange: {
            start: hex(range.start),
            endExclusive: hex(range.endExclusive),
            sizeBytes: range.endExclusive - range.start,
          },
        });
      }
    }
  }
  return refs;
}

function allSourceRefs(tileCatalog, containingStart, containingEndExclusive) {
  const refs = [];
  for (const loader of tileCatalog.loaderEntries || []) {
    for (const entry of loader.entries || []) {
      const range = sourceRangeOfEntry(entry);
      if (!range) continue;
      if (range.start < containingStart || range.endExclusive > containingEndExclusive) continue;
      refs.push({
        loaderRegion: loader.loaderRegion,
        loaderFormat: loader.format,
        entryIndex: entry.entryIndex,
        entryOffset: entry.entryOffset,
        vramTileRange: entry.vramTileRange || null,
        sourceRange: {
          start: hex(range.start),
          endExclusive: hex(range.endExclusive),
          sizeBytes: range.endExclusive - range.start,
          bank: Math.floor(range.start / 0x4000),
          blockIndex: Math.floor((range.start % 0x4000) / 32),
          sourceWord: hex(sourceWordForOffset(range.start), 4),
        },
      });
    }
  }
  return refs.sort((a, b) => parseHex(a.sourceRange.start) - parseHex(b.sourceRange.start)
    || String(a.loaderRegion?.id || '').localeCompare(String(b.loaderRegion?.id || '')));
}

function sparseNeighborRefs(tileCatalog) {
  const refs = allSourceRefs(tileCatalog, 0x2C000, 0x30000)
    .filter(ref => ref.loaderRegion?.id === 'r0005');
  const previous = [...refs].reverse().find(ref => parseHex(ref.sourceRange.endExclusive) <= target.start) || null;
  const next = refs.find(ref => parseHex(ref.sourceRange.start) >= target.endExclusive) || null;
  const sameLoaderRefs = refs
    .filter(ref => ref.sourceRange.bank === target.bank)
    .map(ref => ({
      entryIndex: ref.entryIndex,
      entryOffset: ref.entryOffset,
      sourceRange: ref.sourceRange,
      vramTileRange: ref.vramTileRange,
    }));
  return {
    loaderRegion: refs[0]?.loaderRegion || null,
    previous,
    next,
    previousDistanceBytes: previous ? target.start - parseHex(previous.sourceRange.endExclusive) : null,
    nextDistanceBytes: next ? parseHex(next.sourceRange.start) - target.endExclusive : null,
    sameLoaderBank11Refs: sameLoaderRefs,
  };
}

function encodedSourceWordOccurrences(rom, mapData, sourceWord) {
  const lo = sourceWord & 0xFF;
  const hi = (sourceWord >> 8) & 0xFF;
  const occurrences = [];
  for (let offset = 0; offset + 1 < rom.length; offset++) {
    if (rom[offset] !== lo || rom[offset + 1] !== hi) continue;
    const region = containingRegion(mapData, offset);
    const accepted = region?.type === 'vram_loader_8fb' || region?.type === 'vram_loader_998' || region?.type === 'dynamic_tile_loader';
    occurrences.push({
      offset: hex(offset),
      sourceRegion: compactRegion(region),
      classification: accepted ? 'loader_like_region_word_hit' : 'non_loader_region_word_shape_hit',
      reason: accepted
        ? 'encoded source word occurs in a mapped loader-like region and would require manual follow-up'
        : 'encoded source word occurs in code or asset bytes, not in a mapped tile loader stream',
    });
  }
  return occurrences;
}

function dynamicSourceSummary(dynamicCatalog) {
  const sourceBanks = dynamicCatalog?.summary?.sourceBanks || [];
  return {
    catalogId: dynamicCatalog?.id || '',
    present: Boolean(dynamicCatalog),
    sourceBanks,
    sourceBank11Present: sourceBanks.includes(target.bank),
    sourceRecordCount: Number(dynamicCatalog?.summary?.sourceRecordCount || 0),
    evidence: sourceBanks.includes(target.bank)
      ? 'Dynamic tile source catalog includes bank 11; inspect stream records before excluding this target.'
      : 'Dynamic tile source catalog uses no bank-11 source records, so it cannot currently consume r2649.',
  };
}

function buildCatalog(mapData, rom, asmText) {
  const region = findRegion(mapData, target.regionId);
  if (!region) throw new Error(`Missing region ${target.regionId}`);
  const tileCatalog = requireCatalog(mapData, 'world-tile-source-catalog-2026-06-24');
  const unresolvedCatalog = requireCatalog(mapData, 'world-graphics-unresolved-source-probe-catalog-2026-06-25');
  const splitCatalog = requireCatalog(mapData, 'world-graphics-incbin-split-layout-catalog-2026-06-25');
  const dynamicCatalog = findCatalog(mapData, 'world-dynamic-tile-source-table-catalog-2026-06-25');
  const sourceWord = sourceWordFor8fb(target.bank, target.blockIndex);
  const exactLoaderRefs = tileLoaderRefs(tileCatalog);
  const neighbors = sparseNeighborRefs(tileCatalog);
  const asmRefs = directAsmReferences(asmText);
  const wordOccurrences = encodedSourceWordOccurrences(rom, mapData, sourceWord);
  const loaderWordOccurrences = wordOccurrences.filter(item => item.classification === 'loader_like_region_word_hit');
  const targetProbe = (unresolvedCatalog.entries || []).find(entry => entry.region?.id === target.regionId) || null;
  const splitSegment = (splitCatalog.layouts || [])
    .flatMap(layout => (layout.segments || []).map(segment => ({ layout, segment })))
    .find(item => item.segment.region?.id === target.regionId) || null;
  const dynamicSummary = dynamicSourceSummary(dynamicCatalog);
  const status = exactLoaderRefs.length === 0 && loaderWordOccurrences.length === 0 && !dynamicSummary.sourceBank11Present
    ? 'unresolved_sparse_main_screen_source_gap_no_current_consumer'
    : 'source_gap_has_consumer_leads';

  const evidence = [
    'r2649 is exactly one SMS tile block at bank 11 block 0x105 (ROM 0x2E0A0-0x2E0BF).',
    'The parsed tile-source catalog has zero loader entries whose source range overlaps r2649.',
    'The r0005 main-screen 8FB loader references neighboring bank-11 source blocks, but its parsed sequence skips block 0x105.',
    'The target source word occurs only as word-shaped data outside mapped loader streams in the current ROM map.',
    dynamicSummary.evidence,
    'This audit stores offsets, block indexes, source-word metadata, region ids, and evidence only; no tile bytes or rendered pixels are embedded.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: offsets, source block indexes, encoded source-word values, catalog references, loader entry ids, counts, and evidence. No ROM bytes, decoded graphics, rendered pixels, screenshots, audio, or text payloads are embedded.',
    summary: {
      targetRegionId: target.regionId,
      targetOffset: hex(target.start),
      targetEndExclusive: hex(target.endExclusive),
      targetSize: target.endExclusive - target.start,
      targetBank: target.bank,
      targetBlockIndex: hex(target.blockIndex, 3),
      encodedSourceWord: hex(sourceWord, 4),
      exactParsedTileLoaderRefCount: exactLoaderRefs.length,
      dynamicSourceBank11Present: dynamicSummary.sourceBank11Present,
      directAsmReferenceCount: asmRefs.length,
      encodedSourceWordOccurrenceCount: wordOccurrences.length,
      loaderLikeEncodedSourceWordOccurrenceCount: loaderWordOccurrences.length,
      status,
      persistedRomByteCount: 0,
      persistedTileByteCount: 0,
      persistedPixelCount: 0,
    },
    region: compactRegion(region),
    priorUnresolvedProbe: targetProbe ? {
      catalogId: unresolvedCatalog.id,
      status: targetProbe.status,
      confidence: targetProbe.confidence,
      knownTileLoaderRefCount: targetProbe.knownTileLoaderRefCount,
      directAsmReferenceCount: targetProbe.directAsmReferenceCount,
    } : null,
    splitSegment: splitSegment ? {
      catalogId: splitCatalog.id,
      incbinSpanId: splitSegment.layout.incbinSpanId,
      role: splitSegment.segment.role,
      confidence: splitSegment.segment.confidence,
    } : null,
    exactParsedTileLoaderRefs: exactLoaderRefs,
    mainScreenSparseContext: neighbors,
    dynamicSourceSummary: dynamicSummary,
    directAsmReferences: asmRefs,
    encodedSourceWordOccurrences: wordOccurrences,
    encodedSourceWordOccurrenceCountsByRegionType: countBy(wordOccurrences, item => item.sourceRegion?.type || 'unmapped'),
    evidence,
    nextLeads: [
      'Trace direct VDP upload routines for bank-11 block 0x105 in case it is consumed outside _LABEL_8FB_/_LABEL_998_ and dynamic tile streams.',
      'Inspect the r0005 main-screen sparse bank-11 block pattern in the analyzer to determine whether block 0x105 is intentionally unused or reserved for an unmodeled overlay.',
      'Cross-check all graphics source gaps with source-word occurrence classifications so non-loader word-shaped hits do not become false consumer evidence.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegion(mapData, target.regionId);
  if (!region) return [];
  region.analysis = region.analysis || {};
  region.analysis.graphicsSparseSourceGapAudit = {
    catalogId,
    kind: 'graphics_sparse_source_gap',
    status: catalog.summary.status,
    confidence: catalog.summary.status === 'unresolved_sparse_main_screen_source_gap_no_current_consumer' ? 'medium' : 'low',
    targetBank: target.bank,
    targetBlockIndex: hex(target.blockIndex, 3),
    encodedSourceWord: catalog.summary.encodedSourceWord,
    exactParsedTileLoaderRefCount: catalog.summary.exactParsedTileLoaderRefCount,
    dynamicSourceBank11Present: catalog.summary.dynamicSourceBank11Present,
    directAsmReferenceCount: catalog.summary.directAsmReferenceCount,
    encodedSourceWordOccurrenceCount: catalog.summary.encodedSourceWordOccurrenceCount,
    loaderLikeEncodedSourceWordOccurrenceCount: catalog.summary.loaderLikeEncodedSourceWordOccurrenceCount,
    summary: 'r2649 is a one-tile bank-11 source block skipped by the parsed r0005 sparse main-screen loader sequence; no current loader or dynamic source consumer is confirmed.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  if (region.analysis.graphicsUnresolvedSourceProbeAudit) {
    region.analysis.graphicsUnresolvedSourceProbeAudit.refinedBySparseSourceGapAudit = catalogId;
    region.analysis.graphicsUnresolvedSourceProbeAudit.sparseGapStatus = catalog.summary.status;
  }
  return [{
    region: compactRegion(region),
    status: catalog.summary.status,
    encodedSourceWord: catalog.summary.encodedSourceWord,
  }];
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, rom, asmText);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [];

  if (apply) {
    mapData.gfxCatalogs = (mapData.gfxCatalogs || []).filter(item => item.id !== catalogId);
    mapData.gfxCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_sparse_source_gap_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
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
      annotatedRegions: annotatedRegions.length,
    },
    mainScreenSparseContext: {
      loaderRegion: catalog.mainScreenSparseContext.loaderRegion,
      previousDistanceBytes: catalog.mainScreenSparseContext.previousDistanceBytes,
      nextDistanceBytes: catalog.mainScreenSparseContext.nextDistanceBytes,
      sameLoaderBank11RefCount: catalog.mainScreenSparseContext.sameLoaderBank11Refs.length,
      sameLoaderBank11Refs: catalog.mainScreenSparseContext.sameLoaderBank11Refs,
    },
    encodedSourceWordOccurrenceCountsByRegionType: catalog.encodedSourceWordOccurrenceCountsByRegionType,
  }, null, 2));
}

main();
