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
const catalogId = 'world-zone-collision-recipe-catalog-2026-06-25';
const reportId = 'zone-collision-recipe-audit-2026-06-25';
const toolName = 'tools/world-zone-collision-recipe-audit.mjs';

const sourceCatalogIds = {
  zoneRecipes: 'world-zone-recipe-catalog-2026-06-25',
  dc2ScrollMap: 'world-dc2-scroll-map-catalog-2026-06-25',
  collisionBuffer: 'world-collision-buffer-provenance-catalog-2026-06-25',
  collisionBound: 'world-collision-bound-catalog-2026-06-25',
};

function hex(n, pad = 2) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function hexWord(n) {
  return hex(n & 0xFFFF, 4);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => (entry.address || '').toUpperCase() === address.toUpperCase()) || null;
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

function ramRef(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || 'byte',
    name: entry.name || '',
  };
}

function findCatalog(mapData, id) {
  return Object.keys(mapData)
    .filter(key => Array.isArray(mapData[key]) && /catalog/i.test(key))
    .flatMap(key => mapData[key].map(catalog => ({ bucket: key, catalog })))
    .find(item => item.catalog?.id === id) || null;
}

function sourceCatalogRefs(mapData) {
  return Object.fromEntries(Object.entries(sourceCatalogIds).map(([key, id]) => {
    const found = findCatalog(mapData, id);
    return [key, found ? { id, bucket: found.bucket } : null];
  }));
}

function isTerminator(stream) {
  return (stream?.index || '').toUpperCase() === '0XFF' || stream?.disabled === true;
}

function activePrefixCount(streams) {
  let count = 0;
  for (const stream of streams) {
    if (isTerminator(stream)) break;
    count++;
  }
  return count;
}

function nonTerminatorAfterFirstTerminator(streams, activeCount) {
  return streams.slice(activeCount + 1).filter(stream => !isTerminator(stream));
}

function boundForActiveCount(activeCount) {
  const finalWord = (0xFF00 + activeCount * 0x0100) & 0xFFFF;
  const finalHigh = (finalWord >> 8) & 0xFF;
  return {
    finalBoundWord: hexWord(finalWord),
    finalHighByte: hex(finalHigh, 2),
    acceptedHighByteRange: activeCount > 0 ? `0x00-${hex(finalHigh, 2)}` : 'none',
    acceptedCellColumns: activeCount * 16,
    decodedWrittenCells: activeCount * 11 * 16,
  };
}

function streamSourceRef(stream) {
  if (!stream || isTerminator(stream)) return null;
  return {
    tableEntryOffset: stream.tableEntryOffset || null,
    z80Pointer: stream.z80Pointer || null,
    romOffset: stream.romOffset || null,
    region: stream.region || null,
    runtimeConsumedBytes: stream.runtimeConsumedBytes ?? null,
    writtenCells: stream.writtenCells ?? null,
    valid: stream.valid ?? null,
  };
}

function slotCoverage(streams, activeCount) {
  return streams.map((stream, slot) => {
    const decoded = slot < activeCount;
    const terminator = slot === activeCount && isTerminator(stream);
    const trailing = slot > activeCount && isTerminator(stream);
    let role = 'decoded_stream';
    if (terminator) role = 'terminator_unprocessed';
    else if (trailing) role = 'trailing_unprocessed';
    else if (!decoded) role = 'unexpected_non_ff_after_terminator';

    return {
      slot,
      role,
      index: stream?.index || null,
      decoded,
      source: decoded ? streamSourceRef(stream) : null,
      columnRange: {
        start: hex(slot * 16, 2),
        endInclusive: hex(slot * 16 + 15, 2),
        count: 16,
      },
      rowCount: decoded ? 11 : 0,
      writtenCells: decoded ? 11 * 16 : 0,
    };
  });
}

function collisionDependency(recipe, sourceRefs) {
  const streams = recipe.dependencies?.dc2Streams || [];
  const activeCount = activePrefixCount(streams);
  const bound = boundForActiveCount(activeCount);
  const warnings = [];
  if (streams.length !== 6) warnings.push(`Expected 6 DC2 stream slots, found ${streams.length}.`);
  const unexpectedAfterTerminator = nonTerminatorAfterFirstTerminator(streams, activeCount);
  if (unexpectedAfterTerminator.length) {
    warnings.push('Found non-$FF DC2 indexes after the first terminator; _LABEL_DC2_ would not decode those slots.');
  }

  return {
    kind: 'dc2_collision_render_buffer_recipe',
    catalogId,
    sourceCatalogs: sourceRefs,
    sourceDc2Dependency: 'dependencies.dc2Streams',
    producer: '_LABEL_DC2_',
    visualConsumer: '_LABEL_EF3_',
    collisionConsumer: '_LABEL_141F_',
    baseRam: '_RAM_CB00_',
    baseAddress: '$CB00',
    maxFootprint: {
      start: '$CB00',
      endInclusive: '$CF1F',
      sizeBytes: 0x420,
    },
    rowCount: 11,
    maxStreamSlotCount: 6,
    activeDc2PrefixCount: activeCount,
    terminatorIndex: '0xFF',
    terminatorSlot: activeCount < streams.length ? activeCount : null,
    cellsPerStreamRow: 16,
    maxCellsPerRow: 96,
    activeCellsPerRow: bound.acceptedCellColumns,
    rowStrideBytes: '0x60',
    ...bound,
    boundRam: {
      wordAlias: '_RAM_D019_',
      highByte: '_RAM_D01A_',
      formula: 'finalHighByte = activeDc2PrefixCount - 1; acceptedCellColumns = activeDc2PrefixCount * 16',
    },
    slotCoverage: slotCoverage(streams, activeCount),
    warnings,
    confidence: warnings.length ? 'medium' : 'high',
    evidence: [
      'ASM lines 2882-2886 copy six room-subrecord DC2 bytes before _LABEL_DC2_ begins decoding.',
      'ASM lines 2896-2899 compare each DC2 index with $FF and exit the decode loop on the first terminator.',
      'ASM lines 2899-2904 increment the _RAM_D019_ word only for decoded non-$FF streams.',
      'ASM lines 2915-2921 decode the selected stream into the current _RAM_CB00_ slot and advance the slot base by $10.',
      'ASM lines 3060-3096 and 3868-3894 show _RAM_CB00_ consumed by visual rendering and collision lookup with a $60 row stride.',
    ],
    assetPolicy: 'Metadata only: stream indexes, offsets, slot roles, buffer dimensions, RAM labels, and evidence. No ROM bytes, decoded cells, graphics, music, text, or rendered assets are embedded.',
  };
}

function updateRenderPipeline(recipe) {
  recipe.renderPipeline = recipe.renderPipeline || [];
  const existing = recipe.renderPipeline.find(step => step.kind === 'collision_buffer_model');
  const replacement = {
    order: 4,
    kind: 'collision_buffer_model',
    source: '_LABEL_DC2_ active DC2 prefix and _RAM_D019_/_RAM_D01A_ bound',
    dependency: 'dependencies.collisionBuffer',
  };
  if (existing) {
    Object.assign(existing, replacement);
    return;
  }
  for (const step of recipe.renderPipeline) {
    if (typeof step.order === 'number' && step.order >= 4) step.order += 1;
  }
  recipe.renderPipeline.push(replacement);
  recipe.renderPipeline.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

function recipeSummary(recipe, dependency) {
  return {
    id: recipe.id,
    sourceDescriptorId: recipe.sourceDescriptorId || null,
    descriptorOffset: recipe.descriptor?.romOffset || null,
    descriptorRegion: recipe.descriptor?.region || null,
    dc2Indices: (recipe.dependencies?.dc2Streams || []).map(stream => stream.index),
    activeDc2PrefixCount: dependency.activeDc2PrefixCount,
    terminatorSlot: dependency.terminatorSlot,
    finalBoundWord: dependency.finalBoundWord,
    finalHighByte: dependency.finalHighByte,
    acceptedCellColumns: dependency.acceptedCellColumns,
    decodedWrittenCells: dependency.decodedWrittenCells,
    confidence: dependency.confidence,
    warningCount: dependency.warnings.length,
  };
}

function histogramObject(histogram) {
  return Object.fromEntries([...histogram.entries()].sort((a, b) => a[0] - b[0]).map(([key, value]) => [String(key), value]));
}

function buildCatalog(mapData, recipes, dependencies, sourceRefs) {
  const activeHistogram = new Map();
  let decodedSlotCount = 0;
  let terminatorSlotCount = 0;
  let trailingUnprocessedSlotCount = 0;
  let unexpectedAfterTerminatorSlotCount = 0;
  let warningRecipeCount = 0;
  const uniqueDc2 = new Set();
  const summaries = recipes.map((recipe, index) => {
    const dependency = dependencies[index];
    activeHistogram.set(dependency.activeDc2PrefixCount, (activeHistogram.get(dependency.activeDc2PrefixCount) || 0) + 1);
    if (dependency.warnings.length) warningRecipeCount++;
    for (const stream of recipe.dependencies?.dc2Streams || []) {
      if (!isTerminator(stream) && stream.index) uniqueDc2.add(stream.index);
    }
    for (const slot of dependency.slotCoverage) {
      if (slot.role === 'decoded_stream') decodedSlotCount++;
      else if (slot.role === 'terminator_unprocessed') terminatorSlotCount++;
      else if (slot.role === 'trailing_unprocessed') trailingUnprocessedSlotCount++;
      else if (slot.role === 'unexpected_non_ff_after_terminator') unexpectedAfterTerminatorSlotCount++;
    }
    return recipeSummary(recipe, dependency);
  });
  const activeCounts = summaries.map(summary => summary.activeDc2PrefixCount);
  const minActiveCount = Math.min(...activeCounts);
  const maxActiveCount = Math.max(...activeCounts);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: sourceRefs,
    summary: {
      recipeCount: recipes.length,
      sixSlotRecipeCount: recipes.filter(recipe => (recipe.dependencies?.dc2Streams || []).length === 6).length,
      collisionReadyRecipeCount: summaries.filter(summary => summary.warningCount === 0).length,
      warningRecipeCount,
      uniqueDc2IndexCount: uniqueDc2.size,
      minActiveDc2PrefixCount: minActiveCount,
      maxActiveDc2PrefixCount: maxActiveCount,
      maxAcceptedCellColumns: maxActiveCount * 16,
      decodedSlotCount,
      terminatorSlotCount,
      trailingUnprocessedSlotCount,
      unexpectedAfterTerminatorSlotCount,
      activeDc2PrefixHistogram: histogramObject(activeHistogram),
      assetPolicy: 'Metadata only: recipe ids, DC2 indexes, offsets, slot roles, scalar dimensions, RAM labels, and ASM evidence. No ROM bytes, decoded room cells, graphics, music, text, or rendered assets are embedded.',
    },
    collisionWidthUsage: [...activeHistogram.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([activeDc2PrefixCount, descriptorCount]) => ({
        activeDc2PrefixCount,
        descriptorCount,
        finalBoundWord: boundForActiveCount(activeDc2PrefixCount).finalBoundWord,
        finalHighByte: boundForActiveCount(activeDc2PrefixCount).finalHighByte,
        acceptedCellColumns: activeDc2PrefixCount * 16,
      })),
    recipeCollisionSummaries: summaries,
    recipeSamples: summaries.slice(0, 20),
    evidence: [
      'Each zone recipe already names six room-subrecord DC2 stream index slots.',
      '_LABEL_DC2_ exits on the first $FF index, so active collision/render width is the non-$FF prefix length, not always six slots.',
      '_RAM_D019_/_RAM_D01A_ bounds are produced by the same loop that decodes active DC2 slots into _RAM_CB00_.',
      '_LABEL_EF3_ and _LABEL_141F_ consume _RAM_CB00_ with a $60 row stride, making the active slot count reusable for visual rendering and collision overlays.',
    ],
  };
}

function summaryHistogram(summaries, key) {
  const histogram = new Map();
  for (const summary of summaries) {
    const value = summary[key];
    histogram.set(value, (histogram.get(value) || 0) + 1);
  }
  return histogramObject(histogram);
}

function annotateDescriptorRegion(region, summaries) {
  if (!region) return null;
  const activeCounts = summaries.map(summary => summary.activeDc2PrefixCount);
  const acceptedColumns = summaries.map(summary => summary.acceptedCellColumns);
  const warningCount = summaries.reduce((count, summary) => count + summary.warningCount, 0);
  region.analysis = region.analysis || {};
  region.analysis.zoneCollisionRecipeAudit = {
    catalogId,
    kind: 'zone_collision_recipe_descriptor_source',
    confidence: warningCount ? 'medium' : 'high',
    descriptorCount: summaries.length,
    activeDc2PrefixHistogram: summaryHistogram(summaries, 'activeDc2PrefixCount'),
    acceptedCellColumnsRange: {
      min: Math.min(...acceptedColumns),
      max: Math.max(...acceptedColumns),
    },
    activeDc2PrefixCountRange: {
      min: Math.min(...activeCounts),
      max: Math.max(...activeCounts),
    },
    sampleDescriptors: summaries.slice(0, 12).map(summary => ({
      id: summary.id,
      descriptorOffset: summary.descriptorOffset,
      dc2Indices: summary.dc2Indices,
      activeDc2PrefixCount: summary.activeDc2PrefixCount,
      acceptedCellColumns: summary.acceptedCellColumns,
      finalHighByte: summary.finalHighByte,
    })),
    summary: 'Zone descriptors in this region have metadata-only collision-buffer dimensions derived from their DC2 index prefixes and _LABEL_DC2_ terminator semantics.',
    evidence: [
      'Zone recipes record six DC2 indexes from each room subrecord.',
      'ASM _LABEL_DC2_ exits on first $FF and increments _RAM_D019_ only for decoded streams.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
    descriptorCount: summaries.length,
    activeDc2PrefixHistogram: summaryHistogram(summaries, 'activeDc2PrefixCount'),
    acceptedCellColumnsRange: {
      min: Math.min(...acceptedColumns),
      max: Math.max(...acceptedColumns),
    },
  };
}

function annotateRam(entry, role, catalog) {
  if (!entry) return null;
  entry.analysis = entry.analysis || {};
  entry.analysis.zoneCollisionRecipeAudit = {
    catalogId,
    kind: role,
    confidence: 'high',
    activeDc2PrefixHistogram: catalog.summary.activeDc2PrefixHistogram,
    maxAcceptedCellColumns: catalog.summary.maxAcceptedCellColumns,
    summary: 'Zone collision recipe audit links this RAM role to per-room active DC2 stream width and collision-buffer bounds.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || 'byte',
    name: entry.name || '',
    role,
  };
}

function annotateRoutineRegion(mapData, catalog) {
  const region = findContainingRegion(mapData, 0x00DC2);
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.zoneCollisionRecipeAudit = {
    catalogId,
    kind: 'dc2_active_prefix_collision_width_producer',
    confidence: 'high',
    label: '_LABEL_DC2_',
    activeDc2PrefixHistogram: catalog.summary.activeDc2PrefixHistogram,
    summary: '_LABEL_DC2_ produces recipe-specific _RAM_CB00_ collision/render width by decoding stream indexes until the first $FF terminator.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function applyAnnotations(mapData, summaries, catalog) {
  const annotatedDescriptorRegions = [];
  const groupedByRegion = new Map();
  for (const summary of summaries) {
    const region = summary.descriptorRegion?.id
      ? (mapData.regions || []).find(item => item.id === summary.descriptorRegion.id)
      : summary.descriptorOffset
        ? findContainingRegion(mapData, parseInt(summary.descriptorOffset, 16))
        : null;
    if (!region) continue;
    const group = groupedByRegion.get(region.id) || { region, summaries: [] };
    group.summaries.push(summary);
    groupedByRegion.set(region.id, group);
  }
  for (const group of groupedByRegion.values()) {
    const annotated = annotateDescriptorRegion(group.region, group.summaries);
    if (annotated) annotatedDescriptorRegions.push(annotated);
  }

  const annotatedRam = [
    annotateRam(findRam(mapData, '$CB00'), 'dc2_collision_render_buffer_base', catalog),
    annotateRam(findRam(mapData, '$D019'), 'dc2_collision_scroll_bound_word_low', catalog),
    annotateRam(findRam(mapData, '$D01A'), 'dc2_collision_scroll_bound_high_byte', catalog),
  ].filter(Boolean);
  const annotatedRoutineRegion = annotateRoutineRegion(mapData, catalog);
  return { annotatedDescriptorRegions, annotatedRam, annotatedRoutineRegion };
}

function main() {
  const mapData = readJson(mapPath);
  const recipes = mapData.zoneRecipes || [];
  if (!recipes.length) {
    console.error('Missing mapData.zoneRecipes. Run tools/world-zone-recipe-audit.mjs --apply first.');
    process.exit(1);
  }

  const sourceRefs = sourceCatalogRefs(mapData);
  const dependencies = recipes.map(recipe => collisionDependency(recipe, sourceRefs));
  const catalog = buildCatalog(mapData, recipes, dependencies, sourceRefs);
  const summaries = catalog.recipeCollisionSummaries;
  let changes = { annotatedDescriptorRegions: [], annotatedRam: [], annotatedRoutineRegion: null };

  if (apply) {
    for (let i = 0; i < recipes.length; i++) {
      recipes[i].dependencies = recipes[i].dependencies || {};
      recipes[i].dependencies.collisionBuffer = dependencies[i];
      updateRenderPipeline(recipes[i]);
    }
    changes = applyAnnotations(mapData, summaries, catalog);
    mapData.collisionBufferCatalogs = (mapData.collisionBufferCatalogs || []).filter(item => item.id !== catalogId);
    mapData.collisionBufferCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_collision_recipe_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedDescriptorRegions: changes.annotatedDescriptorRegions.length,
        annotatedRam: changes.annotatedRam.length,
        annotatedRoutineRegion: changes.annotatedRoutineRegion ? 1 : 0,
      },
      sourceCatalogs: sourceRefs,
      collisionWidthUsage: catalog.collisionWidthUsage,
      recipeSamples: catalog.recipeSamples,
      annotatedDescriptorRegions: changes.annotatedDescriptorRegions,
      annotatedRam: changes.annotatedRam,
      annotatedRoutineRegion: changes.annotatedRoutineRegion,
      evidence: catalog.evidence,
      nextLeads: [
        'Use dependencies.collisionBuffer in the analyzer to render a read-only collision overlay from locally decoded _RAM_CB00_ cells.',
        'Fold collisionBuffer dependency generation into tools/world-zone-recipe-audit.mjs so regenerated recipes keep the bound model automatically.',
        'Cross-check active collision widths against room transitions and camera clamps in _LABEL_FA1_ to confirm edge behavior for one-, two-, and full-six-stream rooms.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedDescriptorRegions: changes.annotatedDescriptorRegions.length,
      annotatedRam: changes.annotatedRam.length,
      annotatedRoutineRegion: changes.annotatedRoutineRegion ? 1 : 0,
    },
    collisionWidthUsage: catalog.collisionWidthUsage,
    firstRecipes: catalog.recipeSamples.slice(0, 5),
  }, null, 2));
}

main();
