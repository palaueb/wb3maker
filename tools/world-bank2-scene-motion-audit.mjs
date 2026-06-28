#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-bank2-scene-motion-catalog-2026-06-25';
const reportId = 'bank2-scene-motion-audit-2026-06-25';
const toolName = 'tools/world-bank2-scene-motion-audit.mjs';

function routine(offset, label, role, name, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name,
    type: 'code',
    family: 'bank2_scene_motion',
    confidence: options.confidence || 'high',
    calls: options.calls || [],
    ramRefs: options.ramRefs || [],
    evidence: [
      `${label} is an ASM code label at ROM offset ${hex(offset)}.`,
      ...(options.evidence || []),
    ],
  };
}

const ENTRIES = [
  routine(0x085AD, '_LABEL_85AD_', 'scene_vertical_bound_oscillator', '_LABEL_85AD_ scene vertical bound oscillator', 'Moves _RAM_D154_ by +/-8 between lower and upper bounds and flips _RAM_D196_ when a bound is reached.', {
    ramRefs: ['_RAM_D154_', '_RAM_D196_', '_RAM_D198_', '_RAM_D19A_'],
    evidence: ['ASM lines 17096-17131 move _RAM_D154_ toward _RAM_D19A_ while _RAM_D196_ is zero, then toward _RAM_D198_ while nonzero, flipping _RAM_D196_ at each bound.'],
  }),
  routine(0x085E9, '_LABEL_85E9_', 'scene_motion_phase_dispatcher', '_LABEL_85E9_ scene motion phase dispatcher', 'Dispatches a multi-phase scene motion state from _RAM_D18E_, initializing signed velocities and direction flags for the active phase.', {
    calls: ['_LABEL_8633_', '_LABEL_8657_', '_LABEL_8664_'],
    ramRefs: ['_RAM_D18E_', '_RAM_D156_', '_RAM_D18F_', '_RAM_D190_', '_RAM_D191_', '_RAM_D192_', '_RAM_D193_', '_RAM_D16C_'],
    evidence: ['ASM lines 17133-17176 branch by _RAM_D18E_ low bits; phase 0 zeros _RAM_D156_, copies _RAM_D18F_ to _RAM_D192_, possibly negates _RAM_D16C_ and _RAM_D190_, increments _RAM_D18E_, and clears _RAM_D193_.'],
  }),
  routine(0x08633, '_LABEL_8633_', 'scene_motion_threshold_turnaround', '_LABEL_8633_ scene motion threshold turnaround', 'Advances scene motion until the signed threshold in _RAM_D190_ is reached, then stores it as _RAM_D156_, negates _RAM_D16C_, and advances the phase.', {
    calls: ['_LABEL_98A9_', '_LABEL_98BD_'],
    ramRefs: ['_RAM_D190_', '_RAM_D156_', '_RAM_D16C_', '_RAM_D18E_'],
    evidence: ['ASM lines 17178-17195 compare the current motion value from _LABEL_98A9_/_LABEL_98BD_ against _RAM_D190_, account for sign, then update _RAM_D156_, negate _RAM_D16C_, and increment _RAM_D18E_.'],
  }),
  routine(0x08664, '_LABEL_8664_', 'scene_motion_phase_complete_toggle', '_LABEL_8664_ scene motion phase complete toggle', 'Tests whether the current signed scene motion has crossed its target, toggles the high bit of _RAM_D18E_, and sets _RAM_D193_ when complete.', {
    calls: ['_LABEL_98A9_', '_LABEL_98BD_'],
    ramRefs: ['_RAM_D16C_', '_RAM_D18E_', '_RAM_D193_'],
    evidence: ['ASM lines 17206-17221 call the motion helpers, compare sign against _RAM_D16C_, then toggle _RAM_D18E_ bit 7 and set _RAM_D193_ to 1 on completion.'],
  }),
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
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

function wasInferredOnlyBeforeThisAudit(region) {
  if (!region) return false;
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank2SceneMotionAudit');
  return keys.length === 1 && keys[0] === 'inferred';
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      entryCount: ENTRIES.length,
      routineCount: ENTRIES.length,
      assetPolicy: 'Metadata only: ASM labels, offsets, routine roles, calls, RAM references, and evidence. No ROM bytes or decoded scene graphics are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    evidence: [
      'ASM lines 17096-17221 show the complete D154/D18E scene motion cluster and its phase transitions.',
      'The routines are referenced from bank-2 scene state handlers around _LABEL_8026_/_LABEL_8682_; this catalog only records control-flow metadata.',
    ],
  };
}

function annotateRegion(region, item) {
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  if (item.name && !region.name) region.name = item.name;
  if (item.summary && !region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank2SceneMotionAudit = {
    catalogId,
    kind: item.role,
    family: item.family,
    label: item.label,
    confidence: item.confidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    calls: item.calls,
    ramRefs: item.ramRefs,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    label: item.label,
    role: item.role,
    confidence: item.confidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
  };
}

function applyAnnotations(mapData) {
  const annotated = [];
  const missing = [];
  for (const item of ENTRIES) {
    const region = findExactRegion(mapData, item.offset);
    if (!region) {
      missing.push({ offset: hex(item.offset), label: item.label, role: item.role });
      continue;
    }
    annotated.push(annotateRegion(region, item));
  }
  return { annotated, missing };
}

function main() {
  const mapData = readJson(mapPath);
  let changes = { annotated: [], missing: [] };

  if (apply) {
    changes = applyAnnotations(mapData);
    const finalCatalog = buildCatalog(mapData);
    mapData.bank2SceneMotionCatalogs = (mapData.bank2SceneMotionCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.bank2SceneMotionCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_scene_motion_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: changes.annotated.length,
        missingRegions: changes.missing.length,
        inferredOnlyRegionsCovered: changes.annotated.filter(change => change.wasInferredOnlyBeforeAudit).length,
      },
      annotatedRegions: changes.annotated,
      missingRegions: changes.missing,
      nextLeads: [
        'Trace _LABEL_98A9_/_LABEL_98BD_ to name the exact fixed-point coordinate returned to the phase controller.',
        'Link _RAM_D154_, _RAM_D198_, and _RAM_D19A_ to scene camera/object coordinate semantics in the bank-2 state handlers.',
        'Record which _RAM_D1AE_ scene states use this motion cluster and whether it affects camera, boss object, or scripted platform motion.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  const catalog = buildCatalog(apply ? readJson(mapPath) : mapData);
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: changes.annotated.length,
      missingRegions: changes.missing.length,
      inferredOnlyRegionsCovered: changes.annotated.filter(change => change.wasInferredOnlyBeforeAudit).length,
    },
    missingRegions: changes.missing,
  }, null, 2));
}

main();
