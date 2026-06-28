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
const catalogId = 'world-bank3-audio-fragment-catalog-2026-06-25';
const reportId = 'bank3-audio-fragment-audit-2026-06-25';
const toolName = 'tools/world-bank3-audio-fragment-audit.mjs';

function fragment(offset, label, role, name, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name,
    type: 'code',
    family: options.family || 'bank3_audio_driver',
    confidence: options.confidence || 'high',
    calls: options.calls || [],
    ramRefs: options.ramRefs || [],
    ports: options.ports || [],
    evidence: [
      `${label} is an ASM code ${options.isBranchTarget ? 'branch target' : 'label'} at ROM offset ${hex(offset)}.`,
      ...(options.evidence || []),
    ],
  };
}

const ENTRIES = [
  fragment(0x0C026, 'audio_init_psg_mute_tail_0xC026', 'audio_init_psg_mute_tail', '_LABEL_C000_ PSG mute tail', 'Final tail of the bank-3 audio initialization routine that mutes the remaining PSG channels and returns.', {
    isBranchTarget: true,
    ports: ['Port_PSG'],
    evidence: ['ASM lines 21574-21582 write PSG latch bytes 0x9F, 0xBF, 0xDF, and 0xFF before returning; the map fragment at 0x0C026 is the last write/return tail.'],
  }),
  fragment(0x0C0A5, '_LABEL_C09F_+0x06', 'audio_pending_request_queue_dispatch', '_LABEL_C09F_ pending audio request queue dispatcher', 'Continuation of the audio update entry that consumes queued sound/music request ids from _RAM_C222_, copies their startup words from _DATA_D139_ entries into C1xx channel records, then falls into the eight-channel scheduler.', {
    isBranchTarget: true,
    calls: ['_LABEL_C0F3_'],
    ramRefs: ['_RAM_C221_', '_RAM_C222_'],
    evidence: ['ASM lines 21657-21720 guard on _RAM_C23B_, test _RAM_C221_, iterate _RAM_C222_ request ids, look up stream pointers through _DATA_D139_, initialize C1xx channel slots, clear _RAM_C221_, then continue at _LABEL_C0F3_.'],
  }),
  fragment(0x0C73A, '_LABEL_C73A_', 'psg_volume_release_entry', '_LABEL_C73A_ PSG volume release entry', 'PSG channel envelope/release entry that marks a channel in release mode and redirects HL to the release volume state before the shared volume update at _LABEL_C748_.', {
    calls: ['_LABEL_C748_'],
    ramRefs: ['_RAM_C220_', 'IY+0'],
    ports: ['Port_PSG'],
    evidence: ['ASM lines 22536-22542 set IY+0 bit 4, clear bit 1, adjust L by 0xFA, and fall into the shared volume decay path.'],
  }),
  fragment(0x0C916, '_LABEL_C916_', 'fm_instrument_volume_state_rejoin', '_LABEL_C916_ FM instrument/volume state rejoin', 'FM channel update rejoin point used when instrument selection is unchanged; adjusts HL to the FM channel volume/envelope state before entering _LABEL_C91A_.', {
    calls: ['_LABEL_C91A_'],
    ramRefs: ['IY+0', 'IY+6'],
    ports: ['Port_FMAddress', 'Port_FMData'],
    evidence: ['ASM lines 22744-22755 jump to _LABEL_C916_ when the current FM instrument id already matches; lines 22841-22845 add 5 to L and fall into _LABEL_C91A_.'],
  }),
  fragment(0x0C91A, '_LABEL_C91A_', 'fm_volume_envelope_update_entry', '_LABEL_C91A_ FM volume/envelope update entry', 'FM channel volume/envelope update entry that dispatches release/attack states or advances the channel volume script stream.', {
    calls: ['_LABEL_CA53_', '_LABEL_C9EB_'],
    ramRefs: ['IY+0', 'IY+4'],
    ports: ['Port_FMAddress', 'Port_FMData'],
    evidence: ['ASM lines 22845-22880 test IY+0 state bits, dispatch to _LABEL_CA53_/_LABEL_C9EB_, decrement duration, load the next stream byte pair, and mirror the channel data in IY+4.'],
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
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank3AudioFragmentAudit');
  return keys.length === 1 && keys[0] === 'inferred';
}

function canAbsorbC0A1Fragment(mapData) {
  const guard = findExactRegion(mapData, 0x0C09F);
  const split = findExactRegion(mapData, 0x0C0A1);
  if (!guard || !split) return false;
  const splitKeys = Object.keys(split.analysis || {});
  return guard.size === 2 && split.size === 4 && split.type === 'code' && splitKeys.length === 1 && splitKeys[0] === 'inferred';
}

function hasAbsorbedC0A1Fragment(mapData) {
  const guard = findExactRegion(mapData, 0x0C09F);
  const split = findExactRegion(mapData, 0x0C0A1);
  return Boolean(guard && !split && guard.size === 6 && guard.analysis?.bank3AudioFragmentAudit?.kind === 'audio_update_entry_guard_structural_fix');
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      entryCount: ENTRIES.length,
      routineFragmentCount: ENTRIES.length,
      structuralFixesDocumented: (canAbsorbC0A1Fragment(mapData) || hasAbsorbedC0A1Fragment(mapData)) ? 1 : 0,
      assetPolicy: 'Metadata only: ASM labels, offsets, routine fragment roles, RAM references, port names, and evidence. No ROM bytes, music streams, or decoded audio data are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    structuralFixes: [{
      kind: 'mid_instruction_region_absorb',
      targetRegionOffset: '0x0C09F',
      absorbedRegionOffset: '0x0C0A1',
      confidence: 'high',
      summary: 'The existing 0x0C0A1 region starts inside the _LABEL_C09F_ guard instruction sequence. The corrected _LABEL_C09F_ guard covers 0x0C09F-0x0C0A4 before the queued request dispatcher begins at 0x0C0A5.',
      evidence: ['ASM lines 21657-21665 show _LABEL_C09F_ as one contiguous guard: load _RAM_C23B_, return if busy, then test _RAM_C221_ before the branch at 0x0C0A5.'],
    }],
    evidence: [
      'ASM lines 21550-21582 show bank-3 audio initialization writing FM defaults and PSG mute bytes.',
      'ASM lines 21657-21720 show the audio update guard and pending request queue dispatcher.',
      'ASM lines 22536-22594 show PSG release/volume update handling.',
      'ASM lines 22841-22880 show FM instrument-state rejoin and volume/envelope dispatch.',
    ],
  };
}

function applyStructuralFixes(mapData) {
  const changes = [];
  if (!canAbsorbC0A1Fragment(mapData)) return changes;

  const guard = findExactRegion(mapData, 0x0C09F);
  const split = findExactRegion(mapData, 0x0C0A1);
  guard.size = 6;
  guard.name = '_LABEL_C09F_ audio update entry guard';
  guard.notes = 'Audio update busy/pending-request guard; corrected to cover the full 0x0C09F-0x0C0A4 instruction sequence before the dispatcher at 0x0C0A5.';
  guard.analysis = guard.analysis || {};
  guard.analysis.bank3AudioFragmentAudit = {
    catalogId,
    kind: 'audio_update_entry_guard_structural_fix',
    family: 'bank3_audio_driver',
    label: '_LABEL_C09F_',
    confidence: 'high',
    absorbedRegion: regionRef(split),
    summary: guard.notes,
    evidence: ['ASM lines 21657-21665 show _LABEL_C09F_ as one contiguous guard sequence ending immediately before 0x0C0A5.'],
    generatedAt: now,
    tool: toolName,
  };

  mapData.regions = mapData.regions.filter(region => region !== split);
  changes.push({
    kind: 'mid_instruction_region_absorb',
    retainedRegion: regionRef(guard),
    removedRegion: regionRef(split),
    confidence: 'high',
  });
  return changes;
}

function annotateRegion(region, item) {
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  if (item.name && !region.name) region.name = item.name;
  if (item.summary && !region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank3AudioFragmentAudit = {
    catalogId,
    kind: item.role,
    family: item.family,
    label: item.label,
    confidence: item.confidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    calls: item.calls,
    ramRefs: item.ramRefs,
    ports: item.ports,
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
  let changes = { annotated: [], missing: [], structuralFixes: [] };

  if (apply) {
    changes.structuralFixes = applyStructuralFixes(mapData);
    const annotationChanges = applyAnnotations(mapData);
    changes = { ...changes, ...annotationChanges };
    const finalCatalog = buildCatalog(mapData);
    mapData.bank3AudioFragmentCatalogs = (mapData.bank3AudioFragmentCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.bank3AudioFragmentCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank3_audio_fragment_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: changes.annotated.length,
        missingRegions: changes.missing.length,
        inferredOnlyRegionsCovered: changes.annotated.filter(change => change.wasInferredOnlyBeforeAudit).length,
        structuralFixesPresent: (changes.structuralFixes.length || hasAbsorbedC0A1Fragment(mapData)) ? 1 : 0,
        structuralFixesAppliedThisRun: changes.structuralFixes.length,
      },
      annotatedRegions: changes.annotated,
      structuralFixes: changes.structuralFixes,
      missingRegions: changes.missing,
      nextLeads: [
        'Decode _DATA_D139_ audio request table entries into channel-start descriptors without copying stream bytes.',
        'Build a PSG/FM stream opcode preview around _LABEL_C191_, _LABEL_C5F6_, and _LABEL_C91A_ showing durations, volume steps, and register writes.',
        'Trace _RAM_C221_/_RAM_C222_ request queue producers from bank 0 _LABEL_104B_ to classify music versus SFX requests.',
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
      structuralFixesPresent: (changes.structuralFixes.length || hasAbsorbedC0A1Fragment(apply ? readJson(mapPath) : mapData)) ? 1 : 0,
      structuralFixesAppliedThisRun: changes.structuralFixes.length,
    },
    missingRegions: changes.missing,
  }, null, 2));
}

main();
