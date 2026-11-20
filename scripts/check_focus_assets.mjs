/** Strict art-delivery gate, separate from gameplay tests that permit tracked fallbacks. */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = new URL('../', import.meta.url)
const plan = JSON.parse(readFileSync(new URL('docs/focus-asset-plan.json', root), 'utf8'))
const manifest = JSON.parse(readFileSync(new URL('assets/manifest.json', root), 'utf8'))
const pending = []
for (const species of plan.species) {
  for (let stage = 0; stage < 4; stage += 1) {
    const key = `crop-${species.id}-${stage}`
    const entry = manifest[key]
    if (species.status !== 'ready' || !entry || !existsSync(fileURLToPath(new URL(entry.file, root)))) pending.push(key)
  }
}
console.log(`Focus plant sprites: ${48 - pending.length}/48 delivered`)
if (pending.length) {
  console.error('Pending:', pending.join(', '))
  process.exitCode = 1
}
