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
const catalogId = 'world-audio-support-table-catalog-2026-06-25';
const reportId = 'audio-support-table-audit-2026-06-25';
const toolName = 'tools/world-audio-support-table-audit.mjs';

const opcodeCatalogId = 'world-audio-opcode-state-effect-catalog-2026-06-25';
const traceSemanticsCatalogId = 'world-audio-event-trace-semantics-catalog-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function hex(value, width) {
  return '0x' + value.toString(16).toUpperCase().padStart(width, '0');
}

function findRegionForRange(mapData, start, endExclusive) {
  return (mapData.regions || []).find(region => {
    const off = typeof region.offset === 'number'
      ? region.offset
      : parseInt(String(region.offset || '').replace(/^0x/i, ''), 16);
    const size = typeof region.size === 'number'
      ? region.size
      : parseInt(String(region.size || '0'), 10);
    return Number.isInteger(off) && Number.isInteger(size) &&
      off <= start && off + size >= endExclusive;
  }) || null;
}

function buildCatalog(mapData) {
  const opcodeCatalog = requireCatalog(mapData, opcodeCatalogId);
  const traceCatalog = requireCatalog(mapData, traceSemanticsCatalogId);
  const f5 = (opcodeCatalog.opcodes || []).find(opcode => opcode.opcode === '$F5');
  if (!f5) throw new Error(`Missing $F5 in ${opcodeCatalogId}`);

  const handlerStart = 0x0C412;
  const handlerEnd = 0x0C427;
  const tableStart = 0x0C423;
  const tableZ80 = 0x8423;
  const embeddedPrefixSize = handlerEnd - tableStart;
  const handlerAddressableSize = 0x100;
  const handlerAddressableEnd = tableStart + handlerAddressableSize;
  const sourceRegion = findRegionForRange(mapData, tableStart, handlerEnd);
  const traceEntry = (traceCatalog.traceSemantics || []).find(entry => entry.eventKey === '$F5');
  const lookupOperation = (traceEntry?.operations || []).find(operation => operation.kind === 'lookup_store');
  const validationIssues = [];
  if (f5.handlerRomOffset !== hex(handlerStart, 5)) {
    validationIssues.push(`$F5 handler offset is ${f5.handlerRomOffset}; expected ${hex(handlerStart, 5)}`);
  }
  if (f5.handlerEndExclusive !== hex(handlerEnd, 5)) {
    validationIssues.push(`$F5 handler end is ${f5.handlerEndExclusive}; expected ${hex(handlerEnd, 5)}`);
  }
  if (lookupOperation?.lookup !== 'bank3_support_table_8423') {
    validationIssues.push('$F5 trace semantics does not reference bank3_support_table_8423');
  }
  if (!sourceRegion) validationIssues.push('No containing source region covers the embedded support table range');

  const supportTables = [
    {
      id: 'audio_support_table_8423',
      lookupId: 'bank3_support_table_8423',
      kind: 'audio_support_lookup_table',
      romOffset: hex(tableStart, 5),
      z80Address: hex(tableZ80, 4),
      sizeBytes: handlerAddressableSize,
      handlerAddressableRomRange: {
        start: hex(tableStart, 5),
        endInclusive: hex(handlerAddressableEnd - 1, 5),
        sizeBytes: handlerAddressableSize,
      },
      handlerAddressableZ80Range: {
        start: hex(tableZ80, 4),
        endInclusive: hex(tableZ80 + handlerAddressableSize - 1, 4),
        sizeBytes: handlerAddressableSize,
      },
      handlerAddressableIndexRange: { min: 0, max: handlerAddressableSize - 1, count: handlerAddressableSize },
      embeddedPrefixBeforeNextHandler: {
        romRange: {
          start: hex(tableStart, 5),
          endInclusive: hex(handlerEnd - 1, 5),
          sizeBytes: embeddedPrefixSize,
        },
        z80Range: {
          start: hex(tableZ80, 4),
          endInclusive: hex(tableZ80 + embeddedPrefixSize - 1, 4),
          sizeBytes: embeddedPrefixSize,
        },
        indexRange: { min: 0, max: embeddedPrefixSize - 1, count: embeddedPrefixSize },
        confidence: 'high',
        note: 'This is only the inline prefix before the next opcode handler, not the full handler-addressable lookup range.',
      },
      indexRange: { min: 0, max: handlerAddressableSize - 1, count: handlerAddressableSize },
      sourceRegion: sourceRegion ? {
        id: sourceRegion.id,
        offset: sourceRegion.offset,
        size: sourceRegion.size,
        type: sourceRegion.type,
        name: sourceRegion.name || '',
      } : null,
      consumer: {
        opcode: '$F5',
        opcodeName: f5.name || '',
        handlerRomOffset: f5.handlerRomOffset,
        handlerEndExclusive: f5.handlerEndExclusive,
        targetFieldName: lookupOperation?.target?.fieldName || '',
      },
      confidence: validationIssues.length ? 'medium' : 'high',
      valuePolicy: 'Table byte values are resolved only in the live analyzer from the user-loaded ROM and are not stored in project metadata.',
      evidence: [
        '$F5 handler at ROM 0x0C412 reads one argument byte from BC and increments BC.',
        'ASM bytes at ROM 0x0C414-0x0C41B add $23 to the argument and form DE=$84xx, making Z80 $8423 the table base.',
        'ASM bytes at ROM 0x0C41C-0x0C41E read A=(DE), increment HL, and store A into the stream field.',
        'The ADD/ADC address calculation supports indices 0-255, mapping to Z80 $8423-$8522 / ROM 0x0C423-0x0C522.',
        'The next opcode handler starts at ROM 0x0C427, so indices 0-3 are only the embedded prefix before the following handler bytes.',
      ],
      notes: [
        'Some streams intentionally or accidentally index past the four-byte embedded prefix; the lookup is modeled as a handler-addressable support window rather than an isolated four-byte table.',
        'This catalog intentionally records only offsets, size, index range, and evidence.',
      ],
    },
  ];

  const summary = {
    supportLookupWindowCount: supportTables.length,
    supportTableCount: supportTables.length,
    handlerAddressableBytes: handlerAddressableSize,
    embeddedPrefixBytes: embeddedPrefixSize,
    totalBytesModeled: handlerAddressableSize,
    validationIssueCount: validationIssues.length,
    f5LookupAddressableIndexCount: handlerAddressableSize,
    embeddedPrefixIndexCount: embeddedPrefixSize,
    assetPolicy: 'Metadata only: lookup-window offsets, size, index ranges, consumer opcode, field name, and evidence. No ROM bytes, decoded music, audio samples, or PSG/FM register data are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [opcodeCatalogId, traceSemanticsCatalogId],
    assetPolicy: summary.assetPolicy,
    summary,
    supportTables,
    validationIssues,
    evidence: [
      `${opcodeCatalogId} confirms $F5 dispatch to ROM 0x0C412 and handler end at 0x0C427.`,
      `${traceSemanticsCatalogId} names the $F5 lookup_store target as support_table_output_or_note_shift.`,
      'ASM line 22142 contains the handler bytes that build DE=$8423+index and read A=(DE).',
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
      type: 'audio_support_table_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      validationIssues: catalog.validationIssues,
      nextLeads: [
        'Use this catalog to resolve $F5 lookup_store operations in the live analyzer without persisting table bytes.',
        'Scan all decoded streams for $F5 argument indices that leave the embedded prefix and document whether they intentionally use the following handler byte window.',
        'Trace how support_table_output_or_note_shift changes note/rest timing and pitch paths before promoting it into the audio interpreter.',
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
