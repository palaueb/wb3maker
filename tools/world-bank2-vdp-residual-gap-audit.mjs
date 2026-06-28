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
const layoutCatalogId = 'world-bank2-vdp-stream-layout-catalog-2026-06-25';
const reachabilityCatalogId = 'world-bank2-vdp-state-candidate-reachability-catalog-2026-06-26';
const coverageCatalogId = 'world-bank2-vdp-state-index-coverage-catalog-2026-06-26';
const catalogId = 'world-bank2-vdp-residual-gap-catalog-2026-06-26';
const reportId = 'bank2-vdp-residual-gap-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-residual-gap-audit.mjs';
const schemaVersion = 1;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  return typeof value === 'string' ? parseInt(value, 16) : NaN;
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function sumBy(items, valueFn) {
  return items.reduce((sum, item) => sum + valueFn(item), 0);
}

function findCatalog(collection, id, collectionName) {
  const catalog = (collection || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing ${collectionName} catalog ${id}`);
  return catalog;
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

function gapRange(gap) {
  return {
    startOffset: gap.startOffset,
    endOffsetExclusive: gap.endOffsetExclusive,
    size: gap.size,
  };
}

function buildRejectedStatePointerRefs(reachabilityCatalog) {
  const refs = [];
  for (const candidate of reachabilityCatalog.candidates || []) {
    const rejectedByModeledPath = candidate.status === 'not_reachable_by_modeled_bank2_vdp_root_index_path';
    for (const pointer of candidate.pointerRoles || []) {
      const gapRef = pointer.targetContext?.gapRef;
      if (!gapRef) continue;
      refs.push({
        sourceCandidateId: candidate.id,
        sourceStartOffset: candidate.range?.startOffset,
        sourceStatus: candidate.status,
        rejectedByModeledPath,
        role: pointer.role,
        targetOffset: pointer.targetOffset,
        targetGapStartOffset: gapRef.startOffset,
        targetGapClass: gapRef.class,
        targetSubrange: pointer.targetContext?.targetSubrange || null,
        targetAtGapStart: Boolean(pointer.targetContext?.targetAtGapStart),
      });
    }
  }
  return refs;
}

function classifyGap(gap, stateCandidate, inboundRejectedRefs, coverageCatalog) {
  if (gap.class === 'all_zero_padding_gap') {
    return {
      disposition: 'confirmed_padding_gap',
      confidence: 'high',
      reason: 'Gap is all zero padding under the bank-2 VDP stream layout audit.',
    };
  }
  if (stateCandidate?.status === 'not_reachable_by_modeled_bank2_vdp_root_index_path') {
    return {
      disposition: 'state_record_shape_not_reachable_by_modeled_root_index_path',
      confidence: stateCandidate.confidence,
      reason: 'Shape decodes as a state record candidate, but bounded _RAM_D15A_/_RAM_D15D_ coverage does not reach it and no table/control/raw pointer producer is known.',
    };
  }
  if (gap.class === 'unreferenced_exact_vdp_draw_pointer_list_sequence_candidate' && inboundRejectedRefs.length) {
    return {
      disposition: 'vdp_draw_pointer_list_shape_only_referenced_by_rejected_state_candidates',
      confidence: 'medium',
      reason: 'Pointer-list-shaped gap is only referenced by state-record-shaped candidates that are not reachable through the modeled bank-2 VDP state-table path.',
    };
  }
  if (gap.class === 'unreferenced_exact_vdp_draw_pointer_list_sequence_candidate') {
    return {
      disposition: 'unreferenced_vdp_draw_pointer_list_shape_needs_external_pointer_search',
      confidence: 'medium',
      reason: 'Gap decodes as a VDP draw pointer-list sequence, but no confirmed pointer-list consumer reaches it in the current catalogs.',
    };
  }
  if (gap.class === 'unreferenced_exact_vdp_draw_segment_candidate') {
    return {
      disposition: 'unreferenced_exact_vdp_draw_segment_shape_needs_pointer_search',
      confidence: 'medium',
      reason: 'Gap decodes exactly as a VDP draw segment, but no confirmed draw pointer-list references it.',
    };
  }
  if (gap.class === 'unreferenced_vdp_draw_segment_prefix_candidate') {
    const tailClass = gap.candidateTailClassification?.class || 'no_tail_candidate';
    return {
      disposition: 'unreferenced_vdp_draw_segment_prefix_shape_needs_boundary_resolution',
      confidence: 'low',
      reason: `Gap begins as a VDP draw segment candidate but boundary confidence is low; tail classification is ${tailClass}.`,
    };
  }
  if (gap.class === 'unreferenced_exact_object_list_sequence_candidate') {
    return {
      disposition: 'unreferenced_object_list_shape_needs_pointer_search',
      confidence: 'medium',
      reason: 'Gap decodes as an object-list sequence, but no confirmed object-list consumer reaches it in the current catalogs.',
    };
  }
  return {
    disposition: 'unclassified_residual_gap',
    confidence: 'low',
    reason: 'No stronger residual-gap classification is available from the current catalogs.',
  };
}

function buildCatalog(mapData) {
  const layoutCatalog = findCatalog(mapData.vdpStreamLayoutCatalogs, layoutCatalogId, 'vdpStreamLayoutCatalogs');
  const reachabilityCatalog = findCatalog(mapData.vdpStreamReachabilityCatalogs, reachabilityCatalogId, 'vdpStreamReachabilityCatalogs');
  const coverageCatalog = findCatalog(mapData.vdpStreamRuntimeCatalogs, coverageCatalogId, 'vdpStreamRuntimeCatalogs');
  const stateCandidateByStart = new Map((reachabilityCatalog.candidates || []).map(candidate => [candidate.range?.startOffset, candidate]));
  const rejectedRefs = buildRejectedStatePointerRefs(reachabilityCatalog);
  const rejectedRefsByTargetGapStart = new Map();
  for (const ref of rejectedRefs) {
    if (!rejectedRefsByTargetGapStart.has(ref.targetGapStartOffset)) rejectedRefsByTargetGapStart.set(ref.targetGapStartOffset, []);
    rejectedRefsByTargetGapStart.get(ref.targetGapStartOffset).push(ref);
  }

  const gaps = (layoutCatalog.gaps || []).map(gap => {
    const stateCandidate = stateCandidateByStart.get(gap.startOffset) || null;
    const inboundRejectedStateCandidateRefs = rejectedRefsByTargetGapStart.get(gap.startOffset) || [];
    const classification = classifyGap(gap, stateCandidate, inboundRejectedStateCandidateRefs, coverageCatalog);
    return {
      id: `bank2_residual_gap_${gap.startOffset}`,
      range: gapRange(gap),
      layoutClass: gap.class,
      layoutConfidence: gap.confidence,
      disposition: classification.disposition,
      confidence: classification.confidence,
      reason: classification.reason,
      consumedBytes: gap.consumedBytes || null,
      candidateTailBytes: gap.candidateTailBytes || 0,
      tailClassification: gap.candidateTailClassification || null,
      inboundRejectedStateCandidateRefCount: inboundRejectedStateCandidateRefs.length,
      inboundRejectedStateCandidateRefs: inboundRejectedStateCandidateRefs.slice(0, 16),
      stateCandidateStatus: stateCandidate?.status || null,
    };
  });
  const actionableGaps = gaps.filter(gap => ![
    'confirmed_padding_gap',
    'state_record_shape_not_reachable_by_modeled_root_index_path',
    'vdp_draw_pointer_list_shape_only_referenced_by_rejected_state_candidates',
  ].includes(gap.disposition));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [layoutCatalogId, reachabilityCatalogId, coverageCatalogId],
    bundle: {
      region: regionRef(findRegionById(mapData, 'r0186')),
      range: layoutCatalog.bundle?.range || ['0x09AE0', '0x0B3BF'],
    },
    summary: {
      residualGapCount: gaps.length,
      residualGapBytes: sumBy(gaps, gap => gap.range.size || 0),
      dispositionCounts: countBy(gaps, gap => gap.disposition),
      dispositionBytes: Object.fromEntries(Object.entries(countBy(gaps, gap => gap.disposition)).map(([disposition]) => [
        disposition,
        sumBy(gaps.filter(gap => gap.disposition === disposition), gap => gap.range.size || 0),
      ])),
      stateRecordShapesNotReachableByModeledRootIndexPath: gaps.filter(gap => gap.disposition === 'state_record_shape_not_reachable_by_modeled_root_index_path').length,
      pointerListShapesOnlyReferencedByRejectedStateCandidates: gaps.filter(gap => gap.disposition === 'vdp_draw_pointer_list_shape_only_referenced_by_rejected_state_candidates').length,
      actionableResidualGapCount: actionableGaps.length,
      actionableResidualGapBytes: sumBy(actionableGaps, gap => gap.range.size || 0),
      actionableDispositionCounts: countBy(actionableGaps, gap => gap.disposition),
      inboundRejectedStateCandidatePointerRefCount: rejectedRefs.length,
      modeledRootIndexPathFullyBound: Boolean(coverageCatalog.summary.canFullyBoundRuntimeRootAndIndex),
      assetPolicy: 'Metadata only: gap offsets, classes, dispositions, pointer-reference counts, and catalog cross-references. No ROM bytes, decoded graphics, screenshots, hashes, or asset payloads are embedded.',
    },
    gaps,
    nextActionableGaps: actionableGaps.slice(0, 24).map(gap => ({
      id: gap.id,
      range: gap.range,
      layoutClass: gap.layoutClass,
      disposition: gap.disposition,
      confidence: gap.confidence,
      reason: gap.reason,
    })),
    evidence: [
      `${layoutCatalogId} supplies decoded intervals and residual gap classes for the bank-2 VDP stream bundle.`,
      `${reachabilityCatalogId} classifies state-record-shaped candidates against the bounded modeled root/index path.`,
      `${coverageCatalogId} proves _RAM_D15A_ root selection and _RAM_D15D_ state-index producers are fully bounded for the audited bank-2 executable window.`,
    ],
    nextLeads: [
      'Run a pointer-word context search for actionable VDP draw segment and object-list residual gaps outside rejected state-candidate records.',
      'Resolve boundaries for low-confidence VDP draw segment prefix candidates before promoting child regions.',
      'Keep pointer-list-shaped gaps that are only referenced by rejected state candidates out of confirmed asset regions unless another producer is found.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegionById(mapData, 'r0186');
  if (!region) {
    return { changedRegions: [], missingRegions: [{ id: 'r0186', role: 'bank2_vdp_residual_gap_context' }] };
  }
  if (apply) {
    region.analysis = region.analysis || {};
    region.analysis.bank2VdpResidualGapAudit = {
      catalogId,
      kind: 'bank2_vdp_residual_gap_context',
      confidence: catalog.summary.modeledRootIndexPathFullyBound ? 'medium' : 'low',
      summary: 'Classifies unresolved bank-2 VDP stream bundle gaps after applying bounded root/index state-table reachability.',
      detail: {
        residualGapCount: catalog.summary.residualGapCount,
        residualGapBytes: catalog.summary.residualGapBytes,
        dispositionCounts: catalog.summary.dispositionCounts,
        stateRecordShapesNotReachableByModeledRootIndexPath: catalog.summary.stateRecordShapesNotReachableByModeledRootIndexPath,
        pointerListShapesOnlyReferencedByRejectedStateCandidates: catalog.summary.pointerListShapesOnlyReferencedByRejectedStateCandidates,
        actionableResidualGapCount: catalog.summary.actionableResidualGapCount,
        actionableResidualGapBytes: catalog.summary.actionableResidualGapBytes,
        actionableDispositionCounts: catalog.summary.actionableDispositionCounts,
        inboundRejectedStateCandidatePointerRefCount: catalog.summary.inboundRejectedStateCandidatePointerRefCount,
      },
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
  }
  return {
    changedRegions: [{ id: region.id, offset: region.offset, type: region.type, name: region.name, inferredAnalysis: 'bank2VdpResidualGapAudit' }],
    missingRegions: [],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);
  if (apply) {
    mapData.vdpStreamResidualGapCatalogs = (mapData.vdpStreamResidualGapCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpStreamResidualGapCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_residual_gap_audit',
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
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
