import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { load } from 'js-yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const patchPath = join(root, 'presets/web-research.patch.yml')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** The one preset declaration this patch adds. */
function declaration() {
  const docs = load(readFileSync(patchPath, 'utf8'))
  assert.ok(Array.isArray(docs), 'the patch must be a YAML sequence')
  assert.equal(docs.length, 1, 'the patch must be one YAML document')
  const rows = docs[0]?.insert
  assert.ok(Array.isArray(rows), 'the patch must insert rows')
  const preset = rows.find((row) => row.id === 'preset-web-research')
  assert.ok(preset, 'missing preset-web-research row')
  return preset
}

test('the web-research preset is declared after the shipped modes', () => {
  const preset = declaration()
  assert.equal(preset.name, '@deepseek-ai/dsh-agent-preset')
  assert.equal(preset.config.id, 'web-research')
  assert.equal(preset.config.name, '资料搜索')
  assert.equal(preset.config.order, 5)
  assert.ok(preset.config.description.trim().length > 0)
  for (const shipped of ['standard', 'ptc', 'minimal', 'cordis']) {
    assert.notEqual(preset.config.id, shipped)
  }
})

test('the preset mounts only prompt/context rows and the browser tool mask', () => {
  const preset = declaration()
  const ids = preset.config.plugins.map((plugin) => plugin.id)
  assert.deepEqual(ids, ['persona', 'compaction', 'web-research-toolset'])
  const names = preset.config.plugins.map((plugin) => plugin.name)
  assert.deepEqual(names, [
    '@deepseek-ai/dsh-persona',
    'cordis:group',
    '@local/dsh-mode-mod/web-research',
  ])
  // No time-context row: the mode injects no clock message either.
  assert.equal(names.includes('@deepseek-ai/dsh-time-context'), false)
  // No model-facing tool plugin (bash, fs, web, skill, subagent, present,
  // goal, todo, plugin manager, PTC) may be mounted here: the mask owns the
  // tool boundary, and this preset contributes no scoped tool of its own.
  for (const name of names) {
    assert.equal(/tool-|command-|skill|present|subagent|workflow/.test(name), false, `tool plugin mounted: ${name}`)
  }
  const compaction = preset.config.plugins.find((plugin) => plugin.id === 'compaction')
  assert.equal(compaction.group, true)
  assert.deepEqual(compaction.config.map((row) => row.id), ['compaction-basic', 'command-compact', 'tool-result-pruner'])
})

test('the persona states the research boundaries the contract requires', () => {
  const preset = declaration()
  const persona = preset.config.plugins.find((plugin) => plugin.id === 'persona')
  const text = persona.config.prefix
  assert.match(text, /only tools are the Playwright browser tools/)
  assert.match(text, /Do not log in or register/)
  assert.match(text, /do not try to bypass it/)
  assert.match(text, /two independent sources/)
  assert.match(text, /Start with the conclusion/)
  assert.match(text, /You cannot read local files or run commands/)
  assert.equal(persona.config.complete, undefined, 'complete mode would suppress the tool guidance as well')
  // The runtime-context snapshot is suppressed for this mode; the mask shadows
  // the one required entry (working directory) that suppression would keep.
  assert.equal(persona.config.includeRuntimeContext, false)
})

test('the package ships and exports the preset and its mask module', () => {
  assert.ok(manifest.dsh.bundle.patch.includes('./presets/web-research.patch.yml'))
  assert.equal(manifest.exports['./web-research'], './lib/web-research.js')
  assert.ok(existsSync(join(root, manifest.exports['./web-research'])), 'the built mask module is missing')
  assert.ok(existsSync(patchPath))
})
