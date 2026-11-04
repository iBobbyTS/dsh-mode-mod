/**
 * Project-default persistence for the system-prompt-preset (goal) dimension —
 * one JSON document under plugin data.
 *
 * State file: $DSH_HOME/plugin/data/mode-mod/project-system-prompt-preset.json
 * Shape: { version: 1, projects: { "<absolute project root>": "<goal id>" } }
 * Written atomically (tmp file + rename). A missing or malformed file reads as
 * "no project values" with a warning; it never blocks session creation.
 *
 * Project identity: the nearest ancestor holding .git of the session cwd,
 * else the cwd itself. Lookup is longest-prefix, so a session opened in a
 * subdirectory inherits the repository-level value.
 * @module @local/dsh-mode-mod/store
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, parse, sep } from 'node:path'

/** Storage version; a different version is ignored with a warning. */
const STORE_VERSION = 1

/** Resolve the DSH home directory (same convention as other local plugins). */
export function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** The plugin-owned data directory. */
export function dataDir(home = dshHome()) {
  return join(home, 'plugin', 'data', 'mode-mod')
}

/** The project-default document path. */
export function storePath(home = dshHome()) {
  return join(dataDir(home), 'project-system-prompt-preset.json')
}

/**
 * The nearest ancestor of cwd holding .git, else cwd.
 * @param cwd - a session working directory.
 * @returns the project root to key values by.
 */
export function resolveProjectRoot(cwd) {
  let dir = cwd
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return cwd
    dir = parent
  }
}

function emptyStore() {
  return { version: STORE_VERSION, projects: {} }
}

/**
 * Read the store; malformed content degrades to empty with the reason.
 * @param home - the DSH home root.
 * @returns the parsed store.
 */
export async function readStore(home = dshHome()) {
  try {
    const raw = await readFile(storePath(home), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    if (parsed.version !== STORE_VERSION) throw new Error(`unsupported version ${parsed.version}`)
    if (parsed.projects === null || typeof parsed.projects !== 'object' || Array.isArray(parsed.projects)) throw new Error('projects is not an object')
    return parsed
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn(`mode-mod store: reading ${storePath(home)} failed (${error?.message ?? error}); treating as empty`)
    return emptyStore()
  }
}

/**
 * Persist the store atomically.
 * @param store - the complete document.
 * @param home - the DSH home root.
 */
export async function writeStore(store, home = dshHome()) {
  const target = storePath(home)
  await mkdir(dirname(target), { recursive: true })
  const tmp = join(parse(target).dir, `.project-system-prompt-preset.${process.pid}.tmp`)
  await writeFile(tmp, JSON.stringify(store, null, 2) + '\n', 'utf8')
  await rename(tmp, target)
}

/** True when candidate is root itself or a path underneath it. */
function isUnder(root, candidate) {
  return candidate === root || candidate.startsWith(root + sep)
}

/**
 * Longest-prefix lookup of the project value for a resolved root.
 * @param store - the parsed store.
 * @param root - the resolved project root.
 * @returns the goal id, or undefined when no ancestor declares one.
 */
export function lookupProjectValue(store, root) {
  let best
  for (const [key, value] of Object.entries(store.projects ?? {})) {
    if (typeof value !== 'string') continue
    if (isUnder(key, root) && (best === undefined || key.length > best[0].length)) best = [key, value]
  }
  return best === undefined ? undefined : best[1]
}

/** The session-override document path. */
export function sessionOverridesPath(home = dshHome()) {
  return join(dataDir(home), 'session-goal-overrides.json')
}

/**
 * Read the session-goal overrides; malformed content degrades to empty.
 * Shape: { version: 1, sessions: { "<session id>": "<goal id>" | "none" } }
 * ("none" = explicitly no goal; absent = not selected, inherits). Older
 * documents stored null for an explicit none — migrated to "none" on read.
 * @param home - the DSH home root.
 * @returns the parsed document.
 */
export async function readSessionOverrides(home = dshHome()) {
  try {
    const raw = await readFile(sessionOverridesPath(home), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    if (parsed.version !== STORE_VERSION) throw new Error('unsupported version ' + parsed.version)
    if (parsed.sessions === null || typeof parsed.sessions !== 'object' || Array.isArray(parsed.sessions)) throw new Error('sessions is not an object')
    for (const key of Object.keys(parsed.sessions)) {
      if (parsed.sessions[key] === null) parsed.sessions[key] = 'none'
    }
    return parsed
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('mode-mod store: reading ' + sessionOverridesPath(home) + ' failed (' + (error?.message ?? error) + '); treating as empty')
    return { version: STORE_VERSION, sessions: {} }
  }
}

/**
 * Set, change, or clear one session's goal override and persist atomically.
 * @param sessionId - the top-level session id.
 * @param value - a goal id or "none" (explicit no goal); null or undefined
 *   deletes the entry — the session is no longer selected and inherits again.
 * @param home - the DSH home root.
 * @returns the document after the update.
 */
export async function setSessionOverride(sessionId, value, home = dshHome()) {
  const doc = await readSessionOverrides(home)
  if (value === null || value === undefined) delete doc.sessions[sessionId]
  else doc.sessions[sessionId] = value
  const target = sessionOverridesPath(home)
  await mkdir(dirname(target), { recursive: true })
  const tmp = join(parse(target).dir, '.session-goal-overrides.' + process.pid + '.tmp')
  await writeFile(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  await rename(tmp, target)
  return doc
}

/**
 * Set or clear one project's value and persist.
 * @param root - the resolved project root.
 * @param value - a goal id or "none" (explicit no goal, blocks the global
 *   tier); null deletes the entry so the project inherits again.
 * @param home - the DSH home root.
 * @returns the store after the update.
 */
export async function setProjectValue(root, value, home = dshHome()) {
  const store = await readStore(home)
  if (value === null) delete store.projects[root]
  else store.projects[root] = value
  await writeStore(store, home)
  return store
}
