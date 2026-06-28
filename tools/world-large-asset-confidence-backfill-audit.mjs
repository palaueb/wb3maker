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
const toolName = 'tools/world-large-asset-confidence-backfill-audit.mjs';
const catalogId = 'world-large-asset-confidence-backfill-catalog-2026-06-26';
const reportId = 'large-asset-confidence-backfill-audit-2026-06-26';
const schemaVersion = 1;
const minRegionSize = 256;

const assetTypes = new Set([
  'audio_driver_data',
  'data_table',
  'effect_script',
  'entity_anim_script',
  'entity_anim_table',
  'entity_behavior_table',
  'entity_data',
  'gfx_tiles',
  'input_script',
  'item_data',
  'meta_sprite',
  'music',
  'palette',
  'palette_script',
  'pointer_table',
  'room_data',
  'screen_prog',
  'text',
  'tile_map',
  'vdp_stream',
  'vram_loader_8fb',
  'vram_loader_998',
]);

const genericEvidenceKeys = new Set([
  'assetConfidenceBackfillAudit',
  'asmDataLabelCensusAudit',
  'asmIncbinSpanAudit',
  'asmLabelRegionAudit',
  'graphicsUntracedSourceWordContextAudit',
  'inferred',
  'staleScreenProgMetadataAudit',
  'structuredGraphicsSourceWordLeadAudit',
]);

const blockedEvidenceFragments = [
  'candidate',
  'false',
  'gap',
  'lead',
  'residual',
  'stale',
  'unresolved',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isMissingConfidence(region) {
  return region.confidence === undefined || region.confidence === null || region.confidence === '';
}

function compactRegion(region) {
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    bank: region.bank ?? null,
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

function selectedEvidenceEntries(region) {
  const analysis = region.analysis || {};
  return Object.entries(analysis)
    .filter(([key, value]) => isSemanticEvidence(key, value))
    .map(([key, value]) => ({
      key,
      kind: value.kind || '',
      confidence: value.confidence || '',
      catalogId: value.catalogId || '',
      tool: value.tool || '',
      summary: value.summary || '',
    }))
    .sort((a, b) => evidenceConfidenceRank(b.confidence) - evidenceConfidenceRank(a.confidence)
      || a.key.localeCompare(b.key));
}

function evidenceConfidenceRank(confidence) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium_high') return 2;
  return 0;
}

function isSemanticEvidence(key, value) {
  if (!value || typeof value !== 'object') return false;
  if (genericEvidenceKeys.has(key)) return false;
  if (!['high', 'medium_high'].includes(value.confidence)) return false;

  const haystack = `${key} ${value.kind || ''}`.toLowerCase();
  if (blockedEvidenceFragments.some(fragment => haystack.includes(fragment))) return false;
  return true;
}

function confidenceFromEvidence(evidence) {
  return evidence.some(item => item.confidence === 'high') ? 'high' : 'medium_high';
}

function wasGeneratedByThisAudit(region) {
  return region.analysis?.assetConfidenceBackfillAudit?.catalogId === catalogId;
}

function eligibleRegion(region) {
  if (!assetTypes.has(region.type)) return false;
  if (Number(region.size || 0) < minRegionSize) return false;
  if (!isMissingConfidence(region) && !wasGeneratedByThisAudit(region)) return false;
  return selectedEvidenceEntries(region).length > 0;
}

function buildCatalog(mapData) {
  const entries = (mapData.regions || [])
    .filter(eligibleRegion)
    .map(region => {
      const evidence = selectedEvidenceEntries(region);
      const confidence = confidenceFromEvidence(evidence);
      const existingAudit = region.analysis?.assetConfidenceBackfillAudit || null;
      return {
        ...compactRegion(region),
        confidence,
        topLevelConfidenceBefore: existingAudit?.topLevelConfidenceBefore ?? (region.confidence ?? null),
        evidenceKeyCount: evidence.length,
        evidenceKeys: evidence.map(item => item.key),
        evidenceCatalogIds: [...new Set(evidence.map(item => item.catalogId).filter(Boolean))].sort(),
      };
    })
    .sort((a, b) => b.size - a.size || String(a.offset).localeCompare(String(b.offset)));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    source: {
      map: 'projects/WORLD/map.json',
      regionCount: (mapData.regions || []).length,
      schemaVersion: mapData.schemaVersion ?? null,
      romSizeBytes: mapData.romSizeBytes ?? null,
      romMD5: mapData.romMD5 || '',
    },
    assetPolicy: 'Metadata only: region ids, offsets, sizes, types, top-level confidence values, evidence audit keys, catalog ids, and aggregate counts. No ROM bytes, decoded graphics, screenshots, audio samples, event payloads, or asset hashes are embedded.',
    selectionRule: {
      minRegionSize,
      includedTypes: [...assetTypes].sort(),
      excludedTypes: ['code', 'null', 'unknown'],
      evidenceRule: 'A region must already have at least one non-generic high or medium_high semantic parser/audit entry under analysis. Generic ASM label/incbin evidence and candidate/lead/residual/gap/unresolved evidence are not enough.',
      overwriteRule: 'Only regions with missing top-level confidence are changed, except entries previously generated by this same audit for idempotent refresh.',
    },
    summary: {
      eligibleRegionCount: entries.length,
      totalEligibleBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
      byType: countBy(entries, entry => entry.type),
      byBank: countBy(entries, entry => entry.bank === null ? '' : String(entry.bank).padStart(2, '0')),
      confidenceCounts: countBy(entries, entry => entry.confidence),
      evidenceKeyCounts: countBy(entries.flatMap(entry => entry.evidenceKeys), key => key),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    entries,
  };
}

function annotateMap(mapData, catalog) {
  const byId = new Map(catalog.entries.map(entry => [entry.id, entry]));
  const changedRegions = [];

  for (const region of mapData.regions || []) {
    const entry = byId.get(region.id);
    if (!entry) continue;
    const evidence = selectedEvidenceEntries(region);
    const topLevelConfidenceBefore = entry.topLevelConfidenceBefore;

    if (apply) {
      region.confidence = entry.confidence;
      region.analysis = region.analysis || {};
      region.analysis.assetConfidenceBackfillAudit = {
        catalogId,
        kind: 'large_asset_top_level_confidence_backfill',
        confidence: entry.confidence,
        topLevelConfidenceBefore,
        topLevelConfidenceAfter: entry.confidence,
        evidenceKeys: evidence.map(item => item.key),
        evidence: evidence.slice(0, 8),
        summary: 'Backfilled top-level region confidence from existing high-confidence semantic parser/audit evidence.',
        generatedAt: now,
        tool: toolName,
      };
    }

    changedRegions.push({
      ...compactRegion(region),
      confidence: entry.confidence,
      topLevelConfidenceBefore,
      evidenceKeyCount: evidence.length,
      evidenceKeys: evidence.map(item => item.key),
    });
  }

  return changedRegions.sort((a, b) => b.size - a.size || String(a.offset).localeCompare(String(b.offset)));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const changedRegions = annotateMap(mapData, catalog);

  if (apply) {
    mapData.assetCoverageCatalogs = (mapData.assetCoverageCatalogs || []).filter(item => item.id !== catalogId);
    mapData.assetCoverageCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'large_asset_confidence_backfill_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      catalogId,
      summary: {
        ...catalog.summary,
        changedRegionCount: changedRegions.length,
      },
      changedRegions,
      evidence: [
        'Top-level confidence was missing on each selected region before this audit or was previously generated by this same audit.',
        'Each selected region already has at least one semantic analysis entry with confidence high or medium_high.',
        'Generic ASM label/incbin evidence and candidate/lead/residual/gap/unresolved evidence are excluded from the selection rule.',
        'This audit does not inspect or persist ROM bytes; it only promotes already-present metadata confidence to the region summary level.',
      ],
      nextLeads: [
        'Extend this confidence backfill to smaller asset regions after checking whether their semantic parser evidence is equally strong.',
        'Keep code-region confidence separate from asset-region confidence so behavior reconstruction can use stricter routine-specific evidence.',
        'Use the backfilled large-asset confidence list to prioritize remaining UI summaries and export/static map views.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: {
      ...catalog.summary,
      changedRegionCount: changedRegions.length,
    },
    changedRegions,
  }, null, 2));
}

main();
