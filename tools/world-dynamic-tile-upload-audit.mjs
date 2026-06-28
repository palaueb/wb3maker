#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-dynamic-tile-upload-catalog-2026-06-25';
const reportId = 'dynamic-tile-upload-audit-2026-06-25';

const remapTable = {
  regionId: 'r0012',
  label: '_DATA_B4F_',
  offset: 0x00B4F,
  size: 64,
  rows: 4,
  entriesPerRow: 16,
};

const routines = [
  {
    regionId: 'r2100',
    label: '_LABEL_A97_',
    offset: 0x00A97,
    role: 'dynamic_tile_decode_upload',
    name: '_LABEL_A97_ dynamic tile decode/upload routine',
    confidence: 'high',
    summary: 'Decodes source tile rows through _DATA_B4F_ according to _RAM_D0EC_ and writes four bytes per row to VDP data port.',
    evidence: [
      'ASM lines 2453-2468 set the destination/source state and run the dynamic decode loop.',
      'ASM lines 2503-2517 load four source bytes and select _DATA_B4F_ as the remap table.',
      'ASM lines 2517-2525 multiply _RAM_D0EC_ by 16 and add it to _DATA_B4F_ to choose one remap row.',
      'ASM lines 2526-2557 process 8 pixels/row through the selected remap row.',
      'ASM lines 2558-2566 write four decoded row bytes to Port_VDPData.',
    ],
  },
  {
    regionId: 'r2726',
    label: '_LABEL_99B_',
    offset: 0x0099B,
    role: 'raw_tile_stream_upload_wrapper',
    name: '_LABEL_99B_ raw tile stream upload wrapper',
    confidence: 'high',
    summary: 'Initializes tile upload scratch state from _DATA_20000_ and processes loader records with _LABEL_9C3_ and _LABEL_A14_.',
    evidence: [
      'ASM lines 2293-2308 initialize _RAM_D0F0_, _RAM_D0EE_, _RAM_D0F3_, _RAM_D0ED_, call _LABEL_9C3_, switch bank, and call _LABEL_A14_.',
    ],
  },
  {
    regionId: 'r2727',
    label: '_LABEL_9C3_',
    offset: 0x009C3,
    role: 'tile_loader_record_parser',
    name: '_LABEL_9C3_ tile loader record parser',
    confidence: 'high',
    summary: 'Parses tile loader records: zero terminates, bit 7 updates the VRAM destination, 0x7F zero-fills one tile row block, otherwise it sets count, source pointer, and source bank.',
    evidence: [
      'ASM lines 2310-2315 terminate the caller when a zero record byte is read.',
      'ASM lines 2317-2327 use bit 7 and _LABEL_B8F_ to update _RAM_D0F0_ as a VRAM destination byte address.',
      'ASM lines 2328-2343 treat 0x7F as a 32-byte zero-fill block and advance _RAM_D0ED_.',
      'ASM lines 2345-2360 store record count, source bank in _RAM_D0F3_, and source pointer in _RAM_D0EE_.',
    ],
  },
  {
    regionId: 'r2728',
    label: '_LABEL_A14_',
    offset: 0x00A14,
    role: 'raw_tile_block_upload',
    name: '_LABEL_A14_ raw tile block upload routine',
    confidence: 'high',
    summary: 'Writes 32 source bytes per tile block to the VDP data port, advancing source and destination scratch pointers.',
    evidence: [
      'ASM lines 2362-2389 set the VRAM loading flag, write 32 bytes from _RAM_D0EE_ to Port_VDPData, advance _RAM_D0F0_ by 0x20, and clear the flag.',
    ],
  },
  {
    regionId: 'r1755',
    label: '_LABEL_B8F_',
    offset: 0x00B8F,
    role: 'tile_index_to_byte_offset_helper',
    name: '_LABEL_B8F_ tile index to byte offset helper',
    confidence: 'high',
    summary: 'Multiplies DE by 32 to convert a tile index to a byte offset.',
    evidence: [
      'ASM lines 2576-2584 shift DE left five times and return.',
      'ASM lines 2325, 2357, 2424, 2439, and 6924 call this helper before tile upload addressing.',
    ],
  },
  {
    regionId: 'r2094',
    label: '_LABEL_98F_',
    offset: 0x0098F,
    role: 'vdp_address_write_helper',
    name: '_LABEL_98F_ VDP address write helper',
    confidence: 'high',
    summary: 'Writes the current DE VDP destination address to the VDP address port helper.',
    evidence: [
      'ASM lines 2294-2296, 2367-2369, 2454-2456, and 2472-2479 use this helper or the same address write shape before VDP data writes.',
    ],
  },
];

const callers = [
  {
    regionId: 'r2088',
    label: '_LABEL_29E6_ local caller',
    role: 'entity_dynamic_tile_upload_caller',
    confidence: 'medium',
    summary: 'Computes _RAM_D0EC_ from high source-pointer bits and calls _LABEL_A97_ while building dynamic entity tile slots.',
    evidence: [
      'ASM lines 6893-6925 compute _RAM_D0EC_, convert _RAM_D0E1_ with _LABEL_B8F_, and call _LABEL_A97_.',
      'ASM lines 6926-6935 use _RAM_D0ED_ to advance _RAM_D0E1_ and restore the previous bank.',
    ],
  },
];

const ramRoles = [
  {
    address: '$D0EC',
    role: 'dynamic_tile_remap_row_index',
    confidence: 'high',
    summary: 'Selects one of four 16-entry rows in _DATA_B4F_ during dynamic tile decode.',
    evidence: [
      'ASM lines 2515-2525 multiply _RAM_D0EC_ by 16 and add it to _DATA_B4F_.',
      'ASM lines 6916-6920 derive _RAM_D0EC_ from the high bits of the dynamic source pointer.',
    ],
  },
  {
    address: '$D0ED',
    role: 'dynamic_tile_uploaded_tile_count',
    confidence: 'high',
    summary: 'Counts processed tile blocks during raw and dynamic upload loops.',
    evidence: [
      'ASM lines 2460-2468 clear _RAM_D0ED_ before the loop.',
      'ASM lines 2495-2499 increment _RAM_D0ED_ after each dynamic tile block.',
      'ASM lines 6926-6930 add _RAM_D0ED_ to _RAM_D0E1_ after _LABEL_A97_ returns.',
    ],
  },
  {
    address: '$D0EE',
    role: 'tile_upload_source_pointer_low',
    confidence: 'high',
    summary: 'Low byte of the current tile source pointer consumed by raw and dynamic upload loops.',
    evidence: [
      'ASM lines 2503-2513 read from _RAM_D0EE_ and advance it by four source bytes per decoded row.',
      'ASM lines 2372-2378 advance _RAM_D0EE_ through raw 32-byte tile blocks.',
    ],
  },
  {
    address: '$D0EF',
    role: 'tile_upload_source_pointer_high',
    confidence: 'high',
    summary: 'High byte of the current tile source pointer paired with _RAM_D0EE_.',
    evidence: [
      'ASM lines 2503-2513 load HL from _RAM_D0EE_, which covers the two-byte _RAM_D0EE_/_RAM_D0EF_ pointer.',
    ],
  },
  {
    address: '$D0F0',
    role: 'tile_upload_vram_destination_low',
    confidence: 'high',
    summary: 'Low byte of current VRAM destination pointer advanced by 0x20 per tile block.',
    evidence: [
      'ASM lines 2472-2494 write the VDP address from _RAM_D0F0_ and advance it by 0x20.',
      'ASM lines 2379-2382 advance _RAM_D0F0_ by 0x20 in the raw upload path.',
    ],
  },
  {
    address: '$D0F1',
    role: 'tile_upload_vram_destination_high',
    confidence: 'high',
    createIfMissing: true,
    defaultName: 'tile upload VRAM destination high byte',
    summary: 'High byte of current VRAM destination pointer paired with _RAM_D0F0_.',
    evidence: [
      'ASM lines 2472-2479 load DE from _RAM_D0F0_ and write both address bytes to the VDP address port.',
    ],
  },
  {
    address: '$D0F2',
    role: 'tile_upload_record_countdown',
    confidence: 'high',
    summary: 'Countdown for tile blocks in the active loader record.',
    evidence: [
      'ASM lines 2345-2347 store the record count in _RAM_D0F2_.',
      'ASM lines 2495-2499 and 2383-2385 decrement _RAM_D0F2_ until the active upload record is complete.',
    ],
  },
  {
    address: '$D0F3',
    role: 'tile_upload_source_bank',
    confidence: 'high',
    summary: 'Source bank selected before uploading tile bytes.',
    evidence: [
      'ASM lines 2351-2353 derive _RAM_D0F3_ from the high source pointer byte.',
      'ASM lines 2463-2467 and 2303-2307 switch to _RAM_D0F3_ before uploading tile data.',
    ],
  },
  {
    address: '$D116',
    role: 'tile_decode_row_pixel_counter',
    confidence: 'high',
    summary: 'Eight-step counter for decoding one 8-pixel tile row through _DATA_B4F_.',
    evidence: [
      'ASM lines 2526-2527 set _RAM_D116_ to 8.',
      'ASM lines 2554-2557 decrement _RAM_D116_ until the decoded row is complete.',
    ],
  },
  {
    address: '$CF82',
    role: 'tile_upload_vdp_write_flag',
    confidence: 'high',
    summary: 'Set while raw tile data is being written to the VDP data port.',
    evidence: [
      'ASM lines 2362-2389 set _RAM_CF82_ before the raw upload loop and clear it afterwards.',
    ],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => (entry.address || '').toUpperCase() === address.toUpperCase()) || null;
}

function nextRamNumber(mapData) {
  let maxId = 0;
  for (const entry of mapData.ram || []) {
    const match = /^ram(\d+)$/.exec(entry.id || '');
    if (match) maxId = Math.max(maxId, Number(match[1]));
  }
  return maxId + 1;
}

function formatRamId(number) {
  return 'ram' + String(number).padStart(4, '0');
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

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-dynamic-tile-upload-audit.mjs',
    summary: {
      remapTableOffset: hex(remapTable.offset, 4),
      remapTableSizeBytes: remapTable.size,
      remapRows: remapTable.rows,
      remapEntriesPerRow: remapTable.entriesPerRow,
      routineCount: routines.length,
      callerCount: callers.length,
      ramVariableCount: ramRoles.length,
      assetPolicy: 'Metadata only: offsets, table dimensions, routine labels, RAM addresses, and evidence. No ROM tile bytes, remap bytes, or decoded graphics are embedded.',
    },
    remapTable: {
      region: regionRef(findRegionById(mapData, remapTable.regionId)),
      label: remapTable.label,
      offset: hex(remapTable.offset, 4),
      endInclusive: hex(remapTable.offset + remapTable.size - 1, 4),
      size: remapTable.size,
      layout: {
        rows: remapTable.rows,
        entriesPerRow: remapTable.entriesPerRow,
        rowSelector: '$D0EC',
        innerIndexBits: 'four source-plane carry bits collected per pixel',
      },
      confidence: 'high',
    },
    routines: routines.map(routine => ({ ...routine, offset: hex(routine.offset, 4) })),
    callers,
    ramRoles,
    evidence: [
      'ASM lines 2503-2525 show _LABEL_A97_ selecting _DATA_B4F_ + (_RAM_D0EC_ * 16).',
      'ASM lines 2526-2566 show eight decoded pixels producing four row bytes written to Port_VDPData.',
      'ASM lines 2310-2360 show _LABEL_9C3_ parsing tile loader records for both raw and transformed upload paths.',
      'ASM lines 2362-2389 show _LABEL_A14_ uploading raw 32-byte tile blocks to VDP.',
      'ASM lines 6893-6925 show a dynamic caller computing _RAM_D0EC_ and invoking _LABEL_A97_.',
    ],
  };
}

function annotateRegion(region, annotation) {
  const before = regionRef(region);
  if (annotation.name && (!region.name || /^_LABEL_|^_DATA_|^UPLOAD\/DECODE/.test(region.name))) {
    region.name = annotation.name;
  }
  if (annotation.type) region.type = annotation.type;
  if (annotation.confidence && !region.confidence) region.confidence = annotation.confidence;
  if (annotation.notes) region.notes = annotation.notes;
  region.analysis = region.analysis || {};
  region.analysis.dynamicTileUploadAudit = {
    catalogId,
    kind: annotation.role,
    confidence: annotation.confidence,
    summary: annotation.summary,
    evidence: annotation.evidence,
    generatedAt: now,
    tool: 'tools/world-dynamic-tile-upload-audit.mjs',
  };
  return { before, after: regionRef(region), role: annotation.role, confidence: annotation.confidence };
}

function annotateRamEntry(entry, role) {
  const before = {
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || '',
    name: entry.name || '',
    notes: entry.notes || '',
  };
  entry.analysis = entry.analysis || {};
  entry.analysis.dynamicTileUploadAudit = {
    catalogId,
    kind: role.role,
    confidence: role.confidence,
    summary: role.summary,
    evidence: role.evidence,
    generatedAt: now,
    tool: 'tools/world-dynamic-tile-upload-audit.mjs',
  };
  return {
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
  };
}

function applyAnnotations(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const changedRam = [];
  const missingRam = [];

  const remapRegion = findRegionById(mapData, remapTable.regionId);
  if (remapRegion) {
    changedRegions.push(annotateRegion(remapRegion, {
      role: 'dynamic_tile_remap_table',
      name: 'dynamic tile bitplane remap table',
      type: 'data_table',
      confidence: 'high',
      summary: 'Four 16-entry remap rows selected by _RAM_D0EC_ while _LABEL_A97_ decodes source tile planes for VDP upload.',
      notes: '4x16 remap table for dynamic tile decode/upload; stores metadata only, not table bytes.',
      evidence: catalog.evidence.slice(0, 2),
    }));
  } else {
    missingRegions.push({ id: remapTable.regionId, offset: hex(remapTable.offset, 4), role: 'dynamic_tile_remap_table' });
  }

  for (const routine of routines.concat(callers)) {
    const region = findRegionById(mapData, routine.regionId);
    if (!region) {
      missingRegions.push({ id: routine.regionId, label: routine.label, role: routine.role });
      continue;
    }
    changedRegions.push(annotateRegion(region, routine));
  }

  let nextRamId = nextRamNumber(mapData);
  for (const role of ramRoles) {
    let entry = findRam(mapData, role.address);
    if (!entry && role.createIfMissing) {
      entry = {
        id: formatRamId(nextRamId++),
        address: role.address,
        size: 1,
        type: 'byte',
        name: role.defaultName,
        notes: '',
      };
      mapData.ram = mapData.ram || [];
      mapData.ram.push(entry);
    }
    if (!entry) {
      missingRam.push({ address: role.address, role: role.role });
      continue;
    }
    changedRam.push(annotateRamEntry(entry, role));
  }

  return { changedRegions, missingRegions, changedRam, missingRam };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let changes = { changedRegions: [], missingRegions: [], changedRam: [], missingRam: [] };

  if (apply) {
    changes = applyAnnotations(mapData, catalog);
    const finalCatalog = buildCatalog(mapData);
    mapData.tileSourceCatalogs = (mapData.tileSourceCatalogs || []).filter(item => item.id !== catalogId);
    mapData.tileSourceCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'dynamic_tile_upload_audit',
      generatedAt: now,
      tool: 'tools/world-dynamic-tile-upload-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changes.changedRegions.length,
        missingRegions: changes.missingRegions.length,
        annotatedRamEntries: changes.changedRam.length,
        missingRamEntries: changes.missingRam.length,
      },
      changedRegions: changes.changedRegions,
      missingRegions: changes.missingRegions,
      annotatedRamEntries: changes.changedRam,
      missingRamEntries: changes.missingRam,
      evidence: finalCatalog.evidence,
      nextLeads: [
        'Implement a ROM-local browser decoder for _LABEL_A97_ so dynamic entity tile uploads can be previewed without embedding tile bytes.',
        'Trace the RST $08/$18 source-pointer lookup used at ASM lines 6907-6908 to name the dynamic sprite tile source tables.',
        'Add dynamic tile-upload provenance to synthetic VRAM slots alongside the existing 8FB/998 loader provenance.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    remapTable: catalog.remapTable,
    routines: catalog.routines.map(routine => ({
      label: routine.label,
      offset: routine.offset,
      role: routine.role,
      confidence: routine.confidence,
    })),
    callers: catalog.callers,
    ramRoles: catalog.ramRoles.map(role => ({
      address: role.address,
      role: role.role,
      confidence: role.confidence,
    })),
    changes,
  }, null, 2));
}

main();
