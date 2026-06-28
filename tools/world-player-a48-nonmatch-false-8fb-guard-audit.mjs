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
const toolName = 'tools/world-player-a48-nonmatch-false-8fb-guard-audit.mjs';
const catalogId = 'world-player-a48-nonmatch-false-8fb-guard-catalog-2026-06-26';
const reportId = 'player-a48-nonmatch-false-8fb-guard-audit-2026-06-26';
const schemaVersion = 1;
const rejectedCandidateRegionId = 'r0749';
const rejectedCandidateId = 'candidate_8fb_1E337';

const sourceCatalogIds = {
  nonmatchDynamicRoute: 'world-player-a48-nonmatch-dynamic-route-catalog-2026-06-26',
  structuredOccurrence: 'world-graphics-structured-source-occurrence-catalog-2026-06-26',
  structuredFinalTriage: 'world-graphics-structured-lead-final-triage-catalog-2026-06-26',
  bank7PreSequenceSidecar: 'world-bank7-pre-sequence-sidecar-catalog-2026-06-25',
  graphicsLoaderCandidate: 'world-graphics-loader-candidate-catalog-2026-06-25',
  graphicsLoaderCandidateConsumer: 'world-graphics-loader-candidate-consumer-catalog-2026-06-25',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value.replace(/^\$/, '0x'), 16);
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

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value != null && value !== ''))].sort((a, b) => {
    const aNum = parseOffset(a);
    const bNum = parseOffset(b);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    return String(a).localeCompare(String(b));
  });
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

function sourceWordForEntry(entry) {
  return entry.sourceRecordWordChunks?.[0]?.sourceRecordWordStart || entry.sourceRecordHighBytes?.[0] || '';
}

function collectStructuredOccurrences(structuredCatalog, finalTriageCatalog, spanIds) {
  const allowed = new Set(spanIds);
  const occurrences = [];
  const seen = new Set();

  function add(raw, origin) {
    const occurrence = raw.occurrence || raw;
    if (!allowed.has(occurrence.targetSpanId)) return;
    const sourceRegion = occurrence.sourceRegion || raw.sourceRegion || null;
    if (sourceRegion?.id !== rejectedCandidateRegionId) return;
    const key = `${occurrence.occurrenceOffset}:${occurrence.sourceWord}:${occurrence.targetSpanId}`;
    if (seen.has(key)) return;
    seen.add(key);
    occurrences.push({
      origin,
      occurrenceOffset: occurrence.occurrenceOffset,
      sourceWord: occurrence.sourceWord,
      sourceRegion: sourceRegion,
      targetSpanId: occurrence.targetSpanId,
      targetTileOffset: occurrence.targetTileOffset,
      targetRegion: occurrence.targetRegion,
      resolvedContext: occurrence.resolvedContext || {
        kind: occurrence.resolvedContextKind,
        disposition: occurrence.resolvedContextDisposition,
        parserRole: occurrence.parserRole,
        sourceCatalogId: occurrence.sourceCatalogId,
        confidence: occurrence.confidence,
      },
    });
  }

  for (const sourceRegion of structuredCatalog.sourceRegions || []) {
    for (const sample of sourceRegion.samples || []) {
      add({
        ...sample,
        sourceRegion: sourceRegion.region || sample.sourceRegion,
      }, structuredCatalog.id);
    }
  }
  for (const occurrence of finalTriageCatalog.nonKnownOccurrences || []) add(occurrence, finalTriageCatalog.id);
  return occurrences.sort((a, b) => parseOffset(a.occurrenceOffset) - parseOffset(b.occurrenceOffset));
}

function findCandidate(candidateCatalog) {
  return (candidateCatalog.candidates || []).find(candidate => candidate.id === rejectedCandidateId) || null;
}

function findConsumerRecord(consumerCatalog) {
  return (consumerCatalog.records || []).find(record => record.candidateId === rejectedCandidateId) || null;
}

function candidateOverlapForSpan(candidate, spanId, sourceRangeStart) {
  return (candidate?.overlapRefs || []).find(ref => (
    ref.spanId === spanId ||
    ref.sourceRange?.start === sourceRangeStart
  )) || null;
}

function buildEntry(nonmatchEntry, occurrence, candidate, consumer) {
  const candidateOverlap = candidateOverlapForSpan(candidate, nonmatchEntry.spanId, nonmatchEntry.range?.start);
  const context = occurrence?.resolvedContext || {};
  return {
    id: `${nonmatchEntry.spanId}_false_8fb_guard`,
    spanId: nonmatchEntry.spanId,
    region: nonmatchEntry.region,
    range: nonmatchEntry.range,
    sourceRecordHighBytes: nonmatchEntry.sourceRecordHighBytes || [],
    sourceRecordWordChunks: nonmatchEntry.sourceRecordWordChunks || [],
    rejectedOccurrence: occurrence ? {
      occurrenceOffset: occurrence.occurrenceOffset,
      sourceWord: occurrence.sourceWord,
      sourceRegion: occurrence.sourceRegion,
      targetTileOffset: occurrence.targetTileOffset,
      resolvedContextKind: context.kind,
      resolvedContextDisposition: context.disposition,
      parserRole: context.parserRole,
      confidence: context.confidence,
      sourceCatalogId: context.sourceCatalogId,
      recordOffsets: context.recordOffsets || [],
      recordIndexes: context.recordIndexes || [],
      fieldRoles: context.fieldRoles || [],
      candidateConsumerStatus: context.candidateConsumerStatus || consumer?.status || '',
      candidatePromotionAllowed: Boolean(context.candidatePromotionAllowed || consumer?.promotionAllowed),
      aliasCount: context.aliasCount ?? consumer?.aliasCount ?? 0,
      directCandidateAsmRefCount: context.directCandidateAsmRefCount ?? consumer?.directCandidateRefCount ?? 0,
      rawZ80WordOccurrenceCount: context.rawZ80WordOccurrenceCount ?? consumer?.rawZ80WordOccurrenceCount ?? 0,
    } : null,
    rejectedCandidate: {
      candidateId: candidate?.id || rejectedCandidateId,
      region: candidate?.containingRegion || consumer?.candidateRegion || null,
      format: candidate?.format || '8fb',
      status: candidate?.status || 'candidate_only_unconfirmed_consumer',
      confidence: candidate?.confidence || 'medium',
      consumedBytes: candidate?.consumedBytes || null,
      entryCount: candidate?.entryCount || null,
      copyEntryCount: candidate?.copyEntryCount || null,
      totalTiles: candidate?.totalTiles || null,
      overlapRef: candidateOverlap ? {
        spanId: candidateOverlap.spanId,
        entryIndex: candidateOverlap.entryIndex,
        entryOffset: candidateOverlap.entryOffset,
        bytes: candidateOverlap.bytes,
        tiles: candidateOverlap.tiles,
        sourceRange: candidateOverlap.sourceRange,
      } : null,
    },
    guardDecision: {
      status: 'exclude_rejected_bank7_8fb_candidate_from_coverage',
      confidence: consumer?.confidence || context.confidence || 'medium',
      promotionAllowed: false,
      reason: consumer?.reason || context.reason || 'Structured source-word hit overlaps a rejected 8FB-shaped bank-7 candidate with no confirmed direct consumer.',
      retainedTraceRoutes: (nonmatchEntry.retainedRouteIds || []).filter(routeId => routeId !== 'record_derived_8fb_path'),
      deprioritizedTraceRoutes: ['record_derived_8fb_path'],
      nextAction: 'Trace the runtime _LABEL_9C3_/_LABEL_99B_/_LABEL_A97_ path or another concrete consumer before promoting this tile source.',
    },
    evidenceCatalogs: Object.values(sourceCatalogIds),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
  };
}

function buildCatalog(mapData) {
  const nonmatchCatalog = requireCatalog(mapData, sourceCatalogIds.nonmatchDynamicRoute);
  const structuredCatalog = requireCatalog(mapData, sourceCatalogIds.structuredOccurrence);
  const finalTriageCatalog = requireCatalog(mapData, sourceCatalogIds.structuredFinalTriage);
  const sidecarCatalog = requireCatalog(mapData, sourceCatalogIds.bank7PreSequenceSidecar);
  const candidateCatalog = requireCatalog(mapData, sourceCatalogIds.graphicsLoaderCandidate);
  const consumerCatalog = requireCatalog(mapData, sourceCatalogIds.graphicsLoaderCandidateConsumer);

  const candidate = findCandidate(candidateCatalog);
  const consumer = findConsumerRecord(consumerCatalog);
  const nonmatchEntries = nonmatchCatalog.entries || [];
  const occurrences = collectStructuredOccurrences(
    structuredCatalog,
    finalTriageCatalog,
    nonmatchEntries.map(entry => entry.spanId),
  );
  const occurrenceBySpan = new Map(occurrences.map(occurrence => [occurrence.targetSpanId, occurrence]));
  const entries = nonmatchEntries.map(entry => buildEntry(entry, occurrenceBySpan.get(entry.spanId), candidate, consumer));
  const guardedEntries = entries.filter(entry => entry.rejectedOccurrence);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: offsets, source words, catalog ids, region ids, route ids, candidate statuses, alias counts, and guard decisions. No ROM bytes, decoded graphics, screenshots, hashes, pixels, audio, text, or ASM instruction bytes are embedded.',
    target: {
      upstreamCatalogId: sourceCatalogIds.nonmatchDynamicRoute,
      rejectedCandidateId,
      rejectedCandidateRegionId,
      rationale: 'The four bank 0x0B non-A48 single-tile spans have structured source-word hits in r0749, but that 8FB-shaped candidate was previously rejected because the only loader-adjacent banked address resolves to a bank-4 alias.',
    },
    summary: {
      guardEntryCount: entries.length,
      guardedStructuredOccurrenceCount: guardedEntries.length,
      sourceByteCount: sumBy(entries, entry => entry.range?.sizeBytes || 0),
      nonblankTileCount: sumBy(entries, entry => Number(entry.range?.sizeBytes || 0) / 32),
      rejectedCandidateId: candidate?.id || rejectedCandidateId,
      rejectedCandidateRegionId,
      rejectedCandidateStatus: sidecarCatalog.summary?.status || candidate?.status || '',
      candidateConsumerStatus: consumer?.status || '',
      candidatePromotionAllowed: Boolean(consumer?.promotionAllowed),
      directCandidateRefCount: consumer?.directCandidateRefCount || 0,
      aliasCount: consumer?.aliasCount || 0,
      rawZ80WordOccurrenceCount: consumer?.rawZ80WordOccurrenceCount || 0,
      guardDecisionCounts: countBy(entries, entry => entry.guardDecision.status),
      deprioritizedRouteIds: uniqueSorted(entries.flatMap(entry => entry.guardDecision.deprioritizedTraceRoutes)),
      retainedRouteIds: uniqueSorted(entries.flatMap(entry => entry.guardDecision.retainedTraceRoutes)),
      occurrenceSourceOffsets: uniqueSorted(guardedEntries.map(entry => entry.rejectedOccurrence.occurrenceOffset)),
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    rejectedCandidate: {
      sidecarSummary: sidecarCatalog.summary,
      consumerRecord: consumer ? {
        candidateId: consumer.candidateId,
        candidateLabel: consumer.candidateLabel,
        candidateOffset: consumer.candidateOffset,
        candidateRegion: consumer.candidateRegion,
        z80Address: consumer.z80Address,
        status: consumer.status,
        confidence: consumer.confidence,
        promotionAllowed: Boolean(consumer.promotionAllowed),
        reason: consumer.reason,
        directCandidateRefCount: consumer.directCandidateRefCount,
        aliasCount: consumer.aliasCount,
        rawZ80WordOccurrenceCount: consumer.rawZ80WordOccurrenceCount,
        aliases: (consumer.aliases || []).map(alias => ({
          label: alias.label,
          offset: alias.offset,
          z80Address: alias.z80Address,
          isCandidateLabel: Boolean(alias.isCandidateLabel),
          refCount: alias.refCount,
          loaderAdjacentRefCount: alias.loaderAdjacentRefCount,
        })),
      } : null,
    },
    entries,
    evidence: [
      `${sourceCatalogIds.nonmatchDynamicRoute} isolated the four bank 0x0B single-tile non-A48 residual spans.`,
      `${sourceCatalogIds.structuredOccurrence} and ${sourceCatalogIds.structuredFinalTriage} show each source word appears in r0749 as a rejected 8FB candidate field overlap.`,
      `${sourceCatalogIds.graphicsLoaderCandidateConsumer} records the bank-alias collision: the loader-adjacent $A337 reference resolves to _DATA_12337_, not _DATA_1E337_.`,
      `${sourceCatalogIds.bank7PreSequenceSidecar} keeps r0749 as a bank-7 sequence sidecar and blocks promotion to confirmed graphics coverage.`,
    ],
    nextLeads: [
      'Do not promote r0749/candidate_8fb_1E337 as coverage for the four r2656 single-tile gaps without a new direct bank-7 consumer trace.',
      'Trace the retained _LABEL_9C3_/_LABEL_99B_/_LABEL_A97_ route first, because the known 8FB-shaped r0749 route is currently a false bank-alias lead.',
      'If a future trace revisits _LABEL_919_, require runtime bank context proving _DATA_1E337_ instead of the bank-4 _DATA_12337_ alias.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const byRegion = new Map();

  for (const entry of catalog.entries) {
    for (const region of [entry.region, entry.rejectedOccurrence?.sourceRegion, entry.rejectedCandidate?.region]) {
      if (!region?.id) continue;
      if (!byRegion.has(region.id)) {
        byRegion.set(region.id, {
          roles: new Set(),
          spanIds: new Set(),
          occurrenceOffsets: new Set(),
          sourceWords: new Set(),
        });
      }
      const detail = byRegion.get(region.id);
      detail.roles.add(region.id === rejectedCandidateRegionId ? 'rejected_bank7_8fb_candidate_region' : 'guarded_non_a48_graphics_span_region');
      detail.spanIds.add(entry.spanId);
      if (entry.rejectedOccurrence?.occurrenceOffset) detail.occurrenceOffsets.add(entry.rejectedOccurrence.occurrenceOffset);
      if (entry.rejectedOccurrence?.sourceWord) detail.sourceWords.add(entry.rejectedOccurrence.sourceWord);
    }
  }

  for (const [regionId, detail] of byRegion) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: [...detail.roles].sort().join(',') });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48NonmatchFalse8fbGuardAudit = {
        catalogId,
        role: [...detail.roles].sort().join(','),
        confidence: 'high',
        summary: 'Structured source-word hits for bank 0x0B non-A48 residual spans are guarded against false promotion through rejected bank-7 8FB candidate r0749.',
        detail: {
          spanIds: [...detail.spanIds].sort(),
          occurrenceOffsets: [...detail.occurrenceOffsets].sort(),
          sourceWords: [...detail.sourceWords].sort(),
          rejectedCandidateId: catalog.summary.rejectedCandidateId,
          candidateConsumerStatus: catalog.summary.candidateConsumerStatus,
          promotionAllowed: catalog.summary.candidatePromotionAllowed,
          retainedRouteIds: catalog.summary.retainedRouteIds,
          deprioritizedRouteIds: catalog.summary.deprioritizedRouteIds,
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
      role: [...detail.roles].sort().join(','),
      spanIds: [...detail.spanIds].sort(),
    });
  }

  return { changedRegions, missingRegions };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    entries: catalog.entries.map(entry => ({
      spanId: entry.spanId,
      range: entry.range,
      sourceRecordWord: sourceWordForEntry(entry),
      rejectedOccurrence: entry.rejectedOccurrence,
      rejectedCandidate: entry.rejectedCandidate,
      guardDecision: entry.guardDecision,
    })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
  mapData.graphicsCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'player_a48_nonmatch_false_8fb_guard_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    sample: reportSample(catalog),
    assetPolicy: catalog.assetPolicy,
    evidence: catalog.evidence,
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
