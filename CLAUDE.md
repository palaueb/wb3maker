# Wonder Boy III: The Dragon's Trap - Project Notes for Agents

This file is a compact English guide for future coding and reverse-engineering work in this repository.

For user-facing documentation, start with:

- [README.md](README.md)
- [ROADMAP.md](ROADMAP.md)
- [REVERSE_ENGINEERING.md](REVERSE_ENGINEERING.md)
- [ROM_CONTROL_FINDINGS.md](ROM_CONTROL_FINDINGS.md)

## Project Direction

This project is a browser-based ROM analyzer and JavaScript recreation toolkit for **Wonder Boy III: The Dragon's Trap** on Sega Master System.

The user provides their own ROM. The repository must not distribute extracted game assets or ROM bytes.

The long-term direction is:

1. Map and understand the original ROM.
2. Consolidate the analysis into stable data-reader APIs.
3. Reconstruct a JavaScript runtime that can play original content.
4. Build a WB3 Maker that preserves the Master System visual rules while allowing more content than the original ROM budget.

Maker mode must preserve SMS-style technical constraints that are visible to the player:

- screen basis and resolution;
- 8x8 tile grid;
- SMS-style palettes and color limits;
- sprite/metasprite readability;
- WB3-style camera, scroll, and composition.

Maker mode may expand quantity budgets:

- more sprites;
- more entities;
- more rooms;
- more triggers/events;
- more music/SFX/project data;
- new assets and behavior definitions for the JavaScript runtime.

Exporting a patched SMS ROM is out of scope for now.

## Legal Model

The user supplies the ROM. The project distributes:

- original engine/runtime code;
- editor and analyzer code;
- analysis scripts that run against the user's ROM;
- metadata and schemas that describe structure.

The project must not distribute Sega/Wonder Boy assets.

## Current Architecture

```text
wb3/
├── index.html                  Entry point and phase list
├── README.md                   User-facing overview
├── ROADMAP.md                  JavaScript recreation and WB3 Maker roadmap
├── REVERSE_ENGINEERING.md      Technical reference guide
├── ROM_CONTROL_FINDINGS.md     Evidence-driven ROM control findings
├── api.php                     Local project API for `php -S`
├── tools/
│   ├── rom-analyzer.html       Main analyzer shell
│   ├── js/                     Analyzer panel modules
│   ├── world-*.mjs             Reproducible audit/catalog scripts
│   ├── sms-input.html          SMS controller input helper
│   ├── z80.html                Z80 reference
│   └── cfg-analyzer.html       Control-flow helper
├── projects/                   Local project data, ignored by git
└── data/
    └── rom-maps/               Known ROM maps
```

The main app is still mostly vanilla HTML/CSS/JS. Keep changes compatible with direct browser loading when possible. Project save/load uses `api.php` when running through `php -S`.

## Key Files

| File | Purpose |
|------|---------|
| `tools/rom-analyzer.html` | HTML shell for the main analyzer |
| `tools/js/state.js` | Shared UI state, region types, map data shape |
| `tools/js/main.js` | App boot, ROM/map load, refresh flow |
| `tools/js/panel-map.js` | Memory map table and filters |
| `tools/js/panel-lab.js` | Inspector/lab panel and structural previews |
| `tools/js/panel-simulator.js` | SMS state simulation, zone browser, runtime previews |
| `tools/world-*.mjs` | Node audit scripts that generate catalogs/reports |
| `projects/WORLD/map.json` | Canonical project map, ignored by git |

## ROM Analyzer Panels

| Panel | Purpose |
|-------|---------|
| Projects | Create/load/save local projects via `api.php` |
| ROM Info | MD5, CRC32, size, product/header data |
| Memory Banks | 16 banks x 16 KB, coverage by bank |
| Tile Viewer | SMS 4bpp tile viewer with palette selection |
| Memory Map | Region table, CARVE, ASM import, text search |
| Inspector | Hex dump, split/merge, structural previews, analysis metadata |
| Palette Registry | Contiguous and manual palette management |
| Sprite/BG Composer | Manual tile compositions and tilemap-based previews |
| SMS State Simulator | Synthetic VRAM/CRAM, room/zone loader previews |
| RAM Map | RAM variables, buffers, and analysis annotations |

Recent simulator work includes catalog-backed previews for zone recipes, audio request graphs, room entity data, dynamic tile uploads, frame coverage, and player state graphs.

## Region Types

Region type metadata lives in `tools/js/state.js` as `TYPE_META`.

Common types include:

- `gfx_tiles`
- `gfx_sprites`
- `tile_map`
- `palette`
- `palette_script_table`
- `palette_script`
- `map_screens`
- `pointer_table`
- `code`
- `music`
- `audio_driver_data`
- `text`
- `raw_byte`
- `meta_sprite`
- `entity_data`
- `entity_behavior_table`
- `entity_anim_table`
- `entity_anim_script`
- `item_data`
- `input_script`
- `effect_script`
- `data_table`
- `data_array`
- `screen_prog`
- `screen_prog_table`
- `vdp_stream`
- `scroll_map`
- `vram_loader_8fb`
- `vram_loader_998`
- `dynamic_tile_loader`
- `room_data`
- `room_subrecord`
- `room_seq_table`
- `null`
- `unknown`

Only non-`unknown` regions count toward bank coverage.

## `map.json` Model

`map.json` is the canonical project model. It stores:

- ROM identity;
- regions;
- RAM entries;
- compositions;
- scene/zone recipes;
- catalog arrays;
- analysis reports;
- notes.

Important rule: runtime preview data derived from the user's loaded ROM should not be persisted unless it is metadata or evidence. Do not persist raw ROM bytes, decoded music, samples, or extracted assets.

## Audit Scripts

`tools/world-*.mjs` scripts are reproducible analysis passes. Most follow this pattern:

1. Read `projects/WORLD/map.json`.
2. Optionally read the WLA-DX disassembly.
3. Build a catalog and/or analysis report.
4. Print JSON when run normally.
5. Update `map.json` only when run with `--apply`.

Examples:

- `tools/world-audio-request-taxonomy-audit.mjs`
- `tools/world-audio-event-ram-link-audit.mjs`
- `tools/world-audio-trace-model-audit.mjs`
- `tools/world-zone-recipe-audit.mjs`
- `tools/world-room-entity-list-audit.mjs`
- `tools/world-player-engine-state-graph-audit.mjs`

When adding a new audit script:

- use deterministic output;
- include `catalogId`, `reportId`, `schemaVersion`, `generatedAt`, and `tool`;
- store source catalog ids when the script depends on previous catalogs;
- add summaries and validation counts;
- avoid storing asset bytes;
- make `--apply` idempotent by replacing any existing catalog/report with the same id.

## SMS Graphics Reference

### Tiles

- Tile size: 8x8 pixels.
- Format: SMS 4bpp planar.
- Size: 32 bytes per tile.
- Main visual unit for both original compatibility and maker mode.

```javascript
function decodeTile(rom, offset) {
  const pixels = new Uint8Array(64);
  for (let row = 0; row < 8; row++) {
    const p0 = rom[offset + row*4 + 0];
    const p1 = rom[offset + row*4 + 1];
    const p2 = rom[offset + row*4 + 2];
    const p3 = rom[offset + row*4 + 3];
    for (let bit = 7; bit >= 0; bit--) {
      const col = 7 - bit;
      pixels[row*8 + col] =
        ((p0 >> bit) & 1) |
        (((p1 >> bit) & 1) << 1) |
        (((p2 >> bit) & 1) << 2) |
        (((p3 >> bit) & 1) << 3);
    }
  }
  return pixels;
}
```

### Palettes

- 32 CRAM colors.
- 0-15: background palette.
- 16-31: sprite palette.
- SMS color format: `00BBGGRR`.

Some palettes are not stored contiguously in ROM. They are built at runtime through VDP port writes or shadow RAM. Use `palette_manual` or catalog-backed metadata for these cases.

### Name Table

- VRAM name table at `$3800`.
- 32x28 cells.
- 2 bytes per cell.
- Entry format: `---PCVHN NNNNNNNN`.

### Sprite Attribute Table

SAT lives in VRAM from `$3F00`:

| VRAM Address | Contents |
|--------------|----------|
| `$3F00-$3F3F` | Y[0]..Y[63], one byte per sprite |
| `$3F40-$3F7F` | unused |
| `$3F80-$3FFF` | for sprite i: `X[i]` at `$3F80 + i*2`, `N[i]` at `$3F81 + i*2` |

`$D0` (208) marks inactive/offscreen sprites.

## Bank Addressing

- 16 banks x 16 KB (`BANK_SIZE = 0x4000`).
- Bank 0 maps to Z80 `$0000-$3FFF`.
- Bank 1 maps to Z80 `$4000-$7FFF`.
- Banks 2-15 usually map to Z80 `$8000-$BFFF`.
- Emulicious address format: `BB:ZZZZ`.

```javascript
function bankAddrStr(offset) {
  const bank = Math.floor(offset / 0x4000);
  const pageBase = bank === 0 ? 0x0000 : bank === 1 ? 0x4000 : 0x8000;
  const z80 = pageBase + (offset % 0x4000);
  return bank.toString(16).toUpperCase().padStart(2,'0') + ':' +
         z80.toString(16).toUpperCase().padStart(4,'0');
}
```

Important conversions:

- Bank 4 Z80 to ROM: `rom_off = z80 + 0x8000`.
- Bank 7 Z80 to ROM: `rom_off = z80 + 0x14000`.

## Core WB3 Loaders

### `_LABEL_8FB_` - Tile Pattern Loader

5-byte entry format:

```text
[count] [vram_lo] [vram_hi] [src_lo] [src_hi]
```

- `count=0` means END.
- `vram tile slot = vram_lo | (vram_hi << 8)`.
- VRAM byte offset = slot * 32.
- `bank = src_hi >> 1`.
- `block_index = ((src_hi & 1) << 8) | src_lo`.
- `ROM offset = bank * 0x4000 + block_index * 32`.
- Copies `count * 32` bytes from ROM to VRAM.

### `_LABEL_998_` - Tile Pattern Loader

Variable-length format:

```text
byte0=0      -> END
byte0 bit7=1 -> SetVRAMPos: count = byte0 & 0x7F; byte1 = tile_slot; vramPtr = tile_slot * 32
byte0 bit7=0 -> count = byte0; keep VRAM position

if count=$7F:
  fill 32 zero bytes at vramPtr, advance vramPtr
else:
  read [src_lo, src_hi]
  bank = src_hi >> 1
  block_index = ((src_hi & 1) << 8) | src_lo
  ROM offset = bank * 0x4000 + block_index * 32
  copy count * 32 bytes to VRAM at vramPtr, advance vramPtr
```

### `_LABEL_604_` - Screen Program / Name Table Writer

Writes 2-byte entries to name table VRAM (`$3800-$3FFF`, 32x28 grid).

Opcode summary:

| Opcode | Function |
|--------|----------|
| `$F0` | Set cursor column |
| `$F1` | Set cursor row |
| `$F2` | Write tile + flags word directly |
| `$F3` | Fill N tiles with same value |
| `$F4` | Copy N tiles from ROM |
| `$F5-$FE` | Other positioning/control opcodes |
| `$FF` | END |

Bytes below `$F0` are direct tile indices. They write one cell at the current cursor and advance.

Disassembler warning: WLA-DX/Emulicious sometimes labels bytes inside a `screen_prog` stream as `.dw` or "Pointer Table". These are often false pointer tables and should be confirmed through code flow before being treated as real pointers.

## Room Architecture

### `_DATA_1CCC0_`

ROM `$1CCC0` (bank 7, Z80 `$8CC0`): 31 entries x 2 bytes = 62 bytes.

Each entry is a little-endian Z80 word pointing into bank 7. It points to the start of the `screen_prog` stream (`_LABEL_604_`) for that room's visible background.

Important: the disassembler comment `indexed by _RAM_CF81_` is wrong. `_RAM_CF81_` is a V-blank/frame flag. The real consumer is `_LABEL_5EB_`, and the index arrives in register `A`.

### Room Initialization Chain

```text
_LABEL_5EB_(room_id)
  -> read _DATA_1CCC0_[room_id*2] -> Z80 ptr
  -> call _LABEL_604_(ptr) -> write background name table

_LABEL_2620_(HL -> room_record)
  -> read scroll/spawn params from main record
  -> read ptr[4:5] -> sub-record
  -> call _LABEL_26F4_(sub-record)
  -> call _LABEL_5EB_(room_id)
```

### Room Sub-Record Format

```text
Offset  Size  Contents
  0      8    copied to _RAM_CF5E_
                  bytes 0-1: Z80 ptr to room_seq_table
                  bytes 2-7: other scroll/physics parameters
  8      2    P2: Z80 ptr to 5-byte tile data format for _LABEL_8FB_
 10      6    processed by _LABEL_DC2_
 16      1    format selector: bit7/bit6 selects _DATA_275D_, _DATA_2762_, or skip
 17      1    player spawn info
```

### Room Sequence Table Format

Pointed to by `_RAM_CF5E_[0:1]` as a bank-4 Z80 address.

```text
Byte  Contents
  0   position index (*8 = scroll offset)
  1   parameter -> _RAM_D0E0_
 2-3  scroll threshold word -> _RAM_D0E1_
  4   room type (& $1F) -> index into _DATA_48C5_ (31-entry jump table)
 5-6  Z80 ptr -> tile data record for the room -> stored in _RAM_CFFA_
```

Terminator: byte `$FF`.

### `_LABEL_48A9_` - Room Transition Handler

Reads the active `room_seq_table` entry:

1. Reads room_type (byte 4) + tile_ptr (bytes 5-6).
2. Stores tile_ptr in `_RAM_CFFA_`.
3. Dispatches through `_DATA_48C5_[room_type & $1F]`.

## Important RAM Variables

| Address | Name | Contents |
|---------|------|----------|
| `$CF81` | `_RAM_CF81_` | V-blank / frame-complete flag, not a `_DATA_1CCC0_` selector |
| `$CFFA` | `_RAM_CFFA_` | Z80 ptr to the current room tile data record, set by `_LABEL_48A9_` |
| `$CF5E` | `_RAM_CF5E_` | 8 room parameter bytes; bytes 0-1 = ptr to room_seq_table |
| `$D0E0` | `_RAM_D0E0_` | Room parameter, byte 1 of room_seq_table |
| `$D0E1` | `_RAM_D0E1_` | Scroll threshold word, bytes 2-3 of room_seq_table |

## Binary Data Files in Disassembly

| File | ROM offset | Size | Contents |
|------|------------|------|----------|
| `_DATA_10000_.inc` | `$10000` | `~$C96` | Room sequence tables, 7 bytes/entry, ends `$FF`, bank 4 |
| `_DATA_10C96_.inc` | `$10C96` | 5793 bytes | Main room records + sub-records, variable structure, not indexed directly by room_id |
| `_DATA_1CCC0_.inc` | `$1CCC0` | 62 bytes | 31 x Z80 word, screen_prog ptr per bank-7 room |

Warning: `.inc` files are binary disassembler dumps, not code. Most contents are data bytes with some WLA-DX labels interleaved.

## Development Roadmap

See [ROADMAP.md](ROADMAP.md). The old phase plan based on individual tile/map/sprite extractors is obsolete.

Current top-level phases:

| Phase | Focus |
|-------|-------|
| 0 | ROM intelligence |
| 1 | Data model consolidation |
| 2 | Asset and data browsers |
| 3 | Runtime reconstruction |
| 4 | Editors and tuning tools |
| 5 | Playable JavaScript recreation |
| 6 | WB3 Maker expanded creation mode |
| 7 | QA, regression, and tooling |

## Coding Conventions

- Use vanilla JavaScript unless the project explicitly adopts a build step.
- Keep the tools usable as standalone HTML files when possible.
- UI text should be in English.
- Addresses should be shown in hex:
  - absolute ROM offsets as `0xXXXXX`;
  - Z80 addresses as `BB:ZZZZ` where useful.
- Do not persist raw extracted assets in project metadata.
- Prefer structured parsers and catalog-backed metadata over ad hoc byte guesses.

## Useful External References

- [SMS Power! - Technical Reference](https://www.smspower.org/Development/Index) - ROM, VDP, and tile format references
- [Emulicious](https://emulicious.net/) - emulator, debugger, and disassembler
- [Wonder Boy III DataCrystal](https://datacrystal.tcrf.net/wiki/Wonder_Boy_III:_The_Dragon%27s_Trap) - reverse-engineering notes
- [SMS VDP Documentation](https://www.smspower.org/Development/VDPRegisters) - graphics chip documentation

## Current Implementation Priorities

1. Keep `README.md`, `ROADMAP.md`, `REVERSE_ENGINEERING.md`, and `ROM_CONTROL_FINDINGS.md` as the canonical docs.
2. Consolidate repeated decoder logic from analyzer panels and `tools/world-*.mjs` scripts.
3. Move toward stable runtime reader APIs for zones, rooms, entities, player state, audio, palettes, and collisions.
4. Preserve SMS visual constraints in WB3 Maker mode while allowing larger content budgets.
