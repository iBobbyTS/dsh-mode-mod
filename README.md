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
   `prototype`). A goal change takes effect on the next model turn.
3. **New-session-row GUI** — occupies `conversation.hero.options`, the
   compact controls right after the mode picker: one goal `<select>`
   (none + seven goals) writing the session tier; right-clicking the select
   opens the project-default menu (set current goal / clear). Served by
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
