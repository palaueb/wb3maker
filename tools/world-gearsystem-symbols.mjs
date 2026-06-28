#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const defaultOutputPath = path.join(repoRoot, 'gearsystem/wb3-world.sym');
const defaultManifestPath = path.join(repoRoot, 'gearsystem/wb3-world-symbols.manifest.json');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
}

function hex(value, width) {
  return Number(value).toString(16).toUpperCase().padStart(width, '0');
}

function romOffsetForLabel(label) {
  const match = label.match(/^_(?:LABEL|DATA)_([0-9A-F]+)_$/i);
  if (!match) return null;
  return Number.parseInt(match[1], 16);
}

function gearsystemLogicalAddress(offset) {
  if (offset < 0x4000) return offset;
  return 0x8000 + (offset % 0x4000);
}

function parseAsmLabels(text) {
  const labels = [];
  const seen = new Set();
  text.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^(_(?:LABEL|DATA)_[0-9A-F]+_):/i);
    if (!match) return;
    const label = match[1];
    const offset = romOffsetForLabel(label);
    if (offset == null || !Number.isFinite(offset) || offset < 0 || offset >= 0x40000) return;
    const key = `${offset}:${label}`;
    if (seen.has(key)) return;
    seen.add(key);
    labels.push({
      label,
      offset,
      bank: Math.floor(offset / 0x4000),
      bankOffset: offset % 0x4000,
      logicalAddress: gearsystemLogicalAddress(offset),
      asmLine: index + 1,
      kind: label.startsWith('_LABEL_') ? 'code_or_mixed_label' : 'data_label',
    });
  });
  return labels.sort((a, b) => a.offset - b.offset || a.label.localeCompare(b.label));
}

function buildSymbolText(labels) {
  return labels.map(item => `${hex(item.bank, 2)}:${hex(item.logicalAddress, 4)} ${item.label}`).join('\n') + '\n';
}

function buildManifest(labels, outputPath) {
  const byBank = labels.reduce((counts, item) => {
    const key = `0x${hex(item.bank, 2)}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  return {
    schemaVersion: 1,
    generatedAt: '2026-06-26T00:00:00Z',
    tool: 'tools/world-gearsystem-symbols.mjs',
    sourceAsm: 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm',
    outputSymbolPath: path.relative(repoRoot, outputPath),
    symbolFormat: 'Gearsystem .sym metadata: BANK:LOGICAL_ADDRESS LABEL',
    mappingRule: 'ROM offsets below 0x4000 keep their fixed logical address; banked ROM offsets use 0x8000 + (offset % 0x4000), matching banked labels such as ROM 0x10718 -> bank 0x04 logical 0x8718.',
    summary: {
      symbolCount: labels.length,
      bankCount: Object.keys(byBank).length,
      symbolsByBank: byBank,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    residualSymbols: labels
      .filter(item => ['_DATA_10718_', '_DATA_1CBB9_', '_DATA_1CBC0_', '_DATA_1CBD0_', '_DATA_1E337_', '_LABEL_10BC_', '_LABEL_1E200_', '_LABEL_26F4_'].includes(item.label))
      .map(item => ({
        label: item.label,
        offset: `0x${hex(item.offset, 5)}`,
        bank: `0x${hex(item.bank, 2)}`,
        logicalAddress: `0x${hex(item.logicalAddress, 4)}`,
        asmLine: item.asmLine,
      })),
    assetPolicy: 'Metadata only: label names, ROM offsets, banks, logical addresses, line numbers, and counts. No ROM bytes, decoded assets, instruction bytes, screenshots, audio data, or register traces are written.',
  };
}

function main() {
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const manifestPath = resolveRepoPath(argValue('--manifest')) || defaultManifestPath;
  const labels = parseAsmLabels(fs.readFileSync(asmPath, 'utf8'));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buildSymbolText(labels));
  fs.writeFileSync(manifestPath, `${JSON.stringify(buildManifest(labels, outputPath), null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    output: path.relative(repoRoot, outputPath),
    manifest: path.relative(repoRoot, manifestPath),
    symbolCount: labels.length,
    persistedRomByteCount: 0,
    persistedInstructionByteCount: 0,
  }, null, 2));
}

main();
