#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const projectName = process.env.WB3_PROJECT || 'WORLD';
const startPort = Number(process.env.WB3_SMOKE_PORT || 8181);
const maxPort = startPort + 30;
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const reportId = 'zone-recipe-browser-smoke-2026-06-25';
const toolName = 'tools/world-zone-recipe-browser-smoke.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isPortFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function findPort() {
  for (let port = startPort; port <= maxPort; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free localhost port found in ${startPort}-${maxPort}`);
}

function startPhpServer(port) {
  const output = [];
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const remember = chunk => {
    const text = String(chunk).trim();
    if (!text) return;
    output.push(text);
    while (output.length > 20) output.shift();
  };
  proc.stdout.on('data', remember);
  proc.stderr.on('data', remember);
  return { proc, output };
}

async function stopPhpServer(proc) {
  if (!proc || proc.exitCode !== null || proc.killed) return;
  proc.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (proc.exitCode === null && !proc.killed) proc.kill('SIGKILL');
  }, 2000);
  try {
    await once(proc, 'exit');
  } catch {
    // The smoke result is already decided; shutdown is best effort.
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer(baseUrl, server) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (server.proc.exitCode !== null) {
      throw new Error(`PHP server exited early with code ${server.proc.exitCode}: ${server.output.join('\n')}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api.php?action=list_projects`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok) return;
      }
    } catch {
      // Server is still starting.
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for PHP server at ${baseUrl}`);
}

function summarizeFailure(error, extra) {
  return JSON.stringify({
    ok: false,
    error: error?.message || String(error),
    ...extra,
  }, null, 2);
}

function summarizeAudioPreviewResults(results) {
  const failures = [];
  let totalPreviewChannels = 0;
  let totalPreviewEvents = 0;
  let totalEventsWithRamRefs = 0;
  let totalRamRefCount = 0;
  let totalEventsWithUnresolvedRefs = 0;
  let maxUnresolvedRefCount = 0;
  let totalEventsWithOutputPhaseLinks = 0;
  let totalDirectOutputPhaseLinkCount = 0;
  let totalEventsWithTraceOps = 0;
  let totalTraceOpCount = 0;
  let totalTraceStateFieldCount = 0;
  let totalTraceKnownFieldCount = 0;
  let totalNoteTimingEvents = 0;
  let totalNoteTimingResolvedEvents = 0;
  let totalNoteTimingUnresolvedEvents = 0;
  let totalParameterMirrorEvents = 0;
  let totalParameterMirrorPitchResolvedEvents = 0;
  let totalParameterMirrorPitchUnresolvedEvents = 0;
  let totalParameterMirrorVolumeConditionalEvents = 0;
  let totalParameterMirrorVolumeUnresolvedEvents = 0;
  let totalParameterOutputReadinessPhaseCount = 0;
  let totalParameterOutputReadinessResolvedInputCount = 0;
  let totalParameterOutputReadinessConditionalInputCount = 0;
  let totalParameterOutputReadinessUnresolvedInputCount = 0;
  let totalOutputPhaseScheduleEventCount = 0;
  let totalOutputPhaseSchedulePhaseCount = 0;
  let totalOutputPhaseScheduleWriteCount = 0;
  let totalOutputPhaseScheduleResolvedInputCount = 0;
  let totalOutputPhaseScheduleConditionalInputCount = 0;
  let totalOutputPhaseSchedulePartialInputCount = 0;
  let totalOutputPhaseScheduleMetadataOnlyCount = 0;
  let totalOutputPhaseSchedulePsgPhaseCount = 0;
  let totalOutputPhaseScheduleFmPhaseCount = 0;
  let totalOutputPhaseScheduleMixedPhaseCount = 0;
  let totalOutputPhaseScheduleGlobalInputRefCount = 0;
  let totalOutputPhaseScheduleKnownGlobalInputCount = 0;
  let totalOutputPhaseScheduleConditionalGlobalInputCount = 0;
  let totalOutputPhaseScheduleUnresolvedGlobalInputCount = 0;
  let totalOutputPhaseScheduleGlobalFlowCatalogBackedCount = 0;
  let totalOutputPhaseScheduleActiveChannelContextCount = 0;
  let totalOutputPhaseScheduleAudioOutputModeSelectConditionalCount = 0;
  let totalOutputPhaseSchedulePsgVolumeBiasUnresolvedCount = 0;
  let totalOutputPhaseScheduleModeBranchCandidateCount = 0;
  let totalOutputPhaseSchedulePsgModeBranchCandidateCount = 0;
  let totalOutputPhaseScheduleFmModeBranchCandidateCount = 0;
  let totalOutputPhaseScheduleModeIndependentCandidateCount = 0;
  let totalOutputRegisterTimelineEventCount = 0;
  let totalOutputRegisterTimelineEntryCount = 0;
  let totalOutputRegisterTimelineFrameLinkedEntryCount = 0;
  let totalOutputRegisterTimelineFrameUnlinkedEntryCount = 0;
  let totalOutputRegisterTimelineWriteCount = 0;
  let totalOutputRegisterTimelinePsgEntryCount = 0;
  let totalOutputRegisterTimelineFmEntryCount = 0;
  let totalOutputRegisterTimelineMixedEntryCount = 0;
  let totalOutputRegisterTimelineResolvedInputCount = 0;
  let totalOutputRegisterTimelineConditionalInputCount = 0;
  let totalOutputRegisterTimelinePartialInputCount = 0;
  let totalOutputRegisterTimelineMetadataOnlyCount = 0;
  let totalOutputRegisterTimelineGlobalInputRefCount = 0;
  let totalOutputRegisterTimelineKnownGlobalInputCount = 0;
  let totalOutputRegisterTimelineConditionalGlobalInputCount = 0;
  let totalOutputRegisterTimelineUnresolvedGlobalInputCount = 0;
  let totalOutputRegisterTimelineGlobalFlowCatalogBackedCount = 0;
  let totalOutputRegisterTimelineActiveChannelContextCount = 0;
  let totalOutputRegisterTimelineAudioOutputModeSelectConditionalCount = 0;
  let totalOutputRegisterTimelinePsgVolumeBiasUnresolvedCount = 0;
  let totalOutputRegisterTimelineModeBranchCandidateCount = 0;
  let totalOutputRegisterTimelinePsgModeBranchCandidateCount = 0;
  let totalOutputRegisterTimelineFmModeBranchCandidateCount = 0;
  let totalOutputRegisterTimelineModeIndependentCandidateCount = 0;
  let totalOutputRegisterTimelinePsgModeAlternativeEntryCount = 0;
  let totalOutputRegisterTimelinePsgModeAlternativeWriteCount = 0;
  let totalOutputRegisterTimelineFmModeAlternativeEntryCount = 0;
  let totalOutputRegisterTimelineFmModeAlternativeWriteCount = 0;
  let totalOutputRegisterTimelineFilteredEntryCount = 0;
  let totalOutputRegisterTimelineFilteredWriteCount = 0;
  let totalOutputRegisterTimelineFilteredDroppedEntryCount = 0;
  let totalOutputRegisterTimelineFilteredDroppedWriteCount = 0;
  let totalOutputRegisterTimelinePsgSelectedFilteredEntryCount = 0;
  let totalOutputRegisterTimelinePsgSelectedFilteredWriteCount = 0;
  let totalOutputRegisterTimelinePsgSelectedDroppedEntryCount = 0;
  let totalOutputRegisterTimelineFmSelectedFilteredEntryCount = 0;
  let totalOutputRegisterTimelineFmSelectedFilteredWriteCount = 0;
  let totalOutputRegisterTimelineFmSelectedDroppedEntryCount = 0;
  let totalOutputRegisterTimelinePersistedRegisterValueCount = 0;
  let totalOutputRegisterTimelinePersistedSampleCount = 0;
  let totalFrameStepFrames = 0;
  let totalFrameStepEventFrames = 0;
  let totalFrameStepUnresolvedFrames = 0;
  let totalSeedResolvedChannels = 0;
  let totalSeedMissingChannels = 0;
  let maxFrameStepUnresolvedFrames = 0;
  const requestIds = [];

  for (const result of results) {
    if (result.error) failures.push(`${result.requestIdHex || result.recipeId || result.index}: ${result.error}`);
    const metrics = result.metrics || {};
    requestIds.push(result.requestIdHex || '');
    totalPreviewChannels += metrics.previewChannels || 0;
    totalPreviewEvents += metrics.previewEvents || 0;
    totalEventsWithRamRefs += metrics.eventsWithRamRefs || 0;
    totalRamRefCount += metrics.ramRefCount || 0;
    totalEventsWithUnresolvedRefs += metrics.eventsWithUnresolvedRefs || 0;
    maxUnresolvedRefCount = Math.max(maxUnresolvedRefCount, metrics.unresolvedRefCount || 0);
    totalEventsWithOutputPhaseLinks += metrics.eventsWithOutputPhaseLinks || 0;
    totalDirectOutputPhaseLinkCount += metrics.directOutputPhaseLinkCount || 0;
    totalEventsWithTraceOps += metrics.eventsWithTraceOps || 0;
    totalTraceOpCount += metrics.traceOpCount || 0;
    totalTraceStateFieldCount += metrics.traceStateFieldCount || 0;
    totalTraceKnownFieldCount += metrics.traceKnownFieldCount || 0;
    totalNoteTimingEvents += metrics.noteTimingEvents || 0;
    totalNoteTimingResolvedEvents += metrics.noteTimingResolvedEvents || 0;
    totalNoteTimingUnresolvedEvents += metrics.noteTimingUnresolvedEvents || 0;
    totalParameterMirrorEvents += metrics.parameterMirrorEvents || 0;
    totalParameterMirrorPitchResolvedEvents += metrics.parameterMirrorPitchResolvedEvents || 0;
    totalParameterMirrorPitchUnresolvedEvents += metrics.parameterMirrorPitchUnresolvedEvents || 0;
    totalParameterMirrorVolumeConditionalEvents += metrics.parameterMirrorVolumeConditionalEvents || 0;
    totalParameterMirrorVolumeUnresolvedEvents += metrics.parameterMirrorVolumeUnresolvedEvents || 0;
    totalParameterOutputReadinessPhaseCount += metrics.parameterOutputReadinessPhaseCount || 0;
    totalParameterOutputReadinessResolvedInputCount += metrics.parameterOutputReadinessResolvedInputCount || 0;
    totalParameterOutputReadinessConditionalInputCount += metrics.parameterOutputReadinessConditionalInputCount || 0;
    totalParameterOutputReadinessUnresolvedInputCount += metrics.parameterOutputReadinessUnresolvedInputCount || 0;
    totalOutputPhaseScheduleEventCount += metrics.outputPhaseScheduleEventCount || 0;
    totalOutputPhaseSchedulePhaseCount += metrics.outputPhaseSchedulePhaseCount || 0;
    totalOutputPhaseScheduleWriteCount += metrics.outputPhaseScheduleWriteCount || 0;
    totalOutputPhaseScheduleResolvedInputCount += metrics.outputPhaseScheduleResolvedInputCount || 0;
    totalOutputPhaseScheduleConditionalInputCount += metrics.outputPhaseScheduleConditionalInputCount || 0;
    totalOutputPhaseSchedulePartialInputCount += metrics.outputPhaseSchedulePartialInputCount || 0;
    totalOutputPhaseScheduleMetadataOnlyCount += metrics.outputPhaseScheduleMetadataOnlyCount || 0;
    totalOutputPhaseSchedulePsgPhaseCount += metrics.outputPhaseSchedulePsgPhaseCount || 0;
    totalOutputPhaseScheduleFmPhaseCount += metrics.outputPhaseScheduleFmPhaseCount || 0;
    totalOutputPhaseScheduleMixedPhaseCount += metrics.outputPhaseScheduleMixedPhaseCount || 0;
    totalOutputPhaseScheduleGlobalInputRefCount += metrics.outputPhaseScheduleGlobalInputRefCount || 0;
    totalOutputPhaseScheduleKnownGlobalInputCount += metrics.outputPhaseScheduleKnownGlobalInputCount || 0;
    totalOutputPhaseScheduleConditionalGlobalInputCount += metrics.outputPhaseScheduleConditionalGlobalInputCount || 0;
    totalOutputPhaseScheduleUnresolvedGlobalInputCount += metrics.outputPhaseScheduleUnresolvedGlobalInputCount || 0;
    totalOutputPhaseScheduleGlobalFlowCatalogBackedCount += metrics.outputPhaseScheduleGlobalFlowCatalogBackedCount || 0;
    totalOutputPhaseScheduleActiveChannelContextCount += metrics.outputPhaseScheduleActiveChannelContextCount || 0;
    totalOutputPhaseScheduleAudioOutputModeSelectConditionalCount += metrics.outputPhaseScheduleAudioOutputModeSelectConditionalCount || 0;
    totalOutputPhaseSchedulePsgVolumeBiasUnresolvedCount += metrics.outputPhaseSchedulePsgVolumeBiasUnresolvedCount || 0;
    totalOutputPhaseScheduleModeBranchCandidateCount += metrics.outputPhaseScheduleModeBranchCandidateCount || 0;
    totalOutputPhaseSchedulePsgModeBranchCandidateCount += metrics.outputPhaseSchedulePsgModeBranchCandidateCount || 0;
    totalOutputPhaseScheduleFmModeBranchCandidateCount += metrics.outputPhaseScheduleFmModeBranchCandidateCount || 0;
    totalOutputPhaseScheduleModeIndependentCandidateCount += metrics.outputPhaseScheduleModeIndependentCandidateCount || 0;
    totalOutputRegisterTimelineEventCount += metrics.outputRegisterTimelineEventCount || 0;
    totalOutputRegisterTimelineEntryCount += metrics.outputRegisterTimelineEntryCount || 0;
    totalOutputRegisterTimelineFrameLinkedEntryCount += metrics.outputRegisterTimelineFrameLinkedEntryCount || 0;
    totalOutputRegisterTimelineFrameUnlinkedEntryCount += metrics.outputRegisterTimelineFrameUnlinkedEntryCount || 0;
    totalOutputRegisterTimelineWriteCount += metrics.outputRegisterTimelineWriteCount || 0;
    totalOutputRegisterTimelinePsgEntryCount += metrics.outputRegisterTimelinePsgEntryCount || 0;
    totalOutputRegisterTimelineFmEntryCount += metrics.outputRegisterTimelineFmEntryCount || 0;
    totalOutputRegisterTimelineMixedEntryCount += metrics.outputRegisterTimelineMixedEntryCount || 0;
    totalOutputRegisterTimelineResolvedInputCount += metrics.outputRegisterTimelineResolvedInputCount || 0;
    totalOutputRegisterTimelineConditionalInputCount += metrics.outputRegisterTimelineConditionalInputCount || 0;
    totalOutputRegisterTimelinePartialInputCount += metrics.outputRegisterTimelinePartialInputCount || 0;
    totalOutputRegisterTimelineMetadataOnlyCount += metrics.outputRegisterTimelineMetadataOnlyCount || 0;
    totalOutputRegisterTimelineGlobalInputRefCount += metrics.outputRegisterTimelineGlobalInputRefCount || 0;
    totalOutputRegisterTimelineKnownGlobalInputCount += metrics.outputRegisterTimelineKnownGlobalInputCount || 0;
    totalOutputRegisterTimelineConditionalGlobalInputCount += metrics.outputRegisterTimelineConditionalGlobalInputCount || 0;
    totalOutputRegisterTimelineUnresolvedGlobalInputCount += metrics.outputRegisterTimelineUnresolvedGlobalInputCount || 0;
    totalOutputRegisterTimelineGlobalFlowCatalogBackedCount += metrics.outputRegisterTimelineGlobalFlowCatalogBackedCount || 0;
    totalOutputRegisterTimelineActiveChannelContextCount += metrics.outputRegisterTimelineActiveChannelContextCount || 0;
    totalOutputRegisterTimelineAudioOutputModeSelectConditionalCount += metrics.outputRegisterTimelineAudioOutputModeSelectConditionalCount || 0;
    totalOutputRegisterTimelinePsgVolumeBiasUnresolvedCount += metrics.outputRegisterTimelinePsgVolumeBiasUnresolvedCount || 0;
    totalOutputRegisterTimelineModeBranchCandidateCount += metrics.outputRegisterTimelineModeBranchCandidateCount || 0;
    totalOutputRegisterTimelinePsgModeBranchCandidateCount += metrics.outputRegisterTimelinePsgModeBranchCandidateCount || 0;
    totalOutputRegisterTimelineFmModeBranchCandidateCount += metrics.outputRegisterTimelineFmModeBranchCandidateCount || 0;
    totalOutputRegisterTimelineModeIndependentCandidateCount += metrics.outputRegisterTimelineModeIndependentCandidateCount || 0;
    totalOutputRegisterTimelinePsgModeAlternativeEntryCount += metrics.outputRegisterTimelinePsgModeAlternativeEntryCount || 0;
    totalOutputRegisterTimelinePsgModeAlternativeWriteCount += metrics.outputRegisterTimelinePsgModeAlternativeWriteCount || 0;
    totalOutputRegisterTimelineFmModeAlternativeEntryCount += metrics.outputRegisterTimelineFmModeAlternativeEntryCount || 0;
    totalOutputRegisterTimelineFmModeAlternativeWriteCount += metrics.outputRegisterTimelineFmModeAlternativeWriteCount || 0;
    totalOutputRegisterTimelineFilteredEntryCount += metrics.outputRegisterTimelineFilteredEntryCount || 0;
    totalOutputRegisterTimelineFilteredWriteCount += metrics.outputRegisterTimelineFilteredWriteCount || 0;
    totalOutputRegisterTimelineFilteredDroppedEntryCount += metrics.outputRegisterTimelineFilteredDroppedEntryCount || 0;
    totalOutputRegisterTimelineFilteredDroppedWriteCount += metrics.outputRegisterTimelineFilteredDroppedWriteCount || 0;
    totalOutputRegisterTimelinePsgSelectedFilteredEntryCount += metrics.outputRegisterTimelinePsgSelectedFilteredEntryCount || 0;
    totalOutputRegisterTimelinePsgSelectedFilteredWriteCount += metrics.outputRegisterTimelinePsgSelectedFilteredWriteCount || 0;
    totalOutputRegisterTimelinePsgSelectedDroppedEntryCount += metrics.outputRegisterTimelinePsgSelectedDroppedEntryCount || 0;
    totalOutputRegisterTimelineFmSelectedFilteredEntryCount += metrics.outputRegisterTimelineFmSelectedFilteredEntryCount || 0;
    totalOutputRegisterTimelineFmSelectedFilteredWriteCount += metrics.outputRegisterTimelineFmSelectedFilteredWriteCount || 0;
    totalOutputRegisterTimelineFmSelectedDroppedEntryCount += metrics.outputRegisterTimelineFmSelectedDroppedEntryCount || 0;
    totalOutputRegisterTimelinePersistedRegisterValueCount += metrics.outputRegisterTimelinePersistedRegisterValueCount || 0;
    totalOutputRegisterTimelinePersistedSampleCount += metrics.outputRegisterTimelinePersistedSampleCount || 0;
    totalFrameStepFrames += metrics.frameStepFrames || 0;
    totalFrameStepEventFrames += metrics.frameStepEventFrames || 0;
    totalFrameStepUnresolvedFrames += metrics.frameStepUnresolvedFrames || 0;
    totalSeedResolvedChannels += metrics.seedResolvedChannels || 0;
    totalSeedMissingChannels += metrics.seedMissingChannels || 0;
    maxFrameStepUnresolvedFrames = Math.max(maxFrameStepUnresolvedFrames, metrics.frameStepUnresolvedFrames || 0);
    if (!(metrics.previewChannels > 0)) failures.push(`${result.requestIdHex || result.recipeId}: audio preview produced no channels`);
    if (!(metrics.previewEvents > 0)) failures.push(`${result.requestIdHex || result.recipeId}: audio preview produced no events`);
    if (metrics.unresolvedRefCount > 0) failures.push(`${result.requestIdHex || result.recipeId}: ${metrics.unresolvedRefCount} unresolved RAM ref(s)`);
    if (metrics.outputRegisterTimelinePersistedRegisterValueCount !== 0) failures.push(`${result.requestIdHex || result.recipeId}: output timeline reported persisted register values`);
    if (metrics.outputRegisterTimelinePersistedSampleCount !== 0) failures.push(`${result.requestIdHex || result.recipeId}: output timeline reported persisted samples`);
    if (metrics.outputRegisterTimelineAssetPolicy !== 'metadata_only_no_register_values_or_samples') failures.push(`${result.requestIdHex || result.recipeId}: output timeline metadata-only policy was not reported`);
    if (metrics.outputRegisterTimelineModeFilterError) failures.push(`${result.requestIdHex || result.recipeId}: ${metrics.outputRegisterTimelineModeFilterError}`);
    if (metrics.outputModeFilter !== 'all') failures.push(`${result.requestIdHex || result.recipeId}: default output mode filter was ${metrics.outputModeFilter || 'missing'}, expected all`);
    if (metrics.outputRegisterTimelineFilteredEntryCount !== metrics.outputRegisterTimelineEntryCount) failures.push(`${result.requestIdHex || result.recipeId}: all-mode filtered entries did not match total timeline entries`);
    if (metrics.outputRegisterTimelineFilteredWriteCount !== metrics.outputRegisterTimelineWriteCount) failures.push(`${result.requestIdHex || result.recipeId}: all-mode filtered writes did not match total timeline writes`);
    if (metrics.outputRegisterTimelineFilteredDroppedEntryCount !== 0) failures.push(`${result.requestIdHex || result.recipeId}: all-mode filter dropped entries`);
    if (metrics.outputRegisterTimelinePsgSelectedOutputModeFilter !== 'psg') failures.push(`${result.requestIdHex || result.recipeId}: PSG selected output mode filter was not reported`);
    if (metrics.outputRegisterTimelineFmSelectedOutputModeFilter !== 'fm') failures.push(`${result.requestIdHex || result.recipeId}: FM selected output mode filter was not reported`);
    if (metrics.outputRegisterTimelinePsgSelectedFilteredEntryCount !== metrics.outputRegisterTimelinePsgModeAlternativeEntryCount) failures.push(`${result.requestIdHex || result.recipeId}: PSG selected entry count did not match PSG branch alternative count`);
    if (metrics.outputRegisterTimelineFmSelectedFilteredEntryCount !== metrics.outputRegisterTimelineFmModeAlternativeEntryCount) failures.push(`${result.requestIdHex || result.recipeId}: FM selected entry count did not match FM branch alternative count`);
  }

  if (!results.length) failures.push('No unique zone audio requests were available to preview.');
  if (results.length && totalParameterMirrorEvents === 0) {
    failures.push('Audio preview produced no note/rest parameter mirror events across all requests.');
  }
  if (results.length && totalParameterOutputReadinessPhaseCount === 0) {
    failures.push('Audio preview produced no parameter output-readiness phase links across all requests.');
  }
  if (results.length && totalOutputPhaseSchedulePhaseCount === 0) {
    failures.push('Audio preview produced no output-phase schedule candidates across all requests.');
  }
  if (results.length && totalOutputRegisterTimelineEntryCount === 0) {
    failures.push('Audio preview produced no output register timeline skeleton entries across all requests.');
  }
  if (totalOutputRegisterTimelineEntryCount !== totalOutputPhaseSchedulePhaseCount) {
    failures.push(`Audio preview output timeline expected ${totalOutputPhaseSchedulePhaseCount} entries from schedule candidates, got ${totalOutputRegisterTimelineEntryCount}.`);
  }
  if (totalOutputRegisterTimelineWriteCount !== totalOutputPhaseScheduleWriteCount) {
    failures.push(`Audio preview output timeline expected ${totalOutputPhaseScheduleWriteCount} catalog write(s), got ${totalOutputRegisterTimelineWriteCount}.`);
  }
  if (results.length && totalOutputRegisterTimelineGlobalInputRefCount === 0) {
    failures.push('Audio preview output timeline produced no global input references.');
  }
  if (results.length && totalOutputRegisterTimelineKnownGlobalInputCount === 0) {
    failures.push('Audio preview output timeline did not resolve any global inputs from channel context.');
  }
  if (results.length && totalOutputRegisterTimelineConditionalGlobalInputCount === 0) {
    failures.push('Audio preview output timeline did not report any conditional runtime globals.');
  }
  if (results.length && totalOutputRegisterTimelineUnresolvedGlobalInputCount === 0) {
    failures.push('Audio preview output timeline did not report any unresolved runtime globals.');
  }
  if (results.length && totalOutputRegisterTimelineGlobalFlowCatalogBackedCount === 0) {
    failures.push('Audio preview output timeline did not attach the runtime-global flow catalog to any global input references.');
  }
  if (results.length && totalOutputRegisterTimelineActiveChannelContextCount === 0) {
    failures.push('Audio preview output timeline did not report active channel context globals.');
  }
  if (results.length && totalOutputRegisterTimelineAudioOutputModeSelectConditionalCount === 0) {
    failures.push('Audio preview output timeline did not report _RAM_C232_ audio-output mode dependencies.');
  }
  if (results.length && totalOutputRegisterTimelinePsgVolumeBiasUnresolvedCount === 0) {
    failures.push('Audio preview output timeline did not report _RAM_C23C_ PSG volume-bias dependencies.');
  }
  if (results.length && totalOutputRegisterTimelineModeBranchCandidateCount === 0) {
    failures.push('Audio preview output timeline produced no $C232 mode branch candidates.');
  }
  if (results.length && totalOutputRegisterTimelinePsgModeBranchCandidateCount === 0) {
    failures.push('Audio preview output timeline produced no PSG branch candidates.');
  }
  if (results.length && totalOutputRegisterTimelineFmModeBranchCandidateCount === 0) {
    failures.push('Audio preview output timeline produced no FM branch candidates.');
  }
  if (results.length && totalOutputRegisterTimelinePsgModeAlternativeEntryCount === 0) {
    failures.push('Audio preview output timeline produced no PSG-mode filtered alternative entries.');
  }
  if (results.length && totalOutputRegisterTimelineFmModeAlternativeEntryCount === 0) {
    failures.push('Audio preview output timeline produced no FM-mode filtered alternative entries.');
  }
  if (results.length && totalOutputRegisterTimelinePsgSelectedFilteredEntryCount === 0) {
    failures.push('Audio preview selected PSG output mode produced no filtered timeline entries.');
  }
  if (results.length && totalOutputRegisterTimelineFmSelectedFilteredEntryCount === 0) {
    failures.push('Audio preview selected FM output mode produced no filtered timeline entries.');
  }
  if (totalOutputRegisterTimelineFilteredEntryCount !== totalOutputRegisterTimelineEntryCount) {
    failures.push('Audio preview default all-mode filtered entry total did not match the timeline entry total.');
  }
  if (totalOutputRegisterTimelinePsgSelectedFilteredEntryCount !== totalOutputRegisterTimelinePsgModeAlternativeEntryCount) {
    failures.push('Audio preview selected PSG filtered entry total did not match the PSG alternative total.');
  }
  if (totalOutputRegisterTimelineFmSelectedFilteredEntryCount !== totalOutputRegisterTimelineFmModeAlternativeEntryCount) {
    failures.push('Audio preview selected FM filtered entry total did not match the FM alternative total.');
  }
  if (totalOutputRegisterTimelinePsgModeAlternativeEntryCount + totalOutputRegisterTimelineFmModeAlternativeEntryCount !==
      totalOutputRegisterTimelineModeBranchCandidateCount + totalOutputRegisterTimelineModeIndependentCandidateCount) {
    failures.push('Audio preview mode-filtered entry totals did not match the branch-candidate totals.');
  }
  if (totalOutputRegisterTimelinePersistedRegisterValueCount !== 0) {
    failures.push('Audio preview output timeline persisted register values.');
  }
  if (totalOutputRegisterTimelinePersistedSampleCount !== 0) {
    failures.push('Audio preview output timeline persisted audio samples.');
  }

  return {
    summary: {
      previewedRequestCount: results.length,
      requestIds: requestIds.filter(Boolean),
      totalPreviewChannels,
      totalPreviewEvents,
      totalEventsWithRamRefs,
      totalRamRefCount,
      totalEventsWithUnresolvedRefs,
      maxUnresolvedRefCount,
      totalEventsWithOutputPhaseLinks,
      totalDirectOutputPhaseLinkCount,
      totalEventsWithTraceOps,
      totalTraceOpCount,
      totalTraceStateFieldCount,
      totalTraceKnownFieldCount,
      totalNoteTimingEvents,
      totalNoteTimingResolvedEvents,
      totalNoteTimingUnresolvedEvents,
      totalParameterMirrorEvents,
      totalParameterMirrorPitchResolvedEvents,
      totalParameterMirrorPitchUnresolvedEvents,
      totalParameterMirrorVolumeConditionalEvents,
      totalParameterMirrorVolumeUnresolvedEvents,
      totalParameterOutputReadinessPhaseCount,
      totalParameterOutputReadinessResolvedInputCount,
      totalParameterOutputReadinessConditionalInputCount,
      totalParameterOutputReadinessUnresolvedInputCount,
      totalOutputPhaseScheduleEventCount,
      totalOutputPhaseSchedulePhaseCount,
      totalOutputPhaseScheduleWriteCount,
      totalOutputPhaseScheduleResolvedInputCount,
      totalOutputPhaseScheduleConditionalInputCount,
      totalOutputPhaseSchedulePartialInputCount,
      totalOutputPhaseScheduleMetadataOnlyCount,
      totalOutputPhaseSchedulePsgPhaseCount,
      totalOutputPhaseScheduleFmPhaseCount,
      totalOutputPhaseScheduleMixedPhaseCount,
      totalOutputPhaseScheduleGlobalInputRefCount,
      totalOutputPhaseScheduleKnownGlobalInputCount,
      totalOutputPhaseScheduleConditionalGlobalInputCount,
      totalOutputPhaseScheduleUnresolvedGlobalInputCount,
      totalOutputPhaseScheduleGlobalFlowCatalogBackedCount,
      totalOutputPhaseScheduleActiveChannelContextCount,
      totalOutputPhaseScheduleAudioOutputModeSelectConditionalCount,
      totalOutputPhaseSchedulePsgVolumeBiasUnresolvedCount,
      totalOutputPhaseScheduleModeBranchCandidateCount,
      totalOutputPhaseSchedulePsgModeBranchCandidateCount,
      totalOutputPhaseScheduleFmModeBranchCandidateCount,
      totalOutputPhaseScheduleModeIndependentCandidateCount,
      totalOutputRegisterTimelineEventCount,
      totalOutputRegisterTimelineEntryCount,
      totalOutputRegisterTimelineFrameLinkedEntryCount,
      totalOutputRegisterTimelineFrameUnlinkedEntryCount,
      totalOutputRegisterTimelineWriteCount,
      totalOutputRegisterTimelinePsgEntryCount,
      totalOutputRegisterTimelineFmEntryCount,
      totalOutputRegisterTimelineMixedEntryCount,
      totalOutputRegisterTimelineResolvedInputCount,
      totalOutputRegisterTimelineConditionalInputCount,
      totalOutputRegisterTimelinePartialInputCount,
      totalOutputRegisterTimelineMetadataOnlyCount,
      totalOutputRegisterTimelineGlobalInputRefCount,
      totalOutputRegisterTimelineKnownGlobalInputCount,
      totalOutputRegisterTimelineConditionalGlobalInputCount,
      totalOutputRegisterTimelineUnresolvedGlobalInputCount,
      totalOutputRegisterTimelineGlobalFlowCatalogBackedCount,
      totalOutputRegisterTimelineActiveChannelContextCount,
      totalOutputRegisterTimelineAudioOutputModeSelectConditionalCount,
      totalOutputRegisterTimelinePsgVolumeBiasUnresolvedCount,
      totalOutputRegisterTimelineModeBranchCandidateCount,
      totalOutputRegisterTimelinePsgModeBranchCandidateCount,
      totalOutputRegisterTimelineFmModeBranchCandidateCount,
      totalOutputRegisterTimelineModeIndependentCandidateCount,
      totalOutputRegisterTimelinePsgModeAlternativeEntryCount,
      totalOutputRegisterTimelinePsgModeAlternativeWriteCount,
      totalOutputRegisterTimelineFmModeAlternativeEntryCount,
      totalOutputRegisterTimelineFmModeAlternativeWriteCount,
      totalOutputRegisterTimelineFilteredEntryCount,
      totalOutputRegisterTimelineFilteredWriteCount,
      totalOutputRegisterTimelineFilteredDroppedEntryCount,
      totalOutputRegisterTimelineFilteredDroppedWriteCount,
      totalOutputRegisterTimelinePsgSelectedFilteredEntryCount,
      totalOutputRegisterTimelinePsgSelectedFilteredWriteCount,
      totalOutputRegisterTimelinePsgSelectedDroppedEntryCount,
      totalOutputRegisterTimelineFmSelectedFilteredEntryCount,
      totalOutputRegisterTimelineFmSelectedFilteredWriteCount,
      totalOutputRegisterTimelineFmSelectedDroppedEntryCount,
      totalOutputRegisterTimelinePersistedRegisterValueCount,
      totalOutputRegisterTimelinePersistedSampleCount,
      outputRegisterTimelineAssetPolicy: 'metadata_only_no_register_values_or_samples',
      totalFrameStepFrames,
      totalFrameStepEventFrames,
      totalFrameStepUnresolvedFrames,
      maxFrameStepUnresolvedFrames,
      totalSeedResolvedChannels,
      totalSeedMissingChannels,
    },
    failures,
  };
}

function summarizeAudioRequestGraphPreviewResult(result) {
  const failures = [];
  if (!result) {
    failures.push('audio request graph preview did not run');
    return {
      summary: {
        ran: false,
        catalogBacked: false,
        requestCount: 0,
        graphCount: 0,
      },
      failures,
    };
  }
  if (result.error) failures.push(`audio request graph preview: ${result.error}`);
  if (!result.catalogBacked) failures.push('audio request graph preview: required catalogs were not linked');
  if (!result.previewOk) failures.push('audio request graph preview: preview reported warnings');
  if (result.requestCount !== 62) failures.push(`audio request graph preview: expected 62 requests, got ${result.requestCount}`);
  if (result.graphCount !== 62) failures.push(`audio request graph preview: expected 62 stream graphs, got ${result.graphCount}`);
  if (result.missingGraphCount !== 0) failures.push(`audio request graph preview: expected 0 missing request graphs, got ${result.missingGraphCount}`);
  if (result.missingTargetCount !== 0) failures.push(`audio request graph preview: expected 0 missing graph targets, got ${result.missingTargetCount}`);
  if (result.uniqueStreamCount !== 224) failures.push(`audio request graph preview: expected 224 unique reachable streams, got ${result.uniqueStreamCount}`);
  if (result.branchingRequestCount !== 25) failures.push(`audio request graph preview: expected 25 branching request graphs, got ${result.branchingRequestCount}`);
  if (result.branchEdgeCount !== 365) failures.push(`audio request graph preview: expected 365 branch edges, got ${result.branchEdgeCount}`);
  if (result.zoneLinkedRequestCount !== 11) failures.push(`audio request graph preview: expected 11 zone-linked requests, got ${result.zoneLinkedRequestCount}`);
  if (result.zoneMissingGraphRecipeCount !== 0) failures.push(`audio request graph preview: expected 0 missing zone graph recipes, got ${result.zoneMissingGraphRecipeCount}`);
  if (result.seedRequestCount !== 62) failures.push(`audio request graph preview: expected 62 seeded requests, got ${result.seedRequestCount}`);
  if (result.seedChannelCount !== 148) failures.push(`audio request graph preview: expected 148 seeded channels, got ${result.seedChannelCount}`);
  if (result.missingSeedRequestCount !== 0) failures.push(`audio request graph preview: expected 0 missing seed requests, got ${result.missingSeedRequestCount}`);
  if (result.seedValidationIssueCount !== 0) failures.push(`audio request graph preview: seed catalog has ${result.seedValidationIssueCount} validation issue(s)`);
  if (result.frameStepValidationIssueCount !== 0) failures.push(`audio request graph preview: frame-step catalog has ${result.frameStepValidationIssueCount} validation issue(s)`);
  if (result.frameStepMaxFramesPerChannel !== 16) failures.push(`audio request graph preview: expected 16 max frames per channel, got ${result.frameStepMaxFramesPerChannel}`);
  if (result.traceOperationCount !== 48) failures.push(`audio request graph preview: expected 48 trace operations, got ${result.traceOperationCount}`);
  if (result.outputPhaseCount !== 14) failures.push(`audio request graph preview: expected 14 output phases, got ${result.outputPhaseCount}`);
  if (result.psgPhaseCount !== 6) failures.push(`audio request graph preview: expected 6 PSG phases, got ${result.psgPhaseCount}`);
  if (result.fmPhaseCount !== 7) failures.push(`audio request graph preview: expected 7 FM phases, got ${result.fmPhaseCount}`);
  if (result.outputWriteCount !== 39) failures.push(`audio request graph preview: expected 39 output writes, got ${result.outputWriteCount}`);
  if (result.eventOutputLinkedKindCount !== 2) failures.push(`audio request graph preview: expected 2 directly output-linked event kinds, got ${result.eventOutputLinkedKindCount}`);
  if (result.eventOutputDirectPhaseLinkCount !== 7) failures.push(`audio request graph preview: expected 7 direct output phase links, got ${result.eventOutputDirectPhaseLinkCount}`);
  if (result.parameterOutputConsumerGapCount !== 4) failures.push(`audio request graph preview: expected 4 parameter output-consumer gaps, got ${result.parameterOutputConsumerGapCount}`);
  if (result.controlFlowOnlyUnlinkedEventCount !== 10) failures.push(`audio request graph preview: expected 10 control-flow-only unlinked events, got ${result.controlFlowOnlyUnlinkedEventCount}`);
  if (result.indirectSupportLookupReadyEventCount !== 1) failures.push(`audio request graph preview: expected 1 indirect support lookup event, got ${result.indirectSupportLookupReadyEventCount}`);
  if (result.indirectParameterConsumerLinkCount !== 4) failures.push(`audio request graph preview: expected 4 indirect parameter consumer links, got ${result.indirectParameterConsumerLinkCount}`);
  if (result.indirectParameterPrimaryOutputPhaseCount !== 6) failures.push(`audio request graph preview: expected 6 indirect parameter primary output phases, got ${result.indirectParameterPrimaryOutputPhaseCount}`);
  if (result.indirectParameterValidationIssueCount !== 0) failures.push(`audio request graph preview: parameter consumer catalog has ${result.indirectParameterValidationIssueCount} validation issue(s)`);
  if (result.resetPreviewedRequestCount !== 11) failures.push(`audio request graph preview: expected 11 reset-seed previewed requests, got ${result.resetPreviewedRequestCount}`);
  if (result.resetFrameStepUnresolvedFrameCount !== 0) failures.push(`audio request graph preview: expected 0 reset frame-step unresolved frames, got ${result.resetFrameStepUnresolvedFrameCount}`);
  if (result.persistedStreamByteCount !== 0) failures.push('audio request graph preview: stream bytes were reported as persisted');
  if (result.persistedRegisterTraceCount !== 0) failures.push('audio request graph preview: register traces were reported as persisted');
  if (result.persistedSampleCount !== 0) failures.push('audio request graph preview: samples were reported as persisted');
  if (result.assetPolicy !== 'metadata_only_no_stream_bytes_or_register_traces') failures.push('audio request graph preview: metadata-only audio policy was not reported');
  return {
    summary: {
      ran: true,
      catalogBacked: Boolean(result.catalogBacked),
      requestCount: result.requestCount || 0,
      graphCount: result.graphCount || 0,
      missingGraphCount: result.missingGraphCount || 0,
      missingTargetCount: result.missingTargetCount || 0,
      uniqueStreamCount: result.uniqueStreamCount || 0,
      branchingRequestCount: result.branchingRequestCount || 0,
      branchEdgeCount: result.branchEdgeCount || 0,
      zoneLinkedRequestCount: result.zoneLinkedRequestCount || 0,
      seedRequestCount: result.seedRequestCount || 0,
      seedChannelCount: result.seedChannelCount || 0,
      outputPhaseCount: result.outputPhaseCount || 0,
      psgPhaseCount: result.psgPhaseCount || 0,
      fmPhaseCount: result.fmPhaseCount || 0,
      outputWriteCount: result.outputWriteCount || 0,
      eventOutputLinkedKindCount: result.eventOutputLinkedKindCount || 0,
      eventOutputDirectPhaseLinkCount: result.eventOutputDirectPhaseLinkCount || 0,
      parameterOutputConsumerGapCount: result.parameterOutputConsumerGapCount || 0,
      controlFlowOnlyUnlinkedEventCount: result.controlFlowOnlyUnlinkedEventCount || 0,
      indirectSupportLookupReadyEventCount: result.indirectSupportLookupReadyEventCount || 0,
      indirectParameterConsumerLinkCount: result.indirectParameterConsumerLinkCount || 0,
      indirectParameterPrimaryOutputPhaseCount: result.indirectParameterPrimaryOutputPhaseCount || 0,
      resetPreviewedRequestCount: result.resetPreviewedRequestCount || 0,
      persistedStreamByteCount: result.persistedStreamByteCount || 0,
      persistedRegisterTraceCount: result.persistedRegisterTraceCount || 0,
      persistedSampleCount: result.persistedSampleCount || 0,
      assetPolicy: result.assetPolicy || '',
    },
    failures,
  };
}

function summarizeEntrySeedSmokeResult(result) {
  const failures = [];
  if (!result) {
    failures.push('entry seed smoke did not run');
    return {
      summary: {
        ran: false,
        selected: false,
        spritePaletteApplied: false,
        stepCount: 0,
        loaderEntryCount: 0,
        warningCount: 0,
      },
      failures,
    };
  }
  if (result.error) failures.push(`entry seed smoke: ${result.error}`);
  if (!result.entrySeed?.selected) failures.push('entry seed smoke: no entry seed was selected');
  if (!result.entrySeed?.spritePaletteApplied) failures.push('entry seed smoke: sprite palette was not applied');
  if (!result.entrySeed?.writerCatalogBacked) failures.push('entry seed smoke: sprite palette writer catalog was not linked');
  if (!(result.entrySeed?.stepCount >= 3)) failures.push('entry seed smoke: expected at least three entry seed steps');
  if (!(result.entrySeed?.loaderEntryCount > 0)) failures.push('entry seed smoke: entry seed loaders produced no entries');
  if (result.entrySeed?.warningCount) failures.push(`entry seed smoke: ${result.entrySeed.warningCount} warning(s)`);
  if (result.provenance?.unresolvedSlots) failures.push(`entry seed smoke: ${result.provenance.unresolvedSlots} unresolved tile slot(s)`);
  return {
    summary: {
      ran: true,
      recipeId: result.id || '',
      seedId: result.entrySeed?.seedId || '',
      caller: result.entrySeed?.caller || '',
      selected: Boolean(result.entrySeed?.selected),
      writerCatalogBacked: Boolean(result.entrySeed?.writerCatalogBacked),
      writerCatalogId: result.entrySeed?.writerCatalogId || '',
      writerId: result.entrySeed?.writerId || '',
      writerAction: result.entrySeed?.writerAction || '',
      writerContextRole: result.entrySeed?.writerContextRole || '',
      writerSpritePaletteStatus: result.entrySeed?.writerSpritePaletteStatus || '',
      writerSpritePaletteRecordRegionId: result.entrySeed?.writerSpritePaletteRecordRegionId || '',
      spritePaletteApplied: Boolean(result.entrySeed?.spritePaletteApplied),
      spritePaletteIndex: result.entrySeed?.spritePaletteIndex ?? null,
      spritePaletteRegionId: result.entrySeed?.spritePaletteRegionId || '',
      stepCount: result.entrySeed?.stepCount || 0,
      loaderEntryCount: result.entrySeed?.loaderEntryCount || 0,
      warningCount: result.entrySeed?.warningCount || 0,
      usedSlots: result.provenance?.usedSlots || 0,
      unresolvedSlots: result.provenance?.unresolvedSlots || 0,
    },
    failures,
  };
}

function summarizeBank7SequencePreviewResult(result) {
  const failures = [];
  if (!result) {
    failures.push('bank-7 sequence preview did not run');
    return {
      summary: {
        ran: false,
        catalogBacked: false,
        validatedStreams: 0,
        waypointRecordCount: 0,
        timingRecordCount: 0,
        warningCount: 0,
        renderedRecordCount: 0,
        persistedValueCount: 0,
      },
      failures,
    };
  }
  if (result.error) failures.push(`bank-7 sequence preview: ${result.error}`);
  if (!result.catalogBacked) failures.push('bank-7 sequence preview: catalog was not linked');
  if (!(result.validatedStreams >= 2)) failures.push('bank-7 sequence preview: expected both streams to validate');
  if (result.waypointRecordCount !== 4) failures.push(`bank-7 sequence preview: expected 4 waypoint records, got ${result.waypointRecordCount}`);
  if (result.timingRecordCount !== 8) failures.push(`bank-7 sequence preview: expected 8 timing records, got ${result.timingRecordCount}`);
  if (result.warningCount) failures.push(`bank-7 sequence preview: ${result.warningCount} warning(s)`);
  if (!(result.renderedRecordCount >= 12)) failures.push('bank-7 sequence preview: expected 12 rendered runtime records');
  if (result.persistedValueCount !== 0) failures.push('bank-7 sequence preview: decoded values were reported as persisted');
  if (result.assetPolicy !== 'runtime_values_not_persisted') failures.push('bank-7 sequence preview: metadata-only asset policy was not reported');
  return {
    summary: {
      ran: true,
      catalogId: result.catalogId || '',
      catalogBacked: Boolean(result.catalogBacked),
      validatedStreams: result.validatedStreams || 0,
      waypointRecordCount: result.waypointRecordCount || 0,
      timingRecordCount: result.timingRecordCount || 0,
      warningCount: result.warningCount || 0,
      renderedRecordCount: result.renderedRecordCount || 0,
      persistedValueCount: result.persistedValueCount || 0,
      assetPolicy: result.assetPolicy || '',
    },
    failures,
  };
}

function summarizeRoomEntityOrphanPreviewResult(result) {
  const failures = [];
  if (!result) {
    failures.push('room entity orphan preview did not run');
    return {
      summary: {
        ran: false,
        catalogBacked: false,
        listCount: 0,
        recordCount: 0,
        uniqueEntityTypeCount: 0,
        subrecordPointerRefs: 0,
        warningCount: 0,
        persistedCoordinateCount: 0,
      },
      failures,
    };
  }
  if (result.error) failures.push(`room entity orphan preview: ${result.error}`);
  if (!result.catalogBacked) failures.push('room entity orphan preview: catalog was not linked');
  if (!result.fullyCoversSpan) failures.push('room entity orphan preview: span is not fully covered');
  if (result.listCount !== 61) failures.push(`room entity orphan preview: expected 61 lists, got ${result.listCount}`);
  if (result.recordCount !== 511) failures.push(`room entity orphan preview: expected 511 records, got ${result.recordCount}`);
  if (!(result.uniqueEntityTypeCount >= 60)) failures.push(`room entity orphan preview: expected at least 60 entity type ids, got ${result.uniqueEntityTypeCount}`);
  if (result.subrecordPointerRefs !== 0) failures.push(`room entity orphan preview: expected 0 room subrecord refs, got ${result.subrecordPointerRefs}`);
  if (result.warningCount) failures.push(`room entity orphan preview: ${result.warningCount} warning(s)`);
  if (result.persistedCoordinateCount !== 0) failures.push('room entity orphan preview: coordinate values were reported as persisted');
  if (result.assetPolicy !== 'metadata_only_no_coordinates') failures.push('room entity orphan preview: metadata-only coordinate policy was not reported');
  return {
    summary: {
      ran: true,
      catalogId: result.catalogId || '',
      catalogBacked: Boolean(result.catalogBacked),
      fullyCoversSpan: Boolean(result.fullyCoversSpan),
      listCount: result.listCount || 0,
      recordCount: result.recordCount || 0,
      uniqueEntityTypeCount: result.uniqueEntityTypeCount || 0,
      subrecordPointerRefs: result.subrecordPointerRefs || 0,
      warningCount: result.warningCount || 0,
      persistedCoordinateCount: result.persistedCoordinateCount || 0,
      assetPolicy: result.assetPolicy || '',
    },
    failures,
  };
}

function summarizeRoomEntityAssetPreviewResult(result) {
  const failures = [];
  if (!result) {
    failures.push('room entity asset preview did not run');
    return {
      summary: {
        ran: false,
        catalogBacked: false,
        linkCount: 0,
        rawTypesWithFrameSubrecords: 0,
        selectorTypesWithFrameSubrecords: 0,
        animationFrameGapCount: 0,
        persistedAssetByteCount: 0,
        persistedCoordinateCount: 0,
      },
      failures,
    };
  }
  if (result.error) failures.push(`room entity asset preview: ${result.error}`);
  if (!result.catalogBacked) failures.push('room entity asset preview: catalog was not linked');
  if (!result.previewOk) failures.push('room entity asset preview: preview reported warnings');
  if (!(result.linkCount >= 85)) failures.push(`room entity asset preview: expected at least 85 raw type links, got ${result.linkCount}`);
  if (!(result.rawTypesWithFrameSubrecords >= 50)) failures.push(`room entity asset preview: expected at least 50 frame-linked raw types, got ${result.rawTypesWithFrameSubrecords}`);
  if (!(result.selectorTypesWithFrameSubrecords >= 41)) failures.push(`room entity asset preview: expected at least 41 frame-linked selectors, got ${result.selectorTypesWithFrameSubrecords}`);
  if (result.animationFrameGapCount !== 0) failures.push(`room entity asset preview: expected 0 animated frame gaps, got ${result.animationFrameGapCount}`);
  if (!(result.highConfidenceFrameSubrecords >= 92)) failures.push(`room entity asset preview: expected at least 92 high-confidence frame subrecords, got ${result.highConfidenceFrameSubrecords}`);
  if (!(result.frameRegionsLinked >= 18)) failures.push(`room entity asset preview: expected at least 18 linked frame regions, got ${result.frameRegionsLinked}`);
  if (result.persistedAssetByteCount !== 0) failures.push('room entity asset preview: asset bytes were reported as persisted');
  if (result.persistedCoordinateCount !== 0) failures.push('room entity asset preview: coordinate values were reported as persisted');
  if (result.assetPolicy !== 'metadata_only_no_rom_bytes_or_coordinates') failures.push('room entity asset preview: metadata-only asset policy was not reported');
  return {
    summary: {
      ran: true,
      catalogId: result.catalogId || '',
      catalogBacked: Boolean(result.catalogBacked),
      linkCount: result.linkCount || 0,
      rawTypesWithFrameSubrecords: result.rawTypesWithFrameSubrecords || 0,
      selectorTypesWithFrameSubrecords: result.selectorTypesWithFrameSubrecords || 0,
      animationFrameGapCount: result.animationFrameGapCount || 0,
      highConfidenceFrameSubrecords: result.highConfidenceFrameSubrecords || 0,
      frameRegionsLinked: result.frameRegionsLinked || 0,
      persistedAssetByteCount: result.persistedAssetByteCount || 0,
      persistedCoordinateCount: result.persistedCoordinateCount || 0,
      assetPolicy: result.assetPolicy || '',
    },
    failures,
  };
}

function summarizeRoomEntityDynamicPreviewResult(result) {
  const failures = [];
  if (!result) {
    failures.push('room entity dynamic tile preview did not run');
    return {
      summary: {
        ran: false,
        catalogBacked: false,
        runtimeDecoded: false,
        subrecordCount: 0,
        uploadSubrecordCount: 0,
        totalFirstSeenEntityUploads: 0,
        uniqueDynamicStreamsUsed: 0,
        catalogExpectedTileSlots: 0,
        runtimeTouchedSlots: 0,
        runtimeUnresolvedSlots: 0,
        persistedTileByteCount: 0,
        persistedPixelCount: 0,
        persistedCoordinateCount: 0,
      },
      failures,
    };
  }
  if (result.error) failures.push(`room entity dynamic tile preview: ${result.error}`);
  if (!result.catalogBacked) failures.push('room entity dynamic tile preview: catalog was not linked');
  if (!result.previewOk) failures.push('room entity dynamic tile preview: preview reported warnings');
  if (!result.runtimeDecoded) failures.push('room entity dynamic tile preview: local ROM runtime replay did not run');
  if (!(result.subrecordCount >= 76)) failures.push(`room entity dynamic tile preview: expected at least 76 subrecords, got ${result.subrecordCount}`);
  if (!(result.uploadSubrecordCount >= 55)) failures.push(`room entity dynamic tile preview: expected at least 55 upload-bearing subrecords, got ${result.uploadSubrecordCount}`);
  if (!(result.totalFirstSeenEntityUploads >= 174)) failures.push(`room entity dynamic tile preview: expected at least 174 first-seen uploads, got ${result.totalFirstSeenEntityUploads}`);
  if (!(result.uniqueDynamicStreamsUsed >= 36)) failures.push(`room entity dynamic tile preview: expected at least 36 dynamic streams, got ${result.uniqueDynamicStreamsUsed}`);
  if (!(result.catalogExpectedTileSlots >= 4414)) failures.push(`room entity dynamic tile preview: expected at least 4414 catalog tile slots, got ${result.catalogExpectedTileSlots}`);
  if (result.runtimeTouchedSlots !== result.catalogExpectedTileSlots) failures.push(`room entity dynamic tile preview: runtime touched ${result.runtimeTouchedSlots} slots but catalog expected ${result.catalogExpectedTileSlots}`);
  if (result.runtimeUnresolvedSlots !== 0) failures.push(`room entity dynamic tile preview: ${result.runtimeUnresolvedSlots} unresolved runtime slot(s)`);
  if (!(result.runtimeSourceRegionCount >= 6)) failures.push(`room entity dynamic tile preview: expected at least 6 source graphics regions, got ${result.runtimeSourceRegionCount}`);
  if (!(result.runtimeStreamCount >= 36)) failures.push(`room entity dynamic tile preview: expected at least 36 runtime streams, got ${result.runtimeStreamCount}`);
  if (result.warningCount !== 0) failures.push(`room entity dynamic tile preview: ${result.warningCount} warning(s)`);
  if (result.persistedTileByteCount !== 0) failures.push('room entity dynamic tile preview: tile bytes were reported as persisted');
  if (result.persistedPixelCount !== 0) failures.push('room entity dynamic tile preview: pixels were reported as persisted');
  if (result.persistedCoordinateCount !== 0) failures.push('room entity dynamic tile preview: coordinates were reported as persisted');
  if (result.assetPolicy !== 'metadata_only_no_rom_bytes_or_pixels') failures.push('room entity dynamic tile preview: metadata-only dynamic tile policy was not reported');
  return {
    summary: {
      ran: true,
      catalogId: result.catalogId || '',
      catalogBacked: Boolean(result.catalogBacked),
      runtimeDecoded: Boolean(result.runtimeDecoded),
      subrecordCount: result.subrecordCount || 0,
      uploadSubrecordCount: result.uploadSubrecordCount || 0,
      totalFirstSeenEntityUploads: result.totalFirstSeenEntityUploads || 0,
      uniqueDynamicStreamsUsed: result.uniqueDynamicStreamsUsed || 0,
      catalogExpectedTileSlots: result.catalogExpectedTileSlots || 0,
      runtimeTouchedSlots: result.runtimeTouchedSlots || 0,
      runtimeCopySlots: result.runtimeCopySlots || 0,
      runtimeZeroSlots: result.runtimeZeroSlots || 0,
      runtimeUnresolvedSlots: result.runtimeUnresolvedSlots || 0,
      runtimeSourceRegionCount: result.runtimeSourceRegionCount || 0,
      runtimeStreamCount: result.runtimeStreamCount || 0,
      warningCount: result.warningCount || 0,
      persistedTileByteCount: result.persistedTileByteCount || 0,
      persistedPixelCount: result.persistedPixelCount || 0,
      persistedCoordinateCount: result.persistedCoordinateCount || 0,
      assetPolicy: result.assetPolicy || '',
    },
    failures,
  };
}

function summarizeRoomEntityFrameCoveragePreviewResult(result) {
  const failures = [];
  if (!result) {
    failures.push('room entity frame coverage preview did not run');
    return {
      summary: {
        ran: false,
        catalogBacked: false,
        totalDynamicEntityUploads: 0,
        frameLinkedUploadCount: 0,
        fullyCoveredUploadCount: 0,
        partialCoverageUploadCount: 0,
        noFrameAssetUploadCount: 0,
        renderableFixtureCatalogBacked: false,
        renderableFixtureCount: 0,
        oamSemanticsCatalogBacked: false,
        oamPositionProducerRoutine: '',
        fixtureRuntimeDecoded: false,
        fixtureRuntimeRenderedTileCount: 0,
        fixtureRuntimeRenderedPieceCount: 0,
        persistedTileByteCount: 0,
        persistedPixelCount: 0,
        persistedCoordinateCount: 0,
      },
      failures,
    };
  }
  if (result.error) failures.push(`room entity frame coverage preview: ${result.error}`);
  if (!result.catalogBacked) failures.push('room entity frame coverage preview: catalog was not linked');
  if (!result.previewOk) failures.push('room entity frame coverage preview: preview reported warnings');
  if (result.totalDynamicEntityUploads !== 174) failures.push(`room entity frame coverage preview: expected 174 dynamic uploads, got ${result.totalDynamicEntityUploads}`);
  if (result.frameLinkedUploadCount !== 90) failures.push(`room entity frame coverage preview: expected 90 frame-linked uploads, got ${result.frameLinkedUploadCount}`);
  if (result.fullyCoveredUploadCount !== 36) failures.push(`room entity frame coverage preview: expected 36 fully covered uploads, got ${result.fullyCoveredUploadCount}`);
  if (result.partialCoverageUploadCount !== 54) failures.push(`room entity frame coverage preview: expected 54 partial coverage uploads, got ${result.partialCoverageUploadCount}`);
  if (result.noFrameAssetUploadCount !== 84) failures.push(`room entity frame coverage preview: expected 84 no-frame-asset uploads, got ${result.noFrameAssetUploadCount}`);
  if (result.dynamicEntityTypeCount !== 52) failures.push(`room entity frame coverage preview: expected 52 dynamic entity types, got ${result.dynamicEntityTypeCount}`);
  if (result.frameLinkedEntityTypeCount !== 29) failures.push(`room entity frame coverage preview: expected 29 frame-linked entity types, got ${result.frameLinkedEntityTypeCount}`);
  if (result.fullyCoveredEntityTypeCount !== 17) failures.push(`room entity frame coverage preview: expected 17 fully covered entity types, got ${result.fullyCoveredEntityTypeCount}`);
  if (result.needsTraceEntityTypeCount !== 12) failures.push(`room entity frame coverage preview: expected 12 needs-trace entity types, got ${result.needsTraceEntityTypeCount}`);
  if (!result.tracePriorityCatalogBacked) failures.push('room entity frame coverage preview: trace-priority catalog was not linked');
  if (result.tracePriorityEntityTypeCount !== result.needsTraceEntityTypeCount) failures.push(`room entity frame coverage preview: trace priority count ${result.tracePriorityEntityTypeCount} did not match needs-trace count ${result.needsTraceEntityTypeCount}`);
  if (result.tracePriorityTopEntityType !== '0x8A') failures.push(`room entity frame coverage preview: expected top trace priority 0x8A, got ${result.tracePriorityTopEntityType || 'none'}`);
  if (!result.subrecordCoverageCatalogBacked) failures.push('room entity frame coverage preview: subrecord coverage catalog was not linked');
  if (result.subrecordCoverageEntityTypeCount !== result.needsTraceEntityTypeCount) failures.push(`room entity frame coverage preview: subrecord coverage count ${result.subrecordCoverageEntityTypeCount} did not match needs-trace count ${result.needsTraceEntityTypeCount}`);
  if (result.subrecordCoverageTopEntityType !== '0x8A') failures.push(`room entity frame coverage preview: expected top subrecord coverage entity 0x8A, got ${result.subrecordCoverageTopEntityType || 'none'}`);
  if (result.subrecordCoverageTopEntityFrameCount !== 5) failures.push(`room entity frame coverage preview: expected 5 top-entity frame subrecords, got ${result.subrecordCoverageTopEntityFrameCount}`);
  if (result.subrecordCoverageTopEntityRenderableFrameCount !== 2) failures.push(`room entity frame coverage preview: expected 2 renderable top-entity frame subrecords, got ${result.subrecordCoverageTopEntityRenderableFrameCount}`);
  if (result.subrecordCoverageTopEntityNotCoveredFrameCount !== 3) failures.push(`room entity frame coverage preview: expected 3 blocked top-entity frame subrecords, got ${result.subrecordCoverageTopEntityNotCoveredFrameCount}`);
  if (result.subrecordCoverageParseIssueCount !== 0) failures.push(`room entity frame coverage preview: subrecord coverage catalog has ${result.subrecordCoverageParseIssueCount} parse issue(s)`);
  if (!result.renderableFixtureCatalogBacked) failures.push('room entity frame coverage preview: renderable fixture catalog was not linked');
  if (result.renderableFixtureEntityTypeCount !== 11) failures.push(`room entity frame coverage preview: expected 11 fixture-backed entity types, got ${result.renderableFixtureEntityTypeCount}`);
  if (result.renderableFixtureCount !== result.subrecordCoverageRenderableFrameCount) failures.push(`room entity frame coverage preview: fixture count ${result.renderableFixtureCount} did not match renderable subrecord count ${result.subrecordCoverageRenderableFrameCount}`);
  if (result.renderableFixtureCount !== 43) failures.push(`room entity frame coverage preview: expected 43 renderable fixtures, got ${result.renderableFixtureCount}`);
  if (result.renderableFixtureDynamicBackedCount !== 40) failures.push(`room entity frame coverage preview: expected 40 dynamic-backed fixtures, got ${result.renderableFixtureDynamicBackedCount}`);
  if (result.renderableFixtureEmptyFrameCount !== 3) failures.push(`room entity frame coverage preview: expected 3 empty-frame fixtures, got ${result.renderableFixtureEmptyFrameCount}`);
  if (result.renderableFixtureBlockedOrPartialSubrecordCount !== 50) failures.push(`room entity frame coverage preview: expected 50 blocked/partial source subrecords, got ${result.renderableFixtureBlockedOrPartialSubrecordCount}`);
  if (result.renderableFixtureTopEntityType !== '0x8A') failures.push(`room entity frame coverage preview: expected top renderable fixture entity 0x8A, got ${result.renderableFixtureTopEntityType || 'none'}`);
  if (result.renderableFixtureTopEntityFixtureCount !== 2) failures.push(`room entity frame coverage preview: expected 2 top-entity fixtures, got ${result.renderableFixtureTopEntityFixtureCount}`);
  if (result.renderableFixtureTopEntityBlockedSubrecordCount !== 3) failures.push(`room entity frame coverage preview: expected 3 top-entity blocked source subrecords, got ${result.renderableFixtureTopEntityBlockedSubrecordCount}`);
  if (result.renderableFixtureParseIssueCount !== 0) failures.push(`room entity frame coverage preview: renderable fixture catalog has ${result.renderableFixtureParseIssueCount} parse issue(s)`);
  if (!result.oamSemanticsCatalogBacked) failures.push('room entity frame coverage preview: OAM writer semantics catalog was not linked');
  if (result.oamPieceRecordByteLength !== 3) failures.push(`room entity frame coverage preview: expected 3-byte OAM piece records, got ${result.oamPieceRecordByteLength}`);
  if (result.oamOutputRecordByteLength !== 3) failures.push(`room entity frame coverage preview: expected 3-byte OAM output records, got ${result.oamOutputRecordByteLength}`);
  if (result.oamFrameStreamRoutine !== '_LABEL_792_') failures.push(`room entity frame coverage preview: expected OAM frame stream routine _LABEL_792_, got ${result.oamFrameStreamRoutine || 'none'}`);
  if (result.oamSlotScanRoutine !== '_LABEL_6E7_') failures.push(`room entity frame coverage preview: expected OAM slot scan routine _LABEL_6E7_, got ${result.oamSlotScanRoutine || 'none'}`);
  if (result.oamPositionProducerRoutine !== '_LABEL_760_') failures.push(`room entity frame coverage preview: expected OAM position producer _LABEL_760_, got ${result.oamPositionProducerRoutine || 'none'}`);
  if (result.oamTileBaseField !== 'IX+63') failures.push(`room entity frame coverage preview: expected tile-base field IX+63, got ${result.oamTileBaseField || 'none'}`);
  if (result.oamXBaseRam !== '_RAM_D00B_/_RAM_D00C_') failures.push(`room entity frame coverage preview: expected X base RAM _RAM_D00B_/_RAM_D00C_, got ${result.oamXBaseRam || 'none'}`);
  if (result.oamYBaseRam !== '_RAM_D00D_/_RAM_D00E_') failures.push(`room entity frame coverage preview: expected Y base RAM _RAM_D00D_/_RAM_D00E_, got ${result.oamYBaseRam || 'none'}`);
  if (result.oamXBaseSlotFields !== 'IX+3/IX+4') failures.push(`room entity frame coverage preview: expected X slot fields IX+3/IX+4, got ${result.oamXBaseSlotFields || 'none'}`);
  if (result.oamYBaseSlotFields !== 'IX+6/IX+7') failures.push(`room entity frame coverage preview: expected Y slot fields IX+6/IX+7, got ${result.oamYBaseSlotFields || 'none'}`);
  if (result.oamXCameraRam !== '_RAM_D007_') failures.push(`room entity frame coverage preview: expected X camera RAM _RAM_D007_, got ${result.oamXCameraRam || 'none'}`);
  if (result.oamYCameraRam !== '_RAM_D009_') failures.push(`room entity frame coverage preview: expected Y camera RAM _RAM_D009_, got ${result.oamYCameraRam || 'none'}`);
  if (result.oamCameraSubtractFlag !== 'IX+0 bit 5 clear') failures.push(`room entity frame coverage preview: expected camera subtract flag "IX+0 bit 5 clear", got ${result.oamCameraSubtractFlag || 'none'}`);
  if (result.oamPersistedCoordinateCount !== 0) failures.push('room entity frame coverage preview: OAM semantics reported persisted coordinates');
  if (!result.slotCoordinateCatalogBacked) failures.push('room entity frame coverage preview: slot coordinate provenance catalog was not linked');
  if (result.slotCoordinateFieldCount !== 4) failures.push(`room entity frame coverage preview: expected 4 slot coordinate fields, got ${result.slotCoordinateFieldCount}`);
  if (result.slotCoordinateReferenceCount !== 216) failures.push(`room entity frame coverage preview: expected 216 slot coordinate references, got ${result.slotCoordinateReferenceCount}`);
  if (result.slotCoordinateReadReferenceCount !== 87) failures.push(`room entity frame coverage preview: expected 87 slot coordinate read references, got ${result.slotCoordinateReadReferenceCount}`);
  if (result.slotCoordinateWriteReferenceCount !== 128) failures.push(`room entity frame coverage preview: expected 128 slot coordinate write references, got ${result.slotCoordinateWriteReferenceCount}`);
  if (result.slotCoordinateReadWriteReferenceCount !== 1) failures.push(`room entity frame coverage preview: expected 1 slot coordinate read/write reference, got ${result.slotCoordinateReadWriteReferenceCount}`);
  if (result.slotCoordinateUnknownReferenceCount !== 0) failures.push(`room entity frame coverage preview: slot coordinate catalog has ${result.slotCoordinateUnknownReferenceCount} unknown reference(s)`);
  if (result.slotCoordinateRoutineReferenceCount !== 66) failures.push(`room entity frame coverage preview: expected 66 slot-coordinate routine summaries, got ${result.slotCoordinateRoutineReferenceCount}`);
  if (result.slotCoordinateConfirmedContextReferenceCount !== 40) failures.push(`room entity frame coverage preview: expected 40 confirmed-context slot coordinate references, got ${result.slotCoordinateConfirmedContextReferenceCount}`);
  if (result.slotCoordinateCandidateContextReferenceCount !== 176) failures.push(`room entity frame coverage preview: expected 176 candidate-context slot coordinate references, got ${result.slotCoordinateCandidateContextReferenceCount}`);
  if (result.slotCoordinateRoomEntityInitializerLabel !== '_LABEL_65B9_') failures.push(`room entity frame coverage preview: expected slot coordinate initializer _LABEL_65B9_, got ${result.slotCoordinateRoomEntityInitializerLabel || 'none'}`);
  if (result.slotCoordinateOamPositionProducerLabel !== '_LABEL_760_') failures.push(`room entity frame coverage preview: expected slot coordinate OAM producer _LABEL_760_, got ${result.slotCoordinateOamPositionProducerLabel || 'none'}`);
  if (result.slotCoordinateOamFrameStreamConsumerLabel !== '_LABEL_792_') failures.push(`room entity frame coverage preview: expected slot coordinate OAM consumer _LABEL_792_, got ${result.slotCoordinateOamFrameStreamConsumerLabel || 'none'}`);
  if (result.slotCoordinateXSlotFields !== 'IX+3/IX+4') failures.push(`room entity frame coverage preview: expected X slot coordinate fields IX+3/IX+4, got ${result.slotCoordinateXSlotFields || 'none'}`);
  if (result.slotCoordinateYSlotFields !== 'IX+6/IX+7') failures.push(`room entity frame coverage preview: expected Y slot coordinate fields IX+6/IX+7, got ${result.slotCoordinateYSlotFields || 'none'}`);
  if (result.slotCoordinateXRoomRecordSourceFields !== 'IY+1/IY+2') failures.push(`room entity frame coverage preview: expected X room-record coordinate source IY+1/IY+2, got ${result.slotCoordinateXRoomRecordSourceFields || 'none'}`);
  if (result.slotCoordinateYRoomRecordSourceFields !== 'IY+3 plus zero high byte') failures.push(`room entity frame coverage preview: expected Y room-record coordinate source IY+3 plus zero high byte, got ${result.slotCoordinateYRoomRecordSourceFields || 'none'}`);
  if (result.slotCoordinateXBaseOutputRam !== '_RAM_D00B_/_RAM_D00C_') failures.push(`room entity frame coverage preview: expected slot X base output RAM _RAM_D00B_/_RAM_D00C_, got ${result.slotCoordinateXBaseOutputRam || 'none'}`);
  if (result.slotCoordinateYBaseOutputRam !== '_RAM_D00D_/_RAM_D00E_') failures.push(`room entity frame coverage preview: expected slot Y base output RAM _RAM_D00D_/_RAM_D00E_, got ${result.slotCoordinateYBaseOutputRam || 'none'}`);
  if (result.slotCoordinateRuntimePositionCoordinateModelStatus !== 'metadata_provenance_only') failures.push(`room entity frame coverage preview: expected metadata-only slot coordinate runtime status, got ${result.slotCoordinateRuntimePositionCoordinateModelStatus || 'none'}`);
  if (result.slotCoordinatePersistedCoordinateCount !== 0) failures.push('room entity frame coverage preview: slot coordinate provenance reported persisted coordinates');
  if (!result.positionIntegratorCatalogBacked) failures.push('room entity frame coverage preview: position integrator catalog was not linked');
  if (result.positionIntegratorRoutineCount !== 3) failures.push(`room entity frame coverage preview: expected 3 position integrator routines, got ${result.positionIntegratorRoutineCount}`);
  if (result.positionIntegratorBothAxesRoutine !== '_LABEL_12D5_') failures.push(`room entity frame coverage preview: expected both-axis integrator _LABEL_12D5_, got ${result.positionIntegratorBothAxesRoutine || 'none'}`);
  if (result.positionIntegratorXOnlyRoutine !== '_LABEL_12D8_') failures.push(`room entity frame coverage preview: expected X-only integrator _LABEL_12D8_, got ${result.positionIntegratorXOnlyRoutine || 'none'}`);
  if (result.positionIntegratorYOnlyRoutine !== '_LABEL_12F8_') failures.push(`room entity frame coverage preview: expected Y-only integrator _LABEL_12F8_, got ${result.positionIntegratorYOnlyRoutine || 'none'}`);
  if (result.positionIntegratorBothAxisExternalCallCount !== 24) failures.push(`room entity frame coverage preview: expected 24 both-axis integrator callsites, got ${result.positionIntegratorBothAxisExternalCallCount}`);
  if (result.positionIntegratorXOnlyExternalCallCount !== 8) failures.push(`room entity frame coverage preview: expected 8 X-only integrator callsites, got ${result.positionIntegratorXOnlyExternalCallCount}`);
  if (result.positionIntegratorYOnlyExternalCallCount !== 6) failures.push(`room entity frame coverage preview: expected 6 Y-only integrator callsites, got ${result.positionIntegratorYOnlyExternalCallCount}`);
  if (result.positionIntegratorYOnlyInternalCallCount !== 1) failures.push(`room entity frame coverage preview: expected 1 internal Y integrator call, got ${result.positionIntegratorYOnlyInternalCallCount}`);
  if (result.positionIntegratorTotalExternalCallCount !== 38) failures.push(`room entity frame coverage preview: expected 38 external integrator callsites, got ${result.positionIntegratorTotalExternalCallCount}`);
  if (result.positionIntegratorUniqueExternalCallerCount !== 32) failures.push(`room entity frame coverage preview: expected 32 unique integrator caller routines, got ${result.positionIntegratorUniqueExternalCallerCount}`);
  if (result.positionIntegratorXVelocityFields !== 'IX+8/IX+9 signed word') failures.push(`room entity frame coverage preview: expected X velocity fields IX+8/IX+9 signed word, got ${result.positionIntegratorXVelocityFields || 'none'}`);
  if (result.positionIntegratorYVelocityFields !== 'IX+10/IX+11 signed word') failures.push(`room entity frame coverage preview: expected Y velocity fields IX+10/IX+11 signed word, got ${result.positionIntegratorYVelocityFields || 'none'}`);
  if (result.positionIntegratorXVisibleCoordinateFields !== 'IX+3/IX+4') failures.push(`room entity frame coverage preview: expected X visible coordinate fields IX+3/IX+4, got ${result.positionIntegratorXVisibleCoordinateFields || 'none'}`);
  if (result.positionIntegratorYVisibleCoordinateFields !== 'IX+6/IX+7') failures.push(`room entity frame coverage preview: expected Y visible coordinate fields IX+6/IX+7, got ${result.positionIntegratorYVisibleCoordinateFields || 'none'}`);
  if (result.positionIntegratorPersistedGameplayValueCount !== 0) failures.push('room entity frame coverage preview: position integrator catalog reported persisted gameplay values');
  if (!result.velocityFieldCatalogBacked) failures.push('room entity frame coverage preview: velocity field provenance catalog was not linked');
  if (result.velocityFieldFieldCount !== 4) failures.push(`room entity frame coverage preview: expected 4 velocity fields, got ${result.velocityFieldFieldCount}`);
  if (result.velocityFieldReferenceCount !== 203) failures.push(`room entity frame coverage preview: expected 203 velocity field references, got ${result.velocityFieldReferenceCount}`);
  if (result.velocityFieldReadReferenceCount !== 65) failures.push(`room entity frame coverage preview: expected 65 velocity read references, got ${result.velocityFieldReadReferenceCount}`);
  if (result.velocityFieldWriteReferenceCount !== 138) failures.push(`room entity frame coverage preview: expected 138 velocity write references, got ${result.velocityFieldWriteReferenceCount}`);
  if (result.velocityFieldReadWriteReferenceCount !== 0) failures.push(`room entity frame coverage preview: expected 0 velocity read/write references, got ${result.velocityFieldReadWriteReferenceCount}`);
  if (result.velocityFieldUnknownReferenceCount !== 0) failures.push(`room entity frame coverage preview: velocity catalog has ${result.velocityFieldUnknownReferenceCount} unknown reference(s)`);
  if (result.velocityFieldWriterReferenceCount !== 138) failures.push(`room entity frame coverage preview: expected 138 velocity writer references, got ${result.velocityFieldWriterReferenceCount}`);
  if (result.velocityFieldReaderReferenceCount !== 65) failures.push(`room entity frame coverage preview: expected 65 velocity reader references, got ${result.velocityFieldReaderReferenceCount}`);
  if (result.velocityFieldRoutineReferenceCount !== 55) failures.push(`room entity frame coverage preview: expected 55 velocity routine summaries, got ${result.velocityFieldRoutineReferenceCount}`);
  if (result.velocityFieldWriterRoutineCount !== 42) failures.push(`room entity frame coverage preview: expected 42 velocity writer routines, got ${result.velocityFieldWriterRoutineCount}`);
  if (result.velocityFieldReaderRoutineCount !== 27) failures.push(`room entity frame coverage preview: expected 27 velocity reader routines, got ${result.velocityFieldReaderRoutineCount}`);
  if (result.velocityFieldConfirmedContextReferenceCount !== 27) failures.push(`room entity frame coverage preview: expected 27 confirmed-context velocity references, got ${result.velocityFieldConfirmedContextReferenceCount}`);
  if (result.velocityFieldCandidateContextReferenceCount !== 172) failures.push(`room entity frame coverage preview: expected 172 candidate-context velocity references, got ${result.velocityFieldCandidateContextReferenceCount}`);
  if (result.velocityFieldXVelocityFields !== 'IX+8/IX+9') failures.push(`room entity frame coverage preview: expected X velocity fields IX+8/IX+9, got ${result.velocityFieldXVelocityFields || 'none'}`);
  if (result.velocityFieldYVelocityFields !== 'IX+10/IX+11') failures.push(`room entity frame coverage preview: expected Y velocity fields IX+10/IX+11, got ${result.velocityFieldYVelocityFields || 'none'}`);
  if (result.velocityFieldXIntegratorConsumer !== '_LABEL_12D8_') failures.push(`room entity frame coverage preview: expected X velocity consumer _LABEL_12D8_, got ${result.velocityFieldXIntegratorConsumer || 'none'}`);
  if (result.velocityFieldYIntegratorConsumer !== '_LABEL_12F8_') failures.push(`room entity frame coverage preview: expected Y velocity consumer _LABEL_12F8_, got ${result.velocityFieldYIntegratorConsumer || 'none'}`);
  if (result.velocityFieldXVelocitySignedDeltaHelper !== '_LABEL_1B4B_') failures.push(`room entity frame coverage preview: expected X velocity delta helper _LABEL_1B4B_, got ${result.velocityFieldXVelocitySignedDeltaHelper || 'none'}`);
  if (result.velocityFieldYVelocitySignedDeltaHelper !== '_LABEL_1B25_') failures.push(`room entity frame coverage preview: expected Y velocity delta helper _LABEL_1B25_, got ${result.velocityFieldYVelocitySignedDeltaHelper || 'none'}`);
  if (result.velocityFieldXContactResponseHelper !== '_LABEL_1951_') failures.push(`room entity frame coverage preview: expected X velocity contact helper _LABEL_1951_, got ${result.velocityFieldXContactResponseHelper || 'none'}`);
  if (result.velocityFieldYContactResponseHelpers !== '_LABEL_18DC_/_LABEL_18EE_') failures.push(`room entity frame coverage preview: expected Y velocity contact helpers _LABEL_18DC_/_LABEL_18EE_, got ${result.velocityFieldYContactResponseHelpers || 'none'}`);
  if (result.velocityFieldTableDrivenInitializer !== '_LABEL_43B8_') failures.push(`room entity frame coverage preview: expected velocity table initializer _LABEL_43B8_, got ${result.velocityFieldTableDrivenInitializer || 'none'}`);
  if (result.velocityFieldPersistedGameplayValueCount !== 0) failures.push('room entity frame coverage preview: velocity catalog reported persisted gameplay values');
  if (!result.motionDeltaCatalogBacked) failures.push('room entity frame coverage preview: motion delta provenance catalog was not linked');
  if (result.motionDeltaFieldCount !== 2) failures.push(`room entity frame coverage preview: expected 2 motion delta fields, got ${result.motionDeltaFieldCount}`);
  if (result.motionDeltaReferenceCount !== 52) failures.push(`room entity frame coverage preview: expected 52 motion delta references, got ${result.motionDeltaReferenceCount}`);
  if (result.motionDeltaReadReferenceCount !== 12) failures.push(`room entity frame coverage preview: expected 12 motion delta read references, got ${result.motionDeltaReadReferenceCount}`);
  if (result.motionDeltaWriteReferenceCount !== 40) failures.push(`room entity frame coverage preview: expected 40 motion delta write references, got ${result.motionDeltaWriteReferenceCount}`);
  if (result.motionDeltaReadWriteReferenceCount !== 0) failures.push(`room entity frame coverage preview: expected 0 motion delta read/write references, got ${result.motionDeltaReadWriteReferenceCount}`);
  if (result.motionDeltaUnknownReferenceCount !== 0) failures.push(`room entity frame coverage preview: motion delta catalog has ${result.motionDeltaUnknownReferenceCount} unknown reference(s)`);
  if (result.motionDeltaWriterReferenceCount !== 40) failures.push(`room entity frame coverage preview: expected 40 motion delta writer references, got ${result.motionDeltaWriterReferenceCount}`);
  if (result.motionDeltaReaderReferenceCount !== 12) failures.push(`room entity frame coverage preview: expected 12 motion delta reader references, got ${result.motionDeltaReaderReferenceCount}`);
  if (result.motionDeltaRoutineReferenceCount !== 37) failures.push(`room entity frame coverage preview: expected 37 motion delta routine summaries, got ${result.motionDeltaRoutineReferenceCount}`);
  if (result.motionDeltaWriterRoutineCount !== 30) failures.push(`room entity frame coverage preview: expected 30 motion delta writer routines, got ${result.motionDeltaWriterRoutineCount}`);
  if (result.motionDeltaReaderRoutineCount !== 9) failures.push(`room entity frame coverage preview: expected 9 motion delta reader routines, got ${result.motionDeltaReaderRoutineCount}`);
  if (result.motionDeltaConfirmedContextReferenceCount !== 14) failures.push(`room entity frame coverage preview: expected 14 confirmed-context motion delta references, got ${result.motionDeltaConfirmedContextReferenceCount}`);
  if (result.motionDeltaCandidateContextReferenceCount !== 38) failures.push(`room entity frame coverage preview: expected 38 candidate-context motion delta references, got ${result.motionDeltaCandidateContextReferenceCount}`);
  if (result.motionDeltaXDeltaField !== 'IX+30') failures.push(`room entity frame coverage preview: expected X motion delta field IX+30, got ${result.motionDeltaXDeltaField || 'none'}`);
  if (result.motionDeltaYDeltaField !== 'IX+31') failures.push(`room entity frame coverage preview: expected Y motion delta field IX+31, got ${result.motionDeltaYDeltaField || 'none'}`);
  if (result.motionDeltaXVelocityDeltaConsumer !== '_LABEL_1B4B_') failures.push(`room entity frame coverage preview: expected X motion delta consumer _LABEL_1B4B_, got ${result.motionDeltaXVelocityDeltaConsumer || 'none'}`);
  if (result.motionDeltaYVelocityDeltaConsumer !== '_LABEL_1B25_') failures.push(`room entity frame coverage preview: expected Y motion delta consumer _LABEL_1B25_, got ${result.motionDeltaYVelocityDeltaConsumer || 'none'}`);
  if (result.motionDeltaCombinedVelocityDeltaEntry !== '_LABEL_1B22_') failures.push(`room entity frame coverage preview: expected combined motion delta entry _LABEL_1B22_, got ${result.motionDeltaCombinedVelocityDeltaEntry || 'none'}`);
  if (result.motionDeltaXGlobalAccumulatorInput !== '_LABEL_1A36_ -> _RAM_C248_') failures.push(`room entity frame coverage preview: expected X global accumulator input _LABEL_1A36_ -> _RAM_C248_, got ${result.motionDeltaXGlobalAccumulatorInput || 'none'}`);
  if (result.motionDeltaYGlobalAccumulatorInput !== '_LABEL_1A28_ -> _RAM_C24A_') failures.push(`room entity frame coverage preview: expected Y global accumulator input _LABEL_1A28_ -> _RAM_C24A_, got ${result.motionDeltaYGlobalAccumulatorInput || 'none'}`);
  if (result.motionDeltaC600MotionControllerGateRoutines !== '_LABEL_7D51_/_LABEL_7DA3_') failures.push(`room entity frame coverage preview: expected C600 motion gates _LABEL_7D51_/_LABEL_7DA3_, got ${result.motionDeltaC600MotionControllerGateRoutines || 'none'}`);
  if (result.motionDeltaCollisionReactionWriters !== '_LABEL_7E9C_/_LABEL_7EE1_') failures.push(`room entity frame coverage preview: expected motion delta collision writers _LABEL_7E9C_/_LABEL_7EE1_, got ${result.motionDeltaCollisionReactionWriters || 'none'}`);
  if (result.motionDeltaTableDrivenInitializer !== '_LABEL_7C65_') failures.push(`room entity frame coverage preview: expected motion delta table initializer _LABEL_7C65_, got ${result.motionDeltaTableDrivenInitializer || 'none'}`);
  if (result.motionDeltaPersistedGameplayValueCount !== 0) failures.push('room entity frame coverage preview: motion delta catalog reported persisted gameplay values');
  if (!result.motionDeltaBehaviorCatalogBacked) failures.push('room entity frame coverage preview: motion delta behavior-link catalog was not linked');
  if (result.motionDeltaBehaviorWriterRoutineCount !== 30) failures.push(`room entity frame coverage preview: expected 30 motion delta behavior writer routines, got ${result.motionDeltaBehaviorWriterRoutineCount}`);
  if (result.motionDeltaBehaviorLinkedWriterRoutineCount !== 30) failures.push(`room entity frame coverage preview: expected 30 linked motion delta behavior writer routines, got ${result.motionDeltaBehaviorLinkedWriterRoutineCount}`);
  if (result.motionDeltaBehaviorBehaviorTableLinkedWriterRoutineCount !== 13) failures.push(`room entity frame coverage preview: expected 13 behavior-table linked motion delta writers, got ${result.motionDeltaBehaviorBehaviorTableLinkedWriterRoutineCount}`);
  if (result.motionDeltaBehaviorC3c0InitializerWriterRoutineCount !== 14) failures.push(`room entity frame coverage preview: expected 14 C3C0 initializer motion delta writers, got ${result.motionDeltaBehaviorC3c0InitializerWriterRoutineCount}`);
  if (result.motionDeltaBehaviorAuxiliaryActorWriterRoutineCount !== 3) failures.push(`room entity frame coverage preview: expected 3 auxiliary actor motion delta writers, got ${result.motionDeltaBehaviorAuxiliaryActorWriterRoutineCount}`);
  if (result.motionDeltaBehaviorC640PairSlotWriterRoutineCount !== 1) failures.push(`room entity frame coverage preview: expected 1 C640 pair-slot motion delta writer, got ${result.motionDeltaBehaviorC640PairSlotWriterRoutineCount}`);
  if (result.motionDeltaBehaviorC740SlotWriterRoutineCount !== 1) failures.push(`room entity frame coverage preview: expected 1 C740 slot motion delta writer, got ${result.motionDeltaBehaviorC740SlotWriterRoutineCount}`);
  if (result.motionDeltaBehaviorC600RecordInitializerWriterRoutineCount !== 1) failures.push(`room entity frame coverage preview: expected 1 C600 record-initializer motion delta writer, got ${result.motionDeltaBehaviorC600RecordInitializerWriterRoutineCount}`);
  if (result.motionDeltaBehaviorC600CollisionResponseWriterRoutineCount !== 2) failures.push(`room entity frame coverage preview: expected 2 C600 collision-response motion delta writers, got ${result.motionDeltaBehaviorC600CollisionResponseWriterRoutineCount}`);
  if (result.motionDeltaBehaviorBank2SceneWriterRoutineCount !== 5) failures.push(`room entity frame coverage preview: expected 5 bank-2 scene motion delta writers, got ${result.motionDeltaBehaviorBank2SceneWriterRoutineCount}`);
  if (result.motionDeltaBehaviorBank2TransitionWriterRoutineCount !== 2) failures.push(`room entity frame coverage preview: expected 2 bank-2 transition motion delta writers, got ${result.motionDeltaBehaviorBank2TransitionWriterRoutineCount}`);
  if (result.motionDeltaBehaviorGameplayLookupWriterRoutineCount !== 1) failures.push(`room entity frame coverage preview: expected 1 gameplay lookup motion delta writer, got ${result.motionDeltaBehaviorGameplayLookupWriterRoutineCount}`);
  if (result.motionDeltaBehaviorUnresolvedWriterRoutineCount !== 0) failures.push(`room entity frame coverage preview: motion delta behavior links have ${result.motionDeltaBehaviorUnresolvedWriterRoutineCount} unresolved writer(s)`);
  if (result.motionDeltaBehaviorDirectOrScheduledDeltaConsumerLinkedWriterRoutineCount !== 7) failures.push(`room entity frame coverage preview: expected 7 direct/scheduled consumer-linked motion delta writers, got ${result.motionDeltaBehaviorDirectOrScheduledDeltaConsumerLinkedWriterRoutineCount}`);
  if (result.motionDeltaBehaviorMotionSeedOnlyWriterRoutineCount !== 23) failures.push(`room entity frame coverage preview: expected 23 motion-seed-only motion delta writers, got ${result.motionDeltaBehaviorMotionSeedOnlyWriterRoutineCount}`);
  if (result.motionDeltaBehaviorWriterReferenceCount !== 40) failures.push(`room entity frame coverage preview: expected 40 motion delta behavior writer references, got ${result.motionDeltaBehaviorWriterReferenceCount}`);
  if (result.motionDeltaBehaviorReaderReferenceCountInWriterRoutines !== 3) failures.push(`room entity frame coverage preview: expected 3 reader references inside motion delta writer routines, got ${result.motionDeltaBehaviorReaderReferenceCountInWriterRoutines}`);
  if (result.motionDeltaBehaviorPersistedGameplayValueCount !== 0) failures.push('room entity frame coverage preview: motion delta behavior catalog reported persisted gameplay values');
  if (!result.c3c0MotionSeedCatalogBacked) failures.push('room entity frame coverage preview: C3C0 motion seed family catalog was not linked');
  if (result.c3c0MotionSeedSeedRoutineCount !== 14) failures.push(`room entity frame coverage preview: expected 14 C3C0 motion seed routines, got ${result.c3c0MotionSeedSeedRoutineCount}`);
  if (result.c3c0MotionSeedBehaviorListResolvedSeedRoutineCount !== 14) failures.push(`room entity frame coverage preview: expected 14 resolved C3C0 motion seed routines, got ${result.c3c0MotionSeedBehaviorListResolvedSeedRoutineCount}`);
  if (result.c3c0MotionSeedDirectInitializerBehaviorListSeedRoutineCount !== 13) failures.push(`room entity frame coverage preview: expected 13 direct C3C0 motion seed behavior-list sources, got ${result.c3c0MotionSeedDirectInitializerBehaviorListSeedRoutineCount}`);
  if (result.c3c0MotionSeedCallerProvidedBehaviorListSeedRoutineCount !== 1) failures.push(`room entity frame coverage preview: expected 1 caller-provided C3C0 motion seed source, got ${result.c3c0MotionSeedCallerProvidedBehaviorListSeedRoutineCount}`);
  if (result.c3c0MotionSeedUnresolvedBehaviorListSeedRoutineCount !== 0) failures.push(`room entity frame coverage preview: C3C0 motion seed catalog has ${result.c3c0MotionSeedUnresolvedBehaviorListSeedRoutineCount} unresolved behavior-list seed(s)`);
  if (result.c3c0MotionSeedBehaviorListSourceCount !== 15) failures.push(`room entity frame coverage preview: expected 15 C3C0 motion seed source expressions, got ${result.c3c0MotionSeedBehaviorListSourceCount}`);
  if (result.c3c0MotionSeedUniqueBehaviorListExpressionCount !== 15) failures.push(`room entity frame coverage preview: expected 15 unique C3C0 motion seed expressions, got ${result.c3c0MotionSeedUniqueBehaviorListExpressionCount}`);
  if (result.c3c0MotionSeedPointerAdjustmentExpressionCount !== 1) failures.push(`room entity frame coverage preview: expected 1 C3C0 pointer-adjusted seed expression, got ${result.c3c0MotionSeedPointerAdjustmentExpressionCount}`);
  if (result.c3c0MotionSeedTotalTableEntryReferences !== 21) failures.push(`room entity frame coverage preview: expected 21 C3C0 seed table-entry references, got ${result.c3c0MotionSeedTotalTableEntryReferences}`);
  if (result.c3c0MotionSeedTotalWriterReferenceCount !== 14) failures.push(`room entity frame coverage preview: expected 14 C3C0 seed writer references, got ${result.c3c0MotionSeedTotalWriterReferenceCount}`);
  if (result.c3c0MotionSeedPersistedGameplayValueCount !== 0) failures.push('room entity frame coverage preview: C3C0 motion seed catalog reported persisted gameplay values');
  if (!result.c3c0MotionSeedTargetCatalogBacked) failures.push('room entity frame coverage preview: C3C0 motion seed target-link catalog was not linked');
  if (result.c3c0MotionSeedTargetSeedRoutineCount !== 14) failures.push(`room entity frame coverage preview: expected 14 C3C0 target-linked seed routines, got ${result.c3c0MotionSeedTargetSeedRoutineCount}`);
  if (result.c3c0MotionSeedTargetBehaviorListSourceCount !== 16) failures.push(`room entity frame coverage preview: expected 16 C3C0 target behavior-list sources, got ${result.c3c0MotionSeedTargetBehaviorListSourceCount}`);
  if (result.c3c0MotionSeedTargetLinkedBehaviorListSourceCount !== 16) failures.push(`room entity frame coverage preview: expected 16 linked C3C0 target behavior-list sources, got ${result.c3c0MotionSeedTargetLinkedBehaviorListSourceCount}`);
  if (result.c3c0MotionSeedTargetMissingBehaviorListSourceCount !== 0) failures.push(`room entity frame coverage preview: C3C0 target links have ${result.c3c0MotionSeedTargetMissingBehaviorListSourceCount} missing source(s)`);
  if (result.c3c0MotionSeedTargetTargetEntryCount !== 70) failures.push(`room entity frame coverage preview: expected 70 C3C0 behavior target entries, got ${result.c3c0MotionSeedTargetTargetEntryCount}`);
  if (result.c3c0MotionSeedTargetUniqueTargetRegionCount !== 8) failures.push(`room entity frame coverage preview: expected 8 C3C0 behavior target regions, got ${result.c3c0MotionSeedTargetUniqueTargetRegionCount}`);
  if (result.c3c0MotionSeedTargetSeedRoutinesWithMultipleBehaviorLists !== 1) failures.push(`room entity frame coverage preview: expected 1 C3C0 seed with multiple behavior lists, got ${result.c3c0MotionSeedTargetSeedRoutinesWithMultipleBehaviorLists}`);
  if (result.c3c0MotionSeedTargetSeedRoutinesWithMissingBehaviorLists !== 0) failures.push(`room entity frame coverage preview: expected 0 C3C0 seeds with missing behavior lists, got ${result.c3c0MotionSeedTargetSeedRoutinesWithMissingBehaviorLists}`);
  if (result.c3c0MotionSeedTargetSeedRoutinesWithTargetLinks !== 14) failures.push(`room entity frame coverage preview: expected 14 C3C0 seeds with target links, got ${result.c3c0MotionSeedTargetSeedRoutinesWithTargetLinks}`);
  if (result.c3c0MotionSeedTargetMaxTargetEntriesPerSeed !== 15) failures.push(`room entity frame coverage preview: expected max 15 target entries per C3C0 seed, got ${result.c3c0MotionSeedTargetMaxTargetEntriesPerSeed}`);
  if (result.c3c0MotionSeedTargetTotalTableEntryReferences !== 70) failures.push(`room entity frame coverage preview: expected 70 C3C0 target table-entry references, got ${result.c3c0MotionSeedTargetTotalTableEntryReferences}`);
  if (result.c3c0MotionSeedTargetPersistedGameplayValueCount !== 0) failures.push('room entity frame coverage preview: C3C0 motion seed target catalog reported persisted gameplay values');
  if (!result.c3c0BehaviorTargetSemanticsCatalogBacked) failures.push('room entity frame coverage preview: C3C0 behavior target semantics catalog was not linked');
  if (result.c3c0BehaviorTargetSemanticsSourceTargetEntryCount !== 70) failures.push(`room entity frame coverage preview: expected 70 C3C0 semantics source target entries, got ${result.c3c0BehaviorTargetSemanticsSourceTargetEntryCount}`);
  if (result.c3c0BehaviorTargetSemanticsUniqueTargetOffsetCount !== 26) failures.push(`room entity frame coverage preview: expected 26 unique C3C0 behavior target offsets, got ${result.c3c0BehaviorTargetSemanticsUniqueTargetOffsetCount}`);
  if (result.c3c0BehaviorTargetSemanticsTargetRegionCount !== 8) failures.push(`room entity frame coverage preview: expected 8 C3C0 behavior target semantic regions, got ${result.c3c0BehaviorTargetSemanticsTargetRegionCount}`);
  if (result.c3c0BehaviorTargetSemanticsTargetsWithKnownHelperCalls !== 23) failures.push(`room entity frame coverage preview: expected 23 C3C0 target offsets with known helper calls, got ${result.c3c0BehaviorTargetSemanticsTargetsWithKnownHelperCalls}`);
  if (result.c3c0BehaviorTargetSemanticsTargetsWithPackedMotionDeltaConsumer !== 20) failures.push(`room entity frame coverage preview: expected 20 C3C0 target offsets with packed motion delta consumers, got ${result.c3c0BehaviorTargetSemanticsTargetsWithPackedMotionDeltaConsumer}`);
  if (result.c3c0BehaviorTargetSemanticsTargetsWithVelocityIntegrator !== 6) failures.push(`room entity frame coverage preview: expected 6 C3C0 target offsets with velocity integrators, got ${result.c3c0BehaviorTargetSemanticsTargetsWithVelocityIntegrator}`);
  if (result.c3c0BehaviorTargetSemanticsTargetsWithCollisionPipeline !== 13) failures.push(`room entity frame coverage preview: expected 13 C3C0 target offsets with collision pipelines, got ${result.c3c0BehaviorTargetSemanticsTargetsWithCollisionPipeline}`);
  if (result.c3c0BehaviorTargetSemanticsTargetsWithAnimationTick !== 21) failures.push(`room entity frame coverage preview: expected 21 C3C0 target offsets with animation ticks, got ${result.c3c0BehaviorTargetSemanticsTargetsWithAnimationTick}`);
  if (result.c3c0BehaviorTargetSemanticsTargetsWithBehaviorStateWrite !== 22) failures.push(`room entity frame coverage preview: expected 22 C3C0 target offsets with behavior-state writes, got ${result.c3c0BehaviorTargetSemanticsTargetsWithBehaviorStateWrite}`);
  if (result.c3c0BehaviorTargetSemanticsHelperCallCount !== 74) failures.push(`room entity frame coverage preview: expected 74 C3C0 target helper calls, got ${result.c3c0BehaviorTargetSemanticsHelperCallCount}`);
  if (result.c3c0BehaviorTargetSemanticsWarningTargetCount !== 0) failures.push(`room entity frame coverage preview: expected 0 C3C0 target bounded-scan warnings, got ${result.c3c0BehaviorTargetSemanticsWarningTargetCount}`);
  if (result.c3c0BehaviorTargetSemanticsPersistedRomByteCount !== 0) failures.push('room entity frame coverage preview: C3C0 behavior target semantics catalog reported persisted ROM bytes');
  if (result.c3c0BehaviorTargetSemanticsPersistedGameplayValueCount !== 0) failures.push('room entity frame coverage preview: C3C0 behavior target semantics catalog reported persisted gameplay values');
  if (!result.c3c0ActorFamilyCatalogBacked) failures.push('room entity frame coverage preview: C3C0 actor family catalog was not linked');
  if (result.c3c0ActorFamilyRawEntityTypeCount !== 44) failures.push(`room entity frame coverage preview: expected 44 C3C0 actor-family raw entity types, got ${result.c3c0ActorFamilyRawEntityTypeCount}`);
  if (result.c3c0ActorFamilySelectorTypeCount !== 36) failures.push(`room entity frame coverage preview: expected 36 C3C0 actor-family selector types, got ${result.c3c0ActorFamilySelectorTypeCount}`);
  if (result.c3c0ActorFamilyDirectSeedEntityTypeCount !== 24) failures.push(`room entity frame coverage preview: expected 24 direct C3C0 seed entity types, got ${result.c3c0ActorFamilyDirectSeedEntityTypeCount}`);
  if (result.c3c0ActorFamilyTailSeedEntityTypeCount !== 20) failures.push(`room entity frame coverage preview: expected 20 tail C3C0 seed entity types, got ${result.c3c0ActorFamilyTailSeedEntityTypeCount}`);
  if (result.c3c0ActorFamilySeedRoutineCount !== 14) failures.push(`room entity frame coverage preview: expected 14 C3C0 actor-family seed routines, got ${result.c3c0ActorFamilySeedRoutineCount}`);
  if (result.c3c0ActorFamilySeedGroupCount !== 22) failures.push(`room entity frame coverage preview: expected 22 C3C0 actor-family seed groups, got ${result.c3c0ActorFamilySeedGroupCount}`);
  if (result.c3c0ActorFamilyBehaviorListLinkedEntityTypeCount !== 44) failures.push(`room entity frame coverage preview: expected 44 behavior-list linked C3C0 actor types, got ${result.c3c0ActorFamilyBehaviorListLinkedEntityTypeCount}`);
  if (result.c3c0ActorFamilyMissingBehaviorListSourceEntityTypeCount !== 0) failures.push(`room entity frame coverage preview: expected 0 C3C0 actor types with missing behavior-list source, got ${result.c3c0ActorFamilyMissingBehaviorListSourceEntityTypeCount}`);
  if (result.c3c0ActorFamilyTargetLinkedEntityTypeCount !== 44) failures.push(`room entity frame coverage preview: expected 44 target-linked C3C0 actor types, got ${result.c3c0ActorFamilyTargetLinkedEntityTypeCount}`);
  if (result.c3c0ActorFamilyTargetEntryReferenceCount !== 198) failures.push(`room entity frame coverage preview: expected 198 C3C0 actor-family target entry references, got ${result.c3c0ActorFamilyTargetEntryReferenceCount}`);
  if (result.c3c0ActorFamilyUniqueTargetOffsetCount !== 26) failures.push(`room entity frame coverage preview: expected 26 C3C0 actor-family unique target offsets, got ${result.c3c0ActorFamilyUniqueTargetOffsetCount}`);
  if (result.c3c0ActorFamilyActorTypesWithPackedMotionDeltaConsumer !== 44) failures.push(`room entity frame coverage preview: expected 44 C3C0 actor types with packed motion-delta consumers, got ${result.c3c0ActorFamilyActorTypesWithPackedMotionDeltaConsumer}`);
  if (result.c3c0ActorFamilyActorTypesWithCollisionPipeline !== 34) failures.push(`room entity frame coverage preview: expected 34 C3C0 actor types with collision pipelines, got ${result.c3c0ActorFamilyActorTypesWithCollisionPipeline}`);
  if (result.c3c0ActorFamilyActorTypesWithAnimationTick !== 40) failures.push(`room entity frame coverage preview: expected 40 C3C0 actor types with animation ticks, got ${result.c3c0ActorFamilyActorTypesWithAnimationTick}`);
  if (result.c3c0ActorFamilyFrameLinkedEntityTypeCount !== 20) failures.push(`room entity frame coverage preview: expected 20 C3C0 actor-family frame-linked entity types, got ${result.c3c0ActorFamilyFrameLinkedEntityTypeCount}`);
  if (result.c3c0ActorFamilyDynamicUploadedEntityTypeCount !== 27) failures.push(`room entity frame coverage preview: expected 27 C3C0 actor-family dynamic-uploaded entity types, got ${result.c3c0ActorFamilyDynamicUploadedEntityTypeCount}`);
  if (result.c3c0ActorFamilyFullyCoveredEntityTypeCount !== 9) failures.push(`room entity frame coverage preview: expected 9 fully covered C3C0 actor-family entity types, got ${result.c3c0ActorFamilyFullyCoveredEntityTypeCount}`);
  if (result.c3c0ActorFamilyPartialCoverageEntityTypeCount !== 2) failures.push(`room entity frame coverage preview: expected 2 partial C3C0 actor-family entity types, got ${result.c3c0ActorFamilyPartialCoverageEntityTypeCount}`);
  if (result.c3c0ActorFamilyWarningActorTypeCount !== 0) failures.push(`room entity frame coverage preview: expected 0 C3C0 actor-family warning entity types, got ${result.c3c0ActorFamilyWarningActorTypeCount}`);
  if (result.c3c0ActorFamilyPersistedRomByteCount !== 0) failures.push('room entity frame coverage preview: C3C0 actor family catalog reported persisted ROM bytes');
  if (result.c3c0ActorFamilyPersistedCoordinateCount !== 0) failures.push('room entity frame coverage preview: C3C0 actor family catalog reported persisted coordinates');
  if (result.c3c0ActorFamilyPersistedPixelCount !== 0) failures.push('room entity frame coverage preview: C3C0 actor family catalog reported persisted pixels');
  if (result.c3c0ActorFamilyPersistedGameplayValueCount !== 0) failures.push('room entity frame coverage preview: C3C0 actor family catalog reported persisted gameplay values');
  if (!result.c3c0RenderabilityCatalogBacked) failures.push('room entity frame coverage preview: C3C0 renderability catalog was not linked');
  if (result.c3c0RenderabilityActorTypeCount !== 44) failures.push(`room entity frame coverage preview: expected 44 C3C0 renderability actor types, got ${result.c3c0RenderabilityActorTypeCount}`);
  if (result.c3c0RenderabilityFrameLinkedActorTypeCount !== 20) failures.push(`room entity frame coverage preview: expected 20 C3C0 renderability frame-linked actor types, got ${result.c3c0RenderabilityFrameLinkedActorTypeCount}`);
  if (result.c3c0RenderabilityDynamicUploadedActorTypeCount !== 27) failures.push(`room entity frame coverage preview: expected 27 C3C0 renderability dynamic-uploaded actor types, got ${result.c3c0RenderabilityDynamicUploadedActorTypeCount}`);
  if (result.c3c0RenderabilityFullyRenderableActorTypeCount !== 9) failures.push(`room entity frame coverage preview: expected 9 fully renderable C3C0 actor types, got ${result.c3c0RenderabilityFullyRenderableActorTypeCount}`);
  if (result.c3c0RenderabilityPartiallyRenderableActorTypeCount !== 1) failures.push(`room entity frame coverage preview: expected 1 partially renderable C3C0 actor type, got ${result.c3c0RenderabilityPartiallyRenderableActorTypeCount}`);
  if (result.c3c0RenderabilityBlockedPendingTileBaseTraceActorTypeCount !== 1) failures.push(`room entity frame coverage preview: expected 1 C3C0 actor type blocked on tile-base trace, got ${result.c3c0RenderabilityBlockedPendingTileBaseTraceActorTypeCount}`);
  if (result.c3c0RenderabilityNoHighConfidenceFrameAssetActorTypeCount !== 24) failures.push(`room entity frame coverage preview: expected 24 C3C0 actor types without high-confidence frame assets, got ${result.c3c0RenderabilityNoHighConfidenceFrameAssetActorTypeCount}`);
  if (result.c3c0RenderabilityFrameLinkedWithoutObservedDynamicUploadActorTypeCount !== 9) failures.push(`room entity frame coverage preview: expected 9 C3C0 frame-linked actor types without observed dynamic uploads, got ${result.c3c0RenderabilityFrameLinkedWithoutObservedDynamicUploadActorTypeCount}`);
  if (result.c3c0RenderabilityRenderableFixtureActorTypeCount !== 1) failures.push(`room entity frame coverage preview: expected 1 C3C0 renderable fixture actor type, got ${result.c3c0RenderabilityRenderableFixtureActorTypeCount}`);
  if (result.c3c0RenderabilityRenderableFixtureCount !== 13) failures.push(`room entity frame coverage preview: expected 13 C3C0 renderable fixtures, got ${result.c3c0RenderabilityRenderableFixtureCount}`);
  if (result.c3c0RenderabilityDynamicUploadBackedFixtureCount !== 12) failures.push(`room entity frame coverage preview: expected 12 dynamic-upload-backed C3C0 fixtures, got ${result.c3c0RenderabilityDynamicUploadBackedFixtureCount}`);
  if (result.c3c0RenderabilitySeedGroupCount !== 22) failures.push(`room entity frame coverage preview: expected 22 C3C0 renderability seed groups, got ${result.c3c0RenderabilitySeedGroupCount}`);
  if (result.c3c0RenderabilityPartialTraceEntityTypes !== '0x23') failures.push(`room entity frame coverage preview: expected C3C0 partial trace entity 0x23, got ${result.c3c0RenderabilityPartialTraceEntityTypes || 'none'}`);
  if (result.c3c0RenderabilityBlockedTraceEntityTypes !== '0x83') failures.push(`room entity frame coverage preview: expected C3C0 blocked trace entity 0x83, got ${result.c3c0RenderabilityBlockedTraceEntityTypes || 'none'}`);
  if (result.c3c0RenderabilityBestFrameStepCandidate !== '0x26') failures.push(`room entity frame coverage preview: expected C3C0 best frame-step candidate 0x26, got ${result.c3c0RenderabilityBestFrameStepCandidate || 'none'}`);
  if (result.c3c0RenderabilityBestFrameStepCandidateSeed !== '_LABEL_6D13_') failures.push(`room entity frame coverage preview: expected C3C0 best frame-step seed _LABEL_6D13_, got ${result.c3c0RenderabilityBestFrameStepCandidateSeed || 'none'}`);
  if (result.c3c0RenderabilityOamTileBaseField !== 'IX+63') failures.push(`room entity frame coverage preview: expected C3C0 renderability OAM tile-base field IX+63, got ${result.c3c0RenderabilityOamTileBaseField || 'none'}`);
  if (result.c3c0RenderabilityOamFrameStreamRoutine !== '_LABEL_792_') failures.push(`room entity frame coverage preview: expected C3C0 renderability OAM frame stream _LABEL_792_, got ${result.c3c0RenderabilityOamFrameStreamRoutine || 'none'}`);
  if (result.c3c0RenderabilityOamPositionProducerRoutine !== '_LABEL_760_') failures.push(`room entity frame coverage preview: expected C3C0 renderability OAM position producer _LABEL_760_, got ${result.c3c0RenderabilityOamPositionProducerRoutine || 'none'}`);
  if (result.c3c0RenderabilityPersistedRomByteCount !== 0) failures.push('room entity frame coverage preview: C3C0 renderability catalog reported persisted ROM bytes');
  if (result.c3c0RenderabilityPersistedTileByteCount !== 0) failures.push('room entity frame coverage preview: C3C0 renderability catalog reported persisted tile bytes');
  if (result.c3c0RenderabilityPersistedPixelCount !== 0) failures.push('room entity frame coverage preview: C3C0 renderability catalog reported persisted pixels');
  if (result.c3c0RenderabilityPersistedCoordinateCount !== 0) failures.push('room entity frame coverage preview: C3C0 renderability catalog reported persisted coordinates');
  if (result.c3c0RenderabilityPersistedGameplayValueCount !== 0) failures.push('room entity frame coverage preview: C3C0 renderability catalog reported persisted gameplay values');
  if (!result.c3c0FrameStepDiagnosticCatalogBacked) failures.push('room entity frame coverage preview: C3C0 frame-step diagnostic catalog was not linked');
  if (result.c3c0FrameStepDiagnosticCandidateEntityType !== '0x26') failures.push(`room entity frame coverage preview: expected C3C0 frame-step diagnostic candidate 0x26, got ${result.c3c0FrameStepDiagnosticCandidateEntityType || 'none'}`);
  if (result.c3c0FrameStepDiagnosticCandidateSeedLabel !== '_LABEL_6D13_') failures.push(`room entity frame coverage preview: expected C3C0 frame-step diagnostic seed _LABEL_6D13_, got ${result.c3c0FrameStepDiagnosticCandidateSeedLabel || 'none'}`);
  if (result.c3c0FrameStepDiagnosticBehaviorListSource !== '_DATA_6D47_') failures.push(`room entity frame coverage preview: expected C3C0 frame-step behavior source _DATA_6D47_, got ${result.c3c0FrameStepDiagnosticBehaviorListSource || 'none'}`);
  if (result.c3c0FrameStepDiagnosticBehaviorStateCount !== 5) failures.push(`room entity frame coverage preview: expected 5 C3C0 frame-step behavior states, got ${result.c3c0FrameStepDiagnosticBehaviorStateCount}`);
  if (result.c3c0FrameStepDiagnosticTargetRegionCount !== 3) failures.push(`room entity frame coverage preview: expected 3 C3C0 frame-step target regions, got ${result.c3c0FrameStepDiagnosticTargetRegionCount}`);
  if (result.c3c0FrameStepDiagnosticCallPlanEntryCount !== 23) failures.push(`room entity frame coverage preview: expected 23 C3C0 frame-step call-plan entries, got ${result.c3c0FrameStepDiagnosticCallPlanEntryCount}`);
  if (result.c3c0FrameStepDiagnosticUnresolvedCallPlanCount !== 0) failures.push(`room entity frame coverage preview: expected 0 unresolved C3C0 frame-step call-plan entries, got ${result.c3c0FrameStepDiagnosticUnresolvedCallPlanCount}`);
  if (result.c3c0FrameStepDiagnosticHelperTargetCount !== 8) failures.push(`room entity frame coverage preview: expected 8 C3C0 frame-step helper targets, got ${result.c3c0FrameStepDiagnosticHelperTargetCount}`);
  if (result.c3c0FrameStepDiagnosticHelperRoleResolvedTargetCount !== 8) failures.push(`room entity frame coverage preview: expected 8 role-resolved C3C0 frame-step helper targets, got ${result.c3c0FrameStepDiagnosticHelperRoleResolvedTargetCount}`);
  if (result.c3c0FrameStepDiagnosticExactSemanticsPendingHelperTargetCount !== 0) failures.push(`room entity frame coverage preview: expected 0 exact-semantics-pending C3C0 helper targets, got ${result.c3c0FrameStepDiagnosticExactSemanticsPendingHelperTargetCount}`);
  if (result.c3c0FrameStepDiagnosticInternalHelperEntryRoleKnownTargetCount !== 2) failures.push(`room entity frame coverage preview: expected 2 internal helper-entry-known C3C0 targets, got ${result.c3c0FrameStepDiagnosticInternalHelperEntryRoleKnownTargetCount}`);
  if (result.c3c0FrameStepDiagnosticLocalBehaviorSubroutineRoleKnownTargetCount !== 2) failures.push(`room entity frame coverage preview: expected 2 local behavior-subroutine-known C3C0 targets, got ${result.c3c0FrameStepDiagnosticLocalBehaviorSubroutineRoleKnownTargetCount}`);
  if (result.c3c0FrameStepDiagnosticRegionEntryRoleKnownTargetCount !== 4) failures.push(`room entity frame coverage preview: expected 4 region-entry-known C3C0 helper targets, got ${result.c3c0FrameStepDiagnosticRegionEntryRoleKnownTargetCount}`);
  if (result.c3c0FrameStepDiagnosticBehaviorStatesWithAnimationTick !== 4) failures.push(`room entity frame coverage preview: expected 4 C3C0 frame-step states with animation tick, got ${result.c3c0FrameStepDiagnosticBehaviorStatesWithAnimationTick}`);
  if (result.c3c0FrameStepDiagnosticBehaviorStatesWithCollisionPipeline !== 3) failures.push(`room entity frame coverage preview: expected 3 C3C0 frame-step states with collision pipeline, got ${result.c3c0FrameStepDiagnosticBehaviorStatesWithCollisionPipeline}`);
  if (result.c3c0FrameStepDiagnosticBehaviorStatesWithPackedMotionDeltaConsumer !== 3) failures.push(`room entity frame coverage preview: expected 3 C3C0 frame-step states with packed motion delta consumer, got ${result.c3c0FrameStepDiagnosticBehaviorStatesWithPackedMotionDeltaConsumer}`);
  if (result.c3c0FrameStepDiagnosticBehaviorStatesWithBehaviorStateWrite !== 4) failures.push(`room entity frame coverage preview: expected 4 C3C0 frame-step states with behavior-state writes, got ${result.c3c0FrameStepDiagnosticBehaviorStatesWithBehaviorStateWrite}`);
  if (result.c3c0FrameStepDiagnosticBehaviorStatesWithTimerCounterWrite !== 2) failures.push(`room entity frame coverage preview: expected 2 C3C0 frame-step states with timer-counter writes, got ${result.c3c0FrameStepDiagnosticBehaviorStatesWithTimerCounterWrite}`);
  if (result.c3c0FrameStepDiagnosticFieldTokenCount !== 21) failures.push(`room entity frame coverage preview: expected 21 C3C0 frame-step field tokens, got ${result.c3c0FrameStepDiagnosticFieldTokenCount}`);
  if (result.c3c0FrameStepDiagnosticBranchPredicatePendingStateCount !== 5) failures.push(`room entity frame coverage preview: expected 5 C3C0 frame-step states pending branch predicate trace, got ${result.c3c0FrameStepDiagnosticBranchPredicatePendingStateCount}`);
  if (result.c3c0FrameStepDiagnosticFrameExactStateCount !== 0) failures.push(`room entity frame coverage preview: expected 0 frame-exact C3C0 frame-step states, got ${result.c3c0FrameStepDiagnosticFrameExactStateCount}`);
  if (result.c3c0FrameStepDiagnosticDiagnosticStatus !== 'metadata_call_plan_ready_not_frame_exact') failures.push(`room entity frame coverage preview: expected metadata call-plan ready C3C0 diagnostic status, got ${result.c3c0FrameStepDiagnosticDiagnosticStatus || 'none'}`);
  if (result.c3c0FrameStepDiagnosticPersistedRomByteCount !== 0) failures.push('room entity frame coverage preview: C3C0 frame-step diagnostic reported persisted ROM bytes');
  if (result.c3c0FrameStepDiagnosticPersistedInstructionByteCount !== 0) failures.push('room entity frame coverage preview: C3C0 frame-step diagnostic reported persisted instruction bytes');
  if (result.c3c0FrameStepDiagnosticPersistedTileByteCount !== 0) failures.push('room entity frame coverage preview: C3C0 frame-step diagnostic reported persisted tile bytes');
  if (result.c3c0FrameStepDiagnosticPersistedPixelCount !== 0) failures.push('room entity frame coverage preview: C3C0 frame-step diagnostic reported persisted pixels');
  if (result.c3c0FrameStepDiagnosticPersistedCoordinateCount !== 0) failures.push('room entity frame coverage preview: C3C0 frame-step diagnostic reported persisted coordinates');
  if (result.c3c0FrameStepDiagnosticPersistedGameplayValueCount !== 0) failures.push('room entity frame coverage preview: C3C0 frame-step diagnostic reported persisted gameplay values');
  if (!result.c3c0FrameStepControlFlowCatalogBacked) failures.push('room entity frame coverage preview: C3C0 frame-step control-flow catalog was not linked');
  if (result.c3c0FrameStepControlFlowCandidateEntityType !== '0x26') failures.push(`room entity frame coverage preview: expected C3C0 control-flow candidate 0x26, got ${result.c3c0FrameStepControlFlowCandidateEntityType || 'none'}`);
  if (result.c3c0FrameStepControlFlowCandidateSeedLabel !== '_LABEL_6D13_') failures.push(`room entity frame coverage preview: expected C3C0 control-flow seed _LABEL_6D13_, got ${result.c3c0FrameStepControlFlowCandidateSeedLabel || 'none'}`);
  if (result.c3c0FrameStepControlFlowBehaviorListSource !== '_DATA_6D47_') failures.push(`room entity frame coverage preview: expected C3C0 control-flow behavior source _DATA_6D47_, got ${result.c3c0FrameStepControlFlowBehaviorListSource || 'none'}`);
  if (result.c3c0FrameStepControlFlowBehaviorStateCount !== 5) failures.push(`room entity frame coverage preview: expected 5 C3C0 control-flow behavior states, got ${result.c3c0FrameStepControlFlowBehaviorStateCount}`);
  if (result.c3c0FrameStepControlFlowRelativeBranchCount !== 16) failures.push(`room entity frame coverage preview: expected 16 C3C0 control-flow relative branches, got ${result.c3c0FrameStepControlFlowRelativeBranchCount}`);
  if (result.c3c0FrameStepControlFlowConditionalBranchCount !== 14) failures.push(`room entity frame coverage preview: expected 14 C3C0 control-flow conditional branches, got ${result.c3c0FrameStepControlFlowConditionalBranchCount}`);
  if (result.c3c0FrameStepControlFlowConditionalExitCount !== 7) failures.push(`room entity frame coverage preview: expected 7 C3C0 control-flow conditional exits, got ${result.c3c0FrameStepControlFlowConditionalExitCount}`);
  if (result.c3c0FrameStepControlFlowConditionalControlCount !== 21) failures.push(`room entity frame coverage preview: expected 21 C3C0 control-flow conditional controls, got ${result.c3c0FrameStepControlFlowConditionalControlCount}`);
  if (result.c3c0FrameStepControlFlowSymbolicPredicateCount !== 21) failures.push(`room entity frame coverage preview: expected 21 C3C0 control-flow symbolic predicates, got ${result.c3c0FrameStepControlFlowSymbolicPredicateCount}`);
  if (result.c3c0FrameStepControlFlowUnclassifiedConditionalControlCount !== 0) failures.push(`room entity frame coverage preview: expected 0 C3C0 control-flow source-pending controls, got ${result.c3c0FrameStepControlFlowUnclassifiedConditionalControlCount}`);
  if (result.c3c0FrameStepControlFlowSymbolicPredicateStateCount !== 5) failures.push(`room entity frame coverage preview: expected 5 C3C0 control-flow states with symbolic predicates, got ${result.c3c0FrameStepControlFlowSymbolicPredicateStateCount}`);
  if (result.c3c0FrameStepControlFlowFirstTickGuardStateCount !== 4) failures.push(`room entity frame coverage preview: expected 4 C3C0 control-flow first-tick guard states, got ${result.c3c0FrameStepControlFlowFirstTickGuardStateCount}`);
  if (result.c3c0FrameStepControlFlowBehaviorStateOperationStateCount !== 4) failures.push(`room entity frame coverage preview: expected 4 C3C0 control-flow behavior-state operation states, got ${result.c3c0FrameStepControlFlowBehaviorStateOperationStateCount}`);
  if (result.c3c0FrameStepControlFlowBehaviorStateWriteStateCount !== 4) failures.push(`room entity frame coverage preview: expected 4 C3C0 control-flow behavior-state writer states, got ${result.c3c0FrameStepControlFlowBehaviorStateWriteStateCount}`);
  if (result.c3c0FrameStepControlFlowTimerOperationStateCount !== 2) failures.push(`room entity frame coverage preview: expected 2 C3C0 control-flow timer operation states, got ${result.c3c0FrameStepControlFlowTimerOperationStateCount}`);
  if (result.c3c0FrameStepControlFlowCountdownOperationStateCount !== 2) failures.push(`room entity frame coverage preview: expected 2 C3C0 control-flow countdown states, got ${result.c3c0FrameStepControlFlowCountdownOperationStateCount}`);
  if (result.c3c0FrameStepControlFlowTimerOperationCount !== 10) failures.push(`room entity frame coverage preview: expected 10 C3C0 control-flow timer operations, got ${result.c3c0FrameStepControlFlowTimerOperationCount}`);
  if (result.c3c0FrameStepControlFlowCountdownOperationCount !== 2) failures.push(`room entity frame coverage preview: expected 2 C3C0 control-flow countdown operations, got ${result.c3c0FrameStepControlFlowCountdownOperationCount}`);
  if (result.c3c0FrameStepControlFlowFieldTokenCount !== 21) failures.push(`room entity frame coverage preview: expected 21 C3C0 control-flow field tokens, got ${result.c3c0FrameStepControlFlowFieldTokenCount}`);
  if (result.c3c0FrameStepControlFlowFrameExactStateCount !== 0) failures.push(`room entity frame coverage preview: expected 0 frame-exact C3C0 control-flow states, got ${result.c3c0FrameStepControlFlowFrameExactStateCount}`);
  if (result.c3c0FrameStepControlFlowDiagnosticStatus !== 'symbolic_control_flow_ready_not_frame_exact') failures.push(`room entity frame coverage preview: expected symbolic-ready C3C0 control-flow status, got ${result.c3c0FrameStepControlFlowDiagnosticStatus || 'none'}`);
  if (result.c3c0FrameStepControlFlowPersistedRomByteCount !== 0) failures.push('room entity frame coverage preview: C3C0 control-flow reported persisted ROM bytes');
  if (result.c3c0FrameStepControlFlowPersistedInstructionByteCount !== 0) failures.push('room entity frame coverage preview: C3C0 control-flow reported persisted instruction bytes');
  if (result.c3c0FrameStepControlFlowPersistedTileByteCount !== 0) failures.push('room entity frame coverage preview: C3C0 control-flow reported persisted tile bytes');
  if (result.c3c0FrameStepControlFlowPersistedPixelCount !== 0) failures.push('room entity frame coverage preview: C3C0 control-flow reported persisted pixels');
  if (result.c3c0FrameStepControlFlowPersistedCoordinateCount !== 0) failures.push('room entity frame coverage preview: C3C0 control-flow reported persisted coordinates');
  if (result.c3c0FrameStepControlFlowPersistedGameplayValueCount !== 0) failures.push('room entity frame coverage preview: C3C0 control-flow reported persisted gameplay values');
  if (!result.c3c0FrameStepTraceCatalogBacked) failures.push('room entity frame coverage preview: C3C0 frame-step trace catalog was not linked');
  if (result.c3c0FrameStepTraceCandidateEntityType !== '0x26') failures.push(`room entity frame coverage preview: expected C3C0 trace candidate 0x26, got ${result.c3c0FrameStepTraceCandidateEntityType || 'none'}`);
  if (result.c3c0FrameStepTraceCandidateSeedLabel !== '_LABEL_6D13_') failures.push(`room entity frame coverage preview: expected C3C0 trace seed _LABEL_6D13_, got ${result.c3c0FrameStepTraceCandidateSeedLabel || 'none'}`);
  if (result.c3c0FrameStepTraceBehaviorListSource !== '_DATA_6D47_') failures.push(`room entity frame coverage preview: expected C3C0 trace behavior source _DATA_6D47_, got ${result.c3c0FrameStepTraceBehaviorListSource || 'none'}`);
  if (result.c3c0FrameStepTraceBehaviorStateCount !== 5) failures.push(`room entity frame coverage preview: expected 5 C3C0 trace behavior states, got ${result.c3c0FrameStepTraceBehaviorStateCount}`);
  if (result.c3c0FrameStepTraceTraceStepCount !== 91) failures.push(`room entity frame coverage preview: expected 91 C3C0 trace steps, got ${result.c3c0FrameStepTraceTraceStepCount}`);
  if (result.c3c0FrameStepTraceFieldTouchCount !== 47) failures.push(`room entity frame coverage preview: expected 47 C3C0 trace field touches, got ${result.c3c0FrameStepTraceFieldTouchCount}`);
  if (result.c3c0FrameStepTraceHelperStubCount !== 23) failures.push(`room entity frame coverage preview: expected 23 C3C0 trace helper stubs, got ${result.c3c0FrameStepTraceHelperStubCount}`);
  if (result.c3c0FrameStepTraceHelperRoleKnownCount !== 23) failures.push(`room entity frame coverage preview: expected 23 C3C0 trace role-known helper stubs, got ${result.c3c0FrameStepTraceHelperRoleKnownCount}`);
  if (result.c3c0FrameStepTraceConditionalControlCount !== 21) failures.push(`room entity frame coverage preview: expected 21 C3C0 trace conditional controls, got ${result.c3c0FrameStepTraceConditionalControlCount}`);
  if (result.c3c0FrameStepTraceSymbolicPredicateCount !== 21) failures.push(`room entity frame coverage preview: expected 21 C3C0 trace symbolic predicates, got ${result.c3c0FrameStepTraceSymbolicPredicateCount}`);
  if (result.c3c0FrameStepTraceUnresolvedPredicateCount !== 0) failures.push(`room entity frame coverage preview: expected 0 C3C0 trace unresolved predicates, got ${result.c3c0FrameStepTraceUnresolvedPredicateCount}`);
  if (result.c3c0FrameStepTraceFirstTickGuardCount !== 4) failures.push(`room entity frame coverage preview: expected 4 C3C0 trace first-tick guards, got ${result.c3c0FrameStepTraceFirstTickGuardCount}`);
  if (result.c3c0FrameStepTraceBehaviorStateFieldTouchCount !== 12) failures.push(`room entity frame coverage preview: expected 12 C3C0 trace behavior-state touches, got ${result.c3c0FrameStepTraceBehaviorStateFieldTouchCount}`);
  if (result.c3c0FrameStepTraceTimerFieldTouchCount !== 10) failures.push(`room entity frame coverage preview: expected 10 C3C0 trace timer touches, got ${result.c3c0FrameStepTraceTimerFieldTouchCount}`);
  if (result.c3c0FrameStepTraceLiteralWithheldFieldTouchCount !== 14) failures.push(`room entity frame coverage preview: expected 14 C3C0 trace literal-withheld field touches, got ${result.c3c0FrameStepTraceLiteralWithheldFieldTouchCount}`);
  if (result.c3c0FrameStepTraceStatesWithHelperStubs !== 5) failures.push(`room entity frame coverage preview: expected 5 C3C0 trace states with helper stubs, got ${result.c3c0FrameStepTraceStatesWithHelperStubs}`);
  if (result.c3c0FrameStepTraceStatesWithFieldTouches !== 5) failures.push(`room entity frame coverage preview: expected 5 C3C0 trace states with field touches, got ${result.c3c0FrameStepTraceStatesWithFieldTouches}`);
  if (result.c3c0FrameStepTraceStatesWithConditionalControls !== 5) failures.push(`room entity frame coverage preview: expected 5 C3C0 trace states with conditionals, got ${result.c3c0FrameStepTraceStatesWithConditionalControls}`);
  if (result.c3c0FrameStepTraceStatesWithAllSymbolicPredicates !== 5) failures.push(`room entity frame coverage preview: expected 5 C3C0 trace states with all symbolic predicates, got ${result.c3c0FrameStepTraceStatesWithAllSymbolicPredicates}`);
  if (result.c3c0FrameStepTraceFieldTokenCount !== 21) failures.push(`room entity frame coverage preview: expected 21 C3C0 trace field tokens, got ${result.c3c0FrameStepTraceFieldTokenCount}`);
  if (result.c3c0FrameStepTraceHelperRoleCount !== 12) failures.push(`room entity frame coverage preview: expected 12 C3C0 trace helper roles, got ${result.c3c0FrameStepTraceHelperRoleCount}`);
  if (result.c3c0FrameStepTracePredicateKindCount !== 7) failures.push(`room entity frame coverage preview: expected 7 C3C0 trace predicate kinds, got ${result.c3c0FrameStepTracePredicateKindCount}`);
  if (result.c3c0FrameStepTraceFrameExactStateCount !== 0) failures.push(`room entity frame coverage preview: expected 0 frame-exact C3C0 trace states, got ${result.c3c0FrameStepTraceFrameExactStateCount}`);
  if (result.c3c0FrameStepTraceReadinessStatus !== 'read_only_trace_skeleton_ready_not_frame_exact') failures.push(`room entity frame coverage preview: expected C3C0 trace skeleton-ready status, got ${result.c3c0FrameStepTraceReadinessStatus || 'none'}`);
  if (result.c3c0FrameStepTracePersistedRomByteCount !== 0) failures.push('room entity frame coverage preview: C3C0 trace reported persisted ROM bytes');
  if (result.c3c0FrameStepTracePersistedInstructionByteCount !== 0) failures.push('room entity frame coverage preview: C3C0 trace reported persisted instruction bytes');
  if (result.c3c0FrameStepTracePersistedTileByteCount !== 0) failures.push('room entity frame coverage preview: C3C0 trace reported persisted tile bytes');
  if (result.c3c0FrameStepTracePersistedPixelCount !== 0) failures.push('room entity frame coverage preview: C3C0 trace reported persisted pixels');
  if (result.c3c0FrameStepTracePersistedCoordinateCount !== 0) failures.push('room entity frame coverage preview: C3C0 trace reported persisted coordinates');
  if (result.c3c0FrameStepTracePersistedGameplayValueCount !== 0) failures.push('room entity frame coverage preview: C3C0 trace reported persisted gameplay values');
  if (!result.c3c0FrameStepStepperPreviewBacked) failures.push('room entity frame coverage preview: C3C0 frame-step stepper preview was not linked');
  if (result.c3c0FrameStepStepperCandidateEntityType !== '0x26') failures.push(`room entity frame coverage preview: expected C3C0 stepper candidate 0x26, got ${result.c3c0FrameStepStepperCandidateEntityType || 'none'}`);
  if (result.c3c0FrameStepStepperCandidateSeedLabel !== '_LABEL_6D13_') failures.push(`room entity frame coverage preview: expected C3C0 stepper seed _LABEL_6D13_, got ${result.c3c0FrameStepStepperCandidateSeedLabel || 'none'}`);
  if (result.c3c0FrameStepStepperBehaviorListSource !== '_DATA_6D47_') failures.push(`room entity frame coverage preview: expected C3C0 stepper behavior source _DATA_6D47_, got ${result.c3c0FrameStepStepperBehaviorListSource || 'none'}`);
  if (result.c3c0FrameStepStepperStateCount !== 5) failures.push(`room entity frame coverage preview: expected 5 C3C0 stepper states, got ${result.c3c0FrameStepStepperStateCount}`);
  if (result.c3c0FrameStepStepperFrameCount !== 5) failures.push(`room entity frame coverage preview: expected 5 C3C0 stepper symbolic frames, got ${result.c3c0FrameStepStepperFrameCount}`);
  if (result.c3c0FrameStepStepperTraceStepCount !== 91) failures.push(`room entity frame coverage preview: expected 91 C3C0 stepper trace steps, got ${result.c3c0FrameStepStepperTraceStepCount}`);
  if (result.c3c0FrameStepStepperFieldTouchEventCount !== 47) failures.push(`room entity frame coverage preview: expected 47 C3C0 stepper field-touch events, got ${result.c3c0FrameStepStepperFieldTouchEventCount}`);
  if (result.c3c0FrameStepStepperHelperStubEventCount !== 23) failures.push(`room entity frame coverage preview: expected 23 C3C0 stepper helper-stub events, got ${result.c3c0FrameStepStepperHelperStubEventCount}`);
  if (result.c3c0FrameStepStepperConditionalEventCount !== 21) failures.push(`room entity frame coverage preview: expected 21 C3C0 stepper conditional events, got ${result.c3c0FrameStepStepperConditionalEventCount}`);
  if (result.c3c0FrameStepStepperSymbolicPredicateCount !== 21) failures.push(`room entity frame coverage preview: expected 21 C3C0 stepper symbolic predicates, got ${result.c3c0FrameStepStepperSymbolicPredicateCount}`);
  if (result.c3c0FrameStepStepperUnresolvedPredicateCount !== 0) failures.push(`room entity frame coverage preview: expected 0 C3C0 stepper unresolved predicates, got ${result.c3c0FrameStepStepperUnresolvedPredicateCount}`);
  if (result.c3c0FrameStepStepperFirstTickGuardCount !== 4) failures.push(`room entity frame coverage preview: expected 4 C3C0 stepper first-tick guards, got ${result.c3c0FrameStepStepperFirstTickGuardCount}`);
  if (result.c3c0FrameStepStepperRuntimeValueReadCount !== 0) failures.push('room entity frame coverage preview: C3C0 stepper reported runtime value reads');
  if (result.c3c0FrameStepStepperRuntimeValueWriteCount !== 0) failures.push('room entity frame coverage preview: C3C0 stepper reported runtime value writes');
  if (result.c3c0FrameStepStepperBranchOutcomeEvaluatedCount !== 0) failures.push('room entity frame coverage preview: C3C0 stepper reported evaluated branch outcomes');
  if (result.c3c0FrameStepStepperHelperEffectEvaluatedCount !== 0) failures.push('room entity frame coverage preview: C3C0 stepper reported evaluated helper effects');
  if (result.c3c0FrameStepStepperPersistedGameplayValueCount !== 0) failures.push('room entity frame coverage preview: C3C0 stepper reported persisted gameplay values');
  if (result.c3c0FrameStepStepperStatus !== 'read_only_stepper_preview_ready_no_runtime_values') failures.push(`room entity frame coverage preview: expected C3C0 stepper read-only status, got ${result.c3c0FrameStepStepperStatus || 'none'}`);
  if (result.c3c0FrameStepStepperAssetPolicy !== 'metadata_only_no_runtime_values_or_rom_bytes') failures.push('room entity frame coverage preview: C3C0 stepper metadata-only policy was not reported');
  if (!result.fixtureRuntimeDecoded) failures.push('room entity frame coverage preview: fixture runtime OAM-layout preview did not decode');
  if (result.fixtureRuntimePreviewedFixtureCount !== 43) failures.push(`room entity frame coverage preview: expected runtime preview of 43 fixtures, got ${result.fixtureRuntimePreviewedFixtureCount}`);
  if (result.fixtureRuntimeRenderedFixtureRowCount !== 40) failures.push(`room entity frame coverage preview: expected 40 runtime rendered fixture rows, got ${result.fixtureRuntimeRenderedFixtureRowCount}`);
  if (result.fixtureRuntimeRenderedTileCount !== 120) failures.push(`room entity frame coverage preview: expected 120 runtime rendered tile references, got ${result.fixtureRuntimeRenderedTileCount}`);
  if (result.fixtureRuntimeRenderedPieceCount !== 120) failures.push(`room entity frame coverage preview: expected 120 runtime rendered OAM pieces, got ${result.fixtureRuntimeRenderedPieceCount}`);
  if (result.fixtureRuntimeLayoutPreviewedFixtureCount !== 40) failures.push(`room entity frame coverage preview: expected 40 runtime OAM-layout fixture previews, got ${result.fixtureRuntimeLayoutPreviewedFixtureCount}`);
  if (result.fixtureRuntimeCoordinateMode !== 'normalized_piece_offsets_without_runtime_slot_position') failures.push(`room entity frame coverage preview: expected normalized coordinate preview mode, got ${result.fixtureRuntimeCoordinateMode || 'none'}`);
  if (result.fixtureRuntimeEmptyFixtureCount !== 3) failures.push(`room entity frame coverage preview: expected 3 runtime empty fixtures, got ${result.fixtureRuntimeEmptyFixtureCount}`);
  if (result.fixtureRuntimeUnresolvedTileRefCount !== 0) failures.push(`room entity frame coverage preview: expected 0 runtime unresolved tile references, got ${result.fixtureRuntimeUnresolvedTileRefCount}`);
  if (result.fixtureRuntimeSkippedFixtureCount !== 0) failures.push(`room entity frame coverage preview: expected 0 skipped runtime fixtures, got ${result.fixtureRuntimeSkippedFixtureCount}`);
  if (result.fixtureRuntimeWarningCount !== 0) failures.push(`room entity frame coverage preview: fixture runtime emitted ${result.fixtureRuntimeWarningCount} warning(s)`);
  if (result.fixtureRuntimeParseIssueCount !== 0) failures.push(`room entity frame coverage preview: fixture runtime has ${result.fixtureRuntimeParseIssueCount} parse issue(s)`);
  if (result.fixtureRuntimePersistedTileByteCount !== 0) failures.push('room entity frame coverage preview: fixture runtime reported persisted tile bytes');
  if (result.fixtureRuntimePersistedPixelCount !== 0) failures.push('room entity frame coverage preview: fixture runtime reported persisted pixels');
  if (result.fixtureRuntimePersistedCoordinateCount !== 0) failures.push('room entity frame coverage preview: fixture runtime reported persisted coordinates');
  if (result.persistedTileByteCount !== 0) failures.push('room entity frame coverage preview: tile bytes were reported as persisted');
  if (result.persistedPixelCount !== 0) failures.push('room entity frame coverage preview: pixels were reported as persisted');
  if (result.persistedCoordinateCount !== 0) failures.push('room entity frame coverage preview: coordinates were reported as persisted');
  if (result.assetPolicy !== 'metadata_only_no_rom_bytes_or_pixels') failures.push('room entity frame coverage preview: metadata-only frame coverage policy was not reported');
  return {
    summary: {
      ran: true,
      catalogId: result.catalogId || '',
      catalogBacked: Boolean(result.catalogBacked),
      totalDynamicEntityUploads: result.totalDynamicEntityUploads || 0,
      frameLinkedUploadCount: result.frameLinkedUploadCount || 0,
      fullyCoveredUploadCount: result.fullyCoveredUploadCount || 0,
      partialCoverageUploadCount: result.partialCoverageUploadCount || 0,
      noFrameAssetUploadCount: result.noFrameAssetUploadCount || 0,
      dynamicEntityTypeCount: result.dynamicEntityTypeCount || 0,
      frameLinkedEntityTypeCount: result.frameLinkedEntityTypeCount || 0,
      fullyCoveredEntityTypeCount: result.fullyCoveredEntityTypeCount || 0,
      needsTraceEntityTypeCount: result.needsTraceEntityTypeCount || 0,
      tracePriorityCatalogBacked: Boolean(result.tracePriorityCatalogBacked),
      tracePriorityEntityTypeCount: result.tracePriorityEntityTypeCount || 0,
      tracePriorityTopEntityType: result.tracePriorityTopEntityType || '',
      tracePriorityTopUploadCount: result.tracePriorityTopUploadCount || 0,
      tracePriorityPartialUploadCount: result.tracePriorityPartialUploadCount || 0,
      subrecordCoverageCatalogBacked: Boolean(result.subrecordCoverageCatalogBacked),
      subrecordCoverageEntityTypeCount: result.subrecordCoverageEntityTypeCount || 0,
      subrecordCoverageTotalFrameCount: result.subrecordCoverageTotalFrameCount || 0,
      subrecordCoverageRenderableFrameCount: result.subrecordCoverageRenderableFrameCount || 0,
      subrecordCoverageDynamicCoveredFrameCount: result.subrecordCoverageDynamicCoveredFrameCount || 0,
      subrecordCoverageNotCoveredFrameCount: result.subrecordCoverageNotCoveredFrameCount || 0,
      subrecordCoverageTopEntityType: result.subrecordCoverageTopEntityType || '',
      subrecordCoverageTopEntityFrameCount: result.subrecordCoverageTopEntityFrameCount || 0,
      subrecordCoverageTopEntityRenderableFrameCount: result.subrecordCoverageTopEntityRenderableFrameCount || 0,
      subrecordCoverageTopEntityNotCoveredFrameCount: result.subrecordCoverageTopEntityNotCoveredFrameCount || 0,
      subrecordCoverageParseIssueCount: result.subrecordCoverageParseIssueCount || 0,
      renderableFixtureCatalogBacked: Boolean(result.renderableFixtureCatalogBacked),
      renderableFixtureEntityTypeCount: result.renderableFixtureEntityTypeCount || 0,
      renderableFixtureCount: result.renderableFixtureCount || 0,
      renderableFixtureDynamicBackedCount: result.renderableFixtureDynamicBackedCount || 0,
      renderableFixtureEmptyFrameCount: result.renderableFixtureEmptyFrameCount || 0,
      renderableFixtureBlockedOrPartialSubrecordCount: result.renderableFixtureBlockedOrPartialSubrecordCount || 0,
      renderableFixtureTopEntityType: result.renderableFixtureTopEntityType || '',
      renderableFixtureTopEntityFixtureCount: result.renderableFixtureTopEntityFixtureCount || 0,
      renderableFixtureTopEntityBlockedSubrecordCount: result.renderableFixtureTopEntityBlockedSubrecordCount || 0,
      renderableFixtureParseIssueCount: result.renderableFixtureParseIssueCount || 0,
      oamSemanticsCatalogBacked: Boolean(result.oamSemanticsCatalogBacked),
      oamSemanticsCatalogId: result.oamSemanticsCatalogId || '',
      oamPieceRecordByteLength: result.oamPieceRecordByteLength || 0,
      oamOutputRecordByteLength: result.oamOutputRecordByteLength || 0,
      oamFrameStreamRoutine: result.oamFrameStreamRoutine || '',
      oamSlotScanRoutine: result.oamSlotScanRoutine || '',
      oamPositionProducerRoutine: result.oamPositionProducerRoutine || '',
      oamTileBaseField: result.oamTileBaseField || '',
      oamXBaseRam: result.oamXBaseRam || '',
      oamYBaseRam: result.oamYBaseRam || '',
      oamXBaseSlotFields: result.oamXBaseSlotFields || '',
      oamYBaseSlotFields: result.oamYBaseSlotFields || '',
      oamXCameraRam: result.oamXCameraRam || '',
      oamYCameraRam: result.oamYCameraRam || '',
      oamCameraSubtractFlag: result.oamCameraSubtractFlag || '',
      oamPersistedCoordinateCount: result.oamPersistedCoordinateCount || 0,
      slotCoordinateCatalogBacked: Boolean(result.slotCoordinateCatalogBacked),
      slotCoordinateCatalogId: result.slotCoordinateCatalogId || '',
      slotCoordinateFieldCount: result.slotCoordinateFieldCount || 0,
      slotCoordinateReferenceCount: result.slotCoordinateReferenceCount || 0,
      slotCoordinateReadReferenceCount: result.slotCoordinateReadReferenceCount || 0,
      slotCoordinateWriteReferenceCount: result.slotCoordinateWriteReferenceCount || 0,
      slotCoordinateReadWriteReferenceCount: result.slotCoordinateReadWriteReferenceCount || 0,
      slotCoordinateUnknownReferenceCount: result.slotCoordinateUnknownReferenceCount || 0,
      slotCoordinateRoutineReferenceCount: result.slotCoordinateRoutineReferenceCount || 0,
      slotCoordinateConfirmedContextReferenceCount: result.slotCoordinateConfirmedContextReferenceCount || 0,
      slotCoordinateCandidateContextReferenceCount: result.slotCoordinateCandidateContextReferenceCount || 0,
      slotCoordinateRoomEntityInitializerLabel: result.slotCoordinateRoomEntityInitializerLabel || '',
      slotCoordinateOamPositionProducerLabel: result.slotCoordinateOamPositionProducerLabel || '',
      slotCoordinateOamFrameStreamConsumerLabel: result.slotCoordinateOamFrameStreamConsumerLabel || '',
      slotCoordinateXSlotFields: result.slotCoordinateXSlotFields || '',
      slotCoordinateYSlotFields: result.slotCoordinateYSlotFields || '',
      slotCoordinateXRoomRecordSourceFields: result.slotCoordinateXRoomRecordSourceFields || '',
      slotCoordinateYRoomRecordSourceFields: result.slotCoordinateYRoomRecordSourceFields || '',
      slotCoordinateXBaseOutputRam: result.slotCoordinateXBaseOutputRam || '',
      slotCoordinateYBaseOutputRam: result.slotCoordinateYBaseOutputRam || '',
      slotCoordinateRuntimePositionCoordinateModelStatus: result.slotCoordinateRuntimePositionCoordinateModelStatus || '',
      slotCoordinatePersistedCoordinateCount: result.slotCoordinatePersistedCoordinateCount || 0,
      positionIntegratorCatalogBacked: Boolean(result.positionIntegratorCatalogBacked),
      positionIntegratorCatalogId: result.positionIntegratorCatalogId || '',
      positionIntegratorRoutineCount: result.positionIntegratorRoutineCount || 0,
      positionIntegratorBothAxesRoutine: result.positionIntegratorBothAxesRoutine || '',
      positionIntegratorXOnlyRoutine: result.positionIntegratorXOnlyRoutine || '',
      positionIntegratorYOnlyRoutine: result.positionIntegratorYOnlyRoutine || '',
      positionIntegratorBothAxisExternalCallCount: result.positionIntegratorBothAxisExternalCallCount || 0,
      positionIntegratorXOnlyExternalCallCount: result.positionIntegratorXOnlyExternalCallCount || 0,
      positionIntegratorYOnlyExternalCallCount: result.positionIntegratorYOnlyExternalCallCount || 0,
      positionIntegratorYOnlyInternalCallCount: result.positionIntegratorYOnlyInternalCallCount || 0,
      positionIntegratorTotalExternalCallCount: result.positionIntegratorTotalExternalCallCount || 0,
      positionIntegratorUniqueExternalCallerCount: result.positionIntegratorUniqueExternalCallerCount || 0,
      positionIntegratorXVelocityFields: result.positionIntegratorXVelocityFields || '',
      positionIntegratorYVelocityFields: result.positionIntegratorYVelocityFields || '',
      positionIntegratorXVisibleCoordinateFields: result.positionIntegratorXVisibleCoordinateFields || '',
      positionIntegratorYVisibleCoordinateFields: result.positionIntegratorYVisibleCoordinateFields || '',
      positionIntegratorPersistedGameplayValueCount: result.positionIntegratorPersistedGameplayValueCount || 0,
      velocityFieldCatalogBacked: Boolean(result.velocityFieldCatalogBacked),
      velocityFieldCatalogId: result.velocityFieldCatalogId || '',
      velocityFieldFieldCount: result.velocityFieldFieldCount || 0,
      velocityFieldReferenceCount: result.velocityFieldReferenceCount || 0,
      velocityFieldReadReferenceCount: result.velocityFieldReadReferenceCount || 0,
      velocityFieldWriteReferenceCount: result.velocityFieldWriteReferenceCount || 0,
      velocityFieldReadWriteReferenceCount: result.velocityFieldReadWriteReferenceCount || 0,
      velocityFieldUnknownReferenceCount: result.velocityFieldUnknownReferenceCount || 0,
      velocityFieldWriterReferenceCount: result.velocityFieldWriterReferenceCount || 0,
      velocityFieldReaderReferenceCount: result.velocityFieldReaderReferenceCount || 0,
      velocityFieldRoutineReferenceCount: result.velocityFieldRoutineReferenceCount || 0,
      velocityFieldWriterRoutineCount: result.velocityFieldWriterRoutineCount || 0,
      velocityFieldReaderRoutineCount: result.velocityFieldReaderRoutineCount || 0,
      velocityFieldConfirmedContextReferenceCount: result.velocityFieldConfirmedContextReferenceCount || 0,
      velocityFieldCandidateContextReferenceCount: result.velocityFieldCandidateContextReferenceCount || 0,
      velocityFieldXVelocityFields: result.velocityFieldXVelocityFields || '',
      velocityFieldYVelocityFields: result.velocityFieldYVelocityFields || '',
      velocityFieldXIntegratorConsumer: result.velocityFieldXIntegratorConsumer || '',
      velocityFieldYIntegratorConsumer: result.velocityFieldYIntegratorConsumer || '',
      velocityFieldXVelocitySignedDeltaHelper: result.velocityFieldXVelocitySignedDeltaHelper || '',
      velocityFieldYVelocitySignedDeltaHelper: result.velocityFieldYVelocitySignedDeltaHelper || '',
      velocityFieldXContactResponseHelper: result.velocityFieldXContactResponseHelper || '',
      velocityFieldYContactResponseHelpers: result.velocityFieldYContactResponseHelpers || '',
      velocityFieldTableDrivenInitializer: result.velocityFieldTableDrivenInitializer || '',
      velocityFieldPersistedGameplayValueCount: result.velocityFieldPersistedGameplayValueCount || 0,
      motionDeltaCatalogBacked: Boolean(result.motionDeltaCatalogBacked),
      motionDeltaCatalogId: result.motionDeltaCatalogId || '',
      motionDeltaFieldCount: result.motionDeltaFieldCount || 0,
      motionDeltaReferenceCount: result.motionDeltaReferenceCount || 0,
      motionDeltaReadReferenceCount: result.motionDeltaReadReferenceCount || 0,
      motionDeltaWriteReferenceCount: result.motionDeltaWriteReferenceCount || 0,
      motionDeltaReadWriteReferenceCount: result.motionDeltaReadWriteReferenceCount || 0,
      motionDeltaUnknownReferenceCount: result.motionDeltaUnknownReferenceCount || 0,
      motionDeltaWriterReferenceCount: result.motionDeltaWriterReferenceCount || 0,
      motionDeltaReaderReferenceCount: result.motionDeltaReaderReferenceCount || 0,
      motionDeltaRoutineReferenceCount: result.motionDeltaRoutineReferenceCount || 0,
      motionDeltaWriterRoutineCount: result.motionDeltaWriterRoutineCount || 0,
      motionDeltaReaderRoutineCount: result.motionDeltaReaderRoutineCount || 0,
      motionDeltaConfirmedContextReferenceCount: result.motionDeltaConfirmedContextReferenceCount || 0,
      motionDeltaCandidateContextReferenceCount: result.motionDeltaCandidateContextReferenceCount || 0,
      motionDeltaXDeltaField: result.motionDeltaXDeltaField || '',
      motionDeltaYDeltaField: result.motionDeltaYDeltaField || '',
      motionDeltaXVelocityDeltaConsumer: result.motionDeltaXVelocityDeltaConsumer || '',
      motionDeltaYVelocityDeltaConsumer: result.motionDeltaYVelocityDeltaConsumer || '',
      motionDeltaCombinedVelocityDeltaEntry: result.motionDeltaCombinedVelocityDeltaEntry || '',
      motionDeltaXGlobalAccumulatorInput: result.motionDeltaXGlobalAccumulatorInput || '',
      motionDeltaYGlobalAccumulatorInput: result.motionDeltaYGlobalAccumulatorInput || '',
      motionDeltaC600MotionControllerGateRoutines: result.motionDeltaC600MotionControllerGateRoutines || '',
      motionDeltaCollisionReactionWriters: result.motionDeltaCollisionReactionWriters || '',
      motionDeltaTableDrivenInitializer: result.motionDeltaTableDrivenInitializer || '',
      motionDeltaPersistedGameplayValueCount: result.motionDeltaPersistedGameplayValueCount || 0,
      motionDeltaBehaviorCatalogBacked: Boolean(result.motionDeltaBehaviorCatalogBacked),
      motionDeltaBehaviorCatalogId: result.motionDeltaBehaviorCatalogId || '',
      motionDeltaBehaviorWriterRoutineCount: result.motionDeltaBehaviorWriterRoutineCount || 0,
      motionDeltaBehaviorLinkedWriterRoutineCount: result.motionDeltaBehaviorLinkedWriterRoutineCount || 0,
      motionDeltaBehaviorBehaviorTableLinkedWriterRoutineCount: result.motionDeltaBehaviorBehaviorTableLinkedWriterRoutineCount || 0,
      motionDeltaBehaviorC3c0InitializerWriterRoutineCount: result.motionDeltaBehaviorC3c0InitializerWriterRoutineCount || 0,
      motionDeltaBehaviorAuxiliaryActorWriterRoutineCount: result.motionDeltaBehaviorAuxiliaryActorWriterRoutineCount || 0,
      motionDeltaBehaviorC640PairSlotWriterRoutineCount: result.motionDeltaBehaviorC640PairSlotWriterRoutineCount || 0,
      motionDeltaBehaviorC740SlotWriterRoutineCount: result.motionDeltaBehaviorC740SlotWriterRoutineCount || 0,
      motionDeltaBehaviorC600RecordInitializerWriterRoutineCount: result.motionDeltaBehaviorC600RecordInitializerWriterRoutineCount || 0,
      motionDeltaBehaviorC600CollisionResponseWriterRoutineCount: result.motionDeltaBehaviorC600CollisionResponseWriterRoutineCount || 0,
      motionDeltaBehaviorBank2SceneWriterRoutineCount: result.motionDeltaBehaviorBank2SceneWriterRoutineCount || 0,
      motionDeltaBehaviorBank2TransitionWriterRoutineCount: result.motionDeltaBehaviorBank2TransitionWriterRoutineCount || 0,
      motionDeltaBehaviorGameplayLookupWriterRoutineCount: result.motionDeltaBehaviorGameplayLookupWriterRoutineCount || 0,
      motionDeltaBehaviorUnresolvedWriterRoutineCount: result.motionDeltaBehaviorUnresolvedWriterRoutineCount || 0,
      motionDeltaBehaviorDirectOrScheduledDeltaConsumerLinkedWriterRoutineCount: result.motionDeltaBehaviorDirectOrScheduledDeltaConsumerLinkedWriterRoutineCount || 0,
      motionDeltaBehaviorMotionSeedOnlyWriterRoutineCount: result.motionDeltaBehaviorMotionSeedOnlyWriterRoutineCount || 0,
      motionDeltaBehaviorWriterReferenceCount: result.motionDeltaBehaviorWriterReferenceCount || 0,
      motionDeltaBehaviorReaderReferenceCountInWriterRoutines: result.motionDeltaBehaviorReaderReferenceCountInWriterRoutines || 0,
      motionDeltaBehaviorPersistedGameplayValueCount: result.motionDeltaBehaviorPersistedGameplayValueCount || 0,
      c3c0MotionSeedCatalogBacked: Boolean(result.c3c0MotionSeedCatalogBacked),
      c3c0MotionSeedCatalogId: result.c3c0MotionSeedCatalogId || '',
      c3c0MotionSeedSeedRoutineCount: result.c3c0MotionSeedSeedRoutineCount || 0,
      c3c0MotionSeedBehaviorListResolvedSeedRoutineCount: result.c3c0MotionSeedBehaviorListResolvedSeedRoutineCount || 0,
      c3c0MotionSeedDirectInitializerBehaviorListSeedRoutineCount: result.c3c0MotionSeedDirectInitializerBehaviorListSeedRoutineCount || 0,
      c3c0MotionSeedCallerProvidedBehaviorListSeedRoutineCount: result.c3c0MotionSeedCallerProvidedBehaviorListSeedRoutineCount || 0,
      c3c0MotionSeedUnresolvedBehaviorListSeedRoutineCount: result.c3c0MotionSeedUnresolvedBehaviorListSeedRoutineCount || 0,
      c3c0MotionSeedBehaviorListSourceCount: result.c3c0MotionSeedBehaviorListSourceCount || 0,
      c3c0MotionSeedUniqueBehaviorListExpressionCount: result.c3c0MotionSeedUniqueBehaviorListExpressionCount || 0,
      c3c0MotionSeedPointerAdjustmentExpressionCount: result.c3c0MotionSeedPointerAdjustmentExpressionCount || 0,
      c3c0MotionSeedTotalTableEntryReferences: result.c3c0MotionSeedTotalTableEntryReferences || 0,
      c3c0MotionSeedTotalWriterReferenceCount: result.c3c0MotionSeedTotalWriterReferenceCount || 0,
      c3c0MotionSeedPersistedGameplayValueCount: result.c3c0MotionSeedPersistedGameplayValueCount || 0,
      c3c0MotionSeedTargetCatalogBacked: Boolean(result.c3c0MotionSeedTargetCatalogBacked),
      c3c0MotionSeedTargetCatalogId: result.c3c0MotionSeedTargetCatalogId || '',
      c3c0MotionSeedTargetSeedRoutineCount: result.c3c0MotionSeedTargetSeedRoutineCount || 0,
      c3c0MotionSeedTargetBehaviorListSourceCount: result.c3c0MotionSeedTargetBehaviorListSourceCount || 0,
      c3c0MotionSeedTargetLinkedBehaviorListSourceCount: result.c3c0MotionSeedTargetLinkedBehaviorListSourceCount || 0,
      c3c0MotionSeedTargetMissingBehaviorListSourceCount: result.c3c0MotionSeedTargetMissingBehaviorListSourceCount || 0,
      c3c0MotionSeedTargetTargetEntryCount: result.c3c0MotionSeedTargetTargetEntryCount || 0,
      c3c0MotionSeedTargetUniqueTargetRegionCount: result.c3c0MotionSeedTargetUniqueTargetRegionCount || 0,
      c3c0MotionSeedTargetSeedRoutinesWithMultipleBehaviorLists: result.c3c0MotionSeedTargetSeedRoutinesWithMultipleBehaviorLists || 0,
      c3c0MotionSeedTargetSeedRoutinesWithMissingBehaviorLists: result.c3c0MotionSeedTargetSeedRoutinesWithMissingBehaviorLists || 0,
      c3c0MotionSeedTargetSeedRoutinesWithTargetLinks: result.c3c0MotionSeedTargetSeedRoutinesWithTargetLinks || 0,
      c3c0MotionSeedTargetMaxTargetEntriesPerSeed: result.c3c0MotionSeedTargetMaxTargetEntriesPerSeed || 0,
      c3c0MotionSeedTargetTotalTableEntryReferences: result.c3c0MotionSeedTargetTotalTableEntryReferences || 0,
      c3c0MotionSeedTargetPersistedGameplayValueCount: result.c3c0MotionSeedTargetPersistedGameplayValueCount || 0,
      c3c0BehaviorTargetSemanticsCatalogBacked: Boolean(result.c3c0BehaviorTargetSemanticsCatalogBacked),
      c3c0BehaviorTargetSemanticsCatalogId: result.c3c0BehaviorTargetSemanticsCatalogId || '',
      c3c0BehaviorTargetSemanticsSourceTargetEntryCount: result.c3c0BehaviorTargetSemanticsSourceTargetEntryCount || 0,
      c3c0BehaviorTargetSemanticsUniqueTargetOffsetCount: result.c3c0BehaviorTargetSemanticsUniqueTargetOffsetCount || 0,
      c3c0BehaviorTargetSemanticsTargetRegionCount: result.c3c0BehaviorTargetSemanticsTargetRegionCount || 0,
      c3c0BehaviorTargetSemanticsTargetsWithKnownHelperCalls: result.c3c0BehaviorTargetSemanticsTargetsWithKnownHelperCalls || 0,
      c3c0BehaviorTargetSemanticsTargetsWithPackedMotionDeltaConsumer: result.c3c0BehaviorTargetSemanticsTargetsWithPackedMotionDeltaConsumer || 0,
      c3c0BehaviorTargetSemanticsTargetsWithVelocityIntegrator: result.c3c0BehaviorTargetSemanticsTargetsWithVelocityIntegrator || 0,
      c3c0BehaviorTargetSemanticsTargetsWithCollisionPipeline: result.c3c0BehaviorTargetSemanticsTargetsWithCollisionPipeline || 0,
      c3c0BehaviorTargetSemanticsTargetsWithAnimationTick: result.c3c0BehaviorTargetSemanticsTargetsWithAnimationTick || 0,
      c3c0BehaviorTargetSemanticsTargetsWithBehaviorStateWrite: result.c3c0BehaviorTargetSemanticsTargetsWithBehaviorStateWrite || 0,
      c3c0BehaviorTargetSemanticsHelperCallCount: result.c3c0BehaviorTargetSemanticsHelperCallCount || 0,
      c3c0BehaviorTargetSemanticsWarningTargetCount: result.c3c0BehaviorTargetSemanticsWarningTargetCount || 0,
      c3c0BehaviorTargetSemanticsPersistedRomByteCount: result.c3c0BehaviorTargetSemanticsPersistedRomByteCount || 0,
      c3c0BehaviorTargetSemanticsPersistedGameplayValueCount: result.c3c0BehaviorTargetSemanticsPersistedGameplayValueCount || 0,
      c3c0ActorFamilyCatalogBacked: Boolean(result.c3c0ActorFamilyCatalogBacked),
      c3c0ActorFamilyCatalogId: result.c3c0ActorFamilyCatalogId || '',
      c3c0ActorFamilyRawEntityTypeCount: result.c3c0ActorFamilyRawEntityTypeCount || 0,
      c3c0ActorFamilySelectorTypeCount: result.c3c0ActorFamilySelectorTypeCount || 0,
      c3c0ActorFamilyDirectSeedEntityTypeCount: result.c3c0ActorFamilyDirectSeedEntityTypeCount || 0,
      c3c0ActorFamilyTailSeedEntityTypeCount: result.c3c0ActorFamilyTailSeedEntityTypeCount || 0,
      c3c0ActorFamilySeedRoutineCount: result.c3c0ActorFamilySeedRoutineCount || 0,
      c3c0ActorFamilySeedGroupCount: result.c3c0ActorFamilySeedGroupCount || 0,
      c3c0ActorFamilyBehaviorListLinkedEntityTypeCount: result.c3c0ActorFamilyBehaviorListLinkedEntityTypeCount || 0,
      c3c0ActorFamilyMissingBehaviorListSourceEntityTypeCount: result.c3c0ActorFamilyMissingBehaviorListSourceEntityTypeCount || 0,
      c3c0ActorFamilyTargetLinkedEntityTypeCount: result.c3c0ActorFamilyTargetLinkedEntityTypeCount || 0,
      c3c0ActorFamilyTargetEntryReferenceCount: result.c3c0ActorFamilyTargetEntryReferenceCount || 0,
      c3c0ActorFamilyUniqueTargetOffsetCount: result.c3c0ActorFamilyUniqueTargetOffsetCount || 0,
      c3c0ActorFamilyActorTypesWithPackedMotionDeltaConsumer: result.c3c0ActorFamilyActorTypesWithPackedMotionDeltaConsumer || 0,
      c3c0ActorFamilyActorTypesWithCollisionPipeline: result.c3c0ActorFamilyActorTypesWithCollisionPipeline || 0,
      c3c0ActorFamilyActorTypesWithAnimationTick: result.c3c0ActorFamilyActorTypesWithAnimationTick || 0,
      c3c0ActorFamilyFrameLinkedEntityTypeCount: result.c3c0ActorFamilyFrameLinkedEntityTypeCount || 0,
      c3c0ActorFamilyDynamicUploadedEntityTypeCount: result.c3c0ActorFamilyDynamicUploadedEntityTypeCount || 0,
      c3c0ActorFamilyFullyCoveredEntityTypeCount: result.c3c0ActorFamilyFullyCoveredEntityTypeCount || 0,
      c3c0ActorFamilyPartialCoverageEntityTypeCount: result.c3c0ActorFamilyPartialCoverageEntityTypeCount || 0,
      c3c0ActorFamilyWarningActorTypeCount: result.c3c0ActorFamilyWarningActorTypeCount || 0,
      c3c0ActorFamilyPersistedRomByteCount: result.c3c0ActorFamilyPersistedRomByteCount || 0,
      c3c0ActorFamilyPersistedCoordinateCount: result.c3c0ActorFamilyPersistedCoordinateCount || 0,
      c3c0ActorFamilyPersistedPixelCount: result.c3c0ActorFamilyPersistedPixelCount || 0,
      c3c0ActorFamilyPersistedGameplayValueCount: result.c3c0ActorFamilyPersistedGameplayValueCount || 0,
      c3c0RenderabilityCatalogBacked: Boolean(result.c3c0RenderabilityCatalogBacked),
      c3c0RenderabilityCatalogId: result.c3c0RenderabilityCatalogId || '',
      c3c0RenderabilityActorTypeCount: result.c3c0RenderabilityActorTypeCount || 0,
      c3c0RenderabilityFrameLinkedActorTypeCount: result.c3c0RenderabilityFrameLinkedActorTypeCount || 0,
      c3c0RenderabilityDynamicUploadedActorTypeCount: result.c3c0RenderabilityDynamicUploadedActorTypeCount || 0,
      c3c0RenderabilityFullyRenderableActorTypeCount: result.c3c0RenderabilityFullyRenderableActorTypeCount || 0,
      c3c0RenderabilityPartiallyRenderableActorTypeCount: result.c3c0RenderabilityPartiallyRenderableActorTypeCount || 0,
      c3c0RenderabilityBlockedPendingTileBaseTraceActorTypeCount: result.c3c0RenderabilityBlockedPendingTileBaseTraceActorTypeCount || 0,
      c3c0RenderabilityNoHighConfidenceFrameAssetActorTypeCount: result.c3c0RenderabilityNoHighConfidenceFrameAssetActorTypeCount || 0,
      c3c0RenderabilityFrameLinkedWithoutObservedDynamicUploadActorTypeCount: result.c3c0RenderabilityFrameLinkedWithoutObservedDynamicUploadActorTypeCount || 0,
      c3c0RenderabilityRenderableFixtureActorTypeCount: result.c3c0RenderabilityRenderableFixtureActorTypeCount || 0,
      c3c0RenderabilityRenderableFixtureCount: result.c3c0RenderabilityRenderableFixtureCount || 0,
      c3c0RenderabilityDynamicUploadBackedFixtureCount: result.c3c0RenderabilityDynamicUploadBackedFixtureCount || 0,
      c3c0RenderabilitySeedGroupCount: result.c3c0RenderabilitySeedGroupCount || 0,
      c3c0RenderabilityPartialTraceEntityTypes: result.c3c0RenderabilityPartialTraceEntityTypes || '',
      c3c0RenderabilityBlockedTraceEntityTypes: result.c3c0RenderabilityBlockedTraceEntityTypes || '',
      c3c0RenderabilityBestFrameStepCandidate: result.c3c0RenderabilityBestFrameStepCandidate || '',
      c3c0RenderabilityBestFrameStepCandidateSeed: result.c3c0RenderabilityBestFrameStepCandidateSeed || '',
      c3c0RenderabilityBestFrameStepCandidateScore: result.c3c0RenderabilityBestFrameStepCandidateScore || 0,
      c3c0RenderabilityOamTileBaseField: result.c3c0RenderabilityOamTileBaseField || '',
      c3c0RenderabilityOamFrameStreamRoutine: result.c3c0RenderabilityOamFrameStreamRoutine || '',
      c3c0RenderabilityOamPositionProducerRoutine: result.c3c0RenderabilityOamPositionProducerRoutine || '',
      c3c0RenderabilityPersistedRomByteCount: result.c3c0RenderabilityPersistedRomByteCount || 0,
      c3c0RenderabilityPersistedTileByteCount: result.c3c0RenderabilityPersistedTileByteCount || 0,
      c3c0RenderabilityPersistedPixelCount: result.c3c0RenderabilityPersistedPixelCount || 0,
      c3c0RenderabilityPersistedCoordinateCount: result.c3c0RenderabilityPersistedCoordinateCount || 0,
      c3c0RenderabilityPersistedGameplayValueCount: result.c3c0RenderabilityPersistedGameplayValueCount || 0,
      c3c0FrameStepDiagnosticCatalogBacked: Boolean(result.c3c0FrameStepDiagnosticCatalogBacked),
      c3c0FrameStepDiagnosticCatalogId: result.c3c0FrameStepDiagnosticCatalogId || '',
      c3c0FrameStepDiagnosticCandidateEntityType: result.c3c0FrameStepDiagnosticCandidateEntityType || '',
      c3c0FrameStepDiagnosticCandidateSeedLabel: result.c3c0FrameStepDiagnosticCandidateSeedLabel || '',
      c3c0FrameStepDiagnosticBehaviorListSource: result.c3c0FrameStepDiagnosticBehaviorListSource || '',
      c3c0FrameStepDiagnosticBehaviorStateCount: result.c3c0FrameStepDiagnosticBehaviorStateCount || 0,
      c3c0FrameStepDiagnosticTargetRegionCount: result.c3c0FrameStepDiagnosticTargetRegionCount || 0,
      c3c0FrameStepDiagnosticCallPlanEntryCount: result.c3c0FrameStepDiagnosticCallPlanEntryCount || 0,
      c3c0FrameStepDiagnosticUnresolvedCallPlanCount: result.c3c0FrameStepDiagnosticUnresolvedCallPlanCount || 0,
      c3c0FrameStepDiagnosticHelperTargetCount: result.c3c0FrameStepDiagnosticHelperTargetCount || 0,
      c3c0FrameStepDiagnosticHelperRoleResolvedTargetCount: result.c3c0FrameStepDiagnosticHelperRoleResolvedTargetCount || 0,
      c3c0FrameStepDiagnosticExactSemanticsPendingHelperTargetCount: result.c3c0FrameStepDiagnosticExactSemanticsPendingHelperTargetCount || 0,
      c3c0FrameStepDiagnosticInternalHelperEntryRoleKnownTargetCount: result.c3c0FrameStepDiagnosticInternalHelperEntryRoleKnownTargetCount || 0,
      c3c0FrameStepDiagnosticLocalBehaviorSubroutineRoleKnownTargetCount: result.c3c0FrameStepDiagnosticLocalBehaviorSubroutineRoleKnownTargetCount || 0,
      c3c0FrameStepDiagnosticRegionEntryRoleKnownTargetCount: result.c3c0FrameStepDiagnosticRegionEntryRoleKnownTargetCount || 0,
      c3c0FrameStepDiagnosticBehaviorStatesWithAnimationTick: result.c3c0FrameStepDiagnosticBehaviorStatesWithAnimationTick || 0,
      c3c0FrameStepDiagnosticBehaviorStatesWithCollisionPipeline: result.c3c0FrameStepDiagnosticBehaviorStatesWithCollisionPipeline || 0,
      c3c0FrameStepDiagnosticBehaviorStatesWithPackedMotionDeltaConsumer: result.c3c0FrameStepDiagnosticBehaviorStatesWithPackedMotionDeltaConsumer || 0,
      c3c0FrameStepDiagnosticBehaviorStatesWithBehaviorStateWrite: result.c3c0FrameStepDiagnosticBehaviorStatesWithBehaviorStateWrite || 0,
      c3c0FrameStepDiagnosticBehaviorStatesWithTimerCounterWrite: result.c3c0FrameStepDiagnosticBehaviorStatesWithTimerCounterWrite || 0,
      c3c0FrameStepDiagnosticFieldTokenCount: result.c3c0FrameStepDiagnosticFieldTokenCount || 0,
      c3c0FrameStepDiagnosticBranchPredicatePendingStateCount: result.c3c0FrameStepDiagnosticBranchPredicatePendingStateCount || 0,
      c3c0FrameStepDiagnosticFrameExactStateCount: result.c3c0FrameStepDiagnosticFrameExactStateCount || 0,
      c3c0FrameStepDiagnosticDiagnosticStatus: result.c3c0FrameStepDiagnosticDiagnosticStatus || '',
      c3c0FrameStepDiagnosticPersistedRomByteCount: result.c3c0FrameStepDiagnosticPersistedRomByteCount || 0,
      c3c0FrameStepDiagnosticPersistedInstructionByteCount: result.c3c0FrameStepDiagnosticPersistedInstructionByteCount || 0,
      c3c0FrameStepDiagnosticPersistedTileByteCount: result.c3c0FrameStepDiagnosticPersistedTileByteCount || 0,
      c3c0FrameStepDiagnosticPersistedPixelCount: result.c3c0FrameStepDiagnosticPersistedPixelCount || 0,
      c3c0FrameStepDiagnosticPersistedCoordinateCount: result.c3c0FrameStepDiagnosticPersistedCoordinateCount || 0,
      c3c0FrameStepDiagnosticPersistedGameplayValueCount: result.c3c0FrameStepDiagnosticPersistedGameplayValueCount || 0,
      c3c0FrameStepControlFlowCatalogBacked: Boolean(result.c3c0FrameStepControlFlowCatalogBacked),
      c3c0FrameStepControlFlowCatalogId: result.c3c0FrameStepControlFlowCatalogId || '',
      c3c0FrameStepControlFlowCandidateEntityType: result.c3c0FrameStepControlFlowCandidateEntityType || '',
      c3c0FrameStepControlFlowCandidateSeedLabel: result.c3c0FrameStepControlFlowCandidateSeedLabel || '',
      c3c0FrameStepControlFlowBehaviorListSource: result.c3c0FrameStepControlFlowBehaviorListSource || '',
      c3c0FrameStepControlFlowBehaviorStateCount: result.c3c0FrameStepControlFlowBehaviorStateCount || 0,
      c3c0FrameStepControlFlowRelativeBranchCount: result.c3c0FrameStepControlFlowRelativeBranchCount || 0,
      c3c0FrameStepControlFlowConditionalBranchCount: result.c3c0FrameStepControlFlowConditionalBranchCount || 0,
      c3c0FrameStepControlFlowConditionalExitCount: result.c3c0FrameStepControlFlowConditionalExitCount || 0,
      c3c0FrameStepControlFlowConditionalControlCount: result.c3c0FrameStepControlFlowConditionalControlCount || 0,
      c3c0FrameStepControlFlowSymbolicPredicateCount: result.c3c0FrameStepControlFlowSymbolicPredicateCount || 0,
      c3c0FrameStepControlFlowUnclassifiedConditionalControlCount: result.c3c0FrameStepControlFlowUnclassifiedConditionalControlCount || 0,
      c3c0FrameStepControlFlowSymbolicPredicateStateCount: result.c3c0FrameStepControlFlowSymbolicPredicateStateCount || 0,
      c3c0FrameStepControlFlowFirstTickGuardStateCount: result.c3c0FrameStepControlFlowFirstTickGuardStateCount || 0,
      c3c0FrameStepControlFlowBehaviorStateOperationStateCount: result.c3c0FrameStepControlFlowBehaviorStateOperationStateCount || 0,
      c3c0FrameStepControlFlowBehaviorStateWriteStateCount: result.c3c0FrameStepControlFlowBehaviorStateWriteStateCount || 0,
      c3c0FrameStepControlFlowTimerOperationStateCount: result.c3c0FrameStepControlFlowTimerOperationStateCount || 0,
      c3c0FrameStepControlFlowCountdownOperationStateCount: result.c3c0FrameStepControlFlowCountdownOperationStateCount || 0,
      c3c0FrameStepControlFlowTimerOperationCount: result.c3c0FrameStepControlFlowTimerOperationCount || 0,
      c3c0FrameStepControlFlowCountdownOperationCount: result.c3c0FrameStepControlFlowCountdownOperationCount || 0,
      c3c0FrameStepControlFlowFieldTokenCount: result.c3c0FrameStepControlFlowFieldTokenCount || 0,
      c3c0FrameStepControlFlowFrameExactStateCount: result.c3c0FrameStepControlFlowFrameExactStateCount || 0,
      c3c0FrameStepControlFlowDiagnosticStatus: result.c3c0FrameStepControlFlowDiagnosticStatus || '',
      c3c0FrameStepControlFlowPersistedRomByteCount: result.c3c0FrameStepControlFlowPersistedRomByteCount || 0,
      c3c0FrameStepControlFlowPersistedInstructionByteCount: result.c3c0FrameStepControlFlowPersistedInstructionByteCount || 0,
      c3c0FrameStepControlFlowPersistedTileByteCount: result.c3c0FrameStepControlFlowPersistedTileByteCount || 0,
      c3c0FrameStepControlFlowPersistedPixelCount: result.c3c0FrameStepControlFlowPersistedPixelCount || 0,
      c3c0FrameStepControlFlowPersistedCoordinateCount: result.c3c0FrameStepControlFlowPersistedCoordinateCount || 0,
      c3c0FrameStepControlFlowPersistedGameplayValueCount: result.c3c0FrameStepControlFlowPersistedGameplayValueCount || 0,
      c3c0FrameStepTraceCatalogBacked: Boolean(result.c3c0FrameStepTraceCatalogBacked),
      c3c0FrameStepTraceCatalogId: result.c3c0FrameStepTraceCatalogId || '',
      c3c0FrameStepTraceCandidateEntityType: result.c3c0FrameStepTraceCandidateEntityType || '',
      c3c0FrameStepTraceCandidateSeedLabel: result.c3c0FrameStepTraceCandidateSeedLabel || '',
      c3c0FrameStepTraceBehaviorListSource: result.c3c0FrameStepTraceBehaviorListSource || '',
      c3c0FrameStepTraceBehaviorStateCount: result.c3c0FrameStepTraceBehaviorStateCount || 0,
      c3c0FrameStepTraceTraceStepCount: result.c3c0FrameStepTraceTraceStepCount || 0,
      c3c0FrameStepTraceFieldTouchCount: result.c3c0FrameStepTraceFieldTouchCount || 0,
      c3c0FrameStepTraceHelperStubCount: result.c3c0FrameStepTraceHelperStubCount || 0,
      c3c0FrameStepTraceHelperRoleKnownCount: result.c3c0FrameStepTraceHelperRoleKnownCount || 0,
      c3c0FrameStepTraceConditionalControlCount: result.c3c0FrameStepTraceConditionalControlCount || 0,
      c3c0FrameStepTraceSymbolicPredicateCount: result.c3c0FrameStepTraceSymbolicPredicateCount || 0,
      c3c0FrameStepTraceUnresolvedPredicateCount: result.c3c0FrameStepTraceUnresolvedPredicateCount || 0,
      c3c0FrameStepTraceFirstTickGuardCount: result.c3c0FrameStepTraceFirstTickGuardCount || 0,
      c3c0FrameStepTraceBehaviorStateFieldTouchCount: result.c3c0FrameStepTraceBehaviorStateFieldTouchCount || 0,
      c3c0FrameStepTraceTimerFieldTouchCount: result.c3c0FrameStepTraceTimerFieldTouchCount || 0,
      c3c0FrameStepTraceLiteralWithheldFieldTouchCount: result.c3c0FrameStepTraceLiteralWithheldFieldTouchCount || 0,
      c3c0FrameStepTraceStatesWithHelperStubs: result.c3c0FrameStepTraceStatesWithHelperStubs || 0,
      c3c0FrameStepTraceStatesWithFieldTouches: result.c3c0FrameStepTraceStatesWithFieldTouches || 0,
      c3c0FrameStepTraceStatesWithConditionalControls: result.c3c0FrameStepTraceStatesWithConditionalControls || 0,
      c3c0FrameStepTraceStatesWithAllSymbolicPredicates: result.c3c0FrameStepTraceStatesWithAllSymbolicPredicates || 0,
      c3c0FrameStepTraceFieldTokenCount: result.c3c0FrameStepTraceFieldTokenCount || 0,
      c3c0FrameStepTraceHelperRoleCount: result.c3c0FrameStepTraceHelperRoleCount || 0,
      c3c0FrameStepTracePredicateKindCount: result.c3c0FrameStepTracePredicateKindCount || 0,
      c3c0FrameStepTraceFrameExactStateCount: result.c3c0FrameStepTraceFrameExactStateCount || 0,
      c3c0FrameStepTraceReadinessStatus: result.c3c0FrameStepTraceReadinessStatus || '',
      c3c0FrameStepTracePersistedRomByteCount: result.c3c0FrameStepTracePersistedRomByteCount || 0,
      c3c0FrameStepTracePersistedInstructionByteCount: result.c3c0FrameStepTracePersistedInstructionByteCount || 0,
      c3c0FrameStepTracePersistedTileByteCount: result.c3c0FrameStepTracePersistedTileByteCount || 0,
      c3c0FrameStepTracePersistedPixelCount: result.c3c0FrameStepTracePersistedPixelCount || 0,
      c3c0FrameStepTracePersistedCoordinateCount: result.c3c0FrameStepTracePersistedCoordinateCount || 0,
      c3c0FrameStepTracePersistedGameplayValueCount: result.c3c0FrameStepTracePersistedGameplayValueCount || 0,
      c3c0FrameStepStepperPreviewBacked: Boolean(result.c3c0FrameStepStepperPreviewBacked),
      c3c0FrameStepStepperCatalogId: result.c3c0FrameStepStepperCatalogId || '',
      c3c0FrameStepStepperCandidateEntityType: result.c3c0FrameStepStepperCandidateEntityType || '',
      c3c0FrameStepStepperCandidateSeedLabel: result.c3c0FrameStepStepperCandidateSeedLabel || '',
      c3c0FrameStepStepperBehaviorListSource: result.c3c0FrameStepStepperBehaviorListSource || '',
      c3c0FrameStepStepperStateCount: result.c3c0FrameStepStepperStateCount || 0,
      c3c0FrameStepStepperFrameCount: result.c3c0FrameStepStepperFrameCount || 0,
      c3c0FrameStepStepperTraceStepCount: result.c3c0FrameStepStepperTraceStepCount || 0,
      c3c0FrameStepStepperFieldTouchEventCount: result.c3c0FrameStepStepperFieldTouchEventCount || 0,
      c3c0FrameStepStepperHelperStubEventCount: result.c3c0FrameStepStepperHelperStubEventCount || 0,
      c3c0FrameStepStepperConditionalEventCount: result.c3c0FrameStepStepperConditionalEventCount || 0,
      c3c0FrameStepStepperSymbolicPredicateCount: result.c3c0FrameStepStepperSymbolicPredicateCount || 0,
      c3c0FrameStepStepperUnresolvedPredicateCount: result.c3c0FrameStepStepperUnresolvedPredicateCount || 0,
      c3c0FrameStepStepperFirstTickGuardCount: result.c3c0FrameStepStepperFirstTickGuardCount || 0,
      c3c0FrameStepStepperRuntimeValueReadCount: result.c3c0FrameStepStepperRuntimeValueReadCount || 0,
      c3c0FrameStepStepperRuntimeValueWriteCount: result.c3c0FrameStepStepperRuntimeValueWriteCount || 0,
      c3c0FrameStepStepperBranchOutcomeEvaluatedCount: result.c3c0FrameStepStepperBranchOutcomeEvaluatedCount || 0,
      c3c0FrameStepStepperHelperEffectEvaluatedCount: result.c3c0FrameStepStepperHelperEffectEvaluatedCount || 0,
      c3c0FrameStepStepperPersistedGameplayValueCount: result.c3c0FrameStepStepperPersistedGameplayValueCount || 0,
      c3c0FrameStepStepperStatus: result.c3c0FrameStepStepperStatus || '',
      c3c0FrameStepStepperAssetPolicy: result.c3c0FrameStepStepperAssetPolicy || '',
      fixtureRuntimeDecoded: Boolean(result.fixtureRuntimeDecoded),
      fixtureRuntimePreviewedFixtureCount: result.fixtureRuntimePreviewedFixtureCount || 0,
      fixtureRuntimeRenderedFixtureRowCount: result.fixtureRuntimeRenderedFixtureRowCount || 0,
      fixtureRuntimeRenderedTileCount: result.fixtureRuntimeRenderedTileCount || 0,
      fixtureRuntimeRenderedPieceCount: result.fixtureRuntimeRenderedPieceCount || 0,
      fixtureRuntimeLayoutPreviewedFixtureCount: result.fixtureRuntimeLayoutPreviewedFixtureCount || 0,
      fixtureRuntimeCoordinateMode: result.fixtureRuntimeCoordinateMode || '',
      fixtureRuntimeEmptyFixtureCount: result.fixtureRuntimeEmptyFixtureCount || 0,
      fixtureRuntimeUnresolvedTileRefCount: result.fixtureRuntimeUnresolvedTileRefCount || 0,
      fixtureRuntimeSkippedFixtureCount: result.fixtureRuntimeSkippedFixtureCount || 0,
      fixtureRuntimeWarningCount: result.fixtureRuntimeWarningCount || 0,
      fixtureRuntimeParseIssueCount: result.fixtureRuntimeParseIssueCount || 0,
      fixtureRuntimePersistedTileByteCount: result.fixtureRuntimePersistedTileByteCount || 0,
      fixtureRuntimePersistedPixelCount: result.fixtureRuntimePersistedPixelCount || 0,
      fixtureRuntimePersistedCoordinateCount: result.fixtureRuntimePersistedCoordinateCount || 0,
      persistedTileByteCount: result.persistedTileByteCount || 0,
      persistedPixelCount: result.persistedPixelCount || 0,
      persistedCoordinateCount: result.persistedCoordinateCount || 0,
      assetPolicy: result.assetPolicy || '',
    },
    failures,
  };
}

function summarizePlayerStateGraphPreviewResult(result) {
  const failures = [];
  if (!result) {
    failures.push('player state graph preview did not run');
    return {
      summary: {
        ran: false,
        catalogBacked: false,
        nodeCount: 0,
        innerStateNodeCount: 0,
        vectorSubstateNodeCount: 0,
        transitionEdgeCount: 0,
        uniqueTransitionTargetCount: 0,
        ambiguousTargetEdgeCount: 0,
        inputDrivenNodeCount: 0,
        persistedGameplayValueCount: 0,
      },
      failures,
    };
  }
  if (result.error) failures.push(`player state graph preview: ${result.error}`);
  if (!result.catalogBacked) failures.push('player state graph preview: catalog was not linked');
  if (!result.previewOk) failures.push('player state graph preview: preview reported warnings');
  if (!(result.nodeCount >= 18)) failures.push(`player state graph preview: expected at least 18 nodes, got ${result.nodeCount}`);
  if (!(result.innerStateNodeCount >= 14)) failures.push(`player state graph preview: expected at least 14 inner-state nodes, got ${result.innerStateNodeCount}`);
  if (!(result.vectorSubstateNodeCount >= 4)) failures.push(`player state graph preview: expected at least 4 vector-substate nodes, got ${result.vectorSubstateNodeCount}`);
  if (!(result.transitionEdgeCount >= 55)) failures.push(`player state graph preview: expected at least 55 transition edges, got ${result.transitionEdgeCount}`);
  if (!(result.uniqueTransitionTargetCount >= 9)) failures.push(`player state graph preview: expected at least 9 unique transition targets, got ${result.uniqueTransitionTargetCount}`);
  if (!(result.inputDrivenNodeCount >= 14)) failures.push(`player state graph preview: expected at least 14 input-driven nodes, got ${result.inputDrivenNodeCount}`);
  if (result.persistedGameplayValueCount !== 0) failures.push('player state graph preview: gameplay values were reported as persisted');
  if (result.assetPolicy !== 'metadata_only_no_rom_bytes_or_gameplay_tables') failures.push('player state graph preview: metadata-only gameplay policy was not reported');
  return {
    summary: {
      ran: true,
      catalogId: result.catalogId || '',
      catalogBacked: Boolean(result.catalogBacked),
      nodeCount: result.nodeCount || 0,
      innerStateNodeCount: result.innerStateNodeCount || 0,
      vectorSubstateNodeCount: result.vectorSubstateNodeCount || 0,
      transitionEdgeCount: result.transitionEdgeCount || 0,
      uniqueTransitionTargetCount: result.uniqueTransitionTargetCount || 0,
      ambiguousTargetEdgeCount: result.ambiguousTargetEdgeCount || 0,
      inputDrivenNodeCount: result.inputDrivenNodeCount || 0,
      contactDrivenNodeCount: result.contactDrivenNodeCount || 0,
      environmentFlagDrivenNodeCount: result.environmentFlagDrivenNodeCount || 0,
      persistedGameplayValueCount: result.persistedGameplayValueCount || 0,
      assetPolicy: result.assetPolicy || '',
    },
    failures,
  };
}

function summarizeResults(results, normalZoneRecipeCount, inlineTransitionRecipeCount, audioPreviewResults = [], entrySeedSmokeResult = null, bank7SequencePreviewResult = null, roomEntityOrphanPreviewResult = null, roomEntityAssetPreviewResult = null, roomEntityDynamicPreviewResult = null, roomEntityFrameCoveragePreviewResult = null, playerStateGraphPreviewResult = null, audioRequestGraphPreviewResult = null) {
  const failures = [];
  let totalUsedSlots = 0;
  let totalResolvedSlots = 0;
  let totalUnresolvedSlots = 0;
  let maxUnresolvedSlots = 0;
  let totalCommonPrereqEntries = 0;
  let totalZone8fbEntries = 0;
  let totalZone998Entries = 0;
  let paletteAppliedCount = 0;
  let paletteMissingCount = 0;
  let totalPaletteNonBlackColors = 0;
  let spritePalettePreservedCount = 0;
  let spritePaletteUnresolvedCount = 0;
  let spritePaletteInheritanceCatalogBackedCount = 0;
  let maxSpritePaletteInheritanceRuntimePathClassCount = 0;
  let maxSpritePaletteInheritanceClassifiedRuntimePriorCallsites = 0;
  let maxSpritePaletteInheritancePointerFlowBackedRuntimePriorCallsites = 0;
  const spritePaletteInheritanceOwnerStatusCounts = new Map();
  let canvasNonBlackMissingCount = 0;
  let canvasNonBlackRecipeCount = 0;
  let canvasSingleColorRecipeCount = 0;
  let minCanvasDistinctColorCount = Infinity;
  let maxCanvasDistinctColorCount = 0;
  let minCommonPrereqSteps = Infinity;
  let maxCommonPrereqSteps = 0;
  let unresolvedRecipeCount = 0;
  let commonPrereqMissingCount = 0;
  let canvasMissingCount = 0;

  for (const result of results) {
    if (result.error) failures.push(`${result.id || result.index}: ${result.error}`);
    const used = result.provenance?.usedSlots || 0;
    const resolved = result.provenance?.resolvedSlots || 0;
    const unresolved = result.provenance?.unresolvedSlots || 0;
    const commonSteps = result.commonPrereq?.steps || 0;
    totalUsedSlots += used;
    totalResolvedSlots += resolved;
    totalUnresolvedSlots += unresolved;
    maxUnresolvedSlots = Math.max(maxUnresolvedSlots, unresolved);
    totalCommonPrereqEntries += result.commonPrereq?.entries || 0;
    totalZone8fbEntries += result.loaders?.vram8fbEntries || 0;
    totalZone998Entries += result.loaders?.vram998Entries || 0;
    totalPaletteNonBlackColors += result.palette?.nonBlackColors || 0;
    minCanvasDistinctColorCount = Math.min(minCanvasDistinctColorCount, result.canvas?.distinctColorCount || 0);
    maxCanvasDistinctColorCount = Math.max(maxCanvasDistinctColorCount, result.canvas?.distinctColorCount || 0);
    minCommonPrereqSteps = Math.min(minCommonPrereqSteps, commonSteps);
    maxCommonPrereqSteps = Math.max(maxCommonPrereqSteps, commonSteps);
    if (result.palette?.applied) paletteAppliedCount++;
    else {
      paletteMissingCount++;
      failures.push(`${result.id || result.index}: BG palette was not applied`);
    }
    if (!(result.palette?.nonBlackColors > 0)) failures.push(`${result.id || result.index}: BG palette has no non-black colors`);
    if (result.spritePalette?.status === 'preserve_existing') {
      spritePalettePreservedCount++;
      if (result.spritePalette.inheritanceCatalogBacked) spritePaletteInheritanceCatalogBackedCount++;
      else failures.push(`${result.id || result.index}: preserved SPR palette is missing inheritance catalog backing`);
      maxSpritePaletteInheritanceRuntimePathClassCount = Math.max(
        maxSpritePaletteInheritanceRuntimePathClassCount,
        result.spritePalette.inheritanceRuntimePathClassCount || 0
      );
      maxSpritePaletteInheritanceClassifiedRuntimePriorCallsites = Math.max(
        maxSpritePaletteInheritanceClassifiedRuntimePriorCallsites,
        result.spritePalette.inheritanceClassifiedRuntimePriorCallsites || 0
      );
      maxSpritePaletteInheritancePointerFlowBackedRuntimePriorCallsites = Math.max(
        maxSpritePaletteInheritancePointerFlowBackedRuntimePriorCallsites,
        result.spritePalette.inheritancePointerFlowBackedRuntimePriorCallsites || 0
      );
      if (!(result.spritePalette.inheritanceRuntimePathClassCount > 0)) {
        failures.push(`${result.id || result.index}: preserved SPR palette has no runtime path classes`);
      }
      if (!(result.spritePalette.inheritancePointerFlowBackedRuntimePriorCallsites > 0)) {
        failures.push(`${result.id || result.index}: preserved SPR palette has no pointer-flow-backed inherited callsites`);
      }
      const ownerStatus = result.spritePalette.inheritanceOwnerStatus || 'unknown';
      spritePaletteInheritanceOwnerStatusCounts.set(
        ownerStatus,
        (spritePaletteInheritanceOwnerStatusCounts.get(ownerStatus) || 0) + 1
      );
    } else {
      spritePaletteUnresolvedCount++;
    }
    if (unresolved) {
      unresolvedRecipeCount++;
      failures.push(`${result.id || result.index}: ${unresolved} unresolved tile slot(s)`);
    }
    if (!used) failures.push(`${result.id || result.index}: no zone tile slots were used`);
    if (!commonSteps) {
      commonPrereqMissingCount++;
      failures.push(`${result.id || result.index}: common prerequisite steps were not applied`);
    }
    if (!result.canvas?.width || !result.canvas?.height) {
      canvasMissingCount++;
      failures.push(`${result.id || result.index}: zone render canvas was not sized`);
    }
    if (result.canvas?.nonBlackPixels > 0) canvasNonBlackRecipeCount++;
    else canvasNonBlackMissingCount++;
    if ((result.canvas?.distinctColorCount || 0) < 2) canvasSingleColorRecipeCount++;
  }

  if (!results.length) failures.push('No zone recipes were available to render.');
  if (minCommonPrereqSteps === Infinity) minCommonPrereqSteps = 0;
  if (minCanvasDistinctColorCount === Infinity) minCanvasDistinctColorCount = 0;
  if (results.length && canvasNonBlackRecipeCount === 0) failures.push('No zone render produced non-black pixels after palette application.');

  const audioPreview = summarizeAudioPreviewResults(audioPreviewResults);
  failures.push(...audioPreview.failures.map(failure => `audio preview: ${failure}`));
  const entrySeedSmoke = summarizeEntrySeedSmokeResult(entrySeedSmokeResult);
  failures.push(...entrySeedSmoke.failures);
  const bank7SequencePreview = summarizeBank7SequencePreviewResult(bank7SequencePreviewResult);
  failures.push(...bank7SequencePreview.failures);
  const roomEntityOrphanPreview = summarizeRoomEntityOrphanPreviewResult(roomEntityOrphanPreviewResult);
  failures.push(...roomEntityOrphanPreview.failures);
  const roomEntityAssetPreview = summarizeRoomEntityAssetPreviewResult(roomEntityAssetPreviewResult);
  failures.push(...roomEntityAssetPreview.failures);
  const roomEntityDynamicPreview = summarizeRoomEntityDynamicPreviewResult(roomEntityDynamicPreviewResult);
  failures.push(...roomEntityDynamicPreview.failures);
  const roomEntityFrameCoveragePreview = summarizeRoomEntityFrameCoveragePreviewResult(roomEntityFrameCoveragePreviewResult);
  failures.push(...roomEntityFrameCoveragePreview.failures);
  const playerStateGraphPreview = summarizePlayerStateGraphPreviewResult(playerStateGraphPreviewResult);
  failures.push(...playerStateGraphPreview.failures);
  const audioRequestGraphPreview = summarizeAudioRequestGraphPreviewResult(audioRequestGraphPreviewResult);
  failures.push(...audioRequestGraphPreview.failures);

  return {
    summary: {
      renderedRecipeCount: results.length,
      normalZoneRecipeCount,
      inlineTransitionRecipeCount,
      unresolvedRecipeCount,
      totalUsedSlots,
      totalResolvedSlots,
      totalUnresolvedSlots,
      maxUnresolvedSlots,
      minCommonPrereqSteps,
      maxCommonPrereqSteps,
      totalCommonPrereqEntries,
      totalZone8fbEntries,
      totalZone998Entries,
      paletteAppliedCount,
      paletteMissingCount,
      totalPaletteNonBlackColors,
      spritePalettePreservedCount,
      spritePaletteUnresolvedCount,
      spritePaletteInheritanceCatalogBackedCount,
      maxSpritePaletteInheritanceRuntimePathClassCount,
      maxSpritePaletteInheritanceClassifiedRuntimePriorCallsites,
      maxSpritePaletteInheritancePointerFlowBackedRuntimePriorCallsites,
      spritePaletteInheritanceOwnerStatusCounts: Object.fromEntries([...spritePaletteInheritanceOwnerStatusCounts.entries()]
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
      minCanvasDistinctColorCount,
      maxCanvasDistinctColorCount,
      commonPrereqMissingCount,
      canvasMissingCount,
      canvasNonBlackMissingCount,
      canvasNonBlackRecipeCount,
      canvasSingleColorRecipeCount,
      entrySeedSmoke: entrySeedSmoke.summary,
      bank7SequencePreview: bank7SequencePreview.summary,
      roomEntityOrphanPreview: roomEntityOrphanPreview.summary,
      roomEntityAssetPreview: roomEntityAssetPreview.summary,
      roomEntityDynamicPreview: roomEntityDynamicPreview.summary,
      roomEntityFrameCoveragePreview: roomEntityFrameCoveragePreview.summary,
      playerStateGraphPreview: playerStateGraphPreview.summary,
      audioRequestGraphPreview: audioRequestGraphPreview.summary,
      audioPreview: audioPreview.summary,
      assetPolicy: 'Metadata only: recipe ids, counts, provenance totals, loader entry counts, and browser diagnostics. No ROM bytes, decoded graphics, canvas pixels, screenshots, or rendered assets are embedded.',
    },
    failures,
  };
}

function applyReport(report) {
  const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'zone_recipe_browser_smoke',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: [
      'world-zone-recipe-catalog-2026-06-25',
      'world-zone-common-prereq-provenance-catalog-2026-06-25',
      'world-inline-transition-render-provenance-catalog-2026-06-25',
      'world-sprite-palette-entry-scene-catalog-2026-06-25',
      'world-palette-table-catalog-2026-06-24',
      'world-sprite-palette-inheritance-catalog-2026-06-25',
      'world-audio-request-taxonomy-catalog-2026-06-25',
      'world-audio-stream-graph-catalog-2026-06-25',
      'world-audio-stream-seed-catalog-2026-06-25',
      'world-audio-event-trace-semantics-catalog-2026-06-25',
      'world-audio-event-output-phase-link-catalog-2026-06-25',
      'world-audio-event-output-gap-catalog-2026-06-25',
      'world-audio-stream-parameter-consumer-catalog-2026-06-25',
      'world-audio-output-register-catalog-2026-06-25',
      'world-audio-runtime-global-flow-catalog-2026-06-25',
      'world-audio-output-mode-branch-catalog-2026-06-25',
      'world-audio-frame-step-model-catalog-2026-06-25',
      'world-audio-preview-reset-seed-catalog-2026-06-25',
      'world-bank7-entity-sequence-catalog-2026-06-25',
      'world-room-entity-orphan-list-catalog-2026-06-25',
      'world-room-entity-frame-asset-link-catalog-2026-06-25',
      'world-room-entity-dynamic-tile-catalog-2026-06-25',
      'world-room-entity-dynamic-frame-coverage-catalog-2026-06-25',
      'world-room-entity-frame-trace-priority-catalog-2026-06-25',
      'world-room-entity-frame-subrecord-coverage-catalog-2026-06-25',
      'world-room-entity-renderable-frame-fixture-catalog-2026-06-25',
      'world-metasprite-oam-writer-semantics-catalog-2026-06-25',
      'world-dynamic-tile-source-table-catalog-2026-06-25',
      'world-dynamic-tile-upload-catalog-2026-06-25',
      'world-player-engine-state-graph-catalog-2026-06-25',
    ],
    summary: report.summary,
    mapFieldIntegrity: report.mapFieldIntegrity,
    sampleResults: report.sampleResults,
    entrySeedSmokeResult: report.entrySeedSmokeResult,
    bank7SequencePreviewResult: report.bank7SequencePreviewResult,
    roomEntityOrphanPreviewResult: report.roomEntityOrphanPreviewResult,
    roomEntityAssetPreviewResult: report.roomEntityAssetPreviewResult,
    roomEntityDynamicPreviewResult: report.roomEntityDynamicPreviewResult,
    roomEntityFrameCoveragePreviewResult: report.roomEntityFrameCoveragePreviewResult,
    playerStateGraphPreviewResult: report.playerStateGraphPreviewResult,
    audioRequestGraphPreviewResult: report.audioRequestGraphPreviewResult,
    audioPreviewSampleResults: report.audioPreviewSampleResults,
    failures: report.failures,
    evidence: [
      'Browser loaded the WORLD project through api.php and tools/rom-analyzer.html.',
      'Each recipe was rendered through zoneBrowserLoadRecipe() and zoneBrowserRender(), exercising the analyzer zone rendering path.',
      'The zone-render-info dataset supplied tile-slot provenance counts for each rendered recipe.',
      'The browser smoke verified that each rendered zone applied a mapped BG palette record and counted non-black canvas output as diagnostics.',
      'The browser smoke verified room-zone and inline-transition sprite palette status separately from BG palette loading; _LABEL_26F4_ preserves the existing sprite palette through H=$FF.',
      'The browser smoke verified whether preserved sprite palette state is backed by the sprite-palette inheritance catalog.',
      'The browser smoke selected one sprite-palette entry seed and verified the analyzer applied its sprite palette and loader prerequisites before zone rendering.',
      'The audio preview smoke selected one representative recipe per unique zone audio request and exercised zoneAudioRenderPreview().',
      'The audio preview smoke exercised the $C232 output-mode selector in all/unresolved, PSG bit0=0, and FM bit0=1 modes and compared selected-mode counts to the branch catalog alternatives.',
      'The browser smoke invoked bank7SequenceRenderPreview(); stream values were decoded only in browser runtime/DOM and only counts/status were written to map.json.',
      'The browser smoke invoked roomEntityOrphanRenderPreview(); orphan room entity list metadata was previewed without persisting entity coordinate bytes.',
      'The browser smoke invoked roomEntityAssetRenderPreview(); room entity asset links were previewed from metadata without reading or persisting ROM bytes, sprite coordinates, or rendered sprites.',
      'The browser smoke invoked roomEntityDynamicRenderPreview(); _LABEL_A97_ dynamic entity tile uploads were replayed from the local ROM into synthetic VRAM provenance without persisting ROM bytes, pixels, coordinates, or decoded sprites.',
      'The browser smoke invoked roomEntityFrameCoverageRenderPreview(); dynamic-upload-to-frame-tile coverage statuses were previewed from metadata without persisting ROM bytes, pixels, coordinates, or rendered sprites.',
      'The browser smoke verified per-frame-subrecord coverage for trace-priority dynamic entities; top priority 0x8A has 2 renderable frame subrecords and 3 still blocked behind static/alternate tile-base trace.',
      'The browser smoke verified the renderable frame fixture catalog as a metadata-only allowlist for future sprite previews.',
      'The browser smoke verified the _LABEL_6E7_/_LABEL_760_/_LABEL_792_ OAM writer semantics catalog and used it for runtime fixture OAM-layout previews.',
      'The browser smoke verified the position-base model: _LABEL_760_ writes _RAM_D00B_/_RAM_D00C_ and _RAM_D00D_/_RAM_D00E_ from IX slot coordinates with camera subtraction controlled by IX+0 bit 5.',
      'The browser smoke verified the runtime fixture OAM-layout preview against the local ROM and synthetic VRAM without writing canvas pixels, decoded tiles, or decoded coordinates to map.json.',
      'The browser smoke invoked playerStateGraphRenderPreview(); player state graph metadata was previewed without reading or persisting ROM bytes, gameplay tables, or decoded assets.',
      'The browser smoke invoked audioRequestGraphRenderPreview(); request table coverage, stream graph coverage, seed model, output phases, output-gap readiness classes, indirect stream-parameter consumer links, and reset/frame-step readiness were previewed without persisting stream bytes, register traces, samples, or decoded music.',
      'No screenshots, canvas pixels, preview HTML, ROM bytes, decoded graphics, decoded music streams, entity coordinates, or rendered assets were written to map.json.',
    ],
    nextLeads: [
      'Promote the common prerequisite layer from simulation-only to normal zone recipe input only after persistent VRAM ordering is proven across all _LABEL_2620_ callers.',
      'Trace the pre-room sprite palette owner so preserved H=$FF room and inline-transition recipes can inherit the correct active sprite palette in full-scene simulations.',
      'Use the bank-7 sequence runtime preview to model the _RAM_C280_ entity update frame loop without persisting decoded stream values.',
      'Use the orphan entity-list metadata preview to compare unreached entity type ids against reached room entity lists and behavior-table initializers.',
      'Use the room entity asset-link preview to prioritize naming/entity behavior work for selectors whose frames and dynamic tile streams are now linked.',
      'Use the room entity dynamic-tile replay totals to connect first-seen entity uploads to sprite frame tile-base ranges before rendering metasprites.',
      'Frame-trace the 12 needs-trace dynamic entity types before treating their metasprite frame ranges as render-ready.',
      'Use the player state graph preview to seed shared/wb3/player-state.js and shared/wb3/player-physics.js only after transition priorities are frame-traced.',
      'Use the audio request graph preview to select request-wide gaps before building a PSG/FM register timeline player.',
      'Use the audio preview diagnostics as the bridge toward a PSG register-event player once output-phase values are fully modeled.',
    ],
  });
  fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
}

async function runSmoke() {
  const port = await findPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startPhpServer(port);
  let browser;
  const consoleMessages = [];
  const pageErrors = [];

  try {
    await waitForServer(baseUrl, server);

    const launchOptions = {
      headless: true,
      chromiumSandbox: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    };
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
      launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    }
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(120000);
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleMessages.push({ type: msg.type(), text: msg.text().slice(0, 500) });
      }
    });
    page.on('pageerror', error => {
      pageErrors.push(error.message);
    });

    await page.goto(`${baseUrl}/tools/rom-analyzer.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() =>
      typeof window.loadProject === 'function' &&
      typeof window.zoneBrowserLoadRecipe === 'function' &&
      typeof window.zoneBrowserRender === 'function' &&
      document.getElementById('zone-recipe-sel') &&
      document.getElementById('zone-render-info')
    );

    const info = await page.evaluate(async name => {
      const res = await fetch(`../api.php?action=project_info&project=${encodeURIComponent(name)}`);
      return res.json();
    }, projectName);
    if (!info.ok) throw new Error(`Project ${projectName} is not available through api.php`);
    if (!info.romFile || !info.hasJson) throw new Error(`Project ${projectName} is missing ROM or map.json`);

    await page.evaluate(async name => {
      await window.loadProject(name);
    }, projectName);

    await page.waitForFunction(() =>
      window.romData &&
      window.romData.length > 0 &&
      window.mapData &&
      Array.isArray(window.mapData.zoneRecipes) &&
      window.mapData.zoneRecipes.length > 0 &&
      typeof window.zoneBrowserRenderRecipePicker === 'function'
    );

    const mapFieldIntegrity = await page.evaluate(async name => {
      const res = await fetch(`../api.php?action=get_file&project=${encodeURIComponent(name)}&type=json`);
      const original = await res.json();
      const loaded = window.mapData || {};
      const originalKeys = Object.keys(original).sort();
      const loadedKeys = Object.keys(loaded).sort();
      const missingTopLevelKeys = originalKeys.filter(key => !Object.prototype.hasOwnProperty.call(loaded, key));
      const originalArrayKeys = originalKeys.filter(key => Array.isArray(original[key]));
      const missingArrayKeys = originalArrayKeys.filter(key => !Array.isArray(loaded[key]));
      const mismatchedArrayLengths = originalArrayKeys
        .filter(key => Array.isArray(loaded[key]) && loaded[key].length !== original[key].length)
        .map(key => ({ key, originalLength: original[key].length, loadedLength: loaded[key].length }));
      return {
        originalTopLevelKeyCount: originalKeys.length,
        loadedTopLevelKeyCount: loadedKeys.length,
        originalArrayKeyCount: originalArrayKeys.length,
        loadedArrayKeyCount: loadedKeys.filter(key => Array.isArray(loaded[key])).length,
        missingTopLevelKeys,
        missingArrayKeys,
        mismatchedArrayLengths,
      };
    }, projectName);

    const renderResults = await page.evaluate(() => {
      const normalZoneRecipeCount = (window.mapData.zoneRecipes || []).length;
      const inlineTransitionRecipeCount = (window.mapData.inlineTransitionRecipes || []).length;
      const recipes = [
        ...(window.mapData.zoneRecipes || []),
        ...(window.mapData.inlineTransitionRecipes || []),
      ];
      window.zoneBrowserRenderRecipePicker();
      if (typeof window.zoneBrowserRenderEntrySeedPicker === 'function') window.zoneBrowserRenderEntrySeedPicker();
      const seedSel = document.getElementById('zone-entry-seed-sel');
      if (seedSel) seedSel.value = '';
      const results = [];
      for (let index = 0; index < recipes.length; index++) {
        const recipe = recipes[index];
        try {
          const sel = document.getElementById('zone-recipe-sel');
          sel.value = recipe.id || '';
          window.zoneBrowserLoadRecipe();
          window.zoneBrowserRender();

          const infoEl = document.getElementById('zone-render-info');
          const canvas = document.getElementById('zone-render-canvas');
          const dataset = { ...(infoEl?.dataset || {}) };
          const usedSlots = Number(dataset.provenanceUsedSlots || 0);
          const unresolvedSlots = Number(dataset.provenanceUnresolvedSlots || 0);
          const resolvedSlots = Number(dataset.provenanceResolvedSlots || 0);
          const canvasStats = {
            width: canvas?.width || 0,
            height: canvas?.height || 0,
            nonBlackPixels: 0,
            nonTransparentPixels: 0,
            distinctColorCount: 0,
          };
          if (canvas && canvas.width && canvas.height) {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const colors = new Set();
            for (let p = 0; p < pixels.length; p += 4) {
              const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2], a = pixels[p + 3];
              if (a) canvasStats.nonTransparentPixels++;
              if (a && (r || g || b)) canvasStats.nonBlackPixels++;
              if (colors.size < 512) colors.add(`${r},${g},${b},${a}`);
            }
            canvasStats.distinctColorCount = colors.size;
          }
          results.push({
            index,
            id: recipe.id || '',
            recipeType: recipe.recipeType || 'room_zone_render',
            descriptorOffset: recipe.descriptor?.romOffset || '',
            subrecordOffset: recipe.subrecord?.romOffset || '',
            audioRequestIdHex: recipe.dependencies?.audioRequest?.requestIdHex || '',
            provenance: {
              usedSlots,
              resolvedSlots,
              unresolvedSlots,
            },
            commonPrereq: {
              steps: Number(dataset.commonPrereqSteps || 0),
              entries: Number(dataset.commonPrereqEntries || 0),
            },
            entrySeed: {
              selected: dataset.zoneEntrySeedSelected === '1',
              seedId: dataset.zoneEntrySeedId || '',
              caller: dataset.zoneEntrySeedCaller || '',
              writerCatalogId: dataset.zoneEntrySeedWriterCatalogId || '',
              writerCatalogBacked: dataset.zoneEntrySeedWriterCatalogBacked === '1',
              writerId: dataset.zoneEntrySeedWriterId || '',
              writerAction: dataset.zoneEntrySeedWriterAction || '',
              writerContextRole: dataset.zoneEntrySeedWriterContextRole || '',
              writerSpritePaletteStatus: dataset.zoneEntrySeedWriterSpritePaletteStatus || '',
              writerSpritePaletteRecordRegionId: dataset.zoneEntrySeedWriterSpritePaletteRecordRegionId || '',
              stepCount: Number(dataset.zoneEntrySeedSteps || 0),
              loaderEntryCount: Number(dataset.zoneEntrySeedLoaderEntries || 0),
              spritePaletteApplied: dataset.zoneEntrySeedSpritePaletteApplied === '1',
              spritePaletteIndex: dataset.zoneEntrySeedSpritePaletteIndex === '' ? null : Number(dataset.zoneEntrySeedSpritePaletteIndex || 0),
              spritePaletteRegionId: dataset.zoneEntrySeedSpritePaletteRegionId || '',
              warningCount: Number(dataset.zoneEntrySeedWarnings || 0),
            },
            loaders: {
              vram8fbEntries: Number(dataset.zone8fbEntries || 0),
              vram998Entries: Number(dataset.zone998Entries || 0),
            },
            palette: {
              applied: dataset.zonePaletteApplied === '1',
              index: dataset.zonePaletteIndex || '',
              regionId: dataset.zonePaletteRegionId || '',
              romOffset: dataset.zonePaletteOffset || '',
              nonBlackColors: Number(dataset.zonePaletteNonBlackColors || 0),
            },
            spritePalette: {
              status: dataset.zoneSpritePaletteStatus || '',
              source: dataset.zoneSpritePaletteSource || '',
              inheritanceCatalogId: dataset.zoneSpritePaletteInheritanceCatalogId || '',
              inheritanceOwnerStatus: dataset.zoneSpritePaletteInheritanceOwnerStatus || '',
              inheritanceStateRam: dataset.zoneSpritePaletteInheritanceStateRam || '',
              inheritanceCatalogBacked: dataset.zoneSpritePaletteInheritanceCatalogBacked === '1',
              inheritanceRuntimePathClassCount: Number(dataset.zoneSpritePaletteInheritanceRuntimePathClassCount || 0),
              inheritanceClassifiedRuntimePriorCallsites: Number(dataset.zoneSpritePaletteInheritanceClassifiedRuntimePriorCallsites || 0),
              inheritancePointerFlowBackedRuntimePriorCallsites: Number(dataset.zoneSpritePaletteInheritancePointerFlowBackedRuntimePriorCallsites || 0),
            },
            canvas: canvasStats,
          });
        } catch (error) {
          results.push({
            index,
            id: recipe.id || '',
            recipeType: recipe.recipeType || 'room_zone_render',
            descriptorOffset: recipe.descriptor?.romOffset || '',
            error: error?.message || String(error),
          });
        }
      }

      let entrySeedSmokeResult = null;
      const entrySeedCatalog = (window.mapData.sceneRecipeCatalogs || [])
        .find(catalog => catalog.id === 'world-sprite-palette-entry-scene-catalog-2026-06-25');
      const entrySeeds = entrySeedCatalog?.entryRecipes || [];
      if (entrySeeds.length && recipes.length) {
        const recipe = recipes[0];
        try {
          const sel = document.getElementById('zone-recipe-sel');
          const entrySel = document.getElementById('zone-entry-seed-sel');
          sel.value = recipe.id || '';
          entrySel.value = entrySeeds[0].id || '';
          window.zoneBrowserLoadRecipe();
          entrySel.value = entrySeeds[0].id || '';
          window.zoneBrowserRender();
          const infoEl = document.getElementById('zone-render-info');
          const dataset = { ...(infoEl?.dataset || {}) };
          entrySeedSmokeResult = {
            id: recipe.id || '',
            recipeType: recipe.recipeType || 'room_zone_render',
            descriptorOffset: recipe.descriptor?.romOffset || '',
            entrySeed: {
              selected: dataset.zoneEntrySeedSelected === '1',
              seedId: dataset.zoneEntrySeedId || '',
              caller: dataset.zoneEntrySeedCaller || '',
              writerCatalogId: dataset.zoneEntrySeedWriterCatalogId || '',
              writerCatalogBacked: dataset.zoneEntrySeedWriterCatalogBacked === '1',
              writerId: dataset.zoneEntrySeedWriterId || '',
              writerAction: dataset.zoneEntrySeedWriterAction || '',
              writerContextRole: dataset.zoneEntrySeedWriterContextRole || '',
              writerSpritePaletteStatus: dataset.zoneEntrySeedWriterSpritePaletteStatus || '',
              writerSpritePaletteRecordRegionId: dataset.zoneEntrySeedWriterSpritePaletteRecordRegionId || '',
              stepCount: Number(dataset.zoneEntrySeedSteps || 0),
              loaderEntryCount: Number(dataset.zoneEntrySeedLoaderEntries || 0),
              spritePaletteApplied: dataset.zoneEntrySeedSpritePaletteApplied === '1',
              spritePaletteIndex: dataset.zoneEntrySeedSpritePaletteIndex === '' ? null : Number(dataset.zoneEntrySeedSpritePaletteIndex || 0),
              spritePaletteRegionId: dataset.zoneEntrySeedSpritePaletteRegionId || '',
              warningCount: Number(dataset.zoneEntrySeedWarnings || 0),
            },
            provenance: {
              usedSlots: Number(dataset.provenanceUsedSlots || 0),
              resolvedSlots: Number(dataset.provenanceResolvedSlots || 0),
              unresolvedSlots: Number(dataset.provenanceUnresolvedSlots || 0),
            },
          };
          entrySel.value = '';
        } catch (error) {
          entrySeedSmokeResult = {
            id: recipe.id || '',
            recipeType: recipe.recipeType || 'room_zone_render',
            descriptorOffset: recipe.descriptor?.romOffset || '',
            error: error?.message || String(error),
          };
        }
      }

      let bank7SequencePreviewResult = null;
      try {
        if (typeof window.bank7SequenceRenderPreview !== 'function') {
          throw new Error('bank7SequenceRenderPreview is not available');
        }
        window.bank7SequenceRenderPreview();
        const preview = document.getElementById('bank7-seq-preview');
        const info = document.getElementById('bank7-seq-info');
        const dataset = { ...(preview?.dataset || {}) };
        bank7SequencePreviewResult = {
          catalogId: dataset.bank7SequenceCatalogId || '',
          catalogBacked: dataset.bank7SequenceCatalogBacked === '1',
          previewOk: dataset.bank7SequencePreviewOk === '1',
          validatedStreams: Number(dataset.bank7SequenceValidatedStreams || 0),
          waypointRecordCount: Number(dataset.bank7SequenceWaypointRecordCount || 0),
          timingRecordCount: Number(dataset.bank7SequenceTimingRecordCount || 0),
          warningCount: Number(dataset.bank7SequenceWarningCount || 0),
          renderedRecordCount: Number(dataset.bank7SequenceRenderedRecordCount || 0),
          persistedValueCount: Number(dataset.bank7SequencePersistedValueCount || 0),
          assetPolicy: dataset.bank7SequenceAssetPolicy || '',
          infoText: (info?.textContent || '').slice(0, 200),
        };
      } catch (error) {
        bank7SequencePreviewResult = {
          error: error?.message || String(error),
        };
      }

      let roomEntityOrphanPreviewResult = null;
      try {
        if (typeof window.roomEntityOrphanRenderPreview !== 'function') {
          throw new Error('roomEntityOrphanRenderPreview is not available');
        }
        window.roomEntityOrphanRenderPreview();
        const preview = document.getElementById('room-entity-orphan-preview');
        const info = document.getElementById('room-entity-orphan-info');
        const dataset = { ...(preview?.dataset || {}) };
        roomEntityOrphanPreviewResult = {
          catalogId: dataset.roomEntityOrphanCatalogId || '',
          catalogBacked: dataset.roomEntityOrphanCatalogBacked === '1',
          previewOk: dataset.roomEntityOrphanPreviewOk === '1',
          regionId: dataset.roomEntityOrphanRegionId || '',
          fullyCoversSpan: dataset.roomEntityOrphanFullyCoversSpan === '1',
          listCount: Number(dataset.roomEntityOrphanListCount || 0),
          recordCount: Number(dataset.roomEntityOrphanRecordCount || 0),
          uniqueEntityTypeCount: Number(dataset.roomEntityOrphanUniqueEntityTypeCount || 0),
          subrecordPointerRefs: Number(dataset.roomEntityOrphanSubrecordPointerRefs || 0),
          warningCount: Number(dataset.roomEntityOrphanWarningCount || 0),
          persistedCoordinateCount: Number(dataset.roomEntityOrphanPersistedCoordinateCount || 0),
          assetPolicy: dataset.roomEntityOrphanAssetPolicy || '',
          infoText: (info?.textContent || '').slice(0, 200),
        };
      } catch (error) {
        roomEntityOrphanPreviewResult = {
          error: error?.message || String(error),
        };
      }

      let roomEntityAssetPreviewResult = null;
      try {
        if (typeof window.roomEntityAssetRenderPreview !== 'function') {
          throw new Error('roomEntityAssetRenderPreview is not available');
        }
        window.roomEntityAssetRenderPreview();
        const preview = document.getElementById('room-entity-asset-preview');
        const info = document.getElementById('room-entity-asset-info');
        const dataset = { ...(preview?.dataset || {}) };
        roomEntityAssetPreviewResult = {
          catalogId: dataset.roomEntityAssetCatalogId || '',
          catalogBacked: dataset.roomEntityAssetCatalogBacked === '1',
          previewOk: dataset.roomEntityAssetPreviewOk === '1',
          linkCount: Number(dataset.roomEntityAssetLinkCount || 0),
          rawTypesWithFrameSubrecords: Number(dataset.roomEntityAssetRawTypesWithFrameSubrecords || 0),
          selectorTypesWithFrameSubrecords: Number(dataset.roomEntityAssetSelectorTypesWithFrameSubrecords || 0),
          animationFrameGapCount: Number(dataset.roomEntityAssetAnimationFrameGapCount || 0),
          rawTypesWithoutAnimationStart: Number(dataset.roomEntityAssetRawTypesWithoutAnimationStart || 0),
          highConfidenceFrameSubrecords: Number(dataset.roomEntityAssetHighConfidenceFrameSubrecords || 0),
          frameRegionsLinked: Number(dataset.roomEntityAssetFrameRegionsLinked || 0),
          persistedAssetByteCount: Number(dataset.roomEntityAssetPersistedAssetByteCount || 0),
          persistedCoordinateCount: Number(dataset.roomEntityAssetPersistedCoordinateCount || 0),
          assetPolicy: dataset.roomEntityAssetPolicy || '',
          infoText: (info?.textContent || '').slice(0, 200),
        };
      } catch (error) {
        roomEntityAssetPreviewResult = {
          error: error?.message || String(error),
        };
      }

      let roomEntityDynamicPreviewResult = null;
      try {
        if (typeof window.roomEntityDynamicRenderPreview !== 'function') {
          throw new Error('roomEntityDynamicRenderPreview is not available');
        }
        window.roomEntityDynamicRenderPreview();
        const preview = document.getElementById('room-entity-dynamic-preview');
        const info = document.getElementById('room-entity-dynamic-info');
        const dataset = { ...(preview?.dataset || {}) };
        roomEntityDynamicPreviewResult = {
          catalogId: dataset.roomEntityDynamicCatalogId || '',
          catalogBacked: dataset.roomEntityDynamicCatalogBacked === '1',
          previewOk: dataset.roomEntityDynamicPreviewOk === '1',
          runtimeDecoded: dataset.roomEntityDynamicRuntimeDecoded === '1',
          subrecordCount: Number(dataset.roomEntityDynamicSubrecordCount || 0),
          uploadSubrecordCount: Number(dataset.roomEntityDynamicUploadSubrecordCount || 0),
          totalFirstSeenEntityUploads: Number(dataset.roomEntityDynamicTotalFirstSeenEntityUploads || 0),
          uniqueDynamicStreamsUsed: Number(dataset.roomEntityDynamicUniqueDynamicStreamsUsed || 0),
          catalogExpectedTileSlots: Number(dataset.roomEntityDynamicCatalogExpectedTileSlots || 0),
          runtimeTouchedSlots: Number(dataset.roomEntityDynamicRuntimeTouchedSlots || 0),
          runtimeCopySlots: Number(dataset.roomEntityDynamicRuntimeCopySlots || 0),
          runtimeZeroSlots: Number(dataset.roomEntityDynamicRuntimeZeroSlots || 0),
          runtimeUnresolvedSlots: Number(dataset.roomEntityDynamicRuntimeUnresolvedSlots || 0),
          runtimeSourceRegionCount: Number(dataset.roomEntityDynamicRuntimeSourceRegionCount || 0),
          runtimeStreamCount: Number(dataset.roomEntityDynamicRuntimeStreamCount || 0),
          warningCount: Number(dataset.roomEntityDynamicWarningCount || 0),
          persistedTileByteCount: Number(dataset.roomEntityDynamicPersistedTileByteCount || 0),
          persistedPixelCount: Number(dataset.roomEntityDynamicPersistedPixelCount || 0),
          persistedCoordinateCount: Number(dataset.roomEntityDynamicPersistedCoordinateCount || 0),
          assetPolicy: dataset.roomEntityDynamicAssetPolicy || '',
          infoText: (info?.textContent || '').slice(0, 200),
        };
      } catch (error) {
        roomEntityDynamicPreviewResult = {
          error: error?.message || String(error),
        };
      }

      let roomEntityFrameCoveragePreviewResult = null;
      try {
        if (typeof window.roomEntityFrameCoverageRenderPreview !== 'function') {
          throw new Error('roomEntityFrameCoverageRenderPreview is not available');
        }
        window.roomEntityFrameCoverageRenderPreview();
        const preview = document.getElementById('room-entity-frame-coverage-preview');
        const info = document.getElementById('room-entity-frame-coverage-info');
        const dataset = { ...(preview?.dataset || {}) };
        roomEntityFrameCoveragePreviewResult = {
          catalogId: dataset.roomEntityFrameCoverageCatalogId || '',
          catalogBacked: dataset.roomEntityFrameCoverageCatalogBacked === '1',
          previewOk: dataset.roomEntityFrameCoveragePreviewOk === '1',
          totalDynamicEntityUploads: Number(dataset.roomEntityFrameCoverageTotalDynamicEntityUploads || 0),
          frameLinkedUploadCount: Number(dataset.roomEntityFrameCoverageFrameLinkedUploadCount || 0),
          fullyCoveredUploadCount: Number(dataset.roomEntityFrameCoverageFullyCoveredUploadCount || 0),
          partialCoverageUploadCount: Number(dataset.roomEntityFrameCoveragePartialCoverageUploadCount || 0),
          noFrameAssetUploadCount: Number(dataset.roomEntityFrameCoverageNoFrameAssetUploadCount || 0),
          dynamicEntityTypeCount: Number(dataset.roomEntityFrameCoverageDynamicEntityTypeCount || 0),
          frameLinkedEntityTypeCount: Number(dataset.roomEntityFrameCoverageFrameLinkedEntityTypeCount || 0),
          fullyCoveredEntityTypeCount: Number(dataset.roomEntityFrameCoverageFullyCoveredEntityTypeCount || 0),
          needsTraceEntityTypeCount: Number(dataset.roomEntityFrameCoverageNeedsTraceEntityTypeCount || 0),
          tracePriorityCatalogBacked: dataset.roomEntityFrameCoverageTracePriorityCatalogBacked === '1',
          tracePriorityCatalogId: dataset.roomEntityFrameCoverageTracePriorityCatalogId || '',
          tracePriorityEntityTypeCount: Number(dataset.roomEntityFrameCoverageTracePriorityEntityTypeCount || 0),
          tracePriorityTopEntityType: dataset.roomEntityFrameCoverageTracePriorityTopEntityType || '',
          tracePriorityTopUploadCount: Number(dataset.roomEntityFrameCoverageTracePriorityTopUploadCount || 0),
          tracePriorityPartialUploadCount: Number(dataset.roomEntityFrameCoverageTracePriorityPartialUploadCount || 0),
          subrecordCoverageCatalogBacked: dataset.roomEntityFrameCoverageSubrecordCatalogBacked === '1',
          subrecordCoverageCatalogId: dataset.roomEntityFrameCoverageSubrecordCatalogId || '',
          subrecordCoverageEntityTypeCount: Number(dataset.roomEntityFrameCoverageSubrecordEntityTypeCount || 0),
          subrecordCoverageTotalFrameCount: Number(dataset.roomEntityFrameCoverageSubrecordTotalFrameCount || 0),
          subrecordCoverageRenderableFrameCount: Number(dataset.roomEntityFrameCoverageSubrecordRenderableFrameCount || 0),
          subrecordCoverageDynamicCoveredFrameCount: Number(dataset.roomEntityFrameCoverageSubrecordDynamicCoveredFrameCount || 0),
          subrecordCoverageNotCoveredFrameCount: Number(dataset.roomEntityFrameCoverageSubrecordNotCoveredFrameCount || 0),
          subrecordCoverageTopEntityType: dataset.roomEntityFrameCoverageSubrecordTopEntityType || '',
          subrecordCoverageTopEntityFrameCount: Number(dataset.roomEntityFrameCoverageSubrecordTopEntityFrameCount || 0),
          subrecordCoverageTopEntityRenderableFrameCount: Number(dataset.roomEntityFrameCoverageSubrecordTopEntityRenderableFrameCount || 0),
          subrecordCoverageTopEntityNotCoveredFrameCount: Number(dataset.roomEntityFrameCoverageSubrecordTopEntityNotCoveredFrameCount || 0),
          subrecordCoverageParseIssueCount: Number(dataset.roomEntityFrameCoverageSubrecordParseIssueCount || 0),
          renderableFixtureCatalogBacked: dataset.roomEntityFrameCoverageRenderableFixtureCatalogBacked === '1',
          renderableFixtureCatalogId: dataset.roomEntityFrameCoverageRenderableFixtureCatalogId || '',
          renderableFixtureEntityTypeCount: Number(dataset.roomEntityFrameCoverageRenderableFixtureEntityTypeCount || 0),
          renderableFixtureCount: Number(dataset.roomEntityFrameCoverageRenderableFixtureCount || 0),
          renderableFixtureDynamicBackedCount: Number(dataset.roomEntityFrameCoverageRenderableFixtureDynamicBackedCount || 0),
          renderableFixtureEmptyFrameCount: Number(dataset.roomEntityFrameCoverageRenderableFixtureEmptyFrameCount || 0),
          renderableFixtureBlockedOrPartialSubrecordCount: Number(dataset.roomEntityFrameCoverageRenderableFixtureBlockedOrPartialSubrecordCount || 0),
          renderableFixtureTopEntityType: dataset.roomEntityFrameCoverageRenderableFixtureTopEntityType || '',
          renderableFixtureTopEntityFixtureCount: Number(dataset.roomEntityFrameCoverageRenderableFixtureTopEntityFixtureCount || 0),
          renderableFixtureTopEntityBlockedSubrecordCount: Number(dataset.roomEntityFrameCoverageRenderableFixtureTopEntityBlockedSubrecordCount || 0),
          renderableFixtureParseIssueCount: Number(dataset.roomEntityFrameCoverageRenderableFixtureParseIssueCount || 0),
          oamSemanticsCatalogBacked: dataset.roomEntityFrameCoverageOamSemanticsCatalogBacked === '1',
          oamSemanticsCatalogId: dataset.roomEntityFrameCoverageOamSemanticsCatalogId || '',
          oamPieceRecordByteLength: Number(dataset.roomEntityFrameCoverageOamPieceRecordByteLength || 0),
          oamOutputRecordByteLength: Number(dataset.roomEntityFrameCoverageOamOutputRecordByteLength || 0),
          oamFrameStreamRoutine: dataset.roomEntityFrameCoverageOamFrameStreamRoutine || '',
          oamSlotScanRoutine: dataset.roomEntityFrameCoverageOamSlotScanRoutine || '',
          oamPositionProducerRoutine: dataset.roomEntityFrameCoverageOamPositionProducerRoutine || '',
          oamTileBaseField: dataset.roomEntityFrameCoverageOamTileBaseField || '',
          oamXBaseRam: dataset.roomEntityFrameCoverageOamXBaseRam || '',
          oamYBaseRam: dataset.roomEntityFrameCoverageOamYBaseRam || '',
          oamXBaseSlotFields: dataset.roomEntityFrameCoverageOamXBaseSlotFields || '',
          oamYBaseSlotFields: dataset.roomEntityFrameCoverageOamYBaseSlotFields || '',
          oamXCameraRam: dataset.roomEntityFrameCoverageOamXCameraRam || '',
          oamYCameraRam: dataset.roomEntityFrameCoverageOamYCameraRam || '',
          oamCameraSubtractFlag: dataset.roomEntityFrameCoverageOamCameraSubtractFlag || '',
          oamPersistedCoordinateCount: Number(dataset.roomEntityFrameCoverageOamPersistedCoordinateCount || 0),
          slotCoordinateCatalogBacked: dataset.roomEntityFrameCoverageSlotCoordinateCatalogBacked === '1',
          slotCoordinateCatalogId: dataset.roomEntityFrameCoverageSlotCoordinateCatalogId || '',
          slotCoordinateFieldCount: Number(dataset.roomEntityFrameCoverageSlotCoordinateFieldCount || 0),
          slotCoordinateReferenceCount: Number(dataset.roomEntityFrameCoverageSlotCoordinateReferenceCount || 0),
          slotCoordinateReadReferenceCount: Number(dataset.roomEntityFrameCoverageSlotCoordinateReadReferenceCount || 0),
          slotCoordinateWriteReferenceCount: Number(dataset.roomEntityFrameCoverageSlotCoordinateWriteReferenceCount || 0),
          slotCoordinateReadWriteReferenceCount: Number(dataset.roomEntityFrameCoverageSlotCoordinateReadWriteReferenceCount || 0),
          slotCoordinateUnknownReferenceCount: Number(dataset.roomEntityFrameCoverageSlotCoordinateUnknownReferenceCount || 0),
          slotCoordinateRoutineReferenceCount: Number(dataset.roomEntityFrameCoverageSlotCoordinateRoutineReferenceCount || 0),
          slotCoordinateConfirmedContextReferenceCount: Number(dataset.roomEntityFrameCoverageSlotCoordinateConfirmedContextReferenceCount || 0),
          slotCoordinateCandidateContextReferenceCount: Number(dataset.roomEntityFrameCoverageSlotCoordinateCandidateContextReferenceCount || 0),
          slotCoordinateRoomEntityInitializerLabel: dataset.roomEntityFrameCoverageSlotCoordinateRoomEntityInitializerLabel || '',
          slotCoordinateOamPositionProducerLabel: dataset.roomEntityFrameCoverageSlotCoordinateOamPositionProducerLabel || '',
          slotCoordinateOamFrameStreamConsumerLabel: dataset.roomEntityFrameCoverageSlotCoordinateOamFrameStreamConsumerLabel || '',
          slotCoordinateXSlotFields: dataset.roomEntityFrameCoverageSlotCoordinateXSlotFields || '',
          slotCoordinateYSlotFields: dataset.roomEntityFrameCoverageSlotCoordinateYSlotFields || '',
          slotCoordinateXRoomRecordSourceFields: dataset.roomEntityFrameCoverageSlotCoordinateXRoomRecordSourceFields || '',
          slotCoordinateYRoomRecordSourceFields: dataset.roomEntityFrameCoverageSlotCoordinateYRoomRecordSourceFields || '',
          slotCoordinateXBaseOutputRam: dataset.roomEntityFrameCoverageSlotCoordinateXBaseOutputRam || '',
          slotCoordinateYBaseOutputRam: dataset.roomEntityFrameCoverageSlotCoordinateYBaseOutputRam || '',
          slotCoordinateRuntimePositionCoordinateModelStatus: dataset.roomEntityFrameCoverageSlotCoordinateRuntimePositionCoordinateModelStatus || '',
          slotCoordinatePersistedCoordinateCount: Number(dataset.roomEntityFrameCoverageSlotCoordinatePersistedCoordinateCount || 0),
          positionIntegratorCatalogBacked: dataset.roomEntityFrameCoveragePositionIntegratorCatalogBacked === '1',
          positionIntegratorCatalogId: dataset.roomEntityFrameCoveragePositionIntegratorCatalogId || '',
          positionIntegratorRoutineCount: Number(dataset.roomEntityFrameCoveragePositionIntegratorRoutineCount || 0),
          positionIntegratorBothAxesRoutine: dataset.roomEntityFrameCoveragePositionIntegratorBothAxesRoutine || '',
          positionIntegratorXOnlyRoutine: dataset.roomEntityFrameCoveragePositionIntegratorXOnlyRoutine || '',
          positionIntegratorYOnlyRoutine: dataset.roomEntityFrameCoveragePositionIntegratorYOnlyRoutine || '',
          positionIntegratorBothAxisExternalCallCount: Number(dataset.roomEntityFrameCoveragePositionIntegratorBothAxisExternalCallCount || 0),
          positionIntegratorXOnlyExternalCallCount: Number(dataset.roomEntityFrameCoveragePositionIntegratorXOnlyExternalCallCount || 0),
          positionIntegratorYOnlyExternalCallCount: Number(dataset.roomEntityFrameCoveragePositionIntegratorYOnlyExternalCallCount || 0),
          positionIntegratorYOnlyInternalCallCount: Number(dataset.roomEntityFrameCoveragePositionIntegratorYOnlyInternalCallCount || 0),
          positionIntegratorTotalExternalCallCount: Number(dataset.roomEntityFrameCoveragePositionIntegratorTotalExternalCallCount || 0),
          positionIntegratorUniqueExternalCallerCount: Number(dataset.roomEntityFrameCoveragePositionIntegratorUniqueExternalCallerCount || 0),
          positionIntegratorXVelocityFields: dataset.roomEntityFrameCoveragePositionIntegratorXVelocityFields || '',
          positionIntegratorYVelocityFields: dataset.roomEntityFrameCoveragePositionIntegratorYVelocityFields || '',
          positionIntegratorXVisibleCoordinateFields: dataset.roomEntityFrameCoveragePositionIntegratorXVisibleCoordinateFields || '',
          positionIntegratorYVisibleCoordinateFields: dataset.roomEntityFrameCoveragePositionIntegratorYVisibleCoordinateFields || '',
          positionIntegratorPersistedGameplayValueCount: Number(dataset.roomEntityFrameCoveragePositionIntegratorPersistedGameplayValueCount || 0),
          velocityFieldCatalogBacked: dataset.roomEntityFrameCoverageVelocityFieldCatalogBacked === '1',
          velocityFieldCatalogId: dataset.roomEntityFrameCoverageVelocityFieldCatalogId || '',
          velocityFieldFieldCount: Number(dataset.roomEntityFrameCoverageVelocityFieldFieldCount || 0),
          velocityFieldReferenceCount: Number(dataset.roomEntityFrameCoverageVelocityFieldReferenceCount || 0),
          velocityFieldReadReferenceCount: Number(dataset.roomEntityFrameCoverageVelocityFieldReadReferenceCount || 0),
          velocityFieldWriteReferenceCount: Number(dataset.roomEntityFrameCoverageVelocityFieldWriteReferenceCount || 0),
          velocityFieldReadWriteReferenceCount: Number(dataset.roomEntityFrameCoverageVelocityFieldReadWriteReferenceCount || 0),
          velocityFieldUnknownReferenceCount: Number(dataset.roomEntityFrameCoverageVelocityFieldUnknownReferenceCount || 0),
          velocityFieldWriterReferenceCount: Number(dataset.roomEntityFrameCoverageVelocityFieldWriterReferenceCount || 0),
          velocityFieldReaderReferenceCount: Number(dataset.roomEntityFrameCoverageVelocityFieldReaderReferenceCount || 0),
          velocityFieldRoutineReferenceCount: Number(dataset.roomEntityFrameCoverageVelocityFieldRoutineReferenceCount || 0),
          velocityFieldWriterRoutineCount: Number(dataset.roomEntityFrameCoverageVelocityFieldWriterRoutineCount || 0),
          velocityFieldReaderRoutineCount: Number(dataset.roomEntityFrameCoverageVelocityFieldReaderRoutineCount || 0),
          velocityFieldConfirmedContextReferenceCount: Number(dataset.roomEntityFrameCoverageVelocityFieldConfirmedContextReferenceCount || 0),
          velocityFieldCandidateContextReferenceCount: Number(dataset.roomEntityFrameCoverageVelocityFieldCandidateContextReferenceCount || 0),
          velocityFieldXVelocityFields: dataset.roomEntityFrameCoverageVelocityFieldXVelocityFields || '',
          velocityFieldYVelocityFields: dataset.roomEntityFrameCoverageVelocityFieldYVelocityFields || '',
          velocityFieldXIntegratorConsumer: dataset.roomEntityFrameCoverageVelocityFieldXIntegratorConsumer || '',
          velocityFieldYIntegratorConsumer: dataset.roomEntityFrameCoverageVelocityFieldYIntegratorConsumer || '',
          velocityFieldXVelocitySignedDeltaHelper: dataset.roomEntityFrameCoverageVelocityFieldXVelocitySignedDeltaHelper || '',
          velocityFieldYVelocitySignedDeltaHelper: dataset.roomEntityFrameCoverageVelocityFieldYVelocitySignedDeltaHelper || '',
          velocityFieldXContactResponseHelper: dataset.roomEntityFrameCoverageVelocityFieldXContactResponseHelper || '',
          velocityFieldYContactResponseHelpers: dataset.roomEntityFrameCoverageVelocityFieldYContactResponseHelpers || '',
          velocityFieldTableDrivenInitializer: dataset.roomEntityFrameCoverageVelocityFieldTableDrivenInitializer || '',
          velocityFieldPersistedGameplayValueCount: Number(dataset.roomEntityFrameCoverageVelocityFieldPersistedGameplayValueCount || 0),
          motionDeltaCatalogBacked: dataset.roomEntityFrameCoverageMotionDeltaCatalogBacked === '1',
          motionDeltaCatalogId: dataset.roomEntityFrameCoverageMotionDeltaCatalogId || '',
          motionDeltaFieldCount: Number(dataset.roomEntityFrameCoverageMotionDeltaFieldCount || 0),
          motionDeltaReferenceCount: Number(dataset.roomEntityFrameCoverageMotionDeltaReferenceCount || 0),
          motionDeltaReadReferenceCount: Number(dataset.roomEntityFrameCoverageMotionDeltaReadReferenceCount || 0),
          motionDeltaWriteReferenceCount: Number(dataset.roomEntityFrameCoverageMotionDeltaWriteReferenceCount || 0),
          motionDeltaReadWriteReferenceCount: Number(dataset.roomEntityFrameCoverageMotionDeltaReadWriteReferenceCount || 0),
          motionDeltaUnknownReferenceCount: Number(dataset.roomEntityFrameCoverageMotionDeltaUnknownReferenceCount || 0),
          motionDeltaWriterReferenceCount: Number(dataset.roomEntityFrameCoverageMotionDeltaWriterReferenceCount || 0),
          motionDeltaReaderReferenceCount: Number(dataset.roomEntityFrameCoverageMotionDeltaReaderReferenceCount || 0),
          motionDeltaRoutineReferenceCount: Number(dataset.roomEntityFrameCoverageMotionDeltaRoutineReferenceCount || 0),
          motionDeltaWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaWriterRoutineCount || 0),
          motionDeltaReaderRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaReaderRoutineCount || 0),
          motionDeltaConfirmedContextReferenceCount: Number(dataset.roomEntityFrameCoverageMotionDeltaConfirmedContextReferenceCount || 0),
          motionDeltaCandidateContextReferenceCount: Number(dataset.roomEntityFrameCoverageMotionDeltaCandidateContextReferenceCount || 0),
          motionDeltaXDeltaField: dataset.roomEntityFrameCoverageMotionDeltaXDeltaField || '',
          motionDeltaYDeltaField: dataset.roomEntityFrameCoverageMotionDeltaYDeltaField || '',
          motionDeltaXVelocityDeltaConsumer: dataset.roomEntityFrameCoverageMotionDeltaXVelocityDeltaConsumer || '',
          motionDeltaYVelocityDeltaConsumer: dataset.roomEntityFrameCoverageMotionDeltaYVelocityDeltaConsumer || '',
          motionDeltaCombinedVelocityDeltaEntry: dataset.roomEntityFrameCoverageMotionDeltaCombinedVelocityDeltaEntry || '',
          motionDeltaXGlobalAccumulatorInput: dataset.roomEntityFrameCoverageMotionDeltaXGlobalAccumulatorInput || '',
          motionDeltaYGlobalAccumulatorInput: dataset.roomEntityFrameCoverageMotionDeltaYGlobalAccumulatorInput || '',
          motionDeltaC600MotionControllerGateRoutines: dataset.roomEntityFrameCoverageMotionDeltaC600MotionControllerGateRoutines || '',
          motionDeltaCollisionReactionWriters: dataset.roomEntityFrameCoverageMotionDeltaCollisionReactionWriters || '',
          motionDeltaTableDrivenInitializer: dataset.roomEntityFrameCoverageMotionDeltaTableDrivenInitializer || '',
          motionDeltaPersistedGameplayValueCount: Number(dataset.roomEntityFrameCoverageMotionDeltaPersistedGameplayValueCount || 0),
          motionDeltaBehaviorCatalogBacked: dataset.roomEntityFrameCoverageMotionDeltaBehaviorCatalogBacked === '1',
          motionDeltaBehaviorCatalogId: dataset.roomEntityFrameCoverageMotionDeltaBehaviorCatalogId || '',
          motionDeltaBehaviorWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorWriterRoutineCount || 0),
          motionDeltaBehaviorLinkedWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorLinkedWriterRoutineCount || 0),
          motionDeltaBehaviorBehaviorTableLinkedWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorBehaviorTableLinkedWriterRoutineCount || 0),
          motionDeltaBehaviorC3c0InitializerWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorC3c0InitializerWriterRoutineCount || 0),
          motionDeltaBehaviorAuxiliaryActorWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorAuxiliaryActorWriterRoutineCount || 0),
          motionDeltaBehaviorC640PairSlotWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorC640PairSlotWriterRoutineCount || 0),
          motionDeltaBehaviorC740SlotWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorC740SlotWriterRoutineCount || 0),
          motionDeltaBehaviorC600RecordInitializerWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorC600RecordInitializerWriterRoutineCount || 0),
          motionDeltaBehaviorC600CollisionResponseWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorC600CollisionResponseWriterRoutineCount || 0),
          motionDeltaBehaviorBank2SceneWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorBank2SceneWriterRoutineCount || 0),
          motionDeltaBehaviorBank2TransitionWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorBank2TransitionWriterRoutineCount || 0),
          motionDeltaBehaviorGameplayLookupWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorGameplayLookupWriterRoutineCount || 0),
          motionDeltaBehaviorUnresolvedWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorUnresolvedWriterRoutineCount || 0),
          motionDeltaBehaviorDirectOrScheduledDeltaConsumerLinkedWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorDirectOrScheduledDeltaConsumerLinkedWriterRoutineCount || 0),
          motionDeltaBehaviorMotionSeedOnlyWriterRoutineCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorMotionSeedOnlyWriterRoutineCount || 0),
          motionDeltaBehaviorWriterReferenceCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorWriterReferenceCount || 0),
          motionDeltaBehaviorReaderReferenceCountInWriterRoutines: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorReaderReferenceCountInWriterRoutines || 0),
          motionDeltaBehaviorPersistedGameplayValueCount: Number(dataset.roomEntityFrameCoverageMotionDeltaBehaviorPersistedGameplayValueCount || 0),
          c3c0MotionSeedCatalogBacked: dataset.roomEntityFrameCoverageC3c0MotionSeedCatalogBacked === '1',
          c3c0MotionSeedCatalogId: dataset.roomEntityFrameCoverageC3c0MotionSeedCatalogId || '',
          c3c0MotionSeedSeedRoutineCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedSeedRoutineCount || 0),
          c3c0MotionSeedBehaviorListResolvedSeedRoutineCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedBehaviorListResolvedSeedRoutineCount || 0),
          c3c0MotionSeedDirectInitializerBehaviorListSeedRoutineCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedDirectInitializerBehaviorListSeedRoutineCount || 0),
          c3c0MotionSeedCallerProvidedBehaviorListSeedRoutineCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedCallerProvidedBehaviorListSeedRoutineCount || 0),
          c3c0MotionSeedUnresolvedBehaviorListSeedRoutineCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedUnresolvedBehaviorListSeedRoutineCount || 0),
          c3c0MotionSeedBehaviorListSourceCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedBehaviorListSourceCount || 0),
          c3c0MotionSeedUniqueBehaviorListExpressionCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedUniqueBehaviorListExpressionCount || 0),
          c3c0MotionSeedPointerAdjustmentExpressionCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedPointerAdjustmentExpressionCount || 0),
          c3c0MotionSeedTotalTableEntryReferences: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTotalTableEntryReferences || 0),
          c3c0MotionSeedTotalWriterReferenceCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTotalWriterReferenceCount || 0),
          c3c0MotionSeedPersistedGameplayValueCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedPersistedGameplayValueCount || 0),
          c3c0MotionSeedTargetCatalogBacked: dataset.roomEntityFrameCoverageC3c0MotionSeedTargetCatalogBacked === '1',
          c3c0MotionSeedTargetCatalogId: dataset.roomEntityFrameCoverageC3c0MotionSeedTargetCatalogId || '',
          c3c0MotionSeedTargetSeedRoutineCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTargetSeedRoutineCount || 0),
          c3c0MotionSeedTargetBehaviorListSourceCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTargetBehaviorListSourceCount || 0),
          c3c0MotionSeedTargetLinkedBehaviorListSourceCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTargetLinkedBehaviorListSourceCount || 0),
          c3c0MotionSeedTargetMissingBehaviorListSourceCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTargetMissingBehaviorListSourceCount || 0),
          c3c0MotionSeedTargetTargetEntryCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTargetTargetEntryCount || 0),
          c3c0MotionSeedTargetUniqueTargetRegionCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTargetUniqueTargetRegionCount || 0),
          c3c0MotionSeedTargetSeedRoutinesWithMultipleBehaviorLists: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTargetSeedRoutinesWithMultipleBehaviorLists || 0),
          c3c0MotionSeedTargetSeedRoutinesWithMissingBehaviorLists: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTargetSeedRoutinesWithMissingBehaviorLists || 0),
          c3c0MotionSeedTargetSeedRoutinesWithTargetLinks: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTargetSeedRoutinesWithTargetLinks || 0),
          c3c0MotionSeedTargetMaxTargetEntriesPerSeed: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTargetMaxTargetEntriesPerSeed || 0),
          c3c0MotionSeedTargetTotalTableEntryReferences: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTargetTotalTableEntryReferences || 0),
          c3c0MotionSeedTargetPersistedGameplayValueCount: Number(dataset.roomEntityFrameCoverageC3c0MotionSeedTargetPersistedGameplayValueCount || 0),
          c3c0BehaviorTargetSemanticsCatalogBacked: dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsCatalogBacked === '1',
          c3c0BehaviorTargetSemanticsCatalogId: dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsCatalogId || '',
          c3c0BehaviorTargetSemanticsSourceTargetEntryCount: Number(dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsSourceTargetEntryCount || 0),
          c3c0BehaviorTargetSemanticsUniqueTargetOffsetCount: Number(dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsUniqueTargetOffsetCount || 0),
          c3c0BehaviorTargetSemanticsTargetRegionCount: Number(dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetRegionCount || 0),
          c3c0BehaviorTargetSemanticsTargetsWithKnownHelperCalls: Number(dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetsWithKnownHelperCalls || 0),
          c3c0BehaviorTargetSemanticsTargetsWithPackedMotionDeltaConsumer: Number(dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetsWithPackedMotionDeltaConsumer || 0),
          c3c0BehaviorTargetSemanticsTargetsWithVelocityIntegrator: Number(dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetsWithVelocityIntegrator || 0),
          c3c0BehaviorTargetSemanticsTargetsWithCollisionPipeline: Number(dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetsWithCollisionPipeline || 0),
          c3c0BehaviorTargetSemanticsTargetsWithAnimationTick: Number(dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetsWithAnimationTick || 0),
          c3c0BehaviorTargetSemanticsTargetsWithBehaviorStateWrite: Number(dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetsWithBehaviorStateWrite || 0),
          c3c0BehaviorTargetSemanticsHelperCallCount: Number(dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsHelperCallCount || 0),
          c3c0BehaviorTargetSemanticsWarningTargetCount: Number(dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsWarningTargetCount || 0),
          c3c0BehaviorTargetSemanticsPersistedRomByteCount: Number(dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsPersistedRomByteCount || 0),
          c3c0BehaviorTargetSemanticsPersistedGameplayValueCount: Number(dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsPersistedGameplayValueCount || 0),
          c3c0ActorFamilyCatalogBacked: dataset.roomEntityFrameCoverageC3c0ActorFamilyCatalogBacked === '1',
          c3c0ActorFamilyCatalogId: dataset.roomEntityFrameCoverageC3c0ActorFamilyCatalogId || '',
          c3c0ActorFamilyRawEntityTypeCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyRawEntityTypeCount || 0),
          c3c0ActorFamilySelectorTypeCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilySelectorTypeCount || 0),
          c3c0ActorFamilyDirectSeedEntityTypeCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyDirectSeedEntityTypeCount || 0),
          c3c0ActorFamilyTailSeedEntityTypeCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyTailSeedEntityTypeCount || 0),
          c3c0ActorFamilySeedRoutineCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilySeedRoutineCount || 0),
          c3c0ActorFamilySeedGroupCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilySeedGroupCount || 0),
          c3c0ActorFamilyBehaviorListLinkedEntityTypeCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyBehaviorListLinkedEntityTypeCount || 0),
          c3c0ActorFamilyMissingBehaviorListSourceEntityTypeCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyMissingBehaviorListSourceEntityTypeCount || 0),
          c3c0ActorFamilyTargetLinkedEntityTypeCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyTargetLinkedEntityTypeCount || 0),
          c3c0ActorFamilyTargetEntryReferenceCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyTargetEntryReferenceCount || 0),
          c3c0ActorFamilyUniqueTargetOffsetCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyUniqueTargetOffsetCount || 0),
          c3c0ActorFamilyActorTypesWithPackedMotionDeltaConsumer: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyActorTypesWithPackedMotionDeltaConsumer || 0),
          c3c0ActorFamilyActorTypesWithCollisionPipeline: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyActorTypesWithCollisionPipeline || 0),
          c3c0ActorFamilyActorTypesWithAnimationTick: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyActorTypesWithAnimationTick || 0),
          c3c0ActorFamilyFrameLinkedEntityTypeCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyFrameLinkedEntityTypeCount || 0),
          c3c0ActorFamilyDynamicUploadedEntityTypeCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyDynamicUploadedEntityTypeCount || 0),
          c3c0ActorFamilyFullyCoveredEntityTypeCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyFullyCoveredEntityTypeCount || 0),
          c3c0ActorFamilyPartialCoverageEntityTypeCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyPartialCoverageEntityTypeCount || 0),
          c3c0ActorFamilyWarningActorTypeCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyWarningActorTypeCount || 0),
          c3c0ActorFamilyPersistedRomByteCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyPersistedRomByteCount || 0),
          c3c0ActorFamilyPersistedCoordinateCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyPersistedCoordinateCount || 0),
          c3c0ActorFamilyPersistedPixelCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyPersistedPixelCount || 0),
          c3c0ActorFamilyPersistedGameplayValueCount: Number(dataset.roomEntityFrameCoverageC3c0ActorFamilyPersistedGameplayValueCount || 0),
          c3c0RenderabilityCatalogBacked: dataset.roomEntityFrameCoverageC3c0RenderabilityCatalogBacked === '1',
          c3c0RenderabilityCatalogId: dataset.roomEntityFrameCoverageC3c0RenderabilityCatalogId || '',
          c3c0RenderabilityActorTypeCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityActorTypeCount || 0),
          c3c0RenderabilityFrameLinkedActorTypeCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityFrameLinkedActorTypeCount || 0),
          c3c0RenderabilityDynamicUploadedActorTypeCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityDynamicUploadedActorTypeCount || 0),
          c3c0RenderabilityFullyRenderableActorTypeCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityFullyRenderableActorTypeCount || 0),
          c3c0RenderabilityPartiallyRenderableActorTypeCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityPartiallyRenderableActorTypeCount || 0),
          c3c0RenderabilityBlockedPendingTileBaseTraceActorTypeCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityBlockedPendingTileBaseTraceActorTypeCount || 0),
          c3c0RenderabilityNoHighConfidenceFrameAssetActorTypeCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityNoHighConfidenceFrameAssetActorTypeCount || 0),
          c3c0RenderabilityFrameLinkedWithoutObservedDynamicUploadActorTypeCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityFrameLinkedWithoutObservedDynamicUploadActorTypeCount || 0),
          c3c0RenderabilityRenderableFixtureActorTypeCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityRenderableFixtureActorTypeCount || 0),
          c3c0RenderabilityRenderableFixtureCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityRenderableFixtureCount || 0),
          c3c0RenderabilityDynamicUploadBackedFixtureCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityDynamicUploadBackedFixtureCount || 0),
          c3c0RenderabilitySeedGroupCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilitySeedGroupCount || 0),
          c3c0RenderabilityPartialTraceEntityTypes: dataset.roomEntityFrameCoverageC3c0RenderabilityPartialTraceEntityTypes || '',
          c3c0RenderabilityBlockedTraceEntityTypes: dataset.roomEntityFrameCoverageC3c0RenderabilityBlockedTraceEntityTypes || '',
          c3c0RenderabilityBestFrameStepCandidate: dataset.roomEntityFrameCoverageC3c0RenderabilityBestFrameStepCandidate || '',
          c3c0RenderabilityBestFrameStepCandidateSeed: dataset.roomEntityFrameCoverageC3c0RenderabilityBestFrameStepCandidateSeed || '',
          c3c0RenderabilityBestFrameStepCandidateScore: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityBestFrameStepCandidateScore || 0),
          c3c0RenderabilityOamTileBaseField: dataset.roomEntityFrameCoverageC3c0RenderabilityOamTileBaseField || '',
          c3c0RenderabilityOamFrameStreamRoutine: dataset.roomEntityFrameCoverageC3c0RenderabilityOamFrameStreamRoutine || '',
          c3c0RenderabilityOamPositionProducerRoutine: dataset.roomEntityFrameCoverageC3c0RenderabilityOamPositionProducerRoutine || '',
          c3c0RenderabilityPersistedRomByteCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityPersistedRomByteCount || 0),
          c3c0RenderabilityPersistedTileByteCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityPersistedTileByteCount || 0),
          c3c0RenderabilityPersistedPixelCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityPersistedPixelCount || 0),
          c3c0RenderabilityPersistedCoordinateCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityPersistedCoordinateCount || 0),
          c3c0RenderabilityPersistedGameplayValueCount: Number(dataset.roomEntityFrameCoverageC3c0RenderabilityPersistedGameplayValueCount || 0),
          c3c0FrameStepDiagnosticCatalogBacked: dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticCatalogBacked === '1',
          c3c0FrameStepDiagnosticCatalogId: dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticCatalogId || '',
          c3c0FrameStepDiagnosticCandidateEntityType: dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticCandidateEntityType || '',
          c3c0FrameStepDiagnosticCandidateSeedLabel: dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticCandidateSeedLabel || '',
          c3c0FrameStepDiagnosticBehaviorListSource: dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorListSource || '',
          c3c0FrameStepDiagnosticBehaviorStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorStateCount || 0),
          c3c0FrameStepDiagnosticTargetRegionCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticTargetRegionCount || 0),
          c3c0FrameStepDiagnosticCallPlanEntryCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticCallPlanEntryCount || 0),
          c3c0FrameStepDiagnosticUnresolvedCallPlanCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticUnresolvedCallPlanCount || 0),
          c3c0FrameStepDiagnosticHelperTargetCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticHelperTargetCount || 0),
          c3c0FrameStepDiagnosticHelperRoleResolvedTargetCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticHelperRoleResolvedTargetCount || 0),
          c3c0FrameStepDiagnosticExactSemanticsPendingHelperTargetCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticExactSemanticsPendingHelperTargetCount || 0),
          c3c0FrameStepDiagnosticInternalHelperEntryRoleKnownTargetCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticInternalHelperEntryRoleKnownTargetCount || 0),
          c3c0FrameStepDiagnosticLocalBehaviorSubroutineRoleKnownTargetCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticLocalBehaviorSubroutineRoleKnownTargetCount || 0),
          c3c0FrameStepDiagnosticRegionEntryRoleKnownTargetCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticRegionEntryRoleKnownTargetCount || 0),
          c3c0FrameStepDiagnosticBehaviorStatesWithAnimationTick: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorStatesWithAnimationTick || 0),
          c3c0FrameStepDiagnosticBehaviorStatesWithCollisionPipeline: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorStatesWithCollisionPipeline || 0),
          c3c0FrameStepDiagnosticBehaviorStatesWithPackedMotionDeltaConsumer: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorStatesWithPackedMotionDeltaConsumer || 0),
          c3c0FrameStepDiagnosticBehaviorStatesWithBehaviorStateWrite: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorStatesWithBehaviorStateWrite || 0),
          c3c0FrameStepDiagnosticBehaviorStatesWithTimerCounterWrite: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorStatesWithTimerCounterWrite || 0),
          c3c0FrameStepDiagnosticFieldTokenCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticFieldTokenCount || 0),
          c3c0FrameStepDiagnosticBranchPredicatePendingStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBranchPredicatePendingStateCount || 0),
          c3c0FrameStepDiagnosticFrameExactStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticFrameExactStateCount || 0),
          c3c0FrameStepDiagnosticDiagnosticStatus: dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticDiagnosticStatus || '',
          c3c0FrameStepDiagnosticPersistedRomByteCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticPersistedRomByteCount || 0),
          c3c0FrameStepDiagnosticPersistedInstructionByteCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticPersistedInstructionByteCount || 0),
          c3c0FrameStepDiagnosticPersistedTileByteCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticPersistedTileByteCount || 0),
          c3c0FrameStepDiagnosticPersistedPixelCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticPersistedPixelCount || 0),
          c3c0FrameStepDiagnosticPersistedCoordinateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticPersistedCoordinateCount || 0),
          c3c0FrameStepDiagnosticPersistedGameplayValueCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticPersistedGameplayValueCount || 0),
          c3c0FrameStepControlFlowCatalogBacked: dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowCatalogBacked === '1',
          c3c0FrameStepControlFlowCatalogId: dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowCatalogId || '',
          c3c0FrameStepControlFlowCandidateEntityType: dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowCandidateEntityType || '',
          c3c0FrameStepControlFlowCandidateSeedLabel: dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowCandidateSeedLabel || '',
          c3c0FrameStepControlFlowBehaviorListSource: dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowBehaviorListSource || '',
          c3c0FrameStepControlFlowBehaviorStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowBehaviorStateCount || 0),
          c3c0FrameStepControlFlowRelativeBranchCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowRelativeBranchCount || 0),
          c3c0FrameStepControlFlowConditionalBranchCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowConditionalBranchCount || 0),
          c3c0FrameStepControlFlowConditionalExitCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowConditionalExitCount || 0),
          c3c0FrameStepControlFlowConditionalControlCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowConditionalControlCount || 0),
          c3c0FrameStepControlFlowSymbolicPredicateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowSymbolicPredicateCount || 0),
          c3c0FrameStepControlFlowUnclassifiedConditionalControlCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowUnclassifiedConditionalControlCount || 0),
          c3c0FrameStepControlFlowSymbolicPredicateStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowSymbolicPredicateStateCount || 0),
          c3c0FrameStepControlFlowFirstTickGuardStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowFirstTickGuardStateCount || 0),
          c3c0FrameStepControlFlowBehaviorStateOperationStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowBehaviorStateOperationStateCount || 0),
          c3c0FrameStepControlFlowBehaviorStateWriteStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowBehaviorStateWriteStateCount || 0),
          c3c0FrameStepControlFlowTimerOperationStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowTimerOperationStateCount || 0),
          c3c0FrameStepControlFlowCountdownOperationStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowCountdownOperationStateCount || 0),
          c3c0FrameStepControlFlowTimerOperationCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowTimerOperationCount || 0),
          c3c0FrameStepControlFlowCountdownOperationCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowCountdownOperationCount || 0),
          c3c0FrameStepControlFlowFieldTokenCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowFieldTokenCount || 0),
          c3c0FrameStepControlFlowFrameExactStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowFrameExactStateCount || 0),
          c3c0FrameStepControlFlowDiagnosticStatus: dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowDiagnosticStatus || '',
          c3c0FrameStepControlFlowPersistedRomByteCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowPersistedRomByteCount || 0),
          c3c0FrameStepControlFlowPersistedInstructionByteCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowPersistedInstructionByteCount || 0),
          c3c0FrameStepControlFlowPersistedTileByteCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowPersistedTileByteCount || 0),
          c3c0FrameStepControlFlowPersistedPixelCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowPersistedPixelCount || 0),
          c3c0FrameStepControlFlowPersistedCoordinateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowPersistedCoordinateCount || 0),
          c3c0FrameStepControlFlowPersistedGameplayValueCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowPersistedGameplayValueCount || 0),
          c3c0FrameStepTraceCatalogBacked: dataset.roomEntityFrameCoverageC3c0FrameStepTraceCatalogBacked === '1',
          c3c0FrameStepTraceCatalogId: dataset.roomEntityFrameCoverageC3c0FrameStepTraceCatalogId || '',
          c3c0FrameStepTraceCandidateEntityType: dataset.roomEntityFrameCoverageC3c0FrameStepTraceCandidateEntityType || '',
          c3c0FrameStepTraceCandidateSeedLabel: dataset.roomEntityFrameCoverageC3c0FrameStepTraceCandidateSeedLabel || '',
          c3c0FrameStepTraceBehaviorListSource: dataset.roomEntityFrameCoverageC3c0FrameStepTraceBehaviorListSource || '',
          c3c0FrameStepTraceBehaviorStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceBehaviorStateCount || 0),
          c3c0FrameStepTraceTraceStepCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceTraceStepCount || 0),
          c3c0FrameStepTraceFieldTouchCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceFieldTouchCount || 0),
          c3c0FrameStepTraceHelperStubCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceHelperStubCount || 0),
          c3c0FrameStepTraceHelperRoleKnownCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceHelperRoleKnownCount || 0),
          c3c0FrameStepTraceConditionalControlCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceConditionalControlCount || 0),
          c3c0FrameStepTraceSymbolicPredicateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceSymbolicPredicateCount || 0),
          c3c0FrameStepTraceUnresolvedPredicateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceUnresolvedPredicateCount || 0),
          c3c0FrameStepTraceFirstTickGuardCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceFirstTickGuardCount || 0),
          c3c0FrameStepTraceBehaviorStateFieldTouchCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceBehaviorStateFieldTouchCount || 0),
          c3c0FrameStepTraceTimerFieldTouchCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceTimerFieldTouchCount || 0),
          c3c0FrameStepTraceLiteralWithheldFieldTouchCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceLiteralWithheldFieldTouchCount || 0),
          c3c0FrameStepTraceStatesWithHelperStubs: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceStatesWithHelperStubs || 0),
          c3c0FrameStepTraceStatesWithFieldTouches: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceStatesWithFieldTouches || 0),
          c3c0FrameStepTraceStatesWithConditionalControls: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceStatesWithConditionalControls || 0),
          c3c0FrameStepTraceStatesWithAllSymbolicPredicates: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceStatesWithAllSymbolicPredicates || 0),
          c3c0FrameStepTraceFieldTokenCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceFieldTokenCount || 0),
          c3c0FrameStepTraceHelperRoleCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceHelperRoleCount || 0),
          c3c0FrameStepTracePredicateKindCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTracePredicateKindCount || 0),
          c3c0FrameStepTraceFrameExactStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTraceFrameExactStateCount || 0),
          c3c0FrameStepTraceReadinessStatus: dataset.roomEntityFrameCoverageC3c0FrameStepTraceReadinessStatus || '',
          c3c0FrameStepTracePersistedRomByteCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTracePersistedRomByteCount || 0),
          c3c0FrameStepTracePersistedInstructionByteCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTracePersistedInstructionByteCount || 0),
          c3c0FrameStepTracePersistedTileByteCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTracePersistedTileByteCount || 0),
          c3c0FrameStepTracePersistedPixelCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTracePersistedPixelCount || 0),
          c3c0FrameStepTracePersistedCoordinateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTracePersistedCoordinateCount || 0),
          c3c0FrameStepTracePersistedGameplayValueCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepTracePersistedGameplayValueCount || 0),
          c3c0FrameStepStepperPreviewBacked: dataset.roomEntityFrameCoverageC3c0FrameStepStepperPreviewBacked === '1',
          c3c0FrameStepStepperCatalogId: dataset.roomEntityFrameCoverageC3c0FrameStepStepperCatalogId || '',
          c3c0FrameStepStepperCandidateEntityType: dataset.roomEntityFrameCoverageC3c0FrameStepStepperCandidateEntityType || '',
          c3c0FrameStepStepperCandidateSeedLabel: dataset.roomEntityFrameCoverageC3c0FrameStepStepperCandidateSeedLabel || '',
          c3c0FrameStepStepperBehaviorListSource: dataset.roomEntityFrameCoverageC3c0FrameStepStepperBehaviorListSource || '',
          c3c0FrameStepStepperStateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperStateCount || 0),
          c3c0FrameStepStepperFrameCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperFrameCount || 0),
          c3c0FrameStepStepperTraceStepCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperTraceStepCount || 0),
          c3c0FrameStepStepperFieldTouchEventCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperFieldTouchEventCount || 0),
          c3c0FrameStepStepperHelperStubEventCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperHelperStubEventCount || 0),
          c3c0FrameStepStepperConditionalEventCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperConditionalEventCount || 0),
          c3c0FrameStepStepperSymbolicPredicateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperSymbolicPredicateCount || 0),
          c3c0FrameStepStepperUnresolvedPredicateCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperUnresolvedPredicateCount || 0),
          c3c0FrameStepStepperFirstTickGuardCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperFirstTickGuardCount || 0),
          c3c0FrameStepStepperRuntimeValueReadCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperRuntimeValueReadCount || 0),
          c3c0FrameStepStepperRuntimeValueWriteCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperRuntimeValueWriteCount || 0),
          c3c0FrameStepStepperBranchOutcomeEvaluatedCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperBranchOutcomeEvaluatedCount || 0),
          c3c0FrameStepStepperHelperEffectEvaluatedCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperHelperEffectEvaluatedCount || 0),
          c3c0FrameStepStepperPersistedGameplayValueCount: Number(dataset.roomEntityFrameCoverageC3c0FrameStepStepperPersistedGameplayValueCount || 0),
          c3c0FrameStepStepperStatus: dataset.roomEntityFrameCoverageC3c0FrameStepStepperStatus || '',
          c3c0FrameStepStepperAssetPolicy: dataset.roomEntityFrameCoverageC3c0FrameStepStepperAssetPolicy || '',
          fixtureRuntimeDecoded: dataset.roomEntityFrameCoverageFixtureRuntimeDecoded === '1',
          fixtureRuntimePreviewedFixtureCount: Number(dataset.roomEntityFrameCoverageFixtureRuntimePreviewedFixtureCount || 0),
          fixtureRuntimeRenderedFixtureRowCount: Number(dataset.roomEntityFrameCoverageFixtureRuntimeRenderedFixtureRowCount || 0),
          fixtureRuntimeRenderedTileCount: Number(dataset.roomEntityFrameCoverageFixtureRuntimeRenderedTileCount || 0),
          fixtureRuntimeRenderedPieceCount: Number(dataset.roomEntityFrameCoverageFixtureRuntimeRenderedPieceCount || 0),
          fixtureRuntimeLayoutPreviewedFixtureCount: Number(dataset.roomEntityFrameCoverageFixtureRuntimeLayoutPreviewedFixtureCount || 0),
          fixtureRuntimeCoordinateMode: dataset.roomEntityFrameCoverageFixtureRuntimeCoordinateMode || '',
          fixtureRuntimeEmptyFixtureCount: Number(dataset.roomEntityFrameCoverageFixtureRuntimeEmptyFixtureCount || 0),
          fixtureRuntimeUnresolvedTileRefCount: Number(dataset.roomEntityFrameCoverageFixtureRuntimeUnresolvedTileRefCount || 0),
          fixtureRuntimeSkippedFixtureCount: Number(dataset.roomEntityFrameCoverageFixtureRuntimeSkippedFixtureCount || 0),
          fixtureRuntimeWarningCount: Number(dataset.roomEntityFrameCoverageFixtureRuntimeWarningCount || 0),
          fixtureRuntimeParseIssueCount: Number(dataset.roomEntityFrameCoverageFixtureRuntimeParseIssueCount || 0),
          fixtureRuntimePersistedTileByteCount: Number(dataset.roomEntityFrameCoverageFixtureRuntimePersistedTileByteCount || 0),
          fixtureRuntimePersistedPixelCount: Number(dataset.roomEntityFrameCoverageFixtureRuntimePersistedPixelCount || 0),
          fixtureRuntimePersistedCoordinateCount: Number(dataset.roomEntityFrameCoverageFixtureRuntimePersistedCoordinateCount || 0),
          persistedTileByteCount: Number(dataset.roomEntityFrameCoveragePersistedTileByteCount || 0),
          persistedPixelCount: Number(dataset.roomEntityFrameCoveragePersistedPixelCount || 0),
          persistedCoordinateCount: Number(dataset.roomEntityFrameCoveragePersistedCoordinateCount || 0),
          assetPolicy: dataset.roomEntityFrameCoverageAssetPolicy || '',
          infoText: (info?.textContent || '').slice(0, 200),
        };
      } catch (error) {
        roomEntityFrameCoveragePreviewResult = {
          error: error?.message || String(error),
        };
      }

      let playerStateGraphPreviewResult = null;
      try {
        if (typeof window.playerStateGraphRenderPreview !== 'function') {
          throw new Error('playerStateGraphRenderPreview is not available');
        }
        window.playerStateGraphRenderPreview();
        const preview = document.getElementById('player-state-graph-preview');
        const info = document.getElementById('player-state-graph-info');
        const dataset = { ...(preview?.dataset || {}) };
        playerStateGraphPreviewResult = {
          catalogId: dataset.playerStateGraphCatalogId || '',
          catalogBacked: dataset.playerStateGraphCatalogBacked === '1',
          previewOk: dataset.playerStateGraphPreviewOk === '1',
          nodeCount: Number(dataset.playerStateGraphNodeCount || 0),
          innerStateNodeCount: Number(dataset.playerStateGraphInnerStateNodeCount || 0),
          vectorSubstateNodeCount: Number(dataset.playerStateGraphVectorSubstateNodeCount || 0),
          transitionEdgeCount: Number(dataset.playerStateGraphTransitionEdgeCount || 0),
          uniqueTransitionTargetCount: Number(dataset.playerStateGraphUniqueTransitionTargetCount || 0),
          ambiguousTargetEdgeCount: Number(dataset.playerStateGraphAmbiguousTargetEdgeCount || 0),
          inputDrivenNodeCount: Number(dataset.playerStateGraphInputDrivenNodeCount || 0),
          contactDrivenNodeCount: Number(dataset.playerStateGraphContactDrivenNodeCount || 0),
          environmentFlagDrivenNodeCount: Number(dataset.playerStateGraphEnvironmentFlagDrivenNodeCount || 0),
          persistedGameplayValueCount: Number(dataset.playerStateGraphPersistedGameplayValueCount || 0),
          assetPolicy: dataset.playerStateGraphAssetPolicy || '',
          infoText: (info?.textContent || '').slice(0, 200),
        };
      } catch (error) {
        playerStateGraphPreviewResult = {
          error: error?.message || String(error),
        };
      }

      let audioRequestGraphPreviewResult = null;
      try {
        if (typeof window.audioRequestGraphRenderPreview !== 'function') {
          throw new Error('audioRequestGraphRenderPreview is not available');
        }
        window.audioRequestGraphRenderPreview();
        const preview = document.getElementById('audio-request-graph-preview');
        const info = document.getElementById('audio-request-graph-info');
        const dataset = { ...(preview?.dataset || {}) };
        audioRequestGraphPreviewResult = {
          catalogBacked: dataset.audioRequestGraphCatalogBacked === '1',
          previewOk: dataset.audioRequestGraphPreviewOk === '1',
          requestCount: Number(dataset.audioRequestGraphRequestCount || 0),
          graphCount: Number(dataset.audioRequestGraphGraphCount || 0),
          missingGraphCount: Number(dataset.audioRequestGraphMissingGraphCount || 0),
          missingTargetCount: Number(dataset.audioRequestGraphMissingTargetCount || 0),
          uniqueStreamCount: Number(dataset.audioRequestGraphUniqueStreamCount || 0),
          branchingRequestCount: Number(dataset.audioRequestGraphBranchingRequestCount || 0),
          branchEdgeCount: Number(dataset.audioRequestGraphBranchEdgeCount || 0),
          zoneLinkedRequestCount: Number(dataset.audioRequestGraphZoneLinkedRequestCount || 0),
          zoneMissingGraphRecipeCount: Number(dataset.audioRequestGraphZoneMissingGraphRecipeCount || 0),
          seedRequestCount: Number(dataset.audioRequestGraphSeedRequestCount || 0),
          seedChannelCount: Number(dataset.audioRequestGraphSeedChannelCount || 0),
          missingSeedRequestCount: Number(dataset.audioRequestGraphMissingSeedRequestCount || 0),
          seedValidationIssueCount: Number(dataset.audioRequestGraphSeedValidationIssueCount || 0),
          frameStepValidationIssueCount: Number(dataset.audioRequestGraphFrameStepValidationIssueCount || 0),
          frameStepMaxFramesPerChannel: Number(dataset.audioRequestGraphFrameStepMaxFramesPerChannel || 0),
          traceOperationCount: Number(dataset.audioRequestGraphTraceOperationCount || 0),
          outputPhaseCount: Number(dataset.audioRequestGraphOutputPhaseCount || 0),
          psgPhaseCount: Number(dataset.audioRequestGraphPsgPhaseCount || 0),
          fmPhaseCount: Number(dataset.audioRequestGraphFmPhaseCount || 0),
          outputWriteCount: Number(dataset.audioRequestGraphOutputWriteCount || 0),
          eventOutputLinkedKindCount: Number(dataset.audioRequestGraphEventOutputLinkedKindCount || 0),
          eventOutputDirectPhaseLinkCount: Number(dataset.audioRequestGraphEventOutputDirectPhaseLinkCount || 0),
          parameterOutputConsumerGapCount: Number(dataset.audioRequestGraphParameterOutputConsumerGapCount || 0),
          controlFlowOnlyUnlinkedEventCount: Number(dataset.audioRequestGraphControlFlowOnlyUnlinkedEventCount || 0),
          indirectSupportLookupReadyEventCount: Number(dataset.audioRequestGraphIndirectSupportLookupReadyEventCount || 0),
          indirectParameterConsumerLinkCount: Number(dataset.audioRequestGraphIndirectParameterConsumerLinkCount || 0),
          indirectParameterPrimaryOutputPhaseCount: Number(dataset.audioRequestGraphIndirectParameterPrimaryOutputPhaseCount || 0),
          indirectParameterValidationIssueCount: Number(dataset.audioRequestGraphIndirectParameterValidationIssueCount || 0),
          resetPreviewedRequestCount: Number(dataset.audioRequestGraphResetPreviewedRequestCount || 0),
          resetFrameStepUnresolvedFrameCount: Number(dataset.audioRequestGraphResetFrameStepUnresolvedFrameCount || 0),
          persistedStreamByteCount: Number(dataset.audioRequestGraphPersistedStreamByteCount || 0),
          persistedRegisterTraceCount: Number(dataset.audioRequestGraphPersistedRegisterTraceCount || 0),
          persistedSampleCount: Number(dataset.audioRequestGraphPersistedSampleCount || 0),
          assetPolicy: dataset.audioRequestGraphAssetPolicy || '',
          infoText: (info?.textContent || '').slice(0, 200),
        };
      } catch (error) {
        audioRequestGraphPreviewResult = {
          error: error?.message || String(error),
        };
      }

      const audioPreviewResults = [];
      const recipeByRequest = new Map();
      for (const recipe of recipes) {
        const requestId = recipe.dependencies?.audioRequest?.requestId;
        if (requestId == null || recipeByRequest.has(requestId)) continue;
        recipeByRequest.set(requestId, recipe);
      }
      const readAudioOutputModeMetrics = () => {
        const preview = document.getElementById('zone-audio-preview');
        const dataset = { ...(preview?.dataset || {}) };
        return {
          outputModeFilter: dataset.zoneAudioPreviewOutputModeFilter || '',
          filteredEntryCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineFilteredEntryCount || 0),
          filteredWriteCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineFilteredWriteCount || 0),
          filteredDroppedEntryCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineFilteredDroppedEntryCount || 0),
          filteredDroppedWriteCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineFilteredDroppedWriteCount || 0),
          persistedRegisterValueCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelinePersistedRegisterValueCount || 0),
          persistedSampleCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelinePersistedSampleCount || 0),
          assetPolicy: dataset.zoneAudioPreviewOutputRegisterTimelineAssetPolicy || '',
        };
      };
      const renderAudioOutputModeMetrics = mode => {
        const outputModeSel = document.getElementById('zone-audio-output-mode-sel');
        if (!outputModeSel) {
          return {
            outputModeFilter: '',
            filteredEntryCount: 0,
            filteredWriteCount: 0,
            filteredDroppedEntryCount: 0,
            filteredDroppedWriteCount: 0,
            persistedRegisterValueCount: 0,
            persistedSampleCount: 0,
            assetPolicy: '',
            error: 'zone-audio-output-mode-sel missing',
          };
        }
        outputModeSel.value = mode;
        window.zoneAudioRenderPreview();
        return readAudioOutputModeMetrics();
      };
      for (const [requestId, recipe] of [...recipeByRequest.entries()].sort((a, b) => a[0] - b[0])) {
        try {
          const sel = document.getElementById('zone-recipe-sel');
          sel.value = recipe.id || '';
          window.zoneBrowserLoadRecipe();
          const outputModeSel = document.getElementById('zone-audio-output-mode-sel');
          if (outputModeSel) outputModeSel.value = 'all';
          window.zoneAudioRenderPreview();
          const preview = document.getElementById('zone-audio-preview');
          const dataset = { ...(preview?.dataset || {}) };
          const allModeMetrics = readAudioOutputModeMetrics();
          const psgModeMetrics = renderAudioOutputModeMetrics('psg');
          const fmModeMetrics = renderAudioOutputModeMetrics('fm');
          if (outputModeSel) outputModeSel.value = 'all';
          audioPreviewResults.push({
            requestId,
            requestIdHex: dataset.zoneAudioRequestId || recipe.dependencies?.audioRequest?.requestIdHex || '',
            recipeId: recipe.id || '',
            recipeType: recipe.recipeType || 'room_zone_render',
            descriptorOffset: recipe.descriptor?.romOffset || '',
            streamGraphId: dataset.zoneAudioStreamGraphId || '',
            metrics: {
              previewChannels: Number(dataset.zoneAudioPreviewChannels || 0),
              previewEvents: Number(dataset.zoneAudioPreviewEvents || 0),
              eventsWithRamRefs: Number(dataset.zoneAudioPreviewEventsWithRamRefs || 0),
              ramRefCount: Number(dataset.zoneAudioPreviewRamRefCount || 0),
              eventsWithUnresolvedRefs: Number(dataset.zoneAudioPreviewEventsWithUnresolvedRefs || 0),
              unresolvedRefCount: Number(dataset.zoneAudioPreviewUnresolvedRefCount || 0),
              eventsWithOutputPhaseLinks: Number(dataset.zoneAudioPreviewEventsWithOutputPhaseLinks || 0),
              directOutputPhaseLinkCount: Number(dataset.zoneAudioPreviewDirectOutputPhaseLinkCount || 0),
              eventsWithTraceOps: Number(dataset.zoneAudioPreviewEventsWithTraceOps || 0),
              traceOpCount: Number(dataset.zoneAudioPreviewTraceOpCount || 0),
              traceStateFieldCount: Number(dataset.zoneAudioPreviewTraceStateFieldCount || 0),
              traceKnownFieldCount: Number(dataset.zoneAudioPreviewTraceKnownFieldCount || 0),
              traceConditionalFieldCount: Number(dataset.zoneAudioPreviewTraceConditionalFieldCount || 0),
              traceKnownOperationCount: Number(dataset.zoneAudioPreviewTraceKnownOperationCount || 0),
              traceConditionalOperationCount: Number(dataset.zoneAudioPreviewTraceConditionalOperationCount || 0),
              traceUnresolvedOperationCount: Number(dataset.zoneAudioPreviewTraceUnresolvedOperationCount || 0),
              traceTouchedOperationCount: Number(dataset.zoneAudioPreviewTraceTouchedOperationCount || 0),
              traceModelRuleCount: Number(dataset.zoneAudioTraceModelRuleCount || 0),
              supportUseUniqueF5EventCount: Number(dataset.zoneAudioSupportUseUniqueF5EventCount || 0),
              supportUsePrefixEscapeF5EventCount: Number(dataset.zoneAudioSupportUsePrefixEscapeF5EventCount || 0),
              supportUseOutOfRangeF5EventCount: Number(dataset.zoneAudioSupportUseOutOfRangeF5EventCount || 0),
              noteTimingTableBytes: Number(dataset.zoneAudioNoteTimingTableBytes || 0),
              noteTimingEvents: Number(dataset.zoneAudioPreviewNoteTimingEvents || 0),
              noteTimingResolvedEvents: Number(dataset.zoneAudioPreviewNoteTimingResolvedEvents || 0),
              noteTimingUnresolvedEvents: Number(dataset.zoneAudioPreviewNoteTimingUnresolvedEvents || 0),
              noteTimingReloadEvents: Number(dataset.zoneAudioPreviewNoteTimingReloadEvents || 0),
              noteTimingReloadResolvedEvents: Number(dataset.zoneAudioPreviewNoteTimingReloadResolvedEvents || 0),
              noteTimingReloadUnresolvedEvents: Number(dataset.zoneAudioPreviewNoteTimingReloadUnresolvedEvents || 0),
              parameterMirrorEvents: Number(dataset.zoneAudioPreviewParameterMirrorEvents || 0),
              parameterMirrorPitchResolvedEvents: Number(dataset.zoneAudioPreviewParameterMirrorPitchResolvedEvents || 0),
              parameterMirrorPitchUnresolvedEvents: Number(dataset.zoneAudioPreviewParameterMirrorPitchUnresolvedEvents || 0),
              parameterMirrorVolumeConditionalEvents: Number(dataset.zoneAudioPreviewParameterMirrorVolumeConditionalEvents || 0),
              parameterMirrorVolumeUnresolvedEvents: Number(dataset.zoneAudioPreviewParameterMirrorVolumeUnresolvedEvents || 0),
              parameterOutputReadinessPhaseCount: Number(dataset.zoneAudioPreviewParameterOutputReadinessPhaseCount || 0),
              parameterOutputReadinessResolvedInputCount: Number(dataset.zoneAudioPreviewParameterOutputReadinessResolvedInputCount || 0),
              parameterOutputReadinessConditionalInputCount: Number(dataset.zoneAudioPreviewParameterOutputReadinessConditionalInputCount || 0),
              parameterOutputReadinessUnresolvedInputCount: Number(dataset.zoneAudioPreviewParameterOutputReadinessUnresolvedInputCount || 0),
              outputPhaseScheduleEventCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleEventCount || 0),
              outputPhaseSchedulePhaseCount: Number(dataset.zoneAudioPreviewOutputPhaseSchedulePhaseCount || 0),
              outputPhaseScheduleWriteCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleWriteCount || 0),
              outputPhaseScheduleResolvedInputCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleResolvedInputCount || 0),
              outputPhaseScheduleConditionalInputCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleConditionalInputCount || 0),
              outputPhaseSchedulePartialInputCount: Number(dataset.zoneAudioPreviewOutputPhaseSchedulePartialInputCount || 0),
              outputPhaseScheduleMetadataOnlyCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleMetadataOnlyCount || 0),
              outputPhaseSchedulePsgPhaseCount: Number(dataset.zoneAudioPreviewOutputPhaseSchedulePsgPhaseCount || 0),
              outputPhaseScheduleFmPhaseCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleFmPhaseCount || 0),
              outputPhaseScheduleMixedPhaseCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleMixedPhaseCount || 0),
              outputPhaseScheduleGlobalInputRefCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleGlobalInputRefCount || 0),
              outputPhaseScheduleKnownGlobalInputCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleKnownGlobalInputCount || 0),
              outputPhaseScheduleConditionalGlobalInputCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleConditionalGlobalInputCount || 0),
              outputPhaseScheduleUnresolvedGlobalInputCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleUnresolvedGlobalInputCount || 0),
              outputPhaseScheduleGlobalFlowCatalogBackedCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleGlobalFlowCatalogBackedCount || 0),
              outputPhaseScheduleActiveChannelContextCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleActiveChannelContextCount || 0),
              outputPhaseScheduleAudioOutputModeSelectConditionalCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleAudioOutputModeSelectConditionalCount || 0),
              outputPhaseSchedulePsgVolumeBiasUnresolvedCount: Number(dataset.zoneAudioPreviewOutputPhaseSchedulePsgVolumeBiasUnresolvedCount || 0),
              outputPhaseScheduleModeBranchCandidateCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleModeBranchCandidateCount || 0),
              outputPhaseSchedulePsgModeBranchCandidateCount: Number(dataset.zoneAudioPreviewOutputPhaseSchedulePsgModeBranchCandidateCount || 0),
              outputPhaseScheduleFmModeBranchCandidateCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleFmModeBranchCandidateCount || 0),
              outputPhaseScheduleModeIndependentCandidateCount: Number(dataset.zoneAudioPreviewOutputPhaseScheduleModeIndependentCandidateCount || 0),
              outputRegisterTimelineEventCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineEventCount || 0),
              outputRegisterTimelineEntryCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineEntryCount || 0),
              outputRegisterTimelineFrameLinkedEntryCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineFrameLinkedEntryCount || 0),
              outputRegisterTimelineFrameUnlinkedEntryCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineFrameUnlinkedEntryCount || 0),
              outputRegisterTimelineWriteCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineWriteCount || 0),
              outputRegisterTimelinePsgEntryCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelinePsgEntryCount || 0),
              outputRegisterTimelineFmEntryCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineFmEntryCount || 0),
              outputRegisterTimelineMixedEntryCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineMixedEntryCount || 0),
              outputRegisterTimelineResolvedInputCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineResolvedInputCount || 0),
              outputRegisterTimelineConditionalInputCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineConditionalInputCount || 0),
              outputRegisterTimelinePartialInputCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelinePartialInputCount || 0),
              outputRegisterTimelineMetadataOnlyCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineMetadataOnlyCount || 0),
              outputRegisterTimelineGlobalInputRefCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineGlobalInputRefCount || 0),
              outputRegisterTimelineKnownGlobalInputCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineKnownGlobalInputCount || 0),
              outputRegisterTimelineConditionalGlobalInputCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineConditionalGlobalInputCount || 0),
              outputRegisterTimelineUnresolvedGlobalInputCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineUnresolvedGlobalInputCount || 0),
              outputRegisterTimelineGlobalFlowCatalogBackedCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineGlobalFlowCatalogBackedCount || 0),
              outputRegisterTimelineActiveChannelContextCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineActiveChannelContextCount || 0),
              outputRegisterTimelineAudioOutputModeSelectConditionalCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineAudioOutputModeSelectConditionalCount || 0),
              outputRegisterTimelinePsgVolumeBiasUnresolvedCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelinePsgVolumeBiasUnresolvedCount || 0),
              outputRegisterTimelineModeBranchCandidateCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineModeBranchCandidateCount || 0),
              outputRegisterTimelinePsgModeBranchCandidateCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelinePsgModeBranchCandidateCount || 0),
              outputRegisterTimelineFmModeBranchCandidateCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineFmModeBranchCandidateCount || 0),
              outputRegisterTimelineModeIndependentCandidateCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineModeIndependentCandidateCount || 0),
              outputRegisterTimelinePsgModeAlternativeEntryCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelinePsgModeAlternativeEntryCount || 0),
              outputRegisterTimelinePsgModeAlternativeWriteCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelinePsgModeAlternativeWriteCount || 0),
              outputRegisterTimelineFmModeAlternativeEntryCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineFmModeAlternativeEntryCount || 0),
              outputRegisterTimelineFmModeAlternativeWriteCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelineFmModeAlternativeWriteCount || 0),
              outputModeFilter: allModeMetrics.outputModeFilter,
              outputRegisterTimelineFilteredEntryCount: allModeMetrics.filteredEntryCount,
              outputRegisterTimelineFilteredWriteCount: allModeMetrics.filteredWriteCount,
              outputRegisterTimelineFilteredDroppedEntryCount: allModeMetrics.filteredDroppedEntryCount,
              outputRegisterTimelineFilteredDroppedWriteCount: allModeMetrics.filteredDroppedWriteCount,
              outputRegisterTimelinePsgSelectedOutputModeFilter: psgModeMetrics.outputModeFilter,
              outputRegisterTimelinePsgSelectedFilteredEntryCount: psgModeMetrics.filteredEntryCount,
              outputRegisterTimelinePsgSelectedFilteredWriteCount: psgModeMetrics.filteredWriteCount,
              outputRegisterTimelinePsgSelectedDroppedEntryCount: psgModeMetrics.filteredDroppedEntryCount,
              outputRegisterTimelinePsgSelectedDroppedWriteCount: psgModeMetrics.filteredDroppedWriteCount,
              outputRegisterTimelineFmSelectedOutputModeFilter: fmModeMetrics.outputModeFilter,
              outputRegisterTimelineFmSelectedFilteredEntryCount: fmModeMetrics.filteredEntryCount,
              outputRegisterTimelineFmSelectedFilteredWriteCount: fmModeMetrics.filteredWriteCount,
              outputRegisterTimelineFmSelectedDroppedEntryCount: fmModeMetrics.filteredDroppedEntryCount,
              outputRegisterTimelineFmSelectedDroppedWriteCount: fmModeMetrics.filteredDroppedWriteCount,
              outputRegisterTimelineModeFilterError: psgModeMetrics.error || fmModeMetrics.error || '',
              outputRegisterTimelinePersistedRegisterValueCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelinePersistedRegisterValueCount || 0),
              outputRegisterTimelinePersistedSampleCount: Number(dataset.zoneAudioPreviewOutputRegisterTimelinePersistedSampleCount || 0),
              outputRegisterTimelineAssetPolicy: dataset.zoneAudioPreviewOutputRegisterTimelineAssetPolicy || '',
              frameGateCatalogGateCount: Number(dataset.zoneAudioFrameGateCatalogGateCount || 0),
              frameGateKnownChannels: Number(dataset.zoneAudioPreviewFrameGateKnownChannels || 0),
              frameGateFetchChannels: Number(dataset.zoneAudioPreviewFrameGateFetchChannels || 0),
              frameGateWaitChannels: Number(dataset.zoneAudioPreviewFrameGateWaitChannels || 0),
              frameGateUnresolvedChannels: Number(dataset.zoneAudioPreviewFrameGateUnresolvedChannels || 0),
              streamSeedRequestCount: Number(dataset.zoneAudioStreamSeedRequestCount || 0),
              streamSeedChannelCount: Number(dataset.zoneAudioStreamSeedChannelCount || 0),
              seedResolvedChannels: Number(dataset.zoneAudioPreviewSeedResolvedChannels || 0),
              seedMissingChannels: Number(dataset.zoneAudioPreviewSeedMissingChannels || 0),
              seedInitialFetchChannels: Number(dataset.zoneAudioPreviewSeedInitialFetchChannels || 0),
              frameStepChannels: Number(dataset.zoneAudioPreviewFrameStepChannels || 0),
              frameStepFrames: Number(dataset.zoneAudioPreviewFrameStepFrames || 0),
              frameStepFetchFrames: Number(dataset.zoneAudioPreviewFrameStepFetchFrames || 0),
              frameStepWaitFrames: Number(dataset.zoneAudioPreviewFrameStepWaitFrames || 0),
              frameStepEventFrames: Number(dataset.zoneAudioPreviewFrameStepEventFrames || 0),
              frameStepResetFetchFrames: Number(dataset.zoneAudioPreviewFrameStepResetFetchFrames || 0),
              frameStepUnresolvedFrames: Number(dataset.zoneAudioPreviewFrameStepUnresolvedFrames || 0),
              frameStepEndedChannels: Number(dataset.zoneAudioPreviewFrameStepEndedChannels || 0),
              outputPhaseCount: Number(dataset.zoneAudioOutputPhaseCount || 0),
              outputWriteCount: Number(dataset.zoneAudioOutputWriteCount || 0),
            },
          });
        } catch (error) {
          audioPreviewResults.push({
            requestId,
            requestIdHex: recipe.dependencies?.audioRequest?.requestIdHex || '',
            recipeId: recipe.id || '',
            recipeType: recipe.recipeType || 'room_zone_render',
            descriptorOffset: recipe.descriptor?.romOffset || '',
            error: error?.message || String(error),
          });
        }
      }

      return { normalZoneRecipeCount, inlineTransitionRecipeCount, results, entrySeedSmokeResult, bank7SequencePreviewResult, roomEntityOrphanPreviewResult, roomEntityAssetPreviewResult, roomEntityDynamicPreviewResult, roomEntityFrameCoveragePreviewResult, playerStateGraphPreviewResult, audioRequestGraphPreviewResult, audioPreviewResults };
    });

    const { summary, failures } = summarizeResults(
      renderResults.results,
      renderResults.normalZoneRecipeCount,
      renderResults.inlineTransitionRecipeCount,
      renderResults.audioPreviewResults,
      renderResults.entrySeedSmokeResult,
      renderResults.bank7SequencePreviewResult,
      renderResults.roomEntityOrphanPreviewResult,
      renderResults.roomEntityAssetPreviewResult,
      renderResults.roomEntityDynamicPreviewResult,
      renderResults.roomEntityFrameCoveragePreviewResult,
      renderResults.playerStateGraphPreviewResult,
      renderResults.audioRequestGraphPreviewResult
    );
    if (pageErrors.length) failures.push(`${pageErrors.length} browser page error(s) occurred`);
    if (mapFieldIntegrity.missingTopLevelKeys.length) {
      failures.push(`Map loader dropped ${mapFieldIntegrity.missingTopLevelKeys.length} top-level key(s)`);
    }
    if (mapFieldIntegrity.missingArrayKeys.length) {
      failures.push(`Map loader dropped ${mapFieldIntegrity.missingArrayKeys.length} array field(s)`);
    }
    if (mapFieldIntegrity.mismatchedArrayLengths.length) {
      failures.push(`Map loader changed ${mapFieldIntegrity.mismatchedArrayLengths.length} array length(s)`);
    }

    const sampleResults = renderResults.results.slice(0, 12).map(result => ({
      id: result.id,
      recipeType: result.recipeType,
      descriptorOffset: result.descriptorOffset,
      usedSlots: result.provenance?.usedSlots || 0,
      resolvedSlots: result.provenance?.resolvedSlots || 0,
      unresolvedSlots: result.provenance?.unresolvedSlots || 0,
      commonPrereqSteps: result.commonPrereq?.steps || 0,
      commonPrereqEntries: result.commonPrereq?.entries || 0,
      vram8fbEntries: result.loaders?.vram8fbEntries || 0,
      vram998Entries: result.loaders?.vram998Entries || 0,
      paletteIndex: result.palette?.index || '',
      paletteRegionId: result.palette?.regionId || '',
      paletteOffset: result.palette?.romOffset || '',
      paletteNonBlackColors: result.palette?.nonBlackColors || 0,
      spritePaletteStatus: result.spritePalette?.status || '',
      spritePaletteInheritanceCatalogId: result.spritePalette?.inheritanceCatalogId || '',
      spritePaletteInheritanceOwnerStatus: result.spritePalette?.inheritanceOwnerStatus || '',
      spritePaletteInheritanceStateRam: result.spritePalette?.inheritanceStateRam || '',
      spritePaletteInheritanceCatalogBacked: Boolean(result.spritePalette?.inheritanceCatalogBacked),
      spritePaletteInheritanceRuntimePathClassCount: result.spritePalette?.inheritanceRuntimePathClassCount || 0,
      spritePaletteInheritanceClassifiedRuntimePriorCallsites: result.spritePalette?.inheritanceClassifiedRuntimePriorCallsites || 0,
      spritePaletteInheritancePointerFlowBackedRuntimePriorCallsites: result.spritePalette?.inheritancePointerFlowBackedRuntimePriorCallsites || 0,
      canvasNonBlackPixels: result.canvas?.nonBlackPixels || 0,
      canvasDistinctColorCount: result.canvas?.distinctColorCount || 0,
    }));
    const report = {
      ok: failures.length === 0,
      applied: false,
      project: projectName,
      url: `${baseUrl}/tools/rom-analyzer.html`,
      summary,
      mapFieldIntegrity,
      sampleResults,
      entrySeedSmokeResult: renderResults.entrySeedSmokeResult,
      bank7SequencePreviewResult: renderResults.bank7SequencePreviewResult,
      roomEntityOrphanPreviewResult: renderResults.roomEntityOrphanPreviewResult,
      roomEntityAssetPreviewResult: renderResults.roomEntityAssetPreviewResult,
      roomEntityDynamicPreviewResult: renderResults.roomEntityDynamicPreviewResult,
      roomEntityFrameCoveragePreviewResult: renderResults.roomEntityFrameCoveragePreviewResult,
      playerStateGraphPreviewResult: renderResults.playerStateGraphPreviewResult,
      audioRequestGraphPreviewResult: renderResults.audioRequestGraphPreviewResult,
      audioPreviewSampleResults: (renderResults.audioPreviewResults || []).map(result => ({
        requestIdHex: result.requestIdHex,
        recipeId: result.recipeId,
        recipeType: result.recipeType,
        descriptorOffset: result.descriptorOffset,
        streamGraphId: result.streamGraphId || '',
        previewChannels: result.metrics?.previewChannels || 0,
        previewEvents: result.metrics?.previewEvents || 0,
        ramRefCount: result.metrics?.ramRefCount || 0,
        unresolvedRefCount: result.metrics?.unresolvedRefCount || 0,
        directOutputPhaseLinkCount: result.metrics?.directOutputPhaseLinkCount || 0,
        traceOpCount: result.metrics?.traceOpCount || 0,
        traceStateFieldCount: result.metrics?.traceStateFieldCount || 0,
        noteTimingEvents: result.metrics?.noteTimingEvents || 0,
        noteTimingResolvedEvents: result.metrics?.noteTimingResolvedEvents || 0,
        parameterMirrorEvents: result.metrics?.parameterMirrorEvents || 0,
        parameterMirrorPitchResolvedEvents: result.metrics?.parameterMirrorPitchResolvedEvents || 0,
        parameterMirrorVolumeConditionalEvents: result.metrics?.parameterMirrorVolumeConditionalEvents || 0,
        parameterOutputReadinessPhaseCount: result.metrics?.parameterOutputReadinessPhaseCount || 0,
        parameterOutputReadinessResolvedInputCount: result.metrics?.parameterOutputReadinessResolvedInputCount || 0,
        parameterOutputReadinessConditionalInputCount: result.metrics?.parameterOutputReadinessConditionalInputCount || 0,
        outputPhaseSchedulePhaseCount: result.metrics?.outputPhaseSchedulePhaseCount || 0,
        outputPhaseScheduleWriteCount: result.metrics?.outputPhaseScheduleWriteCount || 0,
        outputPhaseScheduleConditionalInputCount: result.metrics?.outputPhaseScheduleConditionalInputCount || 0,
        outputPhaseSchedulePartialInputCount: result.metrics?.outputPhaseSchedulePartialInputCount || 0,
        outputRegisterTimelineEntryCount: result.metrics?.outputRegisterTimelineEntryCount || 0,
        outputRegisterTimelineFrameLinkedEntryCount: result.metrics?.outputRegisterTimelineFrameLinkedEntryCount || 0,
        outputRegisterTimelineFrameUnlinkedEntryCount: result.metrics?.outputRegisterTimelineFrameUnlinkedEntryCount || 0,
        outputRegisterTimelineWriteCount: result.metrics?.outputRegisterTimelineWriteCount || 0,
        outputRegisterTimelineConditionalInputCount: result.metrics?.outputRegisterTimelineConditionalInputCount || 0,
        outputRegisterTimelineGlobalInputRefCount: result.metrics?.outputRegisterTimelineGlobalInputRefCount || 0,
        outputRegisterTimelineKnownGlobalInputCount: result.metrics?.outputRegisterTimelineKnownGlobalInputCount || 0,
        outputRegisterTimelineConditionalGlobalInputCount: result.metrics?.outputRegisterTimelineConditionalGlobalInputCount || 0,
        outputRegisterTimelineUnresolvedGlobalInputCount: result.metrics?.outputRegisterTimelineUnresolvedGlobalInputCount || 0,
        outputRegisterTimelineGlobalFlowCatalogBackedCount: result.metrics?.outputRegisterTimelineGlobalFlowCatalogBackedCount || 0,
        outputRegisterTimelineActiveChannelContextCount: result.metrics?.outputRegisterTimelineActiveChannelContextCount || 0,
        outputRegisterTimelineAudioOutputModeSelectConditionalCount: result.metrics?.outputRegisterTimelineAudioOutputModeSelectConditionalCount || 0,
        outputRegisterTimelinePsgVolumeBiasUnresolvedCount: result.metrics?.outputRegisterTimelinePsgVolumeBiasUnresolvedCount || 0,
        outputRegisterTimelineModeBranchCandidateCount: result.metrics?.outputRegisterTimelineModeBranchCandidateCount || 0,
        outputRegisterTimelinePsgModeBranchCandidateCount: result.metrics?.outputRegisterTimelinePsgModeBranchCandidateCount || 0,
        outputRegisterTimelineFmModeBranchCandidateCount: result.metrics?.outputRegisterTimelineFmModeBranchCandidateCount || 0,
        outputRegisterTimelinePsgModeAlternativeEntryCount: result.metrics?.outputRegisterTimelinePsgModeAlternativeEntryCount || 0,
        outputRegisterTimelineFmModeAlternativeEntryCount: result.metrics?.outputRegisterTimelineFmModeAlternativeEntryCount || 0,
        outputModeFilter: result.metrics?.outputModeFilter || '',
        outputRegisterTimelineFilteredEntryCount: result.metrics?.outputRegisterTimelineFilteredEntryCount || 0,
        outputRegisterTimelinePsgSelectedFilteredEntryCount: result.metrics?.outputRegisterTimelinePsgSelectedFilteredEntryCount || 0,
        outputRegisterTimelineFmSelectedFilteredEntryCount: result.metrics?.outputRegisterTimelineFmSelectedFilteredEntryCount || 0,
        outputRegisterTimelinePersistedRegisterValueCount: result.metrics?.outputRegisterTimelinePersistedRegisterValueCount || 0,
        outputRegisterTimelinePersistedSampleCount: result.metrics?.outputRegisterTimelinePersistedSampleCount || 0,
        frameStepFrames: result.metrics?.frameStepFrames || 0,
        frameStepEventFrames: result.metrics?.frameStepEventFrames || 0,
        frameStepUnresolvedFrames: result.metrics?.frameStepUnresolvedFrames || 0,
        seedResolvedChannels: result.metrics?.seedResolvedChannels || 0,
        seedMissingChannels: result.metrics?.seedMissingChannels || 0,
      })),
      failures,
      browserPageErrors: pageErrors,
      browserConsoleMessages: consoleMessages.slice(0, 20),
      serverOutput: server.output,
    };

    if (apply && failures.length === 0) {
      applyReport(report);
      report.applied = true;
      report.analysisReportId = reportId;
    }

    console.log(JSON.stringify(report, null, 2));
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    console.error(summarizeFailure(error, {
      project: projectName,
      baseUrl,
      browserPageErrors: pageErrors,
      browserConsoleMessages: consoleMessages.slice(0, 20),
      serverOutput: server.output,
    }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopPhpServer(server.proc);
  }
}

runSmoke();
