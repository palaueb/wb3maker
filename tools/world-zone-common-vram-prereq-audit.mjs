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
const catalogId = 'world-zone-common-vram-prereq-catalog-2026-06-25';
const reportId = 'zone-common-vram-prereq-audit-2026-06-25';
const toolName = 'tools/world-zone-common-vram-prereq-audit.mjs';

const provenanceCatalogId = 'world-zone-render-provenance-catalog-2026-06-25';
const candidateCatalogId = 'world-zone-unresolved-slot-candidate-catalog-2026-06-25';
const callsiteCatalogId = 'world-zone-unresolved-loader-callsite-catalog-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
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

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function parseOffset(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function labelOffset(label) {
  const match = /^_LABEL_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function collectRoutineRanges(lines) {
  const ranges = new Map();
  const labels = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_LABEL_[0-9A-F]+_):/.exec(lines[i]);
    if (match) labels.push({ label: match[1], lineIndex: i });
  }
  for (let i = 0; i < labels.length; i++) {
    ranges.set(labels[i].label, {
      startIndex: labels[i].lineIndex,
      endIndex: i + 1 < labels.length ? labels[i + 1].lineIndex : lines.length,
    });
  }
  return ranges;
}

function scanCallsiteContext(lines, routineRanges, site) {
  const sourceLabel = site.sourceLabel || '';
  const range = routineRanges.get(sourceLabel) || null;
  const callLineIndex = (site.callLine || site.line || 1) - 1;
  const scanEnd = range ? range.endIndex : Math.min(lines.length, callLineIndex + 80);
  const callsAfter = [];
  const dataLoadsAfter = [];
  let dynamic8fbAfter = 0;
  let common998After = false;

  for (let i = callLineIndex + 1; i < scanEnd; i++) {
    const code = cleanCode(lines[i]);
    if (!code) continue;
    const loadMatch = /^ld\s+hl,\s*(_DATA_[0-9A-F]+_|\(_RAM_[0-9A-F]+_\)|\$[0-9A-F]+)\s*$/i.exec(code);
    if (loadMatch) {
      dataLoadsAfter.push({
        line: i + 1,
        code,
        target: loadMatch[1],
      });
      if (/^_DATA_2AE2_$/i.test(loadMatch[1])) common998After = true;
    }
    const callMatch = /^call\s+(_LABEL_[0-9A-F]+_)\s*$/i.exec(code);
    if (!callMatch) continue;
    const target = callMatch[1];
    callsAfter.push({
      line: i + 1,
      code,
      target,
    });
    if (target === '_LABEL_8FB_') dynamic8fbAfter++;
    if (target === '_LABEL_998_' && dataLoadsAfter.some(load => load.target === '_DATA_2AE2_')) common998After = true;
  }

  const zoneLoaderCalls = callsAfter.filter(call => call.target === '_LABEL_2620_');
  const roomAssetCalls = callsAfter.filter(call => call.target === '_LABEL_26F4_');
  const common998Calls = callsAfter.filter(call => call.target === '_LABEL_998_');
  const loader8fbAfter = callsAfter.filter(call => call.target === '_LABEL_8FB_');
  const sourceOffset = labelOffset(sourceLabel);
  return {
    sourceLabel,
    sourceLabelOffset: sourceOffset == null ? null : hex(sourceOffset),
    callLine: site.callLine || null,
    routineStartLine: range ? range.startIndex + 1 : null,
    routineEndLine: range ? range.endIndex : null,
    zoneLoaderCallCountAfter: zoneLoaderCalls.length,
    firstZoneLoaderCallLine: zoneLoaderCalls[0]?.line || null,
    roomAssetCallCountAfter: roomAssetCalls.length,
    firstRoomAssetCallLine: roomAssetCalls[0]?.line || null,
    dynamic8fbCallCountAfter: loader8fbAfter.length,
    common998After,
    common998CallCountAfter: common998Calls.length,
    dataLoadsAfter: dataLoadsAfter.slice(0, 16),
    callsAfter: callsAfter.slice(0, 24),
  };
}

function classifyContext(context) {
  if (context.zoneLoaderCallCountAfter > 0) return 'pre_zone_loader_context';
  if (context.dynamic8fbCallCountAfter > 0) return 'context_restore_loader_context';
  if (context.roomAssetCallCountAfter > 0) return 'room_asset_loader_context';
  return 'non_zone_or_indirect_context';
}

function confidenceForHypothesis(matchedSlotCoverage, contexts) {
  const preZoneCount = contexts.filter(context => context.contextKind === 'pre_zone_loader_context').length;
  const restoreCount = contexts.filter(context => context.contextKind === 'context_restore_loader_context').length;
  if (matchedSlotCoverage === 1 && preZoneCount >= 2) return 'high';
  if (matchedSlotCoverage === 1 && preZoneCount >= 1) return 'medium';
  if (matchedSlotCoverage === 1 && restoreCount >= 1) return 'medium';
  if (matchedSlotCoverage > 0.5 && preZoneCount >= 1) return 'medium';
  return 'low';
}

function recommendationForHypothesis(hypothesis) {
  if (hypothesis.confidence === 'high') {
    return 'Model as a common VRAM prerequisite candidate for standalone room-zone rendering, but keep it separate from per-room recipe dependencies until persistent-state order is traced.';
  }
  if (hypothesis.preZoneContextCount > 0) {
    return 'Trace this loader in its specific transition/menu context before using it as a common room prerequisite.';
  }
  return 'Keep as a candidate only; current evidence shows slot coverage/call sites but not a pre-zone room-load context.';
}

function buildCatalog(mapData, asmText) {
  const provenanceCatalog = (mapData.roomDataCatalogs || []).find(item => item.id === provenanceCatalogId);
  const candidateCatalog = (mapData.roomDataCatalogs || []).find(item => item.id === candidateCatalogId);
  const callsiteCatalog = (mapData.roomDataCatalogs || []).find(item => item.id === callsiteCatalogId);
  if (!provenanceCatalog) throw new Error(`Missing required catalog ${provenanceCatalogId}`);
  if (!candidateCatalog) throw new Error(`Missing required catalog ${candidateCatalogId}`);
  if (!callsiteCatalog) throw new Error(`Missing required catalog ${callsiteCatalogId}`);

  const lines = asmText.split(/\r?\n/);
  const routineRanges = collectRoutineRanges(lines);
  const unresolvedSlots = new Set((candidateCatalog.slots || []).map(slot => slot.slot));
  const totalUnresolvedSlotCount = unresolvedSlots.size;
  const totalUnresolvedOccurrences = provenanceCatalog.summary?.totalUnresolvedSlots || 0;
  const slotOccurrenceCounts = new Map((candidateCatalog.slots || []).map(slot => [slot.slot, slot.unresolvedRecipeCount || 0]));
  const candidateByLoaderId = new Map((candidateCatalog.loaderSummaries || []).map(item => [item.loaderRegion.id, item]));
  const hypotheses = [];

  for (const callsiteItem of callsiteCatalog.loaderCallsites || []) {
    const loaderId = callsiteItem.loaderRegion?.id;
    if (!loaderId) continue;
    const candidate = candidateByLoaderId.get(loaderId);
    const matchedSlots = [...new Set(candidate?.matchedSlots || [])].sort();
    const matchedSlotCoverage = totalUnresolvedSlotCount
      ? matchedSlots.length / totalUnresolvedSlotCount
      : 0;
    const coveredUnresolvedOccurrences = matchedSlots.reduce((sum, slot) => sum + (slotOccurrenceCounts.get(slot) || 0), 0);
    const occurrenceCoverage = totalUnresolvedOccurrences
      ? coveredUnresolvedOccurrences / totalUnresolvedOccurrences
      : 0;
    const contexts = (callsiteItem.callSites || []).map(site => {
      const scanned = scanCallsiteContext(lines, routineRanges, site);
      return {
        ...scanned,
        sourceRegion: site.sourceRegion || null,
        contextKind: classifyContext(scanned),
        evidence: site.evidence,
      };
    });
    const preZoneContextCount = contexts.filter(context => context.contextKind === 'pre_zone_loader_context').length;
    const contextRestoreCount = contexts.filter(context => context.contextKind === 'context_restore_loader_context').length;
    const confidence = confidenceForHypothesis(matchedSlotCoverage, contexts);
    const hypothesis = {
      loaderRegion: callsiteItem.loaderRegion,
      dataLabel: callsiteItem.dataLabel,
      matchedSlots,
      matchedSlotCount: matchedSlots.length,
      matchedSlotCoverage: Number(matchedSlotCoverage.toFixed(4)),
      coveredUnresolvedOccurrences,
      occurrenceCoverage: Number(occurrenceCoverage.toFixed(4)),
      callSiteCount: callsiteItem.callSiteCount,
      direct8fbCallSiteCount: callsiteItem.direct8fbCallSiteCount,
      preZoneContextCount,
      contextRestoreCount,
      common998ContextCount: contexts.filter(context => context.common998After).length,
      confidence,
      contexts,
    };
    hypothesis.recommendation = recommendationForHypothesis(hypothesis);
    hypotheses.push(hypothesis);
  }

  hypotheses.sort((a, b) =>
    b.matchedSlotCoverage - a.matchedSlotCoverage ||
    b.preZoneContextCount - a.preZoneContextCount ||
    b.callSiteCount - a.callSiteCount ||
    a.loaderRegion.id.localeCompare(b.loaderRegion.id)
  );

  const strong = hypotheses.filter(item => item.confidence === 'high');
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [provenanceCatalogId, candidateCatalogId, callsiteCatalogId],
    summary: {
      hypothesisCount: hypotheses.length,
      highConfidenceHypothesisCount: strong.length,
      fullSlotCoverageHypothesisCount: hypotheses.filter(item => item.matchedSlotCoverage === 1).length,
      preZoneContextHypothesisCount: hypotheses.filter(item => item.preZoneContextCount > 0).length,
      totalUnresolvedSlotCount,
      totalUnresolvedOccurrences,
      bestHypothesisRegionId: hypotheses[0]?.loaderRegion?.id || null,
      bestHypothesisLabel: hypotheses[0]?.dataLabel || null,
      assetPolicy: 'Metadata only: loader labels, slot ids/counts, ASM line references, routine labels, and dependency hypotheses. No ROM bytes, decoded graphics, decoded name tables, or rendered assets are embedded.',
    },
    hypotheses,
    evidence: [
      `${provenanceCatalogId} identifies unresolved room-zone tile slots from metadata-only recipe rendering.`,
      `${candidateCatalogId} identifies mapped loaders that write those slot ids.`,
      `${callsiteCatalogId} proves direct _LABEL_8FB_ call sites for candidate loaders.`,
      'This audit adds same-routine control-flow context: whether candidate loaders are followed by _LABEL_2620_ room-zone loading, _LABEL_26F4_ room asset loading, or context-restoration loader calls.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  for (const hypothesis of catalog.hypotheses) {
    const region = findRegionById(mapData, hypothesis.loaderRegion.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.zoneCommonVramPrereqAudit = {
      catalogId,
      kind: 'common_vram_prerequisite_hypothesis',
      confidence: hypothesis.confidence,
      summary: hypothesis.recommendation,
      matchedSlots: hypothesis.matchedSlots,
      matchedSlotCoverage: hypothesis.matchedSlotCoverage,
      coveredUnresolvedOccurrences: hypothesis.coveredUnresolvedOccurrences,
      occurrenceCoverage: hypothesis.occurrenceCoverage,
      preZoneContextCount: hypothesis.preZoneContextCount,
      contextRestoreCount: hypothesis.contextRestoreCount,
      common998ContextCount: hypothesis.common998ContextCount,
      dataLabel: hypothesis.dataLabel,
      contexts: hypothesis.contexts.map(context => ({
        sourceLabel: context.sourceLabel,
        sourceLabelOffset: context.sourceLabelOffset,
        sourceRegion: context.sourceRegion,
        contextKind: context.contextKind,
        callLine: context.callLine,
        firstZoneLoaderCallLine: context.firstZoneLoaderCallLine,
        firstRoomAssetCallLine: context.firstRoomAssetCallLine,
        dynamic8fbCallCountAfter: context.dynamic8fbCallCountAfter,
        common998After: context.common998After,
      })),
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      confidence: hypothesis.confidence,
      matchedSlotCoverage: hypothesis.matchedSlotCoverage,
      preZoneContextCount: hypothesis.preZoneContextCount,
    });
  }

  const roomLoaderRegion = findContainingRegion(mapData, 0x2620);
  if (roomLoaderRegion) {
    roomLoaderRegion.analysis = roomLoaderRegion.analysis || {};
    roomLoaderRegion.analysis.zoneCommonVramPrereqConsumerAudit = {
      catalogId,
      kind: 'room_zone_loader_consumer_context',
      confidence: 'high',
      summary: 'Candidate common VRAM prerequisite loaders are evaluated by whether they run before this _LABEL_2620_ room-zone loader in the same routine.',
      highConfidencePrerequisites: catalog.hypotheses
        .filter(item => item.confidence === 'high')
        .map(item => ({
          loaderRegion: item.loaderRegion,
          dataLabel: item.dataLabel,
          preZoneContextCount: item.preZoneContextCount,
          matchedSlotCoverage: item.matchedSlotCoverage,
        })),
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: roomLoaderRegion.id,
      offset: roomLoaderRegion.offset,
      type: roomLoaderRegion.type || 'unknown',
      name: roomLoaderRegion.name || '',
      role: 'consumer',
    });
  }

  return annotatedRegions;
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  let annotatedRegions = [];

  if (apply) {
    annotatedRegions = annotateMap(mapData, catalog);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_common_vram_prereq_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      hypotheses: catalog.hypotheses,
      annotatedRegions,
      evidence: catalog.evidence,
      nextLeads: [
        'Use emulator trace or static caller graph to confirm whether _DATA_2A55_ persists across all room-zone renders in normal gameplay.',
        'If confirmed, update zone recipe schema with a commonVramPrerequisites layer instead of duplicating _DATA_2A55_ as a per-room 8FB dependency.',
        'After adding a common prerequisite layer, rerun zone render provenance and verify unresolvedRecipeCount decreases from the current catalog baseline.',
      ],
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
    hypotheses: catalog.hypotheses.map(item => ({
      regionId: item.loaderRegion.id,
      dataLabel: item.dataLabel,
      confidence: item.confidence,
      matchedSlotCoverage: item.matchedSlotCoverage,
      occurrenceCoverage: item.occurrenceCoverage,
      preZoneContextCount: item.preZoneContextCount,
      contextRestoreCount: item.contextRestoreCount,
      common998ContextCount: item.common998ContextCount,
      sourceLabels: item.contexts.map(context => `${context.sourceLabel}:${context.contextKind}`),
    })),
  }, null, 2));
}

main();
