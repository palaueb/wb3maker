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
const catalogId = 'world-entity-behavior-fragment-catalog-2026-06-24';
const reportId = 'entity-behavior-fragment-audit-2026-06-24';

const FRAGMENTS = [
  {
    offset: 0x07310,
    role: 'entity_behavior_code_tail_after_7001',
    summary: 'Code tail immediately after the confirmed 0x7001 behavior-code region; continues the same routine block before 0x7328.',
    evidence: [
      'The preceding confirmed behavior-code region at 0x7001 ends at 0x730F and the 0x7310 fragment continues the same code-shaped stream with calls to known entity routines before returning.',
      'No ASM path passes _DATA_7310_ to _LABEL_604_; it sits inside the 0x7001-0x7327 behavior-code island.',
    ],
  },
  {
    offset: 0x078C2,
    role: 'entity_behavior_code_tail_before_78E0',
    summary: 'Short code-tail fragment between the confirmed 0x7328 behavior-code region and the 0x78E0 behavior-code target region.',
    evidence: [
      'The fragment is adjacent to confirmed behavior-code regions and continues the same code-shaped entity routine stream before 0x78E0.',
      'It is not loaded through BC for _LABEL_604_ and has no independent screen_prog consumer.',
    ],
  },
  {
    offset: 0x078C8,
    role: 'entity_behavior_code_tail_before_78E0',
    summary: 'Continuation of the local entity behavior helper before the confirmed 0x78E0 behavior-code target region.',
    evidence: [
      'The 0x78C8 fragment follows the 0x78C2 code tail and precedes the target-backed 0x78E0 behavior-code region.',
      'The surrounding cluster is selected through IX+38 behavior tables, not the _LABEL_604_ screen decoder.',
    ],
  },
  {
    offset: 0x07A0C,
    role: 'entity_behavior_code_tail_before_7A28',
    summary: 'Code-tail fragment between confirmed behavior-code regions 0x7962 and 0x7A28.',
    evidence: [
      'The confirmed 0x7962 behavior-code region runs into this fragment, and the next confirmed target-backed behavior-code region starts at 0x7A28.',
      'The fragment is part of the behavior-code flow and is not referenced as screen_prog bytecode.',
    ],
  },
  {
    offset: 0x07A24,
    role: 'entity_behavior_code_tail_before_7A28',
    summary: 'Four-byte boundary fragment immediately before the confirmed 0x7A28 behavior-code target region.',
    evidence: [
      'The 0x7A24 fragment bridges the 0x7A0C code tail to the target-backed 0x7A28 behavior-code region.',
      'It has no _LABEL_604_ consumer and is part of the same IX+38-selected behavior-code island.',
    ],
  },
  {
    offset: 0x07ACC,
    role: 'entity_behavior_code_tail_after_7A62',
    summary: 'Code-tail fragment after the confirmed 0x7A62 behavior-code region and before the mixed 0x7AE4 behavior/data block.',
    evidence: [
      'The 0x7ACC fragment continues from the target-backed 0x7A62 behavior-code region and leads into the following behavior block.',
      'Its role is code continuation, not screen rendering; no caller passes this label to _LABEL_604_.',
    ],
  },
  {
    offset: 0x07C4C,
    role: 'entity_behavior_code_tail_before_7C65',
    summary: 'Final behavior-code tail immediately before the one-byte return at 0x7C64 and the labeled _LABEL_7C65_ routine.',
    evidence: [
      'The 0x7C4C fragment is immediately followed by the 0x7C64 return-byte fragment and then the labeled _LABEL_7C65_ entity routine.',
      'This tail belongs to the behavior-code cluster, not to a screen_prog stream decoded by _LABEL_604_.',
    ],
  },
  {
    offset: 0x07C64,
    role: 'entity_behavior_code_return_tail',
    summary: 'Single-byte return tail that terminates the local behavior-code fragment immediately before _LABEL_7C65_.',
    evidence: [
      'ASM marks 0x7C64 as a one-byte data fragment immediately before _LABEL_7C65_; the byte is a return terminator for the preceding code tail.',
      'It is not a screen_prog record and has no _LABEL_604_ consumer.',
    ],
  },
];

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

function buildCatalog(mapData) {
  const fragments = FRAGMENTS.map(def => {
    const region = findExactRegion(mapData, def.offset);
    return {
      id: def.role + '_' + def.offset.toString(16).toUpperCase(),
      offset: hex(def.offset),
      inferredType: 'code',
      confidence: def.offset === 0x07C64 ? 'high' : 'medium',
      role: def.role,
      summary: def.summary,
      region: regionRef(region),
      evidence: def.evidence,
    };
  });
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-entity-behavior-fragment-audit.mjs',
    fragments,
    summary: {
      fragments: fragments.length,
      missingRegions: fragments.filter(fragment => !fragment.region).length,
      highConfidence: fragments.filter(fragment => fragment.confidence === 'high').length,
      mediumConfidence: fragments.filter(fragment => fragment.confidence === 'medium').length,
      assetPolicy: 'Metadata only: offsets, classifications, labels, and evidence. No ROM bytes or decoded copyrighted assets are embedded.',
    },
  };
}

function shouldRetype(region) {
  return ['screen_prog', 'unknown', 'raw_byte'].includes(region.type || 'unknown');
}

function annotateRegion(region, fragment) {
  const previousType = region.type || 'unknown';
  const changedType = shouldRetype(region) && previousType !== 'code';
  if (changedType) region.type = 'code';
  region.analysis = region.analysis || {};
  const existing = region.analysis.entityBehaviorFragmentAudit || {};
  region.analysis.entityBehaviorFragmentAudit = {
    kind: fragment.role,
    summary: fragment.summary,
    confidence: fragment.confidence,
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    evidence: fragment.evidence,
    generatedAt: now,
    tool: 'tools/world-entity-behavior-fragment-audit.mjs',
  };
  return changedType;
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const evidenceOnlyRegions = [];
  const missingRegions = [];
  const blockedRegions = [];
  for (const fragment of catalog.fragments) {
    const region = fragment.region ? mapData.regions.find(r => r.id === fragment.region.id) : null;
    if (!region) {
      missingRegions.push({ offset: fragment.offset, inferredType: fragment.inferredType, role: fragment.role });
      continue;
    }
    const wouldChange = shouldRetype(region) && (region.type || 'unknown') !== 'code';
    if (!wouldChange && (region.type || 'unknown') !== 'code') {
      blockedRegions.push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType: region.type || 'unknown',
        inferredType: fragment.inferredType,
        role: fragment.role,
      });
      continue;
    }
    if (!apply) {
      (wouldChange ? changedRegions : evidenceOnlyRegions).push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType: region.type || 'unknown',
        inferredType: fragment.inferredType,
        role: fragment.role,
      });
      continue;
    }
    const previousType = region.type || 'unknown';
    const changed = annotateRegion(region, fragment);
    (changed ? changedRegions : evidenceOnlyRegions).push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType,
      type: region.type || 'unknown',
      inferredType: fragment.inferredType,
      role: fragment.role,
    });
  }
  return { changedRegions, evidenceOnlyRegions, missingRegions, blockedRegions };
}

function collectChangedRegions(mapData) {
  return mapData.regions
    .filter(region => region.analysis?.entityBehaviorFragmentAudit?.catalogId === catalogId && region.analysis.entityBehaviorFragmentAudit.changedType)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType: region.analysis.entityBehaviorFragmentAudit.typeBeforeAudit || 'unknown',
      type: region.type || 'unknown',
      kind: region.analysis.entityBehaviorFragmentAudit.kind,
      confidence: region.analysis.entityBehaviorFragmentAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    const changedRegions = collectChangedRegions(mapData);
    mapData.entityBehaviorFragmentCatalogs = (mapData.entityBehaviorFragmentCatalogs || []).filter(c => c.id !== catalogId);
    mapData.entityBehaviorFragmentCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'entity_behavior_fragment_audit',
      generatedAt: now,
      tool: 'tools/world-entity-behavior-fragment-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegionTypes: changedRegions.length,
        changedRegionTypesThisRun: annotation.changedRegions.length,
        evidenceOnlyRegions: annotation.evidenceOnlyRegions.length,
        blockedRegions: annotation.blockedRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      changedRegions,
      changedRegionsThisRun: annotation.changedRegions,
      evidenceOnlyRegions: annotation.evidenceOnlyRegions,
      blockedRegions: annotation.blockedRegions,
      missingRegions: annotation.missingRegions,
      nextLeads: [
        'Inspect 0x7AE4-0x7C4B to split the mixed behavior code/data table section rather than classifying the whole span as one type.',
        'Trace pointer comments near 0x0F970 and 0x0FC6C to explain why the ASM emitted separate data labels inside the behavior-code cluster.',
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
    blockedRegions: annotation.blockedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
