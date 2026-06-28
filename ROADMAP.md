# Wonder Boy III JavaScript Recreation and WB3 Maker Roadmap

This roadmap replaces the old "standalone extractors" plan with a path toward recreating the game in JavaScript from the original ROM loaded locally by the user.

The goal is not to build a full Master System emulator or export a modified ROM. The goal is to build a data-driven JavaScript engine that uses `projects/WORLD/map.json`, the analysis catalogs, and the user's ROM to reconstruct the game in the browser, then use that foundation to create new content with a WB3 Maker that preserves the technical and visual language of the Master System.

## Principles

- The user provides their own `.sms` ROM. The project does not distribute game assets or ROM bytes.
- `map.json` is the central model: offsets, regions, RAM, catalogs, recipes, and relationships.
- The `tools/world-*.mjs` scripts are reproducible analysis passes. They must explain where each piece of data comes from.
- The UI must distinguish persisted `map.json` metadata from runtime previews computed from the local ROM.
- The JavaScript recreation should move forward through playable slices, not a full rewrite attempted all at once.
- The runtime must separate two modes: original-data compatibility and expanded maker mode.
- Maker mode preserves the visible Master System rules: screen basis, tiles, palettes, color, and visual readability.
- Maker mode only relaxes quantity budgets: more sprites, more entities, more rooms, more triggers, more music, and more project data than would comfortably fit in the original ROM.
- Exporting a patched SMS ROM is out of scope for now because of space, pointer, compression, and compatibility complexity.

## Vision: WB3 Maker

The long-term creative goal is for the project to work like an RPG Maker specialized for Wonder Boy III: an environment where the original game is the foundation, but creators can add much more content while preserving the technical identity of the Master System.

The engine should support two profiles:

- **Original Compatibility Mode**: reproduces the original ROM data with the highest practical fidelity. This validates the analysis, enables behavior comparison, and plays the original content.
- **Expanded Maker Mode**: uses the same visual and structural language, keeps the visible Master System technical restrictions, and expands only quantity and content limits.

Expanded Maker Mode could allow:

- complete games created from a blank project, not only edits of the original game;
- original-game forks that redesign screens, pacing, secrets, enemies, items, music, or progression;
- title, intro, inter-zone, boss-defeat, transformation, non-transformation, and ending cutscenes built from WB3-style screen, sprite, text, music, and event systems;
- more simultaneous sprites;
- more entities and active elements on screen;
- larger maps and rooms;
- new entities;
- new behavior types;
- new items, NPCs, triggers, and events;
- new music and SFX;
- original assets mixed with user-created assets;
- validated import of user-created sprites, tiles, backgrounds, music, and SFX;
- high-level scripts and events;
- expanded gameplay rules;
- published project versions that can be forked into new branches;
- remix or mashup projects that combine compatible work from multiple creators;
- exportable project packs for the JavaScript runtime.

Expanded Maker Mode must preserve:

- SMS-style screen resolution and screen basis;
- 8x8 tiles as the main visual unit;
- palettes and color restrictions compatible with the SMS look;
- sprites and metasprites with 8-bit readability;
- scroll, camera, and composition that still feel like WB3;
- no modern effects that break the visual language, except debug overlays.

This does not imply exporting back to an SMS ROM. Expanded projects live as data for the JavaScript engine.

Maker projects should support three starting points:

- **Original-game fork**: start from the analyzed original game and change maps, events, pacing, enemies, secrets, audio, or tuning.
- **Published-project fork**: start from a released project version and build a new branch from it.
- **Blank project**: create a complete WB3-style game from zero, including intro, world structure, rooms, transformations, bosses, cutscenes, ending, music, and custom assets.

Published versions should be treated as immutable releases. They can receive bug-fix revisions, but new creative changes should happen through forks so that other creators can build on a stable version without overwriting it.

## Current State

- ROM coverage: the map covers the known ROM at region level.
- ROM Analyzer: active and extended with catalogs, previews, RAM map, zone browser, and SMS state simulation.
- Catalogs: analysis passes exist for audio, zones, rooms, entities, animations, palettes, VDP, screen programs, player state, and collisions.
- Partial runtime: `tools/js/panel-simulator.js` already contains decoders and local simulations for VRAM loaders, zone recipes, tile provenance, audio request graphs, and several previews.
- Main pending work: consolidate this knowledge into stable APIs and runtime modules, not only audit tools.
- Creative direction: turn the JavaScript recreation into a WB3 Maker foundation that expands quantity while preserving the SMS technical language.

## Phase 0: ROM Intelligence

Goal: understand and audit the ROM with traceability.

Status: active / advanced.

Includes:

- ROM fingerprint, MD5, CRC32, and basic metadata.
- ROM region map by type.
- RAM map with known variables, buffers, and roles.
- ASM disassembly import.
- Text, label, pointer, and cross-reference search.
- `world-*.mjs` catalogs that produce reproducible metadata.
- Coverage, overlap, gap, and explained-region reports.
- Evidence views showing which routine, region, or catalog justifies each conclusion.

Deliverables:

- `projects/WORLD/map.json` as the canonical model.
- Reproducible audit scripts.
- UI for inspecting regions, RAM, and catalogs.

## Phase 1: Data Model Consolidation

Goal: turn accumulated analysis into clean reader APIs.

Includes:

- Normalize catalog names, ids, and schemas.
- Clearly separate `persisted metadata` from `runtime preview data`.
- Create helpers to read:
  - zone recipes
  - room subrecords
  - door/transition tables
  - DC2 scroll maps
  - screen programs
  - palettes
  - VRAM loader scripts
  - metasprites
  - entity lists
  - player state graphs
  - audio request graphs
- Document dependencies between catalogs.
- Reduce duplication between `tools/world-*.mjs` and `tools/js/panel-simulator.js`.

Deliverables:

- Internal JS modules such as `readZoneRecipe()`, `decodeDc2Map()`, `decodeScreenProgram()`, and `readEntityList()`.
- Documented schemas for the most important catalogs.
- Validations that detect stale or missing catalogs.

## Phase 2: Asset and Data Browsers

Goal: browse every game data family as understandable structures, not opaque bytes.

Includes:

- Tile / palette / VRAM browser.
- Screen program browser.
- Zone / room recipe browser.
- Door and transition graph browser.
- Collision map browser.
- Metasprite browser.
- Sprite animation browser.
- Entity list browser.
- Entity behavior browser.
- Music request / stream browser.
- SFX and audio request browser.
- Text, HUD, menu, inventory, and password data browsers.
- RAM role browser.

Deliverables:

- Read-only views for each data family.
- Links from each view to the ROM offset, region, RAM entry, and report that justify it.
- Visual previews that do not write ROM bytes into `map.json`.

## Phase 3: Runtime Reconstruction

Goal: build the JavaScript engine that can execute the game model without emulating the full console.

This is the missing step between "extractors" and "editor/player".

### 3A: SMS-like Render Core

- Synthetic VRAM.
- Synthetic CRAM.
- Name table.
- SMS 4bpp tile decoder.
- Sprite Attribute Table model.
- Canvas/WebGL renderer.
- Debug overlays for tile, palette, priority, hflip/vflip, and provenance.

### 3B: Room and Zone Loader

- Execute zone recipes.
- Apply common prerequisites.
- Execute `_LABEL_8FB_`, `_LABEL_998_`, and dynamic loader variants.
- Resolve DC2 scroll maps.
- Render single-screen rooms and scrolling zones.
- Reproduce doors and zone transitions.

### 3C: Camera, Scroll, and Collision

- Horizontal and vertical camera model.
- Scroll update flags.
- Collision buffers.
- Room/zone bounds.
- Door trigger runtime.
- Column redraw during scrolling.

### 3D: Player Runtime

- Player forms.
- Player state machine.
- Movement and physics model.
- Jump/fall/ladder/swim/wall states where applicable.
- Hitboxes, damage, knockback, and invulnerability.
- Spawn and transition placement.

### 3E: Entity Runtime

- Entity list loader.
- Entity slot structs.
- Sprite/metasprite binding.
- Sprite animator.
- Movement/physics generator for entities.
- Behavior runner for known behavior families.
- Collision with player, world, and projectiles.
- Dynamic tile uploads for entities.

### 3F: Audio Runtime

- Music request browser/player.
- SFX/audio request browser/player.
- Audio stream decoder.
- Opcode/state trace preview.
- Frame-step audio model.
- PSG/FM-like output abstraction.

Note: this can start as a diagnostic player or simplified WebAudio layer. Exact fidelity to the original driver can come later.

### 3G: UI, HUD, and Game State

- HUD/status/inventory.
- Menus and pause/status screens.
- Password/save/progression model.
- Room flags and game flags.
- Death, continue, and transition screens.

Deliverables:

- First playable slice: load local ROM, open a zone recipe, render it, move the player with basic collision, and cross a door.
- Frame-step debugger for reproducing one frame of the reconstructed runtime.

## Phase 4: Editors and Tuning Tools

Goal: edit high-level data after the runtime can already read and execute it.

Includes:

- Room editor.
- Zone editor.
- Door/transition editor.
- Collision editor.
- Entity placement editor.
- Entity behavior mapper.
- Sprite animation editor.
- Palette editor.
- Tile/VRAM assignment editor.
- Music/SFX assignment editor.
- Screen program editor.
- HUD/menu/status editor.

Practical rule:

- First edit fixed-size, low-risk fields.
- Then edit compact streams or pointer-backed data.
- Do not assume everything can be reinserted into the original SMS ROM.

Deliverables:

- Editing on a project-owned layer.
- High-level diffs against `map.json`.
- Constraint validation before saving changes.

## Phase 5: Playable JavaScript Recreation

Goal: play a progressive browser recreation of the game.

Includes:

- Boot a game from the local ROM.
- Scene/zone selection for debugging.
- Player movement/combat.
- Main entities.
- Doors and transitions.
- Collision and camera.
- Functional audio.
- HUD and inventory.
- Runtime-owned save state.

Deliverables:

- Playable debug build.
- List of playable rooms/zones.
- Behavior matrix by entity and system.

## Phase 6: WB3 Maker Expanded Creation Mode

Goal: turn the runtime into a creation tool that preserves the visible Master System look and technical rules while avoiding the original ROM's quantity-budget limits.

Includes:

- Maker project independent from the original ROM.
- Blank-project creation flow for building a full WB3-style game from zero.
- Original-game fork flow for creating revised versions of the original adventure.
- Published-project fork flow for community continuations, remixes, and mashups.
- Asset packs for user-created tiles, sprites, backgrounds, music, and SFX.
- Asset import validators for sprite palette limits, tile-grid compliance, metasprite readability, and SMS-style color use.
- New entity editor.
- High-level behavior editor.
- Event scripting for triggers, intro sequences, cutscenes, NPCs, quest flags, boss defeats, transformations, endings, and conditions.
- More sprites, entities, and active elements than the original game, always within the SMS visual style.
- Configurable budgets for rooms, entities, scripts, music, and SFX.
- SMS style validators: palette, resolution, tile grid, sprite/metasprite sizing, and readability.
- External music and SFX via WebAudio.
- Templates for creating WB3-style rooms without coding.
- Compatibility for importing original content as a starting point.
- Release metadata for immutable published versions and fork ancestry.
- Project export for the JavaScript runtime.

Deliverables:

- Expanded project format.
- Visual maker editor.
- Blank-project wizard.
- Cutscene and intro editor.
- Project publishing and fork metadata model.
- Runtime capable of mixing original and new data.
- Demo of a new room that preserves the SMS/WB3 look while using more entities, events, or content than would be practical to insert into the original ROM.

## Phase 7: QA, Regression, and Tooling

Goal: prevent analysis and runtime work from breaking as the project evolves.

Includes:

- Smoke tests for `world-*.mjs` catalogs.
- Deterministic decoder tests.
- Reference screenshots for rooms/zones.
- Browser smoke tests for the ROM Analyzer.
- ROM/RAM coverage comparison.
- Missing or stale catalog report.
- Performance checks for rendering and runtime.
- Compatibility tests between Original Compatibility Mode and Expanded Maker Mode.

Deliverables:

- Repeatable validation commands.
- Fixtures that do not distribute game assets.
- Roadmap status report.

## Explicitly Out of Scope For Now

- Exporting a patched SMS ROM.
- Reinserting expanded streams with automatic repointing.
- Distributing extracted assets.
- Cycle-accurate Master System emulation.
- Exact Z80, VDP, and PSG timing compatibility as if this were an emulator.
- Breaking visible Master System restrictions for color, resolution, tile grid, or visual language.

These topics can be investigated later, but they should not block the JavaScript recreation or high-level editors.
