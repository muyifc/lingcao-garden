"""Key magenta-backed sprite sheets (docs/art-raw/*.png) into transparent webp assets/ and build docs/art-contact.png.

Run: python scripts/build_art.py   (needs numpy, scipy, Pillow)"""
import argparse
import json
import sys
import numpy as np
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'docs' / 'art-raw'
OUT = ROOT / 'assets'
OUT.mkdir(exist_ok=True)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--species', nargs='+', help='Only build the named crop sheets; preserve all other assets.')
parser.add_argument('--entrances', action='store_true', help='Only build the shop and basket entrance sprites.')
args = parser.parse_args()
if args.entrances and args.species:
    parser.error('Choose --entrances or --species, not both')


def key_magenta(img):
    """C = a*F + (1-a)*M  ->  recover alpha and foreground. Magenta-ness m = min(R,B)-G."""
    a = np.asarray(img.convert('RGB'), dtype=np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = np.minimum(r, b) - g
    alpha = np.clip(1.0 - m / 255.0, 0.0, 1.0)
    # Tolerate sensor-like noise in the flat background: near-pure magenta is fully clear.
    alpha = np.where(m > 235, 0.0, alpha)
    # No asset in this set is genuinely pink, so anything magenta-leaning is key-colour glow.
    alpha = np.where(m > 55, 0.0, alpha)
    # Wipe faint magenta halos (glows blended with the key colour); keep solid edges soft.
    t = np.clip((alpha - 0.22) / 0.55, 0.0, 1.0)
    alpha = t * t * (3 - 2 * t)
    # Decontaminate edges: remove the magenta share from partially transparent pixels.
    safe = np.maximum(alpha, 1e-3)[..., None]
    fg = (a - (1.0 - alpha)[..., None] * np.array([255.0, 0.0, 255.0])) / safe
    fg = np.clip(fg, 0, 255)
    # Residual spill: pull R/B down toward G where a pixel is still magenta-leaning.
    spill = np.clip(np.minimum(fg[..., 0], fg[..., 2]) - fg[..., 1], 0, None) * 0.85
    fg[..., 0] -= spill * (fg[..., 0] >= fg[..., 2])
    fg[..., 2] -= spill * (fg[..., 2] > fg[..., 0])
    # Edge extend: fringe pixels take the colour of the nearest solid pixel, so no key colour survives.
    from scipy import ndimage
    fm = np.minimum(fg[..., 0], fg[..., 2]) - fg[..., 1]
    solid = (alpha >= 0.98) & (fm < 12)  # solid AND not magenta-tinted
    solid = ndimage.binary_erosion(solid, iterations=3)  # outer rim re-takes colour from the interior
    if solid.any():
        idx = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
        near = fg[idx[0], idx[1]]
        fg = np.where(solid[..., None], fg, near)
    out = np.dstack([np.clip(fg, 0, 255), alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def trim(img, pad=2, thresh=10):
    from scipy import ndimage
    arr = np.array(img)
    al = arr[..., 3]
    labels, count = ndimage.label(al > 90)
    if count:
        sizes = ndimage.sum(np.ones_like(al), labels, range(1, count + 1))
        keep = [i + 1 for i, n in enumerate(sizes) if n >= 0.05 * max(sizes)]
        mask = np.isin(labels, keep)
        mask = ndimage.binary_dilation(mask, iterations=6)  # keep soft edges next to real bodies
        arr[..., 3] = np.where(mask, al, 0)
        img = Image.fromarray(arr, 'RGBA')
        al = arr[..., 3]
    ys, xs = np.where(al > thresh)
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(img.width, xs.max() + pad + 1), min(img.height, ys.max() + pad + 1))
    return img.crop(box)


def quadrants(img):
    w, h = img.size
    for i, (cx, cy) in enumerate([(0, 0), (1, 0), (0, 1), (1, 1)]):
        yield i, img.crop((cx * w // 2, cy * h // 2, (cx + 1) * w // 2, (cy + 1) * h // 2))


def fit(img, box_w, box_h):
    s = min(box_w / img.width, box_h / img.height)
    return img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)


def save(img, name, q=88):
    p = OUT / (name + '.webp')
    img.save(p, 'WEBP', quality=q, method=6)
    return p, p.stat().st_size


manifest_file = OUT / 'manifest.json'
manifest = json.loads(manifest_file.read_text(encoding='utf8')) if manifest_file.exists() else {}
sizes = {}


def sheet(file, names, box):
    keyed = key_magenta(Image.open(RAW / file))
    for (i, quad), name in zip(quadrants(keyed), names):
        im = fit(trim(quad), *box)
        p, n = save(im, name)
        manifest[name] = {'file': 'assets/' + p.name, 'w': im.width, 'h': im.height}
        sizes[name] = n


# Crops share one box so every stage keeps its true relative height.
def crop_sheet(file, species):
    source = Image.open(RAW / file)
    # Built-in generation provides real alpha; retain it rather than chroma-keying RGB.
    keyed = source.convert('RGBA') if source.mode == 'RGBA' and source.getextrema()[3][0] < 255 else key_magenta(source)
    quads = [trim(q) for _, q in quadrants(keyed)]
    # Same scale across the four stages (the ripe/tall stage defines it).
    scale = min(176 / max(q.width for q in quads), 200 / max(q.height for q in quads))
    for i, q in enumerate(quads):
        im = q.resize((max(1, round(q.width * scale)), max(1, round(q.height * scale))), Image.LANCZOS)
        name = f'crop-{species}-{i}'
        p, n = save(im, name, q=88 if species in ('juqi', 'yuehua') else 75)
        manifest[name] = {'file': 'assets/' + p.name, 'w': im.width, 'h': im.height}
        sizes[name] = n


plan_file = ROOT / 'docs' / 'focus-asset-plan.json'
plan = json.loads(plan_file.read_text(encoding='utf8'))
allowed = {entry['id'] for entry in plan['species']}
if args.species and any(species not in allowed for species in args.species):
    parser.error('Unknown species; see docs/focus-asset-plan.json')
for entry in ([] if args.entrances else plan['species']):
    species = entry['id']
    if args.species and species not in args.species:
        continue
    raw = RAW / f'crop-{species}.png'
    if not raw.exists():
        if args.species:
            raise FileNotFoundError(raw)
        print('pending', species)
        continue
    crop_sheet(raw.name, species)
if args.entrances:
    source = Image.open(RAW / 'garden-entrances.png')
    keyed = source.convert('RGBA') if source.mode == 'RGBA' and source.getextrema()[3][0] < 255 else key_magenta(source)
    split = round(keyed.width * 0.55)  # The generated sheet's clear vertical gutter.
    for (left, right), name in zip([(0, split), (split, keyed.width)], ['entrance-shop', 'entrance-basket']):
        im = fit(trim(keyed.crop((left, 0, right, keyed.height))), 192, 176)
        p, n = save(im, name, q=80)
        manifest[name] = {'file': 'assets/' + p.name, 'w': im.width, 'h': im.height}
        sizes[name] = n
if not args.species and not args.entrances:
    sheet('tiles.png', ['tile-soil', 'tile-fert', 'tile-locked', 'tile-ripe'], (256, 200))
    sheet('icons-a.png', ['icon-orb', 'icon-stone', 'icon-basket', 'icon-rain'], (128, 128))
    sheet('icons-b.png', ['icon-fertilizer', 'icon-ripen', 'icon-array', 'icon-journal'], (128, 128))

# Field backgrounds: every docs/art-raw/bg-<id>.png becomes assets/bg-<id>.webp (640 wide, aspect kept).
# The moon scene has an empty lower half, so only its top part is kept.
BG_CROP = {'bg-moon': (0, 0, 1536, 942)}
for raw in ([] if args.species or args.entrances else sorted(RAW.glob('bg-*.png'))):
    name = raw.stem
    bg = Image.open(raw).convert('RGB')
    if name in BG_CROP:
        bg = bg.crop(BG_CROP[name])
    w = 640
    bg = bg.resize((w, round(bg.height * w / bg.width)), Image.LANCZOS)
    p = OUT / (name + '.webp')
    bg.save(p, 'WEBP', quality=80, method=6)
    manifest[name] = {'file': 'assets/' + p.name, 'w': bg.width, 'h': bg.height}
    sizes[name] = p.stat().st_size

(OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf8')
if args.entrances:
    for name, size in sizes.items():
        print(name, manifest[name]['w'], manifest[name]['h'], size, 'bytes')
    sys.exit(0)
for entry in plan['species']:
    entry['status'] = 'ready' if all(
        f'crop-{entry["id"]}-{stage}' in manifest and (OUT / f'crop-{entry["id"]}-{stage}.webp').exists()
        for stage in range(4)
    ) else 'pending'
plan_file.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print('total KB', round(sum(sizes.values()) / 1024, 1))
for k, v in sizes.items():
    print(f'{k:20s} {v/1024:6.1f} KB  {manifest[k]["w"]}x{manifest[k]["h"]}')

# Contact sheet on a dark and a light checker so edge quality is visible on both.
names = [k for k in manifest if not k.startswith('bg-')]
cell = 220
cols = 6
rows = (len(names) + cols - 1) // cols
sheet_img = Image.new('RGB', (cols * cell, rows * cell * 2 // 1), (0, 0, 0))
for half, color in enumerate([(26, 36, 34), (244, 240, 228)]):
    for i, name in enumerate(names):
        im = Image.open(OUT / (name + '.webp')).convert('RGBA')
        tile = Image.new('RGBA', (cell, cell), color + (255,))
        im = fit(im, cell - 16, cell - 16)
        tile.alpha_composite(im, ((cell - im.width) // 2, (cell - im.height) // 2))
        sheet_img.paste(tile.convert('RGB'), ((i % cols) * cell, (half * rows + i // cols) * cell))
sheet_img.save(ROOT / 'docs' / 'art-contact.png')
print('contact sheet saved')
