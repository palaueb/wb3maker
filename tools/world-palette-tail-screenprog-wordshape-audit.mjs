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
const toolName = 'tools/world-palette-tail-screenprog-wordshape-audit.mjs';
const catalogId = 'world-palette-tail-screenprog-wordshape-catalog-2026-06-26';
const reportId = 'palette-tail-screenprog-wordshape-audit-2026-06-26';
const sourceCatalogs = [
  'world-palette-tail-nonpalette-consumer-catalog-2026-06-26',
  'world-screen-prog-catalog-2026-06-24',
];

const maxOps = 4096;
const maxPcVisits = 64;

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

function bankForOffset(offset) {
  return Math.floor(offset / 0x4000);
}

function vdpCtrlWordToVram(vdp16) {
  return (vdp16 & 0xFF) | (((vdp16 >> 8) & 0x3F) << 8);
}

function screenProg604Z80ToRom(z80, bank8000) {
  if (z80 < 0x8000) return z80;
  if (z80 < 0xC000) return bank8000 * 0x4000 + (z80 - 0x8000);
  return -1;
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

function commandByteRole(command, offset) {
  if (!command || offset < command.offset || offset >= command.offset + command.length) return 'outside_command';
  const rel = offset - command.offset;
  if (command.kind === 'tile') return 'direct_tile_payload';
  if (rel === 0) return 'opcode';
  if (command.kind === 'attr') return 'attribute_operand';
  if (command.kind === 'addr') return rel === 1 ? 'vdp_address_low_operand' : 'vdp_address_high_operand';
  if (command.kind === 'jump') return rel === 1 ? 'jump_low_operand' : 'jump_high_operand';
  if (command.kind === 'literal') return 'literal_tile_operand';
  if (command.kind === 'fill') return rel === 1 ? 'fill_count_operand' : 'fill_tile_operand';
  return 'operand';
}

function decodeScreenProgCommands(rom, region) {
  const startOffset = regionStart(region);
  const endOffset = regionEnd(region);
  const bank8000 = bankForOffset(startOffset);
  const commands = [];
  const warnings = [];
  const pcVisits = new Map();
  let pc = startOffset;
  let storedVdpAddr = 0x7800;
  let vramAddr = 0x3800;
  let ops = 0;
  let terminated = false;
  let endReason = 'Reached max ops';

  function readByte() {
    if (pc >= rom.length) return null;
    return rom[pc++];
  }

  function push(command) {
    commands.push({
      offset: command.offset,
      offsetHex: hex(command.offset),
      length: command.length,
      kind: command.kind,
      operandRoles: command.operandRoles || [],
      vramAddr: command.vramAddr == null ? null : hex(command.vramAddr, 4),
      jumpTarget: command.jumpTarget == null ? null : hex(command.jumpTarget),
      jumpZ80: command.jumpZ80 == null ? null : hex(command.jumpZ80, 4),
    });
  }

  while (pc < rom.length && ops < maxOps) {
    const visitCount = (pcVisits.get(pc) || 0) + 1;
    pcVisits.set(pc, visitCount);
    if (visitCount > maxPcVisits) {
      endReason = `loop guard at ${hex(pc)}`;
      warnings.push(endReason);
      break;
    }

    const start = pc;
    const opcode = readByte();
    if (opcode == null) {
      endReason = 'Unexpected EOF';
      warnings.push(endReason);
      break;
    }
    ops++;

    if (opcode < 0xF0) {
      push({
        offset: start,
        length: 1,
        kind: 'tile',
        operandRoles: ['direct_tile_payload'],
        vramAddr,
      });
      vramAddr += 2;
      continue;
    }

    switch (opcode & 0x07) {
      case 0:
        terminated = true;
        endReason = `${hex(opcode, 2)} end @ ${hex(start)}`;
        push({ offset: start, length: 1, kind: 'end' });
        pc = rom.length;
        break;
      case 1: {
        const attr = readByte();
        if (attr == null) {
          endReason = `${hex(opcode, 2)} attr truncated @ ${hex(start)}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        push({
          offset: start,
          length: 2,
          kind: 'attr',
          operandRoles: ['attribute_operand'],
        });
        break;
      }
      case 2: {
        const lo = readByte();
        const hi = readByte();
        if (lo == null || hi == null) {
          endReason = `${hex(opcode, 2)} addr truncated @ ${hex(start)}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        storedVdpAddr = lo | (hi << 8);
        vramAddr = vdpCtrlWordToVram(storedVdpAddr);
        push({
          offset: start,
          length: 3,
          kind: 'addr',
          operandRoles: ['vdp_address_low_operand', 'vdp_address_high_operand'],
          vramAddr,
        });
        break;
      }
      case 3: {
        const tile = readByte();
        if (tile == null) {
          endReason = `${hex(opcode, 2)} literal truncated @ ${hex(start)}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        push({
          offset: start,
          length: 2,
          kind: 'literal',
          operandRoles: ['literal_tile_operand'],
          vramAddr,
        });
        vramAddr += 2;
        break;
      }
      case 4: {
        const lo = readByte();
        const hi = readByte();
        if (lo == null || hi == null) {
          endReason = `${hex(opcode, 2)} jump truncated @ ${hex(start)}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        const z80 = lo | (hi << 8);
        const target = screenProg604Z80ToRom(z80, bank8000);
        push({
          offset: start,
          length: 3,
          kind: 'jump',
          operandRoles: ['jump_low_operand', 'jump_high_operand'],
          jumpTarget: target < 0 ? null : target,
          jumpZ80: z80,
        });
        if (target < 0 || target >= rom.length) {
          endReason = `${hex(opcode, 2)} jump out of range @ ${hex(start)}`;
          warnings.push(endReason);
          pc = rom.length;
        } else {
          pc = target;
        }
        break;
      }
      case 5: {
        const count = readByte();
        const tile = readByte();
        if (count == null || tile == null) {
          endReason = `${hex(opcode, 2)} fill truncated @ ${hex(start)}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        push({
          offset: start,
          length: 3,
          kind: 'fill',
          operandRoles: ['fill_count_operand', 'fill_tile_operand'],
          vramAddr,
        });
        vramAddr += count * 2;
        break;
      }
      case 6:
        storedVdpAddr = (storedVdpAddr + 0x0040) & 0xFFFF;
        if ((storedVdpAddr >> 8) >= 0x7F) storedVdpAddr = (storedVdpAddr & 0x00FF) | 0x7800;
        vramAddr = vdpCtrlWordToVram(storedVdpAddr);
        push({
          offset: start,
          length: 1,
          kind: 'row_prefill',
          vramAddr,
        });
        break;
      case 7:
        push({ offset: start, length: 1, kind: 'noop7' });
        break;
    }
  }

  if (ops >= maxOps && !terminated) warnings.push(endReason);
  const byOffset = new Map();
  for (const command of commands) {
    for (let offset = command.offset; offset < command.offset + command.length; offset++) {
      byOffset.set(offset, command);
    }
  }
  return {
    region: compactRegion(region),
    bank8000,
    commandCount: commands.length,
    terminated,
    endReason,
    warnings,
    commands,
    byOffset,
    visitedStart: commands.length ? commands[0].offset : null,
    visitedEndExclusive: commands.length ? Math.max(...commands.map(command => command.offset + command.length)) : null,
    regionEnd: endOffset,
  };
}

function pairStatusFor(first, second, sourceOffset) {
  if (!first || !second) return 'not_visited_by_screen_prog_decoder';
  if (first === second) {
    if (first.kind === 'addr' && sourceOffset === first.offset + 1) return 'screen_prog_f2_vdp_address_operand_pair';
    if (first.kind === 'jump' && sourceOffset === first.offset + 1) return 'screen_prog_f4_jump_operand_pair';
    if (first.kind === 'fill' && sourceOffset === first.offset + 1) return 'screen_prog_f5_count_tile_operand_pair';
    return `screen_prog_${first.kind}_same_command_byte_pair`;
  }
  if (first.kind === 'tile' && second.kind === 'tile') return 'adjacent_screen_prog_direct_tile_payload_pair';
  return 'screen_prog_cross_command_byte_pair';
}

function commandRef(command, offset) {
  if (!command) return null;
  return {
    commandOffset: command.offsetHex,
    commandKind: command.kind,
    commandLength: command.length,
    byteRole: commandByteRole(command, offset),
  };
}

function classifyLead(lead, decodedByRegionId) {
  const sourceOffset = parseHex(lead.sourceOffset);
  const decoded = decodedByRegionId.get(lead.sourceRegion?.id);
  if (sourceOffset == null || !decoded) {
    return {
      ...lead,
      decoderStatus: 'source_region_not_decoded',
      pairStatus: 'not_visited_by_screen_prog_decoder',
      pointerDisposition: 'unresolved_requires_manual_trace',
    };
  }
  const first = decoded.byOffset.get(sourceOffset);
  const second = decoded.byOffset.get(sourceOffset + 1);
  const pairStatus = pairStatusFor(first, second, sourceOffset);
  const pointerDisposition = pairStatus === 'screen_prog_f4_jump_operand_pair'
    ? 'screen_prog_jump_operand_requires_target_check'
    : pairStatus === 'not_visited_by_screen_prog_decoder'
      ? 'unresolved_requires_manual_trace'
      : 'screen_prog_bytecode_or_payload_not_rom_pointer';
  return {
    sourceOffset: lead.sourceOffset,
    sourceRegion: lead.sourceRegion,
    trueTargetOffset: lead.trueTargetOffset,
    apparentTargetOffset: lead.apparentTargetOffset,
    targetRegionId: lead.targetRegionId,
    decoder: '_LABEL_604_',
    decoderStatus: first || second ? 'visited_by_screen_prog_decoder' : 'not_visited_by_screen_prog_decoder',
    pairStatus,
    pointerDisposition,
    firstByteContext: commandRef(first, sourceOffset),
    secondByteContext: commandRef(second, sourceOffset + 1),
    evidence: [
      `Source byte pair starts at ${lead.sourceOffset} inside ${lead.sourceRegion?.id || 'unknown source region'}.`,
      first || second
        ? 'The byte pair is covered by the _LABEL_604_ screen_prog command stream for the source region.'
        : 'The byte pair is inside a screen_prog-typed region but was not reached by the current _LABEL_604_ decode path.',
      pairStatus === 'screen_prog_f4_jump_operand_pair'
        ? 'F4 is the only _LABEL_604_ command class in this audit that uses a banked ROM control-flow target.'
        : 'The decoded command context is screen name-table bytecode/payload, not an aligned ROM asset pointer table entry.',
    ],
  };
}

function buildCatalog(mapData, rom) {
  const nonpaletteCatalog = requireCatalog(mapData, 'world-palette-tail-nonpalette-consumer-catalog-2026-06-26');
  requireCatalog(mapData, 'world-screen-prog-catalog-2026-06-24');
  const leads = nonpaletteCatalog.wordShapeSamples?.sameBankScreenProgWordShapes || [];
  const sourceRegionIds = [...new Set(leads.map(lead => lead.sourceRegion?.id).filter(Boolean))];
  const decodedByRegionId = new Map();
  const decodedSummaries = [];
  for (const id of sourceRegionIds) {
    const region = findRegion(mapData, id);
    if (!region) continue;
    const decoded = decodeScreenProgCommands(rom, region);
    decodedByRegionId.set(id, decoded);
    decodedSummaries.push({
      region: decoded.region,
      decoder: '_LABEL_604_',
      commandCount: decoded.commandCount,
      terminated: decoded.terminated,
      endReason: decoded.endReason,
      warningCount: decoded.warnings.length,
      visitedRange: decoded.visitedStart == null ? null : {
        start: hex(decoded.visitedStart),
        endExclusive: hex(decoded.visitedEndExclusive),
      },
    });
  }
  const classifications = leads.map(lead => classifyLead(lead, decodedByRegionId));
  const pointerDispositionCounts = countBy(classifications, item => item.pointerDisposition);
  const pairStatusCounts = countBy(classifications, item => item.pairStatus);
  const confirmedPointerCount = classifications
    .filter(item => item.pointerDisposition === 'screen_prog_jump_operand_requires_target_check')
    .length;
  const notPointerCount = classifications
    .filter(item => item.pointerDisposition === 'screen_prog_bytecode_or_payload_not_rom_pointer')
    .length;
  const unresolvedCount = classifications
    .filter(item => item.pointerDisposition === 'unresolved_requires_manual_trace')
    .length;

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: offsets, region ids, command classes, operand roles, counts, and classifications. No ROM bytes, tile ids, decoded graphics, rendered pixels, palette values, audio, hashes, instruction bytes, or register traces are embedded.',
    summary: {
      sourceLeadCount: leads.length,
      sourceRegionCount: sourceRegionIds.length,
      decodedSourceRegionCount: decodedSummaries.length,
      notPointerCount,
      confirmedPointerCount,
      unresolvedCount,
      pairStatusCounts,
      pointerDispositionCounts,
      status: unresolvedCount
        ? 'screen_prog_word_shapes_partially_unresolved'
        : confirmedPointerCount
          ? 'screen_prog_word_shapes_include_jump_operands'
          : 'screen_prog_word_shapes_excluded_as_bytecode_payload',
      persistedRomByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    decodedSourceRegions: decodedSummaries,
    classifications,
    evidence: [
      'The source leads come from world-palette-tail-nonpalette-consumer-catalog-2026-06-26 after aligned pointer-table candidates were separated from screen_prog byte pairs.',
      'Each source region is decoded with the _LABEL_604_ screen/name-table bytecode model already used by world-screen-prog-catalog-2026-06-24.',
      'A screen_prog byte pair is not treated as a ROM asset pointer unless it is specifically the operand pair of an F4 jump command.',
    ],
    nextLeads: [
      'Use the same command-context classifier for the dynamic_tile_loader and vram_loader_998 word-shape leads in r2817.',
      'Keep r2817 low-confidence until a non-screen_prog consumer is found or the loader stream classifier proves a real source pointer into the range.',
      'Consider adding command-context badges to the analyzer map for screen_prog word-shape false positives.',
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
    region.analysis.paletteTailScreenProgWordShapeAudit = {
      catalogId,
      kind: 'palette_tail_screen_prog_word_shape_context',
      status: catalog.summary.status,
      confidence: catalog.summary.unresolvedCount ? 'medium' : 'high_for_screen_prog_exclusion_low_for_semantic_role',
      sourceLeadCount: items.length,
      notPointerCount: items.filter(item => item.pointerDisposition === 'screen_prog_bytecode_or_payload_not_rom_pointer').length,
      confirmedPointerCount: items.filter(item => item.pointerDisposition === 'screen_prog_jump_operand_requires_target_check').length,
      unresolvedCount: items.filter(item => item.pointerDisposition === 'unresolved_requires_manual_trace').length,
      pairStatusCounts: countBy(items, item => item.pairStatus),
      summary: 'Screen_prog word-shaped leads into this region were decoded as _LABEL_604_ command/payload context, not aligned ROM asset pointer table entries.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (region.analysis.paletteTailNonPaletteConsumerAudit) {
      region.analysis.paletteTailNonPaletteConsumerAudit.screenProgWordShapeDecoderAudit = catalogId;
      region.analysis.paletteTailNonPaletteConsumerAudit.screenProgWordShapeDecoderStatus = catalog.summary.status;
    }
    annotated.push({
      id: region.id,
      offset: region.offset,
      sourceLeadCount: items.length,
      notPointerCount: items.filter(item => item.pointerDisposition === 'screen_prog_bytecode_or_payload_not_rom_pointer').length,
      unresolvedCount: items.filter(item => item.pointerDisposition === 'unresolved_requires_manual_trace').length,
    });
  }

  const bySource = new Map();
  for (const item of catalog.classifications) {
    const id = item.sourceRegion?.id;
    if (!id) continue;
    const list = bySource.get(id) || [];
    list.push(item);
    bySource.set(id, list);
  }
  for (const [sourceRegionId, items] of bySource.entries()) {
    const region = findRegion(mapData, sourceRegionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.paletteTailScreenProgSourceAudit = {
      catalogId,
      kind: 'screen_prog_source_word_shape_context',
      status: countBy(items, item => item.pointerDisposition),
      confidence: 'high_for_command_context',
      leadCount: items.length,
      targetRegionIds: [...new Set(items.map(item => item.targetRegionId).filter(Boolean))],
      summary: 'Word-shaped byte pairs inside this screen_prog were classified by _LABEL_604_ command context before being considered as asset pointers.',
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
  staticMap.summary.paletteTailScreenProgWordShapeCatalog = catalogId;
  staticMap.summary.paletteTailScreenProgWordShapeStatus = catalog.summary.status;
  staticMap.summary.paletteTailScreenProgWordShapeLeads = catalog.summary.sourceLeadCount;
  staticMap.summary.paletteTailScreenProgWordShapeNotPointers = catalog.summary.notPointerCount;
  staticMap.summary.paletteTailScreenProgWordShapeUnresolved = catalog.summary.unresolvedCount;
  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.rendering = insertAfter(
    staticMap.primaryCatalogs.rendering,
    'world-palette-tail-nonpalette-consumer-catalog-2026-06-26',
    catalogId
  );
  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.push('Use world-palette-tail-screenprog-wordshape-catalog-2026-06-26 to exclude r2817 screen_prog byte-pair false positives before tracing loader-stream leads.');
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotated = apply ? applyCatalog(mapData, catalog) : [];

  if (apply) {
    mapData.screenProgCatalogs = (mapData.screenProgCatalogs || []).filter(item => item.id !== catalogId);
    mapData.screenProgCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'palette_tail_screenprog_wordshape_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      catalogId,
      sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotated.length,
      },
      decodedSourceRegions: catalog.decodedSourceRegions,
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
    decodedSourceRegions: catalog.decodedSourceRegions,
    classifications: catalog.classifications,
  }, null, 2));
}

main();
