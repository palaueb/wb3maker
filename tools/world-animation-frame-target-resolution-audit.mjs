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
const toolName = 'tools/world-animation-frame-target-resolution-audit.mjs';
const catalogId = 'world-animation-frame-target-resolution-catalog-2026-06-26';
const reportId = 'animation-frame-target-resolution-audit-2026-06-26';

const sourceCatalogIds = {
  command: 'world-animation-command-stream-catalog-2026-06-25',
  frame: 'world-animation-frame-stream-catalog-2026-06-25',
  triage: 'world-animation-frame-issue-triage-catalog-2026-06-26',
};

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

function normOffset(value) {
  const parsed = parseHex(value);
  return parsed == null ? null : hex(parsed);
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

function topCounts(map, limit = 16) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
    .slice(0, limit);
}

function frameIndex(frameCatalog) {
  const byOffset = new Map();
  for (const frame of frameCatalog.frameStreams || []) {
    const offset = normOffset(frame.offset);
    if (offset) byOffset.set(offset, frame);
  }
  return byOffset;
}

function triageIndex(triageCatalog) {
  const byOffset = new Map();
  for (const entry of triageCatalog?.entries || []) {
    const offset = normOffset(entry.frameOffset);
    if (offset) byOffset.set(offset, entry);
  }
  return byOffset;
}

function frameClassification(frame, triage) {
  if (!frame) return 'missing_frame_stream_catalog_entry';
  if (frame.quarantine?.kind === 'blank_metasprite_target') return 'quarantined_blank_metasprite_target';
  if (frame.quarantine?.kind === 'non_metasprite_frame_target_region') return 'quarantined_non_metasprite_frame_target_region';
  if (frame.confidence === 'high' && frame.termination?.normal) return 'confirmed_frame_stream';
  if (frame.confidence === 'medium') return 'medium_confidence_frame_stream';
  if (frame.confidence === 'low') {
    if (triage?.classification) return `unresolved_${triage.classification}`;
    return 'unresolved_low_confidence_frame_stream';
  }
  return `unclassified_frame_stream_${frame.confidence || 'unknown'}`;
}

function classificationSeverity(classification) {
  if (classification === 'confirmed_frame_stream') return 'confirmed';
  if (classification.startsWith('quarantined_')) return 'quarantined';
  if (classification.startsWith('unresolved_')) return 'unresolved';
  if (classification === 'medium_confidence_frame_stream') return 'needs_review';
  return 'needs_review';
}

function sourceFamilyIds(stream) {
  return uniqueSorted((stream.sourceFamilies || []).map(family =>
    family.familyId || `${family.entityType ?? 'unknown'}:${family.dispatchLabel || 'unknown'}`
  ));
}

function buildResolution(commandCatalog, frameCatalog, triageCatalog) {
  const frames = frameIndex(frameCatalog);
  const triage = triageIndex(triageCatalog);
  const classifications = new Map();
  const severities = new Map();
  const targetRegions = new Map();
  const sourceStreamConfidence = new Map();
  const unresolvedOffsets = new Set();
  const quarantinedOffsets = new Set();
  const missingOffsets = new Set();
  const targetRecords = [];
  const interestingStreams = [];

  for (const stream of commandCatalog.streams || []) {
    const streamCounts = new Map();
    const streamTargetRegions = new Map();
    const nonConfirmedOffsets = new Set();
    const targetSummaries = [];

    for (const target of stream.frameTargets || []) {
      const targetOffset = normOffset(target.romOffset);
      const frame = frames.get(targetOffset);
      const triageEntry = triage.get(targetOffset);
      const classification = frameClassification(frame, triageEntry);
      const severity = classificationSeverity(classification);
      const regionId = target.region?.id || frame?.region?.id || triageEntry?.region?.id || 'unmapped';

      bump(classifications, classification);
      bump(severities, severity);
      bump(streamCounts, classification);
      bump(targetRegions, regionId);
      bump(streamTargetRegions, regionId);
      bump(sourceStreamConfidence, `${stream.confidence || 'unknown'}:${classification}`);

      if (severity !== 'confirmed') nonConfirmedOffsets.add(targetOffset);
      if (severity === 'unresolved') unresolvedOffsets.add(targetOffset);
      if (severity === 'quarantined') quarantinedOffsets.add(targetOffset);
      if (classification === 'missing_frame_stream_catalog_entry') missingOffsets.add(targetOffset);

      targetSummaries.push({
        targetOffset,
        sourceCommandOffset: target.sourceCommandOffset,
        pointerOffset: target.pointerOffset,
        targetRegionId: regionId,
        classification,
        frameConfidence: frame?.confidence || null,
        frameTerminationKind: frame?.termination?.kind || null,
        triageClassification: triageEntry?.classification || null,
      });

      targetRecords.push({
        sourceStreamOffset: stream.offset,
        sourceStreamRegionId: stream.region?.id || null,
        sourceStreamConfidence: stream.confidence || 'unknown',
        targetOffset,
        sourceCommandOffset: target.sourceCommandOffset,
        pointerOffset: target.pointerOffset,
        targetRegionId: regionId,
        classification,
        severity,
        frameConfidence: frame?.confidence || null,
        frameTerminationKind: frame?.termination?.kind || null,
        triageClassification: triageEntry?.classification || null,
      });
    }

    if (nonConfirmedOffsets.size) {
      interestingStreams.push({
        streamOffset: stream.offset,
        streamRegion: stream.region || null,
        confidence: stream.confidence || 'unknown',
        termination: stream.termination,
        commandCount: stream.commandCount,
        frameTargetCount: stream.frameTargetCount,
        issueCount: stream.issueCount,
        issueCounts: stream.issueCounts || {},
        sourceFamilyCount: stream.sourceFamilyCount || 0,
        sourceFamilies: sourceFamilyIds(stream).slice(0, 16),
        classificationCounts: countObject(streamCounts),
        targetRegionCounts: countObject(streamTargetRegions),
        nonConfirmedTargetOffsets: [...nonConfirmedOffsets].sort().slice(0, 24),
        nonConfirmedTargets: targetSummaries
          .filter(target => classificationSeverity(target.classification) !== 'confirmed')
          .slice(0, 32),
      });
    }
  }

  return {
    targetRecords,
    interestingStreams,
    aggregate: {
      classificationCounts: countObject(classifications),
      severityCounts: countObject(severities),
      topTargetRegions: topCounts(targetRegions),
      sourceStreamConfidenceClassificationCounts: countObject(sourceStreamConfidence),
      unresolvedTargetOffsets: [...unresolvedOffsets].sort(),
      quarantinedTargetOffsets: [...quarantinedOffsets].sort(),
      missingTargetOffsets: [...missingOffsets].sort(),
    },
  };
}

function buildCatalog(mapData) {
  const commandCatalog = requireCatalog(mapData, sourceCatalogIds.command);
  const frameCatalog = requireCatalog(mapData, sourceCatalogIds.frame);
  const triageCatalog = findCatalog(mapData, sourceCatalogIds.triage);
  const resolution = buildResolution(commandCatalog, frameCatalog, triageCatalog);
  const totalFrameTargetReferences = resolution.targetRecords.length;

  return {
    id: catalogId,
    generatedAt: now,
    tool: toolName,
    schemaVersion: 1,
    type: 'animation_frame_target_resolution_catalog',
    sourceCatalogs: [
      sourceCatalogIds.command,
      sourceCatalogIds.frame,
      ...(triageCatalog ? [sourceCatalogIds.triage] : []),
    ],
    summary: {
      totalFrameTargetReferences,
      interestingSourceStreamCount: resolution.interestingStreams.length,
      unresolvedUniqueTargetOffsetCount: resolution.aggregate.unresolvedTargetOffsets.length,
      quarantinedUniqueTargetOffsetCount: resolution.aggregate.quarantinedTargetOffsets.length,
      missingUniqueTargetOffsetCount: resolution.aggregate.missingTargetOffsets.length,
      classificationCounts: resolution.aggregate.classificationCounts,
      severityCounts: resolution.aggregate.severityCounts,
      topTargetRegions: resolution.aggregate.topTargetRegions,
      persistedRomByteCount: 0,
      persistedTileByteCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: source stream offsets, frame target offsets, region ids, confidence classes, and aggregate counts. No ROM bytes, decoded sprites, graphics, pixels, screenshots, coordinates, music, text, or gameplay payloads are embedded.',
    },
    unresolvedTargetOffsets: resolution.aggregate.unresolvedTargetOffsets,
    quarantinedTargetOffsets: resolution.aggregate.quarantinedTargetOffsets,
    missingTargetOffsets: resolution.aggregate.missingTargetOffsets,
    interestingStreams: resolution.interestingStreams,
    evidence: [
      `${sourceCatalogIds.command} provides normalized _LABEL_1347_ command streams and frame target offsets.`,
      `${sourceCatalogIds.frame} provides _LABEL_792_ frame stream confidence, termination, and quarantine status.`,
      triageCatalog
        ? `${sourceCatalogIds.triage} classifies the remaining low-confidence frame targets by region role and parser outcome.`
        : 'No low-confidence frame triage catalog was present; unresolved lows are kept generic.',
      'This audit stores metadata only and does not persist ROM bytes or decoded graphics.',
    ],
    nextLeads: [
      'Resolve the unresolved _DATA_18000_ targets by tracing whether the medium-confidence source command streams over-collect pointers into the DC2 tile-pair lookup.',
      'Resolve the unresolved _DATA_1B486_ target by tracing source stream 0x1928C and the nearby player/C34E metasprite/A48 stream boundary.',
      'Use target resolution classes in browser sprite previews so quarantined and unresolved frame targets are visible diagnostics instead of attempted renders.',
    ],
  };
}

function regionBucket(regionBuckets, regionId) {
  const id = regionId || 'unmapped';
  if (!regionBuckets.has(id)) {
    regionBuckets.set(id, {
      sourceStreamOffsets: new Set(),
      targetOffsets: new Set(),
      classificationCounts: new Map(),
      severityCounts: new Map(),
      roles: new Set(),
    });
  }
  return regionBuckets.get(id);
}

function buildRegionBuckets(catalog) {
  const buckets = new Map();

  for (const stream of catalog.interestingStreams || []) {
    const sourceRegionId = stream.streamRegion?.id;
    if (sourceRegionId) {
      const bucket = regionBucket(buckets, sourceRegionId);
      bucket.roles.add('source_command_stream_region');
      bucket.sourceStreamOffsets.add(stream.streamOffset);
      for (const [classification, count] of Object.entries(stream.classificationCounts || {})) {
        bump(bucket.classificationCounts, classification, count);
        bump(bucket.severityCounts, classificationSeverity(classification), count);
      }
      for (const offset of stream.nonConfirmedTargetOffsets || []) bucket.targetOffsets.add(offset);
    }

    for (const target of stream.nonConfirmedTargets || []) {
      const targetRegionId = target.targetRegionId;
      if (!targetRegionId || targetRegionId === 'unmapped') continue;
      const bucket = regionBucket(buckets, targetRegionId);
      bucket.roles.add('target_frame_region');
      bucket.targetOffsets.add(target.targetOffset);
      bump(bucket.classificationCounts, target.classification);
      bump(bucket.severityCounts, classificationSeverity(target.classification));
    }
  }

  return buckets;
}

function annotateRegions(mapData, catalog) {
  for (const region of mapData.regions || []) {
    if (region.analysis?.animationFrameTargetResolutionAudit?.catalogId === catalogId) {
      delete region.analysis.animationFrameTargetResolutionAudit;
    }
  }

  const buckets = buildRegionBuckets(catalog);
  let annotatedRegionCount = 0;

  for (const [regionId, bucket] of buckets.entries()) {
    const region = findRegionById(mapData, regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.animationFrameTargetResolutionAudit = {
      catalogId,
      kind: 'animation_frame_target_resolution_region',
      confidence: 'medium',
      roles: [...bucket.roles].sort(),
      sourceStreamCount: bucket.sourceStreamOffsets.size,
      sourceStreamOffsets: [...bucket.sourceStreamOffsets].sort().slice(0, 24),
      nonConfirmedTargetOffsetCount: bucket.targetOffsets.size,
      nonConfirmedTargetOffsets: [...bucket.targetOffsets].sort().slice(0, 24),
      classificationCounts: countObject(bucket.classificationCounts),
      severityCounts: countObject(bucket.severityCounts),
      summary: 'Animation command frame-target references in this region include non-confirmed, quarantined, or unresolved targets that should remain visible in tooling.',
      evidence: [
        `${catalogId} cross-references command frame targets with frame stream confidence and triage metadata.`,
        'Metadata-only audit; no ROM bytes or decoded graphics are embedded.',
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
  mapData.animationCommandStreamCatalogs = (mapData.animationCommandStreamCatalogs || []).filter(item => item.id !== catalogId);
  mapData.animationCommandStreamCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'animation_frame_target_resolution_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotation.annotatedRegionCount,
    },
    unresolvedTargetOffsets: catalog.unresolvedTargetOffsets,
    quarantinedTargetOffsets: catalog.quarantinedTargetOffsets,
    missingTargetOffsets: catalog.missingTargetOffsets,
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
    unresolvedTargetOffsets: catalog.unresolvedTargetOffsets,
    quarantinedTargetOffsets: catalog.quarantinedTargetOffsets,
    missingTargetOffsets: catalog.missingTargetOffsets,
    interestingStreams: catalog.interestingStreams.map(stream => ({
      streamOffset: stream.streamOffset,
      streamRegion: stream.streamRegion,
      confidence: stream.confidence,
      classificationCounts: stream.classificationCounts,
      nonConfirmedTargetOffsets: stream.nonConfirmedTargetOffsets,
      targetRegionCounts: stream.targetRegionCounts,
    })),
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
