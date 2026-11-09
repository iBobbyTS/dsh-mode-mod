import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HostContext, Agent, PromptService, PromptSection, Route } from './host-contract.js'
import type { ProjectStore, SessionStore, RetiredPrompt, PromptDocument } from './protocol.js'
import { errorDetails } from './errors.js'
/**
 * dsh-mode-mod host half. Two ORTHOGONAL dimensions over one plugin row:
 *
 * Modes are the shipped agent presets (standard / ptc / cordis / minimal),
 * owned by the preset registry — this plugin no longer registers any preset,
 * so the session-header preset picker stays pure.
 *
 * System-prompt presets (development goals) are a separate dimension layered
 * on top of whatever mode a session runs:
 *  - one scoped prompt section "mode-mod:goal" (right after the persona
 *    suffix) is registered through each TOP-LEVEL agent's own context, so it
 *    applies to that session alone, survives preset switches (the agent scope
 *    outlives preset rebinds), and never leaks into other sessions. Top-level
 *    means a root session or a seeded fork (delegationDepth 0, not a
 *    subagent); child agent sessions get no goal of their own.
 *  - the goal is resolved by tier: session value (plugin-owned store keyed by
 *    session id — the harness session log rejects event types unknown to it,
 *    so third-party plugin state lives in plugin data, not session events) >
 *    project default (plugin store) > global default (config.defaultGoal) —
 *    at any tier, "none" pins no goal and blocks the tiers beneath while an
 *    absent (null) entry inherits from the tier beneath. Inheritance is
 *    resolved ONCE: the first prompt assembly of a session that has no stored
 *    value writes the resolved value back as that session's own value, so a
 *    later project-default change never moves a session that has already
 *    started. A session the plugin has no record of (never opened in this
 *    process, no stored value) reads as no goal.
 *  - a goal change writes the session value and the next assembly picks it
 *    up: the same section swaps its text, prefixed from then on with the
 *    supersedes header (ACTIVE_PRESET_HEADER), and the harness admits the
 *    changed system prompt itself — an in-history append for routes that
 *    declare systemPromptUpdate 'in-history' (cached history prefix kept),
 *    a head rewrite otherwise (the provider re-bills the prefix once).
 *
 * The run_code description guidance (src/guidance.js) is likewise injected
 * per agent — for every agent, subagents included, whose live composition
 * presents PTC (presets ptc and cordis) — instead of riding preset trees.
 *
 * Agents that already exist when this plugin loads (a hot reload, or a load
 * after sessions were resumed) are reconciled through the live agent
 * registry: their "agent/created" has already fired and will not repeat, so
 * skipping them would silently drop the goal section until the session is
 * reopened.
 *
 * Project language requirements are a third, independent dimension:
 *  - the entry checklist is global (plugin data, no built-ins); each project
 *    stores its own multi-selection keyed by the same resolved project root;
 *  - a selection or a body edit delivers a persistent user message through the
 *    single Host verb `send(message, 'next-step', false)` — the harness
 *    `inject()` that never wakes the driver. A busy agent claims it at its
 *    nearest step boundary; an idle agent keeps it pending until the next
 *    waking message, whose turn claims all next-step input before the
 *    user-authored next-turn item, so the requirement enters the same step and
 *    ahead of the user message at no extra model call;
 *  - delivery dedup is a three-state predicate: the session history already
 *    holds (entryId, version), the live inbox still pends it, or a claim for it
 *    is unresolved (claimed by a open turn, not yet admitted to history). The
 *    unresolved window defers the decision instead of re-enqueueing; a turn
 *    that ends without admitting the claim releases the suppression, so a
 *    cancellation or a rejected step heals on the next idle transition;
 *  - every agent is covered, subagents included. No system-prompt section is
 *    added or modified anywhere in this dimension.
 *
 * Same-origin JSON API for the browser half:
 *   GET  /api/mode-mod/state?session=<id>   tier-by-tier goal state
 *   POST /api/mode-mod/goal                 { session, value } (value null = unselect; "none" = explicit none)
 *   POST /api/mode-mod/project              { session, value } (value null clears; "none" = explicit none)
 *   GET  /api/mode-mod/languages?session=<id>   entries + this project's selection
 *   POST /api/mode-mod/language            { action: "create" | "update" | "delete", id?, entry? }
 *   POST /api/mode-mod/language-selection  { session, ids: string[] } (replaces the project selection)
 * @module @local/dsh-mode-mod
 */

import { randomUUID } from 'node:crypto'
import { GOALS, loadGoalTexts, renderGoalSection } from './presets.js'
import { PTC_GUIDANCE_TEXT } from './guidance.js'
import type { LanguageDocument, LanguageEntry, LanguageProjectStore } from './protocol.js'
import {
  clearLanguageSelections, clearProjectValues, createCustomPrompt, createLanguageEntry, deleteCustomPrompt,
  deleteLanguageEntry, lookupProjectValue, readCustomPrompts, readLanguageEntries, readLanguageProjects,
  readSessionOverrides, readStore, resolveProjectRoot, retireSessionValues, setProjectLanguages,
  setProjectValue, setSessionOverride, updateCustomPrompt, updateLanguageEntry,
} from './store.js'

/** Stable Cordis plugin name (matches the bundle patch insert id). */
export const name = 'mode-mod'

/** The preset registry reads composition; the web server mounts the API; the registry lists agents for reconciliation. */
export const inject = ['agentPresets', 'webServer', 'agents']

/** Preset ids whose composition presents PTC and therefore carries the run_code guidance. */
const GUIDANCE_PRESETS = new Set(['ptc', 'cordis'])

/** A session id the goal API accepts even when no live agent owns it (a closed session's stored value). */
const SESSION_ID_PATTERN = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Source kind carried by every injected language-requirement message. It is
 * the structural identity the dedupe predicate scans for in history and in
 * the live inbox; the body content is never compared.
 */
const LANGUAGE_SOURCE_KIND = 'mode-mod-language'

/** An entry is deliverable once both its title and its body are non-empty. */
function deliverableLanguageEntry(entry: LanguageEntry) {
  return entry.title.trim() !== '' && entry.prompt.trim() !== ''
}

/**
 * The model-facing body of one injected requirement. The heading is a stable
 * product string, so an unchanged entry keeps the same content across
 * restarts; only the entry body follows the user's edits.
 * @param entry - the live entry row.
 * @returns the message text.
 */
function languageRequirementText(entry: LanguageEntry) {
  return '# Project language requirement: ' + entry.title.trim() + '\n\n' + entry.prompt.trim()
}

/**
 * Structurally construct one durable user message. Every delivery uses a fresh
 * message identity; the source carries the dedupe identity (entry id plus
 * monotonic body version) and a display line.
 * @param entry - the entry to inject.
 * @returns a message accepted by the Host inbox.
 */
function createLanguageMessage(entry: LanguageEntry) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: languageRequirementText(entry) }],
    source: {
      kind: LANGUAGE_SOURCE_KIND,
      entryId: entry.id,
      entryVersion: entry.version,
      title: entry.title.trim(),
    },
  }
}

/**
 * Read the dedupe identity out of an arbitrary message-shaped value.
 * @param message - a history event payload or an inbox item.
 * @returns "entryId:version", or undefined for anything this engine did not create.
 */
function languageMessageKey(message: unknown) {
  if (message === null || typeof message !== 'object') return undefined
  const source = (message as { source?: unknown }).source
  if (source === null || typeof source !== 'object') return undefined
  const record = source as Record<string, unknown>
  if (record.kind !== LANGUAGE_SOURCE_KIND) return undefined
  const entryId = record.entryId
  const version = record.entryVersion
  if (typeof entryId !== 'string' || typeof version !== 'number') return undefined
  return entryId + ':' + version
}

/**
 * Scan complete session history (fork-inherited prefix included) for delivered
 * requirement markers.
 * @param session - the session whose log to read.
 * @returns the set of "entryId:version" markers already committed.
 */
function languageHistoryKeys(session: Agent['session']) {
  const keys = new Set<string>()
  const events = session.snapshotEvents?.() ?? session.ownEvents?.() ?? []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const key = languageMessageKey(event.data)
    if (key !== undefined) keys.add(key)
  }
  return keys
}

/**
 * Scan the live durable inbox (both pending lists) for requirement markers.
 * @param inbox - the agent's inbox, when the Host exposes one.
 * @returns the set of "entryId:version" markers still pending.
 */
function languagePendingKeys(inbox: Agent['inbox']) {
  const keys = new Set<string>()
  for (const message of [...(inbox?.nextStep ?? []), ...(inbox?.nextTurn ?? [])]) {
    const key = languageMessageKey(message)
    if (key !== undefined) keys.add(key)
  }
  return keys
}

/** Loopback + same-origin browser markers, mirroring the host /api trust model. */
function isLocalBrowserRequest(req: IncomingMessage) {
  const address = req.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = req.headers?.host
  if (typeof host !== 'string') return false
  let hostname
  try { hostname = new URL('http://' + host).hostname } catch { return false }
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).hostname === hostname } catch { return false }
}

/** Write one JSON response. */
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * Read a capped JSON request body.
 * @param req - the incoming request.
 * @param limit - the maximum accepted byte count.
 * @returns the parsed body.
 */
function readJsonBody(req: IncomingMessage, limit = 16 * 1024) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        const error = new Error('body too large') as Error & { code: string }
        error.code = 'body-too-large'
        reject(error)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

/**
 * Mount the plugin: per-agent prompt sections and the API.
 * @param ctx - plugin context with agentPresets, webServer, and agents injected.
 * @param config - plugin config; `defaultGoal` names the global-tier goal id (none when absent/unknown).
 */
export function apply(ctx: HostContext, config: { defaultGoal?: unknown } = {}) {
  const texts = loadGoalTexts()
  const builtinById = new Map(GOALS.map((goal) => [goal.id, goal]))
  const rawDefault = config?.defaultGoal
  const defaultGoal = typeof rawDefault === 'string' && builtinById.has(rawDefault) ? rawDefault : undefined
  if (rawDefault !== undefined && defaultGoal === undefined) {
    ctx.logger.warn('mode-mod: unknown defaultGoal ' + JSON.stringify(rawDefault) + '; global tier stays unset')
  }

  /** Live top-level sessions by session id: { agent, cwd } — the API's handle for goal writes and project stars. */
  const sessions = new Map<string, { agent: Agent; cwd?: string }>()

  /** Session values (the frozen goal plus every later picker switch); hydrated at boot. */
  let overridesSnapshot: SessionStore = { version: 1, sessions: {}, retired: {} }

  /** Project defaults; re-read on every API call so a store edit is never stale. */
  let storeSnapshot: ProjectStore = { version: 1, projects: {} }
  const refreshStore = async () => { storeSnapshot = await readStore() }

  /** User-authored presets; hydrated at boot and replaced by every mutation. */
  let customSnapshot: PromptDocument = { version: 1, prompts: [] }
  const customById = (id: string) => customSnapshot.prompts.find((preset) => preset.id === id)
  /** Only complete presets are offered in the picker; an empty draft stays in the manager. */
  const selectableCustom = () => customSnapshot.prompts.filter((preset) => preset.title.trim() !== '' && preset.prompt.trim() !== '')

  /**
   * Live sessions whose selected preset was deleted: their committed system
   * prompt keeps rendering the deleted text until the user selects a new
   * preset for that session. The stored session value is already null.
   */
  const retiredPrompts = new Map<string, RetiredPrompt>()

  /**
   * The exact section text each live session assembled last, so deletion can
   * freeze the bytes the harness already committed (including the sticky
   * supersedes header) instead of re-rendering them from scratch.
   */
  const lastRendered = new Map<string, string>()

  /** Read the display name of one goal id, falling back to the raw id. */
  const goalName = (id: string | null | undefined) => {
    if (id === null || id === undefined) return null
    const builtin = builtinById.get(id)
    if (builtin !== undefined) return builtin.name
    const custom = customById(id)
    if (custom !== undefined) return custom.title || id
    return id
  }

  /** Read the system-prompt body of one goal id; '' for none/unknown. */
  const goalText = (id: string | null | undefined) => {
    if (id === null || id === undefined) return ''
    return texts[id] ?? customById(id)?.prompt ?? ''
  }

  /** Whether a value names a goal the picker/API may write. */
  const knownGoal = (id: unknown): boolean => typeof id === 'string' && ( builtinById.has(id) || customById(id) !== undefined)

  /**
   * Boot hydration. A session may start before these reads settle; until they
   * do, the goal is reported but not pinned, so the freeze can never persist a
   * value derived from an empty store.
   */
  let hydrated = false
  const hydration = Promise.all([readSessionOverrides(), readStore(), readCustomPrompts()])
    .then(([overrides, store, prompts]) => {
      overridesSnapshot = overrides
      storeSnapshot = store
      customSnapshot = prompts
      // Deleted presets are frozen per session: a resumed session keeps the
      // prompt text it committed until the user selects another preset.
      for (const [sessionId, retired] of Object.entries(overrides.retired ?? {})) {
        retiredPrompts.set(sessionId, retired)
      }
    })
    .catch((error) => { ctx.logger.warn('mode-mod: reading plugin data failed: ' + (errorDetails(error).message ?? error)) })
    .finally(() => { hydrated = true })
  void hydration

  /* ------------------------------------------------------------------
   * Project language requirements: snapshots, write chains and delivery.
   * ------------------------------------------------------------------ */

  /** Global entry checklist; hydrated at boot and replaced by every mutation. */
  let languageEntries: LanguageDocument = { version: 1, entries: [] }

  /** Per-project multi-selection; hydrated at boot and replaced by every mutation. */
  let languageProjects: LanguageProjectStore = { version: 1, projects: {} }

  const languageHydration = Promise.all([readLanguageEntries(), readLanguageProjects()])
    .then(([entries, projects]) => {
      languageEntries = entries
      languageProjects = projects
    })
    .catch((error) => { ctx.logger.warn('mode-mod: reading language requirements failed: ' + (errorDetails(error).message ?? error)) })
  void languageHydration

  /** Entry and selection documents are read-modify-write: run each chain one call at a time. */
  let languageEntryWriteChain: Promise<unknown> = Promise.resolve()
  const writeLanguageEntriesDoc = <T>(fn: () => Promise<T>) => {
    const run = languageEntryWriteChain.then(fn)
    languageEntryWriteChain = run.catch(() => {})
    return run
  }
  let languageProjectWriteChain: Promise<unknown> = Promise.resolve()
  const writeLanguageProjectsDoc = <T>(fn: () => Promise<T>) => {
    const run = languageProjectWriteChain.then(fn)
    languageProjectWriteChain = run.catch(() => {})
    return run
  }

  /** Every live agent (subagents included) by session id: the language delivery targets. */
  const languageAgents = new Map<string, Agent>()

  /**
   * Claimed requirement deliveries by message id. A claim moves the message out
   * of the pending inbox before the asynchronous step preparation admits it to
   * history, so this window is the third dedupe state. An entry clears when the
   * matching user/message lands; a turn ending (including cancellation) clears
   * whatever never landed, releasing the suppression for self-healing.
   */
  const languageClaims = new Map<string, { agentId: string; key: string }>()

  /** One serialized delivery pass per session, so concurrent triggers cannot double-enqueue. */
  const languageDeliveryTails = new Map<string, Promise<void>>()

  const languageRootOf = (agent: Agent) => {
    const cwd = agent.session.header.cwd
    return cwd === undefined ? undefined : resolveProjectRoot(cwd)
  }

  const claimedKeysFor = (sessionId: string) => {
    const keys = new Set<string>()
    for (const claim of languageClaims.values()) if (claim.agentId === sessionId) keys.add(claim.key)
    return keys
  }

  /**
   * Deliver every selected requirement the session has neither committed nor
   * been handed, in selection order. The decision is made once per pass: a
   * message enqueued by this pass also suppresses a later identical selection
   * in it.
   * @param agent - the target agent.
   */
  const deliverLanguages = async (agent: Agent) => {
    await languageHydration
    if (languageAgents.get(agent.session.id) !== agent) return
    if (typeof agent.send !== 'function') return
    const root = languageRootOf(agent)
    if (root === undefined) return
    const selected = languageProjects.projects[root] ?? []
    if (selected.length === 0) return
    const byId = new Map(languageEntries.entries.map((entry) => [entry.id, entry]))
    const history = languageHistoryKeys(agent.session)
    const pending = languagePendingKeys(agent.inbox)
    const claimed = claimedKeysFor(agent.session.id)
    for (const id of selected) {
      const entry = byId.get(id)
      if (entry === undefined || !deliverableLanguageEntry(entry)) continue
      const key = entry.id + ':' + entry.version
      if (history.has(key) || pending.has(key) || claimed.has(key)) continue
      // The single Host verb: next-step, never waking. Busy agents claim it at
      // their nearest step boundary; idle agents keep it durable until the next
      // waking message claims the whole next-step batch ahead of its own turn.
      agent.send(createLanguageMessage(entry), 'next-step', false)
      pending.add(key)
    }
  }

  /**
   * Queue one delivery pass for an agent.
   * @param agent - the target agent.
   * @param reason - the trigger, for diagnostics only.
   */
  const queueLanguageDelivery = (agent: Agent, reason: string) => {
    const sessionId = agent.session.id
    const previous = languageDeliveryTails.get(sessionId) ?? Promise.resolve()
    const run = previous.then(() => deliverLanguages(agent)).catch((error) => {
      ctx.logger.warn('mode-mod: language delivery for ' + sessionId + ' (' + reason + ') failed: ' + (errorDetails(error).message ?? error))
    })
    languageDeliveryTails.set(sessionId, run)
    void run.finally(() => { if (languageDeliveryTails.get(sessionId) === run) languageDeliveryTails.delete(sessionId) })
  }

  /** Queue every live agent whose session resolves to one project root. */
  const deliverLanguagesInProject = (root: string) => {
    for (const agent of languageAgents.values()) {
      if (languageRootOf(agent) === root) queueLanguageDelivery(agent, 'project selection')
    }
  }

  /** Queue the live agents of every project that selects one entry (body edit delivery). */
  const deliverEditedLanguage = (entryId: string) => {
    for (const agent of languageAgents.values()) {
      const root = languageRootOf(agent)
      if (root === undefined) continue
      if ((languageProjects.projects[root] ?? []).includes(entryId)) queueLanguageDelivery(agent, 'entry edit')
    }
  }

  /** In-flight freeze writes by session id, so a state read answers with the value it just pinned. */
  const pendingFreezes = new Map<string, Promise<void>>()

  /** Override writes are read-modify-write of one document: run them one at a time. */
  let writeChain: Promise<unknown> = Promise.resolve()

  /** Custom-preset writes are read-modify-write of one document: run them one at a time. */
  let promptWriteChain: Promise<unknown> = Promise.resolve()
  const writePrompts = <T>(fn: () => Promise<T>) => {
    const run = promptWriteChain.then(fn)
    promptWriteChain = run.catch(() => {})
    return run
  }
  const writeOverride = (sessionId: string, value: string | null | undefined) => {
    const write = writeChain.then(async () => {
      try {
        overridesSnapshot = value === undefined
          ? await readSessionOverrides()
          : await setSessionOverride(sessionId, value)
      } catch (error) {
        ctx.logger.warn('mode-mod: writing the session value for ' + sessionId + ' failed: ' + (errorDetails(error).message ?? error))
      }
    })
    writeChain = write
    return write
  }

  /**
   * Map one tier's stored value to its goal choice: "none" pins no goal, a
   * known id selects it, anything else (or absent) made no choice.
   * @param value - a stored session value or project default.
   * @returns the goal id, null for none, or undefined when the tier did not choose.
   */
  const tierGoal = (value: unknown) => {
    if (value === 'none') return null
    if (typeof value !== 'string') return undefined
    if (knownGoal(value)) return value
    // A reference to a deleted custom preset means "no preset", never
    // "inherit the tier below": inheriting would silently swap the prompt of
    // a session that never asked for another one.
    if (value.startsWith('custom-')) return null
    return undefined
  }

  /**
   * Resolve the tiers beneath the session: project default, then the global default.
   * @param cwd - the session working directory, when it has one.
   * @returns the goal id, or null for no goal.
   */
  const inheritedGoal = (cwd: string | undefined) => {
    if (cwd !== undefined) {
      const projectTier = tierGoal(lookupProjectValue(storeSnapshot, resolveProjectRoot(cwd)))
      if (projectTier !== undefined) return projectTier
    }
    return defaultGoal ?? null
  }

  /**
   * Pin the inherited goal as this session's own value, once — the first
   * assembly of a session that has no stored value. Later project-default
   * changes therefore never move a session that has already started. The
   * in-memory snapshot is updated before returning, so the section text and
   * the API agree immediately; the document write follows on the write chain.
   * @param agent - the top-level agent whose session starts.
   * @returns the resolved goal id, or null.
   */
  const freezeSessionGoal = (agent: Agent) => {
    const id = agent.session.id
    const resolved = inheritedGoal(agent.session.header.cwd)
    const value = resolved ?? 'none'
    overridesSnapshot = { ...overridesSnapshot, sessions: { ...overridesSnapshot.sessions, [id]: value } }
    const pending = writeOverride(id, value)
    pendingFreezes.set(id, pending)
    void pending.finally(() => { if (pendingFreezes.get(id) === pending) pendingFreezes.delete(id) })
    return resolved
  }

  /**
   * Resolve the goal a session currently runs: its own stored value, else the
   * inherited one, which is pinned as its own value from then on.
   * @param agent - the top-level agent.
   * @returns the goal id, or null for none.
   */
  const goalFor = (agent: Agent) => {
    const sessionTier = tierGoal(overridesSnapshot.sessions[agent.session.id])
    if (sessionTier !== undefined) return sessionTier
    if (!hydrated) return inheritedGoal(agent.session.header.cwd)
    return freezeSessionGoal(agent)
  }

  /**
   * Whether a session owns a goal of its own: a root session or a seeded fork.
   * Subagent child sessions (origin "subagent", delegationDepth > 0) do not.
   * @param header - the session header.
   * @returns true for a top-level session.
   */
  const isTopLevel = (header: Agent['session']['header']) => header.origin !== 'subagent'
    && (header.parentSession === undefined || (header.isSeeded === true && (header.delegationDepth ?? 0) === 0))

  // 1. Per-agent prompt sections, registered through each agent's own scope.
  /** Goal-section assembly state per top-level agent (renderGoalSection's `previous`). */
  const goalSectionState = new WeakMap<Agent, { goal: string | null; header: boolean }>()
  ctx.effect(() => {
    // Agent scopes can outlive this plugin during hot reload. Release their
    // registrations on either lifetime, so no provider retains a dead plugin.
    const sectionDisposers = new Set<() => void>()
    const sectionFor = (agent: Agent, prompt: PromptService, section: PromptSection, label: string) => agent.ctx.effect(() => {
      const unregister = prompt.section(section)
      const dispose = () => {
        if (!sectionDisposers.delete(dispose)) return
        unregister()
      }
      sectionDisposers.add(dispose)
      return dispose
    }, label)
    const register = (agent: Agent) => {
      const prompt = agent.ctx.get('systemPrompt')
      if (prompt === undefined) {
        ctx.logger.warn('mode-mod: systemPrompt service unavailable; sections skipped for ' + agent.id)
        return
      }
      if (isTopLevel(agent.session.header)) {
        sessions.set(agent.session.id, { agent, cwd: agent.session.header.cwd })
        // Registered on the agent's fiber: disposed with the agent, scoped to it alone.
        // The text re-resolves the session value at every assembly, so a
        // mid-session goal change reaches the next model step through this
        // same section: renderGoalSection prepends the supersedes header from
        // the first assembly after a switch and keeps it, so an unchanged goal
        // renders byte-identical text and the harness commits no spurious
        // prompt update (cache stability for unchanged turns).
        sectionFor(agent, prompt, {
          name: 'mode-mod:goal',
          order: prompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 1,
          text: () => {
            // A deleted preset keeps rendering its last committed text: the
            // session value is already null, but rewriting the prompt here
            // would push a system update the user did not ask for. The stored
            // text is the exact bytes of the last assembly, header included.
            const retired = retiredPrompts.get(agent.session.id)
            if (retired !== undefined) return retired.text
            const goal = goalFor(agent)
            const rendered = renderGoalSection(goal, goalText(goal), goalSectionState.get(agent))
            goalSectionState.set(agent, rendered.state)
            lastRendered.set(agent.session.id, rendered.text)
            return rendered.text
          },
        }, 'mode-mod: goal section')
      }
      sectionFor(agent, prompt, {
        name: 'mode-mod:ptc-guidance',
        order: prompt.getSectionOrder('TOOLS_SDK') + 1,
        text: (context) => {
          const target = context?.agent ?? agent
          const preset = target.ctx.get('agentPresets')?.composedPreset(target.ctx)
          return GUIDANCE_PRESETS.has(preset ?? '') ? PTC_GUIDANCE_TEXT : ''
        },
      }, 'mode-mod: guidance section')
    }
    const attempt = (agent: Agent) => {
      try { register(agent) } catch (error) {
        ctx.logger.warn('mode-mod: per-agent sections failed for ' + agent.id + ': ' + (errorDetails(error).message ?? error))
      }
    }
    const offCreated = ctx.on('agent/created', ({ agent }) => { attempt(agent) })
    // The section providers registered on an agent's own fiber disappear with it.
    const offDisposed = ctx.on('agent/disposed', ({ agent }) => { sessions.delete(agent.session.id) })
    // Reconcile agents that were created before this fiber (hot reload, or a
    // load after sessions were resumed): "agent/created" has already fired and
    // will not repeat, so without this pass their goal section is missing.
    for (const agent of ctx.get('agents')?.list?.() ?? []) attempt(agent)
    return () => {
      offCreated?.()
      offDisposed?.()
      for (const dispose of sectionDisposers) dispose()
      sessions.clear()
    }
  }, 'mode-mod: agent sections')

  // 2. Language-requirement delivery: created/resumed agents, status settles,
  // claim tracking, and reconciliation of agents that predate this fiber.
  ctx.effect(() => {
    const register = (agent: Agent) => {
      languageAgents.set(agent.session.id, agent)
      queueLanguageDelivery(agent, 'agent/created')
    }
    const offCreated = ctx.on('agent/created', ({ agent }) => { register(agent) })
    const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
      languageAgents.delete(agent.session.id)
      for (const [messageId, claim] of languageClaims) {
        if (claim.agentId === agent.session.id) languageClaims.delete(messageId)
      }
    })
    const offStatus = ctx.on('agent/status', ({ agent, status }) => {
      if (status !== 'idle') return
      // A turn settled. A claim it never admitted is gone for good (cancelled
      // batch or rejected step), so clearing the window here is what lets the
      // next pass restore a requirement that never reached history.
      for (const [messageId, claim] of languageClaims) {
        if (claim.agentId === agent.session.id) languageClaims.delete(messageId)
      }
      queueLanguageDelivery(agent, 'idle settle')
    })
    const offClaimed = ctx.on('agent/inbox/claimed', ({ agent, message }) => {
      const key = languageMessageKey(message)
      if (key === undefined) return
      languageClaims.set(message.id, { agentId: agent.session.id, key })
    })
    const offSession = ctx.on('session/event', (_session, event) => {
      if (event?.type !== 'user/message') return
      if (languageMessageKey(event.data) === undefined) return
      // Admission transfers suppression ownership from the claim to history.
      languageClaims.delete((event.data as { id: string }).id)
    })
    // Agents that already exist when this plugin loads never repeat
    // agent/created. A running one may hold a claim from before this instance
    // existed; that message is no longer in the inbox and not yet in history,
    // and the log cannot reconstruct its identity. Its next idle transition is
    // the first decidable point, so reconciliation waits for it instead of
    // guessing.
    for (const agent of ctx.get('agents')?.list?.() ?? []) {
      languageAgents.set(agent.session.id, agent)
      if (agent.status === 'running') continue
      queueLanguageDelivery(agent, 'load reconciliation')
    }
    return () => {
      offCreated?.()
      offDisposed?.()
      offStatus?.()
      offClaimed?.()
      offSession?.()
      languageAgents.clear()
      languageClaims.clear()
      languageDeliveryTails.clear()
    }
  }, 'mode-mod: language delivery')

  // 3. The same-origin API for the browser half.
  ctx.effect(() => {
    const display = (id: string | null | undefined) => id === null || id === undefined || id === 'none' ? null : goalName(id)
    /**
     * Describe one session's tiers.
     * @param record - its live record, or undefined for a session with no agent.
     * @param sessionId - the session to describe.
     * @returns the JSON body fields shared by the state routes.
     */
    const stateOf = async (record: { agent: Agent; cwd?: string } | undefined, sessionId: string) => {
      await hydration
      await refreshStore()
      const pending = pendingFreezes.get(sessionId)
      if (pending !== undefined) await pending
      // Value domain per tier: null = not selected (inherit); "none" =
      // explicit no goal (blocks the tiers beneath); a goal id = that goal.
      const sessionValue = overridesSnapshot.sessions[sessionId] as string | null | undefined ?? null
      const root = record?.cwd === undefined ? undefined : resolveProjectRoot(record.cwd)
      const projectValue = root === undefined ? undefined : lookupProjectValue(storeSnapshot, root)
      const sessionTier = tierGoal(sessionValue)
      // A session the plugin has no record of reads as no goal: without a live
      // agent there is no session value to show and nothing inherited to claim.
      const effective = sessionTier !== undefined ? sessionTier : record === undefined ? null : inheritedGoal(record.cwd)
      // A deleted preset is no longer a selection: the session's stored value
      // is null while its already-committed prompt keeps rendering (retired).
      const retired = retiredPrompts.get(sessionId)
      return {
        known: record !== undefined,
        projectRoot: root,
        projectValue: projectValue ?? null,
        projectValueName: display(projectValue ?? null),
        sessionValue,
        sessionValueName: display(sessionValue),
        effectiveGoal: retired === undefined ? effective : null,
        effectiveGoalName: retired === undefined ? display(effective) : null,
        retiredGoal: retired === undefined ? null : { id: retired.id, name: retired.title || retired.id },
        retiredGoalName: retired === undefined ? null : (retired.title || retired.id),
        globalValue: defaultGoal ?? null,
        globalValueName: display(defaultGoal ?? null),
      }
    }
    const goalsPayload = () => GOALS.map((goal) => ({ id: goal.id, name: goal.name, description: goal.description }))
      .concat(selectableCustom().map((preset) => ({ id: preset.id, name: preset.title, description: preset.description })))
    const promptsPayload = () => ({
      builtins: GOALS.map((goal) => ({ id: goal.id, title: goal.name, description: goal.description, prompt: texts[goal.id] })),
      custom: customSnapshot.prompts.map((preset) => ({ ...preset })),
    })
    const stateRoute: Route = {
      method: 'GET',
      path: '/api/mode-mod/state',
      handler: async (req, res) => {
        if (!isLocalBrowserRequest(req)) { json(res, 403, { error: 'forbidden' }); return }
        let sessionId
        try { sessionId = new URL(req.url ?? '/', 'http://mode-mod.local').searchParams.get('session') ?? '' } catch { sessionId = '' }
        const goals = goalsPayload()
        json(res, 200, { sessionId, ...(await stateOf(sessions.get(sessionId), sessionId)), goals })
      },
    }
    const goalRoute: Route = {
      method: 'POST',
      path: '/api/mode-mod/goal',
      handler: async (req, res) => {
        if (!isLocalBrowserRequest(req)) { json(res, 403, { error: 'forbidden' }); return }
        let body
        try { body = await readJsonBody(req) } catch { json(res, 400, { error: 'invalid body' }); return }
        const sessionId = typeof body.session === 'string' ? body.session : ''
        const record = sessions.get(sessionId)
        // A closed session has no live agent but keeps a stored value the
        // picker may show and change; only a malformed id is rejected.
        if (record === undefined && !SESSION_ID_PATTERN.test(sessionId)) { json(res, 404, { error: 'unknown session' }); return }
        if (body.value !== null && body.value !== 'none' && !knownGoal(body.value)) {
          json(res, 400, { error: 'unknown goal', value: body.value ?? null })
          return
        }
        try {
          await writeOverride(sessionId, body.value as string | null)
          // An explicit pick is the one action that may replace a deleted
          // preset's frozen text.
          retiredPrompts.delete(sessionId)
          ctx.logger.info('mode-mod: session ' + sessionId + ' goal -> ' + (body.value ?? 'unselected'))
          json(res, 200, { sessionId, ...(await stateOf(record, sessionId)), goals: goalsPayload() })
        } catch (error) {
          json(res, 500, { error: 'write failed', detail: errorDetails(error).message ?? String(error) })
        }
      },
    }
    const projectRoute: Route = {
      method: 'POST',
      path: '/api/mode-mod/project',
      handler: async (req, res) => {
        if (!isLocalBrowserRequest(req)) { json(res, 403, { error: 'forbidden' }); return }
        let body
        try { body = await readJsonBody(req) } catch { json(res, 400, { error: 'invalid body' }); return }
        const sessionId = typeof body.session === 'string' ? body.session : ''
        const record = sessions.get(sessionId)
        if (record === undefined || record.cwd === undefined) { json(res, 404, { error: 'unknown session' }); return }
        if (body.value !== null && body.value !== 'none' && !knownGoal(body.value)) {
          json(res, 400, { error: 'unknown goal', value: body.value ?? null })
          return
        }
        const root = resolveProjectRoot(record.cwd)
        try {
          await setProjectValue(root, body.value as string | null)
          await refreshStore()
          ctx.logger.info('mode-mod: project ' + root + ' default goal -> ' + (body.value ?? 'cleared'))
          json(res, 200, { sessionId, ...(await stateOf(record, sessionId)), goals: goalsPayload() })
        } catch (error) {
          json(res, 500, { error: 'write failed', detail: errorDetails(error).message ?? String(error) })
        }
      },
    }
    const promptsRoute: Route = {
      method: 'GET',
      path: '/api/mode-mod/prompts',
      handler: async (req, res) => {
        if (!isLocalBrowserRequest(req)) { json(res, 403, { error: 'forbidden' }); return }
        await hydration
        json(res, 200, promptsPayload())
      },
    }
    /* Create/update/delete one user-authored system-prompt preset. Built-in
     * goals are shipped files and are rejected here, so the settings page can
     * only ever write the custom document. */
    const promptRoute: Route = {
      method: 'POST',
      path: '/api/mode-mod/prompt',
      handler: async (req, res) => {
        if (!isLocalBrowserRequest(req)) { json(res, 403, { error: 'forbidden' }); return }
        let body
        try { body = await readJsonBody(req, 256 * 1024) } catch (error) {
          json(res, errorDetails(error).code === 'body-too-large' ? 413 : 400, { error: 'invalid body' })
          return
        }
        const action = body?.action
        const id = typeof body?.id === 'string' ? body.id : ''
        if (builtinById.has(id)) { json(res, 400, { error: 'built-in presets are read-only' }); return }
        try {
          if (action === 'create') {
            const { doc, entry } = await writePrompts(() => createCustomPrompt(body.preset ?? {}))
            customSnapshot = doc
            ctx.logger.info('mode-mod: created custom preset ' + entry.id)
            json(res, 200, { ...promptsPayload(), createdId: entry.id })
            return
          }
          if (action === 'update') {
            if (id === '') { json(res, 400, { error: 'missing preset id' }); return }
            const { doc, entry } = await writePrompts(() => updateCustomPrompt(id, body.preset ?? {}))
            customSnapshot = doc
            ctx.logger.info('mode-mod: updated custom preset ' + entry.id)
            json(res, 200, { ...promptsPayload(), updatedId: entry.id })
            return
          }
          if (action === 'delete') {
            if (id === '') { json(res, 400, { error: 'missing preset id' }); return }
            const outcome = await writePrompts(async () => {
              // Settle pending session writes first: the delete must see the
              // values those writes pin, and must clear them afterwards.
              await writeChain
              await refreshStore()
              const target = customById(id)
              if (target === undefined) return { missing: true } as const
              // Every stored selection of the preset — live or closed — is
              // retired. A live session that inherited it without a stored
              // value is retired in memory as well.
              const retireIds = new Set<string>()
              for (const [sessionId, value] of Object.entries(overridesSnapshot.sessions)) {
                if (value === id) retireIds.add(sessionId)
              }
              for (const [sessionId, record] of sessions) {
                const own = tierGoal(overridesSnapshot.sessions[sessionId])
                const effective = own !== undefined ? own : inheritedGoal(record.cwd)
                if (effective === id) retireIds.add(sessionId)
              }
              // Freeze the text the session already committed. The stored
              // session value becomes null, the section keeps rendering these
              // bytes until an explicit pick replaces them. A live session
              // reuses its last assembly verbatim; a closed one falls back to
              // the preset body.
              for (const sessionId of retireIds) {
                retiredPrompts.set(sessionId, {
                  id,
                  title: target.title,
                  text: lastRendered.get(sessionId) ?? target.prompt,
                })
              }
              const { doc } = await deleteCustomPrompt(id)
              const records = new Map([...retireIds].map((sessionId) => [sessionId, retiredPrompts.get(sessionId)!]))
              // The retirement is a read-modify-write of the session document:
              // append it to the same chain as goal writes, never beside it.
              const retireWrite = writeChain.then(() => retireSessionValues(records))
              writeChain = retireWrite.catch(() => {})
              const overrides = await retireWrite
              return { doc, overrides }
            })
            if (outcome.missing === true) { json(res, 404, { error: 'unknown custom preset' }); return }
            customSnapshot = outcome.doc
            overridesSnapshot = outcome.overrides
            storeSnapshot = await clearProjectValues(id)
            ctx.logger.info('mode-mod: deleted custom preset ' + id)
            json(res, 200, { ...promptsPayload(), deletedId: id })
            return
          }
          json(res, 400, { error: 'unknown action' })
        } catch (error) {
          const status = errorDetails(error).code === 'validation' ? 400 : errorDetails(error).code === 'not-found' ? 404 : 500
          json(res, status, { error: errorDetails(error).message ?? String(error) })
        }
      },
    }
    /* ---- Project language requirements ------------------------------- */

    /**
     * Describe the global entries plus one session's project selection.
     * @param record - the live session record, when there is one.
     * @param sessionId - the session the caller asked about ('' for the manager).
     * @returns the JSON body shared by every language route.
     */
    const languagePayload = (record: { agent: Agent; cwd?: string } | undefined, sessionId: string) => {
      const root = record?.cwd === undefined ? undefined : resolveProjectRoot(record.cwd)
      // A hand-edited or raced document can name an entry that no longer
      // exists; the picker only ever sees live ids.
      const known = new Set(languageEntries.entries.map((entry) => entry.id))
      return {
        sessionId,
        projectRoot: root ?? null,
        selected: root === undefined ? [] : [...(languageProjects.projects[root] ?? [])].filter((id) => known.has(id)),
        entries: languageEntries.entries.map((entry) => ({ ...entry })),
      }
    }
    /**
     * Parse the optional session from a GET URL.
     * @param req - the incoming request.
     * @returns the session id, or ''.
     */
    const sessionFromUrl = (req: IncomingMessage) => {
      try { return new URL(req.url ?? '/', 'http://mode-mod.local').searchParams.get('session') ?? '' } catch { return '' }
    }
    const languagesRoute: Route = {
      method: 'GET',
      path: '/api/mode-mod/languages',
      handler: async (req, res) => {
        if (!isLocalBrowserRequest(req)) { json(res, 403, { error: 'forbidden' }); return }
        await languageHydration
        const sessionId = sessionFromUrl(req)
        json(res, 200, languagePayload(sessions.get(sessionId), sessionId))
      },
    }
    /* Create/update/delete one language entry. An update whose normalized body
     * actually changed is a new version and is delivered to every live agent
     * of a project that selects the entry; an unchanged save delivers nothing. */
    const languageRoute: Route = {
      method: 'POST',
      path: '/api/mode-mod/language',
      handler: async (req, res) => {
        if (!isLocalBrowserRequest(req)) { json(res, 403, { error: 'forbidden' }); return }
        let body
        try { body = await readJsonBody(req, 256 * 1024) } catch (error) {
          json(res, errorDetails(error).code === 'body-too-large' ? 413 : 400, { error: 'invalid body' })
          return
        }
        const action = body?.action
        const id = typeof body?.id === 'string' ? body.id : ''
        const sessionId = typeof body?.session === 'string' ? body.session : ''
        await languageHydration
        try {
          if (action === 'create') {
            const { doc, entry } = await writeLanguageEntriesDoc(() => createLanguageEntry(body.entry ?? {}))
            languageEntries = doc
            ctx.logger.info('mode-mod: created language entry ' + entry.id)
            json(res, 200, languagePayload(sessions.get(sessionId), sessionId))
            return
          }
          if (action === 'update') {
            if (id === '') { json(res, 400, { error: 'missing entry id' }); return }
            const outcome = await writeLanguageEntriesDoc(() => updateLanguageEntry(id, body.entry ?? {}))
            languageEntries = outcome.doc
            // The snapshot is current by the time this queues, so a pass reads
            // the new version while the old one keeps whatever suppression its
            // pending or committed copy earned.
            if (outcome.bodyChanged) deliverEditedLanguage(outcome.entry.id)
            ctx.logger.info('mode-mod: updated language entry ' + outcome.entry.id + ' to version ' + String(outcome.entry.version))
            json(res, 200, languagePayload(sessions.get(sessionId), sessionId))
            return
          }
          if (action === 'delete') {
            if (id === '') { json(res, 400, { error: 'missing entry id' }); return }
            const outcome = await writeLanguageEntriesDoc(async () => {
              const removed = await deleteLanguageEntry(id)
              // Publish the new checklist before clearing selections, so a
              // selection write queued behind this one validates against it.
              languageEntries = removed.doc
              const projects = await writeLanguageProjectsDoc(() => clearLanguageSelections(id))
              return { doc: removed.doc, projects }
            })
            languageEntries = outcome.doc
            languageProjects = outcome.projects
            // History keeps the injected text; nothing is delivered and nothing
            // is rewritten in a running session.
            ctx.logger.info('mode-mod: deleted language entry ' + id)
            json(res, 200, languagePayload(sessions.get(sessionId), sessionId))
            return
          }
          json(res, 400, { error: 'unknown action' })
        } catch (error) {
          const status = errorDetails(error).code === 'validation' ? 400 : errorDetails(error).code === 'not-found' ? 404 : 500
          json(res, status, { error: errorDetails(error).message ?? String(error) })
        }
      },
    }
    /* Replace one project's multi-selection. Both picker seats use this route:
     * additions deliver to every live agent of the project; removals deliver
     * nothing and never delete committed context. */
    const languageSelectionRoute: Route = {
      method: 'POST',
      path: '/api/mode-mod/language-selection',
      handler: async (req, res) => {
        if (!isLocalBrowserRequest(req)) { json(res, 403, { error: 'forbidden' }); return }
        let body
        try { body = await readJsonBody(req) } catch { json(res, 400, { error: 'invalid body' }); return }
        await languageHydration
        const sessionId = typeof body.session === 'string' ? body.session : ''
        const record = sessions.get(sessionId)
        if (record === undefined || record.cwd === undefined) { json(res, 404, { error: 'unknown session' }); return }
        if (!Array.isArray(body.ids)) { json(res, 400, { error: 'ids must be an array' }); return }
        const selectable = new Set(languageEntries.entries.filter(deliverableLanguageEntry).map((entry) => entry.id))
        for (const id of body.ids) {
          if (typeof id !== 'string' || !selectable.has(id)) {
            json(res, 400, { error: 'unknown language entry', value: id ?? null })
            return
          }
        }
        const root = resolveProjectRoot(record.cwd)
        const requested = body.ids as unknown[]
        try {
          let applied = false
          await writeLanguageProjectsDoc(async () => {
            // Re-check against the current checklist inside the write chain: a
            // deletion that landed after this request validated must win.
            const current = new Set(languageEntries.entries.filter(deliverableLanguageEntry).map((entry) => entry.id))
            const ids = requested.filter((id): id is string => typeof id === 'string' && current.has(id))
            if (ids.length !== requested.length) return
            languageProjects = await setProjectLanguages(root, ids)
            applied = true
          })
          if (!applied) { json(res, 400, { error: 'unknown language entry' }); return }
          deliverLanguagesInProject(root)
          ctx.logger.info('mode-mod: project ' + root + ' language requirements -> ' + (body.ids.length === 0 ? 'none' : (body.ids as string[]).join(', ')))
          json(res, 200, languagePayload(record, sessionId))
        } catch (error) {
          json(res, 500, { error: 'write failed', detail: errorDetails(error).message ?? String(error) })
        }
      },
    }
    const disposers = [
      stateRoute, goalRoute, projectRoute, promptsRoute, promptRoute,
      languagesRoute, languageRoute, languageSelectionRoute,
    ].map((route) => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose?.() }
  }, 'mode-mod: routes')
}
