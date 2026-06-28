#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_OPCODE_ARG_BYTES,
  AUDIO_OPCODE_METADATA_BY_OPCODE,
  audioOpcodeMetadataObject,
} from './world-audio-opcode-metadata.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-audio-catalog-2026-06-24';
const reportId = 'audio-audit-2026-06-24';

const SONG_TABLE_OFFSET = 0x0D139;
const SONG_COUNT = 62;
const SONG_DATA_START = 0x0D1B5;

const OPCODE_ARGS = AUDIO_OPCODE_ARG_BYTES;

const AUDIO_DRIVER_REGIONS = [
  {
    offset: 0x0C02D,
    role: 'fm_register_init_table',
    summary: 'FM register initialization/operator table used by sound init and FM update code.',
    evidence: [
      '_LABEL_C000_ loads _DATA_C02D_ and writes pairs to Port_FMAddress/Port_FMData.',
      '_LABEL_C7FD_ reuses _DATA_C02D_ while updating FM channel state.',
    ],
  },
  {
    offset: 0x0C391,
    role: 'music_opcode_dispatch_table_and_handlers',
    summary: 'F0-FF music opcode dispatch table followed by handler code reached via _LABEL_C37B_.',
    evidence: [
      '_LABEL_C37B_ maps opcode low nibble to Z80 table address 0x8391, which is ROM 0x0C391 in bank 3.',
      'The first 16 words at 0x0C391 point at handler targets for music opcodes F0-FF.',
    ],
  },
  {
    offset: 0x0C3F0,
    role: 'music_opcode_handler',
    summary: 'Computed music opcode handler target from the 0x0C391 dispatch table.',
    evidence: [
      '0x0C391 dispatch table contains handler target Z80 0x83F0, which maps to ROM 0x0C3F0.',
      '_LABEL_C37B_ reaches this table through push/ret opcode dispatch.',
    ],
  },
  {
    offset: 0x0C400,
    role: 'music_opcode_handler',
    summary: 'Computed music opcode handler target from the 0x0C391 dispatch table.',
    evidence: [
      '0x0C391 dispatch table contains handler target Z80 0x8400, which maps to ROM 0x0C400.',
      '_LABEL_C37B_ reaches this table through push/ret opcode dispatch.',
    ],
  },
  {
    offset: 0x0C6F3,
    role: 'psg_noise_or_envelope_table',
    summary: 'PSG update support table selected while handling noise channel state.',
    evidence: [
      '_LABEL_C671_ loads _DATA_C6F3_ and indexes 3-byte entries before writing Port_PSG.',
      '_LABEL_C50E_ and _LABEL_C671_ are in the PSG update path called from _LABEL_C4C1_.',
    ],
  },
  {
    offset: 0x0CA85,
    role: 'psg_fm_frequency_table',
    summary: 'Pitch/frequency support table used by PSG and FM update paths.',
    evidence: [
      '_LABEL_C56A_ loads Z80 address 0x8A85, which maps to ROM 0x0CA85, for PSG pitch lookup.',
      '_LABEL_C928_ loads Z80 address 0x8C1D, which falls inside the same table block for FM pitch lookup.',
    ],
  },
  {
    offset: 0x0CAFF,
    role: 'psg_fm_frequency_table',
    summary: 'Continuation of pitch/frequency support data used by audio update code.',
    evidence: [
      '_LABEL_C928_ loads Z80 address 0x8C1D, which maps into the 0x0CAFF-0x0CD3F region.',
      'ASM comments also identify 0x0CAFF as a pointer-table target used by music stream data.',
    ],
  },
  {
    offset: 0x0CD40,
    role: 'instrument_or_envelope_table',
    summary: 'Audio instrument/envelope support data addressed by PSG/FM update routines and song streams.',
    evidence: [
      '_LABEL_C50E_ indexes Z80 base 0x8DB5, which maps into the 0x0CD40-0x0CFFF region.',
      '_LABEL_C7FD_ indexes Z80 base 0x8DEB, which maps into the same audio support table region.',
    ],
  },
  {
    offset: 0x0D000,
    role: 'music_support_stream_table',
    summary: 'Audio support byte stream/table immediately preceding the song pointer table.',
    evidence: [
      'ASM comment marks _DATA_D000_ as the first entry of a pointer table referenced from 0x0E781, inside bank-3 music data.',
      '_DATA_D000_ directly precedes the _DATA_D139_ song table and has no screen renderer call-site evidence.',
    ],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isBank3RomPtr(z80) {
  return z80 >= 0x8000 && z80 < 0xC000;
}

function z80ToRom(z80) {
  return z80 + 0x4000;
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(r => {
    const start = parseInt(r.offset, 16);
    return offset >= start && offset < start + (r.size || 0);
  }) || null;
}

function findExactRegion(mapData, offset) {
  return mapData.regions.find(r => parseInt(r.offset, 16) === offset) || null;
}

function regionRef(mapData, offset) {
  const region = findContainingRegion(mapData, offset);
  if (!region) return null;
  return {
    id: region.id,
    name: region.name || '',
    type: region.type || 'unknown',
    offset: region.offset,
  };
}

function pushUnique(list, item, keyFn = JSON.stringify) {
  const key = keyFn(item);
  if (!list.some(existing => keyFn(existing) === key)) list.push(item);
}

function incCounter(obj, key) {
  obj[key] = (obj[key] || 0) + 1;
}

function parseSongHeader(rom, songRomOffset, mapData) {
  const channels = [];
  const warnings = [];
  let pos = songRomOffset;
  let terminatorOffset = null;
  let terminatorByte = null;

  for (let i = 0; i < 16 && pos + 3 < rom.length && pos < songRomOffset + 64; i++) {
    const marker = rom[pos];
    if (marker >= 0xF0) {
      terminatorOffset = pos;
      terminatorByte = marker;
      pos++;
      break;
    }
    const priority = rom[pos + 1];
    const streamZ80 = rom[pos + 2] | (rom[pos + 3] << 8);
    const streamRomOffset = isBank3RomPtr(streamZ80) ? z80ToRom(streamZ80) : null;
    if (streamRomOffset == null) warnings.push(`channel ${i} stream pointer ${hex(streamZ80, 4)} is not a bank-3 ROM pointer`);
    channels.push({
      index: i,
      headerOffset: hex(pos),
      channelId: marker,
      channelIdHex: hex(marker, 2),
      priority,
      priorityHex: hex(priority, 2),
      streamZ80: hex(streamZ80, 4),
      streamRomOffset: streamRomOffset == null ? null : hex(streamRomOffset),
      streamRegion: streamRomOffset == null ? null : regionRef(mapData, streamRomOffset),
    });
    pos += 4;
  }

  if (terminatorOffset == null) warnings.push(`header did not terminate within 64 bytes from ${hex(songRomOffset)}`);
  return {
    headerBytes: pos - songRomOffset,
    terminatorOffset: terminatorOffset == null ? null : hex(terminatorOffset),
    terminatorByte: terminatorByte == null ? null : hex(terminatorByte, 2),
    channels,
    warnings,
  };
}

function parseMusicStream(rom, startOffset, mapData, referencedBy) {
  const opcodeCounts = {};
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
      const opKey = '$' + b.toString(16).toUpperCase().padStart(2, '0');
      const opcodeMeta = AUDIO_OPCODE_METADATA_BY_OPCODE.get(b) || null;
      incCounter(opcodeCounts, opKey);
      const argc = opcodeMeta?.argBytes ?? OPCODE_ARGS.get(b) ?? 0;
      if (pc + argc > rom.length) {
        warnings.push(`opcode ${opKey} at ${hex(opOffset)} is truncated`);
        endReason = 'truncated';
        break;
      }

      if (opcodeMeta?.pointerArg && argc >= 2) {
        const z80Target = rom[pc] | (rom[pc + 1] << 8);
        const romTarget = isBank3RomPtr(z80Target) ? z80ToRom(z80Target) : null;
        branchTargets.push({
          opcode: opKey,
          opcodeOffset: hex(opOffset),
          z80Target: hex(z80Target, 4),
          romTarget: romTarget == null ? null : hex(romTarget),
          targetRegion: romTarget == null ? null : regionRef(mapData, romTarget),
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

  const endOffset = Math.max(startOffset, pc - 1);
  const region = regionRef(mapData, startOffset);
  return {
    id: 'music_stream_' + startOffset.toString(16).toUpperCase(),
    startOffset: hex(startOffset),
    endOffset: hex(endOffset),
    consumedBytes: pc - startOffset,
    region,
    referencedBy,
    parser: {
      confidence: 'medium',
      note: 'Best-effort static parser; control opcode semantics are inferred from the bank-3 driver and existing analyzer player.',
    },
    noteBytes,
    highFlagNoteBytes,
    restOrSpecialBytes,
    opcodeCounts,
    branchTargets,
    endReason,
    warnings,
  };
}

function parseSongCatalog(rom, mapData) {
  const songs = [];
  const streamQueue = [];
  const queued = new Set();

  function enqueueStream(offset, ref) {
    if (offset == null || offset < SONG_DATA_START || offset >= 0x10000) return;
    if (!queued.has(offset)) {
      queued.add(offset);
      streamQueue.push({ offset, referencedBy: [ref] });
      return;
    }
    const item = streamQueue.find(s => s.offset === offset);
    if (item) pushUnique(item.referencedBy, ref, r => `${r.kind}|${r.songIndex ?? ''}|${r.channelIndex ?? ''}|${r.sourceOffset ?? ''}`);
  }

  for (let index = 0; index < SONG_COUNT; index++) {
    const tableEntryOffset = SONG_TABLE_OFFSET + index * 2;
    const z80Pointer = rom[tableEntryOffset] | (rom[tableEntryOffset + 1] << 8);
    const romOffset = isBank3RomPtr(z80Pointer) ? z80ToRom(z80Pointer) : null;
    const region = romOffset == null ? null : regionRef(mapData, romOffset);
    const header = romOffset == null ? null : parseSongHeader(rom, romOffset, mapData);
    const warnings = [];
    if (romOffset == null) warnings.push(`song pointer ${hex(z80Pointer, 4)} is not a bank-3 ROM pointer`);
    if (header) warnings.push(...header.warnings);

    for (const channel of header?.channels || []) {
      if (channel.streamRomOffset) {
        enqueueStream(parseInt(channel.streamRomOffset, 16), {
          kind: 'song-channel',
          songIndex: index,
          channelIndex: channel.index,
          sourceOffset: channel.headerOffset,
        });
      }
    }

    songs.push({
      index,
      tableEntryOffset: hex(tableEntryOffset),
      z80Pointer: hex(z80Pointer, 4),
      romOffset: romOffset == null ? null : hex(romOffset),
      region,
      header,
      warnings,
    });
  }

  const streams = [];
  const parsedStreams = new Map();
  while (streamQueue.length && streams.length < 768) {
    const item = streamQueue.shift();
    if (parsedStreams.has(item.offset)) {
      const existing = parsedStreams.get(item.offset);
      for (const ref of item.referencedBy) pushUnique(existing.referencedBy, ref, r => `${r.kind}|${r.songIndex ?? ''}|${r.channelIndex ?? ''}|${r.sourceOffset ?? ''}`);
      continue;
    }

    const stream = parseMusicStream(rom, item.offset, mapData, item.referencedBy);
    parsedStreams.set(item.offset, stream);
    streams.push(stream);

    for (const target of stream.branchTargets) {
      if (!target.romTarget) continue;
      const targetOffset = parseInt(target.romTarget, 16);
      enqueueStream(targetOffset, {
        kind: 'stream-branch',
        sourceOffset: target.opcodeOffset,
        opcode: target.opcode,
      });
    }
  }

  return { songs, streams };
}

function collectReferencedOffsets(catalog) {
  const offsets = [];
  for (const song of catalog.songs) {
    if (song.romOffset) offsets.push({ offset: parseInt(song.romOffset, 16), kind: 'song-entry', songIndex: song.index });
    for (const channel of song.header?.channels || []) {
      if (channel.streamRomOffset) offsets.push({ offset: parseInt(channel.streamRomOffset, 16), kind: 'channel-stream', songIndex: song.index, channelIndex: channel.index });
    }
  }
  for (const stream of catalog.streams) {
    offsets.push({ offset: parseInt(stream.startOffset, 16), kind: 'stream-segment' });
    for (const target of stream.branchTargets) {
      if (target.romTarget) offsets.push({ offset: parseInt(target.romTarget, 16), kind: 'stream-branch', opcode: target.opcode });
    }
  }
  return offsets;
}

function addRefToRegionMap(refsByRegionId, region, ref) {
  if (!refsByRegionId.has(region.id)) refsByRegionId.set(region.id, { region, refs: [] });
  refsByRegionId.get(region.id).refs.push(ref);
}

function regionShouldBecomeMusic(region) {
  const current = region.type || 'unknown';
  return ['unknown', 'screen_prog', 'vram_loader_8fb', 'vram_loader_998', 'raw_byte', 'pointer_table'].includes(current);
}

function regionShouldBecomeAudioDriverData(region) {
  const current = region.type || 'unknown';
  return ['unknown', 'screen_prog', 'raw_byte', 'code'].includes(current);
}

function updateMusicRegion(region, refs) {
  const previousType = region.type || 'unknown';
  const changedType = regionShouldBecomeMusic(region) && previousType !== 'music';
  if (changedType) region.type = 'music';
  region.analysis = region.analysis || {};
  const existing = region.analysis.audioAudit || {};
  region.analysis.audioAudit = {
    kind: 'music_song_or_stream_data',
    summary: 'Region is referenced by the bank-3 sound driver song table, a parsed song header, or a parsed music stream branch.',
    confidence: 'high',
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    references: refs.slice(0, 24).map(ref => ({
      kind: ref.kind,
      offset: hex(ref.offset),
      songIndex: ref.songIndex,
      channelIndex: ref.channelIndex,
      opcode: ref.opcode,
      streamId: ref.streamId,
      streamStart: ref.streamStart == null ? undefined : hex(ref.streamStart),
      streamEnd: ref.streamEnd == null ? undefined : hex(ref.streamEnd),
    })),
    evidence: [
      '_LABEL_C04D_ and _LABEL_C09F_ load _DATA_D139_ and index it with _RAM_C222_ song/SFX state.',
      '_DATA_D139_ is a 62-entry word table; each valid table word maps from bank-3 Z80 address to ROM offset by rom = z80 + 0x4000.',
      'Parsed song headers use 4-byte records [channel id, priority, stream pointer lo, stream pointer hi] until an F0-FF terminator.',
      'Regions that overlap parsed stream spans are classified as music even when the stream starts just before the region boundary.',
      'Orphan fragments in the bank-3 song-data range from _DATA_D1B5_ through the end of bank 3 are kept as music when no code or audio-driver classification supersedes them.',
    ],
    generatedAt: now,
    tool: 'tools/world-audio-audit.mjs',
  };
  return changedType;
}

function updateAudioDriverRegion(region, def) {
  const previousType = region.type || 'unknown';
  const changedType = regionShouldBecomeAudioDriverData(region) && previousType !== 'audio_driver_data';
  if (changedType) region.type = 'audio_driver_data';
  region.analysis = region.analysis || {};
  const existing = region.analysis.audioAudit || {};
  region.analysis.audioAudit = {
    kind: def.role,
    summary: def.summary,
    confidence: 'high',
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    evidence: def.evidence,
    generatedAt: now,
    tool: 'tools/world-audio-audit.mjs',
  };
  return changedType;
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const evidenceOnlyRegions = [];
  const missingRegions = [];
  const refsByRegionId = new Map();

  for (const ref of collectReferencedOffsets(catalog)) {
    if (ref.offset < SONG_DATA_START || ref.offset >= 0x10000) continue;
    const region = findContainingRegion(mapData, ref.offset);
    if (!region) {
      missingRegions.push({ offset: hex(ref.offset), kind: ref.kind });
      continue;
    }
    addRefToRegionMap(refsByRegionId, region, ref);
  }

  for (const stream of catalog.streams) {
    const streamStart = parseInt(stream.startOffset, 16);
    const streamEnd = parseInt(stream.endOffset, 16);
    if (streamEnd < SONG_DATA_START || streamStart >= 0x10000) continue;
    for (const region of mapData.regions) {
      const regionStart = parseInt(region.offset, 16);
      const regionEnd = regionStart + (region.size || 0) - 1;
      if (regionEnd < SONG_DATA_START || regionStart >= 0x10000) continue;
      if (streamEnd < regionStart || streamStart > regionEnd) continue;
      const current = region.type || 'unknown';
      if (current !== 'music' && !regionShouldBecomeMusic(region)) continue;
      addRefToRegionMap(refsByRegionId, region, {
        offset: Math.max(streamStart, regionStart),
        kind: 'stream-overlap',
        streamId: stream.id,
        streamStart,
        streamEnd,
      });
    }
  }

  for (const region of mapData.regions) {
    const regionStart = parseInt(region.offset, 16);
    if (regionStart < SONG_DATA_START || regionStart >= 0x10000) continue;
    if (!regionShouldBecomeMusic(region)) continue;
    addRefToRegionMap(refsByRegionId, region, {
      offset: regionStart,
      kind: 'song-data-range',
    });
  }

  for (const { region, refs } of refsByRegionId.values()) {
    if (!apply) {
      const wouldChange = regionShouldBecomeMusic(region) && (region.type || 'unknown') !== 'music';
      (wouldChange ? changedRegions : evidenceOnlyRegions).push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType: region.type || 'unknown',
        inferredType: 'music',
        referenceCount: refs.length,
      });
      continue;
    }
    const previousType = region.type || 'unknown';
    const changed = updateMusicRegion(region, refs);
    const item = {
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType,
      type: region.type,
      referenceCount: refs.length,
    };
    (changed ? changedRegions : evidenceOnlyRegions).push(item);
  }

  for (const def of AUDIO_DRIVER_REGIONS) {
    const region = findExactRegion(mapData, def.offset);
    if (!region) {
      missingRegions.push({ offset: hex(def.offset), kind: def.role });
      continue;
    }
    if (!apply) {
      const wouldChange = regionShouldBecomeAudioDriverData(region) && (region.type || 'unknown') !== 'audio_driver_data';
      (wouldChange ? changedRegions : evidenceOnlyRegions).push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType: region.type || 'unknown',
        inferredType: 'audio_driver_data',
        role: def.role,
      });
      continue;
    }
    const previousType = region.type || 'unknown';
    const changed = updateAudioDriverRegion(region, def);
    const item = {
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType,
      type: region.type,
      role: def.role,
    };
    (changed ? changedRegions : evidenceOnlyRegions).push(item);
  }

  return { changedRegions, evidenceOnlyRegions, missingRegions };
}

function boundaryIssues(mapData, catalog) {
  const issues = [];
  for (const song of catalog.songs) {
    if (!song.romOffset) continue;
    const offset = parseInt(song.romOffset, 16);
    const exact = findExactRegion(mapData, offset);
    const containing = findContainingRegion(mapData, offset);
    if (!exact && containing) {
      issues.push({
        kind: 'song_entry_inside_existing_region',
        songIndex: song.index,
        offset: song.romOffset,
        containingRegionId: containing.id,
        containingRegionOffset: containing.offset,
        containingRegionType: containing.type || 'unknown',
      });
    }
  }
  return issues;
}

function collectConfirmedChangedRegions(mapData) {
  return mapData.regions
    .filter(region => region.analysis?.audioAudit?.catalogId === catalogId && region.analysis.audioAudit.changedType)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType: region.analysis.audioAudit.typeBeforeAudit || 'unknown',
      type: region.type || 'unknown',
      kind: region.analysis.audioAudit.kind,
    }));
}

function buildCatalog(rom, mapData) {
  const parsed = parseSongCatalog(rom, mapData);
  const uniqueStreamRegions = new Set(parsed.streams.map(s => s.region?.id).filter(Boolean));
  const opcodeTotals = {};
  for (const stream of parsed.streams) {
    for (const [opcode, count] of Object.entries(stream.opcodeCounts)) {
      opcodeTotals[opcode] = (opcodeTotals[opcode] || 0) + count;
    }
  }
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-audio-audit.mjs',
    bankContext: {
      driverBank: 3,
      driverZ80Window: '0x8000-0xBFFF',
      z80ToRomFormula: 'rom = z80 + 0x4000',
      psgPort: '0x7F',
      fmAddressPort: '0xF0',
      fmDataPort: '0xF1',
    },
    songTable: {
      label: '_DATA_D139_',
      romOffset: hex(SONG_TABLE_OFFSET),
      entries: SONG_COUNT,
      indexedBy: '_RAM_C222_',
      driverRoutines: ['_LABEL_C04D_', '_LABEL_C09F_'],
      evidence: [
        '_LABEL_C04D_: ld de, _DATA_D139_; indexes by C register and copies channel records into _RAM_C100_ state.',
        '_LABEL_C09F_: ld de, _DATA_D139_; indexes queued song IDs from _RAM_C222_ before per-frame audio update.',
      ],
    },
    parser: {
      confidence: 'medium',
      note: 'Headers are confirmed by driver control flow; stream opcode lengths come from the handler-derived metadata in tools/world-audio-opcode-metadata.mjs.',
      opcodeArgBytes: Object.fromEntries([...OPCODE_ARGS.entries()].map(([op, count]) => ['$' + op.toString(16).toUpperCase(), count])),
      opcodeMetadata: audioOpcodeMetadataObject(),
    },
    summary: {
      songEntries: parsed.songs.length,
      validSongPointers: parsed.songs.filter(s => s.romOffset).length,
      channelHeaders: parsed.songs.reduce((sum, s) => sum + (s.header?.channels.length || 0), 0),
      parsedStreamSegments: parsed.streams.length,
      uniqueStreamRegions: uniqueStreamRegions.size,
      streamsWithWarnings: parsed.streams.filter(s => s.warnings.length).length,
      opcodeTotals,
      assetPolicy: 'Metadata only: offsets, labels, counts, pointers, parser warnings, and references. No ROM bytes, decoded music, or audio samples are embedded.',
    },
    songs: parsed.songs,
    streams: parsed.streams,
    audioDriverRegions: AUDIO_DRIVER_REGIONS.map(def => ({ offset: hex(def.offset), role: def.role, summary: def.summary, evidence: def.evidence })),
  };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotation = annotateMap(mapData, catalog);
  const splitCandidates = boundaryIssues(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(rom, mapData);
    const confirmedChangedRegions = collectConfirmedChangedRegions(mapData);
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(c => c.id !== catalogId);
    mapData.audioCatalogs.push(finalCatalog);

    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_music_catalog_audit',
      generatedAt: now,
      tool: 'tools/world-audio-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegionTypes: confirmedChangedRegions.length,
        changedRegionTypesThisRun: annotation.changedRegions.length,
        evidenceOnlyRegions: annotation.evidenceOnlyRegions.length,
        missingReferencedRegions: annotation.missingRegions.length,
        boundarySplitCandidates: splitCandidates.length,
      },
      songTable: finalCatalog.songTable,
      changedRegions: confirmedChangedRegions,
      changedRegionsThisRun: annotation.changedRegions,
      evidenceOnlyRegions: annotation.evidenceOnlyRegions.slice(0, 120),
      missingReferencedRegions: annotation.missingRegions.slice(0, 120),
      boundarySplitCandidates: splitCandidates.slice(0, 120),
      nextLeads: [
        'Disassemble and name each F0-FF music opcode handler reached through the 0x0C391 dispatch table.',
        'Refine F6/FD/FB-FE stream semantics, then update the static parser and browser music preview to share one decoder.',
        'Split bank-3 music regions at confirmed song-entry/header/stream boundaries where boundarySplitCandidates marks a table entry inside an existing region.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegionTypes: annotation.changedRegions.length,
    changedRegions: annotation.changedRegions.slice(0, 80),
    evidenceOnlyRegions: annotation.evidenceOnlyRegions.slice(0, 40),
    missingReferencedRegions: annotation.missingRegions.slice(0, 40),
    boundarySplitCandidates: splitCandidates.slice(0, 40),
  }, null, 2));
}

main();
