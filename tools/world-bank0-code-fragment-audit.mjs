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
const catalogId = 'world-bank0-code-fragment-catalog-2026-06-24';
const reportId = 'bank0-code-fragment-audit-2026-06-24';

const REGION_UPDATES = [
  {
    offset: 0x00577,
    inferredType: 'code',
    role: 'background_fill_alternate_entry_fragment',
    confidence: 'medium',
    summary: 'Short alternate-entry code fragment between _LABEL_556_ and _LABEL_580_; not screen bytecode.',
    evidence: [
      'ASM lines 1614-1636 define _LABEL_556_ as a VDP background fill routine.',
      'ASM lines 1638-1639 mark 0x00577-0x0057F as a nine-byte fragment immediately before _LABEL_580_.',
      'Manual Z80 decode of 0x00577 branches into the same background-fill body at _LABEL_556_.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x00577.',
    ],
  },
  {
    offset: 0x008A2,
    inferredType: 'data_table',
    role: 'c23c_update_lookup_table',
    confidence: 'high',
    summary: '_LABEL_881_ indexes a 16-byte lookup table at 0x008A2 and stores the selected value in _RAM_C23C_.',
    evidence: [
      'ASM lines 2129-2148 define _LABEL_881_, load HL with 0x008A2, index it by _RAM_CFFD_, and write the selected value to _RAM_C23C_.',
      'ASM lines 2151-2152 mark 0x008A2-0x008B1 as a 16-byte data table.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x008A2.',
    ],
  },
  {
    offset: 0x00D6B,
    inferredType: 'code',
    role: 'bank_switch_trampoline_fragment',
    confidence: 'medium',
    summary: 'Bank-switching trampoline/code fragment immediately before VDP register helpers; not screen bytecode.',
    evidence: [
      'ASM lines 2839-2841 mark 0x00D6B-0x00D84 as a 26-byte fragment that manually decodes to stack/register code and a jump tail.',
      'The decoded fragment reads a return-stream pointer, updates mapper/bank state through _RAM_FFFF_, calls the local tail at 0x00D84, restores mapper state, and returns/jumps.',
      'ASM lines 2843-2852 begin the next labeled VDP helper _LABEL_D85_.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x00D6B.',
    ],
  },
  {
    offset: 0x017E4,
    inferredType: 'code',
    role: 'entity_motion_helper_code_fragment',
    confidence: 'high',
    summary: 'Entity motion helper code between _LABEL_17CA_ and _LABEL_17FE_; not screen bytecode.',
    evidence: [
      'ASM lines 4391-4401 define _LABEL_17CA_, an entity helper calling _LABEL_12D8_, _LABEL_186F_, and _LABEL_1951_.',
      'ASM lines 4403-4405 mark 0x017E4-0x017FD as a fragment that manually decodes as the sibling helper body ending in return.',
      'ASM lines 4407-4418 define _LABEL_17FE_, another closely related entity helper.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x017E4.',
    ],
  },
  {
    offset: 0x01B71,
    inferredType: 'code',
    role: 'entity_velocity_clamp_helper_fragment',
    confidence: 'high',
    summary: 'Entity velocity/position clamp helper code between _LABEL_1B4B_ and _LABEL_1BBA_; not screen bytecode.',
    evidence: [
      'ASM lines 4909-4932 define _LABEL_1B4B_, updating IX velocity/position fields.',
      'ASM lines 4934-4939 mark 0x01B71-0x01BB9 as a 73-byte fragment that manually decodes as a related IX field clamp/update helper.',
      'ASM lines 4941-4960 define the next related bounds helper _LABEL_1BBA_/_LABEL_1BBF_.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x01B71.',
    ],
  },
  {
    offset: 0x01BDF,
    inferredType: 'code',
    role: 'orphan_return_code_fragment_between_collision_helpers',
    confidence: 'medium',
    summary: 'Single return-opcode fragment between nearby collision/helper routines; executable code-shaped boundary fragment, not screen bytecode.',
    evidence: [
      'ASM lines 4941-4960 define the preceding helper _LABEL_1BBA_/_LABEL_1BBF_.',
      'ASM lines 4962-4963 mark 0x01BDF as a one-byte return fragment before _LABEL_1BE0_.',
      'ASM lines 4965-4999 define _LABEL_1BE0_, which performs data-table selection and drawing helper calls.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x01BDF.',
    ],
  },
  {
    offset: 0x01C1C,
    inferredType: 'data_table',
    role: 'small_tile_draw_record_table',
    confidence: 'high',
    summary: '_LABEL_1BE0_ selects fixed records at 0x01C1C, 0x01C23, and 0x01C2A for a small draw helper path.',
    evidence: [
      'ASM lines 4965-4999 define _LABEL_1BE0_; for values below 0x30 it selects 0x01C1C, 0x01C23, or 0x01C2A and calls _LABEL_99B_.',
      'ASM lines 5001-5003 mark 0x01C1C-0x01C30 as a 21-byte table containing three seven-byte records.',
      'The later branches in _LABEL_1BE0_ use _DATA_13C00_ and _DATA_13C0A_ through pointer helpers, confirming this is table selection logic rather than _LABEL_604_ screen rendering.',
    ],
  },
  {
    offset: 0x03226,
    inferredType: 'code',
    role: 'status_or_hud_update_code_fragment',
    confidence: 'medium',
    summary: 'HUD/status update helper fragment between _LABEL_3214_ and _LABEL_3280_; not screen bytecode.',
    evidence: [
      'ASM lines 7890-7920 show the preceding status/HUD update path calling _LABEL_3025_, _LABEL_32E2_, and _LABEL_3713_.',
      'ASM lines 7922-7928 mark 0x03226-0x0327F as a 90-byte fragment that manually decodes to VDP-address/write helper code ending in return.',
      'ASM lines 7930-7951 define subsequent labeled status update helpers _LABEL_3280_ and _LABEL_3298_.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x03226.',
    ],
  },
  {
    offset: 0x0477C,
    inferredType: 'code',
    role: 'player_state_branch_code_after_4770_table',
    confidence: 'high',
    summary: 'Local player-state branch body immediately after the 0x4770 jump table; not screen bytecode.',
    evidence: [
      'ASM lines 10885-10903 define _LABEL_4746_, branch around the main update path with jr nz,+, then dispatch through the 0x4770 jump table.',
      'ASM lines 10905-10974 are the local + branch body that begins at 0x0477C and ends immediately before _LABEL_47FE_.',
      'ASM line 10890 calls _LABEL_47FE_, confirming 0x0477C is adjacent player/control flow code, not a screen-program root.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x0477C.',
    ],
  },
  {
    offset: 0x067C1,
    inferredType: 'code',
    role: 'entity_collision_interaction_code_fragment',
    confidence: 'medium',
    summary: 'Entity collision/interaction helper fragment adjacent to _LABEL_676D_/_LABEL_6793_; not screen bytecode.',
    evidence: [
      'ASM lines 14987-15008 define _LABEL_676D_, which loads entity init data from _DATA_17D00_.',
      'ASM lines 15010-15032 define _LABEL_6793_, which updates IX state and plays sound effects based on entity interaction timing.',
      'ASM lines 15034-15051 mark 0x067C1-0x068C6 as a 262-byte fragment that manually decodes as IX/RAM entity interaction logic and includes internal calls to nearby helpers.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x067C1.',
    ],
  },
  {
    offset: 0x068F0,
    inferredType: 'code',
    role: 'entity_speed_clamp_code_fragment',
    confidence: 'medium',
    summary: 'Entity speed clamp helper fragment used by the preceding interaction block; not screen bytecode.',
    evidence: [
      'ASM lines 15034-15051 mark the preceding 0x067C1 interaction helper block; manual decode of its tail calls 0x068F0.',
      'ASM lines 15053-15078 define the nearby labeled helper _LABEL_68C7_.',
      'ASM lines 15080-15083 mark 0x068F0-0x06918 as a 41-byte fragment that manually decodes as an IX speed clamp/update helper ending in carry-set return.',
      'No direct _LABEL_604_ call or screen-program pointer-table entry references 0x068F0.',
    ],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
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

function shouldRetype(region, inferredType) {
  if (!region) return false;
  const current = region.type || 'unknown';
  if (current === inferredType) return false;
  if (inferredType === 'code') return ['screen_prog', 'unknown', 'raw_byte', 'data_table'].includes(current);
  if (inferredType === 'data_table') return ['screen_prog', 'unknown', 'raw_byte'].includes(current);
  if (inferredType === 'raw_byte') return ['screen_prog', 'unknown'].includes(current);
  return false;
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-bank0-code-fragment-audit.mjs',
    summary: {
      regionsAudited: REGION_UPDATES.length,
      codeFragments: REGION_UPDATES.filter(item => item.inferredType === 'code').length,
      dataTables: REGION_UPDATES.filter(item => item.inferredType === 'data_table').length,
      rawByteFragments: REGION_UPDATES.filter(item => item.inferredType === 'raw_byte').length,
      orphanReturnCodeFragments: REGION_UPDATES.filter(item => item.role.includes('orphan_return_code_fragment')).length,
      assetPolicy: 'Metadata only: offsets, labels, routine references, region roles, and confidence. No ROM bytes, decoded graphics, music, text, or rendered data are embedded.',
    },
    entries: REGION_UPDATES.map(item => ({
      offset: hex(item.offset),
      inferredType: item.inferredType,
      role: item.role,
      confidence: item.confidence,
      summary: item.summary,
      evidence: item.evidence,
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
  };
}

function annotateRegion(region, item) {
  const typeBefore = region.type || 'unknown';
  const changedType = shouldRetype(region, item.inferredType);
  if (changedType) region.type = item.inferredType;
  region.analysis = region.analysis || {};
  region.analysis.bank0CodeFragmentAudit = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: 'tools/world-bank0-code-fragment-audit.mjs',
  };
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    typeBefore,
    typeAfter: region.type || typeBefore,
    changedType,
    kind: item.role,
  };
}

function applyAnnotations(mapData, catalog) {
  const changed = [];
  const evidenceOnly = [];
  const missing = [];
  for (const entry of catalog.entries) {
    const item = REGION_UPDATES.find(update => hex(update.offset) === entry.offset);
    const region = findExactRegion(mapData, parseInt(entry.offset, 16));
    if (!region || !item) {
      missing.push({ offset: entry.offset, inferredType: entry.inferredType, role: entry.role });
      continue;
    }
    const result = annotateRegion(region, item);
    if (result.changedType) changed.push(result);
    else evidenceOnly.push(result);
  }
  return { changed, evidenceOnly, missing };
}

function changedRegionRefs(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.bank0CodeFragmentAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.bank0CodeFragmentAudit.kind,
      confidence: region.analysis.bank0CodeFragmentAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const changes = applyAnnotations(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.fragmentCatalogs = (mapData.fragmentCatalogs || []).filter(item => item.id !== catalogId);
    mapData.fragmentCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank0_code_fragment_audit',
      generatedAt: now,
      tool: 'tools/world-bank0-code-fragment-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changedRegionRefs(mapData).length,
        retypeChangesThisRun: changes.changed.length,
        evidenceOnlyRegions: changes.evidenceOnly.length,
        missingRegions: changes.missing.length,
      },
      changedRegions: changedRegionRefs(mapData),
      retypeChangesThisRun: changes.changed,
      evidenceOnlyRegions: changes.evidenceOnly,
      missingRegions: changes.missing,
      nextLeads: [
        'Add a static Z80 fragment decoder report that can list instruction boundaries for ASM data blocks without embedding raw bytes.',
        'Trace computed-call or local-label references into medium-confidence code fragments before promoting them to named gameplay routines.',
        'Continue reducing unexplained screen_prog candidates by checking for direct _LABEL_604_ roots before trusting byte-pattern decodes.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    retypeChanges: changes.changed,
    evidenceOnlyRegions: changes.evidenceOnly,
    missingRegions: changes.missing,
  }, null, 2));
}

main();
