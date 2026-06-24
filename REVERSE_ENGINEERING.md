# Wonder Boy III: The Dragon's Trap — Reverse Engineering Guide

Guia de referència de tot el que s'ha descobert sobre l'arquitectura interna del joc.
Última actualització: 2026-04-04

---

## Nivell 0 — El ROM i la memòria

El ROM té **512 KB** dividits en **16 bancs de 16 KB** (`$0000–$3FFF` cada un). El Z80 veu finestres de 16 KB a les adreces `$0000`, `$4000`, `$8000`. El Sega Mapper decideix quin banc físic apareix a cada finestra.

```
ROM offset = banc × $4000 + (Z80_addr - window_base)
  banc 4: rom = z80 + $8000
  banc 5: rom = z80 + $C000   (on viu _DATA_14000_)
  banc 6: rom = z80 + $10000  (on viu _DATA_18000_)
  banc 7: rom = z80 + $14000  (on viuen les 31 rooms estàtiques)
```

---

## Nivell 1 — Els dos sistemes de mapa (paral·lels, independents)

El joc té **dues formes completament separades** de dibuixar el món:

```
┌─────────────────────────────────┬──────────────────────────────────┐
│  SINGLE SCREEN MAP              │  SCROLL MAP                      │
│  (screen_prog / _LABEL_604_)    │  (_LABEL_DC2_ + _LABEL_EF3_)    │
├─────────────────────────────────┼──────────────────────────────────┤
│ 31 pantalles fixes              │ 26 zones amb scroll horitzontal  │
│ Botiga, hospital, boss room...  │ El món d'aventura jugable        │
│ Es dibuixen d'un sol cop        │ Es dibuixen columna per columna  │
│ Dades: _DATA_1CCC0_ (banc 7)   │ Dades: _DATA_14000_ (banc 5)    │
│ Format: stream d'opcodes        │ Format: dades comprimides        │
│ Escriu directament a VRAM $3800 │ Passa per _RAM_CB00_ primer      │
└─────────────────────────────────┴──────────────────────────────────┘
```

Tots dos acaben escrivint a la **Name Table VRAM** (`$3800–$3FFF`), però per camins separats.

---

## Nivell 2 — Els gràfics (tiles)

Abans de poder dibuixar res, cal tenir els **patrons de tile** a la VRAM (`$0000–$37FF`). Això ho fan dos loaders:

### `_LABEL_8FB_` — Tile Pattern Loader (format 5 bytes/entrada)

```
[count][vram_lo][vram_hi][src_lo][src_hi]
  count   = nombre de tiles a copiar (0 = END)
  vram    = slot VRAM destí (vram_lo | vram_hi<<8) × 32
  src     = codifica banc i bloc origen
    bank        = src_hi >> 1
    block_index = ((src_hi & 1) << 8) | src_lo
    ROM offset  = bank × $4000 + block_index × 32
```

### `_LABEL_998_` — Tile Pattern Loader (format variable)

```
byte b7=1  → SetVRAMPos: count = byte & $7F, tile_slot = next byte
byte b7=0  → count = byte (manté posició VRAM)
count=$7F  → escriu 32 zeros a VRAM (tile buit)
count≠$7F  → llegeix [src_lo, src_hi], copia count×32 bytes → VRAM
byte=0     → END
```

**La font dels tiles** és sempre el bloc `$20000–$3FFFF` (bancs 8–15).
Cada tile = 32 bytes (format 4bpp planar SMS).

### Format 4bpp planar SMS

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

### Paleta

- 32 colors a CRAM: 16 per al background (BG), 16 per als sprites (SPR)
- Format color SMS: `00BBGGRR` (2 bits per canal)
- Es carreguen via escriptures al port VDP o des de regions `palette` / `palette_manual`
- `_DATA_B4F_` ($0B4F, 64 bytes): taula de remap de colors, 4 paletes × 16 entrades

---

## Nivell 3 — Com funciona cada sistema de mapa

### Sistema A: Single Screen Map (31 rooms)

```
_DATA_1CCC0_ (banc 7, ROM $1CCC0)
  31 entrades × 2 bytes = word Z80 → apunta a stream screen_prog

stream screen_prog (_LABEL_604_):
  byte < $F0  → escriu tile directe a Name Table (avança cursor)
  $F0         → set columna cursor
  $F1         → set fila cursor
  $F2         → escriu word directe
  $F3         → fill N tiles igual
  $F4         → copy N tiles des de ROM
  $F5–$FE     → altres opcodes de posicionament
  $FF         → END

Accés: _LABEL_5EB_(room_id en A)
  → llegeix _DATA_1CCC0_[room_id × 2] → ptr Z80 banc 7
  → crida _LABEL_604_(ptr)
```

Conversió Z80 → ROM per banc 7: `rom = z80 + $14000`

Aquestes 31 rooms **no tenen scroll** ni portes de zona — son pantalles completes fixes.

---

### Sistema B: Scroll Map (26 zones)

#### Pas 1 — Descompressió (`_LABEL_DC2_`)

```
_DATA_14000_ (banc 5, ROM $14000)
  ~176 pointers (word LE) → cada un apunta a dades comprimides

Format de compressió:
  byte < $E3        → tile index directe (raw, 1 byte)
  byte $E3–$FE      → RLE: count = byte-$E0, value = next byte (2 bytes)
  $FF $FF           → END
  $FF [count][val]  → RLE extès amb count explícit (3 bytes)

Resultat → _RAM_CB00_ (buffer intermedi, RAM):
  12 columnes × 11 files
  stride entre files = $60 bytes (96 bytes)
  stride entre columnes = $10 bytes
  layout: col C, fila R → offset = C×$10 + R×$60
```

`_LABEL_DC2_` rep 6 índexos del descriptor de zona → fa 6 iteracions → omple les 12 columnes (6 grups de 2 columnes parells/senars).

#### Pas 2 — Lookup (`_DATA_18000_`)

```
_DATA_18000_ (banc 6, ROM $18000)
  tile_index × 8 → 8 bytes:
    bytes 0–3: 2 name table words per columna PARELL  (col % 2 == 0)
    bytes 4–7: 2 name table words per columna SENAR   (col % 2 == 1)
```

Cada "name table word" (2 bytes) segueix el format SMS estàndard:
- bits 0–8: tile index (0–511)
- bit 9: hflip
- bit 10: vflip
- bit 11: paleta (0=BG, 1=SPR)
- bit 12: prioritat

#### Pas 3 — Draw column (`_LABEL_EF3_`)

```
Per cada columna (cridat durant el scroll):
  base = _RAM_CB00_ + (column >> 1)
  per fila 0..10:
    tileIdx = ram_cb00[base + fila × $60]
    entry   = _DATA_18000_[tileIdx × 8 + (column & 1) × 4]
    escriu 2 name table words a VRAM $3800 + col×2 + fila×$40
    avança $40 (stride name table = 32 tiles × 2 bytes)
```

---

## Nivell 4 — L'estructura de zona

Una **zona** és la unitat principal del joc. Cada zona té un descriptor i un sub-record, tots en **banc 4** (`rom = z80 + $8000`).

### Zone Descriptor (6 bytes)

```
byte 0:   scroll X inicial  ($FF = mantenir el valor actual)
byte 1:   scroll Y inicial  ($FF = mantenir)
byte 2:   camera X          ($80 = mantenir)
byte 3:   camera Y          ($80 = mantenir)
bytes 4-5: word Z80 → SUB-RECORD (en banc 4)
```

### Sub-Record (18+ bytes)

```
bytes 0-1:  Z80 ptr → DOOR TABLE (room_seq_table) → _RAM_CF5E_[0:1]
bytes 2-7:  altres paràmetres de scroll/física     → _RAM_CF5E_[2:7]
bytes 8-9:  Z80 ptr → data per _LABEL_8FB_ (tile patterns VRAM)
bytes 10-15: 6 índexos → _DATA_14000_ (les 6 columnes del scroll map)
byte 16:    flags
              bit 7 = 0 → _LABEL_998_(_DATA_275D_) capa A
              bit 7 = 1, bit 6 = 0 → _LABEL_998_(_DATA_2762_) capa B
              bit 7 = 1, bit 6 = 1 → skip capa extra
byte 17:    palette index (bits 0-5) → _LABEL_8B2_
```

### Diagrama de relacions de zona

```
Zone Descriptor (banc 4)
      │
      └──→ Sub-Record (banc 4)
              │
              ├──→ _LABEL_8FB_ data ──────────────→ tile patterns a VRAM $0000
              │
              ├──→ 6 × _DATA_14000_[idx] ──→ _RAM_CB00_ ──→ _DATA_18000_ ──→ Name Table
              │
              ├──→ _LABEL_998_(_DATA_275D_ o _DATA_2762_) ──→ capa extra VRAM
              │
              ├──→ palette index ──────────────────→ CRAM (32 colors)
              │
              └──→ Door Table ptr ─────────────────→ DOOR TABLE (room_seq_table)
                                                            │
                                                            └──→ [scroll_pos, type, ptr_destí]
```

---

## Nivell 5 — Les portes i les transicions

Les portes **no estan als tile maps** — son estructures de dades separades activades per posició de scroll.

### Door Table / Room Sequence Table (7 bytes/entrada, acaba $FF)

```
byte 0:   scroll_pos × 8 = píxel X on s'activa el trigger
byte 1:   paràmetre → _RAM_D0E0_
bytes 2-3: scroll threshold word → _RAM_D0E1_
byte 4:   room_type & $1F → índex a _DATA_48C5_ (jump table 31 entrades)
bytes 5-6: Z80 ptr → zone descriptor destí → _RAM_CFFA_
```

El jugador mai "xoca" amb un tile porta — el joc comprova si `player_scroll_x` coincideix amb `scroll_pos`.

### Dispatcher de portes (`_DATA_48C5_`, 31 tipus)

| Tipus | Label | Acció |
|---|---|---|
| 0 | `_LABEL_4903_` | Canvi de zona complet → crida `_LABEL_2620_` amb ptr destí |
| 1 | `_LABEL_492B_` | Transició simple, sense canvi de zona |
| 6, 7 | especial | Skip checks de `_RAM_C27D_` |
| 16–20 | warps | Teletransport via `_RAM_C26C_` |

---

## Nivell 6 — El flux d'inicialització d'una zona

Quan el joc carrega qualsevol zona (nou joc, porta, warp):

```
_LABEL_2620_(HL → zone descriptor)
  │
  ├── ld a, $04 → bank 4
  ├── parseja byte 0: scroll X → _RAM_C243_
  ├── parseja byte 1: scroll Y → _RAM_C246_
  ├── parseja byte 2: camera X → _RAM_C248_
  ├── parseja byte 3: camera Y → _RAM_C24A_
  ├── rst $18 → llegeix ptr sub-record (bytes 4-5) → HL
  │
  └── _LABEL_26F4_(HL → sub-record)
        │
        ├── ldir 8 bytes → _RAM_CF5E_ (door table ptr + params)
        ├── rst $18 → llegeix ptr _LABEL_8FB_ data → HL
        ├── call _LABEL_8FB_()  → tile patterns a VRAM
        ├── call _LABEL_DC2_()  → 6 columnes descomprimides → _RAM_CB00_
        ├── call _LABEL_998_()  → capa extra VRAM (si flags ho indica)
        └── call _LABEL_8B2_()  → paleta → CRAM

Continuació a _LABEL_2620_:
  ├── _LABEL_10BC_() → lookup _DATA_1C800_[_RAM_CF65_] → spawn enemies/objects
  ├── _LABEL_FA1_()  → càlcul posició càmera inicial
  ├── _LABEL_E83_()  → primer draw de columnes → Name Table
  └── _LABEL_2948_() → spawn enemies per zona
```

### Punts d'entrada

```
New Game (normal) → _DATA_10C96_ (banc 4, ROM $10C96) → _LABEL_2620_
New Game (saved)  → _DATA_10C90_ (banc 4, ROM $10C90) → _LABEL_2620_
Demo mode         → _DATA_10C96_                       → _LABEL_2620_
Porta/warp        → _RAM_CFFA_ (ptr set per _LABEL_48A9_) → _LABEL_2620_
```

Tots els callers de `_LABEL_2620_` (línies del disassembly):

| Línia | Caller | Via |
|---|---|---|
| 1479 | `_LABEL_3F8_` | New game, savegame |
| 1493 | `_LABEL_3F8_` | New game, normal |
| 1603 | `_LABEL_508_` | Demo mode |
| 11114 | `_LABEL_4903_` | Porta zona (door type 0) |
| 11628 | `_LABEL_4CFA_` | Warp |
| 11640 | `_LABEL_4D08_` | Warp |
| 11803 | `_LABEL_4DD7_` | Warp amb offset |
| 20102 | `_LABEL_B4F2_` | Seqüència especial |
| 20116 | `_LABEL_B509_` | Continue |

---

## Nivell 7 — El graf de zones

### Variables RAM clau

| Adreça | Nom | Contingut |
|---|---|---|
| `$CF65` | `_RAM_CF65_` | Zona actual (0–25) |
| `$CF5E` | `_RAM_CF5E_` | 8 bytes params zona: [0:1]=door table ptr, [2:7]=altres |
| `$CFFA` | `_RAM_CFFA_` | Ptr destí per a la propera zona (set per `_LABEL_48A9_`) |
| `$D006` | `_RAM_D006_` | Zona anterior (per retorns) |
| `$CB00` | `_RAM_CB00_` | Buffer scroll map descomprimit (12×11 bytes) |
| `$D013` | `_RAM_D013_` | Columna actual que s'està dibuixant |
| `$D017` | `_RAM_D017_` | Ptr lectura dins `_RAM_CB00_` |

### Les 26 zones (`_DATA_1C800_`, indexada per `_RAM_CF65_`)

`_DATA_1C800_` (ROM $1C800): 26 entrades (word pointers) indexades per número de zona.
Contingut de cada entrada: dades d'animació, objectes i enemies de la zona.

Escriptures conegudes a `_RAM_CF65_` (zona hardcodejada):

| Valor | Context |
|---|---|
| `$00` | Reset / retorn al castle |
| `$03` | Pickup especial |
| `$06` | Event especial |
| `$07` | Event especial |
| `$08` | Event especial |
| `$09` | Title screen |
| `$16` | Zona 22 |
| `$17` | Zona 23 |
| `$19` | Zona 25 |

### RST Vectors (dreceres Z80 usades intensivament)

| Opcode | Label | Funció |
|---|---|---|
| `rst $10` | `_LABEL_10_` | Llegeix word LE de (HL) → DE; HL += 2 |
| `rst $18` | `_LABEL_18_` | Com `$10` + `ex de,hl` (resultat a HL) |
| `rst $20` | `_LABEL_20_` | Jump table dispatch: llegeix byte de (HL), salta |
| `rst $28` | `_LABEL_28_` | Escriu A al port control VDP (`$BF`) |
| `rst $30` | `_LABEL_30_` | Escriu A al port dades VDP (`$BE`) |

---

## Nivell 8 — Mapa de dades ROM

| ROM Offset | Label | Mida | Contingut |
|---|---|---|---|
| `$0B4F` | `_DATA_B4F_` | 64 B | Color remap table (4 paletes × 16) |
| `$02AC` | `_DATA_2AC_` | 20 B | VDP init registers |
| `$10C90` | `_DATA_10C90_` | 6 B | Zone descriptor: savegame (castle) |
| `$10C96` | `_DATA_10C96_` | 5793 B | Zone data (sub-records, tile data...) |
| `$14000` | `_DATA_14000_` | ~banc 5 | ~176 pointers → scroll map comprimits |
| `$18000` | `_DATA_18000_` | 1413 B | Tile index → name table words (8B/entrada) |
| `$1C800` | `_DATA_1C800_` | 26×2 B | Zone animation/object table |
| `$1CCC0` | `_DATA_1CCC0_` | 62 B | 31 × word Z80, ptr screen_prog per room |
| `$20000` | `_DATA_20000_` | ~bancs 8-15 | Graphics tiles (4bpp planar) |

---

## Nivell 9 — Estat del rom-analyzer i tasques pendents

### Implemented al rom-analyzer

| Funcionalitat | Panell | Estat |
|---|---|---|
| Gestió de projectes | Projects | ✅ |
| ROM info + MD5 | ROM Info | ✅ |
| Mapa de bancs | Memory Banks | ✅ |
| Visor de tiles 4bpp | Tile Viewer | ✅ |
| Memory Map (regions) + CARVE | Memory Map | ✅ |
| Inspector hex + preview per tipus | Inspector | ✅ |
| DISCOVERY heurístic | Inspector | ✅ |
| Palette Registry | Palettes | ✅ |
| Compositor manual + tilemap | Composer | ✅ |
| Simulator VRAM/CRAM | Simulator | ✅ |
| Room Browser (31 rooms) | Simulator | ✅ |
| RAM Map editable | RAM Map | ✅ |
| Preview: Single Screen Map | Inspector | ✅ |
| Preview: Scroll Map (descompressió) | Inspector | ✅ |
| Preview: VRAM Loader 8FB/998 | Inspector | ✅ |
| Preview: Pointer Table + classify all | Inspector | ✅ |

### Pendent

| Funcionalitat | Descripció | Prioritat |
|---|---|---|
| Zone Map Browser | Renderitzar zones scroll completes (8FB + DC2 + $18000) | Alta |
| Parser sub-record | Extreure 8FB ptr + 6 idx + flags + pal des del sub-record | Alta |
| Door table parser | Llistar portes d'una zona amb scroll_pos i destí | Alta |
| Graf de zones | Connexions entre zones via door tables | Mitjana |
| Parser `_DATA_10C96_` | Localitzar tots els descriptors de les 26 zones | Mitjana |
| Render scroll map complet | Preview scroll_map amb tiles reals (requereix VRAM state) | Mitjana |