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
const catalogId = 'world-palette-tail-split-catalog-2026-06-25';
const reportId = 'palette-tail-split-audit-2026-06-25';

const parentRegionId = 'r2788';
const parentOffset = 0x1CB03;
const parentOriginalSize = 445;

const segments = [
  {
    offset: 0x1CB03,
    size: 173,
    type: 'null',
    confidence: 'high',
    role: 'zero_fill_after_palette_script',
    name: 'zero fill after _DATA_1CABB_ palette script',
    summary: 'Explicit .dsb 173, $00 after the parsed _DATA_1CABB_ palette-script prefix.',
    evidence: [
      'ASM line 27952 ends the parsed _DATA_1CABB_ palette-script prefix with F0 C9 8A.',
      'ASM line 27953 emits .dsb 173, $00 from 0x1CB03 through 0x1CBAF.',
    ],
  },
  {
    offset: 0x1CBB0,
    size: 9,
    type: 'null',
    confidence: 'high',
    role: 'ff_fill_after_palette_script',
    name: '0xFF fill after _DATA_1CABB_ palette script',
    summary: 'Explicit .dsb 9, $FF following the zero-fill block after _DATA_1CABB_.',
    evidence: [
      'ASM line 27954 emits .dsb 9, $FF from 0x1CBB0 through 0x1CBB8.',
    ],
  },
  {
    offset: 0x1CBB9,
    size: 7,
    type: 'data_table',
    confidence: 'low',
    role: 'unresolved_byte_fragment_after_palette_script',
    name: 'unresolved byte fragment after _DATA_1CABB_ palette script',
    summary: 'Short explicit byte fragment after the fill blocks; no exact runtime consumer is confirmed yet.',
    evidence: [
      'ASM line 27955 emits seven explicit bytes from 0x1CBB9 through 0x1CBBF.',
      'No exact executable consumer for this fragment has been identified yet.',
    ],
  },
  {
    offset: 0x1CBC0,
    size: 16,
    type: 'data_table',
    confidence: 'low',
    role: 'c1_fill_after_palette_script',
    name: '0xC1 fill block after _DATA_1CABB_ palette script',
    summary: 'Explicit .dsb 16, $C1 after a short unresolved byte fragment; role remains unknown.',
    evidence: [
      'ASM line 27956 emits .dsb 16, $C1 from 0x1CBC0 through 0x1CBCF.',
      'No exact executable consumer for this fill block has been identified yet.',
    ],
  },
  {
    offset: 0x1CBD0,
    size: 240,
    type: 'tile_map',
    confidence: 'low',
    role: 'candidate_15x16_tile_index_payload_after_palette_script_tail',
    name: 'candidate 15x16 tile-index payload after _DATA_1CABB_',
    summary: 'Low-confidence 15x16 tile-index payload candidate between the fill blocks and the _DATA_1CCC0_ screen-program pointer table.',
    shape: {
      width: 16,
      height: 15,
      bytesPerCell: 1,
      byteCount: 240,
      consumerStatus: 'unresolved_no_exact_executable_consumer',
    },
    evidence: [
      'ASM lines 27957-27972 emit 240 explicit bytes from 0x1CBD0 through 0x1CCBF.',
      'The payload size is exactly 15 rows by 16 one-byte tile/index cells.',
      'ASM lines 27974-27976 start the _DATA_1CCC0_ screen-program pointer table at 0x1CCC0, immediately after this payload.',
      'No exact executable consumer for this payload has been identified yet.',
    ],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
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
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function nextRegionNumber(mapData) {
  let maxId = 0;
  for (const region of mapData.regions || []) {
    const match = /^r(\d+)$/.exec(region.id || '');
    if (match) maxId = Math.max(maxId, Number(match[1]));
  }
  return maxId + 1;
}

function formatRegionId(number) {
  return 'r' + String(number).padStart(4, '0');
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-palette-tail-split-audit.mjs',
    summary: {
      parentRegionId,
      parentOffset: hex(parentOffset),
      parentOriginalSize,
      segmentCount: segments.length,
      nullBytes: segments.filter(item => item.type === 'null').reduce((sum, item) => sum + item.size, 0),
      unresolvedPayloadBytes: segments.filter(item => item.type !== 'null').reduce((sum, item) => sum + item.size, 0),
      candidateTileMapBytes: segments.filter(item => item.type === 'tile_map').reduce((sum, item) => sum + item.size, 0),
      assetPolicy: 'Metadata only: offsets, split boundaries, fill roles, confidence, and ASM line evidence. No ROM bytes or decoded assets are embedded.',
    },
    parent: regionRef(findRegionById(mapData, parentRegionId)),
    segments: segments.map(item => ({
      offset: hex(item.offset),
      endInclusive: hex(item.offset + item.size - 1),
      size: item.size,
      type: item.type,
      confidence: item.confidence,
      role: item.role,
      name: item.name,
      summary: item.summary,
      shape: item.shape || null,
      region: regionRef(findExactRegion(mapData, item.offset)),
      evidence: item.evidence,
    })),
    evidence: [
      'ASM lines 27945-27952 define _DATA_1CABB_ and end its parsed palette-script prefix at 0x1CB02.',
      'ASM lines 27953-27956 explicitly define the zero-fill, FF-fill, short byte fragment, and C1-fill boundaries.',
      'ASM lines 27957-27976 define the remaining payload through 0x1CCBF followed by _DATA_1CCC0_ at 0x1CCC0.',
    ],
  };
}

function annotateSegment(region, segment, previousType) {
  const before = regionRef(region);
  region.size = segment.size;
  region.type = segment.type;
  region.name = segment.name;
  region.confidence = segment.confidence;
  region.notes = segment.summary;
  region.analysis = region.analysis || {};
  region.analysis.paletteTailSplitAudit = {
    catalogId,
    kind: segment.role,
    confidence: segment.confidence,
    typeBeforeAudit: previousType || before?.type || 'unknown',
    typeAfterAudit: segment.type,
    changedType: (previousType || before?.type || 'unknown') !== segment.type,
    summary: segment.summary,
    shape: segment.shape || null,
    evidence: segment.evidence,
    generatedAt: now,
    tool: 'tools/world-palette-tail-split-audit.mjs',
  };
  return {
    before,
    after: regionRef(region),
    role: segment.role,
    confidence: segment.confidence,
    changedType: region.analysis.paletteTailSplitAudit.changedType,
  };
}

function applyAnnotations(mapData) {
  const changedRegions = [];
  const missingRegions = [];
  let nextId = nextRegionNumber(mapData);
  const parent = findRegionById(mapData, parentRegionId);
  if (!parent) {
    missingRegions.push({ id: parentRegionId, offset: hex(parentOffset), role: 'palette_tail_parent' });
    return { changedRegions, missingRegions };
  }

  for (const segment of segments) {
    let region = findExactRegion(mapData, segment.offset);
    const previousType = region ? (region.type || 'unknown') : 'new';
    if (!region) {
      region = {
        id: formatRegionId(nextId++),
        offset: hex(segment.offset),
        size: segment.size,
        type: segment.type,
        name: segment.name,
        confidence: segment.confidence,
        notes: segment.summary,
      };
      mapData.regions.push(region);
    }
    changedRegions.push(annotateSegment(region, segment, previousType));
  }

  mapData.regions.sort((a, b) => offsetOf(a) - offsetOf(b) || (a.size || 0) - (b.size || 0));
  return { changedRegions, missingRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let changes = { changedRegions: [], missingRegions: [] };

  if (apply) {
    changes = applyAnnotations(mapData);
    const finalCatalog = buildCatalog(mapData);
    mapData.paletteCatalogs = (mapData.paletteCatalogs || []).filter(item => item.id !== catalogId);
    mapData.paletteCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'palette_tail_split_audit',
      generatedAt: now,
      tool: 'tools/world-palette-tail-split-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changes.changedRegions.length,
        changedRegionTypes: changes.changedRegions.filter(item => item.changedType).length,
        missingRegions: changes.missingRegions.length,
      },
      changedRegions: changes.changedRegions,
      missingRegions: changes.missingRegions,
      evidence: finalCatalog.evidence,
      nextLeads: [
        'Trace references to the 0x1CBD0-0x1CCBF payload before promoting it beyond low-confidence data_table.',
        'Check whether the 0x1CBD0 payload is consumed indirectly by any pointer expression or compressed stream parser.',
        'Keep the explicit fill segments separate so future audits do not misclassify padding as screen or palette data.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    segments: catalog.segments.map(item => ({
      offset: item.offset,
      size: item.size,
      type: item.type,
      role: item.role,
      confidence: item.confidence,
    })),
    changes,
  }, null, 2));
}

main();
