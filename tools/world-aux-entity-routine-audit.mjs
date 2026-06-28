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
const catalogId = 'world-aux-entity-routine-catalog-2026-06-25';
const reportId = 'aux-entity-routine-audit-2026-06-25';
const toolName = 'tools/world-aux-entity-routine-audit.mjs';

const ROUTINES = [
  {
    offset: 0x05788,
    label: '_LABEL_5788_',
    role: 'auxiliary_slot_pair_dispatcher',
    name: '_LABEL_5788_ auxiliary slot pair dispatcher',
    summary: 'Updates the two auxiliary actor slots at _RAM_C2C0_ and _RAM_C300_, spawns a slot from _RAM_D023_, and dispatches each active slot through its behavior table.',
    calls: ['_LABEL_5803_', '_LABEL_5B35_'],
    ramRefs: ['_RAM_C24F_', '_RAM_C2C0_', '_RAM_C300_', '_RAM_D023_', '_RAM_D024_'],
    relatedOffsets: [0x05807],
    evidence: ['_LABEL_5788_ selects _RAM_C2C0_/_RAM_C300_ based on player form, clears _RAM_D023_/_RAM_D024_, and active slots dispatch through the table at _DATA_5807_.'],
  },
  {
    offset: 0x05811,
    label: '_LABEL_5811_',
    role: 'auxiliary_slot_common_init',
    name: '_LABEL_5811_ auxiliary slot common init',
    summary: 'Initializes an auxiliary actor slot from player-facing, player-position, and current animation metadata.',
    calls: ['_LABEL_1318_'],
    ramRefs: ['_RAM_C258_', '_RAM_C251_', '_RAM_C257_', '_RAM_C246_'],
    evidence: ['_LABEL_5811_ sets IX flags, calls _LABEL_1318_, copies _RAM_C258_ and _RAM_C251_, positions the slot relative to _RAM_C246_, and clears motion bytes.'],
  },
  {
    offset: 0x058BF,
    label: '_LABEL_58BF_',
    role: 'auxiliary_projectile_arc_behavior',
    name: '_LABEL_58BF_ auxiliary projectile arc behavior',
    summary: 'Initializes and updates a facing-dependent auxiliary projectile arc, including collision response and timeout handling.',
    calls: ['_LABEL_5811_', '_LABEL_1330_', '_LABEL_17AB_', '_LABEL_1B25_', '_LABEL_1BBA_'],
    ramRefs: ['_RAM_C243_'],
    evidence: ['_LABEL_58BF_ seeds facing-dependent velocity/position, then updates animation, collision, packed motion, contact inversion, viewport checks, and lifetime expiry.'],
  },
  {
    offset: 0x05946,
    label: '_LABEL_5946_',
    role: 'auxiliary_vertical_burst_behavior',
    name: '_LABEL_5946_ auxiliary vertical burst behavior',
    summary: 'Initializes an auxiliary burst at the player position, applies a vertical motion value, and clears the slot on collision or bounds exit.',
    calls: ['_LABEL_5811_', '_LABEL_12F8_', '_LABEL_104B_'],
    ramRefs: ['_RAM_C243_'],
    evidence: ['_LABEL_5946_ copies _RAM_C243_ into IX+3/4, offsets IX+6, requests sound/effect $33, then clears the slot when collision/bounds conditions are met.'],
  },
  {
    offset: 0x05981,
    label: '_LABEL_5981_',
    role: 'auxiliary_returning_actor_init',
    name: '_LABEL_5981_ auxiliary returning actor init',
    summary: 'Initializes a returning auxiliary actor with facing-dependent position, origin tracking, timers, and motion state.',
    calls: ['_LABEL_5811_'],
    ramRefs: ['_RAM_C243_'],
    evidence: ['_LABEL_5981_ initializes IX+8/9, IX+35/36 origin, IX+32/33 phase/timer, IX+34/40 flags, then falls through to _LABEL_59C6_.'],
  },
  {
    offset: 0x059C6,
    label: '_LABEL_59C6_',
    role: 'auxiliary_returning_actor_update',
    name: '_LABEL_59C6_ auxiliary returning actor update',
    summary: 'Updates the returning auxiliary actor, including collision with side actors, timed launch phase, homing/return motion, contact reward, and viewport expiration.',
    calls: ['_LABEL_5B10_', '_LABEL_104B_', '_LABEL_1330_', '_LABEL_12D8_', '_LABEL_12D5_', '_LABEL_5AFF_', '_LABEL_1B22_', '_LABEL_1BBA_'],
    ramRefs: ['_RAM_CF41_', '_RAM_C246_', '_RAM_C257_'],
    evidence: ['_LABEL_59C6_ checks auxiliary collisions through _LABEL_5B10_, plays periodic effect $2F, transitions from delay to motion phase, updates packed motion, and increments _RAM_CF41_ on player contact.'],
  },
  {
    offset: 0x05AB6,
    label: '_LABEL_5AB6_',
    role: 'auxiliary_palette_effect_actor',
    name: '_LABEL_5AB6_ auxiliary palette-effect actor',
    summary: 'Creates a large auxiliary actor centered on the camera/player context and starts the palette reveal loop.',
    calls: ['_LABEL_1318_', '_LABEL_104B_', '_LABEL_5BDD_'],
    ramRefs: ['_RAM_D00F_', '_RAM_C258_'],
    evidence: ['_LABEL_5AB6_ initializes an actor with broad hitbox fields, requests effect $12, calls _LABEL_5BDD_, then clears the slot in the follow-up state.'],
  },
  {
    offset: 0x05AFF,
    label: '_LABEL_5AFF_',
    role: 'auxiliary_player_overlap_marker',
    name: '_LABEL_5AFF_ auxiliary player overlap marker',
    summary: 'Tests the current auxiliary actor against the player body and sets IX+0 bit 3 on overlap.',
    calls: ['_LABEL_1C98_'],
    ramRefs: ['_RAM_C240_'],
    evidence: ['_LABEL_5AFF_ sets IY to _RAM_C240_, calls _LABEL_1C98_, and sets IX+0 bit 3 when carry indicates overlap.'],
  },
  {
    offset: 0x05B10,
    label: '_LABEL_5B10_',
    role: 'auxiliary_side_actor_contact_marker',
    name: '_LABEL_5B10_ auxiliary side-actor contact marker',
    summary: 'Tests current auxiliary actor overlap against _RAM_C340_ and _RAM_C380_ side actors and marks those actors as contacted.',
    calls: ['_LABEL_1C98_'],
    ramRefs: ['_RAM_C340_', '_RAM_C380_'],
    evidence: ['_LABEL_5B10_ probes active _RAM_C340_ and _RAM_C380_ actors with _LABEL_1C98_ and sets bit 2 on the contacted actor.'],
  },
  {
    offset: 0x05B35,
    label: '_LABEL_5B35_',
    role: 'secondary_auxiliary_spawn_update',
    name: '_LABEL_5B35_ secondary auxiliary spawn/update',
    summary: 'Spawns or updates the secondary auxiliary actor from _RAM_D024_, using player position/facing and a short active timer.',
    calls: ['_LABEL_1318_', '_LABEL_5BAE_', '_LABEL_104B_'],
    ramRefs: ['_RAM_D024_', '_RAM_C258_', '_RAM_C251_', '_RAM_C243_', '_RAM_C246_'],
    evidence: ['_LABEL_5B35_ checks _RAM_D024_, initializes IX fields and animation for a spawned auxiliary actor, clears _RAM_D024_, and otherwise dispatches active slots to _LABEL_5BAE_.'],
  },
  {
    offset: 0x05BAE,
    label: '_LABEL_5BAE_',
    role: 'secondary_auxiliary_update',
    name: '_LABEL_5BAE_ secondary auxiliary update',
    summary: 'Updates the secondary auxiliary actor animation, coordinate-A collision, viewport visibility, and lifetime.',
    calls: ['_LABEL_1330_', '_LABEL_17CA_', '_LABEL_1BBF_'],
    ramRefs: [],
    evidence: ['_LABEL_5BAE_ waits through a spawn delay, updates animation and coordinate-A collision, then clears the slot on collision, viewport exit, or timer expiry.'],
  },
  {
    offset: 0x05C4A,
    label: '_LABEL_5C4A_',
    role: 'reward_object_slot_pair_dispatcher',
    name: '_LABEL_5C4A_ reward object slot pair dispatcher',
    summary: 'Dispatches two reward/object slots at _RAM_C340_ and _RAM_C380_, spawning from _RAM_D025_ and object position metadata.',
    calls: ['_LABEL_1BE0_', '_LABEL_5CDF_'],
    ramRefs: ['_RAM_C340_', '_RAM_C380_', '_RAM_D025_', '_RAM_D026_', '_RAM_D028_', '_RAM_D029_', '_RAM_D02A_'],
    relatedOffsets: [0x05CD3, 0x05CE3],
    evidence: ['_LABEL_5C4A_ initializes _RAM_C340_/_RAM_C380_ slots from _RAM_D025_ metadata, calls _LABEL_1BE0_ for tile upload, then dispatches init/update state tables.'],
  },
  {
    offset: 0x05CDF,
    label: '_LABEL_5CDF_',
    role: 'reward_object_state_dispatch',
    name: '_LABEL_5CDF_ reward object state dispatch',
    summary: 'Dispatches active reward/object slots by IX+32 through the update-state table at _DATA_5CE3_.',
    calls: [],
    ramRefs: ['IX+32'],
    relatedOffsets: [0x05CE3],
    evidence: ['_LABEL_5CDF_ reads IX+32 and dispatches through the six-entry jump table at _DATA_5CE3_.'],
  },
  {
    offset: 0x05CFF,
    label: '_LABEL_5CFF_',
    role: 'reward_object_motion_init_common',
    name: '_LABEL_5CFF_ reward object motion init common',
    summary: 'Common reward/object initialization path that selects animation, sets falling motion, and configures direction-specific velocity.',
    calls: ['_LABEL_1318_'],
    ramRefs: ['IX+62'],
    evidence: ['_LABEL_5CFF_ calls _LABEL_1318_, tests IX+62 direction bit, and writes initial IX+8/9, IX+10/11, and IX+31 motion fields.'],
  },
  {
    offset: 0x05E02,
    label: '_LABEL_5E02_',
    role: 'reward_falling_state_dispatch',
    name: '_LABEL_5E02_ reward falling state dispatch',
    summary: 'Dispatches falling reward/object state by IX+48, selecting mirrored state tables based on IX+62 bit 7.',
    calls: [],
    ramRefs: ['IX+48', 'IX+62'],
    relatedOffsets: [0x05E0C, 0x05E16],
    evidence: ['_LABEL_5E02_ tests IX+62 bit 7 and dispatches IX+48 through _DATA_5E0C_ or _DATA_5E16_.'],
  },
  {
    offset: 0x05E2E,
    label: '_LABEL_5E2E_',
    role: 'reward_ground_pickup_handler',
    name: '_LABEL_5E2E_ reward ground pickup handler',
    summary: 'Updates a falling reward/object, checks player contact, applies the collected reward, and clears the object.',
    calls: ['_LABEL_12D5_', '_LABEL_1B25_', '_LABEL_1EBB_', '_LABEL_3763_', '_LABEL_242B_', '_LABEL_104B_', '_LABEL_6022_'],
    ramRefs: ['IX+62', '_RAM_D000_'],
    evidence: ['_LABEL_5E2E_ updates motion, tests player overlap, handles special id $46 through _LABEL_5E98_, applies rewards through _LABEL_3763_/_LABEL_242B_, plays effect $18, and clears IX+0.'],
  },
  {
    offset: 0x05E60,
    label: '_LABEL_5E60_',
    role: 'reward_bouncing_pickup_handler',
    name: '_LABEL_5E60_ reward bouncing pickup handler',
    summary: 'Variant pickup handler that includes full actor collision and viewport expiration before applying the reward.',
    calls: ['_LABEL_17AB_', '_LABEL_1B25_', '_LABEL_1EBB_', '_LABEL_3763_', '_LABEL_242B_', '_LABEL_104B_', '_LABEL_6718_'],
    ramRefs: ['IX+62', '_RAM_D000_'],
    evidence: ['_LABEL_5E60_ adds _LABEL_17AB_ collision and _LABEL_6718_ out-of-range clearing around the same contact/reward path as _LABEL_5E2E_.'],
  },
  {
    offset: 0x05EFA,
    label: '_LABEL_5EFA_',
    role: 'reward_health_meter_increment',
    name: '_LABEL_5EFA_ reward health/meter increment',
    summary: 'Applies a fixed reward by increasing _RAM_CF54_ with a cap, updates the display, and clears the object.',
    calls: ['_LABEL_104B_', '_LABEL_24DE_'],
    ramRefs: ['_RAM_CF54_'],
    evidence: ['_LABEL_5EFA_ requests effect $20, adds $0D to _RAM_CF54_ with cap $68, calls _LABEL_24DE_, then clears IX+0.'],
  },
  {
    offset: 0x05F22,
    label: '_LABEL_5F22_',
    role: 'reward_ground_value_handler',
    name: '_LABEL_5F22_ reward ground value handler',
    summary: 'Ground reward contact handler that either triggers a special routine or applies a value/display update.',
    calls: ['_LABEL_12D5_', '_LABEL_1B25_', '_LABEL_1EBB_', '_LABEL_38AD_', '_LABEL_24DE_', '_LABEL_104B_', '_LABEL_6022_'],
    ramRefs: ['IX+62'],
    evidence: ['_LABEL_5F22_ tests player overlap, calls _LABEL_38AD_ for low-nibble id $04, otherwise calls _LABEL_24DE_ with a value and plays effect $17.'],
  },
  {
    offset: 0x05F52,
    label: '_LABEL_5F52_',
    role: 'reward_bouncing_value_handler',
    name: '_LABEL_5F52_ reward bouncing value handler',
    summary: 'Bouncing reward contact handler with collision/out-of-range handling before applying the value.',
    calls: ['_LABEL_17AB_', '_LABEL_1B25_', '_LABEL_1EBB_', '_LABEL_38AD_', '_LABEL_24DE_', '_LABEL_104B_', '_LABEL_6718_'],
    ramRefs: ['IX+62'],
    evidence: ['_LABEL_5F52_ mirrors _LABEL_5F22_ but includes actor collision and _LABEL_6718_ clearing before the same reward application branch.'],
  },
  {
    offset: 0x05FFE,
    label: '_LABEL_5FFE_',
    role: 'reward_collectible_pickup_handler',
    name: '_LABEL_5FFE_ reward collectible pickup handler',
    summary: 'Collectible pickup handler that applies the object value through _LABEL_2441_ and clears the object on player contact.',
    calls: ['_LABEL_1330_', '_LABEL_12D5_', '_LABEL_1B25_', '_LABEL_1EBB_', '_LABEL_2441_', '_LABEL_104B_', '_LABEL_6022_'],
    ramRefs: ['IX+34'],
    evidence: ['_LABEL_5FFE_ updates animation/motion, tests overlap, calls _LABEL_2441_ with IX+34, plays effect $1A, and clears IX+0.'],
  },
  {
    offset: 0x06032,
    label: '_LABEL_6032_',
    role: 'reward_ground_collectible_handler',
    name: '_LABEL_6032_ reward ground collectible handler',
    summary: 'Grounded collectible state that can transition after floor contact or apply the collectible on player contact.',
    calls: ['_LABEL_17AB_', '_LABEL_1B25_', '_LABEL_1EBB_', '_LABEL_2441_', '_LABEL_104B_', '_LABEL_6718_', '_LABEL_1318_'],
    ramRefs: ['IX+27', 'IX+34'],
    evidence: ['_LABEL_6032_ handles collision, overlap collection via _LABEL_2441_, out-of-range clearing, and advances IX+48 when IX+27 bit 0 indicates ground contact.'],
  },
  {
    offset: 0x0606B,
    label: '_LABEL_606B_',
    role: 'reward_static_collectible_handler',
    name: '_LABEL_606B_ reward static collectible handler',
    summary: 'Static collectible state that only checks player overlap and out-of-range clearing.',
    calls: ['_LABEL_1EBB_', '_LABEL_2441_', '_LABEL_104B_', '_LABEL_6718_'],
    ramRefs: ['IX+34'],
    evidence: ['_LABEL_606B_ checks player overlap, applies IX+34 through _LABEL_2441_, plays effect $1A, clears IX+0, or clears on _LABEL_6718_.'],
  },
  {
    offset: 0x0608F,
    label: '_LABEL_608F_',
    role: 'room_reward_sequence_controller',
    name: '_LABEL_608F_ room reward sequence controller',
    summary: 'Processes pending room reward/object triggers from _RAM_D1B0_, patches the collision/VDP tile, filters duplicate rewards, and schedules reward object spawns.',
    calls: ['_LABEL_10_', '_LABEL_617B_', '_LABEL_61C2_', '_LABEL_6166_', '_LABEL_6141_'],
    ramRefs: ['_RAM_D1B0_', '_RAM_D1B1_', '_RAM_D1B3_', '_RAM_D1B5_', '_RAM_D1B7_', '_RAM_D1B9_', '_RAM_D1BB_', '_RAM_CF49_', '_RAM_CF25_', '_RAM_CF26_', '_RAM_CF20_', '_RAM_D025_'],
    relatedOffsets: [0x13E01, 0x061BA],
    evidence: ['_LABEL_608F_ initializes reward coordinate fields from _RAM_D1B1_, calls _LABEL_617B_ to patch the room tile, checks existing inventory/state flags, and either schedules a direct object through _LABEL_6166_ or starts a _DATA_13E01_ sequence.'],
  },
  {
    offset: 0x06141,
    label: '_LABEL_6141_',
    role: 'room_reward_sequence_step',
    name: '_LABEL_6141_ room reward sequence step',
    summary: 'Steps the active room reward sequence pointer and schedules each emitted object until an $FF terminator.',
    calls: ['_LABEL_6166_'],
    ramRefs: ['_RAM_D1B0_', '_RAM_D1B3_', '_RAM_D1B5_'],
    evidence: ['_LABEL_6141_ decrements _RAM_D1B5_, periodically reads the byte stream at _RAM_D1B3_, calls _LABEL_6166_ for non-$FF bytes, and clears _RAM_D1B0_ on terminator.'],
  },
  {
    offset: 0x06166,
    label: '_LABEL_6166_',
    role: 'room_reward_spawn_request_writer',
    name: '_LABEL_6166_ room reward spawn request writer',
    summary: 'Writes the pending reward object id, coordinates, and direction into the spawn request RAM consumed by the reward slot dispatcher.',
    calls: [],
    ramRefs: ['_RAM_D025_', '_RAM_D026_', '_RAM_D028_', '_RAM_D029_', '_RAM_D1B7_', '_RAM_D1B9_'],
    evidence: ['_LABEL_6166_ writes A to _RAM_D025_, copies _RAM_D1B7_ to _RAM_D026_, copies _RAM_D1B9_ to _RAM_D028_, and sets _RAM_D029_ to $01.'],
  },
  {
    offset: 0x0617B,
    label: '_LABEL_617B_',
    role: 'room_reward_tile_patch_writer',
    name: '_LABEL_617B_ room reward tile patch writer',
    summary: 'Patches the collision buffer and writes two four-tile rows to VRAM when a room reward object is opened/revealed.',
    calls: ['_LABEL_1144_', '_LABEL_115D_', '_LABEL_28_', '_LABEL_30_', '_LABEL_104B_'],
    ramRefs: ['_RAM_CF82_'],
    relatedOffsets: [0x061BA],
    evidence: ['_LABEL_617B_ writes tile ids $47/$48 into the collision buffer, writes _DATA_61BA_ as two VDP rows with attribute $09, and requests effect $2E.'],
  },
  {
    offset: 0x061C2,
    label: '_LABEL_61C2_',
    role: 'room_reward_threshold_check',
    name: '_LABEL_61C2_ room reward threshold check',
    summary: 'Compares a reward threshold derived from A against _RAM_CF54_.',
    calls: [],
    ramRefs: ['_RAM_CF54_'],
    evidence: ['_LABEL_61C2_ computes B * $0D from A and compares _RAM_CF54_ against that threshold.'],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(region => {
    const start = parseInt(region.offset, 16);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
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

function hasNonInferredAnalysisOtherThanSelf(region) {
  return Boolean(region && Object.keys(region.analysis || {}).some(key => (
    key !== 'inferred' && key !== 'auxEntityRoutineAudit'
  )));
}

function buildCatalog(mapData) {
  const routines = ROUTINES.map(def => {
    const region = findContainingRegion(mapData, def.offset);
    const relatedRegions = (def.relatedOffsets || [])
      .map(offset => regionRef(findContainingRegion(mapData, offset)))
      .filter(Boolean);
    return {
      id: `${def.label}_${def.role}`,
      label: def.label,
      offset: hex(def.offset),
      role: def.role,
      proposedName: def.name,
      summary: def.summary,
      confidence: 'high',
      region: regionRef(region),
      wasGenericCodeRegion: Boolean(region && !hasNonInferredAnalysisOtherThanSelf(region)),
      calls: def.calls || [],
      ramRefs: def.ramRefs || [],
      relatedRegions,
      evidence: def.evidence,
    };
  });
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    routines,
    summary: {
      routineCount: routines.length,
      missingRegions: routines.filter(routine => !routine.region).length,
      genericCodeRegionsCovered: routines.filter(routine => routine.wasGenericCodeRegion).length,
      assetPolicy: 'Metadata only: ASM labels, offsets, routine roles, calls, RAM refs, related table/region refs, and evidence. No ROM bytes or decoded graphics/items are embedded.',
    },
  };
}

function annotateRegion(region, routine) {
  const previousName = region.name || '';
  if (!previousName && routine.proposedName) region.name = routine.proposedName;
  region.analysis = region.analysis || {};
  region.analysis.auxEntityRoutineAudit = {
    catalogId,
    kind: routine.role,
    label: routine.label,
    summary: routine.summary,
    confidence: routine.confidence,
    nameBeforeAudit: previousName,
    nameAfterAudit: region.name || '',
    detail: {
      routineOffset: routine.offset,
      regionOffset: region.offset,
      calls: routine.calls,
      ramRefs: routine.ramRefs,
      relatedRegions: routine.relatedRegions,
    },
    evidence: routine.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    label: routine.label,
    role: routine.role,
    previousName,
    name: region.name || '',
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const missingRegions = catalog.routines
    .filter(routine => !routine.region)
    .map(routine => ({ label: routine.label, offset: routine.offset, role: routine.role }));
  const annotatedRegions = [];

  if (apply) {
    for (const routine of catalog.routines) {
      if (!routine.region) continue;
      const region = mapData.regions.find(item => item.id === routine.region.id);
      annotatedRegions.push(annotateRegion(region, routine));
    }

    const finalCatalog = buildCatalog(mapData);
    mapData.entityDataCatalogs = (mapData.entityDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.entityDataCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'aux_entity_routine_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
      routines: finalCatalog.routines,
      annotatedRegions,
      missingRegions,
      nextLeads: [
        'Tie IX+62 object ids to item/reward names through the existing item data catalogs and _LABEL_3763_/_LABEL_2441_ consumers.',
        'Decode the jump-table variants under _DATA_5CD3_, _DATA_5CE3_, and nested _DATA_5E0C/_DATA_5FEC_ as a state-machine graph.',
        'Connect _LABEL_608F_ reward sequence bytes from _DATA_13E01_ to room/zone triggers so custom rooms can reproduce reward spawning.',
      ],
    });

    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: apply ? annotatedRegions : catalog.routines
      .filter(routine => routine.region)
      .map(routine => ({
        id: routine.region.id,
        offset: routine.region.offset,
        label: routine.label,
        role: routine.role,
        currentName: routine.region.name || '',
        proposedName: routine.proposedName,
      })),
    missingRegions,
  }, null, 2));
}

main();
