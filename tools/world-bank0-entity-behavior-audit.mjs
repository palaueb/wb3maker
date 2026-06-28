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
const catalogId = 'world-bank0-entity-behavior-catalog-2026-06-25';
const reportId = 'bank0-entity-behavior-audit-2026-06-25';
const toolName = 'tools/world-bank0-entity-behavior-audit.mjs';

function interaction(offset, label, role, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name: `${label} ${role.replaceAll('_', ' ')}`,
    type: 'code',
    family: options.family || 'bank0_entity_interaction',
    confidence: options.confidence || 'high',
    table: options.table || null,
    tableIndex: options.tableIndex ?? null,
    calls: options.calls || [],
    ramRefs: options.ramRefs || [],
    summary,
    evidence: [
      `${label} is an ASM code label at ROM offset ${hex(offset)}.`,
      ...(options.table ? [`${label} is dispatched from ${options.table}${options.tableIndex == null ? '' : ` entry ${options.tableIndex}`}.`] : []),
      ...(options.evidence || []),
    ],
  };
}

function init(offset, label, tableIndex, summary, lineEvidence, options = {}) {
  return interaction(offset, label, `entity_init_table_${tableIndex}`, summary, {
    family: 'bank0_entity_init_table',
    table: '_DATA_668E_',
    tableIndex,
    calls: options.calls || ['_LABEL_1318_'],
    ramRefs: options.ramRefs || ['IX+0', 'IX+17', 'IX+31', 'IX+32', 'IX+37', 'IX+38', 'IX+39', 'IX+53'],
    evidence: [lineEvidence],
  });
}

const ENTRIES = [
  interaction(0x05E1C, '_LABEL_5E1C_', 'entity_item_fall_wait_state', 'Item/entity state that animates and moves via _LABEL_12D5_ until vertical velocity IX+11 becomes non-negative, then advances IX+48.', {
    table: '_DATA_5E0C_',
    tableIndex: 0,
    calls: ['_LABEL_1330_', '_LABEL_12D5_', '_LABEL_1B25_'],
    ramRefs: ['IX+11', 'IX+48'],
    evidence: ['ASM lines 13814-13821 call animation/movement helpers, test IX+11 bit 7, and increment IX+48 when the falling/wait condition ends.'],
  }),
  interaction(0x05EA5, '_LABEL_5EA5_', 'entity_special_pickup_pause_entry', 'Alternate pickup state entry that zeroes player vertical motion, plays effect 0x32, starts a 0x40-frame pause, and falls into the pause loop.', {
    table: '_DATA_5E16_',
    tableIndex: 0,
    calls: ['_LABEL_104B_'],
    ramRefs: ['_RAM_C248_', 'IX+33', 'IX+48'],
    evidence: ['ASM lines 13882-13890 clear _RAM_C248_, call _LABEL_104B_ with 0x32, seed IX+33, increment IX+48, then fall into _LABEL_5EB7_.'],
  }),
  interaction(0x05EB7, '_LABEL_5EB7_', 'entity_special_pickup_pause_loop', 'Pause/display loop for the special pickup path; waits frames, moves the entity upward, refreshes sprites, delays 0x10 more frames, then advances IX+48.', {
    table: '_DATA_5E16_',
    tableIndex: 1,
    calls: ['_LABEL_1004_', '_LABEL_6E7_'],
    ramRefs: ['IX+6', 'IX+33', 'IX+48'],
    evidence: ['ASM lines 13890-13903 wait on _LABEL_1004_, decrement IX+6 and IX+33 while rebuilding sprites through _LABEL_6E7_, then advance IX+48.'],
  }),
  interaction(0x05ED4, '_LABEL_5ED4_', 'entity_special_pickup_apply_and_clear', 'Final special pickup state that applies the item/equipment effect from IX+62, plays effect 0x18, and clears the entity slot.', {
    table: '_DATA_5E16_',
    tableIndex: 2,
    calls: ['_LABEL_3763_', '_LABEL_104B_'],
    ramRefs: ['IX+0', 'IX+62'],
    evidence: ['ASM lines 13906-13913 mask IX+62, call _LABEL_3763_, play effect 0x18, and clear IX+0.'],
  }),
  interaction(0x05F97, '_LABEL_5F97_', 'entity_reward_sideways_velocity_setup', 'Reward/item state setup that marks IX+1, chooses signed X velocity from facing bit IX+17, and advances to the active reward movement state.', {
    table: '_DATA_5F8F_',
    tableIndex: 2,
    ramRefs: ['IX+1', 'IX+8', 'IX+9', 'IX+17', 'IX+48'],
    evidence: ['ASM lines 14020-14031 set IX+1 bit 7, choose IX+8/9 as +/-0x0100 based on IX+17, and fall into _LABEL_5FB0_.'],
  }),
  interaction(0x05FB0, '_LABEL_5FB0_', 'entity_reward_movement_collect_state', 'Active reward/item movement state that animates, applies movement/collision, awards value through _LABEL_2441_ on contact, or clears itself when offscreen/animation ends.', {
    table: '_DATA_5F8F_',
    tableIndex: 3,
    calls: ['_LABEL_1330_', '_LABEL_17FE_', '_LABEL_1B25_', '_LABEL_1EBB_', '_LABEL_2441_', '_LABEL_104B_', '_LABEL_6718_'],
    ramRefs: ['IX+0', 'IX+16', 'IX+34'],
    evidence: ['ASM lines 14031-14057 run animation/movement/contact helpers, award IX+34 through _LABEL_2441_ with effect 0x1A on contact, and clear IX+0 on collection/offscreen/animation end.'],
  }),
  interaction(0x06022, '_LABEL_6022_', 'entity_vertical_threshold_state_advance', 'Shared state gate that advances IX+48 when the entity Y position reaches the IX+35 threshold and is not negative/high-page.', {
    ramRefs: ['IX+6', 'IX+7', 'IX+35', 'IX+48'],
    evidence: ['ASM lines 14088-14095 return while IX+7 is negative or IX+6 is below IX+35, otherwise increment IX+48.'],
  }),
  interaction(0x0611C, '_LABEL_611C_', 'room_trigger_sequence_start', 'Starts a one-shot room trigger/effect sequence when the per-trigger byte in _RAM_D1BB_ is still clear.', {
    calls: ['_LABEL_104B_'],
    ramRefs: ['_RAM_D1B0_', '_RAM_D1B3_', '_RAM_D1B5_', '_RAM_D1BB_', '_RAM_D025_', '_RAM_D026_', '_RAM_D028_', '_RAM_D029_'],
    evidence: ['ASM lines 14227-14246 index _RAM_D1BB_ by trigger id, reject repeats, load a sequence pointer from _DATA_13E01_, and reset _RAM_D1B5_.'],
  }),
  interaction(0x0634B, '_LABEL_634B_', 'tile_fragment_projectile_active_state', 'Active tile-fragment projectile update that increments age, moves, applies collision/offscreen checks, and clears the slot when finished.', {
    calls: ['_LABEL_12D5_', '_LABEL_1B25_', '_LABEL_6718_'],
    ramRefs: ['IX+0', 'IX+33'],
    evidence: ['ASM lines 14497-14504 increment IX+33, run movement/collision/offscreen checks, and clear IX+0 when carry indicates the projectile is done.'],
  }),
  interaction(0x0667C, '_LABEL_667C_', 'entity_behavior_initializer_dispatch', 'Initializes an active room entity by resolving its data record, then dispatches the entity type through the 69-entry _DATA_668E_ initializer table.', {
    table: '_DATA_668E_',
    calls: ['_LABEL_676D_', '_DATA_668E_'],
    ramRefs: ['IX+0', 'IX+1', 'IX+15', '_RAM_FFFF_'],
    evidence: ['ASM lines 14914-14932 set IX+1, clear IX+0 bit 6, call _LABEL_676D_, derive index from IX+15, and dispatch through _DATA_668E_.'],
  }),
  init(0x0692F, '_LABEL_692F_', 3, 'Entity initializer variant 3; stores a small variant id in IX+53, starts animation from IX+17+1, installs _DATA_696A behavior pointer list, and seeds motion/state fields.', 'ASM lines 15104-15123 initialize IX+53, call _LABEL_1318_, set IX+31/32/37/38/39/40/41/42/43/48/33.'),
  init(0x069E1, '_LABEL_69E1_', 8, 'Shared entity initializer tail for entries using a caller-selected behavior pointer list; sets bit 0 in IX+0, clears velocity/state fields, and starts animation.', 'ASM lines 15180-15189 store HL into IX+38/39, set IX+0 bit 0, clear IX+10/11/32, and call _LABEL_1318_.', { calls: ['_LABEL_1318_'], ramRefs: ['IX+0', 'IX+10', 'IX+11', 'IX+32', 'IX+38', 'IX+39'] }),
  init(0x06A23, '_LABEL_6A23_', 57, 'Entity initializer variant 57; sets a 0x0100 vertical/vector pair, installs _DATA_6A47, clears state, and starts animation.', 'ASM lines 15201-15214 set IX+10/11 and IX+42/43 to 0x0100, set IX+38/39 to _DATA_6A47, clear IX+32, and call _LABEL_1318_.'),
  init(0x06A49, '_LABEL_6A49_', 4, 'Entity initializer variant 4/5/6; sets IX+1, starts animation, installs _DATA_6A73, and seeds common movement/timer fields.', 'ASM lines 15221-15234 set IX+1, call _LABEL_1318_, set IX+32, IX+38/39, IX+49/50, IX+53, and IX+37.'),
  init(0x06A7F, '_LABEL_6A7F_', 9, 'Entity initializer variant 9/10/11; installs _DATA_6AAD and seeds behavior speed/timer fields for a three-variant group.', 'ASM lines 15241-15255 call _LABEL_1318_, set IX+32, IX+37/38/39/40/41/49/53/54.'),
  init(0x06ACF, '_LABEL_6ACF_', 13, 'Shared entity initializer tail for variants 12/13/16; installs a caller-selected behavior list and seeds movement fields.', 'ASM lines 15262-15288 show variants 12/13/16 selecting IX+37 and HL before the shared _LABEL_6ACF_ tail sets IX+38/39, IX+1, animation, IX+31/32/40/41/42/43.'),
  init(0x06B17, '_LABEL_6B17_', 14, 'Entity initializer variant 14; installs _DATA_6B42 with zeroed auxiliary fields and IX+49=4.', 'ASM lines 15305-15320 call _LABEL_1318_ and seed IX+32/37/38/39/40/41/53/54/49.'),
  init(0x06B4C, '_LABEL_6B4C_', 15, 'Entity initializer variant 15; similar to variant 14 with a smaller IX+37 and IX+53=0x0B.', 'ASM lines 15327-15340 call _LABEL_1318_ and seed IX+32/37/38/39/40/41/53/54.'),
  init(0x06BB9, '_LABEL_6BB9_', 20, 'Entity initializer variant 20/21/22; starts animation, installs _DATA_6BDB, and seeds timer/threshold fields.', 'ASM lines 15377-15388 call _LABEL_1318_ and set IX+31/32/37/44/38/39.'),
  init(0x06BE5, '_LABEL_6BE5_', 23, 'Entity initializer variant 23 shared with 24/25 tail; seeds variant-specific IX+37/41/43/53 before common animation setup.', 'ASM lines 15395-15427 set variant constants, then call _LABEL_1318_ and install _DATA_6C3B through the shared tail.'),
  init(0x06BF7, '_LABEL_6BF7_', 24, 'Entity initializer variant 24 shared with 23/25 tail; seeds variant-specific IX+37/41/43/53 before common animation setup.', 'ASM lines 15403-15427 set variant constants, then call _LABEL_1318_ and install _DATA_6C3B through the shared tail.'),
  init(0x06C09, '_LABEL_6C09_', 25, 'Entity initializer variant 25 shared with 23/24 tail; seeds variant-specific IX+37/41/43/53 before common animation setup.', 'ASM lines 15411-15427 set variant constants, then call _LABEL_1318_ and install _DATA_6C3B through the shared tail.'),
  init(0x06C59, '_LABEL_6C59_', 28, 'Entity initializer variant 28 shared with 26/27 tail; sets IX+37/53, marks IX+0 with 0x43, installs _DATA_6C7B, and seeds state fields.', 'ASM lines 15446-15458 set IX+37/53, OR IX+0 with 0x43, install _DATA_6C7B, set IX+32 and IX+33.'),
  init(0x06C85, '_LABEL_6C85_', 29, 'Entity initializer variant 29/30/31; starts animation, installs _DATA_6CA3, and seeds speed/state fields.', 'ASM lines 15465-15475 call _LABEL_1318_ and set IX+32/31/38/39/37.'),
  init(0x06CAB, '_LABEL_6CAB_', 32, 'Entity initializer variant 32; starts animation, copies player attack stat _RAM_C258 into IX+24, installs _DATA_6DEE, and clears IX+53.', 'ASM lines 15482-15492 call _LABEL_1318_, copy _RAM_C258 to IX+24, set IX+38/39 to _DATA_6DEE, and set IX+53=0.'),
  init(0x06CD0, '_LABEL_6CD0_', 35, 'Entity initializer variant 35 shared with 33/34 tail; sets variant IX+54, IX+53=0x13, installs _DATA_6CFB, and seeds vertical acceleration fields.', 'ASM lines 15495-15520 set IX+54/53, call _LABEL_1318_, set IX+31/32/38/39/42/43.'),
  init(0x06D13, '_LABEL_6D13_', 38, 'Entity initializer variant 38 shared with 36/37 tail; seeds signed motion constants, installs _DATA_6D47, and sets common movement state.', 'ASM lines 15527-15557 select BC/A constants, store IX+43/53/56/37, call _LABEL_1318_, and set IX+31/32/38/39/42/54.'),
  init(0x06D5B, '_LABEL_6D5B_', 41, 'Entity initializer variant 41 shared with 39/40 tail; sets IX+53/37 from BC, installs _DATA_6D8E, and seeds common motion fields.', 'ASM lines 15563-15591 select BC constants, set IX+53/37, call _LABEL_1318_, and set IX+31/32/40/41/42/43/38/39.'),
  init(0x06DA4, '_LABEL_6DA4_', 44, 'Entity initializer variant 44 shared with 42/43 tail; sets IX+53, starts animation, installs _DATA_6DC9, and zeroes velocity through _LABEL_6919_.', 'ASM lines 15597-15621 set IX+53, IX+1, call _LABEL_1318_, set IX+32/38/39/49, and call _LABEL_6919_.', { calls: ['_LABEL_1318_', '_LABEL_6919_'] }),
  init(0x06DD1, '_LABEL_6DD1_', 45, 'Entity initializer variant 45/46/47; starts animation, installs _DATA_6DEE, sets IX+53=5, and seeds IX+33 from the pseudo-random helper.', 'ASM lines 15628-15638 call _LABEL_1318_, set IX+32/38/39/53, call _LABEL_D36_, and store IX+33.', { calls: ['_LABEL_1318_', '_LABEL_D36_'] }),
  init(0x06DF6, '_LABEL_6DF6_', 48, 'Entity initializer variant 48/49/50; sets IX+1, installs _DATA_6E20, and seeds common movement/timer fields.', 'ASM lines 15645-15658 set IX+1, call _LABEL_1318_, set IX+32/38/39/49/50/53/37.'),
  init(0x06E2A, '_LABEL_6E2A_', 51, 'Entity initializer variant 51/52/53; starts animation, installs _DATA_6E60, and seeds broad movement/timer constants.', 'ASM lines 15665-15681 call _LABEL_1318_, set IX+31/32/37/44/40/41/42/43/38/39/53.'),
  init(0x06E86, '_LABEL_6E86_', 56, 'Entity initializer variant 56 shared with 54/55 tail; sets IX+37/41/43, installs _DATA_6EB4, and seeds common movement state.', 'ASM lines 15687-15717 set variant constants, clear IX+40/42, call _LABEL_1318_, set IX+31/32, and install _DATA_6EB4.'),
  init(0x06EBE, '_LABEL_6EBE_', 58, 'Entity initializer variant 58/59/60; starts animation, installs _DATA_6DEE, sets IX+53=9, and seeds IX+33 from the pseudo-random helper.', 'ASM lines 15724-15734 call _LABEL_1318_, set IX+32/38/39/53, call _LABEL_D36_, and store IX+33.', { calls: ['_LABEL_1318_', '_LABEL_D36_'] }),
  init(0x06EDB, '_LABEL_6EDB_', 61, 'Entity initializer variant 61/62/63; starts animation, installs _DATA_6EFA, and seeds a negative Y/vector word.', 'ASM lines 15737-15747 call _LABEL_1318_, set IX+32/38/39, IX+10=0, IX+11=0xFF, and IX+31=0x10.'),
  init(0x06F25, '_LABEL_6F25_', 67, 'Entity initializer variant 67 shared with 64/65/66 tail; offsets X position, starts animation, installs _DATA_6F58, and marks IX+0 bit 0.', 'ASM lines 15758-15798 select IX+17/53 and DE, optionally offset IX+6, add DE to IX+3/4, call _LABEL_1318_, set IX+32/38/39, and set IX+0 bit 0.'),
  init(0x06F66, '_LABEL_6F66_', 69, 'Entity initializer variant 69 shared with 68 tail; sets IX+53, starts animation, installs _DATA_6F80, and enters state 3.', 'ASM lines 15804-15820 set IX+53, call _LABEL_1318_, set IX+32=3, and install _DATA_6F80.'),
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
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank0EntityBehaviorAudit');
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
      interactionRoutineCount: ENTRIES.filter(entry => entry.family === 'bank0_entity_interaction').length,
      initializerEntryCount: ENTRIES.filter(entry => entry.family === 'bank0_entity_init_table').length,
      assetPolicy: 'Metadata only: ASM labels, offsets, dispatch table indexes, routine roles, calls, RAM/IX references, and evidence. No ROM bytes or decoded graphics are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    evidence: [
      'ASM lines 13796-14095 show item/reward interaction state tables and shared state gates.',
      'ASM lines 14145-14504 show room trigger/projectile setup and active update helpers.',
      'ASM lines 14914-14932 show _LABEL_667C dispatching entity type ids through _DATA_668E_.',
      'ASM lines 15104-15820 show _DATA_668E_ initializer entries that seed IX fields and behavior pointer lists.',
    ],
  };
}

function annotateRegion(region, item) {
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  if (item.name && !region.name) region.name = item.name;
  if (item.summary && !region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank0EntityBehaviorAudit = {
    catalogId,
    kind: item.role,
    family: item.family,
    label: item.label,
    confidence: item.confidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    dispatchTable: item.table,
    dispatchIndex: item.tableIndex,
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
    mapData.bank0EntityBehaviorCatalogs = (mapData.bank0EntityBehaviorCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.bank0EntityBehaviorCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank0_entity_behavior_audit',
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
        'Resolve behavior pointer lists such as _DATA_6A73_, _DATA_6C3B_, and _DATA_6F80_ into callable behavior-state records without embedding bytes.',
        'Name the entity type ids in _DATA_668E_ by tracing room entity records from _LABEL_2963_ and correlating with visible sprite/metasprite ids.',
        'Model IX record fields used here (31/32/37/38/39/53/54/56) as a reusable entity schema in shared/wb3/entities.js only after behavior semantics are verified.',
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
