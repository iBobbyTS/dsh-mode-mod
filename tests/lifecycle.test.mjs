import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../src/index.js'
import { PTC_GUIDANCE_TEXT } from '../src/guidance.js'

function fixture() {
  const pluginEffects = []
  const agentEffects = []
  const sections = new Map()
  let onCreated
  let active = true
  let preset = 'ptc'
  const registry = { composedPreset: () => preset }
  const prompt = {
    getSectionOrder: () => 1,
    section(section) {
      assert.equal(sections.has(section.name), false)
      sections.set(section.name, section)
      return () => sections.delete(section.name)
    },
  }
  const ctx = {
    logger: { warn: assert.fail, info() {} },
    get agentPresets() {
      if (!active) throw new Error('cannot get required service "agentPresets" in inactive context')
      return registry
    },
    webServer: { register: () => () => {} },
    effect: (fn) => pluginEffects.push(fn()),
    on: (_, fn) => { onCreated = fn; return () => { onCreated = undefined } },
  }
  const agent = {
    id: 'test-agent',
    session: { id: 'mode-mod-lifecycle-test', header: {} },
    ctx: {
      get: (name) => ({ systemPrompt: prompt, agentPresets: registry })[name],
      effect: (fn) => agentEffects.push(fn()),
    },
  }
  apply(ctx)
  onCreated({ agent })
  return {
    sections,
    deactivate: () => { active = false },
    preset: (value) => { preset = value },
    disposePlugin: () => { active = false; pluginEffects.reverse().forEach((fn) => fn?.()) },
    disposeAgent: () => agentEffects.reverse().forEach((fn) => fn?.()),
  }
}

test('guidance reads the live agent registry after the registering context becomes inactive', () => {
  const f = fixture()
  const guidance = f.sections.get('mode-mod:ptc-guidance')
  assert.equal(guidance.text(), PTC_GUIDANCE_TEXT)
  f.deactivate()
  assert.equal(guidance.text(), PTC_GUIDANCE_TEXT)
  f.preset('standard')
  assert.equal(guidance.text(), '')
  f.preset('cordis')
  assert.equal(guidance.text(), PTC_GUIDANCE_TEXT)
  f.disposePlugin()
  f.disposeAgent()
})

for (const first of ['Plugin', 'Agent']) {
  test(`sections are removed when ${first.toLowerCase()} is disposed first`, () => {
    const f = fixture()
    assert.equal(f.sections.size, 2)
    f[`dispose${first}`]()
    assert.equal(f.sections.size, 0)
    f[first === 'Plugin' ? 'disposeAgent' : 'disposePlugin']()
    assert.equal(f.sections.size, 0)
  })
}
