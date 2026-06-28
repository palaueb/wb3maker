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
const catalogId = 'world-zone-loader-caller-context-catalog-2026-06-25';
const reportId = 'zone-loader-caller-context-audit-2026-06-25';
const toolName = 'tools/world-zone-loader-caller-context-audit.mjs';

const commonPrereqCatalogId = 'world-zone-common-prereq-provenance-catalog-2026-06-25';
const zoneRecipeCatalogId = 'world-zone-recipe-catalog-2026-06-25';
const inlineTransitionRecipeCatalogId = 'world-inline-transition-recipe-catalog-2026-06-25';
const overlayIndexBoundCatalogId = 'world-room-overlay-index-bound-catalog-2026-06-25';
const zoneLoaderLabel = '_LABEL_2620_';
const common8fbLabel = '_DATA_2A55_';
const common998Label = '_DATA_2AE2_';
const descriptorPointerLabels = ['_RAM_CFFA_', '_RAM_C26C_'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function ramAddress(label) {
  const match = /^_RAM_([0-9A-F]+)_$/i.exec(label || '');
  return match ? '$' + match[1].toUpperCase() : null;
}

function labelOffset(label) {
  const match = /^_LABEL_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function dataLabelOffset(label) {
  const match = /^_DATA_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
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

function findRamByAddress(mapData, address) {
  return (mapData.ram || []).find(entry =>
    String(entry.address || '').toUpperCase() === String(address || '').toUpperCase()
  ) || null;
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
    size: entry.size || 1,
    type: entry.type || 'byte',
    name: entry.name || '',
  };
}

function catalogById(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item?.id === id);
    if (found) return found;
  }
  return null;
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function collectRoutineRanges(lines, mapData) {
  const labels = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_LABEL_[0-9A-F]+_):/.exec(lines[i]);
    if (!match) continue;
    const offset = labelOffset(match[1]);
    labels.push({
      label: match[1],
      offset,
      offsetHex: offset == null ? null : hex(offset),
      line: i + 1,
      startIndex: i,
      sourceRegion: offset == null ? null : regionRef(findContainingRegion(mapData, offset)),
    });
  }
  for (let i = 0; i < labels.length; i++) {
    labels[i].endIndex = i + 1 < labels.length ? labels[i + 1].startIndex : lines.length;
    labels[i].endLine = labels[i].endIndex;
  }
  return labels;
}

function routineForLine(routines, lineIndex) {
  let current = null;
  for (const routine of routines) {
    if (routine.startIndex <= lineIndex && lineIndex < routine.endIndex) {
      current = routine;
      break;
    }
  }
  return current;
}

function findPreviousHlLoad(lines, startIndex, callIndex) {
  for (let i = callIndex - 1; i >= Math.max(startIndex, callIndex - 10); i--) {
    const code = cleanCode(lines[i]);
    const match = /^ld\s+hl,\s*(.+)$/i.exec(code);
    if (match) return { line: i + 1, code, target: match[1].trim() };
  }
  return null;
}

function findLoaderPairBefore(lines, startIndex, callIndex, dataLabel, callLabel) {
  let latest = null;
  for (let i = startIndex; i < callIndex; i++) {
    const code = cleanCode(lines[i]);
    if (!new RegExp(`^ld\\s+hl,\\s*${dataLabel}\\s*$`, 'i').test(code)) continue;
    for (let j = i + 1; j < callIndex && j < i + 8; j++) {
      const next = cleanCode(lines[j]);
      if (!next) continue;
      if (new RegExp(`^call\\s+${callLabel}\\s*$`, 'i').test(next)) {
        latest = {
          dataLabel,
          loadLine: i + 1,
          loadCode: code,
          callLine: j + 1,
          callCode: next,
        };
        break;
      }
      if (/^ld\s+hl,/i.test(next) || /^(ret|jp|jr)\b/i.test(next)) break;
    }
  }
  return latest;
}

function describeDescriptorSource(mapData, hlLoad) {
  const target = hlLoad?.target || '';
  const dataMatch = /^(_DATA_[0-9A-F]+_)$/i.exec(target);
  if (dataMatch) {
    const offset = dataLabelOffset(dataMatch[1]);
    return {
      kind: 'literal_descriptor_label',
      target,
      romOffset: offset == null ? null : hex(offset),
      region: offset == null ? null : regionRef(findContainingRegion(mapData, offset)),
    };
  }
  const ramMatch = /^\((_RAM_[0-9A-F]+_)\)$/i.exec(target);
  if (ramMatch) {
    const address = ramAddress(ramMatch[1]);
    return {
      kind: 'ram_descriptor_pointer',
      target,
      ramLabel: ramMatch[1],
      address,
      ramEntry: ramRef(findRamByAddress(mapData, address)),
    };
  }
  return {
    kind: target ? 'other_hl_source' : 'unknown',
    target: target || null,
  };
}

function findRecipeByDescriptorOffset(recipes, offset) {
  return (recipes || []).find(recipe => parseHex(recipe?.descriptor?.romOffset) === offset) || null;
}

function compactRecipe(recipe) {
  if (!recipe) return null;
  return {
    id: recipe.id || '',
    descriptorOffset: recipe.descriptor?.romOffset || '',
    subrecordOffset: recipe.subrecord?.romOffset || '',
    confidence: recipe.confidence || '',
  };
}

function descriptorRecipeCoverage(mapData, source) {
  if (source.kind === 'literal_descriptor_label') {
    const offset = parseHex(source.romOffset);
    const zoneRecipe = findRecipeByDescriptorOffset(mapData.zoneRecipes, offset);
    const inlineRecipe = findRecipeByDescriptorOffset(mapData.inlineTransitionRecipes, offset);
    return {
      status: zoneRecipe || inlineRecipe ? 'literal_descriptor_recipe_resolved' : 'literal_descriptor_recipe_missing',
      coverageKind: 'literal_descriptor',
      zoneRecipe: compactRecipe(zoneRecipe),
      inlineTransitionRecipe: compactRecipe(inlineRecipe),
      evidence: zoneRecipe || inlineRecipe
        ? 'Literal descriptor offset is present in the reusable recipe catalogs.'
        : 'Literal descriptor offset is not present in the current reusable recipe catalogs.',
    };
  }
  if (source.kind === 'ram_descriptor_pointer' && source.ramLabel === '_RAM_CFFA_') {
    return {
      status: 'dynamic_descriptor_pointer_cataloged_by_zone_recipes',
      coverageKind: 'ram_pointer',
      sourceRam: source.ramLabel,
      catalogs: [zoneRecipeCatalogId],
      evidence: '_RAM_CFFA_ is a current room descriptor pointer used by trigger-driven zone recipe paths; individual runtime values remain dynamic at the callsite.',
    };
  }
  if (source.kind === 'ram_descriptor_pointer' && source.ramLabel === '_RAM_C26C_') {
    return {
      status: 'dynamic_descriptor_cursor_cataloged_by_transition_recipes',
      coverageKind: 'ram_pointer',
      sourceRam: source.ramLabel,
      catalogs: [zoneRecipeCatalogId, inlineTransitionRecipeCatalogId],
      evidence: '_RAM_C26C_ is a deferred/cursor descriptor pointer used by transition paths; current zone and inline transition recipes catalog its known descriptor targets.',
    };
  }
  return {
    status: 'descriptor_recipe_coverage_unresolved',
    coverageKind: 'unknown',
    evidence: 'Descriptor source could not be connected to a reusable recipe catalog.',
  };
}

function classifyCallsite(source, pair8fb, pair998) {
  const hasLocalPair = Boolean(pair8fb && pair998 && pair8fb.callLine < pair998.callLine);
  if (hasLocalPair) return 'local_common_prereq_before_zone_load';
  if (source.kind === 'ram_descriptor_pointer') return 'ram_descriptor_pointer_without_local_common_prereq';
  if (source.kind === 'literal_descriptor_label') return 'literal_descriptor_without_local_common_prereq';
  return 'unknown_descriptor_source_without_local_common_prereq';
}

function collectDirectCallsites(lines, routines, mapData) {
  const callsites = [];
  for (let i = 0; i < lines.length; i++) {
    const code = cleanCode(lines[i]);
    if (!/^call\s+_LABEL_2620_\s*$/i.test(code)) continue;
    const routine = routineForLine(routines, i);
    const hlLoad = findPreviousHlLoad(lines, routine?.startIndex || 0, i);
    const descriptorSource = describeDescriptorSource(mapData, hlLoad);
    const coverage = descriptorRecipeCoverage(mapData, descriptorSource);
    const common8fb = routine ? findLoaderPairBefore(lines, routine.startIndex, i, common8fbLabel, '_LABEL_8FB_') : null;
    const common998 = routine ? findLoaderPairBefore(lines, routine.startIndex, i, common998Label, '_LABEL_998_') : null;
    const classification = classifyCallsite(descriptorSource, common8fb, common998);
    callsites.push({
      callLine: i + 1,
      callCode: code,
      routineLabel: routine?.label || null,
      routineOffset: routine?.offsetHex || null,
      routineStartLine: routine?.line || null,
      routineEndLine: routine?.endLine || null,
      sourceRegion: routine?.sourceRegion || null,
      hlLoad,
      descriptorSource,
      descriptorRecipeCoverage: coverage,
      commonPrereqBeforeCall: {
        localCommonPairBeforeCall: classification === 'local_common_prereq_before_zone_load',
        vramLoader8fb: common8fb,
        vramLoader998: common998,
      },
      classification,
      confidence: classification === 'local_common_prereq_before_zone_load' ? 'high' : 'medium',
      evidence: [
        `ASM line ${i + 1} calls ${zoneLoaderLabel}.`,
        hlLoad ? `ASM line ${hlLoad.line} sets HL via "${hlLoad.code}".` : 'No nearby HL load was found before the call.',
        coverage.evidence,
        classification === 'local_common_prereq_before_zone_load'
          ? `${common8fbLabel}/_LABEL_8FB_ and ${common998Label}/_LABEL_998_ both occur earlier in the same routine before this zone load.`
          : 'No local common-prerequisite loader pair appears earlier in the same routine before this zone load; runtime VRAM persistence remains the required evidence.',
      ],
    });
  }
  return callsites;
}

function collectPointerWriters(lines, routines, mapData) {
  const writers = [];
  const labels = new Set(descriptorPointerLabels);
  for (let i = 0; i < lines.length; i++) {
    const code = cleanCode(lines[i]);
    const match = /^ld\s+\((_RAM_[0-9A-F]+_)\),\s*(.+)$/i.exec(code);
    if (!match || !labels.has(match[1].toUpperCase())) continue;
    const label = match[1].toUpperCase();
    const routine = routineForLine(routines, i);
    const address = ramAddress(label);
    writers.push({
      line: i + 1,
      code,
      ramLabel: label,
      address,
      ramEntry: ramRef(findRamByAddress(mapData, address)),
      sourceValue: match[2].trim(),
      routineLabel: routine?.label || null,
      routineOffset: routine?.offsetHex || null,
      routineStartLine: routine?.line || null,
      routineEndLine: routine?.endLine || null,
      sourceRegion: routine?.sourceRegion || null,
      evidence: `ASM line ${i + 1} writes ${match[2].trim()} to ${label}.`,
    });
  }
  return writers;
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function buildRamPointerSummaries(mapData, callsites, writers) {
  return descriptorPointerLabels.map(label => {
    const address = ramAddress(label);
    const consumers = callsites.filter(site => site.descriptorSource?.ramLabel === label);
    const pointerWriters = writers.filter(writer => writer.ramLabel === label);
    return {
      ramLabel: label,
      address,
      ramEntry: ramRef(findRamByAddress(mapData, address)),
      consumerCallsiteCount: consumers.length,
      writerCount: pointerWriters.length,
      consumerClassifications: countBy(consumers, site => site.classification),
      writers: pointerWriters,
      consumers: consumers.map(site => ({
        callLine: site.callLine,
        routineLabel: site.routineLabel,
        routineOffset: site.routineOffset,
        sourceRegion: site.sourceRegion,
        classification: site.classification,
        localCommonPairBeforeCall: site.commonPrereqBeforeCall.localCommonPairBeforeCall,
      })),
    };
  });
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const routines = collectRoutineRanges(lines, mapData);
  const callsites = collectDirectCallsites(lines, routines, mapData);
  const writers = collectPointerWriters(lines, routines, mapData);
  const commonPrereqCatalog = catalogById(mapData, commonPrereqCatalogId);
  const zoneRecipeCatalog = catalogById(mapData, zoneRecipeCatalogId);
  const inlineTransitionRecipeCatalog = catalogById(mapData, inlineTransitionRecipeCatalogId);
  const overlayIndexBoundCatalog = catalogById(mapData, overlayIndexBoundCatalogId);
  const classificationCounts = countBy(callsites, site => site.classification);
  const descriptorSourceCounts = countBy(callsites, site => site.descriptorSource.kind);
  const descriptorRecipeCoverageCounts = countBy(callsites, site => site.descriptorRecipeCoverage.status);
  const ramPointerSummaries = buildRamPointerSummaries(mapData, callsites, writers);
  const localCommonCount = classificationCounts.local_common_prereq_before_zone_load || 0;
  const noLocalCommonCount = callsites.length - localCommonCount;

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [commonPrereqCatalogId, zoneRecipeCatalogId, inlineTransitionRecipeCatalogId, overlayIndexBoundCatalogId],
    sourceCatalogPresence: {
      commonPrereqProvenanceCatalog: Boolean(commonPrereqCatalog),
      zoneRecipeCatalog: Boolean(zoneRecipeCatalog),
      inlineTransitionRecipeCatalog: Boolean(inlineTransitionRecipeCatalog),
      overlayIndexBoundCatalog: Boolean(overlayIndexBoundCatalog),
    },
    targetRoutine: {
      label: zoneLoaderLabel,
      offset: hex(0x2620),
      region: regionRef(findContainingRegion(mapData, 0x2620)),
    },
    summary: {
      directZoneLoaderCallsiteCount: callsites.length,
      localCommonPrereqBeforeCallCount: localCommonCount,
      noLocalCommonPrereqBeforeCallCount: noLocalCommonCount,
      ramDescriptorPointerCallsiteCount: descriptorSourceCounts.ram_descriptor_pointer || 0,
      literalDescriptorCallsiteCount: descriptorSourceCounts.literal_descriptor_label || 0,
      ramPointerVariableCount: ramPointerSummaries.filter(item => item.consumerCallsiteCount || item.writerCount).length,
      ramPointerWriterCount: writers.length,
      classificationCounts,
      descriptorSourceCounts,
      descriptorRecipeCoverageCounts,
      literalDescriptorRecipeResolvedCount: descriptorRecipeCoverageCounts.literal_descriptor_recipe_resolved || 0,
      dynamicDescriptorCatalogedCallsiteCount:
        (descriptorRecipeCoverageCounts.dynamic_descriptor_pointer_cataloged_by_zone_recipes || 0) +
        (descriptorRecipeCoverageCounts.dynamic_descriptor_cursor_cataloged_by_transition_recipes || 0),
      overlayIndexBoundStatus: overlayIndexBoundCatalog?.summary?.status || null,
      dependencyConclusion: noLocalCommonCount
        ? 'The common VRAM prerequisite pair remains simulation-only for global zone recipes: several _LABEL_2620_ callers consume descriptor pointers from RAM without a local _DATA_2A55_/_DATA_2AE2_ preload in the same routine.'
        : 'All direct _LABEL_2620_ callers have a local common-prerequisite pair before the call.',
      assetPolicy: 'Metadata only: ASM labels, line numbers, routine references, RAM labels/addresses, region ids, and aggregate counts. No ROM bytes, decoded graphics, decoded maps, or rendered assets are embedded.',
    },
    directCallsites: callsites,
    ramPointerVariables: ramPointerSummaries,
    pointerWriters: writers,
    evidence: [
      'Direct _LABEL_2620_ callers are collected from ASM call instructions.',
      'A local common-prerequisite context requires _DATA_2A55_/call _LABEL_8FB_ and _DATA_2AE2_/call _LABEL_998_ earlier in the same routine before the _LABEL_2620_ call.',
      '_RAM_CFFA_ and _RAM_C26C_ are treated as descriptor pointer variables when loaded through HL immediately before _LABEL_2620_.',
      'Literal descriptor callsites are cross-checked against zoneRecipes/inlineTransitionRecipes so direct boot loads point at reusable scene recipes.',
      'The room overlay index-bound catalog is linked when present so loader-callsite coverage can be compared with cataloged _RAM_CF64_ source coverage.',
      'This audit deliberately does not promote common VRAM prerequisites to mandatory recipe dependencies when direct callers rely on RAM-held descriptor pointers without local preload evidence.',
    ],
  };
}

function annotateRegion(region, key, value, annotated) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis[key] = value;
  annotated.push({
    id: region.id,
    offset: region.offset,
    type: region.type || 'unknown',
    name: region.name || '',
  });
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const callerGroups = new Map();
  for (const site of catalog.directCallsites) {
    const id = site.sourceRegion?.id;
    if (!id) continue;
    const group = callerGroups.get(id) || { region: findContainingRegion(mapData, parseHex(site.routineOffset)), callsites: [] };
    group.callsites.push(site);
    callerGroups.set(id, group);
  }

  const targetRegion = findContainingRegion(mapData, 0x2620);
  annotateRegion(targetRegion, 'zoneLoaderCallerContextAudit', {
    catalogId,
    kind: 'zone_loader_direct_caller_context_summary',
    confidence: 'high',
    summary: catalog.summary.dependencyConclusion,
    directZoneLoaderCallsiteCount: catalog.summary.directZoneLoaderCallsiteCount,
    localCommonPrereqBeforeCallCount: catalog.summary.localCommonPrereqBeforeCallCount,
    noLocalCommonPrereqBeforeCallCount: catalog.summary.noLocalCommonPrereqBeforeCallCount,
    classificationCounts: catalog.summary.classificationCounts,
    descriptorRecipeCoverageCounts: catalog.summary.descriptorRecipeCoverageCounts,
    overlayIndexBoundStatus: catalog.summary.overlayIndexBoundStatus,
    ramPointerVariables: catalog.ramPointerVariables.map(item => ({
      ramLabel: item.ramLabel,
      address: item.address,
      ramEntry: item.ramEntry,
      consumerCallsiteCount: item.consumerCallsiteCount,
      writerCount: item.writerCount,
    })),
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  for (const { region, callsites } of callerGroups.values()) {
    const hasLocal = callsites.some(site => site.classification === 'local_common_prereq_before_zone_load');
    annotateRegion(region, 'zoneLoaderCallerContextAudit', {
      catalogId,
      kind: 'zone_loader_direct_caller_context',
      confidence: hasLocal ? 'high' : 'medium',
      summary: hasLocal
        ? 'This routine has at least one direct _LABEL_2620_ call preceded by the local common VRAM prerequisite pair.'
        : 'This routine calls _LABEL_2620_ without a local common VRAM prerequisite pair; it relies on existing/persistent VRAM state.',
      callsiteCount: callsites.length,
      classifications: countBy(callsites, site => site.classification),
      callsites: callsites.map(site => ({
        callLine: site.callLine,
        hlLoad: site.hlLoad,
        descriptorSource: site.descriptorSource,
        descriptorRecipeCoverage: site.descriptorRecipeCoverage,
        classification: site.classification,
        commonPrereqBeforeCall: site.commonPrereqBeforeCall,
      })),
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
  }

  const writerGroups = new Map();
  for (const writer of catalog.pointerWriters) {
    const id = writer.sourceRegion?.id;
    if (!id) continue;
    const group = writerGroups.get(id) || { region: findContainingRegion(mapData, parseHex(writer.routineOffset)), writers: [] };
    group.writers.push(writer);
    writerGroups.set(id, group);
  }
  for (const { region, writers } of writerGroups.values()) {
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.zoneDescriptorPointerWriterAudit = {
      catalogId,
      kind: 'zone_descriptor_pointer_writer',
      confidence: 'medium',
      summary: 'This routine writes a RAM-held descriptor pointer consumed by direct _LABEL_2620_ room-zone load contexts.',
      writerCount: writers.length,
      writers,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      role: 'pointer_writer',
    });
  }

  const annotatedRam = [];
  for (const item of catalog.ramPointerVariables) {
    const entry = findRamByAddress(mapData, item.address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.zoneLoaderPointerContextAudit = {
      catalogId,
      kind: 'zone_descriptor_pointer_ram',
      confidence: 'high',
      ramLabel: item.ramLabel,
      summary: 'RAM-held room-zone descriptor pointer consumed by _LABEL_2620_ caller contexts.',
      consumerCallsiteCount: item.consumerCallsiteCount,
      writerCount: item.writerCount,
      consumerClassifications: item.consumerClassifications,
      writers: item.writers.map(writer => ({
        line: writer.line,
        routineLabel: writer.routineLabel,
        routineOffset: writer.routineOffset,
        sourceRegion: writer.sourceRegion,
        sourceValue: writer.sourceValue,
      })),
      consumers: item.consumers,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRam.push({
      id: entry.id,
      address: entry.address,
      name: entry.name || '',
      consumerCallsiteCount: item.consumerCallsiteCount,
      writerCount: item.writerCount,
    });
  }

  return {
    annotatedRegions,
    annotatedRam,
  };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  let annotation = { annotatedRegions: [], annotatedRam: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_loader_caller_context_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      sourceCatalogPresence: catalog.sourceCatalogPresence,
      targetRoutine: catalog.targetRoutine,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotation.annotatedRegions.length,
        annotatedRamCount: annotation.annotatedRam.length,
      },
      directCallsites: catalog.directCallsites,
      ramPointerVariables: catalog.ramPointerVariables,
      pointerWriters: catalog.pointerWriters,
      annotatedRegions: annotation.annotatedRegions,
      annotatedRam: annotation.annotatedRam,
      evidence: catalog.evidence,
      nextLeads: [
        'Trace runtime paths through the RAM-pointer callsites to prove whether _DATA_2A55_/_DATA_2AE2_ VRAM state persists before each _LABEL_2620_ call.',
        'If persistence is proven, promote common VRAM prerequisites from simulation-only metadata into a reusable zone recipe commonVramPrerequisites layer.',
        'Map the state-machine inputs around _RAM_C26E_, _RAM_CF6A_, _RAM_CFFA_, and _RAM_C26C_ to connect door/transition records to zone descriptors.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotation.annotatedRegions.length,
      annotatedRamCount: annotation.annotatedRam.length,
    },
    directCallsites: catalog.directCallsites.map(site => ({
      callLine: site.callLine,
      routineLabel: site.routineLabel,
      hlSource: site.hlLoad?.target || null,
      descriptorSourceKind: site.descriptorSource.kind,
      classification: site.classification,
      localCommonPairBeforeCall: site.commonPrereqBeforeCall.localCommonPairBeforeCall,
    })),
    ramPointerVariables: catalog.ramPointerVariables.map(item => ({
      ramLabel: item.ramLabel,
      address: item.address,
      ramEntry: item.ramEntry,
      consumerCallsiteCount: item.consumerCallsiteCount,
      writerCount: item.writerCount,
    })),
  }, null, 2));
}

main();
