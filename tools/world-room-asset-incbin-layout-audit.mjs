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
const toolName = 'tools/world-room-asset-incbin-layout-audit.mjs';
const incbinCatalogId = 'world-asm-incbin-span-catalog-2026-06-25';
const sourceSpanId = 'asm-incbin-12337';
const catalogId = 'world-room-asset-incbin-layout-catalog-2026-06-25';
const reportId = 'room-asset-incbin-layout-audit-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
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

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegion(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function overlappingRegions(mapData, start, endExclusive) {
  return (mapData.regions || [])
    .filter(region => regionStart(region) < endExclusive && regionEnd(region) > start)
    .sort((a, b) => regionStart(a) - regionStart(b) || regionEnd(a) - regionEnd(b) || String(a.id).localeCompare(String(b.id)));
}

function evidenceRefs(region) {
  const refs = [];
  for (const key of [
    'asmIncbinSpanAudit',
    'asmAssetAudit',
    'loaderBoundaryAudit',
    'zoneLoaderBoundaryAudit',
    'roomSubrecordAudit',
    'roomSubrecordLoaderRefs',
    'tileSourceAudit',
    'zoneRenderProvenanceAudit',
    'inlineTransitionRecipeAudit',
    'inlineTransitionRenderProvenanceAudit',
    'roomEntityListAudit',
    'roomEntityOrphanListAudit',
    'roomEntityDynamicTileAudit',
    'roomEntityBehaviorLinkAudit',
    'unresolvedAssetConsumerAudit',
  ]) {
    const audit = region.analysis?.[key];
    if (!audit) continue;
    refs.push({
      analysisKey: key,
      catalogId: audit.catalogId || '',
      kind: audit.kind || '',
      role: audit.role || '',
      confidence: audit.confidence || '',
      summary: audit.summary || '',
    });
  }
  return refs;
}

function consumerClasses(region) {
  const analysis = region.analysis || {};
  const classes = [];
  if (analysis.asmAssetAudit?.relations?.callerRoutines?.includes('_LABEL_1E200_')) classes.push('direct_sequence_loader_call');
  if (analysis.zoneRenderProvenanceAudit) classes.push('zone_recipe_render_source');
  if (analysis.inlineTransitionRecipeAudit || analysis.inlineTransitionRenderProvenanceAudit) classes.push('inline_transition_recipe_source');
  if (analysis.roomSubrecordAudit?.kind === 'room_subrecord_vram_loader_8fb' || analysis.roomSubrecordLoaderRefs) classes.push('room_subrecord_pointer_source');
  if (analysis.roomEntityListAudit?.kind === 'room_entity_source_lists') classes.push('cf62_room_entity_list_source');
  if (analysis.roomEntityOrphanListAudit) classes.push('structural_orphan_entity_list_source');
  if (analysis.roomSubrecordAudit?.kind?.includes('zero')) classes.push('padding_or_separator');
  if (analysis.roomSubrecordAudit?.kind?.includes('sentinel')) classes.push('empty_entity_list_sentinel');
  return [...new Set(classes)].sort();
}

function segmentRole(region) {
  const analysis = region.analysis || {};
  if (region.type === 'vram_loader_8fb') {
    if (analysis.asmAssetAudit?.relations?.callerRoutines?.includes('_LABEL_1E200_')) {
      return {
        role: 'direct_sequence_vram_loader_8fb',
        confidence: 'high',
        reason: '_LABEL_1E200_ directly loads this ASM label and calls _LABEL_8FB_.',
      };
    }
    if (analysis.roomSubrecordAudit?.kind === 'room_subrecord_vram_loader_8fb') {
      return {
        role: analysis.zoneRenderProvenanceAudit
          ? 'zone_or_inline_room_subrecord_vram_loader_8fb'
          : 'structural_room_subrecord_vram_loader_8fb',
        confidence: 'high',
        reason: 'Room subrecord pointers select this 8FB loader and the loader decodes cleanly.',
      };
    }
    if (analysis.zoneLoaderBoundaryAudit?.kind === 'zone_vram_loader_8fb') {
      return {
        role: 'zone_graph_vram_loader_8fb',
        confidence: 'high',
        reason: 'Zone graph descriptors reach this 8FB loader and the loader decodes cleanly.',
      };
    }
    return {
      role: 'validated_vram_loader_8fb',
      confidence: analysis.tileSourceAudit ? 'high' : 'medium',
      reason: 'Region is typed as an 8FB loader inside the room asset span.',
    };
  }
  if (region.type === 'entity_data') {
    if (analysis.roomEntityOrphanListAudit) {
      return {
        role: 'structural_orphan_room_entity_source_lists',
        confidence: 'high',
        reason: 'The span structurally decodes as room entity source lists but no confirmed room subrecord pointer reaches it.',
      };
    }
    if (analysis.roomEntityDynamicTileAudit || analysis.roomEntityListAudit?.kind === 'room_entity_source_lists') {
      return {
        role: 'reached_room_entity_source_lists',
        confidence: 'high',
        reason: 'Room subrecord CF62 pointers select these room entity source lists, which feed dynamic tile upload metadata.',
      };
    }
    if (analysis.roomSubrecordAudit?.kind === 'room_subrecord_tail_entity_empty_list_sentinel') {
      return {
        role: 'empty_room_entity_list_sentinel',
        confidence: 'high',
        reason: 'Confirmed shared empty room entity-list sentinel selected through the room entity pointer field.',
      };
    }
    return {
      role: 'room_entity_data_segment',
      confidence: 'medium',
      reason: 'Region is typed as entity data inside the room asset span.',
    };
  }
  if (region.type === 'null') {
    return {
      role: 'zero_padding_or_separator',
      confidence: 'high',
      reason: 'Existing room subrecord audit classifies this span as zero padding/separator metadata.',
    };
  }
  return {
    role: 'unexpected_room_asset_span_segment',
    confidence: 'low',
    reason: `Unexpected region type ${region.type || 'unknown'} inside _DATA_12337_.`,
  };
}

function loaderSummary(region) {
  const audit = region.analysis?.tileSourceAudit;
  if (!audit) return null;
  return {
    catalogId: audit.catalogId || '',
    format: audit.format || '',
    totalTiles: Number(audit.stats?.totalTiles || 0),
    copyEntries: Number(audit.stats?.copyEntries || 0),
    zeroEntries: Number(audit.stats?.zeroEntries || 0),
    sourceRegionCount: Array.isArray(audit.sourceRegions) ? audit.sourceRegions.length : 0,
    maxVramTile: audit.stats?.maxVramTile || null,
    warningCount: Number(audit.warningCount || 0),
    terminated: Boolean(audit.terminated),
    endReason: audit.endReason || '',
  };
}

function entitySummary(region) {
  const list = region.analysis?.roomEntityListAudit;
  const orphan = region.analysis?.roomEntityOrphanListAudit;
  const dynamic = region.analysis?.roomEntityDynamicTileAudit;
  if (!list && !orphan && !dynamic) return null;
  return {
    decodedListCount: Number(list?.decodedListCount || orphan?.listCount || 0),
    decodedEntityRecords: Number(list?.decodedEntityRecords || orphan?.recordCount || 0),
    uniqueEntityTypeCount: Number(list?.uniqueEntityTypeBytes || orphan?.uniqueEntityTypeCount || 0),
    dynamicUploadCount: Number(dynamic?.totalFirstSeenEntityUploads || 0),
    uniqueDynamicStreamsUsed: Number(dynamic?.uniqueDynamicStreamsUsed || 0),
    persistedCoordinateCount: 0,
    persistedRomByteCount: 0,
  };
}

function segmentEntry(region, start, index) {
  const role = segmentRole(region);
  const regionS = regionStart(region);
  const regionE = regionEnd(region);
  return {
    index,
    region: compactRegion(region),
    spanRelativeRange: {
      startBytes: regionS - start,
      endExclusiveBytes: regionE - start,
    },
    role: role.role,
    confidence: role.confidence,
    reason: role.reason,
    consumerClasses: consumerClasses(region),
    loaderSummary: loaderSummary(region),
    entitySummary: entitySummary(region),
    evidenceRefs: evidenceRefs(region),
  };
}

function buildLayout(mapData, spanEntry) {
  const start = parseHex(spanEntry.declaredSpan.start);
  const endExclusive = parseHex(spanEntry.declaredSpan.endExclusive);
  const regions = overlappingRegions(mapData, start, endExclusive);
  const segments = regions.map((region, index) => segmentEntry(region, start, index));
  const validationIssues = [];
  let cursor = start;
  for (const region of regions) {
    if (regionStart(region) > cursor) {
      validationIssues.push({
        severity: 'warning',
        kind: 'room_asset_span_gap',
        start: hex(cursor),
        endExclusive: hex(regionStart(region)),
      });
    }
    cursor = Math.max(cursor, regionEnd(region));
  }
  if (cursor < endExclusive) {
    validationIssues.push({
      severity: 'warning',
      kind: 'room_asset_span_gap',
      start: hex(cursor),
      endExclusive: hex(endExclusive),
    });
  }
  for (const segment of segments) {
    if (segment.role === 'unexpected_room_asset_span_segment') {
      validationIssues.push({
        severity: 'warning',
        kind: 'unexpected_room_asset_span_segment',
        region: segment.region,
      });
    }
  }
  return {
    id: 'room_asset_incbin_layout_12337',
    incbinSpanId: spanEntry.id,
    label: spanEntry.label,
    declaredSpan: spanEntry.declaredSpan,
    sourceRegion: spanEntry.sourceRegion,
    coverageStatus: spanEntry.coverageStatus,
    parserStatus: spanEntry.parserStatus,
    segmentCount: segments.length,
    byRegionType: countBy(segments, segment => segment.region.type),
    byRole: countBy(segments, segment => segment.role),
    byConfidence: countBy(segments, segment => segment.confidence),
    consumerClassCounts: countBy(segments.flatMap(segment => segment.consumerClasses), item => item),
    totalLoaderSegments: segments.filter(segment => segment.loaderSummary).length,
    totalLoaderTiles: segments.reduce((sum, segment) => sum + (segment.loaderSummary?.totalTiles || 0), 0),
    totalEntitySegments: segments.filter(segment => segment.entitySummary).length,
    totalDecodedEntityLists: segments.reduce((sum, segment) => sum + (segment.entitySummary?.decodedListCount || 0), 0),
    totalDecodedEntityRecords: segments.reduce((sum, segment) => sum + (segment.entitySummary?.decodedEntityRecords || 0), 0),
    paddingBytes: segments.filter(segment => segment.region.type === 'null').reduce((sum, segment) => sum + segment.region.size, 0),
    persistedRomByteCount: 0,
    persistedTileByteCount: 0,
    persistedPixelCount: 0,
    persistedCoordinateCount: 0,
    segments,
    validationIssues,
    evidence: [
      `${incbinCatalogId} identifies _DATA_12337_ as one ASM .incbin span split across current room-loader and entity-data regions.`,
      'Existing room subrecord, zone loader, tile source, and room entity audits provide the consumer evidence for each segment.',
      'This layout stores only offsets, counts, region ids/types, parser roles, and catalog references; it does not store ROM bytes, tiles, pixels, or coordinates.',
    ],
  };
}

function buildCatalog(mapData) {
  const incbinCatalog = requireCatalog(mapData, incbinCatalogId);
  const spanEntry = (incbinCatalog.entries || []).find(entry => entry.id === sourceSpanId);
  if (!spanEntry) throw new Error(`Missing ${sourceSpanId} in ${incbinCatalogId}`);
  const layout = buildLayout(mapData, spanEntry);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      incbinCatalogId,
      'world-zone-loader-boundary-catalog-2026-06-25',
      'world-room-subrecord-catalog-2026-06-25',
      'world-room-entity-list-catalog-2026-06-25',
      'world-room-entity-orphan-list-catalog-2026-06-25',
      'world-room-entity-dynamic-tile-catalog-2026-06-25',
      'world-tile-source-catalog-2026-06-24',
    ],
    assetPolicy: 'Metadata only: ASM span ids, offsets, region ids/types, loader/entity counts, role labels, and evidence references. No ROM bytes, decoded tiles, rendered pixels, screenshots, entity coordinates, audio, text payloads, or gameplay constants are embedded.',
    summary: {
      layoutCount: 1,
      segmentCount: layout.segmentCount,
      byRegionType: layout.byRegionType,
      byRole: layout.byRole,
      byConfidence: layout.byConfidence,
      consumerClassCounts: layout.consumerClassCounts,
      totalLoaderSegments: layout.totalLoaderSegments,
      totalLoaderTiles: layout.totalLoaderTiles,
      totalEntitySegments: layout.totalEntitySegments,
      totalDecodedEntityLists: layout.totalDecodedEntityLists,
      totalDecodedEntityRecords: layout.totalDecodedEntityRecords,
      paddingBytes: layout.paddingBytes,
      validationIssueCount: layout.validationIssues.length,
      persistedRomByteCount: layout.persistedRomByteCount,
      persistedTileByteCount: layout.persistedTileByteCount,
      persistedPixelCount: layout.persistedPixelCount,
      persistedCoordinateCount: layout.persistedCoordinateCount,
    },
    layouts: [layout],
    validationIssues: layout.validationIssues,
    evidence: layout.evidence,
    nextLeads: [
      'Trace non-CF62 consumers for the structural orphan room entity source lists before classifying them as unused.',
      'Expose the _DATA_12337_ room asset layout in the analyzer so loader/entity/padding segments can be browsed without ROM payload data.',
      'Use segment consumer classes to verify which room recipes require each 8FB loader and which entity source lists have active room-subrecord reachability.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  const layout = catalog.layouts[0];
  for (const segment of layout.segments) {
    const region = findRegion(mapData, segment.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.roomAssetIncbinLayoutAudit = {
      catalogId,
      kind: 'room_asset_incbin_layout_segment',
      incbinSpanId: layout.incbinSpanId,
      segmentIndex: segment.index,
      role: segment.role,
      confidence: segment.confidence,
      consumerClasses: segment.consumerClasses,
      spanRelativeRange: segment.spanRelativeRange,
      loaderSummary: segment.loaderSummary,
      entitySummary: segment.entitySummary,
      summary: `${segment.region.id} is segment ${segment.index} of _DATA_12337_: ${segment.role}.`,
      evidenceRefs: segment.evidenceRefs,
      evidence: [
        `Segment belongs to ASM .incbin span ${layout.incbinSpanId}.`,
        segment.reason,
        'Metadata-only audit; no ROM bytes, decoded tiles, rendered pixels, entity coordinates, or text payloads are embedded.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      region: compactRegion(region),
      incbinSpanId: layout.incbinSpanId,
      segmentIndex: segment.index,
      role: segment.role,
      confidence: segment.confidence,
    });
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [];

  if (apply) {
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_asset_incbin_layout_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
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
    layouts: catalog.layouts.map(layout => ({
      id: layout.id,
      incbinSpanId: layout.incbinSpanId,
      declaredSpan: layout.declaredSpan,
      segmentCount: layout.segmentCount,
      byRegionType: layout.byRegionType,
      byRole: layout.byRole,
      consumerClassCounts: layout.consumerClassCounts,
      totalLoaderSegments: layout.totalLoaderSegments,
      totalLoaderTiles: layout.totalLoaderTiles,
      totalEntitySegments: layout.totalEntitySegments,
      totalDecodedEntityLists: layout.totalDecodedEntityLists,
      totalDecodedEntityRecords: layout.totalDecodedEntityRecords,
      paddingBytes: layout.paddingBytes,
    })),
  }, null, 2));
}

main();
