/**
 * The seven development-goal system-prompt texts (texts in prompts/*.txt).
 *
 * Goals are a dimension ORTHOGONAL to agent presets (modes): a mode picks the
 * toolset and persona through the preset registry, while a goal layers its
 * text onto any mode as one scoped prompt section the host half registers on
 * each top-level agent (src/index.js). Goals therefore never appear as agent
 * presets, and no goal text is coupled to a particular preset tree — the
 * version-coupled PTC clone machinery this file used to carry is gone.
 * @module @local/dsh-mode-mod/presets
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package root (this file lives in src/). */
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
 * Read every goal prompt from the package's prompts/ directory.
 * @returns goal id to trimmed text.
 */
export function loadGoalTexts() {
  const texts = {}
  for (const goal of GOALS) {
    texts[goal.id] = readFileSync(join(PACKAGE_ROOT, 'prompts', goal.file), 'utf8').trim()
  }
  return texts
}
