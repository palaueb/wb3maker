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
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-room-event-table-audit.mjs';
const catalogId = 'world-room-event-table-catalog-2026-06-26';
const reportId = 'room-event-table-audit-2026-06-26';
const schemaVersion = 1;

const zoneGraphId = 'world-zone-graph-2026-06-24';
const itemIdProducerCatalogId = 'world-item-vram-id-producer-catalog-2026-06-26';
const lookupTableOffset = 0x063E2;
const lookupTableEntryCount = 31;
const bank4 = 4;

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

function readWordLE(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function bankedZ80ToRomOffset(bank, z80Address) {
  if (z80Address < 0x8000 || z80Address > 0xBFFF) return null;
  return bank * 0x4000 + (z80Address - 0x8000);
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

function selectorGroup(selectorId) {
  if (selectorId < 0x10) return 'inline_00_0f';
  if (selectorId < 0x20) return 'inline_10_1f';
  if (selectorId < 0x30) return 'inline_20_2f';
  if (selectorId < 0x40) return 'bank4_window_13c00_30_3f';
  if (selectorId < 0x48) return 'bank4_window_13c0a_40_47';
  return 'rejected_48_7f';
}

function classifyD025Value(value) {
  const selectorId = value & 0x7F;
  return {
    highBitSet: Boolean(value & 0x80),
    selectorId,
    itemVramSelectorAccepted: selectorId < 0x48,
    selectorGroup: selectorGroup(selectorId),
  };
}

function valueStats(values) {
  const classifications = values.map(value => classifyD025Value(value));
  return {
    valueCount: values.length,
    highBitSetCount: classifications.filter(item => item.highBitSet).length,
    selectorAcceptedAfterMaskCount: classifications.filter(item => item.itemVramSelectorAccepted).length,
    selectorRejectedAfterMaskCount: classifications.filter(item => !item.itemVramSelectorAccepted).length,
    uniqueSelectorIdAfterMaskCount: new Set(classifications.map(item => item.selectorId)).size,
    selectorGroupCounts: countBy(classifications, item => item.selectorGroup),
  };
}

function decodeRoomEventTable(mapData, rom, startOffset) {
  const records = [];
  const knownD025Values = [];
  const warnings = [];
  let pc = startOffset;
  let terminated = false;
  let terminatorOffset = null;

  for (let recordIndex = 0; recordIndex < 128 && pc < rom.length; recordIndex++) {
    const recordOffset = pc;
    const firstKey = rom[pc];
    if (firstKey === 0xFF) {
      pc += 1;
      terminated = true;
      terminatorOffset = recordOffset;
      break;
    }
    if (pc + 2 >= rom.length) {
      warnings.push(`Room event record at ${hex(recordOffset)} is truncated before the event-kind byte.`);
      break;
    }

    const eventKindByte = rom[pc + 2];
    let kind = 'lookup_pickup_object_id';
    let byteLength = 3;
    let d025Source = '_DATA_63E2_[eventKindByte - 1]';
    let selectorOutcome = null;

    if (eventKindByte === 0x00) {
      kind = 'special_constant_46_with_payload';
      byteLength = 6;
      d025Source = 'constant 0x46 plus three-byte payload copied to _RAM_D001_/_RAM_D003_';
      knownD025Values.push(0x46);
      selectorOutcome = classifyD025Value(0x46);
    } else if (eventKindByte === 0xFF) {
      kind = 'special_constant_5b';
      d025Source = 'constant 0x5B';
      knownD025Values.push(0x5B);
      selectorOutcome = classifyD025Value(0x5B);
    } else if (eventKindByte <= lookupTableEntryCount) {
      const d025Value = rom[lookupTableOffset + eventKindByte - 1];
      knownD025Values.push(d025Value);
      selectorOutcome = classifyD025Value(d025Value);
    } else {
      kind = 'lookup_index_outside_data_63e2';
      d025Source = '_DATA_63E2_ index would exceed the confirmed 31-byte table';
      warnings.push(`Room event record at ${hex(recordOffset)} uses an object index beyond _DATA_63E2_ bounds.`);
    }

    records.push({
      recordIndex,
      recordOffset: hex(recordOffset),
      endOffsetExclusive: hex(recordOffset + byteLength),
      byteLength,
      kind,
      d025Source,
      selectorOutcome: selectorOutcome
        ? {
            highBitSet: selectorOutcome.highBitSet,
            itemVramSelectorAccepted: selectorOutcome.itemVramSelectorAccepted,
            selectorGroup: selectorOutcome.selectorGroup,
          }
        : null,
    });
    pc += byteLength;
  }

  if (!terminated && !warnings.length) warnings.push(`Room event table at ${hex(startOffset)} did not terminate within 128 records.`);

  return {
    startOffset: hex(startOffset),
    endOffsetExclusive: hex(pc),
    byteLength: pc - startOffset,
    recordCount: records.length,
    terminated,
    terminatorOffset: terminatorOffset == null ? null : hex(terminatorOffset),
    containingRegion: compactRegion(findContainingRegion(mapData, startOffset)),
    recordKindCounts: countBy(records, record => record.kind),
    recordByteLengthCounts: countBy(records, record => String(record.byteLength)),
    selectorOutcomeCounts: countBy(records, record => record.selectorOutcome
      ? `${record.selectorOutcome.itemVramSelectorAccepted ? 'accepted' : 'rejected'}:${record.selectorOutcome.selectorGroup}`
      : 'unknown'),
    knownD025ValueStats: valueStats(knownD025Values),
    recordIntervals: records.map(record => ({
      recordIndex: record.recordIndex,
      recordOffset: record.recordOffset,
      endOffsetExclusive: record.endOffsetExclusive,
      byteLength: record.byteLength,
      kind: record.kind,
      d025Source: record.d025Source,
      selectorOutcome: record.selectorOutcome,
    })),
    warnings,
  };
}

function subrecordFieldRefs(mapData, rom, zoneGraph) {
  const refs = [];
  for (const descriptor of zoneGraph.descriptors || []) {
    const subrecordOffset = parseHex(descriptor.subrecord?.romOffset);
    if (!Number.isFinite(subrecordOffset)) continue;
    const z80Pointer = readWordLE(rom, subrecordOffset + 2);
    const romOffset = bankedZ80ToRomOffset(bank4, z80Pointer);
    refs.push({
      descriptorId: descriptor.id,
      descriptorOffset: descriptor.descriptorOffset,
      descriptorRegionId: descriptor.descriptorRegionId || '',
      subrecordOffset: hex(subrecordOffset),
      subrecordRegion: compactRegion(findContainingRegion(mapData, subrecordOffset)),
      cf60FieldOffset: hex(subrecordOffset + 2),
      eventTableZ80Pointer: hex(z80Pointer, 4),
      eventTableRomOffset: romOffset == null ? null : hex(romOffset),
      eventTableRegion: romOffset == null ? null : compactRegion(findContainingRegion(mapData, romOffset)),
    });
  }
  return refs;
}

function buildCatalog(mapData, rom) {
  const zoneGraph = (mapData.zoneGraphs || []).find(graph => graph.id === zoneGraphId);
  if (!zoneGraph) throw new Error(`Missing required zone graph: ${zoneGraphId}`);
  const itemIdProducerCatalog = findCatalog(mapData, itemIdProducerCatalogId);
  const refs = subrecordFieldRefs(mapData, rom, zoneGraph);
  const byTable = new Map();

  for (const ref of refs) {
    const key = ref.eventTableRomOffset || `invalid:${ref.eventTableZ80Pointer}`;
    if (!byTable.has(key)) byTable.set(key, []);
    byTable.get(key).push(ref);
  }

  const eventTables = [];
  for (const [key, tableRefs] of [...byTable.entries()].sort((a, b) => {
    const ao = parseHex(a[0]);
    const bo = parseHex(b[0]);
    if (Number.isFinite(ao) && Number.isFinite(bo)) return ao - bo;
    return String(a[0]).localeCompare(String(b[0]));
  })) {
    const romOffset = parseHex(key);
    const decoded = Number.isFinite(romOffset) ? decodeRoomEventTable(mapData, rom, romOffset) : null;
    const uniqueSubrecords = [...new Set(tableRefs.map(ref => ref.subrecordOffset))].sort();
    eventTables.push({
      id: Number.isFinite(romOffset) ? `room_event_table_${key.replace(/^0x/i, '')}` : `invalid_room_event_table_${eventTables.length}`,
      eventTableRomOffset: Number.isFinite(romOffset) ? key : null,
      eventTableZ80Pointer: tableRefs[0]?.eventTableZ80Pointer || null,
      region: decoded?.containingRegion || tableRefs[0]?.eventTableRegion || null,
      referenceCount: tableRefs.length,
      uniqueSubrecordCount: uniqueSubrecords.length,
      sampleDescriptorIds: tableRefs.slice(0, 12).map(ref => ref.descriptorId),
      sampleDescriptorOffsets: tableRefs.slice(0, 12).map(ref => ref.descriptorOffset),
      sampleSubrecordOffsets: uniqueSubrecords.slice(0, 12),
      decoded,
      confidence: decoded?.terminated && !(decoded.warnings || []).length ? 'high' : 'medium',
    });
  }

  const decodedTables = eventTables.filter(table => table.decoded);
  const nonEmptyTables = decodedTables.filter(table => table.decoded.recordCount > 0);
  const allKnownValues = decodedTables.flatMap(table => {
    const stats = [];
    for (const record of table.decoded.recordIntervals || []) {
      if (record.selectorOutcome) stats.push(record.selectorOutcome);
    }
    return stats;
  });

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [zoneGraphId, itemIdProducerCatalogId],
    summary: {
      zoneGraphPresent: Boolean(zoneGraph),
      itemIdProducerCatalogPresent: Boolean(itemIdProducerCatalog),
      descriptorRefCount: refs.length,
      uniqueSubrecordRefCount: new Set(refs.map(ref => ref.subrecordOffset)).size,
      uniqueEventTablePointerCount: eventTables.length,
      decodedEventTableCount: decodedTables.length,
      nonEmptyEventTableCount: nonEmptyTables.length,
      emptyEventTableCount: decodedTables.length - nonEmptyTables.length,
      terminatedEventTableCount: decodedTables.filter(table => table.decoded.terminated).length,
      totalDecodedRecordCount: decodedTables.reduce((sum, table) => sum + table.decoded.recordCount, 0),
      totalDecodedBytes: decodedTables.reduce((sum, table) => sum + table.decoded.byteLength, 0),
      eventTableRegionCount: new Set(decodedTables.map(table => table.region?.id).filter(Boolean)).size,
      eventTableRegionIds: [...new Set(decodedTables.map(table => table.region?.id).filter(Boolean))].sort(),
      recordKindCounts: countBy(decodedTables.flatMap(table => table.decoded.recordIntervals), record => record.kind),
      selectorOutcomeCounts: countBy(decodedTables.flatMap(table => table.decoded.recordIntervals), record => record.selectorOutcome
        ? `${record.selectorOutcome.itemVramSelectorAccepted ? 'accepted' : 'rejected'}:${record.selectorOutcome.selectorGroup}`
        : 'unknown'),
      selectorOutcomeRecordCount: allKnownValues.length,
      warningsCount: decodedTables.reduce((sum, table) => sum + (table.decoded.warnings || []).length, 0),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: room-subrecord field offsets, event-table pointers, table intervals, record counts, record kinds, selector outcome counts, region ids, and evidence. Event coordinate bytes, full object-id byte lists, payload bytes, graphics, screenshots, audio, and decoded assets are not embedded.',
    },
    layout: {
      copiedBy: '_LABEL_26F4_',
      cf5eBlock: '_LABEL_26F4_ copies 8 bytes from the selected room subrecord to _RAM_CF5E_.._RAM_CF65_.',
      cf60Field: 'Room subrecord bytes +2/+3 become _RAM_CF60_, the bank-4 room event table pointer consumed by _LABEL_635D_.',
      cf62Field: 'Room subrecord bytes +4/+5 become _RAM_CF62_, the entity-list pointer consumed by _LABEL_2948_.',
      recordModel: [
        'Each event record begins with two match key bytes checked against _LABEL_635D_ computed C and B values.',
        'A nonzero third byte normally indexes _DATA_63E2_ after subtracting 1.',
        'Third byte 0xFF writes constant 0x5B to _RAM_D025_.',
        'Third byte 0x00 writes constant 0x46 to _RAM_D025_ and consumes three payload bytes for _RAM_D001_/_RAM_D003_.',
        'A first byte of 0xFF terminates the table.',
      ],
      evidenceLines: [6472, 6473, 6474, 6475, 14521, 14524, 14525, 14526, 14549, 14550, 14552, 14553, 14555, 14558, 14559, 14568, 14571, 14572, 14575, 14576, 14577, 14578, 14579, 14580, 14581, 14582],
    },
    eventTables,
    subrecordFieldRefSummary: {
      subrecordRegionCounts: countBy(refs, ref => ref.subrecordRegion?.id || 'unknown'),
      eventTableRegionCounts: countBy(refs, ref => ref.eventTableRegion?.id || 'unknown'),
      samples: refs.slice(0, 24),
      sampleTruncated: refs.length > 24,
    },
    evidence: [
      'ASM lines 6472-6475 show _LABEL_26F4_ copying eight selected room-subrecord bytes into _RAM_CF5E_.._RAM_CF65_; therefore the word at subrecord +2/+3 is _RAM_CF60_.',
      'ASM line 14521 loads HL from _RAM_CF60_ before _LABEL_635D_ scans the room-event table in bank 4.',
      'ASM lines 14524-14547 prove each record begins with two match key bytes and either a one-byte object id or a zero-prefixed extended payload.',
      'ASM lines 14549-14577 prove the third byte drives _RAM_D025_ through _DATA_63E2_, constant 0x5B, or constant 0x46.',
      `${zoneGraphId} supplies the validated descriptor/subrecord offsets used to resolve all _RAM_CF60_ field pointers.`,
      `${itemIdProducerCatalogId} supplies the downstream _RAM_D025_ to _LABEL_1BE0_ selector relationship used for selector outcome counts.`,
      'No event coordinate bytes, full object-id byte lists, payload bytes, graphics, screenshots, audio, or decoded assets are stored.',
    ],
    nextLeads: [
      'Attach decoded event-table intervals to zone recipes so selecting a room can show event table presence and record counts without persisting event bytes.',
      'Trace _LABEL_635D_ caller inputs to name the two match-key bytes as tile, quadrant, or object-position coordinates.',
      'Render item/reward object VRAM provenance by combining accepted event-table selector outcomes with _LABEL_1BE0_/_LABEL_99B_ loader records.',
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

  addRegionRole(findRegionById(mapData, 'r2405'), {
    role: 'room_event_table_consumer',
    confidence: 'high',
    summary: '_LABEL_635D_ scans the _RAM_CF60_ room-event table and writes _RAM_D025_ side effects.',
    detail: catalog.layout,
  });

  const subrecordRegionCounts = catalog.subrecordFieldRefSummary.subrecordRegionCounts || {};
  for (const [regionId, refCount] of Object.entries(subrecordRegionCounts)) {
    addRegionRole(findRegionById(mapData, regionId), {
      role: 'room_subrecord_cf60_event_table_pointer_source',
      confidence: 'high',
      summary: 'Room subrecord byte field +2/+3 seeds _RAM_CF60_ for room-event table scanning.',
      detail: {
        refCount,
        layout: catalog.layout.cf60Field,
      },
    });
  }

  for (const table of catalog.eventTables) {
    addRegionRole(findRegionById(mapData, table.region?.id), {
      role: table.decoded?.recordCount ? 'room_event_table_bundle' : 'room_event_empty_table_sentinel',
      confidence: table.confidence,
      summary: table.decoded?.recordCount
        ? 'Contains _RAM_CF60_ room-event records consumed by _LABEL_635D_.'
        : 'Shared empty _RAM_CF60_ room-event table terminator.',
      detail: {
        eventTableRomOffset: table.eventTableRomOffset,
        eventTableZ80Pointer: table.eventTableZ80Pointer,
        referenceCount: table.referenceCount,
        uniqueSubrecordCount: table.uniqueSubrecordCount,
        decoded: table.decoded
          ? {
              byteLength: table.decoded.byteLength,
              recordCount: table.decoded.recordCount,
              terminated: table.decoded.terminated,
              terminatorOffset: table.decoded.terminatorOffset,
              recordKindCounts: table.decoded.recordKindCounts,
              selectorOutcomeCounts: table.decoded.selectorOutcomeCounts,
              knownD025ValueStats: table.decoded.knownD025ValueStats,
              warnings: table.decoded.warnings,
            }
          : null,
      },
    });
  }

  for (const { region, roles } of regionRoles.values()) {
    const confidence = roles.every(role => role.confidence === 'high') ? 'high' : 'medium';
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.roomEventTableAudit = {
        catalogId,
        kind: 'room_event_table_region_overlay',
        confidence,
        roles: [...new Set(roles.map(role => role.role))],
        roleCounts: countBy(roles, role => role.role),
        summaries: roles.map(role => role.summary),
        details: roles.map(role => ({
          role: role.role,
          confidence: role.confidence,
          summary: role.summary,
          detail: role.detail,
        })),
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

  const ramRoles = [
    ['$CF5E', 'room_subrecord_copied_block_base'],
    ['$CF60', 'room_event_table_pointer_from_subrecord_plus_2'],
    ['$CF62', 'room_entity_list_pointer_from_subrecord_plus_4'],
    ['$CF64', 'room_overlay_tile_record_index_from_subrecord_plus_6'],
    ['$CF65', 'current_zone_from_subrecord_plus_7'],
    ['$D001', 'room_event_payload_word_destination'],
    ['$D003', 'room_event_payload_byte_destination'],
    ['$D025', 'room_event_table_pending_object_id_destination'],
  ];
  for (const [address, role] of ramRoles) {
    const entry = findRamByAddress(mapData, address);
    if (!entry) continue;
    if (apply) {
      entry.analysis = entry.analysis || {};
      entry.analysis.roomEventTableAudit = {
        catalogId,
        kind: role,
        confidence: 'high',
        summary: `RAM ${address} participates in _LABEL_26F4_/_LABEL_635D_ room-event table flow.`,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      id: entry.id,
      address: entry.address,
      name: entry.name || '',
      role,
      confidence: 'high',
    });
  }

  return { changedRegions, changedRam };
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_event_table_audit',
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
