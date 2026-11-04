/**
 * Overlay drift check — compares the Creator-mode preset override against the
 * shipped cordis preset declaration of a DeepSeek Harness checkout.
 *
 * Usage: node tools/verify-template.mjs [path-to-checkout]
 * (default: ../reference/deepseek-harness). Exits non-zero on drift so it can
 * run before shipping a plugin update; on drift, rebuild
 * presets/creator-cordis.patch.yml from the newer checkout's
 * packages/bundle/web-app/presets/cordis.patch.yml, keeping exactly two
 * deltas: the persona suffix and the inserted tool-presentation row.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const checkout = process.argv[2] ?? resolve(import.meta.dirname, '..', '..', 'reference', 'deepseek-harness')
const shippedPath = resolve(checkout, 'packages/bundle/web-app/presets/cordis.patch.yml')
const overlayPath = resolve(import.meta.dirname, '..', 'presets', 'creator-cordis.patch.yml')
const require = createRequire(resolve(checkout, 'package.json'))
let load
try { load = require('js-yaml').load } catch { load = null }
if (load === null) {
  try { load = createRequire(process.cwd() + '/package.json')('js-yaml').load } catch { load = (await import('js-yaml')).default.load }
}

/** Neutralize !!js conditions before YAML parsing so both sides compare as markers. */
const parse = (path) => {
  const raw = readFileSync(path, 'utf8').replace(/!!js (.+)$/gm, 'JSNEUTRAL')
  return load(raw)
}

const shippedRows = parse(shippedPath)[0].insert[0].config.plugins
const overlayRows = parse(overlayPath)[0].config.plugins

/** Drop the two declared deltas so everything left must match the shipped tree. */
const normalize = (rows) => {
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk)
    if (value !== null && typeof value === 'object') {
      const out = {}
      for (const [key, item] of Object.entries(value)) {
        if (key === 'disabled') out[key] = 'JSNEUTRAL'
        else out[key] = walk(item)
      }
      return out
    }
    return value
  }
  const cleaned = walk(rows)
    .filter((row) => row.id !== 'tool-presentation')
    .map((row) => {
      if (row.id !== 'persona' || row.config === undefined) return row
      const config = { ...row.config }
      delete config.suffix
      return { ...row, config }
    })
  return JSON.stringify(cleaned)
}

const expected = normalize(shippedRows)
const actual = normalize(overlayRows)
if (expected !== actual) {
  console.error('mode-mod overlay drift: creator rows no longer match ' + shippedPath)
  console.error('Rebuild presets/creator-cordis.patch.yml from this checkout, keeping only the persona suffix and tool-presentation deltas.')
  process.exit(1)
}
console.log('overlay ok: ' + overlayRows.length + ' rows match (persona suffix + tool-presentation deltas excluded)')
