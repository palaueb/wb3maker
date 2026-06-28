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
const toolName = 'tools/world-graphics-incbin-split-layout-audit.mjs';
const sourceIncbinCatalogId = 'world-asm-incbin-span-catalog-2026-06-25';
const catalogId = 'world-graphics-incbin-split-layout-catalog-2026-06-25';
const reportId = 'graphics-incbin-split-layout-audit-2026-06-25';
const tileSizeBytes = 32;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function regionStart(region) {
  return parseHex(region.offset) ?? 0;
}

function regionEnd(region) {
  return regionStart(region) + Number(region.size || 0);
}

function compactRegion(region) {
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
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

function regionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function overlappingRegions(mapData, start, endExclusive) {
  return (mapData.regions || [])
    .filter(region => regionStart(region) < endExclusive && regionEnd(region) > start)
    .sort((a, b) => regionStart(a) - regionStart(b) || regionEnd(a) - regionEnd(b) || String(a.id).localeCompare(String(b.id)));
}

function segmentRole(region) {
  const coverage = region.analysis?.graphicsCoverageAudit || {};
  const unreferenced = region.analysis?.graphicsUnreferencedSpanAudit || {};
  const referencedTiles = Number(coverage.uniqueReferencedTiles || 0);
  const coveragePercent = Number(coverage.coveragePercent || 0);
  const unreferencedSpanCount = Number(coverage.unreferencedSpanCount || unreferenced.unreferencedSpanCount || 0);

  if (referencedTiles === 0) {
    return {
      role: 'unresolved_graphics_source_segment',
      confidence: 'medium',
      reason: 'No parsed 8FB/998 loader source range currently references this graphics segment.',
    };
  }
  if (coveragePercent === 100 && Number(region.size || 0) === tileSizeBytes) {
    return {
      role: 'single_tile_loader_referenced_source',
      confidence: 'high',
      reason: 'The segment is one tile wide and fully covered by parsed loader source references.',
    };
  }
  if (coveragePercent === 100) {
    return {
      role: 'fully_loader_referenced_graphics_segment',
      confidence: 'high',
      reason: 'Parsed loader source references cover the entire segment.',
    };
  }
  if (unreferencedSpanCount > 0) {
    return {
      role: 'mixed_loader_referenced_and_unresolved_source',
      confidence: 'high',
      reason: 'The segment has parsed loader references plus remaining missing-provenance spans.',
    };
  }
  return {
    role: 'loader_referenced_graphics_segment',
    confidence: 'high',
    reason: 'The segment has parsed loader source references.',
  };
}

function evidenceRefs(region) {
  const refs = [];
  for (const key of ['asmIncbinSpanAudit', 'graphicsCoverageAudit', 'graphicsUnreferencedSpanAudit', 'dynamicTileSourceTableAudit']) {
    const audit = region.analysis?.[key];
    if (!audit) continue;
    refs.push({
      analysisKey: key,
      catalogId: audit.catalogId || '',
      kind: audit.kind || '',
      role: audit.role || '',
      confidence: audit.confidence || '',
      summary: audit.summary || '',
    });
  }
  return refs;
}

function segmentEntry(region, spanStart, index) {
  const coverage = region.analysis?.graphicsCoverageAudit || {};
  const unreferenced = region.analysis?.graphicsUnreferencedSpanAudit || {};
  const role = segmentRole(region);
  const start = regionStart(region);
  const endExclusive = regionEnd(region);
  return {
    index,
    region: compactRegion(region),
    spanRelativeRange: {
      startBytes: start - spanStart,
      endExclusiveBytes: endExclusive - spanStart,
    },
    tileAligned: start % tileSizeBytes === 0 && endExclusive % tileSizeBytes === 0,
    declaredTileCount: Number(coverage.declaredTileCount || Number(region.size || 0) / tileSizeBytes),
    uniqueReferencedTiles: Number(coverage.uniqueReferencedTiles || 0),
    loaderRefCount: Array.isArray(coverage.loaderRefs) ? coverage.loaderRefs.length : 0,
    loaderRefs: Array.isArray(coverage.loaderRefs) ? coverage.loaderRefs.slice().sort() : [],
    coveragePercent: Number(coverage.coveragePercent || 0),
    unreferencedSpanCount: Number(coverage.unreferencedSpanCount || unreferenced.unreferencedSpanCount || 0),
    unreferencedTiles: Number(unreferenced.unreferencedTiles || 0),
    largestUnreferencedSpan: unreferenced.largestSpan ? {
      id: unreferenced.largestSpan.id || '',
      start: unreferenced.largestSpan.start || '',
      endExclusive: unreferenced.largestSpan.endExclusive || '',
      sizeBytes: Number(unreferenced.largestSpan.sizeBytes || 0),
      tileCount: Number(unreferenced.largestSpan.tileCount || 0),
      classification: unreferenced.largestSpan.classification ? {
        kind: unreferenced.largestSpan.classification.kind || '',
        confidence: unreferenced.largestSpan.classification.confidence || '',
      } : null,
    } : null,
    role: role.role,
    confidence: role.confidence,
    reason: role.reason,
    evidenceRefs: evidenceRefs(region),
  };
}

function buildSpanLayout(mapData, incbinEntry) {
  const start = parseHex(incbinEntry.declaredSpan.start);
  const endExclusive = parseHex(incbinEntry.declaredSpan.endExclusive);
  const regions = overlappingRegions(mapData, start, endExclusive);
  const segments = regions.map((region, index) => segmentEntry(region, start, index));
  const validationIssues = [];
  let cursor = start;
  for (const region of regions) {
    if (regionStart(region) > cursor) {
      validationIssues.push({
        severity: 'warning',
        kind: 'split_graphics_span_gap',
        spanId: incbinEntry.id,
        start: hex(cursor),
        endExclusive: hex(regionStart(region)),
      });
    }
    if (region.type !== 'gfx_tiles') {
      validationIssues.push({
        severity: 'warning',
        kind: 'split_graphics_span_non_graphics_region',
        spanId: incbinEntry.id,
        region: compactRegion(region),
      });
    }
    cursor = Math.max(cursor, regionEnd(region));
  }
  if (cursor < endExclusive) {
    validationIssues.push({
      severity: 'warning',
      kind: 'split_graphics_span_gap',
      spanId: incbinEntry.id,
      start: hex(cursor),
      endExclusive: hex(endExclusive),
    });
  }
  return {
    id: `${incbinEntry.id}-graphics-layout`,
    incbinSpanId: incbinEntry.id,
    asmLine: incbinEntry.asmLine,
    bank: incbinEntry.bank,
    declaredSpan: incbinEntry.declaredSpan,
    sourceRegion: incbinEntry.sourceRegion,
    coverageStatus: incbinEntry.coverageStatus,
    segmentCount: segments.length,
    bySegmentRole: countBy(segments, segment => segment.role),
    referencedTileCount: segments.reduce((sum, segment) => sum + segment.uniqueReferencedTiles, 0),
    unreferencedTileCount: Number(segments.reduce((sum, segment) => sum + segment.unreferencedTiles, 0).toFixed(4)),
    loaderRefRegionIds: [...new Set(segments.flatMap(segment => segment.loaderRefs))].sort(),
    segments,
    validationIssues,
    evidence: [
      `Source ASM .incbin span comes from ${sourceIncbinCatalogId}.`,
      'Segment roles are derived from existing graphicsCoverageAudit and graphicsUnreferencedSpanAudit metadata.',
      'This layout stores offsets, counts, region ids, and loader refs only; no tile bytes or decoded graphics are embedded.',
    ],
  };
}

function buildCatalog(mapData) {
  const incbinCatalog = requireCatalog(mapData, sourceIncbinCatalogId);
  const splitGraphicsEntries = (incbinCatalog.entries || [])
    .filter(entry => entry.assetFamily === 'graphics_tile_banks' && entry.coverageStatus === 'split_across_current_regions');
  const layouts = splitGraphicsEntries.map(entry => buildSpanLayout(mapData, entry));
  const segments = layouts.flatMap(layout => layout.segments.map(segment => ({
    ...segment,
    incbinSpanId: layout.incbinSpanId,
  })));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceIncbinCatalogId, 'world-graphics-coverage-catalog-2026-06-24', 'world-graphics-unreferenced-span-catalog-2026-06-25'],
    assetPolicy: 'Metadata only: ASM span ids, offsets, region ids/types, tile counts, loader refs, coverage percentages, role labels, and evidence references. No ROM bytes, decoded tiles, rendered graphics, screenshots, audio, text payloads, or gameplay constants are embedded.',
    summary: {
      splitGraphicsSpanCount: layouts.length,
      segmentCount: segments.length,
      bySegmentRole: countBy(segments, segment => segment.role),
      byConfidence: countBy(segments, segment => segment.confidence),
      validationIssueCount: layouts.reduce((sum, layout) => sum + layout.validationIssues.length, 0),
    },
    layouts,
    validationIssues: layouts.flatMap(layout => layout.validationIssues),
    evidence: [
      'The source incbin audit identified ASM graphics spans that are split across current map regions.',
      'Existing graphics coverage audits provide loader-reference counts and missing-provenance span counts for each segment.',
      'No new ROM payload decoding is performed by this audit.',
    ],
    nextLeads: [
      'Trace the unresolved single-tile segment in the bank-11 split graphics span to determine whether it is padding, direct-copy data, or an unmodeled loader source.',
      'Use the mixed segments as a ranked list for finding graphics upload paths beyond _LABEL_8FB_ and _LABEL_998_.',
      'Expose split graphics layouts in the analyzer so the large ASM graphics banks can be reviewed segment by segment.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  for (const layout of catalog.layouts) {
    for (const segment of layout.segments) {
      const region = regionById(mapData, segment.region.id);
      if (!region) continue;
      region.analysis = region.analysis || {};
      region.analysis.graphicsIncbinSplitLayoutAudit = {
        catalogId,
        kind: 'graphics_incbin_split_segment',
        incbinSpanId: layout.incbinSpanId,
        segmentIndex: segment.index,
        role: segment.role,
        confidence: segment.confidence,
        declaredSpan: layout.declaredSpan,
        spanRelativeRange: segment.spanRelativeRange,
        uniqueReferencedTiles: segment.uniqueReferencedTiles,
        loaderRefCount: segment.loaderRefCount,
        unreferencedSpanCount: segment.unreferencedSpanCount,
        unreferencedTiles: segment.unreferencedTiles,
        summary: `${segment.region.id} is segment ${segment.index} of split graphics span ${layout.incbinSpanId}: ${segment.role}.`,
        evidenceRefs: segment.evidenceRefs,
        evidence: [
          `Segment belongs to ASM .incbin span ${layout.incbinSpanId}.`,
          segment.reason,
          'Metadata-only audit; no ROM bytes or decoded tile graphics are embedded.',
        ],
        generatedAt: now,
        tool: toolName,
      };
      annotated.push({
        region: compactRegion(region),
        incbinSpanId: layout.incbinSpanId,
        segmentIndex: segment.index,
        role: segment.role,
        confidence: segment.confidence,
      });
    }
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
      type: 'graphics_incbin_split_layout_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
      validationIssues: catalog.validationIssues,
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
    validationIssues: catalog.validationIssues,
    layouts: catalog.layouts.map(layout => ({
      incbinSpanId: layout.incbinSpanId,
      declaredSpan: layout.declaredSpan,
      segmentCount: layout.segmentCount,
      bySegmentRole: layout.bySegmentRole,
      referencedTileCount: layout.referencedTileCount,
      unreferencedTileCount: layout.unreferencedTileCount,
      loaderRefRegionIds: layout.loaderRefRegionIds,
    })),
  }, null, 2));
}

main();
