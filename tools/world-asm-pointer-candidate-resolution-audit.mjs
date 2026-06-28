#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-asm-pointer-candidate-resolution-catalog-2026-06-25';
const reportId = 'asm-pointer-candidate-resolution-audit-2026-06-25';
const toolName = 'tools/world-asm-pointer-candidate-resolution-audit.mjs';
const sourceCatalogId = 'world-asm-data-label-census-catalog-2026-06-25';

const semanticTableTypes = new Set([
  'entity_behavior_table',
  'entity_anim_table',
  'palette_script_table',
  'screen_prog_table',
  'pointer_table',
]);

const auditPriority = [
  'entityRuntimeRoutineAudit',
  'bank2DispatchTableAudit',
  'entityAnimationAudit',
  'animationRootSemanticsAudit',
  'paletteScriptAudit',
  'screenProgTableAudit',
  'asmAssetAudit',
  'bank7VdpStreamAudit',
  'pointerTableDetailAudit',
  'inferred',
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function regionBounds(region) {
  const start = offsetOf(region);
  return { start, end: start + (region.size || 0) };
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
  }) || null;
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

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function findCatalog(mapData, id) {
  const buckets = Object.keys(mapData)
    .filter(key => Array.isArray(mapData[key]) && /catalog/i.test(key))
    .flatMap(key => mapData[key].map(item => ({ bucket: key, item })));
  return buckets.find(entry => entry.item?.id === id) || null;
}

function buildAsmIndex(asmText) {
  const lines = asmText.split(/\r?\n/);
  const labelLines = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_(?:LABEL|DATA)_[0-9A-F]+_):/.exec(lines[i]);
    if (match) labelLines.set(match[1], i + 1);
  }
  return { lines, labelLines };
}

function scanDirectiveBlock(asmIndex, label) {
  const startLine = asmIndex.labelLines.get(label);
  if (!startLine) {
    return {
      label,
      startLine: null,
      endLine: null,
      entries: [],
      directiveLines: [],
      missingAsm: true,
    };
  }
  const entries = [];
  const directiveLines = [];
  for (let i = startLine; i < asmIndex.lines.length; i++) {
    if (i + 1 > startLine && /^_(?:LABEL|DATA)_[0-9A-F]+_:/.test(asmIndex.lines[i])) {
      return {
        label,
        startLine,
        endLine: i,
        entries,
        directiveLines,
        missingAsm: false,
      };
    }
    const code = cleanCode(asmIndex.lines[i]);
    if (!/^\.dw\b/i.test(code)) continue;
    directiveLines.push({ line: i + 1, code });
    const payload = code.replace(/^\.dw\s*/i, '').trim();
    const tokens = payload
      .split(/\s+/)
      .map(token => token.replace(/,$/, ''))
      .filter(Boolean);
    for (const token of tokens) {
      const labelMatch = /^_(?:LABEL|DATA)_[0-9A-F]+_$/i.exec(token);
      const nullMatch = /^\$?0+$/i.exec(token);
      entries.push({
        index: entries.length,
        line: i + 1,
        targetLabel: labelMatch ? token : null,
        targetOffset: labelMatch ? hex(labelOffset(token)) : null,
        isNull: Boolean(nullMatch),
        expression: labelMatch || nullMatch ? token : token,
      });
    }
  }
  return {
    label,
    startLine,
    endLine: asmIndex.lines.length,
    entries,
    directiveLines,
    missingAsm: false,
  };
}

function evidenceRef(key, analysis) {
  const audit = analysis?.[key];
  if (!audit) return null;
  const evidence = Array.isArray(audit.evidence) ? audit.evidence.slice(0, 4) : [];
  return {
    analysisKey: key,
    catalogId: audit.catalogId || null,
    kind: audit.kind || audit.role || audit.family || null,
    confidence: audit.confidence || null,
    summary: audit.summary || '',
    dispatchTable: audit.dispatchTable || audit.table?.label || audit.loader?.tableLabel || null,
    indexRam: audit.indexRam || audit.table?.indexRam || audit.loader?.indexRam || null,
    decoder: audit.decoder || audit.table?.decoder || audit.loader?.label || null,
    evidence,
  };
}

function collectEvidenceRefs(region) {
  const analysis = region?.analysis || {};
  const refs = auditPriority
    .map(key => evidenceRef(key, analysis))
    .filter(Boolean);
  for (const key of Object.keys(analysis).sort()) {
    if (auditPriority.includes(key)) continue;
    const ref = evidenceRef(key, analysis);
    if (ref) refs.push(ref);
  }
  return refs;
}

function evidenceProvesPointerTable(ref) {
  const haystack = [
    ref.kind,
    ref.summary,
    ref.dispatchTable,
    ref.indexRam,
    ref.decoder,
    ...(ref.evidence || []),
  ].filter(Boolean).join(' ').toLowerCase();
  return /pointer table|jump table|dispatch table|dispatches through|indexed by|rst \$20|decoder|script pointer/.test(haystack);
}

function semanticRoleFor(region, evidenceRefs) {
  const type = region?.type || 'unknown';
  if (type === 'entity_behavior_table') return 'confirmed_specialized_entity_behavior_dispatch_table';
  if (type === 'entity_anim_table') return 'confirmed_specialized_entity_animation_pointer_table';
  if (type === 'palette_script_table') return 'confirmed_specialized_palette_script_pointer_table';
  if (type === 'screen_prog_table') return 'confirmed_specialized_screen_program_pointer_table';
  if (type === 'pointer_table') return 'confirmed_generic_pointer_table';
  const provingRef = evidenceRefs.find(evidenceProvesPointerTable);
  return provingRef ? 'confirmed_pointer_like_table' : 'needs_consumer_trace';
}

function genericPointerTableDecision(candidateStatus, regionType) {
  if (candidateStatus === 'confirmed_specialized_table') {
    return {
      action: 'reject_generic_pointer_table_retype',
      preserveType: regionType || 'unknown',
      reason: 'The .dw block is already mapped as a specialized semantic table; keep the richer region type and use pointer-table behavior as a subrole.',
    };
  }
  if (candidateStatus === 'confirmed_by_existing_audit') {
    return {
      action: 'manual_review_before_generic_retype',
      preserveType: regionType || 'unknown',
      reason: 'Existing evidence proves pointer-like behavior, but the current region type is not in the specialized table allowlist.',
    };
  }
  return {
    action: 'require_consumer_trace_before_generic_retype',
    preserveType: regionType || 'unknown',
    reason: 'The .dw shape alone is insufficient evidence to retype this region as a generic pointer table.',
  };
}

function buildCandidate(mapData, asmIndex, candidate) {
  const offset = parseInt(candidate.offset, 16);
  const region = findContainingRegion(mapData, offset);
  const tableScan = scanDirectiveBlock(asmIndex, candidate.label);
  const evidenceRefs = collectEvidenceRefs(region);
  const provingRefs = evidenceRefs.filter(evidenceProvesPointerTable);
  const semanticRole = semanticRoleFor(region, evidenceRefs);
  const confirmed = semanticRole !== 'needs_consumer_trace' && semanticTableTypes.has(region?.type || 'unknown');
  const status = confirmed ? 'confirmed_specialized_table' : provingRefs.length ? 'confirmed_by_existing_audit' : 'needs_consumer_trace';
  const pointerDecision = genericPointerTableDecision(status, region?.type || 'unknown');
  const targetLabels = uniqueBy(
    tableScan.entries
      .filter(entry => entry.targetLabel)
      .map(entry => entry.targetLabel),
    label => label,
  );
  return {
    label: candidate.label,
    offset: candidate.offset,
    region: regionRef(region),
    sourceCatalogLead: {
      approxSize: candidate.approxSize,
      directiveCounts: candidate.directiveCounts,
      incomingRefCount: candidate.incomingRefCount,
      outgoingLabelCount: candidate.outgoingLabelCount,
      flags: candidate.flags,
    },
    classification: {
      status,
      semanticRole,
      confidence: provingRefs.length || confirmed ? 'high' : 'medium',
      keepRegionType: region?.type || 'unknown',
      genericPointerTableAction: pointerDecision.action,
      reason: confirmed
        ? 'The region already has a specialized table type backed by existing audit evidence; no generic retype is needed.'
        : provingRefs.length
          ? 'Existing analysis evidence proves pointer-table behavior, but the current region type is not in the specialized table set.'
          : 'The ASM .dw structure exists, but no consumer/dispatcher audit was found on the mapped region.',
    },
    genericPointerTableDecision: pointerDecision,
    parsedFromAsm: {
      asmLine: tableScan.startLine,
      lineRange: tableScan.startLine == null ? null : { start: tableScan.startLine, end: tableScan.endLine },
      missingAsm: tableScan.missingAsm,
      directiveLineCount: tableScan.directiveLines.length,
      entryCount: tableScan.entries.length,
      nullEntryCount: tableScan.entries.filter(entry => entry.isNull).length,
      targetEntryCount: tableScan.entries.filter(entry => entry.targetLabel).length,
      uniqueTargetCount: targetLabels.length,
      entries: tableScan.entries.slice(0, 96),
      truncatedEntryCount: Math.max(0, tableScan.entries.length - 96),
    },
    evidenceRefs: provingRefs.length ? provingRefs : evidenceRefs.slice(0, 4),
    evidence: [
      `ASM line ${tableScan.startLine || 'unknown'}: ${candidate.label} is a .dw directive block from the ASM data-label census.`,
      region
        ? `Current map region ${region.id} keeps semantic type ${region.type || 'unknown'}.`
        : 'No mapped region covers this candidate offset.',
      provingRefs.length
        ? `Existing audit evidence confirms pointer-table behavior through ${provingRefs.map(ref => ref.analysisKey).join(', ')}.`
        : 'No existing consumer/dispatcher audit evidence was found on the mapped region.',
    ],
  };
}

function buildCatalog(mapData, asmText) {
  const sourceCatalog = findCatalog(mapData, sourceCatalogId)?.item || null;
  const validationIssues = [];
  if (!sourceCatalog) validationIssues.push(`Missing source catalog ${sourceCatalogId}.`);
  const candidates = sourceCatalog?.leads?.pointerTableCandidates || [];
  const asmIndex = buildAsmIndex(asmText);
  const resolvedCandidates = candidates.map(candidate => buildCandidate(mapData, asmIndex, candidate));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalog: sourceCatalogId,
    summary: {
      candidateCount: resolvedCandidates.length,
      confirmedSpecializedTables: resolvedCandidates.filter(item => item.classification.status === 'confirmed_specialized_table').length,
      confirmedByExistingAudit: resolvedCandidates.filter(item => item.classification.status === 'confirmed_by_existing_audit').length,
      needsConsumerTrace: resolvedCandidates.filter(item => item.classification.status === 'needs_consumer_trace').length,
      rejectedGenericPointerTableRetypes: resolvedCandidates.filter(item => item.genericPointerTableDecision.action === 'reject_generic_pointer_table_retype').length,
      manualReviewBeforeGenericRetype: resolvedCandidates.filter(item => item.genericPointerTableDecision.action === 'manual_review_before_generic_retype').length,
      requireConsumerTraceBeforeGenericRetype: resolvedCandidates.filter(item => item.genericPointerTableDecision.action === 'require_consumer_trace_before_generic_retype').length,
      parsedAsmEntries: resolvedCandidates.reduce((sum, item) => sum + item.parsedFromAsm.entryCount, 0),
      uniqueTargetLabels: uniqueBy(resolvedCandidates.flatMap(item => item.parsedFromAsm.entries.map(entry => entry.targetLabel).filter(Boolean)), label => label).length,
      byRegionType: countBy(resolvedCandidates, item => item.region?.type || 'unmapped'),
      byStatus: countBy(resolvedCandidates, item => item.classification.status),
      byGenericPointerTableAction: countBy(resolvedCandidates, item => item.genericPointerTableDecision.action),
      assetPolicy: 'Metadata only: ASM .dw labels, target labels/offsets, region ids/types, and existing audit evidence. No ROM bytes, decoded graphics, music, text, or asset payloads are embedded.',
    },
    candidates: resolvedCandidates,
    specializedTablePreservationDecisions: resolvedCandidates
      .filter(item => item.genericPointerTableDecision.action === 'reject_generic_pointer_table_retype')
      .map(item => ({
        label: item.label,
        offset: item.offset,
        region: item.region,
        semanticRole: item.classification.semanticRole,
        action: item.genericPointerTableDecision.action,
        preserveType: item.genericPointerTableDecision.preserveType,
        reason: item.genericPointerTableDecision.reason,
        entryCount: item.parsedFromAsm.entryCount,
        uniqueTargetCount: item.parsedFromAsm.uniqueTargetCount,
        confidence: item.classification.confidence,
      })),
    validationIssues: [
      ...validationIssues,
      ...resolvedCandidates.filter(item => !item.region).map(item => `No mapped region covers ${item.label} at ${item.offset}.`),
      ...resolvedCandidates.filter(item => item.parsedFromAsm.missingAsm).map(item => `No ASM .dw block found for ${item.label}.`),
    ],
    evidence: [
      'The source candidate list comes from world-asm-data-label-census-catalog-2026-06-25.',
      'Each candidate is resolved against existing region analysis evidence; this tool does not infer semantics from .dw layout alone.',
      'Specialized semantic table types are preserved instead of being collapsed to generic pointer_table.',
    ],
  };
}

function annotateRegions(mapData, catalog) {
  const annotated = [];
  for (const candidate of catalog.candidates) {
    if (!candidate.region) continue;
    const region = (mapData.regions || []).find(item => item.id === candidate.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.asmPointerCandidateResolutionAudit = {
      catalogId,
      kind: candidate.classification.semanticRole,
      confidence: candidate.classification.confidence,
      status: candidate.classification.status,
      label: candidate.label,
      summary: candidate.classification.reason,
      genericPointerTableDecision: candidate.genericPointerTableDecision,
      parsedFromAsm: candidate.parsedFromAsm,
      evidenceRefs: candidate.evidenceRefs,
      evidence: candidate.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      label: candidate.label,
      status: candidate.classification.status,
      semanticRole: candidate.classification.semanticRole,
      genericPointerTableAction: candidate.genericPointerTableDecision.action,
      entryCount: candidate.parsedFromAsm.entryCount,
      uniqueTargetCount: candidate.parsedFromAsm.uniqueTargetCount,
    });
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotations = apply ? annotateRegions(mapData, catalog) : [];

  if (apply) {
    mapData.pointerTableCatalogs = (mapData.pointerTableCatalogs || []).filter(item => item.id !== catalogId);
    mapData.pointerTableCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'asm_pointer_candidate_resolution_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      sourceCatalog: sourceCatalogId,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotations.length,
      },
      validationIssues: catalog.validationIssues,
      annotatedRegions: annotations,
      nextLeads: [
        'For any future needsConsumerTrace candidate, trace the nearest RST $20, pointer load, or decoder routine before changing region type.',
        'Use the parsed target labels here to group entity behavior table entries by shared tails and behavior pointer-list setup.',
        'Keep specialized table types such as entity_behavior_table, entity_anim_table, palette_script_table, and screen_prog_table instead of flattening them to generic pointer_table.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotations.length,
    },
    validationIssues: catalog.validationIssues,
    preview: catalog.candidates.slice(0, 8).map(candidate => ({
      label: candidate.label,
      regionType: candidate.region?.type || null,
      status: candidate.classification.status,
      semanticRole: candidate.classification.semanticRole,
      entryCount: candidate.parsedFromAsm.entryCount,
      uniqueTargetCount: candidate.parsedFromAsm.uniqueTargetCount,
      evidenceRefs: candidate.evidenceRefs.map(ref => ref.analysisKey),
    })),
  }, null, 2));
}

main();
