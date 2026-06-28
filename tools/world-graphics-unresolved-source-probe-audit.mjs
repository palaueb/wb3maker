#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const toolName = 'tools/world-graphics-unresolved-source-probe-audit.mjs';
const splitLayoutCatalogId = 'world-graphics-incbin-split-layout-catalog-2026-06-25';
const tileSourceCatalogId = 'world-tile-source-catalog-2026-06-24';
const graphicsCoverageCatalogId = 'world-graphics-coverage-catalog-2026-06-24';
const unreferencedCatalogId = 'world-graphics-unreferenced-span-catalog-2026-06-25';
const catalogId = 'world-graphics-unresolved-source-probe-catalog-2026-06-25';
const reportId = 'graphics-unresolved-source-probe-audit-2026-06-25';
const tileSizeBytes = 32;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function cleanCode(line) {
  return String(line || '').split(';')[0].trim();
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function regionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function directAsmReferences(asmText, start) {
  const label = `_DATA_${start.toString(16).toUpperCase()}_`;
  const fullHex = start.toString(16).toUpperCase();
  const bankOffset = (start % 0x4000).toString(16).toUpperCase().padStart(4, '0');
  const patterns = [
    new RegExp(`\\b${label}\\b`, 'i'),
    new RegExp(`\\b${fullHex}\\b`, 'i'),
    new RegExp(`\\$${bankOffset}\\b`, 'i'),
  ];
  const refs = [];
  const lines = asmText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const code = cleanCode(lines[index]);
    if (!code) continue;
    if (patterns.some(pattern => pattern.test(code))) {
      refs.push({
        line: index + 1,
        matchClass: code.includes(label) ? 'direct_data_label' : 'literal_offset_text',
        code: code.slice(0, 120),
      });
    }
  }
  return refs;
}

function tileSourceRefs(tileCatalog) {
  const refs = [];
  for (const loader of tileCatalog.loaderEntries || []) {
    for (const entry of loader.entries || []) {
      const source = entry.source;
      if (!source) continue;
      const start = parseHex(source.romStart);
      const end = parseHex(source.romEndExclusive);
      if (start == null || end == null) continue;
      refs.push({
        loaderRegion: loader.loaderRegion,
        loaderEntryId: loader.id,
        loaderFormat: loader.format,
        entryIndex: entry.entryIndex,
        entryOffset: entry.entryOffset,
        sourceRange: {
          start: hex(start),
          endExclusive: hex(end),
          sizeBytes: end - start,
          tileCount: Number(((end - start) / tileSizeBytes).toFixed(4)),
        },
        vramTileRange: entry.vramTileRange || null,
      });
    }
  }
  return refs.sort((a, b) => parseHex(a.sourceRange.start) - parseHex(b.sourceRange.start)
    || parseHex(a.sourceRange.endExclusive) - parseHex(b.sourceRange.endExclusive)
    || String(a.loaderRegion?.id || '').localeCompare(String(b.loaderRegion?.id || '')));
}

function rangeContains(ref, start, endExclusive) {
  const refStart = parseHex(ref.sourceRange.start);
  const refEnd = parseHex(ref.sourceRange.endExclusive);
  return refStart <= start && refEnd >= endExclusive;
}

function adjacentRefs(refs, start, endExclusive, containingStart, containingEnd) {
  const inContaining = refs.filter(ref => {
    const refStart = parseHex(ref.sourceRange.start);
    const refEnd = parseHex(ref.sourceRange.endExclusive);
    return refStart >= containingStart && refEnd <= containingEnd;
  });
  const previous = [...inContaining].reverse().find(ref => parseHex(ref.sourceRange.endExclusive) <= start) || null;
  const next = inContaining.find(ref => parseHex(ref.sourceRange.start) >= endExclusive) || null;
  return {
    previous,
    next,
    previousDistanceBytes: previous ? start - parseHex(previous.sourceRange.endExclusive) : null,
    nextDistanceBytes: next ? parseHex(next.sourceRange.start) - endExclusive : null,
    sameLoaderOnBothSides: Boolean(previous && next && previous.loaderRegion?.id === next.loaderRegion?.id),
  };
}

function byteShapeProbe(rom, start, endExclusive) {
  const bytes = rom.subarray(start, endExclusive);
  if (!bytes.length) {
    return {
      byteCount: 0,
      tileAligned: false,
      blankCandidate: false,
      uniformCandidate: false,
      adjacentDuplicateCandidate: false,
      equalsPreviousTile: false,
      equalsNextTile: false,
      persistedByteCount: 0,
      persistedHashCount: 0,
    };
  }
  let allZero = true;
  let allSame = true;
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] !== 0) allZero = false;
    if (bytes[index] !== bytes[0]) allSame = false;
  }
  const previous = start >= tileSizeBytes ? rom.subarray(start - tileSizeBytes, start) : null;
  const next = endExclusive + tileSizeBytes <= rom.length ? rom.subarray(endExclusive, endExclusive + tileSizeBytes) : null;
  const equalsPreviousTile = Boolean(previous && previous.length === bytes.length && Buffer.compare(bytes, previous) === 0);
  const equalsNextTile = Boolean(next && next.length === bytes.length && Buffer.compare(bytes, next) === 0);
  return {
    byteCount: bytes.length,
    tileAligned: start % tileSizeBytes === 0 && endExclusive % tileSizeBytes === 0,
    blankCandidate: allZero,
    uniformCandidate: allSame,
    adjacentDuplicateCandidate: equalsPreviousTile || equalsNextTile,
    equalsPreviousTile,
    equalsNextTile,
    persistedByteCount: 0,
    persistedHashCount: 0,
  };
}

function findCoverageEntry(catalog, regionId) {
  return (catalog.entries || []).find(entry => entry.region?.id === regionId) || null;
}

function findUnreferencedSpan(catalog, regionId, start, endExclusive) {
  return (catalog.spans || []).find(span => span.region?.id === regionId
    && parseHex(span.start) === start
    && parseHex(span.endExclusive) === endExclusive) || null;
}

function unresolvedSegments(splitCatalog) {
  return (splitCatalog.layouts || []).flatMap(layout => (layout.segments || [])
    .filter(segment => segment.role === 'unresolved_graphics_source_segment')
    .map(segment => ({ layout, segment })));
}

function buildEntry(mapData, rom, asmText, refs, coverageCatalog, unreferencedCatalog, layout, segment) {
  const region = regionById(mapData, segment.region.id);
  const start = parseHex(segment.region.offset);
  const endExclusive = start + Number(segment.region.size || 0);
  const containingStart = parseHex(layout.declaredSpan.start);
  const containingEnd = parseHex(layout.declaredSpan.endExclusive);
  const directMatches = directAsmReferences(asmText, start);
  const exactRefs = refs.filter(ref => rangeContains(ref, start, endExclusive));
  const nearby = adjacentRefs(refs, start, endExclusive, containingStart, containingEnd);
  const coverage = findCoverageEntry(coverageCatalog, segment.region.id);
  const unreferencedSpan = findUnreferencedSpan(unreferencedCatalog, segment.region.id, start, endExclusive);
  const byteShape = byteShapeProbe(rom, start, endExclusive);
  const bank = Math.floor(start / 0x4000);
  const blockIndex = Math.floor((start % 0x4000) / tileSizeBytes);
  const status = exactRefs.length
    ? 'resolved_by_known_tile_loader'
    : byteShape.blankCandidate || byteShape.uniformCandidate || byteShape.adjacentDuplicateCandidate
      ? 'unresolved_possible_padding_or_duplicate'
      : 'unresolved_nonblank_source_needs_consumer_trace';
  const confidence = status === 'unresolved_nonblank_source_needs_consumer_trace' ? 'medium' : 'low';

  return {
    id: `${segment.region.id}_unresolved_graphics_source_probe`,
    region: compactRegion(region),
    incbinSpanId: layout.incbinSpanId,
    declaredSpan: layout.declaredSpan,
    sourceRange: {
      start: hex(start),
      endExclusive: hex(endExclusive),
      sizeBytes: endExclusive - start,
      tileCount: Number(((endExclusive - start) / tileSizeBytes).toFixed(4)),
      bank: hex(bank, 2),
      blockIndex: hex(blockIndex, 3),
    },
    status,
    confidence,
    knownTileLoaderRefCount: exactRefs.length,
    directAsmReferenceCount: directMatches.length,
    directAsmReferences: directMatches.slice(0, 8),
    adjacentKnownTileSourceRefs: {
      previous: nearby.previous ? {
        loaderRegion: nearby.previous.loaderRegion,
        loaderEntryId: nearby.previous.loaderEntryId,
        loaderFormat: nearby.previous.loaderFormat,
        entryIndex: nearby.previous.entryIndex,
        entryOffset: nearby.previous.entryOffset,
        sourceRange: nearby.previous.sourceRange,
        vramTileRange: nearby.previous.vramTileRange,
      } : null,
      next: nearby.next ? {
        loaderRegion: nearby.next.loaderRegion,
        loaderEntryId: nearby.next.loaderEntryId,
        loaderFormat: nearby.next.loaderFormat,
        entryIndex: nearby.next.entryIndex,
        entryOffset: nearby.next.entryOffset,
        sourceRange: nearby.next.sourceRange,
        vramTileRange: nearby.next.vramTileRange,
      } : null,
      previousDistanceBytes: nearby.previousDistanceBytes,
      nextDistanceBytes: nearby.nextDistanceBytes,
      sameLoaderOnBothSides: nearby.sameLoaderOnBothSides,
    },
    byteShapeProbe: byteShape,
    evidenceRefs: [
      {
        catalogId: splitLayoutCatalogId,
        kind: 'graphics_incbin_split_segment',
        summary: segment.reason || segment.role,
      },
      coverage ? {
        catalogId: graphicsCoverageCatalogId,
        kind: 'graphics_tile_region_coverage',
        confidence: coverage.confidence || '',
        summary: `${coverage.uniqueReferencedTiles || 0} unique tile(s) referenced by ${coverage.referencedByLoaderCount || 0} loader source range(s).`,
      } : null,
      unreferencedSpan ? {
        catalogId: unreferencedCatalogId,
        kind: unreferencedSpan.classification?.kind || 'graphics_unreferenced_loader_source_span',
        confidence: unreferencedSpan.classification?.confidence || '',
        summary: unreferencedSpan.classification?.reason || '',
      } : null,
      {
        catalogId: tileSourceCatalogId,
        kind: 'nearest_confirmed_tile_loader_source_refs',
        summary: nearby.previous && nearby.next
          ? `Nearest source-adjacent confirmed refs are ${nearby.previous.loaderRegion?.id || 'unknown'} and ${nearby.next.loaderRegion?.id || 'unknown'}.`
          : 'No source-adjacent confirmed refs found inside the containing incbin span.',
      },
    ].filter(Boolean),
    summary: exactRefs.length
      ? `${segment.region.id} is now covered by a parsed tile loader source range.`
      : `${segment.region.id} remains unreferenced by parsed tile loaders; local byte-shape probe did not persist bytes or hashes.`,
    evidence: [
      `${splitLayoutCatalogId} marks ${segment.region.id} as an unresolved graphics source segment inside ${layout.incbinSpanId}.`,
      `${graphicsCoverageCatalogId} has no parsed _LABEL_8FB_/_LABEL_998_ source references for this segment.`,
      'ASM text search found no direct data label for this interior incbin tile unless directAsmReferenceCount is nonzero.',
      'Local ROM byte probe stores only boolean shape flags and explicitly persists zero bytes and zero hashes.',
    ],
    assetPolicy: 'Metadata only: offsets, tile counts, source block ids, loader refs, booleans from a local byte-shape probe, and evidence references. No ROM bytes, hashes, decoded tile graphics, rendered pixels, screenshots, audio, text payloads, or gameplay constants are embedded.',
  };
}

function buildCatalog(mapData, rom, asmText) {
  const splitCatalog = requireCatalog(mapData, splitLayoutCatalogId);
  const tileCatalog = requireCatalog(mapData, tileSourceCatalogId);
  const coverageCatalog = requireCatalog(mapData, graphicsCoverageCatalogId);
  const unreferencedCatalog = requireCatalog(mapData, unreferencedCatalogId);
  const refs = tileSourceRefs(tileCatalog);
  const entries = unresolvedSegments(splitCatalog)
    .map(({ layout, segment }) => buildEntry(mapData, rom, asmText, refs, coverageCatalog, unreferencedCatalog, layout, segment));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [splitLayoutCatalogId, tileSourceCatalogId, graphicsCoverageCatalogId, unreferencedCatalogId],
    assetPolicy: 'Metadata only: graphics region ids, offsets, tile counts, source block ids, loader refs, direct ASM reference counts, and boolean byte-shape flags. No ROM bytes, hashes, decoded tiles, rendered pixels, screenshots, audio, text payloads, or gameplay constants are embedded.',
    summary: {
      unresolvedSegmentCount: entries.length,
      byStatus: countBy(entries, entry => entry.status),
      byConfidence: countBy(entries, entry => entry.confidence),
      directAsmReferenceCount: entries.reduce((sum, entry) => sum + entry.directAsmReferenceCount, 0),
      adjacentKnownSourceRefPairCount: entries.filter(entry => entry.adjacentKnownTileSourceRefs.previous && entry.adjacentKnownTileSourceRefs.next).length,
      nonblankNeedsTraceCount: entries.filter(entry => entry.status === 'unresolved_nonblank_source_needs_consumer_trace').length,
      persistedByteCount: entries.reduce((sum, entry) => sum + entry.byteShapeProbe.persistedByteCount, 0),
      persistedHashCount: entries.reduce((sum, entry) => sum + entry.byteShapeProbe.persistedHashCount, 0),
    },
    entries,
    validationIssues: entries.filter(entry => entry.knownTileLoaderRefCount > 0).map(entry => ({
      severity: 'warning',
      kind: 'previously_unresolved_segment_now_has_loader_ref',
      region: entry.region,
      summary: entry.summary,
    })),
    evidence: [
      'The audit starts from graphics split-layout segments already marked unresolved by parsed loader coverage.',
      'Known tile loader references come from the parsed _LABEL_8FB_/_LABEL_998_ tile-source catalog.',
      'The ROM is read only to compute boolean shape flags; no bytes, hashes, or pixels are written to map.json.',
    ],
    nextLeads: [
      'Trace nonblank unresolved graphics source segments through direct VDP copy, decompression, or alternate graphics-loader routines.',
      'Check whether the adjacent loader source refs indicate a deliberately sparse source table or a missing loader family.',
      'If a consumer is found, promote it into tile-source coverage and rerun graphics coverage, unreferenced span, split-layout, and this probe audit.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  for (const entry of catalog.entries) {
    const region = regionById(mapData, entry.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.graphicsUnresolvedSourceProbeAudit = {
      catalogId,
      kind: 'graphics_unresolved_source_probe',
      status: entry.status,
      confidence: entry.confidence,
      incbinSpanId: entry.incbinSpanId,
      sourceRange: entry.sourceRange,
      knownTileLoaderRefCount: entry.knownTileLoaderRefCount,
      directAsmReferenceCount: entry.directAsmReferenceCount,
      adjacentKnownTileSourceRefs: entry.adjacentKnownTileSourceRefs,
      byteShapeProbe: entry.byteShapeProbe,
      summary: entry.summary,
      evidenceRefs: entry.evidenceRefs,
      evidence: entry.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      region: compactRegion(region),
      status: entry.status,
      confidence: entry.confidence,
      sourceRange: entry.sourceRange,
    });
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, rom, asmText);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [];

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_unresolved_source_probe_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
      validationIssues: catalog.validationIssues,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      annotatedRegions,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotatedRegions.length,
    },
    validationIssues: catalog.validationIssues,
    entries: catalog.entries.map(entry => ({
      id: entry.id,
      region: entry.region,
      sourceRange: entry.sourceRange,
      status: entry.status,
      confidence: entry.confidence,
      knownTileLoaderRefCount: entry.knownTileLoaderRefCount,
      directAsmReferenceCount: entry.directAsmReferenceCount,
      adjacentKnownTileSourceRefs: entry.adjacentKnownTileSourceRefs,
      byteShapeProbe: entry.byteShapeProbe,
    })),
  }, null, 2));
}

main();
