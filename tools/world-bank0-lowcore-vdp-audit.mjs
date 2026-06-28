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
const catalogId = 'world-bank0-lowcore-vdp-catalog-2026-06-25';
const reportId = 'bank0-lowcore-vdp-audit-2026-06-25';
const toolName = 'tools/world-bank0-lowcore-vdp-audit.mjs';

function entry(offset, label, role, summary, options = {}) {
  return {
    offset,
    label,
    role,
    name: options.name || `${label} ${role.split('_').join(' ')}`,
    family: options.family || 'bank0_lowcore_vdp_runtime',
    confidence: options.confidence || 'high',
    calls: options.calls || [],
    ramRefs: options.ramRefs || [],
    ioPorts: options.ioPorts || [],
    table: options.table || null,
    summary,
    evidence: [
      `${label} is an ASM code label at ROM offset ${hex(offset)}.`,
      ...(options.evidence || []),
    ],
  };
}

const ENTRIES = [
  entry(0x00000, '_LABEL_0_', 'reset_vector', 'Reset vector disables interrupts, selects interrupt mode 1, and jumps to the boot routine at _LABEL_97_.', {
    name: 'RST 00 reset vector',
    calls: ['_LABEL_97_'],
    evidence: ['ASM lines 863-866 show DI, IM 1, then JP _LABEL_97_.'],
  }),
  entry(0x00008, '_LABEL_8_', 'rst08_word_index_to_hl_offset', 'RST 08 helper treats A as an index and adds A*2 to HL, preparing word table lookups.', {
    name: 'RST 08 word table index helper',
    evidence: ['ASM lines 873-878 load A into DE and add DE to HL twice before returning.'],
  }),
  entry(0x00010, '_LABEL_10_', 'rst10_read_word_to_de', 'RST 10 reads a little-endian word from (HL) into DE and advances HL past the word.', {
    name: 'RST 10 read word helper',
    evidence: ['ASM lines 883-888 load E and D from successive bytes at HL and increment HL twice.'],
  }),
  entry(0x00018, '_LABEL_18_', 'rst18_read_word_to_hl', 'RST 18 reads a word through RST 10, swaps DE into HL, and returns.', {
    name: 'RST 18 read word into HL helper',
    calls: ['_LABEL_10_'],
    evidence: ['ASM lines 893-896 call RST 10, exchange DE/HL, and return.'],
  }),
  entry(0x00020, '_LABEL_20_', 'rst20_jump_table_dispatch', 'RST 20 dispatches through a word table indexed by A by temporarily replacing the return address with the selected target.', {
    name: 'RST 20 jump table dispatcher',
    calls: ['_LABEL_8_', '_LABEL_18_'],
    evidence: ['ASM lines 901-908 exchange the return-address HL with stack state, index by A*2, read the target word, restore DE, and return through the selected address.'],
  }),
  entry(0x00028, '_LABEL_28_', 'rst28_vdp_address_port_write', 'RST 28 writes A to the SMS VDP address port and returns.', {
    name: 'RST 28 VDP address write',
    ioPorts: ['Port_VDPAddress'],
    evidence: ['ASM lines 913-915 output A to Port_VDPAddress.'],
  }),
  entry(0x00030, '_LABEL_30_', 'rst30_vdp_data_port_write', 'RST 30 writes A to the SMS VDP data port and returns.', {
    name: 'RST 30 VDP data write',
    ioPorts: ['Port_VDPData'],
    evidence: ['ASM lines 920-922 output A to Port_VDPData.'],
  }),
  entry(0x0029C, '_LABEL_29C_', 'vdp_register_boot_configuration', 'Copies the 20-byte VDP register setup table to the VDP address port and mirrors the values in _RAM_CF6C_.', {
    name: 'VDP register boot configuration',
    calls: ['_LABEL_28_'],
    ramRefs: ['_RAM_CF6C_'],
    ioPorts: ['Port_VDPAddress'],
    table: '_DATA_2AC_',
    evidence: ['ASM lines 1300-1315 iterate _DATA_2AC_, write each byte through RST 28, mirror it to _RAM_CF6C_, and return.'],
  }),
  entry(0x002C0, '_LABEL_2C0_', 'work_ram_clear_c100_to_ddff', 'Clears the main work-RAM range starting at _RAM_C100_ for 0x1DFE bytes.', {
    name: 'Work RAM cleaner',
    ramRefs: ['_RAM_C100_'],
    evidence: ['ASM lines 1318-1328 load HL=_RAM_C100_, BC=0x1DFE, zero each byte, and loop until BC is zero.'],
  }),
  entry(0x002CF, '_LABEL_2CF_', 'boot_state_change_dispatcher', 'State-change renderer that clears the background, refreshes palette/fade state, loads title/status tiles through _LABEL_8FB_, and branches according to _RAM_D278_.', {
    name: 'State change dispatcher',
    calls: ['_LABEL_556_', '_LABEL_DB5_', '_LABEL_8B2_', '_LABEL_8FB_', '_LABEL_10BC_', '_LABEL_FEE_', '_LABEL_5EB_', '_LABEL_849_', '_LABEL_D85_'],
    ramRefs: ['_RAM_D278_', '_RAM_CF65_', '_RAM_CF85_'],
    table: '_DATA_315_',
    evidence: ['ASM lines 1330-1364 show the state-change routine calling background clear, palette/fade helpers, _DATA_315_ through _LABEL_8FB_, and text stream _LABEL_5EB_ before branching on _RAM_D278_.'],
  }),
  entry(0x003E1, '_LABEL_3E1_', 'per_frame_runtime_flag_reset', 'Clears per-frame runtime flags and counters, then calls _LABEL_10A4_ for the related bank/runtime state update.', {
    name: 'Per-frame runtime flag reset',
    calls: ['_LABEL_10A4_'],
    ramRefs: ['_RAM_CF89_', '_RAM_CFF9_', '_RAM_CF6A_', '_RAM_CF8B_', '_RAM_D21C_', '_RAM_D246_'],
    evidence: ['ASM lines 1448-1457 clear _RAM_CF89_, _RAM_CFF9_, _RAM_CF6A_, _RAM_CF8B_, _RAM_D21C_, and _RAM_D246_ before calling _LABEL_10A4_.'],
  }),
  entry(0x00580, '_LABEL_580_', 'vram_name_table_fill_pair', 'Fills the main name table region from VRAM 0x7800 for 0x0380 tile pairs using the caller-supplied BC pair.', {
    name: 'VRAM name-table pair fill',
    calls: ['_LABEL_28_', '_LABEL_30_'],
    ramRefs: ['_RAM_CF82_'],
    ioPorts: ['Port_VDPAddress', 'Port_VDPData'],
    evidence: ['ASM lines 1641-1663 set HL=0x7800 and DE=0x0380, write the VDP address through RST 28, then emit B/C pairs through RST 30 while _RAM_CF82_ gates VDP work.'],
  }),
  entry(0x0059F, '_LABEL_59F_', 'vram_lower_name_table_fill_pair', 'Tail entry for _LABEL_580_ that fills the lower name-table subrange from VRAM 0x7880 for 0x0300 tile pairs.', {
    name: 'VRAM lower name-table pair fill',
    calls: ['_LABEL_580_'],
    ramRefs: ['_RAM_CF82_'],
    evidence: ['ASM lines 1666-1669 load HL=0x7880 and DE=0x0300, then jump into the shared _LABEL_580_ fill loop.'],
  }),
  entry(0x005A8, '_LABEL_5A8_', 'vram_zero_fill_at_hl_for_de', 'Writes zero bytes to VRAM starting at HL for DE bytes using the VDP data port.', {
    name: 'VRAM zero fill',
    calls: ['_LABEL_28_', '_LABEL_30_'],
    ioPorts: ['Port_VDPAddress', 'Port_VDPData'],
    evidence: ['ASM lines 1671-1684 set the VDP address from HL and repeatedly write zero through RST 30 until DE reaches zero.'],
  }),
  entry(0x005B6, '_LABEL_5B6_', 'oam_sentinel_write', 'Writes the SMS sprite/OAM Y sentinel 0xD0 at VRAM 0x7F00.', {
    name: 'OAM sentinel writer',
    calls: ['_LABEL_28_', '_LABEL_30_'],
    ioPorts: ['Port_VDPAddress', 'Port_VDPData'],
    evidence: ['ASM lines 1687-1697 set VRAM address 0x7F00 and write 0xD0 through RST 30.'],
  }),
  entry(0x005C3, '_LABEL_5C3_', 'decimal_digits_vdp_writer', 'Writes a fixed-width decimal digit field to the current VDP destination, using C and _RAM_D0DE_ as tile attributes and blank-padding leading zeroes.', {
    name: 'Decimal digit VDP writer',
    calls: ['_LABEL_28_', '_LABEL_30_'],
    ramRefs: ['_RAM_D0DE_'],
    ioPorts: ['Port_VDPAddress', 'Port_VDPData'],
    evidence: ['ASM lines 1699-1729 store A in _RAM_D0DE_, set the VDP destination from DE, blank leading zeroes with C/_RAM_D0DE_, and write digit tiles by adding 0x30.'],
  }),
  entry(0x005DE, '_LABEL_5DE_', 'decimal_digits_significant_tail', 'Shared significant-digit tail for _LABEL_5C3_, emitting digit tile plus attribute pairs until B digits have been written.', {
    name: 'Decimal digit significant-tail writer',
    calls: ['_LABEL_30_'],
    ramRefs: ['_RAM_D0DE_'],
    ioPorts: ['Port_VDPData'],
    evidence: ['ASM lines 1720-1729 show the tail adding 0x30 to each digit byte, writing the tile and _RAM_D0DE_ attribute through RST 30, and looping with DJNZ.'],
  }),
  entry(0x00609, '_LABEL_609_', 'vdp_text_stream_decoder_loop', 'Main byte loop for the bank-7 text/VDP stream decoder; bytes below 0xF0 are emitted as tile/attribute pairs and bytes 0xF0-0xF7 dispatch through the local opcode table.', {
    name: 'VDP text stream decoder loop',
    calls: ['_LABEL_20_', '_LABEL_30_'],
    ramRefs: ['_RAM_CF97_'],
    table: '_DATA_612_',
    evidence: ['ASM lines 1752-1767 read from BC, dispatch opcodes 0xF0-0xF7 through _DATA_612_ with RST 20, or write literal tile/_RAM_CF97_ pairs through RST 30.'],
  }),
  entry(0x00612, '_DATA_612_', 'mixed_vdp_stream_opcode_table_and_literal_writer', 'Mixed region containing the eight-entry VDP stream opcode dispatch table plus the inline literal tile writer that follows it before _LABEL_629_.', {
    name: 'VDP stream opcode table cluster',
    calls: ['_LABEL_30_'],
    ramRefs: ['_RAM_CF97_'],
    table: '_DATA_612_',
    confidence: 'high',
    evidence: ['ASM lines 1760-1767 mark the jump table from 0x0612 to 0x0621 and immediately continue with inline literal tile/attribute writes through RST 30 before branching back to _LABEL_609_.'],
  }),
  entry(0x00629, '_LABEL_629_', 'vdp_stream_opcode_f0_end', 'Opcode F0 terminator for the VDP stream decoder; clears _RAM_CF82_ and returns.', {
    name: 'VDP stream opcode F0 end',
    ramRefs: ['_RAM_CF82_'],
    evidence: ['ASM lines 1770-1773 show the first _DATA_612_ table entry clearing _RAM_CF82_ and returning.'],
  }),
  entry(0x00635, '_LABEL_635_', 'vdp_stream_opcode_f2_set_address', 'Opcode F2 handler for the VDP stream decoder; reads a two-byte VDP destination from the stream, mirrors it in _RAM_D0E0_/_RAM_D0E1_, and writes it to the VDP address port.', {
    name: 'VDP stream opcode F2 set address',
    calls: ['_LABEL_28_'],
    ramRefs: ['_RAM_D0E0_', '_RAM_D0E1_'],
    ioPorts: ['Port_VDPAddress'],
    evidence: ['ASM lines 1783-1794 read two stream bytes into _RAM_D0E0_/_RAM_D0E1_, write both through RST 28, and resume _LABEL_609_.'],
  }),
  entry(0x00645, '_LABEL_645_', 'vdp_stream_opcode_f3_emit_literal_with_attribute', 'Opcode F3 handler that emits one stream byte as a tile followed by the current _RAM_CF97_ attribute.', {
    name: 'VDP stream opcode F3 single emit',
    calls: ['_LABEL_30_'],
    ramRefs: ['_RAM_CF97_'],
    ioPorts: ['Port_VDPData'],
    evidence: ['ASM lines 1797-1803 read one byte from the stream, output it through RST 30, output _RAM_CF97_, and resume _LABEL_609_.'],
  }),
  entry(0x0064E, '_LABEL_64E_', 'vdp_stream_opcode_f4_pointer_jump', 'Opcode F4 handler that replaces the stream pointer BC with a two-byte address read from the stream.', {
    name: 'VDP stream opcode F4 pointer jump',
    evidence: ['ASM lines 1806-1813 read two bytes from the current stream and assign them to BC before jumping back to _LABEL_609_.'],
  }),
  entry(0x00656, '_LABEL_656_', 'vdp_stream_opcode_f5_repeat_tile', 'Opcode F5 handler that repeats a tile/attribute pair for a count read from the stream.', {
    name: 'VDP stream opcode F5 repeat tile',
    calls: ['_LABEL_30_'],
    ramRefs: ['_RAM_CF97_'],
    ioPorts: ['Port_VDPData'],
    evidence: ['ASM lines 1816-1830 read repeat count and tile, then emit tile/_RAM_CF97_ pairs through RST 30 until the count reaches zero.'],
  }),
  entry(0x00668, '_LABEL_668_', 'vdp_stream_opcode_f6_page_scroll_wait', 'Opcode F6 handler that performs a paged text/scroll transition, temporarily switching to bank 2, calling the bank-2 routine _LABEL_BE97_, waiting through _LABEL_FF9_, then clearing part of the destination line.', {
    name: 'VDP stream opcode F6 page scroll wait',
    calls: ['_LABEL_BE97_', '_LABEL_FF9_', '_LABEL_28_', '_LABEL_30_'],
    ramRefs: ['_RAM_D0E0_', '_RAM_D0E2_', '_RAM_CF83_', '_RAM_CF8D_', '_RAM_CFE1_', '_RAM_CF82_', '_RAM_FFFF_'],
    ioPorts: ['Port_VDPAddress', 'Port_VDPData'],
    evidence: ['ASM lines 1833-1905 show the F6 handler advancing _RAM_D0E0_, animating scroll via _RAM_CF8D_/_RAM_CFE1_, switching _RAM_FFFF_ to bank 2 for _LABEL_BE97_, waiting with _LABEL_FF9_, clearing 0x20 tile pairs, and resuming _LABEL_609_.'],
  }),
  entry(0x00822, '_LABEL_822_', 'palette_fade_out_sequence', 'Fade-out sequence that repeatedly updates the palette fade step in _RAM_CFDB_, rebuilds CRAM shadow values through _LABEL_7EC_, requests CRAM upload with _RAM_CFE2_, and waits frames through _LABEL_FEE_.', {
    name: 'Palette fade out sequence',
    calls: ['_LABEL_7EC_', '_LABEL_FEE_', '_LABEL_881_', '_LABEL_D94_'],
    ramRefs: ['_RAM_CFFD_', '_RAM_CFDB_', '_RAM_CFE2_'],
    evidence: ['ASM lines 2079-2099 show _LABEL_822_ stepping _RAM_CFDB_ from 1 through 3, calling _LABEL_7EC_, setting _RAM_CFE2_, waiting through _LABEL_FEE_, calling _LABEL_881_, and ending via _LABEL_D94_.'],
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
  const keys = Object.keys(region.analysis || {}).filter(key => key !== 'bank0LowcoreVdpAudit');
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
      rstVectorCount: ENTRIES.filter(item => item.role.startsWith('rst') || item.role === 'reset_vector').length,
      vdpStreamEntryCount: ENTRIES.filter(item => item.family === 'bank0_lowcore_vdp_runtime' && item.role.includes('vdp_stream')).length,
      assetPolicy: 'Metadata only: ASM labels, offsets, helper roles, RAM/port references, calls, and evidence. No ROM bytes, decoded graphics, or text payloads are embedded.',
    },
    entries: ENTRIES.map(item => ({
      ...item,
      offset: hex(item.offset),
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    evidence: [
      'ASM lines 863-922 define the reset/RST helper vectors used throughout the ROM.',
      'ASM lines 1300-1364 define boot VDP/RAM/state-change helpers that call known loader routines such as _LABEL_8FB_.',
      'ASM lines 1641-1905 define the VDP fill helpers and _LABEL_604_ stream decoder opcode fragments.',
      'ASM lines 2079-2099 define the palette fade-out sequence.',
    ],
  };
}

function annotateRegion(region, item) {
  const inferredOnlyBeforeAudit = wasInferredOnlyBeforeThisAudit(region);
  if (!region.name) region.name = item.name;
  if (!region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank0LowcoreVdpAudit = {
    catalogId,
    kind: item.role,
    family: item.family,
    label: item.label,
    confidence: item.confidence,
    calls: item.calls,
    ramRefs: item.ramRefs,
    ioPorts: item.ioPorts,
    table: item.table,
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
    mapData.bank0LowcoreVdpCatalogs = (mapData.bank0LowcoreVdpCatalogs || []).filter(catalog => catalog.id !== catalogId);
    mapData.bank0LowcoreVdpCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank0_lowcore_vdp_audit',
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
        'Split mixed region 0x00612 into a pure pointer-table subrecord and inline literal-writer code once the region model supports nested code/data spans cleanly.',
        'Promote the RST helper semantics into shared/sms/mapper or shared/sms/vdp helpers only after call sites are fully audited.',
        'Use the _LABEL_604_ stream-opcode catalog to decode bank-7 text/VDP streams without embedding the text bytes.',
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
