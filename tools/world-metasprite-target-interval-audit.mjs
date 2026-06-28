#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-metasprite-target-interval-audit.mjs';
const catalogId = 'world-metasprite-target-interval-catalog-2026-06-26';
const reportId = 'metasprite-target-interval-audit-2026-06-26';

const metaspriteCatalogId = 'world-metasprite-catalog-2026-06-24';
const frameSubrecordCatalogId = 'world-animation-frame-subrecord-catalog-2026-06-25';
const BANK6_START = 0x18000;
const BANK6_END_EXCLUSIVE = 0x1C000;
const FRAME_RECORD_LIMIT = 128;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function offsetOf(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 16);
  return NaN;
}

function regionStart(region) {
  return offsetOf(region.offset);
}

function regionEnd(region) {
  return regionStart(region) + Number(region.size || 0);
}

function isBank6Offset(offset) {
  return offset >= BANK6_START && offset < BANK6_END_EXCLUSIVE;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
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

function buildConfirmedFrameSet(frameCatalog) {
  const set = new Set();
  for (const region of frameCatalog?.regions || []) {
    for (const subrecord of region.subrecords || []) set.add(subrecord.offset);
  }
  return set;
}

function parseLabel792Frame(rom, startOffset) {
  let cursor = startOffset;
  let pieceRecordCount = 0;
  const warnings = [];
  for (let recordIndex = 0; recordIndex < FRAME_RECORD_LIMIT; recordIndex++) {
    if (!isBank6Offset(cursor) || cursor >= rom.length) {
      return {
        normal: false,
        endExclusive: cursor,
        pieceRecordCount,
        terminationKind: 'left_bank6_range',
        warnings: [...warnings, `left bank-6 range at ${hex(cursor)}`],
      };
    }
    const recordOffset = cursor;
    const control = rom[cursor++];
    if (control === 0x80) {
      return {
        normal: true,
        endExclusive: cursor,
        terminatorOffset: recordOffset,
        pieceRecordCount,
        terminationKind: 'terminator_0x80',
        warnings,
      };
    }
    if (cursor + 1 >= rom.length || !isBank6Offset(cursor + 1)) {
      return {
        normal: false,
        endExclusive: cursor,
        pieceRecordCount,
        terminationKind: 'truncated_piece_record',
        warnings: [...warnings, `truncated piece record at ${hex(recordOffset)}`],
      };
    }
    cursor += 2;
    pieceRecordCount++;
  }
  return {
    normal: false,
    endExclusive: cursor,
    pieceRecordCount,
    terminationKind: 'record_limit_reached',
    warnings: [...warnings, `record limit ${FRAME_RECORD_LIMIT} reached from ${hex(startOffset)}`],
  };
}

function relationToPrevious(previous, current) {
  if (!previous) return 'first';
  if (current.start > previous.endExclusive) return 'disjoint_gap';
  if (current.start === previous.endExclusive) return 'adjacent';
  if (current.endExclusive <= previous.endExclusive) return 'nested_or_alias';
  return 'overlap_extends';
}

function buildRegionEntry(mapData, rom, targetRegion, confirmedFrameSet) {
  const region = findRegionById(mapData, targetRegion.id);
  const intervals = [];
  const rejectedTargets = [];
  const seen = new Set();

  for (const offsetText of targetRegion.targetOffsets || []) {
    if (seen.has(offsetText)) continue;
    seen.add(offsetText);
    const start = offsetOf(offsetText);
    const containing = findContainingRegion(mapData, start);
    if (!region || containing?.id !== region.id || region.type !== 'meta_sprite') {
      rejectedTargets.push({
        targetOffset: offsetText,
        reason: 'target_outside_expected_meta_sprite_region',
        containingRegion: compactRegion(containing),
      });
      continue;
    }
    const parsed = parseLabel792Frame(rom, start);
    if (!parsed.normal) {
      rejectedTargets.push({
        targetOffset: offsetText,
        reason: parsed.terminationKind,
        pieceRecordCount: parsed.pieceRecordCount,
        warningCount: parsed.warnings.length,
        warnings: parsed.warnings.slice(0, 4),
      });
      continue;
    }
    intervals.push({
      id: `metasprite_target_${offsetText.replace(/^0x/i, '')}`,
      kind: 'metasprite_target_frame_stream',
      confidence: confirmedFrameSet.has(offsetText) ? 'high' : 'medium',
      start,
      endExclusive: parsed.endExclusive,
      targetOffset: offsetText,
      endExclusiveOffset: hex(parsed.endExclusive),
      terminatorOffset: hex(parsed.terminatorOffset),
      byteLength: parsed.endExclusive - start,
      pieceRecordCount: parsed.pieceRecordCount,
      sourceCatalogId: metaspriteCatalogId,
      confirmedFrameSubrecord: confirmedFrameSet.has(offsetText),
      evidence: confirmedFrameSet.has(offsetText)
        ? 'Target is also present in the high-confidence animation frame subrecord catalog.'
        : 'Target comes from the broader metasprite target-offset catalog and terminates normally under the _LABEL_792_ frame parser.',
    });
  }

  intervals.sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
  let previous = null;
  let overlapCount = 0;
  let gapCount = 0;
  for (const interval of intervals) {
    interval.relationToPrevious = relationToPrevious(previous, interval);
    if (interval.relationToPrevious === 'disjoint_gap') gapCount++;
    else if (interval.relationToPrevious === 'nested_or_alias' || interval.relationToPrevious === 'overlap_extends') overlapCount++;
    if (!previous || interval.endExclusive > previous.endExclusive) previous = interval;
  }

  return {
    region: compactRegion(region || targetRegion),
    referenceCount: targetRegion.referenceCount || 0,
    targetOffsetCount: (targetRegion.targetOffsets || []).length,
    intervalCount: intervals.length,
    confirmedFrameSubrecordIntervalCount: intervals.filter(interval => interval.confirmedFrameSubrecord).length,
    secondaryNormalIntervalCount: intervals.filter(interval => !interval.confirmedFrameSubrecord).length,
    rejectedTargetCount: rejectedTargets.length,
    overlapCount,
    gapCount,
    intervalConfidenceCounts: countBy(intervals, interval => interval.confidence),
    intervals: intervals.map(interval => ({
      id: interval.id,
      kind: interval.kind,
      confidence: interval.confidence,
      targetOffset: interval.targetOffset,
      endExclusive: interval.endExclusiveOffset,
      terminatorOffset: interval.terminatorOffset,
      byteLength: interval.byteLength,
      pieceRecordCount: interval.pieceRecordCount,
      sourceCatalogId: interval.sourceCatalogId,
      confirmedFrameSubrecord: interval.confirmedFrameSubrecord,
      relationToPrevious: interval.relationToPrevious,
      evidence: interval.evidence,
    })),
    rejectedTargets,
  };
}

function buildCatalog(mapData, rom) {
  const metaspriteCatalog = findCatalog(mapData, metaspriteCatalogId);
  if (!metaspriteCatalog) throw new Error(`Missing required catalog ${metaspriteCatalogId}`);
  const frameSubrecordCatalog = findCatalog(mapData, frameSubrecordCatalogId);
  const confirmedFrameSet = buildConfirmedFrameSet(frameSubrecordCatalog);
  const regionEntries = (metaspriteCatalog.targetRegions || [])
    .filter(targetRegion => targetRegion.type === 'meta_sprite')
    .map(targetRegion => buildRegionEntry(mapData, rom, targetRegion, confirmedFrameSet))
    .filter(entry => entry.intervalCount || entry.rejectedTargetCount)
    .sort((a, b) => String(a.region?.offset || '').localeCompare(String(b.region?.offset || '')));

  const allIntervals = regionEntries.flatMap(entry => entry.intervals || []);
  const rejectedTargets = regionEntries.flatMap(entry => entry.rejectedTargets || []);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [metaspriteCatalogId, frameSubrecordCatalogId],
    sourceCatalogPresence: {
      [metaspriteCatalogId]: Boolean(metaspriteCatalog),
      [frameSubrecordCatalogId]: Boolean(frameSubrecordCatalog),
    },
    parserSemantics: {
      routine: '_LABEL_792_',
      intervalStart: 'Frame/metasprite target offsets from world-metasprite-catalog-2026-06-24.',
      intervalEnd: 'First 0x80 terminator byte under the _LABEL_792_ frame parser; interval endExclusive is one byte after that terminator.',
      recordShape: 'Three-byte piece records before the terminator. Field roles are metadata only; no coordinates or tile values are persisted.',
    },
    assetPolicy: 'Metadata only: target offsets, interval lengths, terminator offsets, piece counts, confidence classes, and region ids. No ROM bytes, decoded sprites, coordinates, tile values, graphics, hashes, screenshots, music, or text are embedded.',
    regionIntervals: regionEntries,
    summary: {
      regionCount: regionEntries.length,
      intervalCount: allIntervals.length,
      highConfidenceIntervalCount: allIntervals.filter(interval => interval.confidence === 'high').length,
      mediumConfidenceIntervalCount: allIntervals.filter(interval => interval.confidence === 'medium').length,
      confirmedFrameSubrecordIntervalCount: allIntervals.filter(interval => interval.confirmedFrameSubrecord).length,
      secondaryNormalIntervalCount: allIntervals.filter(interval => !interval.confirmedFrameSubrecord).length,
      rejectedTargetCount: rejectedTargets.length,
      overlapCount: regionEntries.reduce((sum, entry) => sum + entry.overlapCount, 0),
      gapCount: regionEntries.reduce((sum, entry) => sum + entry.gapCount, 0),
      targetOffsetCount: regionEntries.reduce((sum, entry) => sum + entry.targetOffsetCount, 0),
      pieceRecordCount: allIntervals.reduce((sum, interval) => sum + Number(interval.pieceRecordCount || 0), 0),
      intervalConfidenceCounts: countBy(allIntervals, interval => interval.confidence),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedCoordinateCount: 0,
      assetPolicy: 'Metadata only: target offsets, interval lengths, terminator offsets, piece counts, confidence classes, and region ids. No ROM bytes, decoded sprites, coordinates, tile values, graphics, hashes, screenshots, music, or text are embedded.',
    },
    evidence: [
      'world-metasprite-catalog-2026-06-24 records target offsets reached by the broader _LABEL_1318_/_LABEL_1347_ metasprite pointer analysis.',
      'Each persisted interval was parsed locally with the _LABEL_792_ frame terminator rule and kept only when a normal 0x80 terminator was found.',
      'High confidence means the target is also present in world-animation-frame-subrecord-catalog-2026-06-25; medium confidence means the broader metasprite catalog target parses cleanly but is outside the narrower command-stream frame catalog.',
      'Rejected targets are retained as metadata-only offsets and termination classes for follow-up tracing.',
    ],
    nextLeads: [
      'Use medium-confidence intervals to explain sparse metasprite source-word hits, while preserving high-confidence frame subrecords as the primary split-ready model.',
      'Trace rejected _DATA_1B486_ targets that do not terminate normally under _LABEL_792_; several sit near player/form _LABEL_A48_ tile streams.',
      'Promote secondary intervals to high confidence only after their source command streams are normalized without warnings.',
    ],
  };
}

function annotateRegions(mapData, catalog) {
  const annotated = [];
  for (const entry of catalog.regionIntervals) {
    const region = findRegionById(mapData, entry.region?.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.metaspriteTargetIntervalAudit = {
      catalogId,
      kind: 'metasprite_target_frame_interval_catalog',
      confidence: entry.secondaryNormalIntervalCount === 0 && entry.rejectedTargetCount === 0 ? 'high' : 'medium',
      targetOffsetCount: entry.targetOffsetCount,
      intervalCount: entry.intervalCount,
      confirmedFrameSubrecordIntervalCount: entry.confirmedFrameSubrecordIntervalCount,
      secondaryNormalIntervalCount: entry.secondaryNormalIntervalCount,
      rejectedTargetCount: entry.rejectedTargetCount,
      overlapCount: entry.overlapCount,
      gapCount: entry.gapCount,
      intervalConfidenceCounts: entry.intervalConfidenceCounts,
      intervalSamples: entry.intervals.slice(0, 24).map(interval => ({
        id: interval.id,
        targetOffset: interval.targetOffset,
        endExclusive: interval.endExclusive,
        byteLength: interval.byteLength,
        pieceRecordCount: interval.pieceRecordCount,
        confidence: interval.confidence,
        confirmedFrameSubrecord: interval.confirmedFrameSubrecord,
      })),
      rejectedTargetSamples: entry.rejectedTargets.slice(0, 16),
      summary: `${entry.intervalCount} normally terminated metasprite target interval(s), including ${entry.secondaryNormalIntervalCount} secondary interval(s) outside the high-confidence frame-subrecord catalog.`,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      region: compactRegion(region),
      intervalCount: entry.intervalCount,
      confirmedFrameSubrecordIntervalCount: entry.confirmedFrameSubrecordIntervalCount,
      secondaryNormalIntervalCount: entry.secondaryNormalIntervalCount,
      rejectedTargetCount: entry.rejectedTargetCount,
    });
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotatedRegions = apply ? annotateRegions(mapData, catalog) : [];

  if (apply) {
    mapData.animationFrameStreamCatalogs = (mapData.animationFrameStreamCatalogs || []).filter(item => item.id !== catalogId);
    mapData.animationFrameStreamCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'metasprite_target_interval_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      sourceCatalogPresence: catalog.sourceCatalogPresence,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      parserSemantics: catalog.parserSemantics,
      regionSummaries: catalog.regionIntervals.map(entry => ({
        region: entry.region,
        targetOffsetCount: entry.targetOffsetCount,
        intervalCount: entry.intervalCount,
        confirmedFrameSubrecordIntervalCount: entry.confirmedFrameSubrecordIntervalCount,
        secondaryNormalIntervalCount: entry.secondaryNormalIntervalCount,
        rejectedTargetCount: entry.rejectedTargetCount,
        intervalConfidenceCounts: entry.intervalConfidenceCounts,
      })),
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      annotatedRegions,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotatedRegions.length,
    },
    topRegions: catalog.regionIntervals
      .slice()
      .sort((a, b) => b.secondaryNormalIntervalCount - a.secondaryNormalIntervalCount || b.intervalCount - a.intervalCount)
      .slice(0, 12)
      .map(entry => ({
        region: entry.region,
        targetOffsetCount: entry.targetOffsetCount,
        intervalCount: entry.intervalCount,
        confirmedFrameSubrecordIntervalCount: entry.confirmedFrameSubrecordIntervalCount,
        secondaryNormalIntervalCount: entry.secondaryNormalIntervalCount,
        rejectedTargetCount: entry.rejectedTargetCount,
      })),
  }, null, 2));
}

main();
