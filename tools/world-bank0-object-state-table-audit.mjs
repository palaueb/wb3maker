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
const catalogId = 'world-bank0-object-state-table-catalog-2026-06-25';
const reportId = 'bank0-object-state-table-audit-2026-06-25';
const toolName = 'tools/world-bank0-object-state-table-audit.mjs';

function table(offset, label, tableName, entries, indexedBy, summary, evidence) {
  return {
    offset,
    label,
    role: tableName,
    name: `${label} ${tableName.split('_').join(' ')}`,
    type: 'pointer_table',
    family: 'bank0_object_state_table',
    confidence: 'high',
    entries,
    indexedBy,
    calls: [],
    ramRefs: indexedBy ? [indexedBy] : [],
    summary,
    evidence: [
      `${label} is an ASM .dw pointer table at ROM offset ${hex(offset)}.`,
      evidence,
    ],
  };
}

function code(offset, label, role, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name: options.name || `${label} ${role.split('_').join(' ')}`,
    type: 'code',
    family: options.family || 'bank0_object_state_dispatch',
    confidence: options.confidence || 'high',
    entries: null,
    indexedBy: options.indexedBy || null,
    calls: options.calls || [],
    ramRefs: options.ramRefs || [],
    summary,
    evidence: [
      `${label} is an ASM code label at ROM offset ${hex(offset)}.`,
      ...(options.evidence || []),
    ],
  };
}

const ENTRIES = [
  code(0x05803, '_LABEL_5803_', 'subweapon_state_dispatcher', 'Dispatches the active subweapon/projectile state by loading IX+15 and jumping through _DATA_5807_.', {
    indexedBy: '_RAM_C2CF_',
    calls: ['_LABEL_20_'],
    ramRefs: ['IX+15', '_RAM_C2CF_'],
    evidence: ['ASM lines 13113-13117 load A from IX+15 and use RST 20 with the _DATA_5807_ jump table.'],
  }),
  table(0x05807, '_DATA_5807_', 'subweapon_state_jump_table', ['_LABEL_583D_', '_LABEL_58BF_', '_LABEL_5946_', '_LABEL_5981_', '_LABEL_5AB6_'], '_RAM_C2CF_', 'Five-entry subweapon/projectile state table dispatched from _LABEL_5803_.', 'ASM lines 13117-13118 mark the jump table from 5807 to 5810 with five .dw entries.'),
  code(0x05AFA, '_LABEL_5AFA_', 'subweapon_slot_clear_tail', 'Clears the subweapon/projectile entity slot by storing zero in IX+0 and returning.', {
    ramRefs: ['IX+0'],
    evidence: ['ASM lines 13457-13459 define _LABEL_5AFA_ as the clear-and-return tail for the fifth _DATA_5807_ state.'],
  }),
  table(0x05CD3, '_DATA_5CD3_', 'item_spawn_kind_jump_table', ['_LABEL_5CEF_', '_LABEL_5CEF_', '_LABEL_5CEF_', '_LABEL_5CF6_', '_LABEL_5D32_', '_LABEL_5D6A_'], '_RAM_C34F_', 'Six-entry item/reward spawn-kind table selected from IX+15 after room item data is latched.', 'ASM lines 13655-13661 dispatch through RST 20 and mark the jump table from 5CD3 to 5CDE with six .dw entries.'),
  table(0x05CE3, '_DATA_5CE3_', 'active_item_state_jump_table', ['_LABEL_5E02_', '_LABEL_5EE6_', '_LABEL_5EF0_', '_LABEL_5F18_', '_LABEL_5F8B_', '_LABEL_5FE8_'], '_RAM_C360_', 'Six-entry active item/reward state table selected from IX+32 by _LABEL_5CDF_.', 'ASM lines 13664-13668 dispatch active item state through RST 20 and mark the jump table from 5CE3 to 5CEE.'),
  code(0x05CEF, '_LABEL_5CEF_', 'item_spawn_default_setup_head', 'Default item spawn setup for _DATA_5CD3 entries 1-3; sets IX+32=0, clears A, then branches into _LABEL_5CFF_ shared setup.', {
    indexedBy: '_RAM_C34F_',
    ramRefs: ['IX+32', 'IX+62'],
    evidence: ['ASM lines 13670-13674 identify _LABEL_5CEF_ as the first _DATA_5CD3 entry and branch to _LABEL_5CFF_ after setting IX+32.'],
  }),
  code(0x05CF6, '_LABEL_5CF6_', 'item_spawn_variant_setup_tail', 'Item spawn setup for _DATA_5CD3 entry 4 and nested _DATA_5D38 aliases; selects IX+62 low bits, starts animation, and seeds motion fields.', {
    indexedBy: '_RAM_C34F_',
    calls: ['_LABEL_1318_'],
    ramRefs: ['IX+8', 'IX+9', 'IX+10', 'IX+11', 'IX+31', 'IX+32', 'IX+62'],
    evidence: ['ASM lines 13676-13700 identify _LABEL_5CF6_ and shared _LABEL_5CFF_ as the setup tail that calls _LABEL_1318_ and seeds IX motion fields.'],
  }),
  code(0x05D32, '_LABEL_5D32_', 'item_spawn_nested_variant_dispatch', 'Nested variant dispatcher for _DATA_5CD3 entry 5; masks IX+62 low bits and dispatches through _DATA_5D38_.', {
    indexedBy: '_RAM_C37E_',
    calls: ['_LABEL_20_'],
    ramRefs: ['IX+62', '_RAM_C37E_'],
    evidence: ['ASM lines 13703-13707 mask IX+62, call RST 20, and use the _DATA_5D38_ nested jump table.'],
  }),
  table(0x05D38, '_DATA_5D38_', 'item_spawn_nested_variant_jump_table', ['_LABEL_5CF6_', '_LABEL_5D46_', '_LABEL_5CF6_', '_LABEL_5D51_', '_LABEL_5D5E_', '_LABEL_5D5E_', '_LABEL_5CF6_'], '_RAM_C37E_', 'Seven-entry nested item spawn variant table reached from _LABEL_5D32_.', 'ASM lines 13706-13708 mark the jump table from 5D38 to 5D45 with seven .dw entries.'),
  code(0x05D46, '_LABEL_5D46_', 'item_spawn_nested_default_head', 'Nested item spawn variant that sets IX+32=0, masks IX+62, and branches into the shared _LABEL_5CFF_ setup.', {
    indexedBy: '_RAM_C37E_',
    ramRefs: ['IX+32', 'IX+62'],
    evidence: ['ASM lines 13710-13715 identify _LABEL_5D46_ as the second _DATA_5D38_ entry and branch to _LABEL_5CFF_.'],
  }),
  code(0x05D51, '_LABEL_5D51_', 'item_spawn_nested_state2_head', 'Nested item spawn variant that starts animation from IX+62 low bits and enters active state 2.', {
    indexedBy: '_RAM_C37E_',
    calls: ['_LABEL_1318_'],
    ramRefs: ['IX+32', 'IX+62'],
    evidence: ['ASM lines 13717-13722 identify _LABEL_5D51_ as a _DATA_5D38_ entry that calls _LABEL_1318_ and sets IX+32=2.'],
  }),
  code(0x05D5E, '_LABEL_5D5E_', 'item_spawn_nested_state3_head', 'Nested item spawn variant that enters active state 3 through the shared _LABEL_5CFF_ setup.', {
    indexedBy: '_RAM_C37E_',
    ramRefs: ['IX+32', 'IX+62'],
    evidence: ['ASM lines 13724-13729 identify _LABEL_5D5E_ as a _DATA_5D38_ entry that sets IX+32=3 and jumps to _LABEL_5CFF_.'],
  }),
  table(0x05E0C, '_DATA_5E0C_', 'normal_item_state_jump_table', ['_LABEL_5E1C_', '_LABEL_5E2E_', '_LABEL_5E60_'], '_RAM_C370_', 'Three-entry normal item state table selected from IX+48 by _LABEL_5E02_.', 'ASM lines 13800-13804 dispatch IX+48 through RST 20 and mark the jump table from 5E0C to 5E11.'),
  table(0x05E16, '_DATA_5E16_', 'special_item_state_jump_table', ['_LABEL_5EA5_', '_LABEL_5EB7_', '_LABEL_5ED4_'], '_RAM_C370_', 'Three-entry special item state table selected from IX+48 for IX+62 entries with bit 7 set.', 'ASM lines 13807-13811 dispatch IX+48 through RST 20 and mark the jump table from 5E16 to 5E1B.'),
  code(0x05E98, '_LABEL_5E98_', 'item_pickup_transform_trigger', 'Special pickup path that calls _LABEL_126C_, sets _RAM_D000_=1, clears IX+0, and returns.', {
    calls: ['_LABEL_126C_'],
    ramRefs: ['_RAM_D000_', 'IX+0'],
    evidence: ['ASM lines 13872-13877 show _LABEL_5E98_ handling the IX+62 value 0x46 branch by calling _LABEL_126C_, setting _RAM_D000_, and clearing the entity slot.'],
  }),
  code(0x05EE6, '_LABEL_5EE6_', 'active_item_state_2_dispatch_head', 'Active item state 2 dispatch head; dispatches IX+48 through _DATA_5EEA_.', {
    indexedBy: '_RAM_C370_',
    calls: ['_LABEL_20_'],
    ramRefs: ['IX+48', '_RAM_C370_'],
    evidence: ['ASM lines 13915-13919 identify _LABEL_5EE6_ as the second _DATA_5CE3_ entry and dispatch IX+48 through _DATA_5EEA_.'],
  }),
  table(0x05EEA, '_DATA_5EEA_', 'active_item_state_2_jump_table', ['_LABEL_5E1C_', '_LABEL_5E2E_', '_LABEL_5E60_'], '_RAM_C370_', 'Three-entry active item state-2 table that aliases the normal item state handlers.', 'ASM lines 13918-13920 mark the jump table from 5EEA to 5EEF with three .dw entries.'),
  code(0x05EF0, '_LABEL_5EF0_', 'active_item_state_3_dispatch_head', 'Active item state 3 dispatch head; dispatches IX+48 through _DATA_5EF4_.', {
    indexedBy: '_RAM_C370_',
    calls: ['_LABEL_20_'],
    ramRefs: ['IX+48', '_RAM_C370_'],
    evidence: ['ASM lines 13922-13926 identify _LABEL_5EF0_ as the third _DATA_5CE3_ entry and dispatch IX+48 through _DATA_5EF4_.'],
  }),
  table(0x05EF4, '_DATA_5EF4_', 'active_item_state_3_jump_table', ['_LABEL_5EA5_', '_LABEL_5EB7_', '_LABEL_5EFA_'], '_RAM_C370_', 'Three-entry active item state-3 table with two special pickup pause handlers and a final scroll/reward handler.', 'ASM lines 13925-13927 mark the jump table from 5EF4 to 5EF9 with three .dw entries.'),
  code(0x05F18, '_LABEL_5F18_', 'active_item_state_4_dispatch_head', 'Active item state 4 dispatch head; dispatches IX+48 through _DATA_5F1C_.', {
    indexedBy: '_RAM_C370_',
    calls: ['_LABEL_20_'],
    ramRefs: ['IX+48', '_RAM_C370_'],
    evidence: ['ASM lines 13945-13949 identify _LABEL_5F18_ as the fourth _DATA_5CE3_ entry and dispatch IX+48 through _DATA_5F1C_.'],
  }),
  table(0x05F1C, '_DATA_5F1C_', 'active_item_state_4_jump_table', ['_LABEL_5E1C_', '_LABEL_5F22_', '_LABEL_5F52_'], '_RAM_C370_', 'Three-entry active item state-4 table for scroll/reward item handling.', 'ASM lines 13948-13950 mark the jump table from 5F1C to 5F21 with three .dw entries.'),
  code(0x05F8B, '_LABEL_5F8B_', 'active_item_state_5_dispatch_head', 'Active item state 5 dispatch head; dispatches IX+48 through _DATA_5F8F_.', {
    indexedBy: '_RAM_C370_',
    calls: ['_LABEL_20_'],
    ramRefs: ['IX+48', '_RAM_C370_'],
    evidence: ['ASM lines 14013-14017 identify _LABEL_5F8B_ as the fifth _DATA_5CE3_ entry and dispatch IX+48 through _DATA_5F8F_.'],
  }),
  table(0x05F8F, '_DATA_5F8F_', 'active_reward_state_jump_table', ['_LABEL_5E1C_', '_LABEL_5FFE_', '_LABEL_5F97_', '_LABEL_5FB0_'], '_RAM_C370_', 'Four-entry active reward state table used by item/reward movement and collection states.', 'ASM lines 14016-14018 mark the jump table from 5F8F to 5F96 with four .dw entries.'),
  code(0x05FE8, '_LABEL_5FE8_', 'active_item_state_6_dispatch_head', 'Active item state 6 dispatch head; dispatches IX+48 through _DATA_5FEC_.', {
    indexedBy: '_RAM_C370_',
    calls: ['_LABEL_20_'],
    ramRefs: ['IX+48', '_RAM_C370_'],
    evidence: ['ASM lines 14057-14061 identify _LABEL_5FE8_ as the sixth _DATA_5CE3_ entry and dispatch IX+48 through _DATA_5FEC_.'],
  }),
  table(0x05FEC, '_DATA_5FEC_', 'active_item_state_6_jump_table', ['_LABEL_5E1C_', '_LABEL_5FF6_', '_LABEL_5FFE_', '_LABEL_6032_', '_LABEL_606B_'], '_RAM_C370_', 'Five-entry active item state-6 table used by extended reward movement/collection states.', 'ASM lines 14060-14062 mark the jump table from 5FEC to 5FF5 with five .dw entries.'),
  code(0x05FF6, '_LABEL_5FF6_', 'active_item_state_6_animation_start', 'State-6 entry 2 setup that starts animation 2 and advances IX+48 before falling into _LABEL_5FFE_.', {
    indexedBy: '_RAM_C370_',
    calls: ['_LABEL_1318_'],
    ramRefs: ['IX+48'],
    evidence: ['ASM lines 14064-14068 identify _LABEL_5FF6_ as the second _DATA_5FEC_ entry that calls _LABEL_1318_ with A=2 and increments IX+48.'],
  }),
  code(0x06115, '_LABEL_6115_', 'room_trigger_sequence_clear_tail', 'Shared failure/cleanup tail for room trigger sequence startup; clears _RAM_D1B0_ and returns.', {
    calls: [],
    ramRefs: ['_RAM_D1B0_'],
    evidence: ['ASM lines 14220-14223 define _LABEL_6115_ as the shared tail used by multiple trigger checks before _LABEL_611C_; it clears _RAM_D1B0_ and returns.'],
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
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank0ObjectStateTableAudit');
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
      pointerTableCount: ENTRIES.filter(item => item.type === 'pointer_table').length,
      codeFragmentCount: ENTRIES.filter(item => item.type === 'code').length,
      assetPolicy: 'Metadata only: ASM labels, offsets, table entries by label, RAM/IX references, calls, and evidence. No ROM bytes or decoded graphics are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    evidence: [
      'ASM lines 13113-13118 define the subweapon/projectile state dispatch through _DATA_5807_.',
      'ASM lines 13655-14068 define item/reward spawn and active-state jump tables from _DATA_5CD3_ through _DATA_5FEC_.',
      'ASM lines 14220-14223 define _LABEL_6115_ as the cleanup tail for room trigger sequence startup.',
    ],
  };
}

function annotateRegion(region, item) {
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  const previousType = region.type || 'unknown';
  if (item.type === 'pointer_table') region.type = 'pointer_table';
  if (!region.name || region.name.startsWith('Jump Table @')) region.name = item.name;
  if (!region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank0ObjectStateTableAudit = {
    catalogId,
    kind: item.role,
    family: item.family,
    label: item.label,
    confidence: item.confidence,
    previousType,
    correctedType: item.type === 'pointer_table' ? 'pointer_table' : previousType,
    indexedBy: item.indexedBy,
    entries: item.entries,
    calls: item.calls,
    ramRefs: item.ramRefs,
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
    mapData.bank0ObjectStateTableCatalogs = (mapData.bank0ObjectStateTableCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.bank0ObjectStateTableCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank0_object_state_table_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: changes.annotated.length,
        missingRegions: changes.missing.length,
        inferredOnlyRegionsCovered: changes.annotated.filter(change => change.wasInferredOnlyBeforeAudit).length,
        retypedPointerTables: changes.annotated.filter(change => change.previousType !== change.correctedType && change.correctedType === 'pointer_table').length,
      },
      annotatedRegions: changes.annotated,
      missingRegions: changes.missing,
      nextLeads: [
        'Decode item/reward state handlers into a reusable state-machine table keyed by _DATA_5CE3_ state and IX+48 substates.',
        'Correlate IX+62 item ids with item_data regions and inventory/stat mutation helpers such as _LABEL_3763_.',
        'Represent the _DATA_5807_ subweapon/projectile state table separately from item reward tables in future entity tooling.',
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
      retypedPointerTables: changes.annotated.filter(change => change.previousType !== change.correctedType && change.correctedType === 'pointer_table').length,
    },
    missingRegions: changes.missing,
  }, null, 2));
}

main();
