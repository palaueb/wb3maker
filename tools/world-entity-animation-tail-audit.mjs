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
const catalogId = 'world-entity-animation-tail-catalog-2026-06-24';
const reportId = 'entity-animation-tail-audit-2026-06-24';

const REGION_UPDATES = [
  {
    offset: 0x197E6,
    inferredType: 'entity_anim_script',
    role: 'split_entity_animation_stream_tail',
    confidence: 'high',
    summary: 'Two-byte tail of the _DATA_197D9_ animation stream, split out as a false screen-program candidate.',
    evidence: [
      'ASM lines 27345-27349 define _DATA_197A8_ as a 17-entry child animation pointer table indexed by _RAM_C3CF_.',
      'ASM line 27347 points table entry 3 at _DATA_197D9_.',
      'ASM lines 27357-27359 mark _DATA_197D9_ as a 15-byte stream covering 0x197D9-0x197E7.',
      'The current map already types 0x197D9-0x197E5 as entity_anim_script; 0x197E6-0x197E7 is the remaining tail of that same ASM stream.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x197E6.',
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

function shouldRetype(region, inferredType) {
  if (!region) return false;
  const current = region.type || 'unknown';
  if (current === inferredType) return false;
  if (inferredType === 'entity_anim_script') return ['screen_prog', 'unknown', 'raw_byte', 'data_table'].includes(current);
  return false;
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-entity-animation-tail-audit.mjs',
    summary: {
      regionsAudited: REGION_UPDATES.length,
      splitTailRegions: REGION_UPDATES.length,
      parentTable: '_DATA_197A8_',
      parentTableRomOffset: hex(0x197A8),
      assetPolicy: 'Metadata only: offsets, labels, table references, stream roles, and confidence. No ROM bytes, decoded sprites, graphics, music, or text are embedded.',
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

function annotateRegion(region, item) {
  const typeBefore = region.type || 'unknown';
  const changedType = shouldRetype(region, item.inferredType);
  if (changedType) region.type = item.inferredType;
  region.analysis = region.analysis || {};
  region.analysis.entityAnimationTailAudit = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: 'tools/world-entity-animation-tail-audit.mjs',
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
  for (const entry of catalog.entries) {
    const item = REGION_UPDATES.find(update => hex(update.offset) === entry.offset);
    const region = findExactRegion(mapData, parseInt(entry.offset, 16));
    if (!region || !item) {
      missing.push({ offset: entry.offset, inferredType: entry.inferredType, role: entry.role });
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
    .filter(region => region.analysis?.entityAnimationTailAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.entityAnimationTailAudit.kind,
      confidence: region.analysis.entityAnimationTailAudit.confidence,
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
      type: 'entity_animation_tail_audit',
      generatedAt: now,
      tool: 'tools/world-entity-animation-tail-audit.mjs --apply',
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
        'Teach the entity animation audit to detect ASM stream ranges split across adjacent map regions and flag tail fragments automatically.',
        'Review other unexplained two-byte screen_prog candidates for similar split-tail evidence before preserving them as render roots.',
        'Keep split-tail annotations separate from range merging until the map editor has safe tooling for non-destructive region joins.',
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
