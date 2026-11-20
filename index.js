/**
 * Host half of the 灵草药园 (Lingcao Garden) bundle.
 *
 * The garden is plugin-owned state, not session-derived: token usage is read
 * from the host `tokenUsage` projection, condensed into 灵石, and spent on
 * seeds and new plots. The browser half only sends intents; every price,
 * timer and balance is settled here.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = '@local/lingcao-garden'

/** Sessions + projections for the token ledger, timer for polling, webServer for the browser half. */
export const inject = ['sessions', 'sessionProjections', 'timer', 'webServer']

/** Effective tokens (uncached input + output + cache write) per one 灵石. */
const TOKENS_PER_STONE = 10_000
/** Fresh-garden gift so the first plant costs nothing out of pocket. */
const STARTER_STONES = 120
/** Plot count cap, one entry per realm stage. */
const STAGE_PLOTS = [4, 6, 9, 12, 16, 24]
/** Realm ladder threshold in 修为. */
const STAGE_XP = [0, 80, 400, 1200, 3000, 8000]
const STAGE_NAMES = ['炼气一层', '炼气三层', '炼气六层', '炼气九层', '筑基', '金丹']
/** Plot ids are stable: p1…p24. */
const MAX_PLOTS = 24
/** Journal keeps the most recent entries only. */
const JOURNAL_MAX = 12
/** P1 economy knobs. */
const RAIN_COST = 30
const RAIN_COOLDOWN_MS = 30 * 60 * 1000
/** 灵肥: pays off on every crop, best on long ones. */
const FERTILIZER_COST = 8
const FERTILIZER_BONUS = 2
const RIPEN_MIN = 10
const RIPEN_PER_MIN = 2
/** Every this many 灵石 spent in the garden turns into one 修为. */
const STONES_PER_XP = 10
/** Sessions first seen this soon after start are treated as pre-existing. */
const STARTUP_GRACE_MS = 15_000
/** A session first seen later is new, but never credits more than this on first sight. */
const FIRST_SIGHT_CAP = 50_000
/** Persisted session baselines kept in the save file. */
const SEEN_MAX = 500
/** Ambient stones per local day. */
const AMBIENT_DAILY = 24
/** The garden spirit says one of these after a harvest. */
const QUIPS = [
  '园灵：又收一茬，地气更足了。',
  '园灵：这批灵草生得好，别急着全卖。',
  '园灵：灵石叮当响，比风铃好听。',
  '园灵：慢些种，土也要喘口气。',
]
/** Token settlement cadence. */
const TICK_MS = 10_000
/** Request body cap for the action route. */
const BODY_LIMIT = 64 * 1024
/**
 * Growth + economy table. `growMs` is real time; timestamps are the source of truth.
 * All twelve durations are available from the start, so choosing a focus interval
 * never depends on realm. Short crops reward visits; long crops reward one harvest.
 */
const CROPS = {
  chenlu: { name: '晨露芽', growMs: 30_000, seedPrice: 2, yield: 1, price: 5, tier: '凡', plantXp: 0, harvestXp: 1 },
  jingxin: { name: '静心苔', growMs: 60_000, seedPrice: 4, yield: 1, price: 8, tier: '凡', plantXp: 0, harvestXp: 2 },
  juqi: { name: '聚气草', growMs: 300_000, seedPrice: 10, yield: 3, price: 6, tier: '凡', plantXp: 2, harvestXp: 10 },
  tingfeng: { name: '听风竹', growMs: 600_000, seedPrice: 14, yield: 3, price: 8, tier: '凡', plantXp: 2, harvestXp: 16 },
  ninglu: { name: '凝露叶', growMs: 1_200_000, seedPrice: 16, yield: 4, price: 7, tier: '凡', plantXp: 2, harvestXp: 24 },
  yuehua: { name: '月华花', growMs: 1_800_000, seedPrice: 18, yield: 4, price: 8, tier: '凡', plantXp: 2, harvestXp: 32 },
  yingxing: { name: '萤星兰', growMs: 3_600_000, seedPrice: 26, yield: 4, price: 12, tier: '灵', plantXp: 2, harvestXp: 48 },
  chiyang: { name: '赤阳参', growMs: 7_200_000, seedPrice: 40, yield: 5, price: 16, tier: '灵', plantXp: 2, harvestXp: 72 },
  youming: { name: '幽冥藤', growMs: 14_400_000, seedPrice: 70, yield: 6, price: 24, tier: '灵', plantXp: 2, harvestXp: 108 },
  lingzhi: { name: '九转灵芝', growMs: 28_800_000, seedPrice: 130, yield: 6, price: 44, tier: '宝', plantXp: 2, harvestXp: 160 },
  xuanshuang: { name: '玄霜莲', growMs: 43_200_000, seedPrice: 180, yield: 8, price: 46, tier: '宝', plantXp: 2, harvestXp: 220 },
  zhoutian: { name: '周天灵树', growMs: 86_400_000, seedPrice: 300, yield: 10, price: 64, tier: '宝', plantXp: 2, harvestXp: 360 },
}

/** A planted crop owns its duration, including crops carried over from version 1. */
function durationOf(plot) {
  return plot.growMs || CROPS[plot.crop].growMs
}

/** Realm stage index for a 修为 total. */
export function stageIndexOf(xp) {
  let stage = 0
  for (let index = 0; index < STAGE_XP.length; index += 1) {
    if (xp >= STAGE_XP[index]) stage = index
  }
  return stage
}

/** Price of the next plot when `unlocked` plots are open. */
export function landCost(unlocked) {
  const raw = 60 * Math.pow(1.25, Math.max(0, unlocked - 4))
  return Math.round(raw / 5) * 5
}

/** One local-calendar day index for the ambient-stone daily cap (resets at local midnight). */
function dayOf(now) {
  const offset = new Date(now).getTimezoneOffset() * 60_000
  return Math.floor((now - offset) / 86_400_000)
}

/** Deduct a price and turn spending into 修为 (1 per STONES_PER_XP 灵石). */
function spend(state, cost) {
  state.stones -= cost
  state.spendRemainder = (state.spendRemainder || 0) + cost
  const xp = Math.floor(state.spendRemainder / STONES_PER_XP)
  if (xp > 0) {
    state.spendRemainder -= xp * STONES_PER_XP
    state.xp += xp
  }
}

/** 催熟 price for a crop with `remainingMs` left. */
export function ripenCost(remainingMs) {
  return Math.max(RIPEN_MIN, Math.ceil(remainingMs / 60000) * RIPEN_PER_MIN)
}

/** A brand-new garden: four open plots, two seeds, some starter stones. */
export function defaultState(now) {
  const plots = []
  for (let index = 1; index <= MAX_PLOTS; index += 1) {
    plots.push({ id: 'p' + index, unlocked: index <= 4, crop: null, plantedAt: 0, fertilized: false, boost: 0, xpAwarded: 0 })
  }
  return {
    version: 2,
    name: '听雨圃',
    sect: '云隐宗',
    createdAt: now,
    stones: STARTER_STONES,
    xp: 0,
    tokens: 0,
    remainder: 0,
    /** Lifetime stones that came from token spend (not sales, ambient or GM); the browser diffs it to float "+N". */
    earned: 0,
    spendRemainder: 0,
    harvested: 0,
    bag: {
      seeds: Object.fromEntries(Object.keys(CROPS).map((id) => [id, id === 'juqi' ? 2 : 0])),
      herbs: Object.fromEntries(Object.keys(CROPS).map((id) => [id, 0])),
    },
    plots,
    rainAt: 0,
    ambient: { lastAt: now, day: dayOf(now), today: 0 },
    /** Last effective-token total per session id, so restarts never re-credit history. */
    seen: {},
    quip: '',
    journal: [{ t: now, text: '执事接过荒田，先给了四垄薄地与两颗聚气草种子。' }],
  }
}

/** Keep only the newest journal entries. */
function pushJournal(state, now, text) {
  state.journal.push({ t: now, text })
  if (state.journal.length > JOURNAL_MAX) state.journal = state.journal.slice(-JOURNAL_MAX)
}

/** Repair a stored document: fill missing fields, clamp out-of-range values. */
export function repairState(raw, now) {
  const base = defaultState(now)
  if (!raw || typeof raw !== 'object') return base
  const state = { ...base, ...raw }
  state.version = 2
  state.stones = Number.isFinite(state.stones) ? Math.max(0, Math.floor(state.stones)) : 0
  state.xp = Number.isFinite(state.xp) ? Math.max(0, Math.floor(state.xp)) : 0
  state.tokens = Number.isFinite(state.tokens) ? Math.max(0, state.tokens) : 0
  state.remainder = Number.isFinite(state.remainder) ? Math.max(0, state.remainder) : 0
  state.earned = Number.isFinite(state.earned) ? Math.max(0, Math.floor(state.earned)) : 0
  state.spendRemainder = Number.isFinite(state.spendRemainder)
    ? Math.max(0, Math.min(STONES_PER_XP - 1, state.spendRemainder))
    : 0
  const seen = state.seen && typeof state.seen === 'object' && !Array.isArray(state.seen) ? state.seen : {}
  state.seen = {}
  for (const [id, total] of Object.entries(seen)) {
    if (Number.isFinite(total) && total >= 0) state.seen[id] = total
  }
  state.bag = state.bag && typeof state.bag === 'object' ? state.bag : base.bag
  state.bag.seeds = state.bag.seeds && typeof state.bag.seeds === 'object' ? state.bag.seeds : {}
  state.bag.herbs = state.bag.herbs && typeof state.bag.herbs === 'object' ? state.bag.herbs : {}
  for (const id of Object.keys(CROPS)) {
    for (const bag of [state.bag.seeds, state.bag.herbs]) {
      bag[id] = Number.isFinite(bag[id]) ? Math.max(0, Math.floor(bag[id])) : 0
    }
  }
  const plots = Array.isArray(state.plots) ? state.plots : []
  state.plots = base.plots.map((fallback, index) => {
    const saved = plots[index]
    if (!saved || typeof saved !== 'object') return fallback
    return {
      id: 'p' + (index + 1),
      unlocked: Boolean(saved.unlocked) || index < 4,
      crop: CROPS[saved.crop] ? saved.crop : null,
      growMs: Number.isFinite(saved.growMs) && saved.growMs > 0
        ? Math.min(86_400_000, saved.growMs)
        : raw.version !== 2 && saved.crop === 'juqi' ? 900_000
        : raw.version !== 2 && saved.crop === 'yuehua' ? 2_400_000
        : CROPS[saved.crop]?.growMs || 0,
      focus: saved.focus === true,
      plantedAt: Number.isFinite(saved.plantedAt) ? saved.plantedAt : 0,
      fertilized: Boolean(saved.fertilized),
      boost: Number.isFinite(saved.boost) ? Math.max(0, Math.min(saved.boost, 24 * 60 * 60 * 1000)) : 0,
      // Planting cultivation is undone when a crop is pulled up, so older saves carry it too.
      xpAwarded: Number.isFinite(saved.xpAwarded)
        ? Math.max(0, Math.floor(saved.xpAwarded))
        : saved.crop && CROPS[saved.crop]
          ? CROPS[saved.crop].plantXp
          : 0,
    }
  })
  // Retired array: old saves must no longer enable automatic harvesting.
  delete state.upgrades
  state.rainAt = Number.isFinite(state.rainAt) ? Math.max(0, state.rainAt) : 0
  const ambient = state.ambient && typeof state.ambient === 'object' ? state.ambient : {}
  state.ambient = {
    lastAt: Number.isFinite(ambient.lastAt) ? ambient.lastAt : now,
    day: Number.isFinite(ambient.day) ? ambient.day : dayOf(now),
    today: Number.isFinite(ambient.today) ? Math.max(0, Math.min(24, Math.floor(ambient.today))) : 0,
  }
  state.quip = typeof state.quip === 'string' ? state.quip : ''
  state.journal = Array.isArray(state.journal) ? state.journal.slice(-JOURNAL_MAX) : base.journal
  return state
}

/** One plot as the browser draws it. */
export function plotView(plot, now) {
  if (!plot.unlocked) return { id: plot.id, unlocked: false }
  const crop = plot.crop ? CROPS[plot.crop] : null
  if (!crop) return { id: plot.id, unlocked: true, crop: null, fertilized: Boolean(plot.fertilized) }
  const credited = Math.max(0, now - plot.plantedAt) + (plot.boost || 0)
  const growMs = durationOf(plot)
  const elapsed = Math.min(growMs, credited)
  const progress = elapsed / growMs
  return {
    id: plot.id,
    unlocked: true,
    crop: plot.crop,
    cropName: crop.name,
    growMs,
    focus: plot.focus === true,
    remainingMs: Math.max(0, growMs - credited),
    progress,
    ready: credited >= growMs,
    fertilized: Boolean(plot.fertilized),
    boosted: (plot.boost || 0) > 0,
  }
}

/** Empty a plot: the crop, its timing and every per-crop flag go back to bare soil. */
function clearPlot(plot) {
  plot.crop = null
  plot.plantedAt = 0
  plot.growMs = 0
  plot.focus = false
  plot.fertilized = false
  plot.boost = 0
  plot.xpAwarded = 0
}

/** Harvest one ripe plot: herbs by yield (plus fertilizer), cultivation, journal. */
function harvestPlot(state, plot, now) {
  const crop = CROPS[plot.crop]
  const count = crop.yield + (plot.fertilized ? FERTILIZER_BONUS : 0)
  state.bag.herbs[plot.crop] = (state.bag.herbs[plot.crop] || 0) + count
  state.xp += crop.harvestXp
  state.harvested += 1
  const herbName = crop.name
  const line = `收得${herbName} ×${count}。`
  clearPlot(plot)
  pushJournal(state, now, line)
  state.quip = QUIPS[state.harvested % QUIPS.length]
  return { name: herbName, count }
}

/** Ambient stones: one per hour, at most 24 per local day. */
export function accrueAmbient(state, now) {
  const day = dayOf(now)
  if (state.ambient.day !== day) {
    state.ambient.day = day
    state.ambient.today = 0
  }
  const hours = Math.floor(Math.max(0, now - state.ambient.lastAt) / 3_600_000)
  if (hours <= 0) return 0
  state.ambient.lastAt += hours * 3_600_000
  const grant = Math.max(0, Math.min(hours, AMBIENT_DAILY - state.ambient.today))
  if (grant > 0) {
    state.ambient.today += grant
    state.stones += grant
  }
  return grant
}

/** Manually harvest every ripe plot. Returns how many were collected. */
export function harvestRipe(state, now) {
  let count = 0
  for (const plot of state.plots) {
    if (!plot.crop) continue
    if (!plotView(plot, now).ready) continue
    harvestPlot(state, plot, now)
    count += 1
  }
  return count
}

/** Whole-garden read model. `options.gm` exposes the local test tools. */
export function stateView(state, now, options = {}) {
  const stage = stageIndexOf(state.xp)
  const maxPlots = STAGE_PLOTS[stage]
  const unlocked = state.plots.filter((plot) => plot.unlocked).length
  const nextXp = stage + 1 < STAGE_XP.length ? STAGE_XP[stage + 1] : null
  const plots = state.plots.map((plot) => plotView(plot, now))
  return {
    name: state.name,
    sect: state.sect,
    stones: state.stones,
    xp: state.xp,
    stage,
    stageName: STAGE_NAMES[stage],
    stageXp: STAGE_XP[stage],
    nextStageName: stage + 1 < STAGE_NAMES.length ? STAGE_NAMES[stage + 1] : null,
    nextXp,
    maxPlots,
    unlocked,
    canExpand: unlocked < maxPlots,
    landCost: unlocked < maxPlots ? landCost(unlocked) : null,
    plots,
    readyCount: plots.filter((plot) => plot.ready).length,
    bag: state.bag,
    catalog: Object.entries(CROPS).map(([id, crop]) => ({
      id,
      name: crop.name,
      tier: crop.tier,
      seedPrice: crop.seedPrice,
      yield: crop.yield,
      price: crop.price,
      growMs: crop.growMs,
      harvestXp: crop.harvestXp,
    })),
    journal: state.journal.slice(-JOURNAL_MAX),
    tokens: state.tokens,
    earned: state.earned,
    rate: TOKENS_PER_STONE,
    rainReadyInMs: Math.max(0, state.rainAt + RAIN_COOLDOWN_MS - now),
    ambientToday: state.ambient.today,
    ambientCap: AMBIENT_DAILY,
    quip: state.quip || '',
    prices: {
      fertilizer: FERTILIZER_COST,
      fertilizerBonus: FERTILIZER_BONUS,
      rain: RAIN_COST,
      ripenMin: RIPEN_MIN,
      ripenPerMin: RIPEN_PER_MIN,
      stonesPerXp: STONES_PER_XP,
    },
    gm: Boolean(options.gm),
    now,
  }
}

/**
 * Apply one intent. Mutates `state` and returns a user-facing message.
 * Throws `{ ok:false, message }`-shaped errors for rejected intents.
 * `options.gm` must be true for the local test tools to run.
 */
export function applyAction(state, action, now, options = {}) {
  const fail = (message) => {
    const error = new Error(message)
    error.rejected = true
    throw error
  }
  const stageBefore = stageIndexOf(state.xp)
  const done = (message) => {
    const stageAfter = stageIndexOf(state.xp)
    if (stageAfter > stageBefore) {
      const reached = STAGE_NAMES.slice(stageBefore + 1, stageAfter + 1).join('、')
      pushJournal(state, now, `破境 · ${reached}。宗门又拨了地，园灵在旁鼓掌。`)
      state.quip = '园灵：破境了。这方灵田，快要压不住你了。'
      return message + ` 破境：${reached}。`
    }
    return message
  }
  if (!action || typeof action !== 'object') fail('没有听懂这个动作。')
  const kind = String(action.action || '')

  if (kind === 'reset') {
    if (action.confirmation !== 'RESET') fail('请先确认重置存档。')
    const fresh = defaultState(now)
    // Keep accounting baselines so old token usage cannot fund the new playthrough.
    fresh.seen = { ...state.seen }
    for (const key of Object.keys(state)) delete state[key]
    Object.assign(state, fresh)
    return '存档已重置，可以重新开始种植了。'
  }

  if (kind === 'buySeed') {
    const crop = CROPS[action.cropId]
    if (!crop) fail('没有这种灵草种子。')
    if (state.stones < crop.seedPrice) fail(`灵石不够，${crop.name}种子要 ${crop.seedPrice} 灵石。`)
    spend(state, crop.seedPrice)
    state.bag.seeds[action.cropId] = (state.bag.seeds[action.cropId] || 0) + 1
    pushJournal(state, now, `买下${crop.name}种子 ×1，花去 ${crop.seedPrice} 灵石。`)
    return done(`买下${crop.name}种子 ×1。`)
  }

  if (kind === 'plant') {
    const crop = CROPS[action.cropId]
    if (!crop) fail('没有这种灵草。')
    const plot = state.plots.find((item) => item.id === action.plotId)
    if (!plot) fail('没有这块地。')
    if (!plot.unlocked) fail('这块地还没开垦。')
    if (plot.crop) fail('这块地上已经种着灵草了。')
    const autoBuy = (state.bag.seeds[action.cropId] || 0) < 1
    if (autoBuy) {
      if (state.stones < crop.seedPrice) fail(`灵石不够，自动购买${crop.name}种子要 ${crop.seedPrice} 灵石。`)
      spend(state, crop.seedPrice)
      state.bag.seeds[action.cropId] = 0
      pushJournal(state, now, `自动购买${crop.name}种子 ×1，花去 ${crop.seedPrice} 灵石。`)
    } else {
      state.bag.seeds[action.cropId] -= 1
    }
    plot.crop = action.cropId
    plot.plantedAt = now
    plot.growMs = crop.growMs
    plot.focus = action.focus === true
    plot.fertilized = false
    plot.boost = 0
    // Remembered so pulling the crop up can take this back: no free cultivation for plant/uproot loops.
    plot.xpAwarded = crop.plantXp
    state.xp += crop.plantXp
    pushJournal(state, now, `在${plot.id.replace('p', '第')}垄种下${crop.name}。`)
    return done(autoBuy ? `花去 ${crop.seedPrice} 灵石自动购买种子，种下${crop.name}。` : `种下${crop.name}。`)
  }

  if (kind === 'harvest') {
    const plot = state.plots.find((item) => item.id === action.plotId)
    if (!plot) fail('没有这块地。')
    if (!plot.crop) fail('这块地还空着。')
    const view = plotView(plot, now)
    if (!view.ready) fail(`${CROPS[plot.crop].name}还没熟，再等 ${Math.ceil(view.remainingMs / 60000)} 分钟。`)
    const got = harvestPlot(state, plot, now)
    return done(`收得${got.name} ×${got.count}。`)
  }

  if (kind === 'harvestAll') {
    const count = harvestRipe(state, now)
    if (!count) fail('园中没有成熟灵草可收成。')
    return done(`一键收成 ${count} 株灵草，已收入药篓。`)
  }

  if (kind === 'sellAll') {
    const entries = Object.entries(CROPS).filter(([id]) => (state.bag.herbs[id] || 0) > 0)
    if (!entries.length) fail('药篓里没有灵草可卖。')
    const income = entries.reduce((sum, [id, crop]) => sum + state.bag.herbs[id] * crop.price, 0)
    const count = entries.reduce((sum, [id]) => sum + state.bag.herbs[id], 0)
    for (const [id] of entries) state.bag.herbs[id] = 0
    state.stones += income
    const message = `一键售出灵草 ×${count}，得 ${income} 灵石。`
    pushJournal(state, now, message)
    return done(message)
  }

  if (kind === 'sell') {
    const crop = CROPS[action.cropId]
    if (!crop) fail('仓库里没有这种灵草。')
    const count = state.bag.herbs[action.cropId] || 0
    if (count < 1) fail(`仓库里没有${crop.name}可卖。`)
    const income = count * crop.price
    state.bag.herbs[action.cropId] = 0
    state.stones += income
    pushJournal(state, now, `售出${crop.name} ×${count}，得 ${income} 灵石。`)
    return done(`售出${crop.name} ×${count}，得 ${income} 灵石。`)
  }

  if (kind === 'expand') {
    const stage = stageIndexOf(state.xp)
    const maxPlots = STAGE_PLOTS[stage]
    const unlocked = state.plots.filter((plot) => plot.unlocked).length
    if (unlocked >= maxPlots) fail(`当前境界最多 ${maxPlots} 垄地，再多要破境。`)
    const cost = landCost(unlocked)
    if (state.stones < cost) fail(`开垦要 ${cost} 灵石，还差 ${cost - state.stones}。`)
    spend(state, cost)
    state.plots[unlocked].unlocked = true
    pushJournal(state, now, `开垦第 ${unlocked + 1} 垄，花去 ${cost} 灵石。`)
    return done(`开垦了第 ${unlocked + 1} 垄。`)
  }

  if (kind === 'uproot') {
    // Pull a mis-planted crop: the seed comes back, the planted-time cultivation goes away.
    // Fertilizer, 催熟 and 灵雨 money is not refunded, and a ripe crop loses its harvest.
    const plot = state.plots.find((item) => item.id === action.plotId)
    if (!plot) fail('没有这块地。')
    if (!plot.unlocked) fail('这块地还没开垦。')
    if (!plot.crop) fail('这块地还空着，没什么可铲的。')
    const crop = CROPS[plot.crop]
    const refundedXp = Math.min(state.xp, Math.max(0, Math.floor(plot.xpAwarded || 0)))
    state.xp -= refundedXp
    state.bag.seeds[plot.crop] = (state.bag.seeds[plot.crop] || 0) + 1
    clearPlot(plot)
    pushJournal(state, now, `铲掉${crop.name}，收回种子 ×1。`)
    return done(
      refundedXp > 0
        ? `铲掉${crop.name}，收回种子 ×1，修为 -${refundedXp}。`
        : `铲掉${crop.name}，收回种子 ×1。`,
    )
  }

  if (kind === 'fertilize') {
    const plot = state.plots.find((item) => item.id === action.plotId)
    if (!plot) fail('没有这块地。')
    if (!plot.crop) fail('这块地还空着，没什么可施肥的。')
    if (plot.fertilized) fail('这株已经施过灵肥了。')
    if (state.stones < FERTILIZER_COST) fail(`灵肥要 ${FERTILIZER_COST} 灵石，还差 ${FERTILIZER_COST - state.stones}。`)
    spend(state, FERTILIZER_COST)
    plot.fertilized = true
    pushJournal(state, now, `给${CROPS[plot.crop].name}施了一撮灵肥。`)
    return done(`灵肥下了，收成 +${FERTILIZER_BONUS}。`)
  }

  if (kind === 'ripen') {
    const plot = state.plots.find((item) => item.id === action.plotId)
    if (!plot) fail('没有这块地。')
    if (!plot.crop) fail('这块地还空着。')
    const view = plotView(plot, now)
    if (view.ready) fail('这株已经熟了，直接收就行。')
    if (plot.focus) fail('这株正在专注计时，不可催熟；到时自然成熟。')
    const cost = ripenCost(view.remainingMs)
    if (state.stones < cost) fail(`催熟要 ${cost} 灵石，还差 ${cost - state.stones}。`)
    spend(state, cost)
    plot.boost = durationOf(plot)
    pushJournal(state, now, `以 ${cost} 灵石催熟${CROPS[plot.crop].name}。`)
    return done(`催熟了${CROPS[plot.crop].name}。`)
  }

  if (kind === 'rain') {
    const wait = state.rainAt + RAIN_COOLDOWN_MS - now
    if (wait > 0) fail(`灵雨刚布过，还要等 ${Math.ceil(wait / 60000)} 分钟。`)
    if (state.stones < RAIN_COST) fail(`布灵雨要 ${RAIN_COST} 灵石，还差 ${RAIN_COST - state.stones}。`)
    let touched = 0
    for (const plot of state.plots) {
      // Ripe plots are left alone: rain must never un-ripen a crop.
      if (!plot.crop || plot.focus || plotView(plot, now).ready) continue
      const growMs = durationOf(plot)
      const current = plot.boost || 0
      // Rain alone stops at 90% growth, but never lowers an existing boost.
      plot.boost = Math.max(current, Math.min(growMs * 0.9, current + growMs * 0.3))
      touched += 1
    }
    if (touched < 1) fail('田里没有正在生长且可加速的灵草；专注计时不受灵雨影响，这场灵雨先省下。')
    spend(state, RAIN_COST)
    state.rainAt = now
    pushJournal(state, now, `布下一场灵雨，${touched} 株灵草各快了三成。`)
    return done(`灵雨落下，${touched} 株灵草快了三成。`)
  }

  if (kind === 'gm') {
    // Local-only test helpers: no cost, never touches the token ledger. Off unless enabled.
    if (!options.gm) fail('GM 工具未开启。')
    const op = String(action.op || '')
    if (op === 'ripenAll') {
      for (const plot of state.plots) {
        if (plot.crop) plot.boost = durationOf(plot)
      }
      pushJournal(state, now, '【GM】全场灵草即刻成熟。')
      return done('【GM】全场灵草已成熟。')
    }
    if (op === 'advance') {
      const minutes = Math.max(1, Math.min(24 * 60, Number(action.minutes) || 30))
      let touched = 0
      for (const plot of state.plots) {
        if (!plot.crop) continue
        const growMs = durationOf(plot)
        plot.boost = Math.min(growMs, (plot.boost || 0) + minutes * 60 * 1000)
        touched += 1
      }
      pushJournal(state, now, `【GM】时间快进 ${minutes} 分钟，${touched} 株灵草受益。`)
      return done(`【GM】快进 ${minutes} 分钟。`)
    }
    if (op === 'stones') {
      const amount = Math.max(1, Math.min(1_000_000, Number(action.amount) || 1000))
      state.stones += amount
      pushJournal(state, now, `【GM】灵石 +${amount}。`)
      return done(`【GM】灵石 +${amount}。`)
    }
    if (op === 'set') {
      // Targeted edits for testing: only the provided fields change.
      const patch = action.patch && typeof action.patch === 'object' ? action.patch : {}
      const changed = []
      if (Number.isFinite(patch.stones)) {
        state.stones = Math.max(0, Math.min(10_000_000, Math.floor(patch.stones)))
        changed.push('灵石')
      }
      if (Number.isFinite(patch.xp)) {
        state.xp = Math.max(0, Math.min(1_000_000, Math.floor(patch.xp)))
        changed.push('修为')
      }
      if (Number.isFinite(patch.unlocked)) {
        const stage = stageIndexOf(state.xp)
        const planted = state.plots.reduce((max, plot, index) => (plot.crop ? index + 1 : max), 0)
        const target = Math.max(planted, Math.min(STAGE_PLOTS[stage], Math.max(4, Math.floor(patch.unlocked))))
        state.plots.forEach((plot, index) => {
          plot.unlocked = index < target
        })
        changed.push(`地块 ${target}`)
      }
      if (Number.isFinite(patch.remainingMinutes)) {
        const minutes = Math.max(0, Math.min(24 * 60, Math.floor(patch.remainingMinutes)))
        for (const plot of state.plots) {
          if (!plot.crop) continue
          const growMs = durationOf(plot)
          plot.boost = Math.max(0, Math.min(growMs, growMs - minutes * 60 * 1000))
        }
        changed.push(`剩余 ${minutes} 分`)
      }
      if (typeof patch.name === 'string' && patch.name.trim()) {
        state.name = patch.name.trim().slice(0, 12)
        changed.push('园名')
      }
      if (!changed.length) fail('没有可修改的字段。')
      pushJournal(state, now, `【GM】修改：${changed.join('、')}。`)
      return done(`【GM】已改：${changed.join('、')}。`)
    }
    fail('未知的 GM 操作。')
  }

  fail('没有听懂这个动作。')
}

/** Effective token count for the ledger: cache re-reads never inflate the garden. */
export function effectiveTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0
  const uncached = Number(usage.uncachedInputTokens) || 0
  const output = Number(usage.outputTokens) || 0
  const cacheWrite = Number(usage.cacheWriteTokens) || 0
  return Math.max(0, uncached + output + cacheWrite)
}

/**
 * Credit one session's effective-token total into the garden. Returns tokens credited.
 *
 * - An id remembered in `state.seen` continues from its stored total, so restarts
 *   never re-credit history.
 * - A never-seen id within `STARTUP_GRACE_MS` of start is a pre-existing session:
 *   its current total becomes the baseline and nothing is credited.
 * - A never-seen id after that is a new session: it counts from zero, but the first
 *   sight credits at most `FIRST_SIGHT_CAP` (guards old sessions that load late).
 */
export function creditTokens(state, sessionId, total, now, startedAt) {
  const id = String(sessionId)
  const previous = state.seen[id]
  const delta = previous === undefined
    ? now - startedAt < STARTUP_GRACE_MS ? 0 : Math.min(total, FIRST_SIGHT_CAP)
    : Math.max(0, total - previous)
  if (previous !== total) {
    // Re-insert so key order tracks recency; the stalest ids are dropped first.
    delete state.seen[id]
    state.seen[id] = total
    const ids = Object.keys(state.seen)
    for (let index = 0; index < ids.length - SEEN_MAX; index += 1) delete state.seen[ids[index]]
  }
  if (delta <= 0) return 0
  state.tokens += delta
  state.remainder += delta
  const gained = Math.floor(state.remainder / TOKENS_PER_STONE)
  if (gained > 0) {
    state.remainder -= gained * TOKENS_PER_STONE
    state.stones += gained
    state.earned += gained
  }
  return delta
}

/** GM tools are on when `DSH_GARDEN_GM=1` or a `gm.enabled` file sits in the data dir. */
function gmEnabled(dir) {
  if (process.env.DSH_GARDEN_GM === '1') return true
  try {
    return existsSync(path.join(dir, 'gm.enabled'))
  } catch {
    return false
  }
}

/** Garden data directory: `$DSH_HOME/lingcao-garden`, overridable for tests. */
function dataDir() {
  if (process.env.DSH_GARDEN_DIR) return process.env.DSH_GARDEN_DIR
  const home = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  return path.join(home, 'lingcao-garden')
}

/** Read the stored garden, repairing a damaged document instead of failing. */
function loadState(file, now) {
  try {
    if (!existsSync(file)) return defaultState(now)
    return repairState(JSON.parse(readFileSync(file, 'utf8')), now)
  } catch {
    return defaultState(now)
  }
}

/** Atomic-enough save: write a sibling temp file, then rename over the target. */
function saveState(file, state) {
  const dir = path.dirname(file)
  mkdirSync(dir, { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(tmp, file)
}

/** Read a JSON request body with a hard size cap. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** Write one JSON response. */
/** Directory holding the clay-style sprites shipped with the plugin. */
const ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets')

/** Image types a user may drop in as a custom background, with their data-URI mime. */
const BG_MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }
/** A custom background bigger than this is skipped: it would bloat the one-shot manifest. */
const BG_MAX_BYTES = 1_500_000

/**
 * Bundle every `assets/*.webp` into one `{ name: { src, w, h } }` manifest of data URIs.
 * `w` / `h` come from `assets/manifest.json` (the pixel size of each sprite). A missing or
 * unreadable folder yields `{}`: the browser then falls back to its built-in vector art.
 *
 * `userDir` may hold the player's own backgrounds named `bg-<id>.webp|png|jpg|jpeg`; they join
 * the theme list (a same-named file replaces a bundled theme). Anything else there is ignored.
 */
export function buildArt(dir = ART_DIR, userDir = null) {
  const art = {}
  try {
    let sizes = {}
    try {
      sizes = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
    } catch {
      // Sizes are a layout hint only; sprites still render without them.
    }
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.webp')) continue
      const key = file.slice(0, -'.webp'.length)
      const size = sizes[key] || {}
      art[key] = {
        src: 'data:image/webp;base64,' + readFileSync(path.join(dir, file)).toString('base64'),
        w: Number.isFinite(size.w) ? size.w : 0,
        h: Number.isFinite(size.h) ? size.h : 0,
      }
    }
  } catch {
    // No bundled sprites: custom backgrounds below can still work on their own.
  }
  if (userDir) {
    try {
      for (const file of readdirSync(userDir)) {
        const ext = path.extname(file).toLowerCase()
        const key = path.basename(file, path.extname(file))
        if (!BG_MIME[ext] || !/^bg-[A-Za-z0-9_-]{1,32}$/.test(key)) continue
        const data = readFileSync(path.join(userDir, file))
        if (data.length > BG_MAX_BYTES) continue
        art[key] = { src: 'data:' + BG_MIME[ext] + ';base64,' + data.toString('base64'), w: 0, h: 0, custom: true }
      }
    } catch {
      // No custom folder (the normal case) or unreadable: ignore.
    }
  }
  return art
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/**
 * Host plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 */
export function apply(ctx) {
  const dir = dataDir()
  const file = path.join(dir, 'state.json')
  const startedAt = Date.now()
  const state = loadState(file, startedAt)
  let dirty = false
  /** Re-read per request so `gm.enabled` can be toggled without a restart. */
  const options = () => ({ gm: gmEnabled(dir) })

  const save = () => {
    try {
      saveState(file, state)
      dirty = false
    } catch {
      // A failed save must never break the garden; the next tick retries.
    }
  }

  const credit = (session, usage) => {
    if (!session || session.id === undefined || session.id === null) return
    const total = effectiveTokens(usage)
    if (state.seen[String(session.id)] === total) return
    creditTokens(state, session.id, total, Date.now(), startedAt)
    dirty = true
  }

  const harvestTokens = (session) => {
    try {
      const snapshot = ctx.sessionProjections.snapshot(session, ['tokenUsage'])
      credit(session, snapshot.values.tokenUsage)
    } catch {
      // A session without the projection yet simply contributes nothing.
    }
  }

  ctx.effect(() =>
    ctx.sessionProjections.onChanged((session, key, value) => {
      if (key === 'tokenUsage') credit(session, value)
    }),
  )

  ctx.effect(() =>
    ctx.timer.interval(() => {
      const now = Date.now()
      for (const session of ctx.sessions.list()) harvestTokens(session)
      if (accrueAmbient(state, now) > 0) dirty = true
      if (dirty) save()
    }, TICK_MS),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/lingcao-garden/state',
      handler: (req, res) => {
        const now = Date.now()
        if (accrueAmbient(state, now) > 0) save()
        sendJson(res, 200, { ok: true, state: stateView(state, now, options()) })
      },
    }),
  )

  // Read current files on each manifest request; assets may be added while the plugin is running.
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/lingcao-garden/art',
      handler: (req, res) => {
        sendJson(res, 200, { ok: true, art: buildArt(ART_DIR, path.join(dataDir(), 'backgrounds')) })
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/lingcao-garden/act',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, message: '只接受 POST。' })
          return
        }
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          sendJson(res, 400, { ok: false, message: '请求格式不对：' + error.message })
          return
        }
        const now = Date.now()
        const opts = options()
        if (body?.action === 'reset') {
          try {
            const fresh = structuredClone(state)
            const message = applyAction(fresh, body, now, opts)
            // Snapshot every currently known session before the new game starts.
            for (const session of ctx.sessions.list()) {
              if (session?.id === undefined || session?.id === null) continue
              const usage = ctx.sessionProjections.snapshot(session, ['tokenUsage']).values.tokenUsage
              if (!usage || typeof usage !== 'object') throw new Error('会话计量暂不可用')
              fresh.seen[String(session.id)] = effectiveTokens(usage)
            }
            saveState(file, fresh)
            for (const key of Object.keys(state)) delete state[key]
            Object.assign(state, fresh)
            dirty = false
            sendJson(res, 200, { ok: true, message, state: stateView(state, now, opts) })
          } catch (error) {
            sendJson(res, 200, { ok: false, message: error.rejected ? error.message : '重置未完成，原进度已保留，请稍后重试。', state: stateView(state, now, opts) })
          }
          return
        }
        try {
          if (accrueAmbient(state, now) > 0) dirty = true
          const message = applyAction(state, body, now, opts)
          dirty = true
          save()
          sendJson(res, 200, { ok: true, message, state: stateView(state, now, opts) })
        } catch (error) {
          if (dirty) save()
          sendJson(res, 200, { ok: false, message: error.message, state: stateView(state, now, opts) })
        }
      },
    }),
  )

  // Persist the garden when the plugin unloads; the file is the only durable copy.
  ctx.effect(() => () => save())

  if (dirty) save()
}

/** Pure helpers exported for the Node test suite. */
export const internals = {
  CROPS,
  STAGE_XP,
  STAGES: STAGE_PLOTS,
  TOKENS_PER_STONE,
  FERTILIZER_COST,
  FERTILIZER_BONUS,
  STONES_PER_XP,
  STARTUP_GRACE_MS,
  FIRST_SIGHT_CAP,
}
