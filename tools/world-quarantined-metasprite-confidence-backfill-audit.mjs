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
const toolName = 'tools/world-quarantined-metasprite-confidence-backfill-audit.mjs';
const catalogId = 'world-quarantined-metasprite-confidence-backfill-catalog-2026-06-26';
const reportId = 'quarantined-metasprite-confidence-backfill-audit-2026-06-26';
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
  return region.analysis?.quarantinedMetaspriteConfidenceBackfillAudit?.catalogId === catalogId;
}

function eligibleRegion(region) {
  if (region.type !== 'meta_sprite') return false;
  if (!isMissingConfidence(region) && !wasGeneratedByThisAudit(region)) return false;

  const blank = region.analysis?.blankMetaspriteTargetAudit;
  const c34e = region.analysis?.c34eMetaspriteFamilyAudit;
  const incbin = region.analysis?.asmIncbinSpanAudit;
  if (!blank || !c34e || !incbin) return false;
  if (blank.kind !== 'all_zero_metasprite_fragment') return false;
  if (blank.allZero !== true) return false;
  if (!Array.isArray(blank.roles) || !blank.roles.includes('c34e_pointer_table_blank_target')) return false;
  if (c34e.expression !== '_DATA_19B01_') return false;
  if (c34e.tableOffset !== '0x1071A') return false;
  return true;
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

function evidenceEntries(region) {
  const selected = [];
  for (const key of ['blankMetaspriteTargetAudit', 'c34eMetaspriteFamilyAudit', 'asmIncbinSpanAudit', 'asmDataLabelCensusAudit', 'asmLabelRegionAudit']) {
    const value = region.analysis?.[key];
    if (!value) continue;
    selected.push({
      key,
      kind: value.kind || '',
      confidence: value.confidence || '',
      catalogId: value.catalogId || '',
      tool: value.tool || '',
      summary: value.summary || '',
    });
  }
  return selected;
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
      const evidence = evidenceEntries(region);
      const blank = region.analysis.blankMetaspriteTargetAudit;
      const c34e = region.analysis.c34eMetaspriteFamilyAudit;
      const existingAudit = region.analysis?.quarantinedMetaspriteConfidenceBackfillAudit || null;
      return {
        ...compactRegion(region),
        confidence: 'medium',
        topLevelConfidenceBefore: existingAudit?.topLevelConfidenceBefore ?? (region.confidence ?? null),
        classification: 'quarantined_all_zero_c34e_metasprite_target',
        c34eTableOffset: c34e.tableOffset,
        c34eTableIndex: c34e.tableIndex,
        c34eExpression: c34e.expression,
        byteClass: blank.byteClass || null,
        decodePolicy: blank.decodePolicy || '',
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
      'world-blank-metasprite-target-catalog-2026-06-26',
      'world-c34e-metasprite-family-catalog-2026-06-24',
      'world-asm-incbin-span-catalog-2026-06-25',
      'world-asm-data-label-census-catalog-2026-06-25',
      'world-asm-label-region-catalog-2026-06-25',
    ],
    assetPolicy: 'Metadata only: region ids, offsets, sizes, table indexes, all-zero aggregate counts, confidence values, evidence audit keys, catalog ids, and decode policy. No ROM bytes, decoded graphics, pixels, screenshots, instruction bytes, text payloads, audio payloads, or hashes are embedded.',
    selectionRule: {
      includedType: 'meta_sprite',
      confidence: 'medium',
      evidenceRule: 'A region must be meta_sprite typed, lack top-level confidence, have blankMetaspriteTargetAudit allZero=true, be role-tagged c34e_pointer_table_blank_target, and be the _DATA_19B01_ entry from _DATA_1071A_.',
      decodePolicy: 'This pass does not mark the target as a normal decoded frame stream. It preserves quarantine/no-op semantics until a consumer-specific runtime trace identifies the selecting state.',
      overwriteRule: 'Only missing top-level confidence is filled, except entries previously generated by this same audit for idempotent refresh.',
    },
    summary: {
      eligibleRegionCount: entries.length,
      totalEligibleBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
      byBank: countBy(entries, entry => String(entry.bank).padStart(2, '0')),
      confidenceCounts: countBy(entries, entry => entry.confidence),
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
    const evidence = evidenceEntries(region);
    const topLevelConfidenceBefore = entry.topLevelConfidenceBefore;

    if (apply) {
      region.confidence = entry.confidence;
      region.analysis = region.analysis || {};
      region.analysis.quarantinedMetaspriteConfidenceBackfillAudit = {
        catalogId,
        kind: 'quarantined_all_zero_metasprite_target_top_level_confidence_backfill',
        confidence: entry.confidence,
        topLevelConfidenceBefore,
        topLevelConfidenceAfter: entry.confidence,
        classification: entry.classification,
        c34eTableOffset: entry.c34eTableOffset,
        c34eTableIndex: entry.c34eTableIndex,
        c34eExpression: entry.c34eExpression,
        byteClass: entry.byteClass,
        decodePolicy: entry.decodePolicy,
        evidenceKeys: evidence.map(item => item.key),
        evidence: evidence.slice(0, 8),
        summary: 'Backfilled medium top-level confidence for the all-zero _DATA_19B01_ C34E table target while preserving quarantined/no-op decode semantics.',
        generatedAt: now,
        tool: toolName,
      };
      const note = 'Audit: medium-confidence quarantined all-zero C34E metasprite target; do not decode as a normal frame stream without consumer-specific evidence.';
      if (!String(region.notes || '').includes(note)) {
        region.notes = `${region.notes || ''}${region.notes ? ' ' : ''}${note}`;
      }
    }

    changedRegions.push({
      ...compactRegion(region),
      confidence: entry.confidence,
      topLevelConfidenceBefore,
      classification: entry.classification,
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
    mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(item => item.id !== catalogId);
    mapData.metaspriteCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'quarantined_metasprite_confidence_backfill_audit',
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
      nextLeads: [
        'Trace writes or state derivation for _RAM_C34E_ so table index 0 can be named by gameplay state.',
        'Keep _DATA_19B01_ out of normal frame-stream decoding until a bounded consumer-specific interpretation is proven.',
      ],
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
