#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-runtime-effect-index-audit.mjs';
const catalogId = 'world-runtime-effect-index-catalog-2026-06-26';
const reportId = 'runtime-effect-index-audit-2026-06-26';
const schemaVersion = 1;

const familyRules = [
  ['audio_runtime', /audio|psg|fm|sound|music/i],
  ['player_runtime', /player|physics|collision|damage|password|form|d16e/i],
  ['entity_runtime', /entity|c3c0|motion|animation|item|metasprite|object|reward/i],
  ['rendering_vdp_runtime', /vdp|screen|tile|palette|graphics|sprite|cram|vram/i],
  ['room_zone_runtime', /room|zone|loader|trigger|transition|scene|camera|scroll/i],
  ['menu_status_runtime', /menu|status|ui|continue|shop|inventory|cf52|cf54|cf5b|cf6a|cf6b/i],
  ['core_runtime', /bank0core|corehelper|lowcore|rst|reset|interrupt|mapper|bankswitch|lookup/i],
];

const genericFamilyEvidenceKeys = new Set([
  'asmDataLabelCensusAudit',
  'asmDataLabelCodeRegionResolutionAudit',
  'asmLabelRegionAudit',
  'entityItemAssetConfidenceBackfillAudit',
  'inferred',
  'largeAssetConfidenceBackfillAudit',
  'manual',
  'manualRoutineConfidenceBackfillAudit',
  'playerAudioRoutineConfidenceBackfillAudit',
  'remainingStructuredConfidenceBackfillAudit',
  'renderAssetConfidenceBackfillAudit',
  'residualFragmentConfidenceBackfillAudit',
  'sceneMenuEntityRoutineConfidenceBackfillAudit',
  'staleScreenProgMetadataAudit',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function numberFromValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const text = value.trim();
  if (!text) return 0;
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text, 16);
  if (/^\$[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(1), 16);
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  return 0;
}

function regionStart(region) {
  return numberFromValue(region.start ?? region.offset ?? region.address);
}

function regionSize(region) {
  return numberFromValue(region.size ?? region.length);
}

function regionOffset(region) {
  if (typeof region.offset === 'string' && region.offset) return region.offset;
  return hex(regionStart(region), 5);
}

function hex(value, width = 5) {
  return `0x${Math.max(0, value).toString(16).toUpperCase().padStart(width, '0')}`;
}

function bankFromRegion(region) {
  if (region.bank !== undefined && region.bank !== null && region.bank !== '') return region.bank;
  return Math.floor(regionStart(region) / 0x4000);
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value !== undefined && value !== null && value !== ''))]
    .map(String)
    .sort((a, b) => a.localeCompare(b));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (key === undefined || key === null || key === '') continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function topCounts(counts, limit = 40) {
  return Object.fromEntries(Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit));
}

function confidenceRank(confidence) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium_high') return 2;
  if (confidence === 'medium') return 1;
  return 0;
}

function confidenceBackedCodeRegion(region) {
  return region.type === 'code' && confidenceRank(region.confidence) > 0;
}

function compactRegion(region) {
  return {
    id: region.id || '',
    offset: regionOffset(region),
    endExclusive: hex(regionStart(region) + regionSize(region), 5),
    size: regionSize(region),
    bank: bankFromRegion(region),
    type: region.type || 'unknown',
    name: region.name || '',
    confidence: region.confidence || '',
  };
}

function evidenceEntries(region) {
  return Object.entries(region.analysis || {})
    .filter(([key, value]) => {
      if (key === 'inferred') return false;
      return value && typeof value === 'object' && value.confidence;
    })
    .map(([key, value]) => ({
      key,
      kind: value.kind || '',
      confidence: value.confidence || '',
      catalogId: value.catalogId || '',
      tool: value.tool || '',
      summary: value.summary || '',
    }))
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence)
      || a.key.localeCompare(b.key));
}

function familiesForEvidence(evidence) {
  const families = new Set();
  const sourceEvidence = evidence.filter(item => !genericFamilyEvidenceKeys.has(item.key));
  const familyEvidence = sourceEvidence.length ? sourceEvidence : evidence;
  for (const item of familyEvidence) {
    const text = `${item.key} ${item.kind} ${item.catalogId} ${item.summary}`;
    for (const [family, pattern] of familyRules) {
      if (pattern.test(text)) families.add(family);
    }
  }
  if (!families.size) families.add('unclassified_runtime');
  return [...families].sort();
}

function effectsFromRegion(region) {
  const inferred = region.analysis?.inferred || {};
  const effects = inferred.effects || {};
  const relations = inferred.relations || {};
  return {
    effects: {
      readsRAM: uniqueSorted(effects.readsRAM),
      writesRAM: uniqueSorted(effects.writesRAM),
      writesVRAM: uniqueSorted(effects.writesVRAM),
      writesCRAM: uniqueSorted(effects.writesCRAM),
      bankSwitches: uniqueSorted(effects.bankSwitches),
    },
    relations: {
      calls: uniqueSorted(relations.calls),
      calledBy: uniqueSorted(relations.calledBy),
      relatedRegions: uniqueSorted(relations.relatedRegions),
    },
    inferredSummary: inferred.summary || '',
    hasInferredEffects: Boolean(inferred.effects),
    hasInferredRelations: Boolean(inferred.relations),
  };
}

function entryForRegion(region) {
  const evidence = evidenceEntries(region);
  const families = familiesForEvidence(evidence);
  const effectModel = effectsFromRegion(region);
  const effectCounts = {
    readsRAM: effectModel.effects.readsRAM.length,
    writesRAM: effectModel.effects.writesRAM.length,
    writesVRAM: effectModel.effects.writesVRAM.length,
    writesCRAM: effectModel.effects.writesCRAM.length,
    bankSwitches: effectModel.effects.bankSwitches.length,
    calls: effectModel.relations.calls.length,
    calledBy: effectModel.relations.calledBy.length,
    relatedRegions: effectModel.relations.relatedRegions.length,
  };

  return {
    ...compactRegion(region),
    subsystemFamilies: families,
    evidenceKeyCount: evidence.length,
    evidenceKeys: evidence.map(item => item.key),
    evidenceCatalogIds: [...new Set(evidence.map(item => item.catalogId).filter(Boolean))].sort(),
    effectCounts,
    effects: effectModel.effects,
    relations: effectModel.relations,
    inferredSummary: effectModel.inferredSummary,
    hasInferredEffects: effectModel.hasInferredEffects,
    hasInferredRelations: effectModel.hasInferredRelations,
  };
}

function addCounts(counts, values) {
  for (const value of values || []) counts[value] = (counts[value] || 0) + 1;
}

function buildCatalog(mapData) {
  const entries = (mapData.regions || [])
    .filter(confidenceBackedCodeRegion)
    .map(entryForRegion)
    .sort((a, b) => Number(a.bank) - Number(b.bank)
      || Number.parseInt(a.offset, 16) - Number.parseInt(b.offset, 16)
      || a.id.localeCompare(b.id));

  const ramReads = {};
  const ramWrites = {};
  const vramWrites = {};
  const cramWrites = {};
  const bankSwitches = {};
  const calls = {};
  const calledBy = {};
  const relatedRegions = {};
  for (const entry of entries) {
    addCounts(ramReads, entry.effects.readsRAM);
    addCounts(ramWrites, entry.effects.writesRAM);
    addCounts(vramWrites, entry.effects.writesVRAM);
    addCounts(cramWrites, entry.effects.writesCRAM);
    addCounts(bankSwitches, entry.effects.bankSwitches);
    addCounts(calls, entry.relations.calls);
    addCounts(calledBy, entry.relations.calledBy);
    addCounts(relatedRegions, entry.relations.relatedRegions);
  }

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    source: 'projects/WORLD/map.json region analysis metadata',
    assetPolicy: 'Metadata only: code region ids, offsets, sizes, labels, confidence values, RAM variable names, call labels, relation labels, evidence audit keys, catalog ids, and aggregate counts. No ROM bytes, instruction bytes, decoded assets, screenshots, pixels, text payloads, audio payloads, or hashes are embedded.',
    selectionRule: {
      includedType: 'code',
      confidenceRule: 'Region must have top-level confidence high, medium_high, or medium.',
      effectSource: 'Effects and call relations are copied from existing analysis.inferred metadata and cross-indexed with focused evidence audit keys.',
      limitation: 'This is a static index of known metadata, not a cycle-accurate behavioral trace. Empty effect arrays mean no current static effect metadata, not proof of no runtime side effects.',
    },
    summary: {
      codeRegionCount: entries.length,
      totalCodeBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
      confidenceCounts: countBy(entries, entry => entry.confidence),
      byBank: countBy(entries, entry => String(entry.bank).padStart(2, '0')),
      subsystemFamilyCounts: countBy(entries.flatMap(entry => entry.subsystemFamilies), family => family),
      hasInferredEffectsCount: entries.filter(entry => entry.hasInferredEffects).length,
      hasInferredRelationsCount: entries.filter(entry => entry.hasInferredRelations).length,
      aggregateEffectCounts: {
        readsRAM: entries.reduce((sum, entry) => sum + entry.effectCounts.readsRAM, 0),
        writesRAM: entries.reduce((sum, entry) => sum + entry.effectCounts.writesRAM, 0),
        writesVRAM: entries.reduce((sum, entry) => sum + entry.effectCounts.writesVRAM, 0),
        writesCRAM: entries.reduce((sum, entry) => sum + entry.effectCounts.writesCRAM, 0),
        bankSwitches: entries.reduce((sum, entry) => sum + entry.effectCounts.bankSwitches, 0),
        calls: entries.reduce((sum, entry) => sum + entry.effectCounts.calls, 0),
        calledBy: entries.reduce((sum, entry) => sum + entry.effectCounts.calledBy, 0),
        relatedRegions: entries.reduce((sum, entry) => sum + entry.effectCounts.relatedRegions, 0),
      },
      uniqueReferenceCounts: {
        readsRAM: Object.keys(ramReads).length,
        writesRAM: Object.keys(ramWrites).length,
        writesVRAM: Object.keys(vramWrites).length,
        writesCRAM: Object.keys(cramWrites).length,
        bankSwitches: Object.keys(bankSwitches).length,
        calls: Object.keys(calls).length,
        calledBy: Object.keys(calledBy).length,
        relatedRegions: Object.keys(relatedRegions).length,
      },
      topReferences: {
        readsRAM: topCounts(ramReads),
        writesRAM: topCounts(ramWrites),
        bankSwitches: topCounts(bankSwitches),
        calls: topCounts(calls),
        calledBy: topCounts(calledBy),
      },
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    entries,
  };
}

function sampleEntries(entries) {
  return entries
    .filter(entry => entry.effectCounts.readsRAM || entry.effectCounts.writesRAM || entry.effectCounts.bankSwitches)
    .slice(0, 20)
    .map(entry => ({
      id: entry.id,
      offset: entry.offset,
      name: entry.name,
      confidence: entry.confidence,
      subsystemFamilies: entry.subsystemFamilies,
      effectCounts: entry.effectCounts,
      effects: entry.effects,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);

  if (apply) {
    mapData.runtimeEffectCatalogs = (mapData.runtimeEffectCatalogs || []).filter(item => item.id !== catalogId);
    mapData.runtimeEffectCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'runtime_effect_index_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      catalogId,
      summary: catalog.summary,
      sampleEntries: sampleEntries(catalog.entries),
      assetPolicy: catalog.assetPolicy,
      nextLeads: [
        'Use this index to choose the next RAM variables for frame-by-frame behavioral tracing.',
        'Split high-traffic RAM variables into mechanic-specific catalogs for player movement, collision, damage, room transitions, and audio.',
        'Verify empty static effect arrays against ASM before treating a routine as side-effect-free.',
      ],
    });
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    sampleEntries: sampleEntries(catalog.entries).slice(0, 5),
  }, null, 2));
}

main();
