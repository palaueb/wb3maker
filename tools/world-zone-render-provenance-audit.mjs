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
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-zone-render-provenance-catalog-2026-06-25';
const reportId = 'zone-render-provenance-audit-2026-06-25';
const toolName = 'tools/world-zone-render-provenance-audit.mjs';

const zoneRecipeCatalogId = 'world-zone-recipe-catalog-2026-06-25';
const dc2CatalogId = 'world-dc2-scroll-map-catalog-2026-06-25';
const tilePairCatalogId = 'world-dc2-tile-pair-lookup-catalog-2026-06-25';
const lookupOffset = 0x18000;
const lookupRecordStride = 8;
const nameTableColumns = 12;
const nameTableRows = 22;
const dc2RowsPerStreamForRecipeRender = 11;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function catalogById(mapData, id) {
  for (const key of ['roomDataCatalogs', 'tileSourceCatalogs', 'graphicsCatalogs']) {
    const found = (mapData[key] || []).find(item => item.id === id);
    if (found) return found;
  }
  return null;
}

function pushSample(list, value, limit = 12) {
  if (value != null && list.length < limit && !list.includes(value)) list.push(value);
}

function recordTile(provenance, tile, count, info) {
  if (!Number.isFinite(tile) || !Number.isFinite(count) || count <= 0) return;
  for (let i = 0; i < count; i++) {
    const slot = tile + i;
    if (slot < 0 || slot >= provenance.length) continue;
    const sourceStart = info.sourceStart == null ? null : info.sourceStart + i * 32;
    const sourceEndExclusive = sourceStart == null ? null : sourceStart + 32;
    const sourceInRange = info.status !== 'copy' ||
      (sourceStart != null && sourceEndExclusive <= info.romLength);
    const sourceRegion = sourceInRange && sourceStart != null
      ? findContainingRegion(info.mapData, sourceStart)
      : null;
    provenance[slot] = {
      status: sourceInRange ? info.status : 'unresolved',
      reason: sourceInRange ? '' : 'source-out-of-range',
      slot,
      loaderType: info.loaderType,
      loaderRegion: info.loaderRegion || null,
      loaderOffset: hex(info.loaderOffset),
      entryOffset: hex(info.entryOffset),
      entryIndex: info.entryIndex,
      sourceStart: sourceInRange && sourceStart != null ? hex(sourceStart) : null,
      sourceEndExclusive: sourceInRange && sourceEndExclusive != null ? hex(sourceEndExclusive) : null,
      sourceRegion: regionRef(sourceRegion),
    };
  }
}

function decodeLoader8fb(rom, mapData, scriptOffset, loaderRegion) {
  const provenance = new Array(0x4000 >> 5).fill(null);
  const entries = [];
  const warnings = [];
  let pc = scriptOffset;
  let entryIndex = 0;
  let curVramTile = 0;
  let curBank = 8;
  let curBlockIdx = 0;
  let terminated = false;

  while (pc + 4 < rom.length && entryIndex < 256) {
    const entryOffset = pc;
    const count = rom[pc++];
    if (count === 0) {
      terminated = true;
      break;
    }
    const vramLo = rom[pc++];
    const vramHi = rom[pc++];
    const srcLo = rom[pc++];
    const srcHi = rom[pc++];
    const vramWord = vramLo | (vramHi << 8);
    const sourceWord = srcLo | (srcHi << 8);
    if (vramWord !== 0xFFFF) curVramTile = vramWord;
    if (sourceWord !== 0xFFFF) {
      curBank = srcHi >> 1;
      curBlockIdx = ((srcHi & 1) << 8) | srcLo;
    }
    const sourceStart = curBank * 0x4000 + curBlockIdx * 32;
    const sourceEndExclusive = sourceStart + count * 32;
    if (sourceEndExclusive > rom.length) {
      warnings.push(`8FB entry ${entryIndex} source out of range ${hex(sourceStart)}-${hex(sourceEndExclusive - 1)}`);
    }
    recordTile(provenance, curVramTile, count, {
      mapData,
      status: 'copy',
      loaderType: 'vram_loader_8fb',
      loaderRegion,
      loaderOffset: scriptOffset,
      entryOffset,
      entryIndex,
      sourceStart,
      romLength: rom.length,
    });
    entries.push({
      entryIndex,
      entryOffset: hex(entryOffset),
      tileStart: curVramTile,
      tileEnd: curVramTile + count - 1,
      count,
      sourceStart,
      sourceEndExclusive,
    });
    curVramTile += count;
    curBlockIdx += count;
    entryIndex++;
  }

  if (!terminated) warnings.push(`8FB loader at ${hex(scriptOffset)} did not reach terminator inside audit limit`);
  return { provenance, entries, warnings, terminated };
}

function decodeLoader998(rom, mapData, scriptOffset, loaderRegion) {
  const provenance = new Array(0x4000 >> 5).fill(null);
  const entries = [];
  const warnings = [];
  let pc = scriptOffset;
  let entryIndex = 0;
  let vramPtr = 0;
  let terminated = false;

  while (pc < rom.length && entryIndex < 512) {
    const entryOffset = pc;
    const op = rom[pc++];
    if (op === 0) {
      terminated = true;
      break;
    }
    const count = op & 0x7F;
    let setTile = null;
    if (op & 0x80) {
      if (pc >= rom.length) {
        warnings.push(`998 entry ${entryIndex} truncated set-position at ${hex(entryOffset)}`);
        break;
      }
      setTile = rom[pc++];
      vramPtr = setTile * 32;
    }
    const tileStart = vramPtr >> 5;
    if (count === 0x7F) {
      recordTile(provenance, tileStart, 1, {
        mapData,
        status: 'zero',
        loaderType: 'vram_loader_998',
        loaderRegion,
        loaderOffset: scriptOffset,
        entryOffset,
        entryIndex,
        sourceStart: null,
        romLength: rom.length,
      });
      entries.push({
        entryIndex,
        entryOffset: hex(entryOffset),
        kind: 'zero',
        setTile,
        tileStart,
        tileEnd: tileStart,
        count: 1,
      });
      vramPtr += 32;
      entryIndex++;
      continue;
    }
    if (count === 0) {
      entries.push({
        entryIndex,
        entryOffset: hex(entryOffset),
        kind: 'noop',
        setTile,
        tileStart,
        tileEnd: tileStart - 1,
        count: 0,
      });
      entryIndex++;
      continue;
    }
    if (pc + 1 >= rom.length) {
      warnings.push(`998 entry ${entryIndex} truncated source at ${hex(entryOffset)}`);
      break;
    }
    const srcLo = rom[pc++];
    const srcHi = rom[pc++];
    const bank = srcHi >> 1;
    const blockIndex = ((srcHi & 1) << 8) | srcLo;
    const sourceStart = bank * 0x4000 + blockIndex * 32;
    const sourceEndExclusive = sourceStart + count * 32;
    if (sourceEndExclusive > rom.length) {
      warnings.push(`998 entry ${entryIndex} source out of range ${hex(sourceStart)}-${hex(sourceEndExclusive - 1)}`);
    }
    recordTile(provenance, tileStart, count, {
      mapData,
      status: 'copy',
      loaderType: 'vram_loader_998',
      loaderRegion,
      loaderOffset: scriptOffset,
      entryOffset,
      entryIndex,
      sourceStart,
      romLength: rom.length,
    });
    entries.push({
      entryIndex,
      entryOffset: hex(entryOffset),
      kind: 'copy',
      setTile,
      tileStart,
      tileEnd: tileStart + count - 1,
      count,
      sourceStart,
      sourceEndExclusive,
    });
    vramPtr += count * 32;
    entryIndex++;
  }

  if (!terminated) warnings.push(`998 loader at ${hex(scriptOffset)} did not reach terminator inside audit limit`);
  return { provenance, entries, warnings, terminated };
}

function mergeProvenance(primary, overlay) {
  const out = primary.slice();
  for (let i = 0; i < overlay.length; i++) {
    if (overlay[i]) out[i] = overlay[i];
  }
  return out;
}

function decodeDc2StreamValues(rom, offset) {
  const values = [];
  let pc = offset;
  while (pc < rom.length && values.length < 176) {
    const command = rom[pc++];
    if (command === 0xFF) {
      if (pc >= rom.length) break;
      const countOrTerminator = rom[pc++];
      if (countOrTerminator === 0xFF) break;
      if (pc >= rom.length) break;
      const value = rom[pc++];
      for (let i = 0; i < countOrTerminator && values.length < 176; i++) values.push(value);
      continue;
    }
    if (command >= 0xE3) {
      if (pc >= rom.length) break;
      const count = command - 0xE0;
      const value = rom[pc++];
      for (let i = 0; i < count && values.length < 176; i++) values.push(value);
      continue;
    }
    values.push(command);
  }
  return values;
}

function readNameTableWord(rom, lookupIndex, half, rowWord) {
  const offset = lookupOffset + lookupIndex * lookupRecordStride + half * 4 + rowWord * 2;
  if (offset + 1 >= rom.length) return null;
  return rom[offset] | (rom[offset + 1] << 8);
}

function tileSlotFromNameTableWord(word) {
  return (word & 0xFF) | ((word >> 8) & 0x01) << 8;
}

function buildUsedSlotsFromRecipe(rom, recipe) {
  const usedSlots = new Set();
  const lookupIndices = new Set();
  const warnings = [];

  for (const stream of recipe.dependencies?.dc2Streams || []) {
    if (!stream || stream.disabled) continue;
    const pair = stream.slot;
    const streamOffset = parseHex(stream.romOffset);
    if (pair == null || streamOffset == null || streamOffset < 0 || streamOffset >= rom.length) {
      warnings.push(`recipe ${recipe.id} has invalid DC2 stream ${stream.index || '?'} offset ${stream.romOffset || '?'}`);
      continue;
    }
    const values = decodeDc2StreamValues(rom, streamOffset);
    if (values.length < dc2RowsPerStreamForRecipeRender) {
      warnings.push(`recipe ${recipe.id} DC2 stream ${stream.index || '?'} decoded ${values.length} value(s), expected at least ${dc2RowsPerStreamForRecipeRender}`);
    }
    for (let row = 0; row < Math.min(values.length, dc2RowsPerStreamForRecipeRender); row++) {
      const lookupIndex = values[row];
      lookupIndices.add(lookupIndex);
      for (let half = 0; half < 2; half++) {
        for (let rowWord = 0; rowWord < 2; rowWord++) {
          const word = readNameTableWord(rom, lookupIndex, half, rowWord);
          if (word == null) {
            warnings.push(`lookup index ${hex(lookupIndex, 2)} out of range for recipe ${recipe.id}`);
            continue;
          }
          usedSlots.add(tileSlotFromNameTableWord(word));
        }
      }
    }
  }

  return {
    usedSlots: [...usedSlots].sort((a, b) => a - b),
    lookupIndices: [...lookupIndices].sort((a, b) => a - b),
    warnings,
  };
}

function sourceKey(prov) {
  const loader = prov.loaderRegion?.id || prov.loaderType || 'unknown_loader';
  const source = prov.sourceRegion?.id || prov.sourceStart || 'none';
  return `${prov.loaderType}|${loader}|${source}`;
}

function summarizeRecipe(rom, mapData, recipe) {
  const loader8fbOffset = parseHex(recipe.dependencies?.vramLoader8fb?.romOffset);
  const loader8fbRegion = recipe.dependencies?.vramLoader8fb?.region || null;
  const warnings = [];
  let provenance = new Array(0x4000 >> 5).fill(null);
  let loader8fbEntries = 0;
  let loader998Entries = 0;

  if (loader8fbOffset == null || loader8fbOffset < 0 || loader8fbOffset >= rom.length) {
    warnings.push(`invalid 8FB loader offset ${recipe.dependencies?.vramLoader8fb?.romOffset || '?'}`);
  } else {
    const decoded = decodeLoader8fb(rom, mapData, loader8fbOffset, loader8fbRegion);
    provenance = mergeProvenance(provenance, decoded.provenance);
    loader8fbEntries = decoded.entries.length;
    warnings.push(...decoded.warnings);
  }

  const extra998 = recipe.dependencies?.extra998 || null;
  if (extra998?.status === 'required') {
    const extraOffset = parseHex(extra998.romOffset);
    const extraRegion = extra998.regionId ? regionRef(findRegionById(mapData, extra998.regionId)) : null;
    if (extraOffset == null || extraOffset < 0 || extraOffset >= rom.length) {
      warnings.push(`invalid extra 998 loader offset ${extra998.romOffset || '?'}`);
    } else {
      const decoded = decodeLoader998(rom, mapData, extraOffset, extraRegion);
      provenance = mergeProvenance(provenance, decoded.provenance);
      loader998Entries = decoded.entries.length;
      warnings.push(...decoded.warnings);
    }
  }

  const nameTable = buildUsedSlotsFromRecipe(rom, recipe);
  warnings.push(...nameTable.warnings);
  const unresolvedSlots = [];
  const zeroSlots = [];
  const copySlots = [];
  const sourceCounts = new Map();
  for (const slot of nameTable.usedSlots) {
    const prov = provenance[slot];
    if (!prov || prov.status === 'unresolved') {
      unresolvedSlots.push(slot);
      continue;
    }
    if (prov.status === 'zero') {
      zeroSlots.push(slot);
      continue;
    }
    if (prov.status === 'copy') {
      copySlots.push(slot);
      const key = sourceKey(prov);
      const current = sourceCounts.get(key) || {
        loaderType: prov.loaderType,
        loaderRegion: prov.loaderRegion,
        sourceRegion: prov.sourceRegion,
        sourceStart: prov.sourceStart,
        slotCount: 0,
      };
      current.slotCount++;
      sourceCounts.set(key, current);
    }
  }

  return {
    recipeId: recipe.id,
    descriptorOffset: recipe.descriptor?.romOffset || null,
    subrecordOffset: recipe.subrecord?.romOffset || null,
    vramLoader8fbOffset: recipe.dependencies?.vramLoader8fb?.romOffset || null,
    extra998: extra998?.status === 'required' ? {
      regionId: extra998.regionId || null,
      romOffset: extra998.romOffset || null,
    } : null,
    audioRequestId: recipe.dependencies?.audioRequest?.requestId ?? null,
    audioRequestIdHex: recipe.dependencies?.audioRequest?.requestIdHex || null,
    audioRequestClassification: recipe.dependencies?.audioRequest?.taxonomy?.classification?.kind || null,
    lookupIndexCount: nameTable.lookupIndices.length,
    lookupIndexMin: nameTable.lookupIndices.length ? hex(nameTable.lookupIndices[0], 2) : null,
    lookupIndexMax: nameTable.lookupIndices.length ? hex(nameTable.lookupIndices[nameTable.lookupIndices.length - 1], 2) : null,
    loader8fbEntries,
    loader998Entries,
    usedSlotCount: nameTable.usedSlots.length,
    resolvedSlotCount: nameTable.usedSlots.length - unresolvedSlots.length,
    unresolvedSlotCount: unresolvedSlots.length,
    copySlotCount: copySlots.length,
    zeroSlotCount: zeroSlots.length,
    unresolvedSlotsSample: unresolvedSlots.slice(0, 24).map(slot => hex(slot, 3)),
    usedSlotsSample: nameTable.usedSlots.slice(0, 24).map(slot => hex(slot, 3)),
    sourceGroups: [...sourceCounts.values()]
      .sort((a, b) => b.slotCount - a.slotCount)
      .slice(0, 16),
    warningCount: warnings.length,
    warnings: warnings.slice(0, 16),
  };
}

function aggregateRecipeSummaries(summaries) {
  const unresolvedSlotUsage = new Map();
  const sourceGroupUsage = new Map();
  const audioRequestUsage = new Map();
  let totalUsedSlots = 0;
  let totalResolvedSlots = 0;
  let totalUnresolvedSlots = 0;
  let maxUnresolvedSlots = 0;
  let warningRecipeCount = 0;

  for (const summary of summaries) {
    totalUsedSlots += summary.usedSlotCount;
    totalResolvedSlots += summary.resolvedSlotCount;
    totalUnresolvedSlots += summary.unresolvedSlotCount;
    maxUnresolvedSlots = Math.max(maxUnresolvedSlots, summary.unresolvedSlotCount);
    if (summary.warningCount) warningRecipeCount++;
    for (const slotHex of summary.unresolvedSlotsSample) {
      const entry = unresolvedSlotUsage.get(slotHex) || { slot: slotHex, recipeCount: 0, sampleRecipeIds: [] };
      entry.recipeCount++;
      pushSample(entry.sampleRecipeIds, summary.recipeId);
      unresolvedSlotUsage.set(slotHex, entry);
    }
    for (const group of summary.sourceGroups) {
      const key = `${group.loaderType}|${group.loaderRegion?.id || ''}|${group.sourceRegion?.id || group.sourceStart || ''}`;
      const entry = sourceGroupUsage.get(key) || {
        loaderType: group.loaderType,
        loaderRegion: group.loaderRegion,
        sourceRegion: group.sourceRegion,
        sourceStart: group.sourceStart,
        recipeCount: 0,
        slotCount: 0,
        sampleRecipeIds: [],
      };
      entry.recipeCount++;
      entry.slotCount += group.slotCount;
      pushSample(entry.sampleRecipeIds, summary.recipeId);
      sourceGroupUsage.set(key, entry);
    }
    if (summary.audioRequestId != null) {
      const key = summary.audioRequestId;
      const entry = audioRequestUsage.get(key) || {
        requestId: summary.audioRequestId,
        requestIdHex: summary.audioRequestIdHex,
        classification: summary.audioRequestClassification,
        recipeCount: 0,
        unresolvedRecipeCount: 0,
        unresolvedSlotCount: 0,
      };
      entry.recipeCount++;
      if (summary.unresolvedSlotCount) entry.unresolvedRecipeCount++;
      entry.unresolvedSlotCount += summary.unresolvedSlotCount;
      audioRequestUsage.set(key, entry);
    }
  }

  return {
    recipeCount: summaries.length,
    fullyResolvedRecipeCount: summaries.filter(summary => summary.unresolvedSlotCount === 0).length,
    unresolvedRecipeCount: summaries.filter(summary => summary.unresolvedSlotCount > 0).length,
    warningRecipeCount,
    totalUsedSlots,
    totalResolvedSlots,
    totalUnresolvedSlots,
    maxUnresolvedSlots,
    avgUsedSlotsPerRecipe: summaries.length ? Number((totalUsedSlots / summaries.length).toFixed(2)) : 0,
    avgUnresolvedSlotsPerRecipe: summaries.length ? Number((totalUnresolvedSlots / summaries.length).toFixed(2)) : 0,
    unresolvedSlotUsage: [...unresolvedSlotUsage.values()].sort((a, b) => b.recipeCount - a.recipeCount),
    sourceGroupUsage: [...sourceGroupUsage.values()].sort((a, b) => b.slotCount - a.slotCount),
    audioRequestUsage: [...audioRequestUsage.values()].sort((a, b) => a.requestId - b.requestId),
  };
}

function compactRecipeSummary(summary) {
  return {
    recipeId: summary.recipeId,
    descriptorOffset: summary.descriptorOffset,
    subrecordOffset: summary.subrecordOffset,
    vramLoader8fbOffset: summary.vramLoader8fbOffset,
    extra998: summary.extra998,
    audioRequestId: summary.audioRequestId,
    audioRequestIdHex: summary.audioRequestIdHex,
    audioRequestClassification: summary.audioRequestClassification,
    lookupIndexCount: summary.lookupIndexCount,
    lookupIndexMin: summary.lookupIndexMin,
    lookupIndexMax: summary.lookupIndexMax,
    loader8fbEntries: summary.loader8fbEntries,
    loader998Entries: summary.loader998Entries,
    usedSlotCount: summary.usedSlotCount,
    resolvedSlotCount: summary.resolvedSlotCount,
    unresolvedSlotCount: summary.unresolvedSlotCount,
    copySlotCount: summary.copySlotCount,
    zeroSlotCount: summary.zeroSlotCount,
    unresolvedSlotsSample: summary.unresolvedSlotsSample,
    usedSlotsSample: summary.usedSlotsSample,
    sourceGroups: summary.sourceGroups,
    warningCount: summary.warningCount,
    warnings: summary.warnings,
  };
}

function buildCatalog(rom, mapData) {
  const zoneRecipeCatalog = catalogById(mapData, zoneRecipeCatalogId);
  const dc2Catalog = catalogById(mapData, dc2CatalogId);
  const tilePairCatalog = catalogById(mapData, tilePairCatalogId);
  const recipes = mapData.zoneRecipes || [];
  const summaries = recipes.map(recipe => summarizeRecipe(rom, mapData, recipe));
  const aggregate = aggregateRecipeSummaries(summaries);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      zoneRecipeCatalogId,
      dc2CatalogId,
      tilePairCatalogId,
    ],
    sourceCatalogPresence: {
      zoneRecipeCatalog: Boolean(zoneRecipeCatalog),
      dc2Catalog: Boolean(dc2Catalog),
      tilePairCatalog: Boolean(tilePairCatalog),
    },
    renderModel: {
      kind: 'metadata_only_zone_recipe_render_provenance',
      vramLoadOrder: ['dependencies.vramLoader8fb', 'dependencies.extra998 when required'],
      nameTableSource: 'dependencies.dc2Streams + _DATA_18000_ tile-pair lookup',
      columns: nameTableColumns,
      rows: nameTableRows,
      dc2ValuesPerStream: dc2RowsPerStreamForRecipeRender,
      tileSlotDerivation: 'SMS name-table tile id = low byte plus bit0 of high byte',
    },
    summary: {
      recipeCount: aggregate.recipeCount,
      fullyResolvedRecipeCount: aggregate.fullyResolvedRecipeCount,
      unresolvedRecipeCount: aggregate.unresolvedRecipeCount,
      warningRecipeCount: aggregate.warningRecipeCount,
      totalUsedSlots: aggregate.totalUsedSlots,
      totalResolvedSlots: aggregate.totalResolvedSlots,
      totalUnresolvedSlots: aggregate.totalUnresolvedSlots,
      maxUnresolvedSlots: aggregate.maxUnresolvedSlots,
      avgUsedSlotsPerRecipe: aggregate.avgUsedSlotsPerRecipe,
      avgUnresolvedSlotsPerRecipe: aggregate.avgUnresolvedSlotsPerRecipe,
      distinctUnresolvedSlotSampleCount: aggregate.unresolvedSlotUsage.length,
      sourceGroupCount: aggregate.sourceGroupUsage.length,
      audioRequestUsageCount: aggregate.audioRequestUsage.length,
      assetPolicy: 'Metadata only: recipe ids, offsets, loader entry counts, tile-slot ids/counts, source region ids, and aggregate provenance. No ROM bytes, decoded name tables, graphics, audio, or rendered assets are embedded.',
    },
    recipeSummaries: summaries.map(compactRecipeSummary),
    unresolvedSlotUsage: aggregate.unresolvedSlotUsage.slice(0, 96),
    sourceGroupUsage: aggregate.sourceGroupUsage.slice(0, 128),
    audioRequestUsage: aggregate.audioRequestUsage,
    evidence: [
      'Zone recipes supply the 8FB loader, optional 998 loader, DC2 streams, and _DATA_18000_ lookup dependency for each descriptor.',
      'The 8FB and 998 loader semantics match the analyzer simulator implementation and the mapped _LABEL_8FB_/_LABEL_998_ routines.',
      'ASM-backed DC2 and tile-pair lookup catalogs identify _DATA_14000_ stream pointers and _DATA_18000_ 8-byte name-table word records.',
      'The audit records only tile-slot provenance metadata and aggregate counts; it does not store copied tile bytes, decoded lookup words, or rendered images.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRecipeCount = (mapData.zoneRecipes || []).length;
  const summaryByRecipe = new Map(catalog.recipeSummaries.map(summary => [summary.recipeId, summary]));
  for (const recipe of mapData.zoneRecipes || []) {
    const summary = summaryByRecipe.get(recipe.id);
    if (!summary) continue;
    recipe.renderProvenance = {
      catalogId,
      confidence: summary.warningCount ? 'medium' : 'high',
      usedSlotCount: summary.usedSlotCount,
      resolvedSlotCount: summary.resolvedSlotCount,
      unresolvedSlotCount: summary.unresolvedSlotCount,
      copySlotCount: summary.copySlotCount,
      zeroSlotCount: summary.zeroSlotCount,
      unresolvedSlotsSample: summary.unresolvedSlotsSample,
      sourceGroups: summary.sourceGroups.slice(0, 8),
      warningCount: summary.warningCount,
      generatedAt: now,
      tool: toolName,
    };
  }

  const annotatedLoaderRegions = [];
  const loaderUsage = new Map();
  for (const summary of catalog.recipeSummaries) {
    const offsets = [summary.vramLoader8fbOffset, summary.extra998?.romOffset].filter(Boolean);
    for (const offsetText of offsets) {
      const offset = parseHex(offsetText);
      const region = offset == null ? null : findContainingRegion(mapData, offset);
      if (!region) continue;
      const entry = loaderUsage.get(region.id) || { region, recipeCount: 0, sampleRecipeIds: [] };
      entry.recipeCount++;
      pushSample(entry.sampleRecipeIds, summary.recipeId);
      loaderUsage.set(region.id, entry);
    }
  }

  for (const { region, recipeCount, sampleRecipeIds } of loaderUsage.values()) {
    region.analysis = region.analysis || {};
    region.analysis.zoneRenderProvenanceAudit = {
      catalogId,
      kind: 'zone_render_vram_loader_source',
      confidence: 'high',
      summary: 'This VRAM loader contributes tile-slot provenance to generated room zone render recipes.',
      recipeCount,
      sampleRecipeIds,
      evidence: [
        'Zone recipes reference this loader through the room subrecord 8FB pointer or the flags-selected 998 dependency.',
        'The render provenance audit tracks only loader offsets, tile slot ids/counts, source regions, and unresolved-slot counts.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedLoaderRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      recipeCount,
    });
  }

  return {
    annotatedRecipeCount,
    annotatedLoaderRegions,
  };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  let annotation = { annotatedRecipeCount: 0, annotatedLoaderRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    const finalCatalog = buildCatalog(rom, mapData);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_render_provenance_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: finalCatalog.sourceCatalogs,
      sourceCatalogPresence: finalCatalog.sourceCatalogPresence,
      renderModel: finalCatalog.renderModel,
      summary: {
        ...finalCatalog.summary,
        annotatedRecipeCount: annotation.annotatedRecipeCount,
        annotatedLoaderRegionCount: annotation.annotatedLoaderRegions.length,
      },
      unresolvedSlotUsage: finalCatalog.unresolvedSlotUsage,
      sourceGroupUsage: finalCatalog.sourceGroupUsage.slice(0, 48),
      audioRequestUsage: finalCatalog.audioRequestUsage,
      recipeSamples: finalCatalog.recipeSummaries.slice(0, 24),
      annotatedLoaderRegions: annotation.annotatedLoaderRegions,
      evidence: finalCatalog.evidence,
      nextLeads: [
        'Investigate recipes with unresolved tile slots and determine whether an additional common room/scene loader is missing from the recipe model.',
        'Compare unresolved slot patterns against screen_prog/sceneRecipes to identify shared HUD/status/tilebank dependencies.',
        'Use sourceGroupUsage to verify which graphics banks are actually needed by each room zone before extracting reusable engine modules.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRecipeCount: annotation.annotatedRecipeCount,
      annotatedLoaderRegionCount: annotation.annotatedLoaderRegions.length,
    },
    firstRecipes: catalog.recipeSummaries.slice(0, 5).map(summary => ({
      recipeId: summary.recipeId,
      descriptorOffset: summary.descriptorOffset,
      usedSlotCount: summary.usedSlotCount,
      resolvedSlotCount: summary.resolvedSlotCount,
      unresolvedSlotCount: summary.unresolvedSlotCount,
      unresolvedSlotsSample: summary.unresolvedSlotsSample,
      sourceGroupCount: summary.sourceGroups.length,
      warningCount: summary.warningCount,
    })),
  }, null, 2));
}

main();
