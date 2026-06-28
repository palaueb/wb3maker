#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-screen-prog-embedded-continuation-proof-audit.mjs';
const catalogId = 'world-screen-prog-embedded-continuation-proof-catalog-2026-06-26';
const reportId = 'screen-prog-embedded-continuation-proof-audit-2026-06-26';

const sourceCatalogs = [
  'world-screen-prog-catalog-2026-06-24',
  'world-screen-prog-reachability-catalog-2026-06-24',
  'world-asset-readiness-index-catalog-2026-06-26',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item?.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegion(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  const text = String(value || '').trim();
  if (!text) return NaN;
  return Number.parseInt(text.replace(/^\$/, '0x'), 16);
}

function hex(value, pad = 5) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
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

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
    confidence: region.confidence || null,
  };
}

function compactContinuationSource(source) {
  const visited = source?.visitedRange || {};
  return {
    rootRegion: compactRegion(source?.rootRegion),
    rootCatalogEntryId: source?.rootCatalogEntryId || '',
    visitedRange: {
      start: visited.start || null,
      endInclusive: visited.endInclusive || null,
      visitedBytes: Number(visited.visitedBytes || 0),
      outsideRegionBytes: Number(visited.outsideRegionBytes || 0),
    },
  };
}

function validateContinuation(region, reachability) {
  const continuationSources = reachability?.continuationSources || [];
  const decoder = reachability?.decoderSummary || {};
  const offset = parseHex(region.offset);
  const sourceContainsRegion = continuationSources.some(source => {
    const range = source?.visitedRange || {};
    const start = parseHex(range.start);
    const endInclusive = parseHex(range.endInclusive);
    return Number.isFinite(start) && Number.isFinite(endInclusive) && offset >= start && offset <= endInclusive;
  });
  const decoderTerminatedCleanly = decoder.terminated === true && Number(decoder.warningCount || 0) === 0;
  const hasRootSource = continuationSources.some(source => source?.rootRegion?.id && source?.rootCatalogEntryId);
  const isScreenProg = region.type === 'screen_prog';
  const kindMatches = reachability?.kind === 'embedded_continuation';
  const proofComplete = Boolean(kindMatches && isScreenProg && sourceContainsRegion && decoderTerminatedCleanly && hasRootSource);

  return {
    proofComplete,
    kindMatches,
    isScreenProg,
    sourceContainsRegion,
    decoderTerminatedCleanly,
    hasRootSource,
  };
}

function buildCatalog(mapData) {
  for (const id of sourceCatalogs) requireCatalog(mapData, id);

  const candidates = (mapData.regions || [])
    .filter(region => region?.analysis?.screenProgReachabilityAudit?.kind === 'embedded_continuation')
    .sort((a, b) => parseHex(a.offset) - parseHex(b.offset));

  const entries = candidates.map(region => {
    const reachability = region.analysis.screenProgReachabilityAudit;
    const decoder = reachability.decoderSummary || {};
    const proof = validateContinuation(region, reachability);
    const continuationSources = (reachability.continuationSources || []).map(compactContinuationSource);
    const rootRegionIds = continuationSources.map(source => source.rootRegion?.id).filter(Boolean);
    const visitedRange = decoder.visitedRange || {};
    const promotedByThisAudit = proof.proofComplete && region.confidence !== 'high';
    return {
      id: `${region.id}_embedded_continuation_${String(region.offset || '').replace(/^0x/i, '').toUpperCase()}`,
      region: compactRegion(region),
      status: proof.proofComplete
        ? 'embedded_continuation_label_confirmed'
        : 'embedded_continuation_label_needs_review',
      confidenceBefore: region.confidence || null,
      confidenceAfter: proof.proofComplete ? 'high' : (region.confidence || 'medium'),
      promotedByThisAudit,
      proof,
      decoderSummary: {
        terminated: decoder.terminated === true,
        endReason: decoder.endReason || '',
        ops: Number(decoder.ops || 0),
        writtenCells: Number(decoder.writtenCells || 0),
        warningCount: Number(decoder.warningCount || 0),
        outsideRegionBytes: Number(decoder.outsideRegionBytes || 0),
        visitedRange: {
          start: visitedRange.start || null,
          endInclusive: visitedRange.endInclusive || null,
          visitedBytes: Number(visitedRange.visitedBytes || 0),
        },
      },
      continuationSources,
      rootRegionIds,
      rootCatalogEntryIds: continuationSources.map(source => source.rootCatalogEntryId).filter(Boolean),
      role: 'label_inside_decoded_screen_prog_root_stream',
      standaloneRoot: false,
      defaultDecoderAction: 'group_under_root_screen_prog',
      evidence: [
        `Region ${region.id} at ${region.offset} is typed screen_prog and classified by screenProgReachabilityAudit as embedded_continuation.`,
        continuationSources.length
          ? `Decoded root stream(s) ${rootRegionIds.join(', ')} visit this offset before their terminator.`
          : 'No decoded root stream source was recorded; manual review is required.',
        proof.decoderTerminatedCleanly
          ? 'The continuation decoder summary terminates with zero warnings.'
          : 'The continuation decoder summary is not clean enough for promotion.',
        'This proof stores only offsets, region ids, decoder counts, and root/continuation relationships; it does not store screen bytes, tile ids, or rendered output.',
      ],
    };
  });

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: region ids, offsets, decoder status/counts, root/continuation relationships, confidence changes, and evidence. No ROM bytes, screen command bytes, tile ids, decoded graphics, pixels, screenshots, hashes, instruction bytes, or asset payloads are embedded.',
    summary: {
      embeddedContinuationCount: entries.length,
      proofCompleteCount: entries.filter(entry => entry.proof.proofComplete).length,
      promotedByThisAuditCount: entries.filter(entry => entry.promotedByThisAudit).length,
      mediumToHighPromotionCount: entries.filter(entry => entry.confidenceBefore === 'medium' && entry.confidenceAfter === 'high').length,
      statusCounts: countBy(entries, entry => entry.status),
      rootRegionCount: new Set(entries.flatMap(entry => entry.rootRegionIds)).size,
      standaloneRootCount: entries.filter(entry => entry.standaloneRoot).length,
      defaultDecoderActionCounts: countBy(entries, entry => entry.defaultDecoderAction),
      persistedRomByteCount: 0,
      persistedScreenByteCount: 0,
      persistedTileIdCount: 0,
      persistedPixelCount: 0,
      persistedHashCount: 0,
      persistedInstructionByteCount: 0,
    },
    entries,
    evidence: [
      'world-screen-prog-reachability-catalog-2026-06-24 classifies these regions as embedded_continuation rather than independent roots.',
      'Each promoted entry has at least one decoded root stream whose visited range contains the region offset.',
      'Each promoted entry has a terminated decoder summary with zero warnings.',
      'The correct decoder action is to group these labels under their root screen_prog streams and avoid rendering them as separate screen roots by default.',
    ],
    nextLeads: [
      'Update analyzer screen_prog lists to display embedded continuations below their root stream instead of as independent default preview roots.',
      'Use rootCatalogEntryIds when building scene recipes so repeated labels inside the same stream share one decoded command timeline.',
      'Leave any future embedded continuation with warnings or no root source at medium confidence until a clean root decode is available.',
    ],
  };
}

function addNote(region, note) {
  const existing = String(region.notes || '');
  if (existing.includes(note)) return;
  region.notes = existing ? `${existing} ${note}` : note;
}

function applyCatalog(mapData, catalog) {
  const annotated = [];
  const missingRegions = [];
  for (const entry of catalog.entries) {
    const region = findRegion(mapData, entry.region.id);
    if (!region) {
      missingRegions.push({ id: entry.region.id, role: 'screen_prog_embedded_continuation_label' });
      continue;
    }
    const confidenceBefore = region.confidence || null;
    if (entry.proof.proofComplete) {
      region.confidence = 'high';
      addNote(region, 'Audit: confirmed embedded screen_prog continuation label; group under its decoded root stream, not as a standalone default screen root.');
    }
    region.analysis = region.analysis || {};
    region.analysis.screenProgEmbeddedContinuationProofAudit = {
      catalogId,
      kind: 'screen_prog_embedded_continuation_label',
      status: entry.status,
      confidence: entry.confidenceAfter,
      confidenceBefore,
      confidenceAfter: region.confidence || entry.confidenceAfter,
      promotedByThisAudit: confidenceBefore !== region.confidence,
      rootRegionIds: entry.rootRegionIds,
      rootCatalogEntryIds: entry.rootCatalogEntryIds,
      standaloneRoot: false,
      defaultDecoderAction: entry.defaultDecoderAction,
      proof: entry.proof,
      decoderSummary: entry.decoderSummary,
      summary: 'Confirmed this screen_prog label is an embedded continuation inside a decoded root stream; default tooling should group it under the root.',
      evidence: entry.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      confidenceBefore,
      confidenceAfter: region.confidence || null,
      rootRegionIds: entry.rootRegionIds,
      promotedByThisAudit: confidenceBefore !== region.confidence,
    });
  }

  mapData.screenProgEmbeddedContinuationProofCatalogs = (mapData.screenProgEmbeddedContinuationProofCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.screenProgEmbeddedContinuationProofCatalogs.push(catalog);

  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    generatedAt: now,
    tool: toolName,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotated.length,
      missingRegionCount: missingRegions.length,
    },
    changedRegions: annotated,
    missingRegions,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });

  mapData.updatedAt = now;
  return { annotated, missingRegions };
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.screenProgEmbeddedContinuationProofCatalog = catalogId;
  staticMap.summary.screenProgEmbeddedContinuationCount = catalog.summary.embeddedContinuationCount;
  staticMap.summary.screenProgEmbeddedContinuationProofComplete = catalog.summary.proofCompleteCount;
  staticMap.summary.screenProgEmbeddedContinuationPromoted = catalog.summary.promotedByThisAuditCount;
  staticMap.summary.screenProgEmbeddedContinuationStandaloneRoots = catalog.summary.standaloneRootCount;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-screen-prog-embedded-continuation-proof-catalog-2026-06-26 to group embedded screen_prog labels under their decoded root streams in analyzer previews and scene recipes.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let result = { annotated: [], missingRegions: [] };
  if (apply) {
    result = applyCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    annotatedRegionCount: result.annotated.length,
    missingRegionCount: result.missingRegions.length,
    promotedRegions: result.annotated.filter(region => region.promotedByThisAudit),
    sample: catalog.entries.slice(0, 6).map(entry => ({
      regionId: entry.region.id,
      offset: entry.region.offset,
      status: entry.status,
      confidenceBefore: entry.confidenceBefore,
      confidenceAfter: entry.confidenceAfter,
      rootRegionIds: entry.rootRegionIds,
    })),
  }, null, 2));
}

main();
