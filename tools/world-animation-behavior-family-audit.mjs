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
const catalogId = 'world-animation-behavior-family-catalog-2026-06-25';
const reportId = 'animation-behavior-family-audit-2026-06-25';
const toolName = 'tools/world-animation-behavior-family-audit.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function normOffset(value) {
  if (value == null) return null;
  if (typeof value === 'number') return hex(value);
  return '0x' + String(value).replace(/^0x/i, '').toUpperCase().padStart(5, '0');
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
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

function regionRefAt(mapData, offset) {
  const normalized = normOffset(offset);
  return normalized == null ? null : regionRef(findContainingRegion(mapData, parseInt(normalized, 16)));
}

function requireCatalog(mapData, key, id) {
  const catalog = (mapData[key] || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required catalog ${key}.${id}`);
  return catalog;
}

function buildAsmIndex(asmText) {
  const lines = asmText.split(/\r?\n/);
  const labelLines = new Map();
  const labelsByOffset = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_(?:LABEL|DATA)_[0-9A-F]+_):/.exec(lines[i]);
    if (!match) continue;
    const offset = labelOffset(match[1]);
    if (offset == null) continue;
    labelLines.set(match[1], i + 1);
    labelsByOffset.set(offset, match[1]);
  }
  return { lines, labelLines, labelsByOffset };
}

function labelBlock(asmIndex, label) {
  const startLine = asmIndex.labelLines.get(label);
  if (!startLine) return null;
  const blockLines = [];
  for (let i = startLine - 1; i < asmIndex.lines.length; i++) {
    if (i > startLine - 1 && /^_(?:LABEL|DATA)_[0-9A-F]+_:/.test(asmIndex.lines[i])) break;
    blockLines.push({
      number: i + 1,
      raw: asmIndex.lines[i],
      code: cleanCode(asmIndex.lines[i]),
    });
  }
  return {
    label,
    offset: labelOffset(label),
    startLine,
    lines: blockLines,
  };
}

function parseData668eEntries(asmIndex) {
  const startLine = asmIndex.labelLines.get('_DATA_668E_');
  if (!startLine) throw new Error('Missing _DATA_668E_ in ASM');
  const entries = [];
  for (let i = startLine; i < asmIndex.lines.length; i++) {
    const line = asmIndex.lines[i];
    if (/^_LABEL_6718_:/.test(line)) break;
    const labels = line.match(/_LABEL_[0-9A-F]+_/gi) || [];
    for (const label of labels) {
      entries.push({
        tableIndex: entries.length,
        entityType: entries.length + 1,
        label,
        tableLine: i + 1,
        selectorPair: {
          root: hex(2, 2),
          child: hex(entries.length + 1, 2),
        },
      });
    }
  }
  return entries;
}

function calls1318(block) {
  if (!block) return [];
  return block.lines
    .map((line, index) => ({ line, index }))
    .filter(item => /\bcall\s+_LABEL_1318_/i.test(item.line.code));
}

function inferVariantSelector(block, callIndex) {
  if (!block) return null;
  let source = null;
  const transforms = [];
  for (let i = callIndex - 1; i >= 0 && i >= callIndex - 8; i--) {
    const code = block.lines[i].code;
    if (!code) continue;
    const xorA = /^xor\s+a$/i.exec(code);
    const literal = /^ld\s+a\s*,\s*\$([0-9A-F]{1,2})$/i.exec(code);
    const ix = /^ld\s+a\s*,\s*\((ix\+[0-9]+)\)$/i.exec(code);
    const ram = /^ld\s+a\s*,\s*\((_RAM_[0-9A-F]+_)\)$/i.exec(code);
    if (xorA || literal || ix || ram) {
      source = {
        line: block.lines[i].number,
        code,
        kind: xorA ? 'literal' : literal ? 'literal' : ix ? 'ix_field' : 'ram',
        value: xorA ? 0 : literal ? parseInt(literal[1], 16) : null,
        expression: xorA ? '0x00' : literal ? hex(parseInt(literal[1], 16), 2) : ix ? ix[1].toUpperCase() : ram[1],
      };
      for (let j = i + 1; j < callIndex; j++) {
        const transformCode = block.lines[j].code;
        const add = /^add\s+a\s*,\s*\$([0-9A-F]{1,2})$/i.exec(transformCode);
        const inc = /^inc\s+a$/i.exec(transformCode);
        const dec = /^dec\s+a$/i.exec(transformCode);
        if (add) {
          const value = parseInt(add[1], 16);
          transforms.push({ line: block.lines[j].number, code: transformCode, op: 'add', value: hex(value, 2) });
          if (source.value != null) source.value = (source.value + value) & 0xFF;
        } else if (inc) {
          transforms.push({ line: block.lines[j].number, code: transformCode, op: 'inc', value: hex(1, 2) });
          if (source.value != null) source.value = (source.value + 1) & 0xFF;
        } else if (dec) {
          transforms.push({ line: block.lines[j].number, code: transformCode, op: 'dec', value: hex(1, 2) });
          if (source.value != null) source.value = (source.value - 1) & 0xFF;
        }
      }
      const expression = source.value != null
        ? hex(source.value, 2)
        : `${source.expression}${transforms.map(item => item.op === 'add' ? ` + ${item.value}` : item.op === 'inc' ? ' + 0x01' : ' - 0x01').join('')}`;
      return {
        expression,
        resolvedLiteral: source.value == null ? null : hex(source.value, 2),
        source,
        transforms,
        evidence: [
          `ASM line ${source.line}: ${source.code}`,
          ...transforms.map(item => `ASM line ${item.line}: ${item.code}`),
        ],
      };
    }
  }
  return {
    expression: 'caller A',
    resolvedLiteral: null,
    source: null,
    transforms,
    evidence: [],
  };
}

function indexMetaspriteCatalog(metaspriteCatalog) {
  const variantByOffset = new Map();
  const streamByOffset = new Map();
  for (const table of metaspriteCatalog.variantTables || []) variantByOffset.set(normOffset(table.tableOffset), table);
  for (const stream of metaspriteCatalog.parsedStreams || []) streamByOffset.set(normOffset(stream.offset), stream);
  return { variantByOffset, streamByOffset };
}

function groupFrameTargets(frameTargets) {
  const byRegion = new Map();
  for (const target of frameTargets) {
    const regionId = target.region?.id || `unmapped:${normOffset(target.romOffset) || 'unknown'}`;
    if (!byRegion.has(regionId)) {
      byRegion.set(regionId, {
        region: target.region || null,
        referenceCount: 0,
        targetOffsets: new Set(),
        sourceScriptOffsets: new Set(),
      });
    }
    const item = byRegion.get(regionId);
    item.referenceCount++;
    if (target.romOffset != null) item.targetOffsets.add(normOffset(target.romOffset));
    if (target.sourceScriptOffset) item.sourceScriptOffsets.add(normOffset(target.sourceScriptOffset));
  }
  return [...byRegion.values()].sort((a, b) => (a.region?.offset || '').localeCompare(b.region?.offset || '')).map(item => ({
    region: item.region,
    referenceCount: item.referenceCount,
    uniqueTargetOffsets: item.targetOffsets.size,
    targetOffsets: [...item.targetOffsets].sort().slice(0, 24),
    sourceScriptOffsets: [...item.sourceScriptOffsets].sort().slice(0, 16),
  }));
}

function resolveTarget(mapData, indexes, rootCatalog, entityType) {
  const root2Table = (rootCatalog.childTables || []).find(table => table.rootEntry === 2);
  const childEntry = root2Table?.entries?.find(entry => entry.index === entityType) || null;
  const variantTable = childEntry?.romOffset ? indexes.variantByOffset.get(normOffset(childEntry.romOffset)) : null;
  const scriptOffsets = variantTable
    ? [...new Set((variantTable.entries || []).map(entry => normOffset(entry.romOffset)).filter(Boolean))].sort()
    : childEntry?.romOffset ? [normOffset(childEntry.romOffset)] : [];
  const streams = scriptOffsets.map(offset => indexes.streamByOffset.get(offset)).filter(Boolean);
  const frameTargets = streams.flatMap(stream => stream.frameTargets || []);
  return {
    childTable: root2Table ? {
      label: root2Table.label,
      romOffset: root2Table.romOffset,
      rootEntry: root2Table.rootEntry,
    } : null,
    childEntry: childEntry ? {
      index: childEntry.index,
      entryOffset: normOffset(childEntry.entryOffset),
      z80Pointer: childEntry.z80Pointer,
      romOffset: normOffset(childEntry.romOffset),
      region: childEntry.region || regionRefAt(mapData, childEntry.romOffset),
      targetInterpretation: childEntry.targetInterpretation,
    } : null,
    variantTable: variantTable ? {
      tableOffset: normOffset(variantTable.tableOffset),
      entryCount: variantTable.entryCount,
      byteLength: variantTable.byteLength,
      region: variantTable.region || regionRefAt(mapData, variantTable.tableOffset),
      scriptOffsets,
    } : null,
    directScript: !variantTable && childEntry?.romOffset ? {
      offset: normOffset(childEntry.romOffset),
      region: childEntry.region || regionRefAt(mapData, childEntry.romOffset),
    } : null,
    streams: streams.map(stream => ({
      offset: normOffset(stream.offset),
      region: stream.region || regionRefAt(mapData, stream.offset),
      commandCount: stream.commandCount || 0,
      jumpCount: stream.jumpCount || 0,
      frameTargetCount: stream.frameTargetCount || (stream.frameTargets || []).length,
      warningCount: (stream.warnings || []).length,
    })),
    frameTargetRegions: groupFrameTargets(frameTargets),
    summary: {
      scriptOffsets: scriptOffsets.length,
      parsedStreams: streams.length,
      parsedCommands: streams.reduce((sum, stream) => sum + (stream.commandCount || 0), 0),
      framePointerReferences: frameTargets.length,
      frameTargetRegions: groupFrameTargets(frameTargets).length,
      warningStreams: streams.filter(stream => (stream.warnings || []).length).length,
    },
  };
}

function buildCatalog(mapData, asmText) {
  const rootCatalog = requireCatalog(mapData, 'animationRootSemanticsCatalogs', 'world-animation-root-semantics-catalog-2026-06-25');
  const metaspriteCatalog = requireCatalog(mapData, 'metaspriteCatalogs', 'world-metasprite-catalog-2026-06-24');
  const asmIndex = buildAsmIndex(asmText);
  const dispatchEntries = parseData668eEntries(asmIndex);
  const indexes = indexMetaspriteCatalog(metaspriteCatalog);
  const families = [];
  const entriesWithoutAnimationStart = [];

  for (const entry of dispatchEntries) {
    const block = labelBlock(asmIndex, entry.label);
    const calls = calls1318(block);
    if (!calls.length) {
      entriesWithoutAnimationStart.push(entry);
      continue;
    }
    for (let callIndex = 0; callIndex < calls.length; callIndex++) {
      const call = calls[callIndex];
      const variantSelector = inferVariantSelector(block, call.index);
      const target = resolveTarget(mapData, indexes, rootCatalog, entry.entityType);
      families.push({
        id: `behavior_anim_family_type_${entry.entityType}_${callIndex}`,
        kind: 'behavior_table_animation_family',
        confidence: target.childEntry ? 'high' : 'medium',
        frameTargetConfidence: target.summary.warningStreams ? 'medium' : 'high',
        entityType: entry.entityType,
        dispatchTableIndex: entry.tableIndex,
        dispatchTable: '_DATA_668E_',
        dispatchTableLine: entry.tableLine,
        dispatchLabel: entry.label,
        dispatchRegion: regionRefAt(mapData, labelOffset(entry.label)),
        callLine: call.line.number,
        selectorProvenance: {
          rootEntry: 2,
          childEntry: entry.entityType,
          selectorPair: entry.selectorPair,
          seededBy: '_LABEL_65B9_',
          evidence: [
            '_LABEL_65B9_ copies IY+0 into IX+15 and sets IX+14 to 0x02 for room entity slots.',
            '_LABEL_667C_ dispatches _DATA_668E_ by ((IX+15 & 0x7F) - 1), so dispatch table entry N corresponds to IX+15 value N+1.',
          ],
        },
        variantSelector,
        selectedTarget: target,
        summary: {
          ...target.summary,
          callsiteReferences: 1,
        },
        evidence: [
          `ASM line ${entry.tableLine}: _DATA_668E_ dispatch entry ${entry.tableIndex} targets ${entry.label}.`,
          `ASM line ${call.line.number}: ${entry.label} calls _LABEL_1318_.`,
          '_LABEL_65B9_ and _LABEL_667C_ provide the selector provenance for root 0x02 and the entity-type child selector.',
        ],
      });
    }
  }

  const uniqueLabels = new Set(families.map(family => family.dispatchLabel));
  const uniqueVariantTables = new Set(families.map(family => family.selectedTarget.variantTable?.tableOffset).filter(Boolean));
  const uniqueScripts = new Set(families.flatMap(family => family.selectedTarget.streams.map(stream => stream.offset)));
  const uniqueFrameRegions = new Set(families.flatMap(family => family.selectedTarget.frameTargetRegions.map(item => item.region?.id).filter(Boolean)));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      rootCatalog.id,
      metaspriteCatalog.id,
    ],
    assetPolicy: 'Metadata only: dispatch entries, selector provenance, labels, offsets, region ids, stream/frame counts, and ASM evidence. No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    slotSelectorProvenance: {
      initializer: '_LABEL_65B9_',
      rootSelector: 'IX+14 = 0x02',
      childSelector: 'IX+15 = IY+0 room entity type byte',
      dispatch: '_LABEL_667C_ -> _DATA_668E_[(IX+15 & 0x7F) - 1]',
      variantSelector: 'caller A at each _LABEL_1318_ callsite',
      evidence: [
        'ASM lines 14774-14777 copy IY+0 into IX+15 and set IX+14 to 0x02.',
        'ASM lines 14819-14823 dispatch _DATA_668E_ from ((IX+15 & 0x7F) - 1).',
      ],
    },
    dispatchTable: {
      label: '_DATA_668E_',
      entryCount: dispatchEntries.length,
      entries: dispatchEntries,
    },
    families,
    entriesWithoutAnimationStart,
    summary: {
      dispatchEntries: dispatchEntries.length,
      animationStartFamilies: families.length,
      uniqueDispatchLabelsWithAnimationStart: uniqueLabels.size,
      entriesWithoutAnimationStart: entriesWithoutAnimationStart.length,
      uniqueVariantTables: uniqueVariantTables.size,
      uniqueScriptOffsets: uniqueScripts.size,
      parsedStreams: families.reduce((sum, family) => sum + family.summary.parsedStreams, 0),
      parsedCommands: families.reduce((sum, family) => sum + family.summary.parsedCommands, 0),
      framePointerReferences: families.reduce((sum, family) => sum + family.summary.framePointerReferences, 0),
      uniqueFrameTargetRegions: uniqueFrameRegions.size,
      assetPolicy: 'Metadata only: dispatch entries, selector provenance, labels, offsets, region ids, stream/frame counts, and ASM evidence. No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    },
  };
}

function compactFamilyRef(family, role, extra = {}) {
  return {
    catalogId,
    familyId: family.id,
    role,
    selectorPair: family.selectorProvenance.selectorPair,
    entityType: family.entityType,
    dispatchLabel: family.dispatchLabel,
    confidence: role === 'metasprite_frame_target_candidate' ? family.frameTargetConfidence : family.confidence,
    ...extra,
  };
}

function addRegionAnnotation(region, refs) {
  region.analysis = region.analysis || {};
  const existing = region.analysis.animationBehaviorFamilyAudit || {};
  const preserved = (existing.families || []).filter(ref => ref.catalogId !== catalogId);
  const families = [...preserved, ...refs].slice(0, 96);
  region.analysis.animationBehaviorFamilyAudit = {
    kind: 'behavior_animation_family_linked_region',
    catalogId,
    confidence: families.some(ref => ref.confidence === 'medium') ? 'medium' : 'high',
    summary: 'Region is linked to behavior-table-derived room entity animation families.',
    families,
    evidence: [
      'Links are derived from _LABEL_65B9_ room-entity selector seeding, _LABEL_667C_ dispatch, _DATA_668E_ entries, and _LABEL_1318_ callsites.',
      'No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    type: region.type || 'unknown',
    name: region.name || '',
    familyRefs: refs.length,
  };
}

function annotateMap(mapData, catalog) {
  const refsByRegionId = new Map();
  const missingRegions = [];

  function addRef(regionLike, fallbackOffset, ref) {
    let region = regionLike?.id ? findRegionById(mapData, regionLike.id) : null;
    if (!region && fallbackOffset != null) region = findContainingRegion(mapData, parseInt(normOffset(fallbackOffset), 16));
    if (!region) {
      missingRegions.push({ familyId: ref.familyId, role: ref.role, offset: fallbackOffset == null ? null : normOffset(fallbackOffset) });
      return;
    }
    if (!refsByRegionId.has(region.id)) refsByRegionId.set(region.id, { region, refs: [] });
    refsByRegionId.get(region.id).refs.push(ref);
  }

  for (const family of catalog.families) {
    addRef(family.dispatchRegion, family.dispatchRegion?.offset, compactFamilyRef(family, 'behavior_init_callsite', {
      callLine: family.callLine,
      variantSelector: family.variantSelector.expression,
    }));
    const variantTable = family.selectedTarget.variantTable;
    if (variantTable) {
      addRef(variantTable.region, variantTable.tableOffset, compactFamilyRef(family, 'selected_variant_table', {
        tableOffset: variantTable.tableOffset,
        variantEntries: variantTable.entryCount,
      }));
    }
    for (const stream of family.selectedTarget.streams) {
      addRef(stream.region, stream.offset, compactFamilyRef(family, 'animation_command_stream', {
        streamOffset: stream.offset,
        commandCount: stream.commandCount,
        frameTargetCount: stream.frameTargetCount,
        warningCount: stream.warningCount,
      }));
    }
    for (const targetRegion of family.selectedTarget.frameTargetRegions) {
      addRef(targetRegion.region, targetRegion.targetOffsets[0] || null, compactFamilyRef(family, 'metasprite_frame_target_candidate', {
        referenceCount: targetRegion.referenceCount,
        uniqueTargetOffsets: targetRegion.uniqueTargetOffsets,
        targetOffsets: targetRegion.targetOffsets.slice(0, 12),
      }));
    }
  }

  const annotatedRegions = [];
  for (const { region, refs } of refsByRegionId.values()) annotatedRegions.push(addRegionAnnotation(region, refs));
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
    mapData.animationBehaviorFamilyCatalogs = (mapData.animationBehaviorFamilyCatalogs || []).filter(item => item.id !== catalogId);
    mapData.animationBehaviorFamilyCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'animation_behavior_family_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: finalCatalog.sourceCatalogs,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotation.annotatedRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      slotSelectorProvenance: finalCatalog.slotSelectorProvenance,
      familySummary: finalCatalog.families.map(family => ({
        id: family.id,
        entityType: family.entityType,
        dispatchLabel: family.dispatchLabel,
        selectorPair: family.selectorProvenance.selectorPair,
        variantSelector: family.variantSelector,
        selectedTarget: {
          childEntry: family.selectedTarget.childEntry,
          variantTable: family.selectedTarget.variantTable,
          directScript: family.selectedTarget.directScript,
        },
        summary: family.summary,
      })),
      entriesWithoutAnimationStart: finalCatalog.entriesWithoutAnimationStart,
      annotatedRegions: annotation.annotatedRegions,
      missingRegions: annotation.missingRegions,
      nextLeads: [
        'Name room entity type bytes by linking _DATA_668E_ entityType values back to room entity records and visible enemy/object classes.',
        'Fold behavior-derived root-2 families into the general animation family graph once dynamic variant selector expressions are modeled.',
        'Decode metasprite frame records for the high-use root-2 families to replace medium-confidence frame-target parser warnings with precise terminators.',
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
