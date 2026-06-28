'use strict';

// Metadata-only decoder registry for WORLD. Runtime previews may decode the
// user's local ROM in memory, but no decoded bytes, pixels, palettes or audio
// samples are persisted by this module.

var WB3_DECODER_FAMILY_DEFS = [
  { id: 'tiles_palettes_vram', label: 'Tiles, Palettes & VRAM' },
  { id: 'screen_programs', label: 'Screen Programs' },
  { id: 'zones_rooms_doors', label: 'Zones, Rooms, Doors & Transitions' },
  { id: 'collision_maps', label: 'Collision Maps & Bounds' },
  { id: 'metasprites_animation', label: 'Metasprites & Animation' },
  { id: 'entities_items_behaviors', label: 'Entities, Items & Behaviors' },
  { id: 'music_sfx_audio', label: 'Music, SFX & Audio Driver' },
  { id: 'text_hud_menu_inventory_password', label: 'Text, HUD, Menu, Inventory & Password' },
  { id: 'ram_roles_game_state', label: 'RAM Roles & Game State' },
];

var WB3_DECODER_DEFS = [
  {
    id: 'sms_4bpp_tiles',
    label: 'SMS 4bpp tile decoder',
    familyId: 'tiles_palettes_vram',
    regionTypes: ['gfx_tiles', 'gfx_sprites'],
    assetKinds: ['graphics_data'],
    status: 'implemented',
    implementationPercent: 100,
    previewCapabilities: ['visual', 'metadata'],
    evidence: ['tools/js/utils.js decodeTile', 'tools/js/panel-lab.js tile preview', 'world-graphics-combined-source-coverage-catalog-2026-06-26', 'world-graphics-combined-incbin-layout-catalog-2026-06-26', 'world-scene-recipe-render-provenance-catalog-2026-06-25', 'world-player-a48-tile-stream-catalog-2026-06-26', 'world-dynamic-tile-source-table-catalog-2026-06-25'],
    remainingWork: 'Complete for ROM-local SMS 4bpp tile preview, tile-shape diagnostics, combined source-family provenance, scene recipe source usage, incbin layout, and unresolved-span metadata. Default palette choice remains a render-context concern.',
  },
  {
    id: 'sms_cram_palette',
    label: 'SMS CRAM palette decoder',
    familyId: 'tiles_palettes_vram',
    regionTypes: ['palette'],
    assetKinds: ['palette_data'],
    status: 'implemented',
    implementationPercent: 100,
    previewCapabilities: ['visual', 'metadata'],
    evidence: ['tools/js/utils.js decodePaletteAt', 'world-palette-table-catalog-2026-06-24', 'sceneRecipes BG/SPR palette steps', 'world-sprite-palette-writer-catalog-2026-06-25', 'world-sprite-palette-inheritance-catalog-2026-06-25'],
    remainingWork: 'Complete for ROM-local CRAM swatches, palette table provenance, scene BG/SPR usage and inheritance metadata. Future custom palette editing belongs outside this ROM decoder.',
  },
  {
    id: 'vram_loader_8fb',
    label: '_LABEL_8FB_ VRAM loader data',
    familyId: 'tiles_palettes_vram',
    regionTypes: ['vram_loader_8fb'],
    assetKinds: ['vram_load_plan'],
    status: 'implemented',
    implementationPercent: 100,
    previewCapabilities: ['visual', 'metadata'],
    evidence: ['tools/js/utils.js decodeVramLoader8FBData', 'confirmed routine r1973 _LABEL_8FB_', 'sceneRecipes vram_loader_8fb steps', 'zoneRecipes dependencies.vramLoader8fb', 'inlineTransitionRecipes dependencies.vramLoader8fb', 'zoneLoaderBoundaryCatalogs', 'ASM callsite audits'],
    remainingWork: 'Complete for ROM-local 8FB parsing, tile source provenance, reusable scene/zone/inline recipe consumers, and direct ASM callsite metadata.',
  },
  {
    id: 'vram_loader_998',
    label: '_LABEL_998_ VRAM loader data',
    familyId: 'tiles_palettes_vram',
    regionTypes: ['vram_loader_998'],
    assetKinds: ['vram_load_plan'],
    status: 'implemented',
    implementationPercent: 100,
    previewCapabilities: ['visual', 'metadata'],
    evidence: ['tools/js/utils.js decodeVramLoader998Data', 'confirmed routine r2644 _LABEL_998_', 'tileSourceAudit source-region provenance', 'sceneRecipes vram_loader_998 steps', 'roomLoaderFieldBoundAudit', 'playerFormAudit', 'vram998EntrypointVariantAudit', 'vramLoader998ConsumerRecipes'],
    remainingWork: 'Complete for ROM-local 998 parsing, zero-fill/copy provenance, source bank resolution, partial-consumption metadata, and canonical consumer recipes.',
  },
  {
    id: 'tile_map_layout',
    label: 'Tile/map structural decoder',
    familyId: 'tiles_palettes_vram',
    regionTypes: ['tile_map', 'dynamic_tile_loader'],
    assetKinds: ['graphics_data'],
    status: 'implemented',
    implementationPercent: 100,
    previewCapabilities: ['visual', 'metadata'],
    evidence: ['tools/js/panel-lab.js TILE MAP preview', 'world-dc2-scroll-map-catalog-2026-06-25', 'world-dc2-tile-pair-lookup-catalog-2026-06-25', 'world-dynamic-tile-source-table-catalog-2026-06-25', 'tileSourceCatalogs', 'graphicsCatalogs'],
    remainingWork: 'Complete for ROM-local structural tile maps, DC2 compressed scroll streams, DC2 tile-pair lookup metadata and dynamic tile loader source-table provenance. Pixel-perfect rendering remains bound to scene/VRAM recipes.',
  },
  {
    id: 'palette_vdp_script',
    label: 'Palette / VDP effect script decoder',
    familyId: 'tiles_palettes_vram',
    regionTypes: ['palette_script', 'palette_script_table', 'vdp_stream', 'effect_script'],
    assetKinds: ['palette_data'],
    status: 'implemented',
    implementationPercent: 100,
    previewCapabilities: ['visual', 'timeline', 'metadata'],
    evidence: ['world-palette-script-catalog-2026-06-24', '_LABEL_10BC_ palette script routine', 'world-bank2-effect-script-catalog-2026-06-24', '_LABEL_BFED_/_LABEL_BFBA_ timed effect stream', 'world-bank2-vdp-stream-layout-catalog-2026-06-25', 'world-bank2-vdp-state-index-coverage-catalog-2026-06-26', 'world-bank2-vdp-residual-final-disposition-catalog-2026-06-26'],
    remainingWork: 'Complete for ROM-local palette script tables/scripts, bank-2 timed effect streams and catalog-bound VDP stream layout/runtime/residual diagnostics. Exact frame renderer integration belongs to scene runtime reconstruction.',
  },
  {
    id: 'screen_prog_604',
    label: '_LABEL_604_ screen_prog bytecode',
    familyId: 'screen_programs',
    regionTypes: ['screen_prog'],
    assetKinds: ['screen'],
    status: 'implemented',
    implementationPercent: 100,
    previewCapabilities: ['visual', 'metadata'],
    evidence: ['tools/js/utils.js decodeScreenProg604', 'screenProgCatalogs', 'screenProgEmbeddedContinuationProofCatalogs', 'world-screen-prog-reachability-catalog-2026-06-24', 'ROM-local _LABEL_604_ trace/count diagnostics'],
    remainingWork: 'Complete for ROM-local _LABEL_604_ bytecode parsing, name-table write diagnostics, reachability/root grouping, embedded continuation grouping and table-target metadata. Exact pixel rendering remains a scene recipe responsibility.',
  },
  {
    id: 'screen_prog_table',
    label: 'screen_prog pointer table',
    familyId: 'screen_programs',
    regionTypes: ['screen_prog_table'],
    assetKinds: ['screen'],
    status: 'implemented',
    implementationPercent: 100,
    previewCapabilities: ['metadata', 'timeline'],
    evidence: ['screenProgCatalogs', 'world-screen-prog-table-catalog-2026-06-24', 'screenProgTableAudit', 'bank7VdpStreamAudit', 'tools/js/utils.js decodePointerTableLE'],
    remainingWork: 'Complete for the bank-7 _DATA_1CCC0_ table: 31/31 pointers resolve to screen_prog targets with _RAM_CF81_ index evidence and _LABEL_604_ consumer metadata.',
  },
  {
    id: 'z80_pointer_table_le',
    label: 'Z80 little-endian pointer table',
    familyId: 'zones_rooms_doors',
    regionTypes: ['pointer_table', 'entity_anim_table', 'entity_behavior_table'],
    assetKinds: ['room_data', 'entity_data'],
    status: 'implemented',
    implementationPercent: 68,
    previewCapabilities: ['metadata'],
    evidence: ['tools/js/utils.js decodePointerTableLE'],
    remainingWork: 'Add caller-aware validation so byte streams are not misclassified as real tables.',
  },
  {
    id: 'room_zone_records',
    label: 'Room / zone / transition records',
    familyId: 'zones_rooms_doors',
    regionTypes: ['room_data', 'room_subrecord', 'room_seq_table'],
    assetKinds: ['room_data', 'scene_recipe'],
    status: 'implemented',
    implementationPercent: 100,
    previewCapabilities: ['visual', 'metadata'],
    evidence: ['world-zone-graph-2026-06-24', 'world-room-subrecord-catalog-2026-06-25', 'world-room-event-table-catalog-2026-06-26', '_LABEL_2620_ room loader', '_LABEL_26F4_ room subrecord loader', '_LABEL_4816_/_LABEL_48A9_ trigger scanner', '_LABEL_635D_ room event table consumer'],
    remainingWork: 'Complete for ROM-local room descriptors, subrecords, trigger/door records, event-table records, graph edges, loader/DC2/palette/audio references and reusable zone recipe metadata. Runtime side effects of transition handlers remain routine reconstruction work.',
  },
  {
    id: 'collision_runtime_catalogs',
    label: 'Collision maps, bounds and runtime fields',
    familyId: 'collision_maps',
    regionTypes: [],
    assetKinds: [],
    status: 'partial',
    implementationPercent: 70,
    previewCapabilities: ['timeline', 'metadata'],
    evidence: ['shared/wb3/collision.js', 'world-collision-buffer-provenance-catalog-2026-06-25', 'world-collision-bound-catalog-2026-06-25', 'world-zone-collision-recipe-catalog-2026-06-25', 'world-dc2-scroll-map-catalog-2026-06-25', 'world-dc2-tile-pair-lookup-catalog-2026-06-25', 'local-ROM DC2 stream/table structural validation'],
    remainingWork: 'Complete player/entity collision response semantics by binding _LABEL_141F_ lookups and response calls to runtime traces; code/routine regions remain partial until frame effects are proven.',
  },
  {
    id: 'metasprite_records',
    label: 'Metasprite record decoder',
    familyId: 'metasprites_animation',
    regionTypes: ['meta_sprite'],
    assetKinds: ['entity_data'],
    status: 'implemented',
    implementationPercent: 100,
    previewCapabilities: ['visual', 'metadata'],
    evidence: ['metaspriteCatalogs', 'animationFrameStreamCatalogs', 'animationFrameSubrecordCatalogs', 'animationStaticStreamCatalogs', 'animationSpriteTileRangeCatalogs', 'blankMetaspriteQuarantineProofCatalogs', 'world-metasprite-oam-writer-semantics-catalog-2026-06-25', 'ROM-local metasprite layout and tile-source preview'],
    remainingWork: 'Complete for ROM-local metasprite frame parsing, frame-subrecord ownership, static-stream references, tile-base/source provenance, blank target quarantine, and structural/pixel preview diagnostics.',
  },
  {
    id: 'entity_animation_streams',
    label: 'Entity animation tables and scripts',
    familyId: 'metasprites_animation',
    regionTypes: ['entity_anim_table', 'entity_anim_script'],
    assetKinds: ['entity_data'],
    status: 'implemented',
    implementationPercent: 100,
    previewCapabilities: ['timeline', 'visual', 'metadata'],
    evidence: ['entityAnimationCatalogs', 'animationCommandStreamCatalogs', 'animationStaticStreamCatalogs', 'animationCommandStaticOverlayCatalogs', 'animationFamilyCatalogs', 'animationBehaviorFamilyCatalogs', 'bank1MenuObjectAudit', 'bank4EntityControlAudit', 'ROM-local animation table/stream validation'],
    remainingWork: 'Complete for ROM-local animation pointer tables, bank-6 command/static streams, non-bank cataloged motion/VRAM/event scripts, selector ownership, frame targets and reusable timeline diagnostics.',
  },
  {
    id: 'entity_item_records',
    label: 'Entity, item and behavior records',
    familyId: 'entities_items_behaviors',
    regionTypes: ['entity_data', 'entity_behavior_table', 'item_data'],
    assetKinds: ['entity_data'],
    status: 'implemented',
    implementationPercent: 100,
    previewCapabilities: ['visual', 'metadata'],
    evidence: ['world-room-entity-list-catalog-2026-06-25', 'world-room-entity-orphan-list-catalog-2026-06-25', '_LABEL_2948_/_LABEL_2963_ room entity list decoder', 'entityDataCatalogs', 'entityBehaviorCatalogs', 'itemDataCatalogs', 'ROM-local entity/item structural record validation'],
    remainingWork: 'Complete for ROM-local room entity lists, behavior pointer tables, menu object records, non-room entity streams, item/equipment/name records, state/object lookup tables and bank-7 sequence streams. Behavior code execution semantics remain in routine/runtime reconstruction decoders.',
  },
  {
    id: 'routine_label_index',
    label: 'ASM routine label index',
    familyId: 'entities_items_behaviors',
    regionTypes: ['code'],
    assetKinds: ['gameplay_routine'],
    status: 'metadata_only',
    implementationPercent: 60,
    previewCapabilities: ['metadata'],
    evidence: ['ASM labels', 'runtime mechanic catalogs'],
    remainingWork: 'Trace frame behavior and RAM effects before converting routines to clean JS modules.',
  },
  {
    id: 'music_stream_experimental',
    label: 'Music request/stream decoder and listener',
    familyId: 'music_sfx_audio',
    regionTypes: ['music'],
    assetKinds: ['audio_data'],
    status: 'partial',
    implementationPercent: 78,
    previewCapabilities: ['audio', 'timeline', 'metadata'],
    evidence: ['world-audio-catalog-2026-06-24', 'world-audio-stream-graph-catalog-2026-06-25', 'world-audio-opcode-state-effect-catalog-2026-06-25', '_LABEL_C191_ stream byte role semantics', 'local-ROM request/channel state seed preview', 'music channel lane state preview', 'music pitch/duration support binding preview', 'local ROM PSG/FM base pitch candidate resolver', 'music opcode parameter state preview', 'world-audio-runtime-output-fixture-catalog-2026-06-26', 'world-audio-runtime-output-event-contract-catalog-2026-06-26', 'non request-backed music residual classifier', 'false-DW target stream-shape timeline probe', 'tools/js/asset-data-browsers-page.js timeline listener'],
    remainingWork: 'Bind opcode parameter mutations to exact channel struct fields, dynamic pitch deltas, envelopes, instruments and browser mixer output; verify whether the two false-DW target stream-shape candidates are ever reached at runtime.',
  },
  {
    id: 'audio_driver_runtime_metadata',
    label: 'Audio driver runtime/output metadata',
    familyId: 'music_sfx_audio',
    regionTypes: ['audio_driver_data'],
    assetKinds: [],
    status: 'partial',
    implementationPercent: 74,
    previewCapabilities: ['timeline', 'metadata'],
    evidence: ['shared/wb3/audio-runtime-output-events.js', 'world-audio-runtime-output-fixture-catalog-2026-06-26', 'world-audio-runtime-output-event-contract-catalog-2026-06-26', 'world-audio-output-register-catalog-2026-06-25', 'world-audio-request-taxonomy-catalog-2026-06-25', 'metadata-only runtime output event sink/register intent/channel-port intent model', 'local-ROM audio driver request bridge preview'],
    remainingWork: 'Connect clean audio runtime callbacks to exact PSG/FM channel state, envelopes, pitch periods and browser sound output. Metadata-only output fixture/event intent bridge is implemented.',
  },
  {
    id: 'text_ascii_probe',
    label: 'Text / printable marker decoder',
    familyId: 'text_hud_menu_inventory_password',
    regionTypes: ['text'],
    assetKinds: ['rom_region'],
    status: 'implemented',
    implementationPercent: 62,
    previewCapabilities: ['text', 'metadata'],
    evidence: ['tools/js/panel-lab.js TEXT DECODE', 'smallDataCatalogs text classifications'],
    remainingWork: 'Separate bank markers, passwords, labels and UI strings into named text roles.',
  },
  {
    id: 'input_script_bfd',
    label: '_LABEL_BFD_ input-control script decoder',
    familyId: 'text_hud_menu_inventory_password',
    regionTypes: ['input_script'],
    assetKinds: ['rom_region'],
    status: 'implemented',
    implementationPercent: 72,
    previewCapabilities: ['timeline', 'metadata'],
    evidence: ['tools/world-input-script-audit.mjs parseLabelBfdInputScript', 'inputScriptCatalogs'],
    remainingWork: 'Cross-link command bits to exact menu/controller consumers and expose a frame timeline view.',
  },
  {
    id: 'text_menu_status_records',
    label: 'HUD, menu, inventory and password metadata',
    familyId: 'text_hud_menu_inventory_password',
    regionTypes: [],
    assetKinds: ['screen', 'gameplay_routine'],
    status: 'partial',
    implementationPercent: 74,
    previewCapabilities: ['timeline', 'metadata'],
    evidence: ['world-bank0-menu-routine-catalog-2026-06-25', 'world-bank0-status-inventory-catalog-2026-06-25', 'world-bank2-hud-counter-catalog-2026-06-25', 'passwordRoutineAudit', 'statusVdpWriterDetailAudit', 'world-status-tile-source-range-catalog-2026-06-26', 'local-ROM UI/password table row validation', 'local-ROM status-tile upload range validation'],
    remainingWork: 'Complete menu/password/status routine semantics by binding table rows and status-tile uploads to exact caller state, screen recipes, command streams and final user-facing item/password labels.',
  },
  {
    id: 'ram_symbol_index',
    label: 'RAM symbol and game-state index',
    familyId: 'ram_roles_game_state',
    regionTypes: [],
    assetKinds: ['ram_symbol', 'cheat_recipe'],
    status: 'metadata_only',
    implementationPercent: 70,
    previewCapabilities: ['metadata'],
    evidence: ['map.json ram array', 'runtime RAM variable catalogs'],
    remainingWork: 'Attach write/read traces and safe trainer controls to each gameplay state variable.',
  },
  {
    id: 'null_padding_classifier',
    label: 'Null/padding classifier',
    familyId: 'ram_roles_game_state',
    regionTypes: ['null'],
    assetKinds: ['rom_region'],
    status: 'implemented',
    implementationPercent: 100,
    previewCapabilities: ['metadata'],
    evidence: ['coverage audits'],
    remainingWork: 'Keep separated from real assets; no preview needed.',
  },
];

function wb3DecoderArray(value) {
  return Array.isArray(value) ? value : [];
}

function wb3DecoderObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function wb3DecoderHex(n, pad) {
  if (typeof hexStr === 'function') return hexStr(n, pad || 5);
  return '0x' + Number(n || 0).toString(16).toUpperCase().padStart(pad || 5, '0');
}

function wb3DecoderParseOffset(value) {
  if (typeof parseHex === 'function') return parseHex(value);
  const n = Number.parseInt(String(value || '').replace(/^0x/i, ''), 16);
  return Number.isFinite(n) ? n : null;
}

function wb3DecoderBankOf(offset) {
  if (typeof bankOf === 'function') {
    try {
      return bankOf(offset);
    } catch (error) {
      // Some Node smoke-test VM contexts expose bankOf() without its module-scoped BANK_SIZE constant.
    }
  }
  return Math.floor(offset / 0x4000);
}

function wb3IsTextMenuStatusRegion(region) {
  if (!region) return false;
  const analysis = wb3DecoderObject(region.analysis);
  const keys = Object.keys(analysis);
  if (keys.some(key => /^(bank0MenuRoutineAudit|bank0StatusInventoryAudit|bank2HudCounterAudit|passwordRoutineAudit|bank1MenuObjectAudit|bank7MenuItemAudit|statusVdpWriterDetailAudit|statusTileSourceRangeAudit|cf52StatusScrollAdjustAudit|cf52Cf54WriteCoverageAudit|cf52Cf54EntryTableStructureAudit|pauseStatusLoaderBundleAudit|pauseStatusRenderParamQuarantine|pauseStatusStreamLoaderDisambiguationAudit|pauseStatusLoaderSourceCoverage|pauseStatusCandidateCoverageDisambiguation)$/i.test(key))) return true;
  return /password|status hud|status\/selection|status name-table|status tile|inventory|shop\/menu|equipment menu|continue\/password|hud counter|menu selection|password alphabet|password xor|password character/i.test([
    region.name,
    region.notes,
    region.type,
  ].join(' '));
}

function wb3IsCollisionRuntimeRegion(region) {
  if (!region) return false;
  const analysis = wb3DecoderObject(region.analysis);
  return Object.keys(analysis).some(key => /^(collisionBufferProvenanceAudit|collisionBufferLookupCallsites|collisionBoundAudit|zoneCollisionRecipeAudit|entityMotionCollisionHelperAudit|entityCollisionFragmentInternalHelperAudit|playerCollisionFrameTraceScaffoldAudit|playerCollisionRuntimeHookFixtureAudit|playerCollisionRuntimeTraceEventContractAudit|bank2VdpResidualDrawBoundaryCollisionAudit|dc2ScrollMapAudit|dc2TilePairLookupAudit)$/i.test(key));
}

function wb3IsAudioDriverRuntimeRegion(region) {
  if (!region) return false;
  if ((region.type || '') === 'audio_driver_data') return true;
  const analysis = wb3DecoderObject(region.analysis);
  return Object.keys(analysis).some(key => /^(audioDriverRoutineAudit|audioOutputRegisterAudit|audioPortWriteCoverageAudit|audioRuntimeOutputEventEmitterAudit|audioRuntimeOutputFixtureAudit|audioRuntimeOutputLocalBundleAudit|audioRuntimeOutputLocalObservationBrowserBridgeAudit|audioStreamRoutineAudit|bank3AudioFragmentAudit|audioOutputModeBranchAudit)$/i.test(key));
}

function wb3DecoderRegionsById(map) {
  const out = new Map();
  for (const region of wb3DecoderArray(map?.regions)) {
    if (region && region.id) out.set(region.id, region);
  }
  return out;
}

function wb3DecoderAssetsMatchKind(asset, decoder) {
  if (!decoder.assetKinds || !decoder.assetKinds.length) return false;
  return decoder.assetKinds.includes(asset?.kind || '');
}

function wb3DecoderMatchesRegion(decoder, region) {
  if (!decoder || !region) return false;
  if (decoder.id === 'collision_runtime_catalogs') return wb3IsCollisionRuntimeRegion(region);
  if (decoder.id === 'audio_driver_runtime_metadata') return wb3IsAudioDriverRuntimeRegion(region);
  if (decoder.id === 'text_menu_status_records') return wb3IsTextMenuStatusRegion(region);
  return wb3DecoderArray(decoder.regionTypes).includes(region.type || '');
}

function wb3GenericRegionName(region) {
  const name = String(region?.name || '').trim();
  if (!name) return true;
  if (/^_(DATA|LABEL)_[0-9A-F]+_?$/i.test(name)) return true;
  if (/^Data from [0-9A-F]+ to [0-9A-F]+/i.test(name)) return true;
  if (/^Unknown/i.test(name)) return true;
  return false;
}

function wb3GenericRegionNotes(region) {
  const notes = String(region?.notes || '').trim();
  if (!notes) return true;
  if (/^Data from [0-9A-F]+ to [0-9A-F]+/i.test(notes)) return true;
  if (/^Unknown/i.test(notes)) return true;
  return false;
}

function wb3RegionLabelState(region) {
  if (!region) return 'missing_region';
  if ((region.type || '') === 'unknown') return 'needs_type';
  if (wb3GenericRegionName(region) && wb3GenericRegionNotes(region)) return 'needs_label';
  if (wb3GenericRegionName(region)) return 'needs_name';
  if (wb3GenericRegionNotes(region)) return 'needs_notes';
  return 'semantic_label';
}

function wb3RegionLabelPriority(state) {
  if (state === 'needs_type') return 0;
  if (state === 'needs_label') return 1;
  if (state === 'needs_name') return 2;
  if (state === 'needs_notes') return 3;
  if (state === 'semantic_label') return 4;
  return 5;
}

function wb3DecoderLabelQueueTags(decoder, region, labelState) {
  const tags = new Set();
  if (decoder?.id) tags.add(`decoder:${decoder.id}`);
  if (decoder?.familyId) tags.add(`family:${decoder.familyId}`);
  if (region?.type) tags.add(`type:${region.type}`);
  if (region?.bank != null) tags.add(`bank:${String(region.bank).padStart(2, '0')}`);
  if (region?.confidence) tags.add(`confidence:${region.confidence}`);
  if (region?.source) tags.add(`source:${region.source}`);
  if (labelState) tags.add(`label:${labelState}`);
  for (const capability of wb3DecoderArray(decoder?.previewCapabilities)) tags.add(`preview:${capability}`);
  for (const key of Object.keys(wb3DecoderObject(region?.analysis)).slice(0, 16)) tags.add(`audit:${key}`);
  return [...tags].sort();
}

function wb3ResolveAssetRegion(asset, map) {
  const regions = wb3DecoderRegionsById(map);
  const candidates = [];
  let order = 0;
  for (const ref of wb3DecoderArray(asset?.references)) {
    if ((ref.kind || ref.type) !== 'region' || !regions.has(ref.id)) continue;
    const region = regions.get(ref.id);
    const decoders = wb3DecodersForRegionType(region.type || '');
    const role = String(ref.role || '').toLowerCase();
    let score = 0;
    if (decoders.some(decoder => wb3DecoderArray(decoder.assetKinds).includes(asset?.kind || ''))) score += 80;
    if (role.includes('source') || role.includes('payload') || role.includes('primary')) score += 20;
    if (role.includes('screen') && (region.type || '').includes('screen')) score += 18;
    if (role.includes('palette') && region.type === 'palette') score += 18;
    if (role.includes('loader') && (region.type || '').includes('vram_loader')) score += 18;
    if (role.includes('tile') && (region.type || '').includes('gfx')) score += 18;
    if (role.includes('runtime_consumer')) score -= 30;
    if (!decoders.length) score -= 10;
    candidates.push({ region, score, order: order++ });
  }
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  return candidates[0]?.region || null;
}

function wb3DecodersForRegionType(type) {
  return WB3_DECODER_DEFS
    .filter(decoder => wb3DecoderArray(decoder.regionTypes).includes(type))
    .sort((a, b) => b.implementationPercent - a.implementationPercent || a.id.localeCompare(b.id));
}

function wb3DecodersForAsset(asset, region) {
  const regionType = region?.type || '';
  const regionMatches = [];
  const assetMatches = [];
  const specialMatches = [];
  for (const decoder of WB3_DECODER_DEFS) {
    if (regionType && wb3DecoderArray(decoder.regionTypes).includes(regionType)) regionMatches.push(decoder);
    else if (wb3DecoderAssetsMatchKind(asset, decoder)) assetMatches.push(decoder);
    if (decoder.id === 'collision_runtime_catalogs' && wb3IsCollisionRuntimeRegion(region) && !regionMatches.includes(decoder) && !specialMatches.includes(decoder)) {
      specialMatches.push(decoder);
    }
    if (decoder.id === 'audio_driver_runtime_metadata' && wb3IsAudioDriverRuntimeRegion(region) && !regionMatches.includes(decoder) && !specialMatches.includes(decoder)) {
      specialMatches.push(decoder);
    }
    if (decoder.id === 'text_menu_status_records' && wb3IsTextMenuStatusRegion(region) && !regionMatches.includes(decoder) && !specialMatches.includes(decoder)) {
      specialMatches.push(decoder);
    }
  }
  const out = regionMatches.length ? regionMatches.concat(specialMatches) : assetMatches.concat(specialMatches);
  return [...new Map(out.map(decoder => [decoder.id, decoder])).values()]
    .sort((a, b) => b.implementationPercent - a.implementationPercent || a.id.localeCompare(b.id));
}

function wb3PreferredDecoderForAsset(asset, region, decoderId) {
  const decoders = wb3DecodersForAsset(asset, region);
  if (decoderId) return decoders.find(decoder => decoder.id === decoderId) || null;
  return decoders[0] || null;
}

function wb3RegionBytes(rom, region) {
  const offset = wb3DecoderParseOffset(region?.offset);
  const size = Number(region?.size || 0);
  if (!rom || offset == null || !Number.isFinite(size) || size <= 0) return null;
  return rom.subarray(offset, Math.min(rom.length, offset + size));
}

function wb3MakeDecodeResult(decoder, asset, region, status, summary, metrics, warnings, transientPreview) {
  return {
    decoderId: decoder?.id || '',
    decoderLabel: decoder?.label || '',
    familyId: decoder?.familyId || '',
    status,
    assetId: asset?.id || '',
    regionId: region?.id || '',
    regionType: region?.type || '',
    summary: summary || '',
    metrics: metrics || {},
    warnings: warnings || [],
    transientPreview: transientPreview || null,
    assetPolicy: 'Runtime preview only; do not persist decoded ROM bytes, pixels, palette values or audio samples.',
  };
}

function wb3FindGraphicsCatalog(map, id) {
  return wb3DecoderArray(map?.graphicsCatalogs).find(catalog => catalog?.id === id) || null;
}

function wb3FindTileSourceCatalog(map, id) {
  return wb3DecoderArray(map?.tileSourceCatalogs).find(catalog => catalog?.id === id) || null;
}

function wb3GraphicsRegionEntry(catalog, region, arrayName) {
  const entries = wb3DecoderArray(catalog?.[arrayName || 'entries']);
  return entries.find(entry => {
    const ref = entry?.region || entry?.sourceRegion;
    if (ref?.id && ref.id === region?.id) return true;
    const refOffset = wb3DecoderParseOffset(ref?.offset || entry?.offset);
    const regionOffset = wb3DecoderParseOffset(region?.offset);
    return refOffset != null && regionOffset != null && refOffset === regionOffset;
  }) || null;
}

function wb3GraphicsLayoutForRegion(map, region) {
  const catalog = wb3FindGraphicsCatalog(map, 'world-graphics-combined-incbin-layout-catalog-2026-06-26');
  for (const layout of wb3DecoderArray(catalog?.layouts)) {
    for (const segment of wb3DecoderArray(layout?.segments)) {
      if (segment?.region?.id === region?.id) {
        return {
          catalogId: catalog.id || '',
          layoutId: layout.id || '',
          incbinSpanId: layout.incbinSpanId || '',
          asmLine: layout.asmLine ?? null,
          bank: layout.bank || '',
          coverageStatus: layout.coverageStatus || '',
          segmentRole: segment.role || '',
          confidence: segment.confidence || '',
          priorityGroup: segment.priorityGroup || '',
          reason: segment.reason || '',
          combinedSourceFamilies: wb3DecoderArray(segment.combinedSourceFamilies),
          segmentIndex: segment.index ?? null,
          sourceFamilies: wb3DecoderArray(segment.sourceFamilies),
          remainingLead: segment.remainingLead || null,
        };
      }
    }
  }
  return null;
}

function wb3GraphicsSceneRecipeUsages(map, region, limit) {
  const usages = [];
  for (const catalog of wb3DecoderArray(map?.sceneRecipeCatalogs)) {
    for (const usage of wb3DecoderArray(catalog?.summary?.sourceGroupUsage)) {
      if (usage?.sourceRegion?.id !== region?.id) continue;
      usages.push({
        catalogId: catalog.id || '',
        loaderType: usage.loaderType || '',
        loaderRegion: usage.loaderRegion || null,
        sourceStart: usage.sourceStart || '',
        recipeCount: Number(usage.recipeCount || 0),
        slotCount: Number(usage.slotCount || 0),
        sampleRecipeIds: wb3DecoderArray(usage.sampleRecipeIds).slice(0, 12),
      });
    }
  }
  return usages.slice(0, limit || 64);
}

function wb3GraphicsSourceRegionEntries(map, region, limit) {
  const out = [];
  const sourceCatalogSpecs = [
    ['world-player-a48-tile-stream-catalog-2026-06-26', 'tileSourceCatalogs', ['sourceGraphicsRegions', 'candidateSourceGraphicsRegions'], 'player_a48_tile_stream'],
    ['world-dynamic-tile-source-table-catalog-2026-06-25', 'tileSourceCatalogs', ['sourceGraphicsRegions'], 'dynamic_entity_tile_loader'],
    ['world-status-tile-source-range-catalog-2026-06-26', 'tileSourceCatalogs', ['entries'], 'status_tile_upload'],
    ['world-vram998-entrypoint-variant-catalog-2026-06-26', 'tileSourceCatalogs', ['entries'], 'vram998_entrypoint_variant_loader'],
  ];
  for (const [catalogId, collectionName, arrayNames, family] of sourceCatalogSpecs) {
    const catalog = wb3DecoderArray(map?.[collectionName]).find(item => item?.id === catalogId) || null;
    if (!catalog) continue;
    for (const arrayName of arrayNames) {
      for (const entry of wb3DecoderArray(catalog?.[arrayName])) {
        const ref = entry?.region || entry?.sourceRegion || (entry?.sourceRange?.start ? wb3FindRegionAtOffset(map, wb3DecoderParseOffset(entry.sourceRange.start)) : null);
        if (ref?.id !== region?.id) continue;
        out.push({
          catalogId,
          arrayName,
          family,
          region: ref,
          uniqueBytes: entry.uniqueBytes ?? entry.sourceRange?.sizeBytes ?? null,
          tileBlocks: entry.tileBlocks ?? entry.sourceRange?.tileCount ?? null,
          spanCount: wb3DecoderArray(entry.spans).length || null,
          sourceRange: entry.sourceRange || null,
          confidence: entry.confidence || '',
          status: entry.status || '',
        });
        if (limit && out.length >= limit) return out;
      }
    }
  }
  return out.slice(0, limit || 64);
}

function wb3GraphicsAnalysisEntries(region, limit) {
  return wb3AnalysisEntriesForKeys(region, [
    ['graphicsCoverageAudit', 'static_loader_source_coverage'],
    ['graphicsUnreferencedSpanAudit', 'static_loader_unreferenced_spans'],
    ['graphicsCombinedSourceCoverageAudit', 'combined_source_coverage'],
    ['graphicsCombinedUnreferencedShapeAudit', 'combined_unreferenced_shape'],
    ['graphicsCombinedIncbinLayoutAudit', 'combined_incbin_layout'],
    ['graphicsIncbinSplitLayoutAudit', 'incbin_split_layout'],
    ['dynamicTileSourceTableAudit', 'dynamic_tile_source'],
    ['playerA48TileStreamAudit', 'player_a48_tile_source'],
    ['statusTileSourceRangeAudit', 'status_tile_source'],
    ['statusVdpWriterDetailAudit', 'status_vdp_writer'],
    ['pauseStatusLoaderSourceCoverage', 'pause_status_candidate_source'],
    ['pauseStatusCandidateCoverageDisambiguation', 'pause_status_candidate_disambiguation'],
    ['graphicsUnresolvedSourceProbeAudit', 'unresolved_source_probe'],
    ['graphicsSparseSourceGapAudit', 'sparse_source_gap'],
    ['graphicsUntracedSourceWordAudit', 'untraced_source_word_scan'],
    ['graphicsLoaderLikeWordHitResolverAudit', 'loader_like_word_hit_resolver'],
    ['graphicsRemainingLeadReconciliationAudit', 'remaining_lead_reconciliation'],
    ['graphicsSourceWordContextAudit', 'source_word_context'],
    ['graphicsStructuredSourceOccurrenceAudit', 'structured_source_occurrence'],
    ['graphicsDirectSourceAddressAudit', 'direct_source_address_scan'],
    ['graphicsSourceTraceQueueAudit', 'source_trace_queue'],
    ['graphicsDynamicSourceTraceSeedAudit', 'dynamic_source_trace_seed'],
    ['graphicsDynamicSourceLocalVerifierAudit', 'dynamic_source_local_verifier'],
    ['graphicsDynamicRoutePriorityAudit', 'dynamic_route_priority'],
    ['dynamicGraphicsRuntimeHookIndexAudit', 'dynamic_graphics_runtime_hook_index'],
    ['dynamicGraphicsRuntimeHookFixtureAudit', 'dynamic_graphics_runtime_hook_fixture'],
    ['asmIncbinSpanAudit', 'asm_incbin_span'],
    ['asmDataLabelCensusAudit', 'asm_data_label'],
    ['asmLabelRegionAudit', 'asm_label_region'],
  ]).slice(0, limit || 128);
}

function wb3TileShapeStats(rom, offset, tileCount, limit) {
  const capped = Math.min(tileCount, limit || tileCount);
  let blankTileCount = 0;
  let nonblankTileCount = 0;
  let maxColorIndex = 0;
  const colorUseCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 };
  for (let tile = 0; tile < capped; tile++) {
    const tileOffset = offset + tile * 32;
    if (tileOffset + 31 >= rom.length || typeof decodeTile !== 'function') break;
    const pixels = decodeTile(rom, tileOffset);
    let blank = true;
    for (const colorIndex of pixels) {
      const ci = Number(colorIndex || 0) & 0x0f;
      colorUseCounts[ci] = (colorUseCounts[ci] || 0) + 1;
      if (ci) {
        blank = false;
        if (ci > maxColorIndex) maxColorIndex = ci;
      }
    }
    if (blank) blankTileCount++;
    else nonblankTileCount++;
  }
  return {
    scannedTileCount: capped,
    blankTileCount,
    nonblankTileCount,
    maxColorIndex,
    colorUseCounts,
  };
}

function wb3CollectGraphicsTileMetadata(map, region, options) {
  const coverageCatalog = wb3FindGraphicsCatalog(map, 'world-graphics-coverage-catalog-2026-06-24');
  const combinedCatalog = wb3FindGraphicsCatalog(map, 'world-graphics-combined-source-coverage-catalog-2026-06-26');
  const unrefShapeCatalog = wb3FindGraphicsCatalog(map, 'world-graphics-combined-unreferenced-shape-catalog-2026-06-26');
  const coverageEntry = wb3GraphicsRegionEntry(coverageCatalog, region, 'entries');
  const combinedEntry = wb3GraphicsRegionEntry(combinedCatalog, region, 'entries');
  const unrefShapeRegion = wb3GraphicsRegionEntry(unrefShapeCatalog, region, 'regions');
  const layout = wb3GraphicsLayoutForRegion(map, region);
  const sceneRecipeUsages = wb3GraphicsSceneRecipeUsages(map, region, options.graphicsSceneUsagePreviewLimit || 64);
  const sourceRegionEntries = wb3GraphicsSourceRegionEntries(map, region, options.graphicsSourceRegionPreviewLimit || 64);
  const analysisEntries = wb3GraphicsAnalysisEntries(region, options.graphicsAnalysisPreviewLimit || 128);
  return {
    coverageCatalogId: coverageCatalog?.id || '',
    combinedCoverageCatalogId: combinedCatalog?.id || '',
    unreferencedShapeCatalogId: unrefShapeCatalog?.id || '',
    coverageEntry,
    combinedEntry,
    unreferencedShape: unrefShapeRegion,
    layout,
    sceneRecipeUsages,
    sourceRegionEntries,
    analysisEntries,
    counts: {
      coverageResolved: !!coverageEntry,
      combinedCoverageResolved: !!combinedEntry,
      unreferencedShapeResolved: !!unrefShapeRegion,
      layoutResolved: !!layout,
      sceneRecipeUsageCount: sceneRecipeUsages.length,
      sourceRegionEntryCount: sourceRegionEntries.length,
      analysisEntryCount: analysisEntries.length,
      ownerResolved: !!combinedEntry || !!coverageEntry || !!layout || sceneRecipeUsages.length > 0 || sourceRegionEntries.length > 0 || analysisEntries.length > 0,
    },
  };
}

function wb3DecodeTileRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const size = Number(region.size || 0);
  const tileCount = Math.floor(size / 32);
  const previewLimit = Math.max(0, Math.min(tileCount, options.previewTileLimit || 64));
  const shapeStats = wb3TileShapeStats(rom, offset, tileCount, options.graphicsShapeScanLimit || tileCount);
  const metadata = wb3CollectGraphicsTileMetadata(map, region, options);
  const combined = metadata.combinedEntry || {};
  const coverage = metadata.coverageEntry || {};
  const warnings = [];
  if (size % 32) warnings.push('Region size is not a multiple of 32 bytes.');
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${tileCount} SMS 4bpp tile(s) at ${region.offset}; ${Number(combined.coveragePercent ?? coverage.coveragePercent ?? 0).toFixed(2)}% source coverage; ${metadata.counts.sceneRecipeUsageCount} scene recipe source use(s).`,
    {
      offset,
      size,
      tileCount,
      previewTileCount: previewLimit,
      tileAligned: size % 32 === 0,
      blankTileCount: shapeStats.blankTileCount,
      nonblankTileCount: shapeStats.nonblankTileCount,
      maxColorIndex: shapeStats.maxColorIndex,
      colorUseCounts: shapeStats.colorUseCounts,
      staticLoaderReferencedTiles: coverage.uniqueReferencedTiles ?? null,
      staticLoaderCoveragePercent: coverage.coveragePercent ?? null,
      combinedReferencedTiles: combined.uniqueReferencedTiles ?? null,
      combinedCoveragePercent: combined.coveragePercent ?? null,
      combinedSourceFamilyCount: combined.combinedSourceFamilyCount ?? 0,
      sourceRangeCount: combined.sourceRangeCount ?? coverage.sourceRangeCount ?? 0,
      unreferencedTiles: combined.unreferencedTiles ?? coverage.unreferencedTiles ?? 0,
      unreferencedSpanCount: combined.unreferencedSpanCount ?? coverage.unreferencedSpans?.length ?? 0,
      unreferencedShapeTileCount: metadata.unreferencedShape?.tileCount ?? 0,
      sceneRecipeUsageCount: metadata.counts.sceneRecipeUsageCount,
      sourceRegionEntryCount: metadata.counts.sourceRegionEntryCount,
      analysisEntryCount: metadata.counts.analysisEntryCount,
      layoutResolved: metadata.counts.layoutResolved,
      ownerResolved: metadata.counts.ownerResolved,
    },
    warnings,
    options.includeTransientPreview ? {
      kind: 'tile_canvas',
      offset,
      tileCount: previewLimit,
      totalTileCount: tileCount,
      shapeStats,
      metadata,
      assetPolicy: 'Transient local-ROM SMS tile preview. The browser renders pixels in memory only; persisted metadata contains offsets, counts, source-family provenance, scene usage and evidence, never tile bytes or pixels.',
    } : null);
}

function wb3FindPaletteTableCatalog(map) {
  return wb3DecoderArray(map?.paletteCatalogs)
    .find(catalog => catalog?.id === 'world-palette-table-catalog-2026-06-24') || null;
}

function wb3FindPaletteWriterCatalog(map) {
  return wb3DecoderArray(map?.paletteCatalogs)
    .find(catalog => catalog?.id === 'world-sprite-palette-writer-catalog-2026-06-25') || null;
}

function wb3FindPaletteInheritanceCatalog(map) {
  return wb3DecoderArray(map?.paletteCatalogs)
    .find(catalog => catalog?.id === 'world-sprite-palette-inheritance-catalog-2026-06-25') || null;
}

function wb3PaletteRecordMatchesRegion(record, region) {
  if (!record || !region) return false;
  const regionId = region.id || '';
  if (regionId && record.region?.id === regionId) return true;
  const regionOffset = wb3DecoderParseOffset(region.offset);
  const recordOffset = wb3DecoderParseOffset(record.offset || record.region?.offset);
  return regionOffset != null && recordOffset != null && regionOffset === recordOffset;
}

function wb3FindPaletteTableRecord(map, region) {
  const catalog = wb3FindPaletteTableCatalog(map);
  const record = wb3DecoderArray(catalog?.records).find(item => wb3PaletteRecordMatchesRegion(item, region)) || null;
  return { catalog, record };
}

function wb3PaletteRoleFromRecipeKind(kind, sourceStepType) {
  const text = `${kind || ''} ${sourceStepType || ''}`.toLowerCase();
  if (text.includes('sprite') || text.includes('spr')) return 'sprite';
  if (text.includes('bg') || text.includes('background')) return 'bg';
  return 'palette';
}

function wb3CollectPaletteSceneUsage(map, region, limit) {
  const usages = [];
  const roleCounts = {};
  for (const recipe of wb3DecoderArray(map?.sceneRecipes)) {
    for (const step of wb3DecoderArray(recipe?.steps)) {
      if (step?.regionId !== region?.id) continue;
      const role = wb3PaletteRoleFromRecipeKind(step.kind, step.sourceStepType);
      roleCounts[role] = (roleCounts[role] || 0) + 1;
      usages.push({
        recipeId: recipe.id || '',
        recipeName: recipe.name || '',
        stepOrder: Number(step.order || 0),
        kind: step.kind || '',
        role,
        sourceStepType: step.sourceStepType || '',
        bank: step.bank ?? '',
        provenanceSource: step.provenance?.source || '',
        confidence: recipe.confidence || '',
      });
    }
  }
  return {
    usages: usages.slice(0, limit || 128),
    count: usages.length,
    roleCounts,
  };
}

function wb3PaletteStateEffectMatchesRegion(effect, region, recordIndex) {
  if (!effect) return false;
  if (effect.record?.region?.id && effect.record.region.id === region?.id) return true;
  const effectOffset = wb3DecoderParseOffset(effect.record?.offset || effect.record?.region?.offset);
  const regionOffset = wb3DecoderParseOffset(region?.offset);
  if (effectOffset != null && regionOffset != null && effectOffset === regionOffset) return true;
  return recordIndex != null && Number(effect.index) === Number(recordIndex);
}

function wb3CollectPaletteWriterUsage(map, region, tableRecord, limit) {
  const catalog = wb3FindPaletteWriterCatalog(map);
  const usages = [];
  const roleCounts = {};
  const recordIndex = tableRecord?.index ?? null;
  for (const site of wb3DecoderArray(catalog?.writerCallsites)) {
    const pairs = [
      ['bg', site.stateEffects?.bgPalette],
      ['sprite', site.stateEffects?.spritePalette],
    ];
    for (const [role, effect] of pairs) {
      if (!wb3PaletteStateEffectMatchesRegion(effect, region, recordIndex)) continue;
      roleCounts[role] = (roleCounts[role] || 0) + 1;
      usages.push({
        id: site.id || '',
        role,
        action: site.action || effect?.status || '',
        contextRole: site.contextRole || '',
        contextFamily: site.contextFamily || '',
        callerLabel: site.caller?.label || '',
        callerOffset: site.caller?.offset || '',
        callLine: site.caller?.line || site.line || '',
        sourceLine: effect?.sourceLine || site.preparedPair?.sourceLine || '',
        confidence: site.confidence || '',
      });
    }
  }
  return {
    catalog,
    usages: usages.slice(0, limit || 128),
    count: usages.length,
    roleCounts,
  };
}

function wb3CollectPaletteScriptBridge(map) {
  const catalog = wb3FindPaletteScriptCatalog(map);
  if (!catalog) return null;
  return {
    sourceCatalogId: catalog.id || '',
    loaderLabel: catalog.loader?.label || '_LABEL_10BC_',
    pointerTable: catalog.loader?.tableLabel || '_DATA_1C800_',
    indexRam: catalog.loader?.indexRam || '_RAM_CF65_',
    activePointerRam: catalog.loader?.activePointerRam || '_RAM_D020_',
    delayRam: catalog.loader?.delayRam || '_RAM_D022_',
    scriptCount: Number(catalog.summary?.scripts || wb3DecoderArray(catalog.scripts).length || 0),
    directIndexWrites: Number(catalog.summary?.directIndexWrites || 0),
    dynamicIndexWrites: Number(catalog.summary?.dynamicIndexWrites || 0),
    sentinelIndexWrites: Number(catalog.summary?.sentinelIndexWrites || 0),
    bufferWritesAreOverlays: true,
    evidence: wb3DecoderArray(catalog.loader?.evidence).slice(0, 3),
  };
}

function wb3CollectPaletteInheritanceSummary(map, region, tableRecord) {
  const catalog = wb3FindPaletteInheritanceCatalog(map);
  if (!catalog) return null;
  const recordIndex = tableRecord?.index ?? null;
  const initializerMatches = wb3DecoderArray(catalog.directInitializerPaths).filter(path => {
    return recordIndex != null && (
      Number(path.bgIndex) === Number(recordIndex) ||
      Number(path.spriteIndex) === Number(recordIndex)
    );
  });
  const roomLoadMatches = wb3DecoderArray(catalog.roomLoadCallsites).filter(site => {
    const state = site.spritePaletteStateBeforeCall || {};
    return recordIndex != null && Number(state.spriteIndex) === Number(recordIndex);
  });
  return {
    sourceCatalogId: catalog.id || '',
    ownerStatus: catalog.recipeInheritanceModel?.ownerStatus || '',
    dependencyPath: catalog.recipeInheritanceModel?.dependencyPath || '',
    rendererExpectation: catalog.recipeInheritanceModel?.rendererExpectation || '',
    preservedSpritePaletteRecipeCount: Number(catalog.summary?.preservedSpritePaletteRecipeCount || 0),
    inheritanceRefRecipeCount: Number(catalog.summary?.inheritanceRefRecipeCount || 0),
    runtimePriorPathClassCounts: catalog.summary?.runtimePriorPathClassCounts || {},
    matchingInitializerPathCount: initializerMatches.length,
    matchingRoomLoadCallsiteCount: roomLoadMatches.length,
    cachedRestorePathCount: wb3DecoderArray(catalog.cachedRestorePaths).length,
    appliesToThisRecord: initializerMatches.length > 0 || roomLoadMatches.length > 0,
    regionId: region?.id || '',
  };
}

function wb3DecodePaletteRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const count = Math.max(0, Math.min(Number(region.size || 16), options.paletteCount || 32));
  const colors = options.includeTransientPreview && typeof decodePaletteAt === 'function'
    ? decodePaletteAt(rom, offset, count)
    : null;
  const table = wb3FindPaletteTableRecord(map, region);
  const sceneUsage = wb3CollectPaletteSceneUsage(map, region, options.paletteUsagePreviewLimit || 128);
  const writerUsage = wb3CollectPaletteWriterUsage(map, region, table.record, options.paletteUsagePreviewLimit || 128);
  const scriptBridge = wb3CollectPaletteScriptBridge(map);
  const inheritanceSummary = wb3CollectPaletteInheritanceSummary(map, region, table.record);
  const warnings = [];
  if (!table.record) warnings.push('No palette table record metadata is linked to this region yet.');
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${count} SMS CRAM color entr${count === 1 ? 'y' : 'ies'} at ${region.offset}`,
    {
      offset,
      colorCount: count,
      implementationPercent: decoder.implementationPercent,
      paletteTableCatalogId: table.catalog?.id || null,
      paletteRecordIndex: table.record?.index ?? null,
      directBgCallsiteCount: Number(table.record?.usedAsBgByDirectCallsites || 0),
      directSpriteCallsiteCount: Number(table.record?.usedAsSpriteByDirectCallsites || 0),
      sceneUsageCount: sceneUsage.count,
      bgSceneUsageCount: Number(sceneUsage.roleCounts.bg || 0),
      spriteSceneUsageCount: Number(sceneUsage.roleCounts.sprite || 0),
      writerUsageCount: writerUsage.count,
      bgWriterUsageCount: Number(writerUsage.roleCounts.bg || 0),
      spriteWriterUsageCount: Number(writerUsage.roleCounts.sprite || 0),
      paletteScriptCatalogId: scriptBridge?.sourceCatalogId || null,
      paletteScriptCount: scriptBridge?.scriptCount || 0,
      inheritanceCatalogId: inheritanceSummary?.sourceCatalogId || null,
      inheritanceRefRecipeCount: inheritanceSummary?.inheritanceRefRecipeCount || 0,
    },
    warnings,
    colors ? {
      kind: 'palette_swatches',
      colors,
      tableRecord: table.record || null,
      tableCatalogId: table.catalog?.id || '',
      sceneUsages: sceneUsage.usages,
      sceneUsageCount: sceneUsage.count,
      sceneRoleCounts: sceneUsage.roleCounts,
      writerUsages: writerUsage.usages,
      writerUsageCount: writerUsage.count,
      writerRoleCounts: writerUsage.roleCounts,
      writerCatalogId: writerUsage.catalog?.id || '',
      scriptBridge,
      inheritanceSummary,
      assetPolicy: 'Transient local-ROM palette colors are rendered in memory only; persisted metadata contains offsets, region ids, counts, labels and evidence, never CRAM values.',
    } : null);
}

function wb3TileMapDimensions(entryCount, region) {
  const candidates = [];
  const knownName = String(region?.name || region?.notes || '').toLowerCase();
  if (entryCount === 32 * 28) candidates.push({ cols: 32, rows: 28, reason: 'full SMS visible name table' });
  if (entryCount === 32 * 32) candidates.push({ cols: 32, rows: 32, reason: 'full SMS name table' });
  for (const cols of [32, 16, 8, 4, 2]) {
    if (entryCount >= cols && entryCount % cols === 0) {
      candidates.push({ cols, rows: entryCount / cols, reason: `${cols}-column exact fit` });
    }
  }
  if (!candidates.length) {
    const cols = entryCount > 32 ? 32 : Math.max(1, Math.min(entryCount, knownName.includes('marker') ? 2 : 16));
    candidates.push({ cols, rows: Math.ceil(entryCount / cols), reason: 'preview layout fallback' });
  }
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = `${candidate.cols}x${candidate.rows}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function wb3FindDynamicTileSourceCatalog(map) {
  return wb3DecoderArray(map?.tileSourceCatalogs)
    .find(catalog => catalog?.id === 'world-dynamic-tile-source-table-catalog-2026-06-25') || null;
}

function wb3DynamicTileStreamsForRegion(map, region, limit) {
  const catalog = wb3FindDynamicTileSourceCatalog(map);
  const regionStart = wb3DecoderParseOffset(region?.offset);
  const regionEnd = regionStart == null ? null : regionStart + Number(region?.size || 0);
  const streams = wb3DecoderArray(catalog?.streams).filter(stream => {
    if (stream?.targetRegion?.id && stream.targetRegion.id === region?.id) return true;
    const start = wb3DecoderParseOffset(stream?.streamRomOffset);
    return start != null && regionStart != null && start >= regionStart && start < regionEnd;
  }).map(stream => ({
    streamRomOffset: stream.streamRomOffset || '',
    streamZ80Address: stream.streamZ80Address || '',
    targetRegion: stream.targetRegion || null,
    referencedByCount: Number(stream.referencedByCount || 0),
    referencedBy: wb3DecoderArray(stream.referencedBy).slice(0, 12),
    remapRows: wb3DecoderArray(stream.remapRows),
    decoded: stream.decoded ? {
      consumedBytes: Number(stream.decoded.consumedBytes || 0),
      endInclusive: stream.decoded.endInclusive || '',
      terminated: !!stream.decoded.terminated,
      sourceRecordCount: Number(stream.decoded.sourceRecordCount || 0),
      destinationResetCount: Number(stream.decoded.destinationResetCount || 0),
      zeroFillTileBlocks: Number(stream.decoded.zeroFillTileBlocks || 0),
      totalTileBlocks: Number(stream.decoded.totalTileBlocks || 0),
      sourceBanks: wb3DecoderArray(stream.decoded.sourceBanks),
      sourceRegionIds: wb3DecoderArray(stream.decoded.sourceRegionIds),
      warningCount: wb3DecoderArray(stream.decoded.warnings).length,
      recordPreview: wb3DecoderArray(stream.decoded.recordPreview).slice(0, 12),
    } : null,
  }));
  return {
    catalogId: catalog?.id || '',
    summary: catalog?.summary || null,
    streams: streams.slice(0, limit || 128),
    totalStreamCount: streams.length,
    totalSourceRecordCount: streams.reduce((sum, stream) => sum + Number(stream.decoded?.sourceRecordCount || 0), 0),
    totalTileBlocks: streams.reduce((sum, stream) => sum + Number(stream.decoded?.totalTileBlocks || 0), 0),
    warningCount: streams.reduce((sum, stream) => sum + Number(stream.decoded?.warningCount || 0), 0),
    sourceRegionIds: [...new Set(streams.flatMap(stream => wb3DecoderArray(stream.decoded?.sourceRegionIds)))].sort(),
  };
}

function wb3TileMapAnalysisEntries(region, limit) {
  return wb3AnalysisEntriesForKeys(region, [
    ['dc2ScrollMapAudit', 'dc2_compressed_scroll_map_stream'],
    ['dc2TilePairLookupAudit', 'dc2_tile_pair_lookup'],
    ['dynamicTileSourceTableAudit', 'dynamic_tile_source_stream'],
    ['roomEntityDynamicTileAudit', 'room_entity_dynamic_tile_source'],
    ['roomEntityFrameGapVramWriterAudit', 'room_entity_frame_gap_vram_writer'],
    ['roomEntityFrameTileGapAudit', 'room_entity_frame_tile_gap'],
    ['paletteTailLoaderWordShapeSourceAudit', 'palette_tail_loader_word_shape_source'],
    ['statusVdpWriterDetailAudit', 'status_vdp_writer_payload'],
    ['smallDataAudit', 'small_structured_data'],
    ['roomLoaderDataAudit', 'room_loader_data'],
    ['roomOverlayRecordAudit', 'room_overlay_record'],
    ['inlineTransitionRecipeAudit', 'inline_transition_recipe_source'],
    ['roomOverlayIndexBoundAudit', 'room_overlay_index_bound'],
    ['roomEventTableAudit', 'room_event_table'],
    ['roomEventKeySemanticsAudit', 'room_event_key_semantics'],
    ['roomOverlayTailStaticBoundProofAudit', 'room_overlay_tail_static_bound'],
    ['graphicsUntracedSourceWordContextAudit', 'graphics_source_word_context'],
    ['structuredGraphicsSourceWordLeadAudit', 'structured_graphics_source_word_lead'],
    ['uiPlayerTransitionTableAudit', 'ui_player_transition_table'],
    ['asmAssetAudit', 'asm_asset_source'],
    ['asmDataLabelCensusAudit', 'asm_data_label'],
    ['asmLabelRegionAudit', 'asm_label_region'],
  ]).slice(0, limit || 96);
}

function wb3DecodeDynamicTileLoaderLayoutRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const size = Number(region.size || 0);
  const dynamic = wb3DynamicTileStreamsForRegion(map, region, options.dynamicTileStreamPreviewLimit || 128);
  const analysisEntries = wb3TileMapAnalysisEntries(region, options.tileMapAnalysisPreviewLimit || 96);
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${dynamic.totalStreamCount} dynamic tile stream start(s), ${dynamic.totalSourceRecordCount} source record(s), ${dynamic.totalTileBlocks} tile block(s).`,
    {
      offset,
      size,
      layoutKind: 'dynamic_tile_loader_stream_bundle',
      dynamicStreamCount: dynamic.totalStreamCount,
      sourceRecordCount: dynamic.totalSourceRecordCount,
      totalTileBlocks: dynamic.totalTileBlocks,
      dynamicWarningCount: dynamic.warningCount,
      sourceGraphicsRegionCount: dynamic.sourceRegionIds.length,
      analysisEntryCount: analysisEntries.length,
      catalogId: dynamic.catalogId,
      ownerResolved: dynamic.totalStreamCount > 0 || analysisEntries.length > 0,
    },
    [],
    options.includeTransientPreview ? {
      kind: 'dynamic_tile_loader_layout',
      dynamic,
      analysisEntries,
      assetPolicy: 'Metadata-only dynamic tile source preview. Offsets, counts, source-region ids and record roles are shown; ROM tile bytes and decoded pixels are not stored.',
    } : null);
}

function wb3DecodeTileMapRegion(asset, region, rom, map, decoder, options) {
  if (region?.type === 'dynamic_tile_loader') return wb3DecodeDynamicTileLoaderLayoutRegion(asset, region, rom, map, decoder, options);
  const offset = wb3DecoderParseOffset(region.offset);
  const bytes = wb3RegionBytes(rom, region);
  if (!bytes) return wb3MakeDecodeResult(decoder, asset, region, 'needs_rom', 'Load the local ROM to decode this tile map.', {}, [], null);
  const size = bytes.length;
  const dc2Probe = typeof wb3BuildDc2ProbeForRegion === 'function' ? wb3BuildDc2ProbeForRegion(rom, map, region, options) : null;
  const analysisEntries = wb3TileMapAnalysisEntries(region, options.tileMapAnalysisPreviewLimit || 96);
  if (dc2Probe?.kind === 'dc2_stream') {
    const decoded = dc2Probe.decoded || {};
    const warnings = wb3DecoderArray(decoded.warnings);
    return wb3MakeDecodeResult(decoder, asset, region, warnings.length ? 'partial' : 'decoded',
      `DC2 compressed scroll-map stream: ${decoded.writtenCells || 0}/${decoded.expectedCells || 176} cell(s), ${decoded.runtimeConsumedBytes || 0} byte(s), ${decoded.opCount || 0} op(s).`,
      {
        offset,
        size,
        layoutKind: 'dc2_compressed_scroll_map_stream',
        runtimeConsumedBytes: decoded.runtimeConsumedBytes || 0,
        writtenCells: decoded.writtenCells || 0,
        expectedCells: decoded.expectedCells || 176,
        rows: decoded.rows || 11,
        columns: decoded.columns || 16,
        opCount: decoded.opCount || 0,
        maxRunLength: decoded.maxRunLength || 0,
        endReason: decoded.endReason || '',
        descriptorCount: dc2Probe.descriptorCount ?? null,
        streamSlotCount: wb3DecoderArray(dc2Probe.streamSlots).length,
        analysisEntryCount: analysisEntries.length,
        catalogId: dc2Probe.catalogId || '',
        ownerResolved: !!dc2Probe.catalogId || analysisEntries.length > 0,
      },
      warnings,
      options.includeTransientPreview ? {
        kind: 'dc2_tile_map_stream',
        dc2: dc2Probe,
        analysisEntries,
      } : null);
  }
  if (dc2Probe?.kind === 'dc2_tile_pair_lookup') {
    return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
      `DC2 tile-pair lookup: ${dc2Probe.recordCount || 0} record(s), ${dc2Probe.uniqueLookupRecordIndicesUsed || 0} used by ${dc2Probe.dc2StreamsDecoded || 0} decoded stream(s).`,
      {
        offset,
        size,
        layoutKind: 'dc2_tile_pair_lookup',
        lookupRecordCount: dc2Probe.recordCount || 0,
        uniqueLookupRecordIndicesUsed: dc2Probe.uniqueLookupRecordIndicesUsed || 0,
        dc2StreamsDecoded: dc2Probe.dc2StreamsDecoded || 0,
        outOfRangeCellCount: dc2Probe.outOfRangeCellCount || 0,
        warningStreamCount: dc2Probe.warningStreamCount || 0,
        analysisEntryCount: analysisEntries.length,
        catalogId: dc2Probe.catalogId || '',
        ownerResolved: !!dc2Probe.catalogId || analysisEntries.length > 0,
      },
      [],
      options.includeTransientPreview ? {
        kind: 'tile_map_catalog_layout',
        catalogModel: dc2Probe,
        analysisEntries,
      } : null);
  }
  const useWords = size >= 2 && (size % 2 === 0);
  const entries = [];
  const uniqueTiles = new Set();
  let hflipCount = 0;
  let vflipCount = 0;
  let paletteSelectCount = 0;
  let priorityCount = 0;
  let unusedHighBitCount = 0;
  let maxTile = 0;
  if (useWords) {
    for (let i = 0; i + 1 < size; i += 2) {
      const word = bytes[i] | (bytes[i + 1] << 8);
      const tile = word & 0x01ff;
      const entry = {
        index: i >> 1,
        offset: offset + i,
        word,
        tile,
        hflip: !!(word & 0x0200),
        vflip: !!(word & 0x0400),
        palette: !!(word & 0x0800),
        priority: !!(word & 0x1000),
        unusedHighBits: (word >> 13) & 0x07,
      };
      if (entry.hflip) hflipCount++;
      if (entry.vflip) vflipCount++;
      if (entry.palette) paletteSelectCount++;
      if (entry.priority) priorityCount++;
      if (entry.unusedHighBits) unusedHighBitCount++;
      uniqueTiles.add(tile);
      maxTile = Math.max(maxTile, tile);
      entries.push(entry);
    }
  } else {
    for (let i = 0; i < size; i++) {
      const tile = bytes[i];
      uniqueTiles.add(tile);
      maxTile = Math.max(maxTile, tile);
      entries.push({
        index: i,
        offset: offset + i,
        byte: tile,
        tile,
        hflip: false,
        vflip: false,
        palette: false,
        priority: false,
        unusedHighBits: 0,
      });
    }
  }
  const layoutKind = useWords ? 'sms_name_table_word_entries' : 'byte_tile_id_entries';
  const dimensions = wb3TileMapDimensions(entries.length, region);
  const primary = dimensions[0] || { cols: 1, rows: entries.length || 1, reason: 'empty fallback' };
  const warnings = [];
  const diagnostics = [];
  if (!useWords) diagnostics.push('Odd-sized structural payload decoded as byte tile ids without SMS attribute bits.');
  if (unusedHighBitCount) diagnostics.push(`${unusedHighBitCount} entr${unusedHighBitCount === 1 ? 'y has' : 'ies have'} nonzero high bits; kept as structural diagnostics because many mapped tile_map regions are compressed/lookup payloads, not raw name-table words.`);
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${entries.length} ${useWords ? '16-bit structural word' : 'byte tile-id'} entr${entries.length === 1 ? 'y' : 'ies'}, ${uniqueTiles.size} unique tile id(s), preview ${primary.cols}x${primary.rows}, ${analysisEntries.length} evidence item(s).`,
    {
      offset,
      size,
      layoutKind,
      entryCount: entries.length,
      uniqueTileCount: uniqueTiles.size,
      maxTile,
      hflipCount,
      vflipCount,
      paletteSelectCount,
      priorityCount,
      unusedHighBitCount,
      dimensions,
      diagnosticCount: diagnostics.length,
      analysisEntryCount: analysisEntries.length,
      ownerResolved: analysisEntries.length > 0,
    },
    warnings,
    options.includeTransientPreview ? {
      kind: 'tile_map_layout',
      layoutKind,
      entries: entries.slice(0, options.tileMapPreviewLimit || 2048),
      entryCount: entries.length,
      cols: primary.cols,
      rows: primary.rows,
      dimensions,
      diagnostics,
      analysisEntries,
    } : null);
}

function wb3DecodePointerRegion(asset, region, rom, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const bytes = wb3RegionBytes(rom, region);
  if (!bytes || typeof decodePointerTableLE !== 'function') {
    return wb3MakeDecodeResult(decoder, asset, region, 'needs_decoder', 'Pointer table decoder unavailable.', {}, [], null);
  }
  const decoded = decodePointerTableLE(bytes, offset, { limit: options.pointerLimit || Math.floor(bytes.length / 2) });
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${decoded.stats.entries} pointer entr${decoded.stats.entries === 1 ? 'y' : 'ies'}; ${(decoded.stats.validRatio * 100).toFixed(0)}% resolve to ROM.`,
    {
      offset,
      entries: decoded.stats.entries,
      validTargets: decoded.stats.validTargets,
      validRatio: decoded.stats.validRatio,
    },
    [],
	    options.includeTransientPreview ? { kind: 'pointer_table', entries: decoded.entries.slice(0, options.pointerPreviewLimit || 32) } : null);
}

function wb3FindScreenProgCatalog(map, id) {
  return wb3DecoderArray(map?.screenProgCatalogs).find(catalog => catalog?.id === id) || null;
}

function wb3ScreenProgEntryMatchesRegion(entry, region) {
  if (!entry || !region) return false;
  const regionId = region.id || '';
  if (entry.region?.id && entry.region.id === regionId) return true;
  const regionOffset = wb3DecoderParseOffset(region.offset);
  const entryOffset = wb3DecoderParseOffset(entry.region?.offset || entry.targetOffset || entry.offset);
  return regionOffset != null && entryOffset === regionOffset;
}

function wb3ScreenProgCatalogEntryForRegion(map, region) {
  const catalog = wb3FindScreenProgCatalog(map, 'world-screen-prog-catalog-2026-06-24');
  const entry = wb3DecoderArray(catalog?.entries).find(item => wb3ScreenProgEntryMatchesRegion(item, region)) || null;
  return entry ? { catalogId: catalog.id, entry } : null;
}

function wb3ScreenProgReachabilityForRegion(map, region) {
  const catalog = wb3FindScreenProgCatalog(map, 'world-screen-prog-reachability-catalog-2026-06-24');
  const entry = wb3DecoderArray(catalog?.entries).find(item => wb3ScreenProgEntryMatchesRegion(item, region)) || null;
  return entry ? { catalogId: catalog.id, entry } : null;
}

function wb3ScreenProgEmbeddedProofForRegion(map, region) {
  const catalog = wb3DecoderArray(map?.screenProgEmbeddedContinuationProofCatalogs)
    .find(item => item?.id === 'world-screen-prog-embedded-continuation-proof-catalog-2026-06-26') || null;
  const entry = wb3DecoderArray(catalog?.entries).find(item => wb3ScreenProgEntryMatchesRegion(item, region)) || null;
  return entry ? { catalogId: catalog.id, entry } : null;
}

function wb3ScreenProgTableCatalogForRegion(map, region) {
  const regionOffset = wb3DecoderParseOffset(region?.offset);
  return wb3DecoderArray(map?.screenProgCatalogs).find(catalog => {
    if (catalog?.id !== 'world-screen-prog-table-catalog-2026-06-24') return false;
    if (catalog.table?.region?.id && catalog.table.region.id === region?.id) return true;
    const tableOffset = wb3DecoderParseOffset(catalog.table?.offset || catalog.summary?.tableOffset);
    return regionOffset != null && tableOffset === regionOffset;
  }) || null;
}

function wb3ScreenProgTableRefsForRegion(map, region, limit) {
  const out = [];
  for (const catalog of wb3DecoderArray(map?.screenProgCatalogs)) {
    if (catalog?.id !== 'world-screen-prog-table-catalog-2026-06-24') continue;
    for (const entry of wb3DecoderArray(catalog.entries)) {
      if (!entry?.targetRegion?.id || entry.targetRegion.id !== region?.id) continue;
      out.push({
        catalogId: catalog.id,
        tableRegion: catalog.table?.region || null,
        index: entry.index,
        pointerOffset: entry.pointerOffset || '',
        pointer: entry.pointer || '',
        targetOffset: entry.targetOffset || '',
        confidence: entry.confidence || '',
        screenProgSummary: entry.screenProgSummary || null,
        evidence: wb3DecoderArray(entry.evidence).slice(0, 4),
      });
      if (limit && out.length >= limit) return out;
    }
  }
  return out;
}

function wb3ScreenProgOpCountsFromTrace(trace) {
  const counts = {};
  for (const step of wb3DecoderArray(trace)) {
    const kind = step?.kind || 'unknown';
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}

function wb3ScreenProgVisitedRange(decoded, region) {
  const visitedOffsets = wb3DecoderArray(decoded?.visitedOffsets);
  const regionStart = wb3DecoderParseOffset(region?.offset);
  const regionSize = Number(region?.size || 0);
  const regionEnd = regionStart == null ? null : regionStart + regionSize;
  if (!visitedOffsets.length) {
    return {
      start: '',
      endInclusive: '',
      visitedBytes: 0,
      outsideRegionBytes: 0,
    };
  }
  const min = Math.min(...visitedOffsets);
  const max = Math.max(...visitedOffsets);
  let outsideRegionBytes = 0;
  if (regionStart != null && regionEnd != null) {
    outsideRegionBytes = visitedOffsets.filter(offset => offset < regionStart || offset >= regionEnd).length;
  }
  return {
    start: wb3DecoderHex(min),
    endInclusive: wb3DecoderHex(max),
    visitedBytes: visitedOffsets.length,
    outsideRegionBytes,
  };
}

function wb3TrimScreenProgRootSource(source) {
  return {
    kind: source?.kind || '',
    callerLabel: source?.callerLabel || '',
    sourceLabel: source?.sourceLabel || '',
    sourceLine: source?.sourceLine ?? null,
    callLine: source?.callLine ?? null,
    evidence: wb3DecoderArray(source?.evidence).slice(0, 3),
  };
}

function wb3TrimScreenProgContinuationSource(source) {
  return {
    rootRegion: source?.rootRegion || null,
    rootCatalogEntryId: source?.rootCatalogEntryId || '',
    visitedRange: source?.visitedRange || null,
  };
}

function wb3DecodeScreenProgRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  if (typeof decodeScreenProg604 !== 'function') {
    return wb3MakeDecodeResult(decoder, asset, region, 'needs_decoder', 'screen_prog decoder unavailable.', {}, [], null);
  }
  const bank8000 = options.bank8000 != null ? Number(options.bank8000) : wb3DecoderBankOf(offset);
  const decoded = decodeScreenProg604(rom, offset, bank8000, {
    ntBase: 0x3800,
    rows: options.rows || 28,
	    maxOps: options.maxOps || 4096,
	  });
  const catalog = wb3ScreenProgCatalogEntryForRegion(map, region);
  const reachability = wb3ScreenProgReachabilityForRegion(map, region);
  const embeddedProof = wb3ScreenProgEmbeddedProofForRegion(map, region);
  const tableRefs = wb3ScreenProgTableRefsForRegion(map, region, options.screenProgTableRefLimit || 16);
  const opCounts = wb3ScreenProgOpCountsFromTrace(decoded.trace);
  const visitedRange = wb3ScreenProgVisitedRange(decoded, region);
  const reachabilityEntry = reachability?.entry || null;
  const embeddedEntry = embeddedProof?.entry || null;
  const catalogEntry = catalog?.entry || null;
  const rootSources = wb3DecoderArray(reachabilityEntry?.rootSources).map(wb3TrimScreenProgRootSource);
  const continuationSources = wb3DecoderArray(reachabilityEntry?.continuationSources || embeddedEntry?.continuationSources).map(wb3TrimScreenProgContinuationSource);
  const role = embeddedEntry?.role || (reachabilityEntry?.reachability === 'embedded_continuation' ? 'label_inside_decoded_screen_prog_root_stream' : 'screen_prog_root');
  const warnings = wb3DecoderArray(decoded.warnings);
  const summaryParts = [
    `${decoded.stats.writtenCells} cells`,
    `${decoded.stats.uniqueTiles} unique tiles`,
    `${decoded.trace.length} ops`,
    reachabilityEntry?.reachability ? `${reachabilityEntry.reachability}` : '',
    tableRefs.length ? `${tableRefs.length} table ref(s)` : '',
  ].filter(Boolean);
	  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
	    `${summaryParts.join(', ')}.`,
	    {
	      offset,
	      bank8000,
	      writtenCells: decoded.stats.writtenCells,
	      uniqueTiles: decoded.stats.uniqueTiles,
	      bgWrites: decoded.stats.bgWrites,
	      sprWrites: decoded.stats.sprWrites,
	      traceOps: decoded.trace.length,
	      endReason: decoded.endReason,
      opCounts,
      visitedRange,
      outsideRegionBytes: visitedRange.outsideRegionBytes,
      catalogEntryId: catalogEntry?.id || '',
      catalogConfidence: catalogEntry?.confidence || '',
      reachability: reachabilityEntry?.reachability || '',
      reachabilityConfidence: reachabilityEntry?.confidence || '',
      role,
      rootSourceCount: rootSources.length,
      continuationSourceCount: continuationSources.length,
      tableRefCount: tableRefs.length,
      embeddedContinuation: role === 'label_inside_decoded_screen_prog_root_stream',
	    },
	    warnings,
	    options.includeTransientPreview ? {
      kind: 'screen_prog_cells',
      cells: decoded.cells,
      cols: 32,
      rows: options.rows || 28,
      stats: decoded.stats,
      opCounts,
      visitedRange,
      endReason: decoded.endReason,
      catalogEntry: catalogEntry ? {
        id: catalogEntry.id || '',
        confidence: catalogEntry.confidence || '',
        stats: catalogEntry.stats || null,
        opCounts: catalogEntry.opCounts || null,
        jumpTargets: wb3DecoderArray(catalogEntry.jumpTargets).slice(0, 16),
        warnings: wb3DecoderArray(catalogEntry.warnings),
      } : null,
      reachability: reachabilityEntry ? {
        catalogId: reachability.catalogId,
        reachability: reachabilityEntry.reachability || '',
        confidence: reachabilityEntry.confidence || '',
        rootSources,
        continuationSources,
        decoderSummary: reachabilityEntry.decoderSummary || null,
        evidence: wb3DecoderArray(reachabilityEntry.evidence).slice(0, 6),
      } : null,
      embeddedProof: embeddedEntry ? {
        catalogId: embeddedProof.catalogId,
        status: embeddedEntry.status || '',
        role: embeddedEntry.role || '',
        proof: embeddedEntry.proof || null,
        rootRegionIds: wb3DecoderArray(embeddedEntry.rootRegionIds),
        rootCatalogEntryIds: wb3DecoderArray(embeddedEntry.rootCatalogEntryIds),
        evidence: wb3DecoderArray(embeddedEntry.evidence).slice(0, 6),
      } : null,
      tableRefs,
    } : null);
}

function wb3DecodeScreenProgTableRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const bytes = wb3RegionBytes(rom, region);
  if (!bytes || typeof decodePointerTableLE !== 'function') {
    return wb3MakeDecodeResult(decoder, asset, region, 'needs_decoder', 'screen_prog table decoder unavailable.', {}, [], null);
  }
  const catalog = wb3ScreenProgTableCatalogForRegion(map, region);
  const decoded = decodePointerTableLE(bytes, offset, { limit: options.pointerLimit || Math.floor(bytes.length / 2) });
  const catalogEntries = wb3DecoderArray(catalog?.entries);
  const regionsById = wb3DecoderRegionsById(map);
  const entries = decoded.entries.map(entry => {
    const catalogEntry = catalogEntries.find(item => Number(item?.index) === entry.index) || null;
    const targetRegion = catalogEntry?.targetRegion?.id
      ? regionsById.get(catalogEntry.targetRegion.id) || catalogEntry.targetRegion
      : wb3FindRegionAtOffset(map, entry.romTarget);
    const targetType = targetRegion?.type || '';
    return {
      index: entry.index,
      entryOffset: entry.entryOffset,
      entryOffsetHex: wb3DecoderHex(entry.entryOffset),
      z80Pointer: entry.z80,
      z80PointerHex: wb3DecoderHex(entry.z80, 4),
      romTarget: entry.romTarget,
      romTargetHex: entry.romTarget >= 0 ? wb3DecoderHex(entry.romTarget) : '',
      targetRegion: targetRegion ? {
        id: targetRegion.id || '',
        type: targetType,
        name: targetRegion.name || '',
        offset: targetRegion.offset || '',
        size: Number(targetRegion.size || 0),
      } : null,
      targetIsScreenProg: targetType === 'screen_prog',
      catalogConfidence: catalogEntry?.confidence || '',
      screenProgSummary: catalogEntry?.screenProgSummary || null,
      evidence: wb3DecoderArray(catalogEntry?.evidence).slice(0, 4),
    };
  });
  const validTargets = entries.filter(entry => entry.romTarget >= 0).length;
  const screenProgTargets = entries.filter(entry => entry.targetIsScreenProg).length;
  const targetsWithDecodeSummary = entries.filter(entry => entry.screenProgSummary).length;
  const directIndexWrites = wb3DecoderArray(catalog?.indexWrites).filter(item => item.directIndexState === 'table_entry').length;
  const warnings = [];
  if (catalog && Number(catalog.summary?.entries || 0) !== entries.length) warnings.push(`Catalog entry count ${catalog.summary.entries} differs from decoded count ${entries.length}.`);
  if (validTargets !== entries.length) warnings.push(`${entries.length - validTargets} pointer(s) do not resolve to ROM offsets.`);
  if (screenProgTargets !== entries.length) warnings.push(`${entries.length - screenProgTargets} pointer target(s) are not typed screen_prog.`);
  if (targetsWithDecodeSummary !== entries.length) warnings.push(`${entries.length - targetsWithDecodeSummary} target(s) lack screen_prog decode summaries.`);
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${entries.length} screen_prog pointer entr${entries.length === 1 ? 'y' : 'ies'}; ${screenProgTargets}/${entries.length} target screen_prog regions; ${directIndexWrites} direct _RAM_CF81_ write(s).`,
    {
      offset,
      entries: entries.length,
      validTargets,
      validRatio: entries.length ? validTargets / entries.length : 0,
      screenProgTargets,
      targetsWithDecodeSummary,
      directIndexWrites,
      catalogId: catalog?.id || '',
      tableLabel: catalog?.table?.label || '',
      indexRam: catalog?.table?.indexRam || '',
      decoderRoutine: catalog?.table?.decoder || '',
    },
    warnings,
    options.includeTransientPreview ? {
      kind: 'screen_prog_table',
      catalogId: catalog?.id || '',
      table: catalog?.table || null,
      indexWrites: wb3DecoderArray(catalog?.indexWrites).slice(0, options.screenProgIndexWritePreviewLimit || 16),
      entries: entries.slice(0, options.pointerPreviewLimit || 64),
      entryCount: entries.length,
      validTargets,
      screenProgTargets,
      targetsWithDecodeSummary,
      directIndexWrites,
      evidence: wb3DecoderArray(catalog?.table?.evidence || catalog?.evidence).slice(0, 8),
    } : null);
}

function wb3VramLoaderRegionRange(region) {
  const start = wb3DecoderParseOffset(region?.offset);
  const size = Number(region?.size || 0);
  return {
    start,
    end: start == null || !Number.isFinite(size) || size <= 0 ? null : start + size,
    size,
  };
}

function wb3VramLoaderDependencyMatchesRegion(dep, region) {
  if (!dep || !region) return false;
  if (dep.region?.id && dep.region.id === region.id) return true;
  const depOffset = wb3DecoderParseOffset(dep.romOffset || dep.offset || dep.region?.offset);
  const range = wb3VramLoaderRegionRange(region);
  return depOffset != null && range.start != null && depOffset >= range.start && depOffset < range.end;
}

function wb3VramLoaderEntryWithProvenance(map, entry) {
  const count = Number(entry?.count || 0);
  const romSrc = Number(entry?.romSrc);
  const sourceEnd = Number.isFinite(romSrc) ? romSrc + Math.max(0, count) * 32 : null;
  const vramTile = Number(entry?.vramTile || 0);
  return Object.assign({}, entry, {
    offsetHex: wb3DecoderHex(entry?.start || 0),
    vramTileHex: wb3DecoderHex(vramTile, 3),
    vramTileEndHex: wb3DecoderHex(vramTile + Math.max(0, count) - 1, 3),
    romSrcHex: Number.isFinite(romSrc) ? wb3DecoderHex(romSrc) : null,
    romEndHex: sourceEnd == null ? null : wb3DecoderHex(sourceEnd),
    sourceRegion: Number.isFinite(romSrc) ? wb3FindRegionAtOffset(map, romSrc) : null,
  });
}

function wb3SummarizeVramLoaderSources(entries, map, limit) {
  const byKey = new Map();
  for (const entry of entries || []) {
    if (entry.kind !== 'copy') continue;
    const count = Number(entry.count || 0);
    const sourceRegion = Number.isFinite(Number(entry.romSrc)) ? wb3FindRegionAtOffset(map, Number(entry.romSrc)) : null;
    const key = sourceRegion?.id || `raw:${entry.bank}:${entry.blockIndex}`;
    const prev = byKey.get(key) || {
      sourceRegion,
      bank: entry.bank,
      firstSource: Number(entry.romSrc),
      lastSourceEnd: Number(entry.romSrc),
      entryCount: 0,
      tileCount: 0,
      vramMin: null,
      vramMax: null,
    };
    const start = Number(entry.romSrc);
    const end = Number.isFinite(start) ? start + count * 32 : null;
    if (Number.isFinite(start)) prev.firstSource = Math.min(prev.firstSource, start);
    if (Number.isFinite(end)) prev.lastSourceEnd = Math.max(prev.lastSourceEnd, end);
    prev.entryCount++;
    prev.tileCount += count;
    const vramStart = Number(entry.vramTile || 0);
    const vramEnd = vramStart + count - 1;
    prev.vramMin = prev.vramMin == null ? vramStart : Math.min(prev.vramMin, vramStart);
    prev.vramMax = prev.vramMax == null ? vramEnd : Math.max(prev.vramMax, vramEnd);
    byKey.set(key, prev);
  }
  return [...byKey.values()]
    .sort((a, b) => b.tileCount - a.tileCount || String(a.sourceRegion?.id || '').localeCompare(String(b.sourceRegion?.id || '')))
    .slice(0, limit || 64)
    .map(group => Object.assign({}, group, {
      firstSourceHex: Number.isFinite(group.firstSource) ? wb3DecoderHex(group.firstSource) : null,
      lastSourceEndHex: Number.isFinite(group.lastSourceEnd) ? wb3DecoderHex(group.lastSourceEnd) : null,
      vramRange: group.vramMin == null ? null : `${wb3DecoderHex(group.vramMin, 3)}-${wb3DecoderHex(group.vramMax, 3)}`,
    }));
}

function wb3CollectVramLoaderConsumerUsage(map, region, is998, limit) {
  const loaderKind = is998 ? 'vram_loader_998' : 'vram_loader_8fb';
  const sourceStepType = is998 ? 'vram_998' : 'vram_8fb';
  const sceneUsages = [];
  const zoneRecipeUsages = [];
  const inlineTransitionUsages = [];
  const renderSourceGroups = [];
  const boundaryCatalogMatches = [];
  const consumerRecipes = [];
  const directCallsites = [];
  const specialUsages = [];
  const analysis = wb3DecoderObject(region?.analysis);

  for (const recipe of wb3DecoderArray(map?.sceneRecipes)) {
    for (const step of wb3DecoderArray(recipe?.steps)) {
      if (step?.regionId !== region?.id) continue;
      if (step.kind !== loaderKind && step.sourceStepType !== sourceStepType) continue;
      sceneUsages.push({
        recipeId: recipe.id || '',
        recipeName: recipe.name || '',
        stepOrder: Number(step.order || 0),
        kind: step.kind || '',
        sourceStepType: step.sourceStepType || '',
        bank: step.bank ?? '',
        provenanceSource: step.provenance?.source || '',
        confidence: recipe.confidence || '',
      });
    }
  }

  if (!is998) {
    for (const recipe of wb3DecoderArray(map?.zoneRecipes)) {
      const dep = recipe?.dependencies?.vramLoader8fb;
      if (!wb3VramLoaderDependencyMatchesRegion(dep, region)) continue;
      zoneRecipeUsages.push({
        recipeId: recipe.id || '',
        name: recipe.name || '',
        descriptorOffset: recipe.descriptor?.romOffset || '',
        subrecordOffset: recipe.subrecord?.romOffset || '',
        bgPaletteIndex: recipe.subrecord?.bgPaletteIndex ?? recipe.subrecord?.paletteIndex ?? '',
        entries: dep?.entries ?? '',
        totalTiles: dep?.totalTiles ?? '',
        maxVramTile: dep?.maxVramTile || '',
        confidence: recipe.confidence || '',
      });
    }
    for (const recipe of wb3DecoderArray(map?.inlineTransitionRecipes)) {
      const dep = recipe?.dependencies?.vramLoader8fb;
      if (!wb3VramLoaderDependencyMatchesRegion(dep, region)) continue;
      inlineTransitionUsages.push({
        recipeId: recipe.id || '',
        name: recipe.name || '',
        descriptorOffset: recipe.descriptor?.romOffset || '',
        sourceTriggerOffset: recipe.sourceTriggerRecord?.triggerRecordEntryOffset || recipe.sourceTriggerRecord?.transitionRecordOffset || '',
        branchRole: recipe.sourceTriggerRecord?.branchRole || '',
        entries: dep?.entries ?? '',
        totalTiles: dep?.totalTiles ?? '',
        maxVramTile: dep?.maxVramTile || '',
        confidence: recipe.confidence || '',
      });
    }
    for (const catalog of wb3DecoderArray(map?.zoneLoaderBoundaryCatalogs)) {
      for (const item of wb3DecoderArray(catalog?.loaders)) {
        if (!wb3VramLoaderDependencyMatchesRegion({ romOffset: item.offset }, region)) continue;
        boundaryCatalogMatches.push({
          sourceCatalogId: catalog.id || '',
          offset: item.offset || '',
          endInclusive: item.endInclusive || '',
          referenceCount: Number(item.referenceCount || 0),
          entries: Number(item.entries || 0),
          totalTiles: Number(item.totalTiles || 0),
          maxVramTile: item.maxVramTile || '',
        });
      }
    }
  }

  for (const catalog of wb3DecoderArray(map?.sceneRecipeCatalogs)) {
    for (const item of wb3DecoderArray(catalog?.summary?.sourceGroupUsage)) {
      if (item?.loaderType !== loaderKind) continue;
      if (!wb3VramLoaderDependencyMatchesRegion({ region: item.loaderRegion, romOffset: item.loaderRegion?.offset }, region)) continue;
      renderSourceGroups.push({
        sourceCatalogId: catalog.id || '',
        sourceRegion: item.sourceRegion || null,
        sourceStart: item.sourceStart || '',
        recipeCount: Number(item.recipeCount || 0),
        slotCount: Number(item.slotCount || 0),
        sampleRecipeIds: wb3DecoderArray(item.sampleRecipeIds).slice(0, 8),
      });
    }
  }

  const storedConsumerRecipes = is998 ? map?.vramLoader998ConsumerRecipes : map?.vramLoader8fbConsumerRecipes;
  for (const recipe of wb3DecoderArray(storedConsumerRecipes)) {
    if (!wb3VramLoaderDependencyMatchesRegion({ region: recipe.loaderRegion, romOffset: recipe.loaderOffset }, region)) continue;
    consumerRecipes.push({
      recipeId: recipe.id || '',
      recipeType: recipe.recipeType || '',
      loaderOffset: recipe.loaderOffset || '',
      status: recipe.status || '',
      confidence: recipe.confidence || '',
      totalConsumerCount: Number(recipe.summary?.totalConsumerCount || 0),
      reusableRecipeConsumerCount: Number(recipe.summary?.reusableRecipeConsumerCount || 0),
      directCallsiteCount: Number(recipe.summary?.directCallsiteCount || 0),
      specialUsageCount: Number(recipe.summary?.specialUsageCount || 0),
    });
  }

  for (const call of wb3DecoderArray(analysis.asmAssetAudit?.callSites)) {
    directCallsites.push({
      source: 'asmAssetAudit',
      caller: call.caller || call.sourceLabel || '',
      line: call.line || call.callLine || '',
      loadedAtLine: call.loadedAtLine || '',
      expression: call.expression || call.dataLabel || '',
      instruction: call.instruction || call.callCode || '',
      confidence: analysis.asmAssetAudit?.confidence || '',
    });
  }
  for (const call of wb3DecoderArray(analysis.zoneUnresolvedLoaderCallsiteAudit?.callSites)) {
    const key = `${call.sourceLabel || ''}:${call.callLine || call.line || ''}`;
    if (directCallsites.some(existing => `${existing.caller}:${existing.line}` === key)) continue;
    directCallsites.push({
      source: 'zoneUnresolvedLoaderCallsiteAudit',
      caller: call.sourceLabel || '',
      line: call.callLine || call.line || '',
      loadedAtLine: call.line || '',
      expression: call.dataLabel || '',
      instruction: call.callCode || '',
      confidence: call.confidence || analysis.zoneUnresolvedLoaderCallsiteAudit?.confidence || '',
    });
  }

  const specialKeys = [
    ['zoneCommonPrereqProvenanceAudit', 'common_vram_prerequisite_recipe_support'],
    ['zoneCommonVramPrereqAudit', 'common_vram_prerequisite_candidate'],
    ['playerFormAudit', 'player_form_static_loader'],
    ['loaderBoundaryAudit', 'loader_boundary_split'],
    ['roomAssetIncbinLayoutAudit', 'room_asset_incbin_layout'],
    ['spritePaletteEntryScene', 'entry_scene_prerequisite'],
    ['vramLoaderPartialConsumptionAudit', 'partial_consumption_guard'],
    ['roomLoaderFieldBoundAudit', 'room_loader_extra_998_selection'],
    ['vram998EntrypointVariantAudit', 'fixed_stride_998_entrypoint_variant'],
    ['paletteTailLoaderWordShapeSourceAudit', 'loader_source_word_shape_context'],
  ];
  for (const [key, role] of specialKeys) {
    if (!analysis[key]) continue;
    specialUsages.push({
      key,
      role,
      kind: analysis[key].kind || '',
      confidence: analysis[key].confidence || '',
      summary: analysis[key].summary || analysis[key].status || analysis[key].catalogId || '',
      catalogId: analysis[key].catalogId || '',
    });
  }

  const totalConsumerCount = sceneUsages.length + zoneRecipeUsages.length + inlineTransitionUsages.length + directCallsites.length + specialUsages.length;
  return {
    sceneUsages: sceneUsages.slice(0, limit || 128),
    zoneRecipeUsages: zoneRecipeUsages.slice(0, limit || 128),
    inlineTransitionUsages: inlineTransitionUsages.slice(0, limit || 128),
    renderSourceGroups: renderSourceGroups.slice(0, limit || 64),
    boundaryCatalogMatches: boundaryCatalogMatches.slice(0, limit || 64),
    consumerRecipes: consumerRecipes.slice(0, limit || 64),
    directCallsites: directCallsites.slice(0, limit || 128),
    specialUsages: specialUsages.slice(0, limit || 64),
    counts: {
      sceneRecipeUsageCount: sceneUsages.length,
      zoneRecipeUsageCount: zoneRecipeUsages.length,
      inlineTransitionUsageCount: inlineTransitionUsages.length,
      renderSourceGroupCount: renderSourceGroups.length,
      boundaryCatalogMatchCount: boundaryCatalogMatches.length,
      consumerRecipeCount: consumerRecipes.length,
      directCallsiteCount: directCallsites.length,
      specialUsageCount: specialUsages.length,
      totalConsumerCount,
      reusableRecipeConsumerCount: sceneUsages.length + zoneRecipeUsages.length + inlineTransitionUsages.length,
      consumerResolved: totalConsumerCount > 0,
    },
  };
}

function wb3DecodeVramLoaderRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const bytes = wb3RegionBytes(rom, region);
  const bank = options.defaultBank != null ? Number(options.defaultBank) : wb3DecoderBankOf(offset);
  const is998 = decoder.id === 'vram_loader_998' || region.type === 'vram_loader_998';
  const fn = is998 ? decodeVramLoader998Data : decodeVramLoader8FBData;
  if (!bytes || typeof fn !== 'function') {
    return wb3MakeDecodeResult(decoder, asset, region, 'needs_decoder', 'VRAM loader decoder unavailable.', {}, [], null);
  }
  const decoded = fn(bytes, {
    defaultBank: bank,
    forceBank: options.forceBank,
    romLength: rom.length,
  });
  const previewEntries = wb3DecoderArray(decoded.entries).map(entry => wb3VramLoaderEntryWithProvenance(map, entry));
  const sourceGroups = wb3SummarizeVramLoaderSources(previewEntries, map, options.loaderSourceGroupLimit || 64);
  const consumerUsage = wb3CollectVramLoaderConsumerUsage(map, region, is998, options.loaderConsumerPreviewLimit || 128);
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${decoded.stats.entries} loader entries, ${decoded.stats.totalTiles} tile(s), max VRAM slot ${decoded.stats.maxVramTile}.`,
    {
      offset,
      defaultBank: bank,
      implementationPercent: decoder.implementationPercent,
      entries: decoded.stats.entries,
      totalTiles: decoded.stats.totalTiles,
      maxVramTile: decoded.stats.maxVramTile,
      invalidSources: decoded.stats.invalidSources,
      consumedBytes: decoded.consumedBytes,
      terminated: decoded.terminated,
      endReason: decoded.endReason,
      sourceGroupCount: sourceGroups.length,
      sourceRegionCount: new Set(sourceGroups.map(group => group.sourceRegion?.id).filter(Boolean)).size,
      sceneRecipeUsageCount: consumerUsage.counts.sceneRecipeUsageCount,
      zoneRecipeUsageCount: consumerUsage.counts.zoneRecipeUsageCount,
      inlineTransitionUsageCount: consumerUsage.counts.inlineTransitionUsageCount,
      directCallsiteCount: consumerUsage.counts.directCallsiteCount,
      specialUsageCount: consumerUsage.counts.specialUsageCount,
      reusableRecipeConsumerCount: consumerUsage.counts.reusableRecipeConsumerCount,
      totalConsumerCount: consumerUsage.counts.totalConsumerCount,
      consumerResolved: consumerUsage.counts.consumerResolved,
    },
    decoded.warnings || [],
    options.includeTransientPreview ? {
      kind: 'vram_loader_entries',
      format: decoded.format,
      loaderKind: is998 ? 'vram_loader_998' : 'vram_loader_8fb',
      entries: previewEntries.slice(0, options.loaderPreviewLimit || 256),
      sourceGroups,
      consumerUsage,
      assetPolicy: 'Transient local-ROM tile previews are rendered in memory only; persisted metadata contains offsets, regions, counts, labels and evidence, never decoded tile bytes or pixels.',
    } : null);
}

function wb3IsBank7Z80Pointer(z80Pointer) {
  return z80Pointer >= 0x8000 && z80Pointer < 0xC000;
}

function wb3Bank7Z80ToRom(z80Pointer) {
  return wb3IsBank7Z80Pointer(z80Pointer) ? 0x1C000 + (z80Pointer - 0x8000) : null;
}

function wb3FindPaletteScriptCatalog(map) {
  return wb3DecoderArray(map?.paletteCatalogs)
    .find(catalog => catalog?.id === 'world-palette-script-catalog-2026-06-24') || null;
}

function wb3PaletteScriptDest(command) {
  return (command & 0x40) ? '_RAM_CF9B_' : '_RAM_CFBB_';
}

function wb3ParsePaletteScriptRuntime(rom, map, startOffset, options) {
  options = options || {};
  const commands = [];
  const writes = [];
  const jumps = [];
  const segments = [];
  const warnings = [];
  const visited = new Set();
  const finalBuffers = {
    '_RAM_CF9B_': new Array(32).fill(null),
    '_RAM_CFBB_': new Array(32).fill(null),
  };
  const destCounts = { '_RAM_CF9B_': 0, '_RAM_CFBB_': 0 };
  const slots = { '_RAM_CF9B_': new Set(), '_RAM_CFBB_': new Set() };
  const maxCommands = options.maxPaletteScriptCommands || 2048;
  const regionEnd = Math.min(options.regionEnd || rom.length, rom.length);
  let pos = startOffset;
  let frame = 0;
  let segmentStartCommand = 0;
  let segmentStartWrite = 0;
  let segmentStartJump = 0;
  let termination = null;

  function closeSegment(reason, delayAfter) {
    if (commands.length === segmentStartCommand && writes.length === segmentStartWrite && jumps.length === segmentStartJump) return;
    const delay = Math.max(0, Number(delayAfter || 0));
    segments.push({
      index: segments.length,
      startFrame: frame,
      endFrame: frame + delay,
      delayAfter: delay,
      reason,
      commandStartIndex: segmentStartCommand,
      commandCount: commands.length - segmentStartCommand,
      writeStartIndex: segmentStartWrite,
      writeCount: writes.length - segmentStartWrite,
      jumpStartIndex: segmentStartJump,
      jumpCount: jumps.length - segmentStartJump,
    });
    frame += delay;
    segmentStartCommand = commands.length;
    segmentStartWrite = writes.length;
    segmentStartJump = jumps.length;
  }

  for (let guard = 0; guard < maxCommands; guard++) {
    if (pos < 0 || pos >= rom.length || pos >= regionEnd) {
      termination = { kind: 'left_region_or_rom', normal: false, atOffset: wb3DecoderHex(pos) };
      warnings.push(`Palette script left the selected ROM range at ${wb3DecoderHex(pos)}.`);
      closeSegment('range_exit', 0);
      break;
    }
    if (visited.has(pos)) {
      termination = { kind: 'loop_detected', normal: true, atOffset: wb3DecoderHex(pos) };
      closeSegment('loop_detected', 0);
      break;
    }
    visited.add(pos);

    const commandOffset = pos;
    const command = rom[pos++];
    if (command === 0xff) {
      commands.push({
        index: commands.length,
        kind: 'end',
        offset: commandOffset,
        offsetHex: wb3DecoderHex(commandOffset),
        command,
        commandHex: wb3DecoderHex(command, 2),
        frame,
      });
      termination = { kind: 'end_0xff', normal: true, atOffset: wb3DecoderHex(commandOffset) };
      closeSegment('end_0xff', 0);
      break;
    }

    if (command === 0xf0) {
      const pointerOffset = pos;
      const z80Pointer = wb3ReadWordLE(rom, pos);
      if (z80Pointer == null) {
        commands.push({
          index: commands.length,
          kind: 'jump',
          offset: commandOffset,
          offsetHex: wb3DecoderHex(commandOffset),
          command,
          commandHex: wb3DecoderHex(command, 2),
          frame,
          pointerOffset,
          pointerOffsetHex: wb3DecoderHex(pointerOffset),
        });
        termination = { kind: 'truncated_jump_pointer', normal: false, atOffset: wb3DecoderHex(commandOffset) };
        warnings.push(`Truncated 0xF0 pointer at ${wb3DecoderHex(commandOffset)}.`);
        closeSegment('truncated_jump', 0);
        break;
      }
      pos += 2;
      const romOffset = wb3Bank7Z80ToRom(z80Pointer);
      const jump = {
        index: jumps.length,
        commandOffset,
        commandOffsetHex: wb3DecoderHex(commandOffset),
        pointerOffset,
        pointerOffsetHex: wb3DecoderHex(pointerOffset),
        z80Pointer,
        z80PointerHex: wb3DecoderHex(z80Pointer, 4),
        romOffset,
        romOffsetHex: romOffset == null ? null : wb3DecoderHex(romOffset),
        region: romOffset == null ? null : wb3FindRegionAtOffset(map, romOffset),
        targetAlreadyVisited: romOffset != null && visited.has(romOffset),
      };
      jumps.push(jump);
      commands.push({
        index: commands.length,
        kind: 'jump',
        offset: commandOffset,
        offsetHex: wb3DecoderHex(commandOffset),
        command,
        commandHex: wb3DecoderHex(command, 2),
        frame,
        jumpIndex: jump.index,
        z80Pointer,
        z80PointerHex: jump.z80PointerHex,
        romOffset,
        romOffsetHex: jump.romOffsetHex,
      });
      if (romOffset == null) {
        termination = { kind: 'invalid_bank7_jump', normal: false, atOffset: wb3DecoderHex(commandOffset), z80Pointer: wb3DecoderHex(z80Pointer, 4) };
        warnings.push(`0xF0 pointer ${wb3DecoderHex(z80Pointer, 4)} is outside bank-7 0x8000-0xBFFF.`);
        closeSegment('invalid_jump', 0);
        break;
      }
      if (visited.has(romOffset)) {
        termination = { kind: 'loop_jump', normal: true, atOffset: wb3DecoderHex(commandOffset), loopTarget: wb3DecoderHex(romOffset) };
        closeSegment('loop_jump', 0);
        break;
      }
      pos = romOffset;
      continue;
    }

    if (pos >= rom.length || pos >= regionEnd) {
      commands.push({
        index: commands.length,
        kind: 'write',
        offset: commandOffset,
        offsetHex: wb3DecoderHex(commandOffset),
        command,
        commandHex: wb3DecoderHex(command, 2),
        frame,
      });
      termination = { kind: 'truncated_value', normal: false, atOffset: wb3DecoderHex(commandOffset) };
      warnings.push(`Palette write command at ${wb3DecoderHex(commandOffset)} has no value byte.`);
      closeSegment('truncated_value', 0);
      break;
    }

    const valueOffset = pos;
    const value = rom[pos++];
    const dest = wb3PaletteScriptDest(command);
    const slot = command & 0x1f;
    const delayed = !!(command & 0x80);
    const write = {
      index: writes.length,
      commandIndex: commands.length,
      offset: commandOffset,
      offsetHex: wb3DecoderHex(commandOffset),
      valueOffset,
      valueOffsetHex: wb3DecoderHex(valueOffset),
      command,
      commandHex: wb3DecoderHex(command, 2),
      value,
      valueHex: wb3DecoderHex(value, 2),
      dest,
      slot,
      frame,
      segmentIndex: segments.length,
      delayed,
    };
    writes.push(write);
    destCounts[dest]++;
    slots[dest].add(slot);
    finalBuffers[dest][slot] = value;

    const commandRecord = {
      index: commands.length,
      kind: 'write',
      offset: commandOffset,
      offsetHex: wb3DecoderHex(commandOffset),
      command,
      commandHex: wb3DecoderHex(command, 2),
      value,
      valueHex: wb3DecoderHex(value, 2),
      valueOffset,
      valueOffsetHex: wb3DecoderHex(valueOffset),
      dest,
      slot,
      frame,
      delayed,
      delayAfter: 0,
    };

    if (delayed) {
      if (pos >= rom.length || pos >= regionEnd) {
        commands.push(commandRecord);
        termination = { kind: 'truncated_delay', normal: false, atOffset: wb3DecoderHex(commandOffset) };
        warnings.push(`Delayed palette command at ${wb3DecoderHex(commandOffset)} has no delay byte.`);
        closeSegment('truncated_delay', 0);
        break;
      }
      const delayOffset = pos;
      const delayAfter = rom[pos++];
      commandRecord.delayAfter = delayAfter;
      commandRecord.delayOffset = delayOffset;
      commandRecord.delayOffsetHex = wb3DecoderHex(delayOffset);
      commands.push(commandRecord);
      closeSegment('delay', delayAfter);
    } else {
      commands.push(commandRecord);
    }
  }

  if (!termination) {
    termination = { kind: 'command_limit_reached', normal: false, commandLimit: maxCommands };
    warnings.push('Reached palette script command limit before end, loop or range exit.');
    closeSegment('command_limit', 0);
  }

  return {
    startOffset,
    startOffsetHex: wb3DecoderHex(startOffset),
    endOffset: pos,
    endOffsetHex: wb3DecoderHex(pos),
    commands,
    writes,
    jumps,
    segments,
    finalBuffers,
    timelineFrameCount: frame,
    termination,
    warnings,
    stats: {
      commandCount: commands.length,
      writeCount: writes.length,
      delayedWriteCount: writes.filter(write => write.delayed).length,
      immediateWriteCount: writes.filter(write => !write.delayed).length,
      jumpCount: jumps.length,
      segmentCount: segments.length,
      timelineFrameCount: frame,
      destCounts,
      slots: {
        '_RAM_CF9B_': [...slots['_RAM_CF9B_']].sort((a, b) => a - b),
        '_RAM_CFBB_': [...slots['_RAM_CFBB_']].sort((a, b) => a - b),
      },
    },
  };
}

function wb3CollectPaletteScriptStarts(map, region, limit) {
  const regionStart = wb3DecoderParseOffset(region?.offset);
  const regionSize = Number(region?.size || 0);
  const regionEnd = regionStart == null ? null : regionStart + regionSize;
  const catalog = wb3FindPaletteScriptCatalog(map);
  const starts = [];
  for (const script of wb3DecoderArray(catalog?.scripts)) {
    const start = wb3DecoderParseOffset(script?.range?.start || script?.pointerEntry?.targetOffset);
    if (start == null || regionStart == null || start < regionStart || start >= regionEnd) continue;
    starts.push({
      index: script.index,
      offset: start,
      offsetHex: wb3DecoderHex(start),
      pointer: script.pointerEntry?.pointer || null,
      tableOffset: script.pointerEntry?.tableOffset || null,
      directIndexWriteCount: Number(script.directIndexWriteCount || 0),
      catalogEndReason: script.endReason || '',
      catalogRange: script.range || null,
      sourceCatalogId: catalog?.id || '',
    });
  }
  if (!starts.length && regionStart != null) {
    starts.push({
      index: null,
      offset: regionStart,
      offsetHex: wb3DecoderHex(regionStart),
      pointer: null,
      tableOffset: null,
      directIndexWriteCount: 0,
      catalogEndReason: '',
      catalogRange: null,
      sourceCatalogId: '',
    });
  }
  return starts
    .sort((a, b) => a.offset - b.offset)
    .slice(0, limit || 128);
}

function wb3DecodePaletteScriptTableRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const size = Number(region.size || 0);
  const entryCount = Math.floor(size / 2);
  const entries = [];
  let validBank7Pointers = 0;
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = offset + i * 2;
    const z80Pointer = wb3ReadWordLE(rom, entryOffset);
    const romOffset = z80Pointer == null ? null : wb3Bank7Z80ToRom(z80Pointer);
    if (romOffset != null) validBank7Pointers++;
    entries.push({
      index: i,
      entryOffset,
      entryOffsetHex: wb3DecoderHex(entryOffset),
      z80Pointer,
      z80PointerHex: z80Pointer == null ? null : wb3DecoderHex(z80Pointer, 4),
      romOffset,
      romOffsetHex: romOffset == null ? null : wb3DecoderHex(romOffset),
      region: romOffset == null ? null : wb3FindRegionAtOffset(map, romOffset),
    });
  }
  const warnings = [];
  if (size % 2) warnings.push('Palette script pointer table has an odd byte size.');
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${entryCount} palette script pointer entr${entryCount === 1 ? 'y' : 'ies'}; ${validBank7Pointers} resolve to bank-7 ROM scripts.`,
    {
      offset,
      size,
      entryCount,
      validBank7Pointers,
      validRatio: entryCount ? validBank7Pointers / entryCount : 0,
      loaderRoutine: '_LABEL_10BC_',
      indexRam: '_RAM_CF65_',
    },
    warnings,
    options.includeTransientPreview ? {
      kind: 'palette_script_table',
      entries: entries.slice(0, options.paletteScriptTablePreviewLimit || 96),
      entryCount,
      validBank7Pointers,
      semantics: {
        routine: '_LABEL_10BC_',
        tableLabel: '_DATA_1C800_',
        indexRam: '_RAM_CF65_',
        activePointerRam: '_RAM_D020_',
        delayRam: '_RAM_D022_',
      },
    } : null);
}

function wb3DecodePaletteScriptRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const size = Number(region.size || 0);
  const starts = wb3CollectPaletteScriptStarts(map, region, options.paletteScriptStartLimit || 128);
  const selected = options.paletteScriptOffset != null
    ? Number(options.paletteScriptOffset)
    : (starts[0]?.offset ?? offset);
  const catalog = wb3FindPaletteScriptCatalog(map);
  const selectedStart = starts.find(start => start.offset === selected) || starts[0] || null;
  const catalogEndExclusive = wb3DecoderParseOffset(selectedStart?.catalogRange?.endExclusive);
  const regionEnd = catalogEndExclusive != null && catalogEndExclusive > selected
    ? catalogEndExclusive
    : offset + size;
  const parsed = wb3ParsePaletteScriptRuntime(rom, map, selected, {
    regionEnd,
    maxPaletteScriptCommands: options.maxPaletteScriptCommands || 2048,
  });
  const warnings = [...parsed.warnings];
  if (!catalog) warnings.push('Palette script catalog not found; decoding only from region bytes and routine semantics.');
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${parsed.stats.writeCount} palette-buffer write(s), ${parsed.stats.segmentCount} runtime segment(s), ${parsed.stats.jumpCount} jump(s), termination ${parsed.termination.kind}.`,
    {
      offset,
      size,
	      selectedScriptOffset: selected,
	      knownScriptStartCount: starts.length,
      selectedCatalogEndExclusive: catalogEndExclusive,
      parseEndOffset: regionEnd,
	      commandCount: parsed.stats.commandCount,
      writeCount: parsed.stats.writeCount,
      delayedWriteCount: parsed.stats.delayedWriteCount,
      immediateWriteCount: parsed.stats.immediateWriteCount,
      jumpCount: parsed.stats.jumpCount,
      segmentCount: parsed.stats.segmentCount,
      timelineFrameCount: parsed.stats.timelineFrameCount,
      terminationKind: parsed.termination.kind,
      terminationNormal: !!parsed.termination.normal,
      destCounts: parsed.stats.destCounts,
      slots: parsed.stats.slots,
      loaderRoutine: '_LABEL_10BC_',
      indexRam: '_RAM_CF65_',
      activePointerRam: '_RAM_D020_',
      delayRam: '_RAM_D022_',
      catalogId: catalog?.id || null,
    },
    warnings,
    options.includeTransientPreview ? {
      kind: 'palette_script',
	      selectedScriptOffset: selected,
	      selectedScriptOffsetHex: wb3DecoderHex(selected),
      parseEndOffsetHex: wb3DecoderHex(regionEnd),
	      selectedCatalogStart: selectedStart,
      scriptStarts: starts,
      commands: parsed.commands.slice(0, options.paletteScriptCommandPreviewLimit || 160),
      writes: parsed.writes.slice(0, options.paletteScriptWritePreviewLimit || 160),
      jumps: parsed.jumps.slice(0, options.paletteScriptJumpPreviewLimit || 48),
      segments: parsed.segments.slice(0, options.paletteScriptSegmentPreviewLimit || 80),
      finalBuffers: parsed.finalBuffers,
      stats: parsed.stats,
      termination: parsed.termination,
      semantics: {
        routine: '_LABEL_10BC_',
        tableLabel: '_DATA_1C800_',
        indexRam: '_RAM_CF65_',
        activePointerRam: '_RAM_D020_',
        delayRam: '_RAM_D022_',
        dirtyFlagRam: '_RAM_CFE2_',
        commandShape: 'command byte, value byte, optional delay byte when bit 7 is set',
        destinationSelect: 'bit 6 selects _RAM_CF9B_; otherwise _RAM_CFBB_',
        slotMask: 'command & 0x1F',
        jumpOpcode: '0xF0 plus bank-7 pointer',
        endOpcode: '0xFF',
      },
    } : null);
}

function wb3CountEffectScriptValues(records, key) {
  const counts = new Map();
  for (const record of records) {
    const value = record[key];
    if (value == null) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([value, count]) => ({ value, count }));
}

function wb3ParseBank2TimedEffectScript(rom, offset, options) {
  options = options || {};
  const regionEnd = Math.min(options.regionEnd || rom.length, rom.length);
  const maxRecords = options.maxEffectScriptRecords || 512;
  const startOffset = Number.isFinite(Number(offset)) ? Number(offset) : wb3DecoderParseOffset(offset);
  const records = [];
  const warnings = [];
  if (!rom || startOffset == null || startOffset < 0 || startOffset >= rom.length || startOffset >= regionEnd) {
    return {
      startOffset,
      startOffsetHex: startOffset == null ? '' : wb3DecoderHex(startOffset),
      initialDelay: null,
      records,
      termination: { kind: 'invalid_start_offset', normal: false },
      stats: { recordCount: 0, frameCount: 0, consumedBytes: 0, distinctCf95Count: 0, distinctD279Count: 0, terminalDelayZero: false },
      warnings: ['Effect script start is outside the loaded local ROM or selected region.'],
    };
  }

  const initialDelay = rom[startOffset];
  let currentDelay = initialDelay;
  let frame = 0;
  let pos = startOffset + 1;
  let termination = null;

  for (let guard = 0; guard < maxRecords; guard++) {
    if (pos >= regionEnd || pos >= rom.length) {
      termination = { kind: 'left_region_or_rom', normal: false, atOffset: wb3DecoderHex(pos) };
      warnings.push(`Effect script left the selected range at ${wb3DecoderHex(pos)}.`);
      break;
    }
    if (pos + 1 >= regionEnd || pos + 1 >= rom.length) {
      termination = { kind: 'truncated_next_delay', normal: false, atOffset: wb3DecoderHex(pos) };
      warnings.push(`Effect script control byte at ${wb3DecoderHex(pos)} has no following delay byte.`);
      break;
    }

    const control = rom[pos];
    const nextDelay = rom[pos + 1];
    const cf95 = control & 0x30;
    const d279 = control & 0x0f;
    const duration = Number(currentDelay || 0);
    const record = {
      index: records.length,
      controlOffset: pos,
      controlOffsetHex: wb3DecoderHex(pos),
      delaySourceOffset: records.length ? pos - 1 : startOffset,
      delaySourceOffsetHex: wb3DecoderHex(records.length ? pos - 1 : startOffset),
      durationFrames: duration,
      frameStart: frame,
      frameEnd: frame + duration,
      control,
      controlHex: wb3DecoderHex(control, 2),
      cf95,
      cf95Hex: wb3DecoderHex(cf95, 2),
      d279,
      d279Hex: wb3DecoderHex(d279, 2),
      nextDelay,
      nextDelayHex: wb3DecoderHex(nextDelay, 2),
      nextDelayOffset: pos + 1,
      nextDelayOffsetHex: wb3DecoderHex(pos + 1),
      terminatesAfterRecord: nextDelay === 0,
    };
    records.push(record);
    frame += duration;
    pos += 2;

    if (nextDelay === 0) {
      termination = {
        kind: 'terminal_delay_0x00',
        normal: true,
        atOffset: record.nextDelayOffsetHex,
        afterRecordIndex: record.index,
      };
      break;
    }
    currentDelay = nextDelay;
  }

  if (!termination) {
    termination = { kind: 'record_limit_reached', normal: false, recordLimit: maxRecords };
    warnings.push('Reached effect script record preview limit before terminal delay 0x00.');
  }

  const cf95Values = new Set(records.map(record => record.cf95));
  const d279Values = new Set(records.map(record => record.d279));
  const durationValues = new Set(records.map(record => record.durationFrames));
  return {
    startOffset,
    startOffsetHex: wb3DecoderHex(startOffset),
    initialDelay,
    initialDelayHex: wb3DecoderHex(initialDelay, 2),
    records,
    termination,
    stats: {
      recordCount: records.length,
      frameCount: frame,
      consumedBytes: Math.max(0, pos - startOffset),
      distinctCf95Count: cf95Values.size,
      distinctD279Count: d279Values.size,
      distinctDurationCount: durationValues.size,
      zeroDurationRecordCount: records.filter(record => record.durationFrames === 0).length,
      terminalDelayZero: termination.kind === 'terminal_delay_0x00',
      maxDurationFrames: records.reduce((max, record) => Math.max(max, record.durationFrames || 0), 0),
      cf95Counts: wb3CountEffectScriptValues(records, 'cf95'),
      d279Counts: wb3CountEffectScriptValues(records, 'd279'),
      durationCounts: wb3CountEffectScriptValues(records, 'durationFrames'),
    },
    warnings,
  };
}

function wb3DecodeBank2EffectScriptRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const size = Number(region.size || 0);
  const parsed = wb3ParseBank2TimedEffectScript(rom, offset, {
    regionEnd: offset + size,
    maxEffectScriptRecords: options.maxEffectScriptRecords || 512,
  });
  const catalog = wb3DecoderArray(map?.effectScriptCatalogs)
    .find(item => item?.id === 'world-bank2-effect-script-catalog-2026-06-24') || null;
  const catalogEntry = wb3DecoderArray(catalog?.entries)
    .find(entry => wb3CatalogRefMatchesRegion(entry.region, region) || wb3CatalogOffsetInRegion(entry.offset, region)) || null;
  return wb3MakeDecodeResult(decoder, asset, region, parsed.termination.normal ? 'decoded' : 'partial',
    `${parsed.stats.recordCount} timed effect record(s), ${parsed.stats.frameCount} frame(s), termination ${parsed.termination.kind}.`,
    {
      offset,
      size,
      initialDelay: parsed.initialDelay,
      recordCount: parsed.stats.recordCount,
      frameCount: parsed.stats.frameCount,
      consumedBytes: parsed.stats.consumedBytes,
      distinctCf95Count: parsed.stats.distinctCf95Count,
      distinctD279Count: parsed.stats.distinctD279Count,
      distinctDurationCount: parsed.stats.distinctDurationCount,
      zeroDurationRecordCount: parsed.stats.zeroDurationRecordCount,
      maxDurationFrames: parsed.stats.maxDurationFrames,
      terminalDelayZero: parsed.stats.terminalDelayZero,
      terminationKind: parsed.termination.kind,
      terminationNormal: !!parsed.termination.normal,
      streamInitializer: '_LABEL_BFED_',
      streamUpdater: '_LABEL_BFBA_',
      streamPointerRam: '_RAM_CFEE_',
      delayRam: '_RAM_CFF0_',
      controlHighRam: '_RAM_CF95_',
      controlLowRam: '_RAM_D279_',
      completionRam: '_RAM_D226_',
      catalogId: catalog?.id || null,
    },
    parsed.warnings,
    options.includeTransientPreview ? {
      kind: 'bank2_timed_effect_script',
      selectedScriptOffset: offset,
      selectedScriptOffsetHex: wb3DecoderHex(offset),
      initialDelay: parsed.initialDelay,
      initialDelayHex: parsed.initialDelayHex,
      records: parsed.records.slice(0, options.effectScriptRecordPreviewLimit || 160),
      stats: parsed.stats,
      termination: parsed.termination,
      catalogEntry,
      semantics: {
        initializer: '_LABEL_BFED_ reads the first byte into _RAM_CFF0_ and stores the remaining pointer in _RAM_CFEE_.',
        updater: '_LABEL_BFBA_ reads the current control byte every frame, writes control & 0x30 to _RAM_CF95_ and control & 0x0F to _RAM_D279_, then advances to the next delay byte when _RAM_CFF0_ expires.',
        termination: 'A zero next-delay byte sets _RAM_D226_ and ends the stream.',
        layout: 'initial delay byte followed by control,next-delay pairs.',
        assetPolicy: 'Transient local preview may show control and delay bytes from the user ROM; project metadata persists only offsets, labels, counts, roles and evidence.',
      },
	    } : null);
}

function wb3VdpStreamAnalysisEntries(region, limit) {
  return wb3AnalysisEntriesForKeys(region, [
    ['vdpStreamAudit', 'bank2_vdp_stream_root'],
    ['bank2VdpStreamStateAudit', 'bank2_vdp_state_model'],
    ['bank2VdpStreamLayoutAudit', 'bank2_vdp_layout_model'],
    ['bank2VdpStateCandidateReachabilityAudit', 'bank2_vdp_candidate_reachability'],
    ['bank2VdpStateIndexProducerAudit', 'bank2_vdp_state_index_producer'],
    ['bank2VdpStateIndexCoverageAudit', 'bank2_vdp_state_index_coverage'],
    ['bank2VdpRootProducerAudit', 'bank2_vdp_root_producer'],
    ['bank2VdpResidualGapAudit', 'bank2_vdp_residual_gap'],
    ['bank2VdpResidualPointerContextAudit', 'bank2_vdp_residual_pointer_context'],
    ['bank2VdpResidualSourceTriageAudit', 'bank2_vdp_residual_source_triage'],
    ['bank2VdpResidualDrawFieldAudit', 'bank2_vdp_residual_draw_field'],
    ['bank2VdpResidualDrawBoundaryCollisionAudit', 'bank2_vdp_residual_boundary_collision'],
    ['bank2VdpResidualFinalDispositionAudit', 'bank2_vdp_residual_final_disposition'],
    ['bank2VdpRuntimeTraceHookPlanAudit', 'bank2_vdp_runtime_trace_hook_plan'],
    ['bank2VdpRuntimeTraceFixtureAudit', 'bank2_vdp_runtime_trace_fixture'],
    ['bank2VdpRuntimeTraceEvaluatorAudit', 'bank2_vdp_runtime_trace_evaluator'],
    ['bank2VdpRuntimeTraceConfirmationAudit', 'bank2_vdp_runtime_trace_confirmation'],
    ['asmDataLabelCensusAudit', 'asm_data_label'],
    ['asmLabelRegionAudit', 'asm_label_region'],
  ]).slice(0, limit || 96);
}

function wb3DecodePaletteVdpStreamProbe(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const bytes = wb3RegionBytes(rom, region);
  const stats = wb3ByteClassStats(bytes || []);
  const sourceCatalogs = wb3DecoderArray(map?.vdpStreamCatalogs).map(catalog => ({
    id: catalog.id || '',
    summary: catalog.summary || null,
  }));
  const layoutCatalog = wb3DecoderArray(map?.vdpStreamLayoutCatalogs)
    .find(catalog => catalog?.id === 'world-bank2-vdp-stream-layout-catalog-2026-06-25') || null;
  const runtimeCatalogs = wb3DecoderArray(map?.vdpStreamRuntimeCatalogs).map(catalog => ({
    id: catalog.id || '',
    summary: catalog.summary || null,
  }));
  const residualCatalogs = [
    ...wb3DecoderArray(map?.vdpStreamResidualGapCatalogs),
    ...wb3DecoderArray(map?.vdpStreamResidualPointerContextCatalogs),
    ...wb3DecoderArray(map?.vdpStreamResidualSourceTriageCatalogs),
    ...wb3DecoderArray(map?.vdpStreamResidualDrawFieldCatalogs),
    ...wb3DecoderArray(map?.vdpStreamResidualBoundaryCollisionCatalogs),
    ...wb3DecoderArray(map?.vdpStreamResidualFinalDispositionCatalogs),
  ].map(catalog => ({
    id: catalog.id || '',
    summary: catalog.summary || null,
  }));
  const finalDispositionCatalog = wb3DecoderArray(map?.vdpStreamResidualFinalDispositionCatalogs)
    .find(catalog => catalog?.id === 'world-bank2-vdp-residual-final-disposition-catalog-2026-06-26') || null;
  const analysisEntries = wb3VdpStreamAnalysisEntries(region, options.vdpStreamAnalysisPreviewLimit || 96);
  const layoutSummary = layoutCatalog?.summary || {};
  const finalSummary = finalDispositionCatalog?.summary || {};
  const mergedIntervals = wb3DecoderArray(layoutCatalog?.mergedIntervals).slice(0, options.vdpStreamIntervalPreviewLimit || 80);
  const gaps = wb3DecoderArray(finalDispositionCatalog?.gaps).slice(0, options.vdpStreamGapPreviewLimit || 80);
  const decodedCoverageBytes = Number(layoutSummary.decodedCoverageBytes || 0);
  const gapBytes = Number(layoutSummary.gapBytes || 0);
  const totalModeledBytes = decodedCoverageBytes + gapBytes;
  const catalogIds = [
    ...sourceCatalogs.map(catalog => catalog.id),
    layoutCatalog?.id,
    ...runtimeCatalogs.map(catalog => catalog.id),
    ...residualCatalogs.map(catalog => catalog.id),
  ].filter(Boolean);
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${region.type} catalog model: ${layoutSummary.decodedIntervalCount || 0} decoded interval(s), ${layoutSummary.gapCount || 0} classified residual gap(s), ${Math.round(Number(layoutSummary.decodedCoverageRatio || 0) * 100)}% decoded interval coverage.`,
    {
      offset,
      size: stats.size,
      distinctByteCount: stats.distinctByteCount,
      zeroBytes: stats.zeroBytes,
      ffBytes: stats.ffBytes,
      highBitBytes: stats.highBitBytes,
      decodedIntervalCount: Number(layoutSummary.decodedIntervalCount || 0),
      mergedDecodedRunCount: Number(layoutSummary.mergedDecodedRuns || 0),
      decodedCoverageBytes,
      decodedCoverageRatio: Number(layoutSummary.decodedCoverageRatio || 0),
      gapCount: Number(layoutSummary.gapCount || 0),
      gapBytes,
      modeledCoverageBytes: totalModeledBytes,
      intervalKindCounts: layoutSummary.intervalKindCounts || {},
      rootSelectionFullyBound: !!runtimeCatalogs.find(catalog => catalog.id === 'world-bank2-vdp-state-index-coverage-catalog-2026-06-26')?.summary?.rootSelectionFullyBound,
      modeledEntrySlotCount: Number(runtimeCatalogs.find(catalog => catalog.id === 'world-bank2-vdp-state-index-coverage-catalog-2026-06-26')?.summary?.modeledEntrySlotCount || 0),
      unresolvedTraceLeadCount: Number(finalSummary.unresolvedTraceLeadCount || 0),
      promotableGapCount: Number(finalSummary.promotableGapCount || 0),
      analysisEntryCount: analysisEntries.length,
      catalogIds,
    },
    [],
    options.includeTransientPreview ? {
      kind: 'palette_vdp_stream_model',
      regionType: region.type,
      stats,
      catalogIds,
      sourceCatalogs,
      layout: layoutCatalog ? {
        id: layoutCatalog.id || '',
        bundle: layoutCatalog.bundle || null,
        summary: layoutSummary,
        mergedIntervals,
        overlaps: wb3DecoderArray(layoutCatalog.overlaps).slice(0, options.vdpStreamOverlapPreviewLimit || 24),
      } : null,
      runtimeCatalogs,
      residualCatalogs,
      finalDisposition: finalDispositionCatalog ? {
        id: finalDispositionCatalog.id || '',
        summary: finalSummary,
        gaps,
        unresolvedTraceLeads: wb3DecoderArray(finalDispositionCatalog.unresolvedTraceLeads).slice(0, options.vdpStreamTraceLeadPreviewLimit || 32),
      } : null,
      analysisEntries,
      evidence: region.type === 'effect_script'
        ? ['world-bank2-effect-script-catalog-2026-06-24', '_LABEL_BFED_', '_LABEL_BFBA_']
        : ['world-vdp-stream-catalog-2026-06-24', 'world-bank2-vdp-stream-state-catalog-2026-06-25', 'world-bank2-vdp-stream-layout-catalog-2026-06-25', 'world-bank2-vdp-residual-final-disposition-catalog-2026-06-26'],
      assetPolicy: 'Metadata-only VDP stream model. It reports offsets, interval classes, counts, RAM/model roles and residual dispositions; ROM bytes, decoded graphics and screenshots are not persisted.',
    } : null);
}

function wb3DecodePaletteVdpScriptRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region?.offset);
  if (!rom || offset == null) return wb3MakeDecodeResult(decoder, asset, region, 'needs_rom', 'Load the local ROM to decode this palette/VDP script region.', {}, [], null);
  if (region.type === 'palette_script_table') return wb3DecodePaletteScriptTableRegion(asset, region, rom, map, decoder, options);
  if (region.type === 'palette_script') return wb3DecodePaletteScriptRegion(asset, region, rom, map, decoder, options);
  if (region.type === 'effect_script') return wb3DecodeBank2EffectScriptRegion(asset, region, rom, map, decoder, options);
  return wb3DecodePaletteVdpStreamProbe(asset, region, rom, map, decoder, options);
}

function wb3IsBank4Z80Pointer(z80Pointer) {
  return z80Pointer >= 0x8000 && z80Pointer < 0xC000;
}

function wb3Bank4Z80ToRom(z80Pointer) {
  return wb3IsBank4Z80Pointer(z80Pointer) ? 0x10000 + (z80Pointer - 0x8000) : null;
}

function wb3FindZoneGraph(map) {
  return wb3DecoderArray(map?.zoneGraphs)
    .find(graph => graph?.id === 'world-zone-graph-2026-06-24') || null;
}

function wb3FindZoneGraphDescriptorByOffset(map, offset) {
  const graph = wb3FindZoneGraph(map);
  if (!graph || offset == null) return null;
  return wb3DecoderArray(graph.descriptors)
    .find(item => wb3DecoderParseOffset(item?.descriptorOffset) === offset) || null;
}

function wb3FindZoneGraphEdge(graph, descriptorId, doorIndex) {
  if (!graph || !descriptorId || doorIndex == null) return null;
  return wb3DecoderArray(graph.edges)
    .find(edge => edge?.from === descriptorId && Number(edge?.doorIndex) === Number(doorIndex)) || null;
}

function wb3FindZoneGraphRejectedTarget(graph, offset) {
  if (!graph || offset == null) return null;
  return wb3DecoderArray(graph.rejectedTargets)
    .find(item => wb3DecoderParseOffset(item?.offset) === offset) || null;
}

function wb3FindRoomSubrecordCatalog(map) {
  return wb3DecoderArray(map?.roomDataCatalogs)
    .find(catalog => catalog?.id === 'world-room-subrecord-catalog-2026-06-25') || null;
}

function wb3RoomTriggerDispatchRole(opcode) {
  const raw = Number(opcode) & 0xff;
  const index = raw & 0x1f;
  const handlers = [
    '_LABEL_4903_', '_LABEL_492B_', '_LABEL_492B_', '_LABEL_492B_',
    '_LABEL_492B_', '_LABEL_492B_', '_LABEL_4942_', '_LABEL_4961_',
    '_LABEL_497A_', '_LABEL_4980_', '_LABEL_4980_', '_LABEL_4988_',
    '_LABEL_4988_', '_LABEL_492B_', '_LABEL_492B_', '_LABEL_492B_',
    '_LABEL_4995_', '_LABEL_49A9_', '_LABEL_49AF_', '_LABEL_49D4_',
    '_LABEL_49DD_', '_LABEL_49E6_', '_LABEL_4903_', '_LABEL_4903_',
    '_LABEL_4903_', '_LABEL_4903_', '_LABEL_492B_', '_LABEL_492B_',
    '_LABEL_49EF_', '_LABEL_49F8_', '_LABEL_492B_',
  ];
  const roleByHandler = {
    _LABEL_4903_: 'immediate_room_load',
    _LABEL_492B_: 'deferred_player_state_transition',
    _LABEL_4942_: 'auxiliary_spawn_gate_a',
    _LABEL_4961_: 'auxiliary_spawn_gate_b',
    _LABEL_497A_: 'cf6a_request_1',
    _LABEL_4980_: 'd000_gate_then_deferred_transition',
    _LABEL_4988_: 'cf49_gate_then_deferred_transition',
    _LABEL_4995_: 'd1b0_script_start',
    _LABEL_49A9_: 'cf6a_request_3',
    _LABEL_49AF_: 'inventory_gate_bit0',
    _LABEL_49D4_: 'inventory_gate_bit1',
    _LABEL_49DD_: 'inventory_gate_bit2',
    _LABEL_49E6_: 'inventory_gate_bit3',
    _LABEL_49EF_: 'money_gate',
    _LABEL_49F8_: 'd246_sound_effect_request',
  };
  const handler = handlers[index] || '';
  return {
    rawOpcode: raw,
    rawOpcodeHex: wb3DecoderHex(raw, 2),
    dispatchIndex: index,
    dispatchIndexHex: wb3DecoderHex(index, 2),
    transitionFlagBit7: !!(raw & 0x80),
    handler,
    role: roleByHandler[handler] || 'unknown_trigger_handler',
    dispatchTable: '_DATA_48C5_',
  };
}

function wb3RoomEventSelectorRole(selector) {
  const value = Number(selector) & 0xff;
  if (value === 0x00) return 'special_constant_46_with_payload';
  if (value === 0xff) return 'special_constant_5b';
  return 'lookup_pickup_object_id';
}

function wb3FindRoomEventTableAuditEntry(map, romOffset) {
  if (romOffset == null) return null;
  const wanted = wb3DecoderHex(romOffset);
  for (const region of wb3DecoderArray(map?.regions)) {
    const audit = region?.analysis?.roomEventTableAudit;
    for (const detail of wb3DecoderArray(audit?.details)) {
      if (detail?.detail?.eventTableRomOffset === wanted) {
        return {
          regionId: region.id || '',
          role: detail.role || '',
          confidence: detail.confidence || audit.confidence || '',
          summary: detail.summary || '',
          referenceCount: detail.detail?.referenceCount ?? null,
          uniqueSubrecordCount: detail.detail?.uniqueSubrecordCount ?? null,
          decoded: detail.detail?.decoded || null,
        };
      }
    }
  }
  return null;
}

function wb3HexByteOrKeep(value, keepValue, pixelsScale) {
  const v = Number(value) & 0xff;
  if (v === keepValue) return { raw: wb3DecoderHex(v, 2), keep: true };
  const out = { raw: wb3DecoderHex(v, 2) };
  if (pixelsScale) out.pixels = v * pixelsScale;
  return out;
}

function wb3ParseRoomDoorTableProbe(rom, map, romOffset, options) {
  options = options || {};
  const records = [];
  const warnings = [];
  let pos = romOffset;
  let terminatorOffset = null;
  const maxRecords = options.maxRoomDoorRecords || 64;
  const graph = wb3FindZoneGraph(map);
  const descriptorId = options.descriptorId || '';
  for (let index = 0; index < maxRecords && pos < rom.length; index++) {
    if (rom[pos] === 0xff) {
      terminatorOffset = pos;
      break;
    }
    if (pos + 6 >= rom.length) {
      warnings.push(`Truncated room trigger/door record at ${wb3DecoderHex(pos)}.`);
      break;
    }
    const xUnit = rom[pos];
    const yAnchor = rom[pos + 1];
    const xSpanUnits = rom[pos + 2];
    const ySpan = rom[pos + 3];
    const triggerOpcode = rom[pos + 4];
    const dispatch = wb3RoomTriggerDispatchRole(triggerOpcode);
    const destZ80 = wb3ReadWordLE(rom, pos + 5);
    const destRom = destZ80 == null ? null : wb3Bank4Z80ToRom(destZ80);
    const graphEdge = wb3FindZoneGraphEdge(graph, descriptorId, index);
    const rejectedTarget = wb3FindZoneGraphRejectedTarget(graph, destRom);
    let destinationStatus = 'unresolved';
    if (graphEdge?.destinationValid) destinationStatus = 'zone_graph_descriptor';
    else if (rejectedTarget) destinationStatus = 'rejected_graph_candidate';
    else if (destRom != null) destinationStatus = 'bank4_pointer';
    records.push({
      index,
      offset: pos,
      offsetHex: wb3DecoderHex(pos),
      xUnit,
      xUnitHex: wb3DecoderHex(xUnit, 2),
      scrollPositionPixels: xUnit * 8,
      yAnchor,
      yAnchorHex: wb3DecoderHex(yAnchor, 2),
      xSpanUnits,
      xSpanUnitsHex: wb3DecoderHex(xSpanUnits, 2),
      xSpanPixels: xSpanUnits * 8,
      ySpan,
      ySpanHex: wb3DecoderHex(ySpan, 2),
      triggerOpcode,
      triggerOpcodeHex: wb3DecoderHex(triggerOpcode, 2),
      dispatch,
      destinationZ80: destZ80,
      destinationZ80Hex: destZ80 == null ? null : wb3DecoderHex(destZ80, 4),
      destinationRom: destRom,
      destinationRomHex: destRom == null ? null : wb3DecoderHex(destRom),
      destinationRegion: destRom == null ? null : wb3FindRegionAtOffset(map, destRom),
      destinationStatus,
      graphEdge: graphEdge ? {
        to: graphEdge.to || '',
        destinationValid: !!graphEdge.destinationValid,
        roomType: graphEdge.roomType ?? null,
        scrollPositionPixels: graphEdge.scrollPositionPixels ?? null,
      } : null,
      rejectedTarget: rejectedTarget ? {
        offset: rejectedTarget.offset || '',
        issues: wb3DecoderArray(rejectedTarget.issues),
      } : null,
    });
    if (destRom == null) warnings.push(`Door/trigger record ${index} destination pointer is outside bank 4.`);
    pos += 7;
  }
  if (terminatorOffset == null) warnings.push(`Door/trigger table did not terminate within ${maxRecords} record(s).`);
  return {
    romOffset,
    romOffsetHex: wb3DecoderHex(romOffset),
    recordCount: records.length,
    terminatorOffset,
    terminatorOffsetHex: terminatorOffset == null ? null : wb3DecoderHex(terminatorOffset),
    records,
    opcodeCounts: records.reduce((out, record) => {
      const key = record.dispatch?.rawOpcodeHex || 'unknown';
      out[key] = (out[key] || 0) + 1;
      return out;
    }, {}),
    handlerCounts: records.reduce((out, record) => {
      const key = record.dispatch?.handler || 'unknown';
      out[key] = (out[key] || 0) + 1;
      return out;
    }, {}),
    destinationStatusCounts: records.reduce((out, record) => {
      const key = record.destinationStatus || 'unknown';
      out[key] = (out[key] || 0) + 1;
      return out;
    }, {}),
    warnings,
  };
}

function wb3ParseRoomEventTableProbe(rom, map, romOffset, options) {
  options = options || {};
  const records = [];
  const warnings = [];
  let pos = romOffset;
  let terminatorOffset = null;
  const maxRecords = options.maxRoomEventRecords || 64;
  for (let index = 0; index < maxRecords && pos < rom.length; index++) {
    const keyX = rom[pos];
    if (keyX === 0xff) {
      terminatorOffset = pos;
      break;
    }
    if (pos + 2 >= rom.length) {
      warnings.push(`Truncated room event record at ${wb3DecoderHex(pos)}.`);
      break;
    }
    const keyY = rom[pos + 1];
    const selector = rom[pos + 2];
    const selectorRole = wb3RoomEventSelectorRole(selector);
    const record = {
      index,
      offset: pos,
      offsetHex: wb3DecoderHex(pos),
      keyX,
      keyXHex: wb3DecoderHex(keyX, 2),
      keyY,
      keyYHex: wb3DecoderHex(keyY, 2),
      selector,
      selectorHex: wb3DecoderHex(selector, 2),
      selectorRole,
      sizeBytes: selector === 0x00 ? 6 : 3,
    };
    if (selector === 0x00) {
      if (pos + 5 >= rom.length) {
        warnings.push(`Truncated room event payload at ${wb3DecoderHex(pos)}.`);
        break;
      }
      const payloadWord = wb3ReadWordLE(rom, pos + 3);
      record.payloadWord = payloadWord;
      record.payloadWordHex = payloadWord == null ? null : wb3DecoderHex(payloadWord, 4);
      record.payloadByte = rom[pos + 5];
      record.payloadByteHex = wb3DecoderHex(record.payloadByte, 2);
    }
    records.push(record);
    pos += record.sizeBytes;
  }
  if (terminatorOffset == null) warnings.push(`Room event table did not terminate within ${maxRecords} record(s).`);
  const auditEntry = wb3FindRoomEventTableAuditEntry(map, romOffset);
  const selectorRoleCounts = records.reduce((out, record) => {
    const key = record.selectorRole || 'unknown';
    out[key] = (out[key] || 0) + 1;
    return out;
  }, {});
  return {
    romOffset,
    romOffsetHex: wb3DecoderHex(romOffset),
    recordCount: records.length,
    terminatorOffset,
    terminatorOffsetHex: terminatorOffset == null ? null : wb3DecoderHex(terminatorOffset),
    byteLength: terminatorOffset == null ? null : terminatorOffset - romOffset + 1,
    selectorRoleCounts,
    auditEntry,
    records,
    warnings,
  };
}

function wb3ParseRoomSubrecordShape(rom, map, romOffset, options) {
  options = options || {};
  if (romOffset == null || romOffset < 0 || romOffset + 17 >= rom.length) {
    return { valid: false, romOffset, romOffsetHex: wb3DecoderHex(romOffset || 0), warnings: ['Subrecord offset is outside ROM.'] };
  }
  const triggerTableZ80 = wb3ReadWordLE(rom, romOffset);
  const eventTableZ80 = wb3ReadWordLE(rom, romOffset + 2);
  const entityListZ80 = wb3ReadWordLE(rom, romOffset + 4);
  const overlayIndex = rom[romOffset + 6];
  const paletteScriptIndex = rom[romOffset + 7];
  const loader8fbZ80 = wb3ReadWordLE(rom, romOffset + 8);
  const dc2Indices = Array.from(rom.subarray(romOffset + 10, romOffset + 16));
  const flags = rom[romOffset + 16];
  const audioRequestId = rom[romOffset + 17];
  const triggerTableRom = triggerTableZ80 == null ? null : wb3Bank4Z80ToRom(triggerTableZ80);
  const eventTableRom = eventTableZ80 == null ? null : wb3Bank4Z80ToRom(eventTableZ80);
  const entityListRom = entityListZ80 == null ? null : wb3Bank4Z80ToRom(entityListZ80);
  const loader8fbRom = loader8fbZ80 == null ? null : wb3Bank4Z80ToRom(loader8fbZ80);
  const triggerTablePreview = triggerTableRom == null ? null : wb3ParseRoomDoorTableProbe(rom, map, triggerTableRom, options);
  const eventTablePreview = eventTableRom == null ? null : wb3ParseRoomEventTableProbe(rom, map, eventTableRom, options);
  const activeDc2PrefixCount = dc2Indices.findIndex(value => value === 0xff);
  const warnings = [];
  if (triggerTableRom == null) warnings.push('Trigger/door table pointer is outside bank 4.');
  if (eventTableRom == null) warnings.push('Event table pointer is outside bank 4.');
  if (entityListRom == null) warnings.push('Entity list pointer is outside bank 4.');
  if (loader8fbRom == null) warnings.push('8FB loader pointer is outside bank 4.');
  if (!dc2Indices.every(value => value <= 0xaf || value === 0xff)) warnings.push('One or more DC2 stream indices are outside the expected 0x00-0xAF/0xFF range.');
  warnings.push(...(triggerTablePreview?.warnings || []));
  warnings.push(...(eventTablePreview?.warnings || []));
  const extra998 = !(flags & 0x80)
    ? { status: 'required', regionId: 'r0033', sourceLabel: '_DATA_275D_', condition: 'flags bit7 = 0' }
    : ((flags & 0x40)
      ? { status: 'skipped', condition: 'flags bit7 = 1 and bit6 = 1' }
      : { status: 'required', regionId: 'r0034', sourceLabel: '_DATA_2762_', condition: 'flags bit7 = 1 and bit6 = 0' });
  return {
    valid: warnings.length === 0,
    romOffset,
    romOffsetHex: wb3DecoderHex(romOffset),
    triggerTable: {
      z80Pointer: triggerTableZ80,
      z80PointerHex: triggerTableZ80 == null ? null : wb3DecoderHex(triggerTableZ80, 4),
      romOffset: triggerTableRom,
      romOffsetHex: triggerTableRom == null ? null : wb3DecoderHex(triggerTableRom),
      region: triggerTableRom == null ? null : wb3FindRegionAtOffset(map, triggerTableRom),
      preview: triggerTablePreview,
    },
    eventTable: {
      z80Pointer: eventTableZ80,
      z80PointerHex: eventTableZ80 == null ? null : wb3DecoderHex(eventTableZ80, 4),
      romOffset: eventTableRom,
      romOffsetHex: eventTableRom == null ? null : wb3DecoderHex(eventTableRom),
      region: eventTableRom == null ? null : wb3FindRegionAtOffset(map, eventTableRom),
      preview: eventTablePreview,
    },
    entityList: {
      z80Pointer: entityListZ80,
      z80PointerHex: entityListZ80 == null ? null : wb3DecoderHex(entityListZ80, 4),
      romOffset: entityListRom,
      romOffsetHex: entityListRom == null ? null : wb3DecoderHex(entityListRom),
      region: entityListRom == null ? null : wb3FindRegionAtOffset(map, entityListRom),
    },
    overlayIndex,
    overlayIndexHex: wb3DecoderHex(overlayIndex, 2),
    paletteScriptIndex,
    paletteScriptIndexHex: wb3DecoderHex(paletteScriptIndex, 2),
    vramLoader8fb: {
      z80Pointer: loader8fbZ80,
      z80PointerHex: loader8fbZ80 == null ? null : wb3DecoderHex(loader8fbZ80, 4),
      romOffset: loader8fbRom,
      romOffsetHex: loader8fbRom == null ? null : wb3DecoderHex(loader8fbRom),
      region: loader8fbRom == null ? null : wb3FindRegionAtOffset(map, loader8fbRom),
    },
    dc2Indices: dc2Indices.map((value, slot) => ({
      slot,
      index: value,
      indexHex: wb3DecoderHex(value, 2),
      disabled: value === 0xff,
    })),
    activeDc2PrefixCount: activeDc2PrefixCount < 0 ? dc2Indices.length : activeDc2PrefixCount,
    flags,
    flagsHex: wb3DecoderHex(flags, 2),
    bgPaletteIndex: flags & 0x3f,
    extra998,
    audioRequestId,
    audioRequestIdHex: wb3DecoderHex(audioRequestId, 2),
    audioRequestInTable: audioRequestId < 62,
    warnings,
  };
}

function wb3ParseRoomDescriptorShape(rom, map, offset, options) {
  options = options || {};
  if (offset == null || offset < 0 || offset + 5 >= rom.length) {
    return { valid: false, offset, offsetHex: wb3DecoderHex(offset || 0), warnings: ['Descriptor offset is outside ROM.'] };
  }
  const scrollX = rom[offset];
  const scrollY = rom[offset + 1];
  const cameraX = rom[offset + 2];
  const cameraY = rom[offset + 3];
  const subrecordZ80 = wb3ReadWordLE(rom, offset + 4);
  const subrecordRom = subrecordZ80 == null ? null : wb3Bank4Z80ToRom(subrecordZ80);
  const graph = wb3FindZoneGraph(map);
  const graphDescriptor = wb3DecoderArray(graph?.descriptors)
    .find(item => wb3DecoderParseOffset(item?.descriptorOffset) === offset) || null;
  const subrecordOptions = Object.assign({}, options, { descriptorId: graphDescriptor?.id || '' });
  const subrecord = subrecordRom == null ? null : wb3ParseRoomSubrecordShape(rom, map, subrecordRom, subrecordOptions);
  const outgoingEdges = wb3DecoderArray(graph?.edges)
    .filter(edge => edge?.from === graphDescriptor?.id)
    .slice(0, options.roomEdgePreviewLimit || 32);
  const warnings = [];
  if (subrecordRom == null) warnings.push('Descriptor subrecord pointer is outside bank 4.');
  if (!graphDescriptor) warnings.push('Descriptor offset is not present in world-zone-graph-2026-06-24; treating as structural probe only.');
  else if (graphDescriptor.subrecord?.romOffset && wb3DecoderParseOffset(graphDescriptor.subrecord.romOffset) !== subrecordRom) {
    warnings.push('ROM-local subrecord pointer does not match the zone graph catalog.');
  }
  warnings.push(...(subrecord?.warnings || []));
  return {
    valid: warnings.length === 0 || (warnings.length === (subrecord?.warnings || []).length && !!graphDescriptor),
    id: graphDescriptor?.id || `descriptor_${wb3DecoderHex(offset).slice(2)}`,
    offset,
    offsetHex: wb3DecoderHex(offset),
    region: wb3FindRegionAtOffset(map, offset),
    graphBacked: !!graphDescriptor,
    graphDescriptor,
    scroll: {
      x: wb3HexByteOrKeep(scrollX, 0xff, 8),
      y: wb3HexByteOrKeep(scrollY, 0xff, 0),
    },
    camera: {
      x: wb3HexByteOrKeep(cameraX, 0x80, 0x100),
      y: wb3HexByteOrKeep(cameraY, 0x80, 0x100),
    },
    subrecordPointer: {
      z80Pointer: subrecordZ80,
      z80PointerHex: subrecordZ80 == null ? null : wb3DecoderHex(subrecordZ80, 4),
      romOffset: subrecordRom,
      romOffsetHex: subrecordRom == null ? null : wb3DecoderHex(subrecordRom),
      region: subrecordRom == null ? null : wb3FindRegionAtOffset(map, subrecordRom),
    },
    subrecord,
    outgoingEdges,
    outgoingEdgeCount: wb3DecoderArray(graph?.edges).filter(edge => edge?.from === graphDescriptor?.id).length,
    warnings,
  };
}

function wb3CollectRoomDescriptorsForRegion(map, region, limit) {
  const start = wb3DecoderParseOffset(region?.offset);
  const size = Number(region?.size || 0);
  const end = start == null ? null : start + size;
  const graph = wb3FindZoneGraph(map);
  return wb3DecoderArray(graph?.descriptors)
    .map(item => ({ item, offset: wb3DecoderParseOffset(item?.descriptorOffset) }))
    .filter(item => item.offset != null && start != null && item.offset >= start && item.offset < end)
    .sort((a, b) => a.offset - b.offset)
    .slice(0, limit || 512);
}

function wb3DecodeRoomDescriptorRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const descriptor = wb3ParseRoomDescriptorShape(rom, map, offset, options);
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `Room descriptor ${descriptor.offsetHex}: subrecord ${descriptor.subrecordPointer.romOffsetHex || 'unresolved'}, ${descriptor.subrecord?.triggerTable?.preview?.recordCount ?? 0} trigger record(s), ${descriptor.subrecord?.eventTable?.preview?.recordCount ?? 0} event record(s), ${descriptor.outgoingEdgeCount} graph edge(s).`,
    {
      offset,
      size: Number(region.size || 0),
      descriptorCount: 1,
      graphBacked: descriptor.graphBacked,
      outgoingEdgeCount: descriptor.outgoingEdgeCount,
      triggerRecordCount: descriptor.subrecord?.triggerTable?.preview?.recordCount ?? 0,
      eventRecordCount: descriptor.subrecord?.eventTable?.preview?.recordCount ?? 0,
      subrecordOffset: descriptor.subrecordPointer.romOffset,
      activeDc2PrefixCount: descriptor.subrecord?.activeDc2PrefixCount ?? 0,
      bgPaletteIndex: descriptor.subrecord?.bgPaletteIndex ?? null,
      audioRequestId: descriptor.subrecord?.audioRequestId ?? null,
      loader8fbOffset: descriptor.subrecord?.vramLoader8fb?.romOffset ?? null,
    },
    descriptor.warnings || [],
    options.includeTransientPreview ? {
      kind: 'room_descriptor',
      descriptor,
      semantics: {
        loaderRoutine: '_LABEL_2620_',
        subrecordRoutine: '_LABEL_26F4_',
        descriptorShape: 'scrollX, scrollY, cameraX, cameraY, bank-4 subrecord pointer',
        subrecordShape: 'trigger pointer, event pointer, entity list pointer, overlay/palette script bytes, 8FB loader pointer, six DC2 indices, flags/palette byte, audio request byte',
      },
    } : null);
}

function wb3DecodeRoomDataRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const descriptors = wb3CollectRoomDescriptorsForRegion(map, region, options.roomDescriptorLimit || 512)
    .map(entry => wb3ParseRoomDescriptorShape(rom, map, entry.offset, options));
  const graph = wb3FindZoneGraph(map);
  const edgeCount = descriptors.reduce((sum, descriptor) => sum + descriptor.outgoingEdgeCount, 0);
  const uniqueSubrecords = new Set(descriptors.map(descriptor => descriptor.subrecordPointer.romOffsetHex).filter(Boolean));
  const uniqueLoaders = new Set(descriptors.map(descriptor => descriptor.subrecord?.vramLoader8fb?.romOffsetHex).filter(Boolean));
  const uniqueTriggerTables = new Set(descriptors.map(descriptor => descriptor.subrecord?.triggerTable?.romOffsetHex).filter(Boolean));
  const uniqueEventTables = new Set(descriptors.map(descriptor => descriptor.subrecord?.eventTable?.romOffsetHex).filter(Boolean));
  const triggerRecordCount = descriptors.reduce((sum, descriptor) => sum + (descriptor.subrecord?.triggerTable?.preview?.recordCount || 0), 0);
  const eventRecordCount = descriptors.reduce((sum, descriptor) => sum + (descriptor.subrecord?.eventTable?.preview?.recordCount || 0), 0);
  const paletteCounts = {};
  const audioCounts = {};
  const triggerHandlerCounts = {};
  const eventSelectorRoleCounts = {};
  for (const descriptor of descriptors) {
    const palette = descriptor.subrecord?.bgPaletteIndex;
    const audio = descriptor.subrecord?.audioRequestIdHex;
    if (palette != null) paletteCounts[palette] = (paletteCounts[palette] || 0) + 1;
    if (audio) audioCounts[audio] = (audioCounts[audio] || 0) + 1;
    for (const [handler, count] of Object.entries(descriptor.subrecord?.triggerTable?.preview?.handlerCounts || {})) {
      triggerHandlerCounts[handler] = (triggerHandlerCounts[handler] || 0) + count;
    }
    for (const [role, count] of Object.entries(descriptor.subrecord?.eventTable?.preview?.selectorRoleCounts || {})) {
      eventSelectorRoleCounts[role] = (eventSelectorRoleCounts[role] || 0) + count;
    }
  }
  const warnings = [];
  if (!graph) warnings.push('Zone graph catalog not found; no descriptor ownership data available.');
  if (!descriptors.length) warnings.push('No zone graph descriptors start inside this room_data region.');
  return wb3MakeDecodeResult(decoder, asset, region, descriptors.length ? 'decoded' : 'partial',
    `${descriptors.length} graph-backed descriptor(s), ${triggerRecordCount} trigger/door record(s), ${eventRecordCount} event record(s), ${uniqueSubrecords.size} unique subrecord pointer(s), ${uniqueLoaders.size} unique 8FB loader(s).`,
    {
      offset,
      size: Number(region.size || 0),
      descriptorCount: descriptors.length,
      outgoingEdgeCount: edgeCount,
      triggerRecordCount,
      eventRecordCount,
      uniqueSubrecordCount: uniqueSubrecords.size,
      uniqueLoader8fbCount: uniqueLoaders.size,
      uniqueTriggerTableCount: uniqueTriggerTables.size,
      uniqueEventTableCount: uniqueEventTables.size,
      paletteCounts,
      audioRequestCounts: audioCounts,
      triggerHandlerCounts,
      eventSelectorRoleCounts,
      sourceGraphId: graph?.id || null,
    },
    warnings.concat(descriptors.flatMap(descriptor => descriptor.warnings || []).slice(0, 16)),
    options.includeTransientPreview ? {
      kind: 'room_descriptor_graph_region',
      descriptors: descriptors.slice(0, options.roomDescriptorPreviewLimit || 160),
      descriptorCount: descriptors.length,
      outgoingEdgeCount: edgeCount,
      triggerRecordCount,
      eventRecordCount,
      uniqueSubrecordCount: uniqueSubrecords.size,
      uniqueLoader8fbCount: uniqueLoaders.size,
      uniqueTriggerTableCount: uniqueTriggerTables.size,
      uniqueEventTableCount: uniqueEventTables.size,
      paletteCounts,
      audioRequestCounts: audioCounts,
      triggerHandlerCounts,
      eventSelectorRoleCounts,
      sourceGraphId: graph?.id || null,
      sourceGraphSummary: graph?.summary || null,
      semantics: {
        loaderRoutine: '_LABEL_2620_',
        subrecordRoutine: '_LABEL_26F4_',
        triggerRoutine: '_LABEL_4816_/_LABEL_48A9_',
        eventRoutine: '_LABEL_635D_',
      },
    } : null);
}

function wb3DecodeRoomSubrecordTableRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const catalog = wb3FindRoomSubrecordCatalog(map);
  const layout = catalog?.layout?.subrecordRange || {};
  const start = wb3DecoderParseOffset(layout.offset) ?? (offset + 2);
  const stride = Number(layout.stride || 18);
  const count = Number(layout.count || Math.floor(Math.max(0, Number(region.size || 0) - 2) / stride));
  const graph = wb3FindZoneGraph(map);
  const reached = new Set(wb3DecoderArray(graph?.descriptors).map(descriptor => wb3DecoderParseOffset(descriptor?.subrecord?.romOffset)).filter(value => value != null));
  const records = [];
  for (let index = 0; index < count; index++) {
    const recordOffset = start + index * stride;
    const parsed = wb3ParseRoomSubrecordShape(rom, map, recordOffset, options);
    parsed.index = index;
    parsed.status = reached.has(recordOffset) ? 'zone_graph_reached' : 'structural_orphan';
    records.push(parsed);
  }
  const invalidRecords = records.filter(record => (record.warnings || []).length);
  const uniqueLoaders = new Set(records.map(record => record.vramLoader8fb?.romOffsetHex).filter(Boolean));
  const uniqueTriggerTables = new Set(records.map(record => record.triggerTable?.romOffsetHex).filter(Boolean));
  const uniqueEventTables = new Set(records.map(record => record.eventTable?.romOffsetHex).filter(Boolean));
  const triggerRecordCount = records.reduce((sum, record) => sum + (record.triggerTable?.preview?.recordCount || 0), 0);
  const eventRecordCount = records.reduce((sum, record) => sum + (record.eventTable?.preview?.recordCount || 0), 0);
  const reachedCount = records.filter(record => record.status === 'zone_graph_reached').length;
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${records.length} aligned ${stride}-byte room subrecord(s), ${reachedCount} reached by zone graph, ${triggerRecordCount} trigger record(s), ${eventRecordCount} event record(s).`,
    {
      offset,
      size: Number(region.size || 0),
      subrecordStart: start,
      stride,
      subrecordCount: records.length,
      zoneGraphReachedSubrecords: reachedCount,
      structuralOrphanSubrecords: records.length - reachedCount,
      invalidSubrecords: invalidRecords.length,
      uniqueLoader8fbCount: uniqueLoaders.size,
      uniqueTriggerTableCount: uniqueTriggerTables.size,
      uniqueEventTableCount: uniqueEventTables.size,
      triggerRecordCount,
      eventRecordCount,
      catalogId: catalog?.id || null,
    },
    invalidRecords.slice(0, 8).map(record => `Subrecord ${record.index} ${record.romOffsetHex}: ${record.warnings.join(' ')}`),
    options.includeTransientPreview ? {
      kind: 'room_subrecord_table',
      records: records.slice(0, options.roomSubrecordPreviewLimit || 160),
      subrecordCount: records.length,
      zoneGraphReachedSubrecords: reachedCount,
      structuralOrphanSubrecords: records.length - reachedCount,
      uniqueLoader8fbCount: uniqueLoaders.size,
      uniqueTriggerTableCount: uniqueTriggerTables.size,
      uniqueEventTableCount: uniqueEventTables.size,
      triggerRecordCount,
      eventRecordCount,
      layout: {
        tableOffset: region.offset,
        subrecordStart: wb3DecoderHex(start),
        stride,
        count: records.length,
      },
      semantics: {
        routine: '_LABEL_26F4_',
        copiedRamRange: '_RAM_CF5E_.._RAM_CF65_',
        fieldRoles: [
          '+0/+1 trigger table pointer -> _RAM_CF5E_',
          '+2/+3 event table pointer -> _RAM_CF60_',
          '+4/+5 entity list pointer -> _RAM_CF62_',
          '+6 overlay tile index -> _RAM_CF64_',
          '+7 palette script index -> _RAM_CF65_',
          '+8/+9 _LABEL_8FB_ loader pointer',
          '+10..+15 _LABEL_DC2_ indices',
          '+16 flags/BG palette and optional _LABEL_998_ selector',
          '+17 audio request id',
        ],
        triggerRoutine: '_LABEL_4816_/_LABEL_48A9_',
        eventRoutine: '_LABEL_635D_',
      },
    } : null);
}

function wb3DecodeRoomZoneRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region?.offset);
  if (!rom || offset == null) return wb3MakeDecodeResult(decoder, asset, region, 'needs_rom', 'Load the local ROM to decode this room/zone region.', {}, [], null);
  if (region.type === 'room_subrecord') return wb3DecodeRoomSubrecordTableRegion(asset, region, rom, map, decoder, options);
  if (region.type === 'room_seq_table') return wb3DecodeRoomDescriptorRegion(asset, region, rom, map, decoder, options);
  return wb3DecodeRoomDataRegion(asset, region, rom, map, decoder, options);
}

function wb3FindEntityCatalog(map, id) {
  for (const key of ['entityDataCatalogs', 'entityBehaviorCatalogs', 'itemDataCatalogs']) {
    const found = wb3DecoderArray(map?.[key]).find(catalog => catalog?.id === id);
    if (found) return found;
  }
  return null;
}

function wb3RoomEntityDynamicTableEntry(rom, map, table, tableIndex) {
  const normal = table !== 'alternate';
  const base = normal ? 0x1DD60 : 0x1DE00;
  const slots = normal ? 80 : 16;
  if (tableIndex < 0 || tableIndex >= slots) {
    return {
      table,
      tableIndex,
      valid: false,
      warning: `Dynamic tile table index ${tableIndex} is outside ${table} table bounds.`,
    };
  }
  const entryOffset = base + tableIndex * 2;
  const word = wb3ReadWordLE(rom, entryOffset);
  if (word == null) return { table, tableIndex, valid: false, warning: 'Dynamic tile table entry is outside ROM.' };
  const streamZ80 = (word & 0x3fff) | 0x8000;
  const streamRom = wb3Bank7Z80ToRom(streamZ80);
  return {
    table,
    tableIndex,
    valid: true,
    tableId: normal ? 'entity_dynamic_tiles_normal' : 'entity_dynamic_tiles_alternate',
    entryOffset,
    entryOffsetHex: wb3DecoderHex(entryOffset),
    word,
    wordHex: wb3DecoderHex(word, 4),
    remapRow: (word >>> 14) & 0x03,
    streamZ80,
    streamZ80Hex: wb3DecoderHex(streamZ80, 4),
    streamRom,
    streamRomHex: streamRom == null ? null : wb3DecoderHex(streamRom),
    streamRegion: streamRom == null ? null : wb3FindRegionAtOffset(map, streamRom),
    zeroPadding: word === 0,
  };
}

function wb3ParseRoomEntityList(rom, map, startOffset, options) {
  options = options || {};
  const maxRecords = options.maxRoomEntityRecords || 128;
  const regionEnd = Math.min(options.regionEnd || rom.length, rom.length);
  const records = [];
  const warnings = [];
  const entityTypeCounts = {};
  const dynamicIndexCounts = {};
  let pos = startOffset;
  let terminatorOffset = null;
  let terminated = false;
  for (let index = 0; index < maxRecords && pos < rom.length && pos < regionEnd; index++) {
    const recordOffset = pos;
    const entityType = rom[pos++];
    if (entityType === 0xff) {
      terminatorOffset = recordOffset;
      terminated = true;
      break;
    }
    const alternate = !!(entityType & 0x80);
    const table = alternate ? 'alternate' : 'normal';
    const tableIndex = (entityType & 0x7f) - 1;
    const dynamicTableEntry = wb3RoomEntityDynamicTableEntry(rom, map, table, tableIndex);
    const record = {
      index: records.length,
      offset: recordOffset,
      offsetHex: wb3DecoderHex(recordOffset),
      entityType,
      entityTypeHex: wb3DecoderHex(entityType, 2),
      table,
      tableIndex,
      alternate,
      dynamicTableEntry,
      fieldBytes: [],
    };
    entityTypeCounts[record.entityTypeHex] = (entityTypeCounts[record.entityTypeHex] || 0) + 1;
    const dynamicKey = `${table}:${tableIndex}`;
    dynamicIndexCounts[dynamicKey] = (dynamicIndexCounts[dynamicKey] || 0) + 1;
    if (!alternate) {
      if (pos + 2 >= rom.length || pos + 2 >= regionEnd) {
        warnings.push(`Truncated normal room entity record at ${wb3DecoderHex(recordOffset)}.`);
        records.push(record);
        break;
      }
      const field0 = rom[pos++];
      const field1 = rom[pos++];
      const field2 = rom[pos++];
      record.fieldBytes = [
        { offset: recordOffset + 1, offsetHex: wb3DecoderHex(recordOffset + 1), name: 'field0_scaled_by_8_in_label_2963', value: field0, valueHex: wb3DecoderHex(field0, 2), scaledValue: field0 * 8 },
        { offset: recordOffset + 2, offsetHex: wb3DecoderHex(recordOffset + 2), name: 'field1_copied_to_ix_plus_3', value: field1, valueHex: wb3DecoderHex(field1, 2) },
        { offset: recordOffset + 3, offsetHex: wb3DecoderHex(recordOffset + 3), name: 'field2_copied_to_ix_plus_4', value: field2, valueHex: wb3DecoderHex(field2, 2) },
      ];
    }
    records.push(record);
  }
  if (!terminated && !warnings.length) warnings.push(`Room entity list did not terminate within ${maxRecords} record(s) or selected region range.`);
  const normalRecordCount = records.filter(record => !record.alternate).length;
  const alternateRecordCount = records.filter(record => record.alternate).length;
  return {
    startOffset,
    startOffsetHex: wb3DecoderHex(startOffset),
    endExclusive: pos,
    endExclusiveHex: wb3DecoderHex(pos),
    terminatorOffset,
    terminatorOffsetHex: terminatorOffset == null ? null : wb3DecoderHex(terminatorOffset),
    terminated,
    records,
    normalRecordCount,
    alternateRecordCount,
    entityTypeCounts,
    dynamicIndexCounts,
    warnings,
    containingRegion: wb3FindRegionAtOffset(map, startOffset),
  };
}

function wb3CollectRoomEntityListStarts(map, region, limit) {
  const regionStart = wb3DecoderParseOffset(region?.offset);
  const regionSize = Number(region?.size || 0);
  const regionEnd = regionStart == null ? null : regionStart + regionSize;
  const starts = new Map();
  function add(offset, item) {
    if (offset == null || regionStart == null || offset < regionStart || offset >= regionEnd) return;
    const existing = starts.get(offset);
    const next = Object.assign({
      offset,
      offsetHex: wb3DecoderHex(offset),
      sourceCatalogId: '',
      subrecordRefCount: 0,
      catalogRecordCount: null,
      catalogTerminated: null,
      role: '',
    }, item || {});
    if (!existing || (next.subrecordRefCount || 0) > (existing.subrecordRefCount || 0)) starts.set(offset, next);
  }
  const reached = wb3FindEntityCatalog(map, 'world-room-entity-list-catalog-2026-06-25');
  for (const list of wb3DecoderArray(reached?.entityLists)) {
    add(wb3DecoderParseOffset(list.romOffset), {
      sourceCatalogId: reached.id,
      z80Pointer: list.z80Pointer || null,
      subrecordIndexes: list.subrecordIndexes || [],
      subrecordRefCount: Number(list.subrecordRefCount || 0),
      catalogRecordCount: Number(list.recordCount || 0),
      catalogTerminated: list.terminated,
      role: 'cf62_reached_room_entity_list',
    });
  }
  const orphan = wb3FindEntityCatalog(map, 'world-room-entity-orphan-list-catalog-2026-06-25');
  for (const list of wb3DecoderArray(orphan?.decodedLists)) {
    add(wb3DecoderParseOffset(list.startOffset), {
      sourceCatalogId: orphan.id,
      subrecordRefCount: 0,
      catalogRecordCount: Number(list.recordCount || 0),
      catalogTerminated: list.terminated,
      role: 'orphan_room_entity_list',
    });
  }
  if (!starts.size && regionStart != null) {
    add(regionStart, {
      sourceCatalogId: '',
      role: 'region_start_probe',
    });
  }
  return [...starts.values()].sort((a, b) => a.offset - b.offset).slice(0, limit || 256);
}

function wb3AggregateRoomEntityLists(lists) {
  const entityTypeCounts = {};
  const dynamicIndexCounts = {};
  let totalRecords = 0;
  let normalRecords = 0;
  let alternateRecords = 0;
  let terminatedLists = 0;
  for (const list of lists) {
    totalRecords += list.records.length;
    normalRecords += list.normalRecordCount;
    alternateRecords += list.alternateRecordCount;
    if (list.terminated) terminatedLists++;
    for (const [key, count] of Object.entries(list.entityTypeCounts || {})) {
      entityTypeCounts[key] = (entityTypeCounts[key] || 0) + count;
    }
    for (const [key, count] of Object.entries(list.dynamicIndexCounts || {})) {
      dynamicIndexCounts[key] = (dynamicIndexCounts[key] || 0) + count;
    }
  }
  const topEntityTypes = Object.entries(entityTypeCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 32)
    .map(([entityTypeHex, count]) => ({ entityTypeHex, count }));
  const topDynamicIndexes = Object.entries(dynamicIndexCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 32)
    .map(([key, count]) => {
      const [table, tableIndex] = key.split(':');
      return { table, tableIndex: Number(tableIndex), count };
    });
  return {
    listCount: lists.length,
    terminatedLists,
    totalRecords,
    normalRecords,
    alternateRecords,
    uniqueEntityTypeCount: Object.keys(entityTypeCounts).length,
    uniqueDynamicIndexCount: Object.keys(dynamicIndexCounts).length,
    topEntityTypes,
    topDynamicIndexes,
  };
}

function wb3DecodeRoomEntityListRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const size = Number(region.size || 0);
  const starts = wb3CollectRoomEntityListStarts(map, region, options.roomEntityListStartLimit || 256);
  const lists = starts.map(start => {
    const parsed = wb3ParseRoomEntityList(rom, map, start.offset, {
      regionEnd: offset + size,
      maxRoomEntityRecords: options.maxRoomEntityRecords || 128,
    });
    return Object.assign(parsed, { source: start });
  });
  const aggregate = wb3AggregateRoomEntityLists(lists);
  const warnings = lists.flatMap(list => list.warnings.map(warning => `${list.startOffsetHex}: ${warning}`));
  const reachedCatalog = wb3FindEntityCatalog(map, 'world-room-entity-list-catalog-2026-06-25');
  const orphanCatalog = wb3FindEntityCatalog(map, 'world-room-entity-orphan-list-catalog-2026-06-25');
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${aggregate.listCount} room entity list(s), ${aggregate.totalRecords} record(s), ${aggregate.uniqueEntityTypeCount} entity type byte(s), ${aggregate.uniqueDynamicIndexCount} dynamic tile index(es).`,
    {
      offset,
      size,
      listCount: aggregate.listCount,
      terminatedLists: aggregate.terminatedLists,
      totalRecords: aggregate.totalRecords,
      normalRecords: aggregate.normalRecords,
      alternateRecords: aggregate.alternateRecords,
      uniqueEntityTypeCount: aggregate.uniqueEntityTypeCount,
      uniqueDynamicIndexCount: aggregate.uniqueDynamicIndexCount,
      sourceCatalogIds: [reachedCatalog?.id, orphanCatalog?.id].filter(Boolean),
    },
    warnings.slice(0, 16),
    options.includeTransientPreview ? {
      kind: 'room_entity_lists',
      lists: lists.slice(0, options.roomEntityListPreviewLimit || 120).map(list => Object.assign({}, list, {
        records: list.records.slice(0, options.roomEntityRecordPreviewLimit || 48),
      })),
      listCount: lists.length,
      aggregate,
      semantics: {
        routine: '_LABEL_2948_/_LABEL_2963_',
        sourcePointerRam: '_RAM_CF62_',
        outputRecordRam: '_RAM_D030_',
        recordStrideRam: 7,
        dynamicTileStart: '0x56',
        normalRecordShape: 'entityType plus three field bytes',
        alternateRecordShape: 'entityType only when bit 7 is set',
        terminator: '0xFF',
        dynamicTableRule: '(entityType & 0x7F) - 1; normal table $9D60, alternate table $9E00',
      },
    } : null);
}

function wb3EntityItemAnalysisEntries(region) {
  const analysis = wb3DecoderObject(region?.analysis);
  const keys = [
    'bank1MenuObjectAudit',
    'itemVramIdProducerAudit',
    'entityRandomVariantTableProofAudit',
    'entityBehaviorAudit',
    'entityObjectRecordAudit',
    'bank2StateMachineAudit',
    'bank2ObjectParamAudit',
    'entityAnimationAudit',
    'bank7MenuItemAudit',
    'bank7EntitySequenceAudit',
    'entityItemAssetConfidenceBackfillAudit',
  ];
  return keys
    .filter(key => analysis[key])
    .map(key => {
      const value = wb3DecoderObject(analysis[key]);
      return {
        key,
        kind: value.kind || '',
        role: value.role || wb3DecoderArray(value.roles).join(','),
        confidence: value.confidence || '',
        catalogId: value.catalogId || value.sourceCatalogId || '',
        summary: value.summary || '',
        tool: value.tool || '',
      };
    });
}

function wb3InferEntityItemLayout(region, entries) {
  const type = region?.type || '';
  const name = String(region?.name || '');
  const notes = String(region?.notes || '');
  const text = [type, name, notes, ...entries.flatMap(entry => [entry.key, entry.kind, entry.role, entry.summary])].join(' ').toLowerCase();
  const base = {
    role: entries[0]?.kind || entries[0]?.role || type || 'entity_item_data',
    recordSize: null,
    streamKind: 'byte_stream',
    terminator: null,
    expectedRecordCount: null,
    sourceRoutine: '',
    fieldRoles: [],
    assetPolicy: 'Local-ROM structural preview. It may show transient row offsets and byte/word values in the browser, but only counts and metadata are persisted.',
  };
  if (text.includes('menu_object_init_record')) {
    return Object.assign(base, {
      role: 'menu_object_init_record_stream',
      streamKind: 'variable_menu_object_record_stream',
      sourceRoutine: '_LABEL_423A_/_LABEL_43B8_',
      fieldRoles: ['IX menu/selection object slot initializer fields copied by _LABEL_43B8_'],
    });
  }
  if (text.includes('vertical offset sequence')) {
    return Object.assign(base, {
      role: 'entity_vertical_offset_sequence',
      streamKind: 'terminated_signed_byte_sequence',
      terminator: 0x80,
      sourceRoutine: 'entity vertical offset consumer',
      fieldRoles: ['signed delta byte subtracted from IX+34 and written to IX+6'],
    });
  }
  if (text.includes('motion loop sequence')) {
    return Object.assign(base, {
      role: 'entity_motion_loop_sequence',
      streamKind: 'looping_signed_byte_sequence',
      terminator: 0x80,
      sourceRoutine: '_LABEL_5882_',
      fieldRoles: ['signed/current motion byte written to IX+11', '0x80 sentinel rewinds to stream start'],
    });
  }
  if (text.includes('random variant threshold') || text.includes('entity_random_variant_threshold_mask')) {
    return Object.assign(base, {
      role: 'entity_random_variant_threshold_mask_table',
      recordSize: 2,
      streamKind: 'fixed_records',
      expectedRecordCount: 16,
      sourceRoutine: '_LABEL_5D6A_/_LABEL_D36_',
      fieldRoles: ['threshold byte', 'mask/range byte'],
    });
  }
  if (text.includes('pickup object spawn id') || text.includes('item_vram_id_producer')) {
    return Object.assign(base, {
      role: 'pickup_object_spawn_id_lookup',
      recordSize: 1,
      streamKind: 'fixed_records',
      sourceRoutine: '_RAM_D025_ producer / _LABEL_5C4A_ downstream selector',
      fieldRoles: ['pending object spawn id / item VRAM selector candidate'],
    });
  }
  if (text.includes('entity spawn offset table')) {
    return Object.assign(base, {
      role: 'entity_spawn_signed_word_offset_table',
      recordSize: 2,
      streamKind: 'fixed_records',
      expectedRecordCount: 16,
      sourceRoutine: 'entity spawn helper',
      fieldRoles: ['signed word offset added to player/world X position'],
    });
  }
  if (text.includes('entity_spawn_position_word_table') || text.includes('position pattern table')) {
    return Object.assign(base, {
      role: 'entity_spawn_position_word_table',
      recordSize: 2,
      streamKind: 'fixed_records',
      expectedRecordCount: 20,
      sourceRoutine: '_LABEL_69BE_',
      fieldRoles: ['word position stored into IX+3/IX+4'],
    });
  }
  if (text.includes('entity_object_record_stream')) {
    return Object.assign(base, {
      role: 'entity_object_record_stream',
      streamKind: 'variable_object_record_stream',
      sourceRoutine: '_LABEL_7C65_',
      fieldRoles: ['RST $10 record fields copied into IX object slots', 'IX+15', 'IX+53/+54', 'IX+8/+9', 'IX+10/+11', 'IX+30/+31', 'IX+52/+33', 'IX+55'],
    });
  }
  if (text.includes('state_machine_init_record')) {
    return Object.assign(base, {
      role: 'state_machine_init_record_fragment',
      recordSize: 6,
      streamKind: 'split_fixed_record_stream',
      sourceRoutine: '_LABEL_901B_',
      fieldRoles: ['word0 coordinate/state field', 'word1 coordinate/state field', 'word2 code pointer field'],
    });
  }
  if (text.includes('state_transition_choice_table')) {
    return Object.assign(base, {
      role: 'state_transition_choice_table',
      recordSize: 1,
      streamKind: 'fixed_records',
      expectedRecordCount: 8,
      sourceRoutine: '_LABEL_92B7_',
      fieldRoles: ['randomly selected transition choice byte'],
    });
  }
  if (text.includes('object_spawn_y_position_lookup') || text.includes('object_spawn_x_position_lookup')) {
    return Object.assign(base, {
      role: text.includes('object_spawn_y_position_lookup') ? 'object_spawn_y_position_lookup' : 'object_spawn_x_position_lookup',
      recordSize: 1,
      streamKind: 'fixed_records',
      expectedRecordCount: 8,
      sourceRoutine: text.includes('object_spawn_y_position_lookup') ? '_LABEL_9526_' : '_LABEL_9548_',
      fieldRoles: ['random low-three-bit indexed position byte'],
    });
  }
  if (text.includes('object_spawn_velocity_word_table')) {
    return Object.assign(base, {
      role: 'object_spawn_velocity_word_table',
      recordSize: 2,
      streamKind: 'fixed_records',
      expectedRecordCount: 4,
      sourceRoutine: '_LABEL_9566_',
      fieldRoles: ['word velocity candidate, conditionally mirrored before IX stores'],
    });
  }
  if (text.includes('object_slot_vector_pair_table')) {
    return Object.assign(base, {
      role: 'object_slot_vector_pair_table',
      recordSize: 2,
      streamKind: 'fixed_records',
      expectedRecordCount: 8,
      sourceRoutine: '_LABEL_962F_',
      fieldRoles: ['byte pair copied to IX+9 and IX+11 for cloned object slots'],
    });
  }
  if (text.includes('entity_initial_motion_table')) {
    return Object.assign(base, {
      role: 'entity_initial_motion_table',
      recordSize: 4,
      streamKind: 'fixed_records',
      sourceRoutine: '_LABEL_676D_',
      fieldRoles: ['4-byte-per-record entity initialization/motion tuple indexed from IX+15'],
    });
  }
  if (text.includes('item_equipment_record_group')) {
    return Object.assign(base, {
      role: 'item_equipment_record_group',
      streamKind: 'pointer_selected_item_record_group',
      sourceRoutine: '_LABEL_2819_',
      fieldRoles: ['selected by item/equipment category pointer table', 'fields consumed by item display, ranking and player-form-specific callers'],
    });
  }
  if (text.includes('item_name_display_data')) {
    return Object.assign(base, {
      role: 'item_name_display_data',
      streamKind: 'pointer_selected_item_name_display_stream',
      sourceRoutine: '_LABEL_36A6_',
      fieldRoles: ['item/name display control bytes rendered from local ROM only; text payload is not persisted'],
    });
  }
  if (text.includes('item_menu_nibble_lookup')) {
    return Object.assign(base, {
      role: 'item_menu_nibble_lookup',
      recordSize: 1,
      streamKind: 'nibble_pair_lookup',
      sourceRoutine: 'bank-7 menu state unpacker',
      fieldRoles: ['high nibble menu value', 'low nibble menu value'],
    });
  }
  if (text.includes('bank7_entity_waypoint_triplet_stream')) {
    return Object.assign(base, {
      role: 'bank7_entity_waypoint_triplet_stream',
      recordSize: 6,
      streamKind: 'terminated_fixed_records',
      terminator: 0xff,
      expectedRecordCount: 4,
      sourceRoutine: '_LABEL_1E38A_',
      fieldRoles: ['three little-endian waypoint words per record', 'one-byte terminator'],
    });
  }
  if (text.includes('bank7_entity_timing_value_stream')) {
    return Object.assign(base, {
      role: 'bank7_entity_timing_value_stream',
      recordSize: 2,
      streamKind: 'terminated_fixed_records',
      terminator: 0xff,
      expectedRecordCount: 8,
      sourceRoutine: '_LABEL_1E3A8_',
      fieldRoles: ['timing byte', 'value byte', 'one-byte terminator'],
    });
  }
  return Object.assign(base, {
    role: entries[0]?.kind || 'catalog_backed_entity_item_byte_stream',
    streamKind: 'catalog_backed_byte_stream',
    fieldRoles: ['catalog-backed entity/item data stream; exact field names pending deeper consumer tracing'],
  });
}

function wb3EntityItemByteStats(bytes) {
  const counts = {};
  let zeroCount = 0;
  let ffCount = 0;
  let highBitCount = 0;
  for (const value of bytes || []) {
    counts[value] = (counts[value] || 0) + 1;
    if (value === 0) zeroCount++;
    if (value === 0xff) ffCount++;
    if (value & 0x80) highBitCount++;
  }
  return {
    byteCount: bytes?.length || 0,
    distinctByteCount: Object.keys(counts).length,
    zeroCount,
    ffCount,
    highBitCount,
    firstZeroIndex: bytes ? bytes.indexOf(0) : -1,
    first80Index: bytes ? bytes.indexOf(0x80) : -1,
    firstFfIndex: bytes ? bytes.indexOf(0xff) : -1,
  };
}

function wb3BuildEntityItemRows(rom, region, layout, options) {
  const offset = wb3DecoderParseOffset(region?.offset);
  const size = Number(region?.size || 0);
  const bytes = wb3RegionBytes(rom, region);
  const rows = [];
  const limit = options.entityItemStructuralPreviewLimit || 64;
  if (!bytes || offset == null) return rows;
  const recordSize = Number(layout.recordSize || 0);
  let dataSize = size;
  let terminatorOffset = null;
  if (layout.streamKind === 'terminated_fixed_records' && layout.terminator != null && size > 0) {
    const lastByte = bytes[size - 1];
    if (lastByte === layout.terminator) {
      dataSize = size - 1;
      terminatorOffset = offset + size - 1;
    }
  }
  if (!recordSize) {
    const chunkSize = layout.streamKind === 'nibble_pair_lookup' ? 1 : 8;
    for (let pos = 0; pos < bytes.length && rows.length < limit; pos += chunkSize) {
      const chunk = Array.from(bytes.slice(pos, Math.min(bytes.length, pos + chunkSize)));
      rows.push({
        index: rows.length,
        offset: offset + pos,
        offsetHex: wb3DecoderHex(offset + pos),
        size: chunk.length,
        byteHex: chunk.map(value => wb3DecoderHex(value, 2)),
        signedBytes: chunk.map(value => wb3SignedByte(value)),
      });
    }
    return rows;
  }
  const recordCount = Math.floor(dataSize / recordSize);
  for (let index = 0; index < recordCount && rows.length < limit; index++) {
    const rowOffset = offset + index * recordSize;
    const fields = [];
    for (let i = 0; i < recordSize; i++) {
      const value = rom[rowOffset + i];
      fields.push({
        name: layout.fieldRoles[i] || `byte${i}`,
        value,
        valueHex: wb3DecoderHex(value, 2),
        signed: wb3SignedByte(value),
      });
    }
    const row = {
      index,
      offset: rowOffset,
      offsetHex: wb3DecoderHex(rowOffset),
      recordSize,
      fields,
    };
    if (recordSize === 2) {
      const word = wb3ReadWordLE(rom, rowOffset);
      row.word = word;
      row.wordHex = word == null ? null : wb3DecoderHex(word, 4);
      row.signedWord = word == null ? null : (word & 0x8000 ? word - 0x10000 : word);
    }
    if (recordSize === 6) {
      row.words = [0, 2, 4].map(delta => {
        const word = wb3ReadWordLE(rom, rowOffset + delta);
        return {
          offsetHex: wb3DecoderHex(rowOffset + delta),
          wordHex: word == null ? null : wb3DecoderHex(word, 4),
        };
      });
    }
    rows.push(row);
  }
  if (terminatorOffset != null && rows.length < limit) {
    rows.push({
      index: rows.length,
      offset: terminatorOffset,
      offsetHex: wb3DecoderHex(terminatorOffset),
      recordSize: 1,
      terminator: wb3DecoderHex(layout.terminator, 2),
      fields: [{ name: 'terminator', value: layout.terminator, valueHex: wb3DecoderHex(layout.terminator, 2), signed: wb3SignedByte(layout.terminator) }],
    });
  }
  return rows;
}

function wb3DecodeEntityItemStructuralRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region?.offset);
  const size = Number(region?.size || 0);
  const bytes = wb3RegionBytes(rom, region);
  const entries = wb3EntityItemAnalysisEntries(region);
  const layout = wb3InferEntityItemLayout(region, entries);
  const byteStats = wb3EntityItemByteStats(bytes);
  const recordSize = Number(layout.recordSize || 0);
  let dataSize = size;
  let terminatorMatched = false;
  if (layout.streamKind === 'terminated_fixed_records' && layout.terminator != null && bytes?.length) {
    terminatorMatched = bytes[bytes.length - 1] === layout.terminator;
    if (terminatorMatched) dataSize = Math.max(0, size - 1);
  }
  const recordCount = recordSize ? Math.floor(dataSize / recordSize) : null;
  const trailingByteCount = recordSize ? dataSize % recordSize : 0;
  const rows = wb3BuildEntityItemRows(rom, region, layout, options);
  const warnings = [];
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${layout.role} at ${region.offset}; ${recordCount == null ? `${size} byte stream` : `${recordCount} structural record(s)`}${trailingByteCount ? ` plus ${trailingByteCount} trailing byte(s)` : ''}.`,
    {
      offset,
      size,
      structuralRole: layout.role,
      streamKind: layout.streamKind,
      recordSize: recordSize || null,
      recordCount,
      expectedRecordCount: layout.expectedRecordCount,
      trailingByteCount,
      terminatorExpected: layout.terminator == null ? null : wb3DecoderHex(layout.terminator, 2),
      terminatorMatched,
      analysisEntryCount: entries.length,
      distinctByteCount: byteStats.distinctByteCount,
      zeroCount: byteStats.zeroCount,
      ffCount: byteStats.ffCount,
      highBitCount: byteStats.highBitCount,
      sourceCatalogIds: [...new Set(entries.map(entry => entry.catalogId).filter(Boolean))],
    },
    warnings,
    options.includeTransientPreview ? {
      kind: 'entity_item_structural_records',
      layout,
      analysisEntries: entries,
      byteStats,
      rows,
      rowCount: rows.length,
      recordCount,
      trailingByteCount,
      sourceRegion: wb3FindRegionAtOffset(map, offset),
      assetPolicy: layout.assetPolicy,
    } : null);
}

function wb3DecodeEntityItemRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region?.offset);
  if (!rom || offset == null) return wb3MakeDecodeResult(decoder, asset, region, 'needs_rom', 'Load the local ROM to decode this entity/item region.', {}, [], null);
  const analysis = region?.analysis || {};
  if (region.type === 'entity_data' && (analysis.roomEntityListAudit || analysis.roomEntityOrphanListAudit || region.id === 'r2818' || region.id === 'r2820' || region.id === 'r2821')) {
    return wb3DecodeRoomEntityListRegion(asset, region, rom, map, decoder, options);
  }
  if (region.type === 'entity_behavior_table') {
    const bytes = wb3RegionBytes(rom, region);
    const entryCount = bytes ? Math.floor(bytes.length / 2) : 0;
    const entries = [];
    for (let i = 0; i < entryCount; i++) {
      const entryOffset = offset + i * 2;
      const z80Pointer = wb3ReadWordLE(rom, entryOffset);
      const romOffset = z80Pointer == null ? null : (z80Pointer < 0x8000 ? z80Pointer : wb3Bank4Z80ToRom(z80Pointer));
      entries.push({
        index: i,
        entryOffset,
        entryOffsetHex: wb3DecoderHex(entryOffset),
        z80Pointer,
        z80PointerHex: z80Pointer == null ? null : wb3DecoderHex(z80Pointer, 4),
        romOffset,
        romOffsetHex: romOffset == null ? null : wb3DecoderHex(romOffset),
        region: romOffset == null ? null : wb3FindRegionAtOffset(map, romOffset),
      });
    }
    return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
      `${entryCount} behavior pointer entr${entryCount === 1 ? 'y' : 'ies'}; target semantics come from entity behavior catalogs.`,
      { offset, size: Number(region.size || 0), entryCount },
      [],
      options.includeTransientPreview ? { kind: 'entity_behavior_pointer_table', entries: entries.slice(0, options.entityBehaviorTablePreviewLimit || 96), entryCount } : null);
  }
  return wb3DecodeEntityItemStructuralRegion(asset, region, rom, map, decoder, options);
}

function wb3FindAudioCatalog(map, id) {
  return wb3DecoderArray(map?.audioCatalogs).find(catalog => catalog?.id === id) || null;
}

function wb3CatalogRefMatchesRegion(ref, region) {
  if (!ref || !region) return false;
  if (ref.id && ref.id === region.id) return true;
  const regionStart = wb3DecoderParseOffset(region.offset);
  const regionEnd = regionStart == null ? null : regionStart + Number(region.size || 0);
  const offset = wb3DecoderParseOffset(ref.offset || ref.romOffset || ref.startOffset);
  return regionStart != null && offset != null && offset >= regionStart && offset < regionEnd;
}

function wb3CatalogOffsetInRegion(value, region) {
  const regionStart = wb3DecoderParseOffset(region?.offset);
  const regionEnd = regionStart == null ? null : regionStart + Number(region?.size || 0);
  const offset = wb3DecoderParseOffset(value);
  return regionStart != null && offset != null && offset >= regionStart && offset < regionEnd;
}

function wb3AudioSongMatchesRegion(song, region) {
  if (!song || !region) return false;
  if (wb3CatalogRefMatchesRegion(song.region, region) || wb3CatalogOffsetInRegion(song.romOffset, region)) return true;
  for (const channel of wb3DecoderArray(song.header?.channels)) {
    if (wb3CatalogRefMatchesRegion(channel.streamRegion, region) || wb3CatalogOffsetInRegion(channel.streamRomOffset, region)) return true;
  }
  return false;
}

function wb3AudioStreamMatchesRegion(stream, region) {
  if (!stream || !region) return false;
  return wb3CatalogRefMatchesRegion(stream.region, region)
    || wb3CatalogOffsetInRegion(stream.startOffset, region)
    || wb3CatalogOffsetInRegion(stream.endOffset, region);
}

function wb3AudioGraphMatchesRegion(graph, region) {
  if (!graph || !region) return false;
  if (wb3CatalogRefMatchesRegion(graph.headerRegion, region) || wb3CatalogOffsetInRegion(graph.headerOffset, region)) return true;
  if (wb3DecoderArray(graph.streamRegionIds).includes(region.id)) return true;
  for (const channel of wb3DecoderArray(graph.rootChannels)) {
    if (wb3CatalogRefMatchesRegion(channel.rootStreamRegion, region) || wb3CatalogOffsetInRegion(channel.rootStreamOffset, region)) return true;
  }
  for (const stream of wb3DecoderArray(graph.reachableStreamSamples)) {
    if (wb3CatalogRefMatchesRegion(stream.region, region) || wb3CatalogOffsetInRegion(stream.startOffset, region)) return true;
  }
  return false;
}

function wb3MergeCountMap(target, source) {
  for (const [key, count] of Object.entries(source || {})) target[key] = (target[key] || 0) + Number(count || 0);
  return target;
}

function wb3TopCountMap(map, limit) {
  return Object.entries(map || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit || 32)
    .map(([key, count]) => ({ key, count }));
}

function wb3AudioDriverAnalysisEntries(region) {
  const analysis = wb3DecoderObject(region?.analysis);
  return Object.entries(analysis)
    .filter(([key]) => /^(audioDriverRoutineAudit|audioOutputRegisterAudit|audioPortWriteCoverageAudit|audioRuntimeOutputEventEmitterAudit|audioRuntimeOutputFixtureAudit|audioRuntimeOutputLocalBundleAudit|audioRuntimeOutputLocalObservationBrowserBridgeAudit|audioStreamRoutineAudit|bank3AudioFragmentAudit|audioOutputModeBranchAudit|audioAudit|audioOpcodeDispatchAudit|audioOpcodeHandlerAudit|audioOpcodeStateEffectAudit|audioAssetConfidenceBackfillAudit)$/i.test(key))
    .map(([key, value]) => {
      const detail = wb3DecoderObject(value?.detail);
      const phases = wb3DecoderArray(value?.phases);
      const opcodes = wb3DecoderArray(value?.opcodes).concat(wb3DecoderArray(value?.opcodeEntries));
      const ports = new Set(wb3DecoderArray(value?.ports).concat(wb3DecoderArray(detail?.ports)));
      for (const port of Object.keys(wb3DecoderObject(value?.portCounts))) ports.add(port);
      for (const phase of phases) for (const write of wb3DecoderArray(phase?.writes)) if (write?.port) ports.add(write.port);
      const phaseIds = new Set(wb3DecoderArray(value?.phaseIds).concat(wb3DecoderArray(detail?.phaseFixtureIds)));
      for (const phase of phases) if (phase?.id) phaseIds.add(phase.id);
      return {
        key,
        kind: value?.kind || '',
        role: value?.role || value?.family || '',
        label: value?.label || '',
        catalogId: value?.catalogId || value?.sourceCatalogId || '',
        confidence: value?.confidence || '',
        summary: value?.summary || '',
        writeCount: Number(value?.writeCount || detail?.writeCount || 0),
        ports: [...ports].sort(),
        portCounts: wb3DecoderObject(value?.portCounts),
        phaseIds: [...phaseIds].sort(),
        fixtureIds: wb3DecoderArray(value?.fixtureIds).concat(wb3DecoderArray(detail?.writeFixtureIds)).slice(0, 48),
        asmLines: wb3DecoderArray(value?.asmLines).slice(0, 48),
        routineLabels: wb3DecoderArray(value?.routineLabels).slice(0, 24),
        ramRefs: wb3DecoderArray(value?.ramRefs).concat(wb3DecoderArray(detail?.ramRefs)).slice(0, 48),
        calls: wb3DecoderArray(value?.calls).concat(wb3DecoderArray(detail?.calls)).slice(0, 48),
        opcodes: opcodes.slice(0, 24).map(opcode => ({
          opcode: opcode?.opcode || '',
          name: opcode?.name || opcode?.role || '',
          argBytes: opcode?.argBytes ?? opcode?.derivedArgBytes ?? null,
          parserAction: opcode?.metadataParserAction || opcode?.parserAction || '',
          handlerRomOffset: opcode?.handlerRomOffset || opcode?.romTarget || '',
        })),
        phaseCount: value?.phaseCount ?? phases.length,
        detailKeys: Object.keys(detail).slice(0, 24),
      };
    });
}

function wb3AudioDriverEntryRegion(entry) {
  return entry?.region || entry?.routineRegion || entry?.dispatchRegion || entry?.targetRegion || entry?.headerRegion || entry?.sourceRegion || entry?.routine?.region || null;
}

function wb3AudioDriverEntryOffset(entry) {
  return entry?.offset || entry?.routineOffset || entry?.dispatchRoutineOffset || entry?.romTarget || entry?.tableEntryOffset || entry?.handlerRomOffset || entry?.targetOffset || entry?.routine?.offset || entry?.routine?.romOffset || null;
}

function wb3AudioDriverEntryMatchesRegion(entry, region) {
  if (!entry || !region) return false;
  if (entry.regionId === region.id || entry.targetRegionId === region.id || entry.dispatchRegion?.id === region.id || entry.routineRegion?.id === region.id || entry.targetRegion?.id === region.id) return true;
  if (wb3CatalogRefMatchesRegion(wb3AudioDriverEntryRegion(entry), region)) return true;
  if (wb3CatalogOffsetInRegion(wb3AudioDriverEntryOffset(entry), region)) return true;
  if (wb3CatalogOffsetInRegion(entry.routine?.offset || entry.routine?.romOffset, region)) return true;
  return false;
}

function wb3AudioDriverEntryPorts(entry) {
  const ports = new Set(wb3DecoderArray(entry?.ports));
  if (entry?.port) ports.add(entry.port);
  for (const port of Object.keys(wb3DecoderObject(entry?.portCounts))) ports.add(port);
  for (const write of wb3DecoderArray(entry?.writes)) if (write?.port) ports.add(write.port);
  for (const phase of wb3DecoderArray(entry?.phases)) for (const write of wb3DecoderArray(phase?.writes)) if (write?.port) ports.add(write.port);
  return [...ports].sort();
}

function wb3AudioDriverEntryPhaseIds(entry) {
  const phaseIds = new Set(wb3DecoderArray(entry?.phaseIds));
  for (const key of ['phaseId', 'sourcePhaseId', 'outputPhaseId']) if (entry?.[key]) phaseIds.add(entry[key]);
  for (const ref of wb3DecoderArray(entry?.outputPhaseRefs)) if (ref?.phaseId) phaseIds.add(ref.phaseId);
  for (const phase of wb3DecoderArray(entry?.phases)) if (phase?.id) phaseIds.add(phase.id);
  return [...phaseIds].sort();
}

function wb3TrimAudioDriverCatalogEntry(catalog, arrayName, entry) {
  const region = wb3AudioDriverEntryRegion(entry);
  return {
    sourceCatalogId: catalog?.id || '',
    arrayName,
    id: entry.id || '',
    label: entry.label || entry.routineLabel || entry.targetLabel || entry.dispatchRoutineLabel || '',
    offset: wb3AudioDriverEntryOffset(entry) || '',
    role: entry.role || entry.routineRole || entry.kind || entry.dispatchOutputClass || entry.selectorRole || '',
    chip: entry.chip || entry.dispatchOutputClass || '',
    confidence: entry.confidence || entry.metadataConfidence || '',
    summary: entry.summary || entry.purpose || entry.condition || '',
    port: entry.port || '',
    ports: wb3AudioDriverEntryPorts(entry),
    writeCount: Number(entry.writeCount || entry.outputWriteCount || wb3DecoderArray(entry.writes).length || 0),
    phaseIds: wb3AudioDriverEntryPhaseIds(entry).slice(0, 48),
    fixtureIds: wb3DecoderArray(entry.fixtureIds).concat(wb3DecoderArray(entry.writeFixtureIds)).slice(0, 48),
    asmLines: wb3DecoderArray(entry.asmLines).concat(entry.asmLine ? [entry.asmLine] : []).slice(0, 48),
    routineLabels: wb3DecoderArray(entry.routineLabels).concat(entry.routineLabel ? [entry.routineLabel] : []).filter(Boolean).slice(0, 24),
    ramRefs: wb3DecoderArray(entry.ramRefs).slice(0, 48),
    calls: wb3DecoderArray(entry.calls).slice(0, 48),
    opcode: entry.opcode || '',
    opcodeName: entry.name || entry.role || '',
    argBytes: entry.argBytes ?? entry.derivedArgBytes ?? null,
    parserAction: entry.metadataParserAction || entry.parserAction || '',
    branchId: entry.branchId || '',
    selectorAddress: entry.selectorAddress || '',
    selectorValue: entry.selectorValue ?? '',
    region: region || null,
  };
}

function wb3CollectAudioDriverCatalogEntries(map, region, limit) {
  const entries = [];
  const collections = [
    { name: 'audioCatalogs', arrays: ['routines', 'audioDriverRegions', 'outputPhases', 'phaseFixtures', 'portWriteFixtures', 'eventOutputEdges', 'branchCandidateFixtures', 'globalInputFixtures', 'branches', 'phaseBranchCandidates', 'regionParticipation', 'entries', 'opcodes', 'asmEvidence'] },
    { name: 'bank3AudioFragmentCatalogs', arrays: ['entries', 'structuralFixes'] },
  ];
  for (const collection of collections) {
    for (const catalog of wb3DecoderArray(map?.[collection.name])) {
      for (const arrayName of collection.arrays) {
        for (const item of wb3DecoderArray(catalog?.[arrayName])) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
          if (wb3AudioDriverEntryMatchesRegion(item, region)) entries.push(wb3TrimAudioDriverCatalogEntry(catalog, arrayName, item));
        }
      }
    }
  }
  return entries.slice(0, limit || 180);
}

function wb3FindAudioLikeCatalog(map, id) {
  const collections = ['audioCatalogs', 'bank3AudioFragmentCatalogs', 'audioRequestTaxonomyCatalogs'];
  for (const collection of collections) {
    const catalog = wb3DecoderArray(map?.[collection]).find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function wb3AudioDriverCatalogSummaries(map) {
  const ids = [
    'world-audio-runtime-output-fixture-catalog-2026-06-26',
    'world-audio-runtime-output-event-contract-catalog-2026-06-26',
    'world-audio-output-register-catalog-2026-06-25',
    'world-audio-output-mode-branch-catalog-2026-06-25',
    'world-audio-runtime-output-event-emitter-catalog-2026-06-26',
    'world-audio-runtime-output-local-bundle-catalog-2026-06-26',
    'world-audio-runtime-output-local-observation-browser-bridge-catalog-2026-06-26',
  ];
  return ids.map(id => {
    const catalog = wb3FindAudioLikeCatalog(map, id);
    const summary = wb3DecoderObject(catalog?.summary);
    return {
      sourceCatalogId: id,
      present: Boolean(catalog),
      phaseCount: summary.phaseCount || summary.outputPhaseFixtureCount || summary.knownPhaseFixtureCount || 0,
      writeCount: summary.writeCount || summary.portWriteFixtureCount || summary.knownWriteFixtureCount || summary.emittedWriteEventCount || 0,
      branchCount: summary.branchCount || summary.phaseBranchCandidateCount || summary.branchCandidateFixtureCount || 0,
      regionParticipationCount: summary.regionParticipationCount || 0,
      portWriteCounts: wb3DecoderObject(summary.portWriteCounts),
      readyForRuntimeHarness: Boolean(summary.readyForRuntimeHarness),
      forbiddenPayloadCounts: {
        persistedRomByteCount: summary.persistedRomByteCount || 0,
        persistedStreamByteCount: summary.persistedStreamByteCount || 0,
        persistedRegisterValueCount: summary.persistedRegisterValueCount || 0,
        persistedRegisterTraceCount: summary.persistedRegisterTraceCount || 0,
        persistedPortValueCount: summary.persistedPortValueCount || 0,
        persistedSampleCount: summary.persistedSampleCount || 0,
        persistedAudioByteCount: summary.persistedAudioByteCount || 0,
        persistedHashCount: summary.persistedHashCount || 0,
      },
    };
  });
}

function wb3AudioRuntimeEventFieldKeys(catalog) {
  const contract = wb3DecoderObject(catalog?.eventContract);
  return {
    required: wb3DecoderArray(contract.requiredEventKeys),
    optional: wb3DecoderArray(contract.optionalEventKeys),
    forbidden: wb3DecoderArray(contract.forbiddenPayloadKeys),
    eventKinds: wb3DecoderArray(contract.eventKinds),
  };
}

function wb3AudioRuntimeCountForbiddenPayloadKeys(value, forbiddenSet) {
  if (!value || typeof value !== 'object') return 0;
  let count = 0;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenSet.has(key)) count++;
    if (child && typeof child === 'object') count += wb3AudioRuntimeCountForbiddenPayloadKeys(child, forbiddenSet);
  }
  return count;
}

function wb3AudioRuntimePhaseInputKeys(phase) {
  return [...new Set(wb3DecoderArray(phase?.fieldInputRefs)
    .map(ref => ref?.key || ref?.label || '')
    .filter(Boolean))]
    .sort();
}

function wb3AudioRuntimePortPhaseKind(port) {
  if (port === 'Port_PSG') return 'psg_data';
  if (port === 'Port_FMAddress') return 'fm_address';
  if (port === 'Port_FMData') return 'fm_data';
  return port ? 'other_port' : 'unresolved_port';
}

function wb3AudioRuntimeFrameKey(event) {
  return Number.isInteger(event?.frame) ? `f${event.frame}` : (event?.frameStatus || 'linear');
}

function wb3AudioRuntimeIncrement(map, key, amount) {
  const k = key || 'unclassified';
  map[k] = (map[k] || 0) + Number(amount || 1);
}

function wb3AudioRuntimeMakeFixtureEvent(fixtureCatalog, phase, write, frame, kind) {
  const inputFieldKeys = wb3AudioRuntimePhaseInputKeys(phase);
  const branchId = wb3DecoderArray(phase?.branchIds)[0] || '';
  const region = write?.region || phase?.routineRegion || null;
  return {
    kind,
    phaseFixtureId: phase?.id || '',
    writeFixtureId: write?.id || '',
    frame,
    frameStatus: 'fixture_static_coverage',
    pc: write?.routineOffset || phase?.routineOffset || '',
    chip: write?.chip || phase?.chip || '',
    port: write?.port || '',
    activeChannel: 'fixture_static_coverage',
    inputFieldKeys,
    branchId,
    selectedByOutputModeFilter: true,
    fixtureCatalogId: fixtureCatalog?.id || '',
    sourcePhaseId: write?.sourcePhaseId || phase?.sourcePhaseId || '',
    sourceRoutineLabel: write?.routineLabel || phase?.routineLabel || '',
    sourceRoutineOffset: write?.routineOffset || phase?.routineOffset || '',
    sourceRegionId: region?.id || '',
    sourceEventKind: 'fixture_static_coverage',
    sourceEventRole: write ? 'audio_port_write_fixture_static_coverage' : 'audio_output_phase_fixture_static_coverage',
    sourceParserAction: '',
    sourceTraceOperationKinds: [],
    sourceTraceTargetLabels: [write?.routineLabel || phase?.routineLabel || ''].filter(Boolean),
    sourceRamFieldKeys: inputFieldKeys,
    sourceUnresolvedRamFieldKeys: [],
    valuePolicy: 'runtime_port_value_not_persisted',
    assetPolicy: 'metadata_only_runtime_event_ids_no_register_values_or_samples',
    writeIndex: Number.isInteger(write?.writeIndex) ? write.writeIndex : null,
    asmLine: Number.isInteger(write?.asmLine) ? write.asmLine : null,
    purpose: write?.purpose || phase?.summary || '',
  };
}

function wb3AudioRuntimeSummarizeSink(events, validationIssues, rejectedEventCount) {
  const summary = {
    eventCount: events.length,
    phaseEventCount: 0,
    writeEventCount: 0,
    selectedPhaseEventCount: 0,
    selectedWriteEventCount: 0,
    missingPhaseFixtureCount: 0,
    missingWriteFixtureCount: 0,
    psgEventCount: 0,
    fmEventCount: 0,
    mixedEventCount: 0,
    frameLinkedEventCount: 0,
    frameUnlinkedEventCount: 0,
    rejectedEventCount,
    validationIssueCount: validationIssues.length,
    persistedRegisterValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedSampleCount: 0,
    persistedAudioByteCount: 0,
    persistedRomByteCount: 0,
    assetPolicy: 'metadata_only_runtime_event_ids_no_register_values_or_samples',
  };
  for (const event of events) {
    if (event.kind === 'audio_output_phase_fixture') {
      summary.phaseEventCount++;
      if (event.selectedByOutputModeFilter) summary.selectedPhaseEventCount++;
    } else if (event.kind === 'audio_port_write_fixture') {
      summary.writeEventCount++;
      if (event.selectedByOutputModeFilter) summary.selectedWriteEventCount++;
    }
    if (event.chip === 'psg') summary.psgEventCount++;
    else if (event.chip === 'fm') summary.fmEventCount++;
    else summary.mixedEventCount++;
    if (event.frameStatus === 'frame_step_linked') summary.frameLinkedEventCount++;
    else summary.frameUnlinkedEventCount++;
  }
  return summary;
}

function wb3AudioRuntimeBuildFrameTimeline(events) {
  const frameGroups = new Map();
  for (const event of events) {
    const key = wb3AudioRuntimeFrameKey(event);
    if (!frameGroups.has(key)) {
      frameGroups.set(key, {
        frame: Number.isInteger(event.frame) ? event.frame : null,
        frameKey: key,
        frameStatus: event.frameStatus || '',
        eventCount: 0,
        phaseEventCount: 0,
        writeEventCount: 0,
        selectedEventCount: 0,
        selectedPhaseEventCount: 0,
        selectedWriteEventCount: 0,
        psgEventCount: 0,
        fmEventCount: 0,
        mixedEventCount: 0,
        portCounts: {},
        branchCounts: {},
        activeChannelCounts: {},
        inputFieldKeyCounts: {},
        phaseFixtureIds: new Set(),
        writeFixtureIds: new Set(),
      });
    }
    const frame = frameGroups.get(key);
    frame.eventCount++;
    if (event.selectedByOutputModeFilter) frame.selectedEventCount++;
    if (event.kind === 'audio_output_phase_fixture') {
      frame.phaseEventCount++;
      if (event.selectedByOutputModeFilter) frame.selectedPhaseEventCount++;
      if (event.phaseFixtureId) frame.phaseFixtureIds.add(event.phaseFixtureId);
    } else if (event.kind === 'audio_port_write_fixture') {
      frame.writeEventCount++;
      if (event.selectedByOutputModeFilter) frame.selectedWriteEventCount++;
      if (event.writeFixtureId) frame.writeFixtureIds.add(event.writeFixtureId);
    }
    if (event.chip === 'psg') frame.psgEventCount++;
    else if (event.chip === 'fm') frame.fmEventCount++;
    else frame.mixedEventCount++;
    if (event.port) wb3AudioRuntimeIncrement(frame.portCounts, event.port);
    if (event.branchId) wb3AudioRuntimeIncrement(frame.branchCounts, event.branchId);
    if (event.activeChannel) wb3AudioRuntimeIncrement(frame.activeChannelCounts, event.activeChannel);
    for (const key of wb3DecoderArray(event.inputFieldKeys)) wb3AudioRuntimeIncrement(frame.inputFieldKeyCounts, key);
  }
  const frames = [...frameGroups.values()].sort((a, b) => {
    const af = Number.isInteger(a.frame) ? a.frame : Number.MAX_SAFE_INTEGER;
    const bf = Number.isInteger(b.frame) ? b.frame : Number.MAX_SAFE_INTEGER;
    return af - bf || String(a.frameKey).localeCompare(String(b.frameKey));
  }).map((frame, index) => {
    const psgWriteEventCount = Number(frame.portCounts.Port_PSG || 0);
    const fmWriteEventCount = Number(frame.portCounts.Port_FMAddress || 0) + Number(frame.portCounts.Port_FMData || 0);
    return Object.assign({}, frame, {
      index,
      psgWriteEventCount,
      fmWriteEventCount,
      mixedWriteEventCount: Math.max(0, Number(frame.writeEventCount || 0) - psgWriteEventCount - fmWriteEventCount),
      phaseFixtureIds: [...frame.phaseFixtureIds].sort(),
      writeFixtureIds: [...frame.writeFixtureIds].sort(),
      assetPolicy: 'metadata_only_output_frame_timeline_no_values_or_samples',
    });
  });
  const phaseIds = new Set();
  const writeIds = new Set();
  const ports = new Set();
  const branches = new Set();
  const inputKeys = new Set();
  const channels = new Set();
  const summary = {
    frameCount: frames.length,
    frameLinkedCount: frames.filter(frame => frame.frameStatus === 'frame_step_linked').length,
    frameUnlinkedCount: frames.filter(frame => frame.frameStatus !== 'frame_step_linked').length,
    eventCount: 0,
    phaseEventCount: 0,
    writeEventCount: 0,
    selectedEventCount: 0,
    selectedPhaseEventCount: 0,
    selectedWriteEventCount: 0,
    psgEventCount: 0,
    fmEventCount: 0,
    mixedEventCount: 0,
    psgWriteEventCount: 0,
    fmWriteEventCount: 0,
    mixedWriteEventCount: 0,
    uniquePhaseFixtureCount: 0,
    uniqueWriteFixtureCount: 0,
    portKindCount: 0,
    branchKindCount: 0,
    inputFieldKeyCount: 0,
    activeChannelCount: 0,
    persistedRegisterValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedSampleCount: 0,
    persistedAudioByteCount: 0,
    persistedRomByteCount: 0,
    assetPolicy: 'metadata_only_output_frame_timeline_no_values_or_samples',
  };
  for (const frame of frames) {
    for (const key of ['eventCount', 'phaseEventCount', 'writeEventCount', 'selectedEventCount', 'selectedPhaseEventCount', 'selectedWriteEventCount', 'psgEventCount', 'fmEventCount', 'mixedEventCount', 'psgWriteEventCount', 'fmWriteEventCount', 'mixedWriteEventCount']) summary[key] += Number(frame[key] || 0);
    for (const id of frame.phaseFixtureIds) phaseIds.add(id);
    for (const id of frame.writeFixtureIds) writeIds.add(id);
    for (const key of Object.keys(frame.portCounts || {})) ports.add(key);
    for (const key of Object.keys(frame.branchCounts || {})) branches.add(key);
    for (const key of Object.keys(frame.inputFieldKeyCounts || {})) inputKeys.add(key);
    for (const key of Object.keys(frame.activeChannelCounts || {})) channels.add(key);
  }
  summary.uniquePhaseFixtureCount = phaseIds.size;
  summary.uniqueWriteFixtureCount = writeIds.size;
  summary.portKindCount = ports.size;
  summary.branchKindCount = branches.size;
  summary.inputFieldKeyCount = inputKeys.size;
  summary.activeChannelCount = channels.size;
  return { frames, summary };
}

function wb3AudioRuntimeBuildRegisterIntent(frameTimeline) {
  const frames = wb3DecoderArray(frameTimeline?.frames).map(frame => {
    let intentKind = 'no_writes';
    if (frame.writeEventCount) {
      intentKind = frame.psgWriteEventCount && !frame.fmWriteEventCount && !frame.mixedWriteEventCount
        ? 'psg_only'
        : frame.fmWriteEventCount && !frame.psgWriteEventCount && !frame.mixedWriteEventCount
          ? 'fm_only'
          : 'mixed_psg_fm';
    }
    return Object.assign({}, frame, { intentKind, assetPolicy: 'metadata_only_register_intent_no_values_or_samples' });
  });
  const summary = Object.assign({
    frameCount: frames.length,
    psgOnlyFrameCount: frames.filter(frame => frame.intentKind === 'psg_only').length,
    fmOnlyFrameCount: frames.filter(frame => frame.intentKind === 'fm_only').length,
    mixedFrameCount: frames.filter(frame => frame.intentKind === 'mixed_psg_fm').length,
    noWriteFrameCount: frames.filter(frame => frame.intentKind === 'no_writes').length,
    intentKindCounts: {},
    assetPolicy: 'metadata_only_register_intent_no_values_or_samples',
  }, frameTimeline?.summary || {});
  summary.frameCount = frames.length;
  summary.psgOnlyFrameCount = frames.filter(frame => frame.intentKind === 'psg_only').length;
  summary.fmOnlyFrameCount = frames.filter(frame => frame.intentKind === 'fm_only').length;
  summary.mixedFrameCount = frames.filter(frame => frame.intentKind === 'mixed_psg_fm').length;
  summary.noWriteFrameCount = frames.filter(frame => frame.intentKind === 'no_writes').length;
  summary.intentKindCounts = {};
  for (const frame of frames) wb3AudioRuntimeIncrement(summary.intentKindCounts, frame.intentKind);
  return { frames, summary };
}

function wb3AudioRuntimeBuildChannelPortIntent(events) {
  const groups = new Map();
  for (const event of events) {
    if (event.kind !== 'audio_port_write_fixture') continue;
    const phaseKind = wb3AudioRuntimePortPhaseKind(event.port);
    const key = [wb3AudioRuntimeFrameKey(event), event.activeChannel || 'unclassified_channel', event.chip || 'mixed', event.port || 'unresolved_port', phaseKind, event.branchId || 'unclassified_branch'].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        groupKey: key,
        frame: Number.isInteger(event.frame) ? event.frame : null,
        frameKey: wb3AudioRuntimeFrameKey(event),
        frameStatus: event.frameStatus || '',
        activeChannel: event.activeChannel || '',
        chip: event.chip || '',
        port: event.port || '',
        phaseKind,
        branchId: event.branchId || '',
        writeEventCount: 0,
        selectedWriteEventCount: 0,
        psgWriteEventCount: 0,
        fmWriteEventCount: 0,
        fmAddressWriteEventCount: 0,
        fmDataWriteEventCount: 0,
        mixedWriteEventCount: 0,
        inputFieldKeyCounts: {},
        sourceEventKindCounts: {},
        sourceEventRoleCounts: {},
        sourceTraceOperationKindCounts: {},
        sourceTraceTargetCounts: {},
        sourceRamFieldKeyCounts: {},
        sourceUnresolvedRamFieldKeyCounts: {},
        phaseFixtureIds: new Set(),
        writeFixtureIds: new Set(),
      });
    }
    const group = groups.get(key);
    group.writeEventCount++;
    if (event.selectedByOutputModeFilter) group.selectedWriteEventCount++;
    if (event.chip === 'psg') group.psgWriteEventCount++;
    else if (event.chip === 'fm') group.fmWriteEventCount++;
    else group.mixedWriteEventCount++;
    if (phaseKind === 'fm_address') group.fmAddressWriteEventCount++;
    if (phaseKind === 'fm_data') group.fmDataWriteEventCount++;
    for (const item of wb3DecoderArray(event.inputFieldKeys)) wb3AudioRuntimeIncrement(group.inputFieldKeyCounts, item);
    if (event.sourceEventKind) wb3AudioRuntimeIncrement(group.sourceEventKindCounts, event.sourceEventKind);
    if (event.sourceEventRole) wb3AudioRuntimeIncrement(group.sourceEventRoleCounts, event.sourceEventRole);
    for (const item of wb3DecoderArray(event.sourceTraceOperationKinds)) wb3AudioRuntimeIncrement(group.sourceTraceOperationKindCounts, item);
    for (const item of wb3DecoderArray(event.sourceTraceTargetLabels)) wb3AudioRuntimeIncrement(group.sourceTraceTargetCounts, item);
    for (const item of wb3DecoderArray(event.sourceRamFieldKeys)) wb3AudioRuntimeIncrement(group.sourceRamFieldKeyCounts, item);
    for (const item of wb3DecoderArray(event.sourceUnresolvedRamFieldKeys)) wb3AudioRuntimeIncrement(group.sourceUnresolvedRamFieldKeyCounts, item);
    if (event.phaseFixtureId) group.phaseFixtureIds.add(event.phaseFixtureId);
    if (event.writeFixtureId) group.writeFixtureIds.add(event.writeFixtureId);
  }
  const sortedGroups = [...groups.values()].sort((a, b) => {
    const af = Number.isInteger(a.frame) ? a.frame : Number.MAX_SAFE_INTEGER;
    const bf = Number.isInteger(b.frame) ? b.frame : Number.MAX_SAFE_INTEGER;
    return af - bf || a.frameKey.localeCompare(b.frameKey) || a.activeChannel.localeCompare(b.activeChannel) || a.port.localeCompare(b.port) || a.branchId.localeCompare(b.branchId);
  }).map((group, index) => Object.assign({}, group, {
    index,
    phaseFixtureIds: [...group.phaseFixtureIds].sort(),
    writeFixtureIds: [...group.writeFixtureIds].sort(),
    assetPolicy: 'metadata_only_channel_port_intent_no_values_or_samples',
  }));
  const summary = {
    groupCount: sortedGroups.length,
    frameCount: new Set(sortedGroups.map(group => group.frameKey)).size,
    frameLinkedGroupCount: sortedGroups.filter(group => group.frameStatus === 'frame_step_linked').length,
    frameUnlinkedGroupCount: sortedGroups.filter(group => group.frameStatus !== 'frame_step_linked').length,
    writeEventCount: 0,
    selectedWriteEventCount: 0,
    psgWriteEventCount: 0,
    fmWriteEventCount: 0,
    fmAddressWriteEventCount: 0,
    fmDataWriteEventCount: 0,
    mixedWriteEventCount: 0,
    uniquePhaseFixtureCount: 0,
    uniqueWriteFixtureCount: 0,
    portKindCount: 0,
    branchKindCount: 0,
    inputFieldKeyCount: 0,
    activeChannelCount: 0,
    phaseKindCount: 0,
    sourceEventKindCount: 0,
    sourceEventRoleCount: 0,
    sourceTraceOperationKindCount: 0,
    sourceRamFieldKeyCount: 0,
    sourceUnresolvedRamFieldKeyCount: 0,
    sourceTraceLinkedWriteCount: 0,
    sourceRamLinkedWriteCount: 0,
    sourceUnresolvedRamLinkedWriteCount: 0,
    portCounts: {},
    branchCounts: {},
    activeChannelCounts: {},
    inputFieldKeyCounts: {},
    phaseKindCounts: {},
    sourceEventKindCounts: {},
    sourceEventRoleCounts: {},
    sourceTraceOperationKindCounts: {},
    sourceRamFieldKeyCounts: {},
    sourceUnresolvedRamFieldKeyCounts: {},
    persistedRegisterValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedSampleCount: 0,
    persistedAudioByteCount: 0,
    persistedRomByteCount: 0,
    assetPolicy: 'metadata_only_channel_port_intent_no_values_or_samples',
  };
  const phaseIds = new Set();
  const writeIds = new Set();
  const ports = new Set();
  const branches = new Set();
  const inputs = new Set();
  const channels = new Set();
  const phaseKinds = new Set();
  const sourceEventKinds = new Set();
  const sourceEventRoles = new Set();
  const sourceTraceKinds = new Set();
  const sourceRamKeys = new Set();
  const sourceUnresolvedRamKeys = new Set();
  for (const group of sortedGroups) {
    for (const key of ['writeEventCount', 'selectedWriteEventCount', 'psgWriteEventCount', 'fmWriteEventCount', 'fmAddressWriteEventCount', 'fmDataWriteEventCount', 'mixedWriteEventCount']) summary[key] += Number(group[key] || 0);
    for (const id of group.phaseFixtureIds) phaseIds.add(id);
    for (const id of group.writeFixtureIds) writeIds.add(id);
    if (group.port) { ports.add(group.port); wb3AudioRuntimeIncrement(summary.portCounts, group.port, group.writeEventCount); }
    if (group.branchId) { branches.add(group.branchId); wb3AudioRuntimeIncrement(summary.branchCounts, group.branchId, group.writeEventCount); }
    if (group.activeChannel) { channels.add(group.activeChannel); wb3AudioRuntimeIncrement(summary.activeChannelCounts, group.activeChannel, group.writeEventCount); }
    if (group.phaseKind) { phaseKinds.add(group.phaseKind); wb3AudioRuntimeIncrement(summary.phaseKindCounts, group.phaseKind, group.writeEventCount); }
    for (const key of Object.keys(group.inputFieldKeyCounts)) { inputs.add(key); wb3AudioRuntimeIncrement(summary.inputFieldKeyCounts, key, group.inputFieldKeyCounts[key]); }
    for (const key of Object.keys(group.sourceEventKindCounts)) { sourceEventKinds.add(key); wb3AudioRuntimeIncrement(summary.sourceEventKindCounts, key, group.sourceEventKindCounts[key]); }
    for (const key of Object.keys(group.sourceEventRoleCounts)) { sourceEventRoles.add(key); wb3AudioRuntimeIncrement(summary.sourceEventRoleCounts, key, group.sourceEventRoleCounts[key]); }
    for (const key of Object.keys(group.sourceTraceOperationKindCounts)) { sourceTraceKinds.add(key); wb3AudioRuntimeIncrement(summary.sourceTraceOperationKindCounts, key, group.sourceTraceOperationKindCounts[key]); }
    for (const key of Object.keys(group.sourceRamFieldKeyCounts)) { sourceRamKeys.add(key); wb3AudioRuntimeIncrement(summary.sourceRamFieldKeyCounts, key, group.sourceRamFieldKeyCounts[key]); }
    for (const key of Object.keys(group.sourceUnresolvedRamFieldKeyCounts)) { sourceUnresolvedRamKeys.add(key); wb3AudioRuntimeIncrement(summary.sourceUnresolvedRamFieldKeyCounts, key, group.sourceUnresolvedRamFieldKeyCounts[key]); }
    if (Object.keys(group.sourceTraceOperationKindCounts).length || Object.keys(group.sourceTraceTargetCounts).length) summary.sourceTraceLinkedWriteCount += group.writeEventCount;
    if (Object.keys(group.sourceRamFieldKeyCounts).length) summary.sourceRamLinkedWriteCount += group.writeEventCount;
    if (Object.keys(group.sourceUnresolvedRamFieldKeyCounts).length) summary.sourceUnresolvedRamLinkedWriteCount += group.writeEventCount;
  }
  summary.uniquePhaseFixtureCount = phaseIds.size;
  summary.uniqueWriteFixtureCount = writeIds.size;
  summary.portKindCount = ports.size;
  summary.branchKindCount = branches.size;
  summary.inputFieldKeyCount = inputs.size;
  summary.activeChannelCount = channels.size;
  summary.phaseKindCount = phaseKinds.size;
  summary.sourceEventKindCount = sourceEventKinds.size;
  summary.sourceEventRoleCount = sourceEventRoles.size;
  summary.sourceTraceOperationKindCount = sourceTraceKinds.size;
  summary.sourceRamFieldKeyCount = sourceRamKeys.size;
  summary.sourceUnresolvedRamFieldKeyCount = sourceUnresolvedRamKeys.size;
  return { groups: sortedGroups, summary };
}

function wb3BuildAudioRuntimeOutputFixtureEventModel(map, options) {
  const fixtureCatalog = wb3FindAudioLikeCatalog(map, 'world-audio-runtime-output-fixture-catalog-2026-06-26');
  const eventContractCatalog = wb3FindAudioLikeCatalog(map, 'world-audio-runtime-output-event-contract-catalog-2026-06-26');
  const contract = wb3AudioRuntimeEventFieldKeys(eventContractCatalog);
  const forbiddenSet = new Set(contract.forbidden);
  const allowedKinds = new Set(contract.eventKinds);
  const phaseFixtures = wb3DecoderArray(fixtureCatalog?.phaseFixtures);
  const writeById = new Map(wb3DecoderArray(fixtureCatalog?.portWriteFixtures).map(write => [write?.id, write]));
  const events = [];
  const validationIssues = [];
  let rejectedEventCount = 0;
  if (!fixtureCatalog) validationIssues.push('world-audio-runtime-output-fixture-catalog-2026-06-26 missing');
  if (!eventContractCatalog) validationIssues.push('world-audio-runtime-output-event-contract-catalog-2026-06-26 missing');
  phaseFixtures.forEach((phase, phaseIndex) => {
    const phaseEvent = wb3AudioRuntimeMakeFixtureEvent(fixtureCatalog, phase, null, phaseIndex, 'audio_output_phase_fixture');
    const phaseForbidden = wb3AudioRuntimeCountForbiddenPayloadKeys(phaseEvent, forbiddenSet);
    const phaseMissing = contract.required.filter(key => !Object.prototype.hasOwnProperty.call(phaseEvent, key));
    if (phaseForbidden || phaseMissing.length || (allowedKinds.size && !allowedKinds.has(phaseEvent.kind))) {
      rejectedEventCount++;
      if (phaseForbidden) validationIssues.push(`${phaseEvent.phaseFixtureId || phase?.id || 'phase'} has forbidden payload key count ${phaseForbidden}`);
      if (phaseMissing.length) validationIssues.push(`${phaseEvent.phaseFixtureId || phase?.id || 'phase'} missing ${phaseMissing.join(',')}`);
      if (allowedKinds.size && !allowedKinds.has(phaseEvent.kind)) validationIssues.push(`${phaseEvent.phaseFixtureId || phase?.id || 'phase'} invalid event kind ${phaseEvent.kind}`);
    } else {
      events.push(phaseEvent);
    }
    for (const writeId of wb3DecoderArray(phase?.writeFixtureIds)) {
      const write = writeById.get(writeId);
      if (!write) {
        validationIssues.push(`${phase?.id || 'phase'} references missing write fixture ${writeId}`);
        rejectedEventCount++;
        continue;
      }
      const writeEvent = wb3AudioRuntimeMakeFixtureEvent(fixtureCatalog, phase, write, phaseIndex, 'audio_port_write_fixture');
      const writeForbidden = wb3AudioRuntimeCountForbiddenPayloadKeys(writeEvent, forbiddenSet);
      const writeMissing = contract.required.filter(key => !Object.prototype.hasOwnProperty.call(writeEvent, key));
      if (writeForbidden || writeMissing.length || (allowedKinds.size && !allowedKinds.has(writeEvent.kind))) {
        rejectedEventCount++;
        if (writeForbidden) validationIssues.push(`${writeEvent.writeFixtureId || writeId} has forbidden payload key count ${writeForbidden}`);
        if (writeMissing.length) validationIssues.push(`${writeEvent.writeFixtureId || writeId} missing ${writeMissing.join(',')}`);
        if (allowedKinds.size && !allowedKinds.has(writeEvent.kind)) validationIssues.push(`${writeEvent.writeFixtureId || writeId} invalid event kind ${writeEvent.kind}`);
      } else {
        events.push(writeEvent);
      }
    }
  });
  const sinkSummary = wb3AudioRuntimeSummarizeSink(events, validationIssues, rejectedEventCount);
  const frameTimeline = wb3AudioRuntimeBuildFrameTimeline(events);
  const registerIntent = wb3AudioRuntimeBuildRegisterIntent(frameTimeline);
  const channelPortIntent = wb3AudioRuntimeBuildChannelPortIntent(events);
  const persistedPayloadTotal = [
    sinkSummary,
    frameTimeline.summary,
    registerIntent.summary,
    channelPortIntent.summary,
  ].reduce((sum, summary) => sum
    + Number(summary.persistedRegisterValueCount || 0)
    + Number(summary.persistedRegisterTraceCount || 0)
    + Number(summary.persistedSampleCount || 0)
    + Number(summary.persistedAudioByteCount || 0)
    + Number(summary.persistedRomByteCount || 0), 0);
  return {
    kind: 'audio_runtime_output_fixture_event_model',
    sourceCatalogIds: [fixtureCatalog?.id, eventContractCatalog?.id].filter(Boolean),
    eventContract: {
      catalogId: eventContractCatalog?.id || '',
      requiredEventKeyCount: contract.required.length,
      optionalEventKeyCount: contract.optional.length,
      forbiddenPayloadKeyCount: contract.forbidden.length,
      derivedModelCount: wb3DecoderArray(eventContractCatalog?.derivedModels).length,
      readyForRuntimeHarness: Boolean(eventContractCatalog?.summary?.readyForRuntimeHarness),
    },
    sink: {
      id: 'asset_decoder_audio_runtime_output_event_sink',
      summary: sinkSummary,
      sampleEvents: events.slice(0, options.audioRuntimeOutputEventPreviewLimit || 80),
    },
    frameTimeline: {
      id: 'asset_decoder_audio_runtime_output_frame_timeline',
      summary: frameTimeline.summary,
      frames: frameTimeline.frames.slice(0, options.audioRuntimeOutputFramePreviewLimit || 80),
    },
    registerIntent: {
      id: 'asset_decoder_audio_runtime_output_register_intent',
      summary: registerIntent.summary,
      frames: registerIntent.frames.slice(0, options.audioRuntimeOutputRegisterIntentPreviewLimit || 80),
    },
    channelPortIntent: {
      id: 'asset_decoder_audio_runtime_output_channel_port_intent',
      summary: channelPortIntent.summary,
      groups: channelPortIntent.groups.slice(0, options.audioRuntimeOutputChannelPortPreviewLimit || 80),
    },
    validation: {
      validationIssueCount: validationIssues.length,
      rejectedEventCount,
      persistedPayloadTotal,
      readyForRuntimeHarness: Boolean(fixtureCatalog?.summary?.readyForRuntimeHarness)
        && Boolean(eventContractCatalog?.summary?.readyForRuntimeHarness)
        && validationIssues.length === 0
        && rejectedEventCount === 0
        && persistedPayloadTotal === 0,
      issues: validationIssues.slice(0, options.audioRuntimeOutputValidationIssuePreviewLimit || 80),
    },
    assetPolicy: 'Metadata only: event ids, fixture ids, frame indexes, symbolic ports, chip names, branch ids, field keys, counts and validation summaries. No ROM bytes, stream bytes, PSG/FM register values, port values, register traces, samples or audio bytes are persisted.',
  };
}

function wb3FindRequestTaxonomyCatalog(map) {
  return wb3DecoderArray(map?.audioRequestTaxonomyCatalogs)
    .find(catalog => catalog?.id === 'world-audio-request-taxonomy-catalog-2026-06-25') || null;
}

function wb3BuildAudioDriverRequestBridge(rom, map, options) {
  const taxonomy = wb3FindRequestTaxonomyCatalog(map);
  const audioCatalog = wb3FindAudioCatalog(map, 'world-audio-catalog-2026-06-24');
  const graphCatalog = wb3FindAudioCatalog(map, 'world-audio-stream-graph-catalog-2026-06-25');
  const fixtureCatalog = wb3FindAudioLikeCatalog(map, 'world-audio-runtime-output-fixture-catalog-2026-06-26');
  const outputCatalog = wb3FindAudioLikeCatalog(map, 'world-audio-output-register-catalog-2026-06-25');
  const requests = wb3DecoderArray(taxonomy?.requests);
  const graphs = wb3DecoderArray(graphCatalog?.graphs);
  const songs = wb3DecoderArray(audioCatalog?.songs);
  const graphByRequest = new Map(graphs.map(graph => [Number(graph.requestId), graph]));
  const songByRequest = new Map(songs.map(song => [Number(song.index), song]));
  const selected = [];
  const seenClassifications = new Set();
  const requestLimit = options.audioDriverRequestBridgeLimit || 24;
  for (const request of requests) {
    const kind = request.classification?.kind || 'unclassified_audio_request';
    const important = !seenClassifications.has(kind)
      || Number(request.roomRecipeUsage?.descriptorCount || 0) > 0
      || Number(request.immediateCallSiteCount || 0) > 0;
    if (!important && selected.length >= requestLimit) continue;
    selected.push(request);
    seenClassifications.add(kind);
    if (selected.length >= requestLimit) break;
  }
  const selectedIds = new Set(selected.map(request => Number(request.requestId)));
  const selectedSongs = songs.filter(song => selectedIds.has(Number(song.index)));
  const selectedGraphs = graphs.filter(graph => selectedIds.has(Number(graph.requestId)));
  const stateSeed = rom && selectedSongs.length
    ? wb3BuildMusicRequestChannelStateSeed(rom, selectedSongs, selectedGraphs, map, Object.assign({}, options, {
      musicStateSeedRequestLimit: options.audioDriverRequestBridgeSeedRequestLimit || selectedSongs.length,
      musicStateSeedChannelLimit: options.audioDriverRequestBridgeSeedChannelLimit || 8,
      musicStateSeedTimelineEventLimit: options.audioDriverRequestBridgeTimelineEventLimit || 64,
      musicStateSeedTimelineByteLimit: options.audioDriverRequestBridgeTimelineByteLimit || 256,
    }))
    : null;
  const seedRequestById = new Map(wb3DecoderArray(stateSeed?.requests).map(request => [Number(request.requestId), request]));
  const requestRows = selected.map(request => {
    const requestId = Number(request.requestId);
    const graph = graphByRequest.get(requestId) || null;
    const seed = seedRequestById.get(requestId) || null;
    return {
      requestId,
      requestIdHex: request.requestIdHex || `0x${requestId.toString(16).toUpperCase().padStart(2, '0')}`,
      headerOffset: request.headerOffset || '',
      headerRegion: request.headerRegion || null,
      classification: request.classification || null,
      channelCount: request.channelCount || graph?.channelCount || 0,
      uniqueStreamCount: request.uniqueStreamCount || 0,
      immediateCallSiteCount: request.immediateCallSiteCount || 0,
      candidateCallSiteCount: request.candidateCallSiteCount || 0,
      roomRecipeDescriptorCount: request.roomRecipeUsage?.descriptorCount || graph?.roomRecipeUsage?.descriptorCount || 0,
      reachableStreamCount: graph?.reachableStreamCount || 0,
      branchEdgeCount: graph?.branchEdgeCount || 0,
      maxBranchDepth: graph?.maxBranchDepth || 0,
      stateSeedChannelCount: seed?.previewedChannelCount || 0,
      stateSeedTimelineEventCount: wb3DecoderArray(stateSeed?.channels)
        .filter(channel => Number(channel.requestId) === requestId)
        .reduce((sum, channel) => sum + Number(channel.timelineStats?.eventCount || 0), 0),
      evidence: [
        request.id || '',
        graph?.id || '',
        seed ? 'local_request_channel_state_seed' : '',
      ].filter(Boolean),
    };
  });

  const summary = taxonomy?.summary || {};
  const fixtureSummary = fixtureCatalog?.summary || {};
  const outputSummary = outputCatalog?.summary || {};
  return {
    kind: 'audio_driver_request_bridge',
    requestRows,
    aggregate: {
      requestCount: summary.requestCount || requests.length,
      bridgeRequestPreviewCount: requestRows.length,
      classificationCounts: wb3DecoderObject(summary.classificationCounts),
      confidenceCounts: wb3DecoderObject(summary.confidenceCounts),
      channelCountHistogram: wb3DecoderObject(summary.channelCountHistogram),
      priorityShapeCounts: wb3DecoderObject(summary.priorityShapeCounts),
      immediateCallSiteCount: summary.immediateCallSites || 0,
      candidateCallSiteCount: summary.candidateCallSites || 0,
      dynamicCallSiteCount: summary.dynamicCallSites || 0,
      roomRecipeDescriptorCount: summary.roomRecipeDescriptorCount || 0,
      outputPhaseCount: outputSummary.phaseCount || fixtureSummary.outputPhaseFixtureCount || 0,
      outputWriteCount: outputSummary.writeCount || fixtureSummary.portWriteFixtureCount || 0,
      branchCandidateFixtureCount: fixtureSummary.branchCandidateFixtureCount || 0,
      globalInputFixtureCount: fixtureSummary.globalInputFixtureCount || 0,
      portWriteCounts: wb3DecoderObject(outputSummary.portWriteCounts || fixtureSummary.portWriteCounts),
      fieldInputKeys: wb3DecoderArray(fixtureSummary.fieldInputKeys).slice(0, 32),
      readyForRuntimeHarness: Boolean(fixtureSummary.readyForRuntimeHarness),
      localSeed: stateSeed?.aggregate || null,
    },
    sourceCatalogIds: [taxonomy?.id, audioCatalog?.id, graphCatalog?.id, fixtureCatalog?.id, outputCatalog?.id].filter(Boolean),
    semantics: {
      requestTable: '_DATA_D139_',
      requestLoaders: '_LABEL_C04D_ immediate request loader and _LABEL_C09F_ queued request loader',
      outputFixtures: 'Output fixture catalogs describe symbolic PSG/FM port writes and phase ids, not persisted register values.',
      localSeedBoundary: stateSeed?.semantics?.stateSeedBoundary || 'Load the local ROM to compute request/channel state seed stats.',
    },
  };
}

function wb3DecodeAudioDriverRuntimeRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region?.offset);
  if (!region || !wb3IsAudioDriverRuntimeRegion(region)) {
    return wb3MakeDecodeResult(decoder, asset, region, 'metadata_only',
      'No audio driver/runtime evidence is attached to this region yet.',
      { offset, implementationPercent: decoder.implementationPercent },
      ['Select a region with audio driver, output-port fixture, stream loader, opcode handler, or bank-3 audio fragment evidence.'],
      null);
  }
  const analysisEntries = wb3AudioDriverAnalysisEntries(region);
  const catalogEntries = wb3CollectAudioDriverCatalogEntries(map, region, options.audioDriverCatalogEntryPreviewLimit || 180);
  const catalogSummaries = wb3AudioDriverCatalogSummaries(map);
  const requestBridge = wb3BuildAudioDriverRequestBridge(rom, map, options);
  const runtimeOutputModel = wb3BuildAudioRuntimeOutputFixtureEventModel(map, options);
  const ports = new Set();
  const phaseIds = new Set();
  const fixtureIds = new Set();
  const ramRefs = new Set();
  const calls = new Set();
  const routineLabels = new Set();
  const sourceCatalogIds = new Set();
  const chipCounts = {};
  const roleCounts = {};
  let writeEvidenceCount = 0;
  let asmLineCount = 0;
  let opcodeEvidenceCount = 0;
  for (const entry of analysisEntries.concat(catalogEntries)) {
    if (entry.catalogId) sourceCatalogIds.add(entry.catalogId);
    if (entry.sourceCatalogId) sourceCatalogIds.add(entry.sourceCatalogId);
    for (const port of entry.ports || []) ports.add(port);
    if (entry.port) ports.add(entry.port);
    for (const id of entry.phaseIds || []) phaseIds.add(id);
    for (const id of entry.fixtureIds || []) fixtureIds.add(id);
    for (const ref of entry.ramRefs || []) ramRefs.add(ref);
    for (const call of entry.calls || []) calls.add(call);
    for (const label of entry.routineLabels || []) routineLabels.add(label);
    if (entry.label && /^_LABEL_/i.test(entry.label)) routineLabels.add(entry.label);
    const chip = entry.chip || '';
    if (chip) chipCounts[chip] = (chipCounts[chip] || 0) + 1;
    const role = entry.kind || entry.role || entry.arrayName || entry.key || 'audio_driver_evidence';
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    writeEvidenceCount += Number(entry.writeCount || 0);
    asmLineCount += wb3DecoderArray(entry.asmLines).length;
    opcodeEvidenceCount += wb3DecoderArray(entry.opcodes).length + (entry.opcode ? 1 : 0);
  }
  const summary = `${analysisEntries.length} analysis evidence item(s), ${catalogEntries.length} catalog match(es), ${ports.size} port kind(s), ${phaseIds.size} output phase(s), ${fixtureIds.size} fixture id(s).`;
  return wb3MakeDecodeResult(decoder, asset, region, 'partial',
    `${summary} Request bridge: ${requestBridge.aggregate.bridgeRequestPreviewCount} request preview(s), ${requestBridge.aggregate.outputPhaseCount} output phase(s), ${requestBridge.aggregate.outputWriteCount} output write fixture(s).`,
    {
      offset,
      size: Number(region.size || 0),
      analysisEvidenceCount: analysisEntries.length,
      catalogEntryCount: catalogEntries.length,
      portCount: ports.size,
      phaseCount: phaseIds.size,
      fixtureCount: fixtureIds.size,
      ramRefCount: ramRefs.size,
      callRefCount: calls.size,
      routineLabelCount: routineLabels.size,
      writeEvidenceCount,
      asmLineCount,
      opcodeEvidenceCount,
      sourceCatalogIds: [...sourceCatalogIds].sort(),
      ports: [...ports].sort(),
      chipCounts,
      roleCounts,
      requestBridgePreviewCount: requestBridge.aggregate.bridgeRequestPreviewCount,
      requestBridgeRequestCount: requestBridge.aggregate.requestCount,
      requestBridgeImmediateCallSiteCount: requestBridge.aggregate.immediateCallSiteCount,
      requestBridgeDynamicCallSiteCount: requestBridge.aggregate.dynamicCallSiteCount,
      requestBridgeOutputPhaseCount: requestBridge.aggregate.outputPhaseCount,
	  requestBridgeOutputWriteCount: requestBridge.aggregate.outputWriteCount,
	  requestBridgeLocalSeedChannelCount: requestBridge.aggregate.localSeed?.channelSeedCount || 0,
	  requestBridgeLocalSeedTimelineEventCount: requestBridge.aggregate.localSeed?.timelineEventCount || 0,
      runtimeOutputEventCount: runtimeOutputModel.sink.summary.eventCount,
      runtimeOutputPhaseEventCount: runtimeOutputModel.sink.summary.phaseEventCount,
      runtimeOutputWriteEventCount: runtimeOutputModel.sink.summary.writeEventCount,
      runtimeOutputFrameCount: runtimeOutputModel.frameTimeline.summary.frameCount,
      runtimeOutputRegisterIntentFrameCount: runtimeOutputModel.registerIntent.summary.frameCount,
      runtimeOutputChannelPortGroupCount: runtimeOutputModel.channelPortIntent.summary.groupCount,
      runtimeOutputPsgWriteEventCount: runtimeOutputModel.channelPortIntent.summary.psgWriteEventCount,
      runtimeOutputFmWriteEventCount: runtimeOutputModel.channelPortIntent.summary.fmWriteEventCount,
      runtimeOutputValidationIssueCount: runtimeOutputModel.validation.validationIssueCount,
      runtimeOutputReadyForHarness: runtimeOutputModel.validation.readyForRuntimeHarness,
    },
    [],
    options.includeTransientPreview ? {
      kind: 'audio_driver_runtime_metadata',
      analysisEntries: analysisEntries.slice(0, options.audioDriverAnalysisPreviewLimit || 90),
      catalogEntries,
	      catalogSummaries,
	      requestBridge,
	      runtimeOutputModel,
	      aggregate: {
	        ports: [...ports].sort(),
        phaseIds: [...phaseIds].sort().slice(0, 80),
        fixtureIds: [...fixtureIds].sort().slice(0, 80),
        ramRefs: [...ramRefs].sort().slice(0, 80),
        calls: [...calls].sort().slice(0, 80),
        routineLabels: [...routineLabels].sort().slice(0, 80),
        sourceCatalogIds: [...sourceCatalogIds].sort(),
        chipCounts,
        roleCounts,
        writeEvidenceCount,
        asmLineCount,
	        opcodeEvidenceCount,
	      },
	      semantics: {
	        outputPorts: 'Port_PSG, Port_FMAddress and Port_FMData are symbolic SMS sound-chip output ports from ASM OUT instructions.',
	        outputSelector: '_RAM_C232_ selects PSG/FM output dispatch branches; branch catalogs currently model selector metadata only.',
	        requestLoader: '_LABEL_C04D_/_LABEL_C09F_ index _DATA_D139_ and initialize stream channel structs.',
	        outputFixtures: 'audio output fixtures are metadata-only phase/write descriptors keyed by routine label, ASM line, symbolic port and fixture id.',
	        runtimeOutputModel: 'The decoder emits a metadata-only event sink, frame timeline, register-intent model and channel/port-intent model from fixture ids; it does not emit PSG/FM values or samples.',
	        assetPolicy: 'This preview shows labels, offsets, roles, ports, counts, RAM refs, call refs and fixture ids only; it does not persist ROM bytes, audio stream bytes, PSG/FM register values, port values, samples, hashes or screenshots.',
	      },
	    } : null);
}

function wb3MusicOpcodeMap(map) {
  const opcodeCatalog = wb3FindAudioCatalog(map, 'world-audio-opcode-state-effect-catalog-2026-06-25');
  const out = new Map();
  for (const opcode of wb3DecoderArray(opcodeCatalog?.opcodes)) {
    const byte = Number(opcode.opcodeByte);
    if (Number.isFinite(byte)) out.set(byte & 0xff, opcode);
  }
  return out;
}

function wb3MusicOpcodeArgBytes(byte, opcodeMap) {
  const opcode = opcodeMap?.get(byte & 0xff);
  if (opcode && Number.isFinite(Number(opcode.argBytes))) return Number(opcode.argBytes);
  return ({ 0xf0: 1, 0xf1: 2, 0xf2: 2, 0xf3: 1, 0xf4: 1, 0xf5: 1, 0xf6: 2, 0xf8: 1, 0xfa: 2 })[byte & 0xff] || 0;
}

function wb3MusicZ80ToBank3Rom(z80) {
  const value = Number(z80);
  return value >= 0x8000 && value < 0xc000 ? value + 0x4000 : null;
}

function wb3MusicPointerArgTarget(rom, offset) {
  if (!rom || offset == null || offset + 2 >= rom.length) return null;
  const z80 = rom[offset + 1] | (rom[offset + 2] << 8);
  const romOffset = wb3MusicZ80ToBank3Rom(z80);
  return romOffset == null ? null : {
    z80Pointer: wb3DecoderHex(z80, 4),
    romOffset,
    romOffsetHex: wb3DecoderHex(romOffset),
  };
}

function wb3MusicDurationFrames(rom, selector) {
  const index = Number(selector) & 0x3f;
  const offset = 0x0fe44 + index;
  if (!rom || offset < 0 || offset >= rom.length) return null;
  const value = Number(rom[offset] || 0);
  return value > 0 ? value : null;
}

function wb3MusicNoteInfo(byte, transpose) {
  const value = Number(byte) & 0x7f;
  const low = value & 0x0f;
  const masked = value & 0x3f;
  const octave = (masked >> 4) & 0x03;
  const baseIndex = octave * 12 + low + Number(transpose || 0);
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  if (low === 0x0c) return { kind: 'rest', noteIndex: null, noteLabel: 'REST', octave, tieOrSustainFlag: Boolean(value & 0x40) };
  if (low > 0x0b) return { kind: 'special_note', noteIndex: baseIndex, noteLabel: `special-${low.toString(16).toUpperCase()}`, octave, tieOrSustainFlag: Boolean(value & 0x40) };
  return {
    kind: 'note',
    noteIndex: baseIndex,
    noteLabel: `${names[((baseIndex % 12) + 12) % 12]}${Math.floor(baseIndex / 12) + 3}`,
    octave,
    tieOrSustainFlag: Boolean(value & 0x40),
  };
}

function wb3ParseMusicStreamTimeline(rom, streamOffset, map, options) {
  const opcodeMap = wb3MusicOpcodeMap(map);
  const events = [];
  const warnings = [];
  let pos = wb3DecoderParseOffset(streamOffset);
  const startOffset = pos;
  let frame = 0;
  let currentDurationFrames = options.defaultMusicDurationFrames || 6;
  let noteEventCount = 0;
  let restEventCount = 0;
  let specialNoteEventCount = 0;
  let durationCommandCount = 0;
  let opcodeEventCount = 0;
  const maxEvents = options.musicTimelineEventLimit || 192;
  const maxBytes = options.musicTimelineByteLimit || 768;
  if (!rom || pos == null || pos < 0 || pos >= rom.length) {
    return {
      startOffset,
      startOffsetHex: pos == null ? '' : wb3DecoderHex(pos),
      events,
      stats: { eventCount: 0, noteEventCount: 0, restEventCount: 0, specialNoteEventCount: 0, durationCommandCount: 0, opcodeEventCount: 0, frameCount: 0, consumedBytes: 0 },
      endReason: 'unresolved_stream_offset',
      warnings: ['Stream offset could not be resolved inside the local ROM.'],
    };
  }
  for (let guard = 0; guard < maxEvents && pos < rom.length && pos - startOffset < maxBytes; guard++) {
    const eventOffset = pos;
    const b = rom[pos];
    if (b >= 0xf0) {
      const opcode = opcodeMap.get(b);
      const argBytes = wb3MusicOpcodeArgBytes(b, opcodeMap);
      const parserAction = opcode?.metadataParserAction || '';
      const target = (b === 0xf6 || b === 0xfa) ? wb3MusicPointerArgTarget(rom, pos) : null;
      const operandBytes = [];
      for (let i = 0; i < argBytes && pos + 1 + i < rom.length; i++) operandBytes.push(rom[pos + 1 + i]);
      events.push({
        kind: 'opcode',
        offset: eventOffset,
        offsetHex: wb3DecoderHex(eventOffset),
        frameStart: frame,
        opcode: `$${b.toString(16).toUpperCase().padStart(2, '0')}`,
        opcodeByte: b,
        name: opcode?.name || opcode?.metadataRole || '',
        argBytes,
        operandBytes,
        operandHex: operandBytes.map(value => `$${Number(value || 0).toString(16).toUpperCase().padStart(2, '0')}`),
        operandTruncated: operandBytes.length < argBytes,
        parserAction,
        targetRomOffsetHex: target?.romOffsetHex || '',
      });
      opcodeEventCount++;
      pos += 1 + argBytes;
      if (b === 0xff || parserAction === 'stop_segment' || parserAction === 'branch_and_stop_segment') {
        return {
          startOffset,
          startOffsetHex: wb3DecoderHex(startOffset),
          events,
          stats: { eventCount: events.length, noteEventCount, restEventCount, specialNoteEventCount, durationCommandCount, opcodeEventCount, frameCount: frame, consumedBytes: pos - startOffset },
          endReason: b === 0xff ? 'ff-end' : parserAction,
          warnings,
        };
      }
      continue;
    }
    if (b & 0x80) {
      const selector = b & 0x3f;
      const durationFrames = wb3MusicDurationFrames(rom, selector);
      if (durationFrames != null) currentDurationFrames = durationFrames;
      events.push({
        kind: 'duration_command',
        offset: eventOffset,
        offsetHex: wb3DecoderHex(eventOffset),
        frameStart: frame,
        selector,
        durationFrames: currentDurationFrames,
        source: 'Z80 $BE44 duration lookup used by _LABEL_C191_',
      });
      durationCommandCount++;
      pos++;
      continue;
    }
    const note = wb3MusicNoteInfo(b, options.transpose || 0);
    const durationFrames = Math.max(1, currentDurationFrames || 1);
    events.push({
      kind: note.kind,
      offset: eventOffset,
      offsetHex: wb3DecoderHex(eventOffset),
      frameStart: frame,
      frameEnd: frame + durationFrames,
      durationFrames,
      noteIndex: note.noteIndex,
      noteLabel: note.noteLabel,
      octave: note.octave,
      tieOrSustainFlag: note.tieOrSustainFlag,
    });
    if (note.kind === 'note') noteEventCount++;
    else if (note.kind === 'rest') restEventCount++;
    else specialNoteEventCount++;
    frame += durationFrames;
    pos++;
  }
  if (pos - startOffset >= maxBytes) warnings.push('Timeline stopped at byte scan limit.');
  if (events.length >= maxEvents) warnings.push('Timeline stopped at event preview limit.');
  return {
    startOffset,
    startOffsetHex: wb3DecoderHex(startOffset),
    events,
    stats: { eventCount: events.length, noteEventCount, restEventCount, specialNoteEventCount, durationCommandCount, opcodeEventCount, frameCount: frame, consumedBytes: pos - startOffset },
    endReason: warnings.length ? 'preview_limit' : 'rom_end',
    warnings,
  };
}

function wb3MusicLaneHardwareCandidate(channel) {
  const channelId = Number(channel?.channelId);
  if (!Number.isFinite(channelId)) return 'unresolved_audio_lane';
  if (channelId >= 0 && channelId <= 3) return 'primary_4_lane_output_candidate';
  if (channelId >= 4 && channelId <= 7) return 'extended_4_lane_output_candidate';
  return 'unknown_audio_lane';
}

function wb3MusicOpcodeEffectDescriptor(event) {
  const opcodeByte = Number(event?.opcodeByte ?? parseInt(String(event?.opcode || '').replace('$', ''), 16));
  const operands = wb3DecoderArray(event?.operandBytes).map(value => Number(value || 0) & 0xff);
  const operand0 = operands.length ? operands[0] : null;
  const operand1 = operands.length > 1 ? operands[1] : null;
  const descriptor = {
    opcode: event?.opcode || (Number.isFinite(opcodeByte) ? `$${opcodeByte.toString(16).toUpperCase().padStart(2, '0')}` : ''),
    opcodeByte: Number.isFinite(opcodeByte) ? opcodeByte : null,
    effectKind: 'unclassified_opcode',
    mutationKind: 'none',
    parameterMutation: false,
    potentialPitchOrEnvelopeMutation: false,
    instrumentOrEffectMutation: false,
    repeatControl: false,
    pointerControl: false,
    sharedFlowControl: false,
    operandCount: operands.length,
    operandHex: wb3DecoderArray(event?.operandHex),
    targetRomOffsetHex: event?.targetRomOffsetHex || '',
    summary: '',
  };
  switch (opcodeByte) {
    case 0xf0:
      return Object.assign(descriptor, {
        effectKind: 'instrument_or_effect_select',
        mutationKind: 'store',
        instrumentOrEffectMutation: true,
        instrumentOrEffectId: operand0,
        summary: 'Selects an instrument/effect id candidate from the next stream byte.',
      });
    case 0xf1:
      return Object.assign(descriptor, {
        effectKind: 'stream_parameter_pair_store',
        mutationKind: 'store_pair',
        parameterMutation: true,
        potentialPitchOrEnvelopeMutation: true,
        parameterA: operand0,
        parameterB: operand1,
        summary: 'Stores a two-byte stream parameter pair; exact target fields remain symbolic.',
      });
    case 0xf2:
      return Object.assign(descriptor, {
        effectKind: 'stream_parameter_pair_add',
        mutationKind: 'add_pair',
        parameterMutation: true,
        potentialPitchOrEnvelopeMutation: true,
        parameterA: operand0,
        parameterB: operand1,
        summary: 'Adds a two-byte stream parameter pair; exact target fields remain symbolic.',
      });
    case 0xf3:
      return Object.assign(descriptor, {
        effectKind: 'single_stream_parameter_store',
        mutationKind: 'store_single',
        parameterMutation: true,
        potentialPitchOrEnvelopeMutation: true,
        parameterA: operand0,
        summary: 'Stores a single stream parameter; exact target field remains symbolic.',
      });
    case 0xf4:
      return Object.assign(descriptor, {
        effectKind: 'single_stream_parameter_add_clamped',
        mutationKind: 'add_single_clamped',
        parameterMutation: true,
        potentialPitchOrEnvelopeMutation: true,
        parameterA: operand0,
        clampMax: 0x0f,
        summary: 'Adds one stream parameter with a 0x0F clamp candidate.',
      });
    case 0xf5:
      return Object.assign(descriptor, {
        effectKind: 'indexed_support_table_load',
        mutationKind: 'indexed_load',
        parameterMutation: true,
        potentialPitchOrEnvelopeMutation: true,
        supportTableSelector: operand0,
        summary: 'Loads a stream parameter through an indexed support table.',
      });
    case 0xf6:
      return Object.assign(descriptor, {
        effectKind: 'call_stream_pointer',
        mutationKind: 'call_pointer',
        pointerControl: true,
        summary: 'Calls/enqueues an immediate stream pointer target.',
      });
    case 0xf8:
      return Object.assign(descriptor, {
        effectKind: 'repeat_counter_setup',
        mutationKind: 'store_repeat_counter',
        repeatControl: true,
        repeatCount: operand0,
        summary: 'Stores a repeat counter candidate.',
      });
    case 0xf9:
      return Object.assign(descriptor, {
        effectKind: 'repeat_or_loop_end',
        mutationKind: 'repeat_or_stop',
        repeatControl: true,
        sharedFlowControl: true,
        summary: 'Handles repeat/loop end control.',
      });
    case 0xfa:
      return Object.assign(descriptor, {
        effectKind: 'jump_stream_pointer',
        mutationKind: 'jump_pointer',
        pointerControl: true,
        summary: 'Jumps to an immediate stream pointer target and stops the current segment.',
      });
    case 0xf7:
    case 0xfb:
    case 0xfc:
    case 0xfd:
    case 0xfe:
      return Object.assign(descriptor, {
        effectKind: 'shared_repeat_or_return_handler',
        mutationKind: 'shared_flow_control',
        sharedFlowControl: true,
        summary: 'Uses the shared repeat/return handler.',
      });
    case 0xff:
      return Object.assign(descriptor, {
        effectKind: 'stream_end_or_shared_repeat_handler',
        mutationKind: 'stop_or_shared_flow_control',
        sharedFlowControl: true,
        summary: 'Stops the stream segment or enters shared repeat/end handling.',
      });
    default:
      return descriptor;
  }
}

function wb3BuildMusicOpcodeParameterStateModel(timelines, options) {
  const lanes = [];
  const summary = {
    laneCount: 0,
    opcodeEventCount: 0,
    operandBearingOpcodeEventCount: 0,
    operandByteCount: 0,
    operandTruncatedEventCount: 0,
    parameterMutationEventCount: 0,
    potentialPitchOrEnvelopeMutationEventCount: 0,
    instrumentOrEffectSelectEventCount: 0,
    repeatControlEventCount: 0,
    pointerControlEventCount: 0,
    sharedFlowControlEventCount: 0,
    exactParameterTargetFieldCount: 0,
    exactFramePsgFmStateReady: false,
    opcodeCounts: {},
    effectKindCounts: {},
    mutationKindCounts: {},
    parserActionCounts: {},
    persistedRomByteCount: 0,
    persistedStreamByteCount: 0,
    persistedOperandByteCount: 0,
    persistedRegisterValueCount: 0,
    persistedPortValueCount: 0,
    persistedSampleCount: 0,
    assetPolicy: 'metadata_only_music_opcode_parameter_state_no_operand_bytes_or_register_values',
  };
  for (const timeline of wb3DecoderArray(timelines)) {
    const state = {
      instrumentOrEffectIdSeen: false,
      parameterPairSeen: false,
      singleParameterSeen: false,
      supportTableLoadSeen: false,
      repeatControlSeen: false,
      pointerControlSeen: false,
      potentialPitchOrEnvelopeMutationCount: 0,
    };
    const changes = [];
    let laneOpcodeEventCount = 0;
    for (const event of wb3DecoderArray(timeline.events)) {
      if (event.kind !== 'opcode') continue;
      laneOpcodeEventCount++;
      const effect = wb3MusicOpcodeEffectDescriptor(event);
      summary.opcodeEventCount++;
      wb3AudioRuntimeIncrement(summary.opcodeCounts, effect.opcode || 'unclassified_opcode');
      wb3AudioRuntimeIncrement(summary.effectKindCounts, effect.effectKind || 'unclassified_opcode');
      wb3AudioRuntimeIncrement(summary.mutationKindCounts, effect.mutationKind || 'none');
      wb3AudioRuntimeIncrement(summary.parserActionCounts, event.parserAction || 'continue');
      const operandCount = Number(effect.operandCount || 0);
      if (operandCount > 0) summary.operandBearingOpcodeEventCount++;
      summary.operandByteCount += operandCount;
      if (event.operandTruncated) summary.operandTruncatedEventCount++;
      if (effect.parameterMutation) summary.parameterMutationEventCount++;
      if (effect.potentialPitchOrEnvelopeMutation) {
        summary.potentialPitchOrEnvelopeMutationEventCount++;
        state.potentialPitchOrEnvelopeMutationCount++;
      }
      if (effect.instrumentOrEffectMutation) {
        summary.instrumentOrEffectSelectEventCount++;
        state.instrumentOrEffectIdSeen = true;
      }
      if (effect.repeatControl) {
        summary.repeatControlEventCount++;
        state.repeatControlSeen = true;
      }
      if (effect.pointerControl) {
        summary.pointerControlEventCount++;
        state.pointerControlSeen = true;
      }
      if (effect.sharedFlowControl) summary.sharedFlowControlEventCount++;
      if (effect.effectKind === 'stream_parameter_pair_store' || effect.effectKind === 'stream_parameter_pair_add') state.parameterPairSeen = true;
      if (effect.effectKind === 'single_stream_parameter_store' || effect.effectKind === 'single_stream_parameter_add_clamped') state.singleParameterSeen = true;
      if (effect.effectKind === 'indexed_support_table_load') state.supportTableLoadSeen = true;
      if (changes.length < (options.musicOpcodeParameterChangePreviewLimit || 20)) {
        changes.push({
          frameStart: event.frameStart ?? null,
          offsetHex: event.offsetHex || '',
          opcode: effect.opcode,
          effectKind: effect.effectKind,
          mutationKind: effect.mutationKind,
          operandHex: effect.operandHex,
          targetRomOffsetHex: effect.targetRomOffsetHex || '',
          exactTargetFieldResolved: false,
          summary: effect.summary,
        });
      }
    }
    if (changes.length || options.includeEmptyMusicOpcodeParameterLanes) {
      lanes.push({
        requestId: timeline.requestId ?? null,
        requestIdHex: timeline.requestIdHex || '',
        channelIndex: timeline.channelIndex ?? null,
        channelIdHex: timeline.channelIdHex || '',
        streamOffset: timeline.streamOffset || '',
        opcodeEventCount: laneOpcodeEventCount,
        potentialPitchOrEnvelopeMutationCount: state.potentialPitchOrEnvelopeMutationCount,
        instrumentOrEffectIdSeen: state.instrumentOrEffectIdSeen,
        parameterPairSeen: state.parameterPairSeen,
        singleParameterSeen: state.singleParameterSeen,
        supportTableLoadSeen: state.supportTableLoadSeen,
        repeatControlSeen: state.repeatControlSeen,
        pointerControlSeen: state.pointerControlSeen,
        exactTargetFieldsResolved: false,
        changes,
      });
    }
  }
  summary.laneCount = lanes.length;
  return {
    kind: 'music_opcode_parameter_state_preview',
    summary,
    lanes: lanes.slice(0, options.musicOpcodeParameterLanePreviewLimit || 64),
    semantics: {
      opcodeDispatch: '_LABEL_C37B_ masks the $F0-$FF stream byte low nibble and dispatches through the table at ROM 0x0C391.',
      parameterBoundary: 'This model captures immediate operands and symbolic state effects for stream opcodes. It does not yet bind every opcode to exact channel struct fields.',
      pitchBoundary: '$F1-$F5 parameter mutations are marked as potential pitch/envelope inputs because the pitch/output routines consume channel shadow parameters, but exact field ownership still needs runtime trace confirmation.',
    },
    assetPolicy: 'Transient preview can show local operand bytes from the user ROM. Persisted metadata must store only counts, opcode names, labels, offsets, booleans and evidence; no operand bytes, stream bytes, register values, port values or samples.',
  };
}

function wb3BuildMusicChannelLaneState(song, channel, timeline, options) {
  const noteLabels = new Set();
  const noteIndexCounts = {};
  const pitchClassCounts = {};
  const octaveStepCounts = {};
  const durationSelectors = {};
  const opcodeCounts = {};
  const branchTargetOffsets = new Set();
  const segments = [];
  let noteSegmentCount = 0;
  let restSegmentCount = 0;
  let specialSegmentCount = 0;
  let activeFrameCount = 0;
  let restFrameCount = 0;
  let minNoteIndex = null;
  let maxNoteIndex = null;
  for (const event of wb3DecoderArray(timeline?.events)) {
    if (event.kind === 'duration_command') {
      wb3AudioRuntimeIncrement(durationSelectors, String(event.selector ?? 'unknown'));
      continue;
    }
    if (event.kind === 'opcode') {
      wb3AudioRuntimeIncrement(opcodeCounts, event.opcode || 'unclassified_opcode');
      if (event.targetRomOffsetHex) branchTargetOffsets.add(event.targetRomOffsetHex);
      continue;
    }
    if (event.kind !== 'note' && event.kind !== 'rest' && event.kind !== 'special_note') continue;
    const durationFrames = Number(event.durationFrames || Math.max(0, Number(event.frameEnd || 0) - Number(event.frameStart || 0)) || 0);
    if (event.kind === 'rest') {
      restSegmentCount++;
      restFrameCount += durationFrames;
    } else {
      if (event.kind === 'note') noteSegmentCount++;
      else specialSegmentCount++;
      activeFrameCount += durationFrames;
    }
    if (event.noteLabel) noteLabels.add(event.noteLabel);
    const hasNoteIndex = event.noteIndex !== null && event.noteIndex !== undefined && Number.isFinite(Number(event.noteIndex));
    if (hasNoteIndex) {
      const noteIndex = Number(event.noteIndex);
      const pitchClass = ((noteIndex % 12) + 12) % 12;
      const octaveStep = Math.floor(noteIndex / 12);
      minNoteIndex = minNoteIndex == null ? noteIndex : Math.min(minNoteIndex, noteIndex);
      maxNoteIndex = maxNoteIndex == null ? noteIndex : Math.max(maxNoteIndex, noteIndex);
      wb3AudioRuntimeIncrement(noteIndexCounts, String(noteIndex));
      wb3AudioRuntimeIncrement(pitchClassCounts, String(pitchClass));
      wb3AudioRuntimeIncrement(octaveStepCounts, String(octaveStep));
    }
    if (segments.length < (options.musicLaneSegmentPreviewLimit || 24)) {
      segments.push({
        kind: event.kind || '',
        offsetHex: event.offsetHex || '',
        frameStart: event.frameStart ?? null,
        frameEnd: event.frameEnd ?? null,
        durationFrames,
        noteIndex: hasNoteIndex ? Number(event.noteIndex) : null,
        noteLabel: event.noteLabel || '',
        octave: event.octave ?? null,
        tieOrSustainFlag: event.tieOrSustainFlag === true,
      });
    }
  }
  const stats = wb3DecoderObject(timeline?.stats);
  return {
    requestId: song?.index ?? null,
    requestIdHex: `$${Number(song?.index || 0).toString(16).toUpperCase().padStart(2, '0')}`,
    channelIndex: channel?.index ?? null,
    channelIdHex: channel?.channelIdHex || '',
    priorityHex: channel?.priorityHex || '',
    hardwareLaneCandidate: wb3MusicLaneHardwareCandidate(channel),
    hardwareLaneConfidence: 'low',
    streamOffset: timeline?.startOffsetHex || channel?.streamRomOffset || '',
    streamRegion: channel?.streamRegion || null,
    endReason: timeline?.endReason || '',
    eventCount: Number(stats.eventCount || 0),
    noteEventCount: Number(stats.noteEventCount || 0),
    restEventCount: Number(stats.restEventCount || 0),
    specialNoteEventCount: Number(stats.specialNoteEventCount || 0),
    durationCommandCount: Number(stats.durationCommandCount || 0),
    opcodeEventCount: Number(stats.opcodeEventCount || 0),
    frameCount: Number(stats.frameCount || 0),
    consumedBytes: Number(stats.consumedBytes || 0),
    noteSegmentCount,
    restSegmentCount,
    specialSegmentCount,
    activeFrameCount,
    restFrameCount,
    playableFrameCount: activeFrameCount + restFrameCount,
    minNoteIndex,
    maxNoteIndex,
    noteRange: minNoteIndex == null || maxNoteIndex == null ? '' : `${minNoteIndex}-${maxNoteIndex}`,
    distinctNoteCount: noteLabels.size,
    noteLabels: [...noteLabels].slice(0, options.musicLaneNoteLabelPreviewLimit || 16),
    noteIndexCounts,
    pitchClassCounts,
    octaveStepCounts,
    durationSelectorCounts: durationSelectors,
    opcodeCounts,
    branchTargetOffsets: [...branchTargetOffsets].sort().slice(0, options.musicLaneBranchTargetPreviewLimit || 16),
    exactPsgFmState: false,
    exactPsgFmStateBlocker: 'Timeline lane state has notes, rests, duration selectors and opcode roles, but not yet exact PSG/FM register values, envelopes or pitch periods.',
    segments,
    assetPolicy: 'Metadata only: request ids, channel ids, stream offsets, note labels, frame counts, opcode names and summary counts. No ROM bytes, stream bytes, PSG/FM register values, port values or samples are persisted.',
  };
}

function wb3SummarizeMusicChannelLaneState(lanes) {
  const summary = {
    laneCount: lanes.length,
    playableLaneCount: lanes.filter(lane => lane.noteSegmentCount || lane.restSegmentCount || lane.specialSegmentCount).length,
    exactPsgFmStateLaneCount: lanes.filter(lane => lane.exactPsgFmState === true).length,
    eventCount: 0,
    noteEventCount: 0,
    restEventCount: 0,
    specialNoteEventCount: 0,
    durationCommandCount: 0,
    opcodeEventCount: 0,
    noteSegmentCount: 0,
    restSegmentCount: 0,
    specialSegmentCount: 0,
    activeFrameCount: 0,
    restFrameCount: 0,
    maxFrameCount: 0,
    consumedByteCount: 0,
    durationSelectorCount: 0,
    opcodeKindCount: 0,
    branchTargetRefCount: 0,
    noteLabelCount: 0,
    hardwareLaneCandidateCounts: {},
    endReasonCounts: {},
    durationSelectorCounts: {},
    noteIndexCounts: {},
    pitchClassCounts: {},
    octaveStepCounts: {},
    opcodeCounts: {},
    minNoteIndex: null,
    maxNoteIndex: null,
    noteRange: '',
    noteIndexCount: 0,
    pitchClassCount: 0,
    octaveStepCount: 0,
    persistedRomByteCount: 0,
    persistedStreamByteCount: 0,
    persistedRegisterValueCount: 0,
    persistedPortValueCount: 0,
    persistedSampleCount: 0,
    assetPolicy: 'metadata_only_music_channel_lane_state_no_bytes_values_or_samples',
  };
  const durationSelectors = new Set();
  const noteIndexes = new Set();
  const pitchClasses = new Set();
  const octaveSteps = new Set();
  const opcodes = new Set();
  const noteLabels = new Set();
  for (const lane of lanes) {
    for (const key of ['eventCount', 'noteEventCount', 'restEventCount', 'specialNoteEventCount', 'durationCommandCount', 'opcodeEventCount', 'noteSegmentCount', 'restSegmentCount', 'specialSegmentCount', 'activeFrameCount', 'restFrameCount', 'consumedBytes']) {
      const outKey = key === 'consumedBytes' ? 'consumedByteCount' : key;
      summary[outKey] += Number(lane[key] || 0);
    }
    summary.maxFrameCount = Math.max(summary.maxFrameCount, Number(lane.frameCount || 0));
    if (lane.minNoteIndex != null) summary.minNoteIndex = summary.minNoteIndex == null ? lane.minNoteIndex : Math.min(summary.minNoteIndex, lane.minNoteIndex);
    if (lane.maxNoteIndex != null) summary.maxNoteIndex = summary.maxNoteIndex == null ? lane.maxNoteIndex : Math.max(summary.maxNoteIndex, lane.maxNoteIndex);
    for (const label of wb3DecoderArray(lane.noteLabels)) noteLabels.add(label);
    for (const key of Object.keys(lane.noteIndexCounts || {})) {
      noteIndexes.add(key);
      wb3AudioRuntimeIncrement(summary.noteIndexCounts, key, lane.noteIndexCounts[key]);
    }
    for (const key of Object.keys(lane.pitchClassCounts || {})) {
      pitchClasses.add(key);
      wb3AudioRuntimeIncrement(summary.pitchClassCounts, key, lane.pitchClassCounts[key]);
    }
    for (const key of Object.keys(lane.octaveStepCounts || {})) {
      octaveSteps.add(key);
      wb3AudioRuntimeIncrement(summary.octaveStepCounts, key, lane.octaveStepCounts[key]);
    }
    for (const key of Object.keys(lane.durationSelectorCounts || {})) {
      durationSelectors.add(key);
      wb3AudioRuntimeIncrement(summary.durationSelectorCounts, key, lane.durationSelectorCounts[key]);
    }
    for (const key of Object.keys(lane.opcodeCounts || {})) {
      opcodes.add(key);
      wb3AudioRuntimeIncrement(summary.opcodeCounts, key, lane.opcodeCounts[key]);
    }
    summary.branchTargetRefCount += wb3DecoderArray(lane.branchTargetOffsets).length;
    wb3AudioRuntimeIncrement(summary.hardwareLaneCandidateCounts, lane.hardwareLaneCandidate || 'unresolved_audio_lane');
    wb3AudioRuntimeIncrement(summary.endReasonCounts, lane.endReason || 'unknown');
  }
  summary.durationSelectorCount = durationSelectors.size;
  summary.noteIndexCount = noteIndexes.size;
  summary.pitchClassCount = pitchClasses.size;
  summary.octaveStepCount = octaveSteps.size;
  summary.opcodeKindCount = opcodes.size;
  summary.noteLabelCount = noteLabels.size;
  summary.noteRange = summary.minNoteIndex == null || summary.maxNoteIndex == null ? '' : `${summary.minNoteIndex}-${summary.maxNoteIndex}`;
  return summary;
}

function wb3BuildMusicChannelLaneStateModel(lanes) {
  return {
    kind: 'music_channel_lane_state_preview',
    summary: wb3SummarizeMusicChannelLaneState(lanes),
    lanes,
    semantics: {
      source: '_DATA_D139_ request header channels + _LABEL_C191_ timeline parser semantics',
      laneBoundary: 'Per-channel lane state includes note/rest spans, duration selectors and opcode roles. Exact PSG/FM register state is still pending.',
      hardwareLaneCandidate: 'Channel id ranges are preserved as low-confidence lane candidates until output-mode/runtime evidence binds them to PSG/FM hardware channels.',
    },
    assetPolicy: 'Metadata only: lane ids, offsets, note labels, frame counts, opcode names and counts. No ROM bytes, stream bytes, PSG/FM register values, port values, samples or audio bytes are persisted.',
  };
}

function wb3MusicPitchDurationSupportTables(rom) {
  const specs = [
    {
      id: 'duration_lookup_be44',
      role: 'duration_selector_to_frame_count',
      label: 'Z80 $BE44 within _DATA_FE22_',
      z80Address: 0xbe44,
      romOffset: 0x0fe44,
      bank: 3,
      entryCount: 64,
      entrySizeBytes: 1,
      evidence: '_LABEL_C191_ masks duration command bytes with $3F and reads Z80 $BE44 + selector.',
    },
    {
      id: 'psg_pitch_pointer_table_8a85',
      role: 'psg_pitch_pointer_table',
      label: '_DATA_CA85_',
      z80Address: 0x8a85,
      romOffset: 0x0ca85,
      bank: 3,
      entryCount: 12,
      entrySizeBytes: 2,
      rowEntryCount: 16,
      rowEntrySizeBytes: 2,
      evidence: '_LABEL_C56A_ loads Z80 $8A85, indexes by semitone class, then applies octave shift before PSG output.',
    },
    {
      id: 'fm_pitch_pointer_table_8c1d',
      role: 'fm_pitch_pointer_table',
      label: 'Z80 $8C1D within _DATA_CAFF_',
      z80Address: 0x8c1d,
      romOffset: 0x0cc1d,
      bank: 3,
      entryCount: 12,
      entrySizeBytes: 2,
      rowEntryCount: 16,
      rowEntrySizeBytes: 2,
      evidence: '_LABEL_C928_ loads Z80 $8C1D, indexes by semitone class, then applies octave/register packing before FM output.',
    },
  ];
  return specs.map(spec => {
    const spanBytes = spec.entryCount * spec.entrySizeBytes;
    return Object.assign({}, spec, {
      z80AddressHex: wb3DecoderHex(spec.z80Address, 4),
      romOffsetHex: wb3DecoderHex(spec.romOffset),
      spanBytes,
      availableInLocalRom: Boolean(rom && spec.romOffset >= 0 && spec.romOffset + spanBytes <= rom.length),
      rowSpanBytes: Number(spec.rowEntryCount || 0) * Number(spec.rowEntrySizeBytes || 0),
      persistedValueCount: 0,
    });
  });
}

function wb3MusicCountMapTotal(counts) {
  return Object.values(counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function wb3MusicNoteLabelForIndex(noteIndex) {
  const index = Number(noteIndex);
  if (!Number.isFinite(index)) return '';
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  return `${names[((index % 12) + 12) % 12]}${Math.floor(index / 12) + 3}`;
}

function wb3MusicPitchRowPointer(rom, table, pitchClass) {
  const cls = Number(pitchClass);
  if (!rom || !table || !Number.isFinite(cls)) return null;
  const entryOffset = Number(table.romOffset) + cls * Number(table.entrySizeBytes || 2);
  if (entryOffset < 0 || entryOffset + 1 >= rom.length) return null;
  const z80Pointer = wb3ReadWordLE(rom, entryOffset);
  const rowOffset = wb3MusicZ80ToBank3Rom(z80Pointer);
  const rowSpanBytes = Number(table.rowSpanBytes || 0);
  return {
    entryOffset,
    entryOffsetHex: wb3DecoderHex(entryOffset),
    z80Pointer,
    z80PointerHex: z80Pointer == null ? '' : wb3DecoderHex(z80Pointer, 4),
    rowOffset,
    rowOffsetHex: rowOffset == null ? '' : wb3DecoderHex(rowOffset),
    rowSpanBytes,
    rowAvailableInLocalRom: rowOffset != null && rowSpanBytes > 0 && rowOffset >= 0 && rowOffset + rowSpanBytes <= rom.length,
  };
}

function wb3MusicReadPitchRowWord(rom, table, pitchClass, substepIndex) {
  const row = wb3MusicPitchRowPointer(rom, table, pitchClass);
  const substep = Number(substepIndex || 0);
  const entrySize = Number(table?.rowEntrySizeBytes || 2);
  if (!row || row.rowOffset == null || !Number.isFinite(substep)) return Object.assign({ word: null, wordOffset: null, wordOffsetHex: '' }, row || {});
  const wordOffset = row.rowOffset + substep * entrySize;
  const word = wordOffset >= 0 && wordOffset + 1 < rom.length ? wb3ReadWordLE(rom, wordOffset) : null;
  return Object.assign({}, row, {
    substepIndex: substep,
    wordOffset,
    wordOffsetHex: wordOffset == null ? '' : wb3DecoderHex(wordOffset),
    word,
    wordHex: word == null ? '' : wb3DecoderHex(word, 4),
  });
}

function wb3MusicRoundHz(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1000) / 1000 : null;
}

function wb3MusicPitchValueCandidate(rom, psgTable, fmTable, noteIndex, substepIndex) {
  const index = Number(noteIndex);
  if (!Number.isFinite(index)) return null;
  const pitchClass = ((index % 12) + 12) % 12;
  const octaveStep = Math.max(0, Math.floor(index / 12));
  const substep = Number(substepIndex || 0) & 0x0f;
  const psgWord = wb3MusicReadPitchRowWord(rom, psgTable, pitchClass, substep);
  const fmWord = wb3MusicReadPitchRowWord(rom, fmTable, pitchClass, substep);
  const psgShifted = psgWord.word == null ? null : (Number(psgWord.word) >>> octaveStep);
  const psgTonePeriod = psgShifted == null ? null : (psgShifted & 0x03ff);
  const smsPsgClockHz = 3579545;
  const psgFrequencyHz = psgTonePeriod ? wb3MusicRoundHz(smsPsgClockHz / (32 * psgTonePeriod)) : null;
  const fmHigh = fmWord.word == null ? null : (((octaveStep << 1) | ((Number(fmWord.word) >> 8) & 0xff)) & 0xff);
  const fmRegisterWord = fmWord.word == null ? null : (((fmHigh << 8) | (Number(fmWord.word) & 0xff)) & 0xffff);
  return {
    noteIndex: index,
    pitchClass,
    octaveStep,
    substepIndex: substep,
    psgPointerEntryOffsetHex: psgWord.entryOffsetHex || '',
    psgRowOffsetHex: psgWord.rowOffsetHex || '',
    psgWordOffsetHex: psgWord.wordOffsetHex || '',
    psgRawWordCandidate: psgWord.word,
    psgRawWordCandidateHex: psgWord.wordHex || '',
    psgTonePeriodCandidate: psgTonePeriod,
    psgFrequencyHzCandidate: psgFrequencyHz,
    psgBasePeriodResolved: psgTonePeriod != null && psgTonePeriod > 0,
    fmPointerEntryOffsetHex: fmWord.entryOffsetHex || '',
    fmRowOffsetHex: fmWord.rowOffsetHex || '',
    fmWordOffsetHex: fmWord.wordOffsetHex || '',
    fmRawWordCandidate: fmWord.word,
    fmRawWordCandidateHex: fmWord.wordHex || '',
    fmRegisterWordCandidate: fmRegisterWord,
    fmRegisterWordCandidateHex: fmRegisterWord == null ? '' : wb3DecoderHex(fmRegisterWord, 4),
    fmBaseRegisterResolved: fmRegisterWord != null,
    dynamicPitchInputsPending: true,
    exactPeriodResolved: false,
  };
}

function wb3BuildMusicPitchDurationBindingModel(rom, channelLaneState, options) {
  const laneSummary = wb3DecoderObject(channelLaneState?.summary);
  const durationCounts = laneSummary.durationSelectorCounts || {};
  const noteCounts = laneSummary.noteIndexCounts || {};
  const tables = wb3MusicPitchDurationSupportTables(rom);
  const tableById = new Map(tables.map(table => [table.id, table]));
  const durationTable = tableById.get('duration_lookup_be44');
  const psgTable = tableById.get('psg_pitch_pointer_table_8a85');
  const fmTable = tableById.get('fm_pitch_pointer_table_8c1d');
  const durationRows = Object.keys(durationCounts).map(key => {
    const selector = Number(key);
    const lookupOffset = Number.isFinite(selector) ? durationTable.romOffset + (selector & 0x3f) : null;
    const resolvedByLocalRom = lookupOffset != null && rom && lookupOffset >= 0 && lookupOffset < rom.length && Number(rom[lookupOffset] || 0) > 0;
    return {
      selector,
      count: Number(durationCounts[key] || 0),
      lookupOffsetHex: lookupOffset == null ? '' : wb3DecoderHex(lookupOffset),
      resolvedByLocalRom,
    };
  }).sort((a, b) => a.selector - b.selector);
  const noteRows = Object.keys(noteCounts).map(key => {
    const noteIndex = Number(key);
    const pitchClass = ((noteIndex % 12) + 12) % 12;
    const octaveStep = Math.floor(noteIndex / 12);
    const psgEntryOffset = psgTable.romOffset + pitchClass * psgTable.entrySizeBytes;
    const fmEntryOffset = fmTable.romOffset + pitchClass * fmTable.entrySizeBytes;
    const candidate = wb3MusicPitchValueCandidate(rom, psgTable, fmTable, noteIndex, 0) || {};
    return {
      noteIndex,
      noteLabel: wb3MusicNoteLabelForIndex(noteIndex),
      count: Number(noteCounts[key] || 0),
      pitchClass,
      octaveStep,
      psgPointerEntryOffsetHex: wb3DecoderHex(psgEntryOffset),
      psgPointerEntryResolved: Boolean(rom && psgEntryOffset >= 0 && psgEntryOffset + psgTable.entrySizeBytes <= rom.length),
      psgRowOffsetHex: candidate.psgRowOffsetHex || '',
      psgWordOffsetHex: candidate.psgWordOffsetHex || '',
      psgTonePeriodCandidate: candidate.psgTonePeriodCandidate ?? null,
      psgFrequencyHzCandidate: candidate.psgFrequencyHzCandidate ?? null,
      psgBasePeriodResolved: candidate.psgBasePeriodResolved === true,
      fmPointerEntryOffsetHex: wb3DecoderHex(fmEntryOffset),
      fmPointerEntryResolved: Boolean(rom && fmEntryOffset >= 0 && fmEntryOffset + fmTable.entrySizeBytes <= rom.length),
      fmRowOffsetHex: candidate.fmRowOffsetHex || '',
      fmWordOffsetHex: candidate.fmWordOffsetHex || '',
      fmRegisterWordCandidate: candidate.fmRegisterWordCandidate ?? null,
      fmRegisterWordCandidateHex: candidate.fmRegisterWordCandidateHex || '',
      fmBaseRegisterResolved: candidate.fmBaseRegisterResolved === true,
      dynamicPitchInputsPending: true,
      exactPeriodResolved: false,
    };
  }).sort((a, b) => a.noteIndex - b.noteIndex);
  const pitchClassRows = Object.keys(laneSummary.pitchClassCounts || {}).map(key => {
    const pitchClass = Number(key);
    const psgEntryOffset = psgTable.romOffset + pitchClass * psgTable.entrySizeBytes;
    const fmEntryOffset = fmTable.romOffset + pitchClass * fmTable.entrySizeBytes;
    const psgRow = wb3MusicPitchRowPointer(rom, psgTable, pitchClass);
    const fmRow = wb3MusicPitchRowPointer(rom, fmTable, pitchClass);
    return {
      pitchClass,
      count: Number(laneSummary.pitchClassCounts[key] || 0),
      psgPointerEntryOffsetHex: wb3DecoderHex(psgEntryOffset),
      psgPointerEntryResolved: Boolean(rom && psgEntryOffset >= 0 && psgEntryOffset + psgTable.entrySizeBytes <= rom.length),
      psgRowOffsetHex: psgRow?.rowOffsetHex || '',
      psgRowAvailableInLocalRom: psgRow?.rowAvailableInLocalRom === true,
      psgRowWordCount: psgRow?.rowAvailableInLocalRom ? Number(psgTable.rowEntryCount || 0) : 0,
      fmPointerEntryOffsetHex: wb3DecoderHex(fmEntryOffset),
      fmPointerEntryResolved: Boolean(rom && fmEntryOffset >= 0 && fmEntryOffset + fmTable.entrySizeBytes <= rom.length),
      fmRowOffsetHex: fmRow?.rowOffsetHex || '',
      fmRowAvailableInLocalRom: fmRow?.rowAvailableInLocalRom === true,
      fmRowWordCount: fmRow?.rowAvailableInLocalRom ? Number(fmTable.rowEntryCount || 0) : 0,
      exactPeriodResolved: false,
    };
  }).sort((a, b) => a.pitchClass - b.pitchClass);
  const summary = {
    laneCount: Number(laneSummary.laneCount || 0),
    playableLaneCount: Number(laneSummary.playableLaneCount || 0),
    durationSelectorCount: durationRows.length,
    durationCommandCount: wb3MusicCountMapTotal(durationCounts),
    durationResolvedSelectorCount: durationRows.filter(row => row.resolvedByLocalRom).length,
    durationUnresolvedSelectorCount: durationRows.filter(row => !row.resolvedByLocalRom).length,
    noteIndexCount: noteRows.length,
    noteEventCount: wb3MusicCountMapTotal(noteCounts),
    pitchClassCount: pitchClassRows.length,
    octaveStepCount: Object.keys(laneSummary.octaveStepCounts || {}).length,
    psgPointerEntryCandidateCount: pitchClassRows.length,
    psgPointerEntryResolvedCount: pitchClassRows.filter(row => row.psgPointerEntryResolved).length,
    psgPitchRowResolvedCount: pitchClassRows.filter(row => row.psgRowAvailableInLocalRom).length,
    psgPitchRowWordCandidateCount: pitchClassRows.reduce((sum, row) => sum + Number(row.psgRowWordCount || 0), 0),
    psgBasePeriodCandidateCount: noteRows.filter(row => row.psgBasePeriodResolved).length,
    fmPointerEntryCandidateCount: pitchClassRows.length,
    fmPointerEntryResolvedCount: pitchClassRows.filter(row => row.fmPointerEntryResolved).length,
    fmPitchRowResolvedCount: pitchClassRows.filter(row => row.fmRowAvailableInLocalRom).length,
    fmPitchRowWordCandidateCount: pitchClassRows.reduce((sum, row) => sum + Number(row.fmRowWordCount || 0), 0),
    fmBaseRegisterWordCandidateCount: noteRows.filter(row => row.fmBaseRegisterResolved).length,
    pitchBaseSubstepIndex: 0,
    transientPitchValueCandidateCount: noteRows.filter(row => row.psgBasePeriodResolved).length + noteRows.filter(row => row.fmBaseRegisterResolved).length,
    exactPitchPeriodValueCount: 0,
    exactPsgFmStateReady: false,
    persistedRomByteCount: 0,
    persistedStreamByteCount: 0,
    persistedTableValueCount: 0,
    persistedRegisterValueCount: 0,
    persistedPortValueCount: 0,
    persistedSampleCount: 0,
    assetPolicy: 'metadata_only_music_pitch_duration_binding_no_rom_bytes_values_or_samples',
  };
  return {
    kind: 'music_pitch_duration_binding_preview',
    supportTables: tables,
    summary,
    durationSelectors: durationRows.slice(0, options.musicPitchDurationSelectorPreviewLimit || 64),
    noteBindings: noteRows.slice(0, options.musicPitchNoteBindingPreviewLimit || 80),
    pitchClassBindings: pitchClassRows,
    semantics: {
      durationLookup: '_LABEL_C191_ treats $80-$EF stream bytes as duration/parameter commands and resolves selector = byte & $3F through Z80 $BE44.',
      noteIndexFormula: '_LABEL_C2BD_ maps low-bit7 note bytes to semitone index = octave * 12 + low nibble, then applies channel transpose; rest low nibble $0C is excluded from pitch binding.',
      psgPitchLookup: '_LABEL_C56A_ uses Z80 $8A85 as a PSG pitch pointer table indexed by semitone class, reads a 16-word row by substep, and shifts the candidate period by octave before Port_PSG writes.',
      fmPitchLookup: '_LABEL_C928_ uses Z80 $8C1D as an FM pitch pointer table indexed by semitone class, reads a 16-word row by substep, and packs octave bits into the FM register word.',
      exactStateBoundary: 'This model resolves local-ROM base pitch candidates for substep 0. Full PSG/FM state remains pending until dynamic pitch deltas, envelopes, instruments and output timing are folded in.',
    },
    assetPolicy: 'Transient preview may resolve local-ROM table availability and pitch value candidates, but persisted metadata must store only labels, offsets, counts, booleans and evidence. No ROM bytes, decoded streams, table values, PSG/FM register values, port values or samples.',
  };
}

function wb3BuildMusicTimelinePreview(rom, songs, map, options) {
  const timelines = [];
  const opcodeParameterTimelineInputs = [];
  const laneStates = [];
  const limitSongs = songs.slice(0, options.musicTimelineSongLimit || 6);
  for (const song of limitSongs) {
    for (const channel of wb3DecoderArray(song.header?.channels).slice(0, options.musicTimelineChannelLimit || 8)) {
      const streamOffset = channel.streamRomOffset;
      if (streamOffset == null) continue;
      const timeline = wb3ParseMusicStreamTimeline(rom, streamOffset, map, options);
      laneStates.push(wb3BuildMusicChannelLaneState(song, channel, timeline, options));
      opcodeParameterTimelineInputs.push({
        requestId: song.index,
        requestIdHex: `$${Number(song.index || 0).toString(16).toUpperCase().padStart(2, '0')}`,
        channelIndex: channel.index,
        channelIdHex: channel.channelIdHex || '',
        streamOffset: timeline.startOffsetHex,
        events: timeline.events,
      });
      timelines.push({
        requestId: song.index,
        requestIdHex: `$${Number(song.index || 0).toString(16).toUpperCase().padStart(2, '0')}`,
        channelIndex: channel.index,
        channelIdHex: channel.channelIdHex || '',
        priorityHex: channel.priorityHex || '',
        streamOffset: timeline.startOffsetHex,
        endReason: timeline.endReason,
        stats: timeline.stats,
        warnings: timeline.warnings,
        events: timeline.events.slice(0, options.musicTimelineRenderedEventLimit || 96),
      });
    }
  }
  const aggregate = {
    timelineCount: timelines.length,
    eventCount: timelines.reduce((sum, item) => sum + Number(item.stats.eventCount || 0), 0),
    noteEventCount: timelines.reduce((sum, item) => sum + Number(item.stats.noteEventCount || 0), 0),
    restEventCount: timelines.reduce((sum, item) => sum + Number(item.stats.restEventCount || 0), 0),
    specialNoteEventCount: timelines.reduce((sum, item) => sum + Number(item.stats.specialNoteEventCount || 0), 0),
    durationCommandCount: timelines.reduce((sum, item) => sum + Number(item.stats.durationCommandCount || 0), 0),
      opcodeEventCount: timelines.reduce((sum, item) => sum + Number(item.stats.opcodeEventCount || 0), 0),
    maxFrameCount: timelines.reduce((max, item) => Math.max(max, Number(item.stats.frameCount || 0)), 0),
  };
  return {
    timelines,
    aggregate,
    channelLaneState: wb3BuildMusicChannelLaneStateModel(laneStates),
    opcodeParameterState: wb3BuildMusicOpcodeParameterStateModel(opcodeParameterTimelineInputs, options),
  };
}

function wb3MusicGraphRootForChannel(graph, channel) {
  const roots = wb3DecoderArray(graph?.rootChannels);
  const channelIndex = Number(channel?.index);
  const channelIdHex = channel?.channelIdHex || '';
  const streamOffset = channel?.streamRomOffset || '';
  return roots.find(root => Number(root.channelIndex) === channelIndex)
    || roots.find(root => channelIdHex && root.channelIdHex === channelIdHex)
    || roots.find(root => streamOffset && root.rootStreamOffset === streamOffset)
    || null;
}

function wb3BuildMusicRequestChannelStateSeed(rom, songs, graphs, map, options) {
  const graphByRequest = new Map();
  for (const graph of wb3DecoderArray(graphs)) graphByRequest.set(Number(graph.requestId), graph);
  const requestLimit = options.musicStateSeedRequestLimit || 16;
  const channelLimit = options.musicStateSeedChannelLimit || 8;
  const requests = [];
  const channels = [];
  const warnings = [];
  let validStreamPointerCount = 0;
  let unresolvedStreamPointerCount = 0;
  let timelineCount = 0;
  let timelineEventCount = 0;
  let timelineNoteEventCount = 0;
  let timelineRestEventCount = 0;
  let timelineDurationCommandCount = 0;
  let timelineOpcodeEventCount = 0;
  let branchEdgeCount = 0;
  let reachableStreamCount = 0;
  let roomRecipeDescriptorCount = 0;

  for (const song of wb3DecoderArray(songs).slice(0, requestLimit)) {
    const requestId = Number(song.index);
    const graph = graphByRequest.get(requestId) || null;
    const sourceChannels = wb3DecoderArray(song.header?.channels).slice(0, channelLimit);
    const requestChannels = [];
    const uniqueStreamOffsets = new Set();
    const requestWarnings = [];
    if (!sourceChannels.length) requestWarnings.push('No parsed channel headers for this request.');
    if (!graph) requestWarnings.push('No request graph matched this header region.');

    for (const channel of sourceChannels) {
      const streamOffset = wb3DecoderParseOffset(channel.streamRomOffset);
      const streamResolved = streamOffset != null && rom && streamOffset >= 0 && streamOffset < rom.length;
      if (streamResolved) validStreamPointerCount++;
      else unresolvedStreamPointerCount++;
      if (channel.streamRomOffset) uniqueStreamOffsets.add(channel.streamRomOffset);

      const root = wb3MusicGraphRootForChannel(graph, channel);
      const timeline = streamResolved
        ? wb3ParseMusicStreamTimeline(rom, channel.streamRomOffset, map, Object.assign({}, options, {
          musicTimelineEventLimit: options.musicStateSeedTimelineEventLimit || 96,
          musicTimelineByteLimit: options.musicStateSeedTimelineByteLimit || 384,
          musicTimelineRenderedEventLimit: options.musicStateSeedRenderedEventLimit || 12,
        }))
        : null;
      if (timeline) {
        timelineCount++;
        timelineEventCount += Number(timeline.stats.eventCount || 0);
        timelineNoteEventCount += Number(timeline.stats.noteEventCount || 0);
        timelineRestEventCount += Number(timeline.stats.restEventCount || 0);
        timelineDurationCommandCount += Number(timeline.stats.durationCommandCount || 0);
        timelineOpcodeEventCount += Number(timeline.stats.opcodeEventCount || 0);
      }

      const channelSeed = {
        requestId,
        requestIdHex: `$${requestId.toString(16).toUpperCase().padStart(2, '0')}`,
        channelIndex: channel.index,
        channelIdHex: channel.channelIdHex || '',
        priorityHex: channel.priorityHex || '',
        headerOffset: channel.headerOffset || '',
        streamZ80: channel.streamZ80 || '',
        streamRomOffset: channel.streamRomOffset || '',
        streamRegion: channel.streamRegion || null,
        stateSeedStatus: streamResolved ? 'stream_resolved' : 'unresolved_stream_pointer',
        stateSeedSource: '_DATA_D139_ request header channel record',
        graphReachableStreamCount: root?.reachableStreamCount || 0,
        graphBranchEdgeCount: root?.branchEdgeCount || 0,
        graphMaxBranchDepth: root?.maxBranchDepth || 0,
        graphMissingTargetCount: root?.missingTargetCount || 0,
        timelineEndReason: timeline?.endReason || '',
        timelineStats: timeline?.stats || null,
        timelineWarnings: timeline?.warnings || [],
      };
      requestChannels.push(channelSeed);
      channels.push(channelSeed);
    }

    branchEdgeCount += Number(graph?.branchEdgeCount || 0);
    reachableStreamCount += Number(graph?.reachableStreamCount || 0);
    roomRecipeDescriptorCount += Number(graph?.roomRecipeUsage?.descriptorCount || 0);
    requests.push({
      requestId,
      requestIdHex: `$${requestId.toString(16).toUpperCase().padStart(2, '0')}`,
      tableEntryOffset: song.tableEntryOffset || '',
      headerOffset: song.romOffset || '',
      headerRegion: song.region || null,
      classification: graph?.classification || null,
      channelCount: wb3DecoderArray(song.header?.channels).length,
      previewedChannelCount: requestChannels.length,
      uniqueStreamCount: uniqueStreamOffsets.size,
      reachableStreamCount: graph?.reachableStreamCount || 0,
      branchEdgeCount: graph?.branchEdgeCount || 0,
      maxBranchDepth: graph?.maxBranchDepth || 0,
      roomRecipeDescriptorCount: graph?.roomRecipeUsage?.descriptorCount || 0,
      warningCount: requestWarnings.length,
      warnings: requestWarnings,
    });
    warnings.push(...requestWarnings.map(warning => `Request ${requestId}: ${warning}`));
  }

  return {
    kind: 'music_request_channel_state_seed',
    requests,
    channels,
    aggregate: {
      requestSeedCount: requests.length,
      channelSeedCount: channels.length,
      validStreamPointerCount,
      unresolvedStreamPointerCount,
      uniqueStreamOffsetCount: new Set(channels.map(channel => channel.streamRomOffset).filter(Boolean)).size,
      timelineCount,
      timelineEventCount,
      timelineNoteEventCount,
      timelineRestEventCount,
      timelineDurationCommandCount,
      timelineOpcodeEventCount,
      reachableStreamCount,
      branchEdgeCount,
      roomRecipeDescriptorCount,
      warningCount: warnings.length,
    },
    semantics: {
      requestTable: '_DATA_D139_',
      requestLoaderRoutines: '_LABEL_C04D_ immediate request loader, _LABEL_C09F_ queued request loader',
      streamParserRoutine: '_LABEL_C191_',
      stateSeedBoundary: 'Initial channel request/header/stream/timeline metadata only; exact PSG/FM output state is still pending.',
    },
    warnings,
  };
}

function wb3TrimAudioSong(song, channelLimit) {
  return {
    index: song.index,
    tableEntryOffset: song.tableEntryOffset,
    z80Pointer: song.z80Pointer,
    romOffset: song.romOffset,
    region: song.region || null,
    headerBytes: song.header?.headerBytes || 0,
    terminatorOffset: song.header?.terminatorOffset || null,
    terminatorByte: song.header?.terminatorByte || null,
    channelCount: wb3DecoderArray(song.header?.channels).length,
    channels: wb3DecoderArray(song.header?.channels).slice(0, channelLimit || 16).map(channel => ({
      index: channel.index,
      headerOffset: channel.headerOffset,
      channelId: channel.channelId,
      channelIdHex: channel.channelIdHex,
      priority: channel.priority,
      priorityHex: channel.priorityHex,
      streamZ80: channel.streamZ80,
      streamRomOffset: channel.streamRomOffset,
      streamRegion: channel.streamRegion || null,
    })),
    warningCount: wb3DecoderArray(song.warnings).length + wb3DecoderArray(song.header?.warnings).length,
  };
}

function wb3TrimAudioStream(stream, branchLimit) {
  return {
    id: stream.id,
    startOffset: stream.startOffset,
    endOffset: stream.endOffset,
    consumedBytes: stream.consumedBytes,
    region: stream.region || null,
    referencedByCount: wb3DecoderArray(stream.referencedBy).length,
    referencedBy: wb3DecoderArray(stream.referencedBy).slice(0, 8),
    noteBytes: stream.noteBytes || 0,
    highFlagNoteBytes: stream.highFlagNoteBytes || 0,
    restOrSpecialBytes: stream.restOrSpecialBytes || 0,
    opcodeCounts: stream.opcodeCounts || {},
    branchTargetCount: wb3DecoderArray(stream.branchTargets).length,
    branchTargets: wb3DecoderArray(stream.branchTargets).slice(0, branchLimit || 16),
    endReason: stream.endReason || '',
    warningCount: wb3DecoderArray(stream.warnings).length,
  };
}

function wb3TrimAudioGraph(graph, streamLimit, branchLimit) {
  return {
    id: graph.id,
    requestId: graph.requestId,
    requestIdHex: graph.requestIdHex,
    tableEntryOffset: graph.tableEntryOffset,
    headerOffset: graph.headerOffset,
    headerRegion: graph.headerRegion || null,
    classification: graph.classification || null,
    roomRecipeUsage: graph.roomRecipeUsage ? {
      descriptorCount: graph.roomRecipeUsage.descriptorCount || 0,
      sampleRecipeIds: wb3DecoderArray(graph.roomRecipeUsage.sampleRecipeIds).slice(0, 8),
      sampleDescriptorOffsets: wb3DecoderArray(graph.roomRecipeUsage.sampleDescriptorOffsets).slice(0, 8),
    } : null,
    channelCount: graph.channelCount || 0,
    rootChannels: wb3DecoderArray(graph.rootChannels).slice(0, 8).map(channel => ({
      channelIndex: channel.channelIndex,
      channelIdHex: channel.channelIdHex,
      priorityHex: channel.priorityHex,
      rootStreamOffset: channel.rootStreamOffset,
      rootStreamRegion: channel.rootStreamRegion || null,
      reachableStreamCount: channel.reachableStreamCount || 0,
      branchEdgeCount: channel.branchEdgeCount || 0,
      maxBranchDepth: channel.maxBranchDepth || 0,
      opcodeTotals: channel.opcodeTotals || {},
      missingTargetCount: channel.missingTargetCount || 0,
    })),
    reachableStreamCount: graph.reachableStreamCount || 0,
    reachableStreamOffsets: wb3DecoderArray(graph.reachableStreamOffsets).slice(0, streamLimit || 24),
    reachableStreamSamples: wb3DecoderArray(graph.reachableStreamSamples).slice(0, streamLimit || 24),
    streamRegionCount: graph.streamRegionCount || 0,
    streamRegionIds: wb3DecoderArray(graph.streamRegionIds),
    branchEdgeCount: graph.branchEdgeCount || 0,
    branchEdges: wb3DecoderArray(graph.branchEdges).slice(0, branchLimit || 24),
    immediatePointerCallEdgeCount: graph.immediatePointerCallEdgeCount || 0,
    jumpPointerEdgeCount: graph.jumpPointerEdgeCount || 0,
    maxBranchDepth: graph.maxBranchDepth || 0,
    consumedBytes: graph.consumedBytes || 0,
    noteBytes: graph.noteBytes || 0,
    highFlagNoteBytes: graph.highFlagNoteBytes || 0,
    restOrSpecialBytes: graph.restOrSpecialBytes || 0,
    opcodeTotals: graph.opcodeTotals || {},
    endReasonCounts: graph.endReasonCounts || {},
    missingTargetCount: graph.missingTargetCount || 0,
  };
}

function wb3AudioFalseDwTargetShape(region) {
  const audit = wb3DecoderObject(region?.analysis?.audioHeaderFalseDwTargetAudit);
  const shapeParses = wb3DecoderArray(audit.shapeParses);
  if (!shapeParses.length) return null;
  return {
    catalogId: audit.catalogId || '',
    confidence: audit.confidence || '',
    kind: audit.kind || '',
    rejectedPointerCount: wb3DecoderArray(audit.rejectedPointers).length,
    rejectedPointers: wb3DecoderArray(audit.rejectedPointers).slice(0, 8).map(pointer => ({
      requestId: pointer?.requestId ?? null,
      requestIdHex: pointer?.requestIdHex || '',
      channelIndex: pointer?.channelIndex ?? null,
      rejectedPointerOffset: pointer?.rejectedPointerOffset || '',
      rejectedPointerRegion: pointer?.rejectedPointerRegion || null,
      falseWordZ80: pointer?.falseWordZ80 || '',
      actualStreamOffset: pointer?.actualStreamOffset || '',
      actualStreamRegion: pointer?.actualStreamRegion || null,
      targetHasStrongEvidence: pointer?.targetHasStrongEvidence === true,
      confidence: pointer?.confidence || '',
    })),
    shapeParses: shapeParses.slice(0, 8).map(shape => ({
      id: shape?.id || '',
      consumedBytes: Number(shape?.consumedBytes || 0),
      endOffset: shape?.endOffset || '',
      endReason: shape?.endReason || '',
      noteBytes: Number(shape?.noteBytes || 0),
      highFlagNoteBytes: Number(shape?.highFlagNoteBytes || 0),
      restOrSpecialBytes: Number(shape?.restOrSpecialBytes || 0),
      opcodeCounts: wb3DecoderObject(shape?.opcodeCounts),
      opcodeRoles: wb3DecoderObject(shape?.opcodeRoles),
      branchTargetCount: Number(shape?.branchTargetCount || 0),
      warningCount: Number(shape?.warningCount || 0),
      parserConfidence: shape?.parserConfidence || '',
    })),
    evidence: wb3DecoderArray(audit.evidence).slice(0, 8),
  };
}

function wb3ClassifyNonRequestBackedMusicRegion(region, metrics) {
  const size = Number(metrics?.size || region?.size || 0);
  const noteLikeBytes = Number(metrics?.noteLikeBytes || 0);
  const opcodeLikeBytes = Number(metrics?.opcodeLikeBytes || 0);
  const terminators = Number(metrics?.terminators || 0);
  const text = [region?.name, region?.notes, region?.type].join(' ');
  const pointerNamed = /pointer table/i.test(text);
  const offset = wb3DecoderParseOffset(region?.offset);
  const bank = offset == null ? null : wb3DecoderBankOf(offset);
  const falseDwTargetShape = wb3AudioFalseDwTargetShape(region);
  const common = {
    requestBacked: false,
    bank,
    totalBytes: size,
    noteLikeBytes,
    opcodeLikeBytes,
    terminators,
    evidence: [
      'No world-audio-catalog song/stream match for this region.',
      'No world-audio-stream-graph reachable stream match for this region.',
    ],
  };

  if (falseDwTargetShape) {
    return Object.assign(common, {
      kind: 'audio_false_dw_target_stream_shape_candidate',
      confidence: falseDwTargetShape.shapeParses[0]?.parserConfidence || 'medium',
      status: 'experimental',
      likelyStandaloneMusicStream: true,
      confirmedStreamReference: false,
      falseDwTargetShape,
      recommendedAction: 'Do not treat the rejected .dw as an owner pointer; verify runtime reachability or a real caller before promoting this stream-shaped fragment.',
      summary: `${size} byte false-DW target with stream-like shape; rejected header word is priority+stream-low, not a confirmed pointer.`,
    });
  }

  if (pointerNamed) {
    return Object.assign(common, {
      kind: 'audio_sidecar_pointer_table_candidate',
      confidence: size <= 8 ? 'medium' : 'low',
      status: 'metadata_only',
      likelyStandaloneMusicStream: false,
      recommendedAction: 'Review as a pointer/sidecar table before treating it as standalone music bytecode.',
      summary: `${size} byte non request-backed pointer-table candidate in a music-typed region.`,
    });
  }
  if (size <= 2) {
    return Object.assign(common, {
      kind: 'audio_inline_literal_or_single_pointer_candidate',
      confidence: 'low',
      status: 'metadata_only',
      likelyStandaloneMusicStream: false,
      recommendedAction: 'Keep as an audio-adjacent fragment until a caller or table owner is confirmed.',
      summary: `${size} byte non request-backed audio-adjacent fragment; too small to verify as a standalone stream.`,
    });
  }
  if (size <= 8 && terminators === 0) {
    return Object.assign(common, {
      kind: 'audio_micro_table_candidate',
      confidence: 'low',
      status: 'metadata_only',
      likelyStandaloneMusicStream: false,
      recommendedAction: 'Look for an owning table/routine instead of decoding as a music stream.',
      summary: `${size} byte non request-backed micro table candidate in a music-typed region.`,
    });
  }
  if (terminators > 0 || opcodeLikeBytes > 0) {
    return Object.assign(common, {
      kind: 'unlinked_audio_stream_fragment_candidate',
      confidence: 'low',
      status: 'experimental',
      likelyStandaloneMusicStream: true,
      recommendedAction: 'Trace caller ownership or a missing stream reference before promoting to decoded music.',
      summary: `${size} byte non request-backed stream-fragment candidate with ${opcodeLikeBytes} opcode-like byte(s) and ${terminators} terminator byte(s).`,
    });
  }
  return Object.assign(common, {
    kind: 'unclassified_audio_adjacent_fragment',
    confidence: 'low',
    status: 'experimental',
    likelyStandaloneMusicStream: false,
    recommendedAction: 'Trace caller ownership before assigning a stronger audio role.',
    summary: `${size} byte non request-backed audio-adjacent fragment.`,
  });
}

function wb3BuildUnlinkedMusicTimelinePreview(rom, region, map, options) {
  const timeline = wb3ParseMusicStreamTimeline(rom, region?.offset, map, Object.assign({}, options, {
    musicTimelineEventLimit: options.musicUnlinkedTimelineEventLimit || options.musicTimelineEventLimit || 128,
    musicTimelineByteLimit: options.musicUnlinkedTimelineByteLimit || Math.max(32, Number(region?.size || 0) + 8),
  }));
  return {
    kind: 'unlinked_music_stream_shape_timeline',
    regionId: region?.id || '',
    offset: region?.offset || '',
    startOffsetHex: timeline.startOffsetHex || '',
    endReason: timeline.endReason || '',
    stats: timeline.stats || {},
    warnings: wb3DecoderArray(timeline.warnings),
    events: wb3DecoderArray(timeline.events).slice(0, options.musicUnlinkedTimelineRenderedEventLimit || options.musicTimelineRenderedEventLimit || 32),
    assetPolicy: 'Transient local-ROM preview only: event roles, offsets, frame counts, note labels and opcode names. Do not persist stream bytes, opcode bytes, samples or PSG/FM values.',
  };
}

function wb3DecodeMusicRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const size = Number(region.size || 0);
  const previewSize = Math.min(size, options.musicScanLimit || 256);
  let notes = 0;
  let opcodes = 0;
  let terminators = 0;
  for (let i = 0; i < previewSize && offset + i < rom.length; i++) {
    const b = rom[offset + i];
    if (b === 0xff) terminators++;
    else if (b >= 0xf0) opcodes++;
    else notes++;
  }
  const audioCatalog = wb3FindAudioCatalog(map, 'world-audio-catalog-2026-06-24');
  const graphCatalog = wb3FindAudioCatalog(map, 'world-audio-stream-graph-catalog-2026-06-25');
  const opcodeCatalog = wb3FindAudioCatalog(map, 'world-audio-opcode-state-effect-catalog-2026-06-25');
  const songs = wb3DecoderArray(audioCatalog?.songs).filter(song => wb3AudioSongMatchesRegion(song, region));
  const streams = wb3DecoderArray(audioCatalog?.streams).filter(stream => wb3AudioStreamMatchesRegion(stream, region));
  const graphRequestIds = new Set(songs.map(song => Number(song.index)));
  const graphs = wb3DecoderArray(graphCatalog?.graphs).filter(graph => (
    wb3AudioGraphMatchesRegion(graph, region) || graphRequestIds.has(Number(graph.requestId))
  ));
  if (songs.length || streams.length || graphs.length) {
    const opcodeTotals = {};
    const classificationCounts = {};
    for (const stream of streams) wb3MergeCountMap(opcodeTotals, stream.opcodeCounts);
    for (const graph of graphs) {
      wb3MergeCountMap(opcodeTotals, graph.opcodeTotals);
      const kind = graph.classification?.kind || 'unclassified';
      classificationCounts[kind] = (classificationCounts[kind] || 0) + 1;
    }
    const branchEdgeCount = graphs.reduce((sum, graph) => sum + Number(graph.branchEdgeCount || 0), 0);
    const reachableStreamCount = graphs.reduce((sum, graph) => sum + Number(graph.reachableStreamCount || 0), 0);
    const warningCount = songs.reduce((sum, song) => sum + wb3DecoderArray(song.warnings).length + wb3DecoderArray(song.header?.warnings).length, 0)
      + streams.reduce((sum, stream) => sum + wb3DecoderArray(stream.warnings).length, 0);
    const timelinePreview = wb3BuildMusicTimelinePreview(rom, songs, map, options);
    const channelLaneState = timelinePreview.channelLaneState;
    const pitchDurationBinding = wb3BuildMusicPitchDurationBindingModel(rom, channelLaneState, options);
    const opcodeParameterState = timelinePreview.opcodeParameterState;
    const channelStateSeed = wb3BuildMusicRequestChannelStateSeed(rom, songs, graphs, map, options);
    const runtimeOutputModel = wb3BuildAudioRuntimeOutputFixtureEventModel(map, options);
    return wb3MakeDecodeResult(decoder, asset, region, 'partial',
      `${songs.length} request header(s), ${streams.length} stream segment(s), ${graphs.length} request graph(s), ${branchEdgeCount} branch edge(s), ${channelLaneState.summary.laneCount} channel lane(s), ${pitchDurationBinding.summary.noteIndexCount} bound note index(es), ${pitchDurationBinding.summary.durationSelectorCount} bound duration selector(s), ${opcodeParameterState.summary.parameterMutationEventCount} opcode parameter mutation(s), ${channelStateSeed.aggregate.channelSeedCount} channel seed(s), ${timelinePreview.aggregate.eventCount} timeline event(s), runtime output harness ${runtimeOutputModel.validation.readyForRuntimeHarness ? 'ready' : 'not ready'}.`,
      {
        offset,
        size,
        scannedBytes: previewSize,
        noteLikeBytes: notes,
        opcodeLikeBytes: opcodes,
        terminators,
        requestHeaderCount: songs.length,
        streamSegmentCount: streams.length,
        requestGraphCount: graphs.length,
        reachableStreamCount,
        branchEdgeCount,
        warningCount,
        timelineCount: timelinePreview.aggregate.timelineCount,
        timelineEventCount: timelinePreview.aggregate.eventCount,
        timelineNoteEventCount: timelinePreview.aggregate.noteEventCount,
        timelineRestEventCount: timelinePreview.aggregate.restEventCount,
        timelineDurationCommandCount: timelinePreview.aggregate.durationCommandCount,
        timelineOpcodeEventCount: timelinePreview.aggregate.opcodeEventCount,
        musicChannelLaneCount: channelLaneState.summary.laneCount,
        musicChannelPlayableLaneCount: channelLaneState.summary.playableLaneCount,
        musicChannelExactPsgFmStateLaneCount: channelLaneState.summary.exactPsgFmStateLaneCount,
        musicChannelNoteSegmentCount: channelLaneState.summary.noteSegmentCount,
        musicChannelRestSegmentCount: channelLaneState.summary.restSegmentCount,
        musicChannelSpecialSegmentCount: channelLaneState.summary.specialSegmentCount,
        musicChannelActiveFrameCount: channelLaneState.summary.activeFrameCount,
        musicChannelRestFrameCount: channelLaneState.summary.restFrameCount,
        musicChannelMaxFrameCount: channelLaneState.summary.maxFrameCount,
        musicChannelDurationSelectorCount: channelLaneState.summary.durationSelectorCount,
        musicChannelNoteIndexCount: channelLaneState.summary.noteIndexCount,
        musicChannelPitchClassCount: channelLaneState.summary.pitchClassCount,
        musicChannelOctaveStepCount: channelLaneState.summary.octaveStepCount,
        musicChannelOpcodeKindCount: channelLaneState.summary.opcodeKindCount,
        musicChannelBranchTargetRefCount: channelLaneState.summary.branchTargetRefCount,
        musicChannelNoteLabelCount: channelLaneState.summary.noteLabelCount,
        musicChannelNoteRange: channelLaneState.summary.noteRange,
        musicPitchDurationBindingNoteIndexCount: pitchDurationBinding.summary.noteIndexCount,
        musicPitchDurationBindingNoteEventCount: pitchDurationBinding.summary.noteEventCount,
        musicPitchDurationBindingPitchClassCount: pitchDurationBinding.summary.pitchClassCount,
        musicPitchDurationBindingOctaveStepCount: pitchDurationBinding.summary.octaveStepCount,
        musicPitchDurationBindingDurationSelectorCount: pitchDurationBinding.summary.durationSelectorCount,
        musicPitchDurationBindingDurationResolvedSelectorCount: pitchDurationBinding.summary.durationResolvedSelectorCount,
        musicPitchDurationBindingDurationUnresolvedSelectorCount: pitchDurationBinding.summary.durationUnresolvedSelectorCount,
        musicPitchDurationBindingPsgPointerEntryCandidateCount: pitchDurationBinding.summary.psgPointerEntryCandidateCount,
        musicPitchDurationBindingPsgPointerEntryResolvedCount: pitchDurationBinding.summary.psgPointerEntryResolvedCount,
        musicPitchDurationBindingPsgPitchRowResolvedCount: pitchDurationBinding.summary.psgPitchRowResolvedCount,
        musicPitchDurationBindingPsgPitchRowWordCandidateCount: pitchDurationBinding.summary.psgPitchRowWordCandidateCount,
        musicPitchDurationBindingPsgBasePeriodCandidateCount: pitchDurationBinding.summary.psgBasePeriodCandidateCount,
        musicPitchDurationBindingFmPointerEntryCandidateCount: pitchDurationBinding.summary.fmPointerEntryCandidateCount,
        musicPitchDurationBindingFmPointerEntryResolvedCount: pitchDurationBinding.summary.fmPointerEntryResolvedCount,
        musicPitchDurationBindingFmPitchRowResolvedCount: pitchDurationBinding.summary.fmPitchRowResolvedCount,
        musicPitchDurationBindingFmPitchRowWordCandidateCount: pitchDurationBinding.summary.fmPitchRowWordCandidateCount,
        musicPitchDurationBindingFmBaseRegisterWordCandidateCount: pitchDurationBinding.summary.fmBaseRegisterWordCandidateCount,
        musicPitchDurationBindingTransientPitchValueCandidateCount: pitchDurationBinding.summary.transientPitchValueCandidateCount,
        musicPitchDurationBindingExactPitchPeriodValueCount: pitchDurationBinding.summary.exactPitchPeriodValueCount,
        musicPitchDurationBindingExactPsgFmStateReady: pitchDurationBinding.summary.exactPsgFmStateReady,
        musicOpcodeParameterStateLaneCount: opcodeParameterState.summary.laneCount,
        musicOpcodeParameterStateOpcodeEventCount: opcodeParameterState.summary.opcodeEventCount,
        musicOpcodeParameterStateOperandBearingOpcodeEventCount: opcodeParameterState.summary.operandBearingOpcodeEventCount,
        musicOpcodeParameterStateOperandByteCount: opcodeParameterState.summary.operandByteCount,
        musicOpcodeParameterStateParameterMutationEventCount: opcodeParameterState.summary.parameterMutationEventCount,
        musicOpcodeParameterStatePotentialPitchOrEnvelopeMutationEventCount: opcodeParameterState.summary.potentialPitchOrEnvelopeMutationEventCount,
        musicOpcodeParameterStateInstrumentOrEffectSelectEventCount: opcodeParameterState.summary.instrumentOrEffectSelectEventCount,
        musicOpcodeParameterStateRepeatControlEventCount: opcodeParameterState.summary.repeatControlEventCount,
        musicOpcodeParameterStatePointerControlEventCount: opcodeParameterState.summary.pointerControlEventCount,
        musicOpcodeParameterStateSharedFlowControlEventCount: opcodeParameterState.summary.sharedFlowControlEventCount,
        musicOpcodeParameterStateExactParameterTargetFieldCount: opcodeParameterState.summary.exactParameterTargetFieldCount,
        musicOpcodeParameterStateExactFramePsgFmStateReady: opcodeParameterState.summary.exactFramePsgFmStateReady,
        channelStateSeedRequestCount: channelStateSeed.aggregate.requestSeedCount,
        channelStateSeedCount: channelStateSeed.aggregate.channelSeedCount,
        channelStateValidStreamPointerCount: channelStateSeed.aggregate.validStreamPointerCount,
        channelStateUnresolvedStreamPointerCount: channelStateSeed.aggregate.unresolvedStreamPointerCount,
        channelStateTimelineCount: channelStateSeed.aggregate.timelineCount,
        channelStateTimelineEventCount: channelStateSeed.aggregate.timelineEventCount,
        channelStateBranchEdgeCount: channelStateSeed.aggregate.branchEdgeCount,
        channelStateReachableStreamCount: channelStateSeed.aggregate.reachableStreamCount,
        runtimeOutputEventCount: runtimeOutputModel.sink.summary.eventCount,
        runtimeOutputWriteEventCount: runtimeOutputModel.sink.summary.writeEventCount,
        runtimeOutputFrameCount: runtimeOutputModel.frameTimeline.summary.frameCount,
        runtimeOutputChannelPortGroupCount: runtimeOutputModel.channelPortIntent.summary.groupCount,
        runtimeOutputPsgWriteEventCount: runtimeOutputModel.channelPortIntent.summary.psgWriteEventCount,
        runtimeOutputFmWriteEventCount: runtimeOutputModel.channelPortIntent.summary.fmWriteEventCount,
        runtimeOutputReadyForHarness: runtimeOutputModel.validation.readyForRuntimeHarness,
        runtimeOutputValidationIssueCount: runtimeOutputModel.validation.validationIssueCount,
        topOpcodeCounts: wb3TopCountMap(opcodeTotals, 16),
        classificationCounts,
        sourceCatalogIds: [audioCatalog?.id, graphCatalog?.id, opcodeCatalog?.id].filter(Boolean),
      },
      ['Audible playback remains approximate until exact PSG/FM channel state, envelopes, pitch tables and output-port timing are implemented.'],
      options.includeTransientPreview ? {
        kind: 'music_request_streams',
        songs: songs.slice(0, options.musicRequestPreviewLimit || 32).map(song => wb3TrimAudioSong(song, options.musicChannelPreviewLimit || 16)),
        streams: streams.slice(0, options.musicStreamPreviewLimit || 96).map(stream => wb3TrimAudioStream(stream, options.musicBranchPreviewLimit || 24)),
        graphs: graphs.slice(0, options.musicGraphPreviewLimit || 32).map(graph => wb3TrimAudioGraph(graph, options.musicGraphStreamPreviewLimit || 24, options.musicBranchPreviewLimit || 24)),
        timelines: timelinePreview.timelines,
	        musicChannelLaneState: {
	          kind: channelLaneState.kind,
	          summary: channelLaneState.summary,
	          lanes: channelLaneState.lanes.slice(0, options.musicLanePreviewLimit || 32),
	          semantics: channelLaneState.semantics,
	          assetPolicy: channelLaneState.assetPolicy,
	        },
	        musicPitchDurationBinding: {
	          kind: pitchDurationBinding.kind,
	          supportTables: pitchDurationBinding.supportTables,
	          summary: pitchDurationBinding.summary,
	          durationSelectors: pitchDurationBinding.durationSelectors,
	          noteBindings: pitchDurationBinding.noteBindings,
	          pitchClassBindings: pitchDurationBinding.pitchClassBindings,
	          semantics: pitchDurationBinding.semantics,
	          assetPolicy: pitchDurationBinding.assetPolicy,
	        },
	        musicOpcodeParameterState: {
	          kind: opcodeParameterState.kind,
	          summary: opcodeParameterState.summary,
	          lanes: opcodeParameterState.lanes,
	          semantics: opcodeParameterState.semantics,
	          assetPolicy: opcodeParameterState.assetPolicy,
	        },
	        requestChannelStateProbe: channelStateSeed,
	        runtimeOutputModel: {
	          kind: runtimeOutputModel.kind,
	          sourceCatalogIds: runtimeOutputModel.sourceCatalogIds,
	          eventContract: runtimeOutputModel.eventContract,
	          sink: { summary: runtimeOutputModel.sink.summary },
	          frameTimeline: { summary: runtimeOutputModel.frameTimeline.summary, frames: runtimeOutputModel.frameTimeline.frames.slice(0, options.audioRuntimeOutputFramePreviewLimit || 24) },
	          registerIntent: { summary: runtimeOutputModel.registerIntent.summary, frames: runtimeOutputModel.registerIntent.frames.slice(0, options.audioRuntimeOutputRegisterIntentPreviewLimit || 24) },
	          channelPortIntent: { summary: runtimeOutputModel.channelPortIntent.summary, groups: runtimeOutputModel.channelPortIntent.groups.slice(0, options.audioRuntimeOutputChannelPortPreviewLimit || 24) },
	          validation: runtimeOutputModel.validation,
	          assetPolicy: runtimeOutputModel.assetPolicy,
	        },
	        aggregate: {
          requestHeaderCount: songs.length,
          streamSegmentCount: streams.length,
          requestGraphCount: graphs.length,
          reachableStreamCount,
          branchEdgeCount,
          channelStateSeed: channelStateSeed.aggregate,
          noteLikeBytes: notes,
          opcodeLikeBytes: opcodes,
          terminators,
          timeline: timelinePreview.aggregate,
	          musicChannelLaneState: channelLaneState.summary,
	          musicPitchDurationBinding: pitchDurationBinding.summary,
	          musicOpcodeParameterState: opcodeParameterState.summary,
	          runtimeOutput: {
	            eventCount: runtimeOutputModel.sink.summary.eventCount,
	            writeEventCount: runtimeOutputModel.sink.summary.writeEventCount,
	            frameCount: runtimeOutputModel.frameTimeline.summary.frameCount,
	            channelPortGroupCount: runtimeOutputModel.channelPortIntent.summary.groupCount,
	            psgWriteEventCount: runtimeOutputModel.channelPortIntent.summary.psgWriteEventCount,
	            fmWriteEventCount: runtimeOutputModel.channelPortIntent.summary.fmWriteEventCount,
	            readyForRuntimeHarness: runtimeOutputModel.validation.readyForRuntimeHarness,
	            validationIssueCount: runtimeOutputModel.validation.validationIssueCount,
	          },
	          topOpcodeCounts: wb3TopCountMap(opcodeTotals, 24),
          classificationCounts,
          catalogSummary: {
            songEntries: audioCatalog?.summary?.songEntries || 0,
            parsedStreamSegments: audioCatalog?.summary?.parsedStreamSegments || 0,
            requestGraphCount: graphCatalog?.summary?.requestGraphCount || 0,
            opcodeCount: opcodeCatalog?.summary?.opcodeCount || 0,
          },
        },
        semantics: {
          requestTable: '_DATA_D139_',
          requestTableOffset: '0x0D139',
          requestCount: 62,
          bankContext: 'bank 3 / Z80 $8000-$BFFF',
          streamPointerOpcodes: '$F6 call_stream_pointer, $FA jump_stream_pointer',
          driverRoutines: '_LABEL_C04D_ immediate request loader, _LABEL_C09F_ queued request loader',
          streamByteRoles: '_LABEL_C191_ treats $80-$EF as duration/parameter commands, $F0-$FF as control opcodes, and low-bit7 bytes as note/rest events.',
          durationLookup: 'Duration command selectors are resolved transiently through the Z80 $BE44 lookup path observed in _LABEL_C191_; values are not persisted.',
          pitchLookup: 'Pitch binding uses _LABEL_C2BD_ note-index semantics plus _LABEL_C56A_ PSG $8A85 and _LABEL_C928_ FM $8C1D support-table offsets; exact period/register values are not persisted or claimed complete.',
        },
      } : null);
  }
  const classification = wb3ClassifyNonRequestBackedMusicRegion(region, {
    size,
    noteLikeBytes: notes,
    opcodeLikeBytes: opcodes,
    terminators,
  });
  const unlinkedTimeline = classification.likelyStandaloneMusicStream
    ? wb3BuildUnlinkedMusicTimelinePreview(rom, region, map, options)
    : null;
  return wb3MakeDecodeResult(decoder, asset, region, classification.status,
    unlinkedTimeline
      ? `${classification.summary} Timeline probe consumed ${unlinkedTimeline.stats.consumedBytes || 0} byte(s), ${unlinkedTimeline.stats.eventCount || 0} event(s), end=${unlinkedTimeline.endReason}.`
      : classification.summary,
    {
      offset,
      size,
      scannedBytes: previewSize,
      noteLikeBytes: notes,
      opcodeLikeBytes: opcodes,
      terminators,
      requestBacked: false,
      nonRequestBackedMusicClass: classification.kind,
      classificationConfidence: classification.confidence,
      likelyStandaloneMusicStream: classification.likelyStandaloneMusicStream,
      confirmedStreamReference: classification.confirmedStreamReference === true,
      recommendedLabelAction: classification.recommendedAction,
      bank: classification.bank,
      falseDwRejectedPointerCount: classification.falseDwTargetShape?.rejectedPointerCount || 0,
      falseDwTargetShapeCount: wb3DecoderArray(classification.falseDwTargetShape?.shapeParses).length,
      falseDwActualStreamOffsets: wb3DecoderArray(classification.falseDwTargetShape?.rejectedPointers).map(pointer => pointer.actualStreamOffset).filter(Boolean),
      unlinkedTimelineEventCount: unlinkedTimeline?.stats?.eventCount || 0,
      unlinkedTimelineNoteEventCount: unlinkedTimeline?.stats?.noteEventCount || 0,
      unlinkedTimelineRestEventCount: unlinkedTimeline?.stats?.restEventCount || 0,
      unlinkedTimelineDurationCommandCount: unlinkedTimeline?.stats?.durationCommandCount || 0,
      unlinkedTimelineOpcodeEventCount: unlinkedTimeline?.stats?.opcodeEventCount || 0,
      unlinkedTimelineFrameCount: unlinkedTimeline?.stats?.frameCount || 0,
      unlinkedTimelineConsumedBytes: unlinkedTimeline?.stats?.consumedBytes || 0,
      unlinkedTimelineEndReason: unlinkedTimeline?.endReason || '',
      unlinkedTimelineWarningCount: wb3DecoderArray(unlinkedTimeline?.warnings).length,
    },
    [
      'No request/header/stream graph currently links this music-typed region.',
      classification.recommendedAction,
    ],
    options.includeTransientPreview ? {
      kind: 'music_unlinked_region_probe',
      offset,
      scannedBytes: previewSize,
      classification,
      unlinkedTimeline,
      assetPolicy: 'Metadata only: classification kind, counts, offsets and evidence. No ROM bytes, stream bytes or audio samples are exposed.',
    } : null);
}

function wb3ByteClassStats(bytes) {
  let zeroBytes = 0;
  let ffBytes = 0;
  let printableAsciiBytes = 0;
  let spaceBytes = 0;
  let highBitBytes = 0;
  let controlBytes = 0;
  const histogram = {};
  for (const byte of bytes || []) {
    histogram[byte] = (histogram[byte] || 0) + 1;
    if (byte === 0) zeroBytes++;
    if (byte === 0xff) ffBytes++;
    if (byte === 0x20) spaceBytes++;
    if (byte >= 0x20 && byte <= 0x7e) printableAsciiBytes++;
    if (byte >= 0x80) highBitBytes++;
    if (byte < 0x20 && byte !== 0) controlBytes++;
  }
  const size = bytes?.length || 0;
  return {
    size,
    zeroBytes,
    nonZeroBytes: size - zeroBytes,
    ffBytes,
    printableAsciiBytes,
    spaceBytes,
    highBitBytes,
    controlBytes,
    zeroRatio: size ? zeroBytes / size : 0,
    printableAsciiRatio: size ? printableAsciiBytes / size : 0,
    distinctByteCount: Object.keys(histogram).length,
  };
}

function wb3TextClassFromStats(stats) {
  if (!stats.size) return 'empty';
  if (stats.zeroBytes === stats.size) return 'zero_padding';
  if (stats.printableAsciiBytes === stats.size) return 'printable_ascii';
  if (stats.highBitBytes === 0 && stats.printableAsciiRatio >= 0.7) return 'mostly_printable_ascii';
  if (stats.printableAsciiRatio >= 0.3) return 'mixed_printable_control';
  return 'binary_or_encoded_text';
}

function wb3TextPreviewString(bytes, limit) {
  const chars = [];
  const capped = Math.min(bytes.length, limit || 256);
  for (let i = 0; i < capped; i++) {
    const b = bytes[i];
    if (b >= 0x20 && b <= 0x7e) chars.push(String.fromCharCode(b));
    else if (b === 0x00) chars.push('·');
    else if (b === 0x0a) chars.push('\n');
    else if (b === 0x0d) continue;
    else chars.push(`[${b.toString(16).toUpperCase().padStart(2, '0')}]`);
  }
  if (bytes.length > capped) chars.push('...');
  return chars.join('');
}

function wb3DecodeTextRegion(asset, region, rom, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const bytes = wb3RegionBytes(rom, region);
  if (!bytes) return wb3MakeDecodeResult(decoder, asset, region, 'needs_rom', 'Load the local ROM to decode this text region.', {}, [], null);
  const stats = wb3ByteClassStats(bytes);
  const textClass = wb3TextClassFromStats(stats);
  const warnings = [];
  if (textClass === 'binary_or_encoded_text') warnings.push('Printable ratio is low; this may be encoded text, a marker, or mixed binary data.');
  const summary = `${textClass}; ${Math.round(stats.printableAsciiRatio * 100)}% printable ASCII, ${stats.zeroBytes} zero byte(s), ${stats.distinctByteCount} distinct byte(s).`;
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    summary,
    {
      offset,
      size: stats.size,
      contentClass: textClass,
      printableAsciiBytes: stats.printableAsciiBytes,
      printableAsciiRatio: stats.printableAsciiRatio,
      zeroBytes: stats.zeroBytes,
      controlBytes: stats.controlBytes,
      highBitBytes: stats.highBitBytes,
      distinctByteCount: stats.distinctByteCount,
    },
    warnings,
    options.includeTransientPreview ? {
      kind: 'text_ascii',
      textClass,
      previewText: wb3TextPreviewString(bytes, options.textPreviewLimit || 256),
      stats,
    } : null);
}

function wb3FindDc2ScrollMapCatalog(map) {
  return wb3DecoderArray(map?.roomDataCatalogs)
    .find(catalog => catalog?.id === 'world-dc2-scroll-map-catalog-2026-06-25') || null;
}

function wb3FindDc2TilePairLookupCatalog(map) {
  return wb3DecoderArray(map?.roomDataCatalogs)
    .find(catalog => catalog?.id === 'world-dc2-tile-pair-lookup-catalog-2026-06-25') || null;
}

function wb3Dc2Bank5Z80ToRom(z80Pointer) {
  return z80Pointer == null ? null : z80Pointer + 0xC000;
}

function wb3Dc2CatalogEntryForRegion(map, region) {
  const offset = wb3DecoderParseOffset(region?.offset);
  const catalog = wb3FindDc2ScrollMapCatalog(map);
  if (offset == null) return null;
  return wb3DecoderArray(catalog?.entries)
    .find(entry => wb3DecoderParseOffset(entry?.romOffset) === offset) || null;
}

function wb3DecodeDc2StreamStructure(rom, offset, options) {
  options = options || {};
  const rows = 11;
  const columns = 16;
  const expectedCells = rows * columns;
  const maxBytes = options.dc2StreamByteLimit || 1024;
  const maxOps = options.dc2StreamOpcodeLimit || 512;
  const commandPreviewLimit = options.dc2CommandPreviewLimit == null ? 96 : options.dc2CommandPreviewLimit;
  const warnings = [];
  const commands = [];
  const opCounts = { direct: 0, shortRun: 0, extendedRun: 0, terminator: 0 };
  let pc = offset;
  let row = 0;
  let column = 0;
  let writtenCells = 0;
  let opCount = 0;
  let maxRunLength = 0;
  let endReason = 'limit';

  function writeCells(count) {
    const startCell = writtenCells;
    for (let i = 0; i < count; i++) {
      writtenCells++;
      column++;
      if (column >= columns) {
        column = 0;
        row++;
      }
      if (row >= rows) return { complete: true, startCell, endCellExclusive: writtenCells };
    }
    return { complete: false, startCell, endCellExclusive: writtenCells };
  }

  function pushCommand(command) {
    if (commands.length < commandPreviewLimit) commands.push(command);
  }

  decodeLoop:
  while (pc < rom.length && pc - offset < maxBytes && opCount < maxOps && row < rows) {
    const commandOffset = pc;
    const command = rom[pc++];
    opCount++;

    if (command === 0xFF) {
      if (pc >= rom.length) {
        warnings.push(`Truncated DC2 extended opcode at ${wb3DecoderHex(commandOffset)}.`);
        endReason = 'truncated';
        break;
      }
      const countOrTerminator = rom[pc++];
      if (countOrTerminator === 0xFF) {
        opCounts.terminator++;
        endReason = 'ff-ff-terminator';
        pushCommand({
          offsetHex: wb3DecoderHex(commandOffset),
          kind: 'terminator',
          encodedCellCount: 0,
          outputStartCell: writtenCells,
          outputEndCellExclusive: writtenCells,
        });
        break;
      }
      if (pc >= rom.length) {
        warnings.push(`Truncated DC2 extended run at ${wb3DecoderHex(commandOffset)}.`);
        endReason = 'truncated';
        break;
      }
      pc++;
      opCounts.extendedRun++;
      maxRunLength = Math.max(maxRunLength, countOrTerminator);
      const written = writeCells(countOrTerminator);
      pushCommand({
        offsetHex: wb3DecoderHex(commandOffset),
        kind: 'extended_run',
        encodedCellCount: countOrTerminator,
        outputStartCell: written.startCell,
        outputEndCellExclusive: written.endCellExclusive,
      });
      if (written.complete) {
        endReason = 'row-budget';
        break decodeLoop;
      }
      continue;
    }

    if (command >= 0xE3) {
      if (pc >= rom.length) {
        warnings.push(`Truncated DC2 short run at ${wb3DecoderHex(commandOffset)}.`);
        endReason = 'truncated';
        break;
      }
      pc++;
      const count = command - 0xE0;
      opCounts.shortRun++;
      maxRunLength = Math.max(maxRunLength, count);
      const written = writeCells(count);
      pushCommand({
        offsetHex: wb3DecoderHex(commandOffset),
        kind: 'short_run',
        encodedCellCount: count,
        outputStartCell: written.startCell,
        outputEndCellExclusive: written.endCellExclusive,
      });
      if (written.complete) {
        endReason = 'row-budget';
        break decodeLoop;
      }
      continue;
    }

    opCounts.direct++;
    const written = writeCells(1);
    pushCommand({
      offsetHex: wb3DecoderHex(commandOffset),
      kind: 'direct',
      encodedCellCount: 1,
      outputStartCell: written.startCell,
      outputEndCellExclusive: written.endCellExclusive,
    });
    if (written.complete) {
      endReason = 'row-budget';
      break;
    }
  }

  if (pc >= rom.length && endReason === 'limit') warnings.push(`DC2 stream reached end of ROM from ${wb3DecoderHex(offset)}.`);
  if (opCount >= maxOps && endReason === 'limit') warnings.push(`DC2 stream exceeded opcode limit from ${wb3DecoderHex(offset)}.`);
  if (pc - offset >= maxBytes && endReason === 'limit') warnings.push(`DC2 stream exceeded byte limit from ${wb3DecoderHex(offset)}.`);
  if (writtenCells !== expectedCells) warnings.push(`DC2 stream wrote ${writtenCells} cells, expected ${expectedCells}.`);

  return {
    offset,
    offsetHex: wb3DecoderHex(offset),
    runtimeConsumedBytes: pc - offset,
    writtenCells,
    rows,
    columns,
    expectedCells,
    endReason,
    opCount,
    opCounts,
    maxRunLength,
    finalPosition: { row, column },
    commandPreviewCount: commands.length,
    commands,
    warnings,
  };
}

function wb3BuildDc2TableProbe(rom, map, options) {
  options = options || {};
  const catalog = wb3FindDc2ScrollMapCatalog(map);
  const tableOffset = wb3DecoderParseOffset(catalog?.pointerTable?.offset) ?? 0x14000;
  const entryCount = Number(catalog?.pointerTable?.entryCount || catalog?.bankContext?.pointerTableEntryCount || 176);
  const previewLimit = options.dc2TableEntryPreviewLimit || 48;
  const rows = [];
  const opTotals = { direct: 0, shortRun: 0, extendedRun: 0, terminator: 0 };
  const endReasonCounts = {};
  let validStreamCount = 0;
  let warningStreamCount = 0;
  let totalRuntimeConsumedBytes = 0;
  let totalWrittenCells = 0;
  let maxRunLength = 0;
  for (let index = 0; index < entryCount; index++) {
    const entryOffset = tableOffset + index * 2;
    const z80Pointer = wb3ReadWordLE(rom, entryOffset);
    const streamOffset = wb3Dc2Bank5Z80ToRom(z80Pointer);
    const decoded = streamOffset == null ? null : wb3DecodeDc2StreamStructure(rom, streamOffset, Object.assign({}, options, { dc2CommandPreviewLimit: 0 }));
    const catalogEntry = wb3DecoderArray(catalog?.entries).find(entry => Number(entry?.index) === index) || null;
    const targetRegion = streamOffset == null ? null : wb3FindRegionAtOffset(map, streamOffset);
    if (decoded) {
      totalRuntimeConsumedBytes += decoded.runtimeConsumedBytes;
      totalWrittenCells += decoded.writtenCells;
      maxRunLength = Math.max(maxRunLength, decoded.maxRunLength || 0);
      if (decoded.warnings.length) warningStreamCount++;
      else validStreamCount++;
      endReasonCounts[decoded.endReason] = (endReasonCounts[decoded.endReason] || 0) + 1;
      for (const key of Object.keys(opTotals)) opTotals[key] += decoded.opCounts[key] || 0;
    } else {
      warningStreamCount++;
    }
    if (rows.length < previewLimit) {
      rows.push({
        index,
        indexHex: wb3DecoderHex(index, 2),
        tableEntryOffsetHex: wb3DecoderHex(entryOffset),
        z80PointerHex: z80Pointer == null ? null : wb3DecoderHex(z80Pointer, 4),
        romOffsetHex: streamOffset == null ? null : wb3DecoderHex(streamOffset),
        regionId: targetRegion?.id || catalogEntry?.targetRegion?.id || '',
        regionName: targetRegion?.name || catalogEntry?.targetRegion?.name || '',
        runtimeConsumedBytes: decoded?.runtimeConsumedBytes ?? null,
        writtenCells: decoded?.writtenCells ?? null,
        endReason: decoded?.endReason || 'unresolved',
        opCounts: decoded?.opCounts || {},
        warningCount: decoded?.warnings.length ?? 1,
        descriptorCount: catalogEntry?.usage?.descriptorCount ?? null,
        streamSlots: wb3DecoderArray(catalogEntry?.usage?.streamSlots),
      });
    }
  }
  return {
    kind: 'dc2_pointer_table',
    catalogId: catalog?.id || '',
    tableOffsetHex: wb3DecoderHex(tableOffset),
    entryCount,
    previewRowCount: rows.length,
    validStreamCount,
    warningStreamCount,
    totalRuntimeConsumedBytes,
    totalWrittenCells,
    opTotals,
    endReasonCounts,
    maxRunLength,
    rows,
    assetPolicy: 'Local-ROM DC2 pointer-table probe. It reports offsets, counts, stream structure and catalog usage only; decoded cell values are not stored or displayed.',
  };
}

function wb3BuildDc2StreamProbe(rom, map, region, options) {
  const offset = wb3DecoderParseOffset(region?.offset);
  if (offset == null) return null;
  const catalogEntry = wb3Dc2CatalogEntryForRegion(map, region);
  const decoded = wb3DecodeDc2StreamStructure(rom, offset, options);
  return {
    kind: 'dc2_stream',
    catalogId: catalogEntry?.usage?.zoneGraphId ? 'world-dc2-scroll-map-catalog-2026-06-25' : '',
    tableIndexHex: catalogEntry?.indexHex || wb3DecoderObject(region?.analysis?.dc2ScrollMapAudit).tableIndex || '',
    tableEntryOffsetHex: catalogEntry?.tableEntryOffset || wb3DecoderObject(region?.analysis?.dc2ScrollMapAudit).tableEntryOffset || '',
    z80PointerHex: catalogEntry?.z80Pointer || wb3DecoderObject(region?.analysis?.dc2ScrollMapAudit).z80Pointer || '',
    descriptorCount: catalogEntry?.usage?.descriptorCount ?? wb3DecoderObject(region?.analysis?.dc2ScrollMapAudit).usage?.descriptorCount ?? null,
    streamSlots: wb3DecoderArray(catalogEntry?.usage?.streamSlots || wb3DecoderObject(region?.analysis?.dc2ScrollMapAudit).usage?.streamSlots),
    decoded,
    assetPolicy: 'Local-ROM DC2 stream probe. It reports command structure, run lengths and output cell counts only; decoded collision cell values are not stored or displayed.',
  };
}

function wb3BuildDc2ProbeForRegion(rom, map, region, options) {
  if (!rom || !region) return null;
  const analysis = wb3DecoderObject(region.analysis);
  const dc2Audit = wb3DecoderObject(analysis.dc2ScrollMapAudit);
  const dc2LookupAudit = wb3DecoderObject(analysis.dc2TilePairLookupAudit);
  if (dc2Audit.kind === 'dc2_scroll_map_pointer_table') return wb3BuildDc2TableProbe(rom, map, options);
  if (dc2Audit.kind === 'dc2_compressed_scroll_map_stream') return wb3BuildDc2StreamProbe(rom, map, region, options);
  if (dc2Audit.kind === 'dc2_scroll_map_decompressor') return wb3BuildDc2TableProbe(rom, map, options);
  if (dc2LookupAudit.kind) {
    const catalog = wb3FindDc2TilePairLookupCatalog(map);
    return {
      kind: 'dc2_tile_pair_lookup',
      catalogId: catalog?.id || '',
      lookupOffset: catalog?.lookup?.offset || dc2LookupAudit.lookupOffset || '',
      recordCount: catalog?.lookup?.recordCount || null,
      recordStride: catalog?.lookup?.recordStride || null,
      uniqueLookupRecordIndicesUsed: catalog?.summary?.uniqueLookupRecordIndicesUsed ?? null,
      outOfRangeCellCount: catalog?.summary?.outOfRangeCellCount ?? null,
      dc2StreamsDecoded: catalog?.summary?.dc2StreamsDecoded ?? null,
      warningStreamCount: catalog?.summary?.warningStreamCount ?? null,
      assetPolicy: 'Local-ROM tile-pair lookup bridge summary only. Name-table words and decoded cell values are not stored or displayed.',
    };
  }
  return null;
}

function wb3CollisionCatalogBackedStructuralRole(region, analysisEntries, catalogEntries, recipeCount) {
  if (!region || region.type === 'code') return '';
  const type = region.type || '';
  const evidenceText = [
    region.name,
    ...Object.keys(wb3DecoderObject(region.analysis)),
    ...wb3DecoderArray(analysisEntries).map(entry => `${entry.key} ${entry.kind} ${entry.role} ${entry.summary}`),
    ...wb3DecoderArray(catalogEntries).map(entry => `${entry.arrayName} ${entry.role} ${entry.summary}`),
  ].join(' ');
  if ((type === 'room_seq_table' || type === 'room_data') && /zoneCollisionRecipe|recipeCollisionSummaries|zone_collision_recipe/i.test(evidenceText) && Number(recipeCount || 0) > 0) {
    return type === 'room_seq_table' ? 'zone_collision_sequence_table' : 'zone_collision_recipe_source';
  }
  return '';
}

function wb3CollisionDecodeReadiness(region, decoded, dc2Probe, dc2WarningCount, catalogBackedRole, sourceHookCount, hookFixtureCount) {
  if (decoded) return 'decoded_structural';
  if (dc2WarningCount > 0) return 'local_validation_warning';
  if (region?.type === 'code') {
    if (sourceHookCount || hookFixtureCount) return 'runtime_trace_effects_required';
    return 'routine_semantics_required';
  }
  if (catalogBackedRole) return 'catalog_backed_structural';
  if (region?.type === 'vdp_stream') return 'owned_by_vdp_stream_decoder';
  if (!dc2Probe) return 'structural_probe_missing';
  return 'partial';
}

function wb3CollisionPartialBlocker(region, decoded, readiness) {
  if (decoded) return '';
  if (readiness === 'local_validation_warning') return 'local_validation_warning';
  if (readiness === 'runtime_trace_effects_required') return 'runtime_trace_effects_pending';
  if (readiness === 'routine_semantics_required') return 'routine_semantics_pending';
  if (readiness === 'owned_by_vdp_stream_decoder') return 'owned_by_vdp_stream_decoder';
  if (readiness === 'structural_probe_missing') return 'structural_probe_missing';
  if (region?.type && region.type !== 'code') return 'structural_role_unresolved';
  return 'partial_unspecified';
}

function wb3ProofStatus(ready, warning) {
  if (ready) return 'ready';
  if (warning) return 'warning';
  return 'missing';
}

function wb3ProofCounts(checklist) {
  const counts = { ready: 0, missing: 0, warning: 0 };
  for (const item of wb3DecoderArray(checklist)) {
    if (item.status === 'ready') counts.ready++;
    else if (item.status === 'warning') counts.warning++;
    else counts.missing++;
  }
  return counts;
}

function wb3CollisionReconstructionTarget(region, analysisEntries, catalogEntries, readiness) {
  const text = [
    region?.name,
    readiness,
    ...wb3DecoderArray(analysisEntries).map(entry => `${entry.key} ${entry.kind} ${entry.role} ${entry.summary}`),
    ...wb3DecoderArray(catalogEntries).map(entry => `${entry.arrayName} ${entry.role} ${entry.summary}`),
  ].join(' ');
  if (/playerCollision|playerPhysics|coordinate|_LABEL_141F_|_LABEL_1446_|_LABEL_1551_|_LABEL_166C_|_LABEL_16D0_|_LABEL_16E2_/i.test(text)) {
    return 'shared/wb3/collision.js + shared/wb3/player-physics.js';
  }
  if (/entityMotion|entity collision|actor collision|_LABEL_17AB_|_LABEL_17FE_|_LABEL_181D_|_LABEL_186F_/i.test(text)) {
    return 'shared/wb3/collision.js + shared/wb3/entities.js';
  }
  if (/dc2|scroll map|bound/i.test(text)) return 'shared/wb3/collision.js';
  return 'shared/wb3/collision.js';
}

function wb3BuildCollisionReconstructionChecklist(params) {
  const checklist = [];
  const decoded = Boolean(params.decodedStructuralCollisionRegion);
  const isCode = params.region?.type === 'code';
  const targetModule = wb3CollisionReconstructionTarget(params.region, params.analysisEntries, params.catalogEntries, params.decodeReadiness);
  checklist.push({
    key: 'structural_data_probe',
    label: 'Local structural data probe',
    status: wb3ProofStatus(decoded || params.dc2Probe, params.dc2WarningCount > 0),
    evidence: params.dc2Probe ? `${params.dc2Probe.kind}; warning count ${params.dc2WarningCount}` : (params.catalogBackedStructuralRole || 'no local DC2 probe'),
    targetModule,
    nextStep: params.dc2Probe ? 'Keep local ROM probe green while implementing runtime behavior.' : 'Attach a local structural probe or keep this region owned by its primary decoder.',
  });
  if (isCode) {
    checklist.push({
      key: 'runtime_frame_trace',
      label: 'Runtime frame trace',
      status: wb3ProofStatus(params.sourceHookIds.size && params.hookFixtureIds.size, false),
      evidence: `${params.sourceHookIds.size} hook id(s), ${params.hookFixtureIds.size} fixture id(s)`,
      targetModule,
      nextStep: 'Capture entry/exit state for the routine and compare frame effects before marking decoded.',
    });
    checklist.push({
      key: 'ram_contract',
      label: 'RAM read/write contract',
      status: wb3ProofStatus(params.ramRefs.size > 0, false),
      evidence: `${params.ramRefs.size} RAM ref(s)`,
      targetModule,
      nextStep: 'Bind each RAM ref to a named engine state field and record read/write direction.',
    });
    checklist.push({
      key: 'call_graph_contract',
      label: 'Call graph contract',
      status: wb3ProofStatus(params.calls.size > 0, false),
      evidence: `${params.calls.size} call ref(s)`,
      targetModule,
      nextStep: 'Classify calls as helper, dispatcher, response, or side-effect producer.',
    });
    checklist.push({
      key: 'collision_response_semantics',
      label: 'Collision response semantics',
      status: wb3ProofStatus(false, params.decodeReadiness !== 'runtime_trace_effects_required'),
      evidence: params.partialBlocker || params.decodeReadiness || 'pending',
      targetModule,
      nextStep: 'Record coordinate inputs, collision tile result, position/velocity changes and flags for one frame.',
    });
  } else {
    checklist.push({
      key: 'primary_decoder_ownership',
      label: 'Primary decoder ownership',
      status: params.partialBlocker === 'owned_by_vdp_stream_decoder' ? 'warning' : 'ready',
      evidence: params.partialBlocker || 'collision decoder owns structural data',
      targetModule,
      nextStep: params.partialBlocker === 'owned_by_vdp_stream_decoder' ? 'Open this region through the VDP stream decoder before changing collision status.' : 'No runtime trace required for this structural collision data region.',
    });
  }
  return { targetModule, items: checklist, counts: wb3ProofCounts(checklist) };
}

function wb3CollisionAnalysisEntries(region) {
  const analysis = wb3DecoderObject(region?.analysis);
  return Object.entries(analysis)
    .filter(([key]) => /^(collisionBufferProvenanceAudit|collisionBufferLookupCallsites|collisionBoundAudit|zoneCollisionRecipeAudit|entityMotionCollisionHelperAudit|entityCollisionFragmentInternalHelperAudit|playerCollisionFrameTraceScaffoldAudit|playerCollisionRuntimeHookFixtureAudit|playerCollisionRuntimeTraceEventContractAudit|bank2VdpResidualDrawBoundaryCollisionAudit)$/i.test(key))
    .map(([key, value]) => ({
      key,
      kind: value?.kind || '',
      role: value?.role || wb3DecoderArray(value?.roles).join(','),
      category: value?.category || '',
      catalogId: value?.catalogId || value?.sourceCatalogId || '',
      confidence: value?.confidence || '',
      label: value?.label || '',
      summary: value?.summary || '',
      ramRefs: wb3DecoderArray(value?.ramRefs).slice(0, 24),
      calls: wb3DecoderArray(value?.calls).slice(0, 24),
      sourceHookIds: wb3DecoderArray(value?.sourceHookIds).slice(0, 24),
      hookFixtureIds: wb3DecoderArray(value?.hookFixtureIds).slice(0, 24),
      fieldRefCount: wb3DecoderArray(value?.fieldRefs).length,
      evidenceCount: wb3DecoderArray(value?.evidence).length,
      detailKeys: Object.keys(wb3DecoderObject(value?.detail)).slice(0, 16),
      descriptorCount: value?.descriptorCount ?? null,
      activeDc2PrefixHistogram: wb3DecoderObject(value?.activeDc2PrefixHistogram),
      acceptedCellColumnsRange: value?.acceptedCellColumnsRange || null,
      activeDc2PrefixCountRange: value?.activeDc2PrefixCountRange || null,
      bufferBase: value?.bufferBase || null,
      bufferFootprint: value?.bufferFootprint || null,
      boundModel: value?.boundModel || null,
    }));
}

function wb3CollisionEntryRegion(entry) {
  return entry?.region || entry?.descriptorRegion || entry?.sourceGap?.region || null;
}

function wb3CollisionEntryOffset(entry) {
  return entry?.offset || entry?.containingOffset || entry?.descriptorOffset || entry?.routineOffset || entry?.sourceGap?.range?.startOffset || entry?.range?.startOffset || null;
}

function wb3CollisionEntryMatchesRegion(entry, region) {
  if (!entry || !region) return false;
  if (wb3CatalogRefMatchesRegion(wb3CollisionEntryRegion(entry), region)) return true;
  if (wb3CatalogOffsetInRegion(wb3CollisionEntryOffset(entry), region)) return true;
  if (wb3CatalogOffsetInRegion(entry?.sourceGap?.range?.startOffset, region)) return true;
  if (wb3CatalogOffsetInRegion(entry?.sourceGap?.range?.endOffsetExclusive, region)) return true;
  return false;
}

function wb3TrimCollisionCatalogEntry(catalog, arrayName, entry) {
  const region = wb3CollisionEntryRegion(entry);
  return {
    sourceCatalogId: catalog?.id || '',
    arrayName,
    label: entry.label || entry.containingLabel || entry.id || entry.sourceDescriptorId || '',
    offset: wb3CollisionEntryOffset(entry) || '',
    role: entry.role || entry.kind || entry.category || entry.disposition || '',
    category: entry.category || '',
    confidence: entry.confidence || '',
    summary: entry.summary || '',
    ramRefs: wb3DecoderArray(entry.ramRefs).slice(0, 24),
    calls: wb3DecoderArray(entry.calls).slice(0, 24),
    fieldRefCount: wb3DecoderArray(entry.fieldRefs).length,
    evidenceCount: wb3DecoderArray(entry.evidence).length,
    sourceHookIds: wb3DecoderArray(entry.sourceHookIds).slice(0, 24),
    hookFixtureIds: wb3DecoderArray(entry.hookFixtureIds).slice(0, 24),
    activeDc2PrefixCount: entry.activeDc2PrefixCount ?? null,
    acceptedCellColumns: entry.acceptedCellColumns ?? null,
    finalHighByte: entry.finalHighByte || null,
    finalBoundWord: entry.finalBoundWord || null,
    decodedWrittenCells: entry.decodedWrittenCells ?? null,
    warningCount: entry.warningCount ?? null,
    occurrenceCount: entry.occurrenceCount ?? null,
    overrunBytes: entry.overrunBytes ?? null,
    region: region || null,
  };
}

function wb3CollectCollisionCatalogEntries(map, region, limit) {
  const entries = [];
  const collections = [
    'collisionBufferCatalogs',
    'entityMotionCollisionCatalogs',
    'vdpStreamResidualBoundaryCollisionCatalogs',
  ];
  for (const collection of collections) {
    for (const catalog of wb3DecoderArray(map?.[collection])) {
      for (const arrayName of ['routines', 'sourceRegions', 'directCollisionLookupCalls', 'catalogCollisionConsumers', 'helpers', 'fieldTokens', 'candidates']) {
        for (const item of wb3DecoderArray(catalog?.[arrayName])) {
          if (wb3CollisionEntryMatchesRegion(item, region)) entries.push(wb3TrimCollisionCatalogEntry(catalog, arrayName, item));
        }
      }
    }
  }
  for (const catalog of wb3DecoderArray(map?.collisionBufferCatalogs)) {
    if (catalog?.id !== 'world-zone-collision-recipe-catalog-2026-06-25') continue;
    for (const arrayName of ['recipeCollisionSummaries', 'recipeSamples']) {
      for (const item of wb3DecoderArray(catalog?.[arrayName])) {
        if (wb3CollisionEntryMatchesRegion(item, region)) entries.push(wb3TrimCollisionCatalogEntry(catalog, arrayName, item));
      }
    }
  }
  return entries.slice(0, limit || 160);
}

function wb3DecodeCollisionRuntimeRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region?.offset);
  if (!region || !wb3IsCollisionRuntimeRegion(region)) {
    return wb3MakeDecodeResult(decoder, asset, region, 'metadata_only',
      'No collision/bounds/runtime evidence is attached to this region yet.',
      { offset, implementationPercent: decoder.implementationPercent },
      ['Select a region with collision buffer, collision bound, zone collision recipe, or runtime trace evidence.'],
      null);
  }
  const analysisEntries = wb3CollisionAnalysisEntries(region);
  const catalogEntries = wb3CollectCollisionCatalogEntries(map, region, options.collisionCatalogEntryPreviewLimit || 160);
  const ramRefs = new Set();
  const calls = new Set();
  const sourceCatalogIds = new Set();
  const sourceHookIds = new Set();
  const hookFixtureIds = new Set();
  const roleCounts = {};
  let fieldRefCount = 0;
  let recipeCount = 0;
  const widthCounts = {};
  for (const entry of analysisEntries) {
    if (entry.catalogId) sourceCatalogIds.add(entry.catalogId);
    for (const ref of entry.ramRefs || []) ramRefs.add(ref);
    for (const call of entry.calls || []) calls.add(call);
    for (const id of entry.sourceHookIds || []) sourceHookIds.add(id);
    for (const id of entry.hookFixtureIds || []) hookFixtureIds.add(id);
    fieldRefCount += entry.fieldRefCount || 0;
    const role = entry.kind || entry.role || entry.key;
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    for (const [prefix, count] of Object.entries(entry.activeDc2PrefixHistogram || {})) {
      widthCounts[prefix] = (widthCounts[prefix] || 0) + Number(count || 0);
      recipeCount += Number(count || 0);
    }
  }
  for (const entry of catalogEntries) {
    if (entry.sourceCatalogId) sourceCatalogIds.add(entry.sourceCatalogId);
    for (const ref of entry.ramRefs || []) ramRefs.add(ref);
    for (const call of entry.calls || []) calls.add(call);
    for (const id of entry.sourceHookIds || []) sourceHookIds.add(id);
    for (const id of entry.hookFixtureIds || []) hookFixtureIds.add(id);
    fieldRefCount += entry.fieldRefCount || 0;
    const role = entry.role || entry.arrayName || 'catalog';
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    if (entry.activeDc2PrefixCount != null) {
      const key = String(entry.activeDc2PrefixCount);
      widthCounts[key] = (widthCounts[key] || 0) + 1;
      recipeCount++;
    }
  }
  const dc2Probe = wb3BuildDc2ProbeForRegion(rom, map, region, options);
  const dc2Warnings = dc2Probe?.kind === 'dc2_stream'
    ? wb3DecoderArray(dc2Probe.decoded?.warnings)
    : [];
  const dc2WarningCount = dc2Probe?.kind === 'dc2_pointer_table'
    ? Number(dc2Probe.warningStreamCount || 0)
    : dc2Warnings.length;
  const dc2ProbeDecoded = !!dc2Probe && dc2WarningCount === 0 && region.type !== 'code' && (
    (dc2Probe.kind === 'dc2_stream' && dc2Probe.decoded?.writtenCells === dc2Probe.decoded?.expectedCells) ||
    (dc2Probe.kind === 'dc2_pointer_table' && Number(dc2Probe.warningStreamCount || 0) === 0) ||
    dc2Probe.kind === 'dc2_tile_pair_lookup'
  );
  const catalogBackedStructuralRole = wb3CollisionCatalogBackedStructuralRole(region, analysisEntries, catalogEntries, recipeCount);
  const decodedCatalogBackedCollisionRegion = !!catalogBackedStructuralRole && dc2WarningCount === 0;
  const decodedStructuralCollisionRegion = dc2ProbeDecoded || decodedCatalogBackedCollisionRegion;
  const decodeReadiness = wb3CollisionDecodeReadiness(region, decodedStructuralCollisionRegion, dc2Probe, dc2WarningCount, catalogBackedStructuralRole, sourceHookIds.size, hookFixtureIds.size);
  const partialBlocker = wb3CollisionPartialBlocker(region, decodedStructuralCollisionRegion, decodeReadiness);
  const reconstructionChecklist = wb3BuildCollisionReconstructionChecklist({
    region,
    analysisEntries,
    catalogEntries,
    decodedStructuralCollisionRegion,
    catalogBackedStructuralRole,
    decodeReadiness,
    partialBlocker,
    dc2Probe,
    dc2WarningCount,
    ramRefs,
    calls,
    sourceHookIds,
    hookFixtureIds,
  });
  const dc2Summary = dc2Probe
    ? ` Local DC2 probe: ${dc2Probe.kind}${dc2Probe.kind === 'dc2_pointer_table' ? `, ${dc2Probe.entryCount} table entries, ${dc2Probe.warningStreamCount} warning stream(s)` : dc2Probe.kind === 'dc2_stream' ? `, ${dc2Probe.decoded.writtenCells}/${dc2Probe.decoded.expectedCells} cells, ${dc2Probe.decoded.runtimeConsumedBytes} byte(s)` : ''}.`
    : '';
  const summary = `${analysisEntries.length} analysis evidence item(s), ${catalogEntries.length} catalog match(es), ${ramRefs.size} RAM ref(s), ${calls.size} call ref(s), ${recipeCount} recipe width sample(s).${dc2Summary}`;
  return wb3MakeDecodeResult(decoder, asset, region, decodedStructuralCollisionRegion ? 'decoded' : 'partial',
    summary,
    {
      offset,
      size: Number(region.size || 0),
      decodedStructuralDc2Region: dc2ProbeDecoded,
      decodedCatalogBackedCollisionRegion,
      catalogBackedStructuralRole: catalogBackedStructuralRole || null,
      decodeReadiness,
      partialBlocker,
      reconstructionTargetModule: reconstructionChecklist.targetModule,
      reconstructionProofReadyCount: reconstructionChecklist.counts.ready,
      reconstructionProofMissingCount: reconstructionChecklist.counts.missing,
      reconstructionProofWarningCount: reconstructionChecklist.counts.warning,
      analysisEvidenceCount: analysisEntries.length,
      catalogEntryCount: catalogEntries.length,
      ramRefCount: ramRefs.size,
      callRefCount: calls.size,
      fieldRefCount,
      sourceHookCount: sourceHookIds.size,
      hookFixtureCount: hookFixtureIds.size,
      recipeWidthSampleCount: recipeCount,
      dc2LocalProbeKind: dc2Probe?.kind || '',
      dc2LocalProbeWarningCount: dc2WarningCount,
      dc2LocalProbeTableEntries: dc2Probe?.kind === 'dc2_pointer_table' ? dc2Probe.entryCount : null,
      dc2LocalProbeWrittenCells: dc2Probe?.kind === 'dc2_stream' ? dc2Probe.decoded.writtenCells : null,
      dc2LocalProbeRuntimeConsumedBytes: dc2Probe?.kind === 'dc2_stream' ? dc2Probe.decoded.runtimeConsumedBytes : null,
      sourceCatalogIds: [...sourceCatalogIds].sort(),
      widthCounts,
      roleCounts,
    },
    dc2Warnings,
    options.includeTransientPreview ? {
      kind: 'collision_runtime_metadata',
      analysisEntries: analysisEntries.slice(0, options.collisionAnalysisPreviewLimit || 80),
      catalogEntries,
      dc2Probe,
      aggregate: {
        ramRefs: [...ramRefs].sort().slice(0, 80),
        calls: [...calls].sort().slice(0, 80),
        sourceHookIds: [...sourceHookIds].sort().slice(0, 80),
        hookFixtureIds: [...hookFixtureIds].sort().slice(0, 80),
        sourceCatalogIds: [...sourceCatalogIds].sort(),
        widthCounts,
        roleCounts,
        fieldRefCount,
        recipeWidthSampleCount: recipeCount,
        reconstructionChecklist: reconstructionChecklist.items,
        reconstructionTargetModule: reconstructionChecklist.targetModule,
        reconstructionProofCounts: reconstructionChecklist.counts,
      },
      semantics: {
        buffer: '_RAM_CB00_ decompressed DC2 room cell buffer shared by renderer and collision lookup',
        lookupRoutine: '_LABEL_141F_ converts player/entity coordinates to _RAM_CB00_ cell reads',
        boundModel: '_RAM_D019_/_RAM_D01A_ stores active DC2 prefix width; accepted columns = activeDc2PrefixCount * 16',
        runtimeTraceContract: 'player collision runtime traces are metadata-only and forbid collision cell values, RAM dumps, register traces, pixels and samples',
        assetPolicy: 'This preview shows labels, offsets, roles, counts, RAM refs, call refs, hook ids and formula metadata only; it does not persist collision cell bytes, decoded room bytes, runtime values or screenshots.',
      },
    } : null);
}

function wb3UiAnalysisEntries(region) {
  const analysis = wb3DecoderObject(region?.analysis);
  return Object.entries(analysis)
    .filter(([key]) => /menu|hud|status|inventory|password|cf52|cf54|ui/i.test(key) && key !== 'sceneMenuEntityRoutineConfidenceBackfillAudit')
    .map(([key, value]) => ({
      key,
      kind: value?.kind || '',
      role: value?.role || '',
      catalogId: value?.catalogId || '',
      confidence: value?.confidence || '',
      summary: value?.summary || '',
      family: value?.family || '',
      tool: value?.tool || '',
    }));
}

function wb3UiCatalogBackedStructuralRole(region, analysisEntries, catalogEntries) {
  if (!region || region.type === 'code') return '';
  const type = region.type || '';
  const evidenceText = [
    region.name,
    type,
    ...Object.keys(wb3DecoderObject(region.analysis)),
    ...wb3DecoderArray(analysisEntries).map(entry => `${entry.key} ${entry.kind} ${entry.role} ${entry.summary} ${entry.catalogId}`),
    ...wb3DecoderArray(catalogEntries).map(entry => `${entry.arrayName} ${entry.role} ${entry.family} ${entry.summary} ${entry.sourceCatalogId}`),
  ].join(' ');
  if (type === 'data_table' && /uiPlayerTransitionTable|selection table/i.test(evidenceText)) return 'shop_menu_selection_table';
  if (type === 'tile_map' && /statusVdpWriterDetail|uiPlayerTransitionTable|selection marker|blank marker/i.test(evidenceText)) return 'ui_tile_word_records';
  if (type === 'text' && /password/i.test(evidenceText)) return 'password_text_marker';
  if (type === 'entity_data' && /bank1MenuObject/i.test(evidenceText)) return 'bank1_menu_object_record';
  if (type === 'entity_anim_script' && /bank1MenuObject/i.test(evidenceText)) return 'bank1_menu_object_animation_script';
  if (type === 'item_data' && /bank7MenuItem/i.test(evidenceText)) return 'bank7_menu_item_record';
  return '';
}

function wb3UiDecodeReadiness(region, decoded, warnings, tablePreview, statusTileProbe, catalogBackedRole) {
  if (decoded) return 'decoded_structural';
  if (wb3DecoderArray(warnings).length) return 'local_validation_warning';
  if (region?.type === 'code') return 'routine_semantics_required';
  if (catalogBackedRole) return 'catalog_backed_structural';
  if (/^(gfx_tiles|dynamic_tile_loader|screen_prog|palette_script|null|vdp_stream)$/i.test(region?.type || '')) return 'owned_by_other_decoder';
  if (tablePreview?.status === 'needs_rom' || statusTileProbe?.status === 'needs_rom') return 'needs_rom';
  return 'structural_probe_missing';
}

function wb3UiPartialBlocker(region, decoded, readiness) {
  if (decoded) return '';
  if (readiness === 'local_validation_warning') return 'local_validation_warning';
  if (readiness === 'routine_semantics_required') return 'routine_semantics_pending';
  if (readiness === 'owned_by_other_decoder') return 'owned_by_other_decoder';
  if (readiness === 'needs_rom') return 'needs_rom';
  if (readiness === 'structural_probe_missing') return 'structural_probe_missing';
  if (region?.type && region.type !== 'code') return 'catalog_binding_pending';
  return 'partial_unspecified';
}

function wb3UiReconstructionTarget(region, analysisEntries, catalogEntries, readiness) {
  const text = [
    region?.name,
    readiness,
    ...Object.keys(wb3DecoderObject(region?.analysis)),
    ...wb3DecoderArray(analysisEntries).map(entry => `${entry.key} ${entry.kind} ${entry.role} ${entry.summary}`),
    ...wb3DecoderArray(catalogEntries).map(entry => `${entry.arrayName} ${entry.role} ${entry.family} ${entry.summary}`),
  ].join(' ');
  if (/password/i.test(text)) return 'shared/wb3/game-state.js + shared/wb3/text.js';
  if (/status|hud|cf52|cf54|inventory/i.test(text)) return 'shared/wb3/game-state.js + shared/wb3/screen-prog.js';
  if (/menu|shop|selection/i.test(text)) return 'shared/wb3/game-state.js + shared/wb3/entities.js';
  if (/tile|vdp|screen/i.test(text)) return 'shared/wb3/screen-prog.js + shared/wb3/tile-loaders.js';
  return 'shared/wb3/game-state.js';
}

function wb3BuildUiReconstructionChecklist(params) {
  const checklist = [];
  const isCode = params.region?.type === 'code';
  const decoded = Boolean(params.decodedStructuralUiRegion);
  const targetModule = wb3UiReconstructionTarget(params.region, params.analysisEntries, params.catalogEntries, params.decodeReadiness);
  checklist.push({
    key: 'structural_table_or_catalog',
    label: 'Structural table/catalog binding',
    status: wb3ProofStatus(decoded || params.catalogBackedStructuralRole, wb3DecoderArray(params.warnings).length > 0),
    evidence: params.catalogBackedStructuralRole || params.tableProbe?.role || params.statusTileProbe?.kind || `${params.catalogEntries.length} catalog match(es)`,
    targetModule,
    nextStep: decoded ? 'Keep local ROM table/probe validation green.' : 'Attach a concrete table, status tile probe, or owning decoder before marking structural data decoded.',
  });
  if (isCode) {
    checklist.push({
      key: 'caller_state_contract',
      label: 'Caller state contract',
      status: wb3ProofStatus(params.analysisEntries.length || params.catalogEntries.length, false),
      evidence: `${params.analysisEntries.length} analysis item(s), ${params.catalogEntries.length} catalog match(es)`,
      targetModule,
      nextStep: 'Document which menu/status/password state enters the routine and which state exits it.',
    });
    checklist.push({
      key: 'ram_contract',
      label: 'RAM read/write contract',
      status: wb3ProofStatus(params.ramRefs.size > 0, false),
      evidence: `${params.ramRefs.size} RAM ref(s)`,
      targetModule,
      nextStep: 'Bind each RAM ref to a named game-state field and mark read/write direction.',
    });
    checklist.push({
      key: 'call_graph_contract',
      label: 'Call graph contract',
      status: wb3ProofStatus(params.calls.size > 0, false),
      evidence: `${params.calls.size} call ref(s)`,
      targetModule,
      nextStep: 'Classify called routines as renderer, selector, password helper, item updater, or VDP writer.',
    });
    checklist.push({
      key: 'vdp_or_output_contract',
      label: 'VDP/output contract',
      status: wb3ProofStatus(params.ports.size > 0 || params.statusTileProbe?.status === 'decoded' || /status|vdp|tile/i.test(params.region?.name || ''), false),
      evidence: `${params.ports.size} port ref(s), status tile probe ${params.statusTileProbe?.status || 'none'}`,
      targetModule,
      nextStep: 'Record the target nametable/tile/palette output or prove the routine is state-only.',
    });
    checklist.push({
      key: 'runtime_trace_or_screen_binding',
      label: 'Runtime trace or screen binding',
      status: 'missing',
      evidence: params.partialBlocker || params.decodeReadiness || 'pending',
      targetModule,
      nextStep: 'Trace one invocation from input/caller through final menu/status/password visible or state effect.',
    });
  } else {
    checklist.push({
      key: 'primary_decoder_ownership',
      label: 'Primary decoder ownership',
      status: params.partialBlocker === 'owned_by_other_decoder' ? 'warning' : 'ready',
      evidence: params.partialBlocker || 'text/menu/status decoder owns this structural metadata',
      targetModule,
      nextStep: params.partialBlocker === 'owned_by_other_decoder' ? 'Open this region through its graphics/screen/tile decoder before changing text/menu status.' : 'No routine trace required for this structural UI region.',
    });
  }
  return { targetModule, items: checklist, counts: wb3ProofCounts(checklist) };
}

function wb3UiEntryRegion(entry) {
  return entry?.region || entry?.callerRegion || entry?.handlerRegion || entry?.targetRegion || null;
}

function wb3UiEntryMatchesRegion(entry, region) {
  if (!entry || !region) return false;
  if (wb3CatalogRefMatchesRegion(wb3UiEntryRegion(entry), region)) return true;
  return wb3CatalogOffsetInRegion(entry.offset || entry.callerOffset || entry.routineOffset || entry.startOffset, region);
}

function wb3TrimUiCatalogEntry(catalog, arrayName, entry) {
  const region = wb3UiEntryRegion(entry);
  return {
    sourceCatalogId: catalog?.id || '',
    arrayName,
    label: entry.label || entry.callerLabel || entry.routineLabel || entry.name || '',
    offset: entry.offset || entry.callerOffset || entry.routineOffset || '',
    role: entry.role || entry.kind || entry.structure || '',
    family: entry.family || '',
    type: entry.type || '',
    confidence: entry.confidence || '',
    summary: entry.summary || '',
    calls: wb3DecoderArray(entry.calls).slice(0, 16),
    ramRefs: wb3DecoderArray(entry.ramRefs).slice(0, 16),
    ports: wb3DecoderArray(entry.ports).slice(0, 8),
    region: region || null,
    line: entry.line || entry.callLine || null,
    valueSource: entry.valueSource || '',
    valueHex: entry.valueHex || null,
    entryCount: entry.entryCount || null,
    entrySizeBytes: entry.entrySizeBytes || null,
    consumer: entry.consumer || '',
    output: entry.output || '',
  };
}

function wb3CollectUiCatalogEntries(map, region, limit) {
  const entries = [];
  const collections = ['menuRoutineCatalogs', 'bank2HudCounterCatalogs', 'bank0StatusInventoryCatalogs'];
  for (const collection of collections) {
    for (const catalog of wb3DecoderArray(map?.[collection])) {
      for (const arrayName of ['entries', 'callsites', 'writes', 'groupedRegionEvents', 'tableRefs', 'tables', 'helperSemantics']) {
        for (const item of wb3DecoderArray(catalog?.[arrayName])) {
          if (arrayName === 'groupedRegionEvents') {
            if (wb3CatalogRefMatchesRegion(item.region, region)) {
              entries.push(Object.assign(wb3TrimUiCatalogEntry(catalog, arrayName, item), {
                eventCount: wb3DecoderArray(item.events).length,
              }));
            }
            continue;
          }
          if (wb3UiEntryMatchesRegion(item, region)) entries.push(wb3TrimUiCatalogEntry(catalog, arrayName, item));
        }
      }
    }
  }
  return entries.slice(0, limit || 160);
}

function wb3UiTableProbe(region) {
  const size = Number(region?.size || 0);
  const analysisEntries = wb3UiAnalysisEntries(region);
  const kindText = analysisEntries.map(entry => `${entry.key} ${entry.kind} ${entry.summary}`).join(' ');
  const nameText = [region?.name, region?.type, kindText].join(' ');
  const structuralTableRegion = /table|text|data/i.test(region?.type || '') || /table|_DATA_|alphabet|selector|status name-table/i.test(String(region?.name || ''));
  if (!structuralTableRegion) {
    return { role: '', size, recordSize: null, recordCount: null, aligned: null };
  }
  let recordSize = null;
  let role = '';
  if (/status_name_table_segment_records/i.test(nameText)) {
    recordSize = 4;
    role = 'status_name_table_segment_records';
  } else if (/status_tile_source_selector|selector table|password alphabet|password xor|password character decode/i.test(nameText)) {
    recordSize = 1;
    role = /password/i.test(nameText) ? 'password_lookup_table' : 'ui_selector_table';
  } else if (/pointer_table|jump table/i.test(nameText) || region?.type === 'pointer_table') {
    recordSize = 2;
    role = 'ui_pointer_table';
  } else if (/vdp address table/i.test(nameText)) {
    recordSize = 2;
    role = 'ui_vdp_address_table';
  } else if (/little_endian_word|_DATA_481_/i.test(nameText)) {
    recordSize = 2;
    role = 'status_word_table';
  } else if (/one_byte|_DATA_479_/i.test(nameText)) {
    recordSize = 1;
    role = 'status_byte_table';
  }
  return {
    role: role || '',
    size,
    recordSize,
    recordCount: recordSize ? Math.floor(size / recordSize) : null,
    aligned: recordSize ? size % recordSize === 0 : null,
  };
}

function wb3UiResolveWordTarget(map, region, word) {
  const value = Number(word);
  if (!Number.isFinite(value)) return null;
  let targetOffset = null;
  if (value >= 0 && value < 0x4000) targetOffset = value;
  else if (value >= 0x4000 && value < 0x8000) targetOffset = value;
  else if (value >= 0x8000 && value < 0xc000) {
    const regionOffset = wb3DecoderParseOffset(region?.offset);
    const bank = regionOffset == null ? 0 : wb3DecoderBankOf(regionOffset);
    targetOffset = bank * 0x4000 + (value - 0x8000);
  }
  return targetOffset == null ? null : {
    targetOffset,
    targetOffsetHex: wb3DecoderHex(targetOffset),
    targetRegion: wb3FindRegionAtOffset(map, targetOffset),
  };
}

function wb3UiTableRecordFields(rom, offset, recordSize) {
  const fields = [];
  for (let i = 0; i < recordSize; i++) {
    const value = rom[offset + i];
    fields.push({
      name: `byte${i}`,
      valueHex: `0x${Number(value || 0).toString(16).toUpperCase().padStart(2, '0')}`,
      valueDec: Number(value || 0),
    });
  }
  return fields;
}

function wb3BuildUiTablePreview(rom, map, region, tableProbe, options) {
  const offset = wb3DecoderParseOffset(region?.offset);
  const size = Number(region?.size || 0);
  const recordSize = Number(tableProbe?.recordSize || 0);
  if (!tableProbe?.role || !recordSize || !size) {
    return {
      status: 'not_table',
      rows: [],
      stats: { rowCount: 0, shownRowCount: 0, distinctValueCount: 0, zeroValueCount: 0, nonZeroValueCount: 0 },
      warnings: [],
    };
  }
  if (!rom || offset == null || offset < 0 || offset >= rom.length) {
    return {
      status: 'needs_rom',
      rows: [],
      stats: { rowCount: tableProbe.recordCount || 0, shownRowCount: 0, distinctValueCount: 0, zeroValueCount: 0, nonZeroValueCount: 0 },
      warnings: ['Load the local ROM to preview inferred UI table rows.'],
    };
  }
  const rowCount = Math.floor(Math.min(size, Math.max(0, rom.length - offset)) / recordSize);
  const shownRowCount = Math.min(rowCount, options.uiTableRecordPreviewLimit || 96);
  const rows = [];
  const distinctValues = new Set();
  let zeroValueCount = 0;
  let nonZeroValueCount = 0;
  for (let i = 0; i < shownRowCount; i++) {
    const rowOffset = offset + i * recordSize;
    const row = {
      index: i,
      offset: rowOffset,
      offsetHex: wb3DecoderHex(rowOffset),
      role: tableProbe.role,
      recordSize,
    };
    if (recordSize === 1) {
      const value = rom[rowOffset];
      distinctValues.add(value);
      if (value === 0) zeroValueCount++;
      else nonZeroValueCount++;
      row.valueHex = `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
      row.valueDec = value;
      row.bitSummary = `lo=${value & 0x0f} hi=${(value >> 4) & 0x0f}`;
    } else if (recordSize === 2) {
      const word = wb3ReadWordLE(rom, rowOffset);
      distinctValues.add(word);
      if (word === 0) zeroValueCount++;
      else nonZeroValueCount++;
      row.wordHex = `0x${Number(word || 0).toString(16).toUpperCase().padStart(4, '0')}`;
      row.wordDec = Number(word || 0);
      if (tableProbe.role === 'ui_pointer_table') Object.assign(row, wb3UiResolveWordTarget(map, region, word) || {});
    } else {
      const fields = wb3UiTableRecordFields(rom, rowOffset, recordSize);
      for (const field of fields) {
        distinctValues.add(field.valueDec);
        if (field.valueDec === 0) zeroValueCount++;
        else nonZeroValueCount++;
      }
      row.fields = fields;
      if (recordSize === 4) {
        row.shape = 'four_byte_status_segment_record';
        row.word0Hex = `0x${wb3ReadWordLE(rom, rowOffset).toString(16).toUpperCase().padStart(4, '0')}`;
        row.word1Hex = `0x${wb3ReadWordLE(rom, rowOffset + 2).toString(16).toUpperCase().padStart(4, '0')}`;
      }
    }
    rows.push(row);
  }
  return {
    status: 'decoded',
    rows,
    stats: {
      rowCount,
      shownRowCount,
      recordSize,
      distinctValueCount: distinctValues.size,
      zeroValueCount,
      nonZeroValueCount,
      truncatedRowCount: Math.max(0, rowCount - shownRowCount),
    },
    warnings: rowCount > shownRowCount ? [`Showing first ${shownRowCount} of ${rowCount} inferred UI table row(s).`] : [],
  };
}

function wb3FindStatusTileSourceCatalog(map) {
  return wb3DecoderArray(map?.tileSourceCatalogs)
    .find(catalog => catalog?.id === 'world-status-tile-source-range-catalog-2026-06-26') || null;
}

function wb3StatusTileRegionRole(catalog, region) {
  if (!catalog || !region) return '';
  const related = wb3DecoderObject(catalog.relatedRegions);
  for (const [role, ref] of Object.entries(related)) {
    if (wb3CatalogRefMatchesRegion(ref, region)) return role;
  }
  const analysis = wb3DecoderObject(region.analysis);
  if (analysis.statusTileSourceRangeAudit?.kind) return analysis.statusTileSourceRangeAudit.kind;
  return '';
}

function wb3RangeMatchesCatalogRange(range, catalogRange) {
  if (!range || !catalogRange) return false;
  return String(range.start || '').toUpperCase() === String(catalogRange.start || '').toUpperCase()
    && String(range.endExclusive || '').toUpperCase() === String(catalogRange.endExclusive || '').toUpperCase()
    && Number(range.sizeBytes || 0) === Number(catalogRange.sizeBytes || 0);
}

function wb3BuildStatusTileUploadProbe(rom, map, region, options) {
  const catalog = wb3FindStatusTileSourceCatalog(map);
  const role = wb3StatusTileRegionRole(catalog, region);
  if (!catalog || !role) return null;

  const scope = wb3DecoderObject(catalog.scope);
  const selectorOffset = wb3DecoderParseOffset(scope.selectorTableOffset || '0x025D6');
  const graphicsOffset = wb3DecoderParseOffset(scope.graphicsSourceOffset || '0x20000');
  const entryCount = Number(scope.selectorEntryCount || wb3DecoderArray(catalog.entries).length || 0);
  const uploadByteCount = Number(scope.uploadByteCount || 64);
  const tileByteCount = 32;
  const uploadTileCount = Math.floor(uploadByteCount / tileByteCount);
  const previewLimit = Math.max(0, Math.min(entryCount, options.statusTileUploadPreviewLimit || 32));
  const catalogEntries = wb3DecoderArray(catalog.entries).slice(0, previewLimit);
  const rows = [];
  const tilePreviewRanges = [];
  const warnings = [];
  let localCheckedCount = 0;
  let localMatchCount = 0;
  let localMismatchCount = 0;
  let localUploadCount = 0;
  let localSkippedCount = 0;

  for (const entry of catalogEntries) {
    const index = Number(entry.entryIndex ?? rows.length);
    const catalogRange = entry.sourceRange || null;
    const catalogStart = wb3DecoderParseOffset(catalogRange?.start);
    const row = {
      index,
      catalogUploadSkipped: Boolean(entry.uploadSkipped),
      sourceRange: catalogRange,
      sourceRegion: catalogStart == null ? null : wb3FindRegionAtOffset(map, catalogStart),
      vramDestination: scope.vramDestination || '0x6200',
      uploadByteCount,
      uploadTileCount,
      formula: scope.sourceOffsetFormula || '0x20000 + selectorByte * 32',
      localStatus: rom ? 'not_checked' : 'needs_rom',
    };

    if (rom && selectorOffset != null && graphicsOffset != null && selectorOffset + index < rom.length) {
      const selector = rom[selectorOffset + index];
      const localSkipped = selector === 0;
      const localSourceStart = localSkipped ? null : graphicsOffset + selector * tileByteCount;
      const localRange = localSkipped ? null : {
        start: wb3DecoderHex(localSourceStart),
        endExclusive: wb3DecoderHex(localSourceStart + uploadByteCount),
        sizeBytes: uploadByteCount,
      };
      const matchesCatalog = localSkipped
        ? Boolean(entry.uploadSkipped)
        : wb3RangeMatchesCatalogRange(localRange, catalogRange);
      row.localStatus = matchesCatalog ? 'matches_catalog' : 'mismatch';
      row.localUploadSkipped = localSkipped;
      row.localDerivedSourceRange = localRange;
      row.localSourceWithinRom = localSkipped ? true : localSourceStart + uploadByteCount <= rom.length;
      row.matchesCatalog = matchesCatalog;
      localCheckedCount++;
      if (matchesCatalog) localMatchCount++;
      else localMismatchCount++;
      if (localSkipped) localSkippedCount++;
      else {
        localUploadCount++;
        if (row.localSourceWithinRom) {
          tilePreviewRanges.push({
            entryIndex: index,
            sourceOffset: localSourceStart,
            sourceOffsetHex: wb3DecoderHex(localSourceStart),
            tileCount: uploadTileCount,
            uploadByteCount,
          });
        }
      }
    }
    rows.push(row);
  }

  if (entryCount > previewLimit) warnings.push(`Showing first ${previewLimit} of ${entryCount} status tile selector entries.`);
  if (localMismatchCount) warnings.push(`${localMismatchCount} local ROM selector entr${localMismatchCount === 1 ? 'y does' : 'ies do'} not match the persisted range catalog.`);

  return {
    kind: 'status_tile_upload_probe',
    status: rom ? (localMismatchCount ? 'partial' : 'decoded') : 'needs_rom',
    catalogId: catalog.id,
    regionRole: role,
    selectorTableOffset: selectorOffset == null ? '' : wb3DecoderHex(selectorOffset),
    graphicsSourceOffset: graphicsOffset == null ? '' : wb3DecoderHex(graphicsOffset),
    uploadRoutine: scope.uploadRoutine || '_LABEL_25A4_',
    offsetHelper: scope.offsetHelper || '_LABEL_B8F_',
    vramDestination: scope.vramDestination || '0x6200',
    uploadByteCount,
    uploadTileCount,
    entryCount,
    shownEntryCount: rows.length,
    localCheckedCount,
    localMatchCount,
    localMismatchCount,
    localUploadCount,
    localSkippedCount,
    rows,
    tilePreviewRanges: tilePreviewRanges.slice(0, options.statusTileUploadTilePreviewLimit || 16),
    sourceCatalogPresence: wb3DecoderObject(catalog.sourceCatalogPresence),
    warnings,
    assetPolicy: 'The browser may decode these status tiles from the loaded local ROM for display, but only offsets, counts, entry indexes and match status are persisted.',
  };
}

function wb3DecodeTextMenuStatusRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region?.offset);
  if (!region || !wb3IsTextMenuStatusRegion(region)) {
    return wb3MakeDecodeResult(decoder, asset, region, 'metadata_only',
      'No HUD/menu/status/password evidence is attached to this region yet.',
      { offset, implementationPercent: decoder.implementationPercent },
      ['Select a region with menu/status/password analysis keys or catalog entries for this decoder.'],
      null);
  }
  const analysisEntries = wb3UiAnalysisEntries(region);
  const catalogEntries = wb3CollectUiCatalogEntries(map, region, options.uiCatalogEntryPreviewLimit || 160);
  const tableProbe = wb3UiTableProbe(region);
  const tablePreview = wb3BuildUiTablePreview(rom, map, region, tableProbe, options);
  const statusTileProbe = wb3BuildStatusTileUploadProbe(rom, map, region, options);
  const ramRefs = new Set();
  const calls = new Set();
  const ports = new Set();
  const sourceCatalogIds = new Set();
  const familyCounts = {};
  for (const entry of analysisEntries) {
    if (entry.catalogId) sourceCatalogIds.add(entry.catalogId);
    const family = entry.key.replace(/Audit$/, '');
    familyCounts[family] = (familyCounts[family] || 0) + 1;
  }
  for (const entry of catalogEntries) {
    if (entry.sourceCatalogId) sourceCatalogIds.add(entry.sourceCatalogId);
    for (const ref of entry.ramRefs || []) ramRefs.add(ref);
    for (const call of entry.calls || []) calls.add(call);
    for (const port of entry.ports || []) ports.add(port);
    const family = entry.family || entry.arrayName || 'catalog';
    familyCounts[family] = (familyCounts[family] || 0) + 1;
  }
  if (statusTileProbe?.catalogId) sourceCatalogIds.add(statusTileProbe.catalogId);
  const summary = `${analysisEntries.length} analysis evidence item(s), ${catalogEntries.length} catalog match(es), ${ramRefs.size} RAM ref(s), ${calls.size} call ref(s).`;
  const warnings = [];
  if (tableProbe.aligned === false) warnings.push(`Region size is not aligned to inferred ${tableProbe.recordSize}-byte UI table records.`);
  warnings.push(...wb3DecoderArray(tablePreview.warnings));
  warnings.push(...wb3DecoderArray(statusTileProbe?.warnings));
  const catalogBackedStructuralRole = wb3UiCatalogBackedStructuralRole(region, analysisEntries, catalogEntries);
  const decodedStructuralUiRegion = region.type !== 'code' && warnings.length === 0 && (
    tablePreview.status === 'decoded' ||
    statusTileProbe?.status === 'decoded' ||
    !!catalogBackedStructuralRole
  );
  const decodeReadiness = wb3UiDecodeReadiness(region, decodedStructuralUiRegion, warnings, tablePreview, statusTileProbe, catalogBackedStructuralRole);
  const partialBlocker = wb3UiPartialBlocker(region, decodedStructuralUiRegion, decodeReadiness);
  const reconstructionChecklist = wb3BuildUiReconstructionChecklist({
    region,
    analysisEntries,
    catalogEntries,
    tableProbe,
    tablePreview,
    statusTileProbe,
    decodedStructuralUiRegion,
    catalogBackedStructuralRole,
    decodeReadiness,
    partialBlocker,
    warnings,
    ramRefs,
    calls,
    ports,
  });
  return wb3MakeDecodeResult(decoder, asset, region, decodedStructuralUiRegion ? 'decoded' : 'partial',
    summary,
    {
      offset,
      size: Number(region.size || 0),
      decodedStructuralUiRegion,
      catalogBackedStructuralRole: catalogBackedStructuralRole || null,
      decodeReadiness,
      partialBlocker,
      reconstructionTargetModule: reconstructionChecklist.targetModule,
      reconstructionProofReadyCount: reconstructionChecklist.counts.ready,
      reconstructionProofMissingCount: reconstructionChecklist.counts.missing,
      reconstructionProofWarningCount: reconstructionChecklist.counts.warning,
      analysisEvidenceCount: analysisEntries.length,
      catalogEntryCount: catalogEntries.length,
      ramRefCount: ramRefs.size,
      callRefCount: calls.size,
      portRefCount: ports.size,
      tableRole: tableProbe.role || null,
      tableRecordSize: tableProbe.recordSize,
      tableRecordCount: tableProbe.recordCount,
      tablePreviewStatus: tablePreview.status,
      tablePreviewShownRows: tablePreview.stats.shownRowCount,
      tableDistinctValueCount: tablePreview.stats.distinctValueCount,
      statusTileProbeKind: statusTileProbe?.kind || null,
      statusTileProbeStatus: statusTileProbe?.status || null,
      statusTileLocalMatchCount: statusTileProbe?.localMatchCount || 0,
      statusTileLocalMismatchCount: statusTileProbe?.localMismatchCount || 0,
      statusTileUploadEntryCount: statusTileProbe?.localUploadCount || 0,
      sourceCatalogIds: [...sourceCatalogIds].sort(),
      familyCounts,
    },
    warnings,
    options.includeTransientPreview ? {
      kind: 'ui_menu_status_metadata',
      analysisEntries: analysisEntries.slice(0, options.uiAnalysisPreviewLimit || 80),
      catalogEntries,
      tableProbe,
      tablePreview,
      statusTileProbe,
      aggregate: {
        ramRefs: [...ramRefs].sort().slice(0, 64),
        calls: [...calls].sort().slice(0, 64),
        ports: [...ports].sort().slice(0, 32),
        sourceCatalogIds: [...sourceCatalogIds].sort(),
        familyCounts,
        reconstructionChecklist: reconstructionChecklist.items,
        reconstructionTargetModule: reconstructionChecklist.targetModule,
        reconstructionProofCounts: reconstructionChecklist.counts,
      },
      semantics: {
        families: 'bank0 menu runtime, bank0 status/inventory, bank2 HUD counter, password routines, status VDP writer tables',
        statusRam: '_RAM_CF52_/_RAM_CF54_ status scroll/maximum model',
        passwordRam: '_RAM_D137_ password characters, _RAM_D145_ password bit buffer',
        tablePolicy: 'Local table row previews are transient and computed from the user-provided ROM only.',
        assetPolicy: 'This preview persists labels, offsets, roles, counts, RAM refs and call refs only; it does not write table bytes, text characters, rendered UI or graphics into project metadata.',
      },
    } : null);
}

function wb3InputCommandName(command) {
  const direction = command & 0x0f;
  const action = command & 0x30;
  const directions = [];
  if (direction & 0x01) directions.push('bit0');
  if (direction & 0x02) directions.push('bit1');
  if (direction & 0x04) directions.push('bit2');
  if (direction & 0x08) directions.push('bit3');
  const actions = [];
  if (action & 0x10) actions.push('button_bit4');
  if (action & 0x20) actions.push('button_bit5');
  return {
    directionBits: direction,
    actionBits: action,
    directionLabel: directions.join('+') || 'neutral',
    actionLabel: actions.join('+') || 'none',
  };
}

function wb3CountNumericValues(records, key) {
  const counts = new Map();
  for (const record of records) {
    const value = record[key];
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([value, count]) => ({ value, count }));
}

function wb3SignedByte(byte) {
  return byte > 127 ? byte - 256 : byte;
}

function wb3FindMetaspriteSemantics(map) {
  for (const catalog of wb3DecoderArray(map?.metaspriteCatalogs)) {
    if (catalog?.id === 'world-metasprite-oam-writer-semantics-catalog-2026-06-25') {
      return catalog;
    }
  }
  return null;
}

function wb3CollectMetaspriteSubrecords(map, region, limit) {
  const regionStart = wb3DecoderParseOffset(region?.offset);
  const regionSize = Number(region?.size || 0);
  const regionEnd = regionStart == null ? null : regionStart + regionSize;
  const byOffset = new Map();

  function addSubrecord(item, catalogId) {
    if (item?.reason || Number(item?.warningCount || 0) > 0) return;
    const offset = wb3DecoderParseOffset(item?.offset || item?.frameOffset || item?.targetOffset || item?.start);
    if (offset == null || regionStart == null || offset < regionStart || offset >= regionEnd) return;
    let endOffset = wb3DecoderParseOffset(item.endOffsetInclusive || item.endInclusive || item.terminatorOffset || item.termination?.terminatorOffset);
    const endExclusive = wb3DecoderParseOffset(item.endExclusive);
    if (endOffset == null && endExclusive != null) endOffset = endExclusive - 1;
    const key = offset;
    const existing = byOffset.get(key);
    const next = {
      id: item.id || `frame_stream_${offset.toString(16).toUpperCase()}`,
      offset,
      offsetHex: wb3DecoderHex(offset),
      endOffsetInclusive: endOffset,
      endOffsetHex: endOffset == null ? null : wb3DecoderHex(endOffset),
      size: Number(item.size || (endOffset == null ? 0 : endOffset - offset + 1)),
      pieceRecordCount: Number(item.pieceRecordCount || 0),
      referenceCount: Number(item.referenceCount || 0),
      usageClass: item.usageClass || '',
      sourceFamilies: wb3DecoderArray(item.sourceFamilies).slice(0, 8),
      sourceCommandStreams: wb3DecoderArray(item.sourceCommandStreams).slice(0, 8),
      references: wb3DecoderArray(item.references).slice(0, 8),
      sourceCatalogId: catalogId || '',
    };
    if (!existing || next.referenceCount > existing.referenceCount || next.pieceRecordCount > existing.pieceRecordCount) {
      byOffset.set(key, next);
    }
  }

  function walk(value, catalogId, depth) {
    if (!value || depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, catalogId, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const hasFrameShape = (value.offset || value.frameOffset || value.targetOffset || value.start) && (value.pieceRecordCount != null || String(value.id || '').startsWith('frame_stream_') || value.tileByteRange || value.termination?.terminatorOffset || value.endExclusive);
    if (hasFrameShape) addSubrecord(value, catalogId);
    for (const key of Object.keys(value)) {
      if (key === 'evidence' || key === 'assetPolicy') continue;
      walk(value[key], catalogId, depth + 1);
    }
  }

  for (const catalog of wb3DecoderArray(map?.metaspriteCatalogs)) walk(catalog, catalog?.id || '', 0);
  for (const catalog of wb3DecoderArray(map?.animationFrameSubrecordCatalogs)) walk(catalog, catalog?.id || '', 0);
  for (const catalog of wb3DecoderArray(map?.animationFrameStreamCatalogs)) walk(catalog, catalog?.id || '', 0);
  for (const catalog of wb3DecoderArray(map?.animationStaticStreamCatalogs)) walk(catalog, catalog?.id || '', 0);
  for (const catalog of wb3DecoderArray(map?.animationCommandStaticOverlayCatalogs)) walk(catalog, catalog?.id || '', 0);
  walk(region?.analysis?.metaspriteTargetIntervalAudit, region?.analysis?.metaspriteTargetIntervalAudit?.catalogId || '', 0);
  return [...byOffset.values()]
    .sort((a, b) => a.offset - b.offset)
    .slice(0, limit || 512);
}

function wb3AnalysisEntriesForKeys(region, keyRoles) {
  const analysis = wb3DecoderObject(region?.analysis);
  const entries = [];
  for (const [key, role] of keyRoles) {
    if (!analysis[key]) continue;
    const item = wb3DecoderObject(analysis[key]);
    entries.push({
      key,
      role,
      kind: item.kind || '',
      confidence: item.confidence || '',
      summary: item.summary || item.status || item.catalogId || '',
      catalogId: item.catalogId || '',
    });
  }
  return entries;
}

function wb3CollectMetaspriteUsage(map, region, selectedFrameOffset, limit) {
  const regionStart = wb3DecoderParseOffset(region?.offset);
  const regionEnd = regionStart == null ? null : regionStart + Number(region?.size || 0);
  const frameOffsetHex = selectedFrameOffset == null ? null : wb3DecoderHex(selectedFrameOffset);
  const analysisEntries = wb3AnalysisEntriesForKeys(region, [
    ['metaspriteAudit', 'metasprite_frame_data'],
    ['c34eMetaspriteFamilyAudit', 'c34e_metasprite_family_target'],
    ['animationFamilyAudit', 'animation_family_target_region'],
    ['animationBehaviorFamilyAudit', 'behavior_animation_family_target_region'],
    ['animationFrameStreamAudit', 'frame_stream_region'],
    ['animationFrameSubrecordAudit', 'frame_subrecord_region'],
    ['animationFrameSubrecordUsageAudit', 'frame_subrecord_usage'],
    ['animationStaticStreamAudit', 'static_animation_frame_target'],
    ['animationSpriteTileRangeAudit', 'sprite_tile_range_target'],
    ['roomEntityFrameAssetLinkAudit', 'room_entity_frame_asset_link'],
    ['playerA48TileStreamAudit', 'player_a48_tile_stream_region'],
    ['blankMetaspriteTargetAudit', 'blank_or_zero_metasprite_target'],
    ['blankMetaspriteQuarantineProofAudit', 'blank_metasprite_quarantine_proof'],
    ['metaspriteTargetIntervalAudit', 'metasprite_target_interval_catalog'],
  ]);
  const familyRefs = [];
  for (const catalog of wb3DecoderArray(map?.animationFamilyCatalogs)) {
    for (const family of wb3DecoderArray(catalog?.families)) {
      const regions = wb3DecoderArray(family?.frameTargetRegions);
      if (!regions.some(item => item?.region?.id === region?.id)) continue;
      familyRefs.push({
        sourceCatalogId: catalog.id || '',
        familyId: family.id || '',
        kind: family.kind || '',
        selectorPair: family.selectorPair || null,
        streamCount: wb3DecoderArray(family.streams).length,
        frameTargetCount: wb3DecoderArray(family.frameTargets).length,
        confidence: family.confidence || '',
      });
    }
  }
  const staticRefs = [];
  for (const catalog of wb3DecoderArray(map?.animationStaticStreamCatalogs)) {
    for (const stream of wb3DecoderArray(catalog?.staticStreams)) {
      const frameOffset = wb3DecoderParseOffset(stream?.frame?.frameOffset || stream?.command?.frameOffset);
      if (stream?.frame?.region?.id !== region?.id && !(frameOffset != null && regionStart != null && frameOffset >= regionStart && frameOffset < regionEnd)) continue;
      staticRefs.push({
        sourceCatalogId: catalog.id || '',
        streamId: stream.id || '',
        streamOffset: stream.offset || '',
        frameOffset: stream.frame?.frameOffset || stream.command?.frameOffset || '',
        selectorCount: Number(stream.selectedByCount || 0),
        confidence: stream.confidence || '',
        selected: frameOffsetHex && (stream.frame?.frameOffset === frameOffsetHex || stream.command?.frameOffset === frameOffsetHex),
      });
    }
  }
  const overlayRefs = [];
  for (const catalog of wb3DecoderArray(map?.animationCommandStaticOverlayCatalogs)) {
    for (const overlay of wb3DecoderArray(catalog?.overlays)) {
      const frameOffset = wb3DecoderParseOffset(overlay?.correctedStaticInterpretation?.frame?.frameOffset);
      if (overlay?.correctedStaticInterpretation?.frame?.region?.id !== region?.id && !(frameOffset != null && regionStart != null && frameOffset >= regionStart && frameOffset < regionEnd)) continue;
      overlayRefs.push({
        sourceCatalogId: catalog.id || '',
        overlayId: overlay.id || '',
        kind: overlay.kind || '',
        streamOffset: overlay.streamOffset || '',
        frameOffset: overlay.correctedStaticInterpretation?.frame?.frameOffset || '',
        selectorCount: Number(overlay.selectedByCount || 0),
        confidence: overlay.confidence || '',
        selected: frameOffsetHex && overlay.correctedStaticInterpretation?.frame?.frameOffset === frameOffsetHex,
      });
    }
  }
  return {
    analysisEntries: analysisEntries.slice(0, limit || 64),
    familyRefs: familyRefs.slice(0, limit || 64),
    staticRefs: staticRefs.slice(0, limit || 64),
    overlayRefs: overlayRefs.slice(0, limit || 64),
    counts: {
      analysisEntryCount: analysisEntries.length,
      familyRefCount: familyRefs.length,
      staticRefCount: staticRefs.length,
      overlayRefCount: overlayRefs.length,
      ownerResolved: analysisEntries.length + familyRefs.length + staticRefs.length + overlayRefs.length > 0,
    },
  };
}

function wb3FindBlankMetaspritePolicy(region, usage) {
  const analysis = wb3DecoderObject(region?.analysis);
  const usageEntries = wb3DecoderArray(usage?.analysisEntries);
  const candidates = [];

  function addCandidate(key, item) {
    const entry = wb3DecoderObject(item);
    if (!entry || !Object.keys(entry).length) return;
    const text = [
      entry.kind,
      entry.status,
      entry.summary,
      entry.decodePolicy,
      entry.model?.defaultDecoderAction,
      entry.model?.renderPolicy,
    ].join(' ').toLowerCase();
    const allZero = entry.allZero === true
      || entry.byteClass?.allZero === true
      || entry.proofChecks?.allZeroFromPriorAudit === true;
    const excludesDefault = entry.defaultDecoderExcluded === true
      || text.includes('exclude_from_normal_frame_stream_decode')
      || text.includes('blank/no-op')
      || text.includes('blank or noop')
      || text.includes('blank_or_noop')
      || text.includes('no-op graphics payload');
    if (!allZero && !excludesDefault) return;
    candidates.push({
      key,
      kind: entry.kind || '',
      confidence: entry.confidence || '',
      summary: entry.summary || entry.status || entry.decodePolicy || 'blank/quarantined metasprite target',
      allZero,
      defaultDecoderExcluded: excludesDefault,
      decodePolicy: entry.decodePolicy || entry.model?.defaultDecoderAction || entry.model?.renderPolicy || '',
      catalogId: entry.catalogId || '',
    });
  }

  addCandidate('blankMetaspriteQuarantineProofAudit', analysis.blankMetaspriteQuarantineProofAudit);
  addCandidate('blankMetaspriteTargetAudit', analysis.blankMetaspriteTargetAudit);
  addCandidate('quarantinedMetaspriteConfidenceBackfillAudit', analysis.quarantinedMetaspriteConfidenceBackfillAudit);

  for (const entry of usageEntries) {
    if (entry.key !== 'blankMetaspriteTargetAudit' && entry.key !== 'blankMetaspriteQuarantineProofAudit') continue;
    if (candidates.some(candidate => candidate.key === entry.key)) continue;
    candidates.push({
      key: entry.key,
      kind: entry.kind || '',
      confidence: entry.confidence || '',
      summary: entry.summary || entry.role || 'blank/quarantined metasprite target',
      allZero: false,
      defaultDecoderExcluded: true,
      decodePolicy: '',
      catalogId: entry.catalogId || '',
    });
  }

  const score = item => (item.confidence === 'high' ? 3 : item.confidence === 'medium' ? 2 : 1)
    + (item.defaultDecoderExcluded ? 3 : 0)
    + (item.allZero ? 2 : 0);
  return candidates.sort((a, b) => score(b) - score(a))[0] || null;
}

function wb3CollectMetaspriteTileContext(map, frameOffset, tileBaseFallback) {
  const frameOffsetHex = frameOffset == null ? null : wb3DecoderHex(frameOffset);
  const matches = [];
  let exactTileBase = null;
  function pushMatch(item, catalogId, sourceKind) {
    if (!item || !frameOffsetHex) return;
    if (!wb3DecoderArray(item.frameOffsets).includes(frameOffsetHex)) return;
    const tileBase = wb3DecoderParseOffset(item.tileBase);
    if (exactTileBase == null && tileBase != null) exactTileBase = tileBase & 0xff;
    matches.push({
      sourceCatalogId: catalogId || '',
      sourceKind,
      id: item.id || '',
      tileBase: item.tileBase || null,
      selectorPair: item.selectorPair || null,
      streamOffsets: wb3DecoderArray(item.streamOffsets).slice(0, 12),
      frameReferenceCount: Number(item.frameReferenceCount || 0),
      frameTileByteRange: item.frameTileByteRange || item.tileByteRange || null,
      finalTileIndexRange: item.finalTileIndexRange || item.tileBaseRange || null,
      confirmedLoaderOverlaps: wb3DecoderArray(item.confirmedLoaderOverlaps).slice(0, 16),
      candidateLoaderOverlaps: wb3DecoderArray(item.candidateLoaderOverlaps).slice(0, 16),
      confidence: item.confidence || (wb3DecoderArray(item.confirmedLoaderOverlaps).length ? 'high' : ''),
    });
  }
  for (const catalog of wb3DecoderArray(map?.animationSpriteTileRangeCatalogs)) {
    for (const item of wb3DecoderArray(catalog?.tileBaseRanges)) pushMatch(item, catalog.id || '', 'tile_base_range');
    for (const item of wb3DecoderArray(catalog?.parameterTableRanges)) pushMatch(item, catalog.id || '', 'parameter_table_range');
  }
  const renderSources = [];
  for (const match of matches) {
    const overlaps = match.confirmedLoaderOverlaps.length ? match.confirmedLoaderOverlaps : match.candidateLoaderOverlaps;
    for (const overlap of overlaps) {
      const start = wb3DecoderParseOffset(overlap?.loaderRange?.start);
      const end = wb3DecoderParseOffset(overlap?.loaderRange?.end);
      const romStart = wb3DecoderParseOffset(overlap?.source?.romStart);
      if (start == null || end == null || romStart == null) continue;
      renderSources.push({
        sourceCatalogId: match.sourceCatalogId,
        sourceKind: match.sourceKind,
        rangeId: match.id,
        loaderRegion: overlap.loaderRegion || null,
        vramStart: start,
        vramEnd: end,
        vramRange: `${wb3DecoderHex(start, 3)}-${wb3DecoderHex(end, 3)}`,
        romStart,
        romStartHex: wb3DecoderHex(romStart),
        relation: overlap.relation || '',
        confidence: overlap.confidence || match.confidence || '',
        sourceRegion: wb3DecoderArray(overlap?.source?.overlappingRegions)[0] || null,
      });
    }
  }
  return {
    tileBase: exactTileBase == null ? (Number(tileBaseFallback || 0) & 0xff) : exactTileBase,
    exactTileBaseResolved: exactTileBase != null,
    matches,
    renderSources,
    highConfidenceRenderSourceCount: renderSources.filter(source => source.confidence === 'high').length,
  };
}

function wb3ParseMetaspriteFrame(rom, frameOffset, options) {
  options = options || {};
  const regionEnd = Math.min(options.regionEnd || rom.length, rom.length);
  const terminator = options.terminator == null ? 0x80 : Number(options.terminator) & 0xff;
  const tileBase = Number(options.tileBase || 0) & 0xff;
  const spriteHeight = options.spriteHeight || 16;
  const spriteWidth = options.spriteWidth || 8;
  const pieces = [];
  const warnings = [];
  let pos = frameOffset;
  let endReason = 'Unexpected EOF';
  while (pos < regionEnd && pieces.length < (options.maxPieces || 128)) {
    const xByte = rom[pos];
    if (xByte === terminator) {
      endReason = `Terminator ${wb3DecoderHex(terminator, 2)} at ${wb3DecoderHex(pos)}`;
      return {
        frameOffset,
        terminatorOffset: pos,
        consumedBytes: pos - frameOffset + 1,
        pieces,
        endReason,
        warnings,
      };
    }
    if (pos + 2 >= regionEnd || pos + 2 >= rom.length) {
      warnings.push(`Truncated 3-byte piece record at ${wb3DecoderHex(pos)}.`);
      endReason = 'Truncated piece record';
      break;
    }
    const yByte = rom[pos + 1];
    const tile = rom[pos + 2];
    const x = wb3SignedByte(xByte);
    const y = wb3SignedByte(yByte);
    pieces.push({
      index: pieces.length,
      offset: pos,
      offsetHex: wb3DecoderHex(pos),
      x,
      y,
      tile,
      tileHex: wb3DecoderHex(tile, 2),
      resolvedTile: (tile + tileBase) & 0xff,
    });
    pos += 3;
  }
  if (pieces.length >= (options.maxPieces || 128)) {
    warnings.push('Reached metasprite piece parse limit before terminator.');
    endReason = 'Reached piece limit';
  }
  return {
    frameOffset,
    terminatorOffset: null,
    consumedBytes: pos - frameOffset,
    pieces,
    endReason,
    warnings,
  };
}

function wb3MetaspriteBounds(pieces, spriteWidth, spriteHeight) {
  if (!pieces.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const piece of pieces) {
    minX = Math.min(minX, piece.x);
    minY = Math.min(minY, piece.y);
    maxX = Math.max(maxX, piece.x + spriteWidth);
    maxY = Math.max(maxY, piece.y + spriteHeight);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function wb3DecodeMetaspriteRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const size = Number(region.size || 0);
  if (!rom || offset == null) return wb3MakeDecodeResult(decoder, asset, region, 'needs_rom', 'Load the local ROM to decode this metasprite frame stream.', {}, [], null);
  const semantics = wb3FindMetaspriteSemantics(map);
  const terminator = wb3DecoderParseOffset(semantics?.summary?.terminatorByte) ?? 0x80;
  const spriteHeight = options.spriteHeight || 16;
  const spriteWidth = options.spriteWidth || 8;
  const subrecords = wb3CollectMetaspriteSubrecords(map, region, options.metaspriteSubrecordLimit || 256);
  const contextualSubrecord = subrecords.find(item => wb3CollectMetaspriteTileContext(map, item.offset, options.tileBase || 0).matches.length > 0) || null;
  const frameOffset = options.frameOffset != null
    ? Number(options.frameOffset)
    : (contextualSubrecord?.offset ?? subrecords[0]?.offset ?? offset);
  const usage = wb3CollectMetaspriteUsage(map, region, frameOffset, options.metaspriteUsageLimit || 128);
  const tileContext = wb3CollectMetaspriteTileContext(map, frameOffset, options.tileBase || 0);
  const tileBase = Number(tileContext.tileBase || 0) & 0xff;
  const regionEnd = Math.min(offset + size, rom.length);
  const selectedSubrecord = subrecords.find(item => item.offset === frameOffset) || null;
  const blankEntry = wb3FindBlankMetaspritePolicy(region, usage);
  if (blankEntry) {
    const intervalAudit = wb3DecoderObject(region?.analysis?.metaspriteTargetIntervalAudit);
    return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
      `Blank/quarantined metasprite target at ${region.offset}; no drawable frame subrecords are expected.`,
      {
        offset,
        size,
        format: 'blank_or_quarantined_metasprite_target',
        knownFrameCount: 0,
        scannedFrameCount: 0,
        scannedPieceCount: 0,
        uniqueTileByteCount: 0,
        quarantinedSubrecordCandidateCount: subrecords.length,
        rejectedTargetCount: Number(intervalAudit.rejectedTargetCount || 0),
        ownerResolved: usage.counts.ownerResolved,
        analysisEntryCount: usage.counts.analysisEntryCount,
        familyRefCount: usage.counts.familyRefCount,
        staticRefCount: usage.counts.staticRefCount,
        tileSourceMatchCount: tileContext.matches.length,
        tileRenderSourceCount: tileContext.renderSources.length,
        blankAllZero: !!blankEntry.allZero,
        defaultDecoderExcluded: !!blankEntry.defaultDecoderExcluded,
        semanticsCatalogId: semantics?.id || null,
      },
      semantics ? [] : ['Metasprite OAM writer semantics catalog not found; using blank target metadata only.'],
      options.includeTransientPreview ? {
        kind: 'metasprite_frame_layout',
        format: 'blank_or_quarantined_metasprite_target',
        terminator,
        spriteWidth,
        spriteHeight,
        tileBase,
        selectedFrameOffset: frameOffset,
        selectedFrameOffsetHex: wb3DecoderHex(frameOffset),
        selectedSubrecord: null,
        blank: true,
        blankReason: blankEntry.summary || blankEntry.role || 'blank/quarantined metasprite target',
        blankPolicy: blankEntry,
        bounds: null,
        pieces: [],
        frames: [],
        usage,
        tileContext,
        tileRenderSources: tileContext.renderSources,
        endReason: 'blank_or_quarantined_target',
        semantics: semantics ? {
          catalogId: semantics.id,
          frameStreamRoutine: semantics.summary?.frameStreamRoutine,
          tileBaseField: semantics.summary?.tileBaseField,
          inputPointer: semantics.summary?.inputPointer,
        } : null,
      } : null);
  }
  const frameEnd = selectedSubrecord?.endOffsetInclusive == null
    ? regionEnd
    : Math.min(regionEnd, selectedSubrecord.endOffsetInclusive + 1);
  const parsed = wb3ParseMetaspriteFrame(rom, frameOffset, {
    regionEnd: frameEnd,
    terminator,
    tileBase,
    spriteWidth,
    spriteHeight,
    maxPieces: options.maxMetaspritePieces || 128,
  });
  const parsedKnownFrames = subrecords.slice(0, options.metaspriteMetricsFrameLimit || 96)
    .map(item => wb3ParseMetaspriteFrame(rom, item.offset, {
      regionEnd: item.endOffsetInclusive == null ? regionEnd : Math.min(regionEnd, item.endOffsetInclusive + 1),
      terminator,
      tileBase,
      spriteWidth,
      spriteHeight,
      maxPieces: options.maxMetaspritePieces || 128,
    }));
  const framesForMetrics = parsedKnownFrames.length ? parsedKnownFrames : [parsed];
  const allPieces = framesForMetrics.flatMap(frame => frame.pieces);
  const uniqueTiles = new Set(allPieces.map(piece => piece.tile));
  const selectedBounds = wb3MetaspriteBounds(parsed.pieces, spriteWidth, spriteHeight);
  const warnings = [...parsed.warnings];
  if (!semantics) warnings.push('Metasprite OAM writer semantics catalog not found; using default 0x80/x,y,tile assumptions.');
  if (!subrecords.length) warnings.push('No cataloged frame subrecords found inside this region; preview starts at the region offset.');
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${subrecords.length || 1} frame candidate(s), selected ${wb3DecoderHex(frameOffset)} has ${parsed.pieces.length} piece record(s), ${uniqueTiles.size} unique tile byte(s) in scanned frames.`,
    {
      offset,
      size,
      format: 'x_y_tile_3b_terminator_80',
      terminator,
      spriteWidth,
      spriteHeight,
      selectedFrameOffset: frameOffset,
      selectedPieceCount: parsed.pieces.length,
      knownFrameCount: subrecords.length,
      scannedFrameCount: framesForMetrics.length,
      scannedPieceCount: allPieces.length,
      uniqueTileByteCount: uniqueTiles.size,
      consumedBytes: parsed.consumedBytes,
      terminatorOffset: parsed.terminatorOffset,
      bounds: selectedBounds,
      ownerResolved: usage.counts.ownerResolved,
      analysisEntryCount: usage.counts.analysisEntryCount,
      familyRefCount: usage.counts.familyRefCount,
      staticRefCount: usage.counts.staticRefCount,
      overlayRefCount: usage.counts.overlayRefCount,
      tileSourceMatchCount: tileContext.matches.length,
      tileRenderSourceCount: tileContext.renderSources.length,
      highConfidenceTileRenderSourceCount: tileContext.highConfidenceRenderSourceCount,
      exactTileBaseResolved: tileContext.exactTileBaseResolved,
      semanticsCatalogId: semantics?.id || null,
    },
    warnings,
    options.includeTransientPreview ? {
      kind: 'metasprite_frame_layout',
      format: 'x_y_tile_3b_terminator_80',
      terminator,
      spriteWidth,
      spriteHeight,
      tileBase,
      selectedFrameOffset: frameOffset,
      selectedFrameOffsetHex: wb3DecoderHex(frameOffset),
      selectedSubrecord,
      bounds: selectedBounds,
      pieces: parsed.pieces.slice(0, options.metaspritePreviewPieceLimit || 128),
      frames: subrecords.slice(0, options.metaspritePreviewFrameLimit || 80),
      usage,
      tileContext,
      tileRenderSources: tileContext.renderSources,
      endReason: parsed.endReason,
      semantics: semantics ? {
        catalogId: semantics.id,
        frameStreamRoutine: semantics.summary?.frameStreamRoutine,
        tileBaseField: semantics.summary?.tileBaseField,
        inputPointer: semantics.summary?.inputPointer,
      } : null,
      } : null);
}

function wb3ReadWordLE(rom, offset) {
  if (!rom || offset == null || offset + 1 >= rom.length) return null;
  return rom[offset] | (rom[offset + 1] << 8);
}

function wb3IsBank6Offset(offset) {
  return offset >= 0x18000 && offset < 0x1C000;
}

function wb3IsBank6Z80Pointer(z80Pointer) {
  return z80Pointer >= 0x8000 && z80Pointer < 0xC000;
}

function wb3Bank6Z80ToRom(z80Pointer) {
  return wb3IsBank6Z80Pointer(z80Pointer) ? z80Pointer + 0x10000 : null;
}

function wb3FindRegionAtOffset(map, offset) {
  for (const candidate of wb3DecoderArray(map?.regions)) {
    const start = wb3DecoderParseOffset(candidate?.offset);
    const size = Number(candidate?.size || 0);
    if (start != null && offset >= start && offset < start + size) {
      return {
        id: candidate.id || '',
        type: candidate.type || '',
        name: candidate.name || '',
        offset: candidate.offset || wb3DecoderHex(start),
        size,
      };
    }
  }
  return null;
}

function wb3CollectAnimationStreamStarts(map, region, limit) {
  const regionStart = wb3DecoderParseOffset(region?.offset);
  const regionSize = Number(region?.size || 0);
  const regionEnd = regionStart == null ? null : regionStart + regionSize;
  const byOffset = new Map();

  function inRegion(offset) {
    return regionStart != null && offset >= regionStart && offset < regionEnd;
  }

  function add(offset, item) {
    if (offset == null || !inRegion(offset)) return;
    const existing = byOffset.get(offset);
    const next = Object.assign({
      offset,
      offsetHex: wb3DecoderHex(offset),
      sourceCatalogId: '',
      streamKind: '',
      commandCount: null,
      frameTargetCount: null,
      terminationKind: '',
      confidence: '',
    }, item || {});
    const nextScore = (next.confidence === 'high' ? 1000 : 0) + (next.streamKind === 'static_overlay' ? 500 : 0) + (next.streamKind === 'static_stream' ? 400 : 0) + (next.commandCount || 0);
    const existingScore = existing ? (existing.confidence === 'high' ? 1000 : 0) + (existing.streamKind === 'static_overlay' ? 500 : 0) + (existing.streamKind === 'static_stream' ? 400 : 0) + (existing.commandCount || 0) : -1;
    if (!existing || nextScore > existingScore) byOffset.set(offset, next);
  }

  for (const catalog of wb3DecoderArray(map?.animationCommandStreamCatalogs)) {
    for (const stream of wb3DecoderArray(catalog?.streams)) {
      const offset = wb3DecoderParseOffset(stream.offset);
      add(offset, {
        sourceCatalogId: catalog.id || '',
        streamKind: 'command_stream',
        streamId: stream.id || '',
        commandCount: Number(stream.commandCount || 0),
        frameTargetCount: Number(stream.frameTargetCount || 0),
        terminationKind: stream.termination?.kind || '',
        confidence: stream.confidence || '',
        issueCount: Number(stream.issueCount || 0),
      });
    }
  }

  for (const catalog of wb3DecoderArray(map?.animationStaticStreamCatalogs)) {
    for (const stream of wb3DecoderArray(catalog?.staticStreams)) {
      const offset = wb3DecoderParseOffset(stream.offset);
      add(offset, {
        sourceCatalogId: catalog.id || '',
        streamKind: 'static_stream',
        streamId: stream.id || '',
        commandCount: 1,
        frameTargetCount: 1,
        terminationKind: 'static_control_zero',
        confidence: stream.confidence || '',
        staticStream: stream,
      });
    }
  }

  for (const catalog of wb3DecoderArray(map?.animationCommandStaticOverlayCatalogs)) {
    for (const overlay of wb3DecoderArray(catalog?.overlays)) {
      const offset = wb3DecoderParseOffset(overlay.streamOffset);
      add(offset, {
        sourceCatalogId: catalog.id || '',
        streamKind: 'static_overlay',
        streamId: overlay.id || '',
        commandCount: Number(overlay.correctedStaticInterpretation?.commandCount || 1),
        frameTargetCount: Number(overlay.correctedStaticInterpretation?.frameTargetCount || 1),
        terminationKind: overlay.correctedStaticInterpretation?.termination?.kind || 'static_control_zero',
        confidence: overlay.confidence || '',
        staticOverlay: overlay,
      });
    }
  }

  for (const catalog of wb3DecoderArray(map?.entityAnimationCatalogs)) {
    for (const script of wb3DecoderArray(catalog?.scripts)) {
      const offset = wb3DecoderParseOffset(script.offset || script.regionStart);
      add(offset, {
        sourceCatalogId: catalog.id || '',
        streamKind: 'selector_or_script_region',
        role: script.role || '',
        confidence: script.confidence || '',
      });
    }
  }

  return [...byOffset.values()]
    .sort((a, b) => a.offset - b.offset)
    .slice(0, limit || 256);
}

function wb3CollectEntityAnimRegionMetadata(map, region, limit) {
  const analysisEntries = wb3AnalysisEntriesForKeys(region, [
    ['entityAnimationAudit', 'entity_animation_catalog'],
    ['animationRootSemanticsAudit', 'animation_root_or_child_selector_semantics'],
    ['animationCommandStreamAudit', 'normalized_command_stream'],
    ['animationStaticStreamAudit', 'static_animation_stream'],
    ['animationCommandStaticOverlayAudit', 'static_command_overlay'],
    ['animationFamilyAudit', 'animation_family_link'],
    ['animationBehaviorFamilyAudit', 'behavior_animation_family_link'],
    ['animationNonRoomRootUsageAudit', 'non_room_animation_root_usage'],
    ['playerA48CommandStreamAudit', 'player_a48_command_stream'],
    ['playerA48CommandConfidenceTraceAudit', 'player_a48_command_confidence_trace'],
    ['playerA48SelectorTraceQueueAudit', 'player_a48_selector_trace_queue'],
    ['playerA48FrameTraceScaffoldAudit', 'player_a48_frame_trace_scaffold'],
    ['bank1MenuObjectAudit', 'menu_object_motion_script'],
    ['bank4EntityControlAudit', 'bank4_entity_control_script'],
    ['itemVramSelectorAudit', 'item_vram_selector'],
    ['itemVramIdProducerAudit', 'item_vram_id_producer'],
    ['entityAnimationTailAudit', 'entity_animation_tail'],
  ]);
  const regionId = region?.id || '';
  const familyRefs = [];
  for (const catalog of wb3DecoderArray(map?.animationFamilyCatalogs).concat(wb3DecoderArray(map?.animationBehaviorFamilyCatalogs))) {
    for (const family of wb3DecoderArray(catalog?.families)) {
      const streamHit = wb3DecoderArray(family.streams).some(stream => stream?.region?.id === regionId);
      const targetHit = family.selectedTarget?.childEntry?.region?.id === regionId || family.variantTable?.region?.id === regionId || family.directScript?.region?.id === regionId;
      if (!streamHit && !targetHit) continue;
      familyRefs.push({
        sourceCatalogId: catalog.id || '',
        familyId: family.id || '',
        kind: family.kind || '',
        selectorPair: family.selectorPair || null,
        streamCount: wb3DecoderArray(family.streams).length,
        frameTargetCount: wb3DecoderArray(family.frameTargets).length,
        confidence: family.confidence || '',
      });
    }
  }
  return {
    analysisEntries: analysisEntries.slice(0, limit || 64),
    familyRefs: familyRefs.slice(0, limit || 64),
    counts: {
      analysisEntryCount: analysisEntries.length,
      familyRefCount: familyRefs.length,
      metadataResolved: analysisEntries.length + familyRefs.length > 0,
    },
  };
}

function wb3DecodeEntityAnimStaticStreamRegion(asset, region, decoder, stream, metadata, options) {
  const overlay = stream.staticOverlay || null;
  const staticStream = stream.staticStream || null;
  const corrected = overlay?.correctedStaticInterpretation || null;
  const command = corrected?.command || staticStream?.command || {};
  const frame = corrected?.frame || staticStream?.frame || {};
  const commandOffset = wb3DecoderParseOffset(command.commandOffset || stream.offsetHex);
  const frameOffset = wb3DecoderParseOffset(frame.frameOffset || command.frameOffset);
  const commandPreview = {
    index: 0,
    offset: commandOffset,
    offsetHex: command.commandOffset || stream.offsetHex,
    control: wb3DecoderParseOffset(command.control) ?? 0,
    controlHex: command.control || '0x00',
    delay: Number(command.delay || 0),
    startFrame: 0,
    endFrame: 0,
    hasMotionWords: !!command.hasMotionWords,
    motionWords: [],
    framePointer: {
      pointerOffsetHex: command.framePointerOffset || '',
      z80PointerHex: command.frameZ80Pointer || '',
      romOffset: frameOffset,
      romOffsetHex: frame.frameOffset || command.frameOffset || null,
      bank6Pointer: frameOffset != null && wb3IsBank6Offset(frameOffset),
      region: frame.region || command.frameRegion || null,
    },
  };
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `Static animation stream ${stream.offsetHex}; one frame target ${commandPreview.framePointer.romOffsetHex || 'unresolved'} selected by catalog metadata.`,
    {
      offset: wb3DecoderParseOffset(region.offset),
      size: Number(region.size || 0),
      selectedStreamOffset: stream.offset,
      knownStreamStartCount: 1,
      decodedCommandCount: 1,
      frameTargetCount: commandPreview.framePointer.romOffsetHex ? 1 : 0,
      jumpCount: 0,
      timelineFrameCount: 0,
      terminationKind: corrected?.termination?.kind || 'static_control_zero',
      terminationNormal: true,
      motionCommandCount: 0,
      staticStreamResolved: true,
      analysisEntryCount: metadata.counts.analysisEntryCount,
      familyRefCount: metadata.counts.familyRefCount,
    },
    [],
    options.includeTransientPreview ? {
      kind: 'entity_anim_stream',
      selectedStreamOffset: stream.offset,
      selectedStreamOffsetHex: stream.offsetHex,
      streamStarts: [stream],
      commands: [commandPreview],
      jumps: [],
      frameTargets: [{
        sourceCommandOffset: commandPreview.offsetHex,
        pointerOffset: commandPreview.framePointer.pointerOffsetHex,
        z80Pointer: commandPreview.framePointer.z80PointerHex,
        romOffset: commandPreview.framePointer.romOffsetHex,
        region: commandPreview.framePointer.region,
      }],
      timelineFrameCount: 0,
      termination: corrected?.termination || { kind: 'static_control_zero', normal: true, atOffset: stream.offsetHex },
      metadata,
      staticInterpretation: corrected || staticStream || null,
      semantics: {
        routine: '_LABEL_1347_/_LABEL_1330_',
        commandShape: 'Static overlay: control 0x00 plus one bank-6 frame pointer.',
        loopOpcode: 'not used by this selected static frame',
        terminalHoldOpcode: 'control 0x00 leaves IX+16 at zero; _LABEL_1330_ returns without advancing',
      },
    } : null);
}

function wb3DecodeCatalogedEntityAnimScriptRegion(asset, region, decoder, metadata, streamStarts, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const analysis = wb3DecoderObject(region.analysis);
  const roleEntry = metadata.analysisEntries.find(item => ['bank1MenuObjectAudit', 'bank4EntityControlAudit', 'itemVramSelectorAudit', 'itemVramIdProducerAudit', 'entityAnimationAudit', 'animationRootSemanticsAudit'].includes(item.key)) || metadata.analysisEntries[0] || null;
  const detailCounts = {};
  const itemSelector = wb3DecoderObject(analysis.itemVramSelectorAudit);
  const itemProducer = wb3DecoderObject(analysis.itemVramIdProducerAudit);
  if (itemSelector.roles) detailCounts.itemVramSelectorRoleCount = wb3DecoderArray(itemSelector.roles).length;
  if (itemProducer.details) {
    const details = wb3DecoderArray(itemProducer.details);
    detailCounts.itemVramProducerDetailCount = details.length;
    detailCounts.eventCountBeforeTerminator = Number(details[0]?.detail?.eventCountBeforeTerminator || 0);
  }
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${roleEntry?.role || roleEntry?.kind || 'Cataloged entity animation script'} at ${region.offset}; structural consumer metadata resolved from ${metadata.counts.analysisEntryCount} analysis entr${metadata.counts.analysisEntryCount === 1 ? 'y' : 'ies'}.`,
    Object.assign({
      offset,
      size: Number(region.size || 0),
      knownStreamStartCount: streamStarts.length,
      decodedCommandCount: 0,
      frameTargetCount: 0,
      jumpCount: 0,
      timelineFrameCount: 0,
      terminationKind: roleEntry?.kind || roleEntry?.role || 'cataloged_structural_script',
      terminationNormal: true,
      catalogResolved: metadata.counts.metadataResolved,
      analysisEntryCount: metadata.counts.analysisEntryCount,
      familyRefCount: metadata.counts.familyRefCount,
    }, detailCounts),
    [],
    options.includeTransientPreview ? {
      kind: 'entity_anim_catalog_script',
      scriptKind: roleEntry?.kind || '',
      scriptRole: roleEntry?.role || '',
      summary: roleEntry?.summary || '',
      confidence: roleEntry?.confidence || '',
      metadata,
      streamStarts,
      itemVramSelector: itemSelector.roles ? {
        roles: wb3DecoderArray(itemSelector.roles),
        summaries: wb3DecoderArray(itemSelector.summaries),
      } : null,
      itemVramProducer: itemProducer.details ? {
        roles: wb3DecoderArray(itemProducer.roles),
        details: wb3DecoderArray(itemProducer.details).slice(0, 8),
      } : null,
    } : null);
}

function wb3ParseEntityAnimationCommandStream(rom, map, startOffset, options) {
  options = options || {};
  const maxCommands = options.maxCommands || 256;
  const commands = [];
  const jumps = [];
  const frameTargets = [];
  const warnings = [];
  const visited = new Set();
  let pos = startOffset;
  let timelineFrame = 0;
  let termination = null;

  for (let guard = 0; guard < maxCommands; guard++) {
    if (!wb3IsBank6Offset(pos) || pos >= rom.length) {
      termination = { kind: 'left_bank6_range', normal: false, atOffset: wb3DecoderHex(pos) };
      warnings.push(`Stream left bank-6 range at ${wb3DecoderHex(pos)}.`);
      break;
    }
    if (visited.has(pos)) {
      termination = { kind: 'fell_into_visited_offset', normal: false, atOffset: wb3DecoderHex(pos) };
      warnings.push(`Stream reached visited offset ${wb3DecoderHex(pos)} without a 0xFF loop jump.`);
      break;
    }
    visited.add(pos);

    const commandOffset = pos;
    const control = rom[pos++];
    if (control === 0xff) {
      const pointerOffset = pos;
      const z80Pointer = wb3ReadWordLE(rom, pos);
      if (z80Pointer == null) {
        termination = { kind: 'truncated_jump', normal: false, atOffset: wb3DecoderHex(commandOffset) };
        warnings.push(`Truncated jump at ${wb3DecoderHex(commandOffset)}.`);
        break;
      }
      pos += 2;
      const romOffset = wb3Bank6Z80ToRom(z80Pointer);
      const jump = {
        index: jumps.length,
        commandOffset,
        commandOffsetHex: wb3DecoderHex(commandOffset),
        pointerOffset,
        pointerOffsetHex: wb3DecoderHex(pointerOffset),
        z80Pointer,
        z80PointerHex: wb3DecoderHex(z80Pointer, 4),
        romOffset,
        romOffsetHex: romOffset == null ? null : wb3DecoderHex(romOffset),
        region: romOffset == null ? null : wb3FindRegionAtOffset(map, romOffset),
      };
      jumps.push(jump);
      if (romOffset == null || !wb3IsBank6Offset(romOffset)) {
        termination = {
          kind: 'invalid_jump_pointer',
          normal: false,
          atOffset: wb3DecoderHex(commandOffset),
          z80Pointer: wb3DecoderHex(z80Pointer, 4),
        };
        warnings.push(`Jump pointer ${wb3DecoderHex(z80Pointer, 4)} is not a bank-6 animation pointer.`);
        break;
      }
      if (visited.has(romOffset)) {
        termination = {
          kind: 'loop_jump',
          normal: true,
          atOffset: wb3DecoderHex(commandOffset),
          loopTarget: wb3DecoderHex(romOffset),
          z80Pointer: wb3DecoderHex(z80Pointer, 4),
        };
        break;
      }
      pos = romOffset;
      continue;
    }

    const hasMotionWords = !!(control & 0x80);
    const delay = control & 0x7f;
    const command = {
      index: commands.length,
      offset: commandOffset,
      offsetHex: wb3DecoderHex(commandOffset),
      control,
      controlHex: wb3DecoderHex(control, 2),
      delay,
      startFrame: timelineFrame,
      endFrame: timelineFrame + delay,
      hasMotionWords,
      motionWordCount: hasMotionWords ? 2 : 0,
      motionWords: [],
    };
    if (hasMotionWords) {
      if (pos + 3 >= rom.length) {
        termination = { kind: 'truncated_motion_words', normal: false, atOffset: wb3DecoderHex(commandOffset) };
        warnings.push(`Truncated motion words at ${wb3DecoderHex(commandOffset)}.`);
        break;
      }
      command.motionWordsOffset = pos;
      command.motionWordsOffsetHex = wb3DecoderHex(pos);
      command.motionWords = [
        wb3ReadWordLE(rom, pos),
        wb3ReadWordLE(rom, pos + 2),
      ];
      pos += 4;
    }

    const pointerOffset = pos;
    const z80Pointer = wb3ReadWordLE(rom, pos);
    if (z80Pointer == null) {
      termination = { kind: 'truncated_frame_pointer', normal: false, atOffset: wb3DecoderHex(commandOffset) };
      warnings.push(`Truncated frame pointer at ${wb3DecoderHex(commandOffset)}.`);
      break;
    }
    pos += 2;
    const romOffset = wb3Bank6Z80ToRom(z80Pointer);
    command.framePointer = {
      pointerOffset,
      pointerOffsetHex: wb3DecoderHex(pointerOffset),
      z80Pointer,
      z80PointerHex: wb3DecoderHex(z80Pointer, 4),
      romOffset,
      romOffsetHex: romOffset == null ? null : wb3DecoderHex(romOffset),
      bank6Pointer: romOffset != null && wb3IsBank6Offset(romOffset),
      region: romOffset == null ? null : wb3FindRegionAtOffset(map, romOffset),
    };
    commands.push(command);
    if (command.framePointer.bank6Pointer) {
      frameTargets.push({
        sourceCommandOffset: command.offsetHex,
        pointerOffset: command.framePointer.pointerOffsetHex,
        z80Pointer: command.framePointer.z80PointerHex,
        romOffset: command.framePointer.romOffsetHex,
        region: command.framePointer.region,
      });
    } else {
      warnings.push(`Frame pointer ${wb3DecoderHex(z80Pointer, 4)} is not a bank-6 frame pointer.`);
    }
    timelineFrame += delay;

    if (delay === 0) {
      termination = {
        kind: 'terminal_hold_0x00',
        normal: true,
        atOffset: command.offsetHex,
        nextCommandOffset: wb3DecoderHex(pos),
      };
      break;
    }
  }

  if (!termination) {
    termination = { kind: 'command_limit_reached', normal: false, commandLimit: maxCommands };
    warnings.push('Reached animation command parse limit before loop or terminal hold.');
  }

  return {
    startOffset,
    startOffsetHex: wb3DecoderHex(startOffset),
    commands,
    jumps,
    frameTargets,
    timelineFrameCount: timelineFrame,
    termination,
    warnings,
  };
}

function wb3DecodeEntityAnimTableRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const size = Number(region.size || 0);
  const entryCount = Math.floor(size / 2);
  const entries = [];
  let bank6PointerCount = 0;
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = offset + i * 2;
    const z80Pointer = wb3ReadWordLE(rom, entryOffset);
    const romOffset = z80Pointer == null ? null : wb3Bank6Z80ToRom(z80Pointer);
    if (romOffset != null && wb3IsBank6Offset(romOffset)) bank6PointerCount++;
    entries.push({
      index: i,
      entryOffset,
      entryOffsetHex: wb3DecoderHex(entryOffset),
      z80Pointer,
      z80PointerHex: z80Pointer == null ? null : wb3DecoderHex(z80Pointer, 4),
      romOffset,
      romOffsetHex: romOffset == null ? null : wb3DecoderHex(romOffset),
      region: romOffset == null ? null : wb3FindRegionAtOffset(map, romOffset),
    });
  }
  const warnings = [];
  if (size % 2) warnings.push('Entity animation pointer table has an odd byte size.');
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${entryCount} pointer entr${entryCount === 1 ? 'y' : 'ies'}; ${bank6PointerCount} resolve to bank-6 animation data.`,
    {
      offset,
      size,
      entryCount,
      bank6PointerCount,
      validRatio: entryCount ? bank6PointerCount / entryCount : 0,
    },
    warnings,
    options.includeTransientPreview ? {
      kind: 'entity_anim_table',
      entries: entries.slice(0, options.entityAnimTablePreviewLimit || 96),
      entryCount,
      bank6PointerCount,
    } : null);
}

function wb3DecodeEntityAnimScriptRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const size = Number(region.size || 0);
  const streamStarts = wb3CollectAnimationStreamStarts(map, region, options.entityAnimStreamStartLimit || 256);
  const metadata = wb3CollectEntityAnimRegionMetadata(map, region, options.entityAnimMetadataLimit || 128);
  const preferredStream = streamStarts.find(stream => stream.streamKind === 'static_overlay')
    || streamStarts.find(stream => stream.streamKind === 'static_stream')
    || streamStarts.find(stream => stream.streamKind === 'command_stream' && Number(stream.commandCount || 0) > 0)
    || null;
  const streamOffset = options.streamOffset != null
    ? Number(options.streamOffset)
    : (preferredStream?.offset ?? null);
  if (preferredStream && (preferredStream.streamKind === 'static_overlay' || preferredStream.streamKind === 'static_stream')) {
    return wb3DecodeEntityAnimStaticStreamRegion(asset, region, decoder, preferredStream, metadata, options);
  }
  if (!wb3IsBank6Offset(streamOffset)) {
    return wb3DecodeCatalogedEntityAnimScriptRegion(asset, region, decoder, metadata, streamStarts, options);
  }
  if (!preferredStream || preferredStream.streamKind !== 'command_stream') {
    return wb3DecodeCatalogedEntityAnimScriptRegion(asset, region, decoder, metadata, streamStarts, options);
  }
  const warnings = [];
  const parsed = wb3ParseEntityAnimationCommandStream(rom, map, streamOffset, {
    maxCommands: options.maxEntityAnimCommands || 256,
  });
  const parserWarnings = parsed.warnings || [];
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${parsed.commands.length} command(s), ${parsed.frameTargets.length} frame pointer(s), ${parsed.jumps.length} jump(s), termination ${parsed.termination.kind}; ${parserWarnings.length} cataloged parser issue(s).`,
    {
      offset,
      size,
      selectedStreamOffset: streamOffset,
      knownStreamStartCount: streamStarts.length,
      decodedCommandCount: parsed.commands.length,
      frameTargetCount: parsed.frameTargets.length,
      jumpCount: parsed.jumps.length,
      timelineFrameCount: parsed.timelineFrameCount,
      terminationKind: parsed.termination.kind,
      terminationNormal: !!parsed.termination.normal,
      motionCommandCount: parsed.commands.filter(command => command.hasMotionWords).length,
      parserWarningCount: parserWarnings.length,
      catalogIssueCount: Number(preferredStream.issueCount || 0),
      analysisEntryCount: metadata.counts.analysisEntryCount,
      familyRefCount: metadata.counts.familyRefCount,
    },
    warnings,
    options.includeTransientPreview ? {
      kind: 'entity_anim_stream',
      selectedStreamOffset: streamOffset,
      selectedStreamOffsetHex: wb3DecoderHex(streamOffset),
      streamStarts,
      commands: parsed.commands.slice(0, options.entityAnimCommandPreviewLimit || 128),
      jumps: parsed.jumps.slice(0, options.entityAnimJumpPreviewLimit || 32),
      frameTargets: parsed.frameTargets.slice(0, options.entityAnimFrameTargetPreviewLimit || 128),
      timelineFrameCount: parsed.timelineFrameCount,
      termination: parsed.termination,
      metadata,
      parserWarnings: parserWarnings.slice(0, options.entityAnimParserWarningPreviewLimit || 64),
      semantics: {
        routine: '_LABEL_1347_',
        commandShape: 'control/delay byte; optional two motion words when bit 7 is set; then frame/metasprite pointer.',
        loopOpcode: '0xFF plus bank-6 pointer',
        terminalHoldOpcode: 'delay 0 stores IX+16=0 and holds selected frame',
      },
    } : null);
}

function wb3DecodeEntityAnimationRegion(asset, region, rom, map, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  if (!rom || offset == null) return wb3MakeDecodeResult(decoder, asset, region, 'needs_rom', 'Load the local ROM to decode this animation table or command stream.', {}, [], null);
  if (region.type === 'entity_anim_table') return wb3DecodeEntityAnimTableRegion(asset, region, rom, map, decoder, options);
  return wb3DecodeEntityAnimScriptRegion(asset, region, rom, map, decoder, options);
}

function wb3ParseBfdInputScript(rom, offset, options) {
  options = options || {};
  const maxRecords = options.maxRecords || 4096;
  const regionEnd = options.regionEnd || rom.length;
  const records = [];
  const leadingByte = rom[offset];
  let pos = offset + 1;
  let endReason = 'Unexpected EOF';
  while (pos < rom.length && pos < regionEnd && records.length < maxRecords) {
    const duration = rom[pos];
    if (duration === 0) {
      endReason = `Duration terminator at ${wb3DecoderHex(pos)}`;
      break;
    }
    if (pos + 1 >= rom.length || pos + 1 >= regionEnd) {
      endReason = `Truncated command byte at ${wb3DecoderHex(pos)}`;
      break;
    }
    const command = rom[pos + 1];
    const bits = wb3InputCommandName(command);
    records.push({
      index: records.length,
      offset: pos,
      duration,
      command,
      directionBits: bits.directionBits,
      actionBits: bits.actionBits,
      directionLabel: bits.directionLabel,
      actionLabel: bits.actionLabel,
    });
    pos += 2;
  }
  if (records.length >= maxRecords) endReason = 'Reached record limit';
  const terminatorOffset = pos;
  return {
    leadingByte,
    records,
    terminatorOffset,
    consumedBytes: Math.min(regionEnd, terminatorOffset + 1) - offset,
    endReason,
    stats: {
      recordCount: records.length,
      frameDurationTotal: records.reduce((sum, record) => sum + record.duration, 0),
      uniqueCommandCount: new Set(records.map(record => record.command)).size,
      durationCounts: wb3CountNumericValues(records, 'duration').slice(0, 16),
      commandCounts: wb3CountNumericValues(records, 'command').slice(0, 16),
      directionBitCounts: wb3CountNumericValues(records, 'directionBits').slice(0, 16),
      actionBitCounts: wb3CountNumericValues(records, 'actionBits').slice(0, 16),
    },
  };
}

function wb3DecodeInputScriptRegion(asset, region, rom, decoder, options) {
  const offset = wb3DecoderParseOffset(region.offset);
  const size = Number(region.size || 0);
  if (!rom || offset == null) return wb3MakeDecodeResult(decoder, asset, region, 'needs_rom', 'Load the local ROM to decode this input script.', {}, [], null);
  const decoded = wb3ParseBfdInputScript(rom, offset, {
    regionEnd: offset + size,
    maxRecords: options.maxRecords || 4096,
  });
  const warnings = [];
  if (decoded.terminatorOffset >= offset + size) warnings.push('No duration terminator found before region end.');
  const tailBytes = Math.max(0, offset + size - decoded.terminatorOffset - 1);
  return wb3MakeDecodeResult(decoder, asset, region, 'decoded',
    `${decoded.stats.recordCount} input record(s), ${decoded.stats.frameDurationTotal} total frame(s), ${decoded.stats.uniqueCommandCount} unique command byte(s).`,
    {
      offset,
      size,
      leadingByte: decoded.leadingByte,
      recordCount: decoded.stats.recordCount,
      frameDurationTotal: decoded.stats.frameDurationTotal,
      uniqueCommandCount: decoded.stats.uniqueCommandCount,
      terminatorOffset: decoded.terminatorOffset,
      consumedBytes: decoded.consumedBytes,
      tailBytes,
      endReason: decoded.endReason,
      durationCounts: decoded.stats.durationCounts,
      commandCounts: decoded.stats.commandCounts,
      directionBitCounts: decoded.stats.directionBitCounts,
      actionBitCounts: decoded.stats.actionBitCounts,
    },
    warnings,
    options.includeTransientPreview ? {
      kind: 'input_script_bfd',
      leadingByte: decoded.leadingByte,
      records: decoded.records.slice(0, options.inputScriptPreviewLimit || 80),
      stats: decoded.stats,
      endReason: decoded.endReason,
      tailBytes,
    } : null);
}

function wb3DecodeMetadataOnly(asset, region, decoder) {
  const summary = region
    ? `${region.type || 'region'} ${region.id || ''} at ${region.offset || '?'} (${region.size || 0} bytes).`
    : `${asset?.kind || 'asset'} metadata item.`;
  return wb3MakeDecodeResult(decoder, asset, region, 'metadata_only', summary, {
    implementationPercent: decoder?.implementationPercent || 0,
  }, [], null);
}

function wb3DecodeAsset(asset, rom, map, options) {
  options = options || {};
  const region = options.region || wb3ResolveAssetRegion(asset, map);
  const decoder = wb3PreferredDecoderForAsset(asset, region, options.decoderId);
  if (!decoder) return wb3MakeDecodeResult(null, asset, region, 'no_decoder', 'No decoder is registered for this asset yet.', {}, [], null);
  const exactRomDecoder = ['sms_4bpp_tiles', 'sms_cram_palette', 'tile_map_layout', 'z80_pointer_table_le', 'screen_prog_table', 'screen_prog_604', 'vram_loader_8fb', 'vram_loader_998', 'palette_vdp_script', 'room_zone_records', 'metasprite_records', 'entity_animation_streams', 'entity_item_records', 'music_stream_experimental', 'text_ascii_probe', 'input_script_bfd'].includes(decoder.id);
  if (!rom && exactRomDecoder) {
    const action = wb3DecoderArray(decoder.previewCapabilities).includes('audio') ? 'listening probe' : 'decoder preview';
    return wb3MakeDecodeResult(decoder, asset, region, 'needs_rom', `Load the local ROM to run this ${action}.`, {}, [], null);
  }
  if (!rom && decoder.previewCapabilities && decoder.previewCapabilities.includes('visual')) {
    return wb3MakeDecodeResult(decoder, asset, region, 'needs_rom', 'Load the local ROM to run this preview decoder.', {}, [], null);
  }
  if (!rom && decoder.previewCapabilities && decoder.previewCapabilities.includes('audio')) {
    return wb3MakeDecodeResult(decoder, asset, region, 'needs_rom', 'Load the local ROM to run this listening probe.', {}, [], null);
  }
  if (!region) return wb3DecodeMetadataOnly(asset, region, decoder);

  if (decoder.id === 'sms_4bpp_tiles') return wb3DecodeTileRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'sms_cram_palette') return wb3DecodePaletteRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'tile_map_layout') return wb3DecodeTileMapRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'z80_pointer_table_le') return wb3DecodePointerRegion(asset, region, rom, decoder, options);
  if (decoder.id === 'screen_prog_table') return wb3DecodeScreenProgTableRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'screen_prog_604') return wb3DecodeScreenProgRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'vram_loader_8fb' || decoder.id === 'vram_loader_998') return wb3DecodeVramLoaderRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'palette_vdp_script') return wb3DecodePaletteVdpScriptRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'room_zone_records') return wb3DecodeRoomZoneRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'collision_runtime_catalogs') return wb3DecodeCollisionRuntimeRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'metasprite_records') return wb3DecodeMetaspriteRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'entity_animation_streams') return wb3DecodeEntityAnimationRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'entity_item_records') return wb3DecodeEntityItemRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'audio_driver_runtime_metadata') return wb3DecodeAudioDriverRuntimeRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'music_stream_experimental') return wb3DecodeMusicRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'text_ascii_probe') return wb3DecodeTextRegion(asset, region, rom, decoder, options);
  if (decoder.id === 'text_menu_status_records') return wb3DecodeTextMenuStatusRegion(asset, region, rom, map, decoder, options);
  if (decoder.id === 'input_script_bfd') return wb3DecodeInputScriptRegion(asset, region, rom, decoder, options);
  return wb3DecodeMetadataOnly(asset, region, decoder);
}

function wb3AssetMatchesBrowser(asset, browser, map) {
  if (!browser) return true;
  if (wb3DecoderArray(browser.assetKinds).includes(asset?.kind || '')) return true;
  const region = wb3ResolveAssetRegion(asset, map);
  if (region && wb3DecoderArray(browser.regionTypes).includes(region.type || '')) return true;
  const text = [
    asset?.id,
    asset?.kind,
    asset?.name,
    asset?.status,
    asset?.confidence,
    asset?.summary,
    asset?.notes,
    ...wb3DecoderArray(asset?.references).map(ref => `${ref.kind || ref.type} ${ref.id || ''} ${ref.role || ''}`),
  ].join(' ').toLowerCase();
  return wb3DecoderArray(browser.keywords).some(keyword => text.includes(String(keyword).toLowerCase()));
}

function wb3BuildDecoderCoverage(map, model) {
  const sourceMap = wb3DecoderObject(map);
  const browsers = wb3DecoderArray(sourceMap.assetDataBrowsers?.browsers);
  const assets = wb3DecoderArray(model?.assets);
  const regions = wb3DecoderArray(sourceMap.regions);
  const regionTypeCounts = {};
  for (const region of regions) {
    const type = region?.type || 'unknown';
    regionTypeCounts[type] = (regionTypeCounts[type] || 0) + 1;
  }

  const decoders = WB3_DECODER_DEFS.map(decoder => {
    let matchedRegionCount = 0;
    for (const type of wb3DecoderArray(decoder.regionTypes)) matchedRegionCount += regionTypeCounts[type] || 0;
    if (decoder.id === 'collision_runtime_catalogs') {
      matchedRegionCount = wb3DecoderArray(sourceMap.regions).filter(region => wb3IsCollisionRuntimeRegion(region)).length;
    }
    if (decoder.id === 'audio_driver_runtime_metadata') {
      matchedRegionCount = wb3DecoderArray(sourceMap.regions).filter(region => wb3IsAudioDriverRuntimeRegion(region)).length;
    }
    if (decoder.id === 'text_menu_status_records') {
      matchedRegionCount = wb3DecoderArray(sourceMap.regions).filter(region => wb3IsTextMenuStatusRegion(region)).length;
    }
    let matchedAssetCount = 0;
    for (const asset of assets) {
      const region = wb3ResolveAssetRegion(asset, sourceMap);
      if (wb3DecodersForAsset(asset, region).some(candidate => candidate.id === decoder.id)) matchedAssetCount++;
    }
    if (decoder.id === 'ram_symbol_index') matchedAssetCount += wb3DecoderArray(sourceMap.ram).length;
    const capabilities = wb3DecoderArray(decoder.previewCapabilities);
    const matchedRegions = regions.filter(region => wb3DecoderMatchesRegion(decoder, region));
    const labelStateCounts = {};
    for (const region of matchedRegions) {
      const state = wb3RegionLabelState(region);
      labelStateCounts[state] = (labelStateCounts[state] || 0) + 1;
    }
    return Object.assign({}, decoder, {
      matchedRegionCount,
      matchedAssetCount,
      labelQueueCount: matchedRegions.length,
      needsLabelCount: (labelStateCounts.needs_type || 0) + (labelStateCounts.needs_label || 0) + (labelStateCounts.needs_name || 0) + (labelStateCounts.needs_notes || 0),
      semanticLabelCount: labelStateCounts.semantic_label || 0,
      labelStateCounts,
      isRunnablePreview: ['visual', 'audio', 'timeline', 'text'].some(capability => capabilities.includes(capability)),
    });
  });

  const labelQueue = [];
  const uniqueQueueRegions = new Set();
  const uniqueNeedsLabelRegions = new Set();
  for (const decoder of decoders) {
    for (const region of regions) {
      if (!wb3DecoderMatchesRegion(decoder, region)) continue;
      const labelState = wb3RegionLabelState(region);
      const needsLabel = labelState !== 'semantic_label';
      const tags = wb3DecoderLabelQueueTags(decoder, region, labelState);
      uniqueQueueRegions.add(region.id);
      if (needsLabel) uniqueNeedsLabelRegions.add(region.id);
      labelQueue.push({
        decoderId: decoder.id,
        decoderLabel: decoder.label,
        familyId: decoder.familyId,
        status: decoder.status,
        implementationPercent: decoder.implementationPercent,
        previewCapabilities: wb3DecoderArray(decoder.previewCapabilities),
        regionId: region.id || '',
        regionType: region.type || '',
        offset: region.offset || '',
        size: Number(region.size || 0),
        name: region.name || '',
        confidence: region.confidence || '',
        labelState,
        needsLabel,
        tags,
        priority: wb3RegionLabelPriority(labelState),
        notes: region.notes || '',
      });
    }
  }
  labelQueue.sort((a, b) => a.priority - b.priority || a.familyId.localeCompare(b.familyId) || a.decoderId.localeCompare(b.decoderId) || String(a.offset).localeCompare(String(b.offset)));

  const familyCoverage = WB3_DECODER_FAMILY_DEFS.map(family => {
    const familyDecoders = decoders.filter(decoder => decoder.familyId === family.id);
    let weightedTotal = 0;
    let weight = 0;
    for (const decoder of familyDecoders) {
      const decoderWeight = Math.max(1, decoder.matchedRegionCount || decoder.matchedAssetCount || 0);
      weightedTotal += decoder.implementationPercent * decoderWeight;
      weight += decoderWeight;
    }
    const browser = browsers.find(item => item.id === family.id) || null;
    const assetCount = browser ? assets.filter(asset => wb3AssetMatchesBrowser(asset, browser, sourceMap)).length : 0;
    const familyLabelQueue = labelQueue.filter(item => item.familyId === family.id);
    return Object.assign({}, family, {
      decoderCount: familyDecoders.length,
      assetCount,
      matchedRegionCount: familyDecoders.reduce((sum, decoder) => sum + decoder.matchedRegionCount, 0),
      labelQueueCount: familyLabelQueue.length,
      needsLabelCount: familyLabelQueue.filter(item => item.needsLabel).length,
      completionPercent: weight ? Math.round(weightedTotal / weight) : 0,
      visualPreviewCount: familyDecoders.filter(decoder => wb3DecoderArray(decoder.previewCapabilities).includes('visual')).length,
      audioPreviewCount: familyDecoders.filter(decoder => wb3DecoderArray(decoder.previewCapabilities).includes('audio')).length,
      blockers: familyDecoders
        .filter(decoder => decoder.implementationPercent < 70)
        .map(decoder => `${decoder.label}: ${decoder.remainingWork}`),
    });
  });

  let totalWeight = 0;
  let totalScore = 0;
  for (const decoder of decoders) {
    const w = Math.max(1, decoder.matchedRegionCount || decoder.matchedAssetCount || 0);
    totalWeight += w;
    totalScore += decoder.implementationPercent * w;
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    assetPolicy: 'Metadata only: decoder ids, labels, family ids, percentages, region types, counts, evidence and remaining-work notes. No ROM bytes, decoded assets, pixels, palette values, audio samples or instruction bytes are stored.',
    summary: {
      decoderCount: decoders.length,
      familyCount: familyCoverage.length,
      weightedImplementationPercent: totalWeight ? Math.round(totalScore / totalWeight) : 0,
      visualPreviewDecoderCount: decoders.filter(decoder => wb3DecoderArray(decoder.previewCapabilities).includes('visual')).length,
      audioPreviewDecoderCount: decoders.filter(decoder => wb3DecoderArray(decoder.previewCapabilities).includes('audio')).length,
      regionTypeCount: Object.keys(regionTypeCounts).length,
      labelQueueEntryCount: labelQueue.length,
      labelQueueUniqueRegionCount: uniqueQueueRegions.size,
      labelQueueNeedsLabelUniqueRegionCount: uniqueNeedsLabelRegions.size,
      labelQueueVisualEntryCount: labelQueue.filter(item => item.previewCapabilities.includes('visual')).length,
      labelQueueAudioEntryCount: labelQueue.filter(item => item.previewCapabilities.includes('audio')).length,
    },
    families: familyCoverage,
    decoders,
    labelQueue,
    regionTypeCounts,
  };
}
