#!/usr/bin/env python3
"""Builds the hangar's surface textures (app/textures/<size>/hg*_{c,n,r}.webp) from
ambientCG CC0 materials (https://ambientcg.com), downloaded as 2K JPG zips into
scripts/textures/source/ambientcg/.

Each set ships like the Poly Haven ones (src/world/texlib.js):
  <name>_c  colour, ambient occlusion baked in (the materials have no aoMap)
  <name>_n  OpenGL normal map
  <name>_r  G roughness, B metalness (three.js reads them from those channels)
at 2048 (the floor and walls only), 1024 and 512 px.

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
    'hgFloor': ('Concrete031', (2048, 1024, 512), 0.8),        # poured slab with saw-cut joints
    'hgWall': ('CorrugatedSteel005', (2048, 1024, 512), 0.9),  # weathered corrugated cladding
    'hgSteel': ('Metal041B', (1024, 512), 0.7),                # rust-streaked structural steel
    'hgHazard': ('PaintedMetal016', (1024, 512), 0.6),         # yellow-and-black hazard stripes
    'hgPlate': ('DiamondPlate008C', (1024, 512), 0.8),         # tread plate for the stands
    'hgRubber': ('Rubber004', (1024, 512), 0.5),               # the mats under the kit
    'hgWood': ('Wood089', (1024, 512), 0.5),                   # bench tops, boards
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


def credits(built):
    p = os.path.join(OUT, 'CREDITS.md')
    s = open(p, encoding='utf8').read()
    start, end = '<!-- ambientcg -->', '<!-- /ambientcg -->'
    block = [start, '', '## The hangar (ambientCG)', '',
             'The dawn resupply hangar\'s surfaces are CC0 materials from [ambientCG](https://ambientcg.com),',
             'converted by `scripts/textures/build_ambientcg.py` (AO baked into the colour, roughness and metalness packed).', '',
             '| Set | Source | License |', '|---|---|---|']
    for name, (aid, *_rest) in SETS.items():
        block.append(f'| `{name}` | [{aid}](https://ambientcg.com/view?id={aid}) | CC0 1.0 |')
    block += ['', end]
    if start in s:
        s = s[:s.index(start)] + '\n'.join(block) + s[s.index(end) + len(end):]
    else:
        s = s.rstrip('\n') + '\n\n' + '\n'.join(block) + '\n'
    open(p, 'w', encoding='utf8').write(s)


if __name__ == '__main__':
    want = sys.argv[1:] or list(SETS)
    for n in want:
        build(n)
    credits(want)
