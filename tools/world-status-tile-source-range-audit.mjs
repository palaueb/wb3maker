#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-status-tile-source-range-audit.mjs';
const catalogId = 'world-status-tile-source-range-catalog-2026-06-26';
const reportId = 'status-tile-source-range-audit-2026-06-26';

const sourceCatalogs = [
  'world-status-vdp-writer-detail-catalog-2026-06-26',
  'world-graphics-coverage-catalog-2026-06-24',
  'world-dynamic-tile-source-table-catalog-2026-06-25',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = /^(?:0x|\$)?([0-9A-F]+)$/i.exec(String(value));
  return match ? parseInt(match[1], 16) : null;
}

function hex(value, pad = 2) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function catalogById(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item?.id === id);
    if (found) return found;
  }
  return null;
}

function regionStart(region) {
  return parseHex(region?.offset) ?? 0;
}

function regionEnd(region) {
  return regionStart(region) + Number(region?.size || 0);
}

function containingRegion(mapData, offset) {
  if (offset == null) return null;
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
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

function cleanCode(line) {
  return String(line || '').split(';')[0].trim();
}

function lineCode(lines, line) {
  return cleanCode(lines[line - 1] || '');
}

function expectLine(lines, line, expected) {
  const code = lineCode(lines, line);
  if (!code.includes(expected)) {
    throw new Error(`ASM invariant failed at line ${line}: expected "${expected}", got "${code}"`);
  }
  return { line, code, expected };
}

function buildSourceCatalogPresence(mapData) {
  return Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))]));
}

function parseDbBytes(lines, labelLine, expectedSize) {
  const bytes = [];
  for (let line = labelLine + 1; line <= lines.length && bytes.length < expectedSize; line++) {
    const code = lineCode(lines, line);
    if (!code) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*:$/.test(code)) break;
    const match = /^\.db\s+(.+)$/i.exec(code);
    if (!match) continue;
    const tokens = match[1].match(/\$[0-9A-F]{1,2}|\b[0-9A-F]{1,2}h\b|\b[0-9]{1,3}\b/gi) || [];
    for (const token of tokens) {
      const value = parseHex(token.trim().replace(/h$/i, ''));
      if (value == null || value < 0 || value > 0xFF) {
        throw new Error(`Invalid byte token at line ${line}: ${token}`);
      }
      bytes.push(value);
      if (bytes.length === expectedSize) break;
    }
  }
  if (bytes.length !== expectedSize) {
    throw new Error(`Expected ${expectedSize} selector bytes after line ${labelLine}, found ${bytes.length}`);
  }
  return bytes;
}

function buildLineChecks(lines) {
  return {
    uploadLabel: expectLine(lines, 6308, '_LABEL_25A4_:'),
    selectorTableLoad: expectLine(lines, 6310, 'ld hl, _DATA_25D6_'),
    entryIndexE: expectLine(lines, 6311, 'ld e, a'),
    entryIndexD: expectLine(lines, 6312, 'ld d, $00'),
    entryIndexAdd: expectLine(lines, 6313, 'add hl, de'),
    switchBank8Source: expectLine(lines, 6314, 'ld a, $08'),
    switchBank8: expectLine(lines, 6315, 'call _LABEL_1023_'),
    selectorRead: expectLine(lines, 6316, 'ld a, (hl)'),
    zeroCheck: expectLine(lines, 6317, 'or a'),
    zeroSkip: expectLine(lines, 6318, 'jr z, +'),
    selectorToE: expectLine(lines, 6319, 'ld e, a'),
    selectorToD: expectLine(lines, 6320, 'ld d, $00'),
    tileOffsetHelperCall: expectLine(lines, 6321, 'call _LABEL_B8F_'),
    graphicsSourceLoad: expectLine(lines, 6322, 'ld hl, _DATA_20000_'),
    graphicsSourceAdd: expectLine(lines, 6323, 'add hl, de'),
    sourcePointerToDe: expectLine(lines, 6324, 'ex de, hl'),
    vramControlLow: expectLine(lines, 6326, 'ld a, $00'),
    vramControlHigh: expectLine(lines, 6328, 'ld a, $62'),
    uploadCount: expectLine(lines, 6331, 'ld b, $40'),
    uploadRead: expectLine(lines, 6334, 'ld a, (de)'),
    uploadIncrement: expectLine(lines, 6335, 'inc de'),
    uploadWrite: expectLine(lines, 6336, 'rst $30'),
    uploadLoop: expectLine(lines, 6338, 'djnz -'),
    restoreBank: expectLine(lines, 6340, 'call _LABEL_1036_'),
    selectorTableLabel: expectLine(lines, 6345, '_DATA_25D6_:'),
    offsetHelperLabel: expectLine(lines, 2576, '_LABEL_B8F_:'),
    offsetHelperSwapIn: expectLine(lines, 2577, 'ex de, hl'),
    offsetHelperShift0: expectLine(lines, 2578, 'add hl, hl'),
    offsetHelperShift1: expectLine(lines, 2579, 'add hl, hl'),
    offsetHelperShift2: expectLine(lines, 2580, 'add hl, hl'),
    offsetHelperShift3: expectLine(lines, 2581, 'add hl, hl'),
    offsetHelperShift4: expectLine(lines, 2582, 'add hl, hl'),
    offsetHelperSwapOut: expectLine(lines, 2583, 'ex de, hl'),
    graphicsSourceLabel: expectLine(lines, 28889, '_DATA_20000_:'),
  };
}

function deriveEntries(selectorBytes, graphicsStart, graphicsEnd) {
  return selectorBytes.map((selector, index) => {
    if (selector === 0) {
      return {
        entryIndex: index,
        selectorBytePersisted: false,
        uploadSkipped: true,
        skipReason: 'selector_zero',
      };
    }
    const sourceStart = graphicsStart + selector * 32;
    const sizeBytes = 64;
    const sourceEndExclusive = sourceStart + sizeBytes;
    return {
      entryIndex: index,
      selectorBytePersisted: false,
      uploadSkipped: false,
      sourceLabel: '_DATA_20000_',
      sourceRange: {
        start: hex(sourceStart, 5),
        endExclusive: hex(sourceEndExclusive, 5),
        sizeBytes,
      },
      sourceWithinGraphicsRegion: sourceStart >= graphicsStart && sourceEndExclusive <= graphicsEnd,
      vramDestination: {
        address: '0x6200',
        sizeBytes,
      },
      derivation: 'sourceStart = _DATA_20000_ + selectorByte * 32; uploadSize = 64 bytes',
    };
  });
}

function uniqueRanges(entries) {
  const ranges = new Map();
  for (const entry of entries) {
    if (entry.uploadSkipped) continue;
    const key = `${entry.sourceRange.start}:${entry.sourceRange.endExclusive}`;
    ranges.set(key, entry.sourceRange);
  }
  return [...ranges.values()].sort((a, b) => parseHex(a.start) - parseHex(b.start));
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const selectorRegion = containingRegion(mapData, 0x025D6);
  const uploadRegion = containingRegion(mapData, 0x025A4);
  const helperRegion = containingRegion(mapData, 0x00B8F);
  const graphicsRegion = containingRegion(mapData, 0x20000);
  if (!selectorRegion || Number(selectorRegion.size || 0) !== 14) {
    throw new Error('Expected _DATA_25D6_ selector region size 14 at 0x025D6');
  }
  if (!graphicsRegion || regionStart(graphicsRegion) !== 0x20000) {
    throw new Error('Expected _DATA_20000_ graphics source region at 0x20000');
  }
  const selectorBytes = parseDbBytes(lines, 6345, 14);
  const entries = deriveEntries(selectorBytes, 0x20000, regionEnd(graphicsRegion));
  const uploadEntries = entries.filter(entry => !entry.uploadSkipped);
  const skippedEntries = entries.filter(entry => entry.uploadSkipped);
  const ranges = uniqueRanges(entries);
  const warnings = [];
  for (const entry of uploadEntries) {
    if (!entry.sourceWithinGraphicsRegion) {
      warnings.push({
        entryIndex: entry.entryIndex,
        warning: 'source_range_outside_graphics_region',
        sourceRange: entry.sourceRange,
      });
    }
  }

  const evidence = [
    'ASM lines 6308-6318 show _LABEL_25A4_ indexing _DATA_25D6_ by the caller-provided status segment value and skipping upload when the selected byte is zero.',
    'ASM lines 6319-6324 show nonzero selectors moved into DE, converted by _LABEL_B8F_, then added to _DATA_20000_ to form the source pointer.',
    'ASM lines 2576-2584 prove _LABEL_B8F_ multiplies the selector by 32 through five left shifts.',
    'ASM lines 6326-6338 set VRAM address 0x6200 and upload 0x40 bytes from the computed _DATA_20000_ source pointer.',
    'ASM line 6345 identifies _DATA_25D6_; current map region r0029 confirms it spans 14 bytes.',
    'ASM line 28889 identifies _DATA_20000_; current map region r0754 confirms it spans 0x20000-0x23FFF.',
    'This audit reads selector bytes from the local ASM to derive ranges, but persists only entry indexes, source offsets/ranges, sizes, counts, and evidence. It does not persist selector bytes, decoded graphics, pixels, screenshots, text, timing bytes, or audio data.',
  ];

  return {
    id: catalogId,
    type: 'status_tile_source_range_catalog',
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: buildSourceCatalogPresence(mapData),
    scope: {
      selectorTable: '_DATA_25D6_',
      selectorTableOffset: '0x025D6',
      selectorEntryCount: entries.length,
      selectorBytePersisted: false,
      uploadRoutine: '_LABEL_25A4_',
      offsetHelper: '_LABEL_B8F_',
      graphicsSource: '_DATA_20000_',
      graphicsSourceOffset: '0x20000',
      vramDestination: '0x6200',
      uploadByteCount: 64,
      sourceOffsetFormula: '0x20000 + selectorByte * 32',
      dataBytesPersisted: false,
    },
    entries,
    uniqueSourceRanges: ranges,
    lineChecks,
    relatedRegions: {
      selectorTable: compactRegion(selectorRegion),
      uploadRoutine: compactRegion(uploadRegion),
      offsetHelper: compactRegion(helperRegion),
      graphicsSource: compactRegion(graphicsRegion),
    },
    summary: {
      status: 'status_tile_source_ranges_cataloged',
      confidence: 'high_for_selector_consumer_and_derived_source_ranges',
      selectorEntryCount: entries.length,
      uploadEntryCount: uploadEntries.length,
      skippedEntryCount: skippedEntries.length,
      uniqueSourceRangeCount: ranges.length,
      uploadByteCount: 64,
      totalUploadBytesIfAllEntriesUsed: uploadEntries.length * 64,
      warningCount: warnings.length,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    warnings,
    evidence,
    nextLeads: [
      'Add a browser-local preview that reads _DATA_25D6_ and _DATA_20000_ from the user ROM, then renders the selected 0x6200 status tile upload without committing bytes.',
      'Trace callers of _LABEL_2518_ to determine which status segment indexes reach _LABEL_25A4_ in gameplay, shop, and equipment flows.',
      'Connect these derived source ranges to graphics coverage so status/HUD tile-source usage contributes to asset coverage reporting.',
    ],
  };
}

function annotateRegion(region, value, annotatedRegions) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis.statusTileSourceRangeAudit = value;
  annotatedRegions.push(compactRegion(region));
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const evidence = catalog.evidence;

  annotateRegion(containingRegion(mapData, 0x025A4), {
    catalogId,
    kind: 'status_tile_source_range_upload_routine',
    confidence: 'high',
    summary: '_LABEL_25A4_ indexes _DATA_25D6_, skips zero selectors, derives _DATA_20000_ source ranges through _LABEL_B8F_, and uploads 64 bytes to VRAM address 0x6200.',
    selectorEntryCount: catalog.summary.selectorEntryCount,
    uploadEntryCount: catalog.summary.uploadEntryCount,
    skippedEntryCount: catalog.summary.skippedEntryCount,
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x025D6), {
    catalogId,
    kind: 'status_tile_source_selector_table',
    confidence: 'high_for_consumer_and_size',
    selectorEntryCount: catalog.summary.selectorEntryCount,
    selectorBytePersisted: false,
    uploadEntryCount: catalog.summary.uploadEntryCount,
    skippedEntryCount: catalog.summary.skippedEntryCount,
    summary: '_DATA_25D6_ is a 14-entry selector table consumed by _LABEL_25A4_; selector bytes are not persisted, only derived source ranges and skip status.',
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x00B8F), {
    catalogId,
    kind: 'status_tile_selector_to_source_offset_helper',
    confidence: 'high',
    operation: 'DE = selector * 32',
    summary: '_LABEL_B8F_ converts a nonzero _DATA_25D6_ selector into a byte offset added to _DATA_20000_.',
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(containingRegion(mapData, 0x20000), {
    catalogId,
    kind: 'status_tile_graphics_source_ranges',
    confidence: 'high_for_derived_offsets',
    sourceRangeCount: catalog.summary.uniqueSourceRangeCount,
    uploadByteCount: catalog.summary.uploadByteCount,
    ranges: catalog.uniqueSourceRanges,
    summary: '_DATA_20000_ supplies the status tile source ranges selected by _DATA_25D6_ and uploaded to VRAM 0x6200 by _LABEL_25A4_.',
    evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  return { annotatedRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  let annotation = { annotatedRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    mapData.tileSourceCatalogs = (mapData.tileSourceCatalogs || []).filter(item => item.id !== catalogId);
    mapData.tileSourceCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'status_tile_source_range_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs,
      sourceCatalogPresence: catalog.sourceCatalogPresence,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotation.annotatedRegions.length,
      },
      scope: catalog.scope,
      entries: catalog.entries,
      uniqueSourceRanges: catalog.uniqueSourceRanges,
      relatedRegions: catalog.relatedRegions,
      annotatedRegions: annotation.annotatedRegions,
      warnings: catalog.warnings,
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
      annotatedRegionCount: annotation.annotatedRegions.length,
    },
    sourceCatalogPresence: catalog.sourceCatalogPresence,
    relatedRegions: catalog.relatedRegions,
    entries: catalog.entries.map(entry => ({
      entryIndex: entry.entryIndex,
      uploadSkipped: entry.uploadSkipped,
      sourceRange: entry.sourceRange || null,
    })),
  }, null, 2));
}

main();
