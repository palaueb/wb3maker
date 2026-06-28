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
const toolName = 'tools/world-room-overlay-tail-refinement-audit.mjs';
const catalogId = 'world-room-overlay-tail-refinement-catalog-2026-06-25';
const reportId = 'room-overlay-tail-refinement-audit-2026-06-25';

const target = {
  regionId: 'r2813',
  start: 0x10718,
  endExclusive: 0x1071A,
  bank: 4,
  z80Start: 0x8718,
  z80EndExclusive: 0x871A,
};

const sourceCatalogs = [
  'world-room-overlay-record-catalog-2026-06-25',
  'world-unresolved-asset-consumer-catalog-2026-06-25',
  'world-asm-incbin-span-catalog-2026-06-25',
  'world-entity-animation-catalog-2026-06-24',
];

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

function findRegion(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function containingRegion(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
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

function byteShape(rom) {
  const bytes = rom.subarray(target.start, target.endExclusive);
  return {
    byteCount: bytes.length,
    allZero: bytes.length > 0 && [...bytes].every(byte => byte === 0x00),
    allFF: bytes.length > 0 && [...bytes].every(byte => byte === 0xFF),
    allSame: bytes.length > 0 && [...bytes].every(byte => byte === bytes[0]),
    evenSizedWordCandidate: bytes.length === 2,
    persistedByteCount: 0,
    persistedHashCount: 0,
  };
}

function cleanCode(line) {
  return String(line || '').split(';')[0].trim();
}

function asmRefs(asmText, token) {
  const refs = [];
  const lines = asmText.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const code = cleanCode(line);
    if (!code.includes(token)) continue;
    if (code.startsWith(`${token}:`)) continue;
    refs.push({
      line: index + 1,
      context: code.slice(0, 160),
    });
  }
  return refs;
}

function rawZ80WordHits(rom, mapData) {
  const hits = [];
  for (let offset = 0; offset + 1 < rom.length; offset++) {
    const word = readWordLE(rom, offset);
    if (word < target.z80Start || word >= target.z80EndExclusive) continue;
    const region = containingRegion(mapData, offset);
    const targetAlias = word === target.z80Start ? 'bank4_tail_or_bank6_animation_alias' : 'bank4_tail_plus_one_or_raw_data';
    let classification = 'low_confidence_word_shape_hit';
    let reason = 'Word-shaped value matches the bank-4 tail Z80 window but is not in a structured pointer context.';
    if (region?.id === 'r0564') {
      classification = 'bank6_animation_table_region';
      reason = 'Hit is inside the real _DATA_18718_ bank-6 animation pointer table, not the bank-4 room-overlay tail.';
    } else if (region?.type === 'code') {
      classification = 'bank_alias_code_immediate';
      reason = 'Code hit corresponds to a bank-6 _DATA_18718_ reference in current ASM context, not a bank-4 tail consumer.';
    } else if (region?.id === 'r0339') {
      classification = 'overlay_record_payload_word_shape';
      reason = 'Hit is inside confirmed overlay record payload bytes and is not a pointer to the tail.';
    }
    hits.push({
      sourceOffset: hex(offset),
      word: hex(word, 4),
      sourceRegion: compactRegion(region),
      targetAlias,
      classification,
      reason,
    });
  }
  return hits;
}

function buildCatalog(mapData, rom, asmText) {
  const region = findRegion(mapData, target.regionId);
  if (!region) throw new Error(`Missing region ${target.regionId}`);
  const overlayCatalog = findCatalog(mapData, 'world-room-overlay-record-catalog-2026-06-25');
  const asmIncbin = region.analysis?.asmIncbinSpanAudit || null;
  const unresolved = region.analysis?.unresolvedAssetConsumerAudit || null;
  const aliasRegion = containingRegion(mapData, 0x18718);
  const targetRefs = asmRefs(asmText, '_DATA_10718_');
  const bank6Refs = asmRefs(asmText, '_DATA_18718_');
  const nextTableRefs = asmRefs(asmText, '_DATA_1071A_');
  const wordHits = rawZ80WordHits(rom, mapData);
  const shape = byteShape(rom);
  const bankAliasHits = wordHits.filter(hit => hit.classification === 'bank_alias_code_immediate' || hit.classification === 'bank6_animation_table_region');
  const overlayPayloadHits = wordHits.filter(hit => hit.classification === 'overlay_record_payload_word_shape');
  const status = targetRefs.length === 0 && bankAliasHits.length > 0
    ? 'unresolved_nonpadding_tail_with_bank_alias_false_positive_refs'
    : 'unresolved_tail_requires_manual_trace';

  const evidence = [
    'The room overlay record model consumes 227 complete 8-byte records from 0x10000 through 0x10717, leaving r2813 as the two-byte trailer before _DATA_1071A_.',
    'Byte-shape probing shows r2813 is not all-zero, not all-FF, and not a repeated-byte filler; no ROM bytes or hashes are persisted.',
    'Current ASM has no _DATA_10718_ label or direct reference to the bank-4 tail offset.',
    'The visible _DATA_18718_ references occur after bank 6 is selected in _LABEL_1318_/_LABEL_137C_, so they target the bank-6 animation table at ROM 0x18718 rather than this bank-4 tail.',
    'Raw word-shaped hits for 0x8718 inside overlay records, code, audio, or graphics are preserved as low-confidence false-positive evidence only.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: offsets, labels, routine names, byte-shape booleans, word values, counts, region ids, and evidence. No ROM bytes, decoded tile values, rendered pixels, audio, or text payloads are embedded.',
    summary: {
      targetRegionId: target.regionId,
      targetOffset: hex(target.start),
      targetEndExclusive: hex(target.endExclusive),
      targetSize: target.endExclusive - target.start,
      targetBank: target.bank,
      targetZ80Range: [hex(target.z80Start, 4), hex(target.z80EndExclusive, 4)],
      directTargetAsmRefCount: targetRefs.length,
      bank6AliasAsmRefCount: bank6Refs.length,
      rawZ80WordHitCount: wordHits.length,
      bankAliasHitCount: bankAliasHits.length,
      overlayPayloadWordShapeHitCount: overlayPayloadHits.length,
      nextPointerTableAsmRefCount: nextTableRefs.length,
      byteShape: shape,
      status,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    region: compactRegion(region),
    overlayRecordSummary: overlayCatalog?.summary || null,
    asmIncbinSpanAudit: asmIncbin ? {
      catalogId: asmIncbin.catalogId || '',
      spanId: asmIncbin.spanId || '',
      parserStatus: asmIncbin.parserStatus || '',
      summary: asmIncbin.summary || '',
    } : null,
    unresolvedAssetConsumerAudit: unresolved ? {
      catalogId: unresolved.catalogId || '',
      consumerStatus: unresolved.consumerStatus || '',
      structuredPointerRefCount: unresolved.structuredPointerRefCount || 0,
      loaderSourceHitCount: unresolved.loaderSourceHitCount || 0,
      summary: unresolved.summary || '',
    } : null,
    bank6AliasTarget: {
      label: '_DATA_18718_',
      region: compactRegion(aliasRegion),
      refs: bank6Refs.slice(0, 8),
      summary: '_LABEL_1318_ and _LABEL_137C_ select bank 6 before referencing _DATA_18718_, proving this is a bank alias false-positive for r2813.',
    },
    directTargetAsmRefs: targetRefs,
    nextPointerTableRefs: nextTableRefs.slice(0, 8),
    rawZ80WordHits: wordHits.slice(0, 24),
    rawZ80WordHitCountsByClassification: countBy(wordHits, hit => hit.classification),
    rawZ80WordHitCountsByRegionType: countBy(wordHits, hit => hit.sourceRegion?.type || 'unmapped'),
    evidence,
    nextLeads: [
      'Trace possible _RAM_CF64_ values at runtime to prove whether index 227 can ever select the two-byte trailer as a malformed overlay record.',
      'Inspect nearby bank-4 room-loader support code for direct reads from _DATA_10000_ + 1816 outside the confirmed overlay writer.',
      'Keep r2813 as a nonpadding unresolved trailer until a real bank-4 consumer or an explicit terminator role is proven.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegion(mapData, target.regionId);
  if (!region) return [];
  region.analysis = region.analysis || {};
  region.analysis.roomOverlayTailRefinementAudit = {
    catalogId,
    kind: 'room_overlay_tail_refinement',
    status: catalog.summary.status,
    confidence: 'medium',
    byteShape: catalog.summary.byteShape,
    directTargetAsmRefCount: catalog.summary.directTargetAsmRefCount,
    bank6AliasAsmRefCount: catalog.summary.bank6AliasAsmRefCount,
    rawZ80WordHitCount: catalog.summary.rawZ80WordHitCount,
    bankAliasHitCount: catalog.summary.bankAliasHitCount,
    overlayPayloadWordShapeHitCount: catalog.summary.overlayPayloadWordShapeHitCount,
    summary: 'r2813 is a nonpadding two-byte trailer after the aligned room overlay record table; current apparent 0x8718 references are bank-6 alias false positives, not bank-4 consumers.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  if (region.analysis.unresolvedAssetConsumerAudit) {
    region.analysis.unresolvedAssetConsumerAudit.refinedByOverlayTailAudit = catalogId;
    region.analysis.unresolvedAssetConsumerAudit.overlayTailStatus = catalog.summary.status;
  }
  return [{
    region: compactRegion(region),
    status: catalog.summary.status,
    directTargetAsmRefCount: catalog.summary.directTargetAsmRefCount,
    bankAliasHitCount: catalog.summary.bankAliasHitCount,
  }];
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, rom, asmText);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [];

  if (apply) {
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_overlay_tail_refinement_audit',
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
    rawZ80WordHitCountsByClassification: catalog.rawZ80WordHitCountsByClassification,
    rawZ80WordHitCountsByRegionType: catalog.rawZ80WordHitCountsByRegionType,
    bank6AliasTarget: catalog.bank6AliasTarget,
  }, null, 2));
}

main();
