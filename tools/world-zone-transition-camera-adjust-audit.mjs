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
const catalogId = 'world-zone-transition-camera-adjust-catalog-2026-06-25';
const reportId = 'zone-transition-camera-adjust-audit-2026-06-25';
const toolName = 'tools/world-zone-transition-camera-adjust-audit.mjs';

const sourceCatalogIds = {
  zoneRecipes: 'world-zone-recipe-catalog-2026-06-25',
  zoneCameraScroll: 'world-zone-camera-scroll-catalog-2026-06-25',
  zoneTriggerRecord: 'world-zone-trigger-record-catalog-2026-06-25',
  zoneTriggerDestinationRole: 'world-zone-trigger-destination-role-catalog-2026-06-25',
  zoneDescriptorPointerFlow: 'world-zone-descriptor-pointer-flow-catalog-2026-06-25',
};

const transitionCameraDeltaModes = [
  { opcodeIndex: 0x16, rawOpcode: '0x16', deltaWord: '0x0100', signedDeltaPixels: 0x0100, transitionTableEntryNumber: 22, transitionTableTarget: '_LABEL_4CED_', direction: 'positive', distancePages: 1 },
  { opcodeIndex: 0x17, rawOpcode: '0x17', deltaWord: '0x0300', signedDeltaPixels: 0x0300, transitionTableEntryNumber: 23, transitionTableTarget: '_LABEL_4CED_', direction: 'positive', distancePages: 3 },
  { opcodeIndex: 0x18, rawOpcode: '0x18', deltaWord: '0xFF00', signedDeltaPixels: -0x0100, transitionTableEntryNumber: 24, transitionTableTarget: '_LABEL_4CED_', direction: 'negative', distancePages: 1 },
  { opcodeIndex: 0x19, rawOpcode: '0x19', deltaWord: '0xFD00', signedDeltaPixels: -0x0300, transitionTableEntryNumber: 25, transitionTableTarget: '_LABEL_4CED_', direction: 'negative', distancePages: 3 },
];

const routineRoles = [
  {
    label: '_LABEL_4816_',
    offset: 0x04816,
    role: 'room_trigger_record_scanner_bounds_current_subject_x',
    confidence: 'high',
    summary: 'Scans 7-byte trigger records, shifts the record X unit left by three into _RAM_D0DE_, and accepts the trigger only when _RAM_C243_ is inside the record X span and _RAM_C246_ is inside the Y span.',
    evidence: [
      'ASM lines 10979-11024 read the trigger X unit, shift it left by three into _RAM_D0DE_, subtract it from _RAM_C243_, and reject when _RAM_C243_ is outside the X span.',
      'ASM lines 11025-11043 compare _RAM_C246_ with the record Y anchor/span and store the overlap depth in _RAM_D0E3_ before dispatch.',
    ],
  },
  {
    label: '_LABEL_48A9_',
    offset: 0x048A9,
    role: 'room_trigger_opcode_dispatcher_preserves_raw_opcode',
    confidence: 'high',
    summary: 'Reads the raw trigger opcode into B, writes the trigger destination pointer to _RAM_CFFA_, masks A with $1F, then dispatches through _DATA_48C5_.',
    evidence: [
      'ASM lines 11076-11093 read record byte +4 into B, store DE to _RAM_CFFA_, mask A with $1F, and dispatch through _DATA_48C5_.',
    ],
  },
  {
    label: '_LABEL_4903_',
    offset: 0x04903,
    role: 'immediate_room_load_preserves_c26e_transition_opcode',
    confidence: 'high',
    summary: 'Stores raw opcode B to _RAM_C26E_, loads the destination descriptor pointer from _RAM_CFFA_, and calls _LABEL_2620_.',
    evidence: [
      'ASM lines 11101-11112 store B to _RAM_C26E_, load HL from _RAM_CFFA_, and call _LABEL_2620_.',
    ],
  },
  {
    label: '_LABEL_2620_',
    offset: 0x02620,
    role: 'room_load_camera_transition_delta_consumer',
    confidence: 'high',
    summary: 'After loading room assets, reads _RAM_C26E_ & $3F and applies the $16-$19 camera seed deltas to _RAM_C243_ before _LABEL_FA1_ clamps the scroll anchor.',
    evidence: [
      'ASM lines 6446-6470 compare (_RAM_C26E_ & $3F) with $16/$18/$1A and add $0100, $0300, $FF00, or $FD00 to _RAM_C243_ for values $16-$19.',
    ],
  },
  {
    label: '_DATA_48C5_',
    offset: 0x048C5,
    role: 'room_trigger_opcode_dispatch_table',
    confidence: 'high',
    summary: 'Trigger opcode dispatch entries 22-25 target _LABEL_4903_, so raw opcodes $16-$19 immediately load a room while preserving the raw opcode in _RAM_C26E_.',
    evidence: [
      'ASM lines 11095-11099 show _DATA_48C5_ entries 22-25 all target _LABEL_4903_.',
    ],
  },
  {
    label: '_DATA_4CAD_',
    offset: 0x04CAD,
    role: 'room_transition_opcode_dispatch_table',
    confidence: 'high',
    summary: '_RAM_C26E_ transition table entries $16-$19 resolve to _LABEL_4CED_, the standard room-load path; the camera delta is handled by _LABEL_2620_ rather than by a distinct table target.',
    evidence: [
      'ASM lines 11608-11613 index _DATA_4CAD_ from (_RAM_C26E_ & $3F) - 1; entries 22-25 all list _LABEL_4CED_.',
    ],
  },
];

const ramRoles = [
  { address: '$C26E', role: 'room_type_transition_mode_camera_delta_selector' },
  { address: '$CFFA', role: 'immediate_room_load_destination_pointer' },
  { address: '$C243', role: 'camera_subject_world_x_adjusted_before_clamp' },
  { address: '$C246', role: 'camera_subject_world_y_trigger_check_input' },
  { address: '$D00F', role: 'camera_scroll_anchor_after_adjustment_and_clamp' },
  { address: '$D0DE', role: 'trigger_x_left_pixels_or_next_record_pointer_scratch' },
  { address: '$D0E1', role: 'trigger_x_span_pixels_word_or_pointer_scratch' },
  { address: '$D0E3', role: 'trigger_y_overlap_depth_for_deferred_transition_alignment' },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function hexWord(n) {
  return hex(n & 0xFFFF, 4);
}

function hexByte(n) {
  return hex(n & 0xFF, 2);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
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

function ramRef(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || 'byte',
    name: entry.name || '',
  };
}

function findCatalog(mapData, id) {
  return Object.keys(mapData)
    .filter(key => Array.isArray(mapData[key]) && /catalog/i.test(key))
    .flatMap(key => mapData[key].map(catalog => ({ bucket: key, catalog })))
    .find(item => item.catalog?.id === id) || null;
}

function sourceCatalogRefs(mapData) {
  return Object.fromEntries(Object.entries(sourceCatalogIds).map(([key, id]) => {
    const found = findCatalog(mapData, id);
    return [key, found ? { id, bucket: found.bucket } : null];
  }));
}

function modeByOpcode() {
  return new Map(transitionCameraDeltaModes.map(mode => [mode.opcodeIndex, mode]));
}

function clampCase(unclamped, maxBound) {
  if (unclamped < 0) return 'left_edge';
  if (unclamped > maxBound) return 'right_bound';
  return 'within_bound';
}

function clampScrollAnchor(subjectWorldX, maxBound) {
  return Math.max(0, Math.min(subjectWorldX - 0x80, maxBound));
}

function clampCasesForRange(minUnclamped, maxUnclamped, maxBound) {
  const cases = [];
  if (minUnclamped < 0) cases.push('left_edge');
  if (maxUnclamped >= 0 && minUnclamped <= maxBound) cases.push('within_bound');
  if (maxUnclamped > maxBound) cases.push('right_bound');
  return cases;
}

function wordOrNull(n) {
  return n >= 0 && n <= 0xFFFF ? hexWord(n) : null;
}

function triggerSubjectXRange(record) {
  const geometry = record.geometry || null;
  if (!geometry || geometry.xPixelsLeft == null || geometry.xSpanPixels == null) return null;
  const minPixels = geometry.xPixelsLeft;
  const maxPixelsInclusive = geometry.xPixelsLeft + geometry.xSpanPixels - 1;
  return {
    minPixels,
    maxPixelsInclusive,
    minWord: wordOrNull(minPixels),
    maxWord: wordOrNull(maxPixelsInclusive),
    widthPixels: geometry.xSpanPixels,
    source: 'room trigger record X range accepted by _LABEL_4816_ before _LABEL_48A9_ dispatch',
    recordGeometry: {
      xUnit: geometry.xUnit,
      xSpanUnits: geometry.xSpanUnits,
      xPixelsLeft: geometry.xPixelsLeft,
      xSpanPixels: geometry.xSpanPixels,
    },
  };
}

function rangeAnchorFromTrigger(record, recipe, mode) {
  const sourceRange = triggerSubjectXRange(record);
  const maxBoundWord = recipe.dependencies?.cameraScroll?.collisionBufferRef?.finalBoundWord || recipe.dependencies?.collisionBuffer?.finalBoundWord || null;
  if (!sourceRange || !maxBoundWord) {
    return {
      computable: false,
      precision: 'unresolved',
      reason: !sourceRange ? 'missing_trigger_x_geometry' : 'missing_collision_bound',
    };
  }
  const maxBound = parseInt(maxBoundWord, 16);
  const adjustedMin = sourceRange.minPixels + mode.signedDeltaPixels;
  const adjustedMax = sourceRange.maxPixelsInclusive + mode.signedDeltaPixels;
  const unclampedMin = adjustedMin - 0x80;
  const unclampedMax = adjustedMax - 0x80;
  const anchorMin = clampScrollAnchor(adjustedMin, maxBound);
  const anchorMax = clampScrollAnchor(adjustedMax, maxBound);
  const redrawMin = (anchorMin + 7) >> 3;
  const redrawMax = (anchorMax + 7) >> 3;
  return {
    computable: true,
    precision: 'trigger_preserved_c243_range',
    descriptorWorldX: null,
    descriptorScrollX: 'keep',
    sourceSubjectXRange: sourceRange,
    deltaWord: mode.deltaWord,
    signedDeltaPixels: mode.signedDeltaPixels,
    adjustedWorldXRange: {
      minPixels: adjustedMin,
      maxPixelsInclusive: adjustedMax,
      minWordIfInRange: wordOrNull(adjustedMin),
      maxWordIfInRange: wordOrNull(adjustedMax),
    },
    maxScrollAnchorWord: maxBoundWord,
    unclampedSignedRange: {
      minPixels: unclampedMin,
      maxPixelsInclusive: unclampedMax,
      minWordIfNonNegative: wordOrNull(unclampedMin),
      maxWordIfNonNegative: wordOrNull(unclampedMax),
    },
    clampCases: clampCasesForRange(unclampedMin, unclampedMax, maxBound),
    scrollAnchorRange: {
      minPixels: anchorMin,
      maxPixelsInclusive: anchorMax,
      minWord: hexWord(anchorMin),
      maxWord: hexWord(anchorMax),
    },
    scrollShadowLowByteRange: {
      startLowByte: hexByte(anchorMin),
      endLowByteInclusive: hexByte(anchorMax),
      wrapsPage: (anchorMin & 0xFF) > (anchorMax & 0xFF),
      source: 'low byte of scrollAnchorRange; this is an endpoint range and may wrap when the anchor interval crosses a 256-pixel page',
    },
    redrawTargetColumnRange: {
      min: redrawMin,
      maxInclusive: redrawMax,
      minHex: hexByte(redrawMin),
      maxHex: hexByte(redrawMax),
    },
    evidence: [
      'Destination descriptor scroll X is $FF, so ASM lines 6366-6378 skip writing _RAM_C243_ and preserve the trigger-time subject X.',
      'ASM lines 10979-11024 bound trigger-time _RAM_C243_ to the trigger record X interval.',
      'ASM lines 6446-6470 apply the exact transition delta to preserved _RAM_C243_ before _LABEL_FA1_.',
    ],
  };
}

function computeAdjustedAnchor(recipe, mode, record) {
  const cameraScroll = recipe.dependencies?.cameraScroll || null;
  const initial = cameraScroll?.descriptorInitialWorldX || null;
  const maxBoundWord = cameraScroll?.collisionBufferRef?.finalBoundWord || recipe.dependencies?.collisionBuffer?.finalBoundWord || null;
  if (!initial?.known) {
    return rangeAnchorFromTrigger(record, recipe, mode);
  }
  if (!maxBoundWord) {
    return {
      computable: false,
      precision: 'unresolved',
      reason: 'missing_collision_bound',
    };
  }
  const adjustedWorldX = initial.pixels + mode.signedDeltaPixels;
  const maxBound = parseInt(maxBoundWord, 16);
  const unclamped = adjustedWorldX - 0x80;
  const clamped = clampScrollAnchor(adjustedWorldX, maxBound);
  const targetColumn = (clamped + 7) >> 3;
  return {
    computable: true,
    precision: 'descriptor_scroll_x_exact',
    descriptorWorldX: initial.word,
    deltaWord: mode.deltaWord,
    adjustedWorldXWord: hexWord(adjustedWorldX),
    adjustedWorldXPixels: adjustedWorldX,
    maxScrollAnchorWord: maxBoundWord,
    unclampedSignedPixels: unclamped,
    unclampedWordIfNonNegative: unclamped < 0 ? null : hexWord(unclamped),
    clampCase: clampCase(unclamped, maxBound),
    scrollAnchorWord: hexWord(clamped),
    scrollAnchorPixels: clamped,
    scrollShadowLowByte: hexByte(clamped),
    redrawTargetColumn: targetColumn,
    redrawTargetColumnHex: hexByte(targetColumn),
  };
}

function collectTransitionTriggerRecords(triggerCatalog, recipesByDescriptor) {
  const modes = modeByOpcode();
  const physical = [];
  const expanded = [];
  for (const table of triggerCatalog?.triggerTables || []) {
    for (const record of table.records || []) {
      const opcodeIndex = record.opcode?.index;
      if (!modes.has(opcodeIndex)) continue;
      const mode = modes.get(opcodeIndex);
      const physicalRecord = {
        triggerTableId: table.id,
        triggerTableOffset: table.romOffset,
        entryOffset: record.entryOffset,
        recordIndex: record.index,
        rawOpcode: record.opcode.raw,
        opcodeIndex,
        mode,
        destination: record.destination || null,
        usedByDescriptorCount: (table.usedByDescriptors || []).length,
        usedByDescriptors: table.usedByDescriptors || [],
        geometry: record.geometry || null,
      };
      physical.push(physicalRecord);
      for (const source of table.usedByDescriptors || []) {
        const destinationRecipe = record.destination?.descriptorId ? recipesByDescriptor.get(record.destination.descriptorId) || null : null;
        expanded.push({
          sourceDescriptorId: source.descriptorId,
          sourceRecipeId: source.recipeId || null,
          sourceDescriptorOffset: source.descriptorOffset || null,
          triggerTableId: table.id,
          triggerTableOffset: table.romOffset,
          triggerRecordOffset: record.entryOffset,
          triggerRecordIndex: record.index,
          rawOpcode: record.opcode.raw,
          opcodeIndex,
          mode,
          triggerGeometry: record.geometry || null,
          destinationDescriptorId: record.destination?.descriptorId || null,
          destinationRecipeId: destinationRecipe?.id || null,
          destinationDescriptorOffset: record.destination?.romOffset || null,
          destinationInZoneGraph: record.destination?.inZoneGraph ?? null,
          adjustedCameraAnchor: destinationRecipe ? computeAdjustedAnchor(destinationRecipe, mode, record) : null,
        });
      }
    }
  }
  return { physical, expanded };
}

function histogram(records, keyFn) {
  const result = new Map();
  for (const record of records) {
    const key = keyFn(record);
    result.set(key, (result.get(key) || 0) + 1);
  }
  return Object.fromEntries([...result.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))
    .map(([key, value]) => [String(key), value]));
}

function buildCatalog(mapData, recipes, sourceCatalogs) {
  const triggerCatalog = findCatalog(mapData, sourceCatalogIds.zoneTriggerRecord)?.catalog || null;
  const recipesByDescriptor = new Map(recipes.map(recipe => [recipe.sourceDescriptorId, recipe]));
  const { physical, expanded } = collectTransitionTriggerRecords(triggerCatalog, recipesByDescriptor);
  const destinationRecipeIds = new Set(expanded.map(record => record.destinationRecipeId).filter(Boolean));
  const sourceRecipeIds = new Set(expanded.map(record => record.sourceRecipeId).filter(Boolean));
  const adjustedComputable = expanded.filter(record => record.adjustedCameraAnchor?.computable);
  const adjustedUncomputable = expanded.filter(record => record.adjustedCameraAnchor && !record.adjustedCameraAnchor.computable);
  const adjustedExact = adjustedComputable.filter(record => record.adjustedCameraAnchor.precision === 'descriptor_scroll_x_exact');
  const adjustedRange = adjustedComputable.filter(record => record.adjustedCameraAnchor.precision === 'trigger_preserved_c243_range');
  const routines = routineRoles.map(routine => ({
    ...routine,
    offset: hex(routine.offset),
    region: regionRef(findContainingRegion(mapData, routine.offset)),
  }));
  const ram = ramRoles.map(role => ({
    ...role,
    ram: ramRef(findRam(mapData, role.address)),
  }));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    summary: {
      modeCount: transitionCameraDeltaModes.length,
      physicalTriggerRecordCount: physical.length,
      expandedTriggerEdgeCount: expanded.length,
      sourceRecipeCount: sourceRecipeIds.size,
      destinationRecipeCount: destinationRecipeIds.size,
      adjustedAnchorComputableEdgeCount: adjustedComputable.length,
      adjustedAnchorExactEdgeCount: adjustedExact.length,
      adjustedAnchorRangeEdgeCount: adjustedRange.length,
      adjustedAnchorUncomputableEdgeCount: adjustedUncomputable.length,
      adjustedAnchorUncomputableReasons: histogram(adjustedUncomputable, record => record.adjustedCameraAnchor.reason),
      routineCount: routines.length,
      ramRoleCount: ram.length,
      opcodeRecordCounts: histogram(physical, record => record.rawOpcode),
      expandedOpcodeEdgeCounts: histogram(expanded, record => record.rawOpcode),
      adjustedClampCaseCounts: histogram(adjustedExact, record => record.adjustedCameraAnchor.clampCase),
      adjustedRangeClampCaseCounts: histogram(
        adjustedRange.flatMap(record => record.adjustedCameraAnchor.clampCases || []),
        clampCaseName => clampCaseName
      ),
      assetPolicy: 'Metadata only: trigger offsets, opcodes, descriptor ids, signed camera deltas, formulas, RAM labels, and evidence. No ROM bytes, decoded cells, graphics, music, text, or rendered assets are embedded.',
    },
    transitionCameraDeltaModes,
    runtimeModel: {
      triggerOpcodePath: '_LABEL_48A9_ stores the destination in _RAM_CFFA_; _DATA_48C5_ entries 22-25 reach _LABEL_4903_, which stores raw opcode B in _RAM_C26E_ before calling _LABEL_2620_.',
      deltaFormula: 'if (_RAM_C26E_ & 0x3F) is 0x16/0x17/0x18/0x19, _LABEL_2620_ adds 0x0100/0x0300/0xFF00/0xFD00 to _RAM_C243_ before _LABEL_FA1_; otherwise delta is 0.',
      preservedSubjectRangeFormula: 'For destination descriptors whose first byte is $FF, _LABEL_2620_ preserves trigger-time _RAM_C243_; _LABEL_4816_ proves that value is inside [record.xUnit*8, record.xUnit*8 + record.xSpanUnits*8 - 1].',
      adjustedCameraAnchorFormula: '_RAM_D00F_ = clamp((preserved_or_descriptor_seeded__RAM_C243_ + transitionDelta) - 0x0080, 0x0000, _RAM_D019_)',
      dispatchConclusion: '_DATA_4CAD_ entries 22-25 point at _LABEL_4CED_, so these opcodes affect camera seed offset while keeping the standard room-load routine path.',
    },
    routines,
    ram,
    physicalTriggerRecords: physical,
    expandedTriggerEdges: expanded,
    triggerSamples: expanded.slice(0, 24),
    evidence: [
      'ASM lines 11076-11112 show raw trigger opcode preservation into _RAM_C26E_ before _LABEL_2620_ for immediate room-load opcodes.',
      'ASM lines 10979-11024 show trigger X range acceptance against _RAM_C243_ before the raw opcode dispatch.',
      'ASM lines 11095-11099 show _DATA_48C5_ entries 22-25 target _LABEL_4903_.',
      'ASM lines 6366-6378 show descriptor byte 0 value $FF preserves the existing _RAM_C243_ instead of seeding it from the descriptor.',
      'ASM lines 6446-6470 implement the exact four-entry camera seed delta table from _RAM_C26E_ & $3F.',
      'ASM lines 11608-11613 show _DATA_4CAD_ entries $16-$19 all route to _LABEL_4CED_, the standard room-load path.',
      'The zone trigger-record catalog supplies trigger table offsets, source descriptors, destination descriptors, and opcode usage counts as metadata only.',
    ],
  };
}

function applyRecipeEnrichment(recipes, catalog) {
  const byDestinationRecipeId = new Map();
  for (const edge of catalog.expandedTriggerEdges) {
    if (!edge.destinationRecipeId) continue;
    const list = byDestinationRecipeId.get(edge.destinationRecipeId) || [];
    list.push(edge);
    byDestinationRecipeId.set(edge.destinationRecipeId, list);
  }

  for (const recipe of recipes) {
    const cameraScroll = recipe.dependencies?.cameraScroll;
    if (!cameraScroll) continue;
    cameraScroll.transitionAdjustment = cameraScroll.transitionAdjustment || {};
    cameraScroll.transitionAdjustment.modeTable = transitionCameraDeltaModes;
    cameraScroll.transitionAdjustment.exactSelector = {
      selectorRam: '_RAM_C26E_',
      selectorMask: '0x3F',
      defaultDeltaWord: '0x0000',
      evidenceCatalogId: catalogId,
    };
    const inbound = byDestinationRecipeId.get(recipe.id) || [];
    cameraScroll.transitionAdjustment.confirmedInboundTriggerAdjustments = inbound.map(edge => ({
      sourceRecipeId: edge.sourceRecipeId,
      sourceDescriptorId: edge.sourceDescriptorId,
      triggerTableId: edge.triggerTableId,
      triggerRecordOffset: edge.triggerRecordOffset,
      triggerGeometry: edge.triggerGeometry,
      rawOpcode: edge.rawOpcode,
      opcodeIndex: edge.opcodeIndex,
      deltaWord: edge.mode.deltaWord,
      signedDeltaPixels: edge.mode.signedDeltaPixels,
      adjustedCameraAnchor: edge.adjustedCameraAnchor,
    }));
    cameraScroll.transitionAdjustment.confirmedInboundTriggerAdjustmentCount = inbound.length;
  }
}

function annotateRegion(region, entry, kind) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.zoneTransitionCameraAdjustAudit = {
    catalogId,
    kind,
    role: entry.role,
    label: entry.label,
    confidence: entry.confidence,
    summary: entry.summary,
    evidence: entry.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
    role: entry.role,
    label: entry.label,
  };
}

function annotateRam(entry, role, catalog) {
  if (!entry) return null;
  entry.analysis = entry.analysis || {};
  entry.analysis.zoneTransitionCameraAdjustAudit = {
    catalogId,
    kind: role.role,
    confidence: 'high',
    runtimeModel: catalog.runtimeModel,
    opcodeRecordCounts: catalog.summary.opcodeRecordCounts,
    summary: 'RAM role participates in trigger-driven camera seed adjustment before _LABEL_FA1_ clamps the room scroll anchor.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || 'byte',
    name: entry.name || '',
    role: role.role,
  };
}

function annotateTriggerRegion(mapData, catalog) {
  const offsets = new Set(catalog.physicalTriggerRecords.map(record => parseInt(record.entryOffset, 16)));
  const byRegion = new Map();
  for (const offset of offsets) {
    const region = findContainingRegion(mapData, offset);
    if (!region) continue;
    const list = byRegion.get(region.id) || { region, offsets: [] };
    list.offsets.push(hex(offset));
    byRegion.set(region.id, list);
  }
  const annotated = [];
  for (const item of byRegion.values()) {
    item.region.analysis = item.region.analysis || {};
    item.region.analysis.zoneTransitionCameraAdjustTriggerRecords = {
      catalogId,
      kind: 'trigger_record_region_with_camera_delta_opcodes',
      confidence: 'high',
      triggerRecordOffsets: item.offsets,
      summary: 'Region contains room trigger records with opcodes $16-$19, which feed _RAM_C26E_ camera seed deltas before _LABEL_FA1_.',
      evidence: [
        'Trigger record catalog parsed these records as metadata-only 7-byte records.',
        'Zone transition camera adjust audit links their opcodes to _LABEL_2620_ camera seed deltas.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: item.region.id,
      offset: item.region.offset,
      size: item.region.size || 0,
      type: item.region.type || 'unknown',
      name: item.region.name || '',
      triggerRecordCount: item.offsets.length,
    });
  }
  return annotated;
}

function applyAnnotations(mapData, catalog) {
  const annotatedRegions = [];
  for (const routine of catalog.routines) {
    const region = routine.region?.id
      ? (mapData.regions || []).find(item => item.id === routine.region.id)
      : findContainingRegion(mapData, parseInt(routine.offset, 16));
    const annotated = annotateRegion(region, routine, 'transition_camera_adjust_routine_or_table');
    if (annotated) annotatedRegions.push(annotated);
  }
  const annotatedRam = [];
  for (const role of catalog.ram) {
    const entry = role.ram?.id ? (mapData.ram || []).find(item => item.id === role.ram.id) : findRam(mapData, role.address);
    const annotated = annotateRam(entry, role, catalog);
    if (annotated) annotatedRam.push(annotated);
  }
  const annotatedTriggerRegions = annotateTriggerRegion(mapData, catalog);
  return { annotatedRegions, annotatedRam, annotatedTriggerRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const recipes = mapData.zoneRecipes || [];
  if (!recipes.length) {
    console.error('Missing mapData.zoneRecipes. Run tools/world-zone-recipe-audit.mjs --apply first.');
    process.exit(1);
  }
  const sourceCatalogs = sourceCatalogRefs(mapData);
  const catalog = buildCatalog(mapData, recipes, sourceCatalogs);
  let changes = { annotatedRegions: [], annotatedRam: [], annotatedTriggerRegions: [] };

  if (apply) {
    applyRecipeEnrichment(recipes, catalog);
    changes = applyAnnotations(mapData, catalog);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_transition_camera_adjust_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegions: changes.annotatedRegions.length,
        annotatedRam: changes.annotatedRam.length,
        annotatedTriggerRegions: changes.annotatedTriggerRegions.length,
      },
      sourceCatalogs,
      runtimeModel: catalog.runtimeModel,
      transitionCameraDeltaModes,
      triggerSamples: catalog.triggerSamples,
      annotatedRegions: changes.annotatedRegions,
      annotatedRam: changes.annotatedRam,
      annotatedTriggerRegions: changes.annotatedTriggerRegions,
      evidence: catalog.evidence,
      nextLeads: [
        'Use confirmedInboundTriggerAdjustments in the analyzer to display adjusted camera anchors for door/trigger previews.',
        'Trace deferred _RAM_C26E_ opcodes through _LABEL_4C32_ for non-immediate room transitions and form-stage sequences.',
        'Cross-check adjusted camera anchors against _LABEL_EB3_ redraw column behavior in a locally decoded running scene.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: changes.annotatedRegions.length,
      annotatedRam: changes.annotatedRam.length,
      annotatedTriggerRegions: changes.annotatedTriggerRegions.length,
    },
    runtimeModel: catalog.runtimeModel,
    transitionCameraDeltaModes,
    triggerSamples: catalog.triggerSamples.slice(0, 8),
  }, null, 2));
}

main();
