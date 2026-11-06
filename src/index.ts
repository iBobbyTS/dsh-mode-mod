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
 * Same-origin JSON API for the browser half:
 *   GET  /api/mode-mod/state?session=<id>   tier-by-tier goal state
 *   POST /api/mode-mod/goal                 { session, value } (value null = unselect; "none" = explicit none)
 *   POST /api/mode-mod/project              { session, value } (value null clears; "none" = explicit none)
 * @module @local/dsh-mode-mod
 */

import { GOALS, loadGoalTexts, renderGoalSection } from './presets.js'
import { PTC_GUIDANCE_TEXT } from './guidance.js'
import {
  clearProjectValues, createCustomPrompt, deleteCustomPrompt,
  lookupProjectValue, readCustomPrompts, readSessionOverrides, readStore,
  resolveProjectRoot, retireSessionValues, setProjectValue, setSessionOverride, updateCustomPrompt,
} from './store.js'

/** Stable Cordis plugin name (matches the bundle patch insert id). */
export const name = 'mode-mod'

/** The preset registry reads composition; the web server mounts the API; the registry lists agents for reconciliation. */
export const inject = ['agentPresets', 'webServer', 'agents']

/** Preset ids whose composition presents PTC and therefore carries the run_code guidance. */
const GUIDANCE_PRESETS = new Set(['ptc', 'cordis'])

/** A session id the goal API accepts even when no live agent owns it (a closed session's stored value). */
const SESSION_ID_PATTERN = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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

  // 2. The same-origin API for the browser half.
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
    const disposers = [ctx.webServer.register(stateRoute), ctx.webServer.register(goalRoute), ctx.webServer.register(projectRoute), ctx.webServer.register(promptsRoute), ctx.webServer.register(promptRoute)]
    return () => { for (const dispose of disposers) dispose?.() }
  }, 'mode-mod: routes')
}
