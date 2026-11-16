#!/usr/bin/env python3
"""Builds the game's surface textures (app/textures/<size>/*.webp) from Poly Haven
CC0 scans downloaded into scripts/textures/source/polyhaven/<id>/ (2k maps:
diff, nor (OpenGL), rough, ao; fetched with fetch below).

Each set is brought into the game's look before it ships:
  - its mean brightness is matched to the procedural texture it replaces (the
    lighting, fog and material tints were all tuned against those), and its hue is
    pulled part of the way to that texture's palette
  - tinted surfaces (painted metal, canvas, bark) are partly desaturated so the
    material colour still decides what they are
  - ambient occlusion is baked into the colour (the materials have no aoMap)
  - roughness rides in the colour's alpha where the terrain shader reads it, or in a
    separate map (G roughness, B metalness) for the metal

  python3 scripts/textures/build_textures.py [fetch] [name ...]
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageChops, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source', 'polyhaven')
OUT = os.path.join(HERE, '..', '..', 'app', 'textures')

# name: poly haven id, target mean sRGB (the procedural texture's), saturation kept,
#       hue pull (0 keep the scan's, 1 the target's), sizes, extras
SETS = {
    'mud':      ('brown_mud_02',          (64, 58, 51),    1.0, 0.4, (2048, 1024, 512), {'alpha_rough': True}),
    'turf':     ('forest_leaves_02',      (97, 85, 50),    1.0, 0.3, (2048, 1024, 512), {}),
    'rock':     ('rock_face_03',          (67, 66, 61),    0.8, 0.5, (2048, 1024, 512), {}),
    'asphalt':  ('asphalt_02',            (43, 43, 44),    0.6, 0.5, (2048, 1024, 512), {}),
    'track':    ('rocky_trail',           (72, 63, 53),    0.9, 0.4, (1024, 512), {}),
    'plough':   ('aerial_mud_1',          (58, 50, 43),    0.9, 0.4, (1024, 512), {}),
    'concrete': ('concrete_wall_006',     (105, 105, 107), 0.5, 0.5, (2048, 1024, 512), {}),
    'slab':     ('dirty_concrete',        (112, 109, 106), 0.5, 0.5, (2048, 1024, 512), {}),
    'metal':    ('rusty_metal_02',        (83, 59, 44),    0.6, 0.5, (2048, 1024, 512), {'rough_map': True}),
    'corr':     ('rusty_corrugated_iron', (138, 124, 116), 0.35, 0.6, (1024, 512), {}),
    'plaster':  ('damaged_plaster',       (93, 82, 72),    0.8, 0.4, (1024, 512), {}),
    'bark':     ('pine_bark',             (38, 33, 29),    0.7, 0.5, (1024, 512), {'no_normal': True}),
    'planks':   ('raw_plank_wall',        (52, 44, 34),    0.8, 0.4, (1024, 512), {}),
    'burlap':   ('hessian_230',           (107, 97, 74),   0.6, 0.5, (1024, 512), {'no_normal': True}),
}


def fetch(ids):
    ua = ['-A', 'last-bastion-texture-fetch/1.0']
    for pid in ids:
        d = os.path.join(SRC, pid)
        os.makedirs(d, exist_ok=True)
        files = json.loads(subprocess.check_output(['curl', '-s', *ua, f'https://api.polyhaven.com/files/{pid}']))
        for key, short in {'Diffuse': 'diff', 'nor_gl': 'nor', 'Rough': 'rough', 'AO': 'ao'}.items():
            e = files.get(key, {}).get('2k', {})
            fmt = 'jpg' if 'jpg' in e else 'png'
            if fmt in e:
                subprocess.run(['curl', '-s', *ua, '-o', os.path.join(d, f'{short}.{fmt}'), e[fmt]['url']], check=True)
        subprocess.run(['curl', '-s', *ua, '-o', os.path.join(d, 'info.json'), f'https://api.polyhaven.com/info/{pid}'], check=True)


def load(d, short, mode):
    for ext in ('jpg', 'png'):
        p = os.path.join(d, f'{short}.{ext}')
        if os.path.exists(p):
            return Image.open(p).convert(mode)
    return None


def to_lin(v):
    c = v / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def to_srgb8(c):
    c = min(max(c, 0.0), 1.0)
    c = c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    return int(c * 255 + 0.5)


LIN = [to_lin(v) for v in range(256)]
W = (0.2126, 0.7152, 0.0722)


def lin_means(img):
    """Mean linear value of each channel, from the histogram."""
    h = img.histogram()
    out = []
    for ch in range(3):
        hh = h[ch * 256:(ch + 1) * 256]
        n = sum(hh)
        out.append(sum(c * LIN[v] for v, c in enumerate(hh)) / n)
    return out


def gain(img, g):
    """Multiply each channel by g[c] in linear light."""
    luts = []
    for ch in range(3):
        luts += [to_srgb8(LIN[v] * g[ch]) for v in range(256)]
    return img.point(luts)


def build(name):
    pid, target, sat, hue, sizes, ex = SETS[name]
    d = os.path.join(SRC, pid)
    img = load(d, 'diff', 'RGB')
    ao = load(d, 'ao', 'L')
    if ao is not None:
        # bake the occlusion in: a 0.55 .. 1 darkening (multiplying in sRGB is close enough)
        aol = ao.point(lambda v: int(255 * (0.55 + 0.45 * v / 255)))
        img = Image.merge('RGB', [ImageChops.multiply(ch, aol) for ch in img.split()])
    # keep part of the colour, the rest goes grey
    if sat < 1:
        img = ImageEnhance.Color(img).enhance(sat)
    # pull the hue towards the procedural texture's palette, then match its brightness
    tgt = [LIN[int(v)] for v in target]
    m = lin_means(img)
    g = [(tgt[c] / m[c]) ** hue for c in range(3)]
    m2 = [m[c] * g[c] for c in range(3)]
    k = sum(W[c] * tgt[c] for c in range(3)) / sum(W[c] * m2[c] for c in range(3))
    img = gain(img, [g[c] * k for c in range(3)])
    rough = load(d, 'rough', 'L')
    if ex.get('alpha_rough') and rough is not None:
        img.putalpha(rough)
    nor = None if ex.get('no_normal') else load(d, 'nor', 'RGB')
    rmap = None
    if ex.get('rough_map') and rough is not None:
        # three.js reads roughness from G, metalness from B: bare rust is matte and dull,
        # paint a little smoother and more metallic
        metal = rough.point(lambda v: int(max(0, (255 - v) * 0.6)))
        rmap = Image.merge('RGB', [Image.new('L', rough.size, 255), rough, metal])
    for s in sizes:
        od = os.path.join(OUT, str(s))
        os.makedirs(od, exist_ok=True)
        img.resize((s, s), Image.LANCZOS).save(os.path.join(od, f'{name}_c.webp'), quality=84, method=6)
        if nor is not None:
            nor.resize((s, s), Image.LANCZOS).save(os.path.join(od, f'{name}_n.webp'), quality=90, method=6)
        if rmap is not None:
            rmap.resize((s, s), Image.LANCZOS).save(os.path.join(od, f'{name}_r.webp'), quality=88, method=6)
    info = json.load(open(os.path.join(d, 'info.json')))
    dims = info.get('dimensions') or [0, 0]
    print(f'{name:9s} {pid:22s} {dims[0] / 1000:.2f} m  -> {sizes}  mean {[round(v) for v in img.convert("RGB").resize((1, 1), Image.BOX).getpixel((0, 0))]}')
    return {'id': pid, 'metres': round(dims[0] / 1000, 3), 'authors': list((info.get('authors') or {}).keys())}


if __name__ == '__main__':
    args = sys.argv[1:]
    names = [a for a in args if a in SETS] or list(SETS)
    if 'fetch' in args:
        fetch([SETS[n][0] for n in names])
    meta = {n: build(n) for n in names}
    mp = os.path.join(OUT, 'textures.json')
    allm = json.load(open(mp)) if os.path.exists(mp) else {}
    allm.update(meta)
    json.dump(allm, open(mp, 'w'), indent=1)
