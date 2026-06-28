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
const catalogId = 'world-bank0-menu-routine-catalog-2026-06-25';
const reportId = 'bank0-menu-routine-audit-2026-06-25';
const toolName = 'tools/world-bank0-menu-routine-audit.mjs';

function routine(offset, label, role, name, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name,
    type: options.type || 'code',
    family: options.family || 'bank0_menu_runtime',
    confidence: options.confidence || 'high',
    calls: options.calls || [],
    ramRefs: options.ramRefs || [],
    evidence: [
      `${label} is an ASM code label at ROM offset ${hex(offset)}.`,
      ...(options.evidence || []),
    ],
  };
}

const ENTRIES = [
  routine(0x02855, '_LABEL_2855_', 'in_game_menu_request_handler', '_LABEL_2855_ in-game menu request handler', 'Handles pending _RAM_CF86_ menu requests from gameplay/transition loops, opening the menu flow or waiting for an active transition to complete.', {
    calls: ['_LABEL_822_', '_LABEL_28AE_', '_LABEL_2BBE_', '_LABEL_28E1_', '_LABEL_849_', '_LABEL_1004_', '_LABEL_BFD_', '_LABEL_104B_', '_LABEL_FF9_', '_LABEL_10BC_'],
    ramRefs: ['_RAM_CF86_', '_RAM_CF8B_', '_RAM_FFFF_', '_RAM_CFE0_'],
    evidence: ['ASM lines 6697-6738 gate on _RAM_CF86_, run _LABEL_28AE_/_LABEL_2BBE_/_LABEL_28E1_ when no transition is active, or wait until _RAM_CF86_ is set again when _RAM_CF8B_ is nonzero.'],
  }),
  routine(0x028AE, '_LABEL_28AE_', 'menu_open_state_capture', '_LABEL_28AE_ menu open state capture', 'Captures two saved pointers into _RAM_CFF1_ fields, applies a small 8FB loader, starts a menu sound/effect, and resets scroll/display state before menu entry.', {
    calls: ['_LABEL_8FB_', '_LABEL_104B_', '_LABEL_5B6_', '_LABEL_DB5_'],
    ramRefs: ['_RAM_CFF1_', '_RAM_CFF5_', '_RAM_CFF7_'],
    evidence: ['ASM lines 6740-6754 copy _RAM_CFF5_/_RAM_CFF7_ into the CFF1 work record, call _DATA_28D6_ through _LABEL_8FB_, then reset display state.'],
  }),
  routine(0x028E1, '_LABEL_28E1_', 'menu_close_restore_context', '_LABEL_28E1_ menu close restore context', 'Restores tile/VRAM state after the menu by replaying menu loader scripts, restoring saved CFF1 pointers, running palette/scroll helpers, and re-enabling updates.', {
    calls: ['_LABEL_8FB_', '_LABEL_8B2_', '_LABEL_FA1_', '_LABEL_E83_', '_LABEL_10BC_', '_LABEL_104B_'],
    ramRefs: ['_RAM_CFF1_', '_RAM_FFFF_', '_RAM_D006_', '_RAM_CF65_', '_RAM_CFE0_', '_RAM_CFE1_'],
    evidence: ['ASM lines 6760-6782 load _DATA_2A55_, restore CFF1 pointers through _LABEL_8B2_/_LABEL_8FB_, run scroll/palette helpers, update _RAM_CF65_, and set frame update flags.'],
  }),
  routine(0x0291F, '_LABEL_291F_', 'player_menu_state_reset', '_LABEL_291F_ player/menu state reset', 'Resets the C240 player state record after menu/load transitions and restarts the current player animation/state sequence.', {
    calls: ['_LABEL_137C_', '_LABEL_1F28_', '_LABEL_2767_'],
    ramRefs: ['_RAM_C240_', 'IX+0', 'IX+1', 'IX+14', 'IX+17', 'IX+32', 'IX+42', 'IX+43', 'IX+46'],
    evidence: ['ASM lines 6784-6798 initialize _RAM_C240_ fields, call _LABEL_137C_ using IX+17, and refresh player animation/state helpers.'],
  }),
  routine(0x02948, '_LABEL_2948_', 'room_entity_record_loader_entry', '_LABEL_2948_ room entity record loader entry', 'Initializes bank-4 room entity record decoding from _RAM_CF62_ into _RAM_D030_ seven-byte records.', {
    calls: ['_LABEL_2963_'],
    ramRefs: ['_RAM_FFFF_', '_RAM_D030_', '_RAM_CF62_', '_RAM_D0DE_', '_RAM_D0E0_', '_RAM_D0E1_', '_RAM_D0E2_'],
    evidence: ['ASM lines 6800-6811 switch to bank 4, seed _RAM_D0DE_ from _RAM_CF62_, initialize counters, and fall through to _LABEL_2963_.'],
  }),
  routine(0x02963, '_LABEL_2963_', 'room_entity_record_decoder', '_LABEL_2963_ room entity record decoder', 'Decodes room entity source records into seven-byte runtime records at _RAM_D030_, tracking active count and banked graphics metadata.', {
    calls: ['_LABEL_1023_', '_LABEL_B8F_', '_LABEL_A97_', '_LABEL_1036_'],
    ramRefs: ['_RAM_D030_', '_RAM_D0A0_', '_RAM_D0A1_', '_RAM_D0A2_', '_RAM_D0A3_', '_RAM_D0DE_', '_RAM_D0E0_', '_RAM_D0E1_', '_RAM_D0E2_', '_RAM_D0EC_', '_RAM_D0ED_'],
    evidence: ['ASM lines 6811-6891 parse records until $FF, write seven-byte _RAM_D030_ records, and store counts in _RAM_D0A0_/_RAM_D0A2_/_RAM_D0A3_.', 'ASM lines 6893-6937 resolve graphics metadata through bank 7 pointer reads and _LABEL_A97_.'],
  }),
  routine(0x02B14, '_LABEL_2B14_', 'continue_password_menu_entry', '_LABEL_2B14_ continue/password menu entry', 'Top-level continue/password menu entry that either clears inventory state, runs password entry, or restores a saved game path before returning to gameplay.', {
    calls: ['_LABEL_3ED6_', '_LABEL_108C_', '_LABEL_1004_', '_LABEL_421B_', '_LABEL_3EE6_', '_LABEL_822_', '_LABEL_6E7_', '_LABEL_468D_', '_LABEL_2B73_'],
    ramRefs: ['_RAM_CF8A_', '_RAM_CF8C_', '_RAM_CF8D_', '_RAM_CFE1_', '_RAM_CF88_', '_RAM_D137_', '_RAM_CF20_', '_RAM_CF2A_', '_RAM_CF34_', '_RAM_D100_', '_RAM_D0FE_'],
    evidence: ['ASM lines 6965-7006 branch on _RAM_CF8A_/_RAM_CF88_, run the password validation path, then refresh inventory category flags through the local _LABEL_2B73_ scanner.'],
  }),
  routine(0x02B73, '_LABEL_2B73_', 'inventory_category_best_item_marker', '_LABEL_2B73_ inventory category best-item marker', 'Scans one ten-byte inventory/equipment category, clears active bits, and marks the best available entry based on form-specific table data.', {
    calls: ['_LABEL_1023_', '_LABEL_2839_', '_LABEL_2819_', '_LABEL_1036_'],
    ramRefs: ['_RAM_CF20_', '_RAM_CF2A_', '_RAM_CF34_', '_RAM_D100_', '_RAM_D0FE_', '_RAM_C24F_'],
    evidence: ['ASM lines 7019-7065 scan category bytes, resolve table data through _LABEL_2839_/_LABEL_2819_, clear bit 7, and set bit 7 on the selected entry.'],
  }),
  routine(0x02BBE, '_LABEL_2BBE_', 'shop_menu_controller', '_LABEL_2BBE_ shop/menu controller', 'Initializes and runs the shop/menu page controller, pumping frames and dispatching page-state handlers through _DATA_2BF0_.', {
    calls: ['_LABEL_FF9_', '_LABEL_2D50_', '_LABEL_849_', '_LABEL_1004_', '_LABEL_BFD_', '_LABEL_2F97_', '_LABEL_20_', '_DATA_2BF0_'],
    ramRefs: ['_RAM_D11B_', '_RAM_D11C_', '_RAM_D11D_', '_RAM_CF86_', '_RAM_CF95_'],
    evidence: ['ASM lines 7067-7091 clear page/cursor state, render the menu through _LABEL_2D50_, then dispatch _RAM_D11B_ through _DATA_2BF0_.'],
  }),
  routine(0x02BF8, '_LABEL_2BF8_', 'shop_menu_root_page_handler', '_LABEL_2BF8_ shop/menu root page handler', 'Root shop/menu page handler that exits the menu, moves into one of three item pages, or applies the root-page selection table.', {
    calls: ['_LABEL_822_', '_LABEL_1C31_', '_LABEL_2518_', '_LABEL_2E60_', '_LABEL_2EFB_', '_LABEL_307A_'],
    ramRefs: ['_RAM_CF95_', '_RAM_CF69_', '_RAM_CF86_', '_RAM_CF65_', '_RAM_D11C_', '_RAM_D11B_', '_RAM_D11D_'],
    evidence: ['ASM lines 7094-7140 test _RAM_CF95_ accept/cancel bits, update _RAM_D11B_, and use the root-page byte table at 0x2C53 before redrawing.'],
  }),
  routine(0x02D50, '_LABEL_2D50_', 'shop_menu_initial_renderer', '_LABEL_2D50_ shop/menu initial renderer', 'Builds the initial shop/menu frame, writes page text and item slots, initializes the selection marker, and refreshes status display.', {
    calls: ['_LABEL_8B2_', '_LABEL_2DEA_', '_LABEL_5EB_', '_LABEL_2EDF_', '_LABEL_2F35_', '_LABEL_23F1_'],
    ramRefs: ['_RAM_CF3E_', '_RAM_CF49_', '_RAM_CF69_'],
    evidence: ['ASM lines 7268-7279 draw the frame, item slots, marker, and status; lines 7281-7302 normalize menu state flags before rendering.'],
  }),
  routine(0x02D8E, '_LABEL_2D8E_', 'shop_menu_page_0_redraw', '_LABEL_2D8E_ shop/menu page 0 redraw', 'Redraws shop/menu item page 0 using its page title screen program, marker base, and status refresh.', {
    calls: ['_LABEL_2DE1_', '_LABEL_604_', '_LABEL_30DD_', '_LABEL_2F35_', '_LABEL_23F1_', '_LABEL_849_'],
    ramRefs: [],
    evidence: ['ASM lines 7304-7314 call the shared frame clear, run a screen program through _LABEL_604_, write item markers, and refresh sprites/display.'],
  }),
  routine(0x02DA9, '_LABEL_2DA9_', 'shop_menu_page_1_redraw', '_LABEL_2DA9_ shop/menu page 1 redraw', 'Redraws shop/menu item page 1 using its page title screen program, marker base, and status refresh.', {
    calls: ['_LABEL_2DE1_', '_LABEL_604_', '_LABEL_30DD_', '_LABEL_2F35_', '_LABEL_23F1_', '_LABEL_849_'],
    evidence: ['ASM lines 7316-7326 mirror the page redraw sequence with page base 0x10.'],
  }),
  routine(0x02DC5, '_LABEL_2DC5_', 'shop_menu_page_2_redraw', '_LABEL_2DC5_ shop/menu page 2 redraw', 'Redraws shop/menu item page 2 using its page title screen program, marker base, and status refresh.', {
    calls: ['_LABEL_2DE1_', '_LABEL_604_', '_LABEL_30DD_', '_LABEL_2F35_', '_LABEL_23F1_', '_LABEL_849_'],
    evidence: ['ASM lines 7328-7338 mirror the page redraw sequence with page base 0x20.'],
  }),
  routine(0x02DE1, '_LABEL_2DE1_', 'shop_menu_page_clear_entry', '_LABEL_2DE1_ shop/menu page clear entry', 'Clears/fades the current menu page and falls into the shared shop/menu frame writer.', {
    calls: ['_LABEL_822_', '_LABEL_8B2_', '_LABEL_2EA3_'],
    evidence: ['ASM lines 7340-7348 reset display state, load a palette/fade state, and fall into _LABEL_2DEA_.'],
  }),
  routine(0x02DEA, '_LABEL_2DEA_', 'shop_menu_frame_writer', '_LABEL_2DEA_ shop/menu frame writer', 'Shared shop/menu frame writer that clears a tile area and redraws the menu frame/title fragments.', {
    calls: ['_LABEL_59F_', '_LABEL_2EA3_'],
    evidence: ['ASM lines 7344-7348 call _LABEL_59F_ with a fixed clear value and then draw static frame elements through _LABEL_2EA3_.'],
  }),
  routine(0x02E60, '_LABEL_2E60_', 'shop_menu_root_selection_apply', '_LABEL_2E60_ shop/menu root selection apply', 'Applies a root-page selection by clearing the previous active item bits, setting the selected item bit, and updating the equipped item mirror.', {
    calls: ['_LABEL_2804_', '_LABEL_104B_'],
    ramRefs: ['_RAM_CF69_', '_RAM_D11B_'],
    evidence: ['ASM lines 7412-7454 resolve the selected item through _LABEL_2804_, clear a 20-entry active range, set bit 7 on the selected item, and mirror the selected id into _RAM_CF69_.'],
  }),
  routine(0x02EA3, '_LABEL_2EA3_', 'shop_menu_static_frame_drawer', '_LABEL_2EA3_ shop/menu static frame drawer', 'Draws the shop/menu frame rectangles, header labels, stat labels, and current form name using VDP helper routines.', {
    calls: ['_LABEL_34E2_', '_LABEL_604_', '_LABEL_307A_', '_LABEL_36E8_'],
    ramRefs: [],
    evidence: ['ASM lines 7456-7469 draw two framed blocks through _LABEL_34E2_, one screen program through _LABEL_604_, stat refresh through _LABEL_307A_, and form name through _LABEL_36E8_.'],
  }),
  routine(0x02EDF, '_LABEL_2EDF_', 'shop_menu_initial_category_writer', '_LABEL_2EDF_ shop/menu initial category writer', 'Writes the three item page columns, then falls through to the shared equipment/status item writer.', {
    calls: ['_LABEL_3655_', '_LABEL_3083_'],
    ramRefs: [],
    evidence: ['ASM lines 7476-7488 call _LABEL_3655_ for three page bases and then fall into _LABEL_2EFB_.'],
  }),
  routine(0x02EFB, '_LABEL_2EFB_', 'shop_menu_equipment_status_writer', '_LABEL_2EFB_ shop/menu equipment/status writer', 'Writes fixed equipment/status item icons and quantities using the shared _LABEL_3083_ renderer.', {
    calls: ['_LABEL_3083_'],
    ramRefs: [],
    evidence: ['ASM lines 7488-7510 call _LABEL_3083_ repeatedly for fixed menu destinations.'],
  }),
  routine(0x02F97, '_LABEL_2F97_', 'shop_menu_cursor_input_update', '_LABEL_2F97_ shop/menu cursor input update', 'Moves the shop/menu cursor across a two-row, five-column grid and redraws the old/new marker fragments.', {
    calls: ['_LABEL_104B_', '_LABEL_3025_'],
    ramRefs: ['_RAM_CF95_', '_RAM_D11C_', '_RAM_D117_', '_RAM_D119_'],
    evidence: ['ASM lines 7560-7634 test directional bits in _RAM_CF95_, update _RAM_D11C_ and VDP marker destinations, then call _LABEL_3025_ with the blank marker source.'],
  }),
  routine(0x0307A, '_LABEL_307A_', 'shop_menu_stat_refresh_triplet', '_LABEL_307A_ shop/menu stat refresh triplet', 'Refreshes the three displayed stat values by calling the AP/DP/CP value writers.', {
    calls: ['_LABEL_3280_', '_LABEL_3298_', '_LABEL_32B1_'],
    evidence: ['ASM lines 7692-7695 are a three-helper stat refresh chain.'],
  }),
  routine(0x03083, '_LABEL_3083_', 'shop_menu_item_icon_quantity_writer', '_LABEL_3083_ shop/menu item icon/quantity writer', 'Renders one item icon/name marker and its quantity/status field at a caller-supplied VDP destination.', {
    calls: ['_LABEL_2804_', '_LABEL_35CD_', '_LABEL_B97_', '_LABEL_5C3_'],
    ramRefs: ['_RAM_D0FE_', '_RAM_D120_', '_RAM_D11E_', '_RAM_D11F_'],
    evidence: ['ASM lines 7697-7754 resolve item state with _LABEL_2804_, draw its icon through _LABEL_35CD_, convert a value with _LABEL_B97_, and write digits through _LABEL_5C3_.'],
  }),
  routine(0x030ED, '_LABEL_30ED_', 'shop_menu_page_column_loop', '_LABEL_30ED_ shop/menu page-column loop', 'Inner loop used by _LABEL_30DD_ to render five vertically spaced item/name entries from a page base.', {
    calls: ['_LABEL_36A6_'],
    ramRefs: ['_RAM_D112_'],
    evidence: ['ASM lines 7763-7777 call _LABEL_36A6_, increment _RAM_D112_, advance the VDP destination by 0x00C0, and loop B times.'],
  }),
  routine(0x03105, '_LABEL_3105_', 'equipment_menu_controller_entry', '_LABEL_3105_ equipment menu controller entry', 'Initializes a four-slot equipment selection menu from an HL source list and enters its frame/input loop.', {
    calls: ['_LABEL_332D_', '_LABEL_849_', '_LABEL_1004_', '_LABEL_BFD_', '_LABEL_316A_'],
    ramRefs: ['_RAM_CFFE_', '_RAM_D11C_', '_RAM_CF86_'],
    evidence: ['ASM lines 7779-7789 store the source pointer in _RAM_CFFE_, reset cursor/menu flags, render through _LABEL_332D_, and enter the frame loop.'],
  }),
  routine(0x0311E, '_LABEL_311E_', 'equipment_menu_input_accept', '_LABEL_311E_ equipment menu input/accept handler', 'Handles cursor movement and accept/cancel for the four-slot equipment selection menu.', {
    calls: ['_LABEL_31A7_', '_LABEL_822_', '_LABEL_2518_', '_LABEL_2804_', '_LABEL_372B_', '_LABEL_104B_'],
    ramRefs: ['_RAM_CF95_', '_RAM_D11C_', '_RAM_CFFC_', '_RAM_D133_'],
    evidence: ['ASM lines 7791-7832 update cursor movement, exit on cancel/final slot, or call _LABEL_372B_ when an available slot is accepted.'],
  }),
  routine(0x0316A, '_LABEL_316A_', 'equipment_menu_nested_shop_gate', '_LABEL_316A_ equipment menu nested-shop gate', 'Detects _RAM_CF86_ menu requests during equipment selection, opens the shop/menu flow, then returns to the equipment menu source list.', {
    calls: ['_LABEL_311E_', '_LABEL_822_', '_LABEL_8FB_', '_LABEL_104B_', '_LABEL_2BBE_', '_LABEL_1004_', '_LABEL_BFD_', '_LABEL_3105_'],
    ramRefs: ['_RAM_CF86_', '_RAM_CFFC_', '_RAM_CFFE_'],
    evidence: ['ASM lines 7834-7853 branch to the shop/menu request path when _RAM_CF86_ is set, then reload the source pointer and restart _LABEL_3105_.'],
  }),
  routine(0x031A7, '_LABEL_31A7_', 'equipment_menu_cursor_input_update', '_LABEL_31A7_ equipment menu cursor input update', 'Moves the equipment menu cursor through four vertical choices and redraws the selection preview.', {
    calls: ['_LABEL_104B_', '_LABEL_3025_', '_LABEL_32E2_', '_LABEL_3713_'],
    ramRefs: ['_RAM_CF95_', '_RAM_D11C_', '_RAM_D117_', '_RAM_D119_', '_RAM_D133_'],
    evidence: ['ASM lines 7859-7920 handle up/down input, update _RAM_D11C_ and marker VDP destinations, redraw the marker, and update the selected item preview.'],
  }),
  routine(0x03280, '_LABEL_3280_', 'shop_menu_ap_value_writer', '_LABEL_3280_ shop/menu AP value writer', 'Computes and writes the first displayed stat value to the menu VDP area.', {
    calls: ['_LABEL_2779_', '_LABEL_B97_', '_LABEL_5C3_'],
    ramRefs: ['_RAM_C258_', '_RAM_D120_'],
    evidence: ['ASM lines 7930-7939 call _LABEL_2779_, convert _RAM_C258_, and write three digits through _LABEL_5C3_.'],
  }),
  routine(0x03298, '_LABEL_3298_', 'shop_menu_dp_value_writer', '_LABEL_3298_ shop/menu DP value writer', 'Computes and writes the second displayed stat value to the menu VDP area.', {
    calls: ['_LABEL_279E_', '_LABEL_B97_', '_LABEL_5C3_'],
    ramRefs: ['_RAM_C259_', '_RAM_D120_'],
    evidence: ['ASM lines 7941-7951 call _LABEL_279E_, convert _RAM_C259_, and write three digits through _LABEL_5C3_.'],
  }),
  routine(0x032B1, '_LABEL_32B1_', 'shop_menu_cp_value_writer', '_LABEL_32B1_ shop/menu CP value writer', 'Computes and writes the third displayed stat value to the menu VDP area.', {
    calls: ['_LABEL_27D6_', '_LABEL_B97_', '_LABEL_5C3_'],
    ramRefs: ['_RAM_C25A_', '_RAM_D120_'],
    evidence: ['ASM lines 7953-7962 call _LABEL_27D6_, convert _RAM_C25A_, and write three digits through _LABEL_5C3_.'],
  }),
  routine(0x032C9, '_LABEL_32C9_', 'form_dependent_tile_pointer_helper', '_LABEL_32C9_ form-dependent tile pointer helper', 'Converts _RAM_CF54_ into a small offset into the tile/name table used for selected item preview rendering.', {
    ramRefs: ['_RAM_CF54_'],
    evidence: ['ASM lines 7964-7982 derive HL=$8200+(bucket*4) by repeatedly subtracting 0x0D from _RAM_CF54_.'],
  }),
  routine(0x032E2, '_LABEL_32E2_', 'equipment_selected_preview_writer', '_LABEL_32E2_ equipment selected preview writer', 'Writes the currently selected equipment/menu item preview or blank preview into a fixed VDP destination.', {
    calls: ['_LABEL_3713_', '_LABEL_2819_', '_LABEL_32C9_', '_LABEL_5C3_'],
    ramRefs: ['_RAM_D0FE_', '_RAM_D101_'],
    evidence: ['ASM lines 7984-8033 handle empty/special entries, copy four preview bytes into _RAM_D0FE_.., and write the preview through _LABEL_5C3_.'],
  }),
  routine(0x0332D, '_LABEL_332D_', 'equipment_menu_screen_renderer', '_LABEL_332D_ equipment menu screen renderer', 'Builds the four-slot equipment selection screen, copies the source list to _RAM_D133_, draws framed slots, and initializes the preview.', {
    calls: ['_LABEL_59F_', '_LABEL_8B2_', '_LABEL_1023_', '_LABEL_8FB_', '_LABEL_1036_', '_LABEL_342E_', '_LABEL_5EB_', '_LABEL_35CD_', '_LABEL_37F8_', '_LABEL_34E2_', '_LABEL_2F35_', '_LABEL_3489_', '_LABEL_32E2_', '_LABEL_23F1_'],
    ramRefs: ['_RAM_CFFE_', '_RAM_D133_', '_RAM_D10E_', '_RAM_D100_', '_RAM_D0F0_', '_RAM_D0EE_', '_RAM_D02C_'],
    evidence: ['ASM lines 8035-8123 load the screen tiles, copy four source entries, validate them, draw four framed rows, initialize the marker, and render the selected preview.'],
  }),
  routine(0x03381, '_LABEL_3381_', 'equipment_menu_slot_render_loop', '_LABEL_3381_ equipment menu slot render loop', 'Per-slot loop inside the equipment screen renderer that draws each item row and its frame.', {
    calls: ['_LABEL_37F8_', '_LABEL_35CD_', '_LABEL_34E2_'],
    ramRefs: ['_RAM_D0F0_', '_RAM_D0EE_', '_RAM_D100_'],
    evidence: ['ASM lines 8070-8105 render each of four rows, handling sold-out/special entries through _LABEL_37F8_ or normal entries through _LABEL_35CD_.'],
  }),
  routine(0x033FB, '_LABEL_33FB_', 'vdp_macro_stream_writer', '_LABEL_33FB_ VDP macro stream writer', 'Writes a byte/attribute macro stream to VDP until $FF, with $FE advancing to the next VDP row.', {
    ramRefs: ['_RAM_CF82_', '_RAM_D0DE_'],
    evidence: ['ASM lines 8125-8165 write the VDP address, stream bytes through RST $30, treat $FE as a next-row control, and stop on $FF.'],
  }),
  routine(0x0342E, '_LABEL_342E_', 'equipment_availability_scan_entry', '_LABEL_342E_ equipment availability scan entry', 'Entry setup for the four-slot equipment availability scan that starts at _RAM_D133_.', {
    calls: ['_LABEL_3433_'],
    ramRefs: ['_RAM_D133_'],
    evidence: ['ASM lines 8166-8169 set B=4 and DE=_RAM_D133_ before entering _LABEL_3433_.'],
  }),
  routine(0x03433, '_LABEL_3433_', 'equipment_availability_scan_loop', '_LABEL_3433_ equipment availability scan loop', 'Validates each equipment selection candidate against inventory/status thresholds and marks unavailable entries as $FE.', {
    calls: ['_LABEL_2804_', '_LABEL_2819_'],
    ramRefs: ['_RAM_D133_', '_RAM_C25A_'],
    evidence: ['ASM lines 8169-8231 scan four entries, compare item state and thresholds, set bit 7 for available entries, and write $FE for invalid ones.'],
  }),
  routine(0x03489, '_LABEL_3489_', 'equipment_preview_availability_entry', '_LABEL_3489_ equipment preview availability entry', 'Entry setup for the second equipment availability pass used before preview rendering.', {
    calls: ['_LABEL_3495_'],
    ramRefs: ['_RAM_D0E0_', '_RAM_D0DE_', '_RAM_D133_'],
    evidence: ['ASM lines 8233-8238 set a four-entry counter and current source pointer before entering _LABEL_3495_.'],
  }),
  routine(0x03495, '_LABEL_3495_', 'equipment_preview_availability_loop', '_LABEL_3495_ equipment preview availability loop', 'Copies preview metadata for each equipment entry and flags matching inventory items when a candidate is available.', {
    calls: ['_LABEL_32C9_', '_LABEL_2819_', '_LABEL_BBB_'],
    ramRefs: ['_RAM_D0DE_', '_RAM_D0E0_', '_RAM_D0E1_', '_RAM_CF55_'],
    evidence: ['ASM lines 8238-8281 resolve each entry into a six-byte compare buffer and use _LABEL_BBB_ to decide whether to set bit 7 on the source entry.'],
  }),
  routine(0x036A6, '_LABEL_36A6_', 'item_name_display_record_writer', '_LABEL_36A6_ item/name display record writer', 'Renders item/name display records selected through the bank-7 item pointer tables, using _LABEL_33FB_ as the final VDP macro writer.', {
    calls: ['_LABEL_2804_', '_LABEL_33FB_'],
    ramRefs: ['_RAM_D0DE_', '_RAM_D0E0_', '_RAM_D0E1_'],
    evidence: ['Existing bank7MenuItemAudit records _LABEL_36A6_ indexing _DATA_1C270_ + 2 and rendering selected item/name records.', 'ASM lines 8562-8601 select the subrecord pointer, resolve item state, and jump to _LABEL_33FB_.'],
  }),
  routine(0x03713, '_LABEL_3713_', 'vdp_repeated_tile_pair_writer', '_LABEL_3713_ repeated VDP tile-pair writer', 'Writes the same tile/attribute pair to a VDP name-table location B times.', {
    ramRefs: ['_RAM_CF82_'],
    evidence: ['ASM lines 8636-8654 set the VDP address, write DE as repeated tile/attribute pairs B times, and clear _RAM_CF82_.'],
  }),
  routine(0x0372B, '_LABEL_372B_', 'equipment_selection_apply', '_LABEL_372B_ equipment selection apply', 'Applies an accepted equipment/menu selection, updates inventory state, redraws the preview/availability markers, and plays the confirmation sound.', {
    calls: ['_LABEL_104B_', '_LABEL_3763_', '_LABEL_BE7_', '_LABEL_241B_', '_LABEL_242B_', '_LABEL_3796_', '_LABEL_3489_', '_LABEL_32E2_'],
    ramRefs: ['_RAM_D0FE_', '_RAM_CF55_', '_RAM_D133_', '_RAM_D11C_'],
    evidence: ['ASM lines 8656-8682 reject unavailable entries, increment/mark inventory through _LABEL_3763_, update compare state, redraw previews, and play effect 0x1B.'],
  }),
  routine(0x03763, '_LABEL_3763_', 'inventory_quantity_increment', '_LABEL_3763_ inventory quantity increment', 'Increments or marks the selected inventory/equipment entry with item-specific caps.', {
    calls: ['_LABEL_2804_'],
    ramRefs: ['_RAM_D0DE_'],
    evidence: ['ASM lines 8684-8718 resolve the item slot with _LABEL_2804_ and apply capped increment/set rules by item id.'],
  }),
  routine(0x03796, '_LABEL_3796_', 'inventory_capacity_check', '_LABEL_3796_ inventory capacity check', 'Checks whether an item/equipment entry has reached its cap and branches to the sold-out redraw path when full.', {
    calls: ['_LABEL_2804_', '_LABEL_382E_', '_LABEL_37F8_'],
    ramRefs: ['_RAM_D117_', '_RAM_D11C_', '_RAM_D10E_'],
    evidence: ['ASM lines 8720-8800 compare inventory counts against item-specific caps, mark the slot through _LABEL_382E_, and fall into _LABEL_37F8_ for the row redraw.'],
  }),
  routine(0x037F8, '_LABEL_37F8_', 'sold_out_row_writer', '_LABEL_37F8_ sold-out row writer', 'Writes a fixed unavailable-entry row to the current VDP row and clears the following row with repeated blanks.', {
    calls: ['_LABEL_3655_', '_LABEL_3713_'],
    ramRefs: [],
    evidence: ['ASM lines 8772-8800 call _LABEL_3655_ for the selected item row, then write a fixed text/tile run and clear the next row via _LABEL_3713_.'],
  }),
  routine(0x0382E, '_LABEL_382E_', 'equipment_slot_mark_unavailable', '_LABEL_382E_ equipment slot mark unavailable', 'Marks the current equipment menu source entry as unavailable by writing $FE into _RAM_D133_ + cursor.', {
    ramRefs: ['_RAM_D11C_', '_RAM_D133_'],
    evidence: ['ASM lines 8806-8813 index _RAM_D133_ by _RAM_D11C_ and store the unavailable sentinel.'],
  }),
  routine(0x0383B, '_LABEL_383B_', 'shop_purchase_menu_controller_entry', '_LABEL_383B_ shop purchase/menu controller entry', 'Initializes the two-option shop purchase screen and enters its input/render loop.', {
    calls: ['_LABEL_39AA_', '_LABEL_849_', '_LABEL_1004_', '_LABEL_BFD_', '_LABEL_396B_'],
    ramRefs: ['_RAM_D11C_', '_RAM_D11D_', '_RAM_CF86_'],
    evidence: ['ASM lines 8815-8828 reset cursor/state, draw through _LABEL_39AA_, and enter the loop controlled by _LABEL_396B_.'],
  }),
  routine(0x0385B, '_LABEL_385B_', 'shop_purchase_input_handler', '_LABEL_385B_ shop purchase input handler', 'Handles shop purchase/cancel input, item availability checks, currency comparison, and purchase application.', {
    calls: ['_LABEL_3A4A_', '_LABEL_399E_', '_LABEL_104B_', '_LABEL_822_', '_LABEL_BE7_', '_LABEL_3AA8_', '_LABEL_241B_'],
    ramRefs: ['_RAM_CF95_', '_RAM_D11C_', '_RAM_CFFC_', '_RAM_D133_', '_RAM_D10E_', '_RAM_CF55_'],
    evidence: ['ASM lines 8830-8869 test cursor/input state, reject unavailable or unaffordable choices, compare cost state through _LABEL_3AA8_, and apply the purchase through _LABEL_241B_.'],
  }),
  routine(0x038AD, '_LABEL_38AD_', 'shop_currency_scroll_animation', '_LABEL_38AD_ shop currency scroll animation', 'Animates the currency/count display toward a target value, with optional input-controlled delay, and plays start/end sound effects.', {
    calls: ['_LABEL_6E7_', '_LABEL_D36_', '_LABEL_104B_', '_LABEL_24DE_', '_LABEL_1004_', '_LABEL_BFD_', '_LABEL_399E_'],
    ramRefs: ['_RAM_C240_', '_RAM_D277_', '_RAM_CF54_', '_RAM_D276_', '_RAM_D275_', '_RAM_CF95_', '_RAM_CF52_'],
    evidence: ['ASM lines 8871-8960 compute a target from _RAM_CF54_/_RAM_D275_, repeatedly call _LABEL_24DE_ and frame pumps until _RAM_CF52_ reaches that target, then clears _RAM_D275_.'],
  }),
  routine(0x0394F, '_LABEL_394F_', 'shop_purchase_cursor_default', '_LABEL_394F_ shop purchase cursor default', 'Ensures a default cursor/action state before returning to the shop purchase loop.', {
    calls: ['_LABEL_3A7A_', '_LABEL_BFD_', '_LABEL_396B_'],
    ramRefs: ['_RAM_D11C_', '_RAM_D11D_'],
    evidence: ['ASM lines 8962-8970 optionally advances the cursor, sets _RAM_D11D_, pumps input, and jumps to the loop gate.'],
  }),
  routine(0x0395B, '_LABEL_395B_', 'shop_purchase_input_pump', '_LABEL_395B_ shop purchase input pump', 'Shared input pump used while waiting for shop purchase input or menu restart.', {
    calls: ['_LABEL_BFD_', '_LABEL_396B_', '_LABEL_822_'],
    ramRefs: ['_RAM_CF95_'],
    evidence: ['ASM lines 8968-8976 pump _LABEL_BFD_ and exit through _LABEL_822_ when accept/cancel bits are seen.'],
  }),
  routine(0x0396B, '_LABEL_396B_', 'shop_purchase_loop_gate', '_LABEL_396B_ shop purchase loop gate', 'Main loop gate for the shop purchase screen, restarting nested menu flow when _RAM_CF86_ is set.', {
    calls: ['_LABEL_385B_', '_LABEL_822_', '_LABEL_8FB_', '_LABEL_104B_', '_LABEL_2BBE_', '_LABEL_1004_', '_LABEL_BFD_', '_LABEL_383B_'],
    ramRefs: ['_RAM_CF86_', '_RAM_D11D_'],
    evidence: ['ASM lines 8978-9000 either returns to _LABEL_385B_, waits for input, or opens the nested shop/menu request path and restarts _LABEL_383B_.'],
  }),
  routine(0x0399E, '_LABEL_399E_', 'shop_currency_target_compare', '_LABEL_399E_ shop currency target compare', 'Compares the high byte of the current currency/count word shifted into display units against _RAM_CF54_.', {
    ramRefs: ['_RAM_CF52_', '_RAM_CF54_'],
    evidence: ['ASM lines 9002-9010 shift _RAM_CF52_ left four times and compare H against _RAM_CF54_.'],
  }),
  routine(0x039AA, '_LABEL_39AA_', 'shop_purchase_screen_renderer', '_LABEL_39AA_ shop purchase screen renderer', 'Builds the two-option shop purchase screen, draws frames, initializes cursor position, loads price/item nibbles from bank-7 menu data, and applies preview state.', {
    calls: ['_LABEL_59F_', '_LABEL_1023_', '_LABEL_8FB_', '_LABEL_1036_', '_LABEL_8B2_', '_LABEL_5EB_', '_LABEL_34E2_', '_LABEL_399E_', '_LABEL_2F35_', '_LABEL_3AA8_', '_LABEL_241B_'],
    ramRefs: ['_RAM_D11C_', '_RAM_D11D_', '_RAM_C24F_', '_RAM_CF54_', '_RAM_D10E_', '_RAM_D133_'],
    evidence: ['ASM lines 9012-9095 load the shop purchase tiles, draw three framed blocks, initialize the cursor, derive four nibbles from _DATA_1C550_, and update compare/apply state.'],
  }),
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
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

function wasInferredOnlyBeforeThisAudit(region) {
  if (!region) return false;
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank0MenuRoutineAudit');
  return keys.length === 1 && keys[0] === 'inferred';
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      entryCount: ENTRIES.length,
      assetPolicy: 'Metadata only: ASM labels, offsets, routine roles, calls, RAM references, and evidence. No ROM bytes, decoded graphics, or text assets are embedded.',
    },
    entries: ENTRIES.map(entry => ({
      ...entry,
      offset: hex(entry.offset),
      region: regionRef(findExactRegion(mapData, entry.offset)),
    })),
    evidence: [
      'ASM lines 6697-6782 show _LABEL_2855_ opening/closing the in-game menu flow through _LABEL_28AE_/_LABEL_2BBE_/_LABEL_28E1_.',
      'ASM lines 7067-7091 show _LABEL_2BBE_ dispatching shop/menu page handlers through _DATA_2BF0_.',
      'ASM lines 7456-8800 show shared VDP frame, marker, item, preview, and availability writers used by the menu screens.',
      'ASM lines 8815-9095 show the shop purchase screen controller, input handler, currency animation, and renderer.',
    ],
  };
}

function annotateRegion(region, entry) {
  const typeBefore = region.type || 'unknown';
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  if (entry.type) region.type = entry.type;
  if (entry.name && (!region.name || region.name.startsWith('Load enemy spawn table'))) region.name = entry.name;
  if (entry.summary && !region.notes) region.notes = entry.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank0MenuRoutineAudit = {
    catalogId,
    kind: entry.role,
    family: entry.family,
    label: entry.label,
    confidence: entry.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType: typeBefore !== (region.type || typeBefore),
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    calls: entry.calls,
    ramRefs: entry.ramRefs,
    summary: entry.summary,
    evidence: entry.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    label: entry.label,
    role: entry.role,
    confidence: entry.confidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    changedType: typeBefore !== (region.type || typeBefore),
  };
}

function applyAnnotations(mapData) {
  const annotated = [];
  const missing = [];
  for (const entry of ENTRIES) {
    const region = findExactRegion(mapData, entry.offset);
    if (!region) {
      missing.push({ offset: hex(entry.offset), label: entry.label, role: entry.role });
      continue;
    }
    annotated.push(annotateRegion(region, entry));
  }
  return { annotated, missing };
}

function main() {
  const mapData = readJson(mapPath);
  let changes = { annotated: [], missing: [] };

  if (apply) {
    changes = applyAnnotations(mapData);
    const finalCatalog = buildCatalog(mapData);
    mapData.menuRoutineCatalogs = (mapData.menuRoutineCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.menuRoutineCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank0_menu_routine_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: changes.annotated.length,
        missingRegions: changes.missing.length,
        inferredOnlyRegionsCovered: changes.annotated.filter(change => change.wasInferredOnlyBeforeAudit).length,
      },
      annotatedRegions: changes.annotated,
      missingRegions: changes.missing,
      nextLeads: [
        'Convert _LABEL_33FB_ and related item/name record formats into a read-only browser preview that consumes local ROM bytes only.',
        'Trace _RAM_CF20_/_RAM_CF2A_/_RAM_CF34_ category bytes into the item/equipment save-state model.',
        'Connect _LABEL_38AD_ currency/count animation to the money/stat RAM variables so purchases can be replayed frame-for-frame.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  const catalog = buildCatalog(apply ? readJson(mapPath) : mapData);
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: changes.annotated.length,
      missingRegions: changes.missing.length,
      inferredOnlyRegionsCovered: changes.annotated.filter(change => change.wasInferredOnlyBeforeAudit).length,
    },
    missingRegions: changes.missing,
  }, null, 2));
}

main();
