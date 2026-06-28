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
const catalogId = 'world-audio-event-output-gap-catalog-2026-06-25';
const reportId = 'audio-event-output-gap-audit-2026-06-25';
const toolName = 'tools/world-audio-event-output-gap-audit.mjs';

const eventOutputCatalogId = 'world-audio-event-output-phase-link-catalog-2026-06-25';
const traceSemanticsCatalogId = 'world-audio-event-trace-semantics-catalog-2026-06-25';
const traceModelCatalogId = 'world-audio-trace-model-catalog-2026-06-25';
const outputRegisterCatalogId = 'world-audio-output-register-catalog-2026-06-25';
const streamGraphCatalogId = 'world-audio-stream-graph-catalog-2026-06-25';
const supportUseCatalogId = 'world-audio-support-table-use-catalog-2026-06-25';

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

function refName(ref) {
  return ref?.fieldName || ref?.role || ref?.name || '';
}

function opTargetName(operation) {
  const target = operation?.target || {};
  return `${target.kind || 'unknown'}:${target.fieldName || target.role || target.name || ''}`;
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function readinessFor(eventKey, directOutputPhaseCount, targetFields) {
  if (eventKey === 'note_or_rest_byte') {
    return directOutputPhaseCount
      ? 'direct_output_ready'
      : 'missing_note_output_trace';
  }
  if (eventKey === '$F0') {
    return directOutputPhaseCount
      ? 'partial_direct_output_ready'
      : 'instrument_output_consumer_unlinked';
  }
  if (['$F1', '$F2', '$F3', '$F4'].includes(eventKey)) {
    return 'stream_parameter_output_consumer_unlinked';
  }
  if (eventKey === '$F5') {
    return 'support_lookup_indirect_note_timing_ready';
  }
  if (/^\$F[6-9A-F]$/.test(eventKey)) {
    return 'control_flow_state_ready';
  }
  if (targetFields.some(field => field.includes('current_stream_pointer'))) {
    return 'control_flow_state_ready';
  }
  return 'state_only_unlinked';
}

function expectedNextTrace(readiness) {
  if (readiness === 'direct_output_ready') {
    return 'Use this event in PSG/FM register timeline preview once per-frame output scheduling is modeled.';
  }
  if (readiness === 'partial_direct_output_ready') {
    return 'Trace cache/effect selector consumers so PSG and FM instrument/effect loading can be tied to all touched fields.';
  }
  if (readiness === 'stream_parameter_output_consumer_unlinked') {
    return 'Trace the output routines that consume stream parameter fields and convert them into pitch/envelope hardware shadow writes.';
  }
  if (readiness === 'support_lookup_indirect_note_timing_ready') {
    return 'Keep this as an indirect note-timing input; link exact support-table results only inside the local-ROM runtime preview.';
  }
  if (readiness === 'control_flow_state_ready') {
    return 'Model as interpreter control flow before expecting PSG/FM register output links.';
  }
  return 'Trace downstream consumers before treating this event as output-ready.';
}

function buildCatalog(mapData) {
  const eventOutputCatalog = requireCatalog(mapData, eventOutputCatalogId);
  const traceCatalog = requireCatalog(mapData, traceSemanticsCatalogId);
  const traceModelCatalog = requireCatalog(mapData, traceModelCatalogId);
  const outputCatalog = requireCatalog(mapData, outputRegisterCatalogId);
  const graphCatalog = requireCatalog(mapData, streamGraphCatalogId);
  const supportUseCatalog = requireCatalog(mapData, supportUseCatalogId);
  const outputLinkByKey = new Map((eventOutputCatalog.eventOutputLinks || []).map(link => [link.eventKey, link]));
  const traceByKey = new Map((traceCatalog.traceSemantics || []).map(trace => [trace.eventKey, trace]));
  const opcodeTotals = graphCatalog.summary?.opcodeTotals || {};
  const traceRuleByKind = new Map((traceModelCatalog.applicationRules || []).map(rule => [rule.operationKind, rule]));
  const outputPhaseIds = new Set((outputCatalog.outputPhases || []).map(phase => phase.id));
  const linkedOutputPhaseIds = new Set();
  for (const link of eventOutputCatalog.eventOutputLinks || []) {
    for (const phase of link.matchedOutputPhases || []) linkedOutputPhaseIds.add(phase.phaseId);
  }

  const events = (eventOutputCatalog.eventOutputLinks || []).map(link => {
    const trace = traceByKey.get(link.eventKey) || {};
    const operations = trace.operations || [];
    const targetFields = operations.map(opTargetName);
    const operationKinds = operations.map(op => op.kind || 'unknown');
    const applicationRules = operationKinds.map(kind => traceRuleByKind.get(kind)?.application || '').filter(Boolean);
    const occurrenceCount = link.eventKey === 'note_or_rest_byte' ? null : (opcodeTotals[link.eventKey] || 0);
    const readiness = readinessFor(link.eventKey, link.directOutputPhaseCount || 0, targetFields);
    return {
      eventKey: link.eventKey,
      eventKind: link.eventKind,
      opcodeName: link.opcodeName || trace.opcodeName || '',
      parserAction: trace.parserAction || '',
      occurrenceCount,
      directOutputPhaseCount: link.directOutputPhaseCount || 0,
      outputPhaseIds: (link.matchedOutputPhases || []).map(phase => phase.phaseId).sort(),
      unmatchedFieldNames: (link.unmatchedFieldRefs || []).map(refName).filter(Boolean).sort(),
      operationKinds,
      targetFields,
      applicationRules: [...new Set(applicationRules)].sort(),
      readiness,
      expectedNextTrace: expectedNextTrace(readiness),
      evidence: [
        `${eventOutputCatalogId} links ${link.eventKey} to ${link.directOutputPhaseCount || 0} direct PSG/FM output phase(s).`,
        `${traceSemanticsCatalogId} records ${operations.length} trace operation(s) for ${link.eventKey}.`,
        link.eventKey === '$F5'
          ? `${supportUseCatalogId} records ${supportUseCatalog.summary?.uniqueStreamF5EventCount || 0} unique $F5 support-table events with ${supportUseCatalog.summary?.outOfRangeF5EventCount || 0} out-of-range events.`
          : `${streamGraphCatalogId} records ${occurrenceCount == null ? 'note/rest' : occurrenceCount} observed occurrence(s) for ${link.eventKey}.`,
      ],
    };
  });

  const outputReadyEvents = events.filter(event => event.directOutputPhaseCount > 0);
  const unlinkedEvents = events.filter(event => event.directOutputPhaseCount === 0);
  const observedUnlinkedOpcodeEvents = unlinkedEvents.filter(event => (event.occurrenceCount || 0) > 0);
  const observedUnlinkedOpcodeOccurrenceCount = observedUnlinkedOpcodeEvents.reduce((sum, event) => sum + (event.occurrenceCount || 0), 0);
  const readinessCounts = countBy(events, event => event.readiness);
  const unlinkedReadinessCounts = countBy(unlinkedEvents, event => event.readiness);
  const unlinkedOutputPhaseIds = [...outputPhaseIds].filter(id => !linkedOutputPhaseIds.has(id)).sort();
  const priorityEvents = observedUnlinkedOpcodeEvents
    .filter(event => event.readiness !== 'control_flow_state_ready')
    .sort((a, b) => (b.occurrenceCount || 0) - (a.occurrenceCount || 0) || a.eventKey.localeCompare(b.eventKey))
    .slice(0, 8)
    .map(event => ({
      eventKey: event.eventKey,
      opcodeName: event.opcodeName,
      occurrenceCount: event.occurrenceCount,
      readiness: event.readiness,
      targetFields: event.targetFields,
      expectedNextTrace: event.expectedNextTrace,
    }));

  const summary = {
    eventKindCount: events.length,
    directOutputReadyEventCount: outputReadyEvents.length,
    unlinkedEventKindCount: unlinkedEvents.length,
    observedUnlinkedOpcodeEventCount: observedUnlinkedOpcodeEvents.length,
    observedUnlinkedOpcodeOccurrenceCount,
    controlFlowOnlyUnlinkedEventCount: unlinkedEvents.filter(event => event.readiness === 'control_flow_state_ready').length,
    parameterOutputConsumerGapCount: unlinkedEvents.filter(event => event.readiness === 'stream_parameter_output_consumer_unlinked').length,
    indirectSupportLookupReadyEventCount: unlinkedEvents.filter(event => event.readiness === 'support_lookup_indirect_note_timing_ready').length,
    linkedOutputPhaseCount: linkedOutputPhaseIds.size,
    totalOutputPhaseCount: outputPhaseIds.size,
    unlinkedOutputPhaseCount: unlinkedOutputPhaseIds.length,
    traceModelRuleCount: traceModelCatalog.summary?.applicationRuleCount || 0,
    supportTableUniqueF5EventCount: supportUseCatalog.summary?.uniqueStreamF5EventCount || 0,
    supportTableOutOfRangeF5EventCount: supportUseCatalog.summary?.outOfRangeF5EventCount || 0,
    readinessCounts,
    unlinkedReadinessCounts,
    assetPolicy: 'Metadata only: audio event ids, opcode occurrence counts, RAM field names, output phase ids, readiness classes, and evidence refs. No ROM bytes, stream argument bytes, decoded music, register traces, samples, or generated audio are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      eventOutputCatalogId,
      traceSemanticsCatalogId,
      traceModelCatalogId,
      outputRegisterCatalogId,
      streamGraphCatalogId,
      supportUseCatalogId,
    ],
    assetPolicy: summary.assetPolicy,
    summary,
    unlinkedOutputPhaseIds,
    priorityEvents,
    events,
    evidence: [
      `${eventOutputCatalogId} supplies exact-field direct output links and unmatched event field refs.`,
      `${traceSemanticsCatalogId} supplies event-to-state trace operations for all 17 audio event kinds.`,
      `${streamGraphCatalogId} supplies observed opcode occurrence counts across 224 reachable streams with zero missing targets.`,
      `${supportUseCatalogId} validates $F5 support-table use with zero out-of-range events.`,
      'Readiness classes are conservative: exact direct output links are separated from control-flow state and indirect consumer gaps.',
    ],
    nextLeads: [
      'Trace output consumers for $F1-$F4 stream parameter fields so pitch/envelope state can be converted into PSG/FM register timeline changes.',
      'Keep $F6-$FF repeat/branch/end opcodes in the interpreter control-flow model before expecting hardware output phases from them.',
      'Promote note/rest and $F0 direct links into a read-only PSG/FM register timeline preview after per-frame output scheduling is modeled.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
  mapData.audioCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'audio_event_output_gap_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    unlinkedOutputPhaseIds: catalog.unlinkedOutputPhaseIds,
    priorityEvents: catalog.priorityEvents,
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
    priorityEvents: catalog.priorityEvents,
  }, null, 2));
}

main();
