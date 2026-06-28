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
const toolName = 'tools/world-item-vram-selector-audit.mjs';
const catalogId = 'world-item-vram-selector-catalog-2026-06-26';
const reportId = 'item-vram-selector-audit-2026-06-26';
const schemaVersion = 1;

const dynamicCallerCatalogId = 'world-dynamic-vdp-upload-caller-catalog-2026-06-26';
const dynamicBankCatalogId = 'world-dynamic-vdp-bank-variable-catalog-2026-06-26';
const tileSizeBytes = 32;

const selectorSpecs = [
  {
    id: 'item_ids_00_0f_inline_1c1c',
    kind: 'inline_shared_stream',
    idStart: 0x00,
    idEndInclusive: 0x0F,
    streamOffset: 0x01C1C,
    selector: 'A < 0x10 selects fixed HL = 0x1C1C',
    evidenceLines: [4971, 4974, 4975, 4976, 4998, 4999],
  },
  {
    id: 'item_ids_10_1f_inline_1c23',
    kind: 'inline_shared_stream',
    idStart: 0x10,
    idEndInclusive: 0x1F,
    streamOffset: 0x01C23,
    selector: '0x10 <= A < 0x20 selects fixed HL = 0x1C23',
    evidenceLines: [4971, 4974, 4975, 4977, 4978, 4979, 4998, 4999],
  },
  {
    id: 'item_ids_20_2f_inline_1c2a',
    kind: 'inline_shared_stream',
    idStart: 0x20,
    idEndInclusive: 0x2F,
    streamOffset: 0x01C2A,
    selector: '0x20 <= A < 0x30 selects fixed HL = 0x1C2A',
    evidenceLines: [4971, 4974, 4975, 4977, 4978, 4980, 4998, 4999],
  },
  {
    id: 'item_ids_30_3f_bank4_window_13c00',
    kind: 'bank4_pointer_window',
    idStart: 0x30,
    idEndInclusive: 0x3F,
    tableBaseOffset: 0x13C00,
    tableRegionIds: ['r0348', 'r0349'],
    selector: '0x30 <= A < 0x40 selects bank-4 pointer window _DATA_13C00_ + ((A & 0x07) * 2); ids mirror every 8 values.',
    evidenceLines: [4983, 4984, 4986, 4987, 4988, 4989, 4998, 4999],
  },
  {
    id: 'item_ids_40_47_bank4_window_13c0a',
    kind: 'bank4_pointer_window',
    idStart: 0x40,
    idEndInclusive: 0x47,
    tableBaseOffset: 0x13C0A,
    tableRegionIds: ['r0349'],
    selector: '0x40 <= A < 0x48 selects bank-4 pointer window _DATA_13C0A_ + ((A & 0x07) * 2).',
    evidenceLines: [4983, 4984, 4992, 4993, 4994, 4995, 4998, 4999],
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value.replace(/^\$/, '0x'), 16);
  return NaN;
}

function regionStart(region) {
  return parseHex(region.offset);
}

function regionEnd(region) {
  return regionStart(region) + Number(region.size || 0);
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

function containingRegion(mapData, offset) {
  if (!Number.isFinite(offset)) return null;
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0)
      || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function readWordLE(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function z80BankedPointerToRomOffset(word, bank) {
  if (word < 0x8000 || word > 0xBFFF) return null;
  return bank * 0x4000 + (word - 0x8000);
}

function sourceFrom998Word(mapData, word, count) {
  const bank = word >> 9;
  const blockIndex = word & 0x01FF;
  const romStart = bank * 0x4000 + blockIndex * tileSizeBytes;
  const romEndExclusive = romStart + count * tileSizeBytes;
  return {
    sourceWord: hex(word, 4),
    sourceBank: bank,
    blockIndex: hex(blockIndex, 3),
    romStart: hex(romStart),
    romEndExclusive: hex(romEndExclusive),
    sizeBytes: romEndExclusive - romStart,
    tileCount: count,
    sourceRegion: compactRegion(containingRegion(mapData, romStart)),
  };
}

function decode998Stream(mapData, rom, startOffset, options = {}) {
  const maxEnd = options.endExclusive || Math.min(rom.length, startOffset + 0x100);
  const maxRecords = options.maxRecords || 16;
  const entries = [];
  const warnings = [];
  let pc = startOffset;
  let relativeVramTile = 0;
  let terminated = false;
  let endReason = 'not_terminated';

  for (let recordIndex = 0; recordIndex < maxRecords && pc < maxEnd; recordIndex++) {
    const recordOffset = pc;
    const opcode = rom[pc++];
    if (opcode === 0x00) {
      terminated = true;
      endReason = `terminator_at_${hex(recordOffset)}`;
      break;
    }

    const setPosition = Boolean(opcode & 0x80);
    const count = opcode & 0x7F;
    let explicitTileSlot = null;
    if (setPosition) {
      if (pc >= maxEnd) {
        warnings.push(`Truncated set-position record at ${hex(recordOffset)}.`);
        break;
      }
      explicitTileSlot = rom[pc++];
      relativeVramTile = explicitTileSlot;
    }

    if (count === 0x7F) {
      entries.push({
        recordIndex,
        kind: 'zero_fill_tile',
        recordOffset: hex(recordOffset),
        count: 1,
        setPosition,
        explicitTileSlot: explicitTileSlot == null ? null : hex(explicitTileSlot, 2),
        relativeVramTileRange: {
          start: hex(relativeVramTile, 3),
          endExclusive: hex(relativeVramTile + 1, 3),
          count: 1,
        },
        source: null,
      });
      relativeVramTile += 1;
      continue;
    }

    if (pc + 1 >= maxEnd) {
      warnings.push(`Truncated source word at ${hex(recordOffset)}.`);
      break;
    }
    const sourceWordOffset = pc;
    const sourceWord = readWordLE(rom, pc);
    pc += 2;
    const source = sourceFrom998Word(mapData, sourceWord, count);
    entries.push({
      recordIndex,
      kind: 'copy_tiles',
      recordOffset: hex(recordOffset),
      sourceWordOffset: hex(sourceWordOffset),
      count,
      setPosition,
      explicitTileSlot: explicitTileSlot == null ? null : hex(explicitTileSlot, 2),
      relativeVramTileRange: {
        start: hex(relativeVramTile, 3),
        endExclusive: hex(relativeVramTile + count, 3),
        count,
      },
      source,
    });
    relativeVramTile += count;
  }

  if (!terminated && pc >= maxEnd) warnings.push(`Stream reached decode bound ${hex(maxEnd)} without a terminator.`);
  if (!terminated && entries.length >= maxRecords) warnings.push(`Stream reached record bound ${maxRecords} without a terminator.`);

  return {
    startOffset: hex(startOffset),
    endOffsetExclusive: hex(pc),
    consumedBytes: pc - startOffset,
    terminated,
    endReason,
    recordCount: entries.length,
    copyRecordCount: entries.filter(entry => entry.kind === 'copy_tiles').length,
    zeroFillRecordCount: entries.filter(entry => entry.kind === 'zero_fill_tile').length,
    copiedTileCount: entries
      .filter(entry => entry.kind === 'copy_tiles')
      .reduce((sum, entry) => sum + entry.count, 0),
    zeroFillTileCount: entries
      .filter(entry => entry.kind === 'zero_fill_tile')
      .reduce((sum, entry) => sum + entry.count, 0),
    sourceBanks: [...new Set(entries.map(entry => entry.source?.sourceBank).filter(Number.isFinite))].sort((a, b) => a - b),
    sourceRegions: [...new Map(entries
      .map(entry => entry.source?.sourceRegion)
      .filter(Boolean)
      .map(region => [region.id, region])).values()],
    entries,
    warnings,
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
  };
}

function itemIdsForSpec(spec, index = null) {
  const ids = [];
  for (let id = spec.idStart; id <= spec.idEndInclusive; id++) {
    if (index == null || (id & 0x07) === index) ids.push(id);
  }
  return ids.map(id => hex(id, 2));
}

function streamSummary(stream) {
  return {
    startOffset: stream.startOffset,
    endOffsetExclusive: stream.endOffsetExclusive,
    consumedBytes: stream.consumedBytes,
    terminated: stream.terminated,
    recordCount: stream.recordCount,
    copyRecordCount: stream.copyRecordCount,
    zeroFillRecordCount: stream.zeroFillRecordCount,
    copiedTileCount: stream.copiedTileCount,
    zeroFillTileCount: stream.zeroFillTileCount,
    sourceBanks: stream.sourceBanks,
    sourceRegions: stream.sourceRegions,
    warnings: stream.warnings,
  };
}

function decodeInlineSelector(mapData, rom, spec) {
  const stream = decode998Stream(mapData, rom, spec.streamOffset, { maxRecords: 8 });
  const region = compactRegion(containingRegion(mapData, spec.streamOffset));
  return {
    id: spec.id,
    kind: spec.kind,
    itemIds: itemIdsForSpec(spec),
    itemIdRange: { start: hex(spec.idStart, 2), endInclusive: hex(spec.idEndInclusive, 2) },
    selector: spec.selector,
    streamOffset: hex(spec.streamOffset),
    streamRegion: region,
    stream: streamSummary(stream),
    records: stream.entries,
    confidence: stream.terminated ? 'high' : 'medium',
    evidenceLines: spec.evidenceLines,
  };
}

function decodePointerSelector(mapData, rom, spec) {
  const entries = [];
  for (let index = 0; index < 8; index++) {
    const tableEntryOffset = spec.tableBaseOffset + index * 2;
    const pointerWord = readWordLE(rom, tableEntryOffset);
    const targetOffset = z80BankedPointerToRomOffset(pointerWord, 4);
    const targetRegion = targetOffset == null ? null : compactRegion(containingRegion(mapData, targetOffset));
    const pointerRegion = compactRegion(containingRegion(mapData, tableEntryOffset));
    let stream = null;
    let status = 'valid_bank4_pointer_stream';
    let confidence = 'high';
    if (targetOffset == null || targetRegion == null) {
      status = 'invalid_or_out_of_range_pointer_word';
      confidence = 'medium_high';
    } else {
      stream = decode998Stream(mapData, rom, targetOffset, {
        endExclusive: regionEnd(findRegionById(mapData, targetRegion.id) || targetRegion),
        maxRecords: 8,
      });
      if (!stream.terminated) {
        status = 'decoded_stream_without_terminator_inside_region';
        confidence = 'medium';
      }
    }
    entries.push({
      index,
      itemIds: itemIdsForSpec(spec, index),
      tableEntryOffset: hex(tableEntryOffset),
      pointerRegion,
      pointerWord: hex(pointerWord, 4),
      targetOffset: targetOffset == null ? null : hex(targetOffset),
      targetRegion,
      status,
      confidence,
      stream: stream ? streamSummary(stream) : null,
      records: stream ? stream.entries : [],
    });
  }
  return {
    id: spec.id,
    kind: spec.kind,
    itemIds: itemIdsForSpec(spec),
    itemIdRange: { start: hex(spec.idStart, 2), endInclusive: hex(spec.idEndInclusive, 2) },
    selector: spec.selector,
    tableBaseOffset: hex(spec.tableBaseOffset),
    tableRegions: spec.tableRegionIds.map(id => compactRegion(findRegionById(mapData, id))).filter(Boolean),
    entries,
    validEntryCount: entries.filter(entry => entry.status === 'valid_bank4_pointer_stream').length,
    invalidEntryCount: entries.filter(entry => entry.status !== 'valid_bank4_pointer_stream').length,
    uniqueTargetRegionCount: new Set(entries.map(entry => entry.targetRegion?.id).filter(Boolean)).size,
    evidenceLines: spec.evidenceLines,
  };
}

function collectSourceRanges(selectors) {
  const ranges = [];
  for (const selector of selectors) {
    const selectorEntries = selector.kind === 'bank4_pointer_window' ? selector.entries : [selector];
    for (const selectorEntry of selectorEntries) {
      const records = selectorEntry.records || [];
      for (const record of records) {
        if (!record.source) continue;
        ranges.push({
          selectorId: selector.id,
          itemIds: selectorEntry.itemIds || selector.itemIds,
          recordOffset: record.recordOffset,
          source: record.source,
        });
      }
    }
  }
  return ranges;
}

function mergeRanges(ranges) {
  const sorted = ranges
    .map(range => ({
      start: parseHex(range.source.romStart),
      endExclusive: parseHex(range.source.romEndExclusive),
      sourceRegion: range.source.sourceRegion,
    }))
    .filter(range => Number.isFinite(range.start) && Number.isFinite(range.endExclusive))
    .sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.endExclusive) {
      merged.push({
        start: range.start,
        endExclusive: range.endExclusive,
        sourceRegions: new Map(range.sourceRegion ? [[range.sourceRegion.id, range.sourceRegion]] : []),
      });
      continue;
    }
    if (range.endExclusive > last.endExclusive) last.endExclusive = range.endExclusive;
    if (range.sourceRegion) last.sourceRegions.set(range.sourceRegion.id, range.sourceRegion);
  }
  return merged.map(range => ({
    romStart: hex(range.start),
    romEndExclusive: hex(range.endExclusive),
    sizeBytes: range.endExclusive - range.start,
    tileCount: (range.endExclusive - range.start) / tileSizeBytes,
    sourceRegions: [...range.sourceRegions.values()],
  }));
}

function buildCatalog(mapData, rom) {
  const dynamicCallerCatalog = findCatalog(mapData, dynamicCallerCatalogId);
  const dynamicBankCatalog = findCatalog(mapData, dynamicBankCatalogId);
  const selectors = selectorSpecs.map(spec => (spec.kind === 'bank4_pointer_window'
    ? decodePointerSelector(mapData, rom, spec)
    : decodeInlineSelector(mapData, rom, spec)));
  const sourceRanges = collectSourceRanges(selectors);
  const mergedSourceRanges = mergeRanges(sourceRanges);
  const invalidPointerEntries = selectors
    .flatMap(selector => selector.entries || [])
    .filter(entry => entry.status !== 'valid_bank4_pointer_stream');
  const streamRegions = [...new Map(selectors
    .flatMap(selector => selector.kind === 'bank4_pointer_window'
      ? selector.entries.map(entry => entry.targetRegion).filter(Boolean)
      : [selector.streamRegion].filter(Boolean))
    .map(region => [region.id, region])).values()]
    .sort((a, b) => parseHex(a.offset) - parseHex(b.offset));
  const sourceRegions = [...new Map(sourceRanges
    .map(range => range.source.sourceRegion)
    .filter(Boolean)
    .map(region => [region.id, region])).values()]
    .sort((a, b) => parseHex(a.offset) - parseHex(b.offset));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [dynamicCallerCatalogId, dynamicBankCatalogId],
    summary: {
      dynamicCallerCatalogPresent: Boolean(dynamicCallerCatalog),
      dynamicBankCatalogPresent: Boolean(dynamicBankCatalog),
      selectorRoutine: '_LABEL_1BE0_',
      uploadRoutine: '_LABEL_99B_',
      itemIdAcceptedRange: '0x00-0x47',
      itemIdRejectsAtOrAbove: '0x48',
      selectorCount: selectors.length,
      inlineSelectorCount: selectors.filter(selector => selector.kind === 'inline_shared_stream').length,
      pointerWindowSelectorCount: selectors.filter(selector => selector.kind === 'bank4_pointer_window').length,
      pointerWindowEntryCount: selectors
        .filter(selector => selector.kind === 'bank4_pointer_window')
        .reduce((sum, selector) => sum + selector.entries.length, 0),
      validPointerEntryCount: selectors
        .filter(selector => selector.kind === 'bank4_pointer_window')
        .reduce((sum, selector) => sum + selector.validEntryCount, 0),
      invalidPointerEntryCount: invalidPointerEntries.length,
      streamRegionCount: streamRegions.length,
      copyRecordCount: sourceRanges.length,
      sourceRegionCount: sourceRegions.length,
      sourceRegions: sourceRegions.map(region => region.id),
      sourceBankCounts: countBy(sourceRanges, range => `0x${range.source.sourceBank.toString(16).toUpperCase().padStart(2, '0')}`),
      mergedSourceRangeCount: mergedSourceRanges.length,
      mergedSourceBytes: mergedSourceRanges.reduce((sum, range) => sum + range.sizeBytes, 0),
      mergedSourceTiles: mergedSourceRanges.reduce((sum, range) => sum + range.tileCount, 0),
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: item id ranges, selector offsets, pointer words, loader-record offsets/counts, source offsets/ranges, region ids, and evidence line numbers. No ROM bytes, decoded graphics, screenshots, audio, or rendered assets are embedded.',
    },
    selectorRoutine: {
      label: '_LABEL_1BE0_',
      region: compactRegion(findRegionById(mapData, 'r1765')),
      acceptedItemIdRange: { start: '0x00', endInclusive: '0x47' },
      rejectAtOrAbove: '0x48',
      destinationVramSource: '_RAM_D02A_',
      bankSetup: 'Writes bank 0x04 to _RAM_FFFF_ before selecting bank-4 pointer-table records; inline bank-0 streams are below 0x4000.',
      uploadRoutine: '_LABEL_99B_',
      evidenceLines: [4965, 4966, 4969, 4970, 4971, 4998, 4999],
    },
    selectors,
    streamRegions,
    sourceRegions,
    sourceRanges,
    mergedSourceRanges,
    invalidPointerEntries,
    evidence: [
      'ASM lines 4965-4999 bound item id A below 0x48, select one of three inline streams or one of two bank-4 pointer windows, load DE from _RAM_D02A_, and jump to _LABEL_99B_.',
      `${dynamicCallerCatalogId} classifies _LABEL_1BE0_ as the only direct caller that jumps into _LABEL_99B_.`,
      `${dynamicBankCatalogId} supplies the _LABEL_99B_/_LABEL_9C3_ source-bank formula used to decode each loader record.`,
      'The pointer window at _DATA_13C00_ intentionally crosses the _DATA_13C0A_ label for indices 5-7 because runtime indexing uses A & 0x07.',
      'The _DATA_13C0A_ window index 7 does not decode to a valid bank-4 pointer and is retained as an invalid/likely-unused selector entry.',
      'No ROM bytes, decoded graphics, screenshots, audio, or rendered assets are stored.',
    ],
    nextLeads: [
      'Trace the caller of _LABEL_1BE0_ to determine which item ids 0x00-0x47 are actually reachable in gameplay.',
      'Use the decoded sourceRanges as an item_vram_loader_998 source family in a future combined coverage refresh if any ranges are not already covered.',
      'Refine bank-4 pointer table region boundaries or names only after confirming whether old entity-animation labels share this same item VRAM loader role.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const regionRoles = new Map();
  const addRole = (region, payload) => {
    if (!region) return;
    if (!regionRoles.has(region.id)) {
      regionRoles.set(region.id, {
        region,
        roles: [],
      });
    }
    regionRoles.get(region.id).roles.push(payload);
  };

  addRole(findRegionById(mapData, 'r1765'), {
    role: 'item_vram_selector_routine',
    confidence: 'high',
    summary: 'Selects _LABEL_99B_ VRAM loader streams by item id A.',
    detail: catalog.selectorRoutine,
  });
  addRole(findRegionById(mapData, 'r0021'), {
    role: 'inline_item_vram_loader_streams',
    confidence: 'high',
    summary: 'Carries three inline _LABEL_99B_ streams selected for item ids 0x00-0x2F.',
    detail: {
      selectorIds: catalog.selectors
        .filter(selector => selector.kind === 'inline_shared_stream')
        .map(selector => selector.id),
    },
  });
  for (const selector of catalog.selectors.filter(item => item.kind === 'bank4_pointer_window')) {
    for (const tableRegion of selector.tableRegions || []) {
      addRole(findRegionById(mapData, tableRegion.id), {
        role: 'item_vram_pointer_window',
        confidence: 'high',
        summary: 'Bank-4 pointer window consumed by _LABEL_1BE0_ before jumping into _LABEL_99B_.',
        detail: {
          selectorId: selector.id,
          itemIdRange: selector.itemIdRange,
          validEntryCount: selector.validEntryCount,
          invalidEntryCount: selector.invalidEntryCount,
          runtimeIndex: 'A & 0x07',
        },
      });
    }
  }
  for (const streamRegion of catalog.streamRegions) {
    addRole(findRegionById(mapData, streamRegion.id), {
      role: 'item_vram_998_stream',
      confidence: 'high',
      summary: 'Pointer/inline target decoded as a _LABEL_99B_ VRAM loader stream for item graphics.',
      detail: {
        selectorIds: catalog.selectors
          .filter(selector => JSON.stringify(selector).includes(`"id":"${streamRegion.id}"`))
          .map(selector => selector.id),
      },
    });
  }
  for (const sourceRegion of catalog.sourceRegions) {
    addRole(findRegionById(mapData, sourceRegion.id), {
      role: 'item_vram_source_graphics_region',
      confidence: 'high',
      summary: 'Graphics source region read by item VRAM loader records selected through _LABEL_1BE0_.',
      detail: {
        sourceRangeCount: catalog.sourceRanges.filter(range => range.source.sourceRegion?.id === sourceRegion.id).length,
        mergedSourceRanges: catalog.mergedSourceRanges.filter(range => (range.sourceRegions || []).some(region => region.id === sourceRegion.id)),
      },
    });
  }

  const changedRegions = [];
  for (const { region, roles } of regionRoles.values()) {
    const roleCounts = countBy(roles, item => item.role);
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.itemVramSelectorAudit = {
        catalogId,
        kind: 'item_vram_selector_region_role_overlay',
        confidence: roles.every(item => item.confidence === 'high') ? 'high' : 'medium',
        roles: [...new Set(roles.map(item => item.role))],
        roleCounts,
        summaries: roles.map(item => item.summary),
        details: roles.map(item => ({
          role: item.role,
          confidence: item.confidence,
          summary: item.summary,
          detail: item.detail,
        })),
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      roles: [...new Set(roles.map(item => item.role))],
      roleCounts,
      confidence: roles.every(item => item.confidence === 'high') ? 'high' : 'medium',
    });
  }
  return { changedRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.itemDataCatalogs = (mapData.itemDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.itemDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'item_vram_selector_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        changedRegionCount: annotation.changedRegions.length,
      },
      changedRegions: annotation.changedRegions,
      invalidPointerEntries: catalog.invalidPointerEntries,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      changedRegionCount: annotation.changedRegions.length,
    },
    invalidPointerEntries: catalog.invalidPointerEntries,
    changedRegions: annotation.changedRegions,
  }, null, 2));
}

main();
