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
const catalogId = 'world-zone-descriptor-pointer-flow-catalog-2026-06-25';
const reportId = 'zone-descriptor-pointer-flow-audit-2026-06-25';
const toolName = 'tools/world-zone-descriptor-pointer-flow-audit.mjs';

const sourceCatalogIds = [
  'world-zone-loader-caller-context-catalog-2026-06-25',
  'world-zone-graph-2026-06-24',
  'world-ui-trigger-routine-catalog-2026-06-25',
  'world-player-runtime-routine-catalog-2026-06-25',
  'world-bank2-transition-routine-catalog-2026-06-25',
];

const ramLabels = {
  cffa: '_RAM_CFFA_',
  c26c: '_RAM_C26C_',
  c26e: '_RAM_C26E_',
  cf6a: '_RAM_CF6A_',
  d1ae: '_RAM_D1AE_',
  d1af: '_RAM_D1AF_',
  cf5b: '_RAM_CF5B_',
};

const tableDefs = [
  {
    label: '_DATA_48C5_',
    offset: 0x048C5,
    role: 'room_trigger_opcode_dispatch_table',
    indexSource: 'trigger opcode masked with $1F in _LABEL_48A9_',
    dispatcherLabel: '_LABEL_48A9_',
  },
  {
    label: '_DATA_4CAD_',
    offset: 0x04CAD,
    role: 'room_transition_opcode_jump_table',
    indexSource: '_RAM_C26E_ masked with $3F then decremented in _LABEL_4C32_',
    dispatcherLabel: '_LABEL_4C32_',
  },
  {
    label: '_DATA_B3CD_',
    offset: 0x0B3CD,
    role: 'bank2_transition_request_jump_table',
    indexSource: '_RAM_CF6A_ decremented in _LABEL_B3C0_',
    dispatcherLabel: '_LABEL_B3C0_',
  },
  {
    label: '_DATA_B515_',
    offset: 0x0B515,
    role: 'bank2_transition_scene_branch_jump_table',
    indexSource: '_RAM_D1AE_ in _LABEL_B511_',
    dispatcherLabel: '_LABEL_B511_',
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function ramAddress(label) {
  const match = /^_RAM_([0-9A-F]+)_$/i.exec(label || '');
  return match ? '$' + match[1].toUpperCase() : null;
}

function labelOffset(label) {
  const match = /^_LABEL_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function findRamByAddress(mapData, address) {
  return (mapData.ram || []).find(entry =>
    String(entry.address || '').toUpperCase() === String(address || '').toUpperCase()
  ) || null;
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

function ramRef(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 1,
    type: entry.type || 'byte',
    name: entry.name || '',
  };
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function collectLabels(lines) {
  const labels = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_(?:LABEL|DATA)_[0-9A-F]+_):/.exec(lines[i]);
    if (match) labels.set(match[1], i);
  }
  return labels;
}

function parseDwTable(lines, labels, label) {
  const start = labels.get(label);
  if (start == null) return [];
  const entries = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = cleanCode(lines[i]);
    if (!line) continue;
    if (/^_/.test(line)) break;
    const match = /^\.dw\s+(.+)$/i.exec(line);
    if (!match) break;
    for (const token of match[1].split(/\s+/).filter(Boolean)) {
      entries.push(token.trim());
    }
  }
  return entries;
}

function firstLineMatching(lines, labelMap, label, pattern) {
  const start = labelMap.get(label);
  if (start == null) return null;
  for (let i = start; i < lines.length; i++) {
    if (i > start && /^_LABEL_[0-9A-F]+_:/.test(lines[i])) break;
    const code = cleanCode(lines[i]);
    if (pattern.test(code)) return { line: i + 1, code };
  }
  return null;
}

function allLinesMatching(lines, labelMap, label, pattern) {
  const out = [];
  const start = labelMap.get(label);
  if (start == null) return out;
  for (let i = start; i < lines.length; i++) {
    if (i > start && /^_LABEL_[0-9A-F]+_:/.test(lines[i])) break;
    const code = cleanCode(lines[i]);
    if (pattern.test(code)) out.push({ line: i + 1, code });
  }
  return out;
}

function classifyTriggerTarget(label) {
  if (label === '_LABEL_4903_') return {
    kind: 'immediate_room_load_via_cffa',
    ramWrites: ['_RAM_C26E_'],
    ramReads: ['_RAM_CFFA_'],
    zoneLoaderConsumer: '_LABEL_4903_',
  };
  if (label === '_LABEL_492B_') return {
    kind: 'deferred_room_pointer_write_via_c26c',
    ramWrites: ['_RAM_C26E_', '_RAM_C26C_'],
    ramReads: [],
    zoneLoaderConsumer: null,
  };
  if (['_LABEL_4980_', '_LABEL_4988_', '_LABEL_49AF_', '_LABEL_49D4_', '_LABEL_49DD_', '_LABEL_49E6_', '_LABEL_49EF_'].includes(label)) {
    return {
      kind: 'conditional_deferred_room_pointer_write_via_c26c',
      ramWrites: ['_RAM_C26E_', '_RAM_C26C_'],
      ramReads: [],
      zoneLoaderConsumer: null,
      tailTarget: '_LABEL_492B_',
    };
  }
  if (label === '_LABEL_497A_') return {
    kind: 'bank2_transition_request_cf6a_1',
    ramWrites: ['_RAM_CF6A_'],
    ramReads: [],
    bank2RequestId: 1,
  };
  if (label === '_LABEL_49A9_') return {
    kind: 'bank2_transition_request_cf6a_3',
    ramWrites: ['_RAM_CF6A_'],
    ramReads: [],
    bank2RequestId: 3,
  };
  return {
    kind: 'other_trigger_effect',
    ramWrites: [],
    ramReads: [],
  };
}

function classifyTransitionTarget(label) {
  if (label === '_LABEL_4CED_') return {
    kind: 'room_transition_load_current_room_via_c26c',
    ramReads: ['_RAM_C26C_'],
    zoneLoaderConsumer: '_LABEL_4CED_',
  };
  if (label === '_LABEL_4D08_') return {
    kind: 'room_transition_load_then_wait_via_c26c',
    ramReads: ['_RAM_C26C_'],
    zoneLoaderConsumer: '_LABEL_4D08_',
  };
  if (label === '_LABEL_4E49_') return {
    kind: 'room_transition_form_stage_or_followup_load_via_c26c',
    ramReads: ['_RAM_C26C_', '_RAM_CF5B_'],
    ramWrites: ['_RAM_C26C_', '_RAM_D1AE_', '_RAM_D1AF_', '_RAM_CF6A_'],
    zoneLoaderConsumer: '_LABEL_4E49_',
  };
  if (label === '_LABEL_4CE9_') return {
    kind: 'room_transition_clear_stage_then_load_current_room',
    ramWrites: ['_RAM_CF5B_'],
    tailTarget: '_LABEL_4CED_',
    zoneLoaderConsumer: '_LABEL_4CED_',
  };
  if (label === '_LABEL_4EB0_') return {
    kind: 'room_transition_overlay_delay_then_wait_load',
    tailTarget: '_LABEL_4D08_',
    zoneLoaderConsumer: '_LABEL_4D08_',
  };
  return {
    kind: 'other_room_transition_handler',
    zoneLoaderConsumer: null,
  };
}

function classifyBank2RequestTarget(label) {
  if (label === '_LABEL_B3D3_') return {
    kind: 'new_game_bootstrap_room_load_with_local_common_prereq',
    ramReads: ['_RAM_CFFA_'],
    zoneLoaderConsumer: '_LABEL_B3D3_',
    localCommonPrereq: true,
  };
  if (label === '_LABEL_B44F_') return {
    kind: 'bank2_transition_room_sequence_via_c26c',
    ramReads: ['_RAM_C26C_'],
    ramWrites: ['_RAM_C26C_', '_RAM_CF8B_'],
    zoneLoaderConsumer: '_LABEL_B44F_',
    localCommonPrereq: false,
  };
  if (label === '_LABEL_B6B0_') return {
    kind: 'bank2_form_transition_setup_request',
    ramReads: ['_RAM_C24F_', '_RAM_CF5B_'],
    ramWrites: ['_RAM_D10E_'],
    zoneLoaderConsumer: null,
  };
  return { kind: 'other_bank2_transition_request', zoneLoaderConsumer: null };
}

function classifyBank2BranchTarget(label) {
  if (label === '_LABEL_B599_') return {
    kind: 'bank2_finale_branch_room_load_via_c26c',
    ramReads: ['_RAM_C26C_'],
    zoneLoaderConsumer: '_LABEL_B599_',
  };
  if (['_LABEL_B521_', '_LABEL_B539_', '_LABEL_B551_', '_LABEL_B569_', '_LABEL_B581_'].includes(label)) {
    return {
      kind: 'bank2_form_change_branch',
      ramReads: ['_RAM_D1AE_'],
      zoneLoaderConsumer: null,
    };
  }
  return { kind: 'other_bank2_branch', zoneLoaderConsumer: null };
}

function classifyTableEntry(tableLabel, targetLabel) {
  if (tableLabel === '_DATA_48C5_') return classifyTriggerTarget(targetLabel);
  if (tableLabel === '_DATA_4CAD_') return classifyTransitionTarget(targetLabel);
  if (tableLabel === '_DATA_B3CD_') return classifyBank2RequestTarget(targetLabel);
  if (tableLabel === '_DATA_B515_') return classifyBank2BranchTarget(targetLabel);
  return { kind: 'unknown', zoneLoaderConsumer: null };
}

function buildDispatchTables(lines, labelMap, mapData) {
  return tableDefs.map(def => {
    const targets = parseDwTable(lines, labelMap, def.label);
    const entries = targets.map((targetLabel, index) => {
      const targetOffset = labelOffset(targetLabel);
      return {
        index,
        targetLabel,
        targetOffset: targetOffset == null ? null : hex(targetOffset),
        targetRegion: targetOffset == null ? null : regionRef(findContainingRegion(mapData, targetOffset)),
        classification: classifyTableEntry(def.label, targetLabel),
      };
    });
    const byKind = {};
    for (const entry of entries) {
      const kind = entry.classification.kind;
      byKind[kind] = byKind[kind] || { kind, count: 0, indices: [], targets: [] };
      byKind[kind].count++;
      byKind[kind].indices.push(entry.index);
      if (!byKind[kind].targets.includes(entry.targetLabel)) byKind[kind].targets.push(entry.targetLabel);
    }
    return {
      label: def.label,
      offset: hex(def.offset),
      region: regionRef(findContainingRegion(mapData, def.offset)),
      role: def.role,
      indexSource: def.indexSource,
      dispatcherLabel: def.dispatcherLabel,
      dispatcherOffset: hex(labelOffset(def.dispatcherLabel) ?? 0),
      dispatcherRegion: regionRef(findContainingRegion(mapData, labelOffset(def.dispatcherLabel) ?? -1)),
      entryCount: entries.length,
      entries,
      classificationSummary: Object.values(byKind).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    };
  });
}

function indexList(table, kind) {
  return table.entries
    .filter(entry => entry.classification.kind === kind)
    .map(entry => entry.index);
}

function buildFlowSummaries(lines, labelMap, tables, mapData) {
  const trigger = tables.find(table => table.label === '_DATA_48C5_');
  const transition = tables.find(table => table.label === '_DATA_4CAD_');
  const bank2Req = tables.find(table => table.label === '_DATA_B3CD_');
  const bank2Branch = tables.find(table => table.label === '_DATA_B515_');
  const cffaWrite = firstLineMatching(lines, labelMap, '_LABEL_48A9_', /^ld\s+\(_RAM_CFFA_\),\s*de$/i);
  const c26cWrite = firstLineMatching(lines, labelMap, '_LABEL_492B_', /^ld\s+\(_RAM_C26C_\),\s*de$/i);
  const c26eWrite = firstLineMatching(lines, labelMap, '_LABEL_492B_', /^ld\s+\(_RAM_C26E_\),\s*a$/i);
  const e49Writes = allLinesMatching(lines, labelMap, '_LABEL_4E49_', /^ld\s+\((_RAM_C26C_|_RAM_D1AE_|_RAM_D1AF_|_RAM_CF6A_)\),/i);
  const b44fWrites = allLinesMatching(lines, labelMap, '_LABEL_B44F_', /^ld\s+\((_RAM_C26C_|_RAM_CF8B_)\),/i);

  return [
    {
      id: 'trigger_immediate_room_load_cffa',
      kind: 'trigger_to_immediate_zone_load',
      confidence: 'high',
      summary: '_LABEL_48A9_ writes the trigger destination pointer in DE to _RAM_CFFA_; _DATA_48C5_ entries targeting _LABEL_4903_ immediately load HL from _RAM_CFFA_ and call _LABEL_2620_.',
      dispatchTable: '_DATA_48C5_',
      dispatchEntryIndices: indexList(trigger, 'immediate_room_load_via_cffa'),
      ramRefs: ['_RAM_CFFA_', '_RAM_C26E_'],
      pointerRam: ramRef(findRamByAddress(mapData, '$CFFA')),
      stateRam: ramRef(findRamByAddress(mapData, '$C26E')),
      writer: cffaWrite,
      consumerLabel: '_LABEL_4903_',
      consumerRegion: regionRef(findContainingRegion(mapData, 0x04903)),
      localCommonPrereq: false,
      evidence: [
        cffaWrite ? `ASM line ${cffaWrite.line} writes DE to _RAM_CFFA_.` : '_LABEL_48A9_ CFFA writer not found.',
        '_DATA_48C5_ entries 0, 22, 23, 24, and 25 target _LABEL_4903_.',
        'ASM line 11111 loads HL from _RAM_CFFA_; ASM line 11112 calls _LABEL_2620_.',
      ],
    },
    {
      id: 'trigger_deferred_room_transition_c26c',
      kind: 'trigger_to_deferred_zone_load',
      confidence: 'high',
      summary: '_DATA_48C5_ entries that target or branch to _LABEL_492B_ write DE to _RAM_C26C_ and store the trigger opcode/state in _RAM_C26E_; _LABEL_4C32_ later dispatches _RAM_C26E_ through _DATA_4CAD_.',
      dispatchTable: '_DATA_48C5_',
      directDispatchEntryIndices: indexList(trigger, 'deferred_room_pointer_write_via_c26c'),
      conditionalDispatchEntryIndices: indexList(trigger, 'conditional_deferred_room_pointer_write_via_c26c'),
      transitionTable: '_DATA_4CAD_',
      transitionLoadEntryIndices: transition.entries
        .filter(entry => entry.classification.zoneLoaderConsumer)
        .map(entry => entry.index),
      ramRefs: ['_RAM_C26C_', '_RAM_C26E_'],
      pointerRam: ramRef(findRamByAddress(mapData, '$C26C')),
      stateRam: ramRef(findRamByAddress(mapData, '$C26E')),
      writers: [c26eWrite, c26cWrite].filter(Boolean),
      localCommonPrereq: false,
      evidence: [
        c26eWrite ? `ASM line ${c26eWrite.line} stores the trigger/state byte in _RAM_C26E_.` : '_LABEL_492B_ C26E writer not found.',
        c26cWrite ? `ASM line ${c26cWrite.line} stores DE in _RAM_C26C_.` : '_LABEL_492B_ C26C writer not found.',
        'ASM lines 11608-11613 load _RAM_C26E_, mask/decrement it, and dispatch through _DATA_4CAD_.',
      ],
    },
    {
      id: 'transition_form_stage_bank2_request',
      kind: 'transition_table_to_bank2_request',
      confidence: 'high',
      summary: '_LABEL_4E49_ consumes _RAM_C26C_ transition records; low form-stage values set _RAM_D1AE_, _RAM_D1AF_, and _RAM_CF6A_=2 instead of immediately loading a follow-up room.',
      dispatchTable: '_DATA_4CAD_',
      dispatchEntryIndices: indexList(transition, 'room_transition_form_stage_or_followup_load_via_c26c'),
      bank2RequestTable: '_DATA_B3CD_',
      bank2RequestEntries: bank2Req.entries.map(entry => ({
        index: entry.index,
        targetLabel: entry.targetLabel,
        kind: entry.classification.kind,
      })),
      ramRefs: ['_RAM_C26C_', '_RAM_CF5B_', '_RAM_D1AE_', '_RAM_D1AF_', '_RAM_CF6A_'],
      pointerRam: ramRef(findRamByAddress(mapData, '$C26C')),
      stateRam: ramRef(findRamByAddress(mapData, '$CF6A')),
      branchRam: ramRef(findRamByAddress(mapData, '$D1AE')),
      writers: e49Writes,
      evidence: [
        'ASM lines 11771-11788 read _RAM_C26C_ and choose between form-stage request and immediate follow-up room load.',
        'ASM lines 11787-11794 write _RAM_D1AE_, _RAM_D1AF_, and _RAM_CF6A_=2.',
        'ASM lines 20043-20055 dispatch _RAM_CF6A_ through _DATA_B3CD_.',
      ],
    },
    {
      id: 'bank2_transition_room_sequence_c26c',
      kind: 'bank2_transition_sequence_zone_load',
      confidence: 'high',
      summary: '_DATA_B3CD_ entry 1 reaches _LABEL_B44F_, which loads a room through _RAM_C26C_, advances _RAM_C26C_ by one 6-byte descriptor, runs the transition scene, then loads the next room through _RAM_C26C_.',
      dispatchTable: '_DATA_B3CD_',
      dispatchEntryIndices: indexList(bank2Req, 'bank2_transition_room_sequence_via_c26c'),
      ramRefs: ['_RAM_C26C_'],
      pointerRam: ramRef(findRamByAddress(mapData, '$C26C')),
      writers: b44fWrites,
      localCommonPrereq: false,
      evidence: [
        '_DATA_B3CD_ entry 1 targets _LABEL_B44F_.',
        'ASM lines 20113-20118 load HL from _RAM_C26C_, add 6 bytes, and write the advanced pointer back to _RAM_C26C_.',
        'ASM lines 20114 and 20134 call _LABEL_2620_ from _RAM_C26C_.',
      ],
    },
    {
      id: 'bank2_finale_branch_c26c',
      kind: 'bank2_branch_zone_load',
      confidence: 'high',
      summary: '_DATA_B515_ entry 5 reaches _LABEL_B599_; its finale branch eventually loads a room through _RAM_C26C_ after transition effects.',
      dispatchTable: '_DATA_B515_',
      dispatchEntryIndices: indexList(bank2Branch, 'bank2_finale_branch_room_load_via_c26c'),
      ramRefs: ['_RAM_C26C_', '_RAM_D1AE_'],
      pointerRam: ramRef(findRamByAddress(mapData, '$C26C')),
      branchRam: ramRef(findRamByAddress(mapData, '$D1AE')),
      localCommonPrereq: false,
      evidence: [
        '_DATA_B515_ entry 5 targets _LABEL_B599_.',
        'ASM line 20305 loads HL from _RAM_C26C_; ASM line 20306 calls _LABEL_2620_.',
      ],
    },
  ];
}

function collectRamInvolvement(mapData, flows) {
  const byAddress = new Map();
  for (const flow of flows) {
    for (const label of flow.ramRefs || []) {
      const address = ramAddress(label);
      const ram = ramRef(findRamByAddress(mapData, address));
      if (!ram?.address) continue;
      const entry = byAddress.get(ram.address) || {
        ram,
        ramLabels: [],
        flowIds: [],
        flowKinds: [],
      };
      if (!entry.ramLabels.includes(label)) entry.ramLabels.push(label);
      if (!entry.flowIds.includes(flow.id)) entry.flowIds.push(flow.id);
      if (!entry.flowKinds.includes(flow.kind)) entry.flowKinds.push(flow.kind);
      byAddress.set(ram.address, entry);
    }
    for (const key of ['pointerRam', 'stateRam', 'branchRam']) {
      const ram = flow[key];
      if (!ram?.address) continue;
      const entry = byAddress.get(ram.address) || {
        ram,
        ramLabels: [],
        flowIds: [],
        flowKinds: [],
      };
      if (!entry.flowIds.includes(flow.id)) entry.flowIds.push(flow.id);
      if (!entry.flowKinds.includes(flow.kind)) entry.flowKinds.push(flow.kind);
      byAddress.set(ram.address, entry);
    }
  }
  return [...byAddress.values()].sort((a, b) => String(a.ram?.address || '').localeCompare(String(b.ram?.address || '')));
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const labelMap = collectLabels(lines);
  const dispatchTables = buildDispatchTables(lines, labelMap, mapData);
  const flowSummaries = buildFlowSummaries(lines, labelMap, dispatchTables, mapData);
  const ramInvolvement = collectRamInvolvement(mapData, flowSummaries);
  const zoneGraph = (mapData.zoneGraphs || []).find(graph => graph.id === 'world-zone-graph-2026-06-24') || null;
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: sourceCatalogIds,
    sourceCatalogPresence: Object.fromEntries(sourceCatalogIds.map(id => [id, Boolean(findCatalog(mapData, id))])),
    summary: {
      dispatchTableCount: dispatchTables.length,
      flowCount: flowSummaries.length,
      triggerDispatchEntryCount: dispatchTables.find(table => table.label === '_DATA_48C5_')?.entryCount || 0,
      transitionDispatchEntryCount: dispatchTables.find(table => table.label === '_DATA_4CAD_')?.entryCount || 0,
      bank2RequestEntryCount: dispatchTables.find(table => table.label === '_DATA_B3CD_')?.entryCount || 0,
      bank2BranchEntryCount: dispatchTables.find(table => table.label === '_DATA_B515_')?.entryCount || 0,
      zoneGraphDescriptorCount: zoneGraph?.summary?.descriptorCount ?? null,
      zoneGraphEdgeCount: zoneGraph?.summary?.edgeCount ?? null,
      ramVariableCount: ramInvolvement.filter(item => item.ram).length,
      localCommonPrereqStillUnprovenFlowCount: flowSummaries.filter(flow => flow.localCommonPrereq === false).length,
      dependencyConclusion: 'Room-zone descriptor pointers flow through trigger and transition dispatch state before several _LABEL_2620_ calls; this supports keeping common VRAM prerequisites simulation-only until runtime persistence is traced across these pointer-driven flows.',
      assetPolicy: 'Metadata only: ASM labels, jump-table indices, RAM labels/addresses, routine references, region ids, zone graph counts, and evidence notes. No ROM bytes, decoded rooms, graphics, audio, or rendered assets are embedded.',
    },
    dispatchTables,
    flowSummaries,
    ramInvolvement,
    evidence: [
      '_DATA_48C5_, _DATA_4CAD_, _DATA_B3CD_, and _DATA_B515_ are parsed from ASM .dw labels and stored as label/index metadata only.',
      'Pointer-flow claims are backed by ASM lines that write _RAM_CFFA_, _RAM_C26C_, _RAM_C26E_, _RAM_CF6A_, _RAM_D1AE_, and _RAM_D1AF_ or call _LABEL_2620_.',
      'The zone graph supplies descriptor/edge coverage counts but this audit does not embed descriptor bytes or rendered rooms.',
    ],
  };
}

function annotateRegion(region, value, annotatedRegions) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis.zoneDescriptorPointerFlowAudit = value;
  annotatedRegions.push({
    id: region.id,
    offset: region.offset,
    type: region.type || 'unknown',
    name: region.name || '',
  });
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  for (const table of catalog.dispatchTables) {
    const region = table.region?.id
      ? (mapData.regions || []).find(item => item.id === table.region.id)
      : null;
    annotateRegion(region, {
      catalogId,
      kind: 'zone_descriptor_pointer_dispatch_table',
      confidence: 'high',
      summary: `${table.label} dispatches ${table.entryCount} entries for ${table.role}.`,
      label: table.label,
      role: table.role,
      indexSource: table.indexSource,
      dispatcherLabel: table.dispatcherLabel,
      classificationSummary: table.classificationSummary,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);

    const dispatcherRegion = table.dispatcherRegion?.id
      ? (mapData.regions || []).find(item => item.id === table.dispatcherRegion.id)
      : null;
    annotateRegion(dispatcherRegion, {
      catalogId,
      kind: 'zone_descriptor_pointer_dispatcher',
      confidence: 'high',
      summary: `${table.dispatcherLabel} selects entries from ${table.label}.`,
      dispatchTable: table.label,
      indexSource: table.indexSource,
      classificationSummary: table.classificationSummary,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    }, annotatedRegions);
  }

  const flowRegions = new Set();
  for (const flow of catalog.flowSummaries) {
    for (const label of [flow.consumerLabel, flow.dispatchTable, flow.transitionTable, flow.bank2RequestTable]) {
      if (!label) continue;
      const offset = label.startsWith('_DATA_')
        ? parseInt(label.match(/^_DATA_([0-9A-F]+)_$/i)?.[1] || '', 16)
        : labelOffset(label);
      if (!Number.isFinite(offset)) continue;
      const region = findContainingRegion(mapData, offset);
      if (region) flowRegions.add(region.id);
    }
  }
  for (const id of flowRegions) {
    const region = (mapData.regions || []).find(item => item.id === id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.zoneDescriptorPointerFlowConsumerAudit = {
      catalogId,
      kind: 'zone_descriptor_pointer_flow_participant',
      confidence: 'high',
      summary: 'This region participates in a trigger/transition descriptor-pointer flow that can reach _LABEL_2620_.',
      flows: catalog.flowSummaries
        .filter(flow => JSON.stringify(flow).includes(region.name || region.offset))
        .map(flow => ({ id: flow.id, kind: flow.kind, summary: flow.summary })),
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      role: 'flow_participant',
    });
  }

  const annotatedRam = [];
  for (const item of catalog.ramInvolvement) {
    const address = item.ram?.address || null;
    if (!address) continue;
    const entry = findRamByAddress(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.zoneDescriptorPointerFlowAudit = {
      catalogId,
      kind: 'zone_descriptor_pointer_flow_ram',
      confidence: 'high',
      summary: 'RAM variable participates in trigger/transition descriptor-pointer flow into _LABEL_2620_.',
      flowIds: item.flowIds,
      flowKinds: item.flowKinds,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRam.push({
      id: entry.id,
      address: entry.address,
      name: entry.name || '',
      flowIds: item.flowIds,
    });
  }

  return {
    annotatedRegions,
    annotatedRam,
  };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  let annotation = { annotatedRegions: [], annotatedRam: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_descriptor_pointer_flow_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      sourceCatalogPresence: catalog.sourceCatalogPresence,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotation.annotatedRegions.length,
        annotatedRamCount: annotation.annotatedRam.length,
      },
      dispatchTables: catalog.dispatchTables,
      flowSummaries: catalog.flowSummaries,
      ramInvolvement: catalog.ramInvolvement,
      annotatedRegions: annotation.annotatedRegions,
      annotatedRam: annotation.annotatedRam,
      evidence: catalog.evidence,
      nextLeads: [
        'Trace _LABEL_4816_ trigger records to connect _DATA_48C5_ opcode indices with concrete zone graph door/trigger edges.',
        'Model _RAM_C26E_ transition opcodes as structured room-transition actions tied to _DATA_4CAD_ entries.',
        'Use runtime tracing to prove whether common VRAM prerequisites persist through CFFA/C26C pointer-driven room loads.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotation.annotatedRegions.length,
      annotatedRamCount: annotation.annotatedRam.length,
    },
    dispatchTables: catalog.dispatchTables.map(table => ({
      label: table.label,
      entryCount: table.entryCount,
      classificationSummary: table.classificationSummary,
    })),
    flowSummaries: catalog.flowSummaries.map(flow => ({
      id: flow.id,
      kind: flow.kind,
      dispatchTable: flow.dispatchTable,
      dispatchEntryIndices: flow.dispatchEntryIndices || flow.directDispatchEntryIndices || [],
      localCommonPrereq: flow.localCommonPrereq ?? null,
    })),
    ramInvolvement: catalog.ramInvolvement.map(item => ({
      ram: item.ram,
      flowIds: item.flowIds,
    })),
  }, null, 2));
}

main();
