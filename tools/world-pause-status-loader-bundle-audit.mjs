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
const catalogId = 'world-pause-status-loader-bundle-catalog-2026-06-25';
const reportId = 'pause-status-loader-bundle-audit-2026-06-25';
const toolName = 'tools/world-pause-status-loader-bundle-audit.mjs';

const bundleStart = 0x1DE20;
const bundleEndExclusive = 0x1E14E;
const pointerTableOffset = 0x1DD64;
const pointerTableSize = 2;
const destinationPayloadOffset = 0x1DD66;
const destinationPayloadEndExclusive = 0x1DE04;
const ramPayloadPointerOffset = 0x1DE04;
const ramPayloadOffset = 0x1DE06;
const ramPayloadEndExclusive = 0x1DE20;
const tileSizeBytes = 32;
const staleRenderParamRegionIds = ['r2713', 'r2747', 'r2715', 'r2748', 'r2749', 'r2717', 'r2719', 'r2720'];

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

function mergeRanges(ranges) {
  const sorted = ranges
    .map(range => ({ start: range.start, end: range.end }))
    .filter(range => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function addCoverage(coverageByRegion, region, sourceStart, sourceEnd, entry) {
  if (region.type !== 'gfx_tiles') return;
  const regionStart = offsetOf(region.offset);
  const regionEnd = regionStart + region.size;
  const start = Math.max(sourceStart, regionStart);
  const end = Math.min(sourceEnd, regionEnd);
  if (end <= start) return;
  if (!coverageByRegion.has(region.id)) {
    coverageByRegion.set(region.id, {
      region,
      rawRanges: [],
      entryRefs: [],
    });
  }
  const coverage = coverageByRegion.get(region.id);
  coverage.rawRanges.push({ start, end });
  coverage.entryRefs.push({
    recordOffset: hex(entry.recordOffset),
    entryOffset: entry.entryOffset,
    count: entry.count,
    sourceRange: [hex(sourceStart), hex(sourceEnd)],
  });
}

function summarizeSourceCoverage(coverageByRegion) {
  return [...coverageByRegion.values()]
    .map(coverage => {
      const merged = mergeRanges(coverage.rawRanges);
      return {
        region: coverage.region,
        rawRangeCount: coverage.rawRanges.length,
        rawReferenceBytes: coverage.rawRanges.reduce((sum, range) => sum + (range.end - range.start), 0),
        uniqueSpanCount: merged.length,
        uniqueBytes: merged.reduce((sum, range) => sum + (range.end - range.start), 0),
        spanPreview: merged.slice(0, 16).map(range => ({
          start: hex(range.start),
          endExclusive: hex(range.end),
          sizeBytes: range.end - range.start,
        })),
        entryRefPreview: coverage.entryRefs.slice(0, 12),
      };
    })
    .sort((a, b) => offsetOf(a.region.offset) - offsetOf(b.region.offset));
}

function readWord(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function bankedZ80ToRom(z80, bank) {
  if (z80 < 0x8000 || z80 >= 0xC000) return null;
  return bank * 0x4000 + (z80 - 0x8000);
}

function decode998Record(rom, offset, endExclusive) {
  const entries = [];
  const warnings = [];
  let pc = offset;
  let vramPtr = 0;
  let totalTiles = 0;
  let copyEntries = 0;
  let zeroEntries = 0;
  let maxVramTile = -1;

  for (let entryIndex = 0; entryIndex < 256 && pc < endExclusive; entryIndex++) {
    const entryOffset = pc;
    const op = rom[pc++];
    if (op === 0) {
      return {
        valid: warnings.length === 0,
        terminated: true,
        offset,
        endOffset: entryOffset,
        consumedBytes: pc - offset,
        entries,
        warnings,
        copyEntries,
        zeroEntries,
        totalTiles,
        maxVramTile,
      };
    }
    const setPos = Boolean(op & 0x80);
    const count = op & 0x7F;
    let tileSlot = null;
    if (setPos) {
      if (pc >= endExclusive) {
        warnings.push(`truncated set-position at ${hex(entryOffset)}`);
        break;
      }
      tileSlot = rom[pc++];
      vramPtr = tileSlot * tileSizeBytes;
    }
    const vramTile = vramPtr >> 5;
    if (count === 0x7F) {
      entries.push({
        entryIndex,
        kind: 'zero_tile',
        entryOffset: hex(entryOffset),
        count: 1,
        setPos,
        tileSlot: tileSlot == null ? null : hex(tileSlot, 2),
        vramTileRange: { start: hex(vramTile, 3), end: hex(vramTile, 3), count: 1 },
        sourceRange: null,
      });
      totalTiles++;
      zeroEntries++;
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
        setPos,
        tileSlot: tileSlot == null ? null : hex(tileSlot, 2),
        vramTileRange: { start: hex(vramTile, 3), end: hex(vramTile, 3), count: 0 },
        sourceRange: null,
      });
      continue;
    }
    if (pc + 1 >= endExclusive) {
      warnings.push(`truncated copy at ${hex(entryOffset)}`);
      break;
    }
    const srcLo = rom[pc++];
    const srcHi = rom[pc++];
    const bank = srcHi >> 1;
    const blockIndex = ((srcHi & 1) << 8) | srcLo;
    const sourceStart = bank * 0x4000 + blockIndex * tileSizeBytes;
    const sourceEnd = sourceStart + count * tileSizeBytes;
    if (sourceEnd > rom.length) warnings.push(`source out of ROM range at ${hex(entryOffset)}`);
    entries.push({
      entryIndex,
      kind: 'copy',
      entryOffset: hex(entryOffset),
      count,
      setPos,
      tileSlot: tileSlot == null ? null : hex(tileSlot, 2),
      vramTileRange: { start: hex(vramTile, 3), end: hex(vramTile + count - 1, 3), count },
      sourceRange: {
        start: sourceStart,
        end: sourceEnd,
        bank,
        blockIndex,
      },
    });
    copyEntries++;
    totalTiles += count;
    maxVramTile = Math.max(maxVramTile, vramTile + count - 1);
    vramPtr += count * tileSizeBytes;
  }

  return {
    valid: false,
    terminated: false,
    offset,
    endOffset: pc,
    consumedBytes: pc - offset,
    entries,
    warnings: warnings.length ? warnings : ['record did not terminate before bundle end'],
    copyEntries,
    zeroEntries,
    totalTiles,
    maxVramTile,
  };
}

function decodeBundle(rom, mapData) {
  const records = [];
  const coverageByRegion = new Map();
  let offset = bundleStart;
  while (offset < bundleEndExclusive) {
    const record = decode998Record(rom, offset, bundleEndExclusive);
    if (!record.terminated || record.consumedBytes <= 1) break;
    const sourceRanges = record.entries
      .filter(entry => entry.sourceRange)
      .map(entry => ({
        start: hex(entry.sourceRange.start),
        endExclusive: hex(entry.sourceRange.end),
        sizeBytes: entry.sourceRange.end - entry.sourceRange.start,
        bank: entry.sourceRange.bank,
        blockIndex: hex(entry.sourceRange.blockIndex, 3),
        overlappingRegions: findOverlappingRegions(mapData, entry.sourceRange.start, entry.sourceRange.end),
      }));
    for (const entry of record.entries.filter(item => item.sourceRange)) {
      const sourceStart = entry.sourceRange.start;
      const sourceEnd = entry.sourceRange.end;
      for (const region of findOverlappingRegions(mapData, sourceStart, sourceEnd)) {
        addCoverage(coverageByRegion, region, sourceStart, sourceEnd, { ...entry, recordOffset: offset });
      }
    }
    const gfxSourceBytes = sourceRanges.reduce((sum, range) => {
      return sum + range.overlappingRegions
        .filter(region => region.type === 'gfx_tiles')
        .reduce((innerSum, region) => {
          const start = Math.max(offsetOf(range.start), offsetOf(region.offset));
          const end = Math.min(offsetOf(range.endExclusive), offsetOf(region.offset) + region.size);
          return innerSum + Math.max(0, end - start);
        }, 0);
    }, 0);
    records.push({
      id: `pause_status_998_record_${offset.toString(16).toUpperCase()}`,
      offset: hex(offset),
      endOffset: hex(record.endOffset),
      consumedBytes: record.consumedBytes,
      entryCount: record.entries.length,
      copyEntryCount: record.copyEntries,
      zeroEntryCount: record.zeroEntries,
      totalTiles: record.totalTiles,
      maxVramTile: record.maxVramTile < 0 ? null : hex(record.maxVramTile, 3),
      valid: record.valid,
      warningCount: record.warnings.length,
      warnings: record.warnings,
      gfxSourceBytes,
      sourceRangeCount: sourceRanges.length,
      sourceRangePreview: sourceRanges.slice(0, 8),
      entryPreview: record.entries.slice(0, 8).map(entry => ({
        entryIndex: entry.entryIndex,
        kind: entry.kind,
        entryOffset: entry.entryOffset,
        count: entry.count,
        setPos: entry.setPos,
        tileSlot: entry.tileSlot,
        vramTileRange: entry.vramTileRange,
        sourceRange: entry.sourceRange ? {
          start: hex(entry.sourceRange.start),
          endExclusive: hex(entry.sourceRange.end),
          bank: entry.sourceRange.bank,
          blockIndex: hex(entry.sourceRange.blockIndex, 3),
        } : null,
      })),
    });
    offset += record.consumedBytes;
    while (offset < bundleEndExclusive && rom[offset] === 0x7F) offset++;
  }
  return {
    records,
    sourceCoverageByRegion: summarizeSourceCoverage(coverageByRegion),
  };
}

function destinationPayloadSummary(rom) {
  const wordCount = Math.floor((destinationPayloadEndExclusive - destinationPayloadOffset) / 2);
  const highByteCounts = {};
  for (let offset = destinationPayloadOffset; offset + 1 < destinationPayloadEndExclusive; offset += 2) {
    const high = rom[offset + 1];
    highByteCounts[hex(high, 2)] = (highByteCounts[hex(high, 2)] || 0) + 1;
  }
  return {
    offset: hex(destinationPayloadOffset),
    endExclusive: hex(destinationPayloadEndExclusive),
    sizeBytes: destinationPayloadEndExclusive - destinationPayloadOffset,
    wordCount,
    highByteCounts,
    role: 'word payload adjacent to _DATA_1DD64_; likely destination/name-table words, exact consumer still unresolved',
  };
}

function buildCatalog(rom, mapData) {
  const z80Pointer = readWord(rom, pointerTableOffset);
  const pointedRomOffset = bankedZ80ToRom(z80Pointer, 7);
  const bundle = decodeBundle(rom, mapData);
  const records = bundle.records;
  const validRecords = records.filter(record => record.valid);
  const summary = {
    pointerTableOffset: hex(pointerTableOffset),
    pointerTableSize,
    pointerZ80: hex(z80Pointer, 4),
    pointerRomOffset: pointedRomOffset == null ? null : hex(pointedRomOffset),
    bundleRange: [hex(bundleStart), hex(bundleEndExclusive)],
    bundleBytes: bundleEndExclusive - bundleStart,
    recordCount: records.length,
    validRecordCount: validRecords.length,
    invalidRecordCount: records.length - validRecords.length,
    totalTiles: records.reduce((sum, record) => sum + record.totalTiles, 0),
    copyEntryCount: records.reduce((sum, record) => sum + record.copyEntryCount, 0),
    zeroEntryCount: records.reduce((sum, record) => sum + record.zeroEntryCount, 0),
    gfxSourceBytes: records.reduce((sum, record) => sum + record.gfxSourceBytes, 0),
    uniqueGfxSourceBytes: bundle.sourceCoverageByRegion.reduce((sum, coverage) => sum + coverage.uniqueBytes, 0),
    sourceGraphicsRegionCount: bundle.sourceCoverageByRegion.length,
    destinationPayloadWords: Math.floor((destinationPayloadEndExclusive - destinationPayloadOffset) / 2),
    ramPayloadWords: Math.floor((ramPayloadEndExclusive - ramPayloadOffset) / 2),
    consumerStatus: 'unresolved_pointer_table_consumer',
    assetPolicy: 'Metadata only: offsets, 998-compatible record counts, tile counts, source ranges, region ids, and unresolved-consumer notes. No ROM bytes, decoded graphics, rendered UI, or screenshots are embedded.',
  };
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      'world-bank7-pause-data-catalog-2026-06-24',
      'world-bank7-vdp-stream-catalog-2026-06-25',
      'world-graphics-unreferenced-span-catalog-2026-06-25',
    ],
    summary,
    pointerTable: {
      offset: hex(pointerTableOffset),
      size: pointerTableSize,
      z80Pointer: hex(z80Pointer, 4),
      romOffset: pointedRomOffset == null ? null : hex(pointedRomOffset),
      region: regionRef(findContainingRegion(mapData, pointerTableOffset)),
      targetRegion: pointedRomOffset == null ? null : regionRef(findContainingRegion(mapData, pointedRomOffset)),
      consumerStatus: summary.consumerStatus,
    },
    destinationPayload: destinationPayloadSummary(rom),
    ramPayload: {
      pointerOffset: hex(ramPayloadPointerOffset),
      payloadOffset: hex(ramPayloadOffset),
      payloadEndExclusive: hex(ramPayloadEndExclusive),
      payloadWords: summary.ramPayloadWords,
      role: 'word payload after $2000|_RAM_C10E_ pointer record; exact consumer still unresolved',
    },
    sourceCoverageByRegion: bundle.sourceCoverageByRegion,
    records,
    evidence: [
      'ASM lines 28527-28529 define _DATA_1DD64_ as a pointer to _DATA_1DE20_.',
      '_DATA_1DE20_ decodes as a bundle of zero-terminated _LABEL_998_-compatible records, not as one continuous _LABEL_972B_ VDP stream header.',
      'No direct executable consumer for _DATA_1DD64_ has been confirmed yet; promotion to confirmed vram_loader_998 regions is intentionally deferred.',
      'The record model stores offsets, counts, and source ranges only; no tile bytes or rendered graphics are embedded.',
    ],
  };
}

function annotateRegion(mapData, regionId, kind, summary, confidence, extra = {}) {
  const region = (mapData.regions || []).find(item => item.id === regionId);
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.pauseStatusLoaderBundleAudit = {
    catalogId,
    kind,
    confidence,
    summary,
    consumerStatus: 'unresolved_pointer_table_consumer',
    typeBeforeAudit: region.type || 'unknown',
    typeAfterAudit: region.type || 'unknown',
    changedType: false,
    ...extra,
    evidence: [
      'The region participates in the _DATA_1DD64_/_DATA_1DE20_ pause/status loader-bundle shape audit.',
      'No confirmed executable consumer has been traced, so existing region type is preserved.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  if (region.analysis.bank7VdpStreamAudit && ['r2749', 'r2717', 'r2719', 'r2720'].includes(region.id)) {
    region.analysis.bank7VdpStreamAudit.supersededBy = catalogId;
    region.analysis.bank7VdpStreamAudit.supersededReason = 'The 0x1DE20 payload decodes as multiple zero-terminated 998-compatible records; the exact consumer remains unresolved, so continuous VDP-stream wording is no longer the strongest claim.';
  }
  return regionRef(region);
}

function quarantineStaleRenderParams(mapData) {
  const quarantined = [];
  for (const regionId of staleRenderParamRegionIds) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    const existing = region?.analysis?.pauseStatusRenderParamQuarantine;
    if (!region?.params) {
      if (existing?.catalogId === catalogId) {
        quarantined.push({
          ...regionRef(region),
          removedParamKeys: existing.removedParamKeys || [],
        });
      }
      continue;
    }
    const staleParams = {};
    if (region.params.screenProg) staleParams.screenProg = region.params.screenProg;
    if (region.params.format) staleParams.format = region.params.format;
    if (!Object.keys(staleParams).length) {
      if (existing?.catalogId === catalogId) {
        quarantined.push({
          ...regionRef(region),
          removedParamKeys: existing.removedParamKeys || [],
        });
      }
      continue;
    }

    region.analysis = region.analysis || {};
    region.analysis.pauseStatusRenderParamQuarantine = {
      catalogId,
      kind: 'stale_active_render_param_quarantine',
      confidence: 'high',
      staleParams,
      removedParamKeys: Object.keys(staleParams).map(key => `params.${key}`),
      reason: 'The region is not a confirmed screen_prog or confirmed vram_loader_* input; the pause/status consumer remains unresolved.',
      evidence: [
        '_DATA_1DD18_ terminates before _DATA_1DD64_; the _LABEL_604_ screen-program interpreter does not consume these trailing records.',
        'ASM direct-reference search finds no executable ld hl/bc/de reference to _DATA_1DD64_, _DATA_1DE04_, or _DATA_1DE20_.',
        'The 0x1DE20 payload is only shape-compatible with _LABEL_998_ records until a runtime consumer is traced.',
      ],
      generatedAt: now,
      tool: toolName,
    };

    delete region.params.screenProg;
    delete region.params.format;
    if (!Object.keys(region.params).length) delete region.params;

    quarantined.push({
      ...regionRef(region),
      removedParamKeys: Object.keys(staleParams).map(key => `params.${key}`),
    });
  }
  return quarantined;
}

function annotateSourceCoverage(mapData, catalog) {
  const annotated = [];
  for (const coverage of catalog.sourceCoverageByRegion || []) {
    const region = (mapData.regions || []).find(item => item.id === coverage.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.pauseStatusLoaderSourceCoverage = {
      catalogId,
      kind: 'pause_status_998_candidate_source_coverage',
      confidence: 'medium',
      consumerStatus: catalog.summary.consumerStatus,
      rawRangeCount: coverage.rawRangeCount,
      rawReferenceBytes: coverage.rawReferenceBytes,
      uniqueSpanCount: coverage.uniqueSpanCount,
      uniqueBytes: coverage.uniqueBytes,
      spanPreview: coverage.spanPreview,
      entryRefPreview: coverage.entryRefPreview,
      summary: 'Graphics source ranges referenced by the shape-compatible 0x1DE20 pause/status 998-record bundle.',
      evidence: [
        '_DATA_1DE20_ decodes into 44 zero-terminated _LABEL_998_-compatible records.',
        'Each copy entry encodes a bank/block tile source; this audit stores only source offsets and region ids.',
        'No executable consumer has been traced yet, so this remains candidate source coverage rather than confirmed loader coverage.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      ...regionRef(region),
      uniqueBytes: coverage.uniqueBytes,
      uniqueSpanCount: coverage.uniqueSpanCount,
      rawReferenceBytes: coverage.rawReferenceBytes,
    });
  }
  return annotated;
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  const pointer = annotateRegion(
    mapData,
    'r2713',
    'pause_status_998_candidate_pointer_table',
    '_DATA_1DD64_ points to the first 998-compatible record in the pause/status loader bundle.',
    'medium',
    {
      pointerZ80: catalog.summary.pointerZ80,
      pointerRomOffset: catalog.summary.pointerRomOffset,
    },
  );
  if (pointer) annotated.push(pointer);
  for (const regionId of ['r2749', 'r2717', 'r2719', 'r2720']) {
    const region = annotateRegion(
      mapData,
      regionId,
      'pause_status_998_candidate_record_bundle_fragment',
      'Fragment inside the 0x1DE20-0x1E14D bundle of zero-terminated 998-compatible records.',
      'medium',
      {
        bundleRange: catalog.summary.bundleRange,
        recordCount: catalog.summary.recordCount,
        totalTiles: catalog.summary.totalTiles,
      },
    );
    if (region) annotated.push(region);
  }
  const payload1 = annotateRegion(
    mapData,
    'r2747',
    'pause_status_adjacent_destination_payload',
    'Adjacent word payload after _DATA_1DD64_; exact runtime role remains unresolved.',
    'medium',
    {
      payloadRange: [hex(destinationPayloadOffset), hex(destinationPayloadEndExclusive)],
      payloadWords: catalog.summary.destinationPayloadWords,
    },
  );
  if (payload1) annotated.push(payload1);
  const ramPointer = annotateRegion(
    mapData,
    'r2715',
    'pause_status_ram_payload_pointer',
    '_DATA_1DE04_ points at $2000|_RAM_C10E_; exact runtime role remains unresolved.',
    'medium',
    {
      pointerOffset: hex(ramPayloadPointerOffset),
      payloadRange: [hex(ramPayloadOffset), hex(ramPayloadEndExclusive)],
      payloadWords: catalog.summary.ramPayloadWords,
    },
  );
  if (ramPointer) annotated.push(ramPointer);
  const payload2 = annotateRegion(
    mapData,
    'r2748',
    'pause_status_adjacent_ram_payload',
    'Adjacent word payload after _DATA_1DE04_; exact runtime role remains unresolved.',
    'medium',
    {
      payloadRange: [hex(ramPayloadOffset), hex(ramPayloadEndExclusive)],
      payloadWords: catalog.summary.ramPayloadWords,
    },
  );
  if (payload2) annotated.push(payload2);
  const quarantinedRenderParams = quarantineStaleRenderParams(mapData);
  const annotatedSourceCoverage = annotateSourceCoverage(mapData, catalog);
  return { annotated, quarantinedRenderParams, annotatedSourceCoverage };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotationResult = apply ? annotateMap(mapData, catalog) : { annotated: [], quarantinedRenderParams: [], annotatedSourceCoverage: [] };
  const annotatedRegions = annotationResult.annotated;
  const quarantinedRenderParams = annotationResult.quarantinedRenderParams;
  const annotatedSourceCoverage = annotationResult.annotatedSourceCoverage;
  catalog.summary.quarantinedRenderParamRegionCount = quarantinedRenderParams.length;
  catalog.summary.annotatedSourceGraphicsRegionCount = annotatedSourceCoverage.length;

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'pause_status_loader_bundle_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      annotatedRegions,
      quarantinedRenderParams,
      annotatedSourceCoverage,
      sourceCoverageByRegion: catalog.sourceCoverageByRegion,
      recordPreview: catalog.records.slice(0, 8),
      validationIssues: [],
      nextLeads: [
        'Trace the executable consumer that selects _DATA_1DD64_ and passes its target to _LABEL_998_ or another compatible tile-upload path.',
        'If the consumer is confirmed, split the 44 records into vram_loader_998 subregions and rerun tile-source/graphics-coverage audits.',
        'Resolve the adjacent 0x1DD66 destination/name-table word payload and 0x1DE04/_RAM_C10E payload roles.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    sourceCoverageByRegion: catalog.sourceCoverageByRegion,
    recordPreview: catalog.records.slice(0, 3).map(record => ({
      id: record.id,
      offset: record.offset,
      consumedBytes: record.consumedBytes,
      entryCount: record.entryCount,
      totalTiles: record.totalTiles,
      gfxSourceBytes: record.gfxSourceBytes,
    })),
    annotatedRegions: annotatedRegions.length,
    quarantinedRenderParams: quarantinedRenderParams.length,
    annotatedSourceCoverage: annotatedSourceCoverage.length,
  }, null, 2));
}

main();
