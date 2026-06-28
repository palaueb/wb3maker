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
const toolName = 'tools/world-cf6a-dispatch-producer-audit.mjs';
const catalogId = 'world-cf6a-dispatch-producer-catalog-2026-06-25';
const reportId = 'cf6a-dispatch-producer-audit-2026-06-25';

const sourceCatalogs = [
  'world-zone-trigger-record-catalog-2026-06-25',
  'world-zone-trigger-destination-role-catalog-2026-06-25',
  'world-zone-descriptor-pointer-flow-catalog-2026-06-25',
  'world-room-loader-audio-selector-resolution-catalog-2026-06-25',
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
    destinationDescriptorId: record.destination?.descriptorId || null,
    sourceDescriptorSample: (record.sourceDescriptorSample || []).slice(0, 4).map(item => ({
      descriptorId: item.descriptorId || '',
      descriptorOffset: item.descriptorOffset || '',
      recipeId: item.recipeId || '',
    })),
  };
}

function usageForOpcode(triggerCatalog, opcodeIndex, label) {
  return (triggerCatalog.opcodeUsage || []).find(item =>
    Number(item.opcodeIndex) === opcodeIndex || item.dispatchTargetLabel === label
  ) || {
    opcodeIndex,
    dispatchTargetLabel: label,
    recordCount: 0,
    triggerTableCount: 0,
    rawOpcodeCounts: {},
    destinationDescriptorCount: 0,
    destinationDescriptorSample: [],
  };
}

function buildLineChecks(lines) {
  return {
    triggerDispatchMask: expectLine(lines, 11092, 'and $1F'),
    triggerDispatchCall: expectLine(lines, 11093, 'rst $20'),
    triggerTable: expectLine(lines, 11095, '_DATA_48C5_:'),
    triggerTableRow0: expectLine(lines, 11096, '.dw _LABEL_4903_ _LABEL_492B_ _LABEL_492B_ _LABEL_492B_ _LABEL_492B_ _LABEL_492B_ _LABEL_4942_ _LABEL_4961_'),
    triggerTableRow1: expectLine(lines, 11097, '.dw _LABEL_497A_ _LABEL_4980_ _LABEL_4980_ _LABEL_4988_ _LABEL_4988_ _LABEL_492B_ _LABEL_492B_ _LABEL_492B_'),
    triggerTableRow2: expectLine(lines, 11098, '.dw _LABEL_4995_ _LABEL_49A9_ _LABEL_49AF_ _LABEL_49D4_ _LABEL_49DD_ _LABEL_49E6_ _LABEL_4903_ _LABEL_4903_'),
    label497a: expectLine(lines, 11164, '_LABEL_497A_:'),
    loadCf6aOne: expectLine(lines, 11165, 'ld a, $01'),
    writeCf6aOne: expectLine(lines, 11166, 'ld (_RAM_CF6A_), a'),
    label49a9: expectLine(lines, 11199, '_LABEL_49A9_:'),
    loadCf6aThree: expectLine(lines, 11200, 'ld a, $03'),
    writeCf6aThree: expectLine(lines, 11201, 'ld (_RAM_CF6A_), a'),
    loadCf6aTwo: expectLine(lines, 11791, 'ld a, $02'),
    writeCf6aTwo: expectLine(lines, 11792, 'ld (_RAM_CF6A_), a'),
    bank2Dispatcher: expectLine(lines, 20043, '_LABEL_B3C0_:'),
    bank2DispatchRead: expectLine(lines, 20044, 'ld a, (_RAM_CF6A_)'),
    bank2DispatchClear: expectLine(lines, 20049, 'ld (_RAM_CF6A_), a'),
    bank2Table: expectLine(lines, 20054, '_DATA_B3CD_:'),
    bank2TableEntries: expectLine(lines, 20055, '.dw _LABEL_B3D3_ _LABEL_B44F_ _LABEL_B6B0_'),
    labelB3d3: expectLine(lines, 20058, '_LABEL_B3D3_:'),
    b3d3RoomLoad: expectLine(lines, 20100, 'call _LABEL_2620_'),
    labelB44f: expectLine(lines, 20107, '_LABEL_B44F_:'),
    b44fFirstRoomLoad: expectLine(lines, 20114, 'call _LABEL_2620_'),
    b44fSecondRoomLoad: expectLine(lines, 20134, 'call _LABEL_2620_'),
    labelB6b0: expectLine(lines, 20388, '_LABEL_B6B0_:'),
  };
}

function producerRecord(id, requestId, label, opcodeIndex, usage, records, lineChecks, producerKind) {
  return {
    id,
    requestId,
    requestIdHex: hex(requestId, 2),
    producerKind,
    producerLabel: label,
    triggerOpcodeIndex: opcodeIndex,
    triggerOpcodeIndexHex: opcodeIndex == null ? null : hex(opcodeIndex, 2),
    triggerRecordCount: records.length,
    triggerTableCount: usage ? Number(usage.triggerTableCount || 0) : 0,
    rawOpcodeCounts: usage?.rawOpcodeCounts || {},
    destinationDescriptorCount: usage ? Number(usage.destinationDescriptorCount || 0) : 0,
    samples: records.slice(0, 12).map(compactTriggerRecord),
    lineChecks,
  };
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const triggerCatalog = catalogById(mapData, 'world-zone-trigger-record-catalog-2026-06-25');
  const roleCatalog = catalogById(mapData, 'world-zone-trigger-destination-role-catalog-2026-06-25');
  const pointerFlowCatalog = catalogById(mapData, 'world-zone-descriptor-pointer-flow-catalog-2026-06-25');
  const selectorResolutionCatalog = catalogById(mapData, 'world-room-loader-audio-selector-resolution-catalog-2026-06-25');
  if (!triggerCatalog) throw new Error('Missing world-zone-trigger-record-catalog-2026-06-25');
  if (!roleCatalog) throw new Error('Missing world-zone-trigger-destination-role-catalog-2026-06-25');

  const roleRecords = roleCatalog.recordRoles || [];
  const cf6aOneRecords = roleRecords.filter(record => record.triggerDispatchTarget === '_LABEL_497A_');
  const cf6aThreeRecords = roleRecords.filter(record => record.triggerDispatchTarget === '_LABEL_49A9_');
  const formStageRecords = roleRecords.filter(record => record.role === 'form_stage_transition_record');
  const usage8 = usageForOpcode(triggerCatalog, 8, '_LABEL_497A_');
  const usage17 = usageForOpcode(triggerCatalog, 17, '_LABEL_49A9_');

  const producers = [
    producerRecord(
      'cf6a_request_1_trigger_handler_497a',
      1,
      '_LABEL_497A_',
      8,
      usage8,
      cf6aOneRecords,
      [lineChecks.triggerTableRow1, lineChecks.label497a, lineChecks.loadCf6aOne, lineChecks.writeCf6aOne],
      'room_trigger_dispatch_table'
    ),
    {
      id: 'cf6a_request_2_form_stage_handler_4e49',
      requestId: 2,
      requestIdHex: '0x02',
      producerKind: 'room_transition_form_stage_handler',
      producerLabel: '_LABEL_4E49_',
      triggerOpcodeIndex: 15,
      triggerOpcodeIndexHex: '0x0F',
      triggerRecordCount: formStageRecords.length,
      triggerTableCount: new Set(formStageRecords.map(record => record.triggerTableId)).size,
      rawOpcodeCounts: countBy(formStageRecords, record => record.rawOpcode || 'unknown'),
      destinationDescriptorCount: new Set(formStageRecords.map(record => record.destination?.descriptorId).filter(Boolean)).size,
      samples: formStageRecords.slice(0, 12).map(compactTriggerRecord),
      lineChecks: [lineChecks.loadCf6aTwo, lineChecks.writeCf6aTwo],
    },
    producerRecord(
      'cf6a_request_3_trigger_handler_49a9',
      3,
      '_LABEL_49A9_',
      17,
      usage17,
      cf6aThreeRecords,
      [lineChecks.triggerTableRow2, lineChecks.label49a9, lineChecks.loadCf6aThree, lineChecks.writeCf6aThree],
      'room_trigger_dispatch_table'
    ),
  ];

  const bank2Dispatch = [
    {
      requestId: 1,
      requestIdHex: '0x01',
      tableIndex: 0,
      targetLabel: '_LABEL_B3D3_',
      targetKind: 'new_game_bootstrap_room_load_with_local_common_prereq',
      producerRecordCount: cf6aOneRecords.length,
      producerStatus: cf6aOneRecords.length === 0
        ? 'no_cataloged_room_trigger_records_select_cf6a_1'
        : 'cataloged_room_trigger_records_select_cf6a_1',
      roomLoadCallLines: [20100],
      selectorResolutionStatus: 'prior_audio_selector_still_unresolved',
      lineChecks: [lineChecks.bank2TableEntries, lineChecks.labelB3d3, lineChecks.b3d3RoomLoad],
    },
    {
      requestId: 2,
      requestIdHex: '0x02',
      tableIndex: 1,
      targetLabel: '_LABEL_B44F_',
      targetKind: 'bank2_transition_room_sequence_via_c26c',
      producerRecordCount: formStageRecords.length,
      producerStatus: 'cataloged_form_stage_records_queue_cf6a_2',
      roomLoadCallLines: [20114, 20134],
      selectorResolutionStatus: 'cataloged_form_stage_suppressed_then_replayed',
      lineChecks: [lineChecks.bank2TableEntries, lineChecks.labelB44f, lineChecks.b44fFirstRoomLoad, lineChecks.b44fSecondRoomLoad],
    },
    {
      requestId: 3,
      requestIdHex: '0x03',
      tableIndex: 2,
      targetLabel: '_LABEL_B6B0_',
      targetKind: 'bank2_form_transition_setup_request',
      producerRecordCount: cf6aThreeRecords.length,
      producerStatus: 'cataloged_trigger_records_select_cf6a_3',
      roomLoadCallLines: [],
      selectorResolutionStatus: 'no_direct_room_loader_call',
      lineChecks: [lineChecks.bank2TableEntries, lineChecks.labelB6b0],
    },
  ];

  const evidence = [
    'ASM lines 11092-11098 mask trigger opcodes with $1F and dispatch through _DATA_48C5_; entry 8 targets _LABEL_497A_ and entry 17 targets _LABEL_49A9_.',
    'ASM lines 11164-11167 prove _LABEL_497A_ writes _RAM_CF6A_=1; the zone trigger record catalog contains zero opcode-index-8 records selecting that handler.',
    'ASM lines 11199-11202 prove _LABEL_49A9_ writes _RAM_CF6A_=3; the zone trigger record catalog contains six opcode-index-17 records selecting that handler.',
    'ASM lines 11791-11792 prove _LABEL_4E49_ writes _RAM_CF6A_=2 for cataloged form-stage transition records.',
    'ASM lines 20043-20055 prove _LABEL_B3C0_ dispatches _RAM_CF6A_ through _DATA_B3CD_ to _LABEL_B3D3_, _LABEL_B44F_, or _LABEL_B6B0_.',
    'This audit stores labels, line numbers, opcode indexes, counts, region/RAM ids, descriptor ids, and evidence only; no ROM bytes, decoded assets, pixels, or audio data are embedded.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))])),
    assetPolicy: 'Metadata only: ASM labels, line numbers, opcode indexes, request ids, trigger record counts, descriptor ids, region ids, RAM ids, and evidence. No ROM bytes, decoded rooms, graphics, palettes, music streams, audio samples, text, pixels, or hashes are embedded.',
    dispatchRam: {
      label: '_RAM_CF6A_',
      address: '$CF6A',
      bank2DispatchTable: '_DATA_B3CD_',
    },
    producerTable: {
      label: '_DATA_48C5_',
      opcodeMask: '0x1F',
      relevantEntries: [
        { opcodeIndex: 8, targetLabel: '_LABEL_497A_', requestId: 1 },
        { opcodeIndex: 17, targetLabel: '_LABEL_49A9_', requestId: 3 },
      ],
      lineChecks: [
        lineChecks.triggerDispatchMask,
        lineChecks.triggerDispatchCall,
        lineChecks.triggerTable,
        lineChecks.triggerTableRow0,
        lineChecks.triggerTableRow1,
        lineChecks.triggerTableRow2,
      ],
    },
    producers,
    bank2Dispatch,
    pointerFlowCatalogRef: pointerFlowCatalog ? {
      id: pointerFlowCatalog.id,
      summary: pointerFlowCatalog.summary || null,
    } : null,
    selectorResolutionCatalogRef: selectorResolutionCatalog ? {
      id: selectorResolutionCatalog.id,
      remainingUnresolvedCallsiteCount: selectorResolutionCatalog.summary?.remainingUnresolvedCallsiteCount ?? null,
    } : null,
    summary: {
      status: 'cf6a_bank2_dispatch_producers_cataloged',
      confidence: 'high_for_cataloged_room_trigger_records_medium_for_global_runtime',
      producerCount: producers.length,
      bank2DispatchEntryCount: bank2Dispatch.length,
      cf6aRequest1CatalogedTriggerRecordCount: cf6aOneRecords.length,
      cf6aRequest2FormStageRecordCount: formStageRecords.length,
      cf6aRequest3CatalogedTriggerRecordCount: cf6aThreeRecords.length,
      b3d3ProducerStatus: bank2Dispatch[0].producerStatus,
      b3d3AudioSelectorStatus: bank2Dispatch[0].selectorResolutionStatus,
      triggerOpcode8PresentInCatalog: cf6aOneRecords.length > 0,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Search non-room state machines for writes that can reach _RAM_CF6A_=1, since cataloged room trigger records do not select _LABEL_497A_.',
      'Trace whether _LABEL_B3D3_ is only reached from startup/new-game state or from an uncataloged trigger stream outside the room descriptor tables.',
      'Connect _RAM_CF6A_=3 records to _LABEL_B6B0_ form-transition setup and downstream player form/state RAM.',
    ],
  };
}

function annotateRegion(region, value, annotatedRegions) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis.cf6aDispatchProducerAudit = value;
  annotatedRegions.push(compactRegion(region));
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  annotateRegion(containingRegion(mapData, 0x0497A), {
    catalogId,
    kind: 'cf6a_request_1_producer_handler',
    confidence: 'high_for_handler_semantics_medium_for_catalog_absence',
    requestId: 1,
    requestIdHex: '0x01',
    catalogedTriggerRecordCount: catalog.summary.cf6aRequest1CatalogedTriggerRecordCount,
    summary: '_LABEL_497A_ writes _RAM_CF6A_=1, but no cataloged room trigger record currently selects opcode index 8 / _LABEL_497A_.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);
  annotateRegion(containingRegion(mapData, 0x049A9), {
    catalogId,
    kind: 'cf6a_request_3_producer_handler',
    confidence: 'high',
    requestId: 3,
    requestIdHex: '0x03',
    catalogedTriggerRecordCount: catalog.summary.cf6aRequest3CatalogedTriggerRecordCount,
    summary: '_LABEL_49A9_ writes _RAM_CF6A_=3 and is selected by six cataloged room trigger records.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);
  annotateRegion(containingRegion(mapData, 0x04E49), {
    catalogId,
    kind: 'cf6a_request_2_form_stage_producer',
    confidence: 'high',
    requestId: 2,
    requestIdHex: '0x02',
    catalogedFormStageRecordCount: catalog.summary.cf6aRequest2FormStageRecordCount,
    summary: '_LABEL_4E49_ writes _RAM_CF6A_=2 for cataloged form-stage transition records, feeding the _LABEL_B44F_ bank-2 room sequence.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);
  annotateRegion(containingRegion(mapData, 0x0B3C0), {
    catalogId,
    kind: 'cf6a_bank2_dispatcher',
    confidence: 'high',
    bank2Dispatch: catalog.bank2Dispatch.map(entry => ({
      requestId: entry.requestId,
      requestIdHex: entry.requestIdHex,
      targetLabel: entry.targetLabel,
      producerStatus: entry.producerStatus,
      producerRecordCount: entry.producerRecordCount,
      selectorResolutionStatus: entry.selectorResolutionStatus,
    })),
    summary: '_LABEL_B3C0_ dispatches _RAM_CF6A_ requests through _DATA_B3CD_; request 1 reaches _LABEL_B3D3_ but has no cataloged room-trigger producer records.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);
  annotateRegion(containingRegion(mapData, 0x0B3D3), {
    catalogId,
    kind: 'b3d3_cf6a_request_1_consumer',
    confidence: 'medium',
    producerStatus: catalog.summary.b3d3ProducerStatus,
    audioSelectorStatus: catalog.summary.b3d3AudioSelectorStatus,
    summary: '_LABEL_B3D3_ is the _RAM_CF6A_=1 consumer; no cataloged room trigger records currently produce that request, so its _RAM_C26E_ prior state remains a non-room/global-runtime trace lead.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  const cf6a = findRam(mapData, '$CF6A');
  if (cf6a) {
    cf6a.analysis = cf6a.analysis || {};
    cf6a.analysis.cf6aDispatchProducerAudit = {
      catalogId,
      kind: 'bank2_transition_request_byte',
      confidence: 'high_for_cataloged_producers',
      producerCounts: {
        request1: catalog.summary.cf6aRequest1CatalogedTriggerRecordCount,
        request2: catalog.summary.cf6aRequest2FormStageRecordCount,
        request3: catalog.summary.cf6aRequest3CatalogedTriggerRecordCount,
      },
      summary: '_RAM_CF6A_ request producers are now cataloged: request 1 has no cataloged room-trigger producers, request 2 is form-stage, and request 3 has six trigger records.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRam.push(compactRam(cf6a));
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
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'cf6a_dispatch_producer_audit',
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
      dispatchRam: catalog.dispatchRam,
      producerTable: catalog.producerTable,
      bank2Dispatch: catalog.bank2Dispatch,
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
    bank2Dispatch: catalog.bank2Dispatch.map(entry => ({
      requestId: entry.requestId,
      targetLabel: entry.targetLabel,
      producerStatus: entry.producerStatus,
      producerRecordCount: entry.producerRecordCount,
    })),
  }, null, 2));
}

main();
