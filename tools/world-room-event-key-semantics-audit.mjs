#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-room-event-key-semantics-audit.mjs';
const catalogId = 'world-room-event-key-semantics-catalog-2026-06-26';
const reportId = 'room-event-key-semantics-audit-2026-06-26';
const schemaVersion = 1;

const roomEventTableCatalogId = 'world-room-event-table-catalog-2026-06-26';
const zoneRecipeEventTableCatalogId = 'world-zone-recipe-event-table-link-catalog-2026-06-26';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value.replace(/^\$/, '0x'), 16);
  return NaN;
}

function regionStart(region) {
  return parseHex(region.offset);
}

function regionEnd(region) {
  return regionStart(region) + Number(region.size || 0);
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function compactRam(entry) {
  if (!entry) return null;
  return {
    id: entry.id || '',
    address: entry.address || '',
    size: Number(entry.size || 0),
    type: entry.type || 'unknown',
    name: entry.name || '',
  };
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findContainingRegion(mapData, offset) {
  if (!Number.isFinite(offset)) return null;
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0)
      || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function findRamByAddress(mapData, address) {
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === address.toUpperCase()) || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function buildCatalog(mapData) {
  const roomEventTableCatalog = findCatalog(mapData, roomEventTableCatalogId);
  const zoneRecipeEventTableCatalog = findCatalog(mapData, zoneRecipeEventTableCatalogId);
  const producerRegion = compactRegion(findRegionById(mapData, 'r1761'));
  const schedulerRegion = compactRegion(findContainingRegion(mapData, 0x0627A));
  const slotUpdaterRegion = compactRegion(findRegionById(mapData, 'r2403'));
  const consumerRegion = compactRegion(findRegionById(mapData, 'r2405'));
  const overlayWriterRegion = compactRegion(findRegionById(mapData, 'r0339'));

  const formulas = [
    {
      id: 'producer_aligns_probe_x',
      expression: '_RAM_D21E_ = HL with L low nibble cleared',
      meaning: 'Horizontal room-event probe coordinate aligned to a 16-pixel tile boundary.',
      confidence: 'high',
      evidenceLines: [3473, 3474, 3479, 3481, 3482, 3483, 3485],
    },
    {
      id: 'producer_aligns_probe_y',
      expression: '_RAM_D220_ = E & 0xF0, with E required in [0x10, 0xBF]',
      meaning: 'Vertical room-event probe coordinate aligned to a 16-pixel tile boundary.',
      confidence: 'high',
      evidenceLines: [3474, 3475, 3476, 3477, 3478, 3479, 3480, 3484, 3486],
    },
    {
      id: 'event_table_key_x',
      expression: 'eventRecordByte0 == low((_RAM_D21E_ >> 4) & 0xFF)',
      meaning: 'First byte of each _RAM_CF60_ event-table record is the aligned probe X tile column.',
      confidence: 'high',
      evidenceLines: [14512, 14513, 14514, 14515, 14516, 14517, 14518, 14519, 14520, 14525, 14529],
    },
    {
      id: 'event_table_key_y',
      expression: 'eventRecordByte1 == (_RAM_D220_ >> 4)',
      meaning: 'Second byte of each _RAM_CF60_ event-table record is the aligned probe Y tile row.',
      confidence: 'high',
      evidenceLines: [14506, 14507, 14508, 14509, 14510, 14511, 14531, 14533],
    },
    {
      id: 'matched_event_spawn_position',
      expression: '_RAM_D026_ = _RAM_D21E_ + 0x0008; _RAM_D028_ = _RAM_D220_ + 0x08',
      meaning: 'Matched event object spawn position is centered within the 16-pixel tile.',
      confidence: 'high',
      evidenceLines: [14584, 14585, 14586, 14587, 14588, 14589, 14590],
    },
    {
      id: 'matched_event_spawn_direction',
      expression: '_RAM_D029_ = _RAM_C251_ ^ 0x01',
      meaning: 'Matched event object direction is opposite the player facing byte used by existing player-state metadata.',
      confidence: 'high',
      evidenceLines: [14591, 14592, 14593],
    },
  ];

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [roomEventTableCatalogId, zoneRecipeEventTableCatalogId],
    summary: {
      roomEventTableCatalogPresent: Boolean(roomEventTableCatalog),
      zoneRecipeEventTableCatalogPresent: Boolean(zoneRecipeEventTableCatalog),
      producerLabel: '_LABEL_118D_',
      producerRegionId: producerRegion?.id || '',
      schedulerLabel: '_LABEL_627A_',
      schedulerRegionId: schedulerRegion?.id || '',
      consumerLabel: '_LABEL_635D_',
      consumerRegionId: consumerRegion?.id || '',
      formulaCount: formulas.length,
      confirmedEventRecordKeyBytes: 2,
      downstreamResolvedRecipeCount: zoneRecipeEventTableCatalog?.summary?.resolvedRoomEventTableRecipeCount ?? null,
      downstreamNonEmptyRecipeCount: zoneRecipeEventTableCatalog?.summary?.recipesWithNonEmptyEventTable ?? null,
      uniqueEventTableCount: roomEventTableCatalog?.summary?.uniqueEventTablePointerCount ?? null,
      assetPolicy: 'Metadata only: labels, line numbers, formulas, RAM symbols, region ids, and aggregate catalog references. No event table bytes, object byte lists, payload bytes, graphics, screenshots, audio, or decoded assets are embedded.',
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    flow: {
      producer: {
        label: '_LABEL_118D_',
        region: producerRegion,
        role: 'tile_aligned_room_event_probe_coordinate_producer',
        inputs: [
          {
            callsiteLabel: '_LABEL_1797_',
            callsiteOffset: '0x01797',
            callsiteRegion: compactRegion(findContainingRegion(mapData, 0x01797)),
            inputSummary: 'HL is IX+3/IX+4 and DE is _RAM_D0EE_ before calling _LABEL_118D_.',
            confidence: 'medium_high',
            evidenceLines: [4368, 4369, 4370, 4371, 4372, 4373, 4374, 4375],
          },
          {
            callsiteLabel: '_LABEL_502D_',
            callsiteOffset: '0x0502D',
            callsiteRegion: compactRegion(findContainingRegion(mapData, 0x0502D)),
            inputSummary: 'HL is IX+3/IX+4 plus signed IX+38; DE is IX+6/IX+7 plus signed IX+39 before calling _LABEL_118D_.',
            confidence: 'high',
            evidenceLines: [12037, 12038, 12041, 12044, 12045, 12046, 12047, 12048, 12049, 12050, 12052, 12053, 12054, 12055, 12056, 12057, 12058, 12059, 12060, 12062, 12063, 12064, 12065],
          },
        ],
      },
      scheduler: {
        label: '_LABEL_627A_/_LABEL_62C6_',
        regions: [schedulerRegion, slotUpdaterRegion].filter(Boolean),
        role: 'overlay_request_flag_consumer_and_event_object_slot_initializer',
        summary: '_LABEL_627A_ consumes _RAM_D21D_, seeds paired _RAM_C740_ slots, then _LABEL_62C6_ copies _RAM_D21E_/_RAM_D220_ into slot coordinates and calls _LABEL_635D_.',
        evidenceLines: [14409, 14410, 14411, 14412, 14427, 14428, 14429, 14430, 14431, 14432, 14433, 14434, 14435, 14436, 14437, 14438, 14441, 14442, 14443, 14444, 14464, 14468, 14474],
      },
      consumer: {
        label: '_LABEL_635D_',
        region: consumerRegion,
        role: 'room_event_table_key_matcher_and_pending_object_writer',
        summary: '_LABEL_635D_ converts the aligned probe coordinates to tile keys, scans the _RAM_CF60_ table, and writes pending object side effects on a match.',
        evidenceLines: [14506, 14511, 14512, 14520, 14521, 14525, 14529, 14531, 14533, 14549, 14572, 14575, 14577, 14584, 14590, 14591, 14593],
      },
      overlayWriter: {
        label: '_DATA_10000_',
        region: overlayWriterRegion,
        role: 'room_overlay_tile_record_table_used_when_probe_changes_room_tile',
        summary: '_LABEL_118D_ either writes the selected overlay tile index or zero to the room/collision tile and then uses _DATA_10000_ to update the on-screen tile pair.',
        evidenceLines: [3539, 3540, 3541, 3542, 3543, 3544, 3545, 3546, 3547, 3548, 3549, 3550, 3551, 3565, 3566, 3567, 3568, 3569, 3570, 3574, 3608],
      },
    },
    formulas,
    ramRoles: [
      {
        address: '$D21E',
        role: 'room_event_probe_aligned_x_word',
        confidence: 'high',
        summary: 'Tile-aligned horizontal probe coordinate; _LABEL_635D_ uses low((_RAM_D21E_ >> 4) & 0xFF) as event-table byte 0.',
      },
      {
        address: '$D220',
        role: 'room_event_probe_aligned_y_byte',
        confidence: 'high',
        summary: 'Tile-aligned vertical probe coordinate; _LABEL_635D_ uses _RAM_D220_ >> 4 as event-table byte 1.',
      },
      {
        address: '$D21D',
        role: 'room_overlay_event_request_flag',
        confidence: 'high',
        summary: 'Set by _LABEL_118D_ when a room tile interaction should queue the C740 overlay/event object scheduler.',
      },
      {
        address: '$D026',
        role: 'matched_room_event_spawn_x_center',
        confidence: 'high',
        summary: 'Set to _RAM_D21E_ + 0x0008 after a _RAM_CF60_ event-table match.',
      },
      {
        address: '$D028',
        role: 'matched_room_event_spawn_y_center',
        confidence: 'high',
        summary: 'Set to _RAM_D220_ + 0x08 after a _RAM_CF60_ event-table match.',
      },
      {
        address: '$D029',
        role: 'matched_room_event_spawn_direction',
        confidence: 'high',
        summary: 'Set to _RAM_C251_ ^ 0x01 after a _RAM_CF60_ event-table match.',
      },
    ],
    evidence: [
      'ASM lines 3473-3486 in _LABEL_118D_ align the incoming HL/E coordinates to 16-pixel boundaries and store them in _RAM_D21E_/_RAM_D220_.',
      'ASM lines 14506-14520 in _LABEL_635D_ convert _RAM_D220_ and _RAM_D21E_ into tile-row/tile-column key bytes.',
      'ASM lines 14525-14534 compare event table byte 0 with C and byte 1 with B before decoding the event payload.',
      'ASM lines 14584-14593 write centered spawn coordinates and direction after a matching room-event record.',
      `${roomEventTableCatalogId} supplies the decoded _RAM_CF60_ table intervals and record kind counts.`,
      `${zoneRecipeEventTableCatalogId} links those tables to every zone recipe without storing table bytes.`,
      'No event table bytes, object byte lists, payload bytes, graphics, screenshots, audio, or decoded assets are stored.',
    ],
    nextLeads: [
      'Use the confirmed key model to add coordinate labels to event-table record previews only after deciding how to avoid persisting raw event key byte lists.',
      'Trace the _LABEL_1797_ and _LABEL_502D_ callsites deeper to name which player forms or actions produce room-event probes.',
      'Use _RAM_D21E_/_RAM_D220_ center formulas when simulating item/reward object spawn positions from event-table matches.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const changedRam = [];
  const regionRoles = new Map();
  const addRegionRole = (region, payload) => {
    if (!region) return;
    if (!regionRoles.has(region.id)) regionRoles.set(region.id, { region, roles: [] });
    regionRoles.get(region.id).roles.push(payload);
  };

  addRegionRole(findRegionById(mapData, 'r1761'), {
    role: 'room_event_probe_coordinate_producer',
    confidence: 'high',
    summary: '_LABEL_118D_ aligns interaction probe coordinates and seeds _RAM_D21E_/_RAM_D220_ for _LABEL_635D_ event-table keys.',
  });
  addRegionRole(findContainingRegion(mapData, 0x0627A), {
    role: 'room_event_probe_scheduler',
    confidence: 'high',
    summary: '_LABEL_627A_ consumes _RAM_D21D_ and seeds C740 paired slots before _LABEL_62C6_ calls _LABEL_635D_.',
  });
  addRegionRole(findRegionById(mapData, 'r2403'), {
    role: 'room_event_probe_slot_initializer',
    confidence: 'high',
    summary: '_LABEL_62C6_ copies _RAM_D21E_/_RAM_D220_ into C740 slot coordinates and calls _LABEL_635D_.',
  });
  addRegionRole(findRegionById(mapData, 'r2405'), {
    role: 'room_event_table_key_matcher',
    confidence: 'high',
    summary: '_LABEL_635D_ derives X/Y tile keys from _RAM_D21E_/_RAM_D220_ and scans _RAM_CF60_.',
  });
  addRegionRole(findRegionById(mapData, 'r0339'), {
    role: 'room_overlay_tile_record_table_for_event_probe',
    confidence: 'high',
    summary: '_LABEL_118D_ uses _DATA_10000_ overlay records after a tile interaction updates the room tile.',
  });

  for (const { region, roles } of regionRoles.values()) {
    const confidence = roles.every(role => role.confidence === 'high') ? 'high' : 'medium';
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.roomEventKeySemanticsAudit = {
        catalogId,
        kind: 'room_event_key_semantics_region_overlay',
        confidence,
        roles: [...new Set(roles.map(role => role.role))],
        roleCounts: countBy(roles, role => role.role),
        summaries: roles.map(role => role.summary),
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      roles: [...new Set(roles.map(role => role.role))],
      roleCounts: countBy(roles, role => role.role),
      confidence,
    });
  }

  for (const ramRole of catalog.ramRoles) {
    const entry = findRamByAddress(mapData, ramRole.address);
    if (!entry) continue;
    if (apply) {
      entry.analysis = entry.analysis || {};
      entry.analysis.roomEventKeySemanticsAudit = {
        catalogId,
        kind: ramRole.role,
        confidence: ramRole.confidence,
        summary: ramRole.summary,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      id: entry.id,
      address: entry.address,
      name: entry.name || '',
      role: ramRole.role,
      confidence: ramRole.confidence,
    });
  }

  return { changedRegions, changedRam };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_event_key_semantics_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        changedRegionCount: annotation.changedRegions.length,
        changedRamCount: annotation.changedRam.length,
      },
      changedRegions: annotation.changedRegions,
      changedRam: annotation.changedRam,
      formulas: catalog.formulas,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      changedRegionCount: annotation.changedRegions.length,
      changedRamCount: annotation.changedRam.length,
    },
    changedRegions: annotation.changedRegions,
    changedRam: annotation.changedRam,
  }, null, 2));
}

main();
