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
const toolName = 'tools/world-cf52-cf54-write-coverage-audit.mjs';
const catalogId = 'world-cf52-cf54-write-coverage-catalog-2026-06-26';
const reportId = 'cf52-cf54-write-coverage-audit-2026-06-26';

const sourceCatalogs = [
  'world-status-vdp-writer-detail-catalog-2026-06-26',
  'world-cf52-status-scroll-adjust-catalog-2026-06-25',
  'world-password-routine-catalog-2026-06-25',
  'world-bank0-status-inventory-catalog-2026-06-25',
];

const expectedCf52Lines = [1479, 1513, 1603, 6174, 6192, 6204, 20083];
const expectedCf54Lines = [1481, 1507, 1605, 9420, 13941, 20081];

const classifiedWrites = {
  1479: { ram: '_RAM_CF52_', routineLabel: '_LABEL_3F8_', routineOffset: 0x003F8, kind: 'game_entry_status_offset_init', valueSource: 'literal_hl_0x0680_at_line_1478', valueHex: '0x0680', confidence: 'high_literal' },
  1481: { ram: '_RAM_CF54_', routineLabel: '_LABEL_3F8_', routineOffset: 0x003F8, kind: 'game_entry_status_max_init', valueSource: 'literal_a_0x68_at_line_1480', valueHex: '0x68', confidence: 'high_literal' },
  1507: { ram: '_RAM_CF54_', routineLabel: '_LABEL_3F8_', routineOffset: 0x003F8, kind: 'game_entry_status_max_lookup', valueSource: '_DATA_479_ indexed by _RAM_CF54_ & 0x07', valueHex: null, confidence: 'high_table_flow' },
  1513: { ram: '_RAM_CF52_', routineLabel: '_LABEL_3F8_', routineOffset: 0x003F8, kind: 'game_entry_status_offset_branch_or_lookup', valueSource: 'DE from literal 0x00D0 branch or _DATA_481_ RST $08/$10 pointer decode', valueHex: null, confidence: 'high_control_flow_dynamic_value' },
  1603: { ram: '_RAM_CF52_', routineLabel: '_LABEL_508_', routineOffset: 0x00508, kind: 'demo_post_title_status_offset_init', valueSource: 'literal_hl_0x00D0_at_line_1602', valueHex: '0x00D0', confidence: 'high_literal' },
  1605: { ram: '_RAM_CF54_', routineLabel: '_LABEL_508_', routineOffset: 0x00508, kind: 'demo_post_title_status_max_init', valueSource: 'literal_a_0x0D_at_line_1604', valueHex: '0x0D', confidence: 'high_literal' },
  6174: { ram: '_RAM_CF52_', routineLabel: '_LABEL_24DE_', routineOffset: 0x024DE, kind: 'forward_status_scroll_add_result', valueSource: '_RAM_CF52_ plus DE argument', valueHex: null, confidence: 'high_arithmetic' },
  6192: { ram: '_RAM_CF52_', routineLabel: '_LABEL_24DE_', routineOffset: 0x024DE, kind: 'forward_status_scroll_bound_restore', valueSource: 'restored prior value when derived _RAM_CF54_ bound would be crossed', valueHex: null, confidence: 'high_arithmetic' },
  6204: { ram: '_RAM_CF52_', routineLabel: '_LABEL_2506_', routineOffset: 0x02506, kind: 'backward_status_scroll_subtract_clamp', valueSource: '_RAM_CF52_ minus DE argument clamped to zero', valueHex: null, confidence: 'high_arithmetic' },
  9420: { ram: '_RAM_CF54_', routineLabel: '_LABEL_3C45_', routineOffset: 0x03C45, kind: 'password_restore_status_max', valueSource: '_LABEL_3D15_ three-bit password reader result', valueHex: null, confidence: 'high_reader_flow' },
  13941: { ram: '_RAM_CF54_', routineLabel: '_LABEL_5EFA_', routineOffset: 0x05EFA, kind: 'reward_status_max_increment_clamped', valueSource: 'min(_RAM_CF54_ + 0x0D, 0x68)', valueHex: null, confidence: 'high_arithmetic' },
  20081: { ram: '_RAM_CF54_', routineLabel: '_LABEL_B3D3_', routineOffset: 0x0B3D3, kind: 'new_game_transition_status_max_init', valueSource: 'literal_a_0x0D_at_line_20080', valueHex: '0x0D', confidence: 'high_literal' },
  20083: { ram: '_RAM_CF52_', routineLabel: '_LABEL_B3D3_', routineOffset: 0x0B3D3, kind: 'new_game_transition_status_offset_init', valueSource: 'literal_hl_0x00D0_at_line_20082', valueHex: '0x00D0', confidence: 'high_literal' },
};

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

function collectWrites(lines, ramLabel) {
  const regex = new RegExp(`^ld\\s+\\(${ramLabel}\\),\\s*(?:a|hl|de)$`, 'i');
  const writes = [];
  for (let i = 0; i < lines.length; i++) {
    const code = lineCode(lines, i + 1);
    if (regex.test(code)) writes.push({ line: i + 1, code });
  }
  return writes;
}

function assertLineSet(kind, found, expected) {
  const a = found.slice().sort((x, y) => x - y);
  const b = expected.slice().sort((x, y) => x - y);
  if (a.length !== b.length || a.some((line, index) => line !== b[index])) {
    throw new Error(`Unexpected ${kind} coverage: found ${a.join(',')}; expected ${b.join(',')}`);
  }
}

function buildLineChecks(lines) {
  return {
    gameEntryOffsetSource: expectLine(lines, 1478, 'ld hl, $0680'),
    gameEntryOffsetWrite: expectLine(lines, 1479, 'ld (_RAM_CF52_), hl'),
    gameEntryMaxSource: expectLine(lines, 1480, 'ld a, $68'),
    gameEntryMaxWrite: expectLine(lines, 1481, 'ld (_RAM_CF54_), a'),
    lookupReadCf54: expectLine(lines, 1499, 'ld a, (_RAM_CF54_)'),
    lookupMask: expectLine(lines, 1500, 'and $07'),
    lookupTable479: expectLine(lines, 1502, 'ld hl, _DATA_479_'),
    lookupRead: expectLine(lines, 1506, 'ld a, (hl)'),
    lookupWriteCf54: expectLine(lines, 1507, 'ld (_RAM_CF54_), a'),
    offsetTable481: expectLine(lines, 1509, 'ld hl, _DATA_481_'),
    offsetWriteDynamic: expectLine(lines, 1513, 'ld (_RAM_CF52_), de'),
    demoOffsetSource: expectLine(lines, 1602, 'ld hl, $00D0'),
    demoOffsetWrite: expectLine(lines, 1603, 'ld (_RAM_CF52_), hl'),
    demoMaxSource: expectLine(lines, 1604, 'ld a, $0D'),
    demoMaxWrite: expectLine(lines, 1605, 'ld (_RAM_CF54_), a'),
    forwardAddWrite: expectLine(lines, 6174, 'ld (_RAM_CF52_), hl'),
    forwardClampWrite: expectLine(lines, 6192, 'ld (_RAM_CF52_), hl'),
    backwardClampZero: expectLine(lines, 6202, 'ld hl, $0000'),
    backwardWrite: expectLine(lines, 6204, 'ld (_RAM_CF52_), hl'),
    passwordBits: expectLine(lines, 9418, 'ld c, $03'),
    passwordRead: expectLine(lines, 9419, 'call _LABEL_3D15_'),
    passwordWrite: expectLine(lines, 9420, 'ld (_RAM_CF54_), a'),
    rewardAdd: expectLine(lines, 13936, 'add a, $0D'),
    rewardClampCompare: expectLine(lines, 13937, 'cp $68'),
    rewardClampSource: expectLine(lines, 13939, 'ld a, $68'),
    rewardWrite: expectLine(lines, 13941, 'ld (_RAM_CF54_), a'),
    transitionMaxSource: expectLine(lines, 20080, 'ld a, $0D'),
    transitionMaxWrite: expectLine(lines, 20081, 'ld (_RAM_CF54_), a'),
    transitionOffsetSource: expectLine(lines, 20082, 'ld hl, $00D0'),
    transitionOffsetWrite: expectLine(lines, 20083, 'ld (_RAM_CF52_), hl'),
  };
}

function buildSourceCatalogPresence(mapData) {
  return Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))]));
}

function groupByRegion(events) {
  const grouped = new Map();
  for (const event of events) {
    const key = event.region?.id || `${event.routineLabel}:${event.line}`;
    if (!grouped.has(key)) grouped.set(key, { region: event.region, events: [] });
    grouped.get(key).events.push({
      line: event.line,
      code: event.code,
      ram: event.ram,
      kind: event.kind,
      valueSource: event.valueSource,
      valueHex: event.valueHex,
      confidence: event.confidence,
    });
  }
  return [...grouped.values()].sort((a, b) => String(a.region?.offset || '').localeCompare(String(b.region?.offset || '')));
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const cf52Writes = collectWrites(lines, '_RAM_CF52_');
  const cf54Writes = collectWrites(lines, '_RAM_CF54_');
  assertLineSet('_RAM_CF52_ explicit writes', cf52Writes.map(write => write.line), expectedCf52Lines);
  assertLineSet('_RAM_CF54_ explicit writes', cf54Writes.map(write => write.line), expectedCf54Lines);

  const writes = [...cf52Writes, ...cf54Writes]
    .sort((a, b) => a.line - b.line)
    .map(write => {
      const classified = classifiedWrites[write.line];
      if (!classified) throw new Error(`Missing classification for line ${write.line}`);
      return {
        ...write,
        ...classified,
        routineOffset: hex(classified.routineOffset, 5),
        region: compactRegion(containingRegion(mapData, classified.routineOffset)),
      };
    });

  const evidence = [
    'The current ASM contains seven explicit _RAM_CF52_ writes and six explicit _RAM_CF54_ writes using direct symbolic labels.',
    'ASM lines 1478-1481 initialize _RAM_CF52_=0x0680 and _RAM_CF54_=0x68 in _LABEL_3F8_.',
    'ASM lines 1499-1513 update _RAM_CF54_ through _DATA_479_ and _RAM_CF52_ through either a 0x00D0 branch or _DATA_481_ pointer decode in _LABEL_3F8_.',
    'ASM lines 1602-1605 initialize _RAM_CF52_=0x00D0 and _RAM_CF54_=0x0D in _LABEL_508_.',
    'ASM lines 6171-6205 update _RAM_CF52_ through the forward/backward status scroll clamp helpers _LABEL_24DE_ and _LABEL_2506_.',
    'ASM lines 9418-9420 restore _RAM_CF54_ from a three-bit password reader value in _LABEL_3C45_.',
    'ASM lines 13935-13943 increment _RAM_CF54_ by 0x0D with a 0x68 cap and immediately call _LABEL_24DE_.',
    'ASM lines 20080-20083 initialize _RAM_CF54_=0x0D and _RAM_CF52_=0x00D0 in _LABEL_B3D3_.',
    'This audit stores labels, offsets, line numbers, RAM names, scalar constants, counts, and evidence only; no ROM bytes, decoded graphics, pixels, text, timing bytes, or audio data are embedded.',
  ];

  return {
    id: catalogId,
    type: 'cf52_cf54_explicit_write_coverage',
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: buildSourceCatalogPresence(mapData),
    scope: {
      statusScrollOffsetRam: '_RAM_CF52_',
      statusMaxRam: '_RAM_CF54_',
      coveredWritePatterns: ['ld (_RAM_CF52_), hl', 'ld (_RAM_CF52_), de', 'ld (_RAM_CF54_), a'],
      indirectWritesCovered: false,
    },
    writes,
    groupedRegionEvents: groupByRegion(writes),
    tableRefs: [
      {
        label: '_DATA_479_',
        offset: '0x00479',
        region: compactRegion(containingRegion(mapData, 0x00479)),
        role: 'cf54_rebucket_lookup',
        evidenceLines: [lineChecks.lookupReadCf54, lineChecks.lookupMask, lineChecks.lookupTable479, lineChecks.lookupRead, lineChecks.lookupWriteCf54],
      },
      {
        label: '_DATA_481_',
        offset: '0x00481',
        region: compactRegion(containingRegion(mapData, 0x00481)),
        role: 'cf52_dynamic_offset_decode_source',
        evidenceLines: [lineChecks.offsetTable481, lineChecks.offsetWriteDynamic],
      },
    ],
    summary: {
      status: 'cf52_cf54_explicit_writes_cataloged',
      confidence: 'high_for_symbolic_direct_writes',
      cf52WriteCount: cf52Writes.length,
      cf54WriteCount: cf54Writes.length,
      totalWriteCount: writes.length,
      literalWriteCount: writes.filter(write => write.valueHex).length,
      dynamicWriteCount: writes.filter(write => !write.valueHex).length,
      groupedRegionCount: groupByRegion(writes).length,
      indirectWritesCovered: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Resolve _DATA_479_/_DATA_481_ semantics so _LABEL_3F8_ dynamic _RAM_CF52_/_RAM_CF54_ writes can be converted into named state cases without copying table bytes.',
      'Trace _RAM_CF54_ password restore range against normal gameplay reward increments to decide whether the RAM name should remain heart-count-like or become a generic status meter maximum.',
      'Feed this write coverage into the browser status renderer model alongside world-status-vdp-writer-detail-catalog-2026-06-26.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  const evidence = catalog.evidence;

  for (const group of catalog.groupedRegionEvents) {
    const region = group.region?.id ? (mapData.regions || []).find(item => item.id === group.region.id) : null;
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.cf52Cf54WriteCoverageAudit = {
      catalogId,
      kind: 'cf52_cf54_explicit_write_region',
      confidence: 'high_for_symbolic_direct_writes',
      eventCount: group.events.length,
      events: group.events,
      summary: 'Region contains confirmed direct writes to _RAM_CF52_ and/or _RAM_CF54_ used by the status VDP writer.',
      evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push(compactRegion(region));
  }

  for (const table of catalog.tableRefs) {
    const region = containingRegion(mapData, parseHex(table.offset));
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.cf52Cf54WriteCoverageAudit = {
      catalogId,
      kind: table.role,
      confidence: 'high_for_reference_flow',
      summary: `${table.label} participates in _LABEL_3F8_ dynamic _RAM_CF52_/_RAM_CF54_ setup.`,
      evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push(compactRegion(region));
  }

  for (const [address, kind, summary] of [
    ['$CF52', 'status_scroll_offset_explicit_write_coverage', 'Seven direct symbolic _RAM_CF52_ writes are cataloged, covering entry/demo/init, forward/backward scroll adjustment, and new-game transition bootstrap paths.'],
    ['$CF54', 'status_max_explicit_write_coverage', 'Six direct symbolic _RAM_CF54_ writes are cataloged, covering entry/demo/init, password restore, reward increment, and new-game transition bootstrap paths.'],
  ]) {
    const entry = findRam(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.cf52Cf54WriteCoverageAudit = {
      catalogId,
      kind,
      confidence: 'high_for_symbolic_direct_writes',
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
      type: 'cf52_cf54_write_coverage_audit',
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
      writes: catalog.writes,
      groupedRegionEvents: catalog.groupedRegionEvents,
      tableRefs: catalog.tableRefs,
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
    writes: catalog.writes.map(write => ({
      line: write.line,
      ram: write.ram,
      routineLabel: write.routineLabel,
      kind: write.kind,
      valueHex: write.valueHex,
      confidence: write.confidence,
    })),
  }, null, 2));
}

main();
