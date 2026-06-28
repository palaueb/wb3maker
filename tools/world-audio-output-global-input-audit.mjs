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
const catalogId = 'world-audio-output-global-input-catalog-2026-06-25';
const reportId = 'audio-output-global-input-audit-2026-06-25';
const toolName = 'tools/world-audio-output-global-input-audit.mjs';

const ramStateCatalogId = 'world-audio-ram-state-catalog-2026-06-25';
const outputRegisterCatalogId = 'world-audio-output-register-catalog-2026-06-25';
const streamParameterConsumerCatalogId = 'world-audio-stream-parameter-consumer-catalog-2026-06-25';
const smokeReportId = 'zone-recipe-browser-smoke-2026-06-25';

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

function findReport(mapData, id) {
  return (mapData.analysisReports || []).find(report => report.id === id) || null;
}

function globalRamByRole(ramCatalog, role) {
  return (ramCatalog.globalRam || []).find(item => item.role === role) || null;
}

function outputPhasesByGlobalRole(outputCatalog, role) {
  return (outputCatalog.outputPhases || [])
    .filter(phase => (phase.fieldRefs || []).some(ref => ref.kind === 'global_ram' && ref.role === role))
    .map(phase => ({
      phaseId: phase.id,
      chip: phase.chip || '',
      routineLabel: phase.routineLabel || '',
      registerFamily: phase.registerFamily || '',
      writeCount: phase.writeCount || (phase.writes || []).length || 0,
      confidence: phase.confidence || '',
      relationships: (phase.fieldRefs || [])
        .filter(ref => ref.kind === 'global_ram' && ref.role === role)
        .map(ref => ref.relationship || '')
        .filter(Boolean),
    }));
}

function volumeMirrorPhaseRefs(parameterCatalog) {
  const consumer = (parameterCatalog.consumers || [])
    .find(item => item.id === 'audio_param_single_volume_to_output_phase') || null;
  return (consumer?.primaryOutputPhases || []).map(phase => ({
    phaseId: phase.phaseId,
    chip: phase.chip || '',
    routineLabel: phase.routineLabel || '',
    writeCount: phase.writeCount || 0,
    confidence: phase.confidence || '',
  }));
}

function countByPhaseRole(catalog, role) {
  return outputPhasesByGlobalRole(catalog, role).reduce((sum, phase) => sum + (phase.writeCount || 0), 0);
}

function buildCatalog(mapData) {
  const ramCatalog = requireCatalog(mapData, ramStateCatalogId);
  const outputCatalog = requireCatalog(mapData, outputRegisterCatalogId);
  const parameterCatalog = requireCatalog(mapData, streamParameterConsumerCatalogId);
  const smokeReport = findReport(mapData, smokeReportId);
  const audioPreview = smokeReport?.summary?.audioPreview || {};
  const validationIssues = [];

  const activeChannel = globalRamByRole(ramCatalog, 'active_audio_channel_index');
  const outputMode = globalRamByRole(ramCatalog, 'audio_output_mode_select');
  const psgBias = globalRamByRole(ramCatalog, 'psg_volume_bias_shared_byte');
  for (const [role, item] of [
    ['active_audio_channel_index', activeChannel],
    ['audio_output_mode_select', outputMode],
    ['psg_volume_bias_shared_byte', psgBias],
  ]) {
    if (!item) validationIssues.push(`Missing global RAM role ${role} in ${ramStateCatalogId}`);
  }
  if (!smokeReport) validationIssues.push(`Missing browser smoke report ${smokeReportId}`);

  const activeChannelPhaseRefs = outputPhasesByGlobalRole(outputCatalog, 'active_audio_channel_index');
  const psgBiasPhaseRefs = outputPhasesByGlobalRole(outputCatalog, 'psg_volume_bias_shared_byte');
  const outputModePhaseRefs = volumeMirrorPhaseRefs(parameterCatalog);

  const globalInputs = [
    {
      role: 'active_audio_channel_index',
      address: activeChannel?.address || '$C220',
      ramCatalogEntryId: activeChannel?.ram?.id || '',
      statusInTimeline: 'known_context',
      modelingStatus: 'resolved_from_channel_context',
      summary: 'The simulator can derive the hardware output channel index from the active stream channel context for output-phase diagnostics.',
      outputPhaseRefs: activeChannelPhaseRefs,
      smokeTimelineRefCount: audioPreview.totalOutputRegisterTimelineActiveChannelContextCount || 0,
      evidence: [
        'world-audio-ram-state-catalog-2026-06-25 identifies $C220 as active_audio_channel_index with high confidence.',
        'world-audio-output-register-catalog-2026-06-25 links output phases to active_audio_channel_index.',
        'zone-recipe-browser-smoke-2026-06-25 verified known-context output timeline references for this role.',
      ],
    },
    {
      role: 'audio_output_mode_select',
      address: outputMode?.address || '$C232',
      ramCatalogEntryId: outputMode?.ram?.id || '',
      statusInTimeline: 'conditional_runtime_global',
      modelingStatus: 'runtime_mode_bit_not_emulated',
      summary: 'Bit 0 selects the note/rest volume mirror path before IY+1 is consumed by volume output phases.',
      outputPhaseRefs: outputModePhaseRefs,
      smokeTimelineRefCount: audioPreview.totalOutputRegisterTimelineAudioOutputModeSelectConditionalCount || 0,
      evidence: [
        'world-audio-ram-state-catalog-2026-06-25 identifies $C232 as audio_output_mode_select with high confidence.',
        'world-audio-stream-parameter-consumer-catalog-2026-06-25 records ASM lines 22072-22102 as the volume mirror consumer path.',
        'zone-recipe-browser-smoke-2026-06-25 verified conditional runtime output timeline references for this role.',
      ],
    },
    {
      role: 'psg_volume_bias_shared_byte',
      address: psgBias?.address || '$C23C',
      ramCatalogEntryId: psgBias?.ram?.id || '',
      statusInTimeline: 'unresolved_runtime_global',
      modelingStatus: 'runtime_bias_value_not_emulated',
      summary: 'The PSG attenuation bias is a runtime byte shared with non-audio code; the analyzer tracks the dependency but does not resolve the value.',
      outputPhaseRefs: psgBiasPhaseRefs,
      smokeTimelineRefCount: audioPreview.totalOutputRegisterTimelinePsgVolumeBiasUnresolvedCount || 0,
      evidence: [
        'world-audio-ram-state-catalog-2026-06-25 identifies $C23C as psg_volume_bias_shared_byte with medium confidence and marks it shared.',
        'world-audio-output-register-catalog-2026-06-25 links PSG volume/envelope output phases to psg_volume_bias_shared_byte.',
        'zone-recipe-browser-smoke-2026-06-25 verified unresolved runtime output timeline references for this role.',
      ],
    },
  ];

  const scheduleGlobalRefCount = audioPreview.totalOutputPhaseScheduleGlobalInputRefCount || 0;
  const timelineGlobalRefCount = audioPreview.totalOutputRegisterTimelineGlobalInputRefCount || 0;
  if (scheduleGlobalRefCount !== timelineGlobalRefCount) {
    validationIssues.push(`Schedule/timeline global input counts differ: ${scheduleGlobalRefCount} vs ${timelineGlobalRefCount}`);
  }
  if ((audioPreview.totalOutputRegisterTimelinePersistedRegisterValueCount || 0) !== 0) {
    validationIssues.push('Browser smoke reported persisted register values in the output timeline.');
  }
  if ((audioPreview.totalOutputRegisterTimelinePersistedSampleCount || 0) !== 0) {
    validationIssues.push('Browser smoke reported persisted samples in the output timeline.');
  }

  const catalog = {
    id: catalogId,
    generatedAt: now,
    tool: toolName,
    sourceCatalogIds: [
      ramStateCatalogId,
      outputRegisterCatalogId,
      streamParameterConsumerCatalogId,
      smokeReportId,
    ],
    assetPolicy: 'metadata_only_no_rom_bytes_no_register_values_no_samples',
    summary: {
      globalInputRoleCount: globalInputs.length,
      outputPhaseGlobalRoleCount: activeChannelPhaseRefs.length + psgBiasPhaseRefs.length,
      volumeMirrorPhaseRefCount: outputModePhaseRefs.length,
      outputPhaseGlobalWriteCount: countByPhaseRole(outputCatalog, 'active_audio_channel_index') +
        countByPhaseRole(outputCatalog, 'psg_volume_bias_shared_byte'),
      smokeTimelineGlobalInputRefCount: timelineGlobalRefCount,
      smokeTimelineKnownGlobalInputCount: audioPreview.totalOutputRegisterTimelineKnownGlobalInputCount || 0,
      smokeTimelineConditionalGlobalInputCount: audioPreview.totalOutputRegisterTimelineConditionalGlobalInputCount || 0,
      smokeTimelineUnresolvedGlobalInputCount: audioPreview.totalOutputRegisterTimelineUnresolvedGlobalInputCount || 0,
      smokeTimelineActiveChannelContextCount: audioPreview.totalOutputRegisterTimelineActiveChannelContextCount || 0,
      smokeTimelineAudioOutputModeSelectConditionalCount: audioPreview.totalOutputRegisterTimelineAudioOutputModeSelectConditionalCount || 0,
      smokeTimelinePsgVolumeBiasUnresolvedCount: audioPreview.totalOutputRegisterTimelinePsgVolumeBiasUnresolvedCount || 0,
      persistedRegisterValueCount: audioPreview.totalOutputRegisterTimelinePersistedRegisterValueCount || 0,
      persistedSampleCount: audioPreview.totalOutputRegisterTimelinePersistedSampleCount || 0,
      validationIssueCount: validationIssues.length,
    },
    globalInputs,
    validationIssues,
    notes: [
      'This catalog records dependency roles and verification counters only.',
      'No PSG/FM register values, audio samples, stream bytes, or ROM bytes are persisted.',
      '$C232 is represented as a note/rest volume-mirror dependency, not as a direct hardware port write dependency.',
    ],
  };

  const report = {
    id: reportId,
    generatedAt: now,
    tool: toolName,
    catalogId,
    summary: catalog.summary,
    evidence: [
      `${ramStateCatalogId} supplies the global RAM roles and addresses.`,
      `${outputRegisterCatalogId} supplies direct output-phase field references for $C220 and $C23C.`,
      `${streamParameterConsumerCatalogId} supplies the $C232 volume-mirror dependency evidence.`,
      `${smokeReportId} supplies browser-verified output timeline counters.`,
    ],
    failures: validationIssues,
    assetPolicy: catalog.assetPolicy,
  };

  return { catalog, report };
}

function main() {
  const mapData = readJson(mapPath);
  const { catalog, report } = buildCatalog(mapData);
  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push(report);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    validationIssues: catalog.validationIssues,
  }, null, 2));
}

main();
