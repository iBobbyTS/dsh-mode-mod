// src/guidance.ts
/**
* PTC tool-call guidance text — one system-prompt section the host half
* (src/index.ts) injects on every agent whose live composition presents PTC
* (presets ptc and cordis), placed right after the tools SDK bindings.
*
* It reminds the model that the run_code tool's own `description` argument is
* required on every run_code call: nested tool calls inside the program carry
* their own `description` arguments and do not satisfy it. This is the
* confusion behind repeated `invalid arguments: missing required property
* "description"` rejections (the nested bash call had one; run_code itself
* did not), so the text names the exact distinction.
*
* Text-only module: the section is registered per agent at host level, so no
* mountable plugin row remains, and no preset declaration needs to carry it.
* @module @local/dsh-mode-mod/guidance
*/
/** The guidance text, one paragraph, placed beside the PTC SDK bindings. */
const PTC_GUIDANCE_TEXT = "Tool-call argument reminder for run_code: its own `code` and `description` arguments are both required on every run_code call itself. Nested tool calls inside the program (for example a bash call) have their own separate `description` arguments; supplying one there never satisfies run_code, and an omitted top-level `description` rejects the whole call before the program runs. Choose a run_code timeoutMs sufficient for combined inner waits, within the runtime’s advertised limit. Nested tools retain their own timeouts; a longer outer budget does not extend them or override cancellation.";
export { PTC_GUIDANCE_TEXT };

//# sourceMappingURL=guidance.js.map