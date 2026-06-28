#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-runtime-ram-trace-seed-audit.mjs';
const catalogId = 'world-runtime-ram-trace-seed-catalog-2026-06-26';
const reportId = 'runtime-ram-trace-seed-audit-2026-06-26';
const schemaVersion = 1;
const ramVariableCatalogId = 'world-runtime-ram-variable-index-catalog-2026-06-26';
const runtimeMechanicCatalogId = 'world-runtime-mechanic-index-catalog-2026-06-26';

const seedDefs = [
  {
    label: '_RAM_C24F_',
    address: '$C24F',
    traceRole: 'player_form_outer_state_seed',
    roleConfidence: 'high_from_existing_catalogs',
    mechanicFocus: ['player_movement_physics', 'collision_damage', 'room_transition_state', 'rendering_vdp_pipeline'],
    engineTargets: ['shared/wb3/player-state.js', 'shared/wb3/player-physics.js', 'shared/wb3/sprites.js'],
    sourceCatalogIds: [
      'world-player-state-catalog-2026-06-24',
      'world-player-form-catalog-2026-06-24',
      'world-player-engine-state-graph-catalog-2026-06-25',
      'world-cf6a-request3-form-transition-catalog-2026-06-25',
      'world-cf5b-form-stage-progression-catalog-2026-06-25',
    ],
    traceQuestions: [
      'Which runtime path owns each form/state write during normal play, password restore, request-3 transformation, and finale form parade?',
      'Which _RAM_C260_ inner-state values are valid for each _RAM_C24F_ outer form dispatcher?',
      'Which graphics/animation records are selected only by form changes and which are selected every frame?',
    ],
  },
  {
    label: '_RAM_C260_',
    address: '$C260',
    traceRole: 'player_inner_state_machine_seed',
    roleConfidence: 'high_from_existing_catalogs',
    mechanicFocus: ['player_movement_physics', 'collision_damage', 'room_transition_state'],
    engineTargets: ['shared/wb3/player-state.js', 'shared/wb3/player-physics.js'],
    sourceCatalogIds: [
      'world-player-state-catalog-2026-06-24',
      'world-player-engine-state-graph-catalog-2026-06-25',
      'world-player-state-physics-flow-catalog-2026-06-25',
      'world-cf6a-request3-form-transition-catalog-2026-06-25',
    ],
    traceQuestions: [
      'For each frame, which handler writes the next _RAM_C260_ value and is bit 7 an entry/initialization flag?',
      'Which ambiguous state graph edges are resolved by the current _RAM_C24F_ outer dispatcher?',
      'Which state writes correspond to jump, airborne control, damage knockback, attack/action, and room transition behavior?',
    ],
  },
  {
    label: '_RAM_C251_',
    address: '$C251',
    traceRole: 'player_facing_direction_seed',
    roleConfidence: 'high_from_existing_catalogs',
    mechanicFocus: ['player_movement_physics', 'collision_damage', 'entity_item_runtime', 'room_transition_state'],
    engineTargets: ['shared/wb3/player-state.js', 'shared/wb3/entities.js', 'shared/wb3/room-loader.js'],
    sourceCatalogIds: [
      'world-player-state-catalog-2026-06-24',
      'world-player-state-physics-flow-catalog-2026-06-25',
      'world-room-event-key-semantics-catalog-2026-06-26',
      'world-item-vram-id-producer-catalog-2026-06-26',
    ],
    traceQuestions: [
      'Which input bit transitions write facing direction versus preserving the previous direction?',
      'Where does facing direction feed item/reward spawn direction, attack hitboxes, and room transition restore?',
      'Does each form use the same direction encoding in animation, collision, and event spawn code?',
    ],
  },
  {
    label: '_RAM_C243_',
    address: '$C243',
    traceRole: 'player_world_x_or_camera_anchor_word_seed',
    roleConfidence: 'medium_high_from_zone_and_physics_catalogs',
    mechanicFocus: ['player_movement_physics', 'collision_damage', 'room_transition_state', 'rendering_vdp_pipeline'],
    engineTargets: ['shared/wb3/player-state.js', 'shared/wb3/collision.js', 'shared/wb3/room-loader.js'],
    sourceCatalogIds: [
      'world-player-struct-catalog-2026-06-25',
      'world-player-physics-state-effect-catalog-2026-06-25',
      'world-zone-recipe-catalog-2026-06-25',
      'world-zone-transition-camera-adjust-catalog-2026-06-25',
      'world-entity-collision-fragment-internal-helper-catalog-2026-06-25',
    ],
    traceQuestions: [
      'Confirm the coordinate axis, units, high/low byte layout, and interaction with camera scroll clamps.',
      'Separate player-position writes from temporary camera/transition anchor writes.',
      'Trace how collision snapping changes this word during movement and room transitions.',
    ],
  },
  {
    label: '_RAM_C27D_',
    address: '$C27D',
    traceRole: 'player_damage_or_transition_gate_seed',
    roleConfidence: 'medium_from_collision_and_transition_access',
    mechanicFocus: ['collision_damage', 'player_movement_physics', 'room_transition_state'],
    engineTargets: ['shared/wb3/player-state.js', 'shared/wb3/player-physics.js', 'shared/wb3/collision.js'],
    sourceCatalogIds: [
      'world-player-physics-routine-catalog-2026-06-25',
      'world-player-state-physics-flow-catalog-2026-06-25',
      'world-bank2-transition-routine-catalog-2026-06-25',
    ],
    traceQuestions: [
      'Identify whether the variable is a damage gate, transition delay, invulnerability timer, or mixed scratch state.',
      'Trace the two known direct writers before assigning a stable engine-state field name.',
      'Record frame behavior around _LABEL_4A5E_ player damage/recoil gate and _LABEL_4C28_ transition delay decay.',
    ],
  },
  {
    label: '_RAM_D15D_',
    address: '$D15D',
    traceRole: 'bank2_vdp_stream_state_entry_index_seed',
    roleConfidence: 'high_from_bank2_vdp_catalogs',
    mechanicFocus: ['room_transition_state', 'rendering_vdp_pipeline', 'entity_item_runtime'],
    engineTargets: ['shared/wb3/scene-recipes.js', 'shared/wb3/screen-prog.js', 'shared/wb3/room-loader.js'],
    sourceCatalogIds: [
      'world-bank2-vdp-stream-state-catalog-2026-06-25',
      'world-bank2-vdp-state-index-producer-catalog-2026-06-26',
      'world-bank2-vdp-state-index-coverage-catalog-2026-06-26',
    ],
    traceQuestions: [
      'Trace the exact state-index progression for each selected _RAM_D15A_ root subtable.',
      'Use modeled producer values to prove which VDP state records are reachable frame-by-frame.',
      'Connect reachable state records to zone/scene recipes and unresolved bank-2 VDP gaps.',
    ],
  },
  {
    label: '_RAM_D16E_',
    address: '$D16E',
    traceRole: 'bank2_scene_state_dispatch_index_seed',
    roleConfidence: 'high_for_state_tables_medium_for_dynamic_branches',
    mechanicFocus: ['room_transition_state', 'rendering_vdp_pipeline', 'entity_item_runtime'],
    engineTargets: ['shared/wb3/game-state.js', 'shared/wb3/scene-recipes.js', 'shared/wb3/room-loader.js'],
    sourceCatalogIds: [
      'world-bank2-dispatch-table-catalog-2026-06-24',
      'world-bank2-state-machine-catalog-2026-06-24',
      'world-d1af-scene-completion-catalog-2026-06-25',
      'world-d16e-dynamic-branch-value-catalog-2026-06-25',
    ],
    traceQuestions: [
      'Resolve scene-5 dynamic branch values into explicit D16E graph edges with branch predicates.',
      'Trace D16E writes inside each scene state table to prove entry-0 completion paths.',
      'Connect D16E scene-state dispatch to D15D VDP stream state and D1AF completion state.',
    ],
  },
  {
    label: '_RAM_C220_',
    address: '$C220',
    traceRole: 'audio_active_channel_index_seed',
    roleConfidence: 'high_from_audio_catalogs',
    mechanicFocus: ['audio_driver'],
    engineTargets: ['shared/sms/psg.js', 'shared/wb3/audio-driver.js'],
    sourceCatalogIds: [
      'world-audio-ram-state-catalog-2026-06-25',
      'world-audio-output-register-catalog-2026-06-25',
      'world-audio-output-global-input-catalog-2026-06-25',
      'world-audio-event-ram-link-catalog-2026-06-25',
    ],
    traceQuestions: [
      'Separate stream-channel context values 0-7 from PSG/FM hardware channel context values 0-3.',
      'Trace how C220 selects PSG latch prefixes and FM melodic/special-channel register targets.',
      'Confirm whether any frame-step operation reads C220 outside output routing context.',
    ],
  },
  {
    label: '_RAM_D0DE_',
    address: '$D0DE',
    traceRole: 'shared_pointer_or_counter_scratch_seed',
    roleConfidence: 'high_for_individual_roles_low_for_single_global_semantics',
    mechanicFocus: ['rendering_vdp_pipeline', 'room_transition_state', 'menu_status_password'],
    engineTargets: ['shared/wb3/room-loader.js', 'shared/wb3/screen-prog.js', 'shared/wb3/game-state.js'],
    sourceCatalogIds: [
      'world-room-overlay-record-catalog-2026-06-25',
      'world-zone-trigger-record-catalog-2026-06-25',
      'world-zone-transition-camera-adjust-catalog-2026-06-25',
      'world-cf52-status-scroll-adjust-catalog-2026-06-25',
      'world-status-vdp-writer-detail-catalog-2026-06-26',
    ],
    traceQuestions: [
      'Partition D0DE lifetimes by routine family before assigning a single engine state field.',
      'Trace room overlay pointer usage separately from status writer counts and trigger-bound scratch usage.',
      'Record call-stack ownership whenever D0DE is read after a bank switch or VDP writer setup.',
    ],
  },
  {
    label: '_RAM_CF64_',
    address: '$CF64',
    traceRole: 'room_overlay_residual_index_proof_seed',
    roleConfidence: 'high_for_overlay_index_low_for_residual_tail_semantics',
    mechanicFocus: ['rendering_vdp_pipeline', 'room_transition_state', 'player_movement_physics'],
    engineTargets: ['shared/wb3/room-loader.js', 'shared/wb3/screen-prog.js', 'shared/wb3/collision.js'],
    sourceCatalogIds: [
      'world-room-overlay-record-catalog-2026-06-25',
      'world-room-overlay-index-bound-catalog-2026-06-25',
      'world-room-overlay-tail-refinement-catalog-2026-06-25',
      'world-low-confidence-residual-triage-catalog-2026-06-26',
      'world-residual-proof-consumer-catalog-2026-06-26',
      'world-room-event-table-catalog-2026-06-26',
    ],
    traceQuestions: [
      'Record the room-loader source record and source byte +6 copied into _RAM_CF64_ by _LABEL_26F4_.',
      'Prove whether any runtime path can select overlay index 227, which would point at the r2813 two-byte trailer after the confirmed 227 records.',
      'If index 227 never appears, keep r2813 quarantined as an unresolved nonpadding tail outside the overlay-record decoder.',
    ],
  },
  {
    label: '_RAM_CF65_',
    address: '$CF65',
    traceRole: 'palette_script_selector_and_tail_boundary_proof_seed',
    roleConfidence: 'high_for_palette_script_selector_medium_for_shared_runtime_role',
    mechanicFocus: ['rendering_vdp_pipeline', 'room_transition_state', 'menu_status_password', 'entity_item_runtime'],
    engineTargets: ['shared/wb3/palettes.js', 'shared/wb3/scene-recipes.js', 'shared/wb3/room-loader.js'],
    sourceCatalogIds: [
      'world-palette-script-catalog-2026-06-24',
      'world-palette-tail-split-catalog-2026-06-25',
      'world-palette-tail-consumer-catalog-2026-06-25',
      'world-palette-tail-layout-refinement-catalog-2026-06-25',
      'world-low-confidence-residual-triage-catalog-2026-06-26',
      'world-residual-proof-consumer-catalog-2026-06-26',
      'world-vdp-render-routine-catalog-2026-06-25',
      'world-room-event-table-catalog-2026-06-26',
    ],
    traceQuestions: [
      'Record every writer that sets _RAM_CF65_ before _LABEL_10BC_ selects a _DATA_1C800_ palette-effect script.',
      'Prove which runtime contexts select entry 25 at _DATA_1CABB_ and whether execution ever continues past the parsed F0 jump into r2815-r2817.',
      'Separate _RAM_CF65_ palette-script selector lifetime from its room-subrecord byte +7/current-zone role before naming a JavaScript engine field.',
    ],
  },
  {
    label: '_RAM_FFFF_',
    address: '$FFFF',
    traceRole: 'mapper_page2_bank_register_seed',
    roleConfidence: 'high_from_mapper_and_vdp_catalogs',
    mechanicFocus: ['rendering_vdp_pipeline', 'audio_driver', 'room_transition_state'],
    engineTargets: ['shared/sms/mapper.js', 'shared/wb3/rom.js'],
    sourceCatalogIds: [
      'world-dynamic-vdp-bank-variable-catalog-2026-06-26',
      'world-vdp-render-routine-catalog-2026-06-25',
      'world-item-vram-id-producer-catalog-2026-06-26',
    ],
    traceQuestions: [
      'Classify each bank write as immediate switch, helper push/pop, animation restore, or dynamic VDP source bank selection.',
      'Model mapper state transitions in the clean ROM/mapper layer before replaying any banked data consumer.',
      'Keep mapper writes separate from gameplay RAM variables in engine state.',
    ],
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function compactRoutine(routine) {
  return {
    id: routine.id,
    offset: routine.offset,
    bank: routine.bank,
    name: routine.name || '',
    confidence: routine.confidence,
  };
}

function normalizeAddress(address) {
  return String(address || '').toUpperCase().replace(/^0X/, '$');
}

function findRamEntry(mapData, address) {
  const normalized = normalizeAddress(address);
  return (mapData.ram || []).find(entry => normalizeAddress(entry.address) === normalized) || null;
}

function findCatalogById(mapData, catalogIdToFind) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === catalogIdToFind);
    if (found) return found;
  }
  return null;
}

function compactSupportingAudit(audit) {
  return {
    catalogId: audit.catalogId || null,
    kind: audit.kind || audit.role || null,
    confidence: audit.confidence || null,
    summary: audit.summary || null,
  };
}

function sourceAuditSummaries(ramEntry, sourceCatalogIds) {
  const sourceSet = new Set(sourceCatalogIds);
  return Object.fromEntries(Object.entries(ramEntry?.analysis || {})
    .filter(([, audit]) => audit?.catalogId && sourceSet.has(audit.catalogId))
    .map(([key, audit]) => [key, compactSupportingAudit(audit)]));
}

function sourceCatalogSummaries(mapData, sourceCatalogIds) {
  return sourceCatalogIds.map(id => {
    const catalog = findCatalogById(mapData, id);
    return {
      id,
      present: Boolean(catalog),
      summaryKeys: catalog?.summary ? Object.keys(catalog.summary).slice(0, 12) : [],
    };
  });
}

function labelForLine(lines, index) {
  for (let i = index; i >= 0; i--) {
    const match = /^(_LABEL_[0-9A-F]+_):/.exec(lines[i]);
    if (match) return match[1];
  }
  return null;
}

function classifyAsmRef(line, label) {
  const trimmed = line.trim();
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (trimmed.startsWith(';')) {
    if (/indexed by/i.test(trimmed)) return 'comment_indexed_by_label';
    if (/pointer table|jump table/i.test(trimmed)) return 'comment_table_reference';
    return 'comment_reference';
  }
  if (new RegExp(`\\(${escaped}\\)\\s*,`, 'i').test(trimmed)) return 'direct_write';
  if (new RegExp(`,\\s*\\(${escaped}\\)`, 'i').test(trimmed)) return 'direct_read';
  if (new RegExp(`\\bhl\\s*,\\s*${escaped}\\b`, 'i').test(trimmed)) return 'address_load_hl';
  if (new RegExp(`\\b(de|bc|ix|iy)\\s*,\\s*${escaped}\\b`, 'i').test(trimmed)) return 'address_load';
  return 'other_reference';
}

function scanAsmRefs(asmText, label) {
  const lines = asmText.split(/\r?\n/);
  const refs = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(label)) continue;
    const kind = classifyAsmRef(lines[i], label);
    refs.push({
      line: i + 1,
      kind,
      enclosingLabel: labelForLine(lines, i),
    });
  }
  return refs;
}

function compactAccessList(list, limit = 12) {
  return (list || []).slice(0, limit).map(compactRoutine);
}

function buildTraceSeed(mapData, asmText, seed) {
  const ramEntry = findRamEntry(mapData, seed.address);
  const ramCatalog = (mapData.ramVariableCatalogs || []).find(catalog => catalog.id === ramVariableCatalogId);
  if (!ramCatalog) throw new Error(`Missing required RAM variable catalog: ${ramVariableCatalogId}`);
  const ramVariable = (ramCatalog.entries || []).find(entry => entry.label === seed.label);
  const asmRefs = scanAsmRefs(asmText, seed.label);
  const asmRefCounts = countBy(asmRefs, ref => ref.kind);
  const readBy = compactAccessList(ramVariable?.readBy);
  const writtenBy = compactAccessList(ramVariable?.writtenBy);
  const bankSwitchWrittenBy = compactAccessList(ramVariable?.bankSwitchWrittenBy);
  const sourceAudits = sourceAuditSummaries(ramEntry, seed.sourceCatalogIds);

  return {
    label: seed.label,
    address: seed.address,
    ramEntry: ramEntry ? {
      id: ramEntry.id,
      address: ramEntry.address,
      size: ramEntry.size || 0,
      type: ramEntry.type || '',
      name: ramEntry.name || '',
      confidence: ramEntry.confidence || null,
    } : null,
    traceRole: seed.traceRole,
    roleConfidence: seed.roleConfidence,
    mechanicFocus: seed.mechanicFocus,
    engineTargets: seed.engineTargets,
    accessSummary: {
      readCount: ramVariable?.readCount || 0,
      writeCount: ramVariable?.writeCount || 0,
      bankSwitchWriteCount: ramVariable?.bankSwitchWriteCount || 0,
      accessKind: ramVariable?.accessKind || null,
      mechanicIds: ramVariable?.mechanicIds || [],
      readBy,
      writtenBy,
      bankSwitchWrittenBy,
    },
    asmReferenceSummary: {
      directAsmReferenceCount: asmRefs.length,
      kindCounts: asmRefCounts,
      sampleRefs: asmRefs.slice(0, 24),
    },
    sourceCatalogIds: seed.sourceCatalogIds,
    sourceCatalogSummaries: sourceCatalogSummaries(mapData, seed.sourceCatalogIds),
    sourceAudits,
    traceQuestions: seed.traceQuestions,
    tracePlan: [
      'Capture initial value at reset/load-room boundary.',
      'Record ordered writers, then compare the following readers in the same frame.',
      'Split shared scratch lifetimes by enclosing routine before naming engine fields.',
      'Only translate to JavaScript after value units, branch predicates, and writer ownership are proven.',
    ],
  };
}

function buildCatalog(mapData, asmText) {
  const ramCatalog = (mapData.ramVariableCatalogs || []).find(catalog => catalog.id === ramVariableCatalogId);
  const mechanicCatalog = (mapData.runtimeMechanicCatalogs || []).find(catalog => catalog.id === runtimeMechanicCatalogId);
  if (!ramCatalog) throw new Error(`Missing required RAM variable catalog: ${ramVariableCatalogId}`);
  if (!mechanicCatalog) throw new Error(`Missing required runtime mechanic catalog: ${runtimeMechanicCatalogId}`);

  const seeds = seedDefs.map(seed => buildTraceSeed(mapData, asmText, seed));
  const missingRamEntries = seeds.filter(seed => !seed.ramEntry).map(seed => seed.label);
  const missingSourceCatalogIds = Array.from(new Set(seeds.flatMap(seed =>
    seed.sourceCatalogSummaries.filter(summary => !summary.present).map(summary => summary.id)
  ))).sort();

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogIds: [
      ramVariableCatalogId,
      runtimeMechanicCatalogId,
      ...Array.from(new Set(seedDefs.flatMap(seed => seed.sourceCatalogIds))).sort(),
    ],
    assetPolicy: 'Metadata only: RAM labels, addresses, routine ids, offsets, ASM line numbers, source catalog ids, evidence summaries, and trace questions. No ROM bytes, instruction bytes, decoded graphics, pixels, screenshots, text payloads, audio payloads, register traces, or hashes are embedded.',
    selectionRule: {
      source: 'Hand-picked high-priority RAM variables from the runtime RAM variable index and existing player/audio/VDP/room evidence catalogs.',
      purpose: 'Seed frame-trace work for clean JavaScript engine reconstruction without claiming frame-accurate behavior yet.',
      limitation: 'Trace roles are evidence-backed starting points. Final engine variable names require runtime/frame traces.',
    },
    summary: {
      seedCount: seeds.length,
      missingRamEntryCount: missingRamEntries.length,
      missingRamEntries,
      missingSourceCatalogCount: missingSourceCatalogIds.length,
      missingSourceCatalogIds,
      mechanicFocusCounts: countBy(seeds.flatMap(seed => seed.mechanicFocus), item => item),
      engineTargetCounts: countBy(seeds.flatMap(seed => seed.engineTargets), item => item),
      directAsmReferenceCount: seeds.reduce((sum, seed) => sum + seed.asmReferenceSummary.directAsmReferenceCount, 0),
      traceRoleCounts: countBy(seeds, seed => seed.traceRole),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    seeds,
    nextLeads: [
      'Run a frame trace for _RAM_C24F_ + _RAM_C260_ together so outer-form context resolves ambiguous player state graph edges.',
      'Trace _RAM_D15D_ and _RAM_D16E_ together during bank-2 scenes to connect scene-state dispatch to VDP stream record reachability.',
      'Trace _RAM_CF64_ source byte +6 during room loading to prove or reject the r2813 overlay-tail candidate.',
      'Trace _RAM_CF65_ writers and _LABEL_10BC_ entry selection to prove whether the _DATA_1CABB_ tail is ever consumed outside the palette parser.',
      'Trace _RAM_C220_ through PSG/FM output routing before building a browser audio player.',
      'Keep _RAM_D0DE_ partitioned by routine family; it is proven scratch/state in several independent subsystems.',
    ],
  };
}

function reportSample(catalog) {
  return catalog.seeds.map(seed => ({
    label: seed.label,
    address: seed.address,
    traceRole: seed.traceRole,
    roleConfidence: seed.roleConfidence,
    readCount: seed.accessSummary.readCount,
    writeCount: seed.accessSummary.writeCount,
    directAsmReferenceCount: seed.asmReferenceSummary.directAsmReferenceCount,
    sourceCatalogCount: seed.sourceCatalogIds.length,
  }));
}

function applyCatalog(mapData, catalog) {
  for (const seed of catalog.seeds) {
    const ramEntry = findRamEntry(mapData, seed.address);
    if (!ramEntry) continue;
    ramEntry.analysis = ramEntry.analysis || {};
    ramEntry.analysis.runtimeRamTraceSeedAudit = {
      catalogId,
      kind: seed.traceRole,
      confidence: seed.roleConfidence,
      summary: `${seed.label} is a priority frame-trace seed for ${seed.mechanicFocus.join(', ')}.`,
      accessSummary: {
        readCount: seed.accessSummary.readCount,
        writeCount: seed.accessSummary.writeCount,
        bankSwitchWriteCount: seed.accessSummary.bankSwitchWriteCount,
        accessKind: seed.accessSummary.accessKind,
      },
      directAsmReferenceCount: seed.asmReferenceSummary.directAsmReferenceCount,
      asmReferenceKindCounts: seed.asmReferenceSummary.kindCounts,
      sourceCatalogIds: seed.sourceCatalogIds,
      engineTargets: seed.engineTargets,
      traceQuestions: seed.traceQuestions,
      generatedAt: now,
      tool: toolName,
    };
  }

  mapData.runtimeRamTraceSeedCatalogs = (mapData.runtimeRamTraceSeedCatalogs || []).filter(item => item.id !== catalogId);
  mapData.runtimeRamTraceSeedCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'runtime_ram_trace_seed_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogIds: catalog.sourceCatalogIds,
    summary: catalog.summary,
    seedSummary: reportSample(catalog),
    assetPolicy: catalog.assetPolicy,
    nextLeads: catalog.nextLeads,
  });
}

function updateStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.runtimeRamTraceSeedCatalog = catalogId;
  staticMap.summary.runtimeRamTraceSeedCount = catalog.summary.seedCount;
  staticMap.summary.runtimeRamTraceSeedDirectAsmRefs = catalog.summary.directAsmReferenceCount;
  staticMap.summary.runtimeRamTraceSeedMissingSourceCatalogs = catalog.summary.missingSourceCatalogCount;
  staticMap.summary.runtimeRamTraceSeedResidualProofSeeds = catalog.seeds.filter(seed => seed.traceRole === 'room_overlay_residual_index_proof_seed').length;
  staticMap.summary.runtimeRamTraceSeedPaletteTailProofSeeds = catalog.seeds.filter(seed => seed.traceRole === 'palette_script_selector_and_tail_boundary_proof_seed').length;
  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.gameplay = insertAfter(
    staticMap.primaryCatalogs.gameplay,
    'world-runtime-ram-variable-index-catalog-2026-06-26',
    catalogId
  );
  staticMap.primaryCatalogs.rendering = insertAfter(
    staticMap.primaryCatalogs.rendering,
    'world-low-confidence-residual-triage-catalog-2026-06-26',
    catalogId
  );
  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.push('Use world-runtime-ram-trace-seed-catalog-2026-06-26 to trace _RAM_CF64_ source byte +6 and _RAM_CF65_ palette-script selection before promoting or rejecting the remaining overlay/palette-tail residuals.');
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);

  if (apply) {
    applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
    updateStaticMap(catalog);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    seedSummary: reportSample(catalog),
  }, null, 2));
}

main();
