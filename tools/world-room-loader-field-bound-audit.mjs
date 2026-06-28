#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const toolName = 'tools/world-room-loader-field-bound-audit.mjs';
const catalogId = 'world-room-loader-field-bound-catalog-2026-06-25';
const reportId = 'room-loader-field-bound-audit-2026-06-25';

const routine = {
  label: '_LABEL_26F4_',
  offset: 0x026F4,
  regionId: 'r2091',
};

const sourceFields = {
  overlayIndexOffset: 6,
  flagsPaletteOffset: 16,
  audioRequestOffset: 17,
};

const structuralSubrecords = {
  start: 0x1072C,
  stride: 18,
  count: 76,
};

const formWrapperPointerTable = {
  label: '_DATA_BDB1_',
  offset: 0x0BDB1,
  entryCount: 6,
};

const extra998Loaders = {
  r0033: {
    regionId: 'r0033',
    label: '_DATA_275D_',
    romOffset: '0x0275D',
    selection: 'flags bit7 = 0',
  },
  r0034: {
    regionId: 'r0034',
    label: '_DATA_2762_',
    romOffset: '0x02762',
    selection: 'flags bit7 = 1 and bit6 = 0',
  },
  skipped: {
    regionId: null,
    label: null,
    romOffset: null,
    selection: 'flags bit7 = 1 and bit6 = 1',
  },
};

const sourceCatalogs = [
  'world-room-overlay-index-bound-catalog-2026-06-25',
  'world-zone-loader-caller-context-catalog-2026-06-25',
  'world-room-subrecord-catalog-2026-06-25',
  'world-zone-recipe-catalog-2026-06-25',
  'world-inline-transition-recipe-catalog-2026-06-25',
  'world-palette-table-catalog-2026-06-24',
  'world-sprite-palette-writer-catalog-2026-06-25',
  'world-audio-request-taxonomy-catalog-2026-06-25',
  'world-zone-audio-graph-link-catalog-2026-06-25',
];

function hex(value, pad = 5) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = /^(?:0x|\$)?([0-9A-F]+)$/i.exec(String(value));
  return match ? parseInt(match[1], 16) : null;
}

function readWordLE(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function bank4Z80PointerToRom(word) {
  return 0x10000 + (word - 0x8000);
}

function regionStart(region) {
  return parseHex(region?.offset) ?? 0;
}

function regionEnd(region) {
  return regionStart(region) + Number(region?.size || 0);
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function containingRegion(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
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

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === address.toUpperCase()) || null;
}

function catalogById(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item?.id === id);
    if (found) return found;
  }
  return null;
}

function uniqueNumbers(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function histogramEntries(map, keyName, formatter = null) {
  return [...map.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([key, count]) => ({
      [keyName]: key,
      [`${keyName}Hex`]: formatter ? formatter(key) : hex(key, 2),
      count,
    }));
}

function structuralSourceOffsets() {
  return Array.from({ length: structuralSubrecords.count }, (_, index) => structuralSubrecords.start + index * structuralSubrecords.stride);
}

function zoneRecipeSourceOffsets(mapData) {
  return uniqueNumbers((mapData.zoneRecipes || []).map(recipe => parseHex(recipe?.subrecord?.romOffset)));
}

function inlineTransitionSourceOffsets(mapData) {
  return uniqueNumbers((mapData.inlineTransitionRecipes || []).map(recipe => parseHex(recipe?.subrecord?.romOffset)));
}

function formWrapperSourceOffsets(rom) {
  const offsets = [];
  for (let entry = 0; entry < formWrapperPointerTable.entryCount; entry++) {
    const descriptorOffset = readWordLE(rom, formWrapperPointerTable.offset + entry * 2);
    const sourceWord = readWordLE(rom, descriptorOffset);
    offsets.push(bank4Z80PointerToRom(sourceWord));
  }
  return uniqueNumbers(offsets);
}

function buildSourceGroups(mapData, rom) {
  return [
    {
      name: 'structural_room_subrecords',
      source: 'aligned 18-byte table at 0x1072C',
      note: 'Includes structural orphan subrecords as well as zone-graph reached subrecords.',
      offsets: structuralSourceOffsets(),
    },
    {
      name: 'zone_recipes',
      source: 'map.zoneRecipes[].subrecord.romOffset',
      note: 'Reusable zone render recipes, including direct and trigger-driven room-zone descriptor targets.',
      offsets: zoneRecipeSourceOffsets(mapData),
    },
    {
      name: 'inline_transition_recipes',
      source: 'map.inlineTransitionRecipes[].subrecord.romOffset',
      note: 'Inline transition descriptors consumed through _LABEL_4E49_/_LABEL_B44F_ and _LABEL_2620_.',
      offsets: inlineTransitionSourceOffsets(mapData),
    },
    {
      name: 'player_form_wrapper_targets',
      source: '_DATA_BDB1_ first-word bank-4 targets passed through _LABEL_2A49_',
      note: '_LABEL_BD26_ selects _DATA_BDB1_ by _RAM_C24F_, reads the first word from the selected descriptor, and passes that bank-4 pointer to _LABEL_2A49_.',
      offsets: formWrapperSourceOffsets(rom),
    },
  ];
}

function extra998Class(flags) {
  if ((flags & 0x80) === 0) return 'r0033';
  if ((flags & 0x40) === 0) return 'r0034';
  return 'skipped';
}

function compactSourceSample(mapData, offsets) {
  return offsets.slice(0, 12).map(offset => ({
    offset: hex(offset),
    region: compactRegion(containingRegion(mapData, offset)),
  }));
}

function requestSummaryById(audioCatalog) {
  const byId = new Map();
  for (const request of audioCatalog?.requests || []) {
    byId.set(Number(request.requestId), {
      requestId: Number(request.requestId),
      requestIdHex: request.requestIdHex || hex(Number(request.requestId), 2),
      tableEntryOffset: request.tableEntryOffset || '',
      headerOffset: request.headerOffset || '',
      headerRegion: request.headerRegion || null,
      channelCount: Number(request.channelCount || 0),
      uniqueStreamCount: Number(request.uniqueStreamCount || 0),
      classification: request.classification || null,
      roomRecipeUsage: request.roomRecipeUsage ? {
        descriptorCount: Number(request.roomRecipeUsage.descriptorCount || 0),
        zoneRecipeDescriptorCount: Number(request.roomRecipeUsage.zoneRecipeDescriptorCount || 0),
        inlineTransitionRecipeDescriptorCount: Number(request.roomRecipeUsage.inlineTransitionRecipeDescriptorCount || 0),
        sourceCatalogIds: request.roomRecipeUsage.sourceCatalogIds || [],
      } : null,
    });
  }
  return byId;
}

function paletteSummaryByIndex(paletteCatalog) {
  const byIndex = new Map();
  for (const record of paletteCatalog?.records || []) {
    byIndex.set(Number(record.index), {
      index: Number(record.index),
      offset: record.offset || '',
      region: record.region || null,
      kind: record.kind || '',
      allZero: Boolean(record.allZero),
      confidence: record.confidence || '',
    });
  }
  return byIndex;
}

function summarizeSources(mapData, rom, offsets, context) {
  const extraCounts = { r0033: 0, r0034: 0, skipped: 0 };
  const paletteHistogram = new Map();
  const audioHistogram = new Map();
  const audioClassificationCounts = {};
  let minPalette = 0xFF;
  let maxPalette = 0;
  let minAudio = 0xFF;
  let maxAudio = 0;
  let outOfPaletteTableCount = 0;
  let outOfAudioRequestTableCount = 0;
  let missingByteCount = 0;

  for (const offset of offsets) {
    const flagsOffset = offset + sourceFields.flagsPaletteOffset;
    const audioOffset = offset + sourceFields.audioRequestOffset;
    if (flagsOffset < 0 || audioOffset >= rom.length) {
      missingByteCount++;
      continue;
    }

    const flags = rom[flagsOffset];
    const paletteIndex = flags & 0x3F;
    const audioRequestId = rom[audioOffset];
    const extraClass = extra998Class(flags);
    extraCounts[extraClass]++;
    increment(paletteHistogram, paletteIndex);
    increment(audioHistogram, audioRequestId);
    minPalette = Math.min(minPalette, paletteIndex);
    maxPalette = Math.max(maxPalette, paletteIndex);
    minAudio = Math.min(minAudio, audioRequestId);
    maxAudio = Math.max(maxAudio, audioRequestId);
    if (!context.paletteRecordsByIndex.has(paletteIndex)) outOfPaletteTableCount++;
    if (!context.audioRequestsById.has(audioRequestId)) outOfAudioRequestTableCount++;
    const classification = context.audioRequestsById.get(audioRequestId)?.classification?.kind || 'missing_audio_request_catalog_entry';
    audioClassificationCounts[classification] = (audioClassificationCounts[classification] || 0) + 1;
  }

  const validSourceCount = offsets.length - missingByteCount;
  const usedPaletteIndexes = [...paletteHistogram.keys()].sort((a, b) => a - b);
  const usedAudioRequestIds = [...audioHistogram.keys()].sort((a, b) => a - b);

  return {
    sourceCount: offsets.length,
    validSourceCount,
    missingByteCount,
    fieldOffsets: {
      flagsPalette: sourceFields.flagsPaletteOffset,
      audioRequest: sourceFields.audioRequestOffset,
    },
    extra998Counts: extraCounts,
    palette: {
      minIndex: validSourceCount ? minPalette : null,
      maxIndex: validSourceCount ? maxPalette : null,
      uniqueIndexCount: paletteHistogram.size,
      outOfPaletteTableCount,
      usedPaletteIndexes,
      usedPaletteIndexHistogram: histogramEntries(paletteHistogram, 'paletteIndex'),
      usedPaletteRecords: usedPaletteIndexes.map(index => context.paletteRecordsByIndex.get(index) || {
        index,
        missingFromPaletteCatalog: true,
      }),
    },
    audio: {
      minRequestId: validSourceCount ? minAudio : null,
      maxRequestId: validSourceCount ? maxAudio : null,
      uniqueRequestCount: audioHistogram.size,
      outOfAudioRequestTableCount,
      usedRequestIds: usedAudioRequestIds,
      usedRequestHistogram: histogramEntries(audioHistogram, 'requestId'),
      classificationCounts: Object.fromEntries(Object.entries(audioClassificationCounts).sort((a, b) => a[0].localeCompare(b[0]))),
      usedRequestCatalogRefs: usedAudioRequestIds.map(requestId => context.audioRequestsById.get(requestId) || {
        requestId,
        requestIdHex: hex(requestId, 2),
        missingFromAudioCatalog: true,
      }),
    },
  };
}

function cleanCode(line) {
  return String(line || '').split(';')[0].trim();
}

function findAsmRefs(asmText, tokens) {
  const out = {};
  for (const token of tokens) out[token] = [];
  const lines = asmText.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const code = cleanCode(line);
    if (!code) continue;
    for (const token of tokens) {
      if (!code.includes(token)) continue;
      out[token].push({
        line: index + 1,
        code,
      });
    }
  }
  return out;
}

function buildCatalog(mapData, rom, asmText) {
  const paletteCatalog = catalogById(mapData, 'world-palette-table-catalog-2026-06-24');
  const audioCatalog = catalogById(mapData, 'world-audio-request-taxonomy-catalog-2026-06-25');
  const overlayIndexCatalog = catalogById(mapData, 'world-room-overlay-index-bound-catalog-2026-06-25');
  const context = {
    paletteCatalog,
    audioCatalog,
    paletteRecordsByIndex: paletteSummaryByIndex(paletteCatalog),
    audioRequestsById: requestSummaryById(audioCatalog),
  };
  const groups = buildSourceGroups(mapData, rom);
  const combinedOffsets = uniqueNumbers(groups.flatMap(group => group.offsets));
  const groupSummaries = groups.map(group => ({
    name: group.name,
    source: group.source,
    note: group.note,
    ...summarizeSources(mapData, rom, group.offsets, context),
    sourceSamples: compactSourceSample(mapData, group.offsets),
  }));
  const combined = summarizeSources(mapData, rom, combinedOffsets, context);
  const asmRefs = findAsmRefs(asmText, [
    '_LABEL_26F4_',
    '_DATA_275D_',
    '_DATA_2762_',
    '_LABEL_8B2_',
    '_LABEL_104B_',
    '_RAM_CFF9_',
    '_RAM_C26E_',
  ]);
  const status = combined.palette.outOfPaletteTableCount === 0 && combined.audio.outOfAudioRequestTableCount === 0
    ? 'cataloged_room_loader_fields_resolve_to_palette_and_audio_catalogs'
    : 'cataloged_room_loader_fields_need_manual_review';
  const evidence = [
    'ASM lines 6486-6493: byte +16 selects _DATA_275D_, _DATA_2762_, or skips the extra _LABEL_998_ loader from bits 7 and 6.',
    'ASM lines 6495-6502: the same byte +16 is masked with $3F into L, H is set to $FF, and _LABEL_8B2_ updates the BG palette while preserving the sprite palette.',
    'ASM lines 6503-6520: byte +17 is compared with _RAM_CFF9_, cached when changed, and passed to _LABEL_104B_ unless the current _RAM_C26E_ scene selector suppresses the request.',
    `Across ${combined.sourceCount} unique cataloged _LABEL_26F4_ source offsets, palette indexes range ${combined.palette.minIndex}-${combined.palette.maxIndex} and all resolve inside the current palette table catalog.`,
    `Across the same source set, audio request ids range ${combined.audio.minRequestId}-${combined.audio.maxRequestId} and all resolve inside the current audio request taxonomy catalog.`,
    overlayIndexCatalog
      ? `Source-family coverage is aligned with ${overlayIndexCatalog.id}, whose status is ${overlayIndexCatalog.summary?.status || 'unknown'}.`
      : 'The room overlay index-bound catalog was not found; source-family alignment should be rechecked after it is generated.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))])),
    assetPolicy: 'Metadata only: source offsets, field offsets, palette/audio request ids, counts, region ids, classifications, and ASM evidence. No ROM bytes, decoded palettes, decoded graphics, decoded maps, music bytes, audio samples, text, pixels, or hashes are embedded.',
    targetRoutine: {
      label: routine.label,
      offset: hex(routine.offset),
      region: compactRegion(findRegionById(mapData, routine.regionId)),
    },
    fieldModel: {
      sourceCopiedBytes: {
        startOffset: 0,
        size: 8,
        destinationRamRange: '_RAM_CF5E_.._RAM_CF65_',
      },
      flagsPaletteByte: {
        sourceByteOffset: sourceFields.flagsPaletteOffset,
        extra998Selection: extra998Loaders,
        bgPaletteFormula: 'bgPaletteIndex = sourceByte16 & 0x3F',
        spritePaletteBehavior: 'H = 0xFF before _LABEL_8B2_, so sprite palette state is preserved.',
      },
      audioRequestByte: {
        sourceByteOffset: sourceFields.audioRequestOffset,
        cacheRam: '_RAM_CFF9_',
        requestRoutine: '_LABEL_104B_',
        suppressionSelectorRam: '_RAM_C26E_',
        suppressedSelectorValues: ['0x0D', '0x09', '0x0F', '0x1E'],
        note: 'The source byte is always cached when changed; _LABEL_104B_ is skipped for the listed scene selectors.',
      },
    },
    summary: {
      status,
      confidence: status === 'cataloged_room_loader_fields_resolve_to_palette_and_audio_catalogs' ? 'high_for_cataloged_sources_medium_for_global_runtime' : 'medium',
      combinedSourceCount: combined.sourceCount,
      validSourceCount: combined.validSourceCount,
      sourceGroupCount: groups.length,
      extra998Counts: combined.extra998Counts,
      paletteMinIndex: combined.palette.minIndex,
      paletteMaxIndex: combined.palette.maxIndex,
      uniquePaletteIndexCount: combined.palette.uniqueIndexCount,
      outOfPaletteTableCount: combined.palette.outOfPaletteTableCount,
      audioMinRequestId: combined.audio.minRequestId,
      audioMaxRequestId: combined.audio.maxRequestId,
      uniqueAudioRequestCount: combined.audio.uniqueRequestCount,
      outOfAudioRequestTableCount: combined.audio.outOfAudioRequestTableCount,
      audioClassificationCounts: combined.audio.classificationCounts,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    fieldSummaries: {
      combined,
      groups: groupSummaries,
    },
    existingCatalogRefs: {
      paletteTable: paletteCatalog ? {
        id: paletteCatalog.id,
        recordCount: Number(paletteCatalog.summary?.recordCount || 0),
        tableStart: paletteCatalog.summary?.tableStart || '',
        tableEndExclusive: paletteCatalog.summary?.tableEndExclusive || '',
      } : null,
      audioRequestTaxonomy: audioCatalog ? {
        id: audioCatalog.id,
        requestCount: Number(audioCatalog.summary?.requestCount || 0),
        requestTableOffset: audioCatalog.summary?.requestTableOffset || '',
      } : null,
      overlayIndexBound: overlayIndexCatalog ? {
        id: overlayIndexCatalog.id,
        status: overlayIndexCatalog.summary?.status || '',
        combinedSourceCount: Number(overlayIndexCatalog.summary?.combinedSourceCount || 0),
      } : null,
    },
    asmRefs: {
      label26f4: asmRefs._LABEL_26F4_.slice(0, 8),
      data275d: asmRefs._DATA_275D_.slice(0, 8),
      data2762: asmRefs._DATA_2762_.slice(0, 8),
      label8b2: asmRefs._LABEL_8B2_.slice(0, 12),
      label104b: asmRefs._LABEL_104B_.slice(0, 12),
      ramCff9: asmRefs._RAM_CFF9_.slice(0, 12),
      ramC26e: asmRefs._RAM_C26E_.slice(0, 12),
    },
    evidence,
    nextLeads: [
      'Add analyzer UI filters for room-loader field summaries so rooms can be grouped by BG palette index, extra 998 loader class, and audio request id.',
      'Trace _RAM_C26E_ runtime values per room-load path to distinguish audio bytes that are cached only from bytes that also call _LABEL_104B_ immediately.',
      'Connect used palette indexes to browser-local CRAM previews without storing palette bytes in project metadata.',
    ],
  };
}

function annotateRegion(region, key, value, annotated) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis[key] = value;
  annotated.push(compactRegion(region));
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const routineRegion = findRegionById(mapData, routine.regionId);
  annotateRegion(routineRegion, 'roomLoaderFieldBoundAudit', {
    catalogId,
    kind: 'room_loader_field_bound_summary',
    status: catalog.summary.status,
    confidence: catalog.summary.confidence,
    sourceFieldOffsets: {
      flagsPalette: sourceFields.flagsPaletteOffset,
      audioRequest: sourceFields.audioRequestOffset,
    },
    combinedSourceCount: catalog.summary.combinedSourceCount,
    extra998Counts: catalog.summary.extra998Counts,
    paletteIndexRange: {
      min: catalog.summary.paletteMinIndex,
      max: catalog.summary.paletteMaxIndex,
      unique: catalog.summary.uniquePaletteIndexCount,
      outOfPaletteTableCount: catalog.summary.outOfPaletteTableCount,
    },
    audioRequestRange: {
      min: catalog.summary.audioMinRequestId,
      max: catalog.summary.audioMaxRequestId,
      unique: catalog.summary.uniqueAudioRequestCount,
      outOfAudioRequestTableCount: catalog.summary.outOfAudioRequestTableCount,
    },
    summary: 'Cataloged _LABEL_26F4_ source fields resolve byte +16 to extra _LABEL_998_/BG palette metadata and byte +17 to audio request metadata.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  for (const [key, loader] of Object.entries(extra998Loaders)) {
    if (!loader.regionId) continue;
    const region = findRegionById(mapData, loader.regionId);
    annotateRegion(region, 'roomLoaderFieldBoundAudit', {
      catalogId,
      kind: 'room_loader_extra_998_selection',
      role: key === 'r0033' ? 'default_extra_998_loader' : 'alternate_extra_998_loader',
      confidence: 'high_for_cataloged_sources',
      sourceFieldOffset: sourceFields.flagsPaletteOffset,
      selection: loader.selection,
      catalogedSelectionCount: catalog.summary.extra998Counts[key] || 0,
      summary: `${loader.label} is selected by _LABEL_26F4_ when ${loader.selection}.`,
      evidence: catalog.evidence.slice(0, 2),
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
  }

  const annotatedRam = [];
  const cff9 = findRam(mapData, '$CFF9');
  if (cff9) {
    cff9.analysis = cff9.analysis || {};
    cff9.analysis.roomLoaderFieldBoundAudit = {
      catalogId,
      kind: 'room_loader_audio_request_cache',
      confidence: 'high',
      sourceFieldOffset: sourceFields.audioRequestOffset,
      sourceCount: catalog.summary.combinedSourceCount,
      requestIdRange: {
        min: catalog.summary.audioMinRequestId,
        max: catalog.summary.audioMaxRequestId,
        unique: catalog.summary.uniqueAudioRequestCount,
      },
      outOfAudioRequestTableCount: catalog.summary.outOfAudioRequestTableCount,
      summary: '_RAM_CFF9_ caches room-loader source byte +17 before unsuppressed room audio requests are passed to _LABEL_104B_.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRam.push({
      id: cff9.id,
      address: cff9.address,
      name: cff9.name || '',
      role: 'audio_request_cache',
    });
  }

  const c26e = findRam(mapData, '$C26E');
  if (c26e) {
    c26e.analysis = c26e.analysis || {};
    c26e.analysis.roomLoaderFieldBoundAudit = {
      catalogId,
      kind: 'room_loader_audio_request_suppression_selector',
      confidence: 'high',
      suppressedSelectorValues: catalog.fieldModel.audioRequestByte.suppressedSelectorValues,
      summary: '_RAM_C26E_ low six bits suppress immediate _LABEL_104B_ calls for selected room/transition modes after _RAM_CFF9_ is updated.',
      evidence: catalog.evidence.slice(2, 3),
      generatedAt: now,
      tool: toolName,
    };
    annotatedRam.push({
      id: c26e.id,
      address: c26e.address,
      name: c26e.name || '',
      role: 'audio_request_suppression_selector',
    });
  }

  return {
    annotatedRegions,
    annotatedRam,
  };
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, rom, asmText);
  let annotation = { annotatedRegions: [], annotatedRam: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_loader_field_bound_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs,
      sourceCatalogPresence: catalog.sourceCatalogPresence,
      targetRoutine: catalog.targetRoutine,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotation.annotatedRegions.length,
        annotatedRamCount: annotation.annotatedRam.length,
      },
      fieldModel: catalog.fieldModel,
      existingCatalogRefs: catalog.existingCatalogRefs,
      annotatedRegions: annotation.annotatedRegions,
      annotatedRam: annotation.annotatedRam,
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
      annotatedRegionCount: annotation.annotatedRegions.length,
      annotatedRamCount: annotation.annotatedRam.length,
    },
    groupSummaries: catalog.fieldSummaries.groups.map(group => ({
      name: group.name,
      sourceCount: group.sourceCount,
      extra998Counts: group.extra998Counts,
      paletteIndexRange: {
        min: group.palette.minIndex,
        max: group.palette.maxIndex,
        unique: group.palette.uniqueIndexCount,
        outOfPaletteTableCount: group.palette.outOfPaletteTableCount,
      },
      audioRequestRange: {
        min: group.audio.minRequestId,
        max: group.audio.maxRequestId,
        unique: group.audio.uniqueRequestCount,
        outOfAudioRequestTableCount: group.audio.outOfAudioRequestTableCount,
      },
    })),
    existingCatalogRefs: catalog.existingCatalogRefs,
  }, null, 2));
}

main();
