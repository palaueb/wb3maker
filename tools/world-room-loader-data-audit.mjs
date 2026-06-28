#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-room-loader-data-catalog-2026-06-24';
const reportId = 'room-loader-data-audit-2026-06-24';
const zoneGraphId = 'world-zone-graph-2026-06-24';

const REGION_UPDATES = [
  {
    offset: 0x10000,
    inferredType: 'data_table',
    role: 'room_overlay_tile_record_table',
    confidence: 'high',
    summary: 'Indexed as 8-byte records by _RAM_CF64_; code writes four bytes at the target VDP address and four bytes at the next tile row.',
    evidence: [
      'ASM lines 3542-3551: _RAM_CF64_ is multiplied by 8 and added to _DATA_10000_.',
      'ASM lines 3565-3570: bank 6 is selected and IX is loaded from the computed _DATA_10000_ record pointer.',
      'ASM lines 3574-3608: the routine writes IX+0..3 and IX+4..7 to VDP addresses separated by 0x40.',
      'The screen-program reachability audit marks this region unexplained by _LABEL_604_ roots or _DATA_1CCC0_ table targets.',
    ],
  },
  {
    offset: 0x10C90,
    inferredType: 'room_seq_table',
    role: 'initial_room_descriptor',
    confidence: 'high',
    summary: '_DATA_10C90_ is a direct _LABEL_2620_ room-loader descriptor entry.',
    evidence: [
      'ASM line 1476 loads HL with _DATA_10C90_.',
      'ASM line 1477 calls _LABEL_2620_.',
      '_LABEL_2620_ reads room descriptor header bytes, calls _LABEL_26F4_, and initializes room state instead of calling _LABEL_604_.',
    ],
  },
  {
    offset: 0x10C96,
    inferredType: 'room_data',
    role: 'room_descriptor_graph_region',
    confidence: 'high',
    summary: '_DATA_10C96_ is a direct _LABEL_2620_ room-loader entry and the root of the validated room descriptor graph.',
    evidence: [
      'ASM line 1490 loads HL with _DATA_10C96_; ASM line 1491 calls _LABEL_2620_.',
      'ASM line 1600 loads HL with _DATA_10C96_; ASM line 1601 calls _LABEL_2620_.',
      'Zone graph world-zone-graph-2026-06-24 validates this entry as a room descriptor graph root with descriptor and door-edge metadata.',
      'The screen-program reachability audit marks this region unexplained by _LABEL_604_ roots or _DATA_1CCC0_ table targets.',
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

function zoneGraphSummary(mapData) {
  const graph = (mapData.zoneGraphs || []).find(item => item.id === zoneGraphId);
  return graph?.summary || null;
}

function buildCatalog(mapData) {
  const zoneSummary = zoneGraphSummary(mapData);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-room-loader-data-audit.mjs',
    summary: {
      auditedRegions: REGION_UPDATES.length,
      roomLoader: '_LABEL_2620_',
      vdpOverlayRecordTable: hex(0x10000),
      roomDescriptorGraphRoot: hex(0x10C96),
      zoneGraphDescriptorCount: zoneSummary?.descriptorCount ?? null,
      zoneGraphEdgeCount: zoneSummary?.edgeCount ?? null,
      assetPolicy: 'Metadata only: offsets, labels, routine references, graph counts, and region roles. No ROM bytes, decoded rooms, graphics, or text are embedded.',
    },
    loader: {
      label: '_LABEL_2620_',
      role: 'room_loader',
      evidence: [
        'ASM lines 6363-6444: _LABEL_2620_ reads room descriptor state, calls _LABEL_26F4_, initializes entity/room RAM, and returns.',
        'ASM lines 6472-6484: _LABEL_26F4_ copies room subrecord bytes and calls _LABEL_8FB_ using the descriptor-selected loader pointer.',
      ],
    },
    zoneGraph: {
      id: zoneGraphId,
      summary: zoneSummary,
    },
    regions: REGION_UPDATES.map(item => ({
      offset: hex(item.offset),
      inferredType: item.inferredType,
      role: item.role,
      confidence: item.confidence,
      summary: item.summary,
      region: regionRef(findExactRegion(mapData, item.offset)),
      evidence: item.evidence,
    })),
    unresolvedLeads: [
      {
        offset: hex(0x1072A),
        reason: 'Large bank-4 blob between the room pointer table and first direct room descriptor; no direct label reference has been confirmed yet.',
      },
      {
        offset: hex(0x12486),
        reason: 'Tail after _DATA_12337_ 8FB loader region still needs a non-screen consumer or decoder before retyping.',
      },
    ],
  };
}

function shouldRetype(region, inferredType) {
  if (!region) return false;
  const current = region.type || 'unknown';
  if (current === inferredType) return false;
  if (inferredType === 'room_data') return ['screen_prog', 'data_table', 'unknown', 'raw_byte'].includes(current);
  if (inferredType === 'room_seq_table') return ['screen_prog', 'data_table', 'room_data', 'unknown', 'raw_byte'].includes(current);
  if (inferredType === 'data_table') return ['screen_prog', 'unknown', 'raw_byte'].includes(current);
  return false;
}

function annotateRegion(region, item, zoneSummary) {
  const typeBefore = region.type || 'unknown';
  const changedType = shouldRetype(region, item.inferredType);
  if (changedType) region.type = item.inferredType;
  region.analysis = region.analysis || {};
  region.analysis.roomLoaderDataAudit = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    summary: item.summary,
    loader: '_LABEL_2620_',
    zoneGraphSummary: item.offset === hex(0x10C96) ? zoneSummary : undefined,
    evidence: item.evidence,
    generatedAt: now,
    tool: 'tools/world-room-loader-data-audit.mjs',
  };
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    typeBefore,
    typeAfter: region.type || typeBefore,
    changedType,
    kind: item.role,
  };
}

function applyAnnotations(mapData, catalog) {
  const changed = [];
  const evidenceOnly = [];
  const missing = [];
  for (const item of catalog.regions) {
    const offset = parseInt(item.offset, 16);
    const region = findExactRegion(mapData, offset);
    if (!region) {
      missing.push({ offset: item.offset, inferredType: item.inferredType, role: item.role });
      continue;
    }
    const result = annotateRegion(region, item, catalog.zoneGraph.summary);
    if (result.changedType) changed.push(result);
    else evidenceOnly.push(result);
  }
  return { changed, evidenceOnly, missing };
}

function changedRegionRefs(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.roomLoaderDataAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.roomLoaderDataAudit.kind,
      confidence: region.analysis.roomLoaderDataAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const changes = applyAnnotations(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_loader_data_audit',
      generatedAt: now,
      tool: 'tools/world-room-loader-data-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changedRegionRefs(mapData).length,
        retypeChangesThisRun: changes.changed.length,
        evidenceOnlyRegions: changes.evidenceOnly.length,
        missingRegions: changes.missing.length,
      },
      changedRegions: changedRegionRefs(mapData),
      retypeChangesThisRun: changes.changed,
      evidenceOnlyRegions: changes.evidenceOnly,
      missingRegions: changes.missing,
      evidence: finalCatalog.loader.evidence,
      nextLeads: [
        'Write a read-only _LABEL_2620_ descriptor parser that emits header fields, subrecord pointers, 8FB loader references, palette indices, and door table links.',
        'Trace the unlabeled 0x1072A bank-4 blob before assigning it to the room descriptor graph.',
        'Identify a consumer for 0x12486 or prove it is unused/trailing data after the _DATA_12337_ loader block.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    retypeChanges: changes.changed,
    evidenceOnlyRegions: changes.evidenceOnly,
    missingRegions: changes.missing,
    unresolvedLeads: catalog.unresolvedLeads,
  }, null, 2));
}

main();
