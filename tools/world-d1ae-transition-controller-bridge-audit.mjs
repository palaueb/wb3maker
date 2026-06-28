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
const toolName = 'tools/world-d1ae-transition-controller-bridge-audit.mjs';
const catalogId = 'world-d1ae-transition-controller-bridge-catalog-2026-06-25';
const reportId = 'd1ae-transition-controller-bridge-audit-2026-06-25';

const sourceCatalogs = [
  'world-cf5b-form-stage-progression-catalog-2026-06-25',
  'world-cf6a-dispatch-producer-catalog-2026-06-25',
  'world-bank2-transition-routine-catalog-2026-06-25',
  'world-bank2-scene-routine-catalog-2026-06-25',
  'world-zone-trigger-destination-role-catalog-2026-06-25',
];

const d1aeEntries = [
  {
    index: 0,
    sceneController: '_LABEL_8026_',
    sceneControllerOffset: 0x08026,
    branchRoutine: '_LABEL_B521_',
    branchRoutineOffset: 0x0B521,
    branchRole: 'transition_branch_0',
    cf5bWriteHex: null,
    d10eWriteHex: '0x01',
  },
  {
    index: 1,
    sceneController: '_LABEL_82A7_',
    sceneControllerOffset: 0x082A7,
    branchRoutine: '_LABEL_B539_',
    branchRoutineOffset: 0x0B539,
    branchRole: 'transition_branch_1_form_stage_progression',
    cf5bWriteHex: '0x01',
    d10eWriteHex: '0x02',
  },
  {
    index: 2,
    sceneController: '_LABEL_8682_',
    sceneControllerOffset: 0x08682,
    branchRoutine: '_LABEL_B551_',
    branchRoutineOffset: 0x0B551,
    branchRole: 'transition_branch_2_form_stage_progression',
    cf5bWriteHex: '0x02',
    d10eWriteHex: '0x03',
  },
  {
    index: 3,
    sceneController: '_LABEL_898F_',
    sceneControllerOffset: 0x0898F,
    branchRoutine: '_LABEL_B569_',
    branchRoutineOffset: 0x0B569,
    branchRole: 'transition_branch_3_form_stage_progression',
    cf5bWriteHex: '0x03',
    d10eWriteHex: '0x04',
  },
  {
    index: 4,
    sceneController: '_LABEL_8D0D_',
    sceneControllerOffset: 0x08D0D,
    branchRoutine: '_LABEL_B581_',
    branchRoutineOffset: 0x0B581,
    branchRole: 'transition_branch_4_form_stage_progression',
    cf5bWriteHex: '0x04',
    d10eWriteHex: '0x05',
  },
  {
    index: 5,
    sceneController: '_LABEL_901B_',
    sceneControllerOffset: 0x0901B,
    branchRoutine: '_LABEL_B599_',
    branchRoutineOffset: 0x0B599,
    branchRole: 'transition_branch_5_finale',
    cf5bWriteHex: '0x05',
    d10eWriteHex: '0x00',
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

function collectExplicitD1aeWrites(lines) {
  const writes = [];
  for (let i = 0; i < lines.length; i++) {
    const code = lineCode(lines, i + 1);
    if (/^ld\s+\(_RAM_D1AE_\),\s*a$/i.test(code)) {
      writes.push({ line: i + 1, code });
    }
  }
  return writes;
}

function buildLineChecks(lines) {
  return {
    e49Label: expectLine(lines, 11771, '_LABEL_4E49_:'),
    e49ReadDescriptorPointer: expectLine(lines, 11774, 'ld hl, (_RAM_C26C_)'),
    e49ReadSelector: expectLine(lines, 11775, 'ld a, (hl)'),
    e49StoreAdvancedPointer: expectLine(lines, 11777, 'ld (_RAM_C26C_), hl'),
    e49ZeroSelectorBranch: expectLine(lines, 11778, 'or a'),
    e49SaveSelector: expectLine(lines, 11780, 'ld c, a'),
    e49ReadCf5b: expectLine(lines, 11781, 'ld a, (_RAM_CF5B_)'),
    e49CompareCf5b: expectLine(lines, 11782, 'cp c'),
    e49SkipWhenReached: expectLine(lines, 11783, 'jr nc, ++'),
    e49QueueD1ae: expectLine(lines, 11786, 'ld (_RAM_D1AE_), a'),
    e49SetD1af: expectLine(lines, 11790, 'ld (_RAM_D1AF_), a'),
    e49SetCf6a2: expectLine(lines, 11792, 'ld (_RAM_CF6A_), a'),
    e49SkipFirstDescriptor: expectLine(lines, 11796, 'ld de, $0006'),
    e49LoadFollowupDescriptor: expectLine(lines, 11801, 'call _LABEL_2620_'),

    bank2SceneEntry: expectLine(lines, 16348, '_LABEL_8000_:'),
    bank2SceneReadD1ae: expectLine(lines, 16361, 'ld a, (_RAM_D1AE_)'),
    bank2SceneDispatch: expectLine(lines, 16362, 'rst $20'),
    sceneTableLabel: expectLine(lines, 16364, '_DATA_801A_:'),
    sceneTableEntries: expectLine(lines, 16365, '.dw _LABEL_8026_ _LABEL_82A7_ _LABEL_8682_ _LABEL_898F_ _LABEL_8D0D_ _LABEL_901B_'),

    cf6aDispatcher: expectLine(lines, 20043, '_LABEL_B3C0_:'),
    cf6aDispatchTableEntries: expectLine(lines, 20055, '.dw _LABEL_B3D3_ _LABEL_B44F_ _LABEL_B6B0_'),

    b44fLabel: expectLine(lines, 20107, '_LABEL_B44F_:'),
    b44fFirstDescriptorLoad: expectLine(lines, 20114, 'call _LABEL_2620_'),
    b44fAdvanceDescriptorPointer: expectLine(lines, 20118, 'ld (_RAM_C26C_), hl'),
    b44fLoadSceneTiles: expectLine(lines, 20123, 'call _LABEL_998_'),
    b44fSceneControllerBeforeLoop: expectLine(lines, 20124, 'call _LABEL_8000_'),
    b44fLoopCall: expectLine(lines, 20128, 'call _LABEL_B4DF_'),
    b44fBranchDispatch: expectLine(lines, 20129, 'call _LABEL_B511_'),
    b44fSecondDescriptorLoad: expectLine(lines, 20134, 'call _LABEL_2620_'),
    b44fClearTransitionFlag: expectLine(lines, 20151, 'ld (_RAM_CF8B_), a'),

    b4dfLabel: expectLine(lines, 20159, '_LABEL_B4DF_:'),
    b4dfRuntimeScan: expectLine(lines, 20163, 'call _LABEL_4746_'),
    b4dfRepeatedSceneController: expectLine(lines, 20170, 'call _LABEL_8000_'),
    b4dfReadCompletion: expectLine(lines, 20174, 'ld a, (_RAM_D1AF_)'),
    b4dfCompletionSentinel: expectLine(lines, 20175, 'cp $FF'),
    b4dfLoopBack: expectLine(lines, 20177, 'jp _LABEL_B4DF_'),

    b511Label: expectLine(lines, 20183, '_LABEL_B511_:'),
    b511ReadD1ae: expectLine(lines, 20184, 'ld a, (_RAM_D1AE_)'),
    b511Dispatch: expectLine(lines, 20185, 'rst $20'),
    branchTableLabel: expectLine(lines, 20187, '_DATA_B515_:'),
    branchTableEntries: expectLine(lines, 20188, '.dw _LABEL_B521_ _LABEL_B539_ _LABEL_B551_ _LABEL_B569_ _LABEL_B581_ _LABEL_B599_'),

    b79cLabel: expectLine(lines, 20493, '_LABEL_B79C_:'),
    b79cActivateSlot: expectLine(lines, 20531, 'ld (ix+0), $80'),
    b79cReadD1ae: expectLine(lines, 20557, 'ld a, (_RAM_D1AE_)'),
    b79cCopyD1aeToSlot: expectLine(lines, 20558, 'ld (ix+62), a'),
  };
}

function buildSourceCatalogPresence(mapData) {
  return Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))]));
}

function buildBridgeEntries(mapData) {
  return d1aeEntries.map(entry => ({
    index: entry.index,
    indexHex: hex(entry.index, 2),
    sceneController: {
      label: entry.sceneController,
      offset: hex(entry.sceneControllerOffset, 5),
      region: compactRegion(containingRegion(mapData, entry.sceneControllerOffset)),
      dispatchTable: '_DATA_801A_',
      dispatcher: '_LABEL_8000_',
    },
    branchRoutine: {
      label: entry.branchRoutine,
      offset: hex(entry.branchRoutineOffset, 5),
      region: compactRegion(containingRegion(mapData, entry.branchRoutineOffset)),
      dispatchTable: '_DATA_B515_',
      dispatcher: '_LABEL_B511_',
      role: entry.branchRole,
      cf5bWriteHex: entry.cf5bWriteHex,
      d10eWriteHex: entry.d10eWriteHex,
    },
  }));
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const explicitWrites = collectExplicitD1aeWrites(lines);
  if (explicitWrites.length !== 1 || explicitWrites[0].line !== 11786) {
    throw new Error(`Unexpected _RAM_D1AE_ explicit write coverage: ${explicitWrites.map(item => item.line).join(',')}`);
  }

  const bridgeEntries = buildBridgeEntries(mapData);
  const sourceCatalogPresence = buildSourceCatalogPresence(mapData);
  const evidence = [
    'ASM lines 11771-11792 show _LABEL_4E49_ reading the inline transition selector from _RAM_C26C_, comparing it with _RAM_CF5B_, and queuing _RAM_D1AE_/_RAM_D1AF_/_RAM_CF6A_=2 when the staged transition should run.',
    'The current ASM contains exactly one explicit `_RAM_D1AE_` write: `ld (_RAM_D1AE_), a` at line 11786.',
    'ASM lines 16348-16365 show _LABEL_8000_ reading _RAM_D1AE_ and dispatching through six-entry table _DATA_801A_.',
    'ASM lines 20107-20134 show _LABEL_B44F_ loading the first inline room descriptor, advancing _RAM_C26C_ by six bytes, running _LABEL_8000_, looping through _LABEL_B4DF_, dispatching _LABEL_B511_, and loading the second inline room descriptor.',
    'ASM lines 20159-20177 show _LABEL_B4DF_ repeatedly calling _LABEL_8000_ until _RAM_D1AF_ reaches $FF.',
    'ASM lines 20183-20188 show _LABEL_B511_ reading _RAM_D1AE_ and dispatching through six-entry table _DATA_B515_.',
    'ASM lines 20557-20558 show _LABEL_B79C_ copying _RAM_D1AE_ into transition actor slot field IX+62.',
    'This audit stores labels, offsets, line numbers, RAM names, counts, and evidence only; no ROM bytes, decoded graphics, pixels, text, timing bytes, or audio data are embedded.',
  ];

  return {
    id: catalogId,
    type: 'd1ae_transition_controller_bridge',
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence,
    scope: {
      ram: '_RAM_D1AE_',
      writer: '_LABEL_4E49_',
      sceneDispatcher: '_LABEL_8000_',
      sceneDispatchTable: '_DATA_801A_',
      transitionSequence: '_LABEL_B44F_',
      transitionLoop: '_LABEL_B4DF_',
      branchDispatcher: '_LABEL_B511_',
      branchDispatchTable: '_DATA_B515_',
      trailSlotScheduler: '_LABEL_B79C_',
    },
    explicitD1aeWrites: explicitWrites.map(write => ({
      ...write,
      routineLabel: '_LABEL_4E49_',
      routineOffset: '0x04E49',
      valueSource: 'inline_transition_selector_or_zero_from__RAM_C26C_',
      evidenceLines: [
        lineChecks.e49ReadSelector,
        lineChecks.e49ZeroSelectorBranch,
        lineChecks.e49SaveSelector,
        lineChecks.e49ReadCf5b,
        lineChecks.e49CompareCf5b,
        lineChecks.e49SkipWhenReached,
        lineChecks.e49QueueD1ae,
      ],
    })),
    bridgeModel: {
      selectorSource: {
        ramPointer: '_RAM_C26C_',
        writerLabel: '_LABEL_4E49_',
        writeLine: 11786,
        confidence: 'high_for_explicit_write',
        summary: '_LABEL_4E49_ stores the inline transition selector into _RAM_D1AE_ when the selector is zero or the current _RAM_CF5B_ stage is below the selector.',
      },
      sceneDispatch: {
        dispatcherLabel: '_LABEL_8000_',
        dispatchTableLabel: '_DATA_801A_',
        indexRam: '_RAM_D1AE_',
        entryCount: bridgeEntries.length,
        evidenceLines: [
          lineChecks.bank2SceneReadD1ae,
          lineChecks.bank2SceneDispatch,
          lineChecks.sceneTableLabel,
          lineChecks.sceneTableEntries,
        ],
      },
      transitionSequence: {
        dispatcherLabel: '_LABEL_B44F_',
        loopLabel: '_LABEL_B4DF_',
        branchDispatcherLabel: '_LABEL_B511_',
        summary: '_LABEL_B44F_ consumes the first inline descriptor, advances _RAM_C26C_ by six bytes, runs the D1AE-indexed bank-2 scene, dispatches the D1AE-indexed completion branch, then consumes the second inline descriptor.',
        evidenceLines: [
          lineChecks.b44fFirstDescriptorLoad,
          lineChecks.b44fAdvanceDescriptorPointer,
          lineChecks.b44fSceneControllerBeforeLoop,
          lineChecks.b44fLoopCall,
          lineChecks.b44fBranchDispatch,
          lineChecks.b44fSecondDescriptorLoad,
        ],
      },
      branchDispatch: {
        dispatcherLabel: '_LABEL_B511_',
        dispatchTableLabel: '_DATA_B515_',
        indexRam: '_RAM_D1AE_',
        entryCount: bridgeEntries.length,
        evidenceLines: [
          lineChecks.b511ReadD1ae,
          lineChecks.b511Dispatch,
          lineChecks.branchTableLabel,
          lineChecks.branchTableEntries,
        ],
      },
      trailSlotPropagation: {
        schedulerLabel: '_LABEL_B79C_',
        sourceRam: '_RAM_D1AE_',
        destinationSlotField: 'IX+62',
        confidence: 'high_for_explicit_read_and_slot_write',
        evidenceLines: [
          lineChecks.b79cActivateSlot,
          lineChecks.b79cReadD1ae,
          lineChecks.b79cCopyD1aeToSlot,
        ],
      },
    },
    entries: bridgeEntries,
    summary: {
      status: 'd1ae_transition_controller_bridge_cataloged',
      confidence: 'high_for_explicit_write_and_dispatch_table_consumers',
      explicitWriteCount: explicitWrites.length,
      sceneDispatchEntryCount: bridgeEntries.length,
      branchDispatchEntryCount: bridgeEntries.length,
      trailSlotCopies: 1,
      indirectWritesCovered: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Trace each _DATA_801A_ scene controller to the _RAM_D1AF_ completion write that releases the _LABEL_B4DF_ loop.',
      'Map the transition actor slot field IX+62 consumers to determine how D1AE changes trail animation or motion selection.',
      'Link inline transition recipe records to the six D1AE indices so scene recipe rendering can select the correct transition controller metadata automatically.',
    ],
  };
}

function annotateRegion(region, value, annotatedRegions) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis.d1aeTransitionControllerBridgeAudit = value;
  annotatedRegions.push(compactRegion(region));
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  const evidence = catalog.evidence;

  annotateRegion(containingRegion(mapData, 0x04E49), {
    catalogId,
    kind: 'd1ae_transition_selector_writer',
    confidence: 'high',
    summary: '_LABEL_4E49_ is the only explicit _RAM_D1AE_ writer found in the current ASM and queues _RAM_CF6A_=2 for the staged transition dispatcher.',
    explicitWriteLines: catalog.explicitD1aeWrites.map(write => write.line),
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x08000), {
    catalogId,
    kind: 'd1ae_scene_controller_dispatcher',
    confidence: 'high',
    summary: '_LABEL_8000_ reads _RAM_D1AE_ and dispatches through _DATA_801A_ to select one of six bank-2 scene controllers.',
    dispatchTable: '_DATA_801A_',
    entryCount: catalog.entries.length,
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x0801A), {
    catalogId,
    kind: 'd1ae_scene_controller_table',
    confidence: 'high',
    indexRam: '_RAM_D1AE_',
    dispatcher: '_LABEL_8000_',
    entries: catalog.entries.map(entry => ({
      index: entry.index,
      targetLabel: entry.sceneController.label,
      targetOffset: entry.sceneController.offset,
    })),
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x0B44F), {
    catalogId,
    kind: 'd1ae_transition_sequence_orchestrator',
    confidence: 'high',
    summary: catalog.bridgeModel.transitionSequence.summary,
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x0B4DF), {
    catalogId,
    kind: 'd1ae_scene_loop_until_completion',
    confidence: 'high',
    summary: '_LABEL_B4DF_ repeatedly calls _LABEL_8000_ until _RAM_D1AF_ equals $FF.',
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x0B511), {
    catalogId,
    kind: 'd1ae_completion_branch_dispatcher',
    confidence: 'high',
    summary: '_LABEL_B511_ reads _RAM_D1AE_ and dispatches through _DATA_B515_ to select one of six post-scene transition branches.',
    dispatchTable: '_DATA_B515_',
    entryCount: catalog.entries.length,
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x0B515), {
    catalogId,
    kind: 'd1ae_completion_branch_table',
    confidence: 'high',
    indexRam: '_RAM_D1AE_',
    dispatcher: '_LABEL_B511_',
    entries: catalog.entries.map(entry => ({
      index: entry.index,
      targetLabel: entry.branchRoutine.label,
      targetOffset: entry.branchRoutine.offset,
      role: entry.branchRoutine.role,
      cf5bWriteHex: entry.branchRoutine.cf5bWriteHex,
      d10eWriteHex: entry.branchRoutine.d10eWriteHex,
    })),
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x0B79C), {
    catalogId,
    kind: 'd1ae_transition_trail_slot_propagation',
    confidence: 'high',
    summary: '_LABEL_B79C_ copies _RAM_D1AE_ into transition actor slot field IX+62 when scheduling a transition trail slot.',
    destinationSlotField: 'IX+62',
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  for (const entry of catalog.entries) {
    annotateRegion(containingRegion(mapData, parseHex(entry.branchRoutine.offset)), {
      catalogId,
      kind: 'd1ae_completion_branch_target',
      confidence: 'high',
      d1aeIndex: entry.index,
      d1aeIndexHex: entry.indexHex,
      role: entry.branchRoutine.role,
      pairedSceneController: entry.sceneController.label,
      cf5bWriteHex: entry.branchRoutine.cf5bWriteHex,
      d10eWriteHex: entry.branchRoutine.d10eWriteHex,
      evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
  }

  for (const [address, kind, summary] of [
    ['$D1AE', 'transition_controller_bridge_index', '_RAM_D1AE_ is written by _LABEL_4E49_ and consumed by _LABEL_8000_, _LABEL_B511_, and _LABEL_B79C_ as the staged transition controller index.'],
    ['$D1AF', 'transition_scene_completion_flag', '_RAM_D1AF_ is set when _LABEL_4E49_ queues a staged transition and polled by _LABEL_B4DF_ until $FF releases the transition scene loop.'],
    ['$C26C', 'inline_transition_descriptor_pointer', '_RAM_C26C_ supplies the inline transition selector and paired room descriptors consumed by _LABEL_4E49_/_LABEL_B44F_.'],
    ['$CF6A', 'pending_transition_request', '_RAM_CF6A_=2 routes the queued D1AE staged transition into _LABEL_B44F_ through _LABEL_B3C0_.'],
    ['$D10E', 'form_stage_post_transition_state', '_RAM_D10E_ is written by D1AE-indexed completion branches in _DATA_B515_ after the transition scene.'],
  ]) {
    const entry = findRam(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.d1aeTransitionControllerBridgeAudit = {
      catalogId,
      kind,
      confidence: 'high',
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
      type: 'd1ae_transition_controller_bridge_audit',
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
      bridgeModel: catalog.bridgeModel,
      entries: catalog.entries,
      explicitD1aeWrites: catalog.explicitD1aeWrites,
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
    explicitD1aeWrites: catalog.explicitD1aeWrites.map(write => ({
      line: write.line,
      routineLabel: write.routineLabel,
      valueSource: write.valueSource,
    })),
    pairedEntries: catalog.entries.map(entry => ({
      index: entry.index,
      sceneController: entry.sceneController.label,
      branchRoutine: entry.branchRoutine.label,
      cf5bWriteHex: entry.branchRoutine.cf5bWriteHex,
      d10eWriteHex: entry.branchRoutine.d10eWriteHex,
    })),
  }, null, 2));
}

main();
