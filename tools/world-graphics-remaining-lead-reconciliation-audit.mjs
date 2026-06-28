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
const toolName = 'tools/world-graphics-remaining-lead-reconciliation-audit.mjs';
const shapeCatalogId = 'world-graphics-combined-unreferenced-shape-catalog-2026-06-26';
const sourceWordCatalogId = 'world-graphics-untraced-source-word-catalog-2026-06-26';
const resolverCatalogId = 'world-graphics-loader-like-word-hit-resolver-catalog-2026-06-26';
const partialLoaderCatalogId = 'world-vram-loader-partial-consumption-catalog-2026-06-26';
const catalogId = 'world-graphics-remaining-lead-reconciliation-catalog-2026-06-26';
const reportId = 'graphics-remaining-lead-reconciliation-audit-2026-06-26';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 16);
  return NaN;
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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function resolverBySpan(resolverCatalog) {
  const bySpan = new Map();
  for (const resolution of resolverCatalog.resolutions || []) {
    const spanId = resolution.target?.spanId;
    if (!spanId) continue;
    if (!bySpan.has(spanId)) bySpan.set(spanId, []);
    bySpan.get(spanId).push(resolution);
  }
  return bySpan;
}

function classifyLead(shapeSpan, sourceSpan, resolutions) {
  const shapeKind = shapeSpan.classification?.kind || 'unknown';
  if (shapeKind === 'all_blank_padding_candidate') {
    return {
      kind: 'blank_padding_low_priority',
      confidence: 'high',
      priorityGroup: 'padding_or_shape_low_priority',
      reason: 'Shape audit classifies the span as all blank padding.',
    };
  }
  if (shapeKind === 'adjacent_duplicate_candidate') {
    return {
      kind: 'adjacent_duplicate_low_priority',
      confidence: 'medium_high',
      priorityGroup: 'padding_or_shape_low_priority',
      reason: 'Shape audit classifies the span as adjacent duplicate tile data.',
    };
  }
  if (!sourceSpan) {
    return {
      kind: 'shape_only_non_source_word_target',
      confidence: 'medium',
      priorityGroup: 'shape_only_followup',
      reason: 'The span exists in the remaining shape catalog but was not a nonblank target in the source-word audit.',
    };
  }

  const sourceCounts = sourceSpan.classificationCounts || {};
  const resolutionCounts = countBy(resolutions, item => item.resolutionKind);
  const loaderLikeTiles = sourceSpan.loaderLikeTileCount || 0;
  const unresolvedResolverHits = (resolutionCounts.loader_like_region_unparsed_word_hit || 0)
    + (resolutionCounts.parsed_source_field_already_covers_target || 0)
    + (resolutionCounts.parsed_source_field_same_start_but_not_covered || 0)
    + (resolutionCounts.parsed_source_field_for_different_source || 0);
  const resolvedNonSourceHits = (resolutionCounts.static_loader_record_non_source_word_overlap || 0)
    + (resolutionCounts.dynamic_loader_record_non_source_word_overlap || 0);

  if (loaderLikeTiles > 0 && unresolvedResolverHits === 0 && resolvedNonSourceHits > 0) {
    return {
      kind: 'loader_like_hits_resolved_non_source_overlap',
      confidence: 'medium_high',
      priorityGroup: 'trace_direct_copy_or_decompression',
      reason: 'Raw loader-like source-word hits exist, but the resolver maps all of them to parsed non-source fields.',
    };
  }

  if ((sourceCounts.no_encoded_source_word_hits || 0) === (sourceSpan.nonblankTileCount || 0)) {
    return {
      kind: 'no_encoded_source_word_hits',
      confidence: 'medium_high',
      priorityGroup: 'trace_direct_copy_or_decompression',
      reason: 'No encoded source-word occurrence exists for any nonblank tile in this remaining span.',
    };
  }

  if (sourceCounts.asm_literal_source_word_hit_non_loader_context) {
    return {
      kind: 'asm_literal_non_loader_context',
      confidence: 'low',
      priorityGroup: 'inspect_asm_literals',
      reason: 'At least one encoded source word appears as an ASM literal, but not in a confirmed source field.',
    };
  }

  if (sourceCounts.non_loader_source_word_shape_hits_only) {
    return {
      kind: 'non_loader_word_shape_hits_only',
      confidence: 'low',
      priorityGroup: 'trace_non_loader_occurrences',
      reason: 'Encoded source-word-shaped hits exist only outside parsed loader source fields.',
    };
  }

  return {
    kind: 'mixed_or_unknown_source_word_lead',
    confidence: 'low',
    priorityGroup: 'manual_review',
    reason: 'The source-word and resolver evidence does not reduce this span to a stronger class.',
  };
}

function buildSpanEntry(shapeSpan, sourceSpan, resolutions) {
  const classification = classifyLead(shapeSpan, sourceSpan, resolutions);
  const resolutionCounts = countBy(resolutions, item => item.resolutionKind);
  const nonblankTileCount = shapeSpan.shapeStats?.nonblankTileCount || sourceSpan?.nonblankTileCount || 0;
  return {
    id: `${shapeSpan.id}_remaining_lead`,
    spanId: shapeSpan.id,
    region: shapeSpan.region,
    start: shapeSpan.start,
    endExclusive: shapeSpan.endExclusive,
    sizeBytes: shapeSpan.sizeBytes,
    tileCount: shapeSpan.tileCount,
    nonblankTileCount,
    shapeClassification: shapeSpan.classification || null,
    sourceWordStatus: sourceSpan?.status || null,
    sourceWordCounts: sourceSpan ? {
      rawHitTileCount: sourceSpan.rawHitTileCount || 0,
      loaderLikeTileCount: sourceSpan.loaderLikeTileCount || 0,
      asmLiteralTileCount: sourceSpan.asmLiteralTileCount || 0,
      classificationCounts: sourceSpan.classificationCounts || {},
    } : null,
    resolver: {
      occurrenceCount: resolutions.length,
      resolutionCounts,
      unparsedLoaderLikeHitCount: resolutionCounts.loader_like_region_unparsed_word_hit || 0,
      parsedSourceFieldHitCount: (resolutionCounts.parsed_source_field_already_covers_target || 0)
        + (resolutionCounts.parsed_source_field_same_start_but_not_covered || 0)
        + (resolutionCounts.parsed_source_field_for_different_source || 0),
      nonSourceOverlapCount: (resolutionCounts.static_loader_record_non_source_word_overlap || 0)
        + (resolutionCounts.dynamic_loader_record_non_source_word_overlap || 0),
    },
    classification,
    priorityScore: (nonblankTileCount * 10)
      + (classification.priorityGroup === 'trace_direct_copy_or_decompression' ? 100 : 0)
      + (classification.kind === 'loader_like_hits_resolved_non_source_overlap' ? 50 : 0)
      + (sourceSpan?.rawHitTileCount || 0),
    evidence: [
      `Derived from ${shapeCatalogId}, ${sourceWordCatalogId}, and ${resolverCatalogId}.`,
      classification.reason,
      'Resolver evidence supersedes raw loader-like source-word hits when all such hits are parsed non-source overlaps.',
      'No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.',
    ],
  };
}

function summarizeRegions(entries) {
  const byRegion = new Map();
  for (const entry of entries) {
    const region = entry.region;
    if (!byRegion.has(region.id)) {
      byRegion.set(region.id, {
        region,
        spanCount: 0,
        sizeBytes: 0,
        tileCount: 0,
        nonblankTileCount: 0,
        priorityScore: 0,
        classificationCounts: {},
        priorityGroupCounts: {},
        topSpans: [],
      });
    }
    const group = byRegion.get(region.id);
    group.spanCount++;
    group.sizeBytes += entry.sizeBytes || 0;
    group.tileCount += entry.tileCount || 0;
    group.nonblankTileCount += entry.nonblankTileCount || 0;
    group.priorityScore += entry.priorityScore || 0;
    group.classificationCounts[entry.classification.kind] = (group.classificationCounts[entry.classification.kind] || 0) + 1;
    group.priorityGroupCounts[entry.classification.priorityGroup] = (group.priorityGroupCounts[entry.classification.priorityGroup] || 0) + 1;
    group.topSpans.push({
      spanId: entry.spanId,
      start: entry.start,
      endExclusive: entry.endExclusive,
      sizeBytes: entry.sizeBytes,
      nonblankTileCount: entry.nonblankTileCount,
      classification: entry.classification,
      priorityScore: entry.priorityScore,
    });
  }
  return [...byRegion.values()].map(group => ({
    ...group,
    topSpans: group.topSpans
      .sort((a, b) => b.priorityScore - a.priorityScore || offsetOf(a.start) - offsetOf(b.start))
      .slice(0, 5),
  })).sort((a, b) => b.priorityScore - a.priorityScore || offsetOf(a.region.offset) - offsetOf(b.region.offset));
}

function buildCatalog(mapData) {
  const shapeCatalog = requireCatalog(mapData, shapeCatalogId);
  const sourceWordCatalog = requireCatalog(mapData, sourceWordCatalogId);
  const resolverCatalog = requireCatalog(mapData, resolverCatalogId);
  const partialLoaderCatalog = findCatalog(mapData, partialLoaderCatalogId);
  const sourceSpansById = new Map((sourceWordCatalog.spans || []).map(span => [span.id, span]));
  const resolutionsBySpan = resolverBySpan(resolverCatalog);
  const entries = (shapeCatalog.spans || []).map(shapeSpan => buildSpanEntry(
    shapeSpan,
    sourceSpansById.get(shapeSpan.id) || null,
    resolutionsBySpan.get(shapeSpan.id) || [],
  ));
  const regions = summarizeRegions(entries);
  const summary = {
    shapeCatalogId,
    sourceWordCatalogId,
    resolverCatalogId,
    partialLoaderCatalogId: partialLoaderCatalog ? partialLoaderCatalogId : null,
    remainingSpanCount: entries.length,
    nonblankSpanCount: entries.filter(entry => entry.nonblankTileCount > 0).length,
    blankOrLowPrioritySpanCount: entries.filter(entry => entry.classification.priorityGroup === 'padding_or_shape_low_priority').length,
    classificationCounts: countBy(entries, entry => entry.classification.kind),
    priorityGroupCounts: countBy(entries, entry => entry.classification.priorityGroup),
    loaderLikeResolvedNonSourceSpanCount: entries.filter(entry => entry.classification.kind === 'loader_like_hits_resolved_non_source_overlap').length,
    unparsedLoaderLikeHitCount: entries.reduce((sum, entry) => sum + entry.resolver.unparsedLoaderLikeHitCount, 0),
    parsedSourceFieldHitCount: entries.reduce((sum, entry) => sum + entry.resolver.parsedSourceFieldHitCount, 0),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    assetPolicy: 'Metadata only: span offsets, tile counts, source-word counts, resolver classifications, priority groups, and catalog ids. No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [shapeCatalogId, sourceWordCatalogId, resolverCatalogId, partialLoaderCatalog ? partialLoaderCatalogId : null].filter(Boolean),
    summary,
    regions,
    entries,
    topLeads: entries
      .filter(entry => entry.nonblankTileCount > 0)
      .sort((a, b) => b.priorityScore - a.priorityScore || offsetOf(a.start) - offsetOf(b.start))
      .slice(0, 16)
      .map(entry => ({
        spanId: entry.spanId,
        region: entry.region,
        start: entry.start,
        endExclusive: entry.endExclusive,
        sizeBytes: entry.sizeBytes,
        nonblankTileCount: entry.nonblankTileCount,
        classification: entry.classification,
        priorityScore: entry.priorityScore,
        sourceWordCounts: entry.sourceWordCounts,
        resolver: entry.resolver,
      })),
    evidence: [
      'This audit reconciles raw source-word lead classes with parsed loader-like word-hit resolver results.',
      'Resolved loader-like word hits are not promoted to source coverage and are not left as unresolved loader-table leads.',
      'Partial loader residuals are resolved separately by the VRAM loader partial-consumption catalog when available.',
      'No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.',
    ],
    nextLeads: [
      'Prioritize trace_direct_copy_or_decompression spans over loader-table searches because all loader-like hits are resolved as non-source overlaps.',
      'Inspect the largest r2645/r2656/r0758 spans for decompression/direct VDP copy consumers and non-loader source-word-shaped references.',
      'Use topLeads as the next graphics-source queue until new source families are confirmed.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  for (const group of catalog.regions) {
    const region = findRegionById(mapData, group.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.graphicsRemainingLeadReconciliationAudit = {
      catalogId,
      kind: 'graphics_remaining_lead_reconciliation',
      confidence: group.priorityGroupCounts.manual_review ? 'medium' : 'medium_high',
      spanCount: group.spanCount,
      sizeBytes: group.sizeBytes,
      tileCount: group.tileCount,
      nonblankTileCount: group.nonblankTileCount,
      priorityScore: group.priorityScore,
      classificationCounts: group.classificationCounts,
      priorityGroupCounts: group.priorityGroupCounts,
      topSpans: group.topSpans,
      summary: `${group.spanCount} remaining graphics span(s) reconciled against source-word and loader-like resolver evidence.`,
      evidence: [
        `Derived from ${catalogId}; resolver statuses supersede raw loader-like source-word leads.`,
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
      nonblankTileCount: group.nonblankTileCount,
      priorityGroupCounts: group.priorityGroupCounts,
    });
  }
  return annotatedRegions;
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : catalog.regions.map(group => ({
    id: group.region.id,
    offset: group.region.offset,
    name: group.region.name || '',
    spanCount: group.spanCount,
    nonblankTileCount: group.nonblankTileCount,
    priorityGroupCounts: group.priorityGroupCounts,
  }));

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_remaining_lead_reconciliation_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      annotatedRegions,
      topLeads: catalog.topLeads,
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
    topLeads: catalog.topLeads,
  }, null, 2));
}

main();
