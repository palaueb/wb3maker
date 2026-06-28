#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const opcodeDataDir = path.join(repoRoot, 'tools/z80-opcodes/data');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-entity-c3c0-behavior-target-semantics-catalog-2026-06-25';
const reportId = 'entity-c3c0-behavior-target-semantics-audit-2026-06-25';
const toolName = 'tools/world-entity-c3c0-behavior-target-semantics-audit.mjs';
const targetCatalogId = 'world-entity-c3c0-motion-seed-target-link-catalog-2026-06-25';
const helperCatalogId = 'world-entity-motion-collision-helper-catalog-2026-06-25';
const animationCatalogId = 'world-animation-callsite-catalog-2026-06-25';
const structCatalogId = 'world-entity-runtime-struct-field-catalog-2026-06-25';

const relativeJrOpcodes = new Set([0x10, 0x18, 0x20, 0x28, 0x30, 0x38]);
const callOpcodes = new Set([0xC4, 0xCC, 0xCD, 0xD4, 0xDC, 0xE4, 0xEC, 0xF4, 0xFC]);
const jumpOpcodes = new Set([0xC2, 0xC3, 0xCA, 0xD2, 0xDA, 0xE2, 0xEA, 0xF2, 0xFA]);
const retOpcodes = new Set([0xC0, 0xC8, 0xC9, 0xD0, 0xD8, 0xE0, 0xE8, 0xF0, 0xF8]);

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return typeof region?.offset === 'number' ? region.offset : parseInt(region?.offset || '0', 16);
}

function regionBounds(region) {
  const start = offsetOf(region);
  return { start, end: start + (region?.size || 0) };
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
  }) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function findCatalog(mapData, id) {
  for (const [key, value] of Object.entries(mapData)) {
    if (!Array.isArray(value) || !/catalog/i.test(key)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))].sort();
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function parseMaybeHex(text) {
  if (typeof text === 'number') return text;
  const match = /^0x([0-9A-F]+)$/i.exec(String(text || ''));
  return match ? parseInt(match[1], 16) : null;
}

function signedByte(value) {
  return value & 0x80 ? value - 0x100 : value;
}

function indexOpcodesById(entries) {
  return new Map(entries.map(entry => [String(entry.id || '').toLowerCase(), entry]));
}

function loadOpcodeTables() {
  const tables = {};
  for (const name of ['base', 'cb', 'ed', 'dd', 'fd', 'ddcb', 'fdcb']) {
    tables[name] = indexOpcodesById(readJson(path.join(opcodeDataDir, `${name}.json`)));
  }
  return tables;
}

function opcodeEntry(tables, group, opcodeByte) {
  const key = group === 'base'
    ? opcodeByte.toString(16).toUpperCase().padStart(2, '0').toLowerCase()
    : `${group}${opcodeByte.toString(16).padStart(2, '0')}`;
  return tables[group]?.get(key) || null;
}

function instructionSize(entry, fallback) {
  const size = parseInt(String(entry?.siz || ''), 10);
  return Number.isFinite(size) && size > 0 ? size : fallback;
}

function indexDisplacementToken(register, displacement) {
  const signed = signedByte(displacement);
  if (signed >= 0) return `${register}+${signed}`;
  return `${register}${signed}`;
}

function indexAccessForOpcode(opcode, cbOpcode = null) {
  if (cbOpcode != null) {
    if (cbOpcode >= 0x40 && cbOpcode <= 0x7F) return 'read';
    return 'read_write';
  }
  if (opcode === 0x34 || opcode === 0x35) return 'read_write';
  if (opcode === 0x36 || (opcode >= 0x70 && opcode <= 0x75) || opcode === 0x77) return 'write';
  if ([0x46, 0x4E, 0x56, 0x5E, 0x66, 0x6E, 0x7E, 0x86, 0x8E, 0x96, 0x9E, 0xA6, 0xAE, 0xB6, 0xBE].includes(opcode)) return 'read';
  return 'access';
}

function decodeInstruction(rom, tables, pc, end) {
  const opcode = rom[pc];
  const truncated = pc >= rom.length;
  if (truncated) return { offset: pc, size: 1, group: 'truncated', opcode, mnemonic: 'truncated', truncated: true };

  if (opcode === 0xDD || opcode === 0xFD) {
    const register = opcode === 0xDD ? 'IX' : 'IY';
    const group = opcode === 0xDD ? 'dd' : 'fd';
    const cbGroup = opcode === 0xDD ? 'ddcb' : 'fdcb';
    const next = rom[pc + 1];
    if (next === 0xCB) {
      const op = rom[pc + 3];
      const entry = opcodeEntry(tables, cbGroup, op);
      const displacement = rom[pc + 2];
      return {
        offset: pc,
        size: 4,
        group: cbGroup,
        opcode: op,
        mnemonic: entry?.mnemonic || `${register} CB`,
        indexedRef: {
          register,
          offset: signedByte(displacement),
          token: indexDisplacementToken(register, displacement),
          access: indexAccessForOpcode(next, op),
        },
        truncated: pc + 3 >= end || pc + 3 >= rom.length,
      };
    }
    const entry = opcodeEntry(tables, group, next);
    const size = instructionSize(entry, 2);
    const opcodeText = String(entry?.opcode || '');
    const hasDisplacement = /\bd\b/i.test(opcodeText);
    const indexedRef = hasDisplacement && pc + 2 < rom.length
      ? {
          register,
          offset: signedByte(rom[pc + 2]),
          token: indexDisplacementToken(register, rom[pc + 2]),
          access: indexAccessForOpcode(next),
        }
      : null;
    return {
      offset: pc,
      size,
      group,
      opcode: next,
      mnemonic: entry?.mnemonic || `${register} prefix`,
      indexedRef,
      immediateWriteToIndexedField: indexedRef && next === 0x36,
      truncated: pc + size > end || pc + size > rom.length,
    };
  }

  if (opcode === 0xCB || opcode === 0xED) {
    const group = opcode === 0xCB ? 'cb' : 'ed';
    const next = rom[pc + 1];
    const entry = opcodeEntry(tables, group, next);
    const size = instructionSize(entry, 2);
    return {
      offset: pc,
      size,
      group,
      opcode: next,
      mnemonic: entry?.mnemonic || `${group.toUpperCase()} prefix`,
      ret: opcode === 0xED && (next === 0x45 || next === 0x4D),
      truncated: pc + size > end || pc + size > rom.length,
    };
  }

  const entry = opcodeEntry(tables, 'base', opcode);
  const size = instructionSize(entry, 1);
  const instruction = {
    offset: pc,
    size,
    group: 'base',
    opcode,
    mnemonic: entry?.mnemonic || 'unknown',
    truncated: pc + size > end || pc + size > rom.length,
  };
  if ((callOpcodes.has(opcode) || jumpOpcodes.has(opcode)) && pc + 2 < rom.length) {
    const target = rom[pc + 1] | (rom[pc + 2] << 8);
    instruction.absoluteTarget = target;
    instruction.controlKind = callOpcodes.has(opcode) ? 'call' : 'jump';
    instruction.conditional = opcode !== 0xCD && opcode !== 0xC3;
  }
  if (relativeJrOpcodes.has(opcode) && pc + 1 < rom.length) {
    instruction.relativeTarget = pc + size + signedByte(rom[pc + 1]);
    instruction.controlKind = opcode === 0x10 ? 'djnz' : 'relative_jump';
    instruction.conditional = opcode !== 0x18;
  }
  if (retOpcodes.has(opcode)) {
    instruction.ret = true;
    instruction.conditional = opcode !== 0xC9;
  }
  return instruction;
}

function buildAsmLabelIndex(asmText, mapData) {
  const byOffset = new Map();
  const lines = asmText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_(?:LABEL|DATA)_([0-9A-F]+)_):/.exec(lines[i]);
    if (!match) continue;
    const offset = parseInt(match[2], 16);
    if (!byOffset.has(offset)) byOffset.set(offset, { label: match[1], asmLine: i + 1 });
  }
  for (const region of mapData.regions || []) {
    const offset = offsetOf(region);
    if (byOffset.has(offset)) continue;
    const nameMatch = /^_(?:LABEL|DATA)_[0-9A-F]+_$/.exec(region.name || '');
    if (nameMatch) byOffset.set(offset, { label: region.name, asmLine: null });
  }
  return byOffset;
}

function buildHelperIndex(helperCatalog, animationCatalog) {
  const helpers = new Map();
  for (const helper of helperCatalog?.helpers || []) {
    helpers.set(parseMaybeHex(helper.offset), {
      label: helper.label,
      role: helper.role,
      category: helper.category,
      sourceCatalog: helperCatalog.id,
    });
  }
  for (const target of animationCatalog?.callTargets || []) {
    const offset = parseMaybeHex(target.label?.replace(/^_LABEL_([0-9A-F]+)_$/i, '0x$1'));
    if (offset == null) continue;
    helpers.set(offset, {
      label: target.label,
      role: target.role,
      category: 'animation',
      sourceCatalog: animationCatalog.id,
    });
  }
  return helpers;
}

function structFieldIndex(mapData) {
  const catalog = findCatalog(mapData, structCatalogId);
  const fields = new Map();
  for (const field of catalog?.fields || []) {
    fields.set(`${field.register}+${field.offset}`, field);
  }
  return fields;
}

function collectTargetRefs(targetCatalog) {
  const refs = [];
  for (const seed of targetCatalog.seedTargetLinks || []) {
    for (const source of seed.sourceLinks || []) {
      for (const entry of source.entries || []) {
        const targetOffset = parseMaybeHex(entry.romOffset);
        if (targetOffset == null) continue;
        refs.push({
          seedLabel: seed.seedLabel,
          seedOffset: seed.seedOffset,
          sourceExpression: source.sourceExpression,
          behaviorTableLabel: source.behaviorTable?.label || source.sourceExpression || '',
          behaviorTableRole: source.behaviorTable?.role || '',
          behaviorTableEntryIndex: entry.index,
          entryOffset: entry.entryOffset,
          targetOffset,
          targetRegion: entry.targetRegion || null,
        });
      }
    }
  }
  return refs;
}

function groupedTargetOffsetsByRegion(refs, mapData) {
  const byRegion = new Map();
  for (const ref of refs) {
    const region = findContainingRegion(mapData, ref.targetOffset);
    if (!region) continue;
    if (!byRegion.has(region.id)) byRegion.set(region.id, { region, offsets: new Set() });
    byRegion.get(region.id).offsets.add(ref.targetOffset);
  }
  return byRegion;
}

function segmentEndForTarget(ref, targetOffsets, mapData) {
  const region = findContainingRegion(mapData, ref.targetOffset);
  if (!region) return ref.targetOffset;
  const next = targetOffsets.find(offset => offset > ref.targetOffset);
  const bounds = regionBounds(region);
  return next || bounds.end;
}

function targetWithinSegment(target, start, end) {
  return target >= start && target < end;
}

function scanSegment(rom, tables, start, end, labelIndex, helperIndex, fieldIndex) {
  const calls = [];
  const jumps = [];
  const relativeBranches = [];
  const returns = [];
  const indexedRefs = [];
  const warnings = [];
  const queue = [start];
  const visited = new Set();
  const reachedBytes = new Set();
  let instructionCount = 0;
  let truncatedCount = 0;
  let pathCount = 0;

  function queueTarget(target) {
    if (!targetWithinSegment(target, start, end)) return false;
    if (!visited.has(target) && !queue.includes(target)) queue.push(target);
    return true;
  }

  while (queue.length) {
    let pc = queue.shift();
    pathCount += 1;
    while (pc < end && pc < rom.length && !visited.has(pc)) {
      const inst = decodeInstruction(rom, tables, pc, end);
      visited.add(pc);
      instructionCount += 1;
      for (let offset = pc; offset < Math.min(pc + Math.max(inst.size, 1), end); offset++) {
        reachedBytes.add(offset);
      }
      if (inst.truncated) truncatedCount += 1;

      if (inst.absoluteTarget != null) {
        const targetMeta = labelIndex.get(inst.absoluteTarget) || {};
        const helper = helperIndex.get(inst.absoluteTarget) || null;
        const ref = {
          offset: hex(inst.offset),
          kind: inst.controlKind,
          conditional: Boolean(inst.conditional),
          targetOffset: hex(inst.absoluteTarget),
          targetLabel: helper?.label || targetMeta.label || '',
          targetRole: helper?.role || '',
          targetCategory: helper?.category || '',
          sourceCatalog: helper?.sourceCatalog || '',
          targetInSegment: targetWithinSegment(inst.absoluteTarget, start, end),
        };
        if (inst.controlKind === 'call') calls.push(ref);
        else jumps.push(ref);
      }

      if (inst.relativeTarget != null) {
        relativeBranches.push({
          offset: hex(inst.offset),
          kind: inst.controlKind,
          conditional: Boolean(inst.conditional),
          targetOffset: hex(inst.relativeTarget),
          inSegment: targetWithinSegment(inst.relativeTarget, start, end),
        });
      }

      if (inst.ret) {
        returns.push({
          offset: hex(inst.offset),
          conditional: Boolean(inst.conditional),
        });
      }

      if (inst.indexedRef) {
        const known = fieldIndex.get(inst.indexedRef.token) || null;
        indexedRefs.push({
          offset: hex(inst.offset),
          register: inst.indexedRef.register,
          fieldOffset: inst.indexedRef.offset,
          token: inst.indexedRef.token,
          access: inst.indexedRef.access,
          knownRole: known?.role || null,
          knownFieldGroup: known?.fieldGroup || null,
          immediateWrite: Boolean(inst.immediateWriteToIndexedField),
        });
      }

      if (inst.size <= 0) {
        warnings.push(`zero-sized decode at ${hex(pc)}`);
        break;
      }

      const nextPc = pc + inst.size;
      if (inst.truncated) {
        warnings.push(`reachable instruction crossed segment boundary ${hex(end)} at ${hex(pc)}`);
        break;
      }

      if (inst.ret && !inst.conditional) break;

      if (inst.controlKind === 'jump') {
        const inSegment = queueTarget(inst.absoluteTarget);
        if (!inst.conditional) {
          if (!inSegment) warnings.push(`unconditional jump leaves segment at ${hex(pc)} -> ${hex(inst.absoluteTarget)}`);
          break;
        }
      }

      if (inst.controlKind === 'relative_jump' || inst.controlKind === 'djnz') {
        const inSegment = queueTarget(inst.relativeTarget);
        if (!inst.conditional) {
          if (!inSegment) warnings.push(`unconditional relative jump leaves segment at ${hex(pc)} -> ${hex(inst.relativeTarget)}`);
          break;
        }
      }

      pc = nextPc;
    }
  }

  return {
    scanMode: 'bounded_control_flow',
    instructionCount,
    pathCount,
    truncatedInstructionCount: truncatedCount,
    reachableByteCount: reachedBytes.size,
    unreachedSegmentByteCount: Math.max(0, end - start - reachedBytes.size),
    calls,
    jumps,
    relativeBranches,
    returns,
    indexedRefs,
    warnings,
  };
}

function compactRefs(refs) {
  return refs.slice(0, 16).map(ref => ({
    seedLabel: ref.seedLabel,
    sourceExpression: ref.sourceExpression,
    behaviorTableLabel: ref.behaviorTableLabel,
    behaviorTableEntryIndex: ref.behaviorTableEntryIndex,
    entryOffset: ref.entryOffset,
  }));
}

function uniqueObjects(items, keyFn) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function semanticTagsForScan(scan) {
  const callLabels = new Set(scan.calls.map(call => call.targetLabel));
  const tags = [];
  if (callLabels.has('_LABEL_1B4B_') || callLabels.has('_LABEL_1B25_') || callLabels.has('_LABEL_1B22_')) tags.push('packed_motion_delta_consumer');
  if (callLabels.has('_LABEL_12D5_') || callLabels.has('_LABEL_12D8_') || callLabels.has('_LABEL_12F8_')) tags.push('velocity_integrator');
  if (callLabels.has('_LABEL_17AB_') || callLabels.has('_LABEL_17FE_')) tags.push('collision_pipeline');
  if ([...callLabels].some(label => ['_LABEL_1D76_', '_LABEL_1DAB_', '_LABEL_1E02_', '_LABEL_1E4E_', '_LABEL_1E9F_', '_LABEL_1EBB_'].includes(label))) tags.push('contact_handler');
  if (callLabels.has('_LABEL_1318_')) tags.push('animation_start');
  if (callLabels.has('_LABEL_1330_')) tags.push('animation_tick');
  if (scan.indexedRefs.some(ref => ref.token === 'IX+32' && ref.access !== 'read')) tags.push('behavior_state_write');
  if (scan.indexedRefs.some(ref => ref.token === 'IX+33' && ref.access !== 'read')) tags.push('timer_counter_write');
  if (scan.indexedRefs.some(ref => ref.token === 'IX+30' || ref.token === 'IX+31')) tags.push('motion_delta_field_direct_access');
  return unique(tags);
}

function buildTarget(mapData, rom, tables, labelIndex, helperIndex, fieldIndex, targetOffset, refs, targetOffsets) {
  const region = findContainingRegion(mapData, targetOffset);
  const representative = { targetOffset };
  const end = segmentEndForTarget(representative, targetOffsets, mapData);
  const scan = scanSegment(rom, tables, targetOffset, end, labelIndex, helperIndex, fieldIndex);
  const semanticTags = semanticTagsForScan(scan);
  const helperCalls = uniqueObjects(
    scan.calls.filter(call => call.targetRole || call.targetCategory),
    call => `${call.targetLabel}:${call.targetRole}`
  );
  return {
    targetOffset: hex(targetOffset),
    targetRegion: regionRef(region),
    segment: {
      start: hex(targetOffset),
      endExclusive: hex(end),
      sizeBytes: Math.max(0, end - targetOffset),
      boundarySource: 'next_c3c0_behavior_target_or_start_region_end',
    },
    referenceCount: refs.length,
    seedLabels: unique(refs.map(ref => ref.seedLabel)),
    behaviorTableLabels: unique(refs.map(ref => ref.behaviorTableLabel)),
    sourceExpressions: unique(refs.map(ref => ref.sourceExpression)),
    references: compactRefs(refs),
    scan: {
      scanMode: scan.scanMode,
      instructionCount: scan.instructionCount,
      pathCount: scan.pathCount,
      reachableByteCount: scan.reachableByteCount,
      unreachedSegmentByteCount: scan.unreachedSegmentByteCount,
      truncatedInstructionCount: scan.truncatedInstructionCount,
      callCount: scan.calls.length,
      jumpCount: scan.jumps.length,
      relativeBranchCount: scan.relativeBranches.length,
      returnCount: scan.returns.length,
      indexedFieldReferenceCount: scan.indexedRefs.length,
      warnings: scan.warnings,
    },
    helperCalls,
    callTargets: uniqueObjects(scan.calls, call => `${call.kind}:${call.targetOffset}:${call.targetLabel}:${call.targetRole}`).slice(0, 24),
    jumpTargets: uniqueObjects(scan.jumps, jump => `${jump.kind}:${jump.targetOffset}:${jump.targetLabel}`).slice(0, 16),
    indexedFieldTokens: unique(scan.indexedRefs.map(ref => ref.token)),
    indexedFieldRefs: uniqueObjects(scan.indexedRefs, ref => `${ref.token}:${ref.access}:${ref.knownRole || ''}:${ref.immediateWrite}`).slice(0, 24),
    semanticTags,
    confidence: scan.truncatedInstructionCount || scan.warnings.length ? 'medium' : 'high',
    persistedRomByteCount: 0,
    persistedGameplayValueCount: 0,
    evidence: [
      `${targetCatalogId} links this target to ${refs.length} C3C0 behavior-table entr${refs.length === 1 ? 'y' : 'ies'}.`,
      `ROM-local opcode scan from ${hex(targetOffset)} to ${hex(end)} recorded calls, jumps, IX/IY field refs, and helper labels without persisting instruction bytes.`,
      helperCalls.length
        ? `Known helper calls include ${helperCalls.slice(0, 4).map(call => call.targetLabel || call.targetRole).join(', ')}.`
        : 'No known helper call target was found in this bounded target scan.',
    ],
  };
}

function buildRegionGroups(targets) {
  const byRegion = new Map();
  for (const target of targets) {
    const key = target.targetRegion?.id || 'missing';
    if (!byRegion.has(key)) byRegion.set(key, []);
    byRegion.get(key).push(target);
  }
  return [...byRegion.entries()].map(([regionId, grouped]) => {
    const targetRegion = grouped.find(item => item.targetRegion)?.targetRegion || null;
    const helperCalls = uniqueObjects(grouped.flatMap(item => item.helperCalls), call => `${call.targetLabel}:${call.targetRole}`);
    const semanticTags = unique(grouped.flatMap(item => item.semanticTags));
    return {
      regionId,
      targetRegion,
      targetCount: grouped.length,
      targetOffsets: grouped.map(item => item.targetOffset).sort(),
      referenceCount: grouped.reduce((sum, item) => sum + item.referenceCount, 0),
      seedLabels: unique(grouped.flatMap(item => item.seedLabels)),
      behaviorTableLabels: unique(grouped.flatMap(item => item.behaviorTableLabels)),
      helperCallCount: helperCalls.length,
      helperCalls,
      semanticTags,
      indexedFieldTokens: unique(grouped.flatMap(item => item.indexedFieldTokens)),
      confidence: grouped.some(item => item.confidence !== 'high') ? 'medium' : 'high',
      persistedRomByteCount: 0,
      persistedGameplayValueCount: 0,
      evidence: [
        `${grouped.length} unique C3C0 behavior target offset(s) in this mapped region were scanned.`,
        helperCalls.length
          ? `Known helper calls in this region include ${helperCalls.slice(0, 5).map(call => call.targetLabel || call.targetRole).join(', ')}.`
          : 'No known helper calls were found in the bounded target scans for this region.',
      ],
    };
  }).sort((a, b) => parseMaybeHex(a.targetRegion?.offset) - parseMaybeHex(b.targetRegion?.offset));
}

function buildCatalog(mapData) {
  const rom = fs.readFileSync(romPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const targetCatalog = requireCatalog(mapData, targetCatalogId);
  const helperCatalog = requireCatalog(mapData, helperCatalogId);
  const animationCatalog = requireCatalog(mapData, animationCatalogId);
  const tables = loadOpcodeTables();
  const labelIndex = buildAsmLabelIndex(asmText, mapData);
  const helperIndex = buildHelperIndex(helperCatalog, animationCatalog);
  const fieldIndex = structFieldIndex(mapData);
  const refs = collectTargetRefs(targetCatalog);
  const byTarget = new Map();
  for (const ref of refs) {
    if (!byTarget.has(ref.targetOffset)) byTarget.set(ref.targetOffset, []);
    byTarget.get(ref.targetOffset).push(ref);
  }
  const targetOffsetIndex = groupedTargetOffsetsByRegion(refs, mapData);
  const targetOffsets = [...byTarget.keys()].sort((a, b) => a - b);
  const targets = [...byTarget.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([targetOffset, groupedRefs]) => buildTarget(mapData, rom, tables, labelIndex, helperIndex, fieldIndex, targetOffset, groupedRefs, targetOffsets));
  const regionGroups = buildRegionGroups(targets);
  const helperCalls = targets.flatMap(target => target.helperCalls);
  const allTags = targets.flatMap(target => target.semanticTags);
  const allIndexedRefs = targets.flatMap(target => target.indexedFieldRefs);
  const targetsWithKnownHelpers = targets.filter(target => target.helperCalls.length > 0);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [targetCatalogId, helperCatalogId, animationCatalogId, structCatalogId],
    summary: {
      sourceTargetEntryCount: refs.length,
      uniqueTargetOffsetCount: targets.length,
      targetRegionCount: regionGroups.filter(group => group.targetRegion).length,
      targetsWithKnownHelperCalls: targetsWithKnownHelpers.length,
      targetsWithPackedMotionDeltaConsumer: targets.filter(target => target.semanticTags.includes('packed_motion_delta_consumer')).length,
      targetsWithVelocityIntegrator: targets.filter(target => target.semanticTags.includes('velocity_integrator')).length,
      targetsWithCollisionPipeline: targets.filter(target => target.semanticTags.includes('collision_pipeline')).length,
      targetsWithContactHandler: targets.filter(target => target.semanticTags.includes('contact_handler')).length,
      targetsWithAnimationTick: targets.filter(target => target.semanticTags.includes('animation_tick')).length,
      targetsWithBehaviorStateWrite: targets.filter(target => target.semanticTags.includes('behavior_state_write')).length,
      helperCallCount: helperCalls.length,
      helperCallLabelCounts: countBy(helperCalls, call => call.targetLabel || call.targetRole || 'unknown_helper'),
      semanticTagCounts: countBy(allTags, tag => tag),
      indexedFieldTokenCounts: countBy(allIndexedRefs, ref => ref.token),
      warningTargetCount: targets.filter(target => target.scan.warnings.length > 0 || target.scan.truncatedInstructionCount > 0).length,
      persistedRomByteCount: 0,
      persistedGameplayValueCount: 0,
      assetPolicy: 'Metadata only: target offsets, region refs, bounded scan counts, call labels, helper roles, IX/IY field tokens, semantic tags, and evidence. No ROM bytes, decoded assets, instruction byte streams, or gameplay constants are embedded.',
    },
    targets,
    regionGroups,
    evidence: [
      `${targetCatalogId} supplies C3C0 seed-to-behavior target references.`,
      `${helperCatalogId} and ${animationCatalogId} supply known helper labels and roles used to classify target calls.`,
      'The scan uses local ROM bytes only to advance through opcode sizes and detect metadata relationships; no bytes or scalar operands are persisted.',
    ],
    nextLeads: [
      'Trace the control-flow inside high-reference target 0x06F88 to split first-tick setup from steady-state update behavior.',
      'Name C3C0 actor classes by joining these behavior semantics to room entity type usage and dynamic frame asset families.',
      'Add a frame-step emulator for one target family that applies IX+30/IX+31, velocity integration, collision response, and animation ticks without consulting original Z80 code.',
    ],
  };
}

function annotateRegion(region, group) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.c3c0BehaviorTargetSemanticsAudit = {
    catalogId,
    kind: 'c3c0_behavior_target_region_semantics',
    confidence: group.confidence,
    targetCount: group.targetCount,
    referenceCount: group.referenceCount,
    seedLabels: group.seedLabels,
    behaviorTableLabels: group.behaviorTableLabels,
    helperCallCount: group.helperCallCount,
    helperCalls: group.helperCalls,
    semanticTags: group.semanticTags,
    indexedFieldTokens: group.indexedFieldTokens,
    persistedGameplayValueCount: 0,
    summary: `${group.targetCount} C3C0 behavior target offset(s) in this region are classified by bounded scan metadata; ${group.helperCallCount} known helper call kind(s) found.`,
    evidence: group.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    targetCount: group.targetCount,
    referenceCount: group.referenceCount,
    helperCallCount: group.helperCallCount,
    semanticTags: group.semanticTags,
    confidence: group.confidence,
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityBehaviorCodeCatalogs = (mapData.entityBehaviorCodeCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityBehaviorCodeCatalogs.push(catalog);
  const annotatedRegions = [];
  for (const group of catalog.regionGroups || []) {
    const offset = parseMaybeHex(group.targetRegion?.offset);
    const region = offset == null ? null : findContainingRegion(mapData, offset);
    const annotated = annotateRegion(region, group);
    if (annotated) annotatedRegions.push(annotated);
  }
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_c3c0_behavior_target_semantics_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotatedRegions.length,
    },
    annotatedRegions,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
  fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  return { annotatedRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const applied = apply ? applyCatalog(mapData, catalog) : { annotatedRegions: [] };
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: applied.annotatedRegions.length,
    },
    regionGroups: catalog.regionGroups.map(group => ({
      region: group.targetRegion,
      targetCount: group.targetCount,
      referenceCount: group.referenceCount,
      helperCallCount: group.helperCallCount,
      semanticTags: group.semanticTags,
      confidence: group.confidence,
    })),
    warningTargets: catalog.targets.filter(target => target.scan.warnings.length > 0 || target.scan.truncatedInstructionCount > 0).map(target => ({
      targetOffset: target.targetOffset,
      warnings: target.scan.warnings,
      truncatedInstructionCount: target.scan.truncatedInstructionCount,
    })),
  }, null, 2));
}

main();
