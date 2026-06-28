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
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-metasprite-oam-writer-semantics-catalog-2026-06-25';
const reportId = 'metasprite-oam-writer-semantics-audit-2026-06-25';
const toolName = 'tools/world-metasprite-oam-writer-semantics-audit.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function asmEvidence(lines, lineNo, pattern) {
  const text = lines[lineNo - 1] || '';
  if (!text.includes(pattern)) {
    throw new Error(`ASM evidence mismatch at line ${lineNo}: expected ${pattern}`);
  }
  return { line: lineNo, text: text.trim() };
}

function buildCatalog(asmText) {
  const lines = asmText.split(/\r?\n/);
  const evidenceLines = [
    asmEvidence(lines, 1907, '_LABEL_6E7_:'),
    asmEvidence(lines, 1916, 'call z, _LABEL_760_'),
    asmEvidence(lines, 1934, 'call z, _LABEL_760_'),
    asmEvidence(lines, 1945, 'call z, _LABEL_760_'),
    asmEvidence(lines, 1958, '_LABEL_760_:'),
    asmEvidence(lines, 1959, 'ld l, (ix+3)'),
    asmEvidence(lines, 1960, 'ld h, (ix+4)'),
    asmEvidence(lines, 1961, 'bit 5, (ix+0)'),
    asmEvidence(lines, 1963, 'ld de, (_RAM_D007_)'),
    asmEvidence(lines, 1965, 'sbc hl, de'),
    asmEvidence(lines, 1967, 'ld (_RAM_D00B_), hl'),
    asmEvidence(lines, 1968, 'ld l, (ix+6)'),
    asmEvidence(lines, 1969, 'ld h, (ix+7)'),
    asmEvidence(lines, 1970, 'bit 5, (ix+0)'),
    asmEvidence(lines, 1972, 'ld de, (_RAM_D009_)'),
    asmEvidence(lines, 1974, 'sbc hl, de'),
    asmEvidence(lines, 1976, 'ld (_RAM_D00D_), hl'),
    asmEvidence(lines, 1977, 'ld l, (ix+12)'),
    asmEvidence(lines, 1978, 'ld h, (ix+13)'),
    asmEvidence(lines, 1982, 'cp $80'),
    asmEvidence(lines, 1983, 'ret z'),
    asmEvidence(lines, 1995, 'ld a, (_RAM_D00B_)'),
    asmEvidence(lines, 1997, 'ld (iy+1), a'),
    asmEvidence(lines, 2006, 'ld e, (hl)'),
    asmEvidence(lines, 2013, 'ld a, (_RAM_D00D_)'),
    asmEvidence(lines, 2020, 'cp $C0'),
    asmEvidence(lines, 2027, 'ld (iy+0), a'),
    asmEvidence(lines, 2028, 'ld a, (hl)'),
    asmEvidence(lines, 2030, 'add a, (ix+63)'),
    asmEvidence(lines, 2031, 'ld (iy+2), a'),
    asmEvidence(lines, 2032, 'ld de, $0003'),
    asmEvidence(lines, 2033, 'add iy, de'),
    asmEvidence(lines, 14843, 'ld a, (iy+5)'),
    asmEvidence(lines, 14844, 'ld (ix+63), a'),
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceRoutines: ['_LABEL_6E7_', '_LABEL_760_', '_LABEL_792_', '_LABEL_65B9_'],
    sourceCatalogs: [
      'world-animation-frame-stream-catalog-2026-06-25',
      'world-room-entity-renderable-frame-fixture-catalog-2026-06-25',
    ],
    summary: {
      frameStreamRoutine: '_LABEL_792_',
      slotScanRoutine: '_LABEL_6E7_',
      positionProducerRoutine: '_LABEL_760_',
      roomEntityTileBaseInitializer: '_LABEL_65B9_',
      inputPointer: 'IX+12/IX+13',
      terminatorByte: '0x80',
      pieceRecordByteLength: 3,
      outputRecordByteLength: 3,
      outputBufferRecordOrder: ['screen_y', 'screen_x', 'tile_id'],
      tileBaseField: 'IX+63',
      roomRecordTileBaseSource: 'IY+5',
      xBaseRam: '_RAM_D00B_/_RAM_D00C_',
      yBaseRam: '_RAM_D00D_/_RAM_D00E_',
      xBaseSlotFields: 'IX+3/IX+4',
      yBaseSlotFields: 'IX+6/IX+7',
      xCameraRam: '_RAM_D007_',
      yCameraRam: '_RAM_D009_',
      cameraSubtractFlag: 'IX+0 bit 5 clear',
      confidence: 'high',
      persistedRomByteCount: 0,
      persistedCoordinateCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: routine labels, line numbers, field roles, byte counts, RAM/indexed field names, and evidence. No ROM bytes, decoded sprite coordinates, graphics, screenshots, or rendered assets are embedded.',
    },
    pieceRecordSemantics: {
      recordLengthBytes: 3,
      byte0: {
        name: 'signed_x_offset',
        consumer: '_LABEL_792_ lines 1989-1999 sign-extend the byte and add it to _RAM_D00B_/_RAM_D00C_.',
        output: '(IY+1) screen X when the high byte remains zero.',
      },
      byte1: {
        name: 'signed_y_offset',
        consumer: '_LABEL_792_ lines 2006-2021 sign-extend the byte, add it to _RAM_D00D_/_RAM_D00E_, and require Y < 0xC0.',
        output: '(IY+0) screen Y.',
      },
      byte2: {
        name: 'tile_byte',
        consumer: '_LABEL_792_ lines 2028-2031 add IX+63 and write the result to (IY+2).',
        output: 'OAM tile id modulo 0x100.',
      },
      terminator: {
        value: '0x80',
        evidence: '_LABEL_792_ lines 1980-1983 return when the first record byte equals 0x80.',
      },
    },
    outputSemantics: {
      buffer: 'IY points into the OAM staging buffer.',
      outputRecordOrder: ['screen_y', 'screen_x', 'tile_id'],
      outputStrideBytes: 3,
      clipping: [
        'X is skipped when the signed base-plus-offset high byte is nonzero.',
        'Y is skipped when the signed base-plus-offset high byte is nonzero or the low byte is >= 0xC0.',
      ],
      completionFlag: '_RAM_CFE0_ is set to 0x01 when the output counter C reaches zero.',
    },
    positionInputSemantics: {
      producerRoutine: '_LABEL_760_',
      consumerRoutine: '_LABEL_792_',
      xBase: {
        slotFields: ['IX+3', 'IX+4'],
        cameraRam: '_RAM_D007_',
        outputRam: ['_RAM_D00B_', '_RAM_D00C_'],
        formula: 'If IX+0 bit 5 is clear, X base = word(IX+3/IX+4) - word(_RAM_D007_); otherwise X base = word(IX+3/IX+4).',
        consumer: '_LABEL_792_ adds signed frame byte 0 to _RAM_D00B_/_RAM_D00C_ and stores the visible low byte to (IY+1).',
      },
      yBase: {
        slotFields: ['IX+6', 'IX+7'],
        cameraRam: '_RAM_D009_',
        outputRam: ['_RAM_D00D_', '_RAM_D00E_'],
        formula: 'If IX+0 bit 5 is clear, Y base = word(IX+6/IX+7) - word(_RAM_D009_); otherwise Y base = word(IX+6/IX+7).',
        consumer: '_LABEL_792_ adds signed frame byte 1 to _RAM_D00D_/_RAM_D00E_, requires the low byte to be < 0xC0, and stores it to (IY+0).',
      },
      slotScan: {
        routine: '_LABEL_6E7_',
        playerSlotBase: '_RAM_C240_',
        primaryEntitySlotBase: '_RAM_C280_ or _RAM_C600_ depending on _RAM_D004_ parity',
        secondaryEntitySlotBase: '_RAM_C640_',
        drawableCondition: 'IX+0 bit 7 set and IX+0 bit 6 clear.',
        oamStagingBase: '_RAM_CA40_',
      },
      confidence: 'high',
    },
    tileBaseSemantics: {
      tileBaseField: 'IX+63',
      roomEntityInitializer: '_LABEL_65B9_',
      roomRecordSourceField: 'IY+5',
      evidence: 'ASM lines 14843-14844 copy the room entity record tile-base byte from IY+5 into IX+63.',
    },
    evidence: evidenceLines.map(item => `ASM line ${item.line}: ${item.text}`),
    nextLeads: [
      'Use this record shape and position-base provenance for browser-local frame previews, but keep decoded coordinates and pixels out of map.json.',
      'Trace room/player runtime slot coordinate producers for IX+3/IX+4 and IX+6/IX+7 to attach true actor positions to sprite previews.',
      'Use IX+63 provenance with static/alternate tile loaders to unblock the 50 partial or blocked frame subrecords.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(item => item.id !== catalogId);
  mapData.metaspriteCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'metasprite_oam_writer_semantics_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceRoutines: catalog.sourceRoutines,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    pieceRecordSemantics: catalog.pieceRecordSemantics,
    outputSemantics: catalog.outputSemantics,
    positionInputSemantics: catalog.positionInputSemantics,
    tileBaseSemantics: catalog.tileBaseSemantics,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const catalog = buildCatalog(fs.readFileSync(asmPath, 'utf8'));
  if (apply) {
    const mapData = readJson(mapPath);
    applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    id: catalog.id,
    summary: catalog.summary,
    evidence: catalog.evidence,
  }, null, 2));
}

main();
