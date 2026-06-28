#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-audio-crossbank-fragment-catalog-2026-06-24';
const reportId = 'audio-crossbank-fragment-audit-2026-06-24';

const REGION_UPDATES = [
  {
    offset: 0x06F00,
    inferredType: 'music',
    role: 'crossbank_music_pointer_target',
    confidence: 'high',
    summary: 'Two-byte bank-1 fragment referenced from a bank-3 music stream record, not a screen program.',
    evidence: [
      'ASM lines 21589-21600: _LABEL_C04D_ indexes _DATA_D139_ as a song/audio table and follows the selected pointer.',
      'ASM lines 21657-21683: _LABEL_C09F_ reads _RAM_C222_, indexes _DATA_D139_, and follows the selected song/audio pointer during updates.',
      'ASM lines 23207-23216 define _DATA_D139_ as a 62-entry pointer table indexed by _RAM_C222_.',
      'ASM lines 23383-23389 show the seventh _DATA_D139_ entry contains a one-entry pointer table that points to _DATA_6F00_.',
      'ASM lines 15753-15756 identify _DATA_6F00_ as the target reached from that music pointer table.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x06F00.',
    ],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
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

function shouldRetype(region, inferredType) {
  if (!region) return false;
  const current = region.type || 'unknown';
  if (current === inferredType) return false;
  if (inferredType === 'music') return ['screen_prog', 'unknown', 'raw_byte', 'data_table'].includes(current);
  return false;
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-audio-crossbank-fragment-audit.mjs',
    summary: {
      regionsAudited: REGION_UPDATES.length,
      crossBankTargets: REGION_UPDATES.length,
      sourceTable: '_DATA_D139_',
      sourceTableRomOffset: hex(0x0D139),
      driverRoutines: ['_LABEL_C04D_', '_LABEL_C09F_'],
      assetPolicy: 'Metadata only: offsets, labels, routine references, table references, region roles, and confidence. No ROM bytes, decoded music, audio samples, graphics, or text are embedded.',
    },
    entries: REGION_UPDATES.map(item => ({
      offset: hex(item.offset),
      inferredType: item.inferredType,
      role: item.role,
      confidence: item.confidence,
      summary: item.summary,
      evidence: item.evidence,
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
  };
}

function annotateRegion(region, item) {
  const typeBefore = region.type || 'unknown';
  const changedType = shouldRetype(region, item.inferredType);
  if (changedType) region.type = item.inferredType;
  region.analysis = region.analysis || {};
  region.analysis.audioCrossbankFragmentAudit = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: 'tools/world-audio-crossbank-fragment-audit.mjs',
  };
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    typeBefore,
    typeAfter: region.type || typeBefore,
    changedType,
    kind: item.role,
  };
}

function applyAnnotations(mapData, catalog) {
  const changed = [];
  const evidenceOnly = [];
  const missing = [];
  for (const entry of catalog.entries) {
    const item = REGION_UPDATES.find(update => hex(update.offset) === entry.offset);
    const region = findExactRegion(mapData, parseInt(entry.offset, 16));
    if (!region || !item) {
      missing.push({ offset: entry.offset, inferredType: entry.inferredType, role: entry.role });
      continue;
    }
    const result = annotateRegion(region, item);
    if (result.changedType) changed.push(result);
    else evidenceOnly.push(result);
  }
  return { changed, evidenceOnly, missing };
}

function changedRegionRefs(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.audioCrossbankFragmentAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.audioCrossbankFragmentAudit.kind,
      confidence: region.analysis.audioCrossbankFragmentAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const changes = applyAnnotations(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_crossbank_fragment_audit',
      generatedAt: now,
      tool: 'tools/world-audio-crossbank-fragment-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changedRegionRefs(mapData).length,
        retypeChangesThisRun: changes.changed.length,
        evidenceOnlyRegions: changes.evidenceOnly.length,
        missingRegions: changes.missing.length,
      },
      changedRegions: changedRegionRefs(mapData),
      retypeChangesThisRun: changes.changed,
      evidenceOnlyRegions: changes.evidenceOnly,
      missingRegions: changes.missing,
      nextLeads: [
        'Extend the read-only audio parser to report cross-bank pointer targets referenced from bank-3 song streams.',
        'Trace the one-entry pointer record at 0x0D860 through the audio command handlers before naming the exact musical role of 0x06F00.',
        'Audit other small screen_prog false positives for audio-stream or entity-table references before keeping them as render roots.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    retypeChanges: changes.changed,
    evidenceOnlyRegions: changes.evidenceOnly,
    missingRegions: changes.missing,
  }, null, 2));
}

main();
