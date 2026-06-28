#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-graphics-coverage-catalog-2026-06-24';
const reportId = 'graphics-coverage-audit-2026-06-24';
const tileSizeBytes = 32;

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function regionBounds(region) {
  const start = parseInt(region.offset, 16);
  return { start, end: start + (region.size || 0) };
}

function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(interval => interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) {
      merged.push({ ...interval });
    } else {
      last.end = Math.max(last.end, interval.end);
    }
  }
  return merged;
}

function intervalBytes(intervals) {
  return intervals.reduce((sum, interval) => sum + Math.max(0, interval.end - interval.start), 0);
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

function latestTileSourceCatalog(mapData) {
  const catalogs = mapData.tileSourceCatalogs || [];
  return catalogs.find(catalog => catalog.id === 'world-tile-source-catalog-2026-06-24') || catalogs[catalogs.length - 1] || null;
}

function sourceRefsForRegion(region, tileCatalog) {
  const bounds = regionBounds(region);
  const refs = [];
  for (const loader of tileCatalog?.loaderEntries || []) {
    for (const range of loader.sourceRanges || []) {
      const rangeBounds = {
        start: parseInt(range.romStart, 16),
        end: parseInt(range.romEndExclusive, 16),
      };
      if (!rangesOverlap(bounds, rangeBounds)) continue;
      const start = Math.max(bounds.start, rangeBounds.start);
      const end = Math.min(bounds.end, rangeBounds.end);
      refs.push({
        loaderRegion: loader.loaderRegion,
        loaderEntryId: loader.id,
        loaderFormat: loader.format,
        sourceRange: {
          start: hex(start),
          endExclusive: hex(end),
          sizeBytes: end - start,
          tileCount: Number(((end - start) / tileSizeBytes).toFixed(4)),
        },
      });
    }
  }
  return refs;
}

function unreferencedSpans(bounds, referencedIntervals) {
  const spans = [];
  let cursor = bounds.start;
  for (const interval of referencedIntervals) {
    if (interval.start > cursor) spans.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < bounds.end) spans.push({ start: cursor, end: bounds.end });
  return spans.map(span => ({
    start: hex(span.start),
    endExclusive: hex(span.end),
    sizeBytes: span.end - span.start,
    tileCount: Number(((span.end - span.start) / tileSizeBytes).toFixed(4)),
  }));
}

function buildCatalog(mapData) {
  const tileCatalog = latestTileSourceCatalog(mapData);
  const regions = (mapData.regions || []).filter(region => region.type === 'gfx_tiles');
  const entries = regions.map(region => {
    const bounds = regionBounds(region);
    const sourceRefs = sourceRefsForRegion(region, tileCatalog);
    const intervals = mergeIntervals(sourceRefs.map(ref => ({
      start: parseInt(ref.sourceRange.start, 16),
      end: parseInt(ref.sourceRange.endExclusive, 16),
    })));
    const uniqueReferencedBytes = intervalBytes(intervals);
    const duplicateReferencedBytes = sourceRefs.reduce((sum, ref) => sum + ref.sourceRange.sizeBytes, 0);
    const loaderRefs = [...new Set(sourceRefs.map(ref => ref.loaderRegion?.id).filter(Boolean))].sort();
    const tileAligned = (region.size || 0) % tileSizeBytes === 0;
    return {
      id: `${region.id}_graphics_coverage`,
      region: regionRef(region),
      tileSizeBytes,
      tileAligned,
      declaredTileCount: tileAligned ? (region.size || 0) / tileSizeBytes : Number(((region.size || 0) / tileSizeBytes).toFixed(4)),
      referencedByLoaderCount: loaderRefs.length,
      sourceRangeCount: sourceRefs.length,
      uniqueReferencedBytes,
      uniqueReferencedTiles: Number((uniqueReferencedBytes / tileSizeBytes).toFixed(4)),
      duplicateReferencedBytes,
      coveragePercent: Number((uniqueReferencedBytes / Math.max(1, region.size || 0) * 100).toFixed(2)),
      unreferencedBytes: Math.max(0, (region.size || 0) - uniqueReferencedBytes),
      unreferencedSpans: unreferencedSpans(bounds, intervals),
      loaderRefs,
      sourceRefs,
      confidence: sourceRefs.length ? 'high' : 'medium',
      evidence: [
        'Graphics coverage is derived from vram_loader_8fb/vram_loader_998 source ranges parsed by tools/world-tile-source-audit.mjs.',
        'Catalog stores only offsets, byte counts, tile counts, and loader region ids; it does not store tile bytes or decoded graphics.',
      ],
    };
  });
  const summary = entries.reduce((acc, entry) => {
    acc.graphicsRegions++;
    acc.graphicsBytes += entry.region.size || 0;
    acc.graphicsTiles += entry.declaredTileCount;
    acc.uniqueReferencedBytes += entry.uniqueReferencedBytes;
    acc.regionsWithLoaderRefs += entry.referencedByLoaderCount ? 1 : 0;
    acc.regionsWithoutLoaderRefs += entry.referencedByLoaderCount ? 0 : 1;
    return acc;
  }, {
    graphicsRegions: 0,
    graphicsBytes: 0,
    graphicsTiles: 0,
    uniqueReferencedBytes: 0,
    regionsWithLoaderRefs: 0,
    regionsWithoutLoaderRefs: 0,
    tileSourceCatalogId: tileCatalog?.id || null,
    assetPolicy: 'Metadata only: graphics region offsets, tile counts, loader references, and source coverage ranges. No tile bytes, decoded graphics, or rendered images are embedded.',
  });
  summary.uniqueReferencedTiles = Number((summary.uniqueReferencedBytes / tileSizeBytes).toFixed(4));
  summary.uniqueCoveragePercent = Number((summary.uniqueReferencedBytes / Math.max(1, summary.graphicsBytes) * 100).toFixed(2));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-graphics-coverage-audit.mjs',
    summary,
    entries,
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  for (const entry of catalog.entries) {
    const region = (mapData.regions || []).find(item => item.id === entry.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.graphicsCoverageAudit = {
      catalogId,
      kind: 'graphics_tile_region_coverage',
      confidence: entry.confidence,
      summary: `${entry.uniqueReferencedTiles} unique tile(s) referenced by ${entry.referencedByLoaderCount} loader region(s).`,
      tileSizeBytes,
      declaredTileCount: entry.declaredTileCount,
      uniqueReferencedBytes: entry.uniqueReferencedBytes,
      uniqueReferencedTiles: entry.uniqueReferencedTiles,
      coveragePercent: entry.coveragePercent,
      unreferencedBytes: entry.unreferencedBytes,
      unreferencedSpanCount: entry.unreferencedSpans.length,
      loaderRefs: entry.loaderRefs,
      evidence: entry.evidence,
      generatedAt: now,
      tool: 'tools/world-graphics-coverage-audit.mjs',
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      loaderRefs: entry.loaderRefs.length,
      uniqueReferencedTiles: entry.uniqueReferencedTiles,
      coveragePercent: entry.coveragePercent,
    });
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : catalog.entries.map(entry => ({
    id: entry.region.id,
    offset: entry.region.offset,
    name: entry.region.name || '',
    loaderRefs: entry.loaderRefs.length,
    uniqueReferencedTiles: entry.uniqueReferencedTiles,
    coveragePercent: entry.coveragePercent,
  }));

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(catalogItem => catalogItem.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_coverage_audit',
      generatedAt: now,
      tool: 'tools/world-graphics-coverage-audit.mjs --apply',
      schemaVersion: 1,
      summary: catalog.summary,
      annotatedRegions,
      nextLeads: [
        'Map graphics regions without loader references by tracing direct VRAM copy routines and banked decompression paths.',
        'Connect sceneRecipes and tileSourceCatalog entries to graphicsCoverage entries so room previews can explain every tile source.',
        'Split large graphics banks into semantic tilesets only after loader and scene usage identify stable boundaries.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions,
    regionsWithoutLoaderRefs: catalog.entries
      .filter(entry => entry.referencedByLoaderCount === 0)
      .map(entry => entry.region),
  }, null, 2));
}

main();
