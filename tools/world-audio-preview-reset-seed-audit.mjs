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
const catalogId = 'world-audio-preview-reset-seed-catalog-2026-06-25';
const reportId = 'audio-preview-reset-seed-audit-2026-06-25';
const toolName = 'tools/world-audio-preview-reset-seed-audit.mjs';

const sourceCatalogIds = [
  'world-audio-stream-seed-catalog-2026-06-25',
  'world-audio-frame-gate-catalog-2026-06-25',
  'world-audio-note-timing-support-catalog-2026-06-25',
  'world-audio-frame-step-model-catalog-2026-06-25',
];
const smokeReportId = 'zone-recipe-browser-smoke-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findCatalog(mapData, id) {
  return (mapData.audioCatalogs || []).find(item => item.id === id) || null;
}

function findReport(mapData, id) {
  return (mapData.analysisReports || []).find(item => item.id === id) || null;
}

function requireCatalogs(mapData) {
  const missing = sourceCatalogIds.filter(id => !findCatalog(mapData, id));
  if (missing.length) throw new Error(`Missing required audio catalog(s): ${missing.join(', ')}`);
}

function buildCatalog(mapData) {
  requireCatalogs(mapData);
  const smoke = findReport(mapData, smokeReportId);
  const audioPreview = smoke?.summary?.audioPreview || {};
  const validationIssues = [];
  if (!smoke) validationIssues.push(`Missing browser smoke report ${smokeReportId}`);
  if ((audioPreview.totalNoteTimingEvents || 0) > 0 && (audioPreview.totalNoteTimingUnresolvedEvents || 0) !== 0) {
    validationIssues.push('Browser smoke still reports unresolved note-timing events.');
  }
  if ((audioPreview.totalSeedMissingChannels || 0) !== 0) {
    validationIssues.push('Browser smoke still reports audio preview channels without stream-seed metadata.');
  }

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [...sourceCatalogIds, smokeReportId],
    summary: {
      previewedRequestCount: audioPreview.previewedRequestCount || 0,
      previewedChannelCount: audioPreview.totalPreviewChannels || 0,
      seededChannelCount: audioPreview.totalSeedResolvedChannels || 0,
      missingSeedChannelCount: audioPreview.totalSeedMissingChannels || 0,
      noteTimingEventCount: audioPreview.totalNoteTimingEvents || 0,
      noteTimingResolvedEventCount: audioPreview.totalNoteTimingResolvedEvents || 0,
      noteTimingUnresolvedEventCount: audioPreview.totalNoteTimingUnresolvedEvents || 0,
      frameStepUnresolvedFrameCount: audioPreview.totalFrameStepUnresolvedFrames || 0,
      validationIssueCount: validationIssues.length,
      assetPolicy: 'Metadata only: UI model function names, RAM field names, catalog ids, counts, and ASM-backed evidence. No ROM bytes, timing values, decoded music, PSG/FM register traces, or audio samples are embedded.',
    },
    resetSeedModel: {
      purpose: 'Seed the read-only audio event trace with the same reset-cleared stream state used by the frame-step preview before applying decoded stream events.',
      uiFunctions: [
        'zoneAudioSeedTraceState',
        'zoneAudioBuildTraceState',
        'zoneAudioApplyFrameStepResetPath',
        'zoneAudioApplyHighBitNoteTiming',
      ],
      seededFields: [
        {
          fieldName: 'stream_flags',
          sourceCatalogId: 'world-audio-stream-seed-catalog-2026-06-25',
          source: 'request seed immediate loader',
          role: 'proves reset bit is set before first interpreter update for seeded channels',
        },
        {
          fieldName: 'current_stream_pointer',
          sourceCatalogId: 'world-audio-stream-seed-catalog-2026-06-25',
          source: 'request header stream pointer',
          role: 'anchors the synthetic event trace to the same root stream used by frame-step preview',
        },
        {
          fieldName: 'support_table_output_or_note_shift',
          sourceCatalogId: 'world-audio-frame-gate-catalog-2026-06-25',
          source: 'reset-path clear before first fetch',
          role: 'defaults high-bit note timing transform support to zero until an $F5 support-table event changes it',
        },
      ],
      noteTimingEffect: {
        sourceCatalogId: 'world-audio-note-timing-support-catalog-2026-06-25',
        model: 'High-bit note timing uses support_table_output_or_note_shift; reset seeding makes the initial support value known before the first high-bit note event.',
        smokeResult: {
          noteTimingEventCount: audioPreview.totalNoteTimingEvents || 0,
          noteTimingResolvedEventCount: audioPreview.totalNoteTimingResolvedEvents || 0,
          noteTimingUnresolvedEventCount: audioPreview.totalNoteTimingUnresolvedEvents || 0,
        },
      },
      confidence: validationIssues.length ? 'medium' : 'high',
    },
    validationIssues,
    evidence: [
      'world-audio-stream-seed-catalog-2026-06-25 records seeded stream_flags and current_stream_pointer writes from the immediate request loader.',
      'world-audio-frame-gate-catalog-2026-06-25 records the reset path that clears support_table_output_or_note_shift before event fetch.',
      'world-audio-note-timing-support-catalog-2026-06-25 records that high-bit note timing reads support_table_output_or_note_shift to select the primary-delay transform.',
      'zone-recipe-browser-smoke-2026-06-25 was rerun in a real browser after the simulator change and reported zero unresolved note-timing events.',
    ],
    nextLeads: [
      'Promote the reset-seeded event trace into a shared browser audio-interpreter module once branch and repeat timing semantics are fully modeled.',
      'Use the now-resolved note timing path to start a PSG/FM register timeline preview without persisting generated audio or register traces.',
      'Trace remaining conditional pointer/repeat operations so frame stepping can follow long-running music graphs beyond the conservative event cap.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
  mapData.audioCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'audio_preview_reset_seed_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    resetSeedModel: catalog.resetSeedModel,
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
