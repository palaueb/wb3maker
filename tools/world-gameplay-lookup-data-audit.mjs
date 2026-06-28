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
const catalogId = 'world-gameplay-lookup-data-catalog-2026-06-25';
const reportId = 'gameplay-lookup-data-audit-2026-06-25';

const tables = [
  {
    regionId: 'r0058',
    offset: 0x03B6D,
    type: 'data_table',
    role: 'password_character_decode_alias_table',
    name: 'password character decode alias table',
    confidence: 'high',
    summary: '_LABEL_3B58_ maps accepted password characters outside the compact 0x30-0x40 range into 5-bit password indexes.',
    evidence: [
      'ASM lines 9232-9247 subtract 0x30, range-check the character, and index _DATA_3B6D_ for alias characters.',
      'ASM lines 9199-9230 call _LABEL_3B58_ while packing the 14-character password buffer into bit storage.',
      'ASM lines 10166-10214 reuse _LABEL_3B58_ while incrementing/decrementing password-entry characters.',
    ],
  },
  {
    regionId: 'r0059',
    offset: 0x03BC1,
    type: 'data_table',
    role: 'password_alphabet_lookup_table',
    name: 'password alphabet lookup table',
    confidence: 'high',
    summary: '32-entry lookup converting 5-bit password indexes back to displayable password characters.',
    evidence: [
      'ASM lines 9254-9291 unpack 5-bit values and index _DATA_3BC1_ to rebuild the password buffer.',
      'ASM lines 10166-10214 use _DATA_3BC1_ to select the previous/next allowed password-entry character.',
    ],
  },
  {
    regionId: 'r0061',
    offset: 0x03E89,
    type: 'data_table',
    role: 'password_xor_mask_table',
    name: 'password xor/check mask table',
    confidence: 'high',
    summary: 'Four 9-byte masks selected from password-bit state and XORed into the password work buffer.',
    evidence: [
      'ASM lines 9696-9715 compute a 0..3 index, multiply by 9, and add _DATA_3E89_.',
      'ASM lines 9717-9726 XOR nine mask bytes into _RAM_D145_ and following password work bytes.',
    ],
  },
  {
    regionId: 'r0064',
    offset: 0x03FC6,
    type: 'data_table',
    role: 'password_entry_vdp_address_table',
    name: 'password entry VDP address table',
    confidence: 'high',
    summary: 'Fourteen VDP destination words used to draw/edit the password entry buffer.',
    evidence: [
      'ASM lines 9856-9886 walk _DATA_3FC6_ as VDP address words and draw the active password buffer from _RAM_D137_.',
      'ASM lines 10216-10237 call cursor redraw helpers that use the same password-entry layout.',
    ],
  },
  {
    regionId: 'r0065',
    offset: 0x03FE2,
    type: 'data_table',
    role: 'password_display_vdp_address_table',
    name: 'password display VDP address table',
    confidence: 'high',
    summary: 'Fourteen VDP destination words used by the password display routine.',
    evidence: [
      'ASM lines 9298-9317 walk _DATA_3FE2_ as VDP address words and draw the password buffer from _RAM_D137_.',
    ],
  },
  {
    regionId: 'r0085',
    offset: 0x04BF8,
    type: 'data_table',
    role: 'player_knockback_velocity_table',
    name: 'player knockback velocity table',
    confidence: 'high',
    summary: 'Eight two-byte velocity values selected by player form/state and collision direction during player damage knockback.',
    evidence: [
      'ASM lines 11451-11466 derive an index from _RAM_C24F_, _RAM_C241_, and IX flags, then read a word from _DATA_4BF8_.',
      'ASM lines 11435-11448 set up player damage state and write the selected word to _RAM_C248_.',
    ],
  },
  {
    regionId: 'r0086',
    offset: 0x04C08,
    type: 'data_table',
    role: 'player_knockback_alt_velocity_table',
    name: 'player knockback alternate velocity table',
    confidence: 'medium',
    summary: 'Sixteen two-byte velocity values referenced by bank-7 pointer records and adjacent to the player knockback velocity table.',
    evidence: [
      'ASM lines 11529-11533 define _DATA_4C08_ as the second entry of a bank-7 pointer table.',
      'ASM lines 28436 and 28466 reference _DATA_4C08_ in pointer records alongside RAM destination expressions.',
      '_DATA_4C08_ is adjacent to the confirmed _DATA_4BF8_ player knockback velocity table and has the same signed word-pair shape.',
    ],
  },
  {
    regionId: 'r0099',
    offset: 0x05C2A,
    type: 'data_table',
    role: 'palette_reveal_mask_table',
    name: 'palette reveal mask table',
    confidence: 'high',
    summary: '32-byte mask copied into active palette buffers and progressively patched from shadow palettes during reveal/fade.',
    evidence: [
      'ASM lines 13560-13567 copy _DATA_5C2A_ into _RAM_CFBB_.',
      'ASM lines 13568-13584 patch active background/sprite palette buffers from _RAM_CF9B_/_RAM_CFAB_ during a 16-step loop.',
      'ASM lines 13585-13597 request palette flushing via _RAM_CFE2_.',
    ],
  },
  {
    regionId: 'r0103',
    offset: 0x05DE2,
    type: 'entity_data',
    role: 'entity_random_variant_threshold_table',
    name: 'entity random variant threshold/mask table',
    confidence: 'medium',
    summary: 'Sixteen word pairs selected by entity subtype and zone flag; _LABEL_D36_ randomizes within the selected mask/range before choosing an entity state.',
    evidence: [
      'ASM lines 13752-13761 derive an index from _RAM_CF66_ and IX+62, then read a word pair from _DATA_5DE2_.',
      'ASM lines 13763-13777 call _LABEL_D36_, apply the selected mask/range, and store the result in IX+34.',
      'ASM lines 13778-13789 choose the next entity state from the generated value.',
    ],
  },
  {
    regionId: 'r0112',
    offset: 0x063E2,
    type: 'item_data',
    role: 'pickup_object_spawn_id_lookup',
    name: 'pickup object spawn id lookup table',
    confidence: 'high',
    summary: 'Maps collected/uncollected item indexes to pending object spawn IDs in _RAM_D025_.',
    evidence: [
      'ASM lines 14549-14572 check _RAM_D1EB_ collection flags, index _DATA_63E2_, and write the resulting object ID to _RAM_D025_.',
      'ASM lines 14584-14594 compute spawn coordinates/direction into _RAM_D026_, _RAM_D028_, and _RAM_D029_.',
    ],
  },
  {
    regionId: 'r0118',
    offset: 0x0699C,
    type: 'entity_data',
    role: 'entity_spawn_offset_table',
    name: 'entity spawn offset table',
    confidence: 'high',
    summary: 'Sixteen signed word offsets added to player/world X position to place a spawned entity.',
    evidence: [
      'ASM lines 15130-15141 increment _RAM_D21B_, mask it to 0x0F, read a word from _DATA_699C_, and add it to _RAM_C243_.',
      'ASM lines 15142-15149 align the resulting X coordinate and initialize entity state.',
    ],
  },
  {
    regionId: 'r0119',
    offset: 0x069FB,
    type: 'entity_data',
    role: 'entity_position_pattern_table',
    name: 'entity position pattern table',
    confidence: 'high',
    summary: 'Twenty word positions selected by _RAM_D21C_ during a timed entity pattern.',
    evidence: [
      'ASM lines 15161-15175 bound _RAM_D21C_, index _DATA_69FB_, and read a word into DE.',
      'ASM lines 15176-15189 store the selected word into IX+3/IX+4 and initialize the entity state.',
    ],
  },
];

const routines = [
  ['r2266', 'password_character_to_index', '_LABEL_3B58_ password character-to-index helper'],
  ['r1792', 'password_index_to_character', '_LABEL_3B87_ password index-to-character routine'],
  ['r1793', 'password_display_writer', '_LABEL_3BE1_ password display writer'],
  ['r1794', 'password_xor_mask_apply', '_LABEL_3E5D_ password mask apply routine'],
  ['r1796', 'password_entry_screen_init', '_LABEL_3F5F_ password entry screen initializer'],
  ['r2288', 'password_previous_character', '_LABEL_4194_ password previous-character routine'],
  ['r2289', 'password_next_character', '_LABEL_41BB_ password next-character routine'],
  ['r2327', 'player_damage_knockback_start', '_LABEL_4B31_ player damage knockback setup'],
  ['r2371', 'palette_reveal_loop', '_LABEL_5BDD_ palette reveal loop'],
  ['r2377', 'entity_random_variant_select', '_LABEL_5D6A_ entity random variant selector'],
  ['r1838', 'entity_spawn_offset_select', '_LABEL_6974_ entity spawn offset selector'],
  ['r1839', 'entity_position_pattern_select', '_LABEL_69BE_ entity position pattern selector'],
].map(([regionId, role, name]) => ({ regionId, role, name, confidence: 'high' }));

const ramRoles = [
  ['$D137', 'password_character_buffer', '14-byte password character buffer used by encode/decode and display routines.', 'high'],
  ['$D145', 'password_bit_work_buffer', 'Password bit-packing work buffer used by encode/decode and mask routines.', 'high'],
  ['$D11C', 'password_cursor_index', 'Current password-entry cursor index.', 'medium'],
  ['$D11D', 'password_previous_cursor_index', 'Previous password-entry cursor index used for redraw.', 'medium'],
  ['$C248', 'player_knockback_velocity_word', 'Word receiving the selected player knockback velocity.', 'high'],
  ['$C24A', 'player_knockback_velocity_high', 'High byte of the player knockback velocity word at _RAM_C248_.', 'medium'],
  ['$D025', 'pending_pickup_object_id', 'Pending object/item spawn identifier selected from lookup tables.', 'high'],
  ['$D026', 'pending_pickup_spawn_x', 'Pending object/item spawn X coordinate word.', 'high'],
  ['$D028', 'pending_pickup_spawn_y', 'Pending object/item spawn Y coordinate byte.', 'high'],
  ['$D029', 'pending_pickup_spawn_direction', 'Pending object/item spawn direction byte copied from player facing.', 'medium'],
  ['$D1EB', 'pickup_collection_flag_base', 'Base collection-flag buffer checked before spawning pickup objects.', 'medium'],
  ['$D21B', 'entity_spawn_offset_counter', 'Counter masked to select _DATA_699C_ spawn offsets.', 'high'],
  ['$D21C', 'entity_position_pattern_counter', 'Counter selecting _DATA_69FB_ position pattern entries.', 'high'],
  ['$D10E', 'palette_reveal_countdown', 'Palette reveal loop countdown/state buffer.', 'medium'],
  ['$CFBB', 'active_bg_palette_buffer', 'Active background palette buffer patched during reveal/fade.', 'high'],
  ['$CFCB', 'active_sprite_palette_buffer', 'Active sprite palette buffer patched during reveal/fade.', 'high'],
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
    tool: 'tools/world-gameplay-lookup-data-audit.mjs',
    summary: {
      lookupTables: tables.length,
      routineCount: routines.length,
      ramVariableCount: ramRoles.length,
      typeCounts: tables.reduce((counts, table) => {
        counts[table.type] = (counts[table.type] || 0) + 1;
        return counts;
      }, {}),
      assetPolicy: 'Metadata only: offsets, roles, routine labels, RAM addresses, table dimensions implied by code, and evidence. No ROM bytes, passwords, text strings, graphics, or gameplay values are embedded.',
    },
    tables: tables.map(table => ({
      ...table,
      offset: hex(table.offset),
      region: regionRef(findRegionById(mapData, table.regionId)),
    })),
    routines: routines.map(routine => ({
      ...routine,
      region: regionRef(findRegionById(mapData, routine.regionId)),
    })),
    ramRoles: ramRoles.map(([address, role, summary, confidence]) => ({ address, role, summary, confidence })),
    evidence: [
      'Password tables are consumed by _LABEL_3B58_, _LABEL_3B87_, _LABEL_3BE1_, _LABEL_3E5D_, _LABEL_4194_, and _LABEL_41BB_.',
      'Player knockback velocity tables are selected by _LABEL_4B31_ during player damage setup.',
      'Palette reveal mask data is copied and patched by _LABEL_5BDD_.',
      'Item/object spawn and entity pattern tables are selected by routines at ASM lines 14549-14594 and 15130-15189.',
    ],
  };
}

function annotateRegion(region, item, key) {
  const before = regionRef(region);
  const previousType = region.type || 'unknown';
  if (item.type) region.type = item.type;
  if (item.name && (!region.name || /^_DATA_|^Data @/.test(region.name))) region.name = item.name;
  if (item.confidence && !region.confidence) region.confidence = item.confidence;
  if (item.summary && (!region.notes || /^Data from /.test(region.notes))) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis[key] = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: previousType,
    typeAfterAudit: region.type || previousType,
    changedType: previousType !== (region.type || previousType),
    summary: item.summary || item.name,
    evidence: item.evidence || [],
    generatedAt: now,
    tool: 'tools/world-gameplay-lookup-data-audit.mjs',
  };
  return {
    before,
    after: regionRef(region),
    role: item.role,
    confidence: item.confidence,
    changedType: previousType !== (region.type || previousType),
  };
}

function annotateRamEntry(entry, role) {
  const [address, kind, summary, confidence] = role;
  const before = {
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || '',
    name: entry.name || '',
    notes: entry.notes || '',
  };
  entry.analysis = entry.analysis || {};
  entry.analysis.gameplayLookupDataAudit = {
    catalogId,
    kind,
    confidence,
    summary,
    generatedAt: now,
    tool: 'tools/world-gameplay-lookup-data-audit.mjs',
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
    role: kind,
    confidence,
  };
}

function applyAnnotations(mapData) {
  const changedRegions = [];
  const missingRegions = [];
  const changedRam = [];
  const missingRam = [];

  for (const table of tables) {
    const region = findRegionById(mapData, table.regionId);
    if (!region) {
      missingRegions.push({ id: table.regionId, offset: hex(table.offset), role: table.role });
      continue;
    }
    changedRegions.push(annotateRegion(region, table, 'gameplayLookupDataAudit'));
  }

  for (const routine of routines) {
    const region = findRegionById(mapData, routine.regionId);
    if (!region) {
      missingRegions.push({ id: routine.regionId, role: routine.role });
      continue;
    }
    changedRegions.push(annotateRegion(region, {
      ...routine,
      type: 'code',
      summary: routine.name,
      evidence: ['Routine role is inferred from direct references documented in the table evidence for this catalog.'],
    }, 'gameplayLookupDataAudit'));
  }

  for (const role of ramRoles) {
    const entry = findRam(mapData, role[0]);
    if (!entry) {
      missingRam.push({ address: role[0], role: role[1] });
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
    changes = applyAnnotations(mapData);
    const finalCatalog = buildCatalog(mapData);
    mapData.smallDataCatalogs = (mapData.smallDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.smallDataCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'gameplay_lookup_data_audit',
      generatedAt: now,
      tool: 'tools/world-gameplay-lookup-data-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changes.changedRegions.length,
        changedRegionTypes: changes.changedRegions.filter(item => item.changedType).length,
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
        'Trace the password checksum/validation routine around _LABEL_3C1F_ to document exact password semantics without storing password strings.',
        'Trace the _DATA_4C08_ pointer-record consumers to decide whether it should be promoted from alternate velocity table to a specific player state table.',
        'Translate the item/entity spawn lookup tables into clean JavaScript data decoders once the surrounding object state fields are named.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    tables: catalog.tables.map(table => ({
      regionId: table.regionId,
      offset: table.offset,
      type: table.type,
      role: table.role,
      confidence: table.confidence,
    })),
    routines: catalog.routines.map(routine => ({
      regionId: routine.regionId,
      role: routine.role,
      confidence: routine.confidence,
    })),
    ramRoles: catalog.ramRoles.map(role => ({
      address: role.address,
      role: role.role,
      confidence: role.confidence,
    })),
    changes,
  }, null, 2));
}

main();
