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
const catalogId = 'world-entity-motion-delta-field-provenance-catalog-2026-06-25';
const reportId = 'entity-motion-delta-field-provenance-audit-2026-06-25';
const toolName = 'tools/world-entity-motion-delta-field-provenance-audit.mjs';

const fieldDefs = {
  30: { token: 'IX+30', axis: 'x', role: 'actor_slot_x_motion_delta_or_mixed_param' },
  31: { token: 'IX+31', axis: 'y', role: 'actor_slot_y_motion_delta_or_mixed_param' },
};

const fieldNumbers = Object.keys(fieldDefs).map(Number);

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

function classifyAccess(instruction, fieldNumber) {
  const field = `\\(ix\\+${fieldNumber}\\)`;
  if (new RegExp(`^\\s*(inc|dec)\\s+${field}`, 'i').test(instruction)) return 'read_write';
  if (new RegExp(`^\\s*(set|res)\\s+[^,]+,\\s*${field}`, 'i').test(instruction)) return 'read_write';
  if (new RegExp(`^\\s*ld\\s+${field}\\s*,`, 'i').test(instruction)) return 'write';
  if (new RegExp(`^\\s*(ld|cp|add|adc|sub|sbc|and|or|xor)\\b.*${field}`, 'i').test(instruction)) return 'read';
  if (new RegExp(`^\\s*bit\\s+[^,]+,\\s*${field}`, 'i').test(instruction)) return 'read';
  return 'unknown';
}

function writeKind(instruction, fieldNumber) {
  const field = `\\(ix\\+${fieldNumber}\\)`;
  const match = instruction.match(new RegExp(`^\\s*ld\\s+${field}\\s*,\\s*(.+)$`, 'i'));
  if (!match) return '';
  const src = match[1].trim();
  if (/^\$00$/i.test(src) || /^0$/i.test(src)) return 'write_immediate_zero';
  if (/^\$[0-9A-F]+$/i.test(src) || /^[0-9]+$/i.test(src)) return 'write_immediate_nonzero';
  if (/^[lhdebc]$/i.test(src)) return 'write_from_register';
  if (/^a$/i.test(src)) return 'write_from_accumulator';
  return 'write_from_other_source';
}

function contextFor(label) {
  if (label === '_LABEL_1B4B_') return 'confirmed_x_velocity_delta_consumer';
  if (label === '_LABEL_1B25_' || label === '_LABEL_1B22_') return 'confirmed_y_velocity_delta_consumer';
  if (label === '_LABEL_1A28_' || label === '_LABEL_1A36_') return 'confirmed_global_motion_accumulator_input';
  if (label === '_LABEL_7D51_' || label === '_LABEL_7DA3_' || label === '_LABEL_7DD4_' || label === '_LABEL_7DFD_') return 'confirmed_c600_motion_controller_delta_gate';
  if (label === '_LABEL_7E9C_' || label === '_LABEL_7EE1_') return 'confirmed_collision_reaction_delta_writer';
  if (label === '_LABEL_43B8_') return 'candidate_table_driven_slot_initializer';
  return 'candidate_mixed_motion_delta_context';
}

function instructionSummary(text, fieldNumber) {
  const instruction = text.split(';')[0].trim().replace(/\s+/g, ' ');
  if (/^ld\s+\(ix\+\d+\)\s*,/i.test(instruction)) return `writes ${fieldDefs[fieldNumber].token}`;
  if (/^ld\s+[^,]+,\s*\(ix\+\d+\)/i.test(instruction)) return `reads ${fieldDefs[fieldNumber].token}`;
  if (/^or\s+\(ix\+\d+\)/i.test(instruction)) return `tests ${fieldDefs[fieldNumber].token} for nonzero`;
  return `uses ${fieldDefs[fieldNumber].token}`;
}

function parseReferences(lines) {
  const references = [];
  let currentLabel = '';
  for (let i = 0; i < lines.length; i++) {
    const labelMatch = lines[i].match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (labelMatch) currentLabel = labelMatch[1];
    for (const fieldNumber of fieldNumbers) {
      if (!lines[i].toLowerCase().includes(`(ix+${fieldNumber})`)) continue;
      const instruction = lines[i].split(';')[0].trim().replace(/\s+/g, ' ');
      const access = classifyAccess(instruction, fieldNumber);
      references.push({
        field: fieldDefs[fieldNumber].token,
        role: fieldDefs[fieldNumber].role,
        axis: fieldDefs[fieldNumber].axis,
        access,
        writeKind: access === 'write' ? writeKind(instruction, fieldNumber) : '',
        label: currentLabel,
        line: i + 1,
        context: contextFor(currentLabel),
        instructionSummary: instructionSummary(lines[i], fieldNumber),
      });
    }
  }
  return references.sort((a, b) => a.line - b.line);
}

function countsBy(items, key) {
  const counts = new Map();
  for (const item of items) counts.set(item[key], (counts.get(item[key]) || 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function summarizeField(field, refs) {
  const fieldRefs = refs.filter(ref => ref.field === field.token);
  const routineCounts = countsBy(fieldRefs, 'label');
  return {
    token: field.token,
    role: field.role,
    axis: field.axis,
    referenceCount: fieldRefs.length,
    readReferenceCount: fieldRefs.filter(ref => ref.access === 'read').length,
    writeReferenceCount: fieldRefs.filter(ref => ref.access === 'write').length,
    readWriteReferenceCount: fieldRefs.filter(ref => ref.access === 'read_write').length,
    unknownReferenceCount: fieldRefs.filter(ref => ref.access === 'unknown').length,
    writeKindCounts: countsBy(fieldRefs.filter(ref => ref.writeKind), 'writeKind'),
    topRoutines: Object.entries(routineCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([label, count]) => ({ label, count })),
  };
}

function summarizeRoutines(refs) {
  const grouped = new Map();
  for (const ref of refs) {
    if (!grouped.has(ref.label)) {
      grouped.set(ref.label, {
        label: ref.label,
        context: ref.context,
        referenceCount: 0,
        fields: new Set(),
        axes: new Set(),
        accessCounts: { read: 0, write: 0, read_write: 0, unknown: 0 },
        writeKindCounts: {},
        lines: [],
      });
    }
    const item = grouped.get(ref.label);
    item.referenceCount++;
    item.fields.add(ref.field);
    item.axes.add(ref.axis);
    item.accessCounts[ref.access] = (item.accessCounts[ref.access] || 0) + 1;
    if (ref.writeKind) item.writeKindCounts[ref.writeKind] = (item.writeKindCounts[ref.writeKind] || 0) + 1;
    item.lines.push(ref.line);
  }
  return [...grouped.values()]
    .map(item => ({
      label: item.label,
      context: item.context,
      referenceCount: item.referenceCount,
      fields: [...item.fields].sort(),
      axes: [...item.axes].sort(),
      accessCounts: item.accessCounts,
      writeKindCounts: item.writeKindCounts,
      lineRange: `${Math.min(...item.lines)}-${Math.max(...item.lines)}`,
    }))
    .sort((a, b) => b.referenceCount - a.referenceCount || a.label.localeCompare(b.label));
}

function buildCatalog(asmText) {
  const lines = asmText.split(/\r?\n/);
  const references = parseReferences(lines);
  const fields = fieldNumbers.map(fieldNumber => summarizeField(fieldDefs[fieldNumber], references));
  const routines = summarizeRoutines(references);
  const accessCounts = countsBy(references, 'access');
  const writeRefs = references.filter(ref => ref.access === 'write' || ref.access === 'read_write');
  const readRefs = references.filter(ref => ref.access === 'read' || ref.access === 'read_write');
  const contextCounts = countsBy(references, 'context');
  const confirmedContextRefs = references.filter(ref => ref.context.startsWith('confirmed_'));

  const evidence = [
    asmEvidence(lines, 4709, 'ld e, (ix+31)', '_LABEL_1A28_ feeds IX+31 into the _RAM_C24A_ global motion accumulator clamp helper.'),
    asmEvidence(lines, 4716, 'ld e, (ix+30)', '_LABEL_1A36_ feeds IX+30 into the _RAM_C248_ global motion accumulator clamp helper.'),
    asmEvidence(lines, 4887, 'ld a, (ix+31)', '_LABEL_1B25_ consumes IX+31 as the signed nibble-derived Y velocity delta source.'),
    asmEvidence(lines, 4905, 'ld (ix+10), l', '_LABEL_1B25_ writes the adjusted Y velocity low byte.'),
    asmEvidence(lines, 4906, 'ld (ix+11), h', '_LABEL_1B25_ writes the adjusted Y velocity high byte.'),
    asmEvidence(lines, 4912, 'ld a, (ix+30)', '_LABEL_1B4B_ consumes IX+30 as the signed nibble-derived X velocity delta source.'),
    asmEvidence(lines, 4930, 'ld (ix+8), l', '_LABEL_1B4B_ writes the adjusted X velocity low byte.'),
    asmEvidence(lines, 4931, 'ld (ix+9), h', '_LABEL_1B4B_ writes the adjusted X velocity high byte.'),
    asmEvidence(lines, 13340, 'ld (ix+30), a', '_LABEL_59C6_ writes a runtime-selected X delta before calling the combined velocity delta helper.'),
    asmEvidence(lines, 13342, 'ld (ix+31), a', '_LABEL_59C6_ clears or seeds the paired Y delta in the same state transition.'),
    asmEvidence(lines, 14395, 'ld (ix+30), a', '_LABEL_61CE_ writes an X delta selected from facing/state.'),
    asmEvidence(lines, 14396, 'ld (ix+31), $20', '_LABEL_61CE_ seeds the Y delta magnitude used by later velocity adjustment.'),
    asmEvidence(lines, 16065, 'ld (ix+30), e', '_LABEL_7C65_ table-driven initializer writes the X delta/mixed parameter byte.'),
    asmEvidence(lines, 16066, 'ld (ix+31), d', '_LABEL_7C65_ table-driven initializer writes the Y delta/mixed parameter byte.'),
    asmEvidence(lines, 16151, 'ld a, (ix+30)', '_LABEL_7D51_ gates the C600 motion delta helpers on IX+30/IX+31 being nonzero.'),
    asmEvidence(lines, 16152, 'or (ix+31)', '_LABEL_7D51_ tests the paired C600 motion delta field.'),
    asmEvidence(lines, 16176, 'ld a, (ix+30)', '_LABEL_7DA3_ gates the C600 motion delta helpers on IX+30/IX+31 being nonzero.'),
    asmEvidence(lines, 16177, 'or (ix+31)', '_LABEL_7DA3_ tests the paired C600 motion delta field.'),
    asmEvidence(lines, 16308, 'ld (ix+31), a', '_LABEL_7E9C_ clears IX+31 during collision reaction setup.'),
    asmEvidence(lines, 16317, 'ld (ix+30), $05', '_LABEL_7E9C_ writes a positive X reaction delta.'),
    asmEvidence(lines, 16322, 'ld (ix+30), $FB', '_LABEL_7E9C_ writes a negative X reaction delta.'),
    asmEvidence(lines, 16328, 'ld (ix+30), a', '_LABEL_7EE1_ clears IX+30 during alternate collision reaction setup.'),
    asmEvidence(lines, 16329, 'ld (ix+31), a', '_LABEL_7EE1_ clears IX+31 during alternate collision reaction setup.'),
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      'world-entity-runtime-struct-field-catalog-2026-06-25',
      'world-entity-velocity-field-provenance-catalog-2026-06-25',
    ],
    sourceRoutines: ['_LABEL_1A28_', '_LABEL_1A36_', '_LABEL_1B25_', '_LABEL_1B4B_', '_LABEL_59C6_', '_LABEL_6230_', '_LABEL_7C65_', '_LABEL_7D51_', '_LABEL_7DA3_', '_LABEL_7E9C_', '_LABEL_7EE1_'],
    summary: {
      fieldCount: fields.length,
      referenceCount: references.length,
      readReferenceCount: accessCounts.read || 0,
      writeReferenceCount: accessCounts.write || 0,
      readWriteReferenceCount: accessCounts.read_write || 0,
      unknownReferenceCount: accessCounts.unknown || 0,
      writerReferenceCount: writeRefs.length,
      readerReferenceCount: readRefs.length,
      routineReferenceCount: routines.length,
      writerRoutineCount: new Set(writeRefs.map(ref => ref.label)).size,
      readerRoutineCount: new Set(readRefs.map(ref => ref.label)).size,
      confirmedContextReferenceCount: confirmedContextRefs.length,
      candidateContextReferenceCount: contextCounts.candidate_mixed_motion_delta_context || 0,
      xDeltaField: 'IX+30',
      yDeltaField: 'IX+31',
      xVelocityDeltaConsumer: '_LABEL_1B4B_',
      yVelocityDeltaConsumer: '_LABEL_1B25_',
      combinedVelocityDeltaEntry: '_LABEL_1B22_',
      xGlobalAccumulatorInput: '_LABEL_1A36_ -> _RAM_C248_',
      yGlobalAccumulatorInput: '_LABEL_1A28_ -> _RAM_C24A_',
      c600MotionControllerGateRoutines: '_LABEL_7D51_/_LABEL_7DA3_',
      collisionReactionWriters: '_LABEL_7E9C_/_LABEL_7EE1_',
      tableDrivenInitializer: '_LABEL_7C65_',
      persistedRomByteCount: 0,
      persistedGameplayValueCount: 0,
      confidence: 'high_for_velocity_delta_consumers_medium_for_mixed_motion_collision_contexts',
      assetPolicy: 'Metadata only: field names, access categories, labels, line numbers, counts, and evidence. No ROM bytes, decoded gameplay tables, graphics, screenshots, or assets are embedded.',
    },
    confirmedSemantics: {
      velocityDeltaConsumers: {
        x: {
          field: 'IX+30',
          consumerRoutine: '_LABEL_1B4B_',
          outputVelocityFields: ['IX+8', 'IX+9'],
          summary: 'IX+30 is rotated into a signed nibble-derived delta and added to the horizontal velocity word.',
          evidenceLines: [4912, 4930, 4931],
        },
        y: {
          field: 'IX+31',
          consumerRoutine: '_LABEL_1B25_',
          outputVelocityFields: ['IX+10', 'IX+11'],
          summary: 'IX+31 is rotated into a signed nibble-derived delta and added to the vertical velocity word.',
          evidenceLines: [4887, 4905, 4906],
        },
        combinedEntry: {
          routine: '_LABEL_1B22_',
          sequence: ['_LABEL_1B4B_', '_LABEL_1B25_'],
        },
      },
      globalMotionAccumulatorInputs: {
        x: {
          routine: '_LABEL_1A36_',
          field: 'IX+30',
          outputRam: '_RAM_C248_',
          summary: 'IX+30 feeds a clamped global motion accumulator helper.',
          evidenceLines: [4716],
        },
        y: {
          routine: '_LABEL_1A28_',
          field: 'IX+31',
          outputRam: '_RAM_C24A_',
          summary: 'IX+31 feeds a clamped global motion accumulator helper.',
          evidenceLines: [4709],
        },
      },
      c600MotionControllers: {
        gateRoutines: ['_LABEL_7D51_', '_LABEL_7DA3_'],
        gateFields: ['IX+30', 'IX+31'],
        helperSequenceWhenNonzero: ['_LABEL_1B4B_', '_LABEL_1B25_'],
        evidenceLines: [16151, 16152, 16176, 16177],
      },
      collisionReactionWriters: {
        routines: ['_LABEL_7E9C_', '_LABEL_7EE1_'],
        fields: ['IX+30', 'IX+31'],
        summary: 'Collision reaction setup clears or seeds the motion delta fields before returning to the C600 motion controllers.',
        evidenceLines: [16308, 16317, 16322, 16328, 16329],
      },
      tableDrivenInitializer: {
        routine: '_LABEL_7C65_',
        fields: ['IX+30', 'IX+31'],
        summary: 'Table-driven C600 slot initializer writes both motion delta/mixed parameter bytes from decoded words.',
        evidenceLines: [16065, 16066],
      },
    },
    fields,
    routineSummaries: routines,
    references,
    evidence,
    nextLeads: [
      'Classify candidate IX+30/IX+31 writers by entity behavior family and determine which are true acceleration deltas versus timers or mixed parameters.',
      'Trace behavior-table callers for _LABEL_59C6_, _LABEL_61CE_, and C600 controller routines to attach motion deltas to entity types.',
      'Use the confirmed IX+30/IX+31 -> velocity -> fixed-point position chain for browser-local actor motion previews without persisting gameplay tables.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityRuntimeStructCatalogs = (mapData.entityRuntimeStructCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityRuntimeStructCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_motion_delta_field_provenance_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceRoutines: catalog.sourceRoutines,
    summary: catalog.summary,
    confirmedSemantics: catalog.confirmedSemantics,
    fields: catalog.fields,
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
    fields: catalog.fields,
    routineSummaryCount: catalog.routineSummaries.length,
    evidence: catalog.evidence,
  }, null, 2));
}

main();
