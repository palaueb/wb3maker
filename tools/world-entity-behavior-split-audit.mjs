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
const catalogId = 'world-entity-behavior-split-catalog-2026-06-24';
const reportId = 'entity-behavior-split-audit-2026-06-24';

const SPLIT = {
  sourceOffset: 0x06F80,
  tableSize: 8,
  codeOffset: 0x06F88,
  codeSize: 0x79,
  originalSize: 0x81,
  sourceRegionId: 'r0141',
  targetOffsets: ['0x06F88', '0x06FC3', '0x06FD1'],
};

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findExactRegion(mapData, offset) {
  return mapData.regions.find(region => parseInt(region.offset, 16) === offset) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id,
    name: region.name || '',
    type: region.type || 'unknown',
    offset: region.offset,
    size: region.size || 0,
  };
}

function nextRegionId(mapData) {
  let maxId = 0;
  for (const region of mapData.regions || []) {
    const match = /^r(\d+)$/.exec(region.id || '');
    if (match) maxId = Math.max(maxId, Number(match[1]));
  }
  return 'r' + String(maxId + 1).padStart(4, '0');
}

function buildCatalog(mapData) {
  const sourceRegion = findExactRegion(mapData, SPLIT.sourceOffset);
  const codeRegion = findExactRegion(mapData, SPLIT.codeOffset);
  const alreadySplit = Boolean(
    sourceRegion &&
    sourceRegion.size === SPLIT.tableSize &&
    (sourceRegion.type || 'unknown') === 'entity_behavior_table' &&
    codeRegion &&
    codeRegion.size === SPLIT.codeSize &&
    (codeRegion.type || 'unknown') === 'code'
  );
  const canSplit = Boolean(
    sourceRegion &&
    sourceRegion.size === SPLIT.originalSize &&
    !codeRegion &&
    parseInt(sourceRegion.offset, 16) === SPLIT.sourceOffset
  );
  const blockedReasons = [];
  if (!sourceRegion) blockedReasons.push('No exact source region exists at 0x06F80.');
  if (sourceRegion && sourceRegion.size !== SPLIT.originalSize && sourceRegion.size !== SPLIT.tableSize) {
    blockedReasons.push(`Unexpected source region size ${sourceRegion.size}; expected ${SPLIT.originalSize} before split or ${SPLIT.tableSize} after split.`);
  }
  if (sourceRegion && sourceRegion.size === SPLIT.originalSize && codeRegion) {
    blockedReasons.push('A region already exists at 0x06F88, so automatic split would overlap existing metadata.');
  }

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-entity-behavior-split-audit.mjs',
    split: {
      sourceOffset: hex(SPLIT.sourceOffset),
      originalSize: SPLIT.originalSize,
      tableSize: SPLIT.tableSize,
      codeOffset: hex(SPLIT.codeOffset),
      codeSize: SPLIT.codeSize,
      targetOffsets: SPLIT.targetOffsets,
    },
    sourceRegion: regionRef(sourceRegion),
    codeRegion: regionRef(codeRegion),
    canSplit,
    alreadySplit,
    blockedReasons,
    evidence: [
      '_LABEL_6F60_/_LABEL_6F66_ store _DATA_6F80_ in IX+38/IX+39, making the first four words an entity behavior dispatch table.',
      'The shared entity dispatcher jumps through IX+38/IX+39 plus 2 * (IX+32 & $0F), and target offsets 0x6F88, 0x6FC3, and 0x6FD1 are reached by many other behavior tables.',
      'Bytes after the first four words are code-shaped behavior routines ending at the next existing region boundary 0x7001.',
    ],
    summary: {
      canSplit,
      alreadySplit,
      blocked: blockedReasons.length > 0 && !alreadySplit,
      changedRegions: canSplit ? 2 : 0,
      assetPolicy: 'Metadata only: region boundaries, offsets, labels, and evidence. No ROM bytes or decoded copyrighted assets are embedded.',
    },
  };
}

function annotateSourceRegion(region) {
  const previousType = region.type || 'unknown';
  const previousSize = region.size || 0;
  region.size = SPLIT.tableSize;
  region.type = 'entity_behavior_table';
  region.analysis = region.analysis || {};
  const existing = region.analysis.entityBehaviorSplitAudit || {};
  region.analysis.entityBehaviorSplitAudit = {
    kind: 'entity_behavior_table_split_prefix',
    summary: 'First four words of the former mixed _DATA_6F80_ region; seeded into IX+38/IX+39 by _LABEL_6F60_/_LABEL_6F66_.',
    confidence: 'high',
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    sizeBeforeAudit: existing.sizeBeforeAudit || previousSize,
    sizeAfterAudit: region.size,
    changedType: existing.changedType || previousType !== region.type,
    changedSize: existing.changedSize || previousSize !== region.size,
    catalogId,
    detail: {
      originalRange: { start: hex(SPLIT.sourceOffset), size: SPLIT.originalSize },
      tableRange: { start: hex(SPLIT.sourceOffset), size: SPLIT.tableSize },
      codeRange: { start: hex(SPLIT.codeOffset), size: SPLIT.codeSize },
    },
    evidence: [
      '_LABEL_6F60_/_LABEL_6F66_ store _DATA_6F80_ in IX+38/IX+39.',
      'The first four words resolve to behavior targets 0x6F88, 0x7063, 0x708D, and 0x7A71.',
    ],
    generatedAt: now,
    tool: 'tools/world-entity-behavior-split-audit.mjs',
  };
}

function buildCodeRegion(mapData) {
  return {
    id: nextRegionId(mapData),
    offset: hex(SPLIT.codeOffset),
    size: SPLIT.codeSize,
    type: 'code',
    name: 'entity behavior code @ 0x6F88',
    analysis: {
      entityBehaviorSplitAudit: {
        kind: 'entity_behavior_code_split_tail',
        summary: 'Code tail split from the former mixed _DATA_6F80_ region; contains behavior handlers reached by IX+38 dispatch tables.',
        confidence: 'high',
        typeBeforeAudit: 'split_from_screen_prog_region',
        typeAfterAudit: 'code',
        sizeBeforeAudit: 0,
        sizeAfterAudit: SPLIT.codeSize,
        changedType: true,
        changedSize: true,
        catalogId,
        detail: {
          originalRange: { start: hex(SPLIT.sourceOffset), size: SPLIT.originalSize },
          codeRange: { start: hex(SPLIT.codeOffset), size: SPLIT.codeSize },
          targetOffsets: SPLIT.targetOffsets,
        },
        evidence: [
          'Behavior tables target 0x6F88, 0x6FC3, and 0x6FD1 inside this split code span.',
          'The byte stream after the 0x6F80 table prefix decodes as Z80 behavior code and ends before the existing 0x7001 region.',
        ],
        generatedAt: now,
        tool: 'tools/world-entity-behavior-split-audit.mjs',
      },
    },
  };
}

function applySplit(mapData) {
  const sourceRegion = findExactRegion(mapData, SPLIT.sourceOffset);
  if (!sourceRegion) return [];
  const codeRegion = findExactRegion(mapData, SPLIT.codeOffset);
  if (sourceRegion.size === SPLIT.tableSize && codeRegion) return [];
  annotateSourceRegion(sourceRegion);
  const newRegion = buildCodeRegion(mapData);
  const index = mapData.regions.findIndex(region => region.id === sourceRegion.id);
  mapData.regions.splice(index + 1, 0, newRegion);
  return [sourceRegion, newRegion];
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let changedRegions = [];

  if (apply && catalog.canSplit) {
    changedRegions = applySplit(mapData).map(region => regionRef(region));
    const finalCatalog = buildCatalog(mapData);
    mapData.entityBehaviorSplitCatalogs = (mapData.entityBehaviorSplitCatalogs || []).filter(c => c.id !== catalogId);
    mapData.entityBehaviorSplitCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'entity_behavior_split_audit',
      generatedAt: now,
      tool: 'tools/world-entity-behavior-split-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changedRegions.length,
      },
      changedRegions,
      blockedReasons: finalCatalog.blockedReasons,
      evidence: finalCatalog.evidence,
      nextLeads: [
        'Rerun the entity behavior and behavior-code audits so 0x6F80 and 0x6F88 appear in the reusable pointer/code catalogs.',
        'Inspect 0x07310 and 0x078C2-0x07C64, which are still typed as screen_prog but look like behavior code/data boundary fragments.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    canSplit: catalog.canSplit,
    alreadySplit: catalog.alreadySplit,
    blockedReasons: catalog.blockedReasons,
    changedRegions,
  }, null, 2));
}

main();
