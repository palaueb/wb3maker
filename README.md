# Wonder Boy III: The Dragon's Trap — ROM Analyzer & WB3 Maker Toolkit

A browser-based reverse-engineering toolkit for **Wonder Boy III: The Dragon's Trap** (Sega Master System), with the long-term goal of recreating the game as a JavaScript runtime and then expanding it into a WB3-focused maker.

**You provide your own ROM. No game assets are distributed.**

---

## What it does

1. **ROM Analyzer** — load your `.sms` ROM, inspect the disassembly-backed memory map, and track graphics, palettes, tile maps, code, music, sprites, rooms, zones, RAM variables and catalog evidence.
2. **Game Data Model** — use `projects/WORLD/map.json` plus reproducible `tools/world-*.mjs` audit scripts to describe how the original ROM is structured.
3. **Runtime Reconstruction** *(in progress)* — rebuild the room/zone loader, SMS-like rendering state, collision, entities, player systems and audio flow in JavaScript without writing a full Master System emulator.
4. **Editors and Playable Recreation** *(planned)* — build high-level tools and eventually play a browser recreation backed by the user's local ROM.
5. **WB3 Maker Mode** *(planned)* — create new rooms, sprites, music, entities and gameplay systems while preserving the Master System visual rules for screen size, tile grid, palettes and color.

See [ROADMAP.md](ROADMAP.md) for the current phase plan.

---

## How to run

Requires PHP (for local project saving). From the project root:

```bash
php -S localhost:8080
```

Then open `http://localhost:8080` in your browser.

The tools also work as standalone HTML files (open directly without a server), but project save/load via `api.php` won't be available.

---

## Tools

| File | Description |
|------|-------------|
| `tools/rom-analyzer.html` | Main tool — ROM analysis, memory mapping, tile viewer, inspector, RAM map, zone browser and runtime previews |
| `tools/game-data-model.html` | Phase 1 asset inventory — sections for rooms/screens, graphics, sprites/animation, palettes/effects, audio, code/mechanics, RAM/game state, runtime observations and debug cheats |
| `tools/asset-data-browsers.html` | Phase 2 decoder control — per-family implementation percentages, decoder list, asset browsers and ROM-local visual/audio probes |
| `tools/runtime-reconstruction.html` | Phase 3 runtime reconstruction — subsystem dashboard for SMS render core, room loader, collision, player, entities, audio, HUD/game state and their JS module targets |
| `tools/world-*.mjs` | Reproducible audit/catalog scripts for ROM structures, audio, zones, rooms, entities, animation, palettes, collision and runtime state |
| `tools/sms-input.html` | Simple SMS controller input visualizer (CF90/CF91 hex → button display) |
| `tools/z80.html` | Z80 opcode reference |
| `tools/cfg-analyzer.html` | Control flow graph analyzer |

---

## ROM Analyzer panels

| Panel | What it does |
|-------|-------------|
| Projects | Create/load/save projects via `api.php` |
| ROM Info | MD5, CRC32, TMR header, product code |
| Memory Banks | 16 banks × 16KB, analysis coverage per bank |
| Tile Viewer | Render SMS 4bpp tiles with editable palette |
| Memory Map | Annotate ROM regions (CARVE, import from `.asm`, text search) |
| Inspector | Hex dump, split regions, DISCOVERY heuristics, per-type structural previews |
| Palette Registry | Manage contiguous and manually-defined palettes |
| Sprite/BG Composer | Build compositions from tile picker or tile map regions |
| SMS State Simulator | Simulate VRAM/CRAM state via loader steps, zone recipes, room data and runtime previews |
| RAM Map | Track RAM variables (auto-populated from disassembly labels) |

Recent analyzer work also adds catalog-backed previews for zone recipes, audio request graphs, room entity data, dynamic tile uploads, frame coverage and player state graphs.

---

## Workflow

1. Load your `.sms` ROM (drag & drop or file picker).
2. Optionally load a WLA-DX `.asm` disassembly — regions and RAM variable definitions are imported automatically.
3. Optionally load a `map.json` to restore a previously saved session.
4. Use **Memory Map** + **Inspector** to identify and annotate regions.
5. Run or inspect `tools/world-*.mjs` audits to produce catalog metadata in `map.json`.
6. Use **SMS State Simulator** and the zone/audio/entity previews to reconstruct runtime states from loader data.
7. Save progress — the map auto-saves to the active project via `api.php`.

---

## Roadmap summary

The project roadmap is now organized around recreating the game in JavaScript:

| Phase | Focus | Status |
|-------|-------|--------|
| 0 | ROM intelligence: coverage, memory map, RAM map, catalogs and evidence | Active / advanced |
| 1 | Data model consolidation and stable reader APIs | In progress |
| 2 | Asset and data browsers for rooms, zones, sprites, audio, collision and UI data | In progress |
| 3 | Runtime reconstruction: renderer, loaders, camera, collision, player, entities and audio | Planned / partial |
| 4 | Editors and tuning tools | Planned |
| 5 | Playable JavaScript recreation | Planned |
| 6 | WB3 Maker expanded creation mode: new assets, entities, audio, scripts and maps with SMS visual constraints preserved | Planned |
| 7 | QA, regression and tooling | Planned |

Exporting a patched Master System ROM is explicitly out of scope for now.
Expanded maker projects are intended to run on the JavaScript runtime instead.

---

## Project structure

```
wb3/
├── index.html              Entry point (phase list)
├── ROADMAP.md              JavaScript recreation and WB3 Maker roadmap
├── api.php                 Local REST API for project management
├── server.sh               Convenience script: php -S localhost:8080
├── tools/
│   ├── rom-analyzer.html   Main analyzer (HTML shell)
│   ├── js/                 Modular JS for each panel
│   ├── sms-input.html      Controller input viewer
│   └── z80.html            Z80 opcode reference
├── data/
│   └── rom-maps/           Known ROM address maps (world.json, ...)
├── projects/               Created by api.php — one subdir per project
├── dissasembly/            WLA-DX disassembly files (not distributed)
└── shared/                 Shared utilities (future)
```

---

## Legal

This project does not distribute any Sega or Wonder Boy assets.
You must supply your own legally-obtained ROM file.
Inspired by the open-source model of RetroArch and Lunar Magic.

---

## SMS technical reference

- Tiles: 8×8px, 4bpp planar, 32 bytes each
- Background: name table at VRAM `$3800`, 32×28 cells, 2 bytes/cell (`---PCVHN NNNNNNNN`)
- Sprites: SAT at VRAM `$3F00` — Y×64 bytes, then X+tile interleaved from `$3F80`
- Mapper: 16 banks × 16KB (`BANK_SIZE = $4000`)
- Palette: 32 CRAM entries — 0–15 BG, 16–31 SPR — color format `00BBGGRR`
