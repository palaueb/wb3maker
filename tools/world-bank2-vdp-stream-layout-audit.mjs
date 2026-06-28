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
const sourceCatalogId = 'world-bank2-vdp-stream-state-catalog-2026-06-25';
const catalogId = 'world-bank2-vdp-stream-layout-catalog-2026-06-25';
const reportId = 'bank2-vdp-stream-layout-audit-2026-06-25';
const toolName = 'tools/world-bank2-vdp-stream-layout-audit.mjs';
const schemaVersion = 4;

const bundleOffset = 0x09AE0;
const bundleEndExclusive = 0x0B3C0;
const bundleEndInclusive = bundleEndExclusive - 1;
const stateRecordPointerRoles = [
  {
    role: 'vdp_draw_pointer_list',
    fieldRole: 'first_pointer_to_vdp_draw_pointer_list',
    destinationRam: '_RAM_D176_',
    consumer: '_LABEL_97D9_/_LABEL_9812_',
  },
  {
    role: 'object_list_pointer',
    fieldRole: 'second_pointer_to_object_list',
    destinationRam: '_RAM_D180_',
    consumer: '_LABEL_9980_',
  },
  {
    role: 'damage_object_list_pointer',
    fieldRole: 'third_pointer_to_damage_object_list',
    destinationRam: '_RAM_D182_',
    consumer: '_LABEL_99A1_',
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readWord(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function bank2Z80ToRom(word) {
  return word >= 0x8000 && word < 0xC000 ? word : null;
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

function addInterval(intervals, kind, start, endExclusive, extra = {}) {
  if (start == null || endExclusive == null || endExclusive <= start) return;
  intervals.push({
    kind,
    start,
    endExclusive,
    size: endExclusive - start,
    ...extra,
  });
}

function parseHex(value) {
  return parseInt(value, 16);
}

function buildIntervals(catalog) {
  const intervals = [];
  addInterval(intervals, 'root_table', bundleOffset, bundleOffset + 12, {
    confidence: 'high',
    source: 'six root words at _DATA_9AE0_',
  });

  for (const table of catalog.stateRecordTables || []) {
    const tableOffset = parseHex(table.tableOffset);
    addInterval(intervals, 'state_pointer_table', tableOffset, tableOffset + table.byteLength, {
      confidence: 'high',
      rootIndex: table.rootIndex,
      entryCount: table.entryCount,
      source: 'root table target consumed through _RAM_D15A_/_RAM_D15D_',
    });
  }

  const seenRecords = new Set();
  for (const table of catalog.stateRecordTables || []) {
    for (const record of table.records || []) {
      const decoded = record.decoded;
      const normalRecord = decoded?.normalRecord;
      if (!normalRecord) continue;
      const start = parseHex(decoded.recordOffset);
      const endExclusive = parseHex(normalRecord.endExclusive);
      const key = `${start}-${endExclusive}`;
      if (seenRecords.has(key)) continue;
      seenRecords.add(key);
      addInterval(intervals, 'state_record', start, endExclusive, {
        confidence: 'high',
        decodedKind: decoded.kind,
        consumedBytes: normalRecord.consumedBytes,
        source: 'state pointer table target decoded by _LABEL_972B_ model',
      });
    }
  }

  const seenRoleTargets = new Set();
  const seenDrawSegments = new Set();
  for (const target of catalog.pointerRoleTargets || []) {
    const decoded = target.decoded;
    if (!decoded) continue;
    const start = parseHex(target.targetOffset);
    const endExclusive = parseHex(decoded.endExclusive);
    const roleKey = `${target.role}|${start}-${endExclusive}`;
    if (!seenRoleTargets.has(roleKey)) {
      seenRoleTargets.add(roleKey);
      addInterval(intervals, target.role, start, endExclusive, {
        confidence: 'high',
        decoder: decoded.decoder,
        referenceCount: target.referenceCount,
        pointerCount: decoded.pointerCount,
        recordCount: decoded.recordCount,
        source: `${target.role} decoded from _LABEL_972B_ pointer-role target`,
      });
    }

    if (target.role !== 'vdp_draw_pointer_list') continue;
    for (const pointer of decoded.pointers || []) {
      const segment = pointer.segment;
      if (!segment) continue;
      const start = parseHex(segment.offset);
      const endExclusive = parseHex(segment.endExclusive);
      const segmentKey = `${start}-${endExclusive}`;
      if (seenDrawSegments.has(segmentKey)) continue;
      seenDrawSegments.add(segmentKey);
      addInterval(intervals, 'vdp_draw_segment', start, endExclusive, {
        confidence: 'high',
        tileWordPairs: segment.tileWordPairs,
        source: 'VDP draw pointer-list target decoded by _LABEL_97D9_/_LABEL_9812_ model',
      });
    }
  }

  return intervals.sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive || a.kind.localeCompare(b.kind));
}

function mergeIntervals(intervals) {
  const merged = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.endExclusive) {
      last.endExclusive = Math.max(last.endExclusive, interval.endExclusive);
      last.size = last.endExclusive - last.start;
      last.kinds.add(interval.kind);
    } else {
      merged.push({
        start: interval.start,
        endExclusive: interval.endExclusive,
        size: interval.size,
        kinds: new Set([interval.kind]),
      });
    }
  }
  return merged.map(item => ({
    startOffset: hex(item.start),
    endOffsetExclusive: hex(item.endExclusive),
    size: item.size,
    kinds: [...item.kinds].sort(),
  }));
}

function collectOverlaps(intervals) {
  const overlaps = [];
  let prev = null;
  for (const interval of intervals) {
    if (prev && interval.start < prev.endExclusive) {
      let kind = 'decoded_interval_overlap';
      if (
        prev.kind === 'state_pointer_table' &&
        interval.kind === 'state_pointer_table' &&
        interval.endExclusive === prev.endExclusive
      ) {
        kind = 'state_pointer_table_suffix_alias';
      } else if (
        prev.start === interval.start &&
        prev.endExclusive === interval.endExclusive &&
        new Set([prev.kind, interval.kind]).has('object_list_pointer') &&
        new Set([prev.kind, interval.kind]).has('damage_object_list_pointer')
      ) {
        kind = 'shared_object_and_damage_list_target';
      }
      overlaps.push({
        kind,
        a: intervalRef(prev),
        b: intervalRef(interval),
        overlapRange: {
          startOffset: hex(Math.max(prev.start, interval.start)),
          endOffsetExclusive: hex(Math.min(prev.endExclusive, interval.endExclusive)),
          size: Math.min(prev.endExclusive, interval.endExclusive) - Math.max(prev.start, interval.start),
        },
      });
    }
    if (!prev || interval.endExclusive > prev.endExclusive) prev = interval;
  }
  return overlaps;
}

function intervalRef(interval) {
  return {
    kind: interval.kind,
    startOffset: hex(interval.start),
    endOffsetExclusive: hex(interval.endExclusive),
    size: interval.size,
  };
}

function findGaps(mergedIntervals) {
  const gaps = [];
  let pos = bundleOffset;
  let previousInterval = null;
  for (const interval of mergedIntervals) {
    const start = parseHex(interval.startOffset);
    const endExclusive = parseHex(interval.endOffsetExclusive);
    if (start > pos) {
      gaps.push({
        start: pos,
        endExclusive: start,
        size: start - pos,
        precedingKinds: previousInterval?.kinds || [],
        followingKinds: interval.kinds || [],
      });
    }
    pos = Math.max(pos, endExclusive);
    previousInterval = interval;
  }
  if (pos < bundleEndExclusive) {
    gaps.push({
      start: pos,
      endExclusive: bundleEndExclusive,
      size: bundleEndExclusive - pos,
      precedingKinds: previousInterval?.kinds || [],
      followingKinds: [],
    });
  }
  return gaps;
}

function decodeStateCandidate(rom, offset, limitInclusive = bundleEndInclusive) {
  let pc = offset;
  let controlCount = 0;
  for (let step = 0; step < 16 && pc <= limitInclusive; step++) {
    const opcode = rom[pc];
    if (opcode < 0xF1) {
      if (pc + 6 > limitInclusive) return null;
      const pointers = stateRecordPointerRoles.map((role, index) => {
        const pointerFieldOffset = pc + 1 + index * 2;
        const z80Pointer = readWord(rom, pointerFieldOffset);
        const targetOffset = bank2Z80ToRom(z80Pointer);
        return {
          ...role,
          pointerFieldOffset: hex(pointerFieldOffset),
          z80Pointer: hex(z80Pointer, 4),
          targetOffset: targetOffset == null ? null : hex(targetOffset),
          validBank2Pointer: targetOffset != null,
        };
      });
      const validPointers = pointers.every(pointer => {
        const word = parseHex(pointer.z80Pointer);
        const romOffset = bank2Z80ToRom(word);
        return romOffset != null && romOffset >= bundleOffset && romOffset <= bundleEndInclusive;
      });
      if (!validPointers) return null;
      return {
        kind: controlCount ? 'control_prefixed_normal_record' : 'normal_record',
        consumedBytes: pc + 7 - offset,
        controlCount,
        normalRecordOffset: hex(pc),
        delayByteOffset: hex(pc),
        pointerRoles: pointers,
      };
    }
    const operandBytes = { 0xFF: 0, 0xFE: 0, 0xFD: 2, 0xFC: 1, 0xFB: 1, 0xFA: 1 }[opcode];
    if (operandBytes == null) return null;
    controlCount++;
    pc += 1 + operandBytes;
  }
  return null;
}

function decodeDrawCandidate(rom, offset, limitInclusive = bundleEndInclusive) {
  let pc = offset;
  if (pc + 1 > limitInclusive) return null;
  pc += 2;
  let tileWordPairs = 0;
  let controlCount = 0;
  for (let step = 0; step < 4096 && pc <= limitInclusive; step++) {
    const byte = rom[pc];
    if (byte < 0xF0) {
      if (pc + 1 > limitInclusive) return null;
      tileWordPairs++;
      pc += 2;
      continue;
    }
    controlCount++;
    pc++;
    if (byte === 0xFF) {
      return { consumedBytes: pc - offset, tileWordPairs, controlCount };
    }
    if (byte === 0xFE) continue;
    if (byte === 0xFD) {
      if (pc > limitInclusive) return null;
      pc++;
      continue;
    }
    if (byte === 0xFC) {
      if (pc + 1 > limitInclusive) return null;
      pc += 2;
      continue;
    }
    if (pc > limitInclusive) return null;
    pc++;
  }
  return null;
}

function decodeObjectListSequenceCandidate(rom, start, endExclusive) {
  let pc = start;
  let listCount = 0;
  let recordCount = 0;
  const recordsByList = [];

  while (pc < endExclusive) {
    const listStart = pc;
    let listRecords = 0;
    let terminated = false;

    while (pc < endExclusive) {
      if (rom[pc] === 0x00) {
        terminated = true;
        pc++;
        break;
      }
      if (pc + 4 > endExclusive) return null;
      listRecords++;
      pc += 4;
    }

    if (!terminated) return null;
    listCount++;
    recordCount += listRecords;
    recordsByList.push({
      startOffset: hex(listStart),
      endOffsetExclusive: hex(pc),
      recordCount: listRecords,
    });
  }

  if (pc !== endExclusive || recordCount === 0) return null;
  return {
    consumedBytes: pc - start,
    listCount,
    recordCount,
    recordsByList,
    terminated: true,
  };
}

function decodeObjectRecordRunCandidate(rom, start, endExclusive) {
  const size = endExclusive - start;
  if (size <= 0 || size % 4 !== 0) return null;
  const recordCount = size / 4;
  for (let index = 0; index < recordCount; index++) {
    if (rom[start + index * 4] === 0x00) return null;
  }
  return {
    consumedBytes: size,
    recordCount,
    terminated: false,
  };
}

function hasObjectListNeighbor(gap) {
  const kinds = new Set([...(gap.precedingKinds || []), ...(gap.followingKinds || [])]);
  return kinds.has('object_list_pointer') || kinds.has('damage_object_list_pointer');
}

function isAllZeroPadding(rom, start, endExclusive) {
  if (endExclusive <= start) return false;
  for (let offset = start; offset < endExclusive; offset++) {
    if (rom[offset] !== 0x00) return false;
  }
  return true;
}

function decodeDrawPointerListCandidate(rom, offset, limitExclusive = bundleEndExclusive) {
  let pc = offset;
  let terminated = false;
  const pointers = [];

  for (let index = 0; index < 128 && pc + 1 < limitExclusive; index++) {
    const z80Pointer = readWord(rom, pc);
    if (z80Pointer === 0x0000) {
      terminated = true;
      pc += 2;
      break;
    }
    const segmentOffset = bank2Z80ToRom(z80Pointer);
    if (segmentOffset == null || segmentOffset < bundleOffset || segmentOffset > bundleEndInclusive) return null;
    const segment = decodeDrawCandidate(rom, segmentOffset);
    if (!segment) return null;
    pointers.push({
      index,
      pointerEntryOffset: hex(pc),
      z80Pointer: hex(z80Pointer, 4),
      segmentOffset: hex(segmentOffset),
      segmentConsumedBytes: segment.consumedBytes,
      segmentTileWordPairs: segment.tileWordPairs,
      segmentControlCount: segment.controlCount,
    });
    pc += 2;
  }

  if (!terminated || !pointers.length) return null;
  return {
    decoder: 'vdp_draw_pointer_list',
    offset: hex(offset),
    endExclusive: hex(pc),
    consumedBytes: pc - offset,
    pointerCount: pointers.length,
    terminated,
    totalSegmentTileWordPairs: pointers.reduce((total, pointer) => total + (pointer.segmentTileWordPairs || 0), 0),
    totalSegmentControlCount: pointers.reduce((total, pointer) => total + (pointer.segmentControlCount || 0), 0),
    pointers,
  };
}

function classifyGap(rom, gap) {
  const state = decodeStateCandidate(rom, gap.start);
  if (state) {
    return {
      class: state.consumedBytes === gap.size
        ? 'unreferenced_exact_state_record_candidate'
        : 'unreferenced_state_record_prefix_candidate',
      confidence: state.consumedBytes === gap.size ? 'medium' : 'low',
      consumedBytes: state.consumedBytes,
      controlCount: state.controlCount,
      stateKind: state.kind,
      normalRecordOffset: state.normalRecordOffset,
      delayByteOffset: state.delayByteOffset,
      pointerRoles: state.pointerRoles,
    };
  }

  const draw = decodeDrawCandidate(rom, gap.start);
  if (draw) {
    return {
      class: draw.consumedBytes === gap.size
        ? 'unreferenced_exact_vdp_draw_segment_candidate'
        : 'unreferenced_vdp_draw_segment_prefix_candidate',
      confidence: draw.consumedBytes === gap.size ? 'medium' : 'low',
      consumedBytes: draw.consumedBytes,
      tileWordPairs: draw.tileWordPairs,
      controlCount: draw.controlCount,
    };
  }

  const objectSequence = decodeObjectListSequenceCandidate(rom, gap.start, gap.endExclusive);
  if (objectSequence) {
    const objectNeighbor = hasObjectListNeighbor(gap);
    return {
      class: objectSequence.consumedBytes === gap.size
        ? 'unreferenced_exact_object_list_sequence_candidate'
        : 'unreferenced_object_list_sequence_prefix_candidate',
      confidence: objectNeighbor ? 'medium' : 'low',
      consumedBytes: objectSequence.consumedBytes,
      objectListCount: objectSequence.listCount,
      objectRecordCount: objectSequence.recordCount,
      objectRecordsByList: objectSequence.recordsByList,
      objectTerminated: objectSequence.terminated,
      neighborObjectListEvidence: objectNeighbor,
    };
  }

  const objectRun = decodeObjectRecordRunCandidate(rom, gap.start, gap.endExclusive);
  if (objectRun && hasObjectListNeighbor(gap)) {
    return {
      class: 'unreferenced_object_record_run_between_object_lists_candidate',
      confidence: 'medium',
      consumedBytes: objectRun.consumedBytes,
      objectListCount: 0,
      objectRecordCount: objectRun.recordCount,
      objectTerminated: false,
      neighborObjectListEvidence: true,
    };
  }

  if (isAllZeroPadding(rom, gap.start, gap.endExclusive)) {
    return {
      class: 'all_zero_padding_gap',
      confidence: 'high',
      consumedBytes: gap.size,
      paddingPattern: 'all_zero',
    };
  }

  return {
    class: 'unclassified_gap',
    confidence: 'low',
  };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sum(items, field) {
  return items.reduce((total, item) => total + (item[field] || 0), 0);
}

function annotateGapRanges(gap, classification) {
  if (!Number.isFinite(classification.consumedBytes)) return classification;
  const consumedBytes = Math.max(0, Math.min(classification.consumedBytes, gap.size));
  const tailBytes = Math.max(0, gap.size - consumedBytes);
  return {
    ...classification,
    candidateConsumedRange: {
      startOffset: hex(gap.start),
      endOffsetExclusive: hex(gap.start + consumedBytes),
      size: consumedBytes,
    },
    candidateTailRange: tailBytes > 0 ? {
      startOffset: hex(gap.start + consumedBytes),
      endOffsetExclusive: hex(gap.endExclusive),
      size: tailBytes,
    } : null,
    candidateTailBytes: tailBytes,
  };
}

function makeCandidateRange(start, consumedBytes, endExclusive) {
  const consumed = Math.max(0, Math.min(consumedBytes || 0, endExclusive - start));
  const residual = Math.max(0, endExclusive - start - consumed);
  return {
    consumedRange: {
      startOffset: hex(start),
      endOffsetExclusive: hex(start + consumed),
      size: consumed,
    },
    residualRange: residual > 0 ? {
      startOffset: hex(start + consumed),
      endOffsetExclusive: hex(endExclusive),
      size: residual,
    } : null,
    residualBytes: residual,
  };
}

function classifyTailRange(rom, gap) {
  const tail = gap.candidateTailRange;
  if (!tail) return null;
  const start = parseHex(tail.startOffset);
  const endExclusive = parseHex(tail.endOffsetExclusive);
  const limitInclusive = endExclusive - 1;
  if (!Number.isFinite(start) || !Number.isFinite(endExclusive) || endExclusive <= start) return null;

  const draw = decodeDrawCandidate(rom, start, limitInclusive);
  const state = decodeStateCandidate(rom, start, limitInclusive);
  if (!draw && !state) {
    return {
      class: 'unclassified_candidate_tail',
      confidence: 'low',
      size: endExclusive - start,
      reason: 'Tail range does not decode as a bounded state record or VDP draw segment under the current bank-2 parser models.',
    };
  }

  if (draw) {
    const exact = draw.consumedBytes === endExclusive - start;
    const range = makeCandidateRange(start, draw.consumedBytes, endExclusive);
    return {
      class: exact
        ? 'unreferenced_exact_vdp_draw_segment_tail_candidate'
        : 'unreferenced_vdp_draw_segment_tail_prefix_candidate',
      confidence: exact ? 'medium' : 'low',
      decoder: 'vdp_draw_segment',
      consumedBytes: draw.consumedBytes,
      tileWordPairs: draw.tileWordPairs,
      controlCount: draw.controlCount,
      ...range,
      stateAlternative: state ? {
        kind: state.kind,
        consumedBytes: state.consumedBytes,
        controlCount: state.controlCount,
        exact: state.consumedBytes === endExclusive - start,
      } : null,
      reason: exact
        ? 'Tail range decodes exactly as a terminated VDP draw segment under the current _LABEL_97D9_/_LABEL_9812_ model, but no pointer-list consumer is confirmed.'
        : 'Tail range begins with a terminated VDP draw segment candidate but leaves residual bytes; no pointer-list consumer is confirmed.',
    };
  }

  const exact = state.consumedBytes === endExclusive - start;
  const range = makeCandidateRange(start, state.consumedBytes, endExclusive);
  return {
    class: exact
      ? 'unreferenced_exact_state_record_tail_candidate'
      : 'unreferenced_state_record_tail_prefix_candidate',
    confidence: exact ? 'medium' : 'low',
    decoder: 'state_record',
    consumedBytes: state.consumedBytes,
    controlCount: state.controlCount,
    stateKind: state.kind,
    ...range,
    reason: exact
      ? 'Tail range decodes exactly as a state record under the current _LABEL_972B_ model, but no state-table consumer is confirmed.'
      : 'Tail range begins with a state-record candidate but leaves residual bytes; no state-table consumer is confirmed.',
  };
}

function intervalPointerRoleMatches(pointerRole, intervalKind) {
  if (pointerRole === intervalKind) return true;
  if (pointerRole === 'vdp_draw_pointer_list' && intervalKind === 'vdp_draw_pointer_list') return true;
  if (pointerRole === 'object_list_pointer' && intervalKind === 'object_list_pointer') return true;
  if (pointerRole === 'damage_object_list_pointer' && intervalKind === 'damage_object_list_pointer') return true;
  return false;
}

function intervalPointerTargetContext(pointer, intervals) {
  const targetOffset = parseHex(pointer.targetOffset || '');
  if (!Number.isFinite(targetOffset)) {
    return {
      status: 'invalid_or_out_of_bundle_pointer',
      confidence: 'high',
    };
  }
  const matches = intervals.filter(interval => targetOffset >= interval.start && targetOffset < interval.endExclusive);
  if (!matches.length) return null;
  return {
    status: 'decoded_interval_target',
    confidence: 'high',
    targetAtIntervalStart: matches.some(interval => interval.start === targetOffset),
    roleMatchesDecodedInterval: matches.some(interval => intervalPointerRoleMatches(pointer.role, interval.kind)),
    intervalRefs: matches.map(interval => ({
      kind: interval.kind,
      startOffset: hex(interval.start),
      endOffsetExclusive: hex(interval.endExclusive),
      size: interval.size,
      confidence: interval.confidence || 'high',
    })),
  };
}

function gapPointerTargetContext(pointer, gaps) {
  const targetOffset = parseHex(pointer.targetOffset || '');
  if (!Number.isFinite(targetOffset)) return null;
  const gap = gaps.find(item => {
    const start = parseHex(item.startOffset);
    const endExclusive = parseHex(item.endOffsetExclusive);
    return targetOffset >= start && targetOffset < endExclusive;
  });
  if (!gap) return null;

  const consumedStart = parseHex(gap.candidateConsumedRange?.startOffset || '');
  const consumedEnd = parseHex(gap.candidateConsumedRange?.endOffsetExclusive || '');
  const tailConsumedStart = parseHex(gap.candidateTailClassification?.consumedRange?.startOffset || '');
  const tailConsumedEnd = parseHex(gap.candidateTailClassification?.consumedRange?.endOffsetExclusive || '');
  let targetSubrange = 'gap_unconsumed_or_unclassified_range';
  if (Number.isFinite(consumedStart) && Number.isFinite(consumedEnd) && targetOffset >= consumedStart && targetOffset < consumedEnd) {
    targetSubrange = 'candidate_consumed_range';
  } else if (Number.isFinite(tailConsumedStart) && Number.isFinite(tailConsumedEnd) && targetOffset >= tailConsumedStart && targetOffset < tailConsumedEnd) {
    targetSubrange = 'candidate_tail_consumed_range';
  } else if (gap.class === 'all_zero_padding_gap') {
    targetSubrange = 'all_zero_padding_range';
  }

  return {
    status: gap.class === 'all_zero_padding_gap' ? 'padding_gap_target' : 'candidate_gap_target',
    confidence: gap.confidence || 'low',
    targetAtGapStart: parseHex(gap.startOffset) === targetOffset,
    targetSubrange,
    gapRef: {
      startOffset: gap.startOffset,
      endOffsetExclusive: gap.endOffsetExclusive,
      size: gap.size,
      class: gap.class,
      confidence: gap.confidence,
      consumedBytes: gap.consumedBytes || null,
      tailClass: gap.candidateTailClassification?.class || null,
    },
  };
}

function targetContainingGap(gaps, targetOffset) {
  return gaps.find(item => {
    const start = parseHex(item.startOffset);
    const endExclusive = parseHex(item.endOffsetExclusive);
    return targetOffset >= start && targetOffset < endExclusive;
  }) || null;
}

function mergeNumericRanges(ranges) {
  const sorted = ranges
    .filter(range => Number.isFinite(range.start) && Number.isFinite(range.endExclusive) && range.endExclusive > range.start)
    .sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.endExclusive) {
      last.endExclusive = Math.max(last.endExclusive, range.endExclusive);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function refineVdpDrawPointerListGapCandidates(rom, gaps) {
  const targetsByGap = new Map();
  for (const stateGap of gaps) {
    for (const pointer of stateGap.pointerRoles || []) {
      if (pointer.role !== 'vdp_draw_pointer_list') continue;
      const targetOffset = parseHex(pointer.targetOffset || '');
      if (!Number.isFinite(targetOffset)) continue;
      const gap = targetContainingGap(gaps, targetOffset);
      if (!gap) continue;
      const key = `${gap.startOffset}-${gap.endOffsetExclusive}`;
      if (!targetsByGap.has(key)) targetsByGap.set(key, { gap, offsets: new Set() });
      targetsByGap.get(key).offsets.add(targetOffset);
    }
  }

  for (const { gap, offsets } of targetsByGap.values()) {
    const gapStart = parseHex(gap.startOffset);
    const gapEnd = parseHex(gap.endOffsetExclusive);
    const candidates = [];
    for (const offset of [...offsets].sort((a, b) => a - b)) {
      const decoded = decodeDrawPointerListCandidate(rom, offset, gapEnd);
      if (decoded) candidates.push(decoded);
    }
    if (!candidates.length) continue;

    const coverage = mergeNumericRanges(candidates.map(candidate => ({
      start: parseHex(candidate.offset),
      endExclusive: parseHex(candidate.endExclusive),
    })));
    const coverageBytes = coverage.reduce((total, range) => total + (range.endExclusive - range.start), 0);
    const coversFullGap = coverage.length === 1
      && coverage[0].start === gapStart
      && coverage[0].endExclusive === gapEnd;

    gap.vdpDrawPointerListCandidates = candidates;
    gap.vdpDrawPointerListCandidateCoverage = {
      coverageBytes,
      coversFullGap,
      ranges: coverage.map(range => ({
        startOffset: hex(range.start),
        endOffsetExclusive: hex(range.endExclusive),
        size: range.endExclusive - range.start,
      })),
    };
    gap.vdpDrawPointerListCandidateCount = candidates.length;
    gap.vdpDrawPointerListPointerCount = candidates.reduce((total, candidate) => total + candidate.pointerCount, 0);
    gap.vdpDrawPointerListSegmentTileWordPairs = candidates.reduce((total, candidate) => total + candidate.totalSegmentTileWordPairs, 0);

    if (!coversFullGap) continue;
    gap.priorCandidateClassification = {
      class: gap.class,
      confidence: gap.confidence,
      consumedBytes: gap.consumedBytes,
      tileWordPairs: gap.tileWordPairs,
      controlCount: gap.controlCount,
      candidateTailClassification: gap.candidateTailClassification || null,
    };
    gap.class = 'unreferenced_exact_vdp_draw_pointer_list_sequence_candidate';
    gap.confidence = 'medium';
    gap.consumedBytes = gap.size;
    gap.tileWordPairs = gap.vdpDrawPointerListSegmentTileWordPairs;
    gap.controlCount = candidates.reduce((total, candidate) => total + candidate.totalSegmentControlCount, 0);
    gap.candidateConsumedRange = {
      startOffset: gap.startOffset,
      endOffsetExclusive: gap.endOffsetExclusive,
      size: gap.size,
    };
    gap.candidateTailRange = null;
    gap.candidateTailBytes = 0;
    gap.candidateTailClassification = null;
  }
}

function annotateStateCandidatePointerTargets(gaps, intervals) {
  for (const gap of gaps) {
    if (!gap.pointerRoles?.length) continue;
    gap.pointerRoles = gap.pointerRoles.map(pointer => {
      const decodedContext = intervalPointerTargetContext(pointer, intervals);
      const candidateContext = decodedContext ? null : gapPointerTargetContext(pointer, gaps);
      const targetContext = decodedContext || candidateContext || {
        status: 'unknown_layout_target',
        confidence: 'low',
        reason: 'Pointer target is inside the bank-2 bundle but outside decoded intervals and current gap candidates.',
      };
      return {
        ...pointer,
        targetContext,
      };
    });
    gap.statePointerTargetSummary = {
      pointerCount: gap.pointerRoles.length,
      targetStatusCounts: countBy(gap.pointerRoles, pointer => pointer.targetContext?.status || 'missing_target_context'),
      decodedIntervalTargetCount: gap.pointerRoles.filter(pointer => pointer.targetContext?.status === 'decoded_interval_target').length,
      candidateGapTargetCount: gap.pointerRoles.filter(pointer => pointer.targetContext?.status === 'candidate_gap_target').length,
      roleMatchedDecodedIntervalCount: gap.pointerRoles.filter(pointer => pointer.targetContext?.roleMatchesDecodedInterval).length,
      allTargetsResolvedToDecodedOrCandidateLayout: gap.pointerRoles.every(pointer => (
        pointer.targetContext?.status === 'decoded_interval_target'
        || pointer.targetContext?.status === 'candidate_gap_target'
      )),
    };
  }
}

function buildCatalog(rom, mapData) {
  const sourceCatalog = (mapData.vdpStreamCatalogs || []).find(catalog => catalog.id === sourceCatalogId);
  if (!sourceCatalog) {
    throw new Error(`Missing source catalog ${sourceCatalogId}; run tools/world-bank2-vdp-stream-state-audit.mjs --apply first.`);
  }
  const bundleRegion = findRegionById(mapData, 'r0186');
  const intervals = buildIntervals(sourceCatalog);
  const mergedIntervals = mergeIntervals(intervals);
  const overlaps = collectOverlaps(intervals);
  const gaps = findGaps(mergedIntervals).map(gap => {
    const classification = annotateGapRanges(gap, classifyGap(rom, gap));
    const entry = {
      startOffset: hex(gap.start),
      endOffsetExclusive: hex(gap.endExclusive),
      size: gap.size,
      precedingKinds: gap.precedingKinds || [],
      followingKinds: gap.followingKinds || [],
      ...classification,
    };
    entry.candidateTailClassification = classifyTailRange(rom, entry);
    return entry;
  });
  refineVdpDrawPointerListGapCandidates(rom, gaps);
  annotateStateCandidatePointerTargets(gaps, intervals);
  const intervalKindCounts = countBy(intervals, interval => interval.kind);
  const intervalKindBytes = {};
  for (const interval of intervals) {
    intervalKindBytes[interval.kind] = (intervalKindBytes[interval.kind] || 0) + interval.size;
  }
  const decodedCoverageBytes = sum(mergedIntervals, 'size');
  const gapBytes = sum(gaps, 'size');
  const candidateConsumedBytes = gaps.reduce((total, gap) => total + (gap.candidateConsumedRange?.size || 0), 0);
  const candidateTailBytes = gaps.reduce((total, gap) => total + (gap.candidateTailRange?.size || 0), 0);
  const prefixCandidateTailCount = gaps.filter(gap => Number(gap.candidateTailRange?.size || 0) > 0).length;
  const tailClassCounts = countBy(
    gaps.filter(gap => gap.candidateTailClassification),
    gap => gap.candidateTailClassification.class,
  );
  const tailDecodedCandidateCount = gaps.filter(gap => {
    const tail = gap.candidateTailClassification;
    return tail?.decoder === 'vdp_draw_segment' || tail?.decoder === 'state_record';
  }).length;
  const exactTailDrawCandidateCount = gaps.filter(gap => (
    gap.candidateTailClassification?.class === 'unreferenced_exact_vdp_draw_segment_tail_candidate'
  )).length;
  const prefixTailDrawCandidateCount = gaps.filter(gap => (
    gap.candidateTailClassification?.class === 'unreferenced_vdp_draw_segment_tail_prefix_candidate'
  )).length;
  const tailCandidateConsumedBytes = gaps.reduce((total, gap) => total + (gap.candidateTailClassification?.consumedRange?.size || 0), 0);
  const tailResidualBytes = gaps.reduce((total, gap) => total + (gap.candidateTailClassification?.residualRange?.size || 0), 0);
  const objectGapCandidates = gaps.filter(gap => gap.class.includes('object'));
  const objectGapCandidateCount = objectGapCandidates.length;
  const objectGapRecordCount = objectGapCandidates.reduce((total, gap) => total + (gap.objectRecordCount || 0), 0);
  const objectGapConsumedBytes = objectGapCandidates.reduce((total, gap) => total + (gap.candidateConsumedRange?.size || 0), 0);
  const paddingGapCount = gaps.filter(gap => gap.class === 'all_zero_padding_gap').length;
  const paddingGapBytes = gaps
    .filter(gap => gap.class === 'all_zero_padding_gap')
    .reduce((total, gap) => total + gap.size, 0);
  const vdpDrawPointerListGapCandidates = gaps.filter(gap => gap.vdpDrawPointerListCandidates?.length);
  const exactVdpDrawPointerListGapCandidateCount = gaps.filter(gap => (
    gap.class === 'unreferenced_exact_vdp_draw_pointer_list_sequence_candidate'
  )).length;
  const vdpDrawPointerListCandidateCount = vdpDrawPointerListGapCandidates.reduce(
    (total, gap) => total + (gap.vdpDrawPointerListCandidateCount || 0),
    0,
  );
  const vdpDrawPointerListCandidatePointerCount = vdpDrawPointerListGapCandidates.reduce(
    (total, gap) => total + (gap.vdpDrawPointerListPointerCount || 0),
    0,
  );
  const vdpDrawPointerListCandidateCoverageBytes = vdpDrawPointerListGapCandidates.reduce(
    (total, gap) => total + (gap.vdpDrawPointerListCandidateCoverage?.coverageBytes || 0),
    0,
  );
  const stateGapCandidates = gaps.filter(gap => gap.pointerRoles?.length);
  const stateGapCandidatePointerRoles = stateGapCandidates.flatMap(gap => gap.pointerRoles || []);
  const stateGapPointerTargetStatusCounts = countBy(
    stateGapCandidatePointerRoles,
    pointer => pointer.targetContext?.status || 'missing_target_context',
  );
  const stateGapPointerRoleCounts = countBy(
    stateGapCandidatePointerRoles,
    pointer => pointer.role || 'unknown_role',
  );
  const stateGapCandidatesWithAllTargetsResolved = stateGapCandidates.filter(gap => (
    gap.statePointerTargetSummary?.allTargetsResolvedToDecodedOrCandidateLayout
  )).length;
  const stateGapPointersToDecodedIntervals = stateGapCandidatePointerRoles.filter(pointer => (
    pointer.targetContext?.status === 'decoded_interval_target'
  )).length;
  const stateGapPointersToCandidateGaps = stateGapCandidatePointerRoles.filter(pointer => (
    pointer.targetContext?.status === 'candidate_gap_target'
  )).length;
  const stateGapPointersRoleMatchedDecodedIntervals = stateGapCandidatePointerRoles.filter(pointer => (
    pointer.targetContext?.roleMatchesDecodedInterval
  )).length;
  const sourceWarnings =
    (sourceCatalog.summary?.decodedPointerRoleWarnings || 0) +
    (sourceCatalog.summary?.invalidStateRecords || 0);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogId,
    bundle: {
      region: regionRef(bundleRegion),
      range: [hex(bundleOffset), hex(bundleEndInclusive)],
      size: bundleEndExclusive - bundleOffset,
    },
    summary: {
      decodedIntervalCount: intervals.length,
      mergedDecodedRuns: mergedIntervals.length,
      decodedCoverageBytes,
      decodedCoverageRatio: Number((decodedCoverageBytes / (bundleEndExclusive - bundleOffset)).toFixed(4)),
      gapCount: gaps.length,
      gapBytes,
      gapRatio: Number((gapBytes / (bundleEndExclusive - bundleOffset)).toFixed(4)),
      candidateConsumedBytes,
      candidateTailBytes,
      prefixCandidateTailCount,
      tailDecodedCandidateCount,
      exactTailDrawCandidateCount,
      prefixTailDrawCandidateCount,
      tailCandidateConsumedBytes,
      tailResidualBytes,
      objectGapCandidateCount,
      objectGapRecordCount,
      objectGapConsumedBytes,
      paddingGapCount,
      paddingGapBytes,
      vdpDrawPointerListGapCandidateCount: vdpDrawPointerListGapCandidates.length,
      exactVdpDrawPointerListGapCandidateCount,
      vdpDrawPointerListCandidateCount,
      vdpDrawPointerListCandidatePointerCount,
      vdpDrawPointerListCandidateCoverageBytes,
      stateGapCandidateCount: stateGapCandidates.length,
      stateGapCandidatePointerCount: stateGapCandidatePointerRoles.length,
      stateGapCandidatesWithAllTargetsResolved,
      stateGapPointersToDecodedIntervals,
      stateGapPointersToCandidateGaps,
      stateGapPointersRoleMatchedDecodedIntervals,
      stateGapPointerTargetStatusCounts,
      stateGapPointerRoleCounts,
      overlapCount: overlaps.length,
      explainedAliasOverlapCount: overlaps.filter(overlap => overlap.kind !== 'decoded_interval_overlap').length,
      unresolvedOverlapCount: overlaps.filter(overlap => overlap.kind === 'decoded_interval_overlap').length,
      intervalKindCounts,
      intervalKindBytes,
      gapClassCounts: countBy(gaps, gap => gap.class),
      tailClassCounts,
      sourceDecodeWarnings: sourceWarnings,
      regionPromotionStatus: 'not_promoted_to_child_regions_due_to_suffix_aliases_and_unreferenced_gap_candidates',
      assetPolicy: 'Metadata only: offsets, interval classes, counts, and decoder evidence. No ROM bytes, decoded screens, or graphics are embedded.',
    },
    mergedIntervals,
    overlaps,
    gaps,
    evidence: [
      `${sourceCatalogId} decodes six root table entries, 190 state pointer entries, and 68 pointer-role targets with no pointer-role warnings.`,
      '_LABEL_96FE_/_LABEL_972B_ consume state records from _RAM_D15A_ and dispatch VDP draw, object-list, and damage-list pointers.',
      '_LABEL_97D9_/_LABEL_9812_ consume VDP draw pointer lists and draw segments; _LABEL_9980_/_LABEL_99A1_ consume object and damage object lists.',
      'Unreferenced object-list-shaped gaps are classified only when they decode as locally terminated object-list sequences or as 4-byte object-record runs adjacent to confirmed object-list intervals.',
      'The final unclaimed bytes from 0x0B397 through 0x0B3BF are classified as all-zero padding after the last decoded object/damage-list interval.',
      'State-record-shaped gap candidates now retain their three decoded pointer roles and target-context classifications against decoded intervals and candidate gaps; this remains trace evidence, not confirmed state-table reachability.',
      'VDP draw pointer-list sequence candidates are promoted only when candidate state-record vdp_draw_pointer_list fields target the gap and the decoded word-list coverage exactly spans the gap.',
      'Root entries 1-5 point inside the first state pointer table, so child-region promotion would currently create suffix-alias overlaps.',
    ],
    nextLeads: [
      'Use the state-candidate pointer target contexts to trace whether these unreferenced state records are reachable alternate state records or dead/interior data before promotion.',
      'For remaining low-confidence draw-segment prefix gaps, find direct pointer-list consumers or prove they are interior draw-segment data.',
      'Trace object-list-shaped gaps at 0x0B2AB-0x0B2C5 and 0x0B308-0x0B334 for hidden object-list consumers before promoting them to child regions.',
      'After alias/gap resolution, split r0186 into non-overlapping root table, pointer table, state-record, draw-list, draw-segment, object-list, and padding regions.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegionById(mapData, 'r0186');
  if (!region) {
    return { changedRegions: [], missingRegions: [{ id: 'r0186', offset: hex(bundleOffset), role: 'bank2_vdp_stream_bundle_layout' }] };
  }
  if (!apply) {
    return {
      changedRegions: [{
        id: region.id,
        offset: region.offset,
        type: region.type || 'unknown',
        name: region.name || '',
        inferredAnalysis: 'bank2VdpStreamLayoutAudit',
      }],
      missingRegions: [],
    };
  }

  region.analysis = region.analysis || {};
  region.analysis.bank2VdpStreamLayoutAudit = {
    catalogId,
    sourceCatalogId,
    kind: 'bank2_vdp_stream_bundle_interval_layout',
    confidence: catalog.summary.sourceDecodeWarnings === 0 ? 'medium' : 'low',
    summary: 'Interval layout model for the bank-2 VDP stream bundle, preserving decoded aliases and unresolved gap candidates without creating overlapping child regions.',
    detail: {
      decodedIntervalCount: catalog.summary.decodedIntervalCount,
      mergedDecodedRuns: catalog.summary.mergedDecodedRuns,
      decodedCoverageBytes: catalog.summary.decodedCoverageBytes,
      decodedCoverageRatio: catalog.summary.decodedCoverageRatio,
      gapCount: catalog.summary.gapCount,
      gapBytes: catalog.summary.gapBytes,
      candidateConsumedBytes: catalog.summary.candidateConsumedBytes,
      candidateTailBytes: catalog.summary.candidateTailBytes,
      prefixCandidateTailCount: catalog.summary.prefixCandidateTailCount,
      tailDecodedCandidateCount: catalog.summary.tailDecodedCandidateCount,
      exactTailDrawCandidateCount: catalog.summary.exactTailDrawCandidateCount,
      prefixTailDrawCandidateCount: catalog.summary.prefixTailDrawCandidateCount,
      tailCandidateConsumedBytes: catalog.summary.tailCandidateConsumedBytes,
      tailResidualBytes: catalog.summary.tailResidualBytes,
      objectGapCandidateCount: catalog.summary.objectGapCandidateCount,
      objectGapRecordCount: catalog.summary.objectGapRecordCount,
      objectGapConsumedBytes: catalog.summary.objectGapConsumedBytes,
      paddingGapCount: catalog.summary.paddingGapCount,
      paddingGapBytes: catalog.summary.paddingGapBytes,
      vdpDrawPointerListGapCandidateCount: catalog.summary.vdpDrawPointerListGapCandidateCount,
      exactVdpDrawPointerListGapCandidateCount: catalog.summary.exactVdpDrawPointerListGapCandidateCount,
      vdpDrawPointerListCandidateCount: catalog.summary.vdpDrawPointerListCandidateCount,
      vdpDrawPointerListCandidatePointerCount: catalog.summary.vdpDrawPointerListCandidatePointerCount,
      vdpDrawPointerListCandidateCoverageBytes: catalog.summary.vdpDrawPointerListCandidateCoverageBytes,
      stateGapCandidateCount: catalog.summary.stateGapCandidateCount,
      stateGapCandidatePointerCount: catalog.summary.stateGapCandidatePointerCount,
      stateGapCandidatesWithAllTargetsResolved: catalog.summary.stateGapCandidatesWithAllTargetsResolved,
      stateGapPointersToDecodedIntervals: catalog.summary.stateGapPointersToDecodedIntervals,
      stateGapPointersToCandidateGaps: catalog.summary.stateGapPointersToCandidateGaps,
      stateGapPointersRoleMatchedDecodedIntervals: catalog.summary.stateGapPointersRoleMatchedDecodedIntervals,
      stateGapPointerTargetStatusCounts: catalog.summary.stateGapPointerTargetStatusCounts,
      stateGapPointerRoleCounts: catalog.summary.stateGapPointerRoleCounts,
      gapClassCounts: catalog.summary.gapClassCounts,
      tailClassCounts: catalog.summary.tailClassCounts,
      overlapCount: catalog.summary.overlapCount,
      explainedAliasOverlapCount: catalog.summary.explainedAliasOverlapCount,
      unresolvedOverlapCount: catalog.summary.unresolvedOverlapCount,
      regionPromotionStatus: catalog.summary.regionPromotionStatus,
    },
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };

  return {
    changedRegions: [{
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      inferredAnalysis: 'bank2VdpStreamLayoutAudit',
    }],
    missingRegions: [],
  };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.vdpStreamLayoutCatalogs = (mapData.vdpStreamLayoutCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpStreamLayoutCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_stream_layout_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      summary: catalog.summary,
      changedRegions: annotation.changedRegions,
      missingRegions: annotation.missingRegions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    sourceCatalogId,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
