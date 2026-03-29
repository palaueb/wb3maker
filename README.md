# Wonder Boy III: The Dragon's Trap — Editor & Player

A 100% frontend browser-based ROM analyzer, screen editor and player for **Wonder Boy III: The Dragon's Trap** (Sega Master System).

**You provide your own ROM. No game assets are distributed.**

---

## What it does

1. **ROM Analyzer** — load your `.sms` ROM and map its contents: graphics tiles, palettes, tile maps, code regions, music, sprites, screen bytecode, and RAM variables. Reverse-engineer the game structure visually.
2. **Screen Editor** *(planned)* — build adventure screens using the game's own assets and physics.
3. **Player** *(planned)* — play the screens you create, directly in the browser.

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
| `tools/rom-analyzer.html` | Main tool — ROM analysis, memory mapping, tile viewer, inspector |
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
| SMS State Simulator | Simulate VRAM/CRAM state via loader steps; Room Browser for 31 rooms |
| RAM Map | Track RAM variables (auto-populated from disassembly labels) |

---

## Workflow

1. Load your `.sms` ROM (drag & drop or file picker).
2. Optionally load a WLA-DX `.asm` disassembly — regions and RAM variable definitions are imported automatically.
3. Optionally load a `map.json` to restore a previously saved session.
4. Use **Memory Map** + **Inspector** to identify and annotate regions.
5. Use **SMS State Simulator** to reconstruct screen states from loader data.
6. Save progress — the map auto-saves to the active project via `api.php`.

---

## Project structure

```
wb3/
├── index.html              Entry point (phase list)
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
