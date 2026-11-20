"""Generate one image via the pptoken-image skill config and download it with retries.

The result URL is not readable for a few seconds after generation (and rejects Python's default User-Agent),
so the stock skill script fails with HTTP 403 even though the image was generated.

Run: python scripts/gen_image.py "<prompt>" <out.png> [WxH]"""
import base64, json, sys, time, urllib.error, urllib.request
from pathlib import Path

SKILL = Path('C:/Users/Administrator/.codex/skills/pptoken-image')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'

prompt, out = sys.argv[1], Path(sys.argv[2])
cfg = json.loads((SKILL / 'config.json').read_text(encoding='utf8'))
body = {'model': cfg['model'], 'prompt': prompt, 'size': (sys.argv[3] if len(sys.argv) > 3 else cfg['size']), 'quality': cfg['quality'], 'n': 1}
req = urllib.request.Request(cfg['base_url'] + '/images/generations', data=json.dumps(body).encode(),
                             headers={'Authorization': 'Bearer ' + cfg['api_key'], 'Content-Type': 'application/json'})
with urllib.request.urlopen(req, timeout=240) as r:
    item = json.loads(r.read())['data'][0]

out.parent.mkdir(parents=True, exist_ok=True)
if item.get('b64_json'):
    out.write_bytes(base64.b64decode(item['b64_json']))
else:
    url = item['url']
    err = None
    for attempt in range(12):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=120) as r:
                out.write_bytes(r.read())
            break
        except urllib.error.HTTPError as e:
            err = e
            time.sleep(4)
    else:
        sys.exit(f'download failed after retries: {err} {url}')
print('saved', out, out.stat().st_size)
