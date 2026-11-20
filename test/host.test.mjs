/** Host-half tests: economy, growth and repair, no DSH runtime required. */
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import {
  accrueAmbient,
  apply,
  applyAction,
  buildArt,
  creditTokens,
  defaultState,
  effectiveTokens,
  harvestRipe,
  internals,
  landCost,
  plotView,
  repairState,
  stageIndexOf,
  stateView,
} from '../index.js'

const NOW = 1_732_000_000_000
const grow = (crop) => internals.CROPS[crop].growMs
/** GM tools are opt-in; tests that exercise them pass this explicitly. */
const GM = { gm: true }

test('art endpoint serves updated files without retaining the first response', () => {
  const dir = mkdtempSync(join(tmpdir(), 'garden-art-route-'))
  const previous = process.env.DSH_GARDEN_DIR
  process.env.DSH_GARDEN_DIR = dir
  try {
    mkdirSync(join(dir, 'backgrounds'))
    const routes = []
    apply({
      effect: (fn) => fn(),
      sessionProjections: { onChanged: () => () => {} },
      timer: { interval: () => () => {} },
      webServer: { register: (route) => { routes.push(route); return () => {} } },
    })
    const route = routes.find((entry) => entry.path === '/lingcao-garden/art')
    const request = () => {
      const headers = {}
      let body
      route.handler({}, { setHeader: (key, value) => { headers[key] = value }, end: (value) => { body = JSON.parse(value) } })
      return { headers, body }
    }
    const first = request()
    assert.equal(first.body.art['bg-refresh'], undefined)
    writeFileSync(join(dir, 'backgrounds', 'bg-refresh.png'), 'new-art')
    const second = request()
    assert.ok(second.body.art['bg-refresh'], 'new files must become visible after the first art request')
    assert.equal(second.headers['cache-control'], 'no-store')
    writeFileSync(join(dir, 'backgrounds', 'bg-refresh.png'), 'updated-art')
    assert.notEqual(request().body.art['bg-refresh'].src, second.body.art['bg-refresh'].src)
  } finally {
    if (previous === undefined) delete process.env.DSH_GARDEN_DIR
    else process.env.DSH_GARDEN_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reset requires confirmation, restores starter progress, and keeps token baselines', () => {
  const state = defaultState(NOW)
  state.stones = 9999; state.xp = 500; state.seen.old = 500_000
  state.tokens = 500_000; state.earned = 50; state.bag.herbs.juqi = 12
  const before = structuredClone(state)
  assert.throws(() => applyAction(state, { action: 'reset' }, NOW + 1000), /确认/)
  assert.deepEqual(state, before)
  applyAction(state, { action: 'reset', confirmation: 'RESET' }, NOW + 1000)
  const expected = defaultState(NOW + 1000)
  expected.seen.old = 500_000
  assert.deepEqual(state, expected)
  assert.equal(creditTokens(state, 'old', 500_000, NOW + 2000, NOW), 0)
  assert.equal(state.stones, 120)
})

test('reset route persists fresh progress, baselines live sessions and preserves state on save failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'garden-reset-'))
  const previous = process.env.DSH_GARDEN_DIR
  process.env.DSH_GARDEN_DIR = dir
  try {
    const state = defaultState(Date.now()); state.stones = 999; state.seen.old = 100
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state))
    const routes = [], timers = []
    let usage = 200_000
    apply({
      effect: fn => fn(), sessions: { list: () => [{ id: 'old' }, { id: 'live' }] },
      sessionProjections: { onChanged: () => () => {}, snapshot: () => ({ values: { tokenUsage: { outputTokens: usage } } }) },
      timer: { interval: fn => { timers.push(fn); return () => {} } },
      webServer: { register: route => { routes.push(route); return () => {} } },
    })
    const reset = async () => {
      const req = Readable.from([Buffer.from(JSON.stringify({ action: 'reset', confirmation: 'RESET' }))]); req.method = 'POST'
      let result
      await routes.find(r => r.path === '/lingcao-garden/act').handler(req, { setHeader() {}, end: text => { result = JSON.parse(text) } })
      return result
    }
    // A blocked temp-file path simulates a disk write failure without touching real saves.
    mkdirSync(join(dir, 'state.json.tmp'))
    const failed = await reset()
    assert.equal(failed.ok, false)
    assert.equal(failed.state.stones, 999)
    assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).stones, 999)
    rmSync(join(dir, 'state.json.tmp'), { recursive: true })
    const result = await reset()
    assert.equal(result.ok, true)
    assert.equal(result.state.stones, 120)
    let saved = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
    assert.deepEqual(saved.seen, { old: 200_000, live: 200_000 })
    for (const tick of timers) tick()
    usage += 10_000
    for (const tick of timers) tick()
    saved = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
    assert.equal(saved.stones, 122)
    assert.equal(saved.tokens, 20_000)
  } finally {
    if (previous === undefined) delete process.env.DSH_GARDEN_DIR
    else process.env.DSH_GARDEN_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a fresh garden has four plots, starter stones and two seeds', () => {
  const state = defaultState(NOW)
  assert.equal(state.plots.filter((plot) => plot.unlocked).length, 4)
  assert.equal(state.stones, 120)
  assert.equal(state.bag.seeds.juqi, 2)
  assert.equal(state.plots[0].crop, null)
})

test('the twelve focus durations are available at the starting realm', () => {
  const catalog = stateView(defaultState(NOW), NOW).catalog
  assert.deepEqual(catalog.map((crop) => crop.growMs / 1000), [30, 60, 300, 600, 1200, 1800, 3600, 7200, 14400, 28800, 43200, 86400])
  for (const crop of catalog) {
    const state = defaultState(NOW)
    state.stones = crop.seedPrice
    applyAction(state, { action: 'plant', plotId: 'p1', cropId: crop.id, focus: true }, NOW)
    assert.equal(plotView(state.plots[0], NOW + crop.growMs - 1).ready, false)
    assert.equal(plotView(state.plots[0], NOW + crop.growMs).ready, true)
    applyAction(state, { action: 'harvest', plotId: 'p1' }, NOW + crop.growMs)
    applyAction(state, { action: 'sell', cropId: crop.id }, NOW + crop.growMs)
    assert.ok(state.stones > crop.seedPrice, crop.id + ' harvest pays back seed')
  }
})

test('longer crops increase single-visit returns while shorter crops reward frequent visits', () => {
  const crops = Object.values(internals.CROPS)
  for (let index = 1; index < crops.length; index += 1) {
    const previous = crops[index - 1]
    const current = crops[index]
    const profit = (crop) => crop.yield * crop.price - crop.seedPrice
    assert.ok(profit(current) > profit(previous))
    assert.ok(profit(current) / current.growMs < profit(previous) / previous.growMs)
    assert.ok(current.harvestXp >= previous.harvestXp)
  }
})

test('planted duration survives reload independently of the current crop configuration', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi', focus: true }, NOW)
  state.plots[0].growMs = 600_000
  const restored = repairState(JSON.parse(JSON.stringify(state)), NOW)
  assert.equal(plotView(restored.plots[0], NOW + 300_000).ready, false)
  assert.equal(plotView(restored.plots[0], NOW + 600_000).ready, true)
})

test('focus crops keep their deadline through rain, ripening, reload and auto-harvest', () => {
  let state = defaultState(NOW)
  state.stones = 1000
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi', focus: true }, NOW)
  applyAction(state, { action: 'plant', plotId: 'p2', cropId: 'yuehua' }, NOW)
  applyAction(state, { action: 'rain' }, NOW)
  assert.equal(state.plots[0].boost, 0)
  assert.ok(state.plots[1].boost > 0)
  const before = structuredClone(state)
  assert.throws(() => applyAction(state, { action: 'ripen', plotId: 'p1' }, NOW), /专注/)
  assert.deepEqual(state, before)
  state = repairState(JSON.parse(JSON.stringify(state)), NOW + 1000)
  assert.equal(plotView(state.plots[0], NOW).focus, true)
  assert.equal(harvestRipe(state, NOW + grow('juqi') - 1), 0)
  assert.equal(harvestRipe(state, NOW + grow('juqi')), 1)
  assert.equal(state.plots[0].focus, false)
})

test('rain with only focus crops refuses without charging', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi', focus: true }, NOW)
  const before = structuredClone(state)
  assert.throws(() => applyAction(state, { action: 'rain' }, NOW), /专注/)
  assert.deepEqual(state, before)
})

test('legacy planted crops keep their old duration and inventories gain the new entries', () => {
  const raw = defaultState(NOW)
  raw.version = 1
  raw.bag = { seeds: { juqi: 7 }, herbs: { yuehua: 9 } }
  raw.plots[0] = { id: 'p1', unlocked: true, crop: 'juqi', plantedAt: NOW, boost: 0 }
  raw.plots[1] = { id: 'p2', unlocked: true, crop: 'yuehua', plantedAt: NOW, boost: 0 }
  const state = repairState(raw, NOW)
  assert.equal(state.version, 2)
  assert.equal(plotView(state.plots[0], NOW).growMs, 15 * 60_000)
  assert.equal(plotView(state.plots[1], NOW).growMs, 40 * 60_000)
  assert.equal(state.bag.seeds.juqi, 7)
  assert.equal(state.bag.herbs.yuehua, 9)
  assert.equal(state.bag.seeds.zhoutian, 0)
  const restored = repairState(JSON.parse(JSON.stringify(state)), NOW)
  assert.equal(plotView(restored.plots[0], NOW).growMs, 15 * 60_000)
})

test('buying a seed charges the shop price', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'buySeed', cropId: 'juqi' }, NOW)
  assert.equal(state.stones, 110)
  assert.equal(state.bag.seeds.juqi, 3)

  applyAction(state, { action: 'buySeed', cropId: 'yuehua' }, NOW)
  assert.equal(state.stones, 92)
  assert.equal(state.bag.seeds.yuehua, 1)
})

test('buying without enough stones is rejected and changes nothing', () => {
  const state = defaultState(NOW)
  state.stones = 5
  assert.throws(() => applyAction(state, { action: 'buySeed', cropId: 'juqi' }, NOW), /灵石不够/)
  assert.equal(state.stones, 5)
  assert.equal(state.bag.seeds.juqi, 2)
})

test('planting consumes a seed and adds cultivation', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  assert.equal(state.plots[0].crop, 'juqi')
  assert.equal(state.plots[0].plantedAt, NOW)
  assert.equal(state.bag.seeds.juqi, 1)
  assert.equal(state.xp, 2)
})

test('planting without seeds buys exactly one seed at the shop price', () => {
  for (const cropId of ['juqi', 'yuehua']) {
    const state = defaultState(NOW)
    state.bag.seeds[cropId] = 0
    const price = internals.CROPS[cropId].seedPrice
    state.stones = price
    const message = applyAction(state, { action: 'plant', plotId: 'p1', cropId }, NOW)
    assert.equal(state.stones, 0)
    assert.equal(state.bag.seeds[cropId], 0)
    assert.equal(state.plots[0].crop, cropId)
    assert.equal(state.plots[0].plantedAt, NOW)
    assert.equal(state.xp, 2 + Math.floor(price / 10))
    assert.equal(state.spendRemainder, price % 10)
    assert.match(message, /自动购买/)
    assert.match(message, new RegExp(String(price)))
  }
})

test('planting with an existing seed spends no stones', () => {
  const state = defaultState(NOW)
  state.stones = 0
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  assert.equal(state.stones, 0)
  assert.equal(state.bag.seeds.juqi, 1)
  assert.equal(state.xp, 2)
})

test('铲除 returns the seed, clears the plot and takes the planting cultivation back', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi', focus: true }, NOW)
  assert.equal(state.bag.seeds.juqi, 1)
  assert.equal(state.xp, 2)
  const stones = state.stones
  const message = applyAction(state, { action: 'uproot', plotId: 'p1' }, NOW + 60_000)
  assert.equal(state.bag.seeds.juqi, 2)
  assert.equal(state.xp, 0)
  assert.equal(state.stones, stones)
  assert.equal(state.plots[0].crop, null)
  assert.equal(state.plots[0].plantedAt, 0)
  assert.equal(state.plots[0].growMs, 0)
  assert.equal(state.plots[0].focus, false)
  assert.equal(state.plots[0].xpAwarded, 0)
  assert.equal(plotView(state.plots[0], NOW + 60_000).crop, null)
  assert.match(message, /收回种子/)
})

test('铲除 refunds the seed but never the stones spent on fertilizer or a bought seed', () => {
  const state = defaultState(NOW)
  state.bag.seeds.yuehua = 0
  state.stones = 500
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'yuehua' }, NOW)
  applyAction(state, { action: 'fertilize', plotId: 'p1' }, NOW)
  const spent = 500 - state.stones
  assert.ok(spent > 0)
  applyAction(state, { action: 'uproot', plotId: 'p1' }, NOW + 1000)
  assert.equal(state.stones, 500 - spent, 'only the seed comes back, not the money')
  assert.equal(state.bag.seeds.yuehua, 1, 'the harvested seed returns to the basket')
  assert.equal(state.bag.herbs.yuehua, 0, 'pulling a crop yields no herbs')
  assert.equal(state.plots[0].fertilized, false)
})

test('铲除 of an empty, unopened or unknown plot is rejected without changing the garden', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  for (const [plotId, error] of [
    ['p2', /还空着/],
    ['p5', /还没开垦/],
    ['missing', /没有这块地/],
  ]) {
    const before = structuredClone(state)
    assert.throws(() => applyAction(state, { action: 'uproot', plotId }, NOW), error)
    assert.deepEqual(state, before)
  }
})

test('planting and 铲除 in a loop cannot farm cultivation', () => {
  const state = defaultState(NOW)
  for (let round = 0; round < 5; round += 1) {
    applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
    applyAction(state, { action: 'uproot', plotId: 'p1' }, NOW)
  }
  assert.equal(state.xp, 0)
  assert.equal(state.bag.seeds.juqi, 2)
  assert.equal(state.stones, 120)
  assert.equal(state.harvested, 0)
})

test('a repaired save knows how much cultivation a planted crop already granted', () => {
  const raw = defaultState(NOW)
  raw.version = 1
  raw.xp = 50
  raw.plots[0].crop = 'juqi'
  delete raw.plots[0].xpAwarded
  const state = repairState(raw, NOW)
  assert.equal(state.plots[0].xpAwarded, internals.CROPS.juqi.plantXp)
  applyAction(state, { action: 'uproot', plotId: 'p1' }, NOW)
  assert.equal(state.xp, 50 - internals.CROPS.juqi.plantXp)
  assert.equal(state.bag.seeds.juqi, 3)
})

test('automatic seed purchase rejects insufficient funds without changing the garden', () => {
  const state = defaultState(NOW)
  state.stones = internals.CROPS.yuehua.seedPrice - 1
  const before = structuredClone(state)
  assert.throws(() => applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'yuehua' }, NOW), /灵石不够/)
  assert.deepEqual(state, before)
})

test('invalid planting targets never buy a seed or change the garden', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  for (const [plotId, cropId, error] of [
    ['p1', 'yuehua', /已经种着/],
    ['p5', 'yuehua', /还没开垦/],
    ['missing', 'yuehua', /没有这块地/],
    ['p2', 'missing', /没有这种灵草/],
  ]) {
    const before = structuredClone(state)
    assert.throws(() => applyAction(state, { action: 'plant', plotId, cropId }, NOW), error)
    assert.deepEqual(state, before)
  }
})

test('a crop is only harvestable once its real time elapsed', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  assert.throws(() => applyAction(state, { action: 'harvest', plotId: 'p1' }, NOW + 1000), /还没熟/)

  const ready = NOW + grow('juqi')
  const view = plotView(state.plots[0], ready)
  assert.equal(view.ready, true)
  assert.equal(view.progress, 1)

  applyAction(state, { action: 'harvest', plotId: 'p1' }, ready)
  assert.equal(state.plots[0].crop, null)
  assert.equal(state.bag.herbs.juqi, 3)
  assert.equal(state.harvested, 1)
  assert.equal(state.xp, 12)
})

test('harvest all collects only ripe plots with normal yields and xp, once', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi', focus: true }, NOW)
  applyAction(state, { action: 'plant', plotId: 'p2', cropId: 'chenlu' }, NOW)
  applyAction(state, { action: 'plant', plotId: 'p3', cropId: 'yuehua', focus: true }, NOW)
  state.plots[0].fertilized = true
  const growing = structuredClone(state.plots[2])
  const seeds = structuredClone(state.bag.seeds)
  const stones = state.stones
  const xp = state.xp
  assert.match(applyAction(state, { action: 'harvestAll' }, NOW + grow('juqi')), /2/)
  assert.equal(state.bag.herbs.juqi, 5)
  assert.equal(state.bag.herbs.chenlu, 1)
  assert.equal(state.harvested, 2)
  assert.equal(state.xp, xp + internals.CROPS.juqi.harvestXp + internals.CROPS.chenlu.harvestXp)
  assert.equal(state.stones, stones)
  assert.deepEqual(state.bag.seeds, seeds)
  assert.deepEqual(state.plots[2], growing)
  assert.equal(state.plots[0].crop, null)
  assert.equal(state.plots[1].crop, null)
  const after = structuredClone(state)
  assert.throws(() => applyAction(state, { action: 'harvestAll' }, NOW + grow('juqi')), /没有.*可收/)
  assert.deepEqual(state, after)
})

test('harvest all rejects empty or unripe gardens without changing state', () => {
  const state = defaultState(NOW)
  for (const planted of [false, true]) {
    if (planted) applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
    const before = structuredClone(state)
    assert.throws(() => applyAction(state, { action: 'harvestAll' }, NOW + 1), /没有.*可收/)
    assert.deepEqual(state, before)
  }
})

test('selling herbs converts them into stones', () => {
  const state = defaultState(NOW)
  state.bag.herbs.juqi = 4
  applyAction(state, { action: 'sell', cropId: 'juqi' }, NOW)
  assert.equal(state.bag.herbs.juqi, 0)
  assert.equal(state.stones, 120 + 4 * 6)
})

test('selling the whole basket credits every species once and keeps seeds and plots intact', () => {
  const state = defaultState(NOW)
  for (const [id] of Object.entries(internals.CROPS)) state.bag.herbs[id] = 2
  const expected = Object.values(internals.CROPS).reduce((sum, crop) => sum + crop.price * 2, 0)
  const seeds = structuredClone(state.bag.seeds)
  const plots = structuredClone(state.plots)
  const earned = state.earned
  const xp = state.xp
  applyAction(state, { action: 'sellAll' }, NOW)
  assert.equal(state.stones, 120 + expected)
  assert.ok(Object.values(state.bag.herbs).every(count => count === 0))
  assert.deepEqual(state.bag.seeds, seeds)
  assert.deepEqual(state.plots, plots)
  assert.equal(state.earned, earned)
  assert.equal(state.xp, xp)
  assert.throws(() => applyAction(state, { action: 'sellAll' }, NOW), /没有.*可卖/)
  assert.equal(state.stones, 120 + expected)
})

test('selling an empty basket rejects without changing the state', () => {
  const state = defaultState(NOW)
  const before = structuredClone(state)
  assert.throws(() => applyAction(state, { action: 'sellAll' }, NOW), /没有.*可卖/)
  assert.deepEqual(state, before)
})

test('expanding costs the landing price and opens the next plot', () => {
  const state = defaultState(NOW)
  state.stones = 500
  state.xp = 100 // 炼气三层: six plots allowed
  assert.equal(landCost(4), 60)
  applyAction(state, { action: 'expand' }, NOW)
  assert.equal(state.stones, 440)
  assert.equal(state.plots[4].unlocked, true)
  assert.equal(state.plots.filter((plot) => plot.unlocked).length, 5)
})

test('expansion is capped by the current realm', () => {
  const state = defaultState(NOW)
  state.stones = 5000
  assert.throws(() => applyAction(state, { action: 'expand' }, NOW), /破境/)
})

test('the realm ladder follows the cultivation thresholds', () => {
  assert.equal(stageIndexOf(0), 0)
  assert.equal(stageIndexOf(79), 0)
  assert.equal(stageIndexOf(80), 1)
  assert.equal(stageIndexOf(399), 1)
  assert.equal(stageIndexOf(400), 2)
  assert.equal(stageIndexOf(999_999), 5)
})

test('land price grows into the thousands near the cap', () => {
  assert.equal(landCost(4), 60)
  assert.equal(landCost(5), 75)
  assert.ok(landCost(23) > 1000)
})

test('only uncached input, output and cache writes feed the ledger', () => {
  assert.equal(
    effectiveTokens({ uncachedInputTokens: 900, outputTokens: 100, cacheWriteTokens: 50, cacheReadTokens: 100_000 }),
    1050,
  )
  assert.equal(effectiveTokens(null), 0)
  assert.equal(effectiveTokens({ cacheReadTokens: 5000 }), 0)
})

test('a damaged document is repaired instead of failing', () => {
  const repaired = repairState({ stones: -3, xp: 'nope', plots: [{ unlocked: true, crop: 'bogus', plantedAt: 'x' }] }, NOW)
  assert.equal(repaired.stones, 0)
  assert.equal(repaired.xp, 0)
  assert.equal(repaired.plots.length, 24)
  assert.equal(repaired.plots[0].unlocked, true)
  assert.equal(repaired.plots[0].crop, null)
  assert.equal(repaired.plots[3].unlocked, true)
  assert.equal(repaired.plots[4].unlocked, false)
})

test('the read model exposes stage progress, catalog and land cost', () => {
  const state = defaultState(NOW)
  state.xp = 100
  const view = stateView(state, NOW)
  assert.equal(view.stage, 1)
  assert.equal(view.stageXp, 80)
  assert.equal(view.maxPlots, 6)
  assert.equal(view.canExpand, true)
  assert.equal(view.landCost, 60)
  assert.equal(view.catalog.length, 12)
  assert.equal(view.plots.length, 24)
  assert.equal(view.rate, 10_000)
})

test('灵肥 raises one harvest by two and resets with the plot', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  applyAction(state, { action: 'fertilize', plotId: 'p1' }, NOW)
  assert.equal(state.stones, 120 - 8)
  assert.throws(() => applyAction(state, { action: 'fertilize', plotId: 'p1' }, NOW), /施过/)
  applyAction(state, { action: 'harvest', plotId: 'p1' }, NOW + grow('juqi'))
  assert.equal(state.bag.herbs.juqi, 5)
  assert.equal(state.plots[0].fertilized, false)
})

test('灵肥 always pays for itself, more so on long crops', () => {
  const { CROPS, FERTILIZER_COST, FERTILIZER_BONUS } = internals
  const gain = (id) => FERTILIZER_BONUS * CROPS[id].price - FERTILIZER_COST
  assert.ok(gain('juqi') > 0)
  assert.ok(gain('yuehua') > gain('juqi'))
})

test('short crops earn more per hour, long crops more per plant', () => {
  const { CROPS } = internals
  const perPlant = (id) => CROPS[id].yield * CROPS[id].price - CROPS[id].seedPrice
  const perHour = (id) => perPlant(id) / (CROPS[id].growMs / 3_600_000)
  assert.ok(perHour('juqi') > perHour('yuehua'))
  assert.ok(perPlant('yuehua') > perPlant('juqi'))
})

test('spending 灵石 turns into 修为 at one per ten, carrying the remainder', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'buySeed', cropId: 'juqi' }, NOW) // 10
  assert.equal(state.xp, 1)
  applyAction(state, { action: 'buySeed', cropId: 'yuehua' }, NOW) // 18 → 1, carry 8
  assert.equal(state.xp, 2)
  assert.equal(state.spendRemainder, 8)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  applyAction(state, { action: 'fertilize', plotId: 'p1' }, NOW) // 8 + 8 = 16 → 1, carry 6
  assert.equal(state.xp, 2 + 2 + 1)
  assert.equal(state.spendRemainder, 6)
})

test('催熟 charges by remaining minutes and makes the crop ready', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  applyAction(state, { action: 'ripen', plotId: 'p1' }, NOW)
  assert.equal(state.stones, 120 - Math.max(10, Math.ceil(grow('juqi') / 60000) * 2))
  assert.equal(plotView(state.plots[0], NOW).ready, true)
  applyAction(state, { action: 'harvest', plotId: 'p1' }, NOW)
  assert.equal(state.bag.herbs.juqi, 3)
})

test('灵雨 speeds every growing crop and enforces its cooldown', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  applyAction(state, { action: 'plant', plotId: 'p2', cropId: 'juqi' }, NOW)
  applyAction(state, { action: 'rain' }, NOW)
  assert.equal(state.stones, 120 - 30)
  const view = plotView(state.plots[0], NOW)
  assert.ok(view.remainingMs < grow('juqi'))
  assert.ok(view.boosted)
  assert.throws(() => applyAction(state, { action: 'rain' }, NOW + 1000), /灵雨刚布过/)
  // Past the cooldown it is allowed again, as long as something is still growing.
  state.bag.seeds.yuehua = 1
  applyAction(state, { action: 'plant', plotId: 'p3', cropId: 'yuehua' }, NOW + 30 * 60 * 1000)
  applyAction(state, { action: 'rain' }, NOW + 31 * 60 * 1000)
})

test('灵雨 never un-ripens a crop that 催熟 already finished', () => {
  const state = defaultState(NOW)
  state.stones = 500
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  applyAction(state, { action: 'plant', plotId: 'p2', cropId: 'juqi' }, NOW)
  applyAction(state, { action: 'ripen', plotId: 'p1' }, NOW)
  assert.equal(plotView(state.plots[0], NOW).ready, true)
  const message = applyAction(state, { action: 'rain' }, NOW)
  assert.match(message, /1 株/)
  assert.equal(plotView(state.plots[0], NOW).ready, true)
  assert.equal(plotView(state.plots[1], NOW).ready, false)
})

test('灵雨 with nothing growing is refused and costs nothing', () => {
  const state = defaultState(NOW)
  assert.throws(() => applyAction(state, { action: 'rain' }, NOW), /没有正在生长/)
  assert.equal(state.stones, 120)
  assert.equal(state.rainAt, 0)
})

test('manual batch harvest collects ripe plots and only ripe ones', () => {
  const state = defaultState(NOW)
  state.stones = 500
  state.bag.seeds.yuehua = 1
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  applyAction(state, { action: 'plant', plotId: 'p2', cropId: 'yuehua' }, NOW)
  assert.equal(harvestRipe(state, NOW + grow('juqi')), 1)
  assert.equal(state.bag.herbs.juqi, 3)
  assert.equal(state.plots[0].crop, null)
  assert.equal(state.plots[1].crop, 'yuehua')
})

test('retired array purchase rejects without charging', () => {
  const state = defaultState(NOW)
  state.stones = 400
  const before = structuredClone(state)
  assert.throws(() => applyAction(state, { action: 'buyArray' }, NOW))
  assert.deepEqual(state, before)
  assert.equal('autoHarvest' in stateView(state, NOW), false)
})

test('legacy auto-harvest saves keep ripe plants through host ticks until manual harvest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'garden-retire-array-'))
  const previous = process.env.DSH_GARDEN_DIR
  process.env.DSH_GARDEN_DIR = dir
  try {
    const now = Date.now(), state = defaultState(now)
    applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, now - grow('juqi') - 1000)
    state.upgrades = { autoHarvest: true }
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state))
    const timers = [], routes = []
    apply({
      effect: fn => fn(),
      sessionProjections: { onChanged: () => () => {} },
      sessions: { list: () => [] },
      timer: { interval: fn => { timers.push(fn); return () => {} } },
      webServer: { register: route => { routes.push(route); return () => {} } },
    })
    for (let i = 0; i < 3; i++) for (const tick of timers) tick()
    let response
    routes.find(route => route.path === '/lingcao-garden/state').handler({}, {
      setHeader() {}, end: text => { response = JSON.parse(text) },
    })
    assert.equal(response.state.plots[0].crop, 'juqi')
    assert.equal(response.state.readyCount, 1)
    assert.equal(response.state.bag.herbs.juqi, 0)
    const repaired = repairState(state, now)
    assert.equal(Boolean(repaired.upgrades?.autoHarvest), false)
    assert.equal(repaired.stones, state.stones)
    assert.equal(repaired.xp, state.xp)
    applyAction(repaired, { action: 'harvestAll' }, now)
    assert.equal(repaired.bag.herbs.juqi, 3)
  } finally {
    if (previous === undefined) delete process.env.DSH_GARDEN_DIR
    else process.env.DSH_GARDEN_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ambient stones accrue hourly and stop at the daily cap', () => {
  const state = defaultState(NOW)
  assert.equal(accrueAmbient(state, NOW + 3 * 3600 * 1000), 3)
  assert.equal(state.stones, 123)
  assert.equal(state.ambient.today, 3)
  const dayLater = NOW + 30 * 3600 * 1000
  accrueAmbient(state, dayLater)
  assert.ok(state.ambient.today <= 24)
})

test('a breakthrough announces itself in the returned message', () => {
  const state = defaultState(NOW)
  state.xp = 78
  const message = applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  assert.match(message, /破境/)
  const view = stateView(state, NOW)
  assert.equal(view.stage, 1)
  assert.match(view.quip, /园灵/)
})

test('GM tools are refused unless explicitly enabled, and the view says so', () => {
  const state = defaultState(NOW)
  assert.throws(() => applyAction(state, { action: 'gm', op: 'stones', amount: 1000 }, NOW), /未开启/)
  assert.equal(state.stones, 120)
  assert.equal(stateView(state, NOW).gm, false)
  assert.equal(stateView(state, NOW, GM).gm, true)
})

test('the read model counts ripe plots and publishes prices', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  applyAction(state, { action: 'plant', plotId: 'p2', cropId: 'juqi' }, NOW + 60_000)
  assert.equal(stateView(state, NOW).readyCount, 0)
  assert.equal(stateView(state, NOW + grow('juqi')).readyCount, 1)
  const { prices } = stateView(state, NOW)
  assert.equal(prices.fertilizer, 8)
  assert.equal(prices.rain, 30)
  assert.equal('array' in prices, false)
})

test('token ledger: one million new effective tokens grants one hundred stones', () => {
  const state = defaultState(NOW)
  creditTokens(state, 'work', 0, NOW + 1000, NOW)
  creditTokens(state, 'work', 1_000_000, NOW + 20_000, NOW)
  assert.equal(state.stones, 220)
  assert.equal(state.earned, 100)
  assert.equal(state.remainder, 0)
})

test('token ledger: old balances and token leftovers survive the new exchange rate', () => {
  const raw = defaultState(NOW)
  Object.assign(raw, { stones: 32_356, earned: 23_500, tokens: 6_918_749, remainder: 199, seen: { work: 1_000_000 } })
  const state = repairState(JSON.parse(JSON.stringify(raw)), NOW)
  assert.equal(state.stones, raw.stones)
  assert.equal(state.earned, raw.earned)
  assert.equal(state.tokens, raw.tokens)
  creditTokens(state, 'work', 1_009_800, NOW + 20_000, NOW)
  assert.equal(state.stones, raw.stones)
  assert.equal(state.remainder, 9999)
  const restored = repairState(JSON.parse(JSON.stringify(state)), NOW)
  creditTokens(restored, 'work', 1_009_801, NOW + 30_000, NOW)
  assert.equal(restored.stones, raw.stones + 1)
  assert.equal(restored.earned, raw.earned + 1)
  assert.equal(restored.remainder, 0)
})

test('token ledger: sessions present at start are baselined, not credited', () => {
  const state = defaultState(NOW)
  assert.equal(creditTokens(state, 's1', 80_000, NOW + 1000, NOW), 0)
  assert.equal(state.stones, 120)
  assert.equal(creditTokens(state, 's1', 81_000, NOW + 20_000, NOW), 1000)
  assert.equal(state.stones, 120)
  assert.equal(state.remainder, 1000)
})

test('token ledger: a session born after start counts its first turn', () => {
  const state = defaultState(NOW)
  const later = NOW + internals.STARTUP_GRACE_MS + 1
  assert.equal(creditTokens(state, 'fresh', 8_000, later, NOW), 8_000)
  assert.equal(state.stones, 120)
  assert.equal(state.remainder, 8000)
  // An old session that loads late cannot dump its whole history.
  assert.equal(creditTokens(state, 'old', 2_000_000, later, NOW), internals.FIRST_SIGHT_CAP)
})

test('token ledger: remembered sessions survive a restart without re-crediting', () => {
  const state = defaultState(NOW)
  creditTokens(state, 's1', 10_000, NOW + 1000, NOW)
  const restored = repairState(JSON.parse(JSON.stringify(state)), NOW)
  const restart = NOW + 3_600_000
  // After a restart, past the grace window, the stored total is the baseline.
  assert.equal(creditTokens(restored, 's1', 10_000, restart + 60_000, restart), 0)
  assert.equal(creditTokens(restored, 's1', 10_400, restart + 70_000, restart), 400)
  // A shrinking total (compaction, reset) never credits and re-baselines.
  assert.equal(creditTokens(restored, 's1', 3_000, restart + 80_000, restart), 0)
  assert.equal(creditTokens(restored, 's1', 3_200, restart + 90_000, restart), 200)
})

test('GM shortens growth, ripens everything and grants stones for testing', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  applyAction(state, { action: 'gm', op: 'advance', minutes: 5 }, NOW, GM)
  const advanced = plotView(state.plots[0], NOW)
  assert.ok(advanced.remainingMs < grow('juqi') - 4 * 60 * 1000)
  applyAction(state, { action: 'gm', op: 'ripenAll' }, NOW, GM)
  assert.equal(plotView(state.plots[0], NOW).ready, true)
  const before = state.stones
  applyAction(state, { action: 'gm', op: 'stones', amount: 1000 }, NOW, GM)
  assert.equal(state.stones, before + 1000)
  assert.throws(() => applyAction(state, { action: 'gm', op: 'nope' }, NOW, GM), /GM/)
})

test('GM can edit stones, cultivation, plots, remaining time and the name', () => {
  const state = defaultState(NOW)
  applyAction(state, { action: 'plant', plotId: 'p1', cropId: 'juqi' }, NOW)
  applyAction(
    state,
    { action: 'gm', op: 'set', patch: { stones: 5000, xp: 500, unlocked: 9, remainingMinutes: 1, name: '听雪圃' } },
    NOW,
    GM,
  )
  assert.equal(state.stones, 5000)
  assert.equal(state.xp, 500)
  assert.equal(state.name, '听雪圃')
  assert.equal(state.plots.filter((plot) => plot.unlocked).length, 9)
  assert.ok(plotView(state.plots[0], NOW).remainingMs <= 60_000)
  // A planted plot can never be locked away.
  applyAction(state, { action: 'gm', op: 'set', patch: { unlocked: 4 } }, NOW, GM)
  assert.equal(state.plots[0].unlocked, true)
  assert.throws(() => applyAction(state, { action: 'gm', op: 'set', patch: {} }, NOW, GM), /没有可修改/)
})

test('earned counts only token income, never sales, ambient or GM', () => {
  const state = defaultState(NOW)
  assert.equal(state.earned, 0)
  creditTokens(state, 'fresh', 50_000, NOW + 20_000, NOW)
  assert.equal(state.earned, 5)
  assert.equal(state.stones, 125)
  // Sub-stone leftovers wait in `remainder` and do not move `earned` yet.
  creditTokens(state, 'fresh', 59_999, NOW + 30_000, NOW)
  assert.equal(state.earned, 5)
  creditTokens(state, 'fresh', 60_000, NOW + 40_000, NOW)
  assert.equal(state.earned, 6)
  // Other stone sources leave it alone.
  state.bag.herbs.juqi = 4
  applyAction(state, { action: 'sell', cropId: 'juqi' }, NOW)
  accrueAmbient(state, NOW + 5 * 3_600_000)
  applyAction(state, { action: 'gm', op: 'stones', amount: 1000 }, NOW, GM)
  assert.equal(state.earned, 6)
  assert.ok(state.stones > 125 + 6)
})

test('earned is published in the read model and repaired on old saves', () => {
  const state = defaultState(NOW)
  creditTokens(state, 'fresh', 50_000, NOW + 20_000, NOW)
  creditTokens(state, 'fresh', 100_000, NOW + 30_000, NOW)
  assert.equal(stateView(state, NOW).earned, 10)
  const old = JSON.parse(JSON.stringify(state))
  delete old.earned
  assert.equal(repairState(old, NOW).earned, 0)
  assert.equal(repairState({ ...old, earned: -5 }, NOW).earned, 0)
  assert.equal(repairState({ ...old, earned: 7.9 }, NOW).earned, 7)
})

test('shipped sprites are sized data URIs and ungenerated species are explicitly tracked', () => {
  const art = buildArt()
  const plan = JSON.parse(readFileSync(new URL('../docs/focus-asset-plan.json', import.meta.url), 'utf8'))
  const need = ['bg-spring', 'bg-rain', 'bg-snow', 'bg-sea', 'bg-moon', 'entrance-shop', 'entrance-basket']
  for (const crop of Object.keys(internals.CROPS)) {
    const entry = plan.species.find((item) => item.id === crop)
    assert.ok(entry, 'asset delivery status for ' + crop)
    assert.ok(['ready', 'pending'].includes(entry.status))
    for (let stage = 0; stage < 4; stage += 1) {
      const key = `crop-${crop}-${stage}`
      if (entry.status === 'ready') need.push(key)
      else assert.equal(art[key], undefined, 'pending sprites must not masquerade as delivered')
    }
  }
  for (const tile of ['soil', 'fert', 'locked', 'ripe']) need.push('tile-' + tile)
  for (const icon of ['orb', 'stone', 'basket', 'rain', 'fertilizer', 'ripen', 'array', 'journal']) need.push('icon-' + icon)
  for (const name of need) {
    assert.ok(art[name], 'missing sprite ' + name)
    assert.match(art[name].src, /^data:image\/webp;base64,[A-Za-z0-9+/=]{200,}$/)
    assert.ok(art[name].w > 0 && art[name].h > 0, 'size hint for ' + name)
  }
  const bytes = JSON.stringify(art).length
  // Twelve species × four stages plus the existing tiles, icons and five backgrounds.
  assert.ok(bytes < 800_000, 'twelve-species manifest stays below 800 KB (' + bytes + ' bytes)')
})

test('a missing assets folder yields no sprites instead of failing', () => {
  assert.deepEqual(buildArt('Z:/definitely/not/here'), {})
})

test('players can add their own backgrounds, and a same-named file replaces a bundled one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lcg-bg-'))
  try {
    const png = Buffer.from('89504e470d0a1a0a', 'hex')
    writeFileSync(join(dir, 'bg-mine.png'), png)
    writeFileSync(join(dir, 'bg-spring.jpg'), Buffer.from([0xff, 0xd8, 0xff]))
    writeFileSync(join(dir, 'notes.txt'), 'ignored')
    writeFileSync(join(dir, 'bg-bad name.png'), png)
    writeFileSync(join(dir, 'bg-huge.png'), Buffer.alloc(1_600_000))
    writeFileSync(join(dir, 'mine.png'), png)
    const art = buildArt(undefined, dir)
    assert.match(art['bg-mine'].src, /^data:image\/png;base64,/)
    assert.equal(art['bg-mine'].custom, true)
    assert.match(art['bg-spring'].src, /^data:image\/jpeg;base64,/, 'replaces the bundled theme')
    assert.ok(art['bg-rain'], 'other bundled themes stay')
    for (const bad of ['bg-bad name', 'bg-huge', 'mine', 'notes']) assert.equal(art[bad], undefined, bad + ' is ignored')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('custom backgrounds work even when the bundled folder is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lcg-bg-'))
  try {
    writeFileSync(join(dir, 'bg-solo.webp'), Buffer.from('RIFF'))
    assert.deepEqual(Object.keys(buildArt('Z:/nope', dir)), ['bg-solo'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
