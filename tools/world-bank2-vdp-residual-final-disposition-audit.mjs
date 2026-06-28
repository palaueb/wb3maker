#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const residualGapCatalogId = 'world-bank2-vdp-residual-gap-catalog-2026-06-26';
const sourceTriageCatalogId = 'world-bank2-vdp-residual-source-triage-catalog-2026-06-26';
const drawFieldCatalogId = 'world-bank2-vdp-residual-draw-field-catalog-2026-06-26';
const boundaryCollisionCatalogId = 'world-bank2-vdp-residual-draw-boundary-collision-catalog-2026-06-26';
const catalogId = 'world-bank2-vdp-residual-final-disposition-catalog-2026-06-26';
const reportId = 'bank2-vdp-residual-final-disposition-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-residual-final-disposition-audit.mjs';
const schemaVersion = 1;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function sumBy(items, valueFn) {
  return items.reduce((total, item) => total + valueFn(item), 0);
}

function compactTarget(target) {
  return {
    id: target.id,
    targetOffset: target.targetOffset,
    boundaryKind: target.boundaryKind,
    disposition: target.triageDisposition || target.disposition,
    confidence: target.confidence,
    rawOccurrenceCount: target.rawOccurrenceCount || target.intraVdpOccurrenceCount || 0,
  };
}

function buildTargetsByParent(sourceTriageCatalog) {
  const byParent = new Map();
  for (const target of sourceTriageCatalog.targets || []) {
    if (!target.parentGapId) continue;
    if (!byParent.has(target.parentGapId)) byParent.set(target.parentGapId, []);
    byParent.get(target.parentGapId).push(target);
  }
  return byParent;
}

function buildDrawTargetsByParent(drawFieldCatalog) {
  const byParent = new Map();
  for (const target of drawFieldCatalog.targets || []) {
    if (!target.parentGapId) continue;
    if (!byParent.has(target.parentGapId)) byParent.set(target.parentGapId, []);
    byParent.get(target.parentGapId).push(target);
  }
  return byParent;
}

function buildCollisionBySourceGap(boundaryCollisionCatalog) {
  const byGap = new Map();
  for (const candidate of boundaryCollisionCatalog.candidates || []) {
    const id = candidate.sourceGap?.id;
    if (!id) continue;
    byGap.set(id, candidate);
  }
  return byGap;
}

function allTargetsHaveDisposition(targets, disposition) {
  return targets.length > 0 && targets.every(target => target.triageDisposition === disposition || target.disposition === disposition);
}

function classifyGap(gap, sourceTargets, drawTargets, collision) {
  if (gap.disposition === 'confirmed_padding_gap') {
    return {
      finalDisposition: 'confirmed_padding_gap',
      confidence: 'high',
      promotable: false,
      unresolvedTraceLead: false,
      reason: 'Gap is confirmed padding in the residual-gap catalog.',
    };
  }
  if (gap.disposition === 'state_record_shape_not_reachable_by_modeled_root_index_path') {
    return {
      finalDisposition: 'rejected_unreachable_state_record_shape',
      confidence: gap.confidence,
      promotable: false,
      unresolvedTraceLead: false,
      reason: 'The state-record-shaped bytes are not reachable through the bounded _RAM_D15A_/_RAM_D15D_ root/index path.',
    };
  }
  if (gap.disposition === 'vdp_draw_pointer_list_shape_only_referenced_by_rejected_state_candidates') {
    return {
      finalDisposition: 'rejected_pointer_list_shape_from_unreachable_state_path',
      confidence: 'medium',
      promotable: false,
      unresolvedTraceLead: false,
      reason: 'The pointer-list-shaped gap is only referenced by state candidates that are themselves rejected by the modeled root/index path.',
    };
  }
  if (collision?.disposition === 'candidate_overruns_source_gap_into_decoded_runs_and_gap_candidates') {
    return {
      finalDisposition: 'rejected_overlapping_draw_segment_candidate_not_promotable',
      confidence: 'medium',
      promotable: false,
      unresolvedTraceLead: false,
      reason: 'A decoded draw-segment interpretation overruns this source gap and collides with confirmed decoded runs or other residual candidates.',
    };
  }
  if (allTargetsHaveDisposition(drawTargets, 'intra_vdp_raw_hits_explained_as_candidate_draw_fields')) {
    return {
      finalDisposition: 'weak_draw_boundary_lead_no_confirmed_producer',
      confidence: 'low',
      promotable: false,
      unresolvedTraceLead: true,
      reason: 'Remaining raw hits are explained as candidate draw-stream fields; no confirmed pointer-list producer reaches the boundary.',
    };
  }
  if (allTargetsHaveDisposition(sourceTargets, 'all_raw_hits_disqualified_as_pointer_evidence')) {
    const finalDisposition = gap.disposition === 'unreferenced_object_list_shape_needs_pointer_search'
      ? 'object_list_shape_no_confirmed_consumer_pointer'
      : 'draw_shape_no_confirmed_pointer_producer_after_source_triage';
    return {
      finalDisposition,
      confidence: 'medium',
      promotable: false,
      unresolvedTraceLead: false,
      reason: 'Source triage disqualifies every raw pointer-shaped hit as rejected, self, payload-like, code-overlap, or known structured-data context.',
    };
  }
  if (allTargetsHaveDisposition(sourceTargets, 'weak_structured_or_payload_leads_only')) {
    return {
      finalDisposition: 'weak_structured_leads_only_no_confirmed_producer',
      confidence: 'low',
      promotable: false,
      unresolvedTraceLead: true,
      reason: 'Only weak structured or payload leads remain, with no confirmed pointer producer.',
    };
  }
  return {
    finalDisposition: 'unresolved_residual_gap_requires_trace',
    confidence: 'low',
    promotable: false,
    unresolvedTraceLead: true,
    reason: 'No final disposition could be derived from the current residual source catalogs.',
  };
}

function buildCatalog(mapData) {
  const residualGapCatalog = requireCatalog(mapData, residualGapCatalogId);
  const sourceTriageCatalog = requireCatalog(mapData, sourceTriageCatalogId);
  const drawFieldCatalog = requireCatalog(mapData, drawFieldCatalogId);
  const boundaryCollisionCatalog = requireCatalog(mapData, boundaryCollisionCatalogId);
  const sourceTargetsByParent = buildTargetsByParent(sourceTriageCatalog);
  const drawTargetsByParent = buildDrawTargetsByParent(drawFieldCatalog);
  const collisionBySourceGap = buildCollisionBySourceGap(boundaryCollisionCatalog);

  const gaps = (residualGapCatalog.gaps || []).map(gap => {
    const sourceTargets = sourceTargetsByParent.get(gap.id) || [];
    const drawTargets = drawTargetsByParent.get(gap.id) || [];
    const collision = collisionBySourceGap.get(gap.id) || null;
    const classification = classifyGap(gap, sourceTargets, drawTargets, collision);
    return {
      id: gap.id,
      range: gap.range,
      layoutClass: gap.layoutClass,
      residualDisposition: gap.disposition,
      finalDisposition: classification.finalDisposition,
      confidence: classification.confidence,
      promotable: classification.promotable,
      unresolvedTraceLead: classification.unresolvedTraceLead,
      reason: classification.reason,
      sourceTriageTargetCount: sourceTargets.length,
      sourceTriageDispositionCounts: countBy(sourceTargets, target => target.triageDisposition),
      drawFieldTargetCount: drawTargets.length,
      drawFieldDispositionCounts: countBy(drawTargets, target => target.disposition),
      collisionDisposition: collision?.disposition || null,
      collisionConfidence: collision?.confidence || null,
      evidenceTargets: sourceTargets.slice(0, 4).map(compactTarget),
      drawEvidenceTargets: drawTargets.slice(0, 4).map(compactTarget),
    };
  });

  const unpromoted = gaps.filter(gap => !gap.promotable);
  const unresolvedTraceLeads = gaps.filter(gap => gap.unresolvedTraceLead);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [residualGapCatalogId, sourceTriageCatalogId, drawFieldCatalogId, boundaryCollisionCatalogId],
    bundle: residualGapCatalog.bundle,
    summary: {
      finalGapCount: gaps.length,
      finalGapBytes: sumBy(gaps, gap => gap.range?.size || 0),
      finalDispositionCounts: countBy(gaps, gap => gap.finalDisposition),
      finalDispositionBytes: Object.fromEntries(Object.keys(countBy(gaps, gap => gap.finalDisposition)).map(disposition => [
        disposition,
        sumBy(gaps.filter(gap => gap.finalDisposition === disposition), gap => gap.range?.size || 0),
      ])),
      promotableGapCount: gaps.filter(gap => gap.promotable).length,
      unpromotedGapCount: unpromoted.length,
      unresolvedTraceLeadCount: unresolvedTraceLeads.length,
      unresolvedTraceLeadBytes: sumBy(unresolvedTraceLeads, gap => gap.range?.size || 0),
      confirmedPaddingGapCount: gaps.filter(gap => gap.finalDisposition === 'confirmed_padding_gap').length,
      rejectedShapeGapCount: gaps.filter(gap => gap.finalDisposition.startsWith('rejected_')).length,
      noConfirmedProducerGapCount: gaps.filter(gap => gap.finalDisposition.includes('no_confirmed')).length,
      assetPolicy: 'Metadata only: gap ids, offsets, sizes, disposition names, counts, and catalog cross-references. No ROM bytes, decoded graphics, screenshots, hashes, or asset payloads are embedded.',
    },
    gaps,
    unresolvedTraceLeads: unresolvedTraceLeads.map(gap => ({
      id: gap.id,
      range: gap.range,
      layoutClass: gap.layoutClass,
      finalDisposition: gap.finalDisposition,
      confidence: gap.confidence,
      reason: gap.reason,
    })),
    evidence: [
      `${residualGapCatalogId} supplies the base residual gap classes and dispositions for r0186.`,
      `${sourceTriageCatalogId} disqualifies raw pointer-shaped hits unless they are supported by a known parser field or producer context.`,
      `${drawFieldCatalogId} explains remaining weak intra-VDP raw hits as candidate draw-stream fields rather than pointer producers.`,
      `${boundaryCollisionCatalogId} rejects overlapping draw-segment candidates that run beyond their source gaps into decoded runs and other candidates.`,
    ],
    nextLeads: [
      'Add a runtime trace hook for _LABEL_97D9_/_LABEL_9812_ to confirm whether weak draw-boundary leads are ever selected by a real pointer list.',
      'Keep unreachable state-record and rejected pointer-list shapes out of child asset regions unless a new producer path is found.',
      'Use this catalog to drive analyzer filters for bank-2 VDP residual gaps: confirmed padding, rejected shapes, no-producer candidates, and trace leads.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegionById(mapData, 'r0186');
  if (!region) {
    return { changedRegions: [], missingRegions: [{ id: 'r0186', role: 'bank2_vdp_residual_final_disposition' }] };
  }
  if (apply) {
    region.analysis = region.analysis || {};
    region.analysis.bank2VdpResidualFinalDispositionAudit = {
      catalogId,
      kind: 'bank2_vdp_residual_final_disposition',
      confidence: catalog.summary.unresolvedTraceLeadCount ? 'medium' : 'high',
      summary: 'Consolidates bank-2 VDP residual gap evidence into final non-promoted/promoted dispositions without creating unproven child asset regions.',
      detail: {
        finalGapCount: catalog.summary.finalGapCount,
        finalGapBytes: catalog.summary.finalGapBytes,
        finalDispositionCounts: catalog.summary.finalDispositionCounts,
        promotableGapCount: catalog.summary.promotableGapCount,
        unpromotedGapCount: catalog.summary.unpromotedGapCount,
        unresolvedTraceLeadCount: catalog.summary.unresolvedTraceLeadCount,
        unresolvedTraceLeadBytes: catalog.summary.unresolvedTraceLeadBytes,
        confirmedPaddingGapCount: catalog.summary.confirmedPaddingGapCount,
        rejectedShapeGapCount: catalog.summary.rejectedShapeGapCount,
        noConfirmedProducerGapCount: catalog.summary.noConfirmedProducerGapCount,
      },
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
  }
  return {
    changedRegions: [{ id: region.id, offset: region.offset, type: region.type, name: region.name, inferredAnalysis: 'bank2VdpResidualFinalDispositionAudit' }],
    missingRegions: [],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.vdpStreamResidualFinalDispositionCatalogs = (mapData.vdpStreamResidualFinalDispositionCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpStreamResidualFinalDispositionCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_residual_final_disposition_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      changedRegions: annotation.changedRegions,
      missingRegions: annotation.missingRegions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    unresolvedTraceLeads: catalog.unresolvedTraceLeads,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
