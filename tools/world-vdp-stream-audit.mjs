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
const catalogId = 'world-vdp-stream-catalog-2026-06-24';
const reportId = 'vdp-stream-audit-2026-06-24';

const STREAM_BUNDLE_OFFSET = 0x09AE0;
const STREAM_BUNDLE_END = 0x0B3BF;
const ROOT_TABLE_COUNT = 6;

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isBank2Ptr(z80) {
  return z80 >= 0x8000 && z80 < 0xC000;
}

function bank2Z80ToRom(z80) {
  return z80;
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(r => {
    const start = parseInt(r.offset, 16);
    return offset >= start && offset < start + (r.size || 0);
  }) || null;
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

function readWord(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function readRootTable(rom, mapData) {
  const entries = [];
  for (let i = 0; i < ROOT_TABLE_COUNT; i++) {
    const entryOffset = STREAM_BUNDLE_OFFSET + i * 2;
    const z80Pointer = readWord(rom, entryOffset);
    const romOffset = isBank2Ptr(z80Pointer) ? bank2Z80ToRom(z80Pointer) : null;
    entries.push({
      index: i,
      entryOffset: hex(entryOffset),
      z80Pointer: hex(z80Pointer, 4),
      romOffset: romOffset == null ? null : hex(romOffset),
      region: romOffset == null ? null : regionRef(mapData, romOffset),
    });
  }
  return entries;
}

function readInlinePointerList(rom, mapData, offset) {
  const entries = [];
  let pos = offset;
  while (pos + 1 <= STREAM_BUNDLE_END && entries.length < 128) {
    const z80Pointer = readWord(rom, pos);
    const romOffset = isBank2Ptr(z80Pointer) ? bank2Z80ToRom(z80Pointer) : null;
    if (romOffset == null || romOffset < STREAM_BUNDLE_OFFSET || romOffset > STREAM_BUNDLE_END) break;
    entries.push({
      index: entries.length,
      entryOffset: hex(pos),
      z80Pointer: hex(z80Pointer, 4),
      romOffset: hex(romOffset),
      region: regionRef(mapData, romOffset),
    });
    pos += 2;
  }
  return {
    tableOffset: hex(offset),
    entryCount: entries.length,
    byteLength: entries.length * 2,
    entries,
  };
}

function byteStats(rom, start, end) {
  const bytes = rom.subarray(start, end + 1);
  let zeros = 0;
  let ff = 0;
  let f0Plus = 0;
  let pointerLike = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) zeros++;
    if (bytes[i] === 0xFF) ff++;
    if (bytes[i] >= 0xF0) f0Plus++;
    if (i + 1 < bytes.length) {
      const word = bytes[i] | (bytes[i + 1] << 8);
      if (isBank2Ptr(word)) pointerLike++;
    }
  }
  return {
    size: bytes.length,
    zeroBytes: zeros,
    ffBytes: ff,
    f0PlusBytes: f0Plus,
    bank2PointerLikeWordCount: pointerLike,
    zeroRatio: Number((zeros / Math.max(1, bytes.length)).toFixed(4)),
    ffRatio: Number((ff / Math.max(1, bytes.length)).toFixed(4)),
  };
}

function collectStreamTargets(rootEntries, subTables) {
  const refs = new Map();
  function add(offset, ref) {
    if (!refs.has(offset)) refs.set(offset, []);
    refs.get(offset).push(ref);
  }
  for (const entry of rootEntries) {
    if (entry.romOffset) add(parseInt(entry.romOffset, 16), { kind: 'root-table', rootIndex: entry.index, entryOffset: entry.entryOffset });
  }
  for (const table of subTables) {
    for (const entry of table.entries) {
      add(parseInt(entry.romOffset, 16), {
        kind: 'inline-pointer-list',
        rootIndex: table.rootIndex,
        tableOffset: table.tableOffset,
        tableIndex: entry.index,
        entryOffset: entry.entryOffset,
      });
    }
  }
  return [...refs.entries()].sort((a, b) => a[0] - b[0]).map(([offset, references]) => ({ offset, references }));
}

function buildCatalog(rom, mapData) {
  const rootEntries = readRootTable(rom, mapData);
  const subTables = rootEntries
    .filter(entry => entry.romOffset)
    .map(entry => ({
      rootIndex: entry.index,
      ...readInlinePointerList(rom, mapData, parseInt(entry.romOffset, 16)),
    }));
  const streamTargets = collectStreamTargets(rootEntries, subTables);
  const region = regionRef(mapData, STREAM_BUNDLE_OFFSET);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-vdp-stream-audit.mjs',
    bankContext: {
      dataBank: 2,
      z80Window: '0x8000-0xBFFF',
      z80ToRomFormula: 'rom = z80 (bank 2 occupies ROM 0x08000-0x0BFFF in the mapped Z80 window)',
      vdpDestinationRangeObservedInCode: '0x7800-0x7D80',
    },
    bundle: {
      label: '_DATA_9AE0_',
      romRange: [hex(STREAM_BUNDLE_OFFSET), hex(STREAM_BUNDLE_END)],
      region,
      stats: byteStats(rom, STREAM_BUNDLE_OFFSET, STREAM_BUNDLE_END),
    },
    rootTable: {
      romOffset: hex(STREAM_BUNDLE_OFFSET),
      entries: rootEntries,
      evidence: [
        '_LABEL_8026_ loads _DATA_9AE0_, uses RST $08/RST $10, and stores the selected pointer table in _RAM_D15A_.',
        '_LABEL_96FE_ indexes _RAM_D15A_ by animation/state value and passes selected streams to _LABEL_972B_.',
      ],
    },
    subTables,
    streamTargets: streamTargets.map(({ offset, references }) => ({
      id: 'vdp_stream_' + offset.toString(16).toUpperCase(),
      offset: hex(offset),
      region: regionRef(mapData, offset),
      references,
    })),
    summary: {
      rootTableEntries: rootEntries.length,
      rootSelectedStreamStarts: rootEntries.filter(entry => entry.romOffset).length,
      inlinePointerProbes: subTables.length,
      inlinePointerListsWithEntries: subTables.filter(table => table.entryCount > 0).length,
      inlinePointerEntries: subTables.reduce((sum, table) => sum + table.entryCount, 0),
      uniqueStreamTargets: streamTargets.length,
      assetPolicy: 'Metadata only: offsets, pointer graph, byte statistics, and routine evidence. No ROM bytes or decoded screen data are embedded.',
    },
  };
}

function shouldBecomeVdpStream(region) {
  return ['unknown', 'screen_prog', 'raw_byte', 'data_table'].includes(region.type || 'unknown');
}

function updateBundleRegion(region) {
  const previousType = region.type || 'unknown';
  const changedType = shouldBecomeVdpStream(region) && previousType !== 'vdp_stream';
  if (changedType) region.type = 'vdp_stream';
  region.analysis = region.analysis || {};
  const existing = region.analysis.vdpStreamAudit || {};
  region.analysis.vdpStreamAudit = {
    kind: 'bank2_vdp_stream_bundle',
    summary: 'Root pointer table and stream bundle consumed by bank-2 VDP/name-table streaming routines.',
    confidence: 'high',
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    evidence: [
      '_LABEL_8026_ loads _DATA_9AE0_ and stores a selected subtable pointer in _RAM_D15A_.',
      '_LABEL_96FE_ and _LABEL_972B_ decode the selected stream; _LABEL_97D9_/_LABEL_9812_ write stream output to Port_VDPAddress/Port_VDPData.',
      'The first 12 bytes of _DATA_9AE0_ are six bank-2 Z80 pointers into the same ROM bundle.',
    ],
    generatedAt: now,
    tool: 'tools/world-vdp-stream-audit.mjs',
  };
  return changedType;
}

function annotateMap(mapData) {
  const changedRegions = [];
  const evidenceOnlyRegions = [];
  const region = findContainingRegion(mapData, STREAM_BUNDLE_OFFSET);
  if (!region) return { changedRegions, evidenceOnlyRegions, missingRegions: [{ offset: hex(STREAM_BUNDLE_OFFSET), kind: 'bank2_vdp_stream_bundle' }] };
  if (!apply) {
    const wouldChange = shouldBecomeVdpStream(region) && (region.type || 'unknown') !== 'vdp_stream';
    (wouldChange ? changedRegions : evidenceOnlyRegions).push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      currentType: region.type || 'unknown',
      inferredType: 'vdp_stream',
    });
    return { changedRegions, evidenceOnlyRegions, missingRegions: [] };
  }
  const previousType = region.type || 'unknown';
  const changed = updateBundleRegion(region);
  const item = { id: region.id, offset: region.offset, name: region.name || '', previousType, type: region.type };
  (changed ? changedRegions : evidenceOnlyRegions).push(item);
  return { changedRegions, evidenceOnlyRegions, missingRegions: [] };
}

function collectConfirmedChangedRegions(mapData) {
  return mapData.regions
    .filter(region => region.analysis?.vdpStreamAudit?.catalogId === catalogId && region.analysis.vdpStreamAudit.changedType)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType: region.analysis.vdpStreamAudit.typeBeforeAudit || 'unknown',
      type: region.type || 'unknown',
      kind: region.analysis.vdpStreamAudit.kind,
    }));
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotation = annotateMap(mapData);

  if (apply) {
    const finalCatalog = buildCatalog(rom, mapData);
    const confirmedChangedRegions = collectConfirmedChangedRegions(mapData);
    mapData.vdpStreamCatalogs = (mapData.vdpStreamCatalogs || []).filter(c => c.id !== catalogId);
    mapData.vdpStreamCatalogs.push(finalCatalog);

    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'vdp_stream_audit',
      generatedAt: now,
      tool: 'tools/world-vdp-stream-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegionTypes: confirmedChangedRegions.length,
        changedRegionTypesThisRun: annotation.changedRegions.length,
        evidenceOnlyRegions: annotation.evidenceOnlyRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      changedRegions: confirmedChangedRegions,
      changedRegionsThisRun: annotation.changedRegions,
      evidenceOnlyRegions: annotation.evidenceOnlyRegions,
      missingRegions: annotation.missingRegions,
      rootTable: finalCatalog.rootTable,
      subTableSummary: finalCatalog.subTables.map(table => ({
        rootIndex: table.rootIndex,
        tableOffset: table.tableOffset,
        entryCount: table.entryCount,
        byteLength: table.byteLength,
      })),
      streamTargetSamples: finalCatalog.streamTargets.slice(0, 32),
      nextLeads: [
        'Name the bank-2 stream opcodes handled by _LABEL_972B_ and _LABEL_97D9_, especially F1-FF control bytes.',
        'Separate stream-target classes into VDP draw streams, collision/object lists, and motion tables based on which RAM pointer receives them.',
        'Render _DATA_9AE0_ VDP streams in a read-only browser preview without embedding output graphics.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegionTypes: annotation.changedRegions.length,
    changedRegions: annotation.changedRegions,
    evidenceOnlyRegions: annotation.evidenceOnlyRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
