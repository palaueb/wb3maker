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
const catalogId = 'world-room-entity-frame-asset-link-catalog-2026-06-25';
const reportId = 'room-entity-frame-asset-link-audit-2026-06-25';
const toolName = 'tools/world-room-entity-frame-asset-link-audit.mjs';

const sourceIds = {
  roomEntityBehaviorLink: 'world-room-entity-behavior-link-catalog-2026-06-25',
  frameSubrecords: 'world-animation-frame-subrecord-catalog-2026-06-25',
  frameStreams: 'world-animation-frame-stream-catalog-2026-06-25',
  animationFamilies: 'world-animation-behavior-family-catalog-2026-06-25',
};

function hex(n, pad = 2) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requireCatalog(mapData, key, id) {
  const catalog = (mapData[key] || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required catalog ${key}.${id}`);
  return catalog;
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
    type: region.type || '',
    name: region.name || '',
  };
}

function pairKey(pair) {
  if (!pair) return '';
  return `${pair.root || ''}/${pair.child || ''}`;
}

function compactDynamicTile(dynamicTile) {
  if (!dynamicTile) return null;
  return {
    tableId: dynamicTile.tableId || '',
    tableIndex: dynamicTile.tableIndex ?? null,
    entryOffset: dynamicTile.entryOffset || '',
    remapRow: dynamicTile.remapRow ?? null,
    streamRomOffset: dynamicTile.streamRomOffset || '',
    streamRegion: dynamicTile.streamRegion || null,
    zeroPadding: Boolean(dynamicTile.zeroPadding),
    source: dynamicTile.source || '',
  };
}

function addSubrecordForSelector(bySelector, regionUsage, selectorType, region, subrecord, sourceFamily) {
  if (!Number.isInteger(selectorType)) return;
  if (!bySelector.has(selectorType)) {
    bySelector.set(selectorType, {
      selectorType,
      selectorTypeHex: hex(selectorType),
      selectorPair: sourceFamily.selectorPair || null,
      dispatchLabel: sourceFamily.dispatchLabel || '',
      subrecords: new Map(),
      streamOffsets: new Set(),
      regions: new Map(),
    });
  }
  const selector = bySelector.get(selectorType);
  const existing = selector.subrecords.get(subrecord.id);
  if (!existing) {
    const compact = {
      id: subrecord.id,
      offset: subrecord.offset,
      endOffsetInclusive: subrecord.endOffsetInclusive || '',
      size: subrecord.size || 0,
      pieceRecordCount: subrecord.pieceRecordCount || 0,
      referenceCount: subrecord.referenceCount || 0,
      region: regionRef(region),
      confidence: subrecord.confidence || 'high',
    };
    selector.subrecords.set(subrecord.id, compact);
    if (region?.id) {
      if (!selector.regions.has(region.id)) {
        selector.regions.set(region.id, {
          region: regionRef(region),
          subrecordCount: 0,
          pieceRecordCount: 0,
          referenceCount: 0,
        });
      }
      const regionSummary = selector.regions.get(region.id);
      regionSummary.subrecordCount++;
      regionSummary.pieceRecordCount += compact.pieceRecordCount;
      regionSummary.referenceCount += compact.referenceCount;

      if (!regionUsage.has(region.id)) {
        regionUsage.set(region.id, {
          regionId: region.id,
          selectorTypes: new Set(),
          rawEntityTypes: new Set(),
          subrecords: new Set(),
          pieceRecordCount: 0,
          referenceCount: 0,
        });
      }
      const usage = regionUsage.get(region.id);
      usage.selectorTypes.add(selectorType);
      if (!usage.subrecords.has(subrecord.id)) {
        usage.subrecords.add(subrecord.id);
        usage.pieceRecordCount += compact.pieceRecordCount;
        usage.referenceCount += compact.referenceCount;
      }
    }
  }
  for (const streamOffset of subrecord.sourceCommandStreams || []) selector.streamOffsets.add(streamOffset);
  if (sourceFamily.streamOffset) selector.streamOffsets.add(sourceFamily.streamOffset);
}

function buildSubrecordOffsetIndex(frameSubrecordCatalog) {
  const byOffset = new Map();
  for (const regionEntry of frameSubrecordCatalog.regions || []) {
    const region = regionEntry.region || null;
    for (const subrecord of regionEntry.subrecords || []) {
      if (!subrecord.offset) continue;
      byOffset.set(subrecord.offset, { region, subrecord });
    }
  }
  return byOffset;
}

function mergeBehaviorFamilyFrameTargets(bySelector, regionUsage, frameSubrecordCatalog, behaviorFamilyCatalog, initialSelectorTypes) {
  const byOffset = buildSubrecordOffsetIndex(frameSubrecordCatalog);
  const behaviorTargetSelectors = new Set();
  const fallbackOnlySelectors = new Set();
  let behaviorTargetRefs = 0;
  for (const family of behaviorFamilyCatalog.families || []) {
    const selectorType = family.entityType;
    if (!Number.isInteger(selectorType)) continue;
    for (const targetRegion of family.selectedTarget?.frameTargetRegions || []) {
      for (const targetOffset of targetRegion.targetOffsets || []) {
        const target = byOffset.get(targetOffset);
        if (!target) continue;
        const sourceScriptOffsets = targetRegion.sourceScriptOffsets?.length
          ? targetRegion.sourceScriptOffsets
          : [''];
        for (const streamOffset of sourceScriptOffsets) {
          addSubrecordForSelector(
            bySelector,
            regionUsage,
            selectorType,
            target.region,
            target.subrecord,
            {
              sourceCatalog: sourceIds.animationFamilies,
              familyId: family.id,
              familyKind: family.kind,
              entityType: selectorType,
              dispatchLabel: family.dispatchLabel,
              selectorPair: family.selectorProvenance?.selectorPair || null,
              streamOffset,
            }
          );
        }
        behaviorTargetSelectors.add(selectorType);
        if (!initialSelectorTypes.has(selectorType)) fallbackOnlySelectors.add(selectorType);
        behaviorTargetRefs++;
      }
    }
  }
  return {
    behaviorFrameTargetSelectorCount: behaviorTargetSelectors.size,
    behaviorFrameTargetRefs: behaviorTargetRefs,
    fallbackOnlySelectorCount: fallbackOnlySelectors.size,
  };
}

function buildFrameIndex(frameSubrecordCatalog, behaviorFamilyCatalog) {
  const bySelector = new Map();
  const regionUsage = new Map();
  for (const regionEntry of frameSubrecordCatalog.regions || []) {
    const region = regionEntry.region || null;
    for (const subrecord of regionEntry.subrecords || []) {
      for (const sourceFamily of subrecord.sourceFamilies || []) {
        if (sourceFamily.sourceCatalog !== sourceIds.animationFamilies) continue;
        addSubrecordForSelector(
          bySelector,
          regionUsage,
          sourceFamily.entityType,
          region,
          subrecord,
          sourceFamily
        );
      }
    }
  }
  const initialSelectorTypes = new Set(bySelector.keys());
  const fallback = mergeBehaviorFamilyFrameTargets(
    bySelector,
    regionUsage,
    frameSubrecordCatalog,
    behaviorFamilyCatalog,
    initialSelectorTypes
  );
  return { bySelector, regionUsage, fallback };
}

function summarizeSelectorFrameAsset(selector) {
  if (!selector) return null;
  const subrecords = [...selector.subrecords.values()].sort((a, b) =>
    String(a.offset).localeCompare(String(b.offset))
  );
  const regions = [...selector.regions.values()].sort((a, b) =>
    String(a.region?.id || '').localeCompare(String(b.region?.id || ''))
  );
  return {
    selectorTypeHex: selector.selectorTypeHex,
    selectorPair: selector.selectorPair,
    dispatchLabel: selector.dispatchLabel,
    subrecordCount: subrecords.length,
    streamOffsetCount: selector.streamOffsets.size,
    frameRegionCount: regions.length,
    pieceRecordCount: subrecords.reduce((sum, item) => sum + (item.pieceRecordCount || 0), 0),
    referenceCount: subrecords.reduce((sum, item) => sum + (item.referenceCount || 0), 0),
    regions,
    subrecords: subrecords.slice(0, 24),
    streamOffsets: [...selector.streamOffsets].sort().slice(0, 32),
    confidence: 'high',
  };
}

function buildCatalog(mapData) {
  const roomEntityCatalog = requireCatalog(mapData, 'entityBehaviorCatalogs', sourceIds.roomEntityBehaviorLink);
  const frameSubrecordCatalog = requireCatalog(mapData, 'animationFrameSubrecordCatalogs', sourceIds.frameSubrecords);
  const frameStreamCatalog = requireCatalog(mapData, 'animationFrameStreamCatalogs', sourceIds.frameStreams);
  const behaviorFamilyCatalog = requireCatalog(mapData, 'animationBehaviorFamilyCatalogs', sourceIds.animationFamilies);

  const { bySelector, regionUsage, fallback } = buildFrameIndex(frameSubrecordCatalog, behaviorFamilyCatalog);
  const links = (roomEntityCatalog.links || []).map(link => {
    const selectorType = link.dispatchSelector?.entityType ?? (link.entityType & 0x7F);
    const selector = bySelector.get(selectorType) || null;
    const frameAsset = selector
      ? {
          status: 'linked_high_confidence_frame_subrecords',
          ...summarizeSelectorFrameAsset(selector),
        }
      : link.animation?.status === 'linked_animation_family'
        ? {
            status: 'animation_family_without_high_confidence_frame_subrecords',
            selectorTypeHex: hex(selectorType),
            confidence: 'medium',
          }
        : {
            status: link.animation?.status || 'no_animation_family',
            selectorTypeHex: hex(selectorType),
            confidence: link.animation?.status === 'dispatch_entry_without_animation_start' ? 'high' : 'medium',
          };
    return {
      entityType: link.entityType,
      entityTypeHex: link.entityTypeHex,
      dispatchSelector: link.dispatchSelector,
      usageClass: link.usageClass,
      dispatch: link.dispatch,
      animationStatus: link.animation?.status || '',
      dynamicTile: compactDynamicTile(link.dynamicTile),
      frameAsset,
      evidence: [
        `Room entity behavior bridge links raw type ${link.entityTypeHex} to selector ${link.dispatchSelector?.entityTypeHex || hex(selectorType)}.`,
        selector ? `Frame subrecord catalog links selector ${hex(selectorType)} to ${frameAsset.subrecordCount} high-confidence frame stream subrecord(s).` : null,
        link.dynamicTile ? 'Room entity list catalog supplies dynamic tile table metadata for this raw type.' : null,
      ].filter(Boolean),
    };
  });

  for (const link of links) {
    if (link.frameAsset?.status !== 'linked_high_confidence_frame_subrecords') continue;
    for (const region of link.frameAsset.regions || []) {
      const usage = regionUsage.get(region.region?.id);
      if (usage) usage.rawEntityTypes.add(link.entityType);
    }
  }

  const linkedFrameTypes = links.filter(link => link.frameAsset.status === 'linked_high_confidence_frame_subrecords');
  const animationNoFrameTypes = links.filter(link => link.frameAsset.status === 'animation_family_without_high_confidence_frame_subrecords');
  const noAnimationTypes = links.filter(link => link.animationStatus === 'dispatch_entry_without_animation_start');
  const linkedSelectors = new Set(linkedFrameTypes.map(link => link.dispatchSelector?.entityTypeHex || ''));
  const frameRegionIds = new Set();
  const subrecordIds = new Set();
  const linkedSubrecordPieces = new Map();
  for (const selector of bySelector.values()) {
    for (const subrecord of selector.subrecords.values()) {
      subrecordIds.add(subrecord.id);
      if (!linkedSubrecordPieces.has(subrecord.id)) {
        linkedSubrecordPieces.set(subrecord.id, subrecord.pieceRecordCount || 0);
      }
    }
    for (const regionId of selector.regions.keys()) frameRegionIds.add(regionId);
  }
  const linkedPieceRecords = [...linkedSubrecordPieces.values()].reduce((sum, count) => sum + count, 0);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceIds),
    summary: {
      roomEntityTypeLinks: links.length,
      rawTypesWithFrameSubrecords: linkedFrameTypes.length,
      selectorTypesWithFrameSubrecords: linkedSelectors.size,
      rawTypesWithAnimationButNoHighConfidenceFrames: animationNoFrameTypes.length,
      rawTypesWithoutAnimationStart: noAnimationTypes.length,
      behaviorFrameTargetSelectorTypes: fallback.behaviorFrameTargetSelectorCount,
      behaviorFrameTargetReferences: fallback.behaviorFrameTargetRefs,
      selectorTypesAddedByBehaviorFrameTargetFallback: fallback.fallbackOnlySelectorCount,
      highConfidenceFrameSubrecordsLinked: subrecordIds.size,
      frameRegionsLinked: frameRegionIds.size,
      linkedPieceRecordCount: linkedPieceRecords,
      sourceHighConfidenceSubrecords: frameSubrecordCatalog.summary?.highConfidenceSubrecords || 0,
      sourceLowConfidenceFrames: frameSubrecordCatalog.summary?.lowConfidenceFrames || 0,
      sourceFrameStreamCount: frameStreamCatalog.summary?.frameStreamCount || 0,
      assetPolicy: 'Metadata only: entity type ids, selector ids, offsets, region ids, frame subrecord counts, piece counts, dynamic tile metadata, and evidence. No ROM bytes, decoded sprite coordinates, graphics, text, music, screenshots, or rendered assets are embedded.',
    },
    links,
    regionUsage: [...regionUsage.values()].map(usage => ({
      region: regionRef(findRegionById(mapData, usage.regionId)),
      selectorTypeCount: usage.selectorTypes.size,
      rawEntityTypeCount: usage.rawEntityTypes.size,
      subrecordCount: usage.subrecords.size,
      pieceRecordCount: usage.pieceRecordCount,
      referenceCount: usage.referenceCount,
    })).filter(item => item.region).sort((a, b) => String(a.region.id).localeCompare(String(b.region.id))),
    evidence: [
      'world-room-entity-behavior-link-catalog-2026-06-25 links raw room entity type bytes to behavior selector types, dynamic tile metadata, and animation family status.',
      'world-animation-frame-subrecord-catalog-2026-06-25 supplies high-confidence metasprite frame stream subrecord ranges with source behavior families.',
      'When a frame subrecord source-family reverse link is absent, the bridge falls back through behavior-family frame target offsets and only accepts offsets that already exist as high-confidence frame subrecords.',
      'High-bit raw entity types keep their alternate dynamic tile metadata while sharing the low-seven-bit behavior selector and frame subrecords.',
    ],
    nextLeads: [
      'Use this bridge to build a room entity asset browser grouped by raw type, selector, dynamic tile stream, and metasprite frame region.',
      'Resolve the remaining animation-family-without-high-confidence-frame cases by improving command stream static overlay handling.',
      'Promote frequently reused frame subrecords into named metasprite records only after a render comparison confirms their visual identity.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  for (const region of mapData.regions || []) {
    if (region.analysis?.roomEntityFrameAssetLinkAudit?.catalogId === catalogId) {
      delete region.analysis.roomEntityFrameAssetLinkAudit;
    }
  }

  const regionUpdates = [];
  for (const usage of catalog.regionUsage || []) {
    const region = findRegionById(mapData, usage.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.roomEntityFrameAssetLinkAudit = {
      catalogId,
      kind: 'room_entity_frame_asset_region',
      confidence: 'high',
      selectorTypeCount: usage.selectorTypeCount,
      rawEntityTypeCount: usage.rawEntityTypeCount,
      subrecordCount: usage.subrecordCount,
      pieceRecordCount: usage.pieceRecordCount,
      referenceCount: usage.referenceCount,
      summary: 'High-confidence metasprite frame subrecords in this region are linked to one or more room entity behavior selector types.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    regionUpdates.push({
      region: regionRef(region),
      selectorTypeCount: usage.selectorTypeCount,
      rawEntityTypeCount: usage.rawEntityTypeCount,
      subrecordCount: usage.subrecordCount,
    });
  }

  mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(item => item.id !== catalogId);
  mapData.metaspriteCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'room_entity_frame_asset_link_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedFrameRegions: regionUpdates.length,
    },
    sampleLinks: catalog.links.slice(0, 16).map(link => ({
      entityTypeHex: link.entityTypeHex,
      selectorTypeHex: link.dispatchSelector?.entityTypeHex || '',
      highBitVariant: Boolean(link.dispatchSelector?.highBitVariant),
      usageClass: link.usageClass,
      animationStatus: link.animationStatus,
      frameAssetStatus: link.frameAsset.status,
      frameSubrecordCount: link.frameAsset.subrecordCount || 0,
      frameRegionCount: link.frameAsset.frameRegionCount || 0,
      dynamicTileTableId: link.dynamicTile?.tableId || '',
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
      selectorTypeHex: link.dispatchSelector?.entityTypeHex || '',
      usageClass: link.usageClass,
      animationStatus: link.animationStatus,
      frameAssetStatus: link.frameAsset.status,
      frameSubrecordCount: link.frameAsset.subrecordCount || 0,
    })),
  }, null, 2));
}

main();
