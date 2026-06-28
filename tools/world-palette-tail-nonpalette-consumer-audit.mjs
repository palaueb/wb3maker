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
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-palette-tail-nonpalette-consumer-audit.mjs';
const catalogId = 'world-palette-tail-nonpalette-consumer-catalog-2026-06-26';
const reportId = 'palette-tail-nonpalette-consumer-audit-2026-06-26';

const sourceCatalogs = [
  'world-palette-tail-consumer-catalog-2026-06-25',
  'world-palette-tail-layout-refinement-catalog-2026-06-25',
  'world-residual-proof-consumer-catalog-2026-06-26',
  'world-palette-cf65-entry25-evaluator-catalog-2026-06-26',
];

const targetRegions = [
  { id: 'r2815', label: '_DATA_1CBB9_', start: 0x1CBB9, endExclusive: 0x1CBC0 },
  { id: 'r2816', label: '_DATA_1CBC0_', start: 0x1CBC0, endExclusive: 0x1CBD0 },
  { id: 'r2817', label: '_DATA_1CBD0_', start: 0x1CBD0, endExclusive: 0x1CCC0 },
];

const alignedPointerSourceTypes = new Set([
  'pointer_table',
  'screen_prog_table',
  'palette_script_table',
  'room_subrecord',
  'room_seq_table',
  'entity_behavior_table',
  'entity_anim_table',
]);

const screenProgStreamTypes = new Set([
  'screen_prog',
]);

const streamWordShapeSourceTypes = new Set([
  'vdp_stream',
  'dynamic_tile_loader',
  'vram_loader_8fb',
  'vram_loader_998',
  'palette_script',
  'entity_anim_script',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function hex(value, pad = 5) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseHex(value) {
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function readWordLE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function regionStart(region) {
  return parseHex(region?.offset) ?? 0;
}

function regionEnd(region) {
  return regionStart(region) + Number(region?.size || 0);
}

function bankForOffset(offset) {
  return Math.floor(offset / 0x4000);
}

function z80PointerForOffset(offset) {
  const bank = bankForOffset(offset);
  if (bank === 0) return offset;
  if (bank === 1) return 0x4000 + (offset - 0x4000);
  return 0x8000 + (offset % 0x4000);
}

function bankedPointerToRom(bank, pointer) {
  if (bank === 0 && pointer < 0x4000) return pointer;
  if (bank === 1 && pointer >= 0x4000 && pointer < 0x8000) return 0x4000 + (pointer - 0x4000);
  if (bank >= 2 && pointer >= 0x8000 && pointer < 0xC000) return bank * 0x4000 + (pointer - 0x8000);
  return null;
}

function rangeContains(range, offset) {
  return offset >= range.start && offset < range.endExclusive;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
    confidence: region.confidence || null,
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
    const found = value.find(item => item?.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
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

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function stripComment(line) {
  return line.split(';')[0].trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asmRefsForLabelOrAddress(asmText, target) {
  const labels = [target.label];
  const parentLabels = ['_DATA_1CABB_'];
  const addressTokens = [
    z80PointerForOffset(target.start),
    z80PointerForOffset(target.endExclusive - 1),
    target.start,
    target.endExclusive - 1,
  ].flatMap(value => [hex(value, 4), `$${Number(value).toString(16).toUpperCase().padStart(4, '0')}`]);
  const allTokens = labels.concat(parentLabels, addressTokens);
  const tokenRe = new RegExp(allTokens.map(escapeRegExp).join('|'));
  const refs = [];
  const lines = asmText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const code = stripComment(lines[i]);
    if (!code || !tokenRe.test(code)) continue;
    if (new RegExp(`^${escapeRegExp(target.label)}:`).test(code)) continue;
    if (/^\.incbin\b/i.test(code)) continue;
    const matched = allTokens.filter(token => code.includes(token));
    refs.push({
      targetId: target.id,
      line: i + 1,
      matched,
      targetSpecific: matched.some(token => token === target.label || addressTokens.includes(token)),
      parentLabelOnly: matched.length > 0 && matched.every(token => parentLabels.includes(token)),
      refKind: /^\.dw\b/i.test(code) ? 'word_record_or_pointer_table' : (code.includes(target.label) ? 'label_ref' : 'address_ref'),
    });
  }
  return refs;
}

function sourceBankContext(region) {
  if (!region) return { bank: null, reason: 'no_source_region' };
  const start = regionStart(region);
  if (start === 0x1071A) {
    return {
      bank: 6,
      reason: '_DATA_1071A_ metasprite table pointer words target the bank-6 window.',
    };
  }
  return {
    bank: Number.isFinite(region.bank) ? region.bank : bankForOffset(start),
    reason: 'source region bank context',
  };
}

function isAlignedPointerSourceHit(hit) {
  const sourceRegion = hit.sourceRegion;
  if (!sourceRegion || !alignedPointerSourceTypes.has(sourceRegion.type || 'unknown')) return false;
  const sourceOffset = parseHex(hit.sourceOffset);
  if (sourceOffset == null) return false;
  const delta = sourceOffset - regionStart(sourceRegion);
  return delta >= 0 && delta % 2 === 0 && sourceOffset + 1 < regionEnd(sourceRegion);
}

function statusForWordHit(hit, targetRange) {
  const sourceRegion = hit.sourceRegion;
  const sourceStart = regionStart(sourceRegion);
  const sourceEnd = regionEnd(sourceRegion);
  const sourceType = sourceRegion?.type || 'unknown';
  if (rangesOverlap(sourceStart, sourceEnd, targetRange.start, targetRange.endExclusive)) {
    return 'inside_target_payload';
  }
  if (sourceRegion?.analysis?.paletteScriptAudit || sourceRegion?.type === 'palette_script' || sourceRegion?.type === 'palette_script_table') {
    return 'palette_script_path_word_shape';
  }
  if (hit.trueTargetOffset != null && rangeContains(targetRange, hit.trueTargetOffset)) {
    if (alignedPointerSourceTypes.has(sourceType)) {
      return isAlignedPointerSourceHit(hit)
        ? 'same_bank_aligned_nonpalette_pointer_candidate'
        : 'same_bank_unaligned_pointer_table_word_shape';
    }
    if (screenProgStreamTypes.has(sourceType)) {
      return 'same_bank_screen_prog_word_shape_requires_decoder_trace';
    }
    if (streamWordShapeSourceTypes.has(sourceType)) {
      return 'same_bank_stream_word_shape_requires_decoder_trace';
    }
    return 'same_bank_nonpointer_word_shape';
  }
  return 'bank_context_mismatch_word_shape';
}

function targetForOffset(offset) {
  return targetRegions.find(target => rangeContains(target, offset)) || null;
}

function wordHitsForRange(rom, mapData, targetRange) {
  const z80Start = z80PointerForOffset(targetRange.start);
  const z80EndExclusive = z80PointerForOffset(targetRange.endExclusive - 1) + 1;
  const hits = [];
  for (let offset = 0; offset + 1 < rom.length; offset++) {
    const word = readWordLE(rom, offset);
    if (word < z80Start || word >= z80EndExclusive) continue;
    const sourceRegion = containingRegion(mapData, offset);
    const bankContext = sourceBankContext(sourceRegion);
    const trueTargetOffset = bankContext.bank == null ? null : bankedPointerToRom(bankContext.bank, word);
    const apparentTargetOffset = targetRange.start + (word - z80Start);
    const hit = {
      sourceOffset: hex(offset),
      sourceRegion: compactRegion(sourceRegion),
      sourceBank: bankContext.bank,
      sourceBankContextReason: bankContext.reason,
      trueTargetOffset: trueTargetOffset == null ? null : hex(trueTargetOffset),
      apparentTargetOffset: hex(apparentTargetOffset),
      targetRegionId: targetForOffset(apparentTargetOffset)?.id || null,
    };
    hit.status = statusForWordHit({
      ...hit,
      sourceRegion,
      trueTargetOffset,
    }, targetRange);
    hits.push(hit);
  }
  return hits.sort((a, b) => a.sourceOffset.localeCompare(b.sourceOffset));
}

function perRegionSummary(target, asmRefs, wordHits) {
  const region = target.region;
  const hitsForTarget = wordHits.filter(hit => hit.targetRegionId === target.id);
  const alignedPointerCandidates = hitsForTarget.filter(hit => hit.status === 'same_bank_aligned_nonpalette_pointer_candidate');
  const screenProgWordShapes = hitsForTarget.filter(hit => hit.status === 'same_bank_screen_prog_word_shape_requires_decoder_trace');
  const streamWordShapes = hitsForTarget.filter(hit => hit.status === 'same_bank_stream_word_shape_requires_decoder_trace');
  const unalignedPointerTableWordShapes = hitsForTarget.filter(hit => hit.status === 'same_bank_unaligned_pointer_table_word_shape');
  const sameBankNonPointerWordShapes = hitsForTarget.filter(hit => hit.status === 'same_bank_nonpointer_word_shape');
  const exactRefs = asmRefs.filter(ref => ref.targetId === target.id && ref.targetSpecific);
  let status = 'no_static_nonpalette_consumer_found';
  if (exactRefs.length > 0 || alignedPointerCandidates.length > 0) {
    status = 'aligned_nonpalette_pointer_or_exact_ref_requires_trace';
  } else if (screenProgWordShapes.length > 0 || streamWordShapes.length > 0 || unalignedPointerTableWordShapes.length > 0) {
    status = 'same_bank_word_shapes_require_decoder_trace';
  } else if (sameBankNonPointerWordShapes.length > 0) {
    status = 'same_bank_nonpointer_word_shapes_observed_no_confirmed_consumer';
  }
  return {
    region: compactRegion(region),
    splitLabel: target.label,
    z80PointerRange: [hex(z80PointerForOffset(target.start), 4), hex(z80PointerForOffset(target.endExclusive - 1), 4)],
    exactAsmReferenceCount: exactRefs.length,
    wordShapeHitCount: hitsForTarget.length,
    sameBankAlignedNonPalettePointerCandidateCount: alignedPointerCandidates.length,
    sameBankScreenProgWordShapeCount: screenProgWordShapes.length,
    sameBankStreamWordShapeCount: streamWordShapes.length,
    sameBankUnalignedPointerTableWordShapeCount: unalignedPointerTableWordShapes.length,
    sameBankNonPointerWordShapeCount: sameBankNonPointerWordShapes.length,
    statusCounts: countBy(hitsForTarget, hit => hit.status),
    status,
  };
}

function buildCatalog(mapData, rom, asmText) {
  for (const id of sourceCatalogs) requireCatalog(mapData, id);
  const targetRange = {
    start: targetRegions[0].start,
    endExclusive: targetRegions[targetRegions.length - 1].endExclusive,
  };
  const targets = targetRegions.map(target => ({
    ...target,
    region: findRegion(mapData, target.id),
  }));
  const asmRefs = targets.flatMap(target => asmRefsForLabelOrAddress(asmText, target));
  const targetSpecificAsmRefs = asmRefs.filter(ref => ref.targetSpecific);
  const parentOnlyAsmRefs = asmRefs.filter(ref => ref.parentLabelOnly);
  const wordHits = wordHitsForRange(rom, mapData, targetRange);
  const alignedPointerCandidates = wordHits.filter(hit => hit.status === 'same_bank_aligned_nonpalette_pointer_candidate');
  const screenProgWordShapes = wordHits.filter(hit => hit.status === 'same_bank_screen_prog_word_shape_requires_decoder_trace');
  const streamWordShapes = wordHits.filter(hit => hit.status === 'same_bank_stream_word_shape_requires_decoder_trace');
  const unalignedPointerTableWordShapes = wordHits.filter(hit => hit.status === 'same_bank_unaligned_pointer_table_word_shape');
  const sameBankNonPointer = wordHits.filter(hit => hit.status === 'same_bank_nonpointer_word_shape');
  const bankMismatch = wordHits.filter(hit => hit.status === 'bank_context_mismatch_word_shape');
  const insidePayload = wordHits.filter(hit => hit.status === 'inside_target_payload');
  const perRegion = targets.map(target => perRegionSummary(target, asmRefs, wordHits));
  let status = 'no_static_nonpalette_consumer_found_for_palette_tail';
  if (targetSpecificAsmRefs.filter(ref => ref.refKind !== 'word_record_or_pointer_table').length > 0 || alignedPointerCandidates.length > 0) {
    status = 'aligned_nonpalette_pointer_or_exact_ref_requires_trace';
  } else if (screenProgWordShapes.length > 0 || streamWordShapes.length > 0 || unalignedPointerTableWordShapes.length > 0) {
    status = 'same_bank_word_shapes_require_decoder_trace';
  } else if (sameBankNonPointer.length > 0) {
    status = 'same_bank_nonpointer_word_shapes_observed_no_confirmed_consumer';
  }

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: region ids, offsets, labels, bank-context classifications, source offsets, target offsets, and counts. No ROM bytes, tile-map bytes, palette values, decoded graphics, rendered pixels, audio, hashes, instruction bytes, or register traces are embedded.',
    summary: {
      targetRange: {
        start: hex(targetRange.start),
        endExclusive: hex(targetRange.endExclusive),
        z80PointerRange: [hex(z80PointerForOffset(targetRange.start), 4), hex(z80PointerForOffset(targetRange.endExclusive - 1), 4)],
      },
      targetRegionCount: targets.length,
      targetByteCount: targetRange.endExclusive - targetRange.start,
      exactAsmReferenceCount: targetSpecificAsmRefs.length,
      parentAsmReferenceCount: parentOnlyAsmRefs.length,
      wordShapeHitCount: wordHits.length,
      sameBankAlignedNonPalettePointerCandidateCount: alignedPointerCandidates.length,
      sameBankScreenProgWordShapeCount: screenProgWordShapes.length,
      sameBankStreamWordShapeCount: streamWordShapes.length,
      sameBankUnalignedPointerTableWordShapeCount: unalignedPointerTableWordShapes.length,
      sameBankNonPointerWordShapeCount: sameBankNonPointer.length,
      bankContextMismatchWordShapeCount: bankMismatch.length,
      insidePayloadWordShapeCount: insidePayload.length,
      statusCounts: countBy(wordHits, hit => hit.status),
      perRegionStatusCounts: countBy(perRegion, item => item.status),
      status,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedTileMapByteCount: 0,
      persistedPaletteByteCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    perRegion,
    asmRefs: asmRefs.slice(0, 32),
    wordShapeSamples: {
      sameBankAlignedNonPalettePointerCandidates: alignedPointerCandidates.slice(0, 32),
      sameBankScreenProgWordShapes: screenProgWordShapes.slice(0, 32),
      sameBankStreamWordShapes: streamWordShapes.slice(0, 32),
      sameBankUnalignedPointerTableWordShapes: unalignedPointerTableWordShapes.slice(0, 16),
      sameBankNonPointerWordShapes: sameBankNonPointer.slice(0, 16),
      bankContextMismatchWordShapes: bankMismatch.slice(0, 32),
      insidePayloadWordShapes: insidePayload.slice(0, 16),
    },
    evidence: [
      'The _LABEL_10BC_ entry-25 evaluator proves the palette parser loops inside the parsed _DATA_1CABB_ prefix and has zero command hits in r2815-r2817.',
      'This audit scans exact split-label/address references and little-endian word-shaped references into 0x1CBB9-0x1CCBF with source-bank context.',
      'No same-bank non-palette pointer candidate is treated as a pointer lead unless it comes from an aligned pointer-bearing source region entry.',
      'Word-shaped hits inside screen_prog, loader streams, item data, or unaligned table byte pairs are retained only as decoder-trace leads, not as confirmed consumers.',
      'All stored findings are offsets, ids, labels, counts, and classifications only; payload bytes remain local to the ROM.',
    ],
    nextLeads: [
      'If a future live trace reads 0x1CBB9-0x1CCBF outside _LABEL_10BC_, add that routine as the concrete consumer before promoting any tail region.',
      'Keep r2817 as a low-confidence tile/index candidate until a non-palette consumer or screen path is proven.',
      'Move the residual proof effort to _RAM_CF64_ index 227 and bank-7 _DATA_1E337_ after this static non-palette scan.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const annotated = [];
  for (const entry of catalog.perRegion) {
    const region = entry.region ? findRegion(mapData, entry.region.id) : null;
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.paletteTailNonPaletteConsumerAudit = {
      catalogId,
      kind: 'palette_tail_nonpalette_consumer_static_scan',
      status: entry.status,
      confidence: entry.status === 'no_static_nonpalette_consumer_found' ? 'medium_high_for_static_absence_low_for_semantic_role' : 'low',
      exactAsmReferenceCount: entry.exactAsmReferenceCount,
      wordShapeHitCount: entry.wordShapeHitCount,
      sameBankAlignedNonPalettePointerCandidateCount: entry.sameBankAlignedNonPalettePointerCandidateCount,
      sameBankScreenProgWordShapeCount: entry.sameBankScreenProgWordShapeCount,
      sameBankStreamWordShapeCount: entry.sameBankStreamWordShapeCount,
      sameBankUnalignedPointerTableWordShapeCount: entry.sameBankUnalignedPointerTableWordShapeCount,
      sameBankNonPointerWordShapeCount: entry.sameBankNonPointerWordShapeCount,
      statusCounts: entry.statusCounts,
      summary: `${entry.region.id} has no confirmed static non-palette consumer for the post-_DATA_1CABB_ tail range; same-bank word-shaped hits, if present, are decoder-trace leads only.`,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (region.analysis.unresolvedAssetConsumerAudit) {
      region.analysis.unresolvedAssetConsumerAudit.paletteTailNonPaletteConsumerStatus = entry.status;
      region.analysis.unresolvedAssetConsumerAudit.paletteTailNonPaletteConsumerAudit = catalogId;
    }
    annotated.push({
      id: region.id,
      offset: region.offset,
      status: entry.status,
      sameBankAlignedNonPalettePointerCandidateCount: entry.sameBankAlignedNonPalettePointerCandidateCount,
      sameBankScreenProgWordShapeCount: entry.sameBankScreenProgWordShapeCount,
      sameBankStreamWordShapeCount: entry.sameBankStreamWordShapeCount,
    });
  }
  return annotated;
}

function updateStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.paletteTailNonPaletteConsumerCatalog = catalogId;
  staticMap.summary.paletteTailNonPaletteConsumerTargetRegions = catalog.summary.targetRegionCount;
  staticMap.summary.paletteTailNonPaletteConsumerCandidates = catalog.summary.sameBankAlignedNonPalettePointerCandidateCount;
  staticMap.summary.paletteTailNonPaletteConsumerAlignedPointerCandidates = catalog.summary.sameBankAlignedNonPalettePointerCandidateCount;
  staticMap.summary.paletteTailNonPaletteConsumerScreenProgWordShapes = catalog.summary.sameBankScreenProgWordShapeCount;
  staticMap.summary.paletteTailNonPaletteConsumerStreamWordShapes = catalog.summary.sameBankStreamWordShapeCount;
  staticMap.summary.paletteTailNonPaletteConsumerUnalignedPointerTableWordShapes = catalog.summary.sameBankUnalignedPointerTableWordShapeCount;
  staticMap.summary.paletteTailNonPaletteConsumerWordShapeHits = catalog.summary.wordShapeHitCount;
  staticMap.summary.paletteTailNonPaletteConsumerBankMismatchHits = catalog.summary.bankContextMismatchWordShapeCount;
  staticMap.summary.paletteTailNonPaletteConsumerStatus = catalog.summary.status;
  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.rendering = insertAfter(
    staticMap.primaryCatalogs.rendering,
    'world-palette-cf65-entry25-evaluator-catalog-2026-06-26',
    catalogId
  );
  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.push('Use world-palette-tail-nonpalette-consumer-catalog-2026-06-26 as the static non-palette consumer exclusion for r2815-r2817 before moving residual proof work to CF64 and _DATA_1E337_.');
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, rom, asmText);
  const annotated = apply ? applyCatalog(mapData, catalog) : [];

  if (apply) {
    mapData.paletteCatalogs = (mapData.paletteCatalogs || []).filter(item => item.id !== catalogId);
    mapData.paletteCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'palette_tail_nonpalette_consumer_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      catalogId,
      sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotated.length,
      },
      perRegion: catalog.perRegion,
      wordShapeSamples: catalog.wordShapeSamples,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      annotatedRegions: annotated,
    });
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotated.length,
    },
    perRegion: catalog.perRegion,
    wordShapeSamples: catalog.wordShapeSamples,
  }, null, 2));
}

main();
