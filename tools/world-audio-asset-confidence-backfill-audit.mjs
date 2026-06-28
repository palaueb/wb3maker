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
const toolName = 'tools/world-audio-asset-confidence-backfill-audit.mjs';
const catalogId = 'world-audio-asset-confidence-backfill-catalog-2026-06-26';
const reportId = 'audio-asset-confidence-backfill-audit-2026-06-26';
const schemaVersion = 1;

const audioRegionTypes = new Set(['audio_driver_data', 'music']);
const optionalAudioSupportTypes = new Set(['pointer_table', 'data_table']);
const genericEvidenceKeys = new Set([
  'asmDataLabelCensusAudit',
  'asmIncbinSpanAudit',
  'asmLabelRegionAudit',
  'assetConfidenceBackfillAudit',
  'audioAssetConfidenceBackfillAudit',
  'inferred',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isMissingConfidence(region) {
  return region.confidence === undefined || region.confidence === null || region.confidence === '';
}

function wasGeneratedByThisAudit(region) {
  return region.analysis?.audioAssetConfidenceBackfillAudit?.catalogId === catalogId;
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

function isAudioEvidenceKey(key) {
  return key.startsWith('audio')
    || key === 'pointerTableDetailAudit'
    || key === 'bank3AudioFragmentAudit';
}

function selectedEvidenceEntries(region) {
  const analysis = region.analysis || {};
  return Object.entries(analysis)
    .filter(([key, value]) => isAudioEvidence(key, value))
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
  if (confidence === 'medium') return 1;
  return 0;
}

function isAudioEvidence(key, value) {
  if (!value || typeof value !== 'object') return false;
  if (genericEvidenceKeys.has(key)) return false;
  if (!['high', 'medium_high'].includes(value.confidence)) return false;
  if (!isAudioEvidenceKey(key)) return false;
  return true;
}

function hasAudioName(region) {
  const text = `${region.name || ''} ${region.notes || ''}`.toUpperCase();
  return text.includes('FM SONG') || text.includes('AUDIO') || text.includes('SOUND') || text.includes('MUSIC');
}

function eligibleRegion(region) {
  if (!isMissingConfidence(region) && !wasGeneratedByThisAudit(region)) return false;
  const evidence = selectedEvidenceEntries(region);
  if (audioRegionTypes.has(region.type)) return evidence.length > 0;
  if (optionalAudioSupportTypes.has(region.type)) return evidence.length > 0 && hasAudioName(region);
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
      const existingAudit = region.analysis?.audioAssetConfidenceBackfillAudit || null;
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
      'world-audio-catalog-2026-06-24',
      'world-audio-region-coverage-catalog-2026-06-25',
      'world-audio-stream-graph-catalog-2026-06-25',
      'world-audio-stream-graph-usage-catalog-2026-06-25',
    ],
    assetPolicy: 'Metadata only: audio region ids, offsets, sizes, region types, confidence values, evidence audit keys, catalog ids, and aggregate counts. No music bytes, PSG/FM stream bytes, decoded audio, samples, or hashes are embedded.',
    selectionRule: {
      includedTypes: [...audioRegionTypes].sort(),
      optionalSupportTypes: [...optionalAudioSupportTypes].sort(),
      evidenceRule: 'Music/audio_driver_data regions require existing high or medium_high audio semantic evidence. Pointer/data support regions also require audio-like naming so generic pointer tables are not swept in.',
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
      persistedAudioByteCount: 0,
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
      region.analysis.audioAssetConfidenceBackfillAudit = {
        catalogId,
        kind: 'audio_asset_top_level_confidence_backfill',
        confidence: entry.confidence,
        topLevelConfidenceBefore,
        topLevelConfidenceAfter: entry.confidence,
        evidenceKeys: evidence.map(item => item.key),
        evidence: evidence.slice(0, 8),
        summary: 'Backfilled top-level confidence for audio/music asset regions from existing audio semantic evidence.',
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
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_asset_confidence_backfill_audit',
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
        'Selected regions already carry high or medium_high audio semantic evidence in map.json.',
        'The audit excludes generic ASM label/incbin evidence and does not classify code routines.',
        'Pointer/data support regions require audio-like naming in addition to audio evidence.',
        'No music stream bytes, decoded audio, PSG/FM payloads, samples, or hashes are persisted.',
      ],
      nextLeads: [
        'Use the now-confident audio/music region list to build read-only stream previews from ROM-local bytes in the browser.',
        'Link audio request callsites to these stream regions so gameplay state can request music/SFX by symbolic metadata.',
        'Keep PSG/FM playback reconstruction separate until opcode timing and channel-state metadata are complete.',
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
