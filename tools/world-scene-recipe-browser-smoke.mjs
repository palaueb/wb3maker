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
const startPort = Number(process.env.WB3_SMOKE_PORT || 8181);
const maxPort = startPort + 30;

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
    // Process shutdown is best effort; the smoke result has already been decided.
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
      typeof window.simLoadRecipe === 'function' &&
      typeof window.simRunAll === 'function' &&
      document.getElementById('sim-canvas') &&
      document.getElementById('sim-info')
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
      Array.isArray(window.mapData.sceneRecipes) &&
      window.mapData.sceneRecipes.length > 0
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

    const results = await page.evaluate(() => {
      const recipes = window.mapData.sceneRecipes || [];
      const out = [];
      for (let index = 0; index < recipes.length; index++) {
        const recipe = recipes[index];
        window.simLoadRecipe(index);
        window.simRunAll();

        const summary = window.simLastProvenanceSummary || {
          usedSlots: [],
          unresolvedSlots: [],
          copySlots: [],
          zeroSlots: [],
          importedSlots: [],
          sourceCounts: [],
        };
        const canvas = document.getElementById('sim-canvas');
        const infoEl = document.getElementById('sim-info');
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

        out.push({
          index,
          id: recipe.id || '',
          name: recipe.name || '',
          stepCount: (recipe.steps || []).length,
          provenance: {
            usedSlots: summary.usedSlots.length,
            resolvedSlots: summary.usedSlots.length - summary.unresolvedSlots.length,
            unresolvedSlots: summary.unresolvedSlots.length,
            copySlots: summary.copySlots.length,
            zeroSlots: summary.zeroSlots.length,
            importedSlots: summary.importedSlots.length,
            sourceGroupCount: summary.sourceCounts.length,
          },
          canvas: canvasStats,
          infoDataset: { ...(infoEl?.dataset || {}) },
        });
      }
      return out;
    });

    const failures = [];
    if (!results.length) failures.push('No scene recipes were available to render.');
    for (const result of results) {
      if (!result.stepCount) failures.push(`${result.id || result.index}: recipe has no steps`);
      if (!result.provenance.usedSlots) failures.push(`${result.id || result.index}: no name-table tile slots were used`);
      if (result.provenance.unresolvedSlots) failures.push(`${result.id || result.index}: ${result.provenance.unresolvedSlots} unresolved tile slot(s)`);
      if (!result.canvas.width || !result.canvas.height) failures.push(`${result.id || result.index}: canvas was not sized`);
      if (!result.canvas.nonBlackPixels) failures.push(`${result.id || result.index}: rendered canvas has no non-black pixels`);
      if (result.canvas.distinctColorCount < 2) failures.push(`${result.id || result.index}: rendered canvas has fewer than two distinct colors`);
    }
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

    const report = {
      ok: failures.length === 0,
      project: projectName,
      url: `${baseUrl}/tools/rom-analyzer.html`,
      recipeCount: results.length,
      mapFieldIntegrity,
      results,
      browserPageErrors: pageErrors,
      browserConsoleMessages: consoleMessages.slice(0, 20),
      serverOutput: server.output,
      failures,
    };
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
