#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_OPCODE_METADATA_BY_OPCODE,
  audioOpcodeKey,
} from './world-audio-opcode-metadata.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-audio-header-false-dw-catalog-2026-06-25';
const reportId = 'audio-header-false-dw-audit-2026-06-25';
const audioCatalogId = 'world-audio-catalog-2026-06-24';
const supersededCatalogId = 'world-audio-orphan-stream-fragment-catalog-2026-06-25';
const supersededReportId = 'audio-orphan-stream-fragment-audit-2026-06-25';
const toolName = 'tools/world-audio-header-false-dw-audit.mjs';

const bank3Start = 0x0C000;
const bank3EndExclusive = 0x10000;
const bank3Z80Base = 0x8000;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function z80ToBank3Rom(z80Address) {
  if (z80Address < bank3Z80Base || z80Address >= 0xC000) return null;
  return bank3Start + (z80Address - bank3Z80Base);
}

function offsetOf(region) {
  return parseHex(region.offset);
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return start != null && offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
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

function incCounter(obj, key) {
  obj[key] = (obj[key] || 0) + 1;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function compactRegionName(region, fallbackOffset) {
  return region?.name || region?.notes || `Data @ ${fallbackOffset}`;
}

function hasStrongTargetEvidence(region) {
  const kind = region?.analysis?.audioRegionCoverageAudit?.kind || '';
  const detail = region?.analysis?.audioRegionCoverageAudit?.detail || {};
  return [
    'graph_reachable_stream_region',
    'request_header_region',
    'parsed_stream_not_reached_by_request_graph',
    'parsed_header_not_reached_by_request_graph',
    'crossbank_audio_fragment',
  ].includes(kind)
  || (detail.streamGraphRefs || 0) > 0
  || (detail.headerGraphRefs || 0) > 0
  || (detail.parsedStreamCount || 0) > 0
  || (detail.parsedHeaderCount || 0) > 0
  || Boolean(
    region?.analysis?.audioStreamGraphUsageAudit
    || region?.analysis?.audioStreamGraphAudit
    || region?.analysis?.audioRequestTaxonomyAudit
    || region?.analysis?.audioCrossbankFragmentAudit
  );
}

function parseStreamLikeFragment(rom, startOffset, mapData) {
  const opcodeCounts = {};
  const opcodeRoles = {};
  const branchTargets = [];
  const warnings = [];
  let pc = startOffset;
  let noteBytes = 0;
  let restOrSpecialBytes = 0;
  let highFlagNoteBytes = 0;
  let endReason = 'limit';

  for (let step = 0; step < 1024 && pc < rom.length; step++) {
    const opOffset = pc;
    const b = rom[pc++];
    if (b === 0xFF) {
      incCounter(opcodeCounts, '$FF');
      endReason = 'ff-end';
      break;
    }
    if (b >= 0xF0) {
      const opKey = audioOpcodeKey(b);
      const opcodeMeta = AUDIO_OPCODE_METADATA_BY_OPCODE.get(b) || null;
      incCounter(opcodeCounts, opKey);
      if (opcodeMeta?.role) opcodeRoles[opKey] = opcodeMeta.role;
      const argc = opcodeMeta?.argBytes ?? 0;
      if (pc + argc > rom.length) {
        warnings.push(`opcode ${opKey} at ${hex(opOffset)} is truncated`);
        endReason = 'truncated';
        break;
      }
      if (opcodeMeta?.pointerArg && argc >= 2) {
        const z80Target = rom[pc] | (rom[pc + 1] << 8);
        const romTarget = z80ToBank3Rom(z80Target);
        branchTargets.push({
          opcode: opKey,
          opcodeOffset: hex(opOffset),
          z80Target: hex(z80Target, 4),
          romTarget: romTarget == null ? null : hex(romTarget),
          targetRegion: romTarget == null ? null : regionRef(findContainingRegion(mapData, romTarget)),
        });
      }
      pc += argc;
      if (opcodeMeta?.parserAction === 'stop_segment') {
        endReason = 'loop-or-repeat-end';
        break;
      }
      if (opcodeMeta?.parserAction === 'branch_and_stop_segment') {
        endReason = `${opKey}-branch`;
        break;
      }
      continue;
    }

    if (b >= 0x80) highFlagNoteBytes++;
    const encoded = b >= 0x80 ? (b & 0x3F) : b;
    if ((encoded & 0x0F) >= 0x0C) restOrSpecialBytes++;
    else noteBytes++;
  }

  return {
    id: 'stream_like_fragment_' + startOffset.toString(16).toUpperCase(),
    startOffset: hex(startOffset),
    endOffset: hex(Math.max(startOffset, pc - 1)),
    consumedBytes: pc - startOffset,
    region: regionRef(findContainingRegion(mapData, startOffset)),
    parser: {
      confidence: warnings.length ? 'low' : 'medium',
      note: 'Shape-only parser result for an apparent target of a rejected header-field word. This does not prove the fragment is reached by the audio driver.',
    },
    noteBytes,
    highFlagNoteBytes,
    restOrSpecialBytes,
    opcodeCounts,
    opcodeRoles,
    branchTargetCount: branchTargets.length,
    endReason,
    warnings,
  };
}

function shouldIncludeFalseDwRegion(region) {
  if (!region) return false;
  const text = `${region.name || ''} ${region.notes || ''}`.toLowerCase();
  return text.includes('pointer table') || Boolean(region.analysis?.audioHeaderFalseDwAudit);
}

function buildFalseDwEntries(rom, mapData, audioCatalog) {
  const entries = [];
  for (const song of audioCatalog.songs || []) {
    for (const channel of song.header?.channels || []) {
      const headerOffset = parseHex(channel.headerOffset);
      const actualStreamOffset = parseHex(channel.streamRomOffset);
      if (headerOffset == null || actualStreamOffset == null) continue;
      const falseDwOffset = headerOffset + 1;
      const falseDwRegion = findExactRegion(mapData, falseDwOffset);
      if (!shouldIncludeFalseDwRegion(falseDwRegion)) continue;

      const channelId = rom[headerOffset];
      const priority = rom[headerOffset + 1];
      const actualStreamZ80 = rom[headerOffset + 2] | (rom[headerOffset + 3] << 8);
      const actualStreamRomTarget = z80ToBank3Rom(actualStreamZ80);
      const falseWordZ80 = rom[falseDwOffset] | (rom[falseDwOffset + 1] << 8);
      const falseWordRomTarget = z80ToBank3Rom(falseWordZ80);
      const falseTargetRegion = falseWordRomTarget == null ? null : findContainingRegion(mapData, falseWordRomTarget);
      const actualStreamRegion = findContainingRegion(mapData, actualStreamOffset);
      const targetHasStrongEvidence = hasStrongTargetEvidence(falseTargetRegion);
      const shouldParseTargetShape = Boolean(
        falseWordRomTarget != null
        && falseWordRomTarget !== actualStreamOffset
        && falseTargetRegion
        && (falseTargetRegion.type || 'unknown') === 'music'
        && !targetHasStrongEvidence
      );
      const streamLike = shouldParseTargetShape
        ? parseStreamLikeFragment(rom, falseWordRomTarget, mapData)
        : null;

      entries.push({
        requestId: song.index,
        requestIdHex: hex(song.index, 2),
        channelIndex: channel.index,
        headerRecordOffset: hex(headerOffset),
        falseDwOffset: hex(falseDwOffset),
        falseDwLabel: compactRegionName(falseDwRegion, hex(falseDwOffset)),
        falseDwRegion: regionRef(falseDwRegion),
        falseDwRegionSize: falseDwRegion?.size || 0,
        falseTargetOffset: falseWordRomTarget == null ? null : hex(falseWordRomTarget),
        falseTargetLabel: falseTargetRegion ? compactRegionName(falseTargetRegion, hex(falseWordRomTarget)) : null,
        falseTargetRegion: regionRef(falseTargetRegion),
        actualStreamOffset: hex(actualStreamOffset),
        actualStreamRegion: regionRef(actualStreamRegion),
        channelId,
        channelIdHex: hex(channelId, 2),
        priority,
        priorityHex: hex(priority, 2),
        falseWordZ80: hex(falseWordZ80, 4),
        falseWordRomTarget: falseWordRomTarget == null ? null : hex(falseWordRomTarget),
        actualStreamZ80: hex(actualStreamZ80, 4),
        actualStreamRomTarget: actualStreamRomTarget == null ? null : hex(actualStreamRomTarget),
        targetHasStrongEvidence,
        streamLike,
        confidence: actualStreamRomTarget === actualStreamOffset ? 'high' : 'medium',
        evidence: [
          'ASM lines 21599-21648 show _LABEL_C04D_ treats header byte 0 as channel id, byte 1 as priority, and bytes 2-3 as the stream pointer copied into stream fields +5/+6.',
          'ASM lines 21684-21713 show _LABEL_C09F_ uses the same header walk for queued requests, skipping byte 1 and copying bytes 2-3 as the stream pointer.',
          `${audioCatalogId} parsed this request header record from _DATA_D139_ request ${hex(song.index, 2)}.`,
          `The mapped split at ${hex(falseDwOffset)} starts on header byte 1, so the word ${hex(falseWordZ80, 4)} combines priority ${hex(priority, 2)} with the real stream pointer low byte.`,
          `The accepted stream pointer for this record is bytes 2-3 at ${hex(headerOffset + 2)} -> ${hex(actualStreamOffset)}.`,
        ],
      });
    }
  }
  return entries;
}

function buildCatalog(rom, mapData) {
  const audioCatalog = requireCatalog(mapData, audioCatalogId);
  const entries = buildFalseDwEntries(rom, mapData, audioCatalog);
  const targetEntries = entries.filter(entry => entry.falseTargetRegion && entry.falseTargetOffset !== entry.actualStreamOffset);
  return {
    id: catalogId,
    schemaVersion: 2,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [audioCatalogId],
    supersedesCatalogs: [supersededCatalogId],
    summary: {
      falseDwRecordCount: entries.length,
      validatedFalseDwRecordCount: entries.filter(entry => entry.confidence === 'high').length,
      falseDwRegionCount: new Set(entries.map(entry => entry.falseDwRegion?.id).filter(Boolean)).size,
      rejectedTargetCount: targetEntries.length,
      rejectedTargetRegionCount: new Set(targetEntries.map(entry => entry.falseTargetRegion?.id).filter(Boolean)).size,
      targetRegionsWithStrongEvidence: targetEntries.filter(entry => entry.targetHasStrongEvidence).length,
      targetRegionsWithShapeParse: targetEntries.filter(entry => entry.streamLike).length,
      targetShapeParseWarnings: targetEntries.reduce((total, entry) => total + (entry.streamLike?.warnings.length || 0), 0),
      falseDwWordTargetClasses: countBy(entries, entry => entry.falseWordRomTarget ? 'bank3_rom_target' : 'non_bank3_or_ram_value'),
      assetPolicy: 'Metadata only: request ids, offsets, labels, pointer interpretations, parser counts, and evidence. No ROM bytes, decoded music, audio samples, or generated audio are embedded.',
    },
    entries,
    evidence: [
      'The audio request loaders prove the four-byte header-record layout from code, independent of disassembler .dw guesses.',
      'Every entry in this catalog starts at byte 1 of a parsed audio header record, where the driver reads priority, not a pointer.',
      'The real stream pointer for each affected record starts one byte later at header bytes 2-3.',
    ],
    nextLeads: [
      'Split or rename generated header-byte-1 pointer-table regions so the map can display them as audio header priority/pointer-field fragments.',
      'Find independent code or stream branch references before promoting rejected target fragments beyond their existing evidence.',
      'Teach audio graph diagnostics to report rejected disassembler labels alongside the accepted header stream pointer.',
    ],
  };
}

function removeGeneratedClaims(mapData) {
  for (const region of mapData.regions || []) {
    if (region.analysis?.audioOrphanStreamPointerAudit?.catalogId === supersededCatalogId) {
      delete region.analysis.audioOrphanStreamPointerAudit;
    }
    if (region.analysis?.audioOrphanStreamFragmentAudit?.catalogId === supersededCatalogId) {
      delete region.analysis.audioOrphanStreamFragmentAudit;
    }
    if (region.analysis?.audioHeaderFalseDwAudit?.catalogId === catalogId) {
      delete region.analysis.audioHeaderFalseDwAudit;
    }
    if (region.analysis?.audioHeaderFalseDwTargetAudit?.catalogId === catalogId) {
      delete region.analysis.audioHeaderFalseDwTargetAudit;
    }
  }
  mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== supersededCatalogId);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== supersededReportId);
}

function compactFalseDwRef(entry) {
  return {
    requestId: entry.requestId,
    requestIdHex: entry.requestIdHex,
    channelIndex: entry.channelIndex,
    headerRecordOffset: entry.headerRecordOffset,
    falseDwOffset: entry.falseDwOffset,
    falseWordZ80: entry.falseWordZ80,
    falseWordRomTarget: entry.falseWordRomTarget,
    actualStreamZ80: entry.actualStreamZ80,
    actualStreamOffset: entry.actualStreamOffset,
    priorityHex: entry.priorityHex,
    confidence: entry.confidence,
  };
}

function compactTargetRef(entry) {
  return {
    requestId: entry.requestId,
    requestIdHex: entry.requestIdHex,
    channelIndex: entry.channelIndex,
    rejectedPointerOffset: entry.falseDwOffset,
    rejectedPointerRegion: entry.falseDwRegion,
    falseWordZ80: entry.falseWordZ80,
    actualStreamOffset: entry.actualStreamOffset,
    actualStreamRegion: entry.actualStreamRegion,
    targetHasStrongEvidence: entry.targetHasStrongEvidence,
    confidence: entry.confidence,
  };
}

function annotateMap(mapData, catalog) {
  const falseDwByRegion = new Map();
  const targetByRegion = new Map();
  const missing = [];

  for (const entry of catalog.entries) {
    const falseDwRegion = entry.falseDwRegion?.id
      ? (mapData.regions || []).find(region => region.id === entry.falseDwRegion.id)
      : null;
    if (!falseDwRegion) {
      missing.push({ role: 'false_header_dw_region', offset: entry.falseDwOffset, label: entry.falseDwLabel });
    } else {
      if (!falseDwByRegion.has(falseDwRegion.id)) falseDwByRegion.set(falseDwRegion.id, { region: falseDwRegion, entries: [] });
      falseDwByRegion.get(falseDwRegion.id).entries.push(entry);
    }

    if (entry.falseTargetRegion?.id && entry.falseTargetOffset !== entry.actualStreamOffset) {
      const targetRegion = (mapData.regions || []).find(region => region.id === entry.falseTargetRegion.id);
      if (!targetRegion) {
        missing.push({ role: 'false_header_dw_target_region', offset: entry.falseTargetOffset, label: entry.falseTargetLabel });
      } else {
        if (!targetByRegion.has(targetRegion.id)) targetByRegion.set(targetRegion.id, { region: targetRegion, entries: [] });
        targetByRegion.get(targetRegion.id).entries.push(entry);
      }
    }
  }

  const falseDwRegions = [];
  for (const { region, entries } of falseDwByRegion.values()) {
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.audioHeaderFalseDwAudit = {
        catalogId,
        kind: 'false_dw_label_inside_audio_header_record',
        confidence: entries.every(entry => entry.confidence === 'high') ? 'high' : 'medium',
        summary: 'Mapped .dw/pointer-table split starts at audio header byte 1, which the driver uses as priority; the real stream pointer starts at byte 2.',
        falseDwRecords: entries.map(compactFalseDwRef),
        supersedes: ['audioOrphanStreamPointerAudit'],
        evidence: [
          ...catalog.evidence,
          ...entries.flatMap(entry => entry.evidence.slice(2, 5)).slice(0, 12),
        ],
        generatedAt: now,
        tool: toolName,
      };
    }
    falseDwRegions.push({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      falseDwRecordCount: entries.length,
      requestIds: entries.map(entry => entry.requestId),
      confidence: entries.every(entry => entry.confidence === 'high') ? 'high' : 'medium',
    });
  }

  const targetRegions = [];
  for (const { region, entries } of targetByRegion.values()) {
    if (apply) {
      region.analysis = region.analysis || {};
      const shapeParses = entries
        .filter(entry => entry.streamLike)
        .map(entry => ({
          rejectedPointerOffset: entry.falseDwOffset,
          id: entry.streamLike.id,
          consumedBytes: entry.streamLike.consumedBytes,
          endOffset: entry.streamLike.endOffset,
          endReason: entry.streamLike.endReason,
          noteBytes: entry.streamLike.noteBytes,
          highFlagNoteBytes: entry.streamLike.highFlagNoteBytes,
          restOrSpecialBytes: entry.streamLike.restOrSpecialBytes,
          opcodeCounts: entry.streamLike.opcodeCounts,
          opcodeRoles: entry.streamLike.opcodeRoles,
          branchTargetCount: entry.streamLike.branchTargetCount,
          warningCount: entry.streamLike.warnings.length,
          parserConfidence: entry.streamLike.parser.confidence,
        }));
      region.analysis.audioHeaderFalseDwTargetAudit = {
        catalogId,
        kind: 'target_of_rejected_audio_header_false_dw',
        confidence: entries.every(entry => entry.confidence === 'high') ? 'high' : 'medium',
        summary: 'One or more apparent pointer references to this region are rejected because they come from priority+stream-low bytes inside audio header records.',
        rejectedPointers: entries.map(compactTargetRef),
        shapeParses,
        supersedes: ['audioOrphanStreamFragmentAudit'],
        evidence: [
          ...catalog.evidence,
          ...entries.flatMap(entry => entry.evidence.slice(2, 5)).slice(0, 12),
        ],
        generatedAt: now,
        tool: toolName,
      };
    }
    targetRegions.push({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      rejectedPointerCount: entries.length,
      hasStrongTargetEvidence: entries.some(entry => entry.targetHasStrongEvidence),
      shapeParseCount: entries.filter(entry => entry.streamLike).length,
      confidence: entries.every(entry => entry.confidence === 'high') ? 'high' : 'medium',
    });
  }

  return { falseDwRegions, targetRegions, missing };
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(rom, mapData);

  if (apply) removeGeneratedClaims(mapData);
  const annotations = annotateMap(mapData, catalog);

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_header_false_dw_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 2,
      summary: {
        ...catalog.summary,
        annotatedFalseDwRegions: annotations.falseDwRegions.length,
        annotatedTargetRegions: annotations.targetRegions.length,
        missingRegions: annotations.missing.length,
        supersededCatalogsRemoved: [supersededCatalogId],
      },
      falseDwRegions: annotations.falseDwRegions,
      targetRegions: annotations.targetRegions,
      missingRegions: annotations.missing,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    falseDwRegions: annotations.falseDwRegions,
    targetRegions: annotations.targetRegions,
    missing: annotations.missing,
  }, null, 2));
}

main();
