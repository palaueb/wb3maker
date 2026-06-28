#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-dc2-scroll-map-catalog-2026-06-25';
const reportId = 'dc2-scroll-map-audit-2026-06-25';
const toolName = 'tools/world-dc2-scroll-map-audit.mjs';

const tableOffset = 0x14000;
const tableEntryCount = 176;
const tableRegionId = 'r0384';
const decoderRoutineRegionId = 'r1996';
const zoneGraphId = 'world-zone-graph-2026-06-24';
const bank5RomDelta = 0xC000;
const dc2Rows = 11;
const dc2Columns = 16;
const dc2Cells = dc2Rows * dc2Columns;

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readWord(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function findById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => parseInt(region.offset, 16) === offset) || null;
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

function pushSample(list, value, limit = 10) {
  if (list.length < limit && !list.includes(value)) list.push(value);
}

function collectDc2Usage(mapData) {
  const usageByIndex = new Map();
  const graph = (mapData.zoneGraphs || []).find(item => item.id === zoneGraphId) || null;
  for (const descriptor of graph?.descriptors || []) {
    for (const stream of descriptor.dc2Streams || []) {
      if (stream.disabled) continue;
      const index = parseInt(stream.index, 16);
      if (!Number.isFinite(index)) continue;
      const usage = usageByIndex.get(index) || {
        descriptorCount: 0,
        streamSlots: [0, 0, 0, 0, 0, 0],
        descriptorSamples: [],
      };
      usage.descriptorCount++;
      if (stream.streamIndex >= 0 && stream.streamIndex < usage.streamSlots.length) {
        usage.streamSlots[stream.streamIndex]++;
      }
      pushSample(usage.descriptorSamples, descriptor.descriptorOffset);
      usageByIndex.set(index, usage);
    }
  }
  return {
    graph,
    usageByIndex,
  };
}

function decodeDc2StreamMeta(rom, offset) {
  let pc = offset;
  let row = 0;
  let column = 0;
  let writtenCells = 0;
  let opCount = 0;
  let maxRunLength = 0;
  let endReason = 'limit';
  const warnings = [];
  const opCounts = {
    direct: 0,
    shortRun: 0,
    extendedRun: 0,
    terminator: 0,
  };

  function writeCell() {
    writtenCells++;
    column++;
    if (column >= dc2Columns) {
      column = 0;
      row++;
    }
    return row >= dc2Rows;
  }

  decodeLoop:
  while (pc < rom.length && pc - offset < 1024 && opCount < 512 && row < dc2Rows) {
    const commandOffset = pc;
    const command = rom[pc++];
    opCount++;

    if (command === 0xFF) {
      if (pc >= rom.length) {
        warnings.push(`truncated extended opcode at ${hex(commandOffset)}`);
        endReason = 'truncated';
        break;
      }
      const countOrTerminator = rom[pc++];
      if (countOrTerminator === 0xFF) {
        opCounts.terminator++;
        endReason = 'ff-ff-terminator';
        break;
      }
      if (pc >= rom.length) {
        warnings.push(`truncated extended run at ${hex(commandOffset)}`);
        endReason = 'truncated';
        break;
      }
      pc++;
      opCounts.extendedRun++;
      maxRunLength = Math.max(maxRunLength, countOrTerminator);
      for (let i = 0; i < countOrTerminator; i++) {
        if (writeCell()) {
          endReason = 'row-budget';
          break decodeLoop;
        }
      }
      continue;
    }

    if (command >= 0xE3) {
      if (pc >= rom.length) {
        warnings.push(`truncated short run at ${hex(commandOffset)}`);
        endReason = 'truncated';
        break;
      }
      pc++;
      const count = command - 0xE0;
      opCounts.shortRun++;
      maxRunLength = Math.max(maxRunLength, count);
      for (let i = 0; i < count; i++) {
        if (writeCell()) {
          endReason = 'row-budget';
          break decodeLoop;
        }
      }
      continue;
    }

    opCounts.direct++;
    if (writeCell()) {
      endReason = 'row-budget';
      break;
    }
  }

  if (pc >= rom.length && endReason === 'limit') warnings.push(`stream reached end of ROM from ${hex(offset)}`);
  if (opCount >= 512 && endReason === 'limit') warnings.push(`stream exceeded opcode limit from ${hex(offset)}`);
  if (pc - offset >= 1024 && endReason === 'limit') warnings.push(`stream exceeded byte limit from ${hex(offset)}`);
  if (writtenCells !== dc2Cells) warnings.push(`stream wrote ${writtenCells} cells, expected ${dc2Cells}`);

  return {
    runtimeConsumedBytes: pc - offset,
    writtenCells,
    rows: dc2Rows,
    columns: dc2Columns,
    endReason,
    opCount,
    opCounts,
    maxRunLength,
    finalPosition: { row, column },
    warnings,
  };
}

function buildCatalog(rom, mapData) {
  const { graph, usageByIndex } = collectDc2Usage(mapData);
  const tableRegion = findById(mapData, tableRegionId) || findExactRegion(mapData, tableOffset);
  const decoderRoutine = findById(mapData, decoderRoutineRegionId);
  const entries = [];
  const targetOffsets = new Set();
  const warningEntries = [];
  const usedIndices = [];
  const unusedIndices = [];
  let totalRuntimeConsumedBytes = 0;
  let totalDeclaredRegionBytes = 0;
  let totalTrailingBytes = 0;

  for (let index = 0; index < tableEntryCount; index++) {
    const tableEntryOffset = tableOffset + index * 2;
    const z80Pointer = readWord(rom, tableEntryOffset);
    const romOffset = z80Pointer + bank5RomDelta;
    const targetRegion = findExactRegion(mapData, romOffset);
    const decoded = decodeDc2StreamMeta(rom, romOffset);
    const declaredRegionBytes = targetRegion?.size || decoded.runtimeConsumedBytes;
    const trailingBytesBeforeNextLabel = Math.max(0, declaredRegionBytes - decoded.runtimeConsumedBytes);
    const usage = usageByIndex.get(index) || null;
    const valid = decoded.warnings.length === 0 && decoded.writtenCells === dc2Cells && decoded.endReason === 'row-budget';
    if (!valid) warningEntries.push(index);
    if (usage) usedIndices.push(index);
    else unusedIndices.push(index);
    targetOffsets.add(romOffset);
    totalRuntimeConsumedBytes += decoded.runtimeConsumedBytes;
    totalDeclaredRegionBytes += declaredRegionBytes;
    totalTrailingBytes += trailingBytesBeforeNextLabel;

    entries.push({
      index,
      indexHex: hex(index, 2),
      tableEntryOffset: hex(tableEntryOffset),
      z80Pointer: hex(z80Pointer, 4),
      romOffset: hex(romOffset),
      targetRegion: regionRef(targetRegion),
      valid,
      runtimeConsumedBytes: decoded.runtimeConsumedBytes,
      declaredRegionBytes,
      trailingBytesBeforeNextLabel,
      writtenCells: decoded.writtenCells,
      rows: decoded.rows,
      columns: decoded.columns,
      endReason: decoded.endReason,
      opCount: decoded.opCount,
      opCounts: decoded.opCounts,
      maxRunLength: decoded.maxRunLength,
      warningCount: decoded.warnings.length,
      warnings: decoded.warnings,
      usage: usage ? {
        zoneGraphId,
        descriptorCount: usage.descriptorCount,
        streamSlots: usage.streamSlots,
        descriptorSamples: usage.descriptorSamples,
      } : {
        zoneGraphId,
        descriptorCount: 0,
        streamSlots: [0, 0, 0, 0, 0, 0],
        descriptorSamples: [],
      },
    });
  }

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    bankContext: {
      pointerTableRomOffset: hex(tableOffset),
      pointerTableEntryCount: tableEntryCount,
      pointerTableEntrySizeBytes: 2,
      streamBank: 5,
      streamZ80Window: '0x8000-0xBFFF',
      streamRomFormula: 'rom = z80 + 0xC000',
    },
    decoder: {
      routine: '_LABEL_DC2_',
      routineRegion: regionRef(decoderRoutine),
      outputRam: '_RAM_CB00_',
      rowCount: dc2Rows,
      columnCount: dc2Columns,
      cellsPerStream: dc2Cells,
      tableIndexSource: 'six DC2 index bytes in each room subrecord at offsets +10..+15',
    },
    pointerTable: {
      region: regionRef(tableRegion),
      offset: hex(tableOffset),
      endInclusive: hex(tableOffset + tableEntryCount * 2 - 1),
      entryCount: tableEntryCount,
    },
    summary: {
      tableEntries: entries.length,
      uniqueStreamTargets: targetOffsets.size,
      validStreams: entries.filter(entry => entry.valid).length,
      warningStreams: warningEntries.length,
      usedByZoneGraph: usedIndices.length,
      unusedByZoneGraph: unusedIndices.length,
      totalRuntimeConsumedBytes,
      totalDeclaredRegionBytes,
      totalTrailingBytesBeforeNextLabel: totalTrailingBytes,
      zoneGraphDescriptorCount: graph?.summary?.descriptorCount || 0,
      assetPolicy: 'Metadata only: offsets, pointers, counts, stream dimensions, usage counts, and evidence. No ROM bytes, decoded scroll-map cells, graphics, or rendered assets are embedded.',
    },
    usage: {
      zoneGraphId,
      usedIndices: usedIndices.map(index => hex(index, 2)),
      unusedIndices: unusedIndices.map(index => hex(index, 2)),
      topUsedIndices: entries
        .filter(entry => entry.usage.descriptorCount > 0)
        .sort((a, b) => b.usage.descriptorCount - a.usage.descriptorCount || a.index - b.index)
        .slice(0, 20)
        .map(entry => ({
          index: entry.indexHex,
          romOffset: entry.romOffset,
          descriptorCount: entry.usage.descriptorCount,
          streamSlots: entry.usage.streamSlots,
          descriptorSamples: entry.usage.descriptorSamples,
        })),
    },
    entries,
    evidence: [
      'ASM lines 2882-2914: _LABEL_DC2_ copies six room-subrecord bytes, switches to bank 5, indexes _DATA_14000_ by byte*2, and reads a bank-5 pointer with RST $18.',
      'ASM lines 2930-2994: the decoder expands each stream into an 11-row by 16-column scratch map under _RAM_CB00_, with direct bytes, E3-FE short runs, and FF-count-value extended runs.',
      'ASM lines 6479-6484: _LABEL_26F4_ resumes after the room 8FB loader and calls _LABEL_DC2_ on the six DC2 index bytes from the room subrecord.',
      `Zone graph ${zoneGraphId} supplies descriptor usage counts for DC2 table entries.`,
    ],
  };
}

function annotateTableRegion(mapData, catalog) {
  const region = findById(mapData, tableRegionId) || findExactRegion(mapData, tableOffset);
  if (!region) return null;
  const before = regionRef(region);
  region.type = region.type || 'pointer_table';
  region.name = '_DATA_14000_ DC2 scroll-map pointer table';
  region.confidence = 'high';
  region.notes = '176 bank-5 pointers indexed by _LABEL_DC2_ from room subrecord DC2 bytes; targets are compressed 11x16 scroll-map streams.';
  region.analysis = region.analysis || {};
  region.analysis.dc2ScrollMapAudit = {
    catalogId,
    kind: 'dc2_scroll_map_pointer_table',
    confidence: 'high',
    entryCount: tableEntryCount,
    targetCount: catalog.summary.uniqueStreamTargets,
    usedByZoneGraph: catalog.summary.usedByZoneGraph,
    unusedByZoneGraph: catalog.summary.unusedByZoneGraph,
    summary: 'Pointer table used by _LABEL_DC2_ to select compressed scroll-map streams for room rendering.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return { before, after: regionRef(region) };
}

function annotateDecoderRoutine(mapData, catalog) {
  const region = findById(mapData, decoderRoutineRegionId);
  if (!region) return null;
  const before = regionRef(region);
  region.name = region.name || '_LABEL_DC2_ scroll map decompressor';
  region.analysis = region.analysis || {};
  region.analysis.dc2ScrollMapAudit = {
    catalogId,
    kind: 'dc2_scroll_map_decompressor',
    confidence: 'high',
    outputRam: catalog.decoder.outputRam,
    rowCount: dc2Rows,
    columnCount: dc2Columns,
    pointerTable: hex(tableOffset),
    summary: '_LABEL_DC2_ decodes six indexed compressed scroll-map streams into _RAM_CB00_ for room rendering.',
    evidence: catalog.evidence.slice(0, 3),
    generatedAt: now,
    tool: toolName,
  };
  return { before, after: regionRef(region) };
}

function annotateTargetRegions(mapData, catalog) {
  const annotated = [];
  const missing = [];
  for (const entry of catalog.entries) {
    const region = findExactRegion(mapData, parseInt(entry.romOffset, 16));
    if (!region) {
      missing.push({
        index: entry.indexHex,
        romOffset: entry.romOffset,
      });
      continue;
    }
    const before = regionRef(region);
    region.type = region.type || 'tile_map';
    if ((region.type || '') === 'unknown' || (region.type || '') === 'data_table') region.type = 'tile_map';
    region.confidence = 'high';
    region.analysis = region.analysis || {};
    region.analysis.dc2ScrollMapAudit = {
      catalogId,
      kind: 'dc2_compressed_scroll_map_stream',
      confidence: 'high',
      tableIndex: entry.indexHex,
      tableEntryOffset: entry.tableEntryOffset,
      z80Pointer: entry.z80Pointer,
      runtimeConsumedBytes: entry.runtimeConsumedBytes,
      declaredRegionBytes: entry.declaredRegionBytes,
      trailingBytesBeforeNextLabel: entry.trailingBytesBeforeNextLabel,
      writtenCells: entry.writtenCells,
      rows: entry.rows,
      columns: entry.columns,
      endReason: entry.endReason,
      opCounts: entry.opCounts,
      maxRunLength: entry.maxRunLength,
      usage: entry.usage,
      summary: 'Compressed _LABEL_DC2_ scroll-map stream; metadata only, decoded cell values stay ROM-local.',
      evidence: [
        `Table entry ${entry.indexHex} at ${entry.tableEntryOffset} points to this stream as ${entry.z80Pointer}.`,
        `_LABEL_DC2_ uses _DATA_14000_ entry ${entry.indexHex} and expands this stream to ${entry.writtenCells} cells (${entry.rows}x${entry.columns}).`,
        `Exact interpreter simulation reaches ${entry.endReason} after ${entry.runtimeConsumedBytes} byte(s) with ${entry.warningCount} warning(s).`,
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      before,
      after: regionRef(region),
      index: entry.indexHex,
      usageCount: entry.usage.descriptorCount,
      runtimeConsumedBytes: entry.runtimeConsumedBytes,
      trailingBytesBeforeNextLabel: entry.trailingBytesBeforeNextLabel,
    });
  }
  return { annotated, missing };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const tableChange = apply ? annotateTableRegion(mapData, catalog) : null;
  const decoderChange = apply ? annotateDecoderRoutine(mapData, catalog) : null;
  const targetChanges = apply ? annotateTargetRegions(mapData, catalog) : { annotated: [], missing: [] };

  if (apply) {
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'dc2_scroll_map_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        tableRegionAnnotated: Boolean(tableChange),
        decoderRoutineAnnotated: Boolean(decoderChange),
        targetRegionsAnnotated: targetChanges.annotated.length,
        missingTargetRegions: targetChanges.missing.length,
      },
      pointerTable: catalog.pointerTable,
      decoder: catalog.decoder,
      usage: catalog.usage,
      tableRegion: tableChange,
      decoderRoutine: decoderChange,
      targetRegionSamples: targetChanges.annotated.slice(0, 40),
      missingTargetRegions: targetChanges.missing,
      evidence: catalog.evidence,
      nextLeads: [
        'Use DC2 stream metadata plus _DATA_18000_ tile-pair lookup metadata to build room name-table previews without direct ROM-tile fallback.',
        'Cross-check unused DC2 indices against non-zone callers or disabled room content before marking them unused globally.',
        'Promote sceneRecipes/zone recipes to reference DC2 table indices, 8FB loader offsets, optional 998 loaders, and palette index as a reproducible room-render input.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    pointerTable: catalog.pointerTable,
    decoder: catalog.decoder,
    usage: catalog.usage,
    warningEntries: catalog.entries.filter(entry => entry.warningCount).map(entry => ({
      index: entry.indexHex,
      romOffset: entry.romOffset,
      warnings: entry.warnings,
    })),
    tableRegion: tableChange,
    decoderRoutine: decoderChange,
    targetRegionsAnnotated: targetChanges.annotated.length,
    missingTargetRegions: targetChanges.missing,
  }, null, 2));
}

main();
