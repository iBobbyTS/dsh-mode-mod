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

/* ------------------------------------------------------------------
 * Project language requirements.
 *
 * The entry document is the global checklist vocabulary (no built-ins); the
 * project document holds one multi-selection per resolved project root. The
 * injected context message carries the entry id and its monotonic version, so
 * delivery can be deduplicated without comparing body bytes (A -> B -> A is a
 * third version, not a repeat of the first).
 * ------------------------------------------------------------------ */

/** One user-authored requirement entry. */
export interface LanguageEntry {
  id: string
  title: string
  prompt: string
  /** Monotonic body revision: bumped only when the requirement text actually changes. */
  version: number
  createdAt?: number
  updatedAt?: number
}

/** The global entry document. */
export interface LanguageDocument { version: number; entries: LanguageEntry[] }

/** Per-project multi-selection keyed by resolved project root. */
export interface LanguageProjectStore { version: number; projects: Record<string, string[]> }

/** Values shared by the language API and its browser consumers. */
export interface LanguageState {
  sessionId: string
  projectRoot: string | null
  selected: string[]
  entries: LanguageEntry[]
}
