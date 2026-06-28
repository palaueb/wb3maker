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
const catalogId = 'world-dc2-tile-pair-lookup-catalog-2026-06-25';
const reportId = 'dc2-tile-pair-lookup-audit-2026-06-25';
const toolName = 'tools/world-dc2-tile-pair-lookup-audit.mjs';

const dc2CatalogId = 'world-dc2-scroll-map-catalog-2026-06-25';
const dc2TableOffset = 0x14000;
const dc2TableEntryCount = 176;
const lookupOffset = 0x18000;
const lookupRecordStride = 8;
const lookupRecordCount = 227;
const lookupEndExclusive = lookupOffset + lookupRecordCount * lookupRecordStride;
const rendererRoutineRegionId = 'r2123';
const lookupRegionIds = ['r1476', 'r0563'];
const aliasRegionIds = ['r0782'];

const ramRoles = [
  ['$CB00', 'dc2_scroll_map_buffer', 'Scratch scroll-map buffer filled by _LABEL_DC2_ and read by _LABEL_EF3_.', 'high'],
  ['$D013', 'dc2_render_column_index', 'Current room-render column index; bit 0 selects even/odd half of each _DATA_18000_ record.', 'high'],
  ['$D014', 'dc2_render_vdp_address_low', 'Low byte of the VDP address control word for the active rendered column.', 'high'],
  ['$D015', 'dc2_render_vdp_address_high', 'High byte of the VDP address control word for the active rendered column.', 'high'],
  ['$D016', 'dc2_render_row_counter', '11-row countdown while _LABEL_EF3_ converts tile-pair records into the column buffer.', 'high'],
  ['$D017', 'dc2_render_cb00_read_pointer', 'Pointer into _RAM_CB00_; advanced by 0x60 to read the next decompressed row.', 'high'],
  ['$D247', 'dc2_deferred_column_draw_flag', 'Set when _LABEL_EF3_ prepared a column buffer without the immediate full-column draw path.', 'medium'],
  ['$D248', 'dc2_column_name_table_word_buffer', '44-byte buffer holding 22 name-table words for the two-tile-wide rendered column.', 'high'],
  ['$D274', 'dc2_full_redraw_mode_flag', 'Nonzero during the 32-column redraw loop so _LABEL_EF3_ writes the prepared column immediately.', 'medium'],
  ['$CF82', 'vdp_write_in_progress_flag', 'Set while _LABEL_EF3_ writes the prepared column buffer through the VDP data port.', 'high'],
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readWord(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function bank5Z80ToRom(z80Pointer) {
  return z80Pointer + 0xC000;
}

function findById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findContainingRegions(mapData, start, endExclusive) {
  return (mapData.regions || []).filter(region => {
    const regionStart = parseInt(region.offset, 16);
    const regionEnd = regionStart + (region.size || 0);
    return regionStart < endExclusive && start < regionEnd;
  });
}

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => (entry.address || '').toUpperCase() === address.toUpperCase()) || null;
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

function decodeDc2StreamValues(rom, offset) {
  const values = [];
  let pc = offset;
  let row = 0;
  let column = 0;
  const warnings = [];

  function writeValue(value) {
    values.push(value);
    column++;
    if (column >= 16) {
      column = 0;
      row++;
    }
    return row >= 11;
  }

  decodeLoop:
  while (pc < rom.length && row < 11 && values.length < 176) {
    const commandOffset = pc;
    const command = rom[pc++];
    if (command === 0xFF) {
      if (pc >= rom.length) {
        warnings.push(`truncated extended opcode at ${hex(commandOffset)}`);
        break;
      }
      const countOrTerminator = rom[pc++];
      if (countOrTerminator === 0xFF) break;
      if (pc >= rom.length) {
        warnings.push(`truncated extended run at ${hex(commandOffset)}`);
        break;
      }
      const value = rom[pc++];
      for (let i = 0; i < countOrTerminator; i++) {
        if (writeValue(value)) break decodeLoop;
      }
      continue;
    }
    if (command >= 0xE3) {
      if (pc >= rom.length) {
        warnings.push(`truncated short run at ${hex(commandOffset)}`);
        break;
      }
      const count = command - 0xE0;
      const value = rom[pc++];
      for (let i = 0; i < count; i++) {
        if (writeValue(value)) break decodeLoop;
      }
      continue;
    }
    if (writeValue(command)) break;
  }

  if (values.length !== 176) warnings.push(`decoded ${values.length} DC2 cells, expected 176`);
  return { values, warnings };
}

function collectDc2TileIndexStats(rom) {
  const used = new Set();
  let cellCount = 0;
  let outOfRangeCellCount = 0;
  let minIndex = Infinity;
  let maxIndex = -Infinity;
  const warningStreams = [];

  for (let index = 0; index < dc2TableEntryCount; index++) {
    const z80Pointer = readWord(rom, dc2TableOffset + index * 2);
    const romOffset = bank5Z80ToRom(z80Pointer);
    const decoded = decodeDc2StreamValues(rom, romOffset);
    if (decoded.warnings.length) {
      warningStreams.push({
        dc2Index: hex(index, 2),
        romOffset: hex(romOffset),
        warnings: decoded.warnings,
      });
    }
    for (const value of decoded.values) {
      cellCount++;
      minIndex = Math.min(minIndex, value);
      maxIndex = Math.max(maxIndex, value);
      used.add(value);
      if (value < 0 || value >= lookupRecordCount) outOfRangeCellCount++;
    }
  }

  return {
    dc2StreamsDecoded: dc2TableEntryCount,
    decodedCellCount: cellCount,
    uniqueLookupRecordIndicesUsed: used.size,
    unusedLookupRecordCount: Math.max(0, lookupRecordCount - used.size),
    minLookupRecordIndex: Number.isFinite(minIndex) ? minIndex : null,
    maxLookupRecordIndex: Number.isFinite(maxIndex) ? maxIndex : null,
    outOfRangeCellCount,
    warningStreamCount: warningStreams.length,
    warningStreams,
  };
}

function buildCatalog(rom, mapData) {
  const rendererRoutine = findById(mapData, rendererRoutineRegionId);
  const primaryRegions = lookupRegionIds.map(id => findById(mapData, id)).filter(Boolean);
  const aliasRegions = aliasRegionIds.map(id => findById(mapData, id)).filter(Boolean);
  const overlappingRegions = findContainingRegions(mapData, lookupOffset, lookupEndExclusive).map(regionRef);
  const stats = collectDc2TileIndexStats(rom);
  const dc2Catalog = (mapData.roomDataCatalogs || []).find(catalog => catalog.id === dc2CatalogId) || null;

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    lookup: {
      label: '_DATA_18000_',
      offset: hex(lookupOffset),
      endInclusive: hex(lookupEndExclusive - 1),
      recordStride: lookupRecordStride,
      recordCount: lookupRecordCount,
      recordLayout: [
        { field: 'bytes 0-1', role: 'even_column_top_name_table_word' },
        { field: 'bytes 2-3', role: 'even_column_bottom_name_table_word' },
        { field: 'bytes 4-5', role: 'odd_column_top_name_table_word' },
        { field: 'bytes 6-7', role: 'odd_column_bottom_name_table_word' },
      ],
      primaryRegions: primaryRegions.map(regionRef),
      aliasRegions: aliasRegions.map(regionRef),
      overlappingRegions,
      dualUseNote: 'This lookup range overlaps existing metasprite annotations; the audit records the room-render role without deleting or retyping those annotations.',
    },
    renderer: {
      routine: '_LABEL_EF3_',
      routineRegion: regionRef(rendererRoutine),
      inputRam: '_RAM_CB00_',
      columnIndexRam: '_RAM_D013_',
      outputBufferRam: '_RAM_D248_',
      vdpWriteFlagRam: '_RAM_CF82_',
      rows: 11,
      columnsPerCall: 2,
      nameTableWordsPerCall: 22,
    },
    dc2Source: {
      catalogId: dc2CatalogId,
      catalogPresent: Boolean(dc2Catalog),
      tableOffset: hex(dc2TableOffset),
      streamCount: dc2TableEntryCount,
    },
    summary: {
      lookupRecordCount,
      lookupBytes: lookupEndExclusive - lookupOffset,
      primaryRegionCount: primaryRegions.length,
      aliasRegionCount: aliasRegions.length,
      overlappingRegionCount: overlappingRegions.length,
      dc2StreamsDecoded: stats.dc2StreamsDecoded,
      decodedCellCount: stats.decodedCellCount,
      uniqueLookupRecordIndicesUsed: stats.uniqueLookupRecordIndicesUsed,
      unusedLookupRecordCount: stats.unusedLookupRecordCount,
      minLookupRecordIndex: stats.minLookupRecordIndex,
      maxLookupRecordIndex: stats.maxLookupRecordIndex,
      outOfRangeCellCount: stats.outOfRangeCellCount,
      warningStreamCount: stats.warningStreamCount,
      ramVariableCount: ramRoles.length,
      assetPolicy: 'Metadata only: offsets, record counts, field roles, aggregate DC2 index bounds, RAM addresses, and evidence. No ROM bytes, decoded tile words, decoded map cells, graphics, or rendered assets are embedded.',
    },
    ramRoles: ramRoles.map(([address, role, summary, confidence]) => ({ address, role, summary, confidence })),
    validation: {
      warningStreams: stats.warningStreams,
      checkedAgainstLookupRecordCount: lookupRecordCount,
      aggregateOnly: true,
    },
    evidence: [
      'ASM lines 3060-3079: _LABEL_EF3_ selects bank 6, derives the current column from _RAM_D013_, and computes an _RAM_CB00_ read pointer.',
      'ASM lines 3083-3096: each row reads one decompressed tile index from _RAM_CB00_, multiplies it by 8, and adds it to _DATA_18000_.',
      'ASM lines 3097-3105: column parity selects the first or second four-byte half of each lookup record.',
      'ASM lines 3107-3117: two 16-bit name-table words are copied from the selected lookup record into the column buffer.',
      'ASM lines 3131-3156: immediate redraw mode writes 22 name-table words from _RAM_D248_ to VDP data port with a 0x40-byte row stride.',
      `The DC2 stream aggregate from ${dc2CatalogId} validates ${stats.decodedCellCount} decoded cell reference(s); the maximum lookup record index is ${stats.maxLookupRecordIndex}, requiring ${lookupRecordCount} 8-byte records through ${hex(lookupEndExclusive - 1)}.`,
    ],
  };
}

function annotateRegion(region, catalog, role) {
  const before = regionRef(region);
  region.analysis = region.analysis || {};
  region.analysis.dc2TilePairLookupAudit = {
    catalogId,
    kind: role,
    confidence: 'high',
    lookupOffset: catalog.lookup.offset,
    lookupEndInclusive: catalog.lookup.endInclusive,
    recordStride: lookupRecordStride,
    recordCount: lookupRecordCount,
    dualUseWithExistingType: region.type || 'unknown',
    summary: 'Region participates in the _DATA_18000_ room-render tile-pair lookup used by _LABEL_EF3_; existing metasprite annotations are preserved.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  if (region.id === 'r1476') {
    region.notes = 'Data from 18000 to 18584 (1413 bytes); also the start of the 227-entry _LABEL_EF3_ tile-pair lookup used by DC2 room rendering.';
  } else if (region.id === 'r0563') {
    region.notes = 'Data from 18585 to 18717 (403 bytes); also the tail of the 227-entry _LABEL_EF3_ tile-pair lookup used by DC2 room rendering.';
  }
  return { before, after: regionRef(region), role };
}

function annotateRegions(mapData, catalog) {
  const changed = [];
  for (const id of lookupRegionIds) {
    const region = findById(mapData, id);
    if (region) changed.push(annotateRegion(region, catalog, 'dc2_tile_pair_lookup_primary_region'));
  }
  for (const id of aliasRegionIds) {
    const region = findById(mapData, id);
    if (region) changed.push(annotateRegion(region, catalog, 'dc2_tile_pair_lookup_nested_alias_region'));
  }
  return changed;
}

function annotateRendererRoutine(mapData, catalog) {
  const region = findById(mapData, rendererRoutineRegionId);
  if (!region) return null;
  const before = regionRef(region);
  if (!region.name) region.name = '_LABEL_EF3_ DC2 tile-pair column renderer';
  region.analysis = region.analysis || {};
  region.analysis.dc2TilePairLookupAudit = {
    catalogId,
    kind: 'dc2_tile_pair_column_renderer',
    confidence: 'high',
    inputRam: catalog.renderer.inputRam,
    outputBufferRam: catalog.renderer.outputBufferRam,
    lookupOffset: catalog.lookup.offset,
    rows: catalog.renderer.rows,
    columnsPerCall: catalog.renderer.columnsPerCall,
    nameTableWordsPerCall: catalog.renderer.nameTableWordsPerCall,
    summary: '_LABEL_EF3_ converts DC2 tile indices into 22 SMS name-table words using the _DATA_18000_ tile-pair lookup.',
    evidence: catalog.evidence.slice(0, 5),
    generatedAt: now,
    tool: toolName,
  };
  return { before, after: regionRef(region) };
}

function annotateRam(mapData, catalog) {
  const changed = [];
  for (const role of catalog.ramRoles) {
    const entry = findRam(mapData, role.address);
    if (!entry) continue;
    const before = {
      address: entry.address,
      size: entry.size || 0,
      type: entry.type || '',
      name: entry.name || '',
      notes: entry.notes || '',
    };
    if ((!entry.name || entry.name === role.address.slice(1)) && role.address !== '$CB00' && role.address !== '$CF82') {
      entry.name = role.role.toUpperCase();
    }
    entry.analysis = entry.analysis || {};
    entry.analysis.dc2TilePairLookupAudit = {
      catalogId,
      kind: role.role,
      confidence: role.confidence,
      summary: role.summary,
      evidence: catalog.evidence.slice(0, 5),
      generatedAt: now,
      tool: toolName,
    };
    changed.push({
      before,
      after: {
        address: entry.address,
        size: entry.size || 0,
        type: entry.type || '',
        name: entry.name || '',
        notes: entry.notes || '',
      },
      role: role.role,
      confidence: role.confidence,
    });
  }
  return changed;
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const regionChanges = apply ? annotateRegions(mapData, catalog) : [];
  const rendererChange = apply ? annotateRendererRoutine(mapData, catalog) : null;
  const ramChanges = apply ? annotateRam(mapData, catalog) : [];

  if (apply) {
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'dc2_tile_pair_lookup_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegions: regionChanges.length,
        rendererRoutineAnnotated: Boolean(rendererChange),
        annotatedRamEntries: ramChanges.length,
      },
      lookup: catalog.lookup,
      renderer: catalog.renderer,
      dc2Source: catalog.dc2Source,
      validation: catalog.validation,
      annotatedRegions: regionChanges,
      rendererRoutine: rendererChange,
      annotatedRamEntries: ramChanges,
      evidence: catalog.evidence,
      nextLeads: [
        'Teach the browser zone renderer to surface this lookup range as a dual-use table instead of treating _DATA_18000_ only as metasprite data.',
        'Add a metadata-only consistency check between DC2 decoded indices, tile-pair lookup record bounds, and VRAM tile provenance.',
        'Revisit the bank-6 metasprite audit with this dual-use evidence before splitting _DATA_18000_ into stricter subviews.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    lookup: catalog.lookup,
    renderer: catalog.renderer,
    validation: catalog.validation,
    annotatedRegions: regionChanges.length,
    rendererRoutine: rendererChange,
    annotatedRamEntries: ramChanges.length,
  }, null, 2));
}

main();
