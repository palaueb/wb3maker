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
const toolName = 'tools/world-status-vdp-writer-detail-audit.mjs';
const catalogId = 'world-status-vdp-writer-detail-catalog-2026-06-26';
const reportId = 'status-vdp-writer-detail-audit-2026-06-26';

const sourceCatalogs = [
  'world-cf52-status-scroll-adjust-catalog-2026-06-25',
  'world-vdp-render-routine-catalog-2026-06-25',
  'world-graphics-coverage-catalog-2026-06-24',
];

const directCallers = [
  { callerLabel: '_LABEL_23F1_', callerOffset: 0x023F1, callLine: 6084, callKind: 'call', role: 'status_hud_redraw_wrapper' },
  { callerLabel: '_LABEL_24DE_', callerOffset: 0x024DE, callLine: 6194, callKind: 'call', role: 'forward_status_scroll_adjust_refresh' },
  { callerLabel: '_LABEL_2506_', callerOffset: 0x02506, callLine: 6205, callKind: 'call', role: 'backward_status_scroll_adjust_refresh' },
  { callerLabel: '_LABEL_2BF8_', callerOffset: 0x02BF8, callLine: 7111, callKind: 'call', role: 'shop_menu_page_refresh' },
  { callerLabel: '_LABEL_311E_', callerOffset: 0x0311E, callLine: 7805, callKind: 'jp', role: 'equipment_menu_accept_refresh_tailcall' },
];

const tableUses = [
  {
    label: '_DATA_25D6_',
    offset: 0x025D6,
    size: 14,
    type: 'status_tile_source_selector',
    consumer: '_LABEL_25A4_',
    evidenceLines: [6310, 6311, 6313, 6316],
    summary: '_LABEL_25A4_ indexes this 14-byte selector table with the status segment value and skips tile upload when the selected byte is zero.',
  },
  {
    label: '_DATA_25E4_',
    offset: 0x025E4,
    size: 52,
    type: 'status_name_table_segment_records',
    recordCount: 13,
    recordSize: 4,
    consumer: '_LABEL_2518_',
    evidenceLines: [6249, 6250, 6251, 6253, 6254, 6258],
    summary: '_LABEL_2518_ indexes this 13-record table by residual segment value times four, then writes the selected four-byte status segment record.',
  },
  {
    label: '_DATA_2618_',
    offset: 0x02618,
    size: 4,
    type: 'status_full_segment_record',
    recordCount: 1,
    recordSize: 4,
    consumer: '_LABEL_2518_',
    evidenceLines: [6233, 6234, 6237, 6238, 6240, 6241],
    summary: '_LABEL_2518_ uses this four-byte segment record while the computed status span still contains full 13-unit chunks.',
  },
  {
    label: '_DATA_261C_',
    offset: 0x0261C,
    size: 4,
    type: 'status_empty_segment_record',
    recordCount: 1,
    recordSize: 4,
    consumer: '_LABEL_2518_',
    evidenceLines: [6263, 6266, 6268, 6269, 6270],
    summary: '_LABEL_2518_ uses this four-byte segment record to fill the remaining inactive status segments counted by _RAM_D0DE_.',
  },
  {
    label: '_DATA_20000_',
    offset: 0x20000,
    size: 16384,
    type: 'status_tile_graphics_source_bank',
    consumer: '_LABEL_25A4_',
    evidenceLines: [6314, 6315, 6321, 6322, 6331, 6334, 6336, 6338, 6340],
    summary: '_LABEL_25A4_ switches to bank 8, converts a selector byte to a tile-source offset, and uploads 0x40 bytes from _DATA_20000_ to VRAM.',
  },
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

function buildSourceCatalogPresence(mapData) {
  return Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))]));
}

function buildLineChecks(lines) {
  const checks = {
    writerLabel: expectLine(lines, 6208, '_LABEL_2518_:'),
    setBusySource: expectLine(lines, 6209, 'ld a, $01'),
    setBusy: expectLine(lines, 6210, 'ld (_RAM_CF82_), a'),
    readMax: expectLine(lines, 6211, 'ld a, (_RAM_CF54_)'),
    subtractLoopCompare: expectLine(lines, 6214, 'cp $0D'),
    subtractLoopSub: expectLine(lines, 6216, 'sub $0D'),
    activeSegmentCountSource: expectLine(lines, 6221, 'ld a, $08'),
    inactiveCountStore: expectLine(lines, 6223, 'ld (_RAM_D0DE_), a'),
    readScrollOffset: expectLine(lines, 6224, 'ld hl, (_RAM_CF52_)'),
    scrollBias: expectLine(lines, 6225, 'ld de, $000F'),
    firstControlC: expectLine(lines, 6232, 'ld c, $02'),
    fullSegmentTable: expectLine(lines, 6237, 'ld hl, _DATA_2618_'),
    residualUploadCall: expectLine(lines, 6247, 'call _LABEL_25A4_'),
    residualScale0: expectLine(lines, 6249, 'add a, a'),
    residualScale1: expectLine(lines, 6250, 'add a, a'),
    residualTable: expectLine(lines, 6253, 'ld hl, _DATA_25E4_'),
    residualBaseTable: expectLine(lines, 6258, 'ld hl, _DATA_25E4_'),
    inactiveCountRead: expectLine(lines, 6263, 'ld a, (_RAM_D0DE_)'),
    inactiveTable: expectLine(lines, 6268, 'ld hl, _DATA_261C_'),
    clearBusySource: expectLine(lines, 6272, 'xor a'),
    clearBusy: expectLine(lines, 6273, 'ld (_RAM_CF82_), a'),
    writeSegmentControlC: expectLine(lines, 6278, 'ld a, c'),
    writeSegmentControlHigh: expectLine(lines, 6280, 'ld a, $78'),
    secondRowDelta: expectLine(lines, 6285, 'ld a, $40'),
    secondRowControlAdd: expectLine(lines, 6286, 'add a, c'),
    segmentAdvance: expectLine(lines, 6293, 'add a, $04'),
    tileLowWrite: expectLine(lines, 6296, 'ld a, (hl)'),
    tileLowDataPort: expectLine(lines, 6298, 'rst $30'),
    tileHighConst0: expectLine(lines, 6299, 'ld a, $19'),
    tileHighDataPort0: expectLine(lines, 6300, 'rst $30'),
    tileSecondLowWrite: expectLine(lines, 6301, 'ld a, (hl)'),
    tileSecondLowDataPort: expectLine(lines, 6303, 'rst $30'),
    tileHighConst1: expectLine(lines, 6304, 'ld a, $19'),
    tileHighDataPort1: expectLine(lines, 6305, 'rst $30'),
    uploadLabel: expectLine(lines, 6308, '_LABEL_25A4_:'),
    selectorTable: expectLine(lines, 6310, 'ld hl, _DATA_25D6_'),
    selectorIndex: expectLine(lines, 6313, 'add hl, de'),
    switchBank8: expectLine(lines, 6314, 'ld a, $08'),
    pushBank: expectLine(lines, 6315, 'call _LABEL_1023_'),
    selectorRead: expectLine(lines, 6316, 'ld a, (hl)'),
    skipZeroSelector: expectLine(lines, 6318, 'jr z, +'),
    tileOffsetHelper: expectLine(lines, 6321, 'call _LABEL_B8F_'),
    graphicsSource: expectLine(lines, 6322, 'ld hl, _DATA_20000_'),
    uploadControlLow: expectLine(lines, 6326, 'ld a, $00'),
    uploadControlHigh: expectLine(lines, 6328, 'ld a, $62'),
    uploadByteCount: expectLine(lines, 6331, 'ld b, $40'),
    uploadReadByte: expectLine(lines, 6334, 'ld a, (de)'),
    uploadDataPort: expectLine(lines, 6336, 'rst $30'),
    uploadLoop: expectLine(lines, 6338, 'djnz -'),
    restoreBank: expectLine(lines, 6340, 'call _LABEL_1036_'),
    data25d6: expectLine(lines, 6345, '_DATA_25D6_:'),
    data25e4: expectLine(lines, 6349, '_DATA_25E4_:'),
    data2618: expectLine(lines, 6356, '_DATA_2618_:'),
    data261c: expectLine(lines, 6360, '_DATA_261C_:'),
  };
  for (const caller of directCallers) {
    checks[`caller${caller.callLine}`] = expectLine(lines, caller.callLine, `${caller.callKind} _LABEL_2518_`);
  }
  return checks;
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const callers = directCallers.map(caller => ({
    ...caller,
    callerOffset: hex(caller.callerOffset, 5),
    callerRegion: compactRegion(containingRegion(mapData, caller.callerOffset)),
    lineCheck: lineChecks[`caller${caller.callLine}`],
  }));
  const tables = tableUses.map(table => ({
    ...table,
    offset: hex(table.offset, 5),
    region: compactRegion(containingRegion(mapData, table.offset)),
    evidenceLines: table.evidenceLines.map(line => ({ line, code: lineCode(lines, line) })),
  }));

  const evidence = [
    'ASM lines 6208-6224 show _LABEL_2518_ setting _RAM_CF82_, reading _RAM_CF54_, computing an inactive segment count in _RAM_D0DE_, and reading _RAM_CF52_.',
    'ASM lines 6232-6270 show _LABEL_2518_ writing full, residual, and inactive status segment records from _DATA_2618_, _DATA_25E4_, and _DATA_261C_.',
    'ASM lines 6276-6306 show the shared segment writer using VDP control port writes, row delta 0x40, segment step 0x04, and tile attribute byte 0x19 for each tile word.',
    'ASM lines 6308-6340 show _LABEL_25A4_ indexing _DATA_25D6_, switching to bank 8, converting a selector through _LABEL_B8F_, and uploading 0x40 bytes from _DATA_20000_ to VRAM address 0x6200.',
    'ASM lines 6344-6361 identify _DATA_25D6_ as 14 bytes, _DATA_25E4_ as 52 bytes, and _DATA_2618_/_DATA_261C_ as four-byte segment records.',
    'ASM lines 6084, 6194, 6205, 7111, and 7805 are direct call/tail-call sites into _LABEL_2518_.',
    'This audit stores labels, offsets, line numbers, RAM names, scalar constants, counts, and evidence only; no ROM bytes, decoded graphics, pixels, text, timing bytes, or audio data are embedded.',
  ];

  return {
    id: catalogId,
    type: 'status_vdp_writer_detail',
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: buildSourceCatalogPresence(mapData),
    scope: {
      writerLabel: '_LABEL_2518_',
      writerOffset: '0x02518',
      tileUploadLabel: '_LABEL_25A4_',
      tileUploadOffset: '0x025A4',
      statusScrollOffsetRam: '_RAM_CF52_',
      statusMaxRam: '_RAM_CF54_',
      busyFlagRam: '_RAM_CF82_',
      inactiveCountRam: '_RAM_D0DE_',
      graphicsSource: '_DATA_20000_',
    },
    writerModel: {
      vdpControlHigh: '0x78',
      secondRowControlDelta: '0x40',
      firstSegmentControlLow: '0x02',
      segmentControlStep: '0x04',
      tileAttributeByte: '0x19',
      fullChunkUnit: '0x0D',
      activeSegmentBaseCount: 8,
      residualRecordSizeBytes: 4,
      uploadVramAddress: '0x6200',
      uploadByteCount: 64,
      uploadSourceBank: 8,
      confidence: 'high_for_control_constants_and_table_consumers',
    },
    directCallers: callers,
    tableUses: tables,
    summary: {
      status: 'status_vdp_writer_detail_cataloged',
      confidence: 'high_for_vdp_writer_control_flow_and_table_roles',
      directCallerCount: callers.length,
      tableUseCount: tables.length,
      statusRecordTableCount: 3,
      tileUploadSelectorTableCount: 1,
      graphicsSourceCount: 1,
      uploadByteCount: 64,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Name _RAM_CF52_/_RAM_CF54_ precisely after reconciling shop, reward, equipment, and transition caller contexts.',
      'Connect _DATA_25D6_ selector values to _DATA_20000_ source tile ranges without storing tile bytes.',
      'Model this status writer in the browser renderer as VDP name-table/tile-upload side effects fed by local ROM data.',
    ],
  };
}

function annotateRegion(region, value, annotatedRegions) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis.statusVdpWriterDetailAudit = value;
  annotatedRegions.push(compactRegion(region));
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  const evidence = catalog.evidence;

  annotateRegion(containingRegion(mapData, 0x02518), {
    catalogId,
    kind: 'status_name_table_segment_writer',
    confidence: 'high',
    summary: '_LABEL_2518_ writes status name-table segment records using _RAM_CF52_/_RAM_CF54_ state and the _DATA_25E4_/_DATA_2618_/_DATA_261C_ segment tables.',
    writerModel: catalog.writerModel,
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x025A4), {
    catalogId,
    kind: 'status_tile_pattern_upload_helper',
    confidence: 'high',
    summary: '_LABEL_25A4_ uses _DATA_25D6_ to select optional status tile pattern uploads from _DATA_20000_ into VRAM address 0x6200.',
    uploadVramAddress: catalog.writerModel.uploadVramAddress,
    uploadByteCount: catalog.writerModel.uploadByteCount,
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  for (const table of catalog.tableUses) {
    annotateRegion(containingRegion(mapData, parseHex(table.offset)), {
      catalogId,
      kind: table.type,
      confidence: 'high_for_consumer_lines',
      consumer: table.consumer,
      recordCount: table.recordCount ?? null,
      recordSize: table.recordSize ?? null,
      summary: table.summary,
      evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
  }

  for (const caller of catalog.directCallers) {
    annotateRegion(containingRegion(mapData, parseHex(caller.callerOffset)), {
      catalogId,
      kind: 'status_vdp_writer_direct_caller',
      confidence: 'high',
      callLine: caller.callLine,
      callKind: caller.callKind,
      role: caller.role,
      callee: '_LABEL_2518_',
      summary: `${caller.callerLabel} directly ${caller.callKind === 'jp' ? 'tail-calls' : 'calls'} _LABEL_2518_ for status/name-table refresh.`,
      evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
  }

  for (const [address, kind, summary, confidence] of [
    ['$CF52', 'status_writer_scroll_offset_input', '_LABEL_2518_ reads _RAM_CF52_ and converts it into the status segment selection position used for VDP name-table writes.', 'high'],
    ['$CF54', 'status_writer_segment_bound_input', '_LABEL_2518_ reads _RAM_CF54_ to derive full/residual/inactive segment counts for the status VDP writer.', 'high'],
    ['$CF82', 'status_writer_busy_flag', '_LABEL_2518_ sets _RAM_CF82_ before status VDP writes and clears it before returning.', 'high'],
    ['$D0DE', 'status_writer_inactive_segment_count', '_LABEL_2518_ stores the remaining inactive segment count in _RAM_D0DE_ before writing _DATA_261C_ filler records.', 'high'],
  ]) {
    const entry = findRam(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.statusVdpWriterDetailAudit = {
      catalogId,
      kind,
      confidence,
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
    mapData.vdpRenderRoutineCatalogs = (mapData.vdpRenderRoutineCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpRenderRoutineCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'status_vdp_writer_detail_audit',
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
      writerModel: catalog.writerModel,
      directCallers: catalog.directCallers,
      tableUses: catalog.tableUses,
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
    directCallers: catalog.directCallers.map(caller => ({
      callerLabel: caller.callerLabel,
      callLine: caller.callLine,
      callKind: caller.callKind,
      role: caller.role,
    })),
    tableUses: catalog.tableUses.map(table => ({
      label: table.label,
      type: table.type,
      size: table.size,
      consumer: table.consumer,
    })),
  }, null, 2));
}

main();
