#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_OPCODE_METADATA_BY_OPCODE,
  audioOpcodeKey,
} from './world-audio-opcode-metadata.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-audio-opcode-state-effect-catalog-2026-06-25';
const reportId = 'audio-opcode-state-effect-audit-2026-06-25';
const toolName = 'tools/world-audio-opcode-state-effect-audit.mjs';

const dispatchCatalogId = 'world-audio-opcode-dispatch-catalog-2026-06-25';
const dispatchTableOffset = 0x0C391;
const opcodeBase = 0xF0;
const opcodeCount = 16;

const EFFECT_DEFS = [
  {
    opcode: 0xF0,
    handlerRomOffset: 0x0C3B1,
    handlerEndExclusive: 0x0C3C9,
    name: 'instrument_or_effect_select',
    argSemantics: ['instrument_or_effect_id'],
    streamStructEffects: [
      'Writes the argument into an HL-relative stream selector field after toggling L bit 3/bit 1.',
    ],
    hardwareShadowEffects: [
      'When stream flag bit 1 is clear, mirrors the argument into hardware shadow field IY+6 (instrument_or_effect_id).',
    ],
    parserImplication: 'One-byte control event; parser continues at the stream interpreter event tail.',
    confidence: 'high',
    evidence: [
      'Dispatch table entry $F0 at ROM 0x0C391 points to Z80 $83B1 / ROM 0x0C3B1.',
      'ASM data bytes at lines 22128-22129 decode as LD A,(BC), stream-field bit-select writes, optional LD (IY+6),A, INC BC, and JP $821A.',
      'The hardware shadow field IY+6 is named instrument_or_effect_id by world-audio-ram-state-catalog-2026-06-25.',
    ],
  },
  {
    opcode: 0xF1,
    handlerRomOffset: 0x0C3C9,
    handlerEndExclusive: 0x0C3DB,
    name: 'stream_parameter_pair_store',
    argSemantics: ['parameter_byte_0', 'parameter_byte_1'],
    streamStructEffects: [
      'Stores two immediate bytes into separate HL-relative stream parameter fields.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'Two-byte control event; parser continues at the stream interpreter event tail.',
    confidence: 'high',
    evidence: [
      'Dispatch table entry $F1 at ROM 0x0C393 points to Z80 $83C9 / ROM 0x0C3C9.',
      'ASM data bytes at lines 22129-22130 decode as two LD A,(BC) / INC BC / LD (HL),A groups before JP $821A.',
    ],
  },
  {
    opcode: 0xF2,
    handlerRomOffset: 0x0C3DB,
    handlerEndExclusive: 0x0C3EF,
    name: 'stream_parameter_pair_add',
    argSemantics: ['parameter_delta_0', 'parameter_delta_1'],
    streamStructEffects: [
      'Adds two immediate bytes to separate HL-relative stream parameter fields and stores the sums.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'Two-byte control event; parser continues at the stream interpreter event tail.',
    confidence: 'high',
    evidence: [
      'Dispatch table entry $F2 at ROM 0x0C395 points to Z80 $83DB / ROM 0x0C3DB.',
      'ASM data bytes at lines 22130-22131 decode as two LD A,(BC) / INC BC / ADD A,(HL) / LD (HL),A groups before JP $821A.',
    ],
  },
  {
    opcode: 0xF3,
    handlerRomOffset: 0x0C3EF,
    handlerEndExclusive: 0x0C3FD,
    name: 'single_stream_parameter_store',
    argSemantics: ['parameter_byte'],
    streamStructEffects: [
      'Stores one immediate byte into an HL-relative stream parameter field.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'One-byte control event; parser continues at the stream interpreter event tail.',
    confidence: 'high',
    evidence: [
      'Dispatch table entry $F3 at ROM 0x0C397 points to Z80 $83EF / ROM 0x0C3EF.',
      'ASM data bytes at lines 22131 and 22135-22136 decode as LD A,(BC), LD (HL),A, INC BC, and JP $821A.',
    ],
  },
  {
    opcode: 0xF4,
    handlerRomOffset: 0x0C3FD,
    handlerEndExclusive: 0x0C412,
    name: 'single_stream_parameter_add_clamped',
    argSemantics: ['parameter_delta'],
    streamStructEffects: [
      'Adds one immediate byte to an HL-relative stream parameter field.',
      'Clamps the result to 0x0F when the decoded result crosses the handler bit test.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'One-byte control event; parser continues at the stream interpreter event tail.',
    confidence: 'medium',
    evidence: [
      'Dispatch table entry $F4 at ROM 0x0C399 points to Z80 $83FD / ROM 0x0C3FD.',
      'ASM data bytes at lines 22136 and 22141 decode as LD A,(BC), ADD A,(HL), conditional LD A,$0F, LD (HL),A, INC BC, and JP $821A.',
    ],
  },
  {
    opcode: 0xF5,
    handlerRomOffset: 0x0C412,
    handlerEndExclusive: 0x0C427,
    name: 'indexed_support_table_load',
    argSemantics: ['support_table_index'],
    streamStructEffects: [
      'Reads one immediate index, converts it to a bank-3 support-table address around Z80 $8423, and stores one fetched byte into an HL-relative stream field.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'One-byte control event; parser continues at the stream interpreter event tail.',
    confidence: 'medium',
    evidence: [
      'Dispatch table entry $F5 at ROM 0x0C39B points to Z80 $8412 / ROM 0x0C412.',
      'ASM data bytes at lines 22142-22143 decode as LD A,(BC), INC BC, ADD A,$23, form DE=$84xx, LD A,(DE), LD (HL),A, and JP $821A.',
    ],
  },
  {
    opcode: 0xF6,
    handlerRomOffset: 0x0C427,
    handlerEndExclusive: 0x0C441,
    name: 'call_stream_pointer',
    argSemantics: ['target_pointer_lo', 'target_pointer_hi'],
    pointerBehavior: 'Branches BC to the two-byte stream pointer argument while saving return/continuation state in the stream struct.',
    streamStructEffects: [
      'Stores the current BC continuation pointer into HL-relative stream fields before loading the call target into BC.',
      'Stores one byte from after the pointer argument into another HL-relative control field before resuming parsing.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'Two-byte pointer control event; static parser should enqueue the target stream and continue parsing the caller after the pointer argument.',
    confidence: 'high',
    evidence: [
      'Dispatch table entry $F6 at ROM 0x0C39D points to Z80 $8427 / ROM 0x0C427.',
      'ASM data bytes at lines 22143-22144 decode as stores of C/B, BC pointer-argument reads, BC target reload, and JP $821A.',
      'world-audio-opcode-metadata.mjs marks $F6 as pointerArg with parserAction enqueue_target_and_continue.',
    ],
  },
  {
    opcode: 0xF7,
    handlerRomOffset: 0x0C441,
    handlerEndExclusive: 0x0C48D,
    name: 'shared_repeat_or_return_handler',
    argSemantics: [],
    pointerBehavior: 'Shared loop/return handler; may reload BC from saved stream struct state or inline stream words depending on repeat state.',
    streamStructEffects: [
      'Tests and decrements an HL-relative repeat/control counter.',
      'Reloads BC from saved stream fields or from stream data before resuming the interpreter tail.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'No immediate argument bytes; static parser treats this as shared control flow and continues conservatively unless a caller-specific opcode model stops the segment.',
    confidence: 'medium',
    evidence: [
      'Dispatch table entry $F7 at ROM 0x0C39F points to Z80 $8441 / ROM 0x0C441.',
      'ASM data bytes at lines 22145-22147 decode as counter test/decrement, BC reload paths, stream-data reads, and JP $821A.',
      'The same handler target is shared by $F7, $FB, $FC, $FD, $FE, and $FF.',
    ],
  },
  {
    opcode: 0xF8,
    handlerRomOffset: 0x0C48D,
    handlerEndExclusive: 0x0C49F,
    name: 'repeat_counter_setup',
    argSemantics: ['repeat_count'],
    streamStructEffects: [
      'Stores one immediate repeat count into an HL-relative counter field.',
      'Stores the current BC stream pointer as the repeat body pointer.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'One-byte loop setup event; parser continues after the repeat count.',
    confidence: 'high',
    evidence: [
      'Dispatch table entry $F8 at ROM 0x0C3A1 points to Z80 $848D / ROM 0x0C48D.',
      'ASM data bytes at lines 22149-22150 decode as LD A,(BC), INC BC, store count, store B/C, and JP $821A.',
    ],
  },
  {
    opcode: 0xF9,
    handlerRomOffset: 0x0C49F,
    handlerEndExclusive: 0x0C4B8,
    name: 'repeat_or_loop_end',
    argSemantics: [],
    pointerBehavior: 'Decrements the repeat counter and either loops back through saved BC or falls through to the shared return path.',
    streamStructEffects: [
      'Decrements an HL-relative repeat counter.',
      'Reloads BC from saved repeat-body pointer fields while the counter remains active.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'No immediate argument bytes; static parser should stop this segment to avoid unbounded loop expansion.',
    confidence: 'medium',
    evidence: [
      'Dispatch table entry $F9 at ROM 0x0C3A3 points to Z80 $849F / ROM 0x0C49F.',
      'ASM data bytes at lines 22150-22152 decode as counter decrement, conditional BC reload, and JP $821A.',
      'world-audio-opcode-metadata.mjs marks $F9 with parserAction stop_segment.',
    ],
  },
  {
    opcode: 0xFA,
    handlerRomOffset: 0x0C4B8,
    handlerEndExclusive: 0x0C4C1,
    name: 'jump_stream_pointer',
    argSemantics: ['target_pointer_lo', 'target_pointer_hi'],
    pointerBehavior: 'Loads BC directly from the two-byte stream pointer argument and resumes parsing at that target.',
    streamStructEffects: [
      'Does not save a caller return pointer; BC is replaced by the immediate stream pointer target.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'Two-byte pointer jump event; static parser should enqueue the target and stop the current segment.',
    confidence: 'high',
    evidence: [
      'Dispatch table entry $FA at ROM 0x0C3A5 points to Z80 $84B8 / ROM 0x0C4B8.',
      'ASM data bytes at line 22152 decode as low-byte read, high-byte read, BC target reload, and JP $821A.',
      'world-audio-opcode-metadata.mjs marks $FA as pointerArg with parserAction branch_and_stop_segment.',
    ],
  },
  {
    opcode: 0xFB,
    handlerRomOffset: 0x0C441,
    handlerEndExclusive: 0x0C48D,
    name: 'shared_repeat_or_return_handler',
    argSemantics: [],
    pointerBehavior: 'Shares the $F7 loop/return handler at ROM 0x0C441.',
    streamStructEffects: [
      'Uses the same repeat/control counter and BC reload behavior as $F7.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'No immediate argument bytes; parser continues conservatively.',
    confidence: 'medium',
    evidence: [
      'Dispatch table entry $FB at ROM 0x0C3A7 points to the shared handler Z80 $8441 / ROM 0x0C441.',
      'The shared handler body is documented under $F7.',
    ],
  },
  {
    opcode: 0xFC,
    handlerRomOffset: 0x0C441,
    handlerEndExclusive: 0x0C48D,
    name: 'shared_repeat_or_return_handler',
    argSemantics: [],
    pointerBehavior: 'Shares the $F7 loop/return handler at ROM 0x0C441.',
    streamStructEffects: [
      'Uses the same repeat/control counter and BC reload behavior as $F7.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'No immediate argument bytes; parser continues conservatively.',
    confidence: 'medium',
    evidence: [
      'Dispatch table entry $FC at ROM 0x0C3A9 points to the shared handler Z80 $8441 / ROM 0x0C441.',
      'The shared handler body is documented under $F7.',
    ],
  },
  {
    opcode: 0xFD,
    handlerRomOffset: 0x0C441,
    handlerEndExclusive: 0x0C48D,
    name: 'shared_repeat_or_return_handler',
    argSemantics: [],
    pointerBehavior: 'Shares the $F7 loop/return handler at ROM 0x0C441.',
    streamStructEffects: [
      'Uses the same repeat/control counter and BC reload behavior as $F7.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'No immediate argument bytes; parser continues conservatively; older two-byte-pointer assumptions are not supported by the dispatch target.',
    confidence: 'medium',
    evidence: [
      'Dispatch table entry $FD at ROM 0x0C3AB points to the shared handler Z80 $8441 / ROM 0x0C441.',
      'The shared handler body is documented under $F7.',
      'world-audio-opcode-metadata.mjs explicitly records zero immediate argument bytes for $FD.',
    ],
  },
  {
    opcode: 0xFE,
    handlerRomOffset: 0x0C441,
    handlerEndExclusive: 0x0C48D,
    name: 'shared_repeat_or_return_handler',
    argSemantics: [],
    pointerBehavior: 'Shares the $F7 loop/return handler at ROM 0x0C441.',
    streamStructEffects: [
      'Uses the same repeat/control counter and BC reload behavior as $F7.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'No immediate argument bytes; parser continues conservatively.',
    confidence: 'medium',
    evidence: [
      'Dispatch table entry $FE at ROM 0x0C3AD points to the shared handler Z80 $8441 / ROM 0x0C441.',
      'The shared handler body is documented under $F7.',
    ],
  },
  {
    opcode: 0xFF,
    handlerRomOffset: 0x0C441,
    handlerEndExclusive: 0x0C48D,
    name: 'stream_end_or_shared_repeat_handler',
    argSemantics: [],
    pointerBehavior: 'Shares the $F7 loop/return handler at ROM 0x0C441; static stream parser treats this opcode as a segment terminator.',
    streamStructEffects: [
      'Uses the same repeat/control counter and BC reload behavior as $F7 when reached through the runtime handler.',
    ],
    hardwareShadowEffects: [],
    parserImplication: 'No immediate argument bytes; static parser stops the segment to avoid crossing adjacent streams.',
    confidence: 'medium',
    evidence: [
      'Dispatch table entry $FF at ROM 0x0C3AF points to the shared handler Z80 $8441 / ROM 0x0C441.',
      'world-audio-opcode-metadata.mjs marks $FF with parserAction stop_segment.',
    ],
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function z80ForRomOffset(romOffset) {
  return romOffset >= 0x0C000 && romOffset < 0x10000 ? romOffset - 0x4000 : null;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
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

function readDispatchTable(rom) {
  const entries = [];
  for (let i = 0; i < opcodeCount; i++) {
    const opcode = opcodeBase + i;
    const tableEntryOffset = dispatchTableOffset + i * 2;
    const z80Target = rom[tableEntryOffset] | (rom[tableEntryOffset + 1] << 8);
    const romTarget = z80Target + 0x4000;
    entries.push({ opcode, tableEntryOffset, z80Target, romTarget });
  }
  return entries;
}

function buildCatalog(rom, mapData) {
  const dispatchCatalog = findCatalog(mapData, dispatchCatalogId);
  const dispatchEntries = readDispatchTable(rom);
  const dispatchByOpcode = new Map(dispatchEntries.map(entry => [entry.opcode, entry]));
  const catalogDispatchByOpcode = new Map((dispatchCatalog?.entries || []).map(entry => [
    parseInt(entry.opcode.replace('$', ''), 16),
    entry,
  ]));
  const validationIssues = [];

  const opcodes = EFFECT_DEFS.map(def => {
    const metadata = AUDIO_OPCODE_METADATA_BY_OPCODE.get(def.opcode) || null;
    const tableEntry = dispatchByOpcode.get(def.opcode);
    const catalogDispatch = catalogDispatchByOpcode.get(def.opcode);
    const expectedZ80 = z80ForRomOffset(def.handlerRomOffset);
    const targetRegion = findContainingRegion(mapData, def.handlerRomOffset);
    const dispatchMatches = Boolean(tableEntry && expectedZ80 != null && tableEntry.z80Target === expectedZ80);
    const metadataMatches = Boolean(metadata && metadata.argBytes === def.argSemantics.length);
    const catalogMatches = Boolean(catalogDispatch && catalogDispatch.romTarget === hex(def.handlerRomOffset));

    if (!dispatchMatches) {
      validationIssues.push({
        opcode: audioOpcodeKey(def.opcode),
        kind: 'dispatch_target_mismatch',
        expectedRomTarget: hex(def.handlerRomOffset),
        tableRomTarget: tableEntry ? hex(tableEntry.romTarget) : null,
      });
    }
    if (!metadataMatches) {
      validationIssues.push({
        opcode: audioOpcodeKey(def.opcode),
        kind: 'arg_byte_metadata_mismatch',
        expectedArgBytes: def.argSemantics.length,
        metadataArgBytes: metadata?.argBytes ?? null,
      });
    }
    if (dispatchCatalog && !catalogMatches) {
      validationIssues.push({
        opcode: audioOpcodeKey(def.opcode),
        kind: 'dispatch_catalog_mismatch',
        expectedRomTarget: hex(def.handlerRomOffset),
        catalogRomTarget: catalogDispatch?.romTarget || null,
      });
    }

    return {
      opcode: audioOpcodeKey(def.opcode),
      opcodeByte: def.opcode,
      tableEntryOffset: hex(tableEntry?.tableEntryOffset ?? (dispatchTableOffset + (def.opcode - opcodeBase) * 2)),
      handlerZ80Target: expectedZ80 == null ? null : hex(expectedZ80, 4),
      handlerRomOffset: hex(def.handlerRomOffset),
      handlerEndExclusive: hex(def.handlerEndExclusive),
      handlerSizeBytes: def.handlerEndExclusive - def.handlerRomOffset,
      handlerRegion: regionRef(targetRegion),
      name: def.name,
      argBytes: def.argSemantics.length,
      argSemantics: def.argSemantics,
      pointerBehavior: def.pointerBehavior || null,
      streamStructEffects: def.streamStructEffects,
      hardwareShadowEffects: def.hardwareShadowEffects,
      parserImplication: def.parserImplication,
      metadataRole: metadata?.role || '',
      metadataParserAction: metadata?.parserAction || '',
      metadataConfidence: metadata?.confidence || '',
      dispatchMatches,
      metadataMatches,
      dispatchCatalogMatches: !dispatchCatalog || catalogMatches,
      confidence: def.confidence,
      evidence: def.evidence,
    };
  });

  const uniqueHandlerTargets = [...new Set(opcodes.map(entry => entry.handlerRomOffset))];
  const sharedHandlerOpcodes = opcodes.filter(entry => (
    opcodes.filter(other => other.handlerRomOffset === entry.handlerRomOffset).length > 1
  ));
  const immediatePointerArgOpcodes = opcodes.filter(entry => (
    entry.argSemantics.some(arg => arg.startsWith('target_pointer_'))
  ));
  const branchOrLoopControlOpcodes = opcodes.filter(entry => entry.pointerBehavior);
  const hardwareShadowMutatingOpcodes = opcodes.filter(entry => entry.hardwareShadowEffects.length);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    dispatchTable: {
      label: '_DATA_C391_',
      romOffset: hex(dispatchTableOffset),
      z80Address: hex(0x8391, 4),
      entries: opcodeCount,
      targetBank: 3,
      z80ToRomFormula: 'rom = z80 + 0x4000 for bank-3 audio handler targets',
      sourceCatalogId: dispatchCatalog ? dispatchCatalogId : null,
    },
    interpreterContext: {
      dispatchRoutine: '_LABEL_C37B_',
      streamInterpreter: '_LABEL_C191_',
      streamEventTailRomOffset: hex(0x0C21A),
      streamStateCommitRoutine: '_LABEL_C339_',
      streamStructCatalogId: 'world-audio-ram-state-catalog-2026-06-25',
      summary: 'The dispatch routine has already advanced BC past the opcode byte; handler argBytes describe extra bytes consumed by each handler.',
    },
    summary: {
      opcodeCount: opcodes.length,
      uniqueHandlerTargets: uniqueHandlerTargets.length,
      dispatchTargetValidatedCount: opcodes.filter(entry => entry.dispatchMatches).length,
      argByteMetadataValidatedCount: opcodes.filter(entry => entry.metadataMatches).length,
      dispatchCatalogValidatedCount: opcodes.filter(entry => entry.dispatchCatalogMatches).length,
      validationIssueCount: validationIssues.length,
      immediatePointerArgOpcodeCount: immediatePointerArgOpcodes.length,
      branchOrLoopControlOpcodeCount: branchOrLoopControlOpcodes.length,
      sharedHandlerOpcodeCount: sharedHandlerOpcodes.length,
      hardwareShadowMutatingOpcodeCount: hardwareShadowMutatingOpcodes.length,
      assetPolicy: 'Metadata only: opcode ids, offsets, handler sizes, state-effect descriptions, parser implications, and ASM line references. No ROM bytes, decoded music, audio samples, or generated assets are embedded.',
    },
    opcodes,
    validationIssues,
    sharedHandlers: uniqueHandlerTargets
      .map(handlerRomOffset => ({
        handlerRomOffset,
        opcodes: opcodes
          .filter(entry => entry.handlerRomOffset === handlerRomOffset)
          .map(entry => entry.opcode),
      }))
      .filter(group => group.opcodes.length > 1),
  };
}

function annotateMap(mapData, catalog) {
  const byRegion = new Map();
  for (const opcode of catalog.opcodes) {
    if (!opcode.handlerRegion) continue;
    if (!byRegion.has(opcode.handlerRegion.id)) byRegion.set(opcode.handlerRegion.id, []);
    byRegion.get(opcode.handlerRegion.id).push(opcode);
  }

  const annotatedRegions = [];
  for (const [regionId, opcodes] of byRegion.entries()) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.audioOpcodeStateEffectAudit = {
      catalogId,
      kind: 'music_opcode_handler_state_effects',
      confidence: opcodes.every(entry => entry.confidence === 'high') ? 'high' : 'medium',
      summary: `${opcodes.length} music stream control opcode state-effect record(s) dispatch into this region.`,
      opcodes: opcodes.map(entry => ({
        opcode: entry.opcode,
        name: entry.name,
        handlerRomOffset: entry.handlerRomOffset,
        argBytes: entry.argBytes,
        metadataParserAction: entry.metadataParserAction,
        pointerBehavior: entry.pointerBehavior,
        streamStructEffects: entry.streamStructEffects,
        hardwareShadowEffects: entry.hardwareShadowEffects,
        confidence: entry.confidence,
      })),
      evidence: [
        '_LABEL_C37B_ dispatches $F0-$FF music stream control opcodes through _DATA_C391_.',
        'Handler targets and argument counts are validated against ROM table pointers and tools/world-audio-opcode-metadata.mjs.',
        ...opcodes.flatMap(entry => entry.evidence.slice(0, 2)).slice(0, 12),
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      opcodeCount: opcodes.length,
      opcodes: opcodes.map(entry => entry.opcode),
    });
  }

  return { annotatedRegions };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotations = apply ? annotateMap(mapData, catalog) : { annotatedRegions: [] };

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_opcode_state_effect_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotations.annotatedRegions.length,
      },
      annotatedRegions: annotations.annotatedRegions,
      validationIssues: catalog.validationIssues,
      nextLeads: [
        'Trace the HL-relative stream fields touched by $F1-$F5 against concrete channel base addresses to name the remaining audio stream struct offsets.',
        'Use the $F6/$FA pointer behavior to build a branch-aware music stream graph per request id.',
        'Build a read-only frame trace that applies these opcode state effects to synthetic $C100/$C200 audio RAM before adding audible PSG/FM playback.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotations.annotatedRegions.length,
    },
    validationIssues: catalog.validationIssues,
    firstOpcodes: catalog.opcodes.slice(0, 6).map(entry => ({
      opcode: entry.opcode,
      name: entry.name,
      handlerRomOffset: entry.handlerRomOffset,
      argBytes: entry.argBytes,
      dispatchMatches: entry.dispatchMatches,
      metadataMatches: entry.metadataMatches,
      parserAction: entry.metadataParserAction,
    })),
  }, null, 2));
}

main();
