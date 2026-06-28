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
const catalogId = 'world-zone-unresolved-slot-candidate-catalog-2026-06-25';
const reportId = 'zone-unresolved-slot-candidate-audit-2026-06-25';
const toolName = 'tools/world-zone-unresolved-slot-candidate-audit.mjs';

const provenanceCatalogId = 'world-zone-render-provenance-catalog-2026-06-25';

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

function regionBounds(region) {
  const start = offsetOf(region);
  return { start, end: start + (region.size || 0) };
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
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

function pushSample(list, value, limit = 12) {
  if (value != null && list.length < limit && !list.includes(value)) list.push(value);
}

function decode8fbLoader(rom, mapData, region) {
  const entries = [];
  const warnings = [];
  const baseOffset = offsetOf(region);
  let pc = baseOffset;
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
    const sourceRegion = sourceEndExclusive <= rom.length ? findContainingRegion(mapData, sourceStart) : null;
    if (sourceEndExclusive > rom.length) {
      warnings.push(`8FB entry ${entryIndex} source out of range ${hex(sourceStart)}-${hex(sourceEndExclusive - 1)}`);
    }
    entries.push({
      entryIndex,
      entryOffset: hex(entryOffset),
      kind: 'copy',
      tileStart: curVramTile,
      tileEnd: curVramTile + count - 1,
      count,
      sourceStart: hex(sourceStart),
      sourceEndExclusive: hex(sourceEndExclusive),
      sourceRegion: regionRef(sourceRegion),
    });
    curVramTile += count;
    curBlockIdx += count;
    entryIndex++;
  }

  if (!terminated) warnings.push(`8FB loader ${region.id} did not terminate inside audit limit`);
  return { entries, warnings, terminated };
}

function decode998Loader(rom, mapData, region) {
  const entries = [];
  const warnings = [];
  const baseOffset = offsetOf(region);
  let pc = baseOffset;
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
      entries.push({
        entryIndex,
        entryOffset: hex(entryOffset),
        kind: 'zero',
        setTile: setTile == null ? null : hex(setTile, 2),
        tileStart,
        tileEnd: tileStart,
        count: 1,
        sourceStart: null,
        sourceEndExclusive: null,
        sourceRegion: null,
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
        setTile: setTile == null ? null : hex(setTile, 2),
        tileStart,
        tileEnd: tileStart - 1,
        count: 0,
        sourceStart: null,
        sourceEndExclusive: null,
        sourceRegion: null,
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
    const sourceRegion = sourceEndExclusive <= rom.length ? findContainingRegion(mapData, sourceStart) : null;
    if (sourceEndExclusive > rom.length) {
      warnings.push(`998 entry ${entryIndex} source out of range ${hex(sourceStart)}-${hex(sourceEndExclusive - 1)}`);
    }
    entries.push({
      entryIndex,
      entryOffset: hex(entryOffset),
      kind: 'copy',
      setTile: setTile == null ? null : hex(setTile, 2),
      tileStart,
      tileEnd: tileStart + count - 1,
      count,
      sourceStart: hex(sourceStart),
      sourceEndExclusive: hex(sourceEndExclusive),
      sourceRegion: regionRef(sourceRegion),
    });
    vramPtr += count * 32;
    entryIndex++;
  }

  if (!terminated) warnings.push(`998 loader ${region.id} did not terminate inside audit limit`);
  return { entries, warnings, terminated };
}

function decodeLoader(rom, mapData, region) {
  if (region.type === 'vram_loader_8fb') return decode8fbLoader(rom, mapData, region);
  if (region.type === 'vram_loader_998') return decode998Loader(rom, mapData, region);
  return { entries: [], warnings: [`unsupported loader type ${region.type}`], terminated: false };
}

function collectLoaderUsage(mapData) {
  const usage = new Map();
  for (const recipe of mapData.zoneRecipes || []) {
    const loaderRegionId = recipe.dependencies?.vramLoader8fb?.region?.id || null;
    if (loaderRegionId) {
      const entry = usage.get(loaderRegionId) || { recipeCount: 0, sampleRecipeIds: [] };
      entry.recipeCount++;
      pushSample(entry.sampleRecipeIds, recipe.id);
      usage.set(loaderRegionId, entry);
    }
    const extraRegionId = recipe.dependencies?.extra998?.regionId || null;
    if (extraRegionId) {
      const entry = usage.get(extraRegionId) || { recipeCount: 0, sampleRecipeIds: [] };
      entry.recipeCount++;
      pushSample(entry.sampleRecipeIds, recipe.id);
      usage.set(extraRegionId, entry);
    }
  }
  return usage;
}

function unresolvedRecipesBySlot(provenanceCatalog) {
  const bySlot = new Map();
  for (const summary of provenanceCatalog?.recipeSummaries || []) {
    for (const slot of summary.unresolvedSlotsSample || []) {
      const entry = bySlot.get(slot) || { recipeCount: 0, sampleRecipeIds: [] };
      entry.recipeCount++;
      pushSample(entry.sampleRecipeIds, summary.recipeId);
      bySlot.set(slot, entry);
    }
  }
  return bySlot;
}

function buildCatalog(rom, mapData) {
  const provenanceCatalog = (mapData.roomDataCatalogs || []).find(item => item.id === provenanceCatalogId) || null;
  if (!provenanceCatalog) throw new Error(`Missing required catalog ${provenanceCatalogId}`);

  const slotUsage = unresolvedRecipesBySlot(provenanceCatalog);
  const unresolvedSlots = [...slotUsage.keys()]
    .map(slotHex => ({ slotHex, slot: parseHex(slotHex) }))
    .filter(item => item.slot != null)
    .sort((a, b) => a.slot - b.slot);
  const loaderUsage = collectLoaderUsage(mapData);
  const loaderRegions = (mapData.regions || []).filter(region =>
    region.type === 'vram_loader_8fb' || region.type === 'vram_loader_998'
  );

  const warnings = [];
  const candidatesBySlot = new Map(unresolvedSlots.map(item => [item.slotHex, []]));
  const loaderSummaries = [];

  for (const region of loaderRegions) {
    const decoded = decodeLoader(rom, mapData, region);
    warnings.push(...decoded.warnings.map(warning => ({ regionId: region.id, warning })));
    const usage = loaderUsage.get(region.id) || { recipeCount: 0, sampleRecipeIds: [] };
    const matchedSlots = [];
    for (const slotInfo of unresolvedSlots) {
      const matches = decoded.entries.filter(entry =>
        entry.count > 0 && slotInfo.slot >= entry.tileStart && slotInfo.slot <= entry.tileEnd
      );
      if (!matches.length) continue;
      matchedSlots.push(slotInfo.slotHex);
      for (const match of matches) {
        candidatesBySlot.get(slotInfo.slotHex).push({
          loaderRegion: regionRef(region),
          loaderUsage: usage,
          entryIndex: match.entryIndex,
          entryOffset: match.entryOffset,
          entryKind: match.kind,
          tileRange: {
            start: hex(match.tileStart, 3),
            end: hex(match.tileEnd, 3),
            count: match.count,
          },
          sourceStart: match.sourceStart,
          sourceEndExclusive: match.sourceEndExclusive,
          sourceRegion: match.sourceRegion,
          evidence: `Mapped ${region.type} region ${region.id} writes unresolved tile slot ${slotInfo.slotHex} in entry ${match.entryIndex}.`,
        });
      }
    }
    if (matchedSlots.length) {
      loaderSummaries.push({
        loaderRegion: regionRef(region),
        loaderUsage: usage,
        matchedSlots: [...new Set(matchedSlots)].sort(),
        matchedSlotCount: new Set(matchedSlots).size,
        decodedEntryCount: decoded.entries.length,
        warningCount: decoded.warnings.length,
      });
    }
  }

  const slots = unresolvedSlots.map(slotInfo => {
    const candidates = (candidatesBySlot.get(slotInfo.slotHex) || [])
      .sort((a, b) => {
        const usageDelta = (a.loaderUsage.recipeCount || 0) - (b.loaderUsage.recipeCount || 0);
        if (usageDelta !== 0) return usageDelta;
        return a.loaderRegion.id.localeCompare(b.loaderRegion.id);
      });
    const unusedCandidates = candidates.filter(candidate => !candidate.loaderUsage.recipeCount);
    const recipeUsedCandidates = candidates.filter(candidate => candidate.loaderUsage.recipeCount);
    return {
      slot: slotInfo.slotHex,
      unresolvedRecipeCount: slotUsage.get(slotInfo.slotHex)?.recipeCount || 0,
      sampleRecipeIds: slotUsage.get(slotInfo.slotHex)?.sampleRecipeIds || [],
      candidateCount: candidates.length,
      unusedCandidateCount: unusedCandidates.length,
      recipeUsedCandidateCount: recipeUsedCandidates.length,
      candidates: candidates.slice(0, 24),
    };
  });

  const slotsWithCandidates = slots.filter(slot => slot.candidateCount > 0);
  const slotsWithUnusedCandidates = slots.filter(slot => slot.unusedCandidateCount > 0);
  const slotsWithoutCandidates = slots.filter(slot => slot.candidateCount === 0);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [provenanceCatalogId],
    summary: {
      unresolvedSlotCount: slots.length,
      slotsWithCandidates: slotsWithCandidates.length,
      slotsWithUnusedCandidates: slotsWithUnusedCandidates.length,
      slotsWithoutCandidates: slotsWithoutCandidates.length,
      loaderRegionCount: loaderRegions.length,
      loaderRegionCandidateCount: loaderSummaries.length,
      warningCount: warnings.length,
      assetPolicy: 'Metadata only: unresolved tile slot ids, loader region ids, entry offsets, source offsets/regions, and aggregate candidate counts. No ROM bytes, decoded graphics, decoded name tables, or rendered assets are embedded.',
    },
    slots,
    loaderSummaries: loaderSummaries.sort((a, b) => b.matchedSlotCount - a.matchedSlotCount),
    warnings: warnings.slice(0, 96),
    evidence: [
      `Unresolved tile slots come from ${provenanceCatalogId}, which derives recipe name-table tile ids from DC2 streams and _DATA_18000_.`,
      'All mapped vram_loader_8fb and vram_loader_998 regions are decoded with the same loader semantics used by the simulator and tile-source audit.',
      'A candidate means the mapped loader writes the unresolved VRAM tile slot; it does not prove that loader is active for the room until a call-site or scene-load trace is found.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  for (const summary of catalog.loaderSummaries) {
    const region = (mapData.regions || []).find(item => item.id === summary.loaderRegion.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.zoneUnresolvedSlotCandidateAudit = {
      catalogId,
      kind: 'unresolved_zone_tile_slot_candidate_loader',
      confidence: summary.loaderUsage.recipeCount ? 'low' : 'medium',
      summary: 'This mapped VRAM loader writes one or more tile slots that are unresolved in current zone recipe render provenance.',
      matchedSlots: summary.matchedSlots,
      loaderRecipeUsage: summary.loaderUsage,
      evidence: [
        'Candidate status is based on decoded loader tile-slot writes matching unresolved slot ids from the zone render provenance audit.',
        'This is a lead for missing/common scene dependencies; it is not treated as active for a room until call-site or render-order evidence is found.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      matchedSlots: summary.matchedSlots,
      recipeCount: summary.loaderUsage.recipeCount,
    });
  }
  return annotated;
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  let annotatedCandidateRegions = [];

  if (apply) {
    annotatedCandidateRegions = annotateMap(mapData, catalog);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_unresolved_slot_candidate_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedCandidateRegionCount: annotatedCandidateRegions.length,
      },
      slots: catalog.slots,
      loaderSummaries: catalog.loaderSummaries,
      annotatedCandidateRegions,
      warnings: catalog.warnings,
      evidence: catalog.evidence,
      nextLeads: [
        'Trace candidate unused loaders with matched slots through ASM call sites before adding them to zone recipes.',
        'Prioritize slots with many unresolved recipes and at least one unused candidate loader.',
        'If no candidate loader is active, inspect boot/common scene initialization for persistent VRAM slots 0x100-0x13F.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedCandidateRegionCount: annotatedCandidateRegions.length,
    },
    slots: catalog.slots.map(slot => ({
      slot: slot.slot,
      unresolvedRecipeCount: slot.unresolvedRecipeCount,
      candidateCount: slot.candidateCount,
      unusedCandidateCount: slot.unusedCandidateCount,
      topCandidates: slot.candidates.slice(0, 5).map(candidate => ({
        regionId: candidate.loaderRegion.id,
        type: candidate.loaderRegion.type,
        recipeCount: candidate.loaderUsage.recipeCount,
        entryOffset: candidate.entryOffset,
        entryKind: candidate.entryKind,
        tileRange: candidate.tileRange,
        sourceRegionId: candidate.sourceRegion?.id || null,
      })),
    })),
  }, null, 2));
}

main();
