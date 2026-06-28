#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-collision-buffer-provenance-catalog-2026-06-25';
const reportId = 'collision-buffer-provenance-audit-2026-06-25';
const toolName = 'tools/world-collision-buffer-provenance-audit.mjs';

const sourceCatalogIds = {
  dc2ScrollMap: 'world-dc2-scroll-map-catalog-2026-06-25',
  dc2TilePairLookup: 'world-dc2-tile-pair-lookup-catalog-2026-06-25',
  entityMotionCollision: 'world-entity-motion-collision-helper-catalog-2026-06-25',
  playerPhysicsStateEffect: 'world-player-physics-state-effect-catalog-2026-06-25',
};

const routineRoles = [
  {
    label: '_LABEL_DC2_',
    offset: 0x00DC2,
    role: 'dc2_collision_render_buffer_producer',
    kind: 'producer',
    confidence: 'high',
    summary: 'Expands six room-subrecord DC2 stream indexes through the bank-5 _DATA_14000_ pointer table into the _RAM_CB00_ room cell buffer.',
    evidence: [
      'ASM lines 2882-2914 copy six room-subrecord bytes, switch to bank 5, resolve _DATA_14000_ entries, and decode each stream.',
      'ASM lines 2930-2994 decode direct bytes, E3-FE short runs, and FF-count-value extended runs into _RAM_CB00_.',
    ],
  },
  {
    label: '_LABEL_EF3_',
    offset: 0x00EF3,
    role: 'dc2_room_cell_visual_renderer',
    kind: 'visual_consumer',
    confidence: 'high',
    summary: 'Reads room cell indexes from _RAM_CB00_ and uses _DATA_18000_ tile-pair records to build VDP name-table column data.',
    evidence: [
      'ASM lines 3060-3079 compute an _RAM_CB00_ read pointer from _RAM_D013_.',
      'ASM lines 3083-3096 read one cell per row from _RAM_CB00_, multiply it by 8, and add it to _DATA_18000_.',
    ],
  },
  {
    label: '_LABEL_141F_',
    offset: 0x0141F,
    role: 'collision_tile_lookup_from_dc2_room_buffer',
    kind: 'collision_consumer',
    confidence: 'high',
    summary: 'Converts actor/player coordinates into an _RAM_CB00_ cell address and returns the collision/map cell value.',
    evidence: [
      'ASM lines 3868-3894 subtract 0x10 from E, derive a row stride of 0x60, shift HL right four times for the column, add _RAM_CB00_, and load A from the computed address.',
    ],
  },
  {
    label: '_LABEL_1144_',
    offset: 0x01144,
    role: 'bounded_collision_lookup_or_default',
    kind: 'collision_consumer_wrapper',
    confidence: 'high',
    summary: 'Bounds-checks coordinates and calls _LABEL_141F_ for in-bounds collision cell reads, otherwise returning the fallback byte at _DATA_115C_.',
    evidence: [
      'Existing bank0 core helper audit records _LABEL_1144_ as checking E against 0x10-0xBF and H against _RAM_D01A_ before calling _LABEL_141F_.',
    ],
  },
];

const regionRoles = [
  {
    offset: 0x14000,
    label: '_DATA_14000_',
    role: 'dc2_scroll_map_pointer_table_for_room_cells',
    kind: 'source_pointer_table',
    confidence: 'high',
    summary: '176-entry bank-5 pointer table used by _LABEL_DC2_ to select compressed DC2 room-cell streams.',
  },
  {
    offset: 0x18000,
    label: '_DATA_18000_',
    role: 'dc2_cell_visual_tile_pair_lookup',
    kind: 'visual_lookup',
    confidence: 'high',
    summary: '227-entry visual lookup consumed by _LABEL_EF3_; collision behavior uses the pre-lookup _RAM_CB00_ cell values directly.',
  },
];

const ramRoles = [
  {
    address: '$CB00',
    role: 'dc2_room_cell_buffer_collision_and_render',
    confidence: 'high',
    summary: 'Base of the decompressed DC2 room cell buffer. _LABEL_DC2_ writes it, _LABEL_EF3_ renders from it, and _LABEL_141F_ reads collision cells from it.',
  },
  {
    address: '$D01A',
    role: 'collision_lookup_column_bound',
    confidence: 'medium',
    summary: '_LABEL_1144_ compares the coordinate column high byte with _RAM_D01A_ before permitting an _RAM_CB00_ collision lookup.',
  },
  {
    address: '$D013',
    role: 'dc2_visual_render_column_index',
    confidence: 'high',
    summary: '_LABEL_EF3_ uses this render column index to choose the _RAM_CB00_ column and VDP name-table destination.',
  },
  {
    address: '$D017',
    role: 'dc2_visual_cb00_row_pointer',
    confidence: 'high',
    summary: '_LABEL_EF3_ advances this pointer by 0x60 per row while reading _RAM_CB00_ for visual rendering.',
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
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

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function findCatalog(mapData, id) {
  const found = Object.keys(mapData)
    .filter(key => Array.isArray(mapData[key]) && /catalog/i.test(key))
    .flatMap(key => mapData[key].map(catalog => ({ bucket: key, catalog })))
    .find(item => item.catalog?.id === id);
  return found || null;
}

function buildAsmIndex(asmText) {
  const lines = asmText.split(/\r?\n/);
  const labels = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_(?:LABEL|DATA)_[0-9A-F]+_):/.exec(lines[i]);
    if (match) labels.push({ label: match[1], line: i + 1, offset: labelOffset(match[1]) });
  }
  return { lines, labels };
}

function containingAsmLabel(asmIndex, line) {
  let current = null;
  for (const label of asmIndex.labels) {
    if (label.line > line) break;
    current = label;
  }
  return current;
}

function collectDirectCollisionLookups(asmText, mapData) {
  const asmIndex = buildAsmIndex(asmText);
  const calls = [];
  for (let i = 0; i < asmIndex.lines.length; i++) {
    const code = asmIndex.lines[i].split(';')[0].trim();
    if (!/\bcall\s+_LABEL_141F_\b/i.test(code)) continue;
    const label = containingAsmLabel(asmIndex, i + 1);
    const region = label?.offset == null ? null : findContainingRegion(mapData, label.offset);
    calls.push({
      line: i + 1,
      code,
      containingLabel: label?.label || null,
      containingOffset: label?.offset == null ? null : hex(label.offset),
      region: regionRef(region),
    });
  }
  return calls;
}

function collectCatalogCollisionConsumers(mapData) {
  const motion = findCatalog(mapData, sourceCatalogIds.entityMotionCollision)?.catalog;
  const player = findCatalog(mapData, sourceCatalogIds.playerPhysicsStateEffect)?.catalog;
  const motionHelpers = (motion?.helpers || [])
    .filter(helper => (helper.calls || []).includes('_LABEL_141F_') || (helper.globalRamRefs || []).includes('_RAM_CB00_'))
    .map(helper => ({
      sourceCatalogId: motion.id,
      label: helper.label,
      offset: helper.offset,
      role: helper.role,
      category: helper.category,
      region: helper.region || regionRef(findContainingRegion(mapData, parseInt(helper.offset, 16))),
      evidence: (helper.evidence || []).slice(0, 3),
    }));
  const playerEffects = (player?.effects || [])
    .filter(effect => (effect.calls || []).includes('_LABEL_141F_') || (effect.globalRamRefs || []).includes('$CB00'))
    .map(effect => ({
      sourceCatalogId: player.id,
      label: effect.label,
      offset: effect.offset,
      role: effect.role,
      category: effect.category,
      region: effect.region || regionRef(findContainingRegion(mapData, parseInt(effect.offset, 16))),
      evidence: (effect.evidence || []).slice(0, 3),
    }));
  return [...motionHelpers, ...playerEffects];
}

function buildCatalog(mapData, asmText) {
  const sourceCatalogs = Object.fromEntries(Object.entries(sourceCatalogIds).map(([key, id]) => {
    const found = findCatalog(mapData, id);
    return [key, found ? { id, bucket: found.bucket } : null];
  }));
  const directCalls = collectDirectCollisionLookups(asmText, mapData);
  const catalogConsumers = collectCatalogCollisionConsumers(mapData);
  const routines = routineRoles.map(item => ({
    ...item,
    offset: hex(item.offset),
    region: regionRef(findContainingRegion(mapData, item.offset)),
  }));
  const sourceRegions = regionRoles.map(item => ({
    ...item,
    offset: hex(item.offset),
    region: regionRef(findContainingRegion(mapData, item.offset)),
  }));
  const ram = ramRoles.map(item => ({
    ...item,
    ram: ramRef(findRam(mapData, item.address)),
  }));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    bufferModel: {
      baseRam: '_RAM_CB00_',
      baseAddress: '$CB00',
      rowCount: 11,
      substreamCount: 6,
      cellsPerSubstreamRow: 16,
      cellsPerFullRow: 96,
      rowStrideBytes: '0x60',
      footprint: { start: '$CB00', endInclusive: '$CF1F', sizeBytes: 0x420 },
      producer: '_LABEL_DC2_',
      visualConsumer: '_LABEL_EF3_',
      collisionConsumer: '_LABEL_141F_',
      collisionCellPolicy: {
        blockingThreshold: '0x10',
        specialCaptureValue: '0x05',
        evidence: 'Existing player/entity collision helper audits show tile values below 0x10 are blocking/contact cells and 0x05 is captured by the special collision-tile path.',
      },
    },
    dataFlow: [
      { order: 1, kind: 'room_subrecord_dc2_indices', source: 'six DC2 bytes copied by _LABEL_DC2_', target: '_DATA_14000_ pointer indexes' },
      { order: 2, kind: 'compressed_dc2_streams', source: '_DATA_14000_ bank-5 stream pointers', target: '_RAM_CB00_ decompressed room cell buffer' },
      { order: 3, kind: 'visual_render', source: '_RAM_CB00_ cell values', target: '_DATA_18000_ tile-pair lookup and VDP name-table column buffer' },
      { order: 4, kind: 'collision_lookup', source: 'actor/player coordinates', target: '_RAM_CB00_ cell value returned by _LABEL_141F_' },
    ],
    routines,
    sourceRegions,
    ram,
    directCollisionLookupCalls: directCalls,
    catalogCollisionConsumers: catalogConsumers,
    summary: {
      routineCount: routines.length,
      sourceRegionCount: sourceRegions.length,
      ramRoleCount: ram.length,
      directCollisionLookupCallCount: directCalls.length,
      catalogCollisionConsumerCount: catalogConsumers.length,
      sourceCatalogsPresent: Object.values(sourceCatalogs).filter(Boolean).length,
      bufferFootprintBytes: 0x420,
      assetPolicy: 'Metadata only: ASM labels, offsets, RAM addresses, buffer dimensions, aggregate flow roles, and evidence. No ROM bytes, decoded room cells, graphics, music, text, or gameplay asset payloads are embedded.',
    },
    evidence: [
      'ASM lines 2882-2914 show _LABEL_DC2_ resolving six room-subrecord DC2 stream indexes through _DATA_14000_.',
      'ASM lines 2930-2994 show the DC2 decoder writing 11 rows of 16 cells per stream to _RAM_CB00_, advancing 0x50 after each 16-cell row while caller advances each stream base by 0x10.',
      'ASM lines 3060-3096 show _LABEL_EF3_ reading _RAM_CB00_ cells with a 0x60 row stride and indexing _DATA_18000_ visual tile-pair records.',
      'ASM lines 3868-3894 show _LABEL_141F_ converting coordinates into an _RAM_CB00_ cell address using the same 0x60 row stride.',
      'Existing motion/collision catalogs record helper policies for blocking cells and special collision cell 0x05 without embedding cell values.',
    ],
  };
}

function annotateRegion(region, entry, kind) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.collisionBufferProvenanceAudit = {
    catalogId,
    kind,
    role: entry.role,
    confidence: entry.confidence,
    label: entry.label || null,
    bufferBase: '_RAM_CB00_',
    bufferFootprint: { start: '$CB00', endInclusive: '$CF1F', sizeBytes: 0x420 },
    summary: entry.summary,
    evidence: entry.evidence || [],
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
    kind,
  };
}

function annotateRam(entry, role) {
  if (!entry) return null;
  entry.analysis = entry.analysis || {};
  entry.analysis.collisionBufferProvenanceAudit = {
    catalogId,
    kind: role.role,
    confidence: role.confidence,
    bufferFootprint: role.address === '$CB00' ? { start: '$CB00', endInclusive: '$CF1F', sizeBytes: 0x420 } : null,
    summary: role.summary,
    evidence: [
      'Collision buffer provenance catalog links _LABEL_DC2_, _LABEL_EF3_, and _LABEL_141F_ through this RAM role.',
      'No decoded room cells or ROM bytes are embedded.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  if (role.address === '$CB00') {
    entry.notes = 'Base label for the DC2 decompressed room cell buffer. Provenance audit models the runtime footprint as $CB00-$CF1F; the map entry remains a base label to avoid clobbering nearby RAM annotations.';
  }
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || 'byte',
    name: entry.name || '',
    role: role.role,
    confidence: role.confidence,
  };
}

function applyAnnotations(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  for (const routine of catalog.routines) {
    const region = routine.region?.id ? (mapData.regions || []).find(item => item.id === routine.region.id) : findContainingRegion(mapData, parseInt(routine.offset, 16));
    const annotated = annotateRegion(region, routine, routine.kind);
    if (annotated) annotatedRegions.push(annotated);
  }
  for (const source of catalog.sourceRegions) {
    const region = source.region?.id ? (mapData.regions || []).find(item => item.id === source.region.id) : findContainingRegion(mapData, parseInt(source.offset, 16));
    const annotated = annotateRegion(region, source, source.kind);
    if (annotated) annotatedRegions.push(annotated);
  }
  for (const role of catalog.ram) {
    const entry = role.ram?.id ? (mapData.ram || []).find(item => item.id === role.ram.id) : findRam(mapData, role.address);
    const annotated = annotateRam(entry, role);
    if (annotated) annotatedRam.push(annotated);
  }
  const directCallRegions = [];
  for (const call of catalog.directCollisionLookupCalls) {
    if (!call.region?.id) continue;
    const region = (mapData.regions || []).find(item => item.id === call.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    const existing = region.analysis.collisionBufferLookupCallsites || {
      catalogId,
      kind: 'direct_collision_buffer_lookup_callsite',
      confidence: 'high',
      calls: [],
      summary: 'Region directly calls _LABEL_141F_ to read the _RAM_CB00_ collision/room-cell buffer.',
      evidence: [],
      generatedAt: now,
      tool: toolName,
    };
    existing.calls = existing.calls || [];
    if (!existing.calls.some(item => item.line === call.line)) {
      existing.calls.push({
        line: call.line,
        code: call.code,
        containingLabel: call.containingLabel,
        containingOffset: call.containingOffset,
      });
    }
    existing.evidence = [
      'Direct ASM callsite scan found call _LABEL_141F_ within this region.',
      '_LABEL_141F_ reads the _RAM_CB00_ decompressed room cell buffer.',
    ];
    region.analysis.collisionBufferLookupCallsites = existing;
    directCallRegions.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      line: call.line,
      containingLabel: call.containingLabel,
    });
  }
  return { annotatedRegions, annotatedRam, directCallRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  let changes = { annotatedRegions: [], annotatedRam: [], directCallRegions: [] };

  if (apply) {
    changes = applyAnnotations(mapData, catalog);
    mapData.collisionBufferCatalogs = (mapData.collisionBufferCatalogs || []).filter(item => item.id !== catalogId);
    mapData.collisionBufferCatalogs.push(buildCatalog(mapData, asmText));
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'collision_buffer_provenance_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegions: changes.annotatedRegions.length,
        annotatedRam: changes.annotatedRam.length,
        directCallRegions: changes.directCallRegions.length,
      },
      bufferModel: catalog.bufferModel,
      dataFlow: catalog.dataFlow,
      annotatedRegions: changes.annotatedRegions,
      annotatedRam: changes.annotatedRam,
      directCallRegions: changes.directCallRegions,
      directCollisionLookupCalls: catalog.directCollisionLookupCalls,
      catalogCollisionConsumers: catalog.catalogCollisionConsumers,
      evidence: catalog.evidence,
      nextLeads: [
        'Trace _RAM_D01A_ assignments to confirm the active collision-buffer column bound for each room/zone.',
        'Connect room subrecord DC2 bytes to scene recipes so each rendered scene references its exact collision/render cell streams.',
        'Use _RAM_CB00_ provenance to build a read-only collision overlay in the analyzer without storing decoded cells in project metadata.',
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
      directCallRegions: changes.directCallRegions.length,
    },
  }, null, 2));
}

main();
