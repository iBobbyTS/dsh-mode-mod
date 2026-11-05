/* Browser half of dsh-mode-mod. Seats the system-prompt-preset (goal)
 * dropdown twice, both times right after the shipped agent-preset (mode)
 * control:
 *   - conversation.hero.options, the New Session row, with the project-star
 *     affordance on every row;
 *   - conversation.session.header.actions at order 0 (the mode chip itself
 *     sits at -10), so a running Session can switch preset mid-conversation
 *     from the header, beside the mode chip. The header seat carries no star:
 *     there the dropdown is a switch, not the project-default editor.
 * Writes the SESSION tier through POST /api/mode-mod/goal. The dropdown is
 * the host's own idiom — Menu plus icons from dsh-client-ui-primitives (a
 * PLATFORM_MODULES baseline row every dynamic bundle may require) — with the
 * hero trigger styled like the official agent-preset seat button and the
 * header trigger like the header's agent-preset label; no native <select>.
 * "None" is a real peer
 * option whose value is the string "none" — an explicit choice that
 * injects no goal text — while null means not selected (inherit). The
 * PROJECT tier is a star on each row's right edge: click ☆ to make that
 * row the project default (★, at most one; the none row's star sets a
 * project-level "none" that blocks the global tier), click ★ to unselect.
 * A star click writes only the project tier — the session's own choice
 * stays untouched — and stops the click so the menu does not collapse. The
 * GLOBAL tier lives in the plugin's bundle config. The mode
 * dimension stays with the shipped preset picker. Wrapped in an IIFE so
 * nothing leaks into the page. */
(function () {
window.__ModuleLoader__.load({
	id: "@local/dsh-mode-mod",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const { useEffect, useRef, useState } = React;
		const { Menu, IconChevronDownOutlineRegular, IconGoalOutlineRegular } = require("@deepseek-ai/dsh-client-ui-primitives");

		const API = {
			state: (sessionId) => "/api/mode-mod/state?session=" + encodeURIComponent(sessionId),
			goal: "/api/mode-mod/goal",
			project: "/api/mode-mod/project",
			prompts: "/api/mode-mod/prompts",
			prompt: "/api/mode-mod/prompt",
		};

		function resolveApiUrl(path) {
			if (typeof document === "undefined") return path;
			try { return new URL(path.replace(/^\//, ""), document.baseURI).href; } catch { return path; }
		}

		async function fetchJson(url, init) {
			const response = await fetch(resolveApiUrl(url), init);
			let body = null;
			try { body = await response.json(); } catch {}
			if (!response.ok) {
				const error = new Error((body && body.error) || ("HTTP " + response.status));
				error.status = response.status;
				throw error;
			}
			return body;
		}

		function loadState(sessionId) {
			return fetchJson(API.state(sessionId));
		}

		function post(path, sessionId, value) {
			return fetchJson(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ session: sessionId, value }),
			});
		}

		function listPrompts() {
			return fetchJson(API.prompts);
		}

		function postPrompts(body, keepalive) {
			const payload = JSON.stringify(body);
			let bytes = payload.length;
			try { bytes = new TextEncoder().encode(payload).length; } catch {}
			return fetchJson(API.prompt, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: payload,
				// Browsers reject keepalive bodies over 64 KiB; the debounced save
				// is the normal path, the unmount flush is best-effort for large
				// prompts.
				keepalive: keepalive === true && bytes < 60 * 1024,
			});
		}

		const LABELS_ZH = {
			goal: "系统提示词预设",
			none: "无预设",
			noneDesc: "不向系统提示词叠加目标文本",
			session: "本会话",
			project: "项目默认",
			globalTier: "全局默认",
			inherit: "(继承)",
			unselect: "未选择",
			setStar: "设为项目默认",
			clearStar: "取消项目默认",
			starHint: "☆ = 项目默认,不影响本会话",
			manageTitle: "系统提示词管理",
			manageIntro: "管理叠加到系统提示词上的预设。内置预设只读；自定义预设自动保存。",
			builtinGroup: "内置预设",
			customGroup: "自定义预设",
			builtinBadge: "内置 · 只读",
			customBadge: "自定义",
			draftBadge: "草稿",
			untitled: "未命名",
			add: "新增系统提示词",
			newTitle: "新的系统提示词",
			emptySelection: "从左侧选择一个预设，或新增一个。",
			noCustom: "还没有自定义预设。",
			titleLabel: "标题",
			titlePlaceholder: "例如：数据管道审查",
			descriptionLabel: "描述",
			descriptionPlaceholder: "一行说明，显示在预设选择器里",
			promptLabel: "系统提示词",
			promptPlaceholder: "输入要叠加到系统提示词中的完整文本…",
			draftHint: "标题和系统提示词都填写后，才会出现在会话的预设选择器中。",
			saved: "已保存",
			saving: "保存中…",
			dirty: "未保存",
			saveFailed: "保存失败",
			loading: "加载中…",
			loadFailed: "加载系统提示词失败。",
			retry: "重试",
			deletePreset: "删除预设",
			deleteConfirm: "确认删除这个预设？",
			deleteYes: "确认删除",
			cancel: "取消",
			deleteNotice: "预设已删除。已经使用它的会话会保留当前系统提示词，直到你为会话选择新的预设。",
			deletedSuffix: "（已删除）",
		};

		const LABELS_EN = {
			goal: "System-prompt preset",
			none: "None",
			noneDesc: "Layer no goal text onto the system prompt",
			session: "session",
			project: "project default",
			globalTier: "global default",
			inherit: "(inherited)",
			unselect: "unselected",
			setStar: "Set as project default",
			clearStar: "Clear project default",
			starHint: "☆ = project default; does not change this session",
			manageTitle: "System prompt management",
			manageIntro: "Manage the presets layered onto the system prompt. Built-in presets are read-only; custom presets save automatically.",
			builtinGroup: "Built-in presets",
			customGroup: "Custom presets",
			builtinBadge: "Built-in · read-only",
			customBadge: "Custom",
			draftBadge: "Draft",
			untitled: "Untitled",
			add: "Add system prompt",
			newTitle: "New system prompt",
			emptySelection: "Select a preset on the left, or add one.",
			noCustom: "No custom presets yet.",
			titleLabel: "Title",
			titlePlaceholder: "e.g. Data pipeline review",
			descriptionLabel: "Description",
			descriptionPlaceholder: "One line, shown in the preset picker",
			promptLabel: "System prompt",
			promptPlaceholder: "Enter the full text to layer onto the system prompt…",
			draftHint: "A preset appears in the session picker once both its title and system prompt are filled in.",
			saved: "Saved",
			saving: "Saving…",
			dirty: "Unsaved",
			saveFailed: "Save failed",
			loading: "Loading…",
			loadFailed: "Failed to load system prompt presets.",
			retry: "Retry",
			deletePreset: "Delete preset",
			deleteConfirm: "Delete this preset?",
			deleteYes: "Delete",
			cancel: "Cancel",
			deleteNotice: "Preset deleted. Sessions already using it keep their current system prompt until you choose a new preset for them.",
			deletedSuffix: " (deleted)",
		};

		/* The host app keeps <html lang> pointed at the active locale
		 * (zh-CN / en), so prefer it over navigator.language: the labels
		 * must follow the app's Language setting, not the OS browser. */
		function labelsFromEnvironment() {
			const source = (typeof document !== "undefined" && document.documentElement && document.documentElement.lang)
				|| (typeof navigator !== "undefined" && navigator.language)
				|| "";
			return String(source).toLowerCase().startsWith("zh") ? LABELS_ZH : LABELS_EN;
		}

		let cachedLabels = null;
		let labelVersion = 0;
		const labelListeners = new Set();

		function activeLabels() {
			return cachedLabels || (cachedLabels = labelsFromEnvironment());
		}

		function refreshLabels() {
			const next = labelsFromEnvironment();
			if (next === cachedLabels) return;
			cachedLabels = next;
			labelVersion += 1;
			for (const notify of labelListeners) notify();
		}

		function chineseLabelsActive() {
			return activeLabels() === LABELS_ZH;
		}

		/* Live dictionary view: every read resolves against the current app
		 * language, so non-React call sites (slot labels, injected faces)
		 * stay correct after a language switch. */
		const L = new Proxy({}, { get: (_target, key) => activeLabels()[key] });

		function subscribeLabels(notify) {
			labelListeners.add(notify);
			return () => { labelListeners.delete(notify); };
		}

		function labelVersionSnapshot() {
			return labelVersion;
		}

		/* Re-render hook for components that read L. */
		function useLabels() {
			return React.useSyncExternalStore(subscribeLabels, labelVersionSnapshot, labelVersionSnapshot);
		}

		if (typeof document !== "undefined" && typeof MutationObserver !== "undefined" && document.documentElement) {
			new MutationObserver(refreshLabels).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
		}

		/* Menu-row descriptions localized client-side; the server payload carries
		 * the English descriptions from src/presets.js. */
		const ZH_GOAL_DESCRIPTIONS = {
			research: "科学研究与算法实验。",
			prototype: "快速原型与可行性验证。",
			utility: "小型脚本与个人工具。",
			"host-extension": "宿主插件与应用扩展。",
			library: "库与包的开发维护。",
			software: "完整软件功能开发。",
			"agent-runtime": "代理运行时行为调整。",
		};

		function goalDescription(id, fallback) {
			return (chineseLabelsActive() && ZH_GOAL_DESCRIPTIONS[id]) || fallback;
		}

		/* The host seats .heroOptions at the row's right edge via
		 * margin-left:auto. This picker belongs directly beside the mode
		 * control, so neutralize that margin on the wrapping div from inside:
		 * inline style outranks the CSS-module rule and React never touches
		 * that div's style attribute. Browsers resolve the auto margin to its
		 * used pixel value in getComputedStyle, so recognize the div by its
		 * CSS-module class substring (hash prefix varies); the auto check is a
		 * fallback for engines that report it literally. */
		function alignBesideModeControl(node) {
			if (!node) return;
			let el = node.parentElement;
			for (let depth = 0; el && depth < 4; depth++, el = el.parentElement) {
				const cls = typeof el.className === "string" ? el.className : "";
				if (cls.indexOf("heroOptions") !== -1 || getComputedStyle(el).marginLeft === "auto") {
					el.style.marginLeft = "0";
					return;
				}
			}
		}

		/* A stored session value ("none" or a goal id) is the session's real
		 * choice; null means not selected — the readout inherits from below. */
		function tierName(state) {
			// A deleted preset is no longer a selection (the stored value is
			// null), but the session keeps rendering its text until a new pick.
			if (state.retiredGoalName) return state.retiredGoalName + L.deletedSuffix;
			if (state.sessionValue !== null) return state.sessionValueName ?? L.none;
			if (state.projectValue !== null) return (state.projectValueName ?? L.none) + " " + L.inherit;
			if (state.globalValue !== null) return (state.globalValueName ?? L.none) + " " + L.inherit;
			return L.none;
		}

		/* ui-primitives ships no star glyph, so the project-default star is a
		 * small inline SVG (currentColor, 14px — the size of the Menu's
		 * trailing check). Outline for ☆, filled for ★. */
		const STAR_PATH = "M8 1.7l1.85 3.74 4.12.6-2.99 2.91.71 4.11L8 11.08l-3.69 1.98.71-4.11-2.99-2.91 4.12-.6z";
		function StarIcon({ filled }) {
			return React.createElement("svg", {
				width: "14", height: "14", viewBox: "0 0 16 16", "aria-hidden": true,
				fill: filled ? "currentColor" : "none",
				stroke: filled ? "none" : "currentColor", strokeWidth: "1.3", strokeLinejoin: "round",
			}, React.createElement("path", { d: STAR_PATH }));
		}

		/* One menu row: name over description on the left (mirroring the
		 * official agent-preset menu rows) with the project-default star in a
		 * right-aligned column. The outer span fills .itemLabel (flex:1); the
		 * text column grows, the star rides margin-left:auto to the label's
		 * right edge, and every row reserves the 20px the Menu's trailing
		 * selection check occupies (6px gap + 14px glyph) so stars line up in
		 * one column on checked and unchecked rows alike. */
		function menuRow(name, description, star) {
			return React.createElement("span", {
				style: { display: "flex", alignItems: "center", gap: "8px", width: "100%", minWidth: 0 },
			},
				React.createElement("span", { style: { display: "flex", flexDirection: "column", gap: "2px", flex: "1", maxWidth: "280px", minWidth: 0 } },
					React.createElement("span", { style: { fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-primary)" } }, name),
					React.createElement("span", { style: { fontSize: "12px", lineHeight: "16px", color: "var(--dsw-alias-label-caption)", whiteSpace: "normal" } }, description)),
				star);
		}

		const NONE_ID = "__none__";

		function ModeModGoalPicker({ sessionId, modeMod, seat }) {
			useLabels();
			// "header" is the in-session seat beside the mode chip: a switch only.
			const headerSeat = seat === "header";
			const [state, setState] = useState(null);
			const [busy, setBusy] = useState(false);
			const [goalOpen, setGoalOpen] = useState(false);
			const [hover, setHover] = useState(false);
			const [starHover, setStarHover] = useState(undefined);
			const buttonRef = useRef(null);
			// Re-read on open: the preset list can change in Settings while this
			// picker is mounted, and a focus event is not guaranteed.
			const reloadRef = useRef(() => {});

			useEffect(() => {
				let alive = true;
				let pending = 0;
				let attempts = 0;
				const load = () => {
					clearTimeout(pending);
					modeMod.load(sessionId)
						.then((next) => {
							if (!alive) return;
							setState(next);
							// A session opened now may still be resuming its agent; the
							// host answers "no record" until it exists, so re-read a few
							// times before settling on that answer.
							if (next.known !== true && attempts < 5) pending = setTimeout(load, 700 * ++attempts);
						})
						.catch(() => { if (alive) setState((current) => current ?? { known: false }); });
				};
				load();
				reloadRef.current = load;
				// The effective goal can change outside this control: a project
				// default starred in the hero row, a session value frozen on the
				// session's first turn, another window's picker. Re-read when the
				// window comes back to the foreground.
				const onVisible = () => { if (document.visibilityState !== "hidden") load(); };
				window.addEventListener("focus", load);
				document.addEventListener("visibilitychange", onVisible);
				return () => {
					alive = false;
					clearTimeout(pending);
					window.removeEventListener("focus", load);
					document.removeEventListener("visibilitychange", onVisible);
				};
			}, [sessionId, modeMod]);

			// A session the host has no live record of still renders: the API
			// answers with no goal rather than refusing, so the header never
			// loses its preset control.
			if (state === null) return null;

			const pick = async (value) => {
				if (busy) return;
				setBusy(true);
				try { setState(await modeMod.goal(sessionId, value)); } catch {} finally { setBusy(false); }
			};
			const runProject = async (value) => {
				if (busy) return;
				setBusy(true);
				try { setState(await modeMod.project(sessionId, value)); } catch {} finally { setBusy(false); }
			};

			// A session the host has no record of reads as no goal; the tiers
			// below it are unknown, so the tooltip must not claim them.
			const unrecorded = state.known !== true;
			const title = unrecorded ? L.goal + " · " + L.none : L.goal + " · " + L.session + ": " + tierName(state)
				+ " | " + L.project + ": " + (state.projectValue === null ? L.unselect : (state.projectValueName ?? L.none))
				+ " | " + L.globalTier + ": " + (state.globalValueName ?? L.none)
				+ "  ·  " + L.starHint;

			/* Hero geometry mirrors AgentPresetSeat.module.css .seat; the header
			 * seat mirrors AgentPresetLabel.module.css .label (the mode chip it
			 * sits beside): 22px tall, 12px text, fill-tsp-secondary at rest.
			 * Hover and open fill need a state because inline styles cannot
			 * express :hover / [aria-expanded]. */
			const triggerStyle = headerSeat ? {
				display: "inline-flex", alignItems: "center", gap: "4px",
				height: "22px", padding: "0 4px 0 2px", border: "none",
				borderRadius: "var(--dsw-radius-xs)",
				background: hover || goalOpen ? "var(--dsw-alias-interactive-bg-hover)" : "var(--dsw-alias-fill-tsp-secondary)",
				color: busy
					? "var(--dsw-alias-label-quaternary)"
					: hover || goalOpen ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-tertiary)",
				fontSize: "12px", lineHeight: "22px", fontWeight: 500,
				whiteSpace: "nowrap", cursor: busy ? "default" : "pointer",
				maxWidth: "180px",
			} : {
				display: "inline-flex", alignItems: "center", gap: "4px",
				minHeight: "28px", padding: "0 8px", border: "none",
				borderRadius: "var(--dsw-radius-sm)",
				background: hover || goalOpen ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
				color: busy ? "var(--dsw-alias-label-quaternary)" : "var(--dsw-alias-label-primary)",
				fontSize: "13px", lineHeight: "20px", fontWeight: 500,
				whiteSpace: "nowrap", cursor: busy ? "default" : "pointer",
				maxWidth: "min(100%, 240px)", marginLeft: "6px",
			};

			const trigger = React.createElement("button", {
				type: "button",
				ref: (node) => {
					buttonRef.current = node;
					if (!headerSeat) alignBesideModeControl(node);
				},
				onClick: () => setGoalOpen((open) => { if (!open) reloadRef.current(); return !open; }),
				onMouseEnter: () => setHover(true),
				onMouseLeave: () => setHover(false),
				disabled: busy,
				"aria-haspopup": "menu",
				"aria-expanded": goalOpen,
				"aria-label": L.goal,
				title,
				style: triggerStyle,
			},
				React.createElement(IconGoalOutlineRegular, { key: "icon", size: headerSeat ? 14 : 16 }),
				React.createElement("span", {
					key: "label",
					style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
				}, state.retiredGoalName ? state.retiredGoalName + L.deletedSuffix : (state.effectiveGoalName ?? L.none)),
				React.createElement("span", {
					key: "chevron",
					style: { flex: "none", display: "inline-flex", color: "var(--dsw-alias-label-caption)" },
				}, React.createElement(IconChevronDownOutlineRegular, null)));

			/* Project-default star for one row; the none row's value is "none".
			 * null (no project default) stars nothing: click ☆ selects that row as
			 * the project default (the none row's star sets a project-level
			 * "none" that blocks the global tier); click ★ unselects it. The
			 * click stops propagation so the row's selection handler never
			 * fires: the session tier is untouched and the menu stays open. */
			const goalIds = new Set((state.goals ?? []).map((goal) => goal.id));
			const starredValue = state.projectValue !== null && (state.projectValue === "none" || goalIds.has(state.projectValue)) ? state.projectValue : null;
			/* isSelected: this row carries the Menu's trailing check (6px gap +
			 * 14px glyph), which narrows its label box; the extra margin keeps
			 * every star in the same right-aligned column either way. */
			const starFor = (value, isSelected) => {
				// The header seat switches the session preset only; the project
				// default stays with the New Session dropdown.
				if (headerSeat) return null;
				const starred = starredValue === value;
				return React.createElement("span", {
					"aria-label": starred ? L.clearStar : L.setStar,
					title: starred ? L.clearStar : L.setStar,
					onMouseEnter: () => setStarHover(value),
					onMouseLeave: () => setStarHover((current) => current === value ? undefined : current),
					onClick: (event) => {
						event.stopPropagation();
						event.preventDefault();
						if (busy) return;
						void runProject(starred ? null : value);
					},
					style: {
						flex: "none", display: "inline-flex", padding: "4px",
						marginLeft: "auto", marginRight: isSelected ? "4px" : "24px",
						cursor: busy ? "default" : "pointer",
						color: starred
							? "var(--dsw-static-amber-500, var(--dsw-alias-label-primary))"
							: starHover === value
								? "var(--dsw-alias-label-primary)"
								: "var(--dsw-alias-label-quaternary)",
					},
				}, React.createElement(StarIcon, { filled: starred }));
			};

			const goalItems = [{ id: NONE_ID, label: menuRow(L.none, L.noneDesc, starFor("none", (state.effectiveGoal ?? null) === null)) }]
				.concat((state.goals ?? []).map((goal) => ({
					id: goal.id,
					label: menuRow(goal.name, goalDescription(goal.id, goal.description), starFor(goal.id, state.effectiveGoal === goal.id)),
				})));

			return React.createElement(Menu, {
				open: goalOpen,
				onClose: () => setGoalOpen(false),
				items: goalItems,
				// A retired preset checks no row: the session has no selection,
				// and the none row is a different (explicit) choice.
				selectedId: state.retiredGoalName ? "__retired__" : (state.effectiveGoal ?? NONE_ID),
				onSelect: (id) => { setGoalOpen(false); void pick(id === NONE_ID ? "none" : id); },
				align: headerSeat ? "end" : "start",
				portal: true,
				anchor: trigger,
			});
		}

		/* ------------------------------------------------------------------
		 * Settings section: system prompt management.
		 * Built-in goals are shipped files: viewable, never writable. Custom
		 * presets live in the plugin's own document and auto-save on a short
		 * debounce (plus blur and unmount), so the page has no Save button.
		 * ------------------------------------------------------------------ */

		const PROMPT_LIMITS = { title: 80, description: 200, prompt: 64 * 1024 };

		const managerStyles = {
			page: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0, maxWidth: "760px", height: "100%", minHeight: 0, boxSizing: "border-box", color: "var(--dsw-alias-label-primary, #0f1115)" },
			header: { display: "flex", flexDirection: "column", gap: "12px", flexShrink: 0 },
			title: { margin: 0, fontSize: "18px", fontWeight: 600 },
			intro: { margin: 0, fontSize: "13px", color: "var(--dsw-alias-label-tertiary, #81858c)" },
			body: { display: "flex", gap: "16px", alignItems: "stretch", flexWrap: "wrap", minWidth: 0, flex: "1 1 auto", minHeight: 0 },
			list: { flex: "0 0 190px", minWidth: "160px", display: "flex", flexDirection: "column", minHeight: 0 },
			listScroll: { display: "flex", flexDirection: "column", gap: "3px", paddingRight: "2px", flex: "1 1 auto", minHeight: 0, overflowY: "auto" },
			listFooter: { flexShrink: 0, paddingTop: "6px" },
			editor: { flex: "1 1 300px", minWidth: "240px", display: "flex", flexDirection: "column", gap: "12px", minHeight: 0 },
			preset: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0, flex: "1 1 auto", minHeight: 0 },
			group: { display: "flex", alignItems: "center", gap: "6px", padding: "6px 8px 2px", fontSize: "11px", lineHeight: "16px", letterSpacing: "0.03em", color: "var(--dsw-alias-label-caption, #adb2b8)" },
			rowTitle: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "13px", lineHeight: "18px", fontWeight: 500 },
			rowDesc: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-caption, #adb2b8)" },
			badge: { flex: "none", padding: "0 6px", borderRadius: "999px", fontSize: "10px", lineHeight: "16px", color: "var(--dsw-alias-label-tertiary, #81858c)", background: "var(--dsw-alias-bg-module-platform, #f5f6f7)" },
			hint: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary, #81858c)" },
			error: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-state-error-primary, #ec1313)" },
			banner: { fontSize: "12px", lineHeight: "18px", padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))", background: "var(--dsw-alias-bg-module-platform, #f5f6f7)", color: "var(--dsw-alias-label-secondary, #61666b)" },
			field: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, flexShrink: 0 },
			label: { fontSize: "13px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary, #61666b)" },
			input: { boxSizing: "border-box", width: "100%", height: "34px", padding: "0 10px", border: "1px solid transparent", borderRadius: "8px", background: "var(--dsw-alias-bg-module-platform, #f5f6f7)", color: "var(--dsw-alias-label-primary, #0f1115)", font: "inherit", fontSize: "13px", lineHeight: "20px", outline: "none" },
			textarea: { boxSizing: "border-box", width: "100%", minHeight: "160px", maxHeight: "420px", padding: "10px", border: "1px solid transparent", borderRadius: "8px", background: "var(--dsw-alias-bg-module-platform, #f5f6f7)", color: "var(--dsw-alias-label-primary, #0f1115)", font: "inherit", fontSize: "13px", lineHeight: "20px", outline: "none", resize: "vertical", flexShrink: 0 },
			button: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "4px", height: "32px", padding: "0 12px", border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))", borderRadius: "8px", background: "transparent", color: "var(--dsw-alias-label-primary, #0f1115)", font: "inherit", fontSize: "13px", cursor: "pointer" },
			danger: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "4px", height: "32px", padding: "0 12px", border: "1px solid transparent", borderRadius: "8px", background: "transparent", color: "var(--dsw-alias-state-error-primary, #ec1313)", font: "inherit", fontSize: "13px", cursor: "pointer" },
		};

		function promptKey(entry) {
			return entry.kind + ":" + entry.id;
		}

		function statusText(status, message) {
			if (status === "saving") return L.saving;
			if (status === "dirty") return L.dirty;
			if (status === "error") return message ? L.saveFailed + ": " + message : L.saveFailed;
			return L.saved;
		}

		function PromptListRow({ entry, selected, onSelect }) {
			useLabels();
			const [hover, setHover] = useState(false);
			const draft = entry.kind === "custom" && (!entry.title.trim() || !entry.prompt.trim());
			const description = entry.kind === "builtin" ? goalDescription(entry.id, entry.description) : entry.description;
			return React.createElement("button", {
				type: "button",
				onClick: onSelect,
				onMouseEnter: () => setHover(true),
				onMouseLeave: () => setHover(false),
				title: description || entry.title || L.untitled,
				"aria-pressed": selected,
				style: {
					display: "flex", flexDirection: "column", alignItems: "stretch", gap: "1px",
					width: "100%", padding: "7px 9px", textAlign: "left",
					border: "1px solid " + (selected ? "var(--dsw-alias-border-l2, rgba(0,0,0,.1))" : "transparent"),
					borderRadius: "8px",
					background: selected || hover ? "var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06))" : "transparent",
					color: "inherit", font: "inherit", cursor: "pointer", minWidth: 0,
				},
			},
				React.createElement("span", { style: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 } },
					React.createElement("span", { style: managerStyles.rowTitle }, entry.title || L.untitled),
					draft ? React.createElement("span", { style: managerStyles.badge }, L.draftBadge) : null),
				React.createElement("span", { style: managerStyles.rowDesc }, description || " "));
		}

		function PromptTextField({ label, value, placeholder, maxLength, readOnly, multiline, fill, onChange, onBlur }) {
			const [focused, setFocused] = useState(false);
			const focusStyle = focused && !readOnly
				? { borderColor: "var(--dsw-alias-state-business-primary, #4176e6)", background: "var(--dsw-alias-bg-layer-1, #fff)" }
				: null;
			const base = multiline ? managerStyles.textarea : managerStyles.input;
			/* Fill mode stretches the prompt box to the column's remaining height. */
			const grow = fill && multiline
				? { flexGrow: 1, flexShrink: 1, flexBasis: "auto", height: "auto", minHeight: "160px", maxHeight: "none", resize: "none" }
				: null;
			const style = Object.assign({}, base, grow, focusStyle, readOnly ? { color: "var(--dsw-alias-label-secondary, #61666b)" } : null);
			const fieldStyle = fill ? Object.assign({}, managerStyles.field, { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minHeight: 0 }) : managerStyles.field;
			const common = {
				value: value === undefined || value === null ? "" : value,
				placeholder,
				maxLength,
				readOnly,
				"aria-label": label,
				onFocus: () => setFocused(true),
				onBlur: () => { setFocused(false); if (onBlur) onBlur(); },
				onChange: onChange ? (event) => onChange(event.target.value) : undefined,
				style,
			};
			return React.createElement("label", { style: fieldStyle },
				React.createElement("span", { style: managerStyles.label }, label),
				multiline
					? React.createElement("textarea", common)
					: React.createElement("input", Object.assign({ type: "text" }, common)));
		}

		function BuiltinPresetView({ preset }) {
			useLabels();
			return React.createElement("div", { style: managerStyles.preset },
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 } },
					React.createElement("span", { style: { fontSize: "14px", lineHeight: "22px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, preset.title),
					React.createElement("span", { style: managerStyles.badge }, L.builtinBadge)),
				React.createElement(PromptTextField, { label: L.titleLabel, value: preset.title, readOnly: true }),
				React.createElement(PromptTextField, { label: L.descriptionLabel, value: goalDescription(preset.id, preset.description), readOnly: true }),
				React.createElement(PromptTextField, { label: L.promptLabel, value: preset.prompt, readOnly: true, multiline: true, fill: true }));
		}

		/* One custom preset: local draft + debounced write-through. The write
		 * chain keeps requests in order, the unmount flush is keepalive so a
		 * switch between list rows never loses the last keystrokes. */
		function CustomPresetEditor({ preset, onLocalChange, onDeleted }) {
			useLabels();
			const [draft, setDraft] = useState({ title: preset.title, description: preset.description, prompt: preset.prompt });
			const [status, setStatus] = useState("saved");
			const [message, setMessage] = useState("");
			const [confirming, setConfirming] = useState(false);
			const [deleting, setDeleting] = useState(false);
			const draftRef = useRef(draft);
			const dirtyRef = useRef(false);
			const aliveRef = useRef(true);
			const timerRef = useRef(null);
			const chainRef = useRef(Promise.resolve());
			const deletedRef = useRef(false);

			const flush = (keepalive) => {
				if (deletedRef.current) return;
				if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
				if (!dirtyRef.current) return;
				dirtyRef.current = false;
				const payload = draftRef.current;
				if (aliveRef.current) setStatus("saving");
				const run = async () => {
					try {
						await postPrompts({ action: "update", id: preset.id, preset: payload }, keepalive);
						if (!aliveRef.current) return;
						setStatus(dirtyRef.current ? "dirty" : "saved");
						setMessage("");
					} catch (error) {
						dirtyRef.current = true;
						if (aliveRef.current) {
							setStatus("error");
							setMessage(error && error.message ? error.message : "");
						}
					}
				};
				chainRef.current = chainRef.current.then(run, run);
			};

			const change = (field, value) => {
				const next = Object.assign({}, draftRef.current, { [field]: value });
				draftRef.current = next;
				dirtyRef.current = true;
				setDraft(next);
				setStatus("dirty");
				onLocalChange(next);
				if (timerRef.current !== null) clearTimeout(timerRef.current);
				timerRef.current = setTimeout(() => flush(false), 500);
			};

			useEffect(() => {
				aliveRef.current = true;
				return () => {
					aliveRef.current = false;
					flush(true);
				};
			}, []);

			const remove = async () => {
				if (deleting) return;
				setDeleting(true);
				deletedRef.current = true;
				if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
				try {
					const response = await postPrompts({ action: "delete", id: preset.id });
					onDeleted(response);
				} catch (error) {
					deletedRef.current = false;
					setDeleting(false);
					setStatus("error");
					setMessage(error && error.message ? error.message : "");
				}
			};

			const incomplete = !draft.title.trim() || !draft.prompt.trim();
			return React.createElement("div", { style: managerStyles.preset },
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 } },
					React.createElement("span", { style: { fontSize: "14px", lineHeight: "22px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, draft.title.trim() || L.untitled),
					React.createElement("span", { style: managerStyles.badge }, L.customBadge),
					React.createElement("span", { style: { flex: 1 } }),
					React.createElement("span", { style: status === "error" ? managerStyles.error : managerStyles.hint, title: message || undefined }, statusText(status, message))),
				React.createElement(PromptTextField, { label: L.titleLabel, value: draft.title, placeholder: L.titlePlaceholder, maxLength: PROMPT_LIMITS.title, onChange: (value) => change("title", value), onBlur: () => flush(false) }),
				React.createElement(PromptTextField, { label: L.descriptionLabel, value: draft.description, placeholder: L.descriptionPlaceholder, maxLength: PROMPT_LIMITS.description, onChange: (value) => change("description", value), onBlur: () => flush(false) }),
				React.createElement(PromptTextField, { label: L.promptLabel, value: draft.prompt, placeholder: L.promptPlaceholder, maxLength: PROMPT_LIMITS.prompt, multiline: true, fill: true, onChange: (value) => change("prompt", value), onBlur: () => flush(false) }),
				incomplete ? React.createElement("div", { style: managerStyles.hint }, L.draftHint) : null,
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap", paddingTop: "2px" } },
					confirming
						? React.createElement(React.Fragment, null,
							React.createElement("span", { style: managerStyles.hint }, L.deleteConfirm),
							React.createElement("button", { type: "button", style: managerStyles.button, onClick: () => setConfirming(false), disabled: deleting }, L.cancel),
							React.createElement("button", { type: "button", style: managerStyles.danger, onClick: remove, disabled: deleting }, deleting ? L.saving : L.deleteYes))
						: React.createElement("button", { type: "button", style: managerStyles.danger, onClick: () => setConfirming(true), disabled: deleting }, L.deletePreset)));
		}

		function PromptManagerSection() {
			useLabels();
			const [data, setData] = useState(null);
			const [selectedKey, setSelectedKey] = useState(null);
			const [loading, setLoading] = useState(true);
			const [error, setError] = useState("");
			const [notice, setNotice] = useState("");
			const [creating, setCreating] = useState(false);

			const load = () => {
				setLoading(true);
				listPrompts()
					.then((next) => { setData(next); setError(""); })
					.catch((failure) => setError((failure && failure.message) || L.loadFailed))
					.finally(() => setLoading(false));
			};

			useEffect(() => { load(); }, []);

			const builtins = data ? data.builtins : [];
			const custom = data ? data.custom : [];
			const entries = builtins.map((item) => Object.assign({}, item, { kind: "builtin" }))
				.concat(custom.map((item) => Object.assign({}, item, { kind: "custom" })));

			useEffect(() => {
				if (data === null) return;
				if (selectedKey !== null && entries.some((entry) => promptKey(entry) === selectedKey)) return;
				const next = custom[0]
					? "custom:" + custom[0].id
					: builtins[0] ? "builtin:" + builtins[0].id : null;
				setSelectedKey(next);
			}, [data, selectedKey]);

			const add = async () => {
				if (creating) return;
				setCreating(true);
				setError("");
				setNotice("");
				try {
					const next = await postPrompts({ action: "create", preset: { title: L.newTitle, description: "", prompt: "" } });
					setData({ builtins: next.builtins, custom: next.custom });
					setSelectedKey("custom:" + next.createdId);
				} catch (failure) {
					setError((failure && failure.message) || L.saveFailed);
				} finally {
					setCreating(false);
				}
			};

			const handleLocalChange = (id, next) => {
				setData((current) => current === null ? current : Object.assign({}, current, {
					custom: current.custom.map((item) => item.id === id ? Object.assign({}, item, next) : item),
				}));
			};

			const handleDeleted = (response) => {
				const remaining = response.custom;
				setData({ builtins: response.builtins, custom: remaining });
				const next = remaining[0]
					? "custom:" + remaining[0].id
					: response.builtins[0] ? "builtin:" + response.builtins[0].id : null;
				setSelectedKey(next);
				setNotice(L.deleteNotice);
			};

			const selected = entries.find((entry) => promptKey(entry) === selectedKey) || null;

			return React.createElement("div", { style: managerStyles.page },
				React.createElement("div", { style: managerStyles.header },
					React.createElement("h2", { style: managerStyles.title }, L.manageTitle),
					React.createElement("p", { style: managerStyles.intro }, L.manageIntro)),
				error ? React.createElement("div", { style: Object.assign({}, managerStyles.banner, managerStyles.error) }, error,
					data === null ? React.createElement("button", { type: "button", style: Object.assign({}, managerStyles.button, { marginLeft: "8px", height: "26px", color: "inherit" }), onClick: load }, L.retry) : null) : null,
				notice ? React.createElement("div", { style: managerStyles.banner }, notice) : null,
				data === null
					? React.createElement("div", { style: managerStyles.hint }, loading ? L.loading : L.loadFailed)
					: React.createElement("div", { style: managerStyles.body },
						React.createElement("div", { style: managerStyles.list },
							React.createElement("div", { style: managerStyles.listScroll },
								React.createElement("div", { style: managerStyles.group }, L.builtinGroup),
							builtins.map((entry) => React.createElement(PromptListRow, {
								key: "builtin:" + entry.id,
								entry: Object.assign({}, entry, { kind: "builtin" }),
								selected: selectedKey === "builtin:" + entry.id,
								onSelect: () => { setSelectedKey("builtin:" + entry.id); setNotice(""); },
							})),
							React.createElement("div", { style: Object.assign({}, managerStyles.group, { marginTop: "4px" }) }, L.customGroup),
									custom.length === 0
									? React.createElement("div", { style: Object.assign({}, managerStyles.hint, { padding: "2px 9px" }) }, L.noCustom)
									: custom.map((entry) => React.createElement(PromptListRow, {
											key: "custom:" + entry.id,
											entry: Object.assign({}, entry, { kind: "custom" }),
											selected: selectedKey === "custom:" + entry.id,
											onSelect: () => { setSelectedKey("custom:" + entry.id); setNotice(""); },
										}))),
							React.createElement("div", { style: managerStyles.listFooter },
								React.createElement("button", {
								type: "button",
								onClick: add,
								disabled: creating,
								style: {
										display: "flex", alignItems: "center", justifyContent: "center",
										width: "100%", height: "34px", border: "1px dashed var(--dsw-alias-border-l2, rgba(0,0,0,.18))",
										borderRadius: "8px", background: "transparent",
										color: creating ? "var(--dsw-alias-label-caption, #adb2b8)" : "var(--dsw-alias-label-secondary, #61666b)",
										font: "inherit", fontSize: "12px", cursor: creating ? "default" : "pointer",
									},
								}, "+ " + L.add))),
						React.createElement("div", { style: managerStyles.editor },
							selected === null
								? React.createElement("div", { style: managerStyles.hint }, L.emptySelection)
								: selected.kind === "builtin"
									? React.createElement(BuiltinPresetView, { preset: selected })
									: React.createElement(CustomPresetEditor, {
										key: "custom:" + selected.id,
										preset: selected,
										onLocalChange: (next) => handleLocalChange(selected.id, next),
										onDeleted: handleDeleted,
									}))));
		}

		const inject = ["slots"];

		function apply(ctx) {
			const face = {
				load: loadState,
				goal: (sessionId, value) => post(API.goal, sessionId, value),
				project: (sessionId, value) => post(API.project, sessionId, value),
			};
			ctx.slots.inject("conversation.hero.options", () => ctx.slots.register({
				name: "conversation.hero.options",
				id: "mode-mod-goal-picker",
				// First occupant of the hero options list, right after the mode control.
				order: 0,
				inject: (sessionId) => ({ modeMod: { ...face, labels: L }, seat: "hero" }),
			}, ModeModGoalPicker));
			// The in-session seat, beside the mode chip (that label is order -10;
			// background tasks follow at 20). Exists only where the header renders,
			// i.e. after the conversation starts and the hero is gone.
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "mode-mod-goal-switch",
				order: 0,
				inject: (sessionId) => ({ modeMod: { ...face, labels: L }, seat: "header" }),
			}, ModeModGoalPicker));
			// Settings page, right after the shipped "Agent 预设" section.
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "mode-mod-prompts",
				order: 25,
				label: () => L.manageTitle,
			}, PromptManagerSection));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
})();
