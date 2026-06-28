#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-blank-metasprite-quarantine-proof-audit.mjs';
const catalogId = 'world-blank-metasprite-quarantine-proof-catalog-2026-06-26';
const reportId = 'blank-metasprite-quarantine-proof-audit-2026-06-26';

const target = {
  regionId: 'r0792',
  label: '_DATA_19B01_',
  tableLabel: '_DATA_1071A_',
  tableOffset: '0x1071A',
  tableIndex: 0,
  indexSymbol: '_RAM_C34E_',
};

const sourceCatalogs = [
  'world-blank-metasprite-target-catalog-2026-06-26',
  'world-c34e-metasprite-family-catalog-2026-06-24',
  'world-quarantined-metasprite-confidence-backfill-catalog-2026-06-26',
  'world-asm-incbin-span-catalog-2026-06-25',
  'world-asm-data-label-census-catalog-2026-06-25',
  'world-asm-label-region-catalog-2026-06-25',
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

function stripComment(line) {
  return line.split(';')[0].trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asmLines(asmText) {
  return asmText.split(/\r?\n/).map((text, index) => ({
    line: index + 1,
    text,
    code: stripComment(text),
  }));
}

function labelDefinitions(lines, label) {
  const colon = new RegExp(`^${escapeRegExp(label)}\\s*:`);
  return lines
    .filter(item => colon.test(item.code))
    .map(item => ({ line: item.line, kind: 'definition' }));
}

function codeReferences(lines, symbol) {
  const token = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(symbol)}([^A-Za-z0-9_]|$)`);
  const defLines = new Set(labelDefinitions(lines, symbol).map(item => item.line));
  return lines
    .filter(item => item.code && token.test(item.code) && !defLines.has(item.line))
    .map(item => ({ line: item.line, code: item.code }));
}

function commentReferences(lines, symbol) {
  const token = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(symbol)}([^A-Za-z0-9_]|$)`);
  return lines
    .filter(item => {
      const comment = item.text.includes(';') ? item.text.slice(item.text.indexOf(';') + 1) : '';
      return token.test(comment);
    })
    .map(item => ({ line: item.line, kind: 'comment_reference' }));
}

function analysisKeyPresent(region, key) {
  return Boolean(region?.analysis?.[key]);
}

function buildCatalog(mapData, asmText) {
  for (const id of sourceCatalogs) requireCatalog(mapData, id);

  const region = findRegion(mapData, target.regionId);
  const lines = asmLines(asmText);
  const blank = region?.analysis?.blankMetaspriteTargetAudit || null;
  const c34e = region?.analysis?.c34eMetaspriteFamilyAudit || null;
  const staleScreen = region?.analysis?.staleScreenProgMetadataAudit || null;
  const asmIncbin = region?.analysis?.asmIncbinSpanAudit || null;
  const quarantined = region?.analysis?.quarantinedMetaspriteConfidenceBackfillAudit || null;
  const tableDefinitions = labelDefinitions(lines, target.tableLabel);
  const targetDefinitions = labelDefinitions(lines, target.label);
  const tableCodeReferences = codeReferences(lines, target.tableLabel);
  const targetCodeReferences = codeReferences(lines, target.label);
  const indexCodeReferences = codeReferences(lines, target.indexSymbol);
  const indexCommentReferences = commentReferences(lines, target.indexSymbol);

  const proofChecks = {
    regionExists: Boolean(region),
    isMetaSprite: region?.type === 'meta_sprite',
    blankAuditPresent: Boolean(blank),
    allZeroFromPriorAudit: blank?.allZero === true,
    c34eRolePresent: Array.isArray(blank?.roles) && blank.roles.includes('c34e_pointer_table_blank_target'),
    c34eTargetMatches: Boolean(
      c34e &&
      c34e.tableOffset === target.tableOffset &&
      c34e.tableIndex === target.tableIndex &&
      c34e.expression === target.label
    ),
    staleScreenProgRemoved: Boolean(staleScreen),
    incbinSpanModeled: Boolean(asmIncbin),
    tableDefinitionPresent: tableDefinitions.length === 1,
    targetDefinitionPresent: targetDefinitions.length === 1,
    noExecutableIndexReferences: indexCodeReferences.length === 0,
  };

  const proofComplete = Object.entries(proofChecks)
    .filter(([key]) => key !== 'noExecutableIndexReferences')
    .every(([, value]) => value === true);

  const status = proofComplete
    ? 'high_confidence_quarantined_blank_c34e_target_default_decoders_excluded'
    : 'blank_c34e_target_quarantine_needs_review';

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: labels, offsets, region ids, prior audit keys, proof booleans, reference counts, confidence changes, and decoder policy. No ROM bytes, aggregate payload dumps, decoded sprites, pixels, screenshots, instruction bytes, text payloads, audio payloads, or hashes are embedded.',
    target: {
      region: compactRegion(region),
      label: target.label,
      tableLabel: target.tableLabel,
      tableOffset: target.tableOffset,
      tableIndex: target.tableIndex,
      indexSymbol: target.indexSymbol,
    },
    summary: {
      status,
      proofComplete,
      topLevelConfidenceBefore: region?.confidence || null,
      topLevelConfidenceAfter: proofComplete ? 'high' : (region?.confidence || 'medium'),
      classificationConfidence: proofComplete ? 'high' : 'medium',
      runtimeSelectionStateConfidence: 'unresolved',
      defaultDecoderExcluded: proofComplete,
      normalFrameStreamPromoted: false,
      tableDefinitionCount: tableDefinitions.length,
      targetDefinitionCount: targetDefinitions.length,
      tableCodeReferenceCount: tableCodeReferences.length,
      targetCodeReferenceCount: targetCodeReferences.length,
      indexCodeReferenceCount: indexCodeReferences.length,
      indexCommentReferenceCount: indexCommentReferences.length,
      persistedRomByteCount: 0,
      persistedSpriteByteCount: 0,
      persistedPixelCount: 0,
      persistedHashCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    proofChecks,
    references: {
      tableDefinitions,
      targetDefinitions,
      tableCodeReferences,
      targetCodeReferences,
      indexCodeReferences,
      indexCommentReferences: indexCommentReferences.slice(0, 12),
    },
    priorAuditKeys: {
      blankMetaspriteTargetAudit: analysisKeyPresent(region, 'blankMetaspriteTargetAudit'),
      c34eMetaspriteFamilyAudit: analysisKeyPresent(region, 'c34eMetaspriteFamilyAudit'),
      staleScreenProgMetadataAudit: analysisKeyPresent(region, 'staleScreenProgMetadataAudit'),
      asmIncbinSpanAudit: analysisKeyPresent(region, 'asmIncbinSpanAudit'),
      quarantinedMetaspriteConfidenceBackfillAudit: analysisKeyPresent(region, 'quarantinedMetaspriteConfidenceBackfillAudit'),
    },
    model: {
      classification: 'quarantined_blank_c34e_metasprite_target',
      tableRole: '_DATA_1071A_ metasprite-family pointer table entry 0',
      defaultDecoderAction: 'exclude_from_normal_frame_stream_decode',
      renderPolicy: 'treat_as_blank_or_noop_placeholder_until_a_consumer_specific_trace_proves_otherwise',
      unresolvedRuntimeQuestion: 'Which gameplay state derives the _RAM_C34E_ index value that selects table entry 0?',
      confidenceSplit: {
        blankQuarantineClassification: proofComplete ? 'high' : 'medium',
        runtimeSelectionStateName: 'unresolved',
      },
    },
    evidence: [
      'Existing blankMetaspriteTargetAudit marks r0792 as an all-zero metasprite fragment and role-tags it as a c34e_pointer_table_blank_target.',
      'Existing c34eMetaspriteFamilyAudit maps r0792 to _DATA_1071A_ table index 0 with expression _DATA_19B01_.',
      'Existing staleScreenProgMetadataAudit removed generated screen_prog metadata from r0792 after its semantic type became meta_sprite.',
      'ASM defines _DATA_1071A_ and _DATA_19B01_, but there are no executable ASM references to _RAM_C34E_; current evidence does not name the selecting runtime state.',
      'This audit promotes only the quarantine/default-decoder exclusion classification, not a normal sprite-frame interpretation.',
    ],
    nextLeads: [
      'Instrument the routine that computes the _DATA_1071A_ table index and record metadata-only _RAM_C34E_ index selections.',
      'Keep r0792 grouped as a C34E blank/no-op target in render summaries so unresolved sprite tiles are not hidden by a linear fallback decode.',
      'If runtime evidence later selects entry 0, add the selecting state name while preserving the no-payload asset policy.',
    ],
  };
}

function addNote(region, note) {
  const existing = String(region.notes || '');
  if (existing.includes(note)) return;
  region.notes = existing ? `${existing} ${note}` : note;
}

function applyCatalog(mapData, catalog) {
  const region = findRegion(mapData, target.regionId);
  const changedRegions = [];
  const missingRegions = [];
  if (!region) {
    missingRegions.push({ id: target.regionId, role: 'blank_metasprite_quarantine_proof_target' });
  } else {
    const confidenceBefore = region.confidence || null;
    if (catalog.summary.proofComplete) region.confidence = 'high';
    region.analysis = region.analysis || {};
    region.analysis.blankMetaspriteQuarantineProofAudit = {
      catalogId,
      kind: 'blank_c34e_metasprite_quarantine_proof',
      status: catalog.summary.status,
      confidence: catalog.summary.classificationConfidence,
      topLevelConfidenceBefore: confidenceBefore,
      topLevelConfidenceAfter: region.confidence || null,
      runtimeSelectionStateConfidence: catalog.summary.runtimeSelectionStateConfidence,
      defaultDecoderExcluded: catalog.summary.defaultDecoderExcluded,
      normalFrameStreamPromoted: false,
      model: catalog.model,
      proofChecks: catalog.proofChecks,
      summary: 'High-confidence quarantine proof for r0792 as a blank C34E metasprite-family table target; runtime selector state remains unresolved.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (region.analysis.quarantinedMetaspriteConfidenceBackfillAudit) {
      region.analysis.quarantinedMetaspriteConfidenceBackfillAudit.refinedByBlankMetaspriteQuarantineProofAudit = catalogId;
      region.analysis.quarantinedMetaspriteConfidenceBackfillAudit.topLevelConfidenceAfter = region.confidence;
    }
    addNote(region, 'Audit: high-confidence quarantined blank C34E metasprite target; exclude from default frame-stream decoders until runtime selector state is traced.');
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      confidenceBefore,
      confidenceAfter: region.confidence || null,
      status: catalog.summary.status,
      defaultDecoderExcluded: catalog.summary.defaultDecoderExcluded,
    });
  }

  mapData.blankMetaspriteQuarantineProofCatalogs = (mapData.blankMetaspriteQuarantineProofCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.blankMetaspriteQuarantineProofCatalogs.push(catalog);

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
  staticMap.summary.blankMetaspriteQuarantineProofCatalog = catalogId;
  staticMap.summary.blankMetaspriteQuarantineProofTargets = catalog.summary.proofComplete ? 1 : 0;
  staticMap.summary.blankMetaspriteQuarantineDefaultDecoderExcluded = catalog.summary.defaultDecoderExcluded ? 1 : 0;
  staticMap.summary.blankMetaspriteQuarantineRuntimeSelectionUnresolved = 1;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-blank-metasprite-quarantine-proof-catalog-2026-06-26 to exclude r0792 from normal metasprite frame-stream decoders while tracing the unresolved _RAM_C34E_ selector state.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
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
    proofChecks: catalog.proofChecks,
    changedRegions: result.changedRegions,
    missingRegions: result.missingRegions,
  }, null, 2));
}

main();
