#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-unresolved-asset-consumer-catalog-2026-06-25';
const reportId = 'unresolved-asset-consumer-audit-2026-06-25';
const toolName = 'tools/world-unresolved-asset-consumer-audit.mjs';

const candidateDefs = [
  {
    regionId: 'r2818',
    role: 'room_tail_entity_empty_list_sentinel',
    summary: 'Confirmed shared empty room entity-list sentinel after room-subrecord-selected 8FB loader data.',
    parentLabels: ['_DATA_12337_'],
    shape: { byteCount: 1, consumerExpectation: 'room entity list terminator selected through the CF62 subrecord pointer field' },
    evidence: [
      'Room entity list audit confirms 0x12D90 as the shared 0xFF empty-list sentinel selected through _RAM_CF62_.',
      'The older whole-tail 32-byte graphics candidate is superseded by the room entity list split.',
    ],
  },
  {
    regionId: 'r2820',
    role: 'orphan_room_entity_source_lists_unreferenced',
    summary: 'Structurally confirmed orphan room entity source-list block with no confirmed room-subrecord consumer.',
    parentLabels: ['_DATA_12337_'],
    shape: { byteCount: 1832, consumerExpectation: 'room entity source-list format confirmed; runtime consumer still unconfirmed' },
    evidence: [
      'Room entity list audit split the old 0x12D90-0x13ACF mixed candidate into a confirmed empty-list sentinel, this unresolved middle span, and confirmed entity source lists.',
      'Room entity orphan-list audit decodes this span completely as terminated room entity source lists.',
      'Confirmed room subrecord CF62 pointers reach the 0x12D90 sentinel and 0x134B9-0x13ACF entity lists, but not this orphan span.',
    ],
  },
  {
    regionId: 'r2817',
    role: 'palette_tail_tile_map_candidate',
    summary: 'Low-confidence 15x16 one-byte tile/index payload candidate after _DATA_1CABB_ palette-script tail.',
    parentLabels: ['_DATA_1CABB_'],
    shape: { width: 16, height: 15, bytesPerCell: 1, consumerExpectation: 'tile-map copy or screen helper routine' },
    evidence: [
      'Palette-tail split audit records 240 explicit bytes from 0x1CBD0-0x1CCBF, exactly 15 rows by 16 one-byte cells.',
      'The parsed _DATA_1CABB_ palette script ends before this payload, and _DATA_1CCC0_ starts immediately after it.',
    ],
  },
  {
    regionId: 'r2815',
    role: 'palette_tail_short_payload_unresolved',
    summary: 'Seven-byte payload fragment after _DATA_1CABB_ fill blocks.',
    parentLabels: ['_DATA_1CABB_'],
    shape: { byteCount: 7, consumerExpectation: 'unknown small payload or sentinel fragment' },
    evidence: [
      'Palette-tail split audit keeps 0x1CBB9-0x1CBBF separate from surrounding fill blocks.',
    ],
  },
  {
    regionId: 'r2816',
    role: 'palette_tail_c1_fill_unresolved',
    summary: 'Sixteen-byte repeated-fill payload after _DATA_1CABB_ short fragment.',
    parentLabels: ['_DATA_1CABB_'],
    shape: { byteCount: 16, consumerExpectation: 'unknown fill block or tile/index initializer' },
    evidence: [
      'Palette-tail split audit records the 0x1CBC0-0x1CBCF block as explicit 0xC1 fill with unresolved consumer.',
    ],
  },
  {
    regionId: 'r2747',
    role: 'pause_status_destination_payload_unresolved',
    summary: 'Word-shaped payload after _DATA_1DD64_ pause/status pointer record.',
    parentLabels: ['_DATA_1DD64_'],
    shape: { byteCount: 158, consumerExpectation: 'pause/status VDP destination or offset payload' },
    evidence: [
      'Pause/status loader-bundle audit records this as adjacent payload after _DATA_1DD64_.',
      'The same audit keeps the role unresolved because no exact executable consumer is confirmed.',
    ],
  },
  {
    regionId: 'r2748',
    role: 'pause_status_ram_payload_unresolved',
    summary: 'Word-shaped payload after _DATA_1DE04_ pause/status RAM-buffer pointer record.',
    parentLabels: ['_DATA_1DE04_'],
    shape: { byteCount: 26, consumerExpectation: 'pause/status RAM buffer or offset payload' },
    evidence: [
      'Pause/status loader-bundle audit records this as adjacent payload after _DATA_1DE04_.',
      'The same audit keeps the role unresolved because no exact executable consumer is confirmed.',
    ],
  },
  {
    regionId: 'r2813',
    role: 'room_overlay_tail_unresolved',
    summary: 'Two-byte unresolved tail after room overlay tile records.',
    parentLabels: ['_DATA_1071A_'],
    shape: { byteCount: 2, consumerExpectation: 'room overlay trailing word or padding' },
    evidence: [
      'Room overlay record audit keeps this two-byte tail separate because it is not part of the confirmed overlay record set.',
    ],
  },
  {
    regionId: 'r0749',
    role: 'bank7_graphics_loader_candidate_rejected_alias_context',
    summary: 'Bank-7 data block previously shaped like a loader candidate; direct consumer audit currently rejects it as a bank-alias false lead.',
    parentLabels: ['_DATA_1E337_'],
    shape: { byteCount: 41, consumerExpectation: 'would need a real direct loader call to _DATA_1E337_' },
    evidence: [
      'Graphics-loader candidate consumer audit found the only loader-adjacent reference resolves to _DATA_12337_, not _DATA_1E337_.',
    ],
  },
];

const pointerSourceTypes = new Set([
  'pointer_table',
  'screen_prog_table',
  'palette_script_table',
  'room_subrecord',
  'room_seq_table',
  'data_table',
]);

const mediumPointerSourceTypes = new Set([
  'pointer_table',
  'screen_prog_table',
  'palette_script_table',
  'room_subrecord',
  'room_seq_table',
]);

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
}

function endOf(region) {
  return offsetOf(region) + (region.size || 0);
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

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offset >= offsetOf(region) && offset < endOf(region)) || null;
}

function regionAnalysisSummary(region) {
  return Object.entries(region.analysis || {})
    .map(([audit, value]) => ({
      audit,
      kind: value?.kind || value?.status || value?.consumerStatus || null,
      confidence: value?.confidence || null,
      summary: value?.summary ? String(value.summary).slice(0, 180) : null,
    }))
    .slice(0, 8);
}

function boundaryRegionRef(region, candidateStart, candidateEndExclusive) {
  if (!region) return null;
  const start = offsetOf(region);
  const endExclusive = endOf(region);
  return {
    ...regionRef(region),
    endInclusive: hex(endExclusive - 1),
    distanceBytes: endExclusive <= candidateStart
      ? candidateStart - endExclusive
      : start >= candidateEndExclusive
        ? start - candidateEndExclusive
        : 0,
    adjacent: endExclusive === candidateStart || start === candidateEndExclusive,
    analysis: regionAnalysisSummary(region),
  };
}

function decodedLoaderBoundary(rom, region) {
  if (!region || (region.type !== 'vram_loader_8fb' && region.type !== 'vram_loader_998')) return null;
  const start = offsetOf(region);
  const decoded = region.type === 'vram_loader_8fb'
    ? decodeVramLoader8fb(rom, start)
    : decodeVramLoader998(rom, start);
  const decodedEndExclusive = start + decoded.consumedBytes;
  return {
    loaderRegion: regionRef(region),
    loaderType: region.type,
    entryCount: decoded.entries.length,
    totalTiles: decoded.entries.reduce((sum, entry) => sum + (entry.count || 0), 0),
    consumedBytes: decoded.consumedBytes,
    terminated: decoded.terminated,
    decodedEndExclusive: hex(decodedEndExclusive),
    terminatorOffset: decoded.terminated ? hex(decodedEndExclusive - 1) : null,
    endsAtMappedRegionEnd: decodedEndExclusive === endOf(region),
    warnings: decoded.warnings.slice(0, 8),
  };
}

function consumerBoundaryEvidence(rom, mapData, region) {
  const start = offsetOf(region);
  const endExclusive = endOf(region);
  const regions = [...(mapData.regions || [])].sort((a, b) => offsetOf(a) - offsetOf(b));
  const index = regions.findIndex(item => item.id === region.id);
  const previous = index > 0 ? regions[index - 1] : null;
  const next = index >= 0 && index + 1 < regions.length ? regions[index + 1] : null;
  let previousNonNull = null;
  let nextNonNull = null;

  for (let i = index - 1; i >= 0; i--) {
    if ((regions[i].type || '') !== 'null') {
      previousNonNull = regions[i];
      break;
    }
  }
  for (let i = index + 1; i < regions.length; i++) {
    if ((regions[i].type || '') !== 'null') {
      nextNonNull = regions[i];
      break;
    }
  }

  const priorDecodedLoader = decodedLoaderBoundary(rom, previousNonNull);
  const followingDecodedLoader = decodedLoaderBoundary(rom, nextNonNull);
  const evidence = [];

  if (previous) {
    evidence.push(`Immediate previous mapped region ${previous.id} (${previous.type || 'unknown'}) ends ${start - endOf(previous)} byte(s) before this candidate.`);
  }
  if (next) {
    evidence.push(`Immediate next mapped region ${next.id} (${next.type || 'unknown'}) starts ${offsetOf(next) - endExclusive} byte(s) after this candidate.`);
  }
  if (priorDecodedLoader) {
    evidence.push(`Nearest previous non-null region ${previousNonNull.id} decodes as ${previousNonNull.type} and terminates at ${priorDecodedLoader.terminatorOffset || priorDecodedLoader.decodedEndExclusive}; candidate begins ${start - endOf(previousNonNull)} byte(s) after its mapped end.`);
  }
  if (followingDecodedLoader) {
    evidence.push(`Nearest next non-null region ${nextNonNull.id} decodes as ${nextNonNull.type}; its mapped start is ${offsetOf(nextNonNull) - endExclusive} byte(s) after this candidate.`);
  }

  return {
    previousRegion: boundaryRegionRef(previous, start, endExclusive),
    nextRegion: boundaryRegionRef(next, start, endExclusive),
    previousNonNullRegion: boundaryRegionRef(previousNonNull, start, endExclusive),
    nextNonNullRegion: boundaryRegionRef(nextNonNull, start, endExclusive),
    priorDecodedLoader,
    followingDecodedLoader,
    evidence,
  };
}

function bankForOffset(offset) {
  return Math.floor(offset / 0x4000);
}

function z80WindowPointer(offset) {
  const bank = bankForOffset(offset);
  if (bank === 0) return offset;
  if (bank === 1) return 0x4000 + (offset % 0x4000);
  return 0x8000 + (offset % 0x4000);
}

function decodeVramLoader8fb(rom, offset) {
  const entries = [];
  let pc = offset;
  let curVramTile = 0;
  let curBank = 8;
  let curBlockIdx = 0;
  const warnings = [];

  for (let entryIndex = 0; entryIndex < 256 && pc < rom.length; entryIndex++) {
    const entryOffset = pc;
    const count = rom[pc++];
    if (count === 0) {
      return { terminated: true, entries, warnings, consumedBytes: pc - offset };
    }
    if (pc + 3 >= rom.length) {
      warnings.push(`entry ${entryIndex} truncated at ${hex(entryOffset)}`);
      break;
    }
    const vramLo = rom[pc++];
    const vramHi = rom[pc++];
    const srcLo = rom[pc++];
    const srcHi = rom[pc++];
    const vramWord = vramLo | (vramHi << 8);
    const srcWord = srcLo | (srcHi << 8);
    if (vramWord !== 0xFFFF) curVramTile = vramWord;
    if (srcWord !== 0xFFFF) {
      curBank = srcHi >> 1;
      curBlockIdx = ((srcHi & 1) << 8) | srcLo;
    }
    const sourceStart = curBank * 0x4000 + curBlockIdx * 32;
    entries.push({
      entryIndex,
      entryOffset,
      count,
      sourceStart,
      sourceEndExclusive: sourceStart + count * 32,
      vramTileStart: curVramTile,
      vramTileEndExclusive: curVramTile + count,
    });
    curVramTile += count;
    curBlockIdx += count;
  }
  return { terminated: false, entries, warnings, consumedBytes: pc - offset };
}

function decodeVramLoader998(rom, offset) {
  const entries = [];
  let pc = offset;
  let curVramTile = 0;
  const warnings = [];

  for (let entryIndex = 0; entryIndex < 256 && pc < rom.length; entryIndex++) {
    const entryOffset = pc;
    const control = rom[pc++];
    if (control === 0) {
      return { terminated: true, entries, warnings, consumedBytes: pc - offset };
    }
    if (pc + 1 >= rom.length) {
      warnings.push(`entry ${entryIndex} truncated at ${hex(entryOffset)}`);
      break;
    }
    const lo = rom[pc++];
    const hi = rom[pc++];
    if (control & 0x80) {
      curVramTile = lo | (hi << 8);
      entries.push({
        entryIndex,
        entryOffset,
        count: 0,
        vramTileStart: curVramTile,
        vramTileEndExclusive: curVramTile,
      });
      continue;
    }
    const count = control;
    const bank = hi >> 1;
    const block = ((hi & 1) << 8) | lo;
    const sourceStart = bank * 0x4000 + block * 32;
    entries.push({
      entryIndex,
      entryOffset,
      count,
      sourceStart,
      sourceEndExclusive: sourceStart + count * 32,
      vramTileStart: curVramTile,
      vramTileEndExclusive: curVramTile + count,
    });
    curVramTile += count;
  }
  return { terminated: false, entries, warnings, consumedBytes: pc - offset };
}

function loaderSourceHits(rom, mapData, start, endExclusive) {
  const hits = [];
  for (const region of mapData.regions || []) {
    if (region.type !== 'vram_loader_8fb' && region.type !== 'vram_loader_998') continue;
    const decoded = region.type === 'vram_loader_8fb'
      ? decodeVramLoader8fb(rom, offsetOf(region))
      : decodeVramLoader998(rom, offsetOf(region));
    for (const entry of decoded.entries) {
      if (entry.sourceStart == null) continue;
      if (entry.sourceStart < endExclusive && entry.sourceEndExclusive > start) {
        hits.push({
          loaderRegion: regionRef(region),
          loaderType: region.type,
          entryIndex: entry.entryIndex,
          entryOffset: hex(entry.entryOffset),
          count: entry.count,
          sourceRange: [hex(entry.sourceStart), hex(entry.sourceEndExclusive - 1)],
          overlapRange: [hex(Math.max(entry.sourceStart, start)), hex(Math.min(entry.sourceEndExclusive, endExclusive) - 1)],
        });
      }
    }
  }
  return hits;
}

function structuredPointerRefs(rom, mapData, candidateRegion) {
  const start = offsetOf(candidateRegion);
  const endExclusive = endOf(candidateRegion);
  const candidateBank = bankForOffset(start);
  const z80Start = z80WindowPointer(start);
  const z80EndExclusive = z80Start + (endExclusive - start);
  const refs = [];

  for (const sourceRegion of mapData.regions || []) {
    const sourceType = sourceRegion.type || 'unknown';
    if (!pointerSourceTypes.has(sourceType)) continue;
    const sourceStart = offsetOf(sourceRegion);
    const sourceEnd = endOf(sourceRegion);
    const pointerBankContext = pointerBankContextForRegion(sourceRegion);
    const sourceBank = pointerBankContext.bank;
    if (sourceStart < endExclusive && sourceEnd > start) continue;
    for (const offset of pointerWordOffsetsForRegion(sourceRegion)) {
      if (offset + 1 >= sourceEnd || offset + 1 >= rom.length) continue;
      const word = rom[offset] | (rom[offset + 1] << 8);
      if (word >= z80Start && word < z80EndExclusive) {
        const bankContextMatches = sourceBank === candidateBank;
        const pointerBearing = mediumPointerSourceTypes.has(sourceType);
        refs.push({
          sourceRegion: regionRef(sourceRegion),
          sourceBank,
          sourceBankContextReason: pointerBankContext.reason,
          sourceOffset: hex(offset),
          pointerWord: hex(word, 4),
          targetOffset: hex(start + (word - z80Start)),
          confidence: pointerBearing && bankContextMatches ? 'medium' : 'low',
          reason: pointerBearing && bankContextMatches
            ? 'little-endian word in a same-bank pointer-bearing region resolves into the candidate range'
            : 'word-shaped hit kept as a low-confidence lead because the source is not a same-bank pointer-bearing region',
        });
      }
    }
  }
  return refs.sort((a, b) => a.sourceOffset.localeCompare(b.sourceOffset));
}

function pointerWordOffsetsForRegion(sourceRegion) {
  const sourceType = sourceRegion.type || 'unknown';
  const sourceStart = offsetOf(sourceRegion);
  const sourceEnd = endOf(sourceRegion);

  if (sourceType === 'room_subrecord') {
    const subrecordRange = sourceRegion.analysis?.roomSubrecordAudit?.layout?.subrecordRange;
    const rangeStart = subrecordRange ? parseInt(subrecordRange.offset, 16) : sourceStart;
    const stride = subrecordRange?.stride || 18;
    const count = subrecordRange?.count || Math.floor((sourceEnd - rangeStart) / stride);
    const offsets = [];
    for (let index = 0; index < count; index++) {
      const recordStart = rangeStart + index * stride;
      for (const fieldOffset of [0, 8]) {
        const offset = recordStart + fieldOffset;
        if (offset >= sourceStart && offset + 1 < sourceEnd) offsets.push(offset);
      }
    }
    return offsets;
  }

  const offsets = [];
  const step = 2;
  for (let offset = sourceStart; offset + 1 < sourceEnd; offset += step) {
    offsets.push(offset);
  }
  return offsets;
}

function pointerBankContextForRegion(sourceRegion) {
  const sourceStart = offsetOf(sourceRegion);
  if (sourceStart === 0x1071A) {
    return {
      bank: 6,
      reason: '_DATA_1071A_ is the _RAM_C34E_ metasprite-family table; its ROM pointers target the bank-6 window even though the table bytes live in bank 4.',
    };
  }
  return {
    bank: Number.isFinite(sourceRegion.bank) ? sourceRegion.bank : bankForOffset(sourceStart),
    reason: 'source region bank context',
  };
}

function asmLabelDefinitions(asmText) {
  const defs = new Map();
  const lines = asmText.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const match = /^(_(?:DATA|LABEL)_[0-9A-F]+_):/.exec(line);
    if (!match) continue;
    const offset = parseInt(match[1].split('_')[2], 16);
    defs.set(match[1], { label: match[1], offset, line: index + 1 });
  }
  return defs;
}

function asmRefsForLabels(asmText, labels) {
  const result = [];
  const lines = asmText.split(/\r?\n/);
  const labelSet = new Set(labels);
  for (const [index, line] of lines.entries()) {
    for (const label of labelSet) {
      if (!line.includes(label)) continue;
      if (line.startsWith(`${label}:`)) continue;
      result.push({
        label,
        line: index + 1,
        context: line.trim().replace(/\s+/g, ' ').slice(0, 160),
      });
    }
  }
  return result;
}

function confirmedConsumerForRegion(region) {
  const dynamicTiles = region.analysis?.dynamicTileSourceTableAudit;
  if (dynamicTiles?.confidence === 'high') {
    return {
      consumerStatus: 'consumer_confirmed_dynamic_tile_source_table',
      confidence: 'high',
      summary: dynamicTiles.summary || 'Confirmed dynamic tile source table data used by _LABEL_2948_/_LABEL_A97_.',
      evidence: [
        'world-dynamic-tile-source-table-catalog-2026-06-25 proves this region is part of the _LABEL_2948_ dynamic tile source table model.',
        ...(dynamicTiles.evidence || []).slice(0, 6),
      ],
    };
  }

  const entityList = region.analysis?.roomEntityListAudit;
  if (
    entityList?.kind === 'empty_room_entity_list_sentinel' ||
    entityList?.kind === 'room_entity_empty_list_sentinel' ||
    entityList?.kind === 'room_entity_source_lists'
  ) {
    return {
      consumerStatus: (
        entityList.kind === 'empty_room_entity_list_sentinel' ||
        entityList.kind === 'room_entity_empty_list_sentinel'
      )
        ? 'consumer_confirmed_room_entity_empty_list'
        : 'consumer_confirmed_room_entity_source_lists',
      confidence: 'high',
      summary: entityList.summary || 'Confirmed room entity data selected through the room subrecord CF62 pointer field.',
      evidence: [
        'world-room-entity-list-catalog-2026-06-25 proves this region is reached through _RAM_CF62_ and decoded by _LABEL_2948_/_LABEL_2963_.',
        ...(entityList.evidence || []).slice(0, 6),
      ],
    };
  }

  return null;
}

function refinedConsumerForRegion(region) {
  const orphanEntity = region.analysis?.roomEntityOrphanListAudit;
  if (orphanEntity?.confidence === 'high') {
    return {
      catalogId: orphanEntity.catalogId,
      consumerStatus: 'consumer_unresolved_orphan_room_entity_lists',
      confidence: 'high',
      kind: orphanEntity.kind || 'orphan_room_entity_source_lists',
      summary: orphanEntity.summary || 'Structurally confirmed orphan room entity source-list block; runtime consumer remains unconfirmed.',
      decodedListCount: orphanEntity.decodedListCount || 0,
      decodedEntityRecords: orphanEntity.decodedEntityRecords || 0,
      subrecordPointerRefsIntoSpan: orphanEntity.subrecordPointerRefsIntoSpan || 0,
    };
  }

  const loaderCandidateConsumer = region.analysis?.graphicsLoaderCandidateConsumerAudit;
  if (
    loaderCandidateConsumer?.status === 'no_confirmed_consumer_bank_alias_collision' &&
    loaderCandidateConsumer.promotionAllowed === false
  ) {
    return {
      catalogId: loaderCandidateConsumer.catalogId,
      consumerStatus: 'consumer_unresolved_loader_shape_rejected_bank_alias',
      confidence: loaderCandidateConsumer.confidence || 'high',
      kind: 'loader_shape_rejected_bank_alias_collision',
      summary: loaderCandidateConsumer.reason || 'Shape-compatible loader candidate is rejected because the only loader-adjacent banked reference resolves to a different ROM-bank alias.',
      candidateLabel: loaderCandidateConsumer.candidateLabel || '',
      z80Address: loaderCandidateConsumer.z80Address || '',
      directCandidateRefCount: loaderCandidateConsumer.directCandidateRefCount || 0,
      aliasCount: loaderCandidateConsumer.aliasCount || 0,
      rawZ80WordOccurrenceCount: loaderCandidateConsumer.rawZ80WordOccurrenceCount || 0,
    };
  }

  const paletteTail = region.analysis?.paletteTailConsumerAudit;
  if (paletteTail?.consumerStatus) {
    return {
      catalogId: paletteTail.catalogId,
      consumerStatus: paletteTail.consumerStatus,
      confidence: paletteTail.confidence || 'medium',
      kind: paletteTail.kind || 'palette_tail_consumer_refinement',
      summary: paletteTail.summary || 'Palette-tail consumer audit refines this unresolved candidate.',
      paletteParserStatus: paletteTail.paletteParser?.status || '',
      sameBankPointerCandidateCount: paletteTail.sameBankPointerCandidateCount || 0,
      bankMismatchWordShapeCount: paletteTail.bankMismatchWordShapeCount || 0,
    };
  }
  return null;
}

function buildCandidate(rom, mapData, asmText, asmDefs, def) {
  const region = findRegionById(mapData, def.regionId);
  if (!region) {
    return {
      regionId: def.regionId,
      missing: true,
      role: def.role,
      summary: def.summary,
    };
  }

  const start = offsetOf(region);
  const endExclusive = endOf(region);
  const sourceHits = loaderSourceHits(rom, mapData, start, endExclusive);
  const pointerRefs = structuredPointerRefs(rom, mapData, region);
  const exactLabel = [...asmDefs.values()].find(item => item.offset === start)?.label || null;
  const labels = [...new Set([exactLabel, ...(def.parentLabels || [])].filter(Boolean))];
  const asmRefs = asmRefsForLabels(asmText, labels);
  const parentLabelRefs = asmRefs.filter(ref => ref.label !== exactLabel);
  const exactLabelRefs = exactLabel ? asmRefs.filter(ref => ref.label === exactLabel) : [];
  const mediumPointerRefs = pointerRefs.filter(ref => ref.confidence === 'medium');
  const lowPointerRefs = pointerRefs.filter(ref => ref.confidence !== 'medium');
  const boundaryEvidence = consumerBoundaryEvidence(rom, mapData, region);
  const confirmedConsumer = confirmedConsumerForRegion(region);
  const refinedConsumer = refinedConsumerForRegion(region);
  const consumerStatus = confirmedConsumer?.consumerStatus || (sourceHits.length
    ? 'loader_source_overlap_found'
    : exactLabelRefs.length
      ? 'exact_asm_label_reference_found'
      : mediumPointerRefs.length
        ? 'structured_pointer_candidate_found'
        : 'consumer_unresolved');

  return {
    region: regionRef(region),
    role: def.role,
    summary: def.summary,
    confidence: confirmedConsumer?.confidence || region.confidence || 'unspecified',
    shape: def.shape,
    range: {
      start: hex(start),
      endInclusive: hex(endExclusive - 1),
      size: endExclusive - start,
      bank: bankForOffset(start),
      z80WindowPointerRange: [hex(z80WindowPointer(start), 4), hex(z80WindowPointer(endExclusive - 1), 4)],
    },
    consumerStatus,
    loaderSourceHitCount: sourceHits.length,
    loaderSourceHits: sourceHits.slice(0, 24),
    structuredPointerRefCount: pointerRefs.length,
    mediumConfidencePointerRefCount: mediumPointerRefs.length,
    lowConfidencePointerRefCount: lowPointerRefs.length,
    structuredPointerRefs: pointerRefs.slice(0, 24),
    exactAsmLabel: exactLabel,
    exactAsmLabelRefCount: exactLabelRefs.length,
    exactAsmLabelRefs: exactLabelRefs.slice(0, 12),
    boundaryEvidence,
    parentLabels: (def.parentLabels || []).map(label => ({
      label,
      definition: asmDefs.get(label) ? {
        offset: hex(asmDefs.get(label).offset),
        line: asmDefs.get(label).line,
      } : null,
      refCount: parentLabelRefs.filter(ref => ref.label === label).length,
      refs: parentLabelRefs.filter(ref => ref.label === label).slice(0, 12),
    })),
    confirmedConsumer,
    refinedConsumer,
    negativeEvidence: [
      confirmedConsumer ? null : sourceHits.length ? null : 'No currently mapped vram_loader_8fb or vram_loader_998 source range overlaps this candidate.',
      confirmedConsumer ? null : exactLabel ? null : 'The candidate start has no exact ASM label; only the containing/parent label can be referenced directly by the disassembly.',
      confirmedConsumer ? null : mediumPointerRefs.length ? null : 'No little-endian pointer candidate from pointer-table, room-subrecord, or other pointer-bearing regions resolves into this candidate range.',
      confirmedConsumer ? null : lowPointerRefs.length ? 'Low-confidence word-shaped hits from generic data_table regions are retained as leads only, not consumer proof.' : null,
      !confirmedConsumer && refinedConsumer?.paletteParserStatus
        ? `Refined unresolved status: ${refinedConsumer.consumerStatus}; palette parser status ${refinedConsumer.paletteParserStatus}; same-bank pointer leads ${refinedConsumer.sameBankPointerCandidateCount}, bank-mismatch word-shapes ${refinedConsumer.bankMismatchWordShapeCount}.`
        : null,
      !confirmedConsumer && refinedConsumer?.kind === 'orphan_room_entity_source_lists'
        ? `Refined unresolved status: ${refinedConsumer.consumerStatus}; decoded lists ${refinedConsumer.decodedListCount}, decoded records ${refinedConsumer.decodedEntityRecords}, confirmed subrecord refs ${refinedConsumer.subrecordPointerRefsIntoSpan}.`
        : null,
      !confirmedConsumer && refinedConsumer?.kind === 'loader_shape_rejected_bank_alias_collision'
        ? `Refined unresolved status: ${refinedConsumer.consumerStatus}; candidate ${refinedConsumer.candidateLabel} at banked ${refinedConsumer.z80Address} has ${refinedConsumer.directCandidateRefCount} direct candidate refs, ${refinedConsumer.aliasCount} same-address label aliases, and ${refinedConsumer.rawZ80WordOccurrenceCount} raw word occurrence(s).`
        : null,
    ].filter(Boolean),
    evidence: confirmedConsumer ? [...def.evidence, ...confirmedConsumer.evidence] : def.evidence,
  };
}

function buildCatalog(rom, mapData, asmText) {
  const asmDefs = asmLabelDefinitions(asmText);
  const candidates = candidateDefs.map(def => buildCandidate(rom, mapData, asmText, asmDefs, def));
  const missingCandidates = candidates.filter(candidate => candidate.missing);
  const unresolved = candidates.filter(candidate => !candidate.missing && candidate.consumerStatus === 'consumer_unresolved');
  const positive = candidates.filter(candidate => !candidate.missing && candidate.consumerStatus !== 'consumer_unresolved');
  const confirmed = candidates.filter(candidate => !candidate.missing && candidate.consumerStatus?.startsWith('consumer_confirmed_'));
  const refined = candidates.filter(candidate => !candidate.missing && candidate.refinedConsumer);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      candidateCount: candidates.length,
      missingCandidateCount: missingCandidates.length,
      consumerUnresolvedCount: unresolved.length,
      positiveOrCandidateConsumerEvidenceCount: positive.length,
      confirmedConsumerCount: confirmed.length,
      refinedUnresolvedConsumerCount: refined.length,
      loaderSourceHitCandidateCount: candidates.filter(candidate => candidate.loaderSourceHitCount > 0).length,
      structuredPointerCandidateCount: candidates.filter(candidate => candidate.structuredPointerRefCount > 0).length,
      mediumConfidencePointerCandidateCount: candidates.filter(candidate => candidate.mediumConfidencePointerRefCount > 0).length,
      lowConfidenceOnlyPointerCandidateCount: candidates.filter(candidate => (
        candidate.lowConfidencePointerRefCount > 0 && candidate.mediumConfidencePointerRefCount === 0
      )).length,
      exactAsmLabelReferenceCandidateCount: candidates.filter(candidate => candidate.exactAsmLabelRefCount > 0).length,
      assetPolicy: 'Metadata only: candidate offsets, sizes, labels, structured pointer-reference counts, loader-source overlap refs, and evidence. No ROM bytes, decoded graphics, tile maps, music, or rendered assets are embedded.',
    },
    candidates,
  };
}

function annotateRegions(mapData, catalog) {
  const annotated = [];
  const missing = [];
  for (const candidate of catalog.candidates) {
    if (candidate.missing) {
      missing.push({ regionId: candidate.regionId, role: candidate.role });
      continue;
    }
    const region = findRegionById(mapData, candidate.region.id);
    if (!region) {
      missing.push({ regionId: candidate.region.id, role: candidate.role });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.unresolvedAssetConsumerAudit = {
      catalogId,
      kind: candidate.role,
      confidence: candidate.confirmedConsumer?.confidence || (candidate.consumerStatus === 'consumer_unresolved' ? 'high' : 'medium'),
      summary: candidate.confirmedConsumer?.summary || candidate.summary,
      consumerStatus: candidate.consumerStatus,
      range: candidate.range,
      shape: candidate.shape,
      loaderSourceHitCount: candidate.loaderSourceHitCount,
      loaderSourceHits: candidate.loaderSourceHits,
      structuredPointerRefCount: candidate.structuredPointerRefCount,
      mediumConfidencePointerRefCount: candidate.mediumConfidencePointerRefCount,
      lowConfidencePointerRefCount: candidate.lowConfidencePointerRefCount,
      structuredPointerRefs: candidate.structuredPointerRefs,
      exactAsmLabel: candidate.exactAsmLabel,
      exactAsmLabelRefCount: candidate.exactAsmLabelRefCount,
      exactAsmLabelRefs: candidate.exactAsmLabelRefs,
      boundaryEvidence: candidate.boundaryEvidence,
      parentLabels: candidate.parentLabels,
      confirmedConsumer: candidate.confirmedConsumer,
      refinedConsumer: candidate.refinedConsumer,
      negativeEvidence: candidate.negativeEvidence,
      evidence: candidate.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      role: candidate.role,
      consumerStatus: candidate.consumerStatus,
    });
  }
  return { annotated, missing };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(rom, mapData, asmText);
  let annotations = { annotated: [], missing: [] };

  if (apply) {
    annotations = annotateRegions(mapData, catalog);
    const finalCatalog = buildCatalog(rom, mapData, asmText);
    mapData.fragmentCatalogs = (mapData.fragmentCatalogs || []).filter(item => item.id !== catalogId);
    mapData.fragmentCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'unresolved_asset_consumer_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotations.annotated.length,
        missingRegions: annotations.missing.length,
      },
      annotatedRegions: annotations.annotated,
      missingRegions: annotations.missing,
      candidates: finalCatalog.candidates,
      nextLeads: [
        'For candidates with only parent-label references, inspect the parent parser terminator and prove whether the tail is skipped, copied directly, or selected by an indirect pointer.',
        'For structured pointer candidates, trace the source table consumer before raising confidence; the audit intentionally treats word-shaped hits as non-final evidence.',
        'Add browser diagnostics that badges consumer_unresolved low-confidence asset candidates so previews do not imply active runtime use.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    candidates: catalog.candidates.map(candidate => candidate.missing ? candidate : {
      region: candidate.region,
      role: candidate.role,
      consumerStatus: candidate.consumerStatus,
      loaderSourceHitCount: candidate.loaderSourceHitCount,
      structuredPointerRefCount: candidate.structuredPointerRefCount,
      mediumConfidencePointerRefCount: candidate.mediumConfidencePointerRefCount,
      lowConfidencePointerRefCount: candidate.lowConfidencePointerRefCount,
      exactAsmLabel: candidate.exactAsmLabel,
      exactAsmLabelRefCount: candidate.exactAsmLabelRefCount,
      boundaryEvidence: {
        previousRegion: candidate.boundaryEvidence?.previousRegion?.id || null,
        nextRegion: candidate.boundaryEvidence?.nextRegion?.id || null,
        previousNonNullRegion: candidate.boundaryEvidence?.previousNonNullRegion?.id || null,
        nextNonNullRegion: candidate.boundaryEvidence?.nextNonNullRegion?.id || null,
        priorDecodedLoader: candidate.boundaryEvidence?.priorDecodedLoader?.loaderRegion?.id || null,
        followingDecodedLoader: candidate.boundaryEvidence?.followingDecodedLoader?.loaderRegion?.id || null,
      },
      parentLabels: candidate.parentLabels.map(label => ({
        label: label.label,
        definition: label.definition,
        refCount: label.refCount,
      })),
      negativeEvidence: candidate.negativeEvidence,
    }),
    annotations,
  }, null, 2));
}

main();
