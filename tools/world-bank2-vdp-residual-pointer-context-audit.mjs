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
const residualCatalogId = 'world-bank2-vdp-residual-gap-catalog-2026-06-26';
const stateCatalogId = 'world-bank2-vdp-stream-state-catalog-2026-06-25';
const reachabilityCatalogId = 'world-bank2-vdp-state-candidate-reachability-catalog-2026-06-26';
const catalogId = 'world-bank2-vdp-residual-pointer-context-catalog-2026-06-26';
const reportId = 'bank2-vdp-residual-pointer-context-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-residual-pointer-context-audit.mjs';
const schemaVersion = 1;

const nonActionableDispositions = new Set([
  'confirmed_padding_gap',
  'state_record_shape_not_reachable_by_modeled_root_index_path',
  'vdp_draw_pointer_list_shape_only_referenced_by_rejected_state_candidates',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + Number(n).toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  return typeof value === 'string' ? parseInt(value, 16) : NaN;
}

function readWord(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
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

function mergeCounts(items, field) {
  const merged = {};
  for (const item of items) {
    for (const [key, count] of Object.entries(item[field] || {})) {
      merged[key] = (merged[key] || 0) + count;
    }
  }
  return merged;
}

function findCatalog(collection, id, collectionName) {
  const catalog = (collection || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing ${collectionName} catalog ${id}`);
  return catalog;
}

function regionStart(region) {
  return parseHex(region.offset);
}

function regionEnd(region) {
  return regionStart(region) + Number(region.size || 0);
}

function containingRegion(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
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

function inRange(offset, range) {
  const start = parseHex(range?.startOffset);
  const end = parseHex(range?.endOffsetExclusive);
  return Number.isFinite(start) && Number.isFinite(end) && offset >= start && offset < end;
}

function bank2WordForOffset(offset) {
  return offset >= 0x8000 && offset < 0xC000 ? offset : null;
}

function addField(fieldMap, offsetText, field) {
  if (!offsetText) return;
  if (!fieldMap.has(offsetText)) fieldMap.set(offsetText, []);
  fieldMap.get(offsetText).push(field);
}

function buildConfirmedPointerFieldIndex(stateCatalog) {
  const fields = new Map();
  for (const entry of stateCatalog.rootEntries || []) {
    addField(fields, entry.pointerOffset, {
      kind: 'confirmed_root_table_entry',
      role: 'root_subtable_pointer',
      targetOffset: entry.targetOffset,
      confidence: 'high',
    });
  }
  for (const table of stateCatalog.stateRecordTables || []) {
    for (const record of table.records || []) {
      addField(fields, record.pointerEntryOffset, {
        kind: 'confirmed_state_pointer_table_entry',
        rootIndex: table.rootIndex,
        entryIndex: record.index,
        targetOffset: record.recordOffset,
        confidence: 'high',
      });
      const normal = record.decoded?.normalRecord;
      if (!normal) continue;
      const recordStart = parseHex(normal.offset);
      for (const [index, pointer] of (normal.pointerRoles || []).entries()) {
        addField(fields, hex(recordStart + 1 + index * 2), {
          kind: 'confirmed_state_record_pointer_field',
          role: pointer.role,
          destinationRam: pointer.destinationRam,
          targetOffset: pointer.targetOffset,
          sourceRecordOffset: normal.offset,
          confidence: 'high',
        });
      }
    }
  }
  for (const target of stateCatalog.pointerRoleTargets || []) {
    if (target.role !== 'vdp_draw_pointer_list') continue;
    for (const pointer of target.decoded?.pointers || []) {
      addField(fields, pointer.pointerEntryOffset, {
        kind: 'confirmed_vdp_draw_pointer_list_entry',
        role: 'vdp_draw_segment_pointer',
        pointerListOffset: target.targetOffset,
        pointerIndex: pointer.index,
        targetOffset: pointer.segmentOffset,
        confidence: 'high',
      });
    }
  }
  return fields;
}

function buildRejectedStateFieldIndex(reachabilityCatalog) {
  const fields = new Map();
  for (const candidate of reachabilityCatalog.candidates || []) {
    const rejectedByModeledPath = candidate.status === 'not_reachable_by_modeled_bank2_vdp_root_index_path';
    for (const pointer of candidate.pointerRoles || []) {
      addField(fields, pointer.pointerFieldOffset, {
        kind: rejectedByModeledPath ? 'rejected_state_candidate_pointer_field' : 'state_candidate_pointer_field',
        role: pointer.role,
        sourceCandidateId: candidate.id,
        sourceStartOffset: candidate.range?.startOffset,
        sourceStatus: candidate.status,
        targetOffset: pointer.targetOffset,
        confidence: rejectedByModeledPath ? 'medium' : 'low',
      });
    }
  }
  return fields;
}

function sourceResidualGap(residualCatalog, offset) {
  return (residualCatalog.gaps || []).find(gap => inRange(offset, gap.range)) || null;
}

function sourceContext(mapData, residualCatalog, confirmedFields, rejectedFields, occurrenceOffset, targetOffset, targetGapId) {
  const offsetText = hex(occurrenceOffset);
  const confirmed = confirmedFields.get(offsetText) || [];
  const rejected = rejectedFields.get(offsetText) || [];
  const region = containingRegion(mapData, occurrenceOffset);
  const residualGap = sourceResidualGap(residualCatalog, occurrenceOffset);
  const matchingConfirmed = confirmed.filter(field => field.targetOffset === hex(targetOffset));
  const matchingRejected = rejected.filter(field => field.targetOffset === hex(targetOffset));
  let kind = 'raw_word_hit_unresolved_context';
  let confidence = 'low';
  let evidenceWeight = 'lead';

  if (matchingConfirmed.length) {
    kind = 'confirmed_pointer_field_to_target';
    confidence = 'high';
    evidenceWeight = 'confirmed_producer';
  } else if (matchingRejected.length) {
    kind = 'rejected_state_candidate_pointer_field_to_target';
    confidence = 'medium';
    evidenceWeight = 'negative_context';
  } else if (residualGap?.id === targetGapId) {
    kind = 'raw_word_inside_target_gap_payload';
    confidence = 'low';
    evidenceWeight = 'weak_self_context';
  } else if (residualGap?.disposition === 'vdp_draw_pointer_list_shape_only_referenced_by_rejected_state_candidates') {
    kind = 'pointer_list_candidate_only_rejected_state_path';
    confidence = 'medium';
    evidenceWeight = 'negative_context';
  } else if (residualGap?.disposition === 'state_record_shape_not_reachable_by_modeled_root_index_path') {
    kind = 'raw_word_inside_rejected_state_shape_gap';
    confidence = 'medium';
    evidenceWeight = 'negative_context';
  } else if (residualGap?.disposition?.startsWith('unreferenced_vdp_draw_segment_')) {
    kind = 'raw_word_inside_unresolved_vdp_draw_residual_gap';
    confidence = 'low';
    evidenceWeight = 'lead';
  } else if (residualGap) {
    kind = 'raw_word_inside_residual_gap';
    confidence = 'low';
    evidenceWeight = 'lead';
  } else if (region?.type === 'code') {
    kind = 'raw_word_inside_code_region';
    confidence = 'low';
    evidenceWeight = 'lead';
  } else if (region?.type && region.type !== 'unknown') {
    kind = `raw_word_inside_${region.type}`;
    confidence = 'low';
    evidenceWeight = 'lead';
  }

  return {
    occurrenceOffset: offsetText,
    kind,
    confidence,
    evidenceWeight,
    sourceRegion: regionRef(region),
    sourceResidualGap: residualGap ? {
      id: residualGap.id,
      range: residualGap.range,
      disposition: residualGap.disposition,
      confidence: residualGap.confidence,
    } : null,
    matchingConfirmedFields: matchingConfirmed,
    matchingRejectedFields: matchingRejected,
  };
}

function targetKindForGap(gap, boundaryKind) {
  if (gap.disposition.includes('object_list')) return 'object_list_sequence';
  if (boundaryKind === 'tail_decoded_segment_start') return 'vdp_draw_segment_tail_candidate';
  return 'vdp_draw_segment_candidate';
}

function collectTargets(residualCatalog) {
  const targets = [];
  const seen = new Set();
  for (const gap of residualCatalog.gaps || []) {
    if (nonActionableDispositions.has(gap.disposition)) continue;
    const addTarget = (offsetText, boundaryKind, range) => {
      const offset = parseHex(offsetText);
      const word = bank2WordForOffset(offset);
      if (word == null) return;
      const key = `${gap.id}|${offsetText}|${boundaryKind}`;
      if (seen.has(key)) return;
      seen.add(key);
      targets.push({
        id: `${gap.id}_${boundaryKind}_${offsetText}`,
        parentGapId: gap.id,
        parentGapRange: gap.range,
        parentDisposition: gap.disposition,
        parentLayoutClass: gap.layoutClass,
        targetOffset: offsetText,
        z80Pointer: hex(word, 4),
        boundaryKind,
        targetKind: targetKindForGap(gap, boundaryKind),
        targetRange: range || gap.range,
      });
    };
    addTarget(gap.range.startOffset, 'gap_start', gap.range);
    const tailRange = gap.tailClassification?.consumedRange;
    if (tailRange?.startOffset) addTarget(tailRange.startOffset, 'tail_decoded_segment_start', tailRange);
  }
  return targets;
}

function collectOccurrences(rom, targetWords) {
  const occurrences = new Map();
  for (let offset = 0; offset + 1 < rom.length; offset++) {
    const word = readWord(rom, offset);
    if (!targetWords.has(word)) continue;
    if (!occurrences.has(word)) occurrences.set(word, []);
    occurrences.get(word).push(offset);
  }
  return occurrences;
}

function classifyTarget(contexts) {
  const counts = countBy(contexts, context => context.kind);
  if ((counts.confirmed_pointer_field_to_target || 0) > 0) {
    return {
      disposition: 'has_confirmed_pointer_field_reference',
      confidence: 'high',
      reason: 'At least one raw pointer occurrence is in a confirmed decoded pointer field targeting this residual boundary.',
    };
  }
  if (!contexts.length) {
    return {
      disposition: 'no_raw_pointer_occurrence',
      confidence: 'medium',
      reason: 'No little-endian bank-2 pointer word to this residual boundary occurs in the ROM.',
    };
  }
  const negativeKinds = new Set([
    'rejected_state_candidate_pointer_field_to_target',
    'pointer_list_candidate_only_rejected_state_path',
    'raw_word_inside_target_gap_payload',
  ]);
  if (contexts.every(context => negativeKinds.has(context.kind))) {
    return {
      disposition: 'only_rejected_or_self_pointer_contexts',
      confidence: 'medium',
      reason: 'All raw pointer occurrences are inside rejected candidate paths or the target payload itself.',
    };
  }
  return {
    disposition: 'has_unresolved_raw_pointer_contexts',
    confidence: 'low',
    reason: 'At least one raw pointer occurrence is outside confirmed pointer fields and outside known rejected/self contexts.',
  };
}

function buildCatalog(rom, mapData) {
  const residualCatalog = findCatalog(mapData.vdpStreamResidualGapCatalogs, residualCatalogId, 'vdpStreamResidualGapCatalogs');
  const stateCatalog = findCatalog(mapData.vdpStreamCatalogs, stateCatalogId, 'vdpStreamCatalogs');
  const reachabilityCatalog = findCatalog(mapData.vdpStreamReachabilityCatalogs, reachabilityCatalogId, 'vdpStreamReachabilityCatalogs');
  const confirmedFields = buildConfirmedPointerFieldIndex(stateCatalog);
  const rejectedFields = buildRejectedStateFieldIndex(reachabilityCatalog);
  const targets = collectTargets(residualCatalog);
  const targetWords = new Set(targets.map(target => parseHex(target.z80Pointer)));
  const occurrencesByWord = collectOccurrences(rom, targetWords);

  const targetEntries = targets.map(target => {
    const targetOffset = parseHex(target.targetOffset);
    const occurrenceOffsets = occurrencesByWord.get(parseHex(target.z80Pointer)) || [];
    const contexts = occurrenceOffsets.map(offset => sourceContext(
      mapData,
      residualCatalog,
      confirmedFields,
      rejectedFields,
      offset,
      targetOffset,
      target.parentGapId,
    ));
    const classification = classifyTarget(contexts);
    return {
      ...target,
      rawOccurrenceCount: contexts.length,
      contextKindCounts: countBy(contexts, context => context.kind),
      evidenceWeightCounts: countBy(contexts, context => context.evidenceWeight),
      disposition: classification.disposition,
      confidence: classification.confidence,
      reason: classification.reason,
      occurrenceSamples: contexts.slice(0, 24),
    };
  });

  const parentSummaries = Object.values(targetEntries.reduce((groups, target) => {
    if (!groups[target.parentGapId]) {
      groups[target.parentGapId] = {
        parentGapId: target.parentGapId,
        parentGapRange: target.parentGapRange,
        parentDisposition: target.parentDisposition,
        targetCount: 0,
        rawOccurrenceCount: 0,
        targetDispositionCounts: {},
      };
    }
    const group = groups[target.parentGapId];
    group.targetCount++;
    group.rawOccurrenceCount += target.rawOccurrenceCount;
    group.targetDispositionCounts[target.disposition] = (group.targetDispositionCounts[target.disposition] || 0) + 1;
    return groups;
  }, {}));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [residualCatalogId, stateCatalogId, reachabilityCatalogId],
    bundle: residualCatalog.bundle,
    summary: {
      actionableParentGapCount: parentSummaries.length,
      targetBoundaryCount: targetEntries.length,
      rawOccurrenceCount: sumBy(targetEntries, target => target.rawOccurrenceCount),
      targetDispositionCounts: countBy(targetEntries, target => target.disposition),
      targetKindCounts: countBy(targetEntries, target => target.targetKind),
      contextKindCounts: mergeCounts(targetEntries, 'contextKindCounts'),
      evidenceWeightCounts: mergeCounts(targetEntries, 'evidenceWeightCounts'),
      confirmedPointerFieldTargetCount: targetEntries.filter(target => target.disposition === 'has_confirmed_pointer_field_reference').length,
      noRawPointerOccurrenceTargetCount: targetEntries.filter(target => target.disposition === 'no_raw_pointer_occurrence').length,
      onlyRejectedOrSelfContextTargetCount: targetEntries.filter(target => target.disposition === 'only_rejected_or_self_pointer_contexts').length,
      unresolvedRawPointerContextTargetCount: targetEntries.filter(target => target.disposition === 'has_unresolved_raw_pointer_contexts').length,
      assetPolicy: 'Metadata only: target offsets, source offsets, region ids, pointer-field roles, counts, and context classifications. No ROM bytes, decoded graphics, screenshots, hashes, or asset payloads are embedded.',
    },
    targets: targetEntries,
    parentGapSummaries: parentSummaries,
    evidence: [
      `${residualCatalogId} supplies the actionable residual bank-2 VDP draw/object gap boundaries.`,
      `${stateCatalogId} supplies confirmed decoded pointer fields for state records and VDP draw pointer lists.`,
      `${reachabilityCatalogId} supplies rejected state-candidate pointer fields so raw hits from false paths are not promoted.`,
      'The audit scans for little-endian bank-2 pointer words and stores only offsets/context metadata, never pointed bytes.',
    ],
    nextLeads: [
      'Promote a residual draw/object gap only when this catalog reports a confirmed pointer-field reference or a separately traced code producer.',
      'For unresolved raw pointer contexts, inspect the source region type before treating the word as a real pointer.',
      'For no-occurrence targets, prioritize boundary refinement over promotion.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegionById(mapData, 'r0186');
  if (!region) {
    return { changedRegions: [], missingRegions: [{ id: 'r0186', role: 'bank2_vdp_residual_pointer_context' }] };
  }
  if (apply) {
    region.analysis = region.analysis || {};
    region.analysis.bank2VdpResidualPointerContextAudit = {
      catalogId,
      kind: 'bank2_vdp_residual_pointer_context',
      confidence: catalog.summary.confirmedPointerFieldTargetCount > 0 ? 'medium' : 'low',
      summary: 'Raw pointer-word context search for actionable bank-2 VDP residual draw/object gap boundaries.',
      detail: {
        actionableParentGapCount: catalog.summary.actionableParentGapCount,
        targetBoundaryCount: catalog.summary.targetBoundaryCount,
        rawOccurrenceCount: catalog.summary.rawOccurrenceCount,
        targetDispositionCounts: catalog.summary.targetDispositionCounts,
        targetKindCounts: catalog.summary.targetKindCounts,
        confirmedPointerFieldTargetCount: catalog.summary.confirmedPointerFieldTargetCount,
        noRawPointerOccurrenceTargetCount: catalog.summary.noRawPointerOccurrenceTargetCount,
        onlyRejectedOrSelfContextTargetCount: catalog.summary.onlyRejectedOrSelfContextTargetCount,
        unresolvedRawPointerContextTargetCount: catalog.summary.unresolvedRawPointerContextTargetCount,
      },
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
  }
  return {
    changedRegions: [{ id: region.id, offset: region.offset, type: region.type, name: region.name, inferredAnalysis: 'bank2VdpResidualPointerContextAudit' }],
    missingRegions: [],
  };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotation = annotateMap(mapData, catalog);
  if (apply) {
    mapData.vdpStreamResidualPointerContextCatalogs = (mapData.vdpStreamResidualPointerContextCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpStreamResidualPointerContextCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_residual_pointer_context_audit',
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
