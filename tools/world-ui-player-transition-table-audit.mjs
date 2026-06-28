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
const catalogId = 'world-ui-player-transition-table-catalog-2026-06-25';
const reportId = 'ui-player-transition-table-audit-2026-06-25';
const toolName = 'tools/world-ui-player-transition-table-audit.mjs';

const tables = [
  {
    regionId: 'r0040',
    offset: 0x02CA4,
    type: 'data_table',
    role: 'shop_menu_page_0_selection_table',
    name: 'shop/menu page 0 selection table',
    confidence: 'high',
    layout: {
      format: '10 one-byte selection ids',
      entryCount: 10,
      entryStrideBytes: 1,
      consumer: '_LABEL_2C5D_',
    },
    summary: 'Ten-entry byte table indexed by _RAM_D11C_ for the first shop/menu page; the selected id is passed to _LABEL_2E1A_ and rendered with page base 0x00.',
    evidence: [
      'ASM lines 7163-7177 index _DATA_2CA4_ with _RAM_D11C_, pass the selected byte to _LABEL_2E1A_, then call _LABEL_30DD_ with A=0x00.',
      'ASM lines 7182-7184 define _DATA_2CA4_ as the 10-byte table at 0x02CA4.',
    ],
  },
  {
    regionId: 'r0041',
    offset: 0x02CF5,
    type: 'data_table',
    role: 'shop_menu_page_1_selection_table',
    name: 'shop/menu page 1 selection table',
    confidence: 'high',
    layout: {
      format: '10 one-byte selection ids',
      entryCount: 10,
      entryStrideBytes: 1,
      consumer: '_LABEL_2CAE_',
    },
    summary: 'Ten-entry byte table indexed by _RAM_D11C_ for the second shop/menu page; the selected id is passed to _LABEL_2E1A_ and rendered with page base 0x10.',
    evidence: [
      'ASM lines 7204-7218 index _DATA_2CF5_ with _RAM_D11C_, pass the selected byte to _LABEL_2E1A_, then call _LABEL_30DD_ with A=0x10.',
      'ASM lines 7223-7225 define _DATA_2CF5_ as the 10-byte table at 0x02CF5.',
    ],
  },
  {
    regionId: 'r0042',
    offset: 0x02D46,
    type: 'data_table',
    role: 'shop_menu_page_2_selection_table',
    name: 'shop/menu page 2 selection table',
    confidence: 'high',
    layout: {
      format: '10 one-byte selection ids',
      entryCount: 10,
      entryStrideBytes: 1,
      consumer: '_LABEL_2CFF_',
    },
    summary: 'Ten-entry byte table indexed by _RAM_D11C_ for the third shop/menu page; the selected id is passed to _LABEL_2E1A_ and rendered with page base 0x20.',
    evidence: [
      'ASM lines 7245-7259 index _DATA_2D46_ with _RAM_D11C_, pass the selected byte to _LABEL_2E1A_, then call _LABEL_30DD_ with A=0x20.',
      'ASM lines 7264-7266 define _DATA_2D46_ as the 10-byte table at 0x02D46.',
    ],
  },
  {
    regionId: 'r0047',
    offset: 0x02F5F,
    type: 'tile_map',
    role: 'shop_menu_selection_marker_tile_pairs',
    name: 'shop/menu selection marker tile pairs',
    confidence: 'high',
    layout: {
      format: 'four-byte VDP tile/attribute fragments selected by _RAM_D11B_',
      entryCount: 4,
      entryStrideBytes: 8,
      emittedBytesPerWrite: 4,
      consumers: ['_LABEL_2F35_', '_LABEL_3025_'],
      destinationRam: ['_RAM_D117_', '_RAM_D119_'],
    },
    summary: 'Shop/menu selection marker tile/attribute fragments copied four bytes at a time to the VDP data port; this is byte-rendered UI tile data, not a pointer table.',
    evidence: [
      'ASM lines 7515-7529 index _DATA_2F5F_ by (_RAM_D11B_ * 8), set the VDP destination from _RAM_D117_, and write four bytes through RST $30.',
      'ASM lines 7649-7678 repeat the same _DATA_2F5F_ indexed copy path after first erasing the old cursor position.',
      'ASM lines 7543-7546 define _DATA_2F5F_ as a 32-byte data block rather than a .dw pointer table.',
    ],
  },
  {
    regionId: 'r0048',
    offset: 0x02F7F,
    type: 'tile_map',
    role: 'shop_menu_blank_marker_tile_pairs',
    name: 'shop/menu blank marker tile pairs',
    confidence: 'high',
    layout: {
      format: 'four-byte VDP tile/attribute fragment used to erase a marker row',
      entryCount: 1,
      entryStrideBytes: 8,
      emittedBytesPerWrite: 4,
      consumers: ['_LABEL_3019_', '_LABEL_31A7_', '_LABEL_4377_'],
      destinationRam: ['_RAM_D117_', '_RAM_D119_'],
    },
    summary: 'Blank marker tile/attribute fragment copied through the same four-byte VDP writer used by shop/menu and continue/new-game cursor movement.',
    evidence: [
      'ASM lines 7626-7631 load DE with _DATA_2F7F_ and jump to _LABEL_3025_ after cursor movement changes _RAM_D117_/_RAM_D119_.',
      'ASM lines 7880-7904 and 10377-10391 load DE with _DATA_2F7F_ before calling the four-byte VDP writer path.',
      'ASM lines 7548-7550 define _DATA_2F7F_ as an 8-byte data block.',
    ],
  },
  {
    regionId: 'r0049',
    offset: 0x02F87,
    type: 'tile_map',
    role: 'continue_menu_highlight_marker_tile_pairs',
    name: 'continue/new-game highlight marker tile pairs',
    confidence: 'high',
    layout: {
      format: 'four-byte VDP tile/attribute fragment used by continue/new-game marker redraw',
      entryCount: 1,
      entryStrideBytes: 8,
      emittedBytesPerWrite: 4,
      consumers: ['_LABEL_4377_'],
      destinationRam: ['_RAM_D117_', '_RAM_D119_'],
    },
    summary: 'Continue/new-game highlight marker fragment copied through the shared four-byte VDP writer; this is UI tile data, not a pointer table.',
    evidence: [
      'ASM lines 10392-10408 load DE with _DATA_2F87_ and emit two four-byte rows via the same RST $30 loop.',
      'ASM lines 7552-7554 define _DATA_2F87_ as an 8-byte data block.',
    ],
  },
  {
    regionId: 'r0050',
    offset: 0x02F8F,
    type: 'tile_map',
    role: 'continue_menu_blank_marker_tile_pairs',
    name: 'continue/new-game blank marker tile pairs',
    confidence: 'high',
    layout: {
      format: 'four-byte VDP tile/attribute fragment used by continue/new-game marker erase',
      entryCount: 1,
      entryStrideBytes: 8,
      emittedBytesPerWrite: 4,
      consumers: ['_LABEL_430E_'],
      destinationRam: ['_RAM_D117_', '_RAM_D119_'],
    },
    summary: 'Continue/new-game blank marker fragment copied through the shared four-byte VDP writer; this is UI tile data, not a pointer table.',
    evidence: [
      'ASM lines 10345-10376 load DE with _DATA_2F8F_ while moving the continue/new-game marker and then call _LABEL_3025_.',
      'ASM lines 7556-7558 define _DATA_2F8F_ as an 8-byte data block.',
    ],
  },
  {
    regionId: 'r0095',
    offset: 0x05674,
    type: 'data_table',
    role: 'player_transition_vector_table',
    name: 'player transition vector/parameter table',
    confidence: 'high',
    layout: {
      format: '8 two-byte entries selected by ((_RAM_C271_ * 2) + _RAM_C251_)',
      entryCount: 8,
      entryStrideBytes: 2,
      consumers: ['_LABEL_55C9_', '_LABEL_5611_'],
      destinationRam: ['_RAM_C25E_', '_RAM_C25F_'],
    },
    summary: 'Eight two-byte player transition parameters selected from current state and facing direction, then stored in _RAM_C25E_/_RAM_C25F_.',
    evidence: [
      'ASM lines 12834-12848 compute ((_RAM_C271_ * 2) + _RAM_C251_) * 2, index _DATA_5674_, and write the selected pair to _RAM_C25E_/_RAM_C25F_.',
      'ASM lines 12874-12888 repeat the same _DATA_5674_ lookup path in _LABEL_5611_.',
      'ASM lines 12918-12920 define _DATA_5674_ as the 16-byte table at 0x05674.',
    ],
  },
  {
    regionId: 'r0096',
    offset: 0x05775,
    type: 'entity_data',
    role: 'entity_vertical_offset_sequence',
    name: 'entity vertical offset sequence',
    confidence: 'high',
    layout: {
      format: 'one-byte deltas consumed until terminator',
      entryStrideBytes: 1,
      dataBytesBeforeTerminator: 18,
      terminator: '0xFF',
      pointerFields: ['IX+32', 'IX+33'],
      accumulatorField: 'IX+34',
      destinationField: 'IX+6',
    },
    summary: 'Terminated byte sequence assigned to an entity pointer; each update subtracts the next byte from IX+34 and writes the result to IX+6.',
    evidence: [
      'ASM lines 12999-13005 initialize IX+32/IX+33 with _DATA_5775_ during _LABEL_56F4_.',
      'ASM lines 13025-13045 read the sequence through IX+32/IX+33, stop on 0xFF, subtract each value from IX+34, and store the result in IX+6.',
      'ASM lines 13047-13049 define _DATA_5775_ as the 19-byte terminated sequence at 0x05775.',
    ],
  },
  {
    regionId: 'r0098',
    offset: 0x058B5,
    type: 'entity_data',
    role: 'entity_motion_loop_sequence',
    name: 'entity motion loop sequence',
    confidence: 'high',
    layout: {
      format: 'one-byte motion values with loop sentinel',
      entryStrideBytes: 1,
      dataBytesBeforeFirstSentinel: 8,
      loopSentinel: '0x80',
      pointerFields: ['IX+42', 'IX+43'],
      destinationField: 'IX+11',
    },
    summary: 'Looping motion sequence assigned to an entity pointer; _LABEL_5882_ rewinds to the start when it reads the 0x80 sentinel and writes the current value to IX+11.',
    evidence: [
      'ASM lines 13159-13164 initialize IX+42/IX+43 with _DATA_58B5_ during the first branch of _LABEL_583D_.',
      'ASM lines 13166-13189 read the sequence through IX+42/IX+43, rewind to _DATA_58B5_ on 0x80, write the value to IX+11, and retire the entity on timer/collision.',
      'ASM lines 13191-13193 define _DATA_58B5_ as the 10-byte loop sequence at 0x058B5.',
    ],
  },
  {
    regionId: 'r0192',
    offset: 0x0B77D,
    type: 'data_table',
    role: 'form_transition_timing_sequence',
    name: 'form transition timing sequence',
    confidence: 'high',
    layout: {
      format: 'one-byte frame counts consumed until terminator',
      entryStrideBytes: 1,
      dataBytesBeforeTerminator: 30,
      terminator: '0xFF',
      pointerRam: '_RAM_D104_',
      phaseUse: 'each duration drives both saved-form and target-form display phases',
    },
    summary: 'Form/transformation timing sequence used by _LABEL_B718_ to alternate between saved player/form display states until the 0xFF terminator.',
    evidence: [
      'ASM lines 20429-20434 store _DATA_B77D_ in _RAM_D104_ before entering the transition loop.',
      'ASM lines 20436-20468 read each duration from _RAM_D104_, run frame/display updates for the saved state and target state, then advance the pointer.',
      'ASM lines 20486-20489 define _DATA_B77D_ as the 31-byte terminated timing sequence at 0x0B77D.',
    ],
  },
];

const routines = [
  {
    regionId: 'r1779',
    label: '_LABEL_2C5D_',
    role: 'shop_menu_page_0_accept_handler',
    name: '_LABEL_2C5D_ shop/menu page 0 accept handler',
    confidence: 'high',
    summary: 'Handles page-0 cursor changes and accepted selections by indexing _DATA_2CA4_.',
    evidence: ['ASM lines 7149-7179 compare _RAM_D11B_/_RAM_D11D_, handle inputs, index _DATA_2CA4_, call _LABEL_2E1A_, and redraw.'],
  },
  {
    regionId: 'r1780',
    label: '_LABEL_2CAE_',
    role: 'shop_menu_page_1_accept_handler',
    name: '_LABEL_2CAE_ shop/menu page 1 accept handler',
    confidence: 'high',
    summary: 'Handles page-1 cursor changes and accepted selections by indexing _DATA_2CF5_.',
    evidence: ['ASM lines 7190-7220 compare _RAM_D11B_/_RAM_D11D_, handle inputs, index _DATA_2CF5_, call _LABEL_2E1A_, and redraw.'],
  },
  {
    regionId: 'r1781',
    label: '_LABEL_2CFF_',
    role: 'shop_menu_page_2_accept_handler',
    name: '_LABEL_2CFF_ shop/menu page 2 accept handler',
    confidence: 'high',
    summary: 'Handles page-2 cursor changes and accepted selections by indexing _DATA_2D46_.',
    evidence: ['ASM lines 7231-7261 compare _RAM_D11B_/_RAM_D11D_, handle inputs, index _DATA_2D46_, call _LABEL_2E1A_, and redraw.'],
  },
  {
    regionId: 'r1783',
    label: '_LABEL_2E1A_',
    role: 'shop_menu_selection_apply',
    name: '_LABEL_2E1A_ shop/menu selection apply routine',
    confidence: 'high',
    summary: 'Applies the selected shop/menu id by resolving item state with _LABEL_2804_ and updating item flag RAM.',
    evidence: ['ASM lines 7364-7398 take the selection id in A/E, call _LABEL_2804_, update the target item flag, and request sound 0x1F on changed selection.'],
  },
  {
    regionId: 'r2223',
    label: '_LABEL_30DD_',
    role: 'shop_menu_selection_marker_writer',
    name: '_LABEL_30DD_ shop/menu selection marker writer',
    confidence: 'medium',
    summary: 'Writes a four-byte selection marker record to VDP-relative destinations selected by _RAM_D11B_ and a page base.',
    evidence: ['ASM lines 7650-7678 combine _RAM_D11B_, _DATA_2F5F_, _RAM_D117_, and the A page base before writing four bytes through RST $30.'],
  },
  {
    regionId: 'r2218',
    label: '_LABEL_2F35_',
    role: 'ui_selection_marker_initial_writer',
    name: '_LABEL_2F35_ UI selection marker initial writer',
    confidence: 'high',
    summary: 'Initializes a selection marker by selecting one 8-byte _DATA_2F5F_ fragment, storing the VDP destination in _RAM_D117_, and writing four bytes to each rendered row.',
    evidence: ['ASM lines 7502-7529 store the destination in _RAM_D117_, index _DATA_2F5F_ by A*8, set the VDP address, and write four bytes via RST $30.'],
  },
  {
    regionId: 'r2220',
    label: '_LABEL_3025_',
    role: 'ui_selection_marker_redraw_writer',
    name: '_LABEL_3025_ UI selection marker redraw writer',
    confidence: 'high',
    summary: 'Erases the previous marker from _RAM_D119_ using the DE fragment, then redraws the current marker from _DATA_2F5F_ at _RAM_D117_.',
    evidence: ['ASM lines 7633-7678 write two rows from the caller-provided DE fragment, then select _DATA_2F5F_ using _RAM_D11B_ and write the current marker rows.'],
  },
  {
    regionId: 'r2295',
    label: '_LABEL_4377_',
    role: 'continue_menu_marker_redraw_writer',
    name: '_LABEL_4377_ continue/new-game marker redraw writer',
    confidence: 'high',
    summary: 'Uses _DATA_2F7F_ to erase the old continue/new-game marker rows and _DATA_2F87_ to draw the new rows through the shared four-byte VDP copy loop.',
    evidence: ['ASM lines 10377-10408 load _DATA_2F7F_ and _DATA_2F87_ as DE sources and write two four-byte rows from each through RST $30.'],
  },
  {
    regionId: 'r1815',
    label: '_LABEL_55C9_',
    role: 'player_transition_vector_select_entry_55c9',
    name: '_LABEL_55C9_ player transition vector select',
    confidence: 'high',
    summary: 'Selects a two-byte transition vector from _DATA_5674_, clears motion words, and copies player position into active state.',
    evidence: ['ASM lines 12826-12860 select from _DATA_5674_, write _RAM_C25E_/_RAM_C25F_, clear motion words, and copy _RAM_C273_/_RAM_C275_ into position RAM.'],
  },
  {
    regionId: 'r2355',
    label: '_LABEL_5611_',
    role: 'player_transition_vector_select_entry_5611',
    name: '_LABEL_5611_ player transition vector select',
    confidence: 'high',
    summary: 'Initializes a related player state by selecting the same _DATA_5674_ transition vector and clearing motion words.',
    evidence: ['ASM lines 12867-12896 select from _DATA_5674_, write _RAM_C25E_/_RAM_C25F_, and clear _RAM_C248_/_RAM_C24A_.'],
  },
  {
    regionId: 'r2357',
    label: '_LABEL_56F4_',
    role: 'entity_vertical_offset_sequence_init',
    name: '_LABEL_56F4_ entity vertical offset sequence init',
    confidence: 'high',
    summary: 'Initializes the entity at _RAM_C280_ and assigns _DATA_5775_ as its vertical-offset sequence.',
    evidence: ['ASM lines 12985-13022 initialize IX fields, assign _DATA_5775_ to IX+32/IX+33, set entity flags, and start sound/effect 0x28.'],
  },
  {
    regionId: 'r2358',
    label: '_LABEL_5750_',
    role: 'entity_vertical_offset_sequence_step',
    name: '_LABEL_5750_ entity vertical offset sequence step',
    confidence: 'high',
    summary: 'Consumes the next _DATA_5775_ byte each update, writes the derived Y field, and terminates the entity on 0xFF.',
    evidence: ['ASM lines 13025-13045 read the IX+32/IX+33 pointer, test for 0xFF, advance the pointer, and write IX+6.'],
  },
  {
    regionId: 'r2360',
    label: '_LABEL_583D_',
    role: 'entity_motion_loop_sequence_init',
    name: '_LABEL_583D_ entity motion loop sequence init',
    confidence: 'high',
    summary: 'Initializes one entity branch and assigns _DATA_58B5_ as its looping motion sequence.',
    evidence: ['ASM lines 13133-13164 initialize entity motion and assign _DATA_58B5_ to IX+42/IX+43.'],
  },
  {
    regionId: 'r2361',
    label: '_LABEL_5882_',
    role: 'entity_motion_loop_sequence_step',
    name: '_LABEL_5882_ entity motion loop sequence step',
    confidence: 'high',
    summary: 'Consumes the looping _DATA_58B5_ stream, rewinds on 0x80, writes IX+11, and retires the entity when its timer/collision ends.',
    evidence: ['ASM lines 13166-13189 read the IX+42/IX+43 pointer, rewind on 0x80, store IX+11, check collision/timer, and clear IX+0.'],
  },
  {
    regionId: 'r2593',
    label: '_LABEL_B6CA_',
    role: 'form_transition_setup',
    name: '_LABEL_B6CA_ form transition setup',
    confidence: 'high',
    summary: 'Captures the source and target player/form display state, initializes _RAM_D104_ with _DATA_B77D_, and starts the transition effect.',
    evidence: ['ASM lines 20406-20435 store source/target state in _RAM_D0FE_/_RAM_D100_ and _RAM_D102_/_RAM_D103_, then load _DATA_B77D_ into _RAM_D104_.'],
  },
  {
    regionId: 'r2594',
    label: '_LABEL_B718_',
    role: 'form_transition_timing_driver',
    name: '_LABEL_B718_ form transition timing driver',
    confidence: 'high',
    summary: 'Runs the alternating form-transition display loop from _RAM_D104_ until the _DATA_B77D_ terminator is reached.',
    evidence: ['ASM lines 20436-20480 alternate saved and target state display for each duration byte and exit on 0xFF.'],
  },
];

const ramRoles = [
  ['$D11B', 'shop_menu_page_state', 'Shop/menu page state selected by the jump table at 0x02BF0 and compared with _RAM_D11D_ for redraw.', 'medium'],
  ['$D11C', 'shop_menu_cursor_index', 'Cursor index used to select one of ten entries from _DATA_2CA4_, _DATA_2CF5_, or _DATA_2D46_.', 'high'],
  ['$D11D', 'shop_menu_previous_page_state', 'Previous shop/menu page state used to trigger redraw/sound when _RAM_D11B_ changes.', 'medium'],
  ['$D117', 'ui_selection_marker_vdp_destination', 'Current VDP destination word used by _LABEL_2F35_/_LABEL_3025_ when drawing the selection marker fragments.', 'high'],
  ['$D119', 'ui_selection_marker_previous_vdp_destination', 'Previous VDP destination word erased by _LABEL_3025_ before drawing the current selection marker.', 'high'],
  ['$CF95', 'ui_input_edge_flags', 'Input edge flags tested by the shop/menu and continue/new-game marker movement routines before updating _RAM_D11C_ and marker destinations.', 'medium'],
  ['$C25E', 'player_transition_vector_low', 'Low byte loaded from _DATA_5674_ by _LABEL_55C9_/_LABEL_5611_.', 'high'],
  ['$C25F', 'player_transition_vector_high', 'High byte loaded from _DATA_5674_ by _LABEL_55C9_/_LABEL_5611_.', 'high'],
  ['$C271', 'player_transition_vector_group', 'State/group input combined with _RAM_C251_ to select an entry from _DATA_5674_.', 'medium'],
  ['$D104', 'form_transition_timing_pointer', 'Pointer to the next duration byte in _DATA_B77D_ during _LABEL_B718_.', 'high'],
  ['$D0FE', 'form_transition_source_position_word', 'Saved source display-state word restored during the first phase of each _DATA_B77D_ duration.', 'high'],
  ['$D100', 'form_transition_target_position_word', 'Saved target display-state word restored during the second phase of each _DATA_B77D_ duration.', 'high'],
  ['$D102', 'form_transition_source_attr', 'Saved source display-state byte restored with _RAM_D0FE_ during the transition loop.', 'high'],
  ['$D103', 'form_transition_target_attr', 'Saved target display-state byte restored with _RAM_D100_ during the transition loop.', 'high'],
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
    tool: toolName,
    summary: {
      tableCount: tables.length,
      routineCount: routines.length,
      ramVariableCount: ramRoles.length,
      promotedEntityDataRegions: tables.filter(table => table.type === 'entity_data').length,
      assetPolicy: 'Metadata only: offsets, labels, table dimensions, sentinel meanings, routine references, RAM addresses, and evidence. No ROM bytes, decoded graphics, text, music, or gameplay asset values are embedded.',
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
      'ASM lines 7163-7266 prove the three shop/menu page tables are indexed selection id tables.',
      'ASM lines 12834-12888 prove _DATA_5674_ is a player transition vector table selected by state and direction.',
      'ASM lines 12999-13049 prove _DATA_5775_ is a terminated entity vertical-offset sequence.',
      'ASM lines 13159-13193 prove _DATA_58B5_ is a looping entity motion sequence.',
      'ASM lines 20429-20489 prove _DATA_B77D_ is the form-transition timing sequence.',
    ],
  };
}

function annotateRegion(region, item) {
  const before = regionRef(region);
  const previousType = region.type || 'unknown';
  if (item.type) region.type = item.type;
  if (item.name && (!region.name || /^_DATA_/.test(region.name))) region.name = item.name;
  if (item.summary && (!region.notes || /^Data from /.test(region.notes))) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.uiPlayerTransitionTableAudit = {
    catalogId,
    kind: item.role,
    label: item.label,
    confidence: item.confidence,
    typeBeforeAudit: previousType,
    typeAfterAudit: region.type || previousType,
    changedType: previousType !== (region.type || previousType),
    summary: item.summary,
    layout: item.layout,
    evidence: item.evidence,
    generatedAt: now,
    tool: toolName,
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
  entry.analysis.uiPlayerTransitionTableAudit = {
    catalogId,
    kind,
    confidence,
    summary,
    generatedAt: now,
    tool: toolName,
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
    changedRegions.push(annotateRegion(region, table));
  }

  for (const routine of routines) {
    const region = findRegionById(mapData, routine.regionId);
    if (!region) {
      missingRegions.push({ id: routine.regionId, label: routine.label, role: routine.role });
      continue;
    }
    changedRegions.push(annotateRegion(region, { ...routine, type: 'code' }));
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
      type: 'ui_player_transition_table_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
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
        'Trace _LABEL_2804_ and the _RAM_CF3E_/_RAM_CF66_ item buffers to name the exact shop/menu item ownership fields.',
        'Trace callers of _LABEL_56F4_ and _LABEL_583D_ to identify the exact entity types using _DATA_5775_ and _DATA_58B5_.',
        'Convert the _DATA_B77D_ timing sequence into a ROM-local transition preview once player form sprite sources are fully recipe-backed.',
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
      label: routine.label,
      role: routine.role,
      confidence: routine.confidence,
    })),
    ramRoles: catalog.ramRoles,
    changes,
  }, null, 2));
}

main();
