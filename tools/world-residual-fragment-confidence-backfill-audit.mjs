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
const toolName = 'tools/world-residual-fragment-confidence-backfill-audit.mjs';
const catalogId = 'world-residual-fragment-confidence-backfill-catalog-2026-06-26';
const reportId = 'residual-fragment-confidence-backfill-audit-2026-06-26';
const schemaVersion = 1;

const evidenceKeys = new Set([
  'asmDataLabelCodeRegionResolutionAudit',
  'bank0CodeFragmentAudit',
  'bank2EffectScriptAudit',
  'c3c0FrameStepHelperGapAudit',
  'cf52Cf54EntryTableStructureAudit',
  'cf52Cf54WriteCoverageAudit',
  'entityBehaviorFragmentAudit',
  'finalFragmentAudit',
  'finalInferredCleanupAudit',
  'smallFragmentCleanupAudit',
]);

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
  return region.analysis?.residualFragmentConfidenceBackfillAudit?.catalogId === catalogId;
}

function confidenceRank(confidence) {
  if (confidence === 'high' || confidence === 'high_for_indexing_and_region_size') return 3;
  if (confidence === 'medium_high') return 2;
  if (confidence === 'medium') return 1;
  return 0;
}

function confidenceFromEvidence(evidence) {
  const rank = Math.max(...evidence.map(item => confidenceRank(item.confidence)), 0);
  if (rank >= 3) return 'high';
  if (rank === 2) return 'medium_high';
  return 'medium';
}

function evidenceFamily(key, value) {
  if (key === 'finalInferredCleanupAudit' && /^sms_header_/.test(value.kind || '')) return 'sms_header_metadata';
  if (key === 'bank2EffectScriptAudit' || /padding/i.test(value.kind || '')) return 'terminal_padding';
  if (key === 'entityBehaviorFragmentAudit' || key === 'asmDataLabelCodeRegionResolutionAudit') return 'entity_behavior_fragment';
  if (key === 'cf52Cf54EntryTableStructureAudit' || key === 'cf52Cf54WriteCoverageAudit') return 'structured_status_table';
  return 'residual_code_or_data_fragment';
}

function selectedEvidenceEntries(region) {
  return Object.entries(region.analysis || {})
    .filter(([key, value]) => isSelectedEvidence(region, key, value))
    .map(([key, value]) => ({
      key,
      family: evidenceFamily(key, value),
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

function isSelectedEvidence(region, key, value) {
  if (!evidenceKeys.has(key)) return false;
  if (!value || typeof value !== 'object') return false;
  const rank = confidenceRank(value.confidence);
  if (!rank) return false;

  if (key === 'finalInferredCleanupAudit') {
    return /^sms_header_/.test(value.kind || '') && rank >= 3;
  }
  if (key === 'entityBehaviorFragmentAudit') {
    return region.type === 'code' && rank >= 1 && !!region.analysis?.asmDataLabelCodeRegionResolutionAudit;
  }
  if (key === 'asmDataLabelCodeRegionResolutionAudit') {
    return region.type === 'code' && rank >= 1 && !!region.analysis?.entityBehaviorFragmentAudit;
  }
  if (key === 'cf52Cf54WriteCoverageAudit' || key === 'cf52Cf54EntryTableStructureAudit') {
    return region.type === 'data_table' && rank >= 3;
  }
  if (key === 'bank2EffectScriptAudit') {
    return region.type === 'null' && rank >= 1;
  }
  return rank >= 1;
}

function isExcludedQuarantinedAsset(region) {
  if (region.type !== 'meta_sprite') return false;
  if (region.analysis?.blankMetaspriteTargetAudit) return true;
  return /quarant/i.test(`${region.name || ''} ${region.notes || ''}`);
}

function eligibleRegion(region) {
  if (!region.type || region.type === 'unknown') return false;
  if (!isMissingConfidence(region) && !wasGeneratedByThisAudit(region)) return false;
  if (isExcludedQuarantinedAsset(region)) return false;
  return selectedEvidenceEntries(region).length > 0;
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
      const existingAudit = region.analysis?.residualFragmentConfidenceBackfillAudit || null;
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
      'world-final-fragments-catalog-2026-06-24',
      'world-final-inferred-cleanup-catalog-2026-06-25',
      'world-bank0-code-fragment-catalog-2026-06-24',
      'world-small-fragment-cleanup-catalog-2026-06-24',
      'world-entity-behavior-fragment-catalog-2026-06-24',
      'world-asm-data-label-code-region-resolution-catalog-2026-06-25',
    ],
    assetPolicy: 'Metadata only: residual region ids, offsets, sizes, types, confidence values, evidence audit keys, catalog ids, and aggregate counts. No ROM bytes, instruction bytes, text payloads, decoded graphics, pixels, screenshots, audio payloads, or hashes are embedded.',
    selectionRule: {
      evidenceKeys: [...evidenceKeys].sort(),
      evidenceRule: 'Backfills remaining typed fragments only when focused final-fragment, code-fragment, SMS-header, entity-behavior-tail, terminal-padding, or structured-table evidence exists. Manual-only, inferred-only, ASM-label-only, stale-screen-prog cleanup-only, and quarantined blank metasprite entries do not qualify.',
      confidenceRule: 'Top-level confidence mirrors the strongest selected evidence; high_for_indexing_and_region_size is treated as high for table-boundary confidence.',
      overwriteRule: 'Only missing top-level confidence is filled, except entries previously generated by this same audit for idempotent refresh.',
    },
    summary: {
      eligibleRegionCount: entries.length,
      totalEligibleBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
      byType: countBy(entries, entry => entry.type),
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
      region.analysis.residualFragmentConfidenceBackfillAudit = {
        catalogId,
        kind: 'residual_fragment_top_level_confidence_backfill',
        confidence: entry.confidence,
        topLevelConfidenceBefore,
        topLevelConfidenceAfter: entry.confidence,
        evidenceFamilyCounts: entry.evidenceFamilyCounts,
        evidenceKeys: evidence.map(item => item.key),
        evidence: evidence.slice(0, 8),
        summary: 'Backfilled top-level confidence for residual typed fragments from focused fragment, header, table, padding, or behavior-tail evidence.',
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
    mapData.assetCoverageCatalogs = (mapData.assetCoverageCatalogs || []).filter(item => item.id !== catalogId);
    mapData.assetCoverageCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'residual_fragment_confidence_backfill_audit',
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
