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
const toolName = 'tools/world-graphics-structured-source-occurrence-audit.mjs';
const remainingLeadCatalogId = 'world-graphics-remaining-lead-reconciliation-catalog-2026-06-26';
const sourceWordContextCatalogId = 'world-graphics-source-word-context-catalog-2026-06-26';
const roomSubrecordCatalogId = 'world-room-subrecord-catalog-2026-06-25';
const roomEntityListCatalogId = 'world-room-entity-list-catalog-2026-06-25';
const roomEntityOrphanListCatalogId = 'world-room-entity-orphan-list-catalog-2026-06-25';
const bank2VdpStreamLayoutCatalogId = 'world-bank2-vdp-stream-layout-catalog-2026-06-25';
const animationFrameSubrecordCatalogId = 'world-animation-frame-subrecord-catalog-2026-06-25';
const metaspriteTargetIntervalCatalogId = 'world-metasprite-target-interval-catalog-2026-06-26';
const playerA48TileStreamCatalogId = 'world-player-a48-tile-stream-catalog-2026-06-26';
const playerA48GapCandidateCatalogId = 'world-player-a48-gap-candidate-catalog-2026-06-26';
const dc2ScrollMapCatalogId = 'world-dc2-scroll-map-catalog-2026-06-25';
const roomOverlayRecordCatalogId = 'world-room-overlay-record-catalog-2026-06-25';
const roomDataIntervalCatalogId = 'world-room-data-interval-catalog-2026-06-26';
const bank0LookupDataCatalogId = 'world-bank0-lookup-data-catalog-2026-06-24';
const damageLookupCatalogId = 'world-damage-lookup-catalog-2026-06-25';
const graphicsLoaderCandidateCatalogId = 'world-graphics-loader-candidate-catalog-2026-06-25';
const graphicsLoaderCandidateConsumerCatalogId = 'world-graphics-loader-candidate-consumer-catalog-2026-06-25';
const bank7PreSequenceSidecarCatalogId = 'world-bank7-pre-sequence-sidecar-catalog-2026-06-25';
const smallDataCatalogId = 'world-small-data-catalog-2026-06-24';
const statusVdpWriterDetailCatalogId = 'world-status-vdp-writer-detail-catalog-2026-06-26';
const bank2StateMachineCatalogId = 'world-bank2-state-machine-catalog-2026-06-24';
const entityAnimationCatalogId = 'world-entity-animation-catalog-2026-06-24';
const unresolvedAssetConsumerCatalogId = 'world-unresolved-asset-consumer-catalog-2026-06-25';
const audioCatalogId = 'world-audio-catalog-2026-06-24';
const audioOpcodeDispatchCatalogId = 'world-audio-opcode-dispatch-catalog-2026-06-25';
const audioOpcodeStateEffectCatalogId = 'world-audio-opcode-state-effect-catalog-2026-06-25';
const animationCommandStreamCatalogId = 'world-animation-command-stream-catalog-2026-06-25';
const bank7MenuItemCatalogId = 'world-bank7-menu-item-catalog-2026-06-24';
const paletteScriptCatalogId = 'world-palette-script-catalog-2026-06-24';
const inputScriptCatalogId = 'world-input-script-catalog-2026-06-24';
const catalogId = 'world-graphics-structured-source-occurrence-catalog-2026-06-26';
const reportId = 'graphics-structured-source-occurrence-audit-2026-06-26';
const tileSizeBytes = 32;

const structuredLeadTypes = new Set([
  'pointer_table',
  'data_table',
  'room_data',
  'room_subrecord',
  'room_seq_table',
  'item_data',
  'entity_data',
  'entity_behavior_table',
  'entity_anim_table',
  'screen_prog',
  'screen_prog_table',
  'vdp_stream',
  'palette_script',
  'palette_script_table',
  'input_script',
  'effect_script',
  'audio_driver_data',
  'meta_sprite',
  'entity_anim_script',
  'tile_map',
]);

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

function optionalCatalog(mapData, id) {
  return findCatalog(mapData, id);
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function containingRegion(mapData, offset) {
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

function topCounts(counts, limit = 12) {
  return Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function unique(values) {
  return [...new Set(values.filter(value => value != null && value !== ''))];
}

function rangeOverlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function findOverlappingInterval(intervals, start, end) {
  return (intervals || []).find(interval => rangeOverlaps(start, end, interval.start, interval.end)) || null;
}

function addInterval(map, regionId, interval) {
  if (!regionId) return;
  if (!map.has(regionId)) map.set(regionId, []);
  map.get(regionId).push(interval);
}

function compactResolvedContext(context) {
  if (!context) return null;
  const compact = {
    kind: context.kind,
    confidence: context.confidence,
    disposition: context.disposition,
    priority: context.priority,
    parserRole: context.parserRole,
    sourceCatalogId: context.sourceCatalogId,
    reason: context.reason,
  };
  for (const key of [
    'subrecordIndexes',
    'subrecordByteOffsets',
    'fieldRoles',
    'listStart',
    'listEndExclusive',
    'recordOffsets',
    'recordIndexes',
    'recordByteOffsets',
    'recordKinds',
    'recordStride',
    'recordRange',
    'pointerTableRange',
    'pointerEntryIndexes',
    'pointerEntryOffsets',
    'pointerByteOffsets',
    'pointerTargets',
    'overlayRecordIndexes',
    'overlayRecordByteOffsets',
    'streamOffset',
    'streamEndExclusive',
    'streamIndex',
    'streamOffsets',
    'streamRanges',
    'streamRuntimeRange',
    'scriptRanges',
    'parsedRecordCount',
    'declaredTrailingRange',
    'roomDataIntervalKinds',
    'roomDataRecordIds',
    'roomDataRecordOffsets',
    'roomDataByteOffsets',
    'roomDataGapIds',
    'roomDataGapRanges',
    'underlyingSourceCatalogIds',
    'frameSubrecordId',
    'frameSubrecordOffset',
    'metaspriteTargetIntervalId',
    'metaspriteTargetOffset',
    'metaspriteTargetInterval',
    'pieceIndexes',
    'a48GapCandidateId',
    'a48GapCandidateRange',
    'a48GapId',
    'a48GapRange',
    'hasKnownPointerReference',
    'streamInterval',
    'gapInterval',
    'gapClass',
    'candidateConsumedRange',
    'gapTailRange',
    'tailCandidateClass',
    'tailCandidateRange',
    'tailCandidateResidualRange',
    'tailCandidateDecoder',
    'tailCandidateTileWordPairs',
    'tailCandidateControlCount',
    'boundaryRole',
    'boundaryRange',
    'objectListCount',
    'objectRecordCount',
    'objectTerminated',
    'objectNeighborKinds',
    'objectRecordIndexes',
    'objectRecordOffsets',
    'objectRecordByteOffsets',
    'objectRecordRange',
    'evidenceAuditKeys',
    'tableRange',
    'tableByteOffsets',
    'tableCellIndexes',
    'tableCellCoordinates',
    'tableRowBoundaryCrossed',
    'tableKinds',
    'candidateConsumerStatus',
    'candidateShapeStatus',
    'candidatePromotionAllowed',
    'candidateSourceRange',
    'directCandidateAsmRefCount',
    'aliasCount',
    'rawZ80WordOccurrenceCount',
  ]) {
    if (context[key] != null) compact[key] = context[key];
  }
  return compact;
}

function makeResolvedContext(kind, {
  confidence = 'low',
  disposition = 'structured_payload_overlap_unresolved_layout',
  priority = 'deprioritize_raw_source_word_hit',
  parserRole = '',
  sourceCatalogId = null,
  reason,
  ...extra
}) {
  return {
    kind,
    confidence,
    disposition,
    priority,
    parserRole,
    sourceCatalogId,
    reason,
    ...extra,
  };
}

function subrecordFieldRole(byteIndex) {
  if (byteIndex === 0) return 'door_table_pointer_lo';
  if (byteIndex === 1) return 'door_table_pointer_hi';
  if (byteIndex === 2) return 'cf60_word_lo';
  if (byteIndex === 3) return 'cf60_word_hi';
  if (byteIndex === 4) return 'entity_list_pointer_lo';
  if (byteIndex === 5) return 'entity_list_pointer_hi';
  if (byteIndex === 6) return 'cf64_byte';
  if (byteIndex === 7) return 'cf65_byte';
  if (byteIndex === 8) return 'vram_loader_8fb_pointer_lo';
  if (byteIndex === 9) return 'vram_loader_8fb_pointer_hi';
  if (byteIndex >= 10 && byteIndex <= 15) return `dc2_index_${byteIndex - 10}`;
  if (byteIndex === 16) return 'flags_palette_and_998_selector';
  if (byteIndex === 17) return 'audio_request_id';
  return 'outside_subrecord_stride';
}

function entityRecordFieldRole(recordKind, byteIndex) {
  if (recordKind === 'alternate') return 'alternate_entity_type_dynamic_tile_selector';
  if (byteIndex === 0) return 'entity_type_dynamic_tile_selector';
  if (byteIndex === 1) return 'normal_record_parameter_0';
  if (byteIndex === 2) return 'normal_record_parameter_1';
  if (byteIndex === 3) return 'normal_record_parameter_2';
  return 'outside_entity_record';
}

function metaspritePieceFieldRole(byteIndex) {
  if (byteIndex === 0) return 'piece_x_offset_byte';
  if (byteIndex === 1) return 'piece_y_offset_byte';
  if (byteIndex === 2) return 'piece_tile_byte';
  return 'outside_piece_record';
}

function a48RecordFieldRole(recordKind, byteIndex) {
  if (recordKind === 'terminator') return 'stream_terminator';
  if (recordKind === 'zero_fill') return 'zero_fill_opcode';
  if (byteIndex === 0) return 'tile_block_count_opcode';
  if (byteIndex === 1) return 'source_word_lo';
  if (byteIndex === 2) return 'source_word_hi';
  return 'outside_a48_record';
}

function overlayRecordFieldRole(byteIndex) {
  const roles = [
    'top_row_vdp_write_0',
    'top_row_vdp_write_1',
    'next_row_vdp_write_0',
    'next_row_vdp_write_1',
    'top_row_vdp_write_2',
    'top_row_vdp_write_3',
    'next_row_vdp_write_2',
    'next_row_vdp_write_3',
  ];
  return roles[byteIndex] || 'outside_overlay_record';
}

function roomDataIntervalFieldRole(kind, byteIndex) {
  if (kind === 'zone_descriptor_record') {
    const roles = [
      'descriptor_scroll_x',
      'descriptor_scroll_y',
      'descriptor_camera_x',
      'descriptor_camera_y',
      'descriptor_subrecord_pointer_lo',
      'descriptor_subrecord_pointer_hi',
    ];
    return roles[byteIndex] || 'outside_zone_descriptor_record';
  }
  if (kind === 'room_trigger_record') {
    const roles = [
      'trigger_x_unit',
      'trigger_y_anchor',
      'trigger_x_span_units',
      'trigger_y_span',
      'trigger_raw_opcode',
      'trigger_destination_pointer_lo',
      'trigger_destination_pointer_hi',
    ];
    return roles[byteIndex] || 'outside_room_trigger_record';
  }
  if (kind === 'room_trigger_table_terminator') return 'trigger_table_ff_terminator';
  if (kind === 'vram_loader_8fb_record') {
    const roles = [
      'vram_loader_tile_count',
      'vram_loader_vram_tile_pointer_lo_or_ff',
      'vram_loader_vram_tile_pointer_hi_or_ff',
      'vram_loader_source_tile_word_lo_or_ff',
      'vram_loader_source_tile_word_hi_or_ff',
    ];
    return roles[byteIndex] || 'outside_vram_loader_8fb_record';
  }
  if (kind === 'vram_loader_8fb_terminator') return 'vram_loader_8fb_terminator';
  if (kind === 'equipment_menu_source_list') return `equipment_menu_source_slot_${byteIndex}`;
  if (kind === 'room_trigger_sequence_start') return byteIndex === 0 ? 'trigger_sequence_id' : 'outside_trigger_sequence_start';
  if (kind === 'room_transition_position_restore_record') {
    const roles = ['position_restore_player_x_lo', 'position_restore_player_x_hi', 'position_restore_player_y'];
    return roles[byteIndex] || 'outside_position_restore_record';
  }
  if (kind === 'form_stage_transition_selector') return byteIndex === 0 ? 'form_stage_selector' : 'outside_form_stage_transition_selector';
  if (kind === 'form_stage_inline_descriptor') {
    const roles = [
      'inline_descriptor_scroll_x',
      'inline_descriptor_scroll_y',
      'inline_descriptor_camera_x',
      'inline_descriptor_camera_y',
      'inline_descriptor_subrecord_pointer_lo',
      'inline_descriptor_subrecord_pointer_hi',
    ];
    return roles[byteIndex] || 'outside_form_stage_inline_descriptor';
  }
  return 'room_data_interval_payload_byte';
}

function sourceRegionEvidenceKeys(region) {
  const analysis = region?.analysis || {};
  return Object.keys(analysis)
    .filter(key => /Audit$/.test(key) || /audit/i.test(key))
    .filter(key => [
      'roomSubrecordAudit',
      'roomEntityListAudit',
      'roomEntityOrphanListAudit',
      'vdpStreamAudit',
      'bank2VdpStreamLayoutAudit',
      'screenProgAudit',
      'screenProgTableAudit',
      'zoneGraphAudit',
      'zoneRecipeAudit',
      'roomOverlayRecordAudit',
      'dc2ScrollMapAudit',
      'metaspriteAudit',
      'metaspriteTargetIntervalAudit',
      'animationFrameSubrecordAudit',
      'playerA48TileStreamAudit',
      'playerA48GapCandidateAudit',
      'animationCommandStreamAudit',
      'audioDriverDataAudit',
      'zoneTriggerRecordAudit',
      'zoneTriggerDestinationRoleAudit',
      'roomDataIntervalAudit',
      'bank0LookupDataAudit',
      'damageLookupAudit',
      'bank7PauseDataAudit',
      'bank7EntitySequenceAudit',
      'graphicsLoaderCandidateAudit',
      'graphicsLoaderCandidateConsumerAudit',
      'unresolvedAssetConsumerAudit',
      'bank7PreSequenceSidecarAudit',
      'smallDataAudit',
      'statusVdpWriterDetailAudit',
      'bank2StateMachineAudit',
      'entityAnimationAudit',
      'collisionBufferProvenanceAudit',
      'paletteTailSplitAudit',
      'paletteTailConsumerAudit',
      'paletteTailLayoutRefinementAudit',
      'audioAudit',
      'audioOpcodeHandlerAudit',
      'audioOpcodeStateEffectAudit',
      'animationNonRoomRootUsageAudit',
      'bank7MenuItemAudit',
      'paletteScriptAudit',
      'inputScriptAudit',
    ].includes(key))
    .sort();
}

function buildEntityListIntervals(mapData) {
  const intervalsByRegion = new Map();
  const reachedCatalog = optionalCatalog(mapData, roomEntityListCatalogId);
  for (const list of reachedCatalog?.entityLists || []) {
    const regionId = list.containingRegion?.id;
    const start = offsetOf(list.romOffset);
    const end = offsetOf(list.endExclusive);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    addInterval(intervalsByRegion, regionId, {
      start,
      end,
      sourceCatalogId: roomEntityListCatalogId,
      parserRole: 'room_entity_source_list',
      listKind: regionId === 'r2818' ? 'room_entity_empty_list_sentinel' : 'room_entity_source_list',
    });
  }

  const orphanCatalog = optionalCatalog(mapData, roomEntityOrphanListCatalogId);
  const orphanRegionId = orphanCatalog?.region?.id || orphanCatalog?.summary?.regionId;
  for (const list of orphanCatalog?.decodedLists || []) {
    const start = offsetOf(list.startOffset);
    const end = offsetOf(list.endExclusive);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    addInterval(intervalsByRegion, orphanRegionId, {
      start,
      end,
      sourceCatalogId: roomEntityOrphanListCatalogId,
      parserRole: 'orphan_room_entity_source_list',
      listKind: 'orphan_room_entity_source_list',
    });
  }

  for (const intervals of intervalsByRegion.values()) intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  return intervalsByRegion;
}

function buildMetaspriteIntervals(mapData) {
  const intervalsByRegion = new Map();
  const catalog = optionalCatalog(mapData, animationFrameSubrecordCatalogId);
  for (const regionEntry of catalog?.regions || []) {
    const regionId = regionEntry.region?.id;
    for (const subrecord of regionEntry.subrecords || []) {
      const start = typeof subrecord.start === 'number' ? subrecord.start : offsetOf(subrecord.offset);
      const end = (typeof subrecord.endInclusive === 'number' ? subrecord.endInclusive : offsetOf(subrecord.endOffsetInclusive)) + 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      addInterval(intervalsByRegion, regionId, {
        start,
        end,
        sourceCatalogId: animationFrameSubrecordCatalogId,
        parserRole: 'metasprite_frame_stream_subrecord',
        subrecord,
      });
    }
  }
  for (const intervals of intervalsByRegion.values()) intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  return intervalsByRegion;
}

function buildMetaspriteTargetIntervals(mapData) {
  const intervalsByRegion = new Map();
  const catalog = optionalCatalog(mapData, metaspriteTargetIntervalCatalogId);
  for (const entry of catalog?.regionIntervals || []) {
    const regionId = entry.region?.id;
    for (const interval of entry.intervals || []) {
      const start = offsetOf(interval.targetOffset);
      const end = offsetOf(interval.endExclusive);
      if (!regionId || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      addInterval(intervalsByRegion, regionId, {
        start,
        end,
        sourceCatalogId: metaspriteTargetIntervalCatalogId,
        parserRole: 'metasprite_target_frame_stream',
        interval,
      });
    }
  }
  for (const intervals of intervalsByRegion.values()) intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  return intervalsByRegion;
}

function buildPlayerA48Intervals(mapData) {
  const intervalsByRegion = new Map();
  const catalog = optionalCatalog(mapData, playerA48TileStreamCatalogId);
  for (const stream of catalog?.a48TileStreams || []) {
    const regionId = stream.streamRegion?.id;
    const start = offsetOf(stream.streamOffset);
    const endInclusive = offsetOf(stream.endInclusive);
    const end = endInclusive + 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    addInterval(intervalsByRegion, regionId, {
      start,
      end,
      sourceCatalogId: playerA48TileStreamCatalogId,
      parserRole: 'player_a48_tile_stream',
      stream,
    });
  }
  for (const intervals of intervalsByRegion.values()) intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  return intervalsByRegion;
}

function buildPlayerA48GapCandidateIntervals(mapData) {
  const intervalsByRegion = new Map();
  const catalog = optionalCatalog(mapData, playerA48GapCandidateCatalogId);
  for (const stream of catalog?.a48GapCandidateStreams || []) {
    const regionId = stream.streamRegion?.id;
    const start = offsetOf(stream.streamOffset);
    const end = offsetOf(stream.endExclusive);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    addInterval(intervalsByRegion, regionId, {
      start,
      end,
      sourceCatalogId: playerA48GapCandidateCatalogId,
      parserRole: 'player_a48_gap_candidate_tile_stream',
      stream,
    });
  }
  for (const intervals of intervalsByRegion.values()) intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  return intervalsByRegion;
}

function buildDc2Intervals(mapData) {
  const intervalsByRegion = new Map();
  const catalog = optionalCatalog(mapData, dc2ScrollMapCatalogId);
  for (const entry of catalog?.entries || []) {
    const regionId = entry.targetRegion?.id;
    const start = offsetOf(entry.romOffset);
    const runtimeEnd = start + Number(entry.runtimeConsumedBytes || 0);
    const declaredEnd = start + Number(entry.declaredRegionBytes || entry.runtimeConsumedBytes || 0);
    if (!Number.isFinite(start) || !Number.isFinite(runtimeEnd) || runtimeEnd <= start) continue;
    addInterval(intervalsByRegion, regionId, {
      start,
      end: runtimeEnd,
      declaredEnd: Number.isFinite(declaredEnd) && declaredEnd >= runtimeEnd ? declaredEnd : runtimeEnd,
      sourceCatalogId: dc2ScrollMapCatalogId,
      parserRole: 'dc2_compressed_scroll_map_stream',
      entry,
    });
  }
  for (const intervals of intervalsByRegion.values()) intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  return intervalsByRegion;
}

function buildDc2PointerTable(mapData) {
  const catalog = optionalCatalog(mapData, dc2ScrollMapCatalogId);
  const table = catalog?.pointerTable;
  if (!table) return null;
  const start = offsetOf(table.offset);
  const endInclusive = offsetOf(table.endInclusive);
  const entryCount = Number(table.entryCount || 0);
  const entriesByOffset = new Map();
  for (const entry of catalog?.entries || []) {
    const tableEntryOffset = offsetOf(entry.tableEntryOffset);
    if (!Number.isFinite(tableEntryOffset)) continue;
    entriesByOffset.set(tableEntryOffset, entry);
  }
  return {
    regionId: table.region?.id || null,
    start,
    end: endInclusive + 1,
    entryCount,
    entryStride: 2,
    entriesByOffset,
    sourceCatalogId: dc2ScrollMapCatalogId,
  };
}

function buildRoomOverlayTable(mapData) {
  const catalog = optionalCatalog(mapData, roomOverlayRecordCatalogId);
  if (!catalog?.table) return null;
  const start = offsetOf(catalog.table.offset || catalog.summary?.sourceOffset);
  const end = offsetOf(catalog.summary?.alignedEndExclusive) || (start + Number(catalog.summary?.alignedRecordBytes || 0));
  const regionId = catalog.table.region?.id || null;
  return {
    regionId,
    start,
    end,
    recordStride: Number(catalog.table.recordStride || catalog.summary?.recordStride || 8),
    recordCount: Number(catalog.table.recordCount || catalog.summary?.recordCount || 0),
    sourceCatalogId: roomOverlayRecordCatalogId,
  };
}

function buildRoomDataIntervals(mapData) {
  const intervalsByRegion = new Map();
  const catalog = optionalCatalog(mapData, roomDataIntervalCatalogId);
  for (const entry of catalog?.regionIntervals || []) {
    const regionId = entry.region?.id;
    for (const interval of entry.intervals || []) {
      const start = offsetOf(interval.startOffset);
      const end = offsetOf(interval.endExclusive);
      if (!regionId || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      addInterval(intervalsByRegion, regionId, {
        start,
        end,
        id: interval.id,
        kind: interval.kind,
        sourceCatalogId: interval.sourceCatalogId,
        parserRole: interval.kind,
        confidence: interval.confidence || 'medium',
      });
    }
  }
  for (const intervals of intervalsByRegion.values()) intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  return intervalsByRegion;
}

function buildRoomDataGaps(mapData) {
  const gapsByRegion = new Map();
  const catalog = optionalCatalog(mapData, roomDataIntervalCatalogId);
  for (const entry of catalog?.regionIntervals || []) {
    const regionId = entry.region?.id;
    for (const gap of entry.gaps || []) {
      const start = offsetOf(gap.startOffset);
      const end = offsetOf(gap.endExclusive);
      if (!regionId || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      addInterval(gapsByRegion, regionId, {
        start,
        end,
        id: gap.id,
        kind: gap.kind,
        sourceCatalogId: roomDataIntervalCatalogId,
        parserRole: 'room_data_unowned_gap',
        confidence: gap.confidence || 'low',
        precedingIntervalId: gap.precedingIntervalId || null,
        followingIntervalId: gap.followingIntervalId || null,
      });
    }
  }
  for (const gaps of gapsByRegion.values()) gaps.sort((a, b) => a.start - b.start || a.end - b.end);
  return gapsByRegion;
}

function buildVdpStreamIntervals(mapData) {
  const catalog = optionalCatalog(mapData, bank2VdpStreamLayoutCatalogId);
  return (catalog?.mergedIntervals || [])
    .map(interval => ({
      start: offsetOf(interval.startOffset),
      end: offsetOf(interval.endOffsetExclusive),
      kinds: interval.kinds || [],
      sourceCatalogId: bank2VdpStreamLayoutCatalogId,
      parserRole: 'bank2_vdp_stream_decoded_interval',
    }))
    .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function buildVdpStreamGaps(mapData) {
  const catalog = optionalCatalog(mapData, bank2VdpStreamLayoutCatalogId);
  return (catalog?.gaps || [])
    .map(gap => ({
      start: offsetOf(gap.startOffset),
      end: offsetOf(gap.endOffsetExclusive),
      size: Number(gap.size || 0),
      class: gap.class || 'unclassified_gap',
      confidence: gap.confidence || 'low',
      consumedBytes: gap.consumedBytes || null,
      controlCount: gap.controlCount || 0,
      tileWordPairs: gap.tileWordPairs || 0,
      objectListCount: gap.objectListCount || 0,
      objectRecordCount: gap.objectRecordCount || 0,
      objectRecordsByList: gap.objectRecordsByList || [],
      objectTerminated: Boolean(gap.objectTerminated),
      neighborObjectListEvidence: Boolean(gap.neighborObjectListEvidence),
      precedingKinds: gap.precedingKinds || [],
      followingKinds: gap.followingKinds || [],
      candidateTailClassification: gap.candidateTailClassification || null,
      sourceCatalogId: bank2VdpStreamLayoutCatalogId,
      parserRole: 'bank2_vdp_stream_gap_candidate',
    }))
    .filter(gap => Number.isFinite(gap.start) && Number.isFinite(gap.end) && gap.end > gap.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function buildResolverContext(mapData, rom) {
  const roomSubrecordCatalog = optionalCatalog(mapData, roomSubrecordCatalogId);
  return {
    rom,
    regionsById: new Map((mapData.regions || []).map(region => [region.id, region])),
    roomSubrecordCatalog,
    roomSubrecordLayout: roomSubrecordCatalog ? {
      start: offsetOf(roomSubrecordCatalog.summary?.subrecordStart || roomSubrecordCatalog.layout?.subrecordStart),
      end: offsetOf(roomSubrecordCatalog.summary?.subrecordEndExclusive || roomSubrecordCatalog.layout?.subrecordEndExclusive),
      stride: Number(roomSubrecordCatalog.summary?.subrecordStride || roomSubrecordCatalog.layout?.subrecordStride || 18),
      count: Number(roomSubrecordCatalog.summary?.subrecordCount || roomSubrecordCatalog.layout?.subrecordCount || 0),
    } : null,
    entityListIntervalsByRegion: buildEntityListIntervals(mapData),
    metaspriteIntervalsByRegion: buildMetaspriteIntervals(mapData),
    metaspriteTargetIntervalsByRegion: buildMetaspriteTargetIntervals(mapData),
    playerA48IntervalsByRegion: buildPlayerA48Intervals(mapData),
    playerA48GapCandidateIntervalsByRegion: buildPlayerA48GapCandidateIntervals(mapData),
    dc2IntervalsByRegion: buildDc2Intervals(mapData),
    dc2PointerTable: buildDc2PointerTable(mapData),
    roomOverlayTable: buildRoomOverlayTable(mapData),
    roomDataIntervalsByRegion: buildRoomDataIntervals(mapData),
    roomDataGapsByRegion: buildRoomDataGaps(mapData),
    vdpStreamIntervals: buildVdpStreamIntervals(mapData),
    vdpStreamGaps: buildVdpStreamGaps(mapData),
    availableCatalogs: [
      roomSubrecordCatalogId,
      roomEntityListCatalogId,
      roomEntityOrphanListCatalogId,
      bank2VdpStreamLayoutCatalogId,
      animationFrameSubrecordCatalogId,
      metaspriteTargetIntervalCatalogId,
      playerA48TileStreamCatalogId,
      playerA48GapCandidateCatalogId,
      dc2ScrollMapCatalogId,
      roomOverlayRecordCatalogId,
      roomDataIntervalCatalogId,
      bank0LookupDataCatalogId,
      damageLookupCatalogId,
      graphicsLoaderCandidateCatalogId,
      graphicsLoaderCandidateConsumerCatalogId,
      bank7PreSequenceSidecarCatalogId,
      smallDataCatalogId,
      statusVdpWriterDetailCatalogId,
      bank2StateMachineCatalogId,
      entityAnimationCatalogId,
      unresolvedAssetConsumerCatalogId,
      audioCatalogId,
      audioOpcodeDispatchCatalogId,
      audioOpcodeStateEffectCatalogId,
      animationCommandStreamCatalogId,
      bank7MenuItemCatalogId,
      paletteScriptCatalogId,
      inputScriptCatalogId,
    ].filter(id => optionalCatalog(mapData, id)),
  };
}

function resolveRoomSubrecordOverlap(occurrence, sourceRegion, context) {
  const layout = context.roomSubrecordLayout;
  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  if (!layout || !Number.isFinite(layout.start) || !Number.isFinite(layout.end)) {
    return makeResolvedContext('room_subrecord_payload_overlap_unresolved_layout', {
      parserRole: 'room_subrecord_table',
      reason: 'The hit is inside a room_subrecord region, but the room-subrecord catalog layout was unavailable.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    });
  }

  const subrecordIndexes = [];
  const byteOffsets = [];
  const fieldRoles = [];
  for (let byteOffset = occurrenceStart; byteOffset < occurrenceEnd; byteOffset++) {
    if (byteOffset < layout.start || byteOffset >= layout.end) {
      fieldRoles.push('room_subrecord_table_header_or_gap');
      continue;
    }
    const tableRelative = byteOffset - layout.start;
    const subrecordIndex = Math.floor(tableRelative / layout.stride);
    const subrecordByteOffset = tableRelative % layout.stride;
    subrecordIndexes.push(subrecordIndex);
    byteOffsets.push(subrecordByteOffset);
    fieldRoles.push(subrecordFieldRole(subrecordByteOffset));
  }

  return makeResolvedContext('room_subrecord_field_overlap', {
    confidence: 'medium',
    disposition: 'known_structured_payload_field_overlap',
    parserRole: 'room_subrecord_table',
    sourceCatalogId: roomSubrecordCatalogId,
    subrecordIndexes: unique(subrecordIndexes),
    subrecordByteOffsets: unique(byteOffsets),
    fieldRoles: unique(fieldRoles),
    reason: 'The source-word-shaped value overlaps fixed-stride room subrecord fields already decoded by the room-subrecord audit.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function resolveEntityListOverlap(rom, occurrence, sourceRegion, context) {
  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const intervals = context.entityListIntervalsByRegion.get(sourceRegion.id) || [];
  const list = findOverlappingInterval(intervals, occurrenceStart, occurrenceEnd);
  if (!list) {
    return makeResolvedContext('entity_data_payload_overlap_unresolved_list_boundary', {
      parserRole: 'room_entity_source_list',
      reason: 'The hit is inside entity_data, but no decoded entity-list interval from the current catalogs overlaps it.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    });
  }

  let cursor = list.start;
  let recordIndex = 0;
  const fieldRoles = [];
  const recordOffsets = [];
  const recordIndexes = [];
  const recordKinds = [];

  while (cursor < list.end && cursor < rom.length) {
    const recordStart = cursor;
    const entityType = rom[cursor];
    if (entityType === 0xFF) {
      const terminatorEnd = recordStart + 1;
      if (rangeOverlaps(occurrenceStart, occurrenceEnd, recordStart, terminatorEnd)) {
        fieldRoles.push('list_terminator');
        recordOffsets.push(recordStart);
        recordIndexes.push(recordIndex);
        recordKinds.push('terminator');
      }
      cursor = terminatorEnd;
      break;
    }

    const recordKind = entityType & 0x80 ? 'alternate' : 'normal';
    const recordEnd = recordStart + (recordKind === 'alternate' ? 1 : 4);
    if (rangeOverlaps(occurrenceStart, occurrenceEnd, recordStart, recordEnd)) {
      for (let byteOffset = Math.max(occurrenceStart, recordStart); byteOffset < Math.min(occurrenceEnd, recordEnd); byteOffset++) {
        fieldRoles.push(entityRecordFieldRole(recordKind, byteOffset - recordStart));
      }
      recordOffsets.push(recordStart);
      recordIndexes.push(recordIndex);
      recordKinds.push(recordKind);
    }
    cursor = recordEnd;
    recordIndex++;
  }

  if (!fieldRoles.length) fieldRoles.push('entity_list_boundary');

  return makeResolvedContext(
    list.listKind === 'orphan_room_entity_source_list'
      ? 'orphan_room_entity_list_record_field_overlap'
      : 'room_entity_list_record_field_overlap',
    {
      confidence: 'medium',
      disposition: 'known_structured_payload_field_overlap',
      parserRole: list.parserRole,
      sourceCatalogId: list.sourceCatalogId,
      listStart: hex(list.start),
      listEndExclusive: hex(list.end),
      recordOffsets: unique(recordOffsets).map(offset => hex(offset)),
      recordIndexes: unique(recordIndexes),
      recordKinds: unique(recordKinds),
      fieldRoles: unique(fieldRoles),
      reason: 'The source-word-shaped value overlaps bytes consumed by the confirmed room entity list parser.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    },
  );
}

function entityInitialMotionFieldRole(byteIndex) {
  if (byteIndex === 0) return 'entity_initial_motion_param_0_to_ix_plus_24';
  if (byteIndex === 1) return 'entity_initial_motion_param_1_to_ix_plus_25';
  if (byteIndex === 2) return 'entity_initial_motion_word_lo_to_ix_plus_28';
  if (byteIndex === 3) return 'entity_initial_motion_word_hi_to_ix_plus_29';
  return 'outside_entity_initial_motion_record';
}

function resolveKnownEntityDataOverlap(occurrence, sourceRegion) {
  const analysis = sourceRegion.analysis || {};
  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const start = regionStart(sourceRegion);
  const end = regionEnd(sourceRegion);

  if (analysis.bank2StateMachineAudit?.kind === 'state_machine_init_record_tail'
    && analysis.bank2StateMachineAudit.confidence === 'high') {
    const stride = 6;
    const fieldRoles = [];
    const recordIndexes = [];
    const recordOffsets = [];
    const byteOffsets = [];
    for (let byteOffset = Math.max(occurrenceStart, start); byteOffset < Math.min(occurrenceEnd, end); byteOffset++) {
      const relative = byteOffset - start;
      const recordIndex = Math.floor(relative / stride);
      const recordByteOffset = relative % stride;
      recordIndexes.push(recordIndex);
      recordOffsets.push(start + recordIndex * stride);
      byteOffsets.push(recordByteOffset);
      fieldRoles.push(`state_machine_init_record_byte_${recordByteOffset}`);
    }
    return makeResolvedContext('entity_data_state_machine_init_record_field_overlap', {
      confidence: 'high',
      disposition: 'known_structured_payload_field_overlap',
      parserRole: 'bank2_state_machine_init_record_table_tail',
      sourceCatalogId: bank2StateMachineCatalogId,
      recordOffsets: unique(recordOffsets).map(offset => hex(offset)),
      recordIndexes: unique(recordIndexes),
      recordByteOffsets: unique(byteOffsets),
      recordStride: stride,
      recordRange: {
        start: hex(start),
        endExclusive: hex(end),
        size: end - start,
      },
      fieldRoles: unique(fieldRoles),
      reason: 'The source-word-shaped value overlaps a high-confidence bank-2 randomized state-machine init record tail selected by _LABEL_901B_, not a graphics source table.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    });
  }

  if (analysis.entityAnimationAudit?.kind === 'entity_initial_motion_table'
    && analysis.entityAnimationAudit.confidence === 'high') {
    const stride = 4;
    const fieldRoles = [];
    const recordIndexes = [];
    const recordOffsets = [];
    const byteOffsets = [];
    for (let byteOffset = Math.max(occurrenceStart, start); byteOffset < Math.min(occurrenceEnd, end); byteOffset++) {
      const relative = byteOffset - start;
      const recordIndex = Math.floor(relative / stride);
      const recordByteOffset = relative % stride;
      recordIndexes.push(recordIndex);
      recordOffsets.push(start + recordIndex * stride);
      byteOffsets.push(recordByteOffset);
      fieldRoles.push(entityInitialMotionFieldRole(recordByteOffset));
    }
    return makeResolvedContext('entity_data_initial_motion_record_field_overlap', {
      confidence: 'high',
      disposition: 'known_structured_payload_field_overlap',
      parserRole: 'entity_initial_motion_table',
      sourceCatalogId: entityAnimationCatalogId,
      recordOffsets: unique(recordOffsets).map(offset => hex(offset)),
      recordIndexes: unique(recordIndexes),
      recordByteOffsets: unique(byteOffsets),
      recordStride: stride,
      recordRange: {
        start: hex(start),
        endExclusive: hex(end),
        size: end - start,
      },
      fieldRoles: unique(fieldRoles),
      reason: 'The source-word-shaped value overlaps the confirmed entity initial-motion table consumed by _LABEL_676D_, not a graphics source table.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    });
  }

  return null;
}

function collectObjectGapRecordOverlap(occurrenceStart, occurrenceEnd, gap) {
  const recordIndexes = [];
  const recordOffsets = [];
  const recordByteOffsets = [];
  const recordRanges = [];
  let globalIndex = 0;

  const addRecord = (recordStart, recordIndex) => {
    const recordEnd = recordStart + 4;
    if (!rangeOverlaps(occurrenceStart, occurrenceEnd, recordStart, recordEnd)) return;
    recordIndexes.push(recordIndex);
    recordOffsets.push(recordStart);
    recordRanges.push({
      start: hex(recordStart),
      endExclusive: hex(recordEnd),
      size: 4,
    });
    for (let byteOffset = Math.max(occurrenceStart, recordStart); byteOffset < Math.min(occurrenceEnd, recordEnd); byteOffset++) {
      recordByteOffsets.push(byteOffset - recordStart);
    }
  };

  if (gap.objectRecordsByList?.length) {
    for (const list of gap.objectRecordsByList) {
      const listStart = offsetOf(list.startOffset);
      const recordCount = Number(list.recordCount || 0);
      if (!Number.isFinite(listStart) || recordCount <= 0) continue;
      for (let index = 0; index < recordCount; index++) {
        addRecord(listStart + index * 4, globalIndex);
        globalIndex++;
      }
    }
  } else {
    for (let index = 0; index < Number(gap.objectRecordCount || 0); index++) {
      addRecord(gap.start + index * 4, index);
    }
  }

  return {
    recordIndexes: unique(recordIndexes),
    recordOffsets: unique(recordOffsets).map(offset => hex(offset)),
    recordByteOffsets: unique(recordByteOffsets),
    recordRange: recordRanges.length === 1 ? recordRanges[0] : null,
  };
}

function resolveVdpStreamOverlap(occurrence, sourceRegion, context) {
  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const interval = findOverlappingInterval(context.vdpStreamIntervals, occurrenceStart, occurrenceStart + 2);
  if (!interval) {
    const gap = findOverlappingInterval(context.vdpStreamGaps, occurrenceStart, occurrenceStart + 2);
    if (gap) {
      const consumedEnd = Number(gap.consumedBytes || 0) > 0
        ? Math.min(gap.start + Number(gap.consumedBytes || 0), gap.end)
        : null;
      const overlapsConsumed = consumedEnd != null && rangeOverlaps(occurrenceStart, occurrenceStart + 2, gap.start, consumedEnd);
      const overlapsTail = consumedEnd != null && consumedEnd < gap.end && rangeOverlaps(occurrenceStart, occurrenceStart + 2, consumedEnd, gap.end);
      const tailCandidate = gap.candidateTailClassification || null;
      const tailCandidateConsumedStart = offsetOf(tailCandidate?.consumedRange?.startOffset);
      const tailCandidateConsumedEnd = offsetOf(tailCandidate?.consumedRange?.endOffsetExclusive);
      const whollyInsideTailCandidate = Number.isFinite(tailCandidateConsumedStart)
        && Number.isFinite(tailCandidateConsumedEnd)
        && occurrenceStart >= tailCandidateConsumedStart
        && occurrenceEnd <= tailCandidateConsumedEnd;
      const crossesPrimaryDrawTerminator = consumedEnd != null
        && gap.class !== 'unclassified_gap'
        && gap.class.includes('vdp_draw_segment')
        && occurrenceStart === consumedEnd - 1
        && occurrenceEnd === consumedEnd + 1
        && context.rom[occurrenceStart] === 0xFF;
      const crossesTailDrawTerminator = Number.isFinite(tailCandidateConsumedEnd)
        && tailCandidate?.decoder === 'vdp_draw_segment'
        && occurrenceStart === tailCandidateConsumedEnd - 1
        && occurrenceEnd === tailCandidateConsumedEnd + 1
        && context.rom[occurrenceStart] === 0xFF;
      const isObjectGapCandidate = gap.class.includes('object');
      let kind = 'bank2_vdp_stream_gap_candidate_overlap';
      let priority = gap.class === 'unclassified_gap' ? 'inspect_unclassified_vdp_gap' : 'trace_unreferenced_vdp_gap_candidate';
      let reason = 'The source-word-shaped value overlaps an unreferenced/candidate gap from the bank-2 VDP stream layout audit.';
      let disposition = 'structured_payload_overlap_unresolved_layout';
      let parserRole = 'bank2_vdp_stream_gap_candidate';
      let confidence = gap.confidence;
      let boundaryRole = null;
      let boundaryRange = null;
      let objectRecordOverlap = null;
      if (consumedEnd != null && gap.class !== 'unclassified_gap') {
        if (isObjectGapCandidate && overlapsConsumed) {
          kind = gap.class === 'unreferenced_object_record_run_between_object_lists_candidate'
            ? 'bank2_vdp_stream_gap_object_record_run_candidate_overlap'
            : 'bank2_vdp_stream_gap_object_list_sequence_candidate_overlap';
          priority = 'trace_unreferenced_bank2_object_gap_candidate';
          disposition = 'candidate_structured_payload_field_overlap';
          parserRole = 'bank2_vdp_stream_object_gap_candidate';
          confidence = gap.confidence;
          objectRecordOverlap = collectObjectGapRecordOverlap(occurrenceStart, occurrenceEnd, gap);
          reason = 'The source-word-shaped value overlaps a candidate bank-2 object-list/object-record gap adjacent to confirmed _LABEL_9980_/_LABEL_99A1_ object-list payloads; this is candidate parser ownership until a direct pointer consumer is found.';
        } else if (crossesTailDrawTerminator) {
          kind = 'bank2_vdp_stream_gap_tail_draw_terminator_boundary_overlap';
          priority = 'deprioritized_vdp_draw_terminator_boundary_artifact';
          disposition = 'rejected_candidate_structured_payload_field_overlap';
          parserRole = 'bank2_vdp_stream_tail_draw_terminator_boundary';
          confidence = tailCandidate.confidence || gap.confidence;
          boundaryRole = 'tail_draw_segment_ff_terminator_to_following_byte';
          boundaryRange = {
            start: hex(tailCandidateConsumedEnd - 1),
            endExclusive: hex(tailCandidateConsumedEnd + 1),
            terminatorOffset: hex(tailCandidateConsumedEnd - 1),
            followingByteOffset: hex(tailCandidateConsumedEnd),
          };
          reason = 'The source-word-shaped value crosses the 0xFF terminator byte at the end of a nested VDP draw-segment candidate, so it is a decoder-boundary artifact rather than a graphics source word.';
        } else if (crossesPrimaryDrawTerminator) {
          kind = 'bank2_vdp_stream_gap_draw_terminator_boundary_overlap';
          priority = 'deprioritized_vdp_draw_terminator_boundary_artifact';
          disposition = 'rejected_candidate_structured_payload_field_overlap';
          parserRole = 'bank2_vdp_stream_gap_draw_terminator_boundary';
          confidence = gap.confidence;
          boundaryRole = 'gap_draw_segment_ff_terminator_to_following_byte';
          boundaryRange = {
            start: hex(consumedEnd - 1),
            endExclusive: hex(consumedEnd + 1),
            terminatorOffset: hex(consumedEnd - 1),
            followingByteOffset: hex(consumedEnd),
          };
          reason = 'The source-word-shaped value crosses the 0xFF terminator byte at the end of an unreferenced VDP draw-segment gap candidate, so it is a decoder-boundary artifact rather than a graphics source word.';
        } else if (whollyInsideTailCandidate && tailCandidate.decoder === 'vdp_draw_segment') {
          kind = tailCandidate.class === 'unreferenced_exact_vdp_draw_segment_tail_candidate'
            ? 'bank2_vdp_stream_gap_exact_nested_tail_draw_candidate_overlap'
            : 'bank2_vdp_stream_gap_prefix_nested_tail_draw_candidate_overlap';
          priority = 'trace_nested_vdp_tail_candidate_pointer_list_consumer';
          disposition = 'candidate_structured_payload_field_overlap';
          parserRole = 'bank2_vdp_stream_nested_tail_draw_candidate';
          confidence = tailCandidate.confidence || gap.confidence;
          reason = 'The source-word-shaped value is wholly inside a nested VDP draw-segment candidate decoded from the unconsumed tail of an unreferenced bank-2 VDP gap; this is candidate parser ownership, not confirmed graphics source coverage.';
        } else if (overlapsConsumed && overlapsTail) {
          kind = 'bank2_vdp_stream_gap_candidate_prefix_tail_boundary_overlap';
          priority = 'inspect_vdp_gap_candidate_prefix_tail_boundary';
          reason = 'The source-word-shaped value crosses the boundary between bytes consumed by an unreferenced bank-2 VDP gap candidate and the unconsumed tail of the same gap.';
        } else if (overlapsConsumed) {
          kind = 'bank2_vdp_stream_gap_candidate_consumed_prefix_overlap';
          priority = 'trace_unreferenced_vdp_gap_candidate';
          reason = 'The source-word-shaped value overlaps bytes consumed by an unreferenced bank-2 VDP gap candidate decoder.';
        } else {
          kind = 'bank2_vdp_stream_gap_candidate_unconsumed_tail_overlap';
          priority = 'trace_unconsumed_vdp_gap_tail';
          reason = 'The source-word-shaped value is inside a bank-2 VDP stream gap, but outside the bytes consumed by the current unreferenced gap-candidate decoder.';
        }
      }
      return makeResolvedContext(kind, {
        confidence,
        disposition,
        parserRole,
        sourceCatalogId: bank2VdpStreamLayoutCatalogId,
        gapClass: gap.class,
        gapInterval: {
          start: hex(gap.start),
          endExclusive: hex(gap.end),
          size: gap.size,
          class: gap.class,
          consumedBytes: gap.consumedBytes,
          controlCount: gap.controlCount,
          tileWordPairs: gap.tileWordPairs,
          objectListCount: gap.objectListCount,
          objectRecordCount: gap.objectRecordCount,
          objectTerminated: gap.objectTerminated,
        },
        candidateConsumedRange: consumedEnd == null ? null : {
          start: hex(gap.start),
          endExclusive: hex(consumedEnd),
          consumedBytes: consumedEnd - gap.start,
        },
        gapTailRange: consumedEnd == null || consumedEnd >= gap.end ? null : {
          start: hex(consumedEnd),
          endExclusive: hex(gap.end),
          size: gap.end - consumedEnd,
        },
        tailCandidateClass: tailCandidate?.class || null,
        tailCandidateDecoder: tailCandidate?.decoder || null,
        tailCandidateRange: tailCandidate?.consumedRange ? {
          start: tailCandidate.consumedRange.startOffset,
          endExclusive: tailCandidate.consumedRange.endOffsetExclusive,
          consumedBytes: tailCandidate.consumedRange.size,
        } : null,
        tailCandidateResidualRange: tailCandidate?.residualRange ? {
          start: tailCandidate.residualRange.startOffset,
          endExclusive: tailCandidate.residualRange.endOffsetExclusive,
          size: tailCandidate.residualRange.size,
        } : null,
        tailCandidateTileWordPairs: tailCandidate?.tileWordPairs || null,
        tailCandidateControlCount: tailCandidate?.controlCount || null,
        boundaryRole,
        boundaryRange,
        objectListCount: isObjectGapCandidate ? gap.objectListCount : null,
        objectRecordCount: isObjectGapCandidate ? gap.objectRecordCount : null,
        objectTerminated: isObjectGapCandidate ? gap.objectTerminated : null,
        objectNeighborKinds: isObjectGapCandidate ? unique([...(gap.precedingKinds || []), ...(gap.followingKinds || [])]) : null,
        objectRecordIndexes: objectRecordOverlap?.recordIndexes || null,
        objectRecordOffsets: objectRecordOverlap?.recordOffsets || null,
        objectRecordByteOffsets: objectRecordOverlap?.recordByteOffsets || null,
        objectRecordRange: objectRecordOverlap?.recordRange || null,
        priority,
        reason,
        evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
      });
    }
    return makeResolvedContext('bank2_vdp_stream_gap_overlap', {
      parserRole: 'bank2_vdp_stream_unclassified_gap',
      sourceCatalogId: bank2VdpStreamLayoutCatalogId,
      reason: 'The hit is inside the bank-2 VDP stream bundle but outside merged decoded intervals from the layout audit.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    });
  }

  return makeResolvedContext('bank2_vdp_stream_decoded_interval_overlap', {
    confidence: 'medium',
    disposition: 'known_structured_payload_field_overlap',
    parserRole: 'bank2_vdp_stream_decoded_interval',
    sourceCatalogId: interval.sourceCatalogId,
    streamInterval: {
      start: hex(interval.start),
      endExclusive: hex(interval.end),
      kinds: interval.kinds,
    },
    reason: 'The source-word-shaped value overlaps a decoded bank-2 VDP stream interval, not a confirmed graphics source table.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function collectA48RecordOverlap(rom, occurrenceStart, occurrenceEnd, interval) {
  let cursor = interval.start;
  let recordIndex = 0;
  const fieldRoles = [];
  const recordOffsets = [];
  const recordIndexes = [];
  const recordKinds = [];

  for (; cursor < interval.end && cursor < rom.length && recordIndex < 512; recordIndex++) {
    const recordStart = cursor;
    const opcode = rom[cursor];
    let recordKind = 'source_tile_copy';
    let recordEnd = recordStart + 3;
    if (opcode === 0x00) {
      recordKind = 'terminator';
      recordEnd = recordStart + 1;
    } else if (opcode === 0xFF) {
      recordKind = 'zero_fill';
      recordEnd = recordStart + 1;
    }
    if (recordEnd > interval.end) recordEnd = interval.end;

    if (rangeOverlaps(occurrenceStart, occurrenceEnd, recordStart, recordEnd)) {
      for (let byteOffset = Math.max(occurrenceStart, recordStart); byteOffset < Math.min(occurrenceEnd, recordEnd); byteOffset++) {
        fieldRoles.push(a48RecordFieldRole(recordKind, byteOffset - recordStart));
      }
      recordOffsets.push(recordStart);
      recordIndexes.push(recordIndex);
      recordKinds.push(recordKind);
    }

    cursor = recordEnd;
    if (recordKind === 'terminator') break;
  }

  return {
    fieldRoles: unique(fieldRoles.length ? fieldRoles : ['a48_stream_boundary']),
    recordOffsets: unique(recordOffsets).map(offset => hex(offset)),
    recordIndexes: unique(recordIndexes),
    recordKinds: unique(recordKinds),
  };
}

function resolvePlayerA48Overlap(rom, occurrence, sourceRegion, context) {
  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const intervals = context.playerA48IntervalsByRegion.get(sourceRegion.id) || [];
  const interval = findOverlappingInterval(intervals, occurrenceStart, occurrenceEnd);
  if (interval) {
    const overlap = collectA48RecordOverlap(rom, occurrenceStart, occurrenceEnd, interval);
    return makeResolvedContext('player_a48_tile_stream_record_field_overlap', {
      confidence: interval.stream?.confidence === 'high' ? 'high' : 'medium',
      disposition: 'known_structured_payload_field_overlap',
      parserRole: 'player_a48_tile_stream',
      sourceCatalogId: playerA48TileStreamCatalogId,
      streamOffset: hex(interval.start),
      streamEndExclusive: hex(interval.end),
      recordOffsets: overlap.recordOffsets,
      recordIndexes: overlap.recordIndexes,
      recordKinds: overlap.recordKinds,
      fieldRoles: overlap.fieldRoles,
      reason: 'The source-word-shaped value overlaps bytes consumed by the confirmed _LABEL_A48_ player/form tile-stream parser.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    });
  }

  const candidateIntervals = context.playerA48GapCandidateIntervalsByRegion.get(sourceRegion.id) || [];
  const candidate = findOverlappingInterval(candidateIntervals, occurrenceStart, occurrenceEnd);
  if (!candidate) return null;

  const overlap = collectA48RecordOverlap(rom, occurrenceStart, occurrenceEnd, candidate);
  return makeResolvedContext('player_a48_gap_candidate_record_field_overlap', {
    confidence: candidate.stream?.confidence || 'medium',
    disposition: 'candidate_structured_payload_field_overlap',
    priority: 'trace_missing_player_command_pointer_or_variant_selector',
    parserRole: 'player_a48_gap_candidate_tile_stream',
    sourceCatalogId: playerA48GapCandidateCatalogId,
    streamOffset: hex(candidate.start),
    streamEndExclusive: hex(candidate.end),
    a48GapCandidateId: candidate.stream?.id || null,
    a48GapCandidateRange: {
      start: hex(candidate.start),
      endExclusive: hex(candidate.end),
      consumedBytes: candidate.stream?.consumedBytes,
      sourceRecordCount: candidate.stream?.sourceRecordCount,
      zeroFillTileBlocks: candidate.stream?.zeroFillTileBlocks,
      totalTileBlocks: candidate.stream?.totalTileBlocks,
    },
    a48GapId: candidate.stream?.gapId || null,
    a48GapRange: candidate.stream?.gapRange || null,
    hasKnownPointerReference: Boolean(candidate.stream?.hasKnownPointerReference),
    recordOffsets: overlap.recordOffsets,
    recordIndexes: overlap.recordIndexes,
    recordKinds: overlap.recordKinds,
    fieldRoles: overlap.fieldRoles,
    reason: 'The source-word-shaped value overlaps a shape-valid, terminated but currently unreferenced _LABEL_A48_ gap candidate bounded by confirmed player/form A48 streams.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function resolveMetaspriteOverlap(occurrence, sourceRegion, context) {
  const a48Context = resolvePlayerA48Overlap(context.rom, occurrence, sourceRegion, context);
  if (a48Context) return a48Context;

  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const intervals = context.metaspriteIntervalsByRegion.get(sourceRegion.id) || [];
  const interval = findOverlappingInterval(intervals, occurrenceStart, occurrenceEnd);
  if (!interval) {
    const targetInterval = findOverlappingInterval(context.metaspriteTargetIntervalsByRegion.get(sourceRegion.id) || [], occurrenceStart, occurrenceEnd);
    if (targetInterval) {
      const target = targetInterval.interval;
      const pieceRecordCount = Number(target.pieceRecordCount || 0);
      const pieceBytes = pieceRecordCount * 3;
      const fieldRoles = [];
      const pieceIndexes = [];
      for (let byteOffset = occurrenceStart; byteOffset < occurrenceEnd; byteOffset++) {
        const relative = byteOffset - targetInterval.start;
        if (relative < 0 || byteOffset >= targetInterval.end) {
          fieldRoles.push('metasprite_target_frame_boundary');
        } else if (relative < pieceBytes) {
          pieceIndexes.push(Math.floor(relative / 3));
          fieldRoles.push(metaspritePieceFieldRole(relative % 3));
        } else {
          fieldRoles.push('frame_stream_terminator');
        }
      }

      return makeResolvedContext(
        fieldRoles.every(field => field === 'frame_stream_terminator')
          ? 'metasprite_target_frame_terminator_overlap'
          : 'metasprite_target_frame_piece_field_overlap',
        {
          confidence: target.confidence === 'high' ? 'high' : 'medium',
          disposition: 'known_structured_payload_field_overlap',
          parserRole: 'metasprite_target_frame_stream',
          sourceCatalogId: metaspriteTargetIntervalCatalogId,
          metaspriteTargetIntervalId: target.id,
          metaspriteTargetOffset: target.targetOffset,
          metaspriteTargetInterval: {
            start: target.targetOffset,
            endExclusive: target.endExclusive,
            byteLength: target.byteLength,
            pieceRecordCount: target.pieceRecordCount,
            confirmedFrameSubrecord: Boolean(target.confirmedFrameSubrecord),
          },
          pieceIndexes: unique(pieceIndexes),
          fieldRoles: unique(fieldRoles),
          reason: 'The source-word-shaped value overlaps a normally terminated metasprite target interval from the broader metasprite target audit.',
          evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
        },
      );
    }
    return makeResolvedContext('metasprite_payload_overlap_unresolved_layout', {
      parserRole: 'metasprite_payload',
      reason: 'The hit is inside a metasprite region, but no high-confidence frame subrecord interval currently overlaps it.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    });
  }

  const subrecord = interval.subrecord;
  const pieceRecordCount = Number(subrecord.pieceRecordCount || 0);
  const pieceBytes = pieceRecordCount * 3;
  const fieldRoles = [];
  const pieceIndexes = [];
  for (let byteOffset = occurrenceStart; byteOffset < occurrenceEnd; byteOffset++) {
    const relative = byteOffset - interval.start;
    if (relative < 0 || byteOffset >= interval.end) {
      fieldRoles.push('frame_stream_boundary');
    } else if (relative < pieceBytes) {
      pieceIndexes.push(Math.floor(relative / 3));
      fieldRoles.push(metaspritePieceFieldRole(relative % 3));
    } else {
      fieldRoles.push('frame_stream_terminator');
    }
  }

  return makeResolvedContext(
    fieldRoles.every(field => field === 'frame_stream_terminator')
      ? 'metasprite_frame_terminator_overlap'
      : 'metasprite_frame_piece_field_overlap',
    {
      confidence: 'medium',
      disposition: 'known_structured_payload_field_overlap',
      parserRole: 'metasprite_frame_stream_subrecord',
      sourceCatalogId: animationFrameSubrecordCatalogId,
      frameSubrecordId: subrecord.id,
      frameSubrecordOffset: subrecord.offset,
      pieceIndexes: unique(pieceIndexes),
      fieldRoles: unique(fieldRoles),
      reason: 'The source-word-shaped value overlaps a high-confidence _LABEL_792_ metasprite frame stream subrecord.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    },
  );
}

function resolveRoomOverlayOverlap(occurrence, sourceRegion, context) {
  const table = context.roomOverlayTable;
  if (!table || table.regionId !== sourceRegion.id) return null;
  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  if (!rangeOverlaps(occurrenceStart, occurrenceEnd, table.start, table.end)) return null;

  const recordIndexes = [];
  const recordByteOffsets = [];
  const fieldRoles = [];
  for (let byteOffset = Math.max(occurrenceStart, table.start); byteOffset < Math.min(occurrenceEnd, table.end); byteOffset++) {
    const tableRelative = byteOffset - table.start;
    const recordIndex = Math.floor(tableRelative / table.recordStride);
    const recordByteOffset = tableRelative % table.recordStride;
    recordIndexes.push(recordIndex);
    recordByteOffsets.push(recordByteOffset);
    fieldRoles.push(overlayRecordFieldRole(recordByteOffset));
  }

  return makeResolvedContext('room_overlay_tile_record_field_overlap', {
    confidence: 'high',
    disposition: 'known_structured_payload_field_overlap',
    parserRole: 'room_overlay_tile_record_table',
    sourceCatalogId: roomOverlayRecordCatalogId,
    overlayRecordIndexes: unique(recordIndexes),
    overlayRecordByteOffsets: unique(recordByteOffsets),
    fieldRoles: unique(fieldRoles),
    reason: 'The source-word-shaped value overlaps the confirmed 8-byte room overlay tile record table selected through _RAM_CF64_.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function resolveDc2TileMapOverlap(occurrence, sourceRegion, context) {
  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const intervals = context.dc2IntervalsByRegion.get(sourceRegion.id) || [];
  const runtime = findOverlappingInterval(intervals, occurrenceStart, occurrenceEnd);
  if (runtime) {
    return makeResolvedContext('dc2_compressed_scroll_map_stream_payload_overlap', {
      confidence: 'high',
      disposition: 'known_structured_payload_field_overlap',
      parserRole: 'dc2_compressed_scroll_map_stream',
      sourceCatalogId: dc2ScrollMapCatalogId,
      streamIndex: runtime.entry.indexHex,
      streamOffset: hex(runtime.start),
      streamEndExclusive: hex(runtime.declaredEnd),
      streamRuntimeRange: {
        start: hex(runtime.start),
        endExclusive: hex(runtime.end),
        runtimeConsumedBytes: runtime.entry.runtimeConsumedBytes,
        writtenCells: runtime.entry.writtenCells,
        endReason: runtime.entry.endReason,
      },
      reason: 'The source-word-shaped value overlaps bytes consumed by the confirmed _LABEL_DC2_ compressed scroll-map stream decoder.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    });
  }

  const trailing = intervals.find(interval => interval.declaredEnd > interval.end
    && rangeOverlaps(occurrenceStart, occurrenceEnd, interval.end, interval.declaredEnd));
  if (trailing) {
    return makeResolvedContext('dc2_scroll_map_declared_trailing_bytes_overlap', {
      parserRole: 'dc2_scroll_map_declared_trailing_bytes',
      sourceCatalogId: dc2ScrollMapCatalogId,
      streamIndex: trailing.entry.indexHex,
      streamOffset: hex(trailing.start),
      streamEndExclusive: hex(trailing.declaredEnd),
      declaredTrailingRange: {
        start: hex(trailing.end),
        endExclusive: hex(trailing.declaredEnd),
        trailingBytesBeforeNextLabel: trailing.entry.trailingBytesBeforeNextLabel,
      },
      reason: 'The hit is inside declared bytes after the simulated _LABEL_DC2_ runtime consumption and before the next mapped label.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    });
  }

  return null;
}

function resolveTileMapOverlap(occurrence, sourceRegion, context) {
  const overlay = resolveRoomOverlayOverlap(occurrence, sourceRegion, context);
  if (overlay) return overlay;
  const dc2 = resolveDc2TileMapOverlap(occurrence, sourceRegion, context);
  if (dc2) return dc2;
  const statusSegment = resolveStatusTileMapOverlap(occurrence, sourceRegion);
  if (statusSegment) return statusSegment;
  const paletteTail = resolvePaletteTailTileMapCandidateOverlap(occurrence, sourceRegion);
  if (paletteTail) return paletteTail;
  return makeResolvedContext('tile_map_payload_overlap', {
    parserRole: 'tile_map_payload',
    reason: 'The hit is inside a mapped tile_map payload; no direct graphics source consumer is confirmed by this occurrence alone.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function statusSegmentFieldRole(byteIndex) {
  if (byteIndex === 0) return 'status_segment_tile_word_0_lo';
  if (byteIndex === 1) return 'status_segment_tile_word_0_hi';
  if (byteIndex === 2) return 'status_segment_tile_word_1_lo';
  if (byteIndex === 3) return 'status_segment_tile_word_1_hi';
  return 'outside_status_segment_record';
}

function resolveStatusTileMapOverlap(occurrence, sourceRegion) {
  const analysis = sourceRegion.analysis || {};
  const statusAudit = analysis.statusVdpWriterDetailAudit;
  const smallDataAudit = analysis.smallDataAudit;
  if (statusAudit?.kind !== 'status_full_segment_record'
    || statusAudit.confidence !== 'high_for_consumer_lines'
    || smallDataAudit?.kind !== 'status_name_table_overflow_tile_pair') {
    return null;
  }

  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const start = regionStart(sourceRegion);
  const end = regionEnd(sourceRegion);
  const stride = Number(statusAudit.recordSize || sourceRegion.size || 4);
  const fieldRoles = [];
  const recordIndexes = [];
  const recordOffsets = [];
  const byteOffsets = [];
  for (let byteOffset = Math.max(occurrenceStart, start); byteOffset < Math.min(occurrenceEnd, end); byteOffset++) {
    const relative = byteOffset - start;
    const recordIndex = Math.floor(relative / stride);
    const recordByteOffset = relative % stride;
    recordIndexes.push(recordIndex);
    recordOffsets.push(start + recordIndex * stride);
    byteOffsets.push(recordByteOffset);
    fieldRoles.push(statusSegmentFieldRole(recordByteOffset));
  }

  return makeResolvedContext('tile_map_status_segment_record_field_overlap', {
    confidence: 'high',
    disposition: 'known_structured_payload_field_overlap',
    parserRole: 'status_name_table_segment_record',
    sourceCatalogId: statusVdpWriterDetailCatalogId,
    underlyingSourceCatalogIds: unique([smallDataCatalogId, statusVdpWriterDetailCatalogId]),
    recordOffsets: unique(recordOffsets).map(offset => hex(offset)),
    recordIndexes: unique(recordIndexes),
    recordByteOffsets: unique(byteOffsets),
    recordStride: stride,
    recordRange: {
      start: hex(start),
      endExclusive: hex(end),
      size: end - start,
    },
    fieldRoles: unique(fieldRoles),
    reason: 'The source-word-shaped value overlaps a confirmed four-byte status/name-table segment record consumed by _LABEL_2518_, not a graphics source pointer.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function resolvePaletteTailTileMapCandidateOverlap(occurrence, sourceRegion) {
  const audit = sourceRegion.analysis?.unresolvedAssetConsumerAudit;
  if (audit?.kind !== 'palette_tail_tile_map_candidate') return null;
  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const start = regionStart(sourceRegion);
  const end = regionEnd(sourceRegion);
  const width = Number(audit.shape?.width || 0);
  const height = Number(audit.shape?.height || 0);
  const bytesPerCell = Number(audit.shape?.bytesPerCell || 0);
  const byteOffsets = [];
  const fieldRoles = [];
  for (let byteOffset = Math.max(occurrenceStart, start); byteOffset < Math.min(occurrenceEnd, end); byteOffset++) {
    byteOffsets.push(byteOffset - start);
    fieldRoles.push('candidate_one_byte_tile_or_index_cell');
  }
  const cellIndexes = bytesPerCell > 0
    ? unique(byteOffsets.map(byteOffset => Math.floor(byteOffset / bytesPerCell)))
    : [];
  const cellCoordinates = width > 0
    ? cellIndexes.map(cellIndex => ({
      index: cellIndex,
      x: cellIndex % width,
      y: Math.floor(cellIndex / width),
    }))
    : [];
  const rowBoundaryCrossed = cellCoordinates.length > 1
    && cellCoordinates[0].y !== cellCoordinates[cellCoordinates.length - 1].y;
  const oneByteGridCellAdjacency = bytesPerCell === 1 && cellIndexes.length > 1;
  return makeResolvedContext(
    oneByteGridCellAdjacency && rowBoundaryCrossed
      ? 'tile_map_palette_tail_byte_grid_row_boundary_word_artifact'
      : 'tile_map_palette_tail_candidate_payload_overlap',
    {
    confidence: 'medium',
    disposition: oneByteGridCellAdjacency
      ? 'rejected_candidate_structured_payload_field_overlap'
      : 'structured_payload_overlap_unresolved_layout',
    priority: oneByteGridCellAdjacency
      ? 'deprioritized_one_byte_tile_grid_adjacency_artifact'
      : 'trace_palette_tail_tile_map_consumer',
    parserRole: oneByteGridCellAdjacency
      ? 'palette_tail_tile_map_candidate_byte_grid_adjacency'
      : 'palette_tail_tile_map_candidate_payload',
    sourceCatalogId: unresolvedAssetConsumerCatalogId,
    tableRange: {
      start: hex(start),
      endExclusive: hex(end),
      size: end - start,
      width,
      height,
      bytesPerCell,
    },
    tableByteOffsets: unique(byteOffsets),
    tableCellIndexes: cellIndexes,
    tableCellCoordinates: cellCoordinates,
    tableRowBoundaryCrossed: rowBoundaryCrossed,
    fieldRoles: unique(fieldRoles),
    reason: oneByteGridCellAdjacency
      ? 'The source-word-shaped value is formed by adjacent one-byte cells in the 15x16 palette-tail tile/index grid, crossing a row boundary; this is a byte-grid artifact, not a graphics source word.'
      : 'The source-word-shaped value overlaps a 15x16 palette-tail tile/index payload candidate, but current audits still have no confirmed same-bank consumer.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function roomDataContextKind(intervalKinds, allBytesOwned) {
  if (!allBytesOwned) return 'room_data_interval_partial_overlap';
  if (intervalKinds.length !== 1) return 'room_data_parser_interval_boundary_overlap';
  if (intervalKinds[0] === 'zone_descriptor_record') return 'room_data_zone_descriptor_field_overlap';
  if (intervalKinds[0] === 'room_trigger_record') return 'room_data_trigger_record_field_overlap';
  if (intervalKinds[0] === 'room_trigger_table_terminator') return 'room_data_trigger_terminator_overlap';
  if (intervalKinds[0] === 'vram_loader_8fb_record') return 'room_data_vram_loader_8fb_record_field_overlap';
  if (intervalKinds[0] === 'vram_loader_8fb_terminator') return 'room_data_vram_loader_8fb_terminator_overlap';
  if (intervalKinds[0] === 'equipment_menu_source_list') return 'room_data_equipment_menu_source_list_field_overlap';
  if (intervalKinds[0] === 'room_trigger_sequence_start') return 'room_data_trigger_sequence_start_field_overlap';
  if (intervalKinds[0] === 'room_transition_position_restore_record') return 'room_data_position_restore_record_field_overlap';
  if (intervalKinds[0] === 'form_stage_transition_selector') return 'room_data_form_stage_transition_selector_overlap';
  if (intervalKinds[0] === 'form_stage_inline_descriptor') return 'room_data_form_stage_inline_descriptor_field_overlap';
  return 'room_data_parser_interval_field_overlap';
}

function resolveRoomDataOverlap(occurrence, sourceRegion, context) {
  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const intervals = context.roomDataIntervalsByRegion.get(sourceRegion.id) || [];
  if (!intervals.length) return null;

  const matchedIntervals = [];
  const intervalKinds = [];
  const recordIds = [];
  const recordOffsets = [];
  const byteOffsets = [];
  const fieldRoles = [];
  const sourceCatalogIds = [];
  let ownedByteCount = 0;

  for (let byteOffset = occurrenceStart; byteOffset < occurrenceEnd; byteOffset++) {
    const interval = intervals.find(candidate => byteOffset >= candidate.start && byteOffset < candidate.end);
    if (!interval) {
      fieldRoles.push('unowned_room_data_byte');
      continue;
    }
    ownedByteCount++;
    matchedIntervals.push(interval);
    intervalKinds.push(interval.kind);
    recordIds.push(interval.id);
    recordOffsets.push(interval.start);
    byteOffsets.push(byteOffset - interval.start);
    fieldRoles.push(roomDataIntervalFieldRole(interval.kind, byteOffset - interval.start));
    sourceCatalogIds.push(interval.sourceCatalogId);
  }

  if (!matchedIntervals.length) {
    const gap = findOverlappingInterval(context.roomDataGapsByRegion.get(sourceRegion.id) || [], occurrenceStart, occurrenceEnd);
    if (!gap) return null;
    return makeResolvedContext('room_data_unowned_interval_gap_overlap', {
      confidence: gap.confidence || 'low',
      disposition: 'structured_payload_overlap_unresolved_layout',
      priority: 'inspect_room_data_unowned_gap',
      parserRole: 'room_data_unowned_gap',
      sourceCatalogId: roomDataIntervalCatalogId,
      roomDataGapIds: [gap.id],
      roomDataGapRanges: [{
        start: hex(gap.start),
        endExclusive: hex(gap.end),
        precedingIntervalId: gap.precedingIntervalId,
        followingIntervalId: gap.followingIntervalId,
      }],
      reason: 'The source-word-shaped value is inside a room-data gap not currently owned by descriptor, trigger-record, trigger-terminator, room-data-resident 8FB loader, or trigger-destination payload parsers.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    });
  }

  const uniqueKinds = unique(intervalKinds);
  const allBytesOwned = ownedByteCount === occurrenceEnd - occurrenceStart;
  const allHighConfidence = matchedIntervals.every(interval => interval.confidence === 'high');
  return makeResolvedContext(roomDataContextKind(uniqueKinds, allBytesOwned), {
    confidence: allBytesOwned && allHighConfidence ? 'high' : 'medium',
    disposition: allBytesOwned ? 'known_structured_payload_field_overlap' : 'structured_payload_overlap_unresolved_layout',
    priority: allBytesOwned ? 'deprioritize_raw_source_word_hit' : 'inspect_room_data_interval_boundary',
    parserRole: allBytesOwned ? 'room_data_parser_owned_interval' : 'room_data_partially_owned_interval',
    sourceCatalogId: roomDataIntervalCatalogId,
    roomDataIntervalKinds: uniqueKinds,
    roomDataRecordIds: unique(recordIds),
    roomDataRecordOffsets: unique(recordOffsets).map(offset => hex(offset)),
    roomDataByteOffsets: unique(byteOffsets),
    fieldRoles: unique(fieldRoles),
    underlyingSourceCatalogIds: unique(sourceCatalogIds),
    reason: allBytesOwned
      ? 'The source-word-shaped value overlaps room-data bytes already owned by validated descriptor, trigger-record, 8FB loader, or trigger-destination payload parsers.'
      : 'The source-word-shaped value partially overlaps parser-owned room-data bytes and partially overlaps unowned room-data bytes.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function resolveDataTableLookupOverlap(occurrence, sourceRegion) {
  const analysis = sourceRegion.analysis || {};
  const bank0Audit = analysis.bank0LookupDataAudit;
  const damageAudit = analysis.damageLookupAudit;
  const confirmedSeedTable = bank0Audit?.kind === 'random_state_seed_table'
    && bank0Audit.confidence === 'high'
    && damageAudit?.kind === 'rolling_accumulator_seed_table'
    && damageAudit.confidence === 'high';
  if (!confirmedSeedTable) return null;

  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const start = regionStart(sourceRegion);
  const end = regionEnd(sourceRegion);
  const byteOffsets = [];
  const fieldRoles = [];
  for (let byteOffset = Math.max(occurrenceStart, start); byteOffset < Math.min(occurrenceEnd, end); byteOffset++) {
    const tableOffset = byteOffset - start;
    byteOffsets.push(tableOffset);
    fieldRoles.push('rolling_accumulator_seed_byte');
  }

  return makeResolvedContext('data_table_known_lookup_seed_payload_overlap', {
    confidence: 'high',
    disposition: 'known_structured_payload_field_overlap',
    parserRole: 'rolling_accumulator_seed_table',
    sourceCatalogId: damageLookupCatalogId,
    underlyingSourceCatalogIds: [bank0LookupDataCatalogId, damageLookupCatalogId],
    tableRange: {
      start: hex(start),
      endExclusive: hex(end),
      size: end - start,
    },
    tableByteOffsets: unique(byteOffsets),
    tableKinds: unique([bank0Audit.kind, damageAudit.kind]),
    fieldRoles: unique(fieldRoles),
    reason: 'The source-word-shaped value overlaps bytes in the confirmed _DATA_CFF_ seed table copied to _RAM_D0A5_ and mutated by _LABEL_D36_, so this is lookup-table payload context rather than graphics source coverage.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function resolveRejected8fbCandidateOverlap(occurrence, sourceRegion) {
  const analysis = sourceRegion.analysis || {};
  const candidateAudit = analysis.graphicsLoaderCandidateAudit;
  const consumerAudit = analysis.graphicsLoaderCandidateConsumerAudit;
  const sidecarAudit = analysis.bank7PreSequenceSidecarAudit;
  const unresolvedAudit = analysis.unresolvedAssetConsumerAudit;
  const rejectedByAlias = candidateAudit?.format === '8fb'
    && candidateAudit.status === 'candidate_only_unconfirmed_consumer'
    && candidateAudit.promotionAllowed === false
    && (
      candidateAudit.consumerStatus === 'no_confirmed_consumer_bank_alias_collision'
      || consumerAudit?.status === 'no_confirmed_consumer_bank_alias_collision'
      || sidecarAudit?.candidateConsumerStatus === 'no_confirmed_consumer_bank_alias_collision'
      || sidecarAudit?.status === 'loader_shape_rejected_keep_bank7_sequence_sidecar'
      || unresolvedAudit?.bank7SidecarStatus === 'loader_shape_rejected_keep_bank7_sequence_sidecar'
    );
  if (!rejectedByAlias) return null;

  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const candidateStart = offsetOf(candidateAudit.offset || sourceRegion.offset);
  const candidateEnd = candidateStart + Number(candidateAudit.consumedBytes || sourceRegion.size || 0);
  if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateEnd)
    || !rangeOverlaps(occurrenceStart, occurrenceEnd, candidateStart, candidateEnd)) {
    return null;
  }

  const recordStride = 5;
  const recordOffsets = [];
  const recordIndexes = [];
  const fieldRoles = [];
  for (let byteOffset = Math.max(occurrenceStart, candidateStart); byteOffset < Math.min(occurrenceEnd, candidateEnd); byteOffset++) {
    const relative = byteOffset - candidateStart;
    if (relative >= Number(candidateAudit.copyEntryCount || 0) * recordStride) {
      recordOffsets.push(byteOffset);
      fieldRoles.push('vram_loader_8fb_terminator');
      continue;
    }
    const recordIndex = Math.floor(relative / recordStride);
    const recordByteOffset = relative % recordStride;
    recordIndexes.push(recordIndex);
    recordOffsets.push(candidateStart + recordIndex * recordStride);
    fieldRoles.push(roomDataIntervalFieldRole('vram_loader_8fb_record', recordByteOffset));
  }

  const matchingOverlapRef = (candidateAudit.overlapRefs || []).find(ref => {
    const entryOffset = offsetOf(ref.entryOffset);
    return Number.isFinite(entryOffset)
      && unique(recordOffsets).some(offset => offset === entryOffset);
  }) || null;

  return makeResolvedContext('data_table_rejected_8fb_loader_candidate_field_overlap', {
    confidence: 'medium',
    disposition: 'rejected_candidate_structured_payload_field_overlap',
    priority: 'do_not_promote_without_direct_bank7_consumer',
    parserRole: 'rejected_8fb_loader_candidate',
    sourceCatalogId: bank7PreSequenceSidecarCatalogId,
    underlyingSourceCatalogIds: unique([
      graphicsLoaderCandidateCatalogId,
      graphicsLoaderCandidateConsumerCatalogId,
      bank7PreSequenceSidecarCatalogId,
    ]),
    recordOffsets: unique(recordOffsets).map(offset => hex(offset)),
    recordIndexes: unique(recordIndexes),
    fieldRoles: unique(fieldRoles),
    candidateSourceRange: {
      start: hex(candidateStart),
      endExclusive: hex(candidateEnd),
      consumedBytes: candidateEnd - candidateStart,
      entryCount: candidateAudit.entryCount,
      copyEntryCount: candidateAudit.copyEntryCount,
      format: candidateAudit.format,
      matchingOverlapRefSpanId: matchingOverlapRef?.spanId || null,
    },
    candidateConsumerStatus: consumerAudit?.status || sidecarAudit?.candidateConsumerStatus || candidateAudit.consumerStatus || null,
    candidateShapeStatus: sidecarAudit?.candidateShapeStatus || candidateAudit.status || null,
    candidatePromotionAllowed: Boolean(candidateAudit.promotionAllowed || consumerAudit?.promotionAllowed || sidecarAudit?.promotionAllowed),
    directCandidateAsmRefCount: consumerAudit?.directCandidateRefCount ?? sidecarAudit?.directCandidateAsmRefCount ?? null,
    aliasCount: consumerAudit?.aliasCount ?? null,
    rawZ80WordOccurrenceCount: consumerAudit?.rawZ80WordOccurrenceCount ?? sidecarAudit?.rawZ80WordHitCount ?? null,
    reason: 'The source-word-shaped value overlaps source-word fields in an 8FB-shaped candidate stream, but existing consumer audits reject promotion because the loader-adjacent banked address aliases _DATA_12337_ rather than _DATA_1E337_.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function resolveDataTableOverlap(occurrence, sourceRegion) {
  return resolveDataTableLookupOverlap(occurrence, sourceRegion)
    || resolveRejected8fbCandidateOverlap(occurrence, sourceRegion);
}

function dc2PointerFieldRole(byteIndex) {
  if (byteIndex === 0) return 'dc2_stream_pointer_lo';
  if (byteIndex === 1) return 'dc2_stream_pointer_hi';
  return 'outside_dc2_stream_pointer';
}

function resolvePointerTableOverlap(occurrence, sourceRegion, context) {
  const table = context.dc2PointerTable;
  if (!table || table.regionId !== sourceRegion.id) return null;
  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  if (!rangeOverlaps(occurrenceStart, occurrenceEnd, table.start, table.end)) return null;

  const pointerEntryIndexes = [];
  const pointerEntryOffsets = [];
  const pointerByteOffsets = [];
  const pointerTargets = [];
  const fieldRoles = [];
  for (let byteOffset = Math.max(occurrenceStart, table.start); byteOffset < Math.min(occurrenceEnd, table.end); byteOffset++) {
    const relative = byteOffset - table.start;
    const entryIndex = Math.floor(relative / table.entryStride);
    const entryByteOffset = relative % table.entryStride;
    const entryOffset = table.start + entryIndex * table.entryStride;
    const entry = table.entriesByOffset.get(entryOffset);
    pointerEntryIndexes.push(entryIndex);
    pointerEntryOffsets.push(entryOffset);
    pointerByteOffsets.push(entryByteOffset);
    fieldRoles.push(dc2PointerFieldRole(entryByteOffset));
    if (entry) {
      pointerTargets.push({
        index: entry.indexHex,
        tableEntryOffset: entry.tableEntryOffset,
        z80Pointer: entry.z80Pointer,
        romOffset: entry.romOffset,
        targetRegion: entry.targetRegion,
        valid: Boolean(entry.valid),
      });
    }
  }

  return makeResolvedContext(
    unique(pointerEntryIndexes).length > 1
      ? 'dc2_scroll_map_pointer_table_entry_boundary_overlap'
      : 'dc2_scroll_map_pointer_table_entry_field_overlap',
    {
      confidence: 'high',
      disposition: 'known_structured_payload_field_overlap',
      parserRole: 'dc2_scroll_map_pointer_table',
      sourceCatalogId: dc2ScrollMapCatalogId,
      pointerTableRange: {
        start: hex(table.start),
        endExclusive: hex(table.end),
        entryCount: table.entryCount,
        entryStride: table.entryStride,
      },
      pointerEntryIndexes: unique(pointerEntryIndexes),
      pointerEntryOffsets: unique(pointerEntryOffsets).map(offset => hex(offset)),
      pointerByteOffsets: unique(pointerByteOffsets),
      pointerTargets,
      fieldRoles: unique(fieldRoles),
      reason: 'The source-word-shaped value overlaps bytes in the confirmed _DATA_14000_ DC2 scroll-map pointer table selected by _LABEL_DC2_; boundary overlaps are not graphics source pointers.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    },
  );
}

function regionPayloadByteOffsets(occurrence, sourceRegion) {
  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const start = regionStart(sourceRegion);
  const end = regionEnd(sourceRegion);
  const byteOffsets = [];
  for (let byteOffset = Math.max(occurrenceStart, start); byteOffset < Math.min(occurrenceEnd, end); byteOffset++) {
    byteOffsets.push(byteOffset - start);
  }
  return unique(byteOffsets);
}

function resolveAudioDriverDataOverlap(occurrence, sourceRegion) {
  const analysis = sourceRegion.analysis || {};
  const audit = analysis.audioAudit;
  if (audit?.confidence !== 'high') return null;

  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const start = regionStart(sourceRegion);
  const end = regionEnd(sourceRegion);
  const handlerAudit = analysis.audioOpcodeHandlerAudit;
  const stateAudit = analysis.audioOpcodeStateEffectAudit;
  const handlerTargets = (handlerAudit?.opcodes || [])
    .map(opcode => ({
      opcode: opcode.opcode,
      role: opcode.role,
      romTarget: opcode.romTarget,
      offset: offsetOf(opcode.romTarget),
    }))
    .filter(target => Number.isFinite(target.offset) && target.offset >= start && target.offset < end)
    .sort((a, b) => a.offset - b.offset);
  const matchedHandler = handlerTargets
    .filter(target => target.offset <= occurrenceStart)
    .slice(-1)[0] || null;
  const tableByteOffsets = regionPayloadByteOffsets(occurrence, sourceRegion);
  const fieldRoles = [];
  for (const byteOffset of tableByteOffsets) {
    if (audit.kind === 'psg_noise_or_envelope_table') {
      fieldRoles.push(`psg_noise_or_envelope_table_entry_byte_${byteOffset % 3}`);
    } else if (handlerAudit?.confidence === 'high') {
      fieldRoles.push('audio_opcode_handler_region_byte');
    } else {
      fieldRoles.push('audio_driver_payload_byte');
    }
  }

  return makeResolvedContext(
    handlerAudit?.confidence === 'high'
      ? 'audio_opcode_handler_region_byte_overlap'
      : 'audio_driver_known_payload_overlap',
    {
      confidence: handlerAudit?.confidence === 'high' || audit.confidence === 'high' ? 'high' : 'medium',
      disposition: 'known_structured_payload_field_overlap',
      parserRole: audit.kind || 'audio_driver_data',
      sourceCatalogId: handlerAudit?.confidence === 'high' ? audioOpcodeDispatchCatalogId : audioCatalogId,
      underlyingSourceCatalogIds: unique([
        audioCatalogId,
        handlerAudit?.confidence === 'high' ? audioOpcodeDispatchCatalogId : null,
        stateAudit ? audioOpcodeStateEffectCatalogId : null,
      ]),
      tableRange: {
        start: hex(start),
        endExclusive: hex(end),
        size: end - start,
        audioKind: audit.kind,
      },
      tableByteOffsets,
      fieldRoles: unique(fieldRoles),
      streamRanges: matchedHandler ? [{
        opcode: matchedHandler.opcode,
        role: matchedHandler.role,
        handlerRomOffset: matchedHandler.romTarget,
      }] : [],
      reason: 'The source-word-shaped value overlaps confirmed audio driver data/opcode-handler bytes, so it is audio payload context rather than graphics source coverage.',
      evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
    },
  );
}

function resolveEntityAnimScriptOverlap(occurrence, sourceRegion) {
  const commandAudit = sourceRegion.analysis?.animationCommandStreamAudit;
  const entityAudit = sourceRegion.analysis?.entityAnimationAudit;
  if (commandAudit?.confidence !== 'high' && entityAudit?.confidence !== 'high') return null;

  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const start = regionStart(sourceRegion);
  const end = regionEnd(sourceRegion);
  const streamRanges = [];
  const streamOffsets = [];
  for (const stream of commandAudit?.streams || []) {
    const streamStart = offsetOf(stream.streamOffset);
    const jumpAt = offsetOf(stream.termination?.atOffset);
    const streamEnd = Number.isFinite(jumpAt) ? jumpAt + 3 : end;
    if (!Number.isFinite(streamStart) || !rangeOverlaps(occurrenceStart, occurrenceEnd, streamStart, streamEnd)) continue;
    streamOffsets.push(stream.streamOffset);
    streamRanges.push({
      streamOffset: stream.streamOffset,
      endExclusive: hex(streamEnd),
      terminationKind: stream.termination?.kind || null,
      commandCount: stream.commandCount,
      frameTargetCount: stream.frameTargetCount,
    });
  }

  return makeResolvedContext('entity_animation_command_stream_byte_overlap', {
    confidence: commandAudit?.confidence === 'high' ? 'high' : 'medium',
    disposition: 'known_structured_payload_field_overlap',
    parserRole: 'entity_animation_command_stream',
    sourceCatalogId: commandAudit?.catalogId || animationCommandStreamCatalogId,
    underlyingSourceCatalogIds: unique([entityAnimationCatalogId, commandAudit?.catalogId || animationCommandStreamCatalogId]),
    tableRange: {
      start: hex(start),
      endExclusive: hex(end),
      size: end - start,
    },
    tableByteOffsets: regionPayloadByteOffsets(occurrence, sourceRegion),
    streamOffsets: unique(streamOffsets),
    streamRanges,
    fieldRoles: streamRanges.length
      ? ['animation_command_stream_byte']
      : ['entity_animation_script_payload_byte_outside_normalized_stream'],
    reason: 'The source-word-shaped value overlaps a confirmed _LABEL_1347_ entity animation script region, not a graphics source table.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function resolveItemDataOverlap(occurrence, sourceRegion) {
  const audit = sourceRegion.analysis?.bank7MenuItemAudit;
  if (audit?.kind !== 'item_equipment_record_group' || audit.confidence !== 'high') return null;
  const start = regionStart(sourceRegion);
  const end = regionEnd(sourceRegion);
  return makeResolvedContext('item_equipment_record_group_payload_overlap', {
    confidence: 'high',
    disposition: 'known_structured_payload_field_overlap',
    parserRole: 'item_equipment_record_group',
    sourceCatalogId: bank7MenuItemCatalogId,
    tableRange: {
      start: hex(start),
      endExclusive: hex(end),
      size: end - start,
    },
    tableByteOffsets: regionPayloadByteOffsets(occurrence, sourceRegion),
    fieldRoles: ['item_equipment_record_payload_byte'],
    reason: 'The source-word-shaped value overlaps the confirmed bank-7 item/equipment metadata group returned by _LABEL_2819_, not graphics source coverage.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function resolvePaletteScriptOverlap(occurrence, sourceRegion) {
  const audit = sourceRegion.analysis?.paletteScriptAudit;
  if (audit?.kind !== 'palette_script_record' || audit.confidence !== 'high') return null;
  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  const scriptRanges = [];
  for (const range of audit.parsedRanges || []) {
    const start = offsetOf(range.start);
    const end = offsetOf(range.endExclusive);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !rangeOverlaps(occurrenceStart, occurrenceEnd, start, end)) continue;
    scriptRanges.push({
      start: range.start,
      endExclusive: range.endExclusive,
      parsedBytes: range.parsedBytes,
    });
  }
  if (!scriptRanges.length) return null;
  return makeResolvedContext('palette_script_record_byte_overlap', {
    confidence: 'high',
    disposition: 'known_structured_payload_field_overlap',
    parserRole: 'palette_script_bytecode',
    sourceCatalogId: paletteScriptCatalogId,
    tableByteOffsets: regionPayloadByteOffsets(occurrence, sourceRegion),
    scriptRanges,
    fieldRoles: ['palette_script_command_or_operand_byte'],
    reason: 'The source-word-shaped value overlaps a fully parsed _LABEL_10BC_ palette-script record, not a graphics source table.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function inputScriptFieldRole(byteIndex) {
  if (byteIndex === 0) return 'input_script_duration_byte';
  if (byteIndex === 1) return 'input_script_command_byte';
  return 'input_script_payload_byte';
}

function resolveInputScriptOverlap(occurrence, sourceRegion) {
  const audit = sourceRegion.analysis?.inputScriptAudit;
  if (audit?.kind !== 'label_bfd_input_control_stream' || audit.confidence !== 'high') return null;
  const parsedStart = offsetOf(audit.detail?.parsedRange?.[0]);
  const parsedEnd = offsetOf(audit.detail?.parsedRange?.[1]);
  const occurrenceStart = offsetOf(occurrence.occurrenceOffset);
  const occurrenceEnd = occurrenceStart + 2;
  if (!Number.isFinite(parsedStart) || !Number.isFinite(parsedEnd)
    || !rangeOverlaps(occurrenceStart, occurrenceEnd, parsedStart, parsedEnd)) {
    return null;
  }

  const stride = 2;
  const recordIndexes = [];
  const recordOffsets = [];
  const byteOffsets = [];
  const fieldRoles = [];
  for (let byteOffset = Math.max(occurrenceStart, parsedStart); byteOffset < Math.min(occurrenceEnd, parsedEnd); byteOffset++) {
    const relative = byteOffset - parsedStart;
    const recordIndex = Math.floor(relative / stride);
    const recordByteOffset = relative % stride;
    recordIndexes.push(recordIndex);
    recordOffsets.push(parsedStart + recordIndex * stride);
    byteOffsets.push(recordByteOffset);
    fieldRoles.push(inputScriptFieldRole(recordByteOffset));
  }

  return makeResolvedContext('input_script_duration_command_record_overlap', {
    confidence: 'high',
    disposition: 'known_structured_payload_field_overlap',
    parserRole: 'input_control_duration_command_stream',
    sourceCatalogId: inputScriptCatalogId,
    recordOffsets: unique(recordOffsets).map(offset => hex(offset)),
    recordIndexes: unique(recordIndexes),
    recordByteOffsets: unique(byteOffsets),
    recordStride: stride,
    scriptRanges: [{
      start: hex(parsedStart),
      endExclusive: hex(parsedEnd),
      terminatorOffset: audit.detail?.terminatorOffset || null,
    }],
    parsedRecordCount: audit.detail?.parsedInputRecords,
    fieldRoles: unique(fieldRoles),
    reason: 'The source-word-shaped value overlaps a confirmed _LABEL_BFD_ duration/command input-control record, not a graphics source table.',
    evidenceAuditKeys: sourceRegionEvidenceKeys(sourceRegion),
  });
}

function resolveGenericStructuredOverlap(occurrence, sourceRegion) {
  const evidenceAuditKeys = sourceRegionEvidenceKeys(sourceRegion);
  if (sourceRegion.type === 'room_data') {
    return makeResolvedContext('room_data_zone_payload_overlap', {
      parserRole: 'room_zone_or_transition_data',
      reason: 'The hit is inside room_data with existing zone/recipe audits; treat it as room payload context until a consumer proves otherwise.',
      evidenceAuditKeys,
    });
  }
  if (sourceRegion.type === 'screen_prog') {
    return makeResolvedContext('screen_prog_bytecode_payload_overlap', {
      confidence: 'medium',
      disposition: 'known_structured_payload_field_overlap',
      parserRole: 'screen_prog_bytecode',
      reason: 'The hit is inside a decoded screen_prog region, so it is screen bytecode/payload context rather than confirmed tile-source coverage.',
      evidenceAuditKeys,
    });
  }
  if (sourceRegion.type === 'entity_anim_script') {
    return makeResolvedContext('entity_animation_command_stream_payload_overlap', {
      parserRole: 'entity_animation_command_stream',
      reason: 'The hit is inside an entity animation command stream, not a confirmed graphics source table.',
      evidenceAuditKeys,
    });
  }
  if (sourceRegion.type === 'audio_driver_data') {
    return makeResolvedContext('audio_driver_data_payload_overlap', {
      parserRole: 'audio_driver_data',
      reason: 'The hit is inside audio driver data; this is retained as a likely non-graphics false positive until the audio stream model is complete.',
      evidenceAuditKeys,
    });
  }
  return makeResolvedContext(`${sourceRegion.type || 'structured'}_payload_overlap_unresolved_layout`, {
    parserRole: sourceRegion.type || 'structured_payload',
    priority: 'inspect_if_other_evidence_exists',
    reason: 'The hit is inside a structured region type but no more specific field resolver exists yet.',
    evidenceAuditKeys,
  });
}

function resolveOccurrenceContext(rom, occurrence, context) {
  const fullSourceRegion = context.regionsById.get(occurrence.sourceRegion?.id) || occurrence.sourceRegion;
  if (!fullSourceRegion) return null;
  if (fullSourceRegion.type === 'room_subrecord') return resolveRoomSubrecordOverlap(occurrence, fullSourceRegion, context);
  if (fullSourceRegion.type === 'room_data') {
    return resolveRoomDataOverlap(occurrence, fullSourceRegion, context)
      || resolveGenericStructuredOverlap(occurrence, fullSourceRegion);
  }
  if (fullSourceRegion.type === 'entity_data') {
    return resolveKnownEntityDataOverlap(occurrence, fullSourceRegion)
      || resolveEntityListOverlap(rom, occurrence, fullSourceRegion, context);
  }
  if (fullSourceRegion.type === 'vdp_stream') return resolveVdpStreamOverlap(occurrence, fullSourceRegion, context);
  if (fullSourceRegion.type === 'meta_sprite') return resolveMetaspriteOverlap(occurrence, fullSourceRegion, context);
  if (fullSourceRegion.type === 'tile_map') return resolveTileMapOverlap(occurrence, fullSourceRegion, context);
  if (fullSourceRegion.type === 'pointer_table') {
    return resolvePointerTableOverlap(occurrence, fullSourceRegion, context)
      || resolveGenericStructuredOverlap(occurrence, fullSourceRegion);
  }
  if (fullSourceRegion.type === 'audio_driver_data') {
    return resolveAudioDriverDataOverlap(occurrence, fullSourceRegion)
      || resolveGenericStructuredOverlap(occurrence, fullSourceRegion);
  }
  if (fullSourceRegion.type === 'entity_anim_script') {
    return resolveEntityAnimScriptOverlap(occurrence, fullSourceRegion)
      || resolveGenericStructuredOverlap(occurrence, fullSourceRegion);
  }
  if (fullSourceRegion.type === 'item_data') {
    return resolveItemDataOverlap(occurrence, fullSourceRegion)
      || resolveGenericStructuredOverlap(occurrence, fullSourceRegion);
  }
  if (fullSourceRegion.type === 'palette_script') {
    return resolvePaletteScriptOverlap(occurrence, fullSourceRegion)
      || resolveGenericStructuredOverlap(occurrence, fullSourceRegion);
  }
  if (fullSourceRegion.type === 'input_script') {
    return resolveInputScriptOverlap(occurrence, fullSourceRegion)
      || resolveGenericStructuredOverlap(occurrence, fullSourceRegion);
  }
  if (fullSourceRegion.type === 'data_table') {
    return resolveDataTableOverlap(occurrence, fullSourceRegion)
      || resolveGenericStructuredOverlap(occurrence, fullSourceRegion);
  }
  return resolveGenericStructuredOverlap(occurrence, fullSourceRegion);
}

function tileIsBlank(rom, offset) {
  if (offset < 0 || offset + tileSizeBytes > rom.length) return false;
  for (let cursor = offset; cursor < offset + tileSizeBytes; cursor++) {
    if (rom[cursor] !== 0) return false;
  }
  return true;
}

function sourceWordForOffset(offset) {
  const bank = Math.floor(offset / 0x4000);
  const blockIndex = Math.floor((offset % 0x4000) / tileSizeBytes);
  const lo = blockIndex & 0xFF;
  const hi = (bank << 1) | ((blockIndex >> 8) & 0x01);
  return {
    word: lo | (hi << 8),
    bank,
    blockIndex,
  };
}

function collectTargetTiles(rom, entries) {
  const tiles = [];
  for (const entry of entries) {
    const start = offsetOf(entry.start);
    const endExclusive = offsetOf(entry.endExclusive);
    const tileCount = Math.floor((endExclusive - start) / tileSizeBytes);
    for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
      const tileOffset = start + tileIndex * tileSizeBytes;
      if (tileIsBlank(rom, tileOffset)) continue;
      const source = sourceWordForOffset(tileOffset);
      tiles.push({
        spanId: entry.spanId,
        targetRegion: entry.region,
        targetStart: entry.start,
        targetEndExclusive: entry.endExclusive,
        targetTileOffset: tileOffset,
        targetTileEndExclusive: tileOffset + tileSizeBytes,
        sourceWord: source.word,
        sourceBank: source.bank,
        sourceBlockIndex: source.blockIndex,
      });
    }
  }
  return tiles;
}

function scanStructuredOccurrences(rom, mapData, targetTiles) {
  const tilesByWord = new Map();
  for (const tile of targetTiles) {
    if (!tilesByWord.has(tile.sourceWord)) tilesByWord.set(tile.sourceWord, []);
    tilesByWord.get(tile.sourceWord).push(tile);
  }

  const occurrences = [];
  for (let offset = 0; offset + 1 < rom.length; offset++) {
    const word = rom[offset] | (rom[offset + 1] << 8);
    const tiles = tilesByWord.get(word);
    if (!tiles) continue;
    const sourceRegion = containingRegion(mapData, offset);
    if (!structuredLeadTypes.has(sourceRegion?.type || '')) continue;
    const sourceStart = regionStart(sourceRegion);
    for (const tile of tiles) {
      occurrences.push({
        id: `structured_occ_${hex(offset)}_${tile.spanId}_${hex(tile.sourceWord, 4)}`,
        occurrenceOffset: hex(offset),
        occurrenceRegionRelativeOffset: hex(offset - sourceStart, 4),
        sourceRegion: compactRegion(sourceRegion),
        sourceWord: hex(tile.sourceWord, 4),
        sourceBank: tile.sourceBank,
        sourceBlockIndex: hex(tile.sourceBlockIndex, 3),
        targetSpanId: tile.spanId,
        targetRegion: tile.targetRegion,
        targetSpanRange: {
          start: tile.targetStart,
          endExclusive: tile.targetEndExclusive,
        },
        targetTileOffset: hex(tile.targetTileOffset),
        targetTileEndExclusive: hex(tile.targetTileEndExclusive),
        persistedRomByteCount: 0,
        persistedHashCount: 0,
        persistedPixelCount: 0,
      });
    }
  }
  return occurrences.sort((a, b) => offsetOf(a.occurrenceOffset) - offsetOf(b.occurrenceOffset)
    || String(a.targetSpanId).localeCompare(String(b.targetSpanId))
    || offsetOf(a.targetTileOffset) - offsetOf(b.targetTileOffset));
}

function occurrenceNumeric(occurrence) {
  return {
    occurrenceOffset: offsetOf(occurrence.occurrenceOffset),
    targetTileOffset: offsetOf(occurrence.targetTileOffset),
    sourceWord: offsetOf(occurrence.sourceWord),
  };
}

function resolvedContextKind(occurrence) {
  return occurrence.resolvedContext?.kind || 'unresolved_structured_occurrence';
}

function resolvedContextDisposition(occurrence) {
  return occurrence.resolvedContext?.disposition || 'unresolved_structured_occurrence';
}

function bumpCount(target, key) {
  if (!key) return;
  target[key] = (target[key] || 0) + 1;
}

function buildRuns(occurrences) {
  const runs = [];
  const sorted = occurrences.slice().sort((a, b) => {
    const aRegion = a.sourceRegion?.id || '';
    const bRegion = b.sourceRegion?.id || '';
    if (aRegion !== bRegion) return aRegion.localeCompare(bRegion);
    if (a.targetSpanId !== b.targetSpanId) return String(a.targetSpanId).localeCompare(String(b.targetSpanId));
    return offsetOf(a.occurrenceOffset) - offsetOf(b.occurrenceOffset)
      || offsetOf(a.targetTileOffset) - offsetOf(b.targetTileOffset);
  });

  let current = [];
  function flush() {
    if (current.length < 2) {
      current = [];
      return;
    }
    const first = current[0];
    const last = current[current.length - 1];
    runs.push({
      id: `run_${first.sourceRegion.id}_${first.targetSpanId}_${first.occurrenceOffset}`,
      sourceRegion: first.sourceRegion,
      targetRegion: first.targetRegion,
      targetSpanId: first.targetSpanId,
      occurrenceStart: first.occurrenceOffset,
      occurrenceEndExclusive: hex(offsetOf(last.occurrenceOffset) + 2),
      targetTileStart: first.targetTileOffset,
      targetTileEndExclusive: last.targetTileEndExclusive,
      sourceWordStart: first.sourceWord,
      sourceWordEnd: last.sourceWord,
      wordCount: current.length,
      sourceRegionType: first.sourceRegion.type,
      classification: {
        kind: current.length >= 4 ? 'consecutive_structured_source_word_run' : 'short_structured_source_word_pair',
        confidence: current.length >= 4 ? 'medium' : 'low',
        reason: 'Consecutive little-endian source-word-shaped values appear in the same structured region for consecutive target tiles.',
      },
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    });
    current = [];
  }

  for (const occurrence of sorted) {
    const previous = current[current.length - 1];
    if (!previous) {
      current = [occurrence];
      continue;
    }
    const prev = occurrenceNumeric(previous);
    const next = occurrenceNumeric(occurrence);
    const continues = previous.sourceRegion?.id === occurrence.sourceRegion?.id
      && previous.targetSpanId === occurrence.targetSpanId
      && next.occurrenceOffset === prev.occurrenceOffset + 2
      && next.targetTileOffset === prev.targetTileOffset + tileSizeBytes
      && next.sourceWord === prev.sourceWord + 1;
    if (continues) {
      current.push(occurrence);
    } else {
      flush();
      current = [occurrence];
    }
  }
  flush();

  return runs.sort((a, b) => b.wordCount - a.wordCount
    || offsetOf(a.occurrenceStart) - offsetOf(b.occurrenceStart)
    || String(a.targetSpanId).localeCompare(String(b.targetSpanId)));
}

function classifyGroup(group) {
  const longest = group.longestRunWordCount || 0;
  if (longest >= 4) {
    return {
      kind: 'structured_region_has_consecutive_source_word_run',
      confidence: 'medium',
      priority: 'trace_structured_consumer',
      reason: 'The structured region contains at least one run of four or more consecutive source-word-shaped values for consecutive target tiles.',
    };
  }
  if (group.knownParserFieldOverlapCount > 0 && group.unresolvedContextCount === 0) {
    return {
      kind: 'structured_hits_explained_as_known_payload_field_overlaps',
      confidence: 'medium',
      priority: 'deprioritized_as_graphics_source_lead',
      reason: 'All source-word-shaped values in this structured region overlap fields already claimed by a known parser/catalog.',
    };
  }
  if (group.knownParserFieldOverlapCount > 0) {
    return {
      kind: 'mixed_structured_payload_overlaps',
      confidence: 'low',
      priority: 'inspect_unresolved_contexts_first',
      reason: 'Some source-word-shaped values are explained by known structured payload fields, while others remain generic structured payload overlaps.',
    };
  }
  if (group.occurrenceCount >= 8 && group.targetSpanCount <= 2) {
    return {
      kind: 'clustered_structured_occurrences',
      confidence: 'low',
      priority: 'inspect_cluster',
      reason: 'The structured region has several source-word-shaped occurrences concentrated in one or two target spans.',
    };
  }
  return {
    kind: 'sparse_structured_occurrences',
    confidence: 'low',
    priority: 'low_confidence_context',
    reason: 'The structured region has only sparse source-word-shaped occurrences; treat as weak context until a consumer path is found.',
  };
}

function groupBySourceRegion(occurrences, runs) {
  const runCounts = new Map();
  const longestRuns = new Map();
  for (const run of runs) {
    const regionId = run.sourceRegion?.id;
    if (!regionId) continue;
    runCounts.set(regionId, (runCounts.get(regionId) || 0) + 1);
    const previous = longestRuns.get(regionId);
    if (!previous || run.wordCount > previous.wordCount) longestRuns.set(regionId, run);
  }

  const groups = new Map();
  for (const occurrence of occurrences) {
    const regionId = occurrence.sourceRegion?.id;
    if (!regionId) continue;
    if (!groups.has(regionId)) {
      groups.set(regionId, {
        sourceRegion: occurrence.sourceRegion,
        occurrenceCount: 0,
        targetSpanIds: new Set(),
        targetRegionIds: new Set(),
        sourceWords: new Set(),
        targetSpanCounts: {},
        targetRegionCounts: {},
        resolvedContextCounts: {},
        resolvedContextDispositionCounts: {},
        resolvedContextConfidenceCounts: {},
        resolvedContextCatalogCounts: {},
        knownParserFieldOverlapCount: 0,
        unresolvedContextCount: 0,
        samples: [],
      });
    }
    const group = groups.get(regionId);
    group.occurrenceCount++;
    group.targetSpanIds.add(occurrence.targetSpanId);
    group.targetRegionIds.add(occurrence.targetRegion?.id || '');
    group.sourceWords.add(occurrence.sourceWord);
    group.targetSpanCounts[occurrence.targetSpanId] = (group.targetSpanCounts[occurrence.targetSpanId] || 0) + 1;
    const targetRegionId = occurrence.targetRegion?.id || '';
    group.targetRegionCounts[targetRegionId] = (group.targetRegionCounts[targetRegionId] || 0) + 1;
    bumpCount(group.resolvedContextCounts, resolvedContextKind(occurrence));
    bumpCount(group.resolvedContextDispositionCounts, resolvedContextDisposition(occurrence));
    bumpCount(group.resolvedContextConfidenceCounts, occurrence.resolvedContext?.confidence || 'unresolved');
    bumpCount(group.resolvedContextCatalogCounts, occurrence.resolvedContext?.sourceCatalogId || 'none');
    if (occurrence.resolvedContext?.disposition === 'known_structured_payload_field_overlap') {
      group.knownParserFieldOverlapCount++;
    } else {
      group.unresolvedContextCount++;
    }
    if (group.samples.length < 10) {
      group.samples.push({
        occurrenceOffset: occurrence.occurrenceOffset,
        occurrenceRegionRelativeOffset: occurrence.occurrenceRegionRelativeOffset,
        sourceWord: occurrence.sourceWord,
        targetSpanId: occurrence.targetSpanId,
        targetTileOffset: occurrence.targetTileOffset,
        targetRegion: occurrence.targetRegion,
        resolvedContext: compactResolvedContext(occurrence.resolvedContext),
      });
    }
  }

  return [...groups.values()].map(group => {
    const longestRun = longestRuns.get(group.sourceRegion.id) || null;
    const entry = {
      id: `${group.sourceRegion.id}_structured_source_occurrences`,
      sourceRegion: group.sourceRegion,
      occurrenceCount: group.occurrenceCount,
      targetSpanCount: group.targetSpanIds.size,
      targetRegionCount: group.targetRegionIds.size,
      sourceWordCount: group.sourceWords.size,
      runCount: runCounts.get(group.sourceRegion.id) || 0,
      longestRunWordCount: longestRun?.wordCount || 0,
      resolvedContextCounts: group.resolvedContextCounts,
      resolvedContextDispositionCounts: group.resolvedContextDispositionCounts,
      resolvedContextConfidenceCounts: group.resolvedContextConfidenceCounts,
      resolvedContextCatalogCounts: group.resolvedContextCatalogCounts,
      knownParserFieldOverlapCount: group.knownParserFieldOverlapCount,
      unresolvedContextCount: group.unresolvedContextCount,
      longestRun: longestRun ? {
        targetSpanId: longestRun.targetSpanId,
        occurrenceStart: longestRun.occurrenceStart,
        occurrenceEndExclusive: longestRun.occurrenceEndExclusive,
        targetTileStart: longestRun.targetTileStart,
        targetTileEndExclusive: longestRun.targetTileEndExclusive,
        sourceWordStart: longestRun.sourceWordStart,
        sourceWordEnd: longestRun.sourceWordEnd,
        wordCount: longestRun.wordCount,
        classification: longestRun.classification,
      } : null,
      topTargetSpans: topCounts(group.targetSpanCounts, 8),
      topTargetRegions: topCounts(group.targetRegionCounts, 8),
      samples: group.samples,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    };
    entry.classification = classifyGroup(entry);
    return entry;
  }).sort((a, b) => b.longestRunWordCount - a.longestRunWordCount
    || b.occurrenceCount - a.occurrenceCount
    || offsetOf(a.sourceRegion.offset) - offsetOf(b.sourceRegion.offset));
}

function classifyTargetSpanGroup(group, spanRuns) {
  if (spanRuns[0]?.wordCount >= 4) {
    return {
      kind: 'target_span_has_structured_consecutive_run',
      confidence: 'medium',
      priority: 'trace_structured_consumer',
      reason: 'A structured source region contains a consecutive source-word run for this target span.',
    };
  }
  if (group.knownParserFieldOverlapCount > 0 && group.unresolvedContextCount === 0) {
    return {
      kind: 'target_span_structured_hits_explained_as_known_payload_field_overlaps',
      confidence: 'medium',
      priority: 'trace_non_structured_or_direct_consumers',
      reason: 'All structured source-word-shaped hits for this target span overlap fields already claimed by known parsers.',
    };
  }
  if (group.knownParserFieldOverlapCount > 0) {
    return {
      kind: 'target_span_has_mixed_structured_payload_overlaps',
      confidence: 'low',
      priority: 'inspect_unresolved_structured_contexts',
      reason: 'Some structured hits are known parser field overlaps; remaining generic payload hits still need trace evidence.',
    };
  }
  return {
    kind: 'target_span_has_sparse_structured_occurrences',
    confidence: 'low',
    priority: 'inspect_structured_occurrences',
    reason: 'Structured source-word-shaped occurrences exist, but no long consecutive run has been found.',
  };
}

function groupByTargetSpan(occurrences, runs, contextBySpan) {
  const runsBySpan = new Map();
  for (const run of runs) {
    if (!runsBySpan.has(run.targetSpanId)) runsBySpan.set(run.targetSpanId, []);
    runsBySpan.get(run.targetSpanId).push(run);
  }

  const groups = new Map();
  for (const occurrence of occurrences) {
    if (!groups.has(occurrence.targetSpanId)) {
      groups.set(occurrence.targetSpanId, {
        spanId: occurrence.targetSpanId,
        targetRegion: occurrence.targetRegion,
        targetSpanRange: occurrence.targetSpanRange,
        occurrenceCount: 0,
        sourceRegionIds: new Set(),
        sourceRegionTypeCounts: {},
        sourceRegionCounts: {},
        resolvedContextCounts: {},
        resolvedContextDispositionCounts: {},
        resolvedContextConfidenceCounts: {},
        knownParserFieldOverlapCount: 0,
        unresolvedContextCount: 0,
        samples: [],
      });
    }
    const group = groups.get(occurrence.targetSpanId);
    group.occurrenceCount++;
    group.sourceRegionIds.add(occurrence.sourceRegion?.id || '');
    const type = occurrence.sourceRegion?.type || 'unknown';
    group.sourceRegionTypeCounts[type] = (group.sourceRegionTypeCounts[type] || 0) + 1;
    const regionId = occurrence.sourceRegion?.id || '';
    group.sourceRegionCounts[regionId] = (group.sourceRegionCounts[regionId] || 0) + 1;
    bumpCount(group.resolvedContextCounts, resolvedContextKind(occurrence));
    bumpCount(group.resolvedContextDispositionCounts, resolvedContextDisposition(occurrence));
    bumpCount(group.resolvedContextConfidenceCounts, occurrence.resolvedContext?.confidence || 'unresolved');
    if (occurrence.resolvedContext?.disposition === 'known_structured_payload_field_overlap') {
      group.knownParserFieldOverlapCount++;
    } else {
      group.unresolvedContextCount++;
    }
    if (group.samples.length < 10) {
      group.samples.push({
        occurrenceOffset: occurrence.occurrenceOffset,
        sourceRegion: occurrence.sourceRegion,
        sourceWord: occurrence.sourceWord,
        targetTileOffset: occurrence.targetTileOffset,
        resolvedContext: compactResolvedContext(occurrence.resolvedContext),
      });
    }
  }

  return [...groups.values()].map(group => {
    const spanRuns = (runsBySpan.get(group.spanId) || []).sort((a, b) => b.wordCount - a.wordCount);
    const context = contextBySpan.get(group.spanId) || null;
    return {
      id: `${group.spanId}_structured_source_occurrence_target`,
      spanId: group.spanId,
      targetRegion: group.targetRegion,
      targetSpanRange: group.targetSpanRange,
      occurrenceCount: group.occurrenceCount,
      sourceRegionCount: group.sourceRegionIds.size,
      sourceRegionTypeCounts: group.sourceRegionTypeCounts,
      topSourceRegionTypes: topCounts(group.sourceRegionTypeCounts, 8),
      topSourceRegions: topCounts(group.sourceRegionCounts, 10),
      resolvedContextCounts: group.resolvedContextCounts,
      resolvedContextDispositionCounts: group.resolvedContextDispositionCounts,
      resolvedContextConfidenceCounts: group.resolvedContextConfidenceCounts,
      knownParserFieldOverlapCount: group.knownParserFieldOverlapCount,
      unresolvedContextCount: group.unresolvedContextCount,
      runCount: spanRuns.length,
      longestRunWordCount: spanRuns[0]?.wordCount || 0,
      longestRuns: spanRuns.slice(0, 5),
      priorContextClassification: context?.classification || null,
      samples: group.samples,
      classification: classifyTargetSpanGroup(group, spanRuns),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    };
  }).sort((a, b) => b.longestRunWordCount - a.longestRunWordCount
    || b.occurrenceCount - a.occurrenceCount
    || offsetOf(a.targetSpanRange.start) - offsetOf(b.targetSpanRange.start));
}

function buildCatalog(mapData, rom) {
  const remainingLeadCatalog = requireCatalog(mapData, remainingLeadCatalogId);
  const sourceWordContextCatalog = requireCatalog(mapData, sourceWordContextCatalogId);
  const resolverContext = buildResolverContext(mapData, rom);
  const contextBySpan = new Map((sourceWordContextCatalog.entries || []).map(entry => [entry.spanId, entry]));
  const leadEntries = (remainingLeadCatalog.entries || [])
    .filter(entry => Number(entry.nonblankTileCount || 0) > 0);
  const targetTiles = collectTargetTiles(rom, leadEntries);
  const occurrences = scanStructuredOccurrences(rom, mapData, targetTiles)
    .map(occurrence => ({
      ...occurrence,
      resolvedContext: compactResolvedContext(resolveOccurrenceContext(rom, occurrence, resolverContext)),
    }));
  const runs = buildRuns(occurrences);
  const sourceRegions = groupBySourceRegion(occurrences, runs);
  const targetSpans = groupByTargetSpan(occurrences, runs, contextBySpan);
  const resolverCatalogs = resolverContext.availableCatalogs;
  const summary = {
    sourceCatalogs: [remainingLeadCatalogId, sourceWordContextCatalogId, ...resolverCatalogs],
    targetSpanCount: leadEntries.length,
    targetTileCount: targetTiles.length,
    structuredOccurrenceCount: occurrences.length,
    resolvedStructuredOccurrenceCount: occurrences.filter(occurrence => occurrence.resolvedContext).length,
    knownParserFieldOverlapCount: occurrences.filter(occurrence => occurrence.resolvedContext?.disposition === 'known_structured_payload_field_overlap').length,
    unresolvedStructuredOccurrenceCount: occurrences.filter(occurrence => occurrence.resolvedContext?.disposition !== 'known_structured_payload_field_overlap').length,
    sourceRegionCount: sourceRegions.length,
    targetSpanWithStructuredOccurrenceCount: targetSpans.length,
    consecutiveRunCount: runs.length,
    longRunCount: runs.filter(run => run.wordCount >= 4).length,
    longestRunWordCount: runs[0]?.wordCount || 0,
    sourceRegionTypeCounts: countBy(occurrences, occurrence => occurrence.sourceRegion?.type || 'unknown'),
    resolvedContextCounts: countBy(occurrences, occurrence => resolvedContextKind(occurrence)),
    resolvedContextDispositionCounts: countBy(occurrences, occurrence => resolvedContextDisposition(occurrence)),
    resolvedContextConfidenceCounts: countBy(occurrences, occurrence => occurrence.resolvedContext?.confidence || 'unresolved'),
    sourceRegionClassificationCounts: countBy(sourceRegions, entry => entry.classification.kind),
    targetSpanClassificationCounts: countBy(targetSpans, entry => entry.classification.kind),
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    assetPolicy: 'Metadata only: source-word occurrence offsets, containing region ids/types, target span offsets, source-word values, counts, and run summaries. No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 2,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [remainingLeadCatalogId, sourceWordContextCatalogId, ...resolverCatalogs],
    summary,
    sourceRegions,
    targetSpans,
    runs,
    occurrences,
    topRuns: runs.slice(0, 16),
    topSourceRegions: sourceRegions.slice(0, 16).map(entry => ({
      sourceRegion: entry.sourceRegion,
      occurrenceCount: entry.occurrenceCount,
      targetSpanCount: entry.targetSpanCount,
      runCount: entry.runCount,
      longestRunWordCount: entry.longestRunWordCount,
      knownParserFieldOverlapCount: entry.knownParserFieldOverlapCount,
      unresolvedContextCount: entry.unresolvedContextCount,
      topResolvedContexts: topCounts(entry.resolvedContextCounts, 6),
      resolvedContextDispositionCounts: entry.resolvedContextDispositionCounts,
      longestRun: entry.longestRun,
      classification: entry.classification,
    })),
    topTargetSpans: targetSpans.slice(0, 16).map(entry => ({
      spanId: entry.spanId,
      targetRegion: entry.targetRegion,
      targetSpanRange: entry.targetSpanRange,
      occurrenceCount: entry.occurrenceCount,
      sourceRegionCount: entry.sourceRegionCount,
      longestRunWordCount: entry.longestRunWordCount,
      knownParserFieldOverlapCount: entry.knownParserFieldOverlapCount,
      unresolvedContextCount: entry.unresolvedContextCount,
      topSourceRegionTypes: entry.topSourceRegionTypes,
      topResolvedContexts: topCounts(entry.resolvedContextCounts, 6),
      resolvedContextDispositionCounts: entry.resolvedContextDispositionCounts,
      classification: entry.classification,
    })),
    evidence: [
      'Target spans come from the remaining graphics lead reconciliation catalog.',
      'Only occurrences in structured non-loader region types are retained in this audit.',
      'Consecutive runs require consecutive source-region word offsets and consecutive target tile/source-word values.',
      'Resolved-context classifications are derived from existing parser catalogs and region analyses; they explain byte ownership but do not prove graphics source coverage.',
      'Occurrence context is trace evidence only; it does not prove that the structured region consumes the graphics data.',
      'No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.',
    ],
    nextLeads: [
      'Ignore/deprioritize source-word hits explained as known parser field overlaps unless another consumer path references the same target tiles.',
      'Trace source regions with structured_region_has_consecutive_source_word_run before generic sparse occurrence groups.',
      'For target spans with only explained structured hits, prefer direct-copy/decompression and dynamic-bank traces over raw source-word coincidences.',
      'If a source-region run is confirmed as a real consumer table, add a source family to the combined graphics coverage audit.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedTargetRegions = [];
  const targetByRegion = new Map();
  for (const target of catalog.targetSpans) {
    const regionId = target.targetRegion?.id;
    if (!regionId) continue;
    if (!targetByRegion.has(regionId)) {
      targetByRegion.set(regionId, {
        spanCount: 0,
        occurrenceCount: 0,
        runCount: 0,
        longestRunWordCount: 0,
        classificationCounts: {},
        resolvedContextCounts: {},
        resolvedContextDispositionCounts: {},
        knownParserFieldOverlapCount: 0,
        unresolvedContextCount: 0,
        topSpans: [],
      });
    }
    const group = targetByRegion.get(regionId);
    group.spanCount++;
    group.occurrenceCount += target.occurrenceCount;
    group.runCount += target.runCount;
    group.longestRunWordCount = Math.max(group.longestRunWordCount, target.longestRunWordCount);
    group.classificationCounts[target.classification.kind] = (group.classificationCounts[target.classification.kind] || 0) + 1;
    for (const [key, count] of Object.entries(target.resolvedContextCounts || {})) {
      group.resolvedContextCounts[key] = (group.resolvedContextCounts[key] || 0) + count;
    }
    for (const [key, count] of Object.entries(target.resolvedContextDispositionCounts || {})) {
      group.resolvedContextDispositionCounts[key] = (group.resolvedContextDispositionCounts[key] || 0) + count;
    }
    group.knownParserFieldOverlapCount += target.knownParserFieldOverlapCount || 0;
    group.unresolvedContextCount += target.unresolvedContextCount || 0;
    group.topSpans.push({
      spanId: target.spanId,
      targetSpanRange: target.targetSpanRange,
      occurrenceCount: target.occurrenceCount,
      sourceRegionCount: target.sourceRegionCount,
      longestRunWordCount: target.longestRunWordCount,
      knownParserFieldOverlapCount: target.knownParserFieldOverlapCount,
      unresolvedContextCount: target.unresolvedContextCount,
      topResolvedContexts: topCounts(target.resolvedContextCounts, 6),
      classification: target.classification,
    });
  }

  for (const [regionId, group] of targetByRegion.entries()) {
    const region = findRegionById(mapData, regionId);
    if (!region) continue;
    group.topSpans.sort((a, b) => b.longestRunWordCount - a.longestRunWordCount || b.occurrenceCount - a.occurrenceCount);
    region.analysis = region.analysis || {};
    region.analysis.graphicsStructuredSourceOccurrenceAudit = {
      catalogId,
      kind: 'graphics_structured_source_occurrence_target',
      confidence: group.longestRunWordCount >= 4 ? 'medium' : 'low',
      spanCount: group.spanCount,
      occurrenceCount: group.occurrenceCount,
      runCount: group.runCount,
      longestRunWordCount: group.longestRunWordCount,
      knownParserFieldOverlapCount: group.knownParserFieldOverlapCount,
      unresolvedContextCount: group.unresolvedContextCount,
      classificationCounts: group.classificationCounts,
      resolvedContextCounts: group.resolvedContextCounts,
      resolvedContextDispositionCounts: group.resolvedContextDispositionCounts,
      topSpans: group.topSpans.slice(0, 8),
      summary: `${group.spanCount} unresolved graphics span(s) have structured-region source-word occurrence detail.`,
      evidence: [
        `Derived from ${catalogId}; occurrence detail is trace evidence only, not confirmed source coverage.`,
        'No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedTargetRegions.push({
      region: compactRegion(region),
      spanCount: group.spanCount,
      occurrenceCount: group.occurrenceCount,
      runCount: group.runCount,
      longestRunWordCount: group.longestRunWordCount,
      knownParserFieldOverlapCount: group.knownParserFieldOverlapCount,
      unresolvedContextCount: group.unresolvedContextCount,
      classificationCounts: group.classificationCounts,
      resolvedContextCounts: group.resolvedContextCounts,
      resolvedContextDispositionCounts: group.resolvedContextDispositionCounts,
    });
  }

  const annotatedSourceRegions = [];
  for (const source of catalog.sourceRegions) {
    const region = findRegionById(mapData, source.sourceRegion.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.structuredGraphicsSourceWordLeadAudit = {
      catalogId,
      kind: 'structured_graphics_source_word_lead',
      confidence: source.classification.confidence,
      occurrenceCount: source.occurrenceCount,
      targetSpanCount: source.targetSpanCount,
      targetRegionCount: source.targetRegionCount,
      sourceWordCount: source.sourceWordCount,
      runCount: source.runCount,
      longestRunWordCount: source.longestRunWordCount,
      knownParserFieldOverlapCount: source.knownParserFieldOverlapCount,
      unresolvedContextCount: source.unresolvedContextCount,
      resolvedContextCounts: source.resolvedContextCounts,
      resolvedContextDispositionCounts: source.resolvedContextDispositionCounts,
      resolvedContextCatalogCounts: source.resolvedContextCatalogCounts,
      longestRun: source.longestRun,
      topTargetSpans: source.topTargetSpans,
      classification: source.classification,
      samples: source.samples,
      summary: `${source.occurrenceCount} source-word-shaped occurrence(s) for unresolved graphics spans appear in this structured region.`,
      evidence: [
        `Derived from ${catalogId}; this is a low-level occurrence index for tracing possible non-loader graphics consumers.`,
        'No ROM bytes, hashes, decoded graphics, pixels, screenshots, or rendered tiles are stored.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedSourceRegions.push({
      region: compactRegion(region),
      occurrenceCount: source.occurrenceCount,
      targetSpanCount: source.targetSpanCount,
      runCount: source.runCount,
      longestRunWordCount: source.longestRunWordCount,
      knownParserFieldOverlapCount: source.knownParserFieldOverlapCount,
      unresolvedContextCount: source.unresolvedContextCount,
      resolvedContextCounts: source.resolvedContextCounts,
      resolvedContextDispositionCounts: source.resolvedContextDispositionCounts,
      classification: source.classification,
    });
  }

  return { annotatedTargetRegions, annotatedSourceRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotations = apply ? annotateMap(mapData, catalog) : {
    annotatedTargetRegions: [],
    annotatedSourceRegions: [],
  };

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_structured_source_occurrence_audit',
      schemaVersion: 2,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedTargetRegionCount: annotations.annotatedTargetRegions.length,
        annotatedSourceRegionCount: annotations.annotatedSourceRegions.length,
      },
      topRuns: catalog.topRuns,
      topSourceRegions: catalog.topSourceRegions,
      topTargetSpans: catalog.topTargetSpans,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      annotatedTargetRegions: annotations.annotatedTargetRegions,
      annotatedSourceRegions: annotations.annotatedSourceRegions,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedTargetRegionCount: annotations.annotatedTargetRegions.length,
      annotatedSourceRegionCount: annotations.annotatedSourceRegions.length,
    },
    topRuns: catalog.topRuns.slice(0, 10),
    topSourceRegions: catalog.topSourceRegions.slice(0, 10),
    topTargetSpans: catalog.topTargetSpans.slice(0, 10),
  }, null, 2));
}

main();
