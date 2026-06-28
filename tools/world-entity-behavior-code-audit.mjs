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
const catalogId = 'world-entity-behavior-code-catalog-2026-06-24';
const reportId = 'entity-behavior-code-audit-2026-06-24';

const behaviorCatalogId = 'world-entity-behavior-catalog-2026-06-24';

const RETYPE_REGION_OFFSETS = new Set([
  0x06F88,
  0x07001,
  0x07328,
  0x078E0,
  0x07924,
  0x07962,
  0x07A28,
  0x07A62,
  0x07AE4,
]);

const BLOCKED_REGION_OFFSETS = new Set([
  0x06F00,
  0x06F80,
]);

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(region => {
    const start = parseInt(region.offset, 16);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
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

function loadBehaviorTargets(mapData) {
  const catalog = (mapData.entityBehaviorCatalogs || []).find(c => c.id === behaviorCatalogId);
  if (!catalog) return { catalog: null, refs: [] };
  const refs = [];
  for (const table of catalog.behaviorTables || []) {
    for (const entry of table.entries || []) {
      refs.push({
        targetOffset: parseInt(entry.romOffset, 16),
        sourceTable: table.label,
        sourceTableOffset: table.offset,
        tableEntryIndex: entry.index,
        entryOffset: entry.entryOffset,
      });
    }
  }
  return { catalog, refs };
}

function groupTargetsByRegion(mapData, refs) {
  const byRegion = new Map();
  for (const ref of refs) {
    const region = findContainingRegion(mapData, ref.targetOffset);
    if (!region) continue;
    if (!byRegion.has(region.id)) byRegion.set(region.id, { region, refs: [] });
    byRegion.get(region.id).refs.push(ref);
  }
  return [...byRegion.values()].sort((a, b) => parseInt(a.region.offset, 16) - parseInt(b.region.offset, 16));
}

function uniqueTargets(refs) {
  return [...new Set(refs.map(ref => ref.targetOffset))].sort((a, b) => a - b).map(offset => hex(offset));
}

function uniqueSourceTables(refs) {
  return [...new Set(refs.map(ref => ref.sourceTable))].sort();
}

function buildCatalog(mapData) {
  const { catalog: behaviorCatalog, refs } = loadBehaviorTargets(mapData);
  const groups = groupTargetsByRegion(mapData, refs);
  const codeRegions = [];
  const blockedRegions = [];
  const ignoredRegions = [];

  for (const group of groups) {
    const regionOffset = parseInt(group.region.offset, 16);
    const entry = {
      region: regionRef(group.region),
      inferredType: 'code',
      confidence: RETYPE_REGION_OFFSETS.has(regionOffset) ? 'high' : 'medium',
      targetOffsets: uniqueTargets(group.refs),
      sourceTables: uniqueSourceTables(group.refs),
      referenceCount: group.refs.length,
      references: group.refs.slice(0, 24).map(ref => ({
        sourceTable: ref.sourceTable,
        sourceTableOffset: ref.sourceTableOffset,
        tableEntryIndex: ref.tableEntryIndex,
        entryOffset: ref.entryOffset,
        targetOffset: hex(ref.targetOffset),
      })),
    };
    if (RETYPE_REGION_OFFSETS.has(regionOffset)) {
      codeRegions.push({
        ...entry,
        role: 'entity_behavior_code_region',
        summary: 'Code-shaped region containing direct JP (HL) targets from IX+38 entity behavior dispatch tables.',
        evidence: [
          'The shared entity update dispatcher reads a word from IX+38/IX+39 plus 2 * (IX+32 & $0F), then jumps to the selected target with JP (HL).',
          'The listed target offsets inside this region are selected by the cataloged entity_behavior_table records.',
          'The ASM byte stream around this cluster is Z80 code-shaped and includes calls to known entity routines such as _LABEL_1318_, _LABEL_1330_, _LABEL_17AB_, _LABEL_1B25_, and _LABEL_1B4B_.',
        ],
      });
    } else if (BLOCKED_REGION_OFFSETS.has(regionOffset)) {
      blockedRegions.push({
        ...entry,
        role: 'mixed_or_uncertain_entity_behavior_code',
        summary: regionOffset === 0x06F80
          ? 'Mixed region: starts with an entity_behavior_table prefix, then continues as behavior code.'
          : 'Uncertain pointer: target-like word is only linked through a suspicious pointer comment inside a music-region stream.',
        nextStep: regionOffset === 0x06F80
          ? 'Split the 0x06F80 region into table prefix and code spans before retyping.'
          : 'Trace the 0x0D860 source before retyping 0x06F00.',
      });
    } else {
      ignoredRegions.push({
        ...entry,
        role: 'untyped_entity_behavior_target_region',
        summary: 'Contains behavior-dispatch target offsets but was not retyped in this pass.',
        nextStep: 'Inspect the region boundary and local ASM before assigning a coarse code or split code/data classification.',
      });
    }
  }

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-entity-behavior-code-audit.mjs',
    sourceCatalogId: behaviorCatalogId,
    sourceCatalogPresent: Boolean(behaviorCatalog),
    codeRegions,
    blockedRegions,
    ignoredRegions,
    summary: {
      targetReferences: refs.length,
      targetRegions: groups.length,
      codeRegions: codeRegions.length,
      blockedRegions: blockedRegions.length,
      ignoredRegions: ignoredRegions.length,
      sourceCatalogPresent: Boolean(behaviorCatalog),
      assetPolicy: 'Metadata only: behavior target offsets, source table labels, region classifications, and evidence. No ROM bytes or decoded copyrighted assets are embedded.',
    },
  };
}

function shouldRetype(region) {
  return ['screen_prog', 'unknown', 'raw_byte'].includes(region.type || 'unknown');
}

function annotateCodeRegion(region, entry) {
  const previousType = region.type || 'unknown';
  const changedType = shouldRetype(region) && previousType !== 'code';
  if (changedType) region.type = 'code';
  region.analysis = region.analysis || {};
  const existing = region.analysis.entityBehaviorCodeAudit || {};
  region.analysis.entityBehaviorCodeAudit = {
    kind: entry.role,
    summary: entry.summary,
    confidence: entry.confidence,
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    detail: {
      targetOffsets: entry.targetOffsets,
      sourceTables: entry.sourceTables,
      referenceCount: entry.referenceCount,
    },
    evidence: entry.evidence,
    generatedAt: now,
    tool: 'tools/world-entity-behavior-code-audit.mjs',
  };
  return changedType;
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const evidenceOnlyRegions = [];
  const missingRegions = [];

  for (const entry of catalog.codeRegions) {
    const region = entry.region ? findExactRegion(mapData, parseInt(entry.region.offset, 16)) : null;
    if (!region) {
      missingRegions.push({ offset: entry.region?.offset || null, inferredType: entry.inferredType, role: entry.role });
      continue;
    }
    const wouldChange = shouldRetype(region) && (region.type || 'unknown') !== 'code';
    if (!apply) {
      (wouldChange ? changedRegions : evidenceOnlyRegions).push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType: region.type || 'unknown',
        inferredType: entry.inferredType,
        targetOffsets: entry.targetOffsets,
      });
      continue;
    }
    const previousType = region.type || 'unknown';
    const changed = annotateCodeRegion(region, entry);
    (changed ? changedRegions : evidenceOnlyRegions).push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType,
      type: region.type || 'unknown',
      inferredType: entry.inferredType,
      targetOffsets: entry.targetOffsets,
    });
  }

  return { changedRegions, evidenceOnlyRegions, missingRegions };
}

function collectChangedRegions(mapData) {
  return mapData.regions
    .filter(region => region.analysis?.entityBehaviorCodeAudit?.catalogId === catalogId && region.analysis.entityBehaviorCodeAudit.changedType)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType: region.analysis.entityBehaviorCodeAudit.typeBeforeAudit || 'unknown',
      type: region.type || 'unknown',
      kind: region.analysis.entityBehaviorCodeAudit.kind,
      confidence: region.analysis.entityBehaviorCodeAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    const changedRegions = collectChangedRegions(mapData);
    mapData.entityBehaviorCodeCatalogs = (mapData.entityBehaviorCodeCatalogs || []).filter(c => c.id !== catalogId);
    mapData.entityBehaviorCodeCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'entity_behavior_code_audit',
      generatedAt: now,
      tool: 'tools/world-entity-behavior-code-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegionTypes: changedRegions.length,
        changedRegionTypesThisRun: annotation.changedRegions.length,
        evidenceOnlyRegions: annotation.evidenceOnlyRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      changedRegions,
      changedRegionsThisRun: annotation.changedRegions,
      evidenceOnlyRegions: annotation.evidenceOnlyRegions,
      missingRegions: annotation.missingRegions,
      blockedRegions: finalCatalog.blockedRegions,
      ignoredRegions: finalCatalog.ignoredRegions,
      nextLeads: [
        'Split 0x06F80 into behavior table and code spans so the first local behavior-code target can be classified without overtyping table bytes.',
        'Inspect the remaining 0x07310-0x07C64 screen_prog/code-tail fragments; several are likely contiguous behavior code or behavior data but need boundary evidence.',
        'Trace the pointer comments from 0x0E76C, 0x0F970, and 0x0FC6C to distinguish true behavior-entry references from false pointers in byte streams.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegionTypes: annotation.changedRegions.length,
    changedRegions: annotation.changedRegions,
    evidenceOnlyRegions: annotation.evidenceOnlyRegions,
    blockedRegions: catalog.blockedRegions,
    ignoredRegions: catalog.ignoredRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
