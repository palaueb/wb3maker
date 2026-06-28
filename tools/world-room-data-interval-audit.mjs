#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-room-data-interval-audit.mjs';
const catalogId = 'world-room-data-interval-catalog-2026-06-26';
const reportId = 'room-data-interval-audit-2026-06-26';

const zoneGraphId = 'world-zone-graph-2026-06-24';
const triggerRecordCatalogId = 'world-zone-trigger-record-catalog-2026-06-25';
const triggerDestinationRoleCatalogId = 'world-zone-trigger-destination-role-catalog-2026-06-25';
const zoneRecipeCatalogId = 'world-zone-recipe-catalog-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function offsetOf(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 16);
  return NaN;
}

function regionStart(region) {
  return offsetOf(region.offset);
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

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
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

function decodeVramLoader8fbRecords(rom, offset, limitBytes) {
  const records = [];
  const warnings = [];
  let pc = offset;
  let curVramTile = 0;
  let curBank = 8;
  let curBlockIdx = 0;
  const limit = offset + Number(limitBytes || 0);

  for (let entryIndex = 0; entryIndex < 256 && pc < rom.length && pc < limit; entryIndex++) {
    const recordStart = pc;
    const count = rom[pc++];
    if (count === 0) {
      records.push({
        kind: 'vram_loader_8fb_terminator',
        entryIndex,
        start: recordStart,
        endExclusive: pc,
      });
      break;
    }
    if (pc + 3 >= rom.length || pc + 4 > limit) {
      warnings.push(`8FB entry ${entryIndex} truncated at ${hex(recordStart)}`);
      break;
    }
    const vramLo = rom[pc++], vramHi = rom[pc++];
    const srcLo = rom[pc++], srcHi = rom[pc++];
    const vramWord = vramLo | (vramHi << 8);
    const srcWord = srcLo | (srcHi << 8);
    if (vramWord !== 0xFFFF) curVramTile = vramWord;
    if (srcWord !== 0xFFFF) {
      curBank = srcHi >> 1;
      curBlockIdx = ((srcHi & 1) << 8) | srcLo;
    }
    const sourceStart = curBank * 0x4000 + curBlockIdx * 32;
    records.push({
      kind: 'vram_loader_8fb_record',
      entryIndex,
      start: recordStart,
      endExclusive: pc,
      count,
      vramTileRange: {
        start: hex(curVramTile, 3),
        end: hex(curVramTile + count - 1, 3),
        count,
      },
      source: {
        bank: curBank,
        block: hex(curBlockIdx, 3),
        romRange: [hex(sourceStart), hex(sourceStart + count * 32)],
      },
    });
    curVramTile += count;
    curBlockIdx += count;
  }

  return { records, warnings };
}

function descriptorInterval(mapData, descriptor) {
  const start = offsetOf(descriptor.descriptorOffset);
  const region = descriptor.descriptorRegionId
    ? findRegionById(mapData, descriptor.descriptorRegionId)
    : findContainingRegion(mapData, start);
  return {
    id: `zone_descriptor_${descriptor.descriptorOffset.replace(/^0x/i, '').toUpperCase()}`,
    kind: 'zone_descriptor_record',
    startOffset: hex(start),
    endExclusive: hex(start + 6),
    byteLength: 6,
    region: compactRegion(region),
    sourceCatalogId: zoneGraphId,
    descriptorId: descriptor.id,
    descriptorOffset: descriptor.descriptorOffset,
    subrecordOffset: descriptor.subrecord?.romOffset || null,
    triggerTableOffset: descriptor.subrecord?.doorTableRomOffset || null,
    vramLoader8fbOffset: descriptor.subrecord?.vramLoader8fbRomOffset || null,
    recipeId: `zone_recipe_${descriptor.descriptorOffset.replace(/^0x/i, '').toUpperCase()}`,
    confidence: descriptor.valid ? 'high' : 'medium',
    evidence: 'Descriptor interval comes from the validated zone graph produced by _LABEL_2620_ / _LABEL_26F4_ parsing.',
  };
}

function triggerRecordInterval(mapData, table, record) {
  const start = offsetOf(record.entryOffset);
  return {
    id: `${table.id}_record_${String(record.index).padStart(2, '0')}`,
    kind: 'room_trigger_record',
    startOffset: hex(start),
    endExclusive: hex(start + 7),
    byteLength: 7,
    region: compactRegion(findContainingRegion(mapData, start)),
    sourceCatalogId: triggerRecordCatalogId,
    triggerTableId: table.id,
    triggerTableOffset: table.romOffset,
    recordIndex: record.index,
    opcodeIndex: record.opcode?.index ?? null,
    opcodeRaw: record.opcode?.raw || null,
    opcodeKind: record.opcode?.classification?.kind || null,
    destinationDescriptorId: record.destination?.descriptorId || null,
    destinationRomOffset: record.destination?.romOffset || null,
    confidence: table.graphComparison?.mismatchCount === 0 && !(table.graphComparison?.warnings || []).length ? 'high' : 'medium',
    evidence: 'Trigger record interval comes from the _LABEL_4816_ / _LABEL_48A9_ 7-byte record parser and is cross-checked against zone graph doorTable entries.',
  };
}

function triggerTerminatorInterval(mapData, table) {
  const start = offsetOf(table.terminatorOffset);
  if (!Number.isFinite(start)) return null;
  return {
    id: `${table.id}_terminator`,
    kind: 'room_trigger_table_terminator',
    startOffset: hex(start),
    endExclusive: hex(start + 1),
    byteLength: 1,
    region: compactRegion(findContainingRegion(mapData, start)),
    sourceCatalogId: triggerRecordCatalogId,
    triggerTableId: table.id,
    triggerTableOffset: table.romOffset,
    recordCount: table.recordCount,
    confidence: table.graphComparison?.mismatchCount === 0 && !(table.graphComparison?.warnings || []).length ? 'high' : 'medium',
    evidence: 'Terminator byte is the $FF sentinel consumed by _LABEL_4816_; only the offset and role are persisted.',
  };
}

function loaderRecordInterval(mapData, loader, record) {
  const region = findContainingRegion(mapData, record.start);
  if (region?.type !== 'room_data') return null;
  const end = Math.min(record.endExclusive, regionEnd(region));
  if (end <= record.start) return null;
  return {
    id: `vram_loader_8fb_${hex(loader.start).replace(/^0x/i, '')}_entry_${String(record.entryIndex).padStart(2, '0')}`,
    kind: record.kind,
    startOffset: hex(record.start),
    endExclusive: hex(end),
    byteLength: end - record.start,
    region: compactRegion(region),
    sourceCatalogId: zoneGraphId,
    loaderOffset: hex(loader.start),
    loaderEndExclusive: hex(loader.endExclusive),
    loaderReferenceCount: loader.referenceCount,
    sampleDescriptorOffsets: loader.sampleDescriptors,
    entryIndex: record.entryIndex,
    tileCount: record.count || 0,
    vramTileRange: record.vramTileRange || null,
    source: record.source || null,
    confidence: loader.warningCount === 0 ? 'high' : 'medium',
    evidence: '8FB loader record interval comes from zone graph descriptor subrecord vramLoader8fb pointers and _LABEL_8FB_ record decoding.',
  };
}

function collectVramLoader8fbIntervals(mapData, rom, graph) {
  const byOffset = new Map();
  for (const descriptor of graph.descriptors || []) {
    const loader = descriptor.vramLoader8fb;
    if (!loader?.valid) continue;
    const start = offsetOf(loader.romOffset);
    const region = findContainingRegion(mapData, start);
    if (region?.type !== 'room_data') continue;
    const item = byOffset.get(start) || {
      start,
      endExclusive: start + Number(loader.consumedBytes || 0),
      consumedBytes: Number(loader.consumedBytes || 0),
      entries: Number(loader.entries || 0),
      totalTiles: Number(loader.totalTiles || 0),
      maxVramTile: loader.maxVramTile || null,
      warningCount: (loader.warnings || []).length,
      descriptorOffsets: [],
    };
    item.descriptorOffsets.push(descriptor.descriptorOffset);
    byOffset.set(start, item);
  }

  const intervals = [];
  const warnings = [];
  for (const loader of [...byOffset.values()].sort((a, b) => a.start - b.start)) {
    loader.referenceCount = loader.descriptorOffsets.length;
    loader.sampleDescriptors = loader.descriptorOffsets.slice(0, 12);
    const decoded = decodeVramLoader8fbRecords(rom, loader.start, loader.consumedBytes);
    warnings.push(...decoded.warnings.map(warning => `${hex(loader.start)}: ${warning}`));
    for (const record of decoded.records) {
      const interval = loaderRecordInterval(mapData, loader, record);
      if (interval) intervals.push(interval);
    }
  }

  return { intervals, warnings };
}

function payloadLengthForRole(role) {
  if (role.role === 'equipment_menu_source_list' && role.payload?.format === 'equipment_menu_source_list_4_slots') return 4;
  if (role.role === 'room_trigger_sequence_start' && role.payload?.format === 'room_trigger_sequence_start') return 1;
  if (role.role === 'player_position_restore_record' && role.payload?.format === 'room_transition_position_restore_record') return 3;
  return 0;
}

function payloadKindForRole(role) {
  if (role.role === 'equipment_menu_source_list') return 'equipment_menu_source_list';
  if (role.role === 'room_trigger_sequence_start') return 'room_trigger_sequence_start';
  if (role.role === 'player_position_restore_record') return 'room_transition_position_restore_record';
  return null;
}

function addRoleInterval(intervalsByKey, mapData, role, kind, start, endExclusive, extra = {}) {
  const region = findContainingRegion(mapData, start);
  if (region?.type !== 'room_data') return;
  const boundedEnd = Math.min(endExclusive, regionEnd(region));
  if (boundedEnd <= start) return;
  const key = `${kind}:${start}:${boundedEnd}`;
  const existing = intervalsByKey.get(key);
  if (existing) {
    existing.referenceCount++;
    if (existing.triggerRecordSamples.length < 12) {
      existing.triggerRecordSamples.push({
        triggerTableId: role.triggerTableId,
        entryOffset: role.entryOffset,
        opcodeIndex: role.opcodeIndex,
        role: role.role,
      });
    }
    return;
  }
  intervalsByKey.set(key, {
    id: `${kind}_${hex(start).replace(/^0x/i, '')}`,
    kind,
    startOffset: hex(start),
    endExclusive: hex(boundedEnd),
    byteLength: boundedEnd - start,
    region: compactRegion(region),
    sourceCatalogId: triggerDestinationRoleCatalogId,
    role: role.role,
    payloadFormat: role.payload?.format || null,
    consumer: role.consumer || null,
    referenceCount: 1,
    triggerRecordSamples: [{
      triggerTableId: role.triggerTableId,
      entryOffset: role.entryOffset,
      opcodeIndex: role.opcodeIndex,
      role: role.role,
    }],
    confidence: role.confidence || 'medium',
    evidence: 'Payload interval comes from the trigger-destination role audit and is backed by the listed ASM consumer.',
    ...extra,
  });
}

function collectTriggerDestinationPayloadIntervals(mapData, roleCatalog) {
  const intervalsByKey = new Map();
  const warnings = [];

  for (const role of roleCatalog?.recordRoles || []) {
    const payloadOffset = offsetOf(role.payload?.romOffset);
    if (!Number.isFinite(payloadOffset)) continue;

    if (role.role === 'form_stage_transition_record' && role.payload?.format === 'form_stage_transition_record') {
      if (role.payload.validShape === false) {
        warnings.push(`invalid form-stage transition payload at ${role.payload.romOffset || '?'}`);
        continue;
      }
      addRoleInterval(intervalsByKey, mapData, role, 'form_stage_transition_selector', payloadOffset, payloadOffset + 1, {
        stageTransitionOffset: hex(payloadOffset),
      });
      const first = offsetOf(role.payload.firstInlineDescriptor?.romOffset);
      if (Number.isFinite(first)) {
        addRoleInterval(intervalsByKey, mapData, role, 'form_stage_inline_descriptor', first, first + 6, {
          stageTransitionOffset: hex(payloadOffset),
          inlineDescriptorIndex: 0,
        });
      }
      const second = offsetOf(role.payload.secondInlineDescriptor?.romOffset);
      if (Number.isFinite(second)) {
        addRoleInterval(intervalsByKey, mapData, role, 'form_stage_inline_descriptor', second, second + 6, {
          stageTransitionOffset: hex(payloadOffset),
          inlineDescriptorIndex: 1,
        });
      }
      continue;
    }

    const length = payloadLengthForRole(role);
    const kind = payloadKindForRole(role);
    if (!length || !kind) continue;
    if (role.payload?.validShape === false) {
      warnings.push(`invalid ${kind} payload at ${role.payload.romOffset || '?'}`);
      continue;
    }
    addRoleInterval(intervalsByKey, mapData, role, kind, payloadOffset, payloadOffset + length);
  }

  return {
    intervals: [...intervalsByKey.values()].sort((a, b) => offsetOf(a.startOffset) - offsetOf(b.startOffset) || offsetOf(a.endExclusive) - offsetOf(b.endExclusive)),
    warnings,
  };
}

function intervalStart(interval) {
  return offsetOf(interval.startOffset);
}

function intervalEnd(interval) {
  return offsetOf(interval.endExclusive);
}

function buildRegionIntervals(intervals) {
  const byRegion = new Map();
  for (const interval of intervals) {
    const regionId = interval.region?.id || 'unmapped';
    if (!byRegion.has(regionId)) {
      byRegion.set(regionId, {
        region: interval.region,
        intervals: [],
      });
    }
    byRegion.get(regionId).intervals.push(interval);
  }

  return [...byRegion.values()].map(entry => {
    entry.intervals.sort((a, b) => intervalStart(a) - intervalStart(b) || intervalEnd(a) - intervalEnd(b));
    const overlaps = [];
    const gaps = [];
    let ownedBytes = 0;
    let previous = null;
    let cursor = Number.isFinite(offsetOf(entry.region?.offset)) ? offsetOf(entry.region.offset) : null;
    const regionLimit = cursor == null ? null : cursor + Number(entry.region?.size || 0);
    for (const interval of entry.intervals) {
      const start = intervalStart(interval);
      const end = intervalEnd(interval);
      ownedBytes += end - start;
      if (cursor != null && start > cursor) {
        gaps.push({
          id: `room_data_gap_${hex(cursor).replace(/^0x/i, '')}_${hex(start).replace(/^0x/i, '')}`,
          kind: 'room_data_unowned_gap',
          startOffset: hex(cursor),
          endExclusive: hex(start),
          byteLength: start - cursor,
          region: entry.region,
          precedingIntervalId: previous?.id || null,
          followingIntervalId: interval.id,
          confidence: 'low',
          status: 'unresolved_no_parser_owner',
          evidence: 'No descriptor, trigger-record, trigger-terminator, room-data-resident 8FB loader, or trigger-destination payload interval currently owns this byte range.',
        });
      }
      if (previous && intervalStart(interval) < intervalEnd(previous)) {
        overlaps.push({
          firstId: previous.id,
          firstRange: [previous.startOffset, previous.endExclusive],
          secondId: interval.id,
          secondRange: [interval.startOffset, interval.endExclusive],
          overlapRange: [hex(intervalStart(interval)), hex(Math.min(intervalEnd(previous), intervalEnd(interval)))],
        });
      }
      if (cursor != null && end > cursor) cursor = end;
      if (!previous || end > intervalEnd(previous)) previous = interval;
    }
    if (cursor != null && regionLimit != null && cursor < regionLimit) {
      gaps.push({
        id: `room_data_gap_${hex(cursor).replace(/^0x/i, '')}_${hex(regionLimit).replace(/^0x/i, '')}`,
        kind: 'room_data_unowned_gap',
        startOffset: hex(cursor),
        endExclusive: hex(regionLimit),
        byteLength: regionLimit - cursor,
        region: entry.region,
        precedingIntervalId: previous?.id || null,
        followingIntervalId: null,
        confidence: 'low',
        status: 'unresolved_no_parser_owner',
        evidence: 'No descriptor, trigger-record, trigger-terminator, room-data-resident 8FB loader, or trigger-destination payload interval currently owns this byte range.',
      });
    }

    const kindCounts = countBy(entry.intervals, interval => interval.kind);
    return {
      region: entry.region,
      intervalCount: entry.intervals.length,
      ownedByteCount: ownedBytes,
      gapCount: gaps.length,
      unownedByteCount: gaps.reduce((sum, gap) => sum + gap.byteLength, 0),
      intervalKindCounts: kindCounts,
      overlapCount: overlaps.length,
      overlaps,
      gaps,
      intervals: entry.intervals,
    };
  }).sort((a, b) => offsetOf(a.region?.offset || 0) - offsetOf(b.region?.offset || 0));
}

function buildCatalog(mapData, rom) {
  const graph = findCatalog(mapData, zoneGraphId);
  if (!graph) throw new Error(`Missing required catalog ${zoneGraphId}`);
  const triggerCatalog = findCatalog(mapData, triggerRecordCatalogId);
  if (!triggerCatalog) throw new Error(`Missing required catalog ${triggerRecordCatalogId}`);
  const triggerDestinationRoleCatalog = findCatalog(mapData, triggerDestinationRoleCatalogId);
  if (!triggerDestinationRoleCatalog) throw new Error(`Missing required catalog ${triggerDestinationRoleCatalogId}`);
  const zoneRecipeCatalog = findCatalog(mapData, zoneRecipeCatalogId);

  const intervals = [];
  for (const descriptor of graph.descriptors || []) {
    const interval = descriptorInterval(mapData, descriptor);
    if (interval.region?.type === 'room_data') intervals.push(interval);
  }

  for (const table of triggerCatalog.triggerTables || []) {
    for (const record of table.records || []) intervals.push(triggerRecordInterval(mapData, table, record));
    const terminator = triggerTerminatorInterval(mapData, table);
    if (terminator) intervals.push(terminator);
  }

  const vramLoader8fb = collectVramLoader8fbIntervals(mapData, rom, graph);
  intervals.push(...vramLoader8fb.intervals);
  const triggerDestinationPayload = collectTriggerDestinationPayloadIntervals(mapData, triggerDestinationRoleCatalog);
  intervals.push(...triggerDestinationPayload.intervals);

  const regionIntervals = buildRegionIntervals(intervals);
  const overlapCount = regionIntervals.reduce((sum, entry) => sum + entry.overlapCount, 0);
  const decoderWarningCount = vramLoader8fb.warnings.length + triggerDestinationPayload.warnings.length;
  const warningCount = overlapCount + decoderWarningCount;
  const intervalKindCounts = countBy(intervals, interval => interval.kind);
  const descriptorCount = intervalKindCounts.zone_descriptor_record || 0;
  const triggerRecordCount = intervalKindCounts.room_trigger_record || 0;
  const triggerTerminatorCount = intervalKindCounts.room_trigger_table_terminator || 0;
  const vramLoaderRecordCount = intervalKindCounts.vram_loader_8fb_record || 0;
  const vramLoaderTerminatorCount = intervalKindCounts.vram_loader_8fb_terminator || 0;
  const equipmentMenuSourceListCount = intervalKindCounts.equipment_menu_source_list || 0;
  const triggerSequenceStartCount = intervalKindCounts.room_trigger_sequence_start || 0;
  const positionRestoreRecordCount = intervalKindCounts.room_transition_position_restore_record || 0;
  const formStageTransitionIntervalCount = (intervalKindCounts.form_stage_transition_selector || 0)
    + (intervalKindCounts.form_stage_inline_descriptor || 0);
  const uniqueVramLoader8fbCount = new Set(vramLoader8fb.intervals.map(interval => interval.loaderOffset).filter(Boolean)).size;
  const gapCount = regionIntervals.reduce((sum, entry) => sum + entry.gapCount, 0);
  const unownedByteCount = regionIntervals.reduce((sum, entry) => sum + entry.unownedByteCount, 0);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [zoneGraphId, triggerRecordCatalogId, triggerDestinationRoleCatalogId, zoneRecipeCatalogId],
    sourceCatalogPresence: {
      [zoneGraphId]: Boolean(graph),
      [triggerRecordCatalogId]: Boolean(triggerCatalog),
      [triggerDestinationRoleCatalogId]: Boolean(triggerDestinationRoleCatalog),
      [zoneRecipeCatalogId]: Boolean(zoneRecipeCatalog),
    },
    intervalModel: {
      zoneDescriptorRecord: {
        byteLength: 6,
        sourceCatalogId: zoneGraphId,
        fieldLayout: [
          { offset: 0, field: 'scroll_x' },
          { offset: 1, field: 'scroll_y' },
          { offset: 2, field: 'camera_x' },
          { offset: 3, field: 'camera_y' },
          { offset: 4, field: 'subrecord_pointer_lo' },
          { offset: 5, field: 'subrecord_pointer_hi' },
        ],
      },
      roomTriggerRecord: {
        byteLength: 7,
        sourceCatalogId: triggerRecordCatalogId,
        fieldLayout: [
          { offset: 0, field: 'x_unit' },
          { offset: 1, field: 'y_anchor' },
          { offset: 2, field: 'x_span_units' },
          { offset: 3, field: 'y_span' },
          { offset: 4, field: 'raw_opcode' },
          { offset: 5, field: 'destination_pointer_lo' },
          { offset: 6, field: 'destination_pointer_hi' },
        ],
        terminator: '0xFF at byte +0',
      },
      vramLoader8fbRecord: {
        byteLength: 5,
        sourceCatalogId: zoneGraphId,
        fieldLayout: [
          { offset: 0, field: 'tile_count' },
          { offset: 1, field: 'vram_tile_pointer_lo_or_ff' },
          { offset: 2, field: 'vram_tile_pointer_hi_or_ff' },
          { offset: 3, field: 'source_tile_word_lo_or_ff' },
          { offset: 4, field: 'source_tile_word_hi_or_ff' },
        ],
        terminator: '0x00 at byte +0',
      },
      triggerDestinationPayloads: {
        sourceCatalogId: triggerDestinationRoleCatalogId,
        payloads: [
          {
            kind: 'equipment_menu_source_list',
            byteLength: 4,
            fieldLayout: [
              { offset: 0, field: 'menu_source_slot_0' },
              { offset: 1, field: 'menu_source_slot_1' },
              { offset: 2, field: 'menu_source_slot_2' },
              { offset: 3, field: 'menu_source_slot_3' },
            ],
          },
          {
            kind: 'room_trigger_sequence_start',
            byteLength: 1,
            fieldLayout: [{ offset: 0, field: 'trigger_sequence_id' }],
          },
          {
            kind: 'room_transition_position_restore_record',
            byteLength: 3,
            fieldLayout: [
              { offset: 0, field: 'player_x_lo' },
              { offset: 1, field: 'player_x_hi' },
              { offset: 2, field: 'player_y' },
            ],
          },
          {
            kind: 'form_stage_transition_selector',
            byteLength: 1,
            fieldLayout: [{ offset: 0, field: 'form_stage_selector' }],
          },
          {
            kind: 'form_stage_inline_descriptor',
            byteLength: 6,
            fieldLayout: [
              { offset: 0, field: 'inline_descriptor_scroll_x' },
              { offset: 1, field: 'inline_descriptor_scroll_y' },
              { offset: 2, field: 'inline_descriptor_camera_x' },
              { offset: 3, field: 'inline_descriptor_camera_y' },
              { offset: 4, field: 'inline_descriptor_subrecord_pointer_lo' },
              { offset: 5, field: 'inline_descriptor_subrecord_pointer_hi' },
            ],
          },
        ],
      },
    },
    summary: {
      regionCount: regionIntervals.length,
      intervalCount: intervals.length,
      ownedByteCount: regionIntervals.reduce((sum, entry) => sum + entry.ownedByteCount, 0),
      gapCount,
      unownedByteCount,
      descriptorIntervalCount: descriptorCount,
      triggerRecordIntervalCount: triggerRecordCount,
      triggerTerminatorIntervalCount: triggerTerminatorCount,
      vramLoader8fbIntervalCount: vramLoaderRecordCount + vramLoaderTerminatorCount,
      vramLoader8fbRecordIntervalCount: vramLoaderRecordCount,
      vramLoader8fbTerminatorIntervalCount: vramLoaderTerminatorCount,
      uniqueVramLoader8fbCount,
      equipmentMenuSourceListIntervalCount: equipmentMenuSourceListCount,
      triggerSequenceStartIntervalCount: triggerSequenceStartCount,
      positionRestoreRecordIntervalCount: positionRestoreRecordCount,
      formStageTransitionIntervalCount,
      triggerTableCount: triggerCatalog.summary?.uniqueTriggerTableCount || triggerCatalog.triggerTables?.length || 0,
      zoneGraphDescriptorCount: graph.summary?.descriptorCount || graph.descriptors?.length || 0,
      zoneRecipeCount: zoneRecipeCatalog?.summary?.recipeCount || 0,
      intervalKindCounts,
      decoderWarningCount,
      warningCount,
      overlapCount,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: byte ranges, field roles, parser/catalog references, descriptor ids, trigger ids, opcode classes, and destination ids. No ROM bytes, decoded maps, graphics, music, text, coordinates, hashes, screenshots, or pixels are embedded.',
    },
    regionIntervals,
    evidence: [
      'Zone descriptor intervals are from world-zone-graph-2026-06-24, whose descriptors are validated through _LABEL_2620_ / _LABEL_26F4_.',
      'Room trigger intervals are from world-zone-trigger-record-catalog-2026-06-25, whose 7-byte records are parsed from _LABEL_4816_ / _LABEL_48A9_ semantics.',
      '8FB loader record intervals are decoded only for loaders referenced by validated zone descriptors while their bytes still live inside broad room_data regions.',
      'Trigger destination payload intervals are imported from world-zone-trigger-destination-role-catalog-2026-06-25 and keep only ranges, roles, consumers, and references.',
      'The trigger-record catalog reports zero graph comparison mismatches, so trigger record intervals agree with zone graph doorTable entries.',
      'This catalog is an ownership index for existing parsed room-data bytes; it does not add or persist ROM payload bytes.',
    ],
    nextLeads: [
      'Use these intervals to resolve room_data source-word-shaped values in graphics lead audits.',
      'Extend interval ownership to deferred transition records once _DATA_4CAD_ and related staged transition payloads have byte-level decoders.',
      'Split broad room_data map regions only after confirming that the interval catalog covers all live descriptor and trigger consumers.',
    ],
    warnings: [...vramLoader8fb.warnings, ...triggerDestinationPayload.warnings],
  };
}

function annotateRegions(mapData, catalog) {
  const annotated = [];
  for (const entry of catalog.regionIntervals) {
    if (!entry.region?.id) continue;
    const region = findRegionById(mapData, entry.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.roomDataIntervalAudit = {
      catalogId,
      kind: 'room_data_parser_owned_byte_intervals',
      confidence: entry.overlapCount === 0 ? 'high' : 'medium',
      intervalCount: entry.intervalCount,
      ownedByteCount: entry.ownedByteCount,
      gapCount: entry.gapCount,
      unownedByteCount: entry.unownedByteCount,
      intervalKindCounts: entry.intervalKindCounts,
      overlapCount: entry.overlapCount,
      summary: `Parser-owned byte intervals cover ${entry.intervalCount} room-data record/sentinel ranges in this region.`,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      region: compactRegion(region),
      intervalCount: entry.intervalCount,
      ownedByteCount: entry.ownedByteCount,
      gapCount: entry.gapCount,
      unownedByteCount: entry.unownedByteCount,
      intervalKindCounts: entry.intervalKindCounts,
      overlapCount: entry.overlapCount,
    });
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotatedRegions = apply ? annotateRegions(mapData, catalog) : [];

  if (apply) {
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_data_interval_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      sourceCatalogPresence: catalog.sourceCatalogPresence,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      intervalModel: catalog.intervalModel,
      regionSummaries: catalog.regionIntervals.map(entry => ({
        region: entry.region,
        intervalCount: entry.intervalCount,
        ownedByteCount: entry.ownedByteCount,
        gapCount: entry.gapCount,
        unownedByteCount: entry.unownedByteCount,
        intervalKindCounts: entry.intervalKindCounts,
        overlapCount: entry.overlapCount,
        overlapSamples: entry.overlaps.slice(0, 8),
        gapSamples: entry.gaps.slice(0, 12),
      })),
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      annotatedRegions,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotatedRegions.length,
    },
    regionSummaries: catalog.regionIntervals.map(entry => ({
      region: entry.region,
      intervalCount: entry.intervalCount,
      ownedByteCount: entry.ownedByteCount,
      gapCount: entry.gapCount,
      unownedByteCount: entry.unownedByteCount,
      intervalKindCounts: entry.intervalKindCounts,
      overlapCount: entry.overlapCount,
    })),
  }, null, 2));
}

main();
