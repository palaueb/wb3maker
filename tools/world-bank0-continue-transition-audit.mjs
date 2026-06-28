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
const catalogId = 'world-bank0-continue-transition-catalog-2026-06-25';
const reportId = 'bank0-continue-transition-audit-2026-06-25';
const toolName = 'tools/world-bank0-continue-transition-audit.mjs';
const LEGACY_NAMES = new Map([
  [0x0421B, 'screen_prog @ 0x0421B'],
  [0x04222, 'SEEMS: MOVE CLOUDS'],
]);

function routine(offset, label, role, name, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name,
    type: 'code',
    family: options.family || 'bank0_continue_transition',
    confidence: options.confidence || 'high',
    calls: options.calls || [],
    ramRefs: options.ramRefs || [],
    evidence: [
      `${label} is an ASM code label at ROM offset ${hex(offset)}.`,
      ...(options.evidence || []),
    ],
  };
}

const ENTRIES = [
  routine(0x03A4A, '_LABEL_3A4A_', 'shop_continue_choice_cursor_up', '_LABEL_3A4A_ shop/continue choice cursor up', 'Moves a two-choice menu cursor up, redraws the old/new cursor markers, and refreshes the derived price/requirement display.', {
    calls: ['_LABEL_104B_', '_LABEL_3025_', '_LABEL_3AA8_'],
    ramRefs: ['_RAM_CF95_', '_RAM_D11C_', '_RAM_D117_', '_RAM_D119_'],
    evidence: ['ASM lines 9097-9121 test _RAM_CF95_ bit 0, decrement _RAM_D11C_, move _RAM_D117_ by -0x0100, play effect 0x22, redraw the cursor, and jump to _LABEL_3AA8_.'],
  }),
  routine(0x03A7A, '_LABEL_3A7A_', 'shop_continue_choice_cursor_down', '_LABEL_3A7A_ shop/continue choice cursor down', 'Moves a two-choice menu cursor down, redraws the cursor marker, and leaves derived display refresh to the caller when needed.', {
    calls: ['_LABEL_104B_', '_LABEL_3025_'],
    ramRefs: ['_RAM_D11C_', '_RAM_D117_', '_RAM_D119_'],
    evidence: ['ASM lines 9122-9137 cap _RAM_D11C_ at 1, move _RAM_D117_ by +0x0100, play effect 0x22, and redraw the marker.'],
  }),
  routine(0x03AA8, '_LABEL_3AA8_', 'shop_continue_requirement_value_writer', '_LABEL_3AA8_ shop/continue requirement value writer', 'Compares the current six-byte price/requirement against inventory/currency digits and writes a four-digit display value/status.', {
    calls: ['_LABEL_BBB_', '_LABEL_5C3_'],
    ramRefs: ['_RAM_D10E_', '_RAM_CF55_', '_RAM_D133_', '_RAM_D111_'],
    evidence: ['ASM lines 9142-9161 compare _RAM_D10E_ with _RAM_CF55_, set _RAM_D133_, then call _LABEL_5C3_ to write four digits at VDP destination 0x3D48.'],
  }),
  routine(0x04040, '_LABEL_4040_', 'password_increment_repeat_delay_fast_path', '_LABEL_4040_ password increment repeat delay fast path', 'Sets the short repeat delay used while holding the password character increment input.', {
    ramRefs: ['_RAM_D11A_'],
    evidence: ['ASM lines 9985-10018 set _RAM_D11A_=1 before re-entering the password increment hold loop at _LABEL_4045_.'],
  }),
  routine(0x040AF, '_LABEL_40AF_', 'password_decrement_repeat_delay_fast_path', '_LABEL_40AF_ password decrement repeat delay fast path', 'Sets the short repeat delay used while holding the password character decrement input.', {
    ramRefs: ['_RAM_D11A_'],
    evidence: ['ASM lines 10044-10077 set _RAM_D11A_=1 before re-entering the password decrement hold loop at _LABEL_40B4_.'],
  }),
  routine(0x04114, '_LABEL_4114_', 'password_cursor_left_repeat_loop', '_LABEL_4114_ password cursor-left repeat loop', 'Frame-pumps password cursor-left repeat handling until input bit 2 is released or the repeat delay expires.', {
    calls: ['_LABEL_4185_', '_LABEL_41DA_'],
    ramRefs: ['_RAM_CF90_', '_RAM_D11A_', '_RAM_D11C_', '_RAM_D11D_'],
    evidence: ['ASM lines 10098-10116 call the frame pump, test _RAM_CF90_ bit 2, decrement _RAM_D11A_, wrap _RAM_D11C_ from 0 to 0x0E, and redraw through _LABEL_41DA_.'],
  }),
  routine(0x0415E, '_LABEL_415E_', 'password_cursor_right_repeat_loop', '_LABEL_415E_ password cursor-right repeat loop', 'Frame-pumps password cursor-right repeat handling until input bit 3 is released or the repeat delay expires.', {
    calls: ['_LABEL_4185_', '_LABEL_41DA_'],
    ramRefs: ['_RAM_CF90_', '_RAM_D11A_', '_RAM_D11C_', '_RAM_D11D_'],
    evidence: ['ASM lines 10137-10155 call the frame pump, test _RAM_CF90_ bit 3, decrement _RAM_D11A_, wrap _RAM_D11C_ at 0x0F, and redraw through _LABEL_41DA_.'],
  }),
  routine(0x0421B, '_LABEL_421B_', 'continue_menu_entry', '_LABEL_421B_ continue menu entry', 'Initializes the continue/new-game choice cursor and enters the continue menu input loop.', {
    calls: ['_LABEL_42E1_', '_LABEL_4222_'],
    ramRefs: ['_RAM_D11C_'],
    evidence: ['ASM lines 10265-10278 clear _RAM_D11C_, call _LABEL_42E1_ to render/fade in the continue menu, then fall into _LABEL_4222_.'],
  }),
  routine(0x04222, '_LABEL_4222_', 'continue_menu_input_loop', '_LABEL_4222_ continue menu input loop', 'Polls the continue/new-game menu until an input edge is received, updates the selection, then commits through _LABEL_4674_.', {
    calls: ['_LABEL_1004_', '_LABEL_4464_', '_LABEL_6E7_', '_LABEL_BFD_', '_LABEL_430E_', '_LABEL_4674_'],
    ramRefs: ['_RAM_CF95_'],
    evidence: ['ASM lines 10269-10278 frame-pump transition actors and sprites, read input through _LABEL_BFD_, loop while _RAM_CF95_ is zero, then call _LABEL_430E_ and _LABEL_4674_.'],
  }),
  routine(0x042E1, '_LABEL_42E1_', 'continue_menu_screen_renderer', '_LABEL_42E1_ continue menu screen renderer', 'Builds the continue/new-game screen, writes its screen program text, initializes the selection marker, and fades in.', {
    calls: ['_LABEL_423A_', '_LABEL_604_', '_LABEL_2F35_', '_LABEL_849_'],
    ramRefs: [],
    evidence: ['ASM lines 10317-10324 call the shared continue screen loader, run _DATA_42F5_ through _LABEL_604_, draw the marker via _LABEL_2F35_, and fade in.'],
  }),
  routine(0x0430E, '_LABEL_430E_', 'continue_menu_cursor_update', '_LABEL_430E_ continue menu cursor update', 'Moves the continue/new-game selection between its two rows and redraws old/new cursor markers.', {
    calls: ['_LABEL_104B_', '_LABEL_4377_', '_LABEL_3025_'],
    ramRefs: ['_RAM_CF95_', '_RAM_D11C_', '_RAM_D117_', '_RAM_D119_', '_RAM_D11B_'],
    evidence: ['ASM lines 10331-10380 handle _RAM_CF95_ up/down bits, update _RAM_D11C_, shift _RAM_D117_ by -0x00C0/+0x00C0, set _RAM_D11B_=5 during redraw, and clear it afterward.'],
  }),
  routine(0x043B8, '_LABEL_43B8_', 'transition_actor_record_loader', '_LABEL_43B8_ transition actor record loader', 'Initializes a sequence of 0x40-byte actor records from a compact transition actor source list and starts each actor animation.', {
    calls: ['_LABEL_1318_'],
    ramRefs: ['IX+0', 'IX+2', 'IX+3', 'IX+4', 'IX+5', 'IX+6', 'IX+7', 'IX+8', 'IX+9', 'IX+10', 'IX+11', 'IX+14', 'IX+15', 'IX+63'],
    evidence: ['ASM lines 10425-10460 read a count, seed IX fields, read coordinate/velocity/animation words through RST 0x10, call _LABEL_1318_, and advance IX by 0x40 per actor.'],
  }),
  routine(0x0460A, '_LABEL_460A_', 'transition_scroll_script_y_increment_tail', '_LABEL_460A_ transition scroll script Y increment tail', 'Shared tail inside the transition scroll-script tick that increments the vertical scroll phase and updates scroll shadows.', {
    calls: ['_LABEL_FEE_'],
    ramRefs: ['_RAM_CF8D_', '_RAM_D007_', '_RAM_D008_', '_RAM_CFE1_', 'IX+0', 'IX+3', 'IX+7', 'IX+8', 'IX+9'],
    evidence: ['ASM lines 10706-10750 compare IX+8/IX+9 against IX+7, update _RAM_CF8D_, set _RAM_CFE1_, wait IX+3 frames, and toggle/finish the active script flag in IX+0.'],
  }),
  routine(0x04674, '_LABEL_4674_', 'continue_menu_selection_commit', '_LABEL_4674_ continue menu selection commit', 'Commits the continue/new-game menu selection into _RAM_CF88_ after start/button input and exits through the fade-out helper.', {
    calls: ['_LABEL_822_'],
    ramRefs: ['_RAM_CF95_', '_RAM_D11C_', '_RAM_CF88_'],
    evidence: ['ASM lines 10758-10772 wait for _RAM_CF95_ bits 4/5, convert _RAM_D11C_ into _RAM_CF88_, and jump to _LABEL_822_.'],
  }),
  routine(0x0468D, '_LABEL_468D_', 'continue_result_screen_sequence', '_LABEL_468D_ continue result screen sequence', 'Runs the three-step continue/new-game result screen sequence, loading screen fragments, fading in, waiting for input/timeouts, and fading out.', {
    calls: ['_LABEL_1004_', '_LABEL_8B2_', '_LABEL_580_', '_LABEL_5EB_', '_LABEL_849_', '_LABEL_46C9_', '_LABEL_822_'],
    ramRefs: ['_RAM_CFAA_'],
    evidence: ['ASM lines 10774-10809 delay 10 frames, set palette context, loop over _DATA_4740_ entries, clear one name-table area, render a screen fragment through _LABEL_5EB_, fade in, wait, then fade out.'],
  }),
  routine(0x046C9, '_LABEL_46C9_', 'continue_result_wait_or_input', '_LABEL_46C9_ continue result wait/input helper', 'Waits B frames during a result screen unless an input edge arrives first.', {
    calls: ['_LABEL_1004_', '_LABEL_BFD_'],
    ramRefs: ['_RAM_CF95_'],
    evidence: ['ASM lines 10811-10820 call _LABEL_1004_ and _LABEL_BFD_, returning early when _RAM_CF95_ is nonzero or after B countdown frames.'],
  }),
  routine(0x046D9, '_LABEL_46D9_', 'timed_gold_status_refresh', '_LABEL_46D9_ timed gold/status refresh', 'Counts down _RAM_D02C_ and, when it reaches zero, draws the small gold/status screen program and refreshes the status display.', {
    calls: ['_LABEL_604_', '_LABEL_241B_'],
    ramRefs: ['_RAM_D02C_'],
    evidence: ['ASM lines 10822-10834 decrement _RAM_D02C_, run _DATA_46EE_ through _LABEL_604_ at zero, then jump to _LABEL_241B_.'],
  }),
  routine(0x04700, '_LABEL_4700_', 'bank2_vdp_block_animation_driver', '_LABEL_4700_ bank-2 VDP block animation driver', 'Drives a bank-2 VDP block animation by repeatedly calling bank-2 routines, stepping source/destination pointers, and waiting two frames between rows.', {
    calls: ['_LABEL_1023_', '_LABEL_BEDE_', '_LABEL_1036_', '_LABEL_BF26_', '_LABEL_FF9_'],
    ramRefs: ['_RAM_D0FE_', '_RAM_D100_'],
    evidence: ['ASM lines 10845-10879 save HL/DE, switch to bank 2, call _LABEL_BEDE_ and _LABEL_BF26_, advance _RAM_D0FE_ by 0x40, and wait two frames per loop until the destination counter reaches its stop conditions.'],
  }),
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
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank0ContinueTransitionAudit');
  return keys.length === 1 && keys[0] === 'inferred';
}

function shouldReplaceName(region) {
  const name = region.name || '';
  return !name || name.startsWith('screen_prog @') || name === 'SEEMS: MOVE CLOUDS';
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
      assetPolicy: 'Metadata only: ASM labels, offsets, routine roles, calls, RAM references, and evidence. No ROM bytes or decoded assets are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    evidence: [
      'ASM lines 9097-9161 show two-choice cursor movement and requirement/value display updates.',
      'ASM lines 9985-10263 show password input repeat helpers and redraw frame pumps.',
      'ASM lines 10265-10460 show continue/new-game screen entry, input loop, cursor update, and transition actor initialization.',
      'ASM lines 10706-10879 show transition scroll-script tails, continue result sequencing, timed status refresh, and bank-2 VDP block animation.',
    ],
  };
}

function annotateRegion(region, item) {
  const oldName = region.name || '';
  const legacyNameBeforeAudit = LEGACY_NAMES.get(item.offset) || null;
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  const changedName = Boolean(legacyNameBeforeAudit) || (shouldReplaceName(region) && oldName !== item.name);
  if (changedName) region.name = item.name;
  if (item.summary && !region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank0ContinueTransitionAudit = {
    catalogId,
    kind: item.role,
    family: item.family,
    label: item.label,
    confidence: item.confidence,
    wasInferredOnlyBeforeAudit: inferredOnlyBeforeAudit,
    oldName,
    legacyNameBeforeAudit,
    changedName,
    calls: item.calls,
    ramRefs: item.ramRefs,
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
    oldName,
    legacyNameBeforeAudit,
    changedName,
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
    mapData.bank0ContinueTransitionCatalogs = (mapData.bank0ContinueTransitionCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.bank0ContinueTransitionCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank0_continue_transition_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: changes.annotated.length,
        missingRegions: changes.missing.length,
        inferredOnlyRegionsCovered: changes.annotated.filter(change => change.wasInferredOnlyBeforeAudit).length,
        legacyNamesCorrected: changes.annotated.filter(change => change.legacyNameBeforeAudit).length,
      },
      annotatedRegions: changes.annotated,
      missingRegions: changes.missing,
      nextLeads: [
        'Fold _LABEL_430E_ and _LABEL_3A4A_ cursor movement into one reusable two-choice menu model for analyzer diagnostics.',
        'Trace _LABEL_4700_ into bank-2 _LABEL_BEDE_/_LABEL_BF26_ to identify its exact VDP block format.',
        'Link continue/new-game selection output _RAM_CF88_ back to startup branches at _LABEL_3F8_ and _LABEL_2B14_.',
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
      legacyNamesCorrected: changes.annotated.filter(change => change.legacyNameBeforeAudit).length,
    },
    missingRegions: changes.missing,
  }, null, 2));
}

main();
