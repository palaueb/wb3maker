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
const catalogId = 'world-entity-animation-catalog-2026-06-24';
const reportId = 'entity-animation-audit-2026-06-24';

const ROOT_TABLE = { offset: 0x18718, count: 6, index: '_RAM_C28E_' };
const CHILD_TABLES = [
  { offset: 0x18724, count: 6, index: '_RAM_C3CF_', rootEntry: 0 },
  { offset: 0x196FB, count: 12, index: '_RAM_C3CF_', rootEntry: 1 },
  { offset: 0x19037, count: 75, index: '_RAM_C3CF_', rootEntry: 2 },
  { offset: 0x19696, count: 6, index: '_RAM_C3CF_', rootEntry: 3 },
  { offset: 0x197A8, count: 17, index: '_RAM_C3CF_', rootEntry: 4 },
  { offset: 0x198EA, count: 6, index: '_RAM_C3CF_', rootEntry: 5 },
];
const ENTITY_INIT_TABLE = { offset: 0x17D00, size: 768 };

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function bank6Z80ToRom(z80) {
  return z80 + 0x10000;
}

function isBank6Ptr(z80) {
  return z80 >= 0x8000 && z80 < 0xC000;
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

function readPointerTable(rom, mapData, def) {
  const entries = [];
  const warnings = [];
  for (let i = 0; i < def.count; i++) {
    const entryOffset = def.offset + i * 2;
    const z80Pointer = rom[entryOffset] | (rom[entryOffset + 1] << 8);
    const romOffset = isBank6Ptr(z80Pointer) ? bank6Z80ToRom(z80Pointer) : null;
    if (romOffset == null) warnings.push(`entry ${i} pointer ${hex(z80Pointer, 4)} is not a bank-6 ROM pointer`);
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

function byteStats(rom, offset, size) {
  const bytes = rom.subarray(offset, offset + size);
  let zeros = 0;
  let ff = 0;
  let terminators = 0;
  let bank6PointerWords = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) zeros++;
    if (bytes[i] === 0xFF) {
      ff++;
      terminators++;
    }
    if (i + 1 < bytes.length) {
      const word = bytes[i] | (bytes[i + 1] << 8);
      if (isBank6Ptr(word)) bank6PointerWords++;
    }
  }
  return {
    size,
    zeroBytes: zeros,
    ffBytes: ff,
    zeroRatio: Number((zeros / Math.max(1, size)).toFixed(4)),
    ffRatio: Number((ff / Math.max(1, size)).toFixed(4)),
    terminatorByteCount: terminators,
    bank6PointerLikeWordCount: bank6PointerWords,
  };
}

function parseEntityInitTable(rom, mapData) {
  const offset = ENTITY_INIT_TABLE.offset;
  const size = ENTITY_INIT_TABLE.size;
  const records = [];
  for (let i = 0; i < size / 4; i++) {
    const off = offset + i * 4;
    records.push({
      index: i,
      offset: hex(off),
      byte24: hex(rom[off], 2),
      byte25: hex(rom[off + 1], 2),
      word28_29: hex(rom[off + 2] | (rom[off + 3] << 8), 4),
      allZero: rom[off] === 0 && rom[off + 1] === 0 && rom[off + 2] === 0 && rom[off + 3] === 0,
    });
  }
  return {
    romOffset: hex(offset),
    region: regionRef(mapData, offset),
    physicalRecords: records.length,
    indexedRecordRangeFromRoutine: '0-126 from ((_ix+15) & 0x7F) - 1 in _LABEL_676D_',
    nonZeroRecords: records.filter(r => !r.allZero).length,
    recordPreview: records.slice(0, 24),
  };
}

function collectScriptOffsets(rootTable, childTables) {
  const refs = [];
  for (const table of childTables) {
    for (const entry of table.entries) {
      if (!entry.romOffset) continue;
      refs.push({
        offset: parseInt(entry.romOffset, 16),
        rootEntry: table.rootEntry,
        tableOffset: table.romOffset,
        tableIndex: entry.index,
        entryOffset: entry.entryOffset,
      });
    }
  }
  return refs;
}

function scriptSummaries(rom, mapData, refs) {
  const byOffset = new Map();
  for (const ref of refs) {
    if (!byOffset.has(ref.offset)) byOffset.set(ref.offset, []);
    byOffset.get(ref.offset).push(ref);
  }
  return [...byOffset.entries()].sort((a, b) => a[0] - b[0]).map(([offset, refsForOffset]) => {
    const region = findContainingRegion(mapData, offset);
    const start = parseInt(region?.offset || hex(offset), 16);
    const end = region ? start + (region.size || 0) : offset;
    const size = region ? (region.size || 0) : 0;
    return {
      id: 'entity_anim_script_' + offset.toString(16).toUpperCase(),
      offset: hex(offset),
      region: regionRef(mapData, offset),
      regionStart: region ? region.offset : null,
      regionSize: size,
      byteStats: region ? byteStats(rom, start, size) : null,
      references: refsForOffset.map(ref => ({
        rootEntry: ref.rootEntry,
        tableOffset: ref.tableOffset,
        tableIndex: ref.tableIndex,
        entryOffset: ref.entryOffset,
      })),
      notes: [
        '_LABEL_1347_ treats selected data as an animation command stream: delay/control byte, optional two motion words when bit7 is set, then a metasprite/frame pointer.',
        '0xFF in the stream is handled as an inline jump to another stream address.',
      ],
    };
  });
}

function buildCatalog(rom, mapData) {
  const rootTable = readPointerTable(rom, mapData, ROOT_TABLE);
  const childTables = CHILD_TABLES.map(def => readPointerTable(rom, mapData, def));
  const scriptRefs = collectScriptOffsets(rootTable, childTables);
  const scripts = scriptSummaries(rom, mapData, scriptRefs);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-entity-animation-audit.mjs',
    bankContext: {
      dataBank: 6,
      z80Window: '0x8000-0xBFFF',
      z80ToRomFormula: 'rom = z80 + 0x10000',
    },
    rootTable: {
      ...rootTable,
      label: '_DATA_18718_',
      evidence: [
        '_LABEL_1318_ loads _DATA_18718_, indexes it by (ix+14), then indexes the selected child table by (ix+15).',
        '_LABEL_137C_ also loads _DATA_18718_ for non-entity/special animation state via _RAM_C24F_.',
      ],
    },
    childTables,
    entityInitTable: parseEntityInitTable(rom, mapData),
    scripts,
    summary: {
      rootTableEntries: rootTable.entries.length,
      childTableCount: childTables.length,
      childTableEntries: childTables.reduce((sum, table) => sum + table.entries.length, 0),
      uniqueScriptTargets: scripts.length,
      entityInitRecords: ENTITY_INIT_TABLE.size / 4,
      assetPolicy: 'Metadata only: offsets, pointer graph, record counts, byte statistics, and routine evidence. No ROM bytes or decoded sprites are embedded.',
    },
  };
}

function shouldBecomeEntityAnimTable(region) {
  return ['pointer_table', 'unknown', 'raw_byte'].includes(region.type || 'unknown');
}

function shouldBecomeEntityAnimScript(region) {
  return ['unknown', 'screen_prog', 'code', 'meta_sprite'].includes(region.type || 'unknown');
}

function updateTableRegion(region, detail) {
  const previousType = region.type || 'unknown';
  const changedType = shouldBecomeEntityAnimTable(region) && previousType !== 'entity_anim_table';
  if (changedType) region.type = 'entity_anim_table';
  region.analysis = region.analysis || {};
  const existing = region.analysis.entityAnimationAudit || {};
  region.analysis.entityAnimationAudit = {
    kind: 'entity_animation_pointer_table',
    summary: 'Nested entity/special-animation pointer table consumed through _DATA_18718_ and _LABEL_1318_.',
    confidence: 'high',
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    detail,
    evidence: [
      '_LABEL_1318_ selects _DATA_18718_ by animation group, then selects a child table entry by animation index.',
      'ASM comments identify these bank-6 tables as indexed by _RAM_C28E_ and _RAM_C3CF_.',
    ],
    generatedAt: now,
    tool: 'tools/world-entity-animation-audit.mjs',
  };
  return changedType;
}

function updateScriptRegion(region, refs) {
  const previousType = region.type || 'unknown';
  const changedType = shouldBecomeEntityAnimScript(region) && previousType !== 'entity_anim_script';
  if (changedType) region.type = 'entity_anim_script';
  region.analysis = region.analysis || {};
  const existing = region.analysis.entityAnimationAudit || {};
  region.analysis.entityAnimationAudit = {
    kind: 'entity_animation_script',
    summary: 'Entity/special-animation script selected from _DATA_18718_ nested pointer tables.',
    confidence: 'high',
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    references: refs.slice(0, 24),
    evidence: [
      '_LABEL_1318_ resolves nested bank-6 pointer tables rooted at _DATA_18718_ and passes the selected stream to _LABEL_1347_.',
      '_LABEL_1347_ reads animation command bytes, handles 0xFF as a jump, and stores the frame/metasprite pointer in IX+12/IX+13.',
    ],
    generatedAt: now,
    tool: 'tools/world-entity-animation-audit.mjs',
  };
  return changedType;
}

function updateEntityInitRegion(region) {
  const previousType = region.type || 'unknown';
  const changedType = previousType !== 'entity_data';
  if (changedType) region.type = 'entity_data';
  region.analysis = region.analysis || {};
  const existing = region.analysis.entityAnimationAudit || {};
  region.analysis.entityAnimationAudit = {
    kind: 'entity_initial_motion_table',
    summary: '4-byte-per-record entity initialization/motion table indexed from (ix+15) in _LABEL_676D_.',
    confidence: 'high',
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    evidence: [
      '_LABEL_676D_ switches to bank 5, masks (ix+15), multiplies by four, and indexes _DATA_17D00_.',
      'The routine copies the first two record bytes to IX+24/IX+25 and the following word to IX+28/IX+29.',
    ],
    generatedAt: now,
    tool: 'tools/world-entity-animation-audit.mjs',
  };
  return changedType;
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const evidenceOnlyRegions = [];
  const missingRegions = [];

  const tableDefs = [
    { offset: ROOT_TABLE.offset, role: 'root', count: ROOT_TABLE.count },
    ...CHILD_TABLES.map(def => ({ offset: def.offset, role: 'child', rootEntry: def.rootEntry, count: def.count })),
  ];
  for (const table of tableDefs) {
    const region = findExactRegion(mapData, table.offset);
    if (!region) {
      missingRegions.push({ offset: hex(table.offset), kind: 'entity_animation_pointer_table' });
      continue;
    }
    if (!apply) {
      const wouldChange = shouldBecomeEntityAnimTable(region) && (region.type || 'unknown') !== 'entity_anim_table';
      (wouldChange ? changedRegions : evidenceOnlyRegions).push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType: region.type || 'unknown',
        inferredType: 'entity_anim_table',
        role: table.role,
      });
      continue;
    }
    const previousType = region.type || 'unknown';
    const changed = updateTableRegion(region, table);
    const item = { id: region.id, offset: region.offset, name: region.name || '', previousType, type: region.type, role: table.role };
    (changed ? changedRegions : evidenceOnlyRegions).push(item);
  }

  const refsByRegionId = new Map();
  for (const script of catalog.scripts) {
    if (!script.region?.id) continue;
    const region = mapData.regions.find(r => r.id === script.region.id);
    if (!region) continue;
    if (!refsByRegionId.has(region.id)) refsByRegionId.set(region.id, { region, refs: [] });
    refsByRegionId.get(region.id).refs.push(...script.references.map(ref => ({ ...ref, scriptOffset: script.offset })));
  }

  for (const { region, refs } of refsByRegionId.values()) {
    if (!apply) {
      const wouldChange = shouldBecomeEntityAnimScript(region) && (region.type || 'unknown') !== 'entity_anim_script';
      (wouldChange ? changedRegions : evidenceOnlyRegions).push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType: region.type || 'unknown',
        inferredType: 'entity_anim_script',
        referenceCount: refs.length,
      });
      continue;
    }
    const previousType = region.type || 'unknown';
    const changed = updateScriptRegion(region, refs);
    const item = { id: region.id, offset: region.offset, name: region.name || '', previousType, type: region.type, referenceCount: refs.length };
    (changed ? changedRegions : evidenceOnlyRegions).push(item);
  }

  const initRegion = findExactRegion(mapData, ENTITY_INIT_TABLE.offset);
  if (!initRegion) {
    missingRegions.push({ offset: hex(ENTITY_INIT_TABLE.offset), kind: 'entity_initial_motion_table' });
  } else if (!apply) {
    const wouldChange = (initRegion.type || 'unknown') !== 'entity_data';
    (wouldChange ? changedRegions : evidenceOnlyRegions).push({
      id: initRegion.id,
      offset: initRegion.offset,
      name: initRegion.name || '',
      currentType: initRegion.type || 'unknown',
      inferredType: 'entity_data',
    });
  } else {
    const previousType = initRegion.type || 'unknown';
    const changed = updateEntityInitRegion(initRegion);
    const item = { id: initRegion.id, offset: initRegion.offset, name: initRegion.name || '', previousType, type: initRegion.type };
    (changed ? changedRegions : evidenceOnlyRegions).push(item);
  }

  return { changedRegions, evidenceOnlyRegions, missingRegions };
}

function collectConfirmedChangedRegions(mapData) {
  return mapData.regions
    .filter(region => region.analysis?.entityAnimationAudit?.catalogId === catalogId && region.analysis.entityAnimationAudit.changedType)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType: region.analysis.entityAnimationAudit.typeBeforeAudit || 'unknown',
      type: region.type || 'unknown',
      kind: region.analysis.entityAnimationAudit.kind,
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
    mapData.entityAnimationCatalogs = (mapData.entityAnimationCatalogs || []).filter(c => c.id !== catalogId);
    mapData.entityAnimationCatalogs.push(finalCatalog);

    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'entity_animation_audit',
      generatedAt: now,
      tool: 'tools/world-entity-animation-audit.mjs --apply',
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
      evidenceOnlyRegions: annotation.evidenceOnlyRegions.slice(0, 160),
      missingRegions: annotation.missingRegions,
      rootTable: finalCatalog.rootTable,
      childTableSummary: finalCatalog.childTables.map(table => ({
        romOffset: table.romOffset,
        rootEntry: table.rootEntry,
        count: table.count,
        uniqueTargetCount: new Set(table.entries.map(e => e.romOffset).filter(Boolean)).size,
      })),
      scriptSamples: finalCatalog.scripts.slice(0, 24),
      nextLeads: [
        'Decode _LABEL_1347_ command semantics into named frame-delay, motion-vector, jump, and metasprite-pointer operations.',
        'Resolve the bank-6 frame/metasprite pointers in entity_anim_script streams against sprite tile data and OAM layout.',
        'Cross-link _RAM_C28E_, _RAM_C3CF_, and IX entity slots with the behavior jump table at 0x668E.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegionTypes: annotation.changedRegions.length,
    changedRegions: annotation.changedRegions.slice(0, 120),
    evidenceOnlyRegions: annotation.evidenceOnlyRegions.slice(0, 40),
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
