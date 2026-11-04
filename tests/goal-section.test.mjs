import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTIVE_PRESET_HEADER, renderGoalSection } from '../src/presets.js'

/** Advance one assembly, asserting the section text. */
function step(goal, body, previous, expectedText) {
  const rendered = renderGoalSection(goal, body, previous)
  assert.equal(rendered.text, expectedText)
  return rendered.state
}

test('a first assembly renders the plain body — fresh sessions carry no supersedes header', () => {
  const body = '# Rapid Prototyping and Feasibility\n\nFind the smallest useful demonstration.'
  const state = step('prototype', body, undefined, body)
  assert.deepEqual(state, { goal: 'prototype', header: false })
})

test('an unchanged goal keeps rendering byte-identical text', () => {
  const body = '# Rapid Prototyping and Feasibility'
  let state = step('prototype', body, undefined, body)
  state = step('prototype', body, state, body)
  state = step('prototype', body, state, body)
  assert.equal(state.header, false)
})

test('a mid-session switch prepends the supersedes header', () => {
  const prototypeBody = '# Rapid Prototyping and Feasibility'
  const softwareBody = '# Long-Lived Applications and Business Software'
  let state = step('prototype', prototypeBody, undefined, prototypeBody)
  state = step('software', softwareBody, state, ACTIVE_PRESET_HEADER + '\n\n' + softwareBody)
  assert.deepEqual(state, { goal: 'software', header: true })
})

test('the header is sticky — later unchanged turns keep the same rendered text', () => {
  const softwareBody = '# Long-Lived Applications and Business Software'
  const headed = ACTIVE_PRESET_HEADER + '\n\n' + softwareBody
  let state = step('software', softwareBody, { goal: 'software', header: true }, headed)
  state = step('software', softwareBody, state, headed)
  assert.deepEqual(state, { goal: 'software', header: true })
})

test('switching to explicit none empties the section; returning to a goal heads it again', () => {
  const prototypeBody = '# Rapid Prototyping and Feasibility'
  const researchBody = '# Scientific Research and Algorithm Experiments'
  let state = step('prototype', prototypeBody, undefined, prototypeBody)
  state = step('none', '', state, '')
  assert.deepEqual(state, { goal: 'none', header: false })
  state = step('research', researchBody, state, ACTIVE_PRESET_HEADER + '\n\n' + researchBody)
  // Switching back and forth re-announces each replacement.
  state = step('none', '', state, '')
  state = step('research', researchBody, state, ACTIVE_PRESET_HEADER + '\n\n' + researchBody)
})
