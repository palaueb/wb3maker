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
const now = '2026-06-26T00:00:00Z';
const catalogId = 'world-bank2-vdp-state-index-producer-catalog-2026-06-26';
const reportId = 'bank2-vdp-state-index-producer-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-state-index-producer-audit.mjs';
const schemaVersion = 1;

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHexByte(text) {
  const match = /\$([0-9A-F]{1,2})/i.exec(text || '');
  return match ? parseInt(match[1], 16) : null;
}

function parseLabelOffset(label) {
  const match = /^_LABEL_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function findRegionByOffset(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = parseInt(region.offset, 16);
    return offset >= start && offset < start + (region.size || 0);
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

function normalizeLine(line) {
  return line.replace(/;.*/, '').trim();
}

function findBank2ExecutableWindow(lines) {
  const bankStart = lines.findIndex(line => line.includes('.BANK 2'));
  const dataStart = lines.findIndex((line, index) => index > bankStart && line.trim() === '_DATA_9AE0_:');
  return {
    start: bankStart >= 0 ? bankStart : 0,
    endExclusive: dataStart >= 0 ? dataStart : lines.length,
  };
}

function contextLines(lines, index, before = 8, after = 4) {
  const out = [];
  for (let lineIndex = Math.max(0, index - before); lineIndex <= Math.min(lines.length - 1, index + after); lineIndex++) {
    out.push({
      line: lineIndex + 1,
      text: normalizeLine(lines[lineIndex]),
    });
  }
  return out.filter(item => item.text);
}

function contextLinesWithinLabel(lines, index, before = 8, after = 0) {
  let start = Math.max(0, index - before);
  for (let lineIndex = index - 1; lineIndex >= start; lineIndex--) {
    if (/^_(LABEL|DATA)_[0-9A-F]+_:/i.test(normalizeLine(lines[lineIndex]))) {
      start = lineIndex + 1;
      break;
    }
  }
  let end = Math.min(lines.length - 1, index + after);
  for (let lineIndex = index + 1; lineIndex <= end; lineIndex++) {
    if (/^_(LABEL|DATA)_[0-9A-F]+_:/i.test(normalizeLine(lines[lineIndex]))) {
      end = lineIndex - 1;
      break;
    }
  }
  const out = [];
  for (let lineIndex = start; lineIndex <= end; lineIndex++) {
    const text = normalizeLine(lines[lineIndex]);
    if (text) out.push({ line: lineIndex + 1, text });
  }
  return out;
}

function nearestLabel(labels, lineIndex) {
  let found = null;
  for (const label of labels) {
    if (label.lineIndex > lineIndex) break;
    found = label;
  }
  return found;
}

function valueModelForAccumulatorStore(context) {
  const before = context.filter(item => item.text !== 'ld (_RAM_D15D_), a');
  const previous = before[before.length - 1]?.text || '';
  if (previous === 'xor a') {
    return { kind: 'constant_zero', values: [0], confidence: 'high' };
  }
  if (/^ld a, \$[0-9A-F]{1,2}$/i.test(previous)) {
    return { kind: 'constant_immediate', values: [parseHexByte(previous)], confidence: 'high' };
  }

  const recentText = before.map(item => item.text);
  const addLine = [...recentText].reverse().find(text => /^add a, \$[0-9A-F]{1,2}$/i.test(text));
  const hasAnd01 = recentText.some(text => text === 'and $01');
  const hasReadD15D = recentText.some(text => text === 'ld a, (_RAM_D15D_)');
  const hasXor01 = recentText.some(text => text === 'xor $01');
  if (hasReadD15D && hasXor01) {
    const helper8b9f = recentText.some(text => text === 'call _LABEL_8B9F_');
    if (helper8b9f) {
      return {
        kind: 'helper_8b9f_then_toggle_zero_or_one',
        values: [0, 1],
        confidence: 'high',
        sourceExpression: '_LABEL_8B9F_ syncs _RAM_D15D_ to _LABEL_8B94_ return 0/1 before xor 1',
      };
    }
    return {
      kind: 'toggle_current_index_low_bit',
      values: [],
      confidence: 'medium',
      sourceExpression: '_RAM_D15D_ xor 1; concrete values require incoming state-index set for this routine',
    };
  }
  if (addLine && hasAnd01 && hasReadD15D) {
    const base = parseHexByte(addLine);
    return {
      kind: 'low_bit_plus_constant',
      values: [base, base + 1],
      confidence: 'high',
      sourceExpression: '(_RAM_D15D_ & 1) + constant',
    };
  }
  if (hasAnd01 && hasReadD15D) {
    return {
      kind: 'low_bit_mask_zero_or_one',
      values: [0, 1],
      confidence: 'high',
      sourceExpression: '_RAM_D15D_ & 1',
    };
  }

  const helper8b94 = recentText.some(text => text === 'call _LABEL_8B94_');
  if (helper8b94) {
    return {
      kind: 'helper_8b94_side_select_zero_or_one',
      values: [0, 1],
      confidence: 'high',
      sourceExpression: '_LABEL_8B94_ returns A=0 or A=1',
    };
  }

  const helper8bae = recentText.some(text => text === 'call _LABEL_8BAE_');
  if (helper8bae) {
    return {
      kind: 'helper_8bae_side_select_two_or_three',
      values: [2, 3],
      confidence: 'high',
      sourceExpression: '_LABEL_8BAE_ returns A=2 or A=3',
    };
  }

  const hasLdAFromC = recentText.some(text => text === 'ld a, c');
  const hasLdC1 = recentText.some(text => text === 'ld c, $01');
  const hasDecC = recentText.some(text => text === 'dec c');
  if (hasLdAFromC && hasLdC1 && hasDecC) {
    return {
      kind: 'register_c_side_select_zero_or_one',
      values: [0, 1],
      confidence: 'medium',
      sourceExpression: '_LABEL_847F_ branch keeps C=1 or decrements C to 0 before ld a,c',
    };
  }

  const hasCall847f = recentText.some(text => text === 'call _LABEL_847F_');
  const carryBaseLine = [...recentText].reverse().find(text => /^ld a, \$[0-9A-F]{1,2}$/i.test(text));
  const carryBase = carryBaseLine ? parseHexByte(carryBaseLine) : null;
  const hasIncA = recentText.some(text => text === 'inc a');
  if (hasCall847f && carryBase != null && hasIncA) {
    return {
      kind: carryBase === 0 ? 'carry_side_select_zero_or_one' : 'carry_side_select_immediate_or_next',
      values: [carryBase, carryBase + 1],
      confidence: 'medium',
      sourceExpression: `_LABEL_847F_ carry branch selects ${hex(carryBase, 2)} or ${hex(carryBase + 1, 2)}`,
    };
  }

  const helper8898 = recentText.some(text => text === 'call _LABEL_8898_');
  if (helper8898) {
    return {
      kind: 'helper_8898_side_select_two_or_three',
      values: [2, 3],
      confidence: 'medium',
      sourceExpression: '_LABEL_8898_ returns A=2 or A=3',
    };
  }

  const immediateLines = recentText.filter(text => /^ld a, \$[0-9A-F]{1,2}$/i.test(text));
  const immediateValues = [...new Set(immediateLines.map(parseHexByte).filter(value => value != null))].sort((a, b) => a - b);
  if (immediateValues.length >= 2 && immediateValues.length <= 3) {
    return {
      kind: 'branch_selected_small_immediate_set',
      values: immediateValues,
      confidence: 'medium',
    };
  }

  const hasXorA = recentText.some(text => text === 'xor a');
  if (hasXorA && hasIncA) {
    return {
      kind: 'zero_or_one_from_xor_then_conditional_inc',
      values: [0, 1],
      confidence: 'medium',
    };
  }

  const clobbersA = text => /^ld a, /i.test(text)
    || /^(and|xor|or|sub|cp) /i.test(text)
    || /^sbc a, /i.test(text)
    || text === 'inc a'
    || text.startsWith('call ')
    || text.startsWith('rst ');
  for (let i = recentText.length - 1; i >= 0; i--) {
    const text = recentText[i];
    if (text === 'xor a') {
      return {
        kind: 'constant_zero_preserved_through_non_accumulator_stores',
        values: [0],
        confidence: 'high',
      };
    }
    if (/^ld a, \$[0-9A-F]{1,2}$/i.test(text)) {
      return {
        kind: 'constant_immediate_preserved_through_non_accumulator_stores',
        values: [parseHexByte(text)],
        confidence: 'medium',
      };
    }
    if (clobbersA(text)) break;
  }

  return {
    kind: 'dynamic_or_unresolved_accumulator',
    values: [],
    confidence: 'low',
  };
}

function valueModelForMemoryMutation(context) {
  const next = context.find(item => item.text === 'inc (hl)' || /^ld \(hl\), \$[0-9A-F]{1,2}$/i.test(item.text));
  if (!next) {
    return {
      kind: 'd15d_address_loaded_no_write_in_window',
      values: [],
      confidence: 'low',
    };
  }
  if (next.text === 'inc (hl)') {
    return {
      kind: 'increment_current_index',
      values: [],
      confidence: 'medium',
      sourceExpression: '_RAM_D15D_ = _RAM_D15D_ + 1',
    };
  }
  return {
    kind: 'constant_memory_store',
    values: [parseHexByte(next.text)],
    confidence: 'high',
  };
}

function hasReloadFlagSet(context) {
  return context.some(item => item.text === 'ld hl, _RAM_D17F_')
    && context.some(item => item.text === 'set 0, (hl)');
}

function buildCatalog(mapData) {
  const lines = fs.readFileSync(asmPath, 'utf8').split(/\r?\n/);
  const window = findBank2ExecutableWindow(lines);
  const labels = [];
  for (let index = window.start; index < window.endExclusive; index++) {
    const text = normalizeLine(lines[index]);
    const match = /^(_LABEL_[0-9A-F]+_):$/i.exec(text);
    if (!match) continue;
    const offset = parseLabelOffset(match[1]);
    labels.push({ label: match[1], offset, lineIndex: index, line: index + 1 });
  }

  const producers = [];
  for (let index = window.start; index < window.endExclusive; index++) {
    const text = normalizeLine(lines[index]);
    let kind = null;
    let model = null;
    if (text === 'ld (_RAM_D15D_), a') {
      kind = 'accumulator_store_to_d15d';
      model = valueModelForAccumulatorStore(contextLinesWithinLabel(lines, index, 48, 0));
    } else if (text === 'ld hl, _RAM_D15D_') {
      const context = contextLines(lines, index, 2, 3);
      const mutation = valueModelForMemoryMutation(context);
      if (mutation.kind === 'd15d_address_loaded_no_write_in_window') continue;
      kind = 'memory_mutation_via_hl';
      model = mutation;
    } else {
      continue;
    }

    const label = nearestLabel(labels, index);
    producers.push({
      id: `d15d_producer_line_${index + 1}`,
      line: index + 1,
      kind,
      enclosingLabel: label ? {
        label: label.label,
        offset: hex(label.offset),
        line: label.line,
        region: regionRef(findRegionByOffset(mapData, label.offset)),
      } : null,
      valueModel: model,
      reloadFlagSetNearby: hasReloadFlagSet(contextLines(lines, index, 8, 8)),
      evidence: [
        `ASM line ${index + 1} writes or mutates _RAM_D15D_.`,
        label ? `Nearest enclosing label is ${label.label} at ASM line ${label.line}.` : 'No enclosing label found in the bank-2 executable window.',
      ],
    });
  }

  const resolvedProducers = producers.filter(producer => producer.valueModel.values.length);
  const modeledValues = [...new Set(resolvedProducers.flatMap(producer => producer.valueModel.values))].sort((a, b) => a - b);
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      'world-bank2-vdp-stream-state-catalog-2026-06-25',
      'world-bank2-vdp-state-candidate-reachability-catalog-2026-06-26',
    ],
    targetRam: {
      address: '$D15D',
      role: 'bank2_vdp_stream_state_entry_index',
      consumer: '_LABEL_96FE_/_LABEL_972B_',
    },
    summary: {
      producerCount: producers.length,
      accumulatorStoreCount: producers.filter(producer => producer.kind === 'accumulator_store_to_d15d').length,
      memoryMutationCount: producers.filter(producer => producer.kind === 'memory_mutation_via_hl').length,
      modeledValueProducerCount: resolvedProducers.length,
      unresolvedValueProducerCount: producers.length - resolvedProducers.length,
      reloadFlagSetNearbyCount: producers.filter(producer => producer.reloadFlagSetNearby).length,
      valueModelCounts: countBy(producers, producer => producer.valueModel.kind),
      confidenceCounts: countBy(producers, producer => producer.valueModel.confidence),
      modeledValues: modeledValues.map(value => hex(value, 2)),
      maxModeledValue: modeledValues.length ? hex(Math.max(...modeledValues), 2) : null,
      assetPolicy: 'Metadata only: ASM line numbers, labels, RAM roles, inferred value models, and counts. No ROM bytes, decoded graphics, screenshots, hashes, or asset payloads are embedded.',
    },
    producers,
    evidence: [
      '_LABEL_96FE_ indexes the active bank-2 stream table with _RAM_D15D_; producer bounds are needed before rejecting unreferenced state-record candidates.',
      'This audit records direct stores to _RAM_D15D_ and simple HL-based mutations in the bank-2 executable window before _DATA_9AE0_.',
    ],
    nextLeads: [
      'Resolve dynamic_or_unresolved_accumulator producers by tracing helper return values and branch predicates.',
      'Combine D15D producer value ranges with active _RAM_D15A_ root-table selection to prove which state-table entries can be reached frame by frame.',
      'Use the proven D15D bounds to reject state-record-shaped gaps that cannot be indexed by any scene state.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = (mapData.regions || []).find(item => item.id === 'r0186');
  if (!region) {
    return { changedRegions: [], missingRegions: [{ id: 'r0186', role: 'bank2_vdp_state_index_producer_context' }] };
  }
  if (!apply) {
    return {
      changedRegions: [{ id: region.id, offset: region.offset, type: region.type, name: region.name, inferredAnalysis: 'bank2VdpStateIndexProducerAudit' }],
      missingRegions: [],
    };
  }
  region.analysis = region.analysis || {};
  region.analysis.bank2VdpStateIndexProducerAudit = {
    catalogId,
    kind: 'bank2_vdp_state_index_producer_context',
    confidence: catalog.summary.unresolvedValueProducerCount === 0 ? 'high' : 'medium',
    summary: 'Static producer catalog for _RAM_D15D_, the bank-2 VDP stream state-table index consumed by _LABEL_96FE_.',
    detail: {
      producerCount: catalog.summary.producerCount,
      modeledValueProducerCount: catalog.summary.modeledValueProducerCount,
      unresolvedValueProducerCount: catalog.summary.unresolvedValueProducerCount,
      reloadFlagSetNearbyCount: catalog.summary.reloadFlagSetNearbyCount,
      valueModelCounts: catalog.summary.valueModelCounts,
      modeledValues: catalog.summary.modeledValues,
      maxModeledValue: catalog.summary.maxModeledValue,
    },
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    changedRegions: [{ id: region.id, offset: region.offset, type: region.type, name: region.name, inferredAnalysis: 'bank2VdpStateIndexProducerAudit' }],
    missingRegions: [],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);
  if (apply) {
    mapData.vdpStreamRuntimeCatalogs = (mapData.vdpStreamRuntimeCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpStreamRuntimeCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_state_index_producer_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      changedRegions: annotation.changedRegions,
      missingRegions: annotation.missingRegions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
