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
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-tile-source-catalog-2026-06-24';
const reportId = 'tile-source-audit-2026-06-24';

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function regionBounds(region) {
  const start = parseInt(region.offset, 16);
  return { start, end: start + (region.size || 0) };
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id,
    name: region.name || '',
    type: region.type || 'unknown',
    offset: region.offset,
    size: region.size || 0,
  };
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(region => {
    const { start, end } = regionBounds(region);
    return offset >= start && offset < end;
  }) || null;
}

function findOverlappingRegions(mapData, start, end) {
  return mapData.regions
    .filter(region => {
      const b = regionBounds(region);
      return b.start < end && b.end > start;
    })
    .map(regionRef);
}

function decode8fb(bytes, baseOffset, romLength) {
  const entries = [];
  const warnings = [];
  let pc = 0;
  let curVramTile = 0;
  let curBank = 8;
  let curBlockIdx = 0;
  let terminated = false;
  let endReason = 'Unexpected EOF';
  let totalTiles = 0;
  let invalidSources = 0;
  let maxVramTile = -1;

  for (let entryIndex = 0; entryIndex < 256 && pc < bytes.length; entryIndex++) {
    const start = pc;
    const count = bytes[pc++];
    if (count === 0) {
      terminated = true;
      endReason = `END @ ${hex(baseOffset + start)}`;
      break;
    }
    if (pc + 3 >= bytes.length) {
      endReason = `Truncated 8FB entry @ ${hex(baseOffset + start)}`;
      warnings.push(endReason);
      break;
    }
    const vlo = bytes[pc++];
    const vhi = bytes[pc++];
    const slo = bytes[pc++];
    const shi = bytes[pc++];
    const vramWord = vlo | (vhi << 8);
    const sourceWord = slo | (shi << 8);
    if (vramWord !== 0xFFFF) curVramTile = vramWord;
    if (sourceWord !== 0xFFFF) {
      curBank = shi >> 1;
      curBlockIdx = ((shi & 1) << 8) | slo;
    }
    const sourceStart = curBank * 0x4000 + curBlockIdx * 32;
    const sourceEnd = sourceStart + count * 32;
    if (sourceStart < 0 || sourceEnd > romLength) {
      invalidSources++;
      warnings.push(`8FB entry ${entryIndex} source out of range ${hex(sourceStart)}-${hex(sourceEnd - 1)}`);
    }
    entries.push({
      entryIndex,
      kind: 'copy',
      entryOffset: hex(baseOffset + start),
      count,
      vramTileRange: {
        start: hex(curVramTile, 3),
        end: hex(curVramTile + count - 1, 3),
        count,
      },
      source: {
        bank: curBank,
        blockIndex: hex(curBlockIdx, 3),
        romStart: hex(sourceStart),
        romEndExclusive: hex(sourceEnd),
        sizeBytes: Math.max(0, sourceEnd - sourceStart),
      },
    });
    totalTiles += count;
    maxVramTile = Math.max(maxVramTile, curVramTile + count - 1);
    curVramTile += count;
    curBlockIdx += count;
  }

  return {
    format: '8fb',
    terminated,
    endReason,
    consumedBytes: pc,
    entries,
    warnings,
    stats: {
      copyEntries: entries.length,
      zeroEntries: 0,
      totalTiles,
      zeroTiles: 0,
      invalidSources,
      maxVramTile: maxVramTile < 0 ? null : hex(maxVramTile, 3),
    },
  };
}

function decode998(bytes, baseOffset, romLength) {
  const entries = [];
  const warnings = [];
  let pc = 0;
  let vramPtr = 0;
  let terminated = false;
  let endReason = 'Unexpected EOF';
  let totalTiles = 0;
  let zeroTiles = 0;
  let invalidSources = 0;
  let maxVramTile = -1;

  for (let entryIndex = 0; entryIndex < 512 && pc < bytes.length; entryIndex++) {
    const start = pc;
    const op = bytes[pc++];
    if (op === 0) {
      terminated = true;
      endReason = `END @ ${hex(baseOffset + start)}`;
      break;
    }
    const hasSetPos = !!(op & 0x80);
    const count = op & 0x7F;
    let tileSlot = null;
    if (hasSetPos) {
      if (pc >= bytes.length) {
        endReason = `Truncated 998 set-pos @ ${hex(baseOffset + start)}`;
        warnings.push(endReason);
        break;
      }
      tileSlot = bytes[pc++];
      vramPtr = tileSlot * 32;
    }
    const vramTile = vramPtr >> 5;
    if (count === 0x7F) {
      entries.push({
        entryIndex,
        kind: 'zero',
        entryOffset: hex(baseOffset + start),
        count: 1,
        setPos: hasSetPos,
        tileSlot: tileSlot == null ? null : hex(tileSlot, 2),
        vramTileRange: { start: hex(vramTile, 3), end: hex(vramTile, 3), count: 1 },
        source: null,
      });
      totalTiles += 1;
      zeroTiles += 1;
      maxVramTile = Math.max(maxVramTile, vramTile);
      vramPtr += 32;
      continue;
    }
    if (count === 0) {
      entries.push({
        entryIndex,
        kind: 'noop',
        entryOffset: hex(baseOffset + start),
        count: 0,
        setPos: hasSetPos,
        tileSlot: tileSlot == null ? null : hex(tileSlot, 2),
        vramTileRange: { start: hex(vramTile, 3), end: hex(vramTile, 3), count: 0 },
        source: null,
      });
      continue;
    }
    if (pc + 1 >= bytes.length) {
      endReason = `Truncated 998 copy @ ${hex(baseOffset + start)}`;
      warnings.push(endReason);
      break;
    }
    const srcLo = bytes[pc++];
    const srcHi = bytes[pc++];
    const bank = srcHi >> 1;
    const blockIndex = ((srcHi & 1) << 8) | srcLo;
    const sourceStart = bank * 0x4000 + blockIndex * 32;
    const sourceEnd = sourceStart + count * 32;
    if (sourceStart < 0 || sourceEnd > romLength) {
      invalidSources++;
      warnings.push(`998 entry ${entryIndex} source out of range ${hex(sourceStart)}-${hex(sourceEnd - 1)}`);
    }
    entries.push({
      entryIndex,
      kind: 'copy',
      entryOffset: hex(baseOffset + start),
      count,
      setPos: hasSetPos,
      tileSlot: tileSlot == null ? null : hex(tileSlot, 2),
      vramTileRange: {
        start: hex(vramTile, 3),
        end: hex(vramTile + count - 1, 3),
        count,
      },
      source: {
        bank,
        blockIndex: hex(blockIndex, 3),
        romStart: hex(sourceStart),
        romEndExclusive: hex(sourceEnd),
        sizeBytes: Math.max(0, sourceEnd - sourceStart),
      },
    });
    totalTiles += count;
    maxVramTile = Math.max(maxVramTile, vramTile + count - 1);
    vramPtr += count * 32;
  }

  return {
    format: '998',
    terminated,
    endReason,
    consumedBytes: pc,
    entries,
    warnings,
    stats: {
      copyEntries: entries.filter(entry => entry.kind === 'copy').length,
      zeroEntries: entries.filter(entry => entry.kind === 'zero').length,
      noopEntries: entries.filter(entry => entry.kind === 'noop').length,
      totalTiles,
      zeroTiles,
      invalidSources,
      maxVramTile: maxVramTile < 0 ? null : hex(maxVramTile, 3),
    },
  };
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(interval => interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) {
      merged.push({ ...interval });
    } else {
      last.end = Math.max(last.end, interval.end);
    }
  }
  return merged;
}

function buildLoaderEntry(rom, mapData, region) {
  const offset = parseInt(region.offset, 16);
  const size = region.size || 0;
  const bytes = rom.subarray(offset, offset + size);
  const decoded = region.type === 'vram_loader_8fb'
    ? decode8fb(bytes, offset, rom.length)
    : decode998(bytes, offset, rom.length);
  const copyEntries = decoded.entries.filter(entry => entry.kind === 'copy');
  const sourceIntervals = copyEntries.map(entry => ({
    start: parseInt(entry.source.romStart, 16),
    end: parseInt(entry.source.romEndExclusive, 16),
  }));
  const mergedSourceIntervals = mergeIntervals(sourceIntervals);
  const sourceRegions = [];
  const seenSourceRegions = new Set();
  for (const interval of mergedSourceIntervals) {
    for (const sourceRegion of findOverlappingRegions(mapData, interval.start, interval.end)) {
      if (seenSourceRegions.has(sourceRegion.id)) continue;
      seenSourceRegions.add(sourceRegion.id);
      sourceRegions.push(sourceRegion);
    }
  }
  const entries = decoded.entries.map(entry => {
    const source = entry.source ? {
      ...entry.source,
      overlappingRegions: findOverlappingRegions(
        mapData,
        parseInt(entry.source.romStart, 16),
        parseInt(entry.source.romEndExclusive, 16),
      ),
    } : null;
    return {
      ...entry,
      source,
    };
  });

  return {
    id: `${region.id}_${region.type}_${offset.toString(16).toUpperCase()}`,
    loaderRegion: regionRef(region),
    format: decoded.format,
    terminated: decoded.terminated,
    endReason: decoded.endReason,
    consumedBytes: decoded.consumedBytes,
    declaredRegionBytes: size,
    stats: decoded.stats,
    sourceRanges: mergedSourceIntervals.map(interval => ({
      romStart: hex(interval.start),
      romEndExclusive: hex(interval.end),
      sizeBytes: interval.end - interval.start,
      tileCount: (interval.end - interval.start) / 32,
      overlappingRegions: findOverlappingRegions(mapData, interval.start, interval.end),
    })),
    sourceRegions,
    warnings: decoded.warnings,
    entries,
  };
}

function summarizeSourceCoverage(loaderEntries) {
  const byRegion = new Map();
  for (const loader of loaderEntries) {
    for (const range of loader.sourceRanges) {
      for (const region of range.overlappingRegions) {
        if (!byRegion.has(region.id)) {
          byRegion.set(region.id, {
            region,
            loaderCount: 0,
            sourceRangeCount: 0,
            referencedBytes: 0,
            loaderRefs: [],
          });
        }
        const item = byRegion.get(region.id);
        item.sourceRangeCount++;
        item.referencedBytes += range.sizeBytes;
        if (!item.loaderRefs.includes(loader.loaderRegion.id)) {
          item.loaderRefs.push(loader.loaderRegion.id);
          item.loaderCount++;
        }
      }
    }
  }
  return [...byRegion.values()].sort((a, b) => {
    const ao = parseInt(a.region.offset, 16);
    const bo = parseInt(b.region.offset, 16);
    return ao - bo;
  });
}

function buildCatalog(rom, mapData) {
  const loaderRegions = mapData.regions
    .filter(region => region.type === 'vram_loader_8fb' || region.type === 'vram_loader_998')
    .sort((a, b) => parseInt(a.offset, 16) - parseInt(b.offset, 16));
  const loaderEntries = loaderRegions.map(region => buildLoaderEntry(rom, mapData, region));
  const sourceCoverageByRegion = summarizeSourceCoverage(loaderEntries);
  const totals = loaderEntries.reduce((acc, loader) => {
    acc.totalTiles += loader.stats.totalTiles || 0;
    acc.zeroTiles += loader.stats.zeroTiles || 0;
    acc.copyEntries += loader.stats.copyEntries || 0;
    acc.zeroEntries += loader.stats.zeroEntries || 0;
    acc.invalidSources += loader.stats.invalidSources || 0;
    acc.warnings += loader.warnings.length;
    if (loader.format === '8fb') acc.loader8fb++;
    if (loader.format === '998') acc.loader998++;
    return acc;
  }, {
    loader8fb: 0,
    loader998: 0,
    totalTiles: 0,
    zeroTiles: 0,
    copyEntries: 0,
    zeroEntries: 0,
    invalidSources: 0,
    warnings: 0,
  });

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-tile-source-audit.mjs',
    summary: {
      loaderRegions: loaderEntries.length,
      ...totals,
      sourceRegionCount: sourceCoverageByRegion.length,
      assetPolicy: 'Metadata only: loader offsets, source ranges, VRAM tile ranges, counts, and region references. No ROM bytes or decoded graphics are embedded.',
    },
    loaderEntries,
    sourceCoverageByRegion,
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  for (const entry of catalog.loaderEntries) {
    const region = mapData.regions.find(r => r.id === entry.loaderRegion.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.tileSourceAudit = {
      catalogId,
      kind: 'tile_source_loader',
      summary: `${entry.format.toUpperCase()} loader resolves ${entry.stats.totalTiles || 0} tile slots from ${entry.sourceRanges.length} merged source range(s).`,
      confidence: entry.warnings.length || entry.stats.invalidSources ? 'medium' : 'high',
      format: entry.format,
      stats: entry.stats,
      terminated: entry.terminated,
      endReason: entry.endReason,
      consumedBytes: entry.consumedBytes,
      declaredRegionBytes: entry.declaredRegionBytes,
      sourceRegions: entry.sourceRegions,
      warningCount: entry.warnings.length,
      evidence: [
        `Region ${entry.loaderRegion.id} is typed ${entry.loaderRegion.type} from ASM loader call-site analysis.`,
        `${entry.format.toUpperCase()} loader decoding follows _LABEL_8FB_/_LABEL_998_ semantics already used by the simulator VRAM provenance pipeline.`,
      ],
      generatedAt: now,
      tool: 'tools/world-tile-source-audit.mjs',
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      type: region.type || 'unknown',
      format: entry.format,
      totalTiles: entry.stats.totalTiles || 0,
      sourceRanges: entry.sourceRanges.length,
      warnings: entry.warnings.length,
    });
  }
  return annotated;
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : catalog.loaderEntries.map(entry => ({
    id: entry.loaderRegion.id,
    offset: entry.loaderRegion.offset,
    name: entry.loaderRegion.name,
    type: entry.loaderRegion.type,
    format: entry.format,
    totalTiles: entry.stats.totalTiles || 0,
    sourceRanges: entry.sourceRanges.length,
    warnings: entry.warnings.length,
  }));

  if (apply) {
    mapData.tileSourceCatalogs = (mapData.tileSourceCatalogs || []).filter(c => c.id !== catalogId);
    mapData.tileSourceCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'tile_source_audit',
      generatedAt: now,
      tool: 'tools/world-tile-source-audit.mjs --apply',
      schemaVersion: 1,
      summary: catalog.summary,
      annotatedRegions,
      sourceCoverageByRegion: catalog.sourceCoverageByRegion,
      nextLeads: [
        'Connect tileSourceCatalogs to sceneRecipes so each recipe can name all source tile ranges needed to reproduce a screen.',
        'Add a loader-source coverage panel in the analyzer to highlight unreferenced graphics-bank ranges without displaying copyrighted tile graphics.',
        'Resolve loader regions with warnings or unterminated decodes before using them as authoritative scene dependencies.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions,
    sourceCoverageByRegion: catalog.sourceCoverageByRegion,
  }, null, 2));
}

main();
