import type { ProjectStore, SessionStore, RetiredPrompt, PromptDocument, PromptEntry, PromptFields } from './protocol.js'
import { errorDetails } from './errors.js'
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

import { randomBytes } from 'node:crypto'
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
export function resolveProjectRoot(cwd: string) {
  let dir = cwd
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return cwd
    dir = parent
  }
}

function emptyStore(): ProjectStore {
  return { version: STORE_VERSION, projects: {} }
}

/**
 * Read the store; malformed content degrades to empty with the reason.
 * @param home - the DSH home root.
 * @returns the parsed store.
 */
export async function readStore(home = dshHome()): Promise<ProjectStore> {
  try {
    const raw = await readFile(storePath(home), 'utf8')
    const parsed: Record<string, unknown> = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    if (parsed.version !== STORE_VERSION) throw new Error(`unsupported version ${parsed.version}`)
    if (parsed.projects === null || typeof parsed.projects !== 'object' || Array.isArray(parsed.projects)) throw new Error('projects is not an object')
    return parsed as unknown as ProjectStore
  } catch (error) {
    if (errorDetails(error).code !== 'ENOENT') console.warn(`mode-mod store: reading ${storePath(home)} failed (${errorDetails(error).message ?? error}); treating as empty`)
    return emptyStore()
  }
}

/**
 * Persist the store atomically.
 * @param store - the complete document.
 * @param home - the DSH home root.
 */
export async function writeStore(store: ProjectStore, home = dshHome()) {
  const target = storePath(home)
  await mkdir(dirname(target), { recursive: true })
  const tmp = join(parse(target).dir, `.project-system-prompt-preset.${process.pid}.tmp`)
  await writeFile(tmp, JSON.stringify(store, null, 2) + '\n', 'utf8')
  await rename(tmp, target)
}

/** True when candidate is root itself or a path underneath it. */
function isUnder(root: string, candidate: string) {
  return candidate === root || candidate.startsWith(root + sep)
}

/**
 * Longest-prefix lookup of the project value for a resolved root.
 * @param store - the parsed store.
 * @param root - the resolved project root.
 * @returns the goal id, or undefined when no ancestor declares one.
 */
export function lookupProjectValue(store: ProjectStore, root: string) {
  let best: [string, string] | undefined
  for (const [key, value] of Object.entries(store.projects ?? {})) {
    if (typeof value !== 'string') continue
    if (isUnder(key, root) && (best === undefined || key.length > best[0].length)) best = [key, value]
  }
  return best === undefined ? undefined : best[1]
}

/** The custom-system-prompt document path. */
export function customPromptsPath(home = dshHome()) {
  return join(dataDir(home), 'custom-system-prompts.json')
}

/** Field caps for one custom preset; mirrored by the settings page's maxLength attributes. */
export const CUSTOM_PROMPT_LIMITS = Object.freeze({
  title: 80,
  description: 200,
  prompt: 64 * 1024,
})

/** Custom preset ids are plugin-generated and never collide with the shipped goal ids. */
const CUSTOM_ID_PATTERN = /^custom-[0-9a-f]{12}$/

/** An error the prompt routes map to a 4xx response. */
function presetError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

/**
 * Normalize one single-line field. Embedded newlines become spaces so a paste
 * can never produce a second line; the caps match the UI's maxLength.
 * @param value - the raw field value.
 * @param label - the field name used in the error message.
 * @param limit - the maximum character count.
 * @returns the trimmed one-line text.
 */
function singleLine(value: unknown, label: string, limit: number) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw presetError('validation', label + ' must be a string')
  const text = value.replace(/[\r\n]+/g, ' ').trim()
  if (text.length > limit) throw presetError('validation', label + ' exceeds ' + String(limit) + ' characters')
  return text
}

/**
 * Normalize the multi-line system prompt. Outer whitespace is dropped; inner
 * formatting (headings, lists, blank lines) is preserved.
 * @param value - the raw prompt text.
 * @returns the trimmed prompt text.
 */
function promptText(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw presetError('validation', 'system prompt must be a string')
  const text = value.replace(/\r\n/g, '\n').trim()
  if (text.length > CUSTOM_PROMPT_LIMITS.prompt) {
    throw presetError('validation', 'system prompt exceeds ' + String(CUSTOM_PROMPT_LIMITS.prompt) + ' characters')
  }
  return text
}

/**
 * Validate the editable fields of one custom preset. Empty values are allowed:
 * a fresh row is a draft until the user fills in a title and prompt.
 * @param input - the request's preset payload.
 * @param fallback - the current entry for a partial update.
 * @returns the normalized title, description, and prompt.
 */
function normalizePreset(input: unknown, fallback: Partial<PromptFields> = {}) {
  const source = input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  return {
    title: singleLine(source.title === undefined ? fallback.title : source.title, 'title', CUSTOM_PROMPT_LIMITS.title),
    description: singleLine(
      source.description === undefined ? fallback.description : source.description,
      'description',
      CUSTOM_PROMPT_LIMITS.description,
    ),
    prompt: promptText(source.prompt === undefined ? fallback.prompt : source.prompt),
  }
}

function emptyCustomPrompts(): PromptDocument {
  return { version: STORE_VERSION, prompts: [] }
}

/**
 * Read the custom presets; malformed rows are skipped, a malformed document
 * degrades to empty with a warning. Order is the creation order.
 * @param home - the DSH home root.
 * @returns the parsed document.
 */
export async function readCustomPrompts(home = dshHome()): Promise<PromptDocument> {
  try {
    const raw = await readFile(customPromptsPath(home), 'utf8')
    const parsed: Record<string, unknown> = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    if (parsed.version !== STORE_VERSION) throw new Error('unsupported version ' + parsed.version)
    if (!Array.isArray(parsed.prompts)) throw new Error('prompts is not an array')
    const seen = new Set()
    const prompts: PromptEntry[] = []
    for (const entry of parsed.prompts) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      if (typeof entry.id !== 'string' || !CUSTOM_ID_PATTERN.test(entry.id) || seen.has(entry.id)) continue
      seen.add(entry.id)
      prompts.push({
        id: entry.id,
        title: typeof entry.title === 'string' ? entry.title : '',
        description: typeof entry.description === 'string' ? entry.description : '',
        prompt: typeof entry.prompt === 'string' ? entry.prompt : '',
        createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0,
        updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0,
      })
    }
    return { version: STORE_VERSION, prompts }
  } catch (error) {
    if (errorDetails(error).code !== 'ENOENT') {
      console.warn('mode-mod store: reading ' + customPromptsPath(home) + ' failed (' + (errorDetails(error).message ?? error) + '); treating as empty')
    }
    return emptyCustomPrompts()
  }
}

/**
 * Persist the custom presets atomically.
 * @param doc - the complete document.
 * @param home - the DSH home root.
 */
async function writeCustomPrompts(doc: PromptDocument, home: string) {
  const target = customPromptsPath(home)
  await mkdir(dirname(target), { recursive: true })
  const tmp = join(parse(target).dir, '.custom-system-prompts.' + process.pid + '.tmp')
  await writeFile(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  await rename(tmp, target)
}

/**
 * Append one custom preset with a generated id.
 * @param input - the editable fields (all optional).
 * @param home - the DSH home root.
 * @returns the new document and the created entry.
 */
export async function createCustomPrompt(input: unknown, home = dshHome()) {
  const doc = await readCustomPrompts(home)
  const preset = normalizePreset(input)
  let id: string
  do { id = 'custom-' + randomBytes(6).toString('hex') } while (doc.prompts.some((entry) => entry.id === id))
  const now = Date.now()
  const entry = { id, ...preset, createdAt: now, updatedAt: now }
  doc.prompts.push(entry)
  await writeCustomPrompts(doc, home)
  return { doc, entry }
}

/**
 * Update one custom preset. Missing fields keep their current value, so the
 * auto-save request may send the whole draft or only a subset.
 * @param id - the custom preset id.
 * @param input - the editable fields.
 * @param home - the DSH home root.
 * @returns the new document and the updated entry.
 */
export async function updateCustomPrompt(id: string, input: unknown, home = dshHome()) {
  const doc = await readCustomPrompts(home)
  const index = doc.prompts.findIndex((entry) => entry.id === id)
  if (index === -1) throw presetError('not-found', 'unknown custom preset: ' + id)
  const preset = normalizePreset(input, doc.prompts[index])
  const entry = { ...doc.prompts[index], ...preset, updatedAt: Date.now() }
  doc.prompts[index] = entry
  await writeCustomPrompts(doc, home)
  return { doc, entry }
}

/**
 * Remove one custom preset.
 * @param id - the custom preset id.
 * @param home - the DSH home root.
 * @returns the new document and the removed entry.
 */
export async function deleteCustomPrompt(id: string, home = dshHome()) {
  const doc = await readCustomPrompts(home)
  const index = doc.prompts.findIndex((entry) => entry.id === id)
  if (index === -1) throw presetError('not-found', 'unknown custom preset: ' + id)
  const [removed] = doc.prompts.splice(index, 1)
  await writeCustomPrompts(doc, home)
  return { doc, removed }
}

/**
 * Retire one deleted preset for the sessions that were using it: the stored
 * selection becomes null (the key is removed) while the deleted text is kept
 * under `retired`, so a resumed session keeps the system prompt it already
 * committed until the user explicitly selects another preset.
 * @param records - session id to { id, title, text } record.
 * @param home - the DSH home root.
 * @returns the document after the update.
 */
export async function retireSessionValues(records: ReadonlyMap<string, RetiredPrompt>, home = dshHome()) {
  const doc = await readSessionOverrides(home)
  if (records.size === 0) return doc
  for (const [sessionId, retired] of records) {
    delete doc.sessions[sessionId]
    doc.retired[sessionId] = { id: retired.id, title: retired.title, text: retired.text }
  }
  await writeSessionOverrides(doc, home)
  return doc
}

/**
 * Clear every project default equal to one preset id, so the project tier
 * inherits again instead of pinning a missing preset.
 * @param value - the preset id to clear.
 * @param home - the DSH home root.
 * @returns the store after the update.
 */
export async function clearProjectValues(value: string, home = dshHome()) {
  const store = await readStore(home)
  let changed = false
  for (const [root, current] of Object.entries(store.projects)) {
    if (current !== value) continue
    delete store.projects[root]
    changed = true
  }
  if (changed) await writeStore(store, home)
  return store
}

/** The session-override document path. */
export function sessionOverridesPath(home = dshHome()) {
  return join(dataDir(home), 'session-goal-overrides.json')
}

/**
 * Read the session-goal overrides; malformed content degrades to empty.
 * Shape: {
 *   version: 1,
 *   sessions: { "<session id>": "<goal id>" | "none" },
 *   retired: { "<session id>": { id, title, text } },
 * }
 * ("none" = explicitly no goal; absent = not selected, inherits). Older
 * documents stored null for an explicit none — migrated to "none" on read.
 * `retired` is the deleted-preset freeze: the session has no selection, but
 * its committed prompt text is kept until an explicit pick replaces it.
 * @param home - the DSH home root.
 * @returns the parsed document.
 */
export async function readSessionOverrides(home = dshHome()): Promise<SessionStore> {
  try {
    const raw = await readFile(sessionOverridesPath(home), 'utf8')
    const parsed: Record<string, unknown> = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    if (parsed.version !== STORE_VERSION) throw new Error('unsupported version ' + parsed.version)
    if (parsed.sessions === null || typeof parsed.sessions !== 'object' || Array.isArray(parsed.sessions)) throw new Error('sessions is not an object')
    for (const key of Object.keys(parsed.sessions)) {
      if ((parsed.sessions as Record<string, unknown>)[key] === null) (parsed.sessions as Record<string, unknown>)[key] = 'none'
    }
    const retired: Record<string, RetiredPrompt> = {}
    if (parsed.retired !== null && typeof parsed.retired === 'object' && !Array.isArray(parsed.retired)) {
      for (const [sessionId, entry] of Object.entries(parsed.retired)) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
        if (typeof entry.id !== 'string' || typeof entry.title !== 'string' || typeof entry.text !== 'string') continue
        retired[sessionId] = { id: entry.id, title: entry.title, text: entry.text }
      }
    }
    parsed.retired = retired
    return parsed as unknown as SessionStore
  } catch (error) {
    if (errorDetails(error).code !== 'ENOENT') console.warn('mode-mod store: reading ' + sessionOverridesPath(home) + ' failed (' + (errorDetails(error).message ?? error) + '); treating as empty')
    return { version: STORE_VERSION, sessions: {}, retired: {} }
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
export async function setSessionOverride(sessionId: string, value: string | null | undefined, home = dshHome()) {
  const doc = await readSessionOverrides(home)
  if (value === null || value === undefined) delete doc.sessions[sessionId]
  else doc.sessions[sessionId] = value
  // An explicit pick is the one event that may replace a deleted preset's
  // frozen text, so the retirement record goes with the new value.
  if (doc.retired[sessionId] !== undefined) delete doc.retired[sessionId]
  await writeSessionOverrides(doc, home)
  return doc
}

/**
 * Persist the session values atomically.
 * @param doc - the complete document.
 * @param home - the DSH home root.
 */
async function writeSessionOverrides(doc: SessionStore, home: string) {
  const target = sessionOverridesPath(home)
  await mkdir(dirname(target), { recursive: true })
  const tmp = join(parse(target).dir, '.session-goal-overrides.' + process.pid + '.tmp')
  await writeFile(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  await rename(tmp, target)
}

/**
 * Set or clear one project's value and persist.
 * @param root - the resolved project root.
 * @param value - a goal id or "none" (explicit no goal, blocks the global
 *   tier); null deletes the entry so the project inherits again.
 * @param home - the DSH home root.
 * @returns the store after the update.
 */
export async function setProjectValue(root: string, value: string | null, home = dshHome()) {
  const store = await readStore(home)
  if (value === null) delete store.projects[root]
  else store.projects[root] = value
  await writeStore(store, home)
  return store
}
