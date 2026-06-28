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
const catalogId = 'world-asm-false-split-label-catalog-2026-06-25';
const reportId = 'asm-false-split-label-audit-2026-06-25';
const toolName = 'tools/world-asm-false-split-label-audit.mjs';
const sourceCatalogId = 'world-asm-data-label-census-catalog-2026-06-25';

const streamTypes = new Set([
  'music',
  'screen_prog',
  'vdp_stream',
  'audio_driver_data',
  'vram_loader_8fb',
  'vram_loader_998',
  'entity_anim_script',
  'input_script',
  'palette_script',
  'effect_script',
]);

const evidenceKeysByType = {
  music: [
    'audioStreamGraphAudit',
    'audioOpcodeStateEffectAudit',
    'audioStreamRoutineAudit',
    'audioRequestTaxonomyAudit',
    'asmDataLabelCensusAudit',
  ],
  screen_prog: [
    'screenProgAudit',
    'screenProgReachabilityAudit',
    'screenProgTableAudit',
    'zoneRenderProvenanceAudit',
    'inlineTransitionRenderProvenanceAudit',
    'asmDataLabelCensusAudit',
  ],
};

function pointerPromotionDecision(status) {
  if (status === 'confirmed_false_split_label') {
    return {
      action: 'reject_standalone_pointer_table_promotion',
      preserveAs: 'nested_label_in_enclosing_stream',
      reason: 'The label is nested inside an already mapped stream-like region; future pointer-table scans should treat word-shaped directives here as stream payload context unless a direct consumer proves otherwise.',
    };
  }
  return {
    action: 'manual_review_before_pointer_promotion',
    preserveAs: 'candidate_label_pending_review',
    reason: 'The label was flagged by the data-label census but was not confirmed as a nested stream-like split label.',
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findCatalog(mapData, id) {
  const buckets = Object.keys(mapData)
    .filter(key => Array.isArray(mapData[key]) && /catalog/i.test(key))
    .flatMap(key => mapData[key]);
  return buckets.find(item => item?.id === id) || null;
}

function findRegion(mapData, ref) {
  if (!ref?.id) return null;
  return (mapData.regions || []).find(region => region.id === ref.id) || null;
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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function compactEvidenceRef(region, key) {
  const audit = region?.analysis?.[key];
  if (!audit) return null;
  return {
    analysisKey: key,
    catalogId: audit.catalogId || null,
    kind: audit.kind || audit.role || null,
    confidence: audit.confidence || null,
    summary: audit.summary || '',
    evidence: Array.isArray(audit.evidence) ? audit.evidence.slice(0, 3) : [],
  };
}

function collectEvidenceRefs(region) {
  const type = region?.type || 'unknown';
  const preferred = evidenceKeysByType[type] || ['asmDataLabelCensusAudit'];
  const refs = preferred.map(key => compactEvidenceRef(region, key)).filter(Boolean);
  for (const key of Object.keys(region?.analysis || {}).sort()) {
    if (preferred.includes(key)) continue;
    if (!/audit/i.test(key)) continue;
    const ref = compactEvidenceRef(region, key);
    if (ref) refs.push(ref);
  }
  return refs.slice(0, 8);
}

function buildEntry(mapData, candidate) {
  const region = findRegion(mapData, candidate.region);
  const regionStart = region ? offsetOf(region) : null;
  const candidateOffset = parseInt(candidate.offset, 16);
  const offsetWithinRegion = regionStart == null ? null : candidateOffset - regionStart;
  const isNested = Boolean(region && offsetWithinRegion > 0 && offsetWithinRegion < (region.size || 0));
  const streamLike = Boolean(region && streamTypes.has(region.type || 'unknown'));
  const status = isNested && streamLike ? 'confirmed_false_split_label' : 'needs_manual_review';
  const pointerDecision = pointerPromotionDecision(status);
  return {
    label: candidate.label,
    offset: candidate.offset,
    approxSize: candidate.approxSize,
    directiveCounts: candidate.directiveCounts,
    region: regionRef(region),
    offsetWithinRegion,
    status,
    confidence: status === 'confirmed_false_split_label' ? 'high' : 'medium',
    classification: {
      kind: status,
      keepAsNestedLabel: status === 'confirmed_false_split_label',
      shouldCreateStandaloneRegion: false,
      pointerPromotionAction: pointerDecision.action,
      reason: status === 'confirmed_false_split_label'
        ? 'The ASM label starts inside an existing stream-like mapped region, so its directives are treated as a disassembler split view of the enclosing byte stream.'
        : 'The label was flagged by the census but its mapped region was not a nested stream-like region.',
    },
    pointerPromotionDecision: pointerDecision,
    sourceCatalogLead: {
      incomingRefCount: candidate.incomingRefCount,
      outgoingLabelCount: candidate.outgoingLabelCount,
      flags: candidate.flags,
    },
    evidenceRefs: collectEvidenceRefs(region),
    evidence: [
      `${candidate.label} starts at ${candidate.offset}, inside mapped region ${region?.id || 'unmapped'} at offset ${offsetWithinRegion == null ? 'unknown' : offsetWithinRegion}.`,
      region
        ? `The enclosing region is typed ${region.type || 'unknown'} and remains the authoritative stream region.`
        : 'No enclosing region was found.',
      'The source ASM data-label census flagged this as a false .dw/split candidate; this audit records that resolution without changing bytes or region boundaries.',
    ],
  };
}

function buildCatalog(mapData) {
  const sourceCatalog = findCatalog(mapData, sourceCatalogId);
  const validationIssues = [];
  if (!sourceCatalog) validationIssues.push(`Missing source catalog ${sourceCatalogId}.`);
  const entries = (sourceCatalog?.leads?.falseDwOrSplitCandidates || []).map(candidate => buildEntry(mapData, candidate));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalog: sourceCatalogId,
    summary: {
      candidateCount: entries.length,
      confirmedFalseSplitLabels: entries.filter(entry => entry.status === 'confirmed_false_split_label').length,
      needsManualReview: entries.filter(entry => entry.status === 'needs_manual_review').length,
      rejectedStandalonePointerPromotions: entries.filter(entry => entry.pointerPromotionDecision.action === 'reject_standalone_pointer_table_promotion').length,
      manualReviewBeforePointerPromotion: entries.filter(entry => entry.pointerPromotionDecision.action === 'manual_review_before_pointer_promotion').length,
      byRegionType: countBy(entries, entry => entry.region?.type || 'unmapped'),
      byStatus: countBy(entries, entry => entry.status),
      byPointerPromotionAction: countBy(entries, entry => entry.pointerPromotionDecision.action),
      assetPolicy: 'Metadata only: ASM labels, offsets, region ids/types, directive counts, and audit references. No ROM bytes, decoded graphics, music, text, or asset payloads are embedded.',
    },
    entries,
    rejectedPointerTablePromotions: entries
      .filter(entry => entry.pointerPromotionDecision.action === 'reject_standalone_pointer_table_promotion')
      .map(entry => ({
        label: entry.label,
        offset: entry.offset,
        enclosingRegion: entry.region,
        offsetWithinRegion: entry.offsetWithinRegion,
        action: entry.pointerPromotionDecision.action,
        preserveAs: entry.pointerPromotionDecision.preserveAs,
        reason: entry.pointerPromotionDecision.reason,
        confidence: entry.confidence,
      })),
    validationIssues: [
      ...validationIssues,
      ...entries.filter(entry => !entry.region).map(entry => `No mapped region covers ${entry.label} at ${entry.offset}.`),
      ...entries.filter(entry => entry.status === 'needs_manual_review').map(entry => `${entry.label} needs manual review because it is not a nested stream-like label.`),
    ],
    evidence: [
      'The source candidates come from world-asm-data-label-census-catalog-2026-06-25.',
      'Only labels nested inside stream-like mapped regions are confirmed as false split labels.',
      'Confirmed false split labels are kept as metadata on the enclosing stream region; no standalone region is created.',
    ],
  };
}

function annotateRegions(mapData, catalog) {
  const byRegionId = new Map();
  for (const entry of catalog.entries) {
    if (!entry.region) continue;
    if (!byRegionId.has(entry.region.id)) byRegionId.set(entry.region.id, []);
    byRegionId.get(entry.region.id).push(entry);
  }
  const annotatedRegions = [];
  for (const [regionId, entries] of byRegionId.entries()) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.asmFalseSplitLabelAudit = {
      catalogId,
      kind: 'nested_stream_split_label_resolution',
      confidence: entries.every(entry => entry.status === 'confirmed_false_split_label') ? 'high' : 'medium',
      summary: 'Nested ASM data labels inside this stream-like region are recorded as split-label metadata, not standalone ROM regions or pointer tables.',
      labels: entries.map(entry => ({
        label: entry.label,
        offset: entry.offset,
        offsetWithinRegion: entry.offsetWithinRegion,
        directiveCounts: entry.directiveCounts,
        status: entry.status,
        confidence: entry.confidence,
        pointerPromotionAction: entry.pointerPromotionDecision.action,
        preserveAs: entry.pointerPromotionDecision.preserveAs,
      })),
      rejectedPointerTablePromotions: entries
        .filter(entry => entry.pointerPromotionDecision.action === 'reject_standalone_pointer_table_promotion')
        .map(entry => ({
          label: entry.label,
          offset: entry.offset,
          offsetWithinRegion: entry.offsetWithinRegion,
          reason: entry.pointerPromotionDecision.reason,
        })),
      evidenceRefs: entries.flatMap(entry => entry.evidenceRefs).slice(0, 12),
      evidence: entries.flatMap(entry => entry.evidence),
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      labelCount: entries.length,
      statuses: countBy(entries, entry => entry.status),
    });
  }
  return annotatedRegions;
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotatedRegions = apply ? annotateRegions(mapData, catalog) : [];

  if (apply) {
    mapData.asmDataLabelCatalogs = (mapData.asmDataLabelCatalogs || []).filter(item => item.id !== catalogId);
    mapData.asmDataLabelCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'asm_false_split_label_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      sourceCatalog: sourceCatalogId,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
      validationIssues: catalog.validationIssues,
      annotatedRegions,
      nextLeads: [
        'Teach future pointer-table scans to consult asmFalseSplitLabelAudit before promoting nested .dw-like labels.',
        'For music-region split labels, pair this metadata with the audio stream graph before implementing a PSG stream player.',
        'For screen_prog split labels, keep rendering from the enclosing stream recipe rather than from the nested ASM label boundary.',
      ],
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
    entries: catalog.entries.map(entry => ({
      label: entry.label,
      region: entry.region,
      offsetWithinRegion: entry.offsetWithinRegion,
      status: entry.status,
      confidence: entry.confidence,
      pointerPromotionAction: entry.pointerPromotionDecision.action,
    })),
  }, null, 2));
}

main();
