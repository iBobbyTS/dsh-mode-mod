import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

// Run the actual CLI from an isolated fixture; never rewrite the real overlay.
function check(overlay, shipped = base) {
  const root = mkdtempSync(join(tmpdir(), 'mode-mod-template-'))
  try {
    const tool = join(root, 'tools/verify-template.mjs')
    mkdirSync(join(root, 'tools'), { recursive: true })
    mkdirSync(join(root, 'presets'))
    mkdirSync(join(root, 'checkout/packages/bundle/web-app/presets'), { recursive: true })
    copyFileSync(new URL('../tools/verify-template.mjs', import.meta.url), tool)
    writeFileSync(join(root, 'checkout/package.json'), '{}')
    writeFileSync(join(root, 'checkout/packages/bundle/web-app/presets/cordis.patch.yml'), `- insert:\n    - config:\n        plugins:\n${indent(shipped, 10)}`)
    writeFileSync(join(root, 'presets/creator-cordis.patch.yml'), `- config:\n    plugins:\n${indent(overlay, 6)}`)
    return spawnSync(process.execPath, [tool, join(root, 'checkout')], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const indent = (value, amount) => value.split('\n').map(line => ' '.repeat(amount) + line).join('\n') + '\n'
const base = `- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: Agent
- id: bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'
- id: manager
  name: manager
  disabled: true`
const executor = `\n- id: tool-executor-ptc\n  name: '@deepseek-ai/dsh-tool-executor-ptc'`
const overlay = base.replace('prefix: Agent', 'prefix: Agent\n    suffix: Local persona') + executor

test('accepts exactly the persona suffix and enabled PTC insertion', () => {
  const result = check(overlay)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /overlay ok/)
})

for (const [name, changed] of [
  ['changed JS condition', overlay.replace("process.platform === 'win32'", "process.platform !== 'win32'")],
  ['changed JS path', overlay.replace("process.platform === 'win32'", "ctx.get('different')")],
  ['changed static disabled', overlay.replace('disabled: true', 'disabled: false')],
  ['missing executor', base],
  ['duplicate executor', overlay + executor],
  ['wrong executor package', overlay.replace("name: '@deepseek-ai/dsh-tool-executor-ptc'", "name: '@deepseek-ai/dsh-tool-executor-native'")],
  ['disabled executor', overlay + '\n  disabled: true'],
  ['conditional executor', overlay + '\n  disabled: !!js false'],
  ['extra executor config', overlay + '\n  config: { unexpected: true }'],
]) {
  test(`rejects ${name}`, () => {
    const result = check(changed)
    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, /overlay drift|exactly one enabled native PTC executor/)
  })
}
