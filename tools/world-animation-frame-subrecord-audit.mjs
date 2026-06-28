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
const catalogId = 'world-animation-frame-subrecord-catalog-2026-06-25';
const reportId = 'animation-frame-subrecord-audit-2026-06-25';
const toolName = 'tools/world-animation-frame-subrecord-audit.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function normOffset(value) {
  if (value == null) return null;
  if (typeof value === 'number') return hex(value);
  return '0x' + String(value).replace(/^0x/i, '').toUpperCase().padStart(5, '0');
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function requireCatalog(mapData, key, id) {
  const catalog = (mapData[key] || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required catalog ${key}.${id}`);
  return catalog;
}

function rangeLength(start, endInclusive) {
  return endInclusive >= start ? endInclusive - start + 1 : 0;
}

function unionBytes(ranges) {
  if (!ranges.length) return 0;
  const sorted = ranges.map(range => ({ ...range })).sort((a, b) => a.start - b.start || a.endInclusive - b.endInclusive);
  let total = 0;
  let currentStart = sorted[0].start;
  let currentEnd = sorted[0].endInclusive;
  for (let i = 1; i < sorted.length; i++) {
    const range = sorted[i];
    if (range.start <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, range.endInclusive);
    } else {
      total += rangeLength(currentStart, currentEnd);
      currentStart = range.start;
      currentEnd = range.endInclusive;
    }
  }
  total += rangeLength(currentStart, currentEnd);
  return total;
}

function relationToPrevious(previous, current) {
  if (!previous) return 'first';
  if (current.start > previous.endInclusive + 1) return 'disjoint_gap';
  if (current.start === previous.endInclusive + 1) return 'adjacent';
  if (current.endInclusive <= previous.endInclusive) return 'nested_or_alias';
  return 'overlap_extends';
}

function classifyRegionSubrecords(region, subrecords) {
  const sorted = subrecords.slice().sort((a, b) => a.start - b.start || a.endInclusive - b.endInclusive);
  const annotated = [];
  let overlapCount = 0;
  let nestedCount = 0;
  let adjacentCount = 0;
  let gapCount = 0;
  let previous = null;
  for (const item of sorted) {
    const relation = relationToPrevious(previous, item);
    if (relation === 'nested_or_alias') {
      overlapCount++;
      nestedCount++;
    } else if (relation === 'overlap_extends') {
      overlapCount++;
    } else if (relation === 'adjacent') {
      adjacentCount++;
    } else if (relation === 'disjoint_gap') {
      gapCount++;
    }
    annotated.push({ ...item, relationToPrevious: relation });
    if (!previous || item.endInclusive > previous.endInclusive) previous = item;
  }

  const regionStart = offsetOf(region);
  const regionEnd = regionStart + (region.size || 0) - 1;
  const coveredBytes = unionBytes(sorted);
  return {
    region: {
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
    },
    regionEndInclusive: hex(regionEnd),
    subrecordCount: sorted.length,
    coveredHighConfidenceBytes: coveredBytes,
    coveredHighConfidencePercent: Number(((coveredBytes / Math.max(1, region.size || 0)) * 100).toFixed(2)),
    overlapCount,
    nestedOrAliasCount: nestedCount,
    adjacentCount,
    gapCount,
    splitReadiness: overlapCount === 0 ? 'subrecords_disjoint' : 'subrecords_include_nested_or_overlapping_views',
    subrecords: annotated,
  };
}

function buildSubrecord(frame) {
  const start = parseInt(frame.offset, 16);
  const endInclusive = start + frame.byteLengthThroughTerminator - 1;
  return {
    id: `frame_stream_${frame.offset.replace(/^0x/i, '')}`,
    kind: 'metasprite_frame_stream_subrecord',
    confidence: 'high',
    start,
    endInclusive,
    offset: frame.offset,
    endOffsetInclusive: hex(endInclusive),
    size: frame.byteLengthThroughTerminator,
    terminatorOffset: frame.termination?.terminatorOffset || null,
    pieceRecordCount: frame.pieceRecordCount,
    referenceCount: frame.referenceCount,
    sourceCommandStreams: [...new Set((frame.references || []).map(ref => ref.sourceCommandStream))].sort(),
    sourceFamilies: (frame.references || []).flatMap(ref => ref.sourceFamilies || []).slice(0, 24),
    evidence: [
      `${frame.offset} is a high-confidence _LABEL_792_ frame stream with 0x80 terminator at ${frame.termination?.terminatorOffset}.`,
      'Range size is derived from frame stream start through the terminator byte inclusive.',
    ],
  };
}

function buildCatalog(mapData) {
  const frameCatalog = requireCatalog(mapData, 'animationFrameStreamCatalogs', 'world-animation-frame-stream-catalog-2026-06-25');
  const highFrames = (frameCatalog.frameStreams || []).filter(frame => frame.confidence === 'high' && frame.byteLengthThroughTerminator != null);
  const lowFrames = (frameCatalog.frameStreams || []).filter(frame => frame.confidence !== 'high');
  const byRegion = new Map();
  const missingRegions = [];

  for (const frame of highFrames) {
    const region = frame.region?.id ? findRegionById(mapData, frame.region.id) : null;
    if (!region) {
      missingRegions.push({ frameOffset: frame.offset, region: frame.region || null });
      continue;
    }
    if (!byRegion.has(region.id)) byRegion.set(region.id, { region, subrecords: [] });
    byRegion.get(region.id).subrecords.push(buildSubrecord(frame));
  }

  const regions = [...byRegion.values()]
    .map(item => classifyRegionSubrecords(item.region, item.subrecords))
    .sort((a, b) => a.region.offset.localeCompare(b.region.offset));

  const disjointRegions = regions.filter(region => region.overlapCount === 0);
  const overlappingRegions = regions.filter(region => region.overlapCount > 0);
  const allSubrecords = regions.flatMap(region => region.subrecords);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [frameCatalog.id],
    assetPolicy: 'Metadata only: frame stream ranges, terminator offsets, counts, source references, and overlap classification. No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    rangeSemantics: {
      sourceRoutine: '_LABEL_792_',
      start: 'Frame pointer loaded into IX+12/IX+13 by _LABEL_1347_.',
      end: 'First 0x80 terminator byte consumed by _LABEL_792_; range includes the terminator byte.',
      recordShape: '3-byte piece records before the terminator: X offset byte, Y offset byte, tile byte.',
      storagePolicy: 'Subrecords are stored as metadata under containing regions, not as top-level ROM regions.',
    },
    regions,
    lowConfidenceFrames: lowFrames.map(frame => ({
      offset: frame.offset,
      region: frame.region || null,
      termination: frame.termination,
      pieceRecordCount: frame.pieceRecordCount,
      referenceCount: frame.referenceCount,
      issues: frame.issues || [],
    })),
    missingRegions,
    summary: {
      highConfidenceSubrecords: allSubrecords.length,
      lowConfidenceFrames: lowFrames.length,
      regionCount: regions.length,
      disjointRegionCount: disjointRegions.length,
      overlappingRegionCount: overlappingRegions.length,
      totalHighConfidenceRangeBytes: unionBytes(allSubrecords),
      totalPieceRecords: allSubrecords.reduce((sum, item) => sum + item.pieceRecordCount, 0),
      regionsReadyForFutureSplit: disjointRegions.length,
      regionsRequiringSubviewModel: overlappingRegions.length,
      missingRegions: missingRegions.length,
      assetPolicy: 'Metadata only: frame stream ranges, terminator offsets, counts, source references, and overlap classification. No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    },
  };
}

function annotateRegion(region, catalogRegion) {
  region.analysis = region.analysis || {};
  region.analysis.animationFrameSubrecordAudit = {
    kind: 'metasprite_frame_subrecord_range_catalog',
    catalogId,
    confidence: catalogRegion.overlapCount === 0 ? 'high' : 'medium',
    summary: 'High-confidence _LABEL_792_ frame stream ranges contained in this region.',
    splitReadiness: catalogRegion.splitReadiness,
    subrecordCount: catalogRegion.subrecordCount,
    coveredHighConfidenceBytes: catalogRegion.coveredHighConfidenceBytes,
    coveredHighConfidencePercent: catalogRegion.coveredHighConfidencePercent,
    overlapCount: catalogRegion.overlapCount,
    nestedOrAliasCount: catalogRegion.nestedOrAliasCount,
    subrecords: catalogRegion.subrecords.map(item => ({
      id: item.id,
      offset: item.offset,
      endOffsetInclusive: item.endOffsetInclusive,
      size: item.size,
      terminatorOffset: item.terminatorOffset,
      pieceRecordCount: item.pieceRecordCount,
      referenceCount: item.referenceCount,
      relationToPrevious: item.relationToPrevious,
      sourceCommandStreams: item.sourceCommandStreams.slice(0, 16),
      sourceFamilies: item.sourceFamilies.slice(0, 16),
    })).slice(0, 128),
    evidence: [
      '_LABEL_792_ terminates frame streams on 0x80 and consumes 3-byte piece records before that terminator.',
      'Ranges are metadata-only and are not emitted as new top-level regions to avoid artificial overlap churn.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    type: region.type || 'unknown',
    name: region.name || '',
    subrecordCount: catalogRegion.subrecordCount,
    splitReadiness: catalogRegion.splitReadiness,
  };
}

function annotateMap(mapData, catalog) {
  for (const region of mapData.regions || []) {
    if (region.analysis?.animationFrameSubrecordAudit?.catalogId === catalogId) {
      delete region.analysis.animationFrameSubrecordAudit;
    }
  }

  const annotatedRegions = [];
  const missingRegions = [];
  for (const catalogRegion of catalog.regions) {
    const region = findRegionById(mapData, catalogRegion.region.id);
    if (!region) {
      missingRegions.push(catalogRegion.region);
      continue;
    }
    annotatedRegions.push(annotateRegion(region, catalogRegion));
  }
  return { annotatedRegions, missingRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let annotation = { annotatedRegions: [], missingRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    const finalCatalog = buildCatalog(mapData);
    mapData.animationFrameSubrecordCatalogs = (mapData.animationFrameSubrecordCatalogs || []).filter(item => item.id !== catalogId);
    mapData.animationFrameSubrecordCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'animation_frame_subrecord_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: finalCatalog.sourceCatalogs,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotation.annotatedRegions.length,
        missingAnnotationRegions: annotation.missingRegions.length,
      },
      rangeSemantics: finalCatalog.rangeSemantics,
      regionSummary: finalCatalog.regions.map(region => ({
        region: region.region,
        subrecordCount: region.subrecordCount,
        coveredHighConfidenceBytes: region.coveredHighConfidenceBytes,
        coveredHighConfidencePercent: region.coveredHighConfidencePercent,
        overlapCount: region.overlapCount,
        nestedOrAliasCount: region.nestedOrAliasCount,
        splitReadiness: region.splitReadiness,
        subrecordSamples: region.subrecords.slice(0, 16).map(item => ({
          id: item.id,
          offset: item.offset,
          endOffsetInclusive: item.endOffsetInclusive,
          size: item.size,
          pieceRecordCount: item.pieceRecordCount,
          referenceCount: item.referenceCount,
          relationToPrevious: item.relationToPrevious,
        })),
      })),
      lowConfidenceFrames: finalCatalog.lowConfidenceFrames,
      missingRegions: finalCatalog.missingRegions,
      annotatedRegions: annotation.annotatedRegions,
      missingAnnotationRegions: annotation.missingRegions,
      nextLeads: [
        'Promote disjoint high-confidence frame subrecords into browser preview input without adding top-level overlapping ROM regions.',
        'Investigate low-confidence frame pointers that hit the record limit; several may be aliases into shared frame data or non-frame pointer misuse.',
        'Trace IX+63 tile-base setup so frame subrecords can be rendered against locally decoded tile graphics.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: annotation.annotatedRegions.length,
    missingAnnotationRegions: annotation.missingRegions.length,
  }, null, 2));
}

main();
