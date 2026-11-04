import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { apply } from '../src/index.js'

const SESSION = 'session-11111111-2222-3333-4444-555555555555'
const FORK = 'session-66666666-7777-8888-9999-aaaaaaaaaaaa'
const SUBAGENT = 'session-bbbbbbbb-cccc-dddd-eeee-ffffffffffff'

/** A throwaway DSH home: the store is read and written relative to DSH_HOME. */
function home() {
  const dir = mkdtempSync(join(tmpdir(), 'mode-mod-freeze-'))
  process.env.DSH_HOME = dir
  return dir
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

function projectStore(h, projects) {
  writeJson(join(h, 'plugin/data/mode-mod/project-system-prompt-preset.json'), { version: 1, projects })
}

function sessionValues(h) {
  return JSON.parse(readFileSync(join(h, 'plugin/data/mode-mod/session-goal-overrides.json'), 'utf8')).sessions
}

/** One agent with its own prompt-section map. */
function agentFor(sessionId, header) {
  const sections = new Map()
  const prompt = {
    getSectionOrder: () => 0,
    section(section) {
      sections.set(section.name, section)
      return () => sections.delete(section.name)
    },
  }
  const registry = { composedPreset: () => 'ptc' }
  const agent = {
    id: 'agent-' + sessionId,
    session: { id: sessionId, header },
    ctx: {
      get: (name) => ({ systemPrompt: prompt, agentPresets: registry })[name],
      effect: (fn) => fn(),
    },
  }
  return { agent, sections }
}

/** Mount the plugin over a fake host and expose its routes and lifecycle handlers. */
function host(agents = []) {
  const routes = new Map()
  const handlers = new Map()
  const ctx = {
    logger: { info() {}, warn() {} },
    webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } },
    get: (name) => (name === 'agents' ? { list: () => agents } : undefined),
    effect: (fn) => fn(),
    on: (event, fn) => { handlers.set(event, fn); return () => handlers.delete(event) },
  }
  apply(ctx)
  return { routes, handlers }
}

/** Wait for the plugin's boot hydration (and any freeze write it then starts). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60))

function fakeRequest(url, body) {
  const listeners = new Map()
  const req = {
    url,
    headers: { host: '127.0.0.1:1' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, fn) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn])
      return req
    },
    destroy() {},
  }
  queueMicrotask(() => {
    if (body !== undefined) for (const fn of listeners.get('data') ?? []) fn(Buffer.from(JSON.stringify(body)))
    for (const fn of listeners.get('end') ?? []) fn()
  })
  return req
}

async function callRoute(route, { url = '/', body } = {}) {
  const res = {
    status: 0,
    body: undefined,
    writeHead(status) { this.status = status },
    end(payload) { this.body = JSON.parse(payload) },
  }
  await route.handler(fakeRequest(url, body), res)
  return res
}

test('the first assembly pins the inherited default; a later project change never moves that session', async () => {
  const h = home()
  projectStore(h, { '/repo': 'host-extension' })
  const first = agentFor(SESSION, { cwd: '/repo/sub' })
  const plugin = host()
  plugin.handlers.get('agent/created')({ agent: first.agent })
  await settle()
  // First assembly (before or after hydration) reports the inherited goal.
  assert.match(first.sections.get('mode-mod:goal').text(), /# Host Plugins and Application Extensions/)
  await settle()
  assert.deepEqual(sessionValues(h), { [SESSION]: 'host-extension' })

  // The project default changes, and the app restarts over the same home.
  projectStore(h, { '/repo': 'research' })
  const reopened = agentFor(SESSION, { cwd: '/repo/sub' })
  const restarted = host()
  restarted.handlers.get('agent/created')({ agent: reopened.agent })
  await settle()
  assert.match(reopened.sections.get('mode-mod:goal').text(), /# Host Plugins and Application Extensions/)
  assert.deepEqual(sessionValues(h), { [SESSION]: 'host-extension' })

  // A session that starts after the change inherits the new default.
  const fresh = agentFor(SUBAGENT, { cwd: '/repo/sub' })
  restarted.handlers.get('agent/created')({ agent: fresh.agent })
  await settle()
  assert.match(fresh.sections.get('mode-mod:goal').text(), /# Scientific Research and Algorithm Experiments/)
  await settle()
  assert.deepEqual(sessionValues(h), { [SESSION]: 'host-extension', [SUBAGENT]: 'research' })
})

test('a seeded fork owns a goal; a subagent session only carries the guidance', async () => {
  const h = home()
  projectStore(h, { '/repo': 'software' })
  const fork = agentFor(FORK, { cwd: '/repo', parentSession: SESSION, isSeeded: true, delegationDepth: 0 })
  const subagent = agentFor(SUBAGENT, { cwd: '/repo', parentSession: SESSION, origin: 'subagent', delegationDepth: 1 })
  const plugin = host()
  plugin.handlers.get('agent/created')({ agent: fork.agent })
  plugin.handlers.get('agent/created')({ agent: subagent.agent })
  await settle()
  assert.match(fork.sections.get('mode-mod:goal').text(), /# Long-Lived Applications and Business Software/)
  assert.equal(subagent.sections.has('mode-mod:goal'), false)
  assert.equal(subagent.sections.has('mode-mod:ptc-guidance'), true)
})

test('agents that already existed when the plugin loaded receive their sections', async () => {
  const h = home()
  projectStore(h, { '/repo': 'prototype' })
  const existing = agentFor(SESSION, { cwd: '/repo' })
  // Registered in the live registry, but agent/created fired before apply().
  host([existing.agent])
  await settle()
  assert.match(existing.sections.get('mode-mod:goal').text(), /# Rapid Prototyping and Feasibility/)
})

test('a session with no live agent has no goal, and a closed session keeps the value it was given', async () => {
  const h = home()
  projectStore(h, { '/repo': 'software' })
  const plugin = host()
  const state = plugin.routes.get('/api/mode-mod/state')

  // Never opened in this process and never picked: reads as no goal.
  const cold = await callRoute(state, { url: '/api/mode-mod/state?session=' + SUBAGENT })
  assert.equal(cold.body.known, false)
  assert.equal(cold.body.sessionValue, null)
  assert.equal(cold.body.effectiveGoal, null)

  // A live session picks a goal, then the session closes (plugin restarted).
  const live = agentFor(SESSION, { cwd: '/repo' })
  plugin.handlers.get('agent/created')({ agent: live.agent })
  await settle()
  const picked = await callRoute(plugin.routes.get('/api/mode-mod/goal'), {
    url: '/api/mode-mod/goal',
    body: { session: SESSION, value: 'research' },
  })
  assert.equal(picked.status, 200)
  assert.equal(picked.body.sessionValue, 'research')

  const restarted = host()
  const after = await callRoute(restarted.routes.get('/api/mode-mod/state'), { url: '/api/mode-mod/state?session=' + SESSION })
  assert.equal(after.body.known, false)
  assert.equal(after.body.sessionValue, 'research')
  assert.equal(after.body.effectiveGoalName, 'Research')

  // A valid id with no live agent can still be given a value.
  const late = await callRoute(restarted.routes.get('/api/mode-mod/goal'), {
    url: '/api/mode-mod/goal',
    body: { session: SUBAGENT, value: 'utility' },
  })
  assert.equal(late.status, 200)
  assert.equal(late.body.sessionValue, 'utility')

  // A malformed id is refused.
  const bogus = await callRoute(restarted.routes.get('/api/mode-mod/goal'), {
    url: '/api/mode-mod/goal',
    body: { session: 'not-a-session', value: 'utility' },
  })
  assert.equal(bogus.status, 404)
})
