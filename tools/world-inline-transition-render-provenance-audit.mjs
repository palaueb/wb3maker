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
const catalogId = 'world-inline-transition-render-provenance-catalog-2026-06-25';
const reportId = 'inline-transition-render-provenance-audit-2026-06-25';
const toolName = 'tools/world-inline-transition-render-provenance-audit.mjs';

const inlineRecipeCatalogId = 'world-inline-transition-recipe-catalog-2026-06-25';
const zoneBaselineCatalogId = 'world-zone-render-provenance-catalog-2026-06-25';
const zoneCommonPrereqCatalogId = 'world-zone-common-prereq-provenance-catalog-2026-06-25';
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
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
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
      stepRole: info.stepRole || 'recipe_dependency',
      stepLabel: info.stepLabel || null,
      stepConfidence: info.stepConfidence || null,
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

function decodeLoader8fb(rom, mapData, scriptOffset, loaderRegion, stepInfo = {}) {
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
      ...stepInfo,
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

function decodeLoader998(rom, mapData, scriptOffset, loaderRegion, stepInfo = {}) {
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
        ...stepInfo,
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
      ...stepInfo,
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
  return `${prov.stepRole || ''}|${prov.loaderType}|${loader}|${source}`;
}

function buildCommonPrereqSteps(mapData, catalog) {
  const warnings = [];
  const steps = [];
  for (const step of catalog?.prerequisiteSteps || []) {
    const offset = parseHex(step.romOffset);
    if (offset == null) {
      warnings.push(`common prerequisite ${step.label || '?'} missing ROM offset`);
      continue;
    }
    steps.push({
      label: step.label || step.region?.name || step.region?.id || hex(offset),
      loaderType: step.loaderType,
      romOffset: step.romOffset,
      offset,
      region: step.region || regionRef(findContainingRegion(mapData, offset)),
      confidence: step.confidence || 'medium',
      evidence: step.evidence || [],
    });
  }
  return { steps, warnings };
}

function applyLoaderStep(rom, mapData, provenance, step, warnings, entryCounts) {
  const stepInfo = {
    stepRole: step.stepRole || 'recipe_dependency',
    stepLabel: step.label || null,
    stepConfidence: step.confidence || null,
  };
  const region = step.region || regionRef(findContainingRegion(mapData, step.offset));
  if (step.loaderType === 'vram_loader_8fb') {
    const decoded = decodeLoader8fb(rom, mapData, step.offset, region, stepInfo);
    warnings.push(...decoded.warnings);
    entryCounts.loader8fb += decoded.entries.length;
    if (stepInfo.stepRole === 'common_prerequisite') entryCounts.common8fb += decoded.entries.length;
    else entryCounts.recipe8fb += decoded.entries.length;
    return mergeProvenance(provenance, decoded.provenance);
  }
  if (step.loaderType === 'vram_loader_998') {
    const decoded = decodeLoader998(rom, mapData, step.offset, region, stepInfo);
    warnings.push(...decoded.warnings);
    entryCounts.loader998 += decoded.entries.length;
    if (stepInfo.stepRole === 'common_prerequisite') entryCounts.common998 += decoded.entries.length;
    else entryCounts.recipe998 += decoded.entries.length;
    return mergeProvenance(provenance, decoded.provenance);
  }
  warnings.push(`unsupported loader type ${step.loaderType || '?'} at ${step.romOffset || '?'}`);
  return provenance;
}

function recipeLoaderSteps(mapData, recipe) {
  const steps = [];
  const loader8fbOffset = parseHex(recipe.dependencies?.vramLoader8fb?.romOffset);
  if (loader8fbOffset != null) {
    steps.push({
      label: recipe.dependencies?.vramLoader8fb?.z80Pointer || 'recipe 8FB',
      loaderType: 'vram_loader_8fb',
      romOffset: recipe.dependencies?.vramLoader8fb?.romOffset,
      offset: loader8fbOffset,
      region: recipe.dependencies?.vramLoader8fb?.region || regionRef(findContainingRegion(mapData, loader8fbOffset)),
      confidence: recipe.dependencies?.vramLoader8fb?.valid ? 'high' : 'medium',
      stepRole: 'recipe_dependency',
    });
  }
  const extra998 = recipe.dependencies?.extra998 || null;
  if (extra998?.status === 'required') {
    const extraOffset = parseHex(extra998.romOffset);
    if (extraOffset != null) {
      steps.push({
        label: extra998.sourceLabel || extra998.regionId || 'recipe 998',
        loaderType: 'vram_loader_998',
        romOffset: extra998.romOffset,
        offset: extraOffset,
        region: extra998.regionId ? regionRef(findRegionById(mapData, extra998.regionId)) : regionRef(findContainingRegion(mapData, extraOffset)),
        confidence: 'high',
        stepRole: 'recipe_dependency',
      });
    }
  }
  return steps;
}

function summarizeRecipe(rom, mapData, recipe, commonPrereqSteps) {
  const warnings = [];
  let provenance = new Array(0x4000 >> 5).fill(null);
  const entryCounts = {
    loader8fb: 0,
    loader998: 0,
    common8fb: 0,
    common998: 0,
    recipe8fb: 0,
    recipe998: 0,
  };

  for (const step of commonPrereqSteps) {
    provenance = applyLoaderStep(rom, mapData, provenance, {
      ...step,
      stepRole: 'common_prerequisite',
    }, warnings, entryCounts);
  }
  for (const step of recipeLoaderSteps(mapData, recipe)) {
    provenance = applyLoaderStep(rom, mapData, provenance, step, warnings, entryCounts);
  }

  const nameTable = buildUsedSlotsFromRecipe(rom, recipe);
  warnings.push(...nameTable.warnings);
  const unresolvedSlots = [];
  const zeroSlots = [];
  const copySlots = [];
  let commonPrereqResolvedSlotCount = 0;
  let recipeDependencyResolvedSlotCount = 0;
  const sourceCounts = new Map();

  for (const slot of nameTable.usedSlots) {
    const prov = provenance[slot];
    if (!prov || prov.status === 'unresolved') {
      unresolvedSlots.push(slot);
      continue;
    }
    if (prov.status === 'zero') {
      zeroSlots.push(slot);
    } else if (prov.status === 'copy') {
      copySlots.push(slot);
    }
    if (prov.stepRole === 'common_prerequisite') commonPrereqResolvedSlotCount++;
    else recipeDependencyResolvedSlotCount++;
    const key = sourceKey(prov);
    const current = sourceCounts.get(key) || {
      stepRole: prov.stepRole || 'recipe_dependency',
      stepLabel: prov.stepLabel || null,
      loaderType: prov.loaderType,
      loaderRegion: prov.loaderRegion,
      sourceRegion: prov.sourceRegion,
      sourceStart: prov.sourceStart,
      slotCount: 0,
    };
    current.slotCount++;
    sourceCounts.set(key, current);
  }

  return {
    recipeId: recipe.id,
    recipeType: recipe.recipeType,
    descriptorOffset: recipe.descriptor?.romOffset || null,
    subrecordOffset: recipe.subrecord?.romOffset || null,
    branch: recipe.sourceTriggerRecord?.branch || null,
    branchRole: recipe.sourceTriggerRecord?.branchRole || null,
    triggerRecordEntryOffset: recipe.sourceTriggerRecord?.triggerRecordEntryOffset || null,
    transitionRecordOffset: recipe.sourceTriggerRecord?.transitionRecordOffset || null,
    stageSelectorHex: recipe.sourceTriggerRecord?.stageSelectorHex || null,
    vramLoader8fbOffset: recipe.dependencies?.vramLoader8fb?.romOffset || null,
    extra998: recipe.dependencies?.extra998?.status === 'required' ? {
      regionId: recipe.dependencies.extra998.regionId || null,
      romOffset: recipe.dependencies.extra998.romOffset || null,
    } : null,
    audioRequestId: recipe.dependencies?.audioRequest?.requestId ?? null,
    audioRequestIdHex: recipe.dependencies?.audioRequest?.requestIdHex || null,
    audioRequestClassification: recipe.dependencies?.audioRequest?.taxonomy?.classification?.kind || null,
    lookupIndexCount: nameTable.lookupIndices.length,
    lookupIndexMin: nameTable.lookupIndices.length ? hex(nameTable.lookupIndices[0], 2) : null,
    lookupIndexMax: nameTable.lookupIndices.length ? hex(nameTable.lookupIndices[nameTable.lookupIndices.length - 1], 2) : null,
    common8fbEntries: entryCounts.common8fb,
    common998Entries: entryCounts.common998,
    recipe8fbEntries: entryCounts.recipe8fb,
    recipe998Entries: entryCounts.recipe998,
    usedSlotCount: nameTable.usedSlots.length,
    resolvedSlotCount: nameTable.usedSlots.length - unresolvedSlots.length,
    unresolvedSlotCount: unresolvedSlots.length,
    copySlotCount: copySlots.length,
    zeroSlotCount: zeroSlots.length,
    commonPrereqResolvedSlotCount,
    recipeDependencyResolvedSlotCount,
    unresolvedSlots,
    unresolvedSlotsSample: unresolvedSlots.slice(0, 24).map(slot => hex(slot, 3)),
    usedSlotsSample: nameTable.usedSlots.slice(0, 24).map(slot => hex(slot, 3)),
    sourceGroups: [...sourceCounts.values()]
      .sort((a, b) => b.slotCount - a.slotCount)
      .slice(0, 16),
    warningCount: warnings.length,
    warnings: warnings.slice(0, 16),
  };
}

function compareSummaries(baseline, simulated) {
  const byRecipe = new Map(simulated.map(summary => [summary.recipeId, summary]));
  return baseline.map(base => {
    const sim = byRecipe.get(base.recipeId);
    const baseUnresolved = new Set(base.unresolvedSlots);
    const simUnresolved = new Set(sim?.unresolvedSlots || []);
    const resolvedByCommon = [...baseUnresolved].filter(slot => !simUnresolved.has(slot));
    return {
      recipeId: base.recipeId,
      baselineUnresolvedSlotCount: base.unresolvedSlotCount,
      simulatedUnresolvedSlotCount: sim?.unresolvedSlotCount ?? null,
      resolvedByCommonPrereqSlotCount: resolvedByCommon.length,
      resolvedByCommonPrereqSlots: resolvedByCommon.slice(0, 24).map(slot => hex(slot, 3)),
    };
  });
}

function aggregateSummaries(summaries, comparisons = []) {
  const comparisonByRecipe = new Map(comparisons.map(item => [item.recipeId, item]));
  const unresolvedSlotUsage = new Map();
  const sourceGroupUsage = new Map();
  const audioRequestUsage = new Map();
  let totalUsedSlots = 0;
  let totalResolvedSlots = 0;
  let totalUnresolvedSlots = 0;
  let totalCommonPrereqResolvedSlots = 0;
  let maxUnresolvedSlots = 0;
  let warningRecipeCount = 0;
  let resolvedBaselineUnresolvedSlotCount = 0;
  let improvedRecipeCount = 0;
  let fullyResolvedByCommonPrereqCount = 0;

  for (const summary of summaries) {
    const comparison = comparisonByRecipe.get(summary.recipeId);
    totalUsedSlots += summary.usedSlotCount;
    totalResolvedSlots += summary.resolvedSlotCount;
    totalUnresolvedSlots += summary.unresolvedSlotCount;
    totalCommonPrereqResolvedSlots += summary.commonPrereqResolvedSlotCount;
    maxUnresolvedSlots = Math.max(maxUnresolvedSlots, summary.unresolvedSlotCount);
    if (summary.warningCount) warningRecipeCount++;
    if (comparison?.resolvedByCommonPrereqSlotCount) {
      resolvedBaselineUnresolvedSlotCount += comparison.resolvedByCommonPrereqSlotCount;
      improvedRecipeCount++;
      if (comparison.simulatedUnresolvedSlotCount === 0) fullyResolvedByCommonPrereqCount++;
    }
    for (const slotHex of summary.unresolvedSlotsSample) {
      const entry = unresolvedSlotUsage.get(slotHex) || { slot: slotHex, recipeCount: 0, sampleRecipeIds: [] };
      entry.recipeCount++;
      pushSample(entry.sampleRecipeIds, summary.recipeId);
      unresolvedSlotUsage.set(slotHex, entry);
    }
    for (const group of summary.sourceGroups) {
      const key = `${group.stepRole}|${group.loaderType}|${group.loaderRegion?.id || ''}|${group.sourceRegion?.id || group.sourceStart || ''}`;
      const entry = sourceGroupUsage.get(key) || {
        stepRole: group.stepRole,
        stepLabel: group.stepLabel,
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
      const entry = audioRequestUsage.get(summary.audioRequestId) || {
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
      audioRequestUsage.set(summary.audioRequestId, entry);
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
    totalCommonPrereqResolvedSlots,
    maxUnresolvedSlots,
    avgUsedSlotsPerRecipe: summaries.length ? Number((totalUsedSlots / summaries.length).toFixed(2)) : 0,
    avgUnresolvedSlotsPerRecipe: summaries.length ? Number((totalUnresolvedSlots / summaries.length).toFixed(2)) : 0,
    resolvedBaselineUnresolvedSlotCount,
    improvedRecipeCount,
    fullyResolvedByCommonPrereqCount,
    unresolvedSlotUsage: [...unresolvedSlotUsage.values()].sort((a, b) => b.recipeCount - a.recipeCount),
    sourceGroupUsage: [...sourceGroupUsage.values()].sort((a, b) => b.slotCount - a.slotCount),
    audioRequestUsage: [...audioRequestUsage.values()].sort((a, b) => a.requestId - b.requestId),
  };
}

function compactSummary(summary, comparison = null) {
  return {
    recipeId: summary.recipeId,
    recipeType: summary.recipeType,
    branch: summary.branch,
    branchRole: summary.branchRole,
    descriptorOffset: summary.descriptorOffset,
    subrecordOffset: summary.subrecordOffset,
    triggerRecordEntryOffset: summary.triggerRecordEntryOffset,
    transitionRecordOffset: summary.transitionRecordOffset,
    stageSelectorHex: summary.stageSelectorHex,
    vramLoader8fbOffset: summary.vramLoader8fbOffset,
    extra998: summary.extra998,
    audioRequestId: summary.audioRequestId,
    audioRequestIdHex: summary.audioRequestIdHex,
    audioRequestClassification: summary.audioRequestClassification,
    lookupIndexCount: summary.lookupIndexCount,
    lookupIndexMin: summary.lookupIndexMin,
    lookupIndexMax: summary.lookupIndexMax,
    common8fbEntries: summary.common8fbEntries,
    common998Entries: summary.common998Entries,
    recipe8fbEntries: summary.recipe8fbEntries,
    recipe998Entries: summary.recipe998Entries,
    usedSlotCount: summary.usedSlotCount,
    resolvedSlotCount: summary.resolvedSlotCount,
    unresolvedSlotCount: summary.unresolvedSlotCount,
    copySlotCount: summary.copySlotCount,
    zeroSlotCount: summary.zeroSlotCount,
    commonPrereqResolvedSlotCount: summary.commonPrereqResolvedSlotCount,
    recipeDependencyResolvedSlotCount: summary.recipeDependencyResolvedSlotCount,
    baselineUnresolvedSlotCount: comparison?.baselineUnresolvedSlotCount ?? null,
    resolvedByCommonPrereqSlotCount: comparison?.resolvedByCommonPrereqSlotCount ?? null,
    resolvedByCommonPrereqSlots: comparison?.resolvedByCommonPrereqSlots || [],
    unresolvedSlotsSample: summary.unresolvedSlotsSample,
    usedSlotsSample: summary.usedSlotsSample,
    sourceGroups: summary.sourceGroups,
    warningCount: summary.warningCount,
    warnings: summary.warnings,
  };
}

function buildZoneComparison(zoneBaselineCatalog, zoneCommonCatalog, inlineBaselineAggregate, inlineSimulatedAggregate) {
  return {
    zoneBaseline: zoneBaselineCatalog ? {
      catalogId: zoneBaselineCatalog.id,
      recipeCount: zoneBaselineCatalog.summary?.recipeCount ?? null,
      unresolvedRecipeCount: zoneBaselineCatalog.summary?.unresolvedRecipeCount ?? null,
      totalUnresolvedSlots: zoneBaselineCatalog.summary?.totalUnresolvedSlots ?? null,
      avgUnresolvedSlotsPerRecipe: zoneBaselineCatalog.summary?.avgUnresolvedSlotsPerRecipe ?? null,
    } : null,
    zoneWithCommonPrereq: zoneCommonCatalog ? {
      catalogId: zoneCommonCatalog.id,
      recipeCount: zoneCommonCatalog.summary?.recipeCount ?? null,
      unresolvedRecipeCount: zoneCommonCatalog.summary?.unresolvedRecipeCount ?? null,
      totalUnresolvedSlots: zoneCommonCatalog.summary?.totalUnresolvedSlots ?? null,
      avgUnresolvedSlotsPerRecipe: zoneCommonCatalog.summary?.avgUnresolvedSlotsPerRecipe ?? null,
      resolvedBaselineUnresolvedSlotCount: zoneCommonCatalog.summary?.resolvedBaselineUnresolvedSlotCount ?? null,
    } : null,
    inlineBaseline: {
      recipeCount: inlineBaselineAggregate.recipeCount,
      unresolvedRecipeCount: inlineBaselineAggregate.unresolvedRecipeCount,
      totalUnresolvedSlots: inlineBaselineAggregate.totalUnresolvedSlots,
      avgUnresolvedSlotsPerRecipe: inlineBaselineAggregate.avgUnresolvedSlotsPerRecipe,
    },
    inlineWithCommonPrereq: {
      recipeCount: inlineSimulatedAggregate.recipeCount,
      unresolvedRecipeCount: inlineSimulatedAggregate.unresolvedRecipeCount,
      totalUnresolvedSlots: inlineSimulatedAggregate.totalUnresolvedSlots,
      avgUnresolvedSlotsPerRecipe: inlineSimulatedAggregate.avgUnresolvedSlotsPerRecipe,
      resolvedBaselineUnresolvedSlotCount: inlineSimulatedAggregate.resolvedBaselineUnresolvedSlotCount,
    },
  };
}

function buildCatalog(rom, mapData) {
  const inlineRecipeCatalog = catalogById(mapData, inlineRecipeCatalogId);
  const zoneBaselineCatalog = catalogById(mapData, zoneBaselineCatalogId);
  const zoneCommonCatalog = catalogById(mapData, zoneCommonPrereqCatalogId);
  const dc2Catalog = catalogById(mapData, dc2CatalogId);
  const tilePairCatalog = catalogById(mapData, tilePairCatalogId);
  const commonPrereq = buildCommonPrereqSteps(mapData, zoneCommonCatalog);
  const recipes = mapData.inlineTransitionRecipes || [];
  const baselineSummaries = recipes.map(recipe => summarizeRecipe(rom, mapData, recipe, []));
  const simulatedSummaries = recipes.map(recipe => summarizeRecipe(rom, mapData, recipe, commonPrereq.steps));
  const comparisons = compareSummaries(baselineSummaries, simulatedSummaries);
  const comparisonByRecipe = new Map(comparisons.map(item => [item.recipeId, item]));
  const baselineAggregate = aggregateSummaries(baselineSummaries);
  const simulatedAggregate = aggregateSummaries(simulatedSummaries, comparisons);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      inlineRecipeCatalogId,
      zoneBaselineCatalogId,
      zoneCommonPrereqCatalogId,
      dc2CatalogId,
      tilePairCatalogId,
    ],
    sourceCatalogPresence: {
      inlineTransitionRecipeCatalog: Boolean(inlineRecipeCatalog),
      zoneBaselineRenderProvenanceCatalog: Boolean(zoneBaselineCatalog),
      zoneCommonPrereqProvenanceCatalog: Boolean(zoneCommonCatalog),
      dc2Catalog: Boolean(dc2Catalog),
      tilePairCatalog: Boolean(tilePairCatalog),
    },
    renderModel: {
      kind: 'metadata_only_inline_transition_render_provenance_with_common_prereq_simulation',
      vramLoadOrder: [
        'common prerequisite loaders when simulated',
        'dependencies.vramLoader8fb',
        'dependencies.extra998 when required',
      ],
      nameTableSource: 'dependencies.dc2Streams + _DATA_18000_ tile-pair lookup',
      columns: nameTableColumns,
      rows: nameTableRows,
      dc2ValuesPerStream: dc2RowsPerStreamForRecipeRender,
      tileSlotDerivation: 'SMS name-table tile id = low byte plus bit0 of high byte',
      dependencyStatus: 'simulation_only',
    },
    prerequisiteSteps: commonPrereq.steps,
    summary: {
      recipeCount: simulatedAggregate.recipeCount,
      fullyResolvedRecipeCount: simulatedAggregate.fullyResolvedRecipeCount,
      unresolvedRecipeCount: simulatedAggregate.unresolvedRecipeCount,
      warningRecipeCount: simulatedAggregate.warningRecipeCount,
      baselineUnresolvedRecipeCount: baselineAggregate.unresolvedRecipeCount,
      baselineTotalUnresolvedSlots: baselineAggregate.totalUnresolvedSlots,
      simulatedTotalUnresolvedSlots: simulatedAggregate.totalUnresolvedSlots,
      totalUsedSlots: simulatedAggregate.totalUsedSlots,
      totalResolvedSlots: simulatedAggregate.totalResolvedSlots,
      totalCommonPrereqResolvedSlots: simulatedAggregate.totalCommonPrereqResolvedSlots,
      maxUnresolvedSlots: simulatedAggregate.maxUnresolvedSlots,
      avgUsedSlotsPerRecipe: simulatedAggregate.avgUsedSlotsPerRecipe,
      avgBaselineUnresolvedSlotsPerRecipe: baselineAggregate.avgUnresolvedSlotsPerRecipe,
      avgSimulatedUnresolvedSlotsPerRecipe: simulatedAggregate.avgUnresolvedSlotsPerRecipe,
      resolvedBaselineUnresolvedSlotCount: simulatedAggregate.resolvedBaselineUnresolvedSlotCount,
      improvedRecipeCount: simulatedAggregate.improvedRecipeCount,
      fullyResolvedByCommonPrereqCount: simulatedAggregate.fullyResolvedByCommonPrereqCount,
      prerequisiteStepCount: commonPrereq.steps.length,
      sourceGroupCount: simulatedAggregate.sourceGroupUsage.length,
      audioRequestUsageCount: simulatedAggregate.audioRequestUsage.length,
      warningCount: commonPrereq.warnings.length,
      assetPolicy: 'Metadata only: inline recipe ids, offsets, loader entry counts, tile-slot ids/counts, source region ids, and aggregate provenance. No ROM bytes, decoded name tables, graphics, audio, or rendered assets are embedded.',
    },
    baselineRecipeSummaries: baselineSummaries.map(summary => compactSummary(summary)),
    recipeSummaries: simulatedSummaries.map(summary => compactSummary(summary, comparisonByRecipe.get(summary.recipeId))),
    recipeComparisons: comparisons,
    unresolvedSlotUsage: simulatedAggregate.unresolvedSlotUsage.slice(0, 96),
    sourceGroupUsage: simulatedAggregate.sourceGroupUsage.slice(0, 128),
    audioRequestUsage: simulatedAggregate.audioRequestUsage,
    normalZoneComparison: buildZoneComparison(zoneBaselineCatalog, zoneCommonCatalog, baselineAggregate, simulatedAggregate),
    warnings: commonPrereq.warnings,
    evidence: [
      `${inlineRecipeCatalogId} supplies the 12 staged-transition inline room recipes consumed by _LABEL_4E49_/_LABEL_B44F_.`,
      `${zoneBaselineCatalogId} provides the normal zone recipe baseline used for aggregate comparison.`,
      `${zoneCommonPrereqCatalogId} supplies the simulation-only common VRAM prerequisite loader pair used before recipe-specific loaders.`,
      'This audit uses the same 8FB, 998, DC2 stream, and _DATA_18000_ tile-slot derivation model as the zone render-provenance audits.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const baselineByRecipe = new Map(catalog.baselineRecipeSummaries.map(summary => [summary.recipeId, summary]));
  const simulatedByRecipe = new Map(catalog.recipeSummaries.map(summary => [summary.recipeId, summary]));
  let annotatedRecipeCount = 0;

  for (const recipe of mapData.inlineTransitionRecipes || []) {
    const baseline = baselineByRecipe.get(recipe.id);
    const simulated = simulatedByRecipe.get(recipe.id);
    if (!baseline || !simulated) continue;
    recipe.renderProvenance = {
      catalogId,
      confidence: baseline.warningCount ? 'medium' : 'high',
      usedSlotCount: baseline.usedSlotCount,
      resolvedSlotCount: baseline.resolvedSlotCount,
      unresolvedSlotCount: baseline.unresolvedSlotCount,
      copySlotCount: baseline.copySlotCount,
      zeroSlotCount: baseline.zeroSlotCount,
      unresolvedSlotsSample: baseline.unresolvedSlotsSample,
      sourceGroups: baseline.sourceGroups.slice(0, 8),
      warningCount: baseline.warningCount,
      generatedAt: now,
      tool: toolName,
    };
    recipe.commonPrereqRenderSimulation = {
      catalogId,
      dependencyStatus: 'simulation_only',
      confidence: simulated.warningCount ? 'medium' : 'high',
      baselineUnresolvedSlotCount: simulated.baselineUnresolvedSlotCount,
      simulatedUnresolvedSlotCount: simulated.unresolvedSlotCount,
      resolvedByCommonPrereqSlotCount: simulated.resolvedByCommonPrereqSlotCount,
      resolvedByCommonPrereqSlots: simulated.resolvedByCommonPrereqSlots,
      commonPrereqResolvedSlotCount: simulated.commonPrereqResolvedSlotCount,
      sourceGroups: simulated.sourceGroups
        .filter(group => group.stepRole === 'common_prerequisite')
        .slice(0, 8),
      warningCount: simulated.warningCount,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRecipeCount++;
  }

  const annotatedRegions = [];
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
    region.analysis.inlineTransitionRenderProvenanceAudit = {
      catalogId,
      kind: 'inline_transition_render_vram_loader_source',
      confidence: 'high',
      summary: 'This VRAM loader contributes tile-slot provenance to staged-transition inline room recipes.',
      recipeCount,
      sampleRecipeIds,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      recipeCount,
    });
  }

  return {
    annotatedRecipeCount,
    annotatedRegions,
  };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  let annotation = { annotatedRecipeCount: 0, annotatedRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    const finalCatalog = buildCatalog(rom, mapData);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'inline_transition_render_provenance_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: finalCatalog.sourceCatalogs,
      sourceCatalogPresence: finalCatalog.sourceCatalogPresence,
      renderModel: finalCatalog.renderModel,
      summary: {
        ...finalCatalog.summary,
        annotatedRecipeCount: annotation.annotatedRecipeCount,
        annotatedRegionCount: annotation.annotatedRegions.length,
      },
      normalZoneComparison: finalCatalog.normalZoneComparison,
      recipeComparisons: finalCatalog.recipeComparisons,
      unresolvedSlotUsage: finalCatalog.unresolvedSlotUsage,
      sourceGroupUsage: finalCatalog.sourceGroupUsage.slice(0, 64),
      audioRequestUsage: finalCatalog.audioRequestUsage,
      recipeSamples: finalCatalog.recipeSummaries.slice(0, 24),
      annotatedRegions: annotation.annotatedRegions,
      evidence: finalCatalog.evidence,
      nextLeads: [
        'Trace why inline transition recipes still need the simulation-only common prerequisite and prove whether the common VRAM state persists across _LABEL_4E49_/_LABEL_B44F_ paths.',
        'Render-smoke-test first/second branch inline recipes in the analyzer and compare against runtime transition captures.',
        'Use sourceGroupUsage to connect staged transition rooms to their graphics banks before extracting reusable engine scene modules.',
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
      annotatedRegionCount: annotation.annotatedRegions.length,
    },
    normalZoneComparison: catalog.normalZoneComparison,
    firstRecipes: catalog.recipeSummaries.slice(0, 6).map(summary => ({
      recipeId: summary.recipeId,
      descriptorOffset: summary.descriptorOffset,
      branch: summary.branch,
      usedSlotCount: summary.usedSlotCount,
      baselineUnresolvedSlotCount: summary.baselineUnresolvedSlotCount,
      simulatedUnresolvedSlotCount: summary.unresolvedSlotCount,
      resolvedByCommonPrereqSlotCount: summary.resolvedByCommonPrereqSlotCount,
      unresolvedSlotsSample: summary.unresolvedSlotsSample,
      warningCount: summary.warningCount,
    })),
  }, null, 2));
}

main();
