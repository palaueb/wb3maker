#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-runtime-mechanic-index-audit.mjs';
const catalogId = 'world-runtime-mechanic-index-catalog-2026-06-26';
const reportId = 'runtime-mechanic-index-audit-2026-06-26';
const schemaVersion = 1;
const runtimeEffectCatalogId = 'world-runtime-effect-index-catalog-2026-06-26';

const mechanicSpecs = [
  {
    id: 'player_movement_physics',
    label: 'Player Movement And Physics',
    description: 'Player state, form, velocity, jump/fall, transition, and physics routines that should drive the clean player engine modules.',
    terms: [
      /player/i,
      /physics/i,
      /form/i,
      /d16e/i,
      /velocity/i,
      /jump/i,
      /movement/i,
      /_RAM_C24F_/,
      /_RAM_C260_/,
      /_RAM_C251_/,
    ],
    evidenceKeys: [
      /^player/,
      /^d16e/,
    ],
    families: ['player_runtime'],
  },
  {
    id: 'collision_damage',
    label: 'Collision And Damage',
    description: 'Collision lookup, collision bounds, damage, hit/knockback, and entity motion collision support routines.',
    terms: [
      /collision/i,
      /damage/i,
      /hit/i,
      /knock/i,
      /health/i,
      /bound/i,
      /_RAM_C27D_/,
    ],
    evidenceKeys: [
      /^collision/,
      /^damage/,
      /^entityMotionCollision/,
      /^collisionBuffer/,
    ],
    families: [],
  },
  {
    id: 'room_transition_state',
    label: 'Room And Transition State',
    description: 'Room loader, zone graph, trigger, transition, camera, scroll, and event state routines.',
    terms: [
      /room/i,
      /zone/i,
      /transition/i,
      /trigger/i,
      /camera/i,
      /scroll/i,
      /scene/i,
      /cf6a/i,
      /cf6b/i,
      /d1ae/i,
      /d1af/i,
      /_RAM_C26C_/,
      /_RAM_C26E_/,
      /_RAM_CF6A_/,
      /_RAM_D1AE_/,
      /_RAM_D1AF_/,
    ],
    evidenceKeys: [
      /^room/,
      /^zone/,
      /^bank2Scene/,
      /^bank2Transition/,
      /^d1ae/,
      /^d1af/,
      /^cf6a/,
      /^cf6b/,
      /^uiTrigger/,
    ],
    families: ['room_zone_runtime'],
  },
  {
    id: 'entity_item_runtime',
    label: 'Entity And Item Runtime',
    description: 'Entity behavior dispatch, object slots, animation, item/reward/subweapon, metasprite, and C3C0 actor runtime routines.',
    terms: [
      /entity/i,
      /object/i,
      /item/i,
      /reward/i,
      /subweapon/i,
      /animation/i,
      /metasprite/i,
      /c3c0/i,
      /motion/i,
      /_RAM_C3C0_/,
    ],
    evidenceKeys: [
      /^entity/,
      /^c3c0/,
      /^animation/,
      /^bank0Object/,
      /^item/,
      /^metasprite/,
      /^auxEntity/,
      /^bank0Entity/,
    ],
    families: ['entity_runtime'],
  },
  {
    id: 'rendering_vdp_pipeline',
    label: 'Rendering And VDP Pipeline',
    description: 'VDP, VRAM/CRAM, screen program, tile upload, palette, sprite palette, graphics source, and render helper routines.',
    terms: [
      /vdp/i,
      /vram/i,
      /cram/i,
      /screen/i,
      /tile/i,
      /palette/i,
      /sprite/i,
      /graphics/i,
      /_LABEL_604_/,
      /_LABEL_8FB_/,
      /_LABEL_998_/,
    ],
    evidenceKeys: [
      /^vdp/,
      /^bankedVdp/,
      /^dynamicVdp/,
      /^dynamicTile/,
      /^spritePalette/,
      /^statusVdp/,
      /^statusTile/,
      /^graphics/,
      /^bank7Vdp/,
      /^bank2Vdp/,
    ],
    families: ['rendering_vdp_runtime'],
  },
  {
    id: 'audio_driver',
    label: 'Audio Driver',
    description: 'FM/PSG driver, stream, request, output register, and audio state routines.',
    terms: [
      /audio/i,
      /sound/i,
      /music/i,
      /psg/i,
      /fm/i,
      /_LABEL_104B_/,
    ],
    evidenceKeys: [
      /^audio/,
      /^bank3Audio/,
    ],
    families: ['audio_runtime'],
  },
  {
    id: 'menu_status_password',
    label: 'Menu Status Password',
    description: 'Status, shop, inventory, menu, continue/new-game, password, and UI support routines.',
    terms: [
      /menu/i,
      /status/i,
      /shop/i,
      /inventory/i,
      /continue/i,
      /password/i,
      /ui/i,
      /cf52/i,
      /cf54/i,
      /cf5b/i,
      /_RAM_D11B_/,
      /_RAM_CF52_/,
      /_RAM_CF54_/,
    ],
    evidenceKeys: [
      /^bank0Menu/,
      /^bank0Status/,
      /^bank0Continue/,
      /^password/,
      /^uiPlayer/,
      /^cf52/,
      /^cf54/,
      /^cf5b/,
      /^status/,
    ],
    families: ['menu_status_runtime'],
  },
  {
    id: 'core_support_runtime',
    label: 'Core Support Runtime',
    description: 'Shared decimal helpers, RNG seed reset, frame/vblank waits, bank stack reset, input playback helper fragments, and dispatch tails needed by the clean engine support layer.',
    terms: [
      /decimal/i,
      /digit/i,
      /rng/i,
      /random/i,
      /vblank/i,
      /bank stack/i,
      /input script/i,
      /dispatch tail/i,
      /_RAM_D120_/,
      /_RAM_D121_/,
    ],
    evidenceKeys: [
      /^bank0CoreHelperAudit$/,
    ],
    families: [],
    regionIds: [
      'r2758',
      'r1897',
    ],
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (key === undefined || key === null || key === '') continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function topCounts(counts, limit = 30) {
  return Object.fromEntries(Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit));
}

function addCounts(counts, values) {
  for (const value of values || []) counts[value] = (counts[value] || 0) + 1;
}

function matchSpec(entry, spec) {
  if ((spec.regionIds || []).includes(entry.id)) return true;
  if ((entry.subsystemFamilies || []).some(family => spec.families.includes(family))) return true;
  if ((entry.evidenceKeys || []).some(key => spec.evidenceKeys.some(pattern => pattern.test(key)))) return true;
  const haystack = [
    entry.id,
    entry.offset,
    entry.name,
    entry.inferredSummary,
    ...Object.values(entry.effects || {}).flat(),
    ...Object.values(entry.relations || {}).flat(),
  ].join(' ');
  return spec.terms.some(pattern => pattern.test(haystack));
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function compactRoutine(entry) {
  return {
    id: entry.id,
    offset: entry.offset,
    size: entry.size,
    bank: entry.bank,
    name: entry.name || '',
    confidence: entry.confidence,
    subsystemFamilies: entry.subsystemFamilies || [],
    effectCounts: entry.effectCounts || {},
    readsRAM: entry.effects?.readsRAM || [],
    writesRAM: entry.effects?.writesRAM || [],
    bankSwitches: entry.effects?.bankSwitches || [],
    calls: entry.relations?.calls || [],
    calledBy: entry.relations?.calledBy || [],
    evidenceKeys: entry.evidenceKeys || [],
    evidenceCatalogIds: entry.evidenceCatalogIds || [],
  };
}

function buildMechanic(spec, entries) {
  const matched = entries.filter(entry => matchSpec(entry, spec)).map(compactRoutine);
  const ramReads = {};
  const ramWrites = {};
  const bankSwitches = {};
  const calls = {};
  const calledBy = {};
  const evidenceKeys = {};
  const sourceCatalogs = {};
  for (const routine of matched) {
    addCounts(ramReads, routine.readsRAM);
    addCounts(ramWrites, routine.writesRAM);
    addCounts(bankSwitches, routine.bankSwitches);
    addCounts(calls, routine.calls);
    addCounts(calledBy, routine.calledBy);
    addCounts(evidenceKeys, routine.evidenceKeys);
    addCounts(sourceCatalogs, routine.evidenceCatalogIds);
  }

  return {
    id: spec.id,
    label: spec.label,
    description: spec.description,
    status: 'static_effect_index',
    confidenceModel: 'inherits routine confidence; mechanic grouping is keyword/evidence/family based and should be refined by frame traces',
    routineCount: matched.length,
    routineConfidenceCounts: countBy(matched, routine => routine.confidence),
    byBank: countBy(matched, routine => String(routine.bank).padStart(2, '0')),
    uniqueReferenceCounts: {
      readsRAM: Object.keys(ramReads).length,
      writesRAM: Object.keys(ramWrites).length,
      bankSwitches: Object.keys(bankSwitches).length,
      calls: Object.keys(calls).length,
      calledBy: Object.keys(calledBy).length,
      sourceCatalogs: Object.keys(sourceCatalogs).length,
    },
    aggregateEffectCounts: {
      readsRAM: matched.reduce((sum, routine) => sum + routine.readsRAM.length, 0),
      writesRAM: matched.reduce((sum, routine) => sum + routine.writesRAM.length, 0),
      bankSwitches: matched.reduce((sum, routine) => sum + routine.bankSwitches.length, 0),
      calls: matched.reduce((sum, routine) => sum + routine.calls.length, 0),
      calledBy: matched.reduce((sum, routine) => sum + routine.calledBy.length, 0),
    },
    topReferences: {
      readsRAM: topCounts(ramReads),
      writesRAM: topCounts(ramWrites),
      bankSwitches: topCounts(bankSwitches),
      calls: topCounts(calls),
      calledBy: topCounts(calledBy),
    },
    evidenceKeyCounts: topCounts(evidenceKeys, 60),
    sourceCatalogCounts: topCounts(sourceCatalogs, 40),
    routines: matched,
    nextLeads: [
      'Trace the top read/write RAM variables frame-by-frame before translating this mechanic into JavaScript.',
      'Confirm routines with multiple mechanic memberships at their call sites before assigning them to a single engine module.',
      'Use labels and RAM refs here as metadata only; no routine bytes or decoded assets are embedded.',
    ],
  };
}

function membershipFor(entries, mechanics) {
  const counts = {};
  for (const entry of entries) {
    const membership = mechanics.filter(mechanic => mechanic.routines.some(routine => routine.id === entry.id)).length;
    counts[String(membership)] = (counts[String(membership)] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => Number(a[0]) - Number(b[0])));
}

function buildCatalog(mapData) {
  const runtimeCatalog = (mapData.runtimeEffectCatalogs || []).find(item => item.id === runtimeEffectCatalogId);
  if (!runtimeCatalog) {
    throw new Error(`Missing required runtime effect catalog: ${runtimeEffectCatalogId}`);
  }
  const entries = runtimeCatalog.entries || [];
  const mechanics = mechanicSpecs.map(spec => buildMechanic(spec, entries));
  const uncoveredEntries = entries.filter(entry => !mechanics.some(mechanic =>
    mechanic.routines.some(routine => routine.id === entry.id)
  ));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogId: runtimeEffectCatalogId,
    assetPolicy: 'Metadata only: routine ids, offsets, labels, sizes, RAM variable names, call labels, evidence keys, catalog ids, mechanic groups, and aggregate counts. No ROM bytes, instruction bytes, decoded graphics, pixels, screenshots, text payloads, audio payloads, or hashes are embedded.',
    selectionRule: {
      source: 'world-runtime-effect-index-catalog-2026-06-26 entries',
      groupingRule: 'Mechanic membership is assigned from subsystem families, focused evidence keys, routine names/summaries, RAM variables, and call labels. A routine may appear in multiple mechanics.',
      limitation: 'This catalog is a static prioritization aid, not a frame-accurate behavior proof. It intentionally preserves overlapping routine memberships.',
    },
    summary: {
      sourceRuntimeRegionCount: entries.length,
      mechanicCount: mechanics.length,
      membershipCounts: membershipFor(entries, mechanics),
      uncoveredRoutineCount: uncoveredEntries.length,
      totalMechanicRoutineMemberships: mechanics.reduce((sum, mechanic) => sum + mechanic.routineCount, 0),
      mechanicRoutineCounts: Object.fromEntries(mechanics.map(mechanic => [mechanic.id, mechanic.routineCount])),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    mechanics,
    uncoveredRoutines: uncoveredEntries.map(compactRoutine),
  };
}

function reportSample(catalog) {
  return catalog.mechanics.map(mechanic => ({
    id: mechanic.id,
    routineCount: mechanic.routineCount,
    routineConfidenceCounts: mechanic.routineConfidenceCounts,
    uniqueReferenceCounts: mechanic.uniqueReferenceCounts,
    topReads: mechanic.topReferences.readsRAM,
    topWrites: mechanic.topReferences.writesRAM,
  }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);

  if (apply) {
    mapData.runtimeMechanicCatalogs = (mapData.runtimeMechanicCatalogs || []).filter(item => item.id !== catalogId);
    mapData.runtimeMechanicCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'runtime_mechanic_index_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      catalogId,
      sourceCatalogId: runtimeEffectCatalogId,
      summary: catalog.summary,
      mechanicSummary: reportSample(catalog),
      assetPolicy: catalog.assetPolicy,
      nextLeads: [
        'Use core_support_runtime membership to extract shared decimal, RNG, bank-stack, vblank wait, and dispatch helper semantics before translating higher-level mechanics.',
        'Start frame traces from player_movement_physics, collision_damage, and room_transition_state top RAM writes.',
        'Use audio_driver membership to build a PSG/FM stream state index before writing a browser player.',
        'Use rendering_vdp_pipeline membership to connect VRAM provenance with routine call sites.',
      ],
    });
    writeJson(mapPath, mapData);

    if (fs.existsSync(staticMapPath)) {
      const staticMap = readJson(staticMapPath);
      staticMap.analyzedAt = now;
      staticMap.summary = staticMap.summary || {};
      staticMap.summary.runtimeMechanicIndexCatalog = catalogId;
      staticMap.summary.runtimeMechanicIndexSourceRuntimeRegions = catalog.summary.sourceRuntimeRegionCount;
      staticMap.summary.runtimeMechanicIndexMechanics = catalog.summary.mechanicCount;
      staticMap.summary.runtimeMechanicIndexUncoveredRoutines = catalog.summary.uncoveredRoutineCount;
      staticMap.summary.runtimeMechanicIndexTotalRoutineMemberships = catalog.summary.totalMechanicRoutineMemberships;
      staticMap.summary.runtimeMechanicIndexPlayerMovementRoutines = catalog.summary.mechanicRoutineCounts.player_movement_physics || 0;
      staticMap.summary.runtimeMechanicIndexCollisionDamageRoutines = catalog.summary.mechanicRoutineCounts.collision_damage || 0;
      staticMap.summary.runtimeMechanicIndexAudioDriverRoutines = catalog.summary.mechanicRoutineCounts.audio_driver || 0;
      staticMap.summary.runtimeMechanicIndexCoreSupportRoutines = catalog.summary.mechanicRoutineCounts.core_support_runtime || 0;
      staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
      staticMap.primaryCatalogs.gameplay = insertAfter(
        staticMap.primaryCatalogs.gameplay,
        runtimeEffectCatalogId,
        catalogId
      );
      staticMap.primaryCatalogs.coverage = insertAfter(
        staticMap.primaryCatalogs.coverage,
        runtimeEffectCatalogId,
        catalogId
      );
      staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => (
        !note.includes(catalogId) ||
        !note.includes('core_support_runtime')
      ));
      staticMap.nextLeads.push('Use world-runtime-mechanic-index-catalog-2026-06-26 core_support_runtime membership to extract shared decimal, RNG, bank-stack, vblank wait, and dispatch helper semantics before translating higher-level mechanics.');
      writeJson(staticMapPath, staticMap);
    }
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    mechanicSummary: reportSample(catalog),
  }, null, 2));
}

main();
