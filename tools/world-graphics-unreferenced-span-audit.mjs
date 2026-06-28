#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const sourceCatalogId = 'world-graphics-coverage-catalog-2026-06-24';
const catalogId = 'world-graphics-unreferenced-span-catalog-2026-06-25';
const reportId = 'graphics-unreferenced-span-audit-2026-06-25';
const toolName = 'tools/world-graphics-unreferenced-span-audit.mjs';
const tileSizeBytes = 32;

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(value) {
  if (typeof value === 'number') return value;
  return parseInt(value, 16);
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

function regionRef(region) {
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function regionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function sourceRefBounds(ref) {
  const range = ref?.sourceRange || {};
  const start = offsetOf(range.start);
  const end = offsetOf(range.endExclusive);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end, ref };
}

function neighborRefs(entry, spanStart, spanEnd) {
  const refs = (entry.sourceRefs || [])
    .map(sourceRefBounds)
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const previous = [...refs].reverse().find(ref => ref.end <= spanStart) || null;
  const next = refs.find(ref => ref.start >= spanEnd) || null;
  return {
    previous: previous ? {
      loaderRegion: previous.ref.loaderRegion,
      loaderFormat: previous.ref.loaderFormat,
      sourceRange: previous.ref.sourceRange,
      distanceBytes: spanStart - previous.end,
    } : null,
    next: next ? {
      loaderRegion: next.ref.loaderRegion,
      loaderFormat: next.ref.loaderFormat,
      sourceRange: next.ref.sourceRange,
      distanceBytes: next.start - spanEnd,
    } : null,
  };
}

function spanClassification(entry, span, spanStart, spanEnd) {
  if ((entry.referencedByLoaderCount || 0) === 0) {
    return {
      kind: 'whole_region_without_loader_refs',
      confidence: 'medium',
      reason: 'No parsed 8FB/998 loader source range currently references this graphics region.',
    };
  }
  const touchesRegionStart = spanStart === offsetOf(entry.region.offset);
  const touchesRegionEnd = spanEnd === offsetOf(entry.region.offset) + (entry.region.size || 0);
  if (touchesRegionStart || touchesRegionEnd) {
    return {
      kind: 'edge_unreferenced_tiles',
      confidence: 'medium',
      reason: 'Span touches a graphics region edge and may be unused padding, direct-copy data, or an untraced loader source.',
    };
  }
  return {
    kind: 'interior_unreferenced_tiles',
    confidence: 'medium',
    reason: 'Span is surrounded by known loader-referenced graphics ranges and needs direct-copy/decompression or alternate-loader tracing.',
  };
}

function flattenUnreferencedSpans(coverageCatalog) {
  const spans = [];
  for (const entry of coverageCatalog.entries || []) {
    const regionStart = offsetOf(entry.region.offset);
    for (const [index, span] of (entry.unreferencedSpans || []).entries()) {
      const spanStart = offsetOf(span.start);
      const spanEnd = offsetOf(span.endExclusive);
      const relativeStartBytes = spanStart - regionStart;
      const relativeEndExclusiveBytes = spanEnd - regionStart;
      const neighbor = neighborRefs(entry, spanStart, spanEnd);
      const classification = spanClassification(entry, span, spanStart, spanEnd);
      spans.push({
        id: `${entry.region.id}_unreferenced_${String(index).padStart(2, '0')}`,
        region: entry.region,
        start: hex(spanStart),
        endExclusive: hex(spanEnd),
        sizeBytes: spanEnd - spanStart,
        tileCount: Number(((spanEnd - spanStart) / tileSizeBytes).toFixed(4)),
        tileAligned: spanStart % tileSizeBytes === 0 && spanEnd % tileSizeBytes === 0,
        regionTileRange: {
          start: Number((relativeStartBytes / tileSizeBytes).toFixed(4)),
          endExclusive: Number((relativeEndExclusiveBytes / tileSizeBytes).toFixed(4)),
        },
        romBank: Math.floor(spanStart / 0x4000),
        classification,
        neighboringKnownSourceRefs: neighbor,
        evidence: [
          `Source coverage catalog ${sourceCatalogId} lists this span as unreferenced by parsed _LABEL_8FB_/_LABEL_998_ loader source ranges.`,
          'This audit stores offsets, sizes, tile counts, loader-region references, and classification notes only.',
        ],
      });
    }
  }
  return spans.sort((a, b) => b.sizeBytes - a.sizeBytes || offsetOf(a.start) - offsetOf(b.start));
}

function groupByRegion(spans) {
  const groups = new Map();
  for (const span of spans) {
    if (!groups.has(span.region.id)) {
      groups.set(span.region.id, {
        region: span.region,
        unreferencedSpanCount: 0,
        unreferencedBytes: 0,
        unreferencedTiles: 0,
        largestSpan: null,
        classificationCounts: {},
        spans: [],
      });
    }
    const group = groups.get(span.region.id);
    group.unreferencedSpanCount++;
    group.unreferencedBytes += span.sizeBytes;
    group.unreferencedTiles = Number((group.unreferencedBytes / tileSizeBytes).toFixed(4));
    group.largestSpan = !group.largestSpan || span.sizeBytes > group.largestSpan.sizeBytes ? span : group.largestSpan;
    group.classificationCounts[span.classification.kind] = (group.classificationCounts[span.classification.kind] || 0) + 1;
    group.spans.push({
      id: span.id,
      start: span.start,
      endExclusive: span.endExclusive,
      sizeBytes: span.sizeBytes,
      tileCount: span.tileCount,
      classification: span.classification,
    });
  }
  return [...groups.values()].sort((a, b) => b.unreferencedBytes - a.unreferencedBytes || offsetOf(a.region.offset) - offsetOf(b.region.offset));
}

function buildCatalog(mapData) {
  const coverageCatalog = requireCatalog(mapData, sourceCatalogId);
  const spans = flattenUnreferencedSpans(coverageCatalog);
  const regions = groupByRegion(spans);
  const summary = {
    sourceCatalogId,
    graphicsRegions: coverageCatalog.summary?.graphicsRegions || 0,
    graphicsBytes: coverageCatalog.summary?.graphicsBytes || 0,
    knownLoaderReferencedBytes: coverageCatalog.summary?.uniqueReferencedBytes || 0,
    knownLoaderCoveragePercent: coverageCatalog.summary?.uniqueCoveragePercent || 0,
    unreferencedSpanCount: spans.length,
    regionsWithUnreferencedSpans: regions.length,
    regionsWithNoLoaderRefs: regions.filter(region => region.classificationCounts.whole_region_without_loader_refs).length,
    unreferencedBytes: spans.reduce((sum, span) => sum + span.sizeBytes, 0),
    unreferencedTiles: Number((spans.reduce((sum, span) => sum + span.sizeBytes, 0) / tileSizeBytes).toFixed(4)),
    largestSpanBytes: spans[0]?.sizeBytes || 0,
    largestSpan: spans[0] ? {
      id: spans[0].id,
      region: spans[0].region,
      start: spans[0].start,
      endExclusive: spans[0].endExclusive,
      sizeBytes: spans[0].sizeBytes,
      tileCount: spans[0].tileCount,
      classification: spans[0].classification,
    } : null,
    assetPolicy: 'Metadata only: graphics-region offsets, unreferenced source spans, tile counts, loader-neighbor references, and evidence. No ROM bytes, decoded tiles, rendered graphics, or screenshots are embedded.',
  };
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceCatalogId, 'world-tile-source-catalog-2026-06-24'],
    summary,
    regions,
    spans,
    evidence: [
      `${sourceCatalogId} is derived from parsed _LABEL_8FB_ and _LABEL_998_ loader source ranges.`,
      'Unreferenced spans are the complement of merged loader source ranges inside mapped gfx_tiles regions.',
      'A span being unreferenced does not prove it is unused; it marks missing loader/direct-copy/decompression evidence.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  for (const group of catalog.regions) {
    const region = regionById(mapData, group.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.graphicsUnreferencedSpanAudit = {
      catalogId,
      kind: 'graphics_unreferenced_loader_source_spans',
      confidence: 'medium',
      sourceCatalogId,
      unreferencedSpanCount: group.unreferencedSpanCount,
      unreferencedBytes: group.unreferencedBytes,
      unreferencedTiles: group.unreferencedTiles,
      largestSpan: group.largestSpan ? {
        id: group.largestSpan.id,
        start: group.largestSpan.start,
        endExclusive: group.largestSpan.endExclusive,
        sizeBytes: group.largestSpan.sizeBytes,
        tileCount: group.largestSpan.tileCount,
        classification: group.largestSpan.classification,
      } : null,
      classificationCounts: group.classificationCounts,
      evidence: [
        `Derived from ${sourceCatalogId}; this is a missing-provenance target list, not an unused-asset claim.`,
        'No ROM bytes, decoded graphics, or rendered assets are stored.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      unreferencedSpanCount: group.unreferencedSpanCount,
      unreferencedBytes: group.unreferencedBytes,
      largestSpan: region.analysis.graphicsUnreferencedSpanAudit.largestSpan,
    });
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [];

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_unreferenced_span_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      annotatedRegions,
      largestSpans: catalog.spans.slice(0, 12).map(span => ({
        id: span.id,
        region: span.region,
        start: span.start,
        endExclusive: span.endExclusive,
        sizeBytes: span.sizeBytes,
        tileCount: span.tileCount,
        classification: span.classification,
      })),
      validationIssues: [],
      nextLeads: [
        'Trace direct VRAM copy and decompression routines that write tiles without using the parsed _LABEL_8FB_/_LABEL_998_ loaders.',
        'Prioritize the whole unreferenced gfx region and largest interior spans when searching for missing loader families.',
        'Connect newly discovered loader source ranges back into world-tile-source-catalog, then rerun graphics coverage and this span audit.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    largestSpans: catalog.spans.slice(0, 12).map(span => ({
      id: span.id,
      region: span.region,
      start: span.start,
      endExclusive: span.endExclusive,
      sizeBytes: span.sizeBytes,
      tileCount: span.tileCount,
      classification: span.classification,
    })),
    annotatedRegions: annotatedRegions.length,
  }, null, 2));
}

main();
