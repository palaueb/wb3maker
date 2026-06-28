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
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-animation-root-semantics-catalog-2026-06-25';
const reportId = 'animation-root-semantics-audit-2026-06-25';
const toolName = 'tools/world-animation-root-semantics-audit.mjs';

const BANK6_START = 0x18000;
const BANK6_END = 0x1BFFF;
const ROOT_TABLE = { offset: 0x18718, count: 6, label: '_DATA_18718_' };
const CHILD_TABLES = [
  { rootEntry: 0, offset: 0x18724, count: 6, label: '_DATA_18724_', playerAccessible: true },
  { rootEntry: 1, offset: 0x196FB, count: 12, label: '_DATA_196FB_' },
  { rootEntry: 2, offset: 0x19037, count: 75, label: '_DATA_19037_' },
  { rootEntry: 3, offset: 0x19696, count: 6, label: '_DATA_19696_' },
  { rootEntry: 4, offset: 0x197A8, count: 17, label: '_DATA_197A8_' },
  { rootEntry: 5, offset: 0x198EA, count: 6, label: '_DATA_198EA_' },
];

const ROUTINES = [
  {
    offset: 0x01318,
    label: '_LABEL_1318_',
    role: 'entity_animation_start',
    selectorPath: [
      { step: 'select_data_bank', selector: 'literal 0x06', target: 'bank 6' },
      { step: 'root_table_entry', selector: 'IX+14', table: '_DATA_18718_' },
      { step: 'child_table_entry', selector: 'IX+15', table: 'root-selected child table' },
      { step: 'variant_or_stream_entry', selector: 'caller A', table: 'child-selected variant table or direct stream' },
    ],
    evidence: [
      'ASM lines 3708-3722 switch to bank 6, load A from (IX+14), index _DATA_18718_, load A from (IX+15), then index the selected child table.',
      'The routine restores the caller-provided A and indexes the final selected table before entering _LABEL_1347_.',
    ],
  },
  {
    offset: 0x01330,
    label: '_LABEL_1330_',
    role: 'entity_animation_tick',
    selectorPath: [
      { step: 'delay_counter', selector: 'IX+16' },
      { step: 'stream_pointer', selector: 'IX+18/IX+19' },
      { step: 'frame_pointer_output', selector: 'decoded stream command', target: 'IX+12/IX+13' },
    ],
    evidence: [
      'ASM lines 3724-3765 decrement IX+16 and, when the delay expires, resume the stream pointer stored in IX+18/IX+19.',
      '_LABEL_1347_ handles 0xFF stream jumps, delay/control bytes, optional two motion words, and frame/metasprite pointer output.',
    ],
  },
  {
    offset: 0x0137C,
    label: '_LABEL_137C_',
    role: 'player_form_animation_start',
    selectorPath: [
      { step: 'select_data_bank', selector: 'literal 0x06', target: 'bank 6' },
      { step: 'root_table_entry', selector: 'literal 0', table: '_DATA_18718_' },
      { step: 'child_table_entry', selector: '_RAM_C24F_', table: '_DATA_18724_' },
      { step: 'variant_or_stream_entry', selector: 'caller A', table: 'player/form child-selected variant table or direct stream' },
    ],
    evidence: [
      'ASM lines 3768-3782 switch to bank 6, execute XOR A before indexing _DATA_18718_, then load A from _RAM_C24F_ for the child-table selection.',
      'This path therefore always starts from root entry 0, unlike the entity path that selects the root entry from IX+14.',
    ],
  },
  {
    offset: 0x01392,
    label: '_LABEL_1392_',
    role: 'player_form_animation_tick',
    selectorPath: [
      { step: 'delay_counter', selector: '_RAM_C250_' },
      { step: 'stream_pointer', selector: '_RAM_C252_' },
      { step: 'frame_pointer_output', selector: 'decoded stream command', target: '_RAM_C24C_' },
    ],
    evidence: [
      'ASM lines 3784-3839 decrement _RAM_C250_ and, when the delay expires, resume the stream pointer stored in _RAM_C252_.',
      '_LABEL_13A6_ mirrors _LABEL_1347_ for player/form state and stores decoded frame/metasprite state in RAM variables instead of IX fields.',
    ],
  },
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

function isBank6Offset(offset) {
  return offset >= BANK6_START && offset <= BANK6_END;
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
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

function regionRefAt(mapData, offset) {
  return regionRef(findContainingRegion(mapData, offset));
}

function pointerTarget(rom, offset) {
  const z80Pointer = readWord(rom, offset);
  const romOffset = isBank6Ptr(z80Pointer) ? bank6Z80ToRom(z80Pointer) : null;
  return {
    entryOffset: hex(offset),
    z80Pointer: hex(z80Pointer, 4),
    romOffset: romOffset == null ? null : hex(romOffset),
    inBank6: romOffset != null && isBank6Offset(romOffset),
  };
}

function readPointerEntries(rom, mapData, offset, count) {
  const entries = [];
  for (let index = 0; index < count; index++) {
    const target = pointerTarget(rom, offset + index * 2);
    entries.push({
      index,
      ...target,
      region: target.romOffset == null ? null : regionRefAt(mapData, parseInt(target.romOffset, 16)),
    });
  }
  return entries;
}

function readVariantPrefix(rom, mapData, offset) {
  const entries = [];
  let pos = offset;
  while (pos + 1 < rom.length && entries.length < 128) {
    const target = pointerTarget(rom, pos);
    if (!target.inBank6) break;
    entries.push({
      index: entries.length,
      ...target,
      region: target.romOffset == null ? null : regionRefAt(mapData, parseInt(target.romOffset, 16)),
    });
    pos += 2;
  }
  return {
    offset: hex(offset),
    entryCount: entries.length,
    byteLength: entries.length * 2,
    entries: entries.slice(0, 24),
  };
}

function buildRootTable(rom, mapData) {
  const entries = readPointerEntries(rom, mapData, ROOT_TABLE.offset, ROOT_TABLE.count);
  return {
    label: ROOT_TABLE.label,
    romOffset: hex(ROOT_TABLE.offset),
    count: ROOT_TABLE.count,
    runtimeSelectors: [
      {
        context: 'entity',
        routine: '_LABEL_1318_',
        selector: 'IX+14',
        indexBase: 'zero_based',
        evidence: 'ASM lines 3708-3716 load A from (IX+14) before indexing _DATA_18718_.',
      },
      {
        context: 'player_form',
        routine: '_LABEL_137C_',
        selector: 'literal 0',
        indexBase: 'zero_based',
        evidence: 'ASM lines 3768-3775 execute XOR A before indexing _DATA_18718_.',
      },
    ],
    entries: entries.map(entry => {
      const expected = CHILD_TABLES.find(table => table.rootEntry === entry.index);
      return {
        ...entry,
        expectedChildTable: expected ? {
          label: expected.label,
          offset: hex(expected.offset),
          matchesPointer: entry.romOffset === hex(expected.offset),
        } : null,
      };
    }),
    evidence: [
      '_LABEL_1318_ selects this root table by IX+14 for entity animation start.',
      '_LABEL_137C_ selects root entry 0 for player/form animation start.',
      '_LABEL_8_ at ASM lines 873-877 performs HL += 2*A, confirming zero-based pointer-table indexes.',
      'The disassembler comment names _RAM_C28E_ as an index, but the two observed runtime selector paths above are the confirmed consumers of _DATA_18718_.',
    ],
  };
}

function buildChildTables(rom, mapData) {
  return CHILD_TABLES.map(def => {
    const entries = readPointerEntries(rom, mapData, def.offset, def.count);
    let variantPrefixEntries = 0;
    let directStreamEntries = 0;
    const entrySummaries = entries.map(entry => {
      const targetOffset = entry.romOffset == null ? null : parseInt(entry.romOffset, 16);
      const variantPrefix = targetOffset == null ? null : readVariantPrefix(rom, mapData, targetOffset);
      if (variantPrefix?.entryCount > 0) variantPrefixEntries++;
      if (variantPrefix?.entryCount === 0) directStreamEntries++;
      return {
        ...entry,
        targetInterpretation: variantPrefix?.entryCount > 0 ? 'variant_pointer_table_prefix' : 'direct_command_stream_candidate',
        variantPrefix: variantPrefix == null ? null : {
          entryCount: variantPrefix.entryCount,
          byteLength: variantPrefix.byteLength,
          entrySamples: variantPrefix.entries.slice(0, 6),
        },
      };
    });
    return {
      label: def.label,
      romOffset: hex(def.offset),
      rootEntry: def.rootEntry,
      count: def.count,
      playerAccessible: Boolean(def.playerAccessible),
      runtimeSelectors: [
        {
          context: 'entity',
          routine: '_LABEL_1318_',
          selector: 'IX+15',
          indexBase: 'zero_based',
          evidence: 'ASM lines 3717-3720 load A from (IX+15) before indexing the selected child table.',
        },
        ...(def.playerAccessible ? [{
          context: 'player_form',
          routine: '_LABEL_137C_',
          selector: '_RAM_C24F_',
          indexBase: 'zero_based',
          evidence: 'ASM lines 3776-3779 load A from _RAM_C24F_ after selecting root entry 0.',
        }] : []),
      ],
      entries: entrySummaries,
      summary: {
        entries: entries.length,
        uniqueTargets: new Set(entries.map(entry => entry.romOffset).filter(Boolean)).size,
        variantPrefixEntries,
        directStreamEntries,
      },
    };
  });
}

function buildCatalog(rom, mapData) {
  const rootTable = buildRootTable(rom, mapData);
  const childTables = buildChildTables(rom, mapData);
  const allChildEntries = childTables.flatMap(table => table.entries.map(entry => ({ table, entry })));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    bankContext: {
      dataBank: 6,
      z80Window: '0x8000-0xBFFF',
      z80ToRomFormula: 'rom = z80 + 0x10000',
      pointerIndexHelper: '_LABEL_8_ / RST $08 / zero-based HL += 2*A',
    },
    assetPolicy: 'Metadata only: offsets, labels, selector roles, pointer graph counts, and ASM evidence. No ROM bytes, graphics, music, or text payloads are embedded.',
    rootTable,
    childTables,
    routines: ROUTINES.map(routine => ({
      ...routine,
      offset: hex(routine.offset),
      region: regionRef(findExactRegion(mapData, routine.offset)),
    })),
    selectorCorrections: [
      {
        subject: '_DATA_18718_ root-table index',
        previousComment: 'ASM comment says indexed by _RAM_C28E_.',
        confirmedSemantics: 'Entity start routine _LABEL_1318_ indexes it by IX+14; player/form start routine _LABEL_137C_ indexes it with literal 0.',
        confidence: 'high',
      },
      {
        subject: 'child-table index comments',
        previousComment: 'ASM comments say child tables are indexed by _RAM_C3CF_.',
        confirmedSemantics: 'The confirmed runtime start routines use IX+15 for entity animation and _RAM_C24F_ for player/form animation under root entry 0.',
        confidence: 'high',
      },
    ],
    summary: {
      rootEntries: rootTable.entries.length,
      rootEntriesMatchingKnownChildTables: rootTable.entries.filter(entry => entry.expectedChildTable?.matchesPointer).length,
      childTables: childTables.length,
      childEntries: allChildEntries.length,
      variantPrefixEntries: childTables.reduce((sum, table) => sum + table.summary.variantPrefixEntries, 0),
      directStreamEntries: childTables.reduce((sum, table) => sum + table.summary.directStreamEntries, 0),
      routines: ROUTINES.length,
      pointerIndexBase: 'zero_based',
      assetPolicy: 'Metadata only: offsets, labels, selector roles, pointer graph counts, and ASM evidence. No ROM bytes, graphics, music, or text payloads are embedded.',
    },
  };
}

function annotateTableRegion(region, detail) {
  region.analysis = region.analysis || {};
  const existing = region.analysis.animationRootSemanticsAudit || {};
  region.analysis.animationRootSemanticsAudit = {
    kind: detail.kind,
    catalogId,
    confidence: 'high',
    summary: detail.summary,
    selectorSemantics: detail.selectorSemantics,
    pointerVerification: detail.pointerVerification,
    supersedesCommentOnlySelectors: detail.supersedesCommentOnlySelectors,
    evidence: detail.evidence,
    generatedAt: now,
    tool: toolName,
    previousAuditKind: existing.kind || null,
  };
  return {
    id: region.id,
    offset: region.offset,
    name: region.name || '',
    type: region.type || 'unknown',
    kind: detail.kind,
  };
}

function annotateRoutineRegion(region, routine) {
  region.analysis = region.analysis || {};
  const existing = region.analysis.animationRootSemanticsAudit || {};
  region.analysis.animationRootSemanticsAudit = {
    kind: 'animation_runtime_selector_routine',
    catalogId,
    confidence: 'high',
    role: routine.role,
    label: routine.label,
    selectorPath: routine.selectorPath,
    summary: `${routine.label} provides confirmed selector semantics for bank-6 animation table traversal.`,
    evidence: routine.evidence,
    generatedAt: now,
    tool: toolName,
    previousAuditKind: existing.kind || null,
  };
  return {
    id: region.id,
    offset: region.offset,
    name: region.name || '',
    type: region.type || 'unknown',
    label: routine.label,
    role: routine.role,
  };
}

function annotateMap(mapData, catalog) {
  const annotatedTables = [];
  const annotatedRoutines = [];
  const missingRegions = [];

  const rootRegion = findExactRegion(mapData, ROOT_TABLE.offset);
  if (!rootRegion) {
    missingRegions.push({ offset: hex(ROOT_TABLE.offset), label: ROOT_TABLE.label, kind: 'animation_root_table' });
  } else {
    annotatedTables.push(annotateTableRegion(rootRegion, {
      kind: 'animation_root_table_selector_semantics',
      summary: 'Confirmed runtime selector semantics for the bank-6 animation root table.',
      selectorSemantics: catalog.rootTable.runtimeSelectors,
      pointerVerification: {
        entries: catalog.rootTable.entries.map(entry => ({
          index: entry.index,
          entryOffset: entry.entryOffset,
          target: entry.romOffset,
          expectedChildTable: entry.expectedChildTable,
        })),
      },
      supersedesCommentOnlySelectors: ['_RAM_C28E_'],
      evidence: catalog.rootTable.evidence,
    }));
  }

  for (const childTable of catalog.childTables) {
    const region = findExactRegion(mapData, parseInt(childTable.romOffset, 16));
    if (!region) {
      missingRegions.push({ offset: childTable.romOffset, label: childTable.label, kind: 'animation_child_table' });
      continue;
    }
    annotatedTables.push(annotateTableRegion(region, {
      kind: 'animation_child_table_selector_semantics',
      summary: 'Confirmed runtime selector semantics and target-shape summary for a bank-6 animation child table.',
      selectorSemantics: childTable.runtimeSelectors,
      pointerVerification: {
        rootEntry: childTable.rootEntry,
        entries: childTable.entries.length,
        uniqueTargets: childTable.summary.uniqueTargets,
        variantPrefixEntries: childTable.summary.variantPrefixEntries,
        directStreamEntries: childTable.summary.directStreamEntries,
      },
      supersedesCommentOnlySelectors: ['_RAM_C3CF_'],
      evidence: [
        '_LABEL_1318_ selects entity child table entries with IX+15 after selecting the root table by IX+14.',
        '_LABEL_8_ at ASM lines 873-877 performs HL += 2*A, confirming zero-based child-table indexes.',
        ...(childTable.playerAccessible ? ['_LABEL_137C_ selects this root-entry-0 child table with _RAM_C24F_ for player/form animation.'] : []),
      ],
    }));
  }

  for (const routine of ROUTINES) {
    const region = findExactRegion(mapData, routine.offset);
    if (!region) {
      missingRegions.push({ offset: hex(routine.offset), label: routine.label, kind: 'animation_runtime_selector_routine' });
      continue;
    }
    annotatedRoutines.push(annotateRoutineRegion(region, routine));
  }

  return { annotatedTables, annotatedRoutines, missingRegions };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  let annotation = { annotatedTables: [], annotatedRoutines: [], missingRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    const finalCatalog = buildCatalog(rom, mapData);
    mapData.animationRootSemanticsCatalogs = (mapData.animationRootSemanticsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.animationRootSemanticsCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'animation_root_semantics_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedTables: annotation.annotatedTables.length,
        annotatedRoutines: annotation.annotatedRoutines.length,
        missingRegions: annotation.missingRegions.length,
      },
      selectorCorrections: finalCatalog.selectorCorrections,
      annotatedTables: annotation.annotatedTables,
      annotatedRoutines: annotation.annotatedRoutines,
      missingRegions: annotation.missingRegions,
      rootTable: finalCatalog.rootTable,
      childTableSummary: finalCatalog.childTables.map(table => ({
        label: table.label,
        romOffset: table.romOffset,
        rootEntry: table.rootEntry,
        playerAccessible: table.playerAccessible,
        runtimeSelectors: table.runtimeSelectors,
        summary: table.summary,
      })),
      nextLeads: [
        'Use these selector semantics to split animation script catalog output into entity-root, player/form-root, variant-table, and direct-stream roles.',
        'Trace the callers that set IX+14 and IX+15 so each enemy/object class can be linked to its animation root entry and child entry.',
        'Decode the frame/metasprite target record format behind the command-stream frame pointers and connect it to sprite tile/OAM layout metadata.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    selectorCorrections: catalog.selectorCorrections,
    annotatedTables: annotation.annotatedTables.length,
    annotatedRoutines: annotation.annotatedRoutines.length,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
