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
const toolName = 'tools/world-cf6a-explicit-write-coverage-audit.mjs';
const catalogId = 'world-cf6a-explicit-write-coverage-catalog-2026-06-25';
const reportId = 'cf6a-explicit-write-coverage-audit-2026-06-25';

const sourceCatalogs = [
  'world-cf6a-dispatch-producer-catalog-2026-06-25',
  'world-cf6a-request3-form-transition-catalog-2026-06-25',
  'world-room-loader-audio-selector-resolution-catalog-2026-06-25',
  'world-zone-trigger-record-catalog-2026-06-25',
  'world-zone-trigger-destination-role-catalog-2026-06-25',
];

const expectedWrites = [
  {
    line: 1452,
    routineLabel: '_LABEL_3E1_',
    routineOffset: 0x003E1,
    valueHex: '0x00',
    valueSource: 'xor_a_at_line_1449',
    kind: 'entry_loop_state_clear',
    effect: 'clear_pending_bank2_transition_request',
    dispatchRequest: null,
    evidenceLines: [1448, 1449, 1452, 1456],
  },
  {
    line: 10997,
    routineLabel: '_LABEL_4816_',
    routineOffset: 0x04816,
    valueHex: '0x00',
    valueSource: 'xor_a_at_line_10996',
    kind: 'trigger_scan_duplicate_request_clear',
    effect: 'clear_repeated_pending_request_when_cf6a_equals_cf6b',
    dispatchRequest: null,
    evidenceLines: [10991, 10993, 10994, 10996, 10997, 11001],
  },
  {
    line: 11166,
    routineLabel: '_LABEL_497A_',
    routineOffset: 0x0497A,
    valueHex: '0x01',
    valueSource: 'literal_0x01_at_line_11165',
    kind: 'bank2_request_1_producer',
    effect: 'queue_b3d3_new_game_bootstrap_dispatch',
    dispatchRequest: 1,
    dispatchTarget: '_LABEL_B3D3_',
    evidenceLines: [11097, 11164, 11165, 11166, 20055],
  },
  {
    line: 11201,
    routineLabel: '_LABEL_49A9_',
    routineOffset: 0x049A9,
    valueHex: '0x03',
    valueSource: 'literal_0x03_at_line_11200',
    kind: 'bank2_request_3_producer',
    effect: 'queue_b6b0_form_transition_setup_dispatch',
    dispatchRequest: 3,
    dispatchTarget: '_LABEL_B6B0_',
    evidenceLines: [11098, 11199, 11200, 11201, 20055],
  },
  {
    line: 11792,
    routineLabel: '_LABEL_4E49_',
    routineOffset: 0x04E49,
    valueHex: '0x02',
    valueSource: 'literal_0x02_at_line_11791',
    kind: 'bank2_request_2_form_stage_producer',
    effect: 'queue_b44f_form_stage_room_sequence_dispatch',
    dispatchRequest: 2,
    dispatchTarget: '_LABEL_B44F_',
    evidenceLines: [11786, 11789, 11791, 11792, 20055],
  },
  {
    line: 20049,
    routineLabel: '_LABEL_B3C0_',
    routineOffset: 0x0B3C0,
    valueHex: '0x00',
    valueSource: 'xor_a_at_line_20048',
    kind: 'bank2_dispatcher_consume_clear',
    effect: 'clear_pending_request_after_latching_it_in_b',
    dispatchRequest: null,
    evidenceLines: [20043, 20044, 20045, 20047, 20048, 20049, 20050, 20055],
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 2) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = /^(?:0x|\$)?([0-9A-F]+)$/i.exec(String(value));
  return match ? parseInt(match[1], 16) : null;
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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function collectExplicitCf6aWrites(lines) {
  const writes = [];
  for (let i = 0; i < lines.length; i++) {
    const code = lineCode(lines, i + 1);
    if (/^ld\s+\(_RAM_CF6A_\),\s*a$/i.test(code)) {
      writes.push({ line: i + 1, code });
    }
  }
  return writes;
}

function buildLineChecks(lines) {
  return {
    label3e1: expectLine(lines, 1448, '_LABEL_3E1_:'),
    clear3e1Source: expectLine(lines, 1449, 'xor a'),
    clear3e1Write: expectLine(lines, 1452, 'ld (_RAM_CF6A_), a'),
    label4816: expectLine(lines, 10987, '_LABEL_4816_:'),
    readCf6b: expectLine(lines, 10991, 'ld a, (_RAM_CF6B_)'),
    readCf6a4816: expectLine(lines, 10993, 'ld a, (_RAM_CF6A_)'),
    compareCf6b: expectLine(lines, 10994, 'cp b'),
    clear4816Source: expectLine(lines, 10996, 'xor a'),
    clear4816Write: expectLine(lines, 10997, 'ld (_RAM_CF6A_), a'),
    updateCf6b: expectLine(lines, 11001, 'ld (_RAM_CF6B_), a'),
    triggerTableRow1: expectLine(lines, 11097, '.dw _LABEL_497A_ _LABEL_4980_ _LABEL_4980_ _LABEL_4988_ _LABEL_4988_ _LABEL_492B_ _LABEL_492B_ _LABEL_492B_'),
    triggerTableRow2: expectLine(lines, 11098, '.dw _LABEL_4995_ _LABEL_49A9_ _LABEL_49AF_ _LABEL_49D4_ _LABEL_49DD_ _LABEL_49E6_ _LABEL_4903_ _LABEL_4903_'),
    label497a: expectLine(lines, 11164, '_LABEL_497A_:'),
    loadCf6aOne: expectLine(lines, 11165, 'ld a, $01'),
    writeCf6aOne: expectLine(lines, 11166, 'ld (_RAM_CF6A_), a'),
    label49a9: expectLine(lines, 11199, '_LABEL_49A9_:'),
    loadCf6aThree: expectLine(lines, 11200, 'ld a, $03'),
    writeCf6aThree: expectLine(lines, 11201, 'ld (_RAM_CF6A_), a'),
    label4e49: expectLine(lines, 11771, '_LABEL_4E49_:'),
    writeD1ae: expectLine(lines, 11786, 'ld (_RAM_D1AE_), a'),
    loadD1af: expectLine(lines, 11789, 'ld a, $01'),
    loadCf6aTwo: expectLine(lines, 11791, 'ld a, $02'),
    writeCf6aTwo: expectLine(lines, 11792, 'ld (_RAM_CF6A_), a'),
    labelB3c0: expectLine(lines, 20043, '_LABEL_B3C0_:'),
    readB3c0: expectLine(lines, 20044, 'ld a, (_RAM_CF6A_)'),
    retZeroB3c0: expectLine(lines, 20045, 'or a'),
    latchRequestB3c0: expectLine(lines, 20047, 'ld b, a'),
    clearB3c0Source: expectLine(lines, 20048, 'xor a'),
    clearB3c0Write: expectLine(lines, 20049, 'ld (_RAM_CF6A_), a'),
    restoreRequestB3c0: expectLine(lines, 20050, 'ld a, b'),
    bank2Table: expectLine(lines, 20055, '.dw _LABEL_B3D3_ _LABEL_B44F_ _LABEL_B6B0_'),
    labelB3d3: expectLine(lines, 20058, '_LABEL_B3D3_:'),
    b3d3RoomLoad: expectLine(lines, 20100, 'call _LABEL_2620_'),
  };
}

function lineChecksForWrite(write, lineChecks) {
  const byLine = new Map(Object.values(lineChecks).map(item => [item.line, item]));
  return write.evidenceLines.map(line => byLine.get(line)).filter(Boolean);
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const actualWrites = collectExplicitCf6aWrites(lines);
  const expectedLineSet = new Set(expectedWrites.map(item => item.line));
  const actualLineSet = new Set(actualWrites.map(item => item.line));
  const unexpectedWrites = actualWrites.filter(item => !expectedLineSet.has(item.line));
  const missingWrites = expectedWrites.filter(item => !actualLineSet.has(item.line));
  if (unexpectedWrites.length || missingWrites.length || actualWrites.length !== expectedWrites.length) {
    throw new Error(`Unexpected _RAM_CF6A_ explicit write coverage: actual=${actualWrites.map(w => w.line).join(',')} expected=${expectedWrites.map(w => w.line).join(',')}`);
  }

  const cf6aProducerCatalog = catalogById(mapData, 'world-cf6a-dispatch-producer-catalog-2026-06-25');
  const request3Catalog = catalogById(mapData, 'world-cf6a-request3-form-transition-catalog-2026-06-25');
  const selectorResolutionCatalog = catalogById(mapData, 'world-room-loader-audio-selector-resolution-catalog-2026-06-25');
  const triggerCatalog = catalogById(mapData, 'world-zone-trigger-record-catalog-2026-06-25');
  const roleCatalog = catalogById(mapData, 'world-zone-trigger-destination-role-catalog-2026-06-25');

  const writes = expectedWrites.map(write => ({
    ...write,
    offset: hex(write.routineOffset, 5),
    sourceRegion: compactRegion(containingRegion(mapData, write.routineOffset)),
    writeCode: lineCode(lines, write.line),
    lineChecks: lineChecksForWrite(write, lineChecks),
  }));

  const requestOneWrites = writes.filter(write => write.dispatchRequest === 1);
  const evidence = [
    'This audit enumerates every explicit ASM instruction matching `ld (_RAM_CF6A_), a` and fails if any extra explicit write appears outside the cataloged set.',
    'ASM lines 1448-1456 clear _RAM_CF6A_ during the entry-loop state reset.',
    'ASM lines 10987-11001 clear _RAM_CF6A_ only when the trigger scanner sees the pending request repeated in _RAM_CF6B_; otherwise it mirrors the current request into _RAM_CF6B_.',
    'ASM lines 11164-11166 set _RAM_CF6A_=1 through _LABEL_497A_; no other explicit write sets value 1 in the current disassembly.',
    'ASM lines 11791-11792 set _RAM_CF6A_=2 through _LABEL_4E49_, and ASM lines 11199-11201 set _RAM_CF6A_=3 through _LABEL_49A9_.',
    'ASM lines 20043-20055 show _LABEL_B3C0_ reading _RAM_CF6A_, returning on zero, clearing it after latching in B, then dispatching through _DATA_B3CD_.',
    'This is explicit-label-write coverage only; indirect writes through aliases or self-modifying code are not claimed without separate evidence.',
    'The audit stores labels, line numbers, counts, RAM names, region ids, and evidence only; no ROM bytes, decoded assets, pixels, text, timing bytes, or audio data are embedded.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))])),
    assetPolicy: 'Metadata only: ASM labels, line numbers, RAM labels/addresses, scalar request ids, region ids, counts, and evidence. No ROM bytes, decoded rooms, graphics, palettes, music streams, audio samples, text, pixels, timing byte values, or hashes are embedded.',
    scope: {
      ramLabel: '_RAM_CF6A_',
      ramAddress: '$CF6A',
      coverageKind: 'explicit_label_write_instructions_only',
      writeInstructionPattern: 'ld (_RAM_CF6A_), a',
      indirectWritesCovered: false,
    },
    explicitWrites: writes,
    valueCounts: countBy(writes, write => write.valueHex),
    kindCounts: countBy(writes, write => write.kind),
    requestDispatchTargets: writes
      .filter(write => write.dispatchRequest != null)
      .map(write => ({
        requestId: write.dispatchRequest,
        requestIdHex: hex(write.dispatchRequest, 2),
        producerLabel: write.routineLabel,
        writeLine: write.line,
        dispatchTarget: write.dispatchTarget,
      })),
    b3d3ReachabilityBound: {
      targetLabel: '_LABEL_B3D3_',
      dispatchRequest: 1,
      explicitProducerWriteCount: requestOneWrites.length,
      explicitProducerLabels: requestOneWrites.map(write => write.routineLabel),
      noOtherExplicitValue1Writers: requestOneWrites.length === 1,
      catalogedRoomTriggerProducerCount: cf6aProducerCatalog?.summary?.cf6aRequest1CatalogedTriggerRecordCount ?? null,
      triggerOpcode8PresentInCatalog: cf6aProducerCatalog?.summary?.triggerOpcode8PresentInCatalog ?? null,
      conclusion: 'Within explicit _RAM_CF6A_ writes, _LABEL_B3D3_ can only be requested by _LABEL_497A_; the cataloged room trigger records currently contain no _LABEL_497A_ producer records.',
      limitation: 'This does not rule out non-room state-machine entry or indirect writes not expressed as `ld (_RAM_CF6A_), a`.',
    },
    existingCatalogRefs: {
      cf6aDispatchProducer: cf6aProducerCatalog ? {
        id: cf6aProducerCatalog.id,
        summary: cf6aProducerCatalog.summary || null,
      } : null,
      request3FormTransition: request3Catalog ? {
        id: request3Catalog.id,
        summary: request3Catalog.summary || null,
      } : null,
      audioSelectorResolution: selectorResolutionCatalog ? {
        id: selectorResolutionCatalog.id,
        summary: selectorResolutionCatalog.summary || null,
      } : null,
      triggerRecordCatalog: triggerCatalog ? {
        id: triggerCatalog.id,
        summary: triggerCatalog.summary || null,
      } : null,
      triggerRoleCatalog: roleCatalog ? {
        id: roleCatalog.id,
        summary: roleCatalog.summary || null,
      } : null,
    },
    summary: {
      status: 'cf6a_explicit_write_coverage_cataloged',
      confidence: 'high_for_explicit_label_writes_medium_for_global_runtime',
      explicitWriteCount: writes.length,
      clearWriteCount: writes.filter(write => write.valueHex === '0x00').length,
      nonzeroRequestWriteCount: writes.filter(write => write.dispatchRequest != null).length,
      request1ExplicitProducerCount: requestOneWrites.length,
      request1CatalogedRoomTriggerProducerCount: cf6aProducerCatalog?.summary?.cf6aRequest1CatalogedTriggerRecordCount ?? null,
      request1NoOtherExplicitProducer: requestOneWrites.length === 1,
      indirectWritesCovered: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Trace non-room callers or startup state that could invoke _LABEL_497A_ or otherwise set _RAM_CF6A_=1 before _LABEL_B3C0_.',
      'Audit _RAM_CF6B_ as the pending-request de-duplication mirror used by _LABEL_4816_.',
      'Search for indirect writes to address $CF6A through HL/IX/IY only if pointer analysis shows a credible alias.',
    ],
  };
}

function annotateRegion(region, value, annotatedRegions) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis.cf6aExplicitWriteCoverageAudit = value;
  annotatedRegions.push(compactRegion(region));
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  const writesByLabel = new Map();
  for (const write of catalog.explicitWrites) {
    const list = writesByLabel.get(write.routineLabel) || [];
    list.push({
      line: write.line,
      valueHex: write.valueHex,
      kind: write.kind,
      effect: write.effect,
      dispatchRequest: write.dispatchRequest,
      dispatchTarget: write.dispatchTarget || null,
    });
    writesByLabel.set(write.routineLabel, list);
  }

  for (const [label, summary] of [
    ['_LABEL_3E1_', 'Entry-loop reset clears _RAM_CF6A_.'],
    ['_LABEL_4816_', 'Trigger scanner clears repeated _RAM_CF6A_ requests when they match _RAM_CF6B_.'],
    ['_LABEL_497A_', '_LABEL_497A_ is the only explicit value-1 writer to _RAM_CF6A_ in the current disassembly.'],
    ['_LABEL_49A9_', '_LABEL_49A9_ explicitly queues _RAM_CF6A_=3 for the form-transition setup dispatch.'],
    ['_LABEL_4E49_', '_LABEL_4E49_ explicitly queues _RAM_CF6A_=2 for the form-stage room-sequence dispatch.'],
    ['_LABEL_B3C0_', '_LABEL_B3C0_ consumes and clears _RAM_CF6A_ before dispatching _DATA_B3CD_.'],
  ]) {
    const writes = writesByLabel.get(label) || [];
    if (!writes.length) continue;
    const offset = catalog.explicitWrites.find(write => write.routineLabel === label)?.routineOffset;
    annotateRegion(containingRegion(mapData, offset), {
      catalogId,
      kind: 'cf6a_explicit_write_site',
      confidence: 'high_for_explicit_write',
      writes,
      summary,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
  }

  annotateRegion(containingRegion(mapData, 0x0B3D3), {
    catalogId,
    kind: 'b3d3_explicit_cf6a_request_bound',
    confidence: 'medium',
    explicitProducerLabels: catalog.b3d3ReachabilityBound.explicitProducerLabels,
    catalogedRoomTriggerProducerCount: catalog.b3d3ReachabilityBound.catalogedRoomTriggerProducerCount,
    summary: catalog.b3d3ReachabilityBound.conclusion,
    limitation: catalog.b3d3ReachabilityBound.limitation,
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  for (const [address, kind, summary] of [
    ['$CF6A', 'explicit_bank2_request_write_coverage', '_RAM_CF6A_ has six explicit label writes in the current ASM: three clears and three nonzero request producers.'],
    ['$CF6B', 'cf6a_duplicate_request_mirror', '_RAM_CF6B_ is compared with _RAM_CF6A_ by _LABEL_4816_; matching values cause _RAM_CF6A_ to be cleared.'],
  ]) {
    const entry = findRam(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.cf6aExplicitWriteCoverageAudit = {
      catalogId,
      kind,
      confidence: 'high_for_explicit_label_writes',
      summary,
      explicitWriteCount: catalog.summary.explicitWriteCount,
      valueCounts: catalog.valueCounts,
      evidence: catalog.evidence,
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
    mapData.transitionRoutineCatalogs = (mapData.transitionRoutineCatalogs || []).filter(item => item.id !== catalogId);
    mapData.transitionRoutineCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'cf6a_explicit_write_coverage_audit',
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
      valueCounts: catalog.valueCounts,
      kindCounts: catalog.kindCounts,
      requestDispatchTargets: catalog.requestDispatchTargets,
      b3d3ReachabilityBound: catalog.b3d3ReachabilityBound,
      existingCatalogRefs: catalog.existingCatalogRefs,
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
    valueCounts: catalog.valueCounts,
    requestDispatchTargets: catalog.requestDispatchTargets,
    b3d3ReachabilityBound: catalog.b3d3ReachabilityBound,
  }, null, 2));
}

main();
