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
const toolName = 'tools/world-cf5b-form-stage-progression-audit.mjs';
const catalogId = 'world-cf5b-form-stage-progression-catalog-2026-06-25';
const reportId = 'cf5b-form-stage-progression-audit-2026-06-25';

const sourceCatalogs = [
  'world-cf6a-dispatch-producer-catalog-2026-06-25',
  'world-cf6a-request3-form-transition-catalog-2026-06-25',
  'world-inline-transition-recipe-catalog-2026-06-25',
  'world-bank2-transition-routine-catalog-2026-06-25',
  'world-zone-trigger-destination-role-catalog-2026-06-25',
  'world-player-form-catalog-2026-06-24',
];

const expectedWrites = [
  {
    line: 9467,
    routineLabel: '_LABEL_3C45_',
    routineOffset: 0x03C45,
    valueHex: null,
    valueSource: 'password_multibit_reader_result',
    kind: 'password_restore_form_stage',
    evidenceLines: [9462, 9463, 9465, 9466, 9467],
  },
  {
    line: 11618,
    routineLabel: '_LABEL_4CE9_',
    routineOffset: 0x04CE9,
    valueHex: '0x00',
    valueSource: 'xor_a_at_line_11617',
    kind: 'transition_clear_form_stage',
    evidenceLines: [11616, 11617, 11618, 11620],
  },
  {
    line: 20208,
    routineLabel: '_LABEL_B539_',
    routineOffset: 0x0B539,
    valueHex: '0x01',
    valueSource: 'literal_0x01_at_line_20207',
    kind: 'bank2_branch_stage_progression',
    d1aeIndex: 1,
    targetD10eHex: '0x02',
    evidenceLines: [20187, 20205, 20207, 20208, 20209, 20210, 20211],
  },
  {
    line: 20222,
    routineLabel: '_LABEL_B551_',
    routineOffset: 0x0B551,
    valueHex: '0x02',
    valueSource: 'literal_0x02_at_line_20221',
    kind: 'bank2_branch_stage_progression',
    d1aeIndex: 2,
    targetD10eHex: '0x03',
    evidenceLines: [20187, 20219, 20221, 20222, 20223, 20224, 20225],
  },
  {
    line: 20236,
    routineLabel: '_LABEL_B569_',
    routineOffset: 0x0B569,
    valueHex: '0x03',
    valueSource: 'literal_0x03_at_line_20235',
    kind: 'bank2_branch_stage_progression',
    d1aeIndex: 3,
    targetD10eHex: '0x04',
    evidenceLines: [20187, 20233, 20235, 20236, 20237, 20238, 20239],
  },
  {
    line: 20250,
    routineLabel: '_LABEL_B581_',
    routineOffset: 0x0B581,
    valueHex: '0x04',
    valueSource: 'literal_0x04_at_line_20249',
    kind: 'bank2_branch_stage_progression',
    d1aeIndex: 4,
    targetD10eHex: '0x05',
    evidenceLines: [20187, 20247, 20249, 20250, 20251, 20252, 20253],
  },
  {
    line: 20263,
    routineLabel: '_LABEL_B599_',
    routineOffset: 0x0B599,
    valueHex: '0x05',
    valueSource: 'literal_0x05_at_line_20262',
    kind: 'bank2_branch_finale_stage',
    d1aeIndex: 5,
    targetD10eHex: '0x00',
    evidenceLines: [20187, 20261, 20262, 20263, 20264, 20265, 20266, 20312, 20313],
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

function collectExplicitCf5bWrites(lines) {
  const writes = [];
  for (let i = 0; i < lines.length; i++) {
    const code = lineCode(lines, i + 1);
    if (/^ld\s+\(_RAM_CF5B_\),\s*a$/i.test(code)) {
      writes.push({ line: i + 1, code });
    }
  }
  return writes;
}

function buildLineChecks(lines) {
  return {
    passwordReadC24fBits: expectLine(lines, 9462, 'ld c, $03'),
    passwordReadC24f: expectLine(lines, 9463, 'call _LABEL_3D15_'),
    passwordWriteC24f: expectLine(lines, 9464, 'ld (_RAM_C24F_), a'),
    passwordReadCf5bBits: expectLine(lines, 9465, 'ld c, $03'),
    passwordReadCf5b: expectLine(lines, 9466, 'call _LABEL_3D15_'),
    passwordWriteCf5b: expectLine(lines, 9467, 'ld (_RAM_CF5B_), a'),
    transitionClearLabel: expectLine(lines, 11616, '_LABEL_4CE9_:'),
    transitionClearSource: expectLine(lines, 11617, 'xor a'),
    transitionClearWrite: expectLine(lines, 11618, 'ld (_RAM_CF5B_), a'),
    transitionClearFallthrough: expectLine(lines, 11620, '_LABEL_4CED_:'),
    e49Label: expectLine(lines, 11771, '_LABEL_4E49_:'),
    e49ReadSelector: expectLine(lines, 11775, 'ld a, (hl)'),
    e49AdvanceC26c: expectLine(lines, 11777, 'ld (_RAM_C26C_), hl'),
    e49ZeroSelectorBranch: expectLine(lines, 11778, 'or a'),
    e49SaveSelectorC: expectLine(lines, 11780, 'ld c, a'),
    e49ReadCf5b: expectLine(lines, 11781, 'ld a, (_RAM_CF5B_)'),
    e49CompareSelector: expectLine(lines, 11782, 'cp c'),
    e49SkipWhenCovered: expectLine(lines, 11783, 'jr nc, ++'),
    e49QueueD1ae: expectLine(lines, 11786, 'ld (_RAM_D1AE_), a'),
    e49SetD1af: expectLine(lines, 11790, 'ld (_RAM_D1AF_), a'),
    e49SetCf6a2: expectLine(lines, 11792, 'ld (_RAM_CF6A_), a'),
    e49SkipFirstDescriptor: expectLine(lines, 11796, 'ld de, $0006'),
    e49LoadSecondDescriptor: expectLine(lines, 11801, 'call _LABEL_2620_'),
    branchDispatcherLabel: expectLine(lines, 20183, '_LABEL_B511_:'),
    branchReadD1ae: expectLine(lines, 20184, 'ld a, (_RAM_D1AE_)'),
    branchTableLabel: expectLine(lines, 20187, '_DATA_B515_:'),
    branchTableEntries: expectLine(lines, 20188, '.dw _LABEL_B521_ _LABEL_B539_ _LABEL_B551_ _LABEL_B569_ _LABEL_B581_ _LABEL_B599_'),
    branch0Label: expectLine(lines, 20191, '_LABEL_B521_:'),
    branch0D10e: expectLine(lines, 20194, 'ld (_RAM_D10E_), a'),
    branch1Label: expectLine(lines, 20205, '_LABEL_B539_:'),
    branch1Cf5bLoad: expectLine(lines, 20207, 'ld a, $01'),
    branch1Cf5bWrite: expectLine(lines, 20208, 'ld (_RAM_CF5B_), a'),
    branch1D10eLoad: expectLine(lines, 20209, 'ld a, $02'),
    branch1D10eWrite: expectLine(lines, 20210, 'ld (_RAM_D10E_), a'),
    branch1B6ca: expectLine(lines, 20211, 'call _LABEL_B6CA_'),
    branch2Label: expectLine(lines, 20219, '_LABEL_B551_:'),
    branch2Cf5bLoad: expectLine(lines, 20221, 'ld a, $02'),
    branch2Cf5bWrite: expectLine(lines, 20222, 'ld (_RAM_CF5B_), a'),
    branch2D10eLoad: expectLine(lines, 20223, 'ld a, $03'),
    branch2D10eWrite: expectLine(lines, 20224, 'ld (_RAM_D10E_), a'),
    branch2B6ca: expectLine(lines, 20225, 'call _LABEL_B6CA_'),
    branch3Label: expectLine(lines, 20233, '_LABEL_B569_:'),
    branch3Cf5bLoad: expectLine(lines, 20235, 'ld a, $03'),
    branch3Cf5bWrite: expectLine(lines, 20236, 'ld (_RAM_CF5B_), a'),
    branch3D10eLoad: expectLine(lines, 20237, 'ld a, $04'),
    branch3D10eWrite: expectLine(lines, 20238, 'ld (_RAM_D10E_), a'),
    branch3B6ca: expectLine(lines, 20239, 'call _LABEL_B6CA_'),
    branch4Label: expectLine(lines, 20247, '_LABEL_B581_:'),
    branch4Cf5bLoad: expectLine(lines, 20249, 'ld a, $04'),
    branch4Cf5bWrite: expectLine(lines, 20250, 'ld (_RAM_CF5B_), a'),
    branch4D10eLoad: expectLine(lines, 20251, 'ld a, $05'),
    branch4D10eWrite: expectLine(lines, 20252, 'ld (_RAM_D10E_), a'),
    branch4B6ca: expectLine(lines, 20253, 'call _LABEL_B6CA_'),
    branch5Label: expectLine(lines, 20261, '_LABEL_B599_:'),
    branch5Cf5bLoad: expectLine(lines, 20262, 'ld a, $05'),
    branch5Cf5bWrite: expectLine(lines, 20263, 'ld (_RAM_CF5B_), a'),
    branch5D10eLoad: expectLine(lines, 20264, 'ld a, $00'),
    branch5D10eWrite: expectLine(lines, 20265, 'ld (_RAM_D10E_), a'),
    branch5FinaleCall: expectLine(lines, 20266, 'call _LABEL_B9BA_'),
    branch5ReadCf5b: expectLine(lines, 20312, 'ld a, (_RAM_CF5B_)'),
    branch5FinaleThreshold: expectLine(lines, 20313, 'cp $05'),
    b6b0Label: expectLine(lines, 20388, '_LABEL_B6B0_:'),
    b6b0ReadC24f: expectLine(lines, 20389, 'ld a, (_RAM_C24F_)'),
    b6b0ReadCf5b: expectLine(lines, 20394, 'ld a, (_RAM_CF5B_)'),
    b6b0WriteD10e: expectLine(lines, 20402, 'ld (_RAM_D10E_), a'),
  };
}

function lineChecksForWrite(write, lineChecks) {
  const byLine = new Map(Object.values(lineChecks).map(item => [item.line, item]));
  return write.evidenceLines.map(line => byLine.get(line)).filter(Boolean);
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const actualWrites = collectExplicitCf5bWrites(lines);
  const expectedLineSet = new Set(expectedWrites.map(item => item.line));
  const actualLineSet = new Set(actualWrites.map(item => item.line));
  const unexpectedWrites = actualWrites.filter(item => !expectedLineSet.has(item.line));
  const missingWrites = expectedWrites.filter(item => !actualLineSet.has(item.line));
  if (unexpectedWrites.length || missingWrites.length || actualWrites.length !== expectedWrites.length) {
    throw new Error(`Unexpected _RAM_CF5B_ explicit write coverage: actual=${actualWrites.map(w => w.line).join(',')} expected=${expectedWrites.map(w => w.line).join(',')}`);
  }

  const writes = expectedWrites.map(write => ({
    ...write,
    offset: hex(write.routineOffset, 5),
    sourceRegion: compactRegion(containingRegion(mapData, write.routineOffset)),
    writeCode: lineCode(lines, write.line),
    lineChecks: lineChecksForWrite(write, lineChecks),
  }));

  const branchProgression = [
    {
      d1aeIndex: 0,
      branchLabel: '_LABEL_B521_',
      cf5bWriteHex: null,
      d10eWriteHex: '0x01',
      role: 'initial_form_transition_branch_without_cf5b_progress_write',
      lineChecks: [lineChecks.branch0Label, lineChecks.branch0D10e],
    },
    ...writes
      .filter(write => write.kind === 'bank2_branch_stage_progression' || write.kind === 'bank2_branch_finale_stage')
      .map(write => ({
        d1aeIndex: write.d1aeIndex,
        branchLabel: write.routineLabel,
        cf5bWriteHex: write.valueHex,
        d10eWriteHex: write.targetD10eHex,
        role: write.kind,
        lineChecks: write.lineChecks,
      })),
  ];

  const formStageGate = {
    routine: '_LABEL_4E49_',
    selectorSource: '_RAM_C26C_ inline transition selector byte',
    stageRam: '_RAM_CF5B_',
    queuedCase: {
      condition: 'selector == 0x00 OR _RAM_CF5B_ < selector',
      writes: ['_RAM_D1AE_', '_RAM_D1AF_', '_RAM_CF6A_=0x02'],
      effect: 'queues bank-2 staged transition with _RAM_D1AE_ set from the selector and leaves _RAM_C26C_ at the first inline descriptor',
    },
    skippedCase: {
      condition: 'selector != 0x00 AND _RAM_CF5B_ >= selector',
      writes: ['_RAM_C26C_ += 6'],
      effect: 'skips the first inline descriptor and loads the follow-up descriptor immediately through _LABEL_2620_',
    },
    lineChecks: [
      lineChecks.e49Label,
      lineChecks.e49ReadSelector,
      lineChecks.e49ReadCf5b,
      lineChecks.e49CompareSelector,
      lineChecks.e49SkipWhenCovered,
      lineChecks.e49QueueD1ae,
      lineChecks.e49SetD1af,
      lineChecks.e49SetCf6a2,
      lineChecks.e49SkipFirstDescriptor,
      lineChecks.e49LoadSecondDescriptor,
    ],
  };

  const cf6aProducerCatalog = catalogById(mapData, 'world-cf6a-dispatch-producer-catalog-2026-06-25');
  const request3Catalog = catalogById(mapData, 'world-cf6a-request3-form-transition-catalog-2026-06-25');
  const inlineCatalog = catalogById(mapData, 'world-inline-transition-recipe-catalog-2026-06-25');
  const bank2Catalog = catalogById(mapData, 'world-bank2-transition-routine-catalog-2026-06-25');
  const roleCatalog = catalogById(mapData, 'world-zone-trigger-destination-role-catalog-2026-06-25');
  const playerFormCatalog = catalogById(mapData, 'world-player-form-catalog-2026-06-24');

  const evidence = [
    'This audit enumerates every explicit ASM instruction matching `ld (_RAM_CF5B_), a` and fails if any extra explicit write appears outside the cataloged set.',
    'ASM lines 9462-9467 restore _RAM_CF5B_ from the password bit stream after restoring _RAM_C24F_.',
    'ASM lines 11616-11620 clear _RAM_CF5B_ through _LABEL_4CE9_ before falling into the normal room-load transition handler.',
    'ASM lines 11771-11801 show _LABEL_4E49_ comparing inline transition selector bytes against _RAM_CF5B_ to decide whether to queue _RAM_CF6A_=2 or skip to the follow-up room descriptor.',
    'ASM lines 20183-20188 dispatch _RAM_D1AE_ through the six-entry _DATA_B515_ branch table.',
    'ASM lines 20205-20266 write _RAM_CF5B_ values 1 through 5 in staged bank-2 transition branches and pair them with _RAM_D10E_ target form writes.',
    'ASM lines 20388-20403 show _LABEL_B6B0_ reading _RAM_CF5B_ while selecting _RAM_D10E_ for request-3 form-transition setup.',
    'This audit stores labels, line numbers, RAM names, stage values, branch indices, region ids, counts, and evidence only; no ROM bytes, decoded assets, timing bytes, pixels, text, or audio data are embedded.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))])),
    assetPolicy: 'Metadata only: ASM labels, line numbers, RAM labels/addresses, scalar stage values, branch indices, region ids, counts, and evidence. No ROM bytes, decoded rooms, graphics, palettes, music streams, audio samples, text, pixels, timing byte values, or hashes are embedded.',
    scope: {
      ramLabel: '_RAM_CF5B_',
      ramAddress: '$CF5B',
      coverageKind: 'explicit_label_write_instructions_only',
      writeInstructionPattern: 'ld (_RAM_CF5B_), a',
      indirectWritesCovered: false,
    },
    explicitWrites: writes,
    valueCounts: countBy(writes, write => write.valueHex || 'dynamic_password_restore'),
    kindCounts: countBy(writes, write => write.kind),
    formStageGate,
    branchProgression,
    existingCatalogRefs: {
      cf6aDispatchProducer: cf6aProducerCatalog ? {
        id: cf6aProducerCatalog.id,
        summary: cf6aProducerCatalog.summary || null,
      } : null,
      request3FormTransition: request3Catalog ? {
        id: request3Catalog.id,
        summary: request3Catalog.summary || null,
      } : null,
      inlineTransitionRecipe: inlineCatalog ? {
        id: inlineCatalog.id,
        summary: inlineCatalog.summary || null,
      } : null,
      bank2TransitionRoutine: bank2Catalog ? {
        id: bank2Catalog.id,
        summary: bank2Catalog.summary || null,
      } : null,
      triggerRoleCatalog: roleCatalog ? {
        id: roleCatalog.id,
        summary: roleCatalog.summary || null,
      } : null,
      playerForm: playerFormCatalog ? {
        id: playerFormCatalog.id,
        summary: playerFormCatalog.summary || null,
      } : null,
    },
    summary: {
      status: 'cf5b_form_stage_progression_cataloged',
      confidence: 'high_for_explicit_label_writes_and_stage_gate',
      explicitWriteCount: writes.length,
      passwordRestoreWriteCount: writes.filter(write => write.kind === 'password_restore_form_stage').length,
      transitionClearWriteCount: writes.filter(write => write.kind === 'transition_clear_form_stage').length,
      stagedBranchWriteCount: writes.filter(write => write.kind === 'bank2_branch_stage_progression').length,
      finaleStageWriteCount: writes.filter(write => write.kind === 'bank2_branch_finale_stage').length,
      branchProgressionEntryCount: branchProgression.length,
      indirectWritesCovered: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Connect each _RAM_D1AE_ branch index to the visual/state-machine controller in bank 2 for exact staged transition playback.',
      'Trace password encode/decode bounds for _RAM_CF5B_ to determine valid persisted form-stage values.',
      'Model _LABEL_4E49_ frame timing with _RAM_C26C_ advancement so inline transition recipes can emulate already-completed stages.',
    ],
  };
}

function annotateRegion(region, value, annotatedRegions) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis.cf5bFormStageProgressionAudit = value;
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
      valueSource: write.valueSource,
      kind: write.kind,
      d1aeIndex: write.d1aeIndex ?? null,
      targetD10eHex: write.targetD10eHex || null,
    });
    writesByLabel.set(write.routineLabel, list);
  }

  for (const [label, summary] of [
    ['_LABEL_3C45_', 'Password decode restores _RAM_CF5B_ from a three-bit field after restoring _RAM_C24F_.'],
    ['_LABEL_4CE9_', '_LABEL_4CE9_ clears _RAM_CF5B_ before normal room-load transition handling.'],
    ['_LABEL_B539_', '_LABEL_B539_ records form-stage progress 1 and targets form index 2.'],
    ['_LABEL_B551_', '_LABEL_B551_ records form-stage progress 2 and targets form index 3.'],
    ['_LABEL_B569_', '_LABEL_B569_ records form-stage progress 3 and targets form index 4.'],
    ['_LABEL_B581_', '_LABEL_B581_ records form-stage progress 4 and targets form index 5.'],
    ['_LABEL_B599_', '_LABEL_B599_ records final form-stage progress 5 and enters finale handling.'],
  ]) {
    const writes = writesByLabel.get(label) || [];
    if (!writes.length) continue;
    const offset = catalog.explicitWrites.find(write => write.routineLabel === label)?.routineOffset;
    annotateRegion(containingRegion(mapData, offset), {
      catalogId,
      kind: 'cf5b_explicit_write_site',
      confidence: 'high_for_explicit_write',
      writes,
      summary,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
  }

  annotateRegion(containingRegion(mapData, 0x04E49), {
    catalogId,
    kind: 'cf5b_inline_transition_stage_gate',
    confidence: 'high',
    formStageGate: catalog.formStageGate,
    summary: '_LABEL_4E49_ compares inline transition selector bytes against _RAM_CF5B_ to queue a staged transition or skip to the follow-up descriptor.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);
  annotateRegion(containingRegion(mapData, 0x0B511), {
    catalogId,
    kind: 'd1ae_branch_table_cf5b_progression',
    confidence: 'high',
    branchProgression: catalog.branchProgression,
    summary: '_DATA_B515_ branch entries advance _RAM_CF5B_ through staged form-transition progress and pair it with _RAM_D10E_ target form writes.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);
  annotateRegion(containingRegion(mapData, 0x0B6B0), {
    catalogId,
    kind: 'cf5b_request3_form_index_clamp_input',
    confidence: 'high',
    summary: '_LABEL_B6B0_ reads _RAM_CF5B_ while selecting _RAM_D10E_ for request-3 form-transition setup.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  for (const [address, kind, summary] of [
    ['$CF5B', 'form_stage_progression_state', '_RAM_CF5B_ is now mapped as staged form-transition progress: password-restored, clearable by _LABEL_4CE9_, advanced by bank-2 branches, and consumed by _LABEL_4E49_/_LABEL_B6B0_.'],
    ['$D1AE', 'form_stage_branch_index', '_RAM_D1AE_ selects the _DATA_B515_ bank-2 branch whose handlers advance _RAM_CF5B_ through staged form transitions.'],
    ['$D1AF', 'form_stage_branch_pending_flag', '_RAM_D1AF_ is set by _LABEL_4E49_ when queuing a staged form transition through _RAM_CF6A_=2.'],
    ['$D10E', 'form_stage_target_form_index', '_RAM_D10E_ is paired with _RAM_CF5B_ stage writes by bank-2 transition branches and later applied by form-transition setup.'],
    ['$C24F', 'form_stage_current_form_index', '_RAM_C24F_ is restored adjacent to _RAM_CF5B_ from password data and is read with _RAM_CF5B_ by _LABEL_B6B0_.'],
    ['$C26C', 'inline_transition_descriptor_cursor', '_RAM_C26C_ supplies selector bytes to _LABEL_4E49_; _RAM_CF5B_ determines whether it remains at the first inline descriptor or skips forward by six bytes.'],
  ]) {
    const entry = findRam(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.cf5bFormStageProgressionAudit = {
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
      type: 'cf5b_form_stage_progression_audit',
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
      formStageGate: catalog.formStageGate,
      branchProgression: catalog.branchProgression,
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
    branchProgression: catalog.branchProgression.map(entry => ({
      d1aeIndex: entry.d1aeIndex,
      branchLabel: entry.branchLabel,
      cf5bWriteHex: entry.cf5bWriteHex,
      d10eWriteHex: entry.d10eWriteHex,
      role: entry.role,
    })),
  }, null, 2));
}

main();
