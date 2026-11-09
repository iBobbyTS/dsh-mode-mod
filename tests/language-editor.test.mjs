import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

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
      assert.equal(requests[3].payload.entry.prompt, 'D')
      // The server saved C then D, but C's response arrives after D's response.
      respond(3, 4)
      await drain()
    }
    respond(2, 3)
    await drain()
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
