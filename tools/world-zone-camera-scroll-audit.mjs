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
const catalogId = 'world-zone-camera-scroll-catalog-2026-06-25';
const reportId = 'zone-camera-scroll-audit-2026-06-25';
const toolName = 'tools/world-zone-camera-scroll-audit.mjs';

const sourceCatalogIds = {
  zoneRecipes: 'world-zone-recipe-catalog-2026-06-25',
  zoneCollisionRecipes: 'world-zone-collision-recipe-catalog-2026-06-25',
  collisionBound: 'world-collision-bound-catalog-2026-06-25',
  bank0CoreRuntime: 'world-bank0-core-runtime-catalog-2026-06-25',
};

const routineRoles = [
  {
    label: '_LABEL_2620_',
    offset: 0x02620,
    role: 'room_descriptor_camera_seed_and_room_load',
    confidence: 'high',
    summary: 'Consumes the six-byte room descriptor, seeds _RAM_C243_ from descriptor byte 0 when it is not $FF, loads room assets through _LABEL_26F4_, applies transition-dependent _RAM_C243_ deltas, then calls _LABEL_FA1_.',
    evidence: [
      'ASM lines 6363-6378 multiply descriptor byte 0 by 8 and store it to _RAM_C243_ unless the byte is $FF.',
      'ASM lines 6421-6428 call _LABEL_26F4_, run the local transition adjustment helper, clear actors, and call _LABEL_FA1_.',
      'ASM lines 6446-6470 optionally add or subtract $0100/$0300 from _RAM_C243_ based on transition state before the clamp.',
    ],
  },
  {
    label: '_LABEL_FA1_',
    offset: 0x00FA1,
    role: 'camera_scroll_anchor_clamp',
    confidence: 'high',
    summary: 'Computes the horizontal scroll anchor from _RAM_C243_ - $0080, clamps it between 0 and _RAM_D019_, writes _RAM_D00F_/_RAM_D007_, and mirrors the low byte to _RAM_CF8C_.',
    evidence: [
      'ASM lines 3162-3184 subtract $0080 from _RAM_C243_, clamp to zero or _RAM_D019_, store _RAM_D00F_/_RAM_D007_, and copy L to _RAM_CF8C_.',
    ],
  },
  {
    label: '_LABEL_EB3_',
    offset: 0x00EB3,
    role: 'scroll_column_redraw_target_from_camera_anchor',
    confidence: 'high',
    summary: 'Derives the target rendered column as (_RAM_D00F_ + 7) >> 3, then advances _RAM_D012_ one column at a time and calls _LABEL_EF3_ to redraw columns.',
    evidence: [
      'ASM lines 3023-3033 add 7 to _RAM_D00F_, shift right three times, and store the target column in _RAM_D011_.',
      'ASM lines 3034-3058 compare _RAM_D012_ with _RAM_D011_, step it by one column, set _RAM_D013_, and call _LABEL_EF3_ until caught up.',
    ],
  },
  {
    label: '_LABEL_4BD_',
    offset: 0x004BD,
    role: 'main_gameplay_loop_scroll_refresh_order',
    confidence: 'high',
    summary: 'Main gameplay loop calls _LABEL_FA1_ then _LABEL_EB3_ each frame, and later sets _RAM_CFE1_ so the interrupt scroll-register updater writes the shadow scroll bytes.',
    evidence: [
      'ASM lines 1554-1581 call _LABEL_FA1_, then _LABEL_EB3_, then set _RAM_CFE1_ before looping.',
    ],
  },
  {
    label: '_LABEL_1D1_',
    offset: 0x001D1,
    role: 'vdp_scroll_register_update_from_shadow',
    confidence: 'high',
    summary: 'Interrupt-side helper writes the horizontal and vertical scroll shadow bytes _RAM_CF8C_/_RAM_CF8D_ to VDP scroll registers when _RAM_CFE1_ is set.',
    evidence: [
      'Existing bank0 core runtime audit records _LABEL_1D1_ as writing VDP scroll registers from _RAM_CF8C_/_RAM_CF8D_ and clearing _RAM_CFE1_.',
    ],
  },
];

const ramRoles = [
  { address: '$C243', role: 'player_or_camera_subject_world_x_word', type: 'word' },
  { address: '$D019', role: 'camera_scroll_max_word_low_alias', type: 'word_alias_low' },
  { address: '$D01A', role: 'camera_scroll_max_word_high_alias', type: 'word_alias_high' },
  { address: '$D00F', role: 'camera_scroll_anchor_word', type: 'word' },
  { address: '$D007', role: 'camera_scroll_anchor_mirror_low_alias', type: 'word_alias_low' },
  { address: '$D008', role: 'camera_scroll_anchor_mirror_high_alias', type: 'word_alias_high' },
  { address: '$D011', role: 'scroll_redraw_target_column', type: 'byte' },
  { address: '$D012', role: 'scroll_redraw_current_column', type: 'byte' },
  { address: '$D013', role: 'dc2_render_column_index', type: 'byte' },
  { address: '$CF8C', role: 'vdp_horizontal_scroll_shadow_low_byte', type: 'byte' },
  { address: '$CFE1', role: 'vdp_scroll_register_update_request', type: 'byte' },
];

const transitionCameraDeltaModes = [
  { opcodeIndex: 0x16, rawOpcode: '0x16', deltaWord: '0x0100', signedDeltaPixels: 0x0100, transitionTableTarget: '_LABEL_4CED_', meaning: 'positive one-page camera seed adjustment before _LABEL_FA1_' },
  { opcodeIndex: 0x17, rawOpcode: '0x17', deltaWord: '0x0300', signedDeltaPixels: 0x0300, transitionTableTarget: '_LABEL_4CED_', meaning: 'positive three-page camera seed adjustment before _LABEL_FA1_' },
  { opcodeIndex: 0x18, rawOpcode: '0x18', deltaWord: '0xFF00', signedDeltaPixels: -0x0100, transitionTableTarget: '_LABEL_4CED_', meaning: 'negative one-page camera seed adjustment before _LABEL_FA1_' },
  { opcodeIndex: 0x19, rawOpcode: '0x19', deltaWord: '0xFD00', signedDeltaPixels: -0x0300, transitionTableTarget: '_LABEL_4CED_', meaning: 'negative three-page camera seed adjustment before _LABEL_FA1_' },
];

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

function descriptorInitialWorldX(recipe) {
  const scrollX = recipe.descriptor?.scroll?.x || null;
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
    word: pixels == null ? null : hexWord(pixels),
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
    assumption: 'No transition adjustment from ASM lines 6446-6470 has been applied.',
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

function buildCameraScrollDependency(recipe, sourceCatalogs) {
  const collisionBuffer = recipe.dependencies?.collisionBuffer || null;
  const maxBoundWord = collisionBuffer?.finalBoundWord || null;
  const maxBound = maxBoundWord ? parseInt(maxBoundWord, 16) : null;
  const initialWorldX = descriptorInitialWorldX(recipe);
  const nominal = maxBound == null ? null : nominalAnchor(initialWorldX, maxBound);
  const warnings = [];
  if (!collisionBuffer) warnings.push('Missing dependencies.collisionBuffer; cannot bind camera clamp to the recipe-specific _RAM_D019_ max.');
  if (!initialWorldX.known) warnings.push('Descriptor scroll X is keep/missing, so the room-load initial _RAM_C243_ value depends on prior state.');

  return {
    kind: 'camera_scroll_anchor_from_room_recipe',
    catalogId,
    sourceCatalogs,
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
    nominalInitialAnchor: nominal,
    warnings,
    confidence: collisionBuffer ? 'high' : 'medium',
    evidence: [
      'ASM lines 6363-6378 seed _RAM_C243_ from descriptor byte 0 multiplied by 8 when the byte is not $FF.',
      'ASM lines 6421-6428 load room assets, apply transition adjustment, clear actors, call _LABEL_FA1_, then call _LABEL_E83_.',
      'ASM lines 3162-3184 implement the _RAM_C243_ - $0080 clamp against _RAM_D019_ and store _RAM_D00F_/_RAM_D007_/_RAM_CF8C_.',
      'ASM lines 3023-3058 derive redraw columns from _RAM_D00F_ and call _LABEL_EF3_.',
      'The recipe collisionBuffer dependency supplies the recipe-specific _RAM_D019_ bound from active DC2 stream count.',
    ],
    assetPolicy: 'Metadata only: formulas, offsets, RAM labels, scalar bounds, descriptor bytes, and evidence. No ROM bytes, decoded cells, graphics, music, text, or rendered assets are embedded.',
  };
}

function updateRenderPipeline(recipe) {
  recipe.renderPipeline = recipe.renderPipeline || [];
  const existing = recipe.renderPipeline.find(step => step.kind === 'camera_scroll_anchor');
  const replacement = {
    order: 5,
    kind: 'camera_scroll_anchor',
    source: '_LABEL_FA1_ clamps _RAM_C243_ against _RAM_D019_ and seeds _RAM_D00F_/_RAM_CF8C_',
    dependency: 'dependencies.cameraScroll',
  };
  if (existing) {
    Object.assign(existing, replacement);
    return;
  }
  for (const step of recipe.renderPipeline) {
    if (typeof step.order === 'number' && step.order >= 5) step.order += 1;
  }
  recipe.renderPipeline.push(replacement);
  recipe.renderPipeline.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

function summarizeRecipe(recipe, dependency) {
  return {
    id: recipe.id,
    sourceDescriptorId: recipe.sourceDescriptorId || null,
    descriptorOffset: recipe.descriptor?.romOffset || null,
    descriptorRegion: recipe.descriptor?.region || null,
    descriptorScrollX: dependency.descriptorInitialWorldX,
    activeDc2PrefixCount: dependency.collisionBufferRef?.activeDc2PrefixCount ?? null,
    acceptedCellColumns: dependency.collisionBufferRef?.acceptedCellColumns ?? null,
    maxScrollAnchorWord: dependency.collisionBufferRef?.finalBoundWord ?? null,
    finalHighByte: dependency.collisionBufferRef?.finalHighByte ?? null,
    nominalInitialAnchor: dependency.nominalInitialAnchor,
    warningCount: dependency.warnings.length,
    confidence: dependency.confidence,
  };
}

function histogramObject(histogram) {
  return Object.fromEntries([...histogram.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))
    .map(([key, value]) => [String(key), value]));
}

function buildCatalog(mapData, recipes, dependencies, sourceCatalogs) {
  const summaries = recipes.map((recipe, index) => summarizeRecipe(recipe, dependencies[index]));
  const clampCases = new Map();
  const widthCounts = new Map();
  let descriptorScrollSetCount = 0;
  let descriptorScrollKeepCount = 0;
  let nominalInitialKnownCount = 0;
  let warningRecipeCount = 0;
  for (const summary of summaries) {
    if (summary.descriptorScrollX.known) descriptorScrollSetCount++;
    else descriptorScrollKeepCount++;
    if (summary.nominalInitialAnchor) {
      nominalInitialKnownCount++;
      const key = summary.nominalInitialAnchor.clampCase;
      clampCases.set(key, (clampCases.get(key) || 0) + 1);
    }
    if (summary.acceptedCellColumns != null) {
      widthCounts.set(summary.acceptedCellColumns, (widthCounts.get(summary.acceptedCellColumns) || 0) + 1);
    }
    if (summary.warningCount) warningRecipeCount++;
  }

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
      recipeCount: recipes.length,
      descriptorScrollSetCount,
      descriptorScrollKeepCount,
      nominalInitialKnownCount,
      warningRecipeCount,
      routineCount: routines.length,
      ramRoleCount: ram.length,
      nominalClampCaseCounts: histogramObject(clampCases),
      acceptedCellColumnsHistogram: histogramObject(widthCounts),
      assetPolicy: 'Metadata only: camera formulas, recipe ids, descriptor scalar values, RAM labels, routine labels, and evidence. No ROM bytes, decoded cells, graphics, music, text, or rendered assets are embedded.',
    },
    runtimeModel: {
      roomLoadSeed: '_LABEL_2620_ writes _RAM_C243_ = descriptor byte0 * 8 unless descriptor byte0 is $FF.',
      transitionAdjustment: '_LABEL_2620_ adds $0100/$0300/$FF00/$FD00 to _RAM_C243_ only for (_RAM_C26E_ & $3F) values $16/$17/$18/$19 before _LABEL_FA1_; otherwise the transition delta is zero.',
      cameraAnchorFormula: '_RAM_D00F_ = clamp(_RAM_C243_ - 0x0080, 0x0000, _RAM_D019_)',
      horizontalScrollShadowFormula: '_RAM_CF8C_ = low(_RAM_D00F_)',
      redrawTargetColumnFormula: '_RAM_D011_ = (_RAM_D00F_ + 7) >> 3',
      boundSource: 'Recipe dependencies.collisionBuffer.finalBoundWord from active DC2 prefix count.',
    },
    routines,
    ram,
    recipeScrollSummaries: summaries,
    recipeSamples: summaries.slice(0, 20),
    evidence: [
      'Room descriptors, zoneRecipes, and collisionBuffer dependencies supply the per-room scalar inputs.',
      '_LABEL_2620_ seeds _RAM_C243_, calls the room asset/DC2 loader, applies transition-dependent _RAM_C243_ deltas, and calls _LABEL_FA1_.',
      '_LABEL_FA1_ clamps the runtime camera anchor against _RAM_D019_, whose value is recipe-specific after _LABEL_DC2_.',
      '_LABEL_EB3_ turns the camera anchor into redraw columns, linking camera state to the DC2 visual renderer.',
    ],
  };
}

function annotateRegion(region, entry, kind) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.zoneCameraScrollAudit = {
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

function annotateDescriptorRegions(mapData, summaries) {
  const groups = new Map();
  for (const summary of summaries) {
    const region = summary.descriptorRegion?.id
      ? (mapData.regions || []).find(item => item.id === summary.descriptorRegion.id)
      : summary.descriptorOffset
        ? findContainingRegion(mapData, parseInt(summary.descriptorOffset, 16))
        : null;
    if (!region) continue;
    const group = groups.get(region.id) || { region, summaries: [] };
    group.summaries.push(summary);
    groups.set(region.id, group);
  }

  const annotated = [];
  for (const group of groups.values()) {
    const clampCases = new Map();
    let known = 0;
    let keep = 0;
    for (const summary of group.summaries) {
      if (summary.descriptorScrollX.known) known++;
      else keep++;
      const clampCaseName = summary.nominalInitialAnchor?.clampCase || 'unknown_prior_state';
      clampCases.set(clampCaseName, (clampCases.get(clampCaseName) || 0) + 1);
    }
    group.region.analysis = group.region.analysis || {};
    group.region.analysis.zoneCameraScrollDescriptorAudit = {
      catalogId,
      kind: 'zone_descriptor_camera_scroll_source',
      confidence: 'high',
      descriptorCount: group.summaries.length,
      descriptorScrollSetCount: known,
      descriptorScrollKeepCount: keep,
      nominalClampCaseCounts: histogramObject(clampCases),
      sampleDescriptors: group.summaries.slice(0, 12).map(summary => ({
        id: summary.id,
        descriptorOffset: summary.descriptorOffset,
        descriptorScrollX: summary.descriptorScrollX,
        maxScrollAnchorWord: summary.maxScrollAnchorWord,
        nominalInitialAnchor: summary.nominalInitialAnchor,
      })),
      summary: 'Descriptors in this region now have metadata-only camera scroll seed/clamp summaries linked to _LABEL_2620_ and _LABEL_FA1_.',
      evidence: [
        'Zone recipe descriptor scroll.x supplies the byte consumed at ASM lines 6363-6378.',
        '_LABEL_FA1_ consumes _RAM_C243_ and _RAM_D019_ to produce _RAM_D00F_/_RAM_CF8C_.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: group.region.id,
      offset: group.region.offset,
      size: group.region.size || 0,
      type: group.region.type || 'unknown',
      name: group.region.name || '',
      descriptorCount: group.summaries.length,
      descriptorScrollSetCount: known,
      descriptorScrollKeepCount: keep,
      nominalClampCaseCounts: histogramObject(clampCases),
    });
  }
  return annotated;
}

function annotateRam(entry, role, catalog) {
  if (!entry) return null;
  entry.analysis = entry.analysis || {};
  entry.analysis.zoneCameraScrollAudit = {
    catalogId,
    kind: role.role,
    confidence: 'high',
    runtimeModel: catalog.runtimeModel,
    summary: 'RAM role participates in the room camera/scroll path from descriptor _RAM_C243_ seed through _LABEL_FA1_ clamp and _LABEL_EB3_ column redraw.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  if (role.address === '$D00F' && (!entry.name || entry.name === 'D00F')) entry.name = 'CAMERA SCROLL ANCHOR WORD';
  if (role.address === '$D007' && (!entry.name || entry.name === 'D007')) entry.name = 'CAMERA SCROLL ANCHOR MIRROR LOW';
  if (role.address === '$D008' && (!entry.name || entry.name === 'D008')) entry.name = 'CAMERA SCROLL ANCHOR MIRROR HIGH';
  if (role.address === '$D011' && (!entry.name || entry.name === 'D011')) entry.name = 'SCROLL REDRAW TARGET COLUMN';
  if (role.address === '$D012' && (!entry.name || entry.name === 'D012')) entry.name = 'SCROLL REDRAW CURRENT COLUMN';
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
  for (const routine of catalog.routines) {
    const region = routine.region?.id
      ? (mapData.regions || []).find(item => item.id === routine.region.id)
      : findContainingRegion(mapData, parseInt(routine.offset, 16));
    const annotated = annotateRegion(region, routine, 'camera_scroll_routine');
    if (annotated) annotatedRegions.push(annotated);
  }
  const annotatedDescriptorRegions = annotateDescriptorRegions(mapData, catalog.recipeScrollSummaries);
  const annotatedRam = [];
  for (const role of catalog.ram) {
    const entry = role.ram?.id ? (mapData.ram || []).find(item => item.id === role.ram.id) : findRam(mapData, role.address);
    const annotated = annotateRam(entry, role, catalog);
    if (annotated) annotatedRam.push(annotated);
  }
  return { annotatedRegions, annotatedDescriptorRegions, annotatedRam };
}

function main() {
  const mapData = readJson(mapPath);
  const recipes = mapData.zoneRecipes || [];
  if (!recipes.length) {
    console.error('Missing mapData.zoneRecipes. Run tools/world-zone-recipe-audit.mjs --apply first.');
    process.exit(1);
  }

  const sourceCatalogs = sourceCatalogRefs(mapData);
  const dependencies = recipes.map(recipe => buildCameraScrollDependency(recipe, sourceCatalogs));
  const catalog = buildCatalog(mapData, recipes, dependencies, sourceCatalogs);
  let changes = { annotatedRegions: [], annotatedDescriptorRegions: [], annotatedRam: [] };

  if (apply) {
    for (let i = 0; i < recipes.length; i++) {
      recipes[i].dependencies = recipes[i].dependencies || {};
      recipes[i].dependencies.cameraScroll = dependencies[i];
      updateRenderPipeline(recipes[i]);
    }
    changes = applyAnnotations(mapData, catalog);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_camera_scroll_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegions: changes.annotatedRegions.length,
        annotatedDescriptorRegions: changes.annotatedDescriptorRegions.length,
        annotatedRam: changes.annotatedRam.length,
      },
      sourceCatalogs,
      runtimeModel: catalog.runtimeModel,
      recipeSamples: catalog.recipeSamples,
      annotatedRegions: changes.annotatedRegions,
      annotatedDescriptorRegions: changes.annotatedDescriptorRegions,
      annotatedRam: changes.annotatedRam,
      evidence: catalog.evidence,
      nextLeads: [
        'Use dependencies.cameraScroll in the analyzer to show camera anchor, nominal redraw column, and scroll-shadow provenance per room recipe.',
        'Trace transition state _RAM_C26E_/_RAM_C24F_/_RAM_C260_ to resolve the conditional +/-$0100/$0300 _RAM_C243_ adjustment for door transitions.',
        'Join _LABEL_EB3_ redraw columns with local _RAM_CB00_ decode output to preview which columns are refreshed as the camera moves.',
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
      annotatedDescriptorRegions: changes.annotatedDescriptorRegions.length,
      annotatedRam: changes.annotatedRam.length,
    },
    runtimeModel: catalog.runtimeModel,
    firstRecipes: catalog.recipeSamples.slice(0, 5),
  }, null, 2));
}

main();
