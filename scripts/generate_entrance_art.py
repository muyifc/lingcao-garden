"""Generate the two garden entrances via the installed pptoken-image skill.

Keeps the generation receipt before download so retries never repeat a paid call.
"""
import importlib.util
import json
from pathlib import Path
import re
import time

ROOT = Path(__file__).resolve().parent.parent
SKILL = Path.home() / '.codex' / 'skills' / 'pptoken-image'
spec = importlib.util.spec_from_file_location('pptoken_image', SKILL / 'scripts' / 'generate_image.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


def main():
    output = ROOT / 'docs/art-raw/garden-entrances.png'
    if output.exists():
        print('Existing entrance source preserved:', output)
        return
    prompt = (ROOT / 'docs/art-prompts/garden-entrances.txt').read_text(encoding='utf-8')
    receipt = ROOT / 'docs/art-raw/.pptoken-receipts/garden-entrances.json'
    receipt.parent.mkdir(parents=True, exist_ok=True)
    if receipt.exists():
        result = json.loads(receipt.read_text(encoding='utf-8'))
        print('Reusing saved generation receipt', flush=True)
    else:
        args = api.parse_args([prompt, '--output', str(output)])
        config = api.load_config(args.config)
        config['timeout_seconds'] = max(240, config.get('timeout_seconds', 180))
        payload = api.build_payload(config, args)
        if payload.get('n', 1) != 1:
            raise RuntimeError('Expected one sprite sheet; refusing multiple generations')
        print('Generating entrance sheet via pptoken-image', flush=True)
        result = api.call_api(config, payload)
        receipt.write_text(json.dumps(result), encoding='utf-8')
    for attempt in range(12):
        try:
            api.save_images(result, output, 'png')
            print('Saved:', output, flush=True)
            return
        except SystemExit:
            if output.exists() or attempt == 11:
                raise RuntimeError('Download failed; receipt retained, do not regenerate') from None
            time.sleep(4)


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        status = re.search(r'HTTP (\d{3})', str(error))
        print('Entrance generation failed:', 'HTTP ' + status.group(1) if status else type(error).__name__)
        raise SystemExit(1)
