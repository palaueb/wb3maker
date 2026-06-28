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
const catalogId = 'world-entity-c3c0-motion-seed-target-link-catalog-2026-06-25';
const reportId = 'entity-c3c0-motion-seed-target-link-audit-2026-06-25';
const toolName = 'tools/world-entity-c3c0-motion-seed-target-link-audit.mjs';
const seedCatalogId = 'world-entity-c3c0-motion-seed-family-catalog-2026-06-25';
const behaviorCatalogId = 'world-entity-behavior-catalog-2026-06-24';
const initHeadCatalogId = 'world-bank0-entity-init-heads-catalog-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return typeof region?.offset === 'number' ? region.offset : parseInt(region?.offset || '0', 16);
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
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
  for (const [key, value] of Object.entries(mapData)) {
    if (!Array.isArray(value) || !/catalog/i.test(key)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function unique(items) {
  return [...new Set(items)].sort();
}

function sourceKey(source) {
  return source.expression || source.dataLabel || '';
}

function behaviorListConstants(entry) {
  return (entry?.constants || [])
    .map(item => /^behaviorList=([A-Za-z0-9_+\- ]+)$/i.exec(String(item || ''))?.[1]?.trim())
    .filter(Boolean);
}

function seedBehaviorListSources(seed, initHeadCatalog) {
  const sources = [];
  const seen = new Set();
  const addSource = source => {
    const key = sourceKey(source);
    if (!key || seen.has(key)) return;
    seen.add(key);
    sources.push(source);
  };
  for (const source of seed.behaviorListSources || []) {
    addSource({
      ...source,
      sourceProvenance: 'seed_family_catalog',
    });
  }
  for (const entry of initHeadCatalog?.entries || []) {
    if (entry.tailLabel !== seed.label) continue;
    for (const expression of behaviorListConstants(entry)) {
      addSource({
        status: 'caller_provided_init_head_behavior_list',
        expression,
        dataLabel: expression,
        sourceProvenance: 'bank0_init_head_catalog',
        callerLabel: entry.label || '',
        callerOffset: entry.offset || '',
        callerRole: entry.role || '',
        callerRegion: entry.region ? regionRef(entry.region) : null,
        callerEvidence: entry.evidence || [],
        confidence: 'high',
      });
    }
  }
  return sources;
}

function buildBehaviorTableIndex(behaviorCatalog) {
  const byLabel = new Map();
  for (const table of behaviorCatalog.behaviorTables || []) {
    byLabel.set(table.label, table);
    if (table.label.includes(' - ')) {
      byLabel.set(table.label.replace(/\s+/g, ' '), table);
    }
  }
  return byLabel;
}

function compactBehaviorEntry(entry) {
  return {
    index: entry.index,
    entryOffset: entry.entryOffset,
    romOffset: entry.romOffset,
    targetRegion: entry.targetRegion || null,
  };
}

function buildSourceLink(seed, source, behaviorTable) {
  const loadEvidence = source.callerLabel
    ? `${source.callerLabel} provides ${sourceKey(source)} before reaching shared C3C0 seed tail ${seed.label}.`
    : `${seed.label} loads ${sourceKey(source)} as a behavior-list source.`;
  if (!behaviorTable) {
    return {
      sourceExpression: sourceKey(source),
      dataLabel: source.dataLabel,
      sourceProvenance: source.sourceProvenance || '',
      callerLabel: source.callerLabel || '',
      callerOffset: source.callerOffset || '',
      callerRole: source.callerRole || '',
      callerRegion: source.callerRegion || null,
      status: 'missing_behavior_table_catalog_entry',
      behaviorTable: null,
      entries: [],
      targetEntryCount: 0,
      uniqueTargetRegionCount: 0,
      evidence: [
        loadEvidence,
        `No ${behaviorCatalogId} behavior table matched ${sourceKey(source)}.`,
      ],
    };
  }
  const entries = (behaviorTable.entries || []).map(compactBehaviorEntry);
  return {
    sourceExpression: sourceKey(source),
    dataLabel: source.dataLabel,
    sourceProvenance: source.sourceProvenance || '',
    callerLabel: source.callerLabel || '',
    callerOffset: source.callerOffset || '',
    callerRole: source.callerRole || '',
    callerRegion: source.callerRegion || null,
    status: 'linked_behavior_table_targets',
    behaviorTable: {
      id: behaviorTable.id,
      label: behaviorTable.label,
      offset: behaviorTable.offset,
      role: behaviorTable.role,
      setupRoutine: behaviorTable.setupRoutine,
      entryCount: behaviorTable.entryCount,
      region: behaviorTable.region || null,
      regionSizeMatches: Boolean(behaviorTable.regionSizeMatches),
      warnings: behaviorTable.warnings || [],
    },
    entries,
    targetEntryCount: entries.length,
    uniqueTargetRegionCount: unique(entries.map(entry => entry.targetRegion?.id || '').filter(Boolean)).length,
    evidence: [
      loadEvidence,
      `${behaviorCatalogId} decodes ${behaviorTable.label} as ${behaviorTable.entryCount} behavior target entr${behaviorTable.entryCount === 1 ? 'y' : 'ies'}.`,
      ...(source.callerEvidence || []).slice(0, 1),
    ],
  };
}

function buildSeedTargetLink(seed, behaviorIndex, initHeadCatalog) {
  const behaviorSources = seedBehaviorListSources(seed, initHeadCatalog);
  const sourceLinks = behaviorSources.map(source => {
    const table = behaviorIndex.get(sourceKey(source)) || behaviorIndex.get(source.dataLabel || '');
    return buildSourceLink(seed, source, table);
  });
  const entries = sourceLinks.flatMap(link => link.entries);
  return {
    seedLabel: seed.label,
    seedOffset: seed.offset,
    seedRegion: seed.region,
    tableEntryIndexesZeroBased: seed.tableEntryIndexesZeroBased,
    motionFields: seed.motionFields,
    behaviorListStatus: seed.behaviorListStatus,
    behaviorListSourceCount: behaviorSources.length,
    seedCatalogBehaviorListSourceCount: seed.behaviorListSources?.length || 0,
    callerProvidedBehaviorListSourceCount: behaviorSources.filter(source => source.sourceProvenance === 'bank0_init_head_catalog').length,
    linkedBehaviorListSourceCount: sourceLinks.filter(link => link.status === 'linked_behavior_table_targets').length,
    missingBehaviorListSourceCount: sourceLinks.filter(link => link.status !== 'linked_behavior_table_targets').length,
    targetEntryCount: entries.length,
    uniqueTargetRegionCount: unique(entries.map(entry => entry.targetRegion?.id || '').filter(Boolean)).length,
    targetRegionIds: unique(entries.map(entry => entry.targetRegion?.id || '').filter(Boolean)),
    sourceLinks,
    persistedRomByteCount: 0,
    persistedGameplayValueCount: 0,
    evidence: [
      `${seed.label} has ${seed.behaviorListSources?.length || 0} behavior-list source expression(s) from ${seedCatalogId}.`,
      `${initHeadCatalogId} contributes ${behaviorSources.filter(source => source.sourceProvenance === 'bank0_init_head_catalog').length} caller-provided behavior-list source expression(s) that enter this seed tail.`,
      ...sourceLinks.flatMap(link => link.evidence).slice(0, 6),
    ],
  };
}

function buildCatalog(mapData) {
  const seedCatalog = requireCatalog(mapData, seedCatalogId);
  const behaviorCatalog = requireCatalog(mapData, behaviorCatalogId);
  const initHeadCatalog = requireCatalog(mapData, initHeadCatalogId);
  const behaviorIndex = buildBehaviorTableIndex(behaviorCatalog);
  const seedTargetLinks = (seedCatalog.seeds || []).map(seed => buildSeedTargetLink(seed, behaviorIndex, initHeadCatalog));
  const sourceLinks = seedTargetLinks.flatMap(link => link.sourceLinks);
  const linkedSources = sourceLinks.filter(link => link.status === 'linked_behavior_table_targets');
  const missingSources = sourceLinks.filter(link => link.status !== 'linked_behavior_table_targets');
  const allEntries = linkedSources.flatMap(link => link.entries);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [seedCatalogId, behaviorCatalogId, initHeadCatalogId],
    summary: {
      seedRoutineCount: seedTargetLinks.length,
      behaviorListSourceCount: sourceLinks.length,
      seedCatalogBehaviorListSourceCount: seedTargetLinks.reduce((sum, link) => sum + link.seedCatalogBehaviorListSourceCount, 0),
      callerProvidedBehaviorListSourceCount: seedTargetLinks.reduce((sum, link) => sum + link.callerProvidedBehaviorListSourceCount, 0),
      linkedBehaviorListSourceCount: linkedSources.length,
      missingBehaviorListSourceCount: missingSources.length,
      targetEntryCount: allEntries.length,
      uniqueTargetRegionCount: unique(allEntries.map(entry => entry.targetRegion?.id || '').filter(Boolean)).length,
      seedRoutinesWithMultipleBehaviorLists: seedTargetLinks.filter(link => link.behaviorListSourceCount > 1).length,
      seedRoutinesWithMissingBehaviorLists: seedTargetLinks.filter(link => link.missingBehaviorListSourceCount > 0).length,
      seedRoutinesWithTargetLinks: seedTargetLinks.filter(link => link.targetEntryCount > 0).length,
      maxTargetEntriesPerSeed: Math.max(0, ...seedTargetLinks.map(link => link.targetEntryCount)),
      totalTableEntryReferences: seedTargetLinks.reduce((sum, link) => sum + link.targetEntryCount, 0),
      targetRegionTypeCounts: countBy(allEntries, entry => entry.targetRegion?.type || 'missing_region'),
      statusCounts: countBy(sourceLinks, link => link.status),
      persistedRomByteCount: 0,
      persistedGameplayValueCount: 0,
      assetPolicy: 'Metadata only: C3C0 motion seed labels, behavior-list labels, decoded target offsets, target region refs, and counts. No behavior-list bytes, ROM bytes, graphics, or gameplay tables are embedded.',
    },
    seedTargetLinks,
    missingBehaviorListSources: missingSources.map(link => ({
      sourceExpression: link.sourceExpression,
      dataLabel: link.dataLabel,
      status: link.status,
    })),
    evidence: [
      `${seedCatalogId} identifies motion-seed initializer routines and behavior-list source labels.`,
      `${behaviorCatalogId} decodes behavior-table entries into target offsets and target regions without persisting ROM bytes.`,
      `${initHeadCatalogId} supplies caller-provided behavior-list constants for shared seed-tail initializers.`,
      'This catalog joins those two metadata layers so update-state tracing can proceed from initializer seed to behavior target routine.',
    ],
    nextLeads: [
      'Trace the first target entry for each linked behavior list to determine how IX+30/IX+31 seeds are consumed after initialization.',
      'Group shared target regions by state index to identify common movement AI fragments.',
      'Link target regions to animation frame families and collision/contact helper calls for actor naming.',
    ],
  };
}

function annotateRegion(region, link) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.c3c0MotionSeedTargetLinkAudit = {
    catalogId,
    kind: 'c3c0_motion_seed_behavior_target_link',
    seedLabel: link.seedLabel,
    confidence: link.missingBehaviorListSourceCount ? 'medium' : 'high',
    behaviorListSourceCount: link.behaviorListSourceCount,
    linkedBehaviorListSourceCount: link.linkedBehaviorListSourceCount,
    targetEntryCount: link.targetEntryCount,
    uniqueTargetRegionCount: link.uniqueTargetRegionCount,
    targetRegionIds: link.targetRegionIds,
    persistedGameplayValueCount: 0,
    summary: `${link.seedLabel} links ${link.linkedBehaviorListSourceCount}/${link.behaviorListSourceCount} behavior-list source(s) to ${link.targetEntryCount} decoded behavior target entr${link.targetEntryCount === 1 ? 'y' : 'ies'}.`,
    evidence: link.evidence.slice(0, 6),
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    seedLabel: link.seedLabel,
    targetEntryCount: link.targetEntryCount,
    uniqueTargetRegionCount: link.uniqueTargetRegionCount,
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityBehaviorCatalogs.push(catalog);
  const annotatedRegions = [];
  for (const link of catalog.seedTargetLinks) {
    const offset = labelOffset(link.seedLabel);
    const region = offset == null ? null : findContainingRegion(mapData, offset);
    const annotated = annotateRegion(region, link);
    if (annotated) annotatedRegions.push(annotated);
  }
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_c3c0_motion_seed_target_link_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotatedRegions.length,
    },
    annotatedRegions,
    missingBehaviorListSources: catalog.missingBehaviorListSources,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (apply) {
    applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    id: catalog.id,
    summary: catalog.summary,
    missingBehaviorListSources: catalog.missingBehaviorListSources,
  }, null, 2));
}

main();
