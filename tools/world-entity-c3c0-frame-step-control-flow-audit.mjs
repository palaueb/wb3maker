#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const opcodeDataDir = path.join(repoRoot, 'tools/z80-opcodes/data');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-entity-c3c0-frame-step-control-flow-catalog-2026-06-25';
const reportId = 'entity-c3c0-frame-step-control-flow-audit-2026-06-25';
const toolName = 'tools/world-entity-c3c0-frame-step-control-flow-audit.mjs';

const sourceCatalogIds = {
  frameStepDiagnostic: 'world-entity-c3c0-frame-step-diagnostic-catalog-2026-06-25',
  targetSemantics: 'world-entity-c3c0-behavior-target-semantics-catalog-2026-06-25',
  runtimeStruct: 'world-entity-runtime-struct-field-catalog-2026-06-25',
};

const relativeJrOpcodes = new Set([0x10, 0x18, 0x20, 0x28, 0x30, 0x38]);
const callOpcodes = new Set([0xC4, 0xCC, 0xCD, 0xD4, 0xDC, 0xE4, 0xEC, 0xF4, 0xFC]);
const jumpOpcodes = new Set([0xC2, 0xC3, 0xCA, 0xD2, 0xDA, 0xE2, 0xEA, 0xF2, 0xFA]);
const retOpcodes = new Set([0xC0, 0xC8, 0xC9, 0xD0, 0xD8, 0xE0, 0xE8, 0xF0, 0xF8]);
const conditionByOpcode = {
  0x10: 'djnz',
  0x18: 'always',
  0x20: 'nz',
  0x28: 'z',
  0x30: 'nc',
  0x38: 'c',
  0xC0: 'nz',
  0xC8: 'z',
  0xC9: 'always',
  0xD0: 'nc',
  0xD8: 'c',
  0xE0: 'po',
  0xE8: 'pe',
  0xF0: 'p',
  0xF8: 'm',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, width = 5) {
  return `0x${Number(n || 0).toString(16).toUpperCase().padStart(width, '0')}`;
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function signedByte(value) {
  return value & 0x80 ? value - 0x100 : value;
}

function offsetOf(region) {
  return typeof region?.offset === 'number' ? region.offset : parseHex(region?.offset) || 0;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + Number(region.size || 0);
  }) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
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
  return [...new Set((items || []).filter(item => item !== '' && item != null))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (key === '' || key == null) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
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
  if (pc >= rom.length) return { offset: pc, size: 1, group: 'truncated', opcode, truncated: true };

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
        indexedBitOperation: bitOperationForIndexedCb(op),
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
      indexedOperation: indexedOperationForOpcode(next),
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
      registerBitOperation: opcode === 0xCB ? bitOperationForRegisterCb(next) : null,
      ret: opcode === 0xED && (next === 0x45 || next === 0x4D),
      conditional: false,
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
    baseOperation: baseOperationForOpcode(opcode),
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
    instruction.condition = conditionByOpcode[opcode] || '';
  }
  if (retOpcodes.has(opcode)) {
    instruction.ret = true;
    instruction.conditional = opcode !== 0xC9;
    instruction.condition = conditionByOpcode[opcode] || '';
  }
  return instruction;
}

function bitOperationForIndexedCb(opcode) {
  if (opcode >= 0x40 && opcode <= 0x7F) return { kind: 'indexed_bit_test', bitRole: bitRole((opcode >> 3) & 0x07) };
  if (opcode >= 0x80 && opcode <= 0xBF) return { kind: 'indexed_bit_reset', bitRole: bitRole((opcode >> 3) & 0x07) };
  if (opcode >= 0xC0 && opcode <= 0xFF) return { kind: 'indexed_bit_set', bitRole: bitRole((opcode >> 3) & 0x07) };
  return null;
}

function bitOperationForRegisterCb(opcode) {
  if (opcode >= 0x40 && opcode <= 0x7F) return { kind: 'register_bit_test', bitRole: bitRole((opcode >> 3) & 0x07) };
  if (opcode >= 0x80 && opcode <= 0xBF) return { kind: 'register_bit_reset', bitRole: bitRole((opcode >> 3) & 0x07) };
  if (opcode >= 0xC0 && opcode <= 0xFF) return { kind: 'register_bit_set', bitRole: bitRole((opcode >> 3) & 0x07) };
  return null;
}

function bitRole(index) {
  if (index === 7) return 'high_bit';
  if (index === 0) return 'low_bit';
  return `bit_${index}`;
}

function indexedOperationForOpcode(opcode) {
  if (opcode === 0x34) return 'indexed_increment';
  if (opcode === 0x35) return 'indexed_decrement';
  if (opcode === 0x36) return 'indexed_immediate_write_value_withheld';
  if ((opcode >= 0x70 && opcode <= 0x75) || opcode === 0x77) return 'indexed_register_write';
  if (opcode === 0xBE) return 'indexed_compare';
  if ([0x46, 0x4E, 0x56, 0x5E, 0x66, 0x6E, 0x7E].includes(opcode)) return 'indexed_register_read';
  if ([0x86, 0x8E, 0x96, 0x9E, 0xA6, 0xAE, 0xB6].includes(opcode)) return 'indexed_alu_read';
  return 'indexed_access';
}

function indexedReadDestRegister(opcode) {
  return {
    0x46: 'B',
    0x4E: 'C',
    0x56: 'D',
    0x5E: 'E',
    0x66: 'H',
    0x6E: 'L',
    0x7E: 'A',
  }[opcode] || '';
}

function indexedWriteSourceRegister(opcode) {
  return {
    0x70: 'B',
    0x71: 'C',
    0x72: 'D',
    0x73: 'E',
    0x74: 'H',
    0x75: 'L',
    0x77: 'A',
  }[opcode] || '';
}

function baseRegisterTransfer(opcode) {
  const transfers = {
    0x06: { kind: 'register_literal_load_value_withheld', destRegister: 'B' },
    0x0E: { kind: 'register_literal_load_value_withheld', destRegister: 'C' },
    0x16: { kind: 'register_literal_load_value_withheld', destRegister: 'D' },
    0x1E: { kind: 'register_literal_load_value_withheld', destRegister: 'E' },
    0x26: { kind: 'register_literal_load_value_withheld', destRegister: 'H' },
    0x2E: { kind: 'register_literal_load_value_withheld', destRegister: 'L' },
    0x3E: { kind: 'register_literal_load_value_withheld', destRegister: 'A' },
    0x47: { kind: 'register_transfer', destRegister: 'B', sourceRegister: 'A' },
    0x4F: { kind: 'register_transfer', destRegister: 'C', sourceRegister: 'A' },
    0x57: { kind: 'register_transfer', destRegister: 'D', sourceRegister: 'A' },
    0x5F: { kind: 'register_transfer', destRegister: 'E', sourceRegister: 'A' },
    0x67: { kind: 'register_transfer', destRegister: 'H', sourceRegister: 'A' },
    0x6F: { kind: 'register_transfer', destRegister: 'L', sourceRegister: 'A' },
    0x78: { kind: 'register_transfer', destRegister: 'A', sourceRegister: 'B' },
    0x79: { kind: 'register_transfer', destRegister: 'A', sourceRegister: 'C' },
    0x7A: { kind: 'register_transfer', destRegister: 'A', sourceRegister: 'D' },
    0x7B: { kind: 'register_transfer', destRegister: 'A', sourceRegister: 'E' },
    0x7C: { kind: 'register_transfer', destRegister: 'A', sourceRegister: 'H' },
    0x7D: { kind: 'register_transfer', destRegister: 'A', sourceRegister: 'L' },
  };
  return transfers[opcode] || null;
}

function baseOperationForOpcode(opcode) {
  const transfer = baseRegisterTransfer(opcode);
  if (transfer) return transfer.kind;
  if (opcode === 0x3A) return 'accumulator_load_absolute_ram_address_withheld';
  if (opcode === 0xB7) return 'accumulator_or_self_zero_sign_test';
  if (opcode === 0xE6) return 'accumulator_mask_literal_withheld';
  if (opcode === 0xC6) return 'accumulator_add_literal_withheld';
  if (opcode === 0xD6) return 'accumulator_subtract_literal_withheld';
  if (opcode === 0xFE) return 'accumulator_compare_literal_withheld';
  if (opcode >= 0x90 && opcode <= 0x97) return 'accumulator_subtract_register';
  if (opcode >= 0xB8 && opcode <= 0xBF) return 'accumulator_compare_register';
  if (opcode === 0x3D) return 'accumulator_decrement';
  if (opcode === 0x3C) return 'accumulator_increment';
  if (opcode === 0xAF) return 'accumulator_clear';
  if (opcode === 0x79) return 'load_accumulator_from_c';
  if (opcode === 0x78) return 'load_accumulator_from_b';
  if (opcode === 0x7C) return 'load_accumulator_from_h';
  if (opcode === 0x7D) return 'load_accumulator_from_l';
  return '';
}

function structFieldIndex(mapData) {
  const catalog = requireCatalog(mapData, sourceCatalogIds.runtimeStruct);
  const fields = new Map();
  for (const field of catalog.fields || []) {
    const offset = field.offset ?? field.fieldOffset;
    if (field.register && offset != null) fields.set(`${field.register}+${offset}`, field);
    if (field.token) fields.set(field.token, field);
  }
  return fields;
}

function fieldMeta(fieldIndex, token) {
  const known = fieldIndex.get(token) || null;
  return {
    token,
    role: known?.role || '',
    fieldGroup: known?.fieldGroup || '',
    confidence: known ? 'catalog_backed' : 'role_pending',
  };
}

function collectInstructions(rom, tables, start, end) {
  const queue = [start];
  const visited = new Set();
  const instructions = [];
  const warnings = [];

  function inSegment(target) {
    return target >= start && target < end;
  }

  function queueTarget(target) {
    if (!inSegment(target)) return false;
    if (!visited.has(target) && !queue.includes(target)) queue.push(target);
    return true;
  }

  while (queue.length) {
    let pc = queue.shift();
    while (pc < end && pc < rom.length && !visited.has(pc)) {
      const inst = decodeInstruction(rom, tables, pc, end);
      visited.add(pc);
      instructions.push(inst);
      if (inst.truncated) {
        warnings.push(`reachable instruction crossed segment boundary ${hex(end)} at ${hex(pc)}`);
        break;
      }
      if (inst.size <= 0) {
        warnings.push(`zero-sized decode at ${hex(pc)}`);
        break;
      }
      const nextPc = pc + inst.size;
      if (inst.ret && !inst.conditional) break;
      if (inst.controlKind === 'jump') {
        const queued = queueTarget(inst.absoluteTarget);
        if (!inst.conditional) {
          if (!queued) warnings.push(`unconditional jump leaves segment at ${hex(pc)} -> ${hex(inst.absoluteTarget)}`);
          break;
        }
      }
      if (inst.controlKind === 'relative_jump' || inst.controlKind === 'djnz') {
        const queued = queueTarget(inst.relativeTarget);
        if (!inst.conditional) {
          if (!queued) warnings.push(`unconditional relative jump leaves segment at ${hex(pc)} -> ${hex(inst.relativeTarget)}`);
          break;
        }
      }
      pc = nextPc;
    }
  }

  instructions.sort((a, b) => a.offset - b.offset);
  return { instructions, warnings };
}

function callPlanByOffset(state) {
  return new Map((state.callPlan || []).map(call => [call.callOffset, call]));
}

function instructionOperation(inst, fieldIndex, callsByOffset) {
  if (inst.indexedRef) {
    const meta = fieldMeta(fieldIndex, inst.indexedRef.token);
    const bit = inst.indexedBitOperation || null;
    return {
      offset: hex(inst.offset),
      kind: bit?.kind || inst.indexedOperation || 'indexed_access',
      token: inst.indexedRef.token,
      fieldRole: meta.role,
      fieldGroup: meta.fieldGroup,
      fieldConfidence: meta.confidence,
      access: inst.indexedRef.access,
      bitRole: bit?.bitRole || '',
      destRegister: indexedReadDestRegister(inst.opcode),
      sourceRegister: indexedWriteSourceRegister(inst.opcode),
      valuePolicy: inst.immediateWriteToIndexedField ? 'literal_value_withheld' : 'no_literal_value_persisted',
      persistedGameplayValueCount: 0,
    };
  }
  if (inst.registerBitOperation) {
    return {
      offset: hex(inst.offset),
      kind: inst.registerBitOperation.kind,
      bitRole: inst.registerBitOperation.bitRole,
      valuePolicy: 'no_literal_value_persisted',
      persistedGameplayValueCount: 0,
    };
  }
  if (inst.baseOperation) {
    const transfer = baseRegisterTransfer(inst.opcode);
    return {
      offset: hex(inst.offset),
      kind: inst.baseOperation,
      destRegister: transfer?.destRegister || '',
      sourceRegister: transfer?.sourceRegister || '',
      valuePolicy: inst.baseOperation.includes('literal') ? 'literal_value_withheld' : 'no_literal_value_persisted',
      persistedGameplayValueCount: 0,
    };
  }
  if (inst.controlKind === 'call') {
    const callOffset = hex(inst.offset);
    const call = callsByOffset.get(callOffset) || null;
    return {
      offset: callOffset,
      kind: 'helper_call_flag_source_candidate',
      targetOffset: call?.targetOffset || hex(inst.absoluteTarget),
      targetLabel: call?.targetLabel || '',
      helperRole: call?.role || '',
      helperResolutionStatus: call?.resolutionStatus || '',
      valuePolicy: 'no_literal_value_persisted',
      persistedGameplayValueCount: 0,
    };
  }
  return null;
}

function annotateRegisterSources(operations) {
  const registers = new Map();
  const out = [];
  for (const operation of operations) {
    const annotated = { ...operation };
    if (operation.kind === 'helper_call_flag_source_candidate') {
      registers.clear();
    }
    if (operation.kind === 'indexed_register_read' && operation.destRegister) {
      const source = {
        sourceKind: 'indexed_field',
        token: operation.token || '',
        fieldRole: operation.fieldRole || '',
        fieldGroup: operation.fieldGroup || '',
        sourceOffset: operation.offset,
      };
      registers.set(operation.destRegister, source);
      if (operation.destRegister === 'A') annotated.accumulatorSource = source;
    }
    if (operation.kind === 'register_transfer' && operation.destRegister) {
      const source = registers.get(operation.sourceRegister) || {
        sourceKind: 'register_source_pending',
        sourceRegister: operation.sourceRegister || '',
        sourceOffset: operation.offset,
      };
      registers.set(operation.destRegister, source);
      if (operation.destRegister === 'A') annotated.accumulatorSource = source;
    }
    if (operation.kind === 'register_literal_load_value_withheld' && operation.destRegister) {
      registers.set(operation.destRegister, {
        sourceKind: 'literal_value_withheld',
        sourceOffset: operation.offset,
      });
      if (operation.destRegister === 'A') {
        annotated.accumulatorSource = registers.get(operation.destRegister);
      }
    }
    if (operation.kind === 'accumulator_load_absolute_ram_address_withheld') {
      const source = {
        sourceKind: 'absolute_ram_address_withheld',
        sourceOffset: operation.offset,
      };
      registers.set('A', source);
      annotated.accumulatorSource = source;
    }
    if ([
      'accumulator_or_self_zero_sign_test',
      'accumulator_mask_literal_withheld',
      'accumulator_add_literal_withheld',
      'accumulator_subtract_literal_withheld',
      'accumulator_compare_literal_withheld',
      'accumulator_subtract_register',
      'accumulator_compare_register',
      'accumulator_increment',
      'accumulator_decrement',
    ].includes(operation.kind)) {
      annotated.accumulatorSource = registers.get('A') || {
        sourceKind: 'accumulator_source_pending',
        sourceOffset: operation.offset,
      };
    }
    if (operation.kind === 'accumulator_clear') {
      registers.set('A', {
        sourceKind: 'literal_value_withheld',
        sourceOffset: operation.offset,
      });
    }
    out.push(annotated);
  }
  return out;
}

function previousOperations(operations, offset, limit = 4) {
  return operations
    .filter(operation => parseHex(operation.offset) < offset)
    .slice(-limit)
    .reverse();
}

function classifyPredicate(control, operations) {
  const offset = parseHex(control.offset);
  const previous = previousOperations(operations, offset);
  const [last, prior] = previous;
  if (last?.kind === 'indexed_bit_test') {
    return {
      status: 'symbolic',
      kind: 'indexed_field_bit_test',
      token: last.token || '',
      fieldRole: last.fieldRole || '',
      bitRole: last.bitRole || '',
      valuePolicy: 'bit_mask_value_not_persisted',
    };
  }
  if (last?.kind === 'indexed_decrement') {
    return {
      status: 'symbolic',
      kind: 'indexed_field_countdown_result',
      token: last.token || '',
      fieldRole: last.fieldRole || '',
      bitRole: '',
      valuePolicy: 'no_literal_value_persisted',
    };
  }
  if (last?.kind === 'indexed_compare') {
    return {
      status: 'symbolic',
      kind: 'indexed_field_compare_result',
      token: last.token || '',
      fieldRole: last.fieldRole || '',
      bitRole: '',
      valuePolicy: 'comparison_value_not_persisted',
    };
  }
  const accumulatorSource = last?.accumulatorSource || null;
  const sourceToken = accumulatorSource?.token || prior?.token || '';
  const sourceRole = accumulatorSource?.fieldRole || prior?.fieldRole || '';
  const sourceKind = accumulatorSource?.sourceKind || '';
  if (last?.kind === 'accumulator_or_self_zero_sign_test' && sourceToken) {
    return {
      status: 'symbolic',
      kind: 'indexed_field_zero_or_sign_test',
      token: sourceToken,
      fieldRole: sourceRole,
      bitRole: '',
      valuePolicy: 'no_literal_value_persisted',
    };
  }
  if (last?.kind === 'accumulator_or_self_zero_sign_test' && sourceKind === 'absolute_ram_address_withheld') {
    return {
      status: 'symbolic',
      kind: 'absolute_ram_zero_or_sign_test',
      token: '',
      fieldRole: '',
      bitRole: '',
      valuePolicy: 'absolute_ram_address_and_value_withheld',
    };
  }
  if (last?.kind === 'accumulator_compare_literal_withheld' && sourceToken) {
    return {
      status: 'symbolic',
      kind: 'indexed_field_literal_compare',
      token: sourceToken,
      fieldRole: sourceRole,
      bitRole: '',
      valuePolicy: 'comparison_literal_value_withheld',
    };
  }
  if (last?.kind === 'accumulator_compare_literal_withheld' && sourceKind === 'absolute_ram_address_withheld') {
    return {
      status: 'symbolic',
      kind: 'absolute_ram_literal_compare',
      token: '',
      fieldRole: '',
      bitRole: '',
      valuePolicy: 'absolute_ram_address_and_comparison_literal_withheld',
    };
  }
  if (last?.kind === 'accumulator_mask_literal_withheld' && sourceToken) {
    return {
      status: 'symbolic',
      kind: 'indexed_field_mask_test',
      token: sourceToken,
      fieldRole: sourceRole,
      bitRole: '',
      valuePolicy: 'mask_literal_value_withheld',
    };
  }
  if (last?.kind === 'accumulator_mask_literal_withheld' && sourceKind === 'absolute_ram_address_withheld') {
    return {
      status: 'symbolic',
      kind: 'absolute_ram_mask_test',
      token: '',
      fieldRole: '',
      bitRole: '',
      valuePolicy: 'absolute_ram_address_and_mask_literal_withheld',
    };
  }
  if (last?.kind === 'accumulator_subtract_literal_withheld' && sourceToken) {
    return {
      status: 'symbolic',
      kind: 'indexed_field_literal_subtract_flags',
      token: sourceToken,
      fieldRole: sourceRole,
      bitRole: '',
      valuePolicy: 'subtract_literal_value_withheld',
    };
  }
  if (last?.kind === 'accumulator_add_literal_withheld' && sourceToken) {
    return {
      status: 'symbolic',
      kind: 'indexed_field_literal_add_flags',
      token: sourceToken,
      fieldRole: sourceRole,
      bitRole: '',
      valuePolicy: 'add_literal_value_withheld',
    };
  }
  if (last?.kind === 'accumulator_subtract_register' && sourceToken) {
    return {
      status: 'symbolic',
      kind: 'indexed_field_register_subtract_flags',
      token: sourceToken,
      fieldRole: sourceRole,
      bitRole: '',
      valuePolicy: 'register_operand_value_not_persisted',
    };
  }
  if (last?.kind === 'accumulator_compare_register' && sourceToken) {
    return {
      status: 'symbolic',
      kind: 'indexed_field_register_compare',
      token: sourceToken,
      fieldRole: sourceRole,
      bitRole: '',
      valuePolicy: 'register_operand_value_not_persisted',
    };
  }
  if (last?.kind === 'register_bit_test') {
    return {
      status: 'symbolic',
      kind: 'register_bit_test',
      token: '',
      fieldRole: '',
      bitRole: last.bitRole || '',
      valuePolicy: 'register_source_pending_no_value_persisted',
    };
  }
  if (last?.kind === 'helper_call_flag_source_candidate') {
    return {
      status: 'symbolic',
      kind: 'helper_call_flag_result',
      token: '',
      fieldRole: '',
      bitRole: '',
      helperRole: last.helperRole || '',
      helperTargetOffset: last.targetOffset || '',
      valuePolicy: 'helper_flag_semantics_not_frame_exact',
    };
  }
  if (last && !last.kind.includes('write')) {
    return {
      status: 'source_pending',
      kind: 'processor_flag_result_source_pending',
      token: last.token || '',
      fieldRole: last.fieldRole || '',
      bitRole: last.bitRole || '',
      valuePolicy: last.valuePolicy || 'no_literal_value_persisted',
    };
  }
  return {
    status: 'source_pending',
    kind: 'processor_flag_result_source_pending',
    token: '',
    fieldRole: '',
    bitRole: '',
    valuePolicy: 'no_literal_value_persisted',
  };
}

function relativeBranches(instructions, operations, start, end) {
  return instructions
    .filter(inst => inst.controlKind === 'relative_jump' || inst.controlKind === 'djnz')
    .map(inst => {
      const conditional = Boolean(inst.conditional);
      return {
        offset: hex(inst.offset),
        kind: inst.controlKind,
        condition: inst.condition || (conditional ? 'conditional' : 'always'),
        conditional,
        targetOffset: hex(inst.relativeTarget),
        targetRelation: inst.relativeTarget >= inst.offset ? 'forward' : 'backward',
        targetInSegment: inst.relativeTarget >= start && inst.relativeTarget < end,
        predicate: conditional ? classifyPredicate({ offset: hex(inst.offset) }, operations) : {
          status: 'not_applicable',
          kind: 'unconditional_relative_jump',
          valuePolicy: 'no_literal_value_persisted',
        },
      };
    });
}

function conditionalExits(instructions, operations) {
  return instructions
    .filter(inst => inst.ret && inst.conditional)
    .map(inst => ({
      offset: hex(inst.offset),
      kind: 'conditional_return',
      condition: inst.condition || 'conditional',
      predicate: classifyPredicate({ offset: hex(inst.offset) }, operations),
    }));
}

function fieldOperationSummary(operations) {
  const fieldOps = operations.filter(operation => operation.token);
  return {
    operationCount: fieldOps.length,
    tokens: unique(fieldOps.map(operation => operation.token)),
    fieldRoles: unique(fieldOps.map(operation => operation.fieldRole)),
    operationKindCounts: countBy(fieldOps, operation => operation.kind),
    tokenOperationCounts: countBy(fieldOps, operation => operation.token),
  };
}

function stateControlRole(state, branches, exits, operations) {
  const operationKinds = new Set(operations.map(operation => operation.kind));
  const branchPredicates = [...branches, ...exits].map(item => item.predicate?.kind).filter(Boolean);
  if (state.behaviorStateIndex === 0) return 'entry_guard_and_clear_path';
  if (branchPredicates.includes('indexed_field_countdown_result')) return 'countdown_to_behavior_state_transition';
  if (operationKinds.has('indexed_bit_test') && operationKinds.has('indexed_bit_set')) return 'first_tick_setup_then_runtime_update';
  if (operationKinds.has('indexed_immediate_write_value_withheld')) return 'field_seed_then_runtime_update';
  return 'symbolic_runtime_update';
}

function buildStateControlModel(mapData, rom, tables, fieldIndex, state, semantics) {
  const start = parseHex(state.targetOffset);
  const end = parseHex(semantics?.segment?.endExclusive);
  if (start == null || end == null) throw new Error(`Missing target segment for state ${state.behaviorStateIndex}`);
  const collected = collectInstructions(rom, tables, start, end);
  const callsByOffset = callPlanByOffset(state);
  const operations = annotateRegisterSources(collected.instructions
    .map(inst => instructionOperation(inst, fieldIndex, callsByOffset))
    .filter(Boolean));
  const branches = relativeBranches(collected.instructions, operations, start, end);
  const exits = conditionalExits(collected.instructions, operations);
  const conditionalControls = [...branches.filter(branch => branch.conditional), ...exits];
  const unclassifiedConditionalControlCount = conditionalControls.filter(item => item.predicate?.status !== 'symbolic').length;
  const behaviorStateOps = operations.filter(operation => operation.token === 'IX+32');
  const timerOps = operations.filter(operation =>
    ['timer_age_counter', 'variant_aux_parameter', 'secondary_lifetime_or_start_aux', 'animation_delay_or_reward_timer'].includes(operation.fieldRole)
  );
  const countdownOps = timerOps.filter(operation =>
    ['indexed_decrement', 'indexed_field_countdown_result'].includes(operation.kind)
  );
  const firstTickGuardBranches = [...branches, ...exits].filter(item =>
    item.predicate?.kind === 'indexed_field_bit_test' &&
    item.predicate?.token === 'IX+32' &&
    item.predicate?.bitRole === 'high_bit'
  );
  const writesBehaviorState = behaviorStateOps.some(operation =>
    ['indexed_immediate_write_value_withheld', 'indexed_register_write', 'indexed_increment', 'indexed_decrement', 'indexed_bit_set', 'indexed_bit_reset'].includes(operation.kind)
  );
  const branchPredicateKinds = unique(conditionalControls.map(item => item.predicate?.kind));

  return {
    behaviorStateIndex: state.behaviorStateIndex,
    targetOffset: state.targetOffset,
    targetRegion: state.targetRegion || null,
    segment: {
      start: hex(start),
      endExclusive: hex(end),
      sizeBytes: Math.max(0, end - start),
      boundarySource: semantics?.segment?.boundarySource || 'target_semantics_catalog',
    },
    modelRole: state.modelRole || '',
    controlRole: stateControlRole(state, branches, exits, operations),
    callPlanCount: Number(state.callPlanCount || 0),
    relativeBranchCount: branches.length,
    conditionalBranchCount: branches.filter(branch => branch.conditional).length,
    conditionalExitCount: exits.length,
    symbolicPredicateCount: conditionalControls.filter(item => item.predicate?.status === 'symbolic').length,
    unclassifiedConditionalControlCount,
    branchPredicateKinds,
    firstTickGuardBranchCount: firstTickGuardBranches.length,
    behaviorStateOperationCount: behaviorStateOps.length,
    behaviorStateWrites: writesBehaviorState,
    timerOperationCount: timerOps.length,
    countdownOperationCount: countdownOps.length,
    timerFieldRoles: unique(timerOps.map(operation => operation.fieldRole)),
    fieldSummary: fieldOperationSummary(operations),
    fieldOperations: operations
      .filter(operation => operation.token)
      .map(operation => compactOperation(operation)),
    relativeBranches: branches,
    conditionalExits: exits,
    behaviorStateOperations: behaviorStateOps.map(operation => compactOperation(operation)),
    timerOperations: timerOps.map(operation => compactOperation(operation)),
    persistedRomByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedGameplayValueCount: 0,
    confidence: unclassifiedConditionalControlCount ? 'medium' : 'high',
    frameExactStatus: 'symbolic_control_flow_only_no_literals_or_frame_values',
    evidence: [
      `${sourceCatalogIds.frameStepDiagnostic} selected behavior state ${state.behaviorStateIndex} at ${state.targetOffset}.`,
      `${sourceCatalogIds.targetSemantics} supplies the bounded segment ${hex(start)}-${hex(end)}; this tool rescans locally and persists only symbolic control-flow metadata.`,
      `${sourceCatalogIds.runtimeStruct} supplies field roles for indexed RAM tokens where available.`,
    ],
  };
}

function compactOperation(operation) {
  return {
    offset: operation.offset,
    kind: operation.kind,
    token: operation.token || '',
    fieldRole: operation.fieldRole || '',
    fieldGroup: operation.fieldGroup || '',
    access: operation.access || '',
    bitRole: operation.bitRole || '',
    valuePolicy: operation.valuePolicy || 'no_literal_value_persisted',
    persistedGameplayValueCount: 0,
  };
}

function targetSemanticsByOffset(catalog) {
  return new Map((catalog.targets || []).map(target => [target.targetOffset, target]));
}

function summarizeStateModels(stateModels, diagnosticSummary) {
  const relativeBranchCount = stateModels.reduce((sum, state) => sum + state.relativeBranchCount, 0);
  const conditionalBranchCount = stateModels.reduce((sum, state) => sum + state.conditionalBranchCount, 0);
  const conditionalExitCount = stateModels.reduce((sum, state) => sum + state.conditionalExitCount, 0);
  const conditionalControlCount = conditionalBranchCount + conditionalExitCount;
  const symbolicPredicateCount = stateModels.reduce((sum, state) => sum + state.symbolicPredicateCount, 0);
  const unclassifiedConditionalControlCount = stateModels.reduce((sum, state) => sum + state.unclassifiedConditionalControlCount, 0);
  const timerOperationCount = stateModels.reduce((sum, state) => sum + state.timerOperationCount, 0);
  const countdownOperationCount = stateModels.reduce((sum, state) => sum + state.countdownOperationCount, 0);
  return {
    candidateEntityType: diagnosticSummary.candidateEntityType || '',
    candidateSeedLabel: diagnosticSummary.candidateSeedLabel || '',
    behaviorListSource: diagnosticSummary.behaviorListSource || '',
    behaviorStateCount: stateModels.length,
    relativeBranchCount,
    conditionalBranchCount,
    conditionalExitCount,
    conditionalControlCount,
    symbolicPredicateCount,
    unclassifiedConditionalControlCount,
    symbolicPredicateStateCount: stateModels.filter(state => state.symbolicPredicateCount > 0).length,
    firstTickGuardStateCount: stateModels.filter(state => state.firstTickGuardBranchCount > 0).length,
    behaviorStateOperationStateCount: stateModels.filter(state => state.behaviorStateOperationCount > 0).length,
    behaviorStateWriteStateCount: stateModels.filter(state => state.behaviorStateWrites).length,
    timerOperationStateCount: stateModels.filter(state => state.timerOperationCount > 0).length,
    countdownOperationStateCount: stateModels.filter(state => state.countdownOperationCount > 0).length,
    timerOperationCount,
    countdownOperationCount,
    branchPredicateKindCounts: countBy(stateModels.flatMap(state => state.branchPredicateKinds), kind => kind),
    controlRoleCounts: countBy(stateModels, state => state.controlRole),
    fieldTokenCount: unique(stateModels.flatMap(state => state.fieldSummary.tokens)).length,
    frameExactStateCount: 0,
    diagnosticStatus: unclassifiedConditionalControlCount
      ? 'symbolic_control_flow_partially_classified_not_frame_exact'
      : 'symbolic_control_flow_ready_not_frame_exact',
    persistedRomByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedTileByteCount: 0,
    persistedPixelCount: 0,
    persistedCoordinateCount: 0,
    persistedGameplayValueCount: 0,
    assetPolicy: 'Metadata only: labels, offsets, field tokens, field roles, branch/control categories, bit roles, counts, statuses, and evidence. No ROM bytes, decoded instruction byte streams, graphics, coordinates, screenshots, music, text, or gameplay constants are embedded.',
  };
}

function buildCatalog(mapData) {
  const diagnostic = requireCatalog(mapData, sourceCatalogIds.frameStepDiagnostic);
  const targetSemantics = requireCatalog(mapData, sourceCatalogIds.targetSemantics);
  requireCatalog(mapData, sourceCatalogIds.runtimeStruct);
  const rom = fs.readFileSync(romPath);
  const tables = loadOpcodeTables();
  const fieldIndex = structFieldIndex(mapData);
  const semanticsByOffset = targetSemanticsByOffset(targetSemantics);
  const stateModels = (diagnostic.readOnlyDiagnostic?.stateModels || []).map(state => {
    const semantics = semanticsByOffset.get(state.targetOffset);
    return buildStateControlModel(mapData, rom, tables, fieldIndex, state, semantics);
  });
  const summary = summarizeStateModels(stateModels, diagnostic.summary || {});
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    summary,
    stateModels,
    evidence: [
      `${sourceCatalogIds.frameStepDiagnostic} provides the actor 0x26 behavior-state call plan and target offsets.`,
      `${sourceCatalogIds.targetSemantics} provides the target segment boundaries previously verified by bounded control-flow scan.`,
      `${sourceCatalogIds.runtimeStruct} provides field roles for IX indexed runtime-slot references.`,
      'This catalog withholds literal operands and stores only symbolic branch, timer, and behavior-state metadata.',
    ],
    nextLeads: [
      'Trace the literal-withheld timer and compare operands in a private runtime probe, then decide which symbolic constants can be named without persisting raw gameplay data.',
      'Build a read-only browser stepper for actor 0x26 that consumes this control-flow catalog and logs helper stubs plus field-token touches.',
      'Join actor 0x26 room fixtures and dynamic-frame coverage to the state transitions to validate animation-state changes visually from user-loaded ROM data.',
    ],
  };
}

function annotateSeedRegion(region, catalog) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.c3c0FrameStepControlFlowAudit = {
    catalogId,
    kind: 'c3c0_frame_step_symbolic_control_flow',
    confidence: catalog.summary.unclassifiedConditionalControlCount ? 'medium' : 'high',
    entityType: catalog.summary.candidateEntityType,
    seedLabel: catalog.summary.candidateSeedLabel,
    behaviorListSource: catalog.summary.behaviorListSource,
    behaviorStateCount: catalog.summary.behaviorStateCount,
    conditionalControlCount: catalog.summary.conditionalControlCount,
    symbolicPredicateCount: catalog.summary.symbolicPredicateCount,
    unclassifiedConditionalControlCount: catalog.summary.unclassifiedConditionalControlCount,
    firstTickGuardStateCount: catalog.summary.firstTickGuardStateCount,
    behaviorStateWriteStateCount: catalog.summary.behaviorStateWriteStateCount,
    timerOperationStateCount: catalog.summary.timerOperationStateCount,
    diagnosticStatus: catalog.summary.diagnosticStatus,
    persistedRomByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedGameplayValueCount: 0,
    summary: `${catalog.summary.candidateEntityType} / ${catalog.summary.candidateSeedLabel} has symbolic branch/timer/behavior-state control-flow metadata for ${catalog.summary.behaviorStateCount} behavior state(s); frame-exact constants remain withheld.`,
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return regionRef(region);
}

function annotateTargetRegions(mapData, catalog) {
  const byRegion = new Map();
  for (const state of catalog.stateModels || []) {
    const regionId = state.targetRegion?.id;
    if (!regionId) continue;
    if (!byRegion.has(regionId)) byRegion.set(regionId, []);
    byRegion.get(regionId).push(state);
  }
  const annotated = [];
  for (const [regionId, states] of byRegion) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.c3c0FrameStepControlFlowTargetAudit = {
      catalogId,
      kind: 'c3c0_frame_step_symbolic_control_flow_target_region',
      confidence: states.some(state => state.unclassifiedConditionalControlCount) ? 'medium' : 'high',
      entityType: catalog.summary.candidateEntityType,
      seedLabel: catalog.summary.candidateSeedLabel,
      behaviorStateIndexes: states.map(state => state.behaviorStateIndex),
      targetOffsets: states.map(state => state.targetOffset),
      relativeBranchCount: states.reduce((sum, state) => sum + state.relativeBranchCount, 0),
      conditionalControlCount: states.reduce((sum, state) =>
        sum + state.conditionalBranchCount + state.conditionalExitCount, 0),
      symbolicPredicateCount: states.reduce((sum, state) => sum + state.symbolicPredicateCount, 0),
      unclassifiedConditionalControlCount: states.reduce((sum, state) => sum + state.unclassifiedConditionalControlCount, 0),
      timerOperationCount: states.reduce((sum, state) => sum + state.timerOperationCount, 0),
      behaviorStateOperationCount: states.reduce((sum, state) => sum + state.behaviorStateOperationCount, 0),
      persistedRomByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedGameplayValueCount: 0,
      summary: `${states.length} actor 0x26 state target(s) in this region now have symbolic branch/timer control-flow metadata.`,
      evidence: [
        `${catalog.id} maps state target offsets to symbolic control-flow models.`,
        'Only offsets, field tokens, field roles, branch categories, counts, statuses, and evidence are stored.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      region: regionRef(region),
      behaviorStateIndexes: states.map(state => state.behaviorStateIndex),
      targetOffsets: states.map(state => state.targetOffset),
      relativeBranchCount: states.reduce((sum, state) => sum + state.relativeBranchCount, 0),
      conditionalControlCount: states.reduce((sum, state) =>
        sum + state.conditionalBranchCount + state.conditionalExitCount, 0),
      symbolicPredicateCount: states.reduce((sum, state) => sum + state.symbolicPredicateCount, 0),
      unclassifiedConditionalControlCount: states.reduce((sum, state) => sum + state.unclassifiedConditionalControlCount, 0),
    });
  }
  return annotated;
}

function applyCatalog(mapData, catalog) {
  mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityBehaviorCatalogs.push(catalog);

  const diagnostic = requireCatalog(mapData, sourceCatalogIds.frameStepDiagnostic);
  const seedRegion = (mapData.regions || []).find(region => region.id === diagnostic.summary?.candidateSeedRegionId);
  const annotatedSeedRegion = annotateSeedRegion(seedRegion, catalog);
  const annotatedTargetRegions = annotateTargetRegions(mapData, catalog);

  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_c3c0_frame_step_control_flow_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedSeedRegionCount: annotatedSeedRegion ? 1 : 0,
      annotatedTargetRegionCount: annotatedTargetRegions.length,
    },
    annotatedSeedRegion,
    annotatedTargetRegions,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (apply) {
    applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    id: catalog.id,
    summary: catalog.summary,
    stateModels: catalog.stateModels.map(state => ({
      behaviorStateIndex: state.behaviorStateIndex,
      targetOffset: state.targetOffset,
      controlRole: state.controlRole,
      relativeBranchCount: state.relativeBranchCount,
      conditionalControlCount: state.conditionalBranchCount + state.conditionalExitCount,
      symbolicPredicateCount: state.symbolicPredicateCount,
      unclassifiedConditionalControlCount: state.unclassifiedConditionalControlCount,
      timerOperationCount: state.timerOperationCount,
      behaviorStateOperationCount: state.behaviorStateOperationCount,
      frameExactStatus: state.frameExactStatus,
    })),
  }, null, 2));
}

main();
