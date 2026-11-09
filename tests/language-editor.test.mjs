import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { updateLanguageEntry } from '../lib/store.js'

// Observe the real built components without a DOM. State setters, dependency
// effects and keyed remounts are driven explicitly; timers and fetch are gated.
function editorHarness() {
  let active, registration, nextTimer = 0
  const timers = new Map(), requests = [], registrations = []
  const react = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useSyncExternalStore: () => 0,
    useState(initial) {
      const owner = active, index = owner.cursor++
      if (!(index in owner.slots)) owner.slots[index] = typeof initial === 'function' ? initial() : initial
      return [owner.slots[index], (value) => {
        owner.slots[index] = typeof value === 'function' ? value(owner.slots[index]) : value
      }]
    },
    useRef(initial) {
      const owner = active, index = owner.cursor++
      return owner.slots[index] ??= { current: initial }
    },
    useEffect(effect, deps) {
      const owner = active, index = owner.cursor++, previous = owner.slots[index]
      if (previous && deps && previous.deps && deps.length === previous.deps.length
        && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
      owner.slots[index] = { deps, cleanup: previous?.cleanup, pending: effect }
    },
  }
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { registration = value } } },
    document: { baseURI: 'http://localhost:9900/ui/', documentElement: { lang: 'en' } },
    URL, TextEncoder,
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id },
    clearTimeout(id) { timers.delete(id) },
    fetch(url, init) {
      return new Promise((resolve) => requests.push({
        url, payload: init?.body ? JSON.parse(init.body) : undefined,
        respond: (body) => resolve({ ok: true, json: async () => body }),
      }))
    },
  })
  const primitives = { Menu() {}, IconChevronDownOutlineRegular() {}, IconGoalOutlineRegular() {} }
  const plugin = registration.factory((id) => {
    assert.ok(id === 'react' || id === '@deepseek-ai/dsh-client-ui-primitives')
    return id === 'react' ? react : primitives
  })
  plugin.apply({ slots: {
    inject(name, fn) { fn() },
    register(options, component) { registrations.push({ options, component }); return () => {} },
  } })
  function mount(type, props = {}) {
    const owner = {
      slots: [], cursor: 0,
      render(nextProps = props) {
        props = nextProps
        active = owner
        owner.cursor = 0
        const tree = type(props)
        for (const slot of owner.slots) {
          if (!slot?.pending) continue
          slot.cleanup?.()
          slot.cleanup = slot.pending()
          delete slot.pending
        }
        return tree
      },
      unmount() { for (const slot of owner.slots) slot?.cleanup?.() },
    }
    return owner
  }
  const managerType = registrations.find(({ options }) => options.id === 'mode-mod-languages').component
  return { manager: mount(managerType), mount, requests, timers }
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined
  if (predicate(tree)) return tree
  for (const child of tree.children?.flat(Infinity) ?? []) {
    const result = find(child, predicate)
    if (result) return result
  }
}
const drain = () => new Promise(setImmediate)
const RUST = { id: 'lang-aaaaaaaaaaaa', title: 'Rust', prompt: 'A', version: 1 }
const PYTHON = { id: 'lang-bbbbbbbbbbbb', title: 'Python', prompt: 'Python rules', version: 1 }

async function loadedEditor() {
  const harness = editorHarness()
  const { manager, requests, mount } = harness
  manager.render()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].payload, undefined, 'manager loads through the real GET facade')
  requests[0].respond({ entries: [RUST, PYTHON], selected: [], sessionId: '', projectRoot: null })
  await drain()
  manager.render() // Commit automatic initial row selection.
  const element = () => find(manager.render(), (node) => node.type?.name === 'LanguageEntryEditor')
  const initial = element()
  const editor = mount(initial.type, initial.props)
  const fields = (owner = editor) => {
    const tree = owner.render(element().props)
    return {
      body: find(tree, (node) => node.type?.name === 'PromptTextField' && node.props.multiline).props,
      title: find(tree, (node) => node.type?.name === 'PromptTextField' && !node.props.multiline).props,
    }
  }
  const select = (id) => {
    const row = find(manager.render(), (node) => node.type?.name === 'LanguageListRow' && node.props.entry.id === id)
    row.props.onSelect()
    manager.render()
  }
  const respond = (index, version) => {
    const request = requests[index]
    request.respond({ entries: [{ ...RUST, ...request.payload.entry, version }] })
  }
  fields()
  return { ...harness, editor, fields, select, element, respond }
}

for (const newerEdit of [false, true]) {
  test(newerEdit
    ? 'a late unmounted language editor acknowledgment preserves newer draft fields and version'
    : 'language editor preserves C across an older B response, row remount and a title-only save', async () => {
    const h = await loadedEditor()
    const { requests, editor, fields, select, element, mount, respond } = h
    fields().body.onChange('B')
    fields().body.onBlur()
    await drain()
    assert.equal(requests[1].payload.entry.prompt, 'B')
    fields().body.onChange('C')
    respond(1, 2)
    await drain()
    assert.equal(element().props.entry.prompt, 'C', 'B acknowledgment must not replace the manager draft')
    assert.equal(fields().body.value, 'C')
    assert.equal(element().props.entry.version, 2)

    select(PYTHON.id)
    editor.unmount() // The keyed editor cleanup queues the final C flush.
    await drain()
    assert.equal(requests[2].payload.entry.prompt, 'C')
    select(RUST.id)
    const next = element()
    const reopened = mount(next.type, next.props)
    assert.equal(fields(reopened).body.value, 'C', 'returning before C completes must initialize from C')
    if (newerEdit) {
      fields(reopened).body.onChange('D')
      fields(reopened).body.onBlur()
      await drain()
      assert.equal(requests.length, 3, 'D waits for the old mount C acknowledgment in the shared entry queue')
    }
    respond(2, 3)
    await drain()
    if (newerEdit) {
      assert.equal(requests[3].payload.entry.prompt, 'D')
      assert.equal(element().props.entry.prompt, 'D', 'the unmounted C acknowledgment preserves the newer D draft')
      respond(3, 4)
      await drain()
      // Serialized requests now preclude an old network response overtaking
      // the new save. Exercise the same metadata merge callback with a stale
      // acknowledgment as a separate oracle for monotonic version ownership.
      next.props.onSaved({ ...RUST, prompt: 'C', version: 3 })
    }
    const current = newerEdit ? 'D' : 'C'
    assert.equal(element().props.entry.prompt, current, 'old component acknowledgments cannot replace the current draft')
    assert.equal(element().props.entry.version, newerEdit ? 4 : 3, 'late metadata cannot roll the version back')
    assert.equal(fields(reopened).body.value, current)

    fields(reopened).title.onChange('Rust stable')
    fields(reopened).title.onBlur()
    await drain()
    const last = requests.length - 1
    assert.equal(requests[last].payload.entry.title, 'Rust stable')
    assert.equal(requests[last].payload.entry.prompt, current, 'a title-only save preserves the latest body')
    respond(last, newerEdit ? 4 : 3)
    await drain()
    assert.deepEqual(requests.slice(1).map(({ payload }) => payload.entry.prompt), newerEdit ? ['B', 'C', 'D', 'D'] : ['B', 'C', 'C'])
    assert.equal(element().props.entry.prompt, current)
    reopened.unmount()
    h.manager.unmount()
    assert.equal(h.timers.size, 0)
  })
}

test('a pending language save does not block a different entry', async () => {
  const h = await loadedEditor()
  const { requests, editor, fields, select, element, mount, respond } = h
  fields().body.onChange('B')
  fields().body.onBlur()
  await drain()
  assert.equal(requests[1].payload.id, RUST.id)
  select(PYTHON.id)
  editor.unmount()
  const next = element()
  const pythonEditor = mount(next.type, next.props)
  fields(pythonEditor).body.onChange('Updated Python rules')
  fields(pythonEditor).body.onBlur()
  await drain()
  assert.equal(requests.length, 3, 'the second entry sends while the first acknowledgment is held')
  assert.equal(requests[2].payload.id, PYTHON.id)
  requests[2].respond({ entries: [RUST, { ...PYTHON, ...requests[2].payload.entry, version: 2 }] })
  await drain()
  respond(1, 2)
  await drain()
  assert.equal(element().props.entry.version, 2)
  assert.equal(fields(pythonEditor).body.value, 'Updated Python rules')
  pythonEditor.unmount()
  h.manager.unmount()
  assert.equal(h.timers.size, 0)
})

test('language saves across row remounts keep the durable latest body and a later title-only save', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'mode-mod-editor-order-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const data = join(home, 'plugin/data/mode-mod')
  await mkdir(data, { recursive: true })
  const file = join(data, 'language-requirements.json')
  await writeFile(file, JSON.stringify({ version: 1, entries: [RUST, PYTHON] }))
  const h = await loadedEditor()
  const { requests, editor, fields, select, element, mount } = h
  const committed = []
  const commit = async (index, respondNow = true) => {
    const { payload } = requests[index]
    const result = await updateLanguageEntry(payload.id, payload.entry, home)
    committed.push({ body: result.entry.prompt, version: result.entry.version })
    if (respondNow) requests[index].respond({ entries: result.doc.entries })
    return result
  }
  fields().body.onChange('B')
  fields().body.onBlur()
  await drain()
  const b = await commit(1, false) // Persist B, hold its acknowledgment.
  fields().body.onChange('C')
  select(PYTHON.id)
  editor.unmount() // Queue C while B's acknowledgment is still pending.
  await drain()
  select(RUST.id)
  const next = element()
  const reopened = mount(next.type, next.props)
  assert.equal(fields(reopened).body.value, 'C')
  fields(reopened).body.onChange('D')
  fields(reopened).body.onBlur()
  await drain()

  // Commit in actual request-arrival order, including anything the fresh
  // mount sends while B's acknowledgment still holds the old mount's C.
  let nextCommit = 2
  const commitAvailable = async () => {
    while (nextCommit < requests.length) {
      await commit(nextCommit++)
      await drain()
    }
  }
  await commitAvailable()
  requests[1].respond({ entries: b.doc.entries })
  await drain()
  await commitAvailable()
  const durable = () => JSON.parse(readFileSync(file, 'utf8')).entries.find((entry) => entry.id === RUST.id)
  t.diagnostic(JSON.stringify({ committed, durable: durable().prompt, visible: fields(reopened).body.value }))
  assert.equal(durable().prompt, 'D', 'the latest authored body must win in the actual store document')
  assert.equal(fields(reopened).body.value, 'D')
  assert.equal(element().props.entry.prompt, 'D')
  assert.equal(element().props.entry.version, durable().version)
  assert.deepEqual(committed.map(({ body }) => body), ['B', 'C', 'D'])

  fields(reopened).title.onChange('Rust stable')
  fields(reopened).title.onBlur()
  await drain()
  await commitAvailable()
  assert.equal(durable().title, 'Rust stable')
  assert.equal(durable().prompt, 'D', 'a later title-only save must retain the durable latest body')
  assert.equal(fields(reopened).body.value, 'D')
  assert.equal(element().props.entry.version, durable().version)
  assert.deepEqual(committed.map(({ body }) => body), ['B', 'C', 'D', 'D'])
  reopened.unmount()
  h.manager.unmount()
  assert.equal(h.timers.size, 0)
})
