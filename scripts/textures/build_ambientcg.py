#!/usr/bin/env python3
"""Builds surface textures from ambientCG CC0 materials (https://ambientcg.com), downloaded
as 2K JPG zips into scripts/textures/source/ambientcg/: the hangar's (SETS) and the
valley's own terrain layers (TERRAIN).

Each set ships like the Poly Haven ones (src/world/texlib.js):
  <name>_c  colour, ambient occlusion baked in (the materials have no aoMap)
  <name>_n  OpenGL normal map
  <name>_r  G roughness, B metalness (three.js reads them from those channels)
at 2048 and 1024 px (the floor and walls), or 1024 and 512 px (the rest).

A terrain set ships the way the Poly Haven terrain sets do (build_textures.py), because the
terrain shader reads them the same way: <name>_c (AO baked in, its mean brightness matched
to the palette the valley was tuned against, its hue pulled part of the way there) and
<name>_n.

    python3 scripts/textures/build_ambientcg.py [name ...]

Requirements: Python 3, Pillow.
"""
import io
import json
import os
import sys
import urllib.request
import zipfile

from PIL import Image, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source', 'ambientcg')
OUT = os.path.join(HERE, '..', '..', 'app', 'textures')
UA = {'User-Agent': 'LastBastion-texture-build/1.0'}

# name: (ambientCG id, sizes, AO strength, notes)
SETS = {
    'hgFloor': ('Concrete031', (2048, 1024), 0.8),        # poured slab with saw-cut joints
    'hgWall': ('CorrugatedSteel005', (2048, 1024), 0.9),  # weathered corrugated cladding
    'hgSteel': ('Metal041B', (1024, 512), 0.7),                # rust-streaked structural steel
    'hgHazard': ('PaintedMetal016', (1024, 512), 0.6),         # yellow-and-black hazard stripes
    'hgPlate': ('DiamondPlate008C', (1024, 512), 0.8),         # tread plate for the stands
    'hgRubber': ('Rubber004', (1024, 512), 0.5),               # the mats under the kit
    'hgWood': ('Wood089', (1024, 512), 0.5),                   # bench tops, boards
}

# The valley: name: (ambientCG id, target mean sRGB, saturation kept, hue pull, sizes)
TERRAIN = {
    # coarse old asphalt: rough at every distance (the fine grain of smoother sets filters away
    # a few metres out) and the same in every direction, so the terrain shader turns each tile
    # freely (a streaked set read as stretched). Chosen from eight rendered in the game.
    'asphalt': ('Asphalt006', (43, 43, 44), 0.6, 0.5, (2048, 1024)),
}


def fetch(aid):
    d = os.path.join(SRC, aid)
    if os.path.isdir(d) and os.listdir(d):
        return d
    os.makedirs(d, exist_ok=True)
    url = f'https://ambientcg.com/get?file={aid}_2K-JPG.zip'
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA)).read()
    zipfile.ZipFile(io.BytesIO(data)).extractall(d)
    print('fetched', aid)
    return d


def find(d, *keys):
    for f in sorted(os.listdir(d)):
        if any(f.endswith(f'_{k}.jpg') for k in keys):
            return Image.open(os.path.join(d, f))
    return None


def build(name):
    aid, sizes, ao_k = SETS[name]
    d = fetch(aid)
    col = find(d, 'Color').convert('RGB')
    ao = find(d, 'AmbientOcclusion')
    if ao is not None:
        ao = ao.convert('L').resize(col.size)
        # c * lerp(1, ao, k)
        ao = ao.point(lambda v: int(255 - (255 - v) * ao_k))
        col = ImageChops.multiply(col, Image.merge('RGB', (ao, ao, ao)))
    nor = find(d, 'NormalGL').convert('RGB')
    rough = find(d, 'Roughness').convert('L').resize(col.size)
    metal = find(d, 'Metalness')
    metal = metal.convert('L').resize(col.size) if metal is not None else Image.new('L', col.size, 0)
    rm = Image.merge('RGB', (Image.new('L', col.size, 255), rough, metal))
    for s in sizes:
        os.makedirs(os.path.join(OUT, str(s)), exist_ok=True)
        for suffix, img in (('c', col), ('n', nor), ('r', rm)):
            img.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, str(s), f'{name}_{suffix}.webp'), quality=84, method=6)
    print(f'{name:10} {aid}')
    return aid


def build_terrain(name):
    sys.path.insert(0, HERE)
    from build_textures import LIN, W, gain, lin_means  # the Poly Haven sets' colour matching
    from PIL import ImageEnhance
    aid, target, sat, hue, sizes = TERRAIN[name]
    d = fetch(aid)
    col = find(d, 'Color').convert('RGB')
    ao = find(d, 'AmbientOcclusion')
    if ao is not None:
        aol = ao.convert('L').resize(col.size).point(lambda v: int(255 * (0.55 + 0.45 * v / 255)))
        col = Image.merge('RGB', [ImageChops.multiply(ch, aol) for ch in col.split()])
    if sat < 1:
        col = ImageEnhance.Color(col).enhance(sat)
    tgt = [LIN[int(v)] for v in target]
    m = lin_means(col)
    g = [(tgt[c] / m[c]) ** hue for c in range(3)]
    m2 = [m[c] * g[c] for c in range(3)]
    k = sum(W[c] * tgt[c] for c in range(3)) / sum(W[c] * m2[c] for c in range(3))
    col = gain(col, [g[c] * k for c in range(3)])
    nor = find(d, 'NormalGL').convert('RGB')
    for s in sizes:
        os.makedirs(os.path.join(OUT, str(s)), exist_ok=True)
        col.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, str(s), f'{name}_c.webp'), quality=84, method=6)
        nor.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, str(s), f'{name}_n.webp'), quality=90, method=6)
    print(f'{name:10} {aid}  mean {[round(v) for v in col.resize((1, 1), Image.BOX).getpixel((0, 0))]}')
    # the shipped sets' record (texlib reads nothing from it; it is the list of sources)
    mp = os.path.join(OUT, 'textures.json')
    allm = json.load(open(mp)) if os.path.exists(mp) else {}
    allm[name] = {'id': aid, 'source': 'ambientCG', 'authors': ['ambientCG']}
    json.dump(allm, open(mp, 'w'), indent=1)
    return aid


def credits(built):
    p = os.path.join(OUT, 'CREDITS.md')
    s = open(p, encoding='utf8').read()
    start, end = '<!-- ambientcg -->', '<!-- /ambientcg -->'
    block = [start, '', '## From ambientCG', '',
             'The road and the dawn resupply hangar\'s surfaces are CC0 materials from [ambientCG](https://ambientcg.com),',
             'converted by `scripts/textures/build_ambientcg.py` (AO baked into the colour; the hangar\'s with roughness',
             'and metalness packed, the road\'s brightness matched to the valley like the Poly Haven sets).', '',
             '| Set | Source | License |', '|---|---|---|']
    for name, (aid, *_rest) in {**TERRAIN, **SETS}.items():
        block.append(f'| `{name}` | [{aid}](https://ambientcg.com/view?id={aid}) | CC0 1.0 |')
    block += ['', end]
    if start in s:
        s = s[:s.index(start)] + '\n'.join(block) + s[s.index(end) + len(end):]
    else:
        s = s.rstrip('\n') + '\n\n' + '\n'.join(block) + '\n'
    open(p, 'w', encoding='utf8').write(s)


if __name__ == '__main__':
    want = sys.argv[1:] or [*TERRAIN, *SETS]
    for n in want:
        if n in TERRAIN:
            build_terrain(n)
        else:
            build(n)
    credits(want)
