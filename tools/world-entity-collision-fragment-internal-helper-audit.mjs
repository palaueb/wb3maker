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
const catalogId = 'world-entity-collision-fragment-internal-helper-catalog-2026-06-25';
const reportId = 'entity-collision-fragment-internal-helper-audit-2026-06-25';
const toolName = 'tools/world-entity-collision-fragment-internal-helper-audit.mjs';

const sourceCatalogIds = {
  helperGap: 'world-entity-c3c0-frame-step-helper-gap-catalog-2026-06-25',
  runtimeStruct: 'world-entity-runtime-struct-field-catalog-2026-06-25',
  playerStruct: 'world-player-struct-catalog-2026-06-25',
};

const helperDefinitions = [
  {
    offset: 0x06850,
    label: '_INTERNAL_6850_',
    role: 'entity_direction_latch_from_side_register',
    entryKind: 'internal_collision_fragment_helper',
    confidence: 'high',
    fieldRefs: ['IX+17'],
    ramRefs: [],
    inputs: ['C side selector'],
    outputs: ['IX+17 facing/source-side field', 'Z flag when unchanged', 'carry flag when changed'],
    summary: 'Compares the side selector in C with IX+17, leaves the field unchanged when it already matches, and stores C with carry set when the side changes.',
    evidence: [
      'ASM lines 15034-15051 contain the 0x067C1-0x068C6 interaction fragment; local opcode scan identifies 0x06850 as a short IX+17 compare/store helper ending in return.',
      'world-entity-c3c0-frame-step-helper-gap-catalog-2026-06-25 records actor 0x26 state targets calling 0x06850 immediately after the 0x0685A side/distance helper.',
      'world-entity-runtime-struct-field-catalog-2026-06-25 identifies IX+17 as a source-room/facing metadata field used by C3C0 room entity slots.',
    ],
  },
  {
    offset: 0x0685A,
    label: '_INTERNAL_685A_',
    role: 'entity_player_x_side_distance_threshold_helper',
    entryKind: 'internal_collision_fragment_helper',
    confidence: 'high',
    fieldRefs: ['IX+3', 'IX+4', 'IX+37'],
    ramRefs: ['_RAM_C243_'],
    inputs: ['IX+3/IX+4 entity X coordinate', '_RAM_C243_ player X coordinate', 'IX+37 X distance threshold'],
    outputs: ['C side selector', 'flags from absolute X distance compared with IX+37'],
    summary: 'Compares the entity X coordinate with the player X coordinate, derives a side selector in C, and returns flags for the absolute X distance against the IX+37 threshold field.',
    evidence: [
      'ASM lines 15034-15051 contain the 0x067C1-0x068C6 interaction fragment; local opcode scan identifies 0x0685A reading IX+3/IX+4, _RAM_C243_, and IX+37 before returning with comparison flags.',
      'world-player-struct-catalog-2026-06-25 identifies _RAM_C243_ as a player coordinate word candidate used by room and transition code.',
      'world-entity-c3c0-frame-step-helper-gap-catalog-2026-06-25 records actor 0x26 state targets calling 0x0685A before the 0x06850 direction latch.',
    ],
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function hex(value, width = 5) {
  return `0x${Number(value || 0).toString(16).toUpperCase().padStart(width, '0')}`;
}

function offsetOf(region) {
  return typeof region?.offset === 'number' ? region.offset : parseHex(region?.offset) || 0;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + Number(region.size || 0);
  }) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function findCatalog(mapData, id) {
  for (const [key, value] of Object.entries(mapData)) {
    if (!Array.isArray(value) || !/catalog/i.test(key)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function unique(items) {
  return [...new Set((items || []).filter(item => item !== '' && item != null))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function linkedActor26Target(helperGap, offsetText) {
  const target = (helperGap.helperTargets || []).find(item => item.targetOffset === offsetText);
  if (!target) return {
    sourceCallCount: 0,
    sourceCallOffsets: [],
    sourceBehaviorStateIndexes: [],
    sourceTargetOffsets: [],
    sourceTargetRoles: [],
  };
  return {
    sourceCallCount: Number(target.sourceCallCount || 0),
    sourceCallOffsets: target.sourceCallOffsets || [],
    sourceBehaviorStateIndexes: target.sourceBehaviorStateIndexes || [],
    sourceTargetOffsets: target.sourceTargetOffsets || [],
    sourceTargetRoles: target.sourceTargetRoles || [],
  };
}

function buildCatalog(mapData) {
  const helperGap = requireCatalog(mapData, sourceCatalogIds.helperGap);
  const runtimeStruct = requireCatalog(mapData, sourceCatalogIds.runtimeStruct);
  const playerStruct = requireCatalog(mapData, sourceCatalogIds.playerStruct);
  const helpers = helperDefinitions.map(def => {
    const offsetText = hex(def.offset);
    const region = findContainingRegion(mapData, def.offset);
    const actor26Link = linkedActor26Target(helperGap, offsetText);
    return {
      offset: offsetText,
      label: def.label,
      role: def.role,
      entryKind: def.entryKind,
      confidence: def.confidence,
      region: regionRef(region),
      fieldRefs: def.fieldRefs,
      ramRefs: def.ramRefs,
      inputs: def.inputs,
      outputs: def.outputs,
      actor26Link,
      persistedRomByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedGameplayValueCount: 0,
      summary: def.summary,
      evidence: def.evidence,
    };
  });
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    summary: {
      helperEntryCount: helpers.length,
      helperRegionCount: unique(helpers.map(helper => helper.region?.id)).length,
      actor26LinkedHelperEntryCount: helpers.filter(helper => helper.actor26Link.sourceCallCount > 0).length,
      actor26LinkedCallsiteCount: helpers.reduce((sum, helper) => sum + helper.actor26Link.sourceCallCount, 0),
      actor26BehaviorStateIndexes: unique(helpers.flatMap(helper => helper.actor26Link.sourceBehaviorStateIndexes)),
      fieldRefTokens: unique(helpers.flatMap(helper => helper.fieldRefs)),
      ramRefs: unique(helpers.flatMap(helper => helper.ramRefs)),
      runtimeStructCatalogBacked: runtimeStruct.id === sourceCatalogIds.runtimeStruct,
      playerStructCatalogBacked: playerStruct.id === sourceCatalogIds.playerStruct,
      persistedRomByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedGameplayValueCount: 0,
      assetPolicy: 'Metadata only: helper offsets, labels, roles, field/RAM labels, callsite offsets, counts, and evidence. No ROM bytes, decoded instruction byte streams, graphics, coordinates, screenshots, music, text, or gameplay constants are embedded.',
    },
    helpers,
    evidence: [
      `${sourceCatalogIds.helperGap} identifies 0x06850 and 0x0685A as actor 0x26 helper gaps inside the 0x067C1 collision/interaction fragment.`,
      `${sourceCatalogIds.runtimeStruct} and ${sourceCatalogIds.playerStruct} provide the field/RAM role vocabulary used by these helper summaries.`,
      'The helper roles are derived from local opcode structure only; instruction bytes and literal gameplay constants are not persisted.',
    ],
    nextLeads: [
      'Trace the local state-subroutine targets 0x06F96 and 0x078B7 next; they are now the remaining actor 0x26 exact-semantics gaps.',
      'Split the rest of 0x067C1 into named helper entries only where callsite evidence requires it.',
      'Use the direction latch and player-X side helper as named stubs in the read-only actor 0x26 frame-step diagnostic.',
    ],
  };
}

function annotateRegion(region, helpers, catalog) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.entityCollisionFragmentInternalHelperAudit = {
    catalogId,
    kind: 'entity_collision_fragment_internal_helpers',
    confidence: helpers.some(helper => helper.confidence !== 'high') ? 'medium' : 'high',
    helperEntryCount: helpers.length,
    helperOffsets: helpers.map(helper => helper.offset),
    helperRoles: helpers.map(helper => helper.role),
    actor26LinkedCallsiteCount: helpers.reduce((sum, helper) => sum + helper.actor26Link.sourceCallCount, 0),
    fieldRefTokens: unique(helpers.flatMap(helper => helper.fieldRefs)),
    ramRefs: unique(helpers.flatMap(helper => helper.ramRefs)),
    persistedRomByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedGameplayValueCount: 0,
    summary: `${helpers.length} internal helper entr${helpers.length === 1 ? 'y is' : 'ies are'} named inside the 0x067C1 collision/interaction fragment for actor 0x26 frame-step modeling.`,
    evidence: [
      `${catalog.id} records metadata-only helper entries at ${helpers.map(helper => helper.offset).join(', ')}.`,
      'No fragment bytes, decoded instruction streams, or literal gameplay constants are stored.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    helperEntryCount: helpers.length,
    helperOffsets: helpers.map(helper => helper.offset),
    helperRoles: helpers.map(helper => helper.role),
    actor26LinkedCallsiteCount: helpers.reduce((sum, helper) => sum + helper.actor26Link.sourceCallCount, 0),
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityBehaviorCodeCatalogs = (mapData.entityBehaviorCodeCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityBehaviorCodeCatalogs.push(catalog);

  const byRegion = new Map();
  for (const helper of catalog.helpers || []) {
    const regionId = helper.region?.id;
    if (!regionId) continue;
    if (!byRegion.has(regionId)) byRegion.set(regionId, []);
    byRegion.get(regionId).push(helper);
  }
  const annotatedRegions = [];
  for (const [regionId, helpers] of byRegion) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    const annotated = annotateRegion(region, helpers, catalog);
    if (annotated) annotatedRegions.push(annotated);
  }

  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_collision_fragment_internal_helper_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotatedRegions.length,
    },
    annotatedRegions,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (apply) {
    applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    id: catalog.id,
    summary: catalog.summary,
    helpers: catalog.helpers.map(helper => ({
      offset: helper.offset,
      role: helper.role,
      sourceCallCount: helper.actor26Link.sourceCallCount,
      fieldRefs: helper.fieldRefs,
      ramRefs: helper.ramRefs,
    })),
  }, null, 2));
}

main();
