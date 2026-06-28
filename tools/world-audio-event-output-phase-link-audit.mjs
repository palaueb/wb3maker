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
const catalogId = 'world-audio-event-output-phase-link-catalog-2026-06-25';
const reportId = 'audio-event-output-phase-link-audit-2026-06-25';
const toolName = 'tools/world-audio-event-output-phase-link-audit.mjs';

const eventRamCatalogId = 'world-audio-event-ram-link-catalog-2026-06-25';
const outputCatalogId = 'world-audio-output-register-catalog-2026-06-25';

const CONTEXT_REF_KEYS = new Set([
  'global:active_audio_channel_index',
]);

const confidenceRank = { high: 3, medium: 2, low: 1 };

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function refKey(ref) {
  if (!ref) return '';
  if (ref.kind === 'stream_field') return `stream:${ref.fieldName || ''}`;
  if (ref.kind === 'hardware_shadow_field') return `hardware:${ref.fieldName || ''}`;
  if (ref.kind === 'global_ram') return `global:${ref.role || ''}`;
  if (ref.kind === 'support_data') return `support:${ref.name || ''}`;
  return `${ref.kind || 'unknown'}:${ref.fieldName || ref.role || ref.name || ''}`;
}

function refLabel(ref) {
  if (!ref) return '';
  if (ref.kind === 'stream_field') return `stream.${ref.fieldName}`;
  if (ref.kind === 'hardware_shadow_field') return `hardware.${ref.fieldName}`;
  if (ref.kind === 'global_ram') return `global.${ref.role}`;
  if (ref.kind === 'support_data') return `support.${ref.name}`;
  return `${ref.kind || 'unknown'}.${ref.fieldName || ref.role || ref.name || ''}`;
}

function linkConfidence(matchedRefs) {
  if (!matchedRefs.length) return 'low';
  let rank = 3;
  for (const match of matchedRefs) {
    rank = Math.min(rank, confidenceRank[match.eventConfidence] || 2);
    rank = Math.min(rank, confidenceRank[match.phaseConfidence] || 2);
  }
  if (rank >= 3) return 'high';
  if (rank >= 2) return 'medium';
  return 'low';
}

function eventEntries(eventCatalog) {
  return [
    {
      eventKey: 'note_or_rest_byte',
      eventKind: 'note_or_rest_byte',
      eventLabel: 'note/rest byte',
      fieldRefs: eventCatalog.noteOrRest?.fieldRefs || [],
      evidence: eventCatalog.noteOrRest?.evidence || [],
    },
    ...(eventCatalog.opcodeLinks || []).map(link => ({
      eventKey: link.opcode,
      opcode: link.opcode,
      opcodeName: link.opcodeName || '',
      eventKind: 'control_opcode',
      eventLabel: `${link.opcode} ${link.opcodeName || 'control opcode'}`,
      fieldRefs: link.fieldRefs || [],
      evidence: link.evidence || [],
    })),
  ];
}

function directFieldMatches(event, phase) {
  const phaseRefs = phase.fieldRefs || [];
  const phaseByKey = new Map(phaseRefs.map(ref => [refKey(ref), ref]));
  const matches = [];
  for (const eventRef of event.fieldRefs || []) {
    const key = refKey(eventRef);
    if (!key || CONTEXT_REF_KEYS.has(key)) continue;
    const phaseRef = phaseByKey.get(key);
    if (!phaseRef) continue;
    matches.push({
      key,
      label: refLabel(eventRef),
      eventRelationship: eventRef.relationship || '',
      phaseRelationship: phaseRef.relationship || '',
      eventConfidence: eventRef.confidence || '',
      phaseConfidence: phaseRef.confidence || '',
    });
  }
  return matches;
}

function buildEventOutputLink(event, outputCatalog) {
  const matchedOutputPhases = [];
  const matchedEventKeys = new Set();
  for (const phase of outputCatalog.outputPhases || []) {
    const matchedRefs = directFieldMatches(event, phase);
    if (!matchedRefs.length) continue;
    for (const ref of matchedRefs) matchedEventKeys.add(ref.key);
    matchedOutputPhases.push({
      phaseId: phase.id,
      chip: phase.chip,
      routineLabel: phase.routineLabel,
      registerFamily: phase.registerFamily,
      writeCount: phase.writeCount || (phase.writes || []).length,
      confidence: linkConfidence(matchedRefs),
      matchedRefs,
      summary: phase.summary || '',
      evidence: [
        `Event ${event.eventLabel} and output phase ${phase.id} share ${matchedRefs.map(ref => ref.label).join(', ')}.`,
        `Output phase evidence is recorded in ${outputCatalogId}.`,
      ],
    });
  }
  matchedOutputPhases.sort((a, b) =>
    a.chip.localeCompare(b.chip) || a.phaseId.localeCompare(b.phaseId)
  );

  const unmatchedFieldRefs = (event.fieldRefs || [])
    .filter(ref => {
      const key = refKey(ref);
      return key && !CONTEXT_REF_KEYS.has(key) && !matchedEventKeys.has(key);
    })
    .map(ref => ({
      kind: ref.kind,
      fieldName: ref.fieldName || '',
      role: ref.role || '',
      relationship: ref.relationship || '',
      confidence: ref.confidence || '',
      note: 'No direct output phase references this exact field; it may be interpreter state or an indirect input to later hardware-shadow updates.',
    }));

  return {
    eventKey: event.eventKey,
    eventKind: event.eventKind,
    eventLabel: event.eventLabel,
    opcode: event.opcode || '',
    opcodeName: event.opcodeName || '',
    directOutputPhaseCount: matchedOutputPhases.length,
    matchedOutputPhases,
    unmatchedFieldRefs,
    evidence: [
      `Event RAM refs come from ${eventRamCatalogId}.`,
      `Output phase refs come from ${outputCatalogId}.`,
      'Links are direct only when event and output phase share the same non-context RAM field name; active_audio_channel_index alone is not sufficient.',
      ...(event.evidence || []).slice(0, 2),
    ],
  };
}

function buildCatalog(mapData) {
  const eventCatalog = requireCatalog(mapData, eventRamCatalogId);
  const outputCatalog = requireCatalog(mapData, outputCatalogId);
  const eventOutputLinks = eventEntries(eventCatalog).map(event =>
    buildEventOutputLink(event, outputCatalog)
  );
  const summary = eventOutputLinks.reduce((acc, link) => {
    acc.eventKindCount++;
    acc.totalDirectOutputPhaseLinks += link.directOutputPhaseCount;
    if (link.directOutputPhaseCount) acc.linkedEventKindCount++;
    else acc.unlinkedEventKindCount++;
    acc.unmatchedFieldRefCount += link.unmatchedFieldRefs.length;
    for (const phase of link.matchedOutputPhases) {
      if (phase.chip === 'psg') acc.psgOutputPhaseLinkCount++;
      else if (phase.chip === 'fm') acc.fmOutputPhaseLinkCount++;
      else acc.mixedOutputPhaseLinkCount++;
      acc.uniqueOutputPhaseIds.add(phase.phaseId);
    }
    return acc;
  }, {
    eventKindCount: 0,
    linkedEventKindCount: 0,
    unlinkedEventKindCount: 0,
    totalDirectOutputPhaseLinks: 0,
    uniqueOutputPhaseIds: new Set(),
    psgOutputPhaseLinkCount: 0,
    fmOutputPhaseLinkCount: 0,
    mixedOutputPhaseLinkCount: 0,
    unmatchedFieldRefCount: 0,
    sourceEventRefCount: eventCatalog.summary?.exactFieldRefCount || 0,
    sourceOutputPhaseCount: outputCatalog.summary?.phaseCount || 0,
    assetPolicy: 'Metadata only: event ids, output phase ids, RAM field names, relationship text, counts, and ASM evidence references. No ROM bytes, decoded music, audio samples, or register traces are embedded.',
  });
  summary.uniqueOutputPhaseCount = summary.uniqueOutputPhaseIds.size;
  summary.uniqueOutputPhaseIds = [...summary.uniqueOutputPhaseIds].sort();

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [eventRamCatalogId, outputCatalogId],
    assetPolicy: summary.assetPolicy,
    semantics: {
      directLinks: 'A direct link means a decoded stream event and a PSG/FM output phase reference the same non-context RAM field name.',
      contextRefs: 'active_audio_channel_index is treated as routing context and never creates a link by itself.',
      caution: 'These links identify static producer/consumer relationships. They do not prove that a phase writes on the same frame as the event without a frame trace.',
    },
    summary,
    eventOutputLinks,
    evidence: [
      `${eventRamCatalogId} supplies decoded event-to-RAM field refs.`,
      `${outputCatalogId} supplies PSG/FM output phase-to-RAM field refs and ASM line evidence.`,
      'No ROM bytes, stream bytes, generated audio, or register traces are stored.',
    ],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_event_output_phase_link_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      nextLeads: [
        'Use these direct links to group audio preview events by likely PSG/FM output phase consumers.',
        'Build a synthetic frame trace that proves when hardware-shadow fields change before each output phase runs.',
        'Expand indirect links for stream-only fields after tracing the interpreter paths that copy them into hardware-shadow state.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    linkedEvents: catalog.eventOutputLinks
      .filter(link => link.directOutputPhaseCount)
      .map(link => ({
        eventKey: link.eventKey,
        directOutputPhaseCount: link.directOutputPhaseCount,
        phaseIds: link.matchedOutputPhases.map(phase => phase.phaseId),
      })),
  }, null, 2));
}

main();
