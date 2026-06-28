#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-player-a48-nonmatch-dynamic-route-audit.mjs';
const catalogId = 'world-player-a48-nonmatch-dynamic-route-catalog-2026-06-26';
const reportId = 'player-a48-nonmatch-dynamic-route-audit-2026-06-26';
const schemaVersion = 1;
const targetClassification = 'no_a48_source_interval_match_needs_other_dynamic_or_decompression_trace';

const sourceCatalogIds = {
  playerA48DynamicSeedLink: 'world-player-a48-dynamic-seed-link-catalog-2026-06-26',
  graphicsDynamicSourceTraceSeed: 'world-graphics-dynamic-source-trace-seed-catalog-2026-06-26',
  dynamicVdpBankVariable: 'world-dynamic-vdp-bank-variable-catalog-2026-06-26',
  dynamicVdpUploadCaller: 'world-dynamic-vdp-upload-caller-catalog-2026-06-26',
  bankedVdpUploaderCallsite: 'world-banked-vdp-uploader-callsite-catalog-2026-06-26',
};

const nonA48RouteIds = [
  'record_derived_8fb_path',
  'record_derived_998_or_dynamic_decode_path',
];

const routePriority = {
  record_derived_998_or_dynamic_decode_path: 'primary',
  record_derived_8fb_path: 'secondary',
};

const ramTraceSeeds = [
  { symbol: '_RAM_D0F3_', address: '$D0F3', role: 'record_derived_source_bank_latch_for_919_99b_a97_paths', confidence: 'high' },
  { symbol: '_RAM_DFFF_', address: '$DFFF', role: 'previous_mapper_bank_restore_context', confidence: 'medium_high' },
  { symbol: '_RAM_FFFF_', address: '$FFFF', role: 'mapper_page2_bank_write', confidence: 'high' },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value.replace(/^\$/, '0x'), 16);
  return NaN;
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

function findRamByAddress(mapData, address) {
  const normalized = String(address || '').toUpperCase().replace(/^0X/, '$');
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === normalized) || null;
}

function seedBySpanId(dynamicSeedCatalog) {
  return new Map((dynamicSeedCatalog.seeds || []).map(seed => [seed.spanId, seed]));
}

function routeById(dynamicSeedCatalog) {
  return new Map((dynamicSeedCatalog.routes || []).map(route => [route.id, route]));
}

function compactRoute(route) {
  return {
    id: route.id,
    priority: routePriority[route.id] || 'candidate',
    routineLabels: route.routineLabels || [],
    callerLabels: route.callerLabels || [],
    bankFormula: route.bankFormula,
    traceStatus: route.traceStatus,
    selectorState: route.selectorState || [],
    confidence: route.confidence,
    routines: (route.routines || []).map(routine => ({
      label: routine.label,
      region: routine.region,
      role: routine.role,
      eventCounts: routine.eventCounts || {},
    })),
    callsites: (route.callsites || []).map(callsite => ({
      callerLabel: callsite.callerLabel,
      callerRegion: callsite.callerRegion,
      target: callsite.target,
      line: callsite.line,
      classification: callsite.classification,
      selectorState: callsite.selectorState || [],
      bankContext: callsite.bankContext,
    })),
  };
}

function buildEntry(link, dynamicSeed, routes) {
  const retainedRouteIds = (dynamicSeed?.candidateRoutes || [])
    .filter(routeId => nonA48RouteIds.includes(routeId));
  const routeRefs = retainedRouteIds
    .map(routeId => routes.get(routeId))
    .filter(Boolean)
    .map(compactRoute)
    .sort((a, b) => String(a.priority).localeCompare(String(b.priority)) || String(a.id).localeCompare(String(b.id)));

  return {
    id: `${link.spanId}_non_a48_dynamic_route`,
    spanId: link.spanId,
    region: link.region,
    range: link.range,
    nonblankTileCount: link.nonblankTileCount,
    sourceRecordHighBytes: link.sourceRecordHighBytes || [],
    sourceRecordWordChunks: link.sourceRecordWordChunks || [],
    upstreamClassification: link.classification,
    priority: link.nonblankTileCount <= 1 ? 'focused_single_tile_trace' : 'focused_trace',
    rejectedRoute: {
      id: 'record_derived_a48_player_animation_path',
      reason: 'The A48 dynamic seed link audit found zero confirmed, candidate, or accepted-gap _LABEL_A48_ source interval overlap for this span.',
      evidenceCatalogId: sourceCatalogIds.playerA48DynamicSeedLink,
    },
    retainedRoutes: routeRefs,
    retainedRouteIds: retainedRouteIds,
    recommendedTrace: 'Trace sourceRecordHighByte 0x17 through _LABEL_9C3_/_LABEL_99B_/_LABEL_A97_ first, then check _LABEL_919_ if no entity/item dynamic decode path consumes the source word.',
    overlapSummary: link.overlapSummary,
    dynamicSeedEvidence: dynamicSeed ? {
      originalRecommendedAction: dynamicSeed.recommendedAction,
      actionConfidence: dynamicSeed.actionConfidence,
      structuredFinalTriage: dynamicSeed.structuredFinalTriage || null,
      directSourceAddressEvidence: dynamicSeed.directSourceAddressEvidence || null,
      candidateRoutes: dynamicSeed.candidateRoutes || [],
    } : null,
    evidenceCatalogs: Object.values(sourceCatalogIds),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
  };
}

function buildCatalog(mapData) {
  const linkCatalog = requireCatalog(mapData, sourceCatalogIds.playerA48DynamicSeedLink);
  const dynamicSeedCatalog = requireCatalog(mapData, sourceCatalogIds.graphicsDynamicSourceTraceSeed);
  requireCatalog(mapData, sourceCatalogIds.dynamicVdpBankVariable);
  requireCatalog(mapData, sourceCatalogIds.dynamicVdpUploadCaller);
  requireCatalog(mapData, sourceCatalogIds.bankedVdpUploaderCallsite);

  const dynamicSeeds = seedBySpanId(dynamicSeedCatalog);
  const routes = routeById(dynamicSeedCatalog);
  const entries = (linkCatalog.links || [])
    .filter(link => link.classification === targetClassification)
    .sort((a, b) => parseOffset(a.range?.start) - parseOffset(b.range?.start))
    .map(link => buildEntry(link, dynamicSeeds.get(link.spanId), routes));

  const retainedRoutes = entries.flatMap(entry => entry.retainedRoutes || []);
  const routeRoutineRegions = retainedRoutes.flatMap(route => (route.routines || []).map(routine => routine.region?.id));
  const routeCallerRegions = retainedRoutes.flatMap(route => (route.callsites || []).map(callsite => callsite.callerRegion?.id));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: span offsets, source-record words, labels, route ids, region ids, RAM symbols, counts, and trace decisions. No ROM bytes, decoded graphics, screenshots, hashes, pixels, audio, text, or ASM instruction bytes are embedded.',
    target: {
      upstreamCatalogId: sourceCatalogIds.playerA48DynamicSeedLink,
      upstreamClassification: targetClassification,
      sourceBank: '0x0B',
      reason: 'These are the residual bank 0x0B graphics seeds with zero _LABEL_A48_ source interval overlap after the A48 linkage audit.',
    },
    summary: {
      traceEntryCount: entries.length,
      seedRegionCount: new Set(entries.map(entry => entry.region?.id).filter(Boolean)).size,
      seedRegionIds: uniqueSorted(entries.map(entry => entry.region?.id)),
      sourceRecordHighBytes: uniqueSorted(entries.flatMap(entry => entry.sourceRecordHighBytes || [])),
      nonblankTileCount: sumBy(entries, entry => entry.nonblankTileCount || 0),
      sourceByteCount: sumBy(entries, entry => entry.range?.sizeBytes || 0),
      singleTileEntryCount: entries.filter(entry => entry.nonblankTileCount === 1 && entry.range?.sizeBytes === 32).length,
      retainedRouteIds: uniqueSorted(entries.flatMap(entry => entry.retainedRouteIds || [])),
      retainedRouteCount: uniqueSorted(entries.flatMap(entry => entry.retainedRouteIds || [])).length,
      routeRoutineRegionIds: uniqueSorted(routeRoutineRegions),
      routeCallerRegionIds: uniqueSorted(routeCallerRegions),
      priorityCounts: countBy(entries, entry => entry.priority),
      ramTraceSeedCount: ramTraceSeeds.length,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    entries,
    ramTraceSeeds,
    evidence: [
      `${sourceCatalogIds.playerA48DynamicSeedLink} classifies these spans as no-A48 matches with zero confirmed/candidate/accepted-gap A48 source interval overlap.`,
      `${sourceCatalogIds.graphicsDynamicSourceTraceSeed} supplies the original sourceRecordHighByte 0x17 trace seeds and candidate route list.`,
      `${sourceCatalogIds.dynamicVdpBankVariable} and ${sourceCatalogIds.dynamicVdpUploadCaller} define the non-A48 dynamic upload routes and caller selector context.`,
      'The audit rejects the A48 path only for these four spans; it does not claim which non-A48 route is correct or promote graphics coverage.',
    ],
    nextLeads: [
      'Trace the four single-tile r2656 gaps through _LABEL_9C3_/_LABEL_99B_/_LABEL_A97_ before checking the secondary _LABEL_919_ path.',
      'Instrument _RAM_D0F3_ and _RAM_FFFF_ around sourceRecordHighByte 0x17 to prove the active mapper bank at the copy/decode site.',
      'Only promote these 128 bytes of graphics coverage after a concrete non-A48 consumer writes the corresponding VRAM tile slot.',
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
        entryCount: 0,
        nonblankTileCount: 0,
        sourceByteCount: 0,
        spanIds: [],
        sourceRecordHighBytes: new Set(),
      });
    }
    const detail = byRegion.get(regionId);
    detail.entryCount++;
    detail.nonblankTileCount += entry.nonblankTileCount || 0;
    detail.sourceByteCount += entry.range?.sizeBytes || 0;
    detail.spanIds.push(entry.spanId);
    for (const highByte of entry.sourceRecordHighBytes || []) detail.sourceRecordHighBytes.add(highByte);
  }

  for (const [regionId, detail] of byRegion) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'non_a48_dynamic_graphics_seed_region' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48NonmatchDynamicRouteAudit = {
        catalogId,
        role: 'non_a48_dynamic_graphics_seed_region',
        confidence: 'medium',
        summary: 'Region contains residual bank 0x0B graphics seed spans with no _LABEL_A48_ source interval match; route through non-A48 dynamic/decompression traces.',
        detail: {
          entryCount: detail.entryCount,
          nonblankTileCount: detail.nonblankTileCount,
          sourceByteCount: detail.sourceByteCount,
          sourceRecordHighBytes: [...detail.sourceRecordHighBytes].sort(),
          spanIds: detail.spanIds,
          retainedRouteIds: catalog.summary.retainedRouteIds,
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
      role: 'non_a48_dynamic_graphics_seed_region',
      entryCount: detail.entryCount,
      nonblankTileCount: detail.nonblankTileCount,
    });
  }

  const routeRegionIds = uniqueSorted([
    ...catalog.summary.routeRoutineRegionIds,
    ...catalog.summary.routeCallerRegionIds,
  ]);
  for (const regionId of routeRegionIds) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'non_a48_dynamic_route_region' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerA48NonmatchDynamicRouteAudit = {
        catalogId,
        role: 'non_a48_dynamic_route_region',
        confidence: 'medium',
        summary: 'Routine or caller is part of the non-A48 dynamic/decompression route queue for residual bank 0x0B graphics seed spans.',
        detail: {
          retainedRouteIds: catalog.summary.retainedRouteIds,
          sourceRecordHighBytes: catalog.summary.sourceRecordHighBytes,
          traceEntryCount: catalog.summary.traceEntryCount,
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
      role: 'non_a48_dynamic_route_region',
    });
  }

  const changedRam = [];
  for (const seed of catalog.ramTraceSeeds) {
    const ramEntry = findRamByAddress(mapData, seed.address);
    if (!ramEntry) continue;
    if (apply) {
      ramEntry.analysis = ramEntry.analysis || {};
      ramEntry.analysis.playerA48NonmatchDynamicRouteAudit = {
        catalogId,
        symbol: seed.symbol,
        role: seed.role,
        confidence: seed.confidence,
        summary: 'RAM value is part of proving the non-A48 dynamic/decompression route for residual bank 0x0B graphics seed spans.',
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      id: ramEntry.id,
      address: ramEntry.address,
      name: ramEntry.name || '',
      symbol: seed.symbol,
      role: seed.role,
      confidence: seed.confidence,
    });
  }

  return { changedRegions, missingRegions, changedRam };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    entries: catalog.entries.map(entry => ({
      spanId: entry.spanId,
      region: entry.region,
      range: entry.range,
      sourceRecordHighBytes: entry.sourceRecordHighBytes,
      sourceRecordWordChunks: entry.sourceRecordWordChunks,
      retainedRouteIds: entry.retainedRouteIds,
      priority: entry.priority,
    })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
  mapData.graphicsCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'player_a48_nonmatch_dynamic_route_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    sample: reportSample(catalog),
    assetPolicy: catalog.assetPolicy,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
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
    changedRam: annotation.changedRam,
  }, null, 2));
}

main();
