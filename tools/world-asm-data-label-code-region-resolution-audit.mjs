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
const catalogId = 'world-asm-data-label-code-region-resolution-catalog-2026-06-25';
const reportId = 'asm-data-label-code-region-resolution-audit-2026-06-25';
const toolName = 'tools/world-asm-data-label-code-region-resolution-audit.mjs';
const sourceCatalogId = 'world-asm-label-region-catalog-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function findCatalog(mapData, id) {
  for (const [key, value] of Object.entries(mapData)) {
    if (!Array.isArray(value) || !/catalog/i.test(key)) continue;
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

function findRegion(mapData, regionId) {
  return (mapData.regions || []).find(region => region.id === regionId) || null;
}

function compactEvidenceRef(key, audit) {
  if (!audit) return null;
  return {
    analysisKey: key,
    catalogId: audit.catalogId || '',
    kind: audit.kind || '',
    confidence: audit.confidence || '',
    summary: audit.summary || '',
    evidence: (audit.evidence || []).slice(0, 3),
  };
}

function bestCodeEvidence(region) {
  const analysis = region?.analysis || {};
  const priority = [
    'entityBehaviorCodeAudit',
    'entityBehaviorFragmentAudit',
    'entityObjectRecordAudit',
    'c3c0BehaviorTargetSemanticsAudit',
    'c3c0FrameStepTraceTargetAudit',
    'c3c0FrameStepControlFlowTargetAudit',
    'c3c0FrameStepDiagnosticTargetAudit',
    'bank0LowcoreVdpAudit',
  ];
  return priority
    .map(key => compactEvidenceRef(key, analysis[key]))
    .filter(Boolean);
}

function resolveEntry(mapData, lead) {
  const region = findRegion(mapData, lead.regionId);
  const analysis = region?.analysis || {};
  const evidenceRefs = bestCodeEvidence(region);
  const offset = parseHex(lead.offset);
  let resolutionKind = 'unresolved_data_label_in_code_region';
  let status = 'needs_manual_review';
  let confidence = 'low';
  let shouldChangeRegionType = false;
  let summary = 'ASM data label is inside a code region and still needs manual review.';
  let evidence = [
    `${lead.label} resolves to ${lead.offset} inside region ${lead.regionId}.`,
    'The source ASM label-region catalog marks it as data_label_in_code_region.',
  ];

  if (
    analysis.bank0LowcoreVdpAudit?.role === 'mixed_vdp_stream_opcode_table_and_literal_writer' ||
    analysis.bank0LowcoreVdpAudit?.kind === 'mixed_vdp_stream_opcode_table_and_literal_writer'
  ) {
    resolutionKind = 'embedded_dispatch_table_inside_code_routine';
    status = 'resolved_keep_region_code';
    confidence = 'high';
    summary = 'Real embedded dispatch table plus inline code inside the bank-0 VDP stream interpreter; keep the enclosing region typed as code.';
    evidence = [
      `${lead.label} is the local dispatch table used by _LABEL_609_ through RST 20.`,
      'bank0LowcoreVdpAudit confirms the table is immediately followed by inline literal VDP writes and branches back to _LABEL_609_.',
      'The table is substructure metadata, not a standalone asset stream.',
    ];
  } else if (analysis.bank0LowcoreVdpAudit && lead.nestedInRegion) {
    resolutionKind = 'rst_vector_padding_data_label';
    status = 'resolved_keep_region_code';
    confidence = 'medium';
    summary = 'Nested data label marks padding bytes inside a fixed RST/vector code region; keep the enclosing region typed as code.';
    evidence = [
      `${lead.label} is nested inside ${region?.name || region?.id || 'a fixed RST/vector region'}.`,
      'bank0LowcoreVdpAudit confirms the surrounding region is a low-core runtime/vector routine.',
      'The data label is padding/substructure and not an independent asset.',
    ];
  } else if (analysis.entityObjectRecordAudit?.kind === 'entity_behavior_code_before_object_records') {
    resolutionKind = 'behavior_code_prefix_before_object_records';
    status = 'resolved_keep_region_code';
    confidence = analysis.entityObjectRecordAudit.confidence || 'high';
    summary = 'ASM data label names a behavior-code prefix that has already been split from following object-record data.';
    evidence = [
      `${lead.label} names a code-region prefix before fixed-width entity object records.`,
      'entityObjectRecordAudit confirms the local control-flow boundary and the following object-record stream.',
      'The label should remain a code-region label, not an asset/data-table promotion.',
    ];
  } else if (analysis.entityBehaviorCodeAudit) {
    resolutionKind = 'entity_behavior_code_disassembler_data_label';
    status = 'resolved_keep_region_code';
    confidence = analysis.entityBehaviorCodeAudit.confidence || 'high';
    summary = 'ASM data label names executable entity behavior code selected by IX+38 behavior dispatch tables.';
    evidence = [
      `${lead.label} is covered by entityBehaviorCodeAudit as target-backed behavior code.`,
      'The shared entity dispatcher selects target words from entity behavior tables and jumps through JP (HL).',
      'The .db/.incbin representation is a disassembly artifact; the mapped region remains executable code.',
    ];
  } else if (analysis.entityBehaviorFragmentAudit) {
    resolutionKind = 'entity_behavior_code_tail_disassembler_data_label';
    status = 'resolved_keep_region_code';
    confidence = analysis.entityBehaviorFragmentAudit.confidence || 'medium';
    summary = 'ASM data label names a behavior-code tail or boundary fragment adjacent to confirmed entity behavior code.';
    evidence = [
      `${lead.label} is covered by entityBehaviorFragmentAudit as an entity behavior code fragment.`,
      'The fragment is adjacent to target-backed behavior code and has no _LABEL_604_ screen-program consumer.',
      'The mapped region remains code while the data label is retained as an ASM boundary alias.',
    ];
  } else if (offset === 0x00006 || offset === 0x00033) {
    resolutionKind = 'rst_vector_padding_data_label';
    status = 'resolved_keep_region_code';
    confidence = 'medium';
    summary = 'Nested data label marks padding inside a fixed RST/vector region; keep the region typed as code.';
    evidence = [
      `${lead.label} is nested inside a fixed low-core vector region.`,
      'The enclosing region has a confirmed low-core VDP/runtime role.',
      'The bytes are padding/substructure metadata, not an independent asset.',
    ];
  }

  return {
    label: lead.label,
    offset: lead.offset,
    bank: lead.bank,
    asmLine: lead.line,
    sourceStatus: lead.status,
    sourceBlockStyle: lead.blockStyle,
    sourceRegion: regionRef(region),
    resolutionKind,
    status,
    confidence,
    shouldChangeRegionType,
    summary,
    evidenceRefs,
    evidence,
    assetPolicy: 'Metadata only: labels, offsets, region ids, roles, confidence, and evidence references. No ROM bytes, instruction bytes, decoded assets, coordinates, text payloads, or gameplay constants are embedded.',
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

function buildCatalog(mapData) {
  const sourceCatalog = requireCatalog(mapData, sourceCatalogId);
  const leads = sourceCatalog.leads?.dataLabelsInCodeRegions || [];
  const entries = leads.map(lead => resolveEntry(mapData, lead));
  const unresolved = entries.filter(entry => entry.status !== 'resolved_keep_region_code');
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalog: sourceCatalogId,
    summary: {
      sourceLeadCount: leads.length,
      resolvedKeepCodeCount: entries.filter(entry => entry.status === 'resolved_keep_region_code').length,
      unresolvedCount: unresolved.length,
      regionTypeChangeCount: entries.filter(entry => entry.shouldChangeRegionType).length,
      byResolutionKind: countBy(entries, entry => entry.resolutionKind),
      byStatus: countBy(entries, entry => entry.status),
      byConfidence: countBy(entries, entry => entry.confidence),
      assetPolicy: 'Metadata only: ASM labels, offsets, region ids/types, audit references, confidence, and resolution statuses. No ROM bytes, decoded instructions, graphics, music, text payloads, coordinates, samples, or gameplay constants are embedded.',
    },
    entries,
    validationIssues: unresolved.map(entry => ({
      severity: 'warning',
      kind: 'unresolved_data_label_in_code_region',
      label: entry.label,
      offset: entry.offset,
      region: entry.sourceRegion,
      summary: entry.summary,
    })),
    evidence: [
      `The source leads come from ${sourceCatalogId}.`,
      'Each entry is resolved against existing region analysis evidence before deciding whether to keep the enclosing code type.',
      'No region type is changed by this audit; it records why data labels inside code regions are not asset regions.',
    ],
  };
}

function annotateRegions(mapData, catalog) {
  const annotated = [];
  for (const entry of catalog.entries) {
    const region = findRegion(mapData, entry.sourceRegion?.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.asmDataLabelCodeRegionResolutionAudit = {
      catalogId,
      kind: entry.resolutionKind,
      confidence: entry.confidence,
      status: entry.status,
      label: entry.label,
      offset: entry.offset,
      summary: entry.summary,
      shouldChangeRegionType: entry.shouldChangeRegionType,
      evidenceRefs: entry.evidenceRefs,
      evidence: entry.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      region: entry.sourceRegion,
      label: entry.label,
      resolutionKind: entry.resolutionKind,
      status: entry.status,
      confidence: entry.confidence,
    });
  }
  return annotated;
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
      type: 'asm_data_label_code_region_resolution_audit',
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
        'Teach pointer-table and asset scans to treat resolved_keep_region_code entries as code substructure unless a stronger consumer proves otherwise.',
        'Use entity behavior audits, not ASM .db labels alone, when deciding whether bank-1 behavior islands are executable code or data.',
        'For _DATA_612_, keep the opcode table modeled as substructure of the VDP stream interpreter rather than a standalone pointer table asset.',
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
      offset: entry.offset,
      regionId: entry.sourceRegion?.id || '',
      resolutionKind: entry.resolutionKind,
      status: entry.status,
      confidence: entry.confidence,
      shouldChangeRegionType: entry.shouldChangeRegionType,
    })),
  }, null, 2));
}

main();
