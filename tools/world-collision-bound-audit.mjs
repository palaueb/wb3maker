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
const catalogId = 'world-collision-bound-catalog-2026-06-25';
const reportId = 'collision-bound-audit-2026-06-25';
const toolName = 'tools/world-collision-bound-audit.mjs';
const collisionBufferCatalogId = 'world-collision-buffer-provenance-catalog-2026-06-25';

const routines = [
  {
    label: '_LABEL_DC2_',
    offset: 0x00DC2,
    role: 'dc2_collision_bound_producer',
    confidence: 'high',
    summary: 'Initializes _RAM_D019_ as a word at $FF00, then increments it by $0100 once per decoded DC2 stream until the first $FF DC2 index terminator. The high byte _RAM_D01A_ is therefore recipe-specific: active DC2 prefix count minus one.',
    ramRefs: ['_RAM_D019_', '_RAM_D01A_', '_RAM_D0DE_', '_RAM_CB00_'],
    evidence: [
      'ASM lines 2888-2890 load DE=$FF00 and store it through _RAM_D019_, which also writes the following byte _RAM_D01A_.',
      'ASM lines 2892-2893 set _RAM_D0DE_ to a maximum of 6 DC2 stream slots.',
      'ASM lines 2896-2899 read each DC2 index byte and jump out of the loop when it is $FF.',
      'ASM lines 2899-2904 load _RAM_D019_, add $0100, and store it back only for a non-$FF decoded stream.',
      'With N active streams before the first $FF terminator, the word progresses $FF00 plus N increments, making _RAM_D01A_ equal N-1; the all-six-stream maximum is $05.',
    ],
  },
  {
    label: '_LABEL_FA1_',
    offset: 0x00FA1,
    role: 'camera_scroll_clamp_uses_d019_word',
    confidence: 'high',
    summary: 'Clamps the camera/scroll origin _RAM_D00F_ against the _RAM_D019_ word produced by _LABEL_DC2_.',
    ramRefs: ['_RAM_C243_', '_RAM_D019_', '_RAM_D00F_', '_RAM_D007_', '_RAM_CF8C_'],
    evidence: [
      'ASM lines 3162-3184 subtract $0080 from player coordinate _RAM_C243_, clamp against the word at _RAM_D019_, then store the result to _RAM_D00F_/_RAM_D007_ and mirror the low byte to _RAM_CF8C_.',
    ],
  },
  {
    label: '_LABEL_1144_',
    offset: 0x01144,
    role: 'bounded_collision_lookup_uses_d01a_high_byte',
    confidence: 'high',
    summary: 'Bounds-checks collision coordinates before calling _LABEL_141F_: E must be $10-$BF and H must be <= _RAM_D01A_; out-of-bounds returns fallback cell $10 from _DATA_115C_.',
    ramRefs: ['_RAM_D01A_', '_RAM_CB00_'],
    evidence: [
      'ASM lines 3426-3445 compare E against $10/$C0, compare H against _RAM_D01A_, return _DATA_115C_ on failure, and call _LABEL_141F_ on success.',
    ],
  },
  {
    label: '_LABEL_1446_',
    offset: 0x01446,
    role: 'player_collision_sweep_reads_d01a_bound',
    confidence: 'medium',
    summary: 'Player collision sweep paths compare probe coordinate H with _RAM_D01A_ before calling _LABEL_141F_ directly.',
    ramRefs: ['_RAM_D01A_', '_RAM_CB00_'],
    evidence: [
      'ASM lines 3998-4016, 4038-4039, and 4048 show _LABEL_1446_ local sweep code checking _RAM_D01A_ before direct _LABEL_141F_ collision-buffer reads.',
    ],
  },
  {
    label: '_LABEL_1551_',
    offset: 0x01551,
    role: 'coordinate_b_collision_response_reads_d01a_bound',
    confidence: 'medium',
    summary: 'Coordinate-B collision response compares each probe column against _RAM_D01A_ before reading _RAM_CB00_ through _LABEL_141F_.',
    ramRefs: ['_RAM_D01A_', '_RAM_CB00_'],
    evidence: [
      'ASM lines 4135-4140 compare _RAM_D01A_ with H before calling _LABEL_141F_ during coordinate-B collision response.',
    ],
  },
  {
    label: '_LABEL_181D_',
    offset: 0x0181D,
    role: 'actor_coordinate_b_probe_reads_d01a_bound',
    confidence: 'medium',
    summary: 'Generic actor coordinate-B probe checks _RAM_D01A_ before reading a collision cell from _RAM_CB00_.',
    ramRefs: ['_RAM_D01A_', '_RAM_CB00_'],
    evidence: [
      'ASM lines 4448-4451 compare _RAM_D01A_ with H before calling _LABEL_141F_ in the actor coordinate-B contact probe.',
    ],
  },
  {
    label: '_LABEL_186F_',
    offset: 0x0186F,
    role: 'actor_coordinate_a_probe_reads_d01a_bound',
    confidence: 'medium',
    summary: 'Generic actor coordinate-A probe checks _RAM_D01A_ before reading a collision cell from _RAM_CB00_.',
    ramRefs: ['_RAM_D01A_', '_RAM_CB00_'],
    evidence: [
      'ASM lines 4510-4513 compare _RAM_D01A_ with H before calling _LABEL_141F_ in the actor coordinate-A contact probe.',
    ],
  },
  {
    label: '_LABEL_1F47_',
    offset: 0x01F47,
    role: 'player_vector_probe_reads_d01a_bound',
    confidence: 'medium',
    summary: 'Player vector probe checks _RAM_D01A_ before reading a candidate collision cell from _RAM_CB00_.',
    ramRefs: ['_RAM_D01A_', '_RAM_CB00_'],
    evidence: [
      'ASM lines 5472-5488 save candidate coordinates, compare _RAM_D01A_ with H, clamp E into $10-$B0, and call _LABEL_141F_.',
    ],
  },
];

const ramRoles = [
  {
    address: '$D019',
    role: 'dc2_collision_scroll_bound_word_low',
    confidence: 'high',
    summary: 'Low byte of the _RAM_D019_ word alias produced by _LABEL_DC2_ and consumed by camera-scroll clamp _LABEL_FA1_; the high byte at _RAM_D01A_ depends on the active DC2 prefix count for the room recipe.',
  },
  {
    address: '$D01A',
    role: 'dc2_collision_scroll_bound_word_high',
    confidence: 'high',
    summary: 'High byte of the _RAM_D019_ word alias. _LABEL_DC2_ leaves it at activeDc2PrefixCount-1, with $05 only for all-six-stream rooms.',
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

function scanSymbolRefs(asmText, symbol) {
  const lines = asmText.split(/\r?\n/);
  const refs = [];
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].split(';')[0].trim();
    if (!code.includes(symbol)) continue;
    refs.push({ line: i + 1, code });
  }
  return refs;
}

function findCatalog(mapData, id) {
  return Object.keys(mapData)
    .filter(key => Array.isArray(mapData[key]) && /catalog/i.test(key))
    .flatMap(key => mapData[key].map(catalog => ({ bucket: key, catalog })))
    .find(item => item.catalog?.id === id) || null;
}

function buildCatalog(mapData, asmText) {
  const d019Refs = scanSymbolRefs(asmText, '_RAM_D019_');
  const d01aRefs = scanSymbolRefs(asmText, '_RAM_D01A_');
  const directD01aWrites = d01aRefs.filter(ref => /\(_RAM_D01A_\)\s*,/i.test(ref.code));
  const routineEntries = routines.map(routine => ({
    ...routine,
    offset: hex(routine.offset),
    region: regionRef(findContainingRegion(mapData, routine.offset)),
  }));
  const ram = ramRoles.map(role => ({
    ...role,
    ram: ramRef(findRam(mapData, role.address)),
  }));
  const collisionBuffer = findCatalog(mapData, collisionBufferCatalogId);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: {
      collisionBuffer: collisionBuffer ? { id: collisionBufferCatalogId, bucket: collisionBuffer.bucket } : null,
    },
    boundModel: {
      kind: 'recipe_specific_active_dc2_prefix_bound',
      wordAlias: '_RAM_D019_',
      lowByte: '_RAM_D019_',
      highByte: '_RAM_D01A_',
      initialWordBeforeDecodeLoop: '0xFF00',
      perDecodedStreamIncrement: '0x0100',
      maxStreamSlotCount: 6,
      terminatorIndex: '0xFF',
      terminatorEffect: 'The first $FF DC2 index exits _LABEL_DC2_ before incrementing _RAM_D019_ or decoding that slot.',
      activeStreamFormula: 'activeDc2PrefixCount = count of non-$FF room-subrecord DC2 index bytes before the first $FF terminator',
      finalWordFormula: '0xFF00 + activeDc2PrefixCount * 0x0100, modulo 16 bits',
      finalHighByteFormula: 'activeDc2PrefixCount - 1 for rooms with at least one active stream',
      acceptedCellColumnsFormula: 'activeDc2PrefixCount * 16',
      maxFinalWordAfterFullSixStreams: '0x0500',
      maxFinalHighByte: '0x05',
      maxAcceptedHighByteRange: '0x00-0x05',
      cellsPerHighBytePage: 16,
      maxAcceptedCellColumns: 96,
      relatedBuffer: '_RAM_CB00_ $CB00-$CF1F, 11 rows x 96 cells',
    },
    routines: routineEntries,
    ram,
    symbolRefs: {
      d019: d019Refs,
      d01a: d01aRefs,
      directD01aWrites,
    },
    summary: {
      routineCount: routineEntries.length,
      ramRoleCount: ram.length,
      d019SymbolRefCount: d019Refs.length,
      d01aSymbolRefCount: d01aRefs.length,
      directD01aWriteCount: directD01aWrites.length,
      sourceCatalogsPresent: collisionBuffer ? 1 : 0,
      boundModelKind: 'recipe_specific_active_dc2_prefix_bound',
      maxAcceptedCellColumns: 96,
      assetPolicy: 'Metadata only: ASM labels, offsets, RAM aliases, scalar constants, and evidence. No ROM bytes, decoded room cells, graphics, music, text, or gameplay asset payloads are embedded.',
    },
    evidence: [
      'The assembler declares _RAM_D019_ followed immediately by _RAM_D01A_, so word writes to _RAM_D019_ also populate the _RAM_D01A_ high byte.',
      'No direct symbolic write to _RAM_D01A_ appears in the ASM; the bound is produced through word writes to _RAM_D019_.',
      '_LABEL_DC2_ copies six DC2 index bytes but exits the stream loop on the first $FF terminator.',
      '_LABEL_DC2_ increments the _RAM_D019_ word by $0100 only for non-$FF streams decoded before that terminator.',
      '_LABEL_1144_ and direct _LABEL_141F_ call sites compare H with _RAM_D01A_ before reading the _RAM_CB00_ collision/render cell buffer.',
    ],
  };
}

function annotateRegion(region, routine) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.collisionBoundAudit = {
    catalogId,
    kind: routine.role,
    confidence: routine.confidence,
    label: routine.label,
    ramRefs: routine.ramRefs,
    boundModel: {
      wordAlias: '_RAM_D019_',
      highByte: '_RAM_D01A_',
      kind: 'recipe_specific_active_dc2_prefix_bound',
      finalHighByteFormula: 'activeDc2PrefixCount - 1',
      acceptedCellColumnsFormula: 'activeDc2PrefixCount * 16',
      maxFinalHighByte: '0x05',
      maxAcceptedCellColumns: 96,
    },
    summary: routine.summary,
    evidence: routine.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
    label: routine.label,
    role: routine.role,
  };
}

function annotateRam(entry, role) {
  if (!entry) return null;
  entry.analysis = entry.analysis || {};
  entry.analysis.collisionBoundAudit = {
    catalogId,
    kind: role.role,
    confidence: role.confidence,
    wordAlias: '_RAM_D019_',
    boundModelKind: 'recipe_specific_active_dc2_prefix_bound',
    finalWordFormula: '0xFF00 + activeDc2PrefixCount * 0x0100',
    finalHighByteFormula: 'activeDc2PrefixCount - 1',
    acceptedCellColumnsFormula: 'activeDc2PrefixCount * 16',
    maxFinalWordAfterDecodeLoop: '0x0500',
    maxFinalHighByte: '0x05',
    maxAcceptedCellColumns: 96,
    summary: role.summary,
    evidence: [
      'The assembler declares _RAM_D019_ immediately before _RAM_D01A_.',
      '_LABEL_DC2_ writes and increments the _RAM_D019_ word once for each non-$FF DC2 stream decoded before the first terminator, so _RAM_D01A_ receives the recipe-specific high-byte bound.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  if (role.address === '$D019' && (!entry.name || entry.name === 'D019')) {
    entry.name = 'DC2 COLLISION/SCROLL BOUND LOW';
  }
  if (role.address === '$D01A' && (!entry.name || entry.name === 'D01A')) {
    entry.name = 'DC2 COLLISION/SCROLL BOUND HIGH';
  }
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || 'byte',
    name: entry.name || '',
    role: role.role,
  };
}

function applyAnnotations(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  for (const routine of catalog.routines) {
    const region = routine.region?.id ? (mapData.regions || []).find(item => item.id === routine.region.id) : findContainingRegion(mapData, parseInt(routine.offset, 16));
    const annotated = annotateRegion(region, routine);
    if (annotated) annotatedRegions.push(annotated);
  }
  for (const role of catalog.ram) {
    const entry = role.ram?.id ? (mapData.ram || []).find(item => item.id === role.ram.id) : findRam(mapData, role.address);
    const annotated = annotateRam(entry, role);
    if (annotated) annotatedRam.push(annotated);
  }
  return { annotatedRegions, annotatedRam };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  let changes = { annotatedRegions: [], annotatedRam: [] };

  if (apply) {
    changes = applyAnnotations(mapData, catalog);
    mapData.collisionBufferCatalogs = (mapData.collisionBufferCatalogs || []).filter(item => item.id !== catalogId);
    mapData.collisionBufferCatalogs.push(buildCatalog(mapData, asmText));
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'collision_bound_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegions: changes.annotatedRegions.length,
        annotatedRam: changes.annotatedRam.length,
      },
      boundModel: catalog.boundModel,
      annotatedRegions: changes.annotatedRegions,
      annotatedRam: changes.annotatedRam,
      symbolRefs: catalog.symbolRefs,
      evidence: catalog.evidence,
      nextLeads: [
        'Connect each room subrecord DC2 index set to this D019/D01A bound so scene recipes can expose collision-buffer dimensions.',
        'Use the D019 word alias in the analyzer collision overlay to clamp camera scroll and collision-cell sampling consistently.',
        'Trace any non-standard room loaders that bypass _LABEL_DC2_ before assuming every scene has the six-stream $0500 bound.',
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
    },
  }, null, 2));
}

main();
