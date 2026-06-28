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
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-banked-vdp-uploader-callsite-audit.mjs';
const catalogId = 'world-banked-vdp-uploader-callsite-catalog-2026-06-26';
const reportId = 'banked-vdp-uploader-callsite-audit-2026-06-26';

const knownUploaderLabels = new Map([
  ['_LABEL_604_', 'vdp_stream_interpreter'],
  ['_LABEL_8FB_', 'vram_loader_8fb'],
  ['_LABEL_998_', 'vram_loader_998'],
  ['_LABEL_99B_', 'vram_loader_998_upload_wrapper'],
  ['_LABEL_A14_', 'raw_vram_row_uploader'],
  ['_LABEL_A48_', 'animation_tile_stream_uploader'],
  ['_LABEL_A97_', 'dynamic_tile_decode_uploader'],
  ['_LABEL_25A4_', 'status_tile_source_upload'],
  ['_LABEL_26F4_', 'room_asset_loader'],
  ['_LABEL_C000_', 'bank3_frame_or_audio_entry'],
  ['_LABEL_C003_', 'bank3_frame_or_audio_entry'],
  ['_LABEL_C006_', 'bank3_frame_or_audio_entry'],
  ['_LABEL_1E200_', 'bank7_runtime_entry'],
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function offsetOf(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 16);
  return NaN;
}

function regionStart(region) {
  return offsetOf(region.offset);
}

function regionEnd(region) {
  return regionStart(region) + Number(region.size || 0);
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function containingRegion(mapData, offset) {
  if (!Number.isFinite(offset)) return null;
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
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

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function parseAsmLabels(lines) {
  const labels = [];
  let current = null;
  const lineContext = [];
  for (const [index, line] of lines.entries()) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*$/.exec(line);
    if (match) {
      const offset = labelOffset(match[1]);
      current = {
        label: match[1],
        offset,
        line: index + 1,
      };
      labels.push(current);
    }
    lineContext[index] = current;
  }
  return { labels, lineContext };
}

function stripComment(line) {
  return String(line || '').split(';')[0].trim();
}

function previousBankArgument(lines, lineIndex, maxDistance = 8) {
  for (let cursor = lineIndex - 1; cursor >= 0 && lineIndex - cursor <= maxDistance; cursor--) {
    const code = stripComment(lines[cursor]);
    if (!code) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*:\s*$/.test(code)) break;
    let match = /^ld\s+a,\s*\$([0-9A-F]{1,2})$/i.exec(code);
    if (match) {
      return {
        kind: 'immediate',
        bank: parseInt(match[1], 16),
        sourceLine: cursor + 1,
        distanceLines: lineIndex - cursor,
      };
    }
    match = /^ld\s+a,\s*\((_[A-Za-z0-9_]+_)\)$/i.exec(code);
    if (match) {
      return {
        kind: 'ram_or_pointer',
        symbol: match[1],
        sourceLine: cursor + 1,
        distanceLines: lineIndex - cursor,
      };
    }
    if (/^pop\s+af$/i.test(code)) {
      return {
        kind: 'stack_restored',
        sourceLine: cursor + 1,
        distanceLines: lineIndex - cursor,
      };
    }
  }
  return {
    kind: 'unknown',
    sourceLine: null,
    distanceLines: null,
  };
}

function nextCalls(lines, lineIndex, maxDistance = 12) {
  const calls = [];
  for (let cursor = lineIndex + 1; cursor < lines.length && cursor - lineIndex <= maxDistance; cursor++) {
    const code = stripComment(lines[cursor]);
    if (!code) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*:\s*$/.test(code)) break;
    const match = /^(?:call|jp)\s+(_[A-Za-z0-9_]+_)$/i.exec(code);
    if (!match) continue;
    calls.push({
      label: match[1],
      role: knownUploaderLabels.get(match[1]) || 'other_call',
      line: cursor + 1,
      distanceLines: cursor - lineIndex,
      knownUploader: knownUploaderLabels.has(match[1]),
    });
  }
  return calls;
}

function directVdpPortNearby(lines, lineIndex, maxDistance = 12) {
  for (let cursor = lineIndex + 1; cursor < lines.length && cursor - lineIndex <= maxDistance; cursor++) {
    const code = stripComment(lines[cursor]);
    if (!code) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*:\s*$/.test(code)) break;
    if (/out\s+\(Port_VDP(?:Data|Address)\),\s*a/i.test(code) || /rst\s+\$3?0/i.test(code) || /rst\s+\$28/i.test(code)) {
      return true;
    }
  }
  return false;
}

function callsiteBase(kind, lineIndex, lines, context, mapData) {
  const label = context?.label || '';
  const offset = context?.offset;
  const region = containingRegion(mapData, offset);
  return {
    kind,
    line: lineIndex + 1,
    enclosingLabel: label,
    enclosingOffset: hex(offset),
    region: compactRegion(region),
  };
}

function helperCallsite(lineIndex, lines, context, mapData) {
  const calls = nextCalls(lines, lineIndex);
  const knownCalls = calls.filter(call => call.knownUploader);
  const bankArgument = previousBankArgument(lines, lineIndex);
  return {
    ...callsiteBase('helper_bank_switch_call', lineIndex, lines, context, mapData),
    bankArgument: bankArgument.kind === 'immediate'
      ? { kind: 'immediate', bank: bankArgument.bank, bankHex: hex(bankArgument.bank, 2), sourceLine: bankArgument.sourceLine, distanceLines: bankArgument.distanceLines }
      : bankArgument,
    nearbyCalls: calls.slice(0, 6),
    knownUploaderCalls: knownCalls,
    hasKnownUploaderCall: knownCalls.length > 0,
    hasDirectVdpPortWriteNearby: directVdpPortNearby(lines, lineIndex),
    evidence: [
      `ASM line ${lineIndex + 1} calls _LABEL_1023_ bank push/switch helper.`,
      bankArgument.kind === 'immediate'
        ? `The nearest preceding bank argument is immediate bank ${hex(bankArgument.bank, 2)} at ASM line ${bankArgument.sourceLine}.`
        : `The nearest preceding bank argument classification is ${bankArgument.kind}.`,
      'Only line numbers, labels, banks, and call relationships are stored; no ROM bytes or ASM instruction payloads are embedded.',
    ],
  };
}

function directMapperWrite(lineIndex, lines, context, mapData) {
  const bankArgument = previousBankArgument(lines, lineIndex, 5);
  return {
    ...callsiteBase('direct_mapper_bank_write', lineIndex, lines, context, mapData),
    bankArgument: bankArgument.kind === 'immediate'
      ? { kind: 'immediate', bank: bankArgument.bank, bankHex: hex(bankArgument.bank, 2), sourceLine: bankArgument.sourceLine, distanceLines: bankArgument.distanceLines }
      : bankArgument,
    nearbyCalls: nextCalls(lines, lineIndex).slice(0, 6),
    hasDirectVdpPortWriteNearby: directVdpPortNearby(lines, lineIndex),
    evidence: [
      `ASM line ${lineIndex + 1} writes the current A value to _RAM_FFFF_ mapper register.`,
      bankArgument.kind === 'immediate'
        ? `The nearest preceding bank argument is immediate bank ${hex(bankArgument.bank, 2)} at ASM line ${bankArgument.sourceLine}.`
        : `The nearest preceding bank argument classification is ${bankArgument.kind}.`,
      'Only line numbers, labels, banks, and call relationships are stored; no ROM bytes or ASM instruction payloads are embedded.',
    ],
  };
}

function collectCallsites(lines, labelContext, mapData) {
  const helperCallsites = [];
  const directWrites = [];
  for (const [index, line] of lines.entries()) {
    const code = stripComment(line);
    if (/^call\s+_LABEL_1023_$/i.test(code)) {
      helperCallsites.push(helperCallsite(index, lines, labelContext[index], mapData));
    }
    if (/^ld\s+\(_RAM_FFFF_\),\s*a$/i.test(code)) {
      directWrites.push(directMapperWrite(index, lines, labelContext[index], mapData));
    }
  }
  return { helperCallsites, directWrites };
}

function summarizeByBank(callsites) {
  return countBy(callsites.filter(item => item.bankArgument?.kind === 'immediate'), item => hex(item.bankArgument.bank, 2));
}

function buildRegionSummaries(callsites) {
  const byRegion = new Map();
  for (const item of callsites) {
    if (!item.region?.id) continue;
    if (!byRegion.has(item.region.id)) {
      byRegion.set(item.region.id, {
        region: item.region,
        helperCallsiteCount: 0,
        directMapperWriteCount: 0,
        immediateBanks: {},
        uploaderRoleCounts: {},
        callsiteLines: [],
      });
    }
    const group = byRegion.get(item.region.id);
    if (item.kind === 'helper_bank_switch_call') group.helperCallsiteCount++;
    if (item.kind === 'direct_mapper_bank_write') group.directMapperWriteCount++;
    if (item.bankArgument?.kind === 'immediate') {
      const bank = hex(item.bankArgument.bank, 2);
      group.immediateBanks[bank] = (group.immediateBanks[bank] || 0) + 1;
    }
    for (const call of item.knownUploaderCalls || []) {
      group.uploaderRoleCounts[call.role] = (group.uploaderRoleCounts[call.role] || 0) + 1;
    }
    if (group.callsiteLines.length < 12) group.callsiteLines.push(item.line);
  }
  return [...byRegion.values()].sort((a, b) => (b.helperCallsiteCount + b.directMapperWriteCount) - (a.helperCallsiteCount + a.directMapperWriteCount)
    || offsetOf(a.region.offset) - offsetOf(b.region.offset));
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const { lineContext } = parseAsmLabels(lines);
  const { helperCallsites, directWrites } = collectCallsites(lines, lineContext, mapData);
  const allCallsites = [...helperCallsites, ...directWrites];
  const helperWithUploader = helperCallsites.filter(item => item.hasKnownUploaderCall);
  const graphicsBankHelperCallsites = helperCallsites
    .filter(item => item.bankArgument?.kind === 'immediate' && item.bankArgument.bank >= 8 && item.bankArgument.bank <= 15)
    .map(item => ({
      line: item.line,
      enclosingLabel: item.enclosingLabel,
      enclosingOffset: item.enclosingOffset,
      region: item.region,
      bank: item.bankArgument.bankHex,
      knownUploaderCalls: item.knownUploaderCalls,
      nearbyCalls: item.nearbyCalls,
      hasDirectVdpPortWriteNearby: item.hasDirectVdpPortWriteNearby,
    }));
  const bank11Helper = helperCallsites.filter(item => item.bankArgument?.kind === 'immediate' && item.bankArgument.bank === 0x0B);
  const bank11Direct = directWrites.filter(item => item.bankArgument?.kind === 'immediate' && item.bankArgument.bank === 0x0B);
  const regionSummaries = buildRegionSummaries(allCallsites);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    assetPolicy: 'Metadata only: ASM line numbers, labels, region ids, bank immediates, and call relationships. No ROM bytes, decoded graphics, screenshots, audio, text payloads, gameplay constants, or ASM instruction payloads are embedded.',
    summary: {
      helperCallsiteCount: helperCallsites.length,
      directMapperWriteCount: directWrites.length,
      immediateHelperCallsiteCount: helperCallsites.filter(item => item.bankArgument?.kind === 'immediate').length,
      dynamicOrUnknownHelperCallsiteCount: helperCallsites.filter(item => item.bankArgument?.kind !== 'immediate').length,
      helperImmediateBankCounts: summarizeByBank(helperCallsites),
      directMapperImmediateBankCounts: summarizeByBank(directWrites),
      helperKnownUploaderRoleCounts: countBy(helperCallsites.flatMap(item => item.knownUploaderCalls || []), item => item.role),
      helperCallsitesWithKnownUploaderCount: helperWithUploader.length,
      graphicsBankHelperCallsiteCount: graphicsBankHelperCallsites.length,
      bank11ImmediateHelperCallsiteCount: bank11Helper.length,
      bank11ImmediateDirectMapperWriteCount: bank11Direct.length,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    bank11ImmediateTraceResult: {
      status: bank11Helper.length === 0 && bank11Direct.length === 0
        ? 'no_immediate_bank11_vdp_upload_callsite_found'
        : 'bank11_immediate_callsite_present',
      confidence: 'medium_high',
      helperCallsiteLines: bank11Helper.map(item => item.line),
      directMapperWriteLines: bank11Direct.map(item => item.line),
      interpretation: 'This rules out only simple immediate bank-11 mapper setup near known VDP upload paths. Bank-11 graphics can still be consumed through parsed loader records, dynamic bank values, or unmodeled data-driven routines.',
      evidence: [
        'All ASM lines calling _LABEL_1023_ were scanned for nearby immediate bank arguments and known VDP uploader calls.',
        'All ASM lines writing _RAM_FFFF_ directly were scanned for nearby immediate bank arguments.',
        'No ROM bytes or ASM instruction payloads are stored.',
      ],
    },
    graphicsBankHelperCallsites,
    helperCallsites,
    directMapperWrites: directWrites,
    regionSummaries,
    evidence: [
      '_LABEL_1023_ is the bank push/switch helper; _LABEL_1036_ restores the previous bank.',
      'Known uploader calls are limited to labels already mapped by vdpRenderRoutineCatalogs and related graphics/source audits.',
      'This audit is a control-flow index for tracing unreferenced graphics source spans; it does not promote any source coverage by itself.',
      'No ROM bytes, decoded assets, screenshots, or ASM instruction payloads are embedded.',
    ],
    nextLeads: [
      'Use graphicsBankHelperCallsites to inspect immediate graphics-bank upload paths before searching raw source-word coincidences.',
      'For bank-11 r2645/r2656 gaps, prioritize parsed data records and dynamic bank values because no immediate bank-11 uploader path is found here.',
      'Extend this audit with bounded symbolic traces when a dynamic bank argument feeds a known uploader routine.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  for (const summary of catalog.regionSummaries) {
    const region = (mapData.regions || []).find(item => item.id === summary.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.bankedVdpUploaderCallsiteAudit = {
      catalogId,
      kind: 'banked_vdp_uploader_callsite_region',
      confidence: 'medium_high',
      helperCallsiteCount: summary.helperCallsiteCount,
      directMapperWriteCount: summary.directMapperWriteCount,
      immediateBanks: summary.immediateBanks,
      uploaderRoleCounts: summary.uploaderRoleCounts,
      callsiteLines: summary.callsiteLines,
      summary: `${summary.helperCallsiteCount} _LABEL_1023_ helper callsite(s) and ${summary.directMapperWriteCount} direct mapper write(s) indexed in this code region.`,
      evidence: [
        `Derived from ${catalogId}; stores labels, line numbers, bank immediates, and call relationships only.`,
        'No ROM bytes, decoded graphics, pixels, screenshots, or ASM instruction payloads are embedded.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      region: compactRegion(region),
      helperCallsiteCount: summary.helperCallsiteCount,
      directMapperWriteCount: summary.directMapperWriteCount,
      immediateBanks: summary.immediateBanks,
      uploaderRoleCounts: summary.uploaderRoleCounts,
    });
  }
  return annotatedRegions;
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [];

  if (apply) {
    mapData.vdpRenderRoutineCatalogs = (mapData.vdpRenderRoutineCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpRenderRoutineCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'banked_vdp_uploader_callsite_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
      },
      bank11ImmediateTraceResult: catalog.bank11ImmediateTraceResult,
      graphicsBankHelperCallsites: catalog.graphicsBankHelperCallsites,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      annotatedRegions,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotatedRegions.length,
    },
    bank11ImmediateTraceResult: catalog.bank11ImmediateTraceResult,
    graphicsBankHelperCallsites: catalog.graphicsBankHelperCallsites,
    annotatedRegions,
  }, null, 2));
}

main();
