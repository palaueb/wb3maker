#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-player-form-catalog-2026-06-24';
const reportId = 'player-form-audit-2026-06-24';
const BANK7_BASE = 0x1C000;

const FORM_RECORD_TABLE = {
  label: '_DATA_BDB1_',
  offset: 0x0BDB1,
  pointerCount: 6,
  selectorRam: '_RAM_C24F_',
  consumer: '_LABEL_BD26_',
  targetType: 'data_table',
  targetKind: 'player_form_transition_record',
  summary: 'Six fixed-size player form transition records selected by _RAM_C24F_ and consumed field-by-field by _LABEL_BD26_.',
};

const FORM_LOADER_TABLE = {
  label: '_DATA_BF76_',
  offset: 0x0BF76,
  pointerCount: 6,
  selectorRam: '_RAM_C24F_',
  consumer: '_LABEL_BD26_',
  loaderRoutine: '_LABEL_12C9_',
  targetType: 'vram_loader_998',
  targetKind: 'player_form_bank7_vram_loader_998',
  summary: 'Six bank-7 998-format VRAM loader scripts selected by _RAM_C24F_ and executed through _LABEL_12C9_.',
};

const STATIC_LOADERS = [
  {
    label: '_DATA_BF51_',
    offset: 0x0BF51,
    type: 'vram_loader_998',
    consumer: '_LABEL_BA62_',
    summary: 'Static 998 loader used before player-form transition animation setup.',
  },
  {
    label: '_DATA_BF6A_',
    offset: 0x0BF6A,
    type: 'vram_loader_998',
    consumer: '_LABEL_BC31_',
    summary: 'Static 998 loader used by the C3C0 entity setup path.',
  },
  {
    label: '_DATA_BF82_',
    offset: 0x0BF82,
    type: 'vram_loader_8fb',
    consumer: '_LABEL_BD26_',
    summary: 'Static 8FB loader applied after player-form transition records are initialized.',
  },
];

const ROUTINES = [
  {
    label: '_LABEL_BD26_',
    role: 'player_form_transition_setup',
    summary: 'Selects _DATA_BF76_ and _DATA_BDB1_ by _RAM_C24F_, initializes C3C0 entity state fields, and applies _DATA_BF82_.',
  },
  {
    label: '_LABEL_12C9_',
    role: 'bank7_998_loader_bridge',
    summary: 'Switches to bank 7, executes _LABEL_998_ on the selected HL script, then restores the prior bank context.',
  },
  {
    label: '_LABEL_BB13_',
    role: 'player_form_entity_init',
    summary: 'Selects _DATA_BFB0_ by _RAM_C24F_ and initializes C3C0 entity state fields for player-form animation.',
  },
];

const RAM_ROLES = [
  { address: '$C24F', label: '_RAM_C24F_', role: 'player_form_selector', confidence: 'high', summary: 'Indexes both _DATA_BDB1_ form records and _DATA_BF76_ bank-7 loader scripts.' },
  { address: '$C3C0', label: '_RAM_C3C0_', role: 'form_entity_flags', confidence: 'medium', summary: '_LABEL_BD26_ writes $80 to this C3C0 entity state base after loading form-specific fields.' },
  { address: '$C3C3', label: '_RAM_C3C3_', role: 'form_entity_position_word_candidate', confidence: 'medium', summary: '_LABEL_BD26_ reads a word from the selected _DATA_BDB1_ record into this C3C0 entity field.' },
  { address: '$C3C6', label: '_RAM_C3C6_', role: 'form_entity_position_word_candidate', confidence: 'medium', summary: '_LABEL_BD26_ reads a word from the selected _DATA_BDB1_ record into this C3C0 entity field.' },
  { address: '$C3CF', label: '_RAM_C3CF_', role: 'form_entity_handler_index', confidence: 'high', summary: '_LABEL_BD26_ reads one byte from the selected _DATA_BDB1_ record into _RAM_C3CF_, which indexes the 69-entry handler table at _DATA_668E_.' },
  { address: '$D00F', label: '_RAM_D00F_', role: 'form_scroll_or_world_origin_candidate', confidence: 'medium', summary: '_LABEL_BD26_ reads one word from the selected _DATA_BDB1_ record into _RAM_D00F_ and mirrors its low byte to _RAM_CF8C_.' },
  { address: '$D0FE', label: '_RAM_D0FE_', role: 'form_work_pointer_0_candidate', confidence: 'medium', summary: '_LABEL_BD26_ reads one word from the selected _DATA_BDB1_ record into _RAM_D0FE_.' },
  { address: '$D100', label: '_RAM_D100_', role: 'form_work_pointer_1_candidate', confidence: 'medium', summary: '_LABEL_BD26_ reads one word from the selected _DATA_BDB1_ record into _RAM_D100_.' },
  { address: '$CF8C', label: '_RAM_CF8C_', role: 'form_scroll_low_byte', confidence: 'medium', summary: '_LABEL_BD26_ copies the low byte of the _RAM_D00F_ record word into _RAM_CF8C_.' },
  { address: '$CFE1', label: '_RAM_CFE1_', role: 'scroll_update_flag', confidence: 'medium', summary: '_LABEL_BD26_ sets this flag after selecting form-specific data and before entity setup continues.' },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readWordLE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function regionBounds(region) {
  const start = parseInt(region.offset, 16);
  return { start, end: start + (region.size || 0) };
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
  }) || null;
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

function normalizeAddress(address) {
  return String(address || '').toUpperCase().replace(/^0X/, '$');
}

function findRamEntry(mapData, address) {
  const normalized = normalizeAddress(address);
  return (mapData.ram || []).find(entry => normalizeAddress(entry.address) === normalized) || null;
}

function ramRef(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || '',
    name: entry.name || '',
  };
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function buildAsmIndex(asmText) {
  const lines = asmText.split(/\r?\n/);
  const labelsByOffset = new Map();
  const labelLines = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_(?:LABEL|DATA)_[0-9A-F]+_):/.exec(lines[i]);
    if (!match) continue;
    const offset = labelOffset(match[1]);
    if (offset == null) continue;
    labelsByOffset.set(offset, match[1]);
    labelLines.set(match[1], i + 1);
  }
  return { lines, labelsByOffset, labelLines };
}

function scanLabelBlock(asmIndex, label) {
  const startLine = asmIndex.labelLines.get(label);
  if (!startLine) return null;
  const lines = asmIndex.lines;
  const calls = new Set();
  const dataRefs = new Set();
  const readsRAM = new Set();
  const writesRAM = new Set();
  for (let i = startLine; i < lines.length; i++) {
    if (i > startLine && /^_(?:LABEL|DATA)_[0-9A-F]+_:/.test(lines[i])) break;
    const code = cleanCode(lines[i]);
    if (!code) continue;
    const callMatch = /\bcall\s+(_LABEL_[0-9A-F]+_)/i.exec(code);
    if (callMatch) calls.add(callMatch[1]);
    let dataMatch;
    const dataRe = /_DATA_[0-9A-F]+_/gi;
    while ((dataMatch = dataRe.exec(code)) !== null) dataRefs.add(dataMatch[0]);
    let ramMatch;
    const ramRe = /_RAM_[0-9A-F]+_/gi;
    while ((ramMatch = ramRe.exec(code)) !== null) {
      const ref = ramMatch[0];
      const before = code.slice(0, ramMatch.index);
      if (/\bld\s+\($/i.test(before) || /\bld\s+\([^)]*$/i.test(before)) writesRAM.add(ref);
      else readsRAM.add(ref);
    }
  }
  return {
    startLine,
    calls: [...calls].sort(),
    dataRefs: [...dataRefs].sort(),
    readsRAM: [...readsRAM].sort(),
    writesRAM: [...writesRAM].sort(),
  };
}

function bank7Z80ToRom(pointer) {
  if (pointer < 0x8000 || pointer >= 0xC000) return null;
  return BANK7_BASE + (pointer - 0x8000);
}

function buildPointerTable(mapData, asmIndex, romBytes, def) {
  const tableRegion = findContainingRegion(mapData, def.offset);
  const entries = [];
  for (let index = 0; index < def.pointerCount; index++) {
    const pointerOffset = def.offset + index * 2;
    const z80Pointer = readWordLE(romBytes, pointerOffset);
    const targetOffset = def === FORM_LOADER_TABLE ? bank7Z80ToRom(z80Pointer) : z80Pointer;
    const targetRegion = targetOffset == null ? null : findContainingRegion(mapData, targetOffset);
    entries.push({
      index,
      pointerOffset: hex(pointerOffset),
      z80Pointer: hex(z80Pointer, 4),
      targetOffset: targetOffset == null ? null : hex(targetOffset),
      targetLabel: targetOffset == null ? null : asmIndex.labelsByOffset.get(targetOffset) || null,
      targetRegion: regionRef(targetRegion),
    });
  }
  const line = asmIndex.labelLines.get(def.label) || null;
  return {
    label: def.label,
    offset: hex(def.offset),
    region: regionRef(tableRegion),
    selectorRam: def.selectorRam,
    consumer: def.consumer,
    targetType: def.targetType,
    targetKind: def.targetKind,
    summary: def.summary,
    entries,
    evidence: [
      line ? `ASM line ${line}: ${def.label} is emitted as a six-entry .dw pointer table indexed by _RAM_C24F_.` : `${def.label} is a six-entry .dw pointer table indexed by _RAM_C24F_.`,
      def === FORM_LOADER_TABLE
        ? '_LABEL_BD26_ selects one _DATA_BF76_ target and _LABEL_12C9_ executes it through _LABEL_998_ after switching to bank 7.'
        : '_LABEL_BD26_ selects one _DATA_BDB1_ target and reads it as fixed fields with rst $10.',
      'Catalog stores pointer offsets, target offsets, and layout metadata only; no ROM bytes are embedded.',
    ],
  };
}

function buildRecordLayout() {
  return [
    { byteOffset: 0, size: 2, consumer: '_LABEL_2A49_', role: 'word passed through DE after first rst $10' },
    { byteOffset: 2, size: 2, destination: '_RAM_D00F_', role: 'word copied to _RAM_D00F_ and low byte mirrored to _RAM_CF8C_' },
    { byteOffset: 4, size: 2, destination: '_RAM_C3C3_', role: 'word copied to C3C0 entity field _RAM_C3C3_' },
    { byteOffset: 6, size: 2, destination: '_RAM_C3C6_', role: 'word copied to C3C0 entity field _RAM_C3C6_' },
    { byteOffset: 8, size: 1, destination: '_RAM_C3CF_', role: 'byte copied to entity handler index _RAM_C3CF_' },
    { byteOffset: 9, size: 2, destination: '_RAM_D0FE_', role: 'word copied to work pointer _RAM_D0FE_' },
    { byteOffset: 11, size: 2, destination: '_RAM_D100_', role: 'word copied to work pointer _RAM_D100_' },
  ];
}

function buildRoutine(mapData, asmIndex, def) {
  const offset = labelOffset(def.label);
  const region = offset == null ? null : findContainingRegion(mapData, offset);
  const scan = scanLabelBlock(asmIndex, def.label);
  return {
    label: def.label,
    offset: offset == null ? null : hex(offset),
    role: def.role,
    summary: def.summary,
    region: regionRef(region),
    asmLine: scan?.startLine || null,
    calls: scan?.calls || [],
    dataRefs: scan?.dataRefs || [],
    readsRAM: scan?.readsRAM || [],
    writesRAM: scan?.writesRAM || [],
    evidence: [
      scan?.startLine ? `ASM line ${scan.startLine}: ${def.label} routine entry.` : `${def.label} routine entry was not located in ASM index.`,
      def.summary,
    ],
  };
}

function buildStaticLoader(mapData, asmIndex, def) {
  const region = findContainingRegion(mapData, def.offset);
  const line = asmIndex.labelLines.get(def.label) || null;
  return {
    ...def,
    offset: hex(def.offset),
    region: regionRef(region),
    evidence: [
      line ? `ASM line ${line}: ${def.label} loader script starts at ${hex(def.offset)}.` : `${def.label} loader script starts at ${hex(def.offset)}.`,
      `${def.consumer} loads this script before calling the matching VRAM loader routine.`,
    ],
  };
}

function buildRam(mapData, def) {
  const entry = findRamEntry(mapData, def.address);
  return {
    ...def,
    ram: ramRef(entry),
    evidence: [
      `${def.label} is read or written by _LABEL_BD26_ and related player-form setup routines.`,
      def.summary,
    ],
  };
}

function buildCatalog(mapData, asmText, romBytes) {
  const asmIndex = buildAsmIndex(asmText);
  const recordTable = buildPointerTable(mapData, asmIndex, romBytes, FORM_RECORD_TABLE);
  const loaderTable = buildPointerTable(mapData, asmIndex, romBytes, FORM_LOADER_TABLE);
  const staticLoaders = STATIC_LOADERS.map(def => buildStaticLoader(mapData, asmIndex, def));
  const routines = ROUTINES.map(def => buildRoutine(mapData, asmIndex, def));
  const ramVariables = RAM_ROLES.map(def => buildRam(mapData, def));
  const recordTargets = recordTable.entries.filter(entry => entry.targetRegion);
  const loaderTargets = loaderTable.entries.filter(entry => entry.targetRegion);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-player-form-audit.mjs',
    summary: {
      pointerTables: 2,
      formRecordTargets: recordTargets.length,
      bank7LoaderTargets: loaderTargets.length,
      staticLoaders: staticLoaders.length,
      routines: routines.length,
      ramVariables: ramVariables.length,
      missingTargetRegions: recordTable.entries.concat(loaderTable.entries).filter(entry => !entry.targetRegion).length,
      missingRamEntries: ramVariables.filter(entry => !entry.ram).length,
      assetPolicy: 'Metadata only: pointer offsets, target offsets, table layouts, loader formats, routine labels, and RAM addresses. No ROM bytes, decoded graphics, or rendered assets are embedded.',
    },
    recordTable: {
      ...recordTable,
      recordLayout: buildRecordLayout(),
      recordSizeBytes: 13,
    },
    loaderTable,
    staticLoaders,
    routines,
    ramVariables,
  };
}

function annotateTableRegion(region, table, kind) {
  region.analysis = region.analysis || {};
  region.analysis.playerFormAudit = {
    catalogId,
    kind,
    summary: table.summary,
    confidence: 'high',
    selectorRam: table.selectorRam,
    consumer: table.consumer,
    entries: table.entries.map(entry => ({
      index: entry.index,
      targetOffset: entry.targetOffset,
      targetRegionId: entry.targetRegion?.id || null,
      targetType: table.targetType,
    })),
    evidence: table.evidence,
    generatedAt: now,
    tool: 'tools/world-player-form-audit.mjs',
  };
}

function annotateTargetRegion(region, table, entry) {
  const typeBefore = region.type || 'unknown';
  region.type = table.targetType;
  if (table.targetType === 'vram_loader_998') {
    region.params = { ...(region.params || {}), format: '998', loaderFormat: '998' };
  }
  region.analysis = region.analysis || {};
  if (region.analysis.screenProgAudit) delete region.analysis.screenProgAudit;
  region.analysis.inferred = {
    kind: table.targetKind,
    summary: table.targetType === 'vram_loader_998'
      ? 'Bank-7 998-format VRAM loader script selected by _RAM_C24F_ through _DATA_BF76_ and executed by _LABEL_12C9_.'
      : 'Fixed-size player form transition record selected by _RAM_C24F_ through _DATA_BDB1_ and read by _LABEL_BD26_.',
    confidence: 'high',
    tags: table.targetType === 'vram_loader_998' ? ['player-form', 'vram-loader', 'bank7'] : ['player-form', 'data-record'],
    relations: {
      pointerTable: table.label,
      consumer: table.consumer,
      loaderRoutine: table.loaderRoutine,
    },
    evidence: table.evidence,
  };
  region.analysis.playerFormAudit = {
    catalogId,
    kind: table.targetKind,
    summary: region.analysis.inferred.summary,
    confidence: 'high',
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type,
    changedType: typeBefore !== region.type,
    tableLabel: table.label,
    tableEntryIndex: entry.index,
    targetOffset: entry.targetOffset,
    recordLayout: table.recordLayout || undefined,
    evidence: table.evidence,
    generatedAt: now,
    tool: 'tools/world-player-form-audit.mjs',
  };
}

function annotateStaticLoader(region, loader) {
  region.analysis = region.analysis || {};
  region.analysis.playerFormAudit = {
    catalogId,
    kind: 'player_form_static_loader',
    summary: loader.summary,
    confidence: 'high',
    consumer: loader.consumer,
    evidence: loader.evidence,
    generatedAt: now,
    tool: 'tools/world-player-form-audit.mjs',
  };
}

function annotateRoutine(region, routine) {
  region.analysis = region.analysis || {};
  region.analysis.playerFormAudit = {
    catalogId,
    kind: routine.role,
    summary: routine.summary,
    confidence: 'high',
    label: routine.label,
    calls: routine.calls,
    dataRefs: routine.dataRefs,
    readsRAM: routine.readsRAM,
    writesRAM: routine.writesRAM,
    evidence: routine.evidence,
    generatedAt: now,
    tool: 'tools/world-player-form-audit.mjs',
  };
}

function annotateRam(entry, ram) {
  entry.analysis = entry.analysis || {};
  entry.analysis.playerFormAudit = {
    catalogId,
    kind: ram.role,
    summary: ram.summary,
    confidence: ram.confidence,
    label: ram.label,
    evidence: ram.evidence,
    generatedAt: now,
    tool: 'tools/world-player-form-audit.mjs',
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const annotatedRegions = [];
  for (const [table, kind] of [[catalog.recordTable, 'player_form_record_pointer_table'], [catalog.loaderTable, 'player_form_loader_pointer_table']]) {
    if (table.region) {
      const region = mapData.regions.find(item => item.id === table.region.id);
      if (region) {
        annotateTableRegion(region, table, kind);
        annotatedRegions.push({ id: region.id, offset: region.offset, kind, typeBefore: region.type || 'unknown', typeAfter: region.type || 'unknown' });
      }
    }
    for (const entry of table.entries) {
      if (!entry.targetRegion) continue;
      const region = mapData.regions.find(item => item.id === entry.targetRegion.id);
      if (!region) continue;
      const typeBefore = region.type || 'unknown';
      annotateTargetRegion(region, table, entry);
      annotatedRegions.push({ id: region.id, offset: region.offset, kind: table.targetKind, typeBefore, typeAfter: region.type || 'unknown' });
      if (typeBefore !== region.type) changedRegions.push({ id: region.id, offset: region.offset, kind: table.targetKind, typeBefore, typeAfter: region.type || 'unknown' });
    }
  }
  for (const loader of catalog.staticLoaders) {
    if (!loader.region) continue;
    const region = mapData.regions.find(item => item.id === loader.region.id);
    if (!region) continue;
    annotateStaticLoader(region, loader);
    annotatedRegions.push({ id: region.id, offset: region.offset, kind: 'player_form_static_loader', typeBefore: region.type || 'unknown', typeAfter: region.type || 'unknown' });
  }
  for (const routine of catalog.routines) {
    if (!routine.region) continue;
    const region = mapData.regions.find(item => item.id === routine.region.id);
    if (!region) continue;
    annotateRoutine(region, routine);
    annotatedRegions.push({ id: region.id, offset: region.offset, kind: routine.role, typeBefore: region.type || 'unknown', typeAfter: region.type || 'unknown' });
  }
  const annotatedRam = [];
  for (const ram of catalog.ramVariables) {
    if (!ram.ram) continue;
    const entry = (mapData.ram || []).find(item => item.id === ram.ram.id);
    if (!entry) continue;
    annotateRam(entry, ram);
    annotatedRam.push({ id: entry.id, address: entry.address, kind: ram.role, confidence: ram.confidence });
  }
  return { changedRegions, annotatedRegions, annotatedRam };
}

function dryChanges(catalog) {
  const changes = [];
  for (const table of [catalog.recordTable, catalog.loaderTable]) {
    for (const entry of table.entries) {
      if (!entry.targetRegion) continue;
      if (entry.targetRegion.type === table.targetType) continue;
      changes.push({
        id: entry.targetRegion.id,
        offset: entry.targetRegion.offset,
        currentType: entry.targetRegion.type,
        inferredType: table.targetType,
        kind: table.targetKind,
      });
    }
  }
  return changes;
}

function main() {
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const romBytes = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, asmText, romBytes);
  const annotation = apply ? annotateMap(mapData, catalog) : { changedRegions: dryChanges(catalog), annotatedRegions: [], annotatedRam: [] };

  if (apply) {
    const finalCatalog = buildCatalog(mapData, asmText, romBytes);
    mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(entry => entry.id !== catalogId);
    mapData.playerCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_form_audit',
      generatedAt: now,
      tool: 'tools/world-player-form-audit.mjs --apply',
      schemaVersion: 1,
      summary: finalCatalog.summary,
      changedRegions: annotation.changedRegions,
      annotatedRegions: annotation.annotatedRegions,
      annotatedRam: annotation.annotatedRam,
      nextLeads: [
        'Trace _LABEL_998_ executions through _LABEL_12C9_ in the simulator scene pipeline so form-transition loaders can be replayed with VRAM provenance.',
        'Decode the 13-byte _DATA_BDB1_ record semantics by following _LABEL_2A49_, _LABEL_E83_, and the C3C0 entity update table at _DATA_668E_.',
        'Connect _DATA_BFB0_ form entity selector values to the broader C3CF entity handler and animation catalogs.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    annotatedRegions: annotation.annotatedRegions,
    annotatedRam: annotation.annotatedRam,
  }, null, 2));
}

main();
