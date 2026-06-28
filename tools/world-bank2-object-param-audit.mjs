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
const catalogId = 'world-bank2-object-param-catalog-2026-06-24';
const reportId = 'bank2-object-param-audit-2026-06-24';

const PARAM_TABLES = [
  {
    offset: 0x93D2,
    inferredType: 'data_table',
    role: 'object_spawn_random_gate_mask_table',
    confidence: 'high',
    summary: '_LABEL_9399_ indexes this mask table with _RAM_D18E_ and tests it against the _LABEL_D36_ pseudo-random byte before setting the spawn flag.',
    evidence: [
      'ASM line 18921 loads HL with _DATA_93D2_.',
      'ASM lines 18915-18929 call _LABEL_D36_, bound _RAM_D18E_ to eight entries, add the index to _DATA_93D2_, and test the selected mask.',
      'ASM lines 18930-18934 set _RAM_D17E_ bit 0 and _RAM_D18F_ bit 0 only when the random-gate test passes.',
    ],
  },
  {
    offset: 0x9540,
    inferredType: 'entity_data',
    role: 'object_spawn_y_position_lookup',
    confidence: 'high',
    summary: '_LABEL_9526_ indexes this eight-entry lookup with a random low-three-bit value and writes the result to _RAM_D154_/_RAM_D153_.',
    evidence: [
      'ASM lines 19165-19172 call _LABEL_D36_, mask the result to three bits, and add it to the 0x9540 table base.',
      'ASM lines 19173-19177 copy the selected byte into _RAM_D154_ and _RAM_D153_.',
    ],
  },
  {
    offset: 0x955E,
    inferredType: 'entity_data',
    role: 'object_spawn_x_position_lookup',
    confidence: 'high',
    summary: '_LABEL_9548_ indexes this eight-entry lookup with a random low-three-bit value and writes the result to _RAM_D151_.',
    evidence: [
      'ASM lines 19183-19190 call _LABEL_D36_, mask the result to three bits, and add it to the 0x955E table base.',
      'ASM lines 19191-19194 copy the selected byte into _RAM_D151_.',
    ],
  },
  {
    offset: 0x9627,
    inferredType: 'entity_data',
    role: 'object_spawn_velocity_word_table',
    confidence: 'high',
    summary: 'The spawn helper inside _LABEL_9566_ indexes this word table with a random even index, mirrors it when needed, and stores the selected velocity into IX object fields.',
    evidence: [
      'ASM lines 19239-19245 call _LABEL_D36_, mask the result to an even table offset, and load HL with _DATA_9627_.',
      'ASM lines 19246-19258 read a word from the selected entry and conditionally mirror it based on _RAM_D15D_ bit 0.',
      'ASM lines 19259-19262 store the selected values into IX+8/IX+9 and IX+17 for the spawned object.',
    ],
  },
  {
    offset: 0x96E9,
    inferredType: 'entity_data',
    role: 'object_slot_vector_pair_table',
    confidence: 'high',
    summary: '_LABEL_962F_ uses this eight-pair vector table to initialize IX+9 and IX+11 for the object slots it clones from the first slot.',
    evidence: [
      'ASM line 19365 loads HL with _DATA_96E9_.',
      'ASM lines 19361-19383 iterate eight 0x40-byte IX object slots, reset per-slot state, and copy one pair from _DATA_96E9_ into IX+9/IX+11.',
      'ASM lines 19339-19357 clone the base object slot into seven following slots before the vector-pair table is applied.',
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
    tool: 'tools/world-bank2-object-param-audit.mjs',
    summary: {
      parameterTables: PARAM_TABLES.length,
      routines: ['_LABEL_9399_', '_LABEL_9526_', '_LABEL_9548_', '_LABEL_9566_', '_LABEL_962F_'],
      assetPolicy: 'Metadata only: offsets, labels, routine references, table roles, and confidence. No ROM bytes, decoded graphics, or gameplay assets are embedded.',
    },
    entries: PARAM_TABLES.map(item => ({
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
  if (inferredType === 'data_table') return ['screen_prog', 'unknown', 'raw_byte'].includes(current);
  if (inferredType === 'entity_data') return ['screen_prog', 'data_table', 'unknown', 'raw_byte'].includes(current);
  return false;
}

function annotateRegion(region, item) {
  const typeBefore = region.type || 'unknown';
  const changedType = shouldRetype(region, item.inferredType);
  if (changedType) region.type = item.inferredType;
  region.analysis = region.analysis || {};
  region.analysis.bank2ObjectParamAudit = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: 'tools/world-bank2-object-param-audit.mjs',
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
    .filter(region => region.analysis?.bank2ObjectParamAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.bank2ObjectParamAudit.kind,
      confidence: region.analysis.bank2ObjectParamAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const changes = applyAnnotations(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.entityDataCatalogs = (mapData.entityDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.entityDataCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_object_param_audit',
      generatedAt: now,
      tool: 'tools/world-bank2-object-param-audit.mjs --apply',
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
        'Name the object family controlled by _RAM_D17E_, _RAM_D18E_, and the eight 0x40-byte slots at _RAM_C3C0_.',
        'Trace callers of _LABEL_9526_ and _LABEL_9548_ to connect these spawn-position tables to the owning room or enemy behavior.',
        'Model the _LABEL_9566_ spawn helper as read-only object-init diagnostics before porting it into JavaScript gameplay modules.',
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
