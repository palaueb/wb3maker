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
const catalogId = 'world-entity-behavior-table-target-catalog-2026-06-25';
const reportId = 'entity-behavior-table-target-audit-2026-06-25';
const toolName = 'tools/world-entity-behavior-table-target-audit.mjs';
const sourceCatalogId = 'world-asm-pointer-candidate-resolution-catalog-2026-06-25';

const evidencePriority = [
  'entityRuntimeRoutineAudit',
  'bank0EntityBehaviorAudit',
  'bank0EntityInitHeadsAudit',
  'bank2DispatchTableAudit',
  'bank2StateMachineAudit',
  'entityBehaviorAudit',
  'entityBehaviorCodeAudit',
  'inferred',
  'asmPointerCandidateResolutionAudit',
  'asmDataLabelCensusAudit',
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
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

function findCatalog(mapData, id) {
  const buckets = Object.keys(mapData)
    .filter(key => Array.isArray(mapData[key]) && /catalog/i.test(key))
    .flatMap(key => mapData[key]);
  return buckets.find(item => item?.id === id) || null;
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
  if (!startLine) {
    return {
      label,
      missingAsm: true,
      asmLine: null,
      lineRange: null,
      calls: [],
      branches: [],
      dataRefs: [],
      ramRefs: [],
      ixRefs: [],
      iyRefs: [],
    };
  }
  const body = [];
  for (let i = startLine; i < asmIndex.lines.length; i++) {
    if (i + 1 > startLine && /^_(?:LABEL|DATA)_[0-9A-F]+_:/.test(asmIndex.lines[i])) break;
    const code = cleanCode(asmIndex.lines[i]);
    if (code) body.push({ line: i + 1, code });
  }
  const calls = [];
  const branches = [];
  const dataRefs = [];
  const ramRefs = [];
  const ixRefs = [];
  const iyRefs = [];
  for (const item of body) {
    let match = /\b(call|jp|jr)\s+(_LABEL_[0-9A-F]+_)\b/i.exec(item.code);
    if (match) {
      const ref = { line: item.line, op: match[1].toLowerCase(), label: match[2] };
      if (ref.op === 'call') calls.push(ref);
      else branches.push(ref);
    }
    const dataRe = /_DATA_[0-9A-F]+_/gi;
    while ((match = dataRe.exec(item.code)) !== null) dataRefs.push({ line: item.line, label: match[0] });
    const ramRe = /_RAM_[0-9A-F]+_/gi;
    while ((match = ramRe.exec(item.code)) !== null) ramRefs.push({ line: item.line, label: match[0] });
    const ixRe = /\(ix\+(\d+)\)/gi;
    while ((match = ixRe.exec(item.code)) !== null) ixRefs.push({ line: item.line, offset: Number(match[1]) });
    const iyRe = /\(iy\+(\d+)\)/gi;
    while ((match = iyRe.exec(item.code)) !== null) iyRefs.push({ line: item.line, offset: Number(match[1]) });
  }
  return {
    label,
    missingAsm: false,
    asmLine: startLine,
    lineRange: { start: startLine, end: body.length ? body[body.length - 1].line : startLine },
    calls: uniqueBy(calls, item => `${item.op}:${item.label}:${item.line}`),
    branches: uniqueBy(branches, item => `${item.op}:${item.label}:${item.line}`),
    dataRefs: uniqueBy(dataRefs, item => `${item.label}:${item.line}`),
    ramRefs: uniqueBy(ramRefs, item => `${item.label}:${item.line}`),
    ixRefs: uniqueBy(ixRefs, item => `${item.offset}:${item.line}`),
    iyRefs: uniqueBy(iyRefs, item => `${item.offset}:${item.line}`),
  };
}

function compactEvidence(region, key) {
  const audit = region?.analysis?.[key];
  if (!audit) return null;
  return {
    analysisKey: key,
    catalogId: audit.catalogId || null,
    kind: audit.kind || audit.role || audit.family || null,
    confidence: audit.confidence || null,
    summary: audit.summary || '',
    tableIndex: audit.tableIndex ?? audit.dispatchIndex ?? null,
    dispatchTable: audit.dispatchTable || audit.table || null,
    indexRam: audit.indexRam || null,
    evidence: Array.isArray(audit.evidence) ? audit.evidence.slice(0, 3) : [],
  };
}

function collectEvidence(region) {
  const refs = evidencePriority.map(key => compactEvidence(region, key)).filter(Boolean);
  for (const key of Object.keys(region?.analysis || {}).sort()) {
    if (evidencePriority.includes(key)) continue;
    if (!/audit/i.test(key)) continue;
    const ref = compactEvidence(region, key);
    if (ref) refs.push(ref);
  }
  return refs.slice(0, 8);
}

function targetRoleFromEvidence(evidenceRefs) {
  const ref = evidenceRefs.find(item => ![
    'asmDataLabelCensusAudit',
    'asmPointerCandidateResolutionAudit',
  ].includes(item.analysisKey) && (item.kind || item.summary)) || evidenceRefs.find(item => item.kind || item.summary);
  return {
    kind: ref?.kind || 'unclassified_behavior_target',
    summary: ref?.summary || '',
    confidence: ref?.confidence || null,
    sourceAnalysisKey: ref?.analysisKey || null,
  };
}

function entryTargetRef(mapData, entry) {
  if (!entry.targetLabel) return null;
  const offset = labelOffset(entry.targetLabel);
  const region = offset == null ? null : findContainingRegion(mapData, offset);
  return {
    index: entry.index,
    line: entry.line,
    targetLabel: entry.targetLabel,
    targetOffset: offset == null ? null : hex(offset),
    targetRegion: regionRef(region),
  };
}

function buildTargetGroup(mapData, asmIndex, table, targetLabel, entries) {
  const offset = labelOffset(targetLabel);
  const region = offset == null ? null : findContainingRegion(mapData, offset);
  const evidenceRefs = collectEvidence(region);
  const role = targetRoleFromEvidence(evidenceRefs);
  const scan = scanLabelBlock(asmIndex, targetLabel);
  return {
    targetLabel,
    targetOffset: offset == null ? null : hex(offset),
    targetRegion: regionRef(region),
    entryIndexes: entries.map(entry => entry.index),
    entryCount: entries.length,
    duplicateTarget: entries.length > 1,
    role,
    asm: {
      missingAsm: scan.missingAsm,
      asmLine: scan.asmLine,
      lineRange: scan.lineRange,
      calls: scan.calls.slice(0, 24),
      branches: scan.branches.slice(0, 24),
      dataRefs: scan.dataRefs.slice(0, 24),
      ramRefs: scan.ramRefs.slice(0, 24),
      ixOffsets: uniqueBy(scan.ixRefs.map(ref => ref.offset), value => value).sort((a, b) => a - b),
      iyOffsets: uniqueBy(scan.iyRefs.map(ref => ref.offset), value => value).sort((a, b) => a - b),
    },
    evidenceRefs,
    evidence: [
      `${targetLabel} is reached by ${table.label} entr${entries.length === 1 ? 'y' : 'ies'} ${entries.map(entry => entry.index).join(', ')}.`,
      scan.asmLine ? `ASM line ${scan.asmLine}: ${targetLabel} routine entry.` : `${targetLabel} was referenced by ${table.label}, but no ASM label block was found.`,
      role.summary || 'No stronger target-specific role summary was found; call/RAM refs are still cataloged for follow-up.',
    ],
  };
}

function buildTable(mapData, asmIndex, candidate) {
  const entries = candidate.parsedFromAsm.entries
    .filter(entry => entry.targetLabel)
    .map(entry => entryTargetRef(mapData, entry))
    .filter(Boolean);
  const byTarget = new Map();
  for (const entry of entries) {
    if (!byTarget.has(entry.targetLabel)) byTarget.set(entry.targetLabel, []);
    byTarget.get(entry.targetLabel).push(entry);
  }
  const groups = [...byTarget.entries()]
    .map(([targetLabel, groupedEntries]) => buildTargetGroup(mapData, asmIndex, candidate, targetLabel, groupedEntries))
    .sort((a, b) => a.entryIndexes[0] - b.entryIndexes[0]);
  const tableEvidence = candidate.evidenceRefs || [];
  return {
    label: candidate.label,
    offset: candidate.offset,
    region: candidate.region,
    semanticRole: candidate.classification.semanticRole,
    confidence: candidate.classification.confidence,
    status: candidate.classification.status,
    entryCount: candidate.parsedFromAsm.entryCount,
    targetEntryCount: entries.length,
    uniqueTargetCount: groups.length,
    duplicateTargetGroups: groups.filter(group => group.duplicateTarget).map(group => ({
      targetLabel: group.targetLabel,
      targetOffset: group.targetOffset,
      entryIndexes: group.entryIndexes,
    })),
    targetRoleCounts: countBy(groups, group => group.role.kind),
    callTargetCounts: countBy(groups.flatMap(group => group.asm.calls), call => call.label),
    dataRefCounts: countBy(groups.flatMap(group => group.asm.dataRefs), ref => ref.label),
    ixOffsetCounts: countBy(groups.flatMap(group => group.asm.ixOffsets), offset => `IX+${offset}`),
    iyOffsetCounts: countBy(groups.flatMap(group => group.asm.iyOffsets), offset => `IY+${offset}`),
    entries,
    targetGroups: groups,
    evidenceRefs: tableEvidence,
    evidence: [
      `${candidate.label} was confirmed as ${candidate.classification.semanticRole} by ${sourceCatalogId}.`,
      `${candidate.label} has ${candidate.parsedFromAsm.entryCount} ASM .dw entries and ${groups.length} unique target labels.`,
      'Targets are recorded as labels, offsets, region refs, call refs, RAM refs, and IX/IY offsets only; no ROM bytes are embedded.',
    ],
  };
}

function buildCatalog(mapData, asmText) {
  const sourceCatalog = findCatalog(mapData, sourceCatalogId);
  const validationIssues = [];
  if (!sourceCatalog) validationIssues.push(`Missing source catalog ${sourceCatalogId}.`);
  const asmIndex = buildAsmIndex(asmText);
  const candidates = (sourceCatalog?.candidates || []).filter(candidate => candidate.region?.type === 'entity_behavior_table');
  const tables = candidates.map(candidate => buildTable(mapData, asmIndex, candidate));
  const allGroups = tables.flatMap(table => table.targetGroups.map(group => ({ ...group, tableLabel: table.label })));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalog: sourceCatalogId,
    summary: {
      tableCount: tables.length,
      tableEntries: tables.reduce((sum, table) => sum + table.entryCount, 0),
      targetEntries: tables.reduce((sum, table) => sum + table.targetEntryCount, 0),
      uniqueTargetLabels: uniqueBy(allGroups.map(group => group.targetLabel), label => label).length,
      duplicateTargetGroups: tables.reduce((sum, table) => sum + table.duplicateTargetGroups.length, 0),
      targetsMissingAsm: allGroups.filter(group => group.asm.missingAsm).length,
      targetGroupsByRole: countBy(allGroups, group => group.role.kind),
      tablesBySemanticRole: countBy(tables, table => table.semanticRole),
      assetPolicy: 'Metadata only: table labels, entry indexes, target labels/offsets, region refs, routine calls, RAM labels, IX/IY offsets, and existing audit evidence. No ROM bytes, decoded graphics, music, text, or asset payloads are embedded.',
    },
    tables,
    validationIssues: [
      ...validationIssues,
      ...allGroups.filter(group => !group.targetRegion).map(group => `No mapped target region for ${group.targetLabel} from ${group.tableLabel}.`),
      ...allGroups.filter(group => group.asm.missingAsm).map(group => `No ASM block found for ${group.targetLabel} from ${group.tableLabel}.`),
    ],
    evidence: [
      'The source table list comes from world-asm-pointer-candidate-resolution-catalog-2026-06-25.',
      'Only candidates already confirmed as entity_behavior_table are grouped here.',
      'Target routine metadata is derived from ASM label blocks and existing region analysis evidence.',
    ],
  };
}

function compactTableAnnotation(table) {
  return {
    label: table.label,
    semanticRole: table.semanticRole,
    entryCount: table.entryCount,
    uniqueTargetCount: table.uniqueTargetCount,
    duplicateTargetGroups: table.duplicateTargetGroups,
    targetRoleCounts: table.targetRoleCounts,
  };
}

function compactTargetRef(table, group) {
  return {
    tableLabel: table.label,
    entryIndexes: group.entryIndexes,
    role: group.role,
    asmLine: group.asm.asmLine,
    calls: group.asm.calls,
    branches: group.asm.branches,
    dataRefs: group.asm.dataRefs,
    ramRefs: group.asm.ramRefs,
    ixOffsets: group.asm.ixOffsets,
    iyOffsets: group.asm.iyOffsets,
  };
}

function annotateMap(mapData, catalog) {
  const annotatedTableRegions = [];
  const annotatedTargetRegions = [];
  for (const table of catalog.tables) {
    const region = (mapData.regions || []).find(item => item.id === table.region?.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.entityBehaviorTableTargetAudit = {
      catalogId,
      kind: 'entity_behavior_table_target_grouping',
      confidence: 'high',
      summary: 'Confirmed entity behavior dispatch table with entry-to-target grouping and target role/call metadata.',
      table: compactTableAnnotation(table),
      evidenceRefs: table.evidenceRefs,
      evidence: table.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedTableRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      label: table.label,
      entryCount: table.entryCount,
      uniqueTargetCount: table.uniqueTargetCount,
      duplicateTargetGroups: table.duplicateTargetGroups.length,
    });
  }

  const refsByRegion = new Map();
  for (const table of catalog.tables) {
    for (const group of table.targetGroups) {
      if (!group.targetRegion) continue;
      if (!refsByRegion.has(group.targetRegion.id)) refsByRegion.set(group.targetRegion.id, []);
      refsByRegion.get(group.targetRegion.id).push(compactTargetRef(table, group));
    }
  }
  for (const [regionId, refs] of refsByRegion.entries()) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.entityBehaviorTableTargetAudit = {
      catalogId,
      kind: 'entity_behavior_table_target',
      confidence: refs.some(ref => ref.role.confidence === 'medium') ? 'medium' : 'high',
      summary: 'Routine is targeted by one or more confirmed entity behavior dispatch tables.',
      refs,
      evidence: refs.map(ref => `${ref.tableLabel} entries ${ref.entryIndexes.join(', ')} target this routine.`),
      generatedAt: now,
      tool: toolName,
    };
    annotatedTargetRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      refCount: refs.length,
      tableLabels: uniqueBy(refs.map(ref => ref.tableLabel), label => label),
    });
  }
  return { annotatedTableRegions, annotatedTargetRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotations = apply
    ? annotateMap(mapData, catalog)
    : { annotatedTableRegions: [], annotatedTargetRegions: [] };

  if (apply) {
    mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(item => item.id !== catalogId);
    mapData.entityBehaviorCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'entity_behavior_table_target_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      sourceCatalog: sourceCatalogId,
      summary: {
        ...catalog.summary,
        annotatedTableRegions: annotations.annotatedTableRegions.length,
        annotatedTargetRegions: annotations.annotatedTargetRegions.length,
      },
      validationIssues: catalog.validationIssues,
      annotatedTableRegions: annotations.annotatedTableRegions,
      annotatedTargetRegions: annotations.annotatedTargetRegions,
      nextLeads: [
        'Use duplicateTargetGroups in _DATA_668E_ to name initializer aliases that share tails and differ only by entry head constants.',
        'Trace bank-2 controller target call/data refs to split transition-scene, effect-script, and screen/VDP-update responsibilities.',
        'Use IX/IY offset counts from target groups to extend the entity runtime struct catalog beyond the current player-focused struct map.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedTableRegions: annotations.annotatedTableRegions.length,
      annotatedTargetRegions: annotations.annotatedTargetRegions.length,
    },
    validationIssues: catalog.validationIssues,
    preview: catalog.tables.slice(0, 4).map(table => ({
      label: table.label,
      entryCount: table.entryCount,
      uniqueTargetCount: table.uniqueTargetCount,
      duplicateTargetGroups: table.duplicateTargetGroups.slice(0, 8),
      targetRoleCounts: table.targetRoleCounts,
    })),
  }, null, 2));
}

main();
