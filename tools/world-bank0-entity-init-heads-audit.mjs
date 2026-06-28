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
const catalogId = 'world-bank0-entity-init-heads-catalog-2026-06-25';
const reportId = 'bank0-entity-init-heads-audit-2026-06-25';
const toolName = 'tools/world-bank0-entity-init-heads-audit.mjs';

const ENTRIES = [
  {
    offset: 0x06927,
    label: '_LABEL_6927_',
    tableIndex: 1,
    tailLabel: '_LABEL_692F_',
    role: 'entity_init_variant_1_head',
    constants: ['IX+53=0x01'],
    ramRefs: ['IX+53'],
    summary: 'Entry 1 head for the _DATA_668E_ entity initializer table; selects variant id 1 in IX+53, then branches into the shared _LABEL_692F_ initializer tail.',
    evidence: ['ASM lines 15092-15102 identify _LABEL_6927_ as the 1st entry of jump table 668E, load A=0x01, and jump to the shared tail at _LABEL_692F_.'],
  },
  {
    offset: 0x0692B,
    label: '_LABEL_692B_',
    tableIndex: 2,
    tailLabel: '_LABEL_692F_',
    role: 'entity_init_variant_2_head',
    constants: ['IX+53=0x02'],
    ramRefs: ['IX+53'],
    summary: 'Entry 2 head for the _DATA_668E_ entity initializer table; selects variant id 2 in IX+53, then branches into the shared _LABEL_692F_ initializer tail.',
    evidence: ['ASM lines 15096-15102 identify _LABEL_692B_ as the 2nd entry of jump table 668E, load A=0x02, and jump to the shared tail at _LABEL_692F_.'],
  },
  {
    offset: 0x06AB5,
    label: '_LABEL_6AB5_',
    tableIndex: 12,
    tailLabel: '_LABEL_6ACF_',
    role: 'entity_init_variant_12_head',
    constants: ['IX+37=0x30', 'behaviorList=_DATA_6ABE_'],
    ramRefs: ['IX+37', 'IX+38', 'IX+39'],
    summary: 'Entry 12 initializer head; chooses speed/threshold constant 0x30 and behavior list _DATA_6ABE_, then branches into the shared _LABEL_6ACF_ tail.',
    evidence: ['ASM lines 15262-15268 identify _LABEL_6AB5_ as the 12th entry of jump table 668E, set IX+37, load HL with _DATA_6ABE_, and branch to _LABEL_6ACF_.'],
  },
  {
    offset: 0x06AC8,
    label: '_LABEL_6AC8_',
    tableIndex: 13,
    tailLabel: '_LABEL_6ACF_',
    role: 'entity_init_variant_13_head',
    constants: ['IX+37=0x30', 'behaviorList=_DATA_6AFA_'],
    ramRefs: ['IX+37', 'IX+38', 'IX+39'],
    summary: 'Entry 13 initializer head; chooses speed/threshold constant 0x30 and behavior list _DATA_6AFA_, then falls into the shared _LABEL_6ACF_ tail.',
    evidence: ['ASM lines 15273-15279 identify _LABEL_6AC8_ as the 13th entry of jump table 668E, set IX+37, load HL with _DATA_6AFA_, and fall into _LABEL_6ACF_.'],
  },
  {
    offset: 0x06B04,
    label: '_LABEL_6B04_',
    tableIndex: 16,
    tailLabel: '_LABEL_6ACF_',
    role: 'entity_init_variant_16_head',
    constants: ['IX+37=0x20', 'behaviorList=_DATA_6B0D_'],
    ramRefs: ['IX+37', 'IX+38', 'IX+39'],
    summary: 'Entry 16 initializer head; chooses speed/threshold constant 0x20 and behavior list _DATA_6B0D_, then branches into the shared _LABEL_6ACF_ tail.',
    evidence: ['ASM lines 15289-15295 identify _LABEL_6B04_ as the 16th entry of jump table 668E, set IX+37, load HL with _DATA_6B0D_, and branch to _LABEL_6ACF_.'],
  },
  {
    offset: 0x06B76,
    label: '_LABEL_6B76_',
    tableIndex: 17,
    tailLabel: '_LABEL_6B7E_',
    role: 'entity_init_variant_17_head',
    constants: ['IX+53=0x01'],
    ramRefs: ['IX+53'],
    summary: 'Entry 17 initializer head; selects variant id 1 in IX+53 and branches into the shared _LABEL_6B7E_ initializer tail.',
    evidence: ['ASM lines 15341-15350 identify _LABEL_6B76_ as the 17th entry of jump table 668E, load A=0x01, and branch to the shared tail.'],
  },
  {
    offset: 0x06B7A,
    label: '_LABEL_6B7A_',
    tableIndex: 18,
    tailLabel: '_LABEL_6B7E_',
    role: 'entity_init_variant_18_head',
    constants: ['IX+53=0x02'],
    ramRefs: ['IX+53'],
    summary: 'Entry 18 initializer head; selects variant id 2 in IX+53 and branches into the shared _LABEL_6B7E_ initializer tail.',
    evidence: ['ASM lines 15345-15350 identify _LABEL_6B7A_ as the 18th entry of jump table 668E, load A=0x02, and branch to the shared tail.'],
  },
  {
    offset: 0x06B7E,
    label: '_LABEL_6B7E_',
    tableIndex: 19,
    tailLabel: '_LABEL_6B7E_',
    role: 'entity_init_variant_19_and_shared_tail',
    constants: ['IX+53=0x03', 'behaviorList=_DATA_6BAD_', 'IX+37=0x60', 'IX+48=0x05'],
    ramRefs: ['IX+0', 'IX+17', 'IX+31', 'IX+32', 'IX+37', 'IX+38', 'IX+39', 'IX+48', 'IX+53'],
    summary: 'Entry 19 and shared tail for entries 17-19; stores the selected variant id, starts animation, installs _DATA_6BAD_, marks IX+0 with 0x43, and starts state 5.',
    evidence: ['ASM lines 15349-15366 identify _LABEL_6B7E_ as the 19th entry of jump table 668E and show the shared IX field setup used by entries 17-19.'],
  },
  {
    offset: 0x06C45,
    label: '_LABEL_6C45_',
    tableIndex: 26,
    tailLabel: '_LABEL_6C59_',
    role: 'entity_init_variant_26_head',
    constants: ['IX+37=0x40', 'IX+53=0x00'],
    ramRefs: ['IX+37', 'IX+53'],
    summary: 'Entry 26 initializer head; seeds variant constants IX+37=0x40 and IX+53=0 before sharing the _LABEL_6C59_ tail.',
    evidence: ['ASM lines 15429-15438 identify _LABEL_6C45_ as the 26th entry of jump table 668E and branch to the shared tail after setting IX+37 and IX+53.'],
  },
  {
    offset: 0x06C4F,
    label: '_LABEL_6C4F_',
    tableIndex: 27,
    tailLabel: '_LABEL_6C59_',
    role: 'entity_init_variant_27_head',
    constants: ['IX+37=0x60', 'IX+53=0x01'],
    ramRefs: ['IX+37', 'IX+53'],
    summary: 'Entry 27 initializer head; seeds variant constants IX+37=0x60 and IX+53=1 before sharing the _LABEL_6C59_ tail.',
    evidence: ['ASM lines 15433-15442 identify _LABEL_6C4F_ as the 27th entry of jump table 668E and branch to the shared tail after setting IX+37 and IX+53.'],
  },
  {
    offset: 0x06CC8,
    label: '_LABEL_6CC8_',
    tableIndex: 33,
    tailLabel: '_LABEL_6CD0_',
    role: 'entity_init_variant_33_head',
    constants: ['IX+54=0x18'],
    ramRefs: ['IX+54'],
    summary: 'Entry 33 initializer head; selects IX+54=0x18 and branches into the shared _LABEL_6CD0_ tail.',
    evidence: ['ASM lines 15494-15503 identify _LABEL_6CC8_ as the 33rd entry of jump table 668E, load A=0x18, and branch to the shared _LABEL_6CD0_ tail.'],
  },
  {
    offset: 0x06CCC,
    label: '_LABEL_6CCC_',
    tableIndex: 34,
    tailLabel: '_LABEL_6CD0_',
    role: 'entity_init_variant_34_head',
    constants: ['IX+54=0x10'],
    ramRefs: ['IX+54'],
    summary: 'Entry 34 initializer head; selects IX+54=0x10 and branches into the shared _LABEL_6CD0_ tail.',
    evidence: ['ASM lines 15498-15503 identify _LABEL_6CCC_ as the 34th entry of jump table 668E, load A=0x10, and branch to the shared _LABEL_6CD0_ tail.'],
  },
  {
    offset: 0x06D05,
    label: '_LABEL_6D05_',
    tableIndex: 36,
    tailLabel: '_LABEL_6D13_',
    role: 'entity_init_variant_36_head',
    constants: ['IX+43=0xFA', 'IX+53=0x00', 'IX+56=0xFC'],
    ramRefs: ['IX+43', 'IX+53', 'IX+56'],
    summary: 'Entry 36 initializer head; selects signed motion constants through BC=0xFA00 and A=0xFC before sharing the _LABEL_6D13_ tail.',
    evidence: ['ASM lines 15521-15534 identify _LABEL_6D05_ as the 36th entry of jump table 668E and branch to _LABEL_6D13_ after loading BC/A constants.'],
  },
  {
    offset: 0x06D0C,
    label: '_LABEL_6D0C_',
    tableIndex: 37,
    tailLabel: '_LABEL_6D13_',
    role: 'entity_init_variant_37_head',
    constants: ['IX+43=0xF8', 'IX+53=0x01', 'IX+56=0xFB'],
    ramRefs: ['IX+43', 'IX+53', 'IX+56'],
    summary: 'Entry 37 initializer head; selects signed motion constants through BC=0xF801 and A=0xFB before sharing the _LABEL_6D13_ tail.',
    evidence: ['ASM lines 15525-15534 identify _LABEL_6D0C_ as the 37th entry of jump table 668E and branch to _LABEL_6D13_ after loading BC/A constants.'],
  },
  {
    offset: 0x06D51,
    label: '_LABEL_6D51_',
    tableIndex: 39,
    tailLabel: '_LABEL_6D5B_',
    role: 'entity_init_variant_39_head',
    constants: ['IX+53=0x00', 'IX+37=0x60'],
    ramRefs: ['IX+37', 'IX+53'],
    summary: 'Entry 39 initializer head; selects BC=0x0060 for IX+53/IX+37 before sharing the _LABEL_6D5B_ tail.',
    evidence: ['ASM lines 15558-15567 identify _LABEL_6D51_ as the 39th entry of jump table 668E, load BC=0x0060, and branch to _LABEL_6D5B_.'],
  },
  {
    offset: 0x06D56,
    label: '_LABEL_6D56_',
    tableIndex: 40,
    tailLabel: '_LABEL_6D5B_',
    role: 'entity_init_variant_40_head',
    constants: ['IX+53=0x01', 'IX+37=0x70'],
    ramRefs: ['IX+37', 'IX+53'],
    summary: 'Entry 40 initializer head; selects BC=0x0170 for IX+53/IX+37 before sharing the _LABEL_6D5B_ tail.',
    evidence: ['ASM lines 15562-15567 identify _LABEL_6D56_ as the 40th entry of jump table 668E, load BC=0x0170, and branch to _LABEL_6D5B_.'],
  },
  {
    offset: 0x06D98,
    label: '_LABEL_6D98_',
    tableIndex: 42,
    tailLabel: '_LABEL_6DA4_',
    role: 'entity_init_variant_42_head',
    constants: ['IX+53=0x0E'],
    ramRefs: ['IX+53'],
    summary: 'Entry 42 initializer head; selects IX+53=0x0E before sharing the _LABEL_6DA4_ tail.',
    evidence: ['ASM lines 15592-15601 identify _LABEL_6D98_ as the 42nd entry of jump table 668E, set IX+53, and branch to _LABEL_6DA4_.'],
  },
  {
    offset: 0x06D9E,
    label: '_LABEL_6D9E_',
    tableIndex: 43,
    tailLabel: '_LABEL_6DA4_',
    role: 'entity_init_variant_43_head',
    constants: ['IX+53=0x0F'],
    ramRefs: ['IX+53'],
    summary: 'Entry 43 initializer head; selects IX+53=0x0F before sharing the _LABEL_6DA4_ tail.',
    evidence: ['ASM lines 15596-15601 identify _LABEL_6D9E_ as the 43rd entry of jump table 668E, set IX+53, and branch to _LABEL_6DA4_.'],
  },
  {
    offset: 0x06E6A,
    label: '_LABEL_6E6A_',
    tableIndex: 54,
    tailLabel: '_LABEL_6E86_',
    role: 'entity_init_variant_54_head',
    constants: ['IX+37=0x40', 'IX+41=0x00', 'IX+43=0xFA'],
    ramRefs: ['IX+37', 'IX+41', 'IX+43'],
    summary: 'Entry 54 initializer head; seeds vertical/motion constants and branches into the shared _LABEL_6E86_ tail.',
    evidence: ['ASM lines 15682-15699 identify _LABEL_6E6A_ as the 54th entry of jump table 668E and branch to the shared tail after setting IX+37, IX+41, and IX+43.'],
  },
  {
    offset: 0x06E78,
    label: '_LABEL_6E78_',
    tableIndex: 55,
    tailLabel: '_LABEL_6E86_',
    role: 'entity_init_variant_55_head',
    constants: ['IX+37=0x40', 'IX+41=0x01', 'IX+43=0xF8'],
    ramRefs: ['IX+37', 'IX+41', 'IX+43'],
    summary: 'Entry 55 initializer head; seeds vertical/motion constants and branches into the shared _LABEL_6E86_ tail.',
    evidence: ['ASM lines 15690-15699 identify _LABEL_6E78_ as the 55th entry of jump table 668E and branch to the shared tail after setting IX+37, IX+41, and IX+43.'],
  },
  {
    offset: 0x06F02,
    label: '_LABEL_6F02_',
    tableIndex: 64,
    tailLabel: '_LABEL_6F25_',
    role: 'entity_init_variant_64_head',
    constants: ['IX+17=0x00', 'IX+53=0x10', 'DE=0x0008'],
    ramRefs: ['IX+17', 'IX+53', 'IX+3', 'IX+4'],
    summary: 'Entry 64 initializer head; selects facing/variant constants and positive X offset before sharing the _LABEL_6F25_ tail.',
    evidence: ['ASM lines 15749-15770 identify _LABEL_6F02_ as the 64th entry of jump table 668E and branch to _LABEL_6F25_ after setting IX+17, IX+53, and DE.'],
  },
  {
    offset: 0x06F0F,
    label: '_LABEL_6F0F_',
    tableIndex: 65,
    tailLabel: '_LABEL_6F25_',
    role: 'entity_init_variant_65_head',
    constants: ['IX+17=0x01', 'IX+53=0x10', 'DE=0xFFF8'],
    ramRefs: ['IX+17', 'IX+53', 'IX+3', 'IX+4'],
    summary: 'Entry 65 initializer head; selects facing/variant constants and negative X offset before sharing the _LABEL_6F25_ tail.',
    evidence: ['ASM lines 15756-15770 identify _LABEL_6F0F_ as the 65th entry of jump table 668E and branch to _LABEL_6F25_ after setting IX+17, IX+53, and DE.'],
  },
  {
    offset: 0x06F1C,
    label: '_LABEL_6F1C_',
    tableIndex: 66,
    tailLabel: '_LABEL_6F25_',
    role: 'entity_init_variant_66_head',
    constants: ['IX+53=0x03', 'DE=0x0008'],
    ramRefs: ['IX+53', 'IX+3', 'IX+4'],
    summary: 'Entry 66 initializer head; selects IX+53=3 and positive X offset before sharing the _LABEL_6F25_ tail.',
    evidence: ['ASM lines 15763-15770 identify _LABEL_6F1C_ as the 66th entry of jump table 668E and branch to _LABEL_6F25_ after setting IX+53 and DE.'],
  },
  {
    offset: 0x06F60,
    label: '_LABEL_6F60_',
    tableIndex: 68,
    tailLabel: '_LABEL_6F66_',
    role: 'entity_init_variant_68_head',
    constants: ['IX+53=0x10'],
    ramRefs: ['IX+53'],
    summary: 'Entry 68 initializer head; selects IX+53=0x10 before sharing the _LABEL_6F66_ tail.',
    evidence: ['ASM lines 15799-15809 identify _LABEL_6F60_ as the 68th entry of jump table 668E, set IX+53, and branch to _LABEL_6F66_.'],
  },
];

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
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank0EntityInitHeadsAudit');
  return keys.length === 1 && keys[0] === 'inferred';
}

function displayName(item) {
  return `${item.label} ${item.role.split('_').join(' ')}`;
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      entryCount: ENTRIES.length,
      table: '_DATA_668E_',
      tableIndexedBy: '_RAM_C3CF_',
      assetPolicy: 'Metadata only: ASM labels, offsets, dispatch table indexes, branch targets, constants, RAM/IX references, and evidence. No ROM bytes or decoded graphics are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      name: displayName(item),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    evidence: [
      'ASM lines 14914-14932 show _LABEL_667C dispatching entity type ids through the _DATA_668E_ initializer table indexed by _RAM_C3CF_.',
      'ASM comments around lines 15092-15809 identify these labels as explicit entries of the jump table from 668E.',
      'The audited regions are short variant heads or shared tails that select constants before joining already-cataloged entity initializer tails.',
    ],
  };
}

function annotateRegion(region, item) {
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  if (!region.name) region.name = displayName(item);
  if (!region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank0EntityInitHeadsAudit = {
    catalogId,
    kind: item.role,
    family: 'bank0_entity_init_table',
    label: item.label,
    confidence: 'high',
    dispatchTable: '_DATA_668E_',
    dispatchIndex: item.tableIndex,
    tailLabel: item.tailLabel,
    constants: item.constants,
    ramRefs: item.ramRefs,
    summary: item.summary,
    evidence: item.evidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    label: item.label,
    role: item.role,
    dispatchIndex: item.tableIndex,
    tailLabel: item.tailLabel,
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
    mapData.bank0EntityInitHeadCatalogs = (mapData.bank0EntityInitHeadCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.bank0EntityInitHeadCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank0_entity_init_heads_audit',
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
        'Decode _DATA_668E_ itself as a pointer table with entry-to-label metadata, preserving aliases that share tails.',
        'Trace behavior pointer lists referenced by these heads, such as _DATA_6BAD_, _DATA_6C7B_, _DATA_6D47_, and _DATA_6F58_.',
        'Correlate _DATA_668E_ indexes with room entity records loaded by _LABEL_667C_ and _LABEL_676D_.',
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
