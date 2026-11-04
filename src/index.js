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
 *    outlives preset rebinds), and never leaks into other sessions;
 *  - the section text is a provider evaluated at every assembly, resolving
 *    the goal by tier: session override (plugin-owned store keyed by session
 *    id — the harness session log rejects event types unknown to it, so
 *    third-party plugin state lives in plugin data, not session events) >
 *    project default (plugin store) > global default (config.defaultGoal);
 *  - a goal change writes the session override and the next assembly picks
 *    it up; mid-session changes ride the harness's in-history prompt
 *    admission.
 *
 * The run_code description guidance (src/guidance.js) is likewise injected
 * per agent — for every agent, subagents included, whose live composition
 * presents PTC (presets ptc and cordis) — instead of riding preset trees.
 *
 * Same-origin JSON API for the browser half:
 *   GET  /api/mode-mod/state?session=<id>   tier-by-tier goal state
 *   POST /api/mode-mod/goal                 { session, value } (value null = none)
 *   POST /api/mode-mod/project              { session, value } (value null clears)
 * @module @local/dsh-mode-mod
 */

import { GOALS, loadGoalTexts } from './presets.js'
import { PTC_GUIDANCE_TEXT } from './guidance.js'
import { lookupProjectValue, readSessionOverrides, readStore, resolveProjectRoot, setProjectValue, setSessionOverride } from './store.js'

/** Stable Cordis plugin name (matches the bundle patch insert id). */
export const name = 'mode-mod'

/** The preset registry reads composition; the web server mounts the API. */
export const inject = ['agentPresets', 'webServer']

/** Preset ids whose composition presents PTC and therefore carries the run_code guidance. */
const GUIDANCE_PRESETS = new Set(['ptc', 'cordis'])

/** Loopback + same-origin browser markers, mirroring the host /api trust model. */
function isLocalBrowserRequest(req) {
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
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Read a capped JSON request body. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 16 * 1024) { reject(new Error('body too large')); req.destroy(); return }
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
 * Mount the plugin: projection, per-agent prompt sections, and the API.
 * @param ctx - plugin context with agentPresets and webServer injected.
 * @param config - plugin config; `defaultGoal` names the global-tier goal id (none when absent/unknown).
 */
export function apply(ctx, config = {}) {
  const texts = loadGoalTexts()
  const goalById = new Map(GOALS.map((goal) => [goal.id, goal]))
  const rawDefault = config?.defaultGoal
  const defaultGoal = typeof rawDefault === 'string' && goalById.has(rawDefault) ? rawDefault : undefined
  if (rawDefault !== undefined && defaultGoal === undefined) {
    ctx.logger.warn('mode-mod: unknown defaultGoal ' + JSON.stringify(rawDefault) + '; global tier stays unset')
  }

  /** Top-level sessions by session id: { agent, cwd } — the API's handle for goal writes. */
  const sessions = new Map()

  /** Sync session-override snapshot for the prompt provider (hydrated at boot, refreshed after writes). */
  let overridesSnapshot = { version: 1, sessions: {} }
  readSessionOverrides().then((doc) => { overridesSnapshot = doc }).catch(() => {})

  /** Sync store snapshot for the prompt provider (refreshed on every read/write). */
  let storeSnapshot = { version: 1, projects: {} }
  const refreshStore = async () => { storeSnapshot = await readStore() }
  refreshStore()

  /**
   * Resolve the goal a session currently runs, session tier first.
   * @param agent - the top-level agent.
   * @returns the goal id, or null for none.
   */
  const goalFor = (agent) => {
    if (Object.hasOwn(overridesSnapshot.sessions, agent.session.id)) {
      const override = overridesSnapshot.sessions[agent.session.id] ?? null
      return override !== null && goalById.has(override) ? override : null
    }
    const cwd = agent.session.header.cwd
    if (cwd !== undefined) {
      const value = lookupProjectValue(storeSnapshot, resolveProjectRoot(cwd))
      if (value !== undefined && goalById.has(value)) return value
    }
    return defaultGoal ?? null
  }

  // 1. Per-agent prompt sections, registered through each agent's own scope.
  ctx.effect(() => {
    const offCreated = ctx.on('agent/created', ({ agent }) => {
      try {
        const prompt = agent.ctx.get('systemPrompt')
        if (prompt === undefined) {
          ctx.logger.warn('mode-mod: systemPrompt service unavailable; sections skipped for ' + agent.id)
          return
        }
        if (agent.session.header.parentSession === undefined) {
          sessions.set(agent.session.id, { agent, cwd: agent.session.header.cwd })
          // Registered on the agent's fiber: disposed with the agent, scoped to it alone.
          agent.ctx.effect(() => prompt.section({
            name: 'mode-mod:goal',
            order: prompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 1,
            text: () => texts[goalFor(agent)] ?? '',
          }), 'mode-mod: goal section')
        }
        agent.ctx.effect(() => prompt.section({
          name: 'mode-mod:ptc-guidance',
          order: prompt.getSectionOrder('TOOLS_SDK') + 1,
          text: (context) => {
            const target = context?.agent ?? agent
            const preset = ctx.agentPresets.composedPreset(target.ctx)
            return GUIDANCE_PRESETS.has(preset) ? PTC_GUIDANCE_TEXT : ''
          },
        }), 'mode-mod: guidance section')
      } catch (error) {
        ctx.logger.warn('mode-mod: per-agent sections failed for ' + agent.id + ': ' + (error?.message ?? error))
      }
    })
    return () => { offCreated?.(); sessions.clear() }
  }, 'mode-mod: agent sections')

  // 2. The same-origin API for the browser half.
  ctx.effect(() => {
    const display = (id) => id === null || id === undefined ? null : (goalById.get(id)?.name ?? id)
    const stateOf = async (record) => {
      await refreshStore()
      const id = record.agent.session.id
      const sessionValue = Object.hasOwn(overridesSnapshot.sessions, id) ? (overridesSnapshot.sessions[id] ?? null) : null
      const root = record.cwd === undefined ? undefined : resolveProjectRoot(record.cwd)
      const projectValue = root === undefined ? undefined : lookupProjectValue(storeSnapshot, root)
      const effective = sessionValue !== null ? sessionValue
        : projectValue !== undefined && goalById.has(projectValue) ? projectValue
          : defaultGoal ?? null
      return {
        projectRoot: root,
        projectValue: projectValue ?? null,
        projectValueName: display(projectValue ?? null),
        sessionValue,
        sessionValueName: display(sessionValue),
        effectiveGoal: effective,
        effectiveGoalName: display(effective),
        globalValue: defaultGoal ?? null,
        globalValueName: display(defaultGoal ?? null),
      }
    }
    const goalsPayload = () => GOALS.map((goal) => ({ id: goal.id, name: goal.name, description: goal.description }))
    const stateRoute = {
      method: 'GET',
      path: '/api/mode-mod/state',
      handler: async (req, res) => {
        if (!isLocalBrowserRequest(req)) { json(res, 403, { error: 'forbidden' }); return }
        let sessionId
        try { sessionId = new URL(req.url ?? '/', 'http://mode-mod.local').searchParams.get('session') ?? '' } catch { sessionId = '' }
        const goals = goalsPayload()
        const record = sessions.get(sessionId)
        if (record === undefined) { json(res, 200, { known: false, goals }); return }
        json(res, 200, { known: true, sessionId, ...(await stateOf(record)), goals })
      },
    }
    const goalRoute = {
      method: 'POST',
      path: '/api/mode-mod/goal',
      handler: async (req, res) => {
        if (!isLocalBrowserRequest(req)) { json(res, 403, { error: 'forbidden' }); return }
        let body
        try { body = await readJsonBody(req) } catch { json(res, 400, { error: 'invalid body' }); return }
        const record = sessions.get(typeof body.session === 'string' ? body.session : '')
        if (record === undefined) { json(res, 404, { error: 'unknown session' }); return }
        if (body.value !== null && !goalById.has(body.value)) {
          json(res, 400, { error: 'unknown goal', value: body.value ?? null })
          return
        }
        try {
          overridesSnapshot = await setSessionOverride(record.agent.session.id, body.value ?? null)
          ctx.logger.info('mode-mod: session ' + record.agent.session.id + ' goal -> ' + (body.value ?? 'none'))
          json(res, 200, { known: true, sessionId: record.agent.session.id, ...(await stateOf(record)), goals: goalsPayload() })
        } catch (error) {
          json(res, 500, { error: 'write failed', detail: error?.message ?? String(error) })
        }
      },
    }
    const projectRoute = {
      method: 'POST',
      path: '/api/mode-mod/project',
      handler: async (req, res) => {
        if (!isLocalBrowserRequest(req)) { json(res, 403, { error: 'forbidden' }); return }
        let body
        try { body = await readJsonBody(req) } catch { json(res, 400, { error: 'invalid body' }); return }
        const record = sessions.get(typeof body.session === 'string' ? body.session : '')
        if (record === undefined || record.cwd === undefined) { json(res, 404, { error: 'unknown session' }); return }
        if (body.value !== null && !goalById.has(body.value)) {
          json(res, 400, { error: 'unknown goal', value: body.value ?? null })
          return
        }
        const root = resolveProjectRoot(record.cwd)
        try {
          await setProjectValue(root, body.value === null ? null : body.value)
          storeSnapshot = await readStore()
          ctx.logger.info('mode-mod: project ' + root + ' default goal -> ' + (body.value ?? 'cleared'))
          json(res, 200, { known: true, sessionId: record.agent.session.id, ...(await stateOf(record)), goals: goalsPayload() })
        } catch (error) {
          json(res, 500, { error: 'write failed', detail: error?.message ?? String(error) })
        }
      },
    }
    const disposers = [ctx.webServer.register(stateRoute), ctx.webServer.register(goalRoute), ctx.webServer.register(projectRoute)]
    return () => { for (const dispose of disposers) dispose?.() }
  }, 'mode-mod: routes')
}
