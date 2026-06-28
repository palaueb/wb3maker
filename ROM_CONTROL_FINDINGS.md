# ROM Control Findings

Living reverse-engineering findings document focused exclusively on controlling the Wonder Boy III (SMS) ROM.

Principles:
- only findings that help map and understand the ROM
- no editor/player/future-phase material unless it directly helps control the binary
- every finding must help improve `projects/WORLD/map.json`

Recommended format for each finding:
- `Finding`
- `Why it matters`
- `ROM regions`
- `Evidence`
- `Execution effect`
- `Map impact`
- `Confidence`

## 2026-03-24

### `_LABEL_8FB_` is a base tile-pattern loader into VRAM

Why it matters:
It converts compact data scripts into concrete VRAM writes. This makes a `vram_loader_8fb` region controllable instead of just "opaque bytes".

ROM regions:
- routine `0x008FB` (`_LABEL_8FB_`)
- inner loop `0x00919`
- VDP helper `0x0098F`
- scripts such as `_DATA_2A55_` and `_DATA_28D6_`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L2200)
- [tools/js/panel-simulator.js](/media/marc/4T_EXFAT/z80/wb3/tools/js/panel-simulator.js#L12)

Execution effect:
- writes `Port_VDPAddress` and `Port_VDPData`
- uses `_RAM_CF82_`, `_RAM_CFF7_`, `_RAM_D0F0_`, `_RAM_D0F2_`, `_RAM_D0F3_`, `_RAM_D0EE_`
- temporarily switches banks through `_LABEL_1023_` / `_LABEL_1036_`

Map impact:
`region.analysis` should support:

```json
{
  "kind": "vram_loader_script",
  "scriptFormat": "8fb",
  "relations": {
    "consumedBy": ["_LABEL_8FB_"],
    "readsRegions": [],
    "writesRegions": [],
    "relatedRegions": []
  },
  "effects": {
    "readsRAM": ["_RAM_CFF7_"],
    "writesRAM": ["_RAM_CF82_", "_RAM_D0F0_", "_RAM_D0F2_", "_RAM_D0F3_", "_RAM_D0EE_"],
    "writesVRAM": ["tile patterns"],
    "writesCRAM": [],
    "bankSwitches": ["_LABEL_1023_", "_LABEL_1036_"]
  },
  "confidence": "high"
}
```

### `_LABEL_998_` is a second tile-pattern loader, not a `screen_prog`

Why it matters:
It is currently easy to confuse VRAM pattern data with name table data. Separating these two flows is critical for correct structural coverage.

ROM regions:
- routine `0x00998`
- sublabels `0x0099B`, `0x009C3`, `0x00A14`
- script `_DATA_2AE2_`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L2291)
- [tools/js/panel-simulator.js](/media/marc/4T_EXFAT/z80/wb3/tools/js/panel-simulator.js#L41)

Execution effect:
- writes patterns to VRAM
- supports `zero-fill`
- supports VRAM repositioning without reading a new source
- does not write CRAM

Map impact:
`_DATA_2AE2_` should be tagged as `vram_loader_998` or equivalent, and `region.analysis` should be able to store `supportsZeroFill` and `supportsSetVramPos`.

### `_LABEL_8B2_` loads palettes into shadow RAM

Why it matters:
Visual changes do not always come from direct CRAM writes. There is an intermediate RAM layer that must be represented.

ROM regions:
- routine `0x008B2`
- palette table around `0x1C5B0`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L2154)

Execution effect:
- copies 16-byte palettes to `_RAM_CF9B_` and `_RAM_CFAB_`
- does not touch the VDP ports directly in this routine

Map impact:
The map must be able to reflect `palette ROM -> shadow RAM -> visual commit` relationships and the real sizes of RAM buffers.

### `_LABEL_508_` and `_LABEL_4BD_` form the bootstrap + persistent loop core

Why it matters:
They mark the main axis: `setup -> resource loading -> per-frame loop`. This is a key piece for structuring the map.

ROM regions:
- `_LABEL_508_` at `0x00508`
- `_LABEL_4BD_` at `0x004BD`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L1554)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L1583)

Execution effect:
- `_LABEL_508_` prepares state and loads VRAM scripts
- `_LABEL_4BD_` enters the persistent loop and consumes runtime state

Map impact:
These regions need stronger functional tagging and explicit relationships to the data they consume.

## 2026-03-25

### Room/map loading chain: `room_record` -> `sub-record` -> VRAM loaders -> `screen_prog`

Why it matters:
This is the right place to start before analyzing scrolling. If room loading is understood well, scrolling becomes the logic that decides when to jump to another record and activate the same machinery.

ROM regions:
- `_LABEL_2620_` at `0x02620`
- `_LABEL_26F4_` at `0x026F4`
- `_LABEL_48A9_` at `0x048A9`
- `_LABEL_5EB_` at `0x005EB`
- `_DATA_10C96_` at `0x10C96`
- `_DATA_10000_` at `0x10000`
- `_DATA_1CCC0_` at `0x1CCC0`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L6363)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L6472)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L1732)
- [CLAUDE.md](/media/marc/4T_EXFAT/z80/wb3/CLAUDE.md#L414)

Execution effect:
- `_LABEL_2620_` enters with `HL -> room_record`, initializes several room parameters in RAM, reads the sub-record pointer through `rst $18`, calls `_LABEL_26F4_`, then calls additional setup routines and returns.
- `_LABEL_26F4_` consumes the sub-record: copies 8 bytes to `_RAM_CF5E_`, reads the next pointer and passes it to `_LABEL_8FB_`, then processes additional data with `_LABEL_DC2_`, may call `_LABEL_998_`, and finishes by selecting palettes through `_LABEL_8B2_`.
- `_LABEL_48A9_` is the runtime dispatcher: it reads an active entry, stores pointers to `_RAM_CFFA_` and `_RAM_D0DE_`, and decides from `room_type` whether room loading goes directly to `_LABEL_2620_` or is deferred through `_RAM_C26C_`.
- `_LABEL_5EB_` does not load tiles. It selects bank 7, indexes `_DATA_1CCC0_` with `room_id`, obtains the `screen_prog` pointer, and calls `_LABEL_604_`, which writes the name table.

Map impact:
For `map.json`, this chain should be represented explicitly:
- `room_record` consumes `sub-record`
- `sub-record` consumes `room_seq_table`
- `sub-record` also consumes data for `_LABEL_8FB_`
- `room_id` consumes `_DATA_1CCC0_` through `_LABEL_5EB_`
- `room_seq_table entry` dispatches through `_LABEL_48A9_`
- `room_seq_table entry` may load a new sub-record immediately or defer it
- `_LABEL_604_` is only the name table layer, not the main room loader

Confidence:
high

### Practical Emulicious Template

Why it matters:
The goal is to have a minimal setup that shows, live, when the game has selected a new room, when it starts loading it, and when it is only doing a fade or screen refresh.

#### Recommended Watches

Watch these as bytes:

- `$CF81` `V-BLANK FLAG`
- `$CF82` `TILE LOADING FLAG`
- `$CFE1` `SCROLL FLAG`
- `$CFE2` `PAL DIRTY`
- `$CFDB` `FADE_FACTOR`
- `$C26E` `ROOM TYPE / TRANSITION MODE`
- `$D0E0` `ROOM PARAM BYTE`

Watch these as little-endian words:

- `$C26C` `DEFERRED ROOM PTR`
- `$CFFA` `CURRENT ROOM TILE PTR`
- `$D0E1` `ROOM SCROLL THRESHOLD`
- `$D0FE` `ROOM WORK PTR`
- `$CF5E` `ROOM PARAMS[0:1] -> room_seq_table ptr`

For more visual context:

- `$CF8C` `X-Scroll`
- `$CF8D` `Y-Scroll`
- `$CF9B` `Shadow palette 0`
- `$CFAB` `Shadow palette 1`

#### Recommended Breakpoints

To understand who decides the room:

- execute at `_LABEL_48A9_`
- write to `$C26C`
- write to `$C26E`
- write to `$CFFA`

To understand the effective load:

- execute at `_LABEL_2620_`
- execute at `_LABEL_26F4_`
- execute at `_LABEL_5EB_`

To understand what writes to VDP:

- execute at `_LABEL_8FB_`
- execute at `_LABEL_998_`
- execute at `_LABEL_604_`

#### Short Debugging Sequence

To follow a door:

1. Move the character to the door.
2. Watch whether `$C26C` and `$C26E` change.
3. If they change, the room target is already resolved.
4. When execution enters `_LABEL_4C32_`, check which `_DATA_4CAD_` branch it takes.
5. When execution enters `_LABEL_2620_`, the real room load has started.
6. If it enters `_LABEL_5EB_`, it is resolving the visible `screen_prog`.
7. If it enters `_LABEL_8FB_` or `_LABEL_998_`, it is loading patterns into VRAM.
8. If `$CF82=1`, active VDP loading is still in progress.
9. If `$CFDB` changes and `$CFE2=1`, the game is in a fade/palette phase.
10. Wait for `$CF81=1` to validate that the loaded frame has reached VDP.

#### Quick Symptom Reading

- `$C26C` changes but `$CFFA` does not: the game is still in a deferred transition phase.
- `$CFFA` changes: there is now a new active `tile data record`.
- Execution enters `_LABEL_5EB_` but not `_LABEL_8FB_`: probably only the visible name table changes.
- Execution enters `_LABEL_8FB_` or `_LABEL_998_`: new tile/pattern loading is happening.
- `$CFE1=1` without much movement elsewhere: probably only screen/scroll refresh is pending.
- `$CFE2=1` and `$CFDB` changes: this is more likely a visual transition than a full new room.

Confidence:
high

### RAM Watch List for Debugging Screen Loads in the Emulator

Why it matters:
Inside the emulator, you do not want to reread the entire code chain. You want 4 or 5 addresses that quickly tell you:
- whether a transition is in progress
- which room has been selected
- which room record is being consumed
- whether VRAM or palette is being written

Recommended watch list:

| Address | Name | What it tells you |
|--------|-----|------------|
| `$C26C-$C26D` | `DEFERRED ROOM PTR` | Which room/transition record is still pending consumption. If it changes before a door or transition, the target is already resolved. |
| `$C26E` | `ROOM TYPE / TRANSITION MODE` | Which loader/transition type will run. This is the key for knowing which `_DATA_4CAD_` branch will be entered. |
| `$CFFA-$CFFB` | `CURRENT ROOM TILE PTR` | Pointer to the tile-data record for the current room. If it changes, you are usually entering a real room load. |
| `$CF5E-$CF65` | `ROOM PARAMS` | 8-byte block from the current sub-record, especially bytes `0-1`, which point to the `room_seq_table`. |
| `$D0E0` | `ROOM PARAM BYTE` | Room parameter loaded from `room_seq_table`. Useful for seeing type/context changes between rooms. |
| `$D0E1-$D0E2` | `ROOM SCROLL THRESHOLD` | Scroll threshold for the active entry. When it changes between rooms, it is a strong clue that the sequence changed. |
| `$D0FE-$D0FF` | `ROOM WORK PTR` | Loader work cursor. During `_LABEL_26F4_`, it shows which sub-record field is being consumed. |
| `$CF82` | `TILE LOADING FLAG` | If `1`, a critical VRAM write section is active (`_LABEL_604_`, `_LABEL_8FB_`, `_LABEL_998_`, etc.). |
| `$CFE1` | `SCROLL FLAG` | Set to `1` when screen/scroll refresh is pending after a load or transition. |
| `$CFE2` | `PAL DIRTY` | If `1`, the rebuilt palette still needs to be flushed to VDP. |
| `$CFDB` | `FADE_FACTOR` | Tells whether the screen is in fade-in/fade-out during the transition. |
| `$CF81` | `V-BLANK FLAG` | Useful for knowing whether the frame has closed and whether RAM state may already have reached VDP. |

Useful breakpoints:

- `_LABEL_48A9_`: when you want to know who decided the incoming room/sequence.
- `_LABEL_4C32_`: when you want to see which transition mode consumes `_RAM_C26E_`.
- `_LABEL_2620_`: when effective `room_record` loading begins.
- `_LABEL_26F4_`: when `sub-record` loading begins.
- `_LABEL_5EB_`: when the visible `screen_prog` is resolved.
- `_LABEL_8FB_` and `_LABEL_998_`: when you want to observe pattern loading into VRAM.
- `_LABEL_604_`: when you want to observe name table writes.

Practical debugging flow:

1. Watch `$C26C`, `$C26E`, and `$CFFA`.
2. When they change, break at `_LABEL_4C32_` or `_LABEL_2620_`.
3. If `$CF82=1`, follow `_LABEL_8FB_`, `_LABEL_998_`, or `_LABEL_604_` depending on the case.
4. If `$CFE2=1`, inspect the palette cycle; if `$CFE1=1`, inspect the screen refresh.
5. If you are unsure whether the screen is already "real", wait for `$CF81` to mark a complete frame.

Confidence:
high

### `_LABEL_26F4_` is the central per-room resource loader

Why it matters:
This routine actually converts a sub-record into visual state and room parameters. If you need to discover how the game loads new tiles and colors when entering a room, this is the first focus.

ROM regions:
- `_LABEL_26F4_` at `0x026F4`
- `_LABEL_8FB_` at `0x008FB`
- `_LABEL_998_` at `0x00998`
- `_LABEL_8B2_` at `0x008B2`
- `_DATA_275D_` and `_DATA_2762_`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L6472)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L6515)

Execution effect:
- copies 8 bytes from the sub-record to `_RAM_CF5E_`
- stores a work pointer in `_RAM_D0FE_`
- loads VRAM patterns through `_LABEL_8FB_`
- processes an additional block through `_LABEL_DC2_`
- depending on sub-record flags, selects `_DATA_275D_` or `_DATA_2762_` and goes through `_LABEL_998_`
- finally reads a palette selector and passes it to `_LABEL_8B2_`
- the `patterns/palette` branch is clearly separate from the `screen_prog` branch

Map impact:
The sub-record should not be modeled as a generic blob. It has at least these phases:
- `header/copied params`
- `8fb tile-data pointer`
- `extra data for _LABEL_DC2_`
- `flag byte -> optional 998 script`
- `palette selector / visual params`

Confidence:
high

### `_LABEL_48A9_` is the bridge between room sequence and effective room loading

Why it matters:
This routine transitions from the active `room_seq_table` entry to the room loader. It is a key piece for future scroll analysis because scrolling will probably advance this sequence.

ROM regions:
- `_LABEL_48A9_` at `0x048A9`
- `_DATA_48C5_` jump table
- `_RAM_CFFA_`
- `_RAM_D0DE_`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L11076)

Execution effect:
- reads an entry pointed to by `HL`
- stores `DE` in `_RAM_CFFA_` as the pointer to the current tile data record
- stores `HL` in `_RAM_D0DE_`
- dispatches through `_DATA_48C5_`
- the first branch (`_LABEL_4903_`) eventually does `ld hl, (_RAM_CFFA_)` and `call _LABEL_2620_`
- other branches do not load the room immediately: they store the pointer in `_RAM_C26C_` and the real loader runs later from a runtime state machine

Map impact:
This should be modeled as:
- `room_seq_table entry -> room_type`
- `room_seq_table entry -> tile data pointer`
- `room_type -> dispatch target`
- `dispatch target -> direct room load | deferred room load`

Confidence:
high

### `_LABEL_5EB_` and `_DATA_1CCC0_` only resolve the visible background script

Why it matters:
This defines the role of `screen_prog`: it is important, but it is not the whole "map". If `_DATA_1CCC0_` is confused with the entire room system, pattern loaders and the real world sequence are lost.

ROM regions:
- `_LABEL_5EB_` at `0x005EB`
- `_DATA_1CCC0_` at `0x1CCC0`
- `_LABEL_604_` at `0x00604`
- `_RAM_CF81_`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L1732)
- [CLAUDE.md](/media/marc/4T_EXFAT/z80/wb3/CLAUDE.md#L376)

Execution effect:
- switches to bank 7
- indexes `_DATA_1CCC0_` with `room_id * 2`
- resolves a `screen_prog` pointer
- calls `_LABEL_604_`, which writes the name table
- functionally it is a `room_id -> screen_prog ptr` table; it is not the main room sub-record

Map impact:
`_DATA_1CCC0_` should be treated as:
- `room_id -> screen_prog ptr`

Not as:
- complete room definition
- single table for the scroll system
- source of VRAM tiles

Confidence:
high

### `_DATA_10000_` is more likely an upstream sequence/index table than the final sub-record

Why it matters:
This helps avoid mixing data layers. If `_DATA_10000_` is treated as "the final room definition", it gets conflated with `_DATA_10C96_` and the sub-records actually consumed by `_LABEL_2620_` / `_LABEL_26F4_`.

ROM regions:
- `_DATA_10000_` at `0x10000`
- `_LABEL_48A9_` at `0x048A9`
- `_RAM_D0DE_`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L3550)
- [CLAUDE.md](/media/marc/4T_EXFAT/z80/wb3/CLAUDE.md#L486)

Execution effect:
- feeds the scan/sequence that builds work pointers and may end at `_LABEL_48A9_`
- acts as an upstream layer or coarse map index
- does not replace the final sub-record consumed by `_LABEL_2620_`

Map impact:
Conceptually separate:
- `_DATA_10000_` = sequence / upstream table
- `_DATA_10C96_` and derived sub-records = real room-load payload

Confidence:
medium

### Located RAM Positions: Current Function and Pending Conflicts

Why it matters:
Controlling the ROM requires more than knowing where data blocks live. It also requires knowing which RAM state governs room loading, VRAM copies, palettes, scrolling, and key global runtime flags.

Evidence:
- [projects/WORLD/map.json](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/map.json#L18065)
- [CLAUDE.md](/media/marc/4T_EXFAT/z80/wb3/CLAUDE.md#L431)
- [CLAUDE.md](/media/marc/4T_EXFAT/z80/wb3/CLAUDE.md#L476)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L1749)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L2042)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L2200)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L6472)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L11076)

#### High Confidence

| Address | Current map name | Current function | Notes |
|--------|-------------------|------------------|-------|
| `$CF5E-$CF65` | `_RAM_CF5E_` + `CURRENT ZONE` at `$CF65` | 8-byte block copied from the room `sub-record` | bytes `0-1` = ptr to `room_seq_table`; bytes `2-7` = room/scroll parameters. Byte `$CF65` is integrated in this block, and the map currently treats it as "CURRENT ZONE". |
| `$CF81` | `V-BLANK FLAG` | Frame-complete / V-blank flag | Confirmed in `CLAUDE.md`: it is not the `_DATA_1CCC0_` index. |
| `$CF82` | `TILE LOADING FLAG` | Critical-section flag while writing VRAM | Set to `1` in `_LABEL_604_`, `_LABEL_8FB_`, `_LABEL_998_`, `_LABEL_A14_`, then reset to `0` when done. This is more of a "VDP busy / tile upload active" flag than a flag for one specific loader. |
| `$CF97` | `TILE PROPERTIES` / `CURRENT_ATTR` | Current tile attribute byte | `_LABEL_604_` reads and writes it as the current `screen_prog` attribute. The two map labels appear to be the same variable viewed from two angles. |
| `$CF9B-$CFAA` | `Shadow palette 0` | Background palette shadow buffer | `_LABEL_8B2_` copies the ROM palette here. |
| `$CFAB-$CFBA` | `Shadow palette 1` | Sprite palette shadow buffer | `_LABEL_8B2_` also fills this. |
| `$CFBB-$CFCA` | `Active background palette` | Background palette already processed for fade and ready to flush | `_LABEL_7EC_` writes the 32 processed palette bytes from `$CF9B`; the first 16 end up here. |
| `$CFCB-$CFDA` | `Active sprite palette` | Sprite palette already processed for fade and ready to flush | Second half of `_LABEL_7EC_` output. |
| `$CFDB` | `BRIGHTNESS LEVEL` / `FADE_FACTOR` | Global palette fade level | `_LABEL_822_` and `_LABEL_849_` move it through `0..3`; `_LABEL_7EC_` applies it to the 32 palette bytes. The two map labels appear to be the same variable. |
| `$CFE0` | `SAT FLAG` | Sprite refresh flag | The map describes it as "sprites need update"; that matches the name and global engine usage pattern. |
| `$CFE1` | `SCROLL FLAG` | Screen/scroll refresh flag after loads and transitions | Set to `1` after many loaders and room transitions. The current name is useful, but it probably represents "screen update requested" more than only pure scroll. |
| `$CFE2` | `PAL DIRTY` | Palette flush-to-VDP flag | `_LABEL_822_`, `_LABEL_849_`, and other palette routines set it to `1` after rebuilding the active palette. |
| `$CFFA-$CFFB` | `_RAM_CFFA_` | Z80 pointer to the tile-data record of the current room | Set by `_LABEL_48A9_` and consumed by `_LABEL_2620_`. Critical for tracing room transitions. |
| `$D0E0` | `_RAM_D0E0_` | Room parameter from `room_seq_table` | Confirmed by `CLAUDE.md`. Outside this context it is also reused as a counter or temporary index, so meaning depends on routine. |
| `$D0E1-$D0E2` | `_RAM_D0E1_` | `scroll threshold word` from `room_seq_table` | Confirmed by `CLAUDE.md`. Like `$D0E0`, it also acts as scratch/temp pointer in other routines. |
| `$D0EC` | `palette index for remap` | Palette index for tile remap/transform | Calculated from a config byte and feeds tile processing. |
| `$D0ED` | `processed tile counter` | Internal counter for loader `_LABEL_998_` | Incremented each time `_LABEL_998_` processes a block or `zero-fill`. |
| `$D0EE-$D0EF` | `ROM data source pointer` | Current source pointer for pattern loader | `_LABEL_8FB_` and `_LABEL_998_` use it as a read cursor over ROM data. |
| `$D0F0-$D0F1` | `VRAM destination pointer` | Current destination pointer/offset inside VRAM | `_LABEL_8FB_` and `_LABEL_998_` advance it in `$20` byte steps per tile row. |
| `$D0F2` | no dedicated map entry | Tile counter for current `_LABEL_8FB_` command | Temporary byte for the block currently being copied. |
| `$D0F3` | `total number of tiles to load ($08 default)` | Loader iteration "tile rows" counter | In `_LABEL_8FB_` it starts at `$08`; it can be overwritten by the script. |
| `$D0FE-$D0FF` | no dedicated map entry | Scratch pointer / work cursor | In `_LABEL_26F4_`, points inside the `sub-record` while fields are consumed. In other routines it is reused as a temporary counter or pointer. |
| `$C26C-$C26D` | `_RAM_C26C_` | Deferred pointer to room or transition record | `_LABEL_48A9_` stores it for deferred branches; later several states advance it and pass it to `_LABEL_2620_`. |
| `$C26E` | `_RAM_C26E_` | Current `room_type` / transition mode | Filled from the dispatch byte in `_LABEL_48A9_`, then indexes the transition state machine. |

#### Medium or Provisional Confidence

| Address | Current map name | Current reading | Notes |
|--------|-------------------|-----------------|-------|
| `$CF8C` | `X-Scroll` | Current horizontal scroll | Not yet tied to a specific routine in this document, but interpretation is coherent. |
| `$CF8D` | `Y-Scroll` | Current vertical scroll | Same case as `$CF8C`. |
| `$D005` | `EARTHQUAKE` | Earthquake effect flag/counter | The map name looks plausible; still needs cross-reference to the exact routine that shakes camera or scroll. |
| `$CF98` | `PAUSE FLAG` | Pause/NMI state | Full consumption chain not documented yet. |
| `$D278` | `LEVEL LOADER FLAG` | Global flag related to level/room loading | Good hypothesis, pending full trace. |
| `$C23C` | `PAL_CYCLE_OFFSET` | Offset for palette cycles | `_LABEL_849_` sets it to `0` when a fade ends, so it probably participates in both fades and palette cycling. |
| `$D121-$D122` | `CURRENT BANK REFERENCE` | Pointer or stable copy of current bank | The map describes it as a pointer to `$D123`; needs confirmation whether this is a simple reference or an abstraction of the bank system. |
| `$D123` | `CURRENT BANK` | Current active bank | Very plausible, but no dedicated section yet. |
| `$D116` | `TILE PIXEL COUNTER` | Counter for processing 8 pixels per row | The map note fits tile routines; the exact consuming routine still needs to be fixed. |
| `$CF88` | `NEW GAME OPTION` | `Continue/New Game` option | UI/menu state value, not map engine state. |
| `$C24F` | `PLAYER TRANSFORMATION` | Current player form | Useful player state, but not yet integrated into the room/scroll flow. |
| `$C251` | `PLAYER DIRECTION` | Current player direction | Also useful for runtime work, pending documentation inside the gameplay loop. |

#### Pending Map Conflicts and Cleanup

- `$CF97` is duplicated as `TILE PROPERTIES` and `CURRENT_ATTR`. It appears to be the same variable.
- `$CFDB` is duplicated as `BRIGHTNESS LEVEL` and `FADE_FACTOR`. It appears to be the same variable.
- Palette regions `Shadow palette 0`, `Shadow palette 1`, `Active background palette`, and `Active sprite palette` are currently modeled as `size: 1`, but semantically they are 16-byte buffers.
- `ROM data source pointer` and `VRAM destination pointer` should also be treated as 16-bit words, not isolated bytes.
- Variables such as `$D0E0`, `$D0E1`, and `$D0FE` have context-sensitive semantics: in the room flow they have strong meanings, but in other routines they are reused as scratch. The map should reflect this as "primary role + reuse".

Map impact:
For `map.json`, this section points to three concrete improvements:
- allow real RAM intervals (`$CF9B-$CFAA`, `$CFAB-$CFBA`, etc.) instead of 1-byte entries when the buffer is structural
- support semantic aliases for the same address (`$CF97`, `$CFDB`)
- distinguish stable-meaning variables from reused scratch registers (`$D0E0`, `$D0E1`, `$D0FE`)

Confidence:
mixed

### Door Entry: Transition Animation and Effective Room Loading Are Separate

Why it matters:
Finding interior-room tables requires more than inspecting `_DATA_1CCC0_`. A door does not resolve visible content on its own. The code clearly separates:
- entry detection/animation
- room target resolution
- effective loading of the new room

ROM regions:
- `_LABEL_107_` at `0x00107`
- `_LABEL_3F8_` at `0x003F8`
- `_LABEL_4B31_` at `0x04B31`
- `_LABEL_4C32_` at `0x04C32`
- `_DATA_4CAD_` at `0x04CAD`
- `_LABEL_48A9_` at `0x048A9`
- `_DATA_10C96_` / `_DATA_10C90_`

Evidence:
- [projects/WORLD/map.json](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/map.json#L643)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L1046)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L1458)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L11398)

Execution effect:
- `_LABEL_107_` is a special loading loop. Instead of the normal gameplay loop, it repeatedly calls `_LABEL_2B14_`, `_LABEL_3E1_`, `_LABEL_3F8_`, and `_LABEL_4BD_`.
- `_LABEL_3F8_` is the central `start level / load screen` routine: it loads palette and base VRAM (`_LABEL_8B2_`, `_LABEL_8FB_`, `_LABEL_998_`), then enters `_LABEL_2620_` with a main `room_record` (`_DATA_10C96_` for the normal path, `_DATA_10C90_` for a special new game/menu case).
- The player's door transition goes through the state machine indexed by `_RAM_C260_`. In this flow, `_LABEL_4B31_` prepares entry animation and movement, while `_LABEL_4C32_` is where the already-prepared room target is consumed.
- `_LABEL_4C32_` does not look up the room. It takes `_RAM_C26E_` and `_RAM_C26C_`, then dispatches through `_DATA_4CAD_` to several loading branches (`_LABEL_4CED_`, `_LABEL_4D08_`, `_LABEL_4D72_`, `_LABEL_4D3A_`, `_LABEL_4E05_`, `_LABEL_4E25_`, `_LABEL_4E49_`).
- `_LABEL_48A9_` is the upstream routine that resolves the active sequence entry and fills `_RAM_C26C_` / `_RAM_C26E_`. This means the door consumes a room target that was already decided earlier.

Map impact:
The correct conceptual chain is:
- `door trigger / player transition`
- `state machine _RAM_C260_`
- `_LABEL_4B31_` (entry animation)
- `_LABEL_4C32_` (room target consumption)
- `_DATA_4CAD_` (transition type / concrete loader)
- `_LABEL_2620_` / `_LABEL_26F4_` / `_LABEL_5EB_` (effective loading)

It is not correct to model this as:
- `door -> _DATA_1CCC0_`

`_DATA_1CCC0_` only provides the visible `screen_prog` for some rooms. The real door transition first goes through room records and type dispatch machinery.

Confidence:
high
