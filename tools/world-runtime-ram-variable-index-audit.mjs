#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-runtime-ram-variable-index-audit.mjs';
const catalogId = 'world-runtime-ram-variable-index-catalog-2026-06-26';
const reportId = 'runtime-ram-variable-index-audit-2026-06-26';
const schemaVersion = 1;
const runtimeEffectCatalogId = 'world-runtime-effect-index-catalog-2026-06-26';
const runtimeMechanicCatalogId = 'world-runtime-mechanic-index-catalog-2026-06-26';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
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

function topCounts(counts, limit = 30) {
  return Object.fromEntries(Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit));
}

function addUnique(set, values) {
  for (const value of values || []) set.add(value);
}

function ramAddress(label) {
  const match = /^_RAM_([0-9A-F]{4})_$/.exec(label || '');
  return match ? `0x${match[1]}` : null;
}

function isRamLabel(label) {
  return /^_RAM_[0-9A-F]{4}_$/.test(label || '');
}

function addressNumber(label) {
  const address = ramAddress(label);
  return address ? Number.parseInt(address.slice(2), 16) : Number.POSITIVE_INFINITY;
}

function addressClass(label) {
  const value = addressNumber(label);
  if (!Number.isFinite(value)) return 'unknown_label';
  if (value >= 0xFFFC && value <= 0xFFFF) return 'mapper_register_or_system_port_mirror';
  if (value >= 0xC000 && value <= 0xDFFF) return 'sms_work_ram';
  if (value >= 0xE000 && value <= 0xFFFF) return 'sms_work_ram_mirror_or_io_window';
  return 'non_work_ram_reference';
}

function compactRoutine(entry) {
  return {
    id: entry.id,
    offset: entry.offset,
    bank: entry.bank,
    name: entry.name || '',
    confidence: entry.confidence,
  };
}

function buildMechanicMembership(mechanicCatalog) {
  const membership = new Map();
  for (const mechanic of mechanicCatalog.mechanics || []) {
    for (const routine of mechanic.routines || []) {
      if (!membership.has(routine.id)) membership.set(routine.id, new Set());
      membership.get(routine.id).add(mechanic.id);
    }
  }
  return membership;
}

function ensureVar(vars, label) {
  if (!vars.has(label)) {
    vars.set(label, {
      label,
      address: ramAddress(label),
      addressClass: addressClass(label),
      readBy: [],
      writtenBy: [],
      bankSwitchWrittenBy: [],
      mechanicIds: new Set(),
      evidenceCatalogIds: new Set(),
      evidenceKeys: new Set(),
    });
  }
  return vars.get(label);
}

function addRoutineUse(variable, listName, routine, mechanicIds) {
  variable[listName].push(compactRoutine(routine));
  addUnique(variable.mechanicIds, mechanicIds);
  addUnique(variable.evidenceCatalogIds, routine.evidenceCatalogIds || []);
  addUnique(variable.evidenceKeys, routine.evidenceKeys || []);
}

function routineMechanics(routine, membership) {
  return Array.from(membership.get(routine.id) || []).sort();
}

function buildEntry(variable) {
  const readCount = variable.readBy.length;
  const writeCount = variable.writtenBy.length;
  const bankSwitchWriteCount = variable.bankSwitchWrittenBy.length;
  const accessKind = readCount && writeCount ? 'read_write'
    : readCount ? 'read_only'
      : writeCount ? 'write_only'
        : 'bank_switch_only';
  return {
    label: variable.label,
    address: variable.address,
    addressClass: variable.addressClass,
    accessKind,
    readCount,
    writeCount,
    bankSwitchWriteCount,
    mechanicIds: Array.from(variable.mechanicIds).sort(),
    evidenceCatalogIds: Array.from(variable.evidenceCatalogIds).sort(),
    evidenceKeys: Array.from(variable.evidenceKeys).sort(),
    readBy: variable.readBy.sort((a, b) => a.offset.localeCompare(b.offset) || a.id.localeCompare(b.id)),
    writtenBy: variable.writtenBy.sort((a, b) => a.offset.localeCompare(b.offset) || a.id.localeCompare(b.id)),
    bankSwitchWrittenBy: variable.bankSwitchWrittenBy.sort((a, b) => a.offset.localeCompare(b.offset) || a.id.localeCompare(b.id)),
    nextTrace: bankSwitchWriteCount
      ? 'Trace mapper/bank-write timing before translating this variable into engine state.'
      : 'Trace frame-by-frame reads and writes before assigning a stable engine-state name.',
  };
}

function buildCatalog(mapData) {
  const runtimeCatalog = (mapData.runtimeEffectCatalogs || []).find(item => item.id === runtimeEffectCatalogId);
  if (!runtimeCatalog) throw new Error(`Missing required runtime effect catalog: ${runtimeEffectCatalogId}`);
  const mechanicCatalog = (mapData.runtimeMechanicCatalogs || []).find(item => item.id === runtimeMechanicCatalogId);
  if (!mechanicCatalog) throw new Error(`Missing required runtime mechanic catalog: ${runtimeMechanicCatalogId}`);

  const membership = buildMechanicMembership(mechanicCatalog);
  const vars = new Map();
  const bankSwitchMarkerCounts = {};

  for (const routine of runtimeCatalog.entries || []) {
    const mechanics = routineMechanics(routine, membership);
    for (const label of routine.effects?.readsRAM || []) {
      if (!isRamLabel(label)) continue;
      addRoutineUse(ensureVar(vars, label), 'readBy', routine, mechanics);
    }
    for (const label of routine.effects?.writesRAM || []) {
      if (!isRamLabel(label)) continue;
      addRoutineUse(ensureVar(vars, label), 'writtenBy', routine, mechanics);
    }
    for (const label of routine.effects?.bankSwitches || []) {
      if (!isRamLabel(label)) {
        bankSwitchMarkerCounts[label] = (bankSwitchMarkerCounts[label] || 0) + 1;
        continue;
      }
      addRoutineUse(ensureVar(vars, label), 'bankSwitchWrittenBy', routine, mechanics);
    }
  }

  const entries = Array.from(vars.values())
    .map(buildEntry)
    .sort((a, b) => addressNumber(a.label) - addressNumber(b.label) || a.label.localeCompare(b.label));
  const readCounts = Object.fromEntries(entries.map(entry => [entry.label, entry.readCount]).filter(([, count]) => count));
  const writeCounts = Object.fromEntries(entries.map(entry => [entry.label, entry.writeCount]).filter(([, count]) => count));
  const mechanicVariableCounts = {};
  for (const entry of entries) {
    for (const mechanicId of entry.mechanicIds) mechanicVariableCounts[mechanicId] = (mechanicVariableCounts[mechanicId] || 0) + 1;
  }

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogIds: [
      runtimeEffectCatalogId,
      runtimeMechanicCatalogId,
    ],
    assetPolicy: 'Metadata only: RAM labels, addresses, routine ids, offsets, names, mechanic ids, evidence ids, and aggregate counts. No ROM bytes, instruction bytes, decoded graphics, pixels, screenshots, text payloads, audio payloads, or hashes are embedded.',
    selectionRule: {
      source: 'RAM read/write/bank-switch effects from the runtime effect catalog, linked to static mechanic memberships.',
      limitation: 'This is a static ASM-derived access index, not a frame-accurate lifetime model. Variable names remain label-based until runtime traces assign semantics.',
    },
    summary: {
      variableCount: entries.length,
      readVariableCount: entries.filter(entry => entry.readCount > 0).length,
      writeVariableCount: entries.filter(entry => entry.writeCount > 0).length,
      readWriteVariableCount: entries.filter(entry => entry.accessKind === 'read_write').length,
      readOnlyVariableCount: entries.filter(entry => entry.accessKind === 'read_only').length,
      writeOnlyVariableCount: entries.filter(entry => entry.accessKind === 'write_only').length,
      bankSwitchVariableCount: entries.filter(entry => entry.bankSwitchWriteCount > 0).length,
      addressClassCounts: countBy(entries, entry => entry.addressClass),
      mechanicVariableCounts: Object.fromEntries(Object.entries(mechanicVariableCounts).sort((a, b) => a[0].localeCompare(b[0]))),
      topReadVariables: topCounts(readCounts),
      topWriteVariables: topCounts(writeCounts),
      bankSwitchMarkerCounts: topCounts(bankSwitchMarkerCounts),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    entries,
    nextLeads: [
      'Use top read/write variables to pick frame traces for player_movement_physics, collision_damage, room_transition_state, rendering_vdp_pipeline, and audio_driver.',
      'Rename RAM labels only after a trace proves lifetime, units, and writer ownership.',
      'Treat _RAM_FFFF_ and related high-address writes as mapper/register behavior, not gameplay state.',
    ],
  };
}

function reportSample(catalog) {
  return catalog.entries
    .slice()
    .sort((a, b) => (b.readCount + b.writeCount + b.bankSwitchWriteCount) - (a.readCount + a.writeCount + a.bankSwitchWriteCount)
      || a.label.localeCompare(b.label))
    .slice(0, 20)
    .map(entry => ({
      label: entry.label,
      address: entry.address,
      addressClass: entry.addressClass,
      accessKind: entry.accessKind,
      readCount: entry.readCount,
      writeCount: entry.writeCount,
      bankSwitchWriteCount: entry.bankSwitchWriteCount,
      mechanicIds: entry.mechanicIds,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);

  if (apply) {
    mapData.ramVariableCatalogs = (mapData.ramVariableCatalogs || []).filter(item => item.id !== catalogId);
    mapData.ramVariableCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'runtime_ram_variable_index_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      catalogId,
      sourceCatalogIds: catalog.sourceCatalogIds,
      summary: catalog.summary,
      topVariables: reportSample(catalog),
      assetPolicy: catalog.assetPolicy,
      nextLeads: catalog.nextLeads,
    });
    writeJson(mapPath, mapData);

    if (fs.existsSync(staticMapPath)) {
      const staticMap = readJson(staticMapPath);
      staticMap.analyzedAt = now;
      staticMap.summary = staticMap.summary || {};
      staticMap.summary.runtimeRamVariableIndexCatalog = catalogId;
      staticMap.summary.runtimeRamVariableIndexVariables = catalog.summary.variableCount;
      staticMap.summary.runtimeRamVariableIndexReadVariables = catalog.summary.readVariableCount;
      staticMap.summary.runtimeRamVariableIndexWriteVariables = catalog.summary.writeVariableCount;
      staticMap.summary.runtimeRamVariableIndexReadWriteVariables = catalog.summary.readWriteVariableCount;
      staticMap.summary.runtimeRamVariableIndexBankSwitchVariables = catalog.summary.bankSwitchVariableCount;
      staticMap.summary.runtimeRamVariableIndexCoreSupportVariables = catalog.summary.mechanicVariableCounts.core_support_runtime || 0;
      staticMap.summary.runtimeRamVariableIndexPlayerMovementVariables = catalog.summary.mechanicVariableCounts.player_movement_physics || 0;
      staticMap.summary.runtimeRamVariableIndexCollisionDamageVariables = catalog.summary.mechanicVariableCounts.collision_damage || 0;
      staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
      staticMap.primaryCatalogs.gameplay = insertAfter(
        staticMap.primaryCatalogs.gameplay,
        runtimeMechanicCatalogId,
        catalogId
      );
      staticMap.primaryCatalogs.coverage = insertAfter(
        staticMap.primaryCatalogs.coverage,
        runtimeMechanicCatalogId,
        catalogId
      );
      staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
      staticMap.nextLeads.push('Use world-runtime-ram-variable-index-catalog-2026-06-26 to name RAM variables only after frame traces prove lifetime, units, and writer ownership; core_support_runtime now includes shared helper variable accesses.');
      writeJson(staticMapPath, staticMap);
    }
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    topVariables: reportSample(catalog),
  }, null, 2));
}

main();
