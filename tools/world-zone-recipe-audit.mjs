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
const catalogId = 'world-zone-recipe-catalog-2026-06-25';
const reportId = 'zone-recipe-audit-2026-06-25';
const toolName = 'tools/world-zone-recipe-audit.mjs';

const zoneGraphId = 'world-zone-graph-2026-06-24';
const dc2CatalogId = 'world-dc2-scroll-map-catalog-2026-06-25';
const tilePairCatalogId = 'world-dc2-tile-pair-lookup-catalog-2026-06-25';
const tileSourceCatalogId = 'world-tile-source-catalog-2026-06-24';
const graphicsCoverageCatalogId = 'world-graphics-coverage-catalog-2026-06-24';
const audioRequestTaxonomyCatalogId = 'world-audio-request-taxonomy-catalog-2026-06-25';
const audioStreamGraphCatalogId = 'world-audio-stream-graph-catalog-2026-06-25';
const collisionBufferCatalogId = 'world-collision-buffer-provenance-catalog-2026-06-25';
const collisionBoundCatalogId = 'world-collision-bound-catalog-2026-06-25';
const zoneCameraScrollCatalogId = 'world-zone-camera-scroll-catalog-2026-06-25';
const spritePaletteInheritanceCatalogId = 'world-sprite-palette-inheritance-catalog-2026-06-25';
const extra998Loaders = {
  r0033: { regionId: 'r0033', label: '_DATA_275D_', romOffset: '0x0275D', condition: 'flags bit7 = 0' },
  r0034: { regionId: 'r0034', label: '_DATA_2762_', romOffset: '0x02762', condition: 'flags bit7 = 1 and bit6 = 0' },
};
const transitionCameraDeltaModes = [
  { opcodeIndex: 0x16, rawOpcode: '0x16', deltaWord: '0x0100', signedDeltaPixels: 0x0100, transitionTableTarget: '_LABEL_4CED_', meaning: 'positive one-page camera seed adjustment before _LABEL_FA1_' },
  { opcodeIndex: 0x17, rawOpcode: '0x17', deltaWord: '0x0300', signedDeltaPixels: 0x0300, transitionTableTarget: '_LABEL_4CED_', meaning: 'positive three-page camera seed adjustment before _LABEL_FA1_' },
  { opcodeIndex: 0x18, rawOpcode: '0x18', deltaWord: '0xFF00', signedDeltaPixels: -0x0100, transitionTableTarget: '_LABEL_4CED_', meaning: 'negative one-page camera seed adjustment before _LABEL_FA1_' },
  { opcodeIndex: 0x19, rawOpcode: '0x19', deltaWord: '0xFD00', signedDeltaPixels: -0x0300, transitionTableTarget: '_LABEL_4CED_', meaning: 'negative three-page camera seed adjustment before _LABEL_FA1_' },
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

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function catalogById(mapData, id) {
  for (const key of [
    'roomDataCatalogs',
    'tileSourceCatalogs',
    'graphicsCatalogs',
    'vdpStreamCatalogs',
    'screenProgCatalogs',
    'paletteCatalogs',
    'audioRequestTaxonomyCatalogs',
    'audioCatalogs',
    'collisionBufferCatalogs',
  ]) {
    const found = (mapData[key] || []).find(item => item.id === id);
    if (found) return found;
  }
  return null;
}

function normalizeRecipeId(descriptorOffset) {
  return 'zone_recipe_' + descriptorOffset.replace(/^0x/i, '').toUpperCase();
}

function dc2EntryMap(dc2Catalog) {
  const byIndex = new Map();
  for (const entry of dc2Catalog?.entries || []) {
    byIndex.set(entry.indexHex, entry);
  }
  return byIndex;
}

function extra998Step(descriptor) {
  const extra = descriptor.extra998 || {};
  if (!extra.regionId) {
    return {
      kind: 'vram_loader_998',
      status: 'skipped',
      condition: extra.condition || 'flags bits7/6 = 1/1, extra 998 loader skipped',
      evidence: 'ASM lines 6486-6493 select _DATA_275D_, _DATA_2762_, or skip the extra _LABEL_998_ path from subrecord flags.',
    };
  }
  const loader = extra998Loaders[extra.regionId] || {
    regionId: extra.regionId,
    label: extra.sourceLabel || '',
    romOffset: null,
    condition: extra.condition || '',
  };
  return {
    kind: 'vram_loader_998',
    status: 'required',
    regionId: loader.regionId,
    sourceLabel: loader.label,
    romOffset: loader.romOffset,
    condition: loader.condition,
    evidence: 'ASM lines 6486-6493 select this extra _LABEL_998_ loader from subrecord flags.',
  };
}

function spritePaletteInheritanceRef() {
  return {
    catalogId: spritePaletteInheritanceCatalogId,
    model: 'preserved_runtime_sprite_palette_state',
    stateRam: '_RAM_CFF6_',
    ownerStatus: 'runtime_prior_state',
    loaderRoutine: '_LABEL_8B2_',
    preservingRoutine: '_LABEL_26F4_',
    evidenceRef: spritePaletteInheritanceCatalogId,
  };
}

function buildDc2Steps(mapData, descriptor, dc2ByIndex) {
  return (descriptor.subrecord.dc2Indices || []).map((indexHex, slot) => {
    if (indexHex === '0xFF') {
      return {
        slot,
        index: indexHex,
        disabled: true,
      };
    }
    const entry = dc2ByIndex.get(indexHex) || null;
    const streamOffset = entry ? parseInt(entry.romOffset, 16) : null;
    return {
      slot,
      index: indexHex,
      disabled: false,
      tableEntryOffset: entry?.tableEntryOffset || null,
      z80Pointer: entry?.z80Pointer || null,
      romOffset: entry?.romOffset || null,
      region: streamOffset == null ? null : regionRef(findExactRegion(mapData, streamOffset) || findContainingRegion(mapData, streamOffset)),
      runtimeConsumedBytes: entry?.runtimeConsumedBytes ?? null,
      writtenCells: entry?.writtenCells ?? null,
      rows: entry?.rows ?? null,
      columns: entry?.columns ?? null,
      valid: entry?.valid ?? null,
    };
  });
}

function isDc2Terminator(stream) {
  return (stream?.index || '').toUpperCase() === '0XFF' || stream?.disabled === true;
}

function activeDc2PrefixCount(streams) {
  let count = 0;
  for (const stream of streams) {
    if (isDc2Terminator(stream)) break;
    count++;
  }
  return count;
}

function dc2BoundForActiveCount(activeCount) {
  const finalWord = (0xFF00 + activeCount * 0x0100) & 0xFFFF;
  const finalHigh = (finalWord >> 8) & 0xFF;
  return {
    finalBoundWord: hex(finalWord, 4),
    finalHighByte: hex(finalHigh, 2),
    acceptedHighByteRange: activeCount > 0 ? `0x00-${hex(finalHigh, 2)}` : 'none',
    acceptedCellColumns: activeCount * 16,
    decodedWrittenCells: activeCount * 11 * 16,
  };
}

function collisionSlotCoverage(streams, activeCount) {
  return streams.map((stream, slot) => {
    const decoded = slot < activeCount;
    const terminator = slot === activeCount && isDc2Terminator(stream);
    const trailing = slot > activeCount && isDc2Terminator(stream);
    let role = 'decoded_stream';
    if (terminator) role = 'terminator_unprocessed';
    else if (trailing) role = 'trailing_unprocessed';
    else if (!decoded) role = 'unexpected_non_ff_after_terminator';

    return {
      slot,
      role,
      index: stream?.index || null,
      decoded,
      source: decoded ? {
        tableEntryOffset: stream.tableEntryOffset || null,
        z80Pointer: stream.z80Pointer || null,
        romOffset: stream.romOffset || null,
        region: stream.region || null,
        runtimeConsumedBytes: stream.runtimeConsumedBytes ?? null,
        writtenCells: stream.writtenCells ?? null,
        valid: stream.valid ?? null,
      } : null,
      columnRange: {
        start: hex(slot * 16, 2),
        endInclusive: hex(slot * 16 + 15, 2),
        count: 16,
      },
      rowCount: decoded ? 11 : 0,
      writtenCells: decoded ? 11 * 16 : 0,
    };
  });
}

function buildCollisionBufferDependency(dc2Streams, catalogRefs) {
  const activeCount = activeDc2PrefixCount(dc2Streams);
  const bound = dc2BoundForActiveCount(activeCount);
  const warnings = [];
  if (dc2Streams.length !== 6) warnings.push(`Expected 6 DC2 stream slots, found ${dc2Streams.length}.`);
  if (dc2Streams.slice(activeCount + 1).some(stream => !isDc2Terminator(stream))) {
    warnings.push('Found non-$FF DC2 indexes after the first terminator; _LABEL_DC2_ would not decode those slots.');
  }

  return {
    kind: 'dc2_collision_render_buffer_recipe',
    sourceDc2Dependency: 'dependencies.dc2Streams',
    sourceCatalogIds: {
      dc2ScrollMap: catalogRefs.dc2CatalogId,
      collisionBuffer: catalogRefs.collisionBufferCatalogId,
      collisionBound: catalogRefs.collisionBoundCatalogId,
    },
    producer: '_LABEL_DC2_',
    visualConsumer: '_LABEL_EF3_',
    collisionConsumer: '_LABEL_141F_',
    baseRam: '_RAM_CB00_',
    baseAddress: '$CB00',
    maxFootprint: { start: '$CB00', endInclusive: '$CF1F', sizeBytes: 0x420 },
    rowCount: 11,
    maxStreamSlotCount: 6,
    activeDc2PrefixCount: activeCount,
    terminatorIndex: '0xFF',
    terminatorSlot: activeCount < dc2Streams.length ? activeCount : null,
    cellsPerStreamRow: 16,
    maxCellsPerRow: 96,
    activeCellsPerRow: bound.acceptedCellColumns,
    rowStrideBytes: '0x60',
    ...bound,
    boundRam: {
      wordAlias: '_RAM_D019_',
      highByte: '_RAM_D01A_',
      formula: 'finalHighByte = activeDc2PrefixCount - 1; acceptedCellColumns = activeDc2PrefixCount * 16',
    },
    slotCoverage: collisionSlotCoverage(dc2Streams, activeCount),
    warnings,
    confidence: warnings.length ? 'medium' : 'high',
    evidence: [
      'ASM lines 2882-2886 copy six room-subrecord DC2 bytes before _LABEL_DC2_ begins decoding.',
      'ASM lines 2896-2899 compare each DC2 index with $FF and exit the decode loop on the first terminator.',
      'ASM lines 2899-2904 increment the _RAM_D019_ word only for decoded non-$FF streams.',
      'ASM lines 2915-2921 decode the selected stream into the current _RAM_CB00_ slot and advance the slot base by $10.',
      'ASM lines 3060-3096 and 3868-3894 show _RAM_CB00_ consumed by visual rendering and collision lookup with a $60 row stride.',
    ],
  };
}

function descriptorInitialWorldX(descriptor) {
  const scrollX = descriptor.scroll?.x || null;
  if (!scrollX || scrollX.keep) {
    return {
      known: false,
      source: 'descriptor_scroll_x_keep_or_missing',
      raw: scrollX?.raw || '0xFF',
      pixels: null,
      word: null,
    };
  }
  const raw = scrollX.raw || null;
  const pixels = scrollX.pixels ?? (raw ? parseInt(raw, 16) * 8 : null);
  return {
    known: pixels != null,
    source: 'descriptor byte 0 multiplied by 8 before storing _RAM_C243_',
    raw,
    pixels,
    word: pixels == null ? null : hex(pixels & 0xFFFF, 4),
  };
}

function nominalCameraAnchor(initialWorldX, maxBound) {
  if (!initialWorldX.known || maxBound == null) return null;
  const unclamped = initialWorldX.pixels - 0x80;
  const clamped = Math.max(0, Math.min(unclamped, maxBound));
  let clampCase = 'within_bound';
  if (unclamped < 0) clampCase = 'left_edge';
  else if (unclamped > maxBound) clampCase = 'right_bound';
  const targetColumn = (clamped + 7) >> 3;
  return {
    assumption: 'No transition adjustment from ASM lines 6446-6470 has been applied.',
    inputWorldX: initialWorldX.word,
    centerOffset: '0x0080',
    unclampedSignedPixels: unclamped,
    unclampedWordIfNonNegative: unclamped < 0 ? null : hex(unclamped & 0xFFFF, 4),
    clampCase,
    scrollAnchorWord: hex(clamped & 0xFFFF, 4),
    scrollAnchorPixels: clamped,
    scrollShadowLowByte: hex(clamped & 0xFF, 2),
    redrawTargetColumn: targetColumn,
    redrawTargetColumnHex: hex(targetColumn & 0xFF, 2),
  };
}

function buildCameraScrollDependency(descriptor, collisionBuffer, catalogRefs) {
  const initialWorldX = descriptorInitialWorldX(descriptor);
  const maxBound = collisionBuffer?.finalBoundWord ? parseInt(collisionBuffer.finalBoundWord, 16) : null;
  const warnings = [];
  if (!collisionBuffer) warnings.push('Missing dependencies.collisionBuffer; cannot bind camera clamp to recipe-specific _RAM_D019_ max.');
  if (!initialWorldX.known) warnings.push('Descriptor scroll X is keep/missing, so the room-load initial _RAM_C243_ value depends on prior state.');
  return {
    kind: 'camera_scroll_anchor_from_room_recipe',
    sourceCatalogIds: {
      zoneCameraScroll: catalogRefs.zoneCameraScrollCatalogId,
      collisionBuffer: catalogRefs.collisionBufferCatalogId,
      collisionBound: catalogRefs.collisionBoundCatalogId,
    },
    sourceDescriptorField: 'descriptor.scroll.x',
    clampRoutine: '_LABEL_FA1_',
    roomLoadRoutine: '_LABEL_2620_',
    scrollRedrawRoutine: '_LABEL_EB3_',
    vdpScrollUpdateRoutine: '_LABEL_1D1_',
    inputRam: '_RAM_C243_',
    maxBoundRam: '_RAM_D019_',
    outputRam: {
      cameraAnchorWord: '_RAM_D00F_',
      cameraAnchorMirrorWord: '_RAM_D007_/_RAM_D008_',
      horizontalScrollShadow: '_RAM_CF8C_',
      redrawTargetColumn: '_RAM_D011_',
      redrawCurrentColumn: '_RAM_D012_',
      renderColumnIndex: '_RAM_D013_',
      scrollUpdateRequest: '_RAM_CFE1_',
    },
    collisionBufferRef: collisionBuffer ? {
      activeDc2PrefixCount: collisionBuffer.activeDc2PrefixCount,
      acceptedCellColumns: collisionBuffer.acceptedCellColumns,
      finalBoundWord: collisionBuffer.finalBoundWord,
      finalHighByte: collisionBuffer.finalHighByte,
    } : null,
    descriptorInitialWorldX: initialWorldX,
    transitionAdjustment: {
      possible: true,
      selectorRam: '_RAM_C26E_',
      selectorMask: '0x3F',
      defaultDeltaWord: '0x0000',
      modeTable: transitionCameraDeltaModes,
      summary: '_LABEL_2620_ local helper adjusts _RAM_C243_ only when (_RAM_C26E_ & $3F) is $16, $17, $18, or $19; all four modes continue through the standard _LABEL_4CED_ room-load path.',
      evidence: [
        'ASM lines 6446-6470 compare (_RAM_C26E_ & $3F) with $16/$18/$1A and add $0100, $0300, $FF00, or $FD00 to _RAM_C243_ for values $16-$19.',
        'ASM lines 11608-11613 show _DATA_4CAD_ dispatch is indexed from _RAM_C26E_ after masking/decrementing; entries $16-$19 target the standard room-load path _LABEL_4CED_.',
      ],
    },
    runtimeFormula: {
      cameraAnchor: '_RAM_D00F_ = clamp(_RAM_C243_ - 0x0080, 0x0000, _RAM_D019_)',
      horizontalScrollShadow: '_RAM_CF8C_ = low(_RAM_D00F_)',
      redrawTargetColumn: '_RAM_D011_ = (_RAM_D00F_ + 7) >> 3',
    },
    nominalInitialAnchor: nominalCameraAnchor(initialWorldX, maxBound),
    warnings,
    confidence: collisionBuffer ? 'high' : 'medium',
    evidence: [
      'ASM lines 6363-6378 seed _RAM_C243_ from descriptor byte 0 multiplied by 8 when the byte is not $FF.',
      'ASM lines 6421-6428 load room assets, apply transition adjustment, clear actors, call _LABEL_FA1_, then call _LABEL_E83_.',
      'ASM lines 3162-3184 implement the _RAM_C243_ - $0080 clamp against _RAM_D019_ and store _RAM_D00F_/_RAM_D007_/_RAM_CF8C_.',
      'ASM lines 3023-3058 derive redraw columns from _RAM_D00F_ and call _LABEL_EF3_.',
    ],
  };
}

function audioRequestMap(audioCatalog) {
  const byId = new Map();
  for (const request of audioCatalog?.requests || []) byId.set(request.requestId, request);
  return byId;
}

function audioGraphMap(audioGraphCatalog) {
  const byId = new Map();
  for (const graph of audioGraphCatalog?.graphs || []) byId.set(graph.requestId, graph);
  return byId;
}

function compactAudioRegionRef(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function compactAudioGraphChannel(channel) {
  if (!channel) return null;
  return {
    channelIndex: channel.channelIndex,
    channelIdHex: channel.channelIdHex,
    priorityHex: channel.priorityHex,
    rootStreamOffset: channel.rootStreamOffset,
    rootStreamRegion: compactAudioRegionRef(channel.rootStreamRegion),
    reachableStreamCount: channel.reachableStreamCount,
    branchEdgeCount: channel.branchEdgeCount,
    maxBranchDepth: channel.maxBranchDepth,
    missingTargetCount: channel.missingTargetCount,
  };
}

function compactAudioStreamGraph(graph) {
  if (!graph) return null;
  return {
    kind: 'audio_stream_graph_ref',
    catalogId: audioStreamGraphCatalogId,
    graphId: graph.id,
    requestId: graph.requestId,
    requestIdHex: graph.requestIdHex,
    headerOffset: graph.headerOffset,
    headerRegion: compactAudioRegionRef(graph.headerRegion),
    classification: graph.classification || null,
    channelCount: graph.channelCount,
    rootChannels: (graph.rootChannels || []).map(compactAudioGraphChannel).filter(Boolean),
    reachableStreamCount: graph.reachableStreamCount,
    reachableStreamOffsetSample: (graph.reachableStreamOffsets || []).slice(0, 16),
    streamRegionCount: graph.streamRegionCount,
    streamRegionIds: graph.streamRegionIds || [],
    branchEdgeCount: graph.branchEdgeCount,
    immediatePointerCallEdgeCount: graph.immediatePointerCallEdgeCount,
    jumpPointerEdgeCount: graph.jumpPointerEdgeCount,
    maxBranchDepth: graph.maxBranchDepth,
    missingTargetCount: graph.missingTargetCount,
    opcodeTotals: graph.opcodeTotals || {},
    endReasonCounts: graph.endReasonCounts || {},
    confidence: graph.missingTargetCount ? 'medium' : 'high',
    evidence: [
      `${audioStreamGraphCatalogId} derives this request graph from channel stream roots and $F6/$FA pointer edges.`,
      'The recipe audio request id comes from room subrecord byte +17 and is cached/passed to _LABEL_104B_ when changed.',
      'This compact reference stores offsets, counts, region ids, and opcode totals only; no stream bytes or decoded audio are embedded.',
    ],
  };
}

function compactAudioRequestRef(request) {
  if (!request) return null;
  return {
    catalogId: audioRequestTaxonomyCatalogId,
    requestId: request.requestId,
    requestIdHex: request.requestIdHex,
    tableEntryOffset: request.tableEntryOffset,
    headerOffset: request.headerOffset,
    headerRegion: request.headerRegion || null,
    channelCount: request.channelCount,
    channelIds: request.channelIds,
    priorityValues: request.priorityValues,
    uniqueStreamCount: request.uniqueStreamCount,
    classification: request.classification,
    immediateCallSiteCount: request.immediateCallSiteCount,
    candidateCallSiteCount: request.candidateCallSiteCount,
  };
}

function buildAudioRequestDependency(descriptor, audioRequestsById, audioGraphsByRequestId) {
  const requestId = descriptor.subrecord.audioRequestId ?? null;
  const request = requestId == null ? null : audioRequestsById.get(requestId) || null;
  const graph = requestId == null ? null : audioGraphsByRequestId?.get(requestId) || null;
  const dependency = {
    kind: 'room_audio_request',
    requestId,
    requestIdHex: descriptor.subrecord.audioRequestIdHex || null,
    inAudioRequestTable: descriptor.subrecord.audioRequestInTable ?? null,
    taxonomy: compactAudioRequestRef(request),
    taxonomyResolved: Boolean(request),
    source: 'room subrecord byte +17 compared with _RAM_CFF9_ and passed to _LABEL_104B_ when changed',
  };
  if (audioGraphsByRequestId) {
    dependency.streamGraph = compactAudioStreamGraph(graph);
    dependency.streamGraphResolved = Boolean(graph);
    dependency.streamGraphSourceCatalogId = audioStreamGraphCatalogId;
  }
  return dependency;
}

function buildRecipe(mapData, descriptor, dc2ByIndex, audioRequestsById, audioGraphsByRequestId, catalogRefs) {
  const descriptorOffset = parseInt(descriptor.descriptorOffset, 16);
  const subrecordOffset = parseInt(descriptor.subrecord.romOffset, 16);
  const doorTableOffset = parseInt(descriptor.subrecord.doorTableRomOffset, 16);
  const loaderOffset = parseInt(descriptor.subrecord.vramLoader8fbRomOffset, 16);
  const descriptorRegion = regionRef(findContainingRegion(mapData, descriptorOffset));
  const subrecordRegion = regionRef(findContainingRegion(mapData, subrecordOffset));
  const doorTableRegion = regionRef(findContainingRegion(mapData, doorTableOffset));
  const loaderRegion = regionRef(findExactRegion(mapData, loaderOffset) || findContainingRegion(mapData, loaderOffset));
  const dc2Streams = buildDc2Steps(mapData, descriptor, dc2ByIndex);
  const extra998 = extra998Step(descriptor);
  const collisionBuffer = buildCollisionBufferDependency(dc2Streams, catalogRefs);
  const cameraScroll = buildCameraScrollDependency(descriptor, collisionBuffer, catalogRefs);

  return {
    id: normalizeRecipeId(descriptor.descriptorOffset),
    name: `Zone render recipe @ ${descriptor.descriptorOffset}`,
    schemaVersion: 1,
    recipeType: 'room_zone_render',
    sourceGraphId: zoneGraphId,
    sourceDescriptorId: descriptor.id,
    confidence: descriptor.valid ? 'high' : 'low',
    bankContext: {
      descriptorBank: 4,
      dc2StreamBank: 5,
      tilePairLookupBank: 6,
      graphicsSourceBanks: 'resolved by _LABEL_8FB_/_LABEL_998_ loader records',
    },
    descriptor: {
      romOffset: descriptor.descriptorOffset,
      region: descriptorRegion,
      scroll: descriptor.scroll,
      camera: descriptor.camera,
    },
    subrecord: {
      z80Pointer: descriptor.subrecord.z80Pointer,
      romOffset: descriptor.subrecord.romOffset,
      region: subrecordRegion,
      flags: descriptor.subrecord.flags,
      paletteIndex: descriptor.subrecord.paletteIndex,
      bgPaletteIndex: descriptor.subrecord.bgPaletteIndex,
    },
    dependencies: {
      vramLoader8fb: {
        kind: 'vram_loader_8fb',
        z80Pointer: descriptor.subrecord.vramLoader8fbZ80,
        romOffset: descriptor.subrecord.vramLoader8fbRomOffset,
        region: loaderRegion,
        valid: descriptor.vramLoader8fb?.valid ?? null,
        entries: descriptor.vramLoader8fb?.entries ?? null,
        totalTiles: descriptor.vramLoader8fb?.totalTiles ?? null,
        maxVramTile: descriptor.vramLoader8fb?.maxVramTile ?? null,
      },
      extra998,
      dc2Streams,
      collisionBuffer,
      cameraScroll,
      tilePairLookup: {
        catalogId: tilePairCatalogId,
        label: '_DATA_18000_',
        offset: '0x18000',
        endInclusive: '0x18717',
        recordStride: 8,
        recordCount: 227,
      },
      palette: {
        kind: 'bg_palette_index',
        index: descriptor.subrecord.bgPaletteIndex,
        source: 'room subrecord byte +16 masked to 6 bits by _LABEL_26F4_ before _LABEL_8B2_',
        spritePalette: {
          status: 'preserve_existing',
          indexSentinel: '0xFF',
          source: '_LABEL_26F4_ loads H=$FF before calling _LABEL_8B2_; _LABEL_8B2_ treats $FF as keep existing.',
          inheritance: spritePaletteInheritanceRef(),
          evidence: [
            'ASM lines 6495-6502: _LABEL_26F4_ masks the room subrecord flags/palette byte with $3F into L, sets H=$FF, then calls _LABEL_8B2_.',
            'ASM lines 2154-2164: _LABEL_8B2_ only updates _RAM_CFF6_ when H is not $FF.',
          ],
        },
      },
      audioRequest: buildAudioRequestDependency(descriptor, audioRequestsById, audioGraphsByRequestId),
      doorTable: {
        z80Pointer: descriptor.subrecord.doorTableZ80,
        romOffset: descriptor.subrecord.doorTableRomOffset,
        region: doorTableRegion,
        entryCount: descriptor.doorTable?.entryCount ?? null,
        terminatorOffset: descriptor.doorTable?.terminatorOffset ?? null,
      },
    },
    renderPipeline: [
      { order: 0, kind: 'vram_loader_8fb', source: 'room subrecord +8/+9 pointer', dependency: 'dependencies.vramLoader8fb' },
      { order: 1, kind: 'vram_loader_998', source: 'room subrecord flags', dependency: 'dependencies.extra998' },
      { order: 2, kind: 'bg_palette', source: 'room subrecord palette byte', dependency: 'dependencies.palette' },
      { order: 3, kind: 'dc2_scroll_map', source: '_LABEL_DC2_ using _DATA_14000_', dependency: 'dependencies.dc2Streams' },
      { order: 4, kind: 'collision_buffer_model', source: '_LABEL_DC2_ active DC2 prefix and _RAM_D019_/_RAM_D01A_ bound', dependency: 'dependencies.collisionBuffer' },
      { order: 5, kind: 'camera_scroll_anchor', source: '_LABEL_FA1_ clamps _RAM_C243_ against _RAM_D019_ and seeds _RAM_D00F_/_RAM_CF8C_', dependency: 'dependencies.cameraScroll' },
      { order: 6, kind: 'tile_pair_lookup', source: '_LABEL_EF3_ using _DATA_18000_', dependency: 'dependencies.tilePairLookup' },
      { order: 7, kind: 'name_table_render', source: '_LABEL_EF3_ writes SMS name-table words to VRAM', output: 'synthetic SMS VRAM name table' },
      { order: 8, kind: 'audio_request', source: '_LABEL_26F4_ room subrecord audio byte', dependency: 'dependencies.audioRequest' },
    ],
    catalogRefs,
    evidence: [
      'Zone graph world-zone-graph-2026-06-24 validates this descriptor, its subrecord, door table, 8FB loader, DC2 indices, and palette byte.',
      'ASM lines 6363-6444: _LABEL_2620_ consumes the six-byte descriptor and calls _LABEL_26F4_ with the selected subrecord.',
      'ASM lines 6472-6502: _LABEL_26F4_ calls the subrecord-selected _LABEL_8FB_, _LABEL_DC2_, optional _LABEL_998_, and _LABEL_8B2_ palette path.',
      'ASM lines 6495-6502: _LABEL_26F4_ masks the room subrecord flags/palette byte into L and sets H=$FF before _LABEL_8B2_, so room-zone recipes update BG palette and preserve the existing sprite palette.',
      'ASM lines 6503-6520: _LABEL_26F4_ reads subrecord byte +17 as the room audio request, caches it in _RAM_CFF9_, and calls _LABEL_104B_ when changed.',
      'Audio request taxonomy world-audio-request-taxonomy-catalog-2026-06-25 links the room audio byte to _DATA_D139_ request headers and stream-shape classifications.',
      'DC2 and tile-pair lookup catalogs validate _DATA_14000_ and _DATA_18000_ metadata for room name-table reconstruction.',
      'Collision buffer dependency records _LABEL_DC2_ first-$FF terminator semantics and the resulting _RAM_D019_/_RAM_D01A_ bound for each recipe.',
      'Camera scroll dependency records _LABEL_2620_ descriptor seeding, transition adjustment uncertainty, and _LABEL_FA1_/_LABEL_EB3_ scroll-anchor formulas.',
    ],
    assetPolicy: 'Metadata only: offsets, labels, region ids, counts, flags, palette index, and catalog references. No ROM bytes, decoded maps, tile words, graphics, or rendered assets are embedded.',
  };
}

function buildCatalog(mapData, recipes, catalogRefs) {
  const extra998Counts = { required_r0033: 0, required_r0034: 0, skipped: 0 };
  const paletteCounts = new Map();
  const unique8fb = new Set();
  const uniqueSubrecords = new Set();
  const uniqueDoorTables = new Set();
  const uniqueDc2 = new Set();
  const audioRequestCounts = new Map();
  const activeDc2PrefixCounts = new Map();
  const nominalCameraClampCases = new Map();
  let audioRequestTaxonomyResolvedDescriptors = 0;
  let audioRequestTaxonomyMissingDescriptors = 0;
  let audioStreamGraphResolvedDescriptors = 0;
  let audioStreamGraphMissingDescriptors = 0;
  let collisionReadyRecipeCount = 0;
  let collisionWarningRecipeCount = 0;
  let cameraScrollReadyRecipeCount = 0;
  let cameraScrollWarningRecipeCount = 0;
  let cameraScrollDescriptorSetCount = 0;
  let cameraScrollDescriptorKeepCount = 0;
  let spritePalettePreservedCount = 0;
  for (const recipe of recipes) {
    const extra = recipe.dependencies.extra998;
    if (extra.status === 'skipped') extra998Counts.skipped++;
    else if (extra.regionId === 'r0033') extra998Counts.required_r0033++;
    else if (extra.regionId === 'r0034') extra998Counts.required_r0034++;
    paletteCounts.set(recipe.dependencies.palette.index, (paletteCounts.get(recipe.dependencies.palette.index) || 0) + 1);
    if (recipe.dependencies.palette.spritePalette?.status === 'preserve_existing') spritePalettePreservedCount++;
    if (recipe.dependencies.vramLoader8fb.romOffset) unique8fb.add(recipe.dependencies.vramLoader8fb.romOffset);
    if (recipe.subrecord.romOffset) uniqueSubrecords.add(recipe.subrecord.romOffset);
    if (recipe.dependencies.doorTable.romOffset) uniqueDoorTables.add(recipe.dependencies.doorTable.romOffset);
    for (const stream of recipe.dependencies.dc2Streams) if (!stream.disabled && stream.index) uniqueDc2.add(stream.index);
    const collisionBuffer = recipe.dependencies.collisionBuffer;
    if (collisionBuffer) {
      activeDc2PrefixCounts.set(
        collisionBuffer.activeDc2PrefixCount,
        (activeDc2PrefixCounts.get(collisionBuffer.activeDc2PrefixCount) || 0) + 1
      );
      if ((collisionBuffer.warnings || []).length) collisionWarningRecipeCount++;
      else collisionReadyRecipeCount++;
    }
    const cameraScroll = recipe.dependencies.cameraScroll;
    if (cameraScroll) {
      if ((cameraScroll.warnings || []).length) cameraScrollWarningRecipeCount++;
      else cameraScrollReadyRecipeCount++;
      if (cameraScroll.descriptorInitialWorldX?.known) cameraScrollDescriptorSetCount++;
      else cameraScrollDescriptorKeepCount++;
      const clampCase = cameraScroll.nominalInitialAnchor?.clampCase || 'unknown_prior_state';
      nominalCameraClampCases.set(clampCase, (nominalCameraClampCases.get(clampCase) || 0) + 1);
    }
    const audioRequestId = recipe.dependencies.audioRequest.requestId;
    if (audioRequestId != null) audioRequestCounts.set(audioRequestId, (audioRequestCounts.get(audioRequestId) || 0) + 1);
    if (recipe.dependencies.audioRequest.taxonomyResolved) audioRequestTaxonomyResolvedDescriptors++;
    else audioRequestTaxonomyMissingDescriptors++;
    if (recipe.dependencies.audioRequest.streamGraphResolved) audioStreamGraphResolvedDescriptors++;
    else audioStreamGraphMissingDescriptors++;
  }

  const graph = (mapData.zoneGraphs || []).find(item => item.id === zoneGraphId) || null;
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceGraphId: zoneGraphId,
    catalogRefs,
    summary: {
      recipeCount: recipes.length,
      sourceDescriptorCount: graph?.summary?.descriptorCount ?? null,
      validRecipeCount: recipes.filter(recipe => recipe.confidence === 'high').length,
      uniqueSubrecordCount: uniqueSubrecords.size,
      uniqueDoorTableCount: uniqueDoorTables.size,
      uniqueVramLoader8fbCount: unique8fb.size,
      uniqueDc2IndexCount: uniqueDc2.size,
      paletteIndexCount: paletteCounts.size,
      spritePalettePreservedCount,
      audioRequestIdCount: audioRequestCounts.size,
      audioRequestTaxonomyResolvedDescriptors,
      audioRequestTaxonomyMissingDescriptors,
      audioStreamGraphResolvedDescriptors,
      audioStreamGraphMissingDescriptors,
      collisionReadyRecipeCount,
      collisionWarningRecipeCount,
      activeDc2PrefixHistogram: Object.fromEntries([...activeDc2PrefixCounts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([key, value]) => [String(key), value])),
      cameraScrollReadyRecipeCount,
      cameraScrollWarningRecipeCount,
      cameraScrollDescriptorSetCount,
      cameraScrollDescriptorKeepCount,
      nominalCameraClampCaseCounts: Object.fromEntries([...nominalCameraClampCases.entries()]
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([key, value]) => [String(key), value])),
      extra998Counts,
      assetPolicy: 'Metadata only: recipe dependencies, offsets, catalog IDs, region IDs, counts, flags, audio request ids, and evidence. No ROM bytes, decoded rooms, graphics, audio, or rendered assets are embedded.',
    },
    collisionWidthUsage: [...activeDc2PrefixCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([activeDc2PrefixCount, descriptorCount]) => ({
        activeDc2PrefixCount,
        descriptorCount,
        acceptedCellColumns: activeDc2PrefixCount * 16,
        finalHighByte: hex(activeDc2PrefixCount - 1, 2),
      })),
    paletteUsage: [...paletteCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, count]) => ({ index, descriptorCount: count })),
    audioRequestUsage: [...audioRequestCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([requestId, descriptorCount]) => {
        const sample = recipes.find(recipe => recipe.dependencies.audioRequest.requestId === requestId);
        const taxonomy = sample?.dependencies.audioRequest.taxonomy || null;
        return {
          requestId,
          requestIdHex: hex(requestId, 2),
          descriptorCount,
          taxonomyResolved: Boolean(taxonomy),
          classification: taxonomy?.classification || null,
          headerOffset: taxonomy?.headerOffset || null,
          channelCount: taxonomy?.channelCount ?? null,
          uniqueStreamCount: taxonomy?.uniqueStreamCount ?? null,
          streamGraphResolved: Boolean(sample?.dependencies.audioRequest.streamGraphResolved),
          streamGraphId: sample?.dependencies.audioRequest.streamGraph?.graphId || null,
          reachableStreamCount: sample?.dependencies.audioRequest.streamGraph?.reachableStreamCount ?? null,
        };
      }),
    recipeSamples: recipes.slice(0, 20).map(recipe => ({
      id: recipe.id,
      descriptorOffset: recipe.descriptor.romOffset,
      subrecordOffset: recipe.subrecord.romOffset,
      vramLoader8fbOffset: recipe.dependencies.vramLoader8fb.romOffset,
      extra998: recipe.dependencies.extra998.status === 'required' ? recipe.dependencies.extra998.regionId : 'skipped',
      dc2Indices: recipe.dependencies.dc2Streams.map(stream => stream.index),
      activeDc2PrefixCount: recipe.dependencies.collisionBuffer?.activeDc2PrefixCount ?? null,
      acceptedCellColumns: recipe.dependencies.collisionBuffer?.acceptedCellColumns ?? null,
      collisionFinalHighByte: recipe.dependencies.collisionBuffer?.finalHighByte ?? null,
      cameraScrollDescriptorX: recipe.dependencies.cameraScroll?.descriptorInitialWorldX ?? null,
      nominalCameraAnchor: recipe.dependencies.cameraScroll?.nominalInitialAnchor ?? null,
      paletteIndex: recipe.dependencies.palette.index,
      spritePaletteStatus: recipe.dependencies.palette.spritePalette?.status || null,
      audioRequestId: recipe.dependencies.audioRequest.requestId,
      audioRequestIdHex: recipe.dependencies.audioRequest.requestIdHex,
      audioRequestClassification: recipe.dependencies.audioRequest.taxonomy?.classification?.kind || null,
      audioStreamGraphId: recipe.dependencies.audioRequest.streamGraph?.graphId || null,
      doorTableOffset: recipe.dependencies.doorTable.romOffset,
    })),
    evidence: [
      'Recipes are generated from validated zone graph descriptors instead of rendered output or asset bytes.',
      'The referenced DC2 scroll-map and tile-pair lookup catalogs decode structure and bounds as metadata only.',
      'Room audio request ids are cross-linked to the audio request taxonomy by request id, preserving only metadata and classifications.',
      'When present, audio stream graph refs are copied from world-audio-stream-graph-catalog-2026-06-25 as compact metadata-only references.',
      'The recipe model is intended as reusable simulator/engine input: loaders, palette index, DC2 streams, tile-pair lookup, name-table render contract, and room audio request id.',
    ],
  };
}

function annotateEntryRegions(mapData, catalog) {
  const annotated = [];
  const entryOffsets = new Set(catalog.recipeSamples.map(sample => sample.descriptorOffset));
  for (const offsetText of entryOffsets) {
    const region = findContainingRegion(mapData, parseInt(offsetText, 16));
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.zoneRecipeAudit = {
      catalogId,
      kind: 'zone_recipe_descriptor_source',
      confidence: 'high',
      summary: 'This room descriptor is now represented as reusable metadata-only zone recipe input.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push(regionRef(region));
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const graph = (mapData.zoneGraphs || []).find(item => item.id === zoneGraphId);
  if (!graph) {
    console.error(`Missing zone graph ${zoneGraphId}`);
    process.exit(1);
  }

  const dc2Catalog = catalogById(mapData, dc2CatalogId);
  const tilePairCatalog = catalogById(mapData, tilePairCatalogId);
  const audioTaxonomyCatalog = catalogById(mapData, audioRequestTaxonomyCatalogId);
  const audioStreamGraphCatalog = catalogById(mapData, audioStreamGraphCatalogId);
  const collisionBufferCatalog = catalogById(mapData, collisionBufferCatalogId);
  const collisionBoundCatalog = catalogById(mapData, collisionBoundCatalogId);
  const zoneCameraScrollCatalog = catalogById(mapData, zoneCameraScrollCatalogId);
  const catalogRefs = {
    zoneGraphId,
    dc2CatalogId,
    tilePairCatalogId,
    tileSourceCatalogId: catalogById(mapData, tileSourceCatalogId) ? tileSourceCatalogId : null,
    graphicsCoverageCatalogId: catalogById(mapData, graphicsCoverageCatalogId) ? graphicsCoverageCatalogId : null,
    audioRequestTaxonomyCatalogId: audioTaxonomyCatalog ? audioRequestTaxonomyCatalogId : null,
    audioStreamGraphCatalogId: audioStreamGraphCatalog ? audioStreamGraphCatalogId : null,
    collisionBufferCatalogId: collisionBufferCatalog ? collisionBufferCatalogId : null,
    collisionBoundCatalogId: collisionBoundCatalog ? collisionBoundCatalogId : null,
      zoneCameraScrollCatalogId: zoneCameraScrollCatalog ? zoneCameraScrollCatalogId : null,
      spritePaletteInheritanceCatalogId,
    };
  const dc2ByIndex = dc2EntryMap(dc2Catalog);
  const audioRequestsById = audioRequestMap(audioTaxonomyCatalog);
  const audioGraphsByRequestId = audioStreamGraphCatalog ? audioGraphMap(audioStreamGraphCatalog) : null;
  const recipes = (graph.descriptors || []).map(descriptor =>
    buildRecipe(mapData, descriptor, dc2ByIndex, audioRequestsById, audioGraphsByRequestId, catalogRefs)
  );
  const catalog = buildCatalog(mapData, recipes, catalogRefs);
  const annotatedEntryRegions = apply ? annotateEntryRegions(mapData, catalog) : [];

  if (apply) {
    mapData.zoneRecipes = recipes;
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_recipe_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        dc2CatalogPresent: Boolean(dc2Catalog),
        tilePairCatalogPresent: Boolean(tilePairCatalog),
        audioRequestTaxonomyCatalogPresent: Boolean(audioTaxonomyCatalog),
        audioStreamGraphCatalogPresent: Boolean(audioStreamGraphCatalog),
        collisionBufferCatalogPresent: Boolean(collisionBufferCatalog),
        collisionBoundCatalogPresent: Boolean(collisionBoundCatalog),
        zoneCameraScrollCatalogPresent: Boolean(zoneCameraScrollCatalog),
        annotatedEntryRegions: annotatedEntryRegions.length,
      },
      catalogRefs,
      recipeSamples: catalog.recipeSamples,
      paletteUsage: catalog.paletteUsage,
      audioRequestUsage: catalog.audioRequestUsage,
      collisionWidthUsage: catalog.collisionWidthUsage,
      annotatedEntryRegions,
      evidence: catalog.evidence,
      nextLeads: [
        'Teach the analyzer zone browser to load zoneRecipes directly from map metadata and show recipe dependency diagnostics.',
        'Use zoneRecipes to smoke-test reproducible rendering for a sample of descriptors, checking VRAM tile provenance and unresolved slots.',
        'Trace which recipe audio requests correspond to confirmed rooms/transitions before assigning user-facing music or SFX names.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    catalogRefs,
    collisionWidthUsage: catalog.collisionWidthUsage,
    firstRecipes: recipes.slice(0, 5).map(recipe => ({
      id: recipe.id,
      descriptorOffset: recipe.descriptor.romOffset,
      subrecordOffset: recipe.subrecord.romOffset,
      vramLoader8fbOffset: recipe.dependencies.vramLoader8fb.romOffset,
      extra998: recipe.dependencies.extra998.status === 'required' ? recipe.dependencies.extra998.regionId : 'skipped',
      dc2Indices: recipe.dependencies.dc2Streams.map(stream => stream.index),
      paletteIndex: recipe.dependencies.palette.index,
      spritePaletteStatus: recipe.dependencies.palette.spritePalette?.status || null,
      audioRequestId: recipe.dependencies.audioRequest.requestId,
      audioRequestIdHex: recipe.dependencies.audioRequest.requestIdHex,
      audioRequestClassification: recipe.dependencies.audioRequest.taxonomy?.classification?.kind || null,
      audioStreamGraphId: recipe.dependencies.audioRequest.streamGraph?.graphId || null,
      activeDc2PrefixCount: recipe.dependencies.collisionBuffer?.activeDc2PrefixCount ?? null,
      acceptedCellColumns: recipe.dependencies.collisionBuffer?.acceptedCellColumns ?? null,
      collisionFinalHighByte: recipe.dependencies.collisionBuffer?.finalHighByte ?? null,
      cameraScrollDescriptorX: recipe.dependencies.cameraScroll?.descriptorInitialWorldX ?? null,
      nominalCameraAnchor: recipe.dependencies.cameraScroll?.nominalInitialAnchor ?? null,
      doorTableOffset: recipe.dependencies.doorTable.romOffset,
    })),
    annotatedEntryRegions: annotatedEntryRegions.length,
  }, null, 2));
}

main();
