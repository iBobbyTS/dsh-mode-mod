# dsh-mode-mod

Two orthogonal dimensions for DeepSeek Harness sessions: **modes** stay with
the shipped preset picker (standard / ptc / cordis / minimal — untouched), and
**system-prompt presets** (seven development goals) layer on top of any mode
as a separate, independently selectable dimension. Evolves
`dsh-creator-source-context`; no product-source changes required.

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
   the next model turn.

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
   between turns updates the system prompt itself through the harness's
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
   once). Verified against real calls: `deepseek-official/deepseek-flash`,
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
4. **run_code guidance, host-injected** (`src/guidance.js`) — one
   system-prompt section after the tools SDK bindings reminding the model
   that `run_code`'s own `description` argument is required and nested
   tool-call descriptions do not satisfy it. Injected on every agent —
   subagents included — whose live composition presents PTC (presets
   `ptc` and `cordis`).
5. **Creator mode** — the former `dsh-creator-source-context` override of
   `preset-cordis`: the source-reference persona suffix and PTC tool
   presentation. Keep every other row identical to
   `packages/bundle/web-app/presets/cordis.patch.yml` in the matching
   checkout (`node tools/verify-template.mjs` enforces it).

## Install / update

- Profile: add `@local/dsh-mode-mod` to the face's bundles (see each
  profile's `package.json` `dsh.profile.bundles`) with a `link:` dependency on
  this directory, then reinstall the profile dependencies.
- Mode default for new sessions is the profile's `agent-preset-registry`
  config (`default: ptc`); goal default is `defaultGoal` in this plugin's
  bundle patch.
- Drift check after updating the harness checkout:
  `node tools/verify-template.mjs <checkout>` — on drift, rebuild
  `presets/creator-cordis.patch.yml` from the newer `cordis.patch.yml`.

## Behavior notes

- Subagent sessions (`parentSession` set) never get the goal section — the
  goal is a top-session dimension; they inherit the parent's mode (and get
  the PTC guidance when that mode presents PTC).
- A stored project value naming an unknown goal id is ignored (falls through
  to the global default); store writes are atomic (tmp + rename) and a
  malformed store reads as empty.
- The mode-tier default (`agent-preset-registry.default`) and the goal-tier
  default are configured independently; pointing `selectedDefault` at a goal
  id no longer works — goals are not presets.
