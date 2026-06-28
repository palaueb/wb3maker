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
const catalogId = 'world-animation-family-catalog-2026-06-25';
const reportId = 'animation-family-audit-2026-06-25';
const toolName = 'tools/world-animation-family-audit.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function normOffset(value) {
  if (value == null) return null;
  if (typeof value === 'number') return hex(value);
  return '0x' + String(value).replace(/^0x/i, '').toUpperCase().padStart(5, '0');
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findContainingRegion(mapData, offset) {
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

function regionRefAt(mapData, offsetString) {
  const normalized = normOffset(offsetString);
  if (!normalized) return null;
  return regionRef(findContainingRegion(mapData, parseInt(normalized, 16)));
}

function requireCatalog(mapData, key, id) {
  const catalog = (mapData[key] || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required catalog ${key}.${id}`);
  return catalog;
}

function indexMetaspriteCatalog(metaspriteCatalog) {
  const variantByOffset = new Map();
  const streamByOffset = new Map();
  for (const table of metaspriteCatalog.variantTables || []) {
    variantByOffset.set(normOffset(table.tableOffset), table);
  }
  for (const stream of metaspriteCatalog.parsedStreams || []) {
    streamByOffset.set(normOffset(stream.offset), stream);
  }
  return { variantByOffset, streamByOffset };
}

function groupFrameTargets(frameTargets) {
  const byRegion = new Map();
  const byOffset = new Map();
  for (const target of frameTargets) {
    const offset = normOffset(target.romOffset);
    if (offset) {
      if (!byOffset.has(offset)) {
        byOffset.set(offset, {
          offset,
          region: target.region || null,
          referenceCount: 0,
          sourceScriptOffsets: new Set(),
        });
      }
      const offsetItem = byOffset.get(offset);
      offsetItem.referenceCount++;
      if (target.sourceScriptOffset) offsetItem.sourceScriptOffsets.add(normOffset(target.sourceScriptOffset));
    }

    const regionId = target.region?.id || `unmapped:${offset || 'unknown'}`;
    if (!byRegion.has(regionId)) {
      byRegion.set(regionId, {
        region: target.region || null,
        referenceCount: 0,
        targetOffsets: new Set(),
        sourceScriptOffsets: new Set(),
      });
    }
    const regionItem = byRegion.get(regionId);
    regionItem.referenceCount++;
    if (offset) regionItem.targetOffsets.add(offset);
    if (target.sourceScriptOffset) regionItem.sourceScriptOffsets.add(normOffset(target.sourceScriptOffset));
  }

  return {
    byRegion: [...byRegion.values()]
      .sort((a, b) => (a.region?.offset || '').localeCompare(b.region?.offset || ''))
      .map(item => ({
        region: item.region,
        referenceCount: item.referenceCount,
        targetOffsets: [...item.targetOffsets].sort().slice(0, 32),
        uniqueTargetOffsets: item.targetOffsets.size,
        sourceScriptOffsets: [...item.sourceScriptOffsets].sort().slice(0, 16),
      })),
    byOffset: [...byOffset.values()]
      .sort((a, b) => a.offset.localeCompare(b.offset))
      .map(item => ({
        offset: item.offset,
        region: item.region,
        referenceCount: item.referenceCount,
        sourceScriptOffsets: [...item.sourceScriptOffsets].sort().slice(0, 16),
      })),
  };
}

function streamSummary(stream) {
  if (!stream) return null;
  const frameTargets = stream.frameTargets || [];
  const grouped = groupFrameTargets(frameTargets);
  return {
    id: stream.id,
    offset: normOffset(stream.offset),
    region: stream.region || null,
    references: (stream.references || []).slice(0, 12),
    commandCount: stream.commandCount || 0,
    jumpCount: stream.jumpCount || 0,
    frameTargetCount: stream.frameTargetCount || frameTargets.length,
    warningCount: (stream.warnings || []).length,
    warnings: (stream.warnings || []).slice(0, 8),
    frameTargetRegions: grouped.byRegion.slice(0, 24),
  };
}

function buildFamily(mapData, indexes, pair) {
  const childEntry = pair.selectedTarget?.childEntry || null;
  const targetOffset = normOffset(childEntry?.romOffset);
  const variantTable = targetOffset ? indexes.variantByOffset.get(targetOffset) : null;
  const targetInterpretation = variantTable ? 'variant_table' : 'direct_command_stream_candidate';
  const scriptRefs = [];

  if (variantTable) {
    for (const entry of variantTable.entries || []) {
      scriptRefs.push({
        variantIndex: entry.index,
        entryOffset: normOffset(entry.entryOffset),
        z80Pointer: entry.z80Pointer,
        scriptOffset: normOffset(entry.romOffset),
        region: entry.region || regionRefAt(mapData, entry.romOffset),
      });
    }
  } else if (targetOffset) {
    scriptRefs.push({
      variantIndex: null,
      entryOffset: null,
      z80Pointer: childEntry?.z80Pointer || null,
      scriptOffset: targetOffset,
      region: childEntry?.region || regionRefAt(mapData, targetOffset),
    });
  }

  const uniqueScriptOffsets = [...new Set(scriptRefs.map(ref => ref.scriptOffset).filter(Boolean))].sort();
  const streams = uniqueScriptOffsets.map(offset => streamSummary(indexes.streamByOffset.get(offset))).filter(Boolean);
  const streamFrameTargets = streams.flatMap(stream => {
    const parsed = indexes.streamByOffset.get(stream.offset);
    return parsed?.frameTargets || [];
  });
  const frameTargetGroups = groupFrameTargets(streamFrameTargets);
  const warnings = streams.flatMap(stream => stream.warnings.map(warning => ({
    streamOffset: stream.offset,
    warning,
  })));

  const familyId = `entity_anim_family_r${pair.rootEntry}_c${pair.childEntry}`;
  return {
    id: familyId,
    kind: 'entity_animation_family',
    confidence: 'high',
    frameTargetConfidence: warnings.length ? 'medium' : 'high',
    selectorPair: pair.selectorPair,
    rootEntry: pair.rootEntry,
    childEntry: pair.childEntry,
    callsiteReferences: pair.references || [],
    targetInterpretation,
    selectedTarget: {
      childTable: pair.selectedTarget?.childTable || null,
      childEntry: childEntry ? {
        index: childEntry.index,
        entryOffset: normOffset(childEntry.entryOffset),
        z80Pointer: childEntry.z80Pointer,
        romOffset: targetOffset,
        region: childEntry.region || regionRefAt(mapData, targetOffset),
        targetInterpretation: childEntry.targetInterpretation || targetInterpretation,
      } : null,
    },
    variantTable: variantTable ? {
      tableOffset: normOffset(variantTable.tableOffset),
      entryCount: variantTable.entryCount,
      byteLength: variantTable.byteLength,
      region: variantTable.region || regionRefAt(mapData, variantTable.tableOffset),
      entries: scriptRefs,
      references: variantTable.references || [],
    } : null,
    directScript: variantTable ? null : {
      offset: targetOffset,
      region: childEntry?.region || regionRefAt(mapData, targetOffset),
    },
    streams,
    frameTargetRegions: frameTargetGroups.byRegion,
    frameTargets: frameTargetGroups.byOffset.slice(0, 96),
    warnings: warnings.slice(0, 32),
    summary: {
      callsiteReferences: (pair.references || []).length,
      variantEntries: variantTable?.entryCount || 0,
      uniqueScriptOffsets: uniqueScriptOffsets.length,
      parsedStreams: streams.length,
      parsedCommands: streams.reduce((sum, stream) => sum + (stream.commandCount || 0), 0),
      framePointerReferences: streamFrameTargets.length,
      uniqueFrameTargetOffsets: frameTargetGroups.byOffset.length,
      frameTargetRegions: frameTargetGroups.byRegion.length,
      warningStreams: streams.filter(stream => stream.warningCount).length,
    },
    evidence: [
      `Selector pair ${pair.selectorPair.root}/${pair.selectorPair.child} is confirmed by nearby IX+14/IX+15 writes before _LABEL_1318_ callsites.`,
      'world-animation-root-semantics-catalog-2026-06-25 confirms zero-based _DATA_18718_ and child-table indexing via _LABEL_8_ / RST $08.',
      'world-metasprite-catalog-2026-06-24 provides variant-table, command-stream, and frame-target metadata used for this cross-link.',
    ],
  };
}

function buildCatalog(mapData) {
  const callsiteCatalog = requireCatalog(mapData, 'animationCallsiteCatalogs', 'world-animation-callsite-catalog-2026-06-25');
  const rootCatalog = requireCatalog(mapData, 'animationRootSemanticsCatalogs', 'world-animation-root-semantics-catalog-2026-06-25');
  const metaspriteCatalog = requireCatalog(mapData, 'metaspriteCatalogs', 'world-metasprite-catalog-2026-06-24');
  const indexes = indexMetaspriteCatalog(metaspriteCatalog);
  const families = (callsiteCatalog.entityStartSelectorPairs?.resolved || []).map(pair => buildFamily(mapData, indexes, pair));

  const uniqueVariantTables = new Set(families.map(family => family.variantTable?.tableOffset).filter(Boolean));
  const uniqueScripts = new Set(families.flatMap(family => family.streams.map(stream => stream.offset)));
  const uniqueFrameRegions = new Set(families.flatMap(family => family.frameTargetRegions.map(item => item.region?.id).filter(Boolean)));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      callsiteCatalog.id,
      rootCatalog.id,
      metaspriteCatalog.id,
    ],
    assetPolicy: 'Metadata only: selector pairs, labels, offsets, region ids, stream/frame counts, and ASM/catalog evidence. No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    semantics: {
      rootTable: rootCatalog.rootTable?.label || '_DATA_18718_',
      indexBase: rootCatalog.summary?.pointerIndexBase || 'zero_based',
      entityStartRoutine: '_LABEL_1318_',
      streamDecoderRoutine: '_LABEL_1347_',
    },
    families,
    unresolvedEntityStartCalls: callsiteCatalog.entityStartSelectorPairs?.unresolved || [],
    summary: {
      familyCount: families.length,
      variantTableFamilies: families.filter(family => family.variantTable).length,
      directScriptFamilies: families.filter(family => family.directScript).length,
      uniqueVariantTables: uniqueVariantTables.size,
      uniqueScriptOffsets: uniqueScripts.size,
      parsedStreams: families.reduce((sum, family) => sum + family.summary.parsedStreams, 0),
      parsedCommands: families.reduce((sum, family) => sum + family.summary.parsedCommands, 0),
      framePointerReferences: families.reduce((sum, family) => sum + family.summary.framePointerReferences, 0),
      uniqueFrameTargetRegions: uniqueFrameRegions.size,
      unresolvedEntityStartCalls: callsiteCatalog.entityStartSelectorPairs?.unresolvedCount || 0,
      assetPolicy: 'Metadata only: selector pairs, labels, offsets, region ids, stream/frame counts, and ASM/catalog evidence. No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    },
  };
}

function compactFamilyRef(family, role, extra = {}) {
  return {
    catalogId,
    familyId: family.id,
    role,
    selectorPair: family.selectorPair,
    confidence: role === 'metasprite_frame_target_candidate' ? family.frameTargetConfidence : family.confidence,
    rootEntry: family.rootEntry,
    childEntry: family.childEntry,
    ...extra,
  };
}

function addRegionAnnotation(region, refs) {
  region.analysis = region.analysis || {};
  const existing = region.analysis.animationFamilyAudit || {};
  const preserved = (existing.families || []).filter(ref => ref.catalogId !== catalogId);
  const nextRefs = [...preserved, ...refs];
  region.analysis.animationFamilyAudit = {
    kind: 'animation_family_linked_region',
    catalogId,
    confidence: nextRefs.some(ref => ref.confidence === 'medium') ? 'medium' : 'high',
    summary: 'Region is linked to one or more confirmed entity animation selector families.',
    families: nextRefs.slice(0, 64),
    evidence: [
      'Animation family links are derived from confirmed _LABEL_1318_ selector pairs and the existing metasprite command-stream catalog.',
      'No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    name: region.name || '',
    type: region.type || 'unknown',
    familyRefs: refs.length,
  };
}

function annotateMap(mapData, catalog) {
  const refsByRegionId = new Map();
  const missingRegions = [];

  function addRef(regionLike, ref, fallbackOffset = null) {
    let region = null;
    if (regionLike?.id) region = findRegionById(mapData, regionLike.id);
    if (!region && fallbackOffset) region = findContainingRegion(mapData, parseInt(normOffset(fallbackOffset), 16));
    if (!region) {
      missingRegions.push({ familyId: ref.familyId, role: ref.role, offset: fallbackOffset ? normOffset(fallbackOffset) : null });
      return;
    }
    if (!refsByRegionId.has(region.id)) refsByRegionId.set(region.id, { region, refs: [] });
    refsByRegionId.get(region.id).refs.push(ref);
  }

  for (const family of catalog.families) {
    if (family.variantTable) {
      addRef(family.variantTable.region, compactFamilyRef(family, 'selected_variant_table', {
        tableOffset: family.variantTable.tableOffset,
        variantEntries: family.variantTable.entryCount,
      }), family.variantTable.tableOffset);
    } else if (family.directScript) {
      addRef(family.directScript.region, compactFamilyRef(family, 'direct_command_stream', {
        scriptOffset: family.directScript.offset,
      }), family.directScript.offset);
    }

    for (const stream of family.streams) {
      addRef(stream.region, compactFamilyRef(family, 'animation_command_stream', {
        streamOffset: stream.offset,
        commandCount: stream.commandCount,
        frameTargetCount: stream.frameTargetCount,
        warningCount: stream.warningCount,
      }), stream.offset);
    }

    for (const targetRegion of family.frameTargetRegions) {
      addRef(targetRegion.region, compactFamilyRef(family, 'metasprite_frame_target_candidate', {
        referenceCount: targetRegion.referenceCount,
        uniqueTargetOffsets: targetRegion.uniqueTargetOffsets,
        targetOffsets: targetRegion.targetOffsets.slice(0, 12),
      }), targetRegion.targetOffsets[0] || null);
    }
  }

  const annotatedRegions = [];
  for (const { region, refs } of refsByRegionId.values()) {
    annotatedRegions.push(addRegionAnnotation(region, refs));
  }
  return { annotatedRegions, missingRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let annotation = { annotatedRegions: [], missingRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    const finalCatalog = buildCatalog(mapData);
    mapData.animationFamilyCatalogs = (mapData.animationFamilyCatalogs || []).filter(item => item.id !== catalogId);
    mapData.animationFamilyCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'animation_family_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: finalCatalog.sourceCatalogs,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotation.annotatedRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      familySummary: finalCatalog.families.map(family => ({
        id: family.id,
        selectorPair: family.selectorPair,
        targetInterpretation: family.targetInterpretation,
        selectedTarget: family.selectedTarget,
        summary: family.summary,
        callsiteReferences: family.callsiteReferences,
      })),
      annotatedRegions: annotation.annotatedRegions,
      missingRegions: annotation.missingRegions,
      nextLeads: [
        'Trace the 40 unresolved _LABEL_1318_ starts back to dynamic IX+14/IX+15 sources and add them to this family graph.',
        'Split the medium-confidence frame-target links by decoding the metasprite frame record format and stopping command-stream parsing at real terminators.',
        'Connect animation families to entity behavior/init table entries so each enemy/object can be named by runtime class and asset family.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: annotation.annotatedRegions.length,
    missingRegions: annotation.missingRegions.length,
  }, null, 2));
}

main();
