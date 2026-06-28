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
const catalogId = 'world-pointer-table-detail-catalog-2026-06-25';
const reportId = 'pointer-table-detail-audit-2026-06-25';
const toolName = 'tools/world-pointer-table-detail-audit.mjs';

const TABLES = [
  {
    regionId: 'r0038',
    offset: 0x02BF0,
    entryCount: 4,
    pointerMode: 'absolute',
    kind: 'code_jump_table',
    role: 'shop_menu_page_state_jump_table',
    name: 'shop/menu page-state jump table',
    targetKind: 'code',
    indexRam: '_RAM_D11B_',
    dispatchRoutine: '_LABEL_2BE4_',
    summary: 'Four-entry shop/menu state jump table selected by _RAM_D11B_ through RST $20.',
    evidence: [
      'ASM lines 7045-7052 mask _RAM_D11B_ with 0x03 and dispatch through the jump table at _DATA_2BF0_.',
      'ASM lines 7053-7055 define _DATA_2BF0_ as four code targets for the shop/menu page states.',
    ],
  },
  {
    regionId: 'r0077',
    offset: 0x04537,
    entryCount: 3,
    pointerMode: 'absolute',
    kind: 'data_pointer_table',
    role: 'bank1_entity_record_pointer_table',
    name: 'bank-1 entity record pointer table',
    targetKind: 'entity_record_pointer_payload',
    indexRam: '_RAM_D108_',
    dispatchRoutine: '_LABEL_4486_',
    summary: 'Three-entry data pointer table selected by _RAM_D108_; each target is passed to _LABEL_43B8_ to initialize entity records.',
    evidence: [
      'ASM lines 10561-10576 compare/increment _RAM_D108_, index _DATA_4537_, and pass the selected target in HL to _LABEL_43B8_.',
      'ASM lines 10609-10611 define _DATA_4537_ as three pointers to _DATA_4440_, _DATA_444C_, and _DATA_4458_.',
    ],
  },
  {
    regionId: 'r0193',
    offset: 0x0B839,
    entryCount: 4,
    pointerMode: 'absolute',
    kind: 'code_jump_table',
    role: 'form_transition_entity_behavior_jump_table_4',
    name: 'form-transition entity behavior jump table',
    targetKind: 'code',
    indexRam: '_RAM_C3F0_',
    dispatchRoutine: '_LABEL_B82E_',
    summary: 'Four-entry entity behavior jump table selected from IX+48/_RAM_C3F0_ when IX+32 equals 0x04.',
    evidence: [
      'ASM lines 20553-20569 test IX+32, load A from IX+48, and dispatch through _DATA_B839_ with RST $20.',
      'ASM lines 20570-20571 define _DATA_B839_ as four code targets.',
    ],
  },
  {
    regionId: 'r0194',
    offset: 0x0B845,
    entryCount: 5,
    pointerMode: 'absolute',
    kind: 'code_jump_table',
    role: 'form_transition_entity_behavior_jump_table_5',
    name: 'form-transition entity behavior alternate jump table',
    targetKind: 'code',
    indexRam: '_RAM_C3F0_',
    dispatchRoutine: '_LABEL_B82E_',
    summary: 'Five-entry alternate entity behavior jump table selected from IX+48/_RAM_C3F0_ by the same branch around _LABEL_B82E_.',
    evidence: [
      'ASM lines 20573-20578 load A from IX+48 and dispatch through _DATA_B845_ with RST $20.',
      'ASM lines 20579-20580 define _DATA_B845_ as five code targets.',
    ],
  },
  {
    regionId: 'r0195',
    offset: 0x0B89E,
    entryCount: 2,
    pointerMode: 'banked_slot',
    bank: 2,
    kind: 'code_jump_table',
    role: 'form_transition_effect_phase_jump_table',
    name: 'form-transition effect phase jump table',
    targetKind: 'code',
    indexRam: '_RAM_C2A0_',
    dispatchRoutine: '_LABEL_B84F_',
    summary: 'Two-entry bank-2 jump table selected by the low two bits of _RAM_C2A0_ during form-transition effect updates.',
    evidence: [
      'ASM lines 20599-20605 mask _RAM_C2A0_ with 0x03 and dispatch through _DATA_B89E_ with RST $20.',
      'ASM lines 20606-20608 define _DATA_B89E_ as two code targets in the bank-2 slot.',
    ],
  },
  {
    regionId: 'r0218',
    offset: 0x0D139,
    entryCount: 62,
    pointerMode: 'banked_slot',
    bank: 3,
    kind: 'audio_pointer_table',
    role: 'audio_song_sfx_pointer_table',
    targetKind: 'music_header_or_sfx_record',
    indexRam: '_RAM_C222_',
    dispatchRoutine: '_LABEL_C04D_/_LABEL_C09F_',
    summary: '62-entry bank-3 audio song/SFX pointer table indexed by queued audio ids in _RAM_C222_.',
    evidence: [
      'ASM lines 21589-21600 load DE with _DATA_D139_, index it with the active audio id, and follow the selected pointer.',
      'ASM lines 21670-21683 read queued ids from _RAM_C222_, index _DATA_D139_, and follow the selected song/SFX header pointer.',
      'ASM lines 23207-23216 define _DATA_D139_ as a 62-entry pointer table indexed by _RAM_C222_.',
    ],
  },
  {
    regionId: 'r0348',
    offset: 0x13C00,
    entryCount: 5,
    pointerMode: 'banked_slot',
    bank: 4,
    kind: 'data_pointer_table',
    role: 'bank4_entity_animation_loader_table_a',
    name: 'bank-4 entity animation loader table A',
    targetKind: 'entity_anim_script',
    indexRam: '_RAM_C37E_',
    dispatchRoutine: '_LABEL_1BE0_',
    summary: 'Five-entry bank-4 pointer table selected after item/entity id range checks; targets are 998-format entity animation loader streams.',
    evidence: [
      'ASM lines 4980-4999 choose _DATA_13C00_ for one id range, index it, and pass the selected target to _LABEL_99B_.',
      'ASM lines 24737-24739 define _DATA_13C00_ as five pointers to bank-4 entity animation loader streams.',
    ],
  },
  {
    regionId: 'r0349',
    offset: 0x13C0A,
    entryCount: 7,
    pointerMode: 'banked_slot',
    bank: 4,
    kind: 'data_pointer_table',
    role: 'bank4_entity_animation_loader_table_b',
    name: 'bank-4 entity animation loader table B',
    targetKind: 'entity_anim_script',
    indexRam: '_RAM_C37E_',
    dispatchRoutine: '_LABEL_1BE0_',
    summary: 'Seven-entry bank-4 pointer table selected by the alternate id range in _LABEL_1BE0_; targets are 998-format entity animation loader streams.',
    evidence: [
      'ASM lines 4980-4999 choose _DATA_13C0A_ for the alternate id range, index it, and pass the selected target to _LABEL_99B_.',
      'ASM lines 24741-24743 define _DATA_13C0A_ as seven pointers to bank-4 entity animation loader streams.',
    ],
  },
  {
    regionId: 'r0363',
    offset: 0x13E01,
    entryCount: 21,
    pointerMode: 'banked_slot',
    bank: 4,
    kind: 'data_pointer_table',
    role: 'bank4_reward_or_event_sequence_pointer_table',
    name: 'bank-4 reward/event sequence pointer table',
    targetKind: 'entity_anim_script',
    indexRam: '_RAM_D1B0_',
    dispatchRoutine: '_LABEL_611C_/_LABEL_6141_',
    summary: 'Twenty-one-entry bank-4 pointer table whose selected byte stream is stored in _RAM_D1B3_ and consumed until 0xFF.',
    evidence: [
      'ASM lines 14228-14242 index _DATA_13E01_ by an event/id offset and store the selected pointer in _RAM_D1B3_.',
      'ASM lines 14245-14262 advance _RAM_D1B3_, read stream bytes until 0xFF, and pass each byte to _LABEL_6166_.',
      'ASM lines 24831-24835 define _DATA_13E01_ as 21 pointers to bank-4 byte streams.',
    ],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function resolvePointerWord(def, word) {
  if (def.pointerMode === 'absolute') return word;
  if (def.pointerMode === 'banked_slot') {
    if (word < 0x8000 || word >= 0xC000) return null;
    return def.bank * 0x4000 + (word - 0x8000);
  }
  return null;
}

function tableEntry(rom, mapData, def, index) {
  const tableEntryOffset = def.offset + index * 2;
  const rawWord = rom[tableEntryOffset] | (rom[tableEntryOffset + 1] << 8);
  const targetOffset = resolvePointerWord(def, rawWord);
  const targetRegion = targetOffset == null ? null : findContainingRegion(mapData, targetOffset);
  return {
    index,
    tableEntryOffset: hex(tableEntryOffset),
    rawWord: hex(rawWord, 4),
    targetOffset: targetOffset == null ? null : hex(targetOffset),
    targetOffsetWithinRegion: targetRegion && targetOffset != null ? targetOffset - offsetOf(targetRegion) : null,
    targetRegion: regionRef(targetRegion),
  };
}

function buildCatalog(rom, mapData) {
  const entries = TABLES.map(def => {
    const region = findRegionById(mapData, def.regionId);
    const tableEntries = Array.from({ length: def.entryCount }, (_, index) => tableEntry(rom, mapData, def, index));
    const uniqueTargets = [...new Set(tableEntries.map(entry => entry.targetOffset).filter(Boolean))];
    return {
      id: `${def.regionId}_pointer_table_${def.offset.toString(16).toUpperCase()}`,
      region: regionRef(region),
      offset: hex(def.offset),
      entryCount: def.entryCount,
      pointerMode: def.pointerMode,
      bank: def.bank ?? null,
      kind: def.kind,
      role: def.role,
      targetKind: def.targetKind,
      indexRam: def.indexRam,
      dispatchRoutine: def.dispatchRoutine,
      summary: def.summary,
      entries: tableEntries,
      uniqueTargetCount: uniqueTargets.length,
      resolvedTargetCount: tableEntries.filter(entry => entry.targetOffset).length,
      missingTargetRegionCount: tableEntries.filter(entry => entry.targetOffset && !entry.targetRegion).length,
      confidence: 'high',
      evidence: def.evidence,
    };
  });
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      tableCount: entries.length,
      totalEntries: entries.reduce((sum, entry) => sum + entry.entryCount, 0),
      resolvedTargetCount: entries.reduce((sum, entry) => sum + entry.resolvedTargetCount, 0),
      missingTargetRegionCount: entries.reduce((sum, entry) => sum + entry.missingTargetRegionCount, 0),
      kindCounts: entries.reduce((counts, entry) => {
        counts[entry.kind] = (counts[entry.kind] || 0) + 1;
        return counts;
      }, {}),
      assetPolicy: 'Metadata only: pointer table offsets, raw pointer words, resolved ROM offsets, target region refs, and ASM evidence. No ROM bytes or decoded copyrighted assets are embedded.',
    },
    entries,
  };
}

function maybeUpdateGenericName(region, def) {
  if (!def.name) return;
  const name = region.name || '';
  if (/^(Pointer Table|Jump Table) @/i.test(name) || name === '') {
    region.name = def.name;
  }
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  const missing = [];
  for (const entry of catalog.entries) {
    const def = TABLES.find(item => item.regionId === entry.region?.id);
    const region = entry.region ? findRegionById(mapData, entry.region.id) : null;
    if (!region || !def) {
      missing.push({ regionId: entry.region?.id || def?.regionId || '', offset: entry.offset, role: entry.role });
      continue;
    }
    const previousType = region.type || 'unknown';
    maybeUpdateGenericName(region, def);
    region.analysis = region.analysis || {};
    region.analysis.pointerTableDetailAudit = {
      catalogId,
      kind: entry.kind,
      role: entry.role,
      targetKind: entry.targetKind,
      confidence: entry.confidence,
      entryCount: entry.entryCount,
      pointerMode: entry.pointerMode,
      bank: entry.bank,
      indexRam: entry.indexRam,
      dispatchRoutine: entry.dispatchRoutine,
      resolvedTargetCount: entry.resolvedTargetCount,
      uniqueTargetCount: entry.uniqueTargetCount,
      missingTargetRegionCount: entry.missingTargetRegionCount,
      entries: entry.entries.map(item => ({
        index: item.index,
        tableEntryOffset: item.tableEntryOffset,
        rawWord: item.rawWord,
        targetOffset: item.targetOffset,
        targetRegionId: item.targetRegion?.id || '',
        targetOffsetWithinRegion: item.targetOffsetWithinRegion,
      })),
      summary: entry.summary,
      evidence: entry.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      previousType,
      role: entry.role,
      kind: entry.kind,
      entryCount: entry.entryCount,
      resolvedTargetCount: entry.resolvedTargetCount,
      missingTargetRegionCount: entry.missingTargetRegionCount,
    });
  }
  return { annotated, missing };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotation = apply ? annotateMap(mapData, catalog) : {
    annotated: catalog.entries.map(entry => ({
      id: entry.region?.id || '',
      offset: entry.offset,
      type: entry.region?.type || '',
      role: entry.role,
      kind: entry.kind,
      entryCount: entry.entryCount,
      resolvedTargetCount: entry.resolvedTargetCount,
      missingTargetRegionCount: entry.missingTargetRegionCount,
    })),
    missing: catalog.entries.filter(entry => !entry.region).map(entry => ({
      offset: entry.offset,
      role: entry.role,
    })),
  };

  if (apply) {
    const finalCatalog = buildCatalog(rom, mapData);
    mapData.pointerTableCatalogs = (mapData.pointerTableCatalogs || []).filter(item => item.id !== catalogId);
    mapData.pointerTableCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'pointer_table_detail_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotation.annotated.length,
        missingRegions: annotation.missing.length,
      },
      annotatedRegions: annotation.annotated,
      missingRegions: annotation.missing,
      nextLeads: [
        'Use the bank-4 0x13C00/0x13C0A target streams to refine entity animation loader semantics.',
        'Trace _LABEL_6166_ writes to name each byte value emitted by the 0x13E01 reward/event sequence streams.',
        'Split nested pointer-payload regions such as 0x04440/0x0444C/0x04458 only after the entity record format is fully decoded.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: annotation.annotated,
    missingRegions: annotation.missing,
    entries: catalog.entries.map(entry => ({
      regionId: entry.region?.id || '',
      offset: entry.offset,
      role: entry.role,
      kind: entry.kind,
      entryCount: entry.entryCount,
      resolvedTargetCount: entry.resolvedTargetCount,
      missingTargetRegionCount: entry.missingTargetRegionCount,
      firstTargets: entry.entries.slice(0, 8).map(item => ({
        rawWord: item.rawWord,
        targetOffset: item.targetOffset,
        targetRegionId: item.targetRegion?.id || '',
      })),
    })),
  }, null, 2));
}

main();
