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
const catalogId = 'world-audio-frame-step-model-catalog-2026-06-25';
const reportId = 'audio-frame-step-model-audit-2026-06-25';
const toolName = 'tools/world-audio-frame-step-model-audit.mjs';

const sourceCatalogIds = [
  'world-audio-stream-seed-catalog-2026-06-25',
  'world-audio-frame-gate-catalog-2026-06-25',
  'world-audio-event-trace-semantics-catalog-2026-06-25',
  'world-audio-trace-model-catalog-2026-06-25',
  'world-audio-note-timing-support-catalog-2026-06-25',
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

function buildCatalog(mapData) {
  const catalogs = Object.fromEntries(sourceCatalogIds.map(id => [id, requireCatalog(mapData, id)]));
  const seedSummary = catalogs['world-audio-stream-seed-catalog-2026-06-25'].summary || {};
  const gateSummary = catalogs['world-audio-frame-gate-catalog-2026-06-25'].summary || {};
  const traceSummary = catalogs['world-audio-event-trace-semantics-catalog-2026-06-25'].summary || {};
  const modelSummary = catalogs['world-audio-trace-model-catalog-2026-06-25'].summary || {};
  const noteSummary = catalogs['world-audio-note-timing-support-catalog-2026-06-25'].summary || {};
  const validationIssues = [];
  if ((seedSummary.validationIssueCount || 0) !== 0) validationIssues.push('Stream seed catalog is not validation-clean.');
  if ((gateSummary.validationIssueCount || 0) !== 0) validationIssues.push('Frame gate catalog is not validation-clean.');
  if ((traceSummary.validationIssueCount || 0) !== 0) validationIssues.push('Event trace semantics catalog is not validation-clean.');
  if ((modelSummary.validationIssueCount || 0) !== 0) validationIssues.push('Trace model catalog is not validation-clean.');
  if ((noteSummary.validationIssueCount || 0) !== 0) validationIssues.push('Note timing support catalog is not validation-clean.');

  const frameStepModel = {
    purpose: 'Read-only, conservative per-channel frame stepping for analyzer diagnostics before a complete audio engine exists.',
    implementation: {
      uiFunction: 'zoneAudioBuildFrameStepPreview',
      renderFunction: 'zoneAudioRenderPreview',
      maxFramesPerChannel: 16,
      maxEventsPerFrame: 24,
      output: 'diagnostic HTML plus zoneAudioPreviewFrameStep* dataset counters',
    },
    initialState: [
      {
        id: 'seed_stream_flags',
        sourceCatalogId: 'world-audio-stream-seed-catalog-2026-06-25',
        field: 'stream_flags',
        value: '0x11',
        effect: 'active bit 0 and reset bit 4 are set before the first interpreter update',
      },
      {
        id: 'seed_current_stream_pointer',
        sourceCatalogId: 'world-audio-stream-seed-catalog-2026-06-25',
        field: 'current_stream_pointer',
        effect: 'bank-3 pointer copied from the request header record becomes the first event fetch address',
      },
    ],
    frameGateOrder: [
      {
        id: 'inactive_stream_gate',
        sourceCatalogId: 'world-audio-frame-gate-catalog-2026-06-25',
        condition: '(stream_flags & 0x01) == 0',
        outcome: 'wait without event fetch',
      },
      {
        id: 'reset_path_fetch',
        sourceCatalogId: 'world-audio-frame-gate-catalog-2026-06-25',
        condition: '(stream_flags & 0x10) != 0',
        outcome: 'clear reset fields, clear bit 4 in synthetic state, reload current_stream_pointer, and fetch one event',
      },
      {
        id: 'primary_delay_wait',
        sourceCatalogId: 'world-audio-frame-gate-catalog-2026-06-25',
        condition: 'note_delay_counter > 1',
        outcome: 'decrement note_delay_counter; decrement secondary_delay_counter once when known; wait without event fetch',
      },
      {
        id: 'secondary_delay_wait',
        sourceCatalogId: 'world-audio-frame-gate-catalog-2026-06-25',
        condition: 'secondary_delay_counter > 1 after primary gate allows continuation',
        outcome: 'decrement secondary_delay_counter; wait without event fetch',
      },
      {
        id: 'event_fetch',
        sourceCatalogId: 'world-audio-frame-gate-catalog-2026-06-25',
        condition: 'active stream with no reset bit and both delay gates allowing continuation',
        outcome: 'fetch and apply stream events until a frame-terminating note/rest, stop condition, unresolved pointer, or event cap',
      },
    ],
    eventApplication: {
      sourceCatalogs: [
        'world-audio-event-trace-semantics-catalog-2026-06-25',
        'world-audio-trace-model-catalog-2026-06-25',
        'world-audio-note-timing-support-catalog-2026-06-25',
      ],
      summary: 'Fetched events use the same synthetic trace operations, note timing table lookup, support-table transforms, and normal note delay reload logic as the existing event preview. Control opcodes whose handlers jump back to the event classifier may be consumed in the same frame before a note/rest commits delay state.',
    },
    limitations: [
      'This is not cycle-accurate and does not emit PSG/FM audio.',
      'Only fields with known byte/pointer values are stepped; unknown fields stop the relevant gate as unresolved.',
      'Hardware shadow output writes are still represented as trace/output phase metadata, not a full register timeline.',
      'Immediate request priority arbitration across multiple active requests is documented in the seed catalog but not yet replayed as a request queue simulation.',
    ],
  };

  const summary = {
    sourceCatalogCount: sourceCatalogIds.length,
    seedRequestCount: seedSummary.requestSeedCount || 0,
    seedChannelCount: seedSummary.headerChannelSeedCount || 0,
    gateCount: gateSummary.gateCount || 0,
    traceOperationCount: traceSummary.operationCount || 0,
    traceApplicationRuleCount: modelSummary.applicationRuleCount || 0,
    noteTimingTableBytes: noteSummary.timingTableBytes || 0,
    maxFramesPerChannel: frameStepModel.implementation.maxFramesPerChannel,
    maxEventsPerFrame: frameStepModel.implementation.maxEventsPerFrame,
    validationIssueCount: validationIssues.length,
    assetPolicy: 'Metadata only: frame-step algorithm names, source catalog ids, formulas, counts, limitations, and ASM-backed evidence references. No ROM bytes, decoded music, audio samples, or PSG/FM register traces are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: sourceCatalogIds,
    assetPolicy: summary.assetPolicy,
    summary,
    frameStepModel,
    validationIssues,
    evidence: [
      'world-audio-stream-seed-catalog-2026-06-25 provides the initial stream_flags=0x11 and current_stream_pointer seed state from _LABEL_C04D_/_LABEL_C09F_.',
      'world-audio-frame-gate-catalog-2026-06-25 provides the active/reset/primary-delay/secondary-delay fetch gate semantics from _LABEL_C191_.',
      'world-audio-event-trace-semantics-catalog-2026-06-25 and world-audio-trace-model-catalog-2026-06-25 provide event-to-RAM state updates.',
      'world-audio-note-timing-support-catalog-2026-06-25 provides high-bit note timing formulas and normal note reload fields consumed by the gates.',
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
      type: 'audio_frame_step_model_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      frameStepModel: catalog.frameStepModel,
      validationIssues: catalog.validationIssues,
      nextLeads: [
        'Promote the preview frame-step model into a reusable shared/wb3/audio-driver.js interpreter module.',
        'Add request queue playback with immediate priority arbitration and queued request replay.',
        'Extend frame steps from RAM-field state to PSG/FM register trace output phases.',
      ],
    });
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
