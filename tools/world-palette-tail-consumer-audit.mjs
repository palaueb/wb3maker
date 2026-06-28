#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-palette-tail-consumer-catalog-2026-06-25';
const reportId = 'palette-tail-consumer-audit-2026-06-25';
const toolName = 'tools/world-palette-tail-consumer-audit.mjs';

const palettePointerTableOffset = 0x1C800;
const paletteScriptIndex = 25;
const paletteScriptOffset = 0x1CABB;
const paletteTailStart = 0x1CB03;
const paletteTailEndExclusive = 0x1CCC0;
const parentLabel = '_DATA_1CABB_';

const candidateDefs = [
  {
    regionId: 'r2815',
    role: 'palette_tail_short_payload_unresolved_not_palette_script',
    expectedType: 'data_table',
    summary: 'Seven-byte explicit fragment after the _DATA_1CABB_ palette script; not consumed by the palette script parser.',
  },
  {
    regionId: 'r2816',
    role: 'palette_tail_c1_fill_unresolved_not_palette_script',
    expectedType: 'data_table',
    summary: 'Explicit 16-byte fill block after the _DATA_1CABB_ palette script; not consumed by the palette script parser.',
  },
  {
    regionId: 'r2817',
    role: 'palette_tail_tile_map_candidate_no_confirmed_consumer',
    expectedType: 'tile_map',
    summary: 'Low-confidence 15x16 tile/index payload candidate after _DATA_1CABB_; current pointer-shaped leads are cross-bank false positives.',
  },
];

const pointerSourceTypes = new Set([
  'pointer_table',
  'screen_prog_table',
  'palette_script_table',
  'room_subrecord',
  'room_seq_table',
  'data_table',
]);

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
}

function endOf(region) {
  return offsetOf(region) + (region.size || 0);
}

function bankForOffset(offset) {
  return Math.floor(offset / 0x4000);
}

function z80WindowPointer(offset) {
  const bank = bankForOffset(offset);
  if (bank === 0) return offset;
  if (bank === 1) return 0x4000 + (offset % 0x4000);
  return 0x8000 + (offset % 0x4000);
}

function bankedPointerToRom(bank, pointer) {
  if (bank === 0 && pointer < 0x4000) return pointer;
  if (bank === 1 && pointer >= 0x4000 && pointer < 0x8000) return 0x4000 + (pointer - 0x4000);
  if (bank >= 2 && pointer >= 0x8000 && pointer < 0xC000) return bank * 0x4000 + (pointer - 0x8000);
  return null;
}

function readWordLE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
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

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offset >= offsetOf(region) && offset < endOf(region)) || null;
}

function asmLabelDefinitions(asmText) {
  const defs = new Map();
  const lines = asmText.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const match = /^(_(?:DATA|LABEL)_[0-9A-F]+_):/.exec(line);
    if (!match) continue;
    const offset = parseInt(match[1].split('_')[2], 16);
    defs.set(match[1], { label: match[1], offset, line: index + 1 });
  }
  return defs;
}

function asmRefsForLabels(asmText, labels) {
  const lines = asmText.split(/\r?\n/);
  const refs = [];
  for (const [index, line] of lines.entries()) {
    for (const label of labels) {
      if (!line.includes(label)) continue;
      if (line.startsWith(`${label}:`)) continue;
      refs.push({
        label,
        line: index + 1,
        context: line.trim().replace(/\s+/g, ' ').slice(0, 160),
      });
    }
  }
  return refs;
}

function z80ToBank7Rom(pointer) {
  if (pointer < 0x8000 || pointer >= 0xC000) return null;
  return 0x1C000 + (pointer - 0x8000);
}

function parsePaletteScript(rom, start) {
  let pos = start;
  let steps = 0;
  let writes = 0;
  let delayedWrites = 0;
  const warnings = [];
  let endReason = 'max_steps';
  let loopTarget = null;

  while (pos < rom.length && steps < 2048) {
    steps++;
    const commandOffset = pos;
    const command = rom[pos++];
    if (command === 0xFF) {
      endReason = `0xFF END @ ${hex(commandOffset)}`;
      break;
    }
    if (command === 0xF0) {
      if (pos + 1 >= rom.length) {
        warnings.push(`F0 pointer at ${hex(commandOffset)} runs past ROM end.`);
        endReason = `truncated F0 @ ${hex(commandOffset)}`;
        break;
      }
      const pointer = readWordLE(rom, pos);
      pos += 2;
      const target = z80ToBank7Rom(pointer);
      loopTarget = target == null ? null : hex(target);
      if (target == null) warnings.push(`F0 pointer ${hex(pointer, 4)} is outside the bank-7 script window.`);
      endReason = `0xF0 JUMP @ ${hex(commandOffset)}`;
      break;
    }
    if (pos >= rom.length) {
      warnings.push(`Command at ${hex(commandOffset)} has no value byte.`);
      endReason = `truncated command @ ${hex(commandOffset)}`;
      break;
    }
    pos++;
    writes++;
    if (command & 0x80) {
      if (pos >= rom.length) {
        warnings.push(`Delayed command at ${hex(commandOffset)} has no delay byte.`);
        endReason = `truncated delay @ ${hex(commandOffset)}`;
        break;
      }
      pos++;
      delayedWrites++;
    }
  }

  return {
    start,
    endExclusive: pos,
    parsedBytes: pos - start,
    endReason,
    loopTarget,
    writes,
    delayedWrites,
    warnings,
  };
}

function pointerBankContextForRegion(region) {
  const sourceStart = offsetOf(region);
  if (sourceStart === 0x1071A) {
    return {
      bank: 6,
      reason: '_DATA_1071A_ is the _RAM_C34E_ metasprite-family table; its pointer words target the bank-6 window.',
    };
  }
  return {
    bank: Number.isFinite(region.bank) ? region.bank : bankForOffset(sourceStart),
    reason: 'source region bank context',
  };
}

function pointerWordOffsetsForRegion(region) {
  const sourceType = region.type || 'unknown';
  const sourceStart = offsetOf(region);
  const sourceEnd = endOf(region);
  if (sourceType === 'room_subrecord') {
    const subrecordRange = region.analysis?.roomSubrecordAudit?.layout?.subrecordRange;
    const rangeStart = subrecordRange ? parseInt(subrecordRange.offset, 16) : sourceStart;
    const stride = subrecordRange?.stride || 18;
    const count = subrecordRange?.count || Math.floor((sourceEnd - rangeStart) / stride);
    const offsets = [];
    for (let index = 0; index < count; index++) {
      const recordStart = rangeStart + index * stride;
      for (const fieldOffset of [0, 8]) {
        const offset = recordStart + fieldOffset;
        if (offset >= sourceStart && offset + 1 < sourceEnd) offsets.push(offset);
      }
    }
    return offsets;
  }
  const offsets = [];
  for (let offset = sourceStart; offset + 1 < sourceEnd; offset += 2) offsets.push(offset);
  return offsets;
}

function pointerLeadsForCandidate(rom, mapData, candidate) {
  const start = offsetOf(candidate);
  const endExclusive = endOf(candidate);
  const candidateBank = bankForOffset(start);
  const z80Start = z80WindowPointer(start);
  const z80EndExclusive = z80Start + (endExclusive - start);
  const leads = [];

  for (const sourceRegion of mapData.regions || []) {
    const sourceType = sourceRegion.type || 'unknown';
    if (!pointerSourceTypes.has(sourceType)) continue;
    const sourceStart = offsetOf(sourceRegion);
    const sourceEnd = endOf(sourceRegion);
    if (sourceStart < endExclusive && sourceEnd > start) continue;
    const pointerBankContext = pointerBankContextForRegion(sourceRegion);
    for (const offset of pointerWordOffsetsForRegion(sourceRegion)) {
      if (offset + 1 >= sourceEnd || offset + 1 >= rom.length) continue;
      const word = readWordLE(rom, offset);
      if (word < z80Start || word >= z80EndExclusive) continue;
      const sourceBank = pointerBankContext.bank;
      const trueTarget = bankedPointerToRom(sourceBank, word);
      const trueTargetInsideCandidate = trueTarget != null && trueTarget >= start && trueTarget < endExclusive;
      const sameBank = sourceBank === candidateBank;
      leads.push({
        sourceRegion: regionRef(sourceRegion),
        sourceOffset: hex(offset),
        pointerWord: hex(word, 4),
        sourceBank,
        candidateBank,
        sourceBankContextReason: pointerBankContext.reason,
        trueTargetOffset: trueTarget == null ? null : hex(trueTarget),
        apparentCandidateOffset: hex(start + (word - z80Start)),
        status: sameBank && trueTargetInsideCandidate
          ? 'same_bank_pointer_candidate'
          : 'bank_context_mismatch_word_shape',
      });
    }
  }
  return leads.sort((a, b) => a.sourceOffset.localeCompare(b.sourceOffset));
}

function buildCandidate(rom, mapData, asmText, asmDefs, def, paletteScript) {
  const region = findRegionById(mapData, def.regionId);
  if (!region) return { regionId: def.regionId, missing: true, role: def.role };
  const start = offsetOf(region);
  const endExclusive = endOf(region);
  const exactLabel = [...asmDefs.values()].find(item => item.offset === start)?.label || null;
  const labels = [...new Set([exactLabel, parentLabel].filter(Boolean))];
  const asmRefs = asmRefsForLabels(asmText, labels);
  const exactLabelRefs = exactLabel ? asmRefs.filter(ref => ref.label === exactLabel) : [];
  const parentLabelRefs = asmRefs.filter(ref => ref.label === parentLabel);
  const pointerLeads = pointerLeadsForCandidate(rom, mapData, region);
  const sameBankPointerCandidates = pointerLeads.filter(lead => lead.status === 'same_bank_pointer_candidate');
  const bankMismatchWordShapes = pointerLeads.filter(lead => lead.status === 'bank_context_mismatch_word_shape');
  const startsAfterPaletteParser = start >= paletteScript.endExclusive;

  return {
    region: regionRef(region),
    role: def.role,
    summary: def.summary,
    range: {
      start: hex(start),
      endInclusive: hex(endExclusive - 1),
      size: endExclusive - start,
      bank: bankForOffset(start),
      z80WindowPointerRange: [hex(z80WindowPointer(start), 4), hex(z80WindowPointer(endExclusive - 1), 4)],
    },
    consumerStatus: 'consumer_unresolved_not_palette_script_payload',
    confidence: sameBankPointerCandidates.length ? 'low' : 'medium',
    paletteParser: {
      parentLabel,
      parentScriptIndex: paletteScriptIndex,
      parsedEndExclusive: hex(paletteScript.endExclusive),
      endReason: paletteScript.endReason,
      loopTarget: paletteScript.loopTarget,
      startsAfterPaletteParser,
      status: startsAfterPaletteParser ? 'not_consumed_by_palette_script_parser' : 'overlaps_palette_script_parser',
    },
    exactAsmLabel: exactLabel,
    exactAsmLabelRefCount: exactLabelRefs.length,
    exactAsmLabelRefs: exactLabelRefs.slice(0, 12),
    parentLabelRefCount: parentLabelRefs.length,
    parentLabelRefs: parentLabelRefs.slice(0, 12),
    sameBankPointerCandidateCount: sameBankPointerCandidates.length,
    sameBankPointerCandidates: sameBankPointerCandidates.slice(0, 16),
    bankMismatchWordShapeCount: bankMismatchWordShapes.length,
    bankMismatchWordShapes: bankMismatchWordShapes.slice(0, 16),
    evidence: [
      `_LABEL_10BC_ palette script entry ${paletteScriptIndex} starts at ${hex(paletteScript.start)} and parser stops at ${hex(paletteScript.endExclusive)} with ${paletteScript.endReason}.`,
      `Candidate range starts at ${hex(start)}, after the parsed palette script prefix.`,
      sameBankPointerCandidates.length
        ? `${sameBankPointerCandidates.length} same-bank pointer-shaped lead(s) still require consumer tracing.`
        : 'No same-bank pointer-bearing source resolves into this candidate range.',
      bankMismatchWordShapes.length
        ? `${bankMismatchWordShapes.length} cross-bank word-shaped hit(s) are retained as false-positive leads with true bank-context targets outside this range.`
        : 'No cross-bank word-shaped hits were found.',
    ],
  };
}

function buildCatalog(rom, mapData, asmText) {
  const asmDefs = asmLabelDefinitions(asmText);
  const pointerWord = readWordLE(rom, palettePointerTableOffset + paletteScriptIndex * 2);
  const pointerTarget = z80ToBank7Rom(pointerWord);
  const paletteScript = parsePaletteScript(rom, paletteScriptOffset);
  const candidates = candidateDefs.map(def => buildCandidate(rom, mapData, asmText, asmDefs, def, paletteScript));
  const presentCandidates = candidates.filter(candidate => !candidate.missing);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      candidateCount: candidates.length,
      missingCandidateCount: candidates.filter(candidate => candidate.missing).length,
      notPaletteScriptPayloadCount: presentCandidates.filter(candidate => candidate.paletteParser?.status === 'not_consumed_by_palette_script_parser').length,
      sameBankPointerCandidateCount: presentCandidates.reduce((sum, candidate) => sum + (candidate.sameBankPointerCandidateCount || 0), 0),
      bankMismatchWordShapeCount: presentCandidates.reduce((sum, candidate) => sum + (candidate.bankMismatchWordShapeCount || 0), 0),
      exactAsmLabelReferenceCount: presentCandidates.reduce((sum, candidate) => sum + (candidate.exactAsmLabelRefCount || 0), 0),
      consumerUnresolvedCount: presentCandidates.filter(candidate => candidate.consumerStatus === 'consumer_unresolved_not_palette_script_payload').length,
      assetPolicy: 'Metadata only: parser offsets, command counts, pointer-ref metadata, bank-context classifications, region ids, and evidence. No ROM bytes, decoded palettes, tile maps, or graphics are embedded.',
    },
    paletteScript: {
      pointerTableOffset: hex(palettePointerTableOffset),
      index: paletteScriptIndex,
      pointerWord: hex(pointerWord, 4),
      pointerTarget: pointerTarget == null ? null : hex(pointerTarget),
      parsedStart: hex(paletteScript.start),
      parsedEndExclusive: hex(paletteScript.endExclusive),
      parsedEndInclusive: hex(paletteScript.endExclusive - 1),
      parsedBytes: paletteScript.parsedBytes,
      endReason: paletteScript.endReason,
      loopTarget: paletteScript.loopTarget,
      writes: paletteScript.writes,
      delayedWrites: paletteScript.delayedWrites,
      warningCount: paletteScript.warnings.length,
      warnings: paletteScript.warnings,
    },
    tailRange: {
      start: hex(paletteTailStart),
      endInclusive: hex(paletteTailEndExclusive - 1),
      size: paletteTailEndExclusive - paletteTailStart,
      status: 'after_parsed_palette_script_prefix',
    },
    candidates,
    evidence: [
      'ASM lines 27945-27952 define _DATA_1CABB_ as the 26th _DATA_1C800_ palette-script table entry.',
      'The _LABEL_10BC_ parser model from world-palette-script-audit stops this entry at the F0 pointer command before the explicit tail bytes.',
      'Pointer-shaped references are classified with their source bank context before being treated as consumer evidence.',
    ],
  };
}

function annotateRegions(mapData, catalog) {
  const annotated = [];
  const missing = [];
  for (const candidate of catalog.candidates) {
    if (candidate.missing) {
      missing.push({ regionId: candidate.regionId, role: candidate.role });
      continue;
    }
    const region = findRegionById(mapData, candidate.region.id);
    if (!region) {
      missing.push({ regionId: candidate.region.id, role: candidate.role });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.paletteTailConsumerAudit = {
      catalogId,
      kind: candidate.role,
      confidence: candidate.confidence,
      consumerStatus: candidate.consumerStatus,
      summary: candidate.summary,
      paletteParser: candidate.paletteParser,
      sameBankPointerCandidateCount: candidate.sameBankPointerCandidateCount,
      bankMismatchWordShapeCount: candidate.bankMismatchWordShapeCount,
      exactAsmLabel: candidate.exactAsmLabel,
      exactAsmLabelRefCount: candidate.exactAsmLabelRefCount,
      parentLabel,
      parentLabelRefCount: candidate.parentLabelRefCount,
      evidence: candidate.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (region.analysis.unresolvedAssetConsumerAudit) {
      region.analysis.unresolvedAssetConsumerAudit.refinedBy = catalogId;
      region.analysis.unresolvedAssetConsumerAudit.refinedConsumerStatus = candidate.consumerStatus;
      region.analysis.unresolvedAssetConsumerAudit.paletteTailConsumerAudit = {
        sameBankPointerCandidateCount: candidate.sameBankPointerCandidateCount,
        bankMismatchWordShapeCount: candidate.bankMismatchWordShapeCount,
        paletteParserStatus: candidate.paletteParser.status,
      };
    }
    annotated.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      role: candidate.role,
      consumerStatus: candidate.consumerStatus,
    });
  }
  return { annotated, missing };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(rom, mapData, asmText);
  let annotations = { annotated: [], missing: [] };

  if (apply) {
    annotations = annotateRegions(mapData, catalog);
    const finalCatalog = buildCatalog(rom, mapData, asmText);
    mapData.paletteCatalogs = (mapData.paletteCatalogs || []).filter(item => item.id !== catalogId);
    mapData.paletteCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'palette_tail_consumer_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotations.annotated.length,
        missingRegions: annotations.missing.length,
      },
      annotatedRegions: annotations.annotated,
      missingRegions: annotations.missing,
      evidence: finalCatalog.evidence,
      nextLeads: [
        'Trace any non-pointer consumer that might copy 0x1CBD0-0x1CCBF as a literal title/menu tile-index block.',
        'Keep cross-bank word-shape hits separate from real same-bank pointer evidence in unresolved-fragment triage.',
        'If a consumer is found, promote r2817 from low-confidence tile_map candidate to the concrete payload type used by that routine.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    paletteScript: catalog.paletteScript,
    candidates: catalog.candidates.map(candidate => candidate.missing ? candidate : {
      region: candidate.region,
      role: candidate.role,
      consumerStatus: candidate.consumerStatus,
      paletteParserStatus: candidate.paletteParser.status,
      sameBankPointerCandidateCount: candidate.sameBankPointerCandidateCount,
      bankMismatchWordShapeCount: candidate.bankMismatchWordShapeCount,
      exactAsmLabel: candidate.exactAsmLabel,
      exactAsmLabelRefCount: candidate.exactAsmLabelRefCount,
    }),
    annotations,
  }, null, 2));
}

main();
