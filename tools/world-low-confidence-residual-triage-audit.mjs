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
const toolName = 'tools/world-low-confidence-residual-triage-audit.mjs';
const catalogId = 'world-low-confidence-residual-triage-catalog-2026-06-26';
const reportId = 'low-confidence-residual-triage-audit-2026-06-26';
const schemaVersion = 1;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
}

function auditSummary(audit) {
  if (!audit) return null;
  return {
    kind: audit.kind || null,
    status: audit.status || null,
    confidence: audit.confidence || null,
    consumerStatus: audit.consumerStatus || null,
    promotionAllowed: audit.promotionAllowed ?? null,
    finalDisposition: audit.detail?.finalDisposition || audit.finalDisposition || null,
    catalogId: audit.catalogId || null,
  };
}

function classifyResidual(region) {
  const analysis = region.analysis || {};

  if (analysis.roomOverlayTailRefinementAudit && analysis.roomOverlayIndexBoundAudit) {
    return {
      classId: 'room_overlay_tail',
      status: 'quarantined_nonpadding_tail_not_selected_by_cataloged_room_overlay_indices',
      handling: 'exclude_from_room_overlay_record_decoder_until_a_CF64_runtime_trace_selects_index_227',
      semanticConfidence: 'low',
      rangeConfidence: 'high',
      requiredNextTrace: 'Trace every runtime write into _RAM_CF64_ and confirm whether any path can select overlay index 227.',
      proofPlan: {
        traceKind: 'runtime_ram_index_bound_trace',
        watchLabels: ['_RAM_CF64_'],
        candidateConsumer: '_LABEL_26F4_ room overlay selector path',
        requiredProof: 'A runtime trace must show a bank-4 room overlay consumer selecting index 227 or another explicit non-index consumer for 0x10718.',
        promotionIfConfirmed: 'Promote to the specific room-overlay tail role proven by the consumer; keep only offsets, ids, and role metadata.',
        keepQuarantinedIfMissing: 'Keep excluded from room_overlay_record decoding and treat as unresolved nonpadding trailer.',
        blockers: [
          'Cataloged _RAM_CF64_ sources do not select overlay index 227.',
          'Apparent 0x8718 references resolve as bank-6 alias false positives.',
        ],
      },
      evidence: [
        'roomOverlayTailRefinementAudit marks apparent 0x8718 references as bank-alias false positives.',
        'roomOverlayIndexBoundAudit reports cataloged _RAM_CF64_ sources do not select the tail index.',
        'asmIncbinSpanAudit keeps the range as a split tail after the parsed room overlay records.',
      ],
    };
  }

  if (analysis.paletteTailLayoutRefinementAudit && region.id === 'r2815') {
    return {
      classId: 'post_palette_tail_short_fragment',
      status: 'quarantined_post_palette_script_payload_no_confirmed_consumer',
      handling: 'exclude_from_palette_script_decoder_until_a_same_bank_consumer_is_traced',
      semanticConfidence: 'low',
      rangeConfidence: 'medium',
      requiredNextTrace: 'Trace same-bank references after _DATA_1CABB_ and prove whether this seven-byte fragment is data, sentinel, or padding.',
      proofPlan: {
        traceKind: 'same_bank_consumer_trace',
        watchLabels: ['_DATA_1CBB9_'],
        candidateConsumer: 'bank-7 menu/status payload reader after _DATA_1CABB_',
        requiredProof: 'A same-bank routine must form or load 0x1CBB9 and consume the seven-byte fragment outside the palette-script parser.',
        promotionIfConfirmed: 'Promote to the consumer-specific payload role; do not infer palette/script membership from adjacency alone.',
        keepQuarantinedIfMissing: 'Keep as unresolved post-palette short fragment.',
        blockers: [
          'Palette script parser does not consume this fragment.',
          'No confirmed same-bank consumer is recorded.',
        ],
      },
      evidence: [
        'paletteTailConsumerAudit says the fragment is not consumed by the _DATA_1CABB_ palette script parser.',
        'paletteTailLayoutRefinementAudit reports no confirmed same-bank consumer.',
      ],
    };
  }

  if (analysis.paletteTailLayoutRefinementAudit && region.id === 'r2816') {
    return {
      classId: 'post_palette_tail_fill_block',
      status: 'quarantined_post_palette_script_fill_no_confirmed_consumer',
      handling: 'treat_as_explicit_fill_payload_not_palette_script_until_a_consumer_is_traced',
      semanticConfidence: 'low',
      rangeConfidence: 'medium',
      requiredNextTrace: 'Trace whether the post-_DATA_1CABB_ fill block is addressed by a menu/status data consumer or is dead filler.',
      proofPlan: {
        traceKind: 'same_bank_fill_consumer_trace',
        watchLabels: ['_DATA_1CBC0_'],
        candidateConsumer: 'bank-7 menu/status fill or literal payload reader after _DATA_1CABB_',
        requiredProof: 'A same-bank routine must address 0x1CBC0 directly or through a bounded table and consume the fill block as data.',
        promotionIfConfirmed: 'Promote to the concrete fill/payload role proven by that routine.',
        keepQuarantinedIfMissing: 'Keep as explicit unresolved fill payload, not palette script data.',
        blockers: [
          'Palette script parser does not consume this fill block.',
          'No confirmed same-bank consumer is recorded.',
        ],
      },
      evidence: [
        'paletteTailSplitAudit identifies this as an explicit fill block after the palette script tail.',
        'paletteTailConsumerAudit says the block is not consumed by the palette script parser.',
        'paletteTailLayoutRefinementAudit reports no confirmed same-bank consumer.',
      ],
    };
  }

  if (analysis.paletteTailLayoutRefinementAudit && region.id === 'r2817') {
    return {
      classId: 'post_palette_tail_tile_index_candidate',
      status: 'quarantined_tile_index_candidate_cross_bank_word_shapes_only',
      handling: 'exclude_from_confirmed_tile_map_rendering_until_a_same_bank_consumer_or_screen_program_reference_is_traced',
      semanticConfidence: 'low',
      rangeConfidence: 'medium',
      requiredNextTrace: 'Trace _DATA_1CBD0_ references from bank-7 menu/status code and reject or confirm the 15x16 tile-index interpretation.',
      proofPlan: {
        traceKind: 'same_bank_tile_index_consumer_trace',
        watchLabels: ['_DATA_1CBD0_'],
        candidateConsumer: 'bank-7 menu/status tile-index reader',
        requiredProof: 'A same-bank routine or screen-program path must consume 0x1CBD0 as a bounded 15x16 tile-index payload.',
        promotionIfConfirmed: 'Promote to tile_map only with dimensions, offsets, and consumer evidence; do not persist tile/index payload bytes.',
        keepQuarantinedIfMissing: 'Keep excluded from confirmed tile-map rendering.',
        blockers: [
          'Current evidence is cross-bank word shapes only.',
          'No same-bank consumer or screen-program reference is recorded.',
        ],
      },
      evidence: [
        'paletteTailLayoutRefinementAudit reports cross-bank word shapes only.',
        'graphicsStructuredLeadFinalTriageAudit says source-word-shaped hits do not confirm graphics coverage.',
        'No confirmed same-bank consumer is recorded for the tile-map candidate.',
      ],
    };
  }

  if (analysis.bank7PreSequenceSidecarAudit) {
    return {
      classId: 'bank7_entity_sequence_sidecar',
      status: 'quarantined_pre_sequence_sidecar_rejected_loader_alias',
      handling: 'exclude_from_vram_loader_execution_until_a_direct_bank7_consumer_is_traced',
      semanticConfidence: 'low',
      rangeConfidence: 'medium',
      requiredNextTrace: 'Trace direct bank-7 consumers around _DATA_1E337_ and keep the 8FB-shaped parse rejected unless the bank alias is resolved.',
      proofPlan: {
        traceKind: 'direct_bank7_consumer_trace',
        watchLabels: ['_DATA_1E337_'],
        candidateConsumer: 'direct bank-7 sidecar reader before confirmed entity sequence streams',
        requiredProof: 'A bank-7 routine must consume 0x1E337 directly in the active bank; bank-alias 8FB-like shapes are not enough.',
        promotionIfConfirmed: 'Promote to the proven sidecar or loader role only after the direct bank-7 consumer is identified.',
        keepQuarantinedIfMissing: 'Keep excluded from vram_loader_8fb execution and retain the false-loader guard.',
        blockers: [
          'The current 8FB-like parse is rejected as a bank-alias false consumer.',
          'Structured source-word hits do not prove graphics coverage.',
        ],
      },
      evidence: [
        'bank7PreSequenceSidecarAudit rejects the 8FB-like parse as a bank-alias false consumer.',
        'graphicsLoaderCandidateConsumerAudit records promotionAllowed=false.',
        'graphicsStructuredLeadFinalTriageAudit says source-word-shaped hits do not confirm graphics coverage.',
      ],
    };
  }

  return {
    classId: 'unclassified_low_confidence_residual',
    status: 'needs_manual_trace',
    handling: 'do_not_promote_without_consumer_evidence',
    semanticConfidence: 'low',
    rangeConfidence: 'unknown',
    requiredNextTrace: 'Manually inspect ASM labels, pointer references, and runtime consumers.',
    proofPlan: {
      traceKind: 'manual_consumer_trace',
      watchLabels: [],
      candidateConsumer: 'unknown',
      requiredProof: 'A concrete ASM reference or runtime consumer must be identified before promotion.',
      promotionIfConfirmed: 'Promote only to the role proven by direct evidence.',
      keepQuarantinedIfMissing: 'Keep excluded from default decoders.',
      blockers: [
        'No known residual classifier matched this low-confidence region.',
      ],
    },
    evidence: [
      'No known residual classifier matched this low-confidence region.',
    ],
  };
}

function compactRegion(region, classification) {
  const analysis = region.analysis || {};
  return {
    id: region.id,
    offset: region.offset,
    size: region.size,
    type: region.type,
    name: region.name || '',
    currentTopLevelConfidence: region.confidence || null,
    classId: classification.classId,
    status: classification.status,
    handling: classification.handling,
    semanticConfidence: classification.semanticConfidence,
    rangeConfidence: classification.rangeConfidence,
    requiredNextTrace: classification.requiredNextTrace,
    proofPlan: classification.proofPlan,
    evidence: classification.evidence,
    supportingAudits: Object.fromEntries(Object.entries({
      roomOverlayTailRefinementAudit: analysis.roomOverlayTailRefinementAudit,
      roomOverlayIndexBoundAudit: analysis.roomOverlayIndexBoundAudit,
      paletteTailConsumerAudit: analysis.paletteTailConsumerAudit,
      paletteTailLayoutRefinementAudit: analysis.paletteTailLayoutRefinementAudit,
      bank7PreSequenceSidecarAudit: analysis.bank7PreSequenceSidecarAudit,
      graphicsLoaderCandidateConsumerAudit: analysis.graphicsLoaderCandidateConsumerAudit,
      graphicsStructuredLeadFinalTriageAudit: analysis.graphicsStructuredLeadFinalTriageAudit,
      asmIncbinSpanAudit: analysis.asmIncbinSpanAudit,
      asmLabelRegionAudit: analysis.asmLabelRegionAudit,
    })
      .map(([key, value]) => [key, auditSummary(value)])
      .filter(([, value]) => value)),
  };
}

function buildCatalog(mapData) {
  const regions = mapData.regions || [];
  const lowConfidenceRegions = regions.filter(region => region.confidence === 'low');
  const entries = lowConfidenceRegions.map(region => compactRegion(region, classifyResidual(region)));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    assetPolicy: 'Metadata only: region ids, offsets, sizes, types, labels, audit ids, dispositions, and next trace notes. No ROM bytes, instruction bytes, decoded graphics, pixels, screenshots, text payloads, audio payloads, or hashes are embedded.',
    selectionRule: {
      source: 'All project regions with top-level confidence "low".',
      promotionPolicy: 'This audit does not promote top-level confidence. It quarantines residual ranges and records why they are excluded from normal decoders until a direct consumer trace exists.',
    },
    summary: {
      selectedRegionCount: entries.length,
      selectedByteCount: entries.reduce((sum, entry) => sum + (entry.size || 0), 0),
      classCounts: countBy(entries, entry => entry.classId),
      typeCounts: countBy(entries, entry => entry.type),
      proofTraceKindCounts: countBy(entries, entry => entry.proofPlan?.traceKind || 'missing_proof_plan'),
      consumerTraceRequiredCount: entries.filter(entry => entry.proofPlan?.requiredProof).length,
      defaultDecoderExcludedCount: entries.filter(entry => /exclude|quarantined|not_palette|not.*decoder/i.test(`${entry.handling} ${entry.proofPlan?.keepQuarantinedIfMissing || ''}`)).length,
      promotionBlockedCount: entries.filter(entry => (entry.proofPlan?.blockers || []).length > 0).length,
      allLowConfidenceRegionsAccountedFor: entries.every(entry => entry.classId !== 'unclassified_low_confidence_residual'),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    entries,
  };
}

function reportSample(catalog) {
  return catalog.entries.map(entry => ({
    id: entry.id,
    offset: entry.offset,
    size: entry.size,
    type: entry.type,
    classId: entry.classId,
    status: entry.status,
    handling: entry.handling,
    proofTraceKind: entry.proofPlan?.traceKind || null,
    promotionBlocked: (entry.proofPlan?.blockers || []).length > 0,
  }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);

  if (apply) {
    for (const entry of catalog.entries) {
      const region = (mapData.regions || []).find(item => item.id === entry.id);
      if (!region) continue;
      region.analysis = region.analysis || {};
      region.analysis.lowConfidenceResidualTriageAudit = {
        catalogId,
        kind: entry.classId,
        status: entry.status,
        confidence: 'medium_for_quarantine_low_for_semantic_role',
        currentTopLevelConfidence: entry.currentTopLevelConfidence,
        semanticConfidence: entry.semanticConfidence,
        rangeConfidence: entry.rangeConfidence,
        handling: entry.handling,
        requiredNextTrace: entry.requiredNextTrace,
        proofPlan: entry.proofPlan,
        supportingAuditKeys: Object.keys(entry.supportingAudits),
        summary: `${entry.id} remains low-confidence semantic data and is quarantined from normal decoders until direct consumer evidence is traced.`,
        evidence: entry.evidence,
        generatedAt: now,
        tool: toolName,
      };
    }

    mapData.lowConfidenceResidualCatalogs = (mapData.lowConfidenceResidualCatalogs || []).filter(item => item.id !== catalogId);
    mapData.lowConfidenceResidualCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'low_confidence_residual_triage_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      catalogId,
      summary: catalog.summary,
      residualSummary: reportSample(catalog),
      assetPolicy: catalog.assetPolicy,
      nextLeads: [
        'Trace _RAM_CF64_ writes before decoding r2813 as an overlay record.',
        'Trace same-bank consumers after _DATA_1CABB_ before rendering r2815-r2817 as menu/status payloads.',
        'Trace direct bank-7 consumers before executing r0749 as an 8FB loader stream.',
      ],
    });
    writeJson(mapPath, mapData);

    if (fs.existsSync(staticMapPath)) {
      const staticMap = readJson(staticMapPath);
      staticMap.analyzedAt = now;
      staticMap.summary = staticMap.summary || {};
      staticMap.summary.lowConfidenceResidualTriageCatalog = catalogId;
      staticMap.summary.lowConfidenceResidualTriageRegions = catalog.summary.selectedRegionCount;
      staticMap.summary.lowConfidenceResidualTriageBytes = catalog.summary.selectedByteCount;
      staticMap.summary.lowConfidenceResidualTriageConsumerTraceRequired = catalog.summary.consumerTraceRequiredCount;
      staticMap.summary.lowConfidenceResidualTriageDefaultDecoderExcluded = catalog.summary.defaultDecoderExcludedCount;
      staticMap.summary.lowConfidenceResidualTriagePromotionBlocked = catalog.summary.promotionBlockedCount;
      staticMap.summary.lowConfidenceResidualsAllAccountedFor = catalog.summary.allLowConfidenceRegionsAccountedFor;
      staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
      staticMap.primaryCatalogs.coverage = insertAfter(
        staticMap.primaryCatalogs.coverage,
        'world-asset-readiness-index-catalog-2026-06-26',
        catalogId
      );
      staticMap.primaryCatalogs.rendering = insertAfter(
        staticMap.primaryCatalogs.rendering,
        'world-residual-fragment-confidence-backfill-catalog-2026-06-26',
        catalogId
      );
      staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
      staticMap.nextLeads.push('Use world-low-confidence-residual-triage-catalog-2026-06-26 proofPlan entries as the required consumer-trace checklist before promoting any of the final five quarantined residual regions.');
      writeJson(staticMapPath, staticMap);
    }
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    residualSummary: reportSample(catalog),
  }, null, 2));
}

main();
