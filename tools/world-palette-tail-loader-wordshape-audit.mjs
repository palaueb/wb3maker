#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-palette-tail-loader-wordshape-audit.mjs';
const catalogId = 'world-palette-tail-loader-wordshape-catalog-2026-06-26';
const reportId = 'palette-tail-loader-wordshape-audit-2026-06-26';
const sourceCatalogs = [
  'world-palette-tail-nonpalette-consumer-catalog-2026-06-26',
  'world-dynamic-tile-source-table-catalog-2026-06-25',
  'world-tile-source-catalog-2026-06-24',
];

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

function regionStart(region) {
  return parseHex(region?.offset) ?? 0;
}

function regionEnd(region) {
  return regionStart(region) + Number(region?.size || 0);
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

function sourceInfoFromOperands(rom, sourceOffset) {
  const srcLo = rom[sourceOffset];
  const srcHi = rom[sourceOffset + 1];
  const sourceBank = srcHi >> 1;
  const sourceBlockIndex = ((srcHi & 1) << 8) | srcLo;
  const sourceStart = sourceBank * 0x4000 + sourceBlockIndex * 32;
  return {
    sourceBank,
    sourceBlockIndex,
    sourceStart,
    sourceEndExclusive: sourceStart + 32,
  };
}

function decodeLoader998Like(rom, startOffset, endExclusive, loaderType, mapData) {
  const records = [];
  const byOffset = new Map();
  const warnings = [];
  let pc = startOffset;
  let entryIndex = 0;
  let vramPtr = 0;
  let terminated = false;
  let endReason = 'Unexpected EOF';

  function addRecord(record) {
    records.push(record);
    for (const byte of record.bytes) {
      byOffset.set(byte.offset, { record, byte });
    }
  }

  while (pc < endExclusive && entryIndex < 512) {
    const entryOffset = pc;
    const opcode = rom[pc++];
    if (opcode === 0) {
      terminated = true;
      endReason = `END @ ${hex(entryOffset)}`;
      addRecord({
        entryIndex,
        entryOffset,
        entryOffsetHex: hex(entryOffset),
        kind: 'end',
        loaderType,
        length: 1,
        bytes: [{ offset: entryOffset, role: 'terminator' }],
      });
      break;
    }

    const hasSetPos = Boolean(opcode & 0x80);
    const count = opcode & 0x7F;
    const bytes = [{ offset: entryOffset, role: hasSetPos ? 'setpos_count_opcode' : 'count_opcode' }];
    let destinationTile = null;
    if (hasSetPos) {
      if (pc >= endExclusive) {
        endReason = `Truncated set-pos @ ${hex(entryOffset)}`;
        warnings.push(endReason);
        break;
      }
      destinationTile = rom[pc];
      vramPtr = destinationTile * 32;
      bytes.push({ offset: pc, role: 'destination_tile_operand' });
      pc++;
    }

    const vramTileStart = vramPtr >> 5;
    if (count === 0x7F) {
      addRecord({
        entryIndex,
        entryOffset,
        entryOffsetHex: hex(entryOffset),
        kind: 'zero_fill_tile_block',
        loaderType,
        length: pc - entryOffset,
        tileBlocks: 1,
        destinationTile: destinationTile == null ? null : hex(destinationTile, 2),
        vramTileRange: { start: hex(vramTileStart, 3), end: hex(vramTileStart, 3), count: 1 },
        bytes,
      });
      vramPtr += 32;
      entryIndex++;
      continue;
    }

    if (count === 0) {
      addRecord({
        entryIndex,
        entryOffset,
        entryOffsetHex: hex(entryOffset),
        kind: 'noop',
        loaderType,
        length: pc - entryOffset,
        tileBlocks: 0,
        destinationTile: destinationTile == null ? null : hex(destinationTile, 2),
        bytes,
      });
      entryIndex++;
      continue;
    }

    if (pc + 1 >= endExclusive) {
      endReason = `Truncated source record @ ${hex(entryOffset)}`;
      warnings.push(endReason);
      break;
    }

    const sourceOperandOffset = pc;
    bytes.push({ offset: pc, role: 'source_low_operand' });
    bytes.push({ offset: pc + 1, role: 'source_high_bank_block_operand' });
    const source = sourceInfoFromOperands(rom, pc);
    pc += 2;
    const sourceRegion = source.sourceEndExclusive <= rom.length
      ? containingRegion(mapData, source.sourceStart)
      : null;
    addRecord({
      entryIndex,
      entryOffset,
      entryOffsetHex: hex(entryOffset),
      kind: 'source_tile_record',
      loaderType,
      length: pc - entryOffset,
      tileBlocks: count,
      destinationTile: destinationTile == null ? null : hex(destinationTile, 2),
      vramTileRange: {
        start: hex(vramTileStart, 3),
        end: hex(vramTileStart + count - 1, 3),
        count,
      },
      sourceOperandRange: { start: hex(sourceOperandOffset), endExclusive: hex(sourceOperandOffset + 2) },
      source: {
        bank: source.sourceBank,
        blockIndex: hex(source.sourceBlockIndex, 3),
        romStart: hex(source.sourceStart),
        romEndExclusive: hex(source.sourceStart + count * 32),
        sourceRegion: compactRegion(sourceRegion),
      },
      bytes,
    });
    vramPtr += count * 32;
    entryIndex++;
  }

  if (!terminated && pc >= endExclusive) warnings.push(endReason);
  return {
    loaderType,
    startOffset,
    endExclusive,
    start: hex(startOffset),
    endExclusiveHex: hex(endExclusive),
    terminated,
    endReason,
    warningCount: warnings.length,
    warnings,
    records,
    byOffset,
  };
}

function collectDynamicStreamsCovering(mapData, targetOffset) {
  const catalog = requireCatalog(mapData, 'world-dynamic-tile-source-table-catalog-2026-06-25');
  const streams = [];
  function scan(value) {
    if (Array.isArray(value)) {
      for (const item of value) scan(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.streamRomOffset && value.decoded?.endInclusive) {
      const start = parseHex(value.streamRomOffset);
      const endInclusive = parseHex(value.decoded.endInclusive);
      if (start != null && endInclusive != null && targetOffset >= start && targetOffset <= endInclusive) {
        streams.push(value);
      }
    }
    for (const child of Object.values(value)) scan(child);
  }
  scan(catalog);
  return streams;
}

function byteContext(decoded, offset) {
  const item = decoded?.byOffset?.get(offset);
  if (!item) return null;
  return {
    entryIndex: item.record.entryIndex,
    entryOffset: item.record.entryOffsetHex,
    recordKind: item.record.kind,
    loaderType: item.record.loaderType,
    byteRole: item.byte.role,
    sourceOperandRange: item.record.sourceOperandRange || null,
    source: item.record.source || null,
    vramTileRange: item.record.vramTileRange || null,
  };
}

function pairStatus(first, second, secondRegion) {
  if (!first && !second) return 'not_covered_by_loader_decoder';
  if (first && second && first.entryOffset === second.entryOffset) {
    if (first.byteRole === 'source_low_operand' && second.byteRole === 'source_high_bank_block_operand') {
      return 'loader_source_word_operand_pair';
    }
    if (first.byteRole.endsWith('count_opcode') && second.byteRole === 'source_low_operand') {
      return 'loader_count_and_source_low_byte_pair';
    }
    if (first.byteRole === 'setpos_count_opcode' && second.byteRole === 'destination_tile_operand') {
      return 'loader_setpos_count_and_destination_tile_pair';
    }
    return 'loader_same_record_non_source_pair';
  }
  if (first?.byteRole === 'terminator' && secondRegion) return 'loader_terminator_next_region_byte_pair';
  if (first || second) return 'loader_cross_record_byte_pair';
  return 'not_covered_by_loader_decoder';
}

function classifyLead(mapData, rom, lead) {
  const sourceOffset = parseHex(lead.sourceOffset);
  const sourceRegion = lead.sourceRegion?.id ? findRegion(mapData, lead.sourceRegion.id) : null;
  const secondRegion = sourceOffset == null ? null : containingRegion(mapData, sourceOffset + 1);
  if (sourceOffset == null || !sourceRegion) {
    return {
      sourceOffset: lead.sourceOffset,
      sourceRegion: lead.sourceRegion,
      targetRegionId: lead.targetRegionId,
      pairStatus: 'source_region_missing',
      pointerDisposition: 'unresolved_requires_manual_trace',
    };
  }

  let decoded = null;
  let streamSummary = null;
  if (sourceRegion.type === 'dynamic_tile_loader') {
    const streams = collectDynamicStreamsCovering(mapData, sourceOffset);
    const stream = streams[0] || null;
    if (stream) {
      const start = parseHex(stream.streamRomOffset);
      const endInclusive = parseHex(stream.decoded.endInclusive);
      decoded = decodeLoader998Like(rom, start, endInclusive + 1, 'dynamic_tile_loader_a97', mapData);
      streamSummary = {
        streamRomOffset: stream.streamRomOffset,
        endInclusive: stream.decoded.endInclusive,
        referencedByCount: stream.referencedByCount || (stream.referencedBy || []).length || 0,
        remapRows: stream.remapRows || [],
      };
    }
  } else if (sourceRegion.type === 'vram_loader_998') {
    decoded = decodeLoader998Like(rom, regionStart(sourceRegion), regionEnd(sourceRegion), 'vram_loader_998', mapData);
  }

  const first = byteContext(decoded, sourceOffset);
  const second = byteContext(decoded, sourceOffset + 1);
  const status = pairStatus(first, second, secondRegion);
  const pointerDisposition = status === 'loader_source_word_operand_pair'
    ? 'loader_encoded_tile_source_word_not_z80_pointer'
    : status === 'not_covered_by_loader_decoder' || status === 'source_region_missing'
      ? 'unresolved_requires_manual_trace'
      : 'loader_control_or_boundary_bytes_not_rom_pointer';

  return {
    sourceOffset: lead.sourceOffset,
    sourceRegion: compactRegion(sourceRegion),
    trueTargetOffset: lead.trueTargetOffset,
    apparentTargetOffset: lead.apparentTargetOffset,
    targetRegionId: lead.targetRegionId,
    decoder: sourceRegion.type === 'dynamic_tile_loader' ? '_LABEL_A97_/_LABEL_9C3_' : '_LABEL_998_/_LABEL_9C3_',
    decoderStatus: decoded ? 'covered_by_loader_decoder' : 'not_covered_by_loader_decoder',
    decodedStream: streamSummary || (decoded ? { start: decoded.start, endExclusive: decoded.endExclusiveHex } : null),
    pairStatus: status,
    pointerDisposition,
    firstByteContext: first,
    secondByteContext: second || (secondRegion ? {
      entryIndex: null,
      entryOffset: hex(sourceOffset + 1),
      recordKind: 'next_region_byte',
      loaderType: secondRegion.type || 'unknown',
      byteRole: 'next_region_first_byte_or_payload',
      sourceRegion: compactRegion(secondRegion),
    } : null),
    evidence: [
      `Source byte pair starts at ${lead.sourceOffset} inside ${sourceRegion.id}.`,
      decoded
        ? 'The source range is covered by the confirmed loader parser for the source region or dynamic stream.'
        : 'No confirmed loader parser coverage was found for this exact source byte pair.',
      status === 'loader_source_word_operand_pair'
        ? 'The byte pair is an encoded tile source word used by _LABEL_9C3_, not a Z80 pointer into bank 7.'
        : 'The byte pair is loader control/boundary context and is not an encoded source-word pair or aligned ROM pointer.',
    ],
  };
}

function buildCatalog(mapData, rom) {
  const nonpaletteCatalog = requireCatalog(mapData, 'world-palette-tail-nonpalette-consumer-catalog-2026-06-26');
  requireCatalog(mapData, 'world-dynamic-tile-source-table-catalog-2026-06-25');
  requireCatalog(mapData, 'world-tile-source-catalog-2026-06-24');
  const leads = nonpaletteCatalog.wordShapeSamples?.sameBankStreamWordShapes || [];
  const classifications = leads.map(lead => classifyLead(mapData, rom, lead));
  const pointerDispositionCounts = countBy(classifications, item => item.pointerDisposition);
  const pairStatusCounts = countBy(classifications, item => item.pairStatus);
  const notPointerCount = classifications
    .filter(item => item.pointerDisposition === 'loader_control_or_boundary_bytes_not_rom_pointer' || item.pointerDisposition === 'loader_encoded_tile_source_word_not_z80_pointer')
    .length;
  const unresolvedCount = classifications.filter(item => item.pointerDisposition === 'unresolved_requires_manual_trace').length;
  const encodedSourceWordCount = classifications.filter(item => item.pairStatus === 'loader_source_word_operand_pair').length;

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: offsets, region ids, loader record classes, operand roles, source ranges, counts, and classifications. No ROM bytes, decoded graphics, rendered pixels, palette values, audio, hashes, instruction bytes, or register traces are embedded.',
    summary: {
      sourceLeadCount: leads.length,
      notPointerCount,
      unresolvedCount,
      encodedSourceWordCount,
      pairStatusCounts,
      pointerDispositionCounts,
      status: unresolvedCount
        ? 'loader_word_shapes_partially_unresolved'
        : 'loader_word_shapes_excluded_as_control_or_source_encoding',
      persistedRomByteCount: 0,
      persistedTileByteCount: 0,
      persistedPaletteByteCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    classifications,
    evidence: [
      'The source leads come from world-palette-tail-nonpalette-consumer-catalog-2026-06-26 after screen_prog byte-pair leads were separated.',
      '_LABEL_998_ and _LABEL_A97_ share _LABEL_9C3_ loader record semantics: source operands encode bank plus 32-byte tile block, not a Z80 pointer.',
      'A loader byte pair is not treated as a bank-7 ROM pointer unless a consumer outside the loader format forms that address explicitly.',
    ],
    nextLeads: [
      'After excluding screen_prog and loader word-shapes, r2817 has no static same-bank aligned pointer consumer; keep it quarantined until runtime trace proves otherwise.',
      'Move residual proof to r2813/_RAM_CF64_ and r0749/_DATA_1E337_, which still require runtime or direct consumer proof.',
      'Use the loader byte-context classifier in future graphics source-word audits to reduce false positives in loader control bytes.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const annotated = [];
  const byTarget = new Map();
  for (const item of catalog.classifications) {
    const list = byTarget.get(item.targetRegionId) || [];
    list.push(item);
    byTarget.set(item.targetRegionId, list);
  }
  for (const [targetRegionId, items] of byTarget.entries()) {
    const region = findRegion(mapData, targetRegionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.paletteTailLoaderWordShapeAudit = {
      catalogId,
      kind: 'palette_tail_loader_word_shape_context',
      status: catalog.summary.status,
      confidence: catalog.summary.unresolvedCount ? 'medium' : 'high_for_loader_exclusion_low_for_semantic_role',
      sourceLeadCount: items.length,
      notPointerCount: items.filter(item => item.pointerDisposition !== 'unresolved_requires_manual_trace').length,
      unresolvedCount: items.filter(item => item.pointerDisposition === 'unresolved_requires_manual_trace').length,
      encodedSourceWordCount: items.filter(item => item.pairStatus === 'loader_source_word_operand_pair').length,
      pairStatusCounts: countBy(items, item => item.pairStatus),
      summary: 'Loader-stream word-shaped leads into this region were decoded as _LABEL_9C3_ control/boundary/source-encoding context, not bank-7 ROM pointers.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (region.analysis.paletteTailNonPaletteConsumerAudit) {
      region.analysis.paletteTailNonPaletteConsumerAudit.loaderWordShapeDecoderAudit = catalogId;
      region.analysis.paletteTailNonPaletteConsumerAudit.loaderWordShapeDecoderStatus = catalog.summary.status;
    }
    annotated.push({
      id: region.id,
      offset: region.offset,
      sourceLeadCount: items.length,
      notPointerCount: items.filter(item => item.pointerDisposition !== 'unresolved_requires_manual_trace').length,
      unresolvedCount: items.filter(item => item.pointerDisposition === 'unresolved_requires_manual_trace').length,
    });
  }

  for (const item of catalog.classifications) {
    const region = item.sourceRegion?.id ? findRegion(mapData, item.sourceRegion.id) : null;
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.paletteTailLoaderWordShapeSourceAudit = {
      catalogId,
      kind: 'loader_source_word_shape_context',
      confidence: 'high_for_loader_record_context',
      targetRegionId: item.targetRegionId,
      pairStatus: item.pairStatus,
      pointerDisposition: item.pointerDisposition,
      summary: 'A word-shaped byte pair in this loader region was classified by loader record context before being considered as a ROM pointer.',
      generatedAt: now,
      tool: toolName,
    };
  }
  return annotated;
}

function updateStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.paletteTailLoaderWordShapeCatalog = catalogId;
  staticMap.summary.paletteTailLoaderWordShapeStatus = catalog.summary.status;
  staticMap.summary.paletteTailLoaderWordShapeLeads = catalog.summary.sourceLeadCount;
  staticMap.summary.paletteTailLoaderWordShapeNotPointers = catalog.summary.notPointerCount;
  staticMap.summary.paletteTailLoaderWordShapeUnresolved = catalog.summary.unresolvedCount;
  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.rendering = insertAfter(
    staticMap.primaryCatalogs.rendering,
    'world-palette-tail-screenprog-wordshape-catalog-2026-06-26',
    catalogId
  );
  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.push('Use world-palette-tail-loader-wordshape-catalog-2026-06-26 to exclude r2817 loader-stream false positives before requiring runtime proof for any semantic promotion.');
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotated = apply ? applyCatalog(mapData, catalog) : [];

  if (apply) {
    mapData.tileSourceCatalogs = (mapData.tileSourceCatalogs || []).filter(item => item.id !== catalogId);
    mapData.tileSourceCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'palette_tail_loader_wordshape_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      catalogId,
      sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotated.length,
      },
      classifications: catalog.classifications,
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
    classifications: catalog.classifications,
  }, null, 2));
}

main();
