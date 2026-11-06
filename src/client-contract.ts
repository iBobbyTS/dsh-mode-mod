import type * as React from 'react'
import type { GoalState } from './protocol.js'
export interface Face {
 load(sessionId: string): Promise<GoalState>
 goal(sessionId: string, value: string | null): Promise<GoalState>
 project(sessionId: string, value: string | null): Promise<GoalState>
}
export interface PickerProps { sessionId: string; modeMod: Face; seat: string }
declare const require: (id: '@deepseek-ai/dsh-client-ui-primitives') => {
 Menu: React.ComponentType<{ items: { id: string; label: React.ReactNode; disabled?: boolean }[]; open: boolean; onClose(): void; selectedId?: string; anchor: React.ReactNode; align: string; portal: boolean; onSelect(id: string): void }>
 IconChevronDownOutlineRegular: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
 IconGoalOutlineRegular: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
}
export const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
export interface ClientContext { slots: {
 inject(name: string, fn: () => (() => void)): () => void
 register<P>(options: { name: string; id: string; order: number; label?(): string; inject?(sessionId: string): Partial<P> }, component: React.ComponentType<P>): () => void
} }
