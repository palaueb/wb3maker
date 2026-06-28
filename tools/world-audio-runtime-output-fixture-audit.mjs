#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-audio-runtime-output-fixture-audit.mjs';
const catalogId = 'world-audio-runtime-output-fixture-catalog-2026-06-26';
const reportId = 'audio-runtime-output-fixture-audit-2026-06-26';
const schemaVersion = 1;

const sourceCatalogIds = {
  outputRegister: 'world-audio-output-register-catalog-2026-06-25',
  eventOutput: 'world-audio-event-output-phase-link-catalog-2026-06-25',
  outputGlobalInput: 'world-audio-output-global-input-catalog-2026-06-25',
  outputModeBranch: 'world-audio-output-mode-branch-catalog-2026-06-25',
  runtimeGlobalFlow: 'world-audio-runtime-global-flow-catalog-2026-06-25',
  frameStepModel: 'world-audio-frame-step-model-catalog-2026-06-25',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
  if (!catalog) throw new Error(`Missing required catalog: ${id}`);
  return catalog;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRamByAddress(mapData, address) {
  const normalized = String(address || '').toUpperCase().replace(/^0X/, '$');
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === normalized) || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  return parseInt(value.replace(/^\$/, '0x'), 16);
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value != null && value !== ''))].sort((a, b) => {
    const aNum = parseOffset(a);
    const bNum = parseOffset(b);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    return String(a).localeCompare(String(b));
  });
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function sumBy(items, valueFn) {
  return (items || []).reduce((sum, item) => sum + valueFn(item), 0);
}

function fixtureId(prefix, id) {
  return `${prefix}_${String(id || '').replace(/[^A-Za-z0-9_]+/g, '_')}`;
}

function fieldRefKey(ref) {
  if (!ref) return '';
  if (ref.kind === 'stream_field') return `stream:${ref.fieldName || ''}`;
  if (ref.kind === 'hardware_shadow_field') return `hardware:${ref.fieldName || ''}`;
  if (ref.kind === 'global_ram') return `global:${ref.role || ''}`;
  if (ref.kind === 'support_data') return `support:${ref.name || ''}`;
  return `${ref.kind || 'ref'}:${ref.fieldName || ref.role || ref.name || ''}`;
}

function fieldRefLabel(ref) {
  if (!ref) return '';
  return ref.fieldName || ref.role || ref.name || fieldRefKey(ref);
}

function eventPhaseEdges(eventOutputCatalog) {
  const edges = [];
  for (const link of eventOutputCatalog.eventOutputLinks || []) {
    for (const phase of link.matchedOutputPhases || []) {
      edges.push({
        id: fixtureId('audio_event_output_edge', `${link.eventKey}_${phase.phaseId}`),
        eventKey: link.eventKey || '',
        eventKind: link.eventKind || '',
        eventLabel: link.eventLabel || '',
        opcode: link.opcode || '',
        outputPhaseId: phase.phaseId || '',
        chip: phase.chip || '',
        routineLabel: phase.routineLabel || '',
        writeCount: Number(phase.writeCount || 0),
        matchedRefLabels: (phase.matchedRefs || []).map(ref => ref.label || ref.key || '').filter(Boolean),
        confidence: phase.confidence || '',
      });
    }
  }
  return edges;
}

function branchFixtureRefs(outputModeBranchCatalog) {
  return (outputModeBranchCatalog.phaseBranchCandidates || []).map(candidate => ({
    id: fixtureId('audio_output_branch_candidate', `${candidate.branchId}_${candidate.phaseId}`),
    phaseId: candidate.phaseId || '',
    chip: candidate.chip || '',
    branchId: candidate.branchId || '',
    selectorRole: candidate.selectorRole || '',
    selectorAddress: candidate.selectorAddress || '',
    selectorBit: candidate.selectorBit,
    selectorValue: candidate.selectorValue,
    dispatchRoutineLabel: candidate.dispatchRoutineLabel || '',
    status: candidate.status || '',
  }));
}

function globalInputRefs(outputGlobalInputCatalog) {
  return (outputGlobalInputCatalog.globalInputs || []).map(input => ({
    id: fixtureId('audio_global_input_fixture', input.role),
    role: input.role || '',
    address: input.address || '',
    ramCatalogEntryId: input.ramCatalogEntryId || '',
    statusInTimeline: input.statusInTimeline || '',
    modelingStatus: input.modelingStatus || '',
    outputPhaseIds: uniqueSorted((input.outputPhaseRefs || []).map(ref => ref.phaseId)),
    smokeTimelineRefCount: Number(input.smokeTimelineRefCount || 0),
  }));
}

function buildFixtures(mapData, catalogs) {
  const phaseById = new Map((catalogs.outputRegister.outputPhases || []).map(phase => [phase.id, phase]));
  const edges = eventPhaseEdges(catalogs.eventOutput);
  const branchCandidates = branchFixtureRefs(catalogs.outputModeBranch);
  const globals = globalInputRefs(catalogs.outputGlobalInput);
  const edgesByPhase = new Map();
  const branchByPhase = new Map();
  const globalByPhase = new Map();

  for (const edge of edges) {
    if (!edgesByPhase.has(edge.outputPhaseId)) edgesByPhase.set(edge.outputPhaseId, []);
    edgesByPhase.get(edge.outputPhaseId).push(edge);
  }
  for (const candidate of branchCandidates) {
    if (!branchByPhase.has(candidate.phaseId)) branchByPhase.set(candidate.phaseId, []);
    branchByPhase.get(candidate.phaseId).push(candidate);
  }
  for (const input of globals) {
    for (const phaseId of input.outputPhaseIds || []) {
      if (!globalByPhase.has(phaseId)) globalByPhase.set(phaseId, []);
      globalByPhase.get(phaseId).push(input);
    }
  }

  const writeFixtures = [];
  const phaseFixtures = (catalogs.outputRegister.outputPhases || []).map(phase => {
    const region = findRegionById(mapData, phase.routine?.region?.id) || phase.routine?.region || null;
    const writes = (phase.writes || []).map((write, index) => {
      const fixture = {
        id: fixtureId('audio_port_write_fixture', `${phase.id}_${index}_${write.port}`),
        sourcePhaseId: phase.id,
        chip: phase.chip || '',
        routineLabel: phase.routineLabel || '',
        routineOffset: phase.routine?.offset || '',
        region: compactRegion(region),
        writeIndex: index,
        asmLine: write.line || null,
        port: write.port || '',
        purpose: write.purpose || '',
        valuePolicy: 'runtime_port_value_not_persisted',
        persistedRomByteCount: 0,
        persistedRegisterValueCount: 0,
        persistedSampleCount: 0,
      };
      writeFixtures.push(fixture);
      return fixture;
    });
    const phaseEdges = edgesByPhase.get(phase.id) || [];
    const phaseBranches = branchByPhase.get(phase.id) || [];
    const phaseGlobals = globalByPhase.get(phase.id) || [];
    return {
      id: fixtureId('audio_output_phase_fixture', phase.id),
      sourcePhaseId: phase.id,
      chip: phase.chip || '',
      confidence: phase.confidence || '',
      routineLabel: phase.routineLabel || '',
      routineRole: phase.routineRole || '',
      routineOffset: phase.routine?.offset || '',
      routineRegion: compactRegion(region),
      trigger: phase.trigger || '',
      registerFamily: phase.registerFamily || '',
      registerFormula: phase.registerFormula || '',
      summary: phase.summary || '',
      fieldInputRefs: (phase.fieldRefs || []).map(ref => ({
        kind: ref.kind || '',
        key: fieldRefKey(ref),
        label: fieldRefLabel(ref),
        relationship: ref.relationship || '',
        confidence: ref.confidence || '',
      })),
      writeFixtureIds: writes.map(write => write.id),
      writeCount: writes.length,
      ports: uniqueSorted(writes.map(write => write.port)),
      directEventOutputEdgeIds: phaseEdges.map(edge => edge.id),
      directEventKeys: uniqueSorted(phaseEdges.map(edge => edge.eventKey)),
      branchCandidateIds: phaseBranches.map(candidate => candidate.id),
      branchIds: uniqueSorted(phaseBranches.map(candidate => candidate.branchId)),
      globalInputFixtureIds: phaseGlobals.map(input => input.id),
      globalInputRoles: uniqueSorted(phaseGlobals.map(input => input.role)),
      evidence: phase.evidence || [],
      harnessStatus: 'metadata_ready_runtime_values_missing',
      persistedRomByteCount: 0,
      persistedRegisterValueCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
    };
  });

  return {
    phaseFixtures,
    writeFixtures,
    eventOutputEdges: edges,
    branchCandidateFixtures: branchCandidates,
    globalInputFixtures: globals,
    phaseById,
  };
}

function validateFixtures(catalogs, fixtures) {
  const phaseIds = new Set(fixtures.phaseFixtures.map(phase => phase.sourcePhaseId));
  const validationIssues = [];
  const phasesWithoutRoutineRegion = fixtures.phaseFixtures
    .filter(phase => !phase.routineRegion?.id)
    .map(phase => phase.sourcePhaseId);
  const phasesWithoutWrites = fixtures.phaseFixtures
    .filter(phase => !phase.writeFixtureIds.length)
    .map(phase => phase.sourcePhaseId);
  const eventEdgesWithMissingPhase = fixtures.eventOutputEdges
    .filter(edge => !phaseIds.has(edge.outputPhaseId))
    .map(edge => edge.id);
  const branchCandidatesWithMissingPhase = fixtures.branchCandidateFixtures
    .filter(candidate => candidate.phaseId && !phaseIds.has(candidate.phaseId))
    .map(candidate => candidate.id);
  const globalInputsWithMissingPhase = fixtures.globalInputFixtures
    .flatMap(input => (input.outputPhaseIds || [])
      .filter(phaseId => !phaseIds.has(phaseId))
      .map(phaseId => `${input.role}:${phaseId}`));
  const outputSummary = catalogs.outputRegister.summary || {};
  if (Number(outputSummary.phaseCount || 0) !== fixtures.phaseFixtures.length) {
    validationIssues.push(`phase count mismatch ${outputSummary.phaseCount} vs ${fixtures.phaseFixtures.length}`);
  }
  if (Number(outputSummary.writeCount || 0) !== fixtures.writeFixtures.length) {
    validationIssues.push(`write count mismatch ${outputSummary.writeCount} vs ${fixtures.writeFixtures.length}`);
  }
  if (Number(catalogs.eventOutput.summary?.totalDirectOutputPhaseLinks || 0) !== fixtures.eventOutputEdges.length) {
    validationIssues.push(`event-output edge count mismatch ${catalogs.eventOutput.summary?.totalDirectOutputPhaseLinks} vs ${fixtures.eventOutputEdges.length}`);
  }
  if (Number(catalogs.outputModeBranch.summary?.phaseBranchCandidateCount || 0) !== fixtures.branchCandidateFixtures.length) {
    validationIssues.push(`branch candidate count mismatch ${catalogs.outputModeBranch.summary?.phaseBranchCandidateCount} vs ${fixtures.branchCandidateFixtures.length}`);
  }
  validationIssues.push(
    ...phasesWithoutRoutineRegion.map(id => `phase ${id} has no routine region`),
    ...phasesWithoutWrites.map(id => `phase ${id} has no port write fixtures`),
    ...eventEdgesWithMissingPhase.map(id => `event output edge ${id} references missing phase`),
    ...branchCandidatesWithMissingPhase.map(id => `branch candidate ${id} references missing phase`),
    ...globalInputsWithMissingPhase.map(id => `global input references missing phase ${id}`),
  );

  return {
    phasesWithoutRoutineRegion,
    phasesWithoutWrites,
    eventEdgesWithMissingPhase,
    branchCandidatesWithMissingPhase,
    globalInputsWithMissingPhase,
    issueCount: validationIssues.length,
    issues: validationIssues,
    readyForRuntimeHarness: validationIssues.length === 0,
  };
}

function buildCatalog(mapData) {
  const catalogs = {
    outputRegister: requireCatalog(mapData, sourceCatalogIds.outputRegister),
    eventOutput: requireCatalog(mapData, sourceCatalogIds.eventOutput),
    outputGlobalInput: requireCatalog(mapData, sourceCatalogIds.outputGlobalInput),
    outputModeBranch: requireCatalog(mapData, sourceCatalogIds.outputModeBranch),
    runtimeGlobalFlow: requireCatalog(mapData, sourceCatalogIds.runtimeGlobalFlow),
    frameStepModel: requireCatalog(mapData, sourceCatalogIds.frameStepModel),
  };
  const fixtures = buildFixtures(mapData, catalogs);
  const validation = validateFixtures(catalogs, fixtures);
  const fieldInputKeys = uniqueSorted(fixtures.phaseFixtures.flatMap(phase => (phase.fieldInputRefs || []).map(ref => ref.key)));
  const directEventLinkedPhaseIds = uniqueSorted(fixtures.eventOutputEdges.map(edge => edge.outputPhaseId));
  const branchLinkedPhaseIds = uniqueSorted(fixtures.branchCandidateFixtures.map(edge => edge.phaseId));
  const globalInputLinkedPhaseIds = uniqueSorted(fixtures.globalInputFixtures.flatMap(input => input.outputPhaseIds || []));
  const runtimeFlowSummary = catalogs.runtimeGlobalFlow.summary || {};
  const outputGlobalSummary = catalogs.outputGlobalInput.summary || {};

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: fixture ids, phase ids, routine labels, region ids, ASM line numbers, port names, RAM roles, field names, branch ids, event keys, counts, and catalog links. No ROM bytes, decoded music, stream bytes, PSG/FM register values, register traces, samples, or generated audio are embedded.',
    target: {
      purpose: 'Expose a stable metadata-only runtime fixture contract for PSG/FM output phases before implementing an audible browser sound engine.',
      runtimeValuePolicy: 'Runtime port/register values may be inspected live but must not be written into repository metadata.',
    },
    summary: {
      outputPhaseFixtureCount: fixtures.phaseFixtures.length,
      portWriteFixtureCount: fixtures.writeFixtures.length,
      psgPhaseFixtureCount: fixtures.phaseFixtures.filter(phase => phase.chip === 'psg').length,
      fmPhaseFixtureCount: fixtures.phaseFixtures.filter(phase => phase.chip === 'fm').length,
      mixedPhaseFixtureCount: fixtures.phaseFixtures.filter(phase => phase.chip === 'mixed').length,
      psgWriteFixtureCount: fixtures.writeFixtures.filter(write => write.chip === 'psg').length,
      fmWriteFixtureCount: fixtures.writeFixtures.filter(write => write.chip === 'fm').length,
      mixedWriteFixtureCount: fixtures.writeFixtures.filter(write => write.chip === 'mixed').length,
      portWriteCounts: countBy(fixtures.writeFixtures, write => write.port),
      directEventOutputEdgeCount: fixtures.eventOutputEdges.length,
      directEventLinkedPhaseCount: directEventLinkedPhaseIds.length,
      branchCandidateFixtureCount: fixtures.branchCandidateFixtures.length,
      branchLinkedPhaseCount: branchLinkedPhaseIds.length,
      globalInputFixtureCount: fixtures.globalInputFixtures.length,
      globalInputLinkedPhaseCount: globalInputLinkedPhaseIds.length,
      fieldInputKeyCount: fieldInputKeys.length,
      fieldInputKeys,
      frameStepTraceOperationCount: catalogs.frameStepModel.summary?.traceOperationCount || 0,
      frameStepMaxFramesPerChannel: catalogs.frameStepModel.summary?.maxFramesPerChannel || 0,
      runtimeGlobalFlowAccessSiteCount: runtimeFlowSummary.accessSiteCount || 0,
      runtimeGlobalFlowWriteSiteCount: runtimeFlowSummary.writeSiteCount || 0,
      runtimeGlobalFlowReadSiteCount: runtimeFlowSummary.readSiteCount || 0,
      smokeTimelineGlobalInputRefCount: outputGlobalSummary.smokeTimelineGlobalInputRefCount || 0,
      validationIssueCount: validation.issueCount,
      readyForRuntimeHarness: validation.readyForRuntimeHarness,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
    },
    emulatorEventContract: {
      eventKeys: [
        'phaseFixtureId',
        'writeFixtureId',
        'frame',
        'pc',
        'chip',
        'port',
        'activeChannel',
        'inputFieldKeys',
        'branchId',
      ],
      persistPolicy: 'Event values are runtime-only. Metadata may record ids, offsets, ports, field names, and counts, but not PSG/FM register values or samples.',
      outputModeGate: 'Use audio_output_mode_select ($C232 bit 0) branch fixtures to classify PSG versus FM output paths.',
    },
    phaseFixtures: fixtures.phaseFixtures,
    portWriteFixtures: fixtures.writeFixtures,
    eventOutputEdges: fixtures.eventOutputEdges,
    branchCandidateFixtures: fixtures.branchCandidateFixtures,
    globalInputFixtures: fixtures.globalInputFixtures,
    validation,
    evidence: [
      `${sourceCatalogIds.outputRegister} supplies the 14 PSG/FM output phases and 39 static port-write sites.`,
      `${sourceCatalogIds.eventOutput} supplies 7 direct stream-event to output-phase edges.`,
      `${sourceCatalogIds.outputModeBranch} separates $C232 PSG/FM branch candidates for all output phases.`,
      `${sourceCatalogIds.outputGlobalInput} and ${sourceCatalogIds.runtimeGlobalFlow} supply runtime global input roles and access-site evidence.`,
      `${sourceCatalogIds.frameStepModel} supplies the read-only frame-step trace model that will feed this output fixture contract.`,
    ],
    nextLeads: [
      'Wire the audio preview timeline to emit in-memory phaseFixtureId/writeFixtureId events when stream events reach output phases.',
      'Resolve $C232 and $C23C runtime globals before using this fixture catalog for audible PSG/FM playback.',
      'Once runtime output events are available, build an SMS PSG/YM2413 emulation layer that consumes live values without persisting them.',
    ],
  };
}

function addRegionDetail(details, regionId, fixture) {
  if (!regionId) return;
  if (!details.has(regionId)) {
    details.set(regionId, {
      phaseFixtureIds: new Set(),
      writeFixtureIds: new Set(),
      chips: new Set(),
      ports: new Set(),
      writeCount: 0,
    });
  }
  const detail = details.get(regionId);
  detail.phaseFixtureIds.add(fixture.id);
  for (const writeId of fixture.writeFixtureIds || []) detail.writeFixtureIds.add(writeId);
  if (fixture.chip) detail.chips.add(fixture.chip);
  for (const port of fixture.ports || []) detail.ports.add(port);
  detail.writeCount += fixture.writeCount || 0;
}

function annotateRegions(mapData, catalog) {
  const details = new Map();
  const changedRegions = [];
  const missingRegions = [];
  for (const fixture of catalog.phaseFixtures || []) {
    addRegionDetail(details, fixture.routineRegion?.id, fixture);
  }
  for (const [regionId, detail] of details) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'audio_runtime_output_fixture_region' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.audioRuntimeOutputFixtureAudit = {
        catalogId,
        role: 'audio_runtime_output_fixture_region',
        confidence: 'medium_high',
        summary: 'Region hosts PSG/FM output phase fixtures for the metadata-only audio runtime output contract.',
        detail: {
          phaseFixtureIds: uniqueSorted([...detail.phaseFixtureIds]),
          writeFixtureIds: uniqueSorted([...detail.writeFixtureIds]),
          chips: uniqueSorted([...detail.chips]),
          ports: uniqueSorted([...detail.ports]),
          writeCount: detail.writeCount,
          readyForRuntimeHarness: catalog.summary.readyForRuntimeHarness,
          validationIssueCount: catalog.summary.validationIssueCount,
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      phaseFixtureCount: detail.phaseFixtureIds.size,
      writeFixtureCount: detail.writeFixtureIds.size,
      chips: uniqueSorted([...detail.chips]),
      ports: uniqueSorted([...detail.ports]),
    });
  }
  return { changedRegions, missingRegions };
}

function annotateRam(mapData, catalog) {
  const changedRam = [];
  const missingRam = [];
  for (const input of catalog.globalInputFixtures || []) {
    const ram = findRamByAddress(mapData, input.address);
    if (!ram) {
      missingRam.push({ address: input.address, role: input.role });
      continue;
    }
    if (apply) {
      ram.analysis = ram.analysis || {};
      ram.analysis.audioRuntimeOutputFixtureAudit = {
        catalogId,
        role: input.role,
        statusInTimeline: input.statusInTimeline,
        modelingStatus: input.modelingStatus,
        outputPhaseIds: input.outputPhaseIds,
        smokeTimelineRefCount: input.smokeTimelineRefCount,
        confidence: input.role === 'psg_volume_bias_shared_byte' ? 'medium' : 'high',
        summary: 'RAM variable is a runtime global input in the audio PSG/FM output fixture contract.',
        readyForRuntimeHarness: catalog.summary.readyForRuntimeHarness,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      address: input.address,
      role: input.role,
      outputPhaseCount: (input.outputPhaseIds || []).length,
      modelingStatus: input.modelingStatus,
    });
  }
  return { changedRam, missingRam };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    topPhaseFixtures: catalog.phaseFixtures.slice(0, 14).map(phase => ({
      id: phase.id,
      sourcePhaseId: phase.sourcePhaseId,
      chip: phase.chip,
      routineLabel: phase.routineLabel,
      regionId: phase.routineRegion?.id || null,
      writeCount: phase.writeCount,
      directEventEdgeCount: (phase.directEventOutputEdgeIds || []).length,
      branchCandidateCount: (phase.branchCandidateIds || []).length,
      globalInputRoleCount: (phase.globalInputRoles || []).length,
      harnessStatus: phase.harnessStatus,
    })),
    validation: {
      issueCount: catalog.validation.issueCount,
      readyForRuntimeHarness: catalog.validation.readyForRuntimeHarness,
      issues: catalog.validation.issues,
    },
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
  mapData.audioCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'audio_runtime_output_fixture_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    missingRam: annotation.missingRam,
    sample: reportSample(catalog),
    assetPolicy: catalog.assetPolicy,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function applyStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return null;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.audioRuntimeOutputFixtureCatalog = catalogId;
  staticMap.summary.audioRuntimeOutputFixturePhases = catalog.summary.outputPhaseFixtureCount;
  staticMap.summary.audioRuntimeOutputFixtureWrites = catalog.summary.portWriteFixtureCount;
  staticMap.summary.audioRuntimeOutputFixtureEventEdges = catalog.summary.directEventOutputEdgeCount;
  staticMap.summary.audioRuntimeOutputFixtureBranchCandidates = catalog.summary.branchCandidateFixtureCount;
  staticMap.summary.audioRuntimeOutputFixtureGlobalInputs = catalog.summary.globalInputFixtureCount;
  staticMap.summary.audioRuntimeOutputFixtureValidationIssues = catalog.summary.validationIssueCount;
  staticMap.summary.audioRuntimeOutputFixtureReady = catalog.summary.readyForRuntimeHarness;

  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.audio = insertAfter(
    staticMap.primaryCatalogs.audio,
    sourceCatalogIds.outputRegister,
    catalogId
  );
  staticMap.primaryCatalogs.gameplay = insertAfter(
    staticMap.primaryCatalogs.gameplay,
    'world-player-audio-routine-confidence-backfill-catalog-2026-06-26',
    catalogId
  );
  staticMap.primaryCatalogs.coverage = insertAfter(
    staticMap.primaryCatalogs.coverage,
    'world-audio-asset-confidence-backfill-catalog-2026-06-26',
    catalogId
  );

  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  const note = 'Use world-audio-runtime-output-fixture-catalog-2026-06-26 as the PSG/FM callback contract for proving audio output phases without persisting register values or samples.';
  const anchor = staticMap.nextLeads.findIndex(noteText => noteText.includes(sourceCatalogIds.outputRegister));
  if (anchor === -1) staticMap.nextLeads.push(note);
  else staticMap.nextLeads.splice(anchor + 1, 0, note);

  writeJson(staticMapPath, staticMap);
  return {
    staticMapPath: path.relative(repoRoot, staticMapPath),
    summaryFieldsUpdated: [
      'audioRuntimeOutputFixtureCatalog',
      'audioRuntimeOutputFixturePhases',
      'audioRuntimeOutputFixtureWrites',
      'audioRuntimeOutputFixtureEventEdges',
      'audioRuntimeOutputFixtureBranchCandidates',
      'audioRuntimeOutputFixtureGlobalInputs',
      'audioRuntimeOutputFixtureValidationIssues',
      'audioRuntimeOutputFixtureReady',
    ],
    primaryCatalogBucketsUpdated: ['audio', 'gameplay', 'coverage'],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const regionAnnotation = annotateRegions(mapData, catalog);
  const ramAnnotation = annotateRam(mapData, catalog);
  const annotation = { ...regionAnnotation, ...ramAnnotation };
  let staticMapUpdate = null;
  if (apply) {
    applyCatalog(mapData, catalog, annotation);
    writeJson(mapPath, mapData);
    staticMapUpdate = applyStaticMap(catalog);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    sample: reportSample(catalog),
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    missingRam: annotation.missingRam,
    staticMapUpdate,
  }, null, 2));
}

main();
