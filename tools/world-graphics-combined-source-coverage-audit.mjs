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
const toolName = 'tools/world-graphics-combined-source-coverage-audit.mjs';
const catalogId = 'world-graphics-combined-source-coverage-catalog-2026-06-26';
const reportId = 'graphics-combined-source-coverage-audit-2026-06-26';
const tileSizeBytes = 32;

const sourceCatalogIds = {
  staticLoaders: 'world-tile-source-catalog-2026-06-24',
  vram998EntrypointVariants: 'world-vram998-entrypoint-variant-catalog-2026-06-26',
  dynamicEntityLoaders: 'world-dynamic-tile-source-table-catalog-2026-06-25',
  playerA48TileStreams: 'world-player-a48-tile-stream-catalog-2026-06-26',
  statusTileUpload: 'world-status-tile-source-range-catalog-2026-06-26',
  previousGraphicsCoverage: 'world-graphics-coverage-catalog-2026-06-24',
};

function hex(value, pad = 5) {
  return `0x${value.toString(16).toUpperCase().padStart(pad, '0')}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.endExclusive) && interval.endExclusive > interval.start)
    .sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.endExclusive) {
      merged.push({ start: interval.start, endExclusive: interval.endExclusive });
      continue;
    }
    if (interval.endExclusive > last.endExclusive) last.endExclusive = interval.endExclusive;
  }
  return merged;
}

function intervalBytes(intervals) {
  return intervals.reduce((sum, interval) => sum + Math.max(0, interval.endExclusive - interval.start), 0);
}

function clipIntervalToRegion(interval, region) {
  const start = Math.max(interval.start, regionStart(region));
  const endExclusive = Math.min(interval.endExclusive, regionEnd(region));
  if (start >= endExclusive) return null;
  return {
    ...interval,
    start,
    endExclusive,
  };
}

function tileCount(bytes) {
  return Number((bytes / tileSizeBytes).toFixed(4));
}

function spansFromIntervals(intervals) {
  return intervals.map(interval => ({
    start: hex(interval.start),
    endExclusive: hex(interval.endExclusive),
    sizeBytes: interval.endExclusive - interval.start,
    tileCount: tileCount(interval.endExclusive - interval.start),
  }));
}

function collectStaticLoaderIntervals(staticCatalog) {
  const intervals = [];
  for (const loader of staticCatalog.loaderEntries || []) {
    for (const range of loader.sourceRanges || []) {
      const start = offsetOf(range.romStart);
      const endExclusive = offsetOf(range.romEndExclusive);
      if (!Number.isFinite(start) || !Number.isFinite(endExclusive)) continue;
      intervals.push({
        start,
        endExclusive,
        family: 'static_8fb_998_loader',
        catalogId: sourceCatalogIds.staticLoaders,
        evidenceRef: {
          loaderRegion: loader.loaderRegion || null,
          loaderEntryId: loader.id || null,
          loaderFormat: loader.format || null,
        },
      });
    }
  }
  return intervals;
}

function collectVram998VariantIntervals(variantCatalog) {
  const intervals = [];
  if (!variantCatalog) return intervals;
  for (const table of variantCatalog.variantTables || []) {
    for (const variant of table.variants || []) {
      for (const range of variant.sourceRanges || []) {
        const start = offsetOf(range.romStart);
        const endExclusive = offsetOf(range.romEndExclusive);
        if (!Number.isFinite(start) || !Number.isFinite(endExclusive)) continue;
        intervals.push({
          start,
          endExclusive,
          family: 'vram998_entrypoint_variant_loader',
          catalogId: sourceCatalogIds.vram998EntrypointVariants,
          evidenceRef: {
            loaderRegion: table.loaderRegion || null,
            variantTableId: table.id || null,
            variantId: variant.id || null,
            selectorRoutine: table.selectorRoutine || null,
            loaderRoutine: table.loaderRoutine || null,
          },
        });
      }
    }
  }
  return intervals;
}

function collectDynamicEntityIntervals(dynamicCatalog) {
  const intervals = [];
  for (const summary of dynamicCatalog.sourceGraphicsRegions || []) {
    for (const span of summary.spans || []) {
      const start = offsetOf(span.start);
      const endInclusive = offsetOf(span.endInclusive);
      if (!Number.isFinite(start) || !Number.isFinite(endInclusive)) continue;
      intervals.push({
        start,
        endExclusive: endInclusive + 1,
        family: 'dynamic_entity_tile_loader',
        catalogId: sourceCatalogIds.dynamicEntityLoaders,
        evidenceRef: {
          sourceRegionId: summary.region?.id || null,
          sourceRegionOffset: summary.region?.offset || null,
          sourceRegionName: summary.region?.name || '',
        },
      });
    }
  }
  return intervals;
}

function collectStatusTileIntervals(statusCatalog) {
  const intervals = [];
  for (const entry of statusCatalog.entries || []) {
    if (entry.uploadSkipped || !entry.sourceRange) continue;
    const start = offsetOf(entry.sourceRange.start);
    const endExclusive = offsetOf(entry.sourceRange.endExclusive);
    if (!Number.isFinite(start) || !Number.isFinite(endExclusive)) continue;
    intervals.push({
      start,
      endExclusive,
      family: 'status_tile_upload',
      catalogId: sourceCatalogIds.statusTileUpload,
      evidenceRef: {
        entryIndex: entry.entryIndex,
        uploadRoutine: '_LABEL_25A4_',
        selectorTable: '_DATA_25D6_',
        destinationVramAddress: entry.vramDestination?.address || null,
      },
    });
  }
  return intervals;
}

function collectPlayerA48Intervals(playerA48Catalog) {
  const intervals = [];
  if (!playerA48Catalog) return intervals;
  for (const summary of playerA48Catalog.sourceGraphicsRegions || []) {
    for (const span of summary.spans || []) {
      const start = offsetOf(span.start);
      const endExclusive = offsetOf(span.endExclusive);
      if (!Number.isFinite(start) || !Number.isFinite(endExclusive)) continue;
      intervals.push({
        start,
        endExclusive,
        family: 'player_a48_tile_stream',
        catalogId: sourceCatalogIds.playerA48TileStreams,
        evidenceRef: {
          sourceRegionId: summary.region?.id || null,
          sourceRegionOffset: summary.region?.offset || null,
          sourceRegionName: summary.region?.name || '',
          sourceRoutine: '_LABEL_A48_',
          commandRoutine: '_LABEL_1392_',
        },
      });
    }
  }
  return intervals;
}

function unreferencedSpans(region, mergedIntervals) {
  const spans = [];
  let cursor = regionStart(region);
  for (const interval of mergedIntervals) {
    if (interval.start > cursor) spans.push({ start: cursor, endExclusive: interval.start });
    cursor = Math.max(cursor, interval.endExclusive);
  }
  const end = regionEnd(region);
  if (cursor < end) spans.push({ start: cursor, endExclusive: end });
  return spans;
}

function contributorSummary(region, intervals) {
  const summaries = {};
  for (const interval of intervals) {
    const clipped = clipIntervalToRegion(interval, region);
    if (!clipped) continue;
    const family = interval.family;
    if (!summaries[family]) {
      summaries[family] = {
        family,
        catalogId: interval.catalogId,
        rangeCount: 0,
        duplicateBytes: 0,
        uniqueBytes: 0,
        uniqueTiles: 0,
        sampleRefs: [],
      };
    }
    const summary = summaries[family];
    summary.rangeCount++;
    summary.duplicateBytes += clipped.endExclusive - clipped.start;
    if (summary.sampleRefs.length < 8) {
      summary.sampleRefs.push({
        start: hex(clipped.start),
        endExclusive: hex(clipped.endExclusive),
        sizeBytes: clipped.endExclusive - clipped.start,
        evidenceRef: interval.evidenceRef,
      });
    }
  }

  for (const summary of Object.values(summaries)) {
    const merged = mergeIntervals(intervals
      .filter(interval => interval.family === summary.family)
      .map(interval => clipIntervalToRegion(interval, region))
      .filter(Boolean));
    summary.uniqueBytes = intervalBytes(merged);
    summary.uniqueTiles = tileCount(summary.uniqueBytes);
  }

  return Object.values(summaries).sort((a, b) => b.uniqueBytes - a.uniqueBytes || a.family.localeCompare(b.family));
}

function previousCoverageEntry(previousCatalog, regionId) {
  return (previousCatalog.entries || []).find(entry => entry.region?.id === regionId) || null;
}

function buildCatalog(mapData) {
  const staticCatalog = requireCatalog(mapData, sourceCatalogIds.staticLoaders);
  const vram998VariantCatalog = findCatalog(mapData, sourceCatalogIds.vram998EntrypointVariants);
  const dynamicCatalog = requireCatalog(mapData, sourceCatalogIds.dynamicEntityLoaders);
  const playerA48Catalog = findCatalog(mapData, sourceCatalogIds.playerA48TileStreams);
  const statusCatalog = requireCatalog(mapData, sourceCatalogIds.statusTileUpload);
  const previousCatalog = requireCatalog(mapData, sourceCatalogIds.previousGraphicsCoverage);

  const allIntervals = [
    ...collectStaticLoaderIntervals(staticCatalog),
    ...collectVram998VariantIntervals(vram998VariantCatalog),
    ...collectDynamicEntityIntervals(dynamicCatalog),
    ...collectPlayerA48Intervals(playerA48Catalog),
    ...collectStatusTileIntervals(statusCatalog),
  ];
  const regions = (mapData.regions || [])
    .filter(region => region.type === 'gfx_tiles')
    .sort((a, b) => regionStart(a) - regionStart(b) || (a.size || 0) - (b.size || 0));

  const entries = regions.map(region => {
    const regionIntervals = allIntervals
      .filter(interval => rangesOverlap(regionStart(region), regionEnd(region), interval.start, interval.endExclusive))
      .map(interval => clipIntervalToRegion(interval, region))
      .filter(Boolean);
    const merged = mergeIntervals(regionIntervals);
    const uniqueReferencedBytes = intervalBytes(merged);
    const unreferenced = unreferencedSpans(region, merged);
    const previous = previousCoverageEntry(previousCatalog, region.id);
    const previousUnique = previous?.uniqueReferencedBytes || 0;
    const newlyExplainedBytes = Math.max(0, uniqueReferencedBytes - previousUnique);
    const familyContributors = contributorSummary(region, allIntervals);
    const familyIds = familyContributors.map(item => item.family);
    const regionSize = region.size || 0;
    return {
      id: `${region.id}_combined_graphics_source_coverage`,
      region: regionRef(region),
      tileSizeBytes,
      declaredTileCount: tileCount(regionSize),
      combinedSourceFamilyCount: familyContributors.length,
      combinedSourceFamilies: familyIds,
      sourceRangeCount: regionIntervals.length,
      mergedSourceSpanCount: merged.length,
      uniqueReferencedBytes,
      uniqueReferencedTiles: tileCount(uniqueReferencedBytes),
      duplicateReferencedBytes: regionIntervals.reduce((sum, interval) => sum + (interval.endExclusive - interval.start), 0),
      coveragePercent: Number((uniqueReferencedBytes / Math.max(1, regionSize) * 100).toFixed(2)),
      unreferencedBytes: Math.max(0, regionSize - uniqueReferencedBytes),
      unreferencedTiles: tileCount(Math.max(0, regionSize - uniqueReferencedBytes)),
      unreferencedSpanCount: unreferenced.length,
      unreferencedSpans: spansFromIntervals(unreferenced),
      mergedSourceSpans: spansFromIntervals(merged),
      familyContributors,
      previousStaticLoaderCoverage: {
        catalogId: sourceCatalogIds.previousGraphicsCoverage,
        uniqueReferencedBytes: previousUnique,
        coveragePercent: previous?.coveragePercent || 0,
        unreferencedBytes: previous?.unreferencedBytes ?? regionSize,
      },
      newlyExplainedBytes,
      newlyExplainedTiles: tileCount(newlyExplainedBytes),
      confidence: familyContributors.length ? 'high' : 'medium',
      evidence: [
        `Static source ranges come from ${sourceCatalogIds.staticLoaders}, derived from parsed _LABEL_8FB_/_LABEL_998_ loaders.`,
        vram998VariantCatalog
          ? `Fixed-stride 998 entrypoint variant ranges come from ${sourceCatalogIds.vram998EntrypointVariants}, derived from _LABEL_1C31_ selecting _DATA_1C48_ substreams.`
          : `No ${sourceCatalogIds.vram998EntrypointVariants} catalog was present when this audit ran.`,
        `Dynamic entity source ranges come from ${sourceCatalogIds.dynamicEntityLoaders}, derived from $9D60/$9E00 tables consumed by _LABEL_A97_.`,
        playerA48Catalog
          ? `Player/form A48 source ranges come from ${sourceCatalogIds.playerA48TileStreams}, derived from _LABEL_1392_ command streams consumed by _LABEL_A48_.`
          : `No ${sourceCatalogIds.playerA48TileStreams} catalog was present when this audit ran.`,
        `Status source ranges come from ${sourceCatalogIds.statusTileUpload}, derived from _LABEL_25A4_/_DATA_25D6_ upload logic.`,
        'This catalog stores offsets, counts, and provenance only; no ROM bytes, decoded graphics, screenshots, or rendered tiles are embedded.',
      ],
    };
  });

  const summary = entries.reduce((acc, entry) => {
    acc.graphicsRegions++;
    acc.graphicsBytes += entry.region.size || 0;
    acc.graphicsTiles += entry.declaredTileCount;
    acc.uniqueReferencedBytes += entry.uniqueReferencedBytes;
    acc.unreferencedBytes += entry.unreferencedBytes;
    acc.previousStaticLoaderReferencedBytes += entry.previousStaticLoaderCoverage.uniqueReferencedBytes;
    if (entry.combinedSourceFamilyCount) acc.regionsWithAnyConfirmedSource++;
    else acc.regionsWithoutConfirmedSource++;
    if (entry.newlyExplainedBytes > 0) acc.regionsImprovedOverStaticCoverage++;
    return acc;
  }, {
    graphicsRegions: 0,
    graphicsBytes: 0,
    graphicsTiles: 0,
    uniqueReferencedBytes: 0,
    previousStaticLoaderReferencedBytes: 0,
    unreferencedBytes: 0,
    regionsWithAnyConfirmedSource: 0,
    regionsWithoutConfirmedSource: 0,
    regionsImprovedOverStaticCoverage: 0,
    sourceCatalogs: Object.values(sourceCatalogIds),
    sourceFamilies: [...new Set(allIntervals.map(interval => interval.family))].sort(),
    assetPolicy: 'Metadata only: graphics region offsets, tile counts, merged source ranges, source-catalog ids, and provenance summaries. No ROM bytes, decoded graphics, screenshots, or rendered tiles are embedded.',
  });

  summary.uniqueReferencedTiles = tileCount(summary.uniqueReferencedBytes);
  summary.previousStaticLoaderReferencedTiles = tileCount(summary.previousStaticLoaderReferencedBytes);
  summary.newlyExplainedBytes = Math.max(0, summary.uniqueReferencedBytes - summary.previousStaticLoaderReferencedBytes);
  summary.newlyExplainedTiles = tileCount(summary.newlyExplainedBytes);
  summary.combinedCoveragePercent = Number((summary.uniqueReferencedBytes / Math.max(1, summary.graphicsBytes) * 100).toFixed(2));
  summary.previousStaticCoveragePercent = Number((summary.previousStaticLoaderReferencedBytes / Math.max(1, summary.graphicsBytes) * 100).toFixed(2));
  summary.unreferencedTiles = tileCount(summary.unreferencedBytes);

  const largestUnreferencedSpans = entries
    .flatMap(entry => entry.unreferencedSpans.map(span => ({
      id: `${entry.region.id}_${span.start}_${span.endExclusive}`,
      region: entry.region,
      ...span,
    })))
    .sort((a, b) => b.sizeBytes - a.sizeBytes || offsetOf(a.start) - offsetOf(b.start))
    .slice(0, 12);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    summary,
    entries,
    largestUnreferencedSpans,
    improvedRegions: entries
      .filter(entry => entry.newlyExplainedBytes > 0)
      .map(entry => ({
        region: entry.region,
        newlyExplainedBytes: entry.newlyExplainedBytes,
        newlyExplainedTiles: entry.newlyExplainedTiles,
        previousCoveragePercent: entry.previousStaticLoaderCoverage.coveragePercent,
        combinedCoveragePercent: entry.coveragePercent,
        combinedSourceFamilies: entry.combinedSourceFamilies,
      })),
    evidence: [
      'This audit reconciles the original static tile-loader graphics coverage with later dynamic entity, player A48, and status-tile source catalogs.',
      'It is a provenance coverage catalog, not a claim that remaining unreferenced spans are unused.',
      'All source claims are inherited from existing evidence-backed catalogs and remain metadata-only.',
    ],
    nextLeads: [
      'Use the combined unreferenced-span list as the new graphics-source target list instead of the older static-only unreferenced-span report.',
      'Trace the remaining fully or partly unreferenced graphics spans through direct VDP copy paths, decompression paths, and scene-specific loaders.',
      'Connect combined source-family coverage to scene recipe VRAM provenance so room previews can report dynamic/status source dependencies.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  for (const entry of catalog.entries) {
    const region = (mapData.regions || []).find(item => item.id === entry.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.graphicsCombinedSourceCoverageAudit = {
      catalogId,
      kind: 'combined_graphics_source_coverage',
      confidence: entry.confidence,
      summary: `${entry.uniqueReferencedTiles} tile(s) covered by ${entry.combinedSourceFamilyCount} confirmed source family/families.`,
      tileSizeBytes,
      declaredTileCount: entry.declaredTileCount,
      combinedSourceFamilies: entry.combinedSourceFamilies,
      uniqueReferencedBytes: entry.uniqueReferencedBytes,
      uniqueReferencedTiles: entry.uniqueReferencedTiles,
      coveragePercent: entry.coveragePercent,
      unreferencedBytes: entry.unreferencedBytes,
      unreferencedTiles: entry.unreferencedTiles,
      unreferencedSpanCount: entry.unreferencedSpanCount,
      mergedSourceSpanCount: entry.mergedSourceSpanCount,
      previousStaticLoaderCoverage: entry.previousStaticLoaderCoverage,
      newlyExplainedBytes: entry.newlyExplainedBytes,
      newlyExplainedTiles: entry.newlyExplainedTiles,
      familyContributors: entry.familyContributors.map(contributor => ({
        family: contributor.family,
        catalogId: contributor.catalogId,
        rangeCount: contributor.rangeCount,
        uniqueBytes: contributor.uniqueBytes,
        uniqueTiles: contributor.uniqueTiles,
      })),
      evidence: entry.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      coveragePercent: entry.coveragePercent,
      newlyExplainedBytes: entry.newlyExplainedBytes,
      combinedSourceFamilies: entry.combinedSourceFamilies,
    });
  }
  return annotatedRegions;
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : catalog.entries.map(entry => ({
    id: entry.region.id,
    offset: entry.region.offset,
    name: entry.region.name || '',
    coveragePercent: entry.coveragePercent,
    newlyExplainedBytes: entry.newlyExplainedBytes,
    combinedSourceFamilies: entry.combinedSourceFamilies,
  }));

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_combined_source_coverage_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      annotatedRegions,
      largestUnreferencedSpans: catalog.largestUnreferencedSpans,
      improvedRegions: catalog.improvedRegions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    improvedRegions: catalog.improvedRegions,
    largestUnreferencedSpans: catalog.largestUnreferencedSpans,
    annotatedRegionCount: annotatedRegions.length,
  }, null, 2));
}

main();
