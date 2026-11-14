"""Last Bastion: build the app icon from a generated painting.

    python scripts/art/generate.py realvis icons --seeds 6        # candidates -> .cache/out/icon/
    python scripts/art/icon.py sheet                              # contact sheet of the candidates
    python scripts/art/icon.py make icon_tower_13 --crop 0.5 0.46 0.86 [--small 0.5 0.4 0.6]

`make` writes build/icon.png (1024), app/icon.png (512) and build/icon.ico (16-256). The art
is cropped (centre x, centre y, size as fractions of the image), graded for contrast, and set
in a rounded tile with a bronze rim. The 16-32 px sizes can use a tighter crop (--small) so the
silhouette still reads in the taskbar. Run with scripts/art/.cache/venv/Scripts/python.exe.
"""
import argparse
import glob
import os

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(HERE, '.cache', 'out', 'icon')


def sheet():
    files = sorted(glob.glob(os.path.join(SRC, '*.png')))
    cols, t = 6, 300
    rows = (len(files) + cols - 1) // cols
    out = Image.new('RGB', (cols * t, rows * (t + 22)), (20, 20, 20))
    d = ImageDraw.Draw(out)
    for i, f in enumerate(files):
        x, y = (i % cols) * t, (i // cols) * (t + 22)
        out.paste(Image.open(f).convert('RGB').resize((t, t), Image.LANCZOS), (x, y))
        d.text((x + 4, y + t + 4), os.path.basename(f)[:-4], fill=(220, 220, 220))
    p = os.path.join(HERE, '.cache', 'icon_sheet.jpg')
    out.save(p, quality=88)
    print(p)


def crop(img, cx, cy, size):
    w, h = img.size
    s = size * min(w, h)
    x0, y0 = max(0, min(w - s, cx * w - s / 2)), max(0, min(h - s, cy * h - s / 2))
    return img.crop((round(x0), round(y0), round(x0 + s), round(y0 + s)))


def grade(img, small=False):
    img = ImageEnhance.Contrast(img).enhance(1.25 if small else 1.12)
    img = ImageEnhance.Color(img).enhance(1.1)
    return img


def rounded_mask(n, r):
    m = Image.new('L', (n * 4, n * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, n * 4 - 1, n * 4 - 1), radius=r * 4, fill=255)
    return m.resize((n, n), Image.LANCZOS)


def tile(art, n, small=False):
    """The art in a rounded tile: dark vignette, bronze rim, soft inner shadow."""
    r = round(n * 0.2)
    margin = round(n * 0.03)
    inner = n - 2 * margin
    art = grade(art.convert('RGB').resize((inner, inner), Image.LANCZOS), small)
    # vignette: pull the corners down so the tile edge and the fire centre carry the read
    v = Image.radial_gradient('L').resize((inner, inner), Image.LANCZOS)
    v = v.point(lambda p: 255 - int(min(255, max(0, (p - 90) * 1.6)) * 0.75))
    art = ImageChops.multiply(art, Image.merge('RGB', (v, v, v)))
    if small:
        art = art.filter(ImageFilter.UnsharpMask(radius=1.2, percent=140, threshold=1))
    out = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    # bronze rim: a filled rounded square under the art, lit from the top
    rim = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    grad = Image.linear_gradient('L').resize((n, n))
    top, bot = (176, 128, 70), (58, 38, 22)
    col = Image.merge('RGB', [grad.point(lambda p, a=a, b=b: int(a + (b - a) * p / 255)) for a, b in zip(top, bot)])
    rim.paste(col, (0, 0), rounded_mask(n, r))
    out.alpha_composite(rim)
    ir = max(1, r - margin)
    am = rounded_mask(inner, ir)
    a = Image.new('RGBA', (inner, inner))
    a.paste(art, (0, 0))
    a.putalpha(am)
    # inner shadow along the rim
    if n >= 48:
        sh = Image.new('L', (inner, inner), 0)
        ImageDraw.Draw(sh).rounded_rectangle((0, 0, inner - 1, inner - 1), radius=ir, outline=255, width=max(2, n // 40))
        sh = sh.filter(ImageFilter.GaussianBlur(n / 70))
        dark = Image.new('RGBA', (inner, inner), (0, 0, 0, 255))
        dark.putalpha(ImageChops.multiply(sh, am).point(lambda p: int(p * 0.7)))
        a.alpha_composite(dark)
    out.alpha_composite(a, (margin, margin))
    return out


def make(name, c, small_c):
    img = Image.open(os.path.join(SRC, name + '.png'))
    big_art = crop(img, *c)
    small_art = crop(img, *small_c) if small_c else big_art
    big = tile(big_art, 1024)
    big.save(os.path.join(ROOT, 'build', 'icon.png'))
    big.resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, 'app', 'icon.png'))
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [tile(small_art if s <= 32 else big_art, s * 4, small=s <= 32).resize((s, s), Image.LANCZOS) for s in sizes]
    frames[-1].save(os.path.join(ROOT, 'build', 'icon.ico'), sizes=[(s, s) for s in sizes], append_images=frames[:-1])
    # preview strip of every size, for checking the small ones
    strip = Image.new('RGBA', (sum(sizes) + 12 * len(sizes) + 12, 280), (32, 32, 36, 255))
    x = 12
    for s, f in zip(sizes, frames):
        strip.alpha_composite(f, (x, 140 - s // 2))
        x += s + 12
    p = os.path.join(HERE, '.cache', 'icon_sizes.png')
    strip.save(p)
    print('wrote build/icon.png, app/icon.png, build/icon.ico;', p)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['sheet', 'make'])
    ap.add_argument('name', nargs='?')
    ap.add_argument('--crop', type=float, nargs=3, default=[0.5, 0.5, 1.0])
    ap.add_argument('--small', type=float, nargs=3)
    a = ap.parse_args()
    if a.cmd == 'sheet':
        sheet()
    else:
        make(a.name, a.crop, a.small)
