#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-bank7-sidecar-alias-proof-audit.mjs';
const catalogId = 'world-bank7-sidecar-alias-proof-catalog-2026-06-26';
const reportId = 'bank7-sidecar-alias-proof-audit-2026-06-26';

const target = {
  regionId: 'r0749',
  label: '_DATA_1E337_',
  offset: 0x1E337,
  size: 41,
  z80: 0xA337,
};

const alias = {
  label: '_DATA_12337_',
  offset: 0x12337,
  z80: 0xA337,
};

const sourceCatalogs = [
  'world-residual-proof-consumer-catalog-2026-06-26',
  'world-graphics-loader-candidate-consumer-catalog-2026-06-25',
  'world-bank7-pre-sequence-sidecar-catalog-2026-06-25',
  'world-player-a48-nonmatch-false-8fb-guard-catalog-2026-06-26',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function hex(value, pad = 5) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function stripComment(line) {
  return line.split(';')[0].trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseHex(value) {
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function regionStart(region) {
  return parseHex(region?.offset) ?? 0;
}

function regionEnd(region) {
  return regionStart(region) + Number(region?.size || 0);
}

function z80Address(offset) {
  if (offset < 0x4000) return offset;
  if (offset < 0x8000) return 0x4000 + (offset - 0x4000);
  return 0x8000 + (offset % 0x4000);
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
    confidence: region.confidence || null,
  };
}

function findRegion(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function containingRegion(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
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

function asmLines(asmText) {
  return asmText.split(/\r?\n/).map((text, index) => ({
    line: index + 1,
    text,
    code: stripComment(text),
  }));
}

function isDefinition(code, label) {
  return new RegExp(`^${escapeRegExp(label)}\\s*:`).test(code);
}

function labelRefs(lines, label) {
  const token = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(label)}([^A-Za-z0-9_]|$)`);
  const refs = [];
  for (let i = 0; i < lines.length; i++) {
    const item = lines[i];
    if (!item.code || !token.test(item.code)) continue;
    if (/^\.incbin\b/i.test(item.code)) continue;
    const definition = isDefinition(item.code, label);
    refs.push({
      line: item.line,
      kind: definition ? 'definition' : classifyRef(item.code, label),
      followedBy: definition ? null : nextCode(lines, i),
    });
  }
  return refs;
}

function classifyRef(code, label) {
  const labelRe = escapeRegExp(label);
  if (new RegExp(`^ld\\s+hl,\\s*${labelRe}\\s*$`, 'i').test(code)) return 'hl_load';
  if (/^\.dw\b/i.test(code)) return 'word_record_or_pointer_table';
  if (/^ld\s+/i.test(code)) return 'load_or_store';
  return 'other_ref';
}

function nextCode(lines, index) {
  for (let cursor = index + 1; cursor < lines.length && cursor < index + 6; cursor++) {
    if (!lines[cursor].code) continue;
    return {
      line: lines[cursor].line,
      kind: classifyFollowingCode(lines[cursor].code),
    };
  }
  return null;
}

function classifyFollowingCode(code) {
  if (/^call\s+_LABEL_8FB_\s*$/i.test(code)) return 'call_LABEL_8FB';
  if (/^call\s+_LABEL_998_\s*$/i.test(code)) return 'call_LABEL_998';
  if (/^call\s+/i.test(code)) return 'other_call';
  return 'other_code';
}

function addressExpressionRefs(lines, z80) {
  const z80Hex = z80.toString(16).toUpperCase().padStart(4, '0');
  const tokens = [
    `$${z80Hex}`,
    `0x${z80Hex}`,
    z80Hex,
  ];
  const tokenRe = new RegExp(`(^|[^A-Fa-f0-9_$])(${tokens.map(escapeRegExp).join('|')})([^A-Fa-f0-9_]|$)`, 'i');
  return lines
    .filter(item => item.code && tokenRe.test(item.code))
    .map(item => ({ line: item.line, kind: 'address_expression' }));
}

function scanRawWordOccurrences(rom, mapData, word) {
  const occurrences = [];
  for (let offset = 0; offset + 1 < rom.length; offset++) {
    const value = rom[offset] | (rom[offset + 1] << 8);
    if (value !== word) continue;
    const region = containingRegion(mapData, offset);
    occurrences.push({
      romOffset: hex(offset),
      containingRegion: compactRegion(region),
      classification: region?.id === 'r1907'
        ? 'inside_LABEL_1E200_code_operands'
        : 'raw_word_shape_context_unclassified',
    });
  }
  return occurrences;
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function buildCatalog(mapData, rom, asmText) {
  for (const id of sourceCatalogs) requireCatalog(mapData, id);
  const lines = asmLines(asmText);
  const targetRegion = findRegion(mapData, target.regionId);
  const targetRefs = labelRefs(lines, target.label);
  const aliasRefs = labelRefs(lines, alias.label);
  const exactTargetDefinitions = targetRefs.filter(ref => ref.kind === 'definition');
  const exactTargetDirectRefs = targetRefs.filter(ref => ref.kind !== 'definition');
  const aliasDefinitions = aliasRefs.filter(ref => ref.kind === 'definition');
  const aliasDirectRefs = aliasRefs.filter(ref => ref.kind !== 'definition');
  const aliasLoaderAdjacentRefs = aliasDirectRefs.filter(ref => ref.kind === 'hl_load' && ref.followedBy?.kind === 'call_LABEL_8FB');
  const targetAddressExpressionRefs = addressExpressionRefs(lines, target.z80);
  const rawZ80WordOccurrences = scanRawWordOccurrences(rom, mapData, target.z80);
  const rawOccurrenceAliasCodeCount = rawZ80WordOccurrences.filter(item => item.classification === 'inside_LABEL_1E200_code_operands').length;
  const sameZ80Alias = z80Address(target.offset) === z80Address(alias.offset);

  const promotionAllowed = false;
  const status = exactTargetDirectRefs.length === 0 &&
    aliasLoaderAdjacentRefs.length > 0 &&
    rawZ80WordOccurrences.length === rawOccurrenceAliasCodeCount
    ? 'no_direct_bank7_consumer_alias_loader_path_only'
    : 'bank7_sidecar_consumer_requires_trace';

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: labels, offsets, z80 aliases, ASM line numbers, reference kinds, source/target region ids, and counts. No ROM bytes, decoded graphics, rendered pixels, palette values, audio, hashes, instruction bytes, or register traces are embedded.',
    summary: {
      targetRegion: compactRegion(targetRegion),
      targetLabel: target.label,
      aliasLabel: alias.label,
      targetRomOffset: hex(target.offset),
      aliasRomOffset: hex(alias.offset),
      z80Address: hex(target.z80, 4),
      sameZ80Alias,
      exactTargetDefinitionCount: exactTargetDefinitions.length,
      exactTargetDirectRefCount: exactTargetDirectRefs.length,
      targetAddressExpressionRefCount: targetAddressExpressionRefs.length,
      aliasDefinitionCount: aliasDefinitions.length,
      aliasDirectRefCount: aliasDirectRefs.length,
      aliasLoaderAdjacentRefCount: aliasLoaderAdjacentRefs.length,
      rawZ80WordOccurrenceCount: rawZ80WordOccurrences.length,
      rawOccurrenceAliasCodeCount,
      promotionAllowed,
      runtimeTraceRequired: true,
      status,
      persistedRomByteCount: 0,
      persistedTileByteCount: 0,
      persistedPaletteByteCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    references: {
      targetDefinitions: exactTargetDefinitions,
      targetDirectRefs: exactTargetDirectRefs,
      targetAddressExpressionRefs,
      aliasDefinitions,
      aliasDirectRefs,
      aliasLoaderAdjacentRefs,
      rawZ80WordOccurrences,
    },
    evidence: [
      '_DATA_1E337_ has an ASM definition but no exact non-definition label reference.',
      '_DATA_12337_ has the same Z80 address $A337 and is loaded into HL immediately before call _LABEL_8FB_ in _LABEL_1E200_.',
      'The raw $A337 word occurrence is inside the _LABEL_1E200_ code region and is classified as the alias load operand context, not proof that bank-7 data at 0x1E337 is consumed.',
      'Existing graphics-loader candidate audits already reject r0749 promotion because the loader-adjacent path resolves to the bank alias, not to _DATA_1E337_.',
    ],
    nextLeads: [
      'Keep r0749 excluded from vram_loader_8fb execution until a direct bank-7 consumer addresses _DATA_1E337_ or 0x1E337 specifically.',
      'If runtime tracing is added, watch HL before _LABEL_8FB_ calls and the active bank/page context to distinguish _DATA_12337_ from _DATA_1E337_.',
      'Move residual proof work to r2813/_RAM_CF64_ after this alias proof is recorded.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const targetRegion = findRegion(mapData, target.regionId);
  const codeRegion = findRegion(mapData, 'r1907');
  const annotated = [];
  if (targetRegion) {
    targetRegion.analysis = targetRegion.analysis || {};
    targetRegion.analysis.bank7SidecarAliasProofAudit = {
      catalogId,
      kind: 'bank7_sidecar_alias_consumer_proof',
      status: catalog.summary.status,
      confidence: 'high_for_static_alias_rejection_low_for_semantic_role',
      exactTargetDirectRefCount: catalog.summary.exactTargetDirectRefCount,
      aliasDirectRefCount: catalog.summary.aliasDirectRefCount,
      aliasLoaderAdjacentRefCount: catalog.summary.aliasLoaderAdjacentRefCount,
      rawZ80WordOccurrenceCount: catalog.summary.rawZ80WordOccurrenceCount,
      rawOccurrenceAliasCodeCount: catalog.summary.rawOccurrenceAliasCodeCount,
      promotionAllowed: catalog.summary.promotionAllowed,
      runtimeTraceRequired: catalog.summary.runtimeTraceRequired,
      summary: '_DATA_1E337_ remains quarantined: the only loader-adjacent $A337 path resolves to _DATA_12337_, not this bank-7 sidecar.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (targetRegion.analysis.lowConfidenceResidualTriageAudit) {
      targetRegion.analysis.lowConfidenceResidualTriageAudit.latestBank7SidecarAliasProofAudit = catalogId;
      targetRegion.analysis.lowConfidenceResidualTriageAudit.latestBank7SidecarAliasProofStatus = catalog.summary.status;
    }
    if (targetRegion.analysis.residualProofConsumerAudit) {
      targetRegion.analysis.residualProofConsumerAudit.bank7SidecarAliasProofAudit = catalogId;
      targetRegion.analysis.residualProofConsumerAudit.bank7SidecarAliasProofStatus = catalog.summary.status;
    }
    annotated.push({ id: targetRegion.id, offset: targetRegion.offset, status: catalog.summary.status });
  }
  if (codeRegion) {
    codeRegion.analysis = codeRegion.analysis || {};
    codeRegion.analysis.bank7SidecarAliasOperandAudit = {
      catalogId,
      kind: 'bank7_sidecar_alias_operand_context',
      confidence: 'high',
      aliasLabel: catalog.summary.aliasLabel,
      z80Address: catalog.summary.z80Address,
      aliasLoaderAdjacentRefCount: catalog.summary.aliasLoaderAdjacentRefCount,
      rawZ80WordOccurrenceCount: catalog.summary.rawZ80WordOccurrenceCount,
      summary: '_LABEL_1E200_ contains the loader-adjacent $A337 operand, but the ASM resolves it as _DATA_12337_; this is alias context, not r0749 consumption.',
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({ id: codeRegion.id, offset: codeRegion.offset, status: 'alias_operand_context_recorded' });
  }
  return annotated;
}

function updateStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.bank7SidecarAliasProofCatalog = catalogId;
  staticMap.summary.bank7SidecarAliasProofStatus = catalog.summary.status;
  staticMap.summary.bank7SidecarAliasProofTargetDirectRefs = catalog.summary.exactTargetDirectRefCount;
  staticMap.summary.bank7SidecarAliasProofAliasLoaderRefs = catalog.summary.aliasLoaderAdjacentRefCount;
  staticMap.summary.bank7SidecarAliasProofRawWordOccurrences = catalog.summary.rawZ80WordOccurrenceCount;
  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.graphics = insertAfter(
    staticMap.primaryCatalogs.graphics,
    'world-player-a48-nonmatch-false-8fb-guard-catalog-2026-06-26',
    catalogId
  );
  staticMap.primaryCatalogs.coverage = insertAfter(
    staticMap.primaryCatalogs.coverage,
    'world-residual-proof-consumer-catalog-2026-06-26',
    catalogId
  );
  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.push('Use world-bank7-sidecar-alias-proof-catalog-2026-06-26 to keep r0749 quarantined unless a direct bank-7 _DATA_1E337_ consumer is traced.');
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, rom, asmText);
  const annotated = apply ? applyCatalog(mapData, catalog) : [];

  if (apply) {
    mapData.fragmentCatalogs = (mapData.fragmentCatalogs || []).filter(item => item.id !== catalogId);
    mapData.fragmentCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank7_sidecar_alias_proof_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      catalogId,
      sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotated.length,
      },
      references: catalog.references,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      annotatedRegions: annotated,
    });
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotated.length,
    },
    references: catalog.references,
  }, null, 2));
}

main();
