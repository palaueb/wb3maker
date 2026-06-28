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
const catalogId = 'world-room-entity-behavior-link-catalog-2026-06-25';
const reportId = 'room-entity-behavior-link-audit-2026-06-25';
const toolName = 'tools/world-room-entity-behavior-link-audit.mjs';

const sourceIds = {
  reachedRoomEntities: 'world-room-entity-list-catalog-2026-06-25',
  orphanRoomEntities: 'world-room-entity-orphan-list-catalog-2026-06-25',
  behaviorFamilies: 'world-animation-behavior-family-catalog-2026-06-25',
  bank0Behavior: 'world-bank0-entity-behavior-catalog-2026-06-25',
  bank0InitHeads: 'world-bank0-entity-init-heads-catalog-2026-06-25',
};

function hex(n, pad = 2) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const parsed = parseInt(value.replace(/^0x/i, ''), 16);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireCatalog(mapData, key, id) {
  const catalog = (mapData[key] || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required catalog ${key}.${id}`);
  return catalog;
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

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRegionByLabel(mapData, label) {
  return (mapData.regions || []).find(region => {
    const name = region.name || '';
    return name === label || name.startsWith(`${label} `);
  }) || null;
}

function compactRoutineRegion(region) {
  if (!region) return null;
  const analysis = region.analysis || {};
  const analysisSummaries = {};
  for (const [key, value] of Object.entries(analysis)) {
    if (!value || typeof value !== 'object') continue;
    analysisSummaries[key] = {
      kind: value.kind || value.role || '',
      summary: value.summary || '',
      confidence: value.confidence || '',
    };
  }
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || '',
    name: region.name || '',
    notes: region.notes || '',
    analysisSummaries,
  };
}

function usageByType(entityTypes, sourceRole) {
  const byType = new Map();
  for (const item of entityTypes || []) {
    const entityType = parseHex(item.entityType);
    if (!entityType) continue;
    byType.set(entityType, {
      sourceRole,
      entityType,
      entityTypeHex: hex(entityType),
      occurrenceCount: item.occurrenceCount || 0,
      listRefCount: item.listRefCount || 0,
      subrecordRefCount: item.subrecordRefCount || 0,
      table: item.table || (entityType & 0x80 ? 'alternate' : 'normal'),
      tableIndex: item.tableIndex,
      dynamicTableEntry: item.dynamicTableEntry ? {
        tableId: item.dynamicTableEntry.tableId || '',
        entryOffset: item.dynamicTableEntry.entryOffset || '',
        remapRow: item.dynamicTableEntry.remapRow,
        streamRomOffset: item.dynamicTableEntry.streamRomOffset || '',
        streamRegion: item.dynamicTableEntry.streamRegion || null,
        zeroPadding: Boolean(item.dynamicTableEntry.zeroPadding),
      } : null,
    });
  }
  return byType;
}

function indexBy(items, keyFn) {
  const out = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (key == null) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

function compactBank0Entry(entry) {
  if (!entry) return null;
  return {
    label: entry.label || '',
    role: entry.role || '',
    family: entry.family || '',
    region: entry.region || null,
    tableIndex: entry.tableIndex ?? null,
    calls: entry.calls || [],
    ramRefs: entry.ramRefs || [],
    summary: entry.summary || '',
    confidence: entry.confidence || 'unknown',
  };
}

function compactInitHead(entry) {
  if (!entry) return null;
  return {
    label: entry.label || '',
    role: entry.role || '',
    tailLabel: entry.tailLabel || '',
    tableIndex: entry.tableIndex ?? null,
    constants: entry.constants || [],
    ramRefs: entry.ramRefs || [],
    summary: entry.summary || '',
    confidence: entry.confidence || 'high',
  };
}

function compactFamily(family) {
  return {
    familyId: family.id,
    dispatchLabel: family.dispatchLabel,
    dispatchTableIndex: family.dispatchTableIndex,
    selectorPair: family.selectorProvenance?.selectorPair || null,
    variantSelector: family.variantSelector?.expression || '',
    childEntry: family.selectedTarget?.childEntry || null,
    variantTable: family.selectedTarget?.variantTable ? {
      tableOffset: family.selectedTarget.variantTable.tableOffset,
      entryCount: family.selectedTarget.variantTable.entryCount,
      region: family.selectedTarget.variantTable.region || null,
    } : null,
    directScript: family.selectedTarget?.directScript || null,
    streamCount: family.summary?.parsedStreams || 0,
    commandCount: family.summary?.parsedCommands || 0,
    framePointerReferences: family.summary?.framePointerReferences || 0,
    frameTargetRegionCount: family.summary?.frameTargetRegions || 0,
    warningStreams: family.summary?.warningStreams || 0,
    frameTargetRegions: (family.selectedTarget?.frameTargetRegions || []).slice(0, 8).map(region => ({
      region: region.region || null,
      referenceCount: region.referenceCount || 0,
      uniqueTargetOffsets: region.uniqueTargetOffsets || 0,
    })),
    confidence: family.confidence || 'unknown',
    frameTargetConfidence: family.frameTargetConfidence || 'unknown',
  };
}

function buildCatalog(mapData) {
  const reachedCatalog = requireCatalog(mapData, 'entityDataCatalogs', sourceIds.reachedRoomEntities);
  const orphanCatalog = requireCatalog(mapData, 'entityDataCatalogs', sourceIds.orphanRoomEntities);
  const familyCatalog = requireCatalog(mapData, 'animationBehaviorFamilyCatalogs', sourceIds.behaviorFamilies);
  const bank0Catalog = requireCatalog(mapData, 'bank0EntityBehaviorCatalogs', sourceIds.bank0Behavior);
  const initHeadCatalog = requireCatalog(mapData, 'bank0EntityInitHeadCatalogs', sourceIds.bank0InitHeads);

  const reachedByType = usageByType(reachedCatalog.entityTypes || [], 'reached_room_entity_lists');
  const orphanByType = usageByType(orphanCatalog.entityTypes || [], 'orphan_room_entity_lists');
  const dispatchByType = new Map((familyCatalog.dispatchTable?.entries || []).map(entry => [entry.entityType, entry]));
  const familiesByType = indexBy(familyCatalog.families || [], family => family.entityType);
  const noAnimByType = new Map((familyCatalog.entriesWithoutAnimationStart || []).map(entry => [entry.entityType, entry]));
  const bank0ByLabel = new Map((bank0Catalog.entries || []).map(entry => [entry.label, entry]));
  const initHeadByLabel = new Map((initHeadCatalog.entries || []).map(entry => [entry.label, entry]));
  const entityTypes = [...new Set([
    ...reachedByType.keys(),
    ...orphanByType.keys(),
  ])].sort((a, b) => a - b);

  const links = entityTypes.map(entityType => {
    const reached = reachedByType.get(entityType) || null;
    const orphan = orphanByType.get(entityType) || null;
    const dispatchSelectorType = entityType & 0x7F;
    const dispatch = dispatchByType.get(dispatchSelectorType) || null;
    const families = familiesByType.get(dispatchSelectorType) || [];
    const bank0Entry = dispatch?.label ? bank0ByLabel.get(dispatch.label) : null;
    const initHead = dispatch?.label ? initHeadByLabel.get(dispatch.label) : null;
    const routineRegion = dispatch?.label ? findRegionByLabel(mapData, dispatch.label) : null;
    const noAnimation = noAnimByType.get(dispatchSelectorType) || null;
    const usageClass = reached && orphan
      ? 'reached_and_orphan'
      : reached
        ? 'reached_only'
        : 'orphan_only';
    const dynamic = reached?.dynamicTableEntry
      ? reached.dynamicTableEntry
      : orphan
        ? {
            tableId: orphan.table === 'alternate' ? 'entity_dynamic_tiles_alternate' : 'entity_dynamic_tiles_normal',
            tableIndex: orphan.tableIndex,
            source: 'orphan_catalog_table_index_only',
          }
        : null;
    return {
      entityType,
      entityTypeHex: hex(entityType),
      dispatchSelector: {
        entityType: dispatchSelectorType,
        entityTypeHex: hex(dispatchSelectorType),
        highBitVariant: entityType !== dispatchSelectorType,
      },
      usageClass,
      roomUsage: {
        reached: reached ? {
          occurrenceCount: reached.occurrenceCount,
          listRefCount: reached.listRefCount,
          subrecordRefCount: reached.subrecordRefCount,
        } : null,
        orphan: orphan ? {
          occurrenceCount: orphan.occurrenceCount,
          table: orphan.table,
          tableIndex: orphan.tableIndex,
        } : null,
      },
      dispatch: dispatch ? {
        table: '_DATA_668E_',
        tableIndex: dispatch.tableIndex,
        label: dispatch.label,
        tableLine: dispatch.tableLine,
        selectorPair: dispatch.selectorPair,
      } : null,
      initializer: bank0Entry || initHead ? {
        status: bank0Entry ? 'bank0_initializer_metadata' : 'init_head_metadata',
        bank0Entry: compactBank0Entry(bank0Entry),
        initHead: compactInitHead(initHead),
        routineRegion: compactRoutineRegion(routineRegion),
      } : routineRegion ? {
        status: 'region_routine_metadata',
        routineRegion: compactRoutineRegion(routineRegion),
      } : dispatch ? {
        status: 'dispatch_label_only',
      } : {
        status: 'missing_dispatch_entry',
      },
      animation: {
        status: families.length
          ? 'linked_animation_family'
          : noAnimation
            ? 'dispatch_entry_without_animation_start'
            : 'animation_family_unresolved',
        familyCount: families.length,
        families: families.map(compactFamily),
      },
      dynamicTile: dynamic,
      confidence: dispatch ? 'high' : 'medium',
      evidence: [
        reached ? 'Reached room entity list catalog records this type byte in CF62-selected room entity source lists.' : null,
        orphan ? 'Orphan room entity list catalog records this type byte in structurally decoded but unreferenced entity lists.' : null,
        dispatch ? `_DATA_668E_ dispatch entry ${dispatch.tableIndex} maps selector type ${hex(dispatchSelectorType)} to ${dispatch.label}; raw room type ${hex(entityType)} uses (type & 0x7F).` : null,
        routineRegion ? `Mapped routine region ${routineRegion.id} at ${routineRegion.offset} supplies region-level metadata for dispatch label ${dispatch.label}.` : null,
        families.length ? 'Animation behavior family catalog links this dispatch entry to _LABEL_1318_ selector root 0x02 metadata.' : null,
        noAnimation ? 'Animation behavior family catalog records this dispatch entry as not starting animation through _LABEL_1318_ in the initializer block.' : null,
      ].filter(Boolean),
    };
  });

  const usageCounts = links.reduce((acc, link) => {
    acc[link.usageClass] = (acc[link.usageClass] || 0) + 1;
    return acc;
  }, {});
  const linkedDispatchTypes = links.filter(link => link.dispatch).length;
  const linkedInitializerTypes = links.filter(link => link.initializer.status === 'bank0_initializer_metadata' || link.initializer.status === 'init_head_metadata' || link.initializer.status === 'region_routine_metadata').length;
  const routineRegionFallbackTypes = links.filter(link => link.initializer.status === 'region_routine_metadata').length;
  const linkedAnimationTypes = links.filter(link => link.animation.status === 'linked_animation_family').length;
  const noAnimationStartTypes = links.filter(link => link.animation.status === 'dispatch_entry_without_animation_start').length;
  const dynamicTileTypes = links.filter(link => link.dynamicTile).length;

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceIds),
    summary: {
      reachedUniqueEntityTypes: reachedByType.size,
      orphanUniqueEntityTypes: orphanByType.size,
      linkedEntityTypes: links.length,
      usageClassCounts: usageCounts,
      linkedDispatchTypes,
      linkedInitializerTypes,
      routineRegionFallbackTypes,
      linkedAnimationTypes,
      dispatchEntriesWithoutAnimationStart: noAnimationStartTypes,
      dynamicTileLinkedTypes: dynamicTileTypes,
      reachedEntityRecords: reachedCatalog.summary?.decodedEntityRecords || 0,
      orphanEntityRecords: orphanCatalog.summary?.decodedEntityRecords || 0,
      orphanSubrecordPointerRefs: orphanCatalog.summary?.subrecordPointerRefsIntoSpan ?? null,
      assetPolicy: 'Metadata only: entity type ids, counts, dispatch labels, initializer labels, animation family ids, dynamic tile table indexes, offsets, region ids, and evidence. No ROM bytes, coordinates, decoded sprites, graphics, music, text, screenshots, or rendered assets are embedded.',
    },
    selectorModel: {
      sourceRecordField: 'room entity source byte 0',
      runtimeSlotField: 'IX+15',
      dispatch: '_LABEL_667C_ -> _DATA_668E_[((IX+15 & 0x7F) - 1)]',
      animationRoot: 'IX+14 = 0x02 for room entity slots',
      evidence: [
        '_LABEL_65B9_ copies IY+0 into IX+15 and sets IX+14 to 0x02 for room entity slots.',
        '_LABEL_667C_ dispatches _DATA_668E_ by ((IX+15 & 0x7F) - 1), so dispatch table entry N corresponds to entity type byte N+1.',
      ],
    },
    links,
    evidence: [
      'world-room-entity-list-catalog-2026-06-25 supplies reached CF62-selected room entity type ids and counts without coordinates.',
      'world-room-entity-orphan-list-catalog-2026-06-25 supplies structurally decoded orphan entity type ids and counts with zero room-subrecord pointer refs.',
      'world-animation-behavior-family-catalog-2026-06-25 supplies _DATA_668E_ dispatch entries, _LABEL_65B9_ selector provenance, and root-2 animation-family links.',
      'world-bank0-entity-behavior-catalog-2026-06-25 and world-bank0-entity-init-heads-catalog-2026-06-25 supply initializer labels, IX fields, constants, and summaries.',
    ],
    nextLeads: [
      'Name entity type ids by correlating linked initializer/animation families with visible room context and metasprite frame records.',
      'Trace orphan-only entity types for non-CF62 consumers before classifying them as leftover or unused content.',
      'Use this bridge to build an entity browser that shows type id, initializer, dynamic tile stream, and animation family without exposing coordinates or ROM bytes.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const regionUpdates = [];
  const activeRegion = findRegionById(mapData, 'r2821');
  const orphanRegion = findRegionById(mapData, 'r2820');
  const annotate = (region, role, usageClasses) => {
    if (!region) return;
    const links = catalog.links.filter(link => usageClasses.includes(link.usageClass));
    region.analysis = region.analysis || {};
    region.analysis.roomEntityBehaviorLinkAudit = {
      catalogId,
      kind: role,
      confidence: 'high',
      linkedEntityTypeCount: links.length,
      linkedDispatchTypes: links.filter(link => link.dispatch).length,
      linkedAnimationTypes: links.filter(link => link.animation.status === 'linked_animation_family').length,
      linkedInitializerTypes: links.filter(link => link.initializer.status !== 'dispatch_label_only' && link.initializer.status !== 'missing_dispatch_entry').length,
      summary: role === 'reached_room_entity_behavior_links'
        ? 'Reached room entity type ids are linked to _DATA_668E_ dispatch labels, initializer metadata, animation families, and dynamic tile table metadata.'
        : 'Orphan room entity type ids are linked to the same behavior metadata, but no confirmed CF62 room subrecord pointer reaches this span.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    regionUpdates.push({
      region: regionRef(region),
      role,
      linkedEntityTypeCount: links.length,
    });
  };
  annotate(activeRegion, 'reached_room_entity_behavior_links', ['reached_only', 'reached_and_orphan']);
  annotate(orphanRegion, 'orphan_room_entity_behavior_links', ['orphan_only', 'reached_and_orphan']);

  mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityBehaviorCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'room_entity_behavior_link_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedRegions: regionUpdates.length,
    },
    selectorModel: catalog.selectorModel,
    sampleLinks: catalog.links.slice(0, 16).map(link => ({
      entityTypeHex: link.entityTypeHex,
      dispatchSelectorTypeHex: link.dispatchSelector.entityTypeHex,
      highBitVariant: link.dispatchSelector.highBitVariant,
      usageClass: link.usageClass,
      reachedOccurrences: link.roomUsage.reached?.occurrenceCount || 0,
      orphanOccurrences: link.roomUsage.orphan?.occurrenceCount || 0,
      dispatchLabel: link.dispatch?.label || '',
      animationStatus: link.animation.status,
      animationFamilyCount: link.animation.familyCount,
      dynamicTile: link.dynamicTile ? {
        tableId: link.dynamicTile.tableId || '',
        tableIndex: link.dynamicTile.tableIndex,
        streamRomOffset: link.dynamicTile.streamRomOffset || '',
        streamRegionId: link.dynamicTile.streamRegion?.id || '',
      } : null,
    })),
    regionUpdates,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
  return { regionUpdates };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let changes = { regionUpdates: [] };

  if (apply) {
    changes = applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    regionUpdates: changes.regionUpdates.length,
    sampleLinks: catalog.links.slice(0, 8).map(link => ({
      entityTypeHex: link.entityTypeHex,
      dispatchSelectorTypeHex: link.dispatchSelector.entityTypeHex,
      highBitVariant: link.dispatchSelector.highBitVariant,
      usageClass: link.usageClass,
      dispatchLabel: link.dispatch?.label || '',
      animationStatus: link.animation.status,
      reachedOccurrences: link.roomUsage.reached?.occurrenceCount || 0,
      orphanOccurrences: link.roomUsage.orphan?.occurrenceCount || 0,
    })),
  }, null, 2));
}

main();
