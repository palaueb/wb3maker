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
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const candidateCatalogId = 'world-graphics-loader-candidate-catalog-2026-06-25';
const catalogId = 'world-graphics-loader-candidate-consumer-catalog-2026-06-25';
const reportId = 'graphics-loader-candidate-consumer-audit-2026-06-25';
const toolName = 'tools/world-graphics-loader-candidate-consumer-audit.mjs';

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function z80Hex(n) {
  return '$' + n.toString(16).toUpperCase().padStart(4, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(value) {
  if (typeof value === 'number') return value;
  return parseInt(value, 16);
}

function bankedZ80Address(romOffset) {
  if (romOffset < 0x4000) return romOffset;
  return 0x8000 + (romOffset % 0x4000);
}

function labelForOffset(offset) {
  return `_DATA_${offset.toString(16).toUpperCase()}_`;
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function regionBounds(region) {
  const start = offsetOf(region.offset);
  return { start, end: start + (region.size || 0) };
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

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
  }) || null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function parseAsmLabels(asmText) {
  const labels = [];
  const lines = asmText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_(?:DATA|LABEL)_([0-9A-F]+)_):/i.exec(cleanCode(lines[i]));
    if (!match) continue;
    const offset = parseInt(match[2], 16);
    labels.push({
      label: match[1],
      offset,
      z80Address: bankedZ80Address(offset),
      asmLine: i + 1,
    });
  }
  return labels;
}

function findLabelRefs(asmText, label) {
  const refs = [];
  const lines = asmText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const code = cleanCode(lines[i]);
    if (!code || !code.includes(label)) continue;
    if (code.startsWith(`${label}:`)) continue;
    if (/^\.incbin\b/i.test(code)) continue;
    refs.push({
      asmLine: i + 1,
      code,
      followedBy8fbCall: lines.slice(i + 1, i + 4).some(line => /\bcall\s+_LABEL_8FB_\b/i.test(cleanCode(line))),
      followedBy998Call: lines.slice(i + 1, i + 4).some(line => /\bcall\s+_LABEL_998_\b/i.test(cleanCode(line))),
    });
  }
  return refs;
}

function rawWordOccurrences(rom, word) {
  const lo = word & 0xFF;
  const hi = word >> 8;
  const occurrences = [];
  for (let offset = 0; offset + 1 < rom.length; offset++) {
    if (rom[offset] !== lo || rom[offset + 1] !== hi) continue;
    occurrences.push(offset);
  }
  return occurrences;
}

function candidateStatus(candidate, directRefs, aliases) {
  const directConsumer = directRefs.find(ref => ref.followedBy8fbCall || ref.followedBy998Call) || null;
  if (directConsumer) {
    return {
      status: 'confirmed_consumer_ref',
      confidence: 'high',
      promotionAllowed: true,
      reason: `Direct reference to ${candidate.offset} is followed by a tile loader call.`,
    };
  }
  const aliasConsumer = aliases.flatMap(alias => alias.refs.map(ref => ({ alias, ref })))
    .find(item => item.ref.followedBy8fbCall || item.ref.followedBy998Call) || null;
  if (aliasConsumer) {
    return {
      status: 'no_confirmed_consumer_bank_alias_collision',
      confidence: 'high',
      promotionAllowed: false,
      reason: `The only loader-adjacent $${aliasConsumer.alias.z80Address.toString(16).toUpperCase().padStart(4, '0')} reference resolves to alias ${aliasConsumer.alias.label}, not this candidate label.`,
    };
  }
  return {
    status: 'no_confirmed_consumer_ref',
    confidence: 'medium',
    promotionAllowed: false,
    reason: 'No direct ASM reference to the candidate label is followed by _LABEL_8FB_ or _LABEL_998_.',
  };
}

function buildCatalog(rom, asmText, mapData) {
  const candidateCatalog = requireCatalog(mapData, candidateCatalogId);
  const labels = parseAsmLabels(asmText);
  const records = [];

  for (const candidate of candidateCatalog.candidates || []) {
    const offset = offsetOf(candidate.offset);
    const z80Address = bankedZ80Address(offset);
    const candidateLabel = labelForOffset(offset);
    const directRefs = findLabelRefs(asmText, candidateLabel);
    const aliases = labels
      .filter(label => label.z80Address === z80Address)
      .map(label => ({
        label: label.label,
        offset: hex(label.offset),
        z80Address: label.z80Address,
        asmLine: label.asmLine,
        isCandidateLabel: label.label === candidateLabel,
        refs: findLabelRefs(asmText, label.label),
      }));
    const rawOccurrences = rawWordOccurrences(rom, z80Address).map(offset => ({
      romOffset: hex(offset),
      containingRegion: regionRef(findContainingRegion(mapData, offset)),
    }));
    const status = candidateStatus(candidate, directRefs, aliases.filter(alias => alias.label !== candidateLabel));
    records.push({
      candidateId: candidate.id,
      candidateLabel,
      candidateOffset: candidate.offset,
      candidateRegion: candidate.containingRegion,
      format: candidate.format,
      z80Address: z80Hex(z80Address),
      status: status.status,
      confidence: status.confidence,
      promotionAllowed: status.promotionAllowed,
      reason: status.reason,
      directCandidateRefCount: directRefs.length,
      directCandidateRefs: directRefs.slice(0, 12),
      aliasCount: aliases.length,
      aliases: aliases.map(alias => ({
        label: alias.label,
        offset: alias.offset,
        z80Address: z80Hex(alias.z80Address),
        asmLine: alias.asmLine,
        isCandidateLabel: alias.isCandidateLabel,
        refCount: alias.refs.length,
        loaderAdjacentRefCount: alias.refs.filter(ref => ref.followedBy8fbCall || ref.followedBy998Call).length,
        refs: alias.refs.slice(0, 12),
      })),
      rawZ80WordOccurrences: rawOccurrences,
      rawZ80WordOccurrenceCount: rawOccurrences.length,
      evidence: [
        `Candidate label ${candidateLabel} is checked for direct ASM references outside its definition.`,
        `Banked Z80 address ${z80Hex(z80Address)} can alias multiple ROM labels in different banks; aliases are compared before promotion.`,
        'A candidate is not promoted unless a direct candidate-label reference or equivalent render-path consumer reaches _LABEL_8FB_/_LABEL_998_.',
      ],
    });
  }

  const summary = {
    sourceCatalogs: [candidateCatalogId],
    candidateCount: records.length,
    confirmedConsumerCount: records.filter(record => record.status === 'confirmed_consumer_ref').length,
    noConfirmedConsumerCount: records.filter(record => record.status !== 'confirmed_consumer_ref').length,
    bankAliasCollisionCount: records.filter(record => record.status === 'no_confirmed_consumer_bank_alias_collision').length,
    promotionAllowedCount: records.filter(record => record.promotionAllowed).length,
    assetPolicy: 'Metadata only: candidate offsets, ASM labels/line numbers, banked pointer aliases, raw pointer occurrence offsets, and promotion decisions. No ROM bytes, decoded tiles, graphics, or rendered assets are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [candidateCatalogId],
    summary,
    records,
    evidence: [
      `${candidateCatalogId} supplies shape-based candidate tile-loader streams.`,
      'This audit checks direct ASM label references and banked Z80 address aliases before allowing semantic promotion.',
      'A raw banked pointer word is evidence only when its bank context or ASM label resolves to the candidate, not merely to the same Z80 address.',
    ],
  };
}

function annotateRegions(mapData, catalog) {
  const annotated = [];
  for (const record of catalog.records) {
    const region = findRegionById(mapData, record.candidateRegion?.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.graphicsLoaderCandidateConsumerAudit = {
      catalogId,
      kind: 'candidate_consumer_resolution',
      status: record.status,
      confidence: record.confidence,
      candidateLabel: record.candidateLabel,
      candidateOffset: record.candidateOffset,
      format: record.format,
      z80Address: record.z80Address,
      promotionAllowed: record.promotionAllowed,
      reason: record.reason,
      directCandidateRefCount: record.directCandidateRefCount,
      aliasCount: record.aliasCount,
      aliases: record.aliases,
      rawZ80WordOccurrenceCount: record.rawZ80WordOccurrenceCount,
      rawZ80WordOccurrences: record.rawZ80WordOccurrences,
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (region.analysis.graphicsLoaderCandidateAudit) {
      region.analysis.graphicsLoaderCandidateAudit.consumerStatus = record.status;
      region.analysis.graphicsLoaderCandidateAudit.promotionAllowed = record.promotionAllowed;
    }
    if (region.analysis.inferred && record.status === 'no_confirmed_consumer_bank_alias_collision') {
      region.analysis.inferred.supersededBy = {
        catalogId,
        reason: 'The inferred incoming reference is contradicted by direct ASM label search; the loader-adjacent $A337 reference resolves to _DATA_12337_, not _DATA_1E337_.',
        confidence: 'high',
      };
    }
    annotated.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      candidateId: record.candidateId,
      status: record.status,
      promotionAllowed: record.promotionAllowed,
    });
  }
  return annotated;
}

function main() {
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, asmText, mapData);
  const annotatedRegions = apply ? annotateRegions(mapData, catalog) : [];

  if (apply) {
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'graphics_loader_candidate_consumer_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      records: catalog.records,
      annotatedRegions,
      validationIssues: [],
      nextLeads: [
        'Do not promote bank-alias candidates until the reference resolves to the candidate label in the active bank context.',
        'Use the confirmed _DATA_12337_ reference at _LABEL_1E200_ as the real ending/special-sequence 8FB loader path.',
        'Continue tracing unreferenced graphics spans through direct VDP copy and decompression paths rather than relying only on byte-shape scans.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    records: catalog.records,
    annotatedRegions: annotatedRegions.length,
  }, null, 2));
}

main();
