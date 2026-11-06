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
5. **run_code guidance, host-injected** (`src/guidance.ts`) — one
   system-prompt section after the tools SDK bindings reminding the model
   that `run_code`'s own `description` argument is required and nested
   tool-call descriptions do not satisfy it. Injected on every agent —
   subagents included — whose live composition presents PTC (presets
   `ptc` and `cordis`).
6. **Creator mode** — the former `dsh-creator-source-context` override of
   `preset-cordis`: the source-reference persona suffix and PTC tool
   presentation. `tools/verify-template.mjs` compares the overlay with the selected checkout; the repository development instructions own its allowed differences.
7. **资料搜索 mode (browser-only research)** — `presets/web-research.patch.yml`
   inserts `preset-web-research` (id `web-research`, order 5, display name
   资料搜索). The preset mounts a research persona, the standard compaction
   group, and this package's `web-research-toolset` row
   (`src/web-research.ts`); it mounts no model-facing tool row of its own and
   no time-context row, so no clock reading is injected either.
   That row registers a tool restriction in the PRESET scope, which every
   agent of the preset inherits: the allow list is exactly the 22 Playwright
   browser tools (`mcp__playwright__browser_*` minus
   `browser_run_code_unsafe`, `browser_file_upload`, and `browser_drop`).
   Every inherited global capability — bash/PowerShell, files and search,
   PTC `run_code`, web search/fetch, subagent/workflow, skills, goals, todo,
   present, plugin manager, MCP resource helpers, codegraph,
   external_subagent — is masked for these sessions only; other modes keep
   their full tool lists. Because the profile's Playwright MCP row can
   register after the bundle patch, the mask recomputes on `tools/change`:
   before any browser tool exists it denies every global tool instead of
   leaving the catalog open, then switches to the allow list once the browser
   appears. A new upstream browser tool stays hidden until it is added to the
   allow list, so an upgrade cannot silently widen the mode. The same row
   shadows MCP prompt text the mode cannot use: the shared
   `mcp-resource-servers` section (it advertises resource tools this mode
   masks) and every non-browser server's `mcp:<server>` instruction section,
   so codegraph/external_subagent descriptions never enter the research
   system prompt. It also shadows `ui:deliverable-file-references` (desktop
   present/file-link guidance; this mode has no present tool and no local
   files), `harness:source`, and `app:web-surface` (the checkout and Web GUI
   developer orientation), since a browser-research session never edits files
   or extends DSH. It also shadows `harness:identity`, the generic "You are an
   AI agent powered by DeepSeek Harness" opener, so the research persona is the
   mode's whole system prompt. The Playwright server's own instructions stay
   visible, and other modes keep every section unchanged.
   The persona sets `includeRuntimeContext: false`, which suppresses every
   optional runtime-context entry (sandbox policy, approval policy, checkout,
   GUI URL), and the mask shadows the one required entry
   (`working-directory:current`) with an empty optional context. A research
   turn therefore carries neither a runtime-context injection nor a
   time-context message; other modes keep both. Switching into the mode clears
   an earlier retained snapshot through the harness's own "context cleared"
   update.
   The browser is the shared profile-level Playwright server: same Chrome
   profile, tabs, and login state as other sessions, no second browser and no
   plugin-owned persistence. The persona fixes the research contract —
   search interaction only; no login/registration, non-search form
   submission, purchase, posting, deletion, messaging, or account changes; on
   login walls, paywalls, or CAPTCHAs, switch sources and say what was
   unavailable; answers are conclusion-first with links to pages actually
   opened and a source list, cross-checking key facts where feasible. A
   profile without Playwright MCP leaves the mode with no tools (never a
   fallback to other capabilities); its README documents that dependency.


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
- The 资料搜索 mask is preset-scoped: it never changes another mode's tool
  list, and switching a session away from the mode lifts it when the agent's
  scope parent rebinds to the new preset.

The PTC default and maximum timeout are one day, configured by the `ptc-runtime` override in `cordis.patch.yml`. An outer `run_code` budget must cover combined inner waits; inner tools retain their own deadlines. A running Host needs a restart to load changes to a linked plugin.


## Development and source checks

From a checkout of this fork:

```sh
pnpm install --frozen-lockfile
pnpm check
node tools/verify-template.mjs /absolute/path/to/deepseek-harness
```

The latest source/automated compatibility check targeted DSH `0.2.2-rc.1`; this is not a Desktop UI acceptance result. Use the matching release checkout rather than assuming newer master has the same preset. The verifier compares conditional expressions as data and checks the native PTC executor row as well as the remaining Creator rows.

The default mode for a profile is configured by `agent-preset-registry`; `defaultGoal` in this plugin's bundle patch sets the independent goal default. Installation and updates use the [README](../README.md).

### Source and delivery

Edit `src/*.ts`; `pnpm build:runtime` regenerates the committed Host modules and wrapped Client in `lib/`, with maps. The API's pure data types live in `src/protocol.ts`; Host and Client have separate type configurations. Prompts, locale, icon and the three patch files remain package-root resources.

Use the pinned pnpm version and Node 22.19+ on the Node 22 line or Node 24.11+ for development tools. `pnpm typecheck` checks both environments. `pnpm test` builds a temporary candidate and runs Host, Client and template regressions. `pnpm check:dist` rebuilds without replacing working lib, compares the full generated set, checks the packed entries/maps/resources and installs the tarball in a temporary project. `pnpm check` reuses one candidate build for tests and distribution checks. Installation loads committed JS and never compiles TS or writes a daily Profile during checks.
