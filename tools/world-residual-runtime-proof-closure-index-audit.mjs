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
const toolName = 'tools/world-residual-runtime-proof-closure-index-audit.mjs';
const catalogId = 'world-residual-runtime-proof-closure-index-catalog-2026-06-26';
const reportId = 'residual-runtime-proof-closure-index-audit-2026-06-26';

const targetRegionIds = ['r2813', 'r2815', 'r2816', 'r2817', 'r0749'];

const sourceCatalogs = [
  'world-low-confidence-residual-triage-catalog-2026-06-26',
  'world-residual-proof-consumer-catalog-2026-06-26',
  'world-room-overlay-tail-static-bound-proof-catalog-2026-06-26',
  'world-palette-tail-static-consumer-consolidation-catalog-2026-06-26',
  'world-bank7-sidecar-alias-proof-catalog-2026-06-26',
];

const staticExclusionKeys = [
  'roomOverlayTailStaticBoundProofAudit',
  'paletteTailStaticConsumerConsolidationAudit',
  'paletteTailScreenProgWordShapeAudit',
  'paletteTailLoaderWordShapeAudit',
  'paletteTailNonPaletteConsumerAudit',
  'bank7SidecarAliasProofAudit',
  'graphicsLoaderCandidateConsumerAudit',
  'roomOverlayTailRefinementAudit',
  'paletteTailConsumerAudit',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item?.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegion(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
    confidence: region.confidence || null,
  };
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

function collectStaticProofs(region) {
  const proofs = [];
  const analysis = region?.analysis || {};
  for (const key of staticExclusionKeys) {
    const audit = analysis[key];
    if (!audit) continue;
    proofs.push({
      key,
      kind: audit.kind || '',
      status: audit.status || '',
      confidence: audit.confidence || '',
      catalogId: audit.catalogId || '',
      summary: audit.summary || '',
    });
  }
  return proofs;
}

function triageFor(region) {
  const triage = region?.analysis?.lowConfidenceResidualTriageAudit || {};
  return {
    classId: triage.classId || triage.kind || 'unknown_residual_class',
    status: triage.status || '',
    handling: triage.handling || '',
    semanticConfidence: triage.semanticConfidence || 'low',
    rangeConfidence: triage.rangeConfidence || '',
    requiredNextTrace: triage.requiredNextTrace || '',
    proofPlan: triage.proofPlan || {},
  };
}

function residualProofFor(region) {
  const audit = region?.analysis?.residualProofConsumerAudit || {};
  return {
    confidence: audit.confidence || '',
    promotionAllowed: audit.promotionAllowed === true,
    directConsumerCount: audit.directConsumerCount || audit.detail?.directConsumerCount || 0,
    summary: audit.summary || '',
    catalogId: audit.catalogId || '',
  };
}

function entryFor(region) {
  const triage = triageFor(region);
  const residualProof = residualProofFor(region);
  const staticProofs = collectStaticProofs(region);
  const proofPlan = triage.proofPlan || {};
  const staticExclusionComplete = staticProofs.length > 0 && residualProof.promotionAllowed !== true;
  const runtimeGateKnown = Boolean(proofPlan.traceKind && proofPlan.requiredProof);

  return {
    region: compactRegion(region),
    classId: triage.classId,
    quarantineStatus: triage.status || 'quarantined_runtime_proof_required',
    closureStatus: staticExclusionComplete && runtimeGateKnown
      ? 'closed_static_queue_runtime_proof_required'
      : 'closure_needs_review',
    defaultDecoderExcluded: staticExclusionComplete,
    semanticConfidence: 'low',
    staticAbsenceConfidence: staticProofs.some(proof => String(proof.confidence).startsWith('high'))
      ? 'high_for_current_static_sources'
      : 'medium_for_current_static_sources',
    promotionReady: false,
    promotionBlockedBy: runtimeGateKnown
      ? 'missing_runtime_consumer_or_selector_trace'
      : 'missing_explicit_runtime_gate',
    runtimeGate: {
      traceKind: proofPlan.traceKind || 'manual_runtime_consumer_trace',
      watchLabels: proofPlan.watchLabels || [],
      candidateConsumer: proofPlan.candidateConsumer || '',
      requiredProof: proofPlan.requiredProof || '',
      promotionIfConfirmed: proofPlan.promotionIfConfirmed || '',
      keepQuarantinedIfMissing: proofPlan.keepQuarantinedIfMissing || '',
      blockers: proofPlan.blockers || [],
    },
    residualProof,
    staticProofs,
    evidence: [
      `lowConfidenceResidualTriageAudit classifies ${region.id} as ${triage.classId} and keeps semantic confidence low.`,
      staticProofs.length
        ? `Static exclusion audit(s) present: ${staticProofs.map(proof => proof.key).join(', ')}.`
        : 'No static exclusion proof audit was found for this residual.',
      residualProof.promotionAllowed
        ? 'A residual proof audit currently allows promotion; this entry needs review.'
        : 'Residual proof audit does not allow semantic promotion from current static evidence.',
      runtimeGateKnown
        ? `Promotion requires runtime proof gate: ${proofPlan.traceKind}.`
        : 'No explicit runtime gate was found; manual trace planning is still required.',
    ],
  };
}

function buildCatalog(mapData) {
  for (const id of sourceCatalogs) requireCatalog(mapData, id);

  const entries = targetRegionIds.map(id => {
    const region = findRegion(mapData, id);
    if (!region) {
      return {
        region: { id },
        classId: 'missing_region',
        quarantineStatus: 'missing_region',
        closureStatus: 'closure_needs_review',
        defaultDecoderExcluded: false,
        semanticConfidence: 'unknown',
        staticAbsenceConfidence: 'unknown',
        promotionReady: false,
        promotionBlockedBy: 'missing_region',
        runtimeGate: {},
        residualProof: {},
        staticProofs: [],
        evidence: [`Region ${id} is missing from map.json.`],
      };
    }
    return entryFor(region);
  });

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: residual region ids, offsets, sizes, quarantine statuses, audit keys, runtime-gate labels, proof statuses, and counts. No ROM bytes, decoded graphics, tile ids, palette values, audio payloads, pixels, screenshots, hashes, instruction bytes, or register traces are embedded.',
    summary: {
      residualCount: entries.length,
      closedStaticQueueCount: entries.filter(entry => entry.closureStatus === 'closed_static_queue_runtime_proof_required').length,
      closureNeedsReviewCount: entries.filter(entry => entry.closureStatus !== 'closed_static_queue_runtime_proof_required').length,
      defaultDecoderExcludedCount: entries.filter(entry => entry.defaultDecoderExcluded).length,
      runtimeProofRequiredCount: entries.filter(entry => entry.promotionBlockedBy === 'missing_runtime_consumer_or_selector_trace').length,
      promotionReadyCount: entries.filter(entry => entry.promotionReady).length,
      semanticLowConfidenceCount: entries.filter(entry => entry.semanticConfidence === 'low').length,
      classCounts: countBy(entries, entry => entry.classId),
      traceKindCounts: countBy(entries, entry => entry.runtimeGate?.traceKind),
      staticProofKeyCounts: countBy(entries.flatMap(entry => entry.staticProofs), proof => proof.key),
      persistedRomByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    entries,
    evidence: [
      'The residual closure index combines the existing low-confidence triage, residual consumer proof, room-overlay tail proof, palette-tail static consolidation, and bank-7 alias proof catalogs.',
      'It does not promote semantic types; it marks the static queue closed only where a concrete runtime proof gate is recorded.',
      'Default decoders should skip these residuals unless their runtime gate is satisfied by future trace evidence.',
    ],
    nextLeads: [
      'Implement metadata-only runtime trace hooks for _RAM_CF64_ overlay index selection, _DATA_1CBB9_/_DATA_1CBC0_/_DATA_1CBD0_ same-bank consumers, and _DATA_1E337_ direct bank-7 consumers.',
      'Keep these five residuals visible in analyzer coverage summaries as runtime-proof-blocked, not as loose unmapped assets.',
      'After any gate is satisfied, update the region-specific proof catalog before changing type or confidence.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const entry of catalog.entries) {
    const region = findRegion(mapData, entry.region?.id);
    if (!region) {
      missingRegions.push({ id: entry.region?.id, role: 'residual_runtime_proof_closure_target' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.residualRuntimeProofClosureIndexAudit = {
      catalogId,
      kind: 'residual_runtime_proof_closure_index',
      closureStatus: entry.closureStatus,
      quarantineStatus: entry.quarantineStatus,
      confidence: entry.staticAbsenceConfidence,
      semanticConfidence: entry.semanticConfidence,
      defaultDecoderExcluded: entry.defaultDecoderExcluded,
      promotionReady: entry.promotionReady,
      promotionBlockedBy: entry.promotionBlockedBy,
      runtimeGate: entry.runtimeGate,
      staticProofKeys: entry.staticProofs.map(proof => proof.key),
      summary: 'Residual is closed for current static decoder queues and remains blocked on the recorded runtime proof gate before semantic promotion.',
      evidence: entry.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (region.analysis.lowConfidenceResidualTriageAudit) {
      region.analysis.lowConfidenceResidualTriageAudit.runtimeProofClosureCatalogId = catalogId;
      region.analysis.lowConfidenceResidualTriageAudit.runtimeProofClosureStatus = entry.closureStatus;
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      closureStatus: entry.closureStatus,
      defaultDecoderExcluded: entry.defaultDecoderExcluded,
      runtimeTraceKind: entry.runtimeGate?.traceKind || null,
    });
  }

  mapData.residualClosureCatalogs = (mapData.residualClosureCatalogs || []).filter(item => item.id !== catalogId);
  mapData.residualClosureCatalogs.push(catalog);

  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    generatedAt: now,
    tool: toolName,
    schemaVersion: 1,
    catalogId,
    summary: {
      ...catalog.summary,
      changedRegionCount: changedRegions.length,
      missingRegionCount: missingRegions.length,
    },
    changedRegions,
    missingRegions,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
    assetPolicy: catalog.assetPolicy,
  });

  mapData.updatedAt = now;
  return { changedRegions, missingRegions };
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.residualRuntimeProofClosureCatalog = catalogId;
  staticMap.summary.residualRuntimeProofClosureCount = catalog.summary.residualCount;
  staticMap.summary.residualRuntimeProofClosedStaticQueue = catalog.summary.closedStaticQueueCount;
  staticMap.summary.residualRuntimeProofDefaultDecoderExcluded = catalog.summary.defaultDecoderExcludedCount;
  staticMap.summary.residualRuntimeProofRequired = catalog.summary.runtimeProofRequiredCount;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-residual-runtime-proof-closure-index-catalog-2026-06-26 to show r2813, r2815-r2817, and r0749 as runtime-proof-blocked residuals excluded from default decoders.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let result = { changedRegions: [], missingRegions: [] };
  if (apply) {
    result = applyCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    changedRegions: result.changedRegions,
    missingRegions: result.missingRegions,
  }, null, 2));
}

main();
