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
const startPort = Number(process.env.WB3_SMOKE_PORT || 8260);
const maxPort = startPort + 30;
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const reportId = 'audio-runtime-output-channel-port-trace-link-full-sweep-browser-smoke-2026-06-26';
const toolName = 'tools/world-audio-runtime-output-fixture-timeline-browser-smoke.mjs';

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
    // Smoke result is already decided; shutdown is best effort.
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
        if (data?.ok) return;
      }
    } catch {
      // Server is still starting.
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for PHP server at ${baseUrl}`);
}

function addMetricTotals(totals, metrics) {
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === 'number') totals[key] = (totals[key] || 0) + value;
  }
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
      typeof window.zoneAudioSetRecipe === 'function' &&
      typeof window.zoneAudioRenderPreview === 'function' &&
      document.getElementById('zone-audio-preview') &&
      document.getElementById('zone-recipe-sel')
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
      document.getElementById('zone-recipe-sel')?.options.length > 0
    );

    const result = await page.evaluate(() => {
      const catalogId = 'world-audio-runtime-output-fixture-catalog-2026-06-26';
      const catalog = (window.mapData.audioCatalogs || []).find(item => item.id === catalogId) || null;
      const recipes = [
        ...(window.mapData.zoneRecipes || []),
        ...(window.mapData.inlineTransitionRecipes || []),
      ].filter(recipe => recipe?.dependencies?.audioRequest);
      const selector = document.getElementById('zone-recipe-sel');
      const preview = document.getElementById('zone-audio-preview');
      const numberDataset = (dataset, key) => Number(dataset[key] || 0);
      const requiredEventKeys = [
        'phaseFixtureId',
        'writeFixtureId',
        'frame',
        'pc',
        'chip',
        'port',
        'activeChannel',
        'inputFieldKeys',
        'branchId',
        'sourceEventKind',
        'sourceEventRole',
        'sourceTraceOperationKinds',
        'sourceTraceTargetLabels',
        'sourceRamFieldKeys',
      ];
      const forbiddenEventKeys = new Set([
        'romByte',
        'romBytes',
        'streamByte',
        'streamBytes',
        'opcode',
        'opcodes',
        'arg',
        'args',
        'argHex',
        'argsHex',
        'byteHex',
        'encodedHex',
        'registerValue',
        'registerValues',
        'registerTrace',
        'registerTraces',
        'portValue',
        'sample',
        'samples',
        'audioByte',
        'audioBytes',
      ]);
      const forbiddenKeyCount = value => {
        if (!value || typeof value !== 'object') return 0;
        let count = 0;
        for (const [key, child] of Object.entries(value)) {
          if (forbiddenEventKeys.has(key)) count++;
          if (child && typeof child === 'object') count += forbiddenKeyCount(child);
        }
        return count;
      };
      const samples = [];

      for (const recipe of recipes) {
        if (selector) selector.value = recipe.id || '';
        window.zoneAudioSetRecipe(recipe, recipe.dependencies?.audioRequest?.requestId);
        window.zoneAudioRenderPreview();
        const d = preview.dataset;
        const sink = window.zoneAudioLastRuntimeOutputEventSink || { events: [], summary: {} };
        const sinkEvents = sink.events || [];
        const sinkPhaseEvents = sinkEvents.filter(event => event.kind === 'audio_output_phase_fixture');
        const sinkWriteEvents = sinkEvents.filter(event => event.kind === 'audio_port_write_fixture');
        const accumulator = window.zoneAudioLastRuntimeOutputStateAccumulator || { frameGroups: [], summary: {} };
        const accumulatorSummary = accumulator.summary || {};
        const frameTimeline = window.zoneAudioLastRuntimeOutputFrameTimeline || { frames: [], summary: {} };
        const frameTimelineSummary = frameTimeline.summary || {};
        const registerIntent = window.zoneAudioLastRuntimeOutputRegisterIntentModel || { frames: [], summary: {} };
        const registerIntentSummary = registerIntent.summary || {};
        const channelPortIntent = window.zoneAudioLastRuntimeOutputChannelPortIntentModel || { groups: [], summary: {} };
        const channelPortIntentSummary = channelPortIntent.summary || {};
        const eventContractValidation = window.zoneAudioLastRuntimeOutputEventContractValidation || { summary: {} };
        const eventContractValidationSummary = eventContractValidation.summary || {};
        const sinkMissingRequiredEventKeyCount = sinkEvents.filter(event =>
          requiredEventKeys.some(key => !Object.prototype.hasOwnProperty.call(event, key))
        ).length;
        const sinkForbiddenPayloadKeyCount = sinkEvents.reduce((sum, event) =>
          sum + Object.keys(event).filter(key => forbiddenEventKeys.has(key)).length, 0);
        const accumulatorFrameGroups = accumulator.frameGroups || [];
        const accumulatorPhaseFixtureIds = [...new Set(accumulatorFrameGroups.flatMap(group => group.phaseFixtureIds || []))].sort();
        const accumulatorWriteFixtureIds = [...new Set(accumulatorFrameGroups.flatMap(group => group.writeFixtureIds || []))].sort();
        const accumulatorPortKinds = Object.keys(accumulatorSummary.portCounts || {}).sort();
        const accumulatorBranchKinds = Object.keys(accumulatorSummary.branchCounts || {}).sort();
        const accumulatorInputFieldKeys = Object.keys(accumulatorSummary.inputFieldKeyCounts || {}).sort();
        const accumulatorActiveChannels = Object.keys(accumulatorSummary.activeChannelCounts || {}).sort();
        const frameTimelineFrames = frameTimeline.frames || [];
        const frameTimelinePhaseFixtureIds = [...new Set(frameTimelineFrames.flatMap(frame => frame.phaseFixtureIds || []))].sort();
        const frameTimelineWriteFixtureIds = [...new Set(frameTimelineFrames.flatMap(frame => frame.writeFixtureIds || []))].sort();
        const frameTimelinePortKinds = [...new Set(frameTimelineFrames.flatMap(frame => Object.keys(frame.portCounts || {})))].sort();
        const frameTimelineBranchKinds = [...new Set(frameTimelineFrames.flatMap(frame => Object.keys(frame.branchCounts || {})))].sort();
        const frameTimelineInputFieldKeys = [...new Set(frameTimelineFrames.flatMap(frame => Object.keys(frame.inputFieldKeyCounts || {})))].sort();
        const frameTimelineActiveChannels = [...new Set(frameTimelineFrames.flatMap(frame => Object.keys(frame.activeChannelCounts || {})))].sort();
        const registerIntentFrames = registerIntent.frames || [];
        const registerIntentPhaseFixtureIds = [...new Set(registerIntentFrames.flatMap(frame => frame.phaseFixtureIds || []))].sort();
        const registerIntentWriteFixtureIds = [...new Set(registerIntentFrames.flatMap(frame => frame.writeFixtureIds || []))].sort();
        const registerIntentPortKinds = [...new Set(registerIntentFrames.flatMap(frame => Object.keys(frame.portCounts || {})))].sort();
        const registerIntentBranchKinds = [...new Set(registerIntentFrames.flatMap(frame => Object.keys(frame.branchCounts || {})))].sort();
        const registerIntentInputFieldKeys = [...new Set(registerIntentFrames.flatMap(frame => Object.keys(frame.inputFieldKeyCounts || {})))].sort();
        const registerIntentActiveChannels = [...new Set(registerIntentFrames.flatMap(frame => Object.keys(frame.activeChannelCounts || {})))].sort();
        const channelPortIntentGroups = channelPortIntent.groups || [];
        const channelPortIntentPhaseFixtureIds = [...new Set(channelPortIntentGroups.flatMap(group => group.phaseFixtureIds || []))].sort();
        const channelPortIntentWriteFixtureIds = [...new Set(channelPortIntentGroups.flatMap(group => group.writeFixtureIds || []))].sort();
        const channelPortIntentPortKinds = [...new Set(channelPortIntentGroups.map(group => group.port).filter(Boolean))].sort();
        const channelPortIntentBranchKinds = [...new Set(channelPortIntentGroups.map(group => group.branchId).filter(Boolean))].sort();
        const channelPortIntentInputFieldKeys = [...new Set(channelPortIntentGroups.flatMap(group => Object.keys(group.inputFieldKeyCounts || {})))].sort();
        const channelPortIntentActiveChannels = [...new Set(channelPortIntentGroups.map(group => group.activeChannel).filter(Boolean))].sort();
        const channelPortIntentPhaseKinds = [...new Set(channelPortIntentGroups.map(group => group.phaseKind).filter(Boolean))].sort();
        const channelPortIntentSourceEventKinds = [...new Set(channelPortIntentGroups.flatMap(group => Object.keys(group.sourceEventKindCounts || {})))].sort();
        const channelPortIntentSourceEventRoles = [...new Set(channelPortIntentGroups.flatMap(group => Object.keys(group.sourceEventRoleCounts || {})))].sort();
        const channelPortIntentSourceTraceOperationKinds = [...new Set(channelPortIntentGroups.flatMap(group => Object.keys(group.sourceTraceOperationKindCounts || {})))].sort();
        const channelPortIntentSourceTraceTargets = [...new Set(channelPortIntentGroups.flatMap(group => Object.keys(group.sourceTraceTargetCounts || {})))].sort();
        const channelPortIntentSourceRamFieldKeys = [...new Set(channelPortIntentGroups.flatMap(group => Object.keys(group.sourceRamFieldKeyCounts || {})))].sort();
        const channelPortIntentSourceUnresolvedRamFieldKeys = [...new Set(channelPortIntentGroups.flatMap(group => Object.keys(group.sourceUnresolvedRamFieldKeyCounts || {})))].sort();
        samples.push({
          recipeId: recipe.id || '',
          requestId: d.zoneAudioRequestId || '',
          textHasFixtureSummary: preview.textContent.includes('fixtures'),
          textHasFixtureId: preview.textContent.includes('fx:phase:'),
          textHasRuntimeSink: preview.textContent.includes('runtime output event sink'),
          textHasRuntimeAccumulator: preview.textContent.includes('runtime PSG/FM accumulator'),
          textHasFrameTimeline: preview.textContent.includes('runtime output frame timeline'),
          textHasRegisterIntent: preview.textContent.includes('runtime PSG/FM register intent'),
          textHasChannelPortIntent: preview.textContent.includes('runtime channel/port intent'),
          textHasEventContractValidation: preview.textContent.includes('runtime output event contract'),
          metrics: {
            previewEvents: numberDataset(d, 'zoneAudioPreviewEvents'),
            outputPhaseSchedulePhaseCount: numberDataset(d, 'zoneAudioPreviewOutputPhaseSchedulePhaseCount'),
            outputPhaseScheduleWriteCount: numberDataset(d, 'zoneAudioPreviewOutputPhaseScheduleWriteCount'),
            outputRegisterTimelineEntryCount: numberDataset(d, 'zoneAudioPreviewOutputRegisterTimelineEntryCount'),
            outputRegisterTimelineWriteCount: numberDataset(d, 'zoneAudioPreviewOutputRegisterTimelineWriteCount'),
            fixtureLinkedEntryCount: numberDataset(d, 'zoneAudioPreviewOutputRegisterTimelineFixtureLinkedEntryCount'),
            fixtureMissingEntryCount: numberDataset(d, 'zoneAudioPreviewOutputRegisterTimelineFixtureMissingEntryCount'),
            fixtureLinkedWriteCount: numberDataset(d, 'zoneAudioPreviewOutputRegisterTimelineFixtureLinkedWriteCount'),
            fixtureWriteMismatchEntryCount: numberDataset(d, 'zoneAudioPreviewOutputRegisterTimelineFixtureWriteMismatchEntryCount'),
            filteredFixtureLinkedEntryCount: numberDataset(d, 'zoneAudioPreviewOutputRegisterTimelineFilteredFixtureLinkedEntryCount'),
            filteredFixtureMissingEntryCount: numberDataset(d, 'zoneAudioPreviewOutputRegisterTimelineFilteredFixtureMissingEntryCount'),
            filteredFixtureLinkedWriteCount: numberDataset(d, 'zoneAudioPreviewOutputRegisterTimelineFilteredFixtureLinkedWriteCount'),
            persistedRegisterValueCount: numberDataset(d, 'zoneAudioPreviewOutputRegisterTimelinePersistedRegisterValueCount'),
            persistedSampleCount: numberDataset(d, 'zoneAudioPreviewOutputRegisterTimelinePersistedSampleCount'),
            runtimeOutputSinkReady: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkReady'),
            runtimeOutputSinkEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkEventCount'),
            runtimeOutputSinkPhaseEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkPhaseEventCount'),
            runtimeOutputSinkWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkWriteEventCount'),
            runtimeOutputSinkSelectedPhaseEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkSelectedPhaseEventCount'),
            runtimeOutputSinkSelectedWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkSelectedWriteEventCount'),
            runtimeOutputSinkMissingPhaseFixtureCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkMissingPhaseFixtureCount'),
            runtimeOutputSinkMissingWriteFixtureCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkMissingWriteFixtureCount'),
            runtimeOutputSinkFrameLinkedEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkFrameLinkedEventCount'),
            runtimeOutputSinkFrameUnlinkedEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkFrameUnlinkedEventCount'),
            runtimeOutputSinkPsgEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkPsgEventCount'),
            runtimeOutputSinkFmEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkFmEventCount'),
            runtimeOutputSinkMixedEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkMixedEventCount'),
            runtimeOutputSinkPersistedRegisterValueCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkPersistedRegisterValueCount'),
            runtimeOutputSinkPersistedRegisterTraceCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkPersistedRegisterTraceCount'),
            runtimeOutputSinkPersistedSampleCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkPersistedSampleCount'),
            runtimeOutputSinkPersistedAudioByteCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkPersistedAudioByteCount'),
            runtimeOutputSinkPersistedRomByteCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputSinkPersistedRomByteCount'),
            runtimeOutputSinkObjectEventCount: sinkEvents.length,
            runtimeOutputSinkObjectPhaseEventCount: sinkPhaseEvents.length,
            runtimeOutputSinkObjectWriteEventCount: sinkWriteEvents.length,
            runtimeOutputSinkMissingRequiredEventKeyCount: sinkMissingRequiredEventKeyCount,
            runtimeOutputSinkForbiddenPayloadKeyCount: sinkForbiddenPayloadKeyCount,
            runtimeOutputEventContractCatalogBacked: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractCatalogBacked'),
            runtimeOutputEventContractReady: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractReady'),
            runtimeOutputEventContractRequiredKeyCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractRequiredKeyCount'),
            runtimeOutputEventContractOptionalKeyCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractOptionalKeyCount'),
            runtimeOutputEventContractForbiddenPayloadKeyCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractForbiddenPayloadKeyCount'),
            runtimeOutputEventContractDerivedModelCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractDerivedModelCount'),
            runtimeOutputEventContractEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractEventCount'),
            runtimeOutputEventContractMissingRequiredKeyCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractMissingRequiredKeyCount'),
            runtimeOutputEventContractEventForbiddenPayloadKeyCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractEventForbiddenPayloadKeyCount'),
            runtimeOutputEventContractModelForbiddenPayloadKeyCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractModelForbiddenPayloadKeyCount'),
            runtimeOutputEventContractInvalidEventKindCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractInvalidEventKindCount'),
            runtimeOutputEventContractMissingModelCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractMissingModelCount'),
            runtimeOutputEventContractMissingModelSummaryKeyCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractMissingModelSummaryKeyCount'),
            runtimeOutputEventContractNonZeroPersistedPayloadCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractNonZeroPersistedPayloadCount'),
            runtimeOutputEventContractValidationIssueCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputEventContractValidationIssueCount'),
            runtimeOutputEventContractObjectEventCount: eventContractValidationSummary.eventCount || 0,
            runtimeOutputEventContractObjectValidationIssueCount: eventContractValidationSummary.validationIssueCount || 0,
            runtimeOutputAccumulatorReady: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorReady'),
            runtimeOutputAccumulatorEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorEventCount'),
            runtimeOutputAccumulatorPhaseEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorPhaseEventCount'),
            runtimeOutputAccumulatorWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorWriteEventCount'),
            runtimeOutputAccumulatorSelectedEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorSelectedEventCount'),
            runtimeOutputAccumulatorSelectedPhaseEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorSelectedPhaseEventCount'),
            runtimeOutputAccumulatorSelectedWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorSelectedWriteEventCount'),
            runtimeOutputAccumulatorFrameGroupCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorFrameGroupCount'),
            runtimeOutputAccumulatorFrameLinkedGroupCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorFrameLinkedGroupCount'),
            runtimeOutputAccumulatorFrameUnlinkedGroupCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorFrameUnlinkedGroupCount'),
            runtimeOutputAccumulatorUniquePhaseFixtureCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorUniquePhaseFixtureCount'),
            runtimeOutputAccumulatorUniqueWriteFixtureCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorUniqueWriteFixtureCount'),
            runtimeOutputAccumulatorPortKindCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorPortKindCount'),
            runtimeOutputAccumulatorBranchKindCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorBranchKindCount'),
            runtimeOutputAccumulatorInputFieldKeyCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorInputFieldKeyCount'),
            runtimeOutputAccumulatorActiveChannelCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorActiveChannelCount'),
            runtimeOutputAccumulatorPsgEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorPsgEventCount'),
            runtimeOutputAccumulatorFmEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorFmEventCount'),
            runtimeOutputAccumulatorMixedEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorMixedEventCount'),
            runtimeOutputAccumulatorPsgWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorPsgWriteEventCount'),
            runtimeOutputAccumulatorFmWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorFmWriteEventCount'),
            runtimeOutputAccumulatorMixedWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorMixedWriteEventCount'),
            runtimeOutputAccumulatorPersistedRegisterValueCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorPersistedRegisterValueCount'),
            runtimeOutputAccumulatorPersistedRegisterTraceCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorPersistedRegisterTraceCount'),
            runtimeOutputAccumulatorPersistedSampleCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorPersistedSampleCount'),
            runtimeOutputAccumulatorPersistedAudioByteCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorPersistedAudioByteCount'),
            runtimeOutputAccumulatorPersistedRomByteCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputAccumulatorPersistedRomByteCount'),
            runtimeOutputAccumulatorObjectEventCount: accumulatorSummary.eventCount || 0,
            runtimeOutputAccumulatorObjectPhaseEventCount: accumulatorSummary.phaseEventCount || 0,
            runtimeOutputAccumulatorObjectWriteEventCount: accumulatorSummary.writeEventCount || 0,
            runtimeOutputAccumulatorObjectFrameGroupCount: (accumulator.frameGroups || []).length,
            runtimeOutputAccumulatorForbiddenPayloadKeyCount: forbiddenKeyCount(accumulator),
            runtimeOutputFrameTimelineReady: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineReady'),
            runtimeOutputFrameTimelineFrameCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineFrameCount'),
            runtimeOutputFrameTimelineFrameLinkedCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineFrameLinkedCount'),
            runtimeOutputFrameTimelineFrameUnlinkedCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineFrameUnlinkedCount'),
            runtimeOutputFrameTimelineEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineEventCount'),
            runtimeOutputFrameTimelinePhaseEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelinePhaseEventCount'),
            runtimeOutputFrameTimelineWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineWriteEventCount'),
            runtimeOutputFrameTimelineSelectedEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineSelectedEventCount'),
            runtimeOutputFrameTimelineSelectedPhaseEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineSelectedPhaseEventCount'),
            runtimeOutputFrameTimelineSelectedWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineSelectedWriteEventCount'),
            runtimeOutputFrameTimelinePsgEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelinePsgEventCount'),
            runtimeOutputFrameTimelineFmEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineFmEventCount'),
            runtimeOutputFrameTimelineMixedEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineMixedEventCount'),
            runtimeOutputFrameTimelinePsgWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelinePsgWriteEventCount'),
            runtimeOutputFrameTimelineFmWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineFmWriteEventCount'),
            runtimeOutputFrameTimelineMixedWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineMixedWriteEventCount'),
            runtimeOutputFrameTimelineUniquePhaseFixtureCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineUniquePhaseFixtureCount'),
            runtimeOutputFrameTimelineUniqueWriteFixtureCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineUniqueWriteFixtureCount'),
            runtimeOutputFrameTimelinePortKindCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelinePortKindCount'),
            runtimeOutputFrameTimelineBranchKindCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineBranchKindCount'),
            runtimeOutputFrameTimelineInputFieldKeyCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineInputFieldKeyCount'),
            runtimeOutputFrameTimelineActiveChannelCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelineActiveChannelCount'),
            runtimeOutputFrameTimelinePersistedRegisterValueCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelinePersistedRegisterValueCount'),
            runtimeOutputFrameTimelinePersistedRegisterTraceCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelinePersistedRegisterTraceCount'),
            runtimeOutputFrameTimelinePersistedSampleCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelinePersistedSampleCount'),
            runtimeOutputFrameTimelinePersistedAudioByteCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelinePersistedAudioByteCount'),
            runtimeOutputFrameTimelinePersistedRomByteCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputFrameTimelinePersistedRomByteCount'),
            runtimeOutputFrameTimelineObjectFrameCount: frameTimelineFrames.length,
            runtimeOutputFrameTimelineObjectEventCount: frameTimelineSummary.eventCount || 0,
            runtimeOutputFrameTimelineObjectPhaseEventCount: frameTimelineSummary.phaseEventCount || 0,
            runtimeOutputFrameTimelineObjectWriteEventCount: frameTimelineSummary.writeEventCount || 0,
            runtimeOutputFrameTimelineForbiddenPayloadKeyCount: forbiddenKeyCount(frameTimeline),
            runtimeOutputRegisterIntentReady: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentReady'),
            runtimeOutputRegisterIntentFrameCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentFrameCount'),
            runtimeOutputRegisterIntentPsgOnlyFrameCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentPsgOnlyFrameCount'),
            runtimeOutputRegisterIntentFmOnlyFrameCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentFmOnlyFrameCount'),
            runtimeOutputRegisterIntentMixedFrameCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentMixedFrameCount'),
            runtimeOutputRegisterIntentNoWriteFrameCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentNoWriteFrameCount'),
            runtimeOutputRegisterIntentEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentEventCount'),
            runtimeOutputRegisterIntentPhaseEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentPhaseEventCount'),
            runtimeOutputRegisterIntentWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentWriteEventCount'),
            runtimeOutputRegisterIntentSelectedEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentSelectedEventCount'),
            runtimeOutputRegisterIntentSelectedPhaseEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentSelectedPhaseEventCount'),
            runtimeOutputRegisterIntentSelectedWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentSelectedWriteEventCount'),
            runtimeOutputRegisterIntentPsgEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentPsgEventCount'),
            runtimeOutputRegisterIntentFmEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentFmEventCount'),
            runtimeOutputRegisterIntentMixedEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentMixedEventCount'),
            runtimeOutputRegisterIntentPsgWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentPsgWriteEventCount'),
            runtimeOutputRegisterIntentFmWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentFmWriteEventCount'),
            runtimeOutputRegisterIntentMixedWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentMixedWriteEventCount'),
            runtimeOutputRegisterIntentUniquePhaseFixtureCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentUniquePhaseFixtureCount'),
            runtimeOutputRegisterIntentUniqueWriteFixtureCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentUniqueWriteFixtureCount'),
            runtimeOutputRegisterIntentPortKindCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentPortKindCount'),
            runtimeOutputRegisterIntentBranchKindCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentBranchKindCount'),
            runtimeOutputRegisterIntentInputFieldKeyCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentInputFieldKeyCount'),
            runtimeOutputRegisterIntentActiveChannelCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentActiveChannelCount'),
            runtimeOutputRegisterIntentPersistedRegisterValueCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentPersistedRegisterValueCount'),
            runtimeOutputRegisterIntentPersistedRegisterTraceCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentPersistedRegisterTraceCount'),
            runtimeOutputRegisterIntentPersistedSampleCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentPersistedSampleCount'),
            runtimeOutputRegisterIntentPersistedAudioByteCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentPersistedAudioByteCount'),
            runtimeOutputRegisterIntentPersistedRomByteCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputRegisterIntentPersistedRomByteCount'),
            runtimeOutputRegisterIntentObjectFrameCount: registerIntentFrames.length,
            runtimeOutputRegisterIntentObjectEventCount: registerIntentSummary.eventCount || 0,
            runtimeOutputRegisterIntentObjectPhaseEventCount: registerIntentSummary.phaseEventCount || 0,
            runtimeOutputRegisterIntentObjectWriteEventCount: registerIntentSummary.writeEventCount || 0,
            runtimeOutputRegisterIntentForbiddenPayloadKeyCount: forbiddenKeyCount(registerIntent),
            runtimeOutputChannelPortIntentReady: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentReady'),
            runtimeOutputChannelPortIntentGroupCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentGroupCount'),
            runtimeOutputChannelPortIntentFrameCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentFrameCount'),
            runtimeOutputChannelPortIntentFrameLinkedGroupCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentFrameLinkedGroupCount'),
            runtimeOutputChannelPortIntentFrameUnlinkedGroupCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentFrameUnlinkedGroupCount'),
            runtimeOutputChannelPortIntentWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentWriteEventCount'),
            runtimeOutputChannelPortIntentSelectedWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentSelectedWriteEventCount'),
            runtimeOutputChannelPortIntentPsgWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentPsgWriteEventCount'),
            runtimeOutputChannelPortIntentFmWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentFmWriteEventCount'),
            runtimeOutputChannelPortIntentFmAddressWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentFmAddressWriteEventCount'),
            runtimeOutputChannelPortIntentFmDataWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentFmDataWriteEventCount'),
            runtimeOutputChannelPortIntentMixedWriteEventCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentMixedWriteEventCount'),
            runtimeOutputChannelPortIntentUniquePhaseFixtureCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentUniquePhaseFixtureCount'),
            runtimeOutputChannelPortIntentUniqueWriteFixtureCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentUniqueWriteFixtureCount'),
            runtimeOutputChannelPortIntentPortKindCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentPortKindCount'),
            runtimeOutputChannelPortIntentBranchKindCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentBranchKindCount'),
            runtimeOutputChannelPortIntentInputFieldKeyCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentInputFieldKeyCount'),
            runtimeOutputChannelPortIntentActiveChannelCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentActiveChannelCount'),
            runtimeOutputChannelPortIntentPhaseKindCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentPhaseKindCount'),
            runtimeOutputChannelPortIntentSourceEventKindCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentSourceEventKindCount'),
            runtimeOutputChannelPortIntentSourceEventRoleCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentSourceEventRoleCount'),
            runtimeOutputChannelPortIntentSourceTraceOperationKindCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentSourceTraceOperationKindCount'),
            runtimeOutputChannelPortIntentSourceTraceTargetCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentSourceTraceTargetCount'),
            runtimeOutputChannelPortIntentSourceRamFieldKeyCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentSourceRamFieldKeyCount'),
            runtimeOutputChannelPortIntentSourceUnresolvedRamFieldKeyCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentSourceUnresolvedRamFieldKeyCount'),
            runtimeOutputChannelPortIntentSourceTraceLinkedWriteCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentSourceTraceLinkedWriteCount'),
            runtimeOutputChannelPortIntentSourceRamLinkedWriteCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentSourceRamLinkedWriteCount'),
            runtimeOutputChannelPortIntentSourceUnresolvedRamLinkedWriteCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentSourceUnresolvedRamLinkedWriteCount'),
            runtimeOutputChannelPortIntentPersistedRegisterValueCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentPersistedRegisterValueCount'),
            runtimeOutputChannelPortIntentPersistedRegisterTraceCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentPersistedRegisterTraceCount'),
            runtimeOutputChannelPortIntentPersistedSampleCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentPersistedSampleCount'),
            runtimeOutputChannelPortIntentPersistedAudioByteCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentPersistedAudioByteCount'),
            runtimeOutputChannelPortIntentPersistedRomByteCount: numberDataset(d, 'zoneAudioPreviewRuntimeOutputChannelPortIntentPersistedRomByteCount'),
            runtimeOutputChannelPortIntentObjectGroupCount: channelPortIntentGroups.length,
            runtimeOutputChannelPortIntentObjectWriteEventCount: channelPortIntentSummary.writeEventCount || 0,
            runtimeOutputChannelPortIntentObjectSourceEventKindCount: channelPortIntentSummary.sourceEventKindCount || 0,
            runtimeOutputChannelPortIntentObjectSourceEventRoleCount: channelPortIntentSummary.sourceEventRoleCount || 0,
            runtimeOutputChannelPortIntentObjectSourceTraceOperationKindCount: channelPortIntentSummary.sourceTraceOperationKindCount || 0,
            runtimeOutputChannelPortIntentObjectSourceRamFieldKeyCount: channelPortIntentSummary.sourceRamFieldKeyCount || 0,
            runtimeOutputChannelPortIntentForbiddenPayloadKeyCount: forbiddenKeyCount(channelPortIntent),
          },
          fixtureCatalogBacked: d.zoneAudioPreviewOutputRegisterTimelineFixtureCatalogBacked || '',
          fixtureCatalogId: d.zoneAudioPreviewOutputRegisterTimelineFixtureCatalogId || '',
          assetPolicy: d.zoneAudioPreviewOutputRegisterTimelineAssetPolicy || '',
          runtimeOutputSinkAssetPolicy: d.zoneAudioPreviewRuntimeOutputSinkAssetPolicy || '',
          runtimeOutputAccumulatorAssetPolicy: d.zoneAudioPreviewRuntimeOutputAccumulatorAssetPolicy || '',
          runtimeOutputFrameTimelineAssetPolicy: d.zoneAudioPreviewRuntimeOutputFrameTimelineAssetPolicy || '',
          runtimeOutputRegisterIntentAssetPolicy: d.zoneAudioPreviewRuntimeOutputRegisterIntentAssetPolicy || '',
          runtimeOutputChannelPortIntentAssetPolicy: d.zoneAudioPreviewRuntimeOutputChannelPortIntentAssetPolicy || '',
          runtimeOutputEventContractAssetPolicy: d.zoneAudioPreviewRuntimeOutputEventContractAssetPolicy || '',
          accumulatorPhaseFixtureIds,
          accumulatorWriteFixtureIds,
          accumulatorPortKinds,
          accumulatorBranchKinds,
          accumulatorInputFieldKeys,
          accumulatorActiveChannels,
          frameTimelinePhaseFixtureIds,
          frameTimelineWriteFixtureIds,
          frameTimelinePortKinds,
          frameTimelineBranchKinds,
          frameTimelineInputFieldKeys,
          frameTimelineActiveChannels,
          registerIntentPhaseFixtureIds,
          registerIntentWriteFixtureIds,
          registerIntentPortKinds,
          registerIntentBranchKinds,
          registerIntentInputFieldKeys,
          registerIntentActiveChannels,
          channelPortIntentPhaseFixtureIds,
          channelPortIntentWriteFixtureIds,
          channelPortIntentPortKinds,
          channelPortIntentBranchKinds,
          channelPortIntentInputFieldKeys,
          channelPortIntentActiveChannels,
          channelPortIntentPhaseKinds,
          channelPortIntentSourceEventKinds,
          channelPortIntentSourceEventRoles,
          channelPortIntentSourceTraceOperationKinds,
          channelPortIntentSourceTraceTargets,
          channelPortIntentSourceRamFieldKeys,
          channelPortIntentSourceUnresolvedRamFieldKeys,
        });
      }

      return {
        catalogBacked: Boolean(catalog),
        catalogId: catalog?.id || '',
        catalogPhaseCount: catalog?.summary?.outputPhaseFixtureCount || 0,
        catalogWriteCount: catalog?.summary?.portWriteFixtureCount || 0,
        sweepMode: 'full_audio_backed_zone_and_inline_recipes',
        fullSweepRecipeCount: samples.length,
        sampledRecipeCount: samples.length,
        samples,
      };
    });

    const totals = {};
    const accumulatorUnique = {
      phaseFixtureIds: new Set(),
      writeFixtureIds: new Set(),
      portKinds: new Set(),
      branchKinds: new Set(),
      inputFieldKeys: new Set(),
      activeChannels: new Set(),
    };
    const frameTimelineUnique = {
      phaseFixtureIds: new Set(),
      writeFixtureIds: new Set(),
      portKinds: new Set(),
      branchKinds: new Set(),
      inputFieldKeys: new Set(),
      activeChannels: new Set(),
    };
    const registerIntentUnique = {
      phaseFixtureIds: new Set(),
      writeFixtureIds: new Set(),
      portKinds: new Set(),
      branchKinds: new Set(),
      inputFieldKeys: new Set(),
      activeChannels: new Set(),
    };
    const channelPortIntentUnique = {
      phaseFixtureIds: new Set(),
      writeFixtureIds: new Set(),
      portKinds: new Set(),
      branchKinds: new Set(),
      inputFieldKeys: new Set(),
      activeChannels: new Set(),
      phaseKinds: new Set(),
      sourceEventKinds: new Set(),
      sourceEventRoles: new Set(),
      sourceTraceOperationKinds: new Set(),
      sourceTraceTargets: new Set(),
      sourceRamFieldKeys: new Set(),
      sourceUnresolvedRamFieldKeys: new Set(),
    };
    const failures = [];
    const noOutputSamples = [];
    for (const sample of result.samples) {
      addMetricTotals(totals, sample.metrics);
      for (const id of sample.accumulatorPhaseFixtureIds || []) accumulatorUnique.phaseFixtureIds.add(id);
      for (const id of sample.accumulatorWriteFixtureIds || []) accumulatorUnique.writeFixtureIds.add(id);
      for (const port of sample.accumulatorPortKinds || []) accumulatorUnique.portKinds.add(port);
      for (const branch of sample.accumulatorBranchKinds || []) accumulatorUnique.branchKinds.add(branch);
      for (const key of sample.accumulatorInputFieldKeys || []) accumulatorUnique.inputFieldKeys.add(key);
      for (const channel of sample.accumulatorActiveChannels || []) accumulatorUnique.activeChannels.add(channel);
      for (const id of sample.frameTimelinePhaseFixtureIds || []) frameTimelineUnique.phaseFixtureIds.add(id);
      for (const id of sample.frameTimelineWriteFixtureIds || []) frameTimelineUnique.writeFixtureIds.add(id);
      for (const port of sample.frameTimelinePortKinds || []) frameTimelineUnique.portKinds.add(port);
      for (const branch of sample.frameTimelineBranchKinds || []) frameTimelineUnique.branchKinds.add(branch);
      for (const key of sample.frameTimelineInputFieldKeys || []) frameTimelineUnique.inputFieldKeys.add(key);
      for (const channel of sample.frameTimelineActiveChannels || []) frameTimelineUnique.activeChannels.add(channel);
      for (const id of sample.registerIntentPhaseFixtureIds || []) registerIntentUnique.phaseFixtureIds.add(id);
      for (const id of sample.registerIntentWriteFixtureIds || []) registerIntentUnique.writeFixtureIds.add(id);
      for (const port of sample.registerIntentPortKinds || []) registerIntentUnique.portKinds.add(port);
      for (const branch of sample.registerIntentBranchKinds || []) registerIntentUnique.branchKinds.add(branch);
      for (const key of sample.registerIntentInputFieldKeys || []) registerIntentUnique.inputFieldKeys.add(key);
      for (const channel of sample.registerIntentActiveChannels || []) registerIntentUnique.activeChannels.add(channel);
      for (const id of sample.channelPortIntentPhaseFixtureIds || []) channelPortIntentUnique.phaseFixtureIds.add(id);
      for (const id of sample.channelPortIntentWriteFixtureIds || []) channelPortIntentUnique.writeFixtureIds.add(id);
      for (const port of sample.channelPortIntentPortKinds || []) channelPortIntentUnique.portKinds.add(port);
      for (const branch of sample.channelPortIntentBranchKinds || []) channelPortIntentUnique.branchKinds.add(branch);
      for (const key of sample.channelPortIntentInputFieldKeys || []) channelPortIntentUnique.inputFieldKeys.add(key);
      for (const channel of sample.channelPortIntentActiveChannels || []) channelPortIntentUnique.activeChannels.add(channel);
      for (const phaseKind of sample.channelPortIntentPhaseKinds || []) channelPortIntentUnique.phaseKinds.add(phaseKind);
      for (const kind of sample.channelPortIntentSourceEventKinds || []) channelPortIntentUnique.sourceEventKinds.add(kind);
      for (const role of sample.channelPortIntentSourceEventRoles || []) channelPortIntentUnique.sourceEventRoles.add(role);
      for (const kind of sample.channelPortIntentSourceTraceOperationKinds || []) channelPortIntentUnique.sourceTraceOperationKinds.add(kind);
      for (const target of sample.channelPortIntentSourceTraceTargets || []) channelPortIntentUnique.sourceTraceTargets.add(target);
      for (const key of sample.channelPortIntentSourceRamFieldKeys || []) channelPortIntentUnique.sourceRamFieldKeys.add(key);
      for (const key of sample.channelPortIntentSourceUnresolvedRamFieldKeys || []) channelPortIntentUnique.sourceUnresolvedRamFieldKeys.add(key);
      if (sample.fixtureCatalogBacked !== '1') failures.push(`${sample.recipeId}: fixture catalog was not reported as backed`);
      if (sample.fixtureCatalogId !== result.catalogId) failures.push(`${sample.recipeId}: fixture catalog id mismatch`);
      if (sample.assetPolicy !== 'metadata_only_no_register_values_or_samples') failures.push(`${sample.recipeId}: unexpected asset policy`);
      if (sample.metrics.persistedRegisterValueCount !== 0) failures.push(`${sample.recipeId}: persisted register values reported`);
      if (sample.metrics.persistedSampleCount !== 0) failures.push(`${sample.recipeId}: persisted samples reported`);
      if (sample.metrics.runtimeOutputSinkPersistedRegisterValueCount !== 0) failures.push(`${sample.recipeId}: runtime sink persisted register values reported`);
      if (sample.metrics.runtimeOutputSinkPersistedRegisterTraceCount !== 0) failures.push(`${sample.recipeId}: runtime sink persisted register traces reported`);
      if (sample.metrics.runtimeOutputSinkPersistedSampleCount !== 0) failures.push(`${sample.recipeId}: runtime sink persisted samples reported`);
      if (sample.metrics.runtimeOutputSinkPersistedAudioByteCount !== 0) failures.push(`${sample.recipeId}: runtime sink persisted audio bytes reported`);
      if (sample.metrics.runtimeOutputSinkPersistedRomByteCount !== 0) failures.push(`${sample.recipeId}: runtime sink persisted ROM bytes reported`);
      if (sample.metrics.fixtureWriteMismatchEntryCount !== 0) failures.push(`${sample.recipeId}: fixture/write mismatch reported`);
      const hasRuntimeOutput = sample.metrics.outputRegisterTimelineEntryCount > 0 ||
        sample.metrics.outputRegisterTimelineWriteCount > 0 ||
        sample.metrics.runtimeOutputSinkEventCount > 0;
      if (sample.runtimeOutputSinkAssetPolicy !== 'metadata_only_runtime_event_ids_no_register_values_or_samples') {
        failures.push(`${sample.recipeId}: unexpected runtime sink asset policy`);
      }
      if (sample.runtimeOutputAccumulatorAssetPolicy !== 'metadata_only_psg_fm_accumulator_no_values_or_samples') {
        failures.push(`${sample.recipeId}: unexpected runtime accumulator asset policy`);
      }
      if (sample.runtimeOutputFrameTimelineAssetPolicy !== 'metadata_only_output_frame_timeline_no_values_or_samples') {
        failures.push(`${sample.recipeId}: unexpected runtime frame timeline asset policy`);
      }
      if (sample.runtimeOutputRegisterIntentAssetPolicy !== 'metadata_only_register_intent_no_values_or_samples') {
        failures.push(`${sample.recipeId}: unexpected runtime register intent asset policy`);
      }
      if (sample.runtimeOutputChannelPortIntentAssetPolicy !== 'metadata_only_channel_port_intent_no_values_or_samples') {
        failures.push(`${sample.recipeId}: unexpected runtime channel/port intent asset policy`);
      }
      if (sample.runtimeOutputEventContractAssetPolicy !== 'metadata_only_audio_runtime_output_event_contract_validation') {
        failures.push(`${sample.recipeId}: unexpected runtime event contract asset policy`);
      }
      if (!hasRuntimeOutput) {
        noOutputSamples.push(sample);
        if (sample.metrics.runtimeOutputEventContractCatalogBacked !== 1) failures.push(`${sample.recipeId}: no-output recipe event contract catalog was not backed`);
        if (sample.metrics.runtimeOutputEventContractReady !== 1) failures.push(`${sample.recipeId}: no-output recipe event contract was not ready`);
        if (sample.metrics.runtimeOutputEventContractRequiredKeyCount !== 25) failures.push(`${sample.recipeId}: no-output recipe event contract required key count changed`);
        if (sample.metrics.runtimeOutputEventContractOptionalKeyCount !== 4) failures.push(`${sample.recipeId}: no-output recipe event contract optional key count changed`);
        if (sample.metrics.runtimeOutputEventContractForbiddenPayloadKeyCount !== 21) failures.push(`${sample.recipeId}: no-output recipe event contract forbidden key count changed`);
        if (sample.metrics.runtimeOutputEventContractDerivedModelCount !== 5) failures.push(`${sample.recipeId}: no-output recipe event contract derived model count changed`);
        if (!sample.textHasEventContractValidation) failures.push(`${sample.recipeId}: no-output recipe did not render event contract validation summary`);
        if (sample.metrics.outputRegisterTimelineEntryCount !== 0) failures.push(`${sample.recipeId}: no-output recipe had timeline entries`);
        if (sample.metrics.outputRegisterTimelineWriteCount !== 0) failures.push(`${sample.recipeId}: no-output recipe had timeline writes`);
        if (sample.metrics.runtimeOutputSinkEventCount !== 0) failures.push(`${sample.recipeId}: no-output recipe had runtime sink events`);
        if (sample.metrics.runtimeOutputSinkForbiddenPayloadKeyCount !== 0) failures.push(`${sample.recipeId}: no-output recipe stored forbidden sink payload keys`);
        if (sample.metrics.runtimeOutputAccumulatorForbiddenPayloadKeyCount !== 0) failures.push(`${sample.recipeId}: no-output recipe stored forbidden accumulator payload keys`);
        if (sample.metrics.runtimeOutputFrameTimelineForbiddenPayloadKeyCount !== 0) failures.push(`${sample.recipeId}: no-output recipe stored forbidden frame timeline payload keys`);
        if (sample.metrics.runtimeOutputRegisterIntentForbiddenPayloadKeyCount !== 0) failures.push(`${sample.recipeId}: no-output recipe stored forbidden register intent payload keys`);
        if (sample.metrics.runtimeOutputChannelPortIntentForbiddenPayloadKeyCount !== 0) failures.push(`${sample.recipeId}: no-output recipe stored forbidden channel/port payload keys`);
        if (sample.metrics.runtimeOutputEventContractValidationIssueCount !== 0) failures.push(`${sample.recipeId}: no-output recipe failed event contract validation`);
        if (sample.metrics.runtimeOutputAccumulatorPersistedRegisterValueCount !== 0) failures.push(`${sample.recipeId}: no-output recipe persisted accumulator register values`);
        if (sample.metrics.runtimeOutputFrameTimelinePersistedRegisterValueCount !== 0) failures.push(`${sample.recipeId}: no-output recipe persisted frame timeline register values`);
        if (sample.metrics.runtimeOutputRegisterIntentPersistedRegisterValueCount !== 0) failures.push(`${sample.recipeId}: no-output recipe persisted register intent values`);
        if (sample.metrics.runtimeOutputChannelPortIntentPersistedRegisterValueCount !== 0) failures.push(`${sample.recipeId}: no-output recipe persisted channel/port values`);
        if (sample.metrics.runtimeOutputSinkPersistedRomByteCount !== 0 ||
          sample.metrics.runtimeOutputAccumulatorPersistedRomByteCount !== 0 ||
          sample.metrics.runtimeOutputFrameTimelinePersistedRomByteCount !== 0 ||
          sample.metrics.runtimeOutputRegisterIntentPersistedRomByteCount !== 0 ||
          sample.metrics.runtimeOutputChannelPortIntentPersistedRomByteCount !== 0) {
          failures.push(`${sample.recipeId}: no-output recipe persisted ROM bytes`);
        }
        continue;
      }
      if (sample.metrics.runtimeOutputSinkReady !== 1) failures.push(`${sample.recipeId}: runtime output event sink was not ready`);
      if (sample.metrics.runtimeOutputAccumulatorReady !== 1) failures.push(`${sample.recipeId}: runtime output accumulator was not ready`);
      if (sample.metrics.runtimeOutputFrameTimelineReady !== 1) failures.push(`${sample.recipeId}: runtime output frame timeline was not ready`);
      if (sample.metrics.runtimeOutputRegisterIntentReady !== 1) failures.push(`${sample.recipeId}: runtime output register intent was not ready`);
      if (sample.metrics.runtimeOutputChannelPortIntentReady !== 1) failures.push(`${sample.recipeId}: runtime output channel/port intent was not ready`);
      if (sample.metrics.runtimeOutputEventContractCatalogBacked !== 1) failures.push(`${sample.recipeId}: runtime output event contract catalog was not backed`);
      if (sample.metrics.runtimeOutputEventContractReady !== 1) failures.push(`${sample.recipeId}: runtime output event contract was not ready`);
      if (sample.metrics.runtimeOutputEventContractRequiredKeyCount !== 25) failures.push(`${sample.recipeId}: runtime output event contract required key count changed`);
      if (sample.metrics.runtimeOutputEventContractOptionalKeyCount !== 4) failures.push(`${sample.recipeId}: runtime output event contract optional key count changed`);
      if (sample.metrics.runtimeOutputEventContractForbiddenPayloadKeyCount !== 21) failures.push(`${sample.recipeId}: runtime output event contract forbidden key count changed`);
      if (sample.metrics.runtimeOutputEventContractDerivedModelCount !== 5) failures.push(`${sample.recipeId}: runtime output event contract derived model count changed`);
      if (sample.metrics.runtimeOutputEventContractEventCount !== sample.metrics.runtimeOutputSinkEventCount) failures.push(`${sample.recipeId}: runtime output event contract event count does not match sink`);
      if (sample.metrics.runtimeOutputEventContractObjectEventCount !== sample.metrics.runtimeOutputSinkEventCount) failures.push(`${sample.recipeId}: runtime output event contract object event count does not match sink`);
      if (sample.metrics.runtimeOutputEventContractMissingRequiredKeyCount !== 0) failures.push(`${sample.recipeId}: runtime output event contract missing required keys`);
      if (sample.metrics.runtimeOutputEventContractEventForbiddenPayloadKeyCount !== 0) failures.push(`${sample.recipeId}: runtime output event contract saw forbidden event payload keys`);
      if (sample.metrics.runtimeOutputEventContractModelForbiddenPayloadKeyCount !== 0) failures.push(`${sample.recipeId}: runtime output event contract saw forbidden model payload keys`);
      if (sample.metrics.runtimeOutputEventContractInvalidEventKindCount !== 0) failures.push(`${sample.recipeId}: runtime output event contract saw invalid event kinds`);
      if (sample.metrics.runtimeOutputEventContractMissingModelCount !== 0) failures.push(`${sample.recipeId}: runtime output event contract missing derived models`);
      if (sample.metrics.runtimeOutputEventContractMissingModelSummaryKeyCount !== 0) failures.push(`${sample.recipeId}: runtime output event contract missing model summary keys`);
      if (sample.metrics.runtimeOutputEventContractNonZeroPersistedPayloadCount !== 0) failures.push(`${sample.recipeId}: runtime output event contract found persisted payload counts`);
      if (sample.metrics.runtimeOutputEventContractValidationIssueCount !== 0) failures.push(`${sample.recipeId}: runtime output event contract validation issues`);
      if (sample.metrics.runtimeOutputEventContractObjectValidationIssueCount !== 0) failures.push(`${sample.recipeId}: runtime output event contract object validation issues`);
      if (!sample.textHasEventContractValidation) failures.push(`${sample.recipeId}: preview did not render event contract validation summary`);
      if (sample.metrics.runtimeOutputSinkEventCount !== sample.metrics.runtimeOutputSinkObjectEventCount) {
        failures.push(`${sample.recipeId}: runtime sink dataset/object event count mismatch`);
      }
      if (sample.metrics.runtimeOutputSinkPhaseEventCount !== sample.metrics.runtimeOutputSinkObjectPhaseEventCount) {
        failures.push(`${sample.recipeId}: runtime sink dataset/object phase count mismatch`);
      }
      if (sample.metrics.runtimeOutputSinkWriteEventCount !== sample.metrics.runtimeOutputSinkObjectWriteEventCount) {
        failures.push(`${sample.recipeId}: runtime sink dataset/object write count mismatch`);
      }
      if (sample.metrics.runtimeOutputSinkPhaseEventCount !== sample.metrics.outputRegisterTimelineEntryCount) {
        failures.push(`${sample.recipeId}: runtime sink phase events do not match timeline entries`);
      }
      if (sample.metrics.runtimeOutputSinkWriteEventCount !== sample.metrics.outputRegisterTimelineWriteCount) {
        failures.push(`${sample.recipeId}: runtime sink write events do not match timeline writes`);
      }
      if (sample.metrics.runtimeOutputAccumulatorEventCount !== sample.metrics.runtimeOutputSinkEventCount) {
        failures.push(`${sample.recipeId}: accumulator event count does not match sink event count`);
      }
      if (sample.metrics.runtimeOutputAccumulatorPhaseEventCount !== sample.metrics.runtimeOutputSinkPhaseEventCount) {
        failures.push(`${sample.recipeId}: accumulator phase count does not match sink phase count`);
      }
      if (sample.metrics.runtimeOutputAccumulatorWriteEventCount !== sample.metrics.runtimeOutputSinkWriteEventCount) {
        failures.push(`${sample.recipeId}: accumulator write count does not match sink write count`);
      }
      if (sample.metrics.runtimeOutputAccumulatorEventCount !== sample.metrics.runtimeOutputAccumulatorObjectEventCount) {
        failures.push(`${sample.recipeId}: accumulator dataset/object event count mismatch`);
      }
      if (sample.metrics.runtimeOutputAccumulatorPhaseEventCount !== sample.metrics.runtimeOutputAccumulatorObjectPhaseEventCount) {
        failures.push(`${sample.recipeId}: accumulator dataset/object phase count mismatch`);
      }
      if (sample.metrics.runtimeOutputAccumulatorWriteEventCount !== sample.metrics.runtimeOutputAccumulatorObjectWriteEventCount) {
        failures.push(`${sample.recipeId}: accumulator dataset/object write count mismatch`);
      }
      if (sample.metrics.runtimeOutputAccumulatorFrameGroupCount !== sample.metrics.runtimeOutputAccumulatorObjectFrameGroupCount) {
        failures.push(`${sample.recipeId}: accumulator dataset/object frame group count mismatch`);
      }
      if (sample.metrics.runtimeOutputFrameTimelineFrameCount !== sample.metrics.runtimeOutputFrameTimelineObjectFrameCount) {
        failures.push(`${sample.recipeId}: frame timeline dataset/object frame count mismatch`);
      }
      if (sample.metrics.runtimeOutputFrameTimelineEventCount !== sample.metrics.runtimeOutputFrameTimelineObjectEventCount) {
        failures.push(`${sample.recipeId}: frame timeline dataset/object event count mismatch`);
      }
      if (sample.metrics.runtimeOutputFrameTimelinePhaseEventCount !== sample.metrics.runtimeOutputFrameTimelineObjectPhaseEventCount) {
        failures.push(`${sample.recipeId}: frame timeline dataset/object phase count mismatch`);
      }
      if (sample.metrics.runtimeOutputFrameTimelineWriteEventCount !== sample.metrics.runtimeOutputFrameTimelineObjectWriteEventCount) {
        failures.push(`${sample.recipeId}: frame timeline dataset/object write count mismatch`);
      }
      if (sample.metrics.runtimeOutputRegisterIntentFrameCount !== sample.metrics.runtimeOutputRegisterIntentObjectFrameCount) {
        failures.push(`${sample.recipeId}: register intent dataset/object frame count mismatch`);
      }
      if (sample.metrics.runtimeOutputRegisterIntentEventCount !== sample.metrics.runtimeOutputRegisterIntentObjectEventCount) {
        failures.push(`${sample.recipeId}: register intent dataset/object event count mismatch`);
      }
      if (sample.metrics.runtimeOutputRegisterIntentPhaseEventCount !== sample.metrics.runtimeOutputRegisterIntentObjectPhaseEventCount) {
        failures.push(`${sample.recipeId}: register intent dataset/object phase count mismatch`);
      }
      if (sample.metrics.runtimeOutputRegisterIntentWriteEventCount !== sample.metrics.runtimeOutputRegisterIntentObjectWriteEventCount) {
        failures.push(`${sample.recipeId}: register intent dataset/object write count mismatch`);
      }
      if (sample.metrics.runtimeOutputChannelPortIntentGroupCount !== sample.metrics.runtimeOutputChannelPortIntentObjectGroupCount) {
        failures.push(`${sample.recipeId}: channel/port intent dataset/object group count mismatch`);
      }
      if (sample.metrics.runtimeOutputChannelPortIntentWriteEventCount !== sample.metrics.runtimeOutputChannelPortIntentObjectWriteEventCount) {
        failures.push(`${sample.recipeId}: channel/port intent dataset/object write count mismatch`);
      }
      if (sample.metrics.runtimeOutputChannelPortIntentSourceEventKindCount !== sample.metrics.runtimeOutputChannelPortIntentObjectSourceEventKindCount) {
        failures.push(`${sample.recipeId}: channel/port intent dataset/object source event kind count mismatch`);
      }
      if (sample.metrics.runtimeOutputChannelPortIntentSourceEventRoleCount !== sample.metrics.runtimeOutputChannelPortIntentObjectSourceEventRoleCount) {
        failures.push(`${sample.recipeId}: channel/port intent dataset/object source event role count mismatch`);
      }
      if (sample.metrics.runtimeOutputChannelPortIntentSourceTraceOperationKindCount !== sample.metrics.runtimeOutputChannelPortIntentObjectSourceTraceOperationKindCount) {
        failures.push(`${sample.recipeId}: channel/port intent dataset/object source trace operation count mismatch`);
      }
      if (sample.metrics.runtimeOutputChannelPortIntentSourceRamFieldKeyCount !== sample.metrics.runtimeOutputChannelPortIntentObjectSourceRamFieldKeyCount) {
        failures.push(`${sample.recipeId}: channel/port intent dataset/object source RAM field count mismatch`);
      }
      if (sample.metrics.runtimeOutputFrameTimelineFrameCount !== sample.metrics.runtimeOutputAccumulatorFrameGroupCount) {
        failures.push(`${sample.recipeId}: frame timeline count does not match accumulator frame groups`);
      }
      if (sample.metrics.runtimeOutputFrameTimelineEventCount !== sample.metrics.runtimeOutputAccumulatorEventCount) {
        failures.push(`${sample.recipeId}: frame timeline event count does not match accumulator events`);
      }
      if (sample.metrics.runtimeOutputFrameTimelinePhaseEventCount !== sample.metrics.runtimeOutputAccumulatorPhaseEventCount) {
        failures.push(`${sample.recipeId}: frame timeline phase count does not match accumulator phases`);
      }
      if (sample.metrics.runtimeOutputFrameTimelineWriteEventCount !== sample.metrics.runtimeOutputAccumulatorWriteEventCount) {
        failures.push(`${sample.recipeId}: frame timeline write count does not match accumulator writes`);
      }
      if (sample.metrics.runtimeOutputFrameTimelinePsgWriteEventCount !== sample.metrics.runtimeOutputAccumulatorPsgWriteEventCount) {
        failures.push(`${sample.recipeId}: frame timeline PSG write count does not match accumulator`);
      }
      if (sample.metrics.runtimeOutputFrameTimelineFmWriteEventCount !== sample.metrics.runtimeOutputAccumulatorFmWriteEventCount) {
        failures.push(`${sample.recipeId}: frame timeline FM write count does not match accumulator`);
      }
      if (sample.metrics.runtimeOutputRegisterIntentFrameCount !== sample.metrics.runtimeOutputFrameTimelineFrameCount) {
        failures.push(`${sample.recipeId}: register intent frame count does not match frame timeline`);
      }
      if (sample.metrics.runtimeOutputRegisterIntentEventCount !== sample.metrics.runtimeOutputFrameTimelineEventCount) {
        failures.push(`${sample.recipeId}: register intent event count does not match frame timeline`);
      }
      if (sample.metrics.runtimeOutputRegisterIntentPhaseEventCount !== sample.metrics.runtimeOutputFrameTimelinePhaseEventCount) {
        failures.push(`${sample.recipeId}: register intent phase count does not match frame timeline`);
      }
      if (sample.metrics.runtimeOutputRegisterIntentWriteEventCount !== sample.metrics.runtimeOutputFrameTimelineWriteEventCount) {
        failures.push(`${sample.recipeId}: register intent write count does not match frame timeline`);
      }
      if (sample.metrics.runtimeOutputRegisterIntentPsgWriteEventCount !== sample.metrics.runtimeOutputFrameTimelinePsgWriteEventCount) {
        failures.push(`${sample.recipeId}: register intent PSG write count does not match frame timeline`);
      }
      if (sample.metrics.runtimeOutputRegisterIntentFmWriteEventCount !== sample.metrics.runtimeOutputFrameTimelineFmWriteEventCount) {
        failures.push(`${sample.recipeId}: register intent FM write count does not match frame timeline`);
      }
      if (sample.metrics.runtimeOutputRegisterIntentMixedWriteEventCount !== sample.metrics.runtimeOutputFrameTimelineMixedWriteEventCount) {
        failures.push(`${sample.recipeId}: register intent mixed write count does not match frame timeline`);
      }
      if (sample.metrics.runtimeOutputChannelPortIntentFrameCount !== sample.metrics.runtimeOutputFrameTimelineFrameCount) {
        failures.push(`${sample.recipeId}: channel/port intent frame count does not match frame timeline`);
      }
      if (sample.metrics.runtimeOutputChannelPortIntentWriteEventCount !== sample.metrics.runtimeOutputSinkWriteEventCount) {
        failures.push(`${sample.recipeId}: channel/port intent write count does not match runtime sink`);
      }
      if (sample.metrics.runtimeOutputChannelPortIntentPsgWriteEventCount !== sample.metrics.runtimeOutputFrameTimelinePsgWriteEventCount) {
        failures.push(`${sample.recipeId}: channel/port intent PSG write count does not match frame timeline`);
      }
      if (sample.metrics.runtimeOutputChannelPortIntentFmWriteEventCount !== sample.metrics.runtimeOutputFrameTimelineFmWriteEventCount) {
        failures.push(`${sample.recipeId}: channel/port intent FM write count does not match frame timeline`);
      }
      if (sample.metrics.runtimeOutputChannelPortIntentMixedWriteEventCount !== sample.metrics.runtimeOutputFrameTimelineMixedWriteEventCount) {
        failures.push(`${sample.recipeId}: channel/port intent mixed write count does not match frame timeline`);
      }
      if (
        sample.metrics.runtimeOutputChannelPortIntentPsgWriteEventCount +
        sample.metrics.runtimeOutputChannelPortIntentFmWriteEventCount +
        sample.metrics.runtimeOutputChannelPortIntentMixedWriteEventCount !==
        sample.metrics.runtimeOutputChannelPortIntentWriteEventCount
      ) {
        failures.push(`${sample.recipeId}: channel/port intent chip write counts do not sum to write count`);
      }
      if (
        sample.metrics.runtimeOutputChannelPortIntentFmAddressWriteEventCount +
        sample.metrics.runtimeOutputChannelPortIntentFmDataWriteEventCount !==
        sample.metrics.runtimeOutputChannelPortIntentFmWriteEventCount
      ) {
        failures.push(`${sample.recipeId}: channel/port intent FM address/data counts do not sum to FM write count`);
      }
      if (
        sample.metrics.runtimeOutputRegisterIntentPsgOnlyFrameCount +
        sample.metrics.runtimeOutputRegisterIntentFmOnlyFrameCount +
        sample.metrics.runtimeOutputRegisterIntentMixedFrameCount +
        sample.metrics.runtimeOutputRegisterIntentNoWriteFrameCount !==
        sample.metrics.runtimeOutputRegisterIntentFrameCount
      ) {
        failures.push(`${sample.recipeId}: register intent frame class counts do not sum to frame count`);
      }
      if (sample.metrics.runtimeOutputAccumulatorFrameGroupCount <= 0) failures.push(`${sample.recipeId}: accumulator has no frame groups`);
      if (sample.metrics.runtimeOutputAccumulatorUniquePhaseFixtureCount <= 0) failures.push(`${sample.recipeId}: accumulator has no phase fixtures`);
      if (sample.metrics.runtimeOutputAccumulatorUniqueWriteFixtureCount <= 0) failures.push(`${sample.recipeId}: accumulator has no write fixtures`);
      if (sample.metrics.runtimeOutputAccumulatorPortKindCount <= 0) failures.push(`${sample.recipeId}: accumulator has no port categories`);
      if (sample.metrics.runtimeOutputAccumulatorActiveChannelCount <= 0) failures.push(`${sample.recipeId}: accumulator has no active channels`);
      if (sample.metrics.runtimeOutputAccumulatorInputFieldKeyCount <= 0) failures.push(`${sample.recipeId}: accumulator has no input field keys`);
      if (sample.metrics.runtimeOutputAccumulatorPersistedRegisterValueCount !== 0) failures.push(`${sample.recipeId}: accumulator persisted register values reported`);
      if (sample.metrics.runtimeOutputAccumulatorPersistedRegisterTraceCount !== 0) failures.push(`${sample.recipeId}: accumulator persisted register traces reported`);
      if (sample.metrics.runtimeOutputAccumulatorPersistedSampleCount !== 0) failures.push(`${sample.recipeId}: accumulator persisted samples reported`);
      if (sample.metrics.runtimeOutputAccumulatorPersistedAudioByteCount !== 0) failures.push(`${sample.recipeId}: accumulator persisted audio bytes reported`);
      if (sample.metrics.runtimeOutputAccumulatorPersistedRomByteCount !== 0) failures.push(`${sample.recipeId}: accumulator persisted ROM bytes reported`);
      if (sample.metrics.runtimeOutputAccumulatorForbiddenPayloadKeyCount !== 0) failures.push(`${sample.recipeId}: accumulator stored forbidden payload keys`);
      if (sample.metrics.runtimeOutputFrameTimelineFrameCount <= 0) failures.push(`${sample.recipeId}: frame timeline has no frames`);
      if (sample.metrics.runtimeOutputFrameTimelinePortKindCount <= 0) failures.push(`${sample.recipeId}: frame timeline has no port categories`);
      if (sample.metrics.runtimeOutputFrameTimelineActiveChannelCount <= 0) failures.push(`${sample.recipeId}: frame timeline has no active channels`);
      if (sample.metrics.runtimeOutputFrameTimelineInputFieldKeyCount <= 0) failures.push(`${sample.recipeId}: frame timeline has no input field keys`);
      if (sample.metrics.runtimeOutputFrameTimelinePersistedRegisterValueCount !== 0) failures.push(`${sample.recipeId}: frame timeline persisted register values reported`);
      if (sample.metrics.runtimeOutputFrameTimelinePersistedRegisterTraceCount !== 0) failures.push(`${sample.recipeId}: frame timeline persisted register traces reported`);
      if (sample.metrics.runtimeOutputFrameTimelinePersistedSampleCount !== 0) failures.push(`${sample.recipeId}: frame timeline persisted samples reported`);
      if (sample.metrics.runtimeOutputFrameTimelinePersistedAudioByteCount !== 0) failures.push(`${sample.recipeId}: frame timeline persisted audio bytes reported`);
      if (sample.metrics.runtimeOutputFrameTimelinePersistedRomByteCount !== 0) failures.push(`${sample.recipeId}: frame timeline persisted ROM bytes reported`);
      if (sample.metrics.runtimeOutputFrameTimelineForbiddenPayloadKeyCount !== 0) failures.push(`${sample.recipeId}: frame timeline stored forbidden payload keys`);
      if (sample.metrics.runtimeOutputRegisterIntentFrameCount <= 0) failures.push(`${sample.recipeId}: register intent has no frames`);
      if (sample.metrics.runtimeOutputRegisterIntentPortKindCount <= 0) failures.push(`${sample.recipeId}: register intent has no port categories`);
      if (sample.metrics.runtimeOutputRegisterIntentActiveChannelCount <= 0) failures.push(`${sample.recipeId}: register intent has no active channels`);
      if (sample.metrics.runtimeOutputRegisterIntentInputFieldKeyCount <= 0) failures.push(`${sample.recipeId}: register intent has no input field keys`);
      if (sample.metrics.runtimeOutputRegisterIntentPersistedRegisterValueCount !== 0) failures.push(`${sample.recipeId}: register intent persisted register values reported`);
      if (sample.metrics.runtimeOutputRegisterIntentPersistedRegisterTraceCount !== 0) failures.push(`${sample.recipeId}: register intent persisted register traces reported`);
      if (sample.metrics.runtimeOutputRegisterIntentPersistedSampleCount !== 0) failures.push(`${sample.recipeId}: register intent persisted samples reported`);
      if (sample.metrics.runtimeOutputRegisterIntentPersistedAudioByteCount !== 0) failures.push(`${sample.recipeId}: register intent persisted audio bytes reported`);
      if (sample.metrics.runtimeOutputRegisterIntentPersistedRomByteCount !== 0) failures.push(`${sample.recipeId}: register intent persisted ROM bytes reported`);
      if (sample.metrics.runtimeOutputRegisterIntentForbiddenPayloadKeyCount !== 0) failures.push(`${sample.recipeId}: register intent stored forbidden payload keys`);
      if (sample.metrics.runtimeOutputChannelPortIntentGroupCount <= 0) failures.push(`${sample.recipeId}: channel/port intent has no groups`);
      if (sample.metrics.runtimeOutputChannelPortIntentPortKindCount <= 0) failures.push(`${sample.recipeId}: channel/port intent has no port categories`);
      if (sample.metrics.runtimeOutputChannelPortIntentActiveChannelCount <= 0) failures.push(`${sample.recipeId}: channel/port intent has no active channels`);
      if (sample.metrics.runtimeOutputChannelPortIntentPhaseKindCount <= 0) failures.push(`${sample.recipeId}: channel/port intent has no phase kinds`);
      if (sample.metrics.runtimeOutputChannelPortIntentInputFieldKeyCount <= 0) failures.push(`${sample.recipeId}: channel/port intent has no input field keys`);
      if (sample.metrics.runtimeOutputChannelPortIntentSourceEventKindCount <= 0) failures.push(`${sample.recipeId}: channel/port intent has no source event kinds`);
      if (sample.metrics.runtimeOutputChannelPortIntentSourceEventRoleCount <= 0) failures.push(`${sample.recipeId}: channel/port intent has no source event roles`);
      if (sample.metrics.runtimeOutputChannelPortIntentSourceTraceOperationKindCount <= 0) failures.push(`${sample.recipeId}: channel/port intent has no source trace operation kinds`);
      if (sample.metrics.runtimeOutputChannelPortIntentSourceTraceTargetCount <= 0) failures.push(`${sample.recipeId}: channel/port intent has no source trace targets`);
      if (sample.metrics.runtimeOutputChannelPortIntentSourceRamFieldKeyCount <= 0) failures.push(`${sample.recipeId}: channel/port intent has no source RAM field keys`);
      if (sample.metrics.runtimeOutputChannelPortIntentSourceTraceLinkedWriteCount <= 0) failures.push(`${sample.recipeId}: channel/port intent has no trace-linked writes`);
      if (sample.metrics.runtimeOutputChannelPortIntentSourceRamLinkedWriteCount <= 0) failures.push(`${sample.recipeId}: channel/port intent has no RAM-linked writes`);
      if (sample.metrics.runtimeOutputChannelPortIntentPersistedRegisterValueCount !== 0) failures.push(`${sample.recipeId}: channel/port intent persisted register values reported`);
      if (sample.metrics.runtimeOutputChannelPortIntentPersistedRegisterTraceCount !== 0) failures.push(`${sample.recipeId}: channel/port intent persisted register traces reported`);
      if (sample.metrics.runtimeOutputChannelPortIntentPersistedSampleCount !== 0) failures.push(`${sample.recipeId}: channel/port intent persisted samples reported`);
      if (sample.metrics.runtimeOutputChannelPortIntentPersistedAudioByteCount !== 0) failures.push(`${sample.recipeId}: channel/port intent persisted audio bytes reported`);
      if (sample.metrics.runtimeOutputChannelPortIntentPersistedRomByteCount !== 0) failures.push(`${sample.recipeId}: channel/port intent persisted ROM bytes reported`);
      if (sample.metrics.runtimeOutputChannelPortIntentForbiddenPayloadKeyCount !== 0) failures.push(`${sample.recipeId}: channel/port intent stored forbidden payload keys`);
      if (sample.metrics.runtimeOutputSinkMissingPhaseFixtureCount !== 0) failures.push(`${sample.recipeId}: runtime sink missing phase fixtures`);
      if (sample.metrics.runtimeOutputSinkMissingWriteFixtureCount !== 0) failures.push(`${sample.recipeId}: runtime sink missing write fixtures`);
      if (sample.metrics.runtimeOutputSinkMissingRequiredEventKeyCount !== 0) failures.push(`${sample.recipeId}: runtime sink event contract key gaps`);
      if (sample.metrics.runtimeOutputSinkForbiddenPayloadKeyCount !== 0) failures.push(`${sample.recipeId}: runtime sink stored forbidden payload keys`);
      if (sample.metrics.outputRegisterTimelineEntryCount > 0 && !sample.textHasFixtureSummary) {
        failures.push(`${sample.recipeId}: rendered preview did not mention fixture summary`);
      }
      if (sample.metrics.outputRegisterTimelineEntryCount > 0 && !sample.textHasFixtureId) {
        failures.push(`${sample.recipeId}: rendered preview did not show fixture ids`);
      }
      if (sample.metrics.outputRegisterTimelineEntryCount > 0 && !sample.textHasRuntimeSink) {
        failures.push(`${sample.recipeId}: rendered preview did not mention runtime output event sink`);
      }
      if (sample.metrics.outputRegisterTimelineEntryCount > 0 && !sample.textHasRuntimeAccumulator) {
        failures.push(`${sample.recipeId}: rendered preview did not mention runtime output accumulator`);
      }
      if (sample.metrics.outputRegisterTimelineEntryCount > 0 && !sample.textHasFrameTimeline) {
        failures.push(`${sample.recipeId}: rendered preview did not mention runtime output frame timeline`);
      }
      if (sample.metrics.outputRegisterTimelineEntryCount > 0 && !sample.textHasRegisterIntent) {
        failures.push(`${sample.recipeId}: rendered preview did not mention runtime PSG/FM register intent`);
      }
      if (sample.metrics.outputRegisterTimelineEntryCount > 0 && !sample.textHasChannelPortIntent) {
        failures.push(`${sample.recipeId}: rendered preview did not mention runtime channel/port intent`);
      }
    }

    if (!result.catalogBacked) failures.push('runtime output fixture catalog missing from mapData');
    if (result.sampledRecipeCount === 0) failures.push('no audio-backed zone or inline transition recipes swept');
    if ((totals.outputRegisterTimelineEntryCount || 0) <= 0) failures.push('no output-register timeline entries were produced');
    if ((totals.fixtureLinkedEntryCount || 0) !== (totals.outputRegisterTimelineEntryCount || 0)) {
      failures.push(`fixture-linked entries ${totals.fixtureLinkedEntryCount || 0} did not match timeline entries ${totals.outputRegisterTimelineEntryCount || 0}`);
    }
    if ((totals.fixtureMissingEntryCount || 0) !== 0) failures.push(`missing fixture entries ${totals.fixtureMissingEntryCount || 0}`);
    if ((totals.fixtureLinkedWriteCount || 0) !== (totals.outputRegisterTimelineWriteCount || 0)) {
      failures.push(`fixture-linked writes ${totals.fixtureLinkedWriteCount || 0} did not match timeline writes ${totals.outputRegisterTimelineWriteCount || 0}`);
    }
    if ((totals.runtimeOutputSinkPhaseEventCount || 0) !== (totals.outputRegisterTimelineEntryCount || 0)) {
      failures.push(`runtime sink phase events ${totals.runtimeOutputSinkPhaseEventCount || 0} did not match timeline entries ${totals.outputRegisterTimelineEntryCount || 0}`);
    }
    if ((totals.runtimeOutputSinkWriteEventCount || 0) !== (totals.outputRegisterTimelineWriteCount || 0)) {
      failures.push(`runtime sink write events ${totals.runtimeOutputSinkWriteEventCount || 0} did not match timeline writes ${totals.outputRegisterTimelineWriteCount || 0}`);
    }
    if ((totals.runtimeOutputAccumulatorEventCount || 0) !== (totals.runtimeOutputSinkEventCount || 0)) {
      failures.push(`accumulator events ${totals.runtimeOutputAccumulatorEventCount || 0} did not match runtime sink events ${totals.runtimeOutputSinkEventCount || 0}`);
    }
    if ((totals.runtimeOutputAccumulatorPhaseEventCount || 0) !== (totals.runtimeOutputSinkPhaseEventCount || 0)) {
      failures.push(`accumulator phase events ${totals.runtimeOutputAccumulatorPhaseEventCount || 0} did not match runtime sink phase events ${totals.runtimeOutputSinkPhaseEventCount || 0}`);
    }
    if ((totals.runtimeOutputAccumulatorWriteEventCount || 0) !== (totals.runtimeOutputSinkWriteEventCount || 0)) {
      failures.push(`accumulator write events ${totals.runtimeOutputAccumulatorWriteEventCount || 0} did not match runtime sink write events ${totals.runtimeOutputSinkWriteEventCount || 0}`);
    }
    if ((totals.runtimeOutputFrameTimelineFrameCount || 0) !== (totals.runtimeOutputAccumulatorFrameGroupCount || 0)) {
      failures.push(`frame timeline frames ${totals.runtimeOutputFrameTimelineFrameCount || 0} did not match accumulator frame groups ${totals.runtimeOutputAccumulatorFrameGroupCount || 0}`);
    }
    if ((totals.runtimeOutputFrameTimelineEventCount || 0) !== (totals.runtimeOutputAccumulatorEventCount || 0)) {
      failures.push(`frame timeline events ${totals.runtimeOutputFrameTimelineEventCount || 0} did not match accumulator events ${totals.runtimeOutputAccumulatorEventCount || 0}`);
    }
    if ((totals.runtimeOutputFrameTimelinePhaseEventCount || 0) !== (totals.runtimeOutputAccumulatorPhaseEventCount || 0)) {
      failures.push(`frame timeline phase events ${totals.runtimeOutputFrameTimelinePhaseEventCount || 0} did not match accumulator phase events ${totals.runtimeOutputAccumulatorPhaseEventCount || 0}`);
    }
    if ((totals.runtimeOutputFrameTimelineWriteEventCount || 0) !== (totals.runtimeOutputAccumulatorWriteEventCount || 0)) {
      failures.push(`frame timeline write events ${totals.runtimeOutputFrameTimelineWriteEventCount || 0} did not match accumulator write events ${totals.runtimeOutputAccumulatorWriteEventCount || 0}`);
    }
    if ((totals.runtimeOutputRegisterIntentFrameCount || 0) !== (totals.runtimeOutputFrameTimelineFrameCount || 0)) {
      failures.push(`register intent frames ${totals.runtimeOutputRegisterIntentFrameCount || 0} did not match frame timeline frames ${totals.runtimeOutputFrameTimelineFrameCount || 0}`);
    }
    if ((totals.runtimeOutputRegisterIntentEventCount || 0) !== (totals.runtimeOutputFrameTimelineEventCount || 0)) {
      failures.push(`register intent events ${totals.runtimeOutputRegisterIntentEventCount || 0} did not match frame timeline events ${totals.runtimeOutputFrameTimelineEventCount || 0}`);
    }
    if ((totals.runtimeOutputRegisterIntentPhaseEventCount || 0) !== (totals.runtimeOutputFrameTimelinePhaseEventCount || 0)) {
      failures.push(`register intent phase events ${totals.runtimeOutputRegisterIntentPhaseEventCount || 0} did not match frame timeline phase events ${totals.runtimeOutputFrameTimelinePhaseEventCount || 0}`);
    }
    if ((totals.runtimeOutputRegisterIntentWriteEventCount || 0) !== (totals.runtimeOutputFrameTimelineWriteEventCount || 0)) {
      failures.push(`register intent write events ${totals.runtimeOutputRegisterIntentWriteEventCount || 0} did not match frame timeline write events ${totals.runtimeOutputFrameTimelineWriteEventCount || 0}`);
    }
    if ((totals.runtimeOutputRegisterIntentPsgWriteEventCount || 0) !== (totals.runtimeOutputFrameTimelinePsgWriteEventCount || 0)) {
      failures.push(`register intent PSG writes ${totals.runtimeOutputRegisterIntentPsgWriteEventCount || 0} did not match frame timeline PSG writes ${totals.runtimeOutputFrameTimelinePsgWriteEventCount || 0}`);
    }
    if ((totals.runtimeOutputRegisterIntentFmWriteEventCount || 0) !== (totals.runtimeOutputFrameTimelineFmWriteEventCount || 0)) {
      failures.push(`register intent FM writes ${totals.runtimeOutputRegisterIntentFmWriteEventCount || 0} did not match frame timeline FM writes ${totals.runtimeOutputFrameTimelineFmWriteEventCount || 0}`);
    }
    if ((totals.runtimeOutputRegisterIntentForbiddenPayloadKeyCount || 0) !== 0) failures.push(`runtime register intent forbidden payload keys ${totals.runtimeOutputRegisterIntentForbiddenPayloadKeyCount || 0}`);
    if ((totals.runtimeOutputRegisterIntentPersistedRegisterValueCount || 0) !== 0) failures.push(`runtime register intent persisted register values ${totals.runtimeOutputRegisterIntentPersistedRegisterValueCount || 0}`);
    if ((totals.runtimeOutputRegisterIntentPersistedRegisterTraceCount || 0) !== 0) failures.push(`runtime register intent persisted register traces ${totals.runtimeOutputRegisterIntentPersistedRegisterTraceCount || 0}`);
    if ((totals.runtimeOutputRegisterIntentPersistedSampleCount || 0) !== 0) failures.push(`runtime register intent persisted samples ${totals.runtimeOutputRegisterIntentPersistedSampleCount || 0}`);
    if ((totals.runtimeOutputRegisterIntentPersistedAudioByteCount || 0) !== 0) failures.push(`runtime register intent persisted audio bytes ${totals.runtimeOutputRegisterIntentPersistedAudioByteCount || 0}`);
    if ((totals.runtimeOutputRegisterIntentPersistedRomByteCount || 0) !== 0) failures.push(`runtime register intent persisted ROM bytes ${totals.runtimeOutputRegisterIntentPersistedRomByteCount || 0}`);
    if ((totals.runtimeOutputChannelPortIntentFrameCount || 0) !== (totals.runtimeOutputFrameTimelineFrameCount || 0)) {
      failures.push(`channel/port intent frames ${totals.runtimeOutputChannelPortIntentFrameCount || 0} did not match frame timeline frames ${totals.runtimeOutputFrameTimelineFrameCount || 0}`);
    }
    if ((totals.runtimeOutputChannelPortIntentWriteEventCount || 0) !== (totals.runtimeOutputSinkWriteEventCount || 0)) {
      failures.push(`channel/port intent writes ${totals.runtimeOutputChannelPortIntentWriteEventCount || 0} did not match runtime sink writes ${totals.runtimeOutputSinkWriteEventCount || 0}`);
    }
    if ((totals.runtimeOutputChannelPortIntentPsgWriteEventCount || 0) !== (totals.runtimeOutputFrameTimelinePsgWriteEventCount || 0)) {
      failures.push(`channel/port intent PSG writes ${totals.runtimeOutputChannelPortIntentPsgWriteEventCount || 0} did not match frame timeline PSG writes ${totals.runtimeOutputFrameTimelinePsgWriteEventCount || 0}`);
    }
    if ((totals.runtimeOutputChannelPortIntentFmWriteEventCount || 0) !== (totals.runtimeOutputFrameTimelineFmWriteEventCount || 0)) {
      failures.push(`channel/port intent FM writes ${totals.runtimeOutputChannelPortIntentFmWriteEventCount || 0} did not match frame timeline FM writes ${totals.runtimeOutputFrameTimelineFmWriteEventCount || 0}`);
    }
    if (
      (totals.runtimeOutputChannelPortIntentFmAddressWriteEventCount || 0) +
      (totals.runtimeOutputChannelPortIntentFmDataWriteEventCount || 0) !==
      (totals.runtimeOutputChannelPortIntentFmWriteEventCount || 0)
    ) {
      failures.push(`channel/port intent FM address/data writes did not match FM writes`);
    }
    if ((totals.runtimeOutputChannelPortIntentForbiddenPayloadKeyCount || 0) !== 0) failures.push(`runtime channel/port intent forbidden payload keys ${totals.runtimeOutputChannelPortIntentForbiddenPayloadKeyCount || 0}`);
    if ((totals.runtimeOutputChannelPortIntentSourceEventKindCount || 0) <= 0) failures.push('channel/port intent had no source event kinds');
    if ((totals.runtimeOutputChannelPortIntentSourceEventRoleCount || 0) <= 0) failures.push('channel/port intent had no source event roles');
    if ((totals.runtimeOutputChannelPortIntentSourceTraceOperationKindCount || 0) <= 0) failures.push('channel/port intent had no source trace operation kinds');
    if ((totals.runtimeOutputChannelPortIntentSourceTraceTargetCount || 0) <= 0) failures.push('channel/port intent had no source trace targets');
    if ((totals.runtimeOutputChannelPortIntentSourceRamFieldKeyCount || 0) <= 0) failures.push('channel/port intent had no source RAM field keys');
    if ((totals.runtimeOutputChannelPortIntentSourceTraceLinkedWriteCount || 0) <= 0) failures.push('channel/port intent had no trace-linked writes');
    if ((totals.runtimeOutputChannelPortIntentSourceRamLinkedWriteCount || 0) <= 0) failures.push('channel/port intent had no RAM-linked writes');
    if ((totals.runtimeOutputChannelPortIntentPersistedRegisterValueCount || 0) !== 0) failures.push(`runtime channel/port intent persisted register values ${totals.runtimeOutputChannelPortIntentPersistedRegisterValueCount || 0}`);
    if ((totals.runtimeOutputChannelPortIntentPersistedRegisterTraceCount || 0) !== 0) failures.push(`runtime channel/port intent persisted register traces ${totals.runtimeOutputChannelPortIntentPersistedRegisterTraceCount || 0}`);
    if ((totals.runtimeOutputChannelPortIntentPersistedSampleCount || 0) !== 0) failures.push(`runtime channel/port intent persisted samples ${totals.runtimeOutputChannelPortIntentPersistedSampleCount || 0}`);
    if ((totals.runtimeOutputChannelPortIntentPersistedAudioByteCount || 0) !== 0) failures.push(`runtime channel/port intent persisted audio bytes ${totals.runtimeOutputChannelPortIntentPersistedAudioByteCount || 0}`);
    if ((totals.runtimeOutputChannelPortIntentPersistedRomByteCount || 0) !== 0) failures.push(`runtime channel/port intent persisted ROM bytes ${totals.runtimeOutputChannelPortIntentPersistedRomByteCount || 0}`);
    if ((totals.runtimeOutputSinkMissingPhaseFixtureCount || 0) !== 0) failures.push(`runtime sink missing phase fixtures ${totals.runtimeOutputSinkMissingPhaseFixtureCount || 0}`);
    if ((totals.runtimeOutputSinkMissingWriteFixtureCount || 0) !== 0) failures.push(`runtime sink missing write fixtures ${totals.runtimeOutputSinkMissingWriteFixtureCount || 0}`);
    if ((totals.runtimeOutputSinkForbiddenPayloadKeyCount || 0) !== 0) failures.push(`runtime sink forbidden payload keys ${totals.runtimeOutputSinkForbiddenPayloadKeyCount || 0}`);
    if ((totals.runtimeOutputAccumulatorForbiddenPayloadKeyCount || 0) !== 0) failures.push(`runtime accumulator forbidden payload keys ${totals.runtimeOutputAccumulatorForbiddenPayloadKeyCount || 0}`);
    if ((totals.runtimeOutputFrameTimelineForbiddenPayloadKeyCount || 0) !== 0) failures.push(`runtime frame timeline forbidden payload keys ${totals.runtimeOutputFrameTimelineForbiddenPayloadKeyCount || 0}`);
    if ((totals.runtimeOutputEventContractEventCount || 0) !== (totals.runtimeOutputSinkEventCount || 0)) {
      failures.push(`runtime event contract events ${totals.runtimeOutputEventContractEventCount || 0} did not match sink events ${totals.runtimeOutputSinkEventCount || 0}`);
    }
    if ((totals.runtimeOutputEventContractObjectEventCount || 0) !== (totals.runtimeOutputSinkEventCount || 0)) {
      failures.push(`runtime event contract object events ${totals.runtimeOutputEventContractObjectEventCount || 0} did not match sink events ${totals.runtimeOutputSinkEventCount || 0}`);
    }
    if ((totals.runtimeOutputEventContractMissingRequiredKeyCount || 0) !== 0) failures.push(`runtime event contract missing required keys ${totals.runtimeOutputEventContractMissingRequiredKeyCount || 0}`);
    if ((totals.runtimeOutputEventContractEventForbiddenPayloadKeyCount || 0) !== 0) failures.push(`runtime event contract forbidden event payload keys ${totals.runtimeOutputEventContractEventForbiddenPayloadKeyCount || 0}`);
    if ((totals.runtimeOutputEventContractModelForbiddenPayloadKeyCount || 0) !== 0) failures.push(`runtime event contract forbidden model payload keys ${totals.runtimeOutputEventContractModelForbiddenPayloadKeyCount || 0}`);
    if ((totals.runtimeOutputEventContractInvalidEventKindCount || 0) !== 0) failures.push(`runtime event contract invalid event kinds ${totals.runtimeOutputEventContractInvalidEventKindCount || 0}`);
    if ((totals.runtimeOutputEventContractMissingModelCount || 0) !== 0) failures.push(`runtime event contract missing models ${totals.runtimeOutputEventContractMissingModelCount || 0}`);
    if ((totals.runtimeOutputEventContractMissingModelSummaryKeyCount || 0) !== 0) failures.push(`runtime event contract missing model summary keys ${totals.runtimeOutputEventContractMissingModelSummaryKeyCount || 0}`);
    if ((totals.runtimeOutputEventContractNonZeroPersistedPayloadCount || 0) !== 0) failures.push(`runtime event contract nonzero persisted payloads ${totals.runtimeOutputEventContractNonZeroPersistedPayloadCount || 0}`);
    if ((totals.runtimeOutputEventContractValidationIssueCount || 0) !== 0) failures.push(`runtime event contract validation issues ${totals.runtimeOutputEventContractValidationIssueCount || 0}`);
    if ((totals.runtimeOutputEventContractObjectValidationIssueCount || 0) !== 0) failures.push(`runtime event contract object validation issues ${totals.runtimeOutputEventContractObjectValidationIssueCount || 0}`);
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.join('; ')}`);

    const summary = {
      ok: failures.length === 0,
      projectName,
      catalogId: result.catalogId,
      catalogPhaseCount: result.catalogPhaseCount,
      catalogWriteCount: result.catalogWriteCount,
      sampledRecipeCount: result.sampledRecipeCount,
      sweepMode: result.sweepMode,
      fullSweepRecipeCount: result.fullSweepRecipeCount,
      outputReadyRecipeCount: result.sampledRecipeCount - noOutputSamples.length,
      noOutputRecipeCount: noOutputSamples.length,
      noOutputRecipeIds: noOutputSamples.map(sample => sample.recipeId),
      totals,
      accumulatorUniqueCounts: {
        phaseFixtureCount: accumulatorUnique.phaseFixtureIds.size,
        writeFixtureCount: accumulatorUnique.writeFixtureIds.size,
        portKindCount: accumulatorUnique.portKinds.size,
        branchKindCount: accumulatorUnique.branchKinds.size,
        inputFieldKeyCount: accumulatorUnique.inputFieldKeys.size,
        activeChannelCount: accumulatorUnique.activeChannels.size,
      },
      frameTimelineUniqueCounts: {
        phaseFixtureCount: frameTimelineUnique.phaseFixtureIds.size,
        writeFixtureCount: frameTimelineUnique.writeFixtureIds.size,
        portKindCount: frameTimelineUnique.portKinds.size,
        branchKindCount: frameTimelineUnique.branchKinds.size,
        inputFieldKeyCount: frameTimelineUnique.inputFieldKeys.size,
        activeChannelCount: frameTimelineUnique.activeChannels.size,
      },
      registerIntentUniqueCounts: {
        phaseFixtureCount: registerIntentUnique.phaseFixtureIds.size,
        writeFixtureCount: registerIntentUnique.writeFixtureIds.size,
        portKindCount: registerIntentUnique.portKinds.size,
        branchKindCount: registerIntentUnique.branchKinds.size,
        inputFieldKeyCount: registerIntentUnique.inputFieldKeys.size,
        activeChannelCount: registerIntentUnique.activeChannels.size,
      },
      channelPortIntentUniqueCounts: {
        phaseFixtureCount: channelPortIntentUnique.phaseFixtureIds.size,
        writeFixtureCount: channelPortIntentUnique.writeFixtureIds.size,
        portKindCount: channelPortIntentUnique.portKinds.size,
        branchKindCount: channelPortIntentUnique.branchKinds.size,
        inputFieldKeyCount: channelPortIntentUnique.inputFieldKeys.size,
        activeChannelCount: channelPortIntentUnique.activeChannels.size,
        phaseKindCount: channelPortIntentUnique.phaseKinds.size,
        sourceEventKindCount: channelPortIntentUnique.sourceEventKinds.size,
        sourceEventRoleCount: channelPortIntentUnique.sourceEventRoles.size,
        sourceTraceOperationKindCount: channelPortIntentUnique.sourceTraceOperationKinds.size,
        sourceTraceTargetCount: channelPortIntentUnique.sourceTraceTargets.size,
        sourceRamFieldKeyCount: channelPortIntentUnique.sourceRamFieldKeys.size,
        sourceUnresolvedRamFieldKeyCount: channelPortIntentUnique.sourceUnresolvedRamFieldKeys.size,
      },
      firstSamples: result.samples.slice(0, 3).map(sample => ({
        recipeId: sample.recipeId,
        requestId: sample.requestId,
        entries: sample.metrics.outputRegisterTimelineEntryCount,
        writes: sample.metrics.outputRegisterTimelineWriteCount,
        fixtureEntries: sample.metrics.fixtureLinkedEntryCount,
        fixtureWrites: sample.metrics.fixtureLinkedWriteCount,
        runtimeEvents: sample.metrics.runtimeOutputSinkEventCount,
        runtimePhaseEvents: sample.metrics.runtimeOutputSinkPhaseEventCount,
        runtimeWriteEvents: sample.metrics.runtimeOutputSinkWriteEventCount,
        accumulatorEvents: sample.metrics.runtimeOutputAccumulatorEventCount,
        accumulatorFrameGroups: sample.metrics.runtimeOutputAccumulatorFrameGroupCount,
        accumulatorPorts: sample.metrics.runtimeOutputAccumulatorPortKindCount,
        frameTimelineFrames: sample.metrics.runtimeOutputFrameTimelineFrameCount,
        frameTimelineWrites: sample.metrics.runtimeOutputFrameTimelineWriteEventCount,
        registerIntentFrames: sample.metrics.runtimeOutputRegisterIntentFrameCount,
        registerIntentWrites: sample.metrics.runtimeOutputRegisterIntentWriteEventCount,
        registerIntentPsgOnlyFrames: sample.metrics.runtimeOutputRegisterIntentPsgOnlyFrameCount,
        registerIntentFmOnlyFrames: sample.metrics.runtimeOutputRegisterIntentFmOnlyFrameCount,
        registerIntentMixedFrames: sample.metrics.runtimeOutputRegisterIntentMixedFrameCount,
        channelPortIntentGroups: sample.metrics.runtimeOutputChannelPortIntentGroupCount,
        channelPortIntentWrites: sample.metrics.runtimeOutputChannelPortIntentWriteEventCount,
        channelPortIntentPsgWrites: sample.metrics.runtimeOutputChannelPortIntentPsgWriteEventCount,
        channelPortIntentFmAddressWrites: sample.metrics.runtimeOutputChannelPortIntentFmAddressWriteEventCount,
        channelPortIntentFmDataWrites: sample.metrics.runtimeOutputChannelPortIntentFmDataWriteEventCount,
        channelPortIntentSourceRoles: sample.metrics.runtimeOutputChannelPortIntentSourceEventRoleCount,
        channelPortIntentTraceKinds: sample.metrics.runtimeOutputChannelPortIntentSourceTraceOperationKindCount,
        channelPortIntentRamFields: sample.metrics.runtimeOutputChannelPortIntentSourceRamFieldKeyCount,
      })),
      consoleMessages,
      pageErrors,
      failures,
    };

    if (apply && failures.length === 0) {
      const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
      mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
      mapData.analysisReports.push({
        id: reportId,
        type: 'browser_smoke',
        domain: 'audio_runtime_output_channel_port_trace_link',
        generatedAt: now,
        tool: toolName,
        catalogId: result.catalogId,
        projectName,
        confidence: 'high',
        summary: 'Analyzer zone-audio preview emits an in-memory channel/port intent model with source event role, trace-operation, trace-target, and RAM-field linkage metadata, without persisting ROM bytes, stream bytes, opcodes, port values, register values, register traces, samples, or audio bytes.',
        sweepMode: result.sweepMode,
        fullSweep: true,
        fullSweepRecipeCount: result.fullSweepRecipeCount,
        outputReadyRecipeCount: result.sampledRecipeCount - noOutputSamples.length,
        noOutputRecipeCount: noOutputSamples.length,
        noOutputRecipeIds: noOutputSamples.map(sample => sample.recipeId),
        sampledRecipeCount: result.sampledRecipeCount,
        sampledRecipeIds: result.samples.map(sample => sample.recipeId),
        sweptRecipeIds: result.samples.map(sample => sample.recipeId),
        requestIds: [...new Set(result.samples.map(sample => sample.requestId).filter(Boolean))],
        counts: {
          catalogPhaseCount: result.catalogPhaseCount,
          catalogWriteCount: result.catalogWriteCount,
          fullSweepRecipeCount: result.fullSweepRecipeCount,
          outputReadyRecipeCount: result.sampledRecipeCount - noOutputSamples.length,
          noOutputRecipeCount: noOutputSamples.length,
          previewEvents: totals.previewEvents || 0,
          outputPhaseSchedulePhaseCount: totals.outputPhaseSchedulePhaseCount || 0,
          outputPhaseScheduleWriteCount: totals.outputPhaseScheduleWriteCount || 0,
          outputRegisterTimelineEntryCount: totals.outputRegisterTimelineEntryCount || 0,
          outputRegisterTimelineWriteCount: totals.outputRegisterTimelineWriteCount || 0,
          fixtureLinkedEntryCount: totals.fixtureLinkedEntryCount || 0,
          fixtureMissingEntryCount: totals.fixtureMissingEntryCount || 0,
          fixtureLinkedWriteCount: totals.fixtureLinkedWriteCount || 0,
          fixtureWriteMismatchEntryCount: totals.fixtureWriteMismatchEntryCount || 0,
          runtimeOutputSinkEventCount: totals.runtimeOutputSinkEventCount || 0,
          runtimeOutputSinkPhaseEventCount: totals.runtimeOutputSinkPhaseEventCount || 0,
          runtimeOutputSinkWriteEventCount: totals.runtimeOutputSinkWriteEventCount || 0,
          runtimeOutputSinkSelectedPhaseEventCount: totals.runtimeOutputSinkSelectedPhaseEventCount || 0,
          runtimeOutputSinkSelectedWriteEventCount: totals.runtimeOutputSinkSelectedWriteEventCount || 0,
          runtimeOutputSinkMissingPhaseFixtureCount: totals.runtimeOutputSinkMissingPhaseFixtureCount || 0,
          runtimeOutputSinkMissingWriteFixtureCount: totals.runtimeOutputSinkMissingWriteFixtureCount || 0,
          runtimeOutputSinkMissingRequiredEventKeyCount: totals.runtimeOutputSinkMissingRequiredEventKeyCount || 0,
          runtimeOutputSinkForbiddenPayloadKeyCount: totals.runtimeOutputSinkForbiddenPayloadKeyCount || 0,
          persistedRegisterValueCount: totals.persistedRegisterValueCount || 0,
          persistedSampleCount: totals.persistedSampleCount || 0,
          runtimeOutputSinkPersistedRegisterValueCount: totals.runtimeOutputSinkPersistedRegisterValueCount || 0,
          runtimeOutputSinkPersistedRegisterTraceCount: totals.runtimeOutputSinkPersistedRegisterTraceCount || 0,
          runtimeOutputSinkPersistedSampleCount: totals.runtimeOutputSinkPersistedSampleCount || 0,
          runtimeOutputSinkPersistedAudioByteCount: totals.runtimeOutputSinkPersistedAudioByteCount || 0,
          runtimeOutputSinkPersistedRomByteCount: totals.runtimeOutputSinkPersistedRomByteCount || 0,
          runtimeOutputAccumulatorEventCount: totals.runtimeOutputAccumulatorEventCount || 0,
          runtimeOutputAccumulatorPhaseEventCount: totals.runtimeOutputAccumulatorPhaseEventCount || 0,
          runtimeOutputAccumulatorWriteEventCount: totals.runtimeOutputAccumulatorWriteEventCount || 0,
          runtimeOutputAccumulatorSelectedEventCount: totals.runtimeOutputAccumulatorSelectedEventCount || 0,
          runtimeOutputAccumulatorSelectedPhaseEventCount: totals.runtimeOutputAccumulatorSelectedPhaseEventCount || 0,
          runtimeOutputAccumulatorSelectedWriteEventCount: totals.runtimeOutputAccumulatorSelectedWriteEventCount || 0,
          runtimeOutputAccumulatorFrameGroupCount: totals.runtimeOutputAccumulatorFrameGroupCount || 0,
          runtimeOutputAccumulatorFrameLinkedGroupCount: totals.runtimeOutputAccumulatorFrameLinkedGroupCount || 0,
          runtimeOutputAccumulatorFrameUnlinkedGroupCount: totals.runtimeOutputAccumulatorFrameUnlinkedGroupCount || 0,
          runtimeOutputAccumulatorUniquePhaseFixtureCount: accumulatorUnique.phaseFixtureIds.size,
          runtimeOutputAccumulatorUniqueWriteFixtureCount: accumulatorUnique.writeFixtureIds.size,
          runtimeOutputAccumulatorPortKindCount: accumulatorUnique.portKinds.size,
          runtimeOutputAccumulatorBranchKindCount: accumulatorUnique.branchKinds.size,
          runtimeOutputAccumulatorInputFieldKeyCount: accumulatorUnique.inputFieldKeys.size,
          runtimeOutputAccumulatorActiveChannelCount: accumulatorUnique.activeChannels.size,
          runtimeOutputAccumulatorSampleUniquePhaseFixtureTotal: totals.runtimeOutputAccumulatorUniquePhaseFixtureCount || 0,
          runtimeOutputAccumulatorSampleUniqueWriteFixtureTotal: totals.runtimeOutputAccumulatorUniqueWriteFixtureCount || 0,
          runtimeOutputAccumulatorSamplePortKindTotal: totals.runtimeOutputAccumulatorPortKindCount || 0,
          runtimeOutputAccumulatorSampleBranchKindTotal: totals.runtimeOutputAccumulatorBranchKindCount || 0,
          runtimeOutputAccumulatorSampleInputFieldKeyTotal: totals.runtimeOutputAccumulatorInputFieldKeyCount || 0,
          runtimeOutputAccumulatorSampleActiveChannelTotal: totals.runtimeOutputAccumulatorActiveChannelCount || 0,
          runtimeOutputAccumulatorPsgEventCount: totals.runtimeOutputAccumulatorPsgEventCount || 0,
          runtimeOutputAccumulatorFmEventCount: totals.runtimeOutputAccumulatorFmEventCount || 0,
          runtimeOutputAccumulatorMixedEventCount: totals.runtimeOutputAccumulatorMixedEventCount || 0,
          runtimeOutputAccumulatorPsgWriteEventCount: totals.runtimeOutputAccumulatorPsgWriteEventCount || 0,
          runtimeOutputAccumulatorFmWriteEventCount: totals.runtimeOutputAccumulatorFmWriteEventCount || 0,
          runtimeOutputAccumulatorMixedWriteEventCount: totals.runtimeOutputAccumulatorMixedWriteEventCount || 0,
          runtimeOutputAccumulatorForbiddenPayloadKeyCount: totals.runtimeOutputAccumulatorForbiddenPayloadKeyCount || 0,
          runtimeOutputAccumulatorPersistedRegisterValueCount: totals.runtimeOutputAccumulatorPersistedRegisterValueCount || 0,
          runtimeOutputAccumulatorPersistedRegisterTraceCount: totals.runtimeOutputAccumulatorPersistedRegisterTraceCount || 0,
          runtimeOutputAccumulatorPersistedSampleCount: totals.runtimeOutputAccumulatorPersistedSampleCount || 0,
          runtimeOutputAccumulatorPersistedAudioByteCount: totals.runtimeOutputAccumulatorPersistedAudioByteCount || 0,
          runtimeOutputAccumulatorPersistedRomByteCount: totals.runtimeOutputAccumulatorPersistedRomByteCount || 0,
          runtimeOutputFrameTimelineFrameCount: totals.runtimeOutputFrameTimelineFrameCount || 0,
          runtimeOutputFrameTimelineFrameLinkedCount: totals.runtimeOutputFrameTimelineFrameLinkedCount || 0,
          runtimeOutputFrameTimelineFrameUnlinkedCount: totals.runtimeOutputFrameTimelineFrameUnlinkedCount || 0,
          runtimeOutputFrameTimelineEventCount: totals.runtimeOutputFrameTimelineEventCount || 0,
          runtimeOutputFrameTimelinePhaseEventCount: totals.runtimeOutputFrameTimelinePhaseEventCount || 0,
          runtimeOutputFrameTimelineWriteEventCount: totals.runtimeOutputFrameTimelineWriteEventCount || 0,
          runtimeOutputFrameTimelineSelectedEventCount: totals.runtimeOutputFrameTimelineSelectedEventCount || 0,
          runtimeOutputFrameTimelineSelectedPhaseEventCount: totals.runtimeOutputFrameTimelineSelectedPhaseEventCount || 0,
          runtimeOutputFrameTimelineSelectedWriteEventCount: totals.runtimeOutputFrameTimelineSelectedWriteEventCount || 0,
          runtimeOutputFrameTimelineUniquePhaseFixtureCount: frameTimelineUnique.phaseFixtureIds.size,
          runtimeOutputFrameTimelineUniqueWriteFixtureCount: frameTimelineUnique.writeFixtureIds.size,
          runtimeOutputFrameTimelinePortKindCount: frameTimelineUnique.portKinds.size,
          runtimeOutputFrameTimelineBranchKindCount: frameTimelineUnique.branchKinds.size,
          runtimeOutputFrameTimelineInputFieldKeyCount: frameTimelineUnique.inputFieldKeys.size,
          runtimeOutputFrameTimelineActiveChannelCount: frameTimelineUnique.activeChannels.size,
          runtimeOutputFrameTimelinePsgEventCount: totals.runtimeOutputFrameTimelinePsgEventCount || 0,
          runtimeOutputFrameTimelineFmEventCount: totals.runtimeOutputFrameTimelineFmEventCount || 0,
          runtimeOutputFrameTimelineMixedEventCount: totals.runtimeOutputFrameTimelineMixedEventCount || 0,
          runtimeOutputFrameTimelinePsgWriteEventCount: totals.runtimeOutputFrameTimelinePsgWriteEventCount || 0,
          runtimeOutputFrameTimelineFmWriteEventCount: totals.runtimeOutputFrameTimelineFmWriteEventCount || 0,
          runtimeOutputFrameTimelineMixedWriteEventCount: totals.runtimeOutputFrameTimelineMixedWriteEventCount || 0,
          runtimeOutputFrameTimelineForbiddenPayloadKeyCount: totals.runtimeOutputFrameTimelineForbiddenPayloadKeyCount || 0,
          runtimeOutputFrameTimelinePersistedRegisterValueCount: totals.runtimeOutputFrameTimelinePersistedRegisterValueCount || 0,
          runtimeOutputFrameTimelinePersistedRegisterTraceCount: totals.runtimeOutputFrameTimelinePersistedRegisterTraceCount || 0,
          runtimeOutputFrameTimelinePersistedSampleCount: totals.runtimeOutputFrameTimelinePersistedSampleCount || 0,
          runtimeOutputFrameTimelinePersistedAudioByteCount: totals.runtimeOutputFrameTimelinePersistedAudioByteCount || 0,
          runtimeOutputFrameTimelinePersistedRomByteCount: totals.runtimeOutputFrameTimelinePersistedRomByteCount || 0,
          runtimeOutputRegisterIntentFrameCount: totals.runtimeOutputRegisterIntentFrameCount || 0,
          runtimeOutputRegisterIntentPsgOnlyFrameCount: totals.runtimeOutputRegisterIntentPsgOnlyFrameCount || 0,
          runtimeOutputRegisterIntentFmOnlyFrameCount: totals.runtimeOutputRegisterIntentFmOnlyFrameCount || 0,
          runtimeOutputRegisterIntentMixedFrameCount: totals.runtimeOutputRegisterIntentMixedFrameCount || 0,
          runtimeOutputRegisterIntentNoWriteFrameCount: totals.runtimeOutputRegisterIntentNoWriteFrameCount || 0,
          runtimeOutputRegisterIntentEventCount: totals.runtimeOutputRegisterIntentEventCount || 0,
          runtimeOutputRegisterIntentPhaseEventCount: totals.runtimeOutputRegisterIntentPhaseEventCount || 0,
          runtimeOutputRegisterIntentWriteEventCount: totals.runtimeOutputRegisterIntentWriteEventCount || 0,
          runtimeOutputRegisterIntentSelectedEventCount: totals.runtimeOutputRegisterIntentSelectedEventCount || 0,
          runtimeOutputRegisterIntentSelectedPhaseEventCount: totals.runtimeOutputRegisterIntentSelectedPhaseEventCount || 0,
          runtimeOutputRegisterIntentSelectedWriteEventCount: totals.runtimeOutputRegisterIntentSelectedWriteEventCount || 0,
          runtimeOutputRegisterIntentUniquePhaseFixtureCount: registerIntentUnique.phaseFixtureIds.size,
          runtimeOutputRegisterIntentUniqueWriteFixtureCount: registerIntentUnique.writeFixtureIds.size,
          runtimeOutputRegisterIntentPortKindCount: registerIntentUnique.portKinds.size,
          runtimeOutputRegisterIntentBranchKindCount: registerIntentUnique.branchKinds.size,
          runtimeOutputRegisterIntentInputFieldKeyCount: registerIntentUnique.inputFieldKeys.size,
          runtimeOutputRegisterIntentActiveChannelCount: registerIntentUnique.activeChannels.size,
          runtimeOutputRegisterIntentPsgEventCount: totals.runtimeOutputRegisterIntentPsgEventCount || 0,
          runtimeOutputRegisterIntentFmEventCount: totals.runtimeOutputRegisterIntentFmEventCount || 0,
          runtimeOutputRegisterIntentMixedEventCount: totals.runtimeOutputRegisterIntentMixedEventCount || 0,
          runtimeOutputRegisterIntentPsgWriteEventCount: totals.runtimeOutputRegisterIntentPsgWriteEventCount || 0,
          runtimeOutputRegisterIntentFmWriteEventCount: totals.runtimeOutputRegisterIntentFmWriteEventCount || 0,
          runtimeOutputRegisterIntentMixedWriteEventCount: totals.runtimeOutputRegisterIntentMixedWriteEventCount || 0,
          runtimeOutputRegisterIntentForbiddenPayloadKeyCount: totals.runtimeOutputRegisterIntentForbiddenPayloadKeyCount || 0,
          runtimeOutputRegisterIntentPersistedRegisterValueCount: totals.runtimeOutputRegisterIntentPersistedRegisterValueCount || 0,
          runtimeOutputRegisterIntentPersistedRegisterTraceCount: totals.runtimeOutputRegisterIntentPersistedRegisterTraceCount || 0,
          runtimeOutputRegisterIntentPersistedSampleCount: totals.runtimeOutputRegisterIntentPersistedSampleCount || 0,
          runtimeOutputRegisterIntentPersistedAudioByteCount: totals.runtimeOutputRegisterIntentPersistedAudioByteCount || 0,
          runtimeOutputRegisterIntentPersistedRomByteCount: totals.runtimeOutputRegisterIntentPersistedRomByteCount || 0,
          runtimeOutputChannelPortIntentGroupCount: totals.runtimeOutputChannelPortIntentGroupCount || 0,
          runtimeOutputChannelPortIntentFrameCount: totals.runtimeOutputChannelPortIntentFrameCount || 0,
          runtimeOutputChannelPortIntentFrameLinkedGroupCount: totals.runtimeOutputChannelPortIntentFrameLinkedGroupCount || 0,
          runtimeOutputChannelPortIntentFrameUnlinkedGroupCount: totals.runtimeOutputChannelPortIntentFrameUnlinkedGroupCount || 0,
          runtimeOutputChannelPortIntentWriteEventCount: totals.runtimeOutputChannelPortIntentWriteEventCount || 0,
          runtimeOutputChannelPortIntentSelectedWriteEventCount: totals.runtimeOutputChannelPortIntentSelectedWriteEventCount || 0,
          runtimeOutputChannelPortIntentPsgWriteEventCount: totals.runtimeOutputChannelPortIntentPsgWriteEventCount || 0,
          runtimeOutputChannelPortIntentFmWriteEventCount: totals.runtimeOutputChannelPortIntentFmWriteEventCount || 0,
          runtimeOutputChannelPortIntentFmAddressWriteEventCount: totals.runtimeOutputChannelPortIntentFmAddressWriteEventCount || 0,
          runtimeOutputChannelPortIntentFmDataWriteEventCount: totals.runtimeOutputChannelPortIntentFmDataWriteEventCount || 0,
          runtimeOutputChannelPortIntentMixedWriteEventCount: totals.runtimeOutputChannelPortIntentMixedWriteEventCount || 0,
          runtimeOutputChannelPortIntentUniquePhaseFixtureCount: channelPortIntentUnique.phaseFixtureIds.size,
          runtimeOutputChannelPortIntentUniqueWriteFixtureCount: channelPortIntentUnique.writeFixtureIds.size,
          runtimeOutputChannelPortIntentPortKindCount: channelPortIntentUnique.portKinds.size,
          runtimeOutputChannelPortIntentBranchKindCount: channelPortIntentUnique.branchKinds.size,
          runtimeOutputChannelPortIntentInputFieldKeyCount: channelPortIntentUnique.inputFieldKeys.size,
          runtimeOutputChannelPortIntentActiveChannelCount: channelPortIntentUnique.activeChannels.size,
          runtimeOutputChannelPortIntentPhaseKindCount: channelPortIntentUnique.phaseKinds.size,
          runtimeOutputChannelPortIntentSourceEventKindCount: channelPortIntentUnique.sourceEventKinds.size,
          runtimeOutputChannelPortIntentSourceEventRoleCount: channelPortIntentUnique.sourceEventRoles.size,
          runtimeOutputChannelPortIntentSourceTraceOperationKindCount: channelPortIntentUnique.sourceTraceOperationKinds.size,
          runtimeOutputChannelPortIntentSourceTraceTargetCount: channelPortIntentUnique.sourceTraceTargets.size,
          runtimeOutputChannelPortIntentSourceRamFieldKeyCount: channelPortIntentUnique.sourceRamFieldKeys.size,
          runtimeOutputChannelPortIntentSourceUnresolvedRamFieldKeyCount: channelPortIntentUnique.sourceUnresolvedRamFieldKeys.size,
          runtimeOutputChannelPortIntentSourceTraceLinkedWriteCount: totals.runtimeOutputChannelPortIntentSourceTraceLinkedWriteCount || 0,
          runtimeOutputChannelPortIntentSourceRamLinkedWriteCount: totals.runtimeOutputChannelPortIntentSourceRamLinkedWriteCount || 0,
          runtimeOutputChannelPortIntentSourceUnresolvedRamLinkedWriteCount: totals.runtimeOutputChannelPortIntentSourceUnresolvedRamLinkedWriteCount || 0,
          runtimeOutputChannelPortIntentForbiddenPayloadKeyCount: totals.runtimeOutputChannelPortIntentForbiddenPayloadKeyCount || 0,
          runtimeOutputChannelPortIntentPersistedRegisterValueCount: totals.runtimeOutputChannelPortIntentPersistedRegisterValueCount || 0,
          runtimeOutputChannelPortIntentPersistedRegisterTraceCount: totals.runtimeOutputChannelPortIntentPersistedRegisterTraceCount || 0,
          runtimeOutputChannelPortIntentPersistedSampleCount: totals.runtimeOutputChannelPortIntentPersistedSampleCount || 0,
          runtimeOutputChannelPortIntentPersistedAudioByteCount: totals.runtimeOutputChannelPortIntentPersistedAudioByteCount || 0,
          runtimeOutputChannelPortIntentPersistedRomByteCount: totals.runtimeOutputChannelPortIntentPersistedRomByteCount || 0,
        },
        eventContractKeys: [
          'phaseFixtureId',
          'writeFixtureId',
          'frame',
          'pc',
          'chip',
          'port',
          'activeChannel',
          'inputFieldKeys',
          'branchId',
        ],
        assetPolicy: 'metadata_only_no_rom_bytes_no_stream_bytes_no_opcodes_no_port_values_no_register_values_no_register_traces_no_samples_no_audio_bytes',
        evidence: [
          `Browser smoke loaded the local ${projectName} project through api.php and ran zoneAudioRenderPreview for all ${result.fullSweepRecipeCount} audio-backed zone and inline transition recipe(s).`,
          `${result.sampledRecipeCount - noOutputSamples.length} swept recipe(s) produced output-register metadata; ${noOutputSamples.length} swept recipe(s) produced no output-register phases in the current preview window.`,
          `${totals.fixtureLinkedEntryCount || 0}/${totals.outputRegisterTimelineEntryCount || 0} output-register timeline entries reported phase fixture ids from ${result.catalogId}.`,
          `${totals.fixtureLinkedWriteCount || 0}/${totals.outputRegisterTimelineWriteCount || 0} output-register writes reported write fixture ids.`,
          `${totals.runtimeOutputSinkPhaseEventCount || 0} in-memory phase events and ${totals.runtimeOutputSinkWriteEventCount || 0} in-memory write events were emitted through window.zoneAudioLastRuntimeOutputEventSink.`,
          `${totals.runtimeOutputAccumulatorEventCount || 0} runtime output events were folded into ${totals.runtimeOutputAccumulatorFrameGroupCount || 0} frame group observations by window.zoneAudioLastRuntimeOutputStateAccumulator.`,
          `${totals.runtimeOutputFrameTimelineEventCount || 0} runtime output events were rendered as ${totals.runtimeOutputFrameTimelineFrameCount || 0} frame timeline group(s) by window.zoneAudioLastRuntimeOutputFrameTimeline.`,
          `${totals.runtimeOutputRegisterIntentEventCount || 0} runtime output events were classified into ${totals.runtimeOutputRegisterIntentFrameCount || 0} PSG/FM register-intent frame group(s) by window.zoneAudioLastRuntimeOutputRegisterIntentModel.`,
          `${totals.runtimeOutputChannelPortIntentWriteEventCount || 0} runtime output write events were grouped into ${totals.runtimeOutputChannelPortIntentGroupCount || 0} channel/port intent group(s) by window.zoneAudioLastRuntimeOutputChannelPortIntentModel.`,
          `Channel/port intent chip split: PSG writes ${totals.runtimeOutputChannelPortIntentPsgWriteEventCount || 0}, FM writes ${totals.runtimeOutputChannelPortIntentFmWriteEventCount || 0}, mixed writes ${totals.runtimeOutputChannelPortIntentMixedWriteEventCount || 0}.`,
          `Channel/port intent FM phase split: FM address writes ${totals.runtimeOutputChannelPortIntentFmAddressWriteEventCount || 0}, FM data writes ${totals.runtimeOutputChannelPortIntentFmDataWriteEventCount || 0}.`,
          `Channel/port intent global metadata sets across swept recipes: ${channelPortIntentUnique.phaseFixtureIds.size} phase fixtures, ${channelPortIntentUnique.writeFixtureIds.size} write fixtures, ${channelPortIntentUnique.portKinds.size} port kinds, ${channelPortIntentUnique.branchKinds.size} branch kinds, ${channelPortIntentUnique.inputFieldKeys.size} input field keys, ${channelPortIntentUnique.activeChannels.size} active channels, ${channelPortIntentUnique.phaseKinds.size} phase kinds.`,
          `Channel/port source event linkage across swept recipes: ${channelPortIntentUnique.sourceEventKinds.size} event kind(s), ${channelPortIntentUnique.sourceEventRoles.size} event role(s), ${channelPortIntentUnique.sourceTraceOperationKinds.size} trace operation kind(s), ${channelPortIntentUnique.sourceTraceTargets.size} trace target(s), ${channelPortIntentUnique.sourceRamFieldKeys.size} RAM field key(s), ${channelPortIntentUnique.sourceUnresolvedRamFieldKeys.size} unresolved RAM field key(s).`,
          `Channel/port source-linked writes: trace-linked ${totals.runtimeOutputChannelPortIntentSourceTraceLinkedWriteCount || 0}, RAM-linked ${totals.runtimeOutputChannelPortIntentSourceRamLinkedWriteCount || 0}, unresolved-RAM-linked ${totals.runtimeOutputChannelPortIntentSourceUnresolvedRamLinkedWriteCount || 0}.`,
          `Register-intent frame classes across swept recipes: PSG-only ${totals.runtimeOutputRegisterIntentPsgOnlyFrameCount || 0}, FM-only ${totals.runtimeOutputRegisterIntentFmOnlyFrameCount || 0}, mixed ${totals.runtimeOutputRegisterIntentMixedFrameCount || 0}, no-write ${totals.runtimeOutputRegisterIntentNoWriteFrameCount || 0}.`,
          `Register-intent global metadata sets across swept recipes: ${registerIntentUnique.phaseFixtureIds.size} phase fixtures, ${registerIntentUnique.writeFixtureIds.size} write fixtures, ${registerIntentUnique.portKinds.size} port kinds, ${registerIntentUnique.branchKinds.size} branch kinds, ${registerIntentUnique.inputFieldKeys.size} input field keys, ${registerIntentUnique.activeChannels.size} active channels.`,
          `Frame timeline global metadata sets across swept recipes: ${frameTimelineUnique.phaseFixtureIds.size} phase fixtures, ${frameTimelineUnique.writeFixtureIds.size} write fixtures, ${frameTimelineUnique.portKinds.size} port kinds, ${frameTimelineUnique.branchKinds.size} branch kinds, ${frameTimelineUnique.inputFieldKeys.size} input field keys, ${frameTimelineUnique.activeChannels.size} active channels.`,
          `Accumulator global metadata sets across swept recipes: ${accumulatorUnique.phaseFixtureIds.size} phase fixtures, ${accumulatorUnique.writeFixtureIds.size} write fixtures, ${accumulatorUnique.portKinds.size} port kinds, ${accumulatorUnique.branchKinds.size} branch kinds, ${accumulatorUnique.inputFieldKeys.size} input field keys, ${accumulatorUnique.activeChannels.size} active channels.`,
          `Accumulator chip/write split: PSG events ${totals.runtimeOutputAccumulatorPsgEventCount || 0}, FM events ${totals.runtimeOutputAccumulatorFmEventCount || 0}, PSG writes ${totals.runtimeOutputAccumulatorPsgWriteEventCount || 0}, FM writes ${totals.runtimeOutputAccumulatorFmWriteEventCount || 0}.`,
          `Missing fixture entries: ${totals.fixtureMissingEntryCount || 0}; fixture/write mismatches: ${totals.fixtureWriteMismatchEntryCount || 0}.`,
          `Runtime sink missing phase fixtures: ${totals.runtimeOutputSinkMissingPhaseFixtureCount || 0}; missing write fixtures: ${totals.runtimeOutputSinkMissingWriteFixtureCount || 0}; event contract key gaps: ${totals.runtimeOutputSinkMissingRequiredEventKeyCount || 0}; forbidden payload keys: ${totals.runtimeOutputSinkForbiddenPayloadKeyCount || 0}.`,
          `Channel/port intent forbidden payload keys: ${totals.runtimeOutputChannelPortIntentForbiddenPayloadKeyCount || 0}; persisted register values: ${totals.runtimeOutputChannelPortIntentPersistedRegisterValueCount || 0}; register traces: ${totals.runtimeOutputChannelPortIntentPersistedRegisterTraceCount || 0}; samples: ${totals.runtimeOutputChannelPortIntentPersistedSampleCount || 0}; audio bytes: ${totals.runtimeOutputChannelPortIntentPersistedAudioByteCount || 0}; ROM bytes: ${totals.runtimeOutputChannelPortIntentPersistedRomByteCount || 0}.`,
          `Register-intent forbidden payload keys: ${totals.runtimeOutputRegisterIntentForbiddenPayloadKeyCount || 0}; persisted register values: ${totals.runtimeOutputRegisterIntentPersistedRegisterValueCount || 0}; register traces: ${totals.runtimeOutputRegisterIntentPersistedRegisterTraceCount || 0}; samples: ${totals.runtimeOutputRegisterIntentPersistedSampleCount || 0}; audio bytes: ${totals.runtimeOutputRegisterIntentPersistedAudioByteCount || 0}; ROM bytes: ${totals.runtimeOutputRegisterIntentPersistedRomByteCount || 0}.`,
          `Frame timeline forbidden payload keys: ${totals.runtimeOutputFrameTimelineForbiddenPayloadKeyCount || 0}; persisted register values: ${totals.runtimeOutputFrameTimelinePersistedRegisterValueCount || 0}; register traces: ${totals.runtimeOutputFrameTimelinePersistedRegisterTraceCount || 0}; samples: ${totals.runtimeOutputFrameTimelinePersistedSampleCount || 0}; audio bytes: ${totals.runtimeOutputFrameTimelinePersistedAudioByteCount || 0}; ROM bytes: ${totals.runtimeOutputFrameTimelinePersistedRomByteCount || 0}.`,
          `Accumulator forbidden payload keys: ${totals.runtimeOutputAccumulatorForbiddenPayloadKeyCount || 0}; persisted register values: ${totals.runtimeOutputAccumulatorPersistedRegisterValueCount || 0}; register traces: ${totals.runtimeOutputAccumulatorPersistedRegisterTraceCount || 0}; samples: ${totals.runtimeOutputAccumulatorPersistedSampleCount || 0}; audio bytes: ${totals.runtimeOutputAccumulatorPersistedAudioByteCount || 0}; ROM bytes: ${totals.runtimeOutputAccumulatorPersistedRomByteCount || 0}.`,
        ],
        limitations: [
          'This smoke sweeps analyzer zone-audio previews through the UI; it does not execute the original Z80 driver or synthesize PSG/FM audio.',
          'No-output recipes are classified from the current analyzer preview window only; they need runtime driver tracing before they can be promoted to silence or deferred-audio semantics.',
          'The channel/port intent model classifies frame/chip/port/active-channel/branch/fixture metadata only; runtime port/register values remain intentionally absent until an emulator harness owns them in memory.',
        ],
      });
      fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
      summary.appliedReportId = reportId;
    }

    console.log(JSON.stringify(summary, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await stopPhpServer(server.proc);
  }
}

runSmoke().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
