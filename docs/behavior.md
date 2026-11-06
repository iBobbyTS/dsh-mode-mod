# Presets, persistence and Host integration

## What it does

1. **Goal dimension, injected per session** — each development goal
   (`research`, `prototype`, `utility`, `host-extension`, `library`,
   `software`, `agent-runtime`; texts in `prompts/*.txt`) becomes exactly one
   scoped system-prompt section (`mode-mod:goal`, right after the persona
   suffix) registered through each TOP-LEVEL agent's own context. It applies
   to that session alone, survives mode switches, never touches the preset
   picker, and works with any mode.
2. **Three-tier goal defaults** — session choice
   (`$DSH_HOME/plugin/data/mode-mod/session-goal-overrides.json`, keyed by
   session id, so the choice survives restarts; the harness session log
   rejects event types unknown to it, so third-party plugin state lives in
   plugin data) > project default
   (`$DSH_HOME/plugin/data/mode-mod/project-system-prompt-preset.json`,
   absolute git-root keys, longest-prefix match) > global default
   (`config.defaultGoal` in the plugin's bundle patch, currently
   `prototype`). At any tier, `null` (absent) means not selected and
   inherits from the tier beneath, while `"none"` is an explicit no-goal
   choice that blocks the tiers beneath it. A goal change takes effect on
   the next prompt assembly/model call.

   **Inheritance is resolved once, not followed.** The first prompt
   assembly of a session that has no stored value pins the inherited goal
   (project default, else the global default) as that session's own value:
   the in-memory snapshot updates immediately, the document follows. From
   then on a project-default change moves only sessions that have not
   started, so a running conversation never loses its preset because
   somebody starred a different default. A session the plugin has no record
   of — never opened in this process and never given a value — reads as no
   goal (无预设) instead of hiding the picker; a closed session keeps and
   still reports the value it was given, and the goal API accepts such a
   session id so the picker works there too.

   **Session scope** is a root session or a seeded fork (`isSeeded`,
   `delegationDepth` 0). Subagent child sessions (`origin: "subagent"`,
   deeper delegation) get only the run_code guidance. Agents that already
   exist when the plugin loads — a hot reload, or a load after sessions were
   resumed — are reconciled through the live agent registry, because their
   `agent/created` has already fired and would never register the section
   again.

   **Mid-session switches** keep the same `mode-mod:goal` section and swap
   only its text: the section's provider re-reads the session value at every
   assembly, so switching through the top-bar dropdown (or the API)
   before the next prompt assembly updates the system prompt itself through the harness's
   own admission — no `<system-reminder>` message is injected. From the
   first assembly after a switch the text is prefixed with the
   `# Active Development Preset` header (`ACTIVE_PRESET_HEADER`: it
   supersedes any previously selected preset, preserves established facts
   and prior decisions, and grants no permissions); the header is sticky,
   so an unchanged goal keeps rendering byte-identical text and the
   harness commits no spurious prompt update. Routes declaring
   `systemPromptUpdate: "in-history"` receive the changed prompt as a new
   system node after the cached history (prefix cache kept); other routes
   get the head system node rewritten (the provider re-bills the prefix
   once). Earlier route-level verification recorded real calls to: `deepseek-official/deepseek-flash`,
   `chatgpt/gpt-6.1-sol`, `chatgpt/gpt-6-astra` (in-history; the entire
   pre-switch prefix stayed a cache hit through the switch), and
   `zai/glm-5.3`, `opencode-go/deepseek-v4.1-flash` (head rewrite; both
   gateways still reported the pre-switch prefix as cached on the switch
   turn).
3. **Preset picker, two seats** — one component, two registrations, each
   directly beside the shipped mode control:
   - `conversation.hero.options` (the New Session row) neutralizes the
     host's right-edge seating (`margin-left: auto` on the slot wrapper), so
     the dropdown sits left-aligned beside the mode picker;
   - `conversation.session.header.actions` at `order: 0` (the mode chip
     `agent-preset` is `-10`, background tasks `20`), so a Session that has
     already started switches preset from the header, beside the mode chip.
     That seat is a switch only: its rows carry no star, because the
     project default is edited where a Session is composed.
   Both use the host's own idiom — `Menu` and icons required from the
   `dsh-client-ui-primitives` baseline row, with the seat-button geometry
   of the official agent-preset chip in the hero and the header label's
   22px/12px chip beside the mode chip — not a native `<select>`; rows
   carry the goal name over its description and a check on the effective
   goal, and selecting one writes the session tier — including "None", a
   real peer option that pins the session to an explicit no-goal choice
   (`"none"`), so no goal text is injected. In the hero, each row's right
   edge carries a star (inline SVG: the UI kit has no star glyph) marking
   the PROJECT default: click ☆ to make that row the default (★, at most
   one; the none row's star sets a project-level `"none"` that blocks the
   global tier), click ★ to unselect it; with no project default no star
   shows. A star click never touches the session tier and never collapses
   the menu.
   Served by
   `GET /api/mode-mod/state`, `POST /api/mode-mod/goal`, and
   `POST /api/mode-mod/project` (loopback + same-origin only).
4. **System prompt management (Settings → 系统提示词管理)** — a settings
   section that lists the built-in presets (read-only) and lets you add,
   edit, and delete your own. Each custom preset carries a one-line
   **Title**, a one-line **Description**, and a multi-line **System
   Prompt**; edits auto-save after a short debounce (plus on blur and when
   the section unmounts), so there is no Save button. Built-in goals are
   shipped files and the API rejects updates/deletes for them. A custom
   preset appears in the session picker only once both its title and
   system prompt are non-empty; an empty row stays in the manager as a
   draft (badge 草稿). Custom presets live in
   `$DSH_HOME/plugin/data/mode-mod/custom-system-prompts.json`
   (atomic writes, ids `custom-<12 hex>`), and are served by
   `GET /api/mode-mod/prompts` / `POST /api/mode-mod/prompt`.

   **Deleting a custom preset** removes it from the picker, rewrites every
   session value and project default that referenced it to **null** (the
   entry is deleted, never turned into the explicit `"none"` sentinel),
   and freezes the prompt of every session with a stored selection of it:
   a live session keeps the exact section text it last assembled
   (supersedes header included), a closed session keeps the preset body,
   and both are recorded under `retired` in the session document. A
   restart therefore re-renders the same bytes instead of committing a new
   system prompt. Only an explicit preset pick for that session clears the
   record and applies the new text. A live session that merely inherited
   the deleted preset (no stored value) is frozen in memory as well; a
   closed session known only through the project default is not
   enumerable, so clearing that default is all the plugin can do.
5. **run_code guidance, host-injected** (`src/guidance.js`) — one
   system-prompt section after the tools SDK bindings reminding the model
   that `run_code`'s own `description` argument is required and nested
   tool-call descriptions do not satisfy it. Injected on every agent —
   subagents included — whose live composition presents PTC (presets
   `ptc` and `cordis`).
6. **Creator mode** — the former `dsh-creator-source-context` override of
   `preset-cordis`: the source-reference persona suffix and PTC tool
   presentation. `tools/verify-template.mjs` compares the overlay with the selected checkout; the repository development instructions own its allowed differences.


## Behavior notes

- Subagent sessions (`origin: "subagent"`) never get the goal section — the
  goal is a top-session dimension; they inherit the parent's mode (and get
  the PTC guidance when that mode presents PTC). Ordinary seeded forks own
  their goal even when an older header still records `parentSession`.
- A stored project value naming an unknown goal id is ignored (falls through
  to the global default); store writes are atomic (tmp + rename) and a
  malformed store reads as empty. A value naming a deleted `custom-*` id
  resolves to null instead, so it can never inherit a different prompt.
- Deleting a custom preset never edits session history: sessions that had
  it selected (live or closed, value or inherited) keep the exact section
  text they committed, recorded in `session-goal-overrides.json` under
  `retired`, until the user selects another preset for that session. A
  prompt preset edited in place is not a new selection; its updated text
  reaches a session on its next assembly.
- The mode-tier default (`agent-preset-registry.default`) and the goal-tier
  default are configured independently; pointing `selectedDefault` at a goal
  id no longer works — goals are not presets.

The PTC default and maximum timeout are one day, configured by the `ptc-runtime` override in `cordis.patch.yml`. An outer `run_code` budget must cover combined inner waits; inner tools retain their own deadlines. A running Host needs a restart to load changes to a linked plugin.


## Development and source checks

From a checkout of this fork:

```sh
pnpm install --frozen-lockfile
node --test tests/*.test.mjs
node tools/verify-template.mjs /absolute/path/to/deepseek-harness
```

The latest source/automated compatibility check targeted DSH `0.2.2-rc.1`; this is not a Desktop UI acceptance result. Use the matching release checkout rather than assuming newer master has the same preset. The verifier compares conditional expressions as data and checks the native PTC executor row as well as the remaining Creator rows.

The default mode for a profile is configured by `agent-preset-registry`; `defaultGoal` in this plugin's bundle patch sets the independent goal default. Installation and updates use the [README](../README.md).
