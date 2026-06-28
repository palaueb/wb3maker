#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_OPCODE_ARG_BYTES,
  AUDIO_OPCODE_METADATA_BY_OPCODE,
} from './world-audio-opcode-metadata.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-audio-support-table-use-catalog-2026-06-25';
const reportId = 'audio-support-table-use-audit-2026-06-25';
const toolName = 'tools/world-audio-support-table-use-audit.mjs';

const audioCatalogId = 'world-audio-catalog-2026-06-24';
const streamGraphCatalogId = 'world-audio-stream-graph-catalog-2026-06-25';
const supportTableCatalogId = 'world-audio-support-table-catalog-2026-06-25';

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

function parseStreamF5Uses(rom, stream) {
  const start = parseHex(stream.startOffset);
  const events = [];
  const warnings = [];
  if (start == null || start < 0 || start >= rom.length) {
    return { events, warnings: [`stream ${stream.id || stream.startOffset} has invalid start offset`] };
  }

  let pc = start;
  for (let step = 0; step < 1024 && pc < rom.length; step++) {
    const opOffset = pc;
    const b = rom[pc++];
    if (b === 0xFF) break;
    if (b < 0xF0) continue;

    const opcode = '$' + b.toString(16).toUpperCase().padStart(2, '0');
    const meta = AUDIO_OPCODE_METADATA_BY_OPCODE.get(b) || null;
    const argBytes = meta?.argBytes ?? AUDIO_OPCODE_ARG_BYTES.get(b) ?? 0;
    if (pc + argBytes > rom.length) {
      warnings.push(`${stream.id || stream.startOffset}: opcode ${opcode} at ${hex(opOffset)} is truncated`);
      break;
    }

    if (b === 0xF5) {
      events.push({
        streamId: stream.id || '',
        streamStartOffset: stream.startOffset,
        opcodeOffset: hex(opOffset),
        index: argBytes >= 1 ? rom[pc] : null,
        region: stream.region || null,
      });
    }

    pc += argBytes;
    if (meta?.parserAction === 'stop_segment' || meta?.parserAction === 'branch_and_stop_segment') break;
  }

  return { events, warnings };
}

function compactStreamUse(stream, events, range) {
  const validCount = events.filter(event => event.index >= range.min && event.index <= range.max).length;
  return {
    streamId: stream.id || '',
    startOffset: stream.startOffset,
    endOffset: stream.endOffset,
    region: stream.region || null,
    f5EventCount: events.length,
    validEventCount: validCount,
    outOfRangeEventCount: events.length - validCount,
  };
}

function buildCatalog(rom, mapData) {
  const audioCatalog = requireCatalog(mapData, audioCatalogId);
  const supportCatalog = requireCatalog(mapData, supportTableCatalogId);
  const graphCatalog = findCatalog(mapData, streamGraphCatalogId);
  const table = (supportCatalog.supportTables || []).find(item => item.lookupId === 'bank3_support_table_8423');
  if (!table) throw new Error(`Missing bank3_support_table_8423 in ${supportTableCatalogId}`);
  const range = {
    min: table.handlerAddressableIndexRange?.min ?? table.indexRange?.min ?? 0,
    max: table.handlerAddressableIndexRange?.max ?? table.indexRange?.max ?? -1,
    count: table.handlerAddressableIndexRange?.count ?? table.indexRange?.count ?? table.sizeBytes ?? 0,
  };
  const prefixRange = {
    min: table.embeddedPrefixBeforeNextHandler?.indexRange?.min ?? 0,
    max: table.embeddedPrefixBeforeNextHandler?.indexRange?.max ?? -1,
    count: table.embeddedPrefixBeforeNextHandler?.indexRange?.count ?? 0,
  };

  const streamUses = [];
  const outOfRangeEvents = [];
  const prefixEscapeEvents = [];
  const parseWarnings = [];
  const countMismatches = [];
  const distinctValidIndices = new Set();
  let f5EventCount = 0;

  for (const stream of audioCatalog.streams || []) {
    const expected = stream.opcodeCounts?.['$F5'] || 0;
    if (!expected) continue;
    const parsed = parseStreamF5Uses(rom, stream);
    parseWarnings.push(...parsed.warnings);
    if (parsed.events.length !== expected) {
      countMismatches.push({
        streamId: stream.id || '',
        startOffset: stream.startOffset,
        expectedF5EventCount: expected,
        parsedF5EventCount: parsed.events.length,
      });
    }
    f5EventCount += parsed.events.length;
    for (const event of parsed.events) {
      if (event.index >= range.min && event.index <= range.max) {
        distinctValidIndices.add(event.index);
        if (prefixRange.count && (event.index < prefixRange.min || event.index > prefixRange.max)) {
          prefixEscapeEvents.push({
            streamId: event.streamId,
            streamStartOffset: event.streamStartOffset,
            opcodeOffset: event.opcodeOffset,
            embeddedPrefixIndexRange: `${prefixRange.min}-${prefixRange.max}`,
            addressableIndexRange: `${range.min}-${range.max}`,
            observedIndexPolicy: 'withheld: stream argument bytes are not persisted; rerun this audit against the local ROM to reproduce the exact value',
          });
        }
      } else {
        outOfRangeEvents.push({
          streamId: event.streamId,
          streamStartOffset: event.streamStartOffset,
          opcodeOffset: event.opcodeOffset,
          validIndexRange: `${range.min}-${range.max}`,
          observedIndexPolicy: 'withheld: stream argument bytes are not persisted; rerun this audit against the local ROM to reproduce the exact value',
        });
      }
    }
    streamUses.push(compactStreamUse(stream, parsed.events, range));
  }

  const expectedCatalogF5 = audioCatalog.summary?.opcodeTotals?.['$F5'] || 0;
  const graphF5 = graphCatalog?.summary?.opcodeTotals?.['$F5'] || 0;
  const requestGraphsWithF5 = (graphCatalog?.graphs || [])
    .filter(graph => (graph.opcodeTotals?.['$F5'] || 0) > 0)
    .length;

  const validationIssues = [];
  if (countMismatches.length) validationIssues.push(`${countMismatches.length} stream(s) had $F5 counts that did not match ${audioCatalogId}`);
  if (outOfRangeEvents.length) validationIssues.push(`${outOfRangeEvents.length} $F5 event(s) used a support-window index outside ${range.min}-${range.max}`);
  if (parseWarnings.length) validationIssues.push(`${parseWarnings.length} parser warning(s) occurred while auditing $F5 support-table use`);
  if (expectedCatalogF5 && expectedCatalogF5 !== f5EventCount) {
    validationIssues.push(`Parsed ${f5EventCount} unique-stream $F5 event(s), but ${audioCatalogId} summary reports ${expectedCatalogF5}`);
  }

  const summary = {
    auditedStreamCount: (audioCatalog.streams || []).length,
    streamsWithF5: streamUses.length,
    uniqueStreamF5EventCount: f5EventCount,
    expectedUniqueStreamF5EventCount: expectedCatalogF5,
    requestGraphF5EventCount: graphF5,
    requestGraphsWithF5,
    validF5EventCount: f5EventCount - outOfRangeEvents.length,
    outOfRangeF5EventCount: outOfRangeEvents.length,
    embeddedPrefixF5EventCount: f5EventCount - outOfRangeEvents.length - prefixEscapeEvents.length,
    prefixEscapeF5EventCount: prefixEscapeEvents.length,
    distinctValidIndexCount: distinctValidIndices.size,
    supportWindowIndexRange: `${range.min}-${range.max}`,
    embeddedPrefixIndexRange: prefixRange.count ? `${prefixRange.min}-${prefixRange.max}` : '',
    countMismatchCount: countMismatches.length,
    parseWarningCount: parseWarnings.length,
    validationIssueCount: validationIssues.length,
    assetPolicy: 'Metadata only: stream ids, offsets, counts, index-range validation, and anomaly refs. Valid stream argument bytes and table byte values are not embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [audioCatalogId, supportTableCatalogId, streamGraphCatalogId].filter(id => id !== streamGraphCatalogId || graphCatalog),
    assetPolicy: summary.assetPolicy,
    supportTableUse: {
      tableId: table.id,
      lookupId: table.lookupId,
      romOffset: table.romOffset,
      z80Address: table.z80Address,
      indexRange: range,
      embeddedPrefixIndexRange: prefixRange.count ? prefixRange : null,
      consumer: table.consumer || null,
      usageSummary: {
        streamsWithF5: streamUses.length,
        uniqueStreamF5EventCount: f5EventCount,
        validF5EventCount: summary.validF5EventCount,
        outOfRangeF5EventCount: outOfRangeEvents.length,
        embeddedPrefixF5EventCount: summary.embeddedPrefixF5EventCount,
        prefixEscapeF5EventCount: prefixEscapeEvents.length,
        distinctValidIndexCount: distinctValidIndices.size,
      },
      confidence: validationIssues.length ? 'medium' : 'high',
      evidence: [
        `${supportTableCatalogId} defines ${table.lookupId} at ${table.romOffset} with handler-addressable indices ${range.min}-${range.max}.`,
        `${audioCatalogId} provides parsed unique stream starts and expected $F5 opcode counts.`,
        'This audit reparses local ROM stream bytes only to validate index ranges; it does not persist valid argument bytes or table values.',
        prefixRange.count
          ? `Indices ${prefixRange.min}-${prefixRange.max} stay inside the embedded prefix before the next handler; later indices are tracked as prefix escapes rather than invalid reads.`
          : 'No embedded-prefix range was available in the support-table catalog.',
      ],
    },
    summary,
    streamUseSamples: streamUses.slice(0, 24),
    outOfRangeEvents: outOfRangeEvents.slice(0, 64),
    prefixEscapeEvents: prefixEscapeEvents.slice(0, 64),
    countMismatches: countMismatches.slice(0, 64),
    parseWarnings: parseWarnings.slice(0, 64),
    validationIssues,
    evidence: [
      `${audioCatalogId} summary reports ${expectedCatalogF5} $F5 event(s) in unique parsed streams.`,
      graphCatalog
        ? `${streamGraphCatalogId} summary reports ${graphF5} $F5 event(s) across reachable request graphs.`
        : `${streamGraphCatalogId} was not available; request-graph duplication counts are omitted.`,
      `${supportTableCatalogId} constrains support-window indices to ${range.min}-${range.max}.`,
      prefixRange.count
        ? `${supportTableCatalogId} also records the ${prefixRange.count}-byte embedded prefix before the next handler.`
        : 'No embedded-prefix range is recorded for this support lookup.',
    ],
  };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_support_table_use_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      supportTableUse: catalog.supportTableUse,
      outOfRangeEvents: catalog.outOfRangeEvents,
      prefixEscapeEvents: catalog.prefixEscapeEvents,
      countMismatches: catalog.countMismatches,
      parseWarnings: catalog.parseWarnings,
      validationIssues: catalog.validationIssues,
      nextLeads: [
        'Trace support_table_output_or_note_shift through the note/rest timing path to determine the exact effect of embedded-prefix and prefix-escape lookup results.',
        'Promote valid $F5 lookup_store operations from diagnostic field writes into the branch-aware audio stream interpreter.',
        'Use this audit as a guard when adding more support tables: unresolved or out-of-range indices should remain live-ROM diagnostics, not embedded stream data.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    validationIssues: catalog.validationIssues,
    outOfRangeEvents: catalog.outOfRangeEvents,
    prefixEscapeEvents: catalog.prefixEscapeEvents,
    countMismatches: catalog.countMismatches,
  }, null, 2));
}

main();
