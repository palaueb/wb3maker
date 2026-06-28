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
const catalogId = 'world-password-routine-catalog-2026-06-25';
const reportId = 'password-routine-audit-2026-06-25';
const toolName = 'tools/world-password-routine-audit.mjs';

const ROUTINES = [
  {
    offset: 0x03ACF,
    label: '_LABEL_3ACF_',
    role: 'password_display_screen_controller',
    name: '_LABEL_3ACF_ password display screen controller',
    summary: 'Loads the password display screen, encodes current game state into the password bit buffer, converts it to password characters, and displays it.',
    calls: ['_LABEL_849_', '_LABEL_1023_', '_LABEL_8FB_', '_LABEL_8B2_', '_LABEL_5EB_', '_LABEL_34E2_', '_LABEL_3D2B_', '_LABEL_3D36_', '_LABEL_3BFA_', '_LABEL_3E5D_', '_LABEL_3B87_', '_LABEL_3BE1_'],
    ramRefs: ['_RAM_CF86_', '_RAM_CFFC_', '_RAM_CF95_'],
    relatedOffsets: [0x13B8D, 0x35AD, 0x03BC1, 0x03E89],
    evidence: ['_LABEL_3ACF_ loads screen assets, clears the password bit buffer, calls the state encoder/checksum/mask/character conversion sequence, then displays the generated password.'],
  },
  {
    offset: 0x03B25,
    label: '_LABEL_3B25_',
    role: 'password_chars_to_bit_buffer',
    name: '_LABEL_3B25_ password characters to bit buffer',
    summary: 'Converts fourteen password characters from _RAM_D137_ into the nine-byte password bit buffer at _RAM_D145_.',
    calls: ['_LABEL_3B58_'],
    ramRefs: ['_RAM_D137_', '_RAM_D145_', '_RAM_D0DE_'],
    relatedOffsets: [0x03B6D],
    evidence: ['_LABEL_3B25_ converts each password character with _LABEL_3B58_ and shifts five bits per character into _RAM_D145_ through _RAM_D14D_.'],
  },
  {
    offset: 0x03B87,
    label: '_LABEL_3B87_',
    role: 'password_bit_buffer_to_chars',
    name: '_LABEL_3B87_ password bit buffer to characters',
    summary: 'Extracts fourteen five-bit values from _RAM_D145_ and maps them through the password alphabet table into _RAM_D137_.',
    calls: [],
    ramRefs: ['_RAM_D145_', '_RAM_D137_', '_RAM_D0DE_'],
    relatedOffsets: [0x03BC1],
    evidence: ['_LABEL_3B87_ shifts _RAM_D145_, masks extracted values with $1F, indexes _DATA_3BC1_, and writes fourteen characters to _RAM_D137_.'],
  },
  {
    offset: 0x03BE1,
    label: '_LABEL_3BE1_',
    role: 'password_display_writer',
    name: '_LABEL_3BE1_ password display writer',
    summary: 'Writes the current fourteen-character password buffer to fixed VDP destinations using the password display coordinate table.',
    calls: ['_LABEL_28_', '_LABEL_30_'],
    ramRefs: ['_RAM_D137_'],
    relatedOffsets: [0x03FE2],
    evidence: ['_LABEL_3BE1_ iterates _DATA_3FE2_ VDP address pairs and writes fourteen bytes from _RAM_D137_ through rst $30 with attribute byte $09.'],
  },
  {
    offset: 0x03BFA,
    label: '_LABEL_3BFA_',
    role: 'password_checksum_write',
    name: '_LABEL_3BFA_ password checksum writer',
    summary: 'Computes a seven-bit checksum over the password bit buffer and stores it in the first buffer byte while preserving its high bit.',
    calls: [],
    ramRefs: ['_RAM_D145_', '_RAM_D14D_'],
    evidence: ['_LABEL_3BFA_ masks _RAM_D14D_, sums nine bytes from _RAM_D145_, masks the sum with $7F, and ORs it into _RAM_D145_.'],
  },
  {
    offset: 0x03C1F,
    label: '_LABEL_3C1F_',
    role: 'password_checksum_validate',
    name: '_LABEL_3C1F_ password checksum validator',
    summary: 'Recomputes the seven-bit checksum and returns the difference from the stored checksum byte.',
    calls: [],
    ramRefs: ['_RAM_D145_', '_RAM_D0FE_'],
    evidence: ['_LABEL_3C1F_ extracts the stored checksum from _RAM_D145_, recomputes the masked sum across _RAM_D145_, and returns stored minus computed in A.'],
  },
  {
    offset: 0x03C45,
    label: '_LABEL_3C45_',
    role: 'password_bit_buffer_to_game_state',
    name: '_LABEL_3C45_ password bit buffer to game state',
    summary: 'Decodes the password bit buffer into inventory, equipment, money digits, form, health/magic, and state flags.',
    calls: ['_LABEL_3D15_', '_LABEL_3D1D_', '_LABEL_BCD_', '_LABEL_3EAD_'],
    ramRefs: ['_RAM_D145_', '_RAM_CF20_', '_RAM_CF3E_', '_RAM_CF49_', '_RAM_CF5C_', '_RAM_CF54_', '_RAM_CF48_', '_RAM_CF55_', '_RAM_C24F_', '_RAM_CF5B_'],
    relatedOffsets: [0x03E58],
    evidence: ['_LABEL_3C45_ repeatedly consumes bits through _LABEL_3D15_/_LABEL_3D1D_ and stores decoded fields into the _RAM_CF20_ equipment/item area and player state RAM.'],
  },
  {
    offset: 0x03D15,
    label: '_LABEL_3D15_',
    role: 'password_bit_read_multi',
    name: '_LABEL_3D15_ password multi-bit reader',
    summary: 'Reads C bits from the password bit buffer by repeatedly calling _LABEL_3D1D_.',
    calls: ['_LABEL_3D1D_'],
    ramRefs: ['_RAM_D145_'],
    evidence: ['_LABEL_3D15_ clears A, calls _LABEL_3D1D_ C times, and returns the accumulated bit value in A.'],
  },
  {
    offset: 0x03D1D,
    label: '_LABEL_3D1D_',
    role: 'password_bit_read_one',
    name: '_LABEL_3D1D_ password one-bit reader',
    summary: 'Shifts the nine-byte password bit buffer left by one bit and rotates the extracted bit into A.',
    calls: [],
    ramRefs: ['_RAM_D145_'],
    evidence: ['_LABEL_3D1D_ rotates nine bytes at _RAM_D145_ through carry and rotates carry into A.'],
  },
  {
    offset: 0x03D2B,
    label: '_LABEL_3D2B_',
    role: 'password_bit_buffer_clear',
    name: '_LABEL_3D2B_ password bit buffer clear',
    summary: 'Clears the nine-byte password bit buffer before encoding or validation.',
    calls: [],
    ramRefs: ['_RAM_D145_'],
    evidence: ['_LABEL_3D2B_ writes zero to nine bytes starting at _RAM_D145_.'],
  },
  {
    offset: 0x03D36,
    label: '_LABEL_3D36_',
    role: 'game_state_to_password_bit_buffer',
    name: '_LABEL_3D36_ game state to password bit buffer',
    summary: 'Encodes equipment, inventory, flags, money digits, form, health/magic, and padding bits into the password bit buffer.',
    calls: ['_LABEL_3E4B_', '_LABEL_D36_', '_LABEL_32C9_', '_LABEL_BCD_', '_LABEL_3EAD_'],
    ramRefs: ['_RAM_CF20_', '_RAM_CF3E_', '_RAM_CF49_', '_RAM_CF5C_', '_RAM_CF54_', '_RAM_CF48_', '_RAM_CF55_', '_RAM_C24F_', '_RAM_CF5B_', '_RAM_D145_'],
    relatedOffsets: [0x03E58],
    evidence: ['_LABEL_3D36_ serializes item/equipment bits with _LABEL_3E4B_, converts numeric fields through helper routines, encodes form/health/magic fields, and pads the remaining password bits.'],
  },
  {
    offset: 0x03E4B,
    label: '_LABEL_3E4B_',
    role: 'password_bit_write_one',
    name: '_LABEL_3E4B_ password one-bit writer',
    summary: 'Shifts one bit from A into the nine-byte password bit buffer.',
    calls: [],
    ramRefs: ['_RAM_D145_'],
    evidence: ['_LABEL_3E4B_ rotates nine bytes at _RAM_D145_ through carry after the caller positions the next bit in A.'],
  },
  {
    offset: 0x03EAD,
    label: '_LABEL_3EAD_',
    role: 'password_decimal_digits_to_binary',
    name: '_LABEL_3EAD_ password decimal digits to binary',
    summary: 'Converts six decimal digit bytes into a binary accumulator used by the password money/state encoder.',
    calls: [],
    ramRefs: ['_RAM_CF5A_', '_RAM_D0EE_', '_RAM_D0EF_'],
    evidence: ['_LABEL_3EAD_ walks six bytes backwards from _RAM_CF5A_, repeatedly multiplies the accumulator by ten, adds the next digit, and stores the result in _RAM_D0EE_/_RAM_D0EF_.'],
  },
  {
    offset: 0x03ED6,
    label: '_LABEL_3ED6_',
    role: 'password_inventory_clear_helper',
    name: '_LABEL_3ED6_ password inventory clear helper',
    summary: 'Clears five inventory/equipment bytes and marks _RAM_CF49_ as initialized.',
    calls: [],
    ramRefs: ['_RAM_CF3E_', '_RAM_CF49_'],
    evidence: ['_LABEL_3ED6_ clears five bytes starting at _RAM_CF3E_ and sets bit 7 of _RAM_CF49_.'],
  },
  {
    offset: 0x03EE6,
    label: '_LABEL_3EE6_',
    role: 'password_entry_validation_controller',
    name: '_LABEL_3EE6_ password entry validation controller',
    summary: 'Runs the password entry screen loop, handles the special replacement password, converts entered characters to bits, applies mask/checksum validation, and loads game state on success.',
    calls: ['_LABEL_3F5F_', '_LABEL_849_', '_LABEL_1004_', '_LABEL_4464_', '_LABEL_6E7_', '_LABEL_400F_', '_LABEL_3D2B_', '_LABEL_3B25_', '_LABEL_3E5D_', '_LABEL_3C1F_', '_LABEL_104B_', '_LABEL_3C45_'],
    ramRefs: ['_RAM_D11C_', '_RAM_D137_'],
    relatedOffsets: [0x03F43, 0x03F51],
    evidence: ['_LABEL_3EE6_ loops through the password input handler, compares the entered buffer to _DATA_3F43_, optionally copies _DATA_3F51_, then validates and decodes the password.'],
  },
  {
    offset: 0x0400F,
    label: '_LABEL_400F_',
    role: 'password_input_dispatch',
    name: '_LABEL_400F_ password input dispatch',
    summary: 'Dispatches password screen input bits for character increment/decrement and cursor movement.',
    calls: ['_LABEL_41BB_', '_LABEL_4194_', '_LABEL_41ED_', '_LABEL_41DA_'],
    ramRefs: ['_RAM_CF90_', '_RAM_D11A_', '_RAM_D11C_', '_RAM_D11D_', '_RAM_D137_'],
    evidence: ['_LABEL_400F_ reads _RAM_CF90_ input bits, updates the selected _RAM_D137_ character or cursor index _RAM_D11C_, then redraws through _LABEL_41ED_/_LABEL_41DA_.'],
  },
  {
    offset: 0x04045,
    label: '_LABEL_4045_',
    role: 'password_increment_repeat_loop',
    name: '_LABEL_4045_ password increment repeat loop',
    summary: 'Repeats held character-increment input after a delay while updating the password display.',
    calls: ['_LABEL_1004_', '_LABEL_4464_', '_LABEL_6E7_', '_LABEL_41BB_', '_LABEL_41ED_'],
    ramRefs: ['_RAM_CF90_', '_RAM_D11A_', '_RAM_D11C_', '_RAM_D137_'],
    evidence: ['_LABEL_4045_ waits on _RAM_D11A_, keeps polling _RAM_CF90_ bit 0, advances the selected character through _LABEL_41BB_, and redraws it.'],
  },
  {
    offset: 0x04083,
    label: '_LABEL_4083_',
    role: 'password_decrement_input_path',
    name: '_LABEL_4083_ password decrement input path',
    summary: 'Handles password character decrement input and enters the held-repeat decrement loop.',
    calls: ['_LABEL_4194_', '_LABEL_41ED_'],
    ramRefs: ['_RAM_CF90_', '_RAM_D11A_', '_RAM_D11C_', '_RAM_D137_'],
    evidence: ['_LABEL_4083_ tests _RAM_CF90_ bit 1, decrements the selected password character with wraparound, maps it through _LABEL_4194_, and redraws the character.'],
  },
  {
    offset: 0x040B4,
    label: '_LABEL_40B4_',
    role: 'password_decrement_repeat_loop',
    name: '_LABEL_40B4_ password decrement repeat loop',
    summary: 'Repeats held character-decrement input after a delay while updating the password display.',
    calls: ['_LABEL_1004_', '_LABEL_4464_', '_LABEL_6E7_', '_LABEL_4194_', '_LABEL_41ED_'],
    ramRefs: ['_RAM_CF90_', '_RAM_D11A_', '_RAM_D11C_', '_RAM_D137_'],
    evidence: ['_LABEL_40B4_ waits on _RAM_D11A_, keeps polling _RAM_CF90_ bit 1, decrements the selected character through _LABEL_4194_, and redraws it.'],
  },
  {
    offset: 0x040F1,
    label: '_LABEL_40F1_',
    role: 'password_cursor_left_path',
    name: '_LABEL_40F1_ password cursor-left path',
    summary: 'Moves the password cursor left with wraparound and redraws old/new cursor positions.',
    calls: ['_LABEL_41DA_', '_LABEL_4185_'],
    ramRefs: ['_RAM_CF90_', '_RAM_D11A_', '_RAM_D11C_', '_RAM_D11D_'],
    evidence: ['_LABEL_40F1_ handles _RAM_CF90_ bit 2, moves _RAM_D11C_ left with wraparound from 0 to $0E, and redraws with _LABEL_41DA_.'],
  },
  {
    offset: 0x0413C,
    label: '_LABEL_413C_',
    role: 'password_cursor_right_path',
    name: '_LABEL_413C_ password cursor-right path',
    summary: 'Moves the password cursor right with wraparound and redraws old/new cursor positions.',
    calls: ['_LABEL_41DA_', '_LABEL_4185_'],
    ramRefs: ['_RAM_CF90_', '_RAM_D11A_', '_RAM_D11C_', '_RAM_D11D_'],
    evidence: ['_LABEL_413C_ handles _RAM_CF90_ bit 3, moves _RAM_D11C_ right with wraparound at $0F, and redraws with _LABEL_41DA_.'],
  },
  {
    offset: 0x04185,
    label: '_LABEL_4185_',
    role: 'password_input_frame_pump',
    name: '_LABEL_4185_ password input frame pump',
    summary: 'Runs one visual/input frame during password cursor repeat handling.',
    calls: ['_LABEL_1004_', '_LABEL_4464_', '_LABEL_6E7_', '_LABEL_FEE_'],
    ramRefs: [],
    evidence: ['_LABEL_4185_ calls the frame helpers, menu animation/update routine, sprite rebuild, and VBlank wait before returning to cursor repeat handlers.'],
  },
  {
    offset: 0x041DA,
    label: '_LABEL_41DA_',
    role: 'password_cursor_redraw_pair',
    name: '_LABEL_41DA_ password cursor redraw pair',
    summary: 'Redraws the previous and current password cursor positions with the appropriate attribute state.',
    calls: ['_LABEL_41ED_', '_LABEL_3FB1_'],
    ramRefs: ['_RAM_D11C_', '_RAM_D11D_'],
    evidence: ['_LABEL_41DA_ redraws _RAM_D11D_ and _RAM_D11C_; the submit position uses _LABEL_3FB1_ while character positions use _LABEL_41ED_.'],
  },
  {
    offset: 0x041ED,
    label: '_LABEL_41ED_',
    role: 'password_character_redraw',
    name: '_LABEL_41ED_ password character redraw',
    summary: 'Redraws one password character at its fixed VDP coordinate with the supplied attribute byte.',
    calls: ['_LABEL_8_', '_LABEL_28_', '_LABEL_30_'],
    ramRefs: ['_RAM_D137_'],
    relatedOffsets: [0x03FC6],
    evidence: ['_LABEL_41ED_ indexes _DATA_3FC6_ by cursor position, loads the corresponding _RAM_D137_ byte, and writes character plus attribute to VDP.'],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(region => {
    const start = parseInt(region.offset, 16);
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

function hasNonInferredAnalysisOtherThanSelf(region) {
  return Boolean(region && Object.keys(region.analysis || {}).some(key => (
    key !== 'inferred' && key !== 'passwordRoutineAudit'
  )));
}

function buildCatalog(mapData) {
  const routines = ROUTINES.map(def => {
    const region = findContainingRegion(mapData, def.offset);
    const relatedRegions = (def.relatedOffsets || [])
      .map(offset => regionRef(findContainingRegion(mapData, offset)))
      .filter(Boolean);
    return {
      id: `${def.label}_${def.role}`,
      label: def.label,
      offset: hex(def.offset),
      role: def.role,
      proposedName: def.name,
      summary: def.summary,
      confidence: 'high',
      region: regionRef(region),
      wasGenericCodeRegion: Boolean(region && !hasNonInferredAnalysisOtherThanSelf(region)),
      calls: def.calls || [],
      ramRefs: def.ramRefs || [],
      relatedRegions,
      evidence: def.evidence,
    };
  });
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    routines,
    summary: {
      routineCount: routines.length,
      missingRegions: routines.filter(routine => !routine.region).length,
      genericCodeRegionsCovered: routines.filter(routine => routine.wasGenericCodeRegion).length,
      assetPolicy: 'Metadata only: ASM labels, offsets, routine roles, calls, RAM refs, related region refs, and evidence. No ROM bytes, password strings, or decoded copyrighted data are embedded.',
    },
  };
}

function annotateRegion(region, routine) {
  const previousName = region.name || '';
  if (!previousName && routine.proposedName) region.name = routine.proposedName;
  region.analysis = region.analysis || {};
  region.analysis.passwordRoutineAudit = {
    catalogId,
    kind: routine.role,
    label: routine.label,
    summary: routine.summary,
    confidence: routine.confidence,
    nameBeforeAudit: previousName,
    nameAfterAudit: region.name || '',
    detail: {
      routineOffset: routine.offset,
      regionOffset: region.offset,
      calls: routine.calls,
      ramRefs: routine.ramRefs,
      relatedRegions: routine.relatedRegions,
    },
    evidence: routine.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    label: routine.label,
    role: routine.role,
    previousName,
    name: region.name || '',
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const missingRegions = catalog.routines
    .filter(routine => !routine.region)
    .map(routine => ({ label: routine.label, offset: routine.offset, role: routine.role }));
  const annotatedRegions = [];

  if (apply) {
    for (const routine of catalog.routines) {
      if (!routine.region) continue;
      const region = mapData.regions.find(item => item.id === routine.region.id);
      annotatedRegions.push(annotateRegion(region, routine));
    }

    const finalCatalog = buildCatalog(mapData);
    mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(item => item.id !== catalogId);
    mapData.playerCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'password_routine_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
      routines: finalCatalog.routines,
      annotatedRegions,
      missingRegions,
      nextLeads: [
        'Name _RAM_D145_ bit positions by comparing _LABEL_3D36_ encoder order with _LABEL_3C45_ decoder order.',
        'Document the password checksum and xor-mask sequence as a parser/validator that stores only metadata, not password payloads.',
        'Connect password-decoded fields to existing player/item RAM catalogs so custom adventure saves can be round-tripped later.',
      ],
    });

    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: apply ? annotatedRegions : catalog.routines
      .filter(routine => routine.region)
      .map(routine => ({
        id: routine.region.id,
        offset: routine.region.offset,
        label: routine.label,
        role: routine.role,
        currentName: routine.region.name || '',
        proposedName: routine.proposedName,
      })),
    missingRegions,
  }, null, 2));
}

main();
