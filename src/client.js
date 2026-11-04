/* Browser half of dsh-mode-mod. Occupies conversation.hero.options — the
 * plugin controls of the New Session row, right after the agent-preset
 * (mode) control — for the system-prompt-preset dimension:
 * a goal <select> (none + the seven development goals) writing the SESSION
 * tier through POST /api/mode-mod/goal. The PROJECT tier is managed through
 * the select's context menu (right click: set current goal as the project
 * default / clear it); the GLOBAL tier lives in the plugin's bundle config.
 * The mode dimension stays with the shipped preset picker. Wrapped in an
 * IIFE so nothing leaks into the page. */
(function () {
window.__ModuleLoader__.load({
	id: "@local/dsh-mode-mod",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const { useEffect, useState } = React;

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
			session: "session",
			project: "project default",
			globalTier: "global default",
			inherit: "(inherited)",
			set: "Set as project default",
			clear: "Clear project default",
			menuHint: "right click for project default",
		};

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

		function ModeModGoalPicker({ sessionId, modeMod }) {
			const [state, setState] = useState(null);
			const [busy, setBusy] = useState(false);
			const [menu, setMenu] = useState(null);

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

			useEffect(() => {
				if (menu === null) return undefined;
				const close = () => setMenu(null);
				window.addEventListener("click", close);
				window.addEventListener("resize", close);
				window.addEventListener("keydown", close);
				return () => {
					window.removeEventListener("click", close);
					window.removeEventListener("resize", close);
					window.removeEventListener("keydown", close);
				};
			}, [menu]);

			if (state === null || state.known !== true) return null;
			const title = L.goal + " · " + L.session + ": " + tierName(state)
				+ " | " + L.project + ": " + (state.projectValueName ?? L.none)
				+ " | " + L.globalTier + ": " + (state.globalValueName ?? L.none)
				+ "  ·  " + L.menuHint;
			const onChange = async (event) => {
				if (busy) return;
				const value = event.target.value === "" ? null : event.target.value;
				setBusy(true);
				try { setState(await modeMod.goal(sessionId, value)); } catch {} finally { setBusy(false); }
			};
			const onContextMenu = (event) => {
				event.preventDefault();
				event.stopPropagation();
				setMenu({ x: event.clientX, y: event.clientY });
			};
			const runProject = async (value) => {
				setMenu(null);
				if (busy) return;
				setBusy(true);
				try { setState(await modeMod.project(sessionId, value)); } catch {} finally { setBusy(false); }
			};
			const menuItems = [];
			if (state.effectiveGoal !== null) {
				menuItems.push(React.createElement("button", {
					type: "button", key: "set",
					onClick: () => runProject(state.effectiveGoal),
					style: { display: "block", width: "100%", background: "transparent", border: "none", padding: "6px 14px", font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left", whiteSpace: "nowrap" },
				}, L.set + " (" + (state.effectiveGoalName ?? "") + ")"));
			}
			if (state.projectValue !== null) {
				menuItems.push(React.createElement("button", {
					type: "button", key: "clear",
					onClick: () => runProject(null),
					style: { display: "block", width: "100%", background: "transparent", border: "none", padding: "6px 14px", font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left", whiteSpace: "nowrap" },
				}, L.clear + " (" + (state.projectValueName ?? "") + ")"));
			}
			return React.createElement(React.Fragment, null,
				React.createElement("select", {
					ref: alignBesideModeControl,
					value: state.effectiveGoal ?? "",
					onChange,
					onContextMenu,
					disabled: busy,
					"aria-label": L.goal,
					title,
					style: {
						background: "transparent", border: "1px solid rgba(128,128,128,.45)", borderRadius: "4px",
						padding: "1px 2px", font: "inherit", color: "inherit", cursor: busy ? "wait" : "pointer",
						maxWidth: "9em", marginLeft: "6px",
					},
				},
					React.createElement("option", { value: "" }, L.none),
					(state.goals ?? []).map((goal) => React.createElement("option", { key: goal.id, value: goal.id }, goal.name))),
				menu !== null && menuItems.length > 0 && React.createElement("div", {
					style: {
						position: "fixed", left: menu.x + "px", top: menu.y + "px", zIndex: 9999,
						background: "var(--dsh-bg-elevated, #2a2a2a)", color: "inherit",
						border: "1px solid rgba(128,128,128,.5)", borderRadius: "6px",
						boxShadow: "0 4px 16px rgba(0,0,0,.35)", padding: "4px 0", minWidth: "12em",
					},
					onClick: (event) => event.stopPropagation(),
					onContextMenu: (event) => { event.preventDefault(); event.stopPropagation(); },
				}, menuItems));
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