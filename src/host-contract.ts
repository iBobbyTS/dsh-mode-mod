import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Structural views of the Host agent API this plugin depends on. The hosts
 * that load this plugin also expose full runtime types; these are the minimum
 * shapes the delivery engine reads, kept optional where a fixture may omit
 * them so plugin mounting never depends on more than the composing Host
 * provides.
 */

/** One model-facing content block; the engine only ever writes text blocks. */
export interface ContentBlock { type: string; text?: string }

/** A durable user message as the inbox and session log carry it. */
export interface InboxMessage {
  id: string
  role?: string
  content?: readonly ContentBlock[]
  source?: { kind?: string; [key: string]: unknown }
}

/** Pending inbox work; claiming moves next-step work into the current step. */
export interface AgentInbox {
  readonly nextStep: readonly InboxMessage[]
  readonly nextTurn?: readonly InboxMessage[]
}

/** One durable session event; only user/message data is read here. */
export interface SessionEventView {
  type: string
  seq?: number
  data?: unknown
}

/** The session surface the delivery engine reads. */
export interface AgentSession {
  id: string
  header: { cwd?: string; origin?: string; parentSession?: unknown; isSeeded?: boolean; delegationDepth?: number }
  /** Complete canonical history (seq 0 onward), including a fork's inherited prefix. */
  snapshotEvents?(): readonly SessionEventView[]
  /** Child-owned history after the fork-inherited prefix. */
  ownEvents?(): readonly SessionEventView[]
}

export interface Agent {
  id: string
  session: AgentSession
  /** Live lifecycle state; `idle` means no driver or maintenance task owns the agent. */
  readonly status?: 'idle' | 'running'
  /** Durable pending work. */
  readonly inbox?: AgentInbox
  /**
   * Quietly queue identified input at the next step boundary: the harness
   * `inject()` verb, without waking the driver.
   */
  send?(message: InboxMessage, target: 'next-step', wakeup: false): void
  ctx: {
    effect(fn: () => (() => void), label: string): unknown
    get(name: 'systemPrompt'): PromptService | undefined
    get(name: 'agentPresets'): { composedPreset(ctx: Agent['ctx']): string } | undefined
  }
}
export interface PromptSection { name: string; order: number; text(context?: { agent?: Agent }): string }
export interface PromptService { section(section: PromptSection): () => void; getSectionOrder(name: string): number }
export interface Route { method: string; path: string; handler(req: IncomingMessage, res: ServerResponse): Promise<void> }
export interface AgentEvent { agent: Agent }
export interface HostContext {
  logger: { warn(message: string): void; info(message: string): void }
  effect(fn: () => (() => void), label: string): unknown
  /** The Host awaits serial creation listeners before releasing initial input. */
  on(name: 'agent/created', fn: (event: AgentEvent) => void | Promise<void>): () => void
  on(name: 'agent/disposed', fn: (event: AgentEvent) => void): () => void
  /** Status transitions; `idle` settles every claim whose step never admitted it. */
  on(name: 'agent/status', fn: (event: { agent: Agent; status: string }) => void): () => void
  /** One message left the inbox into an open turn, before it is admitted to history. */
  on(name: 'agent/inbox/claimed', fn: (event: { agent: Agent; message: InboxMessage; turn: number }) => void): () => void
  /** Durable session events, used to observe a claimed message landing in history. */
  on(name: 'session/event', fn: (session: AgentSession, event: SessionEventView) => void): () => void
  get(name: 'agents'): { list(): Agent[] } | undefined
  webServer: { register(route: Route): () => void }
}
