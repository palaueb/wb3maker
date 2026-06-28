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
const catalogId = 'world-final-inferred-cleanup-catalog-2026-06-25';
const reportId = 'final-inferred-cleanup-audit-2026-06-25';
const toolName = 'tools/world-final-inferred-cleanup-audit.mjs';

function code(offset, label, role, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name: options.name || `${label} ${role.split('_').join(' ')}`,
    type: 'code',
    family: options.family || 'world_final_code_cleanup',
    confidence: options.confidence || 'high',
    calls: options.calls || [],
    ramRefs: options.ramRefs || [],
    table: options.table || null,
    ioPorts: options.ioPorts || [],
    summary,
    evidence: [
      `${label} is an ASM code label at ROM offset ${hex(offset)}.`,
      ...(options.evidence || []),
    ],
  };
}

function header(offset, label, role, summary, evidence) {
  return {
    offset,
    label,
    role,
    name: label,
    type: 'data_table',
    family: 'sms_rom_header',
    confidence: 'high',
    calls: [],
    ramRefs: [],
    table: null,
    ioPorts: [],
    summary,
    evidence: [
      `Existing WORLD map annotation names ${label} at ROM offset ${hex(offset)} as an SMS ROM header field.`,
      'ASM line 16340 marks the encompassing 0x7F07-0x7FFF range as data, not executable code.',
      evidence,
    ],
  };
}

const ENTRIES = [
  code(0x0154D, '_LABEL_154D_', 'horizontal_collision_resolution_tail', 'Collision-resolution tail reached when horizontal tile checks fail; calls _LABEL_166C_ to resolve X collision and returns.', {
    calls: ['_LABEL_166C_'],
    ramRefs: ['IX+1', 'IX+2', 'IX+8', 'IX+9', 'IX+27', '_RAM_C243_', '_RAM_C248_', '_RAM_D0F2_'],
    evidence: ['ASM lines 4001-4055 branch to _LABEL_154D_ from horizontal collision checks; _LABEL_154D_ calls _LABEL_166C_ and returns.'],
  }),
  code(0x01BE0, '_LABEL_1BE0_', 'item_vram_record_loader_by_id', 'Selects a small VRAM loader record from fixed inline tables or bank-4 pointer tables based on item id A, then jumps into the _LABEL_998_ loader body.', {
    calls: ['_LABEL_8_', '_LABEL_18_', '_LABEL_99B_'],
    ramRefs: ['_RAM_FFFF_', '_RAM_D02A_'],
    table: '_DATA_13C00_/_DATA_13C0A_',
    evidence: ['ASM lines 4965-5002 bound A below 0x48, switch to bank 4, select inline or pointer-table records, load DE from _RAM_D02A_, and jump to _LABEL_99B_.'],
  }),
  code(0x01C31, '_LABEL_1C31_', 'form_vram_patch_loader', 'Selects one of four form/scene VRAM patch records from _DATA_1C48_, clears two entity slots, and calls _LABEL_998_.', {
    calls: ['_LABEL_998_'],
    ramRefs: ['_RAM_C2C0_', '_RAM_C300_'],
    table: '_DATA_1C48_',
    evidence: ['ASM lines 5005-5018 mask A to four entries, scale by five bytes into _DATA_1C48_, clear _RAM_C2C0_/_RAM_C300_, and jump to _LABEL_998_.'],
  }),
  code(0x01C5C, '_LABEL_1C5C_', 'player_form_change_animation_loop', 'Runs the form-change animation loop: waits frames, optionally plays sound 0x29, selects animation 0x0E/0x0F, ticks player animation until _RAM_C250_ reaches zero, and updates sprites.', {
    calls: ['_LABEL_FF9_', '_LABEL_104B_', '_LABEL_137C_', '_LABEL_1392_', '_LABEL_10BC_', '_LABEL_6E7_'],
    ramRefs: ['_RAM_CF5B_', '_RAM_C26E_', '_RAM_C250_', 'IX+0'],
    evidence: ['ASM lines 5025-5054 show the wait/sound/animation-select loop and repeated _LABEL_1392_/_LABEL_10BC_/_LABEL_6E7_ calls until _RAM_C250_ is zero.'],
  }),
  code(0x01F28, '_LABEL_1F28_', 'conditional_form_vram_patch', 'Loads _DATA_1F35_ through _LABEL_998_ only when current form _RAM_C24F_ equals 1.', {
    calls: ['_LABEL_998_'],
    ramRefs: ['_RAM_C24F_'],
    table: '_DATA_1F35_',
    evidence: ['ASM lines 5403-5411 compare _RAM_C24F_ with 1 and call _LABEL_998_ with _DATA_1F35_ only on match.'],
  }),
  code(0x01F3E, '_LABEL_1F3E_', 'projectile_spawn_anchor_resolver', 'Resolves projectile/spell spawn anchor state from A and current equipment/form flags, writing IX+50 and coordinate outputs relative to player position.', {
    ramRefs: ['_RAM_C25B_', '_RAM_C243_', '_RAM_C246_', '_RAM_C257_', 'IX+20', 'IX+21', 'IX+23', 'IX+50'],
    evidence: ['ASM lines 5415-5465 branch on A bits and _RAM_C25B_, set IX+50, and derive HL/DE positions from _RAM_C243_/_RAM_C246_ and IX sprite bounds.'],
  }),
  code(0x023F1, '_LABEL_23F1_', 'status_hud_redraw_wrapper', 'Redraws the status HUD frame/text stream and refreshes life, gold, and status panel counters.', {
    calls: ['_LABEL_604_', '_LABEL_242B_', '_LABEL_241B_', '_LABEL_2518_'],
    table: '_DATA_2401_',
    evidence: ['ASM lines 6079-6085 load _DATA_2401_ into the VDP stream decoder, then call life/gold/status refresh helpers.'],
  }),
  code(0x02A49, '_LABEL_2A49_', 'bank4_inventory_data_refresh_wrapper', 'Switches to bank 4, calls _LABEL_26F4_, restores the previous bank, and returns.', {
    calls: ['_LABEL_1023_', '_LABEL_26F4_', '_LABEL_1036_'],
    ramRefs: ['_RAM_FFFF_'],
    evidence: ['ASM lines 6939-6944 select bank 4 through _LABEL_1023_, call _LABEL_26F4_, restore with _LABEL_1036_, and return.'],
  }),
  code(0x02BD4, '_LABEL_2BD4_', 'status_menu_wait_for_direction_input', 'Status/menu loop that waits one secondary frame, updates input through _LABEL_BFD_, redraws menu cursor state, and loops until directional input bits appear.', {
    calls: ['_LABEL_1004_', '_LABEL_BFD_', '_LABEL_2F97_'],
    ramRefs: ['_RAM_CF95_'],
    evidence: ['ASM lines 7076-7082 show _LABEL_2BD4_ waiting with _LABEL_1004_, polling _LABEL_BFD_, calling _LABEL_2F97_, and looping until _RAM_CF95_ & 0x30 is nonzero.'],
  }),
  code(0x02BE4, '_LABEL_2BE4_', 'status_menu_state_dispatch_loop', 'Status/menu dispatch loop that polls input, waits one frame, indexes _DATA_2BF0_ by _RAM_D11B_, and dispatches via RST 20.', {
    calls: ['_LABEL_BFD_', '_LABEL_1004_', '_LABEL_20_'],
    ramRefs: ['_RAM_D11B_'],
    table: '_DATA_2BF0_',
    evidence: ['ASM lines 7083-7090 poll input/wait, mask _RAM_D11B_ to four states, and dispatch through the _DATA_2BF0_ jump table.'],
  }),
  code(0x03019, '_LABEL_3019_', 'status_menu_cursor_move_redraw_tail', 'Shared status/menu cursor movement tail that plays sound 0x1E and redraws the selection area through _LABEL_3025_.', {
    calls: ['_LABEL_104B_', '_LABEL_3025_'],
    table: '_DATA_2F7F_',
    evidence: ['ASM lines 7579-7630 show multiple cursor movement branches jumping to _LABEL_3019_, which plays sound 0x1E and jumps to _LABEL_3025_ with _DATA_2F7F_.'],
  }),
  code(0x03115, '_LABEL_3115_', 'status_item_select_wait_loop', 'Status item-selection wait loop that waits one secondary frame, polls input, and jumps into _LABEL_316A_ for status item action handling.', {
    calls: ['_LABEL_1004_', '_LABEL_BFD_', '_LABEL_316A_'],
    ramRefs: ['_RAM_CF95_', '_RAM_D11C_', '_RAM_D133_'],
    evidence: ['ASM lines 7786-7818 show _LABEL_3115_ waiting, polling input, and entering the status item-selection handler _LABEL_316A_.'],
  }),
  code(0x03485, '_LABEL_3485_', 'inventory_slot_validation_loop_tail', 'Tail of the four-slot inventory validation loop; advances to the next _RAM_D133_ slot and loops through _LABEL_3433_.', {
    calls: ['_LABEL_3433_'],
    ramRefs: ['_RAM_D133_', '_RAM_C25A_'],
    evidence: ['ASM lines 8172-8231 show inventory slot checks falling through to _LABEL_3485_, which increments DE and loops with DJNZ _LABEL_3433_.'],
  }),
  code(0x03698, '_LABEL_3698_', 'four_byte_vdp_data_writer', 'Writes four bytes from HL to the current VDP destination DE through RST 28/RST 30 with interrupts disabled.', {
    calls: ['_LABEL_28_', '_LABEL_30_'],
    ioPorts: ['Port_VDPAddress', 'Port_VDPData'],
    evidence: ['ASM lines 8547-8561 define _LABEL_3698_ setting the VDP address from DE, writing four bytes from HL through RST 30, and returning.'],
  }),
  code(0x03852, '_LABEL_3852_', 'shop_loop_wait_poll_dispatch', 'Shop/menu loop tail that waits one secondary frame, polls input through _LABEL_BFD_, and jumps back into _LABEL_396B_.', {
    calls: ['_LABEL_1004_', '_LABEL_BFD_', '_LABEL_396B_'],
    ramRefs: ['_RAM_CF95_', '_RAM_D11C_', '_RAM_D133_'],
    evidence: ['ASM lines 8825-8837 show _LABEL_3852_ waiting with _LABEL_1004_, polling _LABEL_BFD_, and dispatching to _LABEL_396B_.'],
  }),
  code(0x03FB1, '_LABEL_3FB1_', 'password_cursor_digit_writer', 'Writes three password/status cursor tiles from _DATA_3FFE_ at VRAM 0x7930 using attribute C.', {
    calls: ['_LABEL_28_', '_LABEL_30_'],
    ioPorts: ['Port_VDPAddress', 'Port_VDPData'],
    table: '_DATA_3FFE_',
    evidence: ['ASM lines 9890-9907 set VDP address 0x7930, write three tile/attribute pairs from _DATA_3FFE_, and return.'],
  }),
  code(0x07DA2, '_LABEL_7DA2_', 'bank1_entity_state_ret_tail', 'One-byte return tail for the first _DATA_7D49_ bank-1 entity-state entry after movement/collision/update checks.', {
    family: 'bank1_entity_state_runtime',
    ramRefs: ['IX+0', 'IX+27', 'IX+30', 'IX+31', 'IX+49', 'IX+55'],
    evidence: ['ASM lines 16130-16165 show _LABEL_7DA2_ as the RET target reached by _LABEL_7D51_ after entity movement/collision checks.'],
  }),
  header(0x07FF0, 'TMR SEGA', 'sms_header_signature', 'SMS ROM header signature field at 0x7FF0. This is metadata, not executable code.', 'Existing map name identifies the eight-byte TMR SEGA signature field; no ROM bytes are copied into this audit.'),
  header(0x07FF8, 'Reserved space', 'sms_header_reserved', 'SMS ROM header reserved two-byte field at 0x7FF8. This is metadata, not executable code.', 'Existing map notes describe the two reserved header bytes.'),
  header(0x07FFA, 'Checksum', 'sms_header_checksum', 'SMS ROM header little-endian checksum word at 0x7FFA. This is metadata, not executable code.', 'Existing map notes identify the export SMS checksum field.'),
  header(0x07FFC, 'Product code + Version', 'sms_header_product_code_version', 'SMS ROM header product-code/version field at 0x7FFC. This is metadata, not executable code.', 'Existing map notes identify the packed product-code/version field.'),
  header(0x07FFF, 'Region code + ROM size', 'sms_header_region_size', 'SMS ROM header region and ROM-size byte at 0x7FFF. This is metadata, not executable code.', 'Existing map notes identify this field as SMS Export and 256KB ROM-size metadata.'),
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
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'finalInferredCleanupAudit');
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
      codeEntryCount: ENTRIES.filter(item => item.type === 'code').length,
      smsHeaderFieldCount: ENTRIES.filter(item => item.family === 'sms_rom_header').length,
      assetPolicy: 'Metadata only: ASM labels, offsets, helper/header roles, RAM/IX/port references, calls, tables, and evidence. No ROM bytes, decoded graphics, music, or text payloads are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    evidence: [
      'ASM lines 4001-4055, 4965-5054, 5403-5465, 6079-6085, 6939-7090, 7579-7630, 7786-7818, 8172-8561, 8825-8837, and 9890-9907 define the final bank-0 helper fragments.',
      'ASM lines 16130-16165 define _LABEL_7DA2_ as a bank-1 entity-state return tail.',
      'ASM line 16340 marks 0x7F07-0x7FFF as data; existing WORLD map notes subdivide the SMS header fields at 0x7FF0-0x7FFF.',
    ],
  };
}

function annotateRegion(region, item) {
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  const previousType = region.type || 'unknown';
  if (item.type !== 'code') region.type = item.type;
  if (!region.name) region.name = item.name;
  if (!region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.finalInferredCleanupAudit = {
    catalogId,
    kind: item.role,
    family: item.family,
    label: item.label,
    confidence: item.confidence,
    previousType,
    correctedType: region.type,
    calls: item.calls,
    ramRefs: item.ramRefs,
    ioPorts: item.ioPorts,
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
    previousType,
    correctedType: region.type,
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
    mapData.finalInferredCleanupCatalogs = (mapData.finalInferredCleanupCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.finalInferredCleanupCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'final_inferred_cleanup_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: changes.annotated.length,
        missingRegions: changes.missing.length,
        inferredOnlyRegionsCovered: changes.annotated.filter(change => change.wasInferredOnlyBeforeAudit).length,
        retypedNonCodeRegions: changes.annotated.filter(change => change.previousType !== change.correctedType && change.correctedType !== 'code').length,
      },
      annotatedRegions: changes.annotated,
      missingRegions: changes.missing,
      nextLeads: [
        'Run a structural query for any remaining code regions whose only analysis key is inferred; expected result after this audit is zero.',
        'Split SMS header metadata into a dedicated map/header object in a future schema instead of keeping it as normal regions.',
        'Move from residual region classification to deeper table decoding: _DATA_18718_ animation roots, _DATA_92C8_ transition callers, and bank-3 sound stream commands.',
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
      retypedNonCodeRegions: changes.annotated.filter(change => change.previousType !== change.correctedType && change.correctedType !== 'code').length,
    },
    missingRegions: changes.missing,
  }, null, 2));
}

main();
