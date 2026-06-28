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
const catalogId = 'world-bank2-effect-script-catalog-2026-06-24';
const reportId = 'bank2-effect-script-audit-2026-06-24';

const REGION_UPDATES = [
  {
    offset: 0xBBDE,
    inferredType: 'effect_script',
    role: 'timed_effect_command_stream',
    confidence: 'high',
    summary: '_LABEL_BB64_ seeds _DATA_BBDE_ into the _LABEL_BFED_/_LABEL_BFBA_ timed command stream interpreter.',
    evidence: [
      'ASM line 20983 loads HL with _DATA_BBDE_.',
      'ASM line 20984 calls _LABEL_BFED_ to initialize the stream state.',
      'ASM lines 21534-21542: _LABEL_BFED_ reads the first byte into _RAM_CFF0_, stores the remaining stream pointer in _RAM_CFEE_, and clears stream status flags.',
      'ASM lines 21500-21531: _LABEL_BFBA_ advances the stream through _RAM_CFEE_, updates _RAM_CF95_ and _RAM_D279_, handles delays through _RAM_CFF0_, and sets _RAM_D226_ when the stream terminates.',
    ],
  },
  {
    offset: 0xBFFD,
    inferredType: 'null',
    role: 'bank2_terminal_padding',
    confidence: 'medium',
    summary: 'Three-byte terminal padding immediately after _LABEL_BFED_ and before the bank 3 boundary; not a screen program.',
    evidence: [
      'ASM lines 21534-21542 define the final routine in bank 2.',
      'ASM lines 21544-21547 mark 0xBFFD-0xBFFF as data immediately before .BANK 3.',
      'No ASM label or routine reference treats 0xBFFD as a screen-program root; it is only a false decoder candidate from byte-pattern analysis.',
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

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-bank2-effect-script-audit.mjs',
    summary: {
      regionsAudited: REGION_UPDATES.length,
      streamInitializer: '_LABEL_BFED_',
      streamUpdater: '_LABEL_BFBA_',
      streamPointerRam: '_RAM_CFEE_',
      delayRam: '_RAM_CFF0_',
      completionRam: '_RAM_D226_',
      assetPolicy: 'Metadata only: offsets, labels, routine references, stream roles, RAM variables, and confidence. No ROM bytes, decoded graphics, text, or gameplay assets are embedded.',
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

function shouldRetype(region, inferredType) {
  if (!region) return false;
  const current = region.type || 'unknown';
  if (current === inferredType) return false;
  if (inferredType === 'effect_script') return ['screen_prog', 'data_table', 'unknown', 'raw_byte'].includes(current);
  if (inferredType === 'null') return ['screen_prog', 'unknown', 'raw_byte', 'data_table'].includes(current);
  return false;
}

function annotateRegion(region, item) {
  const typeBefore = region.type || 'unknown';
  const changedType = shouldRetype(region, item.inferredType);
  if (changedType) region.type = item.inferredType;
  region.analysis = region.analysis || {};
  region.analysis.bank2EffectScriptAudit = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: 'tools/world-bank2-effect-script-audit.mjs',
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
  for (const item of catalog.entries) {
    const region = findExactRegion(mapData, parseInt(item.offset, 16));
    if (!region) {
      missing.push({ offset: item.offset, inferredType: item.inferredType, role: item.role });
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
    .filter(region => region.analysis?.bank2EffectScriptAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.bank2EffectScriptAudit.kind,
      confidence: region.analysis.bank2EffectScriptAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const changes = applyAnnotations(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.effectScriptCatalogs = (mapData.effectScriptCatalogs || []).filter(item => item.id !== catalogId);
    mapData.effectScriptCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_effect_script_audit',
      generatedAt: now,
      tool: 'tools/world-bank2-effect-script-audit.mjs --apply',
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
        'Create a read-only parser for _LABEL_BFBA_ command streams that reports command counts, delay ranges, and termination status without exposing raw bytes.',
        'Trace _RAM_CF95_ and _RAM_D279_ consumers to name the timed effect fields controlled by _DATA_BBDE_.',
        'Audit other streams passed through _LABEL_BFED_ before adding any JavaScript recreation module.',
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
