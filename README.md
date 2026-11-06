# dsh-mode-mod

Adds a separate system-prompt preset picker to DeepSeek Harness. Seven development goals and custom prompts can be selected independently of the native agent mode. The plugin also supplies Creator's source context and PTC call guidance.

## Compatibility

Verified: DSH 0.2.2-rc.1 (source review and automated checks); Desktop testing has not been completed.

## Features

- Choose a goal beside the mode picker, in a new session or an existing conversation.
- Session choices persist; new sessions inherit the project default, then the global default. “None” explicitly disables a goal.
- Manage custom prompts in Settings → 系统提示词管理.
- Ordinary forks own their goal selection. Subagents receive PTC guidance but no goal section.
- The PTC default and maximum `run_code` timeout are one day. Inner tools keep their own deadlines.

## Install or update

Clone this fork (`iBobbyTS/dsh-mode-mod`) and install the checkout into the profile you use:

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-mode-mod
```

For Desktop, first launch it once, quit it, then use its bundled CLI with `--profile desktop`. Restart the target Host and refresh its client after installing or updating. A running Host does not reload linked code merely because files changed.

## Documentation

[Behavior and development reference](docs/behavior.md) covers selection and deletion effects, persistence, API routes, Creator integration, and source-check commands. `cordis.patch.yml` owns the PTC timeout configuration; `presets/creator-cordis.patch.yml` owns the Creator overlay.
