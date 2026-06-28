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
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-animation-frame-stream-catalog-2026-06-25';
const reportId = 'animation-frame-stream-audit-2026-06-25';
const toolName = 'tools/world-animation-frame-stream-audit.mjs';

const BANK6_START = 0x18000;
const BANK6_END = 0x1BFFF;
const FRAME_RECORD_LIMIT = 128;

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

function isBank6Offset(offset) {
  return offset >= BANK6_START && offset <= BANK6_END;
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function regionRefAt(mapData, offset) {
  const normalized = normOffset(offset);
  if (!normalized) return null;
  return regionRef(findContainingRegion(mapData, parseInt(normalized, 16)));
}

function regionIsAllZero(rom, region) {
  if (!region) return false;
  if (region.analysis?.blankMetaspriteTargetAudit?.allZero) return true;
  const start = offsetOf(region);
  const size = region.size || 0;
  if (!Number.isFinite(start) || !Number.isFinite(size) || size <= 0 || start + size > rom.length) return false;
  for (let offset = start; offset < start + size; offset++) {
    if (rom[offset] !== 0) return false;
  }
  return true;
}

function blankMetaspriteQuarantine(rom, mapData, startOffset) {
  const region = findContainingRegion(mapData, startOffset);
  if (!region || region.type !== 'meta_sprite' || !regionIsAllZero(rom, region)) return null;
  const blankAudit = region.analysis?.blankMetaspriteTargetAudit || null;
  return {
    region,
    reason: blankAudit?.kind || 'all_zero_metasprite_typed_region',
    catalogId: blankAudit?.catalogId || null,
    policy: blankAudit?.decodePolicy || 'All-zero metasprite targets are quarantined from normal frame-stream expansion until consumer-specific evidence proves a bounded interpretation.',
  };
}

function nonMetaspriteTargetQuarantine(mapData, startOffset) {
  const region = findContainingRegion(mapData, startOffset);
  if (!region || region.type === 'meta_sprite') return null;
  return {
    region,
    reason: `target_region_type_${region.type || 'unknown'}`,
    policy: 'Do not expand a frame target through _LABEL_792_ when the target resolves inside a region currently typed as animation/code/table data rather than metasprite frame data.',
  };
}

function requireCatalog(mapData, key, id) {
  const catalog = (mapData[key] || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required catalog ${key}.${id}`);
  return catalog;
}

function collectFrameRefs(commandCatalog) {
  const refsByOffset = new Map();
  for (const stream of commandCatalog.streams || []) {
    for (const target of stream.frameTargets || []) {
      const frameOffset = normOffset(target.romOffset);
      if (!frameOffset) continue;
      if (!refsByOffset.has(frameOffset)) refsByOffset.set(frameOffset, []);
      refsByOffset.get(frameOffset).push({
        sourceCommandStream: stream.offset,
        sourceCommandOffset: target.sourceCommandOffset,
        pointerOffset: target.pointerOffset,
        z80Pointer: target.z80Pointer,
        sourceFamilies: (stream.sourceFamilies || []).slice(0, 8),
      });
    }
  }
  return refsByOffset;
}

function parseFrameStream(rom, mapData, startOffset) {
  const blankTarget = blankMetaspriteQuarantine(rom, mapData, startOffset);
  if (blankTarget) {
    return {
      offset: hex(startOffset),
      region: regionRef(blankTarget.region),
      termination: {
        kind: 'blank_metasprite_target_quarantined',
        normal: false,
        atOffset: hex(startOffset),
        reason: blankTarget.reason,
      },
      pieceRecordCount: 0,
      byteLengthThroughTerminator: null,
      recordOffsets: [],
      recordSamples: [],
      issueCount: 0,
      issues: [],
      quarantined: true,
      quarantine: {
        kind: 'blank_metasprite_target',
        reason: blankTarget.reason,
        sourceCatalogId: blankTarget.catalogId,
        policy: blankTarget.policy,
      },
      confidence: 'medium',
    };
  }

  const records = [];
  const issues = [];
  let pos = startOffset;
  let termination = null;

  for (let i = 0; i < FRAME_RECORD_LIMIT; i++) {
    if (!isBank6Offset(pos) || pos >= rom.length) {
      termination = { kind: 'left_bank6_range', normal: false, atOffset: hex(pos) };
      issues.push({ kind: 'left_bank6_range', severity: 'high', atOffset: hex(pos) });
      break;
    }
    const recordOffset = pos;
    const control = rom[pos++];
    if (control === 0x80) {
      termination = {
        kind: 'terminator_0x80',
        normal: true,
        terminatorOffset: hex(recordOffset),
      };
      break;
    }
    if (pos + 1 >= rom.length || !isBank6Offset(pos + 1)) {
      termination = { kind: 'truncated_piece_record', normal: false, atOffset: hex(recordOffset) };
      issues.push({ kind: 'truncated_piece_record', severity: 'high', atOffset: hex(recordOffset) });
      break;
    }
    records.push({
      index: records.length,
      recordOffset: hex(recordOffset),
      byteLength: 3,
      xOffsetByteOffset: hex(recordOffset),
      yOffsetByteOffset: hex(pos),
      tileByteOffset: hex(pos + 1),
    });
    pos += 2;
  }

  if (!termination) {
    termination = { kind: 'record_limit_reached', normal: false, recordLimit: FRAME_RECORD_LIMIT };
    issues.push({ kind: 'record_limit_reached', severity: 'high', recordLimit: FRAME_RECORD_LIMIT });
  }

  const endOffsetExclusive = termination.normal
    ? parseInt(termination.terminatorOffset, 16) + 1
    : pos;
  const nonMetaspriteTarget = nonMetaspriteTargetQuarantine(mapData, startOffset);
  if (nonMetaspriteTarget && (!termination.normal || issues.length > 0)) {
    return {
      offset: hex(startOffset),
      region: regionRef(nonMetaspriteTarget.region),
      termination: {
        kind: 'non_metasprite_target_quarantined',
        normal: false,
        atOffset: hex(startOffset),
        reason: nonMetaspriteTarget.reason,
        originalTermination: termination,
      },
      pieceRecordCount: 0,
      byteLengthThroughTerminator: null,
      recordOffsets: [],
      recordSamples: [],
      issueCount: 0,
      issues: [],
      quarantined: true,
      quarantine: {
        kind: 'non_metasprite_frame_target_region',
        reason: nonMetaspriteTarget.reason,
        sourceCatalogId: null,
        policy: nonMetaspriteTarget.policy,
      },
      confidence: 'medium',
    };
  }
  return {
    offset: hex(startOffset),
    region: regionRefAt(mapData, startOffset),
    termination,
    pieceRecordCount: records.length,
    byteLengthThroughTerminator: termination.normal ? endOffsetExclusive - startOffset : null,
    recordOffsets: records.map(record => record.recordOffset).slice(0, 64),
    recordSamples: records.slice(0, 16),
    issueCount: issues.length,
    issues,
    confidence: termination.normal && issues.length === 0 ? 'high' : 'low',
  };
}

function buildCatalog(rom, mapData) {
  const commandCatalog = requireCatalog(mapData, 'animationCommandStreamCatalogs', 'world-animation-command-stream-catalog-2026-06-25');
  const refsByOffset = collectFrameRefs(commandCatalog);
  const frameStreams = [...refsByOffset.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([offset, references]) => {
    const parsed = parseFrameStream(rom, mapData, parseInt(offset, 16));
    return {
      ...parsed,
      referenceCount: references.length,
      references: references.slice(0, 24),
    };
  });
  const byRegion = new Map();
  for (const frame of frameStreams) {
    const regionId = frame.region?.id || `unmapped:${frame.offset}`;
    if (!byRegion.has(regionId)) {
      byRegion.set(regionId, {
        region: frame.region || null,
        frameStreamCount: 0,
        referenceCount: 0,
        pieceRecordCount: 0,
        highConfidenceStreams: 0,
        lowConfidenceStreams: 0,
        frameOffsets: [],
      });
    }
    const item = byRegion.get(regionId);
    item.frameStreamCount++;
    item.referenceCount += frame.referenceCount;
    item.pieceRecordCount += frame.pieceRecordCount;
    if (frame.confidence === 'high') item.highConfidenceStreams++;
    else item.lowConfidenceStreams++;
    item.frameOffsets.push(frame.offset);
  }
  const frameTargetRegions = [...byRegion.values()]
    .sort((a, b) => (a.region?.offset || '').localeCompare(b.region?.offset || ''))
    .map(item => ({
      ...item,
      frameOffsets: item.frameOffsets.sort().slice(0, 48),
    }));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [commandCatalog.id],
    assetPolicy: 'Metadata only: frame stream offsets, record counts, byte offsets, terminator offsets, references, and region ids. No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    parserSemantics: {
      routine: '_LABEL_792_',
      entryPointerSource: 'IX+12/IX+13, written by _LABEL_1347_ from animation command-stream frame pointers.',
      terminator: '0x80 byte terminates one frame stream.',
      pieceRecordShape: '3 bytes per non-terminator record: signed X offset byte, signed Y offset byte, tile byte adjusted at runtime by IX+63.',
      clipping: '_LABEL_792_ clips records against camera-relative X/Y before appending Y/X/tile triples to the OAM staging buffer.',
      blankTargetPolicy: 'All-zero metasprite targets are recorded as quarantined blank/no-op frame leads instead of being expanded as unbounded zero-byte frame streams.',
      targetRegionPolicy: 'Targets inside non-metasprite regions are quarantined as command/region conflicts instead of being expanded as frame streams.',
    },
    frameStreams,
    frameTargetRegions,
    summary: {
      frameStreamCount: frameStreams.length,
      highConfidenceFrameStreams: frameStreams.filter(frame => frame.confidence === 'high').length,
      mediumConfidenceFrameStreams: frameStreams.filter(frame => frame.confidence === 'medium').length,
      lowConfidenceFrameStreams: frameStreams.filter(frame => frame.confidence === 'low').length,
      quarantinedFrameStreams: frameStreams.filter(frame => frame.quarantined).length,
      quarantinedBlankFrameStreams: frameStreams.filter(frame => frame.quarantine?.kind === 'blank_metasprite_target').length,
      quarantinedNonMetaspriteFrameTargets: frameStreams.filter(frame => frame.quarantine?.kind === 'non_metasprite_frame_target_region').length,
      referencedByCommandStreams: new Set(frameStreams.flatMap(frame => frame.references.map(ref => ref.sourceCommandStream))).size,
      commandFramePointerReferences: frameStreams.reduce((sum, frame) => sum + frame.referenceCount, 0),
      pieceRecordCount: frameStreams.reduce((sum, frame) => sum + frame.pieceRecordCount, 0),
      frameTargetRegions: frameTargetRegions.length,
      issueStreams: frameStreams.filter(frame => frame.issueCount > 0).length,
      assetPolicy: 'Metadata only: frame stream offsets, record counts, byte offsets, terminator offsets, references, and region ids. No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    },
  };
}

function addRegionAnnotation(region, refs) {
  region.analysis = region.analysis || {};
  const existing = region.analysis.animationFrameStreamAudit || {};
  const preserved = (existing.frameStreams || []).filter(ref => ref.catalogId !== catalogId);
  const frameStreams = [...preserved, ...refs].slice(0, 96);
  const confidence = frameStreams.some(ref => ref.confidence === 'low')
    ? 'low'
    : (frameStreams.some(ref => ref.confidence === 'medium') ? 'medium' : 'high');
  const allQuarantined = frameStreams.length > 0 && frameStreams.every(ref => ref.quarantined);
  region.analysis.animationFrameStreamAudit = {
    kind: 'metasprite_frame_stream_region',
    catalogId,
    confidence,
    summary: allQuarantined
      ? 'Region has blank/quarantined _LABEL_792_ frame-stream references; zero fill is not expanded as sprite frame data.'
      : 'Region contains _LABEL_792_ frame/metasprite streams referenced by normalized animation command streams.',
    frameStreams,
    evidence: [
      '_LABEL_792_ reads frame streams from IX+12/IX+13, terminates on 0x80, and emits OAM Y/X/tile triples.',
      '_LABEL_1347_ writes IX+12/IX+13 from command-stream frame pointers.',
      'No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    type: region.type || 'unknown',
    name: region.name || '',
    frameStreamRefs: refs.length,
  };
}

function annotateMap(mapData, catalog) {
  const refsByRegionId = new Map();
  const missingRegions = [];

  for (const region of mapData.regions || []) {
    if (region.analysis?.animationFrameStreamAudit?.catalogId === catalogId) {
      delete region.analysis.animationFrameStreamAudit;
    }
  }

  function addRef(frame) {
    let region = frame.region?.id ? findRegionById(mapData, frame.region.id) : null;
    if (!region) region = findContainingRegion(mapData, parseInt(frame.offset, 16));
    if (!region) {
      missingRegions.push({ frameOffset: frame.offset });
      return;
    }
    if (!refsByRegionId.has(region.id)) refsByRegionId.set(region.id, { region, refs: [] });
    refsByRegionId.get(region.id).refs.push({
      catalogId,
      role: 'frame_stream',
      frameOffset: frame.offset,
      confidence: frame.confidence,
      termination: frame.termination,
      pieceRecordCount: frame.pieceRecordCount,
      byteLengthThroughTerminator: frame.byteLengthThroughTerminator,
      referenceCount: frame.referenceCount,
      sourceCommandStreams: [...new Set(frame.references.map(ref => ref.sourceCommandStream))].sort().slice(0, 24),
      sourceFamilies: frame.references.flatMap(ref => ref.sourceFamilies || []).slice(0, 24),
      issueCount: frame.issueCount,
      issues: frame.issues,
      quarantined: Boolean(frame.quarantined),
      quarantine: frame.quarantine || null,
    });
  }

  for (const frame of catalog.frameStreams) addRef(frame);

  const annotatedRegions = [];
  for (const { region, refs } of refsByRegionId.values()) annotatedRegions.push(addRegionAnnotation(region, refs));
  return { annotatedRegions, missingRegions };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  let annotation = { annotatedRegions: [], missingRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    const finalCatalog = buildCatalog(rom, mapData);
    mapData.animationFrameStreamCatalogs = (mapData.animationFrameStreamCatalogs || []).filter(item => item.id !== catalogId);
    mapData.animationFrameStreamCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'animation_frame_stream_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: finalCatalog.sourceCatalogs,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotation.annotatedRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      parserSemantics: finalCatalog.parserSemantics,
      frameTargetRegions: finalCatalog.frameTargetRegions,
      frameStreamSamples: finalCatalog.frameStreams.slice(0, 96),
      annotatedRegions: annotation.annotatedRegions,
      missingRegions: annotation.missingRegions,
      nextLeads: [
        'Use frame stream piece counts and terminator offsets to split large bank-6 metasprite blobs into frame subrecords.',
        'Decode tile byte semantics by tracing IX+63 tile-base setup in entity initializers and player/form transitions.',
        'Add browser preview support that renders _LABEL_792_ frame streams through the local ROM without storing decoded graphics.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: annotation.annotatedRegions.length,
    missingRegions: annotation.missingRegions.length,
  }, null, 2));
}

main();
