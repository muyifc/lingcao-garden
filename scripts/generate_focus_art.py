"""Generate focus-crop sheets through the installed pptoken-image skill.

Run with the art venv Python: scripts/generate_focus_art.py chenlu
Receipts are saved before downloading so a CDN failure never requires another paid generation.
"""
import argparse
import concurrent.futures
import importlib.util
import json
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL = Path.home() / '.codex' / 'skills' / 'pptoken-image'
spec = importlib.util.spec_from_file_location('pptoken_image', SKILL / 'scripts' / 'generate_image.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


def generate(entry, plan):
    crop_id = entry['id']
    output = ROOT / 'docs' / 'art-raw' / f'crop-{crop_id}.png'
    if output.exists():
        print(f'{crop_id}: existing source preserved', flush=True)
        return
    prompts = ROOT / 'docs' / 'art-prompts' / 'focus'
    prompts.mkdir(parents=True, exist_ok=True)
    positions = ['Top left', 'Top right', 'Bottom left', 'Bottom right']
    stages = ' '.join(f'{position}: {stage}.' for position, stage in zip(positions, entry['stages']))
    prompt = '\n'.join([
        plan['style'], plan['layout'],
        'Production game asset sprite sheet, exactly FOUR isolated growth stages of ONE magical plant. ' + stages,
        'Every object sits on a perfectly flat solid pure magenta (#FF00FF) background. '
        'No gradient, no floor, no cast shadow outside the soil mound. No genuinely pink or magenta plant parts. '
        'Same soil mound size in all cells, young plants smaller than mature plants; upper-left and upper-right '
        'plants remain in the upper half. Wide empty gaps at the exact sheet midlines for cutting. '
        'All four objects entirely inside their own quadrant, never touching the image edges.',
    ])
    if crop_id == 'xuanshuang':
        prompt = (
            'Cute soft 3D clay toy flower game sprite sheet. Exactly four separate plants in a 2 by 2 grid. '
            'Top left: tiny pale blue sprout on a small brown soil mound. '
            'Top right: three rounded pale turquoise leaves on a small brown soil mound. '
            'Bottom left: a closed white lotus bud above rounded blue leaves on a small brown soil mound. '
            'Bottom right: an open white lotus flower with light blue petal tips and a small silver center, '
            'above rounded blue leaves on a small brown soil mound. '
            'Same front camera, same scale, chubby rounded shapes, soft studio lighting. '
            'Pure flat solid magenta #FF00FF background. Wide space between plants, each entirely inside its quadrant. '
            'No water, no pots, no text, no grid lines, no scenery, no watermark, no external shadow.'
        )
    (prompts / f'crop-{crop_id}.txt').write_text(prompt + '\n', encoding='utf8')
    receipts = ROOT / 'docs' / 'art-raw' / '.pptoken-receipts'
    receipts.mkdir(parents=True, exist_ok=True)
    receipt = receipts / f'crop-{crop_id}.json'
    if receipt.exists():
        result = json.loads(receipt.read_text(encoding='utf8'))
        print(f'{crop_id}: reusing generation receipt', flush=True)
    else:
        args = api.parse_args([prompt, '--output', str(output)])
        config = api.load_config(args.config)
        config['timeout_seconds'] = max(240, config.get('timeout_seconds', 180))
        payload = api.build_payload(config, args)
        if payload.get('n', 1) != 1:
            raise RuntimeError('Batch requires config n=1; refusing unintended multiple charges')
        print(f'{crop_id}: generating through pptoken-image', flush=True)
        result = api.call_api(config, payload)
        receipt.write_text(json.dumps(result), encoding='utf8')
    for attempt in range(12):
        try:
            api.save_images(result, output, 'png')
            print(f'{crop_id}: saved {output.stat().st_size} bytes', flush=True)
            return
        except SystemExit:
            if output.exists() or attempt == 11:
                raise RuntimeError(f'{crop_id}: download failed; receipt retained, do not regenerate') from None
            time.sleep(4)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('species', nargs='+')
    parser.add_argument('--workers', type=int, default=3, choices=[1, 2, 3])
    args = parser.parse_args()
    plan = json.loads((ROOT / 'docs' / 'focus-asset-plan.json').read_text(encoding='utf8'))
    entries = {entry['id']: entry for entry in plan['species']}
    if any(crop_id not in entries for crop_id in args.species):
        parser.error('Unknown species; see focus-asset-plan.json')
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(generate, entries[crop_id], plan): crop_id for crop_id in dict.fromkeys(args.species)}
        failed = []
        for future in concurrent.futures.as_completed(futures):
            crop_id = futures[future]
            try:
                future.result()
            except BaseException as error:
                failed.append(crop_id)
                # The skill's raw errors may contain result URLs or provider details; keep console output minimal.
                detail = str(error)
                status = re.search(r'HTTP (\d{3})', detail)
                reason = 'HTTP ' + status.group(1) if status else type(error).__name__
                if 'timed out' in detail.lower():
                    reason += ' (timeout)'
                print(f'{crop_id}: FAILED ({reason}); inspect local receipt before retry', flush=True)
    raise SystemExit(1 if failed else 0)
