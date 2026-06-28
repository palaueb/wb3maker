#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const gearsystemDir = path.join(repoRoot, 'gearsystem/Gearsystem-3.9.10-desktop-ubuntu24.04-x64');
const binaryPath = path.join(gearsystemDir, 'gearsystem');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const symbolPath = path.join(repoRoot, 'gearsystem/wb3-world.sym');
const localSdlRuntimeDir = path.join(repoRoot, 'gearsystem/sdl3-runtime/lib');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function fail(message, extra = {}) {
  console.error(JSON.stringify({ ok: false, error: message, ...extra }, null, 2));
  process.exit(1);
}

function runtimeEnv(extra = {}) {
  const libraryPaths = [localSdlRuntimeDir, process.env.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(':');
  return {
    ...process.env,
    LD_LIBRARY_PATH: libraryPaths,
    SDL_AUDIODRIVER: process.env.SDL_AUDIODRIVER || 'dummy',
    GEARSYSTEM_MCP_HTTP_TOKEN: process.env.GEARSYSTEM_MCP_HTTP_TOKEN || '',
    ...extra,
  };
}

function checkReady() {
  if (!fs.existsSync(binaryPath)) fail('Gearsystem binary not found', { binary: path.relative(repoRoot, binaryPath) });
  if (!fs.existsSync(romPath)) fail('WORLD ROM not found', { rom: path.relative(repoRoot, romPath) });
  if (!fs.existsSync(symbolPath)) {
    fail('Gearsystem symbol file not found; run node tools/world-gearsystem-symbols.mjs first', {
      symbol: path.relative(repoRoot, symbolPath),
    });
  }
  const ldd = spawnSync('ldd', [binaryPath], { encoding: 'utf8', env: runtimeEnv() });
  const dependencyText = `${ldd.stdout || ''}\n${ldd.stderr || ''}`;
  if (dependencyText.includes('libSDL3.so.0 => not found')) {
    fail('Gearsystem cannot start because libSDL3.so.0 is missing. Install libsdl3-0 or provide SDL3 before launching.', {
      binary: path.relative(repoRoot, binaryPath),
      dependency: 'libSDL3.so.0',
      localSdlRuntimeDir: path.relative(repoRoot, localSdlRuntimeDir),
      nextCommandAfterInstall: 'node tools/world-gearsystem-launch.mjs --port 7777',
    });
  }
}

function main() {
  checkReady();
  const port = argValue('--port') || '7777';
  const address = argValue('--address') || '127.0.0.1';
  const stdio = hasArg('--stdio');
  const gui = hasArg('--gui');
  const args = [];
  if (!gui) args.push('--headless');
  if (stdio) args.push('--mcp-stdio');
  else args.push('--mcp-http', '--mcp-http-address', address, '--mcp-http-port', port);
  args.push(romPath, symbolPath);

  const child = spawn(binaryPath, args, {
    cwd: gearsystemDir,
    stdio: 'inherit',
    env: runtimeEnv(),
  });
  child.on('exit', code => process.exit(code ?? 0));
  child.on('error', error => {
    if (String(error.message || '').includes('libSDL3')) {
      fail('Gearsystem failed to start because libSDL3.so.0 is missing. Install libsdl3-0 or build/vendor SDL3 before launching.', {
        command: `node tools/world-gearsystem-launch.mjs --port ${port}`,
      });
    }
    fail(error.message);
  });
}

main();
