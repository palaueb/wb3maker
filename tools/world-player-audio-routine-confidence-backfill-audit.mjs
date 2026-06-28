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
const toolName = 'tools/world-player-audio-routine-confidence-backfill-audit.mjs';
const catalogId = 'world-player-audio-routine-confidence-backfill-catalog-2026-06-26';
const reportId = 'player-audio-routine-confidence-backfill-audit-2026-06-26';
const schemaVersion = 1;

const evidenceFamilies = {
  player_physics_collision: new Set([
    'collisionBoundAudit',
    'collisionBufferLookupCallsites',
    'collisionBufferProvenanceAudit',
    'playerPhysicsRoutineAudit',
    'playerPhysicsStateEffectAudit',
  ]),
  player_state_runtime: new Set([
    'playerFormAudit',
    'playerRuntimeRoutineAudit',
    'playerStateAudit',
    'playerStatePhysicsFlowAudit',
  ]),
  password_game_state: new Set([
    'passwordRoutineAudit',
  ]),
  audio_runtime: new Set([
    'audioDriverRoutineAudit',
    'audioStreamRoutineAudit',
    'bank3AudioFragmentAudit',
  ]),
};

const allEvidenceKeys = new Set(Object.values(evidenceFamilies).flatMap(keys => [...keys]));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isMissingConfidence(region) {
  return region.confidence === undefined || region.confidence === null || region.confidence === '';
}

function wasGeneratedByThisAudit(region) {
  return region.analysis?.playerAudioRoutineConfidenceBackfillAudit?.catalogId === catalogId;
}

function compactRegion(region) {
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    bank: region.bank ?? bankFromOffset(region.offset),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function bankFromOffset(offset) {
  if (typeof offset !== 'string') return null;
  const value = parseInt(offset.replace(/^\$/, '0x'), 16);
  if (!Number.isFinite(value)) return null;
  return Math.floor(value / 0x4000);
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
    .filter(([key, value]) => isSelectedEvidence(key, value))
    .map(([key, value]) => ({
      key,
      family: evidenceFamilyForKey(key),
      kind: value.kind || '',
      confidence: value.confidence || '',
      catalogId: value.catalogId || '',
      tool: value.tool || '',
      summary: value.summary || '',
    }))
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence)
      || a.family.localeCompare(b.family)
      || a.key.localeCompare(b.key));
}

function confidenceRank(confidence) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium_high') return 2;
  return 0;
}

function evidenceFamilyForKey(key) {
  for (const [family, keys] of Object.entries(evidenceFamilies)) {
    if (keys.has(key)) return family;
  }
  return 'unknown';
}

function isSelectedEvidence(key, value) {
  if (!allEvidenceKeys.has(key)) return false;
  if (!value || typeof value !== 'object') return false;
  return ['high', 'medium_high'].includes(value.confidence);
}

function eligibleRegion(region) {
  if (region.type !== 'code') return false;
  if (!isMissingConfidence(region) && !wasGeneratedByThisAudit(region)) return false;
  return selectedEvidenceEntries(region).length > 0;
}

function confidenceFromEvidence(evidence) {
  return evidence.some(item => item.confidence === 'high') ? 'high' : 'medium_high';
}

function buildCatalog(mapData) {
  const entries = (mapData.regions || [])
    .filter(eligibleRegion)
    .map(region => {
      const evidence = selectedEvidenceEntries(region);
      const existingAudit = region.analysis?.playerAudioRoutineConfidenceBackfillAudit || null;
      return {
        ...compactRegion(region),
        confidence: confidenceFromEvidence(evidence),
        topLevelConfidenceBefore: existingAudit?.topLevelConfidenceBefore ?? (region.confidence ?? null),
        evidenceFamilyCounts: countBy(evidence, item => item.family),
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
      'world-player-physics-routine-catalog-2026-06-25',
      'world-player-runtime-routine-catalog-2026-06-25',
      'world-player-state-catalog-2026-06-25',
      'world-password-routine-catalog-2026-06-25',
      'world-audio-stream-routine-catalog-2026-06-25',
      'world-audio-driver-routine-catalog-2026-06-25',
    ],
    assetPolicy: 'Metadata only: routine ids, offsets, sizes, subsystem families, evidence audit keys, catalog ids, and aggregate counts. No ROM bytes, instruction bytes, audio stream bytes, decoded assets, screenshots, pixels, or hashes are embedded.',
    selectionRule: {
      includedType: 'code',
      evidenceFamilies: Object.fromEntries(Object.entries(evidenceFamilies).map(([family, keys]) => [family, [...keys].sort()])),
      evidenceRule: 'A code region must already have high or medium_high evidence from one of the selected player, collision, password, or audio runtime audits. Generic ASM labels, callsite-only evidence, scene/menu/entity behavior audits, and inferred metadata do not qualify.',
      overwriteRule: 'Only missing top-level confidence is filled, except entries previously generated by this same audit for idempotent refresh.',
    },
    summary: {
      eligibleRegionCount: entries.length,
      totalEligibleBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
      byBank: countBy(entries, entry => entry.bank === null ? '' : String(entry.bank).padStart(2, '0')),
      confidenceCounts: countBy(entries, entry => entry.confidence),
      subsystemFamilyCounts: countBy(entries.flatMap(entry => Object.entries(entry.evidenceFamilyCounts)
        .flatMap(([family, count]) => Array(count).fill(family))), family => family),
      evidenceKeyCounts: countBy(entries.flatMap(entry => entry.evidenceKeys), key => key),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
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
      region.analysis.playerAudioRoutineConfidenceBackfillAudit = {
        catalogId,
        kind: 'player_audio_runtime_routine_top_level_confidence_backfill',
        confidence: entry.confidence,
        topLevelConfidenceBefore,
        topLevelConfidenceAfter: entry.confidence,
        evidenceFamilyCounts: entry.evidenceFamilyCounts,
        evidenceKeys: evidence.map(item => item.key),
        evidence: evidence.slice(0, 8),
        summary: 'Backfilled top-level confidence for player, collision, password, or audio runtime code routines from existing subsystem evidence.',
        generatedAt: now,
        tool: toolName,
      };
    }

    changedRegions.push({
      ...compactRegion(region),
      confidence: entry.confidence,
      topLevelConfidenceBefore,
      evidenceFamilyCounts: entry.evidenceFamilyCounts,
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
    mapData.playerRuntimeCatalogs = (mapData.playerRuntimeCatalogs || []).filter(item => item.id !== catalogId);
    mapData.playerRuntimeCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_audio_routine_confidence_backfill_audit',
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
        'Selected code regions already carry high or medium_high player, collision, password, or audio runtime evidence in map.json.',
        'Generic ASM label/incbin evidence, inferred metadata, scene/menu/entity behavior audits, and callsite-only evidence are excluded.',
        'This audit promotes routine metadata confidence; it does not claim frame-perfect behavior reconstruction is complete.',
        'No ROM bytes, instruction bytes, audio stream bytes, decoded assets, screenshots, pixels, or hashes are persisted.',
      ],
      nextLeads: [
        'Trace RAM read/write effects for the promoted player physics routines into frame-by-frame movement and collision formulas.',
        'Use the promoted audio runtime routines to build read-only PSG/FM stream-state previews before playback reconstruction.',
        'Keep scene/menu/entity behavior code in separate routine-confidence passes so subsystem scope stays reviewable.',
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
