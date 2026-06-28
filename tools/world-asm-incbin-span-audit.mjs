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
const catalogId = 'world-asm-incbin-span-catalog-2026-06-25';
const reportId = 'asm-incbin-span-audit-2026-06-25';
const toolName = 'tools/world-asm-incbin-span-audit.mjs';
const sourceLabelCatalogId = 'world-asm-label-region-catalog-2026-06-25';
const BANK_SIZE = 0x4000;

const evidencePriority = [
  'asmIncbinSpanAudit',
  'vdpStreamAudit',
  'bank2VdpStreamStateAudit',
  'bank2VdpStreamLayoutAudit',
  'roomOverlayRecordAudit',
  'roomSubrecordAudit',
  'roomLoaderDataAudit',
  'finalFragmentAudit',
  'zoneRecipeAudit',
  'zoneRenderProvenanceAudit',
  'inlineTransitionRecipeAudit',
  'inlineTransitionRenderProvenanceAudit',
  'tileSourceAudit',
  'loaderBoundaryAudit',
  'metaspriteAudit',
  'dc2TilePairLookupAudit',
  'collisionBufferProvenanceAudit',
  'animationFrameSubrecordAudit',
  'roomEntityFrameAssetLinkAudit',
  'c34eMetaspriteFamilyAudit',
  'graphicsCoverageAudit',
  'dynamicTileSourceTableAudit',
  'entityBehaviorCodeAudit',
  'c3c0BehaviorTargetSemanticsAudit',
  'asmDataLabelCodeRegionResolutionAudit',
  'asmDataLabelCensusAudit',
  'asmLabelRegionAudit',
];

const codeEvidenceKeys = new Set([
  'entityBehaviorCodeAudit',
  'c3c0BehaviorTargetSemanticsAudit',
  'asmDataLabelCodeRegionResolutionAudit',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function cleanCode(line) {
  return String(line || '').split(';')[0].trim();
}

function regionStart(region) {
  return parseHex(region.offset) ?? 0;
}

function regionEnd(region) {
  return regionStart(region) + Number(region.size || 0);
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function compactRegionWithAnalysis(region) {
  const compact = compactRegion(region);
  if (!compact) return null;
  compact.analysisKeys = Object.keys(region.analysis || {}).sort();
  return compact;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function labelLeadByOffset(mapData) {
  const catalog = findCatalog(mapData, sourceLabelCatalogId);
  const leads = new Map();
  const groups = [
    catalog?.leads?.incbinAssetBlobLabels || [],
    catalog?.leads?.dataLabelsInCodeRegions || [],
    catalog?.leads?.codeLabelsInAssetRegions || [],
    catalog?.leads?.mixedCodeAndDataLabels || [],
    catalog?.leads?.unmappedRomLabels || [],
  ];
  for (const group of groups) {
    for (const lead of group) {
      const offset = parseHex(lead.offset);
      if (offset != null && !leads.has(offset)) leads.set(offset, lead);
    }
  }
  return { catalog, leads };
}

function nearestDirectLabel(lines, lineIndex) {
  for (let index = lineIndex - 1; index >= 0; index--) {
    const code = cleanCode(lines[index]);
    if (!code) continue;
    const labelMatch = /^(_(?:LABEL|DATA)_[0-9A-F]+_):$/i.exec(code);
    return labelMatch ? labelMatch[1] : '';
  }
  return '';
}

function findDeclaredSpan(lines, lineIndex, start) {
  for (let index = lineIndex - 1; index >= Math.max(0, lineIndex - 8); index--) {
    const match = /^;\s*Data from ([0-9A-F]+) to ([0-9A-F]+) \((\d+) bytes\)/i.exec(String(lines[index] || '').trim());
    if (!match) continue;
    const commentStart = parseInt(match[1], 16);
    const commentEndInclusive = parseInt(match[2], 16);
    if (commentStart !== start) continue;
    return {
      start: hex(commentStart),
      endExclusive: hex(commentEndInclusive + 1),
      size: Number(match[3]),
      source: 'preceding_asm_data_comment',
    };
  }
  return {
    start: hex(start),
    endExclusive: hex(start),
    size: 0,
    source: 'missing_asm_data_comment',
  };
}

function scanIncbinSpans(asmText) {
  const lines = asmText.split(/\r?\n/);
  const spans = [];
  let currentBank = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const code = cleanCode(lines[lineIndex]);
    const bankMatch = /^\.BANK\s+([0-9]+)/i.exec(code);
    if (bankMatch) currentBank = Number(bankMatch[1]);

    const incbinMatch = /^\.incbin\b.*_DATA_([0-9A-F]+)_\.inc/i.exec(code);
    if (!incbinMatch) continue;

    const start = parseInt(incbinMatch[1], 16);
    const declaredSpan = findDeclaredSpan(lines, lineIndex, start);
    spans.push({
      id: `asm-incbin-${hex(start).slice(2).toLowerCase()}`,
      label: nearestDirectLabel(lines, lineIndex),
      sourceOffset: hex(start),
      bank: hex(Math.floor(start / BANK_SIZE), 2),
      bankOffset: hex(start % BANK_SIZE, 4),
      asmBank: currentBank == null ? null : hex(currentBank, 2),
      asmLine: lineIndex + 1,
      directive: '.incbin',
      declaredSpan,
    });
  }

  return spans;
}

function overlappingRegions(mapData, start, endExclusive) {
  return (mapData.regions || [])
    .filter(region => regionStart(region) < endExclusive && regionEnd(region) > start)
    .sort((a, b) => regionStart(a) - regionStart(b) || regionEnd(a) - regionEnd(b) || String(a.id).localeCompare(String(b.id)));
}

function exactRegion(mapData, start) {
  const exact = (mapData.regions || [])
    .filter(region => regionStart(region) === start)
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)));
  return exact[0] || null;
}

function primaryRegion(overlaps, start) {
  const exact = overlaps.filter(region => regionStart(region) === start);
  exact.sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)));
  return exact[0] || overlaps[0] || null;
}

function compactEvidenceRef(region, key) {
  const audit = region?.analysis?.[key];
  if (!audit) return null;
  return {
    regionId: region.id || '',
    analysisKey: key,
    catalogId: audit.catalogId || '',
    kind: audit.kind || '',
    role: audit.role || '',
    confidence: audit.confidence || '',
    summary: audit.summary || '',
  };
}

function bestEvidenceRefs(regions) {
  const refs = [];
  const seen = new Set();
  for (const key of evidencePriority) {
    for (const region of regions) {
      const ref = compactEvidenceRef(region, key);
      if (!ref) continue;
      const id = `${ref.regionId}:${ref.analysisKey}:${ref.kind}:${ref.role}`;
      if (seen.has(id)) continue;
      seen.add(id);
      refs.push(ref);
      if (refs.length >= 10) return refs;
    }
  }
  return refs;
}

function hasAnyEvidence(region, keys) {
  return keys.some(key => region?.analysis?.[key]);
}

function parserStatusFor(entry, regions) {
  const types = new Set(regions.map(region => region.type || 'unknown'));
  const keys = new Set(regions.flatMap(region => Object.keys(region.analysis || {})));

  if (types.has('code') && [...keys].some(key => codeEvidenceKeys.has(key))) {
    return 'disassembler_incbin_resolved_as_executable_code';
  }
  if (keys.has('bank2VdpStreamStateAudit') || keys.has('bank2VdpStreamLayoutAudit')) return 'parsed_with_bank2_vdp_stream_layout_model';
  if (keys.has('roomOverlayRecordAudit')) return 'parsed_as_room_overlay_records';
  if (types.has('room_subrecord') && (keys.has('roomSubrecordAudit') || keys.has('roomLoaderDataAudit'))) return 'parsed_as_room_subrecord_table';
  if (types.has('vram_loader_8fb') && keys.has('tileSourceAudit')) return 'split_into_vram_loader_and_room_entity_subrecords';
  if (keys.has('zoneRecipeAudit') || keys.has('zoneRenderProvenanceAudit')) return 'zone_recipe_render_verified';
  if (keys.has('dc2TilePairLookupAudit') || keys.has('collisionBufferProvenanceAudit')) return 'dual_use_metasprite_and_room_render_lookup_modeled';
  if (keys.has('metaspriteAudit') || keys.has('c34eMetaspriteFamilyAudit')) return 'metasprite_family_modeled_or_candidate';
  if (keys.has('graphicsCoverageAudit') || keys.has('dynamicTileSourceTableAudit')) return 'graphics_tile_source_cataloged';
  if (types.has('gfx_tiles')) return 'graphics_tile_span_typed_no_consumer_detail';
  return 'metadata_only_span_needs_parser';
}

function assetFamilyFor(entry, regions) {
  const types = new Set(regions.map(region => region.type || 'unknown'));
  const keys = new Set(regions.flatMap(region => Object.keys(region.analysis || {})));

  if (types.has('code')) return 'disassembler_code_artifact';
  if (types.has('vdp_stream')) return 'bank2_vdp_stream_bundle';
  if (types.has('tile_map') || types.has('room_subrecord')) return 'room_loader_support_data';
  if (types.has('room_data')) return 'room_zone_descriptor_bundle';
  if (types.has('vram_loader_8fb')) return 'room_vram_loader_and_entity_lists';
  if (keys.has('dc2TilePairLookupAudit') || keys.has('collisionBufferProvenanceAudit')) return 'metasprite_dual_use_render_lookup';
  if (types.has('meta_sprite')) return 'metasprite_or_animation_frame_data';
  if (types.has('gfx_tiles')) return 'graphics_tile_banks';
  return 'unclassified_incbin_span';
}

function confidenceFor(entry, regions, parserStatus) {
  if (!regions.length) return 'low';
  if (parserStatus === 'metadata_only_span_needs_parser') return 'low';
  if (parserStatus === 'metasprite_family_modeled_or_candidate') {
    return regions.some(region => region.analysis?.c34eMetaspriteFamilyAudit?.confidence === 'medium') ? 'medium' : 'high';
  }
  if (parserStatus === 'graphics_tile_span_typed_no_consumer_detail') return 'medium';
  if (parserStatus === 'split_into_vram_loader_and_room_entity_subrecords') return 'high';
  if (regions.some(region => hasAnyEvidence(region, evidencePriority))) return 'high';
  return 'medium';
}

function spanCoverageStatus(start, endExclusive, regions) {
  if (!regions.length) return 'unmapped';
  let cursor = start;
  let gapCount = 0;
  for (const region of regions) {
    const regionS = Math.max(start, regionStart(region));
    const regionE = Math.min(endExclusive, regionEnd(region));
    if (regionS > cursor) gapCount++;
    if (regionE > cursor) cursor = regionE;
  }
  if (cursor < endExclusive) gapCount++;
  if (gapCount) return 'partially_mapped_with_gaps';
  return regions.length === 1 && regionStart(regions[0]) === start && regionEnd(regions[0]) === endExclusive
    ? 'single_region_exact'
    : 'split_across_current_regions';
}

function regionSamples(regions) {
  const compact = regions.map(compactRegionWithAnalysis);
  if (compact.length <= 12) return compact;
  return [
    ...compact.slice(0, 6),
    { omittedRegionCount: compact.length - 12 },
    ...compact.slice(-6),
  ];
}

function buildEntry(mapData, span, labelLeads) {
  const start = parseHex(span.declaredSpan.start) ?? parseHex(span.sourceOffset);
  const endExclusive = parseHex(span.declaredSpan.endExclusive) || start;
  const regions = overlappingRegions(mapData, start, endExclusive);
  const primary = primaryRegion(regions, start);
  const exact = exactRegion(mapData, start);
  const parserStatus = parserStatusFor(span, regions);
  const assetFamily = assetFamilyFor(span, regions);
  const coverageStatus = spanCoverageStatus(start, endExclusive, regions);
  const confidence = confidenceFor(span, regions, parserStatus);
  const lead = labelLeads.get(start) || null;
  const size = Math.max(0, endExclusive - start);
  const declaredSpanMatchesSourceRegion = Boolean(primary && regionStart(primary) === start && regionEnd(primary) === endExclusive);

  return {
    id: span.id,
    label: span.label,
    sourceOffset: span.sourceOffset,
    bank: span.bank,
    bankOffset: span.bankOffset,
    asmBank: span.asmBank,
    asmLine: span.asmLine,
    directive: span.directive,
    declaredSpan: {
      start: hex(start),
      endExclusive: hex(endExclusive),
      size,
      source: span.declaredSpan.source,
    },
    sourceLabelCatalogLead: lead ? {
      sourceCatalog: sourceLabelCatalogId,
      status: lead.status || '',
      blockStyle: lead.blockStyle || '',
      regionId: lead.regionId || '',
      regionType: lead.regionType || '',
    } : null,
    sourceRegion: compactRegion(exact || primary),
    coverageStatus,
    regionCount: regions.length,
    declaredSpanMatchesSourceRegion,
    splitByCurrentMap: coverageStatus === 'split_across_current_regions',
    regionTypeCounts: countBy(regions, region => region.type || 'unknown'),
    assetFamily,
    parserStatus,
    confidence,
    evidenceRefs: bestEvidenceRefs(regions),
    overlappingRegions: regionSamples(regions),
    summary: `${span.directive} span ${hex(start)}-${hex(endExclusive - 1)} is ${coverageStatus}; current map classifies it as ${assetFamily} with parser status ${parserStatus}.`,
    evidence: [
      `ASM line ${span.asmLine} declares a ${span.directive} span starting at ${hex(start)}.`,
      `The preceding ASM data comment declares ${size} byte(s) from ${hex(start)} through ${hex(endExclusive - 1)}.`,
      `${regions.length} current map region(s) overlap the declared span.`,
      'The classification is derived from existing map region types and analysis keys; no ROM payload bytes are read or stored.',
    ],
    assetPolicy: 'Metadata only: ASM line numbers, offsets, sizes, labels, region ids/types, analysis-key references, and confidence. No ROM bytes, decoded graphics, tile pixels, audio samples, text payloads, instruction bytes, or gameplay constants are embedded.',
  };
}

function buildCatalog(mapData, asmText) {
  const spans = scanIncbinSpans(asmText);
  const { catalog: sourceCatalog, leads } = labelLeadByOffset(mapData);
  const entries = spans.map(span => buildEntry(mapData, span, leads));
  const validationIssues = [];
  for (const entry of entries) {
    if (entry.coverageStatus === 'unmapped' || entry.coverageStatus === 'partially_mapped_with_gaps') {
      validationIssues.push({
        severity: 'warning',
        kind: 'incbin_span_not_fully_mapped',
        id: entry.id,
        offset: entry.sourceOffset,
        coverageStatus: entry.coverageStatus,
        summary: entry.summary,
      });
    }
    if (entry.parserStatus === 'metadata_only_span_needs_parser') {
      validationIssues.push({
        severity: 'info',
        kind: 'incbin_span_needs_parser',
        id: entry.id,
        offset: entry.sourceOffset,
        summary: entry.summary,
      });
    }
  }

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    source: {
      asm: 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm',
      map: 'projects/WORLD/map.json',
      sourceLabelCatalog: sourceCatalog?.id || '',
    },
    assetPolicy: 'Metadata only: ASM .incbin spans, offsets, labels, region ids/types, counts, parser statuses, confidence, and analysis references. No ROM bytes, decoded graphics, tile pixels, music data, samples, text payloads, instruction bytes, or gameplay constants are embedded.',
    summary: {
      incbinSpanCount: entries.length,
      labeledSpanCount: entries.filter(entry => entry.label).length,
      unlabeledSpanCount: entries.filter(entry => !entry.label).length,
      fullyMappedSpanCount: entries.filter(entry => !['unmapped', 'partially_mapped_with_gaps'].includes(entry.coverageStatus)).length,
      splitSpanCount: entries.filter(entry => entry.splitByCurrentMap).length,
      declaredSpanMatchesSourceRegionCount: entries.filter(entry => entry.declaredSpanMatchesSourceRegion).length,
      byCoverageStatus: countBy(entries, entry => entry.coverageStatus),
      byAssetFamily: countBy(entries, entry => entry.assetFamily),
      byParserStatus: countBy(entries, entry => entry.parserStatus),
      byConfidence: countBy(entries, entry => entry.confidence),
    },
    entries,
    validationIssues,
    evidence: [
      'The audit scans ASM .incbin directives and their preceding data-span comments.',
      'Each span is cross-referenced against existing map.json region boundaries and analysis keys.',
      'Spans split by the current map are treated as parser-driven refinements, not as errors, when coverage is continuous.',
    ],
    nextLeads: [
      'Promote split .incbin span summaries into analyzer filters so parser-ready spans can be reviewed by asset family.',
      'Drill into split graphics spans, especially the bank-11 0x2C000 span, to document why one ASM blob is subdivided by current region boundaries.',
      'Use this catalog to prioritize strict parsers for remaining metadata-only graphics and metasprite spans.',
    ],
  };
}

function annotateRegions(mapData, catalog) {
  const annotated = [];
  const regionsById = new Map((mapData.regions || []).map(region => [region.id, region]));

  for (const entry of catalog.entries) {
    const start = parseHex(entry.declaredSpan.start);
    const endExclusive = parseHex(entry.declaredSpan.endExclusive);
    const overlapping = overlappingRegions(mapData, start, endExclusive);
    for (const regionRef of overlapping.map(compactRegion)) {
      const region = regionsById.get(regionRef.id);
      if (!region) continue;
      region.analysis = region.analysis || {};
      const segmentRole = region.id === entry.sourceRegion?.id
        ? 'span_start_region'
        : 'overlapping_split_region';
      region.analysis.asmIncbinSpanAudit = {
        catalogId,
        kind: entry.assetFamily,
        role: segmentRole,
        spanId: entry.id,
        sourceOffset: entry.sourceOffset,
        declaredSpan: entry.declaredSpan,
        coverageStatus: entry.coverageStatus,
        parserStatus: entry.parserStatus,
        confidence: entry.confidence,
        summary: entry.summary,
        evidence: [
          `Region overlaps ASM ${entry.directive} span ${entry.id}.`,
          `Span classification: ${entry.assetFamily}; parser status: ${entry.parserStatus}.`,
          'Metadata-only audit; no ROM payload bytes are embedded.',
        ],
        generatedAt: now,
        tool: toolName,
      };
      annotated.push({
        region: compactRegion(region),
        spanId: entry.id,
        role: segmentRole,
        assetFamily: entry.assetFamily,
        parserStatus: entry.parserStatus,
        confidence: entry.confidence,
      });
    }
  }

  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotatedRegions = apply ? annotateRegions(mapData, catalog) : [];

  if (apply) {
    mapData.asmDataLabelCatalogs = (mapData.asmDataLabelCatalogs || []).filter(item => item.id !== catalogId);
    mapData.asmDataLabelCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'asm_incbin_span_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs: [sourceLabelCatalogId, catalogId],
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
      validationIssues: catalog.validationIssues,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      annotatedRegions,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotatedRegions.length,
    },
    validationIssues: catalog.validationIssues,
    entries: catalog.entries.map(entry => ({
      id: entry.id,
      label: entry.label,
      sourceOffset: entry.sourceOffset,
      declaredSpan: entry.declaredSpan,
      coverageStatus: entry.coverageStatus,
      regionCount: entry.regionCount,
      assetFamily: entry.assetFamily,
      parserStatus: entry.parserStatus,
      confidence: entry.confidence,
    })),
  }, null, 2));
}

main();
