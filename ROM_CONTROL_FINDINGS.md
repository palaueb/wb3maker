# ROM Control Findings

Document viu de troballes de reverse engineering orientades exclusivament a controlar la ROM de Wonder Boy III (SMS).

Principis:
- només troballes útils per mapar i entendre la ROM
- res d'editor/player/fases futures si no ajuda directament al control del binari
- cada troballa ha d'ajudar a millorar `projects/WORLD/map.json`

Format recomanat per a cada troballa:
- `Finding`
- `Why it matters`
- `ROM regions`
- `Evidence`
- `Execution effect`
- `Map impact`
- `Confidence`

## 2026-03-24

### `_LABEL_8FB_` és un loader base de tile patterns cap a VRAM

Why it matters:
Converteix scripts compactes de dades en escriptures concretes de VRAM. Això fa que una regió `vram_loader_8fb` sigui controlable i no només “bytes opacs”.

ROM regions:
- rutina `0x008FB` (`_LABEL_8FB_`)
- bucle intern `0x00919`
- helper de VDP `0x0098F`
- scripts com `_DATA_2A55_` i `_DATA_28D6_`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L2200)
- [tools/js/panel-simulator.js](/media/marc/4T_EXFAT/z80/wb3/tools/js/panel-simulator.js#L12)

Execution effect:
- escriu `Port_VDPAddress` i `Port_VDPData`
- usa `_RAM_CF82_`, `_RAM_CFF7_`, `_RAM_D0F0_`, `_RAM_D0F2_`, `_RAM_D0F3_`, `_RAM_D0EE_`
- canvia banc temporalment via `_LABEL_1023_` / `_LABEL_1036_`

Map impact:
Convindria suportar a `region.analysis`:
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

### `_LABEL_998_` és un segon loader de tile patterns, no un `screen_prog`

Why it matters:
Ara mateix és fàcil confondre dades de patterns VRAM amb dades de name table. Separar aquests dos fluxos és clau per tenir cobertura estructural correcta.

ROM regions:
- rutina `0x00998`
- sublabels `0x0099B`, `0x009C3`, `0x00A14`
- script `_DATA_2AE2_`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L2291)
- [tools/js/panel-simulator.js](/media/marc/4T_EXFAT/z80/wb3/tools/js/panel-simulator.js#L41)

Execution effect:
- escriu patterns a VRAM
- suporta `zero-fill`
- suporta reposicionament de VRAM sense llegir una font nova
- no escriu CRAM

Map impact:
`_DATA_2AE2_` hauria d'estar etiquetat com a `vram_loader_998` o equivalent, i `region.analysis` hauria de poder guardar `supportsZeroFill` i `supportsSetVramPos`.

### `_LABEL_8B2_` carrega paletes a RAM shadow

Why it matters:
Els canvis visuals no venen sempre d'una escriptura directa a CRAM. Hi ha una capa intermèdia de RAM que cal representar.

ROM regions:
- rutina `0x008B2`
- taula de paletes al voltant de `0x1C5B0`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L2154)

Execution effect:
- copia paletes de 16 bytes a `_RAM_CF9B_` i `_RAM_CFAB_`
- no toca directament els ports VDP en aquesta rutina

Map impact:
Cal poder reflectir relacions `palette ROM -> shadow RAM -> commit visual` i mides reals de buffers RAM.

### `_LABEL_508_` i `_LABEL_4BD_` formen el nucli bootstrap + loop persistent

Why it matters:
Marquen l'eix principal `setup -> càrrega de recursos -> bucle per-frame`. És una peça clau per donar estructura al mapa.

ROM regions:
- `_LABEL_508_` a `0x00508`
- `_LABEL_4BD_` a `0x004BD`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L1554)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L1583)

Execution effect:
- `_LABEL_508_` prepara estat i carrega scripts VRAM
- `_LABEL_4BD_` entra en bucle persistent i consumeix estat de runtime

Map impact:
Aquestes regions necessiten etiquetatge funcional més fort i relacions explícites amb les dades que consumeixen.

## 2026-03-25

### Cadena de càrrega de room/mapa: `room_record` → `sub-record` → loaders VRAM → `screen_prog`

Why it matters:
Aquest és el punt correcte per començar abans d'analitzar l'scroll. Si s'entén bé la càrrega de room, després l'scroll només és la lògica que decideix quan saltar a un altre record i activar la mateixa maquinària.

ROM regions:
- `_LABEL_2620_` a `0x02620`
- `_LABEL_26F4_` a `0x026F4`
- `_LABEL_48A9_` a `0x048A9`
- `_LABEL_5EB_` a `0x005EB`
- `_DATA_10C96_` a `0x10C96`
- `_DATA_10000_` a `0x10000`
- `_DATA_1CCC0_` a `0x1CCC0`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L6363)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L6472)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L1732)
- [CLAUDE.md](/media/marc/4T_EXFAT/z80/wb3/CLAUDE.md#L414)

Execution effect:
- `_LABEL_2620_` entra amb `HL -> room_record`, inicialitza diversos paràmetres de room en RAM, llegeix el punter al sub-record via `rst $18`, crida `_LABEL_26F4_`, després crida rutines de setup addicionals i retorna.
- `_LABEL_26F4_` consumeix el sub-record: copia 8 bytes a `_RAM_CF5E_`, llegeix el punter següent i el passa a `_LABEL_8FB_`, després processa dades addicionals amb `_LABEL_DC2_`, pot cridar `_LABEL_998_`, i acaba seleccionant paletes via `_LABEL_8B2_`.
- `_LABEL_48A9_` és el dispatcher runtime: llegeix una entrada activa, desa punters a `_RAM_CFFA_` i `_RAM_D0DE_`, i segons `room_type` decideix si la càrrega de room va directa a `_LABEL_2620_` o queda diferida via `_RAM_C26C_`.
- `_LABEL_5EB_` no carrega tiles: selecciona el banc 7, indexa `_DATA_1CCC0_` amb `room_id`, obté el punter al `screen_prog` i crida `_LABEL_604_`, que és qui escriu la name table.

Map impact:
Per a `map.json`, aquesta cadena s'hauria de poder representar explícitament així:
- `room_record` consumeix `sub-record`
- `sub-record` consumeix `room_seq_table`
- `sub-record` també consumeix dades per a `_LABEL_8FB_`
- `room_id` consumeix `_DATA_1CCC0_` via `_LABEL_5EB_`
- `room_seq_table entry` fa dispatch via `_LABEL_48A9_`
- `room_seq_table entry` pot carregar un sub-record nou immediatament o diferir-lo
- `_LABEL_604_` és només la capa de name table, no el loader principal de room

Confidence:
high

### `_LABEL_26F4_` és el loader central de recursos per-room

Why it matters:
És la rutina que realment converteix un sub-record en estat visual i paràmetres de room. Si s'ha de descobrir com el joc carrega nous tiles i colors quan entres a una room, aquest és el primer focus.

ROM regions:
- `_LABEL_26F4_` a `0x026F4`
- `_LABEL_8FB_` a `0x008FB`
- `_LABEL_998_` a `0x00998`
- `_LABEL_8B2_` a `0x008B2`
- `_DATA_275D_` i `_DATA_2762_`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L6472)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L6515)

Execution effect:
- copia 8 bytes del sub-record a `_RAM_CF5E_`
- desa un punter de treball a `_RAM_D0FE_`
- carrega patterns VRAM via `_LABEL_8FB_`
- processa un bloc addicional via `_LABEL_DC2_`
- segons flags del sub-record, selecciona `_DATA_275D_` o `_DATA_2762_` i passa per `_LABEL_998_`
- finalment llegeix un selector de paleta i el passa a `_LABEL_8B2_`
- la branca de `patterns/paleta` queda clarament separada de la branca de `screen_prog`

Map impact:
El sub-record no s'ha de modelar com un blob genèric. Té almenys aquestes fases:
- `header/copied params`
- `8fb tile-data pointer`
- `extra data for _LABEL_DC2_`
- `flag byte -> optional 998 script`
- `palette selector / visual params`

Confidence:
high

### `_LABEL_48A9_` és el pont entre la seqüència de room i la càrrega efectiva

Why it matters:
Aquesta rutina fa la transició entre l'entrada activa de `room_seq_table` i el loader de room. És una peça clau per al futur anàlisi de l'scroll, perquè probablement l'scroll acabarà fent avançar aquesta seqüència.

ROM regions:
- `_LABEL_48A9_` a `0x048A9`
- `_DATA_48C5_` jump table
- `_RAM_CFFA_`
- `_RAM_D0DE_`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L11076)

Execution effect:
- llegeix una entrada apuntada per `HL`
- guarda `DE` a `_RAM_CFFA_` com a punter al tile data record actual
- guarda `HL` a `_RAM_D0DE_`
- fa dispatch via `_DATA_48C5_`
- la primera branca (`_LABEL_4903_`) acaba fent `ld hl, (_RAM_CFFA_)` i `call _LABEL_2620_`
- altres branques no carreguen la room immediatament: desen el punter a `_RAM_C26C_` i el loader real s'executa més tard des d'una màquina d'estats de runtime

Map impact:
Aquí convé modelar:
- `room_seq_table entry -> room_type`
- `room_seq_table entry -> tile data pointer`
- `room_type -> dispatch target`
- `dispatch target -> direct room load | deferred room load`

Confidence:
high

### `_LABEL_5EB_` i `_DATA_1CCC0_` només resolen el background script visible

Why it matters:
Això delimita el paper de `screen_prog`: és important, però no és “el mapa” complet. Si es confon `_DATA_1CCC0_` amb el sistema sencer de room, es perden els loaders de patterns i la seqüència real del món.

ROM regions:
- `_LABEL_5EB_` a `0x005EB`
- `_DATA_1CCC0_` a `0x1CCC0`
- `_LABEL_604_` a `0x00604`
- `_RAM_CF81_`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L1732)
- [CLAUDE.md](/media/marc/4T_EXFAT/z80/wb3/CLAUDE.md#L376)

Execution effect:
- canvia a banc 7
- indexa `_DATA_1CCC0_` amb `room_id * 2`
- resol un punter a `screen_prog`
- crida `_LABEL_604_`, que escriu la name table
- funcionalment és una taula `room_id -> screen_prog ptr`; no és el sub-record principal de room

Map impact:
`_DATA_1CCC0_` s'ha de tractar com:
- `room_id -> screen_prog ptr`

No com:
- definició completa de room
- taula única del sistema de scroll
- font dels tiles VRAM

Confidence:
high

### `_DATA_10000_` és més aviat una taula upstream de seqüència/índex que no el sub-record final

Why it matters:
Ajuda a no confondre capes de dades. Si `_DATA_10000_` es tracta com “la definició final de room”, es barreja amb `_DATA_10C96_` i amb els sub-records que realment acaben a `_LABEL_2620_`/`_LABEL_26F4_`.

ROM regions:
- `_DATA_10000_` a `0x10000`
- `_LABEL_48A9_` a `0x048A9`
- `_RAM_D0DE_`

Evidence:
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L3550)
- [CLAUDE.md](/media/marc/4T_EXFAT/z80/wb3/CLAUDE.md#L486)

Execution effect:
- alimenta l'escaneig/seqüència que construeix punters de treball i pot acabar a `_LABEL_48A9_`
- actua com a capa upstream o coarse map index
- no substitueix el sub-record final consumit per `_LABEL_2620_`

Map impact:
Convé separar conceptualment:
- `_DATA_10000_` = seqüència / taula upstream
- `_DATA_10C96_` i sub-records derivats = payload real de càrrega de room

Confidence:
medium

### Posicions de RAM ja ubicades: funció actual i conflictes pendents

Why it matters:
Per controlar la ROM no n'hi ha prou amb saber on són els blocs de dades. Cal saber quin estat de RAM governa la càrrega de rooms, la còpia a VRAM, les paletes, el scroll i alguns flags globals de runtime.

Evidence:
- [projects/WORLD/map.json](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/map.json#L18065)
- [CLAUDE.md](/media/marc/4T_EXFAT/z80/wb3/CLAUDE.md#L431)
- [CLAUDE.md](/media/marc/4T_EXFAT/z80/wb3/CLAUDE.md#L476)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L1749)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L2042)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L2200)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L6472)
- [projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).asm](/media/marc/4T_EXFAT/z80/wb3/projects/WORLD/Wonder%20Boy%20III%20-%20The%20Dragon's%20Trap%20(World)%20(Digital).asm#L11076)

#### Alta confiança

| Adreça | Nom actual al mapa | Funció actual | Notes |
|--------|---------------------|---------------|-------|
| `$CF5E-$CF65` | `_RAM_CF5E_` + `CURRENT ZONE` a `$CF65` | Bloc de 8 bytes copiat del `sub-record` de room | bytes `0-1` = ptr a `room_seq_table`; bytes `2-7` = paràmetres de room/scroll. El byte `$CF65` queda integrat dins aquest bloc i avui el mapa el tracta com a “CURRENT ZONE”. |
| `$CF81` | `V-BLANK FLAG` | Flag de frame acabat / V-blank | Confirmat a `CLAUDE.md`: no és l'índex de `_DATA_1CCC0_`. |
| `$CF82` | `TILE LOADING FLAG` | Flag de secció crítica mentre s'escriu VRAM | Es posa a `1` a `_LABEL_604_`, `_LABEL_8FB_`, `_LABEL_998_`, `_LABEL_A14_` i torna a `0` en acabar. És més aviat “VDP busy / tile upload active” que no un flag exclusiu d'un sol loader. |
| `$CF97` | `TILE PROPERTIES` / `CURRENT_ATTR` | Byte d'atributs de tile actual | `_LABEL_604_` el llegeix i l'escriu com a atribut corrent del `screen_prog`. Les dues etiquetes del mapa semblen ser la mateixa variable vista des de dos angles. |
| `$CF9B-$CFAA` | `Shadow paleta 0` | Buffer shadow de paleta de fons | `_LABEL_8B2_` copia aquí la paleta ROM. |
| `$CFAB-$CFBA` | `Shadow paleta 1` | Buffer shadow de paleta de sprites | `_LABEL_8B2_` també l'omple. |
| `$CFBB-$CFCA` | `Paleta activa fons` | Paleta de fons ja processada per fade i llesta per flush | `_LABEL_7EC_` escriu els 32 bytes processats a partir de `$CF9B`, i els primers 16 acaben aquí. |
| `$CFCB-$CFDA` | `Paleta activa sprites` | Paleta de sprites ja processada per fade i llesta per flush | Segona meitat de la sortida de `_LABEL_7EC_`. |
| `$CFDB` | `BRIGHTNESS LEVEL` / `FADE_FACTOR` | Nivell de fade global de paleta | `_LABEL_822_` i `_LABEL_849_` el mouen entre `0..3`; `_LABEL_7EC_` l'aplica sobre els 32 bytes de paleta. Les dues etiquetes del mapa semblen ser la mateixa variable. |
| `$CFE0` | `SAT FLAG` | Flag de refresc de sprites | El mapa el descriu com a “cal actualitzar sprites”; és coherent amb el nom i amb el patró d'ús global del motor. |
| `$CFE1` | `SCROLL FLAG` | Flag de refresc de pantalla/scroll després de càrregues i transicions | Es posa a `1` després de molts loaders i transicions de room. El nom actual és bo, però probablement representa “screen update requested” més que només scroll pur. |
| `$CFE2` | `PAL DIRTY` | Flag de flush de paleta al VDP | `_LABEL_822_`, `_LABEL_849_` i altres rutines de paleta el posen a `1` després de reconstruir la paleta activa. |
| `$CFFA-$CFFB` | `_RAM_CFFA_` | Punter Z80 al tile-data record de la room actual | El fixa `_LABEL_48A9_` i el consumeix `_LABEL_2620_`. És clau per rastrejar transicions de room. |
| `$D0E0` | `_RAM_D0E0_` | Paràmetre de room procedent de `room_seq_table` | Confirmat per `CLAUDE.md`. Fora d'aquest context també es reutilitza com a comptador o índex temporal, així que el significat depèn de la rutina. |
| `$D0E1-$D0E2` | `_RAM_D0E1_` | `scroll threshold word` procedent de `room_seq_table` | Confirmat per `CLAUDE.md`. Igual que `$D0E0`, en altres rutines també actua com a scratch/punter temporal. |
| `$D0EC` | `índex paleta per remapejat` | Índex de paleta per a remapeig/transformació de tiles | Es calcula a partir d'un byte de configuració i alimenta el processament de tiles. |
| `$D0ED` | `comptador tiles processats` | Comptador intern del loader `_LABEL_998_` | S'incrementa cada cop que `_LABEL_998_` processa un bloc o un `zero-fill`. |
| `$D0EE-$D0EF` | `punter font dades ROM` | Punter de font actual per al loader de patterns | `_LABEL_8FB_` i `_LABEL_998_` el fan servir com a cursor de lectura sobre dades ROM. |
| `$D0F0-$D0F1` | `punter destí VRAM` | Punter/offset de destí actual dins VRAM | `_LABEL_8FB_` i `_LABEL_998_` l'avancen en salts de `$20` bytes per tile row. |
| `$D0F2` | sense entrada pròpia al mapa | Comptador de tiles del comandament actual de `_LABEL_8FB_` | Byte temporal per al bloc que s'està copiant ara mateix. |
| `$D0F3` | `nombre total de tiles a carregar ($08 per defecte)` | Comptador de “tile rows” per iteració de loader | A `_LABEL_8FB_` arrenca a `$08`; es pot sobreescriure des de l'script. |
| `$D0FE-$D0FF` | sense entrada pròpia al mapa | Scratch pointer / cursor de treball | A `_LABEL_26F4_` apunta dins el `sub-record` mentre es van consumint camps; en altres rutines es reutilitza com a comptador o punter temporal. |
| `$C26C-$C26D` | `_RAM_C26C_` | Punter diferit a record de room o transició | `_LABEL_48A9_` el desa per a branques diferides; més tard diversos estats l'avancen i el passen a `_LABEL_2620_`. |
| `$C26E` | `_RAM_C26E_` | `room_type` / mode de transició actual | S'omple des del byte de dispatch de `_LABEL_48A9_` i després indexa la màquina d'estats de transició. |

#### Mitjana o provisional

| Adreça | Nom actual al mapa | Lectura actual | Notes |
|--------|---------------------|----------------|-------|
| `$CF8C` | `X-Scroll` | Scroll horitzontal actual | Encara no està lligat a una rutina concreta dins del document, però la interpretació és coherent. |
| `$CF8D` | `Y-Scroll` | Scroll vertical actual | Mateix cas que `$CF8C`. |
| `$D005` | `EARTHQUAKE` | Flag/contador d'efecte de terratrèmol | El nom del mapa té bona pinta; encara falta creuar-lo amb la rutina exacta que sacseja càmera o scroll. |
| `$CF98` | `PAUSE FLAG` | Estat de pausa/NMI | Encara no s'ha documentat la cadena completa de consum. |
| `$D278` | `LEVEL LOADER FLAG` | Flag global relacionat amb càrrega de nivell/room | Bona hipòtesi, pendent de rastreig complet. |
| `$C23C` | `PAL_CYCLE_OFFSET` | Offset per cicles de paleta | `_LABEL_849_` el posa a `0` en acabar un fade, així que probablement participa tant en fades com en palette cycling. |
| `$D121-$D122` | `CURRENT BANK REFERENCE` | Punter o còpia estable del banc actual | El mapa el descriu com a punter cap a `$D123`; cal confirmar si és una simple referència o una abstracció del sistema de bancs. |
| `$D123` | `CURRENT BANK` | Banc actual actiu | Molt plausible, però encara sense secció pròpia documentada. |
| `$D116` | `TILE PIXEL COUNTER` | Comptador per processar 8 píxels per fila | La nota del mapa és coherent amb el tipus de rutines de tiles; falta fixar exactament quina rutina el consumeix. |
| `$CF88` | `NEW GAME OPTION` | Opció `Continue/New Game` | Valor d'estat d'UI/menú, no de motor de mapa. |
| `$C24F` | `PLAYER TRANSFORMATION` | Forma actual del jugador | Estat de jugador útil, però encara no integrat al flux de room/scroll. |
| `$C251` | `PLAYER DIRECTION` | Direcció actual del jugador | També útil per runtime, pendent de documentar-se dins del loop de gameplay. |

#### Conflictes i neteja pendent al mapa

- `$CF97` està duplicat com `TILE PROPERTIES` i `CURRENT_ATTR`. Tot apunta que és la mateixa variable.
- `$CFDB` està duplicat com `BRIGHTNESS LEVEL` i `FADE_FACTOR`. Tot apunta que és la mateixa variable.
- Les regions de paleta `Shadow paleta 0`, `Shadow paleta 1`, `Paleta activa fons` i `Paleta activa sprites` avui estan modelades amb `size: 1`, però semànticament són buffers de `16` bytes.
- Les regions `punter font dades ROM` i `punter destí VRAM` també haurien de tractar-se com a paraules de 16 bits, no com a bytes solts.
- Variables com `$D0E0`, `$D0E1` i `$D0FE` tenen semàntica de context: en el flux de room tenen un significat fort, però en altres rutines es reutilitzen com a scratch. Al mapa això convé reflectir-ho com a “rol principal + reuse”.

Map impact:
Per a `map.json`, aquesta secció apunta a tres millores concretes:
- permetre intervals RAM reals (`$CF9B-$CFAA`, `$CFAB-$CFBA`, etc.) en lloc d'entrades de 1 byte quan el buffer és estructural
- admetre “alias semàntics” per a la mateixa adreça (`$CF97`, `$CFDB`)
- distingir variables de significat estable d'scratch registers reutilitzats (`$D0E0`, `$D0E1`, `$D0FE`)

Confidence:
mixed
