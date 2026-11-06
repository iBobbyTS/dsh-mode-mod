# dsh-mode-mod development

The goal picker is independent of DSH's native mode picker. This project adds goal prompts, PTC guidance and the Creator overlay; it does not replace native preset selection or modify DSH product sources.

- Keep goal state session-owned. Ordinary seeded forks are independent sessions; subagent sessions do not receive the goal section. Prompt selection and persistence semantics are documented in [behavior](docs/behavior.md).
- Creator may differ from the matching release Cordis preset only by the source-context persona suffix and the native PTC executor insertion. Preserve conditional expressions and all other rows; validate changes with `node tools/verify-template.mjs <release-checkout>`.
- PTC timeout settings belong in `cordis.patch.yml`; guidance must describe the installed configuration and preserve independent inner-tool deadlines.
- Keep Host storage/API work and browser presentation in their existing owners. Dispose agent-scoped prompt providers and UI registrations with their scopes.
- Use `pnpm test` for candidate-built regressions. For Host/preset changes use the intended release source; report source/automated checks separately from live model and Desktop results.

[README](README.md) owns the human entry and installation. [Behavior](docs/behavior.md) owns detailed runtime semantics, persistence, API and development commands. Configuration values remain in their source files.

共同构建与交付合同见[统一规范](../docs/plugin-development.md)；`src/` 是运行逻辑编辑源，`lib/` 由构建生成。具体维护命令由本项目开发文档拥有。
