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
const catalogId = 'world-bank0-status-inventory-catalog-2026-06-25';
const reportId = 'bank0-status-inventory-audit-2026-06-25';
const toolName = 'tools/world-bank0-status-inventory-audit.mjs';

function routine(offset, label, role, name, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name,
    type: 'code',
    family: options.family || 'bank0_status_inventory',
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
  routine(0x0241B, '_LABEL_241B_', 'gold_digit_writer', '_LABEL_241B_ gold digit writer', 'Writes the six BCD-like gold/currency digits from _RAM_CF5A_ to the status bar.', {
    calls: ['_LABEL_5C3_'],
    ramRefs: ['_RAM_CF5A_'],
    evidence: ['ASM lines 6092-6099 call _LABEL_5C3_ with HL=_RAM_CF5A_, DE=0x3872, B=6, C=0x20, and attribute 0x19.'],
  }),
  routine(0x0242B, '_LABEL_242B_', 'life_count_digit_writer', '_LABEL_242B_ life count digit writer', 'Converts _RAM_CF4A_ to decimal digits and writes the two-digit life/count field to the status bar.', {
    calls: ['_LABEL_B97_', '_LABEL_5C3_'],
    ramRefs: ['_RAM_CF4A_', '_RAM_D11F_'],
    evidence: ['ASM lines 6101-6110 convert _RAM_CF4A_ through _LABEL_B97_ and render two digits from _RAM_D11F_ at VDP destination 0x3868.'],
  }),
  routine(0x02441, '_LABEL_2441_', 'gold_reward_add_and_popup', '_LABEL_2441_ gold reward add/popup', 'Converts a DE reward value into six nibbles, adds it into the gold digit buffer, starts a timed status popup, and renders the gained gold amount.', {
    calls: ['_LABEL_BCD_', '_LABEL_604_', '_LABEL_5C3_'],
    ramRefs: ['_RAM_CFEA_', '_RAM_CFEC_', '_RAM_CF55_', '_RAM_D02C_'],
    evidence: ['ASM lines 6112-6160 split DE into digit nibbles at _RAM_CFEA_.._RAM_CFEC_, add them into _RAM_CF55_ through _LABEL_BCD_, set _RAM_D02C_=0x16, run _DATA_248D_ through _LABEL_604_, and write four digits at 0x386E.'],
  }),
  routine(0x024DE, '_LABEL_24DE_', 'status_scroll_forward_clamp', '_LABEL_24DE_ status/selection scroll forward clamp', 'Adds DE to _RAM_CF52_, clamps against the _RAM_CF54_-derived span, and refreshes the status name-table tiles.', {
    calls: ['_LABEL_2518_'],
    ramRefs: ['_RAM_CF52_', '_RAM_CF54_'],
    evidence: ['ASM lines 6171-6195 add DE into _RAM_CF52_, derive the maximum from _RAM_CF54_ shifted left four times, clamp when exceeded, and call _LABEL_2518_.'],
  }),
  routine(0x02506, '_LABEL_2506_', 'status_scroll_backward_clamp', '_LABEL_2506_ status/selection scroll backward clamp', 'Subtracts DE from _RAM_CF52_, clamps at zero, and refreshes the status name-table tiles.', {
    calls: ['_LABEL_2518_'],
    ramRefs: ['_RAM_CF52_'],
    evidence: ['ASM lines 6197-6206 subtract DE from _RAM_CF52_, clamp negative results to zero, store back, and call _LABEL_2518_.'],
  }),
  routine(0x02563, '_LABEL_2563_', 'status_name_table_tile_blank_or_base_writer', '_LABEL_2563_ status name-table tile writer continuation', 'Continuation inside _LABEL_2518_ that writes base/blank status tile pairs and repeats the blank fill for the remaining status bar space.', {
    calls: ['_LABEL_98F_'],
    ramRefs: ['_RAM_D0DE_', '_RAM_CF82_'],
    evidence: ['ASM lines 6257-6274 select _DATA_25E4_ for the base tile pair, repeat through the local VDP writer, then use _RAM_D0DE_ to fill remaining cells with _DATA_261C_ before clearing _RAM_CF82_.'],
  }),
  routine(0x02767, '_LABEL_2767_', 'equipment_stats_recompute_triplet', '_LABEL_2767_ equipment stats recompute triplet', 'Switches to bank 7 and recomputes attack, defense, and charm/current stat values from equipped inventory.', {
    calls: ['_LABEL_1023_', '_LABEL_2779_', '_LABEL_279E_', '_LABEL_27D6_', '_LABEL_1036_'],
    ramRefs: ['_RAM_FFFF_'],
    evidence: ['ASM lines 6532-6539 switch to bank 7, call the three stat recompute helpers, then restore the previous bank.'],
  }),
  routine(0x02779, '_LABEL_2779_', 'attack_stat_from_equipped_weapon', '_LABEL_2779_ attack stat from equipped weapon', 'Finds the active weapon entry in _RAM_CF20_, resolves its bank-7 item table, and writes the form-specific attack value to _RAM_C258_.', {
    calls: ['_LABEL_2839_', '_LABEL_2819_'],
    ramRefs: ['_RAM_CF20_', '_RAM_C24F_', '_RAM_C258_'],
    evidence: ['ASM lines 6541-6563 scan 10 entries for bit 7, derive the item id with _LABEL_2839_, resolve item data with _LABEL_2819_, index by _RAM_C24F_, and store _RAM_C258_.'],
  }),
  routine(0x0279E, '_LABEL_279E_', 'defense_stat_from_equipment', '_LABEL_279E_ defense stat from equipment', 'Accumulates form-specific defense values from the active armor/shield equipment categories into _RAM_C259_, saturating at 0xFF.', {
    calls: ['_LABEL_2839_', '_LABEL_2819_'],
    ramRefs: ['_RAM_CF2A_', '_RAM_CF34_', '_RAM_C24F_', '_RAM_C259_'],
    evidence: ['ASM lines 6565-6598 scan _RAM_CF2A_ and _RAM_CF34_, resolve each active item table, read the value at table+5+form, add into _RAM_C259_, and saturate on carry.'],
  }),
  routine(0x027D6, '_LABEL_27D6_', 'charm_or_special_stat_from_equipment', '_LABEL_27D6_ charm/special stat from equipment', 'Computes the third displayed stat from the active _RAM_CF34_ equipment plus base _RAM_CF48_, saturating at 0xFF into _RAM_C25A_.', {
    calls: ['_LABEL_2839_', '_LABEL_2819_'],
    ramRefs: ['_RAM_CF34_', '_RAM_CF48_', '_RAM_C24F_', '_RAM_C25A_'],
    evidence: ['ASM lines 6600-6628 scan _RAM_CF34_, resolve item table data, add the form-specific table+0x0B value to _RAM_CF48_, and store _RAM_C25A_ with saturation.'],
  }),
  routine(0x02804, '_LABEL_2804_', 'inventory_category_slot_pointer', '_LABEL_2804_ inventory category/slot pointer', 'Converts a packed category/slot item id into a pointer inside the _RAM_CF20_ inventory state table.', {
    ramRefs: ['_RAM_CF20_'],
    evidence: ['ASM lines 6630-6646 split high and low nibbles, compute category*10+slot, add it to _RAM_CF20_, and return HL.'],
  }),
  routine(0x02819, '_LABEL_2819_', 'bank7_item_table_pointer_resolver', '_LABEL_2819_ bank-7 item table pointer resolver', 'Resolves a packed item/category id through the bank-7 pointer table at _DATA_1C000_ to a concrete item stat/display record pointer.', {
    ramRefs: [],
    evidence: ['ASM lines 6648-6674 use the high nibble to select a pointer from _DATA_1C000_, then use the low nibble to select a second-level pointer and return HL.'],
  }),
  routine(0x02839, '_LABEL_2839_', 'inventory_pointer_to_packed_item_id', '_LABEL_2839_ inventory pointer to packed item id', 'Converts an inventory byte pointer back into a packed category/slot item id.', {
    ramRefs: ['_RAM_CF20_'],
    evidence: ['ASM lines 6676-6695 subtract _RAM_CF20_ from HL, divide the index by 10 into a category counter, shift the category into the high nibble, and OR the slot into the low nibble.'],
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
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank0StatusInventoryAudit');
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
      assetPolicy: 'Metadata only: ASM labels, offsets, routine roles, calls, RAM references, and evidence. No ROM bytes or decoded UI graphics are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    evidence: [
      'ASM lines 6092-6160 show status/gold digit writers and the gained-gold popup path.',
      'ASM lines 6171-6306 show status scroll clamping and VDP tile-pair writes for the status bar.',
      'ASM lines 6532-6695 show bank-7 equipment stat recomputation and packed inventory/item pointer helpers.',
    ],
  };
}

function annotateRegion(region, item) {
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  if (item.name && !region.name) region.name = item.name;
  if (item.summary && !region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank0StatusInventoryAudit = {
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
    mapData.bank0StatusInventoryCatalogs = (mapData.bank0StatusInventoryCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.bank0StatusInventoryCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank0_status_inventory_audit',
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
        'Name the exact user-facing meanings of _RAM_C258_, _RAM_C259_, and _RAM_C25A_ by tracing menu labels and stat display callers.',
        'Turn _LABEL_2518_ plus _LABEL_2563_ into a status-bar renderer diagnostic that reports VDP cells and unresolved tile ids.',
        'Resolve item record schemas returned by _LABEL_2819_ from _DATA_1C000_ without embedding item text or graphics.',
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
