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
const catalogId = 'world-entity-velocity-field-provenance-catalog-2026-06-25';
const reportId = 'entity-velocity-field-provenance-audit-2026-06-25';
const toolName = 'tools/world-entity-velocity-field-provenance-audit.mjs';

const fieldDefs = {
  8: { token: 'IX+8', axis: 'x', word: 'IX+8/IX+9', byteRole: 'low', role: 'actor_slot_x_velocity_low' },
  9: { token: 'IX+9', axis: 'x', word: 'IX+8/IX+9', byteRole: 'high', role: 'actor_slot_x_velocity_high' },
  10: { token: 'IX+10', axis: 'y', word: 'IX+10/IX+11', byteRole: 'low', role: 'actor_slot_y_velocity_low' },
  11: { token: 'IX+11', axis: 'y', word: 'IX+10/IX+11', byteRole: 'high', role: 'actor_slot_y_velocity_high' },
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
  if (/^[lhde]$/i.test(src)) return 'write_from_word_register_part';
  if (/^a$/i.test(src)) return 'write_from_accumulator';
  return 'write_from_other_source';
}

function instructionSummary(text, fieldNumber) {
  const instruction = text.split(';')[0].trim().replace(/\s+/g, ' ');
  if (/^ld\s+\(ix\+\d+\)\s*,/i.test(instruction)) return `writes ${fieldDefs[fieldNumber].token}`;
  if (/^ld\s+[^,]+,\s*\(ix\+\d+\)/i.test(instruction)) return `reads ${fieldDefs[fieldNumber].token}`;
  if (/^bit\s+/i.test(instruction)) return `tests ${fieldDefs[fieldNumber].token}`;
  if (/^inc\s+\(ix\+\d+\)/i.test(instruction)) return `increments ${fieldDefs[fieldNumber].token}`;
  if (/^dec\s+\(ix\+\d+\)/i.test(instruction)) return `decrements ${fieldDefs[fieldNumber].token}`;
  return `uses ${fieldDefs[fieldNumber].token}`;
}

function contextFor(label) {
  if (label === '_LABEL_12D8_') return 'confirmed_x_velocity_integrator_consumer';
  if (label === '_LABEL_12F8_') return 'confirmed_y_velocity_integrator_consumer';
  if (label === '_LABEL_1B4B_') return 'confirmed_x_velocity_signed_delta_helper';
  if (label === '_LABEL_1B25_' || label === '_LABEL_1B22_') return 'confirmed_y_velocity_signed_delta_helper';
  if (label === '_LABEL_18DC_' || label === '_LABEL_18EE_') return 'confirmed_y_velocity_contact_response_helper';
  if (label === '_LABEL_1951_') return 'confirmed_x_velocity_contact_response_helper';
  if (label === '_LABEL_43B8_') return 'candidate_table_driven_slot_initializer';
  return 'candidate_velocity_context';
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
        word: fieldDefs[fieldNumber].word,
        byteRole: fieldDefs[fieldNumber].byteRole,
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
  const topRoutines = Object.entries(routineCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([label, count]) => ({ label, count }));
  return {
    token: field.token,
    role: field.role,
    axis: field.axis,
    word: field.word,
    byteRole: field.byteRole,
    referenceCount: fieldRefs.length,
    readReferenceCount: fieldRefs.filter(ref => ref.access === 'read').length,
    writeReferenceCount: fieldRefs.filter(ref => ref.access === 'write').length,
    readWriteReferenceCount: fieldRefs.filter(ref => ref.access === 'read_write').length,
    unknownReferenceCount: fieldRefs.filter(ref => ref.access === 'unknown').length,
    writeKindCounts: countsBy(fieldRefs.filter(ref => ref.writeKind), 'writeKind'),
    topRoutines,
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
  const confirmedContextRefs = references.filter(ref => ref.context.startsWith('confirmed_'));
  const contextCounts = countsBy(references, 'context');

  const evidence = [
    asmEvidence(lines, 3675, 'ld e, (ix+8)', '_LABEL_12D8_ reads IX+8 as horizontal velocity low byte.'),
    asmEvidence(lines, 3676, 'ld d, (ix+9)', '_LABEL_12D8_ reads IX+9 as horizontal velocity high/sign byte.'),
    asmEvidence(lines, 3692, 'ld e, (ix+10)', '_LABEL_12F8_ reads IX+10 as vertical velocity low byte.'),
    asmEvidence(lines, 3693, 'ld d, (ix+11)', '_LABEL_12F8_ reads IX+11 as vertical velocity high/sign byte.'),
    asmEvidence(lines, 4532, 'ld (ix+10), $00', '_LABEL_18DC_ can reset vertical velocity low byte.'),
    asmEvidence(lines, 4533, 'ld (ix+11), $00', '_LABEL_18DC_ can reset vertical velocity high byte.'),
    asmEvidence(lines, 4560, 'ld (ix+10), l', '_LABEL_18EE_ writes transformed vertical velocity low byte.'),
    asmEvidence(lines, 4561, 'ld (ix+11), h', '_LABEL_18EE_ writes transformed vertical velocity high byte.'),
    asmEvidence(lines, 4631, 'ld (ix+8), $00', '_LABEL_1951_ can reset horizontal velocity low byte.'),
    asmEvidence(lines, 4632, 'ld (ix+9), $00', '_LABEL_1951_ can reset horizontal velocity high byte.'),
    asmEvidence(lines, 4645, 'ld (ix+8), l', '_LABEL_1951_ can write transformed horizontal velocity low byte.'),
    asmEvidence(lines, 4646, 'ld (ix+9), h', '_LABEL_1951_ can write transformed horizontal velocity high byte.'),
    asmEvidence(lines, 4905, 'ld (ix+10), l', '_LABEL_1B25_ writes Y velocity low byte after adding signed delta from IX+31.'),
    asmEvidence(lines, 4906, 'ld (ix+11), h', '_LABEL_1B25_ writes Y velocity high byte after adding signed delta from IX+31.'),
    asmEvidence(lines, 4930, 'ld (ix+8), l', '_LABEL_1B4B_ writes X velocity low byte after adding signed delta from IX+30.'),
    asmEvidence(lines, 4931, 'ld (ix+9), h', '_LABEL_1B4B_ writes X velocity high byte after adding signed delta from IX+30.'),
    asmEvidence(lines, 10442, 'ld (ix+8), e', '_LABEL_43B8_ table-driven slot initializer writes horizontal velocity low byte.'),
    asmEvidence(lines, 10443, 'ld (ix+9), d', '_LABEL_43B8_ table-driven slot initializer writes horizontal velocity high byte.'),
    asmEvidence(lines, 10445, 'ld (ix+10), e', '_LABEL_43B8_ table-driven slot initializer writes vertical velocity low byte.'),
    asmEvidence(lines, 10446, 'ld (ix+11), d', '_LABEL_43B8_ table-driven slot initializer writes vertical velocity high byte.'),
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      'world-entity-runtime-struct-field-catalog-2026-06-25',
      'world-entity-position-integrator-catalog-2026-06-25',
    ],
    sourceRoutines: ['_LABEL_12D8_', '_LABEL_12F8_', '_LABEL_18DC_', '_LABEL_18EE_', '_LABEL_1951_', '_LABEL_1B25_', '_LABEL_1B4B_', '_LABEL_43B8_'],
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
      candidateContextReferenceCount: contextCounts.candidate_velocity_context || 0,
      xVelocityFields: 'IX+8/IX+9',
      yVelocityFields: 'IX+10/IX+11',
      xIntegratorConsumer: '_LABEL_12D8_',
      yIntegratorConsumer: '_LABEL_12F8_',
      xVelocitySignedDeltaHelper: '_LABEL_1B4B_',
      yVelocitySignedDeltaHelper: '_LABEL_1B25_',
      xContactResponseHelper: '_LABEL_1951_',
      yContactResponseHelpers: '_LABEL_18DC_/_LABEL_18EE_',
      tableDrivenInitializer: '_LABEL_43B8_',
      persistedRomByteCount: 0,
      persistedGameplayValueCount: 0,
      confidence: 'high_for_integrator_consumers_and_named_helpers_medium_for_remaining_candidate_velocity_contexts',
      assetPolicy: 'Metadata only: field names, access categories, labels, line numbers, counts, and evidence. No ROM bytes, decoded gameplay tables, graphics, screenshots, or assets are embedded.',
    },
    confirmedSemantics: {
      integratorConsumers: {
        x: {
          routine: '_LABEL_12D8_',
          fields: ['IX+8', 'IX+9'],
          positionTarget: 'IX+4:IX+3:IX+2',
          evidenceLines: [3675, 3676],
        },
        y: {
          routine: '_LABEL_12F8_',
          fields: ['IX+10', 'IX+11'],
          positionTarget: 'IX+7:IX+6:IX+5',
          evidenceLines: [3692, 3693],
        },
      },
      velocityDeltaHelpers: {
        x: {
          routine: '_LABEL_1B4B_',
          deltaField: 'IX+30',
          outputFields: ['IX+8', 'IX+9'],
          summary: 'Adds a sign-extended nibble-derived delta from IX+30 into the horizontal velocity word.',
          evidenceLines: [4910, 4911, 4930, 4931],
        },
        y: {
          routine: '_LABEL_1B25_',
          deltaField: 'IX+31',
          outputFields: ['IX+10', 'IX+11'],
          summary: 'Adds a sign-extended nibble-derived delta from IX+31 into the vertical velocity word.',
          evidenceLines: [4885, 4886, 4905, 4906],
        },
      },
      contactResponseHelpers: {
        x: {
          routine: '_LABEL_1951_',
          fields: ['IX+8', 'IX+9'],
          summary: 'Horizontal contact response either clears or two-complement transforms the horizontal velocity word.',
          evidenceLines: [4631, 4632, 4645, 4646],
        },
        y: {
          routines: ['_LABEL_18DC_', '_LABEL_18EE_'],
          fields: ['IX+10', 'IX+11'],
          summary: 'Vertical contact response clears or transforms the vertical velocity word after resolving the Y coordinate.',
          evidenceLines: [4532, 4533, 4560, 4561],
        },
      },
      tableInitializer: {
        routine: '_LABEL_43B8_',
        fields: ['IX+8', 'IX+9', 'IX+10', 'IX+11'],
        summary: 'Table-driven slot initializer writes both velocity words from sequential decoded words.',
        evidenceLines: [10442, 10443, 10445, 10446],
      },
    },
    fields,
    routineSummaries: routines,
    references,
    evidence,
    nextLeads: [
      'Classify remaining candidate velocity writer routines by slot family and behavior table entry.',
      'Trace IX+30 and IX+31 writers to map per-frame acceleration and knockback deltas.',
      'Use the velocity writer catalog with the position integrator catalog to start browser-local actor motion simulation without persisting gameplay tables.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityRuntimeStructCatalogs = (mapData.entityRuntimeStructCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityRuntimeStructCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_velocity_field_provenance_audit',
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
