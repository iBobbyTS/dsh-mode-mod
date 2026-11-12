# dsh-mode-mod

Adds a separate system-prompt preset picker to DeepSeek Harness. Seven development goals and custom prompts can be selected independently of the native agent mode. The plugin also supplies project-level language requirements injected as persistent context, Creator's source context, PTC call guidance, and the browser-only 资料搜索 (web research) mode.

## Compatibility

Verified: DSH 0.2.2-rc.2 (source review, focused automated checks and Web acceptance with all 14 local plugins). Web checks covered Creator persona/PTC, Utility goal selection independent of Standard mode, and an empty research model-tool request without Playwright after cold restore. Desktop interaction and online model/provider accounts have not been tested.

## Features

- Choose a goal beside the mode picker, in a new session or an existing conversation.
- Session choices persist; new sessions inherit the project default, then the global default. “None” explicitly disables a goal.
- Manage custom prompts in Settings → 系统提示词管理.
- Manage per-language requirement entries in Settings → 语言要求管理, then multi-select them per project beside the mode picker (new session) or in the conversation header. The selected text is injected as persistent context into every session of that project, subagents included, without changing the system prompt or waking an idle model; edits append the new version, unselecting deletes nothing, and a project with no selection injects nothing.
- Ordinary forks own their goal selection. Subagents receive PTC guidance but no goal section.
- The PTC default and maximum `run_code` timeout are one day. Inner tools keep their own deadlines.
- `资料搜索` mode: a browser-only research session with exactly 22 Playwright browser tools. `browser_run_code_unsafe`, `browser_file_upload`, and `browser_drop` are excluded; every non-browser tool (bash, files, web search/fetch, subagents, PTC `run_code`, other MCP servers) is masked for that mode only. It reuses the profile's shared Playwright browser, hides the MCP resource section, non-browser MCP server descriptions, deployment file/GUI guidance, the generic harness identity line, and runtime/time context injections from its prompt (the research persona is the whole system prompt), and answers conclusion-first with links to the pages it actually opened. The profile must mount Playwright MCP; without it the mode has no tools rather than falling back to other capabilities.

## Install or update

Clone this fork (`iBobbyTS/dsh-mode-mod`) and install the checkout into the profile you use:

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-mode-mod
```

For Desktop, first launch it once, quit it, then use its bundled CLI with `--profile desktop`. Restart the target Host and refresh its client after installing or updating. A running Host does not reload linked code merely because files changed.

## Documentation

[Behavior and development reference](docs/behavior.md) covers selection and deletion effects, persistence, API routes, Creator integration, and source-check commands. `cordis.patch.yml` owns the PTC timeout configuration; `presets/creator-cordis.patch.yml` owns the Creator overlay; `presets/web-research.patch.yml` declares the 资料搜索 preset and `src/web-research.ts` owns its preset-scope tool mask.
