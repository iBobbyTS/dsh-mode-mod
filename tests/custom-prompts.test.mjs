import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after } from 'node:test'
import { apply } from '../lib/index.js'

const LIVE = 'session-11111111-2222-3333-4444-555555555555'
const CLOSED = 'session-66666666-7777-8888-9999-aaaaaaaaaaaa'
const CWD = '/repo/sub'

/** A throwaway DSH home: the stores are read and written relative to DSH_HOME. */
const fixtureRoot = mkdtempSync(join(tmpdir(), 'mode-mod-tests-'))
after(() => rmSync(fixtureRoot, { recursive: true, force: true }))

function home() {
  const dir = mkdtempSync(join(fixtureRoot, 'prompts-'))
  process.env.DSH_HOME = dir
  return dir
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sessionsFile(h) {
  return join(h, 'plugin/data/mode-mod/session-goal-overrides.json')
}

function projectsFile(h) {
  return join(h, 'plugin/data/mode-mod/project-system-prompt-preset.json')
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

/** Mount the plugin over a fake host; return its routes and lifecycle handlers. */
function host(agents = []) {
  const routes = new Map()
  const listeners = new Map()
  const ctx = {
    logger: { info() {}, warn() {} },
    webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } },
    get: (name) => (name === 'agents' ? { list: () => agents } : undefined),
    effect: (fn) => fn(),
    on: (event, fn) => {
      const list = listeners.get(event) ?? []
      list.push(fn)
      listeners.set(event, list)
      return () => {
        const index = list.indexOf(fn)
        if (index >= 0) list.splice(index, 1)
      }
    },
  }
  apply(ctx)
  // One dispatch per event reaches every listener, as the real Host does.
  const handlers = new Map()
  for (const [event, list] of listeners) handlers.set(event, (payload) => { for (const fn of [...list]) fn(payload) })
  return { routes, handlers }
}

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

function fixture() {
  const h = home()
  const live = agentFor(LIVE, { cwd: CWD })
  const plugin = host()
  plugin.handlers.get('agent/created')({ agent: live.agent })
  return { h, plugin, live }
}

async function create(plugin, preset) {
  return callRoute(plugin.routes.get('/api/mode-mod/prompt'), {
    body: { action: 'create', preset },
  })
}

test('create, list, update, and built-in protection', async () => {
  const { h, plugin } = fixture()
  await settle()

  const created = await create(plugin, { title: 'Data review', description: 'Review data work', prompt: '# Data Review\n\nCheck the pipeline.' })
  assert.equal(created.status, 200)
  assert.match(created.body.createdId, /^custom-[0-9a-f]{12}$/)
  assert.equal(created.body.custom.length, 1)
  assert.equal(created.body.custom[0].title, 'Data review')
  assert.equal(readJson(join(h, 'plugin/data/mode-mod/custom-system-prompts.json')).prompts.length, 1)

  const list = await callRoute(plugin.routes.get('/api/mode-mod/prompts'))
  assert.equal(list.status, 200)
  assert.equal(list.body.builtins.length, 7)
  assert.equal(list.body.builtins[0].prompt.length > 100, true)
  assert.equal(list.body.custom.length, 1)

  const id = created.body.createdId
  const updated = await callRoute(plugin.routes.get('/api/mode-mod/prompt'), {
    body: { action: 'update', id, preset: { title: 'Data review v2', prompt: '# Data Review v2' } },
  })
  assert.equal(updated.status, 200)
  assert.equal(updated.body.custom[0].title, 'Data review v2')
  assert.equal(updated.body.custom[0].description, 'Review data work')
  assert.equal(updated.body.custom[0].prompt, '# Data Review v2')

  const builtinUpdate = await callRoute(plugin.routes.get('/api/mode-mod/prompt'), {
    body: { action: 'update', id: 'research', preset: { title: 'Hacked' } },
  })
  assert.equal(builtinUpdate.status, 400)

  const builtinDelete = await callRoute(plugin.routes.get('/api/mode-mod/prompt'), {
    body: { action: 'delete', id: 'research' },
  })
  assert.equal(builtinDelete.status, 400)

  const tooLong = await callRoute(plugin.routes.get('/api/mode-mod/prompt'), {
    body: { action: 'update', id, preset: { title: 'x'.repeat(81) } },
  })
  assert.equal(tooLong.status, 400)

  const missing = await callRoute(plugin.routes.get('/api/mode-mod/prompt'), {
    body: { action: 'update', id: 'custom-000000000000', preset: { title: 'x' } },
  })
  assert.equal(missing.status, 404)
})

test('deleting a custom preset nulls every reference and never rewrites a running session prompt', async () => {
  const { h, plugin, live } = fixture()
  await settle()

  const created = await create(plugin, { title: 'Project rules', description: '', prompt: '# Project Rules\n\nKeep it focused.' })
  assert.equal(created.status, 200)
  const id = created.body.createdId

  // Assemble once before the switch, so the session's committed text carries
  // the supersedes header — the exact bytes the deletion must preserve.
  live.sections.get('mode-mod:goal').text()

  // The running session selects it, and the project default also points at it.
  const picked = await callRoute(plugin.routes.get('/api/mode-mod/goal'), { body: { session: LIVE, value: id } })
  assert.equal(picked.status, 200)
  const section = live.sections.get('mode-mod:goal')
  const before = section.text()
  assert.match(before, /# Project Rules/)
  assert.equal(picked.body.sessionValue, id)

  const project = await callRoute(plugin.routes.get('/api/mode-mod/project'), { body: { session: LIVE, value: id } })
  assert.equal(project.status, 200)
  assert.equal(readJson(projectsFile(h)).projects[CWD], id)

  // A closed session keeps its stored value too.
  const closed = await callRoute(plugin.routes.get('/api/mode-mod/goal'), { body: { session: CLOSED, value: id } })
  assert.equal(closed.status, 200)
  assert.equal(readJson(sessionsFile(h)).sessions[LIVE], id)
  assert.equal(readJson(sessionsFile(h)).sessions[CLOSED], id)

  const deleted = await callRoute(plugin.routes.get('/api/mode-mod/prompt'), {
    body: { action: 'delete', id },
  })
  assert.equal(deleted.status, 200)
  assert.equal(deleted.body.custom.length, 0)
  assert.equal(deleted.body.deletedId, id)

  // References are null, not "none": the keys are gone and the project entry is gone.
  const stored = readJson(sessionsFile(h))
  assert.equal(Object.prototype.hasOwnProperty.call(stored.sessions, LIVE), false)
  assert.equal(Object.prototype.hasOwnProperty.call(stored.sessions, CLOSED), false)
  assert.equal(stored.retired[LIVE].id, id)
  assert.equal(stored.retired[LIVE].text, before)
  assert.equal(stored.retired[CLOSED].id, id)
  assert.equal(stored.retired[CLOSED].text, '# Project Rules\n\nKeep it focused.')
  assert.equal(readJson(projectsFile(h)).projects[CWD], undefined)

  // The running session's committed section text is byte-identical.
  assert.equal(section.text(), before)

  // The state reports the null selection plus the retired prompt's name.
  const state = await callRoute(plugin.routes.get('/api/mode-mod/state'), { url: '/api/mode-mod/state?session=' + LIVE })
  assert.equal(state.status, 200)
  assert.equal(state.body.sessionValue, null)
  assert.equal(state.body.effectiveGoal, null)
  assert.equal(state.body.retiredGoalName, 'Project rules')
  assert.equal(state.body.goals.some((goal) => goal.id === id), false)

  // Restart over the same home: the resumed session still renders the text
  // it committed before the deletion, not an inherited preset.
  const resumed = agentFor(LIVE, { cwd: CWD })
  const restarted = host([resumed.agent])
  await settle()
  const resumedSection = resumed.sections.get('mode-mod:goal')
  assert.equal(resumedSection.text(), before)
  const resumedState = await callRoute(restarted.routes.get('/api/mode-mod/state'), { url: '/api/mode-mod/state?session=' + LIVE })
  assert.equal(resumedState.body.retiredGoalName, 'Project rules')

  // Only an explicit pick replaces the frozen text, and it clears the record.
  const next = await callRoute(restarted.routes.get('/api/mode-mod/goal'), { body: { session: LIVE, value: 'none' } })
  assert.equal(next.status, 200)
  assert.equal(next.body.retiredGoal, null)
  assert.equal(resumedSection.text(), '')
  assert.equal(readJson(sessionsFile(h)).retired[LIVE], undefined)
})
