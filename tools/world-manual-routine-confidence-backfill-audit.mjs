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
const toolName = 'tools/world-manual-routine-confidence-backfill-audit.mjs';
const catalogId = 'world-manual-routine-confidence-backfill-catalog-2026-06-26';
const reportId = 'manual-routine-confidence-backfill-audit-2026-06-26';
const schemaVersion = 1;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function numberFromValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const text = value.trim();
  if (!text) return 0;
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text, 16);
  if (/^\$[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(1), 16);
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  return 0;
}

function regionStart(region) {
  return numberFromValue(region.start ?? region.offset ?? region.address);
}

function regionSize(region) {
  return numberFromValue(region.size ?? region.length);
}

function regionOffset(region) {
  if (typeof region.offset === 'string' && region.offset) return region.offset;
  return hex(regionStart(region), 5);
}

function hex(value, width = 5) {
  return `0x${Math.max(0, value).toString(16).toUpperCase().padStart(width, '0')}`;
}

function bankFromRegion(region) {
  if (region.bank !== undefined && region.bank !== null && region.bank !== '') return region.bank;
  return Math.floor(regionStart(region) / 0x4000);
}

function isMissingConfidence(region) {
  return region.confidence === undefined || region.confidence === null || region.confidence === '';
}

function wasGeneratedByThisAudit(region) {
  return region.analysis?.manualRoutineConfidenceBackfillAudit?.catalogId === catalogId;
}

function confidenceRank(confidence) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium_high') return 2;
  if (confidence === 'medium') return 1;
  return 0;
}

function hasHighAsmLabelCoverage(region) {
  return region.analysis?.asmLabelRegionAudit?.confidence === 'high';
}

function selectedEvidenceEntries(region) {
  const entries = [];
  const manual = region.analysis?.manual;
  if (manual?.confidence === 'high' && hasHighAsmLabelCoverage(region)) {
    entries.push({
      key: 'manual',
      family: 'manual_asm_labeled_routine',
      kind: manual.kind || '',
      confidence: manual.confidence,
      catalogId: '',
      tool: '',
      summary: manual.summary || '',
    });
    const asm = region.analysis?.asmLabelRegionAudit;
    entries.push({
      key: 'asmLabelRegionAudit',
      family: 'manual_asm_labeled_routine',
      kind: asm.kind || '',
      confidence: asm.confidence || '',
      catalogId: asm.catalogId || '',
      tool: asm.tool || '',
      summary: asm.summary || '',
    });
  }

  const uiWriter = region.analysis?.uiPlayerTransitionTableAudit;
  if (uiWriter?.confidence === 'medium' && hasHighAsmLabelCoverage(region)) {
    entries.push({
      key: 'uiPlayerTransitionTableAudit',
      family: 'medium_ui_writer_routine',
      kind: uiWriter.kind || '',
      confidence: uiWriter.confidence,
      catalogId: uiWriter.catalogId || '',
      tool: uiWriter.tool || '',
      summary: uiWriter.summary || '',
    });
  }

  return entries.sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence)
    || a.family.localeCompare(b.family)
    || a.key.localeCompare(b.key));
}

function eligibleRegion(region) {
  if (region.type !== 'code') return false;
  if (!isMissingConfidence(region) && !wasGeneratedByThisAudit(region)) return false;
  return selectedEvidenceEntries(region).length > 0;
}

function confidenceFromEvidence(evidence) {
  return evidence.some(item => item.confidence === 'high') ? 'high' : 'medium';
}

function compactRegion(region) {
  return {
    id: region.id || '',
    offset: regionOffset(region),
    endExclusive: hex(regionStart(region) + regionSize(region), 5),
    size: regionSize(region),
    bank: bankFromRegion(region),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (key === undefined || key === null || key === '') continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function buildCatalog(mapData) {
  const entries = (mapData.regions || [])
    .filter(eligibleRegion)
    .map(region => {
      const evidence = selectedEvidenceEntries(region);
      const existingAudit = region.analysis?.manualRoutineConfidenceBackfillAudit || null;
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
      'world-asm-label-region-catalog-2026-06-25',
      'world-ui-player-transition-table-catalog-2026-06-25',
    ],
    assetPolicy: 'Metadata only: code region ids, offsets, sizes, labels, confidence values, evidence audit keys, catalog ids, and aggregate counts. No ROM bytes, instruction bytes, decoded assets, screenshots, pixels, audio payloads, or hashes are embedded.',
    selectionRule: {
      evidenceRule: 'Backfills the final code-only confidence gaps when a high-confidence manual routine annotation is backed by high ASM label coverage, or when a medium UI-writer routine audit is backed by high ASM label coverage.',
      excluded: 'Quarantined blank metasprite/data leads are intentionally excluded.',
      overwriteRule: 'Only missing top-level confidence is filled, except entries previously generated by this same audit for idempotent refresh.',
    },
    summary: {
      eligibleRegionCount: entries.length,
      totalEligibleBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
      byBank: countBy(entries, entry => String(entry.bank).padStart(2, '0')),
      confidenceCounts: countBy(entries, entry => entry.confidence),
      evidenceFamilyCounts: countBy(entries.flatMap(entry => Object.entries(entry.evidenceFamilyCounts)
        .flatMap(([family, count]) => Array(count).fill(family))), family => family),
      evidenceKeyCounts: countBy(entries.flatMap(entry => entry.evidenceKeys), key => key),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
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
      region.analysis.manualRoutineConfidenceBackfillAudit = {
        catalogId,
        kind: 'manual_or_medium_routine_top_level_confidence_backfill',
        confidence: entry.confidence,
        topLevelConfidenceBefore,
        topLevelConfidenceAfter: entry.confidence,
        evidenceFamilyCounts: entry.evidenceFamilyCounts,
        evidenceKeys: evidence.map(item => item.key),
        evidence: evidence.slice(0, 8),
        summary: 'Backfilled top-level confidence for final code-only gaps using manual routine annotations or UI-writer evidence backed by ASM label coverage.',
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
      type: 'manual_routine_confidence_backfill_audit',
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
      assetPolicy: catalog.assetPolicy,
    });

    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
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
