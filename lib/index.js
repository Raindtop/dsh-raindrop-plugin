/**
 * dsh-raindrop-plugin, node half.
 *
 * Three small authenticated same-origin routes back the browser half:
 *
 * - The date view needs each Session's creation instant to offer "show the
 *   first conversation date"; the client-side session list only carries
 *   `updatedAt`, so this half reads durable headers through the public
 *   `sessionQuery` service and serves a tiny id → createdAt map.
 * - The sidebar version row shows the latest published DSH release next to the
 *   running one. The browser cannot read the npm registry package endpoint
 *   reliably (CORS/proxy/offline), so the Host fetches and caches it here.
 * - The session git-version feature records the branch each Session was created
 *   on and restores it when the Session is opened. The browser cannot run git,
 *   so this half captures the branch at `session/created` (backfilling
 *   historical Sessions on first sight), serves the id → branch map plus the
 *   current branch of every referenced working directory, and runs the
 *   explicit "switch back" behind the same cookie gate.
 *
 * Everything else stays in lib/client.js.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { hasBranch, isClean, readHead, switchBranch } from "./git.js";

/** Exact path the browser half fetches for creation instants. */
const ROUTE = "/session-date/dates";

/** How long one collected map is reused before the next request re-reads headers. */
const CACHE_MS = 15000;

/** How long one branch map is reused; shorter than the date map so a manual checkout shows up quickly. */
const GIT_CACHE_MS = 5000;

/** Authenticated route serving the latest published `@deepseek-ai/dsh` version. */
const VERSION_ROUTE = "/dsh-version/latest";

/** npm manifest endpoint for the current `latest` dist-tag. */
const NPM_LATEST = "https://registry.npmjs.org/@deepseek-ai/dsh/latest";

/** How long one successful latest-version read is reused. */
const VERSION_CACHE_MS = 10 * 60 * 1000;

/** How long a failed latest-version read is reused before retrying. */
const VERSION_FAILURE_CACHE_MS = 60 * 1000;

/** Deadline for one npm registry request. */
const VERSION_TIMEOUT_MS = 8000;

/** Authenticated route serving Session id → branch and each directory's current branch. */
const GIT_ROUTE = "/session-git/branches";

/** Authenticated route that switches one Session's directory back to its recorded branch. */
const GIT_RESTORE_ROUTE = "/session-git/restore";

/** Durable file under `$DSH_HOME/storages` holding the id → branch map. */
const GIT_STORE_FILE = "raindrop-plugin-session-git.json";

/** Largest accepted restore request body, in bytes. */
const GIT_BODY_LIMIT = 4096;

/** How long one directory's current branch is reused. */
const CURRENT_TTL_MS = 10000;

/** How long a failed branch capture is remembered before retrying. */
const CAPTURE_RETRY_MS = 10 * 60 * 1000;

/** Required Host services: the named-route registry and the browser auth gate. */
export const inject = ["webServer", "connection"];

/**
 * Write one JSON response.
 * @param res - response owning the request lifecycle.
 * @param status - HTTP status.
 * @param body - JSON-serializable payload.
 */
function sendJson(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(body));
}

/**
 * Mount the creation-time, latest-version, and session git routes.
 * The creation map is small (one number per Session) and only addresses
 * Sessions the authenticated browser already lists; it never returns titles,
 * prompts, or paths. The version route returns one public version string. The
 * git routes expose branch names only, and the restore route can only switch a
 * directory to a branch this plugin already recorded for that Session.
 * @param ctx - Host context with `webServer` and `connection` injected.
 */
export function apply(ctx) {
	let cache;
	let versionCache;

	/**
	 * Read every visible Session header and keep the creation instants.
	 * @returns wire body `{ sessions: { [id]: createdAt }, fetchedAt }`.
	 */
	const collect = async () => {
		const query = ctx.get("sessionQuery");
		if (query === undefined) return { sessions: {}, unavailable: "session-query" };
		const records = await query.listSessions();
		const sessions = {};
		for (const record of records) {
			const header = record?.header;
			if (header === undefined) continue;
			if (typeof header.id !== "string" || !Number.isFinite(header.createdAt)) continue;
			sessions[header.id] = header.createdAt;
		}
		return { sessions, fetchedAt: Date.now() };
	};

	/**
	 * Read the `latest` dist-tag of `@deepseek-ai/dsh` from npm.
	 * @returns the published version string.
	 * @throws when the registry is unreachable or returns no usable version.
	 */
	const readLatestVersion = async () => {
		const response = await fetch(NPM_LATEST, {
			headers: { accept: "application/json", "user-agent": "dsh-raindrop-plugin" },
			signal: AbortSignal.timeout(VERSION_TIMEOUT_MS),
		});
		if (!response.ok) throw new Error(`npm registry HTTP ${response.status}`);
		const body = await response.json();
		const version = body?.version;
		if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
			throw new Error("npm registry returned no usable version");
		}
		return version;
	};

	/**
	 * Serve `GET /session-date/dates` behind the browser session cookie.
	 * @param req - incoming request.
	 * @param res - response owning the request lifecycle.
	 */
	const handler = async (req, res) => {
		if (req.method !== "GET") {
			res.writeHead(405, { allow: "GET" });
			res.end();
			return;
		}
		if (!ctx.connection.authorizeIndex(req, res)) return;
		if (cache !== undefined && Date.now() - cache.at < CACHE_MS) {
			sendJson(res, 200, cache.body);
			return;
		}
		try {
			const body = await collect();
			cache = { at: Date.now(), body };
			sendJson(res, 200, body);
		} catch (error) {
			ctx.logger.warn(`dsh-raindrop-plugin: session list read failed: ${String(error)}`);
			sendJson(res, 500, { sessions: {}, error: "session list unavailable" });
		}
	};

	/**
	 * Serve `GET /dsh-version/latest` behind the browser session cookie. A stale
	 * successful read is preferred over an error so an offline page keeps showing
	 * the last known release.
	 * @param req - incoming request.
	 * @param res - response owning the request lifecycle.
	 */
	const versionHandler = async (req, res) => {
		if (req.method !== "GET") {
			res.writeHead(405, { allow: "GET" });
			res.end();
			return;
		}
		if (!ctx.connection.authorizeIndex(req, res)) return;
		const now = Date.now();
		if (versionCache !== undefined) {
			const ttl = versionCache.body.latest === null ? VERSION_FAILURE_CACHE_MS : VERSION_CACHE_MS;
			if (now - versionCache.at < ttl) {
				sendJson(res, 200, versionCache.body);
				return;
			}
		}
		try {
			const body = { latest: await readLatestVersion(), checkedAt: Date.now() };
			versionCache = { at: Date.now(), body };
			sendJson(res, 200, body);
		} catch (error) {
			ctx.logger.warn(`dsh-raindrop-plugin: latest version check failed: ${String(error)}`);
			if (versionCache?.body.latest !== null && versionCache?.body.latest !== undefined) {
				const body = { ...versionCache.body, stale: true };
				versionCache = { at: Date.now(), body };
				sendJson(res, 200, body);
				return;
			}
			versionCache = { at: Date.now(), body: { latest: null, checkedAt: Date.now() } };
			sendJson(res, 200, versionCache.body);
		}
	};

	//#region session git versions
	/** Durable `{ sessions: { [id]: entry } }` state, loaded once per Host life. */
	const gitState = { sessions: {} };

	/** One JSON file under `$DSH_HOME/storages`; the plugin owns no database. */
	const gitStorePath = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "storages", GIT_STORE_FILE);

	/** Pending debounced write, and the serialized write chain it feeds. */
	let gitSaveTimer;
	let gitSaving = Promise.resolve();

	/** Session ids whose branch capture is currently running. */
	const captureInFlight = new Set();

	/** Session id → last failed capture instant, so a non-repository keeps no polling cost. */
	const captureFailed = new Map();

	/** `cwd → { branch, at }`, short-lived so a manual checkout is noticed quickly. */
	const currentCache = new Map();

	/** Last collected branch response; invalidated by every capture and switch. */
	let gitCache;

	/**
	 * Load the durable map. An absent or unreadable file starts empty; entries
	 * missing a branch or an absolute cwd are dropped rather than trusted.
	 */
	const loadGitStore = async () => {
		try {
			const raw = JSON.parse(await readFile(gitStorePath, "utf8"));
			const stored = raw?.sessions;
			if (stored === null || typeof stored !== "object") return;
			for (const [id, entry] of Object.entries(stored)) {
				if (entry === null || typeof entry !== "object") continue;
				if (typeof entry.branch !== "string" || entry.branch === "") continue;
				if (typeof entry.cwd !== "string" || !isAbsolute(entry.cwd)) continue;
				gitState.sessions[id] = {
					branch: entry.branch,
					cwd: entry.cwd,
					recordedAt: Number.isFinite(entry.recordedAt) ? entry.recordedAt : 0,
					inferred: entry.inferred === true,
					detached: entry.detached === true,
				};
			}
		} catch {
			// First run, or an unreadable store: start empty.
		}
	};

	/** Resolves once the durable map has been read; every route awaits it. */
	const gitReady = loadGitStore();

	/** Write the whole map atomically: temp file in the same directory, then rename. */
	const saveGitStore = async () => {
		await mkdir(dirname(gitStorePath), { recursive: true });
		const body = JSON.stringify({ version: 1, sessions: gitState.sessions });
		const temporary = `${gitStorePath}.${process.pid}.tmp`;
		await writeFile(temporary, body, "utf8");
		await rename(temporary, gitStorePath);
	};

	/** Coalesce bursts of captures into one write. */
	const scheduleGitSave = () => {
		if (gitSaveTimer !== undefined) clearTimeout(gitSaveTimer);
		gitSaveTimer = setTimeout(() => {
			gitSaveTimer = undefined;
			gitSaving = gitSaving.then(saveGitStore).catch((error) => {
				ctx.logger.warn(`dsh-raindrop-plugin: session git store write failed: ${String(error)}`);
			});
		}, 400);
	};

	/**
	 * Capture the branch of one Session's directory, once.
	 * @param id - Session id.
	 * @param cwd - Session header cwd (must be absolute).
	 * @param inferred - true when the branch was read later than creation.
	 * @returns the stored entry, or undefined when the directory is not a repository.
	 */
	const recordSession = async (id, cwd, inferred) => {
		if (typeof id !== "string" || id === "") return undefined;
		if (typeof cwd !== "string" || !isAbsolute(cwd)) return undefined;
		const existing = gitState.sessions[id];
		if (existing !== undefined) return existing;
		if (captureInFlight.has(id)) return undefined;
		captureInFlight.add(id);
		try {
			const head = await readHead(cwd);
			const entry = {
				branch: head.branch,
				cwd,
				recordedAt: Date.now(),
				inferred: inferred === true,
				detached: head.detached,
			};
			if (gitState.sessions[id] === undefined) {
				gitState.sessions[id] = entry;
				captureFailed.delete(id);
				gitCache = undefined;
				scheduleGitSave();
			}
			return gitState.sessions[id];
		} catch (error) {
			captureFailed.set(id, Date.now());
			ctx.logger.debug?.(`dsh-raindrop-plugin: no git branch for ${cwd}: ${String(error)}`);
			return undefined;
		} finally {
			captureInFlight.delete(id);
		}
	};

	/** Current branch of one directory, cached briefly; undefined outside a repository. */
	const currentBranchOf = async (cwd) => {
		const cached = currentCache.get(cwd);
		if (cached !== undefined && Date.now() - cached.at < CURRENT_TTL_MS) return cached.branch;
		try {
			const head = await readHead(cwd);
			currentCache.set(cwd, { branch: head.branch, at: Date.now() });
			return head.branch;
		} catch {
			currentCache.delete(cwd);
			return undefined;
		}
	};

	/**
	 * Build the branch map for every listed Session, backfilling Sessions that
	 * predate the feature (their branch is read on first sight and flagged
	 * `inferred`), plus the current branch of each referenced directory.
	 * @returns wire body `{ sessions, current, fetchedAt }`.
	 */
	const collectGit = async () => {
		const query = ctx.get("sessionQuery");
		const sessions = {};
		const pending = [];
		if (query !== undefined) {
			const records = await query.listSessions();
			for (const record of records) {
				const header = record?.header;
				if (header === undefined || typeof header.id !== "string") continue;
				if (gitState.sessions[header.id] === undefined && typeof header.cwd === "string") {
					const failedAt = captureFailed.get(header.id);
					if (failedAt !== undefined && Date.now() - failedAt < CAPTURE_RETRY_MS) continue;
					pending.push([header.id, header.cwd]);
				}
			}
			await Promise.all(pending.map(([id, cwd]) => recordSession(id, cwd, true)));
			for (const record of records) {
				const header = record?.header;
				if (header === undefined || typeof header.id !== "string") continue;
				const entry = gitState.sessions[header.id];
				if (entry === undefined) continue;
				sessions[header.id] = {
					branch: entry.branch,
					cwd: entry.cwd,
					inferred: entry.inferred === true,
					detached: entry.detached === true,
				};
			}
		}
		const current = {};
		await Promise.all(Object.values(sessions).map(async (entry) => {
			if (current[entry.cwd] !== undefined) return;
			const branch = await currentBranchOf(entry.cwd);
			if (branch !== undefined) current[entry.cwd] = branch;
		}));
		return { sessions, current, fetchedAt: Date.now() };
	};

	/**
	 * Read one small JSON POST body.
	 * @param req - incoming request.
	 * @returns parsed body, or null for an empty request.
	 * @throws when the body exceeds the size limit or is not JSON.
	 */
	const readJsonBody = async (req) => {
		let size = 0;
		const chunks = [];
		for await (const chunk of req) {
			size += chunk.length;
			if (size > GIT_BODY_LIMIT) throw new Error("body too large");
			chunks.push(chunk);
		}
		const text = Buffer.concat(chunks).toString("utf8");
		return text === "" ? null : JSON.parse(text);
	};

	/** One promise chain per directory, so two opens cannot race the same checkout. */
	const restoreLocks = new Map();
	const withCwdLock = (cwd, task) => {
		const previous = restoreLocks.get(cwd) ?? Promise.resolve();
		const running = previous.then(task, task);
		const settled = running.then(() => {}, () => {});
		restoreLocks.set(cwd, settled);
		void settled.then(() => {
			if (restoreLocks.get(cwd) === settled) restoreLocks.delete(cwd);
		});
		return running;
	};

	/**
	 * Switch one Session's directory back to its recorded branch when safe.
	 * @param sessionId - Session id from the restore request.
	 * @returns `{ status, branch?, current?, previous?, message? }`; status is one of
	 * `unknown | detached | not-git | same | dirty | missing | error | switched`.
	 */
	const restoreBranch = async (sessionId) => {
		await gitReady;
		const entry = gitState.sessions[sessionId];
		if (entry === undefined) return { status: "unknown" };
		if (entry.detached === true) return { status: "detached", branch: entry.branch };
		return withCwdLock(entry.cwd, async () => {
			let head;
			try {
				head = await readHead(entry.cwd);
			} catch {
				return { status: "not-git", branch: entry.branch };
			}
			if (head.branch === entry.branch) return { status: "same", branch: entry.branch, current: head.branch };
			let clean;
			try {
				clean = await isClean(entry.cwd);
			} catch {
				return { status: "error", branch: entry.branch, current: head.branch };
			}
			if (!clean) return { status: "dirty", branch: entry.branch, current: head.branch };
			if (!(await hasBranch(entry.cwd, entry.branch))) {
				return { status: "missing", branch: entry.branch, current: head.branch };
			}
			try {
				await switchBranch(entry.cwd, entry.branch);
			} catch (error) {
				return { status: "error", branch: entry.branch, current: head.branch, message: String(error?.message ?? error) };
			}
			currentCache.delete(entry.cwd);
			gitCache = undefined;
			return { status: "switched", branch: entry.branch, previous: head.branch };
		});
	};

	/**
	 * Serve `GET /session-git/branches` behind the browser session cookie.
	 * @param req - incoming request.
	 * @param res - response owning the request lifecycle.
	 */
	const gitHandler = async (req, res) => {
		if (req.method !== "GET") {
			res.writeHead(405, { allow: "GET" });
			res.end();
			return;
		}
		if (!ctx.connection.authorizeIndex(req, res)) return;
		await gitReady;
		if (gitCache !== undefined && Date.now() - gitCache.at < GIT_CACHE_MS) {
			sendJson(res, 200, gitCache.body);
			return;
		}
		try {
			const body = await collectGit();
			gitCache = { at: Date.now(), body };
			sendJson(res, 200, body);
		} catch (error) {
			ctx.logger.warn(`dsh-raindrop-plugin: session git list read failed: ${String(error)}`);
			sendJson(res, 500, { sessions: {}, current: {}, error: "session git unavailable" });
		}
	};

	/**
	 * Serve `POST /session-git/restore` behind the browser session cookie.
	 * @param req - incoming request.
	 * @param res - response owning the request lifecycle.
	 */
	const gitRestoreHandler = async (req, res) => {
		if (req.method !== "POST") {
			res.writeHead(405, { allow: "POST" });
			res.end();
			return;
		}
		if (!ctx.connection.authorizeIndex(req, res)) return;
		let body;
		try {
			body = await readJsonBody(req);
		} catch {
			sendJson(res, 400, { status: "invalid" });
			return;
		}
		const sessionId = body?.sessionId;
		if (typeof sessionId !== "string" || sessionId === "" || sessionId.length > 128) {
			sendJson(res, 400, { status: "invalid" });
			return;
		}
		try {
			sendJson(res, 200, await restoreBranch(sessionId));
		} catch (error) {
			ctx.logger.warn(`dsh-raindrop-plugin: session git restore failed: ${String(error)}`);
			sendJson(res, 500, { status: "error" });
		}
	};
	//#endregion

	ctx.effect(() => {
		let off;
		try {
			off = ctx.on("session/created", (session) => {
				const id = session?.id;
				const cwd = session?.header?.cwd;
				if (typeof id === "string" && typeof cwd === "string") void recordSession(id, cwd, false);
			});
		} catch (error) {
			// A deployment without the event still gets the header backfill.
			ctx.logger.warn(`dsh-raindrop-plugin: session/created is unavailable: ${String(error)}`);
		}
		return () => off?.();
	}, "dsh-raindrop-plugin: session git capture");

	ctx.effect(() => () => {
		if (gitSaveTimer !== undefined) {
			clearTimeout(gitSaveTimer);
			gitSaveTimer = undefined;
			void saveGitStore().catch(() => {});
		}
	}, "dsh-raindrop-plugin: session git store flush");

	ctx.effect(() => ctx.webServer.register({ kind: "exact", path: ROUTE, handler }), "dsh-raindrop-plugin: creation-time route");
	ctx.effect(() => ctx.webServer.register({ kind: "exact", path: VERSION_ROUTE, handler: versionHandler }), "dsh-raindrop-plugin: latest-version route");
	ctx.effect(() => ctx.webServer.register({ kind: "exact", path: GIT_ROUTE, handler: gitHandler }), "dsh-raindrop-plugin: session git branches route");
	ctx.effect(() => ctx.webServer.register({ kind: "exact", path: GIT_RESTORE_ROUTE, handler: gitRestoreHandler }), "dsh-raindrop-plugin: session git restore route");
}
