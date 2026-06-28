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
const reportId = 'palette-gap-audit-2026-06-24';

const PALETTE_GAPS = [
  {
    offset: 0x1C5B0,
    size: 16,
    name: 'palette @ 0x1C5B0',
    role: 'cram_palette_record_00',
  },
  {
    offset: 0x1C5D0,
    size: 16,
    name: 'palette @ 0x1C5D0',
    role: 'cram_palette_record_02',
  },
];

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

function findOverlaps(mapData, start, end) {
  return mapData.regions.filter(region => {
    const bounds = regionBounds(region);
    return bounds.start < end && bounds.end > start;
  });
}

function maxRegionIdNumber(mapData) {
  let maxId = 0;
  for (const region of mapData.regions) {
    const n = parseInt(String(region.id || '').replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n > maxId) maxId = n;
  }
  return maxId;
}

function annotatePaletteRegion(region, def, created) {
  region.analysis = region.analysis || {};
  region.analysis.paletteGapAudit = {
    catalogId: reportId,
    kind: def.role,
    summary: '16-byte palette record in the _DATA_1C5B0_ palette table.',
    confidence: 'high',
    createdRegion: created,
    evidence: [
      '_LABEL_8C1_ helper selects a 16-byte record from _DATA_1C5B0_ by multiplying the palette index by 16.',
      'The helper copies the selected 16-byte record to one CRAM buffer half, then copies the same 16 bytes to the adjacent half.',
      'ASM declares _DATA_1C5B0_ as a contiguous data table from 0x1C5B0 to 0x1C7FF; neighboring 16-byte records are already mapped as palette regions.',
    ],
    generatedAt: now,
    tool: 'tools/world-palette-gap-audit.mjs',
  };
}

function buildRegion(idNumber, def) {
  return {
    id: 'r' + String(idNumber).padStart(4, '0'),
    offset: hex(def.offset),
    size: def.size,
    type: 'palette',
    bank: Math.floor(def.offset / 0x4000),
    name: def.name,
    notes: 'Inserted by palette gap audit; metadata only, no palette bytes embedded.',
    source: 'audit',
  };
}

function audit(mapData) {
  const createdRegions = [];
  const evidenceOnlyRegions = [];
  const blocked = [];
  let nextIdNumber = maxRegionIdNumber(mapData) + 1;

  for (const def of PALETTE_GAPS) {
    const start = def.offset;
    const end = start + def.size;
    const overlaps = findOverlaps(mapData, start, end);
    const exact = overlaps.find(region => {
      const bounds = regionBounds(region);
      return bounds.start === start && bounds.end === end;
    });
    if (exact) {
      if (apply) annotatePaletteRegion(exact, def, false);
      evidenceOnlyRegions.push({
        id: exact.id,
        offset: exact.offset,
        size: exact.size || 0,
        type: exact.type || 'unknown',
        name: exact.name || '',
        role: def.role,
      });
      continue;
    }
    if (overlaps.length) {
      blocked.push({
        offset: hex(start),
        size: def.size,
        role: def.role,
        overlaps: overlaps.map(region => ({
          id: region.id,
          offset: region.offset,
          size: region.size || 0,
          type: region.type || 'unknown',
          name: region.name || '',
        })),
      });
      continue;
    }
    const region = buildRegion(nextIdNumber++, def);
    if (apply) {
      annotatePaletteRegion(region, def, true);
      mapData.regions.push(region);
    }
    createdRegions.push({
      id: region.id,
      offset: region.offset,
      size: region.size,
      type: region.type,
      name: region.name,
      role: def.role,
    });
  }

  if (apply && createdRegions.length) {
    mapData.regions.sort((a, b) => parseInt(a.offset, 16) - parseInt(b.offset, 16) || String(a.id).localeCompare(String(b.id)));
  }

  return { createdRegions, evidenceOnlyRegions, blocked };
}

function main() {
  const mapData = readJson(mapPath);
  const result = audit(mapData);
  const report = {
    id: reportId,
    type: 'palette_gap_audit',
    generatedAt: now,
    tool: `tools/world-palette-gap-audit.mjs${apply ? ' --apply' : ''}`,
    schemaVersion: 1,
    summary: {
      auditedRecords: PALETTE_GAPS.length,
      createdRegions: result.createdRegions.length,
      evidenceOnlyRegions: result.evidenceOnlyRegions.length,
      blockedRegions: result.blocked.length,
      assetPolicy: 'Metadata only: offsets, sizes, labels, and routine evidence. No ROM bytes or decoded palette colors are embedded.',
    },
    createdRegions: result.createdRegions,
    evidenceOnlyRegions: result.evidenceOnlyRegions,
    blocked: result.blocked,
    nextLeads: [
      'Run the coverage audit again after inserting these palette records; the bank-7 gap count should drop to zero.',
      'Build a palette-table catalog for the full _DATA_1C5B0_ record set and connect palette indices to scene recipes.',
    ],
  };

  if (apply) {
    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push(report);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    summary: report.summary,
    createdRegions: result.createdRegions,
    evidenceOnlyRegions: result.evidenceOnlyRegions,
    blocked: result.blocked,
  }, null, 2));
}

main();
