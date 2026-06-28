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
const catalogId = 'world-room-entity-orphan-consumer-probe-catalog-2026-06-25';
const reportId = 'room-entity-orphan-consumer-probe-audit-2026-06-25';
const toolName = 'tools/world-room-entity-orphan-consumer-probe-audit.mjs';

const target = {
  regionId: 'r2820',
  start: 0x12D91,
  endExclusive: 0x134B9,
  bank: 4,
};

const roomSubrecordTable = {
  start: 0x1072C,
  bank: 4,
  stride: 18,
  count: 76,
  cf62FieldOffset: 4,
};

const sourceCatalogs = [
  'world-room-entity-orphan-list-catalog-2026-06-25',
  'world-room-entity-list-catalog-2026-06-25',
  'world-unresolved-asset-consumer-catalog-2026-06-25',
  'world-room-asset-incbin-layout-catalog-2026-06-25',
];

const pointerBearingTypes = new Set([
  'pointer_table',
  'screen_prog_table',
  'palette_script_table',
  'room_subrecord',
  'room_seq_table',
  'data_table',
]);

const mediumPointerTypes = new Set([
  'pointer_table',
  'screen_prog_table',
  'palette_script_table',
  'room_subrecord',
  'room_seq_table',
]);

function hex(value, pad = 5) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readWordLE(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function regionStart(region) {
  return parseHex(region.offset) ?? 0;
}

function regionEnd(region) {
  return regionStart(region) + Number(region.size || 0);
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

function bankedZ80ToRom(bank, pointer) {
  if (bank === 0 && pointer < 0x4000) return pointer;
  if (bank === 1 && pointer >= 0x4000 && pointer < 0x8000) return 0x4000 + (pointer - 0x4000);
  if (bank >= 2 && pointer >= 0x8000 && pointer < 0xC000) {
    return bank * 0x4000 + (pointer - 0x8000);
  }
  return null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    bank: Number.isFinite(region.bank) ? region.bank : bankForOffset(regionStart(region)),
    name: region.name || '',
  };
}

function findRegion(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function containingRegions(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => {
      const sizeDiff = Number(a.size || 0) - Number(b.size || 0);
      if (sizeDiff) return sizeDiff;
      return String(a.id).localeCompare(String(b.id));
    });
}

function bestContainingRegion(mapData, offset) {
  return containingRegions(mapData, offset)[0] || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function catalogSummary(mapData, id) {
  const catalog = findCatalog(mapData, id);
  return {
    id,
    present: Boolean(catalog),
    summary: catalog?.summary || null,
  };
}

function parseAsm(asmText) {
  const lines = asmText.split(/\r?\n/);
  const labels = [];
  for (const [index, line] of lines.entries()) {
    const match = /^(_(?:LABEL|DATA|RAM)_[0-9A-F]+_):?/.exec(line);
    if (!match) continue;
    labels.push({
      label: match[1],
      line: index + 1,
      offset: parseInt(match[1].split('_')[2], 16),
    });
  }
  labels.sort((a, b) => a.line - b.line);
  return { lines, labels };
}

function labelAtLine(parsedAsm, lineNumber) {
  let current = null;
  for (const label of parsedAsm.labels) {
    if (label.line > lineNumber) break;
    current = label;
  }
  return current;
}

function routineBlock(parsedAsm, labelName) {
  const labelIndex = parsedAsm.labels.findIndex(label => label.label === labelName);
  if (labelIndex === -1) return null;
  const start = parsedAsm.labels[labelIndex].line;
  const next = parsedAsm.labels.find((label, index) => index > labelIndex && label.label.startsWith('_LABEL_'));
  const end = next ? next.line - 1 : parsedAsm.lines.length;
  return {
    label: labelName,
    startLine: start,
    endLine: end,
    lines: parsedAsm.lines.slice(start - 1, end),
  };
}

function contextLine(parsedAsm, lineNumber) {
  const line = parsedAsm.lines[lineNumber - 1] || '';
  return line.trim().replace(/\s+/g, ' ');
}

function findDecoderCalls(parsedAsm) {
  const calls = [];
  const pattern = /\b(call|jp)\s+(_LABEL_2948_|_LABEL_2963_)\b/;
  for (const [index, line] of parsedAsm.lines.entries()) {
    const match = pattern.exec(line);
    if (!match) continue;
    const lineNumber = index + 1;
    const caller = labelAtLine(parsedAsm, lineNumber);
    const targetLabel = match[2];
    const internalLoop = caller?.label === targetLabel && match[1] === 'jp';
    calls.push({
      line: lineNumber,
      mnemonic: match[1],
      targetLabel,
      callerLabel: caller?.label || null,
      classification: internalLoop ? 'internal_decoder_loop' : 'external_decoder_entry_call',
      context: contextLine(parsedAsm, lineNumber),
    });
  }
  return calls;
}

function findAsmMentions(parsedAsm, token) {
  const mentions = [];
  for (const [index, line] of parsedAsm.lines.entries()) {
    if (!line.includes(token)) continue;
    const lineNumber = index + 1;
    const caller = labelAtLine(parsedAsm, lineNumber);
    mentions.push({
      line: lineNumber,
      label: caller?.label || null,
      context: contextLine(parsedAsm, lineNumber),
    });
  }
  return mentions;
}

function routineHasSequence(block, sequence) {
  if (!block) return false;
  let cursor = 0;
  for (const line of block.lines) {
    const cleaned = line.trim().replace(/\s+/g, ' ');
    if (cleaned.includes(sequence[cursor])) cursor++;
    if (cursor === sequence.length) return true;
  }
  return false;
}

function buildCf62Dataflow(parsedAsm) {
  const roomLoader = routineBlock(parsedAsm, '_LABEL_26F4_');
  const entityEntry = routineBlock(parsedAsm, '_LABEL_2948_');
  const decoder = routineBlock(parsedAsm, '_LABEL_2963_');
  const cf62Mentions = findAsmMentions(parsedAsm, '_RAM_CF62_');
  const directCf62Writes = cf62Mentions.filter(ref => /\(_RAM_CF62_\),/.test(ref.context));
  const hasSubrecordCopy = routineHasSequence(roomLoader, [
    'ld de, _RAM_CF5E_',
    'ld bc, $0008',
    'ldir',
  ]);
  const hasCf62Seed = routineHasSequence(entityEntry, [
    'ld hl, (_RAM_CF62_)',
    'ld (_RAM_D0DE_), hl',
  ]);

  return {
    sourceStatus: hasSubrecordCopy && hasCf62Seed ? 'room_subrecord_cf62_field_seeded_into_entity_decoder' : 'cf62_dataflow_incomplete',
    roomSubrecordCopy: {
      routine: '_LABEL_26F4_',
      present: hasSubrecordCopy,
      lineRange: roomLoader ? [roomLoader.startLine, roomLoader.endLine] : null,
      summary: '_LABEL_26F4_ copies eight selected room-subrecord bytes to _RAM_CF5E_; _RAM_CF62_ is the word at bytes +4/+5 of that block.',
    },
    decoderSeed: {
      routine: '_LABEL_2948_',
      present: hasCf62Seed,
      lineRange: entityEntry ? [entityEntry.startLine, entityEntry.endLine] : null,
      summary: '_LABEL_2948_ switches to bank 4, reads _RAM_CF62_, stores it in _RAM_D0DE_, and falls into _LABEL_2963_.',
    },
    decoderLoop: {
      routine: '_LABEL_2963_',
      lineRange: decoder ? [decoder.startLine, decoder.endLine] : null,
      summary: '_LABEL_2963_ advances _RAM_D0DE_ through terminated entity records until a 0xFF sentinel is reached.',
    },
    cf62MentionCount: cf62Mentions.length,
    cf62Mentions,
    directCf62WriteCount: directCf62Writes.length,
    directCf62Writes,
  };
}

function scanRoomSubrecordCf62Pointers(rom) {
  const refs = [];
  for (let index = 0; index < roomSubrecordTable.count; index++) {
    const recordOffset = roomSubrecordTable.start + index * roomSubrecordTable.stride;
    const fieldOffset = recordOffset + roomSubrecordTable.cf62FieldOffset;
    const word = readWordLE(rom, fieldOffset);
    const targetOffset = bankedZ80ToRom(roomSubrecordTable.bank, word);
    if (targetOffset >= target.start && targetOffset < target.endExclusive) {
      refs.push({
        subrecordIndex: index,
        subrecordOffset: hex(recordOffset),
        cf62FieldOffset: hex(fieldOffset),
        pointerWord: hex(word, 4),
        targetOffset: hex(targetOffset),
      });
    }
  }
  return refs;
}

function sourceBankContext(region) {
  if (!region) {
    return { bank: null, reason: 'no containing region' };
  }
  if (regionStart(region) === 0x1071A) {
    return {
      bank: 6,
      reason: '_DATA_1071A_ is modeled elsewhere as a bank-6 metasprite-family pointer context.',
    };
  }
  return {
    bank: Number.isFinite(region.bank) ? region.bank : bankForOffset(regionStart(region)),
    reason: 'source region bank context',
  };
}

function isStructuredPointerOffset(sourceRegion, offset) {
  if (!sourceRegion) return false;
  const type = sourceRegion.type || 'unknown';
  const start = regionStart(sourceRegion);
  if (type === 'room_subrecord') {
    const relative = offset - roomSubrecordTable.start;
    if (relative < 0 || relative >= roomSubrecordTable.stride * roomSubrecordTable.count) return false;
    const fieldOffset = relative % roomSubrecordTable.stride;
    return fieldOffset === 0 || fieldOffset === roomSubrecordTable.cf62FieldOffset || fieldOffset === 8;
  }
  if (!pointerBearingTypes.has(type)) return false;
  return ((offset - start) % 2) === 0;
}

function pointerConfidence(sourceRegion, offset, targetRegion) {
  if (!sourceRegion) return 'low';
  const type = sourceRegion.type || 'unknown';
  const sourceBank = sourceBankContext(sourceRegion).bank;
  const sameBank = sourceBank === target.bank;
  const targetOverlap = regionStart(sourceRegion) < target.endExclusive && regionEnd(sourceRegion) > target.start;
  if (sameBank && mediumPointerTypes.has(type) && !targetOverlap && isStructuredPointerOffset(sourceRegion, offset)) return 'medium';
  return 'low';
}

function pointerReason(sourceRegion, offset, confidence) {
  if (!sourceRegion) return 'word-shaped value resolves into target Z80 window but no containing source region was found';
  if (confidence === 'medium') {
    return 'little-endian word in a same-bank pointer-bearing region resolves into the orphan entity-list span';
  }
  if (regionStart(sourceRegion) < target.endExclusive && regionEnd(sourceRegion) > target.start) {
    return 'word-shaped hit is inside the target entity data span and is kept only as a self-data false-positive lead';
  }
  if (!pointerBearingTypes.has(sourceRegion.type || 'unknown')) {
    return 'word-shaped hit is in a non-pointer-bearing source region';
  }
  if (!isStructuredPointerOffset(sourceRegion, offset)) {
    return 'word-shaped hit is not aligned to a known pointer field for this source region';
  }
  return 'word-shaped hit is not in a same-bank high-confidence pointer context';
}

function scanPointerWords(rom, mapData) {
  const z80Start = z80WindowPointer(target.start);
  const z80EndExclusive = z80Start + (target.endExclusive - target.start);
  const hits = [];
  const typeCounts = {};
  const confidenceCounts = {};
  const bankCounts = {};
  let sameBankPointerBearingRefsIntoSpan = 0;

  for (let offset = 0; offset + 1 < rom.length; offset++) {
    const word = readWordLE(rom, offset);
    if (word < z80Start || word >= z80EndExclusive) continue;
    const sourceRegion = bestContainingRegion(mapData, offset);
    const sourceContext = sourceBankContext(sourceRegion);
    const confidence = pointerConfidence(sourceRegion, offset, target);
    const targetOffset = target.start + (word - z80Start);
    const type = sourceRegion?.type || 'unmapped';
    const sourceBank = sourceContext.bank == null ? 'none' : String(sourceContext.bank);
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    confidenceCounts[confidence] = (confidenceCounts[confidence] || 0) + 1;
    bankCounts[sourceBank] = (bankCounts[sourceBank] || 0) + 1;
    if (confidence === 'medium') sameBankPointerBearingRefsIntoSpan++;
    hits.push({
      sourceOffset: hex(offset),
      pointerWord: hex(word, 4),
      targetOffset: hex(targetOffset),
      sourceRegion: compactRegion(sourceRegion),
      sourceBank: sourceContext.bank,
      sourceBankContextReason: sourceContext.reason,
      confidence,
      reason: pointerReason(sourceRegion, offset, confidence),
    });
  }

  hits.sort((a, b) => {
    const confidenceScore = { medium: 0, low: 1 };
    const aScore = confidenceScore[a.confidence] ?? 2;
    const bScore = confidenceScore[b.confidence] ?? 2;
    if (aScore !== bScore) return aScore - bScore;
    return a.sourceOffset.localeCompare(b.sourceOffset);
  });

  return {
    z80Range: {
      start: hex(z80Start, 4),
      endExclusive: hex(z80EndExclusive, 4),
    },
    rawHitCount: hits.length,
    sameBankPointerBearingRefsIntoSpan,
    confidenceCounts,
    sourceTypeCounts: Object.fromEntries(Object.entries(typeCounts).sort((a, b) => a[0].localeCompare(b[0]))),
    sourceBankCounts: Object.fromEntries(Object.entries(bankCounts).sort((a, b) => Number(a[0]) - Number(b[0]))),
    samples: hits.slice(0, 16),
  };
}

function buildCatalog(mapData, rom, asmText) {
  const parsedAsm = parseAsm(asmText);
  const region = findRegion(mapData, target.regionId);
  if (!region) throw new Error(`Missing target region ${target.regionId}`);

  const decoderCalls = findDecoderCalls(parsedAsm);
  const externalCalls = decoderCalls.filter(call => call.classification === 'external_decoder_entry_call');
  const internalLoops = decoderCalls.filter(call => call.classification === 'internal_decoder_loop');
  const nonCf62Calls = externalCalls.filter(call => call.targetLabel !== '_LABEL_2948_');
  const cf62Dataflow = buildCf62Dataflow(parsedAsm);
  const subrecordCf62Refs = scanRoomSubrecordCf62Pointers(rom);
  const pointerWordScan = scanPointerWords(rom, mapData);
  const sourceCatalogSummaries = sourceCatalogs.map(id => catalogSummary(mapData, id));
  const orphanCatalog = findCatalog(mapData, 'world-room-entity-orphan-list-catalog-2026-06-25');
  const orphanSummary = orphanCatalog?.summary || {};
  const unresolvedAudit = region.analysis?.unresolvedAssetConsumerAudit || {};
  const behaviorAudit = region.analysis?.roomEntityBehaviorLinkAudit || {};

  const consumerStatus = (
    nonCf62Calls.length === 0 &&
    subrecordCf62Refs.length === 0 &&
    pointerWordScan.sameBankPointerBearingRefsIntoSpan === 0
  )
    ? 'no_non_cf62_consumer_found_in_current_asm_static_scan'
    : 'consumer_leads_require_followup';

  const evidence = [
    'ASM scan finds one external room-entity decoder entry call, `call _LABEL_2948_`, from the room-load path after _LABEL_26F4_.',
    '_LABEL_26F4_ copies eight selected room-subrecord bytes to _RAM_CF5E_; _RAM_CF62_ is therefore the entity-list pointer field consumed by _LABEL_2948_.',
    '_LABEL_2948_ reads _RAM_CF62_ into _RAM_D0DE_ and falls through to _LABEL_2963_; the only `_LABEL_2963_` jump found in ASM is the decoder loop itself.',
    'The confirmed room-subrecord CF62 pointer scan still finds zero pointers into r2820.',
    'A full ROM word-shape scan stores only pointer metadata and finds no same-bank pointer-bearing source resolving into r2820.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: offsets, labels, routine names, pointer words, counts, region ids, and evidence. No ROM bytes, entity coordinates, decoded assets, pixels, audio, or gameplay constants are embedded.',
    summary: {
      targetRegionId: target.regionId,
      targetOffset: hex(target.start),
      targetEndExclusive: hex(target.endExclusive),
      targetSize: target.endExclusive - target.start,
      targetBank: target.bank,
      targetZ80Range: pointerWordScan.z80Range,
      decodedListCount: Number(orphanSummary.decodedListCount || region.analysis?.roomEntityOrphanListAudit?.decodedListCount || 0),
      decodedEntityRecords: Number(orphanSummary.decodedEntityRecords || region.analysis?.roomEntityOrphanListAudit?.decodedEntityRecords || 0),
      subrecordPointerRefsIntoSpan: subrecordCf62Refs.length,
      decoderExternalCallCount: externalCalls.length,
      decoderInternalLoopCount: internalLoops.length,
      nonCf62DecoderCallCount: nonCf62Calls.length,
      directCf62WriteCount: cf62Dataflow.directCf62WriteCount,
      rawPointerLikeHits: pointerWordScan.rawHitCount,
      sameBankPointerBearingRefsIntoSpan: pointerWordScan.sameBankPointerBearingRefsIntoSpan,
      lowConfidencePointerLikeHits: pointerWordScan.confidenceCounts.low || 0,
      consumerStatus,
      persistedRomByteCount: 0,
      persistedCoordinateCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
    },
    region: compactRegion(region),
    sourceCatalogSummaries,
    priorRegionAnalyses: {
      roomEntityOrphanListAudit: region.analysis?.roomEntityOrphanListAudit || null,
      unresolvedAssetConsumerAudit: {
        catalogId: unresolvedAudit.catalogId || '',
        consumerStatus: unresolvedAudit.consumerStatus || '',
        confidence: unresolvedAudit.confidence || '',
        summary: unresolvedAudit.summary || '',
      },
      roomEntityBehaviorLinkAudit: {
        catalogId: behaviorAudit.catalogId || '',
        confidence: behaviorAudit.confidence || '',
        summary: behaviorAudit.summary || '',
      },
    },
    decoderCallGraph: {
      decoderEntryStatus: externalCalls.length === 1 && externalCalls[0]?.targetLabel === '_LABEL_2948_'
        ? 'single_external_call_via_cf62_entry'
        : 'decoder_call_graph_has_followup_leads',
      externalCalls,
      internalLoops,
      nonCf62Calls,
    },
    cf62Dataflow,
    roomSubrecordCf62PointerScan: {
      table: {
        start: hex(roomSubrecordTable.start),
        bank: roomSubrecordTable.bank,
        stride: roomSubrecordTable.stride,
        count: roomSubrecordTable.count,
        cf62FieldOffset: roomSubrecordTable.cf62FieldOffset,
      },
      refsIntoTargetCount: subrecordCf62Refs.length,
      refsIntoTarget: subrecordCf62Refs,
      status: subrecordCf62Refs.length === 0
        ? 'no_room_subrecord_cf62_pointer_into_orphan_span'
        : 'room_subrecord_cf62_pointer_leads_found',
    },
    pointerWordScan,
    evidence,
    nextLeads: [
      'Trace runtime writes to _RAM_CF62_ and _RAM_D0DE_ during room transitions to rule out dynamic non-subrecord consumers.',
      'Compare r2820 entity type-id distribution against reached CF62 entity lists to identify likely leftover or alternate room-content families.',
      'Add an analyzer pane for orphan entity-list metadata that shows list offsets, type ids, and behavior links without coordinates or ROM payload bytes.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegion(mapData, target.regionId);
  if (!region) return [];
  region.analysis = region.analysis || {};
  region.analysis.roomEntityOrphanConsumerProbeAudit = {
    catalogId,
    kind: 'orphan_room_entity_non_cf62_consumer_probe',
    confidence: catalog.summary.consumerStatus === 'no_non_cf62_consumer_found_in_current_asm_static_scan' ? 'medium' : 'low',
    consumerStatus: catalog.summary.consumerStatus,
    decoderEntryCallStatus: catalog.decoderCallGraph.decoderEntryStatus,
    cf62DataflowStatus: catalog.cf62Dataflow.sourceStatus,
    subrecordPointerStatus: catalog.roomSubrecordCf62PointerScan.status,
    pointerScanStatus: catalog.summary.sameBankPointerBearingRefsIntoSpan === 0
      ? 'no_same_bank_pointer_bearing_ref_found'
      : 'same_bank_pointer_bearing_ref_leads_found',
    decoderExternalCallCount: catalog.summary.decoderExternalCallCount,
    nonCf62DecoderCallCount: catalog.summary.nonCf62DecoderCallCount,
    subrecordPointerRefsIntoSpan: catalog.summary.subrecordPointerRefsIntoSpan,
    rawPointerLikeHits: catalog.summary.rawPointerLikeHits,
    lowConfidencePointerLikeHits: catalog.summary.lowConfidencePointerLikeHits,
    sameBankPointerBearingRefsIntoSpan: catalog.summary.sameBankPointerBearingRefsIntoSpan,
    summary: 'Static ASM and pointer-word probe finds no current non-CF62 consumer for the structurally decoded orphan room entity lists.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  if (region.analysis.unresolvedAssetConsumerAudit) {
    region.analysis.unresolvedAssetConsumerAudit.refinedByConsumerProbe = catalogId;
    region.analysis.unresolvedAssetConsumerAudit.consumerProbeStatus = catalog.summary.consumerStatus;
  }
  return [{
    region: compactRegion(region),
    consumerStatus: catalog.summary.consumerStatus,
    decoderExternalCallCount: catalog.summary.decoderExternalCallCount,
    sameBankPointerBearingRefsIntoSpan: catalog.summary.sameBankPointerBearingRefsIntoSpan,
  }];
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, rom, asmText);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [];

  if (apply) {
    mapData.entityDataCatalogs = (mapData.entityDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.entityDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_entity_orphan_consumer_probe_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
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
      annotatedRegions: annotatedRegions.length,
    },
    decoderCallGraph: catalog.decoderCallGraph,
    cf62Dataflow: {
      sourceStatus: catalog.cf62Dataflow.sourceStatus,
      cf62MentionCount: catalog.cf62Dataflow.cf62MentionCount,
      directCf62WriteCount: catalog.cf62Dataflow.directCf62WriteCount,
    },
    roomSubrecordCf62PointerScan: {
      status: catalog.roomSubrecordCf62PointerScan.status,
      refsIntoTargetCount: catalog.roomSubrecordCf62PointerScan.refsIntoTargetCount,
    },
    pointerWordScan: {
      z80Range: catalog.pointerWordScan.z80Range,
      rawHitCount: catalog.pointerWordScan.rawHitCount,
      confidenceCounts: catalog.pointerWordScan.confidenceCounts,
      sameBankPointerBearingRefsIntoSpan: catalog.pointerWordScan.sameBankPointerBearingRefsIntoSpan,
      samples: catalog.pointerWordScan.samples.slice(0, 8),
    },
  }, null, 2));
}

main();
