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
const now = '2026-06-25T00:00:00Z';
const toolName = 'tools/world-cf52-status-scroll-adjust-audit.mjs';
const catalogId = 'world-cf52-status-scroll-adjust-catalog-2026-06-25';
const reportId = 'cf52-status-scroll-adjust-audit-2026-06-25';

const sourceCatalogs = [
  'world-d1af-scene-completion-catalog-2026-06-25',
  'world-bank0-status-inventory-catalog-2026-06-25',
  'world-aux-entity-routine-catalog-2026-06-25',
];

const callsites = [
  { callerLabel: '_LABEL_38AD_', callerOffset: 0x038AD, callLine: 8909, deLine: 8908, deHex: '0x0010', role: 'shop_currency_status_scroll_step' },
  { callerLabel: '_LABEL_38AD_', callerOffset: 0x038AD, callLine: 8951, deLine: 8950, deHex: '0x0010', role: 'shop_currency_status_scroll_followup_step' },
  { callerLabel: '_LABEL_4BD7_', callerOffset: 0x04BD7, callLine: 11517, deLine: 11516, deHex: '0x00D0', role: 'd1af_transition_completion_status_scroll_step' },
  { callerLabel: '_LABEL_5EFA_', callerOffset: 0x05EFA, callLine: 13943, deLine: 13942, deHex: '0x00D0', role: 'reward_meter_increment_status_scroll_step' },
  { callerLabel: '_LABEL_5F22_', callerOffset: 0x05F22, callLine: 13971, deLine: 13970, deHex: '0x00D0', role: 'reward_ground_value_status_scroll_step' },
  { callerLabel: '_LABEL_5F52_', callerOffset: 0x05F52, callLine: 13998, deLine: 13997, deHex: '0x0068', role: 'reward_bouncing_value_status_scroll_step' },
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
    routineLabel: expectLine(lines, 6171, '_LABEL_24DE_:'),
    readOffset: expectLine(lines, 6172, 'ld hl, (_RAM_CF52_)'),
    addDelta: expectLine(lines, 6173, 'add hl, de'),
    writeOffset: expectLine(lines, 6174, 'ld (_RAM_CF52_), hl'),
    readBoundSource: expectLine(lines, 6176, 'ld a, (_RAM_CF54_)'),
    shiftBound0: expectLine(lines, 6179, 'sla l'),
    shiftBound1: expectLine(lines, 6181, 'sla l'),
    shiftBound2: expectLine(lines, 6183, 'sla l'),
    shiftBound3: expectLine(lines, 6185, 'sla l'),
    compareBound: expectLine(lines, 6189, 'sbc hl, de'),
    clampRestore: expectLine(lines, 6192, 'ld (_RAM_CF52_), hl'),
    refreshCall: expectLine(lines, 6194, 'call _LABEL_2518_'),
    writerLabel: expectLine(lines, 6208, '_LABEL_2518_:'),
    setTileFlag: expectLine(lines, 6209, 'ld a, $01'),
    writeTileFlag: expectLine(lines, 6210, 'ld (_RAM_CF82_), a'),
    writerReadBound: expectLine(lines, 6211, 'ld a, (_RAM_CF54_)'),
    writerCountStore: expectLine(lines, 6223, 'ld (_RAM_D0DE_), a'),
    clearTileFlag: expectLine(lines, 6273, 'ld (_RAM_CF82_), a'),
  };
  for (const site of callsites) {
    checks[`de${site.callLine}`] = expectLine(lines, site.deLine, `ld de, $${site.deHex.slice(2)}`);
    checks[`call${site.callLine}`] = expectLine(lines, site.callLine, 'call _LABEL_24DE_');
  }
  return checks;
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const resolvedCallsites = callsites.map(site => ({
    ...site,
    callerOffset: hex(site.callerOffset, 5),
    callerRegion: compactRegion(containingRegion(mapData, site.callerOffset)),
    lineChecks: [lineChecks[`de${site.callLine}`], lineChecks[`call${site.callLine}`]],
  }));

  const evidence = [
    'ASM lines 6171-6174 show _LABEL_24DE_ adding DE to _RAM_CF52_ and writing the updated offset.',
    'ASM lines 6176-6189 derive a 16x bound from _RAM_CF54_ and compare it against the updated _RAM_CF52_ value.',
    'ASM lines 6190-6192 restore the previous _RAM_CF52_ value when the add would cross the derived bound.',
    'ASM lines 6194 and 6208-6274 show _LABEL_24DE_ refreshing status/name-table tiles via _LABEL_2518_, including _RAM_CF82_ set/clear and _RAM_D0DE_ count setup.',
    'ASM callsites at lines 8909, 8951, 11517, 13943, 13971, and 13998 load DE immediately before calling _LABEL_24DE_.',
    'The _LABEL_4BD7_ callsite at lines 11510-11517 is gated by _RAM_CF8B_ and _RAM_D1AF_=0xFF as cataloged by world-d1af-scene-completion-catalog-2026-06-25.',
    'This audit stores labels, offsets, line numbers, RAM names, scalar constants, counts, and evidence only; no ROM bytes, decoded graphics, pixels, text, timing bytes, or audio data are embedded.',
  ];

  return {
    id: catalogId,
    type: 'cf52_status_scroll_adjust_routine',
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: buildSourceCatalogPresence(mapData),
    scope: {
      routineLabel: '_LABEL_24DE_',
      routineOffset: '0x024DE',
      refreshRoutine: '_LABEL_2518_',
      offsetRam: '_RAM_CF52_',
      boundSourceRam: '_RAM_CF54_',
      vdpBusyFlagRam: '_RAM_CF82_',
      writerCountRam: '_RAM_D0DE_',
      deltaRegister: 'DE',
    },
    routineModel: {
      operation: '_RAM_CF52_ = min(_RAM_CF52_ + DE, derived_bound_from__RAM_CF54_) with restore-on-overflow style clamp',
      boundDerivation: '_RAM_CF54_ is shifted left four times before subtracting the updated _RAM_CF52_/DE value.',
      refreshPath: '_LABEL_2518_ writes status/name-table tile data after every accepted or clamped adjustment.',
      exactVisualMeaning: 'status_or_meter_scroll_adjustment; current audit does not rename existing RAM labels',
      confidence: 'high_for_arithmetic_and_callsite_constants',
    },
    callsites: resolvedCallsites,
    lineChecks,
    summary: {
      status: 'cf52_status_scroll_adjust_cataloged',
      confidence: 'high_for_routine_arithmetic_and_direct_callsites',
      callsiteCount: resolvedCallsites.length,
      uniqueDeltaCount: new Set(resolvedCallsites.map(site => site.deHex)).size,
      d1afCompletionCallsiteCount: resolvedCallsites.filter(site => site.callerLabel === '_LABEL_4BD7_').length,
      refreshRoutineModeled: true,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Resolve the exact UI/meter semantics of _RAM_CF52_ and _RAM_CF54_ across shop, reward, and transition callsites without renaming RAM until all contexts agree.',
      'Trace _LABEL_2518_ VDP output destinations and tile records to connect this scroll adjustment to status bar rendering provenance.',
      'Use the _LABEL_4BD7_ callsite with the D1AF lifecycle to model the post-transition status/meter adjustment frame in the JavaScript engine.',
    ],
  };
}

function annotateRegion(region, value, annotatedRegions) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis.cf52StatusScrollAdjustAudit = value;
  annotatedRegions.push(compactRegion(region));
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  const evidence = catalog.evidence;

  annotateRegion(containingRegion(mapData, 0x024DE), {
    catalogId,
    kind: 'cf52_forward_status_scroll_adjust_clamp',
    confidence: 'high',
    summary: '_LABEL_24DE_ adds DE to _RAM_CF52_, clamps against a bound derived from _RAM_CF54_, then calls _LABEL_2518_ to refresh status/name-table tiles.',
    callsiteCount: catalog.callsites.length,
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x02518), {
    catalogId,
    kind: 'cf52_status_tile_refresh_writer',
    confidence: 'high',
    summary: '_LABEL_2518_ sets _RAM_CF82_, derives status tile counts from _RAM_CF54_/_RAM_CF52_, writes VDP data, then clears _RAM_CF82_.',
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  for (const site of catalog.callsites) {
    annotateRegion(containingRegion(mapData, parseHex(site.callerOffset)), {
      catalogId,
      kind: 'cf52_status_scroll_adjust_callsite',
      confidence: 'high',
      role: site.role,
      callLine: site.callLine,
      deHex: site.deHex,
      callee: '_LABEL_24DE_',
      summary: `${site.callerLabel} calls _LABEL_24DE_ with DE=${site.deHex}.`,
      evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
  }

  for (const [address, kind, summary, confidence] of [
    ['$CF52', 'status_scroll_offset_adjusted_by_24de', '_LABEL_24DE_ adds DE to _RAM_CF52_ and restores the old value when the derived _RAM_CF54_ bound would be crossed.', 'high'],
    ['$CF54', 'status_scroll_bound_source_for_24de', '_LABEL_24DE_ derives its upper bound from _RAM_CF54_ shifted left four times; _LABEL_2518_ also uses _RAM_CF54_ for tile-count setup.', 'high'],
    ['$CF82', 'status_tile_refresh_busy_flag', '_LABEL_2518_ sets _RAM_CF82_ before VDP status/name-table writes and clears it before returning.', 'high'],
    ['$D0DE', 'status_tile_refresh_count', '_LABEL_2518_ stores a derived count in _RAM_D0DE_ while preparing status/name-table tile writes.', 'medium_high'],
    ['$CF8B', 'd1af_completion_callsite_gate', '_LABEL_4BD7_ gates its _LABEL_24DE_ call on _RAM_CF8B_ and _RAM_D1AF_=0xFF.', 'high_for_gate'],
    ['$D1AF', 'd1af_completion_status_scroll_link', '_RAM_D1AF_=0xFF enables the _LABEL_4BD7_ callsite that invokes _LABEL_24DE_ with DE=0x00D0.', 'high_for_callsite_link'],
  ]) {
    const entry = findRam(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.cf52StatusScrollAdjustAudit = {
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
    mapData.bank0StatusInventoryCatalogs = (mapData.bank0StatusInventoryCatalogs || []).filter(item => item.id !== catalogId);
    mapData.bank0StatusInventoryCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'cf52_status_scroll_adjust_audit',
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
      routineModel: catalog.routineModel,
      callsites: catalog.callsites,
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
    callsites: catalog.callsites.map(site => ({
      callerLabel: site.callerLabel,
      callLine: site.callLine,
      deHex: site.deHex,
      role: site.role,
    })),
  }, null, 2));
}

main();
