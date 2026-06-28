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
const toolName = 'tools/world-remaining-structured-confidence-backfill-audit.mjs';
const catalogId = 'world-remaining-structured-confidence-backfill-catalog-2026-06-26';
const reportId = 'remaining-structured-confidence-backfill-audit-2026-06-26';
const schemaVersion = 1;

const evidenceKeys = new Set([
  'animationCallsiteAudit',
  'animationSpriteTileRangeAudit',
  'animationTileBaseAudit',
  'asmAssetAudit',
  'audioRequestCallsiteAudit',
  'bank0LookupDataAudit',
  'bank0ObjectStateTableAudit',
  'bank1MenuObjectAudit',
  'bank2EffectScriptAudit',
  'bank2MotionSequenceAudit',
  'bank2ObjectParamAudit',
  'bank2StateMachineAudit',
  'bank4EntityControlAudit',
  'bank7MenuItemAudit',
  'cf52Cf54EntryTableStructureAudit',
  'cf52Cf54WriteCoverageAudit',
  'd1aeTransitionControllerBridgeAudit',
  'dynamicVdpUploadCallerAudit',
  'entityObjectRecordAudit',
  'finalInferredCleanupAudit',
  'inputScriptAudit',
  'itemVramSelectorAudit',
  'paletteTableAudit',
  'playerFormAudit',
  'playerRuntimeRoutineAudit',
  'playerStateAudit',
  'pointerTableDetailAudit',
  'roomEventTableAudit',
  'screenProgAudit',
  'screenProgReachabilityAudit',
  'smallDataAudit',
  'statusTileSourceRangeAudit',
  'statusVdpWriterDetailAudit',
  'uiPlayerTransitionTableAudit',
  'uiTriggerRoutineAudit',
  'zoneDescriptorPointerFlowAudit',
  'zoneDescriptorPointerFlowConsumerAudit',
  'zoneTransitionCameraAdjustAudit',
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
  return region.analysis?.remainingStructuredConfidenceBackfillAudit?.catalogId === catalogId;
}

function confidenceRank(confidence) {
  if (confidence === 'high') return 3;
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

function isQuarantined(region) {
  if (region.analysis?.blankMetaspriteTargetAudit) return true;
  return /quarant/i.test(`${region.name || ''} ${region.notes || ''}`);
}

function selectedEvidenceEntries(region) {
  return Object.entries(region.analysis || {})
    .filter(([key, value]) => isSelectedEvidence(region, key, value))
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

function isSelectedEvidence(region, key, value) {
  if (!evidenceKeys.has(key)) return false;
  if (!value || typeof value !== 'object') return false;
  const rank = confidenceRank(value.confidence);
  if (!rank) return false;

  if (key === 'screenProgAudit' || key === 'screenProgReachabilityAudit') {
    return region.type === 'screen_prog' && rank >= 1;
  }
  if (key === 'finalInferredCleanupAudit') return region.type === 'code' && rank >= 3;
  if (key === 'smallDataAudit') return region.type !== 'code' && rank >= 3;
  if (key === 'asmAssetAudit') return region.type === 'tile_map' && rank >= 3;
  if (key === 'inputScriptAudit' || key === 'paletteTableAudit' || key === 'bank4EntityControlAudit') {
    return rank >= 3;
  }
  return rank >= 2;
}

function eligibleRegion(region) {
  if (!region.type || region.type === 'unknown') return false;
  if (!isMissingConfidence(region) && !wasGeneratedByThisAudit(region)) return false;
  if (region.type === 'meta_sprite' && isQuarantined(region)) return false;
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
  const regions = mapData.regions || [];
  const entries = regions
    .filter(eligibleRegion)
    .map(region => {
      const evidence = selectedEvidenceEntries(region);
      const existingAudit = region.analysis?.remainingStructuredConfidenceBackfillAudit || null;
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

  const excludedQuarantinedCount = regions.filter(region =>
    region.type !== 'unknown'
    && isMissingConfidence(region)
    && region.type === 'meta_sprite'
    && isQuarantined(region)
  ).length;

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      'world-final-inferred-cleanup-catalog-2026-06-25',
      'world-bank0-object-state-table-catalog-2026-06-25',
      'world-player-state-catalog-2026-06-25',
      'world-player-runtime-routine-catalog-2026-06-25',
      'world-small-data-catalog-2026-06-24',
      'world-screen-prog-catalog-2026-06-24',
      'world-screen-prog-reachability-catalog-2026-06-24',
      'world-zone-descriptor-pointer-flow-catalog-2026-06-25',
      'world-input-script-catalog-2026-06-24',
      'world-palette-table-catalog-2026-06-24',
    ],
    assetPolicy: 'Metadata only: region ids, offsets, sizes, types, confidence values, evidence audit keys, catalog ids, and aggregate counts. No ROM bytes, instruction bytes, text payloads, decoded graphics, pixels, screenshots, audio payloads, or hashes are embedded.',
    selectionRule: {
      includedTypes: [...new Set(entries.map(entry => entry.type))].sort(),
      evidenceKeys: [...evidenceKeys].sort(),
      evidenceRule: 'Backfills typed regions that already have focused high or medium_high parser/runtime/table evidence. screen_prog continuations may use paired medium screenProgAudit/screenProgReachabilityAudit evidence. Generic inferred, manual, ASM-label-only, stale-screen-prog cleanup, and final-fragment evidence are not sufficient.',
      quarantineRule: 'Quarantined blank metasprite fragments are intentionally excluded until a consumer-specific decoder proves a bounded interpretation.',
      overwriteRule: 'Only missing top-level confidence is filled, except entries previously generated by this same audit for idempotent refresh.',
    },
    summary: {
      eligibleRegionCount: entries.length,
      totalEligibleBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
      byType: countBy(entries, entry => entry.type),
      byBank: countBy(entries, entry => String(entry.bank).padStart(2, '0')),
      confidenceCounts: countBy(entries, entry => entry.confidence),
      evidenceKeyCounts: countBy(entries.flatMap(entry => entry.evidenceKeys), key => key),
      excludedQuarantinedCount,
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
      region.analysis.remainingStructuredConfidenceBackfillAudit = {
        catalogId,
        kind: 'remaining_structured_region_top_level_confidence_backfill',
        confidence: entry.confidence,
        topLevelConfidenceBefore,
        topLevelConfidenceAfter: entry.confidence,
        evidenceKeys: evidence.map(item => item.key),
        evidence: evidence.slice(0, 8),
        summary: 'Backfilled top-level confidence for typed structured regions from focused parser, runtime, dispatch-table, screen-program, or padding evidence.',
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
      type: 'remaining_structured_confidence_backfill_audit',
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
