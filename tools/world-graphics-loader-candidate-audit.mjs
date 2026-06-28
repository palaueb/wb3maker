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
const unreferencedCatalogId = 'world-graphics-unreferenced-span-catalog-2026-06-25';
const tileSourceCatalogId = 'world-tile-source-catalog-2026-06-24';
const catalogId = 'world-graphics-loader-candidate-catalog-2026-06-25';
const reportId = 'graphics-loader-candidate-audit-2026-06-25';
const toolName = 'tools/world-graphics-loader-candidate-audit.mjs';
const tileSizeBytes = 32;

const strictCandidateRegionTypes = new Set([
  'data_table',
]);

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(value) {
  if (typeof value === 'number') return value;
  return parseInt(value, 16);
}

function regionBounds(region) {
  const start = offsetOf(region.offset);
  return { start, end: start + (region.size || 0) };
}

function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function overlapSize(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
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

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
  }) || null;
}

function findOverlappingRegions(mapData, start, end) {
  return (mapData.regions || [])
    .filter(region => rangesOverlap(regionBounds(region), { start, end }))
    .map(regionRef);
}

function candidateScanRanges(mapData) {
  return (mapData.regions || [])
    .filter(region => {
      if (!region.offset || !region.size) return false;
      if (region.type === 'vram_loader_8fb' || region.type === 'vram_loader_998') return false;
      if (!strictCandidateRegionTypes.has(region.type || 'unknown')) return false;
      const text = `${region.name || ''} ${region.notes || ''}`.toLowerCase();
      const unresolved = /unresolved|payload|fragment|data @|unknown/.test(text)
        || (region.confidence || '').toLowerCase() === 'low';
      if (!unresolved) return false;
      return (region.size || 0) >= 5;
    })
    .map(region => ({ ...regionBounds(region), region }));
}

function existingLoaderOffsets(mapData) {
  return new Set((mapData.regions || [])
    .filter(region => region.type === 'vram_loader_8fb' || region.type === 'vram_loader_998')
    .map(region => offsetOf(region.offset)));
}

function decode8fbCandidate(rom, start, maxBytes) {
  const entries = [];
  const warnings = [];
  let pc = start;
  let curVramTile = 0;
  let curBank = 8;
  let curBlockIdx = 0;
  let totalTiles = 0;
  let maxVramTile = -1;
  let terminated = false;

  for (let entryIndex = 0; entryIndex < 96 && pc < rom.length && pc < start + maxBytes; entryIndex++) {
    const entryOffset = pc;
    const count = rom[pc++];
    if (count === 0) {
      terminated = true;
      break;
    }
    if (pc + 3 >= rom.length || pc + 3 >= start + maxBytes) {
      warnings.push(`truncated 8FB entry at ${hex(entryOffset)}`);
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
    const sourceStart = curBank * 0x4000 + curBlockIdx * tileSizeBytes;
    const sourceEnd = sourceStart + count * tileSizeBytes;
    if (count > 0x80) warnings.push(`entry ${entryIndex} large tile count ${count}`);
    if (curVramTile + count > 0x200) warnings.push(`entry ${entryIndex} exceeds SMS tile slots`);
    if (sourceEnd > rom.length) warnings.push(`entry ${entryIndex} source out of ROM range`);
    entries.push({
      entryIndex,
      entryOffset: hex(entryOffset),
      count,
      vramTileRange: { start: hex(curVramTile, 3), end: hex(curVramTile + count - 1, 3), count },
      sourceRange: { start: sourceStart, end: sourceEnd },
    });
    totalTiles += count;
    maxVramTile = Math.max(maxVramTile, curVramTile + count - 1);
    curVramTile += count;
    curBlockIdx += count;
  }

  return {
    format: '8fb',
    terminated,
    consumedBytes: pc - start,
    entries,
    warnings,
    totalTiles,
    maxVramTile,
  };
}

function decode998Candidate(rom, start, maxBytes) {
  const entries = [];
  const warnings = [];
  let pc = start;
  let vramPtr = 0;
  let totalTiles = 0;
  let zeroTiles = 0;
  let maxVramTile = -1;
  let terminated = false;

  for (let entryIndex = 0; entryIndex < 160 && pc < rom.length && pc < start + maxBytes; entryIndex++) {
    const entryOffset = pc;
    const op = rom[pc++];
    if (op === 0) {
      terminated = true;
      break;
    }
    const hasSetPos = Boolean(op & 0x80);
    const count = op & 0x7F;
    let tileSlot = null;
    if (hasSetPos) {
      if (pc >= rom.length || pc >= start + maxBytes) {
        warnings.push(`truncated 998 set-position at ${hex(entryOffset)}`);
        break;
      }
      tileSlot = rom[pc++];
      vramPtr = tileSlot * tileSizeBytes;
    }
    const vramTile = vramPtr >> 5;
    if (count === 0x7F) {
      entries.push({
        entryIndex,
        kind: 'zero',
        entryOffset: hex(entryOffset),
        count: 1,
        vramTileRange: { start: hex(vramTile, 3), end: hex(vramTile, 3), count: 1 },
        sourceRange: null,
      });
      totalTiles++;
      zeroTiles++;
      maxVramTile = Math.max(maxVramTile, vramTile);
      vramPtr += tileSizeBytes;
      continue;
    }
    if (count === 0) {
      entries.push({
        entryIndex,
        kind: 'noop',
        entryOffset: hex(entryOffset),
        count: 0,
        vramTileRange: { start: hex(vramTile, 3), end: hex(vramTile, 3), count: 0 },
        sourceRange: null,
      });
      continue;
    }
    if (pc + 1 >= rom.length || pc + 1 >= start + maxBytes) {
      warnings.push(`truncated 998 copy at ${hex(entryOffset)}`);
      break;
    }
    const srcLo = rom[pc++];
    const srcHi = rom[pc++];
    const bank = srcHi >> 1;
    const blockIndex = ((srcHi & 1) << 8) | srcLo;
    const sourceStart = bank * 0x4000 + blockIndex * tileSizeBytes;
    const sourceEnd = sourceStart + count * tileSizeBytes;
    if (vramTile + count > 0x200) warnings.push(`entry ${entryIndex} exceeds SMS tile slots`);
    if (sourceEnd > rom.length) warnings.push(`entry ${entryIndex} source out of ROM range`);
    entries.push({
      entryIndex,
      kind: 'copy',
      entryOffset: hex(entryOffset),
      count,
      setPos: hasSetPos,
      tileSlot: tileSlot == null ? null : hex(tileSlot, 2),
      vramTileRange: { start: hex(vramTile, 3), end: hex(vramTile + count - 1, 3), count },
      sourceRange: { start: sourceStart, end: sourceEnd },
    });
    totalTiles += count;
    maxVramTile = Math.max(maxVramTile, vramTile + count - 1);
    vramPtr += count * tileSizeBytes;
  }

  return {
    format: '998',
    terminated,
    consumedBytes: pc - start,
    entries,
    warnings,
    totalTiles,
    zeroTiles,
    maxVramTile,
  };
}

function unreferencedSpans(catalog) {
  return (catalog.spans || []).map(span => ({
    id: span.id,
    region: span.region,
    start: offsetOf(span.start),
    end: offsetOf(span.endExclusive),
    classification: span.classification,
  }));
}

function scoreCandidate(mapData, decoded, start, containingRegion, spans) {
  const copyEntries = decoded.entries.filter(entry => entry.sourceRange);
  const sourceBytes = copyEntries.reduce((sum, entry) => sum + Math.max(0, entry.sourceRange.end - entry.sourceRange.start), 0);
  const gfxBytes = copyEntries.reduce((sum, entry) => {
    return sum + findOverlappingRegions(mapData, entry.sourceRange.start, entry.sourceRange.end)
      .filter(region => region.type === 'gfx_tiles')
      .reduce((regionSum, region) => regionSum + overlapSize(
        entry.sourceRange,
        { start: offsetOf(region.offset), end: offsetOf(region.offset) + region.size },
      ), 0);
  }, 0);
  const overlapRefs = [];
  let unreferencedOverlapBytes = 0;
  for (const entry of copyEntries) {
    for (const span of spans) {
      const bytes = overlapSize(entry.sourceRange, span);
      if (!bytes) continue;
      unreferencedOverlapBytes += bytes;
      overlapRefs.push({
        spanId: span.id,
        spanRegion: span.region,
        bytes,
        tiles: Number((bytes / tileSizeBytes).toFixed(4)),
        entryIndex: entry.entryIndex,
        entryOffset: entry.entryOffset,
        sourceRange: {
          start: hex(entry.sourceRange.start),
          endExclusive: hex(entry.sourceRange.end),
          sizeBytes: entry.sourceRange.end - entry.sourceRange.start,
        },
      });
    }
  }

  const startsAtRegionBoundary = containingRegion && start === offsetOf(containingRegion.offset);
  const consumesWholeRegion = containingRegion && decoded.consumedBytes === (containingRegion.size || 0);
  const withinDataRegion = containingRegion && strictCandidateRegionTypes.has(containingRegion.type || 'unknown');
  const sourceGfxRatio = sourceBytes ? gfxBytes / sourceBytes : 0;
  const score = [
    decoded.terminated ? 2 : 0,
    decoded.warnings.length === 0 ? 2 : 0,
    copyEntries.length >= 2 ? 1 : 0,
    decoded.totalTiles >= 2 && decoded.totalTiles <= 512 ? 1 : 0,
    decoded.consumedBytes >= 5 && decoded.consumedBytes <= 256 ? 1 : 0,
    sourceGfxRatio >= 0.9 ? 2 : sourceGfxRatio >= 0.5 ? 1 : 0,
    unreferencedOverlapBytes >= 128 ? 2 : unreferencedOverlapBytes >= 32 ? 1 : 0,
    startsAtRegionBoundary ? 1 : 0,
    consumesWholeRegion ? 1 : 0,
    withinDataRegion ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);

  const confidence = score >= 11 ? 'medium' : 'low';
  return {
    score,
    confidence,
    copyEntryCount: copyEntries.length,
    sourceBytes,
    gfxBytes,
    sourceGfxRatio: Number(sourceGfxRatio.toFixed(4)),
    unreferencedOverlapBytes,
    unreferencedOverlapTiles: Number((unreferencedOverlapBytes / tileSizeBytes).toFixed(4)),
    overlapRefs,
    startsAtRegionBoundary,
    consumesWholeRegion,
  };
}

function compactCandidate(mapData, decoded, start, containingRegion, score) {
  return {
    id: `candidate_${decoded.format}_${start.toString(16).toUpperCase()}`,
    format: decoded.format,
    offset: hex(start),
    consumedBytes: decoded.consumedBytes,
    containingRegion: regionRef(containingRegion),
    confidence: score.confidence,
    score: score.score,
    terminated: decoded.terminated,
    warningCount: decoded.warnings.length,
    warnings: decoded.warnings.slice(0, 8),
    entryCount: decoded.entries.length,
    copyEntryCount: score.copyEntryCount,
    totalTiles: decoded.totalTiles,
    maxVramTile: decoded.maxVramTile < 0 ? null : hex(decoded.maxVramTile, 3),
    sourceGfxRatio: score.sourceGfxRatio,
    startsAtRegionBoundary: score.startsAtRegionBoundary,
    consumesWholeRegion: score.consumesWholeRegion,
    unreferencedOverlapBytes: score.unreferencedOverlapBytes,
    unreferencedOverlapTiles: score.unreferencedOverlapTiles,
    overlapRefs: score.overlapRefs.slice(0, 16),
    entryPreview: decoded.entries.slice(0, 8).map(entry => ({
      entryIndex: entry.entryIndex,
      entryOffset: entry.entryOffset,
      kind: entry.kind || 'copy',
      count: entry.count,
      vramTileRange: entry.vramTileRange,
      sourceRange: entry.sourceRange ? {
        start: hex(entry.sourceRange.start),
        endExclusive: hex(entry.sourceRange.end),
        overlappingRegions: findOverlappingRegions(mapData, entry.sourceRange.start, entry.sourceRange.end),
      } : null,
    })),
    status: 'candidate_only_unconfirmed_consumer',
    evidence: [
      'Candidate decodes cleanly enough under a known tile-loader grammar and overlaps graphics spans not covered by existing parsed loader source ranges.',
      'No callsite or region type promotion is claimed here; confirmation requires tracing an HL load/call into _LABEL_8FB_ or _LABEL_998_, or a matching scene/room render path.',
      'This catalog stores offsets, counts, ranges, and region ids only; no ROM bytes or decoded graphics are embedded.',
    ],
  };
}

function buildCatalog(rom, mapData) {
  const unrefCatalog = requireCatalog(mapData, unreferencedCatalogId);
  const tileSourceCatalog = requireCatalog(mapData, tileSourceCatalogId);
  const spans = unreferencedSpans(unrefCatalog);
  const loaderOffsets = existingLoaderOffsets(mapData);
  const scanRanges = candidateScanRanges(mapData);
  const candidates = [];
  const seen = new Set();

  for (const range of scanRanges) {
    for (const start of [range.start]) {
      if (loaderOffsets.has(start)) continue;
      const remaining = range.end - start;
      const maxBytes = Math.min(remaining, 256);
      for (const decoded of [
        decode8fbCandidate(rom, start, maxBytes),
        decode998Candidate(rom, start, maxBytes),
      ]) {
        if (!decoded.terminated || decoded.warnings.length) continue;
        if (decoded.consumedBytes < 5 || decoded.consumedBytes > 256) continue;
        if (decoded.totalTiles < 2 || decoded.totalTiles > 512) continue;
        const score = scoreCandidate(mapData, decoded, start, range.region, spans);
        if (score.unreferencedOverlapBytes < 32) continue;
        if (score.sourceGfxRatio !== 1) continue;
        if (!score.startsAtRegionBoundary) continue;
        const key = `${decoded.format}:${start}:${decoded.consumedBytes}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(compactCandidate(mapData, decoded, start, range.region, score));
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score
    || b.unreferencedOverlapBytes - a.unreferencedOverlapBytes
    || offsetOf(a.offset) - offsetOf(b.offset));

  const mediumCandidates = candidates.filter(candidate => candidate.confidence === 'medium');
  const coveredSpanIds = new Set(candidates.flatMap(candidate => candidate.overlapRefs.map(ref => ref.spanId)));
  const summary = {
    sourceCatalogs: [unreferencedCatalogId, tileSourceCatalogId],
    scannedRegionCount: scanRanges.length,
    candidateCount: candidates.length,
    mediumConfidenceCandidateCount: mediumCandidates.length,
    lowConfidenceCandidateCount: candidates.length - mediumCandidates.length,
    candidateOverlapBytes: candidates.reduce((sum, candidate) => sum + candidate.unreferencedOverlapBytes, 0),
    distinctOverlappedUnreferencedSpans: coveredSpanIds.size,
    unreferencedSpanCount: spans.length,
    existingLoaderRegions: tileSourceCatalog.summary?.loaderRegions || loaderOffsets.size,
    assetPolicy: 'Metadata only: candidate offsets, decoded loader counts, source/VRAM ranges, overlap sizes, confidence, and evidence. No ROM bytes, decoded tiles, rendered graphics, or screenshots are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [unreferencedCatalogId, tileSourceCatalogId],
    summary,
    candidates,
    evidence: [
      `${unreferencedCatalogId} supplies graphics spans not covered by known _LABEL_8FB_/_LABEL_998_ loader source ranges.`,
      `${tileSourceCatalogId} supplies the already-confirmed loader set used to exclude known loader offsets.`,
      'Candidates are deliberately not promoted to loader regions without a routine reference or render-path consumer.',
    ],
  };
}

function annotateCandidateRegions(mapData, catalog) {
  const annotated = [];
  for (const candidate of catalog.candidates) {
    const regionId = candidate.containingRegion?.id;
    if (!regionId) continue;
    const region = (mapData.regions || []).find(item => item.id === regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.graphicsLoaderCandidateAudit = {
      catalogId,
      kind: 'candidate_tile_loader_stream',
      status: candidate.status,
      confidence: candidate.confidence,
      format: candidate.format,
      offset: candidate.offset,
      consumedBytes: candidate.consumedBytes,
      entryCount: candidate.entryCount,
      copyEntryCount: candidate.copyEntryCount,
      totalTiles: candidate.totalTiles,
      maxVramTile: candidate.maxVramTile,
      sourceGfxRatio: candidate.sourceGfxRatio,
      startsAtRegionBoundary: candidate.startsAtRegionBoundary,
      consumesWholeRegion: candidate.consumesWholeRegion,
      unreferencedOverlapBytes: candidate.unreferencedOverlapBytes,
      unreferencedOverlapTiles: candidate.unreferencedOverlapTiles,
      overlapRefs: candidate.overlapRefs,
      typeBeforeAudit: region.type || 'unknown',
      typeAfterAudit: region.type || 'unknown',
      changedType: false,
      evidence: candidate.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      candidateId: candidate.id,
      format: candidate.format,
      confidence: candidate.confidence,
      consumedBytes: candidate.consumedBytes,
      unreferencedOverlapBytes: candidate.unreferencedOverlapBytes,
    });
  }
  return annotated;
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotatedRegions = apply ? annotateCandidateRegions(mapData, catalog) : [];

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_loader_candidate_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      topCandidates: catalog.candidates.slice(0, 16),
      annotatedRegions,
      validationIssues: [],
      nextLeads: [
        'For medium candidates, search ASM for HL loads or pointer tables that land on the candidate offset before _LABEL_8FB_/_LABEL_998_.',
        'If a candidate has no routine reference, treat it as a false-positive until a scene recipe or render trace consumes it.',
        'Promote confirmed candidates into vram_loader_8fb/vram_loader_998 regions, rerun tile-source coverage, then rerun the unreferenced-span audit.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    topCandidates: catalog.candidates.slice(0, 16),
    annotatedRegions: annotatedRegions.length,
  }, null, 2));
}

main();
