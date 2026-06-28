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
const toolName = 'tools/world-cf6b-request-mirror-audit.mjs';
const catalogId = 'world-cf6b-request-mirror-catalog-2026-06-25';
const reportId = 'cf6b-request-mirror-audit-2026-06-25';

const sourceCatalogs = [
  'world-cf6a-explicit-write-coverage-catalog-2026-06-25',
  'world-cf6a-dispatch-producer-catalog-2026-06-25',
  'world-zone-trigger-record-catalog-2026-06-25',
  'world-zone-trigger-destination-role-catalog-2026-06-25',
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

function collectExplicitCf6bWrites(lines) {
  const writes = [];
  for (let i = 0; i < lines.length; i++) {
    const code = lineCode(lines, i + 1);
    if (/^ld\s+\(_RAM_CF6B_\),\s*a$/i.test(code)) {
      writes.push({ line: i + 1, code });
    }
  }
  return writes;
}

function buildLineChecks(lines) {
  return {
    mainLoopLabel: expectLine(lines, 1554, '_LABEL_4BD_:'),
    dispatchBeforeScan: expectLine(lines, 1560, 'call _LABEL_B3C0_'),
    scanAfterDispatch: expectLine(lines, 1561, 'call _LABEL_4746_'),
    label4746: expectLine(lines, 10885, '_LABEL_4746_:'),
    callTriggerScan: expectLine(lines, 10890, 'call _LABEL_47FE_'),
    label47fe: expectLine(lines, 10976, '_LABEL_47FE_:'),
    triggerTablePointer: expectLine(lines, 10986, 'ld hl, (_RAM_CF5E_)'),
    label4816: expectLine(lines, 10987, '_LABEL_4816_:'),
    terminatorRead: expectLine(lines, 10988, 'ld a, (hl)'),
    terminatorCompare: expectLine(lines, 10989, 'cp $FF'),
    terminatorBranch: expectLine(lines, 10990, 'jr nz, +++'),
    readMirror: expectLine(lines, 10991, 'ld a, (_RAM_CF6B_)'),
    saveMirrorInB: expectLine(lines, 10992, 'ld b, a'),
    readPending: expectLine(lines, 10993, 'ld a, (_RAM_CF6A_)'),
    comparePendingToMirror: expectLine(lines, 10994, 'cp b'),
    branchDifferent: expectLine(lines, 10995, 'jr nz, +'),
    clearSource: expectLine(lines, 10996, 'xor a'),
    clearPending: expectLine(lines, 10997, 'ld (_RAM_CF6A_), a'),
    writeMirror: expectLine(lines, 11001, 'ld (_RAM_CF6B_), a'),
    restoreBank: expectLine(lines, 11004, 'ld (_RAM_FFFF_), a'),
    callDispatcher: expectLine(lines, 11028, 'call _LABEL_48A9_'),
    loopAfterDispatch: expectLine(lines, 11029, 'jr _LABEL_4816_'),
    skipTailLoop: expectLine(lines, 11035, 'jr _LABEL_4816_'),
    b3c0Label: expectLine(lines, 20043, '_LABEL_B3C0_:'),
    b3c0ReadPending: expectLine(lines, 20044, 'ld a, (_RAM_CF6A_)'),
    b3c0ReturnOnZero: expectLine(lines, 20045, 'or a'),
    b3c0ClearPending: expectLine(lines, 20049, 'ld (_RAM_CF6A_), a'),
  };
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const explicitWrites = collectExplicitCf6bWrites(lines);
  if (explicitWrites.length !== 1 || explicitWrites[0].line !== 11001) {
    throw new Error(`Unexpected _RAM_CF6B_ explicit write coverage: ${explicitWrites.map(item => item.line).join(',')}`);
  }

  const cf6aCoverage = catalogById(mapData, 'world-cf6a-explicit-write-coverage-catalog-2026-06-25');
  const cf6aProducer = catalogById(mapData, 'world-cf6a-dispatch-producer-catalog-2026-06-25');
  const triggerCatalog = catalogById(mapData, 'world-zone-trigger-record-catalog-2026-06-25');
  const roleCatalog = catalogById(mapData, 'world-zone-trigger-destination-role-catalog-2026-06-25');

  const gateModel = {
    routine: '_LABEL_4816_',
    scope: 'trigger_table_terminator_gate',
    terminator: '0xFF',
    pendingRam: '_RAM_CF6A_',
    mirrorRam: '_RAM_CF6B_',
    cases: [
      {
        condition: '_RAM_CF6A_ == _RAM_CF6B_ at trigger table terminator',
        action: 'clear _RAM_CF6A_ to 0x00',
        effect: 'prevents a repeated pending bank-2 transition request from reaching the next _LABEL_B3C0_ pass',
        evidenceLines: [
          lineChecks.readMirror,
          lineChecks.saveMirrorInB,
          lineChecks.readPending,
          lineChecks.comparePendingToMirror,
          lineChecks.clearSource,
          lineChecks.clearPending,
        ],
      },
      {
        condition: '_RAM_CF6A_ != _RAM_CF6B_ at trigger table terminator',
        action: 'copy current _RAM_CF6A_ into _RAM_CF6B_ and leave _RAM_CF6A_ pending',
        effect: 'records the newly queued request so the next identical scan can suppress duplication',
        evidenceLines: [
          lineChecks.readMirror,
          lineChecks.readPending,
          lineChecks.comparePendingToMirror,
          lineChecks.branchDifferent,
          lineChecks.writeMirror,
        ],
      },
    ],
  };

  const loopOrdering = {
    mainLoop: '_LABEL_4BD_',
    dispatcher: '_LABEL_B3C0_',
    scannerCaller: '_LABEL_4746_',
    scanner: '_LABEL_47FE_/_LABEL_4816_',
    order: ['_LABEL_B3C0_', '_LABEL_4746_', '_LABEL_47FE_', '_LABEL_4816_'],
    conclusion: '_LABEL_4BD_ calls _LABEL_B3C0_ before _LABEL_4746_; trigger-scanner writes to _RAM_CF6A_ become pending for a later dispatcher pass unless the terminator gate clears them first.',
    evidenceLines: [
      lineChecks.mainLoopLabel,
      lineChecks.dispatchBeforeScan,
      lineChecks.scanAfterDispatch,
      lineChecks.label4746,
      lineChecks.callTriggerScan,
      lineChecks.b3c0ReadPending,
      lineChecks.b3c0ClearPending,
    ],
  };

  const evidence = [
    'ASM lines 1554-1561 show _LABEL_4BD_ calling _LABEL_B3C0_ before _LABEL_4746_, so trigger-scan writes to _RAM_CF6A_ are queued for a later dispatcher pass.',
    'ASM lines 10885-10890 show _LABEL_4746_ calling _LABEL_47FE_; ASM lines 10976-10987 load the trigger table pointer from _RAM_CF5E_ and enter _LABEL_4816_.',
    'ASM lines 10988-11001 show the $FF trigger-table terminator gate comparing _RAM_CF6A_ against _RAM_CF6B_.',
    'ASM lines 10996-10997 clear _RAM_CF6A_ when it equals the mirror; ASM line 11001 writes the current pending request to _RAM_CF6B_ when it differs.',
    'The current ASM contains exactly one explicit `_RAM_CF6B_` write: `ld (_RAM_CF6B_), a` at line 11001.',
    'This audit stores labels, line numbers, RAM names, counts, and evidence only; no ROM bytes, decoded trigger records, graphics, pixels, text, timing bytes, or audio data are embedded.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))])),
    assetPolicy: 'Metadata only: ASM labels, line numbers, RAM labels/addresses, scalar counts, region ids, and evidence. No ROM bytes, decoded rooms, trigger record bytes, graphics, palettes, music streams, audio samples, text, pixels, timing byte values, or hashes are embedded.',
    scope: {
      mirrorRam: '_RAM_CF6B_',
      mirrorAddress: '$CF6B',
      pendingRam: '_RAM_CF6A_',
      pendingAddress: '$CF6A',
      explicitMirrorWritesCovered: true,
      indirectWritesCovered: false,
    },
    explicitMirrorWrites: explicitWrites.map(item => ({
      ...item,
      routineLabel: '_LABEL_4816_',
      routineOffset: '0x04816',
      sourceRegion: compactRegion(containingRegion(mapData, 0x04816)),
      source: '_RAM_CF6A_ current pending request when different from _RAM_CF6B_',
      lineChecks: [lineChecks.readMirror, lineChecks.readPending, lineChecks.comparePendingToMirror, lineChecks.writeMirror],
    })),
    gateModel,
    loopOrdering,
    existingCatalogRefs: {
      cf6aExplicitWriteCoverage: cf6aCoverage ? {
        id: cf6aCoverage.id,
        summary: cf6aCoverage.summary || null,
      } : null,
      cf6aDispatchProducer: cf6aProducer ? {
        id: cf6aProducer.id,
        summary: cf6aProducer.summary || null,
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
      status: 'cf6b_duplicate_request_mirror_gate_cataloged',
      confidence: 'high_for_explicit_cf6b_write_and_gate_logic',
      explicitMirrorWriteCount: explicitWrites.length,
      gateCaseCount: gateModel.cases.length,
      dispatcherBeforeScanner: true,
      indirectWritesCovered: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Trace exact frame timing from _LABEL_4BD_ through _LABEL_B3C0_ and _LABEL_4746_ to model when a newly queued _RAM_CF6A_ request is consumed.',
      'Audit trigger records that can set _RAM_CF6A_=2 or 3 and determine whether _RAM_CF6B_ suppresses repeated form-stage/form-transition requests in practice.',
      'Only attempt indirect $CF6B alias analysis if pointer-flow evidence suggests writes through HL/IX/IY can target the CF6x state block.',
    ],
  };
}

function annotateRegion(region, value, annotatedRegions) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis.cf6bRequestMirrorAudit = value;
  annotatedRegions.push(compactRegion(region));
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  annotateRegion(containingRegion(mapData, 0x004BD), {
    catalogId,
    kind: 'cf6a_dispatch_before_trigger_scan_loop_order',
    confidence: 'high',
    summary: catalog.loopOrdering.conclusion,
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);
  annotateRegion(containingRegion(mapData, 0x04746), {
    catalogId,
    kind: 'trigger_scan_caller_after_cf6a_dispatch',
    confidence: 'high',
    summary: '_LABEL_4746_ calls _LABEL_47FE_ after _LABEL_4BD_ has already run the pending _RAM_CF6A_ dispatcher for this pass.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);
  annotateRegion(containingRegion(mapData, 0x04816), {
    catalogId,
    kind: 'cf6b_duplicate_request_gate',
    confidence: 'high',
    gateModel: catalog.gateModel,
    summary: '_LABEL_4816_ compares pending _RAM_CF6A_ with mirror _RAM_CF6B_ at the trigger-table terminator, clearing duplicates or recording a new pending request.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);
  annotateRegion(containingRegion(mapData, 0x0B3C0), {
    catalogId,
    kind: 'cf6a_pending_request_consumer_before_scan',
    confidence: 'high',
    summary: '_LABEL_B3C0_ consumes and clears _RAM_CF6A_ before the same loop pass reaches the trigger scanner.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  for (const [address, kind, summary] of [
    ['$CF6A', 'pending_request_with_cf6b_duplicate_gate', '_RAM_CF6A_ is compared with _RAM_CF6B_ at the trigger-table terminator; matching values are cleared before dispatch.'],
    ['$CF6B', 'duplicate_request_mirror_single_explicit_write', '_RAM_CF6B_ has one explicit writer, _LABEL_4816_, which mirrors a newly pending _RAM_CF6A_ request when it differs.'],
    ['$CF5E', 'trigger_table_pointer_for_cf6b_gate', '_RAM_CF5E_ supplies the trigger table scanned by _LABEL_47FE_/_LABEL_4816_, including the terminator that gates _RAM_CF6A_ through _RAM_CF6B_.'],
  ]) {
    const entry = findRam(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.cf6bRequestMirrorAudit = {
      catalogId,
      kind,
      confidence: 'high',
      summary,
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
      type: 'cf6b_request_mirror_audit',
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
      explicitMirrorWrites: catalog.explicitMirrorWrites,
      gateModel: catalog.gateModel,
      loopOrdering: catalog.loopOrdering,
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
    explicitMirrorWrites: catalog.explicitMirrorWrites.map(write => ({
      line: write.line,
      routineLabel: write.routineLabel,
      source: write.source,
    })),
    loopOrdering: catalog.loopOrdering.conclusion,
  }, null, 2));
}

main();
