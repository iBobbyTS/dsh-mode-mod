import type * as React from 'react'
import type { GoalState, LanguageState } from './protocol.js'
export interface Face {
 load(sessionId: string): Promise<GoalState>
 goal(sessionId: string, value: string | null): Promise<GoalState>
 project(sessionId: string, value: string | null): Promise<GoalState>
}
/** One manager write: create, partial update, or delete. */
export interface LanguageEntryRequest {
 action: 'create' | 'update' | 'delete'
 id?: string
 entry?: { title?: string; prompt?: string }
 session?: string
}
export interface LanguageFace {
 load(sessionId: string): Promise<LanguageState>
 selection(sessionId: string, ids: string[]): Promise<LanguageState>
 entry(body: LanguageEntryRequest): Promise<LanguageState>
}
export interface PickerProps { sessionId: string; modeMod: Face; seat: string }
export interface LanguagePickerProps { sessionId: string; language: LanguageFace; seat: string }
declare const require: (id: '@deepseek-ai/dsh-client-ui-primitives') => {
 Menu: React.ComponentType<{ items: { id: string; label: React.ReactNode; disabled?: boolean }[]; open: boolean; onClose(): void; selectedId?: string; selectedIds?: readonly string[]; anchor: React.ReactNode; align: string; portal: boolean; onSelect(id: string): void; selection?: 'check' | 'fill' }>
 IconChevronDownOutlineRegular: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
 IconGoalOutlineRegular: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
}
export const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
export interface ClientContext { slots: {
 inject(name: string, fn: () => (() => void)): () => void
 register<P>(options: { name: string; id: string; order: number; label?(): string; inject?(sessionId: string): Partial<P> }, component: React.ComponentType<P>): () => void
} }
