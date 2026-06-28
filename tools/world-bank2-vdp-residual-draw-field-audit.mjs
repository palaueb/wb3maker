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
const sourceTriageCatalogId = 'world-bank2-vdp-residual-source-triage-catalog-2026-06-26';
const residualGapCatalogId = 'world-bank2-vdp-residual-gap-catalog-2026-06-26';
const layoutCatalogId = 'world-bank2-vdp-stream-layout-catalog-2026-06-25';
const catalogId = 'world-bank2-vdp-residual-draw-field-catalog-2026-06-26';
const reportId = 'bank2-vdp-residual-draw-field-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-residual-draw-field-audit.mjs';
const schemaVersion = 1;
const bundleEndExclusive = 0x0B3C0;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
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

function range(start, endExclusive) {
  return {
    startOffset: hex(start),
    endOffsetExclusive: hex(endExclusive),
    size: endExclusive - start,
  };
}

function controlFieldInfo(byte) {
  if (byte === 0xFF) return { role: 'control_end_segment', operandBytes: 0 };
  if (byte === 0xFE) return { role: 'control_next_row', operandBytes: 0 };
  if (byte === 0xFD) return { role: 'control_relative_vdp_address', operandBytes: 1 };
  if (byte === 0xFC) return { role: 'control_new_vdp_address_word', operandBytes: 2 };
  return { role: 'control_blank_run_count', operandBytes: 1 };
}

function decodeDrawFields(rom, offset, limitExclusive = bundleEndExclusive) {
  let pc = offset;
  const fields = [];
  let fieldIndex = 0;
  let tileWordPairs = 0;
  let controlCount = 0;

  function addField(role, start, endExclusive, stepIndex) {
    fields.push({
      role,
      start,
      endExclusive,
      stepIndex,
      fieldIndex: fieldIndex++,
    });
  }

  if (pc + 2 > limitExclusive) return null;
  addField('initial_vdp_address_word', pc, pc + 2, 0);
  pc += 2;

  for (let step = 0; step < 4096 && pc < limitExclusive; step++) {
    const byte = rom[pc];
    if (byte < 0xF0) {
      if (pc + 2 > limitExclusive) return null;
      addField('tile_word_pair', pc, pc + 2, step + 1);
      tileWordPairs++;
      pc += 2;
      continue;
    }

    const control = controlFieldInfo(byte);
    const controlStart = pc;
    pc++;
    addField(control.role, controlStart, controlStart + 1, step + 1);
    controlCount++;

    if (control.operandBytes) {
      if (pc + control.operandBytes > limitExclusive) return null;
      addField(`${control.role}_operand`, pc, pc + control.operandBytes, step + 1);
      pc += control.operandBytes;
    }
    if (control.role === 'control_end_segment') {
      return {
        decoder: 'vdp_draw_segment_candidate',
        offset: hex(offset),
        endOffsetExclusive: hex(pc),
        consumedBytes: pc - offset,
        tileWordPairs,
        controlCount,
        fields,
      };
    }
  }
  return null;
}

function compactField(field) {
  return {
    role: field.role,
    range: range(field.start, field.endExclusive),
    stepIndex: field.stepIndex,
    fieldIndex: field.fieldIndex,
  };
}

function classifyWordAgainstFields(fields, occurrenceOffset) {
  const wordStart = parseHex(occurrenceOffset);
  const wordEnd = wordStart + 2;
  const overlapping = fields.filter(field => wordStart < field.endExclusive && wordEnd > field.start);
  if (!overlapping.length) {
    return {
      disposition: 'outside_decoded_candidate_fields',
      primaryRole: 'none',
      alignment: 'no_field_overlap',
      matchedFields: [],
    };
  }

  const single = overlapping.length === 1 ? overlapping[0] : null;
  if (single && wordStart === single.start && wordEnd === single.endExclusive) {
    return {
      disposition: single.role === 'initial_vdp_address_word'
        ? 'candidate_draw_setup_field_not_pointer_producer'
        : 'candidate_draw_payload_field_not_pointer_producer',
      primaryRole: single.role,
      alignment: 'exact_field_word',
      matchedFields: [compactField(single)],
    };
  }

  if (single && wordStart >= single.start && wordEnd <= single.endExclusive) {
    return {
      disposition: 'candidate_draw_field_subspan_not_pointer_producer',
      primaryRole: single.role,
      alignment: 'inside_single_field',
      matchedFields: [compactField(single)],
    };
  }

  return {
    disposition: 'candidate_draw_unaligned_cross_field_word_not_pointer_producer',
    primaryRole: overlapping.map(field => field.role).join('+'),
    alignment: 'crosses_decoded_fields',
    matchedFields: overlapping.slice(0, 4).map(compactField),
  };
}

function buildGapIndex(gapCatalog) {
  return new Map((gapCatalog.gaps || []).map(gap => [gap.id, gap]));
}

function buildLayoutGapIndex(layoutCatalog) {
  return new Map((layoutCatalog.gaps || []).map(gap => [`bank2_residual_gap_${gap.startOffset}`, gap]));
}

function sourceGapStart(occurrence) {
  return parseHex(occurrence.sourceResidualGap?.range?.startOffset || '');
}

function classifySourceOccurrence(rom, gapById, layoutGapById, occurrence) {
  const sourceGapId = occurrence.sourceResidualGap?.id || null;
  const sourceGap = sourceGapId ? gapById.get(sourceGapId) : null;
  const layoutGap = sourceGapId ? layoutGapById.get(sourceGapId) : null;
  const start = sourceGapStart(occurrence);
  if (!Number.isFinite(start) || !sourceGap) {
    return {
      occurrenceOffset: occurrence.occurrenceOffset,
      originalDisposition: occurrence.disposition,
      status: 'missing_source_gap_context',
      confidence: 'low',
    };
  }

  const decoded = decodeDrawFields(rom, start);
  if (!decoded) {
    return {
      occurrenceOffset: occurrence.occurrenceOffset,
      originalDisposition: occurrence.disposition,
      sourceGap: {
        id: sourceGapId,
        range: sourceGap.range,
        disposition: sourceGap.disposition,
        confidence: sourceGap.confidence,
      },
      status: 'source_gap_not_decodable_as_draw_candidate',
      confidence: 'low',
    };
  }

  const sourceGapEnd = parseHex(sourceGap.range?.endOffsetExclusive || '');
  const word = classifyWordAgainstFields(decoded.fields, occurrence.occurrenceOffset);
  const decodedEnd = parseHex(decoded.endOffsetExclusive);
  const candidateConsumesBeyondSourceGap = Number.isFinite(sourceGapEnd) && decodedEnd > sourceGapEnd;
  return {
    occurrenceOffset: occurrence.occurrenceOffset,
    originalDisposition: occurrence.disposition,
    status: word.disposition,
    confidence: candidateConsumesBeyondSourceGap ? 'low' : 'medium',
    wordSpan: range(parseHex(occurrence.occurrenceOffset), parseHex(occurrence.occurrenceOffset) + 2),
    alignment: word.alignment,
    primaryFieldRole: word.primaryRole,
    matchedFields: word.matchedFields,
    sourceGap: {
      id: sourceGapId,
      range: sourceGap.range,
      disposition: sourceGap.disposition,
      confidence: sourceGap.confidence,
      layoutClass: sourceGap.layoutClass,
      layoutConfidence: sourceGap.layoutConfidence,
    },
    sourceLayoutCandidate: layoutGap ? {
      class: layoutGap.class,
      confidence: layoutGap.confidence,
      consumedBytes: layoutGap.consumedBytes || null,
      candidateConsumedRange: layoutGap.candidateConsumedRange || null,
      candidateTailRange: layoutGap.candidateTailRange || null,
      candidateTailClassification: layoutGap.candidateTailClassification ? {
        class: layoutGap.candidateTailClassification.class,
        confidence: layoutGap.candidateTailClassification.confidence,
        decoder: layoutGap.candidateTailClassification.decoder,
        consumedRange: layoutGap.candidateTailClassification.consumedRange,
        residualRange: layoutGap.candidateTailClassification.residualRange,
      } : null,
    } : null,
    decodedCandidate: {
      decoder: decoded.decoder,
      offset: decoded.offset,
      endOffsetExclusive: decoded.endOffsetExclusive,
      consumedBytes: decoded.consumedBytes,
      tileWordPairs: decoded.tileWordPairs,
      controlCount: decoded.controlCount,
      consumesBeyondSourceGap: candidateConsumesBeyondSourceGap,
    },
    evidence: [
      'Field roles are decoded with the _LABEL_97D9_/_LABEL_9812_ VDP draw-segment grammar used by the bank-2 layout audit.',
      candidateConsumesBeyondSourceGap
        ? 'The source draw candidate runs beyond the residual gap, so it explains byte context but does not promote a confirmed segment boundary.'
        : 'The source draw candidate terminates inside the residual gap.',
    ],
  };
}

function targetDisposition(occurrences) {
  const explained = occurrences.filter(occurrence => occurrence.status.endsWith('_not_pointer_producer'));
  if (explained.length === occurrences.length) {
    return {
      disposition: 'intra_vdp_raw_hits_explained_as_candidate_draw_fields',
      confidence: occurrences.every(occurrence => occurrence.confidence === 'medium') ? 'medium' : 'low',
      reason: 'Every remaining intra-residual VDP raw word hit falls inside a decoded candidate draw-stream field; none is a confirmed pointer-list producer.',
    };
  }
  return {
    disposition: 'has_unexplained_intra_vdp_raw_hit',
    confidence: 'low',
    reason: 'At least one remaining intra-residual VDP raw word hit was not explained by the candidate draw-stream field decoder.',
  };
}

function buildCatalog(rom, mapData) {
  const sourceTriageCatalog = requireCatalog(mapData, sourceTriageCatalogId);
  const gapCatalog = requireCatalog(mapData, residualGapCatalogId);
  const layoutCatalog = requireCatalog(mapData, layoutCatalogId);
  const gapById = buildGapIndex(gapCatalog);
  const layoutGapById = buildLayoutGapIndex(layoutCatalog);
  const weakTargets = (sourceTriageCatalog.targets || [])
    .filter(target => target.triageDisposition === 'weak_structured_or_payload_leads_only');

  const targets = weakTargets.map(target => {
    const sourceOccurrences = (target.triagedOccurrenceSamples || [])
      .filter(occurrence => occurrence.disposition === 'unresolved_vdp_draw_payload_word_context')
      .map(occurrence => classifySourceOccurrence(rom, gapById, layoutGapById, occurrence));
    const classification = sourceOccurrences.length
      ? targetDisposition(sourceOccurrences)
      : {
        disposition: 'no_intra_vdp_occurrences_on_target',
        confidence: 'medium',
        reason: 'Source triage target has no remaining intra-residual VDP draw payload word contexts.',
      };
    return {
      id: target.id,
      parentGapId: target.parentGapId,
      parentGapRange: target.parentGapRange,
      targetOffset: target.targetOffset,
      targetKind: target.targetKind,
      boundaryKind: target.boundaryKind,
      sourceTriageDisposition: target.triageDisposition,
      intraVdpOccurrenceCount: sourceOccurrences.length,
      disposition: classification.disposition,
      confidence: classification.confidence,
      reason: classification.reason,
      sourceStatusCounts: countBy(sourceOccurrences, occurrence => occurrence.status),
      sourceAlignmentCounts: countBy(sourceOccurrences, occurrence => occurrence.alignment || 'none'),
      primaryFieldRoleCounts: countBy(sourceOccurrences, occurrence => occurrence.primaryFieldRole || 'none'),
      decodedSourceGapCounts: countBy(sourceOccurrences, occurrence => occurrence.sourceGap?.id || 'missing'),
      sourceCandidatesConsumingBeyondGap: sourceOccurrences.filter(occurrence => occurrence.decodedCandidate?.consumesBeyondSourceGap).length,
      sourceOccurrences,
    };
  });

  const allOccurrences = targets.flatMap(target => target.sourceOccurrences || []);
  const explained = allOccurrences.filter(occurrence => occurrence.status.endsWith('_not_pointer_producer'));
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceTriageCatalogId, residualGapCatalogId, layoutCatalogId],
    summary: {
      weakSourceTriageTargetCount: weakTargets.length,
      targetCount: targets.length,
      intraVdpOccurrenceCount: allOccurrences.length,
      fieldExplainedOccurrenceCount: explained.length,
      unexplainedOccurrenceCount: allOccurrences.length - explained.length,
      targetDispositionCounts: countBy(targets, target => target.disposition),
      sourceStatusCounts: countBy(allOccurrences, occurrence => occurrence.status),
      sourceAlignmentCounts: countBy(allOccurrences, occurrence => occurrence.alignment || 'none'),
      primaryFieldRoleCounts: countBy(allOccurrences, occurrence => occurrence.primaryFieldRole || 'none'),
      decodedSourceGapCounts: countBy(allOccurrences, occurrence => occurrence.sourceGap?.id || 'missing'),
      sourceCandidatesConsumingBeyondGap: allOccurrences.filter(occurrence => occurrence.decodedCandidate?.consumesBeyondSourceGap).length,
      confirmedPointerProducerOccurrenceCount: 0,
      assetPolicy: 'Metadata only: offsets, parser field roles, candidate ranges, counts, and evidence labels. No ROM bytes, decoded graphics, screenshots, hashes, or asset payloads are embedded.',
    },
    targets,
    evidence: [
      `${sourceTriageCatalogId} isolates the remaining weak leads to raw word hits inside unresolved bank-2 VDP draw residual gaps.`,
      `${layoutCatalogId} and ${residualGapCatalogId} classify the source gaps as low-confidence VDP draw-segment prefix candidates.`,
      'ASM _LABEL_97D9_/_LABEL_9812_ consumes VDP draw pointer-list targets as two-byte VDP setup words followed by tile-word pairs and control fields.',
      'This audit records parser field roles only; it does not store field values or decoded graphics.',
    ],
    nextLeads: [
      'Resolve why source candidates at 0x09F90 and 0x0A04C run beyond their residual gaps before promoting any child draw segments.',
      'Search for confirmed draw pointer-list entries targeting 0x0AC28, 0x0AC4A, 0x0ACBF, and 0x0AE3D; current field evidence is not producer evidence.',
      'Use field-aligned vs cross-field raw hits to deprioritize byte coincidences when classifying remaining bank-2 residual boundaries.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegionById(mapData, 'r0186');
  if (!region) {
    return { changedRegions: [], missingRegions: [{ id: 'r0186', role: 'bank2_vdp_residual_draw_field_context' }] };
  }
  if (apply) {
    region.analysis = region.analysis || {};
    region.analysis.bank2VdpResidualDrawFieldAudit = {
      catalogId,
      kind: 'bank2_vdp_residual_draw_field_context',
      confidence: catalog.summary.unexplainedOccurrenceCount === 0 ? 'low' : 'low',
      summary: 'Classifies remaining intra-residual VDP raw word hits as candidate draw-stream fields, not confirmed pointer-list producers.',
      detail: {
        weakSourceTriageTargetCount: catalog.summary.weakSourceTriageTargetCount,
        intraVdpOccurrenceCount: catalog.summary.intraVdpOccurrenceCount,
        fieldExplainedOccurrenceCount: catalog.summary.fieldExplainedOccurrenceCount,
        unexplainedOccurrenceCount: catalog.summary.unexplainedOccurrenceCount,
        targetDispositionCounts: catalog.summary.targetDispositionCounts,
        sourceStatusCounts: catalog.summary.sourceStatusCounts,
        sourceAlignmentCounts: catalog.summary.sourceAlignmentCounts,
        primaryFieldRoleCounts: catalog.summary.primaryFieldRoleCounts,
        decodedSourceGapCounts: catalog.summary.decodedSourceGapCounts,
        sourceCandidatesConsumingBeyondGap: catalog.summary.sourceCandidatesConsumingBeyondGap,
        confirmedPointerProducerOccurrenceCount: catalog.summary.confirmedPointerProducerOccurrenceCount,
      },
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
  }
  return {
    changedRegions: [{ id: region.id, offset: region.offset, type: region.type, name: region.name, inferredAnalysis: 'bank2VdpResidualDrawFieldAudit' }],
    missingRegions: [],
  };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.vdpStreamResidualDrawFieldCatalogs = (mapData.vdpStreamResidualDrawFieldCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpStreamResidualDrawFieldCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_residual_draw_field_audit',
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
