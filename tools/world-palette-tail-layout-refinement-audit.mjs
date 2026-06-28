#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const toolName = 'tools/world-palette-tail-layout-refinement-audit.mjs';
const catalogId = 'world-palette-tail-layout-refinement-catalog-2026-06-25';
const reportId = 'palette-tail-layout-refinement-audit-2026-06-25';

const splitCatalogId = 'world-palette-tail-split-catalog-2026-06-25';
const consumerCatalogId = 'world-palette-tail-consumer-catalog-2026-06-25';
const paletteScriptCatalogId = 'world-palette-script-catalog-2026-06-24';
const screenProgTableLabel = '_DATA_1CCC0_';
const sourceCatalogs = [splitCatalogId, consumerCatalogId, paletteScriptCatalogId];
const targetRegionIds = ['r2815', 'r2816', 'r2817'];

function hex(value, pad = 5) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function findRegion(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function containingRegion(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
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

function byteShape(rom, start, endExclusive) {
  const bytes = rom.subarray(start, endExclusive);
  return {
    byteCount: bytes.length,
    allZero: bytes.length > 0 && [...bytes].every(byte => byte === 0),
    allFF: bytes.length > 0 && [...bytes].every(byte => byte === 0xFF),
    allSame: bytes.length > 0 && [...bytes].every(byte => byte === bytes[0]),
    evenSizedWordCandidate: bytes.length > 0 && bytes.length % 2 === 0,
    gridCandidate: bytes.length === 240 ? { width: 16, height: 15, bytesPerCell: 1 } : null,
    persistedByteCount: 0,
    persistedHashCount: 0,
  };
}

function segmentForRegion(splitCatalog, regionId) {
  return (splitCatalog.segments || []).find(segment => segment.region?.id === regionId) || null;
}

function consumerForRegion(consumerCatalog, regionId) {
  return (consumerCatalog.candidates || []).find(candidate => candidate.region?.id === regionId) || null;
}

function segmentStatus(consumer, shape) {
  if (!consumer) return 'missing_consumer_refinement';
  if ((consumer.sameBankPointerCandidateCount || 0) > 0) return 'same_bank_pointer_leads_require_trace';
  if ((consumer.bankMismatchWordShapeCount || 0) > 0) return 'post_palette_script_payload_cross_bank_word_shapes_only';
  if (shape.allZero || shape.allFF) return 'post_palette_script_fill_no_confirmed_consumer';
  return 'post_palette_script_payload_no_confirmed_consumer';
}

function buildSegment(mapData, rom, splitCatalog, consumerCatalog, regionId) {
  const region = findRegion(mapData, regionId);
  if (!region) throw new Error(`Missing region ${regionId}`);
  const start = regionStart(region);
  const endExclusive = regionEnd(region);
  const split = segmentForRegion(splitCatalog, regionId);
  const consumer = consumerForRegion(consumerCatalog, regionId);
  const shape = byteShape(rom, start, endExclusive);
  const status = segmentStatus(consumer, shape);
  return {
    region: compactRegion(region),
    range: {
      start: hex(start),
      endExclusive: hex(endExclusive),
      size: endExclusive - start,
      bank: Math.floor(start / 0x4000),
    },
    splitRole: split?.role || '',
    splitConfidence: split?.confidence || '',
    consumerRole: consumer?.role || '',
    consumerStatus: consumer?.consumerStatus || '',
    confidence: consumer?.confidence || split?.confidence || 'low',
    paletteParserStatus: consumer?.paletteParser?.status || '',
    paletteParserEndExclusive: consumer?.paletteParser?.parsedEndExclusive || '',
    exactAsmLabelRefCount: Number(consumer?.exactAsmLabelRefCount || 0),
    sameBankPointerCandidateCount: Number(consumer?.sameBankPointerCandidateCount || 0),
    bankMismatchWordShapeCount: Number(consumer?.bankMismatchWordShapeCount || 0),
    byteShape: shape,
    status,
    evidence: [
      ...(split?.evidence || []).slice(0, 4),
      ...(consumer?.evidence || []).slice(0, 4),
      'Grouped palette-tail refinement stores parser boundaries, counts, shape booleans, and evidence only; it does not store payload bytes.',
    ],
  };
}

function buildCatalog(mapData, rom) {
  const splitCatalog = requireCatalog(mapData, splitCatalogId);
  const consumerCatalog = requireCatalog(mapData, consumerCatalogId);
  const paletteScriptCatalog = requireCatalog(mapData, paletteScriptCatalogId);
  const segments = targetRegionIds.map(regionId => buildSegment(mapData, rom, splitCatalog, consumerCatalog, regionId));
  const screenProgTable = containingRegion(mapData, 0x1CCC0);
  const unresolvedPayloadBytes = segments.reduce((sum, segment) => sum + segment.range.size, 0);
  const sameBankPointerCandidateCount = segments.reduce((sum, segment) => sum + segment.sameBankPointerCandidateCount, 0);
  const bankMismatchWordShapeCount = segments.reduce((sum, segment) => sum + segment.bankMismatchWordShapeCount, 0);
  const parserEndExclusive = segments.find(segment => segment.paletteParserEndExclusive)?.paletteParserEndExclusive || '';
  const status = sameBankPointerCandidateCount === 0
    ? 'post_palette_script_payloads_no_same_bank_consumer'
    : 'post_palette_script_payloads_have_same_bank_pointer_leads';
  const evidence = [
    `${splitCatalogId} splits the _DATA_1CABB_ tail into fill blocks and three unresolved payload regions.`,
    `${consumerCatalogId} proves these three payload regions start after the parsed palette-script prefix and are not consumed by the palette-script parser.`,
    `The next mapped structure is ${screenProgTableLabel} at 0x1CCC0, consumed by the _LABEL_5EB_/_LABEL_604_ screen-program path rather than by the palette-tail payloads.`,
    'No same-bank pointer-bearing source currently resolves into the three unresolved payload regions; cross-bank word shapes are retained only as false-positive leads.',
    'Metadata-only audit; no ROM bytes, decoded palettes, decoded tile maps, graphics, rendered pixels, audio, or text payloads are embedded.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: offsets, segment roles, parser boundaries, pointer-lead counts, shape booleans, region ids, and evidence. No ROM bytes, decoded palettes, tile-map payloads, graphics, rendered pixels, audio, or text payloads are embedded.',
    summary: {
      segmentCount: segments.length,
      targetRegionIds,
      parentLabel: '_DATA_1CABB_',
      paletteScriptCatalogId: paletteScriptCatalog.id,
      paletteParserEndExclusive: parserEndExclusive,
      unresolvedPayloadBytes,
      sameBankPointerCandidateCount,
      bankMismatchWordShapeCount,
      exactAsmLabelReferenceCount: segments.reduce((sum, segment) => sum + segment.exactAsmLabelRefCount, 0),
      byStatus: countBy(segments, segment => segment.status),
      byType: countBy(segments, segment => segment.region.type),
      nextStructure: {
        label: screenProgTableLabel,
        offset: '0x1CCC0',
        region: compactRegion(screenProgTable),
        role: 'screen_prog_pointer_table',
      },
      status,
      persistedRomByteCount: 0,
      persistedPaletteByteCount: 0,
      persistedTileMapByteCount: 0,
      persistedPixelCount: 0,
    },
    segments,
    paletteScriptSummary: paletteScriptCatalog.summary || null,
    splitSummary: splitCatalog.summary || null,
    consumerSummary: consumerCatalog.summary || null,
    evidence,
    nextLeads: [
      'Trace any runtime code that reads the 0x1CBB9-0x1CCBF payload range outside the palette and _LABEL_604_ screen-program pointer paths.',
      'If a consumer is found for the 15x16 candidate at r2817, add a decoder that stores dimensions and offsets only, not tile/index payload bytes.',
      'Keep r2815 and r2816 as unresolved explicit/fill payload fragments until a concrete routine or table reference is proven.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  for (const segment of catalog.segments) {
    const region = findRegion(mapData, segment.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.paletteTailLayoutRefinementAudit = {
      catalogId,
      kind: 'palette_tail_layout_refinement_segment',
      status: segment.status,
      confidence: segment.sameBankPointerCandidateCount === 0 ? 'medium' : 'low',
      splitRole: segment.splitRole,
      consumerRole: segment.consumerRole,
      consumerStatus: segment.consumerStatus,
      paletteParserStatus: segment.paletteParserStatus,
      sameBankPointerCandidateCount: segment.sameBankPointerCandidateCount,
      bankMismatchWordShapeCount: segment.bankMismatchWordShapeCount,
      byteShape: segment.byteShape,
      summary: `${segment.region.id} is a post-_DATA_1CABB_ tail segment with no confirmed same-bank consumer.`,
      evidence: segment.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (region.analysis.unresolvedAssetConsumerAudit) {
      region.analysis.unresolvedAssetConsumerAudit.refinedByPaletteTailLayoutAudit = catalogId;
      region.analysis.unresolvedAssetConsumerAudit.paletteTailLayoutStatus = segment.status;
    }
    annotated.push({
      region: compactRegion(region),
      status: segment.status,
      sameBankPointerCandidateCount: segment.sameBankPointerCandidateCount,
      bankMismatchWordShapeCount: segment.bankMismatchWordShapeCount,
    });
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [];

  if (apply) {
    mapData.paletteCatalogs = (mapData.paletteCatalogs || []).filter(item => item.id !== catalogId);
    mapData.paletteCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'palette_tail_layout_refinement_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
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
    segments: catalog.segments.map(segment => ({
      region: segment.region,
      status: segment.status,
      consumerStatus: segment.consumerStatus,
      sameBankPointerCandidateCount: segment.sameBankPointerCandidateCount,
      bankMismatchWordShapeCount: segment.bankMismatchWordShapeCount,
      byteShape: segment.byteShape,
    })),
  }, null, 2));
}

main();
