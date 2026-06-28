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
const catalogId = 'world-entity-slot-coordinate-field-provenance-catalog-2026-06-25';
const reportId = 'entity-slot-coordinate-field-provenance-audit-2026-06-25';
const toolName = 'tools/world-entity-slot-coordinate-field-provenance-audit.mjs';

const fieldDefs = {
  3: { token: 'IX+3', axis: 'x', word: 'IX+3/IX+4', byteRole: 'low', role: 'actor_slot_x_low' },
  4: { token: 'IX+4', axis: 'x', word: 'IX+3/IX+4', byteRole: 'high', role: 'actor_slot_x_high' },
  6: { token: 'IX+6', axis: 'y', word: 'IX+6/IX+7', byteRole: 'low', role: 'actor_slot_y_low' },
  7: { token: 'IX+7', axis: 'y', word: 'IX+6/IX+7', byteRole: 'high', role: 'actor_slot_y_high' },
};

const fieldNumbers = Object.keys(fieldDefs).map(Number);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function nearestLabelBefore(lines, index) {
  for (let i = index; i >= 0; i--) {
    const match = lines[i].match(/^([A-Za-z_][A-Za-z0-9_]*):/);
    if (match) return match[1];
  }
  return '';
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

function accessPriority(access) {
  if (access === 'write') return 0;
  if (access === 'read_write') return 1;
  if (access === 'read') return 2;
  return 3;
}

function instructionSummary(text, fieldNumber) {
  const instruction = text.split(';')[0].trim().replace(/\s+/g, ' ');
  const token = `(ix+${fieldNumber})`;
  if (/^ld\s+\(ix\+\d+\)\s*,/i.test(instruction)) return `writes ${fieldDefs[fieldNumber].token}`;
  if (/^ld\s+[^,]+,\s*\(ix\+\d+\)/i.test(instruction)) return `reads ${fieldDefs[fieldNumber].token}`;
  if (/^inc\s+\(ix\+\d+\)/i.test(instruction)) return `increments ${fieldDefs[fieldNumber].token}`;
  if (/^dec\s+\(ix\+\d+\)/i.test(instruction)) return `decrements ${fieldDefs[fieldNumber].token}`;
  if (/^bit\s+/i.test(instruction)) return `tests ${fieldDefs[fieldNumber].token}`;
  if (/^set\s+/i.test(instruction)) return `sets bit in ${fieldDefs[fieldNumber].token}`;
  if (/^res\s+/i.test(instruction)) return `resets bit in ${fieldDefs[fieldNumber].token}`;
  if (instruction.toLowerCase().includes(token)) return `uses ${fieldDefs[fieldNumber].token}`;
  return 'uses indexed field';
}

function contextFor(label) {
  if (label === '_LABEL_65B9_') return 'confirmed_room_entity_slot_initializer';
  if (label === '_LABEL_760_') return 'confirmed_oam_position_base_producer';
  if (label === '_LABEL_792_') return 'confirmed_oam_frame_stream_consumer';
  if (label === '_LABEL_12D8_' || label === '_LABEL_12F8_' || label === '_LABEL_12D5_') return 'confirmed_actor_position_integrator';
  if (label === '_LABEL_181D_' || label === '_LABEL_186F_' || label === '_LABEL_1951_') return 'confirmed_actor_collision_position_helper';
  if (label === '_LABEL_1C98_' || label === '_LABEL_1D10_') return 'confirmed_actor_hitbox_overlap_helper';
  return 'candidate_ix_coordinate_context';
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
        label: currentLabel,
        line: i + 1,
        context: contextFor(currentLabel),
        instructionSummary: instructionSummary(lines[i], fieldNumber),
      });
    }
  }
  return references.sort((a, b) => a.line - b.line || accessPriority(a.access) - accessPriority(b.access));
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
    confirmedOamPathReferenceCount: fieldRefs.filter(ref =>
      ref.context === 'confirmed_room_entity_slot_initializer' ||
      ref.context === 'confirmed_oam_position_base_producer'
    ).length,
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
        accessCounts: { read: 0, write: 0, read_write: 0, unknown: 0 },
        lines: [],
      });
    }
    const item = grouped.get(ref.label);
    item.referenceCount++;
    item.fields.add(ref.field);
    item.accessCounts[ref.access] = (item.accessCounts[ref.access] || 0) + 1;
    item.lines.push(ref.line);
  }
  return [...grouped.values()]
    .map(item => ({
      label: item.label,
      context: item.context,
      referenceCount: item.referenceCount,
      fields: [...item.fields].sort(),
      accessCounts: item.accessCounts,
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
  const contextCounts = countsBy(references, 'context');
  const confirmedReferences = references.filter(ref =>
    ref.context === 'confirmed_room_entity_slot_initializer' ||
    ref.context === 'confirmed_oam_position_base_producer' ||
    ref.context === 'confirmed_actor_position_integrator' ||
    ref.context === 'confirmed_actor_collision_position_helper' ||
    ref.context === 'confirmed_actor_hitbox_overlap_helper'
  );

  const evidence = [
    asmEvidence(lines, 14834, 'ld (ix+3), e', '_LABEL_65B9_ writes room entity X low byte from IY+1 into IX+3.'),
    asmEvidence(lines, 14835, 'ld (ix+4), d', '_LABEL_65B9_ writes room entity X high byte from IY+2 into IX+4.'),
    asmEvidence(lines, 14838, 'ld a, (iy+3)', '_LABEL_65B9_ reads room entity Y byte from IY+3 before storing IX+6.'),
    asmEvidence(lines, 14839, 'ld (ix+6), a', '_LABEL_65B9_ writes room entity Y low byte into IX+6.'),
    asmEvidence(lines, 14853, 'ld (ix+7), a', '_LABEL_65B9_ zeroes room entity Y high byte in IX+7.'),
    asmEvidence(lines, 1958, '_LABEL_760_:', '_LABEL_760_ is the confirmed OAM position-base producer.'),
    asmEvidence(lines, 1959, 'ld l, (ix+3)', '_LABEL_760_ reads IX+3 as X low byte.'),
    asmEvidence(lines, 1960, 'ld h, (ix+4)', '_LABEL_760_ reads IX+4 as X high byte.'),
    asmEvidence(lines, 1967, 'ld (_RAM_D00B_), hl', '_LABEL_760_ writes the computed X base to _RAM_D00B_/_RAM_D00C_.'),
    asmEvidence(lines, 1968, 'ld l, (ix+6)', '_LABEL_760_ reads IX+6 as Y low byte.'),
    asmEvidence(lines, 1969, 'ld h, (ix+7)', '_LABEL_760_ reads IX+7 as Y high byte.'),
    asmEvidence(lines, 1976, 'ld (_RAM_D00D_), hl', '_LABEL_760_ writes the computed Y base to _RAM_D00D_/_RAM_D00E_.'),
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      'world-entity-runtime-struct-field-catalog-2026-06-25',
      'world-metasprite-oam-writer-semantics-catalog-2026-06-25',
    ],
    sourceRoutines: ['_LABEL_65B9_', '_LABEL_760_', '_LABEL_792_', '_LABEL_12D8_', '_LABEL_12F8_', '_LABEL_181D_', '_LABEL_186F_', '_LABEL_1951_', '_LABEL_1C98_', '_LABEL_1D10_'],
    summary: {
      fieldCount: fields.length,
      referenceCount: references.length,
      readReferenceCount: accessCounts.read || 0,
      writeReferenceCount: accessCounts.write || 0,
      readWriteReferenceCount: accessCounts.read_write || 0,
      unknownReferenceCount: accessCounts.unknown || 0,
      routineReferenceCount: routines.length,
      confirmedContextReferenceCount: confirmedReferences.length,
      candidateContextReferenceCount: contextCounts.candidate_ix_coordinate_context || 0,
      roomEntityInitializerLabel: '_LABEL_65B9_',
      oamPositionProducerLabel: '_LABEL_760_',
      oamFrameStreamConsumerLabel: '_LABEL_792_',
      xSlotFields: 'IX+3/IX+4',
      ySlotFields: 'IX+6/IX+7',
      xRoomRecordSourceFields: 'IY+1/IY+2',
      yRoomRecordSourceFields: 'IY+3 plus zero high byte',
      xBaseOutputRam: '_RAM_D00B_/_RAM_D00C_',
      yBaseOutputRam: '_RAM_D00D_/_RAM_D00E_',
      runtimePositionCoordinateModelStatus: 'metadata_provenance_only',
      persistedRomByteCount: 0,
      persistedCoordinateCount: 0,
      persistedPixelCount: 0,
      confidence: 'high_for_confirmed_room_entity_to_oam_path_medium_for_all_candidate_ix_references',
      assetPolicy: 'Metadata only: field names, access categories, labels, line numbers, counts, and evidence. No ROM bytes, decoded coordinates, graphics, screenshots, or rendered assets are embedded.',
    },
    confirmedPath: {
      roomEntityInitializer: {
        label: '_LABEL_65B9_',
        xSourceFields: ['IY+1', 'IY+2'],
        xSlotFields: ['IX+3', 'IX+4'],
        ySourceFields: ['IY+3'],
        ySlotFields: ['IX+6', 'IX+7'],
        yHighByteSource: 'zeroed after xor a',
        evidenceLines: [14834, 14835, 14838, 14839, 14853],
      },
      oamPositionProducer: {
        label: '_LABEL_760_',
        xSlotFields: ['IX+3', 'IX+4'],
        ySlotFields: ['IX+6', 'IX+7'],
        xOutputRam: ['_RAM_D00B_', '_RAM_D00C_'],
        yOutputRam: ['_RAM_D00D_', '_RAM_D00E_'],
        evidenceLines: [1958, 1959, 1960, 1967, 1968, 1969, 1976],
      },
    },
    fields,
    routineSummaries: routines,
    references,
    evidence,
    nextLeads: [
      'Trace candidate IX coordinate contexts to separate player, room entity, projectile, and temporary menu/loader slot families.',
      'Use confirmed IX+3/IX+4 and IX+6/IX+7 provenance to model live actor positions in the browser-local OAM fixture renderer.',
      'Follow writers in high-count routines to map physics, collision response, and enemy spawn coordinate semantics by actor family.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityRuntimeStructCatalogs = (mapData.entityRuntimeStructCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityRuntimeStructCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_slot_coordinate_field_provenance_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceRoutines: catalog.sourceRoutines,
    summary: catalog.summary,
    confirmedPath: catalog.confirmedPath,
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
