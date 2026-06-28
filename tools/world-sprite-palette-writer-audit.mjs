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
const catalogId = 'world-sprite-palette-writer-catalog-2026-06-25';
const reportId = 'sprite-palette-writer-audit-2026-06-25';
const toolName = 'tools/world-sprite-palette-writer-audit.mjs';

const paletteTableCatalogId = 'world-palette-table-catalog-2026-06-24';
const spritePaletteInheritanceCatalogId = 'world-sprite-palette-inheritance-catalog-2026-06-25';
const spritePaletteEntrySceneCatalogId = 'world-sprite-palette-entry-scene-catalog-2026-06-25';

const entrySeedLabels = new Set(['_LABEL_3F8_', '_LABEL_508_', '_LABEL_B3D3_']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  return parseInt(value.replace(/^0x/i, ''), 16);
}

function offsetOf(region) {
  return parseOffset(region.offset);
}

function findContainingRegion(mapData, offset) {
  if (offset == null) return null;
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
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

function callsiteId(callsite) {
  const label = (callsite.callerLabel || 'unknown').replace(/^_LABEL_|_$/g, '');
  return `sprite_palette_writer_${label}_${callsite.line}`;
}

function recordRef(paletteCatalog, index) {
  if (index == null || index === 0xFF) return null;
  const record = (paletteCatalog.records || []).find(item => item.index === index);
  if (!record) {
    return {
      index,
      indexHex: hex(index, 2),
      found: false,
    };
  }
  return {
    index: record.index,
    indexHex: hex(record.index, 2),
    offset: record.offset,
    size: record.size,
    kind: record.kind,
    region: record.region || null,
    confidence: record.confidence || 'medium',
    found: true,
  };
}

function paletteStateFromDirect(which, index, state, source, paletteCatalog) {
  const ram = which === 'bg' ? '_RAM_CFF5_' : '_RAM_CFF6_';
  const destRam = which === 'bg' ? '_RAM_CF9B_' : '_RAM_CFAB_';
  if (state === 'keep_existing') {
    return {
      status: 'preserve_existing',
      indexSentinel: '0xFF',
      ram,
      destRam,
      sourceRegister: source?.register || (which === 'bg' ? 'l' : 'h'),
      sourceLine: source?.line || null,
    };
  }
  if (state === 'table_record') {
    return {
      status: 'set_direct_index',
      index,
      indexHex: hex(index, 2),
      ram,
      destRam,
      sourceRegister: source?.register || (which === 'bg' ? 'l' : 'h'),
      sourceLine: source?.line || null,
      record: recordRef(paletteCatalog, index),
    };
  }
  return {
    status: 'out_of_range_or_unresolved',
    index,
    indexHex: index == null ? null : hex(index, 2),
    ram,
    destRam,
    sourceRegister: source?.register || (which === 'bg' ? 'l' : 'h'),
    sourceLine: source?.line || null,
  };
}

function paletteStateFromDynamic(which, callsite) {
  const ram = which === 'bg' ? '_RAM_CFF5_' : '_RAM_CFF6_';
  const destRam = which === 'bg' ? '_RAM_CF9B_' : '_RAM_CFAB_';
  const source = which === 'bg' ? callsite.preparedPair?.bgSource : callsite.preparedPair?.spriteSource;
  const context = callsite.dynamicContext || {};
  if (context.kind === 'room_subrecord_bg_palette_preserve_sprite' && which === 'bg') {
    return {
      status: 'set_dynamic_room_subrecord_index',
      ram,
      destRam,
      sourceRegister: source?.register || 'l',
      sourceLine: source?.line || null,
      source: context.bgSource,
      mask: '0x3F',
    };
  }
  if (context.kind === 'room_subrecord_bg_palette_preserve_sprite' && which === 'sprite') {
    return {
      status: 'preserve_existing',
      indexSentinel: '0xFF',
      ram,
      destRam,
      sourceRegister: source?.register || 'h',
      sourceLine: source?.line || null,
      source: context.spriteSource,
    };
  }
  if (context.kind === 'cached_palette_pair_restore') {
    return {
      status: 'restore_cached_index',
      ram,
      destRam,
      sourceRegister: source?.register || (which === 'bg' ? 'l' : 'h'),
      sourceLine: source?.line || null,
      source: which === 'bg' ? context.bgSource : context.spriteSource,
      cacheRam: '_RAM_CFF1_',
    };
  }
  return {
    status: 'dynamic_unclassified',
    ram,
    destRam,
    sourceRegister: source?.register || (which === 'bg' ? 'l' : 'h'),
    sourceLine: source?.line || null,
    source: which === 'bg' ? context.bgSource : context.spriteSource,
  };
}

function roleForCallsite(callsite, region) {
  const label = callsite.callerLabel;
  const name = region?.name || '';
  if (label === '_LABEL_2CF_') {
    return {
      contextRole: 'state_change_dispatcher_palette_pair',
      contextFamily: 'state_dispatch',
      evidence: 'Containing region is named STATE CHANGE DISPATCHER.',
    };
  }
  if (label === '_LABEL_348_') {
    return {
      contextRole: 'title_screen_loop_palette_pair',
      contextFamily: 'title',
      evidence: 'Containing region is named TITLE SCREEN LOOP.',
    };
  }
  if (label === '_LABEL_385_') {
    return {
      contextRole: 'title_screen_palette_pair',
      contextFamily: 'title',
      evidence: 'Containing region is named TITLE SCREEN.',
    };
  }
  if (label === '_LABEL_3F8_') {
    return {
      contextRole: 'game_entry_room_seed_sprite_palette',
      contextFamily: 'room_entry_seed',
      evidence: 'Sprite-palette entry-scene catalog models this callsite before room loading.',
    };
  }
  if (label === '_LABEL_508_') {
    return {
      contextRole: 'demo_game_entry_room_seed_sprite_palette',
      contextFamily: 'room_entry_seed',
      evidence: 'Sprite-palette entry-scene catalog models this callsite before room loading.',
    };
  }
  if (label === '_LABEL_26F4_') {
    return {
      contextRole: 'room_subrecord_bg_palette_preserve_sprite',
      contextFamily: 'room_asset_loader',
      evidence: 'Palette-table catalog classifies this dynamic HL setup as room-subrecord BG palette with H=$FF sprite preserve.',
    };
  }
  if (label === '_LABEL_28E1_') {
    return {
      contextRole: 'menu_close_cached_palette_restore',
      contextFamily: 'cached_restore',
      evidence: 'Palette-table catalog classifies this dynamic HL setup as _RAM_CFF1_ cached palette restore.',
    };
  }
  if (label === '_LABEL_2D50_') {
    return {
      contextRole: 'shop_menu_initial_renderer_palette_pair',
      contextFamily: 'shop_menu',
      evidence: `Containing region is named ${name || '_LABEL_2D50_ shop/menu initial renderer'}.`,
    };
  }
  if (label === '_LABEL_2DE1_') {
    return {
      contextRole: 'shop_menu_page_clear_palette_pair',
      contextFamily: 'shop_menu',
      evidence: `Containing region is named ${name || '_LABEL_2DE1_ shop/menu page clear entry'}.`,
    };
  }
  if (label === '_LABEL_332D_') {
    return {
      contextRole: 'equipment_menu_palette_pair',
      contextFamily: 'equipment_menu',
      evidence: `Containing region is named ${name || '_LABEL_332D_ equipment menu screen renderer'}.`,
    };
  }
  if (label === '_LABEL_39AA_') {
    return {
      contextRole: 'shop_purchase_screen_palette_pair',
      contextFamily: 'shop_menu',
      evidence: `Containing region is named ${name || '_LABEL_39AA_ shop purchase screen renderer'}.`,
    };
  }
  if (label === '_LABEL_3ACF_') {
    return {
      contextRole: 'password_display_screen_palette_pair',
      contextFamily: 'password_menu',
      evidence: `Containing region is named ${name || '_LABEL_3ACF_ password display screen controller'}.`,
    };
  }
  if (label === '_LABEL_423A_') {
    return {
      contextRole: 'continue_new_game_screen_palette_pair',
      contextFamily: 'continue_new_game',
      evidence: `Containing region is named ${name || 'CONTINUE + NEW GAME SCREEN LOADER'}.`,
    };
  }
  if (label === '_LABEL_468D_') {
    return {
      contextRole: 'continue_result_screen_palette_pair',
      contextFamily: 'continue_new_game',
      evidence: `Containing region is named ${name || '_LABEL_468D_ continue result screen sequence'}.`,
    };
  }
  if (label === '_LABEL_4DBA_') {
    return {
      contextRole: 'room_transition_menu_context_cached_palette_restore',
      contextFamily: 'cached_restore',
      evidence: 'Palette-table catalog classifies this dynamic HL setup as _RAM_CFF1_ cached palette restore.',
    };
  }
  if (label === '_LABEL_B3D3_') {
    return {
      contextRole: 'new_game_transition_room_seed_sprite_palette',
      contextFamily: 'room_entry_seed',
      evidence: 'Sprite-palette entry-scene catalog models this callsite before room loading.',
    };
  }
  if (label === '_LABEL_1E200_') {
    return {
      contextRole: 'bank7_entity_sequence_palette_pair',
      contextFamily: 'bank7_entity_sequence',
      evidence: `Containing region is named ${name || '_LABEL_1E200_ bank-7 entity sequence controller'}.`,
    };
  }
  return {
    contextRole: 'unclassified_palette_writer',
    contextFamily: 'unclassified',
    evidence: name ? `Containing region is named ${name}.` : 'No context-specific classification is available yet.',
  };
}

function actionForCallsite(callsite) {
  if (callsite.directIndexPair) {
    const pair = callsite.directIndexPair;
    if (pair.bgState === 'keep_existing' && pair.spriteState === 'table_record') {
      return 'set_direct_sprite_palette_preserve_bg';
    }
    if (pair.bgState === 'table_record' && pair.spriteState === 'table_record') {
      return 'set_direct_palette_pair';
    }
    return 'set_direct_palette_state';
  }
  if (callsite.dynamicContext?.kind === 'room_subrecord_bg_palette_preserve_sprite') {
    return 'set_dynamic_bg_palette_preserve_sprite';
  }
  if (callsite.dynamicContext?.kind === 'cached_palette_pair_restore') {
    return 'restore_cached_palette_pair';
  }
  return 'dynamic_palette_state';
}

function buildWriter(mapData, paletteCatalog, callsite) {
  const callerOffset = parseOffset(callsite.callerOffset);
  const region = findContainingRegion(mapData, callerOffset);
  const role = roleForCallsite(callsite, region);
  const direct = callsite.directIndexPair;
  const writer = {
    id: callsiteId(callsite),
    routine: {
      label: '_LABEL_8B2_',
      offset: '0x008B2',
      catalogId: paletteTableCatalogId,
    },
    caller: {
      label: callsite.callerLabel,
      offset: callsite.callerOffset,
      line: callsite.line,
      region: regionRef(region),
    },
    action: actionForCallsite(callsite),
    contextRole: role.contextRole,
    contextFamily: role.contextFamily,
    confidence: direct ? 'high' : (callsite.dynamicContext?.confidence || 'medium'),
    preparedPair: callsite.preparedPair || null,
    dynamicContext: callsite.dynamicContext || null,
    stateEffects: direct ? {
      rawHL: direct.rawHL,
      bgPalette: paletteStateFromDirect('bg', direct.bgIndex, direct.bgState, callsite.preparedPair?.bgSource, paletteCatalog),
      spritePalette: paletteStateFromDirect('sprite', direct.spriteIndex, direct.spriteState, callsite.preparedPair?.spriteSource, paletteCatalog),
    } : {
      rawHL: null,
      bgPalette: paletteStateFromDynamic('bg', callsite),
      spritePalette: paletteStateFromDynamic('sprite', callsite),
    },
    evidence: [
      ...(callsite.evidence || []),
      role.evidence,
      '_LABEL_8B2_ treats L as BG palette index and H as sprite palette index; 0xFF preserves the existing side.',
    ],
  };
  if (entrySeedLabels.has(callsite.callerLabel)) {
    writer.entrySceneSeed = {
      catalogId: spritePaletteEntrySceneCatalogId,
      status: 'modeled_as_reusable_scene_prereq',
      evidence: 'Entry-scene catalog derives reusable pre-room state from this direct sprite-palette writer.',
    };
  }
  return writer;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (key == null || key === '') continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sortedNumericKeys(counts) {
  return Object.keys(counts).map(Number).sort((a, b) => a - b);
}

function buildDirectGroups(writers, paletteCatalog, side) {
  const groups = new Map();
  for (const writer of writers) {
    const state = side === 'bg' ? writer.stateEffects.bgPalette : writer.stateEffects.spritePalette;
    if (state?.status !== 'set_direct_index') continue;
    const list = groups.get(state.index) || [];
    list.push({
      writerId: writer.id,
      caller: writer.caller,
      action: writer.action,
      contextRole: writer.contextRole,
      contextFamily: writer.contextFamily,
      sourceLine: state.sourceLine,
    });
    groups.set(state.index, list);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([index, uses]) => ({
    index,
    indexHex: hex(index, 2),
    record: recordRef(paletteCatalog, index),
    useCount: uses.length,
    uses,
  }));
}

function buildCatalog(mapData) {
  const paletteCatalog = findCatalog(mapData, paletteTableCatalogId);
  if (!paletteCatalog) throw new Error(`Missing source catalog ${paletteTableCatalogId}`);
  const inheritanceCatalog = findCatalog(mapData, spritePaletteInheritanceCatalogId);
  const entrySceneCatalog = findCatalog(mapData, spritePaletteEntrySceneCatalogId);

  const writers = (paletteCatalog.callsites || []).map(callsite => buildWriter(mapData, paletteCatalog, callsite));
  const directWriters = writers.filter(writer => writer.stateEffects.spritePalette?.status === 'set_direct_index');
  const directPairWriters = writers.filter(writer => writer.action === 'set_direct_palette_pair');
  const directSpritePreserveBgWriters = writers.filter(writer => writer.action === 'set_direct_sprite_palette_preserve_bg');
  const dynamicWriters = writers.filter(writer => writer.action.startsWith('set_dynamic') || writer.action.startsWith('restore_cached') || writer.action === 'dynamic_palette_state');
  const dynamicBgPreserveSprite = writers.filter(writer => writer.action === 'set_dynamic_bg_palette_preserve_sprite');
  const cachedRestoreWriters = writers.filter(writer => writer.action === 'restore_cached_palette_pair');
  const directEntrySeedWriters = writers.filter(writer => entrySeedLabels.has(writer.caller.label));
  const outOfRangeDirectWriters = writers.filter(writer => (
    writer.stateEffects.bgPalette?.status === 'out_of_range_or_unresolved' ||
    writer.stateEffects.spritePalette?.status === 'out_of_range_or_unresolved'
  ));

  const directSpriteIndexUseCounts = countBy(directWriters, writer => writer.stateEffects.spritePalette.index);
  const directBgIndexUseCounts = countBy(writers, writer => {
    const state = writer.stateEffects.bgPalette;
    return state?.status === 'set_direct_index' ? state.index : null;
  });

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      paletteTableCatalogId,
      ...(inheritanceCatalog ? [spritePaletteInheritanceCatalogId] : []),
      ...(entrySceneCatalog ? [spritePaletteEntrySceneCatalogId] : []),
    ],
    summary: {
      totalPaletteLoaderCallsites: writers.length,
      directCallsiteCount: writers.filter(writer => writer.stateEffects.rawHL).length,
      dynamicCallsiteCount: writers.filter(writer => !writer.stateEffects.rawHL).length,
      directPalettePairWriterCount: directPairWriters.length,
      directSpritePreserveBgWriterCount: directSpritePreserveBgWriters.length,
      directSpriteWriterCount: directWriters.length,
      directEntrySeedWriterCount: directEntrySeedWriters.length,
      nonEntryDirectSpriteWriterCount: directWriters.length - directEntrySeedWriters.filter(writer => writer.stateEffects.spritePalette?.status === 'set_direct_index').length,
      dynamicBgPreserveSpriteWriterCount: dynamicBgPreserveSprite.length,
      cachedRestoreWriterCount: cachedRestoreWriters.length,
      outOfRangeDirectWriterCount: outOfRangeDirectWriters.length,
      uniqueDirectSpritePaletteIndexes: sortedNumericKeys(directSpriteIndexUseCounts),
      directSpriteIndexUseCounts,
      uniqueDirectBgPaletteIndexes: sortedNumericKeys(directBgIndexUseCounts),
      directBgIndexUseCounts,
      contextFamilyCounts: countBy(writers, writer => writer.contextFamily),
      actionCounts: countBy(writers, writer => writer.action),
      bgPaletteStateRam: '_RAM_CFF5_',
      spritePaletteStateRam: '_RAM_CFF6_',
      bgPaletteBufferRam: '_RAM_CF9B_',
      spritePaletteBufferRam: '_RAM_CFAB_',
      confidence: outOfRangeDirectWriters.length === 0 && writers.length === (paletteCatalog.summary?.directCallsites || 0) + (paletteCatalog.summary?.dynamicCallsites || 0) ? 'high' : 'medium',
      assetPolicy: 'Metadata only: ASM labels, line numbers, offsets, region ids, palette record indices, RAM names, and writer classifications. No palette bytes, decoded colors, graphics, or rendered assets are embedded.',
    },
    runtimeStateModel: {
      routine: {
        label: '_LABEL_8B2_',
        offset: '0x008B2',
        sourceCatalogId: paletteTableCatalogId,
      },
      bgPalette: {
        indexRegister: 'L',
        stateRam: '_RAM_CFF5_',
        destinationRam: '_RAM_CF9B_',
        preserveSentinel: '0xFF',
      },
      spritePalette: {
        indexRegister: 'H',
        stateRam: '_RAM_CFF6_',
        destinationRam: '_RAM_CFAB_',
        preserveSentinel: '0xFF',
      },
      cacheRestore: {
        cacheRam: '_RAM_CFF1_',
        restoredBy: cachedRestoreWriters.map(writer => writer.id),
      },
      roomSubrecordPreserveSprite: {
        writerIds: dynamicBgPreserveSprite.map(writer => writer.id),
        bgSource: 'room subrecord flags/palette byte masked with 0x3F',
        spriteState: 'preserve existing _RAM_CFF6_',
      },
      evidence: [
        'Palette-table catalog confirms _LABEL_8B2_ copies BG and sprite records from _DATA_1C5B0_ using L/H indexes.',
        'Direct callsites provide immediate HL constants; dynamic callsites either preserve sprite while loading room BG or restore a cached BG/SPR pair.',
      ],
    },
    directSpriteWriterGroups: buildDirectGroups(writers, paletteCatalog, 'sprite'),
    directBgWriterGroups: buildDirectGroups(writers, paletteCatalog, 'bg'),
    writerCallsites: writers,
    evidence: [
      `Source catalog ${paletteTableCatalogId} scans every _LABEL_8B2_ callsite and records immediate/dynamic HL preparation.`,
      `Source catalog ${spritePaletteInheritanceCatalogId} confirms the room renderer preserves sprite palette state for zone and inline-transition recipes.`,
      `Source catalog ${spritePaletteEntrySceneCatalogId} identifies the direct sprite-palette entry seeds that can initialize reusable pre-room state.`,
    ],
    nextLeads: [
      'Connect non-room direct palette-pair writers to explicit scene recipes for title, shop, equipment, password, continue, and bank-7 entity sequences.',
      'Trace _LABEL_1E200_ to determine whether its palette pair belongs to a cutscene, entity sequence, or bank-7 gameplay transition.',
      'Carry this writer catalog into analyzer diagnostics so each rendered scene can explain whether sprite CRAM was seeded, preserved, or restored.',
    ],
  };
}

function annotateRegions(mapData, catalog) {
  const byRegion = new Map();
  for (const writer of catalog.writerCallsites) {
    const regionId = writer.caller.region?.id;
    if (!regionId) continue;
    const list = byRegion.get(regionId) || [];
    list.push(writer);
    byRegion.set(regionId, list);
  }

  const annotated = [];
  for (const [regionId, writers] of byRegion.entries()) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.spritePaletteWriterAudit = {
      catalogId,
      writerCallsiteIds: writers.map(writer => writer.id),
      contextRoles: [...new Set(writers.map(writer => writer.contextRole))],
      contextFamilies: [...new Set(writers.map(writer => writer.contextFamily))],
      actions: [...new Set(writers.map(writer => writer.action))],
      directSpritePaletteIndexes: [...new Set(writers
        .map(writer => writer.stateEffects.spritePalette)
        .filter(state => state?.status === 'set_direct_index')
        .map(state => state.index))]
        .sort((a, b) => a - b),
      dynamicStateEffects: writers
        .filter(writer => !writer.stateEffects.rawHL)
        .map(writer => ({
          writerId: writer.id,
          action: writer.action,
          bgStatus: writer.stateEffects.bgPalette?.status,
          spriteStatus: writer.stateEffects.spritePalette?.status,
        })),
      confidence: writers.every(writer => writer.confidence === 'high') ? 'high' : 'medium',
      evidence: writers.flatMap(writer => writer.evidence).slice(0, 8),
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      writerCallsiteIds: writers.map(writer => writer.id),
      actions: region.analysis.spritePaletteWriterAudit.actions,
    });
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let annotatedRegions = [];

  if (apply) {
    annotatedRegions = annotateRegions(mapData, catalog);
    mapData.paletteCatalogs = (mapData.paletteCatalogs || []).filter(item => item.id !== catalogId);
    mapData.paletteCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'sprite_palette_writer_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      runtimeStateModel: catalog.runtimeStateModel,
      directSpriteWriterGroups: catalog.directSpriteWriterGroups,
      writerCallsiteSample: catalog.writerCallsites,
      annotatedRegions,
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
      annotatedRegionCount: annotatedRegions.length,
    },
    directSpriteWriterGroups: catalog.directSpriteWriterGroups.map(group => ({
      index: group.index,
      useCount: group.useCount,
      callers: group.uses.map(use => use.caller.label),
    })),
    dynamicWriters: catalog.writerCallsites
      .filter(writer => !writer.stateEffects.rawHL)
      .map(writer => ({
        id: writer.id,
        caller: writer.caller.label,
        action: writer.action,
        bgStatus: writer.stateEffects.bgPalette?.status,
        spriteStatus: writer.stateEffects.spritePalette?.status,
      })),
  }, null, 2));
}

main();
