"""Last Bastion: turn a chosen key-art image into the loading screen's parallax layers.

    python scripts/art/layers.py <image.png> <name> [--near 0.62]

Writes app/art/<name>.webp (the whole picture, foreground painted out) and
app/art/<name>-near.webp (the foreground alone, with alpha), split by a depth
map from Depth Anything V2 Small (Apache-2.0). The two drift against each other
in CSS while the game loads.
Run with scripts/art/.cache/venv/Scripts/python.exe.
"""
import argparse
import os

import cv2
import numpy as np
import torch
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'app', 'art')
W, H = 1920, 1080


def depth_map(img):
    from transformers import pipeline
    pipe = pipeline('depth-estimation', model=os.path.join(HERE, '.cache', 'models', 'depth'),
                    device=0 if torch.cuda.is_available() else -1)
    d = np.asarray(pipe(img)['predicted_depth'].squeeze().cpu().numpy(), np.float32)
    d = cv2.resize(d, img.size, interpolation=cv2.INTER_CUBIC)
    return (d - d.min()) / (d.max() - d.min() + 1e-6)  # 1 = nearest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('image')
    ap.add_argument('name')
    ap.add_argument('--near', type=float, default=0.62, help='depth (0..1, 1 = nearest) where the foreground starts')
    ap.add_argument('--debug', action='store_true')
    a = ap.parse_args()
    img = Image.open(a.image).convert('RGB')
    # upscale to the screen first (Lanczos), so both layers share one geometry
    img = img.resize((W, round(img.height * W / img.width)), Image.LANCZOS)
    if img.height < H:
        img = img.resize((round(img.width * H / img.height), H), Image.LANCZOS)
    left, top = (img.width - W) // 2, (img.height - H) // 2
    img = img.crop((left, top, left + W, top + H))
    rgb = np.asarray(img)
    d = depth_map(img)
    # soft foreground matte: a short ramp around the threshold, then cleaned up
    m = np.clip((d - a.near) / 0.08, 0, 1)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    m = cv2.GaussianBlur(m, (0, 0), 2.2)
    # far layer: the foreground painted out (it is hidden behind the near layer except at its edges)
    hole = (cv2.dilate((m > 0.05).astype(np.uint8), np.ones((25, 25), np.uint8)) * 255)
    small = cv2.resize(rgb, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
    fill = cv2.inpaint(small, cv2.resize(hole, (W // 2, H // 2), interpolation=cv2.INTER_NEAREST), 9, cv2.INPAINT_TELEA)
    fill = cv2.resize(fill, (W, H), interpolation=cv2.INTER_CUBIC)
    k = (cv2.GaussianBlur(hole.astype(np.float32) / 255, (0, 0), 6))[..., None]
    far = (rgb * (1 - k) + fill * k).astype(np.uint8)
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray(far).save(os.path.join(OUT, a.name + '.webp'), quality=82, method=6)
    near = np.dstack([rgb, (m * 255).astype(np.uint8)])
    Image.fromarray(near, 'RGBA').save(os.path.join(OUT, a.name + '-near.webp'), quality=84, method=6)
    if a.debug:
        Image.fromarray((d * 255).astype(np.uint8)).save(os.path.join(HERE, '.cache', a.name + '-depth.png'))
        Image.fromarray((m * 255).astype(np.uint8)).save(os.path.join(HERE, '.cache', a.name + '-matte.png'))
    for f in (a.name + '.webp', a.name + '-near.webp'):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')


if __name__ == '__main__':
    main()
