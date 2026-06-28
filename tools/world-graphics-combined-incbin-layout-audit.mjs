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
const toolName = 'tools/world-graphics-combined-incbin-layout-audit.mjs';
const sourceIncbinCatalogId = 'world-asm-incbin-span-catalog-2026-06-25';
const combinedCoverageCatalogId = 'world-graphics-combined-source-coverage-catalog-2026-06-26';
const remainingLeadCatalogId = 'world-graphics-remaining-lead-reconciliation-catalog-2026-06-26';
const catalogId = 'world-graphics-combined-incbin-layout-catalog-2026-06-26';
const reportId = 'graphics-combined-incbin-layout-audit-2026-06-26';
const tileSizeBytes = 32;

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

function regionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function overlappingRegions(mapData, start, endExclusive) {
  return (mapData.regions || [])
    .filter(region => regionStart(region) < endExclusive && regionEnd(region) > start)
    .sort((a, b) => regionStart(a) - regionStart(b) || regionEnd(a) - regionEnd(b) || String(a.id).localeCompare(String(b.id)));
}

function spanSummary(spans, limit = 8) {
  return (spans || []).slice(0, limit).map(span => ({
    start: span.start || '',
    endExclusive: span.endExclusive || '',
    sizeBytes: Number(span.sizeBytes || 0),
    tileCount: Number(span.tileCount || 0),
  }));
}

function sourceFamilySummary(familyContributors) {
  return (familyContributors || []).map(item => ({
    family: item.family || '',
    catalogId: item.catalogId || '',
    rangeCount: Number(item.rangeCount || 0),
    uniqueBytes: Number(item.uniqueBytes || 0),
    uniqueTiles: Number(item.uniqueTiles || 0),
  }));
}

function buildIndexes(combinedCoverageCatalog, remainingLeadCatalog) {
  const coverageByRegion = new Map();
  for (const entry of combinedCoverageCatalog.entries || []) {
    if (entry.region?.id) coverageByRegion.set(entry.region.id, entry);
  }

  const remainingByRegion = new Map();
  for (const group of remainingLeadCatalog.regions || []) {
    if (group.region?.id) remainingByRegion.set(group.region.id, group);
  }

  const remainingEntriesByRegion = new Map();
  for (const entry of remainingLeadCatalog.entries || []) {
    if (!entry.region?.id) continue;
    if (!remainingEntriesByRegion.has(entry.region.id)) remainingEntriesByRegion.set(entry.region.id, []);
    remainingEntriesByRegion.get(entry.region.id).push(entry);
  }

  for (const entries of remainingEntriesByRegion.values()) {
    entries.sort((a, b) => Number(b.priorityScore || 0) - Number(a.priorityScore || 0) || offsetOf(a.start) - offsetOf(b.start));
  }

  return { coverageByRegion, remainingByRegion, remainingEntriesByRegion };
}

function classifySegment(region, coverage, remainingGroup) {
  if (!coverage) {
    return {
      role: 'graphics_segment_without_combined_coverage_entry',
      confidence: 'low',
      priorityGroup: 'repair_catalog_inputs',
      reason: 'The region overlaps an ASM graphics incbin span but has no combined source coverage entry.',
    };
  }

  const coveragePercent = Number(coverage.coveragePercent || 0);
  const unreferencedTiles = Number(coverage.unreferencedTiles || 0);
  const priorityCounts = remainingGroup?.priorityGroupCounts || {};
  const directCopy = Number(priorityCounts.trace_direct_copy_or_decompression || 0);
  const nonLoader = Number(priorityCounts.trace_non_loader_occurrences || 0);
  const lowPriority = Number(priorityCounts.padding_or_shape_low_priority || 0);
  const nonblankRemaining = Number(remainingGroup?.nonblankTileCount || 0);

  if (coveragePercent === 100 && unreferencedTiles === 0) {
    return {
      role: 'fully_confirmed_graphics_source_segment',
      confidence: 'high',
      priorityGroup: 'none',
      reason: 'Combined source coverage accounts for every tile in this segment.',
    };
  }

  if (directCopy > 0) {
    return {
      role: 'mixed_confirmed_source_with_direct_copy_or_decompression_leads',
      confidence: 'medium_high',
      priorityGroup: 'trace_direct_copy_or_decompression',
      reason: 'Combined source coverage leaves nonblank spans whose loader-like word hits resolve as non-source overlaps, so the next consumer class is likely direct-copy or decompression.',
    };
  }

  if (nonLoader > 0) {
    return {
      role: 'mixed_confirmed_source_with_non_loader_word_leads',
      confidence: 'medium',
      priorityGroup: 'trace_non_loader_occurrences',
      reason: 'Combined source coverage leaves nonblank spans with only non-loader source-word-shaped occurrences.',
    };
  }

  if (lowPriority > 0 && nonblankRemaining === 0) {
    return {
      role: 'remaining_low_priority_padding_or_shape_only',
      confidence: 'medium_high',
      priorityGroup: 'padding_or_shape_low_priority',
      reason: 'Remaining spans are currently classified as blank padding or shape-only low-priority leads.',
    };
  }

  if (unreferencedTiles > 0) {
    return {
      role: 'mixed_confirmed_source_with_unclassified_remaining_tiles',
      confidence: 'medium',
      priorityGroup: 'manual_review',
      reason: 'Combined source coverage leaves tiles without a stronger remaining-lead classification.',
    };
  }

  return {
    role: 'confirmed_source_segment_with_no_remaining_tiles',
    confidence: 'high',
    priorityGroup: 'none',
    reason: 'Combined source coverage marks no remaining source gap for this segment.',
  };
}

function segmentEntry(region, spanStart, index, indexes) {
  const coverage = indexes.coverageByRegion.get(region.id) || null;
  const remainingGroup = indexes.remainingByRegion.get(region.id) || null;
  const remainingEntries = indexes.remainingEntriesByRegion.get(region.id) || [];
  const role = classifySegment(region, coverage, remainingGroup);
  const start = regionStart(region);
  const endExclusive = regionEnd(region);
  const unreferencedSpans = spanSummary(coverage?.unreferencedSpans || [], 10);
  const sourceSpans = spanSummary(coverage?.mergedSourceSpans || [], 10);

  return {
    index,
    region: compactRegion(region),
    spanRelativeRange: {
      startBytes: start - spanStart,
      endExclusiveBytes: endExclusive - spanStart,
    },
    tileAligned: start % tileSizeBytes === 0 && endExclusive % tileSizeBytes === 0,
    declaredTileCount: Number(coverage?.declaredTileCount || Number(region.size || 0) / tileSizeBytes),
    combinedSourceFamilies: (coverage?.combinedSourceFamilies || []).slice().sort(),
    combinedSourceFamilyCount: Number(coverage?.combinedSourceFamilyCount || 0),
    sourceRangeCount: Number(coverage?.sourceRangeCount || 0),
    mergedSourceSpanCount: Number(coverage?.mergedSourceSpanCount || 0),
    uniqueReferencedTiles: Number(coverage?.uniqueReferencedTiles || 0),
    uniqueReferencedBytes: Number(coverage?.uniqueReferencedBytes || 0),
    coveragePercent: Number(coverage?.coveragePercent || 0),
    unreferencedSpanCount: Number(coverage?.unreferencedSpanCount || 0),
    unreferencedTiles: Number(coverage?.unreferencedTiles || 0),
    unreferencedBytes: Number(coverage?.unreferencedBytes || 0),
    sourceSpans,
    unreferencedSpans,
    sourceFamilies: sourceFamilySummary(coverage?.familyContributors || []),
    remainingLead: remainingGroup ? {
      spanCount: Number(remainingGroup.spanCount || 0),
      nonblankTileCount: Number(remainingGroup.nonblankTileCount || 0),
      priorityScore: Number(remainingGroup.priorityScore || 0),
      classificationCounts: remainingGroup.classificationCounts || {},
      priorityGroupCounts: remainingGroup.priorityGroupCounts || {},
      topSpans: (remainingGroup.topSpans || []).slice(0, 6),
    } : null,
    topRemainingEntries: remainingEntries.slice(0, 6).map(entry => ({
      spanId: entry.spanId,
      start: entry.start,
      endExclusive: entry.endExclusive,
      sizeBytes: Number(entry.sizeBytes || 0),
      nonblankTileCount: Number(entry.nonblankTileCount || 0),
      priorityScore: Number(entry.priorityScore || 0),
      classification: entry.classification || null,
      sourceWordCounts: entry.sourceWordCounts || null,
      resolver: entry.resolver || null,
    })),
    role: role.role,
    confidence: role.confidence,
    priorityGroup: role.priorityGroup,
    reason: role.reason,
    evidenceRefs: [
      {
        catalogId: combinedCoverageCatalogId,
        kind: 'combined_graphics_source_coverage',
        regionId: region.id,
        present: Boolean(coverage),
      },
      {
        catalogId: remainingLeadCatalogId,
        kind: 'graphics_remaining_lead_reconciliation',
        regionId: region.id,
        present: Boolean(remainingGroup),
      },
    ],
  };
}

function validateLayout(layout, mapData) {
  const issues = [];
  const start = offsetOf(layout.declaredSpan.start);
  const endExclusive = offsetOf(layout.declaredSpan.endExclusive);
  let cursor = start;

  for (const segment of layout.segments) {
    const region = regionById(mapData, segment.region.id);
    const regionStartOffset = regionStart(region);
    const regionEndOffset = regionEnd(region);
    if (regionStartOffset > cursor) {
      issues.push({
        severity: 'warning',
        kind: 'graphics_incbin_layout_gap',
        incbinSpanId: layout.incbinSpanId,
        start: hex(cursor),
        endExclusive: hex(regionStartOffset),
      });
    }
    if (region?.type !== 'gfx_tiles') {
      issues.push({
        severity: 'warning',
        kind: 'graphics_incbin_non_graphics_region',
        incbinSpanId: layout.incbinSpanId,
        region: compactRegion(region),
      });
    }
    if (!segment.tileAligned) {
      issues.push({
        severity: 'warning',
        kind: 'graphics_incbin_segment_not_tile_aligned',
        incbinSpanId: layout.incbinSpanId,
        region: segment.region,
      });
    }
    if (!segment.evidenceRefs.find(ref => ref.catalogId === combinedCoverageCatalogId)?.present) {
      issues.push({
        severity: 'warning',
        kind: 'graphics_incbin_segment_missing_combined_coverage',
        incbinSpanId: layout.incbinSpanId,
        region: segment.region,
      });
    }
    cursor = Math.max(cursor, regionEndOffset);
  }

  if (cursor < endExclusive) {
    issues.push({
      severity: 'warning',
      kind: 'graphics_incbin_layout_gap',
      incbinSpanId: layout.incbinSpanId,
      start: hex(cursor),
      endExclusive: hex(endExclusive),
    });
  }

  return issues;
}

function buildLayout(mapData, incbinEntry, indexes) {
  const start = offsetOf(incbinEntry.declaredSpan.start);
  const endExclusive = offsetOf(incbinEntry.declaredSpan.endExclusive);
  const regions = overlappingRegions(mapData, start, endExclusive).filter(region => region.type === 'gfx_tiles');
  const segments = regions.map((region, index) => segmentEntry(region, start, index, indexes));
  const validationIssues = [];
  const layout = {
    id: `${incbinEntry.id}-combined-graphics-layout`,
    incbinSpanId: incbinEntry.id,
    asmLine: incbinEntry.asmLine,
    bank: incbinEntry.bank,
    declaredSpan: incbinEntry.declaredSpan,
    sourceRegion: incbinEntry.sourceRegion,
    coverageStatus: incbinEntry.coverageStatus,
    segmentCount: segments.length,
    bySegmentRole: countBy(segments, segment => segment.role),
    byPriorityGroup: countBy(segments, segment => segment.priorityGroup),
    combinedSourceFamilies: [...new Set(segments.flatMap(segment => segment.combinedSourceFamilies))].sort(),
    referencedTileCount: Number(segments.reduce((sum, segment) => sum + segment.uniqueReferencedTiles, 0).toFixed(4)),
    unreferencedTileCount: Number(segments.reduce((sum, segment) => sum + segment.unreferencedTiles, 0).toFixed(4)),
    remainingNonblankTileCount: Number(segments.reduce((sum, segment) => sum + Number(segment.remainingLead?.nonblankTileCount || 0), 0).toFixed(4)),
    remainingPriorityScore: Number(segments.reduce((sum, segment) => sum + Number(segment.remainingLead?.priorityScore || 0), 0).toFixed(4)),
    segments,
    validationIssues,
    evidence: [
      `Source ASM .incbin span comes from ${sourceIncbinCatalogId}.`,
      `Source coverage comes from ${combinedCoverageCatalogId}, which merges static loader, fixed 998-entrypoint, dynamic entity, and status tile source families.`,
      `Remaining lead priority comes from ${remainingLeadCatalogId}.`,
      'This layout stores offsets, counts, region ids, source-family names, and evidence references only; no ROM bytes, decoded graphics, screenshots, or rendered tiles are embedded.',
    ],
  };
  layout.validationIssues.push(...validateLayout(layout, mapData));
  return layout;
}

function buildCatalog(mapData) {
  const incbinCatalog = requireCatalog(mapData, sourceIncbinCatalogId);
  const combinedCoverageCatalog = requireCatalog(mapData, combinedCoverageCatalogId);
  const remainingLeadCatalog = requireCatalog(mapData, remainingLeadCatalogId);
  const indexes = buildIndexes(combinedCoverageCatalog, remainingLeadCatalog);
  const graphicsEntries = (incbinCatalog.entries || [])
    .filter(entry => entry.assetFamily === 'graphics_tile_banks');
  const layouts = graphicsEntries.map(entry => buildLayout(mapData, entry, indexes));
  const segments = layouts.flatMap(layout => layout.segments.map(segment => ({
    ...segment,
    incbinSpanId: layout.incbinSpanId,
  })));
  const topUnresolvedSegments = segments
    .filter(segment => Number(segment.remainingLead?.nonblankTileCount || 0) > 0 || Number(segment.unreferencedTiles || 0) > 0)
    .sort((a, b) => Number(b.remainingLead?.priorityScore || 0) - Number(a.remainingLead?.priorityScore || 0)
      || Number(b.remainingLead?.nonblankTileCount || 0) - Number(a.remainingLead?.nonblankTileCount || 0)
      || offsetOf(a.region.offset) - offsetOf(b.region.offset))
    .slice(0, 12)
    .map(segment => ({
      incbinSpanId: segment.incbinSpanId,
      region: segment.region,
      role: segment.role,
      priorityGroup: segment.priorityGroup,
      coveragePercent: segment.coveragePercent,
      unreferencedTiles: segment.unreferencedTiles,
      remainingLead: segment.remainingLead ? {
        spanCount: segment.remainingLead.spanCount,
        nonblankTileCount: segment.remainingLead.nonblankTileCount,
        priorityScore: segment.remainingLead.priorityScore,
        priorityGroupCounts: segment.remainingLead.priorityGroupCounts,
        topSpans: segment.remainingLead.topSpans,
      } : null,
    }));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceIncbinCatalogId, combinedCoverageCatalogId, remainingLeadCatalogId],
    assetPolicy: 'Metadata only: ASM span ids, offsets, region ids/types, tile counts, source-family names, lead classifications, and evidence references. No ROM bytes, decoded tiles, rendered graphics, screenshots, audio, text payloads, or gameplay constants are embedded.',
    summary: {
      graphicsIncbinSpanCount: layouts.length,
      segmentCount: segments.length,
      byCoverageStatus: countBy(layouts, layout => layout.coverageStatus),
      bySegmentRole: countBy(segments, segment => segment.role),
      byPriorityGroup: countBy(segments, segment => segment.priorityGroup),
      combinedSourceFamilies: [...new Set(segments.flatMap(segment => segment.combinedSourceFamilies))].sort(),
      referencedTileCount: Number(segments.reduce((sum, segment) => sum + segment.uniqueReferencedTiles, 0).toFixed(4)),
      unreferencedTileCount: Number(segments.reduce((sum, segment) => sum + segment.unreferencedTiles, 0).toFixed(4)),
      remainingNonblankTileCount: Number(segments.reduce((sum, segment) => sum + Number(segment.remainingLead?.nonblankTileCount || 0), 0).toFixed(4)),
      validationIssueCount: layouts.reduce((sum, layout) => sum + layout.validationIssues.length, 0),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    layouts,
    validationIssues: layouts.flatMap(layout => layout.validationIssues),
    topUnresolvedSegments,
    evidence: [
      'The source incbin audit identifies the declared graphics tile banks from ASM .incbin spans.',
      'Combined source coverage supplies current confirmed tile-source families and merged source/unreferenced spans.',
      'Remaining lead reconciliation supplies the current next trace class for unresolved nonblank spans.',
      'No ROM payload bytes or decoded assets are read or stored by this audit.',
    ],
    nextLeads: [
      'Start with topUnresolvedSegments whose priority group is trace_direct_copy_or_decompression; those are no longer credible static-loader-table leads.',
      'Use each segment sourceSpans/unreferencedSpans list to inspect exact source islands around unresolved gaps in the analyzer.',
      'After tracing a new consumer family, add it to the combined source coverage audit and rerun this layout to shrink remainingNonblankTileCount.',
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
      region.analysis.graphicsCombinedIncbinLayoutAudit = {
        catalogId,
        kind: 'graphics_combined_incbin_segment',
        incbinSpanId: layout.incbinSpanId,
        segmentIndex: segment.index,
        role: segment.role,
        confidence: segment.confidence,
        priorityGroup: segment.priorityGroup,
        declaredSpan: layout.declaredSpan,
        spanRelativeRange: segment.spanRelativeRange,
        combinedSourceFamilies: segment.combinedSourceFamilies,
        coveragePercent: segment.coveragePercent,
        uniqueReferencedTiles: segment.uniqueReferencedTiles,
        unreferencedSpanCount: segment.unreferencedSpanCount,
        unreferencedTiles: segment.unreferencedTiles,
        remainingNonblankTileCount: Number(segment.remainingLead?.nonblankTileCount || 0),
        remainingPriorityScore: Number(segment.remainingLead?.priorityScore || 0),
        remainingPriorityGroupCounts: segment.remainingLead?.priorityGroupCounts || {},
        topRemainingSpans: segment.remainingLead?.topSpans || [],
        sourceSpans: segment.sourceSpans,
        unreferencedSpans: segment.unreferencedSpans,
        summary: `${segment.region.id} is segment ${segment.index} of graphics incbin span ${layout.incbinSpanId}: ${segment.role}.`,
        evidenceRefs: segment.evidenceRefs,
        evidence: [
          `Segment belongs to ASM .incbin span ${layout.incbinSpanId}.`,
          segment.reason,
          `Combined coverage source: ${combinedCoverageCatalogId}.`,
          `Remaining lead source: ${remainingLeadCatalogId}.`,
          'Metadata-only audit; no ROM bytes, decoded graphics, pixels, screenshots, or rendered tiles are embedded.',
        ],
        generatedAt: now,
        tool: toolName,
      };
      annotated.push({
        region: compactRegion(region),
        incbinSpanId: layout.incbinSpanId,
        segmentIndex: segment.index,
        role: segment.role,
        priorityGroup: segment.priorityGroup,
        coveragePercent: segment.coveragePercent,
        unreferencedTiles: segment.unreferencedTiles,
        remainingNonblankTileCount: Number(segment.remainingLead?.nonblankTileCount || 0),
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
      type: 'graphics_combined_incbin_layout_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      validationIssues: catalog.validationIssues,
      topUnresolvedSegments: catalog.topUnresolvedSegments,
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
    validationIssues: catalog.validationIssues,
    topUnresolvedSegments: catalog.topUnresolvedSegments.slice(0, 8),
    layouts: catalog.layouts.map(layout => ({
      incbinSpanId: layout.incbinSpanId,
      declaredSpan: layout.declaredSpan,
      segmentCount: layout.segmentCount,
      bySegmentRole: layout.bySegmentRole,
      byPriorityGroup: layout.byPriorityGroup,
      referencedTileCount: layout.referencedTileCount,
      unreferencedTileCount: layout.unreferencedTileCount,
      remainingNonblankTileCount: layout.remainingNonblankTileCount,
    })),
  }, null, 2));
}

main();
