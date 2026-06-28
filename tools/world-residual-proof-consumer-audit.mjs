#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-residual-proof-consumer-audit.mjs';
const catalogId = 'world-residual-proof-consumer-catalog-2026-06-26';
const reportId = 'residual-proof-consumer-audit-2026-06-26';

const CONTAINING_LABELS = {
  r2815: '_DATA_1CABB_',
  r2816: '_DATA_1CABB_',
  r2817: '_DATA_1CABB_',
};

const ALIAS_LABELS = {
  r0749: '_DATA_12337_',
};

const ADDRESS_ALIASES = {
  r2813: ['$8718'],
  r2815: ['$8BB9', '$CBB9'],
  r2816: ['$8BC0', '$CBC0'],
  r2817: ['$8BD0', '$CBD0'],
  r0749: ['$A337'],
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function hex(value, pad = 5) {
  return `0x${value.toString(16).toUpperCase().padStart(pad, '0')}`;
}

function bankOf(offset) {
  return Math.floor(offset / 0x4000);
}

function z80Address(offset) {
  return 0x8000 + (offset & 0x3fff);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripComment(line) {
  return line.split(';')[0];
}

function readAsmLines(asmText) {
  return asmText.split(/\r?\n/).map((text, index) => ({
    line: index + 1,
    text,
    code: stripComment(text).trim(),
  }));
}

function labelLineRefs(lines, label) {
  const exactColon = new RegExp(`^\\s*${escapeRegExp(label)}:`);
  const exactRamStyle = new RegExp(`^\\s*${escapeRegExp(label)}\\s+(db|dw|dsb|rb|rw|equ|=)\\b`, 'i');
  return lines
    .filter(item => exactColon.test(item.code) || exactRamStyle.test(item.code))
    .map(item => ({ line: item.line, refKind: 'definition' }));
}

function directLabelRefs(lines, label) {
  const exactColonDefinition = new RegExp(`^\\s*${escapeRegExp(label)}:`);
  const exactRamStyleDefinition = new RegExp(`^\\s*${escapeRegExp(label)}\\s+(db|dw|dsb|rb|rw|equ|=)\\b`, 'i');
  const token = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(label)}([^A-Za-z0-9_]|$)`);
  return lines
    .filter(item => (
      item.code &&
      token.test(item.code) &&
      !exactColonDefinition.test(item.code) &&
      !exactRamStyleDefinition.test(item.code) &&
      !/^\.incbin\b/i.test(item.code)
    ))
    .map(item => ({
      line: item.line,
      refKind: classifyLabelRef(item.code, label),
    }));
}

function classifyLabelRef(code, label) {
  const escaped = escapeRegExp(label);
  if (new RegExp(`^ld\\s+a,\\s*\\(${escaped}\\)$`, 'i').test(code)) return 'direct_ram_read';
  if (new RegExp(`^ld\\s*\\(${escaped}\\),`, 'i').test(code)) return 'direct_ram_write';
  if (/^\.dw\b/i.test(code)) return 'pointer_table_or_word_record';
  if (/^ld\s+hl,\s*/i.test(code)) return 'hl_load';
  if (/^ld\s+/i.test(code)) return 'direct_load_or_store';
  if (/^call\s+/i.test(code)) return 'callsite';
  return 'other_label_ref';
}

function addressExpressionRefs(lines, aliases) {
  const escaped = aliases.map(escapeRegExp).join('|');
  if (!escaped) return [];
  const token = new RegExp(`(^|[^A-Fa-f0-9_$])(${escaped})([^A-Fa-f0-9_]|$)`, 'i');
  return lines
    .filter(item => item.code && token.test(item.code))
    .map(item => ({ line: item.line, refKind: 'address_expression' }));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function proofRegions(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.lowConfidenceResidualTriageAudit?.proofPlan)
    .sort((a, b) => parseInt(a.offset, 16) - parseInt(b.offset, 16));
}

function regionRef(region) {
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
    confidence: region.confidence || null,
  };
}

function statusFor(region, data) {
  const kind = region.analysis?.lowConfidenceResidualTriageAudit?.kind || '';
  if (kind === 'room_overlay_tail') return 'static_cf64_read_known_runtime_source_value_unproven';
  if (kind === 'bank7_entity_sequence_sidecar') {
    return data.exactDirectRefCount === 0 && data.aliasDirectRefCount > 0
      ? 'no_direct_bank7_consumer_alias_path_only'
      : 'bank7_consumer_requires_trace';
  }
  if (String(kind).startsWith('post_palette_tail_')) {
    return data.exactLabelDefinitionCount === 0 && data.exactDirectRefCount === 0 && data.exactAddressExpressionRefCount === 0
      ? 'no_exact_same_bank_consumer_found_static'
      : 'same_bank_consumer_lead_requires_trace';
  }
  return data.exactDirectRefCount ? 'consumer_lead_requires_trace' : 'no_static_consumer_found';
}

function proofDisposition(status) {
  if (status === 'static_cf64_read_known_runtime_source_value_unproven') {
    return 'runtime_trace_required_before_overlay_tail_promotion';
  }
  if (status === 'no_direct_bank7_consumer_alias_path_only') {
    return 'keep_quarantined_bank_alias_only';
  }
  if (status === 'no_exact_same_bank_consumer_found_static') {
    return 'keep_quarantined_no_exact_same_bank_consumer';
  }
  return 'keep_quarantined_until_consumer_trace';
}

function evidenceFor(region, data) {
  const triage = region.analysis?.lowConfidenceResidualTriageAudit || {};
  const proofPlan = triage.proofPlan || {};
  const evidence = [
    `${region.id} proof plan requires ${proofPlan.traceKind || 'consumer trace'} before semantic promotion.`,
  ];
  if (data.exactLabelDefinitionCount) {
    evidence.push(`${data.primaryWatchLabel} has ASM definition line(s): ${data.exactLabelDefinitions.map(ref => ref.line).join(', ')}.`);
  } else if (data.primaryWatchLabel) {
    evidence.push(`${data.primaryWatchLabel} is not defined as an exact ASM label; the candidate is a project-map split inside a larger ASM data block or RAM-derived role.`);
  }
  if (data.exactDirectRefCount) {
    evidence.push(`${data.primaryWatchLabel} has ${data.exactDirectRefCount} direct non-definition ASM reference(s), categorized only by reference kind.`);
  } else if (data.primaryWatchLabel) {
    evidence.push(`${data.primaryWatchLabel} has no exact non-definition ASM label reference.`);
  }
  if (data.exactAddressExpressionRefCount === 0) {
    evidence.push(`No exact address expression was found for ${region.offset} / ${data.z80Address}.`);
  }
  if (data.containingLabel) {
    evidence.push(`${region.id} is inside ${data.containingLabel}; that container has ${data.containingLabelDirectRefCount} non-definition ASM reference(s), which does not prove an exact tail consumer.`);
  }
  if (data.aliasLabel) {
    evidence.push(`${data.aliasLabel} has ${data.aliasDirectRefCount} direct non-definition ASM reference(s); this is retained as alias context, not proof for ${data.primaryWatchLabel}.`);
  }
  return evidence;
}

function buildEntry(region, lines) {
  const triage = region.analysis?.lowConfidenceResidualTriageAudit || {};
  const proofPlan = triage.proofPlan || {};
  const offset = parseInt(region.offset, 16);
  const primaryWatchLabel = proofPlan.watchLabels?.[0] || null;
  const exactLabelDefinitions = primaryWatchLabel ? labelLineRefs(lines, primaryWatchLabel) : [];
  const exactDirectRefs = primaryWatchLabel ? directLabelRefs(lines, primaryWatchLabel) : [];
  const exactAddressRefs = addressExpressionRefs(lines, ADDRESS_ALIASES[region.id] || []);
  const containingLabel = CONTAINING_LABELS[region.id] || null;
  const containingLabelDefinitions = containingLabel ? labelLineRefs(lines, containingLabel) : [];
  const containingLabelDirectRefs = containingLabel ? directLabelRefs(lines, containingLabel) : [];
  const aliasLabel = ALIAS_LABELS[region.id] || null;
  const aliasDirectRefs = aliasLabel ? directLabelRefs(lines, aliasLabel) : [];

  const data = {
    primaryWatchLabel,
    exactLabelDefinitions,
    exactDirectRefs,
    exactAddressRefs,
    containingLabel,
    containingLabelDefinitions,
    containingLabelDirectRefs,
    aliasLabel,
    aliasDirectRefs,
    exactLabelDefinitionCount: exactLabelDefinitions.length,
    exactDirectRefCount: exactDirectRefs.length,
    exactDirectRefKindCounts: countBy(exactDirectRefs, ref => ref.refKind),
    exactAddressExpressionRefCount: exactAddressRefs.length,
    containingLabelDirectRefCount: containingLabelDirectRefs.length,
    aliasDirectRefCount: aliasDirectRefs.length,
  };
  const status = statusFor(region, data);

  return {
    region: regionRef(region),
    bank: bankOf(offset),
    z80Address: hex(z80Address(offset), 4),
    residualKind: triage.kind || null,
    proofTraceKind: proofPlan.traceKind || null,
    proofStatus: status,
    disposition: proofDisposition(status),
    primaryWatchLabel,
    exactLabelDefinitions,
    exactDirectRefs,
    exactDirectRefKindCounts: data.exactDirectRefKindCounts,
    exactAddressAliasesSearched: ADDRESS_ALIASES[region.id] || [],
    exactAddressExpressionRefs: exactAddressRefs,
    containingLabel,
    containingLabelDefinitions,
    containingLabelDirectRefs,
    aliasLabel,
    aliasDirectRefs,
    promotionAllowed: false,
    runtimeTraceRequired: true,
    evidence: evidenceFor(region, {
      ...data,
      z80Address: hex(z80Address(offset), 4),
    }),
    nextTrace: proofPlan.requiredProof || triage.requiredNextTrace || 'Direct consumer trace required before semantic promotion.',
  };
}

function buildCatalog(mapData, asmText) {
  const lines = readAsmLines(asmText);
  const entries = proofRegions(mapData).map(region => buildEntry(region, lines));
  const staticConsumerConfirmedCount = entries.filter(entry => entry.promotionAllowed).length;

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    assetPolicy: 'Metadata only: region ids, offsets, labels, ASM line numbers, reference-kind counts, statuses, and next trace notes. No ROM bytes, decoded graphics, rendered pixels, audio payloads, hashes, or instruction bytes are embedded.',
    selectionRule: 'Project regions with analysis.lowConfidenceResidualTriageAudit.proofPlan.',
    summary: {
      candidateCount: entries.length,
      candidateByteCount: entries.reduce((sum, entry) => sum + entry.region.size, 0),
      proofStatusCounts: countBy(entries, entry => entry.proofStatus),
      exactLabelDefinitionCount: entries.reduce((sum, entry) => sum + entry.exactLabelDefinitions.length, 0),
      exactDirectLabelRefCount: entries.reduce((sum, entry) => sum + entry.exactDirectRefs.length, 0),
      exactAddressExpressionRefCount: entries.reduce((sum, entry) => sum + entry.exactAddressExpressionRefs.length, 0),
      containingLabelRefCount: entries.reduce((sum, entry) => sum + entry.containingLabelDirectRefs.length, 0),
      aliasLabelRefCount: entries.reduce((sum, entry) => sum + entry.aliasDirectRefs.length, 0),
      staticConsumerConfirmedCount,
      staticConsumerUnconfirmedCount: entries.length - staticConsumerConfirmedCount,
      runtimeTraceRequiredCount: entries.filter(entry => entry.runtimeTraceRequired).length,
      promotionAllowedCount: entries.filter(entry => entry.promotionAllowed).length,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    entries,
  };
}

function applyCatalog(mapData, catalog) {
  const annotated = [];
  for (const entry of catalog.entries) {
    const region = (mapData.regions || []).find(item => item.id === entry.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.residualProofConsumerAudit = {
      catalogId,
      status: entry.proofStatus,
      disposition: entry.disposition,
      confidence: 'medium_for_static_absence_low_for_semantic_role',
      proofTraceKind: entry.proofTraceKind,
      primaryWatchLabel: entry.primaryWatchLabel,
      exactLabelDefinitionCount: entry.exactLabelDefinitions.length,
      exactDirectLabelRefCount: entry.exactDirectRefs.length,
      exactDirectRefKindCounts: entry.exactDirectRefKindCounts,
      exactAddressExpressionRefCount: entry.exactAddressExpressionRefs.length,
      containingLabel: entry.containingLabel,
      containingLabelDirectRefCount: entry.containingLabelDirectRefs.length,
      aliasLabel: entry.aliasLabel,
      aliasDirectRefCount: entry.aliasDirectRefs.length,
      promotionAllowed: entry.promotionAllowed,
      runtimeTraceRequired: entry.runtimeTraceRequired,
      summary: `${entry.region.id} remains quarantined: static proof audit did not find a direct exact consumer sufficient for promotion.`,
      evidence: entry.evidence,
      nextTrace: entry.nextTrace,
      generatedAt: now,
      tool: toolName,
    };
    if (region.analysis.lowConfidenceResidualTriageAudit) {
      region.analysis.lowConfidenceResidualTriageAudit.latestProofConsumerAudit = catalogId;
      region.analysis.lowConfidenceResidualTriageAudit.latestProofStatus = entry.proofStatus;
    }
    annotated.push({
      id: region.id,
      offset: region.offset,
      status: entry.proofStatus,
      disposition: entry.disposition,
      primaryWatchLabel: entry.primaryWatchLabel,
    });
  }
  return annotated;
}

function updateStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.residualProofConsumerCatalog = catalogId;
  staticMap.summary.residualProofConsumerCandidates = catalog.summary.candidateCount;
  staticMap.summary.residualProofConsumerBytes = catalog.summary.candidateByteCount;
  staticMap.summary.residualProofConsumerStaticConfirmed = catalog.summary.staticConsumerConfirmedCount;
  staticMap.summary.residualProofConsumerStaticUnconfirmed = catalog.summary.staticConsumerUnconfirmedCount;
  staticMap.summary.residualProofConsumerRuntimeTraceRequired = catalog.summary.runtimeTraceRequiredCount;
  staticMap.summary.residualProofConsumerExactAddressRefs = catalog.summary.exactAddressExpressionRefCount;
  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.coverage = insertAfter(
    staticMap.primaryCatalogs.coverage,
    'world-low-confidence-residual-triage-catalog-2026-06-26',
    catalogId
  );
  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.push('Use world-residual-proof-consumer-catalog-2026-06-26 to drive the required runtime traces for the five quarantined residual regions; static exact-consumer evidence is still insufficient for promotion.');
  writeJson(staticMapPath, staticMap);
}

function reportEntries(catalog) {
  return catalog.entries.map(entry => ({
    id: entry.region.id,
    offset: entry.region.offset,
    size: entry.region.size,
    residualKind: entry.residualKind,
    proofStatus: entry.proofStatus,
    promotionAllowed: entry.promotionAllowed,
    runtimeTraceRequired: entry.runtimeTraceRequired,
    primaryWatchLabel: entry.primaryWatchLabel,
    exactDirectLabelRefCount: entry.exactDirectRefs.length,
    exactAddressExpressionRefCount: entry.exactAddressExpressionRefs.length,
    containingLabel: entry.containingLabel,
    aliasLabel: entry.aliasLabel,
  }));
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotatedRegions = apply ? applyCatalog(mapData, catalog) : [];

  if (apply) {
    mapData.residualProofConsumerCatalogs = (mapData.residualProofConsumerCatalogs || []).filter(item => item.id !== catalogId);
    mapData.residualProofConsumerCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'residual_proof_consumer_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      catalogId,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
      assetPolicy: catalog.assetPolicy,
      residualSummary: reportEntries(catalog),
      evidence: [
        'Exact consumer checks scan ASM labels, direct label references, and exact address-expression tokens only.',
        'Line references are stored as metadata; ROM bytes, decoded payloads, and instruction bytes are not persisted.',
        'No residual candidate is promoted by this audit because static exact-consumer proof is absent or runtime value proof remains required.',
      ],
      nextLeads: [
        'Use a runtime trace on _RAM_CF64_ source byte +6 to prove or reject r2813.',
        'Trace the _DATA_1CABB_ parser boundaries before promoting r2815-r2817; exact split-label/address consumers are absent statically.',
        'Trace bank-7 runtime context around _DATA_1E337_; the static alias path still points at _DATA_12337_, not r0749.',
      ],
      annotatedRegions,
    });
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    residualSummary: reportEntries(catalog),
  }, null, 2));
}

main();
