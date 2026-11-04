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
		};

		function resolveApiUrl(path) {
			if (typeof document === "undefined") return path;
			try { return new URL(path.replace(/^\//, ""), document.baseURI).href; } catch { return path; }
		}

		async function fetchJson(url, init) {
			const response = await fetch(resolveApiUrl(url), init);
			if (!response.ok) throw new Error("HTTP " + response.status);
			return await response.json();
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

		const ZH = (typeof navigator !== "undefined" && String(navigator.language || "").toLowerCase().startsWith("zh"));
		const L = ZH ? {
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
		} : {
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
		};

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
			return (ZH && ZH_GOAL_DESCRIPTIONS[id]) || fallback;
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
			// "header" is the in-session seat beside the mode chip: a switch only.
			const headerSeat = seat === "header";
			const [state, setState] = useState(null);
			const [busy, setBusy] = useState(false);
			const [goalOpen, setGoalOpen] = useState(false);
			const [hover, setHover] = useState(false);
			const [starHover, setStarHover] = useState(undefined);
			const buttonRef = useRef(null);

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
				onClick: () => setGoalOpen((open) => !open),
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
				}, state.effectiveGoalName ?? L.none),
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
				selectedId: state.effectiveGoal ?? NONE_ID,
				onSelect: (id) => { setGoalOpen(false); void pick(id === NONE_ID ? "none" : id); },
				align: headerSeat ? "end" : "start",
				portal: true,
				anchor: trigger,
			});
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
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
})();
