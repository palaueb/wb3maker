#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const graphId = 'world-zone-graph-2026-06-24';

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function inBank4Z80(z80) {
  return z80 >= 0x8000 && z80 < 0xC000;
}

function bank4Z80ToRom(z80) {
  return z80 + 0x8000;
}

function bank5Z80ToRom(z80) {
  return z80 + 0xC000;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function decodeVramLoader8fb(rom, offset) {
  const entries = [];
  const warnings = [];
  let pc = offset;
  let curVramTile = 0;
  let curBank = 8;
  let curBlockIdx = 0;
  let totalTiles = 0;
  let maxVramTile = 0;
  let terminated = false;

  for (let entryIndex = 0; entryIndex < 256 && pc < rom.length; entryIndex++) {
    const entryOffset = pc;
    const count = rom[pc++];
    if (count === 0) {
      terminated = true;
      break;
    }
    if (pc + 3 >= rom.length) {
      warnings.push(`entry ${entryIndex} truncated at ${hex(entryOffset)}`);
      break;
    }
    const vramLo = rom[pc++], vramHi = rom[pc++];
    const srcLo = rom[pc++], srcHi = rom[pc++];
    const vramWord = vramLo | (vramHi << 8);
    const srcWord = srcLo | (srcHi << 8);
    if (vramWord !== 0xFFFF) curVramTile = vramWord;
    if (srcWord !== 0xFFFF) {
      curBank = srcHi >> 1;
      curBlockIdx = ((srcHi & 1) << 8) | srcLo;
    }
    const sourceStart = curBank * 0x4000 + curBlockIdx * 32;
    const sourceEnd = sourceStart + count * 32 - 1;
    if (count > 0x80) warnings.push(`entry ${entryIndex} unusually large tile count ${count}`);
    if (curVramTile + count > 0x200) warnings.push(`entry ${entryIndex} exceeds SMS tile slot range`);
    if (sourceEnd >= rom.length) warnings.push(`entry ${entryIndex} source exceeds ROM at ${hex(sourceStart)}-${hex(sourceEnd)}`);
    entries.push({
      entryIndex,
      entryOffset: hex(entryOffset),
      count,
      vramTileRange: { start: hex(curVramTile, 3), end: hex(curVramTile + count - 1, 3), count },
      source: { bank: curBank, block: hex(curBlockIdx, 3), romRange: [hex(sourceStart), hex(sourceEnd)] },
    });
    totalTiles += count;
    maxVramTile = Math.max(maxVramTile, curVramTile + count - 1);
    curVramTile += count;
    curBlockIdx += count;
  }

  return {
    format: '8fb',
    valid: terminated && entries.length > 0 && warnings.length === 0,
    terminated,
    consumedBytes: pc - offset,
    entries: entries.length,
    totalTiles,
    maxVramTile: hex(maxVramTile, 3),
    sourceRanges: entries.map(e => e.source.romRange),
    warnings,
    entryPreview: entries.slice(0, 8),
  };
}

function decompressScrollMapMeta(rom, offset) {
  let i = offset;
  let decompressedLength = 0;
  let opCount = 0;
  const warnings = [];
  let endReason = 'limit';
  while (i < rom.length && i - offset < 1024 && opCount < 512) {
    const b = rom[i++];
    opCount++;
    if (b === 0xFF) {
      if (i >= rom.length) {
        warnings.push(`truncated FF at ${hex(i - 1)}`);
        endReason = 'truncated';
        break;
      }
      if (rom[i] === 0xFF) {
        i++;
        endReason = 'ff-ff-end';
        break;
      }
      if (i + 1 >= rom.length) {
        warnings.push(`truncated extended RLE at ${hex(i - 1)}`);
        endReason = 'truncated';
        break;
      }
      const count = rom[i++];
      i++;
      decompressedLength += count;
    } else if (b >= 0xE3) {
      if (i >= rom.length) {
        warnings.push(`truncated RLE at ${hex(i - 1)}`);
        endReason = 'truncated';
        break;
      }
      i++;
      decompressedLength += b - 0xE0;
    } else {
      decompressedLength++;
    }
    if (decompressedLength > 2048) warnings.push(`decompressed length exceeds expected scroll buffer at ${hex(offset)}`);
  }
  return {
    romOffset: hex(offset),
    compressedBytes: i - offset,
    decompressedLength,
    opCount,
    endReason,
    warnings,
  };
}

function parseDoorTable(rom, doorRomOff) {
  const entries = [];
  const warnings = [];
  let off = doorRomOff;
  let terminatorOffset = null;
  for (let i = 0; i < 64 && off + 6 < rom.length; i++) {
    if (rom[off] === 0xFF) {
      terminatorOffset = off;
      break;
    }
    const destZ80 = rom[off + 5] | (rom[off + 6] << 8);
    if (!inBank4Z80(destZ80)) warnings.push(`door ${i} destination outside bank 4 Z80 window: ${hex(destZ80, 4)}`);
    entries.push({
      index: i,
      entryOffset: hex(off),
      scrollPositionPixels: rom[off] * 8,
      parameter: hex(rom[off + 1], 2),
      threshold: hex(rom[off + 2] | (rom[off + 3] << 8), 4),
      roomType: rom[off + 4] & 0x1F,
      rawTypeByte: hex(rom[off + 4], 2),
      destinationZ80: hex(destZ80, 4),
      destinationRomOffset: hex(bank4Z80ToRom(destZ80)),
    });
    off += 7;
  }
  if (terminatorOffset == null) warnings.push(`door table did not terminate within 64 entries from ${hex(doorRomOff)}`);
  return {
    romOffset: hex(doorRomOff),
    entries,
    entryCount: entries.length,
    terminatorOffset: terminatorOffset == null ? null : hex(terminatorOffset),
    warnings,
  };
}

function parseDescriptor(rom, mapData, descOff) {
  const issues = [];
  if (descOff < 0 || descOff + 6 > rom.length) issues.push('descriptor offset out of ROM range');
  const scrollX = rom[descOff] ?? 0;
  const scrollY = rom[descOff + 1] ?? 0;
  const cameraX = rom[descOff + 2] ?? 0;
  const cameraY = rom[descOff + 3] ?? 0;
  const subZ80 = (rom[descOff + 4] ?? 0) | ((rom[descOff + 5] ?? 0) << 8);
  if (!inBank4Z80(subZ80)) issues.push(`sub-record pointer ${hex(subZ80, 4)} outside bank 4 Z80 window`);
  const subRomOff = bank4Z80ToRom(subZ80);

  const subInRange = subRomOff >= 0 && subRomOff + 18 <= rom.length;
  if (!subInRange) issues.push(`sub-record ROM ${hex(subRomOff)} out of range`);

  const doorZ80 = subInRange ? rom[subRomOff] | (rom[subRomOff + 1] << 8) : 0;
  const p2Z80 = subInRange ? rom[subRomOff + 8] | (rom[subRomOff + 9] << 8) : 0;
  const dc2Indices = subInRange ? Array.from(rom.slice(subRomOff + 10, subRomOff + 16)) : [];
  const flags = subInRange ? rom[subRomOff + 16] : 0;
  const paletteIndex = flags & 0x3F;
  const audioRequestId = subInRange ? rom[subRomOff + 17] : 0;
  if (subInRange && !inBank4Z80(doorZ80)) issues.push(`door table pointer ${hex(doorZ80, 4)} outside bank 4 Z80 window`);
  if (subInRange && !inBank4Z80(p2Z80)) issues.push(`8FB pointer ${hex(p2Z80, 4)} outside bank 4 Z80 window`);
  if (dc2Indices.some(idx => !(idx <= 0xAF || idx === 0xFF))) issues.push(`DC2 index outside expected table range`);

  const doorRomOff = bank4Z80ToRom(doorZ80);
  const p2RomOff = bank4Z80ToRom(p2Z80);
  const p2Loader = inBank4Z80(p2Z80) ? decodeVramLoader8fb(rom, p2RomOff) : null;
  if (p2Loader && !p2Loader.valid) issues.push(`8FB loader at ${hex(p2RomOff)} did not validate cleanly`);

  const dc2Streams = dc2Indices.map((idx, streamIndex) => {
    if (idx === 0xFF) return { streamIndex, index: hex(idx, 2), disabled: true };
    const tableEntryOffset = 0x14000 + idx * 2;
    if (tableEntryOffset + 1 >= rom.length) {
      return { streamIndex, index: hex(idx, 2), tableEntryOffset: hex(tableEntryOffset), warnings: ['table entry out of range'] };
    }
    const z80Ptr = rom[tableEntryOffset] | (rom[tableEntryOffset + 1] << 8);
    const romOffset = bank5Z80ToRom(z80Ptr);
    const meta = romOffset >= 0 && romOffset < rom.length
      ? decompressScrollMapMeta(rom, romOffset)
      : { warnings: ['stream pointer out of ROM range'] };
    return {
      streamIndex,
      index: hex(idx, 2),
      tableEntryOffset: hex(tableEntryOffset),
      z80Pointer: hex(z80Ptr, 4),
      romOffset: hex(romOffset),
      ...meta,
    };
  });

  const doorTable = inBank4Z80(doorZ80) ? parseDoorTable(rom, doorRomOff) : null;
  if (doorTable?.warnings.length) issues.push(...doorTable.warnings.map(w => `door table: ${w}`));
  if (dc2Streams.some(s => (s.warnings || []).length)) issues.push('one or more DC2 streams produced warnings');

  let extra998 = null;
  if ((flags & 0x80) === 0) extra998 = { sourceLabel: '_DATA_275D_', regionId: 'r0033', condition: 'flags bit7 = 0' };
  else if ((flags & 0x40) === 0) extra998 = { sourceLabel: '_DATA_2762_', regionId: 'r0034', condition: 'flags bit7 = 1 and bit6 = 0' };
  else extra998 = { sourceLabel: null, regionId: null, condition: 'flags bits7/6 = 1/1, extra 998 loader skipped' };

  const region = findContainingRegion(mapData, descOff);
  return {
    id: 'zone_' + descOff.toString(16).toUpperCase(),
    valid: issues.length === 0,
    descriptorOffset: hex(descOff),
    descriptorRegionId: region?.id || '',
    descriptorRegionName: region?.name || '',
    scroll: {
      x: scrollX === 0xFF ? { keep: true } : { raw: hex(scrollX, 2), pixels: scrollX * 8 },
      y: scrollY === 0xFF ? { keep: true } : { raw: hex(scrollY, 2) },
    },
    camera: {
      x: cameraX === 0x80 ? { keep: true } : { raw: hex(cameraX, 2), pixels: cameraX * 0x100 },
      y: cameraY === 0x80 ? { keep: true } : { raw: hex(cameraY, 2), pixels: cameraY * 0x100 },
    },
    subrecord: {
      z80Pointer: hex(subZ80, 4),
      romOffset: hex(subRomOff),
      doorTableZ80: hex(doorZ80, 4),
      doorTableRomOffset: hex(doorRomOff),
      vramLoader8fbZ80: hex(p2Z80, 4),
      vramLoader8fbRomOffset: hex(p2RomOff),
      dc2Indices: dc2Indices.map(v => hex(v, 2)),
      flags: hex(flags, 2),
      paletteIndex,
      bgPaletteIndex: paletteIndex & 0x3F,
      audioRequestId,
      audioRequestIdHex: hex(audioRequestId, 2),
      audioRequestInTable: audioRequestId < 62,
    },
    vramLoader8fb: p2Loader ? {
      romOffset: hex(p2RomOff),
      valid: p2Loader.valid,
      consumedBytes: p2Loader.consumedBytes,
      entries: p2Loader.entries,
      totalTiles: p2Loader.totalTiles,
      maxVramTile: p2Loader.maxVramTile,
      sourceRanges: p2Loader.sourceRanges,
      warnings: p2Loader.warnings,
      entryPreview: p2Loader.entryPreview,
    } : null,
    extra998,
    dc2Streams,
    doorTable,
    issues,
  };
}

function buildZoneGraph(rom, mapData) {
  const entryOffsets = [0x10C90, 0x10C96];
  const descriptors = [];
  const descriptorByOffset = new Map();
  const rejectedTargets = new Map();
  const queue = [...entryOffsets];

  while (queue.length && descriptors.length < 1024) {
    const off = queue.shift();
    if (descriptorByOffset.has(off) || rejectedTargets.has(off)) continue;
    const descriptor = parseDescriptor(rom, mapData, off);
    if (!descriptor.valid) {
      rejectedTargets.set(off, { offset: hex(off), issues: descriptor.issues.slice(0, 8) });
      continue;
    }
    descriptorByOffset.set(off, descriptor);
    descriptors.push(descriptor);
    for (const door of descriptor.doorTable?.entries || []) {
      const dest = parseInt(door.destinationRomOffset, 16);
      if (!descriptorByOffset.has(dest) && !rejectedTargets.has(dest) && !queue.includes(dest)) queue.push(dest);
    }
  }

  const edges = [];
  for (const descriptor of descriptors) {
    for (const door of descriptor.doorTable?.entries || []) {
      const dest = parseInt(door.destinationRomOffset, 16);
      edges.push({
        from: descriptor.id,
        to: descriptorByOffset.has(dest) ? descriptorByOffset.get(dest).id : null,
        doorIndex: door.index,
        roomType: door.roomType,
        scrollPositionPixels: door.scrollPositionPixels,
        destinationRomOffset: door.destinationRomOffset,
        destinationValid: descriptorByOffset.has(dest),
      });
    }
  }

  const uniqueDoorTables = new Set(descriptors.map(d => d.subrecord.doorTableRomOffset));
  const uniqueSubrecords = new Set(descriptors.map(d => d.subrecord.romOffset));
  const unique8fb = new Set(descriptors.map(d => d.subrecord.vramLoader8fbRomOffset));
  const uniqueAudioRequests = new Set(descriptors.map(d => d.subrecord.audioRequestId));
  const uniqueDc2 = new Set();
  for (const d of descriptors) for (const s of d.dc2Streams) if (!s.disabled) uniqueDc2.add(s.romOffset);

  return {
    id: graphId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-zone-graph-audit.mjs',
    bankContext: {
      descriptorBank: 4,
      descriptorZ80Window: '0x8000-0xBFFF',
      descriptorRomFormula: 'rom = z80 + 0x8000',
      dc2PointerTableRomOffset: '0x14000',
      dc2StreamRomFormula: 'rom = z80 + 0xC000',
    },
    entryDescriptors: entryOffsets.map(offset => ({ offset: hex(offset), regionId: findExactRegion(mapData, offset)?.id || findContainingRegion(mapData, offset)?.id || '' })),
    summary: {
      descriptorCount: descriptors.length,
      edgeCount: edges.length,
      rejectedTargetCount: rejectedTargets.size,
      uniqueSubrecordCount: uniqueSubrecords.size,
      uniqueDoorTableCount: uniqueDoorTables.size,
      uniqueVramLoader8fbCount: unique8fb.size,
      uniqueDc2StreamCount: uniqueDc2.size,
      uniqueAudioRequestCount: uniqueAudioRequests.size,
      assetPolicy: 'Metadata only: offsets, pointers, decoded counts, flags, palette indexes, audio request ids, and graph edges. No ROM bytes or decoded graphics/audio are embedded.',
    },
    descriptors,
    edges,
    rejectedTargets: [...rejectedTargets.values()],
  };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const graph = buildZoneGraph(rom, mapData);

  if (apply) {
    mapData.zoneGraphs = (mapData.zoneGraphs || []).filter(g => g.id !== graphId);
    mapData.zoneGraphs.push(graph);

    for (const entry of graph.entryDescriptors) {
      const region = mapData.regions.find(r => r.id === entry.regionId);
      if (!region) continue;
      region.analysis = region.analysis || {};
      region.analysis.zoneGraphAudit = {
        kind: 'room_zone_descriptor_graph_entry',
        summary: `Entry into _LABEL_2620_ descriptor graph; graph currently contains ${graph.summary.descriptorCount} validated descriptors and ${graph.summary.edgeCount} door edges.`,
        confidence: 'high',
        graphId,
        entryDescriptorOffset: entry.offset,
        generatedAt: now,
        evidence: [
          '_LABEL_2620_ consumes 6-byte descriptors, then _LABEL_26F4_ parses the bank-4 sub-record.',
          'Zone graph traversal follows bank-4 door-table destination pointers and validates each target descriptor/sub-record/8FB loader.',
        ],
      };
    }

    const reportId = 'zone-graph-audit-2026-06-24';
    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_zone_graph_audit',
      generatedAt: now,
      tool: 'tools/world-zone-graph-audit.mjs --apply',
      schemaVersion: 1,
      summary: graph.summary,
      entryDescriptors: graph.entryDescriptors,
      descriptorSamples: graph.descriptors.slice(0, 12).map(d => ({
        id: d.id,
        descriptorOffset: d.descriptorOffset,
        subrecordOffset: d.subrecord.romOffset,
        doorTableOffset: d.subrecord.doorTableRomOffset,
        vramLoader8fbOffset: d.subrecord.vramLoader8fbRomOffset,
        doorCount: d.doorTable?.entryCount || 0,
        dc2Indices: d.subrecord.dc2Indices,
        paletteIndex: d.subrecord.paletteIndex,
        audioRequestId: d.subrecord.audioRequestId,
        audioRequestIdHex: d.subrecord.audioRequestIdHex,
      })),
      rejectedTargets: graph.rejectedTargets.slice(0, 80),
      nextLeads: [
        'Split broad bank-4 regions at validated descriptor, sub-record, door-table, and 8FB loader boundaries after reviewing overlap impact.',
        'Use zoneGraphs descriptors to generate reusable scene/zone recipes with 8FB loader, conditional 998 loader, palette index, and DC2 streams.',
        'Compare graph door roomType values with player transition code to separate scrolling zones, shops, bosses, and special rooms.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    graphId: graph.id,
    summary: graph.summary,
    entryDescriptors: graph.entryDescriptors,
    firstDescriptors: graph.descriptors.slice(0, 8).map(d => ({
      id: d.id,
      descriptorOffset: d.descriptorOffset,
      subrecordOffset: d.subrecord.romOffset,
      doorCount: d.doorTable?.entryCount || 0,
      p2: d.subrecord.vramLoader8fbRomOffset,
      dc2: d.subrecord.dc2Indices,
      paletteIndex: d.subrecord.paletteIndex,
    })),
    rejectedTargetsSample: graph.rejectedTargets.slice(0, 12),
  }, null, 2));
}

main();
