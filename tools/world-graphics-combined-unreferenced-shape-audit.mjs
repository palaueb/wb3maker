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
const toolName = 'tools/world-graphics-combined-unreferenced-shape-audit.mjs';
const sourceCatalogId = 'world-graphics-combined-source-coverage-catalog-2026-06-26';
const catalogId = 'world-graphics-combined-unreferenced-shape-catalog-2026-06-26';
const reportId = 'graphics-combined-unreferenced-shape-audit-2026-06-26';
const tileSizeBytes = 32;

function hex(value, pad = 5) {
  return `0x${value.toString(16).toUpperCase().padStart(pad, '0')}`;
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

function regionRef(region) {
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
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

function bytesEqual(rom, aStart, bStart, length) {
  if (aStart < 0 || bStart < 0 || aStart + length > rom.length || bStart + length > rom.length) return false;
  for (let index = 0; index < length; index++) {
    if (rom[aStart + index] !== rom[bStart + index]) return false;
  }
  return true;
}

function tileShape(rom, offset, region) {
  const end = offset + tileSizeBytes;
  if (offset < 0 || end > rom.length) {
    return {
      valid: false,
      blank: false,
      uniform: false,
      equalsPreviousTileInRegion: false,
      equalsNextTileInRegion: false,
    };
  }
  const first = rom[offset];
  let blank = first === 0;
  let uniform = true;
  for (let cursor = offset; cursor < end; cursor++) {
    if (rom[cursor] !== 0) blank = false;
    if (rom[cursor] !== first) uniform = false;
  }
  const previousOffset = offset - tileSizeBytes;
  const nextOffset = offset + tileSizeBytes;
  return {
    valid: true,
    blank,
    uniform,
    equalsPreviousTileInRegion: previousOffset >= regionStart(region) && bytesEqual(rom, offset, previousOffset, tileSizeBytes),
    equalsNextTileInRegion: nextOffset + tileSizeBytes <= regionEnd(region) && bytesEqual(rom, offset, nextOffset, tileSizeBytes),
  };
}

function classifySpan(stats) {
  if (stats.invalidTileCount > 0) {
    return {
      kind: 'invalid_or_out_of_bounds_probe',
      confidence: 'low',
      reason: 'At least one tile in this span could not be probed safely.',
    };
  }
  if (stats.blankTileCount === stats.tileCount) {
    return {
      kind: 'all_blank_padding_candidate',
      confidence: 'medium_high',
      reason: 'Every tile in the unreferenced span is blank in the local ROM; still not marked unused without consumer evidence.',
    };
  }
  if (stats.nonblankTileCount > 0 && stats.adjacentDuplicateTileCount === stats.tileCount) {
    return {
      kind: 'adjacent_duplicate_candidate',
      confidence: 'medium',
      reason: 'Every tile in the span matches an adjacent tile in the same graphics region.',
    };
  }
  if (stats.blankTileCount > 0) {
    return {
      kind: 'mixed_blank_and_nonblank_untraced_source',
      confidence: 'medium',
      reason: 'The span contains both blank and nonblank tiles; nonblank tiles still need loader/direct-copy tracing.',
    };
  }
  if (stats.uniformTileCount === stats.tileCount) {
    return {
      kind: 'all_uniform_nonblank_untraced_source',
      confidence: 'medium',
      reason: 'Every tile is uniform but not blank; this may be filler or a special mask/source tile and needs consumer tracing.',
    };
  }
  return {
    kind: 'nonblank_untraced_source',
    confidence: 'medium',
    reason: 'The span contains nonblank, non-uniform tile data with no confirmed source family in the combined coverage catalog.',
  };
}

function probeSpan(rom, entry, span, index) {
  const region = entry.region;
  const start = offsetOf(span.start);
  const endExclusive = offsetOf(span.endExclusive);
  const sizeBytes = endExclusive - start;
  const tileAligned = start % tileSizeBytes === 0 && endExclusive % tileSizeBytes === 0;
  const tileCount = tileAligned ? sizeBytes / tileSizeBytes : Math.ceil(sizeBytes / tileSizeBytes);
  const stats = {
    tileCount,
    validTileCount: 0,
    invalidTileCount: 0,
    blankTileCount: 0,
    nonblankTileCount: 0,
    uniformTileCount: 0,
    adjacentDuplicateTileCount: 0,
    equalsPreviousTileCount: 0,
    equalsNextTileCount: 0,
  };

  for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
    const tileOffset = start + tileIndex * tileSizeBytes;
    const shape = tileShape(rom, tileOffset, region);
    if (!shape.valid || tileOffset + tileSizeBytes > endExclusive) {
      stats.invalidTileCount++;
      continue;
    }
    stats.validTileCount++;
    if (shape.blank) stats.blankTileCount++;
    else stats.nonblankTileCount++;
    if (shape.uniform) stats.uniformTileCount++;
    if (shape.equalsPreviousTileInRegion) stats.equalsPreviousTileCount++;
    if (shape.equalsNextTileInRegion) stats.equalsNextTileCount++;
    if (shape.equalsPreviousTileInRegion || shape.equalsNextTileInRegion) stats.adjacentDuplicateTileCount++;
  }

  const classification = classifySpan(stats);
  return {
    id: `${region.id}_combined_unreferenced_shape_${String(index).padStart(2, '0')}`,
    region,
    start: span.start,
    endExclusive: span.endExclusive,
    sizeBytes,
    tileCount,
    tileAligned,
    shapeStats: stats,
    classification,
    persistedByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    evidence: [
      `Source catalog ${sourceCatalogId} leaves this graphics span without confirmed source coverage.`,
      'The local ROM was probed only for tile-shape counts; no ROM bytes, hashes, decoded graphics, pixels, or screenshots are stored.',
    ],
  };
}

function groupByRegion(spans) {
  const groups = new Map();
  for (const span of spans) {
    if (!groups.has(span.region.id)) {
      groups.set(span.region.id, {
        region: span.region,
        spanCount: 0,
        tileCount: 0,
        sizeBytes: 0,
        blankTileCount: 0,
        nonblankTileCount: 0,
        uniformTileCount: 0,
        adjacentDuplicateTileCount: 0,
        classificationCounts: {},
        largestSpan: null,
      });
    }
    const group = groups.get(span.region.id);
    group.spanCount++;
    group.tileCount += span.shapeStats.tileCount;
    group.sizeBytes += span.sizeBytes;
    group.blankTileCount += span.shapeStats.blankTileCount;
    group.nonblankTileCount += span.shapeStats.nonblankTileCount;
    group.uniformTileCount += span.shapeStats.uniformTileCount;
    group.adjacentDuplicateTileCount += span.shapeStats.adjacentDuplicateTileCount;
    group.classificationCounts[span.classification.kind] = (group.classificationCounts[span.classification.kind] || 0) + 1;
    if (!group.largestSpan || span.sizeBytes > group.largestSpan.sizeBytes) {
      group.largestSpan = {
        id: span.id,
        start: span.start,
        endExclusive: span.endExclusive,
        sizeBytes: span.sizeBytes,
        tileCount: span.tileCount,
        classification: span.classification,
      };
    }
  }
  return [...groups.values()].sort((a, b) => b.sizeBytes - a.sizeBytes || offsetOf(a.region.offset) - offsetOf(b.region.offset));
}

function buildCatalog(mapData, rom) {
  const sourceCatalog = requireCatalog(mapData, sourceCatalogId);
  const spans = [];
  for (const entry of sourceCatalog.entries || []) {
    for (const [index, span] of (entry.unreferencedSpans || []).entries()) {
      spans.push(probeSpan(rom, entry, span, index));
    }
  }
  spans.sort((a, b) => b.sizeBytes - a.sizeBytes || offsetOf(a.start) - offsetOf(b.start));
  const regions = groupByRegion(spans);

  const summary = spans.reduce((acc, span) => {
    acc.unreferencedSpanCount++;
    acc.unreferencedBytes += span.sizeBytes;
    acc.unreferencedTileCount += span.shapeStats.tileCount;
    acc.blankTileCount += span.shapeStats.blankTileCount;
    acc.nonblankTileCount += span.shapeStats.nonblankTileCount;
    acc.uniformTileCount += span.shapeStats.uniformTileCount;
    acc.adjacentDuplicateTileCount += span.shapeStats.adjacentDuplicateTileCount;
    acc.classificationCounts[span.classification.kind] = (acc.classificationCounts[span.classification.kind] || 0) + 1;
    return acc;
  }, {
    sourceCatalogId,
    unreferencedSpanCount: 0,
    unreferencedBytes: 0,
    unreferencedTileCount: 0,
    regionCount: regions.length,
    blankTileCount: 0,
    nonblankTileCount: 0,
    uniformTileCount: 0,
    adjacentDuplicateTileCount: 0,
    classificationCounts: {},
    persistedByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    assetPolicy: 'Metadata only: graphics offsets, tile counts, blank/uniform/adjacent-duplicate counts, and classifications. No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are embedded.',
  });
  summary.blankTilePercent = Number((summary.blankTileCount / Math.max(1, summary.unreferencedTileCount) * 100).toFixed(2));
  summary.nonblankTilePercent = Number((summary.nonblankTileCount / Math.max(1, summary.unreferencedTileCount) * 100).toFixed(2));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceCatalogId],
    summary,
    regions,
    spans,
    priorityNonblankSpans: spans
      .filter(span => span.shapeStats.nonblankTileCount > 0)
      .slice(0, 16)
      .map(span => ({
        id: span.id,
        region: span.region,
        start: span.start,
        endExclusive: span.endExclusive,
        sizeBytes: span.sizeBytes,
        tileCount: span.tileCount,
        nonblankTileCount: span.shapeStats.nonblankTileCount,
        classification: span.classification,
      })),
    evidence: [
      `${sourceCatalogId} supplies the current combined unreferenced graphics spans after static, dynamic entity, and status source ranges are merged.`,
      'The local ROM was consulted only to classify remaining tiles by shape; this catalog deliberately stores no bytes or hashes.',
    ],
    nextLeads: [
      'Prioritize large nonblank_untraced_source spans for direct VDP copy, decompression, or scene-specific loader tracing.',
      'Treat all_blank_padding_candidate spans as lower priority until a consumer or padding convention is confirmed.',
      'Re-run this probe after adding new source families to confirm whether unreferenced nonblank tile counts shrink.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  for (const group of catalog.regions) {
    const region = (mapData.regions || []).find(item => item.id === group.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.graphicsCombinedUnreferencedShapeAudit = {
      catalogId,
      kind: 'combined_unreferenced_graphics_shape_probe',
      confidence: 'medium',
      sourceCatalogId,
      spanCount: group.spanCount,
      sizeBytes: group.sizeBytes,
      tileCount: group.tileCount,
      blankTileCount: group.blankTileCount,
      nonblankTileCount: group.nonblankTileCount,
      uniformTileCount: group.uniformTileCount,
      adjacentDuplicateTileCount: group.adjacentDuplicateTileCount,
      classificationCounts: group.classificationCounts,
      largestSpan: group.largestSpan,
      persistedByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      evidence: [
        `Derived from ${sourceCatalogId}; local ROM probing persisted only aggregate shape counts.`,
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
      nonblankTileCount: group.nonblankTileCount,
      classificationCounts: group.classificationCounts,
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
    spanCount: group.spanCount,
    tileCount: group.tileCount,
    nonblankTileCount: group.nonblankTileCount,
    classificationCounts: group.classificationCounts,
  }));

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_combined_unreferenced_shape_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      annotatedRegions,
      priorityNonblankSpans: catalog.priorityNonblankSpans,
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
    priorityNonblankSpans: catalog.priorityNonblankSpans,
  }, null, 2));
}

main();
