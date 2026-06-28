#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const asmPath = path.join(repoRoot, "projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm");
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-audio-port-write-coverage-audit.mjs';
const fixtureCatalogId = 'world-audio-runtime-output-fixture-catalog-2026-06-26';
const eventContractCatalogId = 'world-audio-runtime-output-event-contract-catalog-2026-06-26';
const catalogId = 'world-audio-port-write-coverage-catalog-2026-06-26';
const reportId = 'audio-port-write-coverage-audit-2026-06-26';
const audioPorts = new Set(['Port_PSG', 'Port_FMAddress', 'Port_FMData']);

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
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  return parseInt(value.replace(/^\$/, '0x'), 16);
}

function hex(value, width = 5) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(width, '0')}`;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort((a, b) => {
    const ax = parseOffset(a);
    const bx = parseOffset(b);
    if (Number.isFinite(ax) && Number.isFinite(bx)) return ax - bx;
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

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  if (!match) return null;
  return parseInt(match[1], 16);
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || '',
    name: region.name || '',
    confidence: region.confidence || '',
  };
}

function findRegionByOffset(mapData, offset) {
  if (!Number.isFinite(offset)) return null;
  return (mapData.regions || []).find(region => {
    const start = parseOffset(region.offset);
    const size = Number(region.size || 0);
    return Number.isFinite(start) && size > 0 && offset >= start && offset < start + size;
  }) || null;
}

function nextPort(port) {
  if (port === 'Port_FMAddress') return 'Port_FMData';
  if (port === 'Port_FMData') return 'Port_AudioControl';
  if (port === 'Port_PSG') return 'Port_VDPData';
  return null;
}

function previousPort(port) {
  if (port === 'Port_FMData') return 'Port_FMAddress';
  if (port === 'Port_AudioControl') return 'Port_FMData';
  if (port === 'Port_VDPData') return 'Port_PSG';
  return null;
}

function parseAsmAudioWrites(asmText, mapData) {
  const writes = [];
  const lines = asmText.split(/\r?\n/);
  let currentLabel = '';
  let currentLabelOffset = null;
  let currentRegion = null;
  let cPort = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const labelMatch = /^([A-Za-z0-9_+.]+):/.exec(line.trim());
    if (labelMatch) {
      const label = labelMatch[1];
      if (label.startsWith('_LABEL_') || label.startsWith('_DATA_')) {
        currentLabel = label;
        currentLabelOffset = labelOffset(label);
        currentRegion = findRegionByOffset(mapData, currentLabelOffset);
      }
      cPort = null;
    }

    const withoutComment = line.split(';')[0].trim();
    const ldCMatch = /^ld\s+c,\s*(Port_[A-Za-z0-9_]+)/i.exec(withoutComment);
    if (ldCMatch) cPort = ldCMatch[1];
    if (/^inc\s+c$/i.test(withoutComment)) cPort = nextPort(cPort);
    if (/^dec\s+c$/i.test(withoutComment)) cPort = previousPort(cPort);

    const directOut = /^out\s+\((Port_[A-Za-z0-9_]+)\),\s*([a-z][a-z0-9]*)$/i.exec(withoutComment);
    const indirectOut = /^out\s+\(c\),\s*([a-z][a-z0-9]*)$/i.exec(withoutComment);
    const port = directOut ? directOut[1] : indirectOut ? cPort : null;
    if (!port || !audioPorts.has(port)) return;

    writes.push({
      line: lineNumber,
      port,
      operand: directOut ? directOut[2] : indirectOut[1],
      addressing: directOut ? 'direct_port_symbol' : 'indirect_c_port_symbol',
      routineLabel: currentLabel,
      routineOffset: currentLabelOffset == null ? null : hex(currentLabelOffset),
      region: compactRegion(currentRegion),
      evidence: indirectOut
        ? [`ASM line ${lineNumber} writes through C after C is tracked as ${port}.`]
        : [`ASM line ${lineNumber} writes directly to ${port}.`],
    });
  });

  return writes;
}

function fixtureKey(fixture) {
  return `${fixture.asmLine || ''}:${fixture.port || ''}`;
}

function asmWriteKey(write) {
  return `${write.line}:${write.port}`;
}

function buildCoverage(mapData) {
  const fixtureCatalog = requireCatalog(mapData, fixtureCatalogId);
  const eventContract = requireCatalog(mapData, eventContractCatalogId);
  const asmWrites = parseAsmAudioWrites(fs.readFileSync(asmPath, 'utf8'), mapData);
  const fixtures = fixtureCatalog.portWriteFixtures || [];
  const fixtureByKey = new Map(fixtures.map(fixture => [fixtureKey(fixture), fixture]));
  const asmByKey = new Map(asmWrites.map(write => [asmWriteKey(write), write]));

  const matchedWrites = asmWrites.map(write => {
    const fixture = fixtureByKey.get(asmWriteKey(write)) || null;
    const canonicalRegion = fixture?.region || write.region || null;
    const scannerRegion = write.region || null;
    return {
      line: write.line,
      port: write.port,
      addressing: write.addressing,
      routineLabel: fixture?.routineLabel || write.routineLabel,
      routineOffset: fixture?.routineOffset || write.routineOffset,
      region: canonicalRegion,
      scannerRoutineLabel: write.routineLabel,
      scannerRoutineOffset: write.routineOffset,
      scannerRegion,
      fixtureId: fixture?.id || null,
      sourcePhaseId: fixture?.sourcePhaseId || null,
      chip: fixture?.chip || '',
      purpose: fixture?.purpose || '',
      fixtureRegionId: fixture?.region?.id || null,
      coveredByFixture: Boolean(fixture),
    };
  });

  const missingFixtureWrites = matchedWrites.filter(write => !write.coveredByFixture);
  const fixtureWithoutAsmWrites = fixtures
    .filter(fixture => !asmByKey.has(fixtureKey(fixture)))
    .map(fixture => ({
      fixtureId: fixture.id,
      asmLine: fixture.asmLine,
      port: fixture.port,
      sourcePhaseId: fixture.sourcePhaseId,
      routineLabel: fixture.routineLabel,
      routineOffset: fixture.routineOffset,
      regionId: fixture.region?.id || null,
    }));

  const portsByRegion = {};
  for (const write of matchedWrites) {
    const regionId = write.region?.id || write.fixtureRegionId;
    if (!regionId) continue;
    if (!portsByRegion[regionId]) {
      portsByRegion[regionId] = {
        region: write.region || null,
        writeCount: 0,
        ports: [],
        phaseIds: [],
        fixtureIds: [],
        asmLines: [],
        routineLabels: [],
        scannerRoutineLabels: [],
        scannerRegionIds: [],
      };
    }
    const row = portsByRegion[regionId];
    row.writeCount++;
    row.ports.push(write.port);
    row.phaseIds.push(write.sourcePhaseId);
    row.fixtureIds.push(write.fixtureId);
    row.asmLines.push(write.line);
    row.routineLabels.push(write.routineLabel);
    row.scannerRoutineLabels.push(write.scannerRoutineLabel);
    row.scannerRegionIds.push(write.scannerRegion?.id);
  }
  const regionCoverage = Object.entries(portsByRegion).map(([regionId, row]) => ({
    regionId,
    region: row.region,
    writeCount: row.writeCount,
    ports: uniqueSorted(row.ports),
    phaseIds: uniqueSorted(row.phaseIds),
    fixtureIds: uniqueSorted(row.fixtureIds),
    asmLines: uniqueSorted(row.asmLines),
    routineLabels: uniqueSorted(row.routineLabels),
    scannerRoutineLabels: uniqueSorted(row.scannerRoutineLabels),
    scannerRegionIds: uniqueSorted(row.scannerRegionIds),
  })).sort((a, b) => parseOffset(a.region?.offset) - parseOffset(b.region?.offset));

  const validationIssues = [];
  if (asmWrites.length !== fixtures.length) {
    validationIssues.push(`ASM audio write count ${asmWrites.length} does not match fixture count ${fixtures.length}`);
  }
  validationIssues.push(
    ...missingFixtureWrites.map(write => `ASM line ${write.line} ${write.port} is not covered by an audio port-write fixture`),
    ...fixtureWithoutAsmWrites.map(fixture => `fixture ${fixture.fixtureId} line ${fixture.asmLine} ${fixture.port} does not match an ASM audio write`),
  );
  if (fixtureCatalog.summary?.readyForRuntimeHarness !== true) {
    validationIssues.push(`${fixtureCatalogId} is not ready for runtime harness use`);
  }
  if (eventContract.summary?.readyForRuntimeHarness !== true) {
    validationIssues.push(`${eventContractCatalogId} is not ready for runtime harness use`);
  }

  return {
    asmWrites,
    matchedWrites,
    missingFixtureWrites,
    fixtureWithoutAsmWrites,
    regionCoverage,
    validation: {
      issueCount: validationIssues.length,
      issues: validationIssues,
      allAsmWritesCovered: missingFixtureWrites.length === 0,
      allFixturesResolveToAsmWrites: fixtureWithoutAsmWrites.length === 0,
    },
  };
}

function buildCatalog(mapData) {
  const fixtureCatalog = requireCatalog(mapData, fixtureCatalogId);
  const eventContract = requireCatalog(mapData, eventContractCatalogId);
  const coverage = buildCoverage(mapData);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [fixtureCatalogId, eventContractCatalogId],
    assetPolicy: 'Metadata only: ASM line numbers, labels, port names, fixture ids, phase ids, region ids, counts, and coverage decisions. No ROM bytes, decoded music streams, register values, register traces, port values, audio bytes, samples, or hashes are embedded.',
    summary: {
      asmAudioWriteCount: coverage.asmWrites.length,
      fixturePortWriteCount: (fixtureCatalog.portWriteFixtures || []).length,
      matchedWriteCount: coverage.matchedWrites.filter(write => write.coveredByFixture).length,
      missingFixtureWriteCount: coverage.missingFixtureWrites.length,
      fixtureWithoutAsmWriteCount: coverage.fixtureWithoutAsmWrites.length,
      directPortSymbolWriteCount: coverage.asmWrites.filter(write => write.addressing === 'direct_port_symbol').length,
      indirectCPortSymbolWriteCount: coverage.asmWrites.filter(write => write.addressing === 'indirect_c_port_symbol').length,
      portWriteCounts: countBy(coverage.asmWrites, write => write.port),
      routineCount: uniqueSorted(coverage.asmWrites.map(write => write.routineLabel)).length,
      regionCount: coverage.regionCoverage.length,
      fixtureCatalogReady: fixtureCatalog.summary?.readyForRuntimeHarness === true,
      eventContractReady: eventContract.summary?.readyForRuntimeHarness === true,
      validationIssueCount: coverage.validation.issueCount,
      allAsmWritesCovered: coverage.validation.allAsmWritesCovered,
      allFixturesResolveToAsmWrites: coverage.validation.allFixturesResolveToAsmWrites,
      readyForRuntimeHarness: coverage.validation.issueCount === 0,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPortValueCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
    },
    coverage: {
      matchedWrites: coverage.matchedWrites,
      missingFixtureWrites: coverage.missingFixtureWrites,
      fixtureWithoutAsmWrites: coverage.fixtureWithoutAsmWrites,
      regionCoverage: coverage.regionCoverage,
    },
    validation: coverage.validation,
    evidence: [
      'ASM defines Port_PSG, Port_FMAddress, and Port_FMData as the sound-chip output ports.',
      'The audit scans direct out (Port_PSG|Port_FMAddress|Port_FMData), a instructions and tracks the _LABEL_C86B_ indirect out (c), e/a pair through ld c, Port_FMAddress plus inc/dec c.',
      `${fixtureCatalogId} supplies one metadata-only fixture per modeled sound-chip port write.`,
      `${eventContractCatalogId} confirms that runtime output events are metadata-only and reject register/port/audio payload values.`,
      'Coverage is matched by ASM line number and symbolic port name only.',
    ],
    nextLeads: [
      'Use this catalog as a regression gate before changing audio output phase or runtime fixture metadata.',
      'When building the PSG/FM player, emit runtime output events against these fixture ids without persisting register or port values.',
      'If future ASM imports add a sound-chip out instruction not listed here, classify it before promoting audio output completeness.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const region of mapData.regions || []) {
    if (region.analysis?.audioPortWriteCoverageAudit) delete region.analysis.audioPortWriteCoverageAudit;
  }
  for (const item of catalog.coverage.regionCoverage || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === item.regionId);
    if (!region) {
      missingRegions.push({ id: item.regionId, role: 'audio_port_write_coverage' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.audioPortWriteCoverageAudit = {
      catalogId,
      kind: 'audio_port_write_coverage',
      confidence: catalog.summary.readyForRuntimeHarness ? 'high' : 'medium',
      writeCount: item.writeCount,
      ports: item.ports,
      phaseIds: item.phaseIds,
      fixtureIds: item.fixtureIds,
      asmLines: item.asmLines,
      routineLabels: item.routineLabels,
      scannerRoutineLabels: item.scannerRoutineLabels,
      scannerRegionIds: item.scannerRegionIds,
      allAsmWritesCovered: catalog.summary.allAsmWritesCovered,
      allFixturesResolveToAsmWrites: catalog.summary.allFixturesResolveToAsmWrites,
      summary: 'Sound-chip port writes in this routine are covered by metadata-only audio output fixtures.',
      evidence: [
        `${catalogId} matches ASM line(s) ${item.asmLines.join(', ')} against audio port-write fixture ids.`,
        item.scannerRoutineLabels?.some(label => !item.routineLabels.includes(label))
          ? `The raw ASM scan saw containing label(s) ${item.scannerRoutineLabels.join(', ')}; the canonical audio fixture routine label(s) are ${item.routineLabels.join(', ')}.`
          : `The raw ASM scan and canonical fixture label agree on ${item.routineLabels.join(', ')}.`,
        'The match uses ASM line number and symbolic port name only; runtime values are not persisted.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      writeCount: item.writeCount,
      ports: item.ports,
    });
  }

  mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
  mapData.audioCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'audio_port_write_coverage_audit',
    generatedAt: now,
    schemaVersion: 1,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      changedRegionCount: changedRegions.length,
      missingRegionCount: missingRegions.length,
    },
    changedRegions,
    missingRegions,
    validation: catalog.validation,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
    assetPolicy: catalog.assetPolicy,
  });
  mapData.updatedAt = now;
  return { changedRegions, missingRegions };
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.audioPortWriteCoverageCatalog = catalogId;
  staticMap.summary.audioPortWriteCoverageAsmWriteCount = catalog.summary.asmAudioWriteCount;
  staticMap.summary.audioPortWriteCoverageFixtureWriteCount = catalog.summary.fixturePortWriteCount;
  staticMap.summary.audioPortWriteCoverageMatchedWriteCount = catalog.summary.matchedWriteCount;
  staticMap.summary.audioPortWriteCoverageMissingFixtureWriteCount = catalog.summary.missingFixtureWriteCount;
  staticMap.summary.audioPortWriteCoverageFixtureWithoutAsmWriteCount = catalog.summary.fixtureWithoutAsmWriteCount;
  staticMap.summary.audioPortWriteCoveragePorts = catalog.summary.portWriteCounts;
  staticMap.summary.audioPortWriteCoverageReady = catalog.summary.readyForRuntimeHarness;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    sourceAsm: "projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm",
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-audio-port-write-coverage-catalog-2026-06-26 as the PSG/FM hardware-output coverage gate before changing audio output fixtures or implementing the sound player.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let annotation = { changedRegions: [], missingRegions: [] };
  if (apply) {
    annotation = applyCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    validation: catalog.validation,
    changedRegionCount: annotation.changedRegions.length,
    missingRegionCount: annotation.missingRegions.length,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
  if (catalog.validation.issueCount) process.exitCode = 1;
}

main();
