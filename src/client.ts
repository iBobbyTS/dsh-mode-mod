import * as React from 'react';
import type { GoalState, LanguageEntry, LanguageState, PromptFields, PromptEntry, PromptPayload } from './protocol.js';
import type { ClientContext, LanguagePickerProps, PickerProps } from './client-contract.js';
import { primitives } from './client-contract.js';
import { errorDetails } from './errors.js';
const { useEffect, useRef, useState } = React;
const { Menu, IconChevronDownOutlineRegular, IconGoalOutlineRegular } = primitives;

			const API = {
				state: (sessionId: string) => "/api/mode-mod/state?session=" + encodeURIComponent(sessionId),
				goal: "/api/mode-mod/goal",
				project: "/api/mode-mod/project",
				prompts: "/api/mode-mod/prompts",
				prompt: "/api/mode-mod/prompt",
				languages: (sessionId: string) => "/api/mode-mod/languages?session=" + encodeURIComponent(sessionId),
				language: "/api/mode-mod/language",
				languageSelection: "/api/mode-mod/language-selection",
			};

		function resolveApiUrl(path: string) {
			if (typeof document === "undefined") return path;
			try { return new URL(path.replace(/^\//, ""), document.baseURI).href; } catch { return path; }
		}

		async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
			const response = await fetch(resolveApiUrl(url), init);
			let body: { error?: string } | null = null;
			try { body = await response.json(); } catch {}
			if (!response.ok) {
				const error = new Error((body && body.error) || ("HTTP " + response.status)) as Error & { status: number };
				error.status = response.status;
				throw error;
			}
			return body as T;
		}

		function loadState(sessionId: string) {
			return fetchJson<GoalState>(API.state(sessionId));
		}

		function post(path: string, sessionId: string, value: string | null) {
			return fetchJson<GoalState>(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ session: sessionId, value }),
			});
		}

		function listPrompts() {
			return fetchJson<PromptPayload>(API.prompts);
		}

		function listLanguages(sessionId: string) {
			return fetchJson<LanguageState>(API.languages(sessionId));
		}

		function postLanguage(body: { action: string; id?: string; entry?: { title?: string; prompt?: string }; session?: string }, keepalive?: boolean) {
			const payload = JSON.stringify(body);
			let bytes = payload.length;
			try { bytes = new TextEncoder().encode(payload).length; } catch {}
			return fetchJson<LanguageState>(API.language, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: payload,
				// Same 64 KiB browser limit as prompt saves: the debounce is the
				// normal path, the unmount flush is best-effort for large bodies.
				keepalive: keepalive === true && bytes < 60 * 1024,
			});
		}

		function postLanguageSelection(sessionId: string, ids: string[]) {
			return fetchJson<LanguageState>(API.languageSelection, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ session: sessionId, ids }),
			});
		}

		/* Multi-select toggle: keep the store's display order, never duplicate an
		 * id, and return the next selection. */
		function toggleLanguageSelection(ids: readonly string[], id: string): string[] {
			return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
		}

		function postPrompts(body: { action: string; id?: string; preset?: Partial<PromptFields> }, keepalive?: boolean) {
			const payload = JSON.stringify(body);
			let bytes = payload.length;
			try { bytes = new TextEncoder().encode(payload).length; } catch {}
			return fetchJson<PromptPayload>(API.prompt, {
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
			language: "语言要求",
			languageNone: "未选择",
			languageManageHint: "条目在设置 → 语言要求管理中维护；勾选结果注入本项目所有会话（含子代理）",
			languageNoEntries: "还没有语言要求条目，请先在设置中新增。",
			languageEmptySelection: "从左侧选择一个条目，或新增一个。",
			languageLoadFailed: "加载语言要求失败。",
			languageManagerTitle: "语言要求管理",
			languageManageIntro: "维护可勾选的语言要求条目。条目全局共享；各项目在会话中多选勾选，勾选结果作为持久上下文消息注入到该项目所有会话。",
			languageAdd: "新增语言要求",
			languageNewTitle: "新的语言要求",
			languageTitleLabel: "名称",
			languageTitlePlaceholder: "例如：Rust",
			languageBodyLabel: "要求正文",
			languageBodyPlaceholder: "输入该语言的具体要求…",
			languageDraftHint: "名称和正文都填写后，才会出现在会话的语言要求选择器中。",
			languageDelete: "删除条目",
			languageDeleteConfirm: "确认删除这个语言要求？所有项目的勾选会一并移除，已注入的内容会保留。",
			languageDeleteNotice: "语言要求已删除。已注入到会话的内容会保留。",
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
			language: "Language requirements",
			languageNone: "None selected",
			languageManageHint: "Entries live in Settings → Language requirements; the selection is injected into every session of this project (subagents included)",
			languageNoEntries: "No language requirements yet. Add one in Settings.",
			languageEmptySelection: "Select an entry on the left, or add one.",
			languageLoadFailed: "Failed to load language requirements.",
			languageManagerTitle: "Language requirements",
			languageManageIntro: "Maintain the selectable requirement entries. Entries are shared globally; each project multi-selects its own subset, and the selection is injected as persistent context into every session of that project.",
			languageAdd: "Add language requirement",
			languageNewTitle: "New language requirement",
			languageTitleLabel: "Name",
			languageTitlePlaceholder: "e.g. Rust",
			languageBodyLabel: "Requirement",
			languageBodyPlaceholder: "Enter the requirements for this language…",
			languageDraftHint: "An entry appears in the session picker once both its name and requirement are filled in.",
			languageDelete: "Delete entry",
			languageDeleteConfirm: "Delete this language requirement? Every project selection is cleared; already injected context is kept.",
			languageDeleteNotice: "Language requirement deleted. Context already injected into sessions is kept.",
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

		let cachedLabels: typeof LABELS_EN | null = null;
		let labelVersion = 0;
		const labelListeners = new Set<() => void>();

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
		const L = new Proxy({} as typeof LABELS_EN, { get: (_target, key) => activeLabels()[key as keyof typeof LABELS_EN] });

		function subscribeLabels(notify: () => void) {
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
		 * the English descriptions from src/presets.ts. */
		const ZH_GOAL_DESCRIPTIONS: Record<string, string> = {
			research: "科学研究与算法实验。",
			prototype: "快速原型与可行性验证。",
			utility: "小型脚本与个人工具。",
			"host-extension": "宿主插件与应用扩展。",
			library: "库与包的开发维护。",
			software: "完整软件功能开发。",
			"agent-runtime": "代理运行时行为调整。",
		};

		function goalDescription(id: string, fallback: string) {
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
		function alignBesideModeControl(node: HTMLElement | null) {
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
		function tierName(state: GoalState) {
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
		function StarIcon({ filled }: { filled: boolean }) {
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
		function menuRow(name: React.ReactNode, description: React.ReactNode, star: React.ReactNode) {
			return React.createElement("span", {
				style: { display: "flex", alignItems: "center", gap: "8px", width: "100%", minWidth: 0 },
			},
				React.createElement("span", { style: { display: "flex", flexDirection: "column", gap: "2px", flex: "1", maxWidth: "280px", minWidth: 0 } },
					React.createElement("span", { style: { fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-primary)" } }, name),
					React.createElement("span", { style: { fontSize: "12px", lineHeight: "16px", color: "var(--dsw-alias-label-caption)", whiteSpace: "normal" } }, description)),
				star);
		}

		const NONE_ID = "__none__";

		function ModeModGoalPicker({ sessionId, modeMod, seat }: PickerProps) {
			useLabels();
			// "header" is the in-session seat beside the mode chip: a switch only.
			const headerSeat = seat === "header";
			const [state, setState] = useState<GoalState | null>(null);
			const [busy, setBusy] = useState(false);
			const [goalOpen, setGoalOpen] = useState(false);
			const [hover, setHover] = useState(false);
			const [starHover, setStarHover] = useState<string | undefined>(undefined);
			const buttonRef = useRef<HTMLButtonElement | null>(null);
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

			const pick = async (value: string | null) => {
				if (busy) return;
				setBusy(true);
				try { setState(await modeMod.goal(sessionId, value)); } catch {} finally { setBusy(false); }
			};
			const runProject = async (value: string | null) => {
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
			const triggerStyle: React.CSSProperties = headerSeat ? {
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
				ref: (node: HTMLButtonElement | null) => {
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
			const starredValue = state.projectValue !== null && (state.projectValue === "none" || goalIds.has(state.projectValue!)) ? state.projectValue : null;
			/* isSelected: this row carries the Menu's trailing check (6px gap +
			 * 14px glyph), which narrows its label box; the extra margin keeps
			 * every star in the same right-aligned column either way. */
			const starFor = (value: string, isSelected: boolean) => {
				// The header seat switches the session preset only; the project
				// default stays with the New Session dropdown.
				if (headerSeat) return null;
				const starred = starredValue === value;
				return React.createElement("span", {
					"aria-label": starred ? L.clearStar : L.setStar,
					title: starred ? L.clearStar : L.setStar,
					onMouseEnter: () => setStarHover(value),
					onMouseLeave: () => setStarHover((current) => current === value ? undefined : current),
					onClick: (event: React.MouseEvent) => {
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
		 * Project language requirements: one multi-select picker, two seats.
		 * The entry checklist is global; the selection is per project and both
		 * seats write the same backend route. The menu stays open across row
		 * clicks, so several entries can be toggled in one visit; Menu's
		 * selectedIds marks every checked row.
		 * ------------------------------------------------------------------ */

		const EMPTY_LANGUAGE_ITEM = "__empty__";
		const HINT_LANGUAGE_ITEM = "__manage__";

		/* The UI kit ships no language/globe glyph, so this is a small inline
		 * SVG in currentColor (two speech bubbles: the requirement text). */
		function LanguageIcon({ size }: { size: number }) {
			return React.createElement("svg", {
				width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": true,
				fill: "none", stroke: "currentColor", strokeWidth: "1.2",
				strokeLinecap: "round", strokeLinejoin: "round",
			},
				React.createElement("path", { d: "M2.2 3.1h7.1v5.4H5.7L3.5 10.3V8.5H2.2z" }),
				React.createElement("path", { d: "M7.9 6h5.9v4.2h-1.2v1.3l-1.9-1.3H7.9z" }));
		}

		/* Seat geometry mirrors the goal picker: the hero button sits beside the
		 * mode control, the header chip beside the 22px mode chip. */
		function languageTriggerStyle(headerSeat: boolean, active: boolean, busy: boolean): React.CSSProperties {
			return headerSeat ? {
				display: "inline-flex", alignItems: "center", gap: "4px",
				height: "22px", padding: "0 4px 0 2px", border: "none",
				borderRadius: "var(--dsw-radius-xs)",
				background: active ? "var(--dsw-alias-interactive-bg-hover)" : "var(--dsw-alias-fill-tsp-secondary)",
				color: busy
					? "var(--dsw-alias-label-quaternary)"
					: active ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-tertiary)",
				fontSize: "12px", lineHeight: "22px", fontWeight: 500,
				whiteSpace: "nowrap", cursor: busy ? "default" : "pointer",
				maxWidth: "180px",
			} : {
				display: "inline-flex", alignItems: "center", gap: "4px",
				minHeight: "28px", padding: "0 8px", border: "none",
				borderRadius: "var(--dsw-radius-sm)",
				background: active ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
				color: busy ? "var(--dsw-alias-label-quaternary)" : "var(--dsw-alias-label-primary)",
				fontSize: "13px", lineHeight: "20px", fontWeight: 500,
				whiteSpace: "nowrap", cursor: busy ? "default" : "pointer",
				maxWidth: "min(100%, 240px)", marginLeft: "6px",
			};
		}

		/* One line of the requirement body for the menu row's description. */
		function languagePreview(entry: LanguageEntry) {
			const line = entry.prompt.split("\n").map((value) => value.trim()).find((value) => value.length > 0) ?? "";
			return line.length > 88 ? line.slice(0, 87) + "…" : line;
		}

		function ModeModLanguagePicker({ sessionId, language, seat }: LanguagePickerProps) {
			useLabels();
			const headerSeat = seat === "header";
			const [state, setState] = useState<LanguageState | null>(null);
			const [busy, setBusy] = useState(false);
			const [open, setOpen] = useState(false);
			const [hover, setHover] = useState(false);
			// Re-read on open: entries can change in Settings while this picker
			// stays mounted, and the project selection can change in the other seat.
			const reloadRef = useRef(() => {});

			useEffect(() => {
				let alive = true;
				let pending = 0;
				let attempts = 0;
				const load = () => {
					clearTimeout(pending);
					language.load(sessionId)
						.then((next) => {
							if (!alive) return;
							setState(next);
							// A session opened now may still be resuming: the API answers
							// with no project root until the live agent exists.
							if (next.projectRoot === null && attempts < 5) pending = setTimeout(load, 700 * ++attempts);
						})
						.catch(() => { if (alive) setState((current) => current ?? { sessionId, projectRoot: null, selected: [], entries: [] }); });
				};
				load();
				reloadRef.current = load;
				const onVisible = () => { if (document.visibilityState !== "hidden") load(); };
				window.addEventListener("focus", load);
				document.addEventListener("visibilitychange", onVisible);
				return () => {
					alive = false;
					clearTimeout(pending);
					window.removeEventListener("focus", load);
					document.removeEventListener("visibilitychange", onVisible);
				};
			}, [sessionId, language]);

			if (state === null) return null;

			// Only complete entries are selectable; an empty draft stays in Settings.
			const entries = state.entries.filter((entry) => entry.title.trim() !== "" && entry.prompt.trim() !== "");
			const selected = state.selected ?? [];
			const selectedEntries = entries.filter((entry) => selected.includes(entry.id));
			const label = selectedEntries.length === 0
				? L.language + " · " + L.languageNone
				: L.language + " · " + selectedEntries.length;
			const detail = selectedEntries.length === 0
				? L.languageNone
				: selectedEntries.map((entry) => entry.title).join(chineseLabelsActive() ? "、" : ", ");
			const title = L.language + " · " + detail + "  ·  " + L.languageManageHint;

			const toggle = async (id: string) => {
				if (busy) return;
				setBusy(true);
				try {
					setState(await language.selection(sessionId, toggleLanguageSelection(selected, id)));
				} catch {} finally { setBusy(false); }
			};

			const trigger = React.createElement("button", {
				type: "button",
				ref: (node: HTMLButtonElement | null) => { if (!headerSeat) alignBesideModeControl(node); },
				onClick: () => setOpen((value) => { if (!value) reloadRef.current(); return !value; }),
				onMouseEnter: () => setHover(true),
				onMouseLeave: () => setHover(false),
				disabled: busy,
				"aria-haspopup": "menu",
				"aria-expanded": open,
				"aria-label": L.language,
				title,
				style: languageTriggerStyle(headerSeat, hover || open, busy),
			},
				React.createElement(LanguageIcon, { key: "icon", size: headerSeat ? 14 : 16 }),
				React.createElement("span", {
					key: "label",
					style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
				}, label),
				React.createElement("span", {
					key: "chevron",
					style: { flex: "none", display: "inline-flex", color: "var(--dsw-alias-label-caption)" },
				}, React.createElement(IconChevronDownOutlineRegular, null)));

			const items = entries.length === 0
				? [{ id: EMPTY_LANGUAGE_ITEM, label: menuRow(L.languageNoEntries, "", null), disabled: true }]
				: entries.map((entry) => ({
					id: entry.id,
					label: menuRow(entry.title, languagePreview(entry), null),
				}));
			items.push({ id: HINT_LANGUAGE_ITEM, label: menuRow(L.languageManageHint, "", null), disabled: true });

			return React.createElement(Menu, {
				open,
				onClose: () => setOpen(false),
				items,
				selectedIds: entries.filter((entry) => selected.includes(entry.id)).map((entry) => entry.id),
				// A row click toggles and leaves the menu open: this is a checklist,
				// not a one-shot switch.
				onSelect: (id) => { if (id !== EMPTY_LANGUAGE_ITEM && id !== HINT_LANGUAGE_ITEM) void toggle(id); },
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

		const managerStyles: Record<string, React.CSSProperties> = {
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

		function promptKey(entry: PromptEntry) {
			return entry.kind + ":" + entry.id;
		}

		function statusText(status: string, message: string) {
			if (status === "saving") return L.saving;
			if (status === "dirty") return L.dirty;
			if (status === "error") return message ? L.saveFailed + ": " + message : L.saveFailed;
			return L.saved;
		}

		function PromptListRow({ entry, selected, onSelect }: { entry: PromptEntry; selected: boolean; onSelect(): void }) {
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

		function PromptTextField({ label, value, placeholder, maxLength, readOnly, multiline, fill, onChange, onBlur }: { label: string; value?: string; placeholder?: string; maxLength?: number; readOnly?: boolean; multiline?: boolean; fill?: boolean; onChange?(value: string): void; onBlur?(): void }) {
			const [focused, setFocused] = useState(false);
			const focusStyle = focused && !readOnly
				? { borderColor: "var(--dsw-alias-state-business-primary, #4176e6)", background: "var(--dsw-alias-bg-layer-1, #fff)" }
				: null;
			const base = multiline ? managerStyles.textarea : managerStyles.input;
			/* Fill mode stretches the prompt box to the column's remaining height. */
			const grow = fill && multiline
				? { flexGrow: 1, flexShrink: 1, flexBasis: "auto", height: "auto", minHeight: "160px", maxHeight: "none", resize: "none" }
				: null;
			const style = Object.assign({}, base, grow as React.CSSProperties | null, focusStyle, readOnly ? { color: "var(--dsw-alias-label-secondary, #61666b)" } : null);
			const fieldStyle = fill ? Object.assign({}, managerStyles.field, { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minHeight: 0 }) : managerStyles.field;
			const common = {
				value: value === undefined || value === null ? "" : value,
				placeholder,
				maxLength,
				readOnly,
				"aria-label": label,
				onFocus: () => setFocused(true),
				onBlur: () => { setFocused(false); if (onBlur) onBlur(); },
				onChange: onChange ? (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value) : undefined,
				style,
			};
			return React.createElement("label", { style: fieldStyle },
				React.createElement("span", { style: managerStyles.label }, label),
				multiline
					? React.createElement("textarea", common)
					: React.createElement("input", Object.assign({ type: "text" }, common)));
		}

		function BuiltinPresetView({ preset }: { preset: PromptEntry }) {
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
		function CustomPresetEditor({ preset, onLocalChange, onDeleted }: { preset: PromptEntry; onLocalChange(next: PromptFields): void; onDeleted(next: PromptPayload): void }) {
			useLabels();
			const [draft, setDraft] = useState({ title: preset.title, description: preset.description, prompt: preset.prompt });
			const [status, setStatus] = useState("saved");
			const [message, setMessage] = useState("");
			const [confirming, setConfirming] = useState(false);
			const [deleting, setDeleting] = useState(false);
			const draftRef = useRef(draft);
			const dirtyRef = useRef(false);
			const aliveRef = useRef(true);
			const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
			const chainRef = useRef(Promise.resolve());
			const deletedRef = useRef(false);

			const flush = (keepalive: boolean) => {
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
							setMessage(errorDetails(error).message ?? "");
						}
					}
				};
				chainRef.current = chainRef.current.then(run, run);
			};

			const change = (field: keyof PromptFields, value: string) => {
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
					setMessage(errorDetails(error).message ?? "");
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
			const [data, setData] = useState<PromptPayload | null>(null);
			const [selectedKey, setSelectedKey] = useState<string | null>(null);
			const [loading, setLoading] = useState(true);
			const [error, setError] = useState("");
			const [notice, setNotice] = useState("");
			const [creating, setCreating] = useState(false);

			const load = () => {
				setLoading(true);
				listPrompts()
					.then((next) => { setData(next); setError(""); })
					.catch((failure) => setError(errorDetails(failure).message || L.loadFailed))
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
					setError(errorDetails(failure).message || L.saveFailed);
				} finally {
					setCreating(false);
				}
			};

			const handleLocalChange = (id: string, next: PromptFields) => {
				setData((current) => current === null ? current : Object.assign({}, current, {
					custom: current.custom.map((item) => item.id === id ? Object.assign({}, item, next) : item),
				}));
			};

			const handleDeleted = (response: PromptPayload) => {
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



		/* ------------------------------------------------------------------
		 * Settings section: language requirement management.
		 * Entries are global and auto-save on a short debounce (plus blur and
		 * unmount), so this page needs no Save button. The per-project selection
		 * belongs to the two picker seats and never appears here.
		 * ------------------------------------------------------------------ */

		function LanguageListRow({ entry, selected, onSelect }: { entry: LanguageEntry; selected: boolean; onSelect(): void }) {
			useLabels();
			const [hover, setHover] = useState(false);
			return React.createElement("button", {
				type: "button",
				onClick: onSelect,
				onMouseEnter: () => setHover(true),
				onMouseLeave: () => setHover(false),
				title: languagePreview(entry) || entry.title || L.untitled,
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
					React.createElement("span", { style: managerStyles.rowTitle }, entry.title || L.untitled)),
				React.createElement("span", { style: managerStyles.rowDesc }, languagePreview(entry) || " "));
		}

		/* One entry: local draft + debounced write-through, with an unmount flush
		 * so switching rows never loses the last keystrokes. */
		function LanguageEntryEditor({ entry, onLocalChange, onSaved, onDeleted }: { entry: LanguageEntry; onLocalChange(next: { title: string; prompt: string }): void; onSaved(next: LanguageEntry): void; onDeleted(next: LanguageState): void }) {
			useLabels();
			const [draft, setDraft] = useState({ title: entry.title, prompt: entry.prompt });
			const [status, setStatus] = useState("saved");
			const [message, setMessage] = useState("");
			const [confirming, setConfirming] = useState(false);
			const [deleting, setDeleting] = useState(false);
			const draftRef = useRef(draft);
			const dirtyRef = useRef(false);
			const aliveRef = useRef(true);
			const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
			const chainRef = useRef(Promise.resolve());
			const deletedRef = useRef(false);

			const flush = (keepalive: boolean) => {
				if (deletedRef.current) return;
				if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
				if (!dirtyRef.current) return;
				dirtyRef.current = false;
				const payload = draftRef.current;
				if (aliveRef.current) setStatus("saving");
				const run = async () => {
					try {
						const response = await postLanguage({ action: "update", id: entry.id, entry: payload }, keepalive);
						const saved = response.entries.find((value) => value.id === entry.id);
						// The version advances only on a real body change; keep the
						// manager's row in step with the server's monotonic number.
						if (saved !== undefined) onSaved(saved);
						if (!aliveRef.current) return;
						setStatus(dirtyRef.current ? "dirty" : "saved");
						setMessage("");
					} catch (error) {
						dirtyRef.current = true;
						if (aliveRef.current) {
							setStatus("error");
							setMessage(errorDetails(error).message ?? "");
						}
					}
				};
				chainRef.current = chainRef.current.then(run, run);
			};

			const change = (field: "title" | "prompt", value: string) => {
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
					onDeleted(await postLanguage({ action: "delete", id: entry.id }));
				} catch (error) {
					deletedRef.current = false;
					setDeleting(false);
					setStatus("error");
					setMessage(errorDetails(error).message ?? "");
				}
			};

			const incomplete = !draft.title.trim() || !draft.prompt.trim();
			return React.createElement("div", { style: managerStyles.preset },
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 } },
					React.createElement("span", { style: { fontSize: "14px", lineHeight: "22px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, draft.title.trim() || L.untitled),
					React.createElement("span", { style: managerStyles.badge }, "v" + entry.version),
					React.createElement("span", { style: { flex: 1 } }),
					React.createElement("span", { style: status === "error" ? managerStyles.error : managerStyles.hint, title: message || undefined }, statusText(status, message))),
				React.createElement(PromptTextField, { label: L.languageTitleLabel, value: draft.title, placeholder: L.languageTitlePlaceholder, maxLength: PROMPT_LIMITS.title, onChange: (value) => change("title", value), onBlur: () => flush(false) }),
				React.createElement(PromptTextField, { label: L.languageBodyLabel, value: draft.prompt, placeholder: L.languageBodyPlaceholder, maxLength: PROMPT_LIMITS.prompt, multiline: true, fill: true, onChange: (value) => change("prompt", value), onBlur: () => flush(false) }),
				incomplete ? React.createElement("div", { style: managerStyles.hint }, L.languageDraftHint) : null,
				React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap", paddingTop: "2px" } },
					confirming
						? React.createElement(React.Fragment, null,
							React.createElement("span", { style: managerStyles.hint }, L.languageDeleteConfirm),
							React.createElement("button", { type: "button", style: managerStyles.button, onClick: () => setConfirming(false), disabled: deleting }, L.cancel),
							React.createElement("button", { type: "button", style: managerStyles.danger, onClick: remove, disabled: deleting }, deleting ? L.saving : L.deleteYes))
						: React.createElement("button", { type: "button", style: managerStyles.danger, onClick: () => setConfirming(true), disabled: deleting }, L.languageDelete)));
		}

		function LanguageManagerSection() {
			useLabels();
			const [data, setData] = useState<LanguageState | null>(null);
			const [selectedId, setSelectedId] = useState<string | null>(null);
			const [loading, setLoading] = useState(true);
			const [error, setError] = useState("");
			const [notice, setNotice] = useState("");
			const [creating, setCreating] = useState(false);

			const load = () => {
				setLoading(true);
				listLanguages("")
					.then((next) => { setData(next); setError(""); })
					.catch((failure) => setError(errorDetails(failure).message || L.languageLoadFailed))
					.finally(() => setLoading(false));
			};

			useEffect(() => { load(); }, []);

			const entries = data ? data.entries : [];

			useEffect(() => {
				if (data === null) return;
				if (selectedId !== null && entries.some((entry) => entry.id === selectedId)) return;
				setSelectedId(entries[0] ? entries[0].id : null);
			}, [data, selectedId]);

			const add = async () => {
				if (creating) return;
				setCreating(true);
				setError("");
				setNotice("");
				try {
					const next = await postLanguage({ action: "create", entry: { title: L.languageNewTitle, prompt: "" } });
					setData(next);
					const created = next.entries[next.entries.length - 1];
					setSelectedId(created ? created.id : null);
				} catch (failure) {
					setError(errorDetails(failure).message || L.saveFailed);
				} finally {
					setCreating(false);
				}
			};

			const handleLocalChange = (id: string, next: { title: string; prompt: string }) => {
				setData((current) => current === null ? current : Object.assign({}, current, {
					entries: current.entries.map((entry) => entry.id === id ? Object.assign({}, entry, next) : entry),
				}));
			};

			const handleSaved = (saved: LanguageEntry) => {
				setData((current) => current === null ? current : Object.assign({}, current, {
					entries: current.entries.map((entry) => entry.id === saved.id ? saved : entry),
				}));
			};

			const handleDeleted = (response: LanguageState) => {
				setData(response);
				const remaining = response.entries;
				setSelectedId(remaining[0] ? remaining[0].id : null);
				setNotice(L.languageDeleteNotice);
			};

			const selected = entries.find((entry) => entry.id === selectedId) || null;

			return React.createElement("div", { style: managerStyles.page },
				React.createElement("div", { style: managerStyles.header },
					React.createElement("h2", { style: managerStyles.title }, L.languageManagerTitle),
					React.createElement("p", { style: managerStyles.intro }, L.languageManageIntro)),
				error ? React.createElement("div", { style: Object.assign({}, managerStyles.banner, managerStyles.error) }, error,
					data === null ? React.createElement("button", { type: "button", style: Object.assign({}, managerStyles.button, { marginLeft: "8px", height: "26px", color: "inherit" }), onClick: load }, L.retry) : null) : null,
				notice ? React.createElement("div", { style: managerStyles.banner }, notice) : null,
				data === null
					? React.createElement("div", { style: managerStyles.hint }, loading ? L.loading : L.languageLoadFailed)
					: React.createElement("div", { style: managerStyles.body },
						React.createElement("div", { style: managerStyles.list },
							React.createElement("div", { style: managerStyles.listScroll },
								entries.length === 0
									? React.createElement("div", { style: Object.assign({}, managerStyles.hint, { padding: "2px 9px" }) }, L.languageNoEntries)
									: entries.map((entry) => React.createElement(LanguageListRow, {
										key: entry.id,
										entry,
										selected: selectedId === entry.id,
										onSelect: () => { setSelectedId(entry.id); setNotice(""); },
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
								}, "+ " + L.languageAdd))),
						React.createElement("div", { style: managerStyles.editor },
							selected === null
								? React.createElement("div", { style: managerStyles.hint }, L.languageEmptySelection)
								: React.createElement(LanguageEntryEditor, {
									key: selected.id,
									entry: selected,
									onLocalChange: (next) => handleLocalChange(selected.id, next),
									onSaved: handleSaved,
									onDeleted: handleDeleted,
								}))));
		}

		function apply(ctx: ClientContext) {
			const face = {
				load: loadState,
				goal: (sessionId: string, value: string | null) => post(API.goal, sessionId, value),
				project: (sessionId: string, value: string | null) => post(API.project, sessionId, value),
			};
			const languageFace = {
				load: listLanguages,
				selection: (sessionId: string, ids: string[]) => postLanguageSelection(sessionId, ids),
				entry: (body: { action: string; id?: string; entry?: { title?: string; prompt?: string }; session?: string }) => postLanguage(body),
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
			// The language checklist sits beside the goal picker in both seats and
			// writes the same project-level backend.
			ctx.slots.inject("conversation.hero.options", () => ctx.slots.register({
				name: "conversation.hero.options",
				id: "mode-mod-language-picker",
				order: 1,
				inject: (sessionId) => ({ language: { ...languageFace }, seat: "hero" }),
			}, ModeModLanguagePicker));
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "mode-mod-language-switch",
				order: 1,
				inject: (sessionId) => ({ language: { ...languageFace }, seat: "header" }),
			}, ModeModLanguagePicker));
			// Settings page, right after the shipped "Agent 预设" section.
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "mode-mod-prompts",
				order: 25,
				label: () => L.manageTitle,
			}, PromptManagerSection));
			// The language entry manager follows the system-prompt manager.
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "mode-mod-languages",
				order: 26,
				label: () => L.languageManagerTitle,
			}, LanguageManagerSection));
		}

export { apply, toggleLanguageSelection };
export const inject = ['slots'];
