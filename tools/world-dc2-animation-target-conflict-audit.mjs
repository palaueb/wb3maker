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
const toolName = 'tools/world-dc2-animation-target-conflict-audit.mjs';
const catalogId = 'world-dc2-animation-target-conflict-catalog-2026-06-26';
const reportId = 'dc2-animation-target-conflict-audit-2026-06-26';

const frameCatalogId = 'world-animation-frame-stream-catalog-2026-06-25';
const targetResolutionCatalogId = 'world-animation-frame-target-resolution-catalog-2026-06-26';
const dc2LookupCatalogId = 'world-dc2-tile-pair-lookup-catalog-2026-06-25';

const lookupOffset = 0x18000;
const lookupRecordStride = 8;
const lookupRecordCount = 227;
const lookupEndExclusive = lookupOffset + lookupRecordStride * lookupRecordCount;

const recordByteRoles = [
  'even_column_top_word_low',
  'even_column_top_word_high',
  'even_column_bottom_word_low',
  'even_column_bottom_word_high',
  'odd_column_top_word_low',
  'odd_column_top_word_high',
  'odd_column_bottom_word_low',
  'odd_column_bottom_word_high',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function hex(value, pad = 5) {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(pad, '0')}`;
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
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function bump(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function countObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => value != null))].sort();
}

function lookupPosition(offset) {
  const relative = offset - lookupOffset;
  const recordIndex = Math.floor(relative / lookupRecordStride);
  const byteInRecord = relative % lookupRecordStride;
  return {
    recordIndex,
    recordIndexHex: hex(recordIndex, 2),
    byteInRecord,
    byteRole: recordByteRoles[byteInRecord] || 'unknown',
    wordRole: byteInRecord < 2
      ? 'even_column_top_name_table_word'
      : byteInRecord < 4
        ? 'even_column_bottom_name_table_word'
        : byteInRecord < 6
          ? 'odd_column_top_name_table_word'
          : 'odd_column_bottom_name_table_word',
  };
}

function frameStatus(frame, targetResolution) {
  const offset = frame.offset;
  if ((targetResolution.unresolvedTargetOffsets || []).includes(offset)) return 'unresolved_animation_target_inside_dc2_lookup';
  if ((targetResolution.quarantinedTargetOffsets || []).includes(offset)) return 'quarantined_animation_target_inside_dc2_lookup';
  if (frame.confidence === 'high' && frame.termination?.normal) return 'confirmed_frame_parser_target_inside_dc2_lookup';
  if (frame.confidence === 'medium') return 'medium_frame_parser_target_inside_dc2_lookup';
  if (frame.confidence === 'low') return 'low_frame_parser_target_inside_dc2_lookup';
  return 'unclassified_animation_target_inside_dc2_lookup';
}

function buildCatalog(mapData) {
  const frameCatalog = requireCatalog(mapData, frameCatalogId);
  const targetResolutionCatalog = requireCatalog(mapData, targetResolutionCatalogId);
  const dc2LookupCatalog = findCatalog(mapData, dc2LookupCatalogId);
  const statusCounts = new Map();
  const byteRoleCounts = new Map();
  const regionCounts = new Map();
  const sourceStreamCounts = new Map();

  const entries = (frameCatalog.frameStreams || [])
    .map(frame => ({ frame, offset: parseHex(frame.offset) }))
    .filter(item => item.offset >= lookupOffset && item.offset < lookupEndExclusive)
    .sort((a, b) => a.offset - b.offset)
    .map(({ frame, offset }) => {
      const position = lookupPosition(offset);
      const status = frameStatus(frame, targetResolutionCatalog);
      const sourceCommandStreams = uniqueSorted((frame.references || []).map(ref => ref.sourceCommandStream));
      const sourceFamilies = uniqueSorted((frame.references || []).flatMap(ref =>
        (ref.sourceFamilies || []).map(family =>
          family.familyId || `${family.entityType ?? 'unknown'}:${family.dispatchLabel || 'unknown'}`
        )
      ));
      const regionId = frame.region?.id || 'unmapped';
      bump(statusCounts, status);
      bump(byteRoleCounts, position.byteRole);
      bump(regionCounts, regionId);
      for (const stream of sourceCommandStreams) bump(sourceStreamCounts, stream);

      return {
        frameOffset: frame.offset,
        status,
        frameConfidence: frame.confidence,
        terminationKind: frame.termination?.kind || null,
        referenceCount: Number(frame.referenceCount || 0),
        sourceCommandStreamCount: sourceCommandStreams.length,
        sourceCommandStreams: sourceCommandStreams.slice(0, 24),
        sourceFamilies: sourceFamilies.slice(0, 24),
        region: frame.region || null,
        lookupPosition: position,
        evidence: [
          'Frame target offset lies inside the confirmed _DATA_18000_ DC2 tile-pair lookup range.',
          `${dc2LookupCatalogId} models this range as 227 8-byte records consumed by _LABEL_EF3_.`,
          `${frameCatalogId} models this same offset as an animation frame-stream target candidate.`,
          'Metadata only; no ROM bytes or decoded name-table words are embedded.',
        ],
      };
    });

  return {
    id: catalogId,
    generatedAt: now,
    tool: toolName,
    schemaVersion: 1,
    type: 'dc2_animation_target_conflict_catalog',
    sourceCatalogs: [
      frameCatalogId,
      targetResolutionCatalogId,
      ...(dc2LookupCatalog ? [dc2LookupCatalogId] : []),
    ],
    lookup: {
      label: '_DATA_18000_',
      offset: hex(lookupOffset),
      endExclusive: hex(lookupEndExclusive),
      recordStride: lookupRecordStride,
      recordCount: lookupRecordCount,
      consumerRoutine: '_LABEL_EF3_',
      dc2CatalogPresent: Boolean(dc2LookupCatalog),
    },
    summary: {
      animationTargetInsideDc2LookupCount: entries.length,
      uniqueSourceCommandStreamCount: sourceStreamCounts.size,
      statusCounts: countObject(statusCounts),
      byteRoleCounts: countObject(byteRoleCounts),
      targetRegionCounts: countObject(regionCounts),
      persistedRomByteCount: 0,
      persistedTileByteCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: frame offsets, DC2 lookup record indexes, byte roles, region ids, source stream ids, and confidence classes. No ROM bytes, decoded graphics, name-table words, pixels, screenshots, coordinates, music, text, or gameplay payloads are embedded.',
    },
    entries,
    evidence: [
      `${dc2LookupCatalogId} identifies _DATA_18000_ as the 227-entry tile-pair lookup consumed by _LABEL_EF3_.`,
      `${frameCatalogId} still has animation frame targets that fall inside the same lookup range.`,
      `${targetResolutionCatalogId} separates confirmed parser targets from quarantined and unresolved targets.`,
      'This catalog intentionally records the overlap as a conflict/dual-use lead, not as proof that either consumer is false.',
    ],
    nextLeads: [
      'Trace the source command streams that target byte positions inside _DATA_18000_ to decide whether those pointers are legitimate dual-use or parser over-collection.',
      'Keep _DATA_18000_ visible as a DC2 lookup dependency in render tools even when animation metadata points into it.',
      'Before splitting _DATA_18000_, require runtime evidence that the animation consumer really reads those offsets as _LABEL_792_ frame streams.',
    ],
  };
}

function annotateRegions(mapData, catalog) {
  for (const region of mapData.regions || []) {
    if (region.analysis?.dc2AnimationTargetConflictAudit?.catalogId === catalogId) {
      delete region.analysis.dc2AnimationTargetConflictAudit;
    }
  }

  const refsByRegion = new Map();
  for (const entry of catalog.entries || []) {
    const regionId = entry.region?.id;
    if (!regionId) continue;
    if (!refsByRegion.has(regionId)) refsByRegion.set(regionId, []);
    refsByRegion.get(regionId).push(entry);
  }

  let annotatedRegionCount = 0;
  for (const [regionId, entries] of refsByRegion.entries()) {
    const region = findRegionById(mapData, regionId);
    if (!region) continue;
    const statusCounts = new Map();
    const byteRoleCounts = new Map();
    for (const entry of entries) {
      bump(statusCounts, entry.status);
      bump(byteRoleCounts, entry.lookupPosition.byteRole);
    }
    region.analysis = region.analysis || {};
    region.analysis.dc2AnimationTargetConflictAudit = {
      catalogId,
      kind: 'animation_frame_targets_inside_dc2_lookup_region',
      confidence: 'medium',
      frameTargetCount: entries.length,
      frameOffsets: entries.map(entry => entry.frameOffset).sort(),
      statusCounts: countObject(statusCounts),
      byteRoleCounts: countObject(byteRoleCounts),
      lookupOffset: catalog.lookup.offset,
      lookupEndExclusive: catalog.lookup.endExclusive,
      summary: 'Animation frame targets land inside the confirmed _DATA_18000_ DC2 tile-pair lookup range; this region remains a dual-use/conflict lead.',
      evidence: [
        `${catalogId} cross-references frame target offsets with the _DATA_18000_ DC2 lookup record model.`,
        'Metadata-only audit; no ROM bytes or decoded graphics/name-table words are embedded.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegionCount++;
  }
  return { annotatedRegionCount };
}

function applyCatalog(mapData, catalog) {
  const annotation = annotateRegions(mapData, catalog);
  mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
  mapData.roomDataCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'dc2_animation_target_conflict_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotation.annotatedRegionCount,
    },
    lookup: catalog.lookup,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
  return annotation;
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = apply ? applyCatalog(mapData, catalog) : { annotatedRegionCount: 0 };
  if (apply) fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotation.annotatedRegionCount,
    },
    entries: catalog.entries.map(entry => ({
      frameOffset: entry.frameOffset,
      status: entry.status,
      frameConfidence: entry.frameConfidence,
      terminationKind: entry.terminationKind,
      referenceCount: entry.referenceCount,
      region: entry.region,
      lookupPosition: entry.lookupPosition,
      sourceCommandStreamCount: entry.sourceCommandStreamCount,
    })),
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
