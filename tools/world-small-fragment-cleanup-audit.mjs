#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-small-fragment-cleanup-catalog-2026-06-24';
const reportId = 'small-fragment-cleanup-audit-2026-06-24';

const REGION_UPDATES = [
  {
    offset: 0x02B6C,
    inferredType: 'code',
    role: 'orphan_return_code_fragment_between_local_helpers',
    confidence: 'medium',
    summary: 'Single return-opcode fragment between local helper labels in a control-flow block; executable code-shaped boundary fragment, not a screen program.',
    evidence: [
      'ASM lines 7002-7006 define a local helper that calls the following local helper and _LABEL_2B73_.',
      'ASM lines 7008-7010 define the preceding local helper body.',
      'ASM lines 7012-7013 mark 0x02B6C as a one-byte return fragment between helper bodies.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x02B6C.',
    ],
  },
  {
    offset: 0x02B6D,
    inferredType: 'code',
    role: 'local_helper_code_fragment',
    confidence: 'high',
    summary: 'Local helper code fragment reached by the call at ASM line 7004; not screen bytecode.',
    evidence: [
      'ASM line 7004 calls the local helper beginning immediately after the 0x02B6C data byte.',
      'ASM lines 7015-7017 decode 0x02B6D as a local helper body that loads _RAM_CF2A_ and jumps to the shared tail.',
      'ASM lines 7019-7028 define the shared _LABEL_2B73_ tail used by nearby helpers.',
    ],
  },
  {
    offset: 0x05E12,
    inferredType: 'code',
    role: 'jump_table_branch_code_fragment',
    confidence: 'high',
    summary: 'Branch code between two three-entry state jump tables, reached from _LABEL_5E02_; not screen bytecode.',
    evidence: [
      'ASM lines 13796-13801 define _LABEL_5E02_ and branch into the first jump-table dispatch.',
      'ASM lines 13802-13804 define the 0x05E0C jump table used by the first branch.',
      'ASM lines 13806-13808 decode 0x05E12 as the alternate local branch body.',
      'ASM lines 13809-13811 define the 0x05E16 jump table used by that alternate branch.',
    ],
  },
  {
    offset: 0x07F07,
    inferredType: 'null',
    role: 'bank1_terminal_padding_before_sms_header',
    confidence: 'high',
    summary: 'Terminal padding before the Master System header records and bank 2 boundary; not a screen program.',
    evidence: [
      'ASM lines 16340-16343 mark 0x07F07-0x07FFF as terminal bank data.',
      'The mapped SMS header records begin at 0x07FF0 and remain separate regions.',
      'ASM line 16345 starts .BANK 2 immediately after the terminal data block.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x07F07.',
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
  if (inferredType === 'code') return ['screen_prog', 'unknown', 'raw_byte'].includes(current);
  if (inferredType === 'raw_byte') return ['screen_prog', 'unknown'].includes(current);
  if (inferredType === 'null') return ['screen_prog', 'unknown', 'raw_byte', 'data_table'].includes(current);
  return false;
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-small-fragment-cleanup-audit.mjs',
    summary: {
      regionsAudited: REGION_UPDATES.length,
      regionsWithRetypeEvidence: REGION_UPDATES.length,
      orphanReturnCodeFragments: REGION_UPDATES.filter(item => item.role.includes('orphan_return_code_fragment')).length,
      assetPolicy: 'Metadata only: offsets, labels, routine references, region roles, and confidence. No ROM bytes, decoded graphics, text, music, or gameplay assets are embedded.',
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
  region.analysis.smallFragmentCleanupAudit = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: 'tools/world-small-fragment-cleanup-audit.mjs',
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
    .filter(region => region.analysis?.smallFragmentCleanupAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.smallFragmentCleanupAudit.kind,
      confidence: region.analysis.smallFragmentCleanupAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const changes = applyAnnotations(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.fragmentCatalogs = (mapData.fragmentCatalogs || []).filter(item => item.id !== catalogId);
    mapData.fragmentCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'small_fragment_cleanup_audit',
      generatedAt: now,
      tool: 'tools/world-small-fragment-cleanup-audit.mjs --apply',
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
        'Inspect remaining unexplained screen_prog fragments under 0x010000 for branch labels, local jump tables, and terminal padding before treating them as assets.',
        'Trace remaining _LABEL_604_ roots and screen-program pointer table entries before retyping larger byte streams.',
        'Keep SMS header and checksum records separate from terminal padding so cartridge metadata stays auditable.',
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
