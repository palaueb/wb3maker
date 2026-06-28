#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const asmPath = path.join(repoRoot, "projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm");
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-audio-output-mode-branch-catalog-2026-06-25';
const reportId = 'audio-output-mode-branch-audit-2026-06-25';
const toolName = 'tools/world-audio-output-mode-branch-audit.mjs';

const outputRegisterCatalogId = 'world-audio-output-register-catalog-2026-06-25';
const runtimeGlobalFlowCatalogId = 'world-audio-runtime-global-flow-catalog-2026-06-25';
const outputGlobalInputCatalogId = 'world-audio-output-global-input-catalog-2026-06-25';

const BRANCH_EVIDENCE = [
  { line: 21769, expectedText: 'ld a, (_RAM_C232_)', role: 'load selector before output dispatch' },
  { line: 21770, expectedText: 'bit 0, a', role: 'test selector bit 0 before output dispatch' },
  { line: 21771, expectedText: 'jr nz, +', role: 'bit set branches to FM output dispatch' },
  { line: 21772, expectedText: 'call _LABEL_C4C1_', role: 'bit clear calls PSG output dispatch' },
  { line: 21776, expectedText: 'call _LABEL_C78F_', role: 'bit set calls FM output dispatch' },
  { line: 22086, expectedText: 'ld a, (_RAM_C232_)', role: 'load selector before note/rest volume mirror' },
  { line: 22087, expectedText: 'bit 0, a', role: 'test selector bit 0 before note/rest volume mirror' },
  { line: 22088, expectedText: 'jr z, +', role: 'bit clear skips shared bias read' },
  { line: 22091, expectedText: 'ld a, (_RAM_C23C_)', role: 'bit set reads shared bias' },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegionForOffset(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = Number(region.offset);
    const size = Number(region.size) || 0;
    return Number.isFinite(start) && offset >= start && offset < start + size;
  }) || null;
}

function regionRef(mapData, offset) {
  const region = findRegionForOffset(mapData, offset);
  return region ? {
    id: region.id,
    offset: region.offset,
    size: region.size,
    type: region.type || '',
    name: region.name || '',
  } : null;
}

function validateAsmLines(asmText) {
  const lines = asmText.split(/\r?\n/);
  const validationIssues = [];
  const evidence = BRANCH_EVIDENCE.map(item => {
    const asmLineText = (lines[item.line - 1] || '').trim();
    if (!asmLineText.includes(item.expectedText)) {
      validationIssues.push(`Expected "${item.expectedText}" at ASM line ${item.line}, got "${asmLineText}"`);
    }
    return {
      line: item.line,
      role: item.role,
      expectedText: item.expectedText,
      asmLineText,
    };
  });
  return { evidence, validationIssues };
}

function phaseRefsByChip(outputCatalog, chip) {
  return (outputCatalog.outputPhases || [])
    .filter(phase => phase.chip === chip)
    .map(phase => ({
      phaseId: phase.id,
      chip: phase.chip,
      routineLabel: phase.routineLabel || '',
      registerFamily: phase.registerFamily || '',
      writeCount: phase.writeCount || (phase.writes || []).length || 0,
      confidence: phase.confidence || '',
    }));
}

function buildCatalog(mapData, asmText) {
  const outputCatalog = requireCatalog(mapData, outputRegisterCatalogId);
  const runtimeFlowCatalog = requireCatalog(mapData, runtimeGlobalFlowCatalogId);
  const outputGlobalInputCatalog = requireCatalog(mapData, outputGlobalInputCatalogId);
  const validation = validateAsmLines(asmText);
  const validationIssues = [...validation.validationIssues];

  const c232Flow = (runtimeFlowCatalog.globalFlows || [])
    .find(flow => flow.role === 'audio_output_mode_select') || null;
  const c232GlobalInput = (outputGlobalInputCatalog.globalInputs || [])
    .find(input => input.role === 'audio_output_mode_select') || null;
  if (!c232Flow) validationIssues.push(`Missing audio_output_mode_select in ${runtimeGlobalFlowCatalogId}`);
  if (!c232GlobalInput) validationIssues.push(`Missing audio_output_mode_select in ${outputGlobalInputCatalogId}`);

  const psgPhases = phaseRefsByChip(outputCatalog, 'psg');
  const fmPhases = phaseRefsByChip(outputCatalog, 'fm');
  const mixedPhases = phaseRefsByChip(outputCatalog, 'mixed');
  if (!psgPhases.length) validationIssues.push(`No PSG phases found in ${outputRegisterCatalogId}`);
  if (!fmPhases.length) validationIssues.push(`No FM phases found in ${outputRegisterCatalogId}`);

  const branches = [
    {
      id: 'c232_bit0_clear_psg_output',
      selectorRole: 'audio_output_mode_select',
      selectorAddress: '$C232',
      selectorBit: 0,
      selectorValue: 0,
      condition: '(_RAM_C232_ & $01) == 0',
      dispatchRoutineLabel: '_LABEL_C4C1_',
      dispatchRoutineOffset: '0x0C4C1',
      dispatchRegion: regionRef(mapData, 0x0C4C1),
      dispatchOutputClass: 'psg',
      outputPhaseRefs: psgPhases,
      outputPhaseCount: psgPhases.length,
      outputWriteCount: psgPhases.reduce((sum, phase) => sum + (phase.writeCount || 0), 0),
      volumeMirrorPath: {
        routineLabel: '_LABEL_C339_',
        routineOffset: '0x0C339',
        region: regionRef(mapData, 0x0C339),
        sharedBiasRead: false,
        summary: 'The note/rest volume mirror skips the $C23C read and copies the stream volume field directly before clamping.',
      },
      status: 'runtime_branch_candidate',
      confidence: 'high',
      evidenceLineRefs: [21769, 21770, 21771, 21772, 22086, 22087, 22088, 22096],
    },
    {
      id: 'c232_bit0_set_fm_output',
      selectorRole: 'audio_output_mode_select',
      selectorAddress: '$C232',
      selectorBit: 0,
      selectorValue: 1,
      condition: '(_RAM_C232_ & $01) != 0',
      dispatchRoutineLabel: '_LABEL_C78F_',
      dispatchRoutineOffset: '0x0C78F',
      dispatchRegion: regionRef(mapData, 0x0C78F),
      dispatchOutputClass: 'fm',
      outputPhaseRefs: fmPhases,
      outputPhaseCount: fmPhases.length,
      outputWriteCount: fmPhases.reduce((sum, phase) => sum + (phase.writeCount || 0), 0),
      volumeMirrorPath: {
        routineLabel: '_LABEL_C339_',
        routineOffset: '0x0C339',
        region: regionRef(mapData, 0x0C339),
        sharedBiasRead: true,
        sharedBiasRole: 'psg_volume_bias_shared_byte',
        sharedBiasAddress: '$C23C',
        summary: 'The note/rest volume mirror reads $C23C, adds it to the stream volume field, then clamps before writing IY+1.',
      },
      status: 'runtime_branch_candidate',
      confidence: 'high',
      evidenceLineRefs: [21769, 21770, 21771, 21776, 22086, 22087, 22088, 22089, 22090, 22091, 22092],
    },
  ];

  const phaseBranchCandidates = [];
  for (const branch of branches) {
    for (const phase of branch.outputPhaseRefs) {
      phaseBranchCandidates.push({
        phaseId: phase.phaseId,
        chip: phase.chip,
        branchId: branch.id,
        selectorRole: branch.selectorRole,
        selectorAddress: branch.selectorAddress,
        selectorBit: branch.selectorBit,
        selectorValue: branch.selectorValue,
        dispatchRoutineLabel: branch.dispatchRoutineLabel,
        status: 'candidate_until_runtime_mode_resolved',
      });
    }
  }
  for (const phase of mixedPhases) {
    phaseBranchCandidates.push({
      phaseId: phase.phaseId,
      chip: phase.chip,
      branchId: 'mode_independent_mixed_init',
      selectorRole: '',
      selectorAddress: '',
      selectorBit: null,
      selectorValue: null,
      dispatchRoutineLabel: phase.routineLabel,
      status: 'not_selected_by_c232_output_dispatch',
    });
  }

  const catalog = {
    id: catalogId,
    generatedAt: now,
    tool: toolName,
    sourceCatalogIds: [
      outputRegisterCatalogId,
      runtimeGlobalFlowCatalogId,
      outputGlobalInputCatalogId,
    ],
    assetPolicy: 'metadata_only_no_rom_bytes_no_register_values_no_audio_samples',
    summary: {
      branchCount: branches.length,
      psgBranchPhaseCount: psgPhases.length,
      fmBranchPhaseCount: fmPhases.length,
      mixedModeIndependentPhaseCount: mixedPhases.length,
      phaseBranchCandidateCount: phaseBranchCandidates.length,
      psgBranchWriteCount: branches[0].outputWriteCount,
      fmBranchWriteCount: branches[1].outputWriteCount,
      validationIssueCount: validationIssues.length,
    },
    selector: {
      role: 'audio_output_mode_select',
      address: '$C232',
      bit: 0,
      sourceCatalogId: runtimeGlobalFlowCatalogId,
      flowStatus: c232Flow?.flowStatus || '',
      modelingStatus: c232GlobalInput?.modelingStatus || '',
    },
    branches,
    phaseBranchCandidates,
    asmEvidence: validation.evidence,
    validationIssues,
    notes: [
      'This catalog records branch alternatives only; it does not resolve which branch is active at runtime.',
      'PSG/FM output phase candidates are separated by the $C232 bit-0 dispatch branch.',
      'No register values, stream bytes, audio samples, or ROM bytes are persisted.',
    ],
  };

  const report = {
    id: reportId,
    generatedAt: now,
    tool: toolName,
    catalogId,
    summary: catalog.summary,
    failures: validationIssues,
    evidence: [
      'ASM lines 21769-21776 select PSG versus FM output dispatch using $C232 bit 0.',
      'ASM lines 22086-22096 select direct versus $C23C-biased note/rest volume mirroring using $C232 bit 0.',
      `${outputRegisterCatalogId} supplies PSG/FM output phase groupings.`,
    ],
    assetPolicy: catalog.assetPolicy,
  };

  return { catalog, report };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const { catalog, report } = buildCatalog(mapData, asmText);
  if (apply) {
    if (catalog.validationIssues.length) {
      throw new Error(`Refusing to apply ${catalog.validationIssues.length} validation issue(s).`);
    }
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push(report);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    validationIssues: catalog.validationIssues,
  }, null, 2));
}

main();
