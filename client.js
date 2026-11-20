/**
 * Browser half of the 灵草药园 bundle.
 *
 * One occupant of the frame-wide `shell.overlay` layer: a folded 灵珠 by
 * default, expanding into the garden panel. The layer is click-through, so
 * only the orb / panel opt back into pointer events. All garden state
 * lives in the Host half; this file renders a read model and posts intents.
 */

window.__ModuleLoader__.load({
  id: '@local/lingcao-garden',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Browser-local view state (mode + position); the garden itself is host-side. */
    const UI_KEY = 'dsh.lingcao-garden.ui.v2'
    const PANEL_WIDTH = 340
    const ORB_SIZE = 60
    /** Snapshot refresh cadence: brisk while the panel is open, relaxed for the orb. */
    const POLL_MS = 3000
    const ORB_POLL_MS = 10_000
    /** How long one "+N 灵石" float stays mounted; a hair longer than its 2.2s animation. */
    const FLOAT_MS = 2400
    /** At most this many floats stack at once, so a burst never buries the orb. */
    const FLOAT_MAX = 3
    /** 铲除 is two-step: this long after the first click, the button needs arming again. */
    const UPROOT_ARM_MS = 4000
    /** Plot popover width cap, mirrored by `.lcg-plotpop`'s `max-width`; the box hugs its buttons below this. */
    const PLOT_POP_W = 308
    const PLOT_POP_H = 96
    /** Monotonic id so two identical messages in a row still replay their float. */
    let toastSeq = 0
    /** State endpoint prefix. */
    const API = '/lingcao-garden'

    const ZH = {
      orbTitle: '灵草药园：点击展开',
      orbReady: '{n} 株可收',
      title: '灵草药园',
      sect: '云隐宗',
      stones: '灵石',
      realm: '境界',
      xp: '修为',
      collapse: '收为灵珠',
      emptyPlot: '空地',
      plant: '种下',
      locked: '未开垦',
      expand: '开垦',
      expandCost: '需 {n} 灵石',
      breakThrough: '需破境',
      harvest: '收',
      harvestAll: '一键收成',
      ready: '可收',
      growing: '生长中',
      shop: '灵草铺',
      shopEntry: '灵草铺',
      shopTitle: '灵草铺 · 买卖灵草',
      backToField: '← 回灵田',
      rain: '灵雨',
      rainWait: '灵雨 · {n}分',
      rainCost: '灵雨 {n}',
      fertilizer: '施肥 {n}',
      fertilized: '已施肥',
      ripen: '催熟 {n}',
      uproot: '铲除',
      uprootConfirm: '确认铲除',
      uprootHint: '铲掉这株，种子退回药篓；已长的时辰和灵肥不退。',
      closePlot: '收起',
      plotActions: '{name} · 还剩 {time}',
      settingsTitle: '灵草药园',
      settingsHint: '关掉后界面上不再出现灵珠；在这里可以随时唤回。',
      resetSave: '重置存档',
      resetHint: '清空灵石、修为、种子、药篓、田地和园志，重新开始。显示设置与背景保留。',
      resetWarning: '确认清空当前药园？此操作无法撤销，将恢复 120 灵石、两颗聚气草种子和四块田。',
      resetConfirm: '确认重置，重新游玩',
      resetCancel: '取消',
      resetBusy: '正在重置…',
      resetSuccess: '存档已重置，可以重新开始种植了。',
      resetFailed: '重置未完成，请检查连接后重试。',
      settingsShown: '显示中',
      settingsHidden: '已隐藏',
      sowing: '播种',
      seedChest: '种匣',
      shopSubtitle: '选购灵草种子，安排下一轮种植。',
      bagSubtitle: '查看收获的灵草，售出后换取灵石。',
      seedSubtitle: '按时长选择灵植；缺种时种植会按原价自动购入。',
      dialogBack: '返回',
      enterClock: '灵植时盘',
      overview: '全园',
      nextPlot: '下一株',
      prevPlot: '上一株',
      clockHarvest: '收获此株',
      clockEmpty: '小圃尚无灵植，回全园选种，开始一段专注。',
      clockDuration: '本株时长',
      gardenScene: '洞天盆景',
      focusMode: '专注种植',
      focusHint: '按所选时长自然成熟，不受灵雨和催熟影响；到时收获，错过也不损失。',
      focusGrowing: '专注中',
      ordinaryGrowing: '普通种植 · 可加速',
  ordinaryPlain: '普通种植',
      bgLabel: '背景',
      bgNext: '换景',
      bgNow: '背景：{name}',
      bgHint: '把 bg-名字.webp / png / jpg 放进数据目录的 backgrounds 文件夹，重载插件后会出现在这里。',
      bg_spring: '春日窗前',
      bg_rain: '雨夜窗前',
      bg_snow: '雪山晨光',
      bg_sea: '海边黄昏',
      bg_moon: '月夜云海',
      journalClose: '关闭',
      sealIdle: '药园',
      agoJust: '刚刚',
      agoMin: '{n} 分钟前',
      agoHour: '{n} 小时前',
      agoDay: '{n} 天前',
      gmTitle: 'GM · 测试工具',
      gmHint: '仅本机存档',
      gmRipen: '全部催熟',
      gmAdvance: '快进 30 分',
      gmStones: '灵石 +1000',
      gmStonesLabel: '灵石',
      gmXpLabel: '修为',
      gmPlotsLabel: '地块',
      gmMinutesLabel: '剩余(分)',
      gmNameLabel: '园名',
      gmApply: '应用修改',
      gmNothing: '先填一个字段再应用。',
      bag: '药篓',
      buy: '买',
      sell: '卖',
      sellAll: '一键卖出',
      hold: '持有',
      autoSeed: '{name}：缺种子时，点空地花 {n} 灵石自动购买并种植',
      noHerbs: '药篓里没有可卖的灵草。',
      nextStage: '距 {name} 还差 {n} 修为',
      maxRealm: '已到大圆满',
      journal: '园志',
      offline: '刷新后继续生长，关掉 DSH 也不停。',
      tokensLine: '吐纳 {t} 有效 token · 每 {r} token 得 1 灵石',
      close: '隐藏',
      selected: '已选种子：{name}',
      noSelection: '先点一种种子再下地。',
      notReady: '还没熟，{time} 后可以收。',
      failed: '操作失败',
      loading: '正在观气…',
      lockedCost: '待开垦',
    }

    const EN = {
      orbTitle: 'Herb garden: click to open',
      orbReady: '{n} ready',
      title: 'Herb Garden',
      sect: 'Cloudhermit Sect',
      stones: 'Stones',
      realm: 'Realm',
      xp: 'Cultivation',
      collapse: 'Fold to orb',
      emptyPlot: 'Empty',
      plant: 'Plant',
      locked: 'Unopened',
      expand: 'Open',
      expandCost: '{n} stones',
      breakThrough: 'Break through',
      harvest: 'Harvest',
      harvestAll: 'Harvest all',
      ready: 'Ready',
      growing: 'Growing',
      shop: 'Herb shop',
      shopEntry: 'Herb shop',
      shopTitle: 'Herb shop · buy and sell',
      backToField: '← Field',
      rain: 'Spirit rain',
      rainWait: 'Rain · {n}m',
      rainCost: 'Rain {n}',
      fertilizer: 'Fertilize {n}',
      fertilized: 'Fertilized',
      ripen: 'Ripen {n}',
      uproot: 'Remove',
      uprootConfirm: 'Confirm',
      uprootHint: 'Pull this herb up and get its seed back. Time spent and fertilizer are not refunded.',
      closePlot: 'Close',
      plotActions: '{name} · {time} left',
      settingsTitle: 'Herb garden',
      settingsHint: 'When off, no orb appears in the UI; turn it back on here at any time.',
      resetSave: 'Reset save',
      resetHint: 'Clear stones, cultivation, seeds, herbs, plots and journal. Display settings and background are kept.',
      resetWarning: 'Clear this garden permanently? Start again with 120 stones, two Qi Grass seeds and four plots. This cannot be undone.',
      resetConfirm: 'Confirm reset and start again',
      resetCancel: 'Cancel',
      resetBusy: 'Resetting…',
      resetSuccess: 'Save reset. Your new garden is ready.',
      resetFailed: 'Reset did not complete. Check your connection and try again.',
      settingsShown: 'Shown',
      settingsHidden: 'Hidden',
      sowing: 'Sow',
      seedChest: 'Seed chest',
      shopSubtitle: 'Choose herb seeds for your next planting.',
      bagSubtitle: 'View harvested herbs and sell them for spirit stones.',
      seedSubtitle: 'Choose a duration. Missing seeds are bought at planting time.',
      dialogBack: 'Back',
      enterClock: 'Plant clock',
      overview: 'Garden',
      nextPlot: 'Next plant',
      prevPlot: 'Previous plant',
      clockHarvest: 'Harvest plant',
      clockEmpty: 'No plants yet. Return to the garden to plant a focus interval.',
      clockDuration: 'Plant duration',
      gardenScene: 'Pocket garden',
      focusMode: 'Focus planting',
      focusHint: 'Keeps the chosen duration; rain and ripening cannot shorten it. Harvest whenever you return.',
      focusGrowing: 'Focusing',
      ordinaryGrowing: 'Ordinary planting · acceleration allowed',
  ordinaryPlain: 'Ordinary',
      bgLabel: 'Backdrop',
      bgNext: 'Next view',
      bgNow: 'Backdrop: {name}',
      bgHint: 'Drop bg-name.webp / png / jpg into the backgrounds folder of the data directory, then reload the plugin.',
      bg_spring: 'Spring window',
      bg_rain: 'Rainy night window',
      bg_snow: 'Snowy dawn',
      bg_sea: 'Seaside sunset',
      bg_moon: 'Moonlit clouds',
      journalClose: 'Close',
      sealIdle: 'Garden',
      agoJust: 'just now',
      agoMin: '{n} min ago',
      agoHour: '{n} h ago',
      agoDay: '{n} d ago',
      gmTitle: 'GM · test tools',
      gmHint: 'Local save only',
      gmRipen: 'Ripen all',
      gmAdvance: 'Skip 30m',
      gmStones: 'Stones +1000',
      gmStonesLabel: 'Stones',
      gmXpLabel: 'Cultivation',
      gmPlotsLabel: 'Plots',
      gmMinutesLabel: 'Left (min)',
      gmNameLabel: 'Name',
      gmApply: 'Apply',
      gmNothing: 'Fill one field first.',
      bag: 'Herb basket',
      buy: 'Buy',
      sell: 'Sell',
      sellAll: 'Sell all',
      hold: 'Held',
      autoSeed: '{name}: when out of seeds, click an empty plot to buy and plant for {n} stones',
      noHerbs: 'Nothing to sell in the basket.',
      nextStage: '{n} cultivation to {name}',
      maxRealm: 'Peak reached',
      journal: 'Garden log',
      offline: 'Grows on real time, even with DSH closed.',
      tokensLine: '{t} effective tokens · 1 stone per {r}',
      close: 'Hide',
      selected: 'Seed: {name}',
      noSelection: 'Pick a seed before planting.',
      notReady: 'Not ripe yet — {time} to go.',
      failed: 'Action failed',
      loading: 'Reading the air…',
      lockedCost: 'To open',
    }

const RIDGE = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 340 70' preserveAspectRatio='none'><path d='M0 70V42l34-18 26 14 44-30 52 36 36-14 46 26 52-30 50 32V70z' fill='rgba(150,200,190,.16)'/><path d='M0 70V54l48-20 36 18 54-22 60 24 44-16 98 22V70z' fill='rgba(70,120,105,.42)'/></svg>\")"
    const HEAD_RIDGE = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 340 64' preserveAspectRatio='none'><path d='M0 64V46l40-22 30 18 50-30 60 34 40-16 50 24 70-26v38z' fill='rgba(94,157,138,.13)'/></svg>\")"
    const DIAMOND = 'polygon(50% 0,100% 50%,50% 100%,0 50%)'

    const CSS = [
      '.lcg-root{position:fixed;pointer-events:none;z-index:20;color:var(--dsw-alias-label-primary);--lcg-gold:var(--dsw-alias-state-warn-primary,#c9a227);--lcg-jade:#5e9d8a;--lcg-serif:"STKaiti","KaiTi","楷体","Songti SC","Noto Serif SC",serif}',
      '.lcg-panel{pointer-events:auto;position:fixed;box-sizing:border-box;width:340px;display:flex;flex-direction:column;gap:12px;padding:0 14px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:radial-gradient(120% 90px at 50% 0,rgba(94,157,138,.16),rgba(94,157,138,0)),var(--dsw-alias-bg-overlay);box-shadow:0 18px 44px rgba(0,0,0,.28),0 0 0 1px rgba(255,255,255,.05) inset;font:inherit;font-size:12px;line-height:18px;max-height:min(80vh,700px);overflow:auto}',
      // Header: seal + name + purse, over a faint ridge line.
      '.lcg-head{display:flex;align-items:center;gap:10px;margin:0 -14px;padding:12px 14px 6px;cursor:grab;touch-action:none;user-select:none;border-radius:16px 16px 0 0;background:' + HEAD_RIDGE + ' center bottom/100% 100% no-repeat}',
      '.lcg-head:active{cursor:grabbing}',
      '.lcg-seal{flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;height:36px;border-radius:7px;background:linear-gradient(145deg,#cc574c,#95302a);color:#fdeee8;font-family:var(--lcg-serif);font-size:13px;line-height:15px;font-weight:700;writing-mode:vertical-rl;letter-spacing:1px;box-shadow:0 2px 6px rgba(149,48,42,.45),inset 0 0 0 2px rgba(255,255,255,.2);transform:rotate(-4deg)}',
      '.lcg-title{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}',
      '.lcg-title strong{font-family:var(--lcg-serif);font-size:18px;line-height:22px;font-weight:700;letter-spacing:.1em}',
      '.lcg-sub{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.lcg-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid var(--dsw-alias-border-l1);border-radius:50%;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;cursor:pointer}',
      '.lcg-iconbtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
      '.lcg-stones{position:relative;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border:1px solid rgba(201,162,39,.5);border-radius:999px;background:linear-gradient(180deg,rgba(201,162,39,.16),rgba(201,162,39,.05));font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
      '.lcg-gem{width:8px;height:8px;border-radius:2px;transform:rotate(45deg);background:linear-gradient(135deg,#dafff1,#5fb8a2 55%,#2f7d73);box-shadow:0 0 0 1px rgba(0,0,0,.14)}',
      // Cultivation bar.
      '.lcg-xp{display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.lcg-xp-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}',
      '.lcg-xp-head b{font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.lcg-bar{position:relative;height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 1px 2px rgba(0,0,0,.2);overflow:hidden}',
      '.lcg-bar>i{position:absolute;inset:0 auto 0 0;min-width:8px;border-radius:999px;background:linear-gradient(90deg,#4a8f7a,#a4d8a6);box-shadow:0 0 8px rgba(120,200,150,.5);transition:width .6s ease}',
      '.lcg-bar>i::after{content:"";position:absolute;left:3px;right:3px;top:1px;height:2px;border-radius:2px;background:rgba(255,255,255,.4)}',
      '.lcg-bar::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 24%,rgba(0,0,0,.16) 24% 25%)}',
      // Field: a self-contained night-ink scene, readable in any host theme.
      '.lcg-field-wrap{position:relative;display:flex;justify-content:center;padding:36px 0 18px;border-radius:14px;overflow:hidden;background:linear-gradient(180deg,#15232a 0%,#21393b 46%,#2c4636 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),inset 0 -26px 40px rgba(6,14,8,.38)}',
      '.lcg-field-wrap::before{content:"";position:absolute;left:0;right:0;top:0;height:92px;pointer-events:none;background:' + RIDGE + ' bottom/100% 64px no-repeat,radial-gradient(circle at 84% 26px,#f6f2d9 0,#f6f2d9 8px,rgba(246,242,217,.28) 9px,rgba(246,242,217,0) 28px)}',
      '.lcg-field-wrap::after{content:"";position:absolute;left:0;right:0;bottom:0;height:44px;pointer-events:none;background:linear-gradient(0deg,rgba(214,236,226,.14),rgba(214,236,226,0))}',
      '.lcg-field-wrap.has-bg{background-size:cover;background-position:center bottom;background-repeat:no-repeat;background-color:#21393b}',
      '.lcg-field-wrap.has-bg::before,.lcg-field-wrap.has-bg::after{display:none}',
      '.lcg-bgbtn{position:absolute;right:8px;top:8px;z-index:7;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid rgba(255,255,255,.35);border-radius:50%;background:rgba(10,18,16,.5);color:#fff;cursor:pointer;transition:background .15s}',
      '.lcg-bgbtn:hover{background:rgba(10,18,16,.72)}',
      '.lcg-bgbtn svg{width:15px;height:15px}',
      '.lcg-bgpick{display:flex;flex-direction:column;gap:2px;margin-top:10px;font-size:12px}',
      '.lcg-bgs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
      '.lcg-field{position:relative;z-index:1}',
      '.lcg-mote{position:absolute;z-index:2;width:3px;height:3px;border-radius:50%;background:#e2f7dc;box-shadow:0 0 6px 2px rgba(190,240,200,.6);opacity:0;pointer-events:none}',
      // Tiles: a 2:1 diamond slab with thickness; only the slab itself takes clicks.
      '.lcg-tile{position:absolute;display:block;padding:0;border:none;background:transparent;pointer-events:none;overflow:visible;cursor:pointer;outline:none}',
      '.lcg-hit{position:absolute;inset:0;pointer-events:auto;cursor:pointer;clip-path:polygon(50% 0,100% calc(var(--h)/2),100% calc(var(--h)/2 + var(--t)),50% 100%,0 calc(var(--h)/2 + var(--t)),0 calc(var(--h)/2))}',
      '.lcg-tile:hover .lcg-hit{filter:brightness(1.14)}',
      '.lcg-tile .lcg-side,.lcg-tile .lcg-rim,.lcg-tile .lcg-soil{position:absolute;left:0;right:0;height:var(--h);clip-path:' + DIAMOND + '}',
      '.lcg-tile .lcg-side{top:var(--t);background:linear-gradient(90deg,#54402a 50%,#3c2d1d 50%)}',
      '.lcg-tile .lcg-rim{top:0;background:linear-gradient(135deg,#a4c985,#5d8553)}',
      '.lcg-tile .lcg-soil{top:0;clip-path:polygon(50% 3px,calc(100% - 6px) 50%,50% calc(100% - 3px),6px 50%);background:repeating-linear-gradient(26.57deg,rgba(0,0,0,.16) 0 2px,rgba(0,0,0,0) 2px 7px),linear-gradient(160deg,#7a5e3f,#4e3b27)}',
      '.lcg-tile.is-fert .lcg-soil{background:radial-gradient(circle at 30% 40%,rgba(160,240,190,.5) 0 1.5px,transparent 2px),radial-gradient(circle at 68% 58%,rgba(160,240,190,.5) 0 1.5px,transparent 2px),repeating-linear-gradient(26.57deg,rgba(0,0,0,.16) 0 2px,rgba(0,0,0,0) 2px 7px),linear-gradient(160deg,#5d6b44,#3b4a30)}',
      '.lcg-tile.is-ready .lcg-rim{background:linear-gradient(135deg,#ffe68c,#d3a52a)}',
      '.lcg-tile.is-focus .lcg-rim,.lcg-tile:focus-visible .lcg-rim{background:linear-gradient(135deg,#fff,#cfe9ff)}',
      '.lcg-tile.is-locked .lcg-side{background:linear-gradient(90deg,#262a26 50%,#1c201c 50%)}',
      '.lcg-tile.is-locked .lcg-rim{background:linear-gradient(135deg,rgba(210,220,210,.35),rgba(150,165,150,.2))}',
      '.lcg-tile.is-locked .lcg-soil{background:repeating-linear-gradient(26.57deg,rgba(255,255,255,.05) 0 2px,rgba(0,0,0,0) 2px 7px),linear-gradient(160deg,#323832,#232823)}',
      '.lcg-glow{position:absolute;left:-12%;width:124%;top:calc(var(--h)*-.35);height:calc(var(--h)*1.7);pointer-events:none;background:radial-gradient(ellipse at 50% 55%,rgba(255,226,120,.5),rgba(255,226,120,0) 62%)}',
      '.lcg-crop{position:absolute;left:50%;top:calc(var(--h)/2 + 3px);width:calc(var(--w)*.44);transform:translate(-50%,-100%);pointer-events:none;filter:drop-shadow(0 2px 2px rgba(0,0,0,.4))}',
      '.lcg-crop.is-ready{filter:drop-shadow(0 0 5px rgba(255,230,140,.95))}',
      '.lcg-ghost{opacity:0;transition:opacity .15s}',
      '.lcg-tile:hover .lcg-ghost{opacity:.5}',
      '.lcg-cropsvg{display:block;width:100%;height:auto;overflow:visible}',
      // Sprite variants: fixed height boxes use contain so tall herbs never stretch.
      '.lcg-cropimg{user-select:none;pointer-events:none}',
      '.lcg-card-ico .lcg-cropimg{width:auto;max-width:100%;height:100%;object-fit:contain}',
      '.lcg-seedopt .lcg-cropimg{width:auto;height:21px}',
      '.lcg-art .lcg-crop{width:auto}',
      '.lcg-ico{display:block;flex:none;width:19px;height:19px;object-fit:contain;pointer-events:none;user-select:none}',
      '.lcg-journal-entry .lcg-ico{width:21px;height:21px}',
      '.lcg-card-ico>.lcg-ico{width:100%;height:100%}',
      '.lcg-slab{position:absolute;inset:0;pointer-events:none}',
      '.lcg-tileimg{position:absolute;left:0;top:0;width:100%;height:auto;display:block;pointer-events:none;user-select:none;filter:drop-shadow(0 3px 3px rgba(0,0,0,.28))}',
      '.lcg-art .lcg-tile:hover .lcg-tileimg{filter:brightness(1.08) drop-shadow(0 3px 3px rgba(0,0,0,.28))}',
      '.lcg-art .lcg-tile.is-focus .lcg-tileimg{filter:brightness(1.12) drop-shadow(0 0 5px #fff)}',
      '.lcg-art .lcg-lock svg{display:none}',
      '.lcg-art .lcg-lock{top:calc(var(--h)*.74)}',
      '.lcg-orb.has-art{border-color:transparent;background:none;box-shadow:none}',
      '.lcg-orb.has-art:hover{box-shadow:none}',
      '.lcg-orbimg{width:60px;height:auto;display:block;pointer-events:none;user-select:none;filter:drop-shadow(0 6px 7px rgba(0,0,0,.34))}',
      '.lcg-tag{position:absolute;z-index:5;transform:translateX(-50%);padding:0 5px;border-radius:999px;font-size:9px;line-height:11px;white-space:nowrap;color:#eef5ea;background:linear-gradient(90deg,rgba(104,186,138,.8) var(--p,0%),rgba(8,14,10,.66) var(--p,0%));box-shadow:0 0 0 1px rgba(255,255,255,.14);font-variant-numeric:tabular-nums;pointer-events:none}',
      '.lcg-tag.is-ready{background:linear-gradient(180deg,#ffe58a,#d6a62b);color:#3b2b05;font-weight:700;box-shadow:0 0 0 1px rgba(255,255,255,.35),0 2px 6px rgba(0,0,0,.35)}',
      '.lcg-plus{position:absolute;left:50%;top:calc(var(--h)/2);width:18px;height:18px;margin:-9px 0 0 -9px;display:flex;align-items:center;justify-content:center;border:1.5px dashed rgba(255,255,255,.5);border-radius:50%;color:rgba(255,255,255,.8);pointer-events:none;transition:opacity .15s}',
      '.lcg-plus svg{width:10px;height:10px}',
      '.lcg-tile:hover .lcg-plus{opacity:0}',
      '.lcg-lock{position:absolute;left:50%;top:calc(var(--h)/2 - 7px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px;color:rgba(235,240,232,.75);pointer-events:none}',
      '.lcg-lock svg{width:12px;height:12px}',
      '.lcg-lock>span{display:inline-flex;align-items:center;gap:4px;padding:0 6px;border-radius:999px;font-size:9px;line-height:13px;background:rgba(0,0,0,.45);font-variant-numeric:tabular-nums}',
      '.lcg-lock .lcg-gem{width:6px;height:6px}',
      '.lcg-card-ico>svg:not(.lcg-cropsvg){width:20px;height:20px;align-self:center;color:var(--lcg-jade)}',
      // Shop cards.
      '.lcg-shop{display:flex;flex-direction:column;gap:8px}',
      '.lcg-rowhead,.lcg-section{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.lcg-section{justify-content:flex-start;font-family:var(--lcg-serif);font-size:13px;letter-spacing:.12em;color:var(--dsw-alias-label-primary)}',
      '.lcg-section::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--dsw-alias-border-l2),transparent)}',
      '.lcg-card,.lcg-shop-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
      '.lcg-card.is-on{border-color:rgba(94,157,138,.8);box-shadow:0 0 0 1px rgba(94,157,138,.35) inset,0 4px 14px rgba(94,157,138,.14)}',
      '.lcg-card-main{display:flex;align-items:center;gap:10px;min-width:0;flex:1}',
      '.lcg-card-ico{flex:none;display:flex;align-items:flex-end;justify-content:center;width:40px;height:40px;padding:3px 6px 2px;box-sizing:border-box;border-radius:10px;background:radial-gradient(circle at 50% 85%,rgba(94,157,138,.32),rgba(94,157,138,.06))}',
      '.lcg-card-ico .lcg-cropsvg{width:100%}',
      '.lcg-shop-name{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.lcg-shop-name strong{font-size:13px;font-weight:600;font-family:var(--lcg-serif);letter-spacing:.05em}',
      '.lcg-shop-meta{font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.lcg-tier{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;font-family:inherit;font-size:10px;line-height:15px;letter-spacing:0;background:rgba(150,150,140,.2);color:var(--dsw-alias-label-secondary)}',
      '.lcg-tier[data-tier="灵"]{background:rgba(94,157,138,.22);color:var(--lcg-jade)}',
      '.lcg-tier[data-tier="宝"]{background:rgba(201,162,39,.22);color:var(--lcg-gold)}',
      '.lcg-seed-name{display:flex;align-items:center;gap:10px;min-width:0;flex:1;border:none;background:transparent;color:inherit;font:inherit;padding:0;text-align:left;cursor:pointer}',
      '.lcg-seed-name.is-on .lcg-shop-name strong{color:var(--lcg-jade)}',
      '.lcg-seed-name:hover strong{text-decoration:underline}',
      '.lcg-cost{display:inline-flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums}',
      '.lcg-cost .lcg-gem{width:6px;height:6px}',
      '.lcg-plot-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.lcg-plotbar{display:flex;flex-direction:column;gap:8px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
      '.lcg-plotbar-head{display:flex;align-items:center;gap:8px;font-size:11px}',
      '.lcg-plotbar-head .lcg-card-ico{width:28px;height:28px;padding:2px 4px 1px;border-radius:8px}',
      '.lcg-plotbar-head .lcg-bar{flex:1;min-width:48px;height:5px}',
      '.lcg-plotbar-label{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // A plot's actions float over the garden, just under the tile that was clicked: fixed layer, never in flow.
      // The box hugs its buttons (no dead space after 关闭) and only caps at PLOT_POP_W for long作物名.
      '.lcg-plotpop{position:fixed;z-index:20;box-sizing:border-box;width:max-content;max-width:min(308px,calc(100vw - 16px));pointer-events:auto;transform:translateX(-50%);box-shadow:0 16px 34px rgba(0,0,0,.34)}',
      '.lcg-plotpop.is-above{transform:translate(-50%,-100%)}',
      // Compact buttons keep 灵肥/催熟/铲除/关闭 on a single row.
      '.lcg-plotpop .lcg-plot-actions{gap:4px;flex-wrap:nowrap}',
      '.lcg-plotpop .lcg-btn{gap:3px;padding:4px 7px;white-space:nowrap}',
      '.lcg-plotpop .lcg-btn svg{width:12px;height:12px}',
      // Twelve seeds in two columns fill the bar exactly; the panel itself scrolls, so the grid is not clamped.
      '.lcg-seedbar{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:2px}',
      '.lcg-plant-controls{display:flex;flex-direction:column;gap:6px}',
      // 种匣 and 专注 are one split bar: two sibling buttons, never a button inside a button.
      '.lcg-seedrow{display:flex;align-items:stretch;border:1px solid var(--dsw-alias-border-l2);border-radius:12px 12px 18px 18px;background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 -3px 0 rgba(94,157,138,.12);overflow:hidden}',
      '.lcg-focus-chip{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:0 10px;border:0;border-left:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:16px;white-space:nowrap;cursor:pointer}',
      '.lcg-focus-chip svg{width:13px;height:13px;flex:none}',
      '.lcg-focus-chip:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.lcg-focus-chip.is-on{background:linear-gradient(180deg,rgba(94,157,138,.3),rgba(94,157,138,.12));color:var(--dsw-alias-label-primary)}',
      '.lcg-focus-chip.is-on svg{color:var(--lcg-jade)}',
      '.lcg-action-row{display:flex;align-items:center;gap:6px}',
      '.lcg-seedopt{display:inline-flex;align-items:center;gap:5px;padding:3px 9px 3px 5px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;cursor:pointer;transition:background .15s,border-color .15s}',
      '.lcg-seedopt .lcg-cropsvg{width:15px}',
      '.lcg-seedopt i{font-style:normal;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}',
      '.lcg-seedopt:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.lcg-seedopt.is-on{border-color:rgba(94,157,138,.85);background:linear-gradient(180deg,rgba(94,157,138,.26),rgba(94,157,138,.1));box-shadow:0 0 0 1px rgba(94,157,138,.3) inset}',
      '.lcg-seedopt.is-empty:not(.is-on){opacity:.6}',
      '.lcg-gm-form{display:flex;flex-wrap:wrap;gap:6px}',
      '.lcg-gm-field{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.lcg-input{width:62px;padding:2px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px}',
      '.lcg-input:focus{outline:none;border-color:#6f9f8a}',
      '.lcg-settings{padding:2px 0;font-size:12px}',
      '.lcg-settings-row{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.lcg-reset{margin-top:16px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;align-items:flex-start;gap:8px}.lcg-reset p{margin:0}.lcg-reset-actions{display:flex;gap:8px;flex-wrap:wrap}',
      '.lcg-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.lcg-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:16px;cursor:pointer;transition:background .15s,border-color .15s}',
      '.lcg-btn svg{width:13px;height:13px;flex:none}',
      '.lcg-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.lcg-btn.is-primary{border-color:rgba(94,157,138,.75);background:linear-gradient(180deg,rgba(94,157,138,.26),rgba(94,157,138,.1))}',
      '.lcg-btn.is-primary:hover{background:rgba(94,157,138,.3)}',
      '.lcg-btn.is-danger{border-color:rgba(208,110,100,.8);background:linear-gradient(180deg,rgba(208,110,100,.24),rgba(208,110,100,.1))}',
      '.lcg-btn.is-danger:hover{background:rgba(208,110,100,.32)}',
      '.lcg-btn[disabled]{opacity:.5;cursor:not-allowed}',
      // Journal: one quiet entry on the first screen; the content lives in a modal.
      '.lcg-journal-entry{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;text-align:left;transition:background .15s,color .15s}',
      '.lcg-journal-entry svg{width:14px;height:14px;flex:none}',
      '.lcg-journal-entry span{flex:1;font-family:var(--lcg-serif);letter-spacing:.1em}',
      '.lcg-journal-entry:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.lcg-modal{position:fixed;inset:0;z-index:30;pointer-events:auto;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(8,14,12,.46)}',
      '.lcg-dialog{box-sizing:border-box;width:min(360px,100%);max-height:min(72vh,560px);display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:radial-gradient(120% 90px at 50% 0,rgba(94,157,138,.16),rgba(94,157,138,0)),var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 22px 56px rgba(0,0,0,.4);font:inherit;font-size:12px;line-height:18px}',
      '.lcg-dialog-head{display:flex;align-items:center;gap:8px}',
      '.lcg-dialog-heading{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}.lcg-dialog-title{margin:0;font:18px/24px var(--lcg-serif)}.lcg-dialog-subtitle{margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px}.lcg-dialog-back{flex:none;align-self:flex-start}.lcg-dialog-head{flex-shrink:0}.lcg-dialog-body{overscroll-behavior:contain}',
      '.lcg-dialog-body{display:flex;flex-direction:column;gap:10px;overflow:auto;min-height:0}',
      '.lcg-iconbtn svg{width:12px;height:12px}',
      '.lcg-quote{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid rgba(94,157,138,.25);border-radius:10px;background:rgba(94,157,138,.1);font-family:var(--lcg-serif);font-size:13px;line-height:19px}',
      '.lcg-avatar{flex:none;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#c4efde,#4f8f86);box-shadow:0 0 0 2px rgba(94,157,138,.22)}',
      '.lcg-avatar svg{width:12px;height:12px;color:#fff}',
      '.lcg-stat{display:inline-flex;align-items:center;gap:5px;font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.lcg-stat svg{width:11px;height:11px}',
      '.lcg-log{display:flex;flex-direction:column;margin:0;padding:0;list-style:none;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.lcg-log li{position:relative;display:flex;align-items:baseline;gap:8px;padding:3px 0 3px 15px}',
      '.lcg-log li::before{content:"";position:absolute;left:3px;top:10px;width:5px;height:5px;border-radius:50%;background:var(--lcg-jade)}',
      '.lcg-log li::after{content:"";position:absolute;left:5px;top:16px;bottom:-6px;width:1px;background:var(--dsw-alias-border-l2)}',
      '.lcg-log li:last-child::after{display:none}',
      '.lcg-log li:first-child{color:var(--dsw-alias-label-primary)}',
      '.lcg-log time{margin-left:auto;font-size:10px;white-space:nowrap;opacity:.8}',
      // Messages float over the field (upper-middle), rise, linger, then fade. They never take layout space.
      '.lcg-toast{position:absolute;left:170px;top:150px;z-index:40;width:max-content;max-width:296px;box-sizing:border-box;margin:0;padding:5px 14px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(12,20,18,.84);color:#eef5ea;font-size:12px;line-height:18px;text-align:center;pointer-events:none;transform:translateX(-50%);box-shadow:0 6px 18px rgba(0,0,0,.35)}',
      '.lcg-toast.is-error{border-color:rgba(255,160,150,.45);background:rgba(138,36,30,.9);color:#fff1ee}',
      '.lcg-hint{margin:0;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.lcg-panel{gap:9px;border-radius:24px 24px 30px 30px;background:radial-gradient(ellipse at 50% 25%,rgba(94,157,138,.13),transparent 65%),var(--dsw-alias-bg-overlay)}',
      '.lcg-head{padding-top:12px}.lcg-xp{opacity:.85}.lcg-xp-head{font-size:10px}.lcg-xp .lcg-bar{height:3px}',
      '.lcg-field-wrap{padding:76px 0 92px;border-radius:48px 48px 22px 22px;min-height:126px;box-shadow:inset 0 -24px 32px rgba(6,14,8,.3),0 7px 0 -3px rgba(94,157,138,.2)}',
      '.lcg-field-wrap .lcg-bgbtn{top:16px;bottom:auto;right:18px}',
      '.lcg-scene-gates{position:absolute;bottom:6px;left:12px;right:12px;z-index:6;display:flex;align-items:flex-end;justify-content:space-between;gap:6px;color:#f0ecd7}',
      '.lcg-scene-sign{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:0;box-sizing:border-box;width:74px;min-height:68px;padding:0 2px 2px;border:0;border-radius:16px;background:transparent;color:#f0ecd7;font:inherit;font-family:var(--lcg-serif);cursor:pointer}',
      '.lcg-scene-sign>.lcg-entrance-art{width:56.7px;height:44.1px;object-fit:contain;pointer-events:none;filter:drop-shadow(0 3px 2px #38261255)}.lcg-entrance-label{min-width:47px;padding:1px 8px;border:1px solid #e0c78b99;border-radius:6px;background:#283d30ed;box-shadow:0 2px 3px #271b1644;font-size:10.8px;line-height:16.2px;white-space:nowrap}.lcg-scene-sign:hover{background:#fff3c221}.lcg-scene-sign:focus-visible{outline:2px solid #f2d892;outline-offset:2px}',
      '.lcg-scene-sign svg,.lcg-scene-sign>.lcg-ico{width:36.9px;height:36.9px;object-fit:contain}.lcg-scene-name{position:absolute;top:24px;left:54px;right:54px;text-align:center;color:#f0ecd7;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:15px var(--lcg-serif);letter-spacing:.14em;text-shadow:0 1px 5px #000}',
      // Two wide utility actions under the seed bar: 灵雨 / 一键收成.
      '.lcg-action-row>.lcg-btn{flex:1;min-width:0;box-sizing:border-box;height:30px;padding:0 8px;justify-content:center;gap:4px;font-size:11px;line-height:16px;white-space:nowrap}.lcg-action-row>.lcg-btn svg{width:13px;height:13px;flex:none}.lcg-action-row .lcg-cost{gap:3px;line-height:1}.lcg-action-row .lcg-cost .lcg-gem,.lcg-art .lcg-action-row .lcg-cost .lcg-gem{width:8px;height:8px}',
      '.lcg-chest{display:flex;align-items:center;gap:10px;width:100%;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px 12px 18px 18px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;text-align:left;cursor:pointer;box-shadow:inset 0 -3px 0 rgba(94,157,138,.12)}',
      '.lcg-chest>.lcg-cropsvg{width:35px;height:42px;object-fit:contain}.lcg-chest>span:nth-child(2){flex:1;display:flex;flex-direction:column}.lcg-chest strong{font:14px var(--lcg-serif)}.lcg-chest small{font-size:10px;color:var(--dsw-alias-label-secondary)}',
      '.lcg-seedrow .lcg-chest{flex:1;min-width:0;width:auto;border:0;border-radius:0;background:transparent;box-shadow:none;padding:6px 10px 6px 12px}',
      '.lcg-seedrow .lcg-chest:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.lcg-seedrow .lcg-chest>span:nth-child(2){min-width:0}',
      '.lcg-seedrow .lcg-chest strong,.lcg-seedrow .lcg-chest small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.lcg-panel[data-layout="clock"]{border-radius:32px}.lcg-clock{display:flex;flex-direction:column;align-items:center;gap:10px;padding:6px 0}.lcg-clock-plant{display:flex;flex-direction:column;align-items:center;gap:8px;width:100%}',
      '.lcg-clock-face{width:168px;height:168px;padding:7px;border:none;border-radius:50%;background:conic-gradient(var(--lcg-jade) var(--clock-progress),rgba(94,157,138,.15) 0);cursor:pointer;flex-shrink:0}',
      '.lcg-clock-sprite{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:var(--dsw-alias-bg-overlay);box-shadow:inset 0 0 34px rgba(94,157,138,.14)}.lcg-clock-sprite .lcg-cropsvg{width:100px;height:130px;object-fit:contain}',
      '.lcg-clock-time{font:30px/1.2 var(--lcg-serif);font-variant-numeric:tabular-nums;letter-spacing:.05em}.lcg-clock-caption{font-size:11px;color:var(--dsw-alias-label-secondary);text-align:center}.lcg-clock-nav{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}.lcg-clock-nav>.lcg-btn{font-size:11px;padding:5px 8px}',
      '.lcg-clock-summary{border:none;background:none;color:var(--lcg-jade);font:inherit;cursor:pointer}.lcg-clock-empty{display:flex;flex-direction:column;align-items:center;padding:24px;text-align:center;color:var(--dsw-alias-label-secondary)}.lcg-clock-empty>.lcg-cropsvg{width:100px;height:110px;object-fit:contain}',
      '@media(max-width:355px){.lcg-panel{width:calc(100vw - 16px);padding-left:10px;padding-right:10px}.lcg-clock-face{width:160px;height:160px}.lcg-title{min-width:0}.lcg-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}',
      // Orb: a jade bead with an orbiting ring.
      '.lcg-orb{pointer-events:auto;position:fixed;width:58px;height:58px;border-radius:50%;border:1px solid rgba(255,255,255,.4);background:radial-gradient(circle at 34% 26%,#cdf1e2 0,#7cc2aa 36%,#34766d 76%,#214c4a 100%);color:#fff;display:flex;align-items:center;justify-content:center;cursor:grab;box-shadow:0 0 0 4px rgba(94,157,138,.2),0 10px 24px rgba(0,0,0,.32),inset 0 -8px 14px rgba(0,0,0,.28),inset 0 5px 9px rgba(255,255,255,.38);touch-action:none;user-select:none}',
      '.lcg-orb:hover{box-shadow:0 0 0 5px rgba(94,157,138,.34),0 10px 26px rgba(0,0,0,.36),inset 0 -8px 14px rgba(0,0,0,.28),inset 0 5px 9px rgba(255,255,255,.4)}',
      '.lcg-orb:active{cursor:grabbing}',
      '.lcg-orb::before{content:"";position:absolute;inset:-7px;border-radius:50%;border:1px dashed rgba(160,220,200,.5);pointer-events:none}',
      '.lcg-orb .lcg-cropsvg{width:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}',
      '.lcg-orb-badge{position:absolute;right:-8px;bottom:-5px;min-width:26px;padding:1px 6px;border-radius:999px;border:1px solid rgba(201,162,39,.55);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:10px;line-height:14px;font-weight:600;font-variant-numeric:tabular-nums;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.25)}',
      '.lcg-orb-ready{position:absolute;right:-6px;top:-5px;min-width:16px;padding:1px 4px;border-radius:999px;background:#d3a52a;color:#2f2203;font-size:10px;line-height:14px;font-weight:700;font-variant-numeric:tabular-nums;text-align:center;box-shadow:0 0 0 2px var(--dsw-alias-bg-overlay)}',
      '@media (prefers-reduced-motion:no-preference){.lcg-orb-ready{animation:lcg-pulse 2.4s ease-in-out infinite}.lcg-orb::before{animation:lcg-spin 24s linear infinite}.lcg-tile{transition:transform .15s}.lcg-tile:hover{transform:translateY(-2px)}.lcg-glow{animation:lcg-glow 2.2s ease-in-out infinite}.lcg-crop.is-ready{animation:lcg-bob 1.8s ease-in-out infinite}.lcg-mote{animation:lcg-mote 6s ease-in-out infinite}}',
      '@keyframes lcg-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}',
      '@keyframes lcg-spin{to{transform:rotate(360deg)}}',
      '@keyframes lcg-glow{0%,100%{opacity:.55}50%{opacity:1}}',
      '@keyframes lcg-bob{0%,100%{transform:translate(-50%,-100%)}50%{transform:translate(-50%,calc(-100% - 3px))}}',
      '@keyframes lcg-mote{0%{opacity:0;transform:translate(0,0)}25%{opacity:.85}100%{opacity:0;transform:translate(10px,-34px)}}',
      // 灵石入账 +N: spirit qi settles into the garden, so the float drifts down and fades.
      '.lcg-float{position:absolute;z-index:3;pointer-events:none;font-size:12px;font-weight:700;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--dsw-alias-state-warn-primary,#c9a227);text-shadow:0 0 6px var(--dsw-alias-bg-overlay),0 0 2px var(--dsw-alias-bg-overlay)}',
      '.lcg-float-orb{left:29px;top:-24px;transform:translateX(-50%)}',
      '.lcg-float-panel{right:6px;top:100%}',
      '@media (prefers-reduced-motion:no-preference){.lcg-float{animation:lcg-drop 2.2s ease-out forwards}.lcg-gem.is-gain{animation:lcg-gem .9s ease-out}.lcg-toast{animation:lcg-toast-rise 2.5s ease-out forwards}}',
      '@keyframes lcg-toast-rise{0%{opacity:0;translate:0 12px}12%{opacity:1;translate:0 0}72%{opacity:1;translate:0 -14px}100%{opacity:0;translate:0 -26px}}',
      '@keyframes lcg-drop{0%{opacity:0;translate:0 -10px}15%{opacity:1}70%{opacity:1}100%{opacity:0;translate:0 14px}}',
      '@keyframes lcg-gem{0%{box-shadow:0 0 0 0 rgba(201,162,39,.7)}100%{box-shadow:0 0 0 8px rgba(201,162,39,0)}}',
      '.lcg-harvest-effects{pointer-events:none;position:fixed;inset:0;z-index:25}.lcg-harvest-flight{position:fixed;width:48px;height:56px;pointer-events:none;opacity:0;filter:drop-shadow(0 0 6px #ffe294);animation:lcg-harvest-fly 640ms cubic-bezier(.25,.6,.35,1) var(--delay) both}.lcg-harvest-flight .lcg-cropsvg{width:100%;height:100%;object-fit:contain}.lcg-harvest-arrival{position:fixed;width:42px;height:42px;border:2px solid #f7dc83;border-radius:50%;box-shadow:0 0 14px #ffe294;opacity:0;animation:lcg-harvest-arrive 280ms ease-out calc(var(--delay) + 600ms) both}',
      '@keyframes lcg-harvest-fly{0%{opacity:1;transform:translate(-50%,-50%) scale(1)}40%{opacity:1;transform:translate(calc(-50% + var(--dx) * .35),calc(-50% + var(--dy) * .35 - 48px)) scale(1.08) rotate(-12deg)}85%{opacity:1}100%{opacity:0;transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(.25) rotate(10deg)}}',
      '@keyframes lcg-harvest-arrive{0%{opacity:0;transform:translate(-50%,-50%) scale(.7)}30%{opacity:.9}100%{opacity:0;transform:translate(-50%,-50%) scale(1.4)}}',
      '@media(prefers-reduced-motion:reduce){.lcg-harvest-flight{display:none}.lcg-harvest-arrival{animation:none}}',
    ].join('')

    /** Read the persisted browser view state, with sane bounds. */
    function loadUi() {
      const fallback = {
        mode: 'orb',
        left: Math.max(12, (window.innerWidth || 1200) - ORB_SIZE - 24),
        top: Math.max(12, (window.innerHeight || 800) - 420 - 90),
      }
      try {
        const raw = JSON.parse(window.localStorage.getItem(UI_KEY) || 'null')
        if (raw && (raw.mode === 'orb' || raw.mode === 'open')) {
          const mode = raw.mode
          const size = mode === 'open' ? { w: PANEL_WIDTH, h: 460 } : { w: ORB_SIZE, h: ORB_SIZE }
          const pos = clampPos(
            Number.isFinite(raw.left) ? raw.left : fallback.left,
            Number.isFinite(raw.top) ? raw.top : fallback.top,
            size.w,
            size.h,
          )
          return { mode, ...pos, ...(raw.layout === 'clock' ? { layout: 'clock' } : {}) }
        }
      } catch {
        // Corrupt local state: start folded.
      }
      return fallback
    }

    /** Persist the browser view state. */
    function saveUi(ui) {
      try {
        window.localStorage.setItem(UI_KEY, JSON.stringify(ui))
      } catch {
        // Private mode or a full quota keeps the garden usable for this page.
      }
    }

    /** Clamp a panel position into the viewport. */
    function clampPos(left, top, width, height) {
      const maxLeft = Math.max(8, (window.innerWidth || 1200) - width - 8)
      const maxTop = Math.max(8, (window.innerHeight || 800) - height - 8)
      return {
        left: Math.min(Math.max(8, left), maxLeft),
        top: Math.min(Math.max(8, top), maxTop),
      }
    }

    /** mm:ss / h:mm:ss countdown. */
    function formatRemaining(ms) {
      const total = Math.max(0, Math.ceil(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      const pad = (value) => (value < 10 ? '0' + value : String(value))
      return hours > 0 ? hours + ':' + pad(minutes) + ':' + pad(seconds) : pad(minutes) + ':' + pad(seconds)
    }

    /** Isometric tile size: a 2:1 diamond, the classic 45° field projection. */
    const TILE_MIN = 76

    /**
     * Lay plots out on a diamond grid: each row shifts left by half a tile and
     * down by half a tile height, so the whole field reads as one 45° plane.
     * Tiles shrink as the field grows so the widest layout still fits the panel.
     */
    function isoLayout(count, chunky) {
      const safe = Math.max(1, count)
      const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(safe))))
      const rows = Math.ceil(safe / cols)
      const available = Math.min(310, (window.innerWidth || 1200) - 40)
      const tileW = Math.min(safe > 9 ? 76 : safe > 6 ? 88 : 100, Math.floor(available * 2 / (cols + rows)))
      // The sprite's top face is a 1 : 0.56 diamond and the whole slab is 1 : 0.738; the vector slab is 2 : 1.
      const tileH = Math.round(tileW * (chunky ? 0.56 : 0.5))
      /** Slab thickness: the visible side wall under each diamond. */
      const thick = chunky ? Math.round(tileW * 0.738) - tileH : Math.max(6, Math.round(tileW * 0.08))
      const shift = (rows - 1) * (tileW / 2)
      const width = ((cols - 1) + (rows - 1)) * (tileW / 2) + tileW
      const height = ((cols - 1) + (rows - 1)) * (tileH / 2) + tileH + thick
      return {
        cols,
        rows,
        tileW,
        tileH,
        thick,
        width,
        height,
        pos(index) {
          const row = Math.floor(index / cols)
          const col = index % cols
          return {
            left: (col - row) * (tileW / 2) + shift,
            top: (col + row) * (tileH / 2),
          }
        },
      }
    }

    /**
     * Clay-style sprites from the host (`/art`): `{ name: { src, w, h } }`. Until they arrive, or if the
     * host ships none, every sprite falls back to the built-in vector art below.
     */
    const artStore = { map: null, loading: false, css: '', listeners: new Set() }
    const artOf = (name) => (artStore.map && artStore.map[name]) || null

    /** Background themes: every `bg-<id>` sprite is one; the pick is remembered in this browser. */
    const BG_KEY = 'dsh.lingcao-garden.bg'
    const BG_DEFAULT = 'spring'
    const BG_ORDER = ['spring', 'rain', 'snow', 'sea', 'moon']
    const bgStore = {
      value: (() => {
        try {
          return window.localStorage.getItem(BG_KEY) || null
        } catch {
          return null
        }
      })(),
      listeners: new Set(),
    }
    /** Theme ids available right now: the known ones in their order, then any custom ones A–Z. */
    function bgThemes() {
      if (!artStore.map) return []
      const ids = Object.keys(artStore.map).filter((key) => key.startsWith('bg-')).map((key) => key.slice(3))
      const known = BG_ORDER.filter((id) => ids.includes(id))
      return known.concat(ids.filter((id) => !BG_ORDER.includes(id)).sort())
    }
    /** The theme to draw: the saved pick if it still exists, else the default, else the first one. */
    function bgCurrent() {
      const ids = bgThemes()
      if (bgStore.value && ids.includes(bgStore.value)) return bgStore.value
      return ids.includes(BG_DEFAULT) ? BG_DEFAULT : ids[0] || null
    }
    function setBg(id) {
      bgStore.value = id
      try {
        window.localStorage.setItem(BG_KEY, id)
      } catch {
        // Private mode keeps the pick for this page only.
      }
      for (const listener of bgStore.listeners) listener(id)
    }

    /** Extra rules that only make sense once real sprites exist (kept apart so the fallback look is untouched). */
    function buildArtCss(map) {
      const url = (name) => (map[name] ? 'url("' + map[name].src + '")' : 'none')
      return [
        '.lcg-art .lcg-gem{width:14px;height:14px;border-radius:50%;transform:none;box-shadow:none;background:' + url('icon-stone') + ' center/contain no-repeat}',
        '.lcg-art .lcg-stones .lcg-gem{width:19px;height:19px}',
        '.lcg-art .lcg-cost .lcg-gem,.lcg-art .lcg-lock .lcg-gem{width:13px;height:13px}',
      ].join('')
    }

    /** Fetch the sprite manifest once; any failure leaves the vector fallback in place. */
    function loadArt() {
      if (artStore.map || artStore.loading || typeof fetch !== 'function') return
      artStore.loading = true
      fetch(API + '/art', { cache: 'no-store', headers: { accept: 'application/json' } })
        .then((response) => response.json())
        .then((body) => {
          if (body && body.ok && body.art && Object.keys(body.art).length) {
            artStore.map = body.art
            artStore.css = buildArtCss(body.art)
            for (const listener of artStore.listeners) listener(true)
          }
        })
        .catch(() => {})
        .then(() => {
          artStore.loading = false
        })
    }

    /** Growth stage 0..3 from progress; 3 is reserved for "ready" so it never shows early. */
    function stageOf(progress, ready) {
      if (ready) return 3
      if (progress >= 0.55) return 2
      if (progress >= 0.2) return 1
      return 0
    }

    /** One grass blade as a filled curve: base x, height, sideways lean, half-width. */
    function blade(x, height, lean, half, fill) {
      const tipX = x + lean
      const tipY = 45 - height
      const d =
        'M' + (x - half) + ' 45Q' + (x - half + lean * 0.2) + ' ' + (45 - height * 0.6) + ' ' + tipX + ' ' + tipY +
        'Q' + (x + half + lean * 0.2) + ' ' + (45 - height * 0.55) + ' ' + (x + half) + ' 45Z'
      return h('path', { key: x + ':' + height, d, fill })
    }

    /** Herb sprite for one growth stage. `scale` (px per source px) sizes it inside a plot; elsewhere CSS does. */
    function Crop({ tone, stage, scale }) {
      const sprite = artOf('crop-' + tone + '-' + stage)
      if (!sprite) return h(CropVector, { tone, stage })
      return h('img', {
        className: 'lcg-cropsvg lcg-cropimg',
        src: sprite.src,
        alt: '',
        draggable: false,
        'aria-hidden': 'true',
        style: scale && sprite.w ? { width: Math.round(sprite.w * scale) + 'px' } : undefined,
      })
    }

    /** Built-in vector herb drawn per growth stage; `tone` picks the species. */
    function CropVector({ tone, stage }) {
      const mound = h('ellipse', { cx: 20, cy: 45.5, rx: 11, ry: 3, fill: 'rgba(30,20,10,.5)' })
      const kids = [mound]
      if (tone === 'yuehua') {
        const stem = '#7fae9a'
        const leaf = '#9cc9b4'
        const height = [6, 16, 25, 25][stage]
        kids.push(h('path', { key: 'stem', d: 'M20 45V' + (45 - height), stroke: stem, strokeWidth: 2, strokeLinecap: 'round', fill: 'none' }))
        const leaves = [
          [12, 8, 'M20 41C15 41 12 38 12 34c4 0 8 2 8 7z'],
          [12, 8, 'M20 38C25 38 28 35 28 31c-4 0-8 2-8 7z'],
          [24, 4, 'M20 30C16 30 13 27 13 23c4 0 7 2 7 7z'],
          [24, 4, 'M20 27C24 27 27 24 27 20c-4 0-7 2-7 7z'],
        ]
        leaves.forEach((entry, index) => {
          if (height >= entry[0]) kids.push(h('path', { key: 'l' + index, d: entry[2], fill: leaf, opacity: index % 2 ? 0.85 : 1 }))
        })
        if (stage === 2) kids.push(h('ellipse', { key: 'bud', cx: 20, cy: 15, rx: 3.4, ry: 5.4, fill: '#dbe6fb', stroke: '#a9bfe8', strokeWidth: 0.8 }))
        if (stage === 3) {
          kids.push(h('circle', { key: 'halo', cx: 20, cy: 14, r: 13, fill: 'rgba(190,215,255,.4)' }))
          for (let index = 0; index < 5; index += 1) {
            kids.push(h('ellipse', { key: 'p' + index, cx: 20, cy: 8, rx: 3.3, ry: 6.2, fill: '#eef4ff', stroke: '#a9bfe8', strokeWidth: 0.7, transform: 'rotate(' + index * 72 + ' 20 14)' }))
          }
          kids.push(h('circle', { key: 'core', cx: 20, cy: 14, r: 2.6, fill: '#f6d76a' }))
        }
      } else {
        const dark = '#4f9565'
        const mid = '#6fb37a'
        const light = '#9ad59a'
        if (stage === 0) {
          kids.push(blade(18, 8, -3, 1.6, mid), blade(22, 9, 3, 1.6, light))
        } else if (stage === 1) {
          kids.push(blade(16, 15, -5, 2, dark), blade(24, 16, 5, 2, mid), blade(20, 19, 0, 2.2, light))
        } else {
          kids.push(
            blade(13, 20, -7, 2.4, dark),
            blade(27, 21, 7, 2.4, dark),
            blade(17, 27, -4, 2.6, mid),
            blade(23, 28, 4, 2.6, mid),
            blade(20, 34, 0, 2.8, light),
          )
        }
        if (stage === 3) {
          kids.push(h('circle', { key: 'halo', cx: 20, cy: 18, r: 14, fill: 'rgba(255,236,150,.28)' }))
          const pearls = [[13, 25], [27, 24], [20, 11]]
          pearls.forEach((at, index) =>
            kids.push(h('circle', { key: 'pearl' + index, cx: at[0], cy: at[1], r: 2.4, fill: '#fff4c0', stroke: '#e2b93b', strokeWidth: 0.8 })),
          )
        }
      }
      return h('svg', { className: 'lcg-cropsvg', viewBox: '0 0 40 48', role: 'img', 'aria-hidden': 'true' }, ...kids)
    }

    /** Tiny stroke icons so buttons carry meaning without any external asset. */
    const ICON_PATHS = {
      basket: 'M2.5 6.5h11l-1.2 6a1.5 1.5 0 0 1-1.5 1.2H5.2a1.5 1.5 0 0 1-1.5-1.2zM5.5 6.5L7.5 3M10.5 6.5L8.5 3',
      drop: 'M8 2.2c2.2 2.6 4 4.5 4 6.8a4 4 0 0 1-8 0c0-2.3 1.8-4.2 4-6.8z',
      back: 'M9.5 3.5L5 8l4.5 4.5',
      image: 'M2.5 3.5h11v9h-11zM2.5 11l3.2-3.4 2.6 2.6 2-2 3.2 3.2M10.6 6.3h.01',
      leaf: 'M3 13c0-6 3.5-9.5 10-10 0 6.5-3.5 10-10 10zM3 13l5-5',
      bolt: 'M8.8 2L4.5 9h3l-.8 5 4.8-7.2H8z',
      uproot: 'M3.5 4.5h9M6 4.5V3h4v1.5M4.8 4.5l.6 8.3a1 1 0 0 0 1 .9h3.2a1 1 0 0 0 1-.9l.6-8.3',
      close: 'M4 4l8 8M12 4l-8 8',
      lock: 'M4.5 7.5h7v5.5h-7zM6 7.5V5.8a2 2 0 0 1 4 0v1.7',
      plus: 'M8 3.5v9M3.5 8h9',
      land: 'M2 10l6-3.5 6 3.5-6 3.5zM2 7l6-3.5L14 7',
      coin: 'M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3zM8 6v4M6.5 8h3',
      book: 'M8 4.5C6.5 3.3 4.5 3 2.5 3.3v8.4c2-.3 4 0 5.5 1.2 1.5-1.2 3.5-1.5 5.5-1.2V3.3C11.5 3 9.5 3.3 8 4.5zM8 4.5v8.4',
      chevron: 'M6 3.5L10.5 8 6 12.5',
      spirit: 'M8 2c3 2 4.5 4 4.5 6.2A4.5 4.5 0 0 1 8 13a4.5 4.5 0 0 1-4.5-4.8C3.5 6 5 4 8 2zM8 13V7',
      sprout: 'M8 14V7.2M8 7.2C8 4.9 6.3 3.2 4 3.2c0 2.3 1.7 4 4 4zM8 9.2c0-2.1 1.6-3.8 3.8-3.8 0 2.1-1.7 3.8-3.8 3.8z',
      clock: 'M8 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8zM8 5.2V8l2.1 1.3',
    }
    /** Icons that have a clay sprite; the rest stay as small stroke icons. */
    const ART_ICONS = {
      basket: 'icon-basket',
      drop: 'icon-rain',
      leaf: 'icon-fertilizer',
      bolt: 'icon-ripen',
      book: 'icon-journal',
    }
    function Icon({ name, plain }) {
      const sprite = plain ? null : ART_ICONS[name] ? artOf(ART_ICONS[name]) : null
      if (sprite) return h('img', { className: 'lcg-ico', src: sprite.src, alt: '', draggable: false, 'aria-hidden': 'true' })
      return h(
        'svg',
        { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: ICON_PATHS[name] || '' }),
      )
    }

    /** A "◇ n" cost / amount chip. */
    function Cost({ n }) {
      return h('span', { className: 'lcg-cost' }, h('span', { className: 'lcg-gem', 'aria-hidden': 'true' }), n)
    }

    /** "3 分钟前"-style age for the journal; `now` is the panel clock. */
    function ageOf(t, now, tt) {
      const minutes = Math.floor(Math.max(0, now - t) / 60000)
      if (minutes < 1) return tt('agoJust')
      if (minutes < 60) return tt('agoMin', { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return tt('agoHour', { n: hours })
      return tt('agoDay', { n: Math.floor(hours / 24) })
    }

    /** Frame-level visibility, shared by the garden and its settings row. */
    const VIS_KEY = 'dsh.lingcao-garden.visible'
    const visibility = {
      value: (() => {
        try {
          return window.localStorage.getItem(VIS_KEY) !== '0'
        } catch {
          return true
        }
      })(),
      listeners: new Set(),
    }
    /** Toggle the garden and persist; the settings row and the orb both follow. */
    function setVisible(next) {
      visibility.value = Boolean(next)
      try {
        window.localStorage.setItem(VIS_KEY, visibility.value ? '1' : '0')
      } catch {
        // Private mode keeps the choice for this page only.
      }
      for (const listener of visibility.listeners) listener(visibility.value)
    }

    /** Build the React components once a translator exists. */
    function makeComponents(t) {
      const resets = { revision: 0, listeners: new Set() }
      /** Re-render when the sprite manifest lands; the sprites themselves are read from `artStore`. */
      function useArt() {
        const [, setReady] = React.useState(Boolean(artStore.map))
        React.useEffect(() => {
          artStore.listeners.add(setReady)
          return () => artStore.listeners.delete(setReady)
        }, [])
      }
      /** Re-render when the backdrop pick changes (from the panel button or the settings page). */
      function useBg() {
        const [, setPick] = React.useState(bgStore.value)
        React.useEffect(() => {
          bgStore.listeners.add(setPick)
          return () => bgStore.listeners.delete(setPick)
        }, [])
      }
      /** Readable theme name: a translated one for bundled themes, the file id for custom ones. */
      const bgName = (id) => {
        const text = t('bg_' + id)
        return text === 'bg_' + id ? id : text
      }

      /** Follow the module-level visibility store. */
      function useVisible() {
        const [visible, setLocal] = React.useState(visibility.value)
        React.useEffect(() => {
          const listener = (next) => setLocal(next)
          visibility.listeners.add(listener)
          return () => visibility.listeners.delete(listener)
        }, [])
        return visible
      }

      /** Translate with a `{name}` / `{n}` interpolation. */
      const tt = (key, vars) => {
        let text = t(key)
        if (vars) {
          for (const [name, value] of Object.entries(vars)) text = text.split('{' + name + '}').join(String(value))
        }
        return text
      }

      /** The whole floating garden surface. */
      function Garden() {
        const [ui, setUi] = React.useState(() => loadUi())
        const [view, setView] = React.useState(null)
        const [toast, setToast] = React.useState(null)
        const [selected, setSelected] = React.useState('juqi')
        const [panelView, setPanelView] = React.useState('field')
        /** Open plot popover: `{ id, x, y, above }` anchored to the clicked tile, or null. */
        const [focused, setFocused] = React.useState(null)
        const [journalOpen, setJournalOpen] = React.useState(false)
        const [gmForm, setGmForm] = React.useState({ stones: '', xp: '', unlocked: '', minutes: '', name: '' })
        /** Armed 铲除 target: the first click only arms, a second click inside the window really pulls it. */
        const [uprootArm, setUprootArm] = React.useState(null)
        const visible = useVisible()
        const [now, setNow] = React.useState(() => Date.now())
        const [online, setOnline] = React.useState(true)
        const drag = React.useRef(null)
        const toastTimer = React.useRef(null)
        const panelRef = React.useRef(null)
        const uiRef = React.useRef(ui)
        uiRef.current = ui
        /** Live "+N 灵石" floats, fed by the host's lifetime `earned` counter (token income only). */
        const [floats, setFloats] = React.useState([])
        const earnedRef = React.useRef(null)
        const floatSeq = React.useRef(0)
        const floatTimers = React.useRef(new Set())

        /**
         * Diff `earned` between snapshots. The first snapshot after (re)showing is only a baseline,
         * so reloads and un-hiding never replay income that arrived while nobody was looking.
         */
        React.useEffect(() => {
          if (!visible) {
            earnedRef.current = null
            return
          }
          if (!view || !Number.isFinite(view.earned)) return
          const previous = earnedRef.current
          earnedRef.current = view.earned
          if (previous === null || view.earned <= previous) return
          const id = ++floatSeq.current
          const amount = view.earned - previous
          setFloats((list) => list.slice(1 - FLOAT_MAX).concat({ id, amount }))
          const timer = window.setTimeout(() => {
            floatTimers.current.delete(timer)
            setFloats((list) => list.filter((item) => item.id !== id))
          }, FLOAT_MS)
          floatTimers.current.add(timer)
        }, [view, visible])

        React.useEffect(() => {
          const timers = floatTimers.current
          return () => {
            for (const timer of timers) window.clearTimeout(timer)
            timers.clear()
          }
        }, [])

        // Appended after the float hooks so the established hook order (and its tests) stays put.
        useArt()
        useBg()
        React.useEffect(() => {
          if (visible) loadArt()
        }, [visible])
        const [focusMode, setFocusMode] = React.useState(true)
        const [seedsOpen, setSeedsOpen] = React.useState(false)
        const [clockId, setClockId] = React.useState(null)
        const [harvestFlights, setHarvestFlights] = React.useState([])
        const harvestPending = React.useRef(false)
        const harvestSeq = React.useRef(0)
        const harvestEpoch = React.useRef(0)
        const clearHarvest = () => { harvestEpoch.current++; setHarvestFlights([]) }
        React.useEffect(() => {
          clearHarvest()
        }, [visible, ui.mode, ui.layout, ui.left, ui.top])
        React.useEffect(() => {
          window.addEventListener('resize', clearHarvest)
          return () => { harvestEpoch.current++; window.removeEventListener('resize', clearHarvest) }
        }, [])
        React.useEffect(() => {
          if (!harvestFlights.length) return undefined
          const timer = window.setTimeout(() => setHarvestFlights([]), 1600)
          return () => window.clearTimeout(timer)
        }, [harvestFlights])
        React.useEffect(() => {
          const adoptReset = state => {
            earnedRef.current = null
            for (const timer of floatTimers.current) window.clearTimeout(timer)
            floatTimers.current.clear()
            setFloats([])
            clearHarvest()
            setFocused(null); setJournalOpen(false); setSeedsOpen(false); setPanelView('field')
            setClockId(null); setSelected('juqi'); setUprootArm(null); setToast(null)
            setGmForm({ stones: '', xp: '', unlocked: '', minutes: '', name: '' })
            setNow(state.now); setView(state)
          }
          resets.listeners.add(adoptReset)
          return () => resets.listeners.delete(adoptReset)
        }, [])
        const artOn = Boolean(artStore.map)

        /** Esc closes the journal dialog, then the plot popover. */
        React.useEffect(() => {
          if (!journalOpen && !focused && !seedsOpen && panelView === 'field') return undefined
          const onKey = (event) => {
            if (event.key !== 'Escape') return
            if (journalOpen) setJournalOpen(false)
            else if (panelView !== 'field') setPanelView('field')
            else if (focused) setFocused(null)
            else setSeedsOpen(false)
          }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }, [journalOpen, focused, seedsOpen, panelView])

        const dialogOpen = seedsOpen || panelView !== 'field'
        React.useEffect(() => {
          if (!dialogOpen || typeof document === 'undefined') return undefined
          const previous = document.activeElement
          const dialog = document.querySelector('[data-garden-dialog]')
          if (dialog) dialog.querySelector('button')?.focus()
          return () => { if (previous && previous.isConnected) previous.focus() }
        }, [dialogOpen])

        /** Functional update so drag/clamp never race a stale `ui` closure. */
        const updateUi = (change) => {
          setUi((prev) => {
            const next = typeof change === 'function' ? change(prev) : change
            saveUi(next)
            return next
          })
        }

        const say = (text, error) => {
          toastSeq += 1
          setToast({ id: toastSeq, text, error: Boolean(error) })
          if (toastTimer.current) window.clearTimeout(toastTimer.current)
          toastTimer.current = window.setTimeout(() => setToast(null), 2600)
        }

        /** Fetch the read model. */
        const refresh = React.useCallback(async () => {
          const revision = resets.revision
          try {
            const response = await fetch(API + '/state', { headers: { accept: 'application/json' } })
            const body = await response.json()
            if (body && body.ok && body.state && revision === resets.revision) {
              setView(body.state)
              setOnline(true)
            }
          } catch {
            setOnline(false)
          }
        }, [])

        /** Apply the GM edit form: only filled fields are sent. */
        const applyGm = () => {
          const patch = {}
          const number = (value) => (String(value).trim() === '' ? null : Number(value))
          const stones = number(gmForm.stones)
          if (Number.isFinite(stones)) patch.stones = stones
          const xp = number(gmForm.xp)
          if (Number.isFinite(xp)) patch.xp = xp
          const unlocked = number(gmForm.unlocked)
          if (Number.isFinite(unlocked)) patch.unlocked = unlocked
          const minutes = number(gmForm.minutes)
          if (Number.isFinite(minutes)) patch.remainingMinutes = minutes
          if (gmForm.name && gmForm.name.trim()) patch.name = gmForm.name.trim()
          if (!Object.keys(patch).length) {
            say(tt('gmNothing'), true)
            return
          }
          setGmForm({ stones: '', xp: '', unlocked: '', minutes: '', name: '' })
          act({ action: 'gm', op: 'set', patch })
        }

        /** Post one intent and adopt the returned read model. */
        const act = async (payload) => {
          const revision = resets.revision
          const harvesting = payload.action === 'harvest' || payload.action === 'harvestAll'
          if (harvesting && harvestPending.current) return
          const epoch = harvestEpoch.current
          const centerOf = (element) => {
            const rect = element?.getBoundingClientRect()
            return rect && rect.width > 0 && rect.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
          }
          const panel = panelRef.current
          const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          const destination = harvesting && !reducedMotion ? centerOf(panel?.querySelector('[data-entrance="basket"] .lcg-entrance-art, [data-entrance="basket"]')) : null
          const candidates = harvesting && destination ? (view?.plots || []).filter(plot => plot.crop && plot.unlocked &&
            (payload.action === 'harvestAll' || plot.id === payload.plotId) &&
            (plot.ready || plot.remainingMs <= Math.max(0, Math.max(now, Date.now()) - view.now))
          ).map(plot => ({ plot, source: centerOf(panel?.querySelector('[data-plot-id="' + plot.id + '"] .lcg-crop, [data-clock-plot="' + plot.id + '"] .lcg-clock-sprite')) })).filter(item => item.source) : []
          if (harvesting) harvestPending.current = true
          try {
            const response = await fetch(API + '/act', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
            const body = await response.json()
            if (revision !== resets.revision) return
            if (harvesting && body?.ok && body.state && epoch === harvestEpoch.current && uiRef.current.mode === 'open') {
              const collected = candidates.filter(({ plot }) => body.state.plots?.some(next => next.id === plot.id && !next.crop))
              const flights = collected.map(({ plot, source }, index) => ({
                id: ++harvestSeq.current, crop: plot.crop, source, destination,
                delay: collected.length > 1 ? Math.round(index * Math.min(70, 350 / (collected.length - 1))) : 0,
              }))
              if (flights.length) setHarvestFlights(list => list.concat(flights).slice(-24))
            }
            if (body && body.state) setView(body.state)
            if (body && body.message) say(body.message, !body.ok)
            setOnline(true)
          } catch {
            setOnline(false)
            say(t('failed'), true)
          } finally {
            if (harvesting) harvestPending.current = false
          }
        }

        const isOpen = ui.mode === 'open'

        /** Poll only while shown: relaxed for the orb, brisk for the open panel, none when hidden. */
        React.useEffect(() => {
          if (!visible) return undefined
          refresh()
          const poll = window.setInterval(refresh, isOpen ? POLL_MS : ORB_POLL_MS)
          return () => window.clearInterval(poll)
        }, [visible, isOpen, refresh])

        /** Per-second countdown clock: only the open panel shows countdowns. */
        React.useEffect(() => {
          if (!visible || !isOpen) return undefined
          setNow(Date.now())
          const clock = window.setInterval(() => setNow(Date.now()), 1000)
          return () => window.clearInterval(clock)
        }, [visible, isOpen])

        React.useEffect(() => {
          const clamp = () => {
            // The popover holds screen coordinates; a resize would leave it floating in the wrong place.
            setFocused(null)
            const current = uiRef.current
            const size = current.mode === 'open' ? { w: PANEL_WIDTH, h: 460 } : { w: ORB_SIZE, h: ORB_SIZE }
            const next = clampPos(current.left, current.top, size.w, size.h)
            if (next.left !== current.left || next.top !== current.top) {
              updateUi((prev) => ({ ...prev, ...next }))
            }
          }
          window.addEventListener('resize', clamp)
          return () => window.removeEventListener('resize', clamp)
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [])

        /** Pointer drag for the panel header and the orb. */
        const startDrag = (event) => {
          if (event.button !== 0) return
          // A floating plot popover is anchored to screen coordinates: dragging the panel closes it.
          setFocused(null)
          // Header buttons are children of the drag surface; the orb IS the surface.
          if (
            event.target &&
            event.target !== event.currentTarget &&
            typeof event.target.closest === 'function' &&
            event.target.closest('button')
          ) {
            return
          }
          event.preventDefault()
          event.currentTarget.setPointerCapture?.(event.pointerId)
          const current = uiRef.current
          drag.current = { dx: event.clientX - current.left, dy: event.clientY - current.top, moved: false }
        }
        const moveDrag = (event) => {
          if (!drag.current) return
          const current = uiRef.current
          const size = current.mode === 'open' ? { w: PANEL_WIDTH, h: 460 } : { w: ORB_SIZE, h: ORB_SIZE }
          const next = clampPos(event.clientX - drag.current.dx, event.clientY - drag.current.dy, size.w, size.h)
          drag.current.moved = true
          updateUi((prev) => ({ ...prev, ...next }))
        }
        const endDrag = (event) => {
          if (!drag.current) return
          const moved = drag.current.moved
          drag.current = null
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          return moved
        }

        const open = () => {
          updateUi((prev) => ({ ...prev, ...clampPos(prev.left + ORB_SIZE - PANEL_WIDTH, prev.top, PANEL_WIDTH, 460), mode: 'open' }))
        }
        const fold = () => {
          setJournalOpen(false)
          setFocused(null)
          setSeedsOpen(false)
          setPanelView('field')
          updateUi((prev) => ({ ...prev, ...clampPos(prev.left + PANEL_WIDTH - ORB_SIZE, prev.top, ORB_SIZE, ORB_SIZE), mode: 'orb' }))
        }

        /** Hidden from the settings row: render nothing at all. */
        if (!visible) return null

        const stones = view ? view.stones : 0
        const readyCount = view && view.readyCount ? view.readyCount : 0
        const prices = (view && view.prices) || { fertilizer: 8, rain: 30, ripenMin: 10, ripenPerMin: 2 }
        const gmOn = Boolean(view && view.gm)
        /** "+N" floats; decorative, the balance itself is the accessible truth. */
        const floatNodes = (variant) =>
          floats.map((item) =>
            h('span', { key: item.id, className: 'lcg-float lcg-float-' + variant, 'aria-hidden': 'true' }, '+' + item.amount),
          )
        const latestFloat = floats.length ? floats[floats.length - 1].id : 0
        /** The stylesheet rides on every mode: folding must not unmount the orb's own rules. */
        const styleTag = h('style', { dangerouslySetInnerHTML: { __html: artOn ? CSS + artStore.css : CSS } })
        const rootClass = 'lcg-root' + (artOn ? ' lcg-art' : '')

        if (ui.mode === 'orb') {
          return h(
            'div',
            { className: rootClass, style: { left: ui.left + 'px', top: ui.top + 'px' } },
            styleTag,
            h(
              'button',
              {
                type: 'button',
                className: 'lcg-orb' + (artOn && artOf('icon-orb') ? ' has-art' : ''),
                style: { position: 'absolute', left: 0, top: 0 },
                title: readyCount ? tt('orbTitle') + ' · ' + tt('orbReady', { n: readyCount }) : tt('orbTitle'),
                'aria-label': readyCount ? tt('orbTitle') + ' · ' + tt('orbReady', { n: readyCount }) : tt('orbTitle'),
                onPointerDown: startDrag,
                onPointerMove: moveDrag,
                onPointerUp: (event) => {
                  const moved = endDrag(event)
                  if (!moved) open()
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    open()
                  }
                },
              },
              artOn && artOf('icon-orb')
                ? h('img', { className: 'lcg-orbimg', src: artOf('icon-orb').src, alt: '', draggable: false, 'aria-hidden': 'true' })
                : h(Crop, { tone: 'juqi', stage: 3 }),
              h('span', { className: 'lcg-orb-badge', 'aria-hidden': 'true' }, stones),
              readyCount ? h('span', { className: 'lcg-orb-ready', 'aria-hidden': 'true' }, readyCount) : null,
            ),
            ...floatNodes('orb'),
          )
        }

        const bar = view && view.nextXp !== null
          ? Math.min(1, Math.max(0, (view.xp - view.stageXp) / Math.max(1, view.nextXp - view.stageXp)))
          : 1
        /** Seconds since the snapshot arrived, so countdowns tick between polls. */
        const drift = view ? Math.max(0, now - view.now) : 0
        const catalog = view ? view.catalog : []
        const bag = view ? view.bag : { seeds: {}, herbs: {} }
        const basketValue = catalog.reduce((total, item) => total + (bag.herbs[item.id] || 0) * item.price, 0)
        const plots = view ? view.plots : []
        const visiblePlots = []
        for (const plot of plots) {
          if (plot.unlocked) visiblePlots.push(plot)
          else if (view && plot.id === 'p' + (view.unlocked + 1)) visiblePlots.push(plot)
        }
        const layout = isoLayout(visiblePlots.length, artOn)
        const focusedPlot = focused ? visiblePlots.find((plot) => plot.id === focused.id && plot.crop) : null
        const clockOn = ui.layout === 'clock'
        const switchLayout = (layout) => {
          setFocused(null)
          setSeedsOpen(false)
          setPanelView('field')
          updateUi((prev) => ({ ...prev, layout }))
        }
        const visit = (page) => {
          setFocused(null)
          setSeedsOpen(false)
          setPanelView(page)
        }

        /**
         * Where the plot popover opens: centered under the clicked tile, flipped above when the
         * bottom of the screen is close, and always clamped inside the viewport.
         */
        const anchorFor = (plot, event) => {
          const rect =
            event && event.currentTarget && typeof event.currentTarget.getBoundingClientRect === 'function'
              ? event.currentTarget.getBoundingClientRect()
              : null
          const vw = window.innerWidth || 1200
          const vh = window.innerHeight || 800
          const margin = 8
          if (!rect) return { id: plot.id, x: Math.round(vw / 2), y: vh / 2 - PLOT_POP_H / 2, above: false }
          const half = PLOT_POP_W / 2
          const x = Math.round(Math.min(Math.max(rect.left + rect.width / 2, half + margin), vw - half - margin))
          const above = rect.bottom + margin + PLOT_POP_H > vh - margin
          return { id: plot.id, x, y: Math.round(above ? rect.top - margin : rect.bottom + margin), above }
        }

        /** Drifting spirit motes over the scene; purely decorative and motion-gated by CSS. */
        const MOTES = [['14%', '30%', '0s'], ['38%', '18%', '1.6s'], ['62%', '34%', '3.1s'], ['80%', '22%', '4.4s'], ['28%', '48%', '2.3s']]

        /** Progress advances between polls so the tag bar and the sprite keep growing. */
        const liveOf = (plot) =>
          plot.crop ? Math.min(1, (plot.progress || 0) + (plot.growMs ? drift / plot.growMs : 0)) : 0
        const timeOf = (plot) => (plot.remainingMs ? formatRemaining(Math.max(0, plot.remainingMs - drift)) : '')

        /** The slab every tile is built from: side wall, grass rim, soil. */
        const slab = (kind) => {
          const sprite = artOf('tile-' + kind)
          // With art: the picture is purely visual and a transparent hit layer takes the clicks.
          if (sprite) {
            return h('span', { className: 'lcg-slab' },
              h('img', { className: 'lcg-tileimg', src: sprite.src, alt: '', draggable: false }),
              h('span', { className: 'lcg-hit' }),
            )
          }
          return h('span', { className: 'lcg-hit' },
            h('span', { className: 'lcg-side' }),
            h('span', { className: 'lcg-rim' }),
            h('span', { className: 'lcg-soil' }),
          )
        }

        /** 45° field: one thick diamond slab per plot on an isometric grid, set in a night-ink scene. */
        const themes = bgThemes()
        const themeId = bgCurrent()
        const themeArt = artOn && themeId ? artOf('bg-' + themeId) : null
        const cycleBg = () => {
          const next = themes[(themes.indexOf(themeId) + 1) % themes.length]
          setBg(next)
          say(tt('bgNow', { name: bgName(next) }))
        }
        const field = h(
          'div',
          {
            className: 'lcg-field-wrap' + (themeArt ? ' has-bg' : ''),
            'aria-label': tt('gardenScene'),
            style: themeArt ? { backgroundImage: 'url("' + themeArt.src + '")' } : undefined,
          },
          h('div', { className: 'lcg-scene-gates' },
            h('button', { type: 'button', className: 'lcg-scene-sign', 'data-entrance': 'shop', 'aria-haspopup': 'dialog', onClick: () => visit('shop') },
              artOf('entrance-shop') ? h('img', { className: 'lcg-entrance-art', src: artOf('entrance-shop').src, alt: '', draggable: false, 'aria-hidden': 'true' }) : h(Icon, { name: 'land' }),
              h('span', { className: 'lcg-entrance-label' }, tt('shopEntry'))),
            // The clock view is a place in the scene, not a tiny utility button: it sits between shop and basket.
            h('button', { type: 'button', className: 'lcg-scene-sign', 'data-entrance': 'clock', 'aria-label': tt('enterClock'), title: tt('enterClock'), onClick: () => switchLayout('clock') },
              artOf('icon-array') ? h('img', { className: 'lcg-entrance-art', src: artOf('icon-array').src, alt: '', draggable: false, 'aria-hidden': 'true' }) : h(Icon, { name: 'clock', plain: true }),
              h('span', { className: 'lcg-entrance-label' }, tt('enterClock'))),
            h('button', { type: 'button', className: 'lcg-scene-sign', 'data-entrance': 'basket', 'aria-haspopup': 'dialog', onClick: () => visit('bag') },
              artOf('entrance-basket') ? h('img', { className: 'lcg-entrance-art', src: artOf('entrance-basket').src, alt: '', draggable: false, 'aria-hidden': 'true' }) : h(Icon, { name: 'basket' }),
              h('span', { className: 'lcg-entrance-label' }, tt('bag'))),
          ),
          h('span', { className: 'lcg-scene-name' }, view ? view.name : tt('gardenScene')),
          themes.length > 1
            ? h(
                'button',
                { type: 'button', className: 'lcg-bgbtn', title: tt('bgNext') + ' · ' + bgName(themeId), 'aria-label': tt('bgNext'), onClick: cycleBg },
                h(Icon, { name: 'image' }),
              )
            : null,
          MOTES.map((mote, index) =>
            h('span', { key: 'mote' + index, className: 'lcg-mote', 'aria-hidden': 'true', style: { left: mote[0], bottom: mote[1], animationDelay: mote[2] } }),
          ),
          h(
            'div',
            { className: 'lcg-field', style: { width: layout.width + 'px', height: layout.height + 'px' } },
            visiblePlots.map((plot, index) => {
              const at = layout.pos(index)
              const tileStyle = {
                left: at.left + 'px',
                top: at.top + 'px',
                width: layout.tileW + 'px',
                height: layout.tileH + layout.thick + 'px',
                '--w': layout.tileW + 'px',
                '--h': layout.tileH + 'px',
                '--t': layout.thick + 'px',
              }
              if (!plot.unlocked) {
                const label = tt('locked') + (view ? ' · ' + tt('expandCost', { n: view.landCost || 0 }) : '')
                return h(
                  'button',
                  {
                    key: plot.id,
                    type: 'button',
                    className: 'lcg-tile is-locked',
                    style: tileStyle,
                    title: label,
                    'aria-label': label,
                    onClick: () => act({ action: 'expand' }),
                  },
                  slab('locked'),
                  h(
                    'span',
                    { className: 'lcg-lock' },
                    h(Icon, { name: 'lock' }),
                    view ? h('span', null, h('span', { className: 'lcg-gem', 'aria-hidden': 'true' }), view.landCost || 0) : null,
                  ),
                )
              }
              const ready = Boolean(plot.ready) || Boolean(plot.crop && plot.remainingMs <= drift)
              const live = liveOf(plot)
              const title = plot.crop ? plot.cropName + ' · ' + (plot.focus ? tt('focusGrowing') + ' · ' : '') + (ready ? tt('ready') : timeOf(plot)) : tt('emptyPlot')
              return h(
                'button',
                {
                  key: plot.id,
                  type: 'button',
                  className:
                    'lcg-tile' + (ready ? ' is-ready' : '') + (plot.fertilized ? ' is-fert' : '') + (focused && focused.id === plot.id ? ' is-focus' : ''),
                  style: tileStyle,
                  title,
                  'aria-label': title,
                  'data-plot-id': plot.id,
                  onClick: (event) => {
                    if (!plot.crop) {
                      act({ action: 'plant', plotId: plot.id, cropId: selected, focus: focusMode })
                      setFocused(null)
                      return
                    }
                    if (!ready) {
                      setFocused(anchorFor(plot, event))
                      return
                    }
                    setFocused(null)
                    return act({ action: 'harvest', plotId: plot.id })
                  },
                },
                ready ? h('span', { className: 'lcg-glow', 'aria-hidden': 'true' }) : null,
                slab(ready ? 'ripe' : plot.fertilized ? 'fert' : 'soil'),
                plot.crop
                  ? h('span', { className: 'lcg-crop' + (ready ? ' is-ready' : '') }, h(Crop, { tone: plot.crop, stage: stageOf(live, ready), scale: layout.tileW * 0.0028 }))
                  : h('span', { className: 'lcg-crop lcg-ghost', 'aria-hidden': 'true' }, h(Crop, { tone: selected, stage: 0, scale: layout.tileW * 0.0028 })),
                plot.crop ? null : h('span', { className: 'lcg-plus', 'aria-hidden': 'true' }, h(Icon, { name: 'plus' })),
              )
            }),
            // Tags live in their own layer above every tile, so a front sprite never hides "可收" or a countdown.
            visiblePlots.map((plot, index) => {
              if (!plot.unlocked || !plot.crop) return null
              const at = layout.pos(index)
              const ready = Boolean(plot.ready) || plot.remainingMs <= drift
              return h(
                'span',
                {
                  key: 'tag-' + plot.id,
                  className: 'lcg-tag' + (ready ? ' is-ready' : ''),
                  'aria-hidden': 'true',
                  style: {
                    left: at.left + layout.tileW / 2 + 'px',
                    top: at.top + layout.tileH / 2 + 5 + 'px',
                    '--p': Math.round(liveOf(plot) * 100) + '%',
                  },
                },
                ready ? tt('ready') : (plot.focus ? '◷ ' : '') + timeOf(plot),
              )
            }),
          ),
        )

        /** Preserve sub-minute choices and explicit 24-hour duration. */
        const growText = (ms) => {
          if (ms < 60_000) return ms / 1000 + '秒'
          if (ms < 3_600_000) return ms / 60_000 + '分钟'
          return ms / 3_600_000 + '小时'
        }

        /** Separate shop purchases from the basket's harvested herbs. */
        const shop = h(
          'div',
          { className: 'lcg-shop' },
          panelView === 'bag' ? h('button', {
            type: 'button', className: 'lcg-btn is-primary', 'aria-label': tt('sellAll'),
            disabled: basketValue <= 0, onClick: () => act({ action: 'sellAll' }),
          }, tt('sellAll'), h(Cost, { n: basketValue })) : null,
          panelView === 'bag' ? null : catalog.map((item) =>
            h(
              'div',
              { key: 'seed-' + item.id, className: 'lcg-card' + (item.id === selected ? ' is-on' : '') },
              h(
                'button',
                {
                  type: 'button',
                  className: 'lcg-seed-name' + (item.id === selected ? ' is-on' : ''),
                  title: tt('selected', { name: item.name }),
                  onClick: () => setSelected(item.id),
                },
                h('span', { className: 'lcg-card-ico' }, h(Crop, { tone: item.id, stage: 1 })),
                h(
                  'span',
                  { className: 'lcg-shop-name' },
                  h('strong', null, item.name, h('span', { className: 'lcg-tier', 'data-tier': item.tier }, item.tier + '品')),
                  h('span', { className: 'lcg-shop-meta' }, growText(item.growMs) + '熟 · 产 ' + item.yield + ' · 售 ' + item.price + ' · 修为 +' + item.harvestXp),
                ),
              ),
              h(
                'div',
                { className: 'lcg-actions' },
                h('span', { className: 'lcg-shop-meta' }, tt('hold') + ' ' + (bag.seeds[item.id] || 0)),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'lcg-btn',
                    disabled: Boolean(view) && view.stones < item.seedPrice,
                    onClick: () => act({ action: 'buySeed', cropId: item.id }),
                  },
                  tt('buy'),
                  h(Cost, { n: item.seedPrice }),
                ),
              ),
            ),
          ),
          panelView !== 'bag' ? null : catalog.map((item) => {
            const count = bag.herbs[item.id] || 0
            return h(
              'div',
              { key: 'bag-' + item.id, className: 'lcg-card' },
              h(
                'div',
                { className: 'lcg-card-main' },
                h('span', { className: 'lcg-card-ico' }, h(Crop, { tone: item.id, stage: 3 })),
                h(
                  'div',
                  { className: 'lcg-shop-name' },
                  h('strong', null, item.name),
                  h('span', { className: 'lcg-shop-meta' }, tt('hold') + ' ' + count + ' · 单价 ' + item.price),
                ),
              ),
              h(
                'button',
                { type: 'button', className: 'lcg-btn', disabled: count < 1, onClick: () => act({ action: 'sell', cropId: item.id }) },
                tt('sell'),
                h(Cost, { n: count * item.price }),
              ),
            )
          }),
          gmOn && panelView !== 'bag' ? renderGmTools() : null,
        )

        /** Local test tools: only rendered when the host reports GM as enabled. */
        function renderGmTools() {
          return h(
          'div',
          { className: 'lcg-shop' },
          h(
            'div',
            { className: 'lcg-rowhead' },
            h('span', null, tt('gmTitle')),
            h('span', { className: 'lcg-shop-meta' }, tt('gmHint')),
          ),
          h(
            'div',
            { className: 'lcg-gm-form' },
            h(
              'label',
              { className: 'lcg-gm-field' },
              tt('gmStonesLabel'),
              h('input', {
                className: 'lcg-input',
                inputMode: 'numeric',
                value: gmForm.stones,
                placeholder: view ? String(view.stones) : '',
                onChange: (event) => setGmForm({ ...gmForm, stones: event.target.value }),
              }),
            ),
            h(
              'label',
              { className: 'lcg-gm-field' },
              tt('gmXpLabel'),
              h('input', {
                className: 'lcg-input',
                inputMode: 'numeric',
                value: gmForm.xp,
                placeholder: view ? String(view.xp) : '',
                onChange: (event) => setGmForm({ ...gmForm, xp: event.target.value }),
              }),
            ),
            h(
              'label',
              { className: 'lcg-gm-field' },
              tt('gmPlotsLabel'),
              h('input', {
                className: 'lcg-input',
                inputMode: 'numeric',
                value: gmForm.unlocked,
                placeholder: view ? String(view.unlocked) : '',
                onChange: (event) => setGmForm({ ...gmForm, unlocked: event.target.value }),
              }),
            ),
            h(
              'label',
              { className: 'lcg-gm-field' },
              tt('gmMinutesLabel'),
              h('input', {
                className: 'lcg-input',
                inputMode: 'numeric',
                value: gmForm.minutes,
                placeholder: '0',
                onChange: (event) => setGmForm({ ...gmForm, minutes: event.target.value }),
              }),
            ),
            h(
              'label',
              { className: 'lcg-gm-field' },
              tt('gmNameLabel'),
              h('input', {
                className: 'lcg-input',
                style: { width: '88px' },
                value: gmForm.name,
                placeholder: view ? view.name : '',
                onChange: (event) => setGmForm({ ...gmForm, name: event.target.value }),
              }),
            ),
          ),
          h(
            'div',
            { className: 'lcg-actions' },
            h('button', { type: 'button', className: 'lcg-btn is-primary', onClick: applyGm }, tt('gmApply')),
          ),
          h(
            'div',
            { className: 'lcg-actions' },
            h(
              'button',
              { type: 'button', className: 'lcg-btn', onClick: () => act({ action: 'gm', op: 'ripenAll' }) },
              tt('gmRipen'),
            ),
            h(
              'button',
              { type: 'button', className: 'lcg-btn', onClick: () => act({ action: 'gm', op: 'advance', minutes: 30 }) },
              tt('gmAdvance'),
            ),
            h(
              'button',
              { type: 'button', className: 'lcg-btn', onClick: () => act({ action: 'gm', op: 'stones', amount: 1000 }) },
              tt('gmStones'),
            ),
          ),
          )
        }

        const nextText = view
          ? view.nextXp === null
            ? tt('maxRealm')
            : tt('nextStage', { name: view.nextStageName || '', n: Math.max(0, view.nextXp - view.xp) })
          : tt('loading')
        const planted = plots.filter((plot) => plot.unlocked && plot.crop)
        const clockPlot = planted.find((plot) => plot.id === clockId) || planted.find((plot) => plot.focus) || planted[0]
        const liveReadyCount = planted.filter((plot) => plot.ready || plot.remainingMs <= drift).length
        const clockReady = Boolean(clockPlot && (clockPlot.ready || clockPlot.remainingMs <= drift))
        const stepClock = (direction) => {
          const index = planted.indexOf(clockPlot)
          if (planted.length) setClockId(planted[(index + direction + planted.length) % planted.length].id)
          setFocused(null)
        }
        const clock = h('div', { className: 'lcg-clock' },
          clockPlot ? h('div', { className: 'lcg-clock-plant', 'data-clock-plot': clockPlot.id },
            h('div', { className: 'lcg-clock-caption' }, clockPlot.cropName, ' · ', tt(clockPlot.focus ? 'focusGrowing' : 'ordinaryGrowing')),
            h('button', {
              type: 'button', className: 'lcg-clock-face',
              style: { '--clock-progress': Math.round(liveOf(clockPlot) * 100) + '%' },
              'aria-label': clockPlot.cropName + ' · ' + (clockReady ? tt('ready') : timeOf(clockPlot)),
              onClick: (event) => setFocused(anchorFor(clockPlot, event)),
            }, h('span', { className: 'lcg-clock-sprite' }, h(Crop, { tone: clockPlot.crop, stage: stageOf(liveOf(clockPlot), clockReady) }))),
            h('strong', { className: 'lcg-clock-time' }, clockReady ? tt('ready') : timeOf(clockPlot)),
            h('span', { className: 'lcg-clock-caption' }, clockPlot.id.replace(/^p/, '#'), ' · ', tt('clockDuration'), ' ', growText(clockPlot.growMs)),
            clockReady
              ? h('button', { type: 'button', className: 'lcg-btn is-primary', 'aria-label': tt('clockHarvest'), onClick: () => { setFocused(null); return act({ action: 'harvest', plotId: clockPlot.id }) } }, tt('harvest'))
              : h('span', { className: 'lcg-clock-caption' }, tt('offline')),
          ) : h('div', { className: 'lcg-clock-empty' }, h(Crop, { tone: selected, stage: 0 }), h('p', null, tt('clockEmpty'))),
          h('button', { type: 'button', className: 'lcg-btn', 'data-entrance': 'basket', 'aria-haspopup': 'dialog', onClick: () => visit('bag') }, h(Icon, { name: 'basket' }), tt('bag')),
          h('div', { className: 'lcg-clock-nav' },
            h('button', { type: 'button', className: 'lcg-btn', disabled: planted.length < 2, 'aria-label': tt('prevPlot'), onClick: () => stepClock(-1) }, '‹ ', tt('prevPlot')),
            h('button', { type: 'button', className: 'lcg-btn', 'aria-label': tt('overview'), onClick: () => switchLayout('garden') }, tt('overview'), ' · ', view ? view.unlocked : 0),
            h('button', { type: 'button', className: 'lcg-btn', disabled: planted.length < 2, 'aria-label': tt('nextPlot'), onClick: () => stepClock(1) }, tt('nextPlot'), ' ›'),
          ),
          h('button', { type: 'button', className: 'lcg-clock-summary', onClick: () => switchLayout('garden') }, tt('orbReady', { n: liveReadyCount }), ' · ', tt('overview')),
        )
        const seeds = h(
                  'div',
                  { id: 'lcg-seed-drawer', className: 'lcg-seedbar', role: 'group', 'aria-label': tt('sowing') },
                  catalog.map((item) => {
                    const held = bag.seeds[item.id] || 0
                    const on = item.id === selected
                    return h(
                      'button',
                      {
                        key: 'sow-' + item.id,
                        type: 'button',
                        className: 'lcg-seedopt' + (on ? ' is-on' : '') + (held < 1 ? ' is-empty' : ''),
                        'aria-pressed': on ? 'true' : 'false',
                        title: held < 1 ? tt('autoSeed', { name: item.name, n: item.seedPrice }) : tt('selected', { name: item.name }),
                        onClick: () => { setSelected(item.id); setSeedsOpen(false) },
                      },
                      h(Crop, { tone: item.id, stage: 1 }),
                      growText(item.growMs) + ' · ' + item.name,
                      h('i', null, '×' + held),
                    )
                  }),
                )
        const closeDialog = () => { setSeedsOpen(false); setPanelView('field') }
        function renderDialog(kind, body) {
          const title = tt(kind === 'seeds' ? 'seedChest' : kind === 'bag' ? 'bag' : 'shopTitle')
          return h('div', {
            className: 'lcg-modal',
            onPointerDown: (event) => { if (event.target === event.currentTarget) closeDialog() },
            onKeyDown: (event) => {
              if (event.key !== 'Tab') return
              const controls = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]'))
              const first = controls[0], last = controls[controls.length - 1]
              if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus() }
              else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus() }
            },
          }, h('section', { className: 'lcg-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
            'aria-labelledby': 'lcg-dialog-title', 'aria-describedby': 'lcg-dialog-description', 'data-garden-dialog': kind },
            h('header', { className: 'lcg-dialog-head' },
              h('div', { className: 'lcg-dialog-heading' },
                h('h2', { id: 'lcg-dialog-title', className: 'lcg-dialog-title' }, title),
                h('p', { id: 'lcg-dialog-description', className: 'lcg-dialog-subtitle' }, tt(kind === 'seeds' ? 'seedSubtitle' : kind === 'bag' ? 'bagSubtitle' : 'shopSubtitle'))),
              h('button', { type: 'button', className: 'lcg-btn lcg-dialog-back', 'aria-label': tt('dialogBack'), onClick: closeDialog }, h(Icon, { name: 'back' }), tt('dialogBack'))),
            h('div', { className: 'lcg-dialog-body' }, body)))
        }
        const focusedLeft = focusedPlot ? Math.max(0, focusedPlot.remainingMs - drift) : 0
        const focusedProgress = focusedPlot
          ? Math.min(1, (focusedPlot.progress || 0) + (focusedPlot.growMs ? drift / focusedPlot.growMs : 0))
          : 0
        /** Arming expires on the panel clock, so the label falls back without another click. */
        const uprootArmed = Boolean(
          focusedPlot && uprootArm && uprootArm.id === focusedPlot.id && uprootArm.until > now,
        )

        return h(
          'div',
          { className: rootClass, style: { left: ui.left + 'px', top: ui.top + 'px' } },
          styleTag,
          harvestFlights.length ? h('div', { className: 'lcg-harvest-effects', 'aria-hidden': 'true' },
            harvestFlights.map(flight => h('span', {
              key: 'fly-' + flight.id, className: 'lcg-harvest-flight', 'aria-hidden': 'true',
              style: { left: flight.source.x + 'px', top: flight.source.y + 'px', '--dx': flight.destination.x - flight.source.x + 'px', '--dy': flight.destination.y - flight.source.y + 'px', '--delay': flight.delay + 'ms' },
            }, h(Crop, { tone: flight.crop, stage: 3 }))),
            harvestFlights.map(flight => h('span', { key: 'land-' + flight.id, className: 'lcg-harvest-arrival', style: { left: flight.destination.x + 'px', top: flight.destination.y + 'px', '--delay': flight.delay + 'ms' },
              onAnimationEnd: event => { if (event.target === event.currentTarget) setHarvestFlights(list => list.filter(item => item.id !== flight.id)) },
            })),
          ) : null,
          h(
            'div',
            {
              className: 'lcg-panel',
              'data-layout': clockOn ? 'clock' : 'garden',
              ref: panelRef,
              style: { position: 'absolute', left: 0, top: 0 },
              role: 'dialog',
              'aria-label': tt('title'),
              // The plot popover holds screen coordinates, so scrolling the panel would strand it.
              onScroll: () => { setFocused(null); clearHarvest() },
            },
            h(
              'div',
              { className: 'lcg-head', onPointerDown: startDrag, onPointerMove: moveDrag, onPointerUp: endDrag },
              h('span', { className: 'lcg-seal', 'aria-hidden': 'true' }, view ? view.stageName.slice(0, 2) : tt('sealIdle')),
              h('div', { className: 'lcg-title' },
                h('strong', null, view ? view.name : tt('title')),
                h('span', { className: 'lcg-sub' },
                  view ? view.sect + ' · ' + view.stageName : tt('sect'),
                  online ? '' : ' · 离线',
                ),
              ),
              h('span', { className: 'lcg-stones', title: tt('stones') },
                // The key changes with each float, remounting the gem so its flash replays.
                h('span', { key: 'gem' + latestFloat, className: latestFloat ? 'lcg-gem is-gain' : 'lcg-gem', 'aria-hidden': 'true' }),
                stones,
                ...floatNodes('panel'),
              ),
              h('button', { type: 'button', className: 'lcg-iconbtn', title: tt('collapse'), 'aria-label': tt('collapse'), onPointerDown: (event) => event.stopPropagation(), onClick: fold }, '–'),
            ),
            clockOn ? null : h('div', { className: 'lcg-xp' },
              h('div', { className: 'lcg-xp-head' },
                h('span', null, tt('xp') + ' ', h('b', null, view ? view.xp.toLocaleString() : '—')),
                h('span', null, nextText),
              ),
              h('div', { className: 'lcg-bar' }, h('i', { style: { width: Math.round(bar * 100) + '%' } })),
            ),
            clockOn ? clock : field,
            // 种匣 and 专注 share one split bar; 灵雨 / 一键收成 sit below as two wide actions.
            !clockOn
              ? h('div', { className: 'lcg-plant-controls' },
                  h('div', { className: 'lcg-seedrow' },
                    h('button', { type: 'button', className: 'lcg-chest', 'aria-label': tt('seedChest'), 'aria-haspopup': 'dialog', 'aria-controls': 'lcg-seed-drawer', onClick: () => { setFocused(null); setSeedsOpen((value) => !value) } },
                      h(Crop, { tone: selected, stage: 1 }),
                      h('span', null, h('strong', null, tt('seedChest'), ' · ', (catalog.find((item) => item.id === selected) || {}).name || ''),
                        h('small', null, growText((catalog.find((item) => item.id === selected) || {}).growMs || 300_000), ' · ×', bag.seeds[selected] || 0)),
                      h('span', { 'aria-hidden': 'true' }, '›'),
                    ),
                    h('button', { type: 'button', className: 'lcg-focus-chip' + (focusMode ? ' is-on' : ''), role: 'switch', 'aria-label': tt('focusMode'), title: tt(focusMode ? 'focusHint' : 'ordinaryGrowing'), 'aria-checked': focusMode, onClick: () => setFocusMode((value) => !value) },
                      h(Icon, { name: 'sprout', plain: true }),
                      tt(focusMode ? 'focusMode' : 'ordinaryPlain'),
                    ),
                  ),
                  h('div', { className: 'lcg-action-row' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'lcg-btn',
                        disabled: !view || view.stones < prices.rain || view.rainReadyInMs > 0,
                        onClick: () => act({ action: 'rain' }),
                      },
                      h(Icon, { name: 'drop', plain: true }),
                      view && view.rainReadyInMs > 0
                        ? tt('rainWait', { n: Math.ceil(view.rainReadyInMs / 60000) })
                        : [tt('rain'), h(Cost, { key: 'cost', n: prices.rain })],
                    ),
                    h('button', { type: 'button', className: 'lcg-btn', 'aria-label': tt('harvestAll'), disabled: liveReadyCount === 0, onClick: () => { setFocused(null); return act({ action: 'harvestAll' }) } }, h(Icon, { name: 'basket', plain: true }), tt('harvestAll')),
                  ),
                )
              : null,
            view
              ? h(
                  'button',
                  { type: 'button', className: 'lcg-journal-entry', 'aria-haspopup': 'dialog', onClick: () => setJournalOpen(true) },
                  h(Icon, { name: 'book' }),
                  h('span', null, tt('journal')),
                  h(Icon, { name: 'chevron' }),
                )
              : view
                ? null
                : h('p', { className: 'lcg-hint' }, tt('loading')),
          ),
          dialogOpen ? renderDialog(seedsOpen ? 'seeds' : panelView, seedsOpen ? seeds : shop) : null,
          // A plot's actions float in their own layer right under the clicked tile, so opening them never reflows the garden.
          focusedPlot && panelView === 'field'
            ? h(
                'div',
                {
                  key: 'plotpop-' + focusedPlot.id,
                  className: 'lcg-plotbar lcg-plotpop' + (focused && focused.above ? ' is-above' : ''),
                  style: { left: focused.x + 'px', top: focused.y + 'px' },
                  role: 'dialog',
                  'aria-label': tt('plotActions', { name: focusedPlot.cropName, time: formatRemaining(focusedLeft) }),
                },
                h(
                  'div',
                  { className: 'lcg-plotbar-head' },
                  h('span', { className: 'lcg-card-ico' }, h(Crop, { tone: focusedPlot.crop, stage: stageOf(focusedProgress, false) })),
                  h('span', { className: 'lcg-plotbar-label' }, tt('plotActions', { name: focusedPlot.cropName, time: formatRemaining(focusedLeft) })),
                  h('div', { className: 'lcg-bar' }, h('i', { style: { width: Math.round(focusedProgress * 100) + '%' } })),
                ),
                h(
                  'div',
                  { className: 'lcg-plot-actions' },
                  h(
                    'button',
                    { type: 'button', className: 'lcg-btn', disabled: focusedPlot.fertilized, onClick: () => act({ action: 'fertilize', plotId: focusedPlot.id }) },
                    h(Icon, { name: 'leaf' }),
                    focusedPlot.fertilized ? tt('fertilized') : tt('fertilizer', { n: prices.fertilizer }),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'lcg-btn', disabled: focusedPlot.focus, title: focusedPlot.focus ? tt('focusHint') : undefined, onClick: () => act({ action: 'ripen', plotId: focusedPlot.id }) },
                    h(Icon, { name: 'bolt' }),
                    tt('ripen', { n: Math.max(prices.ripenMin, Math.ceil(focusedLeft / 60000) * prices.ripenPerMin) }),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'lcg-btn' + (uprootArmed ? ' is-danger' : ''),
                      title: tt('uprootHint'),
                      onClick: () => {
                        if (uprootArmed) {
                          setUprootArm(null)
                          act({ action: 'uproot', plotId: focusedPlot.id })
                          return
                        }
                        setUprootArm({ id: focusedPlot.id, until: Date.now() + UPROOT_ARM_MS })
                      },
                    },
                    h(Icon, { name: 'uproot' }),
                    uprootArmed ? tt('uprootConfirm') : tt('uproot'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'lcg-btn', title: tt('closePlot'), 'aria-label': tt('closePlot'), onClick: () => setFocused(null) },
                    h(Icon, { name: 'close' }),
                  ),
                ),
              )
            : null,
          // A sibling of the panel, not a child: it neither scrolls with the panel nor pushes anything down.
          toast
            ? h('p', { key: 'toast-' + toast.id, className: 'lcg-toast' + (toast.error ? ' is-error' : ''), role: 'status' }, toast.text)
            : null,
          journalOpen && view
            ? h(
                'div',
                {
                  className: 'lcg-modal',
                  onPointerDown: (event) => {
                    if (event.target === event.currentTarget) setJournalOpen(false)
                  },
                },
                h(
                  'div',
                  { className: 'lcg-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': tt('journal') },
                  h(
                    'div',
                    { className: 'lcg-dialog-head' },
                    h('span', { className: 'lcg-section', style: { flex: 1 } }, tt('journal')),
                    h(
                      'button',
                      { type: 'button', className: 'lcg-iconbtn', title: tt('journalClose'), 'aria-label': tt('journalClose'), onClick: () => setJournalOpen(false) },
                      h(Icon, { name: 'close' }),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'lcg-dialog-body' },
                    view.quip
                      ? h('div', { className: 'lcg-quote' }, h('span', { className: 'lcg-avatar', 'aria-hidden': 'true' }, h(Icon, { name: 'spirit' })), h('span', null, view.quip))
                      : null,
                    h('span', { className: 'lcg-stat' }, h(Icon, { name: 'coin' }), tt('tokensLine', { t: (view.tokens || 0).toLocaleString(), r: view.rate })),
                    h(
                      'ul',
                      { className: 'lcg-log' },
                      view.journal
                        .slice()
                        .reverse()
                        .map((entry, index) =>
                          h('li', { key: String(entry.t) + index }, h('span', null, entry.text), h('time', null, ageOf(entry.t, now, tt))),
                        ),
                    ),
                  ),
                ),
              )
            : null,
        )
      }

      /** Settings row: the only place that can hide or restore the garden. */
      function GardenSettings() {
        const shown = useVisible()
        useArt()
        useBg()
        const [resetArmed, setResetArmed] = React.useState(false)
        const [resetBusy, setResetBusy] = React.useState(false)
        const [resetStatus, setResetStatus] = React.useState(null)
        const resetLock = React.useRef(false)
        const resetSave = async () => {
          if (resetLock.current) return
          resetLock.current = true; setResetBusy(true); setResetStatus(null)
          try {
            const response = await fetch(API + '/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reset', confirmation: 'RESET' }) })
            const body = await response.json()
            if (!body?.ok || !body.state) {
              setResetStatus({ error: true, text: body?.message || tt('resetFailed') })
              return
            }
            resets.revision++
            for (const listener of resets.listeners) listener(body.state)
            setResetArmed(false); setResetStatus({ error: false, text: tt('resetSuccess') })
          } catch {
            setResetStatus({ error: true, text: tt('resetFailed') })
          } finally {
            resetLock.current = false; setResetBusy(false)
          }
        }
        React.useEffect(() => {
          loadArt()
        }, [])
        const themes = bgThemes()
        const themeId = bgCurrent()
        return h(
          'div',
          { className: 'lcg-settings' },
          h(
            'div',
            { className: 'lcg-settings-row' },
            h(
              'div',
              { className: 'lcg-shop-name' },
              h('strong', null, tt('settingsTitle')),
              h('span', { className: 'lcg-shop-meta' }, tt('settingsHint')),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'lcg-btn' + (shown ? ' is-primary' : ''),
                'aria-pressed': shown ? 'true' : 'false',
                onClick: () => setVisible(!shown),
              },
              shown ? tt('settingsShown') : tt('settingsHidden'),
            ),
          ),
          // Backdrop picker: only meaningful once the sprite manifest (and so the theme list) is loaded.
          themes.length > 0
            ? h(
                'div',
                { className: 'lcg-bgpick' },
                h('strong', null, tt('bgLabel')),
                h(
                  'div',
                  { className: 'lcg-bgs', role: 'group', 'aria-label': tt('bgLabel') },
                  themes.map((id) =>
                    h(
                      'button',
                      {
                        key: 'bg-' + id,
                        type: 'button',
                        className: 'lcg-btn' + (id === themeId ? ' is-primary' : ''),
                        'aria-pressed': id === themeId ? 'true' : 'false',
                        onClick: () => setBg(id),
                      },
                      bgName(id),
                    ),
                  ),
                ),
                h('span', { className: 'lcg-shop-meta' }, tt('bgHint')),
              )
            : null,
          h('div', { className: 'lcg-reset' },
            h('strong', null, tt('resetSave')),
            h('p', { className: 'lcg-shop-meta' }, tt('resetHint')),
            resetArmed ? h('div', null,
              h('p', { id: 'lcg-reset-warning' }, tt('resetWarning')),
              h('div', { className: 'lcg-reset-actions' },
                h('button', { type: 'button', className: 'lcg-btn is-danger', 'aria-label': tt('resetConfirm'), 'aria-describedby': 'lcg-reset-warning', disabled: resetBusy, onClick: resetSave }, tt(resetBusy ? 'resetBusy' : 'resetConfirm')),
                h('button', { type: 'button', className: 'lcg-btn', 'aria-label': tt('resetCancel'), disabled: resetBusy, onClick: () => { setResetArmed(false); setResetStatus(null) } }, tt('resetCancel')),
              ),
            ) : h('button', { type: 'button', className: 'lcg-btn is-danger', 'aria-label': tt('resetSave'), onClick: () => { setResetArmed(true); setResetStatus(null) } }, tt('resetSave')),
            resetStatus ? h('p', { role: resetStatus.error ? 'alert' : 'status' }, resetStatus.text) : null,
          ),
        )
      }

      return { Garden, GardenSettings }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = ctx.get('locale')
        let translate = null
        const refreshTranslation = () => {
          try {
            translate = locale && typeof locale.bind === 'function' ? locale.bind('lingcaoGarden') : null
          } catch {
            translate = null
          }
        }
        if (locale && typeof locale.register === 'function') {
          ctx.effect(() => locale.register('lingcaoGarden', { en: EN, zh: ZH }))
        }
        refreshTranslation()
        if (locale) ctx.effect(() => ctx.on('locale/change', refreshTranslation))

        const t = (key) => {
          try {
            const value = translate ? translate(key) : undefined
            if (typeof value === 'string' && value) return value
          } catch {
            // Missing dictionary entry: fall back to the built-in Chinese copy.
          }
          return Object.prototype.hasOwnProperty.call(ZH, key) ? ZH[key] : key
        }

        const { Garden, GardenSettings } = makeComponents(t)
        ctx.effect(() =>
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({ name: 'shell.overlay', id: 'lingcao-garden', order: 60 }, Garden),
          ),
        )
        ctx.effect(() =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: 'lingcao-garden', order: 80, label: () => t('settingsTitle') },
              GardenSettings,
            ),
          ),
        )
      },
    }
  },
})
