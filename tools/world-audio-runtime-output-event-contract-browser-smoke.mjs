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
const startPort = Number(process.env.WB3_SMOKE_PORT || 8280);
const maxPort = startPort + 30;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function assertEqual(actual, expected, label, failures) {
  if (String(actual) !== String(expected)) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

function assertTruthy(value, label, failures) {
  if (!value) failures.push(`${label}: expected truthy value`);
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
      typeof window.audioRuntimeOutputFixtureRenderPreview === 'function' &&
      document.getElementById('audio-runtime-output-fixture-preview') &&
      document.getElementById('audio-runtime-output-fixture-info')
    );

    const value = await page.evaluate(async () => {
      window.mapData = await fetch('/projects/WORLD/map.json').then(r => r.json());
      const result = window.audioRuntimeOutputFixtureRenderPreview();
      const out = document.getElementById('audio-runtime-output-fixture-preview');
      const info = document.getElementById('audio-runtime-output-fixture-info');
      const d = out.dataset;
      return {
        info: info.textContent,
        catalogBacked: d.audioRuntimeOutputFixtureCatalogBacked,
        eventContractCatalogBacked: d.audioRuntimeOutputFixtureEventContractCatalogBacked,
        previewOk: d.audioRuntimeOutputFixturePreviewOk,
        phaseCount: d.audioRuntimeOutputFixturePhaseCount,
        writeCount: d.audioRuntimeOutputFixtureWriteCount,
        eventContractRequiredKeyCount: d.audioRuntimeOutputFixtureEventContractRequiredKeyCount,
        eventContractOptionalKeyCount: d.audioRuntimeOutputFixtureEventContractOptionalKeyCount,
        eventContractForbiddenPayloadKeyCount: d.audioRuntimeOutputFixtureEventContractForbiddenPayloadKeyCount,
        eventContractDerivedModelCount: d.audioRuntimeOutputFixtureEventContractDerivedModelCount,
        eventContractValidationIssueCount: d.audioRuntimeOutputFixtureEventContractValidationIssueCount,
        eventContractReadyForRuntimeHarness: d.audioRuntimeOutputFixtureEventContractReadyForRuntimeHarness,
        textHasEventContract: out.textContent.includes('Runtime output event contract'),
        textHasRequiredKeys: out.textContent.includes('required keys kind, phaseFixtureId'),
        textHasChannelPortIntent: out.textContent.includes('runtime_output_channel_port_intent'),
        textHasNoValuesPolicy: out.textContent.includes('Register values, samples, stream bytes, and ROM bytes are not displayed or saved.'),
        returnEventContractReady: result.eventContractReadyForRuntimeHarness,
        returnEventContractDerivedModelCount: result.eventContractDerivedModelCount,
      };
    });

    const failures = [];
    assertEqual(value.catalogBacked, '1', 'catalogBacked', failures);
    assertEqual(value.eventContractCatalogBacked, '1', 'eventContractCatalogBacked', failures);
    assertEqual(value.previewOk, '1', 'previewOk', failures);
    assertEqual(value.phaseCount, '14', 'phaseCount', failures);
    assertEqual(value.writeCount, '39', 'writeCount', failures);
    assertEqual(value.eventContractRequiredKeyCount, '25', 'eventContractRequiredKeyCount', failures);
    assertEqual(value.eventContractOptionalKeyCount, '4', 'eventContractOptionalKeyCount', failures);
    assertEqual(value.eventContractForbiddenPayloadKeyCount, '21', 'eventContractForbiddenPayloadKeyCount', failures);
    assertEqual(value.eventContractDerivedModelCount, '5', 'eventContractDerivedModelCount', failures);
    assertEqual(value.eventContractValidationIssueCount, '0', 'eventContractValidationIssueCount', failures);
    assertEqual(value.eventContractReadyForRuntimeHarness, '1', 'eventContractReadyForRuntimeHarness', failures);
    assertTruthy(value.textHasEventContract, 'textHasEventContract', failures);
    assertTruthy(value.textHasRequiredKeys, 'textHasRequiredKeys', failures);
    assertTruthy(value.textHasChannelPortIntent, 'textHasChannelPortIntent', failures);
    assertTruthy(value.textHasNoValuesPolicy, 'textHasNoValuesPolicy', failures);
    assertTruthy(value.returnEventContractReady, 'returnEventContractReady', failures);
    assertEqual(value.returnEventContractDerivedModelCount, 5, 'returnEventContractDerivedModelCount', failures);
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.join('; ')}`);
    const blockingConsole = consoleMessages.filter(msg => !/favicon/i.test(msg.text));
    if (blockingConsole.length) failures.push(`console warnings/errors: ${JSON.stringify(blockingConsole)}`);

    console.log(JSON.stringify({
      ok: failures.length === 0,
      value,
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
