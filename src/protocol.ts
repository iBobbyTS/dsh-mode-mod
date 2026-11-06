// Values shared by the goal API and its browser consumers.
export interface PromptFields { title: string; description: string; prompt: string }
export interface PromptEntry extends PromptFields { id: string; createdAt?: number; updatedAt?: number; kind?: string }
export interface RetiredPrompt { id: string; title: string; text: string }
export interface ProjectStore { version: number; projects: Record<string, unknown> }
export interface SessionStore { version: number; sessions: Record<string, unknown>; retired: Record<string, RetiredPrompt> }
export interface PromptDocument { version: number; prompts: PromptEntry[] }
export interface GoalState {
 known: boolean; sessionId?: string; projectRoot?: string
 projectValue?: string | null; projectValueName?: string | null
 sessionValue?: string | null; sessionValueName?: string | null
 effectiveGoal?: string | null; effectiveGoalName?: string | null
 retiredGoal?: { id: string; name: string } | null; retiredGoalName?: string | null
 globalValue?: string | null; globalValueName?: string | null
 goals?: { id: string; name: string; description: string }[]
}
export interface PromptPayload { builtins: PromptEntry[]; custom: PromptEntry[]; entry?: PromptEntry; createdId?: string; deletedId?: string }
