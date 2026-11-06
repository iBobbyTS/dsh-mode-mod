import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, BROWSER_TOOLS, EXCLUDED_TOOLS } from '../lib/web-research.js'

/** Fake preset-scope context with mutable global tool and prompt registries. */
function fixture(initial) {
  const names = [...initial]
  const filters = []
  const lifts = []
  const warnings = []
  const handlers = new Map()
  const disposers = []
  const sections = new Map()
  const contexts = new Map()
  const tools = {
    schemas: () => names.map((name) => ({ name })),
    restrict(filter) {
      filters.push(filter)
      return () => { lifts.push(filter) }
    },
  }
  const systemPrompt = {
    getSectionOrder: () => 500,
    getContextOrder: () => 400,
    section(section) {
      sections.set(section.name, section)
      return () => { sections.delete(section.name) }
    },
    context(entry) {
      contexts.set(entry.name, entry)
      return () => { contexts.delete(entry.name) }
    },
  }
  const ctx = {
    logger: { warn(message) { warnings.push(message) }, info() {} },
    tools,
    systemPrompt,
    on(event, fn) {
      handlers.set(event, fn)
      return () => { handlers.delete(event) }
    },
    effect(fn) { disposers.push(fn()) },
  }
  apply(ctx)
  return {
    names,
    filters,
    lifts,
    warnings,
    sections,
    contexts,
    change: () => handlers.get('tools/change')?.(),
    dispose: () => { for (const dispose of [...disposers].reverse()) dispose?.() },
  }
}

const PLAYWRIGHT = [...BROWSER_TOOLS]

test('the allow list is the 22 browser tools and excludes the three unsafe tools', () => {
  assert.equal(BROWSER_TOOLS.length, 22)
  assert.equal(new Set(BROWSER_TOOLS).size, 22)
  for (const excluded of EXCLUDED_TOOLS) {
    assert.equal(BROWSER_TOOLS.includes(excluded), false)
  }
  assert.deepEqual(EXCLUDED_TOOLS, [
    'mcp__playwright__browser_run_code_unsafe',
    'mcp__playwright__browser_file_upload',
    'mcp__playwright__browser_drop',
  ])
  for (const name of BROWSER_TOOLS) assert.match(name, /^mcp__playwright__browser_/)
})

test('with the browser tools registered the preset scope is masked to the allow list', () => {
  const f = fixture([...PLAYWRIGHT, 'mcp__codegraph__codegraph_explore', 'bash', 'read'])
  assert.equal(f.filters.length, 1)
  assert.deepEqual(f.filters[0].allow, PLAYWRIGHT)
  assert.equal(f.filters[0].deny, undefined)
})

test('before the browser tools exist every other global tool is denied', () => {
  const f = fixture(['bash', 'read', 'run_code', 'mcp__codegraph__codegraph_explore'])
  assert.equal(f.filters.length, 1)
  assert.deepEqual([...f.filters[0].deny].sort(), ['bash', 'mcp__codegraph__codegraph_explore', 'read'])
  // The reserved PTC transport name can never be named by a restriction.
  assert.equal(f.filters[0].deny.includes('run_code'), false)
})

test('the mask follows the live registry when the browser finally registers', () => {
  const f = fixture(['bash', 'mcp__codegraph__codegraph_explore'])
  assert.equal(f.filters.length, 1)
  f.names.push(...PLAYWRIGHT)
  f.change()
  assert.equal(f.filters.length, 2)
  assert.deepEqual(f.filters[1].allow, PLAYWRIGHT)
  // The deny fallback is lifted only after the replacement is installed.
  assert.equal(f.lifts.length, 1)
  assert.deepEqual(f.lifts[0].deny, ['bash', 'mcp__codegraph__codegraph_explore'])
})

test('an unchanged allow list is not reinstalled when unrelated tools appear', () => {
  const f = fixture(PLAYWRIGHT)
  f.names.push('mcp__playwright__browser_future_tool', 'mcp__other__tool')
  f.change()
  assert.equal(f.filters.length, 1)
  // A new upstream browser tool stays hidden until it is explicitly listed.
  assert.equal(f.filters[0].allow.includes('mcp__playwright__browser_future_tool'), false)
})

test('a partially available browser exposes only the tools that are present', () => {
  const present = PLAYWRIGHT.slice(0, 21)
  const f = fixture(present)
  assert.equal(f.filters.length, 1)
  assert.deepEqual(f.filters[0].allow, present)
})

test('an empty registry installs no restriction and a later browser installs one', () => {
  const f = fixture([])
  assert.equal(f.filters.length, 0)
  f.names.push(...PLAYWRIGHT)
  f.change()
  assert.equal(f.filters.length, 1)
  assert.deepEqual(f.filters[0].allow, PLAYWRIGHT)
})

test('the mode shadows the resource section and every non-browser server description', () => {
  const f = fixture([
    ...PLAYWRIGHT,
    'mcp__codegraph__codegraph_explore',
    'mcp__external_subagent__sfd_subagent_spawn',
    'bash',
  ])
  assert.deepEqual([...f.sections.keys()].sort(), [
    'app:web-surface',
    'harness:identity',
    'harness:source',
    'mcp-resource-servers',
    'mcp:codegraph',
    'mcp:external_subagent',
    'ui:deliverable-file-references',
  ])
  for (const section of f.sections.values()) assert.equal(section.text, '')
  // The browser server keeps its own instructions.
  assert.equal(f.sections.has('mcp:playwright'), false)
  // File-delivery and harness-orientation guidance describe machinery this
  // mode has no tools for.
  for (const name of ['harness:identity', 'ui:deliverable-file-references', 'harness:source', 'app:web-surface']) {
    assert.equal(f.sections.has(name), true)
    assert.equal(f.sections.get(name).text, '')
  }
})

test('deployment guidance and the resource section are shadowed before any MCP server connects', () => {
  const f = fixture([])
  assert.deepEqual([...f.sections.keys()].sort(), [
    'app:web-surface',
    'harness:identity',
    'harness:source',
    'mcp-resource-servers',
    'ui:deliverable-file-references',
  ])
})

test('a server description is shadowed as soon as its tools appear, and dropped when they leave', () => {
  const f = fixture(PLAYWRIGHT)
  assert.equal(f.sections.has('mcp:codegraph'), false)
  f.names.push('mcp__codegraph__codegraph_explore')
  f.change()
  assert.equal(f.sections.has('mcp:codegraph'), true)
  f.names.length = PLAYWRIGHT.length
  f.change()
  assert.equal(f.sections.has('mcp:codegraph'), false)
})

test('the required working-directory context is shadowed by an empty optional entry', () => {
  const f = fixture(PLAYWRIGHT)
  assert.deepEqual([...f.contexts.keys()], ['working-directory:current'])
  assert.equal(f.contexts.get('working-directory:current').text, '')
  assert.equal(f.contexts.get('working-directory:current').order, 400)
})

test('disposing the row lifts the mask, removes the shadows, and stops reacting to registry changes', () => {
  const f = fixture([...PLAYWRIGHT, 'mcp__codegraph__codegraph_explore'])
  f.dispose()
  assert.equal(f.lifts.length, 1)
  assert.equal(f.sections.size, 0)
  assert.equal(f.contexts.size, 0)
  f.names.push('bash')
  f.change()
  assert.equal(f.filters.length, 1)
  assert.equal(f.sections.size, 0)
})

test('a rejected mask is reported and never escapes the refresh callback', () => {
  const warnings = []
  let attempts = 0
  const handlers = new Map()
  const disposers = []
  apply({
    logger: { warn(message) { warnings.push(message) }, info() {} },
    tools: {
      schemas: () => [{ name: 'mcp__playwright__browser_navigate' }],
      restrict() { attempts += 1; throw new Error('unknown global tool') },
    },
    systemPrompt: {
      getSectionOrder: () => 500,
      getContextOrder: () => 400,
      section: () => () => {},
      context: () => () => {},
    },
    on(event, fn) {
      handlers.set(event, fn)
      return () => { handlers.delete(event) }
    },
    effect(fn) { disposers.push(fn()) },
  })
  assert.equal(attempts, 1)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /tool mask failed/)
  assert.doesNotThrow(() => handlers.get('tools/change')?.())
  assert.equal(attempts, 2)
  for (const dispose of [...disposers].reverse()) dispose?.()
})
