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
const toolName = 'tools/world-d1af-scene-completion-audit.mjs';
const catalogId = 'world-d1af-scene-completion-catalog-2026-06-25';
const reportId = 'd1af-scene-completion-audit-2026-06-25';

const sourceCatalogs = [
  'world-d1ae-transition-controller-bridge-catalog-2026-06-25',
  'world-cf5b-form-stage-progression-catalog-2026-06-25',
  'world-bank2-scene-routine-catalog-2026-06-25',
  'world-bank2-transition-routine-catalog-2026-06-25',
];

const expectedD1afWriteLines = [11790, 16392, 16537, 16710, 17242, 17639, 18083, 18459];

const sceneControllers = [
  {
    index: 0,
    controllerLabel: '_LABEL_8026_',
    controllerOffset: 0x08026,
    readLine: 16369,
    initWriteLine: 16392,
    initZeroSourceLine: 16388,
    updateDispatcherLabel: '_LABEL_80A1_',
    updateDispatcherOffset: 0x080A1,
    updateDispatcherCallLine: 16372,
    stateTableLabel: '_DATA_80A5_',
    stateTableOffset: 0x080A5,
    stateTableLabelLine: 16430,
    stateTableEntryLines: [16431],
    stateEntryCount: 5,
  },
  {
    index: 1,
    controllerLabel: '_LABEL_82A7_',
    controllerOffset: 0x082A7,
    readLine: 16686,
    initWriteLine: 16710,
    initZeroSourceLine: 16705,
    updateDispatcherLabel: '_LABEL_8338_',
    updateDispatcherOffset: 0x08338,
    updateDispatcherCallLine: 16689,
    stateTableLabel: '_DATA_833C_',
    stateTableOffset: 0x0833C,
    stateTableLabelLine: 16757,
    stateTableEntryLines: [16758],
    stateEntryCount: 7,
  },
  {
    index: 2,
    controllerLabel: '_LABEL_8682_',
    controllerOffset: 0x08682,
    readLine: 17225,
    initWriteLine: 17242,
    initZeroSourceLine: 17240,
    updateDispatcherLabel: '_LABEL_86D3_',
    updateDispatcherOffset: 0x086D3,
    updateDispatcherCallLine: 17228,
    stateTableLabel: '_DATA_86D7_',
    stateTableOffset: 0x086D7,
    stateTableLabelLine: 17265,
    stateTableEntryLines: [17266],
    stateEntryCount: 7,
  },
  {
    index: 3,
    controllerLabel: '_LABEL_898F_',
    controllerOffset: 0x0898F,
    readLine: 17617,
    initWriteLine: 17639,
    initZeroSourceLine: 17636,
    updateDispatcherLabel: '_LABEL_89DE_',
    updateDispatcherOffset: 0x089DE,
    updateDispatcherCallLine: 17620,
    stateTableLabel: '_DATA_89E2_',
    stateTableOffset: 0x089E2,
    stateTableLabelLine: 17656,
    stateTableEntryLines: [17657],
    stateEntryCount: 7,
  },
  {
    index: 4,
    controllerLabel: '_LABEL_8D0D_',
    controllerOffset: 0x08D0D,
    readLine: 18061,
    initWriteLine: 18083,
    initZeroSourceLine: 18080,
    updateDispatcherLabel: '_LABEL_8D5C_',
    updateDispatcherOffset: 0x08D5C,
    updateDispatcherCallLine: 18064,
    stateTableLabel: '_DATA_8D60_',
    stateTableOffset: 0x08D60,
    stateTableLabelLine: 18100,
    stateTableEntryLines: [18101],
    stateEntryCount: 7,
  },
  {
    index: 5,
    controllerLabel: '_LABEL_901B_',
    controllerOffset: 0x0901B,
    readLine: 18441,
    initWriteLine: 18459,
    initZeroSourceLine: 18456,
    updateDispatcherLabel: '_LABEL_90C6_',
    updateDispatcherOffset: 0x090C6,
    updateDispatcherCallLine: 18444,
    stateTableLabel: '_DATA_90CA_',
    stateTableOffset: 0x090CA,
    stateTableLabelLine: 18528,
    stateTableEntryLines: [18529, 18530],
    stateEntryCount: 16,
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

function collectExplicitD1afWrites(lines) {
  const writes = [];
  for (let i = 0; i < lines.length; i++) {
    const code = lineCode(lines, i + 1);
    if (/^ld\s+\(_RAM_D1AF_\),\s*a$/i.test(code)) {
      writes.push({ line: i + 1, code });
    }
  }
  return writes;
}

function assertWriteCoverage(writes) {
  const found = writes.map(write => write.line).sort((a, b) => a - b);
  const expected = expectedD1afWriteLines.slice().sort((a, b) => a - b);
  if (found.length !== expected.length || found.some((line, index) => line !== expected[index])) {
    throw new Error(`Unexpected _RAM_D1AF_ explicit write coverage: ${found.join(',')}`);
  }
}

function buildLineChecks(lines) {
  const checks = {
    damageEndReadCf8b: expectLine(lines, 11510, 'ld a, (_RAM_CF8B_)'),
    damageEndReadD1af: expectLine(lines, 11513, 'ld a, (_RAM_D1AF_)'),
    damageEndCheckFf: expectLine(lines, 11514, 'cp $FF'),
    damageEndScrollAdjust: expectLine(lines, 11517, 'call _LABEL_24DE_'),

    e49SetOne: expectLine(lines, 11789, 'ld a, $01'),
    e49WriteD1af: expectLine(lines, 11790, 'ld (_RAM_D1AF_), a'),

    completionLabel: expectLine(lines, 16530, '_LABEL_816A_:'),
    completionCounter: expectLine(lines, 16531, 'ld hl, _RAM_D186_'),
    completionDec: expectLine(lines, 16532, 'dec (hl)'),
    completionReturnNz: expectLine(lines, 16533, 'ret nz'),
    completionSetD17e: expectLine(lines, 16535, 'set 1, (hl)'),
    completionLoadFf: expectLine(lines, 16536, 'ld a, $FF'),
    completionWriteD1af: expectLine(lines, 16537, 'ld (_RAM_D1AF_), a'),

    b4dfReadD1af: expectLine(lines, 20174, 'ld a, (_RAM_D1AF_)'),
    b4dfCompareFf: expectLine(lines, 20175, 'cp $FF'),
    b4dfReturnWhenDone: expectLine(lines, 20176, 'ret z'),
  };

  for (const scene of sceneControllers) {
    checks[`scene${scene.index}ReadD1af`] = expectLine(lines, scene.readLine, 'ld a, (_RAM_D1AF_)');
    checks[`scene${scene.index}InitZeroSource`] = expectLine(lines, scene.initZeroSourceLine, 'xor a');
    checks[`scene${scene.index}InitWriteD1af`] = expectLine(lines, scene.initWriteLine, 'ld (_RAM_D1AF_), a');
    checks[`scene${scene.index}DispatcherCall`] = expectLine(lines, scene.updateDispatcherCallLine, `call ${scene.updateDispatcherLabel}`);
    checks[`scene${scene.index}StateDispatcherRead`] = expectLine(lines, scene.stateTableLabelLine - 3, 'ld a, (_RAM_D16E_)');
    checks[`scene${scene.index}StateDispatcherRst20`] = expectLine(lines, scene.stateTableLabelLine - 2, 'rst $20');
    checks[`scene${scene.index}StateTableLabel`] = expectLine(lines, scene.stateTableLabelLine, `${scene.stateTableLabel}:`);
    checks[`scene${scene.index}StateTableEntry0`] = expectLine(lines, scene.stateTableEntryLines[0], '.dw _LABEL_816A_');
  }

  return checks;
}

function compactLineChecks(lineChecks, keys) {
  return keys.map(key => lineChecks[key]).filter(Boolean);
}

function buildSourceCatalogPresence(mapData) {
  return Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))]));
}

function classifyWrite(line) {
  if (line === 11790) {
    return {
      kind: 'queue_start_value',
      valueHex: '0x01',
      routineLabel: '_LABEL_4E49_',
      routineOffset: '0x04E49',
      valueSource: 'literal_0x01_at_line_11789',
    };
  }
  if (line === 16537) {
    return {
      kind: 'scene_completion_value',
      valueHex: '0xFF',
      routineLabel: '_LABEL_816A_',
      routineOffset: '0x0816A',
      valueSource: 'literal_0xFF_at_line_16536',
    };
  }
  const scene = sceneControllers.find(item => item.initWriteLine === line);
  if (scene) {
    return {
      kind: 'scene_initialization_clear',
      valueHex: '0x00',
      routineLabel: scene.controllerLabel,
      routineOffset: hex(scene.controllerOffset, 5),
      valueSource: `xor_a_at_line_${scene.initZeroSourceLine}`,
      d1aeIndex: scene.index,
    };
  }
  return {
    kind: 'unclassified_explicit_write',
    valueHex: null,
    routineLabel: '',
    routineOffset: '',
    valueSource: '',
  };
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const explicitWrites = collectExplicitD1afWrites(lines);
  assertWriteCoverage(explicitWrites);

  const writes = explicitWrites.map(write => ({
    ...write,
    ...classifyWrite(write.line),
  }));

  const scenes = sceneControllers.map(scene => ({
    d1aeIndex: scene.index,
    d1aeIndexHex: hex(scene.index, 2),
    controllerLabel: scene.controllerLabel,
    controllerOffset: hex(scene.controllerOffset, 5),
    controllerRegion: compactRegion(containingRegion(mapData, scene.controllerOffset)),
    d1afReadLine: scene.readLine,
    d1afInitClearLine: scene.initWriteLine,
    updateDispatcherLabel: scene.updateDispatcherLabel,
    updateDispatcherOffset: hex(scene.updateDispatcherOffset, 5),
    updateDispatcherRegion: compactRegion(containingRegion(mapData, scene.updateDispatcherOffset)),
    stateTableLabel: scene.stateTableLabel,
    stateTableOffset: hex(scene.stateTableOffset, 5),
    stateTableRegion: compactRegion(containingRegion(mapData, scene.stateTableOffset)),
    stateTableEntryCount: scene.stateEntryCount,
    completionEntry: {
      d16eIndex: 0,
      targetLabel: '_LABEL_816A_',
      targetOffset: '0x0816A',
      confidence: 'high_for_table_entry_zero',
    },
  }));

  const evidence = [
    'ASM lines 11789-11790 show _LABEL_4E49_ setting _RAM_D1AF_ to 0x01 when queuing a staged transition.',
    'ASM lines 16369-16392, 16686-16710, 17225-17242, 17617-17639, 18061-18083, and 18441-18459 show the six D1AE scene controllers treating _RAM_D1AF_=1 as the initialization pass and clearing _RAM_D1AF_ to 0.',
    'ASM lines 16427-16431, 16754-16758, 17262-17266, 17653-17657, 18097-18101, and 18525-18530 show the six _RAM_D16E_ state tables; each table has _LABEL_816A_ as entry 0.',
    'ASM lines 16530-16537 show _LABEL_816A_ decrementing _RAM_D186_, marking _RAM_D17E_ bit 1, and writing _RAM_D1AF_=0xFF when the counter reaches zero.',
    'ASM lines 20174-20177 show _LABEL_B4DF_ leaving the transition-scene loop when _RAM_D1AF_ equals 0xFF.',
    'ASM lines 11510-11517 show _LABEL_4BD7_ checking _RAM_CF8B_ and _RAM_D1AF_=0xFF before applying the _LABEL_24DE_ scroll/position adjustment.',
    'This audit stores labels, offsets, line numbers, RAM names, counts, and evidence only; no ROM bytes, decoded graphics, pixels, text, timing bytes, or audio data are embedded.',
  ];

  return {
    id: catalogId,
    type: 'd1af_scene_completion_model',
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: buildSourceCatalogPresence(mapData),
    scope: {
      flagRam: '_RAM_D1AF_',
      stateIndexRam: '_RAM_D16E_',
      completionCounterRam: '_RAM_D186_',
      completionMarkerRam: '_RAM_D17E_',
      queueWriter: '_LABEL_4E49_',
      completionWriter: '_LABEL_816A_',
      transitionLoopConsumer: '_LABEL_B4DF_',
      sideConsumer: '_LABEL_4BD7_',
    },
    explicitD1afWrites: writes,
    lifecycleModel: {
      queue: {
        valueHex: '0x01',
        writerLabel: '_LABEL_4E49_',
        writeLine: 11790,
        summary: '_LABEL_4E49_ sets _RAM_D1AF_=1 at the same time it queues _RAM_CF6A_=2 for the staged transition dispatcher.',
      },
      initializationPass: {
        triggerCondition: 'D1AE scene controller reads _RAM_D1AF_, decrements it, and takes the initialization branch when the queued value was 1.',
        clearValueHex: '0x00',
        clearWriteCount: scenes.length,
        scenes,
      },
      updateDispatch: {
        stateIndexRam: '_RAM_D16E_',
        sharedCompletionEntryIndex: 0,
        sharedCompletionTarget: '_LABEL_816A_',
        tableCount: scenes.length,
        confidence: 'high_for_table_entry_zero; path-to-index-zero not fully traced here',
      },
      completion: {
        valueHex: '0xFF',
        writerLabel: '_LABEL_816A_',
        writeLine: 16537,
        counterRam: '_RAM_D186_',
        markerRam: '_RAM_D17E_',
        consumerLabel: '_LABEL_B4DF_',
        consumerLines: [20174, 20175, 20176, 20177],
      },
      sideConsumer: {
        label: '_LABEL_4BD7_',
        condition: '_RAM_CF8B_ != 0 and _RAM_D1AF_ == 0xFF',
        action: 'loads DE=0x00D0 and calls _LABEL_24DE_',
        confidence: 'high_for_explicit_condition_and_call; exact gameplay effect still inherits _LABEL_24DE_ semantics',
      },
    },
    sceneStateTables: scenes,
    lineChecks: {
      queue: compactLineChecks(lineChecks, ['e49SetOne', 'e49WriteD1af']),
      completionWriter: compactLineChecks(lineChecks, ['completionLabel', 'completionCounter', 'completionDec', 'completionReturnNz', 'completionSetD17e', 'completionLoadFf', 'completionWriteD1af']),
      transitionLoopConsumer: compactLineChecks(lineChecks, ['b4dfReadD1af', 'b4dfCompareFf', 'b4dfReturnWhenDone']),
      sideConsumer: compactLineChecks(lineChecks, ['damageEndReadCf8b', 'damageEndReadD1af', 'damageEndCheckFf', 'damageEndScrollAdjust']),
    },
    summary: {
      status: 'd1af_scene_completion_model_cataloged',
      confidence: 'high_for_explicit_writes_and_state_table_entry_zero',
      explicitWriteCount: writes.length,
      queueWriteCount: writes.filter(write => write.kind === 'queue_start_value').length,
      initClearWriteCount: writes.filter(write => write.kind === 'scene_initialization_clear').length,
      completionWriteCount: writes.filter(write => write.kind === 'scene_completion_value').length,
      stateTableCount: scenes.length,
      stateTableEntryZeroCompletionCount: scenes.filter(scene => scene.completionEntry.targetLabel === '_LABEL_816A_').length,
      indirectWritesCovered: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Trace _RAM_D16E_ writes inside each scene state table to prove the exact paths that select entry 0 and call _LABEL_816A_.',
      'Resolve _LABEL_24DE_ semantics so the _LABEL_4BD7_ _RAM_D1AF_=0xFF side effect can be named precisely.',
      'Use the D1AF lifecycle with the D1AE bridge to model transition-scene frame phases in a future JavaScript transition engine module.',
    ],
  };
}

function annotateRegion(region, value, annotatedRegions) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis.d1afSceneCompletionAudit = value;
  annotatedRegions.push(compactRegion(region));
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  const evidence = catalog.evidence;

  annotateRegion(containingRegion(mapData, 0x04E49), {
    catalogId,
    kind: 'd1af_queue_writer',
    confidence: 'high',
    summary: '_LABEL_4E49_ writes _RAM_D1AF_=1 while queuing the D1AE staged transition request.',
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x04BD7), {
    catalogId,
    kind: 'd1af_ff_side_consumer',
    confidence: 'medium_high',
    summary: '_LABEL_4BD7_ checks _RAM_CF8B_ and _RAM_D1AF_=0xFF before calling _LABEL_24DE_ with DE=0x00D0; exact _LABEL_24DE_ effect remains to be named.',
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x0816A), {
    catalogId,
    kind: 'd1af_completion_writer',
    confidence: 'high',
    summary: '_LABEL_816A_ decrements _RAM_D186_ and writes _RAM_D1AF_=0xFF when the counter reaches zero.',
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x0B4DF), {
    catalogId,
    kind: 'd1af_completion_loop_consumer',
    confidence: 'high',
    summary: '_LABEL_B4DF_ keeps the transition scene loop running until _RAM_D1AF_ equals 0xFF.',
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  for (const scene of catalog.sceneStateTables) {
    annotateRegion(containingRegion(mapData, parseHex(scene.controllerOffset)), {
      catalogId,
      kind: 'd1af_scene_controller_init_gate',
      confidence: 'high',
      d1aeIndex: scene.d1aeIndex,
      d1aeIndexHex: scene.d1aeIndexHex,
      summary: `${scene.controllerLabel} reads _RAM_D1AF_; the queued value 1 selects the initialization branch, which clears _RAM_D1AF_ to 0.`,
      stateDispatcher: scene.updateDispatcherLabel,
      stateTable: scene.stateTableLabel,
      evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
    annotateRegion(containingRegion(mapData, parseHex(scene.updateDispatcherOffset)), {
      catalogId,
      kind: 'd16e_scene_state_dispatcher_with_d1af_completion_entry',
      confidence: 'high_for_dispatcher_and_entry_zero',
      d1aeIndex: scene.d1aeIndex,
      stateIndexRam: '_RAM_D16E_',
      stateTable: scene.stateTableLabel,
      completionEntry: scene.completionEntry,
      evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
    annotateRegion(containingRegion(mapData, parseHex(scene.stateTableOffset)), {
      catalogId,
      kind: 'd16e_state_table_entry_zero_d1af_completion',
      confidence: 'high',
      d1aeIndex: scene.d1aeIndex,
      stateIndexRam: '_RAM_D16E_',
      entryCount: scene.stateTableEntryCount,
      entryZeroTarget: '_LABEL_816A_',
      evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
  }

  for (const [address, kind, summary, confidence] of [
    ['$D1AF', 'transition_scene_lifecycle_flag', '_RAM_D1AF_ is queued as 1, cleared to 0 by the selected D1AE scene controller initialization pass, and written as 0xFF by _LABEL_816A_ for _LABEL_B4DF_ completion.', 'high'],
    ['$D16E', 'transition_scene_state_index', '_RAM_D16E_ indexes the per-scene state dispatch tables whose entry 0 points to the shared _LABEL_816A_ completion writer.', 'high_for_table_entry_zero'],
    ['$D186', 'd1af_completion_counter', '_LABEL_816A_ decrements _RAM_D186_ and writes _RAM_D1AF_=0xFF only when the counter reaches zero.', 'high'],
    ['$D17E', 'd1af_completion_marker_bits', '_LABEL_816A_ sets bit 1 in _RAM_D17E_ before writing _RAM_D1AF_=0xFF.', 'high'],
    ['$CF8B', 'transition_active_gate_for_d1af_side_consumer', '_LABEL_4BD7_ checks _RAM_CF8B_ before consulting _RAM_D1AF_=0xFF for the _LABEL_24DE_ adjustment.', 'medium_high'],
  ]) {
    const entry = findRam(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.d1afSceneCompletionAudit = {
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
    mapData.transitionRoutineCatalogs = (mapData.transitionRoutineCatalogs || []).filter(item => item.id !== catalogId);
    mapData.transitionRoutineCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'd1af_scene_completion_audit',
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
      lifecycleModel: catalog.lifecycleModel,
      sceneStateTables: catalog.sceneStateTables,
      explicitD1afWrites: catalog.explicitD1afWrites,
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
    explicitD1afWrites: catalog.explicitD1afWrites.map(write => ({
      line: write.line,
      kind: write.kind,
      valueHex: write.valueHex,
      routineLabel: write.routineLabel,
    })),
    stateTables: catalog.sceneStateTables.map(table => ({
      d1aeIndex: table.d1aeIndex,
      dispatcher: table.updateDispatcherLabel,
      stateTable: table.stateTableLabel,
      entryZeroTarget: table.completionEntry.targetLabel,
    })),
  }, null, 2));
}

main();
