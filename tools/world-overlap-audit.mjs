#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-overlap-catalog-2026-06-24';
const reportId = 'overlap-audit-2026-06-24';

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

function pairKey(overlap) {
  const ids = [overlap.a.id, overlap.b.id].sort();
  return `${ids[0]}:${ids[1]}:${overlap.range.start}:${overlap.range.endInclusive}`;
}

function findAsmLine(asmText, needle) {
  const lines = asmText.split(/\r?\n/);
  const idx = lines.findIndex(line => line.includes(needle));
  return idx >= 0 ? idx + 1 : null;
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

function findScreenProgEntry(mapData, regionId) {
  for (const catalog of mapData.screenProgCatalogs || []) {
    const entry = (catalog.entries || []).find(item => item.region && item.region.id === regionId);
    if (entry) return entry;
  }
  return null;
}

function classifyKnownOverlap(overlap, mapData, asmText) {
  const ids = [overlap.a.id, overlap.b.id].sort();
  const idKey = ids.join('/');
  const key = pairKey(overlap);

  if (idKey === 'r0782/r1476') {
    const root = mapData.regions.find(region => region.id === 'r1476');
    const alias = mapData.regions.find(region => region.id === 'r0782');
    const rootBounds = regionBounds(root);
    const aliasBounds = regionBounds(alias);
    const asmLine = findAsmLine(asmText, '_DATA_18000_:');
    const referenceCount = root.analysis?.metaspriteAudit?.detail?.referenceCount || alias.analysis?.metaspriteAudit?.detail?.referenceCount || 0;
    return {
      id: `${key}:nested_metasprite_alias`,
      pairKey: key,
      status: 'explained',
      kind: 'nested_metasprite_alias',
      confidence: 'medium',
      range: overlap.range,
      regions: [regionRef(root), regionRef(alias)],
      roles: {
        r1476: 'bank6_metasprite_blob_root',
        r0782: 'nested_metasprite_alias_or_subview',
      },
      summary: 'The smaller metasprite annotation starts inside the same ASM _DATA_18000_ blob and is retained as a nested subview until the bank-6 metasprite header/frame boundary is fully modeled.',
      evidence: [
        `r0782 starts ${hex(aliasBounds.start - rootBounds.start, 2)} bytes after r1476 and both end at ${hex(rootBounds.end)} exclusive.`,
        asmLine ? `ASM line ${asmLine}: _DATA_18000_ is the single bank-6 data label for the 0x18000-0x18584 metasprite blob.` : 'ASM label _DATA_18000_ covers the 0x18000-0x18584 metasprite blob.',
        `Metasprite audit records ${referenceCount} entity-animation frame pointer reference(s) into this bank-6 frame/metasprite target data.`,
      ],
      recommendation: 'Keep both annotations for now; prefer r1476 for blob-level coverage and r0782 only as a nested alias/subview until a stricter metasprite-frame decoder is written.',
    };
  }

  if (idKey === 'r0764/r2707') {
    const parent = mapData.regions.find(region => region.id === 'r2707');
    const child = mapData.regions.find(region => region.id === 'r0764');
    const parentEntry = findScreenProgEntry(mapData, 'r2707');
    const childEntry = findScreenProgEntry(mapData, 'r0764');
    const asmLine = findAsmLine(asmText, '_DATA_1DBB9_:');
    return {
      id: `${key}:embedded_screen_prog_tail`,
      pairKey: key,
      status: 'explained',
      kind: 'embedded_screen_prog_tail',
      confidence: 'high',
      range: overlap.range,
      regions: [regionRef(parent), regionRef(child)],
      roles: {
        r2707: 'screen_prog_parent',
        r0764: 'embedded_screen_prog_tail',
      },
      summary: 'The continue/game-over screen program includes a reusable embedded tail that also decodes independently as the dead-screen hearts program.',
      evidence: [
        `r0764 starts inside r2707 at ${child.offset}; both screen_prog decodes terminate at ${parentEntry?.endReason || childEntry?.endReason || 'the same 0xF0 end marker'}.`,
        `screen_prog audit decodes r2707 with ${parentEntry?.stats?.ops ?? 'unknown'} op(s), ${parentEntry?.stats?.writtenCells ?? 'unknown'} written cell(s), and ${(parentEntry?.warnings || []).length} warning(s).`,
        `screen_prog audit decodes r0764 with ${childEntry?.stats?.ops ?? 'unknown'} op(s), ${childEntry?.stats?.writtenCells ?? 'unknown'} written cell(s), and ${(childEntry?.warnings || []).length} warning(s).`,
        asmLine ? `ASM line ${asmLine}: _DATA_1DBB9_ marks the parent screen program; the child starts at an interior command boundary.` : '_DATA_1DBB9_ marks the parent screen program; the child starts at an interior command boundary.',
      ],
      recommendation: 'Keep both regions: r2707 is the full continue/game-over program, while r0764 is a valid embedded tail entry for focused rendering and diagnostics.',
    };
  }

  return {
    id: `${key}:unexplained_overlap`,
    pairKey: key,
    status: 'unexplained',
    kind: 'overlap_needs_review',
    confidence: 'low',
    range: overlap.range,
    regions: [overlap.a, overlap.b],
    roles: {},
    summary: 'This overlap has not been classified by the overlap audit.',
    evidence: ['Coverage audit detected intersecting region ranges.'],
    recommendation: 'Inspect ASM references, parser boundaries, and type-specific catalogs before deleting or merging either region.',
  };
}

function buildCatalog(mapData, asmText) {
  const overlaps = computeOverlaps(mapData.regions || []).map(overlap => classifyKnownOverlap(overlap, mapData, asmText));
  const summary = overlaps.reduce((acc, overlap) => {
    acc.overlaps++;
    if (overlap.status === 'explained') acc.explained++;
    else acc.unexplained++;
    acc.byKind[overlap.kind] = (acc.byKind[overlap.kind] || 0) + 1;
    return acc;
  }, {
    overlaps: 0,
    explained: 0,
    unexplained: 0,
    byKind: {},
    assetPolicy: 'Metadata only: region ids, offsets, parser summaries, ASM label line references, and confidence notes. No ROM bytes or decoded assets are embedded.',
  });
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-overlap-audit.mjs',
    summary,
    overlaps,
  };
}

function annotateRegions(mapData, catalog) {
  const annotated = [];
  for (const overlap of catalog.overlaps) {
    for (const ref of overlap.regions) {
      const region = mapData.regions.find(item => item.id === ref.id);
      if (!region) continue;
      region.analysis = region.analysis || {};
      const audit = region.analysis.overlapAudit || {};
      const entries = (audit.entries || []).filter(entry => entry.pairKey !== overlap.pairKey);
      entries.push({
        pairKey: overlap.pairKey,
        catalogId,
        status: overlap.status,
        kind: overlap.kind,
        confidence: overlap.confidence,
        role: overlap.roles[region.id] || 'overlapping_region',
        range: overlap.range,
        pairedRegions: overlap.regions.filter(item => item.id !== region.id),
        summary: overlap.summary,
        evidence: overlap.evidence,
        recommendation: overlap.recommendation,
      });
      region.analysis.overlapAudit = {
        catalogId,
        generatedAt: now,
        tool: 'tools/world-overlap-audit.mjs',
        entries,
      };
      annotated.push({ id: region.id, offset: region.offset, type: region.type, overlap: overlap.kind, status: overlap.status });
    }
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotatedRegions = apply ? annotateRegions(mapData, catalog) : catalog.overlaps.flatMap(overlap => (
    overlap.regions.map(region => ({ id: region.id, offset: region.offset, type: region.type, overlap: overlap.kind, status: overlap.status }))
  ));

  if (apply) {
    mapData.overlapCatalogs = (mapData.overlapCatalogs || []).filter(c => c.id !== catalogId);
    mapData.overlapCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'overlap_audit',
      generatedAt: now,
      tool: 'tools/world-overlap-audit.mjs --apply',
      schemaVersion: 1,
      summary: catalog.summary,
      overlaps: catalog.overlaps,
      annotatedRegions,
      nextLeads: [
        'Replace the r0782 nested metasprite alias with stricter subrecord metadata once the bank-6 metasprite header/table format is decoded.',
        'Use the r2707/r0764 embedded-tail pattern to detect other screen_prog subentry points that start inside larger UI programs.',
        'Teach the analyzer region list to display explained overlap badges separately from suspicious overlap warnings.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions,
    unexplained: catalog.overlaps.filter(overlap => overlap.status !== 'explained'),
  }, null, 2));
}

main();
