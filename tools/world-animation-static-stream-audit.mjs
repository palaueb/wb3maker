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
const catalogId = 'world-animation-static-stream-catalog-2026-06-25';
const reportId = 'animation-static-stream-audit-2026-06-25';
const toolName = 'tools/world-animation-static-stream-audit.mjs';

const BANK6_START = 0x18000;
const BANK6_END = 0x1BFFF;
const FRAME_RECORD_LIMIT = 128;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function hexByte(n) {
  return hex(n & 0xff, 2);
}

function normOffset(value) {
  if (value == null) return null;
  if (typeof value === 'number') return hex(value);
  return '0x' + String(value).replace(/^0x/i, '').toUpperCase().padStart(5, '0');
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function readWord(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function isBank6Ptr(z80Pointer) {
  return z80Pointer >= 0x8000 && z80Pointer < 0xC000;
}

function bank6Z80ToRom(z80Pointer) {
  return z80Pointer + 0x10000;
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
  return regionRef(findContainingRegion(mapData, offset));
}

function requireCatalog(mapData, key, id) {
  const catalog = (mapData[key] || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required catalog ${key}.${id}`);
  return catalog;
}

function summarizeByteValues(values) {
  if (!values.length) return { count: 0, min: null, max: null, uniqueCount: 0 };
  return {
    count: values.length,
    min: hexByte(Math.min(...values)),
    max: hexByte(Math.max(...values)),
    uniqueCount: new Set(values).size,
  };
}

function contiguousSegments(values) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (!sorted.length) return [];
  const segments = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const value = sorted[i];
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    segments.push({ start: hexByte(start), end: hexByte(previous), count: previous - start + 1 });
    start = value;
    previous = value;
  }
  segments.push({ start: hexByte(start), end: hexByte(previous), count: previous - start + 1 });
  return segments;
}

function parseFrameStream(rom, mapData, startOffset) {
  const tileBytes = [];
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
      termination = { kind: 'terminator_0x80', normal: true, terminatorOffset: hex(recordOffset) };
      break;
    }
    if (pos + 1 >= rom.length || !isBank6Offset(pos + 1)) {
      termination = { kind: 'truncated_piece_record', normal: false, atOffset: hex(recordOffset) };
      issues.push({ kind: 'truncated_piece_record', severity: 'high', atOffset: hex(recordOffset) });
      break;
    }
    tileBytes.push(rom[pos + 1]);
    pos += 2;
  }
  if (!termination) {
    termination = { kind: 'record_limit_reached', normal: false, recordLimit: FRAME_RECORD_LIMIT };
    issues.push({ kind: 'record_limit_reached', severity: 'high', recordLimit: FRAME_RECORD_LIMIT });
  }
  return {
    frameOffset: hex(startOffset),
    region: regionRefAt(mapData, startOffset),
    pieceRecordCount: tileBytes.length,
    tileByteRange: summarizeByteValues(tileBytes),
    tileByteSegments: contiguousSegments(tileBytes).slice(0, 32),
    termination,
    issueCount: issues.length,
    issues,
    validStaticFrame: termination.normal && issues.length === 0,
  };
}

function parseStaticStream(rom, mapData, streamOffset) {
  if (!isBank6Offset(streamOffset) || streamOffset + 2 >= rom.length) {
    return {
      valid: false,
      reason: 'stream_offset_out_of_range',
      streamOffset: hex(streamOffset),
    };
  }
  const control = rom[streamOffset];
  if (control !== 0x00) {
    return {
      valid: false,
      reason: 'control_not_zero',
      streamOffset: hex(streamOffset),
      control: hexByte(control),
    };
  }
  const framePointerOffset = streamOffset + 1;
  const frameZ80Pointer = readWord(rom, framePointerOffset);
  if (!isBank6Ptr(frameZ80Pointer)) {
    return {
      valid: false,
      reason: 'frame_pointer_not_bank6',
      streamOffset: hex(streamOffset),
      control: hexByte(control),
      framePointerOffset: hex(framePointerOffset),
      frameZ80Pointer: hex(frameZ80Pointer, 4),
    };
  }
  const frameOffset = bank6Z80ToRom(frameZ80Pointer);
  const frame = parseFrameStream(rom, mapData, frameOffset);
  return {
    valid: frame.validStaticFrame,
    reason: frame.validStaticFrame ? 'resolved_static_frame_stream' : frame.termination.kind,
    streamOffset: hex(streamOffset),
    streamRegion: regionRefAt(mapData, streamOffset),
    control: '0x00',
    delay: 0,
    framePointerOffset: hex(framePointerOffset),
    frameZ80Pointer: hex(frameZ80Pointer, 4),
    frame,
  };
}

function selectorPair(root, child) {
  return {
    root: hexByte(root),
    child: hexByte(child),
  };
}

function collectStaticCandidates(rom, mapData, rootCatalog, commandCatalog) {
  const commandByOffset = new Map((commandCatalog.streams || []).map(stream => [normOffset(stream.offset), stream]));
  const refsByStream = new Map();
  const invalidCandidates = [];

  function addRef(streamOffset, ref) {
    const key = normOffset(streamOffset);
    if (!key) return;
    if (!refsByStream.has(key)) refsByStream.set(key, []);
    refsByStream.get(key).push(ref);
  }

  for (const childTable of rootCatalog.childTables || []) {
    for (const childEntry of childTable.entries || []) {
      const variantPrefix = childEntry.variantPrefix;
      if (!variantPrefix) continue;
      const tableOffset = parseHex(childEntry.romOffset);
      const entryCount = variantPrefix.entryCount || 0;
      for (let variantIndex = 0; variantIndex < entryCount; variantIndex++) {
        const pointerOffset = tableOffset + variantIndex * 2;
        if (pointerOffset + 1 >= rom.length) continue;
        const streamZ80Pointer = readWord(rom, pointerOffset);
        if (!isBank6Ptr(streamZ80Pointer)) continue;
        const streamOffset = bank6Z80ToRom(streamZ80Pointer);
        if (!isBank6Offset(streamOffset) || streamOffset >= rom.length) continue;
        if (rom[streamOffset] !== 0x00) continue;
        const parsed = parseStaticStream(rom, mapData, streamOffset);
        const ref = {
          sourceRootTable: {
            label: rootCatalog.rootTable?.label || '_DATA_18718_',
            rootEntry: childTable.rootEntry,
          },
          childTable: {
            label: childTable.label,
            romOffset: childTable.romOffset,
            rootEntry: childTable.rootEntry,
          },
          childEntry: {
            index: childEntry.index,
            selectorPair: selectorPair(childTable.rootEntry, childEntry.index),
            entryOffset: childEntry.entryOffset,
            romOffset: childEntry.romOffset,
            region: childEntry.region || regionRefAt(mapData, parseHex(childEntry.romOffset)),
            targetInterpretation: childEntry.targetInterpretation,
          },
          variantIndex,
          variantPointerOffset: hex(pointerOffset),
          streamZ80Pointer: hex(streamZ80Pointer, 4),
          streamOffset: hex(streamOffset),
        };
        if (!parsed.valid) {
          invalidCandidates.push({
            ...ref,
            reason: parsed.reason,
            framePointerOffset: parsed.framePointerOffset || null,
            frameZ80Pointer: parsed.frameZ80Pointer || null,
          });
          continue;
        }
        addRef(streamOffset, ref);
      }
    }
  }

  const staticStreams = [...refsByStream.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([streamOffset, references]) => {
    const parsed = parseStaticStream(rom, mapData, parseHex(streamOffset));
    const existing = commandByOffset.get(streamOffset);
    return {
      id: `static_stream_${streamOffset.replace(/^0x/i, '')}`,
      offset: streamOffset,
      region: parsed.streamRegion,
      command: {
        commandOffset: streamOffset,
        control: '0x00',
        delay: 0,
        hasMotionWords: false,
        framePointerOffset: parsed.framePointerOffset,
        frameZ80Pointer: parsed.frameZ80Pointer,
        frameOffset: parsed.frame.frameOffset,
        frameRegion: parsed.frame.region,
      },
      frame: parsed.frame,
      selectedBy: references,
      selectedByCount: references.length,
      existingCommandStreamCatalogEntry: existing ? {
        offset: existing.offset,
        confidence: existing.confidence,
        termination: existing.termination,
        commandCount: existing.commandCount,
        frameTargetCount: existing.frameTargetCount,
        issueCount: existing.issueCount,
        issueCounts: existing.issueCounts,
      } : null,
      interpretation: existing
        ? 'static_prefix_of_existing_command_stream_parse'
        : 'static_stream_not_in_command_stream_catalog',
      confidence: parsed.frame.validStaticFrame ? 'high' : 'low',
      evidence: [
        'Variant pointer target begins with control byte 0x00.',
        '_LABEL_1347_ stores control&0x7F into IX+16 and stores the following frame pointer into IX+12/IX+13.',
        '_LABEL_1330_ returns immediately when IX+16 is zero, so the selected frame remains static and no 0xFF loop terminator is required.',
        'Frame target terminates with 0x80 under _LABEL_792_ frame semantics.',
      ],
    };
  });

  return { staticStreams, invalidCandidates };
}

function groupByFrame(staticStreams) {
  const map = new Map();
  for (const stream of staticStreams) {
    const key = stream.frame.frameOffset;
    if (!map.has(key)) {
      map.set(key, {
        frameOffset: key,
        region: stream.frame.region,
        pieceRecordCount: stream.frame.pieceRecordCount,
        tileByteRange: stream.frame.tileByteRange,
        tileByteSegments: stream.frame.tileByteSegments,
        sourceStaticStreams: [],
        selectedByCount: 0,
      });
    }
    const item = map.get(key);
    item.sourceStaticStreams.push(stream.offset);
    item.selectedByCount += stream.selectedByCount;
  }
  return [...map.values()].sort((a, b) => a.frameOffset.localeCompare(b.frameOffset)).map(item => ({
    ...item,
    sourceStaticStreams: [...new Set(item.sourceStaticStreams)].sort(),
  }));
}

function summarizeByRoot(staticStreams) {
  const counts = new Map();
  for (const stream of staticStreams) {
    for (const ref of stream.selectedBy || []) {
      const key = ref.childTable.rootEntry;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([rootEntry, staticSelections]) => ({
    rootEntry,
    selector: hexByte(rootEntry),
    staticSelections,
  }));
}

function buildCatalog(rom, mapData) {
  const rootCatalog = requireCatalog(mapData, 'animationRootSemanticsCatalogs', 'world-animation-root-semantics-catalog-2026-06-25');
  const commandCatalog = requireCatalog(mapData, 'animationCommandStreamCatalogs', 'world-animation-command-stream-catalog-2026-06-25');
  const { staticStreams, invalidCandidates } = collectStaticCandidates(rom, mapData, rootCatalog, commandCatalog);
  const frameTargets = groupByFrame(staticStreams);
  const existingCommandOffsets = staticStreams.filter(stream => stream.existingCommandStreamCatalogEntry).length;
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [rootCatalog.id, commandCatalog.id],
    assetPolicy: 'Metadata only: selector paths, pointer offsets, stream/frame offsets, aggregate frame tile-byte ranges, counts, region ids, and evidence. No ROM bytes, decoded sprites, graphics, audio, or text payloads are embedded.',
    semantics: {
      staticStreamShape: 'A static stream is variant pointer -> control byte 0x00 -> one bank-6 frame pointer.',
      runtimeReason: '_LABEL_1347_ writes IX+16=0 for control 0x00; _LABEL_1330_ exits while IX+16 is zero, so the frame remains static without a loop terminator.',
      frameConsumer: '_LABEL_792_ consumes the frame pointer and terminates frame streams on 0x80.',
      caution: 'This catalog does not replace looping/multi-command streams. It records zero-delay static selections reached through root/child/variant pointer tables.',
    },
    staticStreams,
    frameTargets,
    invalidCandidates,
    summary: {
      staticSelectionCount: staticStreams.reduce((sum, stream) => sum + stream.selectedByCount, 0),
      uniqueStaticStreams: staticStreams.length,
      uniqueFrameTargets: frameTargets.length,
      existingCommandCatalogStaticPrefixes: existingCommandOffsets,
      newStaticStreamsNotInCommandCatalog: staticStreams.length - existingCommandOffsets,
      invalidCandidateCount: invalidCandidates.length,
      rootSelectionCounts: summarizeByRoot(staticStreams),
      assetPolicy: 'Metadata only: no ROM bytes, decoded sprites, graphics, audio, or text payloads are embedded.',
    },
  };
}

function compactStaticRef(stream) {
  return {
    catalogId,
    id: stream.id,
    offset: stream.offset,
    selectedByCount: stream.selectedByCount,
    selectorSamples: stream.selectedBy.slice(0, 12).map(ref => ({
      selectorPair: ref.childEntry.selectorPair,
      variantIndex: ref.variantIndex,
      childTable: ref.childTable.label,
      variantPointerOffset: ref.variantPointerOffset,
    })),
    frameOffset: stream.frame.frameOffset,
    framePieceRecordCount: stream.frame.pieceRecordCount,
    frameTileByteRange: stream.frame.tileByteRange,
    existingCommandStreamCatalogEntry: stream.existingCommandStreamCatalogEntry,
    interpretation: stream.interpretation,
    confidence: stream.confidence,
  };
}

function compactFrameRef(frame) {
  return {
    catalogId,
    frameOffset: frame.frameOffset,
    pieceRecordCount: frame.pieceRecordCount,
    tileByteRange: frame.tileByteRange,
    tileByteSegments: frame.tileByteSegments,
    sourceStaticStreams: frame.sourceStaticStreams,
    selectedByCount: frame.selectedByCount,
    confidence: 'high',
  };
}

function compactVariantRef(stream) {
  return stream.selectedBy.slice(0, 24).map(ref => ({
    catalogId,
    staticStreamOffset: stream.offset,
    frameOffset: stream.frame.frameOffset,
    selectorPair: ref.childEntry.selectorPair,
    variantIndex: ref.variantIndex,
    variantPointerOffset: ref.variantPointerOffset,
    confidence: stream.confidence,
  }));
}

function annotateMap(mapData, catalog) {
  const refsByRegion = new Map();
  const missingRegions = [];

  function addRef(regionLike, fallbackOffset, key, ref) {
    let region = regionLike?.id ? findRegionById(mapData, regionLike.id) : null;
    if (!region && fallbackOffset) region = findContainingRegion(mapData, parseHex(fallbackOffset));
    if (!region) {
      missingRegions.push({ key, fallbackOffset, refId: ref.id || ref.frameOffset || ref.staticStreamOffset || null });
      return;
    }
    if (!refsByRegion.has(region.id)) {
      refsByRegion.set(region.id, {
        region,
        refs: {
          staticStreams: [],
          frameTargets: [],
          variantSources: [],
        },
      });
    }
    refsByRegion.get(region.id).refs[key].push(ref);
  }

  for (const stream of catalog.staticStreams) {
    addRef(stream.region, stream.offset, 'staticStreams', compactStaticRef(stream));
    for (const ref of compactVariantRef(stream)) {
      const selected = (stream.selectedBy || []).find(item => item.variantPointerOffset === ref.variantPointerOffset && item.childEntry.selectorPair.child === ref.selectorPair.child);
      addRef(selected?.childEntry.region, selected?.childEntry.romOffset, 'variantSources', ref);
    }
  }

  for (const frame of catalog.frameTargets) {
    addRef(frame.region, frame.frameOffset, 'frameTargets', compactFrameRef(frame));
  }

  const annotatedRegions = [];
  for (const { region, refs } of refsByRegion.values()) {
    region.analysis = region.analysis || {};
    const existing = region.analysis.animationStaticStreamAudit || {};
    const existingStatic = (existing.staticStreams || []).filter(ref => ref.catalogId !== catalogId);
    const existingFrames = (existing.frameTargets || []).filter(ref => ref.catalogId !== catalogId);
    const existingVariants = (existing.variantSources || []).filter(ref => ref.catalogId !== catalogId);
    const kind = refs.staticStreams.length
      ? 'animation_static_stream_region'
      : refs.frameTargets.length
        ? 'animation_static_frame_target_region'
        : 'animation_static_variant_source_region';
    region.analysis.animationStaticStreamAudit = {
      kind,
      catalogId,
      confidence: [...refs.staticStreams, ...refs.frameTargets, ...refs.variantSources].some(ref => ref.confidence === 'low') ? 'low' : 'high',
      summary: refs.staticStreams.length
        ? 'Region contains zero-delay static animation streams selected through root/child/variant pointer tables.'
        : refs.frameTargets.length
          ? 'Region contains frame streams used by zero-delay static animation streams.'
          : 'Region contains variant pointer entries that select zero-delay static animation streams.',
      staticStreams: [...existingStatic, ...refs.staticStreams].slice(0, 64),
      frameTargets: [...existingFrames, ...refs.frameTargets].slice(0, 64),
      variantSources: [...existingVariants, ...refs.variantSources].slice(0, 64),
      evidence: [
        '_LABEL_1347_ writes IX+16=0 for control byte 0x00 and stores the following frame pointer into IX+12/IX+13.',
        '_LABEL_1330_ returns immediately while IX+16 is zero, so these selections are static frames rather than fall-through command streams.',
        '_LABEL_792_ frame streams terminate on 0x80; this audit stores only aggregate metadata and offsets.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      staticStreamRefs: refs.staticStreams.length,
      frameTargetRefs: refs.frameTargets.length,
      variantSourceRefs: refs.variantSources.length,
    });
  }
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
    mapData.animationStaticStreamCatalogs = (mapData.animationStaticStreamCatalogs || []).filter(item => item.id !== catalogId);
    mapData.animationStaticStreamCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'animation_static_stream_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: finalCatalog.sourceCatalogs,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotation.annotatedRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      semantics: finalCatalog.semantics,
      staticStreamSamples: finalCatalog.staticStreams.slice(0, 96),
      frameTargets: finalCatalog.frameTargets,
      invalidCandidates: finalCatalog.invalidCandidates,
      annotatedRegions: annotation.annotatedRegions,
      missingRegions: annotation.missingRegions,
      nextLeads: [
        'Use static stream entries to correct low-confidence command-stream fall-through warnings where the selected control byte is 0x00.',
        'Link static stream tile-byte ranges with tile-base provenance when callers provide IX+63 or fixed actor slot bases.',
        'Surface static stream frame targets in the browser sprite preview and flag unresolved VRAM tile coverage per scene.',
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
