import { errorDetails } from "./errors.js";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, sep } from "node:path";
// src/store.ts
/**
* Project-default persistence for the system-prompt-preset (goal) dimension —
* one JSON document under plugin data.
*
* State file: $DSH_HOME/plugin/data/mode-mod/project-system-prompt-preset.json
* Shape: { version: 1, projects: { "<absolute project root>": "<goal id>" } }
* Written atomically (tmp file + rename). A missing or malformed file reads as
* "no project values" with a warning; it never blocks session creation.
*
* Project identity: the nearest ancestor holding .git of the session cwd,
* else the cwd itself. Lookup is longest-prefix, so a session opened in a
* subdirectory inherits the repository-level value.
* @module @local/dsh-mode-mod/store
*/
/** Storage version; a different version is ignored with a warning. */
const STORE_VERSION = 1;
/** Resolve the DSH home directory (same convention as other local plugins). */
function dshHome() {
	return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}
/** The plugin-owned data directory. */
function dataDir(home = dshHome()) {
	return join(home, "plugin", "data", "mode-mod");
}
/** The project-default document path. */
function storePath(home = dshHome()) {
	return join(dataDir(home), "project-system-prompt-preset.json");
}
/**
* The nearest ancestor of cwd holding .git, else cwd.
* @param cwd - a session working directory.
* @returns the project root to key values by.
*/
function resolveProjectRoot(cwd) {
	let dir = cwd;
	while (true) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return cwd;
		dir = parent;
	}
}
function emptyStore() {
	return {
		version: STORE_VERSION,
		projects: {}
	};
}
/**
* Read the store; malformed content degrades to empty with the reason.
* @param home - the DSH home root.
* @returns the parsed store.
*/
async function readStore(home = dshHome()) {
	try {
		const raw = await readFile(storePath(home), "utf8");
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
		if (parsed.version !== STORE_VERSION) throw new Error(`unsupported version ${parsed.version}`);
		if (parsed.projects === null || typeof parsed.projects !== "object" || Array.isArray(parsed.projects)) throw new Error("projects is not an object");
		return parsed;
	} catch (error) {
		if (errorDetails(error).code !== "ENOENT") console.warn(`mode-mod store: reading ${storePath(home)} failed (${errorDetails(error).message ?? error}); treating as empty`);
		return emptyStore();
	}
}
/**
* Persist the store atomically.
* @param store - the complete document.
* @param home - the DSH home root.
*/
async function writeStore(store, home = dshHome()) {
	const target = storePath(home);
	await mkdir(dirname(target), { recursive: true });
	const tmp = join(parse(target).dir, `.project-system-prompt-preset.${process.pid}.tmp`);
	await writeFile(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
	await rename(tmp, target);
}
/** True when candidate is root itself or a path underneath it. */
function isUnder(root, candidate) {
	return candidate === root || candidate.startsWith(root + sep);
}
/**
* Longest-prefix lookup of the project value for a resolved root.
* @param store - the parsed store.
* @param root - the resolved project root.
* @returns the goal id, or undefined when no ancestor declares one.
*/
function lookupProjectValue(store, root) {
	let best;
	for (const [key, value] of Object.entries(store.projects ?? {})) {
		if (typeof value !== "string") continue;
		if (isUnder(key, root) && (best === void 0 || key.length > best[0].length)) best = [key, value];
	}
	return best === void 0 ? void 0 : best[1];
}
/** The custom-system-prompt document path. */
function customPromptsPath(home = dshHome()) {
	return join(dataDir(home), "custom-system-prompts.json");
}
/** Field caps for one custom preset; mirrored by the settings page's maxLength attributes. */
const CUSTOM_PROMPT_LIMITS = Object.freeze({
	title: 80,
	description: 200,
	prompt: 65536
});
/** Custom preset ids are plugin-generated and never collide with the shipped goal ids. */
const CUSTOM_ID_PATTERN = /^custom-[0-9a-f]{12}$/;
/** An error the prompt routes map to a 4xx response. */
function presetError(code, message) {
	const error = new Error(message);
	error.code = code;
	return error;
}
/**
* Normalize one single-line field. Embedded newlines become spaces so a paste
* can never produce a second line; the caps match the UI's maxLength.
* @param value - the raw field value.
* @param label - the field name used in the error message.
* @param limit - the maximum character count.
* @returns the trimmed one-line text.
*/
function singleLine(value, label, limit) {
	if (value === void 0 || value === null) return "";
	if (typeof value !== "string") throw presetError("validation", label + " must be a string");
	const text = value.replace(/[\r\n]+/g, " ").trim();
	if (text.length > limit) throw presetError("validation", label + " exceeds " + String(limit) + " characters");
	return text;
}
/**
* Normalize the multi-line system prompt. Outer whitespace is dropped; inner
* formatting (headings, lists, blank lines) is preserved.
* @param value - the raw prompt text.
* @returns the trimmed prompt text.
*/
function promptText(value) {
	if (value === void 0 || value === null) return "";
	if (typeof value !== "string") throw presetError("validation", "system prompt must be a string");
	const text = value.replace(/\r\n/g, "\n").trim();
	if (text.length > CUSTOM_PROMPT_LIMITS.prompt) throw presetError("validation", "system prompt exceeds " + String(CUSTOM_PROMPT_LIMITS.prompt) + " characters");
	return text;
}
/**
* Validate the editable fields of one custom preset. Empty values are allowed:
* a fresh row is a draft until the user fills in a title and prompt.
* @param input - the request's preset payload.
* @param fallback - the current entry for a partial update.
* @returns the normalized title, description, and prompt.
*/
function normalizePreset(input, fallback = {}) {
	const source = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {};
	return {
		title: singleLine(source.title === void 0 ? fallback.title : source.title, "title", CUSTOM_PROMPT_LIMITS.title),
		description: singleLine(source.description === void 0 ? fallback.description : source.description, "description", CUSTOM_PROMPT_LIMITS.description),
		prompt: promptText(source.prompt === void 0 ? fallback.prompt : source.prompt)
	};
}
function emptyCustomPrompts() {
	return {
		version: STORE_VERSION,
		prompts: []
	};
}
/**
* Read the custom presets; malformed rows are skipped, a malformed document
* degrades to empty with a warning. Order is the creation order.
* @param home - the DSH home root.
* @returns the parsed document.
*/
async function readCustomPrompts(home = dshHome()) {
	try {
		const raw = await readFile(customPromptsPath(home), "utf8");
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
		if (parsed.version !== STORE_VERSION) throw new Error("unsupported version " + parsed.version);
		if (!Array.isArray(parsed.prompts)) throw new Error("prompts is not an array");
		const seen = /* @__PURE__ */ new Set();
		const prompts = [];
		for (const entry of parsed.prompts) {
			if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
			if (typeof entry.id !== "string" || !CUSTOM_ID_PATTERN.test(entry.id) || seen.has(entry.id)) continue;
			seen.add(entry.id);
			prompts.push({
				id: entry.id,
				title: typeof entry.title === "string" ? entry.title : "",
				description: typeof entry.description === "string" ? entry.description : "",
				prompt: typeof entry.prompt === "string" ? entry.prompt : "",
				createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0,
				updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0
			});
		}
		return {
			version: STORE_VERSION,
			prompts
		};
	} catch (error) {
		if (errorDetails(error).code !== "ENOENT") console.warn("mode-mod store: reading " + customPromptsPath(home) + " failed (" + (errorDetails(error).message ?? error) + "); treating as empty");
		return emptyCustomPrompts();
	}
}
/**
* Persist the custom presets atomically.
* @param doc - the complete document.
* @param home - the DSH home root.
*/
async function writeCustomPrompts(doc, home) {
	const target = customPromptsPath(home);
	await mkdir(dirname(target), { recursive: true });
	const tmp = join(parse(target).dir, ".custom-system-prompts." + process.pid + ".tmp");
	await writeFile(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
	await rename(tmp, target);
}
/**
* Append one custom preset with a generated id.
* @param input - the editable fields (all optional).
* @param home - the DSH home root.
* @returns the new document and the created entry.
*/
async function createCustomPrompt(input, home = dshHome()) {
	const doc = await readCustomPrompts(home);
	const preset = normalizePreset(input);
	let id;
	do
		id = "custom-" + randomBytes(6).toString("hex");
	while (doc.prompts.some((entry) => entry.id === id));
	const now = Date.now();
	const entry = {
		id,
		...preset,
		createdAt: now,
		updatedAt: now
	};
	doc.prompts.push(entry);
	await writeCustomPrompts(doc, home);
	return {
		doc,
		entry
	};
}
/**
* Update one custom preset. Missing fields keep their current value, so the
* auto-save request may send the whole draft or only a subset.
* @param id - the custom preset id.
* @param input - the editable fields.
* @param home - the DSH home root.
* @returns the new document and the updated entry.
*/
async function updateCustomPrompt(id, input, home = dshHome()) {
	const doc = await readCustomPrompts(home);
	const index = doc.prompts.findIndex((entry) => entry.id === id);
	if (index === -1) throw presetError("not-found", "unknown custom preset: " + id);
	const preset = normalizePreset(input, doc.prompts[index]);
	const entry = {
		...doc.prompts[index],
		...preset,
		updatedAt: Date.now()
	};
	doc.prompts[index] = entry;
	await writeCustomPrompts(doc, home);
	return {
		doc,
		entry
	};
}
/**
* Remove one custom preset.
* @param id - the custom preset id.
* @param home - the DSH home root.
* @returns the new document and the removed entry.
*/
async function deleteCustomPrompt(id, home = dshHome()) {
	const doc = await readCustomPrompts(home);
	const index = doc.prompts.findIndex((entry) => entry.id === id);
	if (index === -1) throw presetError("not-found", "unknown custom preset: " + id);
	const [removed] = doc.prompts.splice(index, 1);
	await writeCustomPrompts(doc, home);
	return {
		doc,
		removed
	};
}
/**
* Retire one deleted preset for the sessions that were using it: the stored
* selection becomes null (the key is removed) while the deleted text is kept
* under `retired`, so a resumed session keeps the system prompt it already
* committed until the user explicitly selects another preset.
* @param records - session id to { id, title, text } record.
* @param home - the DSH home root.
* @returns the document after the update.
*/
async function retireSessionValues(records, home = dshHome()) {
	const doc = await readSessionOverrides(home);
	if (records.size === 0) return doc;
	for (const [sessionId, retired] of records) {
		delete doc.sessions[sessionId];
		doc.retired[sessionId] = {
			id: retired.id,
			title: retired.title,
			text: retired.text
		};
	}
	await writeSessionOverrides(doc, home);
	return doc;
}
/**
* Clear every project default equal to one preset id, so the project tier
* inherits again instead of pinning a missing preset.
* @param value - the preset id to clear.
* @param home - the DSH home root.
* @returns the store after the update.
*/
async function clearProjectValues(value, home = dshHome()) {
	const store = await readStore(home);
	let changed = false;
	for (const [root, current] of Object.entries(store.projects)) {
		if (current !== value) continue;
		delete store.projects[root];
		changed = true;
	}
	if (changed) await writeStore(store, home);
	return store;
}
/** The session-override document path. */
function sessionOverridesPath(home = dshHome()) {
	return join(dataDir(home), "session-goal-overrides.json");
}
/**
* Read the session-goal overrides; malformed content degrades to empty.
* Shape: {
*   version: 1,
*   sessions: { "<session id>": "<goal id>" | "none" },
*   retired: { "<session id>": { id, title, text } },
* }
* ("none" = explicitly no goal; absent = not selected, inherits). Older
* documents stored null for an explicit none — migrated to "none" on read.
* `retired` is the deleted-preset freeze: the session has no selection, but
* its committed prompt text is kept until an explicit pick replaces it.
* @param home - the DSH home root.
* @returns the parsed document.
*/
async function readSessionOverrides(home = dshHome()) {
	try {
		const raw = await readFile(sessionOverridesPath(home), "utf8");
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
		if (parsed.version !== STORE_VERSION) throw new Error("unsupported version " + parsed.version);
		if (parsed.sessions === null || typeof parsed.sessions !== "object" || Array.isArray(parsed.sessions)) throw new Error("sessions is not an object");
		for (const key of Object.keys(parsed.sessions)) if (parsed.sessions[key] === null) parsed.sessions[key] = "none";
		const retired = {};
		if (parsed.retired !== null && typeof parsed.retired === "object" && !Array.isArray(parsed.retired)) for (const [sessionId, entry] of Object.entries(parsed.retired)) {
			if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
			if (typeof entry.id !== "string" || typeof entry.title !== "string" || typeof entry.text !== "string") continue;
			retired[sessionId] = {
				id: entry.id,
				title: entry.title,
				text: entry.text
			};
		}
		parsed.retired = retired;
		return parsed;
	} catch (error) {
		if (errorDetails(error).code !== "ENOENT") console.warn("mode-mod store: reading " + sessionOverridesPath(home) + " failed (" + (errorDetails(error).message ?? error) + "); treating as empty");
		return {
			version: STORE_VERSION,
			sessions: {},
			retired: {}
		};
	}
}
/**
* Set, change, or clear one session's goal override and persist atomically.
* @param sessionId - the top-level session id.
* @param value - a goal id or "none" (explicit no goal); null or undefined
*   deletes the entry — the session is no longer selected and inherits again.
* @param home - the DSH home root.
* @returns the document after the update.
*/
async function setSessionOverride(sessionId, value, home = dshHome()) {
	const doc = await readSessionOverrides(home);
	if (value === null || value === void 0) delete doc.sessions[sessionId];
	else doc.sessions[sessionId] = value;
	if (doc.retired[sessionId] !== void 0) delete doc.retired[sessionId];
	await writeSessionOverrides(doc, home);
	return doc;
}
/**
* Persist the session values atomically.
* @param doc - the complete document.
* @param home - the DSH home root.
*/
async function writeSessionOverrides(doc, home) {
	const target = sessionOverridesPath(home);
	await mkdir(dirname(target), { recursive: true });
	const tmp = join(parse(target).dir, ".session-goal-overrides." + process.pid + ".tmp");
	await writeFile(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
	await rename(tmp, target);
}
/**
* Set or clear one project's value and persist.
* @param root - the resolved project root.
* @param value - a goal id or "none" (explicit no goal, blocks the global
*   tier); null deletes the entry so the project inherits again.
* @param home - the DSH home root.
* @returns the store after the update.
*/
async function setProjectValue(root, value, home = dshHome()) {
	const store = await readStore(home);
	if (value === null) delete store.projects[root];
	else store.projects[root] = value;
	await writeStore(store, home);
	return store;
}
/** Field caps for one language entry; mirrored by the manager's maxLength attributes. */
const LANGUAGE_LIMITS = Object.freeze({
	title: 80,
	prompt: 65536
});
/** Language entry ids are plugin-generated. */
const LANGUAGE_ID_PATTERN = /^lang-[0-9a-f]{12}$/;
/** The language entry document path. */
function languageEntriesPath(home = dshHome()) {
	return join(dataDir(home), "language-requirements.json");
}
/** The per-project selection document path. */
function languageProjectsPath(home = dshHome()) {
	return join(dataDir(home), "project-language-requirements.json");
}
function emptyLanguageDocument() {
	return {
		version: STORE_VERSION,
		entries: []
	};
}
/**
* Read the language entries; malformed rows are skipped and a malformed
* document degrades to empty with a warning. Order is the creation order.
* @param home - the DSH home root.
* @returns the parsed document.
*/
async function readLanguageEntries(home = dshHome()) {
	try {
		const raw = await readFile(languageEntriesPath(home), "utf8");
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
		if (parsed.version !== STORE_VERSION) throw new Error("unsupported version " + parsed.version);
		if (!Array.isArray(parsed.entries)) throw new Error("entries is not an array");
		const seen = /* @__PURE__ */ new Set();
		const entries = [];
		for (const entry of parsed.entries) {
			if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
			if (typeof entry.id !== "string" || !LANGUAGE_ID_PATTERN.test(entry.id) || seen.has(entry.id)) continue;
			seen.add(entry.id);
			entries.push({
				id: entry.id,
				title: typeof entry.title === "string" ? entry.title : "",
				prompt: typeof entry.prompt === "string" ? entry.prompt : "",
				version: typeof entry.version === "number" && Number.isSafeInteger(entry.version) && entry.version > 0 ? entry.version : 1,
				createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0,
				updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0
			});
		}
		return {
			version: STORE_VERSION,
			entries
		};
	} catch (error) {
		if (errorDetails(error).code !== "ENOENT") console.warn("mode-mod store: reading " + languageEntriesPath(home) + " failed (" + (errorDetails(error).message ?? error) + "); treating as empty");
		return emptyLanguageDocument();
	}
}
/**
* Persist the language entries atomically.
* @param doc - the complete document.
* @param home - the DSH home root.
*/
async function writeLanguageEntries(doc, home) {
	const target = languageEntriesPath(home);
	await mkdir(dirname(target), { recursive: true });
	const tmp = join(parse(target).dir, ".language-requirements." + process.pid + ".tmp");
	await writeFile(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
	await rename(tmp, target);
}
/**
* Normalize the multi-line requirement body. Outer whitespace is dropped;
* inner formatting (headings, lists, blank lines) is preserved.
* @param value - the raw body.
* @returns the trimmed text.
*/
function requirementText(value) {
	if (value === void 0 || value === null) return "";
	if (typeof value !== "string") throw presetError("validation", "requirement text must be a string");
	const text = value.replace(/\r\n/g, "\n").trim();
	if (text.length > LANGUAGE_LIMITS.prompt) throw presetError("validation", "requirement text exceeds " + String(LANGUAGE_LIMITS.prompt) + " characters");
	return text;
}
/**
* Validate the editable fields of one entry. Empty values are allowed: a fresh
* row is a draft until both its title and body are filled in.
* @param input - the request's entry payload.
* @param fallback - the current entry for a partial update.
* @returns the normalized title and requirement text.
*/
function normalizeLanguageEntry(input, fallback = {}) {
	const source = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {};
	return {
		title: singleLine(source.title === void 0 ? fallback.title : source.title, "title", LANGUAGE_LIMITS.title),
		prompt: requirementText(source.prompt === void 0 ? fallback.prompt : source.prompt)
	};
}
/**
* Append one language entry with a generated id and version 1.
* @param input - the editable fields (all optional).
* @param home - the DSH home root.
* @returns the new document and the created entry.
*/
async function createLanguageEntry(input, home = dshHome()) {
	const doc = await readLanguageEntries(home);
	const normalized = normalizeLanguageEntry(input);
	let id;
	do
		id = "lang-" + randomBytes(6).toString("hex");
	while (doc.entries.some((entry) => entry.id === id));
	const now = Date.now();
	const entry = {
		id,
		...normalized,
		version: 1,
		createdAt: now,
		updatedAt: now
	};
	doc.entries.push(entry);
	await writeLanguageEntries(doc, home);
	return {
		doc,
		entry
	};
}
/**
* Update one language entry. Missing fields keep their current value, so the
* auto-save request may send the whole draft or only a subset. The version
* advances only when the normalized body actually changes.
* @param id - the language entry id.
* @param input - the editable fields.
* @param home - the DSH home root.
* @returns the new document, the updated entry, and whether its body changed.
*/
async function updateLanguageEntry(id, input, home = dshHome()) {
	const doc = await readLanguageEntries(home);
	const index = doc.entries.findIndex((entry) => entry.id === id);
	if (index === -1) throw presetError("not-found", "unknown language entry: " + id);
	const current = doc.entries[index];
	const normalized = normalizeLanguageEntry(input, current);
	const bodyChanged = normalized.prompt !== current.prompt;
	const titleChanged = normalized.title !== current.title;
	const entry = {
		...current,
		...normalized,
		version: current.version + (bodyChanged ? 1 : 0),
		updatedAt: bodyChanged || titleChanged ? Date.now() : current.updatedAt
	};
	doc.entries[index] = entry;
	await writeLanguageEntries(doc, home);
	return {
		doc,
		entry,
		bodyChanged
	};
}
/**
* Remove one language entry.
* @param id - the language entry id.
* @param home - the DSH home root.
* @returns the new document and the removed entry.
*/
async function deleteLanguageEntry(id, home = dshHome()) {
	const doc = await readLanguageEntries(home);
	const index = doc.entries.findIndex((entry) => entry.id === id);
	if (index === -1) throw presetError("not-found", "unknown language entry: " + id);
	const [removed] = doc.entries.splice(index, 1);
	await writeLanguageEntries(doc, home);
	return {
		doc,
		removed
	};
}
/**
* Read the per-project selections; malformed rows are skipped and a malformed
* document degrades to empty. Ids that do not match the entry format are
* dropped, so a hand-edited document cannot make the engine look up garbage.
* @param home - the DSH home root.
* @returns the parsed document.
*/
async function readLanguageProjects(home = dshHome()) {
	try {
		const raw = await readFile(languageProjectsPath(home), "utf8");
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
		if (parsed.version !== STORE_VERSION) throw new Error("unsupported version " + parsed.version);
		if (parsed.projects === null || typeof parsed.projects !== "object" || Array.isArray(parsed.projects)) throw new Error("projects is not an object");
		const projects = {};
		for (const [root, value] of Object.entries(parsed.projects)) {
			if (!Array.isArray(value)) continue;
			const ids = [];
			for (const id of value) {
				if (typeof id !== "string" || !LANGUAGE_ID_PATTERN.test(id) || ids.includes(id)) continue;
				ids.push(id);
			}
			if (ids.length > 0) projects[root] = ids;
		}
		return {
			version: STORE_VERSION,
			projects
		};
	} catch (error) {
		if (errorDetails(error).code !== "ENOENT") console.warn("mode-mod store: reading " + languageProjectsPath(home) + " failed (" + (errorDetails(error).message ?? error) + "); treating as empty");
		return {
			version: STORE_VERSION,
			projects: {}
		};
	}
}
/**
* Persist the project selections atomically.
* @param store - the complete document.
* @param home - the DSH home root.
*/
async function writeLanguageProjects(store, home) {
	const target = languageProjectsPath(home);
	await mkdir(dirname(target), { recursive: true });
	const tmp = join(parse(target).dir, ".project-language-requirements." + process.pid + ".tmp");
	await writeFile(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
	await rename(tmp, target);
}
/**
* Replace one project's multi-selection. Empty selections delete the entry
* instead of storing an empty list.
* @param root - the resolved project root.
* @param ids - the selected entry ids, in display order.
* @param home - the DSH home root.
* @returns the store after the update.
*/
async function setProjectLanguages(root, ids, home = dshHome()) {
	const store = await readLanguageProjects(home);
	const next = [];
	for (const id of ids) {
		if (typeof id !== "string" || !LANGUAGE_ID_PATTERN.test(id) || next.includes(id)) continue;
		next.push(id);
	}
	if (next.length === 0) delete store.projects[root];
	else store.projects[root] = next;
	await writeLanguageProjects(store, home);
	return store;
}
/**
* Remove one entry id from every project's selection (entry deletion).
* @param id - the deleted language entry id.
* @param home - the DSH home root.
* @returns the store after the update.
*/
async function clearLanguageSelections(id, home = dshHome()) {
	const store = await readLanguageProjects(home);
	let changed = false;
	for (const [root, ids] of Object.entries(store.projects)) {
		const next = ids.filter((value) => value !== id);
		if (next.length === ids.length) continue;
		changed = true;
		if (next.length === 0) delete store.projects[root];
		else store.projects[root] = next;
	}
	if (changed) await writeLanguageProjects(store, home);
	return store;
}
export { CUSTOM_PROMPT_LIMITS, LANGUAGE_LIMITS, clearLanguageSelections, clearProjectValues, createCustomPrompt, createLanguageEntry, customPromptsPath, dataDir, deleteCustomPrompt, deleteLanguageEntry, dshHome, languageEntriesPath, languageProjectsPath, lookupProjectValue, readCustomPrompts, readLanguageEntries, readLanguageProjects, readSessionOverrides, readStore, resolveProjectRoot, retireSessionValues, sessionOverridesPath, setProjectLanguages, setProjectValue, setSessionOverride, storePath, updateCustomPrompt, updateLanguageEntry, writeStore };

//# sourceMappingURL=store.js.map