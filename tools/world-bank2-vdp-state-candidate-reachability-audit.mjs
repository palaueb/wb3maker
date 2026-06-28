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
const now = '2026-06-26T00:00:00Z';
const layoutCatalogId = 'world-bank2-vdp-stream-layout-catalog-2026-06-25';
const stateCatalogId = 'world-bank2-vdp-stream-state-catalog-2026-06-25';
const coverageCatalogId = 'world-bank2-vdp-state-index-coverage-catalog-2026-06-26';
const catalogId = 'world-bank2-vdp-state-candidate-reachability-catalog-2026-06-26';
const reportId = 'bank2-vdp-state-candidate-reachability-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-state-candidate-reachability-audit.mjs';
const schemaVersion = 1;

const bundleOffset = 0x09AE0;
const bundleEndExclusive = 0x0B3C0;

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readWord(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function parseHex(value) {
  if (typeof value !== 'string') return NaN;
  return parseInt(value, 16);
}

function bank2Z80WordForOffset(offset) {
  return offset >= 0x8000 && offset < 0xC000 ? offset : null;
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

function compactRange(start, endExclusive, extra = {}) {
  return {
    startOffset: hex(start),
    endOffsetExclusive: hex(endExclusive),
    size: endExclusive - start,
    ...extra,
  };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function buildLayoutSpans(layoutCatalog) {
  const spans = [];
  for (const interval of layoutCatalog.mergedIntervals || []) {
    const start = parseHex(interval.startOffset);
    const endExclusive = parseHex(interval.endOffsetExclusive);
    if (!Number.isFinite(start) || !Number.isFinite(endExclusive)) continue;
    spans.push({
      kind: 'decoded_interval',
      start,
      endExclusive,
      class: (interval.kinds || []).join('+') || 'decoded_interval',
      confidence: 'high',
      ref: {
        startOffset: interval.startOffset,
        endOffsetExclusive: interval.endOffsetExclusive,
        size: interval.size,
        kinds: interval.kinds || [],
      },
    });
  }
  for (const gap of layoutCatalog.gaps || []) {
    const start = parseHex(gap.startOffset);
    const endExclusive = parseHex(gap.endOffsetExclusive);
    if (!Number.isFinite(start) || !Number.isFinite(endExclusive)) continue;
    spans.push({
      kind: 'layout_gap',
      start,
      endExclusive,
      class: gap.class || 'unknown_gap',
      confidence: gap.confidence || 'low',
      ref: {
        startOffset: gap.startOffset,
        endOffsetExclusive: gap.endOffsetExclusive,
        size: gap.size,
        class: gap.class,
        confidence: gap.confidence,
      },
    });
  }
  return spans.sort((a, b) => a.start - b.start || a.endExclusive - b.endExclusive);
}

function containingLayoutSpan(spans, offset) {
  return spans.find(span => offset >= span.start && offset < span.endExclusive) || null;
}

function collectConfirmedTableRefs(stateCatalog) {
  const refsByTarget = new Map();
  for (const table of stateCatalog.stateRecordTables || []) {
    for (const record of table.records || []) {
      const targetOffset = record.recordOffset;
      if (!targetOffset) continue;
      if (!refsByTarget.has(targetOffset)) refsByTarget.set(targetOffset, []);
      refsByTarget.get(targetOffset).push({
        kind: 'state_pointer_table_entry',
        rootIndex: table.rootIndex,
        tableOffset: table.tableOffset,
        entryIndex: record.index,
        pointerEntryOffset: record.pointerEntryOffset,
        z80Pointer: record.z80Pointer,
        recordOffset: record.recordOffset,
      });
    }
  }
  return refsByTarget;
}

function collectConfirmedControlRefs(stateCatalog) {
  const refsByTarget = new Map();
  for (const table of stateCatalog.stateRecordTables || []) {
    for (const record of table.records || []) {
      for (const control of record.decoded?.controls || []) {
        const targetOffset = control.pointerOperand?.targetOffset;
        if (!targetOffset) continue;
        if (!refsByTarget.has(targetOffset)) refsByTarget.set(targetOffset, []);
        refsByTarget.get(targetOffset).push({
          kind: 'state_record_fd_control_pointer',
          rootIndex: table.rootIndex,
          tableOffset: table.tableOffset,
          sourceRecordOffset: record.recordOffset,
          sourceEntryIndex: record.index,
          controlOffset: control.offset,
          opcode: control.opcode,
          handler: control.handler,
          operandOffset: control.pointerOperand.operandOffset,
          z80Pointer: control.pointerOperand.z80Pointer,
          targetOffset,
        });
      }
    }
  }
  return refsByTarget;
}

function collectRawBundleWordRefs(rom, targetOffset, layoutSpans) {
  const z80Word = bank2Z80WordForOffset(targetOffset);
  if (z80Word == null) return [];
  const refs = [];
  for (let offset = bundleOffset; offset + 1 < bundleEndExclusive; offset++) {
    if (readWord(rom, offset) !== z80Word) continue;
    const span = containingLayoutSpan(layoutSpans, offset);
    refs.push({
      occurrenceOffset: hex(offset),
      z80Pointer: hex(z80Word, 4),
      targetOffset: hex(targetOffset),
      containingLayout: span ? {
        kind: span.kind,
        class: span.class,
        confidence: span.confidence,
        range: span.ref,
      } : null,
    });
  }
  return refs;
}

function candidateStatus(candidate, confirmedTableRefs, confirmedControlRefs, rawBundleWordRefs, coverageCatalog) {
  if (confirmedTableRefs.length || confirmedControlRefs.length) {
    return {
      status: 'confirmed_reachable_candidate_state_record',
      confidence: 'high',
      reason: 'Candidate state record has a confirmed state-table entry or FD control-flow pointer producer.',
    };
  }
  if (coverageCatalog?.summary?.canFullyBoundRuntimeRootAndIndex && rawBundleWordRefs.length === 0) {
    return {
      status: 'not_reachable_by_modeled_bank2_vdp_root_index_path',
      confidence: candidate.class === 'unreferenced_exact_state_record_candidate' ? 'medium' : 'low',
      reason: 'The _RAM_D15A_ root selection and _RAM_D15D_ state index are fully bounded for the audited bank-2 executable window, and this candidate has no decoded table entry, control-flow pointer, or raw in-bundle pointer occurrence.',
    };
  }
  if (candidate.class === 'unreferenced_exact_state_record_candidate') {
    return {
      status: 'shape_valid_exact_state_record_unconfirmed_reachability',
      confidence: 'medium',
      reason: 'Candidate decodes exactly as a normal state record and its pointer targets resolve, but no confirmed state-table/control-flow producer reaches it.',
    };
  }
  return {
    status: 'shape_valid_prefix_state_record_unconfirmed_reachability',
    confidence: 'low',
    reason: 'Candidate begins with a valid normal state record and its pointer targets resolve, but it leaves adjacent tail bytes and has no confirmed state-table/control-flow producer.',
  };
}

function buildCatalog(rom, mapData) {
  const layoutCatalog = (mapData.vdpStreamLayoutCatalogs || []).find(catalog => catalog.id === layoutCatalogId);
  const stateCatalog = (mapData.vdpStreamCatalogs || []).find(catalog => catalog.id === stateCatalogId);
  const coverageCatalog = (mapData.vdpStreamRuntimeCatalogs || []).find(catalog => catalog.id === coverageCatalogId);
  if (!layoutCatalog) throw new Error(`Missing layout catalog ${layoutCatalogId}`);
  if (!stateCatalog) throw new Error(`Missing state catalog ${stateCatalogId}`);
  if (!coverageCatalog) throw new Error(`Missing coverage catalog ${coverageCatalogId}`);

  const layoutSpans = buildLayoutSpans(layoutCatalog);
  const confirmedTableRefsByTarget = collectConfirmedTableRefs(stateCatalog);
  const confirmedControlRefsByTarget = collectConfirmedControlRefs(stateCatalog);
  const bundleRegion = findRegionById(mapData, 'r0186');
  const candidates = [];

  for (const gap of layoutCatalog.gaps || []) {
    if (!gap.pointerRoles?.length) continue;
    const start = parseHex(gap.startOffset);
    const endExclusive = parseHex(gap.endOffsetExclusive);
    const confirmedTableRefs = confirmedTableRefsByTarget.get(gap.startOffset) || [];
    const confirmedControlRefs = confirmedControlRefsByTarget.get(gap.startOffset) || [];
    const rawBundleWordRefs = collectRawBundleWordRefs(rom, start, layoutSpans);
    const status = candidateStatus(gap, confirmedTableRefs, confirmedControlRefs, rawBundleWordRefs, coverageCatalog);

    candidates.push({
      id: `bank2_state_candidate_${gap.startOffset}`,
      range: compactRange(start, endExclusive, {
        class: gap.class,
        confidence: gap.confidence,
        consumedBytes: gap.consumedBytes || null,
        candidateTailBytes: gap.candidateTailBytes || 0,
      }),
      status: status.status,
      confidence: status.confidence,
      reason: status.reason,
      statePointerTargetSummary: gap.statePointerTargetSummary || null,
      pointerRoles: (gap.pointerRoles || []).map(pointer => ({
        role: pointer.role,
        fieldRole: pointer.fieldRole,
        destinationRam: pointer.destinationRam,
        consumer: pointer.consumer,
        pointerFieldOffset: pointer.pointerFieldOffset,
        z80Pointer: pointer.z80Pointer,
        targetOffset: pointer.targetOffset,
        targetContext: pointer.targetContext ? {
          status: pointer.targetContext.status,
          confidence: pointer.targetContext.confidence,
          targetAtIntervalStart: pointer.targetContext.targetAtIntervalStart,
          targetAtGapStart: pointer.targetContext.targetAtGapStart,
          roleMatchesDecodedInterval: pointer.targetContext.roleMatchesDecodedInterval,
          targetSubrange: pointer.targetContext.targetSubrange,
          intervalRefs: pointer.targetContext.intervalRefs,
          gapRef: pointer.targetContext.gapRef,
        } : null,
      })),
      confirmedStateTableRefCount: confirmedTableRefs.length,
      confirmedStateTableRefs: confirmedTableRefs,
      confirmedControlRefCount: confirmedControlRefs.length,
      confirmedControlRefs,
      rawBundleWordOccurrenceCount: rawBundleWordRefs.length,
      rawBundleWordOccurrenceContextCounts: countBy(rawBundleWordRefs, ref => (
        ref.containingLayout ? `${ref.containingLayout.kind}:${ref.containingLayout.class}` : 'unknown_layout'
      )),
      rawBundleWordOccurrenceSamples: rawBundleWordRefs.slice(0, 12),
      exactCandidate: gap.class === 'unreferenced_exact_state_record_candidate',
      prefixCandidate: gap.class === 'unreferenced_state_record_prefix_candidate',
    });
  }

  const statusCounts = countBy(candidates, candidate => candidate.status);
  const confidenceCounts = countBy(candidates, candidate => candidate.confidence);
  const rawBundleWordOccurrenceCount = candidates.reduce((total, candidate) => total + candidate.rawBundleWordOccurrenceCount, 0);
  const confirmedStateTableRefCount = candidates.reduce((total, candidate) => total + candidate.confirmedStateTableRefCount, 0);
  const confirmedControlRefCount = candidates.reduce((total, candidate) => total + candidate.confirmedControlRefCount, 0);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [stateCatalogId, layoutCatalogId, coverageCatalogId],
    bundle: {
      region: regionRef(bundleRegion),
      range: [hex(bundleOffset), hex(bundleEndExclusive - 1)],
      size: bundleEndExclusive - bundleOffset,
    },
    summary: {
      candidateStateRecordCount: candidates.length,
      exactStateRecordCandidateCount: candidates.filter(candidate => candidate.exactCandidate).length,
      prefixStateRecordCandidateCount: candidates.filter(candidate => candidate.prefixCandidate).length,
      confirmedReachableCandidateCount: candidates.filter(candidate => candidate.status === 'confirmed_reachable_candidate_state_record').length,
      unconfirmedReachabilityCandidateCount: candidates.filter(candidate => candidate.status !== 'confirmed_reachable_candidate_state_record').length,
      candidatesWithAllPointerTargetsResolved: candidates.filter(candidate => (
        candidate.statePointerTargetSummary?.allTargetsResolvedToDecodedOrCandidateLayout
      )).length,
      confirmedStateTableRefCount,
      confirmedControlRefCount,
      rawBundleWordOccurrenceCount,
      modeledRootIndexPathFullyBound: Boolean(coverageCatalog.summary.canFullyBoundRuntimeRootAndIndex),
      candidatesNotReachableByModeledRootIndexPath: candidates.filter(candidate => (
        candidate.status === 'not_reachable_by_modeled_bank2_vdp_root_index_path'
      )).length,
      statusCounts,
      confidenceCounts,
      pointerTargetStatusCounts: countBy(
        candidates.flatMap(candidate => candidate.pointerRoles || []),
        pointer => pointer.targetContext?.status || 'missing_target_context',
      ),
      assetPolicy: 'Metadata only: candidate offsets/ranges, pointer roles, reference offsets, counts, and reachability classifications. No ROM bytes, decoded graphics, pixels, screenshots, hashes, or asset payloads are embedded.',
    },
    candidates,
    evidence: [
      `${layoutCatalogId} supplies state-record-shaped gap candidates and pointer target contexts.`,
      `${stateCatalogId} supplies confirmed root/state pointer tables and decoded _LABEL_972B_ state records.`,
      `${coverageCatalogId} proves the modeled _RAM_D15A_ root selections and _RAM_D15D_ state indices are fully bounded for the audited bank-2 executable window.`,
      '_LABEL_96FE_ indexes the active state pointer table through _RAM_D15A_/_RAM_D15D_; confirmed reachability requires a state-table entry or control-flow pointer into the candidate start.',
    ],
    nextLeads: [
      'Do not promote these state-record-shaped gaps through the bank-2 VDP state-table path unless a new table/control/raw pointer producer is found.',
      'Classify the remaining candidate gaps by their pointer-role targets to decide whether they are false-positive record prefixes or alternate data structures.',
      'Continue resolving adjacent VDP draw-segment and object-list gap candidates inside the same bundle.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegionById(mapData, 'r0186');
  if (!region) {
    return { changedRegions: [], missingRegions: [{ id: 'r0186', role: 'bank2_vdp_state_candidate_reachability' }] };
  }
  if (!apply) {
    return {
      changedRegions: [{ id: region.id, offset: region.offset, type: region.type, name: region.name, inferredAnalysis: 'bank2VdpStateCandidateReachabilityAudit' }],
      missingRegions: [],
    };
  }
  region.analysis = region.analysis || {};
  region.analysis.bank2VdpStateCandidateReachabilityAudit = {
    catalogId,
    kind: 'bank2_vdp_state_candidate_reachability',
    confidence: catalog.summary.modeledRootIndexPathFullyBound ? 'medium' : 'low',
    summary: 'Reachability audit for state-record-shaped gaps inside the bank-2 VDP stream bundle. Candidates are not promoted without confirmed state-table/control-flow producers.',
    detail: {
      candidateStateRecordCount: catalog.summary.candidateStateRecordCount,
      exactStateRecordCandidateCount: catalog.summary.exactStateRecordCandidateCount,
      prefixStateRecordCandidateCount: catalog.summary.prefixStateRecordCandidateCount,
      confirmedReachableCandidateCount: catalog.summary.confirmedReachableCandidateCount,
      unconfirmedReachabilityCandidateCount: catalog.summary.unconfirmedReachabilityCandidateCount,
      modeledRootIndexPathFullyBound: catalog.summary.modeledRootIndexPathFullyBound,
      candidatesNotReachableByModeledRootIndexPath: catalog.summary.candidatesNotReachableByModeledRootIndexPath,
      candidatesWithAllPointerTargetsResolved: catalog.summary.candidatesWithAllPointerTargetsResolved,
      confirmedStateTableRefCount: catalog.summary.confirmedStateTableRefCount,
      confirmedControlRefCount: catalog.summary.confirmedControlRefCount,
      rawBundleWordOccurrenceCount: catalog.summary.rawBundleWordOccurrenceCount,
      statusCounts: catalog.summary.statusCounts,
      pointerTargetStatusCounts: catalog.summary.pointerTargetStatusCounts,
    },
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    changedRegions: [{ id: region.id, offset: region.offset, type: region.type, name: region.name, inferredAnalysis: 'bank2VdpStateCandidateReachabilityAudit' }],
    missingRegions: [],
  };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.vdpStreamReachabilityCatalogs = (mapData.vdpStreamReachabilityCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpStreamReachabilityCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_state_candidate_reachability_audit',
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
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
