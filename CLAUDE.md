# Wonder Boy III — The Dragon's Trap · Editor & Player

## Visió general del projecte

Aplicació **100% frontend** (zero backend, zero servidor) que permet a qualsevol persona:
1. **Pujar la seva pròpia ROM** de Wonder Boy III: The Dragon's Trap (Sega Master System)
2. **Crear pantalles d'aventura** amb els assets, físiques i personatges del joc original
3. **Jugar les pantalles** creades directament al navegador

Tot el processament passa al navegador via `FileReader` + `Uint8Array`. Cap asset de Sega es distribueix ni s'emmagatzema en cap servidor.

> **Nota d'implementació:** Hi ha un `api.php` al directori arrel per a ús local (`php -S`). Permet gestionar projectes (crear/llistar/eliminar), pujar fitxers (ROM, ASM) i desar/carregar `map.json`. Tota la lògica d'anàlisi i renderitzat és 100% frontend.

---

## Model legal

L'usuari aporta la seva pròpia ROM. El projecte distribueix:
- El motor de joc (implementació pròpia de les físiques)
- L'editor visual
- Els scripts d'extracció (que s'executen sobre la ROM de l'usuari)

**No es distribueix cap asset del joc.** Inspirat en el model de RetroArch i editors com Lunar Magic.

---

## ROMs suportades (objectiu)

El sistema ha d'identificar automàticament la versió de la ROM mitjançant **checksum MD5** i carregar el mapa d'adreces corresponent.

| Versió | Nom esperat | MD5 (a descobrir) |
|--------|-------------|-------------------|
| World  | `Wonder Boy III - The Dragon's Trap (World).sms` | TBD |
| USA    | `Wonder Boy III - The Dragon's Trap (USA).sms`   | TBD |
| Europe | `Wonder Boy III - The Dragon's Trap (Europe).sms`| TBD |
| Japan  | `Wonder Boy III - Monster Lair (Japan).sms`      | TBD |

Els checksums s'han d'omplir durant la Fase 0.

---

## Arquitectura del projecte

```
wb3/
├── CLAUDE.md                  ← aquest fitxer
├── index.html                 ← entrada principal (llista de fases)
├── api.php                    ← API local (php -S), gestió de projectes
├── tools/
│   ├── rom-analyzer.html      ← Fase 0: ROM analyzer (ACTIU, veure detall)
│   ├── tile-extractor.html    ← Fase 1a (pendent)
│   ├── map-extractor.html     ← Fase 1b (pendent)
│   └── sprite-extractor.html  ← Fase 1c (pendent)
├── data/
│   └── rom-maps/
│       ├── world.json
│       ├── usa.json
│       ├── europe.json
│       └── japan.json
├── projects/                  ← creat per api.php, un subdirectori per projecte
│   └── <nom-projecte>/
│       ├── *.sms o *.zip      ← ROM del projecte
│       ├── *.asm              ← disassembly WLA-DX (opcional)
│       └── map.json           ← mapa de regions (auto-desat)
└── shared/                    ← (futur)
    ├── rom-loader.js
    ├── sms-gfx.js
    └── screen-format.js
```

---

## Format tècnic dels gràfics SMS

Els tiles de Sega Master System segueixen el format **4bpp planar**:
- Cada tile = 8×8 píxels
- **32 bytes per tile** (4 plans de bits × 8 files × 1 byte per fila)
- Paleta de 16 colors (índex 0 = transparent per a sprites)
- Format de color: `00BBGGRR`, 2 bits per canal → `smsColorToHex(b)` → `#RRGGBB`

```javascript
// Decodificació d'un tile SMS (32 bytes → 64 índexs de color)
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

### SMS Sega Mapper (bancs de memòria)

- **16 bancs × 16 KB** (`BANK_SIZE = 0x4000`)
- Banc 0 → Z80 `$0000–$3FFF`, Banc 1 → `$4000–$7FFF`, Bancs 2–15 → `$8000–$BFFF`
- Adreces en format Emulicious: `BB:ZZZZ` (banc 2 hex + adreça Z80 4 hex)
  - Ex: `06:800D` = banc 6, offset `$000D` dins el banc → `$8000 + $000D`

```javascript
function bankAddrStr(offset) {
  const bank = Math.floor(offset / 0x4000);
  const pageBase = bank === 0 ? 0x0000 : bank === 1 ? 0x4000 : 0x8000;
  const z80 = pageBase + (offset % 0x4000);
  return bank.toString(16).toUpperCase().padStart(2,'0') + ':' +
         z80.toString(16).toUpperCase().padStart(4,'0');
}
```

### Format SMS Tile Map (backgrounds)

- 2 bytes per cel·la, grid de 32×28 cel·les
- `entry = byte0 | (byte1 << 8)`
  - `[8:0]` = índex de tile (0–511)
  - `[9]` = hflip, `[10]` = vflip, `[11]` = selector de paleta (0=BG, 1=SPR), `[12]` = prioritat

### Paletes en temps d'execució

Algunes paletes **no estan guardades de forma contigua a la ROM** — es construeixen en temps d'execució via escriptures al port VDP (`$BF` control, `$BE` dades). Per a aquests casos s'usa el tipus `palette_manual`.

---

## Fase 0 — ROM Analyzer (`tools/rom-analyzer.html`)

**Estat: ✅ En desenvolupament actiu**

Fitxer HTML autònom (~3000 línies, tot vanilla JS). Panells en ordre de dalt a baix:

| Panell | ID | Descripció |
|--------|----|------------|
| Projects | `panel-projects` | Gestió de projectes via `api.php` |
| ROM Info | `panel-info` | MD5, mida, versió detectada |
| Memory Banks | `panel-banks` | 16 bancs × 16KB, % analitzat per banc |
| Tile Viewer | `panel-viewer` | Visor de tiles SMS 4bpp, paleta editable |
| Memory Map | `panel-map` | Taula de regions, CARVE, importar ASM |
| Inspector | `panel-lab` | Hex dump, classificació, DISCOVERY, previews estructurals |
| Palette Registry | `panel-palettes` | Paletes guardades, APPLY TO VIEWER |
| Sprite/BG Composer | `panel-composer` | Compositor manual i des de tile map |
| SMS State Simulator | `panel-simulator` | Simulador experimental; útil com a suport, no com a via principal de descoberta |

### Tipus de regions (`TYPE_META`)

| Clau | Label | Color |
|------|-------|-------|
| `gfx_tiles` | GFX Tiles | `#ff6b35` |
| `gfx_sprites` | GFX Sprites | `#ff35a0` |
| `tile_map` | Tile Map | `#00e5cc` |
| `palette` | Palette | `#ffcc00` |
| `map_screens` | Map/Screens | `#00ff88` |
| `pointer_table` | Pointer Table | `#7ee787` |
| `code` | Code | `#4a9eff` |
| `music` | Music/SFX | `#a855f7` |
| `text` | Text | `#6bffb8` |
| `meta_sprite` | Metasprite | `#ff88aa` |
| `palette_manual` | Palette (custom) | `#ffa500` |
| `data_table` | Data Table | `#e8a020` |
| `data_array` | Data Array | `#c0882a` |
| `screen_prog` | Screen Bytecode | `#00d4ff` |
| `vram_loader` | VRAM Loader | `#d4a0ff` |
| `vram_loader_8fb` | VRAM Loader 8FB | `#c084fc` |
| `vram_loader_998` | VRAM Loader 998 | `#f472b6` |
| `room_subrecord` | Room Subrecord | `#8bd450` |
| `room_seq_table` | Room Seq Table | `#57d3a0` |
| `null` | NULL | `#333355` |
| `unknown` | Unknown | `#555577` |

> **Cobertura de bancs:** Només els tipus **no-`unknown`** compten com a "analitzats" a la barra de progrés.

### Format `map.json` (regions)

```json
{
  "schemaVersion": 1,
  "romMD5": "...",
  "romName": "...",
  "romSizeBytes": 524288,
  "regions": [
    {
      "id": "r0001",
      "offset": "0x2000",
      "size": 4096,
      "type": "gfx_tiles",
      "name": "Main tileset",
      "notes": "",
      "source": "manual"
    }
  ],
  "compositions": [
    {
      "id": "r0010",
      "name": "Player idle",
      "mode": "manual",
      "tileRegionId": "r0001",
      "palRegionId": "r0002",
      "width": 2,
      "height": 4,
      "cells": [12, 13, 14, 15, -1, -1, -1, -1]
    }
  ],
  "notes": ""
}
```

### Funcionalitats implementades

**Memory Map:**
- Taula de regions amb offset absolut + adreça `BB:ZZZZ` (format Emulicious)
- **CARVE mode:** afegir una regió automàticament divideix les regions solapades en fragments before/after (`carveRegion()`)
- Importació de regions des de fitxer `.asm` WLA-DX
- Exportació `map.json` / auto-save al projecte actiu

**Inspector (Laboratory):**
- Hex dump complet (sense truncació) amb offset absolut i `BB:ZZZZ` costat a costat
- Cross-highlight: hover sobre byte hex ↔ caràcter ASCII corresponent
- Click sobre offset/byte → omple el camp "Split At" per dividir la regió
- SPLIT AT: divideix una regió en dos fragments amb preview en viu
- Navegació PREV/NEXT entre regions + counter + scroll a la fila activa a la taula
- Merge queue: + ADD / EMPTY / MERGE(N) per fusionar múltiples regions en una
- DISCOVERY: classificació heurística amb puntuació, motius, `USE TYPE` i `SPLIT @ ...`

**Preview per tipus (columna dreta de l'Inspector):**
- `code` → lookup al fitxer `.asm` carregat (WLA-DX format)
- `text` → decodificació ASCII amb % de caràcters imprimibles
- `tile_map` → renderitzat Canvas (requereix regió `gfx_tiles` + `palette`)
- `palette_manual` → editor de 16 slots, cada slot = offset ROM → color SMS
- `screen_prog` → decoder compartit de `_LABEL_604_`, render, resum, warnings i execution trace byte a byte
- `pointer_table` → llista `index / entry / z80 / rom target / region`, amb `OPEN` del target
- `vram_loader_8fb` / `vram_loader_998` → parsers estructurals separats, no un únic format ambigu

**Notes pràctiques de reverse engineering:**
- Les `pointer_table` reals solen apuntar a ROM i tenir una estructura coherent d'entrades.
- Molts `.dw` generats pel disassembler dins streams de dades **no** son taules reals: només son bytes reinterpretats.
- Si una suposada `pointer_table` apunta a `_RAM_xxxx_`, té una sola entrada o cau enmig d'un `screen_prog`, s'ha de considerar sospitosa fins que el flux de codi la confirmi.

**Palette Registry:**
- Paletes contígues (`palette`) i manuals (`palette_manual`) en el mateix panell
- APPLY TO VIEWER aplica la paleta al Tile Viewer
- EDIT SLOTS obre la paleta manual a l'Inspector

**Sprite/BG Composer:**
- **Mode MANUAL:** tile picker + grid N×M + preview en temps real. Click per col·locar, clic dret per esborrar. Per a sprites construïts via codi.
- **Mode FROM TILE MAP:** selecciona una regió `tile_map`, aplica crop, renderitza el background complet amb hflip/vflip/paleta per cel·la.
- Exportació PNG, guardar composicions al `map.json`

### SMS State Simulator

Panell (`panel-simulator`) que simula l'estat complet del hardware SMS:

```javascript
smsState = {
  vram: Uint8Array(16384),  // 16KB: tiles[0..$37FF] + name table[$3800..$3FFF]
  cram: Array(32)           // 32 colors: [0..15]=BG CRAM, [16..31]=SPR CRAM
}
```

**Tipus de passos (INIT STEPS):**

| Tipus | Descripció |
|-------|------------|
| `cram_bg` | Carrega 16 colors d'una regió `palette`/`palette_manual` → CRAM[0..15] |
| `cram_spr` | Carrega 16 colors → CRAM[16..31] |
| `vram_8fb` | Executa DATA per al loader format 5-bytes (`_LABEL_8FB_`) — apuntar a la DATA, NO al codi |
| `vram_998` | Executa DATA per al loader format variable (`_LABEL_998_`) — apuntar a la DATA |
| `nt_604` | Executa DATA de tipus `screen_prog` per escriure la name table |
| `nt_604_raw` | Com `nt_604` però amb `romOff`+`bank` directes (usat per Room Browser) |

> **IMPORTANT:** `_LABEL_8FB_`, `_LABEL_998_`, `_LABEL_604_` etc. son **CODI** (rutines Z80). Els passos del simulador apunten a les DATA que aquelles rutines processen. Mai confondre el label de la rutina amb l'adreça de les dades.

> **Estat actual:** el simulador és útil per provar loaders i renderitzar experiments, però **no resol automàticament** la relació real entre `screen_prog` i els patrons VRAM de cada escena. Per al reverse engineering del joc, la via principal és l'Inspector + DISCOVERY + previews estructurals.

**Arquitectura interna del simulador:**

- `simBuildBaseState()` — crea l'estat SMS, aplica CRAM + VRAM tiles (tots els steps no-nt), retorna l'estat base
- `simRunAll()` — crida `simBuildBaseState()` i aplica només els steps `nt_604`/`nt_604_raw` per damunt
- `simRunScreenProg604(rom, romOff, bank, state)` — decoder de `_LABEL_604_`, escriu name table
- `simRunLoader8FB(rom, off, state)` — decoder de `_LABEL_8FB_`, escriu tiles VRAM
- `simRunLoader998(rom, off, state)` — decoder de `_LABEL_998_`, escriu tiles VRAM

**Room Browser** (subsecció del simulador):
- `simParseRoomTable()` — llegeix la taula `_DATA_1CCC0_` (31 entrades × 2 bytes, banc 7)
- `simRenderRoom()` — executa `simBuildBaseState()` + `simRunScreenProg604()` per la room seleccionada → renderitza canvas
- Mostra anàlisi de tile slots: quins slots VRAM usa cada room (min, max, llista completa)
- Botó "▶ RENDER" → render directe; "+ TO STEPS" → afegeix com a `nt_604_raw` step

**Import VRAM/CRAM** (opcional, per comparació):
- Input `<file>` per a dump binari 16KB de VRAM (des d'Emulicious)
- Input de text per a CRAM en hex (32 bytes)
- Si presents, `simBuildBaseState()` pre-carrega l'estat des del dump abans d'aplicar els steps ROM

**Renderitzat:** llegeix `vram[$3800..]` (name table) → per cada cel·la: tile index → `vram[tileIdx*32]` → pixels → `cram[palSel ? 16+ci : ci]` → color.

---

## Motors de càrrega WB3 (formats documentats)

Tots els motors llegeixen dades de la ROM i escriuen a la VRAM simulada.

### `_LABEL_8FB_` — Tile Pattern Loader (5 bytes/entrada)

```
[count] [vram_lo] [vram_hi] [src_lo] [src_hi]
```
- `count=0` → END
- `vram tile slot = vram_lo | (vram_hi << 8)` → VRAM byte offset = slot × 32
- `bank = src_hi >> 1`
- `block_index = ((src_hi & 1) << 8) | src_lo`
- `ROM offset = bank × 0x4000 + block_index × 32`
- Copia `count × 32` bytes de ROM → VRAM al slot indicat

### `_LABEL_998_` — Tile Pattern Loader (longitud variable)

Escriu patrons de tiles a VRAM (igual que `_LABEL_8FB_` però format diferent):

```
byte0=0 → END
byte0 bit7=1 → SetVRAMPos: count = byte0 & 0x7F; byte1 = tile_slot; vramPtr = tile_slot × 32
byte0 bit7=0 → count = byte0 (no canvia VRAM pos)

Si count=$7F → omple 32 bytes de zeros a vramPtr, avança vramPtr (sense bytes font)
Si count≠$7F → llegeix [src_lo, src_hi]:
  bank = src_hi >> 1
  block_index = ((src_hi & 1) << 8) | src_lo
  ROM offset = bank × 0x4000 + block_index × 32
  copia count × 32 bytes → VRAM a vramPtr, avança vramPtr
```

### `_LABEL_604_` — Screen Prog / Name Table Writer

Escriu entrades a la name table VRAM ($3800–$3FFF). El projecte té ara un decoder compartit basat en el comportament real de la rutina, reutilitzat per l'Inspector i el simulador. El stream és seqüencial; el disassembler sovint el parteix malament en falses `.dw` o "Pointer Table".

### `_LABEL_98F_` — Set VDP Write Address

Envia `E` i `D | $40` al port de control VDP ($BF) → estableix l'adreça d'escriptura VRAM.

### `_LABEL_B8F_` — Multiplicar DE × 32

5 shifts esquerra sobre HL (via ex de,hl): `DE = DE * 32`. Converteix índex de bloc en offset de bytes.

### Arquitectura pantalla d'inici (títol)

| Rutina | Data | Funció |
|--------|------|--------|
| `_LABEL_8FB_` | `_DATA_2A55_` | Carrega patrons de tiles (bank 8, base $20000) |
| `_LABEL_998_` | `_DATA_2AE2_` | Carrega MÉS patrons de tiles (banks 8 i 15) |
| `_LABEL_604_` | `_DATA_2401_` | Escriu name table: HUD row (GOLD, stats) |
| `_LABEL_604_` | `_DATA_1CE3A_` | Escriu name table: files 24–27 (text de baix) |

La name table del background principal es construeix per codi init directe (no via script de dades).

### RST Dispatch Table (vectors $00–$38)

Els opcodes RST son dreceres d'1 byte per a crides freqüents. WB3 en fa ús intensiu:

| Opcode | Label | Funció |
|--------|-------|--------|
| `rst $10` | `_LABEL_10_` | Llegeix word (LE) de (HL) → DE; HL += 2 |
| `rst $18` | `_LABEL_18_` | Com `$10` + `ex de,hl` (resultat queda a HL) |
| `rst $20` | `_LABEL_20_` | Jump table dispatch: llegeix byte de (HL), salta a taula |
| `rst $28` | `_LABEL_28_` | Escriu A al port de control VDP ($BF) |
| `rst $30` | `_LABEL_30_` | Escriu A al port de dades VDP ($BE) |

---

## Arquitectura de rooms WB3 (reverse engineering)

### Taula de rooms `_DATA_1CCC0_`

ROM $1CCC0 (banc 7, Z80 $8CC0): **31 entrades × 2 bytes** = 62 bytes.

Cada entrada és un **word little-endian** que és una adreça Z80 al banc 7. Apunta a l'inici del stream `screen_prog` (`_LABEL_604_`) per al background d'aquella room.

> **Important:** el comentari del disassembler `indexed by _RAM_CF81_` és una heurística errònia. `_RAM_CF81_` és un flag de V-blank/frame. La rutina consumidora real és `_LABEL_5EB_`, i l'índex li arriba en el registre `A`.

**Conversió Z80 ↔ ROM per al banc 7:**
```
rom_offset = z80_addr + 0x14000
// banc 7 ROM base = $1C000; Z80 window base = $8000
// per tant: rom_offset = 7×$4000 + (z80_addr - $8000) = z80_addr + $14000
```

**Exemple correcte:** entrada 0 → Z80 `$8CFE` → ROM `$1CCFE`

**Accés per codi:** `_LABEL_5EB_` fa `A = room_id` → `HL = _DATA_1CCC0_ + room_id*2` → `rst $18` (carrega ptr a HL) → `call _LABEL_604_`.

> **AVÍS disassembler:** WLA-DX/Emulicious de vegades etiqueten bytes enmig d'un stream `screen_prog` com a "Pointer Table". NO son taules de punters reals: son bytes del flux seqüencial que `_LABEL_604_` llegeix in-line. Exemple típic: seqüències com `.dw $2000 | _RAM_D178_` dins blocs textuals o de pantalla.

### Rutina `_LABEL_604_` — Screen Prog Decoder (detall complet)

Escriu entrades de 2 bytes a la name table VRAM ($3800–$3FFF, grid 32×28).

**Opcodes** (byte ≥ $F0):
| Opcode | Funció |
|--------|--------|
| `$F0` | Set column cursor |
| `$F1` | Set row cursor |
| `$F2` | Write tile + flags word directament |
| `$F3` | Fill N tiles amb el mateix valor |
| `$F4` | Copy N tiles des de ROM |
| `$F5–$FE` | Altres opcodes de posicionament/control |
| `$FF` | END — retorna |

Bytes < $F0: índex de tile directe (escriu 1 cel·la a la posició cursor, avança cursor).

### Cadena d'inicialització de room (`_LABEL_2620_`)

```
_LABEL_5EB_(room_id)
  → llegeix _DATA_1CCC0_[room_id*2] → Z80 ptr
  → call _LABEL_604_(ptr) → escriu name table background

_LABEL_2620_(HL → room_record)
  → llegeix scroll/spawn params del record principal
  → llegeix ptr[4:5] → sub-record
  → call _LABEL_26F4_(sub-record)
  → call _LABEL_5EB_(room_id)    ← escriu name table
```

**`_LABEL_26F4_`** — Per-room tile loader:
```
HL → sub-record (veure format a sota)
1. Copia 8 bytes → _RAM_CF5E_   (paràmetres de room)
2. Llegeix P2 (word @ sub+8)    → Z80 ptr a tile-data per _LABEL_8FB_
3. call _LABEL_8FB_(P2)          → carrega tile patterns VRAM
4. (altres loaders per als tiles variables de la room)
```

### Format del sub-record de room (apuntat per bytes 4–5 del record principal)

```
Offset  Mida  Contingut
  0      8    → copiat a _RAM_CF5E_
                  bytes 0–1: Z80 ptr a room_seq_table  (→ _RAM_CF5E_[0:1])
                  bytes 2–7: altres paràmetres de scroll/física
  8      2    P2: Z80 ptr a tile-data 5-byte format (per _LABEL_8FB_)
 10      6    Processat per _LABEL_DC2_ (tile color/type data)
 16      1    Format selector: bit7/bit6 → selecciona _DATA_275D_ o _DATA_2762_ o skip
 17      1    Player spawn info
```

### Format de la Room Sequence Table (7 bytes/entrada, acaba amb $FF)

Apuntada per `_RAM_CF5E_[0:1]` (Z80 addr al banc 4, `_DATA_10000_.inc`):

```
Byte  Contingut
  0   Position index (×8 = scroll offset)
  1   Paràmetre → _RAM_D0E0_
 2–3  Scroll threshold word → _RAM_D0E1_
  4   Room type (& $1F) → índex a _DATA_48C5_ (jump table 31 entrades)
 5–6  Z80 ptr → tile data record per a la room → guardat a _RAM_CFFA_
```

Acabador: byte $FF.

### `_LABEL_48A9_` — Room Transition Handler

Llegeix l'entrada activa de la room_seq_table:
1. Llegeix room_type (byte 4) + tile_ptr (bytes 5–6)
2. Guarda tile_ptr → `_RAM_CFFA_`
3. Fa dispatch via `_DATA_48C5_[room_type & $1F]` (31-entry jump table)

### Variables de RAM importants

| Adreça | Nom | Contingut |
|--------|-----|-----------|
| `$CF81` | `_RAM_CF81_` | Flag de V-blank / frame acabat; **no** selector de `_DATA_1CCC0_` |
| `$CFFA` | `_RAM_CFFA_` | Ptr Z80 al tile data record de la room actual (set per `_LABEL_48A9_`) |
| `$CF5E` | `_RAM_CF5E_` | 8 bytes de paràmetres de room; bytes 0–1 = ptr a room_seq_table |
| `$D0E0` | `_RAM_D0E0_` | Paràmetre de room (byte 1 de room_seq_table) |
| `$D0E1` | `_RAM_D0E1_` | Scroll threshold word (bytes 2–3 de room_seq_table) |

### Fitxers de dades binàries (dins el disassembly .inc)

| Fitxer | ROM offset | Mida | Contingut |
|--------|-----------|------|-----------|
| `_DATA_10000_.inc` | $10000 | ~$C96 | Room sequence tables (7 bytes/entry, ends $FF); banc 4 |
| `_DATA_10C96_.inc` | $10C96 | 5793 bytes | Room records principals + sub-records; estructura variable, NO indexada per room_id directament |
| `_DATA_1CCC0_.inc` | $1CCC0 | 62 bytes | 31 × word Z80, ptr a screen_prog per banc 7 |

> **AVÍS:** Els fitxers `.inc` son dumps binaris del disassembler, no codi. La majoria del contingut son bytes de dades amb algun label WLA-DX intercalat.

### Cadena de punters traçada per la Room 0

```
_DATA_1CCC0_[0]    = $8CFE → ROM $1CCFE   screen_prog data (name table room 0)

Sub-record @ ROM $100B4:
  _RAM_CF5E_ ← [$44,$8D,$B1,$A1,$90,$AD,$10,$FF]
  room_seq_table ptr = $8D44 → ROM $1CD44
  P2 (tile-data per _LABEL_8FB_) = $A400 → ROM $12400
```

---

## Fases de desenvolupament

### Fase 0 — ROM Analyzer
**Estat: ✅ En desenvolupament actiu** (veure secció anterior)

### Fase 1 — Asset extractors
Eines individuals per extreure tiles, mapes i sprites un cop identificades les adreces.
**Estat: ⬜ Pendent**

### Fase 2 — Editor de pantalles
Canvas interactiu per crear pantalles amb els assets extrets.
**Estat: ⬜ Pendent**

### Fase 3 — Guardar i compartir
Exportar/importar pantalles com a JSON.
**Estat: ⬜ Pendent**

### Fase 4 — Player / motor de joc
Motor que executa les pantalles creades amb físiques fidels al joc original.
**Estat: ⬜ Pendent**

---

## Convencions de codi

- **Tot JavaScript vanilla**, sense frameworks ni build tools
- Cada eina és un **fitxer HTML autònom** (funciona obrint-lo directament al navegador)
- Estètica: tema fosc, retro-futurista, inspirat en consoles i dev tools dels 90s
- Tots els textos de la UI en **anglès**
- Adreces sempre en hexadecimal, format `0xXXXXX` (5 dígits) per a absolutes i `BB:ZZZZ` per a Z80

---

## Recursos externs útils

- [SMS Power! - Technical Reference](https://www.smspower.org/Development/Index) — format de ROM, VDP, tiles
- [Emulicious](https://emulicious.net/) — emulador + debugger + disassembler (en ús actiu)
- [WonderBoy DataCrystal](https://datacrystal.tcrf.net/wiki/Wonder_Boy_III:_The_Dragon%27s_Trap) — notes de reverse engineering
- [SMS VDP Documentation](https://www.smspower.org/Development/VDPRegisters) — xip gràfic

---

## Notes de sessió

- **2025-03** — Sessió inicial. Arquitectura definida. Decisió 100% frontend + ROM upload. MD5 fingerprinting. Inici Fase 0.
- **2026-03 (1)** — Fase 0 en desenvolupament actiu. Implementades: Memory Map amb CARVE, Inspector amb hex dump complet + `BB:ZZZZ`, preview per tipus, merge de regions, `palette_manual`, `tile_map`, Sprite/BG Composer (modes manual + tilemap), sistema de projectes via `api.php`.
- **2026-03 (2)** — Reverse engineering intensiu. Descoberta l'arquitectura de rooms: `_DATA_1CCC0_` (31 entrades), `_LABEL_5EB_` dispatcher, `_LABEL_2620_`/`_LABEL_26F4_` chain, room_seq_table format (7 bytes/entry), sub-record format, RST vectors i la diferència entre `screen_prog` (name table) i loaders `8FB/998` (patterns VRAM).
- **2026-03 (3)** — L'Inspector passa a ser l'eina principal de descoberta. Afegits: `DISCOVERY`, tipus `pointer_table`, `vram_loader_8fb`, `vram_loader_998`, `room_subrecord`, `room_seq_table`, preview estructural de pointer tables, decoder compartit real de `_LABEL_604_`, execution trace de `screen_prog` i avís explícit sobre falses taules `.dw` generades pel disassembler.

---

## Propera tasca per a Claude

### Prioritat 1 — Render real de `screen_prog` contra VRAM sintètica

El problema principal actual no és el decoder de `_LABEL_604_`, sinó la font dels tiles. Cal:

1. Construir una **VRAM sintètica** de 16KB per escena.
2. Omplir-la amb els loaders `8FB/998` correctes abans de renderitzar el `screen_prog`.
3. Fer que la preview `SCREEN BYTECODE` llegeixi els tiles des d'aquesta VRAM, no d'un offset lineal de ROM.
4. Mostrar la **proveniència dels slots VRAM**: quin loader omple cada slot i quins slots queden sense resoldre.

### Prioritat 2 — Scene recipes / càrrega per pantalla

Per renderitzar pantalles reals com hospital, continue/new game o altres rooms cal modelar una recepta:

- `screen_prog`
- `vram_loader_8fb`
- `vram_loader_998`
- paleta BG / SPR
- bank i/o context necessari

Aquestes receptes poden ser derivades del reverse engineering i guardades com a metadades del projecte.

### Prioritat 3 — Traça de feeders cap a `8FB/998`

Cal seguir millor la cadena:

`selector RAM/estat → pointer_table/subrecord → dades loader → slots VRAM`

L'objectiu és etiquetar millor `map.json` i distingir entre:
- taules de punters reals
- subrecords de room
- falses `.dw` del disassembler

### Notes d'implementació

- Conversió Z80→ROM per banc 4: `rom_off = 4×$4000 + (z80 - $8000) = z80 + $8000`
- Conversió Z80→ROM per banc 7: `rom_off = 7×$4000 + (z80 - $8000) = z80 + $14000`
- `_LABEL_5EB_` consumeix `_DATA_1CCC0_`, però l'índex li entra en `A`; no surt de `_RAM_CF81_`
- Els fitxers `.inc` son dumps binaris; cal llegir-los com a `Uint8Array`, no com a text
