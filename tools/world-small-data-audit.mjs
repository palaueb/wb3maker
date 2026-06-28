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
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-small-data-catalog-2026-06-24';
const reportId = 'small-data-audit-2026-06-24';

const SMALL_TABLES = [
  {
    offset: 0x002AC,
    inferredType: 'data_table',
    role: 'vdp_init_register_shadow_table',
    summary: 'Twenty-byte VDP register initialization table copied to the VDP control port and RAM register shadow during startup.',
    evidence: ['_LABEL_29C_ loads _DATA_2AC_, iterates $14 bytes, writes each byte through rst $28/_LABEL_28_, and mirrors it to _RAM_CF6C_.'],
  },
  {
    offset: 0x00481,
    inferredType: 'data_table',
    role: 'status_scroll_offset_table',
    summary: 'Word table selected by _LABEL_45D_ to initialize _RAM_CF52_ from _RAM_CF54_.',
    evidence: ['_LABEL_45D_ indexes _DATA_481_ with rst $08/rst $10 and stores DE into _RAM_CF52_.'],
  },
  {
    offset: 0x025D6,
    inferredType: 'data_table',
    role: 'status_tile_source_index_table',
    summary: 'Byte table used by _LABEL_25A4_ to select a bank-8 tile source offset.',
    evidence: ['_LABEL_25A4_ indexes _DATA_25D6_, bank-switches to bank 8, then copies $40 bytes from _DATA_20000_ plus the selected offset.'],
  },
  {
    offset: 0x025E4,
    inferredType: 'tile_map',
    role: 'status_name_table_tile_pairs',
    summary: 'Tile-id pairs written by _LABEL_2518_ into the status/name-table area.',
    evidence: ['_LABEL_2518_ selects _DATA_25E4_ and writes pairs through rst $30 to VDP data with attribute byte $19.'],
  },
  {
    offset: 0x02618,
    inferredType: 'tile_map',
    role: 'status_name_table_overflow_tile_pair',
    summary: 'Four-byte tile pair fragment emitted when the status/name-table scroll crosses a page.',
    evidence: ['_LABEL_2518_ selects _DATA_2618_ before writing tile pairs through the same VDP helper as _DATA_25E4_.'],
  },
  {
    offset: 0x0261C,
    inferredType: 'tile_map',
    role: 'status_name_table_blank_tile_pair',
    summary: 'Four-byte blank tile pair fragment emitted by _LABEL_2518_.',
    evidence: ['_LABEL_2518_ selects _DATA_261C_ when filling remaining status/name-table slots through the same VDP helper.'],
  },
  {
    offset: 0x02C53,
    inferredType: 'data_table',
    role: 'shop_menu_value_table',
    summary: 'Literal-address byte table used by shop/menu state _LABEL_2BF8_.',
    evidence: ['_LABEL_2BF8_ adds _RAM_D11C_ to literal base $2C53 and passes the selected byte to _LABEL_2E60_.'],
  },
  {
    offset: 0x02CA4,
    inferredType: 'data_table',
    role: 'shop_menu_value_table',
    summary: 'Byte table indexed by _RAM_D11C_ in shop/menu state _LABEL_2C5D_.',
    evidence: ['_LABEL_2C5D_ indexes _DATA_2CA4_ and passes the selected byte to _LABEL_2E1A_.'],
  },
  {
    offset: 0x02CF5,
    inferredType: 'data_table',
    role: 'shop_menu_value_table',
    summary: 'Byte table indexed by _RAM_D11C_ in shop/menu state _LABEL_2CAE_.',
    evidence: ['_LABEL_2CAE_ indexes _DATA_2CF5_ and passes the selected byte to _LABEL_2E1A_.'],
  },
  {
    offset: 0x02D46,
    inferredType: 'data_table',
    role: 'shop_menu_value_table',
    summary: 'Byte table indexed by _RAM_D11C_ in shop/menu state _LABEL_2CFF_.',
    evidence: ['_LABEL_2CFF_ indexes _DATA_2D46_ and passes the selected byte to _LABEL_2E1A_.'],
  },
  {
    offset: 0x03824,
    inferredType: 'text',
    role: 'shop_text_tile_ids',
    summary: 'Short text/tile-id run written by _LABEL_37F8_ directly to VDP data.',
    evidence: ['_LABEL_37F8_ loads _DATA_3824_, writes ten bytes through rst $30, and pairs each with attribute byte $09.'],
  },
  {
    offset: 0x03F43,
    inferredType: 'text',
    role: 'secret_password_compare_text',
    summary: 'Fourteen-byte password/text sequence compared against the entered password buffer before unlocking the replacement sequence.',
    evidence: ['_LABEL_3EE6_ calls a helper that compares _DATA_3F43_ against _RAM_D137_ for $0E bytes before selecting _DATA_3F51_.'],
  },
  {
    offset: 0x03F51,
    inferredType: 'text',
    role: 'secret_password_replacement_text',
    summary: 'Fourteen-byte password/text sequence copied into the entered password buffer when the comparison sequence matches.',
    evidence: ['The _LABEL_3EE6_ helper copies _DATA_3F51_ to _RAM_D137_ with bc=$000E when _DATA_3F43_ matches the buffer.'],
  },
  {
    offset: 0x055C1,
    inferredType: 'data_table',
    role: 'player_transition_velocity_table',
    summary: 'Small signed/velocity lookup used by _LABEL_54CB_ for player state transitions.',
    evidence: ['_LABEL_54CB_ indexes _DATA_55C1_ using _RAM_C271_ plus state bits and stores the selected byte as the high byte of a velocity word.'],
  },
  {
    offset: 0x05674,
    inferredType: 'data_table',
    role: 'player_transition_vector_table',
    summary: 'Eight two-byte vector/parameter pairs selected by _LABEL_55C9_ and _LABEL_5611_ from _RAM_C271_ plus _RAM_C251_.',
    evidence: [
      '_LABEL_55C9_ and _LABEL_5611_ compute ((_RAM_C271_ * 2) + _RAM_C251_) * 2, index _DATA_5674_, and store the selected pair in _RAM_C25E_/_RAM_C25F_.',
      'The region was previously decoded as screen_prog only because the bytes accidentally form a terminated stream when interpreted with the wrong decoder.',
    ],
  },
  {
    offset: 0x05775,
    inferredType: 'data_table',
    role: 'entity_vertical_offset_sequence',
    summary: 'Terminated byte sequence used by the _LABEL_56F4_ entity path state, correcting an earlier false vram_loader_998 classification.',
    allowRetypeFrom: ['vram_loader_998'],
    evidence: [
      '_LABEL_56F4_ stores _DATA_5775_ in IX+32/IX+33, not in HL before a _LABEL_998_ call.',
      '_LABEL_5750_ reads one byte per update from IX+32/IX+33, stops on $FF, subtracts the byte from IX+34, and writes the result to IX+6.',
    ],
  },
  {
    offset: 0x061BA,
    inferredType: 'tile_map',
    role: 'two_row_vdp_tile_fragment',
    summary: 'Eight tile ids written as two four-tile rows by _LABEL_617B_.',
    evidence: ['_LABEL_617B_ loads _DATA_61BA_ and writes two four-byte rows through rst $30 with attribute byte $09.'],
  },
  {
    offset: 0x0699C,
    inferredType: 'data_table',
    role: 'entity_spawn_offset_table',
    summary: 'Sixteen signed word offsets used by entity routine _LABEL_6974_.',
    evidence: ['_LABEL_6974_ indexes _DATA_699C_ by (_RAM_D21B_ & $0F), reads a signed word, and adds it to _RAM_C243_.'],
  },
  {
    offset: 0x0B77D,
    inferredType: 'data_table',
    role: 'transition_timing_table',
    summary: 'Duration table consumed by the transition loop at _LABEL_B718_.',
    evidence: ['_LABEL_B6CA_ stores _DATA_B77D_ in _RAM_D104_; _LABEL_B718_ reads durations until the $FF terminator.'],
  },
  {
    offset: 0x0BFB0,
    inferredType: 'pointer_table',
    role: 'entity_animation_selector_table',
    summary: 'Five-entry word table indexed by _RAM_C24F_ in _LABEL_BB13_.',
    evidence: ['_LABEL_BB13_ indexes _DATA_BFB0_ with rst $08/rst $10 and copies the selected word into entity state fields _RAM_C3FF_ and _RAM_C3CF_.'],
  },
  {
    offset: 0x1C1EF,
    inferredType: 'data_table',
    role: 'bank7_record_table_child',
    summary: 'Fifth child record block of the bank-7 pointer table at _DATA_1C000_.',
    evidence: ['ASM identifies _DATA_1C1EF_ as the fifth entry of _DATA_1C000_, a bank-7 pointer table with five data-record children.'],
  },
  {
    offset: 0x1C220,
    inferredType: 'text',
    role: 'player_form_name_tile_text_table',
    summary: 'Player-form name tile text table selected by current form and written to VDP as eleven tile ids with a fixed attribute byte.',
    evidence: ['_LABEL_36E8_ indexes _DATA_1C220_ by _RAM_C24F_ * 11, then writes $0B bytes through rst $30 with attribute byte $09.'],
  },
  {
    offset: 0x1C8B3,
    inferredType: 'palette_script',
    role: 'palette_effect_script_record',
    summary: 'Palette-effect script entry of _DATA_1C800_ consumed by _LABEL_10BC_ and selected through _RAM_CF65_.',
    evidence: ['_LABEL_10BC_ indexes _DATA_1C800_ by _RAM_CF65_; the selected script writes palette values into _RAM_CFBB/_RAM_CF9B and handles $F0 jump/$FF end controls.'],
  },
  {
    offset: 0x1C9F8,
    inferredType: 'palette_script',
    role: 'palette_effect_script_record',
    summary: 'Palette-effect script entry of _DATA_1C800_ consumed by _LABEL_10BC_ and selected through _RAM_CF65_.',
    evidence: ['_LABEL_10BC_ indexes _DATA_1C800_ by _RAM_CF65_; _DATA_1C9F8_ is the twentieth palette-script child in that table.'],
  },
  {
    offset: 0x1CA5B,
    inferredType: 'palette_script',
    role: 'palette_effect_script_record',
    summary: 'Palette-effect script entry of _DATA_1C800_ consumed by _LABEL_10BC_ and selected through _RAM_CF65_.',
    evidence: ['_LABEL_10BC_ indexes _DATA_1C800_ by _RAM_CF65_; _DATA_1CA5B_ is the twenty-third palette-script child in that table.'],
  },
  {
    offset: 0x1E360,
    inferredType: 'data_table',
    role: 'ending_entity_path_table',
    summary: 'Triplet/word path table consumed by _LABEL_1E38A_ for the bank-7 ending/special entity sequence.',
    evidence: ['The bank-7 routine stores _DATA_1E360_ in _RAM_C2B0_; _LABEL_1E38A_ reads three words from that stream into _RAM_C288_, _RAM_C28A_, and _RAM_C2B8_.'],
  },
  {
    offset: 0x1E379,
    inferredType: 'data_table',
    role: 'ending_entity_timing_table',
    summary: 'Duration/value pairs consumed by _LABEL_1E3A8_ for the same bank-7 ending/special entity sequence.',
    evidence: ['The bank-7 routine stores _DATA_1E379_ in _RAM_C2B4_; _LABEL_1E3A8_ reads duration/value pairs until $FF.'],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(r => {
    const start = parseInt(r.offset, 16);
    return offset >= start && offset < start + (r.size || 0);
  }) || null;
}

function byteStats(rom, offset, size) {
  const bytes = rom.subarray(offset, offset + size);
  let zeros = 0;
  let ff = 0;
  let f0Plus = 0;
  for (const byte of bytes) {
    if (byte === 0) zeros++;
    if (byte === 0xFF) ff++;
    if (byte >= 0xF0) f0Plus++;
  }
  return {
    size,
    zeroBytes: zeros,
    ffBytes: ff,
    f0PlusBytes: f0Plus,
    zeroRatio: Number((zeros / Math.max(1, size)).toFixed(4)),
    ffRatio: Number((ff / Math.max(1, size)).toFixed(4)),
  };
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id,
    name: region.name || '',
    type: region.type || 'unknown',
    offset: region.offset,
  };
}

function buildCatalog(rom, mapData) {
  const entries = SMALL_TABLES.map(def => {
    const region = findContainingRegion(mapData, def.offset);
    const start = region ? parseInt(region.offset, 16) : def.offset;
    const size = region?.size || 0;
    return {
      id: def.role + '_' + def.offset.toString(16).toUpperCase(),
      offset: hex(def.offset),
      inferredType: def.inferredType,
      role: def.role,
      summary: def.summary,
      region: regionRef(region),
      byteStats: region ? byteStats(rom, start, size) : null,
      evidence: def.evidence,
    };
  });
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-small-data-audit.mjs',
    entries,
    summary: {
      auditedOffsets: entries.length,
      missingRegions: entries.filter(entry => !entry.region).length,
      typeCounts: entries.reduce((counts, entry) => {
        counts[entry.inferredType] = (counts[entry.inferredType] || 0) + 1;
        return counts;
      }, {}),
      assetPolicy: 'Metadata only: offsets, classifications, byte statistics, and routine evidence. No ROM bytes or decoded copyrighted assets are embedded.',
    },
  };
}

function shouldChange(region, inferredType) {
  const currentType = region.type || 'unknown';
  if (currentType === inferredType) return false;
  const def = SMALL_TABLES.find(item => item.inferredType === inferredType && findContainingRegion({ regions: [region] }, item.offset));
  if (def?.allowRetypeFrom?.includes(currentType)) return true;
  return ['unknown', 'raw_byte', 'data_table', 'screen_prog'].includes(currentType);
}

function annotateRegion(region, entry) {
  const previousType = region.type || 'unknown';
  const changedType = shouldChange(region, entry.inferredType);
  if (changedType) region.type = entry.inferredType;
  region.analysis = region.analysis || {};
  const existing = region.analysis.smallDataAudit || {};
  region.analysis.smallDataAudit = {
    kind: entry.role,
    summary: entry.summary,
    confidence: 'high',
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    detail: {
      auditedOffset: entry.offset,
      inferredType: entry.inferredType,
      byteStats: entry.byteStats,
    },
    evidence: entry.evidence,
    generatedAt: now,
    tool: 'tools/world-small-data-audit.mjs',
  };
  return changedType;
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const evidenceOnlyRegions = [];
  const missingRegions = [];
  for (const entry of catalog.entries) {
    const region = entry.region ? mapData.regions.find(r => r.id === entry.region.id) : null;
    if (!region) {
      missingRegions.push({ offset: entry.offset, inferredType: entry.inferredType, role: entry.role });
      continue;
    }
    const wouldChange = shouldChange(region, entry.inferredType);
    if (!apply) {
      (wouldChange ? changedRegions : evidenceOnlyRegions).push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType: region.type || 'unknown',
        inferredType: entry.inferredType,
        role: entry.role,
      });
      continue;
    }
    const previousType = region.type || 'unknown';
    const changed = annotateRegion(region, entry);
    (changed ? changedRegions : evidenceOnlyRegions).push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType,
      type: region.type || 'unknown',
      inferredType: entry.inferredType,
      role: entry.role,
    });
  }
  return { changedRegions, evidenceOnlyRegions, missingRegions };
}

function collectConfirmedChangedRegions(mapData) {
  return mapData.regions
    .filter(region => region.analysis?.smallDataAudit?.catalogId === catalogId && region.analysis.smallDataAudit.changedType)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType: region.analysis.smallDataAudit.typeBeforeAudit || 'unknown',
      type: region.type || 'unknown',
      kind: region.analysis.smallDataAudit.kind,
    }));
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(rom, mapData);
    const confirmedChangedRegions = collectConfirmedChangedRegions(mapData);
    mapData.smallDataCatalogs = (mapData.smallDataCatalogs || []).filter(c => c.id !== catalogId);
    mapData.smallDataCatalogs.push(finalCatalog);

    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'small_data_audit',
      generatedAt: now,
      tool: 'tools/world-small-data-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegionTypes: confirmedChangedRegions.length,
        changedRegionTypesThisRun: annotation.changedRegions.length,
        evidenceOnlyRegions: annotation.evidenceOnlyRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      changedRegions: confirmedChangedRegions,
      changedRegionsThisRun: annotation.changedRegions,
      evidenceOnlyRegions: annotation.evidenceOnlyRegions,
      missingRegions: annotation.missingRegions,
      entries: finalCatalog.entries,
      nextLeads: [
        'Extend the audio audit to classify the remaining small unknown fragments inside bank 3 music streams.',
        'Trace _DATA_1C000_ and _DATA_1DB6C_ pointer-table consumers before retyping their remaining children.',
        'Split mixed text/tile/data regions only after the analyzer supports non-destructive subregion metadata.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegionTypes: annotation.changedRegions.length,
    changedRegions: annotation.changedRegions,
    evidenceOnlyRegions: annotation.evidenceOnlyRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
