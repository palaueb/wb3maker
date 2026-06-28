# Wonder Boy III: The Dragon's Trap - Reverse Engineering Guide

Reference guide for what has been discovered about the game's internal architecture.
Last updated: 2026-04-04

---

## Level 0 - ROM and Memory

The ROM has **512 KB** split into **16 banks of 16 KB** (`$0000-$3FFF` each). The Z80 sees 16 KB windows at `$0000`, `$4000`, and `$8000`. The Sega mapper decides which physical bank appears in each window.

```text
ROM offset = bank * $4000 + (Z80_addr - window_base)
  bank 4: rom = z80 + $8000
  bank 5: rom = z80 + $C000   (where _DATA_14000_ lives)
  bank 6: rom = z80 + $10000  (where _DATA_18000_ lives)
  bank 7: rom = z80 + $14000  (where the 31 static rooms live)
```

---

## Level 1 - The Two Map Systems

The game has **two completely separate ways** to draw the world:

```text
+---------------------------------+----------------------------------+
| SINGLE SCREEN MAP               | SCROLL MAP                       |
| (screen_prog / _LABEL_604_)     | (_LABEL_DC2_ + _LABEL_EF3_)      |
+---------------------------------+----------------------------------+
| 31 fixed screens                | 26 horizontal scrolling zones    |
| Shop, hospital, boss room...    | The playable adventure world     |
| Drawn in one pass               | Drawn column by column           |
| Data: _DATA_1CCC0_ (bank 7)     | Data: _DATA_14000_ (bank 5)      |
| Format: opcode stream           | Format: compressed data          |
| Writes directly to VRAM $3800   | Goes through _RAM_CB00_ first    |
+---------------------------------+----------------------------------+
```

Both systems eventually write to **Name Table VRAM** (`$3800-$3FFF`), but through separate paths.

---

## Level 2 - Graphics Tiles

Before anything can be drawn, the **tile patterns** must be present in VRAM (`$0000-$37FF`). Two loaders do this.

### `_LABEL_8FB_` - Tile Pattern Loader (5 bytes per entry)

```text
[count][vram_lo][vram_hi][src_lo][src_hi]
  count   = number of tiles to copy (0 = END)
  vram    = destination VRAM slot (vram_lo | vram_hi<<8) * 32
  src     = encodes source bank and block
    bank        = src_hi >> 1
    block_index = ((src_hi & 1) << 8) | src_lo
    ROM offset  = bank * $4000 + block_index * 32
```

### `_LABEL_998_` - Tile Pattern Loader (variable format)

```text
byte b7=1  -> SetVRAMPos: count = byte & $7F, tile_slot = next byte
byte b7=0  -> count = byte (keeps current VRAM position)
count=$7F  -> writes 32 zero bytes to VRAM (empty tile)
count!=$7F -> reads [src_lo, src_hi], copies count*32 bytes -> VRAM
byte=0     -> END
```

**Tile source data** is always the `$20000-$3FFFF` block (banks 8-15).
Each tile is 32 bytes in SMS 4bpp planar format.

### SMS 4bpp Planar Format

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
        ((p0>>bit)&1) | (((p1>>bit)&1)<<1) |
        (((p2>>bit)&1)<<2) | (((p3>>bit)&1)<<3);
    }
  }
  return pixels;
}
```

### Palette

- 32 colors in CRAM: 16 for background (BG), 16 for sprites (SPR).
- SMS color format: `00BBGGRR` (2 bits per channel).
- Loaded through VDP port writes or from `palette` / `palette_manual` regions.
- `_DATA_B4F_` (`$0B4F`, 64 bytes): color remap table, 4 palettes * 16 entries.

---

## Level 3 - How Each Map System Works

### System A: Single Screen Map (31 rooms)

```text
_DATA_1CCC0_ (bank 7, ROM $1CCC0)
  31 entries * 2 bytes = Z80 word -> points to screen_prog stream

screen_prog stream (_LABEL_604_):
  byte < $F0  -> write direct tile to Name Table (advance cursor)
  $F0         -> set cursor column
  $F1         -> set cursor row
  $F2         -> write direct word
  $F3         -> fill N identical tiles
  $F4         -> copy N tiles from ROM
  $F5-$FE     -> other positioning opcodes
  $FF         -> END

Access: _LABEL_5EB_(room_id in A)
  -> read _DATA_1CCC0_[room_id * 2] -> bank-7 Z80 ptr
  -> call _LABEL_604_(ptr)
```

Z80 to ROM conversion for bank 7: `rom = z80 + $14000`.

These 31 rooms **do not scroll** and do not use zone doors. They are complete fixed screens.

---

### System B: Scroll Map (26 zones)

#### Step 1 - Decompression (`_LABEL_DC2_`)

```text
_DATA_14000_ (bank 5, ROM $14000)
  ~176 pointers (LE word) -> each points to compressed data

Compression format:
  byte < $E3        -> direct tile index (raw, 1 byte)
  byte $E3-$FE      -> RLE: count = byte-$E0, value = next byte (2 bytes)
  $FF $FF           -> END
  $FF [count][val]  -> extended RLE with explicit count (3 bytes)

Result -> _RAM_CB00_ (intermediate RAM buffer):
  12 columns * 11 rows
  row stride = $60 bytes (96 bytes)
  column stride = $10 bytes
  layout: col C, row R -> offset = C*$10 + R*$60
```

`_LABEL_DC2_` receives 6 indices from the zone descriptor, runs 6 iterations, and fills the 12 columns (6 groups of 2 even/odd columns).

#### Step 2 - Lookup (`_DATA_18000_`)

```text
_DATA_18000_ (bank 6, ROM $18000)
  tile_index * 8 -> 8 bytes:
    bytes 0-3: 2 name table words for EVEN columns  (col % 2 == 0)
    bytes 4-7: 2 name table words for ODD columns   (col % 2 == 1)
```

Each "name table word" (2 bytes) uses the standard SMS format:

- bits 0-8: tile index (0-511)
- bit 9: hflip
- bit 10: vflip
- bit 11: palette (0=BG, 1=SPR)
- bit 12: priority

#### Step 3 - Draw Column (`_LABEL_EF3_`)

```text
For each column (called during scrolling):
  base = _RAM_CB00_ + (column >> 1)
  for row 0..10:
    tileIdx = ram_cb00[base + row * $60]
    entry   = _DATA_18000_[tileIdx * 8 + (column & 1) * 4]
    write 2 name table words to VRAM $3800 + col*2 + row*$40
    advance $40 (name table stride = 32 tiles * 2 bytes)
```

---

## Level 4 - Zone Structure

A **zone** is the game's main world unit. Each zone has a descriptor and a sub-record, both in **bank 4** (`rom = z80 + $8000`).

### Zone Descriptor (6 bytes)

```text
byte 0:     initial scroll X  ($FF = keep current value)
byte 1:     initial scroll Y  ($FF = keep)
byte 2:     camera X          ($80 = keep)
byte 3:     camera Y          ($80 = keep)
bytes 4-5:  Z80 word -> SUB-RECORD (in bank 4)
```

### Sub-Record (18+ bytes)

```text
bytes 0-1:  Z80 ptr -> DOOR TABLE (room_seq_table) -> _RAM_CF5E_[0:1]
bytes 2-7:  other scroll/physics parameters        -> _RAM_CF5E_[2:7]
bytes 8-9:  Z80 ptr -> data for _LABEL_8FB_ (tile patterns VRAM)
bytes 10-15: 6 indices -> _DATA_14000_ (the 6 scroll-map columns)
byte 16:    flags
              bit 7 = 0 -> _LABEL_998_(_DATA_275D_) layer A
              bit 7 = 1, bit 6 = 0 -> _LABEL_998_(_DATA_2762_) layer B
              bit 7 = 1, bit 6 = 1 -> skip extra layer
byte 17:    palette index (bits 0-5) -> _LABEL_8B2_
```

### Zone Relationship Diagram

```text
Zone Descriptor (bank 4)
      |
      +--> Sub-Record (bank 4)
              |
              +--> _LABEL_8FB_ data ----------------> tile patterns in VRAM $0000
              |
              +--> 6 * _DATA_14000_[idx] --> _RAM_CB00_ --> _DATA_18000_ --> Name Table
              |
              +--> _LABEL_998_(_DATA_275D_ or _DATA_2762_) --> extra VRAM layer
              |
              +--> palette index --------------------> CRAM (32 colors)
              |
              +--> Door Table ptr -------------------> DOOR TABLE (room_seq_table)
                                                            |
                                                            +--> [scroll_pos, type, destination ptr]
```

---

## Level 5 - Doors and Transitions

Doors **are not in tile maps**. They are separate data structures activated by scroll position.

### Door Table / Room Sequence Table (7 bytes per entry, ends with `$FF`)

```text
byte 0:     scroll_pos * 8 = pixel X where the trigger activates
byte 1:     parameter -> _RAM_D0E0_
bytes 2-3:  scroll threshold word -> _RAM_D0E1_
byte 4:     room_type & $1F -> index into _DATA_48C5_ (31-entry jump table)
bytes 5-6:  Z80 ptr -> destination zone descriptor -> _RAM_CFFA_
```

The player never "collides" with a door tile. The game checks whether `player_scroll_x` matches `scroll_pos`.

### Door Dispatcher (`_DATA_48C5_`, 31 types)

| Type | Label | Action |
|---|---|---|
| 0 | `_LABEL_4903_` | Full zone change -> calls `_LABEL_2620_` with destination ptr |
| 1 | `_LABEL_492B_` | Simple transition, no zone change |
| 6, 7 | special | Skip `_RAM_C27D_` checks |
| 16-20 | warps | Teleport via `_RAM_C26C_` |

---

## Level 6 - Zone Initialization Flow

When the game loads any zone (new game, door, warp):

```text
_LABEL_2620_(HL -> zone descriptor)
  |
  +-- ld a, $04 -> bank 4
  +-- parse byte 0: scroll X -> _RAM_C243_
  +-- parse byte 1: scroll Y -> _RAM_C246_
  +-- parse byte 2: camera X -> _RAM_C248_
  +-- parse byte 3: camera Y -> _RAM_C24A_
  +-- rst $18 -> read sub-record ptr (bytes 4-5) -> HL
  |
  +-- _LABEL_26F4_(HL -> sub-record)
        |
        +-- ldir 8 bytes -> _RAM_CF5E_ (door table ptr + params)
        +-- rst $18 -> read ptr to _LABEL_8FB_ data -> HL
        +-- call _LABEL_8FB_()  -> tile patterns in VRAM
        +-- call _LABEL_DC2_()  -> 6 decompressed columns -> _RAM_CB00_
        +-- call _LABEL_998_()  -> extra VRAM layer (if flags require it)
        +-- call _LABEL_8B2_()  -> palette -> CRAM

Continuation in _LABEL_2620_:
  +-- _LABEL_10BC_() -> lookup _DATA_1C800_[_RAM_CF65_] -> spawn enemies/objects
  +-- _LABEL_FA1_()  -> initial camera position calculation
  +-- _LABEL_E83_()  -> first column draw -> Name Table
  +-- _LABEL_2948_() -> spawn zone enemies
```

### Entry Points

```text
New Game (normal) -> _DATA_10C96_ (bank 4, ROM $10C96) -> _LABEL_2620_
New Game (saved)  -> _DATA_10C90_ (bank 4, ROM $10C90) -> _LABEL_2620_
Demo mode         -> _DATA_10C96_                       -> _LABEL_2620_
Door/warp         -> _RAM_CFFA_ (ptr set by _LABEL_48A9_) -> _LABEL_2620_
```

All `_LABEL_2620_` callers (disassembly lines):

| Line | Caller | Path |
|---|---|---|
| 1479 | `_LABEL_3F8_` | New game, savegame |
| 1493 | `_LABEL_3F8_` | New game, normal |
| 1603 | `_LABEL_508_` | Demo mode |
| 11114 | `_LABEL_4903_` | Zone door (door type 0) |
| 11628 | `_LABEL_4CFA_` | Warp |
| 11640 | `_LABEL_4D08_` | Warp |
| 11803 | `_LABEL_4DD7_` | Warp with offset |
| 20102 | `_LABEL_B4F2_` | Special sequence |
| 20116 | `_LABEL_B509_` | Continue |

---

## Level 7 - Zone Graph

### Key RAM Variables

| Address | Name | Contents |
|---|---|---|
| `$CF65` | `_RAM_CF65_` | Current zone (0-25) |
| `$CF5E` | `_RAM_CF5E_` | 8 zone parameter bytes: [0:1]=door table ptr, [2:7]=other |
| `$CFFA` | `_RAM_CFFA_` | Destination pointer for next zone (set by `_LABEL_48A9_`) |
| `$D006` | `_RAM_D006_` | Previous zone (for returns) |
| `$CB00` | `_RAM_CB00_` | Decompressed scroll map buffer (12*11 bytes) |
| `$D013` | `_RAM_D013_` | Current column being drawn |
| `$D017` | `_RAM_D017_` | Read pointer inside `_RAM_CB00_` |

### The 26 Zones (`_DATA_1C800_`, indexed by `_RAM_CF65_`)

`_DATA_1C800_` (ROM `$1C800`): 26 entries (word pointers) indexed by zone number.
Each entry points to animation, object, and enemy data for the zone.

Known writes to `_RAM_CF65_` (hardcoded zone):

| Value | Context |
|---|---|
| `$00` | Reset / return to castle |
| `$03` | Special pickup |
| `$06` | Special event |
| `$07` | Special event |
| `$08` | Special event |
| `$09` | Title screen |
| `$16` | Zone 22 |
| `$17` | Zone 23 |
| `$19` | Zone 25 |

### RST Vectors (Z80 shortcuts used heavily)

| Opcode | Label | Function |
|---|---|---|
| `rst $10` | `_LABEL_10_` | Read LE word from (HL) -> DE; HL += 2 |
| `rst $18` | `_LABEL_18_` | Same as `$10` + `ex de,hl` (result in HL) |
| `rst $20` | `_LABEL_20_` | Jump table dispatch: read byte from (HL), jump |
| `rst $28` | `_LABEL_28_` | Write A to VDP control port (`$BF`) |
| `rst $30` | `_LABEL_30_` | Write A to VDP data port (`$BE`) |

---

## Level 8 - ROM Data Map

| ROM Offset | Label | Size | Contents |
|---|---|---|---|
| `$0B4F` | `_DATA_B4F_` | 64 B | Color remap table (4 palettes * 16) |
| `$02AC` | `_DATA_2AC_` | 20 B | VDP init registers |
| `$10C90` | `_DATA_10C90_` | 6 B | Zone descriptor: savegame (castle) |
| `$10C96` | `_DATA_10C96_` | 5793 B | Zone data (sub-records, tile data...) |
| `$14000` | `_DATA_14000_` | ~bank 5 | ~176 pointers -> compressed scroll maps |
| `$18000` | `_DATA_18000_` | 1413 B | Tile index -> name table words (8B/entry) |
| `$1C800` | `_DATA_1C800_` | 26*2 B | Zone animation/object table |
| `$1CCC0` | `_DATA_1CCC0_` | 62 B | 31 * Z80 word, screen_prog ptr per room |
| `$20000` | `_DATA_20000_` | ~banks 8-15 | Graphics tiles (4bpp planar) |

---

## Level 9 - ROM Analyzer Status and Pending Work

### Implemented in the ROM Analyzer

| Feature | Panel | Status |
|---|---|---|
| Project management | Projects | done |
| ROM info + MD5 | ROM Info | done |
| Bank map | Memory Banks | done |
| 4bpp tile viewer | Tile Viewer | done |
| Memory Map (regions) + CARVE | Memory Map | done |
| Hex inspector + per-type preview | Inspector | done |
| Heuristic DISCOVERY | Inspector | done |
| Palette Registry | Palettes | done |
| Manual composer + tilemap | Composer | done |
| VRAM/CRAM simulator | Simulator | done |
| Room Browser (31 rooms) | Simulator | done |
| Editable RAM Map | RAM Map | done |
| Preview: Single Screen Map | Inspector | done |
| Preview: Scroll Map (decompression) | Inspector | done |
| Preview: VRAM Loader 8FB/998 | Inspector | done |
| Preview: Pointer Table + classify all | Inspector | done |

### Pending

| Feature | Description | Priority |
|---|---|---|
| Zone Map Browser | Render full scrolling zones (8FB + DC2 + `$18000`) | High |
| Sub-record parser | Extract 8FB ptr + 6 idx + flags + palette from sub-record | High |
| Door table parser | List doors in a zone with scroll_pos and destination | High |
| Zone graph | Connections between zones via door tables | Medium |
| `_DATA_10C96_` parser | Locate all 26 zone descriptors | Medium |
| Full scroll map render | Preview scroll_map with real tiles (requires VRAM state) | Medium |
