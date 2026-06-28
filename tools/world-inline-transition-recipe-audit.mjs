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
const catalogId = 'world-inline-transition-recipe-catalog-2026-06-25';
const reportId = 'inline-transition-recipe-audit-2026-06-25';
const toolName = 'tools/world-inline-transition-recipe-audit.mjs';

const triggerDestinationCatalogId = 'world-zone-trigger-destination-role-catalog-2026-06-25';
const triggerRecordCatalogId = 'world-zone-trigger-record-catalog-2026-06-25';
const dc2CatalogId = 'world-dc2-scroll-map-catalog-2026-06-25';
const tilePairCatalogId = 'world-dc2-tile-pair-lookup-catalog-2026-06-25';
const audioRequestTaxonomyCatalogId = 'world-audio-request-taxonomy-catalog-2026-06-25';
const audioStreamGraphCatalogId = 'world-audio-stream-graph-catalog-2026-06-25';
const collisionBufferCatalogId = 'world-collision-buffer-provenance-catalog-2026-06-25';
const collisionBoundCatalogId = 'world-collision-bound-catalog-2026-06-25';
const spritePaletteInheritanceCatalogId = 'world-sprite-palette-inheritance-catalog-2026-06-25';
const extra998Loaders = {
  r0033: { regionId: 'r0033', label: '_DATA_275D_', romOffset: '0x0275D', condition: 'flags bit7 = 0' },
  r0034: { regionId: 'r0034', label: '_DATA_2762_', romOffset: '0x02762', condition: 'flags bit7 = 1 and bit6 = 0' },
};

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function hexByte(n) {
  return hex(n & 0xFF, 2);
}

function hexWord(n) {
  return hex(n & 0xFFFF, 4);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseOffset(value) {
  return typeof value === 'number' ? value : parseInt(String(value || '0').replace(/^0x/i, ''), 16);
}

function offsetOf(region) {
  return parseOffset(region.offset);
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

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function dc2EntryMap(dc2Catalog) {
  const byIndex = new Map();
  for (const entry of dc2Catalog?.entries || []) byIndex.set(entry.indexHex, entry);
  return byIndex;
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
      'The inline transition recipe audio request id comes from room subrecord byte +17 and is cached/passed to _LABEL_104B_ when changed.',
      'This compact reference stores offsets, counts, region ids, and opcode totals only; no stream bytes or decoded audio are embedded.',
    ],
  };
}

function triggerTableMap(triggerCatalog) {
  const byOffset = new Map();
  for (const table of triggerCatalog?.triggerTables || []) byOffset.set(table.romOffset, table);
  return byOffset;
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

function decodeVramLoader8fb(rom, offset) {
  const warnings = [];
  let pc = offset;
  let curVramTile = 0;
  let curBank = 8;
  let curBlockIdx = 0;
  let totalTiles = 0;
  let maxVramTile = 0;
  let terminated = false;
  let entries = 0;

  for (let entryIndex = 0; entryIndex < 256 && pc < rom.length; entryIndex++) {
    const entryOffset = pc;
    const count = rom[pc++];
    if (count === 0) {
      terminated = true;
      break;
    }
    if (pc + 3 >= rom.length) {
      warnings.push(`entry ${entryIndex} truncated at ${hex(entryOffset)}`);
      break;
    }
    const vramWord = rom[pc++] | (rom[pc++] << 8);
    const srcLo = rom[pc++];
    const srcHi = rom[pc++];
    const srcWord = srcLo | (srcHi << 8);
    if (vramWord !== 0xFFFF) curVramTile = vramWord;
    if (srcWord !== 0xFFFF) {
      curBank = srcHi >> 1;
      curBlockIdx = ((srcHi & 1) << 8) | srcLo;
    }
    const sourceStart = curBank * 0x4000 + curBlockIdx * 32;
    const sourceEnd = sourceStart + count * 32 - 1;
    if (count > 0x80) warnings.push(`entry ${entryIndex} unusually large tile count ${count}`);
    if (curVramTile + count > 0x200) warnings.push(`entry ${entryIndex} exceeds SMS tile slot range`);
    if (sourceEnd >= rom.length) warnings.push(`entry ${entryIndex} source exceeds ROM at ${hex(sourceStart)}-${hex(sourceEnd)}`);
    entries++;
    totalTiles += count;
    maxVramTile = Math.max(maxVramTile, curVramTile + count - 1);
    curVramTile += count;
    curBlockIdx += count;
  }

  return {
    valid: terminated && entries > 0 && warnings.length === 0,
    terminated,
    consumedBytes: pc - offset,
    entries,
    totalTiles,
    maxVramTile: hex(maxVramTile, 3),
    warnings,
  };
}

function parseTriggerTableMeta(rom, offset) {
  const warnings = [];
  let off = offset;
  let terminatorOffset = null;
  let recordCount = 0;
  for (let i = 0; i < 96 && off < rom.length; i++) {
    if (rom[off] === 0xFF) {
      terminatorOffset = off;
      break;
    }
    if (off + 6 >= rom.length) {
      warnings.push(`trigger record ${i} truncated at ${hex(off)}`);
      break;
    }
    recordCount++;
    off += 7;
  }
  if (terminatorOffset == null) warnings.push(`trigger table did not terminate within 96 records from ${hex(offset)}`);
  return {
    recordCount,
    terminatorOffset: terminatorOffset == null ? null : hex(terminatorOffset),
    warnings,
  };
}

function extra998Step(flagsValue) {
  if ((flagsValue & 0x80) === 0) {
    const loader = extra998Loaders.r0033;
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
  if ((flagsValue & 0x40) === 0) {
    const loader = extra998Loaders.r0034;
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
  return {
    kind: 'vram_loader_998',
    status: 'skipped',
    condition: 'flags bits7/6 = 1/1, extra 998 loader skipped',
    evidence: 'ASM lines 6486-6493 select _DATA_275D_, _DATA_2762_, or skip the extra _LABEL_998_ path from subrecord flags.',
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
    if (indexHex === '0xFF') return { slot, index: indexHex, disabled: true };
    const entry = dc2ByIndex.get(indexHex) || null;
    const streamOffset = entry ? parseOffset(entry.romOffset) : null;
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
    finalBoundWord: hexWord(finalWord),
    finalHighByte: hexByte(finalHigh),
    acceptedHighByteRange: activeCount > 0 ? `0x00-${hexByte(finalHigh)}` : 'none',
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
        start: hexByte(slot * 16),
        endInclusive: hexByte(slot * 16 + 15),
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
      'ASM lines 2888-2904 initialize _RAM_D019_ to $FF00 and increment by $0100 once per decoded DC2 stream before the first $FF terminator.',
      'ASM lines 2932-2967 decode each active DC2 stream into the _RAM_CB00_ collision/render buffer.',
      'Inline transition recipes use the same six DC2 indices consumed by _LABEL_26F4_ before _LABEL_DC2_.',
    ],
  };
}

function descriptorInitialWorldX(descriptor) {
  const raw = descriptor.scroll?.xRaw || null;
  if (!raw || parseOffset(raw) === 0xFF) {
    return {
      known: false,
      source: 'descriptor_scroll_x_keep_or_missing',
      raw: raw || '0xFF',
      pixels: null,
      word: null,
    };
  }
  const pixels = descriptor.scroll.xPixels ?? parseOffset(raw) * 8;
  return {
    known: true,
    source: 'inline descriptor byte 0 multiplied by 8 before storing _RAM_C243_',
    raw,
    pixels,
    word: hexWord(pixels),
  };
}

function clampCase(unclamped, maxBound) {
  if (unclamped < 0) return 'left_edge';
  if (unclamped > maxBound) return 'right_bound';
  return 'within_bound';
}

function nominalAnchor(initialWorldX, maxBound) {
  if (!initialWorldX.known) return null;
  const unclamped = initialWorldX.pixels - 0x80;
  const clamped = Math.max(0, Math.min(unclamped, maxBound));
  const targetColumn = (clamped + 7) >> 3;
  return {
    assumption: 'Inline transition opcode $0F does not match the $16-$19 _LABEL_2620_ camera-delta cases, so no transition delta is applied.',
    inputWorldX: initialWorldX.word,
    centerOffset: '0x0080',
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

function inlineCameraLoadPath(branchRole) {
  if (branchRole === 'bank2_transition_entry_room') {
    return {
      loaderPath: '_LABEL_B44F_ first room load',
      summary: '_LABEL_4E49_ can queue _RAM_CF6A_=2 with _RAM_C26C_ pointing at this first inline descriptor; _LABEL_B44F_ later calls _LABEL_2620_ on it, advances _RAM_C26C_ by six bytes, runs the bank-2 transition scene, then loads the second descriptor.',
      evidence: [
        'ASM lines 11771-11794 leave _RAM_C26C_ at the first descriptor and set _RAM_D1AE_/_RAM_D1AF_/_RAM_CF6A_ for staged transitions.',
        'ASM lines 20077-20085 show _LABEL_B44F_ calling _LABEL_2620_ from _RAM_C26C_ and then advancing _RAM_C26C_ by six bytes.',
      ],
    };
  }
  return {
    loaderPath: '_LABEL_4E49_ immediate followup or _LABEL_B44F_ second room load',
    summary: '_LABEL_4E49_ skips six bytes and immediately calls _LABEL_2620_ on this second inline descriptor when the stage selector is already satisfied; _LABEL_B44F_ also loads it after the bank-2 transition scene.',
    evidence: [
      'ASM lines 11796-11804 skip one six-byte descriptor and call _LABEL_2620_ from the second inline descriptor.',
      'ASM lines 20101-20108 show _LABEL_B44F_ calling _LABEL_2620_ from the advanced _RAM_C26C_ pointer after the transition scene.',
    ],
  };
}

function buildCameraScrollDependency(descriptor, collisionBuffer, branchRole, catalogRefs) {
  const maxBoundWord = collisionBuffer.finalBoundWord || null;
  const maxBound = maxBoundWord ? parseOffset(maxBoundWord) : null;
  const initialWorldX = descriptorInitialWorldX(descriptor);
  const nominal = maxBound == null ? null : nominalAnchor(initialWorldX, maxBound);
  const loadPath = inlineCameraLoadPath(branchRole);
  const warnings = [];
  if (!initialWorldX.known) warnings.push('Descriptor scroll X is keep/missing, so inline room-load _RAM_C243_ depends on prior state.');
  if (maxBound == null) warnings.push('Missing collision buffer bound; cannot compute _LABEL_FA1_ camera clamp.');

  return {
    kind: 'inline_transition_camera_scroll_anchor_from_room_recipe',
    catalogId,
    sourceCatalogIds: {
      dc2ScrollMap: catalogRefs.dc2CatalogId,
      collisionBound: catalogRefs.collisionBoundCatalogId,
      triggerDestination: catalogRefs.triggerDestinationCatalogId,
    },
    sourceDescriptorField: 'descriptor.scroll.x',
    roomLoadRoutine: '_LABEL_2620_',
    transitionBranchRoutine: branchRole === 'bank2_transition_entry_room' ? '_LABEL_B44F_' : '_LABEL_4E49_/_LABEL_B44F_',
    loadPath,
    selectorRam: '_RAM_C26E_',
    selectorOpcode: '0x0F',
    transitionDelta: {
      applies: false,
      reason: 'The _LABEL_2620_ local camera-delta helper only handles (_RAM_C26E_ & $3F) values $16-$19; form-stage inline transition opcode $0F falls below that range.',
      evidence: 'ASM lines 6446-6470 return before adding a camera delta for selector values below $16.',
    },
    inputRam: '_RAM_C243_',
    maxBoundRam: '_RAM_D019_',
    outputRam: {
      cameraAnchorWord: '_RAM_D00F_',
      cameraAnchorMirrorWord: '_RAM_D007_/_RAM_D008_',
      horizontalScrollShadow: '_RAM_CF8C_',
      redrawTargetColumn: '_RAM_D011_',
    },
    collisionBufferRef: {
      activeDc2PrefixCount: collisionBuffer.activeDc2PrefixCount,
      acceptedCellColumns: collisionBuffer.acceptedCellColumns,
      finalBoundWord: collisionBuffer.finalBoundWord,
      finalHighByte: collisionBuffer.finalHighByte,
    },
    descriptorInitialWorldX: initialWorldX,
    runtimeFormula: {
      cameraAnchor: '_RAM_D00F_ = clamp(_RAM_C243_ - 0x0080, 0x0000, _RAM_D019_)',
      horizontalScrollShadow: '_RAM_CF8C_ = low(_RAM_D00F_)',
      redrawTargetColumn: '_RAM_D011_ = (_RAM_D00F_ + 7) >> 3',
    },
    nominalInitialAnchor: nominal,
    warnings,
    confidence: warnings.length ? 'medium' : 'high',
    evidence: [
      ...loadPath.evidence,
      'ASM lines 6363-6378 seed _RAM_C243_ from descriptor byte 0 multiplied by 8 when the byte is not $FF.',
      'ASM lines 3162-3184 clamp _RAM_C243_ - $0080 against _RAM_D019_ and store _RAM_D00F_/_RAM_CF8C_.',
      'Inline transition recipe DC2 dependencies provide the active-prefix count used to derive _RAM_D019_.',
    ],
    assetPolicy: 'Metadata only: formulas, offsets, scalar descriptor values, RAM labels, branch roles, and evidence. No ROM bytes, decoded cells, graphics, music, text, or rendered assets are embedded.',
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
    inAudioRequestTable: Boolean(request),
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

function branchDescriptorRoles(recordRole) {
  return [
    { branch: 'first', branchRole: 'bank2_transition_entry_room', descriptor: recordRole.payload.firstInlineDescriptor },
    { branch: 'second', branchRole: 'immediate_followup_room', descriptor: recordRole.payload.secondInlineDescriptor },
  ];
}

function recipeIdFor(descriptorOffset) {
  return 'inline_transition_recipe_' + descriptorOffset.replace(/^0x/i, '').toUpperCase();
}

function buildInlineRecipe(rom, mapData, recordRole, branchInfo, dc2ByIndex, audioRequestsById, audioGraphsByRequestId, triggerTablesByOffset, catalogRefs) {
  const descriptor = branchInfo.descriptor;
  const descriptorOffset = parseOffset(descriptor.romOffset);
  const subrecordOffset = parseOffset(descriptor.subrecord.romOffset);
  const triggerTableOffset = parseOffset(descriptor.subrecord.triggerTableRomOffset);
  const loaderOffset = parseOffset(descriptor.subrecord.vramLoader8fbRomOffset);
  const flagsValue = parseOffset(descriptor.subrecord.flags);
  const loaderMeta = decodeVramLoader8fb(rom, loaderOffset);
  const triggerCatalogEntry = triggerTablesByOffset.get(descriptor.subrecord.triggerTableRomOffset) || null;
  const triggerMeta = parseTriggerTableMeta(rom, triggerTableOffset);
  const dc2Streams = buildDc2Steps(mapData, descriptor, dc2ByIndex);
  const collisionBuffer = buildCollisionBufferDependency(dc2Streams, catalogRefs);
  const cameraScroll = buildCameraScrollDependency(descriptor, collisionBuffer, branchInfo.branchRole, catalogRefs);
  const extra998 = extra998Step(flagsValue);
  const id = recipeIdFor(descriptor.romOffset);

  return {
    id,
    name: `Inline transition zone render recipe @ ${descriptor.romOffset}`,
    schemaVersion: 1,
    recipeType: 'inline_transition_room_zone_render',
    sourceGraphId: null,
    sourceDescriptorId: 'inline_transition_descriptor_' + descriptor.romOffset.replace(/^0x/i, '').toUpperCase(),
    sourceTriggerDestinationRoleCatalogId: triggerDestinationCatalogId,
    sourceTriggerRecord: {
      triggerTableId: recordRole.triggerTableId,
      triggerTableOffset: recordRole.triggerTableOffset,
      triggerRecordEntryOffset: recordRole.entryOffset,
      rawOpcode: recordRole.rawOpcode,
      opcodeIndex: recordRole.opcodeIndex,
      transitionRecordOffset: recordRole.payload.romOffset,
      stageSelector: recordRole.payload.stageSelector,
      stageSelectorHex: recordRole.payload.stageSelectorHex,
      branch: branchInfo.branch,
      branchRole: branchInfo.branchRole,
      sourceDescriptorSample: recordRole.sourceDescriptorSample || [],
    },
    confidence: descriptor.validShape && loaderMeta.valid && dc2Streams.every(stream => stream.disabled || stream.valid) ? 'high' : 'medium',
    bankContext: {
      descriptorBank: 4,
      dc2StreamBank: 5,
      tilePairLookupBank: 6,
      graphicsSourceBanks: 'resolved by _LABEL_8FB_/_LABEL_998_ loader records',
    },
    descriptor: {
      romOffset: descriptor.romOffset,
      z80Pointer: descriptor.z80Pointer,
      region: regionRef(findContainingRegion(mapData, descriptorOffset)),
      scroll: {
        x: { raw: descriptor.scroll.xRaw, pixels: descriptor.scroll.xPixels },
        y: { raw: descriptor.scroll.yRaw },
      },
      camera: {
        x: { raw: descriptor.camera.xRaw, pixels: parseOffset(descriptor.camera.xRaw) * 8 },
        y: { raw: descriptor.camera.yRaw },
      },
      inZoneGraph: false,
    },
    subrecord: {
      z80Pointer: descriptor.subrecord.z80Pointer,
      romOffset: descriptor.subrecord.romOffset,
      region: regionRef(findContainingRegion(mapData, subrecordOffset)),
      flags: descriptor.subrecord.flags,
      paletteIndex: descriptor.subrecord.paletteIndex,
      bgPaletteIndex: descriptor.subrecord.paletteIndex,
    },
    dependencies: {
      vramLoader8fb: {
        kind: 'vram_loader_8fb',
        z80Pointer: descriptor.subrecord.vramLoader8fbZ80,
        romOffset: descriptor.subrecord.vramLoader8fbRomOffset,
        region: regionRef(findExactRegion(mapData, loaderOffset) || findContainingRegion(mapData, loaderOffset)),
        valid: loaderMeta.valid,
        entries: loaderMeta.entries,
        totalTiles: loaderMeta.totalTiles,
        maxVramTile: loaderMeta.maxVramTile,
        consumedBytes: loaderMeta.consumedBytes,
        warningCount: loaderMeta.warnings.length,
        warnings: loaderMeta.warnings,
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
        index: descriptor.subrecord.paletteIndex,
        source: 'room subrecord byte +16 masked to 6 bits by _LABEL_26F4_ before _LABEL_8B2_',
        spritePalette: {
          status: 'preserve_existing',
          indexSentinel: '0xFF',
          source: 'Inline transition descriptors are consumed by _LABEL_2620_ and then _LABEL_26F4_; _LABEL_26F4_ loads H=$FF before _LABEL_8B2_, so the existing sprite palette is preserved.',
          inheritance: spritePaletteInheritanceRef(),
          evidence: [
            'ASM lines 11771-11804 and 20077-20108 route inline transition descriptors through _LABEL_2620_.',
            'ASM lines 6495-6502: _LABEL_26F4_ masks the room subrecord flags/palette byte with $3F into L, sets H=$FF, then calls _LABEL_8B2_.',
            'ASM lines 2154-2164: _LABEL_8B2_ only updates _RAM_CFF6_ when H is not $FF.',
          ],
        },
      },
      audioRequest: buildAudioRequestDependency(descriptor, audioRequestsById, audioGraphsByRequestId),
      doorTable: {
        z80Pointer: descriptor.subrecord.triggerTableZ80,
        romOffset: descriptor.subrecord.triggerTableRomOffset,
        region: regionRef(findContainingRegion(mapData, triggerTableOffset)),
        entryCount: triggerCatalogEntry?.recordCount ?? triggerMeta.recordCount,
        terminatorOffset: triggerCatalogEntry?.terminatorOffset ?? triggerMeta.terminatorOffset,
        catalogId: triggerCatalogEntry ? triggerRecordCatalogId : null,
        triggerTableId: triggerCatalogEntry?.id || null,
        warningCount: triggerMeta.warnings.length,
        warnings: triggerMeta.warnings,
      },
      triggerTable: {
        kind: 'room_trigger_table',
        catalogId: triggerCatalogEntry ? triggerRecordCatalogId : null,
        triggerTableId: triggerCatalogEntry?.id || null,
        romOffset: descriptor.subrecord.triggerTableRomOffset,
        recordFormat: 'room_trigger_record_7_bytes_ff_terminated',
        recordCount: triggerCatalogEntry?.recordCount ?? triggerMeta.recordCount,
        terminatorOffset: triggerCatalogEntry?.terminatorOffset ?? triggerMeta.terminatorOffset,
        source: triggerCatalogEntry ? 'world-zone-trigger-record-catalog-2026-06-25' : 'parsed directly from inline descriptor subrecord pointer',
      },
    },
    renderPipeline: [
      { order: 0, kind: 'vram_loader_8fb', source: 'inline descriptor subrecord +8/+9 pointer', dependency: 'dependencies.vramLoader8fb' },
      { order: 1, kind: 'vram_loader_998', source: 'inline descriptor subrecord flags', dependency: 'dependencies.extra998' },
      { order: 2, kind: 'bg_palette', source: 'inline descriptor subrecord palette byte', dependency: 'dependencies.palette' },
      { order: 3, kind: 'dc2_scroll_map', source: '_LABEL_DC2_ using _DATA_14000_', dependency: 'dependencies.dc2Streams' },
      { order: 4, kind: 'collision_buffer_model', source: '_LABEL_DC2_ active DC2 prefix and _RAM_D019_/_RAM_D01A_ bound', dependency: 'dependencies.collisionBuffer' },
      { order: 5, kind: 'camera_scroll_anchor', source: '_LABEL_FA1_ clamps _RAM_C243_ against _RAM_D019_ and seeds _RAM_D00F_/_RAM_CF8C_', dependency: 'dependencies.cameraScroll' },
      { order: 6, kind: 'tile_pair_lookup', source: '_LABEL_EF3_ using _DATA_18000_', dependency: 'dependencies.tilePairLookup' },
      { order: 7, kind: 'name_table_render', source: '_LABEL_EF3_ writes SMS name-table words to VRAM', output: 'synthetic SMS VRAM name table' },
      { order: 8, kind: 'audio_request', source: '_LABEL_26F4_ room subrecord audio byte', dependency: 'dependencies.audioRequest' },
    ],
    catalogRefs,
    evidence: [
      'world-zone-trigger-destination-role-catalog-2026-06-25 classifies this payload as a form-stage transition record consumed by _LABEL_4E49_.',
      '_LABEL_4E49_ leaves _RAM_C26C_ at the first inline descriptor for bank-2 staged transitions or skips six bytes and calls _LABEL_2620_ from the second inline descriptor.',
      '_LABEL_B44F_ consumes the first inline descriptor through _LABEL_2620_, advances _RAM_C26C_ by six bytes, runs the transition scene, then consumes the second inline descriptor through _LABEL_2620_.',
      '_LABEL_2620_ consumes the same six-byte descriptor shape for inline transition descriptors as for graph descriptors.',
      '_LABEL_FA1_ and _LABEL_EB3_ use the same camera clamp and redraw-column path after inline descriptor loads as after regular zone descriptor loads.',
      '_LABEL_26F4_ consumes the selected subrecord: VRAM loader 8FB, DC2 streams, optional 998 loader, palette index, and audio request byte.',
      '_LABEL_26F4_ passes H=$FF to _LABEL_8B2_ for these inline loads, so inline transition recipes update BG palette and preserve the existing sprite palette.',
    ],
    assetPolicy: 'Metadata only: offsets, labels, region ids, counts, flags, palette index, audio request id, and catalog references. No ROM bytes, decoded maps, tile words, graphics, or rendered assets are embedded.',
  };
}

function collectStagedRecordRoles(destinationCatalog) {
  return (destinationCatalog?.recordRoles || [])
    .filter(role => role.role === 'form_stage_transition_record' && role.payload?.validShape)
    .sort((a, b) => parseOffset(a.payload.romOffset) - parseOffset(b.payload.romOffset));
}

function buildCatalog(mapData, recipes, stagedRecords, catalogRefs) {
  const uniqueSubrecords = new Set();
  const uniqueTriggerTables = new Set();
  const unique8fb = new Set();
  const uniqueDc2 = new Set();
  const paletteCounts = new Map();
  const audioRequestCounts = new Map();
  const extra998Counts = { required_r0033: 0, required_r0034: 0, skipped: 0 };
  const nominalCameraClampCases = new Map();
  let audioRequestTaxonomyResolvedDescriptors = 0;
  let audioRequestTaxonomyMissingDescriptors = 0;
  let audioStreamGraphResolvedDescriptors = 0;
  let audioStreamGraphMissingDescriptors = 0;
  let spritePalettePreservedCount = 0;
  let collisionBufferReadyRecipeCount = 0;
  let cameraScrollReadyRecipeCount = 0;
  let cameraScrollWarningRecipeCount = 0;

  for (const recipe of recipes) {
    if (recipe.subrecord.romOffset) uniqueSubrecords.add(recipe.subrecord.romOffset);
    if (recipe.dependencies.triggerTable.romOffset) uniqueTriggerTables.add(recipe.dependencies.triggerTable.romOffset);
    if (recipe.dependencies.vramLoader8fb.romOffset) unique8fb.add(recipe.dependencies.vramLoader8fb.romOffset);
    for (const stream of recipe.dependencies.dc2Streams) if (!stream.disabled && stream.index) uniqueDc2.add(stream.index);
    paletteCounts.set(recipe.dependencies.palette.index, (paletteCounts.get(recipe.dependencies.palette.index) || 0) + 1);
    const requestId = recipe.dependencies.audioRequest.requestId;
    if (requestId != null) audioRequestCounts.set(requestId, (audioRequestCounts.get(requestId) || 0) + 1);
    if (recipe.dependencies.audioRequest.taxonomyResolved) audioRequestTaxonomyResolvedDescriptors++;
    else audioRequestTaxonomyMissingDescriptors++;
    if (recipe.dependencies.audioRequest.streamGraphResolved) audioStreamGraphResolvedDescriptors++;
    else audioStreamGraphMissingDescriptors++;
    if (recipe.dependencies.palette.spritePalette?.status === 'preserve_existing') spritePalettePreservedCount++;
    if (recipe.dependencies.collisionBuffer?.confidence === 'high') collisionBufferReadyRecipeCount++;
    if (recipe.dependencies.cameraScroll?.confidence === 'high') cameraScrollReadyRecipeCount++;
    if ((recipe.dependencies.cameraScroll?.warnings || []).length) cameraScrollWarningRecipeCount++;
    const clampCaseName = recipe.dependencies.cameraScroll?.nominalInitialAnchor?.clampCase || 'unknown_prior_state';
    nominalCameraClampCases.set(clampCaseName, (nominalCameraClampCases.get(clampCaseName) || 0) + 1);
    const extra = recipe.dependencies.extra998;
    if (extra.status === 'skipped') extra998Counts.skipped++;
    else if (extra.regionId === 'r0033') extra998Counts.required_r0033++;
    else if (extra.regionId === 'r0034') extra998Counts.required_r0034++;
  }

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(catalogRefs).filter(Boolean),
    catalogRefs,
    summary: {
      recipeCount: recipes.length,
      stagedTransitionRecordCount: stagedRecords.length,
      validRecipeCount: recipes.filter(recipe => recipe.confidence === 'high').length,
      uniqueSubrecordCount: uniqueSubrecords.size,
      uniqueTriggerTableCount: uniqueTriggerTables.size,
      uniqueVramLoader8fbCount: unique8fb.size,
      uniqueDc2IndexCount: uniqueDc2.size,
      paletteIndexCount: paletteCounts.size,
      spritePalettePreservedCount,
      audioRequestIdCount: audioRequestCounts.size,
      audioRequestTaxonomyResolvedDescriptors,
      audioRequestTaxonomyMissingDescriptors,
      audioStreamGraphResolvedDescriptors,
      audioStreamGraphMissingDescriptors,
      collisionBufferReadyRecipeCount,
      cameraScrollReadyRecipeCount,
      cameraScrollWarningRecipeCount,
      nominalCameraClampCaseCounts: Object.fromEntries([...nominalCameraClampCases.entries()]
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
      extra998Counts,
      assetPolicy: 'Metadata only: inline transition recipe dependencies, offsets, catalog IDs, region IDs, counts, flags, and audio request ids. No ROM bytes, decoded rooms, graphics, audio, or rendered assets are embedded.',
    },
    paletteUsage: [...paletteCounts.entries()].sort((a, b) => a[0] - b[0]).map(([index, descriptorCount]) => ({ index, descriptorCount })),
    audioRequestUsage: [...audioRequestCounts.entries()].sort((a, b) => a[0] - b[0]).map(([requestId, descriptorCount]) => ({
      requestId,
      requestIdHex: hex(requestId, 2),
      descriptorCount,
      streamGraphResolved: recipes.some(recipe =>
        recipe.dependencies.audioRequest.requestId === requestId &&
        recipe.dependencies.audioRequest.streamGraphResolved
      ),
      streamGraphId: recipes.find(recipe =>
        recipe.dependencies.audioRequest.requestId === requestId &&
        recipe.dependencies.audioRequest.streamGraph
      )?.dependencies.audioRequest.streamGraph.graphId || null,
    })),
    stagedTransitionRecords: stagedRecords.map(record => ({
      triggerTableId: record.triggerTableId,
      triggerTableOffset: record.triggerTableOffset,
      triggerRecordEntryOffset: record.entryOffset,
      transitionRecordOffset: record.payload.romOffset,
      stageSelector: record.payload.stageSelector,
      stageSelectorHex: record.payload.stageSelectorHex,
      sourceDescriptorCount: record.sourceDescriptorCount,
      firstRecipeId: recipeIdFor(record.payload.firstInlineDescriptor.romOffset),
      secondRecipeId: recipeIdFor(record.payload.secondInlineDescriptor.romOffset),
    })),
    recipeSamples: recipes.slice(0, 24).map(recipe => ({
      id: recipe.id,
      branch: recipe.sourceTriggerRecord.branch,
      branchRole: recipe.sourceTriggerRecord.branchRole,
      descriptorOffset: recipe.descriptor.romOffset,
      subrecordOffset: recipe.subrecord.romOffset,
      triggerTableOffset: recipe.dependencies.triggerTable.romOffset,
      vramLoader8fbOffset: recipe.dependencies.vramLoader8fb.romOffset,
      dc2Indices: recipe.dependencies.dc2Streams.map(stream => stream.index),
      paletteIndex: recipe.dependencies.palette.index,
      spritePaletteStatus: recipe.dependencies.palette.spritePalette?.status || null,
      audioRequestIdHex: recipe.dependencies.audioRequest.requestIdHex,
      audioStreamGraphId: recipe.dependencies.audioRequest.streamGraph?.graphId || null,
      activeDc2PrefixCount: recipe.dependencies.collisionBuffer.activeDc2PrefixCount,
      cameraAnchor: recipe.dependencies.cameraScroll.nominalInitialAnchor,
    })),
    evidence: [
      'The source trigger destination catalog identifies six form-stage transition records with two inline room descriptors each.',
      '_LABEL_4E49_ and _LABEL_B44F_ consume these inline descriptors through the same _LABEL_2620_ room-loader path as regular zone graph descriptors.',
      'Each inline descriptor subrecord was checked for a bank-4 trigger table pointer, bank-4 8FB loader pointer, six DC2 indices, palette byte, and audio request byte.',
      'Inline transition recipes now reuse the regular room _LABEL_DC2_ collision-bound model and _LABEL_FA1_ camera clamp model as metadata-only dependencies.',
      'Inline transition recipes now record the same _LABEL_26F4_ H=$FF sprite-palette preservation contract as regular room-zone recipes.',
      'When present, audio stream graph refs are copied from world-audio-stream-graph-catalog-2026-06-25 as compact metadata-only references.',
    ],
  };
}

function annotateRegions(mapData, catalog, recipes) {
  const byRegion = new Map();
  for (const recipe of recipes) {
    for (const [role, ref] of [
      ['inline_descriptor', recipe.descriptor.region],
      ['inline_subrecord', recipe.subrecord.region],
      ['inline_vram_loader_8fb', recipe.dependencies.vramLoader8fb.region],
      ['inline_trigger_table', recipe.dependencies.triggerTable.romOffset ? regionRef(findContainingRegion(mapData, parseOffset(recipe.dependencies.triggerTable.romOffset))) : null],
    ]) {
      if (!ref?.id) continue;
      const item = byRegion.get(ref.id) || { region: ref, roleCounts: {}, recipeIds: new Set() };
      item.roleCounts[role] = (item.roleCounts[role] || 0) + 1;
      item.recipeIds.add(recipe.id);
      byRegion.set(ref.id, item);
    }
  }

  const annotated = [];
  for (const item of byRegion.values()) {
    const region = (mapData.regions || []).find(candidate => candidate.id === item.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.inlineTransitionRecipeAudit = {
      catalogId,
      kind: 'inline_transition_recipe_participant',
      confidence: 'high',
      summary: 'Region participates in staged transition inline room recipes consumed by _LABEL_4E49_/_LABEL_B44F_.',
      roleCounts: item.roleCounts,
      recipeCount: item.recipeIds.size,
      sampleRecipeIds: [...item.recipeIds].slice(0, 16),
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      roleCounts: item.roleCounts,
      recipeCount: item.recipeIds.size,
    });
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const destinationCatalog = findCatalog(mapData, triggerDestinationCatalogId);
  if (!destinationCatalog) throw new Error(`Missing ${triggerDestinationCatalogId}`);
  const triggerCatalog = findCatalog(mapData, triggerRecordCatalogId);
  const dc2Catalog = findCatalog(mapData, dc2CatalogId);
  const audioCatalog = findCatalog(mapData, audioRequestTaxonomyCatalogId);
  const audioStreamGraphCatalog = findCatalog(mapData, audioStreamGraphCatalogId);
  const catalogRefs = {
    triggerDestinationCatalogId,
    triggerRecordCatalogId: triggerCatalog ? triggerRecordCatalogId : null,
    dc2CatalogId: dc2Catalog ? dc2CatalogId : null,
    tilePairCatalogId: findCatalog(mapData, tilePairCatalogId) ? tilePairCatalogId : null,
    audioRequestTaxonomyCatalogId: audioCatalog ? audioRequestTaxonomyCatalogId : null,
    audioStreamGraphCatalogId: audioStreamGraphCatalog ? audioStreamGraphCatalogId : null,
    collisionBufferCatalogId: findCatalog(mapData, collisionBufferCatalogId) ? collisionBufferCatalogId : null,
    collisionBoundCatalogId: findCatalog(mapData, collisionBoundCatalogId) ? collisionBoundCatalogId : null,
    spritePaletteInheritanceCatalogId,
  };
  const dc2ByIndex = dc2EntryMap(dc2Catalog);
  const audioRequestsById = audioRequestMap(audioCatalog);
  const audioGraphsByRequestId = audioStreamGraphCatalog ? audioGraphMap(audioStreamGraphCatalog) : null;
  const triggerTablesByOffset = triggerTableMap(triggerCatalog);
  const stagedRecords = collectStagedRecordRoles(destinationCatalog);
  const recipes = [];
  for (const record of stagedRecords) {
    for (const branchInfo of branchDescriptorRoles(record)) {
      recipes.push(buildInlineRecipe(rom, mapData, record, branchInfo, dc2ByIndex, audioRequestsById, audioGraphsByRequestId, triggerTablesByOffset, catalogRefs));
    }
  }
  const catalog = buildCatalog(mapData, recipes, stagedRecords, catalogRefs);
  let annotatedRegions = [];

  if (apply) {
    annotatedRegions = annotateRegions(mapData, catalog, recipes);
    mapData.inlineTransitionRecipes = recipes;
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'inline_transition_recipe_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      catalogRefs,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      paletteUsage: catalog.paletteUsage,
      audioRequestUsage: catalog.audioRequestUsage,
      stagedTransitionRecords: catalog.stagedTransitionRecords,
      recipeSamples: catalog.recipeSamples,
      annotatedRegions,
      evidence: catalog.evidence,
      nextLeads: [
        'Run render-provenance simulation for inlineTransitionRecipes and compare unresolved slots with regular zoneRecipes.',
        'Teach the scene renderer to include inline transition recipes in automated smoke tests for _LABEL_4E49_ branches.',
        'Trace bank-2 _RAM_D1AE_ transition branches to connect each stageSelector value to its visual effect sequence.',
      ],
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
    firstRecipes: recipes.slice(0, 6).map(recipe => ({
      id: recipe.id,
      branch: recipe.sourceTriggerRecord.branch,
      descriptorOffset: recipe.descriptor.romOffset,
      subrecordOffset: recipe.subrecord.romOffset,
      triggerTableOffset: recipe.dependencies.triggerTable.romOffset,
      vramLoader8fbOffset: recipe.dependencies.vramLoader8fb.romOffset,
      dc2Indices: recipe.dependencies.dc2Streams.map(stream => stream.index),
      paletteIndex: recipe.dependencies.palette.index,
      spritePaletteStatus: recipe.dependencies.palette.spritePalette?.status || null,
      audioRequestIdHex: recipe.dependencies.audioRequest.requestIdHex,
      audioStreamGraphId: recipe.dependencies.audioRequest.streamGraph?.graphId || null,
      confidence: recipe.confidence,
    })),
    annotatedRegions,
  }, null, 2));
}

main();
