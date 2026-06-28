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
const toolName = 'tools/world-vram998-entrypoint-variant-audit.mjs';
const catalogId = 'world-vram998-entrypoint-variant-catalog-2026-06-26';
const reportId = 'vram998-entrypoint-variant-audit-2026-06-26';
const tileSizeBytes = 32;

const knownVariantTables = [
  {
    id: 'r0022_indexed_998_variants',
    regionId: 'r0022',
    baseOffset: 0x01C48,
    entryCount: 4,
    strideBytes: 5,
    selectorRoutine: '_LABEL_1C31_',
    loaderRoutine: '_LABEL_998_',
    selector: 'A & 0x03, then base + index * 5',
    evidence: [
      'ASM line 5006 loads HL with _DATA_1C48_.',
      'ASM lines 5007-5014 mask A to two bits and compute HL + index * 5.',
      'ASM line 5018 jumps to _LABEL_998_ with HL pointing at the selected 5-byte stream.',
      'ASM lines 5020-5023 define _DATA_1C48_ as 20 bytes, matching four 5-byte 998 streams.',
    ],
  },
];

function hex(value, pad = 5) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 16);
  return NaN;
}

function regionStart(region) {
  return offsetOf(region.offset);
}

function regionEnd(region) {
  return regionStart(region) + (region.size || 0);
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    name: region.name || '',
    type: region.type || 'unknown',
    offset: region.offset || '',
    size: region.size || 0,
  };
}

function regionsOverlapping(mapData, start, endExclusive) {
  return (mapData.regions || [])
    .filter(region => region.type === 'gfx_tiles')
    .filter(region => start < regionEnd(region) && regionStart(region) < endExclusive)
    .map(compactRegion);
}

function readWordLE(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function sourceFrom998Word(mapData, word, count) {
  const bank = word >> 9;
  const blockIndex = word & 0x01FF;
  const romStart = bank * 0x4000 + blockIndex * tileSizeBytes;
  const romEndExclusive = romStart + count * tileSizeBytes;
  return {
    bank,
    blockIndex: hex(blockIndex, 3),
    romStart: hex(romStart),
    romEndExclusive: hex(romEndExclusive),
    sizeBytes: romEndExclusive - romStart,
    overlappingRegions: regionsOverlapping(mapData, romStart, romEndExclusive),
  };
}

function mergeSourceRanges(entries) {
  const ranges = entries
    .filter(entry => entry.source)
    .map(entry => ({
      start: offsetOf(entry.source.romStart),
      endExclusive: offsetOf(entry.source.romEndExclusive),
      source: entry.source,
    }))
    .filter(range => Number.isFinite(range.start) && Number.isFinite(range.endExclusive) && range.endExclusive > range.start)
    .sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.endExclusive) {
      merged.push({ start: range.start, endExclusive: range.endExclusive, sources: [range.source] });
      continue;
    }
    if (range.endExclusive > last.endExclusive) last.endExclusive = range.endExclusive;
    last.sources.push(range.source);
  }
  return merged.map(range => ({
    romStart: hex(range.start),
    romEndExclusive: hex(range.endExclusive),
    sizeBytes: range.endExclusive - range.start,
    tileCount: (range.endExclusive - range.start) / tileSizeBytes,
    overlappingRegions: [...new Map(range.sources
      .flatMap(source => source.overlappingRegions || [])
      .map(region => [region.id, region])).values()]
      .sort((a, b) => offsetOf(a.offset) - offsetOf(b.offset) || String(a.id).localeCompare(String(b.id))),
  }));
}

function decodeSingle998Stream(mapData, rom, startOffset, endExclusive, variantIndex) {
  const entries = [];
  const warnings = [];
  let pc = startOffset;
  let vramPtr = 0;
  let terminated = false;
  let endReason = 'Unexpected EOF';
  let totalTiles = 0;
  let maxVramTile = -1;

  if (pc >= endExclusive) {
    warnings.push('Variant stream starts outside declared stride.');
    return { entries, warnings, terminated, endReason, consumedBytes: 0, totalTiles, maxVramTile };
  }

  const entryOffset = pc;
  const opcode = rom[pc++];
  if (opcode === 0x00) {
    terminated = true;
    endReason = `END @ ${hex(entryOffset)}`;
    return { entries, warnings, terminated, endReason, consumedBytes: pc - startOffset, totalTiles, maxVramTile };
  }

  const setPos = Boolean(opcode & 0x80);
  const count = opcode & 0x7F;
  let tileSlot = null;
  if (setPos) {
    if (pc >= endExclusive) {
      warnings.push(`Truncated 998 set-pos @ ${hex(entryOffset)}`);
      return { entries, warnings, terminated, endReason, consumedBytes: pc - startOffset, totalTiles, maxVramTile };
    }
    tileSlot = rom[pc++];
    vramPtr = tileSlot * tileSizeBytes;
  }

  if (count === 0x7F) {
    entries.push({
      entryIndex: 0,
      variantIndex,
      kind: 'zero',
      entryOffset: hex(entryOffset),
      count: 1,
      setPos,
      tileSlot: tileSlot == null ? null : hex(tileSlot, 2),
      vramTileRange: {
        start: hex(vramPtr / tileSizeBytes, 3),
        end: hex(vramPtr / tileSizeBytes, 3),
        count: 1,
      },
      source: null,
    });
    totalTiles = 1;
    maxVramTile = vramPtr / tileSizeBytes;
  } else if (count > 0) {
    if (pc + 1 >= endExclusive) {
      warnings.push(`Truncated 998 source word @ ${hex(entryOffset)}`);
      return { entries, warnings, terminated, endReason, consumedBytes: pc - startOffset, totalTiles, maxVramTile };
    }
    const sourceWordOffset = pc;
    const sourceWord = readWordLE(rom, pc);
    pc += 2;
    const source = sourceFrom998Word(mapData, sourceWord, count);
    const vramStartTile = vramPtr / tileSizeBytes;
    entries.push({
      entryIndex: 0,
      variantIndex,
      kind: 'copy',
      entryOffset: hex(entryOffset),
      sourceWordOffset: hex(sourceWordOffset),
      sourceWord: hex(sourceWord, 4),
      count,
      setPos,
      tileSlot: tileSlot == null ? null : hex(tileSlot, 2),
      vramTileRange: {
        start: hex(vramStartTile, 3),
        end: hex(vramStartTile + count - 1, 3),
        count,
      },
      source,
    });
    totalTiles = count;
    maxVramTile = vramStartTile + count - 1;
  } else {
    entries.push({
      entryIndex: 0,
      variantIndex,
      kind: 'noop',
      entryOffset: hex(entryOffset),
      count: 0,
      setPos,
      tileSlot: tileSlot == null ? null : hex(tileSlot, 2),
      vramTileRange: null,
      source: null,
    });
  }

  if (pc < endExclusive && rom[pc] === 0x00) {
    terminated = true;
    endReason = `END @ ${hex(pc)}`;
    pc++;
  } else {
    warnings.push(`No 998 terminator found inside variant stride ending at ${hex(endExclusive)}`);
  }

  return {
    entries,
    warnings,
    terminated,
    endReason,
    consumedBytes: pc - startOffset,
    totalTiles,
    maxVramTile,
  };
}

function buildVariantTable(mapData, rom, spec) {
  const region = (mapData.regions || []).find(item => item.id === spec.regionId);
  if (!region) throw new Error(`Missing region ${spec.regionId}`);
  const regionOffset = regionStart(region);
  const tableEnd = spec.baseOffset + spec.entryCount * spec.strideBytes;
  const variants = [];
  const allEntries = [];
  const warnings = [];

  if (regionOffset !== spec.baseOffset || regionEnd(region) < tableEnd) {
    warnings.push(`Region ${spec.regionId} does not fully cover configured variant table.`);
  }

  for (let index = 0; index < spec.entryCount; index++) {
    const start = spec.baseOffset + index * spec.strideBytes;
    const endExclusive = start + spec.strideBytes;
    const decoded = decodeSingle998Stream(mapData, rom, start, endExclusive, index);
    warnings.push(...decoded.warnings);
    const variantId = `${spec.regionId}_998_variant_${hex(start)}`;
    const entries = decoded.entries.map(entry => ({
      ...entry,
      loaderEntryId: variantId,
    }));
    allEntries.push(...entries);
    variants.push({
      id: variantId,
      variantIndex: index,
      streamOffset: hex(start),
      streamEndExclusive: hex(endExclusive),
      strideBytes: spec.strideBytes,
      format: '998',
      terminated: decoded.terminated,
      endReason: decoded.endReason,
      consumedBytes: decoded.consumedBytes,
      stats: {
        copyEntries: entries.filter(entry => entry.kind === 'copy').length,
        zeroEntries: entries.filter(entry => entry.kind === 'zero').length,
        noopEntries: entries.filter(entry => entry.kind === 'noop').length,
        totalTiles: decoded.totalTiles,
        maxVramTile: decoded.maxVramTile < 0 ? null : hex(decoded.maxVramTile, 3),
      },
      sourceRanges: mergeSourceRanges(entries),
      entries,
    });
  }

  const sourceRanges = mergeSourceRanges(allEntries);
  const sourceRegions = new Map();
  for (const range of sourceRanges) {
    for (const sourceRegion of range.overlappingRegions || []) {
      sourceRegions.set(sourceRegion.id, sourceRegion);
    }
  }

  return {
    id: spec.id,
    loaderRegion: compactRegion(region),
    format: '998',
    kind: 'fixed_stride_entrypoint_variant_table',
    selectorRoutine: spec.selectorRoutine,
    loaderRoutine: spec.loaderRoutine,
    selector: spec.selector,
    tableOffset: hex(spec.baseOffset),
    tableEndExclusive: hex(tableEnd),
    entryCount: spec.entryCount,
    strideBytes: spec.strideBytes,
    totalTiles: allEntries.reduce((sum, entry) => sum + (entry.kind === 'copy' || entry.kind === 'zero' ? entry.count : 0), 0),
    copyEntries: allEntries.filter(entry => entry.kind === 'copy').length,
    zeroEntries: allEntries.filter(entry => entry.kind === 'zero').length,
    noopEntries: allEntries.filter(entry => entry.kind === 'noop').length,
    warningCount: warnings.length,
    warnings,
    sourceRanges,
    sourceRegions: [...sourceRegions.values()].sort((a, b) => offsetOf(a.offset) - offsetOf(b.offset)),
    variants,
    evidence: spec.evidence,
  };
}

function buildCatalog(mapData, rom) {
  const variantTables = knownVariantTables.map(spec => buildVariantTable(mapData, rom, spec));
  const summary = variantTables.reduce((acc, table) => {
    acc.variantTableCount++;
    acc.variantStreamCount += table.variants.length;
    acc.copyEntries += table.copyEntries;
    acc.zeroEntries += table.zeroEntries;
    acc.noopEntries += table.noopEntries;
    acc.totalTiles += table.totalTiles;
    acc.sourceRangeCount += table.sourceRanges.length;
    acc.warningCount += table.warningCount;
    for (const sourceRegion of table.sourceRegions) acc.sourceRegionIds.add(sourceRegion.id);
    return acc;
  }, {
    variantTableCount: 0,
    variantStreamCount: 0,
    copyEntries: 0,
    zeroEntries: 0,
    noopEntries: 0,
    totalTiles: 0,
    sourceRangeCount: 0,
    warningCount: 0,
    sourceRegionIds: new Set(),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    assetPolicy: 'Metadata only: loader offsets, selector evidence, decoded counts, source offsets/ranges, and region ids. No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are embedded.',
  });
  summary.sourceRegionIds = [...summary.sourceRegionIds].sort();
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary,
    variantTables,
    evidence: [
      '_DATA_1C48_ is not one linear 998 stream; _LABEL_1C31_ selects one of four 5-byte streams before jumping to _LABEL_998_.',
      'Each variant stream is decoded with the same _LABEL_998_ source-word semantics used by the simulator and existing tile-source catalog.',
      'No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.',
    ],
    nextLeads: [
      'Feed fixed-stride 998 variant source ranges into combined graphics source coverage.',
      'Search other short 998 loader regions for indexed entrypoint selectors before treating bytes after the first terminator as unused.',
      'Use the variant table source ranges to reduce false unreferenced graphics-source leads.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  for (const table of catalog.variantTables) {
    const region = (mapData.regions || []).find(item => item.id === table.loaderRegion.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.vram998EntrypointVariantAudit = {
      catalogId,
      kind: table.kind,
      confidence: table.warningCount ? 'medium_high' : 'high',
      selectorRoutine: table.selectorRoutine,
      loaderRoutine: table.loaderRoutine,
      selector: table.selector,
      tableOffset: table.tableOffset,
      tableEndExclusive: table.tableEndExclusive,
      entryCount: table.entryCount,
      strideBytes: table.strideBytes,
      copyEntries: table.copyEntries,
      totalTiles: table.totalTiles,
      sourceRangeCount: table.sourceRanges.length,
      sourceRegions: table.sourceRegions,
      warnings: table.warnings,
      summary: `${table.entryCount} fixed-stride _LABEL_998_ entrypoint variants selected by ${table.selectorRoutine}.`,
      evidence: table.evidence.concat([
        'Decoded source ranges are metadata only; no ROM bytes or decoded graphics are stored.',
      ]),
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      entryCount: table.entryCount,
      totalTiles: table.totalTiles,
      sourceRangeCount: table.sourceRanges.length,
      warningCount: table.warningCount,
    });
  }
  return annotatedRegions;
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotatedRegions = apply
    ? annotateMap(mapData, catalog)
    : catalog.variantTables.map(table => ({
      id: table.loaderRegion.id,
      offset: table.loaderRegion.offset,
      name: table.loaderRegion.name || '',
      entryCount: table.entryCount,
      totalTiles: table.totalTiles,
      sourceRangeCount: table.sourceRanges.length,
      warningCount: table.warningCount,
    }));

  if (apply) {
    mapData.tileSourceCatalogs = (mapData.tileSourceCatalogs || []).filter(item => item.id !== catalogId);
    mapData.tileSourceCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'vram998_entrypoint_variant_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      annotatedRegions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions,
    variantTables: catalog.variantTables.map(table => ({
      id: table.id,
      loaderRegion: table.loaderRegion,
      entryCount: table.entryCount,
      totalTiles: table.totalTiles,
      sourceRanges: table.sourceRanges,
      warningCount: table.warningCount,
    })),
  }, null, 2));
}

main();
