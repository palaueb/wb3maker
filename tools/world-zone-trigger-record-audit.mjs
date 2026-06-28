#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-zone-trigger-record-catalog-2026-06-25';
const reportId = 'zone-trigger-record-audit-2026-06-25';
const toolName = 'tools/world-zone-trigger-record-audit.mjs';

const zoneGraphId = 'world-zone-graph-2026-06-24';
const pointerFlowCatalogId = 'world-zone-descriptor-pointer-flow-catalog-2026-06-25';
const uiTriggerCatalogId = 'world-ui-trigger-routine-catalog-2026-06-25';
const zoneRecipeCatalogId = 'world-zone-recipe-catalog-2026-06-25';

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function ramRef(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 1,
    type: entry.type || 'byte',
    name: entry.name || '',
  };
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function findRamByAddress(mapData, address) {
  return (mapData.ram || []).find(entry =>
    String(entry.address || '').toUpperCase() === String(address || '').toUpperCase()
  ) || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function collectLabels(asmText) {
  const labels = new Map();
  const lines = asmText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_(?:LABEL|DATA)_[0-9A-F]+_):/.exec(lines[i]);
    if (match) labels.set(match[1], i + 1);
  }
  return labels;
}

function inBank4Z80(z80) {
  return z80 >= 0x8000 && z80 < 0xC000;
}

function bank4Z80ToRom(z80) {
  return z80 + 0x8000;
}

function normalizeDescriptorId(offsetText) {
  return 'zone_' + offsetText.replace(/^0x/i, '').toUpperCase();
}

function triggerTableId(offsetText) {
  return 'trigger_table_' + offsetText.replace(/^0x/i, '').toUpperCase();
}

function parseByteHex(text) {
  return parseInt(String(text || '0').replace(/^0x/i, ''), 16);
}

function dispatchByOpcode(pointerFlowCatalog) {
  const table = (pointerFlowCatalog?.dispatchTables || []).find(item => item.label === '_DATA_48C5_');
  const byOpcode = new Map();
  for (const entry of table?.entries || []) byOpcode.set(entry.index, entry);
  return byOpcode;
}

function parseTriggerRecords(rom, tableOffset, descriptorByOffset, dispatchMap) {
  const records = [];
  const warnings = [];
  let off = tableOffset;
  let terminatorOffset = null;

  for (let index = 0; index < 96 && off < rom.length; index++) {
    if (rom[off] === 0xFF) {
      terminatorOffset = off;
      break;
    }
    if (off + 6 >= rom.length) {
      warnings.push(`record ${index} truncated at ${hex(off)}`);
      break;
    }

    const xUnit = rom[off];
    const yAnchor = rom[off + 1];
    const xSpanUnits = rom[off + 2];
    const ySpan = rom[off + 3];
    const rawOpcode = rom[off + 4];
    const opcodeIndex = rawOpcode & 0x1F;
    const destinationZ80 = rom[off + 5] | (rom[off + 6] << 8);
    const destinationRomOffset = inBank4Z80(destinationZ80) ? bank4Z80ToRom(destinationZ80) : null;
    const destinationOffsetText = destinationRomOffset == null ? null : hex(destinationRomOffset);
    const destinationDescriptor = destinationOffsetText ? descriptorByOffset.get(destinationOffsetText) || null : null;
    const dispatch = dispatchMap.get(opcodeIndex) || null;
    if (!inBank4Z80(destinationZ80)) warnings.push(`record ${index} destination outside bank 4 Z80 window: ${hex(destinationZ80, 4)}`);

    records.push({
      index,
      entryOffset: hex(off),
      format: 'room_trigger_record_7_bytes',
      geometry: {
        xUnit,
        xPixelsLeft: xUnit * 8,
        xSpanUnits,
        xSpanPixels: xSpanUnits * 8,
        yAnchor,
        ySpan,
        yAcceptedRange: {
          minInclusive: Math.max(0, yAnchor - ySpan),
          maxInclusive: yAnchor,
        },
      },
      opcode: {
        raw: hex(rawOpcode, 2),
        index: opcodeIndex,
        bit7Set: Boolean(rawOpcode & 0x80),
        bit6Set: Boolean(rawOpcode & 0x40),
        c27dGate: rawOpcode === 0x06 || rawOpcode === 0x07 ? 'bypassed_by_raw_opcode' : 'requires__RAM_C27D__zero',
        dispatchTargetLabel: dispatch?.targetLabel || null,
        dispatchTargetOffset: dispatch?.targetOffset || null,
        classification: dispatch?.classification || null,
      },
      destination: {
        z80Pointer: hex(destinationZ80, 4),
        romOffset: destinationOffsetText,
        descriptorId: destinationDescriptor?.id || (destinationOffsetText ? normalizeDescriptorId(destinationOffsetText) : null),
        inZoneGraph: Boolean(destinationDescriptor),
        pointerRole: destinationDescriptor ? 'zone_descriptor' : 'bank4_pointer_not_in_zone_graph',
      },
    });
    off += 7;
  }

  if (terminatorOffset == null) warnings.push(`trigger table did not terminate within 96 records from ${hex(tableOffset)}`);
  return {
    records,
    terminatorOffset: terminatorOffset == null ? null : hex(terminatorOffset),
    warnings,
  };
}

function compareWithGraphRecord(record, graphEntry) {
  const mismatches = [];
  if (!graphEntry) {
    mismatches.push('missing graph doorTable entry');
    return mismatches;
  }
  if (graphEntry.entryOffset !== record.entryOffset) mismatches.push('entryOffset');
  if (graphEntry.scrollPositionPixels !== record.geometry.xPixelsLeft) mismatches.push('scrollPositionPixels');
  if (parseByteHex(graphEntry.parameter) !== record.geometry.yAnchor) mismatches.push('parameter/yAnchor');
  const expectedThreshold = record.geometry.xSpanUnits | (record.geometry.ySpan << 8);
  if (parseByteHex(graphEntry.threshold) !== expectedThreshold) mismatches.push('threshold/span');
  if (parseByteHex(graphEntry.rawTypeByte) !== parseByteHex(record.opcode.raw)) mismatches.push('rawTypeByte/opcode');
  if (graphEntry.roomType !== record.opcode.index) mismatches.push('roomType/opcodeIndex');
  if (graphEntry.destinationZ80 !== record.destination.z80Pointer) mismatches.push('destinationZ80');
  if (graphEntry.destinationRomOffset !== record.destination.romOffset) mismatches.push('destinationRomOffset');
  return mismatches;
}

function buildTriggerTables(rom, mapData, graph, dispatchMap) {
  const descriptorByOffset = new Map((graph.descriptors || []).map(descriptor => [descriptor.descriptorOffset, descriptor]));
  const descriptorsByTableOffset = new Map();
  for (const descriptor of graph.descriptors || []) {
    const tableOffset = descriptor.subrecord?.doorTableRomOffset;
    if (!tableOffset) continue;
    const list = descriptorsByTableOffset.get(tableOffset) || [];
    list.push(descriptor);
    descriptorsByTableOffset.set(tableOffset, list);
  }

  const tables = [];
  const descriptorLinks = [];
  const mismatchSamples = [];

  for (const [tableOffsetText, descriptors] of [...descriptorsByTableOffset.entries()].sort((a, b) => parseInt(a[0], 16) - parseInt(b[0], 16))) {
    const parsed = parseTriggerRecords(rom, parseInt(tableOffsetText, 16), descriptorByOffset, dispatchMap);
    const graphEntries = descriptors[0]?.doorTable?.entries || [];
    const graphWarnings = descriptors.flatMap(descriptor => descriptor.doorTable?.warnings || []);
    const tableMismatches = [];
    for (const record of parsed.records) {
      const mismatches = compareWithGraphRecord(record, graphEntries[record.index]);
      if (!mismatches.length) continue;
      const sample = {
        tableOffset: tableOffsetText,
        recordIndex: record.index,
        entryOffset: record.entryOffset,
        mismatches,
      };
      tableMismatches.push(sample);
      if (mismatchSamples.length < 20) mismatchSamples.push(sample);
    }
    if (graphEntries.length !== parsed.records.length) {
      const sample = {
        tableOffset: tableOffsetText,
        recordIndex: null,
        entryOffset: tableOffsetText,
        mismatches: [`graph entry count ${graphEntries.length} != parsed record count ${parsed.records.length}`],
      };
      tableMismatches.push(sample);
      if (mismatchSamples.length < 20) mismatchSamples.push(sample);
    }

    const opcodeIndices = [...new Set(parsed.records.map(record => record.opcode.index))].sort((a, b) => a - b);
    const destinationDescriptorIds = [...new Set(parsed.records.map(record => record.destination.descriptorId).filter(Boolean))].sort();
    const descriptorRefs = descriptors.map(descriptor => ({
      descriptorId: descriptor.id,
      descriptorOffset: descriptor.descriptorOffset,
      subrecordOffset: descriptor.subrecord?.romOffset || null,
      recipeId: 'zone_recipe_' + descriptor.descriptorOffset.replace(/^0x/i, '').toUpperCase(),
    }));

    const table = {
      id: triggerTableId(tableOffsetText),
      z80Pointer: descriptors[0]?.subrecord?.doorTableZ80 || null,
      romOffset: tableOffsetText,
      region: regionRef(findContainingRegion(mapData, parseInt(tableOffsetText, 16))),
      recordFormat: 'room_trigger_record_7_bytes_ff_terminated',
      recordCount: parsed.records.length,
      descriptorExpandedRecordCount: parsed.records.length * descriptors.length,
      terminatorOffset: parsed.terminatorOffset,
      usedByDescriptorCount: descriptors.length,
      usedByDescriptors: descriptorRefs,
      opcodeIndices,
      destinationDescriptorCount: destinationDescriptorIds.length,
      destinationDescriptorIds,
      records: parsed.records,
      graphComparison: {
        comparedWithZoneGraphId: zoneGraphId,
        sourceField: 'descriptor.doorTable.entries',
        mismatchCount: tableMismatches.length,
        graphWarningCount: graphWarnings.length,
        warnings: [...new Set([...parsed.warnings, ...graphWarnings])],
      },
    };
    tables.push(table);

    for (const descriptor of descriptors) {
      descriptorLinks.push({
        descriptorId: descriptor.id,
        descriptorOffset: descriptor.descriptorOffset,
        triggerTableId: table.id,
        triggerTableOffset: tableOffsetText,
        recordCount: table.recordCount,
        opcodeIndices,
        destinationDescriptorCount: table.destinationDescriptorCount,
      });
    }
  }

  return { tables, descriptorLinks, mismatchSamples };
}

function buildOpcodeUsage(tables, dispatchMap) {
  const byOpcode = new Map();
  for (const table of tables) {
    const tableRecordOffsets = new Set();
    for (const record of table.records) {
      const opcode = record.opcode.index;
      const entry = byOpcode.get(opcode) || {
        opcodeIndex: opcode,
        dispatchTargetLabel: dispatchMap.get(opcode)?.targetLabel || null,
        dispatchTargetOffset: dispatchMap.get(opcode)?.targetOffset || null,
        classification: dispatchMap.get(opcode)?.classification || null,
        recordCount: 0,
        rawOpcodeCounts: {},
        triggerTableCount: 0,
        destinationDescriptorCount: 0,
        destinationDescriptorIds: new Set(),
      };
      entry.recordCount++;
      entry.rawOpcodeCounts[record.opcode.raw] = (entry.rawOpcodeCounts[record.opcode.raw] || 0) + 1;
      if (!tableRecordOffsets.has(opcode)) {
        tableRecordOffsets.add(opcode);
        entry.triggerTableCount++;
      }
      if (record.destination.descriptorId) entry.destinationDescriptorIds.add(record.destination.descriptorId);
      byOpcode.set(opcode, entry);
    }
  }

  return [...byOpcode.values()]
    .sort((a, b) => a.opcodeIndex - b.opcodeIndex)
    .map(entry => ({
      opcodeIndex: entry.opcodeIndex,
      dispatchTargetLabel: entry.dispatchTargetLabel,
      dispatchTargetOffset: entry.dispatchTargetOffset,
      classification: entry.classification,
      recordCount: entry.recordCount,
      triggerTableCount: entry.triggerTableCount,
      rawOpcodeCounts: Object.fromEntries(Object.entries(entry.rawOpcodeCounts).sort((a, b) => parseByteHex(a[0]) - parseByteHex(b[0]))),
      destinationDescriptorCount: entry.destinationDescriptorIds.size,
      destinationDescriptorSample: [...entry.destinationDescriptorIds].sort().slice(0, 16),
    }));
}

function buildRegionUsage(tables) {
  const byRegion = new Map();
  for (const table of tables) {
    const id = table.region?.id || 'unmapped';
    const entry = byRegion.get(id) || {
      region: table.region,
      triggerTableCount: 0,
      recordCount: 0,
      descriptorExpandedRecordCount: 0,
      descriptorUseCount: 0,
      tableOffsets: [],
      opcodeIndices: new Set(),
    };
    entry.triggerTableCount++;
    entry.recordCount += table.recordCount;
    entry.descriptorExpandedRecordCount += table.descriptorExpandedRecordCount;
    entry.descriptorUseCount += table.usedByDescriptorCount;
    entry.tableOffsets.push(table.romOffset);
    for (const opcode of table.opcodeIndices) entry.opcodeIndices.add(opcode);
    byRegion.set(id, entry);
  }
  return [...byRegion.values()]
    .sort((a, b) => (a.region?.offset || '').localeCompare(b.region?.offset || ''))
    .map(entry => ({
      region: entry.region,
      triggerTableCount: entry.triggerTableCount,
      recordCount: entry.recordCount,
      descriptorExpandedRecordCount: entry.descriptorExpandedRecordCount,
      descriptorUseCount: entry.descriptorUseCount,
      tableOffsets: entry.tableOffsets,
      opcodeIndices: [...entry.opcodeIndices].sort((a, b) => a - b),
    }));
}

function buildCatalog(mapData, rom, asmText) {
  const graph = (mapData.zoneGraphs || []).find(item => item.id === zoneGraphId);
  if (!graph) throw new Error(`Missing zone graph ${zoneGraphId}`);
  const labels = collectLabels(asmText);
  const pointerFlowCatalog = findCatalog(mapData, pointerFlowCatalogId);
  const uiTriggerCatalog = findCatalog(mapData, uiTriggerCatalogId);
  const dispatchMap = dispatchByOpcode(pointerFlowCatalog);
  const { tables, descriptorLinks, mismatchSamples } = buildTriggerTables(rom, mapData, graph, dispatchMap);
  const opcodeUsage = buildOpcodeUsage(tables, dispatchMap);
  const regionUsage = buildRegionUsage(tables);
  const warningCount = tables.reduce((sum, table) => sum + table.graphComparison.warnings.length, 0);
  const mismatchCount = tables.reduce((sum, table) => sum + table.graphComparison.mismatchCount, 0);
  const recordCount = tables.reduce((sum, table) => sum + table.recordCount, 0);
  const descriptorExpandedRecordCount = tables.reduce((sum, table) => sum + table.descriptorExpandedRecordCount, 0);
  const destinationValidCount = tables.reduce((sum, table) => (
    sum + table.records.filter(record => record.destination.inZoneGraph).length
  ), 0);
  const gatedRecordCount = tables.reduce((sum, table) => (
    sum + table.records.filter(record => record.opcode.c27dGate === 'requires__RAM_C27D__zero').length
  ), 0);
  const c27dBypassCount = recordCount - gatedRecordCount;

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [zoneGraphId, pointerFlowCatalogId, uiTriggerCatalogId, zoneRecipeCatalogId],
    sourceCatalogPresence: {
      [zoneGraphId]: Boolean(graph),
      [pointerFlowCatalogId]: Boolean(pointerFlowCatalog),
      [uiTriggerCatalogId]: Boolean(uiTriggerCatalog),
      [zoneRecipeCatalogId]: Boolean(findCatalog(mapData, zoneRecipeCatalogId)),
    },
    recordFormat: {
      name: 'room_trigger_record_7_bytes_ff_terminated',
      byteLayout: [
        { offset: 0, field: 'xUnit', semantics: 'left X position in 8-pixel units; _LABEL_4816_ shifts this value left by 3 into _RAM_D0DE_' },
        { offset: 1, field: 'yAnchor', semantics: 'Y anchor byte stored in _RAM_D0E0_ and compared with player Y _RAM_C246_' },
        { offset: 2, field: 'xSpanUnits', semantics: 'X span in 8-pixel units stored in _RAM_D0E1_' },
        { offset: 3, field: 'ySpan', semantics: 'Y span byte stored in _RAM_D0E2_' },
        { offset: 4, field: 'rawOpcode', semantics: '_LABEL_48A9_ keeps this in B, gates most opcodes on _RAM_C27D_, masks it with $1F, and dispatches via _DATA_48C5_' },
        { offset: 5, field: 'destinationPointerLo', semantics: 'low byte of bank-4 destination descriptor pointer consumed through _RAM_CFFA_ or _RAM_C26C_' },
        { offset: 6, field: 'destinationPointerHi', semantics: 'high byte of bank-4 destination descriptor pointer consumed through _RAM_CFFA_ or _RAM_C26C_' },
      ],
      terminator: '0xFF at byte +0',
      confidence: mismatchCount === 0 && warningCount === 0 ? 'high' : 'medium',
    },
    routineSemantics: {
      scanner: {
        label: '_LABEL_4816_',
        line: labels.get('_LABEL_4816_') || null,
        summary: 'Scans room trigger records from _RAM_CF5E_, computes X/Y bounds against _RAM_C243_/_RAM_C246_, and calls _LABEL_48A9_ for matched records.',
      },
      dispatcher: {
        label: '_LABEL_48A9_',
        line: labels.get('_LABEL_48A9_') || null,
        dispatchTable: '_DATA_48C5_',
        dispatchTableLine: labels.get('_DATA_48C5_') || null,
        summary: 'Consumes raw opcode plus destination pointer from the record tail, stores the pointer in _RAM_CFFA_, saves the next record pointer in _RAM_D0DE_, masks opcode with $1F, and dispatches.',
      },
      pointerSource: {
        label: '_LABEL_47FE_',
        line: labels.get('_LABEL_47FE_') || null,
        ramPointer: '_RAM_CF5E_',
        summary: 'Sets bank 4 and starts scanning at the room trigger table pointer copied into _RAM_CF5E_ by the room loader context.',
      },
    },
    summary: {
      descriptorCount: graph.descriptors?.length || 0,
      uniqueTriggerTableCount: tables.length,
      uniqueTriggerRecordCount: recordCount,
      descriptorExpandedTriggerRecordCount: descriptorExpandedRecordCount,
      zoneGraphEdgeCount: graph.summary?.edgeCount ?? null,
      triggerRecordCount: recordCount,
      descriptorLinkCount: descriptorLinks.length,
      opcodeKindCount: opcodeUsage.length,
      destinationInZoneGraphCount: destinationValidCount,
      destinationMissingFromZoneGraphCount: recordCount - destinationValidCount,
      c27dGatedRecordCount: gatedRecordCount,
      c27dBypassRecordCount: c27dBypassCount,
      graphComparisonMismatchCount: mismatchCount,
      warningCount,
      regionCount: regionUsage.filter(item => item.region).length,
      assetPolicy: 'Metadata only: offsets, field names, scalar metadata values, opcode classifications, descriptor IDs, RAM labels, and evidence. No ROM bytes, decoded graphics, maps, music, text, or rendered assets are embedded.',
    },
    opcodeUsage,
    regionUsage,
    descriptorLinks,
    triggerTables: tables,
    mismatchSamples,
    evidence: [
      '_LABEL_47FE_ loads HL from _RAM_CF5E_ in bank 4 and enters _LABEL_4816_.',
      '_LABEL_4816_ stops when record byte +0 is $FF, otherwise reads +0/+1/+2/+3 into trigger bounds temporaries and skips or dispatches the three-byte tail.',
      '_LABEL_48A9_ reads byte +4 as the raw opcode and bytes +5/+6 as a destination pointer, writes the destination to _RAM_CFFA_, masks the opcode with $1F, and dispatches through _DATA_48C5_.',
      'All parsed records are compared against existing zone graph doorTable entries; zero mismatches means the prior graph edges match the ASM-derived trigger-record format.',
    ],
  };
}

function annotateRegions(mapData, catalog) {
  const annotated = [];
  for (const usage of catalog.regionUsage) {
    if (!usage.region?.id) continue;
    const region = (mapData.regions || []).find(item => item.id === usage.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.zoneTriggerRecordAudit = {
      catalogId,
      kind: 'room_trigger_record_table_region',
      confidence: catalog.recordFormat.confidence,
      summary: `Contains ${usage.triggerTableCount} room trigger tables with ${usage.recordCount} trigger records used by ${usage.descriptorUseCount} zone descriptors.`,
      triggerTableCount: usage.triggerTableCount,
      recordCount: usage.recordCount,
      descriptorExpandedRecordCount: usage.descriptorExpandedRecordCount,
      descriptorUseCount: usage.descriptorUseCount,
      tableOffsets: usage.tableOffsets,
      opcodeIndices: usage.opcodeIndices,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      triggerTableCount: usage.triggerTableCount,
      recordCount: usage.recordCount,
    });
  }
  return annotated;
}

const ramSemantics = [
  ['$CF5E', '_RAM_CF5E_', 'Room trigger table pointer copied from the room subrecord context and scanned by _LABEL_47FE_/_LABEL_4816_.'],
  ['$D0DE', '_RAM_D0DE_', 'Temporary trigger X-left pixel word during bounds checks; later stores the next record pointer after _LABEL_48A9_ consumes the tail.'],
  ['$D0E0', '_RAM_D0E0_', 'Trigger Y anchor byte loaded from record byte +1 and compared with player Y.'],
  ['$D0E1', '_RAM_D0E1_', 'Trigger X span byte loaded from record byte +2 and shifted left by 3 during X bounds checks.'],
  ['$D0E2', '_RAM_D0E2_', 'Trigger Y span byte loaded from record byte +3 and used for Y bounds checks.'],
  ['$D0E3', '_RAM_D0E3_', 'Matched trigger overlap depth written by _LABEL_4816_ and copied by several handlers.'],
  ['$C243', '_RAM_C243_', 'Player X position word read by _LABEL_4816_ trigger bounds checks.'],
  ['$C246', '_RAM_C246_', 'Player Y position byte read by _LABEL_4816_ trigger bounds checks.'],
  ['$C27D', '_RAM_C27D_', 'Runtime gate checked by _LABEL_48A9_; raw opcodes other than $06/$07 return early when nonzero.'],
  ['$CFFA', '_RAM_CFFA_', 'Current trigger destination pointer written by _LABEL_48A9_ and consumed by immediate room-load handlers.'],
  ['$C26C', '_RAM_C26C_', 'Deferred room descriptor pointer written by trigger handlers and consumed by transition loaders.'],
  ['$C26E', '_RAM_C26E_', 'Trigger opcode/state byte stored by room trigger handlers and later dispatched by room transition logic.'],
  ['$CF6A', '_RAM_CF6A_', 'Bank-2 transition request byte set by selected trigger handlers.'],
  ['$CF6B', '_RAM_CF6B_', 'Previous transition request mirror updated when trigger scanning reaches the table terminator.'],
  ['$CFFC', '_RAM_CFFC_', 'Immediate room-load transition flag set by _LABEL_4903_ when raw trigger opcode bit 7 is set.'],
  ['$D221', '_RAM_D221_', 'Overlap depth copied from _RAM_D0E3_ by the common deferred trigger handler.'],
];

function annotateRam(mapData, catalog) {
  const annotated = [];
  for (const [address, label, summary] of ramSemantics) {
    const entry = findRamByAddress(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.zoneTriggerRecordAudit = {
      catalogId,
      kind: 'room_trigger_record_runtime_ram',
      confidence: 'high',
      label,
      summary,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: entry.id,
      address: entry.address,
      name: entry.name || '',
      label,
    });
  }
  return annotated;
}

function annotateZoneRecipes(mapData, catalog) {
  const byDescriptor = new Map(catalog.descriptorLinks.map(link => [link.descriptorId, link]));
  let count = 0;
  for (const recipe of mapData.zoneRecipes || []) {
    const link = byDescriptor.get(recipe.sourceDescriptorId);
    if (!link) continue;
    recipe.dependencies = recipe.dependencies || {};
    recipe.dependencies.triggerTable = {
      kind: 'room_trigger_table',
      catalogId,
      triggerTableId: link.triggerTableId,
      romOffset: link.triggerTableOffset,
      recordFormat: catalog.recordFormat.name,
      recordCount: link.recordCount,
      opcodeIndices: link.opcodeIndices,
      destinationDescriptorCount: link.destinationDescriptorCount,
      evidence: 'Derived from _LABEL_4816_/_LABEL_48A9_ trigger record scan and validated against zone graph doorTable entries.',
    };
    count++;
  }
  return count;
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, rom, asmText);
  let annotatedRegions = [];
  let annotatedRam = [];
  let annotatedZoneRecipes = 0;

  if (apply) {
    annotatedRegions = annotateRegions(mapData, catalog);
    annotatedRam = annotateRam(mapData, catalog);
    annotatedZoneRecipes = annotateZoneRecipes(mapData, catalog);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_trigger_record_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      sourceCatalogPresence: catalog.sourceCatalogPresence,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
        annotatedRamCount: annotatedRam.length,
        annotatedZoneRecipeCount: annotatedZoneRecipes,
      },
      recordFormat: catalog.recordFormat,
      routineSemantics: catalog.routineSemantics,
      opcodeUsage: catalog.opcodeUsage,
      regionUsage: catalog.regionUsage,
      descriptorLinkSamples: catalog.descriptorLinks.slice(0, 40),
      triggerTableSamples: catalog.triggerTables.slice(0, 20).map(table => ({
        id: table.id,
        romOffset: table.romOffset,
        recordCount: table.recordCount,
        usedByDescriptorCount: table.usedByDescriptorCount,
        opcodeIndices: table.opcodeIndices,
        destinationDescriptorCount: table.destinationDescriptorCount,
        graphComparison: table.graphComparison,
      })),
      mismatchSamples: catalog.mismatchSamples,
      annotatedRegions,
      annotatedRam,
      evidence: catalog.evidence,
      nextLeads: [
        'Use trigger-table records to name room transitions by behavior class, not only by destination descriptor.',
        'Trace _DATA_4CAD_ transition records so deferred trigger opcodes can be modeled frame-by-frame.',
        'Connect trigger opcode classes to entity/reward routines such as _LABEL_611C_ and _RAM_D1B0_ sequences.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotatedRegions.length,
      annotatedRamCount: annotatedRam.length,
      annotatedZoneRecipeCount: annotatedZoneRecipes,
    },
    opcodeUsage: catalog.opcodeUsage.map(entry => ({
      opcodeIndex: entry.opcodeIndex,
      recordCount: entry.recordCount,
      target: entry.dispatchTargetLabel,
      kind: entry.classification?.kind || null,
      rawOpcodeCounts: entry.rawOpcodeCounts,
    })),
    regionUsage: catalog.regionUsage.map(entry => ({
      region: entry.region,
      triggerTableCount: entry.triggerTableCount,
      recordCount: entry.recordCount,
      descriptorExpandedRecordCount: entry.descriptorExpandedRecordCount,
    })),
    mismatchSamples: catalog.mismatchSamples,
  }, null, 2));
}

main();
