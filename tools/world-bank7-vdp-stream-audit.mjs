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
const catalogId = 'world-bank7-vdp-stream-catalog-2026-06-25';
const reportId = 'bank7-vdp-stream-audit-2026-06-25';
const disambiguationCatalogId = 'world-pause-status-stream-loader-disambiguation-catalog-2026-06-25';

const screenRoots = [
  {
    regionId: 'r0699',
    offset: 0x1CCC0,
    role: 'bank7_screen_prog_root_table',
    confidence: 'high',
    summary: '_DATA_1CCC0_ is the 31-entry bank-7 screen-program table selected by _LABEL_5EB_.',
    evidence: [
      'ASM lines 1732-1746 switch to bank 7, index _DATA_1CCC0_, and call _LABEL_604_.',
      'ASM lines 27974-27979 define _DATA_1CCC0_ as 31 pointers.',
    ],
  },
  {
    regionId: 'r2712',
    offset: 0x1DD18,
    role: 'pause_base_screen_prog_with_stream_pointers',
    confidence: 'high',
    summary: 'Pause/status root screen program that writes base text and embeds pointer records used by the secondary VDP stream subsystem.',
    evidence: [
      'ASM lines 27974-27979 include _DATA_1DD18_ as an entry of _DATA_1CCC0_.',
      'ASM lines 28512-28525 define the _DATA_1DD18_ pause/status root bytes and pointer expressions around _RAM_D178_.',
      '_LABEL_604_ consumes this root as screen-program bytecode, while following records point to secondary VDP stream data.',
    ],
  },
];

const streamRegions = [
  {
    regionId: 'r2713',
    offset: 0x1DD64,
    type: 'pointer_table',
    role: 'pause_status_candidate_bundle_pointer',
    name: '_DATA_1DD64_ pause/status candidate data-bundle pointer',
    confidence: 'medium',
    summary: 'Pointer table entry targeting _DATA_1DE20_; bank-7 runtime consumer remains unconfirmed after bank-alias disambiguation.',
    evidence: [
      'ASM lines 28527-28529 define _DATA_1DD64_ as a pointer table entry indexed by _RAM_D030_ and pointing to _DATA_1DE20_.',
      'The known 0x9D64 VDP stream-state references resolve to bank-2 ROM 0x09D64, not bank-7 ROM 0x1DD64.',
    ],
  },
  {
    regionId: 'r2749',
    offset: 0x1DE20,
    type: 'data_table',
    role: 'pause_status_candidate_data_bundle_entry',
    name: '_DATA_1DE20_ pause/status candidate data bundle',
    confidence: 'medium',
    summary: 'First mapped fragment of the 0x1DE20-0x1E14D pause/status candidate data bundle; no confirmed bank-7 VDP or _LABEL_998_ consumer is traced.',
    evidence: [
      'ASM lines 28552-28554 identify _DATA_1DE20_ as the first entry of the pointer table at _DATA_1DD64_.',
      'world-pause-status-stream-loader-disambiguation-catalog-2026-06-25 shows the known 0x9D64 VDP stream-state references resolve to bank-2 ROM 0x09D64, not bank-7 ROM 0x1DD64.',
      'The bytes are shape-compatible with _LABEL_998_ records, but no direct executable load/call path to _LABEL_998_ is confirmed.',
    ],
  },
  {
    regionId: 'r2717',
    offset: 0x1DE9F,
    type: 'data_table',
    role: 'pause_status_candidate_data_bundle_fragment',
    name: 'pause/status candidate data bundle fragment @ 0x1DE9F',
    confidence: 'medium',
    summary: 'Internal mapped fragment inside the _DATA_1DE20_ candidate data bundle; not a confirmed VDP stream root.',
    evidence: [
      'ASM line 28554 starts one continuous data block at _DATA_1DE20_ spanning through 0x1E14D.',
      '0x1DE9F lies inside that block; it is a map split, not a separate root pointer.',
      'Bank-alias disambiguation supersedes the earlier VDP-stream consumer claim for this bank-7 fragment.',
    ],
  },
  {
    regionId: 'r2719',
    offset: 0x1DEAF,
    type: 'data_table',
    role: 'pause_status_candidate_data_bundle_fragment',
    name: 'pause/status candidate data bundle fragment @ 0x1DEAF',
    confidence: 'medium',
    summary: 'Internal mapped fragment inside the _DATA_1DE20_ candidate data bundle; not a confirmed VDP stream root.',
    evidence: [
      'ASM line 28554 starts one continuous data block at _DATA_1DE20_ spanning through 0x1E14D.',
      '0x1DEAF lies inside that block; it is a map split, not a separate root pointer.',
      'Bank-alias disambiguation supersedes the earlier VDP-stream consumer claim for this bank-7 fragment.',
    ],
  },
  {
    regionId: 'r2720',
    offset: 0x1DF2A,
    type: 'data_table',
    role: 'pause_status_candidate_data_bundle_fragment',
    name: 'pause/status candidate data bundle fragment @ 0x1DF2A',
    confidence: 'medium',
    summary: 'Final mapped fragment inside the _DATA_1DE20_ candidate data bundle; not a confirmed VDP stream root.',
    evidence: [
      'ASM line 28554 starts one continuous data block at _DATA_1DE20_ spanning through 0x1E14D.',
      '0x1DF2A lies inside that block; it is a map split, not a separate root pointer.',
      'Bank-alias disambiguation supersedes the earlier VDP-stream consumer claim for this bank-7 fragment.',
    ],
  },
  {
    regionId: 'r2747',
    offset: 0x1DD66,
    type: 'data_table',
    role: 'pause_status_vdp_destination_word_payload',
    name: 'pause/status VDP destination word payload @ 0x1DD66',
    confidence: 'medium',
    summary: 'Word-shaped payload adjacent to the secondary stream pointer table; likely VDP destinations or offsets, but exact consumer remains to be traced.',
    evidence: [
      'ASM lines 28531-28542 define the 0x1DD66-0x1DE03 payload immediately after _DATA_1DD64_.',
      'The payload is word-shaped and adjacent to the pause/status secondary VDP stream pointer table, but no exact executable consumer has been isolated yet.',
    ],
  },
  {
    regionId: 'r2715',
    offset: 0x1DE04,
    type: 'pointer_table',
    role: 'pause_status_ram_buffer_pointer_record',
    name: '_DATA_1DE04_ pause/status RAM buffer pointer record',
    confidence: 'high',
    summary: 'Pointer-like record targeting $2000 | _RAM_C10E_ in the pause/status data area.',
    evidence: [
      'ASM lines 28544-28546 define _DATA_1DE04_ as .dw $2000 | _RAM_C10E_.',
    ],
  },
  {
    regionId: 'r2748',
    offset: 0x1DE06,
    type: 'data_table',
    role: 'pause_status_ram_buffer_payload',
    name: 'pause/status RAM buffer payload @ 0x1DE06',
    confidence: 'medium',
    summary: 'Small word-shaped payload immediately after the _RAM_C10E_ pointer record.',
    evidence: [
      'ASM lines 28548-28550 define the 0x1DE06-0x1DE1F payload immediately after _DATA_1DE04_.',
    ],
  },
];

const routines = [
  {
    regionId: 'r2561',
    role: 'vdp_stream_state_dispatch',
    name: '_LABEL_96FE_ VDP stream state dispatch',
    confidence: 'high',
    summary: 'Selects a VDP stream pointer from _RAM_D15A_ when state bit 7 is set, otherwise waits on _RAM_D15E_.',
    evidence: [
      'ASM lines 19391-19408 index _RAM_D15A_ by _RAM_D15D_ and fall through to _LABEL_972B_.',
      'ASM lines 19410-19420 decrement _RAM_D15E_ and resume from _RAM_D170_.',
    ],
  },
  {
    regionId: 'r2562',
    role: 'vdp_stream_pointer_loader',
    name: '_LABEL_972B_ VDP stream pointer loader',
    confidence: 'high',
    summary: 'Loads delay/count and three stream pointers into _RAM_D176_, _RAM_D180_, and _RAM_D182_, with F1+ control dispatch.',
    evidence: [
      'ASM lines 19421-19433 read one byte and three pointers, storing them in _RAM_D176_, _RAM_D180_, _RAM_D182_, and _RAM_D170_.',
      'ASM lines 19436-19441 dispatch F1+ control bytes through the local jump table.',
    ],
  },
  {
    regionId: 'r2569',
    role: 'vdp_stream_pointer_record_reader',
    name: '_LABEL_97D9_ VDP stream pointer-record reader',
    confidence: 'high',
    summary: 'Reads destination-offset records from _RAM_D176_ and terminates on a zero record.',
    evidence: [
      'ASM lines 19538-19549 load HL from _RAM_D176_, read a word, and return when it is zero.',
    ],
  },
  {
    regionId: 'r2570',
    role: 'vdp_stream_destination_resolver',
    name: '_LABEL_97E6_ VDP stream destination resolver',
    confidence: 'high',
    summary: 'Adds stream destination offsets to _RAM_D17A_/_RAM_D17B_ and stores the resolved VDP destination in _RAM_D178_.',
    evidence: [
      'ASM lines 19554-19566 read a destination offset, add _RAM_D17A_/_RAM_D17B_, and store DE in _RAM_D178_.',
    ],
  },
  {
    regionId: 'r2572',
    role: 'vdp_stream_tile_word_writer',
    name: '_LABEL_9812_ VDP stream tile-word writer',
    confidence: 'high',
    summary: 'Writes two-byte tile/name-table words to Port_VDPData until an F0+ control byte is encountered.',
    evidence: [
      'ASM lines 19583-19612 compare stream bytes against 0xF0 and write tile words or blank words to Port_VDPData.',
    ],
  },
  {
    regionId: 'r2573',
    role: 'vdp_stream_control_dispatch',
    name: '_LABEL_9861_ VDP stream control dispatch',
    confidence: 'high',
    summary: 'Handles F0+ stream controls for termination, next row, destination advance, pointer reload, and blank runs.',
    evidence: [
      'ASM lines 19648-19684 decode F0+ control bytes and either terminate, advance row, adjust destination, reload a pointer, or write blank runs.',
    ],
  },
  {
    regionId: 'r2574',
    role: 'vdp_stream_next_row',
    name: '_LABEL_9892_ VDP stream next-row handler',
    confidence: 'high',
    summary: 'Advances _RAM_D178_ by 0x40 and resumes the active VDP stream.',
    evidence: [
      'ASM lines 19686-19695 add 0x40 to _RAM_D178_ and jump back to the destination-range check.',
    ],
  },
  {
    regionId: 'r2575',
    role: 'vdp_stream_next_pointer_record',
    name: '_LABEL_98A5_ VDP stream next pointer-record handler',
    confidence: 'high',
    summary: 'Returns from the active stream segment and resumes pointer-record scanning at _LABEL_97D9_.',
    evidence: [
      'ASM lines 19697-19699 pop the pointer-list HL and jump back to _LABEL_97D9_.',
    ],
  },
];

const ramRoles = [
  {
    address: '$D176',
    role: 'vdp_stream_pointer_list',
    confidence: 'high',
    summary: 'Word pointer to the active VDP stream pointer-record list.',
    evidence: [
      'ASM lines 19421-19433 store the first stream pointer in _RAM_D176_.',
      'ASM lines 19538-19549 load HL from _RAM_D176_ and scan pointer records.',
    ],
  },
  {
    address: '$D178',
    role: 'vdp_stream_current_destination_low',
    confidence: 'high',
    summary: 'Low byte of the resolved current VDP destination.',
    evidence: [
      'ASM lines 19554-19566 store the resolved destination in _RAM_D178_.',
      'ASM lines 19686-19695 advance _RAM_D178_ by 0x40 for the next row.',
    ],
  },
  {
    address: '$D179',
    role: 'vdp_stream_current_destination_high',
    confidence: 'high',
    summary: 'High byte of the resolved current VDP destination.',
    evidence: [
      'ASM lines 19554-19566 store the resolved destination word in _RAM_D178_/_RAM_D179_.',
    ],
  },
  {
    address: '$D17A',
    role: 'vdp_stream_base_destination_low',
    confidence: 'high',
    summary: 'Low byte of the base VDP destination added to stream-local offsets.',
    evidence: [
      'ASM lines 19500-19503 compute _RAM_D17A_/_RAM_D17B_ from scroll/state.',
      'ASM lines 19559-19564 add _RAM_D17A_/_RAM_D17B_ to the stream-local destination offset.',
    ],
  },
  {
    address: '$D17B',
    role: 'vdp_stream_base_destination_high',
    confidence: 'high',
    summary: 'High byte of the base VDP destination added to stream-local offsets.',
    evidence: [
      'ASM lines 19500-19503 compute _RAM_D17A_/_RAM_D17B_ from scroll/state.',
      'ASM lines 19559-19564 add _RAM_D17A_/_RAM_D17B_ to the stream-local destination offset.',
    ],
  },
  {
    address: '$D180',
    role: 'vdp_stream_secondary_pointer_a',
    confidence: 'medium',
    summary: 'Second stream pointer loaded by _LABEL_972B_; later consumed by scripted/entity interaction code.',
    evidence: [
      'ASM lines 19429-19432 store the second and third pointers in _RAM_D180_ and _RAM_D182_.',
      'ASM lines 19840-19850 consume the pointer in _RAM_D180_.',
    ],
  },
  {
    address: '$D182',
    role: 'vdp_stream_secondary_pointer_b',
    confidence: 'medium',
    summary: 'Third stream pointer loaded by _LABEL_972B_; later consumed by scripted/entity interaction code.',
    evidence: [
      'ASM lines 19429-19432 store the second and third pointers in _RAM_D180_ and _RAM_D182_.',
      'ASM lines 19858-19870 consume the pointer in _RAM_D182_.',
    ],
  },
  {
    address: '$D170',
    role: 'vdp_stream_resume_pointer',
    confidence: 'high',
    summary: 'Resume pointer into the selected VDP stream program.',
    evidence: [
      'ASM lines 19420-19433 resume from _RAM_D170_ and store the new HL back to _RAM_D170_.',
    ],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => (entry.address || '').toUpperCase() === address.toUpperCase()) || null;
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

function buildCatalog(mapData) {
  const continuous = streamRegions.filter(item => item.type === 'vdp_stream');
  const candidateBundles = streamRegions.filter(item => item.role.includes('candidate') || item.role.includes('payload'));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-bank7-vdp-stream-audit.mjs',
    summary: {
      rootScreenPrograms: screenRoots.length,
      confirmedBank7StreamRegions: continuous.length,
      candidateOrPayloadRegions: candidateBundles.length,
      streamBytes: continuous.reduce((sum, item) => sum + ((findRegionById(mapData, item.regionId) || {}).size || 0), 0),
      pointerOrPayloadRegions: streamRegions.length - continuous.length,
      disambiguationStatus: 'bank_alias_conflict_not_confirmed_consumer',
      supersededBy: disambiguationCatalogId,
      routines: routines.length,
      ramVariables: ramRoles.length,
      assetPolicy: 'Metadata only: offsets, labels, pointer relations, candidate roles, RAM addresses, and evidence. No ROM bytes or rendered UI assets are embedded.',
    },
    roots: screenRoots.map(item => ({ ...item, offset: hex(item.offset), region: regionRef(findRegionById(mapData, item.regionId)) })),
    streamRegions: streamRegions.map(item => ({ ...item, offset: hex(item.offset), region: regionRef(findRegionById(mapData, item.regionId)) })),
    routines,
    ramRoles,
    evidence: [
      'ASM lines 1732-1746 select _DATA_1CCC0_ entries and call _LABEL_604_ for root screen-program rendering.',
      'ASM lines 19421-19433 load VDP stream pointers into _RAM_D176_, _RAM_D180_, and _RAM_D182_.',
      'ASM lines 19538-19612 resolve VDP destinations and write two-byte tile/name-table words to Port_VDPData.',
      'ASM lines 19648-19699 decode F0+ stream controls and continue through pointer records.',
      'ASM lines 28527-28554 point _DATA_1DD64_ at _DATA_1DE20_, but the bank-7 runtime consumer is not confirmed.',
      `${disambiguationCatalogId} resolves the known 0x9D64 VDP-stream state references to bank-2 ROM 0x09D64, not bank-7 ROM 0x1DD64.`,
    ],
    nextLeads: [
      'Decode the exact F0-F? control meanings in _LABEL_9812_/_LABEL_9861_ into a browser-side VDP stream previewer.',
      'Trace any bank-7-specific path that feeds _DATA_1DD64_ or _DATA_1DE20_ into _RAM_D176_ or _LABEL_998_; current 0x9D64 evidence is a bank-2 alias.',
      'Keep the four mapped _DATA_1DE20_ fragments as candidate data-bundle pieces until a real bank-7 consumer is traced.',
    ],
  };
}

function annotateRegion(region, item, analysisKey) {
  const before = regionRef(region);
  const previousType = region.type || 'unknown';
  const isDisambiguatedPauseStatus = (item.role || '').startsWith('pause_status_');
  if (item.type && previousType !== item.type) region.type = item.type;
  if (item.name && (!region.name || /^_DATA_|^pause\/status data fragment|secondary VDP stream/.test(region.name))) {
    region.name = item.name;
  }
  if (item.confidence && !region.confidence) region.confidence = item.confidence;
  region.analysis = region.analysis || {};
  region.analysis[analysisKey] = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: previousType,
    typeAfterAudit: region.type || previousType,
    changedType: previousType !== (region.type || previousType),
    summary: item.summary,
    evidence: item.evidence,
    disambiguationStatus: isDisambiguatedPauseStatus ? 'bank_alias_conflict_not_confirmed_consumer' : null,
    supersededBy: isDisambiguatedPauseStatus ? disambiguationCatalogId : null,
    supersededReason: isDisambiguatedPauseStatus
      ? 'Known 0x9D64 VDP stream-state references resolve to bank-2 ROM 0x09D64 inside r0186, not bank-7 ROM 0x1DD64; no confirmed _RAM_D176_ feed or _LABEL_998_ call for this bank-7 data is currently traced.'
      : null,
    generatedAt: now,
    tool: 'tools/world-bank7-vdp-stream-audit.mjs',
  };
  if (region.analysis.bank7PauseDataAudit && item.type === 'vdp_stream') {
    region.analysis.bank7PauseDataAudit.supersededBy = catalogId;
    region.analysis.bank7PauseDataAudit.supersededReason = 'Runtime VDP stream interpreter evidence now classifies this _DATA_1DE20_ fragment as vdp_stream rather than generic data_table.';
  }
  return {
    before,
    after: regionRef(region),
    role: item.role,
    confidence: item.confidence,
    changedType: previousType !== (region.type || previousType),
  };
}

function annotateRamEntry(entry, role) {
  const before = {
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || '',
    name: entry.name || '',
    notes: entry.notes || '',
  };
  entry.analysis = entry.analysis || {};
  entry.analysis.bank7VdpStreamAudit = {
    catalogId,
    kind: role.role,
    confidence: role.confidence,
    summary: role.summary,
    evidence: role.evidence,
    generatedAt: now,
    tool: 'tools/world-bank7-vdp-stream-audit.mjs',
  };
  return {
    before,
    after: {
      address: entry.address,
      size: entry.size || 0,
      type: entry.type || '',
      name: entry.name || '',
      notes: entry.notes || '',
    },
    role: role.role,
    confidence: role.confidence,
  };
}

function applyAnnotations(mapData) {
  const changedRegions = [];
  const missingRegions = [];
  const changedRam = [];
  const missingRam = [];

  for (const item of screenRoots) {
    const region = findRegionById(mapData, item.regionId);
    if (!region) {
      missingRegions.push({ id: item.regionId, offset: hex(item.offset), role: item.role });
      continue;
    }
    changedRegions.push(annotateRegion(region, item, 'bank7VdpStreamAudit'));
  }

  for (const item of streamRegions) {
    const region = findRegionById(mapData, item.regionId);
    if (!region) {
      missingRegions.push({ id: item.regionId, offset: hex(item.offset), role: item.role });
      continue;
    }
    changedRegions.push(annotateRegion(region, item, 'bank7VdpStreamAudit'));
  }

  for (const item of routines) {
    const region = findRegionById(mapData, item.regionId);
    if (!region) {
      missingRegions.push({ id: item.regionId, role: item.role });
      continue;
    }
    changedRegions.push(annotateRegion(region, item, 'bank7VdpStreamAudit'));
  }

  for (const role of ramRoles) {
    const entry = findRam(mapData, role.address);
    if (!entry) {
      missingRam.push({ address: role.address, role: role.role });
      continue;
    }
    changedRam.push(annotateRamEntry(entry, role));
  }

  return { changedRegions, missingRegions, changedRam, missingRam };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let changes = { changedRegions: [], missingRegions: [], changedRam: [], missingRam: [] };

  if (apply) {
    changes = applyAnnotations(mapData);
    const finalCatalog = buildCatalog(mapData);
    mapData.vdpStreamCatalogs = (mapData.vdpStreamCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpStreamCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank7_vdp_stream_audit',
      generatedAt: now,
      tool: 'tools/world-bank7-vdp-stream-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changes.changedRegions.length,
        changedRegionTypes: changes.changedRegions.filter(item => item.changedType).length,
        missingRegions: changes.missingRegions.length,
        annotatedRamEntries: changes.changedRam.length,
        missingRamEntries: changes.missingRam.length,
      },
      changedRegions: changes.changedRegions,
      missingRegions: changes.missingRegions,
      annotatedRamEntries: changes.changedRam,
      missingRamEntries: changes.missingRam,
      evidence: finalCatalog.evidence,
      nextLeads: finalCatalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    streamRegions: catalog.streamRegions.map(item => ({
      regionId: item.regionId,
      offset: item.offset,
      type: item.type,
      role: item.role,
      confidence: item.confidence,
    })),
    routines: catalog.routines.map(item => ({
      regionId: item.regionId,
      role: item.role,
      confidence: item.confidence,
    })),
    ramRoles: catalog.ramRoles.map(item => ({
      address: item.address,
      role: item.role,
      confidence: item.confidence,
    })),
    changes,
  }, null, 2));
}

main();
