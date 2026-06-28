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
const catalogId = 'world-bank2-state-machine-catalog-2026-06-24';
const reportId = 'bank2-state-machine-audit-2026-06-24';

const REGION_UPDATES = [
  {
    offset: 0x9096,
    inferredType: 'entity_data',
    role: 'state_machine_init_record_prefix',
    confidence: 'high',
    summary: 'Prefix of the contiguous 48-byte randomized init-record table selected by _LABEL_901B_.',
    evidence: [
      'ASM lines 18476-18483 compute a random index multiplied by six and add it to the 0x9096 table base.',
      'ASM lines 18488-18504 read two coordinate/state words and a code pointer from the selected six-byte record.',
      'ASM lines 18512-18521 show the disassembler split this contiguous table into 10-byte, 2-byte, and 36-byte fragments.',
    ],
  },
  {
    offset: 0x90A0,
    inferredType: 'entity_data',
    role: 'state_machine_init_record_pointer_field',
    confidence: 'high',
    summary: 'The disassembler labels this two-byte field as a one-entry jump table, but _LABEL_901B_ reaches it as part of the 0x9096 six-byte record stream.',
    evidence: [
      'ASM lines 18476-18483 compute a six-byte record address from the 0x9096 base.',
      'ASM lines 18500-18504 read the third word from the selected record and call it as a routine pointer.',
      'ASM lines 18515-18517 place _DATA_90A0_ between the 0x9096 prefix and 0x90A2 tail of the same contiguous record stream.',
    ],
  },
  {
    offset: 0x90A2,
    inferredType: 'entity_data',
    role: 'state_machine_init_record_tail',
    confidence: 'high',
    summary: 'Tail of the contiguous randomized init-record table selected by _LABEL_901B_.',
    evidence: [
      'ASM lines 18476-18483 compute a random index multiplied by six from the 0x9096 table base.',
      'ASM lines 18488-18504 consume six bytes per selected record.',
      'ASM lines 18519-18521 are the final 36-byte tail of the 48-byte record stream.',
    ],
  },
  {
    offset: 0x90CA,
    inferredType: 'entity_behavior_table',
    role: 'state_machine_dispatch_table',
    confidence: 'high',
    summary: '_LABEL_90C6_ dispatches through this 16-entry state table indexed by _RAM_D16E_.',
    evidence: [
      'ASM lines 18524-18526 load _RAM_D16E_ and dispatch through RST $20.',
      'ASM lines 18527-18530 define the 16-entry jump table at _DATA_90CA_.',
      'ASM lines 18532-18761 define the state handlers reached by this table.',
    ],
  },
  {
    offset: 0x9134,
    inferredType: 'entity_data',
    role: 'state_transition_choice_table',
    confidence: 'high',
    summary: 'Eight-entry transition-choice table passed to _LABEL_92B7_ by the _LABEL_911B_ state handler.',
    evidence: [
      'ASM lines 18568-18569 load the 0x9134 table and call _LABEL_92B7_.',
      'ASM lines 18763-18775 show _LABEL_92B7_ randomly indexes an eight-entry table and dispatches through the 0x92C8 table.',
    ],
  },
  {
    offset: 0x9158,
    inferredType: 'entity_data',
    role: 'state_transition_choice_table',
    confidence: 'high',
    summary: 'Eight-entry transition-choice table passed to _LABEL_92B7_ by the _LABEL_913C_ state handler.',
    evidence: [
      'ASM lines 18585-18586 load the 0x9158 table and call _LABEL_92B7_.',
      'ASM lines 18763-18775 show _LABEL_92B7_ randomly indexes an eight-entry table and dispatches through the 0x92C8 table.',
    ],
  },
  {
    offset: 0x9179,
    inferredType: 'entity_data',
    role: 'state_transition_choice_table',
    confidence: 'high',
    summary: 'Eight-entry transition-choice table passed to _LABEL_92B7_ by the _LABEL_9160_ state handler.',
    evidence: [
      'ASM lines 18601-18602 load the 0x9179 table and call _LABEL_92B7_.',
      'ASM lines 18763-18775 show _LABEL_92B7_ randomly indexes an eight-entry table and dispatches through the 0x92C8 table.',
    ],
  },
  {
    offset: 0x919D,
    inferredType: 'entity_data',
    role: 'state_transition_choice_table',
    confidence: 'high',
    summary: 'Eight-entry transition-choice table passed to _LABEL_92B7_ by the _LABEL_9181_ state handler.',
    evidence: [
      'ASM lines 18618-18619 load the 0x919D table and call _LABEL_92B7_.',
      'ASM lines 18763-18775 show _LABEL_92B7_ randomly indexes an eight-entry table and dispatches through the 0x92C8 table.',
    ],
  },
  {
    offset: 0x91BE,
    inferredType: 'entity_data',
    role: 'state_transition_choice_table',
    confidence: 'high',
    summary: 'Eight-entry transition-choice table passed to _LABEL_92B7_ by the _LABEL_91A5_ state handler.',
    evidence: [
      'ASM lines 18634-18635 load the 0x91BE table and call _LABEL_92B7_.',
      'ASM lines 18763-18775 show _LABEL_92B7_ randomly indexes an eight-entry table and dispatches through the 0x92C8 table.',
    ],
  },
  {
    offset: 0x91E2,
    inferredType: 'entity_data',
    role: 'state_transition_choice_table',
    confidence: 'high',
    summary: 'Eight-entry transition-choice table passed to _LABEL_92B7_ by the _LABEL_91C6_ state handler.',
    evidence: [
      'ASM lines 18651-18652 load the 0x91E2 table and call _LABEL_92B7_.',
      'ASM lines 18763-18775 show _LABEL_92B7_ randomly indexes an eight-entry table and dispatches through the 0x92C8 table.',
    ],
  },
  {
    offset: 0x9203,
    inferredType: 'entity_data',
    role: 'state_transition_choice_table',
    confidence: 'high',
    summary: 'Eight-entry transition-choice table passed to _LABEL_92B7_ by the _LABEL_91EA_ state handler.',
    evidence: [
      'ASM lines 18667-18668 load the 0x9203 table and call _LABEL_92B7_.',
      'ASM lines 18763-18775 show _LABEL_92B7_ randomly indexes an eight-entry table and dispatches through the 0x92C8 table.',
    ],
  },
  {
    offset: 0x9227,
    inferredType: 'entity_data',
    role: 'state_transition_choice_table',
    confidence: 'high',
    summary: 'Eight-entry transition-choice table passed to _LABEL_92B7_ by the _LABEL_920B_ state handler.',
    evidence: [
      'ASM lines 18684-18685 load the 0x9227 table and call _LABEL_92B7_.',
      'ASM lines 18763-18775 show _LABEL_92B7_ randomly indexes an eight-entry table and dispatches through the 0x92C8 table.',
    ],
  },
  {
    offset: 0x92C8,
    inferredType: 'entity_behavior_table',
    role: 'state_transition_dispatch_table',
    confidence: 'high',
    summary: '_LABEL_92B7_ dispatches through this eight-entry behavior table after selecting an entry from a transition-choice table.',
    evidence: [
      'ASM lines 18763-18775: _LABEL_92B7_ indexes a caller-provided table with a random low-three-bit value, adjusts the value, and dispatches through RST $20.',
      'ASM lines 18776-18778 define the eight-entry jump table at _DATA_92C8_.',
      'ASM lines 18780-18879 define the target handlers reached from _DATA_92C8_.',
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
    tool: 'tools/world-bank2-state-machine-audit.mjs',
    summary: {
      regionsAudited: REGION_UPDATES.length,
      initRecordStream: {
        start: hex(0x9096),
        endExclusive: hex(0x90C6),
        recordCount: 8,
        recordSizeBytes: 6,
      },
      dispatchTables: [hex(0x90CA), hex(0x92C8)],
      transitionChoiceTables: REGION_UPDATES.filter(item => item.role === 'state_transition_choice_table').length,
      assetPolicy: 'Metadata only: offsets, labels, routine references, table roles, and confidence. No ROM bytes, decoded graphics, or gameplay assets are embedded.',
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
  if (inferredType === 'entity_data') return ['screen_prog', 'code', 'data_table', 'unknown', 'raw_byte'].includes(current);
  if (inferredType === 'entity_behavior_table') return ['code', 'pointer_table', 'data_table', 'unknown', 'raw_byte'].includes(current);
  return false;
}

function annotateRegion(region, item) {
  const typeBefore = region.type || 'unknown';
  const changedType = shouldRetype(region, item.inferredType);
  if (changedType) region.type = item.inferredType;
  region.analysis = region.analysis || {};
  region.analysis.bank2StateMachineAudit = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: 'tools/world-bank2-state-machine-audit.mjs',
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
    .filter(region => region.analysis?.bank2StateMachineAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.bank2StateMachineAudit.kind,
      confidence: region.analysis.bank2StateMachineAudit.confidence,
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
      type: 'bank2_state_machine_audit',
      generatedAt: now,
      tool: 'tools/world-bank2-state-machine-audit.mjs --apply',
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
        'Trace _RAM_D1AE_ jump table entry 6 to name the state-machine owner and connect it to a room, boss, or scripted event.',
        'Build a read-only parser for the eight six-byte records at 0x9096-0x90C5 that reports target labels and destination RAM fields without exposing raw bytes.',
        'Add diagnostics for _LABEL_92B7_ transition-choice tables so random state transitions can be compared against frame traces.',
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
