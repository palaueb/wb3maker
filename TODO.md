Per Família
Àrea	Fet	Falta
Implementació ponderada total de decoders	64%	36%
Tiles, palettes i VRAM	69%	31%
Screen programs	74%	26%
Zones, rooms, doors i transitions	68%	32%
Collision maps i bounds	56%	44%
Metasprites i animation	58%	42%
Entities, items i behaviors	60%	40%
Music, SFX i audio driver	57%	43%
Text, HUD, menu, inventory i password	56%	44%
RAM roles i game state	70%	30%

Decoders
vram_loader_8fb	100%	0%
sms_cram_palette	100%	0%
null_padding_classifier	100%	0%
vram_loader_998	100%	18%
sms_4bpp_tiles	82%	18%
screen_prog_604	100%	0%
input_script_bfd	72%	28%
ram_symbol_index	70%	30%
z80_pointer_table_le	68%	32%
metasprite_records	62%	38%
room_zone_records	62%	38%
text_ascii_probe	62%	38%
routine_label_index	60%	40%
music_stream_experimental	58%	42%
tile_map_layout	58%	42%
screen_prog_table	100%	0%
palette_vdp_script	58%	42%
entity_animation_streams	58%	42%
collision_runtime_catalogs	56%	44%
entity_item_records	56%	44%
text_menu_status_records	56%	44%
audio_driver_runtime_metadata	54%	46%



Connectar tile_map_layout amb palettes reals en lloc de colors estructurals genèrics.
Completar tile_map_layout: ownership, dimensions, tileset i palette provenance.

Continuar palette_vdp_script per reproduir efectes de paleta frame-by-frame sobre aquests CRAM base records.

Obrir el bloc d’àudio: PSG/FM stream model, taules de música/SFX i primer player read-only al navegador.
Avançar music_stream_experimental cap a un player PSG/FM read-only al navegador.


Atacar music_sfx_audio: localitzar millor driver PSG, streams, taules SFX/music i preparar preview/listener read-only.
Continuar amb music_sfx_audio: streams, PSG model i listener read-only.

Convertir metasprite_records + entity_animation_streams en previews animades reals.

Lligar entity_animation_streams amb entitats reals: enemy id → animation → metasprite → tile source → behavior/drop/collision.
Fer una pàgina clara de “Asset Workbench” separada per apartats: tiles, palettes, metasprites, animations, rooms, audio, entities.
Fer un Asset Workbench més clar per navegar: screens, tiles, palettes, metasprites, animations, rooms, audio.
Crear una vista Asset Workbench clara per navegar decoders i labels.


Afegir a la UI el resum de provenance: coverage combinada, source families, scene recipe usages, unresolved spans i shape stats.
Persistir el catàleg world-sms-4bpp-tiles-decoder-completion-* a WORLD/map.json i passar al següent bloc feble: audio, collision o entities.