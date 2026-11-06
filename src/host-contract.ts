import type { IncomingMessage, ServerResponse } from 'node:http'
export interface Agent {
 id: string
 session: { id: string; header: { cwd?: string; origin?: string; parentSession?: unknown; isSeeded?: boolean; delegationDepth?: number } }
 ctx: { effect(fn: () => (() => void), label: string): unknown; get(name: 'systemPrompt'): PromptService | undefined; get(name: 'agentPresets'): { composedPreset(ctx: Agent['ctx']): string } | undefined }
}
export interface PromptSection { name: string; order: number; text(context?: { agent?: Agent }): string }
export interface PromptService { section(section: PromptSection): () => void; getSectionOrder(name: string): number }
export interface Route { method: string; path: string; handler(req: IncomingMessage, res: ServerResponse): Promise<void> }
export interface HostContext {
 logger: { warn(message: string): void; info(message: string): void }
 effect(fn: () => (() => void), label: string): unknown
 on(name: 'agent/created' | 'agent/disposed', fn: (event: { agent: Agent }) => void): () => void
 get(name: 'agents'): { list(): Agent[] } | undefined
 webServer: { register(route: Route): () => void }
}
