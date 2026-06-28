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
const toolName = 'tools/world-cf6a-request3-form-transition-audit.mjs';
const catalogId = 'world-cf6a-request3-form-transition-catalog-2026-06-25';
const reportId = 'cf6a-request3-form-transition-audit-2026-06-25';

const sourceCatalogs = [
  'world-cf6a-dispatch-producer-catalog-2026-06-25',
  'world-zone-trigger-destination-role-catalog-2026-06-25',
  'world-bank2-transition-routine-catalog-2026-06-25',
  'world-ui-player-transition-table-catalog-2026-06-25',
  'world-player-form-catalog-2026-06-24',
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
  return {
    line,
    code,
    expected,
  };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function compactTriggerRecord(record) {
  return {
    triggerTableId: record.triggerTableId || '',
    triggerTableOffset: record.triggerTableOffset || '',
    recordIndex: Number(record.recordIndex || 0),
    entryOffset: record.entryOffset || '',
    rawOpcode: record.rawOpcode || '',
    opcodeIndex: Number(record.opcodeIndex || record.triggerOpcode || 0),
    triggerDispatchTarget: record.triggerDispatchTarget || '',
    role: record.role || '',
    consumer: record.consumer || '',
    sourceDescriptorSample: (record.sourceDescriptorSample || []).slice(0, 4).map(item => ({
      descriptorId: item.descriptorId || '',
      descriptorOffset: item.descriptorOffset || '',
      recipeId: item.recipeId || '',
    })),
  };
}

function buildLineChecks(lines) {
  return {
    label49a9: expectLine(lines, 11199, '_LABEL_49A9_:'),
    loadCf6aThree: expectLine(lines, 11200, 'ld a, $03'),
    writeCf6aThree: expectLine(lines, 11201, 'ld (_RAM_CF6A_), a'),
    bank2Table: expectLine(lines, 20055, '.dw _LABEL_B3D3_ _LABEL_B44F_ _LABEL_B6B0_'),
    labelB6b0: expectLine(lines, 20388, '_LABEL_B6B0_:'),
    readCurrentForm: expectLine(lines, 20389, 'ld a, (_RAM_C24F_)'),
    incrementCandidate: expectLine(lines, 20390, 'inc a'),
    compareFormLimit: expectLine(lines, 20391, 'cp $06'),
    readFormStage: expectLine(lines, 20394, 'ld a, (_RAM_CF5B_)'),
    compareStageCandidate: expectLine(lines, 20396, 'cp b'),
    fallbackOne: expectLine(lines, 20399, 'ld b, $01'),
    writeD10e: expectLine(lines, 20402, 'ld (_RAM_D10E_), a'),
    callB6ca: expectLine(lines, 20403, 'call _LABEL_B6CA_'),
    labelB6ca: expectLine(lines, 20406, '_LABEL_B6CA_:'),
    saveSourcePosition: expectLine(lines, 20413, 'ld (_RAM_D0FE_), hl'),
    saveSourceAttr: expectLine(lines, 20415, 'ld (_RAM_D102_), a'),
    initialWait: expectLine(lines, 20417, 'ld b, $08'),
    readD10e: expectLine(lines, 20421, 'ld a, (_RAM_D10E_)'),
    writeCurrentForm: expectLine(lines, 20422, 'ld (_RAM_C24F_), a'),
    saveTargetPosition: expectLine(lines, 20426, 'ld (_RAM_D100_), hl'),
    saveTargetAttr: expectLine(lines, 20428, 'ld (_RAM_D103_), a'),
    setTimingPointer: expectLine(lines, 20430, 'ld hl, _DATA_B77D_'),
    writeTimingPointer: expectLine(lines, 20431, 'ld (_RAM_D104_), hl'),
    setVdpStream: expectLine(lines, 20433, 'ld (_RAM_CF65_), a'),
    audioRequest: expectLine(lines, 20435, 'call _LABEL_104B_'),
    labelB718: expectLine(lines, 20436, '_LABEL_B718_:'),
    timingSentinelCompare: expectLine(lines, 20439, 'cp $FF'),
    restoreSourcePosition: expectLine(lines, 20449, 'ld (_RAM_C24C_), hl'),
    restoreSourceAttr: expectLine(lines, 20451, 'ld (_RAM_C27F_), a'),
    advanceTimingPointer: expectLine(lines, 20456, 'ld (_RAM_D104_), hl'),
    restoreTargetPosition: expectLine(lines, 20464, 'ld (_RAM_C24C_), hl'),
    restoreTargetAttr: expectLine(lines, 20466, 'ld (_RAM_C27F_), a'),
    clearVdpStream: expectLine(lines, 20472, 'ld (_RAM_CF65_), a'),
    clearPlayerSpeed: expectLine(lines, 20475, 'ld (_RAM_C248_), hl'),
    finalWait: expectLine(lines, 20478, 'ld b, $08'),
    setTransitionState: expectLine(lines, 20483, 'ld (_RAM_C260_), a'),
    timingTable: expectLine(lines, 20487, '_DATA_B77D_:'),
  };
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const cf6aCatalog = catalogById(mapData, 'world-cf6a-dispatch-producer-catalog-2026-06-25');
  const roleCatalog = catalogById(mapData, 'world-zone-trigger-destination-role-catalog-2026-06-25');
  const bank2Catalog = catalogById(mapData, 'world-bank2-transition-routine-catalog-2026-06-25');
  const uiTransitionCatalog = catalogById(mapData, 'world-ui-player-transition-table-catalog-2026-06-25');
  const playerFormCatalog = catalogById(mapData, 'world-player-form-catalog-2026-06-24');
  if (!cf6aCatalog) throw new Error('Missing world-cf6a-dispatch-producer-catalog-2026-06-25');
  if (!roleCatalog) throw new Error('Missing world-zone-trigger-destination-role-catalog-2026-06-25');

  const request3Producer = (cf6aCatalog.producers || []).find(item => Number(item.requestId) === 3) || null;
  const request3Records = (roleCatalog.recordRoles || []).filter(record => record.triggerDispatchTarget === '_LABEL_49A9_');
  const triggerRecordSummary = {
    triggerRecordCount: request3Records.length,
    triggerTableCount: new Set(request3Records.map(record => record.triggerTableId)).size,
    rawOpcodeCounts: countBy(request3Records, record => record.rawOpcode || 'unknown'),
    sourceDescriptorCount: new Set(
      request3Records.flatMap(record => (record.sourceDescriptorSample || []).map(item => item.descriptorId).filter(Boolean))
    ).size,
    samples: request3Records.slice(0, 12).map(compactTriggerRecord),
  };

  const clampModel = {
    routine: '_LABEL_B6B0_',
    inputs: [
      { ram: '_RAM_C24F_', address: '$C24F', role: 'current_player_form_index' },
      { ram: '_RAM_CF5B_', address: '$CF5B', role: 'form_transition_stage_progress' },
    ],
    output: { ram: '_RAM_D10E_', address: '$D10E', role: 'selected_target_form_index_for_transition' },
    cases: [
      {
        condition: '_RAM_C24F_ + 1 >= 0x06',
        result: '_RAM_D10E_ = 0x01',
        evidenceLines: [lineChecks.readCurrentForm, lineChecks.incrementCandidate, lineChecks.compareFormLimit, lineChecks.fallbackOne, lineChecks.writeD10e],
      },
      {
        condition: '_RAM_C24F_ + 1 < 0x06 and _RAM_CF5B_ + 1 < _RAM_C24F_ + 1',
        result: '_RAM_D10E_ = 0x01',
        evidenceLines: [lineChecks.readCurrentForm, lineChecks.readFormStage, lineChecks.compareStageCandidate, lineChecks.fallbackOne, lineChecks.writeD10e],
      },
      {
        condition: '_RAM_C24F_ + 1 < 0x06 and _RAM_CF5B_ + 1 >= _RAM_C24F_ + 1',
        result: '_RAM_D10E_ = _RAM_C24F_ + 1',
        evidenceLines: [lineChecks.readCurrentForm, lineChecks.incrementCandidate, lineChecks.compareStageCandidate, lineChecks.writeD10e],
      },
    ],
  };

  const transitionSetup = {
    routine: '_LABEL_B6CA_',
    sourceCapture: {
      positionWord: '_RAM_D0FE_',
      attrByte: '_RAM_D102_',
      evidenceLines: [lineChecks.saveSourcePosition, lineChecks.saveSourceAttr],
    },
    targetApplyAndCapture: {
      targetFormSource: '_RAM_D10E_',
      currentFormWrite: '_RAM_C24F_',
      positionWord: '_RAM_D100_',
      attrByte: '_RAM_D103_',
      evidenceLines: [lineChecks.readD10e, lineChecks.writeCurrentForm, lineChecks.saveTargetPosition, lineChecks.saveTargetAttr],
    },
    timingDriver: {
      routine: '_LABEL_B718_',
      timingTable: '_DATA_B77D_',
      timingPointerRam: '_RAM_D104_',
      sentinel: '0xFF',
      persistedTimingByteValues: false,
      evidenceLines: [lineChecks.setTimingPointer, lineChecks.writeTimingPointer, lineChecks.labelB718, lineChecks.timingSentinelCompare, lineChecks.advanceTimingPointer, lineChecks.timingTable],
    },
    renderState: {
      vdpStreamRam: '_RAM_CF65_',
      sourceRestoreRams: ['_RAM_C24C_', '_RAM_C27F_'],
      targetRestoreRams: ['_RAM_C24C_', '_RAM_C27F_'],
      finalTransitionStateRam: '_RAM_C260_',
      evidenceLines: [
        lineChecks.setVdpStream,
        lineChecks.restoreSourcePosition,
        lineChecks.restoreSourceAttr,
        lineChecks.restoreTargetPosition,
        lineChecks.restoreTargetAttr,
        lineChecks.clearVdpStream,
        lineChecks.setTransitionState,
      ],
    },
    audioRequest: {
      requestHex: '0x26',
      routine: '_LABEL_104B_',
      evidenceLines: [lineChecks.audioRequest],
    },
  };

  const evidence = [
    'Six cataloged room trigger records use opcode index 0x11 and dispatch to _LABEL_49A9_, which writes _RAM_CF6A_=3.',
    'ASM lines 20043-20055 dispatch _RAM_CF6A_=3 through _DATA_B3CD_ entry 2 to _LABEL_B6B0_.',
    'ASM lines 20388-20403 show _LABEL_B6B0_ deriving _RAM_D10E_ from _RAM_C24F_ and _RAM_CF5B_, then calling _LABEL_B6CA_.',
    'ASM lines 20406-20435 show _LABEL_B6CA_ capturing the source form display state, writing _RAM_C24F_ from _RAM_D10E_, capturing the target state, and starting the transition timing driver.',
    'ASM lines 20436-20483 show _LABEL_B718_ alternating source/target display states through _DATA_B77D_ until a $FF sentinel, then clearing the VDP stream state and setting _RAM_C260_=1.',
    'This audit stores labels, line numbers, RAM names, trigger counts, branch conditions, and catalog links only; no ROM bytes, timing byte values, decoded graphics, pixels, or audio streams are embedded.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))])),
    assetPolicy: 'Metadata only: ASM labels, line numbers, RAM labels/addresses, trigger counts, branch conditions, catalog ids, and evidence. No ROM bytes, decoded graphics, decoded rooms, music streams, timing byte values, text, pixels, or hashes are embedded.',
    path: {
      requestProducer: {
        triggerHandler: '_LABEL_49A9_',
        requestRam: '_RAM_CF6A_',
        requestId: 3,
        requestIdHex: '0x03',
        sourceCatalogRecordCount: request3Producer?.triggerRecordCount ?? request3Records.length,
        evidenceLines: [lineChecks.label49a9, lineChecks.loadCf6aThree, lineChecks.writeCf6aThree],
      },
      bank2Dispatch: {
        table: '_DATA_B3CD_',
        requestId: 3,
        targetLabel: '_LABEL_B6B0_',
        evidenceLines: [lineChecks.bank2Table, lineChecks.labelB6b0],
      },
      clampModel,
      transitionSetup,
    },
    triggerRecordSummary,
    existingCatalogRefs: {
      cf6aDispatchProducer: cf6aCatalog ? {
        id: cf6aCatalog.id,
        request3Count: cf6aCatalog.summary?.cf6aRequest3CatalogedTriggerRecordCount ?? null,
      } : null,
      bank2TransitionRoutine: bank2Catalog ? {
        id: bank2Catalog.id,
        summary: bank2Catalog.summary || null,
      } : null,
      uiPlayerTransitionTable: uiTransitionCatalog ? {
        id: uiTransitionCatalog.id,
        summary: uiTransitionCatalog.summary || null,
      } : null,
      playerForm: playerFormCatalog ? {
        id: playerFormCatalog.id,
        summary: playerFormCatalog.summary || null,
      } : null,
    },
    summary: {
      status: 'cf6a_request3_form_transition_path_cataloged',
      confidence: 'high_for_static_path_and_cataloged_trigger_records',
      triggerRecordCount: triggerRecordSummary.triggerRecordCount,
      triggerTableCount: triggerRecordSummary.triggerTableCount,
      clampInputRamCount: clampModel.inputs.length,
      transitionSetupRoutineCount: 2,
      timingTableByteValuesPersisted: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Trace _RAM_CF5B_ progression across staged form transitions to reproduce the exact form unlock/animation sequence.',
      'Connect _RAM_C260_=1 after _LABEL_B718_ to the player control/state routine that resumes gameplay.',
      'Model _LABEL_B6CA_ as a pure JavaScript state transition only after _RAM_C24C_/_RAM_C27F_ display-state meanings are fully resolved.',
    ],
  };
}

function annotateRegion(region, value, annotatedRegions) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis.cf6aRequest3FormTransitionAudit = value;
  annotatedRegions.push(compactRegion(region));
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  annotateRegion(containingRegion(mapData, 0x049A9), {
    catalogId,
    kind: 'cf6a_request3_trigger_handler_bridge',
    confidence: 'high',
    triggerRecordCount: catalog.summary.triggerRecordCount,
    summary: '_LABEL_49A9_ is the cataloged room-trigger handler that writes _RAM_CF6A_=3, dispatching the bank-2 form-transition setup path.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);
  annotateRegion(containingRegion(mapData, 0x0B6B0), {
    catalogId,
    kind: 'request3_form_index_clamp',
    confidence: 'high',
    inputs: catalog.path.clampModel.inputs,
    output: catalog.path.clampModel.output,
    summary: '_LABEL_B6B0_ clamps the next form-transition index from _RAM_C24F_ and _RAM_CF5B_, writes _RAM_D10E_, then calls _LABEL_B6CA_.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);
  annotateRegion(containingRegion(mapData, 0x0B6CA), {
    catalogId,
    kind: 'request3_form_transition_setup',
    confidence: 'high',
    sourceCapture: catalog.path.transitionSetup.sourceCapture,
    targetApplyAndCapture: catalog.path.transitionSetup.targetApplyAndCapture,
    timingDriver: catalog.path.transitionSetup.timingDriver,
    summary: '_LABEL_B6CA_ captures source/target player display state, applies _RAM_D10E_ into _RAM_C24F_, and starts the _LABEL_B718_ timing loop.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);
  annotateRegion(containingRegion(mapData, 0x0B718), {
    catalogId,
    kind: 'request3_form_transition_timing_driver',
    confidence: 'high',
    timingDriver: catalog.path.transitionSetup.timingDriver,
    renderState: catalog.path.transitionSetup.renderState,
    summary: '_LABEL_B718_ alternates saved source/target display states using _DATA_B77D_ as a timing stream until the sentinel, then clears transition VDP state and sets _RAM_C260_=1.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  for (const [address, kind, summary] of [
    ['$CF6A', 'request3_form_transition_dispatch_request', '_RAM_CF6A_=3 now links six room trigger records through _LABEL_B6B0_ to the form-transition setup path.'],
    ['$D10E', 'request3_target_form_index', '_RAM_D10E_ receives the target form index selected by _LABEL_B6B0_ and is applied to _RAM_C24F_ by _LABEL_B6CA_.'],
    ['$C24F', 'request3_current_form_state', '_RAM_C24F_ is an input to the _LABEL_B6B0_ clamp and later receives the selected target form from _RAM_D10E_.'],
    ['$CF5B', 'request3_form_stage_progress', '_RAM_CF5B_ participates in the _LABEL_B6B0_ target-form clamp before _RAM_D10E_ is written.'],
    ['$D0FE', 'request3_source_display_state_word', '_RAM_D0FE_ stores the source display-state word restored during the _LABEL_B718_ timing loop.'],
    ['$D100', 'request3_target_display_state_word', '_RAM_D100_ stores the target display-state word restored during the _LABEL_B718_ timing loop.'],
  ]) {
    const entry = findRam(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.cf6aRequest3FormTransitionAudit = {
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
      type: 'cf6a_request3_form_transition_audit',
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
      path: catalog.path,
      triggerRecordSummary: {
        ...catalog.triggerRecordSummary,
        samples: catalog.triggerRecordSummary.samples.slice(0, 6),
      },
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
    triggerRecordSummary: {
      triggerRecordCount: catalog.triggerRecordSummary.triggerRecordCount,
      triggerTableCount: catalog.triggerRecordSummary.triggerTableCount,
      rawOpcodeCounts: catalog.triggerRecordSummary.rawOpcodeCounts,
    },
  }, null, 2));
}

main();
