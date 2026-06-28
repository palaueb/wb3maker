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
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-graphics-direct-source-address-audit.mjs';
const catalogId = 'world-graphics-direct-source-address-catalog-2026-06-26';
const reportId = 'graphics-direct-source-address-audit-2026-06-26';
const schemaVersion = 1;

const remainingLeadCatalogId = 'world-graphics-remaining-lead-reconciliation-catalog-2026-06-26';
const shapeCatalogId = 'world-graphics-combined-unreferenced-shape-catalog-2026-06-26';
const combinedCoverageCatalogId = 'world-graphics-combined-source-coverage-catalog-2026-06-26';
const bankedUploaderCatalogId = 'world-banked-vdp-uploader-callsite-catalog-2026-06-26';
const tileSizeBytes = 32;
const maxSamplesPerSpan = 24;
const maxAsmSamplesPerSpan = 16;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 16);
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

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function containingRegion(mapData, offset) {
  if (!Number.isFinite(offset)) return null;
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0)
      || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function sumBy(items, valueFn) {
  return items.reduce((sum, item) => sum + valueFn(item), 0);
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function stripComment(line) {
  return String(line || '').split(';')[0].trim();
}

function parseAsmContext(asmText, mapData) {
  const lines = asmText.split(/\r?\n/);
  const lineContext = [];
  let current = null;
  for (const [index, line] of lines.entries()) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*$/.exec(line);
    if (match) {
      const offset = labelOffset(match[1]);
      current = {
        label: match[1],
        offset,
        line: index + 1,
        region: compactRegion(containingRegion(mapData, offset)),
      };
    }
    lineContext[index] = current;
  }
  return { lines, lineContext };
}

function directAddressForRomOffset(offset) {
  return 0x8000 + (offset % 0x4000);
}

function romBankForOffset(offset) {
  return Math.floor(offset / 0x4000);
}

function collectTargetSpans(remainingLeadCatalog, shapeCatalog) {
  const shapeById = new Map((shapeCatalog.spans || []).map(span => [span.id, span]));
  return (remainingLeadCatalog.entries || [])
    .filter(entry => Number(entry.nonblankTileCount || 0) > 0)
    .map(entry => {
      const shape = shapeById.get(entry.spanId) || {};
      const start = parseHex(entry.start || shape.start);
      const endExclusive = parseHex(entry.endExclusive || shape.endExclusive);
      const sizeBytes = Number(entry.sizeBytes || shape.sizeBytes || (endExclusive - start));
      const tileCount = Math.floor(sizeBytes / tileSizeBytes);
      const bank = romBankForOffset(start);
      return {
        spanId: entry.spanId,
        region: entry.region || shape.region || null,
        start,
        endExclusive,
        sizeBytes,
        tileCount,
        nonblankTileCount: Number(entry.nonblankTileCount || shape.shapeStats?.nonblankTileCount || 0),
        priorityScore: Number(entry.priorityScore || 0),
        priorClassification: entry.classification || null,
        sourceWordStatus: entry.sourceWordStatus || '',
        sourceWordCounts: entry.sourceWordCounts || null,
        bank,
        z80Start: directAddressForRomOffset(start),
        z80EndExclusive: directAddressForRomOffset(start) + sizeBytes,
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore || b.sizeBytes - a.sizeBytes || a.start - b.start);
}

function targetAddressesForSpan(span) {
  const addresses = [];
  for (let offset = span.start; offset < span.endExclusive; offset += tileSizeBytes) {
    addresses.push({
      spanId: span.spanId,
      tileOffset: offset,
      tileEndExclusive: offset + tileSizeBytes,
      z80Address: directAddressForRomOffset(offset),
    });
  }
  return addresses;
}

function collectTargetAddressIndex(spans) {
  const byWord = new Map();
  for (const span of spans) {
    for (const address of targetAddressesForSpan(span)) {
      if (!byWord.has(address.z80Address)) byWord.set(address.z80Address, []);
      byWord.get(address.z80Address).push(address);
    }
  }
  return byWord;
}

function occurrenceClassForRegion(region, targetRegionId) {
  if (!region) return 'unmapped_direct_address_word_hit';
  if (region.id === targetRegionId) return 'target_graphics_payload_self_hit';
  if (region.type === 'code') return 'code_direct_address_word_hit';
  if (region.type === 'gfx_tiles') return 'other_graphics_payload_word_hit';
  if (/loader|vram|screen|room|palette|sprite|metasprite|tile|map|data|table|unknown/i.test(region.type || '')) {
    return 'mapped_data_direct_address_word_hit';
  }
  return 'mapped_non_graphics_direct_address_word_hit';
}

function scanRomOccurrences(rom, mapData, targetAddressIndex, targetRegionBySpan) {
  const occurrencesBySpan = new Map();
  for (let offset = 0; offset + 1 < rom.length; offset++) {
    const word = rom[offset] | (rom[offset + 1] << 8);
    const targets = targetAddressIndex.get(word);
    if (!targets) continue;
    const sourceRegion = compactRegion(containingRegion(mapData, offset));
    const sourceBank = romBankForOffset(offset);
    for (const target of targets) {
      const targetRegionId = targetRegionBySpan.get(target.spanId)?.id || '';
      const occurrence = {
        occurrenceOffset: offset,
        occurrenceBank: sourceBank,
        targetTileOffset: target.tileOffset,
        z80Address: target.z80Address,
        sourceRegion,
        occurrenceClass: occurrenceClassForRegion(sourceRegion, targetRegionId),
      };
      if (!occurrencesBySpan.has(target.spanId)) occurrencesBySpan.set(target.spanId, []);
      occurrencesBySpan.get(target.spanId).push(occurrence);
    }
  }
  return occurrencesBySpan;
}

function literalUseRole(code, word) {
  const wordHex = word.toString(16).toUpperCase().padStart(4, '0');
  const literal = `\\$${wordHex}`;
  if (new RegExp(`^ld\\s+(?:hl|de|ix|iy),\\s*${literal}\\b`, 'i').test(code)) {
    return 'source_address_register_load_candidate';
  }
  if (new RegExp(`^(?:call|jp)\\s+${literal}\\b`, 'i').test(code)) {
    return 'absolute_code_target_candidate';
  }
  if (new RegExp(`^\\.dw\\b.*${literal}\\b`, 'i').test(code)) {
    return 'data_word_directive';
  }
  if (new RegExp(`^\\.db\\b.*${literal}\\b`, 'i').test(code)) {
    return 'data_byte_directive';
  }
  if (new RegExp(`\\(${literal}\\)`, 'i').test(code)) {
    return 'absolute_memory_operand_candidate';
  }
  return 'other_literal_context';
}

function scanAsmLiteralOccurrences(lines, lineContext, targetAddressIndex) {
  const occurrencesBySpan = new Map();
  for (const [index, line] of lines.entries()) {
    const code = stripComment(line);
    if (!code) continue;
    for (const match of code.matchAll(/\$([0-9A-F]{4})\b/gi)) {
      const word = parseInt(match[1], 16);
      const targets = targetAddressIndex.get(word);
      if (!targets) continue;
      const context = lineContext[index] || null;
      for (const target of targets) {
        const occurrence = {
          line: index + 1,
          enclosingLabel: context?.label || '',
          enclosingOffset: hex(context?.offset),
          region: context?.region || null,
          targetTileOffset: target.tileOffset,
          z80Address: target.z80Address,
          literalUseRole: literalUseRole(code, word),
        };
        if (!occurrencesBySpan.has(target.spanId)) occurrencesBySpan.set(target.spanId, []);
        occurrencesBySpan.get(target.spanId).push(occurrence);
      }
    }
  }
  return occurrencesBySpan;
}

function bankArgumentHex(callsite) {
  return callsite?.bankArgument?.kind === 'immediate' ? hex(callsite.bankArgument.bank, 2) : '';
}

function collectUploaderContexts(catalog) {
  const callsites = [
    ...(catalog.helperCallsites || []),
    ...(catalog.directMapperWrites || []),
  ];
  return callsites.map(callsite => ({
    kind: callsite.kind || '',
    line: callsite.line || null,
    enclosingLabel: callsite.enclosingLabel || '',
    enclosingOffset: callsite.enclosingOffset || '',
    region: callsite.region || null,
    bank: callsite.bankArgument?.kind === 'immediate' ? callsite.bankArgument.bank : null,
    bankHex: bankArgumentHex(callsite),
    hasKnownUploaderCall: Boolean(callsite.hasKnownUploaderCall),
    hasDirectVdpPortWriteNearby: Boolean(callsite.hasDirectVdpPortWriteNearby),
    knownUploaderRoles: (callsite.knownUploaderCalls || []).map(item => item.role),
  }));
}

function uploaderEvidenceForSpan(span, uploaderContexts) {
  const immediateBankCallsites = uploaderContexts.filter(item => item.bank === span.bank);
  const directOrKnownUploaderCallsites = immediateBankCallsites.filter(item => item.hasKnownUploaderCall || item.hasDirectVdpPortWriteNearby);
  return {
    bank: hex(span.bank, 2),
    immediateBankCallsiteCount: immediateBankCallsites.length,
    immediateKnownOrDirectVdpCallsiteCount: directOrKnownUploaderCallsites.length,
    knownUploaderRoleCounts: countBy(directOrKnownUploaderCallsites.flatMap(item => item.knownUploaderRoles), role => role),
    callsiteSamples: directOrKnownUploaderCallsites.slice(0, 8).map(item => ({
      kind: item.kind,
      line: item.line,
      enclosingLabel: item.enclosingLabel,
      enclosingOffset: item.enclosingOffset,
      region: item.region,
      bank: item.bankHex,
      hasKnownUploaderCall: item.hasKnownUploaderCall,
      hasDirectVdpPortWriteNearby: item.hasDirectVdpPortWriteNearby,
      knownUploaderRoles: item.knownUploaderRoles,
    })),
    status: directOrKnownUploaderCallsites.length
      ? 'immediate_bank_uploader_context_exists'
      : 'no_immediate_bank_uploader_context_found',
  };
}

function attachAsmContextFlags(asmOccurrences, uploaderContexts, spanBank) {
  const byRegionAndBank = new Set(uploaderContexts
    .filter(item => item.region?.id && item.bank !== null && (item.hasKnownUploaderCall || item.hasDirectVdpPortWriteNearby))
    .map(item => `${item.region.id}:${item.bank}`));
  return asmOccurrences.map(item => ({
    ...item,
    sameRegionImmediateUploaderContext: item.region?.id
      ? byRegionAndBank.has(`${item.region.id}:${spanBank}`)
      : false,
  }));
}

function classifySpan(span, romOccurrences, asmOccurrences, uploaderEvidence) {
  const codeOccurrenceCount = romOccurrences.filter(item => item.occurrenceClass === 'code_direct_address_word_hit').length;
  const registerLoadLiteralCount = asmOccurrences.filter(item => item.literalUseRole === 'source_address_register_load_candidate').length;
  const sameRegionImmediateUploaderLiteralCount = asmOccurrences.filter(item => item.sameRegionImmediateUploaderContext).length;
  const targetSelfHitCount = romOccurrences.filter(item => item.occurrenceClass === 'target_graphics_payload_self_hit').length;
  const directAddressWordOccurrenceCount = romOccurrences.length;
  const asmLiteralCount = asmOccurrences.length;

  if (sameRegionImmediateUploaderLiteralCount > 0 && registerLoadLiteralCount > 0) {
    return {
      kind: 'strong_direct_source_address_consumer_candidate',
      confidence: 'low',
      priority: 'manual_trace_before_source_coverage',
      confirmedDirectSourceConsumerCount: 0,
      reason: 'A direct source-address literal appears in an address-register-load context in a region with immediate banked upload context, but this still needs instruction-level tracing before coverage promotion.',
    };
  }
  if (uploaderEvidence.immediateKnownOrDirectVdpCallsiteCount === 0) {
    return {
      kind: directAddressWordOccurrenceCount || asmLiteralCount
        ? 'direct_address_words_without_matching_bank_uploader'
        : 'no_direct_address_word_evidence',
      confidence: directAddressWordOccurrenceCount || asmLiteralCount ? 'medium' : 'medium_high',
      priority: 'trace_dynamic_bank_or_decompression_path',
      confirmedDirectSourceConsumerCount: 0,
      reason: `No immediate bank ${hex(span.bank, 2)} uploader context is currently indexed; direct address-word hits remain weak without a matching banked consumer.`,
    };
  }
  if (codeOccurrenceCount || registerLoadLiteralCount) {
    return {
      kind: 'weak_code_direct_address_hit_needs_trace',
      confidence: 'low',
      priority: 'manual_trace_before_source_coverage',
      confirmedDirectSourceConsumerCount: 0,
      reason: 'Code or address-register-load-shaped hits exist, but no line-level trace currently connects them to a known upload routine.',
    };
  }
  if (targetSelfHitCount === directAddressWordOccurrenceCount && !asmLiteralCount) {
    return {
      kind: 'direct_address_words_only_inside_target_payload',
      confidence: 'medium',
      priority: 'deprioritize_raw_word_hit',
      confirmedDirectSourceConsumerCount: 0,
      reason: 'All direct-address-shaped words found for this span are inside the target graphics payload itself, not in a consumer.',
    };
  }
  return {
    kind: directAddressWordOccurrenceCount || asmLiteralCount
      ? 'weak_non_code_direct_address_hits_only'
      : 'no_direct_address_word_evidence',
    confidence: directAddressWordOccurrenceCount || asmLiteralCount ? 'low' : 'medium_high',
    priority: directAddressWordOccurrenceCount || asmLiteralCount
      ? 'deprioritize_without_consumer'
      : 'trace_dynamic_bank_or_decompression_path',
    confirmedDirectSourceConsumerCount: 0,
    reason: directAddressWordOccurrenceCount || asmLiteralCount
      ? 'Only weak direct-address-shaped hits were found; no confirmed source consumer is present.'
      : 'No direct Z80 banked source-address words were found for this span.',
  };
}

function compactRomOccurrence(item) {
  return {
    occurrenceOffset: hex(item.occurrenceOffset),
    occurrenceBank: hex(item.occurrenceBank, 2),
    targetTileOffset: hex(item.targetTileOffset),
    z80Address: hex(item.z80Address, 4),
    sourceRegion: item.sourceRegion,
    occurrenceClass: item.occurrenceClass,
  };
}

function compactAsmOccurrence(item) {
  return {
    line: item.line,
    enclosingLabel: item.enclosingLabel,
    enclosingOffset: item.enclosingOffset,
    region: item.region,
    targetTileOffset: hex(item.targetTileOffset),
    z80Address: hex(item.z80Address, 4),
    literalUseRole: item.literalUseRole,
    sameRegionImmediateUploaderContext: Boolean(item.sameRegionImmediateUploaderContext),
  };
}

function buildSpanEntry(span, occurrencesBySpan, asmBySpan, uploaderEvidence, uploaderContexts) {
  const romOccurrences = (occurrencesBySpan.get(span.spanId) || [])
    .sort((a, b) => a.occurrenceOffset - b.occurrenceOffset || a.targetTileOffset - b.targetTileOffset);
  const asmOccurrences = (asmBySpan.get(span.spanId) || [])
    .sort((a, b) => a.line - b.line || a.targetTileOffset - b.targetTileOffset);
  const asmWithFlags = attachAsmContextFlags(asmOccurrences, uploaderContexts, span.bank);
  const classification = classifySpan(span, romOccurrences, asmWithFlags, uploaderEvidence);
  const uniqueAddressWordCount = new Set(targetAddressesForSpan(span).map(item => item.z80Address)).size;
  const addressWordWithRomHitCount = new Set(romOccurrences.map(item => item.z80Address)).size;
  const addressWordWithAsmLiteralCount = new Set(asmOccurrences.map(item => item.z80Address)).size;

  return {
    spanId: span.spanId,
    region: span.region,
    start: hex(span.start),
    endExclusive: hex(span.endExclusive),
    sizeBytes: span.sizeBytes,
    tileCount: span.tileCount,
    nonblankTileCount: span.nonblankTileCount,
    bank: hex(span.bank, 2),
    z80Range: {
      start: hex(span.z80Start, 4),
      endExclusive: hex(span.z80EndExclusive, 4),
    },
    priorClassification: span.priorClassification,
    sourceWordStatus: span.sourceWordStatus,
    sourceWordCounts: span.sourceWordCounts,
    directAddressCounts: {
      uniqueAddressWordCount,
      addressWordWithRomHitCount,
      addressWordWithAsmLiteralCount,
      romOccurrenceCount: romOccurrences.length,
      asmLiteralCount: asmOccurrences.length,
      codeOccurrenceCount: romOccurrences.filter(item => item.occurrenceClass === 'code_direct_address_word_hit').length,
      targetGraphicsSelfHitCount: romOccurrences.filter(item => item.occurrenceClass === 'target_graphics_payload_self_hit').length,
      otherGraphicsPayloadHitCount: romOccurrences.filter(item => item.occurrenceClass === 'other_graphics_payload_word_hit').length,
    },
    occurrenceClassCounts: countBy(romOccurrences, item => item.occurrenceClass),
    occurrenceRegionTypeCounts: countBy(romOccurrences, item => item.sourceRegion?.type || 'unmapped'),
    asmLiteralUseRoleCounts: countBy(asmWithFlags, item => item.literalUseRole),
    uploaderEvidence,
    classification,
    romOccurrenceSamples: romOccurrences.slice(0, maxSamplesPerSpan).map(compactRomOccurrence),
    asmLiteralSamples: asmWithFlags.slice(0, maxAsmSamplesPerSpan).map(compactAsmOccurrence),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    evidence: [
      `Derived from ${remainingLeadCatalogId}, ${shapeCatalogId}, and ${bankedUploaderCatalogId}.`,
      'Target span tile starts were converted to direct Z80 banked-slot source addresses ($8000-$BFFF) and searched as address words.',
      'Address-word hits are not source coverage without matching banked uploader or decompression/direct-copy consumer evidence.',
      'No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.',
    ],
  };
}

function buildRegionSummaries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.region?.id) continue;
    if (!groups.has(entry.region.id)) {
      groups.set(entry.region.id, {
        region: entry.region,
        spanCount: 0,
        sizeBytes: 0,
        tileCount: 0,
        nonblankTileCount: 0,
        directAddressRomOccurrenceCount: 0,
        asmLiteralCount: 0,
        codeOccurrenceCount: 0,
        confirmedDirectSourceConsumerCount: 0,
        classificationCounts: {},
        uploaderStatusCounts: {},
        largestSpan: null,
        topSpans: [],
      });
    }
    const group = groups.get(entry.region.id);
    group.spanCount++;
    group.sizeBytes += entry.sizeBytes;
    group.tileCount += entry.tileCount;
    group.nonblankTileCount += entry.nonblankTileCount;
    group.directAddressRomOccurrenceCount += entry.directAddressCounts.romOccurrenceCount;
    group.asmLiteralCount += entry.directAddressCounts.asmLiteralCount;
    group.codeOccurrenceCount += entry.directAddressCounts.codeOccurrenceCount;
    group.confirmedDirectSourceConsumerCount += entry.classification.confirmedDirectSourceConsumerCount || 0;
    group.classificationCounts[entry.classification.kind] = (group.classificationCounts[entry.classification.kind] || 0) + 1;
    group.uploaderStatusCounts[entry.uploaderEvidence.status] = (group.uploaderStatusCounts[entry.uploaderEvidence.status] || 0) + 1;
    if (!group.largestSpan || entry.sizeBytes > group.largestSpan.sizeBytes) {
      group.largestSpan = {
        spanId: entry.spanId,
        start: entry.start,
        endExclusive: entry.endExclusive,
        sizeBytes: entry.sizeBytes,
        classification: entry.classification,
      };
    }
    group.topSpans.push({
      spanId: entry.spanId,
      start: entry.start,
      endExclusive: entry.endExclusive,
      sizeBytes: entry.sizeBytes,
      classification: entry.classification.kind,
      romOccurrenceCount: entry.directAddressCounts.romOccurrenceCount,
      asmLiteralCount: entry.directAddressCounts.asmLiteralCount,
      uploaderStatus: entry.uploaderEvidence.status,
    });
  }
  return [...groups.values()]
    .map(group => ({
      ...group,
      topSpans: group.topSpans
        .sort((a, b) => b.sizeBytes - a.sizeBytes || String(a.spanId).localeCompare(String(b.spanId)))
        .slice(0, 10),
    }))
    .sort((a, b) => b.nonblankTileCount - a.nonblankTileCount || parseHex(a.region.offset) - parseHex(b.region.offset));
}

function buildCatalog(mapData, rom, asmText) {
  const remainingLeadCatalog = requireCatalog(mapData, remainingLeadCatalogId);
  const shapeCatalog = requireCatalog(mapData, shapeCatalogId);
  const combinedCoverageCatalog = requireCatalog(mapData, combinedCoverageCatalogId);
  const bankedUploaderCatalog = requireCatalog(mapData, bankedUploaderCatalogId);
  const spans = collectTargetSpans(remainingLeadCatalog, shapeCatalog);
  const targetAddressIndex = collectTargetAddressIndex(spans);
  const targetRegionBySpan = new Map(spans.map(span => [span.spanId, span.region]));
  const occurrencesBySpan = scanRomOccurrences(rom, mapData, targetAddressIndex, targetRegionBySpan);
  const { lines, lineContext } = parseAsmContext(asmText, mapData);
  const asmBySpan = scanAsmLiteralOccurrences(lines, lineContext, targetAddressIndex);
  const uploaderContexts = collectUploaderContexts(bankedUploaderCatalog);

  const entries = spans.map(span => buildSpanEntry(
    span,
    occurrencesBySpan,
    asmBySpan,
    uploaderEvidenceForSpan(span, uploaderContexts),
    uploaderContexts,
  ));

  const regions = buildRegionSummaries(entries);
  const summary = {
    remainingLeadCatalogId,
    shapeCatalogId,
    combinedCoverageCatalogId,
    bankedUploaderCatalogId,
    targetSpanCount: entries.length,
    targetRegionCount: regions.length,
    targetTileCount: sumBy(entries, entry => entry.tileCount),
    nonblankTileCount: sumBy(entries, entry => entry.nonblankTileCount),
    uniqueDirectAddressWordCount: targetAddressIndex.size,
    directAddressRomOccurrenceCount: sumBy(entries, entry => entry.directAddressCounts.romOccurrenceCount),
    asmLiteralCount: sumBy(entries, entry => entry.directAddressCounts.asmLiteralCount),
    codeOccurrenceCount: sumBy(entries, entry => entry.directAddressCounts.codeOccurrenceCount),
    confirmedDirectSourceConsumerCount: sumBy(entries, entry => entry.classification.confirmedDirectSourceConsumerCount || 0),
    immediateBankUploaderContextSpanCount: entries.filter(entry => entry.uploaderEvidence.status === 'immediate_bank_uploader_context_exists').length,
    noImmediateBankUploaderContextSpanCount: entries.filter(entry => entry.uploaderEvidence.status === 'no_immediate_bank_uploader_context_found').length,
    classificationCounts: countBy(entries, entry => entry.classification.kind),
    uploaderStatusCounts: countBy(entries, entry => entry.uploaderEvidence.status),
    occurrenceClassCounts: entries.reduce((acc, entry) => {
      for (const [key, count] of Object.entries(entry.occurrenceClassCounts || {})) acc[key] = (acc[key] || 0) + count;
      return acc;
    }, {}),
    coverageChangedByThisAudit: false,
    combinedGraphicsCoveragePercent: combinedCoverageCatalog.summary?.combinedCoveragePercent ?? null,
    combinedUnreferencedTileCount: combinedCoverageCatalog.summary?.unreferencedTiles ?? null,
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    assetPolicy: 'Metadata only: graphics span offsets, Z80 source-address words, occurrence counts, region ids/types, ASM line numbers/labels, and uploader-context classifications. No ROM bytes, hashes, decoded graphics, pixels, screenshots, rendered tiles, audio, or ASM instruction payloads are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      remainingLeadCatalogId,
      shapeCatalogId,
      combinedCoverageCatalogId,
      bankedUploaderCatalogId,
    ],
    summary,
    regions,
    spans: entries,
    prioritySpans: entries
      .filter(entry => entry.classification.priority !== 'deprioritize_raw_word_hit')
      .slice(0, 16),
    evidence: [
      `${remainingLeadCatalogId} defines the current unreferenced graphics-source work queue.`,
      `${bankedUploaderCatalogId} supplies immediate bank/uploader callsite evidence used to reject simple direct-address consumer paths.`,
      'This audit searches direct Z80 banked-slot addresses, not the compact loader source-word encoding covered by earlier _LABEL_8FB_/_LABEL_998_ audits.',
      'No span is promoted to source coverage because no direct source-address hit is connected to a confirmed banked upload/decompression consumer here.',
      'No ROM bytes, hashes, decoded graphics, pixels, screenshots, rendered assets, audio, or ASM instruction payloads are stored.',
    ],
    nextLeads: [
      'Trace dynamic bank arguments that feed _LABEL_A48_, _LABEL_A97_, _LABEL_99B_, and _LABEL_919_ because direct immediate-bank uploader evidence is absent for these graphics banks.',
      'For r0758 bank-12 spans with no direct address-word hits, prioritize decompression or scene-specific indirect table paths over raw pointer searches.',
      'For r0755/r2645/r2656 spans with weak address-word hits, inspect only hits that land in code or a structured data catalog with a real consumer before changing coverage.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const group of catalog.regions) {
    const region = findRegionById(mapData, group.region.id);
    if (!region) {
      missingRegions.push(group.region);
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.graphicsDirectSourceAddressAudit = {
        catalogId,
        kind: 'direct_z80_source_address_scan',
        confidence: group.confirmedDirectSourceConsumerCount ? 'low' : 'medium',
        summary: 'Direct Z80 banked-slot source-address scan for currently unreferenced graphics spans.',
        detail: {
          spanCount: group.spanCount,
          tileCount: group.tileCount,
          nonblankTileCount: group.nonblankTileCount,
          directAddressRomOccurrenceCount: group.directAddressRomOccurrenceCount,
          asmLiteralCount: group.asmLiteralCount,
          codeOccurrenceCount: group.codeOccurrenceCount,
          confirmedDirectSourceConsumerCount: group.confirmedDirectSourceConsumerCount,
          classificationCounts: group.classificationCounts,
          uploaderStatusCounts: group.uploaderStatusCounts,
          largestSpan: group.largestSpan,
          topSpans: group.topSpans,
        },
        coverageChangedByThisAudit: false,
        persistedRomByteCount: 0,
        persistedHashCount: 0,
        persistedPixelCount: 0,
        evidence: [
          `Derived from ${catalogId}; direct-address hits are leads only unless a banked upload/decompression consumer is traced.`,
          'No ROM bytes, hashes, decoded graphics, pixels, screenshots, rendered tiles, audio, or ASM instruction payloads are stored.',
        ],
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      inferredAnalysis: 'graphicsDirectSourceAddressAudit',
      spanCount: group.spanCount,
      directAddressRomOccurrenceCount: group.directAddressRomOccurrenceCount,
      asmLiteralCount: group.asmLiteralCount,
      confirmedDirectSourceConsumerCount: group.confirmedDirectSourceConsumerCount,
      classificationCounts: group.classificationCounts,
    });
  }
  return { changedRegions, missingRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, rom, asmText);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_direct_source_address_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      changedRegions: annotation.changedRegions,
      missingRegions: annotation.missingRegions,
      prioritySpans: catalog.prioritySpans,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    prioritySpans: catalog.prioritySpans.slice(0, 8).map(span => ({
      spanId: span.spanId,
      region: span.region?.id || '',
      start: span.start,
      endExclusive: span.endExclusive,
      bank: span.bank,
      directAddressCounts: span.directAddressCounts,
      uploaderStatus: span.uploaderEvidence.status,
      classification: span.classification,
    })),
  }, null, 2));
}

main();
