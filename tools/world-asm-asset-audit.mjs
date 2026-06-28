#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';

const CALL_TARGETS = {
  _LABEL_8FB_: {
    reg: 'hl',
    type: 'vram_loader_8fb',
    kind: 'vram_loader_8fb_script',
    routine: '_LABEL_8FB_',
    summary: '8FB-format VRAM tile loader data passed from ASM call site',
    tags: ['asm-callsite', 'tile-loader', 'vram'],
  },
  _LABEL_998_: {
    reg: 'hl',
    type: 'vram_loader_998',
    kind: 'vram_loader_998_script',
    routine: '_LABEL_998_',
    summary: '998-format VRAM tile loader data passed from ASM call site',
    tags: ['asm-callsite', 'tile-loader', 'vram'],
  },
  _LABEL_604_: {
    reg: 'bc',
    type: 'screen_prog',
    kind: 'screen_prog_script',
    routine: '_LABEL_604_',
    summary: 'Screen/name-table bytecode passed from ASM call site',
    tags: ['asm-callsite', 'name-table', 'screen-prog'],
  },
  _LABEL_2620_: {
    reg: 'hl',
    type: 'room_seq_table',
    kind: 'room_sequence_descriptor',
    routine: '_LABEL_2620_',
    summary: 'Room/zone descriptor chain passed to the room loader',
    tags: ['asm-callsite', 'room-loader', 'zone-descriptor'],
  },
  _LABEL_34E2_: {
    reg: 'hl',
    type: 'tile_map',
    kind: 'tilemap_blit_source',
    routine: '_LABEL_34E2_',
    summary: 'Tilemap/name-table blit data passed to the UI tile blitter',
    tags: ['asm-callsite', 'tile-map', 'ui'],
  },
};

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function labelOffset(label) {
  const m = /^_(?:DATA|LABEL)_([0-9A-F]+)_$/i.exec(label || '');
  return m ? parseInt(m[1], 16) : null;
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findExactRegion(mapData, offset) {
  return mapData.regions.find(r => parseInt(r.offset, 16) === offset) || null;
}

function decodeVramLoader8fb(rom, offset) {
  const entries = [];
  let pc = offset;
  let curVramTile = 0;
  let curBank = 8;
  let curBlockIdx = 0;
  let totalTiles = 0;
  let maxVramTile = 0;
  let terminated = false;
  const warnings = [];
  for (let entryIndex = 0; entryIndex < 256 && pc < rom.length; entryIndex++) {
    const entryOffset = pc;
    const count = rom[pc++];
    if (count === 0) {
      terminated = true;
      break;
    }
    if (pc + 3 >= rom.length) {
      warnings.push(`entry ${entryIndex} truncated at ${hex(entryOffset)}`);
      break;
    }
    const vramLo = rom[pc++], vramHi = rom[pc++];
    const srcLo = rom[pc++], srcHi = rom[pc++];
    const vramWord = vramLo | (vramHi << 8);
    const srcWord = srcLo | (srcHi << 8);
    if (vramWord !== 0xFFFF) curVramTile = vramWord;
    if (srcWord !== 0xFFFF) {
      curBank = srcHi >> 1;
      curBlockIdx = ((srcHi & 1) << 8) | srcLo;
    }
    const sourceStart = curBank * 0x4000 + curBlockIdx * 32;
    const sourceEnd = sourceStart + count * 32 - 1;
    if (sourceEnd >= rom.length) warnings.push(`entry ${entryIndex} source exceeds ROM at ${hex(sourceStart)}-${hex(sourceEnd)}`);
    entries.push({
      entryIndex,
      entryOffset: hex(entryOffset),
      count,
      vramTileRange: { start: hex(curVramTile, 3), end: hex(curVramTile + count - 1, 3), count },
      source: { bank: curBank, block: hex(curBlockIdx, 3), romRange: [hex(sourceStart), hex(sourceEnd)] },
    });
    totalTiles += count;
    maxVramTile = Math.max(maxVramTile, curVramTile + count - 1);
    curVramTile += count;
    curBlockIdx += count;
  }
  return {
    format: '8fb',
    terminated,
    consumedBytes: pc - offset,
    entries: entries.length,
    totalTiles,
    maxVramTile: hex(maxVramTile, 3),
    sourceRanges: entries.map(e => e.source.romRange),
    warnings,
    entryPreview: entries.slice(0, 12),
  };
}

function decodeVramLoader998(rom, offset) {
  const ops = [];
  let pc = offset;
  let vramPtr = 0;
  let totalTiles = 0;
  let zeroTiles = 0;
  let maxVramTile = 0;
  let terminated = false;
  const warnings = [];
  for (let entryIndex = 0; entryIndex < 512 && pc < rom.length; entryIndex++) {
    const entryOffset = pc;
    let op = rom[pc++];
    if (op === 0) {
      terminated = true;
      break;
    }
    let count = op & 0x7F;
    if (op & 0x80) {
      if (pc >= rom.length) {
        warnings.push(`entry ${entryIndex} missing VRAM tile at ${hex(entryOffset)}`);
        break;
      }
      const tileSlot = rom[pc++];
      vramPtr = tileSlot * 32;
    }
    const tileStart = vramPtr >> 5;
    if (count === 0x7F) {
      ops.push({
        entryIndex,
        entryOffset: hex(entryOffset),
        kind: 'zero',
        count: 1,
        vramTileRange: { start: hex(tileStart, 3), end: hex(tileStart, 3), count: 1 },
      });
      zeroTiles++;
      totalTiles++;
      maxVramTile = Math.max(maxVramTile, tileStart);
      vramPtr += 32;
      continue;
    }
    if (count === 0) continue;
    if (pc + 1 >= rom.length) {
      warnings.push(`entry ${entryIndex} missing source word at ${hex(entryOffset)}`);
      break;
    }
    const srcLo = rom[pc++], srcHi = rom[pc++];
    const bank = srcHi >> 1;
    const blockIdx = ((srcHi & 1) << 8) | srcLo;
    const sourceStart = bank * 0x4000 + blockIdx * 32;
    const sourceEnd = sourceStart + count * 32 - 1;
    if (sourceEnd >= rom.length) warnings.push(`entry ${entryIndex} source exceeds ROM at ${hex(sourceStart)}-${hex(sourceEnd)}`);
    ops.push({
      entryIndex,
      entryOffset: hex(entryOffset),
      kind: 'copy',
      count,
      vramTileRange: { start: hex(tileStart, 3), end: hex(tileStart + count - 1, 3), count },
      source: { bank, block: hex(blockIdx, 3), romRange: [hex(sourceStart), hex(sourceEnd)] },
    });
    totalTiles += count;
    maxVramTile = Math.max(maxVramTile, tileStart + count - 1);
    vramPtr += count * 32;
  }
  return {
    format: '998',
    terminated,
    consumedBytes: pc - offset,
    ops: ops.length,
    totalTiles,
    zeroTiles,
    maxVramTile: hex(maxVramTile, 3),
    sourceRanges: ops.filter(o => o.source).map(o => o.source.romRange),
    warnings,
    opPreview: ops.slice(0, 12),
  };
}

function decodeFinding(rom, finding) {
  if (!rom) return null;
  if (finding.type === 'vram_loader_8fb') return decodeVramLoader8fb(rom, finding.offset);
  if (finding.type === 'vram_loader_998') return decodeVramLoader998(rom, finding.offset);
  return null;
}

function appendUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

function groupedFindings(findings) {
  const byLabelType = new Map();
  for (const finding of findings) {
    const key = `${finding.dataLabel}|${finding.type}`;
    const existing = byLabelType.get(key);
    if (!existing) {
      byLabelType.set(key, {
        ...finding,
        callSites: [...finding.callSites],
        callerRoutines: [...finding.callerRoutines],
        evidence: [...finding.evidence],
      });
      continue;
    }
    for (const site of finding.callSites) existing.callSites.push(site);
    for (const caller of finding.callerRoutines) appendUnique(existing.callerRoutines, caller);
    for (const evidence of finding.evidence) appendUnique(existing.evidence, evidence);
  }
  return [...byLabelType.values()].sort((a, b) => a.offset - b.offset || a.type.localeCompare(b.type));
}

function scanAsm(asmText) {
  const lines = asmText.split(/\r?\n/);
  const findings = [];
  let currentRoutine = '';
  const recentLoads = { hl: [], bc: [], de: [] };

  function recordFinding(target, load, lineIndex, verb) {
    const def = CALL_TARGETS[target];
    const offset = labelOffset(load.dataLabel);
    if (offset == null) return;
    findings.push({
      dataLabel: load.dataLabel,
      offset,
      type: def.type,
      kind: def.kind,
      confidence: 'high',
      routine: def.routine,
      summary: def.summary,
      tags: [...def.tags],
      callerRoutines: currentRoutine ? [currentRoutine] : [],
      callSites: [{
        line: lineIndex + 1,
        caller: currentRoutine || '',
        instruction: `${verb} ${target}`,
        loadedRegister: def.reg.toUpperCase(),
        loadedAtLine: load.line,
        expression: load.expression,
      }],
      evidence: [
        `ASM line ${load.line}: ld ${def.reg}, ${load.expression}`,
        `ASM line ${lineIndex + 1}: ${verb} ${target}`,
      ],
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const code = cleanCode(raw);
    const labelMatch = /^(_LABEL_[0-9A-F]+_|_DATA_[0-9A-F]+_):/i.exec(code);
    if (labelMatch && /^_LABEL_/i.test(labelMatch[1])) {
      currentRoutine = labelMatch[1];
      recentLoads.hl = [];
      recentLoads.bc = [];
      recentLoads.de = [];
      continue;
    }

    const loadMatch = /\bld\s+(hl|bc|de),\s*((_DATA_[0-9A-F]+_)(?:\s*[-+]\s*(?:\$[0-9A-F]+|\d+))?)/i.exec(code);
    if (loadMatch) {
      const reg = loadMatch[1].toLowerCase();
      recentLoads[reg].push({
        dataLabel: loadMatch[3],
        expression: loadMatch[2].replace(/\s+/g, ' '),
        line: i + 1,
      });
    } else {
      const clobber = /\bld\s+(hl|bc|de),/i.exec(code);
      if (clobber) recentLoads[clobber[1].toLowerCase()] = [];
    }

    const callMatch = /\b(call|jp)\s+(_LABEL_[0-9A-F]+_)\b/i.exec(code);
    if (!callMatch) continue;
    const verb = callMatch[1].toLowerCase();
    const target = callMatch[2].toUpperCase();
    const def = CALL_TARGETS[target];
    if (!def) continue;
    const loads = recentLoads[def.reg].filter(load => i + 1 - load.line <= 24);
    for (const load of loads) recordFinding(target, load, i, verb);
    recentLoads[def.reg] = [];
  }

  // _LABEL_5EB_ indexes the room screen-program pointer table before calling _LABEL_604_.
  findings.push({
    dataLabel: '_DATA_1CCC0_',
    offset: 0x1CCC0,
    type: 'pointer_table',
    kind: 'room_screen_prog_pointer_table',
    confidence: 'high',
    routine: '_LABEL_5EB_',
    summary: '31-entry room screen-program pointer table indexed by _LABEL_5EB_ before _LABEL_604_',
    tags: ['asm-callsite', 'pointer-table', 'room-loader', 'screen-prog'],
    callerRoutines: ['_LABEL_5EB_'],
    callSites: [{
      line: 1740,
      caller: '_LABEL_5EB_',
      instruction: 'ld hl, _DATA_1CCC0_ ... call _LABEL_604_',
      loadedRegister: 'HL',
      loadedAtLine: 1740,
      expression: '_DATA_1CCC0_',
    }],
    evidence: [
      'ASM _LABEL_5EB_: ld hl, _DATA_1CCC0_; add hl, de; rst $10; ld c,e; ld b,d; call _LABEL_604_.',
      'REVERSE_ENGINEERING.md documents _DATA_1CCC0_ as 31 word pointers to bank-7 screen_prog streams.',
    ],
  });

  return groupedFindings(findings);
}

function shouldChangeType(region, finding) {
  const current = region.type || 'unknown';
  if (current === finding.type) return false;
  if (!['unknown', 'screen_prog', 'vram_loader_8fb', 'vram_loader_998'].includes(current)) return false;

  if (finding.type === 'vram_loader_8fb' || finding.type === 'vram_loader_998') return (region.size || 0) <= 512;
  if (finding.type === 'screen_prog') return current === 'unknown' && (region.size || 0) <= 1024;
  if (finding.type === 'tile_map') return (region.size || 0) <= 256;
  if (finding.type === 'room_seq_table') return (region.size || 0) <= 64;
  if (finding.type === 'pointer_table') return current === 'unknown' || current === 'screen_prog';
  return false;
}

function updateRegion(region, finding, rom) {
  const previousType = region.type || 'unknown';
  const changedType = shouldChangeType(region, finding);
  if (changedType) region.type = finding.type;
  if (finding.type === 'vram_loader_8fb' || finding.type === 'vram_loader_998') {
    region.params = region.params || {};
    const format = finding.type === 'vram_loader_8fb' ? '8fb' : '998';
    region.params.format = format;
    region.params.loaderFormat = format;
  }
  region.analysis = region.analysis || {};
  const existingAudit = region.analysis.asmAssetAudit || {};
  const typeBeforeAudit = existingAudit.typeBeforeAudit || previousType;
  const decoded = decodeFinding(rom, finding);
  region.analysis.asmAssetAudit = {
    kind: finding.kind,
    summary: finding.summary,
    confidence: finding.confidence,
    tags: finding.tags,
    typeBeforeAudit,
    typeAfterAudit: region.type,
    changedType: existingAudit.changedType || typeBeforeAudit !== region.type,
    sourceLabel: finding.dataLabel,
    sourceOffset: hex(finding.offset),
    relations: {
      loaderRoutine: finding.routine,
      callerRoutines: finding.callerRoutines,
    },
    callSites: finding.callSites,
    decoded,
    evidence: finding.evidence,
    generatedAt: now,
    tool: 'tools/world-asm-asset-audit.mjs',
  };
  return region.analysis.asmAssetAudit.changedType;
}

function main() {
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const mapData = readJson(mapPath);
  const rom = fs.existsSync(romPath) ? fs.readFileSync(romPath) : null;
  const findings = scanAsm(asmText);
  const matched = [];
  const unmatched = [];
  const changed = [];
  const evidenceOnly = [];

  for (const finding of findings) {
    const region = findExactRegion(mapData, finding.offset);
    if (!region) {
      unmatched.push(finding);
      continue;
    }
    matched.push({ finding, region });
    if (apply) {
      const changedType = updateRegion(region, finding, rom);
      const item = {
        id: region.id,
        offset: region.offset,
        name: region.name || finding.dataLabel,
        sourceLabel: finding.dataLabel,
        previousType: region.analysis.asmAssetAudit.typeBeforeAudit,
        type: region.type,
        routine: finding.routine,
      };
      (changedType ? changed : evidenceOnly).push(item);
    } else {
      const wouldChange = shouldChangeType(region, finding);
      const item = {
        id: region.id,
        offset: region.offset,
        name: region.name || finding.dataLabel,
        sourceLabel: finding.dataLabel,
        currentType: region.type || 'unknown',
        inferredType: finding.type,
        routine: finding.routine,
      };
      (wouldChange ? changed : evidenceOnly).push(item);
    }
  }

  if (apply) {
    const reportId = 'asm-asset-callsite-audit-2026-06-24';
    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'asm_asset_callsite_audit',
      generatedAt: now,
      tool: 'tools/world-asm-asset-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        asmPath: 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm',
        romAvailableForDecode: !!rom,
        findings: findings.length,
        matchedRegions: matched.length,
        unmatchedFindings: unmatched.length,
        changedRegionTypes: changed.length,
        evidenceOnlyRegions: evidenceOnly.length,
        decodedLoaderFindings: matched.filter(({ finding }) => finding.type === 'vram_loader_8fb' || finding.type === 'vram_loader_998').length,
        assetPolicy: 'Offsets, labels, call-site evidence, and metadata only; no ROM bytes or decoded assets embedded.',
      },
      changedRegions: changed,
      evidenceOnlyRegions: evidenceOnly,
      unmatchedFindings: unmatched.map(f => ({
        sourceLabel: f.dataLabel,
        offset: hex(f.offset),
        inferredType: f.type,
        routine: f.routine,
        callSites: f.callSites,
      })),
      nextLeads: [
        'Split large room/zone data blocks such as _DATA_10C96_ before assigning one narrow type to every byte in the containing region.',
        'Run structural decoders over each asmAssetAudit loader region to record consumed byte counts and VRAM/source ranges.',
        'Extend call-site recognition to music/SFX driver tables and metasprite animation tables once their dispatcher routines are confirmed.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  const summary = {
    applied: apply,
    findings: findings.length,
    matchedRegions: matched.length,
    unmatchedFindings: unmatched.length,
    changedRegionTypes: changed.length,
    evidenceOnlyRegions: evidenceOnly.length,
    changedRegions: changed,
    evidenceOnlyRegionsSample: evidenceOnly.slice(0, 20),
    unmatchedFindings: unmatched.map(f => ({
      sourceLabel: f.dataLabel,
      offset: hex(f.offset),
      inferredType: f.type,
      routine: f.routine,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
