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
const toolName = 'tools/world-bank7-pre-sequence-sidecar-audit.mjs';
const catalogId = 'world-bank7-pre-sequence-sidecar-catalog-2026-06-25';
const reportId = 'bank7-pre-sequence-sidecar-audit-2026-06-25';

const target = {
  regionId: 'r0749',
  start: 0x1E337,
  endExclusive: 0x1E360,
  label: '_DATA_1E337_',
  bank: 7,
  z80Address: 0xA337,
};

const confirmedSequenceRegions = ['r0750', 'r0751'];
const sourceCatalogs = [
  'world-bank7-entity-sequence-catalog-2026-06-25',
  'world-graphics-loader-candidate-catalog-2026-06-25',
  'world-graphics-loader-candidate-consumer-catalog-2026-06-25',
  'world-unresolved-asset-consumer-catalog-2026-06-25',
];

function hex(value, pad = 5) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function z80Hex(value) {
  return '$' + Number(value).toString(16).toUpperCase().padStart(4, '0');
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

function cleanCode(line) {
  return String(line || '').split(';')[0].trim();
}

function findLabelRefs(asmText, label) {
  const refs = [];
  const lines = asmText.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const code = cleanCode(line);
    if (!code || !code.includes(label)) continue;
    if (code.startsWith(`${label}:`)) continue;
    refs.push({
      line: index + 1,
      context: code.slice(0, 160),
      followedBy8fbCall: lines.slice(index + 1, index + 4).some(next => /\bcall\s+_LABEL_8FB_\b/.test(cleanCode(next))),
      followedBy998Call: lines.slice(index + 1, index + 4).some(next => /\bcall\s+_LABEL_998_\b/.test(cleanCode(next))),
    });
  }
  return refs;
}

function rawWordHits(rom, mapData, word) {
  const hits = [];
  for (let offset = 0; offset + 1 < rom.length; offset++) {
    if (readWordLE(rom, offset) !== word) continue;
    const region = containingRegion(mapData, offset);
    let classification = 'raw_word_shape_hit';
    let reason = 'Raw little-endian word matches the candidate Z80 address, but bank context must be established separately.';
    if (region?.id === 'r1907') {
      classification = 'bank4_alias_loader_call_operand';
      reason = 'Hit is the operand for `ld hl, _DATA_12337_` immediately before `call _LABEL_8FB_`; the active label is bank-4 _DATA_12337_, not bank-7 _DATA_1E337_.';
    }
    hits.push({
      sourceOffset: hex(offset),
      word: z80Hex(word),
      sourceRegion: compactRegion(region),
      classification,
      reason,
    });
  }
  return hits;
}

function byteShape(rom) {
  const bytes = rom.subarray(target.start, target.endExclusive);
  return {
    byteCount: bytes.length,
    allZero: bytes.length > 0 && [...bytes].every(byte => byte === 0),
    allFF: bytes.length > 0 && [...bytes].every(byte => byte === 0xFF),
    allSame: bytes.length > 0 && [...bytes].every(byte => byte === bytes[0]),
    persistedByteCount: 0,
    persistedHashCount: 0,
  };
}

function candidateShape(candidateCatalog) {
  const candidate = (candidateCatalog?.candidates || []).find(item => item.containingRegion?.id === target.regionId) || null;
  if (!candidate) return null;
  return {
    catalogId: candidateCatalog.id,
    candidateId: candidate.id,
    format: candidate.format,
    status: candidate.status,
    confidence: candidate.confidence,
    terminated: Boolean(candidate.terminated),
    consumedBytes: Number(candidate.consumedBytes || 0),
    entryCount: Number(candidate.entryCount || 0),
    copyEntryCount: Number(candidate.copyEntryCount || 0),
    totalTiles: Number(candidate.totalTiles || 0),
    overlapRefCount: Array.isArray(candidate.overlapRefs) ? candidate.overlapRefs.length : 0,
    warningCount: Number(candidate.warningCount || 0),
    persistedRomByteCount: 0,
    persistedTileByteCount: 0,
  };
}

function candidateConsumerRecord(consumerCatalog) {
  const record = (consumerCatalog?.records || []).find(item => item.candidateRegion?.id === target.regionId) || null;
  if (!record) return null;
  return {
    catalogId: consumerCatalog.id,
    status: record.status,
    confidence: record.confidence,
    promotionAllowed: Boolean(record.promotionAllowed),
    reason: record.reason,
    directCandidateRefCount: Number(record.directCandidateRefCount || 0),
    aliasCount: Number(record.aliasCount || 0),
    rawZ80WordOccurrenceCount: Number(record.rawZ80WordOccurrenceCount || 0),
  };
}

function sequenceAdjacency(mapData, sequenceCatalog) {
  const sequenceRegions = confirmedSequenceRegions.map(id => {
    const region = findRegion(mapData, id);
    const table = (sequenceCatalog?.tables || []).find(item => item.region?.id === id || item.regionId === id) || null;
    return {
      region: compactRegion(region),
      role: table?.role || region?.analysis?.bank7EntitySequenceAudit?.role || '',
      confidence: table?.confidence || region?.analysis?.bank7EntitySequenceAudit?.confidence || '',
      summary: table?.summary || region?.analysis?.bank7EntitySequenceAudit?.summary || '',
    };
  });
  const next = findRegion(mapData, confirmedSequenceRegions[0]);
  return {
    nextConfirmedRegion: compactRegion(next),
    distanceToNextBytes: next ? regionStart(next) - target.endExclusive : null,
    sequenceRegions,
    sequenceSummary: sequenceCatalog?.summary || null,
  };
}

function buildCatalog(mapData, rom, asmText) {
  const region = findRegion(mapData, target.regionId);
  if (!region) throw new Error(`Missing region ${target.regionId}`);
  const sequenceCatalog = findCatalog(mapData, 'world-bank7-entity-sequence-catalog-2026-06-25');
  const candidateCatalog = findCatalog(mapData, 'world-graphics-loader-candidate-catalog-2026-06-25');
  const consumerCatalog = findCatalog(mapData, 'world-graphics-loader-candidate-consumer-catalog-2026-06-25');
  const shape = candidateShape(candidateCatalog);
  const consumer = candidateConsumerRecord(consumerCatalog);
  const directRefs = findLabelRefs(asmText, target.label);
  const aliasRefs = findLabelRefs(asmText, '_DATA_12337_');
  const wordHits = rawWordHits(rom, mapData, target.z80Address);
  const aliasWordHits = wordHits.filter(hit => hit.classification === 'bank4_alias_loader_call_operand');
  const sequence = sequenceAdjacency(mapData, sequenceCatalog);
  const status = consumer?.status === 'no_confirmed_consumer_bank_alias_collision' && directRefs.length === 0
    ? 'loader_shape_rejected_keep_bank7_sequence_sidecar'
    : 'bank7_sidecar_requires_followup';

  const evidence = [
    '_DATA_1E337_ is defined as a 41-byte block immediately before the confirmed _DATA_1E360_ and _DATA_1E379_ bank-7 entity sequence streams.',
    'The block parses cleanly under the 8FB tile-loader grammar, but shape alone is not a consumer.',
    'Current ASM has no direct reference to _DATA_1E337_ outside its definition.',
    'The only raw $A337 word occurrence is the loader-call operand for _DATA_12337_ in _LABEL_1E200_, proving a bank-alias collision rather than a consumer for _DATA_1E337_.',
    'The adjacent _DATA_1E360_ and _DATA_1E379_ streams have confirmed runtime consumers; this sidecar remains unresolved until a bank-7 consumer is traced.',
    'Metadata-only audit; no ROM bytes, decoded tiles, rendered pixels, audio, or text payloads are embedded.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: offsets, labels, routine names, parser counts, pointer-word hit offsets, region ids, and evidence. No ROM bytes, decoded graphics, rendered pixels, screenshots, audio, or text payloads are embedded.',
    summary: {
      targetRegionId: target.regionId,
      targetOffset: hex(target.start),
      targetEndExclusive: hex(target.endExclusive),
      targetSize: target.endExclusive - target.start,
      targetBank: target.bank,
      targetZ80Address: z80Hex(target.z80Address),
      directCandidateAsmRefCount: directRefs.length,
      aliasAsmRefCount: aliasRefs.length,
      rawZ80WordHitCount: wordHits.length,
      bank4AliasWordHitCount: aliasWordHits.length,
      candidateShapeStatus: shape?.status || '',
      candidateConsumerStatus: consumer?.status || '',
      promotionAllowed: Boolean(consumer?.promotionAllowed),
      nextConfirmedSequenceDistanceBytes: sequence.distanceToNextBytes,
      byteShape: byteShape(rom),
      status,
      persistedRomByteCount: 0,
      persistedTileByteCount: 0,
      persistedPixelCount: 0,
    },
    region: compactRegion(region),
    candidateShape: shape,
    candidateConsumer: consumer,
    sequenceAdjacency: sequence,
    directCandidateAsmRefs: directRefs,
    bank4AliasAsmRefs: aliasRefs.slice(0, 8),
    rawZ80WordHits: wordHits,
    evidence,
    nextLeads: [
      'Trace bank-7 routines for any indirect HL assignment to $A337 before _LABEL_8FB_/_LABEL_998_; do not promote the 8FB shape without bank context.',
      'Check whether the 41-byte sidecar is copied or interpreted by the bank-7 entity sequence setup before _DATA_1E360_ is installed.',
      'If no consumer is found, keep r0749 as unresolved sidecar data adjacent to confirmed sequence streams, not as graphics-loader metadata.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegion(mapData, target.regionId);
  if (!region) return [];
  region.analysis = region.analysis || {};
  region.analysis.bank7PreSequenceSidecarAudit = {
    catalogId,
    kind: 'bank7_pre_sequence_sidecar_refinement',
    status: catalog.summary.status,
    confidence: catalog.summary.status === 'loader_shape_rejected_keep_bank7_sequence_sidecar' ? 'medium' : 'low',
    candidateShapeStatus: catalog.summary.candidateShapeStatus,
    candidateConsumerStatus: catalog.summary.candidateConsumerStatus,
    promotionAllowed: catalog.summary.promotionAllowed,
    directCandidateAsmRefCount: catalog.summary.directCandidateAsmRefCount,
    rawZ80WordHitCount: catalog.summary.rawZ80WordHitCount,
    bank4AliasWordHitCount: catalog.summary.bank4AliasWordHitCount,
    nextConfirmedSequenceDistanceBytes: catalog.summary.nextConfirmedSequenceDistanceBytes,
    summary: 'r0749 remains unresolved bank-7 sidecar data before confirmed entity sequence streams; its 8FB-like parse is rejected as a bank-alias false consumer.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  if (region.analysis.unresolvedAssetConsumerAudit) {
    region.analysis.unresolvedAssetConsumerAudit.refinedByBank7PreSequenceSidecarAudit = catalogId;
    region.analysis.unresolvedAssetConsumerAudit.bank7SidecarStatus = catalog.summary.status;
  }
  return [{
    region: compactRegion(region),
    status: catalog.summary.status,
    directCandidateAsmRefCount: catalog.summary.directCandidateAsmRefCount,
    bank4AliasWordHitCount: catalog.summary.bank4AliasWordHitCount,
  }];
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, rom, asmText);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [];

  if (apply) {
    mapData.fragmentCatalogs = (mapData.fragmentCatalogs || []).filter(item => item.id !== catalogId);
    mapData.fragmentCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank7_pre_sequence_sidecar_audit',
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
    candidateConsumer: catalog.candidateConsumer,
    sequenceAdjacency: {
      nextConfirmedRegion: catalog.sequenceAdjacency.nextConfirmedRegion,
      distanceToNextBytes: catalog.sequenceAdjacency.distanceToNextBytes,
      sequenceRegions: catalog.sequenceAdjacency.sequenceRegions,
    },
    rawZ80WordHits: catalog.rawZ80WordHits,
  }, null, 2));
}

main();
