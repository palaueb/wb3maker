'use strict';

// ═══════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════
var BANK_SIZE   = 0x4000;   // 16 KB per bank
var BANK_COUNT  = 16;

var TYPE_META = {
  gfx_tiles:   {label:'GFX Tiles',   color:'#ff6b35'},
  gfx_sprites: {label:'GFX Sprites', color:'#ff35a0'},
  tile_map:    {label:'Tile Map',    color:'#00e5cc'},
  palette:     {label:'Palette',     color:'#ffcc00'},
  palette_script_table:{label:'Palette Script Table', color:'#facc15'},
  palette_script:{label:'Palette Script', color:'#fde047'},
  map_screens: {label:'Map/Screens', color:'#00ff88'},
  pointer_table:   {label:'Pointer Table',   color:'#7ee787'},
  code:        {label:'Code',        color:'#4a9eff'},
  music:       {label:'Music/SFX',   color:'#a855f7'},
  audio_driver_data: {label:'Audio Driver Data', color:'#d97706'},
  text:        {label:'Text',        color:'#6bffb8'},
  raw_byte:    {label:'Raw Byte',    color:'#f59e0b'},
  meta_sprite:     {label:'Metasprite',      color:'#ff88aa'},
  entity_data:      {label:'Entity Data',     color:'#22c55e'},
  entity_behavior_table:{label:'Entity Behavior Table', color:'#84cc16'},
  entity_anim_table:{label:'Entity Anim Table', color:'#38bdf8'},
  entity_anim_script:{label:'Entity Anim Script', color:'#fb7185'},
  item_data:       {label:'Item Data',       color:'#fbbf24'},
  input_script:     {label:'Input Script',    color:'#f97316'},
  effect_script:    {label:'Effect Script',   color:'#f43f5e'},
  palette_manual:  {label:'Palette (custom)',color:'#ffa500'},
  data_table:      {label:'Data Table',       color:'#e8a020'},
  data_array:      {label:'Data Array',       color:'#c0882a'},
  screen_prog:     {label:'Single Screen Map', color:'#00d4ff'},
  screen_prog_table:{label:'Screen Prog Table', color:'#38bdf8'},
  vdp_stream:      {label:'VDP Stream',        color:'#60a5fa'},
  scroll_map:      {label:'Scroll Map',        color:'#4ade80'},
  vram_loader_8fb: {label:'VRAM Loader 8FB',  color:'#c084fc'},
  vram_loader_998: {label:'VRAM Loader 998',  color:'#f472b6'},
  dynamic_tile_loader:{label:'Dynamic Tile Loader', color:'#fb923c'},
  room_data:       {label:'Room Data',        color:'#22d3ee'},
  room_subrecord:  {label:'Room Subrecord',   color:'#8bd450'},
  room_seq_table:  {label:'Room Seq Table',   color:'#57d3a0'},
  null:            {label:'NULL',             color:'#333355'},
  unknown:         {label:'Unknown',         color:'#555577'},
};

var KNOWN_ROMS = {
  // 'md5': {version:'World', region:'WLD'},
};

var DEFAULT_PALETTE = [
  '#000000','#AA0000','#00AA00','#AA5500',
  '#0000AA','#AA00AA','#00AAAA','#AAAAAA',
  '#555555','#FF5555','#55FF55','#FFFF55',
  '#5555FF','#FF55FF','#55FFFF','#FFFFFF',
];


// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
var romData = null;
var romMD5   = '';
var romCRC32 = '';
var romName  = '';
var asmFileName = '';

var mapData = {
  schemaVersion:3, romVersion:'unknown',
  romMD5:'', romName:'', romSizeBytes:0,
  regions:[], compositions:[], ram:[], simScenes:[], sceneRecipes:[], sceneRecipeCatalogs:[], zoneRecipes:[], inlineTransitionRecipes:[], zoneGraphs:[], audioCatalogs:[], audioRequestTaxonomyCatalogs:[], entityDataCatalogs:[], entityAnimationCatalogs:[], entityBehaviorCatalogs:[], entityBehaviorCodeCatalogs:[], entityBehaviorSplitCatalogs:[], entityBehaviorFragmentCatalogs:[], entityObjectRecordCatalogs:[], itemDataCatalogs:[], roomDataCatalogs:[], metaspriteCatalogs:[], inputScriptCatalogs:[], effectScriptCatalogs:[], smallDataCatalogs:[], vdpStreamCatalogs:[], fragmentCatalogs:[], tileSourceCatalogs:[], screenProgCatalogs:[], screenProgEmbeddedContinuationProofCatalogs:[], overlapCatalogs:[], paletteCatalogs:[], graphicsCatalogs:[], playerCatalogs:[], playerRuntimeCatalogs:[], engineModuleCatalogs:[], assetReadinessCatalogs:[], blankMetaspriteQuarantineProofCatalogs:[], gearsystemMcpBridgeCatalogs:[], residualClosureCatalogs:[], residualLiveClosureStatusCatalogs:[], residualProofUpdatePlanCatalogs:[], residualSemanticDispositionPlanCatalogs:[], residualRuntimeClosurePipelineCatalogs:[], residualRuntimeCaptureChecklistCatalogs:[], runtimeTraceHookCatalogs:[], runtimeTraceHookFixtureCatalogs:[], runtimeTraceEventContractCatalogs:[], runtimeTraceHookBridgeCatalogs:[], runtimeTraceObservationAuditCatalogs:[], runtimeTraceEvaluatorCatalogs:[], runtimeTraceConfirmationCatalogs:[], analysisReports:[], notes:'',
  gameDataModel:{},
};

var viewerPalette = [...DEFAULT_PALETTE];
var paletteRotation = 0;   // 0–15, shifts color index lookup
var _idCounter    = 1;
var _pendingAsmRegions = null;   // regions parsed from ASM, awaiting confirmation
var asmAnalysis = null;
var _pendingAsmSplitPlan = null;
var asmText = null;  // stored when .asm is loaded
