#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const catalogId = 'world-animation-frame-subrecord-usage-catalog-2026-06-26';
const reportId = 'animation-frame-subrecord-usage-audit-2026-06-26';
const toolName = 'tools/world-animation-frame-subrecord-usage-audit.mjs';

const sourceIds = {
  frameSubrecords: 'world-animation-frame-subrecord-catalog-2026-06-25',
  roomEntityFrameAssets: 'world-room-entity-frame-asset-link-catalog-2026-06-25',
  animationFamilies: 'world-animation-family-catalog-2026-06-25',
  behaviorFamilies: 'world-animation-behavior-family-catalog-2026-06-25',
};

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

function countBy(items, getKey) {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item) || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => value != null && value !== ''))].sort();
}

function selectorPairKey(pair) {
  if (!pair) return 'unknown';
  return `${pair.root || 'unknown'}/${pair.child || 'unknown'}`;
}

function compactSourceFamily(family) {
  return {
    sourceCatalog: family.sourceCatalog || '',
    familyId: family.familyId || '',
    familyKind: family.familyKind || '',
    entityType: family.entityType ?? null,
    dispatchLabel: family.dispatchLabel || '',
    selectorPair: family.selectorPair || null,
    streamOffset: family.streamOffset || '',
  };
}

function compactRoomEntityLink(link) {
  return {
    entityTypeHex: link.entityTypeHex || '',
    selectorTypeHex: link.dispatchSelector?.entityTypeHex || '',
    highBitVariant: Boolean(link.dispatchSelector?.highBitVariant),
    usageClass: link.usageClass || '',
    animationStatus: link.animationStatus || '',
    dispatchLabel: link.dispatch?.label || '',
    selectorPair: link.dispatch?.selectorPair || null,
    dynamicTile: link.dynamicTile
      ? {
          tableId: link.dynamicTile.tableId || '',
          entryOffset: link.dynamicTile.entryOffset || '',
          streamRomOffset: link.dynamicTile.streamRomOffset || '',
          streamRegion: link.dynamicTile.streamRegion || null,
          zeroPadding: Boolean(link.dynamicTile.zeroPadding),
        }
      : null,
  };
}

function buildRoomEntityIndex(roomEntityFrameCatalog) {
  const bySubrecord = new Map();
  for (const link of roomEntityFrameCatalog.links || []) {
    if (link.frameAsset?.status !== 'linked_high_confidence_frame_subrecords') continue;
    for (const subrecord of link.frameAsset.subrecords || []) {
      if (!subrecord.id) continue;
      if (!bySubrecord.has(subrecord.id)) bySubrecord.set(subrecord.id, []);
      bySubrecord.get(subrecord.id).push(compactRoomEntityLink(link));
    }
  }
  return bySubrecord;
}

function classifySubrecord(subrecord, roomEntityLinks) {
  if (roomEntityLinks.length) return 'room_entity_linked';
  const sourceCatalogs = new Set((subrecord.sourceFamilies || []).map(family => family.sourceCatalog));
  if (sourceCatalogs.has(sourceIds.animationFamilies)) return 'non_room_animation_family';
  return 'unlinked_unknown_source';
}

function buildSubrecordUsage(mapData, frameSubrecordCatalog, roomEntityFrameCatalog) {
  const roomEntityBySubrecord = buildRoomEntityIndex(roomEntityFrameCatalog);
  const byRegion = new Map();
  const subrecords = [];

  for (const regionEntry of frameSubrecordCatalog.regions || []) {
    const region = findRegionById(mapData, regionEntry.region?.id) || regionEntry.region || null;
    if (!region?.id) continue;
    if (!byRegion.has(region.id)) {
      byRegion.set(region.id, {
        region: regionRef(region),
        subrecords: [],
      });
    }
    for (const subrecord of regionEntry.subrecords || []) {
      const roomEntityLinks = roomEntityBySubrecord.get(subrecord.id) || [];
      const sourceFamilies = (subrecord.sourceFamilies || []).map(compactSourceFamily);
      const usageClass = classifySubrecord(subrecord, roomEntityLinks);
      const entry = {
        id: subrecord.id,
        offset: subrecord.offset,
        endOffsetInclusive: subrecord.endOffsetInclusive || '',
        size: subrecord.size || 0,
        terminatorOffset: subrecord.terminatorOffset || '',
        pieceRecordCount: subrecord.pieceRecordCount || 0,
        referenceCount: subrecord.referenceCount || 0,
        sourceCommandStreams: uniqueSorted(subrecord.sourceCommandStreams || []),
        sourceFamilies,
        sourceFamilyCount: sourceFamilies.length,
        sourceCatalogs: uniqueSorted(sourceFamilies.map(family => family.sourceCatalog)),
        selectorPairs: uniqueSorted(sourceFamilies.map(family => selectorPairKey(family.selectorPair))),
        selectorRoots: uniqueSorted(sourceFamilies.map(family => family.selectorPair?.root)),
        roomEntityLinks,
        roomEntityLinkCount: roomEntityLinks.length,
        usageClass,
        region: regionRef(region),
        evidence: [
          `${subrecord.offset} is a high-confidence _LABEL_792_ frame stream subrecord from ${sourceIds.frameSubrecords}.`,
          roomEntityLinks.length
            ? `${subrecord.id} appears in ${sourceIds.roomEntityFrameAssets}, linking it to room entity behavior selector metadata.`
            : `${subrecord.id} does not appear in ${sourceIds.roomEntityFrameAssets}; current references come from non-room animation-family selector metadata when present.`,
        ],
      };
      subrecords.push(entry);
      byRegion.get(region.id).subrecords.push(entry);
    }
  }

  return { subrecords, byRegion };
}

function summarizeSubrecords(subrecords) {
  const sourceFamilyRefs = subrecords.flatMap(subrecord => subrecord.sourceFamilies);
  const linkedRoomEntityRefs = subrecords.flatMap(subrecord => subrecord.roomEntityLinks);
  return {
    subrecordCount: subrecords.length,
    usageClassCounts: countBy(subrecords, item => item.usageClass),
    pieceRecordCount: subrecords.reduce((sum, item) => sum + item.pieceRecordCount, 0),
    referenceCount: subrecords.reduce((sum, item) => sum + item.referenceCount, 0),
    sourceFamilyReferenceCount: sourceFamilyRefs.length,
    roomEntityLinkReferenceCount: linkedRoomEntityRefs.length,
    sourceCatalogCounts: countBy(sourceFamilyRefs, item => item.sourceCatalog),
    selectorRootCounts: countBy(sourceFamilyRefs, item => item.selectorPair?.root),
    selectorPairCounts: countBy(sourceFamilyRefs, item => selectorPairKey(item.selectorPair)),
    rawRoomEntityTypeCounts: countBy(linkedRoomEntityRefs, item => item.entityTypeHex),
    roomEntitySelectorTypeCounts: countBy(linkedRoomEntityRefs, item => item.selectorTypeHex),
  };
}

function buildCatalog(mapData) {
  const frameSubrecordCatalog = requireCatalog(mapData, 'animationFrameSubrecordCatalogs', sourceIds.frameSubrecords);
  const roomEntityFrameCatalog = requireCatalog(mapData, 'metaspriteCatalogs', sourceIds.roomEntityFrameAssets);
  const animationFamilyCatalog = requireCatalog(mapData, 'animationFamilyCatalogs', sourceIds.animationFamilies);
  const behaviorFamilyCatalog = requireCatalog(mapData, 'animationBehaviorFamilyCatalogs', sourceIds.behaviorFamilies);
  const { subrecords, byRegion } = buildSubrecordUsage(mapData, frameSubrecordCatalog, roomEntityFrameCatalog);
  const regionUsage = [...byRegion.values()].map(item => {
    const summary = summarizeSubrecords(item.subrecords);
    return {
      region: item.region,
      ...summary,
      subrecords: item.subrecords.map(subrecord => ({
        id: subrecord.id,
        offset: subrecord.offset,
        endOffsetInclusive: subrecord.endOffsetInclusive,
        size: subrecord.size,
        pieceRecordCount: subrecord.pieceRecordCount,
        referenceCount: subrecord.referenceCount,
        usageClass: subrecord.usageClass,
        sourceCatalogs: subrecord.sourceCatalogs,
        selectorPairs: subrecord.selectorPairs,
        roomEntityLinkCount: subrecord.roomEntityLinkCount,
        roomEntityLinkSamples: subrecord.roomEntityLinks.slice(0, 8),
        sourceFamilySamples: subrecord.sourceFamilies.slice(0, 8),
      })),
    };
  }).sort((a, b) => String(a.region?.offset || '').localeCompare(String(b.region?.offset || '')));

  const summary = summarizeSubrecords(subrecords);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      frameSubrecordCatalog.id,
      roomEntityFrameCatalog.id,
      animationFamilyCatalog.id,
      behaviorFamilyCatalog.id,
    ],
    assetPolicy: 'Metadata only: frame subrecord ids, offsets, sizes, counts, selector provenance, room-entity link ids, region ids, and evidence. No ROM bytes, decoded sprite coordinates, graphics, text, music, screenshots, or rendered assets are embedded.',
    classificationRules: {
      roomEntityLinked: 'A frame subrecord is room_entity_linked when it appears in world-room-entity-frame-asset-link-catalog-2026-06-25.',
      nonRoomAnimationFamily: 'A frame subrecord is non_room_animation_family when it is high-confidence frame data, lacks a room-entity bridge link, and is referenced by world-animation-family-catalog-2026-06-25 selector families.',
      unlinkedUnknownSource: 'A frame subrecord remains unlinked_unknown_source when neither rule above applies.',
      roomEntitySelectorEvidence: 'world-animation-behavior-family-catalog-2026-06-25 records that _LABEL_65B9_ seeds room entity animation selectors with root 0x02 before _LABEL_1318_.',
    },
    summary: {
      sourceHighConfidenceSubrecords: frameSubrecordCatalog.summary?.highConfidenceSubrecords || 0,
      sourceRoomEntityLinkedSubrecords: roomEntityFrameCatalog.summary?.highConfidenceFrameSubrecordsLinked || 0,
      sourceAnimationFamilyCount: animationFamilyCatalog.summary?.familyCount || 0,
      sourceBehaviorAnimationFamilyCount: behaviorFamilyCatalog.summary?.animationStartFamilies || 0,
      ...summary,
      regionCount: regionUsage.length,
      assetPolicy: 'Metadata only: frame subrecord ids, offsets, sizes, counts, selector provenance, room-entity link ids, region ids, and evidence. No ROM bytes, decoded sprite coordinates, graphics, text, music, screenshots, or rendered assets are embedded.',
    },
    subrecords,
    regionUsage,
    evidence: [
      'world-animation-frame-subrecord-catalog-2026-06-25 supplies high-confidence _LABEL_792_ metasprite frame stream ranges.',
      'world-room-entity-frame-asset-link-catalog-2026-06-25 supplies room-entity behavior selector links for a subset of those frame subrecords.',
      'world-animation-family-catalog-2026-06-25 supplies selector-family references for frame subrecords that are not part of the room-entity behavior bridge.',
      'world-animation-behavior-family-catalog-2026-06-25 documents the room-entity root selector evidence from _LABEL_65B9_ and _LABEL_1318_.',
    ],
    nextLeads: [
      'Trace non-room selector roots 0x01, 0x03, and 0x04 to name these animation families without guessing their gameplay role.',
      'Use the usage split to keep room-entity render fixtures separate from player/special animation fixture generation.',
      'Regenerate tile-base and dynamic-tile coverage after assigning non-room selector roots to runtime owners.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  for (const region of mapData.regions || []) {
    if (region.analysis?.animationFrameSubrecordUsageAudit?.catalogId === catalogId) {
      delete region.analysis.animationFrameSubrecordUsageAudit;
    }
  }

  const regionUpdates = [];
  for (const usage of catalog.regionUsage || []) {
    const region = findRegionById(mapData, usage.region?.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.animationFrameSubrecordUsageAudit = {
      catalogId,
      kind: 'metasprite_frame_subrecord_usage_catalog',
      confidence: usage.usageClassCounts?.unlinked_unknown_source ? 'medium' : 'high',
      summary: 'Classifies high-confidence metasprite frame subrecords in this region by room-entity bridge usage versus non-room animation-family usage.',
      subrecordCount: usage.subrecordCount,
      usageClassCounts: usage.usageClassCounts,
      pieceRecordCount: usage.pieceRecordCount,
      referenceCount: usage.referenceCount,
      sourceCatalogCounts: usage.sourceCatalogCounts,
      selectorRootCounts: usage.selectorRootCounts,
      roomEntityLinkReferenceCount: usage.roomEntityLinkReferenceCount,
      sourceFamilyReferenceCount: usage.sourceFamilyReferenceCount,
      subrecordSamples: usage.subrecords.slice(0, 32),
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    regionUpdates.push({
      region: regionRef(region),
      usageClassCounts: usage.usageClassCounts,
      subrecordCount: usage.subrecordCount,
    });
  }

  mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(item => item.id !== catalogId);
  mapData.metaspriteCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'animation_frame_subrecord_usage_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedRegions: regionUpdates.length,
    },
    classificationRules: catalog.classificationRules,
    regionUpdates,
    usageSamples: catalog.subrecords.slice(0, 24).map(subrecord => ({
      id: subrecord.id,
      offset: subrecord.offset,
      regionId: subrecord.region?.id || '',
      usageClass: subrecord.usageClass,
      pieceRecordCount: subrecord.pieceRecordCount,
      sourceCatalogs: subrecord.sourceCatalogs,
      selectorPairs: subrecord.selectorPairs,
      roomEntityLinkCount: subrecord.roomEntityLinkCount,
    })),
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
    usageClassCounts: catalog.summary.usageClassCounts,
  }, null, 2));
}

main();
