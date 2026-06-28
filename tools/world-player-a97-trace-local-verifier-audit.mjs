#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const romPath = path.join(repoRoot, "projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).sms");
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-player-a97-trace-local-verifier-audit.mjs';
const catalogId = 'world-player-a97-trace-local-verifier-catalog-2026-06-26';
const reportId = 'player-a97-trace-local-verifier-audit-2026-06-26';
const schemaVersion = 1;
const sourceCatalogId = 'world-player-a48-nonmatch-a97-trace-seed-catalog-2026-06-26';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value.replace(/^\$/, '0x'), 16);
  return NaN;
}

function hex(value, pad = 2) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function sumBy(items, valueFn) {
  return (items || []).reduce((sum, item) => sum + valueFn(item), 0);
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

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value != null && value !== ''))].sort((a, b) => {
    const aNum = parseOffset(a);
    const bNum = parseOffset(b);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    return String(a).localeCompare(String(b));
  });
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
  if (!catalog) throw new Error(`Missing required catalog: ${id}`);
  return catalog;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRegionForOffset(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = parseOffset(region.offset);
    const size = Number(region.size || 0);
    return Number.isFinite(start) && offset >= start && offset < start + size;
  }) || null;
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

function countNonzeroBytes(rom, start, endExclusive) {
  let count = 0;
  const end = Math.min(endExclusive, rom.length);
  for (let i = Math.max(0, start); i < end; i++) if (rom[i] !== 0) count++;
  return count;
}

function a97DecodeRow(rom, sourceOffset, remapRow) {
  const remapBase = 0x00B4F + (remapRow & 0x03) * 16;
  let l = rom[sourceOffset] || 0;
  let h = rom[sourceOffset + 1] || 0;
  let c = rom[sourceOffset + 2] || 0;
  let b = rom[sourceOffset + 3] || 0;
  let outL = 0, outH = 0, outC = 0, outB = 0;
  for (let px = 0; px < 8; px++) {
    let a = 0;
    let carry = (b >> 7) & 1; b = ((b << 1) & 0xFF) | carry; a = ((a << 1) & 0xFF) | carry;
    carry = (c >> 7) & 1; c = ((c << 1) & 0xFF) | carry; a = ((a << 1) & 0xFF) | carry;
    carry = (h >> 7) & 1; h = ((h << 1) & 0xFF) | carry; a = ((a << 1) & 0xFF) | carry;
    carry = (l >> 7) & 1; l = ((l << 1) & 0xFF) | carry; a = ((a << 1) & 0xFF) | carry;
    const mapped = rom[remapBase + (a & 0x0F)] || 0;
    outL = ((outL << 1) & 0xFF) | (mapped & 1);
    outH = ((outH << 1) & 0xFF) | ((mapped >> 1) & 1);
    outC = ((outC << 1) & 0xFF) | ((mapped >> 2) & 1);
    outB = ((outB << 1) & 0xFF) | ((mapped >> 3) & 1);
  }
  return [outL, outH, outC, outB];
}

function decodeStats(rom, sourceStart, tileCount) {
  const rows = [];
  for (let remapRow = 0; remapRow < 4; remapRow++) {
    let nonzeroDecodedBytes = 0;
    let nonzeroDecodedRows = 0;
    for (let tile = 0; tile < tileCount; tile++) {
      for (let row = 0; row < 8; row++) {
        const decoded = a97DecodeRow(rom, sourceStart + tile * 32 + row * 4, remapRow);
        let rowNonzero = false;
        for (const value of decoded) {
          if (value !== 0) {
            nonzeroDecodedBytes++;
            rowNonzero = true;
          }
        }
        if (rowNonzero) nonzeroDecodedRows++;
      }
    }
    rows.push({ remapRow, nonzeroDecodedRows, nonzeroDecodedBytes });
  }
  return rows;
}

function verifyEntry(mapData, rom, entry) {
  const source = entry.sourceRecord || {};
  const sourceBank = parseOffset(source.sourceBank);
  const highByte = parseOffset(source.sourceRecordHighByte);
  const blockStart = parseOffset(source.tileBlockStart);
  const tileCount = Number(source.tileBlockCount || entry.nonblankTileCount || 0);
  const expectedBank = Number.isFinite(highByte) ? highByte >> 1 : NaN;
  const computedStart = Number.isFinite(sourceBank) && Number.isFinite(blockStart)
    ? sourceBank * 0x4000 + blockStart * 32
    : NaN;
  const computedEnd = Number.isFinite(computedStart) ? computedStart + tileCount * 32 : NaN;
  const rangeStart = parseOffset(entry.range?.start);
  const rangeEnd = parseOffset(entry.range?.endExclusive);
  const sourceInRange = Number.isFinite(computedStart) && computedStart >= 0 &&
    Number.isFinite(computedEnd) && computedEnd <= rom.length;
  const sourceRegion = sourceInRange ? findRegionForOffset(mapData, computedStart) : null;
  const nonzeroByteCount = sourceInRange ? countNonzeroBytes(rom, computedStart, computedEnd) : 0;
  const stats = sourceInRange ? decodeStats(rom, computedStart, tileCount) : [];

  return {
    id: `${entry.spanId}_a97_local_verification`,
    spanId: entry.spanId,
    region: entry.region,
    sourceRegion: compactRegion(sourceRegion),
    sourceRecordWord: source.sourceRecordWordStart,
    sourceRecordHighByte: source.sourceRecordHighByte,
    tileBlockStart: source.tileBlockStart,
    tileBlockCount: tileCount,
    expectedBank: hex(expectedBank, 2),
    expectedD0F3: source.expectedD0F3 || hex(expectedBank, 2),
    expectedMapperWrite: source.expectedMapperWrite || hex(expectedBank, 2),
    range: entry.range,
    computedRange: {
      start: hex(computedStart, 5),
      endExclusive: hex(computedEnd, 5),
    },
    localVerification: {
      sourceInRange,
      formulaMatchesRange: Number.isFinite(computedStart) && computedStart === rangeStart &&
        Number.isFinite(computedEnd) && computedEnd === rangeEnd,
      bankMatchesHighByteFormula: Number.isFinite(sourceBank) && Number.isFinite(expectedBank) && sourceBank === expectedBank,
      nonzeroByteCount,
      sourceByteCount: tileCount * 32,
      nonblank: nonzeroByteCount > 0,
      a97DecodeStatsByRemapRow: stats,
      a97DecodedNonzeroRowCount: sumBy(stats, item => item.nonzeroDecodedRows),
      a97DecodedNonzeroByteCount: sumBy(stats, item => item.nonzeroDecodedBytes),
      runtimeTraceConfirmed: false,
      promotionReady: false,
      status: 'local_source_verified_runtime_trace_pending',
    },
    proofCriterion: entry.proofCriterion,
    sourceCatalogId,
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
  };
}

function buildCatalog(mapData, rom) {
  const sourceCatalog = requireCatalog(mapData, sourceCatalogId);
  const entries = (sourceCatalog.entries || [])
    .map(entry => verifyEntry(mapData, rom, entry))
    .sort((a, b) => parseOffset(a.range?.start) - parseOffset(b.range?.start));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceCatalogId],
    assetPolicy: 'Metadata only: source words, offsets, region ids, formulas, nonzero byte counts, decode-count summaries, and pending trace status. No ROM bytes, decoded graphics, pixels, screenshots, hashes, audio, text, or ASM instruction bytes are embedded.',
    target: {
      upstreamCatalogId: sourceCatalogId,
      retainedRouteId: sourceCatalog.summary?.retainedRouteId || '',
      reason: 'Verify the four A97 trace seeds against the local ROM without promoting them to confirmed graphics coverage.',
    },
    summary: {
      verificationSeedCount: entries.length,
      seedRegionIds: uniqueSorted(entries.map(entry => entry.region?.id)),
      sourceRegionIds: uniqueSorted(entries.map(entry => entry.sourceRegion?.id)),
      sourceRecordWords: uniqueSorted(entries.map(entry => entry.sourceRecordWord)),
      expectedBanks: uniqueSorted(entries.map(entry => entry.expectedBank)),
      formulaMatchCount: entries.filter(entry => entry.localVerification.formulaMatchesRange).length,
      sourceInRangeCount: entries.filter(entry => entry.localVerification.sourceInRange).length,
      bankMatchCount: entries.filter(entry => entry.localVerification.bankMatchesHighByteFormula).length,
      nonblankSeedCount: entries.filter(entry => entry.localVerification.nonblank).length,
      sourceByteCount: sumBy(entries, entry => entry.localVerification.sourceByteCount),
      localNonzeroByteCount: sumBy(entries, entry => entry.localVerification.nonzeroByteCount),
      a97DecodedNonzeroRowCount: sumBy(entries, entry => entry.localVerification.a97DecodedNonzeroRowCount),
      a97DecodedNonzeroByteCount: sumBy(entries, entry => entry.localVerification.a97DecodedNonzeroByteCount),
      runtimeTraceConfirmedCount: entries.filter(entry => entry.localVerification.runtimeTraceConfirmed).length,
      promotionReadyCount: entries.filter(entry => entry.localVerification.promotionReady).length,
      localVerificationStatusCounts: countBy(entries, entry => entry.localVerification.status),
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    entries,
    evidence: [
      `${sourceCatalogId} supplies the four retained _LABEL_9C3_/_LABEL_A97_ trace seeds.`,
      'The local ROM verifier recomputes sourceBank * 0x4000 + tileBlockStart * 0x20 and checks that each result matches the stored source range.',
      'The verifier counts nonzero local source bytes and A97 decoded nonzero rows/bytes without storing byte values, pixels, screenshots, or hashes.',
      'Runtime trace confirmation and promotion readiness remain zero because no frame trace has proven the loader record consumption or VDP destination slot yet.',
    ],
    nextLeads: [
      'Instrument _LABEL_9C3_/_LABEL_A97_ around source words 0x174E, 0x175E, 0x176C, and 0x176E to capture _RAM_D0F3_, _RAM_FFFF_, source pointer, and VDP destination.',
      'Promote these four spans only after the runtime trace matches one local verifier entry and records the destination tile slot.',
      'Keep the rejected r0749/candidate_8fb_1E337 route excluded unless a separate direct bank-7 consumer trace appears.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const byRegion = new Map();

  for (const entry of catalog.entries) {
    const regionId = entry.region?.id;
    if (!regionId) continue;
    if (!byRegion.has(regionId)) {
      byRegion.set(regionId, {
        spanIds: [],
        sourceRecordWords: [],
        sourceByteCount: 0,
        localNonzeroByteCount: 0,
      });
    }
    const detail = byRegion.get(regionId);
    detail.spanIds.push(entry.spanId);
    detail.sourceRecordWords.push(entry.sourceRecordWord);
    detail.sourceByteCount += entry.localVerification.sourceByteCount;
    detail.localNonzeroByteCount += entry.localVerification.nonzeroByteCount;
  }

  for (const [regionId, detail] of byRegion) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'a97_local_verified_trace_seed_region' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA97TraceLocalVerifierAudit = {
        catalogId,
        role: 'a97_local_verified_trace_seed_region',
        confidence: 'medium_high',
        summary: 'Local ROM verifier confirms source range formulas, source bounds, bank derivation, and nonblank/A97 decode-count readiness for guarded A97 trace seeds; runtime trace is still pending.',
        detail: {
          spanIds: uniqueSorted(detail.spanIds),
          sourceRecordWords: uniqueSorted(detail.sourceRecordWords),
          sourceByteCount: detail.sourceByteCount,
          localNonzeroByteCount: detail.localNonzeroByteCount,
          runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
          promotionReadyCount: catalog.summary.promotionReadyCount,
          coverageChangedByThisAudit: false,
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      role: 'a97_local_verified_trace_seed_region',
      spanCount: detail.spanIds.length,
      sourceRecordWords: uniqueSorted(detail.sourceRecordWords),
    });
  }

  return { changedRegions, missingRegions };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    entries: catalog.entries.map(entry => ({
      spanId: entry.spanId,
      sourceRecordWord: entry.sourceRecordWord,
      range: entry.range,
      computedRange: entry.computedRange,
      expectedBank: entry.expectedBank,
      sourceRegion: entry.sourceRegion,
      localVerification: entry.localVerification,
    })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
  mapData.graphicsCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'player_a97_trace_local_verifier_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    sample: reportSample(catalog),
    assetPolicy: catalog.assetPolicy,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotation = annotateMap(mapData, catalog);
  if (apply) {
    applyCatalog(mapData, catalog, annotation);
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    sample: reportSample(catalog),
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
