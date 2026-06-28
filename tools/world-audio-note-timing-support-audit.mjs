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
const catalogId = 'world-audio-note-timing-support-catalog-2026-06-25';
const reportId = 'audio-note-timing-support-audit-2026-06-25';
const toolName = 'tools/world-audio-note-timing-support-audit.mjs';

const ramCatalogId = 'world-audio-ram-state-catalog-2026-06-25';
const supportUseCatalogId = 'world-audio-support-table-use-catalog-2026-06-25';

const TABLE_ROM_OFFSET = 0x0FE44;
const TABLE_Z80_ADDRESS = 0xBE44;
const TABLE_SIZE = 0x40;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, width = 5) {
  return '0x' + value.toString(16).toUpperCase().padStart(width, '0');
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
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

function findContainingRegion(mapData, start, endExclusive) {
  return (mapData.regions || []).find(region => {
    const offset = parseHex(region.offset);
    const size = region.size || 0;
    return offset != null && offset <= start && offset + size >= endExclusive;
  }) || null;
}

function fieldByName(ramCatalog, name) {
  return (ramCatalog.streamChannelStruct?.fields || []).find(field => field.name === name) || null;
}

function fieldRef(ramCatalog, name, relationship) {
  const field = fieldByName(ramCatalog, name);
  return {
    kind: 'stream_field',
    fieldName: name,
    offset: field?.offset ?? null,
    size: field?.size || 1,
    relationship,
    confidence: field?.confidence || 'medium',
  };
}

function buildCatalog(mapData) {
  const ramCatalog = requireCatalog(mapData, ramCatalogId);
  const supportUseCatalog = requireCatalog(mapData, supportUseCatalogId);
  const sourceRegion = findContainingRegion(mapData, TABLE_ROM_OFFSET, TABLE_ROM_OFFSET + TABLE_SIZE);
  const requiredFields = [
    'support_table_output_or_note_shift',
    'note_delay_counter',
    'note_delay_reload_or_low_period_seed',
    'secondary_delay_counter',
    'secondary_delay_reload',
  ];
  const missingFields = requiredFields.filter(name => !fieldByName(ramCatalog, name));
  const validationIssues = [];
  if (missingFields.length) validationIssues.push(`Missing stream field(s): ${missingFields.join(', ')}`);
  if (!sourceRegion) validationIssues.push(`No region covers high-bit note timing table ${hex(TABLE_ROM_OFFSET)}-${hex(TABLE_ROM_OFFSET + TABLE_SIZE - 1)}`);
  if (supportUseCatalog.summary?.outOfRangeF5EventCount !== 0) {
    validationIssues.push(`${supportUseCatalogId} reports out-of-window $F5 lookups`);
  }

  const timingTable = {
    id: 'audio_high_bit_note_timing_table_BE44',
    kind: 'audio_high_bit_note_timing_table',
    romOffset: hex(TABLE_ROM_OFFSET),
    z80Address: hex(TABLE_Z80_ADDRESS, 4),
    sizeBytes: TABLE_SIZE,
    indexRange: { min: 0, max: TABLE_SIZE - 1, count: TABLE_SIZE },
    indexFormula: 'index = stream_byte & 0x3F for high-bit non-control bytes 0x80-0xEF',
    sourceRegion: sourceRegion ? {
      id: sourceRegion.id,
      offset: sourceRegion.offset,
      size: sourceRegion.size || 0,
      type: sourceRegion.type || 'unknown',
      name: sourceRegion.name || '',
    } : null,
    valuePolicy: 'Timing table bytes are read only in tools/browser from the user-loaded ROM; values are not embedded in metadata.',
    confidence: validationIssues.length ? 'medium' : 'high',
  };

  const supportTransform = {
    sourceField: fieldRef(ramCatalog, 'support_table_output_or_note_shift', 'selects high-bit note primary-delay transform'),
    inputValue: 'base_timing = timingTable[stream_byte & 0x3F]',
    cases: [
      {
        supportCondition: 'support == 0',
        primaryDelayFormula: 'base_timing',
        secondaryDelayFormula: 'base_timing',
        evidence: 'ASM lines 21887-21890 branch directly to the store path when stream field +7 is zero.',
      },
      {
        supportCondition: 'support == 1',
        primaryDelayFormula: 'base_timing >> 1',
        secondaryDelayFormula: 'base_timing',
        evidence: 'ASM lines 21891-21893 shift E right once and store it when the decremented support value reaches zero.',
      },
      {
        supportCondition: 'support == 2',
        primaryDelayFormula: 'base_timing >> 2',
        secondaryDelayFormula: 'base_timing',
        evidence: 'ASM lines 21891-21896 shift E right twice and store it when the second decrement reaches zero.',
      },
      {
        supportCondition: 'support >= 3',
        primaryDelayFormula: 'base_timing - (base_timing >> 2)',
        secondaryDelayFormula: 'base_timing',
        evidence: 'ASM lines 21897-21899 reload A from D and subtract the twice-shifted E value before storing.',
      },
    ],
    outputFields: [
      fieldRef(ramCatalog, 'note_delay_counter', 'primary transformed timing byte written after high-bit note table lookup'),
      fieldRef(ramCatalog, 'note_delay_reload_or_low_period_seed', 'primary transformed timing byte reload/source written after high-bit note table lookup'),
      fieldRef(ramCatalog, 'secondary_delay_counter', 'untransformed base timing byte written after high-bit note table lookup'),
      fieldRef(ramCatalog, 'secondary_delay_reload', 'untransformed base timing byte reload/source written after high-bit note table lookup'),
    ],
    evidence: [
      'ASM lines 21884-21886 load the timing table byte into both D and E.',
      'ASM lines 21887-21899 use stream field +7 to transform E while D keeps the untransformed base timing.',
      'ASM lines 21901-21909 write D into stream fields +3/+4 and E into fields +2/+1.',
    ],
  };

  const normalReloadPath = {
    kind: 'audio_normal_note_delay_reload_copy',
    appliesTo: 'non-high-bit note/rest bytes after the stream has not dispatched to the high-bit timing-table path',
    copies: [
      {
        source: fieldRef(ramCatalog, 'note_delay_reload_or_low_period_seed', 'primary delay reload/source copied during normal note/rest handling'),
        target: fieldRef(ramCatalog, 'note_delay_counter', 'primary delay counter reloaded during normal note/rest handling'),
      },
      {
        source: fieldRef(ramCatalog, 'secondary_delay_reload', 'secondary delay reload/source copied during normal note/rest handling'),
        target: fieldRef(ramCatalog, 'secondary_delay_counter', 'secondary delay counter reloaded during normal note/rest handling'),
      },
    ],
    confidence: validationIssues.length ? 'medium' : 'high',
    evidence: [
      'ASM lines 21913-21918 copy stream field +4 into field +3 for non-high-bit note/rest handling.',
      'ASM lines 21919-21922 copy stream field +2 into field +1 before continuing normal note/rest handling.',
      'This path runs after the high-bit/control dispatch test falls through at ASM lines 21869-21874.',
    ],
  };

  const summary = {
    timingTableCount: 1,
    timingTableBytes: TABLE_SIZE,
    supportTransformCaseCount: supportTransform.cases.length,
    outputFieldCount: supportTransform.outputFields.length,
    normalReloadCopyCount: normalReloadPath.copies.length,
    supportUseUniqueF5EventCount: supportUseCatalog.summary?.uniqueStreamF5EventCount ?? null,
    supportUsePrefixEscapeF5EventCount: supportUseCatalog.summary?.prefixEscapeF5EventCount ?? null,
    validationIssueCount: validationIssues.length,
    assetPolicy: 'Metadata only: table offsets, index formula, transform formulas, RAM field names, counts, and evidence. No ROM bytes, timing values, decoded music, or audio samples are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [ramCatalogId, supportUseCatalogId],
    assetPolicy: summary.assetPolicy,
    summary,
    timingTable,
    supportTransform,
    normalReloadPath,
    validationIssues,
    evidence: [
      '_LABEL_C191_ high-bit note path masks the stream byte with $3F and indexes Z80 $BE44, which maps to ROM 0x0FE44.',
      '_LABEL_C191_ reads support_table_output_or_note_shift from stream field +7 immediately after the timing lookup.',
      `${supportUseCatalogId} confirms all known $F5 support lookups stay inside the handler-addressable support window.`,
    ],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_note_timing_support_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      timingTable: catalog.timingTable,
      supportTransform: catalog.supportTransform,
      normalReloadPath: catalog.normalReloadPath,
      validationIssues: catalog.validationIssues,
      nextLeads: [
        'Use this catalog in the browser preview to compute high-bit note delay fields from the local ROM when support state is known.',
        'Trace how stream fields +1/+2/+3/+4 gate event fetch over subsequent frames so the audio interpreter can model note duration exactly.',
        'Cross-check high-bit note timing behavior against PSG/FM output phase changes once the branch-aware stream interpreter exists.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    validationIssues: catalog.validationIssues,
  }, null, 2));
}

main();
