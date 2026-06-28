#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-zone-loader-boundary-catalog-2026-06-25';
const reportId = 'zone-loader-boundary-audit-2026-06-25';
const zoneGraphId = 'world-zone-graph-2026-06-24';

const MANAGED_START = 0x12400;
const MANAGED_END_EXCLUSIVE = 0x13AF0;
const REUSED_IDS = ['r2789', 'r2722'];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
}

function endExclusiveOf(region) {
  return offsetOf(region) + (region.size || 0);
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

function findById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findOverlappingRegions(mapData, start, endExclusive) {
  return (mapData.regions || []).filter(region => {
    const regionStart = offsetOf(region);
    const regionEnd = endExclusiveOf(region);
    return regionStart < endExclusive && start < regionEnd;
  });
}

function nextRegionNumber(mapData) {
  let maxId = 0;
  for (const region of mapData.regions || []) {
    const match = /^r(\d+)$/.exec(region.id || '');
    if (match) maxId = Math.max(maxId, Number(match[1]));
  }
  return maxId + 1;
}

function formatRegionId(number) {
  return 'r' + String(number).padStart(4, '0');
}

function segmentName(segment) {
  if (segment.kind === 'zone_vram_loader_8fb') return `zone graph 8FB loader @ ${hex(segment.start)}`;
  if (segment.kind === 'unresolved_gap_between_zone_loaders') return `unresolved data between zone 8FB loaders @ ${hex(segment.start)}`;
  return `unresolved data after zone 8FB loaders @ ${hex(segment.start)}`;
}

function loaderEvidence(loader) {
  return [
    'ASM lines 6476-6479: _LABEL_26F4_ stores the sub-record pointer, calls _LABEL_8FB_, then continues room setup.',
    `Zone graph ${zoneGraphId} validates descriptor sub-records whose vramLoader8fbRomOffset is ${hex(loader.start)}.`,
    `${loader.referenceCount} validated descriptor(s) reference this loader; sample descriptor offsets: ${loader.sampleDescriptors.join(', ')}.`,
    `The zone graph 8FB decoder validates this loader as ${loader.consumedBytes} byte(s), ${loader.entries} entries, ${loader.totalTiles} tile(s), ending at ${hex(loader.endExclusive - 1)}.`,
  ];
}

function gapEvidence(segment) {
  return [
    `Zone graph ${zoneGraphId} validates adjacent 8FB loader boundaries around this range but does not identify this byte range as an 8FB loader start.`,
    'No direct _LABEL_604_ screen-program root or _DATA_1CCC0_ target reaches the old 0x12486 screen-like candidate.',
    'This range is preserved as metadata-only unresolved data until a consumer or decoder is confirmed.',
  ];
}

function tailEvidence(segment) {
  return [
    `All validated zone graph 8FB loaders in the managed _DATA_12337_ tail end by ${hex(segment.start - 1)}.`,
    'No direct _LABEL_604_ screen-program root or _DATA_1CCC0_ target reaches the old 0x12486 screen-like candidate.',
    'The remaining bytes stay preserved as unresolved data inside the named _DATA_12337_ ASM incbin until a consumer is traced.',
  ];
}

function zoneGraph(mapData) {
  return (mapData.zoneGraphs || []).find(graph => graph.id === zoneGraphId) || null;
}

function collectLoaders(graph) {
  const byOffset = new Map();
  for (const descriptor of graph?.descriptors || []) {
    const loader = descriptor.vramLoader8fb;
    if (!loader?.valid) continue;
    const start = parseInt(loader.romOffset, 16);
    if (start < MANAGED_START || start >= MANAGED_END_EXCLUSIVE) continue;
    const item = byOffset.get(start) || {
      start,
      consumedBytes: loader.consumedBytes,
      entries: loader.entries,
      totalTiles: loader.totalTiles,
      maxVramTile: loader.maxVramTile,
      warningCount: (loader.warnings || []).length,
      descriptorOffsets: [],
    };
    item.descriptorOffsets.push(descriptor.descriptorOffset);
    byOffset.set(start, item);
  }

  return [...byOffset.values()]
    .map(item => ({
      ...item,
      endExclusive: item.start + item.consumedBytes,
      referenceCount: item.descriptorOffsets.length,
      sampleDescriptors: item.descriptorOffsets.slice(0, 12),
    }))
    .sort((a, b) => a.start - b.start);
}

function buildSegments(loaders) {
  const segments = [];
  let cursor = MANAGED_START;

  for (const loader of loaders) {
    if (loader.start > cursor) {
      segments.push({
        kind: 'unresolved_gap_between_zone_loaders',
        start: cursor,
        endExclusive: loader.start,
        size: loader.start - cursor,
        confidence: 'low',
        evidence: null,
      });
    }
    segments.push({
      kind: 'zone_vram_loader_8fb',
      start: loader.start,
      endExclusive: loader.endExclusive,
      size: loader.consumedBytes,
      confidence: 'high',
      loader,
      evidence: loaderEvidence(loader),
    });
    cursor = Math.max(cursor, loader.endExclusive);
  }

  if (cursor < MANAGED_END_EXCLUSIVE) {
    segments.push({
      kind: 'unresolved_tail_after_zone_loaders',
      start: cursor,
      endExclusive: MANAGED_END_EXCLUSIVE,
      size: MANAGED_END_EXCLUSIVE - cursor,
      confidence: 'low',
      evidence: null,
    });
  }

  for (const segment of segments) {
    if (!segment.evidence) {
      segment.evidence = segment.kind === 'unresolved_tail_after_zone_loaders'
        ? tailEvidence(segment)
        : gapEvidence(segment);
    }
  }

  return segments;
}

function buildCatalog(mapData) {
  const graph = zoneGraph(mapData);
  const loaders = collectLoaders(graph);
  const segments = buildSegments(loaders);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-zone-loader-boundary-audit.mjs',
    source: {
      zoneGraphId,
      asmDataLabel: '_DATA_12337_',
      managedRange: [hex(MANAGED_START), hex(MANAGED_END_EXCLUSIVE - 1)],
      directAsmLoaderPrefix: {
        offset: '0x12337',
        endInclusive: '0x123FF',
        note: '_LABEL_1E200_ directly loads _DATA_12337_ through _LABEL_8FB_; zone graph sub-records independently select the following 8FB loaders by pointer.',
      },
    },
    summary: {
      managedRangeBytes: MANAGED_END_EXCLUSIVE - MANAGED_START,
      zoneGraphLoaders: loaders.length,
      loaderBytes: segments.filter(segment => segment.kind === 'zone_vram_loader_8fb').reduce((sum, segment) => sum + segment.size, 0),
      unresolvedGapBytes: segments.filter(segment => segment.kind !== 'zone_vram_loader_8fb').reduce((sum, segment) => sum + segment.size, 0),
      segments: segments.length,
      assetPolicy: 'Metadata only: loader offsets, consumed byte counts, descriptor references, region boundaries, and evidence. No ROM bytes or decoded graphics are embedded.',
    },
    loaders: loaders.map(loader => ({
      offset: hex(loader.start),
      endInclusive: hex(loader.endExclusive - 1),
      consumedBytes: loader.consumedBytes,
      entries: loader.entries,
      totalTiles: loader.totalTiles,
      maxVramTile: loader.maxVramTile,
      referenceCount: loader.referenceCount,
      sampleDescriptors: loader.sampleDescriptors,
    })),
    segments: segments.map(segment => ({
      kind: segment.kind,
      offset: hex(segment.start),
      endInclusive: hex(segment.endExclusive - 1),
      size: segment.size,
      type: segment.kind === 'zone_vram_loader_8fb' ? 'vram_loader_8fb' : 'data_table',
      confidence: segment.confidence,
      loader: segment.loader ? {
        consumedBytes: segment.loader.consumedBytes,
        entries: segment.loader.entries,
        totalTiles: segment.loader.totalTiles,
        maxVramTile: segment.loader.maxVramTile,
        referenceCount: segment.loader.referenceCount,
        sampleDescriptors: segment.loader.sampleDescriptors,
      } : null,
      evidence: segment.evidence,
    })),
  };
}

function makeRegion(id, segment, previous = null) {
  const type = segment.kind === 'zone_vram_loader_8fb' ? 'vram_loader_8fb' : 'data_table';
  const analysis = {
    zoneLoaderBoundaryAudit: {
      catalogId,
      kind: segment.kind,
      confidence: segment.confidence,
      typeBeforeAudit: previous?.type || 'covered_by_previous_region',
      typeAfterAudit: type,
      offsetBeforeAudit: previous?.offset || null,
      sizeBeforeAudit: previous?.size || 0,
      offsetAfterAudit: hex(segment.start),
      sizeAfterAudit: segment.size,
      changedType: !previous || (previous.type || 'unknown') !== type,
      changedRange: !previous || previous.offset !== hex(segment.start) || previous.size !== segment.size,
      summary: segment.kind === 'zone_vram_loader_8fb'
        ? 'Validated room-selected _LABEL_8FB_ loader from the zone graph descriptor parser.'
        : 'Preserved unresolved data between validated room-selected _LABEL_8FB_ loader boundaries.',
      loader: segment.loader ? {
        consumedBytes: segment.loader.consumedBytes,
        entries: segment.loader.entries,
        totalTiles: segment.loader.totalTiles,
        maxVramTile: segment.loader.maxVramTile,
        referenceCount: segment.loader.referenceCount,
        sampleDescriptors: segment.loader.sampleDescriptors,
      } : null,
      supersededAnalyses: previous?.analysisKeys || [],
      evidence: segment.evidence,
      generatedAt: now,
      tool: 'tools/world-zone-loader-boundary-audit.mjs',
    },
  };

  const region = {
    id,
    offset: hex(segment.start),
    size: segment.size,
    type,
    name: segmentName(segment),
    confidence: segment.confidence,
    notes: segment.kind === 'zone_vram_loader_8fb'
      ? 'Room descriptor graph-selected _LABEL_8FB_ loader; metadata only, no decoded graphics embedded.'
      : 'Unresolved data preserved after splitting validated zone graph 8FB loader boundaries.',
    analysis,
  };
  if (type === 'vram_loader_8fb') {
    region.params = { format: '8fb', loaderFormat: '8fb' };
  }
  return region;
}

function priorSnapshot(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
    analysisKeys: Object.keys(region.analysis || {}),
  };
}

function applyCatalog(mapData, catalog) {
  const oldR2789 = priorSnapshot(findById(mapData, 'r2789'));
  const oldR2722 = priorSnapshot(findById(mapData, 'r2722'));
  const segments = catalog.segments.map(segment => ({
    ...segment,
    start: parseInt(segment.offset, 16),
    endExclusive: parseInt(segment.endInclusive, 16) + 1,
  }));

  const deleted = [];
  mapData.regions = (mapData.regions || []).filter(region => {
    const start = offsetOf(region);
    if (REUSED_IDS.includes(region.id)) return true;
    if (start < MANAGED_START || start >= MANAGED_END_EXCLUSIVE) return true;
    if (region.analysis?.zoneLoaderBoundaryAudit?.catalogId === catalogId) {
      deleted.push(regionRef(region));
      return false;
    }
    return true;
  });

  let nextId = nextRegionNumber(mapData);
  const assignments = [];

  for (let index = 0; index < segments.length; index++) {
    const segment = {
      ...segments[index],
      loader: catalog.segments[index].loader ? {
        ...catalog.segments[index].loader,
        descriptorOffsets: catalog.segments[index].loader.sampleDescriptors,
      } : null,
    };
    let id = null;
    let previous = null;
    if (index === 0) {
      id = 'r2789';
      previous = oldR2789;
    } else if (index === 1) {
      id = 'r2722';
      previous = oldR2722;
    } else {
      id = formatRegionId(nextId++);
    }

    const existingIndex = mapData.regions.findIndex(region => region.id === id);
    const region = makeRegion(id, segment, previous);
    if (existingIndex >= 0) mapData.regions[existingIndex] = region;
    else mapData.regions.push(region);
    assignments.push({
      id,
      offset: region.offset,
      size: region.size,
      type: region.type,
      kind: region.analysis.zoneLoaderBoundaryAudit.kind,
      previous,
    });
  }

  mapData.regions.sort((a, b) => offsetOf(a) - offsetOf(b) || (a.size || 0) - (b.size || 0));
  return { assignments, deleted };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const overlapsBefore = findOverlappingRegions(mapData, MANAGED_START, MANAGED_END_EXCLUSIVE).map(regionRef);
  const changes = apply ? applyCatalog(mapData, catalog) : { assignments: [], deleted: [] };
  const overlapsAfter = apply ? findOverlappingRegions(mapData, MANAGED_START, MANAGED_END_EXCLUSIVE).map(regionRef) : [];

  if (apply) {
    mapData.zoneLoaderBoundaryCatalogs = (mapData.zoneLoaderBoundaryCatalogs || []).filter(item => item.id !== catalogId);
    mapData.zoneLoaderBoundaryCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_loader_boundary_audit',
      generatedAt: now,
      tool: 'tools/world-zone-loader-boundary-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        assignedRegions: changes.assignments.length,
        removedPriorManagedRegions: changes.deleted.length,
      },
      source: catalog.source,
      assignedRegions: changes.assignments,
      removedPriorManagedRegions: changes.deleted,
      previousOverlaps: overlapsBefore,
      currentManagedRegions: overlapsAfter,
      nextLeads: [
        'Run tile-source and screen-program audits after this split so loader provenance and screen reachability catalogs no longer include the stale 0x12486 false positive.',
        'Trace consumers for the remaining gap/tail data ranges between and after validated zone 8FB loaders.',
        'Promote the zone graph loader offsets into scene recipes so room rendering can select the correct room-specific 8FB loader.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    overlapsBefore,
    assignedRegions: changes.assignments,
    removedPriorManagedRegions: changes.deleted,
    segments: catalog.segments.map(segment => ({
      kind: segment.kind,
      offset: segment.offset,
      endInclusive: segment.endInclusive,
      size: segment.size,
      type: segment.type,
      referenceCount: segment.loader?.referenceCount || 0,
    })),
  }, null, 2));
}

main();
