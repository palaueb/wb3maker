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
const catalogId = 'world-bank0-core-runtime-catalog-2026-06-25';
const reportId = 'bank0-core-runtime-audit-2026-06-25';
const toolName = 'tools/world-bank0-core-runtime-audit.mjs';

function routine(offset, label, role, name, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name,
    type: 'code',
    family: options.family || 'bank0_core_runtime',
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
  routine(0x00038, '_LABEL_38_', 'maskable_interrupt_handler', '_LABEL_38_ maskable interrupt handler', 'Handles VBlank IRQ service: samples controller ports, schedules scroll/dynamic tile/sprite/VRAM updates, calls the bank-3 audio update, and restores the active bank.', {
    calls: ['_LABEL_129_', '_LABEL_1D1_', '_LABEL_202_', '_LABEL_190_', '_LABEL_168_', '_LABEL_1065_'],
    ramRefs: ['_RAM_DFFF_', '_RAM_CF83_', '_RAM_CF84_', '_RAM_CF81_', '_RAM_CF82_', '_RAM_FFFF_'],
    evidence: ['ASM lines 928-987 push CPU state, test Port_VDPStatus bit 7, run the per-frame visual update helpers when _RAM_CF82_ is clear, then restore _RAM_FFFF_.'],
  }),
  routine(0x00168, '_LABEL_168_', 'vram_fast_update_copy', '_LABEL_168_ VRAM fast update copy', 'Copies 32 bytes from the pending tile/name buffer at _RAM_CFBB_ to VDP address 0x2800 when _RAM_CFE2_ is set.', {
    ramRefs: ['_RAM_CFE2_', '_RAM_CFBB_'],
    evidence: ['ASM lines 1099-1125 gate on _RAM_CFE2_, write VDP address 0x2800, copy 0x20 bytes through Port_VDPData, and clear _RAM_CFE2_.'],
  }),
  routine(0x00190, '_LABEL_190_', 'sprite_oam_upgrade', '_LABEL_190_ sprite/OAM upgrade', 'Uploads the prepared sprite attribute table from _RAM_CA40_ into VDP sprite attribute memory when _RAM_CFE0_ is set.', {
    ramRefs: ['_RAM_CFE0_', '_RAM_CFE2_', '_RAM_CA40_'],
    evidence: ['ASM lines 1127-1168 first writes 64 Y bytes from _RAM_CA40_ and then writes paired X/tile bytes from the same 3-byte sprite records.'],
  }),
  routine(0x001D1, '_LABEL_1D1_', 'scroll_register_update', '_LABEL_1D1_ scroll register update', 'Writes horizontal and vertical scroll VDP registers from _RAM_CF8C_/_RAM_CF8D_, with optional shake/random offset from _RAM_D005_.', {
    ramRefs: ['_RAM_CFE1_', '_RAM_D005_', '_RAM_CF8C_', '_RAM_CF8D_'],
    evidence: ['ASM lines 1170-1196 update VDP registers 0x88/0x89 and clear _RAM_CFE1_.'],
  }),
  routine(0x00202, '_LABEL_202_', 'dynamic_tile_pair_upload', '_LABEL_202_ dynamic tiles', 'Uploads 22 tile/attribute pairs from _RAM_D248_ to the pending VDP address tracked in _RAM_D014_/_RAM_D015_.', {
    ramRefs: ['_RAM_D247_', '_RAM_D248_', '_RAM_D014_', '_RAM_D015_'],
    evidence: ['ASM lines 1198-1226 gate on _RAM_D247_, stream two bytes per row, advance the VDP address by 0x40 each row, and clear _RAM_D247_.'],
  }),
  routine(0x00237, '_LABEL_237_', 'hardware_fm_detector', '_LABEL_237_ hardware/FM detector', 'Detects FM audio hardware and configures audio control state while preserving fallback behavior for non-FM hardware.', {
    ramRefs: ['_RAM_C232_', '_RAM_CF85_'],
    evidence: ['ASM lines 1228-1298 probe Port_IOPort2 and Port_AudioControl, write _RAM_C232_ with the detected mode, and restore Port_IOPortControl to 0xFF.'],
  }),
  routine(0x00348, '_LABEL_348_', 'title_screen_wait_loop', '_LABEL_348_ title screen wait loop', 'Runs the title-screen wait/countdown loop, exits to gameplay on start input, or fades/clears and returns after the timeout.', {
    calls: ['_LABEL_FEE_', '_LABEL_10BC_', '_LABEL_8B2_', '_LABEL_822_', '_LABEL_D94_'],
    ramRefs: ['_RAM_CF99_', '_RAM_CF90_', '_RAM_CF65_'],
    evidence: ['ASM lines 1376-1404 decrement _RAM_CF99_ while polling start bits in _RAM_CF90_; timeout clears/fades, input jumps to _LABEL_107_.'],
  }),
  routine(0x00491, '_LABEL_491_', 'new_game_inventory_reset', '_LABEL_491_ new-game inventory reset', 'Clears inventory/equipment bytes, seeds the initial active equipment flags, and resets startup state flags for a new game or demo path.', {
    ramRefs: ['_RAM_CF55_', '_RAM_CF20_', '_RAM_CF49_', '_RAM_CF2A_', '_RAM_CF34_', '_RAM_D005_', '_RAM_CF4A_'],
    evidence: ['ASM lines 1529-1552 clear _RAM_CF55_ and _RAM_CF20_ ranges, then initialize _RAM_CF49_, _RAM_CF20_, _RAM_CF2A_, _RAM_CF34_, _RAM_D005_, and _RAM_CF4A_.'],
  }),
  routine(0x004BD, '_LABEL_4BD_', 'main_gameplay_frame_loop', '_LABEL_4BD_ main gameplay frame loop', 'Runs the main gameplay frame loop: waits for VBlank, handles input/menu, runs banked game logic, refreshes room/entities/player display state, and loops with scroll updates enabled.', {
    calls: ['_LABEL_FEE_', '_LABEL_BFD_', '_LABEL_2855_', '_LABEL_B3C0_', '_LABEL_4746_', '_LABEL_61CE_', '_LABEL_56F4_', '_LABEL_5788_', '_LABEL_10BC_', '_LABEL_FA1_', '_LABEL_EB3_', '_LABEL_5C4A_', '_LABEL_64CD_', '_LABEL_608F_', '_LABEL_46D9_', '_LABEL_627A_', '_LABEL_6401_', '_LABEL_6E7_'],
    ramRefs: ['_RAM_FFFF_', '_RAM_CF89_', '_RAM_CFE1_'],
    evidence: ['ASM lines 1554-1581 show one complete frame: input/menu gates, bank-2 and room/entity calls, display/scroll/tile refresh, sprite build, then recursive jump to _LABEL_4BD_.'],
  }),
  routine(0x00508, '_LABEL_508_', 'demo_game_post_title_init', '_LABEL_508_ demo game post-title init', 'Initializes the demo/post-title gameplay scene by loading base VRAM tiles, clearing state, loading the starting room, seeding camera and script pointers, then fading in.', {
    calls: ['_LABEL_106E_', '_LABEL_8B2_', '_LABEL_8FB_', '_LABEL_998_', '_LABEL_491_', '_LABEL_291F_', '_LABEL_2620_', '_LABEL_23F1_', '_LABEL_849_'],
    ramRefs: ['_RAM_CF86_', '_RAM_C24F_', '_RAM_C251_', '_RAM_CF25_', '_RAM_CF52_', '_RAM_CF54_', '_RAM_CFEE_', '_RAM_CFF0_'],
    evidence: ['ASM lines 1583-1612 load _DATA_2A55_ through _LABEL_8FB_, _DATA_2AE2_ through _LABEL_998_, load _DATA_10C96_ through _LABEL_2620_, and fade in via _LABEL_849_.'],
  }),
  routine(0x00556, '_LABEL_556_', 'name_table_clear_background', '_LABEL_556_ name-table clear background', 'Clears the visible name table by writing the same tile/attribute pair across 0x380 entries starting at VDP address 0x7800.', {
    ramRefs: ['_RAM_CF82_'],
    evidence: ['ASM lines 1614-1636 set VDP address 0x7800, set _RAM_CF82_ while streaming, write tile/attribute pair 0x01/0x01 repeatedly, then clear _RAM_CF82_.'],
  }),
  routine(0x0067F, '_LABEL_67F_', 'screen_prog_scroll_wait_command', '_LABEL_67F_ screen bytecode scroll/wait command', 'Continuation of screen program command 6: waits while advancing vertical scroll, calls a bank-2 helper, then writes a blank row before returning to the screen bytecode loop.', {
    calls: ['_LABEL_BE97_', '_LABEL_FF9_'],
    ramRefs: ['_RAM_D0E2_', '_RAM_CF83_', '_RAM_CF8D_', '_RAM_CFE1_', '_RAM_CF82_', '_RAM_FFFF_', '_RAM_D0E0_'],
    evidence: ['ASM lines 1832-1905 advance _RAM_CF8D_ every fourth frame, call _LABEL_BE97_ in bank 2, wait for frames through _LABEL_FF9_, then write 0x20 tile pairs at the current VDP row.'],
  }),
  routine(0x00792, '_LABEL_792_', 'sprite_frame_record_decoder', '_LABEL_792_ sprite frame record decoder', 'Decodes one metasprite/frame stream into the OAM staging buffer, clipping against the camera-relative X/Y positions and appending 3-byte sprite entries.', {
    ramRefs: ['_RAM_D00B_', '_RAM_D00C_', '_RAM_D00D_', '_RAM_D00E_', '_RAM_CFE0_', 'IX+12', 'IX+13', 'IX+63'],
    evidence: ['ASM lines 1979-2040 read the frame stream until 0x80, skip hidden/clipped entries, append Y/X/tile triplets through IY, and set _RAM_CFE0_ when the OAM buffer fills.'],
  }),
  routine(0x007EC, '_LABEL_7EC_', 'palette_fade_step_builder', '_LABEL_7EC_ palette fade step builder', 'Builds one palette fade step by deriving the next CRAM shadow values from _RAM_CF9B_ into _RAM_CFBB_ using _RAM_CFDB_ as the fade strength.', {
    ramRefs: ['_RAM_CF9B_', '_RAM_CFBB_', '_RAM_CFDB_'],
    evidence: ['ASM lines 2042-2077 iterate 0x20 palette bytes, reduce each two-bit color channel by _RAM_CFDB_, and store the result 32 bytes later.'],
  }),
  routine(0x00849, '_LABEL_849_', 'fade_in_palette', '_LABEL_849_ fade in palette', 'Runs the palette fade-in sequence by applying fade levels 2, 1, and 0 over timed VBlank waits, then clears the temporary flag _RAM_C23C_.', {
    calls: ['_LABEL_7EC_', '_LABEL_FEE_', '_LABEL_D85_'],
    ramRefs: ['_RAM_CFDB_', '_RAM_CFE2_', '_RAM_C23C_'],
    evidence: ['ASM lines 2100-2127 call _LABEL_7EC_ at fade levels 2, then 1 and 0, setting _RAM_CFE2_ and waiting five frames between steps.'],
  }),
  routine(0x00881, '_LABEL_881_', 'fade_delay_palette_marker', '_LABEL_881_ fade delay palette marker', 'Advances a small delayed palette marker table while _RAM_CFFC_ is active, ending after 14 steps.', {
    ramRefs: ['_RAM_CFFC_', '_RAM_CFFD_', '_RAM_C23C_'],
    evidence: ['ASM lines 2129-2149 increment _RAM_CFFD_, use it to read the 16-byte table at 0x08A2, store _RAM_C23C_, and clear _RAM_CFFC_ once the limit is reached.'],
  }),
  routine(0x00BFD, '_LABEL_BFD_', 'demo_or_live_input_router', '_LABEL_BFD_ demo/live input router', 'Routes input either from a scripted demo stream or from live controller edge state depending on _RAM_CF87_.', {
    calls: ['_LABEL_C4D_'],
    ramRefs: ['_RAM_CF87_', '_RAM_CF90_', '_RAM_D278_', '_RAM_CF89_', '_RAM_CF91_', '_RAM_CF98_', '_RAM_CF86_', '_RAM_FFFF_', '_RAM_CFEE_', '_RAM_CFF0_', '_RAM_D279_', '_RAM_CF95_'],
    evidence: ['ASM lines 2685-2730 branch to _LABEL_C4D_ for live play, otherwise consume the bank-7 scripted input stream at _RAM_CFEE_ and expose held/edge bits in _RAM_D279_/_RAM_CF95_.'],
  }),
  routine(0x00C4D, '_LABEL_C4D_', 'live_input_edge_builder', '_LABEL_C4D_ live input edge builder', 'Builds live controller held and newly-pressed bitfields for gameplay/menu code and opens the menu request flag when pause/menu bits are pressed.', {
    ramRefs: ['_RAM_CF90_', '_RAM_CF91_', '_RAM_CF92_', '_RAM_CF93_', '_RAM_CF94_', '_RAM_CF95_', '_RAM_CF96_', '_RAM_CF98_', '_RAM_CF86_', '_RAM_D279_'],
    evidence: ['ASM lines 2732-2768 compare current/previous controller samples, store held bits in _RAM_D279_, edge bits in _RAM_CF95_/_RAM_CF96_, and set _RAM_CF86_ on menu-trigger conditions.'],
  }),
  routine(0x00D94, '_LABEL_D94_', 'display_shutdown_and_palette_clear', '_LABEL_D94_ shutdown display', 'Clears the pending palette buffer, requests a palette upload, waits one frame, and disables display output through VDP register 1.', {
    calls: ['_LABEL_FF9_'],
    ramRefs: ['_RAM_CFBB_', '_RAM_CFE2_', '_RAM_CF6E_'],
    evidence: ['ASM lines 2854-2872 clear 32 bytes at _RAM_CFBB_, set _RAM_CFE2_, wait for VBlank, and reset bit 6 of the saved VDP register byte _RAM_CF6E_.'],
  }),
  routine(0x00E34, '_LABEL_E34_', 'tilemap_rle_decode_inner_loop', '_LABEL_E34_ tilemap RLE decode inner loop', 'Inner decoder for room/screen tile-map streams, writing decompressed 16-column rows into the _RAM_CB00_ tilemap buffer with literal and repeated-run commands.', {
    ramRefs: ['_RAM_D0E4_', '_RAM_D0E5_'],
    evidence: ['ASM lines 2936-2994 copy literal bytes below 0xE3, handle 0xE0+ run lengths, wrap every 16 bytes by adding 0x50 to DE, and stop at 0xFF.'],
  }),
  routine(0x00EB3, '_LABEL_EB3_', 'scroll_column_redraw_to_vram', '_LABEL_EB3_ scroll column redraw to VRAM', 'Moves the rendered tile column buffer toward the current camera column and refreshes the corresponding dynamic VDP strip.', {
    calls: ['_LABEL_EF3_'],
    ramRefs: ['_RAM_D00F_', '_RAM_D011_', '_RAM_D012_', '_RAM_D013_'],
    evidence: ['ASM lines 3023-3058 compute the target column from _RAM_D00F_, adjust _RAM_D012_ toward it, and call _LABEL_EF3_ for each column update.'],
  }),
  routine(0x00FA1, '_LABEL_FA1_', 'camera_scroll_anchor_clamp', '_LABEL_FA1_ camera scroll anchor clamp', 'Derives the horizontal camera anchor from player X, clamps it to the room scroll span, and mirrors the low byte into the VDP scroll shadow.', {
    ramRefs: ['_RAM_C243_', '_RAM_D019_', '_RAM_D00F_', '_RAM_D007_', '_RAM_CF8C_'],
    evidence: ['ASM lines 3162-3184 subtract 0x80 from player X, clamp to 0 or _RAM_D019_, then store _RAM_D00F_, _RAM_D007_, and _RAM_CF8C_.'],
  }),
  routine(0x0118D, '_LABEL_118D_', 'player_tile_interaction_probe', '_LABEL_118D_ player tile interaction probe', 'Checks a player-probed world tile coordinate, applies equipment/form gates, and either exits or falls through to the tile replacement/update continuation.', {
    calls: ['_LABEL_1144_', '_LABEL_104B_'],
    ramRefs: ['_RAM_D21E_', '_RAM_D220_', '_RAM_CF66_', '_RAM_CF25_', '_RAM_CF67_', '_RAM_CF68_', '_RAM_CF69_', '_RAM_CF48_'],
    evidence: ['ASM lines 3473-3532 bounds-check E, snap coordinates to 16-pixel cells, save the probed position, inspect the tile via _LABEL_1144_, and optionally play effect 0x35 before tile replacement.'],
  }),
  routine(0x011F4, '_LABEL_11F4_', 'player_tile_interaction_update_or_return', '_LABEL_11F4_ tile interaction update/return', 'Shared return/update continuation for _LABEL_118D_; when a tile changes, it updates the room tilemap, resolves replacement graphics, and writes the affected 2x2 tile block to VDP.', {
    calls: ['_LABEL_115D_'],
    ramRefs: ['_RAM_D21D_', '_RAM_CF64_', '_RAM_D0DE_', '_RAM_D00F_', '_RAM_FFFF_', '_RAM_CF82_'],
    evidence: ['ASM lines 3534-3609 either returns after restoring DE/HL or writes the changed tile, selects replacement data from _DATA_10000_, switches bank 6, and streams two VDP rows of four bytes.'],
  }),
  routine(0x0126C, '_LABEL_126C_', 'tile_block_effect_writer', '_LABEL_126C_ tile block effect writer', 'Writes a fixed 4x4 visual tile block at the current _RAM_D001_/_RAM_D003_ position and queues the associated sound/effect.', {
    calls: ['_LABEL_1144_', '_LABEL_115D_', '_LABEL_104B_'],
    ramRefs: ['_RAM_D001_', '_RAM_D003_', '_RAM_CF82_'],
    evidence: ['ASM lines 3611-3659 write tile ids 0x16-0x19 into the room buffer, stream a 4x4 block to VDP, clear _RAM_CF82_, and queue effect 0x2B.'],
  }),
  routine(0x012D8, '_LABEL_12D8_', 'entity_x_position_integrator', '_LABEL_12D8_ entity X position integrator', 'Adds the signed IX+8/IX+9 velocity word into the entity X subpixel/position fields IX+2..IX+4.', {
    ramRefs: ['IX+2', 'IX+3', 'IX+4', 'IX+8', 'IX+9'],
    evidence: ['ASM lines 3674-3689 sign-extend IX+9, add IX+8/9 to IX+2/3, and propagate carry into IX+4.'],
  }),
  routine(0x012F8, '_LABEL_12F8_', 'entity_y_position_integrator', '_LABEL_12F8_ entity Y position integrator', 'Adds the signed IX+10/IX+11 velocity word into the entity Y subpixel/position fields IX+5..IX+7.', {
    ramRefs: ['IX+5', 'IX+6', 'IX+7', 'IX+10', 'IX+11'],
    evidence: ['ASM lines 3691-3706 sign-extend IX+11, add IX+10/11 to IX+5/6, and propagate carry into IX+7.'],
  }),
  routine(0x01347, '_LABEL_1347_', 'entity_animation_script_decoder', '_LABEL_1347_ entity animation script decoder', 'Decodes the current entity animation command stream into IX record fields, supporting 0xFF jumps and duration/frame payloads.', {
    calls: ['_LABEL_1036_'],
    ramRefs: ['IX+12', 'IX+13', 'IX+16', 'IX+18', 'IX+19', 'IX+20', 'IX+21', 'IX+22', 'IX+23'],
    evidence: ['ASM lines 3735-3765 loop on 0xFF redirects, store frame duration in IX+16, optional bounding/offset words in IX+20..23, sprite pointer in IX+12/13, and next script pointer in IX+18/19.'],
  }),
  routine(0x013A6, '_LABEL_13A6_', 'player_animation_script_decoder', '_LABEL_13A6_ player animation script decoder', 'Decodes the active player animation stream into C24x/C25x state fields, including optional collision/velocity payloads and sprite pointer updates.', {
    calls: ['_LABEL_A48_', '_LABEL_1036_'],
    ramRefs: ['_RAM_C250_', '_RAM_C252_', '_RAM_C254_', '_RAM_C264_', '_RAM_C24C_', '_RAM_CFE3_', '_RAM_C27F_'],
    evidence: ['ASM lines 3794-3840 mirror the entity decoder for player state, handling 0xFF redirects, optional 8-byte payload copies, sprite pointer writes, and a dynamic tile upload through _LABEL_A48_.'],
  }),
  routine(0x013F6, '_LABEL_13F6_', 'entity_blink_timer_update', '_LABEL_13F6_ entity blink/timer update', 'Updates an entity countdown in IX+42/43 and toggles IX+0 bit 6 on alternating frames while the timer is active.', {
    ramRefs: ['IX+0', 'IX+42', 'IX+43'],
    evidence: ['ASM lines 3842-3866 return when the timer is zero, set bit 6 permanently when the word is 0xFFFF, otherwise decrement and set/reset bit 6 from bit 0 of the low byte.'],
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
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank0CoreRuntimeAudit');
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
      routineCount: ENTRIES.length,
      assetPolicy: 'Metadata only: ASM labels, offsets, routine roles, calls, RAM references, and evidence. No ROM bytes or decoded assets are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    evidence: [
      'ASM lines 928-1226 cover VBlank interrupt service, scroll, dynamic tiles, OAM upload, and palette-buffer upload.',
      'ASM lines 1529-2149 cover startup state reset, gameplay loop entry, screen bytecode side effects, metasprite decode, palette fades, and input routing.',
      'ASM lines 2685-3184 cover demo/live input, display shutdown, tilemap decoding, scroll column redraw, and camera scroll anchoring.',
      'ASM lines 3473-3866 cover tile interaction, entity/player coordinate integration, animation script decoding, and entity blink timers.',
    ],
  };
}

function annotateRegion(region, item) {
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  if (item.name && !region.name) region.name = item.name;
  if (item.summary && !region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank0CoreRuntimeAudit = {
    catalogId,
    kind: item.role,
    family: item.family,
    label: item.label,
    confidence: item.confidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    calls: item.calls,
    ramRefs: item.ramRefs,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    label: item.label,
    role: item.role,
    confidence: item.confidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
  };
}

function applyAnnotations(mapData) {
  const annotated = [];
  const missing = [];
  for (const item of ENTRIES) {
    const region = findExactRegion(mapData, item.offset);
    if (!region) {
      missing.push({ offset: hex(item.offset), label: item.label, role: item.role });
      continue;
    }
    annotated.push(annotateRegion(region, item));
  }
  return { annotated, missing };
}

function main() {
  const mapData = readJson(mapPath);
  let changes = { annotated: [], missing: [] };

  if (apply) {
    changes = applyAnnotations(mapData);
    const finalCatalog = buildCatalog(mapData);
    mapData.bank0CoreRuntimeCatalogs = (mapData.bank0CoreRuntimeCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.bank0CoreRuntimeCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank0_core_runtime_audit',
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
        'Turn _LABEL_604_ command handlers into a structured screen_prog interpreter spec shared by analyzer previews and runtime rendering.',
        'Model _LABEL_792_ metasprite frame opcodes so sprite preview can show per-entry clipping and OAM record provenance.',
        'Trace _LABEL_E34_/_LABEL_EB3_ tilemap buffer flow into room-load metadata and camera column redraw diagnostics.',
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
