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
const catalogId = 'world-screen-prog-catalog-2026-06-24';
const reportId = 'screen-prog-audit-2026-06-24';

const COLS = 32;
const ROWS = 28;
const NT_BASE = 0x3800;

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function bankOf(offset) {
  return Math.floor(offset / 0x4000);
}

function regionBounds(region) {
  const start = parseInt(region.offset, 16);
  return { start, end: start + (region.size || 0) };
}

function regionRef(region) {
  return {
    id: region.id,
    name: region.name || '',
    type: region.type || 'unknown',
    offset: region.offset,
    size: region.size || 0,
  };
}

function vdpCtrlWordToVram(vdp16) {
  return vdp16 & 0x3FFF;
}

function z80ToRom(z80, bank8000) {
  if (z80 < 0x8000) return z80;
  if (z80 < 0xC000) return bank8000 * 0x4000 + (z80 - 0x8000);
  return -1;
}

function posFromVram(addr) {
  const cell = (addr - NT_BASE) >> 1;
  return {
    cell,
    col: cell % COLS,
    row: Math.floor(cell / COLS),
    inBounds: cell >= 0 && cell < COLS * ROWS,
  };
}

function countWrite(stats, addr, attr) {
  const pos = posFromVram(addr);
  if (!pos.inBounds) {
    stats.outOfBoundsWrites++;
    return;
  }
  const key = String(pos.cell);
  if (!stats.writtenCellsSet.has(key)) {
    stats.writtenCellsSet.add(key);
    if (pos.col < stats.minCol) stats.minCol = pos.col;
    if (pos.col > stats.maxCol) stats.maxCol = pos.col;
    if (pos.row < stats.minRow) stats.minRow = pos.row;
    if (pos.row > stats.maxRow) stats.maxRow = pos.row;
  }
  if (attr & 0x08) stats.sprWrites++;
  else stats.bgWrites++;
}

function bump(map, key, amount = 1) {
  map[key] = (map[key] || 0) + amount;
}

function markVisited(state, start, len) {
  for (let i = 0; i < len; i++) {
    const off = start + i;
    if (off < 0 || off >= state.romLength) continue;
    state.visited.add(off);
  }
}

function decodeScreenProg(rom, region) {
  const bounds = regionBounds(region);
  const bank8000 = bankOf(bounds.start);
  const warnings = [];
  const opCounts = {};
  const jumpTargets = [];
  const state = {
    romLength: rom.length,
    visited: new Set(),
  };
  const stats = {
    ops: 0,
    directWrites: 0,
    literalWrites: 0,
    fillWrites: 0,
    rowPrefillWrites: 0,
    bgWrites: 0,
    sprWrites: 0,
    outOfBoundsWrites: 0,
    writtenCellsSet: new Set(),
    minCol: COLS,
    minRow: ROWS,
    maxCol: -1,
    maxRow: -1,
  };
  const pcVisits = new Map();
  let pc = bounds.start;
  let storedVDPaddr = 0x7800;
  let vramAddr = NT_BASE;
  let currentAttr = 0;
  let endReason = 'Reached max ops';
  let terminated = false;
  let maxOps = 4096;

  function readByte() {
    if (pc >= rom.length) return null;
    return rom[pc++];
  }

  while (pc < rom.length && stats.ops < maxOps) {
    const visits = (pcVisits.get(pc) || 0) + 1;
    pcVisits.set(pc, visits);
    if (visits > 64) {
      endReason = `Loop guard at ${hex(pc)}`;
      warnings.push(endReason);
      break;
    }
    const start = pc;
    const b = readByte();
    if (b == null) {
      endReason = 'Unexpected EOF';
      warnings.push(endReason);
      break;
    }
    markVisited(state, start, 1);
    stats.ops++;

    if (b < 0xF0) {
      bump(opCounts, 'tile');
      countWrite(stats, vramAddr, currentAttr);
      stats.directWrites++;
      vramAddr += 2;
      continue;
    }

    switch (b & 0x07) {
      case 0:
        bump(opCounts, 'end');
        endReason = `${hex(b, 2)} END @ ${hex(start)}`;
        terminated = true;
        pc = rom.length;
        break;
      case 1: {
        bump(opCounts, 'attr');
        const attr = readByte();
        if (attr == null) {
          endReason = `${hex(b, 2)} attr truncated @ ${hex(start)}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(state, start + 1, 1);
        currentAttr = attr;
        break;
      }
      case 2: {
        bump(opCounts, 'addr');
        const lo = readByte();
        const hi = readByte();
        if (lo == null || hi == null) {
          endReason = `${hex(b, 2)} addr truncated @ ${hex(start)}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(state, start + 1, 2);
        storedVDPaddr = lo | (hi << 8);
        vramAddr = vdpCtrlWordToVram(storedVDPaddr);
        break;
      }
      case 3: {
        bump(opCounts, 'literal');
        const tile = readByte();
        if (tile == null) {
          endReason = `${hex(b, 2)} literal truncated @ ${hex(start)}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(state, start + 1, 1);
        countWrite(stats, vramAddr, currentAttr);
        stats.literalWrites++;
        vramAddr += 2;
        break;
      }
      case 4: {
        bump(opCounts, 'jump');
        const lo = readByte();
        const hi = readByte();
        if (lo == null || hi == null) {
          endReason = `${hex(b, 2)} jump truncated @ ${hex(start)}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(state, start + 1, 2);
        const z80 = lo | (hi << 8);
        const target = z80ToRom(z80, bank8000);
        jumpTargets.push({
          from: hex(start),
          z80: hex(z80, 4),
          romTarget: target < 0 ? null : hex(target),
        });
        if (target < 0 || target >= rom.length) {
          endReason = `${hex(b, 2)} jump out of range @ ${hex(start)}`;
          warnings.push(endReason);
          pc = rom.length;
        } else {
          pc = target;
        }
        break;
      }
      case 5: {
        bump(opCounts, 'fill');
        const count = readByte();
        const tile = readByte();
        if (count == null || tile == null) {
          endReason = `${hex(b, 2)} fill truncated @ ${hex(start)}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(state, start + 1, 2);
        for (let i = 0; i < count; i++) {
          countWrite(stats, vramAddr, currentAttr);
          stats.fillWrites++;
          vramAddr += 2;
        }
        break;
      }
      case 6: {
        bump(opCounts, 'row');
        storedVDPaddr = (storedVDPaddr + 0x0040) & 0xFFFF;
        if ((storedVDPaddr >> 8) >= 0x7F) storedVDPaddr = (storedVDPaddr & 0x00FF) | 0x7800;
        vramAddr = vdpCtrlWordToVram(storedVDPaddr);
        for (let i = 0; i < COLS; i++) {
          countWrite(stats, vramAddr + i * 2, 0x08);
          stats.rowPrefillWrites++;
        }
        break;
      }
      case 7:
        bump(opCounts, 'noop7');
        break;
    }
  }

  if (stats.ops >= maxOps && !terminated) warnings.push(endReason);
  const visited = [...state.visited].sort((a, b) => a - b);
  const outsideVisited = visited.filter(offset => offset < bounds.start || offset >= bounds.end);
  const bbox = stats.writtenCellsSet.size ? {
    minCol: stats.minCol,
    minRow: stats.minRow,
    maxCol: stats.maxCol,
    maxRow: stats.maxRow,
  } : null;

  return {
    bank8000,
    terminated,
    endReason,
    warnings,
    opCounts,
    jumpTargets,
    visitedRange: visited.length ? {
      start: hex(visited[0]),
      endInclusive: hex(visited[visited.length - 1]),
      visitedBytes: visited.length,
      outsideRegionBytes: outsideVisited.length,
    } : null,
    stats: {
      ops: stats.ops,
      writtenCells: stats.writtenCellsSet.size,
      bgWrites: stats.bgWrites,
      sprWrites: stats.sprWrites,
      directWrites: stats.directWrites,
      literalWrites: stats.literalWrites,
      fillWrites: stats.fillWrites,
      rowPrefillWrites: stats.rowPrefillWrites,
      outOfBoundsWrites: stats.outOfBoundsWrites,
      jumps: jumpTargets.length,
      bbox,
    },
  };
}

function buildCatalog(rom, mapData) {
  const screenRegions = mapData.regions
    .filter(region => region.type === 'screen_prog')
    .sort((a, b) => parseInt(a.offset, 16) - parseInt(b.offset, 16));
  const entries = screenRegions.map(region => {
    const decoded = decodeScreenProg(rom, region);
    const confidence = decoded.warnings.length
      ? 'low'
      : decoded.visitedRange?.outsideRegionBytes
        ? 'medium'
        : 'high';
    return {
      id: `${region.id}_screen_prog_${parseInt(region.offset, 16).toString(16).toUpperCase()}`,
      region: regionRef(region),
      confidence,
      decoder: '_LABEL_604_',
      bank8000: decoded.bank8000,
      terminated: decoded.terminated,
      endReason: decoded.endReason,
      stats: decoded.stats,
      opCounts: decoded.opCounts,
      visitedRange: decoded.visitedRange,
      jumpTargets: decoded.jumpTargets,
      warnings: decoded.warnings,
      evidence: [
        'Region is typed screen_prog and decoded with the _LABEL_604_ screen/name-table bytecode model.',
        'Catalog stores only offsets, counts, jump targets, bounding boxes, and warnings; it does not store tile ids or rendered screen data.',
      ],
    };
  });
  const summary = entries.reduce((acc, entry) => {
    acc.regions++;
    acc.totalOps += entry.stats.ops || 0;
    acc.totalWrittenCells += entry.stats.writtenCells || 0;
    if (entry.terminated) acc.terminated++;
    if (entry.warnings.length) acc.withWarnings++;
    if (entry.visitedRange?.outsideRegionBytes) acc.withOutsideRegionVisits++;
    acc.confidenceCounts[entry.confidence] = (acc.confidenceCounts[entry.confidence] || 0) + 1;
    return acc;
  }, {
    regions: 0,
    terminated: 0,
    withWarnings: 0,
    withOutsideRegionVisits: 0,
    totalOps: 0,
    totalWrittenCells: 0,
    confidenceCounts: {},
    assetPolicy: 'Metadata only: screen bytecode offsets, operation counts, write counts, jump targets, bounding boxes, and warnings. No ROM bytes, tile ids, or rendered screen data are embedded.',
  });
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-screen-prog-audit.mjs',
    summary,
    entries,
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  for (const entry of catalog.entries) {
    const region = mapData.regions.find(r => r.id === entry.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.screenProgAudit = {
      catalogId,
      kind: 'screen_prog_decode_summary',
      summary: `${entry.stats.ops} op(s), ${entry.stats.writtenCells} written cell(s), ${entry.warnings.length} warning(s).`,
      confidence: entry.confidence,
      decoder: entry.decoder,
      bank8000: entry.bank8000,
      terminated: entry.terminated,
      endReason: entry.endReason,
      stats: entry.stats,
      opCounts: entry.opCounts,
      visitedRange: entry.visitedRange,
      jumpTargetCount: entry.jumpTargets.length,
      warningCount: entry.warnings.length,
      evidence: entry.evidence,
      generatedAt: now,
      tool: 'tools/world-screen-prog-audit.mjs',
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      confidence: entry.confidence,
      ops: entry.stats.ops,
      writtenCells: entry.stats.writtenCells,
      warnings: entry.warnings.length,
      outsideRegionBytes: entry.visitedRange?.outsideRegionBytes || 0,
    });
  }
  return annotated;
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotatedRegions = apply
    ? annotateMap(mapData, catalog)
    : catalog.entries.map(entry => ({
      id: entry.region.id,
      offset: entry.region.offset,
      name: entry.region.name,
      confidence: entry.confidence,
      ops: entry.stats.ops,
      writtenCells: entry.stats.writtenCells,
      warnings: entry.warnings.length,
      outsideRegionBytes: entry.visitedRange?.outsideRegionBytes || 0,
    }));

  if (apply) {
    mapData.screenProgCatalogs = (mapData.screenProgCatalogs || []).filter(c => c.id !== catalogId);
    mapData.screenProgCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'screen_prog_audit',
      generatedAt: now,
      tool: 'tools/world-screen-prog-audit.mjs --apply',
      schemaVersion: 1,
      summary: catalog.summary,
      annotatedRegions,
      warningRegions: catalog.entries
        .filter(entry => entry.warnings.length)
        .map(entry => ({
          region: entry.region,
          warnings: entry.warnings,
          endReason: entry.endReason,
          stats: entry.stats,
        })),
      outsideRegionVisitRegions: catalog.entries
        .filter(entry => entry.visitedRange?.outsideRegionBytes)
        .map(entry => ({
          region: entry.region,
          visitedRange: entry.visitedRange,
          jumpTargets: entry.jumpTargets,
        })),
      nextLeads: [
        'Inspect low-confidence screen_prog regions to separate real bytecode from mixed tables or false positives.',
        'Use visitedRange and jumpTargets to split shared screen bytecode tails without duplicating bytes.',
        'Feed clean high-confidence screen_prog summaries into sceneRecipes so recipes can declare screen bytecode dependencies independently of rendered assets.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions,
    warningRegions: catalog.entries
      .filter(entry => entry.warnings.length)
      .map(entry => ({ id: entry.region.id, offset: entry.region.offset, name: entry.region.name, warnings: entry.warnings })),
    outsideRegionVisitRegions: catalog.entries
      .filter(entry => entry.visitedRange?.outsideRegionBytes)
      .map(entry => ({ id: entry.region.id, offset: entry.region.offset, name: entry.region.name, visitedRange: entry.visitedRange })),
  }, null, 2));
}

main();
