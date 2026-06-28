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
const catalogId = 'world-zone-unresolved-loader-callsite-catalog-2026-06-25';
const reportId = 'zone-unresolved-loader-callsite-audit-2026-06-25';
const toolName = 'tools/world-zone-unresolved-loader-callsite-audit.mjs';
const candidateCatalogId = 'world-zone-unresolved-slot-candidate-catalog-2026-06-25';

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

function labelOffset(label) {
  const match = /^_LABEL_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function dataLabelForRegion(region) {
  const name = region.name || '';
  if (/^_DATA_[0-9A-F]+_$/i.test(name)) return name;
  const offset = offsetOf(region);
  return `_DATA_${offset.toString(16).toUpperCase()}_`;
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function collectCandidateRegions(mapData) {
  const candidateCatalog = (mapData.roomDataCatalogs || []).find(item => item.id === candidateCatalogId);
  if (!candidateCatalog) throw new Error(`Missing required catalog ${candidateCatalogId}`);
  const ids = new Set();
  for (const summary of candidateCatalog.loaderSummaries || []) {
    if (summary.loaderRegion?.id) ids.add(summary.loaderRegion.id);
  }
  return [...ids].map(id => findRegionById(mapData, id)).filter(Boolean);
}

function collectCallSites(asmText, mapData, candidateRegions) {
  const lines = asmText.split(/\r?\n/);
  const labelsByDataLabel = new Map(candidateRegions.map(region => [dataLabelForRegion(region), region]));
  const callSitesByRegionId = new Map(candidateRegions.map(region => [region.id, []]));
  let currentLabel = null;
  let currentLabelOffset = null;

  for (let i = 0; i < lines.length; i++) {
    const labelMatch = /^(_LABEL_[0-9A-F]+_):/.exec(lines[i]);
    if (labelMatch) {
      currentLabel = labelMatch[1];
      currentLabelOffset = labelOffset(currentLabel);
    }
    const code = cleanCode(lines[i]);
    const loadMatch = /^ld\s+hl,\s*(_DATA_[0-9A-F]+_)\s*$/i.exec(code);
    if (!loadMatch) continue;
    const dataLabel = loadMatch[1];
    const region = labelsByDataLabel.get(dataLabel);
    if (!region) continue;

    let callLine = null;
    let callCode = null;
    let confidence = 'medium';
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
      const next = cleanCode(lines[j]);
      if (!next) continue;
      if (/^call\s+_LABEL_8FB_\s*$/i.test(next)) {
        callLine = j + 1;
        callCode = next;
        confidence = 'high';
        break;
      }
      if (/^ld\s+hl,/i.test(next) || /\b(ret|jp|jr)\b/i.test(next)) break;
    }

    const sourceRegion = currentLabelOffset == null ? null : findContainingRegion(mapData, currentLabelOffset);
    callSitesByRegionId.get(region.id).push({
      line: i + 1,
      code,
      dataLabel,
      callLine,
      callCode,
      request: callCode ? '_LABEL_8FB_' : null,
      sourceLabel: currentLabel,
      sourceLabelOffset: currentLabelOffset == null ? null : hex(currentLabelOffset),
      sourceRegion: regionRef(sourceRegion),
      confidence,
      evidence: callCode
        ? `ASM line ${i + 1} loads ${dataLabel} into HL and ASM line ${callLine} calls _LABEL_8FB_.`
        : `ASM line ${i + 1} loads ${dataLabel} into HL; no immediate _LABEL_8FB_ call found inside the short look-ahead window.`,
    });
  }

  return callSitesByRegionId;
}

function buildCatalog(mapData, asmText) {
  const candidateRegions = collectCandidateRegions(mapData);
  const callSitesByRegionId = collectCallSites(asmText, mapData, candidateRegions);
  const loaderCallsites = candidateRegions.map(region => {
    const dataLabel = dataLabelForRegion(region);
    const callSites = callSitesByRegionId.get(region.id) || [];
    return {
      loaderRegion: regionRef(region),
      dataLabel,
      callSiteCount: callSites.length,
      direct8fbCallSiteCount: callSites.filter(site => site.callLine != null).length,
      confidence: callSites.some(site => site.confidence === 'high') ? 'high' : callSites.length ? 'medium' : 'low',
      callSites,
    };
  }).sort((a, b) => b.callSiteCount - a.callSiteCount || a.loaderRegion.id.localeCompare(b.loaderRegion.id));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [candidateCatalogId],
    summary: {
      candidateLoaderCount: candidateRegions.length,
      loadersWithCallSites: loaderCallsites.filter(item => item.callSiteCount > 0).length,
      direct8fbCallSiteCount: loaderCallsites.reduce((sum, item) => sum + item.direct8fbCallSiteCount, 0),
      loadersWithoutCallSites: loaderCallsites.filter(item => item.callSiteCount === 0).length,
      assetPolicy: 'Metadata only: loader labels, ASM line numbers, routine labels, source region ids, and call-site counts. No ROM bytes, decoded graphics, or rendered assets are embedded.',
    },
    loaderCallsites,
    evidence: [
      `Candidate loaders come from ${candidateCatalogId}, which matches decoded loader tile-slot writes against unresolved zone render slots.`,
      'A high-confidence call site loads the candidate _DATA_ label into HL and immediately calls _LABEL_8FB_.',
      'These call sites prove loader reachability from code, but not that the loader is active for every room zone until runtime state/control-flow is traced.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  for (const item of catalog.loaderCallsites) {
    const region = findRegionById(mapData, item.loaderRegion.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.zoneUnresolvedLoaderCallsiteAudit = {
      catalogId,
      kind: 'candidate_loader_8fb_callsite_trace',
      confidence: item.confidence,
      summary: 'ASM references show where this unresolved-slot candidate loader is loaded into HL and sent to _LABEL_8FB_.',
      dataLabel: item.dataLabel,
      callSiteCount: item.callSiteCount,
      direct8fbCallSiteCount: item.direct8fbCallSiteCount,
      callSites: item.callSites,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      callSiteCount: item.callSiteCount,
      direct8fbCallSiteCount: item.direct8fbCallSiteCount,
    });
  }
  return annotated;
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
      type: 'zone_unresolved_loader_callsite_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      loaderCallsites: catalog.loaderCallsites,
      annotatedRegions,
      evidence: catalog.evidence,
      nextLeads: [
        'Trace high-confidence candidate loader routines through runtime state to decide whether any is a persistent/common VRAM dependency for room recipes.',
        'Prioritize _DATA_2A55_ / INITIAL VRAM TILES because it has multiple direct _LABEL_8FB_ call sites and covers all unresolved slots.',
        'Do not add these candidate loaders to zone recipes until call-order evidence proves they run before room-zone rendering in the target scene context.',
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
    loaderCallsites: catalog.loaderCallsites.map(item => ({
      regionId: item.loaderRegion.id,
      dataLabel: item.dataLabel,
      callSiteCount: item.callSiteCount,
      direct8fbCallSiteCount: item.direct8fbCallSiteCount,
      sourceLabels: item.callSites.map(site => site.sourceLabel),
    })),
  }, null, 2));
}

main();
