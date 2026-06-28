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
const catalogId = 'world-entity-position-integrator-catalog-2026-06-25';
const reportId = 'entity-position-integrator-audit-2026-06-25';
const toolName = 'tools/world-entity-position-integrator-audit.mjs';

const routines = {
  bothAxes: '_LABEL_12D5_',
  xOnly: '_LABEL_12D8_',
  yOnly: '_LABEL_12F8_',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function nearestLabelBefore(lines, index) {
  for (let i = index; i >= 0; i--) {
    const match = lines[i].match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (match) return match[1];
  }
  return '';
}

function asmEvidence(lines, lineNo, pattern, claim) {
  const text = lines[lineNo - 1] || '';
  if (!text.includes(pattern)) {
    throw new Error(`ASM evidence mismatch at line ${lineNo}: expected ${pattern}`);
  }
  return {
    line: lineNo,
    label: nearestLabelBefore(lines, lineNo - 1),
    claim,
    pattern,
  };
}

function findCallers(lines, targetLabel) {
  const out = [];
  const callNeedle = `call ${targetLabel}`;
  let currentLabel = '';
  for (let i = 0; i < lines.length; i++) {
    const labelMatch = lines[i].match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (labelMatch) currentLabel = labelMatch[1];
    const instruction = lines[i].split(';')[0].trim().replace(/\s+/g, ' ');
    if (instruction === callNeedle) {
      out.push({
        caller: currentLabel,
        line: i + 1,
        call: targetLabel,
      });
    }
  }
  return out;
}

function countUnique(values) {
  return new Set(values).size;
}

function buildCatalog(asmText) {
  const lines = asmText.split(/\r?\n/);
  const callers = {
    bothAxes: findCallers(lines, routines.bothAxes),
    xOnly: findCallers(lines, routines.xOnly),
    yOnly: findCallers(lines, routines.yOnly),
  };
  const yOnlyExternal = callers.yOnly.filter(ref => ref.caller !== routines.bothAxes);
  const allExternalCallers = [
    ...callers.bothAxes,
    ...callers.xOnly,
    ...yOnlyExternal,
  ];

  const evidence = [
    asmEvidence(lines, 3672, '_LABEL_12D5_:', '_LABEL_12D5_ is the both-axis integrator entry.'),
    asmEvidence(lines, 3673, 'call _LABEL_12F8_', '_LABEL_12D5_ integrates Y first by calling _LABEL_12F8_.'),
    asmEvidence(lines, 3674, '_LABEL_12D8_:', '_LABEL_12D5_ falls through into _LABEL_12D8_ to integrate X.'),
    asmEvidence(lines, 3675, 'ld e, (ix+8)', '_LABEL_12D8_ reads horizontal velocity low byte IX+8.'),
    asmEvidence(lines, 3676, 'ld d, (ix+9)', '_LABEL_12D8_ reads horizontal velocity high/sign byte IX+9.'),
    asmEvidence(lines, 3678, 'bit 7, d', '_LABEL_12D8_ tests the velocity sign bit.'),
    asmEvidence(lines, 3680, 'dec a', '_LABEL_12D8_ sign-extends negative horizontal velocity into the position high byte carry.'),
    asmEvidence(lines, 3682, 'ld l, (ix+2)', '_LABEL_12D8_ reads X subpixel byte IX+2.'),
    asmEvidence(lines, 3683, 'ld h, (ix+3)', '_LABEL_12D8_ reads X coordinate low byte IX+3.'),
    asmEvidence(lines, 3684, 'add hl, de', '_LABEL_12D8_ adds signed horizontal velocity to IX+2/IX+3.'),
    asmEvidence(lines, 3685, 'ld (ix+2), l', '_LABEL_12D8_ writes the updated X subpixel byte IX+2.'),
    asmEvidence(lines, 3686, 'ld (ix+3), h', '_LABEL_12D8_ writes the updated X coordinate low byte IX+3.'),
    asmEvidence(lines, 3687, 'adc a, (ix+4)', '_LABEL_12D8_ carries into X coordinate high byte IX+4.'),
    asmEvidence(lines, 3688, 'ld (ix+4), a', '_LABEL_12D8_ writes the updated X coordinate high byte IX+4.'),
    asmEvidence(lines, 3691, '_LABEL_12F8_:', '_LABEL_12F8_ is the Y-only integrator entry.'),
    asmEvidence(lines, 3692, 'ld e, (ix+10)', '_LABEL_12F8_ reads vertical velocity low byte IX+10.'),
    asmEvidence(lines, 3693, 'ld d, (ix+11)', '_LABEL_12F8_ reads vertical velocity high/sign byte IX+11.'),
    asmEvidence(lines, 3695, 'bit 7, d', '_LABEL_12F8_ tests the velocity sign bit.'),
    asmEvidence(lines, 3697, 'dec a', '_LABEL_12F8_ sign-extends negative vertical velocity into the position high byte carry.'),
    asmEvidence(lines, 3699, 'ld l, (ix+5)', '_LABEL_12F8_ reads Y subpixel byte IX+5.'),
    asmEvidence(lines, 3700, 'ld h, (ix+6)', '_LABEL_12F8_ reads Y coordinate low byte IX+6.'),
    asmEvidence(lines, 3701, 'add hl, de', '_LABEL_12F8_ adds signed vertical velocity to IX+5/IX+6.'),
    asmEvidence(lines, 3702, 'ld (ix+5), l', '_LABEL_12F8_ writes the updated Y subpixel byte IX+5.'),
    asmEvidence(lines, 3703, 'ld (ix+6), h', '_LABEL_12F8_ writes the updated Y coordinate low byte IX+6.'),
    asmEvidence(lines, 3704, 'adc a, (ix+7)', '_LABEL_12F8_ carries into Y coordinate high byte IX+7.'),
    asmEvidence(lines, 3705, 'ld (ix+7), a', '_LABEL_12F8_ writes the updated Y coordinate high byte IX+7.'),
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      'world-entity-runtime-struct-field-catalog-2026-06-25',
      'world-entity-slot-coordinate-field-provenance-catalog-2026-06-25',
    ],
    sourceRoutines: [routines.bothAxes, routines.xOnly, routines.yOnly],
    summary: {
      integratorRoutineCount: 3,
      bothAxesRoutine: routines.bothAxes,
      xOnlyRoutine: routines.xOnly,
      yOnlyRoutine: routines.yOnly,
      bothAxisExternalCallCount: callers.bothAxes.length,
      xOnlyExternalCallCount: callers.xOnly.length,
      yOnlyExternalCallCount: yOnlyExternal.length,
      yOnlyInternalCallCount: callers.yOnly.length - yOnlyExternal.length,
      totalExternalCallCount: allExternalCallers.length,
      uniqueExternalCallerCount: countUnique(allExternalCallers.map(ref => ref.caller)),
      xPositionFormat: '24-bit signed fixed-point IX+4:IX+3:IX+2, with IX+2 as subpixel/fraction byte and IX+3/IX+4 as the OAM-visible coordinate word.',
      yPositionFormat: '24-bit signed fixed-point IX+7:IX+6:IX+5, with IX+5 as subpixel/fraction byte and IX+6/IX+7 as the OAM-visible coordinate word.',
      xVelocityFields: 'IX+8/IX+9 signed word',
      yVelocityFields: 'IX+10/IX+11 signed word',
      xVisibleCoordinateFields: 'IX+3/IX+4',
      yVisibleCoordinateFields: 'IX+6/IX+7',
      persistedRomByteCount: 0,
      persistedGameplayValueCount: 0,
      confidence: 'high',
      assetPolicy: 'Metadata only: routine labels, field names, caller line numbers, counts, and evidence. No ROM bytes, decoded gameplay values, graphics, screenshots, or assets are embedded.',
    },
    fixedPointSemantics: {
      x: {
        routine: routines.xOnly,
        positionBytesLowToHigh: ['IX+2', 'IX+3', 'IX+4'],
        subpixelByte: 'IX+2',
        visibleCoordinateWord: ['IX+3', 'IX+4'],
        velocityWord: ['IX+8', 'IX+9'],
        operation: 'IX+4:IX+3:IX+2 += sign_extend(IX+9:IX+8)',
        oamProducerConsumer: '_LABEL_760_ reads IX+3/IX+4 after integration.',
      },
      y: {
        routine: routines.yOnly,
        positionBytesLowToHigh: ['IX+5', 'IX+6', 'IX+7'],
        subpixelByte: 'IX+5',
        visibleCoordinateWord: ['IX+6', 'IX+7'],
        velocityWord: ['IX+10', 'IX+11'],
        operation: 'IX+7:IX+6:IX+5 += sign_extend(IX+11:IX+10)',
        oamProducerConsumer: '_LABEL_760_ reads IX+6/IX+7 after integration.',
      },
      bothAxes: {
        routine: routines.bothAxes,
        sequence: [routines.yOnly, routines.xOnly],
        evidence: '_LABEL_12D5_ calls _LABEL_12F8_ and falls through into _LABEL_12D8_.',
      },
    },
    callers: {
      bothAxes: callers.bothAxes,
      xOnly: callers.xOnly,
      yOnly: callers.yOnly,
      yOnlyExternal,
    },
    evidence,
    nextLeads: [
      'Classify the external integrator callsites by actor family and by player/enemy/projectile slot base.',
      'Trace writers to IX+8/IX+9 and IX+10/IX+11 to map acceleration, gravity, knockback, and scripted movement.',
      'Use the fixed-point position model to upgrade browser-local OAM fixture previews from normalized offsets to live slot-position previews.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityRuntimeStructCatalogs = (mapData.entityRuntimeStructCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityRuntimeStructCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_position_integrator_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceRoutines: catalog.sourceRoutines,
    summary: catalog.summary,
    fixedPointSemantics: catalog.fixedPointSemantics,
    callers: catalog.callers,
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
