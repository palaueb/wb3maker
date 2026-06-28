#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-zone-recipe-event-table-link-audit.mjs';
const catalogId = 'world-zone-recipe-event-table-link-catalog-2026-06-26';
const reportId = 'zone-recipe-event-table-link-audit-2026-06-26';
const schemaVersion = 1;

const roomEventTableCatalogId = 'world-room-event-table-catalog-2026-06-26';
const zoneGraphId = 'world-zone-graph-2026-06-24';
const bank4 = 4;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value.replace(/^\$/, '0x'), 16);
  return NaN;
}

function readWordLE(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function bankedZ80ToRomOffset(bank, z80Address) {
  if (z80Address < 0x8000 || z80Address > 0xBFFF) return null;
  return bank * 0x4000 + (z80Address - 0x8000);
}

function regionStart(region) {
  return parseHex(region.offset);
}

function regionEnd(region) {
  return regionStart(region) + Number(region.size || 0);
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function findContainingRegion(mapData, offset) {
  if (!Number.isFinite(offset)) return null;
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0)
      || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function compactDecodedTable(decoded) {
  if (!decoded) return null;
  return {
    byteLength: decoded.byteLength,
    recordCount: decoded.recordCount,
    terminated: decoded.terminated,
    terminatorOffset: decoded.terminatorOffset,
    recordKindCounts: decoded.recordKindCounts || {},
    selectorOutcomeCounts: decoded.selectorOutcomeCounts || {},
    knownD025ValueStats: decoded.knownD025ValueStats || null,
    warningCount: (decoded.warnings || []).length,
  };
}

function tableByOffset(roomEventTableCatalog) {
  const map = new Map();
  for (const table of roomEventTableCatalog.eventTables || []) {
    if (table.eventTableRomOffset) map.set(table.eventTableRomOffset.toUpperCase(), table);
  }
  return map;
}

function buildDependency(mapData, rom, roomEventTableCatalog, recipe) {
  const subrecordOffset = parseHex(recipe.subrecord?.romOffset);
  if (!Number.isFinite(subrecordOffset)) {
    return {
      kind: 'room_event_table',
      status: 'missing_subrecord_offset',
      catalogId: roomEventTableCatalogId,
      source: 'room subrecord +2/+3 copied to _RAM_CF60_ by _LABEL_26F4_',
    };
  }
  const z80Pointer = readWordLE(rom, subrecordOffset + 2);
  const romOffset = bankedZ80ToRomOffset(bank4, z80Pointer);
  const romOffsetHex = romOffset == null ? null : hex(romOffset);
  const eventTablesByOffset = tableByOffset(roomEventTableCatalog);
  const table = romOffsetHex ? eventTablesByOffset.get(romOffsetHex.toUpperCase()) || null : null;
  const decoded = compactDecodedTable(table?.decoded || null);
  return {
    kind: 'room_event_table',
    status: table ? 'resolved' : 'unresolved',
    catalogId: roomEventTableCatalogId,
    source: 'room subrecord +2/+3 copied to _RAM_CF60_ by _LABEL_26F4_; _LABEL_635D_ scans this table in bank 4.',
    z80Pointer: hex(z80Pointer, 4),
    romOffset: romOffsetHex,
    region: romOffset == null ? null : compactRegion(findContainingRegion(mapData, romOffset)),
    decoded,
    hasRecords: Boolean(decoded?.recordCount),
    confidence: table?.confidence || (romOffset == null ? 'low' : 'medium'),
  };
}

function withRoomEventDependency(recipe, dependency) {
  const next = {
    ...recipe,
    dependencies: {
      ...(recipe.dependencies || {}),
      roomEventTable: dependency,
    },
    catalogRefs: {
      ...(recipe.catalogRefs || {}),
      roomEventTableCatalogId,
    },
  };
  const runtimePipeline = Array.isArray(recipe.runtimePipeline) ? recipe.runtimePipeline.slice() : [];
  const filtered = runtimePipeline.filter(step => step.kind !== 'room_event_table');
  filtered.push({
    order: filtered.length,
    kind: 'room_event_table',
    source: 'room subrecord +2/+3 -> _RAM_CF60_',
    consumer: '_LABEL_635D_',
    dependency: 'dependencies.roomEventTable',
  });
  next.runtimePipeline = filtered;
  return next;
}

function buildCatalog(mapData, recipes, linkedRecipes, roomEventTableCatalog) {
  const deps = linkedRecipes.map(recipe => recipe.dependencies?.roomEventTable).filter(Boolean);
  const resolved = deps.filter(dep => dep.status === 'resolved');
  const nonEmpty = resolved.filter(dep => dep.hasRecords);
  const uniqueOffsets = [...new Set(resolved.map(dep => dep.romOffset).filter(Boolean))].sort();
  const usageByOffset = uniqueOffsets.map(offset => {
    const matching = linkedRecipes.filter(recipe => recipe.dependencies?.roomEventTable?.romOffset === offset);
    const sample = matching[0]?.dependencies?.roomEventTable || null;
    return {
      eventTableRomOffset: offset,
      recipeCount: matching.length,
      descriptorSamples: matching.slice(0, 12).map(recipe => recipe.descriptor?.romOffset).filter(Boolean),
      subrecordSamples: [...new Set(matching.map(recipe => recipe.subrecord?.romOffset).filter(Boolean))].slice(0, 12),
      recordCount: sample?.decoded?.recordCount ?? null,
      recordKindCounts: sample?.decoded?.recordKindCounts || {},
      selectorOutcomeCounts: sample?.decoded?.selectorOutcomeCounts || {},
      hasRecords: Boolean(sample?.hasRecords),
    };
  });

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [roomEventTableCatalogId, zoneGraphId],
    summary: {
      recipeCount: recipes.length,
      linkedRecipeCount: linkedRecipes.length,
      resolvedRoomEventTableRecipeCount: resolved.length,
      unresolvedRoomEventTableRecipeCount: deps.length - resolved.length,
      recipesWithNonEmptyEventTable: nonEmpty.length,
      recipesWithEmptyEventTable: resolved.length - nonEmpty.length,
      uniqueEventTableCount: uniqueOffsets.length,
      uniqueNonEmptyEventTableCount: new Set(nonEmpty.map(dep => dep.romOffset)).size,
      totalUniqueEventRecords: (roomEventTableCatalog.eventTables || [])
        .reduce((sum, table) => sum + Number(table.decoded?.recordCount || 0), 0),
      totalRecipeReferencedEventRecords: resolved
        .reduce((sum, dep) => sum + Number(dep.decoded?.recordCount || 0), 0),
      dependencyStatusCounts: countBy(deps, dep => dep.status),
      eventTableRegionCounts: countBy(resolved, dep => dep.region?.id || 'unknown'),
      eventTableRecordKindUsage: countBy(resolved.flatMap(dep => {
        const entries = [];
        for (const [kind, count] of Object.entries(dep.decoded?.recordKindCounts || {})) {
          for (let i = 0; i < count; i++) entries.push(kind);
        }
        return entries;
      }), item => item),
      assetPolicy: 'Metadata only: recipe ids, subrecord offsets, event-table pointers, table counts, selector outcome counts, region ids, and catalog references. Event coordinate bytes, object byte lists, payload bytes, graphics, audio, screenshots, and decoded room assets are not embedded.',
    },
    usageByOffset,
    recipeSamples: linkedRecipes.slice(0, 24).map(recipe => ({
      recipeId: recipe.id,
      descriptorOffset: recipe.descriptor?.romOffset || null,
      subrecordOffset: recipe.subrecord?.romOffset || null,
      roomEventTable: recipe.dependencies?.roomEventTable || null,
    })),
    evidence: [
      'world-room-event-table-catalog-2026-06-26 proves _LABEL_26F4_ copies room subrecord bytes +2/+3 into _RAM_CF60_ and _LABEL_635D_ consumes the pointed table.',
      'Each zone recipe already has a descriptor subrecord offset; this audit reads only that pointer field and stores a compact dependency reference.',
      'The dependency stores table offsets, counts, classifications, and catalog links only; it omits event coordinate bytes, object byte lists, and payload bytes.',
    ],
    nextLeads: [
      'Expose dependencies.roomEventTable in the analyzer zone recipe diagnostics panel.',
      'Use the roomEventTable dependency when simulating item/reward object VRAM provenance for accepted _RAM_D025_ selector outcomes.',
      'Trace _LABEL_635D_ caller inputs to label event table key bytes before any coordinate preview is added.',
    ],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const recipes = mapData.zoneRecipes || [];
  const roomEventTableCatalog = findCatalog(mapData, roomEventTableCatalogId);
  if (!roomEventTableCatalog) {
    console.error(`Missing required catalog ${roomEventTableCatalogId}; run tools/world-room-event-table-audit.mjs first.`);
    process.exit(1);
  }

  const linkedRecipes = recipes.map(recipe => withRoomEventDependency(
    recipe,
    buildDependency(mapData, rom, roomEventTableCatalog, recipe)
  ));
  const catalog = buildCatalog(mapData, recipes, linkedRecipes, roomEventTableCatalog);

  if (apply) {
    mapData.zoneRecipes = linkedRecipes;
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_recipe_event_table_link_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      usageByOffset: catalog.usageByOffset,
      recipeSamples: catalog.recipeSamples.slice(0, 12),
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    firstRecipes: catalog.recipeSamples.slice(0, 5),
  }, null, 2));
}

main();
