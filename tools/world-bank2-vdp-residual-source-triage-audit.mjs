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
const pointerContextCatalogId = 'world-bank2-vdp-residual-pointer-context-catalog-2026-06-26';
const catalogId = 'world-bank2-vdp-residual-source-triage-catalog-2026-06-26';
const reportId = 'bank2-vdp-residual-source-triage-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-residual-source-triage-audit.mjs';
const schemaVersion = 1;

const payloadLikeTypes = new Set(['gfx_tiles', 'music', 'entity_anim_script', 'palette_script']);

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

function sourceRegion(mapData, occurrence) {
  const id = occurrence.sourceRegion?.id;
  return id ? findRegionById(mapData, id) : null;
}

function regionRelativeOffset(region, occurrenceOffset) {
  if (!region) return null;
  return parseHex(occurrenceOffset) - parseHex(region.offset);
}

function classifyOccurrence(mapData, target, occurrence) {
  const region = sourceRegion(mapData, occurrence);
  const regionType = occurrence.sourceRegion?.type || '';
  const relativeOffset = regionRelativeOffset(region, occurrence.occurrenceOffset);

  if (
    occurrence.kind === 'rejected_state_candidate_pointer_field_to_target'
    || occurrence.kind === 'raw_word_inside_rejected_state_shape_gap'
    || occurrence.kind === 'pointer_list_candidate_only_rejected_state_path'
    || occurrence.kind === 'raw_word_inside_target_gap_payload'
  ) {
    return {
      disposition: 'rejected_candidate_or_self_context',
      strength: 'negative',
      confidence: 'medium',
      reason: 'Raw hit comes from a rejected state/pointer-list candidate path or from the target payload itself.',
    };
  }

  if (occurrence.occurrenceOffset === '0x00571' && region?.id === 'r1962') {
    return {
      disposition: 'code_branch_operand_overlap_not_pointer',
      strength: 'negative',
      confidence: 'high',
      reason: 'The word-shaped hit overlaps the relative branch operand in _LABEL_556_ and the following opcode; _LABEL_556_ is a VDP name-table clear routine, not a bank-2 pointer producer.',
      evidence: [
        'ASM lines 1614-1636 define _LABEL_556_ as a VDP background fill loop.',
        'The occurrence is inside region r1962, which bank0CoreRuntimeAudit identifies as name_table_clear_background.',
      ],
    };
  }

  if (regionType === 'entity_behavior_table') {
    const targetOffsets = region?.analysis?.entityBehaviorAudit?.detail?.targetOffsets || [];
    const isEntryAligned = relativeOffset != null && relativeOffset >= 0 && relativeOffset % 2 === 0;
    const targetIsBehaviorEntry = targetOffsets.includes(target.targetOffset);
    if (!isEntryAligned || !targetIsBehaviorEntry) {
      return {
        disposition: 'entity_behavior_table_cross_entry_or_non_target_overlap',
        strength: 'negative',
        confidence: 'high',
        reason: 'Source region is a confirmed entity behavior dispatch table; this word-shaped hit is not an aligned behavior-table entry targeting the residual bank-2 VDP boundary.',
      };
    }
    return {
      disposition: 'entity_behavior_table_entry_not_vdp_asset_pointer',
      strength: 'negative',
      confidence: 'high',
      reason: 'Source region is a confirmed entity behavior dispatch table for JP (HL), not a bank-2 VDP asset pointer table.',
    };
  }

  if (regionType === 'palette_script_table') {
    const isEntryAligned = relativeOffset != null && relativeOffset >= 0 && relativeOffset % 2 === 0;
    return {
      disposition: isEntryAligned ? 'palette_script_table_non_vdp_pointer_context' : 'palette_script_table_cross_entry_overlap',
      strength: isEntryAligned ? 'weak_lead' : 'negative',
      confidence: isEntryAligned ? 'low' : 'medium',
      reason: isEntryAligned
        ? 'Source is a palette script table, not a known bank-2 VDP draw/object pointer producer.'
        : 'Word-shaped hit is not aligned to the two-byte palette table entry grid.',
    };
  }

  if (payloadLikeTypes.has(regionType)) {
    return {
      disposition: 'payload_like_byte_coincidence',
      strength: 'negative',
      confidence: 'medium',
      reason: `Source region type ${regionType} is payload-like data; raw word coincidence is not pointer evidence without a parser field.`,
    };
  }

  if (occurrence.kind === 'raw_word_inside_unresolved_vdp_draw_residual_gap') {
    return {
      disposition: 'unresolved_vdp_draw_payload_word_context',
      strength: 'weak_lead',
      confidence: 'low',
      reason: 'Raw hit is inside another unresolved VDP draw residual payload; it is not a confirmed pointer-list field.',
    };
  }

  if (regionType === 'screen_prog' && region?.analysis?.screenProgAudit) {
    return {
      disposition: 'screen_prog_bytecode_payload_overlap_not_pointer',
      strength: 'negative',
      confidence: 'medium',
      reason: 'Source region is decoded by the _LABEL_604_ screen-program bytecode model; no current catalog identifies this offset as a bank-2 VDP object/draw pointer field.',
      evidence: [
        `${region.id} has screenProgAudit from ${region.analysis.screenProgAudit.catalogId}.`,
        `Screen program visited range starts at ${region.analysis.screenProgAudit.visitedRange?.start || region.offset}.`,
      ],
    };
  }

  if (
    regionType === 'entity_data'
    && (region?.analysis?.roomEntityListAudit || region?.analysis?.roomEntityOrphanListAudit)
  ) {
    const audit = region.analysis.roomEntityOrphanListAudit || region.analysis.roomEntityListAudit;
    return {
      disposition: 'room_entity_source_list_payload_overlap_not_pointer',
      strength: 'negative',
      confidence: audit.confidence === 'high' ? 'high' : 'medium',
      reason: 'Source region is decoded as room entity source-list data by the confirmed _LABEL_2948_/_LABEL_2963_ parser, not as a bank-2 VDP pointer producer.',
      evidence: [
        `${region.id} has ${region.analysis.roomEntityOrphanListAudit ? 'roomEntityOrphanListAudit' : 'roomEntityListAudit'} from ${audit.catalogId}.`,
      ],
    };
  }

  if (regionType === 'screen_prog' || regionType === 'entity_data') {
    return {
      disposition: 'structured_non_vdp_pointer_lead',
      strength: 'weak_lead',
      confidence: 'low',
      reason: `Source region type ${regionType} is structured, but no current catalog identifies this offset as a bank-2 VDP pointer field.`,
    };
  }

  return {
    disposition: 'unclassified_raw_word_lead',
    strength: 'weak_lead',
    confidence: 'low',
    reason: 'Raw hit remains a context lead with no confirmed pointer-field evidence.',
  };
}

function classifyTarget(triagedOccurrences) {
  const strengthCounts = countBy(triagedOccurrences, item => item.strength);
  if ((strengthCounts.strong || 0) > 0) {
    return {
      disposition: 'has_strong_source_evidence',
      confidence: 'high',
      reason: 'At least one source occurrence is a confirmed producer.',
    };
  }
  if ((strengthCounts.weak_lead || 0) > 0) {
    return {
      disposition: 'weak_structured_or_payload_leads_only',
      confidence: 'low',
      reason: 'No confirmed producer remains after source triage; remaining hits are weak structured/payload leads.',
    };
  }
  return {
    disposition: 'all_raw_hits_disqualified_as_pointer_evidence',
    confidence: 'medium',
    reason: 'Every raw hit is explained as rejected, self, payload-like, cross-entry, or code-overlap context.',
  };
}

function buildCatalog(mapData) {
  const pointerCatalog = requireCatalog(mapData, pointerContextCatalogId);
  const targets = (pointerCatalog.targets || []).map(target => {
    const triagedOccurrences = (target.occurrenceSamples || []).map(occurrence => ({
      occurrenceOffset: occurrence.occurrenceOffset,
      originalKind: occurrence.kind,
      sourceRegion: occurrence.sourceRegion,
      sourceResidualGap: occurrence.sourceResidualGap,
      ...classifyOccurrence(mapData, target, occurrence),
    }));
    const classification = classifyTarget(triagedOccurrences);
    return {
      id: target.id,
      parentGapId: target.parentGapId,
      parentGapRange: target.parentGapRange,
      targetOffset: target.targetOffset,
      targetKind: target.targetKind,
      boundaryKind: target.boundaryKind,
      pointerContextDisposition: target.disposition,
      rawOccurrenceCount: target.rawOccurrenceCount,
      triageDisposition: classification.disposition,
      confidence: classification.confidence,
      reason: classification.reason,
      sourceDispositionCounts: countBy(triagedOccurrences, occurrence => occurrence.disposition),
      sourceStrengthCounts: countBy(triagedOccurrences, occurrence => occurrence.strength),
      triagedOccurrenceSamples: triagedOccurrences.slice(0, 24),
    };
  });
  const targetDispositions = countBy(targets, target => target.triageDisposition);
  const allOccurrences = targets.flatMap(target => target.triagedOccurrenceSamples || []);
  const weakTargets = targets.filter(target => target.triageDisposition === 'weak_structured_or_payload_leads_only');

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [pointerContextCatalogId],
    summary: {
      targetBoundaryCount: targets.length,
      rawOccurrenceCount: sumBy(targets, target => target.rawOccurrenceCount || 0),
      targetTriageDispositionCounts: targetDispositions,
      sourceDispositionCounts: countBy(allOccurrences, occurrence => occurrence.disposition),
      sourceStrengthCounts: countBy(allOccurrences, occurrence => occurrence.strength),
      disqualifiedTargetCount: targets.filter(target => target.triageDisposition === 'all_raw_hits_disqualified_as_pointer_evidence').length,
      weakLeadTargetCount: weakTargets.length,
      strongEvidenceTargetCount: targets.filter(target => target.triageDisposition === 'has_strong_source_evidence').length,
      weakLeadSourceTypeCounts: countBy(
        weakTargets.flatMap(target => target.triagedOccurrenceSamples || []).filter(occurrence => occurrence.strength === 'weak_lead'),
        occurrence => occurrence.sourceRegion?.type || 'unknown',
      ),
      assetPolicy: 'Metadata only: source offsets, target offsets, region ids/types, triage classes, counts, and evidence labels. No ROM bytes, decoded graphics, screenshots, hashes, or asset payloads are embedded.',
    },
    targets,
    evidence: [
      `${pointerContextCatalogId} supplies raw pointer-word occurrences for actionable bank-2 VDP residual boundaries.`,
      'Existing source-region audits identify entity behavior tables, bank0 _LABEL_556_ code, screen programs, entity data, music, graphics, and palette data contexts.',
      'This audit demotes raw word hits unless a confirmed pointer-field producer is present.',
    ],
    nextLeads: [
      'For weak structured leads in screen_prog/entity_data, inspect the domain parser field at the occurrence offset before considering promotion.',
      'For intra-residual VDP draw payload words, resolve draw segment boundaries instead of treating the words as producers.',
      'Keep residual boundaries without strong source evidence out of confirmed child regions.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = findRegionById(mapData, 'r0186');
  if (!region) {
    return { changedRegions: [], missingRegions: [{ id: 'r0186', role: 'bank2_vdp_residual_source_triage' }] };
  }
  if (apply) {
    region.analysis = region.analysis || {};
    region.analysis.bank2VdpResidualSourceTriageAudit = {
      catalogId,
      kind: 'bank2_vdp_residual_source_triage',
      confidence: catalog.summary.strongEvidenceTargetCount > 0 ? 'medium' : 'low',
      summary: 'Triage of raw pointer-word source contexts for actionable bank-2 VDP residual boundaries.',
      detail: {
        targetBoundaryCount: catalog.summary.targetBoundaryCount,
        rawOccurrenceCount: catalog.summary.rawOccurrenceCount,
        targetTriageDispositionCounts: catalog.summary.targetTriageDispositionCounts,
        sourceDispositionCounts: catalog.summary.sourceDispositionCounts,
        sourceStrengthCounts: catalog.summary.sourceStrengthCounts,
        disqualifiedTargetCount: catalog.summary.disqualifiedTargetCount,
        weakLeadTargetCount: catalog.summary.weakLeadTargetCount,
        strongEvidenceTargetCount: catalog.summary.strongEvidenceTargetCount,
        weakLeadSourceTypeCounts: catalog.summary.weakLeadSourceTypeCounts,
      },
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
  }
  return {
    changedRegions: [{ id: region.id, offset: region.offset, type: region.type, name: region.name, inferredAnalysis: 'bank2VdpResidualSourceTriageAudit' }],
    missingRegions: [],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);
  if (apply) {
    mapData.vdpStreamResidualSourceTriageCatalogs = (mapData.vdpStreamResidualSourceTriageCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpStreamResidualSourceTriageCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_residual_source_triage_audit',
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
