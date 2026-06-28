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
const catalogId = 'world-bank7-pause-data-catalog-2026-06-24';
const reportId = 'bank7-pause-data-audit-2026-06-24';

const REGIONS = [
  {
    offset: 0x1DD64,
    inferredType: 'pointer_table',
    confidence: 'high',
    role: 'pause_status_data_pointer_table',
    name: '_DATA_1DD64_',
    summary: 'Two-byte pointer record that targets the 0x1DE20 pause/status data block; not an independent screen_prog stream.',
    evidence: [
      'ASM line 28528 defines _DATA_1DD64_.',
      'ASM line 28529 emits .dw _DATA_1DE20_, an explicit pointer to the following data block.',
      'screen_prog reachability audit finds no _LABEL_604_ root, _DATA_1CCC0_ target, or decoded root continuation for 0x1DD64.',
    ],
  },
  {
    offset: 0x1DD66,
    inferredType: 'data_table',
    confidence: 'low',
    role: 'pause_status_adjacent_word_payload',
    name: 'pause/status data payload @ 0x1DD66',
    summary: 'Data payload immediately after the 0x1DD64 pointer record; kept as a generic table until a runtime consumer is traced.',
    evidence: [
      'ASM line 28531 starts a data block from 0x1DD66 to 0x1DE03 immediately after _DATA_1DD64_.',
      'screen_prog reachability audit marks 0x1DD66 unrooted by _LABEL_604_ despite a clean byte-shape decode.',
      'No exact executable ASM consumer for 0x1DD66 has been identified yet.',
    ],
  },
  {
    offset: 0x1DE04,
    inferredType: 'pointer_table',
    confidence: 'high',
    role: 'pause_status_ram_buffer_pointer_record',
    name: '_DATA_1DE04_',
    summary: 'Two-byte pointer-like record to a RAM-buffer expression; not screen_prog bytecode.',
    evidence: [
      'ASM line 28545 defines _DATA_1DE04_.',
      'ASM line 28546 emits .dw $2000 | _RAM_C10E_, so the bytes are an address expression rather than screen bytecode.',
      'screen_prog reachability audit finds no _LABEL_604_ root, _DATA_1CCC0_ target, or decoded root continuation for 0x1DE04.',
    ],
  },
  {
    offset: 0x1DE06,
    inferredType: 'data_table',
    confidence: 'low',
    role: 'pause_status_ram_buffer_payload',
    name: 'pause/status data payload @ 0x1DE06',
    summary: 'Data payload immediately after the 0x1DE04 RAM-buffer pointer record.',
    evidence: [
      'ASM line 28548 starts a data block from 0x1DE06 to 0x1DE1F immediately after _DATA_1DE04_.',
      'screen_prog reachability audit marks 0x1DE06 unrooted and shows the screen_prog decoder walks outside this small region.',
      'No exact executable ASM consumer for 0x1DE06 has been identified yet.',
    ],
  },
  {
    offset: 0x1DE20,
    inferredType: 'data_table',
    confidence: 'medium',
    role: 'pause_status_data_block_entry',
    name: '_DATA_1DE20_',
    summary: 'Entry data block pointed to by _DATA_1DD64_; retained as generic table data until its record format is decoded.',
    evidence: [
      'ASM line 28529 points _DATA_1DD64_ at _DATA_1DE20_.',
      'ASM line 28554 defines _DATA_1DE20_ and starts the 0x1DE20-0x1E14D data block.',
      'screen_prog reachability audit marks 0x1DE20 unrooted by direct _LABEL_604_ callers and _DATA_1CCC0_ table targets.',
    ],
  },
  {
    offset: 0x1DE9F,
    inferredType: 'data_table',
    confidence: 'low',
    role: 'pause_status_data_block_fragment',
    name: 'pause/status data fragment @ 0x1DE9F',
    summary: 'Internal split inside the larger _DATA_1DE20_ data block; not a separate confirmed screen_prog root.',
    evidence: [
      'ASM line 28554 starts one continuous data block at _DATA_1DE20_ that spans through 0x1E14D.',
      '0x1DE9F lies inside that _DATA_1DE20_ block rather than at an executable _LABEL_604_ source.',
      'screen_prog reachability audit marks 0x1DE9F as unrooted and its byte-shape decoder walks outside the mapped fragment.',
    ],
  },
  {
    offset: 0x1DEAF,
    inferredType: 'data_table',
    confidence: 'low',
    role: 'pause_status_data_block_fragment',
    name: 'pause/status data fragment @ 0x1DEAF',
    summary: 'Internal split inside the larger _DATA_1DE20_ data block; not a separate confirmed screen_prog root.',
    evidence: [
      'ASM line 28554 starts one continuous data block at _DATA_1DE20_ that spans through 0x1E14D.',
      '0x1DEAF lies inside that _DATA_1DE20_ block rather than at an executable _LABEL_604_ source.',
      'screen_prog reachability audit marks 0x1DEAF unrooted by direct _LABEL_604_ callers and _DATA_1CCC0_ table targets.',
    ],
  },
  {
    offset: 0x1DF2A,
    inferredType: 'data_table',
    confidence: 'low',
    role: 'pause_status_data_block_fragment',
    name: 'pause/status data fragment @ 0x1DF2A',
    summary: 'Internal split inside the larger _DATA_1DE20_ data block; not a separate confirmed screen_prog root.',
    evidence: [
      'ASM line 28554 starts one continuous data block at _DATA_1DE20_ that spans through 0x1E14D.',
      '0x1DF2A lies inside that _DATA_1DE20_ block rather than at an executable _LABEL_604_ source.',
      'screen_prog reachability audit marks 0x1DF2A as unrooted and its byte-shape decoder walks outside the mapped fragment.',
    ],
  },
  {
    offset: 0x1E337,
    inferredType: 'data_table',
    confidence: 'low',
    role: 'unresolved_post_1e200_data_block',
    name: '_DATA_1E337_',
    summary: 'Labeled data after the _LABEL_1E200_ routine; no confirmed screen_prog consumer has been found.',
    evidence: [
      'ASM line 28779 defines _DATA_1E337_ as a 41-byte data block after _LABEL_1E200_ returns.',
      'Text search finds no executable ASM reference to _DATA_1E337_ outside its definition.',
      'screen_prog reachability audit marks 0x1E337 unrooted and the byte-shape decoder walks outside the mapped region.',
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

function canRetype(region, inferredType) {
  if (!region) return false;
  const current = region.type || 'unknown';
  if (current === inferredType) return false;
  if (inferredType === 'pointer_table') return ['screen_prog', 'data_table', 'raw_byte', 'unknown'].includes(current);
  if (inferredType === 'data_table') return ['screen_prog', 'raw_byte', 'unknown'].includes(current);
  return false;
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-bank7-pause-data-audit.mjs',
    summary: {
      regionCount: REGIONS.length,
      pointerTables: REGIONS.filter(item => item.inferredType === 'pointer_table').length,
      dataTables: REGIONS.filter(item => item.inferredType === 'data_table').length,
      assetPolicy: 'Metadata only: offsets, labels, ASM line references, broad table roles, confidence, and evidence. No ROM bytes, decoded text, graphics, or music are embedded.',
    },
    entries: REGIONS.map(item => ({
      offset: hex(item.offset),
      inferredType: item.inferredType,
      confidence: item.confidence,
      role: item.role,
      name: item.name,
      summary: item.summary,
      region: regionRef(findExactRegion(mapData, item.offset)),
      evidence: item.evidence,
    })),
  };
}

function annotateRegion(region, item) {
  const typeBefore = region.type || 'unknown';
  const changedType = canRetype(region, item.inferredType);
  if (changedType) region.type = item.inferredType;
  if (item.name && (!region.name || /^screen_prog @/.test(region.name))) region.name = item.name;
  region.analysis = region.analysis || {};
  region.analysis.bank7PauseDataAudit = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: 'tools/world-bank7-pause-data-audit.mjs',
  };
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    typeBefore,
    typeAfter: region.type || typeBefore,
    changedType,
    kind: item.role,
    confidence: item.confidence,
  };
}

function applyAnnotations(mapData) {
  const changed = [];
  const evidenceOnly = [];
  const missing = [];
  for (const item of REGIONS) {
    const region = findExactRegion(mapData, item.offset);
    if (!region) {
      missing.push({
        offset: hex(item.offset),
        inferredType: item.inferredType,
        role: item.role,
      });
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
    .filter(region => region.analysis?.bank7PauseDataAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.bank7PauseDataAudit.kind,
      confidence: region.analysis.bank7PauseDataAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const changes = applyAnnotations(mapData);
  const catalog = buildCatalog(mapData);

  if (apply) {
    mapData.smallDataCatalogs = (mapData.smallDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.smallDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank7_pause_data_audit',
      generatedAt: now,
      tool: 'tools/world-bank7-pause-data-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
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
        'Trace the runtime consumer for _DATA_1DD64_/_DATA_1DE04_ instead of relying on disassembler index comments.',
        'Decode the _DATA_1DE20_ record format; current evidence supports table data but not field semantics.',
        'Find or rule out a consumer for _DATA_1E337_ before giving it a semantic role.',
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
  }, null, 2));
}

main();
