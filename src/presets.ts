/**
 * The seven development-goal system-prompt texts (texts in prompts/*.txt).
 *
 * Goals are a dimension ORTHOGONAL to agent presets (modes): a mode picks the
 * toolset and persona through the preset registry, while a goal layers its
 * text onto any mode as one scoped prompt section the host half registers on
 * each top-level agent (src/index.ts). Goals therefore never appear as agent
 * presets, and no goal text is coupled to a particular preset tree — the
 * version-coupled PTC clone machinery this file used to carry is gone.
 *
 * Mid-session switches keep the SAME section and swap only its text: the
 * header below is prepended from the first assembly AFTER a switch so the
 * model knows the new preset supersedes the earlier one still visible in
 * history. It then stays (renderGoalSection) so an unchanged selection keeps
 * the rendered text byte-identical and the harness never re-commits the
 * system prompt for a switch that did not happen.
 * @module @local/dsh-mode-mod/presets
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package root (the generated module lives in lib/). */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The seven development-goal system-prompt presets, in picker order. */
export const GOALS = [
  { id: 'research', file: 'research.txt', name: 'Research', description: 'Scientific research and algorithm experiments.' },
  { id: 'prototype', file: 'prototype.txt', name: 'Prototype', description: 'Rapid prototyping and feasibility.' },
  { id: 'utility', file: 'utility.txt', name: 'Utility', description: 'Small scripts and personal tools.' },
  { id: 'host-extension', file: 'host-extension.txt', name: 'Host extension', description: 'Host plugins and application extensions.' },
  { id: 'library', file: 'library.txt', name: 'Library', description: 'Reusable libraries, components, and SDKs.' },
  { id: 'software', file: 'software.txt', name: 'Software', description: 'Long-lived applications and business software.' },
  { id: 'agent-runtime', file: 'agent-runtime.txt', name: 'Agent runtime', description: 'Agent runtimes and protocol infrastructure.' },
]

/**
 * The short header prepended to a goal body from the first assembly after a
 * mid-session switch. It states the replacement relationship, keeps task
 * continuity, and bounds the change's effect — it grants nothing.
 */
export const ACTIVE_PRESET_HEADER = [
  '# Active Development Preset',
  '',
  'The following preset defines the engineering approach, implementation depth, and validation expectations for the active development mode.',
  '',
  'It supersedes any previously selected development preset in this session and applies to subsequent work, including the continuation of the current task.',
  '',
  'Preserve established facts, completed work, and prior user decisions. Do not restart or re-evaluate completed work solely because the preset changed.',
  '',
  'This preset does not grant additional permissions or override explicit user requirements, repository instructions, or tool restrictions.',
].join('\n')

/**
 * Read every goal prompt from the package's prompts/ directory.
 * @returns goal id to trimmed text.
 */
export function loadGoalTexts() {
  const texts: Record<string, string> = {}
  for (const goal of GOALS) {
    texts[goal.id] = readFileSync(join(PACKAGE_ROOT, 'prompts', goal.file), 'utf8').trim()
  }
  return texts
}

/**
 * Render the goal section text for one assembly of one agent.
 *
 * The header appears exactly on assemblies that follow a goal change (a
 * switch, or a return from an explicit none) and on every assembly after the
 * first such change: once shown it stays, so a goal that no longer changes
 * renders byte-identical text and the harness commits no new system-prompt
 * version. A first assembly in a process (fresh or resumed session) renders
 * the plain body — a resumed session that never switched in this process
 * matches the text it committed before, and one that did switch settles on
 * the next assembly.
 * @param {string|null} goal - the resolved goal id, or null for explicit none.
 * @param {string} body - the goal's prompt text; '' when the goal is none.
 * @param {{goal: string|null, header: boolean}|undefined} previous - the
 *   state left by the previous assembly of this agent in this process.
 * @returns {{text: string, state: {goal: string|null, header: boolean}}} the
 *   section text for this assembly and the state to carry to the next one.
 */
export function renderGoalSection(goal: string | null, body: string, previous: { goal: string | null; header: boolean } | undefined) {
  const header = previous !== undefined && (previous.goal !== goal || previous.header) && body !== ''
  return {
    text: header ? ACTIVE_PRESET_HEADER + '\n\n' + body : body,
    state: { goal, header },
  }
}
