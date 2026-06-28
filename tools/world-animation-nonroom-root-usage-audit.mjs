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
const catalogId = 'world-animation-nonroom-root-usage-catalog-2026-06-26';
const reportId = 'animation-nonroom-root-usage-audit-2026-06-26';
const toolName = 'tools/world-animation-nonroom-root-usage-audit.mjs';

const sourceIds = {
  animationFamilies: 'world-animation-family-catalog-2026-06-25',
  callsites: 'world-animation-callsite-catalog-2026-06-25',
  rootSemantics: 'world-animation-root-semantics-catalog-2026-06-25',
  frameUsage: 'world-animation-frame-subrecord-usage-catalog-2026-06-26',
};

const ROOT_USAGE = {
  1: {
    usageClass: 'non_room_auxiliary_slot_animation_root',
    confidence: 'medium',
    basis: 'Routines currently named as vertical offset, pair-slot, periodic-slot, or twelve-slot schedulers seed root 0x01 before _LABEL_1318_.',
  },
  3: {
    usageClass: 'non_room_secondary_auxiliary_animation_root',
    confidence: 'medium',
    basis: '_LABEL_5B35_ is currently named as secondary auxiliary spawn/update and seeds root 0x03 child 0x05 before _LABEL_1318_.',
  },
  4: {
    usageClass: 'non_room_bank2_scene_transition_animation_root',
    confidence: 'medium',
    basis: 'Bank-2 scene and transition scheduler routines seed root 0x04 children before _LABEL_1318_.',
  },
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

function uniqueSorted(values) {
  return [...new Set(values.filter(value => value != null && value !== ''))].sort();
}

function selectorPairKey(pair) {
  if (!pair) return 'unknown';
  return `${pair.root || 'unknown'}/${pair.child || 'unknown'}`;
}

function countBy(items, getKey) {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item) || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function rootInfo(rootEntry) {
  return ROOT_USAGE[rootEntry] || {
    usageClass: 'non_room_animation_root_unclassified',
    confidence: 'low',
    basis: 'Root has non-room frame subrecord usage but no conservative runtime owner label has been assigned.',
  };
}

function compactCallsiteReference(ref) {
  return {
    routine: ref.routine || '',
    routineOffset: ref.routineOffset || '',
    callLine: ref.callLine || null,
    rootWriteLine: ref.rootWriteLine || null,
    childWriteLine: ref.childWriteLine || null,
    region: ref.region || null,
  };
}

function compactSelectedTarget(target) {
  if (!target) return null;
  return {
    childTable: target.childTable || null,
    childEntry: target.childEntry
      ? {
          index: target.childEntry.index,
          entryOffset: target.childEntry.entryOffset || '',
          z80Pointer: target.childEntry.z80Pointer || '',
          romOffset: target.childEntry.romOffset || '',
          region: target.childEntry.region || null,
          targetInterpretation: target.childEntry.targetInterpretation || '',
          variantPrefix: target.childEntry.variantPrefix || null,
        }
      : null,
    indexBase: target.indexBase || 'zero_based',
  };
}

function buildFrameFamilyIndex(frameUsageCatalog) {
  const byFamily = new Map();
  const nonRoomSubrecords = (frameUsageCatalog.subrecords || [])
    .filter(subrecord => subrecord.usageClass === 'non_room_animation_family');

  for (const subrecord of nonRoomSubrecords) {
    const familyIds = uniqueSorted((subrecord.sourceFamilies || []).map(family => family.familyId));
    for (const familyId of familyIds) {
      if (!familyId) continue;
      if (!byFamily.has(familyId)) {
        byFamily.set(familyId, {
          familyId,
          subrecords: new Map(),
          streamOffsets: new Set(),
          sourceFamilies: [],
        });
      }
      const usage = byFamily.get(familyId);
      usage.subrecords.set(subrecord.id, {
        id: subrecord.id,
        offset: subrecord.offset,
        endOffsetInclusive: subrecord.endOffsetInclusive || '',
        size: subrecord.size || 0,
        pieceRecordCount: subrecord.pieceRecordCount || 0,
        referenceCount: subrecord.referenceCount || 0,
        region: subrecord.region || null,
      });
      for (const family of subrecord.sourceFamilies || []) {
        if (family.familyId !== familyId) continue;
        if (family.streamOffset) usage.streamOffsets.add(family.streamOffset);
        usage.sourceFamilies.push(family);
      }
    }
  }

  return byFamily;
}

function familyFrameSummary(frameUsage) {
  if (!frameUsage) {
    return {
      subrecordCount: 0,
      pieceRecordCount: 0,
      referenceCount: 0,
      streamOffsets: [],
      frameRegions: [],
      subrecords: [],
    };
  }
  const subrecords = [...frameUsage.subrecords.values()].sort((a, b) => String(a.offset).localeCompare(String(b.offset)));
  const frameRegions = uniqueSorted(subrecords.map(subrecord => subrecord.region?.id)).map(id => {
    const first = subrecords.find(subrecord => subrecord.region?.id === id);
    return first?.region || null;
  }).filter(Boolean);
  return {
    subrecordCount: subrecords.length,
    pieceRecordCount: subrecords.reduce((sum, subrecord) => sum + subrecord.pieceRecordCount, 0),
    referenceCount: subrecords.reduce((sum, subrecord) => sum + subrecord.referenceCount, 0),
    streamOffsets: [...frameUsage.streamOffsets].sort(),
    frameRegions,
    subrecords,
  };
}

function buildRootTableIndex(rootSemanticsCatalog) {
  const childTables = new Map();
  for (const table of rootSemanticsCatalog.childTables || []) {
    childTables.set(table.rootEntry, table);
  }
  return childTables;
}

function buildCatalog(mapData) {
  const animationFamilyCatalog = requireCatalog(mapData, 'animationFamilyCatalogs', sourceIds.animationFamilies);
  const callsiteCatalog = requireCatalog(mapData, 'animationCallsiteCatalogs', sourceIds.callsites);
  const rootSemanticsCatalog = requireCatalog(mapData, 'animationRootSemanticsCatalogs', sourceIds.rootSemantics);
  const frameUsageCatalog = requireCatalog(mapData, 'metaspriteCatalogs', sourceIds.frameUsage);
  const frameByFamily = buildFrameFamilyIndex(frameUsageCatalog);
  const childTables = buildRootTableIndex(rootSemanticsCatalog);

  const families = (animationFamilyCatalog.families || [])
    .filter(family => frameByFamily.has(family.id))
    .map(family => {
      const rootEntry = family.rootEntry;
      const usage = rootInfo(rootEntry);
      const frames = familyFrameSummary(frameByFamily.get(family.id));
      const callsitePair = (callsiteCatalog.entityStartSelectorPairs?.resolved || [])
        .find(pair => pair.rootEntry === family.rootEntry && pair.childEntry === family.childEntry) || null;
      const callsiteReferences = (family.callsiteReferences || callsitePair?.references || []).map(compactCallsiteReference);
      return {
        id: family.id,
        kind: family.kind || 'entity_animation_family',
        usageClass: usage.usageClass,
        usageConfidence: usage.confidence,
        selectorPair: family.selectorPair,
        selectorPairKey: selectorPairKey(family.selectorPair),
        rootEntry: family.rootEntry,
        childEntry: family.childEntry,
        childTable: childTables.get(family.rootEntry)
          ? {
              rootEntry: childTables.get(family.rootEntry).rootEntry,
              label: childTables.get(family.rootEntry).label,
              romOffset: childTables.get(family.rootEntry).romOffset,
              count: childTables.get(family.rootEntry).count,
              playerAccessible: Boolean(childTables.get(family.rootEntry).playerAccessible),
            }
          : null,
        selectedTarget: compactSelectedTarget(family.selectedTarget || callsitePair?.selectedTarget || null),
        callsiteReferences,
        routineOffsets: uniqueSorted(callsiteReferences.map(ref => ref.routineOffset)),
        routineLabels: uniqueSorted(callsiteReferences.map(ref => ref.routine)),
        streamOffsets: uniqueSorted([
          ...frames.streamOffsets,
          ...(family.streams || []).map(stream => stream.offset),
        ]),
        streamCount: uniqueSorted([
          ...frames.streamOffsets,
          ...(family.streams || []).map(stream => stream.offset),
        ]).length,
        frameSubrecordCount: frames.subrecordCount,
        framePieceRecordCount: frames.pieceRecordCount,
        frameReferenceCount: frames.referenceCount,
        frameRegions: frames.frameRegions,
        frameSubrecords: frames.subrecords.slice(0, 24),
        roleBasis: usage.basis,
        evidence: [
          `Family ${family.id} is selected by root/child ${selectorPairKey(family.selectorPair)} before _LABEL_1318_.`,
          `${sourceIds.frameUsage} classifies its frame subrecords as non_room_animation_family, not room_entity_linked.`,
          callsiteReferences.length
            ? `Callsite evidence includes ${callsiteReferences.map(ref => `${ref.routine} at ${ref.routineOffset}`).join(', ')}.`
            : 'Callsite evidence is inherited from animation-family/root semantics catalogs.',
        ],
      };
    }).sort((a, b) => a.rootEntry - b.rootEntry || a.childEntry - b.childEntry);

  const uniqueSubrecords = new Map();
  for (const family of families) {
    for (const subrecord of family.frameSubrecords || []) uniqueSubrecords.set(subrecord.id, subrecord);
  }
  const rootGroups = [...new Set(families.map(family => family.rootEntry))]
    .sort((a, b) => a - b)
    .map(rootEntry => {
      const rootFamilies = families.filter(family => family.rootEntry === rootEntry);
      const subrecords = new Map();
      for (const family of rootFamilies) {
        for (const subrecord of family.frameSubrecords || []) subrecords.set(subrecord.id, subrecord);
      }
      const usage = rootInfo(rootEntry);
      return {
        rootEntry,
        selectorRoot: `0x${rootEntry.toString(16).toUpperCase().padStart(2, '0')}`,
        usageClass: usage.usageClass,
        usageConfidence: usage.confidence,
        roleBasis: usage.basis,
        childTable: rootFamilies[0]?.childTable || null,
        familyCount: rootFamilies.length,
        childEntries: rootFamilies.map(family => family.childEntry).sort((a, b) => a - b),
        routineCount: uniqueSorted(rootFamilies.flatMap(family => family.routineLabels)).length,
        routines: uniqueSorted(rootFamilies.flatMap(family => family.routineLabels)),
        frameSubrecordCount: subrecords.size,
        framePieceRecordCount: [...subrecords.values()].reduce((sum, subrecord) => sum + subrecord.pieceRecordCount, 0),
        streamCount: uniqueSorted(rootFamilies.flatMap(family => family.streamOffsets)).length,
        familyIds: rootFamilies.map(family => family.id),
      };
    });

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      animationFamilyCatalog.id,
      callsiteCatalog.id,
      rootSemanticsCatalog.id,
      frameUsageCatalog.id,
    ],
    assetPolicy: 'Metadata only: selector roots/children, ASM labels and line references, routine/region ids, stream offsets, frame subrecord ids, counts, and evidence. No ROM bytes, decoded sprite coordinates, graphics, text, music, screenshots, or rendered assets are embedded.',
    classificationRules: {
      includedFamilies: 'Only animation families whose high-confidence frame subrecords are classified as non_room_animation_family by world-animation-frame-subrecord-usage-catalog-2026-06-26 are included.',
      rootUsageConfidence: 'Root usage class names are medium-confidence runtime-owner groupings inferred from current code-region labels and explicit _LABEL_1318_ selector writes, not final gameplay names.',
      excludedRoomEntities: 'Root 0x02 room-entity families are excluded because they are already represented by world-room-entity-frame-asset-link-catalog-2026-06-25.',
    },
    rootGroups,
    families,
    summary: {
      nonRoomFamilyCount: families.length,
      rootCount: rootGroups.length,
      rootUsageClassCounts: countBy(rootGroups, group => group.usageClass),
      familyUsageClassCounts: countBy(families, family => family.usageClass),
      selectorPairCounts: countBy(families, family => family.selectorPairKey),
      uniqueFrameSubrecords: uniqueSubrecords.size,
      uniqueFramePieceRecords: [...uniqueSubrecords.values()].reduce((sum, subrecord) => sum + subrecord.pieceRecordCount, 0),
      streamCount: uniqueSorted(families.flatMap(family => family.streamOffsets)).length,
      routineCount: uniqueSorted(families.flatMap(family => family.routineLabels)).length,
      scriptRegionCount: uniqueSorted(families.map(family => family.selectedTarget?.childEntry?.region?.id)).length,
      frameRegionCount: uniqueSorted(families.flatMap(family => family.frameRegions.map(region => region.id))).length,
      sourceNonRoomSubrecords: frameUsageCatalog.summary?.usageClassCounts?.non_room_animation_family || 0,
      assetPolicy: 'Metadata only: selector roots/children, ASM labels and line references, routine/region ids, stream offsets, frame subrecord ids, counts, and evidence. No ROM bytes, decoded sprite coordinates, graphics, text, music, screenshots, or rendered assets are embedded.',
    },
    evidence: [
      'world-animation-callsite-catalog-2026-06-25 resolves immediate IX+14/IX+15 writes near _LABEL_1318_ calls.',
      'world-animation-root-semantics-catalog-2026-06-25 confirms _DATA_18718_ root-table and child-table indexes are zero-based.',
      'world-animation-frame-subrecord-usage-catalog-2026-06-26 separates room-entity-linked frame subrecords from non-room animation-family frame subrecords.',
    ],
    nextLeads: [
      'Trace root 0x01 scheduler RAM fields to determine whether those frames are item effects, auxiliary player effects, or room objects.',
      'Trace root 0x04 bank-2 scene scheduler callers through _RAM_D1AE_/_RAM_D1AF_ to bind children 1-9 to concrete scene/transition states.',
      'Use the root split to keep player/form root 0 and room-entity root 2 render fixtures separate from non-room auxiliary actors.',
    ],
  };
}

function pushUsage(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function applyCatalog(mapData, catalog) {
  for (const region of mapData.regions || []) {
    if (region.analysis?.animationNonRoomRootUsageAudit?.catalogId === catalogId) {
      delete region.analysis.animationNonRoomRootUsageAudit;
    }
  }

  const byCodeRegion = new Map();
  const byScriptRegion = new Map();
  const byTableRegion = new Map();

  for (const family of catalog.families || []) {
    const compact = {
      familyId: family.id,
      selectorPair: family.selectorPair,
      usageClass: family.usageClass,
      usageConfidence: family.usageConfidence,
      childTableLabel: family.childTable?.label || '',
      scriptOffset: family.selectedTarget?.childEntry?.romOffset || '',
      frameSubrecordCount: family.frameSubrecordCount,
      framePieceRecordCount: family.framePieceRecordCount,
      streamOffsets: family.streamOffsets,
      routineLabels: family.routineLabels,
    };
    for (const ref of family.callsiteReferences || []) pushUsage(byCodeRegion, ref.region?.id, { ...compact, callsite: ref });
    pushUsage(byScriptRegion, family.selectedTarget?.childEntry?.region?.id, compact);
    const tableRegion = family.selectedTarget?.childTable?.romOffset
      ? (mapData.regions || []).find(region => region.offset === family.selectedTarget.childTable.romOffset)
      : null;
    pushUsage(byTableRegion, tableRegion?.id, compact);
  }

  const regionUpdates = [];
  for (const [regionId, usages] of [...byCodeRegion, ...byScriptRegion, ...byTableRegion]) {
    const region = findRegionById(mapData, regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.animationNonRoomRootUsageAudit = {
      catalogId,
      kind: byCodeRegion.has(regionId)
        ? 'non_room_animation_selector_callsite_region'
        : byScriptRegion.has(regionId)
          ? 'non_room_animation_script_region'
          : 'non_room_animation_child_table_region',
      confidence: usages.some(usage => usage.usageConfidence !== 'medium') ? 'medium' : 'medium',
      summary: 'Region participates in a non-room animation selector family whose frame subrecords are not part of the room-entity bridge.',
      familyCount: uniqueSorted(usages.map(usage => usage.familyId)).length,
      usageClassCounts: countBy(usages, usage => usage.usageClass),
      selectorPairs: uniqueSorted(usages.map(usage => selectorPairKey(usage.selectorPair))),
      frameSubrecordCount: usages.reduce((sum, usage) => sum + (usage.frameSubrecordCount || 0), 0),
      framePieceRecordCount: usages.reduce((sum, usage) => sum + (usage.framePieceRecordCount || 0), 0),
      families: usages.slice(0, 24),
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    regionUpdates.push({
      region: regionRef(region),
      kind: region.analysis.animationNonRoomRootUsageAudit.kind,
      familyCount: region.analysis.animationNonRoomRootUsageAudit.familyCount,
      selectorPairs: region.analysis.animationNonRoomRootUsageAudit.selectorPairs,
    });
  }

  mapData.animationRootUsageCatalogs = (mapData.animationRootUsageCatalogs || []).filter(item => item.id !== catalogId);
  mapData.animationRootUsageCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'animation_nonroom_root_usage_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedRegions: regionUpdates.length,
    },
    rootGroups: catalog.rootGroups,
    familySamples: catalog.families.slice(0, 16).map(family => ({
      familyId: family.id,
      selectorPair: family.selectorPair,
      usageClass: family.usageClass,
      routineLabels: family.routineLabels,
      scriptOffset: family.selectedTarget?.childEntry?.romOffset || '',
      frameSubrecordCount: family.frameSubrecordCount,
      framePieceRecordCount: family.framePieceRecordCount,
      streamOffsets: family.streamOffsets,
    })),
    regionUpdates,
    classificationRules: catalog.classificationRules,
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
    rootGroups: catalog.rootGroups.map(group => ({
      rootEntry: group.rootEntry,
      usageClass: group.usageClass,
      familyCount: group.familyCount,
      frameSubrecordCount: group.frameSubrecordCount,
      routines: group.routines,
    })),
  }, null, 2));
}

main();
