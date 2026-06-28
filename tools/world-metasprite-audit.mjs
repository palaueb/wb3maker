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
const catalogId = 'world-metasprite-catalog-2026-06-24';
const reportId = 'metasprite-audit-2026-06-24';

const BANK6_ROM_START = 0x18000;
const BANK6_ROM_END = 0x1BFFF;
const ROOT_TABLE = { offset: 0x18718, count: 6, index: '(ix+14)' };
const CHILD_TABLES = [
  { offset: 0x18724, count: 6, index: '(ix+15)', rootEntry: 0 },
  { offset: 0x196FB, count: 12, index: '(ix+15)', rootEntry: 1 },
  { offset: 0x19037, count: 75, index: '(ix+15)', rootEntry: 2 },
  { offset: 0x19696, count: 6, index: '(ix+15)', rootEntry: 3 },
  { offset: 0x197A8, count: 17, index: '(ix+15)', rootEntry: 4 },
  { offset: 0x198EA, count: 6, index: '(ix+15)', rootEntry: 5 },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readWord(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function isBank6Ptr(z80) {
  return z80 >= 0x8000 && z80 < 0xC000;
}

function bank6Z80ToRom(z80) {
  return z80 + 0x10000;
}

function isBank6RomOffset(offset) {
  return offset >= BANK6_ROM_START && offset <= BANK6_ROM_END;
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(r => {
    const start = parseInt(r.offset, 16);
    return offset >= start && offset < start + (r.size || 0);
  }) || null;
}

function findContainingRegions(mapData, offset) {
  return mapData.regions.filter(r => {
    const start = parseInt(r.offset, 16);
    return offset >= start && offset < start + (r.size || 0);
  });
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

function byteStats(rom, start, size) {
  const bytes = rom.subarray(start, start + size);
  let zeros = 0;
  let ff = 0;
  let bank6PointerWords = 0;
  let likelyFrameMarkers = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) zeros++;
    if (bytes[i] === 0xFF) ff++;
    if (bytes[i] >= 0x80 && bytes[i] <= 0x8F) likelyFrameMarkers++;
    if (i + 1 < bytes.length && isBank6Ptr(readWord(bytes, i))) bank6PointerWords++;
  }
  return {
    size,
    zeroBytes: zeros,
    ffBytes: ff,
    zeroRatio: Number((zeros / Math.max(1, size)).toFixed(4)),
    ffRatio: Number((ff / Math.max(1, size)).toFixed(4)),
    bank6PointerLikeWordCount: bank6PointerWords,
    likelyFrameMarkerByteCount: likelyFrameMarkers,
  };
}

function readPointerTable(rom, mapData, def) {
  const entries = [];
  const warnings = [];
  for (let i = 0; i < def.count; i++) {
    const entryOffset = def.offset + i * 2;
    const z80Pointer = readWord(rom, entryOffset);
    const romOffset = isBank6Ptr(z80Pointer) ? bank6Z80ToRom(z80Pointer) : null;
    if (romOffset == null || !isBank6RomOffset(romOffset)) {
      warnings.push(`entry ${i} pointer ${hex(z80Pointer, 4)} is not a bank-6 ROM pointer`);
    }
    entries.push({
      index: i,
      entryOffset: hex(entryOffset),
      z80Pointer: hex(z80Pointer, 4),
      romOffset: romOffset == null ? null : hex(romOffset),
      region: romOffset == null ? null : regionRef(mapData, romOffset),
    });
  }
  return {
    romOffset: hex(def.offset),
    count: def.count,
    index: def.index,
    rootEntry: def.rootEntry,
    entries,
    warnings,
  };
}

function readVariantTable(rom, mapData, offset) {
  const entries = [];
  let pos = offset;
  while (pos + 1 < rom.length && entries.length < 128) {
    const z80Pointer = readWord(rom, pos);
    const romOffset = isBank6Ptr(z80Pointer) ? bank6Z80ToRom(z80Pointer) : null;
    if (romOffset == null || !isBank6RomOffset(romOffset)) break;
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
    region: regionRef(mapData, offset),
    entries,
  };
}

function collectVariantTables(rom, mapData, childTables) {
  const byOffset = new Map();
  const directScriptRefs = [];
  for (const childTable of childTables) {
    for (const childEntry of childTable.entries) {
      if (!childEntry.romOffset) continue;
      const offset = parseInt(childEntry.romOffset, 16);
      const variantTable = readVariantTable(rom, mapData, offset);
      const ref = {
        rootEntry: childTable.rootEntry,
        childTableOffset: childTable.romOffset,
        childIndex: childEntry.index,
        childEntryOffset: childEntry.entryOffset,
      };
      if (variantTable.entryCount > 0) {
        const key = variantTable.tableOffset;
        if (!byOffset.has(key)) byOffset.set(key, { ...variantTable, references: [] });
        byOffset.get(key).references.push(ref);
      } else {
        directScriptRefs.push({ offset, references: [ref] });
      }
    }
  }
  return {
    variantTables: [...byOffset.values()].sort((a, b) => parseInt(a.tableOffset, 16) - parseInt(b.tableOffset, 16)),
    directScriptRefs,
  };
}

function collectScriptStarts(variantTables, directScriptRefs) {
  const byOffset = new Map();
  function add(offset, reference) {
    if (!byOffset.has(offset)) byOffset.set(offset, []);
    byOffset.get(offset).push(reference);
  }
  for (const table of variantTables) {
    for (const entry of table.entries) {
      add(parseInt(entry.romOffset, 16), {
        kind: 'variant-table-entry',
        tableOffset: table.tableOffset,
        tableIndex: entry.index,
        entryOffset: entry.entryOffset,
      });
    }
  }
  for (const direct of directScriptRefs) {
    for (const ref of direct.references) {
      add(direct.offset, { kind: 'direct-child-entry', ...ref });
    }
  }
  return [...byOffset.entries()].sort((a, b) => a[0] - b[0]).map(([offset, references]) => ({ offset, references }));
}

function parseCommandStream(rom, mapData, startOffset) {
  const commands = [];
  const frameTargets = [];
  const jumps = [];
  const warnings = [];
  const visited = new Set();
  let pos = startOffset;
  for (let commandIndex = 0; commandIndex < 128; commandIndex++) {
    if (!isBank6RomOffset(pos) || pos >= rom.length) {
      warnings.push(`stream left bank-6 ROM range at ${hex(pos)}`);
      break;
    }
    if (visited.has(pos)) {
      warnings.push(`loop detected at ${hex(pos)}`);
      break;
    }
    visited.add(pos);
    const commandOffset = pos;
    const control = rom[pos++];
    if (control === 0xFF) {
      if (pos + 1 >= rom.length) {
        warnings.push(`truncated jump at ${hex(commandOffset)}`);
        break;
      }
      const z80Pointer = readWord(rom, pos);
      pos += 2;
      const romOffset = isBank6Ptr(z80Pointer) ? bank6Z80ToRom(z80Pointer) : null;
      jumps.push({
        commandOffset: hex(commandOffset),
        z80Pointer: hex(z80Pointer, 4),
        romOffset: romOffset == null ? null : hex(romOffset),
        region: romOffset == null ? null : regionRef(mapData, romOffset),
      });
      if (romOffset == null || !isBank6RomOffset(romOffset)) {
        warnings.push(`jump ${hex(z80Pointer, 4)} at ${hex(commandOffset)} is not a bank-6 ROM pointer`);
        break;
      }
      pos = romOffset;
      continue;
    }

    const hasMotionWords = (control & 0x80) !== 0;
    const detail = {
      index: commands.length,
      offset: hex(commandOffset),
      delay: control & 0x7F,
      hasMotionWords,
    };
    if (hasMotionWords) {
      if (pos + 3 >= rom.length) {
        warnings.push(`truncated motion words at ${hex(commandOffset)}`);
        break;
      }
      detail.motionWordCount = 2;
      pos += 4;
    } else {
      detail.motionWordCount = 0;
    }

    if (pos + 1 >= rom.length) {
      warnings.push(`truncated frame pointer at ${hex(commandOffset)}`);
      break;
    }
    const framePointerOffset = pos;
    const z80Pointer = readWord(rom, pos);
    pos += 2;
    const romOffset = isBank6Ptr(z80Pointer) ? bank6Z80ToRom(z80Pointer) : null;
    detail.framePointer = {
      pointerOffset: hex(framePointerOffset),
      z80Pointer: hex(z80Pointer, 4),
      romOffset: romOffset == null ? null : hex(romOffset),
      region: romOffset == null ? null : regionRef(mapData, romOffset),
    };
    commands.push(detail);
    if (romOffset != null && isBank6RomOffset(romOffset)) {
      frameTargets.push({
        sourceCommandOffset: hex(commandOffset),
        pointerOffset: hex(framePointerOffset),
        z80Pointer: hex(z80Pointer, 4),
        romOffset,
        region: regionRef(mapData, romOffset),
      });
    } else {
      warnings.push(`frame pointer ${hex(z80Pointer, 4)} at ${hex(framePointerOffset)} is not a bank-6 ROM pointer`);
    }
  }
  return {
    startOffset: hex(startOffset),
    commandCount: commands.length,
    jumpCount: jumps.length,
    frameTargetCount: frameTargets.length,
    commandSamples: commands.slice(0, 12),
    jumpSamples: jumps.slice(0, 12),
    frameTargets,
    warnings: warnings.slice(0, 16),
  };
}

function frameTargetSummary(mapData, frameTargets) {
  const byOffset = new Map();
  for (const target of frameTargets) {
    if (!byOffset.has(target.romOffset)) byOffset.set(target.romOffset, []);
    byOffset.get(target.romOffset).push({
      sourceScriptOffset: target.sourceScriptOffset,
      sourceCommandOffset: target.sourceCommandOffset,
      pointerOffset: target.pointerOffset,
      z80Pointer: target.z80Pointer,
    });
  }
  return [...byOffset.entries()].sort((a, b) => a[0] - b[0]).map(([offset, references]) => ({
    id: 'metasprite_frame_' + offset.toString(16).toUpperCase(),
    offset: hex(offset),
    region: regionRef(mapData, offset),
    referenceCount: references.length,
    references: references.slice(0, 12),
  }));
}

function targetRegions(mapData, rom, frameTargets) {
  const byRegion = new Map();
  for (const target of frameTargets) {
    const regions = findContainingRegions(mapData, target.romOffset);
    for (const region of regions) {
      if (!byRegion.has(region.id)) {
      const start = parseInt(region.offset, 16);
      byRegion.set(region.id, {
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        type: region.type || 'unknown',
        size: region.size || 0,
        stats: byteStats(rom, start, region.size || 0),
        targetOffsets: new Set(),
        referenceCount: 0,
      });
      }
      const item = byRegion.get(region.id);
      item.targetOffsets.add(hex(target.romOffset));
      item.referenceCount++;
    }
  }
  return [...byRegion.values()]
    .sort((a, b) => parseInt(a.offset, 16) - parseInt(b.offset, 16))
    .map(item => ({
      ...item,
      targetOffsets: [...item.targetOffsets].sort(),
    }));
}

function buildCatalog(rom, mapData) {
  const rootTable = readPointerTable(rom, mapData, ROOT_TABLE);
  const childTables = CHILD_TABLES.map(def => readPointerTable(rom, mapData, def));
  const { variantTables, directScriptRefs } = collectVariantTables(rom, mapData, childTables);
  const scriptStarts = collectScriptStarts(variantTables, directScriptRefs);
  const parsedStreams = scriptStarts.map(script => {
    const parsed = parseCommandStream(rom, mapData, script.offset);
    for (const target of parsed.frameTargets) target.sourceScriptOffset = hex(script.offset);
    return {
      id: 'entity_command_stream_' + script.offset.toString(16).toUpperCase(),
      offset: hex(script.offset),
      region: regionRef(mapData, script.offset),
      references: script.references,
      ...parsed,
    };
  });
  const allFrameTargets = parsedStreams.flatMap(script => script.frameTargets);
  const uniqueFrameTargets = frameTargetSummary(mapData, allFrameTargets);
  const targetRegionSummaries = targetRegions(mapData, rom, allFrameTargets);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-metasprite-audit.mjs',
    bankContext: {
      dataBank: 6,
      z80Window: '0x8000-0xBFFF',
      z80ToRomFormula: 'rom = z80 + 0x10000',
    },
    rootTable: {
      ...rootTable,
      label: '_DATA_18718_',
      evidence: [
        '_LABEL_1318_ loads _DATA_18718_, indexes by (ix+14), indexes the child table by (ix+15), then indexes the selected variant table by the caller-provided animation state.',
        '_LABEL_1347_ decodes the selected command stream and stores each frame/metasprite pointer into (ix+12)/(ix+13).',
      ],
    },
    childTables,
    variantTables,
    directScriptRefs,
    parsedStreams,
    frameTargets: uniqueFrameTargets,
    targetRegions: targetRegionSummaries,
    summary: {
      childTableEntries: childTables.reduce((sum, table) => sum + table.entries.length, 0),
      variantTables: variantTables.length,
      variantTableEntries: variantTables.reduce((sum, table) => sum + table.entryCount, 0),
      directScriptStarts: directScriptRefs.length,
      parsedCommandStreams: parsedStreams.length,
      parsedCommands: parsedStreams.reduce((sum, stream) => sum + stream.commandCount, 0),
      framePointerReferences: allFrameTargets.length,
      uniqueFrameTargets: uniqueFrameTargets.length,
      targetRegions: targetRegionSummaries.length,
      warningStreams: parsedStreams.filter(stream => stream.warnings.length).length,
      assetPolicy: 'Metadata only: offsets, pointer graph, parser counts, and routine evidence. No ROM bytes or decoded sprites are embedded.',
    },
  };
}

function shouldBecomeMetaSprite(region) {
  return ['unknown', 'screen_prog', 'raw_byte', 'data_table', 'tile_map'].includes(region.type || 'unknown');
}

function updateRegion(region, detail) {
  const previousType = region.type || 'unknown';
  const changedType = shouldBecomeMetaSprite(region) && previousType !== 'meta_sprite';
  if (changedType) region.type = 'meta_sprite';
  region.analysis = region.analysis || {};
  const existing = region.analysis.metaspriteAudit || {};
  region.analysis.metaspriteAudit = {
    kind: 'bank6_metasprite_frame_data',
    summary: 'Bank-6 frame/metasprite target data referenced by entity animation command streams.',
    confidence: 'high',
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    detail,
    evidence: [
      '_LABEL_1318_ selects the animation command stream through _DATA_18718_ and child/variant pointer tables.',
      '_LABEL_1347_ reads a frame/metasprite pointer from each command stream and stores it into (ix+12)/(ix+13).',
      'All stored target pointers use the bank-6 Z80 window, mapped here as rom = z80 + 0x10000.',
    ],
    generatedAt: now,
    tool: 'tools/world-metasprite-audit.mjs',
  };
  return changedType;
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const evidenceOnlyRegions = [];
  const missingRegions = [];
  for (const targetRegion of catalog.targetRegions) {
    const region = mapData.regions.find(r => r.id === targetRegion.id);
    if (!region) {
      missingRegions.push(targetRegion);
      continue;
    }
    const wouldChange = shouldBecomeMetaSprite(region) && (region.type || 'unknown') !== 'meta_sprite';
    const item = {
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      currentType: region.type || 'unknown',
      inferredType: 'meta_sprite',
      referenceCount: targetRegion.referenceCount,
      uniqueTargetOffsets: targetRegion.targetOffsets.length,
    };
    if (!apply) {
      (wouldChange ? changedRegions : evidenceOnlyRegions).push(item);
      continue;
    }
    const previousType = region.type || 'unknown';
    const changed = updateRegion(region, {
      referenceCount: targetRegion.referenceCount,
      targetOffsets: targetRegion.targetOffsets.slice(0, 64),
      stats: targetRegion.stats,
    });
    const appliedItem = {
      ...item,
      previousType,
      type: region.type || 'unknown',
    };
    (changed ? changedRegions : evidenceOnlyRegions).push(appliedItem);
  }
  return { changedRegions, evidenceOnlyRegions, missingRegions };
}

function collectConfirmedChangedRegions(mapData) {
  return mapData.regions
    .filter(region => region.analysis?.metaspriteAudit?.catalogId === catalogId && region.analysis.metaspriteAudit.changedType)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType: region.analysis.metaspriteAudit.typeBeforeAudit || 'unknown',
      type: region.type || 'unknown',
      kind: region.analysis.metaspriteAudit.kind,
    }));
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(rom, mapData);
    const confirmedChangedRegions = collectConfirmedChangedRegions(mapData);
    mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(c => c.id !== catalogId);
    mapData.metaspriteCatalogs.push(finalCatalog);

    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'metasprite_audit',
      generatedAt: now,
      tool: 'tools/world-metasprite-audit.mjs --apply',
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
      targetRegions: finalCatalog.targetRegions,
      frameTargetSamples: finalCatalog.frameTargets.slice(0, 48),
      variantTableSummary: finalCatalog.variantTables.map(table => ({
        tableOffset: table.tableOffset,
        entryCount: table.entryCount,
        byteLength: table.byteLength,
        references: table.references,
      })),
      nextLeads: [
        'Name the metasprite frame record format used by the bank-6 target data and distinguish frame headers from piece records.',
        'Split large bank-6 metasprite bundles at confirmed frame-target boundaries where region boundaries are currently too coarse.',
        'Update the entity animation audit so child targets with variant-table prefixes are typed as entity_anim_table, while selected streams remain entity_anim_script.',
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
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
