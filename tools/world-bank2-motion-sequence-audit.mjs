#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-bank2-motion-sequence-catalog-2026-06-25';
const reportId = 'bank2-motion-sequence-audit-2026-06-25';
const toolName = 'tools/world-bank2-motion-sequence-audit.mjs';

function code(offset, label, role, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name: options.name || `${label} ${role.split('_').join(' ')}`,
    type: 'code',
    family: options.family || 'bank2_motion_sequence_runtime',
    confidence: options.confidence || 'high',
    table: options.table || null,
    tableIndex: options.tableIndex ?? null,
    calls: options.calls || [],
    ramRefs: options.ramRefs || [],
    ioPorts: options.ioPorts || [],
    summary,
    evidence: [
      `${label} is an ASM code label at ROM offset ${hex(offset)}.`,
      ...(options.table ? [`${label} is dispatched from ${options.table}${options.tableIndex == null ? '' : ` entry ${options.tableIndex}`}.`] : []),
      ...(options.evidence || []),
    ],
  };
}

function table(offset, label, role, entries, summary, evidence) {
  return {
    offset,
    label,
    role,
    name: `${label} ${role.split('_').join(' ')}`,
    type: 'pointer_table',
    family: 'bank2_motion_sequence_table',
    confidence: 'high',
    table: label,
    tableIndex: null,
    entries,
    calls: [],
    ramRefs: [],
    ioPorts: [],
    summary,
    evidence: [
      `${label} is an ASM .dw pointer table at ROM offset ${hex(offset)}.`,
      evidence,
    ],
  };
}

const transitionTable = '_DATA_92C8_';
const streamOpcodeTable = '_DATA_9749_';

const ENTRIES = [
  code(0x08657, '_LABEL_8657_', 'motion_phase_wait_counter', 'Phase-2 motion helper reached from _LABEL_85E9_; calls _LABEL_98A9_, decrements _RAM_D192_, and advances _RAM_D18E_ when the wait expires.', {
    calls: ['_LABEL_98A9_'],
    ramRefs: ['_RAM_D18E_', '_RAM_D192_'],
    evidence: ['ASM lines 17197-17203 define _LABEL_8657_ as the third _LABEL_85E9_ phase branch that decrements _RAM_D192_ and increments _RAM_D18E_ on zero.'],
  }),
  code(0x08C39, '_LABEL_8C39_', 'bank2_entity_slot_clear_tail', 'Shared bank-2 entity update tail that clears IX+0 after collision/lifetime completion.', {
    ramRefs: ['IX+0'],
    evidence: ['ASM lines 17963-17965 show _LABEL_8C39_ storing zero in IX+0 and returning after the preceding collision/update checks.'],
  }),
  code(0x092D8, '_LABEL_92D8_', 'transition_table_entry_0_left_up_start', 'Transition decision entry 0 from _DATA_92C8_; tests _LABEL_94BF_ and enters movement state 2 through the shared _LABEL_92DF_ setup when allowed.', {
    table: transitionTable,
    tableIndex: 0,
    calls: ['_LABEL_94BF_'],
    ramRefs: ['_RAM_D16E_', '_RAM_D15D_', '_RAM_D156_', '_RAM_D17F_', '_RAM_D150_', '_RAM_D14F_'],
    evidence: ['ASM lines 18781-18798 identify _LABEL_92D8_ as the first _DATA_92C8_ entry and show the shared state setup at _LABEL_92DF_.'],
  }),
  code(0x092FB, '_LABEL_92FB_', 'transition_table_entry_1_left_up_continue', 'Transition decision entry 1 from _DATA_92C8_; gates through _LABEL_941F_ and _LABEL_94BF_, then enters movement state 3 through _LABEL_92DF_.', {
    table: transitionTable,
    tableIndex: 1,
    calls: ['_LABEL_941F_', '_LABEL_94BF_'],
    ramRefs: ['_RAM_D16E_', '_RAM_D15D_', '_RAM_D156_', '_RAM_D17F_', '_RAM_D150_', '_RAM_D14F_'],
    evidence: ['ASM lines 18803-18809 identify _LABEL_92FB_ as the second _DATA_92C8_ entry and branch to _LABEL_92D8_ or _LABEL_92DF_ based on helper carry state.'],
  }),
  code(0x09309, '_LABEL_9309_', 'transition_table_entry_2_right_down_start', 'Transition decision entry 2 from _DATA_92C8_; tests _LABEL_9491_ and enters movement state 4 through the shared _LABEL_9310_ setup.', {
    table: transitionTable,
    tableIndex: 2,
    calls: ['_LABEL_9491_'],
    ramRefs: ['_RAM_D16E_', '_RAM_D15D_', '_RAM_D156_', '_RAM_D17F_', '_RAM_D150_', '_RAM_D14F_'],
    evidence: ['ASM lines 18812-18820 identify _LABEL_9309_ as the third _DATA_92C8_ entry and show _LABEL_9310_ writing state/timer fields.'],
  }),
  code(0x0931D, '_LABEL_931D_', 'transition_table_entry_3_right_down_continue', 'Transition decision entry 3 from _DATA_92C8_; gates through _LABEL_941F_ and _LABEL_9491_, then enters movement state 5 through _LABEL_9310_.', {
    table: transitionTable,
    tableIndex: 3,
    calls: ['_LABEL_941F_', '_LABEL_9491_'],
    ramRefs: ['_RAM_D16E_', '_RAM_D15D_', '_RAM_D156_', '_RAM_D17F_', '_RAM_D150_', '_RAM_D14F_'],
    evidence: ['ASM lines 18825-18831 identify _LABEL_931D_ as the fourth _DATA_92C8_ entry and branch through the shared _LABEL_9310_ setup.'],
  }),
  code(0x0932B, '_LABEL_932B_', 'transition_table_entry_4_vertical_start', 'Transition decision entry 4 from _DATA_92C8_; tests _LABEL_951A_ and enters the shared _LABEL_9332_ setup through _LABEL_9330_.', {
    table: transitionTable,
    tableIndex: 4,
    calls: ['_LABEL_951A_'],
    ramRefs: ['_RAM_D16E_', '_RAM_D158_', '_RAM_D14F_', '_RAM_D15D_', '_RAM_D17F_'],
    evidence: ['ASM lines 18834-18850 identify _LABEL_932B_ and _LABEL_9330_ as the state-6 setup path that writes _RAM_D158_ and updates _RAM_D15D_.'],
  }),
  code(0x09330, '_LABEL_9330_', 'transition_state_6_shared_head', 'Shared transition setup head that loads state id 6 before falling into _LABEL_9332_.', {
    table: transitionTable,
    tableIndex: 4,
    ramRefs: ['_RAM_D16E_'],
    evidence: ['ASM lines 18836-18839 show _LABEL_9330_ loading A=6 before the shared _LABEL_9332_ state setup.'],
  }),
  code(0x09354, '_LABEL_9354_', 'transition_table_entry_5_vertical_continue', 'Transition decision entry 5 from _DATA_92C8_; gates through _LABEL_9444_ and _LABEL_951A_, then enters state 7 through _LABEL_9332_.', {
    table: transitionTable,
    tableIndex: 5,
    calls: ['_LABEL_9444_', '_LABEL_951A_'],
    ramRefs: ['_RAM_D16E_', '_RAM_D158_', '_RAM_D14F_', '_RAM_D15D_', '_RAM_D17F_'],
    evidence: ['ASM lines 18860-18867 identify _LABEL_9354_ as the sixth _DATA_92C8_ entry and branch through _LABEL_9332_ with A=7.'],
  }),
  code(0x09362, '_LABEL_9362_', 'transition_table_entry_6_vertical_reverse_start', 'Transition decision entry 6 from _DATA_92C8_; tests _LABEL_94EB_ and enters state 8 through _LABEL_9369_.', {
    table: transitionTable,
    tableIndex: 6,
    calls: ['_LABEL_94EB_'],
    ramRefs: ['_RAM_D16E_', '_RAM_D158_', '_RAM_D14F_', '_RAM_D15D_', '_RAM_D17F_'],
    evidence: ['ASM lines 18869-18876 identify _LABEL_9362_ as the seventh _DATA_92C8_ entry and show _LABEL_9369_ setting state and vector.'],
  }),
  code(0x09371, '_LABEL_9371_', 'transition_table_entry_7_vertical_reverse_continue', 'Transition decision entry 7 from _DATA_92C8_; gates through _LABEL_9444_ and _LABEL_94EB_, then enters state 9 through _LABEL_9369_.', {
    table: transitionTable,
    tableIndex: 7,
    calls: ['_LABEL_9444_', '_LABEL_94EB_'],
    ramRefs: ['_RAM_D16E_', '_RAM_D158_', '_RAM_D14F_', '_RAM_D15D_', '_RAM_D17F_'],
    evidence: ['ASM lines 18880-18885 identify _LABEL_9371_ as the eighth _DATA_92C8_ entry and branch through _LABEL_9369_ with A=9.'],
  }),
  code(0x09407, '_LABEL_9407_', 'motion_vertical_range_gate', 'Range/carry helper that checks _RAM_D154_ plus 0x18 against vertical limits and optionally inverts carry based on _RAM_D191_ bit 0.', {
    calls: [],
    ramRefs: ['_RAM_D154_', '_RAM_D191_'],
    evidence: ['ASM lines 18968-18983 show _LABEL_9407_ adding 0x18 to _RAM_D154_, checking the 0x49-0x91 range, and testing _RAM_D191_ bit 0.'],
  }),
  code(0x09444, '_LABEL_9444_', 'motion_player_y_proximity_gate', 'Proximity helper that compares _RAM_D154_ with player Y _RAM_C246_ minus 0x10 and sets _RAM_D14F_ bit 7 when the threshold window is reached.', {
    ramRefs: ['_RAM_D154_', '_RAM_C246_', '_RAM_D14F_'],
    evidence: ['ASM lines 19010-19038 show _LABEL_9444_ checking a vertical range and comparing against _RAM_C246_ with a 0x10 window before setting _RAM_D14F_ bit 7.'],
  }),
  code(0x09472, '_LABEL_9472_', 'motion_x_clamp_to_0138_head', 'Clamp helper head that selects DE=0x0138 before sharing the _LABEL_9477_ X-position clamp body.', {
    ramRefs: ['_RAM_D151_', '_RAM_D150_', '_RAM_D14F_'],
    evidence: ['ASM lines 19041-19046 show _LABEL_9472_ loading DE=0x0138 and falling into the shared clamp body.'],
  }),
  code(0x09477, '_LABEL_9477_', 'motion_x_clamp_to_de_body', 'Shared X-position clamp that clamps _RAM_D151_ to DE, clears _RAM_D150_, and sets _RAM_D14F_ bit 7 when the threshold is crossed.', {
    ramRefs: ['_RAM_D151_', '_RAM_D150_', '_RAM_D14F_'],
    evidence: ['ASM lines 19045-19057 show _LABEL_9477_ defaulting DE=0x00F0, comparing _RAM_D151_, clamping it, clearing _RAM_D150_, and setting _RAM_D14F_ bit 7.'],
  }),
  code(0x09491, '_LABEL_9491_', 'motion_x_threshold_00c0_gate', 'X-threshold helper that compares _RAM_D151_ against 0x00C0 and returns carry status without mutating the position.', {
    ramRefs: ['_RAM_D151_'],
    evidence: ['ASM lines 19060-19068 show _LABEL_9491_ comparing _RAM_D151_ with DE=0x00C0 and returning carry status.'],
  }),
  code(0x0949F, '_LABEL_949F_', 'motion_x_lower_clamp_fec9_head', 'Lower-bound clamp head that selects DE=0xFEC9 before falling into the shared signed X clamp body at _LABEL_94A4_.', {
    ramRefs: ['_RAM_D151_', '_RAM_D150_', '_RAM_D14F_'],
    evidence: ['ASM lines 19070-19076 show _LABEL_949F_ loading DE=0xFEC9 and falling into the shared clamp body used by _LABEL_94A4_.'],
  }),
  table(0x09749, '_DATA_9749_', 'bank2_sequence_opcode_jump_table', ['_LABEL_9755_', '_LABEL_9762_', '_LABEL_9767_', '_LABEL_976D_', '_LABEL_977B_', '_LABEL_9785_'], 'Six-entry sequence opcode jump table reached after _LABEL_972B_ sees an opcode byte >= 0xF1.', 'ASM lines 19438-19441 show opcode dispatch through RST 20 and mark the jump table from 9749 to 9754 with six .dw entries.'),
  code(0x09767, '_LABEL_9767_', 'sequence_opcode_set_return_pointer', 'Sequence opcode handler that reads a word through RST 18, stores it in _RAM_D172_, and resumes parsing at _LABEL_972B_.', {
    table: streamOpcodeTable,
    tableIndex: 2,
    calls: ['_LABEL_18_'],
    ramRefs: ['_RAM_D172_'],
    evidence: ['ASM lines 19458-19462 identify _LABEL_9767_ as the third _DATA_9749_ entry and store the RST 18 word result in _RAM_D172_.'],
  }),
  code(0x0976D, '_LABEL_976D_', 'sequence_opcode_loop_decrement', 'Sequence opcode loop handler that decrements _RAM_D16F_, either continues at the current stream or jumps back to _RAM_D174_.', {
    table: streamOpcodeTable,
    tableIndex: 3,
    ramRefs: ['_RAM_D16F_', '_RAM_D174_'],
    evidence: ['ASM lines 19464-19471 identify _LABEL_976D_ as the fourth _DATA_9749_ entry and show the loop decrement/jumpback behavior.'],
  }),
  code(0x0977B, '_LABEL_977B_', 'sequence_opcode_loop_setup', 'Sequence opcode loop setup handler that reads a repeat count into _RAM_D16F_, stores the loop body pointer in _RAM_D174_, and resumes parsing.', {
    table: streamOpcodeTable,
    tableIndex: 4,
    ramRefs: ['_RAM_D16F_', '_RAM_D174_'],
    evidence: ['ASM lines 19473-19479 identify _LABEL_977B_ as the fifth _DATA_9749_ entry and show repeat count plus loop pointer setup.'],
  }),
  code(0x09785, '_LABEL_9785_', 'sequence_opcode_delay_and_resume', 'Sequence opcode delay handler that reads a delay byte into _RAM_D15E_, stores the resume pointer in _RAM_D170_, and returns.', {
    table: streamOpcodeTable,
    tableIndex: 5,
    ramRefs: ['_RAM_D15E_', '_RAM_D170_'],
    evidence: ['ASM lines 19481-19486 identify _LABEL_9785_ as the sixth _DATA_9749_ entry and store delay/resume state.'],
  }),
  code(0x097F8, '_LABEL_97F8_', 'tile_stream_vdp_clip_and_write_inner_loop', 'Inner VDP writer for bank-2 tile streams; checks DE against VRAM window 0x7900-0x7D7F, writes address/data through VDP ports when visible, and skips encoded rows when offscreen.', {
    calls: [],
    ramRefs: ['_RAM_D178_', '_RAM_D17A_', '_RAM_D17B_'],
    ioPorts: ['Port_VDPAddress', 'Port_VDPData'],
    evidence: ['ASM lines 19566-19614 show _LABEL_97F8_ clipping DE against VRAM bounds, writing VDP address/data ports when visible, and skipping encoded stream pairs when outside the visible window.'],
  }),
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
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

function wasInferredOnlyBeforeThisAudit(region) {
  if (!region) return false;
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank2MotionSequenceAudit');
  return keys.length === 1 && keys[0] === 'inferred';
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      entryCount: ENTRIES.length,
      transitionEntryCount: ENTRIES.filter(item => item.table === transitionTable).length,
      sequenceOpcodeEntryCount: ENTRIES.filter(item => item.table === streamOpcodeTable).length,
      pointerTableCount: ENTRIES.filter(item => item.type === 'pointer_table').length,
      assetPolicy: 'Metadata only: ASM labels, offsets, table entries by label, RAM/IX/port references, calls, and evidence. No ROM bytes or decoded graphics are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    evidence: [
      'ASM lines 17197-17203 define the _LABEL_8657_ motion wait phase reached from _LABEL_85E9_.',
      'ASM lines 18778-18885 define the _DATA_92C8_ transition decision table and its entry heads.',
      'ASM lines 18968-19076 define the bank-2 motion range/clamp helpers.',
      'ASM lines 19438-19614 define the _DATA_9749_ sequence opcode table and the visible VDP stream writer loop.',
    ],
  };
}

function annotateRegion(region, item) {
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  const previousType = region.type || 'unknown';
  if (item.type === 'pointer_table') region.type = 'pointer_table';
  if (!region.name || region.name.startsWith('Jump Table @')) region.name = item.name;
  if (!region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank2MotionSequenceAudit = {
    catalogId,
    kind: item.role,
    family: item.family,
    label: item.label,
    confidence: item.confidence,
    previousType,
    correctedType: item.type === 'pointer_table' ? 'pointer_table' : previousType,
    table: item.table,
    tableIndex: item.tableIndex,
    entries: item.entries || null,
    calls: item.calls,
    ramRefs: item.ramRefs,
    ioPorts: item.ioPorts,
    summary: item.summary,
    evidence: item.evidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    label: item.label,
    role: item.role,
    previousType,
    correctedType: region.type,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
  };
}

function applyAnnotations(mapData) {
  const annotated = [];
  const missing = [];
  for (const item of ENTRIES) {
    const region = findExactRegion(mapData, item.offset);
    if (!region) {
      missing.push({ offset: hex(item.offset), label: item.label, role: item.role });
      continue;
    }
    annotated.push(annotateRegion(region, item));
  }
  return { annotated, missing };
}

function main() {
  const mapData = readJson(mapPath);
  let changes = { annotated: [], missing: [] };

  if (apply) {
    changes = applyAnnotations(mapData);
    const finalCatalog = buildCatalog(mapData);
    mapData.bank2MotionSequenceCatalogs = (mapData.bank2MotionSequenceCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.bank2MotionSequenceCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_motion_sequence_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: changes.annotated.length,
        missingRegions: changes.missing.length,
        inferredOnlyRegionsCovered: changes.annotated.filter(change => change.wasInferredOnlyBeforeAudit).length,
        retypedPointerTables: changes.annotated.filter(change => change.previousType !== change.correctedType && change.correctedType === 'pointer_table').length,
      },
      annotatedRegions: changes.annotated,
      missingRegions: changes.missing,
      nextLeads: [
        'Resolve _DATA_92C8_ caller context and index source to name the eight transition decisions by gameplay object or room sequence.',
        'Decode the _LABEL_972B_ sequence bytecode commands around _DATA_9749_ into a read-only analyzer model.',
        'Connect _LABEL_97F8_ VDP stream writes to specific bank-2 tile/map stream data without storing stream bytes.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  const catalog = buildCatalog(apply ? readJson(mapPath) : mapData);
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: changes.annotated.length,
      missingRegions: changes.missing.length,
      inferredOnlyRegionsCovered: changes.annotated.filter(change => change.wasInferredOnlyBeforeAudit).length,
      retypedPointerTables: changes.annotated.filter(change => change.previousType !== change.correctedType && change.correctedType === 'pointer_table').length,
    },
    missingRegions: changes.missing,
  }, null, 2));
}

main();
