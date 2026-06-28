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
const toolName = 'tools/world-graphics-structured-lead-final-triage-audit.mjs';
const catalogId = 'world-graphics-structured-lead-final-triage-catalog-2026-06-26';
const reportId = 'graphics-structured-lead-final-triage-audit-2026-06-26';
const schemaVersion = 1;

const structuredCatalogId = 'world-graphics-structured-source-occurrence-catalog-2026-06-26';
const remainingLeadCatalogId = 'world-graphics-remaining-lead-reconciliation-catalog-2026-06-26';
const combinedCoverageCatalogId = 'world-graphics-combined-source-coverage-catalog-2026-06-26';
const boundaryCollisionCatalogId = 'world-bank2-vdp-residual-draw-boundary-collision-catalog-2026-06-26';
const playerA48GapCatalogId = 'world-player-a48-gap-candidate-catalog-2026-06-26';
const bank7SidecarCatalogId = 'world-bank7-pre-sequence-sidecar-catalog-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  return typeof value === 'string' ? parseInt(value, 16) : NaN;
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function sumBy(items, valueFn) {
  return items.reduce((sum, item) => sum + valueFn(item), 0);
}

function topCounts(counts, limit = 12) {
  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
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

function optionalCatalog(mapData, id) {
  return findCatalog(mapData, id);
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function compactOccurrence(occurrence) {
  const context = occurrence.resolvedContext || {};
  return {
    occurrenceOffset: occurrence.occurrenceOffset,
    sourceWord: occurrence.sourceWord,
    sourceRegion: occurrence.sourceRegion,
    targetSpanId: occurrence.targetSpanId,
    targetTileOffset: occurrence.targetTileOffset,
    targetRegion: occurrence.targetRegion,
    resolvedContextKind: context.kind || '',
    resolvedContextDisposition: context.disposition || '',
    parserRole: context.parserRole || '',
    sourceCatalogId: context.sourceCatalogId || '',
    confidence: context.confidence || 'low',
  };
}

function classifyNonKnownOccurrence(occurrence, contextCatalogs) {
  const context = occurrence.resolvedContext || {};
  const kind = context.kind || 'missing_context';
  const sourceRegion = occurrence.sourceRegion || {};
  const targetRegion = occurrence.targetRegion || {};
  const base = {
    occurrence: compactOccurrence(occurrence),
    evidenceCatalogs: [context.sourceCatalogId].filter(Boolean),
    contributesGraphicsSourceCoverage: false,
    sourceFamilyPromotionAllowed: false,
  };

  if (kind === 'bank2_vdp_stream_gap_draw_terminator_boundary_overlap'
    || kind === 'bank2_vdp_stream_gap_tail_draw_terminator_boundary_overlap') {
    return {
      ...base,
      finalDisposition: 'rejected_vdp_draw_terminator_boundary_artifact',
      confidence: 'medium',
      priority: 'deprioritize_raw_source_word_hit',
      reason: 'The word-shaped hit crosses a VDP draw terminator boundary in a candidate stream and is already classified as a decoder-boundary artifact.',
      evidenceCatalogs: [...base.evidenceCatalogs, boundaryCollisionCatalogId],
    };
  }

  if (kind === 'bank2_vdp_stream_gap_prefix_nested_tail_draw_candidate_overlap'
    || kind === 'bank2_vdp_stream_gap_exact_nested_tail_draw_candidate_overlap') {
    return {
      ...base,
      finalDisposition: 'candidate_vdp_nested_draw_payload_without_pointer_producer',
      confidence: context.confidence === 'medium' ? 'medium' : 'low',
      priority: 'needs_confirmed_vdp_pointer_list_producer_before_coverage',
      reason: 'The hit is inside a nested VDP draw-segment candidate, but no confirmed pointer-list producer currently promotes that candidate as graphics source coverage.',
      gapClass: context.gapClass || '',
      gapRange: context.gapInterval ? {
        start: context.gapInterval.start,
        endExclusive: context.gapInterval.endExclusive,
        size: context.gapInterval.size,
      } : null,
      candidateRange: context.tailCandidateRange || context.candidateConsumedRange || null,
      evidenceCatalogs: [...base.evidenceCatalogs, boundaryCollisionCatalogId],
    };
  }

  if (kind === 'bank2_vdp_stream_gap_object_list_sequence_candidate_overlap') {
    return {
      ...base,
      finalDisposition: 'candidate_vdp_object_list_payload_without_consumer',
      confidence: 'low',
      priority: 'needs_confirmed_object_list_consumer_before_coverage',
      reason: 'The hit is inside an object-list-shaped bank-2 VDP residual gap; object-list payload context does not prove graphics source coverage.',
      gapClass: context.gapClass || '',
      gapRange: context.gapInterval ? {
        start: context.gapInterval.start,
        endExclusive: context.gapInterval.endExclusive,
        size: context.gapInterval.size,
      } : null,
    };
  }

  if (kind === 'player_a48_gap_candidate_record_field_overlap') {
    return {
      ...base,
      finalDisposition: 'candidate_player_a48_gap_stream_without_pointer_reference',
      confidence: context.confidence === 'medium' ? 'medium' : 'low',
      priority: 'needs_player_command_or_variant_pointer_before_coverage',
      reason: 'The hit overlaps a shape-valid player _LABEL_A48_ gap-candidate stream, but the candidate has no known player command pointer reference.',
      a48GapCandidateId: context.a48GapCandidateId || '',
      a48GapCandidateRange: context.a48GapCandidateRange || null,
      hasKnownPointerReference: Boolean(context.hasKnownPointerReference),
      evidenceCatalogs: [...base.evidenceCatalogs, playerA48GapCatalogId],
    };
  }

  if (kind === 'tile_map_palette_tail_byte_grid_row_boundary_word_artifact') {
    return {
      ...base,
      finalDisposition: 'rejected_tile_map_row_boundary_word_artifact',
      confidence: 'medium',
      priority: 'deprioritize_raw_source_word_hit',
      reason: 'The word-shaped hit is formed by adjacent one-byte cells crossing a tile-map row boundary, not by a two-byte graphics source field.',
      tableRange: context.tableRange || null,
    };
  }

  if (kind === 'data_table_rejected_8fb_loader_candidate_field_overlap') {
    return {
      ...base,
      finalDisposition: 'rejected_bank7_alias_8fb_loader_candidate',
      confidence: 'medium',
      priority: 'do_not_promote_without_direct_bank7_consumer',
      reason: 'The hit overlaps an 8FB-shaped candidate rejected by bank-context evidence; the loader-adjacent banked address aliases another bank and no direct bank-7 consumer is confirmed.',
      candidatePromotionAllowed: Boolean(context.candidatePromotionAllowed),
      candidateConsumerStatus: context.candidateConsumerStatus || '',
      candidateSourceRange: context.candidateSourceRange || null,
      directCandidateAsmRefCount: context.directCandidateAsmRefCount || 0,
      aliasCount: context.aliasCount || 0,
      evidenceCatalogs: [...base.evidenceCatalogs, bank7SidecarCatalogId],
    };
  }

  return {
    ...base,
    finalDisposition: 'unresolved_structured_source_word_context',
    confidence: 'low',
    priority: 'manual_trace_required',
    reason: `No final triage rule exists for structured occurrence context ${kind}.`,
    sourceRegionType: sourceRegion.type || 'unknown',
    targetRegionId: targetRegion.id || '',
    contextCatalogsAvailable: Object.fromEntries(Object.entries(contextCatalogs).map(([id, catalog]) => [id, Boolean(catalog)])),
  };
}

function classifyTargetSpan(span, occurrences) {
  const nonKnown = occurrences.filter(item => item.triage.finalDisposition !== 'known_parser_field_overlap');
  const sourceCoverageContributors = occurrences.filter(item => item.triage.contributesGraphicsSourceCoverage);
  const candidateNeedsConsumer = nonKnown.filter(item => item.triage.finalDisposition.startsWith('candidate_'));
  const rejected = nonKnown.filter(item => item.triage.finalDisposition.startsWith('rejected_'));
  let finalDisposition = 'structured_hits_explained_or_disqualified_no_source_coverage';
  let confidence = 'medium';
  let priority = 'trace_direct_copy_decompression_or_scene_specific_loader';
  let reason = 'Every structured source-word-shaped hit is explained by a known parser field, rejected as an artifact, or left as a candidate that lacks a confirmed consumer.';

  if (sourceCoverageContributors.length) {
    finalDisposition = 'has_confirmed_structured_source_coverage';
    confidence = 'high';
    priority = 'update_combined_graphics_source_coverage';
    reason = 'At least one structured hit is a confirmed graphics source coverage contributor.';
  } else if (candidateNeedsConsumer.length && !rejected.length) {
    finalDisposition = 'only_unconfirmed_candidate_structured_payload_hits';
    confidence = 'low';
    priority = 'trace_real_consumer_before_coverage';
    reason = 'The remaining structured hits are candidate payload contexts only; none has confirmed runtime producer evidence.';
  } else if (candidateNeedsConsumer.length && rejected.length) {
    finalDisposition = 'mixed_rejected_and_unconfirmed_candidate_structured_hits';
    confidence = 'low';
    priority = 'trace_real_consumer_before_coverage';
    reason = 'The remaining structured hits are a mix of rejected artifacts and candidate payload contexts without confirmed producer evidence.';
  }

  return {
    spanId: span.spanId || span.id,
    targetRegion: span.targetRegion || span.region,
    targetSpanRange: span.targetSpanRange || {
      start: span.start,
      endExclusive: span.endExclusive,
    },
    occurrenceCount: occurrences.length,
    nonKnownOccurrenceCount: nonKnown.length,
    knownParserFieldOverlapCount: occurrences.length - nonKnown.length,
    finalDisposition,
    confidence,
    priority,
    reason,
    finalDispositionCounts: countBy(occurrences, item => item.triage.finalDisposition),
    sourceRegionCounts: countBy(occurrences, item => item.occurrence.sourceRegion?.id || 'unknown'),
    sourceRegionTypeCounts: countBy(occurrences, item => item.occurrence.sourceRegion?.type || 'unknown'),
    nonKnownSamples: nonKnown.slice(0, 12).map(item => item.triage),
  };
}

function classifySourceRegion(region, occurrences) {
  const sourceCoverageContributors = occurrences.filter(item => item.triage.contributesGraphicsSourceCoverage);
  const candidateNeedsConsumer = occurrences.filter(item => item.triage.finalDisposition.startsWith('candidate_'));
  const rejected = occurrences.filter(item => item.triage.finalDisposition.startsWith('rejected_'));
  let finalDisposition = 'structured_source_hits_do_not_confirm_graphics_coverage';
  let confidence = candidateNeedsConsumer.length ? 'low' : 'medium';
  let priority = candidateNeedsConsumer.length ? 'trace_candidate_consumer_before_coverage' : 'deprioritize_raw_word_hits';
  if (sourceCoverageContributors.length) {
    finalDisposition = 'structured_source_region_confirms_graphics_coverage';
    confidence = 'high';
    priority = 'update_combined_graphics_source_coverage';
  }
  return {
    sourceRegion: region,
    occurrenceCount: occurrences.length,
    targetSpanCount: new Set(occurrences.map(item => item.occurrence.targetSpanId)).size,
    targetRegionCount: new Set(occurrences.map(item => item.occurrence.targetRegion?.id || '')).size,
    finalDisposition,
    confidence,
    priority,
    finalDispositionCounts: countBy(occurrences, item => item.triage.finalDisposition),
    targetSpanCounts: countBy(occurrences, item => item.occurrence.targetSpanId),
    candidateOccurrenceCount: candidateNeedsConsumer.length,
    rejectedOccurrenceCount: rejected.length,
    sourceCoverageContributorCount: sourceCoverageContributors.length,
    samples: occurrences.slice(0, 12).map(item => item.triage),
  };
}

function knownItem(occurrence) {
  return {
    occurrence: compactOccurrence(occurrence),
    triage: {
      occurrence: compactOccurrence(occurrence),
      finalDisposition: 'known_parser_field_overlap',
      confidence: occurrence.resolvedContext?.confidence || 'medium',
      priority: 'deprioritize_raw_source_word_hit',
      reason: 'Existing parser context already owns this source-word-shaped byte pair; it is not graphics source coverage evidence.',
      contributesGraphicsSourceCoverage: false,
      sourceFamilyPromotionAllowed: false,
      evidenceCatalogs: [occurrence.resolvedContext?.sourceCatalogId].filter(Boolean),
    },
  };
}

function buildCatalog(mapData) {
  const structuredCatalog = requireCatalog(mapData, structuredCatalogId);
  const remainingLeadCatalog = requireCatalog(mapData, remainingLeadCatalogId);
  const combinedCoverageCatalog = requireCatalog(mapData, combinedCoverageCatalogId);
  const contextCatalogs = {
    [boundaryCollisionCatalogId]: optionalCatalog(mapData, boundaryCollisionCatalogId),
    [playerA48GapCatalogId]: optionalCatalog(mapData, playerA48GapCatalogId),
    [bank7SidecarCatalogId]: optionalCatalog(mapData, bank7SidecarCatalogId),
  };

  const occurrenceItems = (structuredCatalog.occurrences || []).map(occurrence => {
    if (occurrence.resolvedContext?.disposition === 'known_structured_payload_field_overlap') {
      return knownItem(occurrence);
    }
    return {
      occurrence: compactOccurrence(occurrence),
      triage: classifyNonKnownOccurrence(occurrence, contextCatalogs),
    };
  });

  const bySpan = new Map();
  for (const item of occurrenceItems) {
    const spanId = item.occurrence.targetSpanId;
    if (!spanId) continue;
    if (!bySpan.has(spanId)) bySpan.set(spanId, []);
    bySpan.get(spanId).push(item);
  }
  const sourceSpanById = new Map((structuredCatalog.targetSpans || []).map(span => [span.spanId || span.id, span]));
  const remainingSpanById = new Map((remainingLeadCatalog.entries || []).map(entry => [entry.spanId, entry]));
  const targetSpans = [...bySpan.entries()].map(([spanId, items]) => {
    const span = sourceSpanById.get(spanId) || remainingSpanById.get(spanId) || { id: spanId };
    return classifyTargetSpan(span, items);
  }).sort((a, b) => b.nonKnownOccurrenceCount - a.nonKnownOccurrenceCount || String(a.spanId).localeCompare(String(b.spanId)));

  const nonKnownItems = occurrenceItems.filter(item => item.triage.finalDisposition !== 'known_parser_field_overlap');
  const bySourceRegion = new Map();
  for (const item of nonKnownItems) {
    const region = item.occurrence.sourceRegion;
    if (!region?.id) continue;
    if (!bySourceRegion.has(region.id)) bySourceRegion.set(region.id, { region, items: [] });
    bySourceRegion.get(region.id).items.push(item);
  }
  const sourceRegions = [...bySourceRegion.values()]
    .map(({ region, items }) => classifySourceRegion(region, items))
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || String(a.sourceRegion.id).localeCompare(String(b.sourceRegion.id)));

  const targetRegionGroups = new Map();
  for (const span of targetSpans) {
    const region = span.targetRegion;
    if (!region?.id) continue;
    if (!targetRegionGroups.has(region.id)) {
      targetRegionGroups.set(region.id, {
        targetRegion: region,
        spanCount: 0,
        occurrenceCount: 0,
        nonKnownOccurrenceCount: 0,
        finalDispositionCounts: {},
        priorityCounts: {},
        spans: [],
      });
    }
    const group = targetRegionGroups.get(region.id);
    group.spanCount++;
    group.occurrenceCount += span.occurrenceCount;
    group.nonKnownOccurrenceCount += span.nonKnownOccurrenceCount;
    group.finalDispositionCounts[span.finalDisposition] = (group.finalDispositionCounts[span.finalDisposition] || 0) + 1;
    group.priorityCounts[span.priority] = (group.priorityCounts[span.priority] || 0) + 1;
    group.spans.push({
      spanId: span.spanId,
      targetSpanRange: span.targetSpanRange,
      nonKnownOccurrenceCount: span.nonKnownOccurrenceCount,
      finalDisposition: span.finalDisposition,
      priority: span.priority,
    });
  }
  const targetRegions = [...targetRegionGroups.values()]
    .sort((a, b) => b.nonKnownOccurrenceCount - a.nonKnownOccurrenceCount || String(a.targetRegion.id).localeCompare(String(b.targetRegion.id)));

  const finalDispositionCounts = countBy(occurrenceItems, item => item.triage.finalDisposition);
  const nonKnownDispositionCounts = countBy(nonKnownItems, item => item.triage.finalDisposition);
  const sourceCoverageContributorCount = occurrenceItems.filter(item => item.triage.contributesGraphicsSourceCoverage).length;
  const promotionAllowedCount = occurrenceItems.filter(item => item.triage.sourceFamilyPromotionAllowed).length;
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      structuredCatalogId,
      remainingLeadCatalogId,
      combinedCoverageCatalogId,
      boundaryCollisionCatalogId,
      playerA48GapCatalogId,
      bank7SidecarCatalogId,
    ],
    summary: {
      structuredOccurrenceCount: occurrenceItems.length,
      knownParserFieldOverlapCount: finalDispositionCounts.known_parser_field_overlap || 0,
      nonKnownStructuredOccurrenceCount: nonKnownItems.length,
      finalDispositionCounts,
      nonKnownDispositionCounts,
      sourceCoverageContributorCount,
      promotionAllowedCount,
      sourceFamilyPromotionBlockedCount: nonKnownItems.length - promotionAllowedCount,
      targetSpanCount: targetSpans.length,
      targetSpanWithNonKnownCount: targetSpans.filter(span => span.nonKnownOccurrenceCount > 0).length,
      targetRegionCount: targetRegions.length,
      sourceRegionCount: sourceRegions.length,
      targetSpanFinalDispositionCounts: countBy(targetSpans, span => span.finalDisposition),
      targetSpanPriorityCounts: countBy(targetSpans, span => span.priority),
      sourceRegionFinalDispositionCounts: countBy(sourceRegions, region => region.finalDisposition),
      combinedGraphicsCoveragePercent: combinedCoverageCatalog.summary?.combinedCoveragePercent ?? null,
      combinedUnreferencedTileCount: combinedCoverageCatalog.summary?.unreferencedTiles ?? null,
      coverageChangedByThisAudit: false,
      assetPolicy: 'Metadata only: source/target offsets, parser-context classes, counts, region ids, and evidence labels. No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered assets are embedded.',
    },
    targetRegions,
    targetSpans,
    sourceRegions,
    nonKnownOccurrences: nonKnownItems.map(item => item.triage),
    evidence: [
      `${structuredCatalogId} supplies structured source-word-shaped occurrences for remaining unreferenced graphics spans.`,
      `${remainingLeadCatalogId} and ${combinedCoverageCatalogId} define the current unreferenced graphics work queue and baseline coverage.`,
      'Final dispositions here are trace-priority metadata only; no candidate is promoted to graphics source coverage without a confirmed runtime consumer.',
      'Known parser field overlaps, VDP terminator boundary artifacts, rejected bank-alias loader candidates, and row-boundary word artifacts are treated as non-source evidence.',
      'Player A48 and nested VDP draw candidates remain candidate payload contexts until a command pointer, variant selector, pointer list, or object-list consumer is found.',
    ],
    nextLeads: [
      'Stop treating structured raw source-word hits as a primary graphics-source path unless this catalog reports a coverage contributor.',
      'Prioritize direct-copy, decompression, dynamic-bank, and scene-specific loader traces for the remaining nonblank graphics spans.',
      'For player A48 candidate spans, trace command/variant selectors before adding their source spans to combined graphics coverage.',
      'For bank-2 VDP nested draw candidates, find a confirmed pointer-list producer before promoting their payload as source coverage.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];

  for (const target of catalog.targetRegions) {
    const region = findRegionById(mapData, target.targetRegion.id);
    if (!region) {
      missingRegions.push({ id: target.targetRegion.id, role: 'graphics_structured_lead_target_region' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.graphicsStructuredLeadFinalTriageAudit = {
        catalogId,
        role: 'graphics_target_region',
        confidence: target.nonKnownOccurrenceCount ? 'low' : 'medium',
        summary: 'Final triage of structured source-word-shaped hits for currently unreferenced graphics spans.',
        detail: {
          spanCount: target.spanCount,
          occurrenceCount: target.occurrenceCount,
          nonKnownOccurrenceCount: target.nonKnownOccurrenceCount,
          finalDispositionCounts: target.finalDispositionCounts,
          priorityCounts: target.priorityCounts,
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name,
      inferredAnalysis: 'graphicsStructuredLeadFinalTriageAudit',
      role: 'graphics_target_region',
    });
  }

  for (const source of catalog.sourceRegions) {
    const region = findRegionById(mapData, source.sourceRegion.id);
    if (!region) {
      missingRegions.push({ id: source.sourceRegion.id, role: 'graphics_structured_lead_source_region' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.graphicsStructuredLeadFinalTriageAudit = {
        catalogId,
        role: 'structured_source_region',
        confidence: source.confidence,
        summary: 'Final triage of structured source-word-shaped hits that overlap this source region.',
        detail: {
          occurrenceCount: source.occurrenceCount,
          targetSpanCount: source.targetSpanCount,
          targetRegionCount: source.targetRegionCount,
          finalDisposition: source.finalDisposition,
          finalDispositionCounts: source.finalDispositionCounts,
          candidateOccurrenceCount: source.candidateOccurrenceCount,
          rejectedOccurrenceCount: source.rejectedOccurrenceCount,
          sourceCoverageContributorCount: source.sourceCoverageContributorCount,
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name,
      inferredAnalysis: 'graphicsStructuredLeadFinalTriageAudit',
      role: 'structured_source_region',
    });
  }

  return { changedRegions, missingRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_structured_lead_final_triage_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      changedRegions: annotation.changedRegions,
      missingRegions: annotation.missingRegions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
