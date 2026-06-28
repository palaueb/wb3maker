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
const catalogId = 'world-bank1-menu-object-catalog-2026-06-24';
const reportId = 'bank1-menu-object-audit-2026-06-24';

const REGION_UPDATES = [
  {
    offset: 0x43FD,
    inferredType: 'entity_data',
    role: 'menu_object_init_record_stream',
    confidence: 'high',
    summary: '_LABEL_423A_ passes this record stream to _LABEL_43B8_, which initializes menu/selection object slots in IX.',
    evidence: [
      'ASM line 10292 loads HL with _DATA_43FD_.',
      'ASM line 10293 calls _LABEL_43B8_ with IX pointing at _RAM_C280_.',
      'ASM lines 10425-10460: _LABEL_43B8_ reads a count, then copies five word fields plus one byte into 0x40-byte IX object slots.',
    ],
  },
  {
    offset: 0x4440,
    inferredType: 'pointer_table',
    role: 'menu_object_init_pointer_pair',
    confidence: 'high',
    summary: 'Pointer-pair header selected through _DATA_4537_ and consumed by _LABEL_43B8_.',
    evidence: [
      'ASM lines 10597-10599: _DATA_4537_ indexes _DATA_4440_, _DATA_444C_, and _DATA_4458_.',
      'ASM lines 10547-10555: selected _DATA_4537_ target is passed to _LABEL_43B8_.',
      'ASM lines 10435-10449: _LABEL_43B8_ consumes word fields from the selected record stream.',
    ],
  },
  {
    offset: 0x4444,
    inferredType: 'entity_data',
    role: 'menu_object_init_record_tail',
    confidence: 'high',
    summary: 'Record data immediately following the _DATA_4440_ pointer-pair header consumed by _LABEL_43B8_.',
    evidence: [
      'ASM lines 10470-10476: _DATA_4440_ is a pointer-pair header followed by an 8-byte record tail.',
      'ASM lines 10547-10555: this record stream is selected by _RAM_D108_ and passed to _LABEL_43B8_.',
    ],
  },
  {
    offset: 0x444C,
    inferredType: 'pointer_table',
    role: 'menu_object_init_pointer_pair',
    confidence: 'high',
    summary: 'Pointer-pair header selected through _DATA_4537_ and consumed by _LABEL_43B8_.',
    evidence: [
      'ASM lines 10597-10599: _DATA_4537_ indexes _DATA_4440_, _DATA_444C_, and _DATA_4458_.',
      'ASM lines 10547-10555: selected _DATA_4537_ target is passed to _LABEL_43B8_.',
    ],
  },
  {
    offset: 0x4450,
    inferredType: 'entity_data',
    role: 'menu_object_init_record_tail',
    confidence: 'high',
    summary: 'Record data immediately following the _DATA_444C_ pointer-pair header consumed by _LABEL_43B8_.',
    evidence: [
      'ASM lines 10478-10484: _DATA_444C_ is a pointer-pair header followed by an 8-byte record tail.',
      'ASM lines 10547-10555: this record stream is selected by _RAM_D108_ and passed to _LABEL_43B8_.',
    ],
  },
  {
    offset: 0x4458,
    inferredType: 'pointer_table',
    role: 'menu_object_init_pointer_pair',
    confidence: 'high',
    summary: 'Pointer-pair header selected through _DATA_4537_ and consumed by _LABEL_43B8_.',
    evidence: [
      'ASM lines 10597-10599: _DATA_4537_ indexes _DATA_4440_, _DATA_444C_, and _DATA_4458_.',
      'ASM lines 10547-10555: selected _DATA_4537_ target is passed to _LABEL_43B8_.',
    ],
  },
  {
    offset: 0x445C,
    inferredType: 'entity_data',
    role: 'menu_object_init_record_tail',
    confidence: 'high',
    summary: 'Record data immediately following the _DATA_4458_ pointer-pair header consumed by _LABEL_43B8_.',
    evidence: [
      'ASM lines 10486-10492: _DATA_4458_ is a pointer-pair header followed by an 8-byte record tail.',
      'ASM lines 10547-10555: this record stream is selected by _RAM_D108_ and passed to _LABEL_43B8_.',
    ],
  },
  {
    offset: 0x464B,
    inferredType: 'entity_anim_script',
    role: 'menu_object_motion_script',
    confidence: 'high',
    summary: '_LABEL_4486_ stores _DATA_464B_ as the active motion-script cursor; _LABEL_4586_ consumes records from that cursor.',
    evidence: [
      'ASM line 10526 loads HL with _DATA_464B_.',
      'ASM line 10527 stores that pointer in _RAM_D102_.',
      'ASM lines 10644-10675: _LABEL_4586_ reads motion records from IX+4/IX+5 cursor bytes and stores speed/duration fields.',
      'ASM line 10652 treats a zero byte as the end of the stream.',
    ],
  },
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

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-bank1-menu-object-audit.mjs',
    summary: {
      auditedRegions: REGION_UPDATES.length,
      objectInitLoader: '_LABEL_43B8_',
      motionScriptLoader: '_LABEL_4586_',
      assetPolicy: 'Metadata only: offsets, labels, routine references, record roles, and confidence. No ROM bytes, decoded graphics, or rendered menu data are embedded.',
    },
    entries: REGION_UPDATES.map(item => ({
      offset: hex(item.offset),
      inferredType: item.inferredType,
      role: item.role,
      confidence: item.confidence,
      summary: item.summary,
      evidence: item.evidence,
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
  };
}

function shouldRetype(region, inferredType) {
  if (!region) return false;
  const current = region.type || 'unknown';
  if (current === inferredType) return false;
  if (inferredType === 'pointer_table') return ['screen_prog', 'data_table', 'unknown', 'raw_byte'].includes(current);
  if (inferredType === 'entity_data') return ['screen_prog', 'data_table', 'unknown', 'raw_byte'].includes(current);
  if (inferredType === 'entity_anim_script') return ['screen_prog', 'data_table', 'unknown', 'raw_byte'].includes(current);
  return false;
}

function annotateRegion(region, item) {
  const typeBefore = region.type || 'unknown';
  const changedType = shouldRetype(region, item.inferredType);
  if (changedType) region.type = item.inferredType;
  region.analysis = region.analysis || {};
  region.analysis.bank1MenuObjectAudit = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: 'tools/world-bank1-menu-object-audit.mjs',
  };
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    typeBefore,
    typeAfter: region.type || typeBefore,
    changedType,
    kind: item.role,
  };
}

function applyAnnotations(mapData, catalog) {
  const changed = [];
  const evidenceOnly = [];
  const missing = [];
  for (const item of catalog.entries) {
    const region = findExactRegion(mapData, parseInt(item.offset, 16));
    if (!region) {
      missing.push({ offset: item.offset, inferredType: item.inferredType, role: item.role });
      continue;
    }
    const result = annotateRegion(region, item);
    if (result.changedType) changed.push(result);
    else evidenceOnly.push(result);
  }
  return { changed, evidenceOnly, missing };
}

function changedRegionRefs(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.bank1MenuObjectAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.bank1MenuObjectAudit.kind,
      confidence: region.analysis.bank1MenuObjectAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const changes = applyAnnotations(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.entityAnimationCatalogs = (mapData.entityAnimationCatalogs || []).filter(item => item.id !== catalogId);
    mapData.entityAnimationCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank1_menu_object_audit',
      generatedAt: now,
      tool: 'tools/world-bank1-menu-object-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changedRegionRefs(mapData).length,
        retypeChangesThisRun: changes.changed.length,
        evidenceOnlyRegions: changes.evidenceOnly.length,
        missingRegions: changes.missing.length,
      },
      changedRegions: changedRegionRefs(mapData),
      retypeChangesThisRun: changes.changed,
      evidenceOnlyRegions: changes.evidenceOnly,
      missingRegions: changes.missing,
      nextLeads: [
        'Create a small read-only parser for _LABEL_43B8_ object initialization records.',
        'Parse _LABEL_4586_ motion streams into per-record speed/duration summaries without exposing byte values.',
        'Trace _RAM_D108_ producers to name the three _DATA_4537_ menu object variants.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    retypeChanges: changes.changed,
    evidenceOnlyRegions: changes.evidenceOnly,
    missingRegions: changes.missing,
  }, null, 2));
}

main();
