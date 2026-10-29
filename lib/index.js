/**
 * dsh-session-date, node half.
 *
 * The browser half needs each Session's creation instant to offer "show the
 * first conversation date" in the sidebar. The client-side session list only
 * carries `updatedAt`, so this half reads durable headers through the public
 * `sessionQuery` service and serves a tiny id → createdAt map over an
 * authenticated same-origin route. Everything else stays in lib/client.js.
 */

/** Exact path the browser half fetches. */
const ROUTE = "/session-date/dates";

/** How long one collected map is reused before the next request re-reads headers. */
const CACHE_MS = 15000;

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
 * Mount the creation-time route. The map is small (one number per Session) and
 * only addresses Sessions the authenticated browser already lists; the route
 * never returns titles, prompts, or paths.
 * @param ctx - Host context with `webServer` and `connection` injected.
 */
export function apply(ctx) {
	let cache;

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
			ctx.logger.warn(`dsh-session-date: session list read failed: ${String(error)}`);
			sendJson(res, 500, { sessions: {}, error: "session list unavailable" });
		}
	};

	ctx.effect(() => ctx.webServer.register({ kind: "exact", path: ROUTE, handler }), "dsh-session-date: creation-time route");
}
