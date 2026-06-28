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
const catalogId = 'world-bank2-hud-counter-catalog-2026-06-25';
const reportId = 'bank2-hud-counter-audit-2026-06-25';
const toolName = 'tools/world-bank2-hud-counter-audit.mjs';

const ENTRIES = [{
  offset: 0x09A44,
  label: '_LABEL_9A44_',
  role: 'bank2_hud_counter_writer',
  name: '_LABEL_9A44_ bank-2 HUD counter writer',
  type: 'code',
  family: 'bank2_scene_hud',
  confidence: 'high',
  calls: [],
  ramRefs: ['_RAM_D16A_'],
  ports: ['Port_VDPAddress', 'Port_VDPData'],
  summary: 'Writes a three-character HUD/status counter derived from _RAM_D16A_ to VDP address 0x7878, clamping values at or above 0x0640 to a fixed capped display.',
  evidence: [
    '_LABEL_9A44_ is an ASM code label at ROM offset 0x09A44.',
    'ASM lines 19937-20004 set VDP address 0x7878, compare _RAM_D16A_ against 0x0640, write a capped display for larger values, otherwise divide by 0x00A0 and derive two digit tiles before returning.',
    'ASM lines 19888 and 19895 show _LABEL_99A1_ calling _LABEL_9A44_ after changing _RAM_D16A_; ASM lines 20006-20009 show _LABEL_9A9F_ initializing the surrounding HUD screen program before jumping to _LABEL_9A44_.',
  ],
}];

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
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank2HudCounterAudit');
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
      routineCount: ENTRIES.length,
      assetPolicy: 'Metadata only: ASM label, offset, routine role, RAM references, port names, and evidence. No ROM bytes or decoded graphics are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    evidence: [
      'ASM lines 19888-20009 connect _LABEL_9A44_ to the scripted damage/status path and the bank-2 HUD initializer.',
      'The routine writes only VDP tile ids/attributes at runtime; this catalog stores no rendered graphics or ROM byte data.',
    ],
  };
}

function annotateRegion(region, item) {
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  if (item.name && !region.name) region.name = item.name;
  if (item.summary && !region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank2HudCounterAudit = {
    catalogId,
    kind: item.role,
    family: item.family,
    label: item.label,
    confidence: item.confidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    calls: item.calls,
    ramRefs: item.ramRefs,
    ports: item.ports,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    label: item.label,
    role: item.role,
    confidence: item.confidence,
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
    mapData.bank2HudCounterCatalogs = (mapData.bank2HudCounterCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.bank2HudCounterCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_hud_counter_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: changes.annotated.length,
        missingRegions: changes.missing.length,
        inferredOnlyRegionsCovered: changes.annotated.filter(change => change.wasInferredOnlyBeforeAudit).length,
      },
      annotatedRegions: changes.annotated,
      missingRegions: changes.missing,
      nextLeads: [
        'Trace _RAM_D16A_ producers in _LABEL_99A1_ and related bank-2 object scripts to name the displayed quantity precisely.',
        'Model the _LABEL_9A9F_ HUD screen_prog fragment as a reusable screen_prog recipe companion.',
        'Add analyzer diagnostics that show VDP destination and unresolved tile ids for this counter without embedding tile graphics.',
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
    },
    missingRegions: changes.missing,
  }, null, 2));
}

main();
