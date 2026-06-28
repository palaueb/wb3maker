#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const projectName = process.env.WB3_PROJECT || 'WORLD';
const startPort = Number(process.env.WB3_SMOKE_PORT || 8490);
const maxPort = startPort + 30;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const forbiddenExportKeys = new Set([
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
  'value',
  'values',
  'payload',
  'payloads',
  'raw',
  'rawValue',
  'rawValues',
  'rawByte',
  'rawBytes',
  'byte',
  'bytes',
  'data',
  'register',
  'registers',
  'trace',
  'traces',
  'snapshot',
  'snapshots',
  'hash',
  'hashes',
  'tileId',
  'tileIds',
  'paletteValue',
  'paletteValues',
  'vdpPortValue',
  'vdpRegisterValue',
  'decodedPixels',
  'pixels',
  'screenshot',
  'screenshots',
  'instructionByte',
  'instructionBytes',
]);

function assertEqual(actual, expected, label, failures) {
  if (String(actual) !== String(expected)) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

function assertTruthy(value, label, failures) {
  if (!value) failures.push(`${label}: expected truthy value`);
}

function forbiddenPaths(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => forbiddenPaths(item, `${path || 'root'}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    const direct = forbiddenExportKeys.has(key) ? [childPath] : [];
    return direct.concat(forbiddenPaths(child, childPath));
  });
}

async function readStreamText(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function readDownloadJson(download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Download stream is not available');
  return JSON.parse(await readStreamText(stream));
}

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
    // The smoke result is already decided.
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

async function main() {
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
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
      typeof window.audioRuntimeOutputFixtureRenderPreview === 'function' &&
      typeof window.zoneAudioSetRecipe === 'function' &&
      typeof window.zoneAudioRenderPreview === 'function' &&
      document.getElementById('audio-runtime-output-fixture-preview') &&
      document.getElementById('zone-audio-preview')
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
      window.mapData.zoneRecipes.length > 0
    );

    const value = await page.evaluate(() => {
      const forbiddenKeys = new Set([
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
        'value',
        'values',
        'payload',
        'payloads',
        'raw',
        'rawValue',
        'rawValues',
        'rawByte',
        'rawBytes',
        'byte',
        'bytes',
        'data',
        'register',
        'registers',
        'trace',
        'traces',
        'snapshot',
        'snapshots',
        'hash',
        'hashes',
        'tileId',
        'tileIds',
        'paletteValue',
        'paletteValues',
        'vdpPortValue',
        'vdpRegisterValue',
        'decodedPixels',
        'pixels',
        'screenshot',
        'screenshots',
        'instructionByte',
        'instructionBytes',
      ]);
      const forbiddenPaths = (value, path = '') => {
        if (!value || typeof value !== 'object') return [];
        if (Array.isArray(value)) {
          return value.flatMap((item, index) => forbiddenPaths(item, `${path || 'root'}[${index}]`));
        }
        return Object.entries(value).flatMap(([key, child]) => {
          const childPath = path ? `${path}.${key}` : key;
          const direct = forbiddenKeys.has(key) ? [childPath] : [];
          return direct.concat(forbiddenPaths(child, childPath));
        });
      };

      const fixtureResult = window.audioRuntimeOutputFixtureRenderPreview();
      const fixtureOut = document.getElementById('audio-runtime-output-fixture-preview');
      const fixtureDataset = { ...fixtureOut.dataset };
      const fixtureText = fixtureOut.textContent;
      const recipes = [
        ...(window.mapData.zoneRecipes || []),
        ...(window.mapData.inlineTransitionRecipes || []),
      ].filter(recipe => recipe?.dependencies?.audioRequest);
      const selector = document.getElementById('zone-recipe-sel');
      const preview = document.getElementById('zone-audio-preview');
      let selectedRecipeId = '';
      let selectedText = '';
      let selectedDataset = {};
      let exportButtonDataset = {};
      let exportButtonDisabled = true;
      let exportInfoText = '';
      let selectedBundle = null;
      for (const recipe of recipes.slice(0, 40)) {
        if (selector) selector.value = recipe.id || '';
        window.zoneAudioSetRecipe(recipe, recipe.dependencies?.audioRequest?.requestId);
        window.zoneAudioRenderPreview();
        const bundle = window.zoneAudioLastRuntimeOutputLocalObservationBundle || null;
        if (bundle?.summary?.observationCount) {
          const exportButton = document.getElementById('btn-zone-audio-export-observations');
          const exportInfo = document.getElementById('zone-audio-export-info');
          selectedRecipeId = recipe.id || '';
          selectedText = preview.textContent;
          selectedDataset = { ...preview.dataset };
          exportButtonDataset = { ...(exportButton?.dataset || {}) };
          exportButtonDisabled = exportButton ? exportButton.disabled : true;
          exportInfoText = exportInfo?.textContent || '';
          selectedBundle = bundle;
          break;
        }
      }
      return {
        fixtureResult,
        fixtureDataset,
        fixtureTextHasLocalBundle: fixtureText.includes('Local audio observation bundle'),
        fixtureTextHasTemplatePath: fixtureText.includes('tmp/local-audio-output-observations.template.json'),
        fixtureTextHasBundleTool: fixtureText.includes('world-audio-runtime-output-local-bundle.mjs'),
        recipeCount: recipes.length,
        selectedRecipeId,
        selectedDataset,
        exportButtonDataset,
        exportButtonDisabled,
        exportInfoText,
        selectedTextHasLocalBundle: selectedText.includes('runtime local observation bundle'),
        selectedTextHasObservationPath: selectedText.includes('tmp/local-audio-output-observations.json'),
        selectedTextHasBundleTool: selectedText.includes('world-audio-runtime-output-local-bundle.mjs'),
        bundle: selectedBundle ? {
          eventKind: selectedBundle.eventKind,
          templateOnly: selectedBundle.templateOnly,
          reviewStatus: selectedBundle.reviewStatus,
          observationCount: selectedBundle.summary.observationCount,
          phaseObservationCount: selectedBundle.summary.phaseObservationCount,
          writeObservationCount: selectedBundle.summary.writeObservationCount,
          selectedObservationCount: selectedBundle.summary.selectedObservationCount,
          forbiddenPayloadKeyCount: selectedBundle.summary.forbiddenPayloadKeyCount,
          missingFixtureObservationCount: selectedBundle.summary.missingFixtureObservationCount,
          readyForLocalBundle: selectedBundle.summary.readyForLocalBundle,
          defaultInputPath: selectedBundle.summary.defaultFilledObservationPath,
          defaultBundleOutputPath: selectedBundle.summary.defaultBundleOutputPath,
          persistedRegisterValueCount: selectedBundle.summary.persistedRegisterValueCount,
          persistedRegisterTraceCount: selectedBundle.summary.persistedRegisterTraceCount,
          persistedPortValueCount: selectedBundle.summary.persistedPortValueCount,
          persistedSampleCount: selectedBundle.summary.persistedSampleCount,
          persistedAudioByteCount: selectedBundle.summary.persistedAudioByteCount,
          persistedRomByteCount: selectedBundle.summary.persistedRomByteCount,
          forbiddenPathCount: forbiddenPaths(selectedBundle).length,
          observationForbiddenPathCount: forbiddenPaths(selectedBundle.observations || []).length,
          firstObservationKeys: Object.keys((selectedBundle.observations || [])[0] || {}).sort(),
        } : null,
      };
    });

    const failures = [];
    assertEqual(value.fixtureDataset.audioRuntimeOutputFixtureLocalBundleCatalogBacked, '1', 'fixture local catalog backed', failures);
    assertEqual(value.fixtureDataset.audioRuntimeOutputFixtureLocalBundleReady, '1', 'fixture local bundle ready', failures);
    assertEqual(value.fixtureDataset.audioRuntimeOutputFixtureLocalBundleTemplateObservationCount, '53', 'fixture template observations', failures);
    assertEqual(value.fixtureDataset.audioRuntimeOutputFixtureLocalBundlePhaseTemplateObservationCount, '14', 'fixture phase template observations', failures);
    assertEqual(value.fixtureDataset.audioRuntimeOutputFixtureLocalBundleWriteTemplateObservationCount, '39', 'fixture write template observations', failures);
    assertEqual(value.fixtureDataset.audioRuntimeOutputFixtureLocalBundleRejectsRegisterValue, '1', 'fixture rejects registerValue', failures);
    assertEqual(value.fixtureDataset.audioRuntimeOutputFixtureLocalBundleRejectsPortValue, '1', 'fixture rejects portValue', failures);
    assertEqual(value.fixtureDataset.audioRuntimeOutputFixtureLocalBundleRejectsHash, '1', 'fixture rejects hash', failures);
    assertTruthy(value.fixtureResult.localBundleReadyForRuntimeHarness, 'fixture return local bundle ready', failures);
    assertTruthy(value.fixtureTextHasLocalBundle, 'fixture text has local bundle', failures);
    assertTruthy(value.fixtureTextHasTemplatePath, 'fixture text has template path', failures);
    assertTruthy(value.fixtureTextHasBundleTool, 'fixture text has bundle tool', failures);
    assertTruthy(value.recipeCount > 0, 'recipe count', failures);
    assertTruthy(value.selectedRecipeId, 'selected recipe with observation bundle', failures);
    assertTruthy(value.selectedTextHasLocalBundle, 'zone text has local observation bundle', failures);
    assertTruthy(value.selectedTextHasObservationPath, 'zone text has observation path', failures);
    assertTruthy(value.selectedTextHasBundleTool, 'zone text has bundle tool', failures);
    assertTruthy(value.bundle, 'selected bundle exists', failures);
    let downloadSummary = null;
    if (value.bundle) {
      assertEqual(value.bundle.eventKind, 'wb3_audio_runtime_output_observations', 'bundle event kind', failures);
      assertEqual(value.bundle.templateOnly, false, 'bundle templateOnly', failures);
      assertEqual(value.bundle.reviewStatus, 'unreviewed_runtime_observations', 'bundle reviewStatus', failures);
      assertEqual(value.bundle.forbiddenPayloadKeyCount, 0, 'bundle forbidden payload count', failures);
      assertEqual(value.bundle.missingFixtureObservationCount, 0, 'bundle missing fixture count', failures);
      assertEqual(value.bundle.readyForLocalBundle, true, 'bundle ready', failures);
      assertEqual(value.bundle.defaultInputPath, 'tmp/local-audio-output-observations.json', 'bundle default input path', failures);
      assertEqual(value.bundle.defaultBundleOutputPath, 'tmp/world-audio-runtime-output-events.local.json', 'bundle default output path', failures);
      assertEqual(value.bundle.persistedRegisterValueCount, 0, 'bundle persistedRegisterValueCount', failures);
      assertEqual(value.bundle.persistedRegisterTraceCount, 0, 'bundle persistedRegisterTraceCount', failures);
      assertEqual(value.bundle.persistedPortValueCount, 0, 'bundle persistedPortValueCount', failures);
      assertEqual(value.bundle.persistedSampleCount, 0, 'bundle persistedSampleCount', failures);
      assertEqual(value.bundle.persistedAudioByteCount, 0, 'bundle persistedAudioByteCount', failures);
      assertEqual(value.bundle.persistedRomByteCount, 0, 'bundle persistedRomByteCount', failures);
      assertEqual(value.bundle.forbiddenPathCount, 0, 'bundle forbidden paths', failures);
      assertEqual(value.bundle.observationForbiddenPathCount, 0, 'observation forbidden paths', failures);
      assertEqual(value.selectedDataset.zoneAudioPreviewRuntimeOutputLocalObservationReady, '1', 'zone dataset local observation ready', failures);
      assertEqual(value.selectedDataset.zoneAudioPreviewRuntimeOutputLocalObservationCount, value.bundle.observationCount, 'zone dataset observation count', failures);
      assertEqual(value.selectedDataset.zoneAudioPreviewRuntimeOutputLocalObservationPhaseCount, value.bundle.phaseObservationCount, 'zone dataset phase count', failures);
      assertEqual(value.selectedDataset.zoneAudioPreviewRuntimeOutputLocalObservationWriteCount, value.bundle.writeObservationCount, 'zone dataset write count', failures);
      assertEqual(value.selectedDataset.zoneAudioPreviewRuntimeOutputLocalObservationForbiddenPayloadKeyCount, '0', 'zone dataset forbidden count', failures);
      assertEqual(value.selectedDataset.zoneAudioPreviewRuntimeOutputLocalObservationDefaultInputPath, 'tmp/local-audio-output-observations.json', 'zone dataset input path', failures);
      assertEqual(value.exportButtonDisabled, false, 'export button enabled', failures);
      assertEqual(value.exportButtonDataset.zoneAudioObservationExportReady, '1', 'export button ready', failures);
      assertEqual(value.exportButtonDataset.zoneAudioObservationExportObservationCount, value.bundle.observationCount, 'export button observation count', failures);
      assertEqual(value.exportButtonDataset.zoneAudioObservationExportPhaseCount, value.bundle.phaseObservationCount, 'export button phase count', failures);
      assertEqual(value.exportButtonDataset.zoneAudioObservationExportWriteCount, value.bundle.writeObservationCount, 'export button write count', failures);
      assertEqual(value.exportButtonDataset.zoneAudioObservationExportForbiddenPayloadKeyCount, '0', 'export button forbidden count', failures);
      assertEqual(value.exportButtonDataset.zoneAudioObservationExportFileName, 'local-audio-output-observations.json', 'export button filename', failures);
      assertTruthy(value.exportInfoText.includes('export ready'), 'export info ready text', failures);
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.click('#btn-zone-audio-export-observations'),
        ]);
        const payload = await readDownloadJson(download);
        downloadSummary = {
          suggestedFilename: download.suggestedFilename(),
          eventKind: payload.eventKind,
          templateOnly: payload.templateOnly,
          reviewStatus: payload.reviewStatus,
          observationCount: payload.observations?.length || 0,
          summaryObservationCount: payload.summary?.observationCount || 0,
          browserExportedObservationCount: payload.summary?.browserExportedObservationCount || 0,
          phaseObservationCount: payload.summary?.phaseObservationCount || 0,
          writeObservationCount: payload.summary?.writeObservationCount || 0,
          forbiddenPayloadKeyCount: payload.summary?.forbiddenPayloadKeyCount || 0,
          missingFixtureObservationCount: payload.summary?.missingFixtureObservationCount || 0,
          forbiddenPathCount: forbiddenPaths(payload).length,
          hasEventsProperty: Object.prototype.hasOwnProperty.call(payload, 'events'),
          firstObservationKeys: Object.keys((payload.observations || [])[0] || {}).sort(),
        };
        assertEqual(downloadSummary.suggestedFilename, 'local-audio-output-observations.json', 'download filename', failures);
        assertEqual(downloadSummary.eventKind, 'wb3_audio_runtime_output_observations', 'download event kind', failures);
        assertEqual(downloadSummary.templateOnly, false, 'download templateOnly', failures);
        assertEqual(downloadSummary.reviewStatus, 'unreviewed_runtime_observations', 'download reviewStatus', failures);
        assertEqual(downloadSummary.observationCount, value.bundle.observationCount, 'download observation count', failures);
        assertEqual(downloadSummary.summaryObservationCount, value.bundle.observationCount, 'download summary observation count', failures);
        assertEqual(downloadSummary.browserExportedObservationCount, value.bundle.observationCount, 'download browser exported count', failures);
        assertEqual(downloadSummary.phaseObservationCount, value.bundle.phaseObservationCount, 'download phase count', failures);
        assertEqual(downloadSummary.writeObservationCount, value.bundle.writeObservationCount, 'download write count', failures);
        assertEqual(downloadSummary.forbiddenPayloadKeyCount, 0, 'download forbidden payload count', failures);
        assertEqual(downloadSummary.missingFixtureObservationCount, 0, 'download missing fixture count', failures);
        assertEqual(downloadSummary.forbiddenPathCount, 0, 'download forbidden paths', failures);
        assertEqual(downloadSummary.hasEventsProperty, false, 'download omits event stream property', failures);
      } catch (error) {
        failures.push(`download assertion failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.join('; ')}`);
    const blockingConsole = consoleMessages.filter(msg => !/favicon/i.test(msg.text));
    if (blockingConsole.length) failures.push(`console warnings/errors: ${JSON.stringify(blockingConsole)}`);

    console.log(JSON.stringify({
      ok: failures.length === 0,
      value,
      downloadSummary,
      failures,
      baseUrl,
    }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await stopPhpServer(server.proc);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
