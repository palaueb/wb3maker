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
const catalogId = 'world-vdp-render-routine-catalog-2026-06-25';
const reportId = 'vdp-render-routine-audit-2026-06-25';
const toolName = 'tools/world-vdp-render-routine-audit.mjs';

const ROUTINES = [
  {
    offset: 0x005EB,
    label: '_LABEL_5EB_',
    role: 'bank7_vdp_stream_launcher',
    name: '_LABEL_5EB_ bank-7 VDP stream launcher',
    summary: 'Switches to bank 7, indexes _DATA_1CCC0_ by stream id, dispatches the selected VDP stream to _LABEL_604_, then restores the previous bank.',
    calls: ['_LABEL_1023_', '_LABEL_10_', '_LABEL_604_', '_LABEL_1036_'],
    readsRAM: ['_RAM_DFFF_', '_RAM_D121_'],
    writesRAM: ['_RAM_D121_', '_RAM_FFFF_'],
    bankSwitches: ['bank 7 via _LABEL_1023_', 'restore via _LABEL_1036_'],
    relatedOffsets: [0x1CCC0, 0x00604],
    evidence: ['_LABEL_5EB_ calls _LABEL_1023_ with a=$07, indexes _DATA_1CCC0_ with rst $10, calls _LABEL_604_, then calls _LABEL_1036_.'],
  },
  {
    offset: 0x00604,
    label: '_LABEL_604_',
    role: 'vdp_stream_interpreter',
    name: '_LABEL_604_ VDP stream interpreter',
    summary: 'Interprets bytecode-style VDP streams, writing tile/value bytes through rst $30 and handling $F0-$F7 controls through the local jump table at _DATA_612_.',
    calls: ['_LABEL_20_', '_LABEL_30_', '_LABEL_28_', '_LABEL_BE97_', '_LABEL_FF9_'],
    readsRAM: ['_RAM_CF97_', '_RAM_D0E0_', '_RAM_D0E1_', '_RAM_D0E2_', '_RAM_CF83_', '_RAM_CF8D_'],
    writesRAM: ['_RAM_CF82_', '_RAM_CF97_', '_RAM_D0E0_', '_RAM_D0E1_', '_RAM_D0E2_', '_RAM_CF8D_', '_RAM_CFE1_', '_RAM_FFFF_'],
    writesVDP: ['VDP data via rst $30/_LABEL_30_', 'VDP address via rst $28/_LABEL_28_'],
    relatedOffsets: [0x00612],
    evidence: ['_LABEL_604_ loops over BC stream bytes; bytes below $F0 are emitted through rst $30 with the current attribute byte, while $F0-$F7 dispatch through _DATA_612_.'],
  },
  {
    offset: 0x008B2,
    label: '_LABEL_8B2_',
    role: 'bank7_palette_pair_loader',
    name: '_LABEL_8B2_ bank-7 palette pair loader',
    summary: 'Loads two 16-byte palette rows from bank-7 palette records into the BG and sprite CRAM shadows.',
    calls: ['_LABEL_1023_', '_LABEL_1036_'],
    readsRAM: ['_RAM_CFF5_', '_RAM_CFF6_', '_RAM_DFFF_', '_RAM_D121_'],
    writesRAM: ['_RAM_CFF5_', '_RAM_CFF6_', '_RAM_CF9B_', '_RAM_CFAB_', '_RAM_D121_', '_RAM_FFFF_'],
    bankSwitches: ['bank 7 via _LABEL_1023_', 'restore via _LABEL_1036_'],
    relatedOffsets: [0x1C5B0],
    evidence: ['_LABEL_8B2_ switches to bank 7, indexes _DATA_1C5B0_ in $10-byte steps, and copies two $10-byte palette rows into _RAM_CF9B_ and _RAM_CFAB_.'],
  },
  {
    offset: 0x008FB,
    label: '_LABEL_8FB_',
    role: 'vram_loader_8fb_entry',
    name: '_LABEL_8FB_ VRAM tile loader entry',
    summary: 'Initializes the record parser used by vram_loader_8fb data: destination defaults to VRAM $0000, source defaults to bank-8 tile data, then control passes to _LABEL_919_.',
    calls: ['_LABEL_98F_', '_LABEL_919_'],
    readsRAM: [],
    writesRAM: ['_RAM_CF82_', '_RAM_CFF7_', '_RAM_D0F0_', '_RAM_D0EE_', '_RAM_D0F3_'],
    writesVDP: ['VDP address setup via _LABEL_98F_'],
    relatedOffsets: [0x20000],
    evidence: ['_LABEL_8FB_ stores HL in _RAM_CFF7_, clears _RAM_D0F0_, writes the VDP destination through _LABEL_98F_, sets source _DATA_20000_ and bank $08, then falls into _LABEL_919_.'],
  },
  {
    offset: 0x00919,
    label: '_LABEL_919_',
    role: 'vram_loader_8fb_record_parser',
    name: '_LABEL_919_ VRAM tile loader record parser',
    summary: 'Parses vram_loader_8fb records as count plus optional destination/source words, switches to the selected source bank, and copies $20-byte tile rows to VRAM.',
    calls: ['_LABEL_B8F_', '_LABEL_1023_', '_LABEL_98F_', '_LABEL_30_', '_LABEL_1036_'],
    readsRAM: ['_RAM_D0F0_', '_RAM_D0EE_', '_RAM_D0F2_', '_RAM_D0F3_'],
    writesRAM: ['_RAM_CF82_', '_RAM_D0F0_', '_RAM_D0EE_', '_RAM_D0F2_', '_RAM_D0F3_', '_RAM_FFFF_'],
    writesVDP: ['VDP address via _LABEL_98F_', 'VDP data via rst $30/_LABEL_30_'],
    bankSwitches: ['source bank selected from record high byte', 'restore via _LABEL_1036_'],
    relatedOffsets: [0x20000],
    evidence: ['_LABEL_919_ stops on a zero count, otherwise loads count, optional destination, optional source/bank, calls _LABEL_1023_, and emits count rows of $20 bytes through rst $30.'],
  },
  {
    offset: 0x0098F,
    label: '_LABEL_98F_',
    role: 'vdp_address_write_helper',
    name: '_LABEL_98F_ VDP address write helper',
    summary: 'Writes a DE VRAM address to the VDP control port, setting the write bit in the high byte.',
    calls: ['_LABEL_28_'],
    writesVDP: ['VDP address via rst $28/_LABEL_28_'],
    evidence: ['_LABEL_98F_ writes E and then D|$40 through rst $28 inside a DI/EI critical section.'],
  },
  {
    offset: 0x00998,
    label: '_LABEL_998_',
    role: 'vram_loader_998_entry',
    name: '_LABEL_998_ screen/tile stream loader entry',
    summary: 'Entry point for vram_loader_998 data; clears DE to start at VRAM $0000 and falls into the shared raw tile stream upload wrapper.',
    calls: ['_LABEL_99B_'],
    writesRAM: ['_RAM_D0F0_'],
    relatedOffsets: [0x0099B],
    evidence: ['_LABEL_998_ loads DE=$0000 and falls through to _LABEL_99B_, so callers use it as the zero-destination vram_loader_998 entry.'],
  },
  {
    offset: 0x0099B,
    label: '_LABEL_99B_',
    role: 'vram_loader_998_upload_wrapper',
    name: '_LABEL_99B_ vram_loader_998 upload wrapper',
    summary: 'Sets the destination, default bank-8 source, parses each loader record through _LABEL_9C3_, uploads rows through _LABEL_A14_, and restores the bank per record.',
    calls: ['_LABEL_98F_', '_LABEL_9C3_', '_LABEL_1023_', '_LABEL_A14_', '_LABEL_1036_'],
    writesRAM: ['_RAM_D0F0_', '_RAM_D0EE_', '_RAM_D0F3_', '_RAM_D0ED_'],
    writesVDP: ['VDP address via _LABEL_98F_', 'VDP data via _LABEL_A14_'],
    bankSwitches: ['source bank selected from parsed record', 'restore via _LABEL_1036_'],
    relatedOffsets: [0x20000],
    evidence: ['_LABEL_99B_ initializes _RAM_D0F0_, _RAM_D0EE_, _RAM_D0F3_, and _RAM_D0ED_, then repeats _LABEL_9C3_, bank switch, _LABEL_A14_, restore.'],
  },
  {
    offset: 0x009C3,
    label: '_LABEL_9C3_',
    role: 'vram_loader_998_record_parser',
    name: '_LABEL_9C3_ vram_loader_998 record parser',
    summary: 'Parses one vram_loader_998 record, updating destination, source, bank, and row count state used by the upload wrapper.',
    calls: ['_LABEL_B8F_'],
    readsRAM: ['_RAM_D0ED_'],
    writesRAM: ['_RAM_D0F0_', '_RAM_D0EE_', '_RAM_D0F2_', '_RAM_D0F3_', '_RAM_D0EC_'],
    relatedOffsets: [0x20000],
    evidence: ['_LABEL_9C3_ returns to the caller on zero terminator; otherwise it handles high-bit destination records, optional source words, bank selection, and row-count setup.'],
  },
  {
    offset: 0x00A14,
    label: '_LABEL_A14_',
    role: 'raw_vram_row_uploader',
    name: '_LABEL_A14_ raw VRAM row uploader',
    summary: 'Copies _RAM_D0F2_ rows of $20 bytes from the current source pointer to consecutive VRAM rows.',
    calls: ['_LABEL_98F_', '_LABEL_30_'],
    readsRAM: ['_RAM_D0F0_', '_RAM_D0EE_', '_RAM_D0F2_'],
    writesRAM: ['_RAM_CF82_', '_RAM_D0F0_', '_RAM_D0EE_'],
    writesVDP: ['VDP address via _LABEL_98F_', 'VDP data via rst $30/_LABEL_30_'],
    evidence: ['_LABEL_A14_ loops over _RAM_D0F2_, calls _LABEL_98F_ for each row destination, emits $20 bytes from _RAM_D0EE_, and advances the VRAM address by $20.'],
  },
  {
    offset: 0x00A48,
    label: '_LABEL_A48_',
    role: 'animation_tile_stream_uploader',
    name: '_LABEL_A48_ animation tile stream uploader',
    summary: 'Consumes an animation tile upload stream, selecting VRAM $4000/$4200, clearing rows on $FF, or copying banked tile bytes from source records.',
    calls: ['_LABEL_28_', '_LABEL_30_', '_LABEL_B8F_'],
    readsRAM: ['_RAM_C27F_', '_RAM_DFFF_'],
    writesRAM: ['_RAM_FFFF_'],
    writesVDP: ['VDP address via rst $28/_LABEL_28_', 'VDP data via rst $30/_LABEL_30_'],
    bankSwitches: ['source bank derived from record word', 'restore previous bank from _RAM_DFFF_'],
    evidence: ['_LABEL_A48_ writes the base VRAM address, stops on zero, emits $20 zero bytes for $FF records, otherwise derives source bank/address and streams copied bytes to VDP data.'],
  },
  {
    offset: 0x01023,
    label: '_LABEL_1023_',
    role: 'bank_push_switch_helper',
    name: '_LABEL_1023_ bank push/switch helper',
    summary: 'Pushes the current mapper bank byte onto the software bank stack and switches to the requested bank.',
    readsRAM: ['_RAM_DFFF_', '_RAM_D121_'],
    writesRAM: ['_RAM_D121_', '_RAM_FFFF_'],
    bankSwitches: ['writes requested bank to _RAM_FFFF_'],
    evidence: ['_LABEL_1023_ reads _RAM_DFFF_, stores it through the _RAM_D121_ stack pointer, increments _RAM_D121_, and writes the requested bank to _RAM_FFFF_.'],
  },
  {
    offset: 0x01036,
    label: '_LABEL_1036_',
    role: 'bank_restore_helper',
    name: '_LABEL_1036_ bank restore helper',
    summary: 'Pops the previous mapper bank byte from the software bank stack and restores it to the mapper register.',
    readsRAM: ['_RAM_D121_'],
    writesRAM: ['_RAM_D121_', '_RAM_FFFF_'],
    bankSwitches: ['restores popped bank to _RAM_FFFF_'],
    evidence: ['_LABEL_1036_ decrements _RAM_D121_, loads the saved bank byte, stores the stack pointer back, and writes the byte to _RAM_FFFF_.'],
  },
  {
    offset: 0x0106E,
    label: '_LABEL_106E_',
    role: 'vdp_register0_bit6_setter',
    name: '_LABEL_106E_ VDP register-0 bit-6 set helper',
    summary: 'Sets bit 6 in the VDP register-0 shadow and writes the updated register value to the VDP control port.',
    readsRAM: ['_RAM_CF6C_'],
    writesRAM: ['_RAM_CF6C_'],
    writesVDP: ['VDP control via rst $28/_LABEL_28_'],
    evidence: ['_LABEL_106E_ loads _RAM_CF6C_, sets bit 6, stores it back, then writes the value and register selector $80 through rst $28.'],
  },
  {
    offset: 0x107D,
    label: '_LABEL_107D_',
    role: 'vdp_register0_bit6_clearer',
    name: '_LABEL_107D_ VDP register-0 bit-6 clear helper',
    summary: 'Clears bit 6 in the VDP register-0 shadow and writes the updated register value to the VDP control port.',
    readsRAM: ['_RAM_CF6C_'],
    writesRAM: ['_RAM_CF6C_'],
    writesVDP: ['VDP control via rst $28/_LABEL_28_'],
    evidence: ['_LABEL_107D_ loads _RAM_CF6C_, clears bit 6, stores it back, then writes the value and register selector $80 through rst $28.'],
  },
  {
    offset: 0x010BC,
    label: '_LABEL_10BC_',
    role: 'palette_effect_script_driver',
    name: '_LABEL_10BC_ palette effect script driver',
    summary: 'Selects bank-7 palette effect scripts from _DATA_1C800_, applies timed palette updates into BG or sprite CRAM shadows, and handles $F0 jump/$FF end controls.',
    calls: ['_LABEL_1023_', '_LABEL_8_', '_LABEL_18_', '_LABEL_1036_'],
    readsRAM: ['_RAM_CF65_', '_RAM_D020_', '_RAM_D022_'],
    writesRAM: ['_RAM_CF65_', '_RAM_D020_', '_RAM_D022_', '_RAM_CFBB_', '_RAM_CF9B_', '_RAM_CFE2_'],
    bankSwitches: ['bank 7 via _LABEL_1023_', 'restore via _LABEL_1036_'],
    relatedOffsets: [0x1C800],
    evidence: ['_LABEL_10BC_ indexes _DATA_1C800_ when _RAM_CF65_ is not $FE/$FF, stores the script pointer in _RAM_D020_, and writes palette bytes to _RAM_CFBB_ or _RAM_CF9B_.'],
  },
  {
    offset: 0x02518,
    label: '_LABEL_2518_',
    role: 'status_name_table_tile_writer',
    name: '_LABEL_2518_ status name-table tile writer',
    summary: 'Writes status/name-table tile pairs and attribute bytes to two VDP rows, selecting fragments from _DATA_25E4_, _DATA_2618_, and _DATA_261C_.',
    calls: ['_LABEL_25A4_', '_LABEL_28_', '_LABEL_30_'],
    readsRAM: ['_RAM_D0DE_', '_RAM_CF82_'],
    writesRAM: ['_RAM_CF82_'],
    writesVDP: ['VDP address via rst $28/_LABEL_28_', 'VDP data via rst $30/_LABEL_30_'],
    relatedOffsets: [0x025E4, 0x02618, 0x0261C, 0x025D6],
    evidence: ['_LABEL_2518_ calls _LABEL_25A4_ for source-tile upload, then writes tile pairs from _DATA_25E4_/_DATA_2618_/_DATA_261C_ with fixed attribute byte $19.'],
  },
  {
    offset: 0x025A4,
    label: '_LABEL_25A4_',
    role: 'status_tile_source_upload',
    name: '_LABEL_25A4_ status tile source upload',
    summary: 'Uses the status tile source index table to copy one $40-byte tile block from bank-8 graphics data into VRAM.',
    calls: ['_LABEL_1023_', '_LABEL_B8F_', '_LABEL_28_', '_LABEL_30_', '_LABEL_1036_'],
    readsRAM: ['_RAM_DFFF_', '_RAM_D121_'],
    writesRAM: ['_RAM_D121_', '_RAM_FFFF_'],
    writesVDP: ['VDP address via rst $28/_LABEL_28_', 'VDP data via rst $30/_LABEL_30_'],
    bankSwitches: ['bank 8 via _LABEL_1023_', 'restore via _LABEL_1036_'],
    relatedOffsets: [0x025D6, 0x20000],
    evidence: ['_LABEL_25A4_ indexes _DATA_25D6_, switches to bank 8, converts the selected tile index with _LABEL_B8F_, and emits $40 bytes to VRAM address $6200.'],
  },
  {
    offset: 0x02620,
    label: '_LABEL_2620_',
    role: 'room_entry_loader',
    name: '_LABEL_2620_ room entry loader',
    summary: 'Loads a room record from bank 4, initializes player/camera state fields, calls the room asset loader, applies palette effects, resets entity state, and rebuilds the sprite list.',
    calls: ['_LABEL_1023_', '_LABEL_18_', '_LABEL_26F4_', '_LABEL_10BC_', '_LABEL_10A4_', '_LABEL_FA1_', '_LABEL_E83_', '_LABEL_2948_', '_LABEL_6E7_', '_LABEL_1036_'],
    readsRAM: ['_RAM_C270_', '_RAM_C24F_', '_RAM_C260_', '_RAM_C26E_', '_RAM_CF65_'],
    writesRAM: ['_RAM_C243_', '_RAM_C246_', '_RAM_C241_', '_RAM_C242_', '_RAM_C245_', '_RAM_C247_', '_RAM_C248_', '_RAM_C24A_', '_RAM_D006_', '_RAM_D000_', '_RAM_D1B0_', '_RAM_D1BA_', '_RAM_D025_', '_RAM_D224_', '_RAM_C27D_', '_RAM_D223_'],
    bankSwitches: ['bank 4 via _LABEL_1023_', 'restore via _LABEL_1036_'],
    relatedOffsets: [0x026F4],
    evidence: ['_LABEL_2620_ switches to bank 4, reads room bytes from HL, calls _LABEL_26F4_ for room graphics/map assets, then calls palette/entity/sprite setup routines before restoring the bank.'],
  },
  {
    offset: 0x026F4,
    label: '_LABEL_26F4_',
    role: 'room_asset_loader',
    name: '_LABEL_26F4_ room asset loader',
    summary: 'Consumes the room asset payload: copies palette/context bytes, runs vram_loader_8fb data, decompresses scroll/map records, conditionally runs vram_loader_998 data, applies palette pair indexes, and triggers music when needed.',
    calls: ['_LABEL_18_', '_LABEL_8FB_', '_LABEL_DC2_', '_LABEL_998_', '_LABEL_8B2_', '_LABEL_104B_'],
    readsRAM: ['_RAM_D0FE_', '_RAM_CFF9_', '_RAM_C26E_'],
    writesRAM: ['_RAM_CF5E_', '_RAM_D0FE_', '_RAM_CFF9_'],
    writesVDP: ['VRAM writes through _LABEL_8FB_/_LABEL_998_'],
    relatedOffsets: [0x00006, 0x0275D, 0x02762],
    evidence: ['_LABEL_26F4_ copies eight room context bytes to _RAM_CF5E_, calls _LABEL_8FB_, calls _LABEL_DC2_, selects optional _DATA_275D_/_DATA_2762_ screen data for _LABEL_998_, then calls _LABEL_8B2_.'],
  },
  {
    offset: 0x036E8,
    label: '_LABEL_36E8_',
    role: 'player_form_name_vdp_writer',
    name: '_LABEL_36E8_ player form-name VDP writer',
    summary: 'Indexes the player-form name text table by current form and writes eleven tile ids with fixed attribute bytes to the VDP destination in DE.',
    calls: ['_LABEL_28_', '_LABEL_30_'],
    readsRAM: ['_RAM_C24F_'],
    writesRAM: ['_RAM_CF82_'],
    writesVDP: ['VDP address via rst $28/_LABEL_28_', 'VDP data via rst $30/_LABEL_30_'],
    relatedOffsets: [0x1C220],
    evidence: ['_LABEL_36E8_ computes _RAM_C24F_ * 11, adds it to _DATA_1C220_, writes DE to the VDP control port, then emits $0B table bytes with attribute byte $09.'],
  },
  {
    offset: 0x006E7,
    label: '_LABEL_6E7_',
    role: 'sprite_oam_shadow_rebuild_driver',
    name: '_LABEL_6E7_ sprite/OAM shadow rebuild driver',
    summary: 'Switches to bank 6, walks the player and active entity slots, calls the metasprite emitter for visible entries, then marks sprite/OAM shadow state dirty.',
    calls: ['_LABEL_1023_', '_LABEL_760_', '_LABEL_1036_'],
    readsRAM: ['_RAM_C240_', '_RAM_C280_', '_RAM_C600_', '_RAM_C640_', '_RAM_D004_'],
    writesRAM: ['_RAM_CA40_', '_RAM_D004_', '_RAM_D0DE_', '_RAM_CFE3_', '_RAM_CFE0_'],
    bankSwitches: ['bank 6 via _LABEL_1023_', 'restore via _LABEL_1036_'],
    relatedOffsets: [0x00760],
    evidence: ['_LABEL_6E7_ switches to bank 6, scans player and entity records with bit tests on IX+0, calls _LABEL_760_ for drawable records, writes $D0 sentinel to _RAM_CA40_, and sets _RAM_CFE0_.'],
  },
  {
    offset: 0x00760,
    label: '_LABEL_760_',
    role: 'metasprite_to_oam_shadow_emitter',
    name: '_LABEL_760_ metasprite-to-OAM shadow emitter',
    summary: 'Reads a metasprite command stream from the entity animation pointer, applies camera-relative position tests, and writes Y/X/tile triples into the OAM shadow buffer.',
    calls: [],
    readsRAM: ['_RAM_D007_', '_RAM_D009_', '_RAM_D00B_', '_RAM_D00D_'],
    writesRAM: ['_RAM_D00B_', '_RAM_D00D_', '_RAM_CA40_'],
    evidence: ['_LABEL_760_ reads the stream pointer from IX+12/IX+13, stops on $80, skips hidden/offscreen entries, and writes three-byte sprite entries through IY before decrementing the sprite capacity counter.'],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function regionStart(region) {
  return parseInt(region.offset, 16);
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(region => {
    const start = regionStart(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id,
    name: region.name || '',
    type: region.type || 'unknown',
    offset: region.offset,
    size: region.size || 0,
  };
}

function buildCatalog(mapData) {
  const routines = ROUTINES.map(def => {
    const region = findContainingRegion(mapData, def.offset);
    const relatedRegions = (def.relatedOffsets || [])
      .map(offset => regionRef(findContainingRegion(mapData, offset)))
      .filter(Boolean);
    return {
      id: `${def.label}_${def.role}`,
      label: def.label,
      offset: hex(def.offset),
      role: def.role,
      proposedName: def.name,
      summary: def.summary,
      confidence: 'high',
      region: regionRef(region),
      calls: def.calls || [],
      readsRAM: def.readsRAM || [],
      writesRAM: def.writesRAM || [],
      writesVDP: def.writesVDP || [],
      bankSwitches: def.bankSwitches || [],
      relatedRegions,
      evidence: def.evidence,
    };
  });

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    routines,
    summary: {
      routineCount: routines.length,
      missingRegions: routines.filter(routine => !routine.region).length,
      roleCounts: routines.reduce((counts, routine) => {
        counts[routine.role] = (counts[routine.role] || 0) + 1;
        return counts;
      }, {}),
      assetPolicy: 'Metadata only: labels, offsets, routine roles, RAM/VDP effects, call references, and related region refs. No ROM bytes or decoded graphics/text/audio are embedded.',
    },
  };
}

function annotateRegion(region, routine) {
  const previousName = region.name || '';
  if (!previousName && routine.proposedName) region.name = routine.proposedName;
  region.analysis = region.analysis || {};
  region.analysis.vdpRenderRoutineAudit = {
    kind: routine.role,
    label: routine.label,
    summary: routine.summary,
    confidence: routine.confidence,
    catalogId,
    nameBeforeAudit: previousName,
    nameAfterAudit: region.name || '',
    detail: {
      routineOffset: routine.offset,
      regionOffset: region.offset,
      calls: routine.calls,
      readsRAM: routine.readsRAM,
      writesRAM: routine.writesRAM,
      writesVDP: routine.writesVDP,
      bankSwitches: routine.bankSwitches,
      relatedRegions: routine.relatedRegions,
    },
    evidence: routine.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    label: routine.label,
    role: routine.role,
    previousName,
    name: region.name || '',
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const missingRegions = catalog.routines
    .filter(routine => !routine.region)
    .map(routine => ({ label: routine.label, offset: routine.offset, role: routine.role }));
  const annotatedRegions = [];

  if (apply) {
    for (const routine of catalog.routines) {
      if (!routine.region) continue;
      const region = mapData.regions.find(item => item.id === routine.region.id);
      annotatedRegions.push(annotateRegion(region, routine));
    }

    const finalCatalog = buildCatalog(mapData);
    mapData.vdpRenderRoutineCatalogs = (mapData.vdpRenderRoutineCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpRenderRoutineCatalogs.push(finalCatalog);

    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'vdp_render_routine_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
      routines: finalCatalog.routines,
      annotatedRegions,
      missingRegions,
      nextLeads: [
        'Model the _LABEL_604_ stream opcodes as a parser so VDP stream previews can show control-flow and wait/scroll commands separately from tile writes.',
        'Connect _LABEL_2620_ room records to sceneRecipes so each known scene has routine-level provenance from room payload to VRAM/CRAM state.',
        'Extend the sprite audit from _LABEL_6E7_/_LABEL_760_ into the bank-6 metasprite frame stream format and OAM shadow layout.',
      ],
    });

    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: apply ? annotatedRegions : catalog.routines
      .filter(routine => routine.region)
      .map(routine => ({
        id: routine.region.id,
        offset: routine.region.offset,
        label: routine.label,
        role: routine.role,
        currentName: routine.region.name || '',
        proposedName: routine.proposedName,
      })),
    missingRegions,
  }, null, 2));
}

main();
