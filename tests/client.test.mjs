import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import * as React from 'react'

function client() {
  let registration
  const calls = []
  const entries = []
  const table = { react: React, '@deepseek-ai/dsh-client-ui-primitives': {
    Menu() {}, IconChevronDownOutlineRegular() {}, IconGoalOutlineRegular() {},
  } }
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { registration = value } } },
    document: { baseURI: 'http://localhost:9900/ui/', documentElement: { lang: 'en' } },
    URL, TextEncoder,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return { ok: true, json: async () => ({ known: true, goals: [] }) }
    },
  })
  assert.equal(registration.id, '@local/dsh-mode-mod')
  const plugin = registration.factory(id => { assert.ok(id in table, `unexpected module: ${id}`); return table[id] })
  assert.deepEqual(Array.from(plugin.inject), ['slots'])
  plugin.apply({ slots: {
    inject(name, register) { register() },
    register(options, component) { entries.push({ options, component }); return () => {} },
  } })
  return { calls, entries }
}

test('built Client keeps the native hero, header and settings registrations', () => {
  const { entries } = client()
  assert.deepEqual(entries.map(({ options }) => [options.name, options.id, options.order]), [
    ['conversation.hero.options', 'mode-mod-goal-picker', 0],
    ['conversation.session.header.actions', 'mode-mod-goal-switch', 0],
    ['settings.section', 'mode-mod-prompts', 25],
  ])
  assert.equal(entries[0].component, entries[1].component)
  assert.equal(entries[0].options.inject('session-a').seat, 'hero')
  assert.equal(entries[1].options.inject('session-a').seat, 'header')
  assert.equal(entries[2].options.label(), 'System prompt management')
})

test('built Client preserves API URL, session identity, null and explicit none', async () => {
  const { entries, calls } = client()
  const { modeMod } = entries[0].options.inject('session-a')
  await modeMod.load('session/a')
  await modeMod.goal('session-a', 'none')
  await modeMod.project('session-b', null)
  assert.equal(calls[0].url, 'http://localhost:9900/ui/api/mode-mod/state?session=session%2Fa')
  assert.equal(calls[1].url, 'http://localhost:9900/ui/api/mode-mod/goal')
  assert.equal(calls[1].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[1].init.body), { session: 'session-a', value: 'none' })
  assert.deepEqual(JSON.parse(calls[2].init.body), { session: 'session-b', value: null })
})
