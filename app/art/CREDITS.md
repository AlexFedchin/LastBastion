# Last Bastion — loading-screen art

The paintings behind the loading screens were generated locally for this game with
**RealVisXL V5.0** (an SDXL fine-tune, CreativeML Open RAIL++-M, which places no
restriction on using the images), then split into a far and a near layer with a
depth map from **Depth Anything V2 Small** (Apache-2.0). Prompts, seeds and the
pipeline: `scripts/art/generate.py` and `scripts/art/layers.py`.

| File | Used for | Source image |
|---|---|---|
| `nest.webp` | boot screen | realvis `nest`, seed 22 |
| `wall.webp` | odd nights | realvis `wall`, seed 12 |
| `gunship.webp` | the gunship's nights | realvis `gunship`, seed 22 |
| `drop.webp` | resupply nights | realvis `drop`, seed 13 |
| `giant.webp` | the giants' nights | realvis `giant`, seed 23 |
| `dawn.webp` | the dawn resupply | realvis `dawn`, seed 12 |

The app icon (`build/icon.png`, `build/icon.ico`, `app/icon.png`) is realvis `icon_tower_16`,
framed by `scripts/art/icon.py make icon_tower_16 --crop 0.52 0.54 0.9 --small 0.5 0.6 0.66`.
