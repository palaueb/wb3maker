#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const reportId = 'coverage-audit-2026-06-24';
const BANK_SIZE = 0x4000;

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
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
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

function intervalBytes(intervals) {
  return intervals.reduce((sum, interval) => sum + Math.max(0, interval.end - interval.start), 0);
}

function typeSummaries(regions) {
  const byType = new Map();
  for (const region of regions) {
    const type = region.type || 'unknown';
    const item = byType.get(type) || { type, regions: 0, bytes: 0 };
    item.regions++;
    item.bytes += region.size || 0;
    byType.set(type, item);
  }
  return [...byType.values()].sort((a, b) => b.bytes - a.bytes || a.type.localeCompare(b.type));
}

function computeCoverageByBank(regions, romSizeBytes) {
  const bankCount = Math.ceil(romSizeBytes / BANK_SIZE);
  const result = [];
  for (let bank = 0; bank < bankCount; bank++) {
    const bankStart = bank * BANK_SIZE;
    const bankEnd = Math.min(bankStart + BANK_SIZE, romSizeBytes);
    const bankRegions = regions.filter(region => {
      const { start, end } = regionBounds(region);
      return start < bankEnd && end > bankStart;
    });
    const clipped = bankRegions.map(region => {
      const { start, end } = regionBounds(region);
      return { start: Math.max(start, bankStart), end: Math.min(end, bankEnd) };
    });
    const merged = mergeIntervals(clipped);
    const coveredBytes = intervalBytes(merged);
    const unknownRegions = bankRegions.filter(region => (region.type || 'unknown') === 'unknown');
    const typeBytes = {};
    for (const region of bankRegions) {
      const { start, end } = regionBounds(region);
      const bytes = Math.max(0, Math.min(end, bankEnd) - Math.max(start, bankStart));
      const type = region.type || 'unknown';
      typeBytes[type] = (typeBytes[type] || 0) + bytes;
    }
    result.push({
      bank: hex(bank, 2),
      range: { start: hex(bankStart), endExclusive: hex(bankEnd) },
      totalBytes: bankEnd - bankStart,
      coveredBytes,
      coveragePercent: Number((coveredBytes / Math.max(1, bankEnd - bankStart) * 100).toFixed(2)),
      regionCount: bankRegions.length,
      unknownRegionCount: unknownRegions.length,
      unknownBytes: unknownRegions.reduce((sum, region) => sum + (region.size || 0), 0),
      typeBytes,
    });
  }
  return result;
}

function computeGaps(regions, romSizeBytes) {
  const intervals = mergeIntervals(regions.map(region => regionBounds(region)));
  const gaps = [];
  let cursor = 0;
  for (const interval of intervals) {
    if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < romSizeBytes) gaps.push({ start: cursor, end: romSizeBytes });
  return gaps.map(gap => ({
    start: hex(gap.start),
    endInclusive: hex(gap.end - 1),
    endExclusive: hex(gap.end),
    sizeBytes: gap.end - gap.start,
    bank: hex(Math.floor(gap.start / BANK_SIZE), 2),
  }));
}

function computeOverlaps(regions) {
  const sorted = [...regions].sort((a, b) => {
    const ab = regionBounds(a);
    const bb = regionBounds(b);
    return ab.start - bb.start || ab.end - bb.end;
  });
  const overlaps = [];
  const active = [];
  for (const region of sorted) {
    const bounds = regionBounds(region);
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].end <= bounds.start) active.splice(i, 1);
    }
    for (const item of active) {
      const start = Math.max(item.start, bounds.start);
      const end = Math.min(item.end, bounds.end);
      if (start < end) {
        overlaps.push({
          range: { start: hex(start), endInclusive: hex(end - 1), sizeBytes: end - start },
          a: regionRef(item.region),
          b: regionRef(region),
        });
      }
    }
    active.push({ ...bounds, region });
  }
  return overlaps;
}

function overlapPairKey(overlap) {
  const ids = [overlap.a.id, overlap.b.id].sort();
  return `${ids[0]}:${ids[1]}:${overlap.range.start}:${overlap.range.endInclusive}`;
}

function overlapExplanations(mapData) {
  const explanations = new Map();
  for (const catalog of mapData.overlapCatalogs || []) {
    for (const overlap of catalog.overlaps || []) {
      if (!overlap.pairKey) continue;
      explanations.set(overlap.pairKey, {
        catalogId: catalog.id,
        status: overlap.status || 'unknown',
        kind: overlap.kind || 'overlap',
        confidence: overlap.confidence || 'unknown',
        summary: overlap.summary || '',
      });
    }
  }
  return explanations;
}

function buildReport(mapData) {
  const regions = mapData.regions || [];
  const romSizeBytes = mapData.romSizeBytes || 0x40000;
  const intervals = mergeIntervals(regions.map(region => regionBounds(region)));
  const coveredBytes = intervalBytes(intervals);
  const gaps = computeGaps(regions, romSizeBytes);
  const overlaps = computeOverlaps(regions);
  const explanations = overlapExplanations(mapData);
  const annotatedOverlaps = overlaps.map(overlap => {
    const explanation = explanations.get(overlapPairKey(overlap)) || null;
    return explanation ? { ...overlap, explanation } : overlap;
  });
  const explainedOverlaps = annotatedOverlaps.filter(overlap => overlap.explanation?.status === 'explained');
  const suspiciousOverlaps = annotatedOverlaps.filter(overlap => overlap.explanation?.status !== 'explained');
  const typeSummary = typeSummaries(regions);
  const unknownRegions = regions.filter(region => (region.type || 'unknown') === 'unknown');
  return {
    id: reportId,
    type: 'coverage_audit',
    generatedAt: now,
    tool: `tools/world-coverage-audit.mjs${apply ? ' --apply' : ''}`,
    schemaVersion: 2,
    summary: {
      regionCount: regions.length,
      romSizeBytes,
      coveredBytes,
      gapBytes: Math.max(0, romSizeBytes - coveredBytes),
      coveragePercent: Number((coveredBytes / Math.max(1, romSizeBytes) * 100).toFixed(4)),
      unknownRegionCount: unknownRegions.length,
      unknownBytes: unknownRegions.reduce((sum, region) => sum + (region.size || 0), 0),
      gapCount: gaps.length,
      overlapCount: overlaps.length,
      explainedOverlapCount: explainedOverlaps.length,
      suspiciousOverlapCount: suspiciousOverlaps.length,
      typeCounts: Object.fromEntries(typeSummary.map(item => [item.type, item.regions])),
      typeBytes: Object.fromEntries(typeSummary.map(item => [item.type, item.bytes])),
      notes: [
        'Coverage is measured as unioned byte ranges; overlapping annotations are counted once for coverage and listed separately.',
        'Explained overlaps come from overlapCatalogs and represent known nested/subentry metadata rather than accidental coverage conflicts.',
        'Unknown region count is semantic map type unknown only; medium-confidence and mixed regions are tracked by type-specific audits.',
        'No ROM bytes or decoded copyrighted assets are embedded in this report.',
      ],
    },
    typeSummary,
    coverageByBank: computeCoverageByBank(regions, romSizeBytes),
    gaps,
    explainedOverlaps,
    suspiciousOverlaps,
    largestGenericRegions: regions
      .filter(region => ['raw_byte', 'data_array', 'data_table', 'screen_prog', 'pointer_table'].includes(region.type || 'unknown'))
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 40)
      .map(regionRef),
    largestUnknownRegions: unknownRegions
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 20)
      .map(regionRef),
    nextLeads: [
      'Keep reducing generic screen_prog/data_table regions into semantic room, UI, entity, palette, and audio structures.',
      'Replace explained overlap aliases with subrecord metadata once their exact nested formats are decoded.',
      'Use type-specific catalogs to drive analyzer UI badges for confidence, parser warnings, and nested subentry regions.',
    ],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const report = buildReport(mapData);
  if (apply) {
    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push(report);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    id: report.id,
    summary: report.summary,
    gaps: report.gaps,
    explainedOverlaps: report.explainedOverlaps,
    suspiciousOverlaps: report.suspiciousOverlaps,
  }, null, 2));
}

main();
