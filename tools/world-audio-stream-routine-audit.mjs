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
const catalogId = 'world-audio-stream-routine-catalog-2026-06-25';
const reportId = 'audio-stream-routine-audit-2026-06-25';
const toolName = 'tools/world-audio-stream-routine-audit.mjs';

const ROUTINES = [
  {
    offset: 0x0C003,
    label: '_LABEL_C003_',
    role: 'audio_request_entry_trampoline',
    name: '_LABEL_C003_ audio request entry trampoline',
    summary: 'Public bank-3 entry that jumps to the audio request loader at _LABEL_C04D_.',
    calls: ['_LABEL_C04D_'],
    ramRefs: [],
    relatedOffsets: [0x0C04D],
    evidence: ['_LABEL_C003_ is a three-byte JP trampoline to _LABEL_C04D_, the routine called by _LABEL_104B_ with C holding the requested sound/music id.'],
  },
  {
    offset: 0x0C006,
    label: '_LABEL_C006_',
    role: 'audio_update_entry_trampoline',
    name: '_LABEL_C006_ audio update entry trampoline',
    summary: 'Public bank-3 entry that jumps to the per-frame audio update at _LABEL_C09F_.',
    calls: ['_LABEL_C09F_'],
    ramRefs: [],
    relatedOffsets: [0x0C09F],
    evidence: ['_LABEL_C006_ is a three-byte JP trampoline to _LABEL_C09F_, the frame update entry called through _LABEL_1065_.'],
  },
  {
    offset: 0x0C04D,
    label: '_LABEL_C04D_',
    role: 'audio_request_loader',
    name: '_LABEL_C04D_ audio request loader',
    summary: 'Looks up the requested song/SFX pointer in _DATA_D139_, applies per-channel priority checks, and seeds stream channel structs.',
    calls: [],
    ramRefs: ['_RAM_C23B_', '_RAM_C233_'],
    relatedOffsets: [0x0D139],
    evidence: ['_LABEL_C04D_ sets _RAM_C23B_, indexes _DATA_D139_ using C, walks header records until an $F0 terminator, and initializes per-channel structs at the _RAM_C100_ family.'],
  },
  {
    offset: 0x0C09F,
    label: '_LABEL_C09F_',
    role: 'audio_update_entry_guard',
    name: '_LABEL_C09F_ audio update entry guard',
    summary: 'Skips updates while a request is loading, expands queued music/SFX requests from _RAM_C222_ through _DATA_D139_, then enters the channel scheduler.',
    calls: ['_LABEL_C0F3_'],
    ramRefs: ['_RAM_C23B_', '_RAM_C221_', '_RAM_C222_'],
    relatedOffsets: [0x0D139, 0x0C0F3],
    evidence: ['_LABEL_C09F_ returns when _RAM_C23B_ bit 0 is set, otherwise consumes _RAM_C221_ queued entries from _RAM_C222_ and then falls into _LABEL_C0F3_.'],
  },
  {
    offset: 0x0C0F3,
    label: '_LABEL_C0F3_',
    role: 'audio_eight_channel_scheduler',
    name: '_LABEL_C0F3_ audio eight-channel scheduler',
    summary: 'Runs the stream interpreter for eight logical channel structs and dispatches to either PSG or FM output update routines.',
    calls: ['_LABEL_C191_', '_LABEL_C4C1_', '_LABEL_C78F_'],
    ramRefs: ['_RAM_C100_', '_RAM_C120_', '_RAM_C140_', '_RAM_C160_', '_RAM_C180_', '_RAM_C1A0_', '_RAM_C1C0_', '_RAM_C1E0_', '_RAM_C200_', '_RAM_C208_', '_RAM_C210_', '_RAM_C218_', '_RAM_C220_', '_RAM_C232_'],
    relatedOffsets: [0x0C191, 0x0C4C1, 0x0C78F],
    evidence: ['_LABEL_C0F3_ sets _RAM_C220_ from 0 to 7, pairs each _RAM_C100_/_RAM_C1E0_ stream struct with a _RAM_C200_/_RAM_C218_ output struct, and calls _LABEL_C191_ for each.'],
  },
  {
    offset: 0x0C191,
    label: '_LABEL_C191_',
    role: 'audio_stream_channel_interpreter',
    name: '_LABEL_C191_ audio stream channel interpreter',
    summary: 'Interprets one music/SFX stream channel: handles active flags, delays, note bytes, duration/envelope state, and dispatches $F0-$FF opcodes through _LABEL_C37B_.',
    calls: ['_LABEL_C2BD_', '_LABEL_C339_', '_LABEL_C37B_'],
    ramRefs: ['_RAM_C220_'],
    relatedOffsets: [0x0C2BD, 0x0C339, 0x0C37B, 0x0C391],
    evidence: ['_LABEL_C191_ uses IX/HL as a channel stream struct, IY as the output voice struct, advances BC stream pointers, handles high-bit note bytes, and jumps to _LABEL_C37B_ when the stream byte class is $F0-$FF.'],
  },
  {
    offset: 0x0C2BD,
    label: '_LABEL_C2BD_',
    role: 'audio_note_event_parser',
    name: '_LABEL_C2BD_ audio note event parser',
    summary: 'Parses a non-FM-special note/event byte, derives pitch/note state, updates channel output fields, and falls into the stream-state commit helper.',
    calls: ['_LABEL_C339_'],
    ramRefs: ['_RAM_C220_'],
    relatedOffsets: [0x0C339],
    evidence: ['_LABEL_C2BD_ masks note nybbles, handles $0C as a rest/sustain path, derives a note value from the current stream byte, and stores output fields before jumping to _LABEL_C339_.'],
  },
  {
    offset: 0x0C339,
    label: '_LABEL_C339_',
    role: 'audio_stream_state_commit',
    name: '_LABEL_C339_ audio stream state commit',
    summary: 'Commits the updated BC stream pointer and channel flags back to the stream struct, then updates the voice volume/amplitude field.',
    calls: [],
    ramRefs: ['_RAM_C220_', '_RAM_C232_', '_RAM_C23C_'],
    evidence: ['_LABEL_C339_ stores BC through the channel struct, writes the I register flags back to the struct, and computes IY+1 volume using _RAM_C23C_ when needed.'],
  },
  {
    offset: 0x0C37B,
    label: '_LABEL_C37B_',
    role: 'audio_control_opcode_dispatch',
    name: '_LABEL_C37B_ audio control opcode dispatch',
    summary: 'Dispatches $F0-$FF stream control opcodes by indexing the handler pointer table at _DATA_C391_.',
    calls: [],
    ramRefs: [],
    relatedOffsets: [0x0C391],
    evidence: ['_LABEL_C37B_ reads a stream byte from BC, maps its low nibble to a word pointer in the table at _DATA_C391_, pushes that pointer, and returns into the handler.'],
  },
  {
    offset: 0x0C50E,
    label: '_LABEL_C50E_',
    role: 'psg_voice_render_core',
    name: '_LABEL_C50E_ PSG voice render core',
    summary: 'Updates one PSG voice from the output struct, including instrument/pitch source refresh, tone-period calculation, envelope state, and volume dispatch.',
    calls: ['_LABEL_C56A_', '_LABEL_C5F6_', '_LABEL_C671_', '_LABEL_C748_'],
    ramRefs: ['_RAM_C220_', '_RAM_C23C_'],
    relatedOffsets: [0x0C56A, 0x0C5F6, 0x0C671, 0x0C748],
    evidence: ['_LABEL_C50E_ gates on IY voice flags, refreshes instrument data when IY+6 changes, branches to _LABEL_C671_ for noise, and otherwise falls into tone/envelope update paths.'],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(region => {
    const start = parseInt(region.offset, 16);
    return offset >= start && offset < start + (region.size || 0);
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

function hasNonInferredAnalysisOtherThanSelf(region) {
  return Boolean(region && Object.keys(region.analysis || {}).some(key => (
    key !== 'inferred' && key !== 'audioStreamRoutineAudit'
  )));
}

function buildCatalog(mapData) {
  const routines = ROUTINES.map(def => {
    const region = findContainingRegion(mapData, def.offset);
    const relatedRegions = (def.relatedOffsets || [])
      .map(offset => regionRef(findContainingRegion(mapData, offset)))
      .filter(Boolean);
    return {
      id: `${def.label}_${def.role}`,
      label: def.label,
      offset: hex(def.offset),
      role: def.role,
      proposedName: def.name,
      summary: def.summary,
      confidence: 'high',
      region: regionRef(region),
      wasGenericCodeRegion: Boolean(region && !hasNonInferredAnalysisOtherThanSelf(region)),
      calls: def.calls || [],
      ramRefs: def.ramRefs || [],
      relatedRegions,
      evidence: def.evidence,
    };
  });
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    routines,
    summary: {
      routineCount: routines.length,
      missingRegions: routines.filter(routine => !routine.region).length,
      genericCodeRegionsCovered: routines.filter(routine => routine.wasGenericCodeRegion).length,
      assetPolicy: 'Metadata only: ASM labels, offsets, routine roles, calls, RAM refs, pointer-table refs, and evidence. No ROM bytes, decoded music, or synthesized audio are embedded.',
    },
  };
}

function annotateRegion(region, routine) {
  const previousName = region.name || '';
  if (!previousName && routine.proposedName) region.name = routine.proposedName;
  region.analysis = region.analysis || {};
  region.analysis.audioStreamRoutineAudit = {
    catalogId,
    kind: routine.role,
    label: routine.label,
    summary: routine.summary,
    confidence: routine.confidence,
    nameBeforeAudit: previousName,
    nameAfterAudit: region.name || '',
    detail: {
      routineOffset: routine.offset,
      regionOffset: region.offset,
      calls: routine.calls,
      ramRefs: routine.ramRefs,
      relatedRegions: routine.relatedRegions,
    },
    evidence: routine.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    label: routine.label,
    role: routine.role,
    previousName,
    name: region.name || '',
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const missingRegions = catalog.routines
    .filter(routine => !routine.region)
    .map(routine => ({ label: routine.label, offset: routine.offset, role: routine.role }));
  const annotatedRegions = [];

  if (apply) {
    for (const routine of catalog.routines) {
      if (!routine.region) continue;
      const region = mapData.regions.find(item => item.id === routine.region.id);
      annotatedRegions.push(annotateRegion(region, routine));
    }

    const finalCatalog = buildCatalog(mapData);
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_stream_routine_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
      routines: finalCatalog.routines,
      annotatedRegions,
      missingRegions,
      nextLeads: [
        'Model _RAM_C100_-_RAM_C1FF stream-channel structs and _RAM_C200_-_RAM_C21F output voice structs as field-level RAM metadata.',
        'Connect the $F0-$FF handler metadata from audioOpcodeDispatchAudit to each parser state mutation in _LABEL_C191_/_LABEL_C37B_.',
        'Build a read-only per-frame audio trace that records stream pointer, delay, note, envelope, and PSG/FM register writes without playing audio yet.',
      ],
    });

    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: apply ? annotatedRegions : catalog.routines
      .filter(routine => routine.region)
      .map(routine => ({
        id: routine.region.id,
        offset: routine.region.offset,
        label: routine.label,
        role: routine.role,
        currentName: routine.region.name || '',
        proposedName: routine.proposedName,
      })),
    missingRegions,
  }, null, 2));
}

main();
