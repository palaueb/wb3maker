#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-c34e-metasprite-family-catalog-2026-06-24';
const reportId = 'c34e-metasprite-family-audit-2026-06-24';

const TABLE = {
  offset: 0x1071A,
  count: 8,
  index: '_RAM_C34E_',
  label: '_DATA_1071A_',
};

const ENTRIES = [
  { index: 0, expression: '_DATA_19B01_', targetOffset: 0x19B01, inferredType: 'meta_sprite', confidence: 'medium' },
  { index: 1, expression: '_DATA_1A1B0_', targetOffset: 0x1A1B0, inferredType: 'meta_sprite', confidence: 'high' },
  { index: 2, expression: '_DATA_1B486_', targetOffset: 0x1B486, inferredType: 'meta_sprite', confidence: 'high' },
  { index: 3, expression: '$2000 | _RAM_DF02_', targetOffset: null, inferredType: 'ram_buffer_sentinel', confidence: 'medium' },
  { index: 4, expression: '_DATA_1AA51_', targetOffset: 0x1AA51, inferredType: 'meta_sprite', confidence: 'high' },
  { index: 5, expression: '_DATA_18585_', targetOffset: 0x18585, inferredType: 'meta_sprite', confidence: 'high' },
  { index: 6, expression: '_DATA_18585_', targetOffset: 0x18585, inferredType: 'meta_sprite', confidence: 'high' },
  { index: 7, expression: '$2000 | _RAM_DF85_', targetOffset: null, inferredType: 'ram_buffer_sentinel', confidence: 'medium' },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function tableEvidence() {
  return [
    'ASM line 24693 defines _DATA_1071A_.',
    'ASM line 24694 emits the eight-entry _DATA_1071A_ word table, including _DATA_19B01_, _DATA_1A1B0_, _DATA_1B486_, _DATA_1AA51_, _DATA_18585_, and two RAM-buffer sentinel expressions.',
    'ASM lines 27474-27477 define _DATA_19B01_ as the first entry of the _DATA_1071A_ table.',
    'ASM lines 27479-27481 define _DATA_1A1B0_ as the second entry of the same table.',
    'ASM lines 27548-27550 define _DATA_1AA51_ as another entry of the same table, and ASM lines 26754-26756 define _DATA_18585_ as another target.',
    'Existing metasprite audit metadata already types the sibling ROM targets _DATA_18585_, _DATA_1A1B0_, _DATA_1AA51_, and _DATA_1B486_ as meta_sprite.',
    'screen_prog reachability audit marks _DATA_19B01_ unrooted by _LABEL_604_ and shows the byte-shape decoder walks outside the region.',
  ];
}

function buildCatalog(mapData) {
  const tableRegion = findExactRegion(mapData, TABLE.offset);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-c34e-metasprite-family-audit.mjs',
    table: {
      offset: hex(TABLE.offset),
      label: TABLE.label,
      count: TABLE.count,
      index: TABLE.index,
      region: regionRef(tableRegion),
    },
    entries: ENTRIES.map(entry => ({
      index: entry.index,
      expression: entry.expression,
      targetOffset: entry.targetOffset == null ? null : hex(entry.targetOffset),
      inferredType: entry.inferredType,
      confidence: entry.confidence,
      region: entry.targetOffset == null ? null : regionRef(findExactRegion(mapData, entry.targetOffset)),
    })),
    summary: {
      tableOffset: hex(TABLE.offset),
      tableEntries: ENTRIES.length,
      romTargets: ENTRIES.filter(entry => entry.targetOffset != null).length,
      ramSentinels: ENTRIES.filter(entry => entry.targetOffset == null).length,
      assetPolicy: 'Metadata only: table offsets, labels, target offsets, existing region ids, roles, and evidence. No ROM bytes or decoded sprites are embedded.',
    },
    evidence: tableEvidence(),
  };
}

function shouldRetype(region, inferredType) {
  if (!region) return false;
  const current = region.type || 'unknown';
  if (current === inferredType) return false;
  if (inferredType === 'meta_sprite') return ['screen_prog', 'data_table', 'raw_byte', 'unknown'].includes(current);
  return false;
}

function annotateTarget(region, entry) {
  const typeBefore = region.type || 'unknown';
  const changedType = shouldRetype(region, entry.inferredType);
  if (changedType) region.type = entry.inferredType;
  region.analysis = region.analysis || {};
  region.analysis.c34eMetaspriteFamilyAudit = {
    catalogId,
    kind: 'c34e_pointer_table_target',
    confidence: entry.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    tableOffset: hex(TABLE.offset),
    tableIndex: entry.index,
    expression: entry.expression,
    summary: 'Target belongs to the _DATA_1071A_/_RAM_C34E_ metasprite-family pointer table.',
    evidence: tableEvidence(),
    generatedAt: now,
    tool: 'tools/world-c34e-metasprite-family-audit.mjs',
  };
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    typeBefore,
    typeAfter: region.type || typeBefore,
    changedType,
    tableIndex: entry.index,
    confidence: entry.confidence,
  };
}

function applyAnnotations(mapData) {
  const changed = [];
  const evidenceOnly = [];
  const missing = [];
  const skipped = [];
  for (const entry of ENTRIES) {
    if (entry.targetOffset == null) {
      skipped.push({ index: entry.index, expression: entry.expression, reason: 'RAM-buffer sentinel, not a ROM region.' });
      continue;
    }
    const region = findExactRegion(mapData, entry.targetOffset);
    if (!region) {
      missing.push({ index: entry.index, offset: hex(entry.targetOffset), expression: entry.expression });
      continue;
    }
    if (entry.inferredType !== 'meta_sprite') {
      skipped.push({ index: entry.index, expression: entry.expression, reason: `No ROM retype rule for ${entry.inferredType}.` });
      continue;
    }
    const result = annotateTarget(region, entry);
    if (result.changedType) changed.push(result);
    else evidenceOnly.push(result);
  }
  return { changed, evidenceOnly, missing, skipped };
}

function changedRegionRefs(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.c34eMetaspriteFamilyAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      tableIndex: region.analysis.c34eMetaspriteFamilyAudit.tableIndex,
      confidence: region.analysis.c34eMetaspriteFamilyAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const changes = applyAnnotations(mapData);
  const catalog = buildCatalog(mapData);

  if (apply) {
    mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(item => item.id !== catalogId);
    mapData.metaspriteCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'c34e_metasprite_family_audit',
      generatedAt: now,
      tool: 'tools/world-c34e-metasprite-family-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        changedRegions: changedRegionRefs(mapData).length,
        retypeChangesThisRun: changes.changed.length,
        evidenceOnlyRegions: changes.evidenceOnly.length,
        missingRegions: changes.missing.length,
        skippedEntries: changes.skipped.length,
      },
      changedRegions: changedRegionRefs(mapData),
      retypeChangesThisRun: changes.changed,
      evidenceOnlyRegions: changes.evidenceOnly,
      missingRegions: changes.missing,
      skippedEntries: changes.skipped,
      evidence: catalog.evidence,
      nextLeads: [
        'Trace writes to _RAM_C34E_ to name the states that select each _DATA_1071A_ target.',
        'Decode _DATA_19B01_ with the same metasprite frame model used for its sibling bank-6 targets.',
        'Resolve the RAM-buffer sentinel entries $2000 | _RAM_DF02_ and $2000 | _RAM_DF85_ before assigning them a ROM asset type.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changed: changes.changed,
    evidenceOnly: changes.evidenceOnly,
    missing: changes.missing,
    skipped: changes.skipped,
  }, null, 2));
}

main();
