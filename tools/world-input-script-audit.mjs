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
const catalogId = 'world-input-script-catalog-2026-06-24';
const reportId = 'input-script-audit-2026-06-24';

const MAIN_SCRIPT_OFFSET = 0x1E7FF;
const ZERO_PADDING_OFFSET = 0x1E3FC;
const BANK7_END_EXCLUSIVE = 0x20000;

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(r => {
    const start = parseInt(r.offset, 16);
    return offset >= start && offset < start + (r.size || 0);
  }) || null;
}

function findExactRegion(mapData, offset, size = null) {
  return mapData.regions.find(r => {
    const start = parseInt(r.offset, 16);
    if (start !== offset) return false;
    return size == null || (r.size || 0) === size;
  }) || null;
}

function nextRegionId(mapData) {
  let max = 0;
  for (const region of mapData.regions || []) {
    const match = /^r(\d+)$/.exec(region.id || '');
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `r${String(max + 1).padStart(4, '0')}`;
}

function regionRef(mapData, offset) {
  const region = findContainingRegion(mapData, offset);
  if (!region) return null;
  return {
    id: region.id,
    name: region.name || '',
    type: region.type || 'unknown',
    offset: region.offset,
  };
}

function isAllZero(rom, offset, size) {
  for (let i = offset; i < offset + size; i++) {
    if (rom[i] !== 0) return false;
  }
  return true;
}

function byteStats(rom, offset, size) {
  const bytes = rom.subarray(offset, offset + size);
  let zeros = 0;
  let ff = 0;
  for (const byte of bytes) {
    if (byte === 0) zeros++;
    if (byte === 0xFF) ff++;
  }
  return {
    size,
    zeroBytes: zeros,
    ffBytes: ff,
    zeroRatio: Number((zeros / Math.max(1, size)).toFixed(4)),
    ffRatio: Number((ff / Math.max(1, size)).toFixed(4)),
  };
}

function byteClassStats(rom, offset, size) {
  const bytes = rom.subarray(offset, offset + size);
  let zeroBytes = 0;
  let ffBytes = 0;
  let printableAsciiBytes = 0;
  let spaceBytes = 0;
  let highBitBytes = 0;
  let controlBytes = 0;
  for (const byte of bytes) {
    if (byte === 0) zeroBytes++;
    if (byte === 0xFF) ffBytes++;
    if (byte === 0x20) spaceBytes++;
    if (byte >= 0x20 && byte <= 0x7E) printableAsciiBytes++;
    if (byte >= 0x80) highBitBytes++;
    if (byte < 0x20 && byte !== 0) controlBytes++;
  }
  return {
    size,
    zeroBytes,
    nonZeroBytes: size - zeroBytes,
    ffBytes,
    printableAsciiBytes,
    spaceBytes,
    highBitBytes,
    controlBytes,
    zeroRatio: Number((zeroBytes / Math.max(1, size)).toFixed(4)),
    printableAsciiRatio: Number((printableAsciiBytes / Math.max(1, size)).toFixed(4)),
  };
}

function classifyByteClass(stats) {
  if (!stats.size) return 'empty';
  if (stats.zeroBytes === stats.size) return 'zero_padding';
  if (stats.printableAsciiBytes === stats.size) return 'printable_ascii_marker';
  if (stats.highBitBytes === 0 && stats.controlBytes === 0) return 'printable_ascii_mixed_with_zero';
  return 'mixed_binary';
}

function tailSegments(rom, offset, size) {
  const segments = [];
  const end = offset + size;
  let pos = offset;
  while (pos < end) {
    const start = pos;
    const zeroRun = rom[pos] === 0;
    while (pos < end && (rom[pos] === 0) === zeroRun) pos++;
    const segmentSize = pos - start;
    const stats = byteClassStats(rom, start, segmentSize);
    segments.push({
      startOffset: hex(start),
      endOffsetExclusive: hex(pos),
      size: segmentSize,
      contentClass: classifyByteClass(stats),
      byteClassStats: stats,
    });
  }
  return segments;
}

function countValues(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[field];
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([value, count]) => ({ value: hex(value, 2), count }));
}

function parseLabelBfdInputScript(rom, offset) {
  const records = [];
  const leadingByte = rom[offset];
  let pos = offset + 1;
  while (pos + 1 < rom.length && records.length < 4096) {
    const duration = rom[pos];
    if (duration === 0) break;
    const command = rom[pos + 1];
    records.push({
      index: records.length,
      offset: hex(pos),
      duration,
      command: hex(command, 2),
      directionBits: hex(command & 0x0F, 2),
      actionBits: hex(command & 0x30, 2),
    });
    pos += 2;
  }
  const terminatorOffset = pos;
  return {
    offset: hex(offset),
    leadingByte: hex(leadingByte, 2),
    firstRecordOffset: hex(offset + 1),
    terminatorOffset: hex(terminatorOffset),
    parsedRange: [hex(offset), hex(terminatorOffset)],
    parsedByteLength: terminatorOffset - offset + 1,
    recordCount: records.length,
    frameDurationTotal: records.reduce((sum, record) => sum + record.duration, 0),
    durationCounts: countValues(records, 'duration'),
    commandCounts: countValues(records.map(r => ({ command: parseInt(r.command, 16) })), 'command'),
    actionBitCounts: countValues(records.map(r => ({ actionBits: parseInt(r.actionBits, 16) })), 'actionBits'),
    directionBitCounts: countValues(records.map(r => ({ directionBits: parseInt(r.directionBits, 16) })), 'directionBits'),
    recordSamples: records.slice(0, 48),
  };
}

function buildCatalog(rom, mapData) {
  const scriptRegion = findContainingRegion(mapData, MAIN_SCRIPT_OFFSET);
  const paddingRegion = findContainingRegion(mapData, ZERO_PADDING_OFFSET);
  const scriptStart = parseInt(scriptRegion?.offset || hex(MAIN_SCRIPT_OFFSET), 16);
  const scriptSize = scriptRegion?.size || 0;
  const scriptEnd = scriptStart + scriptSize;
  const parsed = parseLabelBfdInputScript(rom, MAIN_SCRIPT_OFFSET);
  const parsedEnd = parseInt(parsed.terminatorOffset, 16);
  const tailStart = parsedEnd + 1;
  const tailEnd = Math.max(scriptEnd, BANK7_END_EXCLUSIVE);
  const tailSize = scriptRegion ? Math.max(0, tailEnd - tailStart) : 0;
  const tailStats = scriptRegion ? byteClassStats(rom, tailStart, tailSize) : null;
  const splitTail = scriptRegion ? tailSegments(rom, tailStart, tailSize) : [];
  const markerTailSegments = splitTail.filter(segment => segment.contentClass === 'printable_ascii_marker');
  const zeroPaddingTailSegments = splitTail.filter(segment => segment.contentClass === 'zero_padding');
  return {
    id: catalogId,
    schemaVersion: 2,
    generatedAt: now,
    tool: 'tools/world-input-script-audit.mjs',
    stream: {
      label: '_DATA_1E7FF_',
      region: regionRef(mapData, MAIN_SCRIPT_OFFSET),
      format: 'leading byte, then [duration, command] records consumed by _LABEL_BFD_; duration 0 terminates the stream',
      parsed,
      byteStats: scriptRegion ? byteStats(rom, scriptStart, scriptSize) : null,
      zeroTail: scriptRegion ? {
        startOffset: hex(tailStart),
        endOffsetExclusive: hex(scriptEnd),
        size: tailSize,
        allZero: tailStats.zeroBytes === tailStats.size,
        byteClassStats: tailStats,
        segments: splitTail,
      } : null,
      evidence: [
        '_LABEL_508_ initializes _RAM_CFEE_ with _DATA_1E7FF_ and clears _RAM_CFF0_ before calling _LABEL_23F1_.',
        '_LABEL_BFD_ advances _RAM_CFEE_, reads a duration byte into _RAM_CFF0_, copies command low nibble into _RAM_D279_, and copies command bits $30 into _RAM_CF95_.',
        '_RAM_D279_ is tested by movement/control routines such as _LABEL_21C4_, _LABEL_2207_, _LABEL_2248_, and _LABEL_228C_.',
        '_RAM_CF95_ bits 4 and 5 are tested in menu/control flows such as _LABEL_2BD4_ and _LABEL_2BF8_.',
        'ASM emits zero fill after the input bytes, followed by a final 16-byte printable bank marker before .BANK 8.',
      ],
    },
    zeroPadding: paddingRegion ? {
      region: regionRef(mapData, ZERO_PADDING_OFFSET),
      byteStats: byteStats(rom, parseInt(paddingRegion.offset, 16), paddingRegion.size || 0),
      asmEvidence: 'ASM emits Data from 1E3FC to 1E7FE as .dsb 1027, $00 immediately before _DATA_1E7FF_.',
      allZero: isAllZero(rom, parseInt(paddingRegion.offset, 16), paddingRegion.size || 0),
    } : null,
    summary: {
      parsedInputRecords: parsed.recordCount,
      parsedByteLength: parsed.parsedByteLength,
      frameDurationTotal: parsed.frameDurationTotal,
      uniqueCommands: parsed.commandCounts.length,
      zeroTailBytes: tailSize,
      zeroTailZeroBytes: tailStats?.zeroBytes || 0,
      zeroTailNonZeroBytes: tailStats?.nonZeroBytes || 0,
      zeroTailSegmentCount: splitTail.length,
      zeroPaddingTailSegments: zeroPaddingTailSegments.length,
      printableMarkerTailSegments: markerTailSegments.length,
      printableMarkerTailBytes: markerTailSegments.reduce((sum, segment) => sum + segment.size, 0),
      adjacentZeroPaddingBytes: paddingRegion?.size || 0,
      assetPolicy: 'Metadata only: offsets, record counts, command bit summaries, and routine evidence. No ROM bytes or decoded copyrighted assets are embedded.',
    },
  };
}

function inputScriptTailEvidence() {
  return [
    '_LABEL_508_ initializes _RAM_CFEE_ with _DATA_1E7FF_; _LABEL_BFD_ consumes [duration, command] pairs until a zero duration terminator.',
    'The parsed input-control stream terminates at 0x1E97A, so bytes after 0x1E97A are not consumed as input records.',
    'ASM emits a zero-fill tail after the input bytes and a final 16-byte printable bank marker before .BANK 8.',
  ];
}

function updateInputScriptRegion(region, catalog) {
  const previousType = region.type || 'unknown';
  const changedType = ['unknown', 'raw_byte', 'data_table'].includes(previousType) && previousType !== 'input_script';
  if (changedType) region.type = 'input_script';
  region.analysis = region.analysis || {};
  const existing = region.analysis.inputScriptAudit || {};
  region.analysis.inputScriptAudit = {
    kind: 'label_bfd_input_control_stream',
    summary: 'Duration/command input-control stream consumed by _LABEL_BFD_.',
    confidence: 'high',
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    detail: {
      parsedInputRecords: catalog.stream.parsed.recordCount,
      parsedRange: catalog.stream.parsed.parsedRange,
      terminatorOffset: catalog.stream.parsed.terminatorOffset,
      zeroTail: catalog.stream.zeroTail,
      tailSegments: catalog.stream.zeroTail?.segments || [],
    },
    evidence: catalog.stream.evidence,
    generatedAt: now,
    tool: 'tools/world-input-script-audit.mjs',
  };
  return changedType;
}

function updateNullRegion(region, catalog) {
  const previousType = region.type || 'unknown';
  const changedType = ['unknown', 'raw_byte', 'data_table'].includes(previousType) && previousType !== 'null';
  if (changedType) region.type = 'null';
  region.analysis = region.analysis || {};
  const existing = region.analysis.inputScriptAudit || {};
  region.analysis.inputScriptAudit = {
    kind: 'adjacent_zero_padding',
    summary: 'All-zero bank-7 padding immediately preceding the confirmed input-control stream.',
    confidence: 'high',
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    detail: catalog.zeroPadding,
    evidence: [
      'ASM emits Data from 1E3FC to 1E7FE as .dsb 1027, $00.',
      'The next labeled region is _DATA_1E7FF_, which is referenced directly by _LABEL_508_.',
      'All bytes in this region are zero in the local ROM.',
    ],
    generatedAt: now,
    tool: 'tools/world-input-script-audit.mjs',
  };
  return changedType;
}

function updatePostInputZeroRegion(region, segment) {
  const previousType = region.type || 'unknown';
  region.type = 'null';
  region.bank = 7;
  region.name = 'zero padding after _DATA_1E7FF_ input script';
  region.source = region.source || 'analysis';
  region.notes = 'All-zero tail after the parsed _DATA_1E7FF_ input-control stream terminator at 0x1E97A.';
  region.analysis = region.analysis || {};
  region.analysis.inputScriptAudit = {
    kind: 'post_input_script_zero_padding',
    summary: 'All-zero tail after the parsed input-control stream.',
    confidence: 'high',
    typeBeforeAudit: previousType,
    typeAfterAudit: region.type,
    changedType: previousType !== region.type,
    catalogId,
    detail: {
      startOffset: segment.startOffset,
      endOffsetExclusive: segment.endOffsetExclusive,
      size: segment.size,
      contentClass: segment.contentClass,
      byteClassStats: segment.byteClassStats,
    },
    evidence: [
      ...inputScriptTailEvidence(),
      'All bytes in this tail segment are zero in the local ROM.',
    ],
    generatedAt: now,
    tool: 'tools/world-input-script-audit.mjs',
  };
}

function updateBankMarkerRegion(region, segment) {
  const previousType = region.type || 'unknown';
  region.type = 'text';
  region.bank = 7;
  region.name = 'bank 7 printable marker @ 0x1FFF0';
  region.source = region.source || 'analysis';
  region.notes = 'Printable 16-byte bank marker at the end of bank 7; marker bytes are not embedded in map metadata.';
  region.analysis = region.analysis || {};
  region.analysis.inputScriptAudit = {
    kind: 'bank_end_printable_marker',
    summary: 'Printable bank marker after the input-script zero tail.',
    confidence: 'high',
    typeBeforeAudit: previousType,
    typeAfterAudit: region.type,
    changedType: previousType !== region.type,
    catalogId,
    detail: {
      startOffset: segment.startOffset,
      endOffsetExclusive: segment.endOffsetExclusive,
      size: segment.size,
      contentClass: segment.contentClass,
      byteClassStats: segment.byteClassStats,
    },
    evidence: [
      ...inputScriptTailEvidence(),
      'All 16 marker bytes are printable ASCII in the local ROM; the bytes themselves are intentionally not stored in metadata.',
    ],
    generatedAt: now,
    tool: 'tools/world-input-script-audit.mjs',
  };
}

function insertAfterRegion(mapData, afterRegion, newRegion) {
  const index = mapData.regions.indexOf(afterRegion);
  if (index >= 0) mapData.regions.splice(index + 1, 0, newRegion);
  else mapData.regions.push(newRegion);
  return newRegion;
}

function ensureTailRegion(mapData, afterRegion, segment, type, updater) {
  const start = parseInt(segment.startOffset, 16);
  let region = findExactRegion(mapData, start, segment.size);
  const created = !region;
  if (!region) {
    region = insertAfterRegion(mapData, afterRegion, {
      offset: segment.startOffset,
      size: segment.size,
      type,
      bank: 7,
      source: 'analysis',
      id: nextRegionId(mapData),
    });
  }
  updater(region, segment);
  return { region, created };
}

function splitInputScriptRegion(mapData, scriptRegion, catalog) {
  const parsedLength = catalog.stream.parsed.parsedByteLength;
  const parsedEnd = parseInt(catalog.stream.parsed.terminatorOffset, 16);
  const zeroSegment = catalog.stream.zeroTail?.segments?.find(segment =>
    segment.contentClass === 'zero_padding' &&
    parseInt(segment.startOffset, 16) === parsedEnd + 1
  );
  const markerSegment = catalog.stream.zeroTail?.segments?.find(segment =>
    segment.contentClass === 'printable_ascii_marker' &&
    parseInt(segment.endOffsetExclusive, 16) === BANK7_END_EXCLUSIVE
  );

  const changes = {
    resizedInputScriptRegion: false,
    createdTailRegions: [],
    evidenceOnlyTailRegions: [],
    skipped: [],
  };

  if (!zeroSegment || !markerSegment) {
    changes.skipped.push('Expected zero-padding and printable-marker tail segments were not both present.');
    return changes;
  }

  if (parseInt(scriptRegion.offset, 16) !== MAIN_SCRIPT_OFFSET) {
    changes.skipped.push('Input-script region does not start at _DATA_1E7FF_.');
    return changes;
  }

  if ((scriptRegion.size || 0) < parsedLength) {
    changes.skipped.push('Input-script region is shorter than the parsed stream length.');
    return changes;
  }

  if ((scriptRegion.size || 0) !== parsedLength) {
    scriptRegion.size = parsedLength;
    scriptRegion.notes = 'Parsed _DATA_1E7FF_ input-control stream; tail zero padding and bank marker are split into adjacent metadata regions.';
    changes.resizedInputScriptRegion = true;
  }

  const zeroChange = ensureTailRegion(mapData, scriptRegion, zeroSegment, 'null', updatePostInputZeroRegion);
  const markerChange = ensureTailRegion(mapData, zeroChange.region, markerSegment, 'text', updateBankMarkerRegion);
  for (const item of [zeroChange, markerChange]) {
    const entry = {
      id: item.region.id,
      offset: item.region.offset,
      size: item.region.size,
      type: item.region.type,
      name: item.region.name || '',
    };
    (item.created ? changes.createdTailRegions : changes.evidenceOnlyTailRegions).push(entry);
  }
  return changes;
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const evidenceOnlyRegions = [];
  const missingRegions = [];
  let splitChanges = null;
  const scriptRegion = findContainingRegion(mapData, MAIN_SCRIPT_OFFSET);
  const paddingRegion = findContainingRegion(mapData, ZERO_PADDING_OFFSET);
  if (!scriptRegion) missingRegions.push({ offset: hex(MAIN_SCRIPT_OFFSET), kind: 'input_script' });
  if (!paddingRegion) missingRegions.push({ offset: hex(ZERO_PADDING_OFFSET), kind: 'zero_padding' });

  if (scriptRegion) {
    const wouldChange = ['unknown', 'raw_byte', 'data_table'].includes(scriptRegion.type || 'unknown') && scriptRegion.type !== 'input_script';
    if (apply) {
      const previousType = scriptRegion.type || 'unknown';
      const changed = updateInputScriptRegion(scriptRegion, catalog);
      splitChanges = splitInputScriptRegion(mapData, scriptRegion, catalog);
      (changed ? changedRegions : evidenceOnlyRegions).push({
        id: scriptRegion.id,
        offset: scriptRegion.offset,
        name: scriptRegion.name || '',
        previousType,
        type: scriptRegion.type || 'unknown',
        inferredType: 'input_script',
      });
    } else {
      (wouldChange ? changedRegions : evidenceOnlyRegions).push({
        id: scriptRegion.id,
        offset: scriptRegion.offset,
        name: scriptRegion.name || '',
        currentType: scriptRegion.type || 'unknown',
        inferredType: 'input_script',
      });
    }
  }

  if (paddingRegion && catalog.zeroPadding?.allZero) {
    const wouldChange = ['unknown', 'raw_byte', 'data_table'].includes(paddingRegion.type || 'unknown') && paddingRegion.type !== 'null';
    if (apply) {
      const previousType = paddingRegion.type || 'unknown';
      const changed = updateNullRegion(paddingRegion, catalog);
      (changed ? changedRegions : evidenceOnlyRegions).push({
        id: paddingRegion.id,
        offset: paddingRegion.offset,
        name: paddingRegion.name || '',
        previousType,
        type: paddingRegion.type || 'unknown',
        inferredType: 'null',
      });
    } else {
      (wouldChange ? changedRegions : evidenceOnlyRegions).push({
        id: paddingRegion.id,
        offset: paddingRegion.offset,
        name: paddingRegion.name || '',
        currentType: paddingRegion.type || 'unknown',
        inferredType: 'null',
      });
    }
  }
  return { changedRegions, evidenceOnlyRegions, missingRegions, splitChanges };
}

function collectConfirmedChangedRegions(mapData) {
  return mapData.regions
    .filter(region => region.analysis?.inputScriptAudit?.catalogId === catalogId && region.analysis.inputScriptAudit.changedType)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType: region.analysis.inputScriptAudit.typeBeforeAudit || 'unknown',
      type: region.type || 'unknown',
      kind: region.analysis.inputScriptAudit.kind,
    }));
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(rom, mapData);
    const confirmedChangedRegions = collectConfirmedChangedRegions(mapData);
    mapData.inputScriptCatalogs = (mapData.inputScriptCatalogs || []).filter(c => c.id !== catalogId);
    mapData.inputScriptCatalogs.push(finalCatalog);

    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'input_script_audit',
      generatedAt: now,
      tool: 'tools/world-input-script-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegionTypes: confirmedChangedRegions.length,
        changedRegionTypesThisRun: annotation.changedRegions.length,
        evidenceOnlyRegions: annotation.evidenceOnlyRegions.length,
        missingRegions: annotation.missingRegions.length,
        splitInputScriptRegion: annotation.splitChanges,
      },
      changedRegions: confirmedChangedRegions,
      changedRegionsThisRun: annotation.changedRegions,
      evidenceOnlyRegions: annotation.evidenceOnlyRegions,
      missingRegions: annotation.missingRegions,
      splitInputScriptRegion: annotation.splitChanges,
      stream: finalCatalog.stream,
      zeroPadding: finalCatalog.zeroPadding,
      nextLeads: [
        'Name each command bit in _RAM_D279_ and _RAM_CF95_ by tracing the movement/menu branches that test it.',
        'Find additional _LABEL_BFD_/_LABEL_BFED_ initialized streams and add them to the input script catalog.',
        'Split _DATA_1E7FF_ at the parsed terminator if the map editor gains non-destructive subregion support.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegionTypes: annotation.changedRegions.length,
    changedRegions: annotation.changedRegions,
    evidenceOnlyRegions: annotation.evidenceOnlyRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
