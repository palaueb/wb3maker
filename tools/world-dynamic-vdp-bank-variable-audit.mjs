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
const toolName = 'tools/world-dynamic-vdp-bank-variable-audit.mjs';
const catalogId = 'world-dynamic-vdp-bank-variable-catalog-2026-06-26';
const reportId = 'dynamic-vdp-bank-variable-audit-2026-06-26';
const schemaVersion = 1;

const trackedLabels = new Set([
  '_LABEL_8FB_',
  '_LABEL_919_',
  '_LABEL_998_',
  '_LABEL_99B_',
  '_LABEL_9C3_',
  '_LABEL_A14_',
  '_LABEL_A48_',
  '_LABEL_A97_',
  '_LABEL_1023_',
  '_LABEL_1036_',
  '_LABEL_B8F_',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value.replace(/^\$/, '0x'), 16);
  return NaN;
}

function regionStart(region) {
  return parseHex(region.offset);
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
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0)
      || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRamByAddress(mapData, address) {
  const normalized = address.toUpperCase();
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === normalized) || null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function stripComment(line) {
  return String(line || '').split(';')[0].trim();
}

function parseAsm(asmText, mapData) {
  const lines = asmText.split(/\r?\n/);
  const lineContext = [];
  const labels = [];
  let current = null;
  for (const [index, line] of lines.entries()) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*$/.exec(line);
    if (match) {
      const offset = labelOffset(match[1]);
      current = {
        label: match[1],
        offset,
        line: index + 1,
        region: compactRegion(containingRegion(mapData, offset)),
      };
      labels.push(current);
    }
    lineContext[index] = current;
  }
  return { lines, lineContext, labels };
}

function previousNonEmpty(lines, lineIndex, limit = 5) {
  const out = [];
  for (let cursor = lineIndex - 1; cursor >= 0 && lineIndex - cursor <= limit; cursor--) {
    const code = stripComment(lines[cursor]);
    if (!code) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*:\s*$/.test(code)) break;
    out.push({ line: cursor + 1, code });
  }
  return out;
}

function nextNonEmpty(lines, lineIndex, limit = 5) {
  const out = [];
  for (let cursor = lineIndex + 1; cursor < lines.length && cursor - lineIndex <= limit; cursor++) {
    const code = stripComment(lines[cursor]);
    if (!code) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*:\s*$/.test(code)) break;
    out.push({ line: cursor + 1, code });
  }
  return out;
}

function codeWindowMatches(window, regex) {
  return window.some(item => regex.test(item.code));
}

function classifyD0F3Write(lines, lineIndex) {
  const before = previousNonEmpty(lines, lineIndex, 5);
  if (codeWindowMatches(before, /^ld\s+a,\s*\$08$/i)) {
    return {
      kind: 'default_source_bank_08_write',
      confidence: 'high',
      sourceExpression: 'constant_0x08',
      evidencePattern: 'ld a,$08 before ld (_RAM_D0F3_),a',
    };
  }
  if (codeWindowMatches(before, /^srl\s+a$/i) && codeWindowMatches(before, /^ld\s+a,\s*d$/i)) {
    return {
      kind: 'record_high_byte_shifted_source_bank_write',
      confidence: 'high',
      sourceExpression: 'sourceRecordHighByte >> 1',
      evidencePattern: 'ld a,d; srl a; ld (_RAM_D0F3_),a',
    };
  }
  return {
    kind: 'unclassified_d0f3_write',
    confidence: 'low',
    sourceExpression: 'unknown',
    evidencePattern: 'ld (_RAM_D0F3_),a',
  };
}

function classifyD0F3Read(lines, lineIndex) {
  const after = nextNonEmpty(lines, lineIndex, 3);
  if (codeWindowMatches(after, /^call\s+_LABEL_1023_$/i)) {
    return {
      kind: 'bank_switch_consumer_read',
      confidence: 'high',
      consumer: '_LABEL_1023_',
      evidencePattern: 'ld a,(_RAM_D0F3_); call _LABEL_1023_',
    };
  }
  return {
    kind: 'unclassified_d0f3_read',
    confidence: 'low',
    consumer: '',
    evidencePattern: 'ld a,(_RAM_D0F3_)',
  };
}

function classifyDfffRead(lines, lineIndex, context) {
  const after = nextNonEmpty(lines, lineIndex, 4);
  if (context?.label === '_LABEL_1023_' && codeWindowMatches(after, /^ld\s+hl,\s*\(_RAM_D121_\)$/i)) {
    return {
      kind: 'current_bank_stack_save_read',
      confidence: 'high',
      role: 'save_current_bank_before_switch',
      evidencePattern: '_LABEL_1023_ reads _RAM_DFFF_ before pushing it to the bank stack.',
    };
  }
  if (context?.label === '_LABEL_A48_' && codeWindowMatches(after, /^push\s+af$/i)) {
    return {
      kind: 'animation_uploader_previous_bank_save_read',
      confidence: 'high',
      role: 'save_previous_bank_before_direct_mapper_write',
      evidencePattern: '_LABEL_A48_ reads _RAM_DFFF_, pushes it, writes _RAM_FFFF_, then restores from the saved value.',
    };
  }
  if (context?.label === '_LABEL_38_' && codeWindowMatches(after, /^push\s+af$/i)) {
    return {
      kind: 'interrupt_previous_bank_save_read',
      confidence: 'medium_high',
      role: 'save_current_bank_during_interrupt',
      evidencePattern: 'The interrupt handler reads _RAM_DFFF_ and pushes AF before doing frame work.',
    };
  }
  return {
    kind: 'unclassified_dfff_read',
    confidence: 'low',
    role: 'unknown',
    evidencePattern: 'ld a,(_RAM_DFFF_)',
  };
}

function classifyFfffWrite(lines, lineIndex, context) {
  const before = previousNonEmpty(lines, lineIndex, 6);
  if (context?.label === '_LABEL_A48_' && codeWindowMatches(before, /^srl\s+a$/i) && codeWindowMatches(before, /^ld\s+a,\s*d$/i)) {
    return {
      kind: 'animation_record_direct_mapper_bank_write',
      confidence: 'high',
      sourceExpression: 'sourceRecordHighByte >> 1',
      evidencePattern: '_LABEL_A48_ derives A from D >> 1 and writes _RAM_FFFF_.',
    };
  }
  if (context?.label === '_LABEL_A48_' && codeWindowMatches(before, /^pop\s+af$/i)) {
    return {
      kind: 'animation_previous_bank_restore_write',
      confidence: 'high',
      sourceExpression: 'saved _RAM_DFFF_ value',
      evidencePattern: '_LABEL_A48_ pops the saved bank into AF and writes _RAM_FFFF_.',
    };
  }
  if (context?.label === '_LABEL_1023_') {
    return {
      kind: 'bank_switch_helper_mapper_write',
      confidence: 'high',
      sourceExpression: 'caller_supplied_A',
      evidencePattern: '_LABEL_1023_ saves the previous bank and writes caller-supplied A to _RAM_FFFF_.',
    };
  }
  if (context?.label === '_LABEL_1036_') {
    return {
      kind: 'bank_restore_helper_mapper_write',
      confidence: 'high',
      sourceExpression: 'bank stack pop via _RAM_D121_',
      evidencePattern: '_LABEL_1036_ restores the previous bank to _RAM_FFFF_.',
    };
  }
  if (codeWindowMatches(before, /^ld\s+a,\s*\$[0-9A-F]{1,2}$/i)) {
    return {
      kind: 'immediate_bank_mapper_write',
      confidence: 'medium_high',
      sourceExpression: 'nearby immediate bank constant',
      evidencePattern: 'A nearby immediate load feeds _RAM_FFFF_.',
    };
  }
  return {
    kind: 'other_mapper_write',
    confidence: 'low',
    sourceExpression: 'unclassified_A',
    evidencePattern: 'ld (_RAM_FFFF_),a',
  };
}

function eventBase(kind, lineIndex, context) {
  return {
    kind,
    line: lineIndex + 1,
    enclosingLabel: context?.label || '',
    enclosingOffset: hex(context?.offset),
    region: context?.region || null,
  };
}

function collectEvents(lines, lineContext) {
  const events = {
    d0f3Writes: [],
    d0f3Reads: [],
    dfffReads: [],
    ffffWrites: [],
    trackedCalls: [],
  };
  for (const [index, line] of lines.entries()) {
    const code = stripComment(line);
    const context = lineContext[index] || null;
    if (!code) continue;
    if (/^ld\s+\(_RAM_D0F3_\),\s*a$/i.test(code)) {
      events.d0f3Writes.push({
        ...eventBase('d0f3_write', index, context),
        classification: classifyD0F3Write(lines, index),
      });
    }
    if (/^ld\s+a,\s*\(_RAM_D0F3_\)$/i.test(code)) {
      events.d0f3Reads.push({
        ...eventBase('d0f3_read', index, context),
        classification: classifyD0F3Read(lines, index),
      });
    }
    if (/^ld\s+a,\s*\(_RAM_DFFF_\)$/i.test(code)) {
      events.dfffReads.push({
        ...eventBase('dfff_read', index, context),
        classification: classifyDfffRead(lines, index, context),
      });
    }
    if (/^ld\s+\(_RAM_FFFF_\),\s*a$/i.test(code)) {
      events.ffffWrites.push({
        ...eventBase('ffff_write', index, context),
        classification: classifyFfffWrite(lines, index, context),
      });
    }
    const call = /^(?:call|jp)\s+(_[A-Za-z0-9_]+_)$/i.exec(code);
    if (call && trackedLabels.has(call[1])) {
      events.trackedCalls.push({
        ...eventBase('tracked_upload_related_call', index, context),
        target: call[1],
      });
    }
  }
  return events;
}

function groupByRegion(events) {
  const groups = new Map();
  for (const [eventKind, items] of Object.entries(events)) {
    if (eventKind === 'trackedCalls') continue;
    for (const item of items) {
      if (eventKind === 'ffffWrites' && ![
        'animation_record_direct_mapper_bank_write',
        'animation_previous_bank_restore_write',
        'bank_switch_helper_mapper_write',
        'bank_restore_helper_mapper_write',
      ].includes(item.classification.kind)) {
        continue;
      }
      if (!item.region?.id) continue;
      if (!groups.has(item.region.id)) {
        groups.set(item.region.id, {
          region: item.region,
          d0f3WriteCount: 0,
          d0f3ReadCount: 0,
          dfffReadCount: 0,
          ffffWriteCount: 0,
          classificationCounts: {},
          lines: [],
        });
      }
      const group = groups.get(item.region.id);
      if (eventKind === 'd0f3Writes') group.d0f3WriteCount++;
      if (eventKind === 'd0f3Reads') group.d0f3ReadCount++;
      if (eventKind === 'dfffReads') group.dfffReadCount++;
      if (eventKind === 'ffffWrites') group.ffffWriteCount++;
      group.classificationCounts[item.classification.kind] = (group.classificationCounts[item.classification.kind] || 0) + 1;
      if (group.lines.length < 16) group.lines.push(item.line);
    }
  }
  return [...groups.values()]
    .sort((a, b) => (b.d0f3WriteCount + b.d0f3ReadCount + b.dfffReadCount + b.ffffWriteCount)
      - (a.d0f3WriteCount + a.d0f3ReadCount + a.dfffReadCount + a.ffffWriteCount)
      || parseHex(a.region.offset) - parseHex(b.region.offset));
}

function uploadRoutineEntries(events) {
  const byLabel = new Map();
  for (const item of [
    ...events.d0f3Writes,
    ...events.d0f3Reads,
    ...events.dfffReads,
    ...events.ffffWrites,
  ]) {
    if (!trackedLabels.has(item.enclosingLabel)) continue;
    if (!byLabel.has(item.enclosingLabel)) {
      byLabel.set(item.enclosingLabel, {
        label: item.enclosingLabel,
        offset: item.enclosingOffset,
        region: item.region,
        events: [],
      });
    }
    byLabel.get(item.enclosingLabel).events.push({
      kind: item.kind,
      line: item.line,
      classification: item.classification,
    });
  }
  return [...byLabel.values()]
    .map(entry => ({
      ...entry,
      eventCounts: countBy(entry.events, item => item.kind),
      classificationCounts: countBy(entry.events, item => item.classification.kind),
      role: routineRole(entry.label),
      confidence: 'high',
    }))
    .sort((a, b) => parseHex(a.offset) - parseHex(b.offset));
}

function routineRole(label) {
  if (label === '_LABEL_919_') return 'vram_loader_8fb_record_body_uses_D0F3';
  if (label === '_LABEL_99B_') return 'vram_loader_998_wrapper_uses_D0F3';
  if (label === '_LABEL_9C3_') return 'vram_loader_998_record_parser_sets_D0F3';
  if (label === '_LABEL_A48_') return 'animation_tile_stream_direct_mapper_bank_switch';
  if (label === '_LABEL_A97_') return 'dynamic_tile_decode_upload_uses_D0F3';
  if (label === '_LABEL_1023_') return 'bank_switch_helper_saves_DFFF_and_writes_FFFF';
  return 'upload_related_bank_event_region';
}

function buildCatalog(mapData, asmText) {
  const { lines, lineContext } = parseAsm(asmText, mapData);
  const events = collectEvents(lines, lineContext);
  const regions = groupByRegion(events);
  const routines = uploadRoutineEntries(events);
  const ramD0F3 = findRamByAddress(mapData, '$D0F3');
  const ramDFFF = findRamByAddress(mapData, '$DFFF');
  const ramFFFF = findRamByAddress(mapData, '$FFFF');

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    summary: {
      d0f3WriteCount: events.d0f3Writes.length,
      d0f3ReadCount: events.d0f3Reads.length,
      dfffReadCount: events.dfffReads.length,
      explicitDfffWriteCount: 0,
      ffffWriteCount: events.ffffWrites.length,
      uploadRoutineCount: routines.length,
      annotatedRegionCount: regions.length,
      d0f3WriteClassificationCounts: countBy(events.d0f3Writes, item => item.classification.kind),
      d0f3ReadClassificationCounts: countBy(events.d0f3Reads, item => item.classification.kind),
      dfffReadClassificationCounts: countBy(events.dfffReads, item => item.classification.kind),
      ffffWriteClassificationCounts: countBy(events.ffffWrites, item => item.classification.kind),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: ASM labels, line numbers, RAM symbols, formulas, roles, and aggregate counts. No ROM bytes, decoded graphics, screenshots, audio, or ASM instruction payloads are embedded.',
    },
    ramVariables: [
      {
        symbol: '_RAM_D0F3_',
        ramEntry: ramD0F3 ? { id: ramD0F3.id, address: ramD0F3.address, type: ramD0F3.type, name: ramD0F3.name } : null,
        role: 'parsed_tile_source_bank_latch',
        confidence: 'high',
        formula: {
          defaultBank: '0x08',
          parsedRecordBank: 'sourceRecordHighByte >> 1',
          sourceAddressLowBankBit: 'sourceRecordHighByte & 0x01',
          byteOffsetHelper: '_LABEL_B8F_ multiplies the low 9-bit tile index by 32 bytes before bit 15 is set for the $8000 banked slot.',
        },
        writes: events.d0f3Writes,
        reads: events.d0f3Reads,
      },
      {
        symbol: '_RAM_DFFF_',
        ramEntry: ramDFFF ? { id: ramDFFF.id, address: ramDFFF.address, type: ramDFFF.type, name: ramDFFF.name } : null,
        role: 'current_mapper_bank_mirror_or_shadow',
        confidence: 'medium_high',
        interpretation: '_RAM_DFFF_ has no explicit ASM writes, but is read before bank switches and restores. Its use matches a mirror/shadow of the current _RAM_FFFF_ mapper register value.',
        reads: events.dfffReads,
        explicitWriteCount: 0,
      },
      {
        symbol: '_RAM_FFFF_',
        ramEntry: ramFFFF ? { id: ramFFFF.id, address: ramFFFF.address, type: ramFFFF.type, name: ramFFFF.name } : null,
        role: 'mapper_page2_bank_register',
        confidence: 'high',
        writes: events.ffffWrites,
      },
    ],
    uploadRoutines: routines,
    regions,
    evidence: [
      '_LABEL_919_, _LABEL_99B_, and _LABEL_A97_ read _RAM_D0F3_ immediately before calling _LABEL_1023_.',
      '_LABEL_9C3_ and _LABEL_919_ derive _RAM_D0F3_ from the high byte of a source record by shifting it right once.',
      '_LABEL_A48_ does not use _RAM_D0F3_; it writes _RAM_FFFF_ directly from the same high-byte >> 1 source-bank formula and restores the saved _RAM_DFFF_ value.',
      '_LABEL_1023_ reads _RAM_DFFF_, pushes it to the bank stack at _RAM_D121_, then writes caller-supplied A to _RAM_FFFF_.',
      'Only labels, line numbers, RAM symbols, formulas, roles, and counts are stored.',
    ],
    nextLeads: [
      'Use the D0F3 formula to decode unresolved loader records into bank + tile-index source ranges before adding any new graphics source coverage.',
      'Trace callers of _LABEL_99B_, _LABEL_A97_, and _LABEL_A48_ to connect room/entity selectors to these dynamic tile source banks.',
      'Model _RAM_DFFF_ as the current bank mirror/shadow in simulator bank provenance so direct _RAM_FFFF_ writes can be restored accurately.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const changedRam = [];
  for (const group of catalog.regions) {
    const region = findRegionById(mapData, group.region.id);
    if (!region) continue;
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.dynamicVdpBankVariableAudit = {
        catalogId,
        kind: 'dynamic_vdp_bank_variable_region',
        confidence: 'high',
        summary: 'Region participates in dynamic VDP source-bank selection or mapper restore flow.',
        detail: {
          d0f3WriteCount: group.d0f3WriteCount,
          d0f3ReadCount: group.d0f3ReadCount,
          dfffReadCount: group.dfffReadCount,
          ffffWriteCount: group.ffffWriteCount,
          classificationCounts: group.classificationCounts,
          lines: group.lines,
        },
        evidence: [
          `Derived from ${catalogId}; stores labels, line numbers, RAM symbols, formulas, and roles only.`,
          'No ROM bytes, decoded graphics, screenshots, audio, or ASM instruction payloads are embedded.',
        ],
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      classificationCounts: group.classificationCounts,
    });
  }

  for (const variable of catalog.ramVariables) {
    const ramEntry = variable.ramEntry?.address ? findRamByAddress(mapData, variable.ramEntry.address) : null;
    if (!ramEntry) continue;
    if (apply) {
      ramEntry.analysis = ramEntry.analysis || {};
      ramEntry.analysis.dynamicVdpBankVariableAudit = {
        catalogId,
        symbol: variable.symbol,
        role: variable.role,
        confidence: variable.confidence,
        summary: variable.interpretation || `RAM variable ${variable.symbol} participates in dynamic VDP source-bank selection.`,
        detail: {
          formula: variable.formula || null,
          writeCount: (variable.writes || []).length,
          readCount: (variable.reads || []).length,
          explicitWriteCount: variable.explicitWriteCount,
          writeClassificationCounts: countBy(variable.writes || [], item => item.classification.kind),
          readClassificationCounts: countBy(variable.reads || [], item => item.classification.kind),
          writeLines: (variable.writes || []).map(item => item.line),
          readLines: (variable.reads || []).map(item => item.line),
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      id: ramEntry.id,
      address: ramEntry.address,
      name: ramEntry.name || '',
      symbol: variable.symbol,
      role: variable.role,
      confidence: variable.confidence,
    });
  }

  return { changedRegions, changedRam };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.vdpRenderRoutineCatalogs = (mapData.vdpRenderRoutineCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpRenderRoutineCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'dynamic_vdp_bank_variable_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      summary: {
        ...catalog.summary,
        changedRegionCount: annotation.changedRegions.length,
        changedRamCount: annotation.changedRam.length,
      },
      changedRegions: annotation.changedRegions,
      changedRam: annotation.changedRam,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      changedRegionCount: annotation.changedRegions.length,
      changedRamCount: annotation.changedRam.length,
    },
    changedRegions: annotation.changedRegions,
    changedRam: annotation.changedRam,
  }, null, 2));
}

main();
