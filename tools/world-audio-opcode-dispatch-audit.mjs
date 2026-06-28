#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO_OPCODE_METADATA_BY_OPCODE } from './world-audio-opcode-metadata.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-audio-opcode-dispatch-catalog-2026-06-25';
const reportId = 'audio-opcode-dispatch-audit-2026-06-25';

const DISPATCH_ROUTINE_OFFSET = 0x0C37B;
const DISPATCH_TABLE_OFFSET = 0x0C391;
const OPCODE_BASE = 0xF0;
const OPCODE_COUNT = 16;

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
}

function z80ToBank3Rom(z80) {
  return z80 >= 0x8000 && z80 < 0xC000 ? z80 + 0x4000 : null;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
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

function collectAsmFacts(asmText) {
  const lines = asmText.split(/\r?\n/);
  const labels = new Map();
  let dispatchLine = null;
  let tableCommentLine = null;
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const labelMatch = /^(_(?:LABEL|DATA)_([0-9A-F]+)_):/.exec(lines[i]);
    if (labelMatch) labels.set(parseInt(labelMatch[2], 16), { label: labelMatch[1], line: lineNo });
    if (lines[i].startsWith('_LABEL_C37B_:')) dispatchLine = lineNo;
    if (lines[i].includes('Data from C391 to C3EF')) tableCommentLine = lineNo;
  }
  return { labels, dispatchLine, tableCommentLine };
}

function buildCatalog(rom, asmText, mapData) {
  const asmFacts = collectAsmFacts(asmText);
  const entries = [];
  for (let i = 0; i < OPCODE_COUNT; i++) {
    const tableEntryOffset = DISPATCH_TABLE_OFFSET + i * 2;
    const opcode = OPCODE_BASE + i;
    const z80Target = rom[tableEntryOffset] | (rom[tableEntryOffset + 1] << 8);
    const romTarget = z80ToBank3Rom(z80Target);
    const targetRegion = romTarget == null ? null : findContainingRegion(mapData, romTarget);
    const exactLabel = romTarget == null ? null : asmFacts.labels.get(romTarget);
    const metadata = AUDIO_OPCODE_METADATA_BY_OPCODE.get(opcode) || null;
    entries.push({
      opcode: '$' + opcode.toString(16).toUpperCase(),
      opcodeIndex: i,
      tableEntryOffset: hex(tableEntryOffset),
      z80Target: hex(z80Target, 4),
      romTarget: romTarget == null ? null : hex(romTarget),
      targetOffsetWithinRegion: targetRegion && romTarget != null ? romTarget - offsetOf(targetRegion) : null,
      targetLabel: exactLabel?.label || '',
      targetAsmLine: exactLabel?.line || null,
      targetRegion: regionRef(targetRegion),
      validBank3Target: romTarget != null,
      derivedArgBytes: metadata?.argBytes ?? null,
      role: metadata?.role || '',
      parserAction: metadata?.parserAction || '',
      metadataConfidence: metadata?.confidence || '',
      handlerEvidence: metadata?.evidence || '',
    });
  }

  const uniqueTargets = [...new Set(entries.map(entry => entry.romTarget).filter(Boolean))];
  const repeatedTargets = uniqueTargets
    .map(target => ({
      romTarget: target,
      opcodes: entries.filter(entry => entry.romTarget === target).map(entry => entry.opcode),
    }))
    .filter(item => item.opcodes.length > 1);
  const missingRegions = entries
    .filter(entry => entry.romTarget && !entry.targetRegion)
    .map(entry => ({ opcode: entry.opcode, romTarget: entry.romTarget }));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-audio-opcode-dispatch-audit.mjs',
    dispatchRoutine: {
      label: '_LABEL_C37B_',
      romOffset: hex(DISPATCH_ROUTINE_OFFSET),
      asmLine: asmFacts.dispatchLine,
      summary: 'Music stream opcodes $F0-$FF are reduced to the low nibble, doubled, added to Z80 $8391, then dispatched by pushing the table target and returning.',
    },
    dispatchTable: {
      label: '_DATA_C391_',
      romOffset: hex(DISPATCH_TABLE_OFFSET),
      z80Address: hex(0x8391, 4),
      entries: OPCODE_COUNT,
      asmLine: asmFacts.tableCommentLine,
      targetBank: 3,
      z80ToRomFormula: 'rom = z80 + 0x4000 for bank-3 targets',
    },
    summary: {
      opcodeEntries: entries.length,
      validBank3Targets: entries.filter(entry => entry.validBank3Target).length,
      uniqueTargets: uniqueTargets.length,
      repeatedTargets: repeatedTargets.length,
      missingTargetRegions: missingRegions.length,
      handlerDerivedArgBytes: entries.filter(entry => entry.derivedArgBytes != null).length,
      assetPolicy: 'Metadata only: opcode values, table offsets, handler pointers, region refs, and ASM evidence. No ROM bytes, decoded music, or audio samples are embedded.',
    },
    entries,
    repeatedTargets,
    missingRegions,
    evidence: [
      'ASM _LABEL_C37B_ reads the stream opcode byte, masks with 0x0F, doubles it, adds Z80 base 0x8391, loads the word target, pushes it, and returns.',
      'ASM marks ROM 0x0C391-0x0C3EF as the data block containing the 16-entry dispatch table followed by handler bytes.',
      'Targets are bank-3 Z80 addresses and are converted with rom = z80 + 0x4000.',
    ],
  };
}

function annotateRegion(region, detail) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.audioOpcodeDispatchAudit = detail;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function applyAnnotations(mapData, catalog) {
  const dispatchRegion = findExactRegion(mapData, DISPATCH_TABLE_OFFSET);
  const annotatedDispatch = annotateRegion(dispatchRegion, {
    catalogId,
    kind: 'music_opcode_dispatch_table',
    confidence: 'high',
    summary: '$F0-$FF music stream opcode dispatch table used by _LABEL_C37B_.',
    dispatchRoutine: catalog.dispatchRoutine,
    dispatchTable: catalog.dispatchTable,
      opcodeEntries: catalog.entries.map(entry => ({
        opcode: entry.opcode,
        tableEntryOffset: entry.tableEntryOffset,
        z80Target: entry.z80Target,
        romTarget: entry.romTarget,
        targetRegionId: entry.targetRegion?.id || '',
        targetOffsetWithinRegion: entry.targetOffsetWithinRegion,
        derivedArgBytes: entry.derivedArgBytes,
        role: entry.role,
        parserAction: entry.parserAction,
        metadataConfidence: entry.metadataConfidence,
      })),
    evidence: catalog.evidence,
    generatedAt: now,
    tool: 'tools/world-audio-opcode-dispatch-audit.mjs',
  });

  const targetsByRegion = new Map();
  for (const entry of catalog.entries) {
    if (!entry.targetRegion) continue;
    const existing = targetsByRegion.get(entry.targetRegion.id) || [];
    existing.push(entry);
    targetsByRegion.set(entry.targetRegion.id, existing);
  }

  const annotatedTargets = [];
  for (const [regionId, entries] of targetsByRegion.entries()) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.audioOpcodeHandlerAudit = {
      catalogId,
      kind: 'music_opcode_handler_target_region',
      confidence: 'high',
      summary: `${entries.length} opcode dispatch target(s) land in this handler/data region.`,
      opcodes: entries.map(entry => ({
        opcode: entry.opcode,
        tableEntryOffset: entry.tableEntryOffset,
        z80Target: entry.z80Target,
        romTarget: entry.romTarget,
        targetOffsetWithinRegion: entry.targetOffsetWithinRegion,
        derivedArgBytes: entry.derivedArgBytes,
        role: entry.role,
        parserAction: entry.parserAction,
        metadataConfidence: entry.metadataConfidence,
      })),
      evidence: [
        '_LABEL_C37B_ uses the 0x0C391 dispatch table to jump into this region for one or more $F0-$FF stream opcodes.',
        'Handler semantics are not named here beyond dispatch target identity; exact behavior should be traced per target.',
      ],
      generatedAt: now,
      tool: 'tools/world-audio-opcode-dispatch-audit.mjs',
    };
    annotatedTargets.push(regionRef(region));
  }

  return { annotatedDispatch, annotatedTargets };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, asmText, mapData);
  const annotation = applyAnnotations(mapData, catalog);

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_opcode_dispatch_audit',
      generatedAt: now,
      tool: 'tools/world-audio-opcode-dispatch-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedDispatchRegion: annotation.annotatedDispatch ? 1 : 0,
        annotatedTargetRegions: annotation.annotatedTargets.length,
      },
      dispatchRoutine: catalog.dispatchRoutine,
      dispatchTable: catalog.dispatchTable,
      entries: catalog.entries,
      repeatedTargets: catalog.repeatedTargets,
      missingRegions: catalog.missingRegions,
      annotatedDispatchRegion: annotation.annotatedDispatch,
      annotatedTargetRegions: annotation.annotatedTargets,
      nextLeads: [
        'Trace each unique handler target at 0x0C3B1, 0x0C3C9, 0x0C3DB, 0x0C3EF, 0x0C3FD, 0x0C412, 0x0C427, 0x0C441, 0x0C48D, 0x0C49F, and 0x0C4B8 to name opcode semantics.',
        'Replace the static OPCODE_ARGS table in tools/world-audio-audit.mjs with lengths derived from confirmed handler semantics.',
        'Use the repeated 0x0C441 target for $F7/$FB/$FC/$FD/$FE/$FF as a priority trace target before building a browser audio stream preview.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    entries: catalog.entries,
    repeatedTargets: catalog.repeatedTargets,
    missingRegions: catalog.missingRegions,
    annotatedDispatchRegion: annotation.annotatedDispatch,
    annotatedTargetRegions: annotation.annotatedTargets,
  }, null, 2));
}

main();
