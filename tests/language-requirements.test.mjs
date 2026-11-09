import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after } from 'node:test'
import { apply } from '../lib/index.js'

const LIVE = 'session-11111111-2222-3333-4444-555555555555'
const OTHER = 'session-66666666-7777-8888-9999-aaaaaaaaaaaa'
const SUBAGENT = 'session-bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
const CWD = '/repo/sub'
const OTHER_CWD = '/other/project'

const ENTRY_A = 'lang-aaaaaaaaaaaa'
const ENTRY_B = 'lang-bbbbbbbbbbbb'
const SOURCE_KIND = 'mode-mod-language'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** A throwaway DSH home: the stores are read and written relative to DSH_HOME. */
const fixtureRoot = mkdtempSync(join(tmpdir(), 'mode-mod-language-'))
after(() => rmSync(fixtureRoot, { recursive: true, force: true }))

function home() {
  const dir = mkdtempSync(join(fixtureRoot, 'home-'))
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

function entriesFile(h) {
  return join(h, 'plugin/data/mode-mod/language-requirements.json')
}

function projectsFile(h) {
  return join(h, 'plugin/data/mode-mod/project-language-requirements.json')
}

function entryRow(id, title, prompt, version = 1) {
  return { id, title, prompt, version, createdAt: 0, updatedAt: 0 }
}

/** Seed both stores directly (fixtures that predate a plugin instance). */
function seed(h, { entries = [], projects = {} } = {}) {
  writeJson(entriesFile(h), { version: 1, entries })
  writeJson(projectsFile(h), { version: 1, projects })
}

/* ------------------------------------------------------------------ */
/* Fake Host: every listener per event, a prompt-section fake, and an  */
/* agent whose inbox/status/history the test drives explicitly.        */
/* ------------------------------------------------------------------ */

function agentFor(sessionId, header, { status = 'idle', history = [], inbox } = {}) {
  const sections = new Map()
  const prompt = {
    getSectionOrder: () => 0,
    section(section) {
      sections.set(section.name, section)
      return () => sections.delete(section.name)
    },
  }
  const registry = { composedPreset: () => 'ptc' }
  const state = {
    status,
    history: [...history],
    inbox: { nextStep: [...(inbox?.nextStep ?? [])], nextTurn: [...(inbox?.nextTurn ?? [])] },
  }
  const sent = []
  const agent = {
    id: 'agent-' + sessionId,
    session: {
      id: sessionId,
      header,
      snapshotEvents: () => state.history,
      ownEvents: () => state.history,
    },
    get status() { return state.status },
    get inbox() { return state.inbox },
    send(message, target, wakeup) {
      sent.push({ message, target, wakeup })
      state.inbox[target === 'next-turn' ? 'nextTurn' : 'nextStep'].push(message)
    },
    ctx: {
      get: (name) => ({ systemPrompt: prompt, agentPresets: registry })[name],
      effect: (fn) => fn(),
    },
  }
  return { agent, sections, sent, state }
}

function host(agents = []) {
  const routes = new Map()
  const listeners = new Map()
  const effects = []
  const ctx = {
    logger: { info() {}, warn() {} },
    webServer: { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } },
    get: (name) => (name === 'agents' ? { list: () => agents } : undefined),
    effect: (fn) => { effects.push(fn()) },
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
  return {
    routes,
    effects,
    emit(event, ...args) {
      for (const fn of [...(listeners.get(event) ?? [])]) fn(...args)
    },
  }
}

/** Let the async delivery chain (hydration + queued passes) finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 90))

function fakeRequest(url, body, headers = {}) {
  const listeners = new Map()
  const req = {
    url,
    headers: { host: '127.0.0.1:1', ...headers },
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

async function callRoute(route, { url = '/', body, headers } = {}) {
  const res = {
    status: 0,
    body: undefined,
    writeHead(status) { this.status = status },
    end(payload) { this.body = JSON.parse(payload) },
  }
  await route.handler(fakeRequest(url, body, headers), res)
  return res
}

async function createEntry(plugin, entry) {
  return callRoute(plugin.routes.get('/api/mode-mod/language'), { body: { action: 'create', entry } })
}

async function updateEntry(plugin, id, entry) {
  return callRoute(plugin.routes.get('/api/mode-mod/language'), { body: { action: 'update', id, entry } })
}

async function deleteEntry(plugin, id) {
  return callRoute(plugin.routes.get('/api/mode-mod/language'), { body: { action: 'delete', id } })
}

async function select(plugin, session, ids) {
  return callRoute(plugin.routes.get('/api/mode-mod/language-selection'), { body: { session, ids } })
}

/** Claim one pending message out of the fake inbox and publish the live event. */
function claim(plugin, fixture, message) {
  for (const list of [fixture.state.inbox.nextStep, fixture.state.inbox.nextTurn]) {
    const index = list.findIndex((item) => item.id === message.id)
    if (index >= 0) list.splice(index, 1)
  }
  plugin.emit('agent/inbox/claimed', { agent: fixture.agent, message, turn: 1 })
}

/** Admit a claimed message to history and publish the durable session event. */
function admit(plugin, fixture, message) {
  const event = { type: 'user/message', data: message }
  fixture.state.history.push(event)
  plugin.emit('session/event', fixture.agent.session, event)
}

function setStatus(plugin, fixture, status) {
  fixture.state.status = status
  plugin.emit('agent/status', { agent: fixture.agent, status })
}

function keysOf(sent) {
  return sent.map(({ message }) => message.source.entryId + ':' + message.source.entryVersion)
}

/* ------------------------------------------------------------------ */
/* REQ-001: global entries                                             */
/* ------------------------------------------------------------------ */

test('entries are created, versioned, listed, and deleted through the store', async () => {
  const h = home()
  const plugin = host()
  await settle()

  const created = await createEntry(plugin, { title: 'Rust', prompt: '# Rust\n\nPrefer explicit error types.' })
  assert.equal(created.status, 200)
  assert.equal(created.body.entries.length, 1)
  const id = created.body.entries[0].id
  assert.match(id, /^lang-[0-9a-f]{12}$/)
  assert.equal(created.body.entries[0].version, 1)
  assert.equal(created.body.entries[0].title, 'Rust')
  assert.equal(readJson(entriesFile(h)).entries[0].id, id)

  // A title-only save does not advance the body version.
  const renamed = await updateEntry(plugin, id, { title: 'Rust (stable)' })
  assert.equal(renamed.status, 200)
  assert.equal(renamed.body.entries[0].version, 1)

  // An actual body change advances it.
  const edited = await updateEntry(plugin, id, { prompt: '# Rust\n\nNo unwrap in library code.' })
  assert.equal(edited.status, 200)
  assert.equal(edited.body.entries[0].version, 2)

  // A save that normalizes to the same body changes nothing.
  const unchanged = await updateEntry(plugin, id, { prompt: '  # Rust\n\nNo unwrap in library code.\n' })
  assert.equal(unchanged.status, 200)
  assert.equal(unchanged.body.entries[0].version, 2)

  // Validation and missing ids map to 4xx.
  assert.equal((await updateEntry(plugin, id, { title: 'x'.repeat(81) })).status, 400)
  assert.equal((await updateEntry(plugin, 'lang-000000000000', { title: 'x' })).status, 404)
  assert.equal((await deleteEntry(plugin, 'lang-000000000000')).status, 404)

  // The manager reads the global list without a session.
  const listed = await callRoute(plugin.routes.get('/api/mode-mod/languages'), { url: '/api/mode-mod/languages?session=' })
  assert.equal(listed.status, 200)
  assert.equal(listed.body.entries.length, 1)
  assert.equal(listed.body.projectRoot, null)
  assert.deepEqual(listed.body.selected, [])

  const deleted = await deleteEntry(plugin, id)
  assert.equal(deleted.status, 200)
  assert.deepEqual(deleted.body.entries, [])
  assert.deepEqual(readJson(entriesFile(h)).entries, [])
})

/* ------------------------------------------------------------------ */
/* REQ-002 / EX-004 / EX-007: project-level multi-selection            */
/* ------------------------------------------------------------------ */

test('the project selection is stored per project and shared by every entry point', async () => {
  const h = home()
  const live = agentFor(LIVE, { cwd: CWD })
  const plugin = host()
  plugin.emit('agent/created', { agent: live.agent })
  await settle()

  const a = (await createEntry(plugin, { title: 'Rust', prompt: 'Rust rules' })).body.entries[0]
  const b = (await createEntry(plugin, { title: 'Python', prompt: 'Python rules' })).body.entries[1]
  await settle()
  // The two earlier passes saw no selection; a fresh agent gets nothing yet.
  assert.equal(live.sent.length, 0)

  const selected = await select(plugin, LIVE, [a.id, b.id])
  assert.equal(selected.status, 200)
  assert.equal(selected.body.projectRoot, CWD)
  assert.deepEqual(selected.body.selected, [a.id, b.id])
  assert.deepEqual(readJson(projectsFile(h)).projects[CWD], [a.id, b.id])

  // Both picker seats read this same payload.
  const read = await callRoute(plugin.routes.get('/api/mode-mod/languages'), { url: '/api/mode-mod/languages?session=' + LIVE })
  assert.equal(read.status, 200)
  assert.deepEqual(read.body.selected, [a.id, b.id])
  assert.equal(read.body.entries.length, 2)

  // Unknown ids, drafts and non-arrays are refused; nothing is written.
  assert.equal((await select(plugin, LIVE, [a.id, 'lang-ffffffffffff'])).status, 400)
  assert.equal((await callRoute(plugin.routes.get('/api/mode-mod/language-selection'), { body: { session: LIVE, ids: 'x' } })).status, 400)
  const draft = (await createEntry(plugin, { title: 'Draft', prompt: '' })).body.entries[2]
  assert.equal((await select(plugin, LIVE, [draft.id])).status, 400)
  assert.deepEqual(readJson(projectsFile(h)).projects[CWD], [a.id, b.id])

  // A closed/unknown session cannot resolve a project root.
  assert.equal((await select(plugin, OTHER, [a.id])).status, 404)

  // Removing everything deletes the project key instead of storing [].
  const cleared = await select(plugin, LIVE, [])
  assert.equal(cleared.status, 200)
  assert.deepEqual(cleared.body.selected, [])
  assert.equal(readJson(projectsFile(h)).projects[CWD], undefined)
})

/* ------------------------------------------------------------------ */
/* EX-001 / REQ-003 / REQ-010: new session, zero system prompt change  */
/* ------------------------------------------------------------------ */

test('a new session receives every selected entry as persistent user context, with no prompt change', async () => {
  const h = home()
  seed(h, {
    entries: [entryRow(ENTRY_A, 'Rust', 'Prefer explicit error types.'), entryRow(ENTRY_B, 'Python', 'Use type hints.')],
    projects: { [CWD]: [ENTRY_A, ENTRY_B] },
  })
  const live = agentFor(LIVE, { cwd: CWD })
  assert.equal(live.sections.size, 0)
  const plugin = host()
  plugin.emit('agent/created', { agent: live.agent })
  await settle()

  assert.deepEqual(keysOf(live.sent), [ENTRY_A + ':1', ENTRY_B + ':1'])
  for (const { message, target, wakeup } of live.sent) {
    assert.equal(target, 'next-step')
    assert.equal(wakeup, false)
    assert.equal(message.role, 'user')
    assert.match(message.id, UUID)
    assert.equal(message.source.kind, SOURCE_KIND)
    assert.equal(message.source.entryVersion, 1)
    assert.equal(message.content[0].type, 'text')
  }
  assert.notEqual(live.sent[0].message.id, live.sent[1].message.id)
  assert.match(live.sent[0].message.content[0].text, /^# Project language requirement: Rust\n\nPrefer explicit error types\.$/)
  assert.match(live.sent[1].message.content[0].text, /Python\n\nUse type hints\./)

  // The injection is durable pending work (no wake), not a prompt section.
  assert.equal(live.state.inbox.nextStep.length, 2)
  assert.equal(live.state.status, 'idle')
  // Only the two pre-existing sections exist; nothing language-shaped was added.
  assert.deepEqual([...live.sections.keys()].sort(), ['mode-mod:goal', 'mode-mod:ptc-guidance'])
  for (const section of live.sections.values()) {
    assert.equal(/Rust|Python|language requirement/.test(section.text()), false)
  }
})

/* ------------------------------------------------------------------ */
/* EX-002 / EX-003: busy and idle delivery use the one quiet verb      */
/* ------------------------------------------------------------------ */

test('a busy and an idle agent both receive next-step input without a wakeup', async () => {
  const h = home()
  seed(h, { entries: [entryRow(ENTRY_A, 'Rust', 'Rust rules')] })
  const busy = agentFor(LIVE, { cwd: CWD }, { status: 'running' })
  const idle = agentFor(OTHER, { cwd: CWD }, { status: 'idle' })
  const plugin = host()
  plugin.emit('agent/created', { agent: busy.agent })
  plugin.emit('agent/created', { agent: idle.agent })
  await settle()
  assert.equal(busy.sent.length, 0)

  const selected = await select(plugin, LIVE, [ENTRY_A])
  assert.equal(selected.status, 200)
  await settle()

  for (const fixture of [busy, idle]) {
    assert.equal(fixture.sent.length, 1)
    assert.equal(fixture.sent[0].target, 'next-step')
    assert.equal(fixture.sent[0].wakeup, false)
    assert.equal(fixture.sent[0].message.source.entryId, ENTRY_A)
  }
  // Neither path can have used followup/steer: every recorded send is next-step.
  assert.deepEqual(busy.sent.map(({ target }) => target), ['next-step'])
  assert.equal(busy.state.status, 'running')
  assert.equal(idle.state.status, 'idle')
})

/* ------------------------------------------------------------------ */
/* EX-004 / REQ-005: unselect delivers nothing and deletes nothing     */
/* ------------------------------------------------------------------ */

test('unselecting a language delivers nothing and keeps the committed context', async () => {
  const h = home()
  seed(h, { entries: [entryRow(ENTRY_A, 'Rust', 'Rust rules')], projects: { [CWD]: [ENTRY_A] } })
  const live = agentFor(LIVE, { cwd: CWD })
  const plugin = host()
  plugin.emit('agent/created', { agent: live.agent })
  await settle()
  assert.equal(live.sent.length, 1)
  const message = live.sent[0].message
  claim(plugin, live, message)
  admit(plugin, live, message)
  await settle()

  const removed = await select(plugin, LIVE, [])
  assert.equal(removed.status, 200)
  await settle()
  assert.equal(live.sent.length, 1, 'unselecting must not deliver anything')
  assert.equal(live.state.history.length, 1, 'unselecting must not remove committed context')
  assert.deepEqual(readJson(projectsFile(h)).projects, {})
})

/* ------------------------------------------------------------------ */
/* EX-005 / REQ-006: history, pending, and unresolved-claim dedupe     */
/* ------------------------------------------------------------------ */

test('delivery is suppressed by history, by pending input, or by an unresolved claim', async () => {
  const h = home()
  seed(h, {
    entries: [entryRow(ENTRY_A, 'Rust', 'Rust rules')],
    projects: { [CWD]: [ENTRY_A] },
  })
  const live = agentFor(LIVE, { cwd: CWD })
  const plugin = host()
  plugin.emit('agent/created', { agent: live.agent })
  await settle()
  assert.equal(live.sent.length, 1)
  const first = live.sent[0].message

  // (b) Still pending: re-posting the selection, a reload reconciliation, and a
  // fresh agent/created pass all see it and enqueue nothing.
  await select(plugin, LIVE, [ENTRY_A])
  plugin.emit('agent/created', { agent: live.agent })
  await settle()
  assert.equal(live.sent.length, 1)

  // (c) Claimed but not admitted: the claim window suppresses re-enqueueing.
  claim(plugin, live, first)
  await select(plugin, LIVE, [ENTRY_A])
  await settle()
  assert.equal(live.sent.length, 1, 'an unresolved claim must not be duplicated')

  // Admission moves suppression to history, and the claim is released.
  admit(plugin, live, first)
  await select(plugin, LIVE, [ENTRY_A])
  await settle()
  assert.equal(live.sent.length, 1)
  // Exactly one committed copy for this (entryId, version).
  const committed = live.state.history.filter((event) => event.type === 'user/message'
    && event.data.source.kind === SOURCE_KIND
    && event.data.source.entryId === ENTRY_A)
  assert.equal(committed.length, 1)
})

test('a claim that never lands is released at turn end and self-heals once', async () => {
  const h = home()
  seed(h, { entries: [entryRow(ENTRY_A, 'Rust', 'Rust rules')], projects: { [CWD]: [ENTRY_A] } })
  const live = agentFor(LIVE, { cwd: CWD })
  const plugin = host()
  plugin.emit('agent/created', { agent: live.agent })
  await settle()
  assert.equal(live.sent.length, 1)
  const first = live.sent[0].message

  // Claimed, then the step is rejected/aborted without a user/message.
  claim(plugin, live, first)
  await select(plugin, LIVE, [ENTRY_A])
  await settle()
  assert.equal(live.sent.length, 1, 'still inside the unresolved window')

  // The turn ends: the claim window is decidable and empty, so the missing
  // requirement is restored exactly once.
  setStatus(plugin, live, 'idle')
  await settle()
  assert.equal(live.sent.length, 2)
  assert.deepEqual(keysOf(live.sent), [ENTRY_A + ':1', ENTRY_A + ':1'])
  assert.equal(live.state.history.length, 0)
})

test('a re-toggle during step preparation admits exactly one copy once preparation completes', async () => {
  const h = home()
  seed(h, { entries: [entryRow(ENTRY_A, 'Rust', 'Rust rules')], projects: { [CWD]: [ENTRY_A] } })
  const live = agentFor(LIVE, { cwd: CWD }, { status: 'running' })
  const plugin = host()
  plugin.emit('agent/created', { agent: live.agent })
  await settle()
  assert.equal(live.sent.length, 1)
  const first = live.sent[0].message

  // Claim into the open turn, then re-select while step preparation is still
  // running (and reconcile through a simulated plugin load).
  claim(plugin, live, first)
  await select(plugin, LIVE, [ENTRY_A])
  plugin.emit('agent/created', { agent: live.agent })
  await settle()
  assert.equal(live.sent.length, 1, 'the claim window suppressed the re-enqueue')

  // Preparation completes and the claimed message lands: one copy, no second.
  admit(plugin, live, first)
  setStatus(plugin, live, 'idle')
  await settle()
  assert.equal(live.sent.length, 1)
  assert.equal(live.state.history.length, 1)
})

/* ------------------------------------------------------------------ */
/* EX-010: cancellation clears the inbox; nothing is marked delivered  */
/* ------------------------------------------------------------------ */

test('a cancelled pending injection is not marked delivered and is restored on the next settle', async () => {
  const h = home()
  seed(h, { entries: [entryRow(ENTRY_A, 'Rust', 'Rust rules')], projects: { [CWD]: [ENTRY_A] } })
  const live = agentFor(LIVE, { cwd: CWD }, { status: 'running' })
  const plugin = host()
  plugin.emit('agent/created', { agent: live.agent })
  await settle()
  assert.equal(live.sent.length, 1)

  // The user stops the turn: the harness clears pending input.
  live.state.inbox.nextStep.length = 0
  live.state.inbox.nextTurn.length = 0
  setStatus(plugin, live, 'idle')
  await settle()

  // Not delivered (no history), so the next idle transition restores it.
  assert.equal(live.state.history.length, 0)
  assert.equal(live.sent.length, 2)
  assert.equal(live.sent[1].target, 'next-step')
  assert.equal(live.sent[1].wakeup, false)
})

/* ------------------------------------------------------------------ */
/* EX-006 / REQ-007: body edits deliver the new version                */
/* ------------------------------------------------------------------ */

test('editing a body delivers the new version to selected projects, including A to B to A', async () => {
  const h = home()
  seed(h, {
    entries: [entryRow(ENTRY_A, 'Rust', 'alpha')],
    projects: { [CWD]: [ENTRY_A] },
  })
  const live = agentFor(LIVE, { cwd: CWD })
  const other = agentFor(OTHER, { cwd: OTHER_CWD })
  const plugin = host()
  plugin.emit('agent/created', { agent: live.agent })
  plugin.emit('agent/created', { agent: other.agent })
  await settle()
  assert.equal(live.sent.length, 1)
  claim(plugin, live, live.sent[0].message)
  admit(plugin, live, live.sent[0].message)
  await settle()

  // alpha -> beta: new version, delivered once.
  const beta = await updateEntry(plugin, ENTRY_A, { prompt: 'beta' })
  assert.equal(beta.body.entries[0].version, 2)
  await settle()
  assert.deepEqual(keysOf(live.sent), [ENTRY_A + ':1', ENTRY_A + ':2'])
  assert.match(live.sent[1].message.content[0].text, /beta/)
  claim(plugin, live, live.sent[1].message)
  admit(plugin, live, live.sent[1].message)
  await settle()

  // An unchanged save delivers nothing.
  const unchanged = await updateEntry(plugin, ENTRY_A, { prompt: ' beta ' })
  assert.equal(unchanged.body.entries[0].version, 2)
  await settle()
  assert.equal(live.sent.length, 2)

  // beta -> alpha: the final alpha is version 3, not a repeat of version 1.
  const back = await updateEntry(plugin, ENTRY_A, { prompt: 'alpha' })
  assert.equal(back.body.entries[0].version, 3)
  await settle()
  assert.deepEqual(keysOf(live.sent), [ENTRY_A + ':1', ENTRY_A + ':2', ENTRY_A + ':3'])
  assert.match(live.sent[2].message.content[0].text, /alpha/)

  // The project that never selected the entry is untouched by every edit.
  assert.equal(other.sent.length, 0)
})

/* ------------------------------------------------------------------ */
/* EX-007: deletion clears selections and keeps history                */
/* ------------------------------------------------------------------ */

test('deleting an entry clears every project selection and leaves injected history alone', async () => {
  const h = home()
  seed(h, {
    entries: [entryRow(ENTRY_A, 'Rust', 'Rust rules'), entryRow(ENTRY_B, 'Python', 'Python rules')],
    projects: { [CWD]: [ENTRY_A, ENTRY_B] },
  })
  const live = agentFor(LIVE, { cwd: CWD })
  const plugin = host()
  plugin.emit('agent/created', { agent: live.agent })
  await settle()
  assert.equal(live.sent.length, 2)
  const first = live.sent[0].message
  claim(plugin, live, first)
  admit(plugin, live, first)
  await settle()

  const deleted = await deleteEntry(plugin, ENTRY_A)
  assert.equal(deleted.status, 200)
  assert.deepEqual(deleted.body.entries.map((entry) => entry.id), [ENTRY_B])
  assert.deepEqual(readJson(projectsFile(h)).projects[CWD], [ENTRY_B])
  await settle()

  // Nothing new is delivered, and the already committed message is still there.
  assert.equal(live.sent.length, 2)
  assert.equal(live.state.history.length, 1)
  assert.equal(live.state.history[0].data.source.entryId, ENTRY_A)
})

/* ------------------------------------------------------------------ */
/* EX-008 / REQ-011: subagents are covered                             */
/* ------------------------------------------------------------------ */

test('a subagent receives the project selection even though it owns no goal', async () => {
  const h = home()
  seed(h, { entries: [entryRow(ENTRY_A, 'Rust', 'Rust rules')], projects: { [CWD]: [ENTRY_A] } })
  const subagent = agentFor(SUBAGENT, {
    cwd: CWD,
    parentSession: LIVE,
    origin: 'subagent',
    delegationDepth: 1,
  })
  const plugin = host()
  plugin.emit('agent/created', { agent: subagent.agent })
  await settle()

  assert.equal(subagent.sent.length, 1)
  assert.equal(subagent.sent[0].message.source.entryId, ENTRY_A)
  // The goal section remains top-level only.
  assert.equal(subagent.sections.has('mode-mod:goal'), false)
  assert.equal(subagent.sections.has('mode-mod:ptc-guidance'), true)
})

/* ------------------------------------------------------------------ */
/* EX-009: restart, resume, and load reconciliation                    */
/* ------------------------------------------------------------------ */

test('a resumed session only gets the entries missing from its history', async () => {
  const h = home()
  seed(h, {
    entries: [entryRow(ENTRY_A, 'Rust', 'Rust rules'), entryRow(ENTRY_B, 'Python', 'Python rules')],
    projects: { [CWD]: [ENTRY_A, ENTRY_B] },
  })
  const delivered = {
    type: 'user/message',
    data: {
      id: '11111111-2222-4333-8444-555555555555',
      role: 'user',
      content: [{ type: 'text', text: 'Rust rules' }],
      source: { kind: SOURCE_KIND, entryId: ENTRY_A, entryVersion: 1, title: 'Rust' },
    },
  }
  const resumed = agentFor(LIVE, { cwd: CWD }, { history: [delivered] })
  host([resumed.agent])
  await settle()

  assert.deepEqual(keysOf(resumed.sent), [ENTRY_B + ':1'])
})

test('restart does not re-enqueue an injection that was still pending', async () => {
  const h = home()
  seed(h, { entries: [entryRow(ENTRY_A, 'Rust', 'Rust rules')], projects: { [CWD]: [ENTRY_A] } })
  const pending = {
    id: '22222222-3333-4444-8555-666666666666',
    role: 'user',
    content: [{ type: 'text', text: 'Rust rules' }],
    source: { kind: SOURCE_KIND, entryId: ENTRY_A, entryVersion: 1, title: 'Rust' },
  }
  const resumed = agentFor(LIVE, { cwd: CWD }, { inbox: { nextStep: [pending] } })
  host([resumed.agent])
  await settle()
  assert.equal(resumed.sent.length, 0)
})

test('a running agent reconciled at load waits for its next idle transition', async () => {
  const h = home()
  seed(h, { entries: [entryRow(ENTRY_A, 'Rust', 'Rust rules')], projects: { [CWD]: [ENTRY_A] } })
  const running = agentFor(LIVE, { cwd: CWD }, { status: 'running' })
  const plugin = host([running.agent])
  await settle()
  // The pre-instance claim window cannot be reconstructed, so the decision is
  // deferred rather than guessed.
  assert.equal(running.sent.length, 0)

  setStatus(plugin, running, 'idle')
  await settle()
  assert.equal(running.sent.length, 1)
  assert.equal(running.sent[0].message.source.entryId, ENTRY_A)
})

/* ------------------------------------------------------------------ */
/* EX-011: a project with no selection injects nothing                 */
/* ------------------------------------------------------------------ */

test('a project with no selection receives nothing, on creation or on selection changes elsewhere', async () => {
  const h = home()
  seed(h, { entries: [entryRow(ENTRY_A, 'Rust', 'Rust rules')], projects: { [CWD]: [ENTRY_A] } })
  const live = agentFor(LIVE, { cwd: CWD })
  const untouched = agentFor(OTHER, { cwd: OTHER_CWD })
  const plugin = host()
  plugin.emit('agent/created', { agent: live.agent })
  plugin.emit('agent/created', { agent: untouched.agent })
  await settle()
  assert.equal(live.sent.length, 1)
  assert.equal(untouched.sent.length, 0)
  assert.equal(untouched.state.inbox.nextStep.length, 0)

  await select(plugin, LIVE, [ENTRY_A])
  await settle()
  assert.equal(untouched.sent.length, 0)
  assert.deepEqual(untouched.state.history, [])
})

/* ------------------------------------------------------------------ */
/* API boundary                                                        */
/* ------------------------------------------------------------------ */

test('the language routes stay loopback and same-origin only', async () => {
  const h = home()
  seed(h, { entries: [entryRow(ENTRY_A, 'Rust', 'Rust rules')] })
  const live = agentFor(LIVE, { cwd: CWD })
  const plugin = host()
  plugin.emit('agent/created', { agent: live.agent })
  await settle()

  const crossSite = { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' }
  assert.equal((await callRoute(plugin.routes.get('/api/mode-mod/languages'), { url: '/api/mode-mod/languages', headers: crossSite })).status, 403)
  assert.equal((await callRoute(plugin.routes.get('/api/mode-mod/language'), { body: { action: 'create', entry: { title: 'x' } }, headers: crossSite })).status, 403)
  assert.equal((await callRoute(plugin.routes.get('/api/mode-mod/language-selection'), { body: { session: LIVE, ids: [] }, headers: crossSite })).status, 403)
})
