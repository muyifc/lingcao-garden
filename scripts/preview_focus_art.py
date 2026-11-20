"""Validate exported sprites and build a labeled twelve-species art overview."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
plan = json.loads((ROOT / 'docs/focus-asset-plan.json').read_text(encoding='utf8'))
manifest = json.loads((ROOT / 'assets/manifest.json').read_text(encoding='utf8'))
font_path = Path('C:/Windows/Fonts/msyh.ttc')
font = ImageFont.truetype(str(font_path), 21) if font_path.exists() else ImageFont.load_default()
small = ImageFont.truetype(str(font_path), 15) if font_path.exists() else font
canvas = Image.new('RGB', (960, 920), '#182c29')
draw = ImageDraw.Draw(canvas)
draw.text((28, 16), '灵草药园 · 十二档专注灵植', font=font, fill='#f2e9ce')
for index, species in enumerate(plan['species']):
    x = (index % 4) * 240
    y = 58 + (index // 4) * 282
    draw.rounded_rectangle((x + 9, y, x + 231, y + 266), radius=18, fill='#26413a', outline='#46675b')
    for stage in range(4):
        entry = manifest[f'crop-{species["id"]}-{stage}']
        image = Image.open(ROOT / entry['file']).convert('RGBA')
        assert image.size == (entry['w'], entry['h'])
        assert image.width <= 176 and image.height <= 200
        alpha = image.getchannel('A')
        assert alpha.getextrema()[0] == 0 and alpha.getextrema()[1] == 255
        assert alpha.getbbox(), 'empty sprite'
        # Stage thumbnails retain their exported dimensions relative to one another.
        thumb = image.resize((max(1, round(image.width * .25)), max(1, round(image.height * .25))), Image.Resampling.LANCZOS)
        canvas.paste(thumb, (x + 24 + stage * 49 + (44 - thumb.width) // 2, y + 260 - thumb.height), thumb)
    mature = Image.open(ROOT / manifest[f'crop-{species["id"]}-3']['file']).convert('RGBA')
    mature.thumbnail((176, 160), Image.Resampling.LANCZOS)
    canvas.paste(mature, (x + (240 - mature.width) // 2, y + 202 - mature.height), mature)
    seconds = species['seconds']
    label = f'{seconds}秒' if seconds < 60 else f'{seconds // 60}分钟' if seconds < 3600 else f'{seconds // 3600}小时'
    draw.text((x + 24, y + 10), f'{label} · {species["name"]}', font=small, fill='#f2e9ce')
output = ROOT / 'docs/focus-plants-preview.png'
canvas.save(output)
print('Validated 48 RGBA sprites, dimensions and nonempty alpha; preview:', output)
