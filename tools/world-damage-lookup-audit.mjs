#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-damage-lookup-catalog-2026-06-25';
const reportId = 'damage-lookup-audit-2026-06-25';

const table = {
  label: '_DATA_13CE0_',
  regionId: 'r0362',
  offset: 0x13CE0,
  size: 17 * 17,
  width: 17,
  height: 17,
};

const seedTable = {
  label: '_DATA_CFF_',
  regionId: 'r0014',
  offset: 0x00CFF,
  size: 0x37,
};

const routines = [
  {
    regionId: 'r2176',
    label: '_LABEL_1EC8_',
    offset: 0x01EC8,
    role: 'damage_lookup_full_index',
    name: '_LABEL_1EC8_ damage lookup full-index routine',
    confidence: 'high',
    summary: 'Computes both table axes, switches to bank 4, reads _DATA_13CE0_, multiplies the selected byte by 8, and restores the previous bank.',
    evidence: [
      'ASM lines 5340-5367 compute an index into _DATA_13CE0_ after _LABEL_1F01_.',
      'ASM lines 5357-5365 switch to bank 4 and add _DATA_13CE0_ as the table base.',
      'ASM lines 5368-5375 read one table byte, multiply it by 8, then call _LABEL_1036_ to restore the bank.',
    ],
  },
  {
    regionId: 'r2177',
    label: '_LABEL_1F01_',
    offset: 0x01F01,
    role: 'damage_lookup_axis_helper',
    name: '_LABEL_1F01_ damage lookup axis helper',
    confidence: 'medium',
    summary: 'Uses _LABEL_D36_ and nibble math to compute a table-axis offset shared by _LABEL_1EC8_ and _LABEL_1F17_.',
    evidence: [
      'ASM lines 5378-5392 call _LABEL_D36_ and derive the offset returned in C.',
      'ASM lines 5340-5367 and 5394-5401 both call this helper before reading _DATA_13CE0_.',
    ],
  },
  {
    regionId: 'r2178',
    label: '_LABEL_1F17_',
    offset: 0x01F17,
    role: 'damage_lookup_base_row',
    name: '_LABEL_1F17_ damage lookup base-row routine',
    confidence: 'high',
    summary: 'Computes one axis, switches to bank 4, reads _DATA_13CE0_ from the base row, and uses the shared byte-times-eight return path.',
    evidence: [
      'ASM lines 5394-5401 call _LABEL_1F01_, switch to bank 4, set HL to _DATA_13CE0_ + BC, and jump to the shared read/multiply return path.',
    ],
  },
  {
    regionId: 'r2415',
    label: '_LABEL_6793_',
    offset: 0x06793,
    role: 'entity_damage_apply',
    name: '_LABEL_6793_ entity damage apply routine',
    confidence: 'high',
    summary: 'Subtracts the lookup result from the active entity hit-point word at IX+28/IX+29 and selects the survival or defeated state.',
    evidence: [
      'ASM lines 15010-15020 subtract DE from IX+28/IX+29, keep the remainder, and set IX+32 to 1 when nonzero.',
      'ASM lines 15025-15031 zero IX+28/IX+29 and IX+32 when the subtraction reaches or passes zero.',
      'ASM lines 14880-14894 call _LABEL_1EC8_/_LABEL_1F17_ before _LABEL_6793_ in the entity loop.',
    ],
  },
  {
    regionId: 'r2581',
    label: '_LABEL_99A1_',
    offset: 0x099A1,
    role: 'scripted_damage_apply',
    name: '_LABEL_99A1_ scripted damage apply routine',
    confidence: 'medium',
    summary: 'Uses _LABEL_1EC8_ and subtracts the lookup result from _RAM_D16A_; the broader scripted/boss state still needs naming.',
    evidence: [
      'ASM lines 19872-19880 call collision helpers, then _LABEL_1EC8_, and exchange the returned lookup amount into DE.',
      'ASM lines 19881-19896 subtract DE from _RAM_D16A_, preserve a nonzero remainder, or zero it and set the completion flag.',
    ],
  },
  {
    regionId: 'r1757',
    label: '_LABEL_D36_',
    offset: 0x00D36,
    role: 'damage_lookup_jitter_source',
    name: '_LABEL_D36_ rolling byte accumulator helper',
    confidence: 'medium',
    summary: 'Updates two rolling indexes through the 55-byte _RAM_D0A5_ table and returns a derived byte used by the lookup index helper.',
    evidence: [
      'ASM lines 2801-2837 update _RAM_D0DC_/_RAM_D0DD_, read two positions in _RAM_D0A5_, add them, store the result back, and return it in A.',
      'ASM lines 5344 and 5380 show _LABEL_1EC8_/_LABEL_1F01_ using this helper before indexing _DATA_13CE0_.',
    ],
  },
];

const consumerRoutines = [
  {
    regionId: 'r2323',
    label: '_LABEL_4A5E_',
    role: 'player_collision_damage_consumer',
    confidence: 'medium',
    summary: 'Calls _LABEL_1EC8_ with _RAM_C25C_ and stores the resulting HL value in _RAM_C262_.',
    evidence: ['ASM lines 11348-11355 call _LABEL_1EC8_, store HL in _RAM_C262_, and trigger sound/effect $12.'],
  },
  {
    regionId: 'r2410',
    label: '_LABEL_660D_',
    role: 'entity_loop_damage_consumer',
    confidence: 'high',
    summary: 'Entity update loop calls _LABEL_1EC8_ or _LABEL_1F17_ before applying the result with _LABEL_6793_.',
    evidence: ['ASM lines 14880-14894 call _LABEL_1EC8_/_LABEL_1F17_ followed by _LABEL_6793_ when interaction bit 3 is set.'],
  },
];

const ramRoles = [
  {
    address: '$C262',
    role: 'player_collision_damage_lookup_result',
    confidence: 'medium',
    summary: 'Receives the HL result from _LABEL_1EC8_ in the player collision path.',
    evidence: ['ASM lines 11348-11355 call _LABEL_1EC8_ and store HL into _RAM_C262_.'],
  },
  {
    address: '$C25C',
    role: 'player_damage_lookup_input',
    confidence: 'medium',
    summary: 'Input byte passed to _LABEL_1EC8_ in the player collision path.',
    evidence: ['ASM lines 11348-11350 load _RAM_C25C_ into A before calling _LABEL_1EC8_.'],
  },
  {
    address: '$D16A',
    role: 'scripted_damage_remaining_word',
    confidence: 'medium',
    summary: 'Word reduced by the _LABEL_1EC8_ lookup result in the scripted/boss interaction path.',
    evidence: ['ASM lines 19879-19896 call _LABEL_1EC8_ and subtract the result from _RAM_D16A_.'],
  },
  {
    address: '$D17D',
    role: 'scripted_damage_lookup_input',
    confidence: 'medium',
    summary: 'Input byte passed to _LABEL_1EC8_ in the scripted/boss interaction path.',
    evidence: ['ASM lines 19878-19880 load _RAM_D17D_ into A before calling _LABEL_1EC8_.'],
  },
  {
    address: '$D0A5',
    role: 'rolling_byte_accumulator_table',
    confidence: 'medium',
    summary: '55-byte RAM table read and updated by _LABEL_D36_, which feeds the damage lookup axis helper.',
    evidence: ['ASM lines 2785-2788 initialize _RAM_D0A5_ from _DATA_CFF_; ASM lines 2801-2837 update it in _LABEL_D36_.'],
  },
  {
    address: '$D0DC',
    role: 'rolling_byte_accumulator_index_a',
    confidence: 'medium',
    summary: 'Rolling index incremented modulo 0x37 by _LABEL_D36_.',
    evidence: ['ASM lines 2813-2819 increment and wrap _RAM_D0DC_ modulo 0x37.'],
  },
  {
    address: '$D0DD',
    role: 'rolling_byte_accumulator_index_b',
    confidence: 'medium',
    summary: 'Rolling index incremented modulo 0x37 by _LABEL_D36_.',
    evidence: ['ASM lines 2804-2812 increment and wrap _RAM_D0DD_ modulo 0x37.'],
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

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => (entry.address || '').toUpperCase() === address.toUpperCase()) || null;
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

function buildCatalog(mapData) {
  const tableRegion = findRegionById(mapData, table.regionId);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-damage-lookup-audit.mjs',
    summary: {
      tableOffset: hex(table.offset),
      tableSizeBytes: table.size,
      width: table.width,
      height: table.height,
      seedTableOffset: hex(seedTable.offset, 4),
      seedTableSizeBytes: seedTable.size,
      routineCount: routines.length,
      consumerCount: consumerRoutines.length,
      ramVariableCount: ramRoles.length,
      assetPolicy: 'Metadata only: offsets, dimensions, routine labels, RAM addresses, and evidence. No ROM bytes or decoded gameplay values are embedded.',
    },
    table: {
      region: regionRef(tableRegion),
      label: table.label,
      offset: hex(table.offset),
      endInclusive: hex(table.offset + table.size - 1),
      size: table.size,
      layout: {
        shape: '17x17 byte lookup matrix',
        selectedValueScale: 8,
        selectedValueUse: 'subtracted from active entity/scripted remaining-value words by confirmed consumers',
      },
      confidence: 'high',
    },
    seedTable: {
      region: regionRef(findRegionById(mapData, seedTable.regionId)),
      label: seedTable.label,
      offset: hex(seedTable.offset, 4),
      endInclusive: hex(seedTable.offset + seedTable.size - 1, 4),
      size: seedTable.size,
      copiedTo: '$D0A5',
      consumer: '_LABEL_D36_',
      confidence: 'high',
    },
    routines: routines.map(routine => ({ ...routine, offset: hex(routine.offset) })),
    consumers: consumerRoutines,
    ramRoles,
    evidence: [
      'ASM line 24806 labels _DATA_13CE0_ as 289 bytes, matching a 17x17 byte matrix.',
      'ASM lines 5340-5375 and 5394-5401 are the only direct code paths found that index _DATA_13CE0_.',
      'ASM lines 5368-5375 read a table byte and multiply it by 8 before returning the result in HL.',
      'ASM lines 15010-15031 subtract the returned amount from IX+28/IX+29 in the entity damage apply path.',
      'ASM lines 19879-19896 subtract the returned amount from _RAM_D16A_ in a scripted/boss interaction path.',
      'ASM lines 2785-2788 initialize _RAM_D0A5_ from the 55-byte _DATA_CFF_ seed table used by _LABEL_D36_.',
    ],
    openQuestions: [
      'Name the two table axes by tracing the meanings of _RAM_C25C_, _RAM_D17D_, IX+25, and the _LABEL_D36_ jitter input.',
      'Confirm whether _RAM_D16A_ is boss HP, scripted object HP, or another remaining-value counter in each caller context.',
      'Measure frame timing around _LABEL_6793_ to reproduce the exact damage state transition in JavaScript.',
    ],
  };
}

function annotateRegion(region, annotation) {
  const before = regionRef(region);
  if (annotation.name && (!region.name || /^_LABEL_|^_DATA_/.test(region.name))) {
    region.name = annotation.name;
  }
  if (annotation.type) region.type = annotation.type;
  if (annotation.confidence && !region.confidence) region.confidence = annotation.confidence;
  if (annotation.notes) region.notes = annotation.notes;
  region.analysis = region.analysis || {};
  region.analysis.damageLookupAudit = {
    catalogId,
    kind: annotation.role,
    confidence: annotation.confidence,
    summary: annotation.summary,
    evidence: annotation.evidence,
    generatedAt: now,
    tool: 'tools/world-damage-lookup-audit.mjs',
  };
  return { before, after: regionRef(region), role: annotation.role, confidence: annotation.confidence };
}

function annotateRamEntry(entry, role) {
  const before = {
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || '',
    name: entry.name || '',
    notes: entry.notes || '',
  };
  entry.analysis = entry.analysis || {};
  entry.analysis.damageLookupAudit = {
    catalogId,
    kind: role.role,
    confidence: role.confidence,
    summary: role.summary,
    evidence: role.evidence,
    generatedAt: now,
    tool: 'tools/world-damage-lookup-audit.mjs',
  };
  return {
    before,
    after: {
      address: entry.address,
      size: entry.size || 0,
      type: entry.type || '',
      name: entry.name || '',
      notes: entry.notes || '',
    },
    role: role.role,
    confidence: role.confidence,
  };
}

function applyAnnotations(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const changedRam = [];
  const missingRam = [];

  const tableRegion = findRegionById(mapData, table.regionId);
  if (tableRegion) {
    changedRegions.push(annotateRegion(tableRegion, {
      role: 'damage_lookup_matrix',
      name: 'entity damage magnitude lookup table',
      type: 'data_table',
      confidence: 'high',
      summary: '17x17 byte lookup matrix used by _LABEL_1EC8_/_LABEL_1F17_; selected byte is multiplied by 8 and subtracted by damage consumers.',
      notes: '17x17 byte matrix used by damage/interaction routines; stores metadata only, not table values.',
      evidence: catalog.evidence,
    }));
  } else {
    missingRegions.push({ id: table.regionId, offset: hex(table.offset), role: 'damage_lookup_matrix' });
  }

  const seedRegion = findRegionById(mapData, seedTable.regionId);
  if (seedRegion) {
    changedRegions.push(annotateRegion(seedRegion, {
      role: 'rolling_accumulator_seed_table',
      name: 'rolling byte accumulator seed table',
      type: 'data_table',
      confidence: 'high',
      summary: '55-byte seed table copied into _RAM_D0A5_ before _LABEL_D36_ mutates that buffer for lookup jitter.',
      notes: '55-byte seed for the rolling accumulator used by damage/interaction lookup jitter; stores metadata only, not seed bytes.',
      evidence: [
        'ASM lines 2785-2788 copy 0x37 bytes from _DATA_CFF_ to _RAM_D0A5_.',
        'ASM lines 2801-2837 update _RAM_D0A5_ and return a derived byte in _LABEL_D36_.',
        'ASM lines 5344 and 5380 use _LABEL_D36_ in the _DATA_13CE0_ lookup path.',
      ],
    }));
  } else {
    missingRegions.push({ id: seedTable.regionId, offset: hex(seedTable.offset, 4), role: 'rolling_accumulator_seed_table' });
  }

  for (const routine of routines.concat(consumerRoutines)) {
    const region = findRegionById(mapData, routine.regionId);
    if (!region) {
      missingRegions.push({ id: routine.regionId, label: routine.label, role: routine.role });
      continue;
    }
    changedRegions.push(annotateRegion(region, routine));
  }

  for (const role of ramRoles) {
    const entry = findRam(mapData, role.address);
    if (!entry) {
      missingRam.push({ address: role.address, role: role.role });
      continue;
    }
    changedRam.push(annotateRamEntry(entry, role));
  }

  return { changedRegions, missingRegions, changedRam, missingRam };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let changes = { changedRegions: [], missingRegions: [], changedRam: [], missingRam: [] };

  if (apply) {
    changes = applyAnnotations(mapData, catalog);
    const finalCatalog = buildCatalog(mapData);
    mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(item => item.id !== catalogId);
    mapData.entityBehaviorCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'damage_lookup_audit',
      generatedAt: now,
      tool: 'tools/world-damage-lookup-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changes.changedRegions.length,
        missingRegions: changes.missingRegions.length,
        annotatedRamEntries: changes.changedRam.length,
        missingRamEntries: changes.missingRam.length,
      },
      changedRegions: changes.changedRegions,
      missingRegions: changes.missingRegions,
      annotatedRamEntries: changes.changedRam,
      missingRamEntries: changes.missingRam,
      evidence: finalCatalog.evidence,
      openQuestions: finalCatalog.openQuestions,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    table: catalog.table,
    seedTable: catalog.seedTable,
    routines: catalog.routines.map(routine => ({
      label: routine.label,
      offset: routine.offset,
      role: routine.role,
      confidence: routine.confidence,
    })),
    consumers: catalog.consumers,
    ramRoles: catalog.ramRoles.map(role => ({
      address: role.address,
      role: role.role,
      confidence: role.confidence,
    })),
    changes,
  }, null, 2));
}

main();
