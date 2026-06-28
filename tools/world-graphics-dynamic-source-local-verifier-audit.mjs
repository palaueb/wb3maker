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
const toolName = 'tools/world-graphics-dynamic-source-local-verifier-audit.mjs';
const catalogId = 'world-graphics-dynamic-source-local-verifier-catalog-2026-06-26';
const reportId = 'graphics-dynamic-source-local-verifier-audit-2026-06-26';
const schemaVersion = 1;
const sourceCatalogId = 'world-graphics-dynamic-source-trace-seed-catalog-2026-06-26';
const tileSize = 32;

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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function sumBy(items, valueFn) {
  return (items || []).reduce((sum, item) => sum + valueFn(item), 0);
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

function verifyChunk(mapData, rom, chunk) {
  const sourceBank = parseOffset(chunk.sourceBank);
  const highByte = parseOffset(chunk.sourceRecordHighByte);
  const blockStart = parseOffset(chunk.tileBlockStart);
  const blockEndExclusive = parseOffset(chunk.tileBlockEndExclusive);
  const tileBlockCount = Number(chunk.tileBlockCount || Math.max(0, blockEndExclusive - blockStart) || 0);
  const expectedBank = Number.isFinite(highByte) ? highByte >> 1 : NaN;
  const computedStart = Number.isFinite(sourceBank) && Number.isFinite(blockStart)
    ? sourceBank * 0x4000 + blockStart * tileSize
    : NaN;
  const computedEnd = Number.isFinite(computedStart)
    ? computedStart + tileBlockCount * tileSize
    : NaN;
  const sourceInRange = Number.isFinite(computedStart) && computedStart >= 0 &&
    Number.isFinite(computedEnd) && computedEnd <= rom.length;
  const sourceRegion = sourceInRange ? findRegionForOffset(mapData, computedStart) : null;
  const nonzeroByteCount = sourceInRange ? countNonzeroBytes(rom, computedStart, computedEnd) : 0;

  return {
    sourceBank: chunk.sourceBank,
    sourceRecordHighByte: chunk.sourceRecordHighByte,
    sourceRecordWordStart: chunk.sourceRecordWordStart,
    sourceRecordWordEndInclusive: chunk.sourceRecordWordEndInclusive,
    tileBlockStart: chunk.tileBlockStart,
    tileBlockEndExclusive: chunk.tileBlockEndExclusive,
    tileBlockCount,
    expectedBank: hex(expectedBank, 2),
    computedRange: {
      start: hex(computedStart, 5),
      endExclusive: hex(computedEnd, 5),
    },
    sourceRegion: compactRegion(sourceRegion),
    sourceInRange,
    bankMatchesHighByteFormula: Number.isFinite(sourceBank) && Number.isFinite(expectedBank) && sourceBank === expectedBank,
    nonzeroByteCount,
    sourceByteCount: tileBlockCount * tileSize,
    nonblank: nonzeroByteCount > 0,
  };
}

function verifySeed(mapData, rom, seed) {
  const chunks = (seed.sourceRecordWordChunks || []).map(chunk => verifyChunk(mapData, rom, chunk));
  const rangeStart = parseOffset(seed.range?.start);
  const rangeEnd = parseOffset(seed.range?.endExclusive);
  const computedStart = parseOffset(chunks[0]?.computedRange?.start);
  const computedEnd = parseOffset(chunks[chunks.length - 1]?.computedRange?.endExclusive);
  const sourceByteCount = sumBy(chunks, chunk => chunk.sourceByteCount);
  const nonzeroByteCount = sumBy(chunks, chunk => chunk.nonzeroByteCount);
  const allChunksInRange = chunks.every(chunk => chunk.sourceInRange);
  const allBanksMatch = chunks.every(chunk => chunk.bankMatchesHighByteFormula);
  const formulaMatchesRange = Number.isFinite(computedStart) && computedStart === rangeStart &&
    Number.isFinite(computedEnd) && computedEnd === rangeEnd &&
    sourceByteCount === Number(seed.range?.sizeBytes || rangeEnd - rangeStart || 0);

  return {
    id: `${seed.spanId}_dynamic_source_local_verification`,
    spanId: seed.spanId,
    kind: seed.kind,
    region: seed.region,
    range: seed.range,
    tileCount: seed.tileCount || 0,
    nonblankTileCount: seed.nonblankTileCount || 0,
    recommendedAction: seed.recommendedAction,
    actionConfidence: seed.actionConfidence,
    candidateRoutes: seed.candidateRoutes || [],
    sourceBank: seed.sourceBank,
    sourceRecordHighBytes: seed.sourceRecordHighBytes || [],
    sourceRecordWords: uniqueSorted(chunks.flatMap(chunk => [
      chunk.sourceRecordWordStart,
      chunk.sourceRecordWordEndInclusive,
    ])),
    localVerification: {
      sourceChunks: chunks,
      sourceChunkCount: chunks.length,
      sourceRegionIds: uniqueSorted(chunks.map(chunk => chunk.sourceRegion?.id)),
      sourceByteCount,
      nonzeroByteCount,
      nonblank: nonzeroByteCount > 0,
      formulaMatchesRange,
      allChunksInRange,
      allBanksMatchHighByteFormula: allBanksMatch,
      runtimeTraceConfirmed: false,
      promotionReady: false,
      status: formulaMatchesRange && allChunksInRange && allBanksMatch
        ? 'local_source_verified_runtime_trace_pending'
        : 'local_source_formula_or_range_warning',
    },
    evidenceCatalogs: uniqueSorted([sourceCatalogId, ...(seed.evidenceCatalogs || [])]),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
  };
}

function buildBankGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const bank = entry.sourceBank || 'unknown';
    if (!groups.has(bank)) {
      groups.set(bank, {
        sourceBank: bank,
        seedCount: 0,
        sourceByteCount: 0,
        nonzeroByteCount: 0,
        nonblankSeedCount: 0,
        formulaMatchCount: 0,
        sourceInRangeCount: 0,
        bankMatchCount: 0,
        runtimeTraceConfirmedCount: 0,
        promotionReadyCount: 0,
        sourceRecordHighBytes: new Set(),
        seedRegionIds: new Set(),
        sourceRegionIds: new Set(),
        kindCounts: {},
        recommendedActionCounts: {},
        topSeeds: [],
      });
    }
    const group = groups.get(bank);
    group.seedCount++;
    group.sourceByteCount += entry.localVerification.sourceByteCount;
    group.nonzeroByteCount += entry.localVerification.nonzeroByteCount;
    if (entry.localVerification.nonblank) group.nonblankSeedCount++;
    if (entry.localVerification.formulaMatchesRange) group.formulaMatchCount++;
    if (entry.localVerification.allChunksInRange) group.sourceInRangeCount++;
    if (entry.localVerification.allBanksMatchHighByteFormula) group.bankMatchCount++;
    if (entry.localVerification.runtimeTraceConfirmed) group.runtimeTraceConfirmedCount++;
    if (entry.localVerification.promotionReady) group.promotionReadyCount++;
    for (const highByte of entry.sourceRecordHighBytes || []) group.sourceRecordHighBytes.add(highByte);
    if (entry.region?.id) group.seedRegionIds.add(entry.region.id);
    for (const regionId of entry.localVerification.sourceRegionIds || []) group.sourceRegionIds.add(regionId);
    group.kindCounts[entry.kind] = (group.kindCounts[entry.kind] || 0) + 1;
    group.recommendedActionCounts[entry.recommendedAction] = (group.recommendedActionCounts[entry.recommendedAction] || 0) + 1;
    group.topSeeds.push({
      spanId: entry.spanId,
      range: entry.range,
      sourceRecordHighBytes: entry.sourceRecordHighBytes,
      sourceRecordWords: entry.sourceRecordWords,
      sourceByteCount: entry.localVerification.sourceByteCount,
      nonzeroByteCount: entry.localVerification.nonzeroByteCount,
      recommendedAction: entry.recommendedAction,
      candidateRoutes: entry.candidateRoutes,
    });
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      sourceRecordHighBytes: uniqueSorted([...group.sourceRecordHighBytes]),
      seedRegionIds: uniqueSorted([...group.seedRegionIds]),
      sourceRegionIds: uniqueSorted([...group.sourceRegionIds]),
      topSeeds: group.topSeeds
        .sort((a, b) => b.sourceByteCount - a.sourceByteCount || String(a.spanId).localeCompare(String(b.spanId)))
        .slice(0, 8),
    }))
    .sort((a, b) => parseOffset(a.sourceBank) - parseOffset(b.sourceBank));
}

function buildCatalog(mapData, rom) {
  const sourceCatalog = requireCatalog(mapData, sourceCatalogId);
  const entries = (sourceCatalog.seeds || [])
    .map(seed => verifySeed(mapData, rom, seed))
    .sort((a, b) => parseOffset(a.range?.start) - parseOffset(b.range?.start));
  const bankGroups = buildBankGroups(entries);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceCatalogId],
    assetPolicy: 'Metadata only: source words, offsets, region ids, formulas, route ids, local nonzero byte counts, and pending trace status. No ROM bytes, decoded graphics, pixels, screenshots, hashes, audio, text, or ASM instruction bytes are embedded.',
    target: {
      upstreamCatalogId: sourceCatalogId,
      reason: 'Verify every graphics dynamic-source trace seed against the local ROM before investing runtime traces or promoting coverage.',
    },
    summary: {
      verificationSeedCount: entries.length,
      seedRegionCount: new Set(entries.map(entry => entry.region?.id).filter(Boolean)).size,
      seedRegionIds: uniqueSorted(entries.map(entry => entry.region?.id)),
      sourceRegionCount: new Set(entries.flatMap(entry => entry.localVerification.sourceRegionIds || [])).size,
      sourceRegionIds: uniqueSorted(entries.flatMap(entry => entry.localVerification.sourceRegionIds || [])),
      sourceBankCount: new Set(entries.map(entry => entry.sourceBank).filter(Boolean)).size,
      sourceBanks: uniqueSorted(entries.map(entry => entry.sourceBank)),
      sourceRecordHighBytes: uniqueSorted(entries.flatMap(entry => entry.sourceRecordHighBytes || [])),
      sourceByteCount: sumBy(entries, entry => entry.localVerification.sourceByteCount),
      localNonzeroByteCount: sumBy(entries, entry => entry.localVerification.nonzeroByteCount),
      nonblankSeedCount: entries.filter(entry => entry.localVerification.nonblank).length,
      formulaMatchCount: entries.filter(entry => entry.localVerification.formulaMatchesRange).length,
      sourceInRangeCount: entries.filter(entry => entry.localVerification.allChunksInRange).length,
      bankMatchCount: entries.filter(entry => entry.localVerification.allBanksMatchHighByteFormula).length,
      runtimeTraceConfirmedCount: entries.filter(entry => entry.localVerification.runtimeTraceConfirmed).length,
      promotionReadyCount: entries.filter(entry => entry.localVerification.promotionReady).length,
      localVerificationStatusCounts: countBy(entries, entry => entry.localVerification.status),
      kindCounts: countBy(entries, entry => entry.kind),
      recommendedActionCounts: countBy(entries, entry => entry.recommendedAction),
      candidateRouteCounts: countBy(entries.flatMap(entry => entry.candidateRoutes || []), routeId => routeId),
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    bankGroups,
    entries,
    evidence: [
      `${sourceCatalogId} supplies the 31 actionable dynamic graphics source trace seeds.`,
      'The verifier recomputes each chunk as sourceBank * 0x4000 + tileBlockStart * 0x20 and compares the combined range to the stored graphics span.',
      'The verifier counts local nonzero source bytes only; byte values, pixels, hashes, screenshots, and decoded graphics are not stored.',
      'Runtime trace confirmation and promotion readiness remain zero until a loader/decompression trace proves a concrete consumer and VDP destination.',
    ],
    nextLeads: [
      'Prioritize the largest verified nonblank bank groups first: bank 0x0B player/entity traces, then bank 0x09 and 0x0C dynamic/background traces.',
      'For each verified seed, instrument the candidate routes listed on the entry and require source word, active bank, and VDP destination before coverage promotion.',
      'Use this local verifier as a guardrail: if a future seed fails formula/source-range verification, fix the source-record derivation before tracing runtime consumers.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const byRegion = new Map();

  function ensure(regionId) {
    if (!byRegion.has(regionId)) {
      byRegion.set(regionId, {
        roles: new Set(),
        spanIds: new Set(),
        sourceBanks: new Set(),
        sourceRecordHighBytes: new Set(),
        sourceByteCount: 0,
        localNonzeroByteCount: 0,
      });
    }
    return byRegion.get(regionId);
  }

  for (const entry of catalog.entries) {
    const targetRegionId = entry.region?.id;
    if (targetRegionId) {
      const detail = ensure(targetRegionId);
      detail.roles.add('dynamic_source_local_verified_seed_region');
      detail.spanIds.add(entry.spanId);
      if (entry.sourceBank) detail.sourceBanks.add(entry.sourceBank);
      for (const highByte of entry.sourceRecordHighBytes || []) detail.sourceRecordHighBytes.add(highByte);
      detail.sourceByteCount += entry.localVerification.sourceByteCount;
      detail.localNonzeroByteCount += entry.localVerification.nonzeroByteCount;
    }
    for (const sourceRegionId of entry.localVerification.sourceRegionIds || []) {
      const detail = ensure(sourceRegionId);
      detail.roles.add('dynamic_source_local_verified_source_region');
      detail.spanIds.add(entry.spanId);
      if (entry.sourceBank) detail.sourceBanks.add(entry.sourceBank);
      for (const highByte of entry.sourceRecordHighBytes || []) detail.sourceRecordHighBytes.add(highByte);
    }
  }

  for (const [regionId, detail] of byRegion) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: [...detail.roles].sort().join(',') });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.graphicsDynamicSourceLocalVerifierAudit = {
        catalogId,
        role: [...detail.roles].sort().join(','),
        confidence: 'medium_high',
        summary: 'Local ROM verifier confirms dynamic graphics source formulas, source bounds, bank derivation, and nonblank source counts while keeping runtime trace and coverage promotion pending.',
        detail: {
          spanIds: uniqueSorted([...detail.spanIds]),
          sourceBanks: uniqueSorted([...detail.sourceBanks]),
          sourceRecordHighBytes: uniqueSorted([...detail.sourceRecordHighBytes]),
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
      role: [...detail.roles].sort().join(','),
      spanCount: detail.spanIds.size,
      sourceBanks: uniqueSorted([...detail.sourceBanks]),
    });
  }

  return { changedRegions, missingRegions };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    bankGroups: catalog.bankGroups,
    topEntries: catalog.entries
      .slice()
      .sort((a, b) => b.localVerification.sourceByteCount - a.localVerification.sourceByteCount)
      .slice(0, 12)
      .map(entry => ({
        spanId: entry.spanId,
        kind: entry.kind,
        range: entry.range,
        sourceBank: entry.sourceBank,
        sourceRecordHighBytes: entry.sourceRecordHighBytes,
        candidateRoutes: entry.candidateRoutes,
        localVerification: {
          sourceRegionIds: entry.localVerification.sourceRegionIds,
          sourceByteCount: entry.localVerification.sourceByteCount,
          nonzeroByteCount: entry.localVerification.nonzeroByteCount,
          formulaMatchesRange: entry.localVerification.formulaMatchesRange,
          allChunksInRange: entry.localVerification.allChunksInRange,
          allBanksMatchHighByteFormula: entry.localVerification.allBanksMatchHighByteFormula,
          status: entry.localVerification.status,
        },
      })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
  mapData.graphicsCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'graphics_dynamic_source_local_verifier_audit',
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
