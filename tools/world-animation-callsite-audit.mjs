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
const catalogId = 'world-animation-callsite-catalog-2026-06-25';
const reportId = 'animation-callsite-audit-2026-06-25';
const toolName = 'tools/world-animation-callsite-audit.mjs';

const TARGET_CALLS = {
  _LABEL_1318_: 'entity_animation_start',
  _LABEL_1330_: 'entity_animation_tick',
  _LABEL_137C_: 'player_form_animation_start',
  _LABEL_1392_: 'player_form_animation_tick',
};

const SELECTOR_TARGETS = [
  { pattern: /\(ix\+14\)/i, name: 'IX+14', role: 'entity_animation_root_selector' },
  { pattern: /\(ix\+15\)/i, name: 'IX+15', role: 'entity_animation_child_selector' },
  { pattern: /_RAM_C24F_/i, name: '_RAM_C24F_', role: 'player_form_selector' },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function cleanCode(line) {
  return line.split(';')[0].trim();
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

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function buildAsmBlocks(asmText) {
  const lines = asmText.split(/\r?\n/);
  const blocks = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const labelMatch = /^(_(?:LABEL|DATA)_[0-9A-F]+_):/.exec(lines[i]);
    if (labelMatch) {
      if (current) blocks.push(current);
      current = {
        label: labelMatch[1],
        offset: labelOffset(labelMatch[1]),
        startLine: i + 1,
        lines: [],
      };
    }
    if (current) {
      current.lines.push({
        number: i + 1,
        raw: lines[i],
        code: cleanCode(lines[i]),
      });
    }
  }
  if (current) blocks.push(current);
  return blocks.filter(block => block.offset != null);
}

function classifySelectorAccess(code, target) {
  const lower = code.toLowerCase();
  if (target.name === 'IX+14') {
    if (/^ld\s+\(ix\+14\)\s*,/i.test(code)) return 'write';
    if (/\(ix\+14\)/i.test(code)) return 'read';
  }
  if (target.name === 'IX+15') {
    if (/^ld\s+\(ix\+15\)\s*,/i.test(code)) return 'write';
    if (/\(ix\+15\)/i.test(code)) return 'read';
  }
  if (target.name === '_RAM_C24F_') {
    if (lower.startsWith('ld (_ram_c24f_),')) return 'write';
    if (/_RAM_C24F_/i.test(code)) return 'read';
  }
  return 'access';
}

function directWriteSource(code, targetName) {
  if (targetName === 'IX+14') {
    const match = /^ld\s+\(ix\+14\)\s*,\s*(.+)$/i.exec(code);
    return match ? match[1].trim() : null;
  }
  if (targetName === 'IX+15') {
    const match = /^ld\s+\(ix\+15\)\s*,\s*(.+)$/i.exec(code);
    return match ? match[1].trim() : null;
  }
  if (targetName === '_RAM_C24F_') {
    const match = /^ld\s+\(_RAM_C24F_\)\s*,\s*(.+)$/i.exec(code);
    return match ? match[1].trim() : null;
  }
  return null;
}

function precedingSource(lines, index) {
  for (let i = index - 1; i >= 0 && i >= index - 4; i--) {
    const code = lines[i].code;
    if (!code) continue;
    const immediate = /^ld\s+a\s*,\s*(\$[0-9A-F]{1,2})$/i.exec(code);
    if (immediate) return `A loaded from ${immediate[1].toUpperCase()} at ASM line ${lines[i].number}`;
    const ram = /^ld\s+a\s*,\s*\((_RAM_[0-9A-F]+_)\)$/i.exec(code);
    if (ram) return `A loaded from ${ram[1]} at ASM line ${lines[i].number}`;
    const ix = /^ld\s+a\s*,\s*\((ix\+[0-9]+)\)$/i.exec(code);
    if (ix) return `A loaded from ${ix[1].toUpperCase()} at ASM line ${lines[i].number}`;
    const register = /^ld\s+([a-z])\s*,/i.exec(code);
    if (register && register[1].toLowerCase() === 'a') return `A source inferred from ASM line ${lines[i].number}: ${code}`;
  }
  return null;
}

function selectorAccesses(block) {
  const accesses = [];
  for (let i = 0; i < block.lines.length; i++) {
    const line = block.lines[i];
    if (!line.code) continue;
    for (const target of SELECTOR_TARGETS) {
      if (!target.pattern.test(line.code)) continue;
      const access = classifySelectorAccess(line.code, target);
      const directSource = access === 'write' ? directWriteSource(line.code, target.name) : null;
      accesses.push({
        line: line.number,
        code: line.code,
        selector: target.name,
        role: target.role,
        access,
        source: directSource === 'a' ? precedingSource(block.lines, i) || 'A' : directSource,
      });
    }
  }
  return accesses;
}

function targetCalls(block) {
  const calls = [];
  for (const line of block.lines) {
    if (!line.code) continue;
    const match = /\bcall\s+(_LABEL_[0-9A-F]+_)/i.exec(line.code);
    if (!match) continue;
    const target = match[1].toUpperCase();
    const normalizedTarget = Object.keys(TARGET_CALLS).find(key => key.toUpperCase() === target);
    if (!normalizedTarget) continue;
    calls.push({
      line: line.number,
      code: line.code,
      target: normalizedTarget,
      role: TARGET_CALLS[normalizedTarget],
    });
  }
  return calls;
}

function nearestSelectorWrites(accesses, callLine, selectorNames) {
  const matches = accesses
    .filter(access => access.access === 'write' && selectorNames.includes(access.selector) && access.line < callLine)
    .map(access => ({ ...access, distance: callLine - access.line }))
    .filter(access => access.distance <= 32)
    .sort((a, b) => a.distance - b.distance);
  const bySelector = new Map();
  for (const access of matches) {
    if (!bySelector.has(access.selector)) bySelector.set(access.selector, access);
  }
  return [...bySelector.values()].sort((a, b) => a.line - b.line);
}

function parseImmediateByte(source) {
  const match = /^\$([0-9A-F]{1,2})$/i.exec(String(source || '').trim());
  return match ? parseInt(match[1], 16) : null;
}

function collectEntityStartSelectorPairs(routines) {
  const byPair = new Map();
  const unresolved = [];
  for (const routine of routines) {
    for (const call of routine.calls) {
      if (call.target !== '_LABEL_1318_') continue;
      const rootWrite = (call.nearestSelectorWrites || []).find(access => access.selector === 'IX+14') || null;
      const childWrite = (call.nearestSelectorWrites || []).find(access => access.selector === 'IX+15') || null;
      const rootValue = parseImmediateByte(rootWrite?.source);
      const childValue = parseImmediateByte(childWrite?.source);
      if (rootValue == null || childValue == null) {
        unresolved.push({
          routine: routine.label,
          routineOffset: routine.offset,
          callLine: call.line,
          rootSource: rootWrite?.source || null,
          childSource: childWrite?.source || null,
          reason: rootWrite && childWrite ? 'selector_write_not_immediate' : 'missing_nearby_selector_write',
        });
        continue;
      }
      const key = `${rootValue}:${childValue}`;
      if (!byPair.has(key)) {
        byPair.set(key, {
          rootEntry: rootValue,
          childEntry: childValue,
          selectorPair: {
            root: hex(rootValue, 2),
            child: hex(childValue, 2),
          },
          referenceCount: 0,
          references: [],
        });
      }
      const pair = byPair.get(key);
      pair.referenceCount++;
      pair.references.push({
        routine: routine.label,
        routineOffset: routine.offset,
        callLine: call.line,
        rootWriteLine: rootWrite.line,
        childWriteLine: childWrite.line,
        region: routine.region,
      });
    }
  }
  return {
    resolved: [...byPair.values()]
      .sort((a, b) => a.rootEntry - b.rootEntry || a.childEntry - b.childEntry)
      .map(pair => ({
        ...pair,
        references: pair.references.slice(0, 16),
      })),
    unresolved: unresolved.slice(0, 80),
    unresolvedCount: unresolved.length,
  };
}

function resolveEntityStartSelectorPairs(mapData, entityStartSelectorPairs) {
  const semantics = (mapData.animationRootSemanticsCatalogs || [])
    .find(catalog => catalog.id === 'world-animation-root-semantics-catalog-2026-06-25')
    || (mapData.animationRootSemanticsCatalogs || [])[0]
    || null;
  if (!semantics) return entityStartSelectorPairs;

  const resolved = entityStartSelectorPairs.resolved.map(pair => {
    const childTable = (semantics.childTables || []).find(table => table.rootEntry === pair.rootEntry) || null;
    const childEntry = childTable?.entries?.find(entry => entry.index === pair.childEntry) || null;
    return {
      ...pair,
      selectedTarget: {
        indexBase: 'zero_based',
        childTable: childTable ? {
          label: childTable.label,
          romOffset: childTable.romOffset,
          rootEntry: childTable.rootEntry,
          playerAccessible: Boolean(childTable.playerAccessible),
        } : null,
        childEntry: childEntry ? {
          index: childEntry.index,
          entryOffset: childEntry.entryOffset,
          z80Pointer: childEntry.z80Pointer,
          romOffset: childEntry.romOffset,
          region: childEntry.region,
          targetInterpretation: childEntry.targetInterpretation,
          variantPrefix: childEntry.variantPrefix ? {
            entryCount: childEntry.variantPrefix.entryCount,
            byteLength: childEntry.variantPrefix.byteLength,
          } : null,
        } : null,
        evidence: [
          'Selector values are interpreted as zero-based indexes because _LABEL_8_ / RST $08 performs HL += 2*A.',
          'Child table and entry metadata comes from world-animation-root-semantics-catalog-2026-06-25.',
        ],
      },
    };
  });
  return {
    ...entityStartSelectorPairs,
    resolved,
  };
}

function analyzeBlock(mapData, block) {
  const calls = targetCalls(block);
  const accesses = selectorAccesses(block);
  if (!calls.length && !accesses.some(access => access.access === 'write')) return null;

  const region = findContainingRegion(mapData, block.offset);
  const callDetails = calls.map(call => {
    const selectors = call.target === '_LABEL_1318_'
      ? nearestSelectorWrites(accesses, call.line, ['IX+14', 'IX+15'])
      : call.target === '_LABEL_137C_'
        ? nearestSelectorWrites(accesses, call.line, ['_RAM_C24F_'])
        : [];
    return {
      ...call,
      nearestSelectorWrites: selectors,
    };
  });

  return {
    label: block.label,
    offset: hex(block.offset),
    startLine: block.startLine,
    region: regionRef(region),
    calls: callDetails,
    selectorAccesses: accesses,
    summary: {
      calls: callDetails.length,
      selectorReads: accesses.filter(access => access.access === 'read').length,
      selectorWrites: accesses.filter(access => access.access === 'write').length,
      entityStartCalls: callDetails.filter(call => call.target === '_LABEL_1318_').length,
      entityTickCalls: callDetails.filter(call => call.target === '_LABEL_1330_').length,
      playerStartCalls: callDetails.filter(call => call.target === '_LABEL_137C_').length,
      playerTickCalls: callDetails.filter(call => call.target === '_LABEL_1392_').length,
    },
  };
}

function buildCatalog(mapData, asmText) {
  const blocks = buildAsmBlocks(asmText);
  const routines = blocks.map(block => analyzeBlock(mapData, block)).filter(Boolean);
  const targetCounts = {};
  const selectorWriteCounts = {};
  for (const target of Object.keys(TARGET_CALLS)) targetCounts[target] = 0;
  for (const target of SELECTOR_TARGETS) selectorWriteCounts[target.name] = 0;
  for (const routine of routines) {
    for (const call of routine.calls) targetCounts[call.target]++;
    for (const access of routine.selectorAccesses) {
      if (access.access === 'write') selectorWriteCounts[access.selector]++;
    }
  }
  const entityStartSelectorPairs = resolveEntityStartSelectorPairs(mapData, collectEntityStartSelectorPairs(routines));
  const resolvedEntityStartTargets = entityStartSelectorPairs.resolved
    .filter(pair => pair.selectedTarget?.childTable && pair.selectedTarget?.childEntry)
    .length;
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      routineCount: routines.length,
      routinesWithAnimationCalls: routines.filter(routine => routine.calls.length).length,
      routinesWithSelectorWrites: routines.filter(routine => routine.selectorAccesses.some(access => access.access === 'write')).length,
      callCounts: targetCounts,
      selectorWriteCounts,
      resolvedEntityStartSelectorPairs: entityStartSelectorPairs.resolved.length,
      resolvedEntityStartTargets,
      unresolvedEntityStartCalls: entityStartSelectorPairs.unresolvedCount,
      assetPolicy: 'Metadata only: ASM labels, line numbers, call targets, selector accesses, and containing region ids. No ROM bytes, graphics, music, or text payloads are embedded.',
    },
    selectorTargets: SELECTOR_TARGETS.map(target => ({ name: target.name, role: target.role })),
    callTargets: Object.entries(TARGET_CALLS).map(([label, role]) => ({ label, role })),
    entityStartSelectorPairs,
    routines,
    evidence: [
      'Callsites are discovered from ASM call instructions targeting _LABEL_1318_, _LABEL_1330_, _LABEL_137C_, and _LABEL_1392_.',
      'Selector accesses are discovered from ASM references to IX+14, IX+15, and _RAM_C24F_.',
      'Nearest selector writes are reported only when they appear before a start call in the same label block and within 32 ASM lines.',
    ],
  };
}

function summarizeRegionRoutines(routines) {
  const callCounts = {};
  const selectorWriteCounts = {};
  for (const target of Object.keys(TARGET_CALLS)) callCounts[target] = 0;
  for (const target of SELECTOR_TARGETS) selectorWriteCounts[target.name] = 0;
  const routineLabels = [];
  const evidence = [];
  for (const routine of routines) {
    routineLabels.push(routine.label);
    for (const call of routine.calls) {
      callCounts[call.target]++;
      evidence.push(`ASM line ${call.line}: ${routine.label} calls ${call.target} (${call.role}).`);
    }
    for (const access of routine.selectorAccesses) {
      if (access.access === 'write') selectorWriteCounts[access.selector]++;
    }
  }
  return {
    routineLabels,
    callCounts,
    selectorWriteCounts,
    evidence: evidence.slice(0, 24),
  };
}

function annotateMap(mapData, catalog) {
  const byRegion = new Map();
  const missingRegions = [];
  for (const routine of catalog.routines) {
    if (!routine.region?.id) {
      missingRegions.push({ label: routine.label, offset: routine.offset });
      continue;
    }
    if (!byRegion.has(routine.region.id)) byRegion.set(routine.region.id, []);
    byRegion.get(routine.region.id).push(routine);
  }

  const annotatedRegions = [];
  for (const [regionId, routines] of byRegion.entries()) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    if (!region) {
      missingRegions.push(...routines.map(routine => ({ label: routine.label, offset: routine.offset, regionId })));
      continue;
    }
    const summary = summarizeRegionRoutines(routines);
    region.analysis = region.analysis || {};
    region.analysis.animationCallsiteAudit = {
      kind: 'animation_callsite_code_region',
      catalogId,
      confidence: 'high',
      summary: 'Code region contains confirmed animation start/tick calls or selector writes.',
      routineLabels: summary.routineLabels,
      callCounts: summary.callCounts,
      selectorWriteCounts: summary.selectorWriteCounts,
      selectorAccessSamples: routines.flatMap(routine => routine.selectorAccesses.map(access => ({
        routine: routine.label,
        line: access.line,
        selector: access.selector,
        access: access.access,
        source: access.source,
      }))).slice(0, 32),
      evidence: summary.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      type: region.type || 'unknown',
      routineLabels: summary.routineLabels,
      callCounts: summary.callCounts,
      selectorWriteCounts: summary.selectorWriteCounts,
    });
  }
  return { annotatedRegions, missingRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  let annotation = { annotatedRegions: [], missingRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    const finalCatalog = buildCatalog(mapData, asmText);
    mapData.animationCallsiteCatalogs = (mapData.animationCallsiteCatalogs || []).filter(item => item.id !== catalogId);
    mapData.animationCallsiteCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'animation_callsite_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotation.annotatedRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      annotatedRegions: annotation.annotatedRegions,
      missingRegions: annotation.missingRegions,
      routineSamples: finalCatalog.routines.slice(0, 48),
      nextLeads: [
        'Use nearest IX+14/IX+15 writes around _LABEL_1318_ callsites to name enemy/object animation families.',
        'Trace _RAM_C24F_ writers into player form transition states and connect them to root-entry-0 animation child table entries.',
        'Feed animation callsite roles into the metasprite/frame decoder so command streams can be grouped by gameplay object rather than only by ROM offset.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: annotation.annotatedRegions.length,
    missingRegions: annotation.missingRegions.length,
  }, null, 2));
}

main();
