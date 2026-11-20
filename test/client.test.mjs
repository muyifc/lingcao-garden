/** Client-half smoke test: module loads, registers into shell.overlay, renders every mode without throwing. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { applyAction, buildArt, defaultState, stateView } from '../index.js'

/** Garden hook slots, in declaration order: ui, view, toast, selected, panelView, ... */
const SLOT_VIEW = 1
const SLOT_PANEL = 4
/** ui, view, toast, selected, panelView, focused, journalOpen, gmForm, uprootArm, visible(2), now, online, 3 refs, panelRef, uiRef → floats. */
const SLOT_FLOATS = 17

/** Minimal React stand-in: stable hook slots, setState writes through, effects run only on `flushEffects`. */
function makeFakeReact() {
  const hooks = []
  let index = 0
  let effects = []
  return {
    reset() {
      index = 0
      effects = []
    },
    /** Pre-fill one hook slot before the first render. */
    seed(slot, value) {
      hooks[slot] = value
    },
    /** Read one hook slot (state value or ref). */
    peek(slot) {
      return hooks[slot]
    },
    /** Run the effects recorded by the last render, in order. */
    flushEffects() {
      for (const effect of effects) effect()
    },
    React: {
      createElement(type, props, ...children) {
        return { type, props: { ...(props || {}), children: children.length ? children : undefined } }
      },
      useState(initial) {
        const slot = index++
        if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial
        return [
          hooks[slot],
          (next) => {
            hooks[slot] = typeof next === 'function' ? next(hooks[slot]) : next
          },
        ]
      },
      useRef(initial) {
        const slot = index++
        if (!(slot in hooks)) hooks[slot] = { current: initial }
        return hooks[slot]
      },
      useEffect(fn) {
        index += 1
        effects.push(fn)
      },
      useCallback(fn) {
        index += 1
        return fn
      },
    },
  }
}

/** An in-memory localStorage seeded with one document. */
function makeStorage(seed, extra) {
  const map = new Map()
  if (seed) map.set('dsh.lingcao-garden.ui.v2', JSON.stringify(seed))
  for (const [key, value] of Object.entries(extra || {})) map.set(key, value)
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

/** Install a fake window and load one fresh copy of the client bundle. */
async function loadClient(storageSeed, storageExtra) {
  const fake = makeFakeReact()
  const loaded = []
  globalThis.window = {
    innerWidth: 1440,
    innerHeight: 900,
    localStorage: makeStorage(storageSeed, storageExtra),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    __ModuleLoader__: {
      load(config) {
        loaded.push(config)
      },
    },
  }
  await import('../client.js?smoke=' + Math.random())
  const plugin = loaded[0].factory(() => fake.React)

  const registrations = []
  const slots = []
  const dictionaries = []
  const ctx = {
    effect(fn) {
      fn()
      return () => {}
    },
    on() {
      return () => {}
    },
    get(name) {
      if (name === 'locale') {
        return {
          register(namespace, dict) {
            dictionaries.push([namespace, dict])
            return () => {}
          },
          bind() {
            return (key) => key
          },
        }
      }
      return undefined
    },
    slots: {
      inject(slot, install) {
        slots.push(slot)
        return install()
      },
      register(options, component) {
        registrations.push({ options, component, slot: slots[slots.length - 1] })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  return { fake, plugin, registrations, slots, dictionaries, loaded }
}

test('the bundle registers one overlay occupant with its dictionaries', async () => {
  const { registrations, slots, dictionaries, loaded, plugin } = await loadClient()
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, '@local/lingcao-garden')
  assert.deepEqual(plugin.inject, ['slots'])
  assert.equal(dictionaries[0][0], 'lingcaoGarden')
  assert.ok(dictionaries[0][1].zh && dictionaries[0][1].en)
  assert.deepEqual(slots.sort(), ['settings.section', 'shell.overlay'])
  const overlay = registrations.find((entry) => entry.slot === 'shell.overlay')
  const settings = registrations.find((entry) => entry.slot === 'settings.section')
  assert.ok(overlay && settings)
  assert.deepEqual(overlay.options, { name: 'shell.overlay', id: 'lingcao-garden', order: 60 })
  assert.equal(settings.options.name, 'settings.section')
})

test('the folded orb ships its own stylesheet', async () => {
  const { fake, registrations } = await loadClient()
  fake.reset()
  const tree = registrations[0].component()
  assert.equal(tree.type, 'div')
  assert.match(tree.props.className, /lcg-root/)
  const kids = Array.isArray(tree.props.children) ? tree.props.children : [tree.props.children]
  // The stylesheet must ship in the folded mode too, or the orb renders unstyled.
  assert.equal(kids[0].type, 'style')
  assert.match(kids[0].props.dangerouslySetInnerHTML.__html, /\.lcg-orb\{/)
  const orb = kids[1]
  assert.equal(orb.type, 'button')
  assert.match(orb.props.className, /lcg-orb/)
  // The orb itself is the drag surface: pointer handlers must be wired.
  assert.equal(typeof orb.props.onPointerDown, 'function')
  assert.equal(typeof orb.props.onPointerMove, 'function')
  assert.equal(typeof orb.props.onPointerUp, 'function')
})

test('a legacy hidden state falls back to the folded orb', async () => {
  const { fake, registrations } = await loadClient({ mode: 'dot', left: 900, top: 500 })
  fake.reset()
  const tree = registrations[0].component()
  assert.equal(tree.type, 'div')
  assert.match(tree.props.className, /lcg-root/)
  const kids = Array.isArray(tree.props.children) ? tree.props.children : [tree.props.children]
  assert.equal(kids[0].type, 'style')
  const orb = kids[1]
  assert.equal(orb.type, 'button')
  assert.match(orb.props.className, /lcg-orb/)
})

test('the expanded panel is an isometric field with a shop entry at the bottom', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.reset()
  const tree = registrations[0].component()
  const html = JSON.stringify(tree, (key, value) => (typeof value === 'function' ? '[fn]' : value))
  assert.match(html, /lcg-field-wrap/)
  assert.match(html, /lcg-field/)
  assert.match(html, /shopEntry/)
  assert.match(html, /lcg-action-row/)
  assert.match(html, /lcg-seedrow/)
  // The floating layer must never trap pointer events outside the panel itself.
  assert.match(html, /pointer-events:none/)
})


test('the seed bar splits 种匣 and 专注 into sibling buttons', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.reset()
  const tree = registrations[0].component()
  const seedrow = findNode(tree, (node) => node.props.className === 'lcg-seedrow')
  assert.ok(seedrow)
  const [chest, chip] = seedrow.props.children.filter((child) => child && child.props && child.props.type === 'button')
  assert.match(chest.props.className, /lcg-chest/)
  assert.match(chip.props.className, /lcg-focus-chip/)
  assert.equal(chip.props.role, 'switch')
  assert.equal(chip.props['aria-checked'], true)
  // The focus switch must be a sibling, never a button nested inside the chest button.
  assert.equal(findNode(chest, (node) => node.props.role === 'switch'), null)
  const icon = chip.props.children[0]
  assert.equal(typeof icon.type, 'function', 'the focus chip leads with an icon')
  const svg = icon.type({ ...icon.props, plain: true })
  assert.equal(svg.type, 'svg')
  assert.equal([chip.props.children].flat(Infinity).filter((child) => typeof child === 'string').length, 1)
  chip.props.onClick()
  fake.reset()
  const toggled = findNode(registrations[0].component(), (node) => typeof node.props.className === 'string' && node.props.className.startsWith('lcg-focus-chip'))
  assert.equal(toggled.props['aria-checked'], false)
  assert.ok([toggled.props.children].flat(Infinity).some((child) => /ordinaryPlain|普通种植/.test(String(child))))

  fake.reset()
  const row = findNode(registrations[0].component(), (node) => node.props.className === 'lcg-action-row')
  assert.ok(row)
  const buttons = row.props.children.filter((child) => child && child.props && child.props.type === 'button')
  assert.equal(buttons.length, 2, 'only 灵雨 and 一键收成 remain in the utility row')
  assert.equal(findNode(row, (node) => node.props['aria-label'] === 'enterClock'), null, 'the clock left the utility row')
  for (const button of buttons) {
    assert.match(button.props.className, /lcg-btn/)
    const buttonIcon = button.props.children[0]
    assert.equal(typeof buttonIcon.type, 'function', 'every utility button keeps an icon')
    assert.equal(buttonIcon.type({ ...buttonIcon.props, plain: true }).type, 'svg')
    assert.equal([button.props.children].flat(Infinity).filter((child) => typeof child === 'string').length, 1)
  }
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.ok(src.includes('.lcg-action-row>.lcg-btn{flex:1;min-width:0;box-sizing:border-box;height:30px;padding:0 8px;justify-content:center;gap:4px;font-size:11px;line-height:16px;white-space:nowrap}'))
  assert.ok(src.includes('.lcg-seedrow .lcg-chest{flex:1;min-width:0;width:auto;border:0;border-radius:0;background:transparent;box-shadow:none;padding:6px 10px 6px 12px}'))
  assert.ok(src.includes('.lcg-focus-chip{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:0 10px;border:0;border-left:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:16px;white-space:nowrap;cursor:pointer}'))
})

test('the garden scene has shop, clock and basket entrances in that order', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.reset()
  const gates = findNode(registrations[0].component(), (node) => node.props.className === 'lcg-scene-gates')
  assert.ok(gates)
  const signs = gates.props.children.filter((child) => child && child.props && child.props.type === 'button')
  assert.deepEqual(signs.map((sign) => sign.props['data-entrance']), ['shop', 'clock', 'basket'])
  assert.equal(signs[1].props['aria-label'], 'enterClock')
  assert.equal(signs[1].props.title, 'enterClock')
  const label = findNode(signs[1], (node) => node.props.className === 'lcg-entrance-label')
  assert.deepEqual([label.props.children].flat(Infinity), ['enterClock'])
})

test('the settings row toggles the garden visibility', async () => {
  const { fake, registrations } = await loadClient()
  const settings = registrations.find((entry) => entry.slot === 'settings.section')
  assert.ok(settings)
  fake.reset()
  const row = settings.component()
  assert.equal(row.type, 'div')
  assert.match(row.props.className, /lcg-settings/)
  const html = JSON.stringify(row, (key, value) => (typeof value === 'function' ? '[fn]' : value))
  assert.match(html, /settingsShown/)
})

test('settings reset requires a second confirmation, supports cancel and guards pending requests', async () => {
  const { fake, registrations } = await loadClient()
  const settings = registrations.find(entry => entry.slot === 'settings.section')
  const render = () => { fake.reset(); return settings.component() }
  const button = key => findNode(render(), node => node.props['aria-label'] === key)
  const previous = globalThis.fetch
  const calls = []; let resolve
  globalThis.fetch = (_url, options) => { calls.push(JSON.parse(options.body)); return new Promise(done => { resolve = done }) }
  try {
    button('resetSave').props.onClick()
    assert.equal(calls.length, 0)
    assert.ok(button('resetConfirm'))
    button('resetCancel').props.onClick()
    assert.equal(button('resetConfirm'), null)
    button('resetSave').props.onClick()
    const confirm = button('resetConfirm')
    const pending = confirm.props.onClick(); confirm.props.onClick()
    assert.deepEqual(calls, [{ action: 'reset', confirmation: 'RESET' }])
    assert.equal(button('resetConfirm').props.disabled, true)
    resolve({ json: async () => ({ ok: true, state: stateView(defaultState(Date.now()), Date.now()) }) })
    await pending
    assert.equal(button('resetConfirm'), null)
    assert.match(dump(render()), /resetSuccess/)
  } finally { globalThis.fetch = previous }
})

test('settings reset shows host errors and allows a deliberate retry', async () => {
  const { fake, registrations } = await loadClient()
  const settings = registrations.find(entry => entry.slot === 'settings.section')
  const render = () => { fake.reset(); return settings.component() }
  const button = key => findNode(render(), node => node.props['aria-label'] === key)
  const previous = globalThis.fetch
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, message: '原进度已保留' }) })
  try {
    button('resetSave').props.onClick()
    await button('resetConfirm').props.onClick()
    assert.match(dump(render()), /原进度已保留/)
    assert.equal(button('resetConfirm').props.disabled, false)
    globalThis.fetch = async () => { throw new Error('offline') }
    await button('resetConfirm').props.onClick()
    assert.match(dump(render()), /resetFailed/)
    assert.equal(button('resetConfirm').props.disabled, false)
  } finally { globalThis.fetch = previous }
})

test('a saved hidden preference renders no garden at all', async () => {
  const { fake, registrations } = await loadClient(null, { 'dsh.lingcao-garden.visible': '0' })
  fake.reset()
  const overlay = registrations.find((entry) => entry.slot === 'shell.overlay')
  assert.equal(overlay.component(), null)
})

/** Serialize a render tree for substring assertions. */
const dump = (tree) => JSON.stringify(tree, (key, value) => (typeof value === 'function' ? '[fn]' : value))

/** A real host read model with one ripe plot. */
function ripeView(gm) {
  const now = 1_732_000_000_000
  const state = defaultState(now)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, now)
  return stateView(state, now + 15 * 60 * 1000, { gm })
}

test('the orb shows how many plots are ready to harvest', async () => {
  const { fake, registrations } = await loadClient()
  fake.seed(SLOT_VIEW, ripeView(false))
  fake.reset()
  const html = dump(registrations[0].component())
  assert.match(html, /lcg-orb-ready/)
  assert.match(html, /orbReady/)
})

test('the GM tools only render when the host enables them', async () => {
  for (const gm of [false, true]) {
    const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
    fake.seed(SLOT_VIEW, ripeView(gm))
    fake.seed(SLOT_PANEL, 'shop')
    fake.reset()
    const html = dump(registrations[0].component())
    assert.doesNotMatch(html, /arrayBuy|arrayOwned|buyArray/)
    if (gm) assert.match(html, /gmTitle/)
    else assert.doesNotMatch(html, /gmTitle/)
  }
})

test('an income float renders on the orb and in the panel header, decorative only', async () => {
  for (const mode of ['orb', 'open']) {
    const { fake, registrations } = await loadClient({ mode, left: 100, top: 100 })
    fake.seed(SLOT_VIEW, ripeView(false))
    fake.seed(SLOT_FLOATS, [{ id: 1, amount: 12 }])
    fake.reset()
    const html = dump(registrations[0].component())
    assert.match(html, new RegExp('lcg-float lcg-float-' + (mode === 'orb' ? 'orb' : 'panel')))
    assert.match(html, /"\+12"/)
    // The panel's gem flashes with each float; the orb has no gem.
    if (mode === 'open') assert.match(html, /"className":"lcg-gem is-gain"/)
  }
})

test('no float renders without income, and the float respects reduced motion', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.seed(SLOT_VIEW, ripeView(false))
  fake.reset()
  const html = dump(registrations[0].component())
  assert.doesNotMatch(html, /lcg-float lcg-float-/)
  assert.doesNotMatch(html, /"className":"lcg-gem is-gain"/)
  // Motion only ever lives inside the no-preference media query.
  assert.doesNotMatch(html.match(/\.lcg-float\{[^}]*\}/)[0], /animation/)
  assert.match(html, /prefers-reduced-motion:no-preference\)\{\.lcg-float\{animation/)
})

/** A real read model whose lifetime `earned` counter is set to `earned`. */
function earnedView(earned) {
  return { ...ripeView(false), earned }
}

/** Render once and run that render's effects, like one React commit. */
function commit(fake, registrations) {
  fake.reset()
  registrations[0].component()
  fake.flushEffects()
}

test('income floats: first snapshot is a baseline, later growth floats once', async () => {
  globalThis.fetch = () => Promise.reject(new Error('offline in tests'))
  const { fake, registrations } = await loadClient()
  fake.seed(SLOT_VIEW, earnedView(10))
  commit(fake, registrations)
  assert.deepEqual(fake.peek(SLOT_FLOATS), [], 'reload must not replay history')

  fake.seed(SLOT_VIEW, earnedView(14))
  commit(fake, registrations)
  assert.deepEqual(fake.peek(SLOT_FLOATS), [{ id: 1, amount: 4 }])

  // Same snapshot again (the next poll with no income) adds nothing.
  fake.seed(SLOT_VIEW, earnedView(14))
  commit(fake, registrations)
  assert.equal(fake.peek(SLOT_FLOATS).length, 1)

  // A reset save (counter went down) re-baselines silently, then floats from the new base.
  fake.seed(SLOT_VIEW, earnedView(2))
  commit(fake, registrations)
  assert.equal(fake.peek(SLOT_FLOATS).length, 1)
  fake.seed(SLOT_VIEW, earnedView(5))
  commit(fake, registrations)
  assert.deepEqual(fake.peek(SLOT_FLOATS).map((item) => item.amount), [4, 3])
})

test('income floats stack at most three deep', async () => {
  globalThis.fetch = () => Promise.reject(new Error('offline in tests'))
  const { fake, registrations } = await loadClient()
  fake.seed(SLOT_VIEW, earnedView(0))
  commit(fake, registrations)
  for (let total = 1; total <= 5; total += 1) {
    fake.seed(SLOT_VIEW, earnedView(total))
    commit(fake, registrations)
  }
  const floats = fake.peek(SLOT_FLOATS)
  assert.equal(floats.length, 3)
  assert.deepEqual(floats.map((item) => item.id), [3, 4, 5])
})

test('a view without the counter never floats', async () => {
  globalThis.fetch = () => Promise.reject(new Error('offline in tests'))
  const { fake, registrations } = await loadClient()
  const legacy = ripeView(false)
  delete legacy.earned
  fake.seed(SLOT_VIEW, legacy)
  commit(fake, registrations)
  assert.deepEqual(fake.peek(SLOT_FLOATS), [])
})

test('ready plots glow, and their tags ride a layer above every tile', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.seed(SLOT_VIEW, ripeView(false))
  fake.reset()
  const html = dump(registrations[0].component())
  assert.match(html, /"className":"lcg-tag is-ready"/)
  assert.match(html, /"className":"lcg-crop is-ready"/)
  assert.match(html, /"className":"lcg-glow"/)
  // Front sprites would hide a "可收" tag that lives inside its own tile.
  const lastTile = html.lastIndexOf('"className":"lcg-tile')
  assert.ok(html.indexOf('"className":"lcg-tag') > lastTile, 'tags render after all tiles')
  // Only the slab takes pointer events, so overlapping tile boxes never steal clicks.
  assert.match(html, /\.lcg-tile\{[^}]*pointer-events:none/)
  assert.match(html, /\.lcg-hit\{[^}]*pointer-events:auto/)
})

test('the shop dialog puts its way back on top while the garden journal stays in place', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.seed(SLOT_VIEW, ripeView(false))
  fake.seed(SLOT_PANEL, 'shop')
  fake.reset()
  const tree = registrations[0].component()
  const html = dump(findNode(tree, (node) => node.props['data-garden-dialog'] === 'shop'))
  const back = html.indexOf('dialogBack')
  assert.ok(back > 0 && back < html.indexOf('"className":"lcg-shop"'), 'back button sits above the shop')
  assert.doesNotMatch(html, /"className":"lcg-journal-entry"/)
  assert.match(html, /"className":"lcg-card is-on"/)
  assert.ok(findNode(tree, (node) => node.props.className === 'lcg-journal-entry'))
})

test('every new decoration animation is gated behind no-preference motion', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.seed(SLOT_VIEW, ripeView(false))
  fake.reset()
  const html = dump(registrations[0].component())
  for (const selector of ['\.lcg-glow', '\.lcg-mote', '\.lcg-orb::before', '\.lcg-crop\.is-ready', '\.lcg-orb-ready']) {
    const base = html.match(new RegExp(selector + '\{[^}]*\}'))[0]
    assert.doesNotMatch(base, /animation/, selector + ' must not animate outside the media query')
  }
  assert.match(html, /prefers-reduced-motion:no-preference\)\{[^@]*lcg-glow\{animation/)
})

/** Depth-first search of a render tree for the first element matching `pred`. */
function findNode(node, pred) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, pred)
      if (hit) return hit
    }
    return null
  }
  if (node.props && pred(node)) return node
  return node.props ? findNode(node.props.children, pred) : null
}
const SLOT_SELECTED = 3
const SLOT_FOCUSED = 5
const SLOT_JOURNAL = 6
const SLOT_UPROOT = 8

test('clicking an empty plot without seeds sends one plant intent and adopts the result', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  const state = defaultState(Date.now())
  state.bag.seeds.juqi = 0
  fake.seed(SLOT_VIEW, stateView(state, Date.now()))
  const calls = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) })
    const message = applyAction(state, calls.at(-1).payload, Date.now())
    return { json: async () => ({ ok: true, message, state: stateView(state, Date.now()) }) }
  }
  try {
    fake.reset()
    const tree = registrations[0].component()
    const tile = findNode(tree, (node) => node.props.className === 'lcg-tile' && node.props.key === 'p1')
    tile.props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(calls, [{ url: '/lingcao-garden/act', payload: { action: 'plant', plotId: 'p1', cropId: 'juqi', focus: true } }])
    assert.equal(fake.peek(SLOT_VIEW).stones, 110)
    assert.equal(fake.peek(SLOT_VIEW).plots[0].crop, 'juqi')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('a growing plot opens its actions as a floating popover under the tile, leaving the panel layout alone', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  const state = defaultState(Date.now())
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, Date.now())
  fake.seed(SLOT_VIEW, stateView(state, Date.now()))
  fake.reset()
  const openTile = (id, rect) => {
    fake.reset()
    const tile = findNode(
      registrations[0].component(),
      (node) => typeof node.props.className === 'string' && /lcg-tile/.test(node.props.className) && node.props.key === id,
    )
    tile.props.onClick({ button: 0, currentTarget: { getBoundingClientRect: () => rect } })
  }
  // The control row and the seed grid must not move when a plot's floating actions open.
  const controlsHtml = () => {
    fake.reset()
    const row = findNode(registrations[0].component(), (node) => node.props.className === 'lcg-plant-controls')
    return JSON.stringify(row, (key, value) => (typeof value === 'function' ? '[fn]' : value))
  }
  const popover = () => {
    fake.reset()
    return findNode(registrations[0].component(), (node) => typeof node.props.className === 'string' && node.props.className.includes('lcg-plotpop'))
  }

  const controlsBefore = controlsHtml()
  openTile('p1', { left: 400, top: 300, width: 48, height: 48, bottom: 348 })
  const pop = popover()
  assert.ok(pop, 'the plot actions live in their own floating layer')
  assert.equal(pop.props.style.left, '424px', 'centered under the clicked tile')
  assert.equal(pop.props.style.top, '356px', 'a little below the tile')
  assert.doesNotMatch(pop.props.className, /is-above/)
  assert.equal(controlsHtml(), controlsBefore, 'opening a plot never reflows the panel')

  // Near the bottom of the screen the popover flips above the tile instead of running off the edge.
  openTile('p1', { left: 400, top: 860, width: 48, height: 48, bottom: 908 })
  const flipped = popover()
  assert.match(flipped.props.className, /is-above/)
  assert.equal(flipped.props.style.top, '852px')
})

test('铲除 sits in the plot popover, arms on the first click and sends one uproot intent on the second', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  const state = defaultState(Date.now())
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, Date.now())
  fake.seed(SLOT_VIEW, stateView(state, Date.now()))
  fake.seed(SLOT_FOCUSED, { id: 'p1', x: 400, y: 300, above: false })
  const calls = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) })
    const message = applyAction(state, calls.at(-1).payload, Date.now())
    return { json: async () => ({ ok: true, message, state: stateView(state, Date.now()) }) }
  }
  /** The 铲除 button: a stroke-icon button whose label is either `uproot` or `uprootConfirm`. */
  const findUproot = () =>
    findNode(registrations[0].component(), (node) => {
      const kids = node.props.children
      return Array.isArray(kids) && (kids.includes('uproot') || kids.includes('uprootConfirm'))
    })

  try {
    fake.reset()
    const first = findUproot()
    assert.equal(first.props.title, 'uprootHint')
    assert.equal(first.props.children.at(-1), 'uproot')
    first.props.onClick()
    assert.equal(calls.length, 0, 'the first click only arms')
    assert.equal(fake.peek(SLOT_UPROOT).id, 'p1')
    assert.ok(fake.peek(SLOT_UPROOT).until > Date.now())

    fake.reset()
    const armed = findUproot()
    assert.match(armed.props.className, /is-danger/)
    assert.equal(armed.props.children.at(-1), 'uprootConfirm')
    armed.props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(calls, [{ url: '/lingcao-garden/act', payload: { action: 'uproot', plotId: 'p1' } }])
    assert.equal(state.plots[0].crop, null)
    assert.equal(state.bag.seeds.juqi, 2, 'the seed is back in the basket')
    assert.equal(fake.peek(SLOT_UPROOT), null)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('folding keeps the orb on the panel right side and reopening restores the panel position', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.reset()
  const panel = registrations[0].component()
  findNode(panel, (node) => node.props.title === 'collapse').props.onClick()
  assert.equal(fake.peek(0).mode, 'orb')
  assert.equal(fake.peek(0).left + 60, 100 + 340)
  assert.equal(fake.peek(0).top, 100)
  fake.reset()
  const folded = registrations[0].component()
  findNode(folded, (node) => /^lcg-orb(?: |$)/.test(node.props.className || '')).props.onKeyDown({ key: 'Enter', preventDefault() {} })
  assert.deepEqual(fake.peek(0), { mode: 'open', left: 100, top: 100 })
})

test('opening an orb near the left edge keeps the panel in the viewport', async () => {
  const { fake, registrations } = await loadClient({ mode: 'orb', left: 8, top: 100 })
  fake.reset()
  const tree = registrations[0].component()
  findNode(tree, (node) => /^lcg-orb(?: |$)/.test(node.props.className || '')).props.onKeyDown({ key: 'Enter', preventDefault() {} })
  assert.equal(fake.peek(0).left, 8)
  assert.equal(fake.peek(0).mode, 'open')
})

test('the scene opens seeds in an independent dialog, and choosing one closes it', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.seed(SLOT_VIEW, ripeView(false))
  fake.reset()
  let tree = registrations[0].component()
  assert.equal(findNode(tree, (node) => node.props.className === 'lcg-seedbar'), null)
  const drawerButton = findNode(tree, (node) => node.props['aria-label'] === 'seedChest')
  assert.ok(drawerButton)
  assert.equal(drawerButton.props['aria-haspopup'], 'dialog')
  drawerButton.props.onClick()
  fake.reset()
  tree = registrations[0].component()
  const panel = findNode(tree, (node) => node.props.className === 'lcg-panel')
  assert.equal(findNode(panel, (node) => node.props.className === 'lcg-seedbar'), null)
  assert.ok(findNode(tree, (node) => node.props.role === 'dialog' && node.props['aria-label'] === 'seedChest'))
  const html = dump(tree)
  assert.match(html, /"className":"lcg-seedbar"/)
  assert.match(html, /"className":"lcg-seedopt is-on"/)
  assert.match(html, /"aria-pressed":"true"/)
  // The 播种 caption is gone: the twelve seeds are the only children, so the two-column grid fills evenly.
  assert.doesNotMatch(html, /lcg-seedbar-label/)
  const bar = findNode(tree, (node) => node.props.className === 'lcg-seedbar')
  const chips = bar.props.children.flat().filter(Boolean)
  assert.equal(chips.length, 12, 'the grid holds exactly the twelve seed chips')
  assert.match(chips[0].props.className, /^lcg-seedopt/)
  const options = []
  const collect = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(collect)
    if (node.props && /^lcg-seedopt/.test(node.props.className || '')) options.push(node)
    if (node.props) collect(node.props.children)
  }
  collect(tree)
  assert.equal(options.length, 12, 'one chip per seed in the catalog')
  assert.equal(fake.peek(SLOT_SELECTED), 'juqi')
  options[1].props.onClick()
  assert.equal(fake.peek(SLOT_SELECTED), ripeView(false).catalog[1].id)
  fake.reset()
  assert.equal(findNode(registrations[0].component(), (node) => node.props.className === 'lcg-seedbar'), null)
})

test('sowing choices show all twelve durations and allow ordinary accelerated planting', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.seed(SLOT_VIEW, ripeView(false))
  fake.reset()
  findNode(registrations[0].component(), (node) => node.props['aria-label'] === 'seedChest').props.onClick()
  fake.reset()
  const tree = registrations[0].component()
  const text = dump(tree)
  for (const label of ['30秒', '1分钟', '5分钟', '10分钟', '20分钟', '30分钟', '1小时', '2小时', '4小时', '8小时', '12小时', '24小时']) {
    assert.ok(text.includes(label), 'visible duration ' + label)
  }
  const toggle = findNode(tree, (node) => node.props.role === 'switch' && node.props['aria-label'] === 'focusMode')
  assert.equal(toggle.props['aria-checked'], true)
  toggle.props.onClick()
  fake.reset()
  const updated = registrations[0].component()
  assert.equal(findNode(updated, (node) => node.props.role === 'switch').props['aria-checked'], false)
})

test('the seed bar belongs to the field only, not the shop', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.seed(SLOT_VIEW, ripeView(false))
  fake.seed(SLOT_PANEL, 'shop')
  fake.reset()
  assert.doesNotMatch(dump(registrations[0].component()), /"className":"lcg-seedbar"/)
})

test('shop and basket dialogs preserve the main panel and have a shared return header', async () => {
  for (const page of ['shop', 'bag']) {
    const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
    fake.seed(SLOT_VIEW, ripeView(true))
    const render = () => { fake.reset(); return registrations[0].component() }
    const before = dump(findNode(render(), (node) => node.props.className === 'lcg-panel'))
    fake.seed(SLOT_PANEL, page)
    const tree = render()
    assert.equal(dump(findNode(tree, (node) => node.props.className === 'lcg-panel')), before)
    const dialog = findNode(tree, (node) => node.props['data-garden-dialog'] === page)
    assert.ok(dialog)
    assert.ok(findNode(dialog, (node) => node.props.className === 'lcg-dialog-subtitle'))
    const back = findNode(dialog, (node) => node.props['aria-label'] === 'dialogBack')
    assert.ok(back)
    if (page === 'bag') {
      assert.doesNotMatch(dump(dialog), /"expand"|breakThrough|arrayBuy|gmTitle|lcg-seed-name/)
      assert.match(dump(dialog), /"sell"/)
    } else {
      assert.doesNotMatch(dump(dialog), /arrayBuy|arrayOwned|buyArray/)
      assert.doesNotMatch(dump(dialog), /"expand"|breakThrough/)
      assert.equal(findNode(dialog, (node) => /^bag-/.test(node.props.key || '')), null)
      assert.doesNotMatch(dump(dialog), /"sell"/)
    }
    back.props.onClick()
    assert.equal(fake.peek(SLOT_PANEL), 'field')
  }
})

test('harvest all shares the rain row, disables without ripe crops, and refreshes after one intent', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  const now = Date.now()
  const state = defaultState(now)
  fake.seed(SLOT_VIEW, stateView(state, now))
  const render = () => { fake.reset(); return registrations[0].component() }
  assert.equal(findNode(render(), node => node.props['aria-label'] === 'harvestAll').props.disabled, true)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'chenlu', focus: true }, now - 31_000)
  applyAction(state, { action: 'plant', plotId: 'p2', cropId: 'juqi', focus: true }, now)
  fake.seed(SLOT_VIEW, stateView(state, now))
  const row = findNode(render(), node => node.props.className === 'lcg-action-row')
  const button = findNode(row, node => node.props['aria-label'] === 'harvestAll')
  assert.equal(button.props.disabled, false)
  const previous = globalThis.fetch
  const calls = []
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body)
    calls.push(payload)
    applyAction(state, payload, now)
    return { json: async () => ({ ok: true, state: stateView(state, now) }) }
  }
  try {
    await button.props.onClick()
    assert.deepEqual(calls, [{ action: 'harvestAll' }])
    assert.equal(findNode(render(), node => node.props['aria-label'] === 'harvestAll').props.disabled, true)
    assert.equal(state.bag.herbs.chenlu, 1)
    assert.equal(state.plots[1].crop, 'juqi')
  } finally { globalThis.fetch = previous }
})

test('successful harvest flies each collected crop to the basket and ignores duplicate pending clicks', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  const now = Date.now(), state = defaultState(now)
  for (const [plotId, cropId] of [['p1', 'chenlu'], ['p2', 'jingxin']]) {
    applyAction(state, { action: 'plant', plotId, cropId }, now - 61_000)
  }
  fake.seed(SLOT_VIEW, stateView(state, now))
  const render = () => { fake.reset(); return registrations[0].component() }
  const tree = render()
  const rect = { left: 200, top: 250, width: 40, height: 50 }
  findNode(tree, node => node.props.className === 'lcg-panel').props.ref.current = {
    querySelector: selector => ({ getBoundingClientRect: () => selector.includes('basket') ? { ...rect, left: 350, top: 450 } : rect }),
  }
  const previous = globalThis.fetch
  let resolve, calls = 0
  globalThis.fetch = () => { calls++; return new Promise(done => { resolve = done }) }
  try {
    const button = findNode(tree, node => node.props['aria-label'] === 'harvestAll')
    const pending = button.props.onClick()
    button.props.onClick()
    assert.equal(calls, 1)
    assert.equal(findNode(render(), node => node.props.className === 'lcg-harvest-flight'), null)
    applyAction(state, { action: 'harvestAll' }, now)
    resolve({ json: async () => ({ ok: true, state: stateView(state, now) }) })
    await pending
    const effects = findNode(render(), node => node.props.className === 'lcg-harvest-effects')
    assert.ok(effects)
    const flights = effects.props.children[0]
    assert.equal(flights.length, 2)
    assert.equal(flights[0].props['aria-hidden'], 'true')
    assert.notEqual(flights[0].props.style['--delay'], flights[1].props.style['--delay'])
    assert.equal(findNode(flights[0], node => node.props.tone === 'chenlu').props.stage, 3)
    effects.props.children[1][0].props.onAnimationEnd({ target: 1, currentTarget: 1 })
    assert.equal(findNode(render(), node => node.props.className === 'lcg-harvest-effects').props.children[0].length, 1)
  } finally { globalThis.fetch = previous }
})

test('rejected harvest does not play a success flight', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.seed(SLOT_VIEW, ripeView(false))
  const render = () => { fake.reset(); return registrations[0].component() }
  const tree = render()
  findNode(tree, node => node.props.className === 'lcg-panel').props.ref.current = {
    querySelector: () => ({ getBoundingClientRect: () => ({ left: 100, top: 100, width: 40, height: 40 }) }),
  }
  const previous = globalThis.fetch
  globalThis.fetch = async () => ({ json: async () => ({ ok: false, message: '没有成熟灵草可收成。' }) })
  try {
    await findNode(tree, node => node.props['aria-label'] === 'harvestAll').props.onClick()
    assert.equal(findNode(render(), node => node.props.className === 'lcg-harvest-effects'), null)
  } finally { globalThis.fetch = previous }
})

test('harvest all enables at maturity between host snapshots', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  const now = Date.now()
  const state = defaultState(now)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'chenlu', focus: true }, now)
  fake.seed(SLOT_VIEW, stateView(state, now))
  const render = () => { fake.reset(); return registrations[0].component() }
  assert.equal(findNode(render(), node => node.props['aria-label'] === 'harvestAll').props.disabled, true)
  fake.seed(11, now + 31_000)
  assert.equal(findNode(render(), node => node.props['aria-label'] === 'harvestAll').props.disabled, false)
})

test('basket sell all disables when empty and sends one intent for the full basket', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  const state = defaultState(Date.now())
  fake.seed(SLOT_PANEL, 'bag')
  fake.seed(SLOT_VIEW, stateView(state, Date.now()))
  const render = () => { fake.reset(); return registrations[0].component() }
  assert.equal(findNode(render(), node => node.props['aria-label'] === 'sellAll').props.disabled, true)
  state.bag.herbs.juqi = 3
  state.bag.herbs.yuehua = 2
  fake.seed(SLOT_VIEW, stateView(state, Date.now()))
  const button = findNode(render(), node => node.props['aria-label'] === 'sellAll')
  assert.equal(button.props.disabled, false)
  assert.equal(button.props.children[1].props.n, 3 * 6 + 2 * 8)
  const previous = globalThis.fetch
  const calls = []
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body)
    calls.push(payload)
    applyAction(state, payload, Date.now())
    return { json: async () => ({ ok: true, state: stateView(state, Date.now()) }) }
  }
  try {
    await button.props.onClick()
    assert.deepEqual(calls, [{ action: 'sellAll' }])
    assert.equal(findNode(render(), node => node.props['aria-label'] === 'sellAll').props.disabled, true)
  } finally { globalThis.fetch = previous }
})

test('the focus clock follows a chosen plot, harvests once, and keeps the garden accessible', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  const now = Date.now()
  const state = defaultState(now)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi', focus: true }, now)
  applyAction(state, { action: 'plant', plotId: 'p2', cropId: 'yuehua', focus: true }, now)
  fake.seed(SLOT_VIEW, stateView(state, now))
  const render = () => { fake.reset(); return registrations[0].component() }
  findNode(render(), (node) => node.props['aria-label'] === 'enterClock').props.onClick()
  let tree = render()
  assert.ok(findNode(tree, (node) => node.props.className === 'lcg-clock'))
  assert.equal(findNode(tree, (node) => /^lcg-field-wrap/.test(node.props.className || '')), null)
  assert.equal(findNode(tree, (node) => node.props['data-clock-plot'] === 'p1').props['data-clock-plot'], 'p1')
  findNode(tree, (node) => node.props['aria-label'] === 'nextPlot').props.onClick()
  tree = render()
  assert.ok(findNode(tree, (node) => node.props['data-clock-plot'] === 'p2'))
  // A snapshot refresh never forces the selected plant back to the first plot.
  fake.seed(SLOT_VIEW, stateView(state, now + 31 * 60_000))
  tree = render()
  assert.ok(findNode(tree, (node) => node.props['data-clock-plot'] === 'p2'))
  const calls = []
  const previous = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options.body); calls.push(payload)
    applyAction(state, payload, now + 31 * 60_000)
    return { json: async () => ({ ok: true, state: stateView(state, now + 31 * 60_000) }) }
  }
  try {
    await findNode(tree, (node) => node.props['aria-label'] === 'clockHarvest').props.onClick()
    assert.deepEqual(calls, [{ action: 'harvest', plotId: 'p2' }])
    tree = render()
    assert.ok(findNode(tree, (node) => node.props['data-clock-plot'] === 'p1'))
    findNode(tree, (node) => node.props['aria-label'] === 'overview').props.onClick()
    assert.ok(findNode(render(), (node) => /^lcg-field-wrap/.test(node.props.className || '')))
  } finally { globalThis.fetch = previous }
})

test('an empty focus clock offers the full garden and restores its saved layout', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', layout: 'clock', left: 100, top: 100 })
  fake.seed(SLOT_VIEW, stateView(defaultState(Date.now()), Date.now()))
  fake.reset()
  const tree = registrations[0].component()
  assert.ok(findNode(tree, (node) => node.props.className === 'lcg-clock'))
  assert.match(dump(tree), /clockEmpty/)
  findNode(tree, (node) => node.props['aria-label'] === 'overview').props.onClick()
  assert.equal(fake.peek(0).layout, 'garden')
})

test('the clock reaches harvest time between snapshots without changing its planting duration', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', layout: 'clock', left: 100, top: 100 })
  const now = Date.now()
  const state = defaultState(now)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'chenlu', focus: true }, now)
  fake.seed(SLOT_VIEW, stateView(state, now))
  const render = () => { fake.reset(); return registrations[0].component() }
  assert.equal(findNode(render(), (node) => node.props.className === 'lcg-clock-time').props.children[0], '00:30')
  fake.seed(11, now + 31_000) // The normal one-second client clock, with no new Host snapshot.
  const tree = render()
  assert.ok(findNode(tree, (node) => node.props['aria-label'] === 'clockHarvest'))
  assert.equal(findNode(tree, (node) => node.props.className === 'lcg-clock-face').props.style['--clock-progress'], '100%')
  assert.match(dump(tree), /30秒/)
})

test('folding a clock on a narrow screen keeps its right edge and restores the clock', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', layout: 'clock', left: 8, top: 100 })
  window.innerWidth = 320
  fake.seed(SLOT_VIEW, ripeView(false))
  const render = () => { fake.reset(); return registrations[0].component() }
  findNode(render(), (node) => node.props['aria-label'] === 'collapse').props.onClick()
  assert.equal(fake.peek(0).left + 60, 8 + 304)
  assert.equal(fake.peek(0).layout, 'clock')
  findNode(render(), (node) => /^lcg-orb(?: |$)/.test(node.props.className || '')).props.onKeyDown({ key: 'Enter', preventDefault() {} })
  assert.equal(fake.peek(0).left, 8)
  assert.ok(findNode(render(), (node) => node.props.className === 'lcg-clock'))
})

test('the journal is only an entry on the first screen; its content opens in a dialog', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.seed(SLOT_VIEW, ripeView(false))
  fake.reset()
  const closed = dump(registrations[0].component())
  assert.match(closed, /"className":"lcg-journal-entry"/)
  assert.match(closed, /"aria-haspopup":"dialog"/)
  assert.doesNotMatch(closed, /"className":"lcg-log"/, 'no log inline')
  assert.doesNotMatch(closed, /"className":"lcg-quote"/, 'no quip inline')
  assert.doesNotMatch(closed, /"className":"lcg-modal"/)

  fake.seed(SLOT_JOURNAL, true)
  fake.reset()
  const open = dump(registrations[0].component())
  assert.match(open, /"className":"lcg-modal"/)
  assert.match(open, /"role":"dialog","aria-modal":"true"/)
  assert.match(open, /"className":"lcg-log"/)
  assert.match(open, /tokensLine/)
})

test('Esc and the close button dismiss the journal dialog', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  const listeners = {}
  globalThis.window.addEventListener = (type, fn) => {
    listeners[type] = fn
  }
  globalThis.window.removeEventListener = () => {}
  fake.seed(SLOT_VIEW, ripeView(false))
  fake.seed(SLOT_JOURNAL, true)
  fake.reset()
  const tree = registrations[0].component()
  fake.flushEffects()
  assert.equal(typeof listeners.keydown, 'function')
  listeners.keydown({ key: 'Enter' })
  assert.equal(fake.peek(SLOT_JOURNAL), true, 'other keys leave it open')
  listeners.keydown({ key: 'Escape' })
  assert.equal(fake.peek(SLOT_JOURNAL), false)

  fake.seed(SLOT_JOURNAL, true)
  const close = findNode(tree, (node) => node.props['aria-label'] === 'journalClose')
  assert.ok(close, 'dialog has a close button')
  close.props.onClick()
  assert.equal(fake.peek(SLOT_JOURNAL), false)
})

test('a message floats over the garden instead of joining the panel flow', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.seed(SLOT_VIEW, ripeView(false))
  fake.seed(2, { id: 7, text: '还没熟', error: true })
  fake.reset()
  const root = registrations[0].component()
  const isToast = (node) => /(^| )lcg-toast( |$)/.test(node.props.className || '')
  const panel = findNode(root, (node) => node.props.className === 'lcg-panel')
  assert.ok(panel, 'panel renders')
  assert.equal(findNode(panel.props.children, isToast), null, 'nothing toast-shaped inside the panel')
  const toast = findNode(root.props.children, isToast)
  assert.ok(toast, 'the message renders as a sibling layer')
  assert.equal(toast.props.className, 'lcg-toast is-error')
  assert.equal(toast.props.key, 'toast-7', 'keyed per message so the float replays')
  assert.equal(toast.props.role, 'status')
})

test('with no message there is no toast element, and its motion is reduced-motion gated', async () => {
  const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
  fake.seed(SLOT_VIEW, ripeView(false))
  fake.reset()
  const html = dump(registrations[0].component())
  assert.doesNotMatch(html, /"className":"lcg-toast/)
  const base = html.match(/\.lcg-toast\{[^}]*\}/)[0]
  assert.match(base, /position:absolute/)
  assert.match(base, /pointer-events:none/)
  assert.doesNotMatch(base, /animation/)
  assert.match(html, /prefers-reduced-motion:no-preference\)\{[^@]*\.lcg-toast\{animation:lcg-toast-rise/)
})

/** Let the pending `fetch().then()` chain of the sprite loader settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('sprite loading bypasses a previously cached incomplete art response', async () => {
  let options
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/art')) {
      options = init
      return { json: async () => ({ ok: true, art: buildArt() }) }
    }
    throw new Error('offline in tests')
  }
  const { fake, registrations } = await loadClient({ mode: 'open' })
  fake.seed(SLOT_VIEW, ripeView(false))
  fake.reset()
  registrations[0].component()
  fake.flushEffects()
  await settle()
  assert.equal(options.cache, 'no-store')
})

test('once sprites arrive the field, icons and orb switch to them', async () => {
  const art = buildArt()
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/art')) return { json: async () => ({ ok: true, art }) }
    throw new Error('offline in tests')
  }
  for (const mode of ['open', 'orb']) {
    const { fake, registrations } = await loadClient({ mode, left: 100, top: 100 })
    fake.seed(SLOT_VIEW, ripeView(false))
    // Before the manifest lands: the vector fallback.
    fake.reset()
    const before = dump(registrations[0].component())
    assert.doesNotMatch(before, /"className":"lcg-root lcg-art"/)
    assert.doesNotMatch(before, /"className":"lcg-(tileimg|orbimg)"/)
    fake.flushEffects()
    await settle()
    fake.reset()
    const after = dump(registrations[0].component())
    assert.match(after, /"className":"lcg-root lcg-art"/)
    if (mode === 'open') {
      assert.match(after, /"className":"lcg-tileimg"/)
      const scene = findNode(registrations[0].component(), (node) => node.props.className === 'lcg-field-wrap has-bg')
      assert.match(scene.props.style.backgroundImage, /^url\("data:image\/webp/)
      assert.match(after, /\.lcg-art \.lcg-gem\{[^}]*data:image\/webp/)
      // Clicks still go through a transparent hit layer, never the picture.
      assert.match(after, /"className":"lcg-slab"/)
      assert.match(after, /"className":"lcg-hit"/)
      for (const kind of ['shop', 'basket']) {
        const entrance = findNode(scene, node => node.props['data-entrance'] === kind)
        assert.ok(entrance)
        const image = findNode(entrance, node => node.props.className === 'lcg-entrance-art')
        assert.equal(image.props.src, art['entrance-' + kind].src)
      }
    } else {
      assert.match(after, /"className":"lcg-orb has-art"/)
      assert.match(after, /"className":"lcg-orbimg"/)
    }
  }
})

test('an empty or failing sprite manifest keeps the vector look', async () => {
  for (const fetcher of [async () => ({ json: async () => ({ ok: true, art: {} }) }), async () => { throw new Error('down') }]) {
    globalThis.fetch = fetcher
    const { fake, registrations } = await loadClient({ mode: 'open', left: 100, top: 100 })
    fake.seed(SLOT_VIEW, ripeView(false))
    fake.reset()
    registrations[0].component()
    fake.flushEffects()
    await settle()
    fake.reset()
    const html = dump(registrations[0].component())
    assert.doesNotMatch(html, /"className":"lcg-root lcg-art"/)
    assert.match(html, /"className":"lcg-side"/)
  }
})

/** Mount the client with a fixed sprite manifest and let it load. */
async function loadWithArt(art, storageExtra) {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/art')) return { json: async () => ({ ok: true, art }) }
    throw new Error('offline in tests')
  }
  const ctx = await loadClient({ mode: 'open', left: 100, top: 100 }, storageExtra)
  ctx.fake.seed(SLOT_VIEW, ripeView(false))
  ctx.fake.reset()
  ctx.registrations[0].component()
  ctx.fake.flushEffects()
  await settle()
  return ctx
}
const sprite = (tag) => ({ src: 'data:image/webp;base64,' + tag, w: 1, h: 1 })
const bgOf = (html) => (html.match(/"backgroundImage":"url\(\\"data:image\/webp;base64,(\w+)\\"\)"/) || [])[1]

test('the backdrop defaults to the first window scene and the button cycles through every theme', async () => {
  const art = { 'bg-moon': sprite('MOON'), 'bg-spring': sprite('SPRING'), 'bg-rain': sprite('RAIN'), 'bg-mine': sprite('MINE') }
  const { fake, registrations } = await loadWithArt(art)
  fake.reset()
  let tree = registrations[0].component()
  assert.equal(bgOf(dump(tree)), 'SPRING', 'spring is the default')
  const seen = ['SPRING']
  for (let step = 0; step < 4; step += 1) {
    const button = findNode(tree, (node) => node.props.className === 'lcg-bgbtn')
    assert.ok(button, 'switch button is on the field')
    button.props.onClick()
    fake.reset()
    tree = registrations[0].component()
    seen.push(bgOf(dump(tree)))
  }
  // Known themes keep their order (spring, rain, moon), customs follow, then it wraps around.
  assert.deepEqual(seen, ['SPRING', 'RAIN', 'MOON', 'MINE', 'SPRING'])
})

test('a remembered pick wins, and a pick that no longer exists falls back to the default', async () => {
  const art = { 'bg-spring': sprite('SPRING'), 'bg-sea': sprite('SEA') }
  let ctx = await loadWithArt(art, { 'dsh.lingcao-garden.bg': 'sea' })
  ctx.fake.reset()
  assert.equal(bgOf(dump(ctx.registrations[0].component())), 'SEA')
  ctx = await loadWithArt(art, { 'dsh.lingcao-garden.bg': 'deleted-file' })
  ctx.fake.reset()
  assert.equal(bgOf(dump(ctx.registrations[0].component())), 'SPRING')
})

test('with a single theme there is no switch button, and without any the vector field stays', async () => {
  let ctx = await loadWithArt({ 'bg-spring': sprite('SPRING') })
  ctx.fake.reset()
  assert.doesNotMatch(dump(ctx.registrations[0].component()), /"className":"lcg-bgbtn"/)
  ctx = await loadWithArt({ 'icon-orb': sprite('ORB') })
  ctx.fake.reset()
  const html = dump(ctx.registrations[0].component())
  assert.doesNotMatch(html, /has-bg"/)
  assert.doesNotMatch(html, /"className":"lcg-bgbtn"/)
})

test('the settings page lists the themes and picks one', async () => {
  const art = { 'bg-spring': sprite('SPRING'), 'bg-rain': sprite('RAIN') }
  const { fake, registrations } = await loadWithArt(art)
  const settings = registrations.find((entry) => entry.slot === 'settings.section')
  fake.reset()
  const row = settings.component()
  const picks = []
  const collect = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(collect)
    if (node.props && /^lcg-btn/.test(node.props.className || '') && node.props['aria-pressed'] && /^bg-/.test(String(node.props.key))) picks.push(node)
    if (node.props) collect(node.props.children)
  }
  collect(row)
  assert.equal(picks.length, 2)
  assert.equal(picks[0].props['aria-pressed'], 'true', 'the current theme is marked')
  picks[1].props.onClick()
  fake.reset()
  assert.equal(bgOf(dump(registrations[0].component())), 'RAIN')
})

test('the plot time tag is one compact line so dense gardens stay readable', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(src, /\.lcg-tag\{[^}]*padding:0 5px;border-radius:999px;font-size:9px;line-height:11px;/)
  assert.ok(src.includes("at.top + layout.tileH / 2 + 5 + 'px'"), 'the tag stays just under each crop')
})

test('the plot popover keeps its box constants and CSS in step', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const width = Number(/const PLOT_POP_W = (\d+)/.exec(src)[1])
  const height = Number(/const PLOT_POP_H = (\d+)/.exec(src)[1])
  assert.ok(src.includes(`width:max-content;max-width:min(${width}px,calc(100vw - 16px))`), 'PLOT_POP_W caps the stylesheet max-width')
  assert.ok(height > 0 && height < 200, 'PLOT_POP_H stays a plausible popover height')
  // Compact rules are what keep 灵肥 / 催熟 / 铲除 / 关闭 on one row.
  assert.ok(src.includes('.lcg-plotpop .lcg-plot-actions{gap:4px;flex-wrap:nowrap}'))
  assert.ok(src.includes('.lcg-plotpop .lcg-btn{gap:3px;padding:4px 7px;white-space:nowrap}'))
})
