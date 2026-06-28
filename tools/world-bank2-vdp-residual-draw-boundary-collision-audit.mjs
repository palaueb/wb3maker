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
const drawFieldCatalogId = 'world-bank2-vdp-residual-draw-field-catalog-2026-06-26';
const layoutCatalogId = 'world-bank2-vdp-stream-layout-catalog-2026-06-25';
const catalogId = 'world-bank2-vdp-residual-draw-boundary-collision-catalog-2026-06-26';
const reportId = 'bank2-vdp-residual-draw-boundary-collision-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-residual-draw-boundary-collision-audit.mjs';
const schemaVersion = 1;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  return typeof value === 'string' ? parseInt(value, 16) : NaN;
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function range(start, endExclusive) {
  return {
    startOffset: hex(start),
    endOffsetExclusive: hex(endExclusive),
    size: endExclusive - start,
  };
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

function overlapRange(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(aStart, bStart);
  const endExclusive = Math.min(aEnd, bEnd);
  return endExclusive > start ? range(start, endExclusive) : null;
}

function uniqueSourceCandidates(drawFieldCatalog) {
  const byGap = new Map();
  for (const target of drawFieldCatalog.targets || []) {
    for (const occurrence of target.sourceOccurrences || []) {
      const gapId = occurrence.sourceGap?.id;
      const candidate = occurrence.decodedCandidate;
      if (!gapId || !candidate) continue;
      if (!byGap.has(gapId)) {
        byGap.set(gapId, {
          sourceGap: occurrence.sourceGap,
          decodedCandidate: candidate,
          occurrenceCount: 0,
          targetIds: new Set(),
          targetOffsets: new Set(),
        });
      }
      const item = byGap.get(gapId);
      item.occurrenceCount++;
      item.targetIds.add(target.id);
      item.targetOffsets.add(target.targetOffset);
    }
  }

  return [...byGap.entries()].map(([gapId, item]) => ({
    gapId,
    sourceGap: item.sourceGap,
    decodedCandidate: item.decodedCandidate,
    occurrenceCount: item.occurrenceCount,
    targetIds: [...item.targetIds].sort(),
    targetOffsets: [...item.targetOffsets].sort(),
  }));
}

function collectCollisions(candidate, layoutCatalog) {
  const candidateStart = parseHex(candidate.decodedCandidate.offset);
  const candidateEnd = parseHex(candidate.decodedCandidate.endOffsetExclusive);
  const sourceGapStart = parseHex(candidate.sourceGap.range?.startOffset);
  const sourceGapEnd = parseHex(candidate.sourceGap.range?.endOffsetExclusive);
  const overrunRange = Number.isFinite(sourceGapEnd) && candidateEnd > sourceGapEnd
    ? range(sourceGapEnd, candidateEnd)
    : null;
  const collisionRanges = [];

  for (const run of layoutCatalog.mergedIntervals || []) {
    const start = parseHex(run.startOffset);
    const end = parseHex(run.endOffsetExclusive);
    const overlap = overlapRange(candidateStart, candidateEnd, start, end);
    if (!overlap) continue;
    const isSelf = overlap.startOffset === candidate.sourceGap.range?.startOffset
      && overlap.endOffsetExclusive === candidate.sourceGap.range?.endOffsetExclusive;
    if (isSelf) continue;
    collisionRanges.push({
      kind: 'decoded_merged_run',
      source: {
        startOffset: run.startOffset,
        endOffsetExclusive: run.endOffsetExclusive,
        size: run.size,
        kinds: run.kinds || [],
      },
      overlapRange: overlap,
    });
  }

  for (const gap of layoutCatalog.gaps || []) {
    const start = parseHex(gap.startOffset);
    const end = parseHex(gap.endOffsetExclusive);
    const overlap = overlapRange(candidateStart, candidateEnd, start, end);
    if (!overlap || gap.startOffset === candidate.sourceGap.range?.startOffset) continue;
    collisionRanges.push({
      kind: 'residual_gap_candidate',
      source: {
        startOffset: gap.startOffset,
        endOffsetExclusive: gap.endOffsetExclusive,
        size: gap.size,
        class: gap.class,
        confidence: gap.confidence,
        precedingKinds: gap.precedingKinds || [],
        followingKinds: gap.followingKinds || [],
      },
      overlapRange: overlap,
    });
  }

  collisionRanges.sort((a, b) => parseHex(a.overlapRange.startOffset) - parseHex(b.overlapRange.startOffset)
    || a.kind.localeCompare(b.kind));

  const overrunCollisions = overrunRange
    ? collisionRanges.filter(collision => {
      const start = parseHex(collision.overlapRange.startOffset);
      const end = parseHex(collision.overlapRange.endOffsetExclusive);
      return end > parseHex(overrunRange.startOffset) && start < parseHex(overrunRange.endOffsetExclusive);
    })
    : [];
  const decodedRunBytes = sumBy(overrunCollisions.filter(item => item.kind === 'decoded_merged_run'), item => item.overlapRange.size || 0);
  const residualGapBytes = sumBy(overrunCollisions.filter(item => item.kind === 'residual_gap_candidate'), item => item.overlapRange.size || 0);
  const overrunBytes = overrunRange?.size || 0;
  const explainedBytes = decodedRunBytes + residualGapBytes;
  const decodedKinds = new Set(
    overrunCollisions
      .filter(item => item.kind === 'decoded_merged_run')
      .flatMap(item => item.source.kinds || []),
  );
  const gapClasses = new Set(
    overrunCollisions
      .filter(item => item.kind === 'residual_gap_candidate')
      .map(item => item.source.class || 'unknown_gap_class'),
  );

  let disposition = 'candidate_stays_within_source_gap';
  let confidence = 'medium';
  let reason = 'Decoded candidate terminates within its source residual gap.';
  if (overrunRange && overrunCollisions.length) {
    disposition = 'candidate_overruns_source_gap_into_decoded_runs_and_gap_candidates';
    confidence = 'medium';
    reason = 'Decoded candidate crosses confirmed merged decoded runs and other residual candidate gaps, so it is an overlapping interpretation and not promotable as a standalone draw segment.';
  } else if (overrunRange) {
    disposition = 'candidate_overruns_source_gap_without_layout_collision';
    confidence = 'low';
    reason = 'Decoded candidate extends beyond its source gap, but no current layout collision explains the overrun.';
  }

  return {
    sourceGap: candidate.sourceGap,
    decodedCandidate: candidate.decodedCandidate,
    occurrenceCount: candidate.occurrenceCount,
    targetIds: candidate.targetIds,
    targetOffsets: candidate.targetOffsets,
    overrunRange,
    overrunBytes,
    overrunCollisionCount: overrunCollisions.length,
    overrunCollisionKindCounts: countBy(overrunCollisions, item => item.kind),
    overrunDecodedKindCounts: countBy(
      overrunCollisions.filter(item => item.kind === 'decoded_merged_run').flatMap(item => item.source.kinds || []),
      kind => kind,
    ),
    overrunGapClassCounts: countBy(
      overrunCollisions.filter(item => item.kind === 'residual_gap_candidate'),
      item => item.source.class || 'unknown_gap_class',
    ),
    overrunBytesByCollisionKind: {
      decoded_merged_run: decodedRunBytes,
      residual_gap_candidate: residualGapBytes,
      unaccounted: Math.max(0, overrunBytes - explainedBytes),
    },
    collidedDecodedKinds: [...decodedKinds].sort(),
    collidedGapClasses: [...gapClasses].sort(),
    disposition,
    confidence,
    reason,
    collisionRanges: overrunCollisions,
  };
}

function buildCatalog(mapData) {
  const drawFieldCatalog = requireCatalog(mapData, drawFieldCatalogId);
  const layoutCatalog = requireCatalog(mapData, layoutCatalogId);
  const candidates = uniqueSourceCandidates(drawFieldCatalog)
    .map(candidate => collectCollisions(candidate, layoutCatalog));
  const overrunCandidates = candidates.filter(candidate => candidate.overrunRange);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [drawFieldCatalogId, layoutCatalogId],
    summary: {
      sourceCandidateCount: candidates.length,
      overrunCandidateCount: overrunCandidates.length,
      overrunCandidateDispositionCounts: countBy(overrunCandidates, candidate => candidate.disposition),
      overrunCollisionKindCounts: countBy(overrunCandidates.flatMap(candidate => candidate.collisionRanges || []), collision => collision.kind),
      overrunDecodedKindCounts: countBy(
        overrunCandidates.flatMap(candidate => candidate.collisionRanges || [])
          .filter(collision => collision.kind === 'decoded_merged_run')
          .flatMap(collision => collision.source.kinds || []),
        kind => kind,
      ),
      overrunGapClassCounts: countBy(
        overrunCandidates.flatMap(candidate => candidate.collisionRanges || [])
          .filter(collision => collision.kind === 'residual_gap_candidate'),
        collision => collision.source.class || 'unknown_gap_class',
      ),
      overrunBytes: sumBy(overrunCandidates, candidate => candidate.overrunBytes || 0),
      overrunBytesByCollisionKind: {
        decoded_merged_run: sumBy(overrunCandidates, candidate => candidate.overrunBytesByCollisionKind.decoded_merged_run || 0),
        residual_gap_candidate: sumBy(overrunCandidates, candidate => candidate.overrunBytesByCollisionKind.residual_gap_candidate || 0),
        unaccounted: sumBy(overrunCandidates, candidate => candidate.overrunBytesByCollisionKind.unaccounted || 0),
      },
      notPromotableSourceCandidateCount: overrunCandidates.filter(candidate => (
        candidate.disposition === 'candidate_overruns_source_gap_into_decoded_runs_and_gap_candidates'
      )).length,
      assetPolicy: 'Metadata only: offsets, overlap ranges, layout classes, counts, and evidence labels. No ROM bytes, decoded graphics, screenshots, hashes, or asset payloads are embedded.',
    },
    candidates,
    evidence: [
      `${drawFieldCatalogId} supplies the two low-confidence source draw candidates that explain remaining intra-residual raw word hits.`,
      `${layoutCatalogId} supplies merged decoded runs and residual gap candidates for the bank-2 VDP stream bundle.`,
      'A candidate that crosses merged decoded runs or other residual candidates is treated as boundary-collision evidence, not as a promoted draw segment.',
    ],
    nextLeads: [
      'Find a confirmed pointer-list producer before promoting the target residual draw candidates around 0x0AC28, 0x0AC4A, 0x0ACBF, and 0x0AE3D.',
      'Treat source gaps 0x09F90 and 0x0A04C as overlapping draw-candidate interpretations until their overrun collisions are resolved.',
      'Use collision ranges to prioritize direct pointer-list tracing over further raw word searches in this bank-2 area.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegionById(mapData, 'r0186');
  if (!region) {
    return { changedRegions: [], missingRegions: [{ id: 'r0186', role: 'bank2_vdp_residual_draw_boundary_collision' }] };
  }
  if (apply) {
    region.analysis = region.analysis || {};
    region.analysis.bank2VdpResidualDrawBoundaryCollisionAudit = {
      catalogId,
      kind: 'bank2_vdp_residual_draw_boundary_collision',
      confidence: catalog.summary.notPromotableSourceCandidateCount === catalog.summary.overrunCandidateCount ? 'medium' : 'low',
      summary: 'Explains low-confidence residual draw-source candidates that overrun their source gaps by colliding with decoded runs and other gap candidates.',
      detail: {
        sourceCandidateCount: catalog.summary.sourceCandidateCount,
        overrunCandidateCount: catalog.summary.overrunCandidateCount,
        overrunCandidateDispositionCounts: catalog.summary.overrunCandidateDispositionCounts,
        overrunCollisionKindCounts: catalog.summary.overrunCollisionKindCounts,
        overrunDecodedKindCounts: catalog.summary.overrunDecodedKindCounts,
        overrunGapClassCounts: catalog.summary.overrunGapClassCounts,
        overrunBytes: catalog.summary.overrunBytes,
        overrunBytesByCollisionKind: catalog.summary.overrunBytesByCollisionKind,
        notPromotableSourceCandidateCount: catalog.summary.notPromotableSourceCandidateCount,
      },
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
  }
  return {
    changedRegions: [{ id: region.id, offset: region.offset, type: region.type, name: region.name, inferredAnalysis: 'bank2VdpResidualDrawBoundaryCollisionAudit' }],
    missingRegions: [],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.vdpStreamResidualBoundaryCollisionCatalogs = (mapData.vdpStreamResidualBoundaryCollisionCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpStreamResidualBoundaryCollisionCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_residual_draw_boundary_collision_audit',
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
