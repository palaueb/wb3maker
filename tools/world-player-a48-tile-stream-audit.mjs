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
const toolName = 'tools/world-player-a48-tile-stream-audit.mjs';
const catalogId = 'world-player-a48-tile-stream-catalog-2026-06-26';
const reportId = 'player-a48-tile-stream-audit-2026-06-26';

const rootSemanticsCatalogId = 'world-animation-root-semantics-catalog-2026-06-25';
const remainingLeadCatalogId = 'world-graphics-remaining-lead-reconciliation-catalog-2026-06-26';

const BANK6_START = 0x18000;
const BANK6_END_EXCLUSIVE = 0x1C000;
const MAX_PLAYER_COMMANDS = 256;
const MAX_A48_RECORDS = 512;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function hexByte(value) {
  return hex(value & 0xFF, 2);
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 16);
  return NaN;
}

function readWordLE(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function isBank6Z80Pointer(value) {
  return value >= 0x8000 && value < 0xC000;
}

function bank6Z80ToRom(value) {
  return isBank6Z80Pointer(value) ? value + 0x10000 : null;
}

function bankedZ80ToRom(bank, z80Address) {
  if (z80Address < 0x8000 || z80Address > 0xBFFF) return null;
  return bank * 0x4000 + (z80Address - 0x8000);
}

function isBank6Offset(offset) {
  return offset >= BANK6_START && offset < BANK6_END_EXCLUSIVE;
}

function offsetOf(region) {
  return parseOffset(region.offset);
}

function endOf(region) {
  return offsetOf(region) + Number(region.size || 0);
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= offsetOf(region) && offset < endOf(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && (item.id === id || item.reportId === id));
    if (found) return found;
  }
  return null;
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

function uniqueSorted(values) {
  return [...new Set(values.filter(value => value != null))].sort((a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
  });
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.endExclusive) && item.endExclusive > item.start)
    .sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.endExclusive) {
      merged.push({ start: interval.start, endExclusive: interval.endExclusive });
    } else if (interval.endExclusive > last.endExclusive) {
      last.endExclusive = interval.endExclusive;
    }
  }
  return merged;
}

function overlapRange(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(aStart, bStart);
  const endExclusive = Math.min(aEnd, bEnd);
  return start < endExclusive ? { start, endExclusive } : null;
}

function intervalBytes(intervals) {
  return mergeIntervals(intervals).reduce((sum, item) => sum + item.endExclusive - item.start, 0);
}

function sourceWordToSpan(mapData, sourceWord, tileBlocks) {
  const sourceBank = sourceWord >>> 9;
  const tileIndex = sourceWord & 0x01FF;
  const sourceZ80Address = 0x8000 + tileIndex * 32;
  const sourceRomOffset = bankedZ80ToRom(sourceBank, sourceZ80Address);
  const byteCount = tileBlocks * 32;
  const sourceRegion = sourceRomOffset == null ? null : findContainingRegion(mapData, sourceRomOffset);
  return {
    sourceBank,
    sourceTileIndex: tileIndex,
    sourceZ80Address,
    sourceRomOffset,
    sourceEndExclusive: sourceRomOffset == null ? null : sourceRomOffset + byteCount,
    byteCount,
    sourceRegion,
  };
}

function pointerRef(mapData, rom, pointerOffset) {
  const z80Pointer = readWordLE(rom, pointerOffset);
  const romOffset = bank6Z80ToRom(z80Pointer);
  return {
    pointerOffset: hex(pointerOffset),
    z80Pointer: hex(z80Pointer, 4),
    romOffset: romOffset == null ? null : hex(romOffset),
    bank6Pointer: romOffset != null && isBank6Offset(romOffset),
    region: romOffset == null ? null : regionRef(findContainingRegion(mapData, romOffset)),
  };
}

function collectPlayerVariantStreams(rom, mapData, rootSemantics) {
  const playerTable = (rootSemantics.childTables || []).find(table => table.rootEntry === 0 && table.playerAccessible);
  const variants = [];
  if (!playerTable) return variants;

  for (const formEntry of playerTable.entries || []) {
    const prefix = formEntry.variantPrefix;
    const prefixOffset = parseOffset(formEntry.romOffset);
    const entryCount = Number(prefix?.entryCount || 0);
    if (!Number.isFinite(prefixOffset) || entryCount <= 0) continue;
    for (let variantIndex = 0; variantIndex < entryCount; variantIndex++) {
      const variantPointerOffset = prefixOffset + variantIndex * 2;
      if (variantPointerOffset + 1 >= rom.length) continue;
      const z80Pointer = readWordLE(rom, variantPointerOffset);
      const streamRomOffset = bank6Z80ToRom(z80Pointer);
      variants.push({
        formIndex: formEntry.index,
        formEntryOffset: formEntry.entryOffset,
        formEntryRegion: formEntry.region || regionRef(findContainingRegion(mapData, prefixOffset)),
        variantIndex,
        variantPointerOffset: hex(variantPointerOffset),
        streamZ80Pointer: hex(z80Pointer, 4),
        streamRomOffset: streamRomOffset == null ? null : hex(streamRomOffset),
        streamRegion: streamRomOffset == null ? null : regionRef(findContainingRegion(mapData, streamRomOffset)),
        bank6Pointer: streamRomOffset != null && isBank6Offset(streamRomOffset),
      });
    }
  }

  return variants;
}

function issue(kind, severity, detail = {}) {
  return { kind, severity, ...detail };
}

function parsePlayerCommandStream(rom, mapData, startOffset) {
  const commands = [];
  const jumps = [];
  const frameTargets = [];
  const a48Targets = [];
  const issues = [];
  const visited = new Set();
  let cursor = startOffset;
  let termination = null;

  for (let commandIndex = 0; commandIndex < MAX_PLAYER_COMMANDS; commandIndex++) {
    if (!isBank6Offset(cursor) || cursor >= rom.length) {
      termination = { kind: 'left_bank6_range', normal: false, atOffset: hex(cursor) };
      issues.push(issue('left_bank6_range', 'high', { atOffset: hex(cursor) }));
      break;
    }
    if (visited.has(cursor)) {
      termination = { kind: 'fell_into_visited_offset', normal: false, atOffset: hex(cursor) };
      issues.push(issue('fell_into_visited_offset', 'medium', { atOffset: hex(cursor) }));
      break;
    }
    visited.add(cursor);

    const commandOffset = cursor;
    const control = rom[cursor++];
    if (control === 0xFF) {
      if (cursor + 1 >= rom.length) {
        termination = { kind: 'truncated_jump', normal: false, atOffset: hex(commandOffset) };
        issues.push(issue('truncated_jump', 'high', { commandOffset: hex(commandOffset) }));
        break;
      }
      const pointerOffset = cursor;
      const jumpPointer = pointerRef(mapData, rom, pointerOffset);
      cursor += 2;
      const target = jumpPointer.romOffset == null ? null : parseOffset(jumpPointer.romOffset);
      const jump = {
        commandOffset: hex(commandOffset),
        pointerOffset: hex(pointerOffset),
        z80Pointer: jumpPointer.z80Pointer,
        romOffset: jumpPointer.romOffset,
        region: jumpPointer.region,
      };
      jumps.push(jump);
      if (target == null || !isBank6Offset(target)) {
        termination = {
          kind: 'invalid_jump_pointer',
          normal: false,
          atOffset: hex(commandOffset),
          z80Pointer: jumpPointer.z80Pointer,
        };
        issues.push(issue('invalid_jump_pointer', 'high', jump));
        break;
      }
      if (visited.has(target)) {
        termination = {
          kind: 'loop_jump',
          normal: true,
          atOffset: hex(commandOffset),
          loopTarget: hex(target),
          z80Pointer: jumpPointer.z80Pointer,
        };
        break;
      }
      cursor = target;
      continue;
    }

    const hasPlayerStateBlocks = (control & 0x80) !== 0;
    const command = {
      index: commands.length,
      commandOffset: hex(commandOffset),
      control: hexByte(control),
      delay: control & 0x7F,
      hasPlayerStateBlocks,
      stateBlockByteCount: hasPlayerStateBlocks ? 8 : 0,
    };

    if (hasPlayerStateBlocks) {
      if (cursor + 7 >= rom.length || !isBank6Offset(cursor + 7)) {
        termination = { kind: 'truncated_player_state_blocks', normal: false, atOffset: hex(commandOffset) };
        issues.push(issue('truncated_player_state_blocks', 'high', { commandOffset: hex(commandOffset), stateBlockOffset: hex(cursor) }));
        break;
      }
      command.stateBlockOffsets = [hex(cursor), hex(cursor + 4)];
      cursor += 8;
    }

    if (cursor + 3 >= rom.length || !isBank6Offset(cursor + 3)) {
      termination = { kind: 'truncated_player_frame_or_a48_pointer', normal: false, atOffset: hex(commandOffset) };
      issues.push(issue('truncated_player_frame_or_a48_pointer', 'high', { commandOffset: hex(commandOffset), pointerOffset: hex(cursor) }));
      break;
    }

    command.framePointer = pointerRef(mapData, rom, cursor);
    cursor += 2;
    command.a48TileStreamPointer = pointerRef(mapData, rom, cursor);
    cursor += 2;
    command.nextCommandOffset = hex(cursor);
    commands.push(command);

    if (command.framePointer.bank6Pointer) {
      frameTargets.push({
        sourceCommandOffset: hex(commandOffset),
        pointerOffset: command.framePointer.pointerOffset,
        z80Pointer: command.framePointer.z80Pointer,
        romOffset: command.framePointer.romOffset,
        region: command.framePointer.region,
      });
    } else {
      issues.push(issue('non_bank6_frame_pointer', 'medium', {
        sourceCommandOffset: hex(commandOffset),
        pointerOffset: command.framePointer.pointerOffset,
        z80Pointer: command.framePointer.z80Pointer,
      }));
    }

    if (command.a48TileStreamPointer.bank6Pointer) {
      a48Targets.push({
        sourceCommandOffset: hex(commandOffset),
        pointerOffset: command.a48TileStreamPointer.pointerOffset,
        z80Pointer: command.a48TileStreamPointer.z80Pointer,
        romOffset: command.a48TileStreamPointer.romOffset,
        region: command.a48TileStreamPointer.region,
      });
    } else {
      issues.push(issue('non_bank6_a48_tile_stream_pointer', 'medium', {
        sourceCommandOffset: hex(commandOffset),
        pointerOffset: command.a48TileStreamPointer.pointerOffset,
        z80Pointer: command.a48TileStreamPointer.z80Pointer,
      }));
    }
  }

  if (!termination) {
    termination = { kind: 'command_limit_reached', normal: false, commandLimit: MAX_PLAYER_COMMANDS };
    issues.push(issue('command_limit_reached', 'high', { commandLimit: MAX_PLAYER_COMMANDS }));
  }

  return {
    streamOffset: hex(startOffset),
    streamRegion: regionRef(findContainingRegion(mapData, startOffset)),
    termination,
    commandCount: commands.length,
    jumpCount: jumps.length,
    frameTargetCount: frameTargets.length,
    a48TargetCount: a48Targets.length,
    issueCount: issues.length,
    issueCounts: countBy(issues, item => item.kind),
    commands,
    jumps,
    frameTargets,
    a48Targets,
    issues,
    confidence: termination.normal && issues.length === 0 ? 'high' : termination.normal ? 'medium' : 'low',
  };
}

function parseA48TileStream(rom, mapData, startOffset) {
  const records = [];
  const sourceSpans = [];
  const issues = [];
  let cursor = startOffset;
  let terminated = false;
  let zeroFillTileBlocks = 0;
  let sourceRecordCount = 0;
  let invalidSourceRecordCount = 0;
  let totalTileBlocks = 0;
  let vramSlotIfC27fZero = 0;
  let vramSlotIfC27fNonzero = 16;

  for (let recordIndex = 0; recordIndex < MAX_A48_RECORDS; recordIndex++) {
    if (!isBank6Offset(cursor) || cursor >= rom.length) {
      issues.push(issue('left_bank6_range', 'high', { atOffset: hex(cursor) }));
      break;
    }
    const recordOffset = cursor;
    const opcode = rom[cursor++];
    if (opcode === 0x00) {
      terminated = true;
      break;
    }

    if (opcode === 0xFF) {
      const record = {
        index: records.length,
        recordOffset: hex(recordOffset),
        kind: 'zero_fill_tile_block',
        opcode: '0xFF',
        tileBlocks: 1,
        vramTileRangeIfC27fZero: { start: hex(vramSlotIfC27fZero, 3), endInclusive: hex(vramSlotIfC27fZero, 3), count: 1 },
        vramTileRangeIfC27fNonzero: { start: hex(vramSlotIfC27fNonzero, 3), endInclusive: hex(vramSlotIfC27fNonzero, 3), count: 1 },
      };
      records.push(record);
      zeroFillTileBlocks++;
      totalTileBlocks++;
      vramSlotIfC27fZero++;
      vramSlotIfC27fNonzero++;
      continue;
    }

    if (cursor + 1 >= rom.length || !isBank6Offset(cursor + 1)) {
      issues.push(issue('truncated_source_word', 'high', { recordOffset: hex(recordOffset), sourceWordOffset: hex(cursor) }));
      break;
    }

    const sourceWordOffset = cursor;
    const sourceWord = readWordLE(rom, cursor);
    cursor += 2;
    const tileBlocks = opcode;
    const span = sourceWordToSpan(mapData, sourceWord, tileBlocks);
    const sourceInRom = (
      span.sourceRomOffset != null &&
      span.sourceRomOffset >= 0 &&
      span.sourceEndExclusive != null &&
      span.sourceEndExclusive <= rom.length
    );
    const sourceSpan = {
      sourceWordOffset: hex(sourceWordOffset),
      sourceWord: hex(sourceWord, 4),
      sourceBank: span.sourceBank,
      sourceTileIndex: span.sourceTileIndex,
      sourceZ80Address: hex(span.sourceZ80Address, 4),
      sourceRomOffset: span.sourceRomOffset == null ? null : hex(span.sourceRomOffset),
      sourceEndExclusive: span.sourceEndExclusive == null ? null : hex(span.sourceEndExclusive),
      byteCount: span.byteCount,
      tileBlocks,
      sourceRegion: regionRef(span.sourceRegion),
      sourceInRom,
    };
    if (sourceInRom) {
      sourceSpans.push(sourceSpan);
    } else {
      invalidSourceRecordCount++;
      issues.push(issue('invalid_source_range', 'high', {
        recordOffset: hex(recordOffset),
        sourceWordOffset: hex(sourceWordOffset),
        sourceWord: hex(sourceWord, 4),
        sourceBank: span.sourceBank,
        sourceRomOffset: sourceSpan.sourceRomOffset,
        sourceEndExclusive: sourceSpan.sourceEndExclusive,
        byteCount: span.byteCount,
      }));
    }
    records.push({
      index: records.length,
      recordOffset: hex(recordOffset),
      kind: 'source_tile_copy',
      opcode: hexByte(opcode),
      tileBlocks,
      sourceWordOffset: hex(sourceWordOffset),
      sourceWord: hex(sourceWord, 4),
      sourceBank: span.sourceBank,
      sourceTileIndex: span.sourceTileIndex,
      sourceRomOffset: sourceSpan.sourceRomOffset,
      sourceRegionId: span.sourceRegion?.id || null,
      sourceInRom,
      vramTileRangeIfC27fZero: {
        start: hex(vramSlotIfC27fZero, 3),
        endInclusive: hex(vramSlotIfC27fZero + tileBlocks - 1, 3),
        count: tileBlocks,
      },
      vramTileRangeIfC27fNonzero: {
        start: hex(vramSlotIfC27fNonzero, 3),
        endInclusive: hex(vramSlotIfC27fNonzero + tileBlocks - 1, 3),
        count: tileBlocks,
      },
    });
    sourceRecordCount++;
    totalTileBlocks += tileBlocks;
    vramSlotIfC27fZero += tileBlocks;
    vramSlotIfC27fNonzero += tileBlocks;
  }

  if (!terminated && !issues.some(item => item.kind === 'command_limit_reached')) {
    if (records.length >= MAX_A48_RECORDS) issues.push(issue('record_limit_reached', 'high', { recordLimit: MAX_A48_RECORDS }));
  }

  const sourceBanks = uniqueSorted(sourceSpans.map(span => span.sourceBank));
  const sourceRegionIds = uniqueSorted(sourceSpans.map(span => span.sourceRegion?.id));
  const sourceIntervals = sourceSpans
    .map(span => ({ start: parseOffset(span.sourceRomOffset), endExclusive: parseOffset(span.sourceEndExclusive) }))
    .filter(span => Number.isFinite(span.start) && Number.isFinite(span.endExclusive));

  return {
    streamOffset: hex(startOffset),
    streamRegion: regionRef(findContainingRegion(mapData, startOffset)),
    consumedBytes: cursor - startOffset,
    endInclusive: hex(cursor - 1),
    terminated,
    recordCount: records.length,
    sourceRecordCount,
    invalidSourceRecordCount,
    zeroFillTileBlocks,
    totalTileBlocks,
    sourceBanks,
    sourceRegionIds,
    uniqueSourceBytes: intervalBytes(sourceIntervals),
    finalVramTileIfC27fZeroExclusive: hex(vramSlotIfC27fZero, 3),
    finalVramTileIfC27fNonzeroExclusive: hex(vramSlotIfC27fNonzero, 3),
    issueCount: issues.length,
    issueCounts: countBy(issues, item => item.kind),
    issues,
    sourceSpans,
    recordPreview: records.slice(0, 12),
    confidence: terminated && issues.length === 0 ? 'high' : terminated ? 'medium' : 'low',
  };
}

function buildSourceRegionSummaries(mapData, sourceIntervals) {
  const byRegion = new Map();
  for (const interval of sourceIntervals) {
    for (const region of mapData.regions || []) {
      if ((region.type || '') !== 'gfx_tiles') continue;
      const overlap = overlapRange(interval.start, interval.endExclusive, offsetOf(region), endOf(region));
      if (!overlap) continue;
      if (!byRegion.has(region.id)) byRegion.set(region.id, { region, overlaps: [] });
      byRegion.get(region.id).overlaps.push(overlap);
    }
  }
  return [...byRegion.values()]
    .map(item => {
      const merged = mergeIntervals(item.overlaps);
      return {
        region: regionRef(item.region),
        uniqueBytes: intervalBytes(merged),
        tileBlocks: Math.ceil(intervalBytes(merged) / 32),
        spanCount: merged.length,
        spans: merged.slice(0, 32).map(span => ({
          start: hex(span.start),
          endExclusive: hex(span.endExclusive),
          sizeBytes: span.endExclusive - span.start,
        })),
      };
    })
    .sort((a, b) => parseOffset(a.region.offset) - parseOffset(b.region.offset));
}

function buildRemainingLeadOverlaps(remainingCatalog, sourceIntervals) {
  const overlaps = [];
  for (const lead of remainingCatalog?.entries || []) {
    const leadStart = parseOffset(lead.start);
    const leadEnd = parseOffset(lead.endExclusive);
    if (!Number.isFinite(leadStart) || !Number.isFinite(leadEnd)) continue;
    const clipped = sourceIntervals
      .map(interval => overlapRange(interval.start, interval.endExclusive, leadStart, leadEnd))
      .filter(Boolean);
    const merged = mergeIntervals(clipped);
    const uniqueBytes = intervalBytes(merged);
    if (uniqueBytes <= 0) continue;
    overlaps.push({
      leadId: lead.id,
      spanId: lead.spanId,
      region: lead.region || null,
      leadStart: lead.start,
      leadEndExclusive: lead.endExclusive,
      uniqueBytes,
      tileBlocks: Math.ceil(uniqueBytes / 32),
      priorityGroup: lead.classification?.priorityGroup || null,
      priorClassification: lead.classification || null,
      overlaps: merged.slice(0, 24).map(span => ({
        start: hex(span.start),
        endExclusive: hex(span.endExclusive),
        sizeBytes: span.endExclusive - span.start,
      })),
    });
  }
  return overlaps.sort((a, b) => b.uniqueBytes - a.uniqueBytes || String(a.leadId).localeCompare(String(b.leadId)));
}

function compactCommandStream(stream) {
  return {
    streamOffset: stream.streamOffset,
    streamRegion: stream.streamRegion,
    selectedByCount: stream.selectedByCount,
    selectedBy: stream.selectedBy.slice(0, 24),
    confidence: stream.confidence,
    termination: stream.termination,
    commandCount: stream.commandCount,
    jumpCount: stream.jumpCount,
    frameTargetCount: stream.frameTargetCount,
    a48TargetCount: stream.a48TargetCount,
    issueCount: stream.issueCount,
    issueCounts: stream.issueCounts,
    frameTargets: stream.frameTargets.slice(0, 24),
    a48Targets: stream.a48Targets.slice(0, 24),
    commandPreview: stream.commands.slice(0, 8).map(command => ({
      index: command.index,
      commandOffset: command.commandOffset,
      control: command.control,
      delay: command.delay,
      hasPlayerStateBlocks: command.hasPlayerStateBlocks,
      stateBlockOffsets: command.stateBlockOffsets || [],
      framePointer: command.framePointer,
      a48TileStreamPointer: command.a48TileStreamPointer,
      nextCommandOffset: command.nextCommandOffset,
    })),
  };
}

function compactA48Stream(stream) {
  return {
    streamOffset: stream.streamOffset,
    streamRegion: stream.streamRegion,
    referencedByCount: stream.referencedBy.length,
    referencedBy: stream.referencedBy.slice(0, 32),
    referencedByConfidences: stream.referencedByConfidences,
    hasHighConfidenceCommandReference: stream.hasHighConfidenceCommandReference,
    confidence: stream.confidence,
    consumedBytes: stream.consumedBytes,
    endInclusive: stream.endInclusive,
    terminated: stream.terminated,
    recordCount: stream.recordCount,
    sourceRecordCount: stream.sourceRecordCount,
    invalidSourceRecordCount: stream.invalidSourceRecordCount,
    zeroFillTileBlocks: stream.zeroFillTileBlocks,
    totalTileBlocks: stream.totalTileBlocks,
    sourceBanks: stream.sourceBanks,
    sourceRegionIds: stream.sourceRegionIds,
    uniqueSourceBytes: stream.uniqueSourceBytes,
    finalVramTileIfC27fZeroExclusive: stream.finalVramTileIfC27fZeroExclusive,
    finalVramTileIfC27fNonzeroExclusive: stream.finalVramTileIfC27fNonzeroExclusive,
    issueCount: stream.issueCount,
    issueCounts: stream.issueCounts,
    recordPreview: stream.recordPreview,
    sourceSpanPreview: stream.sourceSpans.slice(0, 24),
  };
}

function buildCatalog(rom, mapData) {
  const rootSemantics = findCatalog(mapData, rootSemanticsCatalogId);
  if (!rootSemantics) throw new Error(`Missing required catalog ${rootSemanticsCatalogId}`);
  const remainingCatalog = findCatalog(mapData, remainingLeadCatalogId);
  const variants = collectPlayerVariantStreams(rom, mapData, rootSemantics);
  const validVariants = variants.filter(variant => variant.bank6Pointer);
  const commandStreamMap = new Map();

  for (const variant of validVariants) {
    const offset = parseOffset(variant.streamRomOffset);
    const key = hex(offset);
    if (!commandStreamMap.has(key)) {
      commandStreamMap.set(key, {
        ...parsePlayerCommandStream(rom, mapData, offset),
        selectedBy: [],
      });
    }
    commandStreamMap.get(key).selectedBy.push({
      formIndex: variant.formIndex,
      formEntryOffset: variant.formEntryOffset,
      variantIndex: variant.variantIndex,
      variantPointerOffset: variant.variantPointerOffset,
      streamZ80Pointer: variant.streamZ80Pointer,
    });
  }

  const commandStreams = [...commandStreamMap.values()]
    .map(stream => ({ ...stream, selectedByCount: stream.selectedBy.length }))
    .sort((a, b) => parseOffset(a.streamOffset) - parseOffset(b.streamOffset));

  const a48RefMap = new Map();
  for (const stream of commandStreams) {
    for (const target of stream.a48Targets) {
      if (!target.romOffset) continue;
      if (!a48RefMap.has(target.romOffset)) a48RefMap.set(target.romOffset, []);
      a48RefMap.get(target.romOffset).push({
        sourcePlayerCommandStream: stream.streamOffset,
        sourcePlayerCommandStreamConfidence: stream.confidence,
        sourceCommandOffset: target.sourceCommandOffset,
        pointerOffset: target.pointerOffset,
        z80Pointer: target.z80Pointer,
      });
    }
  }

  const a48Streams = [...a48RefMap.entries()]
    .sort((a, b) => parseOffset(a[0]) - parseOffset(b[0]))
    .map(([offset, referencedBy]) => ({
      ...parseA48TileStream(rom, mapData, parseOffset(offset)),
      referencedBy,
      referencedByConfidences: uniqueSorted(referencedBy.map(ref => ref.sourcePlayerCommandStreamConfidence)),
      hasHighConfidenceCommandReference: referencedBy.some(ref => ref.sourcePlayerCommandStreamConfidence === 'high'),
    }));

  const candidateSourceIntervals = a48Streams.flatMap(stream => stream.sourceSpans)
    .map(span => ({ start: parseOffset(span.sourceRomOffset), endExclusive: parseOffset(span.sourceEndExclusive) }))
    .filter(span => Number.isFinite(span.start) && Number.isFinite(span.endExclusive));
  const confirmedA48Streams = a48Streams.filter(stream => stream.confidence === 'high' && stream.hasHighConfidenceCommandReference);
  const sourceIntervals = confirmedA48Streams.flatMap(stream => stream.sourceSpans)
    .map(span => ({ start: parseOffset(span.sourceRomOffset), endExclusive: parseOffset(span.sourceEndExclusive) }))
    .filter(span => Number.isFinite(span.start) && Number.isFinite(span.endExclusive));
  const mergedCandidateSourceIntervals = mergeIntervals(candidateSourceIntervals);
  const mergedSourceIntervals = mergeIntervals(sourceIntervals);
  const sourceGraphicsRegions = buildSourceRegionSummaries(mapData, sourceIntervals);
  const candidateSourceGraphicsRegions = buildSourceRegionSummaries(mapData, candidateSourceIntervals);
  const remainingLeadOverlaps = buildRemainingLeadOverlaps(remainingCatalog, sourceIntervals);
  const issues = [
    ...commandStreams.flatMap(stream => stream.issues.map(item => ({ streamOffset: stream.streamOffset, parser: 'player_command_stream', ...item }))),
    ...a48Streams.flatMap(stream => stream.issues.map(item => ({ streamOffset: stream.streamOffset, parser: 'a48_tile_stream', ...item }))),
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      rootSemanticsCatalogId,
      remainingLeadCatalogId,
    ],
    assetPolicy: 'Metadata only: stream offsets, pointer offsets, decoded record counts, source banks/ranges, VRAM slot ranges, region ids, and overlap summaries. No ROM bytes, decoded graphics, screenshots, hashes, pixels, audio, or text payloads are embedded.',
    semantics: {
      playerStartRoutine: '_LABEL_137C_ selects bank-6 root entry 0, then _RAM_C24F_, then the caller A variant before entering _LABEL_13A6_.',
      playerTickRoutine: '_LABEL_1392_ resumes _RAM_C252_; _LABEL_13A6_ parses player command records, stores the frame pointer in _RAM_C24C_, stores the next command cursor in _RAM_C252_, and calls _LABEL_A48_ with the second pointer.',
      playerCommandShape: 'control byte; if bit 7 is set, two 4-byte player state blocks; then a bank-6 frame/metasprite pointer; then a bank-6 _LABEL_A48_ tile stream pointer; 0xFF plus bank-6 pointer jumps/loops.',
      a48RecordShape: '_LABEL_A48_ terminates on 0x00, writes one zero-filled tile for 0xFF, otherwise treats the byte as a tile-block count followed by a source word whose high bits select the source bank and whose low 9 bits select the source tile.',
      a48VramBase: '_LABEL_A48_ writes to VRAM byte address 0x0000 when _RAM_C27F_ is zero and 0x0200 when _RAM_C27F_ is nonzero, so both tile-slot ranges are recorded until form-specific runtime state is traced.',
    },
    playerVariants: variants,
    playerCommandStreams: commandStreams.map(compactCommandStream),
    a48TileStreams: a48Streams.map(compactA48Stream),
    sourceGraphicsRegions,
    candidateSourceGraphicsRegions,
    remainingLeadOverlaps,
    issues: issues.slice(0, 120),
    summary: {
      playerVariantSelectionCount: variants.length,
      validPlayerVariantSelectionCount: validVariants.length,
      uniquePlayerCommandStreams: commandStreams.length,
      highConfidencePlayerCommandStreams: commandStreams.filter(stream => stream.confidence === 'high').length,
      mediumConfidencePlayerCommandStreams: commandStreams.filter(stream => stream.confidence === 'medium').length,
      lowConfidencePlayerCommandStreams: commandStreams.filter(stream => stream.confidence === 'low').length,
      parsedPlayerCommandCount: commandStreams.reduce((sum, stream) => sum + stream.commandCount, 0),
      playerFramePointerReferences: commandStreams.reduce((sum, stream) => sum + stream.frameTargetCount, 0),
      a48PointerReferences: commandStreams.reduce((sum, stream) => sum + stream.a48TargetCount, 0),
      uniqueA48TileStreams: a48Streams.length,
      confirmedA48TileStreams: confirmedA48Streams.length,
      highConfidenceA48TileStreams: a48Streams.filter(stream => stream.confidence === 'high').length,
      mediumConfidenceA48TileStreams: a48Streams.filter(stream => stream.confidence === 'medium').length,
      lowConfidenceA48TileStreams: a48Streams.filter(stream => stream.confidence === 'low').length,
      a48SourceRecordCount: a48Streams.reduce((sum, stream) => sum + stream.sourceRecordCount, 0),
      a48InvalidSourceRecordCount: a48Streams.reduce((sum, stream) => sum + stream.invalidSourceRecordCount, 0),
      a48ZeroFillTileBlocks: a48Streams.reduce((sum, stream) => sum + stream.zeroFillTileBlocks, 0),
      a48TotalTileBlocks: a48Streams.reduce((sum, stream) => sum + stream.totalTileBlocks, 0),
      sourceBanks: uniqueSorted(confirmedA48Streams.flatMap(stream => stream.sourceBanks)),
      candidateSourceBanks: uniqueSorted(a48Streams.flatMap(stream => stream.sourceBanks)),
      sourceGraphicsRegionCount: sourceGraphicsRegions.length,
      sourceGraphicsRegionIds: sourceGraphicsRegions.map(summary => summary.region.id),
      uniqueSourceBytes: intervalBytes(mergedSourceIntervals),
      candidateSourceGraphicsRegionCount: candidateSourceGraphicsRegions.length,
      candidateSourceGraphicsRegionIds: candidateSourceGraphicsRegions.map(summary => summary.region.id),
      candidateUniqueSourceBytes: intervalBytes(mergedCandidateSourceIntervals),
      remainingLeadOverlapCount: remainingLeadOverlaps.length,
      remainingLeadOverlapBytes: remainingLeadOverlaps.reduce((sum, overlap) => sum + overlap.uniqueBytes, 0),
      issueCount: issues.length,
      issueCounts: countBy(issues, item => `${item.parser}:${item.kind}`),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: no ROM bytes, decoded graphics, screenshots, hashes, pixels, audio, or text payloads are embedded.',
    },
    evidence: [
      'ASM lines 3768-3783 show _LABEL_137C_ selecting bank 6 root entry 0, _RAM_C24F_, and caller A before entering _LABEL_13A6_.',
      'ASM lines 3794-3839 show _LABEL_13A6_ parsing player command records, storing _RAM_C24C_ and _RAM_C252_, exchanging DE/HL, then calling _LABEL_A48_.',
      'ASM lines 2391-2452 show _LABEL_A48_ stream semantics: 0x00 terminates, 0xFF writes one zero tile, otherwise count/source-word records copy source tile bytes to VDP.',
      'ASM lines 2429-2440 derive the source bank from the high source-word byte and derive the banked source address with _LABEL_B8F_.',
    ],
    nextLeads: [
      'Trace _RAM_C27F_ writes around player form/transition states to resolve which A48 VRAM base applies to each form command.',
      'Feed player A48 source ranges into the combined graphics source coverage audit so bank-11/player-form tiles stop appearing as unreferenced when this path covers them.',
      'Join player frame pointers, A48 tile ranges, and _RAM_C24F_ form selectors into browser-local player form sprite previews without embedding decoded assets.',
    ],
  };
}

function appendNote(region, note) {
  if (!note) return;
  const current = region.notes || '';
  if (current.includes(note)) return;
  region.notes = current ? `${current} ${note}` : note;
}

function groupRefsByRegion(entries, regionGetter, refBuilder) {
  const grouped = new Map();
  const missing = [];
  for (const entry of entries) {
    const regionLike = regionGetter(entry);
    const region = regionLike?.id ? regionLike : null;
    if (!region?.id) {
      missing.push(refBuilder(entry));
      continue;
    }
    if (!grouped.has(region.id)) grouped.set(region.id, []);
    grouped.get(region.id).push(refBuilder(entry));
  }
  return { grouped, missing };
}

function annotateMap(mapData, catalog) {
  for (const region of mapData.regions || []) {
    if (region.analysis?.playerA48CommandStreamAudit?.catalogId === catalogId) {
      delete region.analysis.playerA48CommandStreamAudit;
    }
    if (region.analysis?.playerA48TileStreamAudit?.catalogId === catalogId) {
      delete region.analysis.playerA48TileStreamAudit;
    }
    if (region.analysis?.playerA48RemainingLeadOverlapAudit?.catalogId === catalogId) {
      delete region.analysis.playerA48RemainingLeadOverlapAudit;
    }
  }

  const annotatedRegions = [];
  const missingRegions = [];

  const commandGrouped = groupRefsByRegion(
    catalog.playerCommandStreams,
    stream => stream.streamRegion,
    stream => ({
      catalogId,
      role: 'player_a48_command_stream',
      streamOffset: stream.streamOffset,
      selectedByCount: stream.selectedByCount,
      selectedBy: stream.selectedBy.slice(0, 12),
      confidence: stream.confidence,
      termination: stream.termination,
      commandCount: stream.commandCount,
      frameTargetCount: stream.frameTargetCount,
      a48TargetCount: stream.a48TargetCount,
      issueCount: stream.issueCount,
    }),
  );

  for (const [regionId, refs] of commandGrouped.grouped.entries()) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ regionId, role: 'player_a48_command_stream' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.playerA48CommandStreamAudit = {
      kind: 'player_a48_command_stream_region',
      catalogId,
      confidence: refs.some(ref => ref.confidence === 'low') ? 'low' : refs.some(ref => ref.confidence === 'medium') ? 'medium' : 'high',
      summary: 'Region contains _LABEL_1392_ player/form command streams with explicit _LABEL_A48_ tile-stream pointers.',
      streams: refs.slice(0, 96),
      evidence: [
        '_LABEL_137C_ selects these streams through root entry 0 of _DATA_18718_ and _RAM_C24F_.',
        '_LABEL_13A6_ reads a frame pointer, then an _LABEL_A48_ tile-stream pointer, before saving the next stream cursor.',
        'No ROM bytes, decoded graphics, screenshots, hashes, pixels, audio, or text payloads are embedded.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    appendNote(region, 'Contains player/form animation command records with explicit _LABEL_A48_ tile stream pointers.');
    annotatedRegions.push({ region: regionRef(region), role: 'player_a48_command_stream_region', refs: refs.length });
  }

  const a48Grouped = groupRefsByRegion(
    catalog.a48TileStreams,
    stream => stream.streamRegion,
    stream => ({
      catalogId,
      role: 'player_a48_tile_stream',
      streamOffset: stream.streamOffset,
      referencedByCount: stream.referencedByCount,
      referencedBy: stream.referencedBy.slice(0, 12),
      confidence: stream.confidence,
      consumedBytes: stream.consumedBytes,
      recordCount: stream.recordCount,
      sourceRecordCount: stream.sourceRecordCount,
      invalidSourceRecordCount: stream.invalidSourceRecordCount,
      zeroFillTileBlocks: stream.zeroFillTileBlocks,
      totalTileBlocks: stream.totalTileBlocks,
      sourceBanks: stream.sourceBanks,
      sourceRegionIds: stream.sourceRegionIds,
      uniqueSourceBytes: stream.uniqueSourceBytes,
      issueCount: stream.issueCount,
    }),
  );

  for (const [regionId, refs] of a48Grouped.grouped.entries()) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ regionId, role: 'player_a48_tile_stream' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.playerA48TileStreamAudit = {
      kind: 'player_a48_tile_stream_region',
      catalogId,
      confidence: refs.some(ref => ref.confidence === 'low') ? 'low' : refs.some(ref => ref.confidence === 'medium') ? 'medium' : 'high',
      summary: 'Region contains _LABEL_A48_ player/form tile upload streams referenced from _LABEL_1392_ command records.',
      streams: refs.slice(0, 96),
      evidence: [
        '_LABEL_13A6_ passes the second command pointer to _LABEL_A48_.',
        '_LABEL_A48_ decodes 0x00 terminators, 0xFF zero-fill records, and count/source-word tile-copy records.',
        'No ROM bytes, decoded graphics, screenshots, hashes, pixels, audio, or text payloads are embedded.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    appendNote(region, 'Contains _LABEL_A48_ player/form tile upload streams referenced by player command records.');
    annotatedRegions.push({ region: regionRef(region), role: 'player_a48_tile_stream_region', refs: refs.length });
  }

  for (const summary of catalog.sourceGraphicsRegions || []) {
    const region = findRegionById(mapData, summary.region.id);
    if (!region) {
      missingRegions.push({ regionId: summary.region.id, role: 'player_a48_graphics_source_region' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.playerA48TileStreamAudit = {
      kind: 'player_a48_graphics_source_region',
      catalogId,
      confidence: 'high',
      summary: 'Graphics source bytes referenced by _LABEL_A48_ player/form tile stream records.',
      uniqueBytes: summary.uniqueBytes,
      tileBlocks: summary.tileBlocks,
      spanCount: summary.spanCount,
      spans: summary.spans,
      evidence: [
        '_LABEL_A48_ derives source bank and source tile index from each stream source word before copying tile bytes to VDP.',
        'This annotation records source ranges only as offsets/counts; no ROM bytes or decoded graphics are embedded.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({ region: regionRef(region), role: 'player_a48_graphics_source_region', refs: summary.spanCount });
  }

  for (const overlap of catalog.remainingLeadOverlaps || []) {
    if (!overlap.region?.id) continue;
    const region = findRegionById(mapData, overlap.region.id);
    if (!region) {
      missingRegions.push({ regionId: overlap.region.id, role: 'player_a48_remaining_lead_overlap' });
      continue;
    }
    region.analysis = region.analysis || {};
    const existing = region.analysis.playerA48RemainingLeadOverlapAudit || {};
    const preserved = (existing.overlaps || []).filter(item => item.catalogId !== catalogId);
    region.analysis.playerA48RemainingLeadOverlapAudit = {
      kind: 'player_a48_remaining_graphics_lead_overlap',
      catalogId,
      confidence: 'high',
      summary: 'Previously remaining graphics lead has byte-range overlap with confirmed _LABEL_A48_ player/form tile source records.',
      overlaps: [...preserved, { catalogId, ...overlap }].slice(0, 64),
      evidence: [
        `${remainingLeadCatalogId} identified this span as an unresolved graphics lead before _LABEL_A48_ source-range tracing.`,
        `${catalogId} records _LABEL_A48_ source-word records that overlap this span by offset/count metadata only.`,
      ],
      generatedAt: now,
      tool: toolName,
    };
  }

  return { annotatedRegions, missingRegions: [...missingRegions, ...commandGrouped.missing, ...a48Grouped.missing] };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  let annotation = { annotatedRegions: [], missingRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    const finalCatalog = buildCatalog(rom, mapData);
    mapData.tileSourceCatalogs = (mapData.tileSourceCatalogs || []).filter(item => item.id !== catalogId);
    mapData.tileSourceCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_a48_tile_stream_audit',
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
      sourceGraphicsRegions: finalCatalog.sourceGraphicsRegions,
      remainingLeadOverlaps: finalCatalog.remainingLeadOverlaps,
      annotatedRegions: annotation.annotatedRegions,
      missingRegions: annotation.missingRegions,
      evidence: finalCatalog.evidence,
      nextLeads: finalCatalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    sourceGraphicsRegions: catalog.sourceGraphicsRegions,
    remainingLeadOverlaps: catalog.remainingLeadOverlaps.slice(0, 12),
    annotatedRegions: annotation.annotatedRegions.length,
    missingRegions: annotation.missingRegions.length,
  }, null, 2));
}

main();
