"""Last Bastion: loading-screen key art, generated locally.

Two engines can be compared side by side (both CreativeML Open RAIL++-M, both SDXL):
  sdxl     Stable Diffusion XL base 1.0
  realvis  RealVisXL V5.0, a photographic fine-tune of SDXL

    python scripts/art/download.py sdxl realvis                 # fetch the models once
    python scripts/art/generate.py realvis nest wall --seeds 4  # candidates -> .cache/out/<engine>/
Run with scripts/art/.cache/venv/Scripts/python.exe (torch + diffusers).
"""
import argparse
import os
import time

import torch

HERE = os.path.dirname(os.path.abspath(__file__))
M = os.path.join(HERE, '.cache', 'models')
OUT = os.path.join(HERE, '.cache', 'out')

# SDXL reads a prompt through two 77-token text encoders. Both get the subject first; the second
# also gets the look of the set. (With the look alone on the second, it drowned every subject.)
STYLE = 'cinematic war film still, night, burning fires, orange firelight and smoke, teal shadows, rain, film grain'

SHOTS = {
    # boot screen: the player's own view, the gun and the valley
    'nest': 'gunner seen from behind firing a heavy Browning M2 machine gun with spade grips on a tripod, ammunition belt, sandbags, on top of a concrete fortress wall, zombie horde in the valley below, red tracers, searchlights',
    'wall': 'huge grey concrete wall with orange street lamps on top, crowd of zombies piled against the base of the wall climbing up, razor wire, searchlights',
    'gunship': 'military four-engine propeller gunship airplane banking in the night sky, firing streams of red tracer bullets down at the burning ground, dark valley below',
    'drop': 'military cargo airplane at night dropping a crate on a parachute over a dark field, zombies in the field, flares',
    'giant': 'giant rotting human zombie, emaciated and grey, as tall as a building, walking toward a concrete fortress wall at night, searchlight beams on it, small zombies around its feet',
    'dawn': 'grey foggy dawn, concrete fortress wall with a lone soldier, muddy battlefield with bodies, smoke, crows',
}
NEG = 'burning city skyline, text, watermark, logo, signature, cartoon, anime, illustration, bright daylight, oversaturated, blurry, lowres, deformed'


def load(engine):
    from diffusers import StableDiffusionXLPipeline, AutoencoderKL, DPMSolverMultistepScheduler
    vae = AutoencoderKL.from_pretrained(os.path.join(M, 'sdxl-vae-fix'), torch_dtype=torch.float16)
    pipe = StableDiffusionXLPipeline.from_pretrained(os.path.join(M, engine), vae=vae, torch_dtype=torch.float16, variant='fp16')
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True)
    pipe.enable_model_cpu_offload()
    pipe.vae.enable_tiling()
    return pipe


def run(engine, shots, seeds, seed0):
    pipe = load(engine)
    os.makedirs(os.path.join(OUT, engine), exist_ok=True)
    for shot in shots:
        prompt = SHOTS[shot]
        for k in range(seeds):
            seed = seed0 + k
            path = os.path.join(OUT, engine, f'{shot}_{seed}.png')
            if os.path.exists(path):
                continue
            t0 = time.time()
            g = torch.Generator('cpu').manual_seed(seed)
            img = pipe(prompt, prompt_2=prompt + ', ' + STYLE, negative_prompt=NEG, width=1344, height=768, num_inference_steps=30,
                       guidance_scale=6.0 if engine == 'sdxl' else 4.5, generator=g).images[0]
            img.save(path)
            print(f'{engine} {shot} seed {seed}: {time.time() - t0:.1f} s', flush=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('engine', choices=['sdxl', 'realvis'])
    ap.add_argument('shots', nargs='*')
    ap.add_argument('--seeds', type=int, default=3)
    ap.add_argument('--seed', type=int, default=11)
    a = ap.parse_args()
    run(a.engine, a.shots or list(SHOTS), a.seeds, a.seed)
