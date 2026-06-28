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
const catalogId = 'world-bank2-dispatch-table-catalog-2026-06-24';
const reportId = 'bank2-dispatch-table-audit-2026-06-24';

const DISPATCH_TABLES = [
  {
    offset: 0x801A,
    role: 'bank2_main_controller_dispatch_table',
    indexRam: '_RAM_D1AE_',
    entries: 6,
    confidence: 'high',
    summary: '_LABEL_8000_ dispatches through this top-level bank-2 controller table indexed by _RAM_D1AE_.',
    evidence: [
      'ASM lines 16360-16362 load _RAM_D1AE_ and dispatch through RST $20.',
      'ASM lines 16363-16365 define the six-entry jump table at _DATA_801A_.',
      'ASM lines 16367, 16684, 17223, 17615, 18059, and 18439 identify the six controller entries.',
    ],
  },
  {
    offset: 0x80A5,
    role: 'bank2_controller_state_dispatch_table',
    indexRam: '_RAM_D16E_',
    entries: 5,
    confidence: 'high',
    summary: '_LABEL_80A1_ dispatches through this state table indexed by _RAM_D16E_.',
    evidence: [
      'ASM lines 16426-16428 load _RAM_D16E_ and dispatch through RST $20.',
      'ASM lines 16429-16431 define the five-entry jump table at _DATA_80A5_.',
      'ASM lines 16433-16529 define the state handlers reached from this table.',
    ],
  },
  {
    offset: 0x833C,
    role: 'bank2_controller_state_dispatch_table',
    indexRam: '_RAM_D16E_',
    entries: 7,
    confidence: 'high',
    summary: '_LABEL_8338_ dispatches through this state table indexed by _RAM_D16E_.',
    evidence: [
      'ASM lines 16753-16755 load _RAM_D16E_ and dispatch through RST $20.',
      'ASM lines 16756-16758 define the seven-entry jump table at _DATA_833C_.',
      'ASM lines 16760-16869 define the state handlers reached from this table.',
    ],
  },
  {
    offset: 0x86D7,
    role: 'bank2_controller_state_dispatch_table',
    indexRam: '_RAM_D16E_',
    entries: 7,
    confidence: 'high',
    summary: '_LABEL_86D3_ dispatches through this state table indexed by _RAM_D16E_.',
    evidence: [
      'ASM lines 17261-17263 load _RAM_D16E_ and dispatch through RST $20.',
      'ASM lines 17264-17266 define the seven-entry jump table at _DATA_86D7_.',
      'ASM lines 17268-17495 define the state handlers reached from this table.',
    ],
  },
  {
    offset: 0x89E2,
    role: 'bank2_controller_state_dispatch_table',
    indexRam: '_RAM_D16E_',
    entries: 7,
    confidence: 'high',
    summary: '_LABEL_89DE_ dispatches through this state table indexed by _RAM_D16E_.',
    evidence: [
      'ASM lines 17653-17655 load _RAM_D16E_ and dispatch through RST $20.',
      'ASM lines 17655-17656 define the seven-entry jump table at _DATA_89E2_.',
      'ASM lines 17659-17838 define the state handlers reached from this table.',
    ],
  },
  {
    offset: 0x8D60,
    role: 'bank2_controller_state_dispatch_table',
    indexRam: '_RAM_D16E_',
    entries: 7,
    confidence: 'high',
    summary: '_LABEL_8D5C_ dispatches through this state table indexed by _RAM_D16E_.',
    evidence: [
      'ASM lines 18097-18099 load _RAM_D16E_ and dispatch through RST $20.',
      'ASM lines 18099-18100 define the seven-entry jump table at _DATA_8D60_.',
      'ASM lines 18103-18263 define the state handlers reached from this table.',
    ],
  },
  {
    offset: 0x90CA,
    role: 'bank2_controller_state_dispatch_table',
    indexRam: '_RAM_D16E_',
    entries: 16,
    confidence: 'high',
    summary: '_LABEL_90C6_ dispatches through this state table indexed by _RAM_D16E_; this confirms the earlier bank2 state-machine audit classification.',
    evidence: [
      'ASM lines 18524-18526 load _RAM_D16E_ and dispatch through RST $20.',
      'ASM lines 18527-18530 define the 16-entry jump table at _DATA_90CA_.',
      'ASM lines 18532-18761 define the state handlers reached from this table.',
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
    tool: 'tools/world-bank2-dispatch-table-audit.mjs',
    summary: {
      dispatchTables: DISPATCH_TABLES.length,
      mainIndexRam: '_RAM_D1AE_',
      stateIndexRam: '_RAM_D16E_',
      assetPolicy: 'Metadata only: offsets, labels, table roles, RAM index variables, and evidence. No ROM bytes, decoded graphics, or gameplay assets are embedded.',
    },
    entries: DISPATCH_TABLES.map(item => ({
      offset: hex(item.offset),
      inferredType: 'entity_behavior_table',
      role: item.role,
      indexRam: item.indexRam,
      entries: item.entries,
      confidence: item.confidence,
      summary: item.summary,
      evidence: item.evidence,
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
  };
}

function shouldRetype(region) {
  if (!region) return false;
  const current = region.type || 'unknown';
  if (current === 'entity_behavior_table') return false;
  return ['screen_prog', 'code', 'pointer_table', 'data_table', 'unknown', 'raw_byte'].includes(current);
}

function annotateRegion(region, item) {
  const typeBefore = region.type || 'unknown';
  const changedType = shouldRetype(region);
  if (changedType) region.type = 'entity_behavior_table';
  region.analysis = region.analysis || {};
  region.analysis.bank2DispatchTableAudit = {
    catalogId,
    kind: item.role,
    indexRam: item.indexRam,
    entries: item.entries,
    confidence: item.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: 'tools/world-bank2-dispatch-table-audit.mjs',
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
    .filter(region => region.analysis?.bank2DispatchTableAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.bank2DispatchTableAudit.kind,
      indexRam: region.analysis.bank2DispatchTableAudit.indexRam,
      confidence: region.analysis.bank2DispatchTableAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const changes = applyAnnotations(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(item => item.id !== catalogId);
    mapData.entityBehaviorCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_dispatch_table_audit',
      generatedAt: now,
      tool: 'tools/world-bank2-dispatch-table-audit.mjs --apply',
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
        'Name each _RAM_D1AE_ controller entry by tracing the setup constants and spawned object slot layouts.',
        'Cross-link each _RAM_D16E_ table to its parent _RAM_D1AE_ entry in a browser diagnostics panel.',
        'Audit the remaining jump-table labels that are still typed as code in other banks.',
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
