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
const catalogId = 'world-scene-recipe-render-provenance-catalog-2026-06-25';
const reportId = 'scene-recipe-render-provenance-audit-2026-06-25';
const toolName = 'tools/world-scene-recipe-render-provenance-audit.mjs';

const tileSlotCount = 0x4000 >> 5;
const nameTableBase = 0x3800;
const nameTableCols = 32;
const maxNameTableRows = 32;
const visibleRows = 28;

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
  return typeof region.offset === 'number' ? region.offset : parseHex(region.offset);
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return start != null && offset >= start && offset < start + (region.size || 0);
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

function stepKind(step) {
  return step?.sourceStepType || ({
    bg_palette: 'cram_bg',
    sprite_palette: 'cram_spr',
    vram_loader_8fb: 'vram_8fb',
    vram_loader_998: 'vram_998',
    screen_prog: 'nt_604',
  }[step?.kind]) || step?.kind || '';
}

function vdpCtrlWordToVram(vdp16) {
  return (vdp16 & 0xFF) | (((vdp16 >> 8) & 0x3F) << 8);
}

function screenProg604Z80ToRom(z80, bank8000) {
  if (z80 < 0x8000) return z80;
  if (z80 < 0xC000) return bank8000 * 0x4000 + (z80 - 0x8000);
  return -1;
}

function nameTableCellFromVramAddr(vramAddr) {
  return (vramAddr - nameTableBase) >> 1;
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

function mergeProvenance(base, overlay) {
  const out = base.slice();
  for (let i = 0; i < overlay.length; i++) {
    if (overlay[i]) out[i] = overlay[i];
  }
  return out;
}

function decodeLoader8fb(rom, mapData, scriptOffset, loaderRegion) {
  const provenance = new Array(tileSlotCount).fill(null);
  const warnings = [];
  let pc = scriptOffset;
  let curVramTile = 0;
  let curBank = 8;
  let curBlockIdx = 0;
  let entryIndex = 0;
  let terminated = false;
  let totalTiles = 0;
  let maxTile = -1;

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
    const srcWord = srcLo | (srcHi << 8);
    if (vramWord !== 0xFFFF) curVramTile = vramWord;
    if (srcWord !== 0xFFFF) {
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
    totalTiles += count;
    maxTile = Math.max(maxTile, curVramTile + count - 1);
    curVramTile += count;
    curBlockIdx += count;
    entryIndex++;
  }

  if (!terminated) warnings.push(`8FB loader at ${hex(scriptOffset)} did not reach terminator inside audit limit`);
  return {
    provenance,
    stats: {
      format: '8fb',
      entryCount: entryIndex,
      totalTiles,
      maxTile: maxTile < 0 ? null : hex(maxTile, 3),
      terminated,
      warningCount: warnings.length,
    },
    warnings,
  };
}

function decodeLoader998(rom, mapData, scriptOffset, loaderRegion) {
  const provenance = new Array(tileSlotCount).fill(null);
  const warnings = [];
  let pc = scriptOffset;
  let vramPtr = 0;
  let entryIndex = 0;
  let terminated = false;
  let totalTiles = 0;
  let zeroTiles = 0;
  let maxTile = -1;

  while (pc < rom.length && entryIndex < 512) {
    const entryOffset = pc;
    const op = rom[pc++];
    if (op === 0) {
      terminated = true;
      break;
    }
    const count = op & 0x7F;
    if (op & 0x80) {
      if (pc >= rom.length) {
        warnings.push(`998 entry ${entryIndex} truncated set-position at ${hex(entryOffset)}`);
        break;
      }
      vramPtr = rom[pc++] * 32;
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
      totalTiles++;
      zeroTiles++;
      maxTile = Math.max(maxTile, tileStart);
      vramPtr += 32;
      entryIndex++;
      continue;
    }
    if (count === 0) {
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
    totalTiles += count;
    maxTile = Math.max(maxTile, tileStart + count - 1);
    vramPtr += count * 32;
    entryIndex++;
  }

  if (!terminated) warnings.push(`998 loader at ${hex(scriptOffset)} did not reach terminator inside audit limit`);
  return {
    provenance,
    stats: {
      format: '998',
      entryCount: entryIndex,
      totalTiles,
      zeroTiles,
      maxTile: maxTile < 0 ? null : hex(maxTile, 3),
      terminated,
      warningCount: warnings.length,
    },
    warnings,
  };
}

function decodeScreenProg604(rom, scriptOffset, bank8000, nameTable) {
  const warnings = [];
  const visited = new Set();
  const pcVisits = new Map();
  let pc = scriptOffset;
  let storedVdpAddr = 0x7800;
  let vramAddr = nameTableBase;
  let currentAttr = 0;
  let ops = 0;
  let writtenCells = 0;
  let endReason = 'Reached max ops';

  function readByte() {
    if (pc >= rom.length) return null;
    return rom[pc++];
  }

  function markVisited(start, count) {
    for (let i = 0; i < count; i++) {
      const offset = start + i;
      if (offset >= 0 && offset < rom.length) visited.add(offset);
    }
  }

  function writeCell(addr, tile, attr) {
    const cell = nameTableCellFromVramAddr(addr);
    if (cell < 0 || cell >= nameTable.length) return;
    const previous = nameTable[cell];
    const next = (tile & 0xFF) | ((attr & 0xFF) << 8);
    nameTable[cell] = next;
    if (previous !== next) writtenCells++;
  }

  while (pc < rom.length && ops < 4096) {
    const visitCount = (pcVisits.get(pc) || 0) + 1;
    pcVisits.set(pc, visitCount);
    if (visitCount > 64) {
      endReason = `loop guard at ${hex(pc)}`;
      warnings.push(endReason);
      break;
    }

    const start = pc;
    const b = readByte();
    if (b == null) {
      endReason = 'Unexpected EOF';
      warnings.push(endReason);
      break;
    }
    markVisited(start, 1);
    ops++;

    if (b < 0xF0) {
      writeCell(vramAddr, b, currentAttr);
      vramAddr += 2;
      continue;
    }

    switch (b & 0x07) {
      case 0:
        endReason = `${hex(b, 2)} end`;
        pc = rom.length;
        break;
      case 1: {
        const attr = readByte();
        if (attr == null) {
          endReason = `${hex(b, 2)} truncated attr`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(start + 1, 1);
        currentAttr = attr;
        break;
      }
      case 2: {
        const lo = readByte();
        const hi = readByte();
        if (lo == null || hi == null) {
          endReason = `${hex(b, 2)} truncated address`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(start + 1, 2);
        storedVdpAddr = lo | (hi << 8);
        vramAddr = vdpCtrlWordToVram(storedVdpAddr);
        break;
      }
      case 3: {
        const tile = readByte();
        if (tile == null) {
          endReason = `${hex(b, 2)} truncated literal`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(start + 1, 1);
        writeCell(vramAddr, tile, currentAttr);
        vramAddr += 2;
        break;
      }
      case 4: {
        const lo = readByte();
        const hi = readByte();
        if (lo == null || hi == null) {
          endReason = `${hex(b, 2)} truncated jump`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(start + 1, 2);
        const z80 = lo | (hi << 8);
        const target = screenProg604Z80ToRom(z80, bank8000);
        if (target < 0 || target >= rom.length) {
          endReason = `${hex(b, 2)} jump target out of range ${hex(z80, 4)}`;
          warnings.push(endReason);
          pc = rom.length;
        } else {
          pc = target;
        }
        break;
      }
      case 5: {
        const count = readByte();
        const tile = readByte();
        if (count == null || tile == null) {
          endReason = `${hex(b, 2)} truncated fill`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(start + 1, 2);
        for (let i = 0; i < count; i++) {
          writeCell(vramAddr, tile, currentAttr);
          vramAddr += 2;
        }
        break;
      }
      case 6:
        storedVdpAddr = (storedVdpAddr + 0x0040) & 0xFFFF;
        if ((storedVdpAddr >> 8) >= 0x7F) storedVdpAddr = (storedVdpAddr & 0x00FF) | 0x7800;
        vramAddr = vdpCtrlWordToVram(storedVdpAddr);
        for (let i = 0; i < nameTableCols; i++) writeCell(vramAddr + i * 2, 0x20, 0x08);
        break;
      default:
        endReason = `unhandled opcode ${hex(b, 2)}`;
        warnings.push(endReason);
        pc = rom.length;
        break;
    }
  }

  if (ops >= 4096 && endReason === 'Reached max ops') warnings.push(endReason);
  return {
    ops,
    writtenCells,
    visitedByteCount: visited.size,
    endReason,
    warningCount: warnings.length,
    warnings,
  };
}

function renderRowsFromNameTable(nameTable) {
  let maxRow = visibleRows - 1;
  for (let row = maxNameTableRows - 1; row >= visibleRows; row--) {
    let hasData = false;
    for (let col = 0; col < nameTableCols; col++) {
      if (nameTable[row * nameTableCols + col]) {
        hasData = true;
        break;
      }
    }
    if (hasData) {
      maxRow = row;
      break;
    }
  }
  return Math.max(visibleRows, Math.min(maxNameTableRows, maxRow + 1));
}

function tileSlotFromNameTableWord(word) {
  const lo = word & 0xFF;
  const hi = (word >> 8) & 0xFF;
  return lo | ((hi & 0x01) << 8);
}

function sourceKey(prov) {
  const loader = prov.loaderRegion?.id || prov.loaderType || 'unknown_loader';
  const source = prov.sourceRegion?.id || prov.sourceStart || 'none';
  return `${prov.loaderType}|${loader}|${source}`;
}

function analyzeNameTable(nameTable, provenance, rows) {
  const usedSet = new Set();
  const unresolvedSlots = [];
  const copySlots = [];
  const zeroSlots = [];
  const sourceCounts = new Map();

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < nameTableCols; col++) {
      const slot = tileSlotFromNameTableWord(nameTable[row * nameTableCols + col]);
      usedSet.add(slot);
    }
  }

  const usedSlots = [...usedSet].sort((a, b) => a - b);
  for (const slot of usedSlots) {
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
    usedSlots,
    unresolvedSlots,
    copySlots,
    zeroSlots,
    sourceGroups: [...sourceCounts.values()].sort((a, b) => b.slotCount - a.slotCount),
  };
}

function compactSlotList(slots, limit = 48) {
  return slots.slice(0, limit).map(slot => hex(slot, 3));
}

function summarizeRecipe(rom, mapData, recipe) {
  let provenance = new Array(tileSlotCount).fill(null);
  const nameTable = new Uint16Array(nameTableCols * maxNameTableRows);
  const warnings = [];
  const loaderSummaries = [];
  const screenProgSummaries = [];
  let paletteStepCount = 0;

  const defaultBank = recipe.bankContext?.defaultBank8000 ?? 7;
  const steps = (recipe.steps || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const step of steps) {
    const type = stepKind(step);
    const region = findRegionById(mapData, step.regionId);
    const offset = region ? offsetOf(region) : null;
    if (type === 'cram_bg' || type === 'cram_spr') {
      paletteStepCount++;
      continue;
    }
    if (!region || offset == null) {
      warnings.push(`step ${step.order ?? '?'} ${type || '?'} missing region ${step.regionId || '?'}`);
      continue;
    }

    if (type === 'vram_8fb') {
      const decoded = decodeLoader8fb(rom, mapData, offset, regionRef(region));
      provenance = mergeProvenance(provenance, decoded.provenance);
      loaderSummaries.push({
        stepOrder: step.order ?? null,
        loaderType: 'vram_loader_8fb',
        region: regionRef(region),
        romOffset: hex(offset),
        stats: decoded.stats,
      });
      warnings.push(...decoded.warnings);
    } else if (type === 'vram_998') {
      const decoded = decodeLoader998(rom, mapData, offset, regionRef(region));
      provenance = mergeProvenance(provenance, decoded.provenance);
      loaderSummaries.push({
        stepOrder: step.order ?? null,
        loaderType: 'vram_loader_998',
        region: regionRef(region),
        romOffset: hex(offset),
        stats: decoded.stats,
      });
      warnings.push(...decoded.warnings);
    } else if (type === 'nt_604') {
      const bank = step.bank ?? defaultBank;
      const decoded = decodeScreenProg604(rom, offset, bank, nameTable);
      screenProgSummaries.push({
        stepOrder: step.order ?? null,
        region: regionRef(region),
        romOffset: hex(offset),
        bank8000: bank,
        ops: decoded.ops,
        writtenCells: decoded.writtenCells,
        visitedByteCount: decoded.visitedByteCount,
        endReason: decoded.endReason,
        warningCount: decoded.warningCount,
        warnings: decoded.warnings.slice(0, 8),
      });
      warnings.push(...decoded.warnings);
    }
  }

  const renderRows = renderRowsFromNameTable(nameTable);
  const analysis = analyzeNameTable(nameTable, provenance, renderRows);
  return {
    recipeId: recipe.id,
    name: recipe.name || '',
    sourceSceneId: recipe.sourceSceneId || null,
    schemaVersion: recipe.schemaVersion || null,
    bankContext: recipe.bankContext || null,
    stepCount: steps.length,
    paletteStepCount,
    loaderStepCount: loaderSummaries.length,
    screenProgStepCount: screenProgSummaries.length,
    renderRows,
    loaderSummaries,
    screenProgSummaries,
    usedSlotCount: analysis.usedSlots.length,
    resolvedSlotCount: analysis.usedSlots.length - analysis.unresolvedSlots.length,
    unresolvedSlotCount: analysis.unresolvedSlots.length,
    copySlotCount: analysis.copySlots.length,
    zeroSlotCount: analysis.zeroSlots.length,
    usedSlotsSample: compactSlotList(analysis.usedSlots),
    unresolvedSlotsSample: compactSlotList(analysis.unresolvedSlots),
    copySlotsSample: compactSlotList(analysis.copySlots, 24),
    zeroSlotsSample: compactSlotList(analysis.zeroSlots, 24),
    sourceGroups: analysis.sourceGroups.slice(0, 16),
    warningCount: warnings.length,
    warnings: warnings.slice(0, 16),
  };
}

function aggregateSummaries(summaries) {
  const unresolvedSlotUsage = new Map();
  const sourceGroupUsage = new Map();
  let totalUsedSlots = 0;
  let totalResolvedSlots = 0;
  let totalUnresolvedSlots = 0;
  let warningRecipeCount = 0;
  let maxUnresolvedSlots = 0;

  function pushSample(list, value, limit = 12) {
    if (value != null && list.length < limit && !list.includes(value)) list.push(value);
  }

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
  }

  return {
    recipeCount: summaries.length,
    fullyResolvedRecipeCount: summaries.filter(summary => summary.unresolvedSlotCount === 0).length,
    recipesWithWarnings: warningRecipeCount,
    totalUsedSlots,
    totalResolvedSlots,
    totalUnresolvedSlots,
    maxUnresolvedSlots,
    unresolvedSlotUsage: [...unresolvedSlotUsage.values()].sort((a, b) => b.recipeCount - a.recipeCount || a.slot.localeCompare(b.slot)).slice(0, 64),
    sourceGroupUsage: [...sourceGroupUsage.values()].sort((a, b) => b.slotCount - a.slotCount).slice(0, 32),
  };
}

function buildCatalog(rom, mapData) {
  const recipeSummaries = (mapData.sceneRecipes || []).map(recipe => summarizeRecipe(rom, mapData, recipe));
  const aggregate = aggregateSummaries(recipeSummaries);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    renderModel: {
      state: 'synthetic_sms_vram_name_table',
      loaderFormats: ['vram_loader_8fb', 'vram_loader_998'],
      screenProgram: '_LABEL_604_ screen_prog bytecode',
      renderRowsPolicy: 'Use 28 visible rows unless screen_prog writes non-zero name-table entries in rows 28-31.',
      unresolvedTilePolicy: 'Slots used by the name table without a loader provenance record stay unresolved; no ROM tile fallback is used.',
      assetPolicy: 'Metadata only: recipe ids, region ids, offsets, tile slot numbers, counts, and source-region references. No ROM bytes, decoded graphics, palettes, rendered images, or thumbnails are embedded.',
    },
    summary: {
      ...aggregate,
      assetPolicy: 'Metadata only: recipe ids, region ids, offsets, tile slot numbers, counts, and source-region references. No ROM bytes, decoded graphics, palettes, rendered images, or thumbnails are embedded.',
    },
    recipeSummaries,
    evidence: [
      'Scene recipes were simulated from their ordered metadata steps only; simScene thumbnails were ignored.',
      '8FB and 998 loader semantics match the analyzer simulator provenance model and the confirmed _LABEL_8FB_/_LABEL_998_ routines.',
      'Screen programs were decoded with the same _LABEL_604_ opcode model used by the browser analyzer.',
    ],
    nextLeads: [
      'For unresolved slots, identify missing prerequisite loaders or HUD/status tile banks before accepting a scene as reproducible.',
      'Promote fully resolved scene recipes as visual regression fixtures for the analyzer renderer.',
      'Use sourceGroupUsage to connect scene recipes back to tileSourceCatalog and graphicsCoverage records.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const summariesById = new Map(catalog.recipeSummaries.map(summary => [summary.recipeId, summary]));
  const annotated = [];
  for (const recipe of mapData.sceneRecipes || []) {
    const summary = summariesById.get(recipe.id);
    if (!summary) continue;
    recipe.renderProvenanceAudit = {
      catalogId,
      confidence: summary.warningCount ? 'medium' : 'high',
      status: summary.unresolvedSlotCount ? 'has_unresolved_slots' : 'fully_resolved',
      renderRows: summary.renderRows,
      usedSlotCount: summary.usedSlotCount,
      resolvedSlotCount: summary.resolvedSlotCount,
      unresolvedSlotCount: summary.unresolvedSlotCount,
      copySlotCount: summary.copySlotCount,
      zeroSlotCount: summary.zeroSlotCount,
      unresolvedSlotsSample: summary.unresolvedSlotsSample,
      sourceGroups: summary.sourceGroups.slice(0, 8),
      warningCount: summary.warningCount,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    recipe.renderingContract = {
      ...(recipe.renderingContract || {}),
      runtimeProvenanceImplemented: true,
      latestRenderProvenanceCatalogId: catalogId,
      unresolvedTilePolicy: 'Mark tile slot unresolved instead of falling back silently to ROM tile bytes.',
    };
    annotated.push({
      recipeId: recipe.id,
      name: recipe.name || '',
      status: recipe.renderProvenanceAudit.status,
      usedSlotCount: summary.usedSlotCount,
      resolvedSlotCount: summary.resolvedSlotCount,
      unresolvedSlotCount: summary.unresolvedSlotCount,
      warningCount: summary.warningCount,
    });
  }
  return annotated;
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotatedRecipes = apply ? annotateMap(mapData, catalog) : [];

  if (apply) {
    mapData.sceneRecipeCatalogs = (mapData.sceneRecipeCatalogs || []).filter(item => item.id !== catalogId);
    mapData.sceneRecipeCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'scene_recipe_render_provenance_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      summary: {
        ...catalog.summary,
        annotatedRecipes: annotatedRecipes.length,
      },
      renderModel: catalog.renderModel,
      annotatedRecipes,
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
      annotatedRecipes: annotatedRecipes.length,
    },
    recipes: catalog.recipeSummaries.map(summary => ({
      recipeId: summary.recipeId,
      name: summary.name,
      renderRows: summary.renderRows,
      usedSlotCount: summary.usedSlotCount,
      resolvedSlotCount: summary.resolvedSlotCount,
      unresolvedSlotCount: summary.unresolvedSlotCount,
      warningCount: summary.warningCount,
      unresolvedSlotsSample: summary.unresolvedSlotsSample,
    })),
  }, null, 2));
}

main();
