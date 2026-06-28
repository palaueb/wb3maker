#!/usr/bin/env node
'use strict';

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');

function usage(exitCode = 1) {
  const out = exitCode === 0 ? console.log : console.error;
  out('Usage: node tools/world-apply-audits-serial.mjs tools/world-foo-audit.mjs [tools/world-bar-audit.mjs ...]');
  process.exit(exitCode);
}

function validateMap() {
  JSON.parse(fs.readFileSync(mapPath, 'utf8'));
}

function normalizeScript(arg) {
  const fullPath = path.resolve(repoRoot, arg);
  const relative = path.relative(repoRoot, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing script outside repository: ${arg}`);
  }
  if (!relative.startsWith(`tools${path.sep}world-`) || !relative.endsWith('.mjs')) {
    throw new Error(`Expected a tools/world-*.mjs audit script, got: ${arg}`);
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Script does not exist: ${arg}`);
  }
  return { fullPath, relative };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) usage(0);
  if (!args.length) usage(1);

  validateMap();
  const scripts = args.map(normalizeScript);
  const results = [];

  for (const script of scripts) {
    const run = spawnSync(process.execPath, [script.fullPath, '--apply'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (run.stdout) process.stdout.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
    if (run.status !== 0) {
      throw new Error(`${script.relative} failed with exit code ${run.status}`);
    }

    validateMap();
    results.push({
      script: script.relative,
      applied: true,
      mapValidated: true,
    });
  }

  console.log(JSON.stringify({
    appliedScriptCount: results.length,
    mapPath: path.relative(repoRoot, mapPath),
    results,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
