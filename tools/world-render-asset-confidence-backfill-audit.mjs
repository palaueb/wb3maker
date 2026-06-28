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
const toolName = 'tools/world-render-asset-confidence-backfill-audit.mjs';
const catalogId = 'world-render-asset-confidence-backfill-catalog-2026-06-26';
const reportId = 'render-asset-confidence-backfill-audit-2026-06-26';
const schemaVersion = 1;

const directRenderTypes = new Set([
  'gfx_tiles',
  'palette',
  'palette_script',
  'palette_script_table',
  'screen_prog',
  'screen_prog_table',
  'tile_map',
  'vram_loader_8fb',
  'vram_loader_998',
]);

const supportTypes = new Set(['data_table', 'pointer_table', 'text']);

const genericEvidenceKeys = new Set([
  'asmDataLabelCensusAudit',
  'asmIncbinSpanAudit',
  'asmLabelRegionAudit',
  'assetConfidenceBackfillAudit',
  'audioAssetConfidenceBackfillAudit',
  'inferred',
  'renderAssetConfidenceBackfillAudit',
  'staleScreenProgMetadataAudit',
]);

const evidencePrefixes = [
  'dc2Scroll',
  'dc2TilePair',
  'dynamicTile',
  'graphics',
  'loaderBoundary',
  'palette',
  'roomAsset',
  'screenProg',
  'smallData',
  'statusTile',
  'statusVdp',
  'tileSource',
  'vram',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isMissingConfidence(region) {
  return region.confidence === undefined || region.confidence === null || region.confidence === '';
}

function wasGeneratedByThisAudit(region) {
  return region.analysis?.renderAssetConfidenceBackfillAudit?.catalogId === catalogId;
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
  return Object.entries(region.analysis || {})
    .filter(([key, value]) => isRenderEvidence(key, value))
    .map(([key, value]) => ({
      key,
      kind: value.kind || '',
      confidence: value.confidence || '',
      catalogId: value.catalogId || '',
      tool: value.tool || '',
      summary: value.summary || '',
    }))
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence)
      || a.key.localeCompare(b.key));
}

function confidenceRank(confidence) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium_high') return 2;
  return 0;
}

function isRenderEvidence(key, value) {
  if (!value || typeof value !== 'object') return false;
  if (genericEvidenceKeys.has(key)) return false;
  if (!['high', 'medium_high'].includes(value.confidence)) return false;
  const haystack = `${key} ${value.kind || ''}`.toLowerCase();
  if (['candidate', 'false', 'lead', 'residual', 'unresolved'].some(fragment => haystack.includes(fragment))) return false;
  return evidencePrefixes.some(prefix => key.startsWith(prefix));
}

function hasRenderSupportName(region) {
  const text = `${region.name || ''} ${region.notes || ''}`.toUpperCase();
  return ['PALETTE', 'SCREEN', 'STATUS', 'TILE', 'VDP', 'VRAM', 'TEXT', 'SCROLL'].some(token => text.includes(token));
}

function eligibleRegion(region) {
  if (!isMissingConfidence(region) && !wasGeneratedByThisAudit(region)) return false;
  const evidence = selectedEvidenceEntries(region);
  if (!evidence.length) return false;
  if (directRenderTypes.has(region.type)) return true;
  if (supportTypes.has(region.type)) return hasRenderSupportName(region);
  return false;
}

function confidenceFromEvidence(evidence) {
  return evidence.some(item => item.confidence === 'high') ? 'high' : 'medium_high';
}

function buildCatalog(mapData) {
  const entries = (mapData.regions || [])
    .filter(eligibleRegion)
    .map(region => {
      const evidence = selectedEvidenceEntries(region);
      const existingAudit = region.analysis?.renderAssetConfidenceBackfillAudit || null;
      return {
        ...compactRegion(region),
        confidence: confidenceFromEvidence(evidence),
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
    sourceCatalogs: [
      'world-screen-prog-catalog-2026-06-24',
      'world-tile-source-catalog-2026-06-24',
      'world-palette-table-catalog-2026-06-24',
      'world-palette-script-catalog-2026-06-25',
    ],
    assetPolicy: 'Metadata only: rendering asset region ids, offsets, sizes, types, confidence values, evidence audit keys, catalog ids, and aggregate counts. No ROM bytes, decoded graphics, palettes, pixels, screenshots, or text payloads are embedded.',
    selectionRule: {
      directRenderTypes: [...directRenderTypes].sort(),
      supportTypes: [...supportTypes].sort(),
      evidenceRule: 'Direct rendering asset types require existing high or medium_high rendering/palette/tile-source evidence. Support pointer/data/text regions also require render-like naming.',
      overwriteRule: 'Only missing top-level confidence is filled, except entries previously generated by this same audit for idempotent refresh.',
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
      region.analysis.renderAssetConfidenceBackfillAudit = {
        catalogId,
        kind: 'render_asset_top_level_confidence_backfill',
        confidence: entry.confidence,
        topLevelConfidenceBefore,
        topLevelConfidenceAfter: entry.confidence,
        evidenceKeys: evidence.map(item => item.key),
        evidence: evidence.slice(0, 8),
        summary: 'Backfilled top-level confidence for rendering asset regions from existing rendering/palette/tile-source evidence.',
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
      type: 'render_asset_confidence_backfill_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      catalogId,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        changedRegionCount: changedRegions.length,
      },
      changedRegions,
      evidence: [
        'Selected regions already carry high or medium_high rendering/palette/tile-source evidence in map.json.',
        'Generic ASM label/incbin evidence and candidate/lead/residual/unresolved evidence are excluded.',
        'Support pointer/data/text regions require render-like naming in addition to parser evidence.',
        'No ROM bytes, decoded graphics, palettes, pixels, screenshots, or text payloads are persisted.',
      ],
      nextLeads: [
        'Use the backfilled rendering list to prioritize unresolved VRAM provenance and screen recipe smoke tests.',
        'Split support pointer/data regions into stricter subtypes only after a parser proves their record layout.',
        'Continue keeping candidate/lead-only rendering regions below top-level confidence until their consumers are proven.',
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
