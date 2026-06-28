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
const toolName = 'tools/world-room-overlay-index-bound-audit.mjs';
const catalogId = 'world-room-overlay-index-bound-catalog-2026-06-25';
const reportId = 'room-overlay-index-bound-audit-2026-06-25';

const overlayTable = {
  regionId: 'r0339',
  start: 0x10000,
  endExclusive: 0x10718,
  stride: 8,
};
overlayTable.recordCount = (overlayTable.endExclusive - overlayTable.start) / overlayTable.stride;

const tail = {
  regionId: 'r2813',
  start: 0x10718,
  endExclusive: 0x1071A,
  selectingIndex: overlayTable.recordCount,
};

const structuralSubrecords = {
  start: 0x1072C,
  stride: 18,
  count: 76,
  cf64FieldOffset: 6,
};

const formWrapperPointerTable = {
  label: '_DATA_BDB1_',
  offset: 0x0BDB1,
  entryCount: 6,
};

const sourceCatalogs = [
  'world-room-overlay-record-catalog-2026-06-25',
  'world-room-overlay-tail-refinement-catalog-2026-06-25',
  'world-room-subrecord-catalog-2026-06-25',
  'world-zone-recipe-catalog-2026-06-25',
  'world-inline-transition-recipe-catalog-2026-06-25',
  'world-player-form-catalog-2026-06-25',
];

function hex(value, pad = 5) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function z80Bank4PointerToRom(word) {
  return 0x10000 + (word - 0x8000);
}

function readWordLE(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function offsetOf(region) {
  return parseHex(region?.offset) ?? 0;
}

function endOf(region) {
  return offsetOf(region) + Number(region?.size || 0);
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

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function containingRegion(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= offsetOf(region) && offset < endOf(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === address.toUpperCase()) || null;
}

function nextRamId(mapData) {
  let maxId = 0;
  for (const entry of mapData.ram || []) {
    const match = /^ram(\d+)$/i.exec(entry.id || '');
    if (match) maxId = Math.max(maxId, Number(match[1]));
  }
  return 'ram' + String(maxId + 1).padStart(4, '0');
}

function ensureRam(mapData, address) {
  let entry = findRam(mapData, address);
  let created = false;
  if (!entry) {
    entry = {
      id: nextRamId(mapData),
      address,
      size: 1,
      type: 'byte',
      name: 'ROOM OVERLAY TILE RECORD INDEX',
      notes: 'Copied from room-loader source byte +6 by _LABEL_26F4_; consumed by _LABEL_11F4_ to select an 8-byte _DATA_10000_ overlay record.',
    };
    mapData.ram = mapData.ram || [];
    mapData.ram.push(entry);
    created = true;
  }
  return { entry, created };
}

function uniqueNumbers(values) {
  return [...new Set(values.filter(value => Number.isFinite(value)))].sort((a, b) => a - b);
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
    offsets.push(z80Bank4PointerToRom(sourceWord));
  }
  return uniqueNumbers(offsets);
}

function sourceGroup(name, source, offsets, note = '') {
  return {
    name,
    source,
    sourceCount: offsets.length,
    offsets,
    note,
  };
}

function buildSourceGroups(mapData, rom) {
  return [
    sourceGroup(
      'structural_room_subrecords',
      'aligned 18-byte table at 0x1072C',
      structuralSourceOffsets(),
      'Includes structural orphan subrecords as well as zone-graph reached subrecords.'
    ),
    sourceGroup(
      'zone_recipes',
      'map.zoneRecipes[].subrecord.romOffset',
      zoneRecipeSourceOffsets(mapData),
      'Current reusable zone render recipes, including subrecord-like sources inside r0339.'
    ),
    sourceGroup(
      'inline_transition_recipes',
      'map.inlineTransitionRecipes[].subrecord.romOffset',
      inlineTransitionSourceOffsets(mapData),
      'Inline transition descriptors consumed through _LABEL_4E49_/_LABEL_B44F_ and _LABEL_2620_.'
    ),
    sourceGroup(
      'player_form_wrapper_targets',
      '_DATA_BDB1_ first-word bank-4 targets passed through _LABEL_2A49_',
      formWrapperSourceOffsets(rom),
      '_LABEL_BD26_ selects _DATA_BDB1_ by _RAM_C24F_, reads the first word from the selected descriptor, and passes that bank-4 pointer to _LABEL_2A49_.'
    ),
  ];
}

function summarizeOffsets(rom, offsets) {
  const histogram = new Map();
  let min = 0xFF;
  let max = 0;
  let tailIndexRefCount = 0;
  let outOfBoundsIndexCount = 0;
  let missingByteCount = 0;

  for (const offset of offsets) {
    const fieldOffset = offset + structuralSubrecords.cf64FieldOffset;
    if (fieldOffset < 0 || fieldOffset >= rom.length) {
      missingByteCount++;
      continue;
    }
    const value = rom[fieldOffset];
    min = Math.min(min, value);
    max = Math.max(max, value);
    if (value === tail.selectingIndex) tailIndexRefCount++;
    if (value >= overlayTable.recordCount) outOfBoundsIndexCount++;
    histogram.set(value, (histogram.get(value) || 0) + 1);
  }

  const validCount = offsets.length - missingByteCount;
  const observedIndexHistogram = [...histogram.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([overlayIndex, count]) => ({
      overlayIndex,
      overlayIndexHex: hex(overlayIndex, 2),
      count,
      selectsTail: overlayIndex === tail.selectingIndex,
      inRecordTable: overlayIndex >= 0 && overlayIndex < overlayTable.recordCount,
    }));

  return {
    sourceCount: offsets.length,
    validSourceCount: validCount,
    missingByteCount,
    cf64FieldOffset: structuralSubrecords.cf64FieldOffset,
    minObservedIndex: validCount ? min : null,
    maxObservedIndex: validCount ? max : null,
    uniqueIndexCount: histogram.size,
    tailIndexCandidate: tail.selectingIndex,
    tailIndexCandidateHex: hex(tail.selectingIndex, 2),
    tailIndexRefCount,
    outOfBoundsIndexCount,
    observedIndexHistogram,
  };
}

function compactSourceSample(mapData, offsets) {
  return offsets.slice(0, 12).map(offset => ({
    offset: hex(offset),
    region: compactRegion(containingRegion(mapData, offset)),
  }));
}

function analyzeAsm(asmText) {
  const lines = asmText.split(/\r?\n/);
  const refs = [];
  const call2620 = [];
  const call26f4 = [];
  const call2a49 = [];

  for (const [index, rawLine] of lines.entries()) {
    const code = rawLine.split(';')[0].trim();
    if (!code) continue;
    const line = index + 1;
    if (code.includes('_RAM_CF64_') && !code.startsWith('_RAM_CF64_')) refs.push({ line, code });
    if (/\bcall\s+_LABEL_2620_\b/i.test(code)) call2620.push({ line, code });
    if (/\bcall\s+_LABEL_26F4_\b/i.test(code)) call26f4.push({ line, code });
    if (/\bcall\s+_LABEL_2A49_\b/i.test(code)) call2a49.push({ line, code });
  }

  return {
    ramCF64Refs: refs,
    ramCF64DirectReadCount: refs.filter(ref => /^ld\s+a,\s*\(_RAM_CF64_\)$/i.test(ref.code)).length,
    ramCF64DirectWriteCount: refs.filter(ref => /^ld\s+\(_RAM_CF64_\),/i.test(ref.code)).length,
    call2620Count: call2620.length,
    call26f4Count: call26f4.length,
    call2a49Count: call2a49.length,
    call2620Sample: call2620.slice(0, 16),
    call26f4: call26f4,
    call2a49: call2a49,
  };
}

function buildCatalog(mapData, rom, asmText) {
  const groups = buildSourceGroups(mapData, rom);
  const combinedOffsets = uniqueNumbers(groups.flatMap(group => group.offsets));
  const groupSummaries = groups.map(group => {
    const summary = summarizeOffsets(rom, group.offsets);
    return {
      name: group.name,
      source: group.source,
      note: group.note,
      ...summary,
      sourceSamples: compactSourceSample(mapData, group.offsets),
    };
  });
  const combined = summarizeOffsets(rom, combinedOffsets);
  const asm = analyzeAsm(asmText);
  const status = combined.tailIndexRefCount === 0 && combined.outOfBoundsIndexCount === 0
    ? 'cataloged_cf64_sources_do_not_select_overlay_tail'
    : 'cataloged_cf64_sources_need_manual_review';

  const evidence = [
    'ASM lines 6472-6475: _LABEL_26F4_ copies eight bytes from the selected room-loader source into _RAM_CF5E_.._RAM_CF65_, so _RAM_CF64_ is source byte +6.',
    'ASM lines 3542-3551: _LABEL_11F4_ reads _RAM_CF64_, multiplies it by eight, and adds it to _DATA_10000_ to select an overlay record.',
    `The confirmed overlay table has ${overlayTable.recordCount} complete 8-byte records at 0x10000-0x10717; selecting r2813 would require index ${tail.selectingIndex}.`,
    `Across ${combined.sourceCount} unique currently cataloged _LABEL_26F4_ source offsets, byte +6 ranges from ${combined.minObservedIndex} to ${combined.maxObservedIndex}, with zero index-${tail.selectingIndex} or out-of-table hits.`,
    'The sampled sources include structural room subrecords, zone recipes, inline transition recipes, and _LABEL_2A49_ player-form wrapper targets from _DATA_BDB1_.',
    'Current ASM has no direct write to _RAM_CF64_; the observed read is the overlay-record index use in _LABEL_11F4_.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: offsets, labels, source counts, scalar index summaries, histograms, region ids, routine refs, and evidence. No ROM bytes, decoded graphics, tile values, maps, audio, text, pixels, or hashes are embedded.',
    summary: {
      status,
      confidence: status === 'cataloged_cf64_sources_do_not_select_overlay_tail' ? 'high_for_cataloged_sources_medium_for_global_runtime' : 'medium',
      overlayTableRegionId: overlayTable.regionId,
      overlayTableOffset: hex(overlayTable.start),
      overlayTableEndInclusive: hex(overlayTable.endExclusive - 1),
      overlayRecordStride: overlayTable.stride,
      overlayRecordCount: overlayTable.recordCount,
      tailRegionId: tail.regionId,
      tailOffset: hex(tail.start),
      tailEndInclusive: hex(tail.endExclusive - 1),
      tailSelectingIndex: tail.selectingIndex,
      cf64SourceByteOffset: structuralSubrecords.cf64FieldOffset,
      combinedSourceCount: combined.sourceCount,
      combinedMinObservedIndex: combined.minObservedIndex,
      combinedMaxObservedIndex: combined.maxObservedIndex,
      combinedUniqueIndexCount: combined.uniqueIndexCount,
      combinedTailIndexRefCount: combined.tailIndexRefCount,
      combinedOutOfBoundsIndexCount: combined.outOfBoundsIndexCount,
      ramCF64DirectWriteCount: asm.ramCF64DirectWriteCount,
      label2620CallsiteCount: asm.call2620Count,
      label26f4CallsiteCount: asm.call26f4Count,
      label2a49CallsiteCount: asm.call2a49Count,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    overlayTable: {
      region: compactRegion(findRegionById(mapData, overlayTable.regionId)),
      offset: hex(overlayTable.start),
      endInclusive: hex(overlayTable.endExclusive - 1),
      stride: overlayTable.stride,
      recordCount: overlayTable.recordCount,
    },
    tail: {
      region: compactRegion(findRegionById(mapData, tail.regionId)),
      offset: hex(tail.start),
      endInclusive: hex(tail.endExclusive - 1),
      selectingIndex: tail.selectingIndex,
      selectingIndexHex: hex(tail.selectingIndex, 2),
    },
    cf64Sources: {
      combined,
      groups: groupSummaries,
    },
    asm,
    evidence,
    nextLeads: [
      'Resolve each remaining _LABEL_2620_ callsite to a descriptor source set, then compare the source offsets against this catalog.',
      'Add an analyzer overlay-record preview that can show which recipe source byte selected which _DATA_10000_ record without storing the record bytes.',
      'Keep r2813 unresolved until a non-index consumer is found, or until a complete _LABEL_2620_ callsite closure proves it unreachable at runtime.',
    ],
  };
}

function annotateRegions(mapData, catalog) {
  const changed = [];
  const overlayRegion = findRegionById(mapData, overlayTable.regionId);
  if (overlayRegion) {
    overlayRegion.analysis = overlayRegion.analysis || {};
    overlayRegion.analysis.roomOverlayIndexBoundAudit = {
      catalogId,
      kind: 'room_overlay_index_bound',
      confidence: 'high_for_cataloged_sources_medium_for_global_runtime',
      cf64SourceByteOffset: structuralSubrecords.cf64FieldOffset,
      recordStride: overlayTable.stride,
      recordCount: overlayTable.recordCount,
      catalogedSourceCount: catalog.summary.combinedSourceCount,
      maxObservedIndex: catalog.summary.combinedMaxObservedIndex,
      tailSelectingIndex: catalog.summary.tailSelectingIndex,
      tailIndexRefCount: catalog.summary.combinedTailIndexRefCount,
      outOfBoundsIndexCount: catalog.summary.combinedOutOfBoundsIndexCount,
      summary: 'Cataloged _LABEL_26F4_ sources select only in-range _DATA_10000_ overlay records; none select the two-byte r2813 tail.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changed.push({ region: compactRegion(overlayRegion), analysisKey: 'roomOverlayIndexBoundAudit' });
  }

  const tailRegion = findRegionById(mapData, tail.regionId);
  if (tailRegion) {
    tailRegion.analysis = tailRegion.analysis || {};
    tailRegion.analysis.roomOverlayIndexBoundAudit = {
      catalogId,
      kind: 'room_overlay_tail_index_bound',
      status: catalog.summary.status,
      confidence: 'high_for_cataloged_sources_medium_for_global_runtime',
      tailSelectingIndex: catalog.summary.tailSelectingIndex,
      catalogedSourceCount: catalog.summary.combinedSourceCount,
      maxObservedIndex: catalog.summary.combinedMaxObservedIndex,
      tailIndexRefCount: catalog.summary.combinedTailIndexRefCount,
      outOfBoundsIndexCount: catalog.summary.combinedOutOfBoundsIndexCount,
      directCF64WriteCount: catalog.summary.ramCF64DirectWriteCount,
      summary: 'Current cataloged room-loader sources never seed _RAM_CF64_ with the index required to select r2813 as an overlay record.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (tailRegion.analysis.unresolvedAssetConsumerAudit) {
      tailRegion.analysis.unresolvedAssetConsumerAudit.refinedByOverlayIndexBoundAudit = catalogId;
      tailRegion.analysis.unresolvedAssetConsumerAudit.overlayIndexBoundStatus = catalog.summary.status;
    }
    changed.push({ region: compactRegion(tailRegion), analysisKey: 'roomOverlayIndexBoundAudit' });
  }

  return changed;
}

function annotateRam(mapData, catalog) {
  const { entry, created } = ensureRam(mapData, '$CF64');
  const before = {
    id: entry.id,
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || '',
    name: entry.name || '',
    notes: entry.notes || '',
  };
  entry.size = 1;
  entry.type = 'byte';
  entry.name = entry.name || 'ROOM OVERLAY TILE RECORD INDEX';
  if (!entry.notes) {
    entry.notes = 'Copied from room-loader source byte +6 by _LABEL_26F4_; consumed by _LABEL_11F4_ to select an 8-byte _DATA_10000_ overlay record.';
  }
  entry.analysis = entry.analysis || {};
  entry.analysis.roomOverlayIndexBoundAudit = {
    catalogId,
    kind: 'ram_cf64_room_overlay_index',
    confidence: 'high',
    sourceByteOffset: structuralSubrecords.cf64FieldOffset,
    selectedTable: '_DATA_10000_',
    selectedTableRegionId: overlayTable.regionId,
    recordStride: overlayTable.stride,
    catalogedSourceCount: catalog.summary.combinedSourceCount,
    observedIndexRange: {
      min: catalog.summary.combinedMinObservedIndex,
      max: catalog.summary.combinedMaxObservedIndex,
    },
    directWriteCount: catalog.summary.ramCF64DirectWriteCount,
    summary: '_RAM_CF64_ is copied from room-loader source byte +6 and used as the _DATA_10000_ overlay-record index.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return [{
    created,
    before,
    after: {
      id: entry.id,
      address: entry.address,
      size: entry.size || 0,
      type: entry.type || '',
      name: entry.name || '',
      notes: entry.notes || '',
    },
  }];
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, rom, asmText);
  const annotatedRegions = apply ? annotateRegions(mapData, catalog) : [];
  const annotatedRam = apply ? annotateRam(mapData, catalog) : [];

  if (apply) {
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_overlay_index_bound_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
        annotatedRamEntries: annotatedRam.length,
      },
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      annotatedRegions,
      annotatedRamEntries: annotatedRam,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotatedRegions.length,
      annotatedRamEntries: annotatedRam.length,
    },
    groupSummaries: catalog.cf64Sources.groups.map(group => ({
      name: group.name,
      sourceCount: group.sourceCount,
      minObservedIndex: group.minObservedIndex,
      maxObservedIndex: group.maxObservedIndex,
      uniqueIndexCount: group.uniqueIndexCount,
      tailIndexRefCount: group.tailIndexRefCount,
      outOfBoundsIndexCount: group.outOfBoundsIndexCount,
    })),
    asm: {
      ramCF64Refs: catalog.asm.ramCF64Refs,
      call2620Count: catalog.asm.call2620Count,
      call26f4: catalog.asm.call26f4,
      call2a49: catalog.asm.call2a49,
    },
  }, null, 2));
}

main();
