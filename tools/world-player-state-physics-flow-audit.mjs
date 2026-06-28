#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-player-state-physics-flow-catalog-2026-06-25';
const reportId = 'player-state-physics-flow-audit-2026-06-25';
const toolName = 'tools/world-player-state-physics-flow-audit.mjs';

const sourceCatalogIds = {
  playerState: 'world-player-state-catalog-2026-06-24',
  playerRuntime: 'world-player-runtime-routine-catalog-2026-06-25',
  physicsEffects: 'world-player-physics-state-effect-catalog-2026-06-25',
};

const FLOW_DEFS = [
  {
    flowId: 'inner_state_0_damage_knockback',
    stateSlot: 0,
    primaryLabel: '_LABEL_4B31_',
    componentLabels: ['_LABEL_4B31_', '_LABEL_4B9D_', '_LABEL_4BD7_'],
    summary: 'Damage/knockback setup and active update path selected by inner player state slot 0.',
  },
  {
    flowId: 'inner_state_1_idle_grounded',
    stateSlot: 1,
    primaryLabel: '_LABEL_50F3_',
    componentLabels: ['_LABEL_50F3_'],
    summary: 'Grounded idle/update state that runs collision, damping, contact acceleration, then dispatches from input/contact flags.',
  },
  {
    flowId: 'inner_state_2_directional_grounded',
    stateSlot: 2,
    primaryLabel: '_LABEL_5170_',
    componentLabels: ['_LABEL_5170_'],
    summary: 'Grounded directional movement state that seeds motion parameter _RAM_C25E_ and runs acceleration/contact handling.',
  },
  {
    flowId: 'inner_state_3_jump_shared',
    stateSlot: 3,
    primaryLabel: '_LABEL_51FB_',
    componentLabels: ['_LABEL_51FB_'],
    summary: 'Shared jump/fall state that seeds _RAM_C24A_, runs collision/contact handling, and switches between damping and directional acceleration while airborne.',
  },
  {
    flowId: 'inner_state_3_vector_jump',
    stateSlot: 3,
    primaryLabel: '_LABEL_54CB_',
    componentLabels: ['_LABEL_54CB_', '_LABEL_5515_'],
    summary: 'Form-specific vector jump state that seeds _RAM_C248_ or _RAM_C24A_ from _DATA_55C1_ and uses the vector-probe update continuation.',
  },
  {
    flowId: 'inner_state_4_action_or_attack',
    stateSlot: 4,
    primaryLabel: '_LABEL_52D8_',
    componentLabels: ['_LABEL_52D8_'],
    summary: 'Action/attack-like state that runs collision and damping, then gates transitions from environment flags, contact, and input bit 1.',
  },
  {
    flowId: 'inner_state_5_airborne_control',
    stateSlot: 5,
    primaryLabel: '_LABEL_4EBD_',
    componentLabels: ['_LABEL_4EBD_', '_LABEL_4F0E_', '_LABEL_4F9B_'],
    summary: 'Airborne/control state with first-entry setup, active collision/movement update, tile-interaction probe, and contact flag maintenance.',
  },
  {
    flowId: 'inner_state_6_vector_transition',
    stateSlot: 6,
    primaryLabel: '_LABEL_5611_',
    componentLabels: ['_LABEL_5611_', '_LABEL_5650_'],
    summary: 'Vector transition state that selects _DATA_5674_ motion parameters and then runs the shared vector update tail.',
  },
  {
    flowId: 'inner_state_7_room_transition',
    stateSlot: 7,
    primaryLabel: '_LABEL_4C32_',
    componentLabels: ['_LABEL_4C32_'],
    summary: 'Room-transition state handler; included here to show it has no direct physics-effect call chain in the inner-state table.',
  },
  {
    flowId: 'inner_state_8_extra_vector_a',
    stateSlot: 8,
    primaryLabel: '_LABEL_4FAB_',
    componentLabels: ['_LABEL_4FAB_'],
    summary: 'Extra state-8 path for outer dispatchers 0/1; runs collision, tile probe, damping, contact acceleration, and input-driven transitions.',
  },
  {
    flowId: 'inner_state_8_extra_vector_b',
    stateSlot: 8,
    primaryLabel: '_LABEL_533C_',
    componentLabels: ['_LABEL_533C_'],
    summary: 'Extra state-8 path for outer dispatcher 3; seeds vertical/vector motion and selects damping or directional acceleration while airborne.',
  },
  {
    flowId: 'inner_state_8_extra_vector_c',
    stateSlot: 8,
    primaryLabel: '_LABEL_540A_',
    componentLabels: ['_LABEL_540A_'],
    summary: 'Extra state-8 path for outer dispatcher 5; similar to state-8 vector B with a different environment-flag transition gate.',
  },
  {
    flowId: 'inner_state_8_vector_extra',
    stateSlot: 8,
    primaryLabel: '_LABEL_5684_',
    componentLabels: ['_LABEL_5684_'],
    summary: 'Vector extra state that runs collision, tile probe, vector substate dispatch, and returns to state 6 on input or timeout.',
  },
  {
    flowId: 'inner_state_9_vector_restore',
    stateSlot: 9,
    primaryLabel: '_LABEL_55C9_',
    componentLabels: ['_LABEL_55C9_', '_LABEL_5650_'],
    summary: 'Vector restore state that reloads saved coordinates, clears motion words, then runs the shared vector update tail.',
  },
  {
    flowId: 'vector_substate_0_probe',
    stateSlot: null,
    primaryLabel: '_LABEL_21C4_',
    componentLabels: ['_LABEL_21C4_'],
    summary: 'Vector substate 0 selected by _RAM_C271_; recorded as a sub-flow because state 6/8/9 reach it through _LABEL_21B6_.',
  },
  {
    flowId: 'vector_substate_1_probe',
    stateSlot: null,
    primaryLabel: '_LABEL_2207_',
    componentLabels: ['_LABEL_2207_'],
    summary: 'Vector substate 1 selected by _RAM_C271_; recorded as a sub-flow because state 6/8/9 reach it through _LABEL_21B6_.',
  },
  {
    flowId: 'vector_substate_2_probe',
    stateSlot: null,
    primaryLabel: '_LABEL_2248_',
    componentLabels: ['_LABEL_2248_'],
    summary: 'Vector substate 2 selected by _RAM_C271_; recorded as a sub-flow because state 6/8/9 reach it through _LABEL_21B6_.',
  },
  {
    flowId: 'vector_substate_3_probe',
    stateSlot: null,
    primaryLabel: '_LABEL_228C_',
    componentLabels: ['_LABEL_228C_'],
    summary: 'Vector substate 3 selected by _RAM_C271_; recorded as a sub-flow because state 6/8/9 reach it through _LABEL_21B6_.',
  },
];

const importantRamLabels = new Set([
  '_RAM_C240_',
  '_RAM_C241_',
  '_RAM_C243_',
  '_RAM_C246_',
  '_RAM_C248_',
  '_RAM_C24A_',
  '_RAM_C24F_',
  '_RAM_C250_',
  '_RAM_C251_',
  '_RAM_C25E_',
  '_RAM_C25F_',
  '_RAM_C260_',
  '_RAM_C261_',
  '_RAM_C271_',
  '_RAM_C272_',
  '_RAM_C273_',
  '_RAM_C275_',
  '_RAM_C27D_',
  '_RAM_CF8B_',
  '_RAM_CF95_',
  '_RAM_D024_',
  '_RAM_D279_',
]);

const motionRamLabels = new Set(['_RAM_C248_', '_RAM_C24A_', '_RAM_C25E_', '_RAM_C25F_']);

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeAddress(address) {
  return String(address || '').toUpperCase().replace(/^0X/, '$');
}

function ramLabelToAddress(label) {
  const match = /^_RAM_([0-9A-F]+)_$/i.exec(label || '');
  return match ? `$${match[1].toUpperCase()}` : null;
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function regionBounds(region) {
  const start = offsetOf(region);
  return { start, end: start + (region.size || 0) };
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

function findRamEntry(mapData, addressOrLabel) {
  const address = addressOrLabel.startsWith('_RAM_') ? ramLabelToAddress(addressOrLabel) : addressOrLabel;
  const normalized = normalizeAddress(address);
  return (mapData.ram || []).find(entry => normalizeAddress(entry.address) === normalized) || null;
}

function findCatalog(mapData, id) {
  const buckets = [
    ...(mapData.playerCatalogs || []),
    ...(mapData.playerRuntimeCatalogs || []),
    ...(mapData.audioCatalogs || []),
    ...(mapData.analysisCatalogs || []),
  ];
  return buckets.find(catalog => catalog.id === id) || null;
}

function buildAsmIndex(asmText) {
  const lines = asmText.split(/\r?\n/);
  const labelLines = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_(?:LABEL|DATA)_[0-9A-F]+_):/.exec(lines[i]);
    if (match) labelLines.set(match[1], i + 1);
  }
  return { lines, labelLines };
}

function scanLabelBlock(asmIndex, label) {
  const startLine = asmIndex.labelLines.get(label);
  if (!startLine) return null;
  const startIndex = startLine - 1;
  const body = [];
  for (let i = startIndex + 1; i < asmIndex.lines.length; i++) {
    if (/^_(?:LABEL|DATA)_[0-9A-F]+_:/.test(asmIndex.lines[i])) break;
    const code = cleanCode(asmIndex.lines[i]);
    if (code) body.push({ line: i + 1, code });
  }
  return {
    startLine,
    endLine: body.length ? body[body.length - 1].line : startLine,
    body,
  };
}

function effectRef(effect) {
  return {
    label: effect.label,
    role: effect.role,
    category: effect.category,
    confidence: effect.confidence,
  };
}

function componentRole(label, stateRoutineByLabel, runtimeEntryByLabel, effectByLabel) {
  const stateRoutine = stateRoutineByLabel.get(label);
  const runtimeEntry = runtimeEntryByLabel.get(label);
  const effect = effectByLabel.get(label);
  return {
    role: stateRoutine?.role || runtimeEntry?.role || effect?.role || 'unclassified_player_flow_component',
    summary: stateRoutine?.summary || runtimeEntry?.summary || effect?.routineSummary || '',
    sourceCatalog: stateRoutine ? sourceCatalogIds.playerState : runtimeEntry ? sourceCatalogIds.playerRuntime : effect ? sourceCatalogIds.physicsEffects : null,
  };
}

function inferRegisterValueBefore(body, index, register) {
  const target = register.toLowerCase();
  for (let j = index - 1; j >= 0 && j >= index - 10; j--) {
    const code = body[j].code;
    const line = body[j].line;
    if (target === 'a') {
      const literal = /^ld\s+a,\s*\$([0-9A-F]+)$/i.exec(code);
      if (literal) return { kind: 'literal', value: `$${literal[1].toUpperCase()}`, line };
      if (/^xor\s+a$/i.test(code)) return { kind: 'literal', value: '$00', line };
      const ram = /^ld\s+a,\s*\((_RAM_[0-9A-F]+_)\)$/i.exec(code);
      if (ram) return { kind: 'ram', source: ram[1], line };
      const struct = /^ld\s+a,\s*\(ix\+(\d+)\)$/i.exec(code);
      if (struct) return { kind: 'struct', source: `IX+${struct[1]}`, line };
      const reg = /^ld\s+a,\s*([bcdehl])$/i.exec(code);
      if (reg) return { kind: 'register', source: reg[1].toLowerCase(), line };
      if (/^set\s+7,\s*a$/i.test(code)) {
        const base = inferRegisterValueBefore(body, j, 'a');
        return {
          kind: 'expression',
          value: `${base?.value || base?.source || 'A'} | $80`,
          line,
          sourceLine: base?.line || null,
        };
      }
    }
    const literal = new RegExp(`^ld\\s+${target},\\s*\\$([0-9A-F]+)$`, 'i').exec(code);
    if (literal) return { kind: 'literal', value: `$${literal[1].toUpperCase()}`, line };
    const ram = new RegExp(`^ld\\s+${target},\\s*\\((_RAM_[0-9A-F]+_)\\)$`, 'i').exec(code);
    if (ram) return { kind: 'ram', source: ram[1], line };
    if (target === 'hl') {
      const zero = /^ld\s+hl,\s*\$0000$/i.exec(code);
      if (zero) return { kind: 'literal', value: '$0000', line };
    }
  }
  return { kind: 'unknown', source: register.toUpperCase(), line: null };
}

function accessModeForRamLine(code, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\bld\\s+\\(${escaped}\\),`, 'i').test(code)) return 'write';
  if (new RegExp(`\\b(?:inc|dec)\\s+\\(${escaped}\\)`, 'i').test(code)) return 'read_write';
  return 'read';
}

function parseCalls(body, effectByLabel) {
  const calls = [];
  let sequenceIndex = 0;
  for (const item of body) {
    const match = /\b(call|jp|jr)\s+(_LABEL_[0-9A-F]+_)/i.exec(item.code);
    if (!match) continue;
    const label = match[2];
    const effect = effectByLabel.get(label);
    calls.push({
      line: item.line,
      op: match[1].toLowerCase(),
      label,
      sequenceIndex: sequenceIndex++,
      isPhysicsEffect: Boolean(effect),
      effect: effect ? effectRef(effect) : null,
    });
  }
  return calls;
}

function parseDataRefs(body) {
  const refs = [];
  for (const item of body) {
    const re = /_DATA_[0-9A-F]+_/gi;
    let match;
    while ((match = re.exec(item.code)) !== null) {
      refs.push({ line: item.line, label: match[0] });
    }
  }
  return refs;
}

function parseRamAccesses(body) {
  const accesses = [];
  for (let i = 0; i < body.length; i++) {
    const item = body[i];
    const ramRe = /_RAM_[0-9A-F]+_/gi;
    let match;
    const labelsSeen = new Set();
    while ((match = ramRe.exec(item.code)) !== null) {
      const label = match[0];
      if (labelsSeen.has(label)) continue;
      labelsSeen.add(label);
      const access = accessModeForRamLine(item.code, label);
      const address = ramLabelToAddress(label);
      const writeMatch = new RegExp(`\\bld\\s+\\(${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\),\\s*([a-z]{1,2}|\\$[0-9A-F]+)`, 'i').exec(item.code);
      const sourceRegister = writeMatch?.[1]?.toLowerCase() || null;
      const inferredSource = sourceRegister && /^[a-z]{1,2}$/i.test(sourceRegister)
        ? inferRegisterValueBefore(body, i, sourceRegister)
        : sourceRegister
          ? { kind: 'literal', value: sourceRegister.toUpperCase(), line: item.line }
          : null;
      accesses.push({
        line: item.line,
        label,
        address,
        access,
        important: importantRamLabels.has(label),
        sourceRegister,
        sourceValue: inferredSource,
      });
    }
  }
  return accesses;
}

function parseStructAccesses(body) {
  const accesses = [];
  for (let i = 0; i < body.length; i++) {
    const item = body[i];
    let match = /\b(bit|set|res)\s+(\d+),\s*\(ix\+(\d+)\)/i.exec(item.code);
    if (match) {
      accesses.push({
        line: item.line,
        op: match[1].toLowerCase(),
        bit: Number(match[2]),
        offset: Number(match[3]),
        access: match[1].toLowerCase() === 'bit' ? 'read_bit' : 'write_bit',
      });
      continue;
    }
    match = /\bld\s+\(ix\+(\d+)\),\s*([^,\s]+)/i.exec(item.code);
    if (match) {
      accesses.push({
        line: item.line,
        op: 'ld',
        bit: null,
        offset: Number(match[1]),
        access: 'write',
        value: match[2].toUpperCase(),
      });
    }
  }
  return accesses;
}

function parseTransitions(ramAccesses) {
  return ramAccesses
    .filter(access => access.label === '_RAM_C260_' && ['write', 'read_write'].includes(access.access))
    .map(access => ({
      line: access.line,
      targetRam: access.label,
      targetAddress: access.address,
      sourceRegister: access.sourceRegister,
      sourceValue: access.sourceValue,
      literalTarget: access.sourceValue?.kind === 'literal' ? access.sourceValue.value : null,
      entryFlagWrite: access.sourceValue?.kind === 'expression' && String(access.sourceValue.value || '').includes('| $80'),
    }));
}

function parseMotionWrites(ramAccesses) {
  return ramAccesses
    .filter(access => motionRamLabels.has(access.label) && ['write', 'read_write'].includes(access.access))
    .map(access => ({
      line: access.line,
      label: access.label,
      address: access.address,
      sourceRegister: access.sourceRegister,
      sourceValue: access.sourceValue,
    }));
}

function summarizeReads(ramAccesses, structAccesses) {
  return {
    inputReads: ramAccesses.filter(access => access.label === '_RAM_D279_' && access.access !== 'write').map(access => access.line),
    environmentFlagReads: ramAccesses.filter(access => access.label === '_RAM_CF95_' && access.access !== 'write').map(access => access.line),
    formStateReads: ramAccesses.filter(access => ['_RAM_C24F_', '_RAM_C241_'].includes(access.label) && access.access !== 'write').map(access => ({ line: access.line, label: access.label })),
    contactFlagReads: structAccesses.filter(access => access.offset === 27 && access.access === 'read_bit').map(access => ({ line: access.line, bit: access.bit })),
    entryFlagReads: structAccesses.filter(access => access.offset === 1 && access.access === 'read_bit').map(access => ({ line: access.line, bit: access.bit })),
  };
}

function buildComponent(mapData, asmIndex, label, stateRoutineByLabel, runtimeEntryByLabel, effectByLabel) {
  const offset = labelOffset(label);
  const region = offset == null ? null : findContainingRegion(mapData, offset);
  const scan = scanLabelBlock(asmIndex, label);
  const role = componentRole(label, stateRoutineByLabel, runtimeEntryByLabel, effectByLabel);
  if (!scan) {
    return {
      label,
      offset: offset == null ? null : hex(offset),
      region: regionRef(region),
      role: role.role,
      summary: role.summary,
      sourceCatalog: role.sourceCatalog,
      missingAsm: true,
      calls: [],
      physicsCalls: [],
      dataRefs: [],
      ramAccesses: [],
      structAccesses: [],
      transitionWrites: [],
      motionWrites: [],
      readSummary: { inputReads: [], environmentFlagReads: [], formStateReads: [], contactFlagReads: [], entryFlagReads: [] },
      evidence: [`${label} was selected as a player state flow component, but no ASM label body was found.`],
    };
  }
  const calls = parseCalls(scan.body, effectByLabel);
  const ramAccesses = parseRamAccesses(scan.body);
  const structAccesses = parseStructAccesses(scan.body);
  const physicsCalls = calls.filter(call => call.isPhysicsEffect).map(call => ({
    line: call.line,
    op: call.op,
    sequenceIndex: call.sequenceIndex,
    ...call.effect,
  }));
  return {
    label,
    offset: offset == null ? null : hex(offset),
    region: regionRef(region),
    role: role.role,
    summary: role.summary,
    sourceCatalog: role.sourceCatalog,
    asmLine: scan.startLine,
    lineRange: { start: scan.startLine, end: scan.endLine },
    missingAsm: false,
    calls: calls.map(call => ({
      line: call.line,
      op: call.op,
      label: call.label,
      sequenceIndex: call.sequenceIndex,
      isPhysicsEffect: call.isPhysicsEffect,
    })),
    physicsCalls,
    dataRefs: parseDataRefs(scan.body),
    ramAccesses: ramAccesses
      .filter(access => access.important || ['write', 'read_write'].includes(access.access))
      .map(access => ({
        line: access.line,
        label: access.label,
        address: access.address,
        access: access.access,
        important: access.important,
        sourceRegister: access.sourceRegister,
        sourceValue: access.sourceValue,
      })),
    structAccesses: structAccesses.filter(access => access.offset === 1 || access.offset === 27 || access.offset === 32 || access.offset === 33 || access.offset === 49),
    transitionWrites: parseTransitions(ramAccesses),
    motionWrites: parseMotionWrites(ramAccesses),
    readSummary: summarizeReads(ramAccesses, structAccesses),
    evidence: [
      `ASM line ${scan.startLine}: ${label} routine entry.`,
      role.summary || `${label} participates in the player state physics flow audit.`,
    ],
  };
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function compactTransition(write) {
  return {
    line: write.line,
    literalTarget: write.literalTarget,
    sourceKind: write.sourceValue?.kind || null,
    source: write.sourceValue?.value || write.sourceValue?.source || write.sourceRegister || null,
    entryFlagWrite: write.entryFlagWrite,
  };
}

function compactMotionWrite(write) {
  return {
    line: write.line,
    label: write.label,
    address: write.address,
    sourceKind: write.sourceValue?.kind || null,
    source: write.sourceValue?.value || write.sourceValue?.source || write.sourceRegister || null,
  };
}

function buildFlow(mapData, asmIndex, def, stateRoutineByLabel, runtimeEntryByLabel, effectByLabel) {
  const components = def.componentLabels.map(label => buildComponent(mapData, asmIndex, label, stateRoutineByLabel, runtimeEntryByLabel, effectByLabel));
  const physicsCalls = components.flatMap(component => component.physicsCalls.map(call => ({ ...call, componentLabel: component.label })));
  const transitionWrites = components.flatMap(component => component.transitionWrites.map(write => ({ ...write, componentLabel: component.label })));
  const motionWrites = components.flatMap(component => component.motionWrites.map(write => ({ ...write, componentLabel: component.label })));
  const inputReadLines = components.flatMap(component => component.readSummary.inputReads.map(line => ({ componentLabel: component.label, line })));
  const environmentFlagReadLines = components.flatMap(component => component.readSummary.environmentFlagReads.map(line => ({ componentLabel: component.label, line })));
  const contactFlagReads = components.flatMap(component => component.readSummary.contactFlagReads.map(read => ({ componentLabel: component.label, ...read })));
  const allCalls = components.flatMap(component => component.calls.map(call => ({ ...call, componentLabel: component.label })));
  const nonPhysicsCalls = allCalls.filter(call => !call.isPhysicsEffect);
  const transitionTargets = uniqueBy(
    transitionWrites
      .map(write => write.literalTarget)
      .filter(Boolean),
    value => value,
  );
  return {
    flowId: def.flowId,
    schemaVersion: 1,
    stateSlot: def.stateSlot,
    primaryLabel: def.primaryLabel,
    componentLabels: def.componentLabels,
    role: componentRole(def.primaryLabel, stateRoutineByLabel, runtimeEntryByLabel, effectByLabel).role,
    summary: def.summary,
    confidence: components.some(component => component.missingAsm) ? 'medium' : 'high',
    components,
    physicsCalls,
    physicsCategoryCounts: countBy(physicsCalls, call => call.category || 'unknown'),
    uniquePhysicsEffects: uniqueBy(physicsCalls.map(call => ({
      label: call.label,
      role: call.role,
      category: call.category,
    })), item => item.label),
    nonPhysicsCalls: uniqueBy(nonPhysicsCalls.map(call => ({ label: call.label, op: call.op })), call => `${call.op}:${call.label}`),
    transitionWrites: transitionWrites.map(write => ({
      componentLabel: write.componentLabel,
      ...compactTransition(write),
    })),
    transitionTargets,
    motionWrites: motionWrites.map(write => ({
      componentLabel: write.componentLabel,
      ...compactMotionWrite(write),
    })),
    inputReads: inputReadLines,
    environmentFlagReads: environmentFlagReadLines,
    contactFlagReads,
    dataRefs: uniqueBy(components.flatMap(component => component.dataRefs), ref => `${ref.label}:${ref.line}`),
    evidence: [
      `Flow ${def.flowId} is composed from ASM label(s): ${def.componentLabels.join(', ')}.`,
      ...components.map(component => component.asmLine ? `ASM line ${component.asmLine}: ${component.label} component entry.` : `${component.label} component entry missing from ASM.`),
      physicsCalls.length
        ? `Direct physics-effect calls in this flow: ${uniqueBy(physicsCalls.map(call => call.label), label => label).join(', ')}.`
        : 'No direct call to a cataloged physics state effect was found in this flow component set.',
    ],
  };
}

function buildCatalog(mapData, asmText) {
  const stateCatalog = findCatalog(mapData, sourceCatalogIds.playerState);
  const runtimeCatalog = findCatalog(mapData, sourceCatalogIds.playerRuntime);
  const physicsEffectCatalog = findCatalog(mapData, sourceCatalogIds.physicsEffects);
  const validationIssues = [];
  if (!stateCatalog) validationIssues.push(`Missing source catalog ${sourceCatalogIds.playerState}.`);
  if (!runtimeCatalog) validationIssues.push(`Missing source catalog ${sourceCatalogIds.playerRuntime}.`);
  if (!physicsEffectCatalog) validationIssues.push(`Missing source catalog ${sourceCatalogIds.physicsEffects}.`);

  const stateRoutineByLabel = new Map((stateCatalog?.routines || []).map(item => [item.label, item]));
  const runtimeEntryByLabel = new Map((runtimeCatalog?.entries || []).map(item => [item.label, item]));
  const effectByLabel = new Map((physicsEffectCatalog?.effects || []).map(item => [item.label, item]));
  const asmIndex = buildAsmIndex(asmText);
  const flows = FLOW_DEFS.map(def => buildFlow(mapData, asmIndex, def, stateRoutineByLabel, runtimeEntryByLabel, effectByLabel));
  const componentLabels = uniqueBy(flows.flatMap(flow => flow.componentLabels), label => label);
  const missingComponents = flows.flatMap(flow => flow.components.filter(component => component.missingAsm).map(component => ({
    flowId: flow.flowId,
    label: component.label,
  })));
  const allPhysicsCalls = flows.flatMap(flow => flow.physicsCalls);
  const allTransitionWrites = flows.flatMap(flow => flow.transitionWrites);
  const allMotionWrites = flows.flatMap(flow => flow.motionWrites);
  const allRamAccesses = flows.flatMap(flow => flow.components.flatMap(component => component.ramAccesses.map(access => ({
    flowId: flow.flowId,
    componentLabel: component.label,
    ...access,
  }))));
  const missingRegions = flows.flatMap(flow => flow.components.filter(component => !component.region).map(component => ({
    flowId: flow.flowId,
    label: component.label,
    offset: component.offset,
  })));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: sourceCatalogIds,
    summary: {
      flowCount: flows.length,
      componentCount: componentLabels.length,
      flowsWithPhysicsCalls: flows.filter(flow => flow.physicsCalls.length).length,
      totalPhysicsCalls: allPhysicsCalls.length,
      uniquePhysicsEffectsUsed: uniqueBy(allPhysicsCalls.map(call => call.label), label => label).length,
      physicsCategoryCounts: countBy(allPhysicsCalls, call => call.category || 'unknown'),
      transitionWriteCount: allTransitionWrites.length,
      literalTransitionTargets: uniqueBy(allTransitionWrites.map(write => write.literalTarget).filter(Boolean), value => value),
      motionWriteCount: allMotionWrites.length,
      inputDrivenFlows: flows.filter(flow => flow.inputReads.length).length,
      contactDrivenFlows: flows.filter(flow => flow.contactFlagReads.length).length,
      environmentFlagDrivenFlows: flows.filter(flow => flow.environmentFlagReads.length).length,
      missingComponents: missingComponents.length,
      missingRegions: missingRegions.length,
      assetPolicy: 'Metadata only: ASM labels, ROM offsets, line numbers, RAM labels, state targets, scalar motion constants, and cross-catalog references. No ROM bytes, decoded graphics, music, or asset payloads are embedded.',
    },
    flows,
    ramUsage: uniqueBy(
      allRamAccesses.filter(access => access.important || importantRamLabels.has(access.label)),
      access => `${access.flowId}:${access.componentLabel}:${access.label}:${access.line}:${access.access}`,
    ),
    validationIssues: [
      ...validationIssues,
      ...missingComponents.map(item => `Missing ASM component ${item.label} for ${item.flowId}.`),
      ...missingRegions.map(item => `Missing mapped region for ${item.label} at ${item.offset}.`),
    ],
    evidence: [
      'Player state dispatch tables in world-player-state-catalog-2026-06-24 identify the inner state handler labels and state slots.',
      'Player runtime catalog world-player-runtime-routine-catalog-2026-06-25 identifies continuation labels such as _LABEL_4F0E_, _LABEL_5515_, and _LABEL_5650_.',
      'Physics state effect catalog world-player-physics-state-effect-catalog-2026-06-25 provides confirmed semantics for direct collision, motion, damping, integrator, overlap, and contact helper calls.',
      'This catalog stores line-level references and scalar constants only; it does not copy ROM bytes or decoded assets.',
    ],
  };
}

function compactFlowRegionRef(flow, component) {
  return {
    flowId: flow.flowId,
    stateSlot: flow.stateSlot,
    primaryLabel: flow.primaryLabel,
    componentLabel: component.label,
    role: component.role,
    asmLine: component.asmLine || null,
    physicsCalls: component.physicsCalls.map(call => ({ line: call.line, label: call.label, role: call.role, category: call.category })),
    transitionTargets: component.transitionWrites.map(compactTransition),
    motionWrites: component.motionWrites.map(compactMotionWrite),
    inputDriven: component.readSummary.inputReads.length > 0,
    contactDriven: component.readSummary.contactFlagReads.length > 0,
    environmentFlagDriven: component.readSummary.environmentFlagReads.length > 0,
  };
}

function annotateRegions(mapData, catalog) {
  const refsByRegionId = new Map();
  for (const flow of catalog.flows) {
    for (const component of flow.components) {
      if (!component.region) continue;
      if (!refsByRegionId.has(component.region.id)) refsByRegionId.set(component.region.id, []);
      refsByRegionId.get(component.region.id).push(compactFlowRegionRef(flow, component));
    }
  }
  const annotatedRegions = [];
  for (const [regionId, refs] of refsByRegionId.entries()) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.playerStatePhysicsFlowAudit = {
      catalogId,
      kind: 'player_state_physics_flow_component',
      confidence: refs.some(ref => !ref.asmLine) ? 'medium' : 'high',
      summary: 'Player state flow component with direct links to physics effects, state transitions, motion writes, and input/contact/environment flag reads.',
      refs,
      evidence: uniqueBy(refs.flatMap(ref => [
        ref.asmLine ? `ASM line ${ref.asmLine}: ${ref.componentLabel} component entry for ${ref.flowId}.` : `${ref.componentLabel} component entry for ${ref.flowId}.`,
        ref.physicsCalls.length
          ? `${ref.componentLabel} directly calls cataloged physics effect(s): ${uniqueBy(ref.physicsCalls.map(call => call.label), label => label).join(', ')}.`
          : `${ref.componentLabel} has no direct call to a cataloged physics effect in its scanned block.`,
      ]), item => item),
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      refCount: refs.length,
      flowIds: uniqueBy(refs.map(ref => ref.flowId), value => value),
    });
  }
  return annotatedRegions;
}

function annotateRam(mapData, catalog) {
  const refsByAddress = new Map();
  for (const access of catalog.ramUsage) {
    if (!access.address) continue;
    if (!refsByAddress.has(access.address)) refsByAddress.set(access.address, []);
    refsByAddress.get(access.address).push({
      flowId: access.flowId,
      componentLabel: access.componentLabel,
      line: access.line,
      label: access.label,
      access: access.access,
      sourceKind: access.sourceValue?.kind || null,
      source: access.sourceValue?.value || access.sourceValue?.source || null,
    });
  }
  const annotatedRamEntries = [];
  for (const [address, refs] of refsByAddress.entries()) {
    const ram = findRamEntry(mapData, address);
    if (!ram) continue;
    ram.analysis = ram.analysis || {};
    ram.analysis.playerStatePhysicsFlowAudit = {
      catalogId,
      kind: 'player_state_flow_ram_usage',
      confidence: 'high',
      summary: 'RAM field is read or written by mapped player state flow components.',
      refs: refs.slice(0, 128),
      generatedAt: now,
      tool: toolName,
    };
    annotatedRamEntries.push({
      id: ram.id,
      address: ram.address,
      name: ram.name || '',
      refCount: refs.length,
      flowIds: uniqueBy(refs.map(ref => ref.flowId), value => value),
    });
  }
  return annotatedRamEntries;
}

function annotateMap(mapData, catalog) {
  return {
    annotatedRegions: annotateRegions(mapData, catalog),
    annotatedRamEntries: annotateRam(mapData, catalog),
  };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotations = apply
    ? annotateMap(mapData, catalog)
    : { annotatedRegions: [], annotatedRamEntries: [] };

  if (apply) {
    const finalCatalog = buildCatalog(mapData, asmText);
    mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(item => item.id !== catalogId);
    mapData.playerCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_state_physics_flow_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      sourceCatalogs: sourceCatalogIds,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotations.annotatedRegions.length,
        annotatedRamEntries: annotations.annotatedRamEntries.length,
      },
      validationIssues: finalCatalog.validationIssues,
      annotatedRegions: annotations.annotatedRegions,
      annotatedRamEntries: annotations.annotatedRamEntries,
      nextLeads: [
        'Frame-trace state 1, 2, 3, 5, and 8 with _RAM_C260_, _RAM_D279_, IX+27, _RAM_CF95_, _RAM_C248_, and _RAM_C24A_ to prove exact state transition priority.',
        'Use this flow catalog to split player-state engine modules into collision sweep, grounded motion, airborne motion, vector transition, room transition, and damage knockback components.',
        'Connect _LABEL_502D_ and _LABEL_1F3E_ to tile-interaction and vector-probe semantics so state 5/8 and vector jump behavior can be reproduced without Z80 execution.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotations.annotatedRegions.length,
      annotatedRamEntries: annotations.annotatedRamEntries.length,
    },
    validationIssues: catalog.validationIssues,
    flowPreview: catalog.flows.slice(0, 6).map(flow => ({
      flowId: flow.flowId,
      components: flow.componentLabels,
      physicsCalls: flow.physicsCalls.map(call => `${call.componentLabel}:${call.label}`),
      transitionTargets: flow.transitionTargets,
      inputDriven: flow.inputReads.length > 0,
      contactDriven: flow.contactFlagReads.length > 0,
    })),
  }, null, 2));
}

main();
