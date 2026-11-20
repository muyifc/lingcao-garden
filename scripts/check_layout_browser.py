"""Exercise the real React client against isolated in-memory Host fixtures.

Requires Playwright and React 18 UMD files in ~/.cache/lingcao-browser-check.
Does not connect to the running DSH or change its saved garden.
"""
import json
import os
from pathlib import Path
import subprocess
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path.home() / '.cache' / 'lingcao-browser-check'
OUTPUT = Path(os.environ.get('GARDEN_PREVIEW_DIR', str(CACHE)))
OUTPUT.mkdir(parents=True, exist_ok=True)
fixture = subprocess.check_output(['node', '--input-type=module', '-e', """
import {defaultState,applyAction,stateView,buildArt} from './index.js';
const now=Date.now(),state=defaultState(now);
state.stones=1000;
applyAction(state,{action:'plant',plotId:'p1',cropId:'yuehua',focus:true},now-1_900_000);
applyAction(state,{action:'plant',plotId:'p2',cropId:'tingfeng',focus:true},now-200_000);
applyAction(state,{action:'plant',plotId:'p3',cropId:'chenlu',focus:true},now);
state.bag.herbs.juqi=3;state.bag.herbs.yuehua=2;
const full=JSON.parse(JSON.stringify(state));full.xp=9000;full.plots.forEach(p=>p.unlocked=true);
const sold=JSON.parse(JSON.stringify(state));applyAction(sold,{action:'sellAll'},now);
const harvested=JSON.parse(JSON.stringify(full));applyAction(harvested,{action:'harvestAll'},now);
const batch=JSON.parse(JSON.stringify(state));batch.plots[1].plantedAt=now-700_000;
const batchHarvested=JSON.parse(JSON.stringify(batch));applyAction(batchHarvested,{action:'harvestAll'},now);
const planted=JSON.parse(JSON.stringify(defaultState(now)));planted.xp=9000;planted.stones=100000;planted.plots.forEach(p=>p.unlocked=true);
const ids=['chenlu','juqi','yuehua','jingxin','ninglu','tingfeng','youming','lingzhi','chiyang','xuanshuang','yingxing','zhoutian'];
planted.plots.forEach((p,i)=>{if(p.unlocked)applyAction(planted,{action:'plant',plotId:p.id,cropId:ids[i%ids.length],focus:false},now-(i%6)*30_000)});
console.log(JSON.stringify({state:stateView(state,now),fresh:stateView(defaultState(now),now),sold:stateView(sold,now),full:stateView(full,now),planted:stateView(planted,now),harvested:stateView(harvested,now),batch:stateView(batch,now),batchHarvested:stateView(batchHarvested,now),art:buildArt()}));
"""], cwd=ROOT, text=True, encoding='utf-8')
fixture = json.loads(fixture)
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page(viewport={'width': 1100, 'height': 900}, device_scale_factor=1.5)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('http://garden.test/**', lambda route: route.fulfill(content_type='text/html', body='<div id="app"></div>'))
    page.goto('http://garden.test/')
    page.add_style_tag(content='''
    :root{--dsw-alias-label-primary:#e2ece5;--dsw-alias-label-secondary:#afc0b5;--dsw-alias-bg-overlay:#202c28;--dsw-alias-bg-layer-1:#293931;--dsw-alias-border-l1:#3c5145;--dsw-alias-border-l2:#526759;--dsw-alias-state-warn-primary:#dfbc62}
    body{margin:0;background:#18211e;font:13px/1.5 "Microsoft YaHei",sans-serif}
    ''')
    for script in ['react.js', 'react-dom.js']:
        page.add_script_tag(path=str(CACHE / script))
    page.evaluate('''fixture=>{
      window.fixture=fixture;window.calls=[];
      localStorage.setItem('dsh.lingcao-garden.ui.v2',JSON.stringify({mode:'open',left:40,top:24}));
      window.fetch=async(url,options)=>{
        if(url.endsWith('/art'))return {json:async()=>({ok:true,art:fixture.art})};
        if(url.endsWith('/act')){
          const payload=JSON.parse(options.body);window.calls.push(payload);
          if(payload.action==='sellAll')fixture.state=fixture.sold;
          if(payload.action==='harvestAll'||payload.action==='harvest')fixture.state=fixture.nextHarvest||fixture.harvested;
          if(payload.action==='reset')fixture.state=fixture.fresh;
          return {json:async()=>({ok:true,message:'模拟操作成功',state:fixture.state})};
        }
        return {json:async()=>({ok:true,state:fixture.state})};
      };
      window.__ModuleLoader__={load(config){window.plugin=config.factory(()=>React)}};
    }''', fixture)
    page.add_script_tag(path=str(ROOT / 'client.js'))
    page.evaluate('''()=>{
      plugin.apply({effect:fn=>fn(),get:()=>null,on:()=>()=>{},slots:{inject:(_name,fn)=>fn(),register:(options,component)=>{
        if(options.name==='shell.overlay')ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(component));
        if(options.name==='settings.section')window.Settings=component;
        return ()=>{};
      }}});
    }''')
    page.locator('.lcg-root.lcg-art').wait_for(state='attached')
    page.locator('.lcg-scene-sign').first.wait_for()
    assert page.locator('.lcg-entrance-art').count() == 3
    assert page.locator('.lcg-entrance-art').evaluate_all('images=>images.every(i=>i.complete&&i.naturalWidth>0)&&new Set(images.map(i=>i.src)).size===images.length')
    signs = page.locator('.lcg-scene-sign').all()
    assert [sign.get_attribute('data-entrance') for sign in signs] == ['shop', 'clock', 'basket']
    panel_center = page.locator('.lcg-panel').bounding_box()
    clock_box = signs[1].bounding_box()
    assert abs(clock_box['x'] + clock_box['width']/2 - (panel_center['x'] + panel_center['width']/2)) < 2, 'the clock entrance sits in the middle'
    def check_scene_positions():
        background = page.locator('.lcg-bgbtn').bounding_box()
        field = page.locator('.lcg-field').bounding_box()
        for sign in page.locator('.lcg-scene-sign').all():
            box = sign.bounding_box()
            assert background['y'] + background['height'] < box['y']
            assert field['y'] + field['height'] <= box['y'], 'scene entrance overlaps plots'
    def check_action_row():
        buttons = page.locator('.lcg-action-row > button').all()
        assert len(buttons) == 2
        boxes = [button.bounding_box() for button in buttons]
        assert max(box['y'] + box['height']/2 for box in boxes) - min(box['y'] + box['height']/2 for box in boxes) < 1, f'garden actions wrap: {boxes}'
        assert abs(boxes[0]['width'] - boxes[1]['width']) < 1, f'utility actions are uneven: {boxes}'
        assert page.locator('.lcg-action-row').evaluate('e=>e.scrollWidth<=e.clientWidth')
        metrics = page.locator('.lcg-action-row > button').evaluate_all('''els=>els.map(e=>{
          const s=getComputedStyle(e),r=e.getBoundingClientRect();
          return {h:r.height,padding:s.padding,fontSize:s.fontSize,gap:s.gap,icon:(e.querySelector("svg")||e.querySelector(".lcg-ico")).getBoundingClientRect().width}
        })''')
        assert all(abs(item['h'] - 30) < 0.5 for item in metrics), f'utility action heights differ: {metrics}'
        assert all(item['padding'] == '0px 8px' and item['fontSize'] == '11px' and item['gap'] == '4px' for item in metrics), f'utility action spacing differs: {metrics}'
        assert all(abs(item['icon'] - 13) < 0.5 for item in metrics), f'utility action icons differ: {metrics}'
    def check_seed_bar():
        assert page.locator('.lcg-seedrow .lcg-chest').count() == 1
        assert page.locator('.lcg-seedrow .lcg-focus-chip').count() == 1
        assert page.locator('.lcg-chest .lcg-focus-chip').count() == 0, 'the focus switch must not nest inside the chest button'
        assert page.locator('.lcg-chest button').count() == 0
        chip = page.locator('.lcg-focus-chip')
        assert chip.get_attribute('aria-checked') == 'true'
        assert chip.evaluate('e=>e.parentElement.classList.contains("lcg-seedrow")')
        bar = page.locator('.lcg-seedrow').evaluate('''e=>{const r=e.getBoundingClientRect(),c=e.querySelector(".lcg-chest").getBoundingClientRect(),f=e.querySelector(".lcg-focus-chip").getBoundingClientRect();return {h:r.height,scroll:e.scrollWidth,client:e.clientWidth,chipH:f.height,chestRight:c.right,chipLeft:f.left}}''')
        assert abs(bar['chipH'] - (bar['h'] - 2)) < 1, f'focus chip does not fill the seed bar: {bar}'
        assert bar['chipLeft'] >= bar['chestRight'] - 0.5, f'focus chip does not sit beside the chest: {bar}'
        assert bar['scroll'] <= bar['client'], f'the split seed bar overflows: {bar}'
        # The split chip toggles focus without opening the seed drawer behind it.
        chip.click()
        page.wait_for_function('document.querySelector(".lcg-focus-chip").getAttribute("aria-checked")==="false"')
        assert '普通种植' in chip.inner_text()
        assert page.locator('[data-garden-dialog]').count() == 0
        chip.click()
        page.wait_for_function('document.querySelector(".lcg-focus-chip").getAttribute("aria-checked")==="true"')
    check_action_row()
    check_seed_bar()
    check_scene_positions()
    assert page.locator('.lcg-seedbar').count() == 0
    for _ in range(5):
        page.get_by_role('button', name='换景', exact=False).click()
    page.locator('.lcg-toast').wait_for(state='detached')
    page.locator('.lcg-panel').screenshot(path=str(OUTPUT / 'garden-bonsai.png'))
    panel_box = page.locator('.lcg-panel').bounding_box()
    page.get_by_role('button', name='种匣', exact=True).click()
    assert page.locator('.lcg-seedopt').count() == 12
    assert page.locator('.lcg-panel .lcg-seedbar').count() == 0
    assert page.locator('.lcg-panel').bounding_box() == panel_box
    page.locator('[data-garden-dialog="seeds"]').screenshot(path=str(OUTPUT / 'garden-seeds-dialog.png'))
    assert page.get_by_role('button', name='返回', exact=True).evaluate('e=>e===document.activeElement')
    page.keyboard.press('Shift+Tab')
    assert page.locator('.lcg-seedopt').last.evaluate('e=>e===document.activeElement')
    page.keyboard.press('Tab')
    assert page.get_by_role('button', name='返回', exact=True).evaluate('e=>e===document.activeElement')
    page.locator('.lcg-seedopt').nth(1).click()
    assert page.locator('.lcg-seedbar').count() == 0
    page.get_by_role('button', name='灵植时盘', exact=True).click()
    page.locator('.lcg-clock').wait_for()
    page.get_by_role('button', name='下一株', exact=True).click()
    assert page.locator('[data-clock-plot="p2"]').count() == 1
    page.locator('.lcg-panel').screenshot(path=str(OUTPUT / 'garden-clock.png'))
    page.get_by_role('button', name='收为灵珠', exact=True).click()
    page.locator('.lcg-orb').click()
    assert page.locator('[data-clock-plot="p2"]').count() == 1
    page.locator('.lcg-clock-face').click()
    page.locator('.lcg-plotpop').wait_for()
    page.get_by_role('button', name='收起', exact=True).click()
    page.get_by_role('button', name='全园', exact=True).click()
    page.get_by_role('button', name='药篓', exact=True).click()
    assert page.locator('[class="lcg-shop"] [class="lcg-seed-name"]').count() == 0
    assert page.locator('.lcg-panel').bounding_box() == panel_box
    assert page.locator('[data-garden-dialog="bag"]').get_by_text('开垦', exact=True).count() == 0
    assert page.locator('[data-garden-dialog="bag"] .lcg-card').count() == 12
    page.locator('[data-garden-dialog="bag"]').screenshot(path=str(OUTPUT / 'garden-basket-dialog.png'))
    sell_all = page.get_by_role('button', name='一键卖出', exact=True)
    assert sell_all.is_enabled()
    assert '34' in sell_all.inner_text()
    sell_all.click()
    page.wait_for_function('document.querySelector("[aria-label=一键卖出]").disabled')
    assert page.evaluate('JSON.stringify(window.calls)') == '[{"action":"sellAll"}]'
    page.get_by_role('button', name='返回', exact=True).click()
    page.get_by_role('button', name='灵草铺', exact=True).click()
    assert page.locator('.lcg-seed-name').count() == 12
    assert page.locator('[data-garden-dialog="shop"] .lcg-card').count() == 12
    assert page.locator('[data-garden-dialog="shop"]').get_by_text('聚灵阵', exact=True).count() == 0
    assert page.locator('[data-garden-dialog="shop"]').get_by_text('开垦', exact=True).count() == 0
    assert page.locator('[data-garden-dialog="shop"]').get_by_role('button', name='卖', exact=False).count() == 0
    assert page.locator('.lcg-panel').bounding_box() == panel_box
    page.locator('[data-garden-dialog="shop"]').screenshot(path=str(OUTPUT / 'garden-shop-dialog.png'))
    head = page.locator('[data-garden-dialog="shop"] .lcg-dialog-head').bounding_box()
    page.locator('[data-garden-dialog="shop"] .lcg-dialog-body').evaluate('e=>e.scrollTop=e.scrollHeight')
    assert page.locator('[data-garden-dialog="shop"] .lcg-dialog-head').bounding_box() == head
    page.get_by_role('button', name='返回', exact=True).click()
    # Test the highest plot count at desktop and narrow widths after the normal poll.
    page.evaluate('()=>{fixture.state=fixture.full}')
    page.wait_for_function('document.querySelectorAll(".lcg-tile").length===24')
    for width in [1100, 360, 320]:
        page.set_viewport_size({'width': width, 'height': 900})
        page.wait_for_function('document.querySelector(".lcg-panel").getBoundingClientRect().right<=window.innerWidth')
        fits = page.locator('.lcg-field-wrap').evaluate('e=>{const f=e.querySelector(".lcg-field");return f.getBoundingClientRect().width<=e.clientWidth}')
        assert fits, f'field clipped at {width}px'
        check_scene_positions()
        check_seed_bar()
        check_action_row()
    page.locator('.lcg-panel').screenshot(path=str(OUTPUT / 'garden-full-narrow.png'))
    harvest_all = page.get_by_role('button', name='一键收成', exact=True)
    assert harvest_all.is_enabled()
    harvest_all.click()
    page.wait_for_function('document.querySelector("[aria-label=一键收成]").disabled')
    assert page.evaluate('window.calls.filter(c=>c.action==="harvestAll").length') == 1
    assert page.evaluate('fixture.state.plots.filter(p=>p.crop).length') == 2
    page.get_by_role('button', name='灵植时盘', exact=True).click()
    assert page.locator('.lcg-clock-nav').evaluate('e=>e.scrollWidth<=e.clientWidth')
    page.add_style_tag(content=':root{--dsw-alias-label-primary:#26362e;--dsw-alias-label-secondary:#586b5e;--dsw-alias-bg-overlay:#f3efe4;--dsw-alias-bg-layer-1:#e6e8dc;--dsw-alias-border-l1:#bdc8b8;--dsw-alias-border-l2:#9bac98}')
    page.locator('.lcg-panel').screenshot(path=str(OUTPUT / 'garden-clock-light.png'))
    page.get_by_role('button', name='全园', exact=True).click()
    for entry, kind in [('灵草铺', 'shop'), ('药篓', 'bag'), ('种匣', 'seeds')]:
        box = page.locator('.lcg-panel').bounding_box()
        page.get_by_role('button', name=entry, exact=True).click()
        dialog = page.locator(f'[data-garden-dialog="{kind}"]')
        assert dialog.evaluate('e=>e.getBoundingClientRect().left>=0&&e.getBoundingClientRect().right<=innerWidth&&e.scrollWidth<=e.clientWidth')
        assert page.locator('.lcg-panel').bounding_box() == box
        page.keyboard.press('Escape')
        assert page.locator('[data-garden-dialog]').count() == 0
    page.get_by_role('button', name='种匣', exact=True).click()
    page.locator('.lcg-modal').click(position={'x': 1, 'y': 1})
    assert page.locator('.lcg-seedbar').count() == 0
    assert page.evaluate('window.calls.map(c=>c.action)') == ['sellAll', 'harvestAll']
    page.set_viewport_size({'width': 1100, 'height': 900})
    page.evaluate('()=>{fixture.state=fixture.batch;fixture.nextHarvest=fixture.batchHarvested}')
    page.wait_for_function('document.querySelectorAll(".lcg-tile.is-ready").length===2')
    page.get_by_role('button', name='一键收成', exact=True).click()
    page.wait_for_function('document.querySelectorAll(".lcg-harvest-flight").length===2')
    assert page.locator('.lcg-harvest-effects').evaluate('e=>getComputedStyle(e).pointerEvents==="none"')
    assert page.locator('.lcg-harvest-flight img').count() == 2
    page.locator('.lcg-harvest-effects').evaluate('e=>{for(const a of e.getAnimations({subtree:true})){a.pause();a.currentTime=300}}')
    page.screenshot(path=str(OUTPUT / 'garden-harvest-flight.png'))
    page.locator('.lcg-harvest-effects').evaluate('e=>{for(const a of e.getAnimations({subtree:true}))a.play()}')
    page.locator('.lcg-harvest-effects').wait_for(state='detached')
    # A single mature plot uses the same success path.
    page.evaluate('()=>{fixture.state=fixture.full;fixture.nextHarvest=fixture.harvested}')
    page.wait_for_function('document.querySelectorAll(".lcg-tile.is-ready").length===1')
    page.locator('.lcg-tile.is-ready').click()
    page.locator('.lcg-harvest-flight').wait_for(state='attached')
    assert page.locator('.lcg-harvest-flight').count() == 1
    page.locator('.lcg-harvest-effects').wait_for(state='detached')
    # The clock also has a visible basket destination, including after its last crop.
    page.evaluate('()=>{fixture.state=fixture.full;fixture.nextHarvest=fixture.harvested}')
    page.wait_for_function('document.querySelectorAll(".lcg-tile.is-ready").length===1')
    page.get_by_role('button', name='灵植时盘', exact=True).click()
    while page.locator('[data-clock-plot="p1"]').count() == 0:
        page.get_by_role('button', name='下一株', exact=True).click()
    page.get_by_role('button', name='收获此株', exact=True).click()
    page.locator('.lcg-harvest-flight').wait_for(state='attached')
    assert page.locator('[data-entrance="basket"]').is_visible()
    page.locator('.lcg-harvest-effects').wait_for(state='detached')
    page.get_by_role('button', name='全园', exact=True).click()
    # Reduced motion still harvests, but skips the travelling sprite.
    page.emulate_media(reduced_motion='reduce')
    page.evaluate('()=>{fixture.state=fixture.batch;fixture.nextHarvest=fixture.batchHarvested}')
    page.wait_for_function('document.querySelectorAll(".lcg-tile.is-ready").length===2')
    page.get_by_role('button', name='一键收成', exact=True).click()
    page.wait_for_function('document.querySelector("[aria-label=一键收成]").disabled')
    assert page.locator('.lcg-harvest-effects').count() == 0
    # Settings are mounted separately, as in DSH. Reset updates the existing overlay immediately.
    page.evaluate('''()=>{
      const settings=document.createElement('div');settings.id='settings';
      Object.assign(settings.style,{position:'fixed',right:'16px',top:'16px',width:'340px',padding:'16px',background:'#293931',color:'#e2ece5'});
      document.body.append(settings);ReactDOM.createRoot(settings).render(React.createElement(Settings));
    }''')
    page.get_by_role('button', name='重置存档', exact=True).click()
    assert page.locator('#lcg-reset-warning').is_visible()
    page.get_by_role('button', name='取消', exact=True).click()
    assert page.locator('#lcg-reset-warning').count() == 0
    assert page.evaluate('window.calls.filter(c=>c.action==="reset").length') == 0
    page.get_by_role('button', name='重置存档', exact=True).click()
    page.locator('#settings').screenshot(path=str(OUTPUT / 'garden-reset-confirm.png'))
    # A delayed old poll must not overwrite the reset response.
    page.evaluate('''()=>{
      window.fetchBeforeReset=window.fetch;
      window.fetch=async(url,options)=>{
        if(url.endsWith('/state'))return await new Promise(resolve=>{window.oldPoll=()=>resolve({json:async()=>({ok:true,state:fixture.full})})});
        return fetchBeforeReset(url,options);
      };
    }''')
    page.wait_for_function('!!window.oldPoll')
    page.get_by_role('button', name='确认重置，重新游玩', exact=True).click()
    page.get_by_role('status').filter(has_text='存档已重置').wait_for()
    page.wait_for_function('document.querySelector(".lcg-stones").textContent.trim()==="120"')
    page.evaluate('()=>{oldPoll();window.fetch=fetchBeforeReset}')
    assert page.locator('.lcg-tile .lcg-crop:not(.lcg-ghost)').count() == 0
    assert page.locator('.lcg-tile:not(.is-locked)').count() == 4
    assert page.locator('.lcg-stones').inner_text().strip() == '120'
    assert page.evaluate('window.calls.filter(c=>c.action==="reset").length') == 1
    # Every plot planted: time tags must stay readable and not cover each other.
    page.set_viewport_size({'width': 1100, 'height': 900})
    page.evaluate('()=>{fixture.state=fixture.planted}')
    page.wait_for_function('document.querySelectorAll(".lcg-tile .lcg-crop:not(.lcg-ghost)").length===24')
    page.locator('.lcg-panel').screenshot(path=str(OUTPUT / 'garden-planted.png'))
    tag_metrics = page.locator('.lcg-tag').evaluate_all('''els=>{
      const rects=els.map(e=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height}});
      let overlaps=0;
      for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
        const a=rects[i],b=rects[j];
        if(a.l<b.r&&b.l<a.r&&a.t<b.b&&b.t<a.b)overlaps++;
      }
      return {count:rects.length,heights:[...new Set(rects.map(r=>Math.round(r.h*10)/10))],overlaps};
    }''')
    def check_tags(metrics):
        assert metrics['count'] == 24, f'all 24 tags expected: {metrics}'
        assert all(height <= 11.5 for height in metrics['heights']), f'time tags grew taller: {metrics}'
        assert metrics['overlaps'] == 0, f'time tags overlap: {metrics}'
    check_tags(tag_metrics)
    page.set_viewport_size({'width': 320, 'height': 900})
    page.wait_for_function('document.querySelector(".lcg-panel").getBoundingClientRect().right<=window.innerWidth')
    page.locator('.lcg-panel').screenshot(path=str(OUTPUT / 'garden-planted-narrow.png'))
    narrow_metrics = page.locator('.lcg-tag').evaluate_all('''els=>{
      const rects=els.map(e=>{const r=e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}});
      let overlaps=0;
      for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
        const a=rects[i],b=rects[j];
        if(a.l<b.r&&b.l<a.r&&a.t<b.b&&b.t<a.b)overlaps++;
      }
      return {count:rects.length,heights:[...new Set(els.map(e=>Math.round(e.getBoundingClientRect().height*10)/10))],overlaps};
    }''')
    check_tags(narrow_metrics)
    assert not errors, errors
    print('PASS: independent shop/basket/seed dialogs, unchanged panel bounds, fixed header, return/Escape/backdrop, keyboard focus loop, 12 seeds, backgrounds, clock, 24 plots and 320px; no page errors')
    print('Screenshots:', OUTPUT)
    browser.close()
