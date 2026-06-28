#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-cf52-cf54-entry-table-structure-audit.mjs';
const catalogId = 'world-cf52-cf54-entry-table-structure-catalog-2026-06-26';
const reportId = 'cf52-cf54-entry-table-structure-audit-2026-06-26';

const sourceCatalogs = [
  'world-cf52-cf54-write-coverage-catalog-2026-06-26',
  'world-status-vdp-writer-detail-catalog-2026-06-26',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = /^(?:0x|\$)?([0-9A-F]+)$/i.exec(String(value));
  return match ? parseInt(match[1], 16) : null;
}

function hex(value, pad = 2) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function catalogById(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item?.id === id);
    if (found) return found;
  }
  return null;
}

function regionStart(region) {
  return parseHex(region?.offset) ?? 0;
}

function regionEnd(region) {
  return regionStart(region) + Number(region?.size || 0);
}

function containingRegion(mapData, offset) {
  if (offset == null) return null;
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === String(address).toUpperCase()) || null;
}

function compactRam(entry) {
  if (!entry) return null;
  return {
    id: entry.id || '',
    address: entry.address || '',
    size: Number(entry.size || 1),
    type: entry.type || 'byte',
    name: entry.name || '',
  };
}

function cleanCode(line) {
  return String(line || '').split(';')[0].trim();
}

function lineCode(lines, line) {
  return cleanCode(lines[line - 1] || '');
}

function expectLine(lines, line, expected) {
  const code = lineCode(lines, line);
  if (!code.includes(expected)) {
    throw new Error(`ASM invariant failed at line ${line}: expected "${expected}", got "${code}"`);
  }
  return { line, code, expected };
}

function expectRegion(mapData, offset, size, label) {
  const region = containingRegion(mapData, offset);
  if (!region) throw new Error(`Missing region for ${label} at ${hex(offset, 5)}`);
  if (Number(region.size || 0) !== size) {
    throw new Error(`Unexpected ${label} size: found ${region.size}, expected ${size}`);
  }
  return region;
}

function buildSourceCatalogPresence(mapData) {
  return Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))]));
}

function buildLineChecks(lines) {
  return {
    entryLabel: expectLine(lines, 1459, '_LABEL_3F8_:'),
    cf8aBranchRead: expectLine(lines, 1492, 'ld a, (_RAM_CF8A_)'),
    usePresetOffset: expectLine(lines, 1495, 'ld de, $00D0'),
    readCf54: expectLine(lines, 1499, 'ld a, (_RAM_CF54_)'),
    maskThreeBits: expectLine(lines, 1500, 'and $07'),
    saveIndex: expectLine(lines, 1501, 'ld b, a'),
    cf54TableLoad: expectLine(lines, 1502, 'ld hl, _DATA_479_'),
    cf54IndexE: expectLine(lines, 1503, 'ld e, a'),
    cf54IndexD: expectLine(lines, 1504, 'ld d, $00'),
    cf54AddIndex: expectLine(lines, 1505, 'add hl, de'),
    cf54ReadTable: expectLine(lines, 1506, 'ld a, (hl)'),
    cf54Write: expectLine(lines, 1507, 'ld (_RAM_CF54_), a'),
    restoreIndex: expectLine(lines, 1508, 'ld a, b'),
    cf52TableLoad: expectLine(lines, 1509, 'ld hl, _DATA_481_'),
    cf52Rst08: expectLine(lines, 1510, 'rst $08'),
    cf52Rst10: expectLine(lines, 1511, 'rst $10'),
    cf52Write: expectLine(lines, 1513, 'ld (_RAM_CF52_), de'),
    table479Label: expectLine(lines, 1522, '_DATA_479_:'),
    table481Label: expectLine(lines, 1526, '_DATA_481_:'),
    rst08Label: expectLine(lines, 873, '_LABEL_8_:'),
    rst08LoadE: expectLine(lines, 874, 'ld e, a'),
    rst08ClearD: expectLine(lines, 875, 'ld d, $00'),
    rst08Add0: expectLine(lines, 876, 'add hl, de'),
    rst08Add1: expectLine(lines, 877, 'add hl, de'),
    rst10Label: expectLine(lines, 883, '_LABEL_10_:'),
    rst10ReadLow: expectLine(lines, 884, 'ld e, (hl)'),
    rst10Inc0: expectLine(lines, 885, 'inc hl'),
    rst10ReadHigh: expectLine(lines, 886, 'ld d, (hl)'),
    rst10Inc1: expectLine(lines, 887, 'inc hl'),
  };
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const data479Region = expectRegion(mapData, 0x00479, 8, '_DATA_479_');
  const data481Region = expectRegion(mapData, 0x00481, 16, '_DATA_481_');
  const rst08Region = containingRegion(mapData, 0x00008);
  const rst10Region = containingRegion(mapData, 0x00010);
  const entryRegion = containingRegion(mapData, 0x003F8);

  const tables = [
    {
      label: '_DATA_479_',
      offset: '0x00479',
      region: compactRegion(data479Region),
      structure: 'eight_one_byte_status_max_bucket_values',
      entryCount: 8,
      entrySizeBytes: 1,
      indexSource: '_RAM_CF54_ & 0x07',
      consumer: '_LABEL_3F8_',
      output: '_RAM_CF54_',
      confidence: 'high_for_indexing_and_region_size',
      evidenceLines: [
        lineChecks.readCf54,
        lineChecks.maskThreeBits,
        lineChecks.cf54TableLoad,
        lineChecks.cf54AddIndex,
        lineChecks.cf54ReadTable,
        lineChecks.cf54Write,
        lineChecks.table479Label,
      ],
    },
    {
      label: '_DATA_481_',
      offset: '0x00481',
      region: compactRegion(data481Region),
      structure: 'eight_little_endian_word_status_offset_entries',
      entryCount: 8,
      entrySizeBytes: 2,
      indexSource: 'same masked _RAM_CF54_ bucket preserved in B',
      consumer: '_LABEL_3F8_ with _LABEL_8_/_LABEL_10_',
      output: '_RAM_CF52_ via DE',
      confidence: 'high_for_rst08_rst10_indexing_and_region_size',
      evidenceLines: [
        lineChecks.saveIndex,
        lineChecks.restoreIndex,
        lineChecks.cf52TableLoad,
        lineChecks.cf52Rst08,
        lineChecks.cf52Rst10,
        lineChecks.cf52Write,
        lineChecks.table481Label,
      ],
    },
  ];

  const helperSemantics = [
    {
      label: '_LABEL_8_',
      offset: '0x00008',
      region: compactRegion(rst08Region),
      operation: 'HL += A * 2',
      roleInThisFlow: 'converts the preserved 0..7 bucket index into a word-table byte offset for _DATA_481_',
      evidenceLines: [
        lineChecks.rst08Label,
        lineChecks.rst08LoadE,
        lineChecks.rst08ClearD,
        lineChecks.rst08Add0,
        lineChecks.rst08Add1,
      ],
    },
    {
      label: '_LABEL_10_',
      offset: '0x00010',
      region: compactRegion(rst10Region),
      operation: 'DE = little-endian word at HL; HL += 2',
      roleInThisFlow: 'loads the selected _DATA_481_ word into DE before _LABEL_3F8_ writes _RAM_CF52_',
      evidenceLines: [
        lineChecks.rst10Label,
        lineChecks.rst10ReadLow,
        lineChecks.rst10Inc0,
        lineChecks.rst10ReadHigh,
        lineChecks.rst10Inc1,
      ],
    },
  ];

  const evidence = [
    'ASM lines 1499-1501 read _RAM_CF54_, mask it with 0x07, and preserve the resulting 0..7 bucket index in B.',
    'ASM lines 1502-1507 index _DATA_479_ by that bucket and write the selected byte back to _RAM_CF54_.',
    'ASM lines 1508-1513 reuse the same bucket index to select a word from _DATA_481_ through _LABEL_8_/_LABEL_10_, then write DE to _RAM_CF52_.',
    'ASM lines 873-878 prove _LABEL_8_ doubles A into an HL byte offset by adding DE twice.',
    'ASM lines 883-888 prove _LABEL_10_ reads a little-endian word from HL into DE.',
    'Current map regions confirm _DATA_479_ is 8 bytes at 0x00479 and _DATA_481_ is 16 bytes at 0x00481.',
    'This audit stores labels, offsets, line numbers, sizes, counts, and structure only; it does not persist the table bytes, decoded graphics, pixels, text, timing bytes, or audio data.',
  ];

  return {
    id: catalogId,
    type: 'cf52_cf54_entry_table_structure',
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: buildSourceCatalogPresence(mapData),
    scope: {
      entryRoutine: '_LABEL_3F8_',
      statusMaxRam: '_RAM_CF54_',
      statusOffsetRam: '_RAM_CF52_',
      bucketIndexExpression: '_RAM_CF54_ & 0x07',
      dataBytesPersisted: false,
    },
    entryFlow: {
      entryRoutineRegion: compactRegion(entryRegion),
      presetOffsetBranch: {
        condition: '_RAM_CF8A_ != 0',
        valueRegister: 'DE',
        valueHex: '0x00D0',
        writeTarget: '_RAM_CF52_',
        evidenceLines: [lineChecks.cf8aBranchRead, lineChecks.usePresetOffset, lineChecks.cf52Write],
      },
      tableBucketBranch: {
        condition: '_RAM_CF8A_ == 0',
        bucketCount: 8,
        tables: ['_DATA_479_', '_DATA_481_'],
        evidenceLines: [
          lineChecks.readCf54,
          lineChecks.maskThreeBits,
          lineChecks.cf54Write,
          lineChecks.cf52Write,
        ],
      },
    },
    tables,
    helperSemantics,
    summary: {
      status: 'cf52_cf54_entry_tables_structured',
      confidence: 'high_for_table_sizes_and_rst_helper_semantics',
      tableCount: tables.length,
      bucketCount: 8,
      data479EntryCount: 8,
      data481EntryCount: 8,
      data481EntrySizeBytes: 2,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Use a local-ROM analyzer decoder to preview the _DATA_479_ and _DATA_481_ values without committing table bytes.',
      'Connect each 0..7 bucket to the status VDP writer state by simulating _LABEL_3F8_ setup from current _RAM_CF54_.',
      'Resolve whether _RAM_CF54_ should remain named as a heart/status maximum once all shop, reward, password, and transition contexts are modeled.',
    ],
  };
}

function annotateRegion(region, value, annotatedRegions) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis.cf52Cf54EntryTableStructureAudit = value;
  annotatedRegions.push(compactRegion(region));
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  const evidence = catalog.evidence;

  annotateRegion(containingRegion(mapData, 0x003F8), {
    catalogId,
    kind: 'cf52_cf54_entry_table_consumer',
    confidence: 'high',
    summary: '_LABEL_3F8_ masks _RAM_CF54_ to a 0..7 bucket, uses _DATA_479_ to update _RAM_CF54_, and uses _DATA_481_ through _LABEL_8_/_LABEL_10_ to update _RAM_CF52_.',
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  for (const table of catalog.tables) {
    annotateRegion(containingRegion(mapData, parseHex(table.offset)), {
      catalogId,
      kind: table.structure,
      confidence: table.confidence,
      entryCount: table.entryCount,
      entrySizeBytes: table.entrySizeBytes,
      indexSource: table.indexSource,
      consumer: table.consumer,
      output: table.output,
      summary: `${table.label} is structurally modeled as ${table.entryCount} entries of ${table.entrySizeBytes} byte(s), consumed by _LABEL_3F8_ without persisting table bytes.`,
      evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
  }

  for (const helper of catalog.helperSemantics) {
    annotateRegion(containingRegion(mapData, parseHex(helper.offset)), {
      catalogId,
      kind: 'rst_helper_for_cf52_entry_table',
      confidence: 'high',
      operation: helper.operation,
      roleInThisFlow: helper.roleInThisFlow,
      summary: `${helper.label} participates in _DATA_481_ word-table selection for _RAM_CF52_ setup.`,
      evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
  }

  for (const [address, kind, summary] of [
    ['$CF52', 'entry_table_status_offset_output', '_RAM_CF52_ receives either a literal 0x00D0 preset or a little-endian word selected from _DATA_481_ by the masked _RAM_CF54_ bucket.'],
    ['$CF54', 'entry_table_status_max_bucket_source_and_output', '_RAM_CF54_ supplies the low three-bit bucket index and is rewritten from the selected _DATA_479_ byte in _LABEL_3F8_.'],
  ]) {
    const entry = findRam(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.cf52Cf54EntryTableStructureAudit = {
      catalogId,
      kind,
      confidence: 'high_for_structure',
      summary,
      evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRam.push(compactRam(entry));
  }

  return { annotatedRegions, annotatedRam };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  let annotation = { annotatedRegions: [], annotatedRam: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    mapData.bank0StatusInventoryCatalogs = (mapData.bank0StatusInventoryCatalogs || []).filter(item => item.id !== catalogId);
    mapData.bank0StatusInventoryCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'cf52_cf54_entry_table_structure_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs,
      sourceCatalogPresence: catalog.sourceCatalogPresence,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotation.annotatedRegions.length,
        annotatedRamCount: annotation.annotatedRam.length,
      },
      scope: catalog.scope,
      entryFlow: catalog.entryFlow,
      tables: catalog.tables,
      helperSemantics: catalog.helperSemantics,
      annotatedRegions: annotation.annotatedRegions,
      annotatedRam: annotation.annotatedRam,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotation.annotatedRegions.length,
      annotatedRamCount: annotation.annotatedRam.length,
    },
    sourceCatalogPresence: catalog.sourceCatalogPresence,
    tables: catalog.tables.map(table => ({
      label: table.label,
      structure: table.structure,
      entryCount: table.entryCount,
      entrySizeBytes: table.entrySizeBytes,
      output: table.output,
    })),
    helperSemantics: catalog.helperSemantics.map(helper => ({
      label: helper.label,
      operation: helper.operation,
    })),
  }, null, 2));
}

main();
