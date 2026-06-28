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
const catalogId = 'world-entity-behavior-catalog-2026-06-24';
const reportId = 'entity-behavior-audit-2026-06-24';

const DISPATCHER = {
  label: '_LABEL_667C_ update tail',
  selector: 'IX+32 low nibble',
  tablePointer: 'IX+38/IX+39',
  evidence: [
    'The entity update tail before _LABEL_667C_ masks IX+32 with $0F, adds 2 * state to IX+38/IX+39, reads a word from that table, and jumps with JP (HL).',
    '_LABEL_667C_ initializes entities through the _DATA_668E_ jump table indexed by (IX+15 & $7F) - 1; those handlers store these behavior table addresses in IX+38/IX+39.',
  ],
};

const BEHAVIOR_TABLES = [
  { offset: 0x0696A, label: '_DATA_696A_', count: 5, setup: '_LABEL_6927_/_LABEL_692B_/_LABEL_692F_', role: 'entity_behavior_table_variant_1' },
  { offset: 0x069BC, label: '_DATA_69BC_', count: 1, setup: '_LABEL_6974_/_LABEL_69E1_', role: 'entity_behavior_table_variant_7_prefix' },
  { offset: 0x069F9, label: '_DATA_69FB_ - 2', count: 1, setup: '_LABEL_69E1_', role: 'entity_behavior_table_prefix' },
  { offset: 0x06A47, label: '_DATA_6A47_', count: 1, setup: '_LABEL_6A23_', role: 'entity_behavior_table_variant_57' },
  { offset: 0x06A73, label: '_DATA_6A73_', count: 6, setup: '_LABEL_6A49_', role: 'entity_behavior_table_variant_4' },
  { offset: 0x06AAD, label: '_DATA_6AAD_', count: 4, setup: '_LABEL_6A7F_', role: 'entity_behavior_table_variant_9' },
  { offset: 0x06ABE, label: '_DATA_6ABE_', count: 5, setup: '_LABEL_6AB5_', role: 'entity_behavior_table_variant_12' },
  { offset: 0x06AFA, label: '_DATA_6AFA_', count: 5, setup: '_LABEL_6AC8_', role: 'entity_behavior_table_variant_13' },
  { offset: 0x06B0D, label: '_DATA_6B0D_', count: 5, setup: '_LABEL_6B04_', role: 'entity_behavior_table_variant_16' },
  { offset: 0x06B42, label: '_DATA_6B42_', count: 5, setup: '_LABEL_6B17_/_LABEL_6B4C_', role: 'entity_behavior_table_variant_14_15' },
  { offset: 0x06BAD, label: '_DATA_6BAD_', count: 6, setup: '_LABEL_6B76_/_LABEL_6B7A_/_LABEL_6B7E_', role: 'entity_behavior_table_variant_17_19' },
  { offset: 0x06BDB, label: '_DATA_6BDB_', count: 5, setup: '_LABEL_6BB9_', role: 'entity_behavior_table_variant_20' },
  { offset: 0x06C3B, label: '_DATA_6C3B_', count: 5, setup: '_LABEL_6BE5_/_LABEL_6BF7_/_LABEL_6C09_', role: 'entity_behavior_table_variant_23_25' },
  { offset: 0x06C7B, label: '_DATA_6C7B_', count: 5, setup: '_LABEL_6C45_/_LABEL_6C4F_/_LABEL_6C59_', role: 'entity_behavior_table_variant_26_28' },
  { offset: 0x06CA3, label: '_DATA_6CA3_', count: 4, setup: '_LABEL_6C85_', role: 'entity_behavior_table_variant_29' },
  { offset: 0x06CFB, label: '_DATA_6CFB_', count: 5, setup: '_LABEL_6CC8_/_LABEL_6CCC_/_LABEL_6CD0_', role: 'entity_behavior_table_variant_33_35' },
  { offset: 0x06D47, label: '_DATA_6D47_', count: 5, setup: '_LABEL_6D05_/_LABEL_6D0C_/_LABEL_6D13_', role: 'entity_behavior_table_variant_36_38' },
  { offset: 0x06D8E, label: '_DATA_6D8E_', count: 5, setup: '_LABEL_6D51_/_LABEL_6D56_/_LABEL_6D5B_', role: 'entity_behavior_table_variant_39_41' },
  { offset: 0x06DC9, label: '_DATA_6DC9_', count: 4, setup: '_LABEL_6D98_/_LABEL_6D9E_/_LABEL_6DA4_', role: 'entity_behavior_table_variant_42_44' },
  { offset: 0x06DEE, label: '_DATA_6DEE_', count: 4, setup: '_LABEL_6CAB_/_LABEL_6DD1_/_LABEL_6EBE_', role: 'entity_behavior_table_variant_32_45_58' },
  { offset: 0x06E20, label: '_DATA_6E20_', count: 5, setup: '_LABEL_6DF6_', role: 'entity_behavior_table_variant_48' },
  { offset: 0x06E60, label: '_DATA_6E60_', count: 5, setup: '_LABEL_6E2A_', role: 'entity_behavior_table_variant_51' },
  { offset: 0x06EB4, label: '_DATA_6EB4_', count: 5, setup: '_LABEL_6E6A_/_LABEL_6E78_/_LABEL_6E86_', role: 'entity_behavior_table_variant_54_56' },
  { offset: 0x06EFA, label: '_DATA_6EFA_', count: 3, setup: '_LABEL_6EDB_', role: 'entity_behavior_table_variant_61' },
  { offset: 0x06F58, label: '_DATA_6F58_', count: 4, setup: '_LABEL_6F02_/_LABEL_6F0F_/_LABEL_6F1C_/_LABEL_6F25_', role: 'entity_behavior_table_variant_64_67' },
  { offset: 0x06F80, label: '_DATA_6F80_', count: 4, setup: '_LABEL_6F60_/_LABEL_6F66_', role: 'entity_behavior_table_variant_68_69' },
];

const DATA_TABLES = [
  {
    offset: 0x069FB,
    label: '_DATA_69FB_',
    inferredType: 'data_table',
    confidence: 'high',
    role: 'entity_spawn_position_word_table',
    summary: 'Twenty two-byte position words indexed by _LABEL_69BE_ before storing the selected value into IX+3/IX+4.',
    evidence: [
      '_LABEL_69BE_ indexes _DATA_69FB_ with the _RAM_D21C_ spawn counter, reads a word through RST $08/RST $10, and stores it in IX+3/IX+4.',
      '_LABEL_69E1_ uses the adjacent _DATA_69FB_ - 2 word as a separate IX+38 behavior-table prefix; the _DATA_69FB_ body itself is coordinate data, not screen_prog.',
    ],
  },
];

const MIXED_LEADS = [
  {
    offset: 0x06F00,
    label: '_DATA_6F00_',
    tableBytes: 2,
    summary: 'One word that points at behavior code, but its only ASM source reference is an apparent pointer-table comment from a music-region byte stream.',
    evidence: [
      'ASM marks _DATA_6F00_ as the first entry of a pointer table from 0x0D860, while the current 0x0D85F region is typed as music.',
      'The word resolves to 0x74AE, a same-bank code-shaped behavior target, but no confirmed IX+38 setup routine has been found yet.',
    ],
    nextStep: 'Trace 0x0D860 before retyping _DATA_6F00_; it may be a false disassembler pointer inside music data.',
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(region => {
    const start = parseInt(region.offset, 16);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function findExactRegion(mapData, offset) {
  return mapData.regions.find(region => parseInt(region.offset, 16) === offset) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id,
    name: region.name || '',
    type: region.type || 'unknown',
    offset: region.offset,
    size: region.size || 0,
  };
}

function readWord(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function readBehaviorTable(rom, mapData, def) {
  const region = findExactRegion(mapData, def.offset);
  const entries = [];
  const warnings = [];
  for (let i = 0; i < def.count; i++) {
    const entryOffset = def.offset + i * 2;
    const z80Pointer = readWord(rom, entryOffset);
    const targetRegion = findContainingRegion(mapData, z80Pointer);
    if (z80Pointer < 0x4000 || z80Pointer >= 0x8000) {
      warnings.push(`entry ${i} pointer ${hex(z80Pointer, 4)} is outside the same-bank 0x4000-0x7FFF behavior window`);
    }
    entries.push({
      index: i,
      entryOffset: hex(entryOffset),
      z80Pointer: hex(z80Pointer, 4),
      romOffset: hex(z80Pointer),
      targetRegion: regionRef(targetRegion),
    });
  }
  return {
    id: def.role + '_' + def.offset.toString(16).toUpperCase(),
    offset: hex(def.offset),
    label: def.label,
    inferredType: 'entity_behavior_table',
    confidence: 'high',
    role: def.role,
    summary: `${def.count}-entry IX+38/IX+39 entity behavior dispatch table seeded by ${def.setup}.`,
    setupRoutine: def.setup,
    region: regionRef(region),
    expectedSize: def.count * 2,
    regionSizeMatches: Boolean(region && region.size === def.count * 2),
    entryCount: def.count,
    entries,
    warnings,
    evidence: [
      ...DISPATCHER.evidence,
      `${def.setup} stores ${def.label} in IX+38/IX+39 before the shared entity update dispatcher jumps through it.`,
    ],
  };
}

function readDataTable(rom, mapData, def) {
  const region = findExactRegion(mapData, def.offset);
  const wordCount = region ? Math.floor((region.size || 0) / 2) : 0;
  const words = [];
  for (let i = 0; i < wordCount; i++) {
    const entryOffset = def.offset + i * 2;
    words.push({
      index: i,
      entryOffset: hex(entryOffset),
      value: hex(readWord(rom, entryOffset), 4),
    });
  }
  return {
    id: def.role + '_' + def.offset.toString(16).toUpperCase(),
    offset: hex(def.offset),
    label: def.label,
    inferredType: def.inferredType,
    confidence: def.confidence,
    role: def.role,
    summary: def.summary,
    region: regionRef(region),
    wordCount,
    valuePreview: words.slice(0, 8),
    evidence: def.evidence,
  };
}

function readMixedLead(rom, mapData, lead) {
  const region = findExactRegion(mapData, lead.offset) || findContainingRegion(mapData, lead.offset);
  const entries = [];
  for (let i = 0; i < Math.floor(lead.tableBytes / 2); i++) {
    const entryOffset = lead.offset + i * 2;
    const z80Pointer = readWord(rom, entryOffset);
    entries.push({
      index: i,
      entryOffset: hex(entryOffset),
      z80Pointer: hex(z80Pointer, 4),
      romOffset: hex(z80Pointer),
      targetRegion: regionRef(findContainingRegion(mapData, z80Pointer)),
    });
  }
  return {
    offset: hex(lead.offset),
    label: lead.label,
    region: regionRef(region),
    tableBytes: lead.tableBytes,
    summary: lead.summary,
    entries,
    evidence: lead.evidence,
    nextStep: lead.nextStep,
  };
}

function buildCatalog(rom, mapData) {
  const behaviorTables = BEHAVIOR_TABLES.map(def => readBehaviorTable(rom, mapData, def));
  const dataTables = DATA_TABLES.map(def => readDataTable(rom, mapData, def));
  const mixedLeads = MIXED_LEADS.map(lead => readMixedLead(rom, mapData, lead));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-entity-behavior-audit.mjs',
    dispatcher: DISPATCHER,
    behaviorTables,
    dataTables,
    mixedLeads,
    summary: {
      behaviorTables: behaviorTables.length,
      behaviorEntries: behaviorTables.reduce((sum, table) => sum + table.entryCount, 0),
      behaviorTablesWithWarnings: behaviorTables.filter(table => table.warnings.length).length,
      behaviorTablesWithRegionSizeMismatch: behaviorTables.filter(table => !table.regionSizeMatches).length,
      dataTables: dataTables.length,
      mixedLeads: mixedLeads.length,
      missingRegions: [...behaviorTables, ...dataTables].filter(entry => !entry.region).length,
      assetPolicy: 'Metadata only: table offsets, pointer values, target offsets, routine labels, and evidence. No ROM bytes or decoded copyrighted assets are embedded.',
    },
  };
}

function shouldRetypeBehavior(region) {
  return ['unknown', 'raw_byte', 'screen_prog', 'pointer_table', 'data_table'].includes(region.type || 'unknown');
}

function shouldRetypeData(region, inferredType) {
  if ((region.type || 'unknown') === inferredType) return false;
  return ['unknown', 'raw_byte', 'screen_prog'].includes(region.type || 'unknown');
}

function annotateBehaviorRegion(region, table) {
  const previousType = region.type || 'unknown';
  const changedType = shouldRetypeBehavior(region) && previousType !== 'entity_behavior_table';
  if (changedType) region.type = 'entity_behavior_table';
  region.analysis = region.analysis || {};
  const existing = region.analysis.entityBehaviorAudit || {};
  region.analysis.entityBehaviorAudit = {
    kind: 'entity_behavior_dispatch_table',
    summary: table.summary,
    confidence: table.confidence,
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    detail: {
      label: table.label,
      setupRoutine: table.setupRoutine,
      entryCount: table.entryCount,
      targetOffsets: table.entries.map(entry => entry.romOffset),
      warnings: table.warnings,
    },
    evidence: table.evidence,
    generatedAt: now,
    tool: 'tools/world-entity-behavior-audit.mjs',
  };
  return changedType;
}

function annotateDataRegion(region, table) {
  const previousType = region.type || 'unknown';
  const changedType = shouldRetypeData(region, table.inferredType);
  if (changedType) region.type = table.inferredType;
  region.analysis = region.analysis || {};
  const existing = region.analysis.entityBehaviorAudit || {};
  region.analysis.entityBehaviorAudit = {
    kind: table.role,
    summary: table.summary,
    confidence: table.confidence,
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    detail: {
      label: table.label,
      wordCount: table.wordCount,
    },
    evidence: table.evidence,
    generatedAt: now,
    tool: 'tools/world-entity-behavior-audit.mjs',
  };
  return changedType;
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const evidenceOnlyRegions = [];
  const missingRegions = [];
  const blockedRegions = [];

  for (const table of catalog.behaviorTables) {
    const region = table.region ? mapData.regions.find(r => r.id === table.region.id) : null;
    if (!region) {
      missingRegions.push({ offset: table.offset, inferredType: table.inferredType, role: table.role });
      continue;
    }
    if (!table.regionSizeMatches) {
      blockedRegions.push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType: region.type || 'unknown',
        inferredType: table.inferredType,
        role: table.role,
        reason: `Region size ${region.size || 0} does not match expected behavior table size ${table.expectedSize}. Split mixed table/code region before retyping.`,
      });
      continue;
    }
    const wouldChange = shouldRetypeBehavior(region) && (region.type || 'unknown') !== 'entity_behavior_table';
    if (!apply) {
      (wouldChange ? changedRegions : evidenceOnlyRegions).push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType: region.type || 'unknown',
        inferredType: table.inferredType,
        role: table.role,
      });
      continue;
    }
    const previousType = region.type || 'unknown';
    const changed = annotateBehaviorRegion(region, table);
    (changed ? changedRegions : evidenceOnlyRegions).push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType,
      type: region.type || 'unknown',
      inferredType: table.inferredType,
      role: table.role,
    });
  }

  for (const table of catalog.dataTables) {
    const region = table.region ? mapData.regions.find(r => r.id === table.region.id) : null;
    if (!region) {
      missingRegions.push({ offset: table.offset, inferredType: table.inferredType, role: table.role });
      continue;
    }
    const wouldChange = shouldRetypeData(region, table.inferredType);
    if (!apply) {
      (wouldChange ? changedRegions : evidenceOnlyRegions).push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType: region.type || 'unknown',
        inferredType: table.inferredType,
        role: table.role,
      });
      continue;
    }
    const previousType = region.type || 'unknown';
    const changed = annotateDataRegion(region, table);
    (changed ? changedRegions : evidenceOnlyRegions).push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType,
      type: region.type || 'unknown',
      inferredType: table.inferredType,
      role: table.role,
    });
  }

  for (const lead of catalog.mixedLeads) {
    blockedRegions.push({
      offset: lead.offset,
      region: lead.region,
      reason: lead.nextStep,
      summary: lead.summary,
    });
  }

  return { changedRegions, evidenceOnlyRegions, missingRegions, blockedRegions };
}

function collectChangedRegions(mapData) {
  return mapData.regions
    .filter(region => region.analysis?.entityBehaviorAudit?.catalogId === catalogId && region.analysis.entityBehaviorAudit.changedType)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType: region.analysis.entityBehaviorAudit.typeBeforeAudit || 'unknown',
      type: region.type || 'unknown',
      kind: region.analysis.entityBehaviorAudit.kind,
      confidence: region.analysis.entityBehaviorAudit.confidence,
    }));
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(rom, mapData);
    const changedRegions = collectChangedRegions(mapData);
    mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(c => c.id !== catalogId);
    mapData.entityBehaviorCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'entity_behavior_audit',
      generatedAt: now,
      tool: 'tools/world-entity-behavior-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegionTypes: changedRegions.length,
        changedRegionTypesThisRun: annotation.changedRegions.length,
        evidenceOnlyRegions: annotation.evidenceOnlyRegions.length,
        blockedRegions: annotation.blockedRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      changedRegions,
      changedRegionsThisRun: annotation.changedRegions,
      evidenceOnlyRegions: annotation.evidenceOnlyRegions,
      blockedRegions: annotation.blockedRegions,
      missingRegions: annotation.missingRegions,
      nextLeads: [
        'Split the mixed _DATA_6F80_ region into a four-entry entity_behavior_table prefix and following behavior code spans.',
        'Trace _DATA_6F00_ back through the 0x0D860 pointer comment before deciding whether it is a real entity behavior table or a false pointer in music data.',
        'Use the behavior table target offsets to identify and retype the code-shaped regions at 0x7001-0x7Axx that are still classified as screen_prog.',
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
    blockedRegions: annotation.blockedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
