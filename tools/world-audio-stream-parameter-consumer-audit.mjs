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
const catalogId = 'world-audio-stream-parameter-consumer-catalog-2026-06-25';
const reportId = 'audio-stream-parameter-consumer-audit-2026-06-25';
const toolName = 'tools/world-audio-stream-parameter-consumer-audit.mjs';

const gapCatalogId = 'world-audio-event-output-gap-catalog-2026-06-25';
const eventRamCatalogId = 'world-audio-event-ram-link-catalog-2026-06-25';
const traceSemanticsCatalogId = 'world-audio-event-trace-semantics-catalog-2026-06-25';
const ramStateCatalogId = 'world-audio-ram-state-catalog-2026-06-25';
const outputRegisterCatalogId = 'world-audio-output-register-catalog-2026-06-25';

const PARAMETER_CONSUMERS = [
  {
    id: 'audio_param_pitch_pair_to_output_phase',
    eventKeys: ['$F1', '$F2'],
    eventRole: 'pitch_pair_parameter',
    sourceStreamFields: [
      'period_low_base_or_pair_param_0',
      'period_high_base_or_pair_param_1',
    ],
    noteConsumer: {
      routineLabel: '_LABEL_C2BD_',
      lineRange: 'ASM lines 22022-22055',
      summary: 'The normal note/rest path combines the decoded note byte with stream field +9 and copies stream field +11, then mirrors the results into IY+3/IY+2.',
      hardwareFields: ['pitch_accumulator_or_period'],
      evidence: [
        'ASM lines 22036-22045 add the decoded note value to stream field +9 and write the result to stream field +8 and IY+3.',
        'ASM lines 22046-22055 copy stream field +11 into stream field +10 and IY+2.',
      ],
    },
    primaryOutputFields: ['pitch_accumulator_or_period'],
    primaryOutputPhaseIds: [
      'psg_tone_period_write',
      'fm_pitch_period_write',
    ],
    secondaryOutputPhaseIds: [
      'psg_noise_state_write',
      'fm_key_release_write',
    ],
    confidence: 'medium',
  },
  {
    id: 'audio_param_single_volume_to_output_phase',
    eventKeys: ['$F3', '$F4'],
    eventRole: 'single_volume_or_attenuation_parameter',
    sourceStreamFields: ['single_stream_parameter'],
    noteConsumer: {
      routineLabel: '_LABEL_C339_',
      lineRange: 'ASM lines 22072-22102',
      summary: 'The note/rest tail reads stream field +16, optionally applies the shared PSG/FM bias path, clamps to $0F, and stores IY+1.',
      hardwareFields: ['volume_or_attenuation'],
      evidence: [
        'ASM lines 22072-22080 copy stream field +16 directly into IY+1 for the alternate channel class.',
        'ASM lines 22082-22102 read stream field +16, optionally add _RAM_C23C_ for the FM-selected path, clamp to $0F, and write IY+1.',
      ],
    },
    primaryOutputFields: ['volume_or_attenuation'],
    primaryOutputPhaseIds: [
      'psg_volume_envelope_write',
      'fm_channel_volume_write',
      'fm_volume_table_write',
      'fm_instrument_load_write',
    ],
    secondaryOutputPhaseIds: [],
    confidence: 'medium',
  },
];

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

function fieldRefNames(refs) {
  return (refs || []).map(ref => ref.fieldName || ref.role || ref.name || '').filter(Boolean);
}

function eventLinksByKey(catalog) {
  return new Map((catalog.opcodeLinks || []).map(link => [link.opcode, link]));
}

function traceByKey(catalog) {
  return new Map((catalog.traceSemantics || []).map(trace => [trace.eventKey, trace]));
}

function outputPhasesById(catalog) {
  return new Map((catalog.outputPhases || []).map(phase => [phase.id, phase]));
}

function outputPhaseSummary(phase) {
  return phase ? {
    phaseId: phase.id,
    chip: phase.chip,
    routineLabel: phase.routineLabel,
    fieldRefs: fieldRefNames(phase.fieldRefs),
    writeCount: phase.writeCount || (phase.writes || []).length || 0,
    confidence: phase.confidence || '',
  } : null;
}

function buildCatalog(mapData) {
  const gapCatalog = requireCatalog(mapData, gapCatalogId);
  const eventRamCatalog = requireCatalog(mapData, eventRamCatalogId);
  const traceCatalog = requireCatalog(mapData, traceSemanticsCatalogId);
  const ramStateCatalog = requireCatalog(mapData, ramStateCatalogId);
  const outputCatalog = requireCatalog(mapData, outputRegisterCatalogId);
  const eventLinks = eventLinksByKey(eventRamCatalog);
  const traces = traceByKey(traceCatalog);
  const outputPhases = outputPhasesById(outputCatalog);
  const streamFields = new Set((ramStateCatalog.streamChannelStruct?.fields || []).map(field => field.name));
  const hardwareFields = new Set((ramStateCatalog.hardwareShadowStruct?.fields || []).map(field => field.name));
  const validationIssues = [];

  const consumers = PARAMETER_CONSUMERS.map(consumer => {
    for (const field of consumer.sourceStreamFields) {
      if (!streamFields.has(field)) validationIssues.push(`${consumer.id} references missing stream field ${field}`);
    }
    for (const field of consumer.noteConsumer.hardwareFields) {
      if (!hardwareFields.has(field)) validationIssues.push(`${consumer.id} references missing hardware field ${field}`);
    }
    const events = consumer.eventKeys.map(eventKey => {
      const link = eventLinks.get(eventKey);
      const trace = traces.get(eventKey);
      const linkedFields = fieldRefNames(link?.fieldRefs);
      for (const field of consumer.sourceStreamFields) {
        if (!linkedFields.includes(field)) validationIssues.push(`${consumer.id} event ${eventKey} is missing field ref ${field}`);
      }
      return {
        eventKey,
        opcodeName: link?.opcodeName || trace?.opcodeName || '',
        parserAction: link?.parserAction || trace?.parserAction || '',
        directOutputPhaseCount: gapCatalog.events?.find(event => event.eventKey === eventKey)?.directOutputPhaseCount || 0,
        sourceStreamFields: consumer.sourceStreamFields,
        traceOperationKinds: (trace?.operations || []).map(operation => operation.kind),
      };
    });
    const primaryOutputPhases = consumer.primaryOutputPhaseIds
      .map(id => outputPhaseSummary(outputPhases.get(id)))
      .filter(Boolean);
    const secondaryOutputPhases = consumer.secondaryOutputPhaseIds
      .map(id => outputPhaseSummary(outputPhases.get(id)))
      .filter(Boolean);
    const outputFieldCoverage = new Set();
    for (const phase of [...primaryOutputPhases, ...secondaryOutputPhases]) {
      for (const field of phase.fieldRefs || []) outputFieldCoverage.add(field);
    }
    for (const field of consumer.primaryOutputFields) {
      if (!outputFieldCoverage.has(field)) validationIssues.push(`${consumer.id} has no output phase field ref for ${field}`);
    }
    return {
      id: consumer.id,
      eventRole: consumer.eventRole,
      eventKeys: consumer.eventKeys,
      events,
      sourceStreamFields: consumer.sourceStreamFields,
      indirectConsumerKind: 'note_or_rest_tail_hardware_shadow_mirror',
      noteConsumer: consumer.noteConsumer,
      primaryOutputFields: consumer.primaryOutputFields,
      primaryOutputPhases,
      secondaryOutputPhases,
      confidence: consumer.confidence,
      status: primaryOutputPhases.length ? 'indirect_output_consumer_linked' : 'needs_output_phase_trace',
      evidence: [
        ...events.map(event => `${event.eventKey} is recorded in ${eventRamCatalogId} as mutating ${consumer.sourceStreamFields.join(', ')}.`),
        ...consumer.noteConsumer.evidence,
        ...primaryOutputPhases.map(phase => `${outputRegisterCatalogId} links ${phase.phaseId} to ${phase.fieldRefs.join(', ')}.`),
      ],
    };
  });

  const linkedEventKeys = [...new Set(consumers.flatMap(consumer => consumer.eventKeys))].sort();
  const primaryOutputPhaseIds = [...new Set(consumers.flatMap(consumer => consumer.primaryOutputPhases.map(phase => phase.phaseId)))].sort();
  const secondaryOutputPhaseIds = [...new Set(consumers.flatMap(consumer => consumer.secondaryOutputPhases.map(phase => phase.phaseId)))].sort();
  const previouslyGapEvents = (gapCatalog.events || []).filter(event =>
    linkedEventKeys.includes(event.eventKey) &&
    event.readiness === 'stream_parameter_output_consumer_unlinked'
  );

  const summary = {
    consumerLinkCount: consumers.length,
    linkedParameterEventKindCount: linkedEventKeys.length,
    linkedParameterEventKeys: linkedEventKeys,
    previouslyGapEventCount: previouslyGapEvents.length,
    primaryOutputPhaseCount: primaryOutputPhaseIds.length,
    primaryOutputPhaseIds,
    secondaryOutputPhaseCount: secondaryOutputPhaseIds.length,
    secondaryOutputPhaseIds,
    pitchParameterEventCount: consumers.find(item => item.eventRole === 'pitch_pair_parameter')?.eventKeys.length || 0,
    volumeParameterEventCount: consumers.find(item => item.eventRole === 'single_volume_or_attenuation_parameter')?.eventKeys.length || 0,
    validationIssueCount: validationIssues.length,
    assetPolicy: 'Metadata only: audio event ids, RAM field names, routine labels, ASM line refs, output phase ids, and relationship classes. No ROM bytes, stream argument bytes, decoded music, register traces, samples, or generated audio are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      gapCatalogId,
      eventRamCatalogId,
      traceSemanticsCatalogId,
      ramStateCatalogId,
      outputRegisterCatalogId,
    ],
    assetPolicy: summary.assetPolicy,
    semantics: {
      directVsIndirect: 'This catalog links stream-parameter events to PSG/FM output phases through the note/rest tail hardware-shadow mirrors. It is intentionally not a direct same-frame output link.',
      pitchPath: '$F1/$F2 mutate pitch base stream fields; normal note/rest handling mirrors those fields into IY+2/IY+3 before PSG/FM pitch output phases consume them.',
      volumePath: '$F3/$F4 mutate stream field +16; the note/rest tail mirrors it into IY+1 before PSG/FM volume phases consume it.',
    },
    summary,
    consumers,
    validationIssues,
    evidence: [
      `${gapCatalogId} identifies $F1-$F4 as direct-output gaps before this indirect consumer trace.`,
      `${eventRamCatalogId} names the stream fields mutated by $F1-$F4.`,
      `${ramStateCatalogId} names stream fields +9/+11/+16 and hardware shadow fields IY+1/IY+2/IY+3.`,
      `${outputRegisterCatalogId} names PSG/FM output phases consuming pitch_accumulator_or_period and volume_or_attenuation.`,
      'ASM lines 22036-22055 prove the pitch parameter mirror into IY+3/IY+2.',
      'ASM lines 22072-22102 prove the single parameter mirror into IY+1.',
    ],
    nextLeads: [
      'Use this indirect consumer bridge to upgrade the audio event output-gap readiness classes from direct-only to direct-or-indirect readiness.',
      'Extend the runtime audio preview so $F1-$F4 argument values affect synthetic IY+1/IY+2/IY+3 state after the next note/rest event, still without persisting register traces.',
      'Use the primary output phase ids here as the first target set for a read-only PSG/FM register timeline preview.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
  mapData.audioCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'audio_stream_parameter_consumer_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    semantics: catalog.semantics,
    consumers: catalog.consumers.map(consumer => ({
      id: consumer.id,
      eventKeys: consumer.eventKeys,
      sourceStreamFields: consumer.sourceStreamFields,
      primaryOutputFields: consumer.primaryOutputFields,
      primaryOutputPhaseIds: consumer.primaryOutputPhases.map(phase => phase.phaseId),
      status: consumer.status,
      confidence: consumer.confidence,
    })),
    validationIssues: catalog.validationIssues,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (apply) {
    applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    validationIssues: catalog.validationIssues,
  }, null, 2));
}

main();
