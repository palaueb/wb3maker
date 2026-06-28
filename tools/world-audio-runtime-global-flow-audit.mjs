#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const asmPath = path.join(repoRoot, "projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm");
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-audio-runtime-global-flow-catalog-2026-06-25';
const reportId = 'audio-runtime-global-flow-audit-2026-06-25';
const toolName = 'tools/world-audio-runtime-global-flow-audit.mjs';

const ramStateCatalogId = 'world-audio-ram-state-catalog-2026-06-25';
const outputGlobalInputCatalogId = 'world-audio-output-global-input-catalog-2026-06-25';

const SITES = [
  {
    id: 'c232_detect_no_fm_write_zero',
    role: 'audio_output_mode_select',
    address: '$C232',
    access: 'write',
    line: 1245,
    routineLabel: '_LABEL_237_',
    routineOffset: 0x00237,
    expectedText: 'ld (_RAM_C232_), a',
    owner: 'hardware_fm_detector',
    valueModel: 'writes $00 on the non-FM path before clearing Port_AudioControl',
    confidence: 'high',
  },
  {
    id: 'c232_detect_result_write',
    role: 'audio_output_mode_select',
    address: '$C232',
    access: 'write',
    line: 1287,
    routineLabel: '_LABEL_237_',
    routineOffset: 0x00237,
    expectedText: 'ld (_RAM_C232_), a',
    owner: 'hardware_fm_detector',
    valueModel: 'writes $00 or $01 from the FM detection probe result',
    confidence: 'high',
  },
  {
    id: 'c232_pair_slot_scheduler_read',
    role: 'audio_output_mode_select',
    address: '$C232',
    access: 'read',
    line: 14353,
    routineLabel: '_LABEL_61CE_',
    routineOffset: 0x061CE,
    expectedText: 'ld a, (_RAM_C232_)',
    owner: 'pair_slot_scheduler',
    valueModel: 'bit 0 selects command $37 versus $38 before calling the bank-3 sound command wrapper',
    confidence: 'medium',
  },
  {
    id: 'c232_frame_update_dispatch_read',
    role: 'audio_output_mode_select',
    address: '$C232',
    access: 'read',
    line: 21769,
    routineLabel: '_LABEL_C09F_',
    routineOffset: 0x0C0A5,
    expectedText: 'ld a, (_RAM_C232_)',
    owner: 'audio_frame_update_dispatch',
    valueModel: 'bit 0 selects PSG output routine _LABEL_C4C1_ versus FM output routine _LABEL_C78F_',
    confidence: 'high',
  },
  {
    id: 'c232_note_rest_volume_mirror_read',
    role: 'audio_output_mode_select',
    address: '$C232',
    access: 'read',
    line: 22086,
    routineLabel: '_LABEL_C339_',
    routineOffset: 0x0C339,
    expectedText: 'ld a, (_RAM_C232_)',
    owner: 'note_rest_volume_mirror',
    valueModel: 'bit 0 selects direct stream volume versus adding shared $C23C bias before clamping IY+1',
    confidence: 'high',
  },
  {
    id: 'c23c_palette_fade_clear',
    role: 'psg_volume_bias_shared_byte',
    address: '$C23C',
    access: 'write',
    line: 2126,
    routineLabel: '_LABEL_849_',
    routineOffset: 0x00849,
    expectedText: 'ld (_RAM_C23C_), a',
    owner: 'palette_fade_state',
    valueModel: 'clears the shared byte after the fade-in palette loop',
    confidence: 'medium',
  },
  {
    id: 'c23c_palette_marker_lookup_write',
    role: 'psg_volume_bias_shared_byte',
    address: '$C23C',
    access: 'write',
    line: 2148,
    routineLabel: '_LABEL_881_',
    routineOffset: 0x00881,
    expectedText: 'ld (_RAM_C23C_), a',
    owner: 'palette_cycle_marker',
    valueModel: 'writes a marker from the 16-byte lookup immediately following _LABEL_881_',
    confidence: 'medium',
  },
  {
    id: 'c23c_sound_wrapper_clear',
    role: 'psg_volume_bias_shared_byte',
    address: '$C23C',
    access: 'write',
    line: 3288,
    routineLabel: '_LABEL_104B_',
    routineOffset: 0x0104B,
    expectedText: 'ld (_RAM_C23C_), a',
    owner: 'bank3_sound_command_wrapper',
    valueModel: 'clears the shared byte after the bank-3 sound command wrapper returns',
    confidence: 'high',
  },
  {
    id: 'c23c_finale_entry_clear',
    role: 'psg_volume_bias_shared_byte',
    address: '$C23C',
    access: 'write',
    line: 21285,
    routineLabel: '_LABEL_BE0B_',
    routineOffset: 0x0BE0B,
    expectedText: 'ld (_RAM_C23C_), a',
    owner: 'finale_starfield_entry',
    valueModel: 'clears the shared byte before the finale/starfield countdown loop',
    confidence: 'medium',
  },
  {
    id: 'c23c_finale_countdown_compare',
    role: 'psg_volume_bias_shared_byte',
    address: '$C23C',
    access: 'read',
    line: 21462,
    routineLabel: '_LABEL_BF35_',
    routineOffset: 0x0BF35,
    expectedText: 'ld a, (_RAM_C23C_)',
    owner: 'finale_music_countdown',
    valueModel: 'compares the shared byte against $0C before incrementing or issuing a sound command',
    confidence: 'medium',
  },
  {
    id: 'c23c_finale_countdown_increment',
    role: 'psg_volume_bias_shared_byte',
    address: '$C23C',
    access: 'write',
    line: 21466,
    routineLabel: '_LABEL_BF35_',
    routineOffset: 0x0BF35,
    expectedText: 'ld (_RAM_C23C_), a',
    owner: 'finale_music_countdown',
    valueModel: 'increments the shared byte until the $0C threshold is reached',
    confidence: 'medium',
  },
  {
    id: 'c23c_note_rest_volume_mirror_read',
    role: 'psg_volume_bias_shared_byte',
    address: '$C23C',
    access: 'read',
    line: 22091,
    routineLabel: '_LABEL_C339_',
    routineOffset: 0x0C339,
    expectedText: 'ld a, (_RAM_C23C_)',
    owner: 'note_rest_volume_mirror',
    valueModel: 'adds the shared byte to the stream volume field before clamping IY+1',
    confidence: 'high',
  },
  {
    id: 'c23c_psg_volume_envelope_read',
    role: 'psg_volume_bias_shared_byte',
    address: '$C23C',
    access: 'read',
    line: 22398,
    routineLabel: '_LABEL_C5F6_',
    routineOffset: 0x0C5F6,
    expectedText: 'ld a, (_RAM_C23C_)',
    owner: 'psg_volume_envelope_write',
    valueModel: 'adds the shared byte to the computed PSG attenuation before writing Port_PSG',
    confidence: 'high',
  },
  {
    id: 'c23c_psg_volume_refresh_read',
    role: 'psg_volume_bias_shared_byte',
    address: '$C23C',
    access: 'read',
    line: 22428,
    routineLabel: '_LABEL_C656_',
    routineOffset: 0x0C656,
    expectedText: 'ld a, (_RAM_C23C_)',
    owner: 'psg_volume_refresh_write',
    valueModel: 'adds the shared byte to cached PSG attenuation before writing Port_PSG',
    confidence: 'high',
  },
  {
    id: 'c23c_psg_envelope_release_read',
    role: 'psg_volume_bias_shared_byte',
    address: '$C23C',
    access: 'read',
    line: 22570,
    routineLabel: '_LABEL_C748_',
    routineOffset: 0x0C748,
    expectedText: 'ld a, (_RAM_C23C_)',
    owner: 'psg_envelope_release_write',
    valueModel: 'adds the shared byte to release/envelope attenuation before writing Port_PSG',
    confidence: 'high',
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegionForOffset(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = Number(region.offset);
    const size = Number(region.size) || 0;
    return Number.isFinite(start) && offset >= start && offset < start + size;
  }) || null;
}

function globalRamByRole(ramCatalog, role) {
  return (ramCatalog.globalRam || []).find(item => item.role === role) || null;
}

function outputGlobalInputByRole(outputCatalog, role) {
  return (outputCatalog.globalInputs || []).find(item => item.role === role) || null;
}

function hex5(value) {
  return '0x' + value.toString(16).toUpperCase().padStart(5, '0');
}

function buildCatalog(mapData, asmText) {
  const ramCatalog = requireCatalog(mapData, ramStateCatalogId);
  const outputGlobalInputCatalog = requireCatalog(mapData, outputGlobalInputCatalogId);
  const asmLines = asmText.split(/\r?\n/);
  const validationIssues = [];

  const sites = SITES.map(site => {
    const sourceLine = asmLines[site.line - 1] || '';
    if (!sourceLine.includes(site.expectedText)) {
      validationIssues.push(`${site.id} expected "${site.expectedText}" at ASM line ${site.line}, got "${sourceLine.trim()}"`);
    }
    const region = findRegionForOffset(mapData, site.routineOffset);
    if (!region) validationIssues.push(`${site.id} has no mapped region for ${hex5(site.routineOffset)}`);
    return {
      ...site,
      routineOffset: hex5(site.routineOffset),
      asmLineText: sourceLine.trim(),
      region: region ? {
        id: region.id,
        offset: region.offset,
        size: region.size,
        type: region.type || '',
        name: region.name || '',
      } : null,
      evidence: [
        `ASM line ${site.line}: ${sourceLine.trim()}`,
        region ? `Mapped code region ${region.id} at ${region.offset} (${region.name || region.type || 'code'}).` : 'No mapped code region found.',
      ],
    };
  });

  const roles = [...new Set(sites.map(site => site.role))];
  const globalFlows = roles.map(role => {
    const roleSites = sites.filter(site => site.role === role);
    const writes = roleSites.filter(site => site.access === 'write');
    const reads = roleSites.filter(site => site.access === 'read');
    const ram = globalRamByRole(ramCatalog, role);
    const outputGlobalInput = outputGlobalInputByRole(outputGlobalInputCatalog, role);
    const ownerCounts = {};
    for (const site of roleSites) ownerCounts[site.owner] = (ownerCounts[site.owner] || 0) + 1;
    return {
      role,
      address: ram?.address || roleSites[0]?.address || '',
      ramCatalogEntryId: ram?.ram?.id || '',
      outputGlobalInputModelingStatus: outputGlobalInput?.modelingStatus || '',
      flowStatus: role === 'audio_output_mode_select'
        ? 'hardware_detection_source_identified_value_not_simulated'
        : 'shared_runtime_byte_sources_identified_value_not_simulated',
      summary: role === 'audio_output_mode_select'
        ? 'FM detection writes $C232; audio frame/update paths read bit 0 to select PSG versus FM dispatch and note/rest volume mirror behavior.'
        : '$C23C is written by palette/finale/audio wrapper paths and read by PSG volume output paths as a shared attenuation bias.',
      accessSummary: {
        siteCount: roleSites.length,
        writeSiteCount: writes.length,
        readSiteCount: reads.length,
        ownerCounts,
        uniqueRegionCount: new Set(roleSites.map(site => site.region?.id).filter(Boolean)).size,
      },
      writerSites: writes,
      readerSites: reads,
      evidence: [
        `${ramStateCatalogId} supplies the role/address for ${role}.`,
        `${outputGlobalInputCatalogId} records how this role appears in the output timeline diagnostics.`,
        'This catalog validates each listed ASM line against the current disassembly before applying.',
      ],
      remainingModelingNeed: role === 'audio_output_mode_select'
        ? 'Model the hardware detection result and propagate bit 0 through audio preview state before resolving $C232-dependent branches.'
        : 'Model or intentionally scope the shared non-audio writers before resolving $C23C attenuation bias in audio previews.',
      confidence: role === 'audio_output_mode_select' ? 'high' : 'medium',
    };
  });

  const siteRegions = new Set(sites.map(site => site.region?.id).filter(Boolean));
  const catalog = {
    id: catalogId,
    generatedAt: now,
    tool: toolName,
    sourceCatalogIds: [
      ramStateCatalogId,
      outputGlobalInputCatalogId,
    ],
    assetPolicy: 'metadata_only_no_rom_bytes_no_runtime_values_no_audio_samples',
    summary: {
      globalRoleCount: globalFlows.length,
      accessSiteCount: sites.length,
      writeSiteCount: sites.filter(site => site.access === 'write').length,
      readSiteCount: sites.filter(site => site.access === 'read').length,
      mappedRegionCount: siteRegions.size,
      validationIssueCount: validationIssues.length,
    },
    globalFlows,
    validationIssues,
    notes: [
      'ASM line text is stored only as short instruction-level evidence, not ROM bytes or decoded audio data.',
      '$C23C remains marked as shared because confirmed non-audio and audio-adjacent routines write it.',
      '$C232 is a mode selector sourced from hardware detection; it should not be treated as a constant until the detection path is modeled.',
    ],
  };

  const report = {
    id: reportId,
    generatedAt: now,
    tool: toolName,
    catalogId,
    summary: catalog.summary,
    failures: validationIssues,
    evidence: [
      `Validated ${sites.length} ASM access site(s) for $C232/$C23C.`,
      `Linked access sites to ${siteRegions.size} mapped code region(s).`,
      'No runtime values, PSG/FM register traces, audio samples, or ROM bytes are persisted.',
    ],
    assetPolicy: catalog.assetPolicy,
  };

  return { catalog, report };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const { catalog, report } = buildCatalog(mapData, asmText);
  if (apply) {
    if (catalog.validationIssues.length) {
      throw new Error(`Refusing to apply ${catalog.validationIssues.length} validation issue(s).`);
    }
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push(report);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    validationIssues: catalog.validationIssues,
  }, null, 2));
}

main();
