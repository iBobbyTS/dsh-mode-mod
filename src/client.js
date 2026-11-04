/* Browser half of dsh-mode-mod. Occupies conversation.hero.options — the
 * plugin controls of the New Session row, right after the agent-preset
 * (mode) control — for the system-prompt-preset dimension: a goal dropdown
 * (none + the seven development goals) writing the SESSION tier through
 * POST /api/mode-mod/goal. The dropdown is the host's own idiom — Menu plus
 * icons from dsh-client-ui-primitives (a PLATFORM_MODULES baseline row every
 * dynamic bundle may require) — with the trigger styled like the official
 * agent-preset seat button; no native <select>. The PROJECT tier is managed
 * through the trigger's context menu (right click: set current goal as the
 * project default / clear it); the GLOBAL tier lives in the plugin's bundle
 * config. The mode dimension stays with the shipped preset picker. Wrapped
 * in an IIFE so nothing leaks into the page. */
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
			set: "设为项目默认",
			clear: "清除项目默认",
			menuHint: "右键设置项目默认",
		} : {
			goal: "System-prompt preset",
			none: "None",
			noneDesc: "Layer no goal text onto the system prompt",
			session: "session",
			project: "project default",
			globalTier: "global default",
			inherit: "(inherited)",
			set: "Set as project default",
			clear: "Clear project default",
			menuHint: "right click for project default",
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

		function tierName(state) {
			if (state.sessionValue !== null) return state.sessionValueName;
			if (state.projectValue !== null) return (state.projectValueName ?? L.none) + " " + L.inherit;
			if (state.globalValue !== null) return (state.globalValueName ?? L.none) + " " + L.inherit;
			return L.none;
		}

		/* One menu row, mirroring the official agent-preset menu: name over
		 * description, two lines (inline styles mirror AgentPresetSeat.module.css
		 * .item/.itemName/.itemDesc). */
		function menuRow(name, description) {
			return React.createElement("span", {
				style: { display: "flex", flexDirection: "column", gap: "2px", maxWidth: "280px" },
			},
				React.createElement("span", { style: { fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-primary)" } }, name),
				React.createElement("span", { style: { fontSize: "12px", lineHeight: "16px", color: "var(--dsw-alias-label-caption)", whiteSpace: "normal" } }, description));
		}

		const NONE_ID = "__none__";

		function ModeModGoalPicker({ sessionId, modeMod }) {
			const [state, setState] = useState(null);
			const [busy, setBusy] = useState(false);
			const [goalOpen, setGoalOpen] = useState(false);
			const [projectOpen, setProjectOpen] = useState(false);
			const [hover, setHover] = useState(false);
			const buttonRef = useRef(null);

			useEffect(() => {
				let alive = true;
				let attempts = 0;
				const attempt = () => {
					if (!alive) return;
					modeMod.load(sessionId).then((next) => {
						if (!alive) return;
						setState(next);
						// The header can mount before the host registers the fresh
						// session (agent/created race); retry briefly instead of
						// hiding forever.
						if (next.known !== true && attempts++ < 8) setTimeout(attempt, 500);
					}).catch(() => { if (alive) setState({ known: false }); });
				};
				attempt();
				return () => { alive = false; };
			}, [sessionId, modeMod]);

			if (state === null || state.known !== true) return null;

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

			const title = L.goal + " · " + L.session + ": " + tierName(state)
				+ " | " + L.project + ": " + (state.projectValueName ?? L.none)
				+ " | " + L.globalTier + ": " + (state.globalValueName ?? L.none)
				+ "  ·  " + L.menuHint;

			/* Seat-button geometry mirrors AgentPresetSeat.module.css .seat; hover
			 * and open fill need a state because inline styles cannot express
			 * :hover / [aria-expanded]. */
			const trigger = React.createElement("button", {
				type: "button",
				ref: (node) => { buttonRef.current = node; alignBesideModeControl(node); },
				onClick: () => { setProjectOpen(false); setGoalOpen((open) => !open); },
				onContextMenu: (event) => {
					event.preventDefault();
					event.stopPropagation();
					setGoalOpen(false);
					setProjectOpen(true);
				},
				onMouseEnter: () => setHover(true),
				onMouseLeave: () => setHover(false),
				disabled: busy,
				"aria-haspopup": "menu",
				"aria-expanded": goalOpen,
				"aria-label": L.goal,
				title,
				style: {
					display: "inline-flex", alignItems: "center", gap: "4px",
					minHeight: "28px", padding: "0 8px", border: "none",
					borderRadius: "var(--dsw-radius-sm)",
					background: hover || goalOpen ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
					color: busy ? "var(--dsw-alias-label-quaternary)" : "var(--dsw-alias-label-primary)",
					fontSize: "13px", lineHeight: "20px", fontWeight: 500,
					whiteSpace: "nowrap", cursor: busy ? "default" : "pointer",
					maxWidth: "min(100%, 240px)", marginLeft: "6px",
				},
			},
				React.createElement(IconGoalOutlineRegular, { key: "icon" }),
				React.createElement("span", {
					key: "label",
					style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
				}, state.effectiveGoalName ?? L.none),
				React.createElement("span", {
					key: "chevron",
					style: { flex: "none", display: "inline-flex", color: "var(--dsw-alias-label-caption)" },
				}, React.createElement(IconChevronDownOutlineRegular, null)));

			const goalItems = [{ id: NONE_ID, label: menuRow(L.none, L.noneDesc) }]
				.concat((state.goals ?? []).map((goal) => ({
					id: goal.id,
					label: menuRow(goal.name, goalDescription(goal.id, goal.description)),
				})));

			const projectItems = [];
			if (state.effectiveGoal !== null) {
				projectItems.push({ id: "set", label: L.set + " (" + (state.effectiveGoalName ?? "") + ")" });
			}
			if (state.projectValue !== null) {
				projectItems.push({ type: "separator", id: "sep" });
				projectItems.push({ id: "clear", label: L.clear + " (" + (state.projectValueName ?? "") + ")" });
			}

			return React.createElement(React.Fragment, null,
				React.createElement(Menu, {
					open: goalOpen,
					onClose: () => setGoalOpen(false),
					items: goalItems,
					selectedId: state.effectiveGoal ?? NONE_ID,
					onSelect: (id) => { setGoalOpen(false); void pick(id === NONE_ID ? null : id); },
					align: "start",
					portal: true,
					anchor: trigger,
				}),
				projectOpen && projectItems.length > 0 && React.createElement(Menu, {
					open: true,
					onClose: () => setProjectOpen(false),
					items: projectItems,
					onSelect: (id) => {
						setProjectOpen(false);
						if (id === "set") void runProject(state.effectiveGoal);
						if (id === "clear") void runProject(null);
					},
					align: "start",
					portal: true,
					anchor: null,
					getAnchorRect: () => buttonRef.current === null ? null : buttonRef.current.getBoundingClientRect(),
				}));
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
				inject: (sessionId) => ({ modeMod: { ...face, labels: L } }),
			}, ModeModGoalPicker));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
})();
