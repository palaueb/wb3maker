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
const catalogId = 'world-sprite-palette-entry-scene-catalog-2026-06-25';
const reportId = 'sprite-palette-entry-scene-audit-2026-06-25';
const toolName = 'tools/world-sprite-palette-entry-scene-audit.mjs';

const spritePaletteInheritanceCatalogId = 'world-sprite-palette-inheritance-catalog-2026-06-25';
const common8fbOffset = 0x02A55;
const common998Offset = 0x02AE2;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  return parseInt(value.replace(/^0x/i, ''), 16);
}

function offsetOf(region) {
  return parseOffset(region.offset);
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
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

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function entryIdFor(initializerPath) {
  const label = initializerPath.caller?.label || 'unknown';
  return `sprite_palette_entry_scene_${label.replace(/^_LABEL_|_$/g, '')}_${initializerPath.paletteLoaderCallLine}`;
}

function buildEntryRecipe(mapData, initializerPath) {
  const common8fbRegion = regionRef(findExactRegion(mapData, common8fbOffset) || findContainingRegion(mapData, common8fbOffset));
  const common998Region = regionRef(findExactRegion(mapData, common998Offset) || findContainingRegion(mapData, common998Offset));
  return {
    id: entryIdFor(initializerPath),
    schemaVersion: 1,
    recipeType: 'sprite_palette_entry_scene_prereq',
    sourceInitializerPathId: initializerPath.id,
    caller: initializerPath.caller,
    confidence: initializerPath.confidence || 'high',
    stateEffects: {
      bgPalette: {
        status: 'preserve_existing',
        indexSentinel: '0xFF',
        ram: '_RAM_CFF5_',
      },
      spritePalette: {
        status: 'set_direct_index',
        index: initializerPath.spriteIndex,
        indexHex: hex(initializerPath.spriteIndex || 0, 2),
        ram: '_RAM_CFF6_',
        sourceHL: initializerPath.rawHL,
      },
    },
    steps: [
      {
        order: 0,
        kind: 'palette_state_write',
        routine: '_LABEL_8B2_',
        routineOffset: '0x008B2',
        sourceLine: initializerPath.sourceLine,
        callLine: initializerPath.paletteLoaderCallLine,
        rawHL: initializerPath.rawHL,
        bgState: initializerPath.bgState,
        bgIndex: initializerPath.bgIndex,
        spriteState: initializerPath.spriteState,
        spriteIndex: initializerPath.spriteIndex,
        effect: 'Set _RAM_CFF6_ to sprite palette index 1 while preserving _RAM_CFF5_.',
      },
      {
        order: 1,
        kind: 'vram_loader_8fb',
        routine: '_LABEL_8FB_',
        sourceLabel: '_DATA_2A55_',
        romOffset: hex(common8fbOffset),
        region: common8fbRegion,
        effect: 'Load the shared room-entry tile prerequisite immediately after the sprite palette initializer.',
      },
      {
        order: 2,
        kind: 'vram_loader_998',
        routine: '_LABEL_998_',
        sourceLabel: '_DATA_2AE2_',
        romOffset: hex(common998Offset),
        region: common998Region,
        effect: 'Load the shared room-entry dynamic tile prerequisite immediately before the room descriptor is consumed.',
      },
    ],
    coveredRoomLoads: initializerPath.coveredRoomLoadCallsiteIds.map((callsiteId, index) => ({
      callsiteId,
      callLine: initializerPath.coveredRoomLoadCallLines[index],
    })),
    evidence: [
      ...initializerPath.evidence,
      `ASM lines ${initializerPath.paletteLoaderCallLine + 1}-${initializerPath.paletteLoaderCallLine + 4} load _DATA_2A55_ through _LABEL_8FB_ and _DATA_2AE2_ through _LABEL_998_ before the covered room load(s).`,
      'world-sprite-palette-inheritance-catalog-2026-06-25 confirms these direct initializer paths precede _LABEL_2620_ calls.',
    ],
    assetPolicy: 'Metadata only: ASM labels, line numbers, offsets, palette indexes, loader labels, region refs, and callsite ids. No ROM bytes, decoded palettes, graphics, or rendered assets are embedded.',
  };
}

function buildCatalog(mapData) {
  const spriteCatalog = findCatalog(mapData, spritePaletteInheritanceCatalogId);
  const initializerPaths = spriteCatalog?.directInitializerPaths || [];
  const entryRecipes = initializerPaths.map(pathEntry => buildEntryRecipe(mapData, pathEntry));
  const uniqueSpriteIndexes = [...new Set(entryRecipes
    .map(recipe => recipe.stateEffects.spritePalette.index)
    .filter(index => index != null))]
    .sort((a, b) => a - b);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [spritePaletteInheritanceCatalogId],
    summary: {
      entryRecipeCount: entryRecipes.length,
      directInitializerPathCount: initializerPaths.length,
      coveredRoomLoadCallsiteCount: entryRecipes.reduce((sum, recipe) => sum + recipe.coveredRoomLoads.length, 0),
      uniqueSpritePaletteIndexes: uniqueSpriteIndexes,
      commonVram8fbOffset: hex(common8fbOffset),
      commonVram998Offset: hex(common998Offset),
      confidence: entryRecipes.length === initializerPaths.length && entryRecipes.length > 0 ? 'high' : 'low',
      assetPolicy: 'Metadata only: entry recipe ids, routine labels, offsets, palette indexes, loader labels, region ids, and callsite ids. No ROM bytes, decoded palettes, graphics, or rendered assets are embedded.',
    },
    entryRecipes,
    evidence: [
      'The source sprite-palette inheritance catalog identifies three direct initializer paths that load HL=$01FF before _LABEL_8B2_.',
      'Each direct initializer path immediately calls _LABEL_8FB_ with _DATA_2A55_ and _LABEL_998_ with _DATA_2AE2_ before the covered _LABEL_2620_ room load(s).',
      'These entry recipes model reusable pre-room state only; full room rendering remains represented by zoneRecipes and inlineTransitionRecipes.',
    ],
    nextLeads: [
      'Connect entryRecipes to concrete zoneRecipes once the trigger path to each room descriptor is known.',
      'Teach the zone renderer to optionally seed CRAM/VRAM from an entry recipe before applying room recipes.',
      'Trace whether non-entry transition paths ever set _RAM_CFF6_ to a sprite palette index other than 1.',
    ],
  };
}

function annotateRegions(mapData, catalog) {
  const annotated = [];
  const regionIds = new Set();
  for (const recipe of catalog.entryRecipes) {
    for (const region of [recipe.caller?.region, ...recipe.steps.map(step => step.region).filter(Boolean)]) {
      if (!region?.id || regionIds.has(region.id)) continue;
      const target = (mapData.regions || []).find(item => item.id === region.id);
      if (!target) continue;
      target.analysis = target.analysis || {};
      target.analysis.spritePaletteEntryScene = {
        catalogId,
        confidence: 'high',
        role: region.id === recipe.caller?.region?.id ? 'entry_routine' : 'entry_prereq_loader',
        evidence: catalog.evidence,
        generatedAt: now,
        tool: toolName,
      };
      regionIds.add(region.id);
      annotated.push(regionRef(target));
    }
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let annotatedRegions = [];

  if (apply) {
    annotatedRegions = annotateRegions(mapData, catalog);
    mapData.sceneRecipeCatalogs = (mapData.sceneRecipeCatalogs || []).filter(item => item.id !== catalogId);
    mapData.sceneRecipeCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'sprite_palette_entry_scene_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      entryRecipeSamples: catalog.entryRecipes,
      annotatedRegions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotatedRegions.length,
    },
    entryRecipes: catalog.entryRecipes.map(recipe => ({
      id: recipe.id,
      caller: recipe.caller?.label,
      spritePaletteIndex: recipe.stateEffects.spritePalette.index,
      common8fb: recipe.steps.find(step => step.kind === 'vram_loader_8fb')?.region,
      common998: recipe.steps.find(step => step.kind === 'vram_loader_998')?.region,
      coveredRoomLoads: recipe.coveredRoomLoads,
    })),
  }, null, 2));
}

main();
