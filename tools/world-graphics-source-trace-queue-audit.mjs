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
const toolName = 'tools/world-graphics-source-trace-queue-audit.mjs';
const catalogId = 'world-graphics-source-trace-queue-catalog-2026-06-26';
const reportId = 'graphics-source-trace-queue-audit-2026-06-26';
const schemaVersion = 1;

const sourceCatalogIds = {
  combinedCoverage: 'world-graphics-combined-source-coverage-catalog-2026-06-26',
  unreferencedShape: 'world-graphics-combined-unreferenced-shape-catalog-2026-06-26',
  remainingLead: 'world-graphics-remaining-lead-reconciliation-catalog-2026-06-26',
  structuredFinalTriage: 'world-graphics-structured-lead-final-triage-catalog-2026-06-26',
  directSourceAddress: 'world-graphics-direct-source-address-catalog-2026-06-26',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 16);
  return NaN;
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

function sumBy(items, valueFn) {
  return (items || []).reduce((sum, item) => sum + valueFn(item), 0);
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
  if (!catalog) throw new Error(`Missing required catalog: ${id}`);
  return catalog;
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

function rangeFor(item) {
  return {
    start: item.start || item.targetSpanRange?.start || '',
    endExclusive: item.endExclusive || item.targetSpanRange?.endExclusive || '',
    sizeBytes: Number(item.sizeBytes || 0),
  };
}

function priorityRank(action) {
  return {
    trace_dynamic_bank_or_decompression_path: 100,
    trace_real_consumer_before_coverage: 90,
    trace_direct_copy_or_decompression: 80,
    trace_scene_specific_or_runtime_copy_path: 70,
    keep_quarantined_until_consumer_trace: 40,
    deprioritize_padding_or_shape: 10,
  }[action] || 50;
}

function actionForSpan(shapeSpan, remainingLead, structuredSpan, directSpan) {
  const shapeKind = shapeSpan.classification?.kind || '';
  const remainingPriority = remainingLead?.classification?.priorityGroup || '';
  const structuredDisposition = structuredSpan?.finalDisposition || '';
  const directKind = directSpan?.classification?.kind || '';
  const directPriority = directSpan?.classification?.priority || '';

  if (shapeKind === 'all_blank_padding_candidate' || remainingPriority === 'padding_or_shape_low_priority') {
    return {
      action: 'deprioritize_padding_or_shape',
      confidence: 'medium',
      reason: 'The span is blank, uniform, adjacent-duplicate, or otherwise classified as low-priority padding/shape evidence.',
    };
  }

  if (structuredDisposition === 'only_unconfirmed_candidate_structured_payload_hits'
    || structuredDisposition === 'mixed_rejected_and_unconfirmed_candidate_structured_hits') {
    return {
      action: 'trace_real_consumer_before_coverage',
      confidence: structuredSpan.confidence || 'low',
      reason: structuredSpan.reason || 'Structured source-word-shaped hits are only unconfirmed payload candidates and need a producer trace before coverage promotion.',
    };
  }

  if (directKind === 'direct_address_words_without_matching_bank_uploader'
    || directPriority === 'trace_dynamic_bank_or_decompression_path') {
    return {
      action: 'trace_dynamic_bank_or_decompression_path',
      confidence: directSpan.classification?.confidence || 'medium',
      reason: directSpan.classification?.reason || 'Direct source-address-shaped hits exist, but no matching banked uploader context is confirmed.',
    };
  }

  if (remainingPriority === 'trace_direct_copy_or_decompression') {
    return {
      action: 'trace_direct_copy_or_decompression',
      confidence: remainingLead.classification?.confidence || 'medium',
      reason: remainingLead.classification?.reason || 'Loader-like hits were resolved as non-source overlaps; direct copy or decompression remains the likely trace path.',
    };
  }

  if (shapeKind.includes('untraced') || remainingPriority === 'trace_non_loader_occurrences') {
    return {
      action: 'trace_scene_specific_or_runtime_copy_path',
      confidence: remainingLead?.classification?.confidence || shapeSpan.classification?.confidence || 'low',
      reason: remainingLead?.classification?.reason || shapeSpan.classification?.reason || 'The span is nonblank graphics data without a confirmed static or dynamic loader source path.',
    };
  }

  return {
    action: 'keep_quarantined_until_consumer_trace',
    confidence: 'low',
    reason: 'No stronger trace action is available from the current graphics source catalogs.',
  };
}

function buildQueueEntry(shapeSpan, indexes) {
  const spanId = shapeSpan.id || shapeSpan.spanId;
  const remainingLead = indexes.remainingBySpan.get(spanId) || null;
  const structuredSpan = indexes.structuredBySpan.get(spanId) || null;
  const directSpan = indexes.directBySpan.get(spanId) || null;
  const action = actionForSpan(shapeSpan, remainingLead, structuredSpan, directSpan);
  const nonblankTileCount = Number(shapeSpan.shapeStats?.nonblankTileCount
    || shapeSpan.nonblankTileCount
    || remainingLead?.nonblankTileCount
    || directSpan?.nonblankTileCount
    || 0);
  const tileCount = Number(shapeSpan.tileCount || remainingLead?.tileCount || directSpan?.tileCount || 0);
  const sizeBytes = Number(shapeSpan.sizeBytes || remainingLead?.sizeBytes || directSpan?.sizeBytes || 0);
  const priorityScore = priorityRank(action.action) * 1000
    + nonblankTileCount * 10
    + Number(remainingLead?.priorityScore || 0)
    + Number(directSpan?.directAddressCounts?.codeOccurrenceCount || 0);

  return {
    id: `${spanId}_graphics_source_trace_queue`,
    spanId,
    region: compactRegion(shapeSpan.region || remainingLead?.region || directSpan?.region || structuredSpan?.targetRegion),
    range: rangeFor(shapeSpan),
    tileCount,
    nonblankTileCount,
    shapeClassification: shapeSpan.classification || null,
    remainingLead: remainingLead ? {
      classification: remainingLead.classification || null,
      priorityScore: remainingLead.priorityScore || 0,
      sourceWordCounts: remainingLead.sourceWordCounts || null,
      resolver: remainingLead.resolver || null,
    } : null,
    structuredFinalTriage: structuredSpan ? {
      finalDisposition: structuredSpan.finalDisposition,
      priority: structuredSpan.priority,
      confidence: structuredSpan.confidence,
      occurrenceCount: structuredSpan.occurrenceCount,
      nonKnownOccurrenceCount: structuredSpan.nonKnownOccurrenceCount,
      finalDispositionCounts: structuredSpan.finalDispositionCounts || {},
      sourceRegionCounts: structuredSpan.sourceRegionCounts || {},
    } : null,
    directSourceAddress: directSpan ? {
      classification: directSpan.classification || null,
      bank: directSpan.bank || '',
      z80Range: directSpan.z80Range || null,
      directAddressCounts: directSpan.directAddressCounts || {},
      occurrenceClassCounts: directSpan.occurrenceClassCounts || {},
      occurrenceRegionTypeCounts: directSpan.occurrenceRegionTypeCounts || {},
      uploaderEvidence: directSpan.uploaderEvidence || null,
    } : null,
    recommendedAction: action.action,
    actionConfidence: action.confidence,
    actionReason: action.reason,
    priorityScore,
    coverageStatus: 'unconfirmed_source_path',
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    evidenceCatalogs: [
      sourceCatalogIds.combinedCoverage,
      sourceCatalogIds.unreferencedShape,
      remainingLead ? sourceCatalogIds.remainingLead : null,
      structuredSpan ? sourceCatalogIds.structuredFinalTriage : null,
      directSpan ? sourceCatalogIds.directSourceAddress : null,
    ].filter(Boolean),
  };
}

function buildRegionQueues(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.region?.id) continue;
    if (!groups.has(entry.region.id)) {
      groups.set(entry.region.id, {
        region: entry.region,
        spanCount: 0,
        sizeBytes: 0,
        tileCount: 0,
        nonblankTileCount: 0,
        topPriorityScore: 0,
        recommendedActionCounts: {},
        actionConfidenceCounts: {},
        topSpans: [],
      });
    }
    const group = groups.get(entry.region.id);
    group.spanCount++;
    group.sizeBytes += entry.range.sizeBytes;
    group.tileCount += entry.tileCount;
    group.nonblankTileCount += entry.nonblankTileCount;
    group.topPriorityScore = Math.max(group.topPriorityScore, entry.priorityScore);
    group.recommendedActionCounts[entry.recommendedAction] = (group.recommendedActionCounts[entry.recommendedAction] || 0) + 1;
    group.actionConfidenceCounts[entry.actionConfidence] = (group.actionConfidenceCounts[entry.actionConfidence] || 0) + 1;
    group.topSpans.push({
      spanId: entry.spanId,
      range: entry.range,
      nonblankTileCount: entry.nonblankTileCount,
      recommendedAction: entry.recommendedAction,
      priorityScore: entry.priorityScore,
    });
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      topSpans: group.topSpans
        .sort((a, b) => b.priorityScore - a.priorityScore || parseHex(a.range.start) - parseHex(b.range.start))
        .slice(0, 8),
    }))
    .sort((a, b) => b.topPriorityScore - a.topPriorityScore || parseHex(a.region.offset) - parseHex(b.region.offset));
}

function buildCatalog(mapData) {
  const combinedCoverage = requireCatalog(mapData, sourceCatalogIds.combinedCoverage);
  const unreferencedShape = requireCatalog(mapData, sourceCatalogIds.unreferencedShape);
  const remainingLead = requireCatalog(mapData, sourceCatalogIds.remainingLead);
  const structuredFinalTriage = requireCatalog(mapData, sourceCatalogIds.structuredFinalTriage);
  const directSourceAddress = requireCatalog(mapData, sourceCatalogIds.directSourceAddress);

  const indexes = {
    remainingBySpan: new Map((remainingLead.entries || []).map(item => [item.spanId, item])),
    structuredBySpan: new Map((structuredFinalTriage.targetSpans || []).map(item => [item.spanId, item])),
    directBySpan: new Map((directSourceAddress.spans || []).map(item => [item.spanId, item])),
  };
  const entries = (unreferencedShape.spans || [])
    .map(span => buildQueueEntry(span, indexes))
    .sort((a, b) => b.priorityScore - a.priorityScore || parseHex(a.range.start) - parseHex(b.range.start));
  const nonblankEntries = entries.filter(entry => entry.nonblankTileCount > 0);
  const regionQueues = buildRegionQueues(entries);
  const topQueue = entries.slice(0, 16);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: graphics span offsets, counts, region ids, action classes, and evidence catalog links. No ROM bytes, hashes, decoded graphics, pixels, screenshots, rendered tiles, audio, text, or instruction bytes are embedded.',
    baseline: {
      combinedGraphicsCoveragePercent: combinedCoverage.summary?.combinedCoveragePercent ?? null,
      combinedReferencedTiles: combinedCoverage.summary?.uniqueReferencedTiles ?? null,
      combinedUnreferencedTiles: combinedCoverage.summary?.unreferencedTiles ?? null,
      combinedUnreferencedBytes: combinedCoverage.summary?.unreferencedBytes ?? null,
    },
    summary: {
      queueSpanCount: entries.length,
      queueNonblankSpanCount: nonblankEntries.length,
      queueRegionCount: regionQueues.length,
      queueTileCount: sumBy(entries, entry => entry.tileCount),
      queueNonblankTileCount: sumBy(entries, entry => entry.nonblankTileCount),
      queueBytes: sumBy(entries, entry => entry.range.sizeBytes),
      topQueueSpanCount: topQueue.length,
      recommendedActionCounts: countBy(entries, entry => entry.recommendedAction),
      nonblankRecommendedActionCounts: countBy(nonblankEntries, entry => entry.recommendedAction),
      confidenceCounts: countBy(entries, entry => entry.actionConfidence),
      directSourceConfirmedConsumerCount: directSourceAddress.summary?.confirmedDirectSourceConsumerCount || 0,
      structuredCoverageContributorCount: structuredFinalTriage.summary?.sourceCoverageContributorCount || 0,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    regionQueues,
    queue: entries,
    topQueue,
    evidence: [
      `${sourceCatalogIds.combinedCoverage} leaves 245 graphics tiles without confirmed source coverage after static, dynamic entity, player A48, status, and 998-variant source catalogs are merged.`,
      `${sourceCatalogIds.unreferencedShape} confirms that 240 of those tiles are nonblank shape data, but stores no ROM bytes, pixels, or hashes.`,
      `${sourceCatalogIds.structuredFinalTriage} reports zero structured source coverage contributors for the remaining spans.`,
      `${sourceCatalogIds.directSourceAddress} reports zero confirmed direct source-address consumers for the remaining spans.`,
      'This queue ranks trace work only; it does not promote any remaining graphics span to confirmed source coverage.',
    ],
    nextLeads: [
      'Start with topQueue spans whose action is trace_dynamic_bank_or_decompression_path; instrument dynamic bank selection plus _LABEL_A48_, _LABEL_A97_, _LABEL_99B_, and _LABEL_919_ upload/decode paths.',
      'For trace_real_consumer_before_coverage spans, resolve bank-2 VDP nested draw candidates and player A48 gap candidates only after finding a pointer-list, command, or variant selector producer.',
      'Keep padding_or_shape spans out of default graphics coverage until a scene or runtime trace proves they are consumed.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const regionQueue of catalog.regionQueues) {
    const region = findRegionById(mapData, regionQueue.region.id);
    if (!region) {
      missingRegions.push({ id: regionQueue.region.id, role: 'graphics_source_trace_queue_region' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.graphicsSourceTraceQueueAudit = {
        catalogId,
        role: 'graphics_source_trace_queue_region',
        confidence: regionQueue.nonblankTileCount ? 'medium' : 'low',
        summary: 'Prioritized queue for remaining graphics source paths not covered by static/dynamic loader catalogs.',
        detail: {
          spanCount: regionQueue.spanCount,
          nonblankTileCount: regionQueue.nonblankTileCount,
          recommendedActionCounts: regionQueue.recommendedActionCounts,
          topPriorityScore: regionQueue.topPriorityScore,
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      spanCount: regionQueue.spanCount,
      nonblankTileCount: regionQueue.nonblankTileCount,
      recommendedActionCounts: regionQueue.recommendedActionCounts,
    });
  }
  return { changedRegions, missingRegions };
}

function reportSample(catalog) {
  return {
    baseline: catalog.baseline,
    summary: catalog.summary,
    topQueue: catalog.topQueue.slice(0, 8).map(item => ({
      spanId: item.spanId,
      region: item.region,
      range: item.range,
      nonblankTileCount: item.nonblankTileCount,
      recommendedAction: item.recommendedAction,
      actionConfidence: item.actionConfidence,
      priorityScore: item.priorityScore,
    })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
  mapData.graphicsCatalogs.push(catalog);

  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'graphics_source_trace_queue_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    baseline: catalog.baseline,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    sample: reportSample(catalog),
    assetPolicy: catalog.assetPolicy,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);
  if (apply) {
    applyCatalog(mapData, catalog, annotation);
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    sample: reportSample(catalog),
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
