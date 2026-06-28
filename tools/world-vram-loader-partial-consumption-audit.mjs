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
const toolName = 'tools/world-vram-loader-partial-consumption-audit.mjs';
const tileSourceCatalogId = 'world-tile-source-catalog-2026-06-24';
const vram998VariantCatalogId = 'world-vram998-entrypoint-variant-catalog-2026-06-26';
const catalogId = 'world-vram-loader-partial-consumption-catalog-2026-06-26';
const reportId = 'vram-loader-partial-consumption-audit-2026-06-26';

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

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function countTailBytes(rom, start, endExclusive) {
  let zeroBytes = 0;
  let nonzeroBytes = 0;
  for (let offset = start; offset < endExclusive && offset < rom.length; offset++) {
    if (rom[offset] === 0) zeroBytes++;
    else nonzeroBytes++;
  }
  return {
    zeroBytes,
    nonzeroBytes,
    allZero: nonzeroBytes === 0,
  };
}

function variantTableForRegion(variantCatalog, regionId) {
  return (variantCatalog?.variantTables || []).find(table => table.loaderRegion?.id === regionId) || null;
}

function asmDirectiveEvidence(region) {
  const census = region?.analysis?.asmDataLabelCensusAudit;
  const directiveCounts = census?.directiveCounts || {};
  const evidence = [];
  if (directiveCounts['.dsb']) {
    evidence.push(`ASM data-label census reports ${directiveCounts['.dsb']} .dsb directive(s) in this mapped region.`);
  }
  if (census?.labels?.length) {
    const label = census.labels[0];
    evidence.push(`ASM data-label census anchors ${label.label || region.name || region.id} at ${label.offset || region.offset}.`);
  }
  return evidence;
}

function classifyPartialEntry(mapData, rom, variantCatalog, loader) {
  const region = findRegionById(mapData, loader.loaderRegion.id);
  const regionStart = offsetOf(loader.loaderRegion.offset);
  const consumedEndExclusive = regionStart + (loader.consumedBytes || 0);
  const regionEndExclusive = regionStart + (loader.declaredRegionBytes || 0);
  const tailBytes = Math.max(0, regionEndExclusive - consumedEndExclusive);
  const tailStats = countTailBytes(rom, consumedEndExclusive, regionEndExclusive);
  const variantTable = variantTableForRegion(variantCatalog, loader.loaderRegion.id);
  const hasDsbDirective = Boolean(region?.analysis?.asmDataLabelCensusAudit?.directiveCounts?.['.dsb']);

  let classification;
  let confidence;
  let summary;
  const evidence = [
    `The parsed ${String(loader.format || '').toUpperCase()} loader terminates at ${hex(consumedEndExclusive - 1)} after ${loader.consumedBytes} byte(s).`,
    `The mapped region continues to ${hex(regionEndExclusive)} for ${tailBytes} byte(s) after the parsed loader stream.`,
  ];

  if (variantTable) {
    classification = 'fixed_stride_entrypoint_variants_confirmed';
    confidence = 'high';
    summary = 'Linear decode stops after the first selected stream, but a fixed-stride entrypoint variant catalog confirms the whole mapped table is loader data.';
    evidence.push(
      `${vram998VariantCatalogId} confirms ${variantTable.entryCount} fixed-stride _LABEL_998_ entrypoint variants for this region.`,
      `Variant table evidence: ${variantTable.selectorRoutine || 'selector routine unknown'} selects ${variantTable.tableOffset || loader.loaderRegion.offset}-${variantTable.tableEndExclusive || hex(regionEndExclusive)}.`,
    );
  } else if (tailStats.allZero) {
    classification = 'zero_padding_after_terminator';
    confidence = hasDsbDirective ? 'high' : 'medium_high';
    summary = 'Trailing bytes after the parsed loader terminator are all zero padding and do not form another confirmed loader stream.';
    evidence.push('All bytes after the consumed loader terminator are zero in the local ROM.');
    evidence.push(...asmDirectiveEvidence(region));
  } else {
    classification = 'nonzero_trailing_bytes_need_trace';
    confidence = 'low';
    summary = 'Trailing nonzero bytes remain after the parsed loader terminator and need separate consumer/boundary analysis.';
    evidence.push('The residual range contains nonzero byte(s), so it is retained as an unresolved loader-boundary lead.');
    evidence.push(...asmDirectiveEvidence(region));
  }

  evidence.push('No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.');

  return {
    id: `${loader.loaderRegion.id}_partial_consumption`,
    loaderRegion: compactRegion(loader.loaderRegion),
    format: loader.format,
    classification,
    confidence,
    summary,
    consumedBytes: loader.consumedBytes,
    declaredRegionBytes: loader.declaredRegionBytes,
    tailRange: {
      start: hex(consumedEndExclusive),
      endExclusive: hex(regionEndExclusive),
      sizeBytes: tailBytes,
    },
    tailByteStats: {
      zeroBytes: tailStats.zeroBytes,
      nonzeroBytes: tailStats.nonzeroBytes,
      allZero: tailStats.allZero,
    },
    parsedStream: {
      terminated: Boolean(loader.terminated),
      endReason: loader.endReason || '',
      sourceRangeCount: (loader.sourceRanges || []).length,
      totalTiles: loader.stats?.totalTiles || 0,
      warningCount: (loader.warnings || []).length,
    },
    resolvedByCatalog: variantTable ? {
      catalogId: vram998VariantCatalogId,
      variantTableId: variantTable.id,
      entryCount: variantTable.entryCount,
      totalTiles: variantTable.totalTiles,
      sourceRangeCount: (variantTable.sourceRanges || []).length,
    } : null,
    evidence,
  };
}

function buildCatalog(mapData, rom) {
  const tileSourceCatalog = requireCatalog(mapData, tileSourceCatalogId);
  const variantCatalog = findCatalog(mapData, vram998VariantCatalogId);
  const partialLoaders = (tileSourceCatalog.loaderEntries || [])
    .filter(loader => (loader.declaredRegionBytes || 0) > (loader.consumedBytes || 0))
    .sort((a, b) => offsetOf(a.loaderRegion.offset) - offsetOf(b.loaderRegion.offset));
  const entries = partialLoaders.map(loader => classifyPartialEntry(mapData, rom, variantCatalog, loader));
  const summary = {
    tileSourceCatalogId,
    vram998VariantCatalogId: variantCatalog ? vram998VariantCatalogId : null,
    partialLoaderCount: entries.length,
    resolvedPartialLoaderCount: entries.filter(entry => entry.classification !== 'nonzero_trailing_bytes_need_trace').length,
    unresolvedPartialLoaderCount: entries.filter(entry => entry.classification === 'nonzero_trailing_bytes_need_trace').length,
    classificationCounts: entries.reduce((counts, entry) => {
      counts[entry.classification] = (counts[entry.classification] || 0) + 1;
      return counts;
    }, {}),
    tailBytesTotal: entries.reduce((sum, entry) => sum + entry.tailRange.sizeBytes, 0),
    zeroTailBytes: entries.reduce((sum, entry) => sum + entry.tailByteStats.zeroBytes, 0),
    nonzeroTailBytes: entries.reduce((sum, entry) => sum + entry.tailByteStats.nonzeroBytes, 0),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    assetPolicy: 'Metadata only: loader offsets, consumed/declared sizes, residual byte counts, classifications, catalog ids, and ASM evidence. No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [tileSourceCatalogId, variantCatalog ? vram998VariantCatalogId : null].filter(Boolean),
    summary,
    entries,
    evidence: [
      'This audit checks VRAM loader regions where the parsed stream terminates before the mapped ASM/data-label region ends.',
      'Residual ranges are classified as fixed-stride loader variants, zero padding, or unresolved nonzero trailing bytes.',
      'The audit stores offsets and counts only; no ROM bytes or decoded assets are embedded.',
    ],
    nextLeads: summary.unresolvedPartialLoaderCount
      ? ['Trace unresolved nonzero loader tails through ASM references before treating them as source coverage.']
      : ['Exclude resolved partial-consumption loader tails from future unresolved-loader lead ranking.'],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  for (const entry of catalog.entries) {
    const region = findRegionById(mapData, entry.loaderRegion.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.vramLoaderPartialConsumptionAudit = {
      catalogId,
      kind: 'vram_loader_partial_consumption',
      classification: entry.classification,
      confidence: entry.confidence,
      summary: entry.summary,
      consumedBytes: entry.consumedBytes,
      declaredRegionBytes: entry.declaredRegionBytes,
      tailRange: entry.tailRange,
      tailByteStats: entry.tailByteStats,
      resolvedByCatalog: entry.resolvedByCatalog,
      evidence: entry.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      classification: entry.classification,
      tailBytes: entry.tailRange.sizeBytes,
      confidence: entry.confidence,
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
    : catalog.entries.map(entry => ({
      id: entry.loaderRegion.id,
      offset: entry.loaderRegion.offset,
      name: entry.loaderRegion.name || '',
      classification: entry.classification,
      tailBytes: entry.tailRange.sizeBytes,
      confidence: entry.confidence,
    }));

  if (apply) {
    mapData.tileSourceCatalogs = (mapData.tileSourceCatalogs || []).filter(item => item.id !== catalogId);
    mapData.tileSourceCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'vram_loader_partial_consumption_audit',
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
    entries: catalog.entries,
  }, null, 2));
}

main();
