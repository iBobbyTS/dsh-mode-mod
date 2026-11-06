/**
 * Overlay drift check — compares the Creator-mode preset override against the
 * shipped cordis preset declaration of a DeepSeek Harness checkout.
 *
 * Usage: node tools/verify-template.mjs [path-to-checkout]
 * (default: ../reference/deepseek-harness). Exits non-zero on drift so it can
 * run before shipping a plugin update; on drift, rebuild
 * presets/creator-cordis.patch.yml from the newer checkout's
 * packages/bundle/web-app/presets/cordis.patch.yml, keeping exactly two
 * deltas: the persona suffix and the inserted tool-executor-ptc row.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const checkout = process.argv[2] ?? resolve(import.meta.dirname, '..', '..', 'reference', 'deepseek-harness')
const shippedPath = resolve(checkout, 'packages/bundle/web-app/presets/cordis.patch.yml')
const overlayPath = resolve(import.meta.dirname, '..', 'presets', 'creator-cordis.patch.yml')
const require = createRequire(resolve(checkout, 'package.json'))
let load
try { load = require('js-yaml') } catch { load = null }
if (load === null) {
  try { load = createRequire(process.cwd() + '/package.json')('js-yaml') } catch { load = (await import('js-yaml')).default }
}

// Parse expressions as data; comparison must neither execute nor erase them.
const schema = load.DEFAULT_SCHEMA.extend(new load.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: expression => ({ $js: expression }),
}))
const parse = path => load.load(readFileSync(path, 'utf8'), { schema })

const shippedRows = parse(shippedPath)[0].insert[0].config.plugins
const overlayRows = parse(overlayPath)[0].config.plugins

const executorId = 'tool-executor-ptc'
const executorName = '@deepseek-ai/dsh-tool-executor-ptc'
const executors = overlayRows.filter(row => row.id === executorId || row.name === executorName)
if (executors.length !== 1 || executors[0].id !== executorId || executors[0].name !== executorName
    || (executors[0].disabled !== undefined && executors[0].disabled !== false)
    || Object.keys(executors[0]).some(key => !['id', 'name', 'disabled'].includes(key))) {
  console.error('mode-mod overlay must contain exactly one enabled native PTC executor with no extra configuration')
  process.exit(1)
}

/** Only the persona suffix and the checked PTC insertion may differ. */
const normalize = rows => JSON.stringify(rows
  .filter(row => row.id !== executorId)
  .map(row => {
    if (row.id !== 'persona' || row.config === undefined) return row
    const config = { ...row.config }
    delete config.suffix
    return { ...row, config }
  }))

const expected = normalize(shippedRows)
const actual = normalize(overlayRows)
if (expected !== actual) {
  console.error('mode-mod overlay drift: creator rows no longer match ' + shippedPath)
  console.error('Rebuild presets/creator-cordis.patch.yml from this checkout, keeping only the persona suffix and tool-executor-ptc deltas.')
  process.exit(1)
}
console.log('overlay ok: ' + overlayRows.length + ' rows match (persona suffix + tool-executor-ptc deltas excluded)')
