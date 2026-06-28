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
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-audio-driver-routine-catalog-2026-06-24';
const reportId = 'audio-driver-routine-audit-2026-06-24';

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function labelOffset(label) {
  const m = /^_LABEL_([0-9A-F]+)_$/i.exec(label || '');
  return m ? parseInt(m[1], 16) : null;
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function regionBounds(region) {
  const start = parseInt(region.offset, 16);
  return { start, end: start + (region.size || 0) };
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
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

function routineRole(label, portCounts) {
  const roles = {
    _LABEL_C000_: 'fm_psg_init',
    _LABEL_C4C1_: 'psg_channel_update_dispatch',
    _LABEL_C50E_: 'psg_tone_and_volume_update',
    _LABEL_C656_: 'psg_volume_refresh',
    _LABEL_C671_: 'psg_noise_state_update',
    _LABEL_C748_: 'psg_envelope_update',
    _LABEL_C78F_: 'fm_channel_update_dispatch',
    _LABEL_C7FD_: 'fm_channel_operator_update',
    _LABEL_C86B_: 'fm_instrument_frequency_update',
    _LABEL_C9EB_: 'fm_keyoff_release_update',
    _LABEL_CA53_: 'fm_keyoff_helper',
  };
  if (roles[label]) return roles[label];
  const ports = Object.keys(portCounts).sort().join('+');
  if (ports.includes('Port_PSG') && ports.includes('Port_FM')) return 'mixed_audio_port_writer';
  if (ports.includes('Port_PSG')) return 'psg_port_writer';
  if (ports.includes('Port_FMAddress') || ports.includes('Port_FMData')) return 'fm_port_writer';
  return 'audio_driver_routine';
}

function scanAsm(asmText) {
  const lines = asmText.split(/\r?\n/);
  const routines = new Map();
  let currentLabel = null;
  let currentOffset = null;

  function ensureRoutine(label, offset) {
    if (!routines.has(label)) {
      routines.set(label, {
        label,
        offset,
        writes: [],
        ramRefs: new Set(),
        calls: new Set(),
      });
    }
    return routines.get(label);
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const labelMatch = /^(_LABEL_[0-9A-F]+_):/.exec(raw);
    if (labelMatch) {
      currentLabel = labelMatch[1];
      currentOffset = labelOffset(currentLabel);
      ensureRoutine(currentLabel, currentOffset);
      continue;
    }
    if (!currentLabel || currentOffset == null) continue;
    const code = cleanCode(raw);
    if (!code) continue;
    const routine = ensureRoutine(currentLabel, currentOffset);
    const callMatch = /\bcall\s+(_LABEL_[0-9A-F]+_)/i.exec(code);
    if (callMatch) routine.calls.add(callMatch[1]);
    const ramRe = /_RAM_[0-9A-F]+_/gi;
    let ramMatch;
    while ((ramMatch = ramRe.exec(code)) !== null) routine.ramRefs.add(ramMatch[0]);
    const outMatch = /\bout\s+\((Port_(?:PSG|FMAddress|FMData))\),\s*a/i.exec(code);
    if (!outMatch) continue;
    routine.writes.push({
      line: i + 1,
      port: outMatch[1],
      instruction: code,
    });
  }

  return [...routines.values()]
    .filter(routine => routine.writes.length)
    .map(routine => {
      const portCounts = routine.writes.reduce((counts, write) => {
        counts[write.port] = (counts[write.port] || 0) + 1;
        return counts;
      }, {});
      return {
        ...routine,
        role: routineRole(routine.label, portCounts),
        portCounts,
        ramRefs: [...routine.ramRefs].sort(),
        calls: [...routine.calls].sort(),
      };
    })
    .sort((a, b) => a.offset - b.offset);
}

function normalizeRoutineEntry(routine) {
  const hasPsg = routine.portCounts.Port_PSG;
  const hasFm = routine.portCounts.Port_FMAddress || routine.portCounts.Port_FMData;
  const isAudioInitBody = routine.label === '_LABEL_C006_' &&
    hasPsg &&
    hasFm &&
    routine.writes.some(write => write.line >= 21564 && write.line <= 21581);

  if (!isAudioInitBody) return routine;

  return {
    ...routine,
    label: '_LABEL_C000_',
    offset: labelOffset('_LABEL_C000_'),
    role: routineRole('_LABEL_C000_', routine.portCounts),
    asmGroupingNote: 'ASM scanner first saw these writes after _LABEL_C006_, but _LABEL_C000_ jumps to this local + body; the routine is normalized to the callable init entry.',
  };
}

function buildCatalog(asmText, mapData) {
  const routines = scanAsm(asmText).map(normalizeRoutineEntry).map(routine => {
    const region = findContainingRegion(mapData, routine.offset);
    const evidence = [
      `${routine.label} contains ${routine.writes.length} direct OUT instruction(s) to SMS audio ports.`,
      'Port writes are grouped from ASM instructions only; no audio stream bytes or synthesized samples are embedded.',
    ];
    if (routine.asmGroupingNote) evidence.push(routine.asmGroupingNote);
    return {
      id: `${routine.label}_${routine.role}`,
      label: routine.label,
      offset: hex(routine.offset),
      role: routine.role,
      region: regionRef(region),
      portCounts: routine.portCounts,
      writeCount: routine.writes.length,
      writes: routine.writes,
      ramRefs: routine.ramRefs,
      calls: routine.calls,
      evidence,
    };
  });
  const summary = routines.reduce((acc, routine) => {
    acc.routines++;
    acc.writeCount += routine.writeCount;
    for (const [port, count] of Object.entries(routine.portCounts)) {
      acc.portCounts[port] = (acc.portCounts[port] || 0) + count;
    }
    if (routine.portCounts.Port_PSG) acc.psgRoutines++;
    if (routine.portCounts.Port_FMAddress || routine.portCounts.Port_FMData) acc.fmRoutines++;
    if (!routine.region) acc.missingRegions++;
    return acc;
  }, {
    routines: 0,
    writeCount: 0,
    psgRoutines: 0,
    fmRoutines: 0,
    missingRegions: 0,
    portCounts: {},
    assetPolicy: 'Metadata only: ASM labels, routine offsets, port-write counts, line references, RAM references, and call references. No ROM bytes, decoded music, or audio samples are embedded.',
  });

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-audio-driver-audit.mjs',
    summary,
    routines,
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  for (const routine of catalog.routines) {
    if (!routine.region) continue;
    const region = mapData.regions.find(r => r.id === routine.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.audioDriverRoutineAudit = {
      catalogId,
      kind: routine.role,
      summary: `${routine.label} writes ${routine.writeCount} time(s) to SMS audio ports.`,
      confidence: 'high',
      label: routine.label,
      portCounts: routine.portCounts,
      writeCount: routine.writeCount,
      ramRefs: routine.ramRefs,
      calls: routine.calls,
      evidence: routine.evidence.concat(routine.writes.slice(0, 8).map(write => (
        `ASM line ${write.line}: ${write.instruction}`
      ))),
      generatedAt: now,
      tool: 'tools/world-audio-driver-audit.mjs',
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      label: routine.label,
      role: routine.role,
      portCounts: routine.portCounts,
      writeCount: routine.writeCount,
    });
  }
  return annotated;
}

function main() {
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(asmText, mapData);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : catalog.routines
    .filter(routine => routine.region)
    .map(routine => ({
      id: routine.region.id,
      offset: routine.region.offset,
      name: routine.region.name || '',
      label: routine.label,
      role: routine.role,
      portCounts: routine.portCounts,
      writeCount: routine.writeCount,
    }));

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(c => c.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_driver_routine_audit',
      generatedAt: now,
      tool: 'tools/world-audio-driver-audit.mjs --apply',
      schemaVersion: 1,
      summary: catalog.summary,
      annotatedRegions,
      routines: catalog.routines,
      nextLeads: [
        'Map the RAM channel structs at _RAM_C100_-_RAM_C23C_ into field-level audio state metadata.',
        'Connect audio stream opcodes from audioCatalogs to the port-write routines that consume their decoded state.',
        'Implement a read-only PSG/FM trace viewer before attempting a browser sound player.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions,
    missingRegions: catalog.routines.filter(routine => !routine.region).map(routine => ({
      label: routine.label,
      offset: routine.offset,
      role: routine.role,
    })),
  }, null, 2));
}

main();
