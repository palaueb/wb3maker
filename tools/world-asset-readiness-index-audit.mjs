#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-asset-readiness-index-audit.mjs';
const catalogId = 'world-asset-readiness-index-catalog-2026-06-26';
const reportId = 'asset-readiness-index-audit-2026-06-26';
const schemaVersion = 1;

const codeLikeTypes = new Set(['code', 'null']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function hexToInt(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return 0;
  return Number.parseInt(value, 16);
}

function bankFor(offset) {
  return Math.floor(hexToInt(offset) / 0x4000);
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

function assetFamily(type) {
  if (['gfx_tiles', 'tile_map', 'meta_sprite', 'entity_anim_script', 'entity_anim_table', 'dynamic_tile_loader'].includes(type)) {
    return 'graphics_sprites';
  }
  if (['screen_prog', 'screen_prog_table', 'vram_loader_8fb', 'vram_loader_998', 'vdp_stream', 'palette', 'palette_script', 'palette_script_table'].includes(type)) {
    return 'rendering_vdp';
  }
  if (['music', 'audio_driver_data'].includes(type)) return 'audio';
  if (['room_subrecord', 'room_seq_table', 'room_data', 'input_script', 'effect_script'].includes(type)) return 'rooms_events_scripts';
  if (['entity_data', 'entity_behavior_table', 'item_data'].includes(type)) return 'entity_item_data';
  if (['pointer_table', 'data_table', 'text'].includes(type)) return 'support_tables_text';
  return 'other_asset_data';
}

function readiness(region) {
  const analysis = region.analysis || {};
  if (analysis.lowConfidenceResidualTriageAudit) return 'quarantined_residual_not_for_default_decoders';
  if (
    analysis.blankMetaspriteTargetAudit?.kind === 'all_zero_metasprite_fragment' &&
    analysis.quarantinedMetaspriteConfidenceBackfillAudit
  ) {
    return 'quarantined_blank_metasprite_target_not_for_default_decoders';
  }
  if (analysis.blankMetaspriteTargetAudit?.kind === 'declared_zero_fill_metasprite_target') {
    return 'blank_metasprite_noop_target_mapped';
  }
  if (region.confidence === 'low') return 'low_confidence_needs_consumer_trace';
  if (analysis.screenProgReachabilityAudit?.kind === 'embedded_continuation') {
    return 'screen_program_embedded_continuation_mapped';
  }
  if (analysis.bank2VdpResidualFinalDispositionAudit) {
    const detail = analysis.bank2VdpResidualFinalDispositionAudit.detail || {};
    if (detail.promotableGapCount === 0 && detail.unresolvedTraceLeadCount > 0) {
      return 'vdp_stream_final_disposition_with_trace_leads';
    }
    if (detail.promotableGapCount === 0) return 'vdp_stream_final_disposition_no_promotable_residuals';
  }

  switch (region.type) {
    case 'gfx_tiles':
      return 'raw_graphics_bank_decode_from_local_rom';
    case 'music':
      return 'audio_stream_mapped_read_only';
    case 'audio_driver_data':
      return 'audio_driver_data_mapped_read_only';
    case 'screen_prog':
      return 'screen_program_parsed_for_rendering';
    case 'screen_prog_table':
      return 'screen_program_pointer_table_mapped';
    case 'vram_loader_8fb':
    case 'vram_loader_998':
    case 'dynamic_tile_loader':
      return 'tile_loader_stream_parsed';
    case 'vdp_stream':
      return 'vdp_stream_structured_with_gaps';
    case 'palette':
      return 'palette_record_mapped';
    case 'palette_script':
    case 'palette_script_table':
      return 'palette_script_mapped';
    case 'room_subrecord':
    case 'room_seq_table':
    case 'room_data':
      return 'room_structure_mapped';
    case 'entity_anim_script':
    case 'entity_anim_table':
    case 'meta_sprite':
      return 'sprite_animation_structure_mapped';
    case 'entity_data':
    case 'entity_behavior_table':
    case 'item_data':
      return 'entity_item_structure_mapped';
    case 'input_script':
    case 'effect_script':
      return 'script_structure_mapped';
    case 'tile_map':
      return 'tile_map_structure_mapped';
    case 'pointer_table':
      return 'pointer_table_mapped';
    case 'data_table':
      return 'support_data_table_mapped';
    case 'text':
      return 'text_region_mapped_no_payload';
    default:
      return region.confidence === 'high' ? 'mapped_high_confidence_asset_data' : 'mapped_asset_data_needs_review';
  }
}

function compactEntry(region) {
  const analysisKeys = Object.keys(region.analysis || {}).sort();
  const falseSplitAudit = region.analysis?.asmFalseSplitLabelAudit || null;
  const pointerCandidateAudit = region.analysis?.asmPointerCandidateResolutionAudit || null;
  const entry = {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    bank: String(bankFor(region.offset)).padStart(2, '0'),
    type: region.type,
    family: assetFamily(region.type),
    readiness: readiness(region),
    confidence: region.confidence || null,
    name: region.name || '',
    analysisKeys,
  };
  const audit = region.analysis?.lowConfidenceResidualTriageAudit;
  if (audit) {
    entry.quarantineStatus = audit.status;
    entry.quarantineHandling = audit.handling;
  }
  if (falseSplitAudit) {
    const labels = falseSplitAudit.labels || [];
    entry.falseSplitLabelResolution = {
      catalogId: falseSplitAudit.catalogId || null,
      confidence: falseSplitAudit.confidence || null,
      labelCount: labels.length,
      confirmedFalseSplitLabelCount: labels.filter(label => label.status === 'confirmed_false_split_label').length,
      rejectedStandalonePointerPromotionCount: labels.filter(label => label.pointerPromotionAction === 'reject_standalone_pointer_table_promotion').length,
      labels: labels.map(label => ({
        label: label.label,
        offset: label.offset,
        offsetWithinRegion: label.offsetWithinRegion,
        status: label.status,
        pointerPromotionAction: label.pointerPromotionAction,
      })),
    };
  }
  if (pointerCandidateAudit) {
    entry.pointerCandidateResolution = {
      catalogId: pointerCandidateAudit.catalogId || null,
      status: pointerCandidateAudit.status || null,
      kind: pointerCandidateAudit.kind || null,
      confidence: pointerCandidateAudit.confidence || null,
      label: pointerCandidateAudit.label || null,
      genericPointerTableAction: pointerCandidateAudit.genericPointerTableDecision?.action || null,
      preserveType: pointerCandidateAudit.genericPointerTableDecision?.preserveType || null,
      asmEntryCount: pointerCandidateAudit.parsedFromAsm?.entryCount ?? null,
      uniqueTargetCount: pointerCandidateAudit.parsedFromAsm?.uniqueTargetCount ?? null,
    };
  }
  const finalVdp = region.analysis?.bank2VdpResidualFinalDispositionAudit;
  if (finalVdp) {
    entry.vdpResidualFinalDisposition = {
      catalogId: finalVdp.catalogId,
      confidence: finalVdp.confidence,
      promotableGapCount: finalVdp.detail?.promotableGapCount ?? null,
      unpromotedGapCount: finalVdp.detail?.unpromotedGapCount ?? null,
      unresolvedTraceLeadCount: finalVdp.detail?.unresolvedTraceLeadCount ?? null,
      unresolvedTraceLeadBytes: finalVdp.detail?.unresolvedTraceLeadBytes ?? null,
      finalDispositionCounts: finalVdp.detail?.finalDispositionCounts || {},
    };
  }
  return entry;
}

function buildCatalog(mapData) {
  const assetRegions = (mapData.regions || [])
    .filter(region => region.type && !codeLikeTypes.has(region.type))
    .map(compactEntry)
    .sort((a, b) => hexToInt(a.offset) - hexToInt(b.offset) || a.id.localeCompare(b.id));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    assetPolicy: 'Metadata only: region ids, offsets, sizes, banks, types, confidence, readiness classes, audit keys, and quarantine handling. No ROM bytes, decoded graphics, pixels, screenshots, music payloads, text payloads, hashes, or instruction bytes are embedded.',
    selectionRule: {
      source: 'All non-code, non-null mapped regions in projects/WORLD/map.json.',
      purpose: 'Provide a compact readiness index for analyzer panels, asset coverage audits, and next reverse-engineering passes.',
      limitation: 'Readiness is derived from existing region types and evidence audits. It is not a new decoder proof by itself.',
    },
    summary: {
      assetRegionCount: assetRegions.length,
      assetByteCount: assetRegions.reduce((sum, entry) => sum + (entry.size || 0), 0),
      familyCounts: countBy(assetRegions, entry => entry.family),
      typeCounts: countBy(assetRegions, entry => entry.type),
      confidenceCounts: countBy(assetRegions, entry => entry.confidence || 'none'),
      readinessCounts: countBy(assetRegions, entry => entry.readiness),
      quarantinedResidualCount: assetRegions.filter(entry => entry.readiness === 'quarantined_residual_not_for_default_decoders').length,
      quarantinedBlankMetaspriteTargetCount: assetRegions.filter(entry => entry.readiness === 'quarantined_blank_metasprite_target_not_for_default_decoders').length,
      blankMetaspriteNoopTargetCount: assetRegions.filter(entry => entry.readiness === 'blank_metasprite_noop_target_mapped').length,
      embeddedScreenProgContinuationCount: assetRegions.filter(entry => entry.readiness === 'screen_program_embedded_continuation_mapped').length,
      lowConfidenceUnquarantinedCount: assetRegions.filter(entry => entry.confidence === 'low' && entry.readiness !== 'quarantined_residual_not_for_default_decoders').length,
      falseSplitLabelRegionCount: assetRegions.filter(entry => entry.falseSplitLabelResolution).length,
      confirmedFalseSplitLabelCount: assetRegions.reduce((sum, entry) => sum + (entry.falseSplitLabelResolution?.confirmedFalseSplitLabelCount || 0), 0),
      rejectedStandalonePointerPromotionCount: assetRegions.reduce((sum, entry) => sum + (entry.falseSplitLabelResolution?.rejectedStandalonePointerPromotionCount || 0), 0),
      pointerCandidateRegionCount: assetRegions.filter(entry => entry.pointerCandidateResolution).length,
      rejectedGenericPointerTableRetypeCount: assetRegions.filter(entry => entry.pointerCandidateResolution?.genericPointerTableAction === 'reject_generic_pointer_table_retype').length,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    entries: assetRegions,
    nextLeads: [
      'Use readinessCounts to prioritize true decoder gaps over already-quarantined residuals.',
      'Treat quarantined_blank_metasprite_target_not_for_default_decoders as a blank/no-op lead until consumer-specific runtime evidence proves a normal frame stream.',
      'Treat screen_program_embedded_continuation_mapped entries as split labels inside a decoded root stream, not as independent screen roots.',
      'Keep raw graphics and audio entries as local-ROM decode targets; do not persist decoded payloads.',
      'Only promote quarantined or final-disposition residuals after direct consumer evidence changes their readiness class.',
      'Use falseSplitLabelResolution and pointerCandidateResolution entries to prevent false pointer-table promotions during future automated scans.',
    ],
  };
}

function reportSample(catalog) {
  return {
    firstEntries: catalog.entries.slice(0, 10).map(entry => ({
      id: entry.id,
      offset: entry.offset,
      type: entry.type,
      family: entry.family,
      readiness: entry.readiness,
      confidence: entry.confidence,
    })),
    quarantinedResiduals: catalog.entries
      .filter(entry => entry.readiness === 'quarantined_residual_not_for_default_decoders')
      .map(entry => ({
        id: entry.id,
        offset: entry.offset,
        type: entry.type,
        quarantineStatus: entry.quarantineStatus,
      })),
    splitAndPointerResolutionSamples: catalog.entries
      .filter(entry => entry.falseSplitLabelResolution || entry.pointerCandidateResolution)
      .slice(0, 10)
      .map(entry => ({
        id: entry.id,
        offset: entry.offset,
        type: entry.type,
        falseSplitLabels: entry.falseSplitLabelResolution?.labelCount || 0,
        pointerCandidateAction: entry.pointerCandidateResolution?.genericPointerTableAction || null,
      })),
  };
}

function updateStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.assetReadinessIndexCatalog = catalogId;
  staticMap.summary.assetReadinessIndexRegions = catalog.summary.assetRegionCount;
  staticMap.summary.assetReadinessIndexBytes = catalog.summary.assetByteCount;
  staticMap.summary.assetReadinessConfidenceHigh = catalog.summary.confidenceCounts.high || 0;
  staticMap.summary.assetReadinessConfidenceMedium = catalog.summary.confidenceCounts.medium || 0;
  staticMap.summary.assetReadinessConfidenceLow = catalog.summary.confidenceCounts.low || 0;
  staticMap.summary.assetReadinessQuarantinedResiduals = catalog.summary.quarantinedResidualCount;
  staticMap.summary.assetReadinessQuarantinedBlankMetaspriteTargets = catalog.summary.quarantinedBlankMetaspriteTargetCount;
  staticMap.summary.assetReadinessBlankMetaspriteNoopTargets = catalog.summary.blankMetaspriteNoopTargetCount;
  staticMap.summary.assetReadinessEmbeddedScreenProgContinuations = catalog.summary.embeddedScreenProgContinuationCount;
  staticMap.summary.assetReadinessLowConfidenceUnquarantined = catalog.summary.lowConfidenceUnquarantinedCount;
  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.push('Use world-asset-readiness-index-catalog-2026-06-26 readiness classes to separate true decoder gaps from quarantined residuals, blank metasprite targets, and embedded screen_prog continuations.');
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);

  if (apply) {
    mapData.assetReadinessCatalogs = (mapData.assetReadinessCatalogs || []).filter(item => item.id !== catalogId);
    mapData.assetReadinessCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'asset_readiness_index_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      catalogId,
      summary: catalog.summary,
      sample: reportSample(catalog),
      assetPolicy: catalog.assetPolicy,
      nextLeads: catalog.nextLeads,
    });
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    sample: reportSample(catalog),
  }, null, 2));
}

main();
