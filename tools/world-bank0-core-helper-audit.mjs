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
const catalogId = 'world-bank0-core-helper-catalog-2026-06-25';
const reportId = 'bank0-core-helper-audit-2026-06-25';
const toolName = 'tools/world-bank0-core-helper-audit.mjs';

function entry(offset, label, role, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name: options.name || `${label} ${role.split('_').join(' ')}`,
    type: 'code',
    family: options.family || 'bank0_core_helper',
    confidence: options.confidence || 'high',
    calls: options.calls || [],
    ramRefs: options.ramRefs || [],
    table: options.table || null,
    summary,
    evidence: [
      `${label} is an ASM code label at ROM offset ${hex(offset)}.`,
      ...(options.evidence || []),
    ],
  };
}

const ENTRIES = [
  entry(0x00B97, '_LABEL_B97_', 'binary_to_three_decimal_digits', 'Converts A into hundreds/tens/ones decimal digits stored backward at _RAM_D120_, _RAM_D11F_, and _RAM_D11E_.', {
    ramRefs: ['_RAM_D120_', '_RAM_D11F_', '_RAM_D11E_'],
    evidence: ['ASM lines 2586-2616 repeatedly subtract 0x64 and 0x0A from A, storing the three decimal digits around _RAM_D120_.'],
  }),
  entry(0x00BBB, '_LABEL_BBB_', 'packed_decimal_digit_compare', 'Compares C decimal digit bytes between HL and DE from the end of the fields and returns on the first mismatch.', {
    evidence: ['ASM lines 2618-2635 offset HL/DE by C-1, compare digit bytes backward, and return with flags from the first mismatch.'],
  }),
  entry(0x00BCD, '_LABEL_BCD_', 'packed_decimal_digit_add', 'Adds C decimal digits from HL into DE with decimal carry and saturates the destination to 9s if carry remains.', {
    evidence: ['ASM lines 2637-2660 add decimal digit bytes with carry, subtract 0x0A on overflow, and fill the destination with 9s if final carry remains.'],
  }),
  entry(0x00BE7, '_LABEL_BE7_', 'packed_decimal_digit_subtract', 'Subtracts C decimal digits at HL from DE with decimal borrow and clears the destination to zeroes if final borrow remains.', {
    evidence: ['ASM lines 2662-2682 subtract digit bytes with borrow, add 0x0A on underflow, and zero the destination if final borrow remains.'],
  }),
  entry(0x00CE3, '_LABEL_CE3_', 'rng_seed_table_reset', 'Resets the pseudo-random sequence state by copying _DATA_CFF_ into _RAM_D0A5_ and seeding _RAM_D0DC_/_RAM_D0DD_.', {
    name: 'Pseudo-random table reset',
    ramRefs: ['_RAM_D0A5_', '_RAM_D0DC_', '_RAM_D0DD_'],
    table: '_DATA_CFF_',
    evidence: ['ASM lines 2777-2792 seed _RAM_D0DC_ and _RAM_D0DD_, copy 0x37 bytes from _DATA_CFF_ to _RAM_D0A5_, and preserve HL/BC/DE.'],
  }),
  entry(0x00D85, '_LABEL_D85_', 'display_enable_vdp_register_1', 'Sets bit 6 in the cached VDP register-1 byte _RAM_CF6E_ and writes it to the VDP control port through RST 28.', {
    name: 'VDP display enable',
    calls: ['_LABEL_28_'],
    ramRefs: ['_RAM_CF6E_'],
    evidence: ['ASM lines 2843-2852 OR _RAM_CF6E_ with 0x40, write register 1 through RST 28, and return with interrupts restored.'],
  }),
  entry(0x00DB5, '_LABEL_DB5_', 'scroll_register_update_request_reset', 'Clears scroll shadow bytes _RAM_CF8D_/_RAM_CF8C_ and requests a VDP scroll register update through _RAM_CFE1_.', {
    ramRefs: ['_RAM_CF8D_', '_RAM_CF8C_', '_RAM_CFE1_'],
    evidence: ['ASM lines 2874-2880 clear _RAM_CF8D_/_RAM_CF8C_, set _RAM_CFE1_=1, and return.'],
  }),
  entry(0x00FD2, '_LABEL_FD2_', 'timed_wait_with_start_button_escape', 'Wait helper that delays B groups of 0x3C frames through _LABEL_FEE_ unless Start/1/2 input bits in _RAM_CF90_ are pressed.', {
    calls: ['_LABEL_FEE_'],
    ramRefs: ['_RAM_CF90_'],
    evidence: ['ASM lines 3192-3214 loop over B and C=0x3C, test _RAM_CF90_ & 0x30, and return A=1 on input escape or A=0 on timeout.'],
  }),
  entry(0x00FEE, '_LABEL_FEE_', 'wait_for_vblank_flag_and_clear', 'Busy-waits until the VBlank flag _RAM_CF81_ is nonzero, then clears it.', {
    name: 'Wait for VBlank flag',
    ramRefs: ['_RAM_CF81_'],
    evidence: ['ASM lines 3216-3222 wait on _RAM_CF81_, clear it, and return.'],
  }),
  entry(0x00FF9, '_LABEL_FF9_', 'wait_for_next_vblank_flag', 'Clears _RAM_CF81_, then busy-waits for the next VBlank flag without clearing the observed nonzero value.', {
    ramRefs: ['_RAM_CF81_'],
    evidence: ['ASM lines 3224-3231 clear _RAM_CF81_ and wait until the interrupt handler sets it again.'],
  }),
  entry(0x01004, '_LABEL_1004_', 'wait_for_half_frame_flag', 'Clears _RAM_CF84_, then waits until the interrupt handler sets the secondary frame flag.', {
    name: 'Secondary frame wait',
    ramRefs: ['_RAM_CF84_'],
    evidence: ['ASM lines 3233-3240 clear _RAM_CF84_ and wait until it becomes nonzero.'],
  }),
  entry(0x0100F, '_LABEL_100F_', 'scroll_shadow_add_and_request_update', 'Adds DE into scroll shadow bytes _RAM_CF8D_/_RAM_CF8C_ and requests a VDP scroll update by setting _RAM_CFE1_.', {
    ramRefs: ['_RAM_CF8D_', '_RAM_CF8C_', '_RAM_CFE1_'],
    evidence: ['ASM lines 3242-3252 add D/E to _RAM_CF8D_/_RAM_CF8C_ and set _RAM_CFE1_=1.'],
  }),
  entry(0x01044, '_LABEL_1044_', 'bank_stack_reset', 'Resets the software bank stack pointer _RAM_D121_ to the base buffer _RAM_D123_.', {
    ramRefs: ['_RAM_D121_', '_RAM_D123_'],
    evidence: ['ASM lines 3276-3279 load HL with _RAM_D123_ and store it in _RAM_D121_.'],
  }),
  entry(0x0104B, '_LABEL_104B_', 'bank3_sound_command_wrapper', 'Queues or triggers a sound command by switching to bank 3, calling _LABEL_C003_, restoring the previous bank, and clearing _RAM_C23C_.', {
    name: 'Bank 3 sound command wrapper',
    calls: ['_LABEL_1023_', '_LABEL_C003_', '_LABEL_1036_'],
    ramRefs: ['_RAM_C23C_', '_RAM_FFFF_'],
    evidence: ['ASM lines 3281-3289 store A in C, switch to bank 3 via _LABEL_1023_, call _LABEL_C003_, restore bank via _LABEL_1036_, and clear _RAM_C23C_.'],
  }),
  entry(0x0105C, '_LABEL_105C_', 'bank3_audio_init_wrapper', 'Initializes the bank-3 audio runtime by selecting bank 3 and calling _LABEL_C000_.', {
    name: 'Bank 3 audio init wrapper',
    calls: ['_LABEL_C000_'],
    ramRefs: ['_RAM_FFFF_'],
    evidence: ['ASM lines 3291-3295 select bank 3 in _RAM_FFFF_, call _LABEL_C000_, and return.'],
  }),
  entry(0x01065, '_LABEL_1065_', 'bank3_audio_update_wrapper', 'Runs the bank-3 audio update by selecting bank 3 and calling _LABEL_C006_.', {
    name: 'Bank 3 audio update wrapper',
    calls: ['_LABEL_C006_'],
    ramRefs: ['_RAM_FFFF_'],
    evidence: ['ASM lines 3297-3301 select bank 3 in _RAM_FFFF_, call _LABEL_C006_, and return.'],
  }),
  entry(0x010A4, '_LABEL_10A4_', 'clear_non_player_entity_slots', 'Clears the entity/OAM work range from _RAM_C280_ for 0x07C0 bytes and resets camera scroll origins _RAM_D007_/_RAM_D009_.', {
    ramRefs: ['_RAM_C280_', '_RAM_D007_', '_RAM_D009_'],
    evidence: ['ASM lines 3340-3353 zero 0x07C0 bytes starting at _RAM_C280_ and clear _RAM_D007_/_RAM_D009_.'],
  }),
  entry(0x01144, '_LABEL_1144_', 'tile_collision_lookup_or_default', 'Bounds-checks a tile coordinate in E/H and returns either the collision/map byte from _LABEL_141F_ or the default byte at _DATA_115C_.', {
    calls: ['_LABEL_141F_'],
    ramRefs: ['_RAM_D01A_'],
    table: '_DATA_115C_',
    evidence: ['ASM lines 3426-3445 check E against 0x10-0xBF and H against _RAM_D01A_, returning _DATA_115C_ on out-of-bounds or _LABEL_141F_ in-bounds.'],
  }),
  entry(0x0115D, '_LABEL_115D_', 'pixel_coordinate_to_vram_name_address', 'Converts pixel/tile coordinates in HL/DE into a VDP name-table address in DE based at 0x7800.', {
    ramRefs: [],
    evidence: ['ASM lines 3448-3463 mask E and L to 8-pixel boundaries, scale E by 8 rows, fold L into the column, add base 0x7800, exchange result to DE, and return.'],
  }),
  entry(0x012D5, '_LABEL_12D5_', 'entity_integrate_y_then_x_velocity_entry', 'Entry point for entity movement integration that first applies Y velocity via _LABEL_12F8_, then falls into _LABEL_12D8_ to apply X velocity.', {
    calls: ['_LABEL_12F8_'],
    ramRefs: ['IX+2', 'IX+3', 'IX+4', 'IX+5', 'IX+6', 'IX+7', 'IX+8', 'IX+9', 'IX+10', 'IX+11'],
    evidence: ['ASM lines 3672-3695 show _LABEL_12D5_ calling _LABEL_12F8_ and _LABEL_12D8_ applying signed IX+8/9 velocity into IX+2/3/4.'],
  }),
  entry(0x01318, '_LABEL_1318_', 'entity_animation_start_from_bank6_tables', 'Starts an entity animation by switching to bank 6, resolving _DATA_18718_ through IX+14/IX+15 and animation index A, then entering the shared animation frame loader.', {
    calls: ['_LABEL_1023_', '_LABEL_8_', '_LABEL_18_', '_LABEL_10_', '_LABEL_1036_'],
    ramRefs: ['IX+12', 'IX+13', 'IX+14', 'IX+15', 'IX+16', 'IX+18', 'IX+19', 'IX+20', 'IX+21', 'IX+22', 'IX+23'],
    table: '_DATA_18718_',
    evidence: ['ASM lines 3708-3722 switch to bank 6, index _DATA_18718_ by IX+14/IX+15 and A, then fall into the shared frame loader at _LABEL_1347_.'],
  }),
  entry(0x01330, '_LABEL_1330_', 'entity_animation_tick', 'Ticks entity animation delay IX+16; when it expires, switches to bank 6 and loads the next frame record through the shared _LABEL_1347_ decoder.', {
    calls: ['_LABEL_1023_', '_LABEL_10_', '_LABEL_1036_'],
    ramRefs: ['IX+12', 'IX+13', 'IX+16', 'IX+18', 'IX+19', 'IX+20', 'IX+21', 'IX+22', 'IX+23'],
    evidence: ['ASM lines 3724-3765 decrement IX+16, fetch animation script bytes from IX+18/19, follow 0xFF loop pointers, and update frame/metasprite pointers.'],
  }),
  entry(0x0137B, '_LABEL_137B_', 'entity_animation_tick_return_tail', 'Shared return tail for _LABEL_1330_ when no animation update is due.', {
    ramRefs: [],
    evidence: ['ASM line 3765 labels _LABEL_137B_ as the RET tail reached by _LABEL_1330_ when IX+16 is still nonzero.'],
  }),
  entry(0x0137C, '_LABEL_137C_', 'player_form_animation_start_from_bank6_tables', 'Starts the player/form animation by switching to bank 6, resolving _DATA_18718_ for current _RAM_C24F_, and entering the shared player frame loader.', {
    calls: ['_LABEL_1023_', '_LABEL_8_', '_LABEL_18_', '_LABEL_10_', '_LABEL_1036_', '_LABEL_A48_'],
    ramRefs: ['_RAM_C24F_', '_RAM_C24C_', '_RAM_C250_', '_RAM_C252_', '_RAM_C254_', '_RAM_C264_', '_RAM_C27F_', '_RAM_CFE3_'],
    table: '_DATA_18718_',
    evidence: ['ASM lines 3768-3782 resolve the player/form animation table by _RAM_C24F_ and A, then jump into the shared _LABEL_13A6_ player frame loader.'],
  }),
  entry(0x01392, '_LABEL_1392_', 'player_form_animation_tick', 'Ticks the player/form animation delay _RAM_C250_ and, when expired, decodes the next frame record into player sprite/metasprite pointers.', {
    calls: ['_LABEL_1023_', '_LABEL_10_', '_LABEL_A48_', '_LABEL_1036_'],
    ramRefs: ['_RAM_C250_', '_RAM_C252_', '_RAM_C254_', '_RAM_C264_', '_RAM_C24C_', '_RAM_CFE3_', '_RAM_C27F_'],
    evidence: ['ASM lines 3784-3839 decrement _RAM_C250_, fetch frame bytes, follow 0xFF loop pointers, update _RAM_C24C_/_RAM_C252_, and call _LABEL_A48_.'],
  }),
  entry(0x013F5, '_LABEL_13F5_', 'player_form_animation_return_tail', 'Shared return tail for _LABEL_1392_ when no player/form animation update is due.', {
    ramRefs: [],
    evidence: ['ASM line 3839 labels _LABEL_13F5_ as the RET tail reached when _RAM_C250_ is zero or still counting down.'],
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
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank0CoreHelperAudit');
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
      helperFamily: 'bank0_core_helper',
      assetPolicy: 'Metadata only: ASM labels, offsets, helper roles, RAM/IX references, calls, tables, and evidence. No ROM bytes, graphics, music, or text payloads are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    evidence: [
      'ASM lines 2586-2682 define decimal conversion and packed decimal arithmetic helpers.',
      'ASM lines 2777-2880 define RNG reset, VDP display toggle, and scroll-update request helpers.',
      'ASM lines 3192-3301 define frame waits and bank-3 audio wrapper helpers.',
      'ASM lines 3340-3839 define entity/player movement and animation helper entries.',
    ],
  };
}

function annotateRegion(region, item) {
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  if (!region.name) region.name = item.name;
  if (!region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank0CoreHelperAudit = {
    catalogId,
    kind: item.role,
    family: item.family,
    label: item.label,
    confidence: item.confidence,
    calls: item.calls,
    ramRefs: item.ramRefs,
    table: item.table,
    summary: item.summary,
    evidence: item.evidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
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
    mapData.bank0CoreHelperCatalogs = (mapData.bank0CoreHelperCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.bank0CoreHelperCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank0_core_helper_audit',
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
        'Promote _LABEL_12D5_/_LABEL_12F8_ movement integration into a candidate shared/wb3/player-physics.js model only after collision callers are traced.',
        'Decode _DATA_18718_ animation tables and distinguish entity animation scripts from player/form animation scripts by caller.',
        'Map bank-3 audio wrapper targets _LABEL_C000_/_LABEL_C003_/_LABEL_C006_ against the bank-3 sound driver catalog.',
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
