/**
 * dsh-raindrop-plugin — browser half.
 *
 * The sidebar's session rows print a compact *relative* age ("刚刚", "5分钟",
 * "3天", "2个月"). This plugin replaces that label with the session's calendar
 * day and adds a date-view panel next to the sidebar's view-options button:
 *
 * - Show either the last-activity day (`updatedAt`, always available) or the
 *   first-conversation day (the Session header's `createdAt`, served by this
 *   package's Host half at `/session-date/dates`).
 * - Sort the visible list by the selected date, newest or oldest first.
 * - Filter the visible list to a date range (today / last 7 days / last 30
 *   days / custom).
 *
 * Why this shape:
 * - src for ui-workspace is not shipped, and neither the row clock nor the
 *   header action list is a slot: the only stable seam a plugin has is the
 *   row's DOM. The built row carries `data-row-key="session:<id>"` and one
 *   CSS-module span whose local name ends in `_time`, so this plugin locates
 *   that span and stamps it with a `data-dsh-session-date` attribute. A small
 *   injected stylesheet hides the relative text (`font-size: 0`) and renders
 *   the stamped date from `attr()` — React can keep re-rendering its own text
 *   underneath without fighting us, and no text node is ever replaced.
 * - Sorting uses the list's own DOM contract: the rows' direct parent becomes
 *   a flex column (only while date sorting is on) and each wrapper gets a CSS
 *   `order`. React keeps owning document order; no node is ever moved.
 * - Filtering hides row wrappers with one attribute and hides workspace
 *   sections whose sessions all fell outside the range.
 * - The date-view button is cloned from the native view-options button, so it
 *   inherits the sidebar's icon-button styling; its panel is a plain-DOM
 *   popover styled with the same design tokens as native menus.
 *
 * Pending-activity rows replace the clock with a status label
 * ("待审批"/"Plan review"). Those spans carry `aria-hidden="true"`; the plugin
 * leaves them untouched and lifts its stamp when the row returns to the clock.
 *
 * Tuning: the date style is the two constants below. Edit them in place (the
 * package is installed as a link, so a browser refresh picks a change up):
 *   localised words ("10月29日" / "Oct 29") or "numeric" ("10-29") or "iso".
 *   "auto" adds the year only for sessions outside the displayed year.
 */

window.__ModuleLoader__.load({
	id: "dsh-raindrop-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		//#region constants and formatting
		/** Attribute carrying the rendered day; also the stylesheet's hook. */
		const DATE_ATTRIBUTE = "data-dsh-session-date";
		/** Marker distinguishing this plugin's injected stylesheet. */
		const STYLE_ATTRIBUTE = "data-dsh-session-date-style";
		/** Row wrapper hidden by the active date range. */
		const HIDDEN_ATTRIBUTE = "data-dsh-date-hidden";
		/** Workspace section whose every Session fell outside the range. */
		const GROUP_HIDDEN_ATTRIBUTE = "data-dsh-date-group-hidden";
		/** Parent container currently rendered as a sorted flex column. */
		const SORTED_ATTRIBUTE = "data-dsh-date-sorted";
		/** Header button opening the date-view panel. */
		const TRIGGER_ATTRIBUTE = "data-dsh-date-trigger";
		/** The floating date-view panel. */
		const PANEL_ATTRIBUTE = "data-dsh-date-panel";
		/** Empty-range notice inside the list. */
		const EMPTY_ATTRIBUTE = "data-dsh-date-empty";
		/** Search field injected into the workspace picker menu. */
		const WS_INPUT_ATTRIBUTE = "data-dsh-ws-search";
		/** Workspace row hidden by the picker filter. */
		const WS_HIDDEN_ATTRIBUTE = "data-dsh-ws-hidden";
		/** Matched workspace row highlighted by the picker filter. */
		const WS_MATCH_ATTRIBUTE = "data-dsh-ws-match";
		/** Matched row currently selected by the arrow keys. */
		const WS_ACTIVE_ATTRIBUTE = "data-dsh-ws-active";
		/** Fixed top strip warning that the selected model bills the user's own quota. */
		const QUOTA_ATTRIBUTE = "data-dsh-own-quota-banner";
		/** Root marker reserving the strip's height above the app frame. */
		const QUOTA_ROOT_ATTRIBUTE = "data-dsh-own-quota";
		/**
		 * Providers whose models spend the user's own DeepSeek account balance:
		 * the account-login route and the official API-key route. Third-party
		 * gateways keep their own billing and are intentionally excluded; add a
		 * provider id here to warn about it as well.
		 */
		const OWN_QUOTA_PROVIDERS = new Set(["deepseek-account", "deepseek-official"]);
		/** Every top-level session row in the sidebar tree (search rows have no key). */
		const ROW_SELECTOR = "[data-row-key^='session:']";
		/** Prefix of the row key that addresses one Session id. */
		const SESSION_KEY_PREFIX = "session:";
		/** Host route serving Session creation instants. */
		const ROUTE = "/session-date/dates";
		/** Persisted date-view preferences (legacy key kept across the rename). */
		const STORAGE_KEY = "dsh-session-date:view";
		/** One day in milliseconds (range presets only; day bounds use calendar dates). */
		const DAY_MS = 86400000;

		const CSS = `
[data-row-key^='session:'] [${DATE_ATTRIBUTE}] {
	font-size: 0 !important;
	letter-spacing: 0 !important;
}
[data-row-key^='session:'] [${DATE_ATTRIBUTE}]::after {
	content: attr(${DATE_ATTRIBUTE});
	display: inline;
	font-size: 10px;
	line-height: 16px;
	color: var(--dsw-alias-label-tertiary, #8a8f98);
	font-variant-numeric: tabular-nums;
	letter-spacing: 0;
	white-space: nowrap;
}
[${HIDDEN_ATTRIBUTE}] { display: none !important; }
[${GROUP_HIDDEN_ATTRIBUTE}] { display: none !important; }
[${SORTED_ATTRIBUTE}] { display: flex !important; flex-direction: column; }
[${SORTED_ATTRIBUTE}] > * { flex: none; }

.dsh-sd-panel {
	position: fixed;
	z-index: 1200;
	box-sizing: border-box;
	width: 264px;
	padding: 6px;
	border-radius: var(--dsw-radius-lg, 16px);
	background: var(--dsw-alias-bg-base, #fff);
	backdrop-filter: var(--dsw-menu-backdrop-filter, blur(18px));
	box-shadow: 0 0 0 .5px rgba(0, 0, 0, .06), 0 8px 24px rgba(0, 0, 0, .10);
	color: var(--dsw-alias-label-primary, #0f1115);
	font-size: 13px;
	line-height: 20px;
	user-select: none;
}
.dsh-sd-panel[hidden] { display: none !important; }
.dsh-sd-head { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px 6px; }
.dsh-sd-title { font-weight: 500; }
.dsh-sd-icon { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary, #81858c); font: inherit; font-size: 16px; line-height: 1; cursor: pointer; }
.dsh-sd-icon:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); }
.dsh-sd-label { padding: 6px 8px 3px; font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-tertiary, #81858c); }
.dsh-sd-sep { height: .5px; margin: 4px 2px; background: var(--dsw-alias-border-l2, rgba(0, 0, 0, .08)); }
.dsh-sd-item { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 30px; padding: 4px 8px; border: 0; border-radius: 12px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.dsh-sd-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); }
.dsh-sd-check { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; flex: none; color: var(--dsw-alias-label-primary, #0f1115); font-size: 12px; }
.dsh-sd-item-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-sd-chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 4px 6px; }
.dsh-sd-chip { padding: 3px 8px; border: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .12)); border-radius: 999px; background: transparent; color: inherit; font: inherit; font-size: 12px; line-height: 16px; cursor: pointer; }
.dsh-sd-chip:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); }
.dsh-sd-chip[aria-pressed='true'] { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .06)); border-color: transparent; }
.dsh-sd-range { display: flex; gap: 6px; padding: 2px 4px 6px; }
.dsh-sd-field { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-tertiary, #81858c); }
.dsh-sd-field input { box-sizing: border-box; width: 100%; padding: 3px 6px; border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .12)); border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 12px; color-scheme: light dark; }
.dsh-sd-clear { margin: 2px 4px 0; padding: 4px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-tertiary, #81858c); font: inherit; font-size: 12px; cursor: pointer; }
.dsh-sd-clear:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); color: var(--dsw-alias-label-primary, #0f1115); }
.dsh-sd-empty { order: -2; padding: 14px 10px 6px; color: var(--dsw-alias-label-tertiary, #81858c); font-size: 12px; line-height: 18px; text-align: center; }
[${WS_HIDDEN_ATTRIBUTE}] { display: none !important; }
button[${WS_ACTIVE_ATTRIBUTE}] { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); }
.dsh-ws-search {
	position: sticky;
	top: 0;
	z-index: 2;
	box-sizing: border-box;
	width: 100%;
	margin: 0 0 4px;
	padding: 5px 8px;
	border: 0;
	border-bottom: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .08));
	background: var(--dsw-alias-bg-base, #fff);
	backdrop-filter: var(--dsw-menu-backdrop-filter, blur(18px));
	color: inherit;
	font: inherit;
	font-size: 13px;
	line-height: 20px;
	outline: none;
}
.dsh-ws-search::placeholder { color: var(--dsw-alias-label-tertiary, #81858c); }
.dsh-ws-search[data-dsh-ws-nomatch] { border-bottom-color: var(--dsw-alias-state-warning-primary, #d97757); }

/* Own-quota warning: a fixed strip over the top band that #root reserves. */
[${QUOTA_ATTRIBUTE}] {
	position: fixed;
	inset: 0 0 auto;
	z-index: 15;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	box-sizing: border-box;
	height: 32px;
	padding: 0 16px;
	border-bottom: 1px solid rgba(0, 0, 0, .12);
	background: var(--dsw-alias-state-warn-primary, #f59e0b);
	color: #1b1200;
	font-size: 13px;
	font-weight: 500;
	line-height: 20px;
	letter-spacing: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
[${QUOTA_ATTRIBUTE}][hidden] { display: none !important; }
[${QUOTA_ATTRIBUTE}] .dsh-sdq-icon { display: inline-flex; flex: none; align-items: center; }
[${QUOTA_ATTRIBUTE}] .dsh-sdq-text { overflow: hidden; text-overflow: ellipsis; }
#root[${QUOTA_ROOT_ATTRIBUTE}] { box-sizing: border-box; padding-top: 32px; }
`;

		/** Comment-less tuning knobs: localized | numeric | iso, and when the year appears. */
		const FORMAT = "localized";
		const SHOW_YEAR = "auto"; // auto | always | never

		/** Panel copy, both shipped UI languages. */
		const STRINGS = {
			zh: {
				trigger: "日期视图",
				title: "日期视图",
				close: "关闭",
				show: "显示日期",
				updated: "最后活动",
				created: "首次对话",
				sort: "按日期排序",
				def: "默认（侧栏排序）",
				desc: "日期：新 → 旧",
				asc: "日期：旧 → 新",
				filter: "筛选日期",
				all: "全部",
				today: "今天",
				week: "近 7 天",
				month: "近 30 天",
				from: "从",
				to: "到",
				clear: "清除筛选",
				empty: "没有符合日期范围的会话",
				wsPlaceholder: "搜索工作区…",
				wsEmpty: "无匹配工作区",
				ownQuota: "正在使用自己的额度！",
			},
			en: {
				trigger: "Date view",
				title: "Date view",
				close: "Close",
				show: "Show date",
				updated: "Last activity",
				created: "First message",
				sort: "Sort by date",
				def: "Default (sidebar order)",
				desc: "Date: newest first",
				asc: "Date: oldest first",
				filter: "Filter by date",
				all: "All",
				today: "Today",
				week: "Last 7 days",
				month: "Last 30 days",
				from: "From",
				to: "To",
				clear: "Clear filter",
				empty: "No sessions in this date range",
				wsPlaceholder: "Search workspaces…",
				wsEmpty: "No matching workspaces",
				ownQuota: "You are using your own quota!",
			},
		};

		/** Calendar glyph matching the sidebar's 16px outline icon set. */
		const CALENDAR_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="2"></rect><path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2"></path></svg>`;

		/** Filled warning triangle; the amber cutout matches the strip background. */
		const WARNING_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M7.13 1.93a1 1 0 0 1 1.74 0l6.2 10.74a1 1 0 0 1-.87 1.5H1.8a1 1 0 0 1-.87-1.5z" fill="currentColor"></path><path d="M8 5.4v4.2" stroke="#f59e0b" stroke-width="1.4" stroke-linecap="round"></path><circle cx="8" cy="12" r=".8" fill="#f59e0b"></circle></svg>`;

		/** Cached `Intl.DateTimeFormat` instances keyed by language + year presence. */
		const FORMATTERS = new Map();

		/** Zero-pad a one-digit number. @param value - non-negative integer. @returns two characters. */
		function pad2(value) {
			return value < 10 ? `0${value}` : String(value);
		}

		/**
		* Format one instant with the browser's locale data ("10月29日", "Oct 29").
		* @param epochMs - Instant in epoch milliseconds.
		* @param withYear - Whether the year participates.
		* @param language - Active locale id (a BCP 47 tag).
		* @returns The localized calendar day.
		*/
		function localizedDay(epochMs, withYear, language) {
			const key = `${language}|${withYear ? 1 : 0}`;
			let formatter = FORMATTERS.get(key);
			if (formatter === undefined) {
				const options = withYear ? { year: "numeric", month: "short", day: "numeric" } : { month: "short", day: "numeric" };
				try {
					formatter = new Intl.DateTimeFormat(language, options);
				} catch {
					// An unregistered tag still gets a sensible day rather than no label.
					formatter = new Intl.DateTimeFormat(undefined, options);
				}
				FORMATTERS.set(key, formatter);
			}
			return formatter.format(epochMs);
		}

		/**
		* Format one instant as a calendar day, in the app's language.
		* @param epochMs - Session timestamp in epoch milliseconds.
		* @param nowMs - Current instant, deciding whether the year is needed.
		* @param language - Lowercased active locale id (or browser language).
		* @returns Display label, or "" for an unusable timestamp.
		*/
		function formatDay(epochMs, nowMs, language) {
			const date = new Date(epochMs);
			if (!Number.isFinite(date.getTime())) return "";
			const year = date.getFullYear();
			const month = date.getMonth() + 1;
			const day = date.getDate();
			if (FORMAT === "iso") return `${year}-${pad2(month)}-${pad2(day)}`;
			const withYear = SHOW_YEAR === "always" || (SHOW_YEAR === "auto" && year !== new Date(nowMs).getFullYear());
			if (FORMAT === "numeric") return `${withYear ? `${year}-` : ""}${pad2(month)}-${pad2(day)}`;
			return localizedDay(epochMs, withYear, language);
		}

		/**
		* Read the active UI language without requiring the locale service.
		* @param ctx - Client root context (locale may or may not be loaded).
		* @returns Lowercased language id, never empty.
		*/
		function activeLanguage(ctx) {
			try {
				const active = ctx.get("locale")?.getSnapshot?.().active;
				if (typeof active === "string" && active !== "") return active.toLowerCase();
			} catch {
				// Locale is optional here; fall through to the document.
			}
			if (typeof document !== "undefined" && typeof document.documentElement.lang === "string" && document.documentElement.lang !== "") {
				return document.documentElement.lang.toLowerCase();
			}
			if (typeof navigator !== "undefined" && typeof navigator.language === "string" && navigator.language !== "") {
				return navigator.language.toLowerCase();
			}
			return "en";
		}

		/** Start of the local calendar day containing `ms`. @param ms - instant. @returns midnight epoch ms. */
		function startOfDay(ms) {
			const date = new Date(ms);
			return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
		}

		/** End of the local calendar day containing `ms`. @param ms - instant. @returns last millisecond. */
		function endOfDay(ms) {
			const date = new Date(ms);
			return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() - 1;
		}

		/**
		* Parse a `YYYY-MM-DD` input value as local midnight.
		* @param value - input value.
		* @returns epoch ms, or undefined for an incomplete value.
		*/
		function parseDay(value) {
			const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
			if (match === null) return undefined;
			const ms = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
			return Number.isFinite(ms) ? ms : undefined;
		}
		//#endregion

		//#region DOM helpers
		/**
		* Whether one direct child is the row's clock cell (CSS-module local `time`).
		* @param element - Direct child of a session row.
		* @returns true for the clock span.
		*/
		function isTimeSpan(element) {
			if (element.tagName !== "SPAN") return false;
			const className = typeof element.className === "string" ? element.className : "";
			for (const token of className.split(/\s+/)) {
				if (token.endsWith("_time")) return true;
			}
			return false;
		}

		/**
		* Find the clock span inside one row, tolerating a renamed CSS-module hash.
		* @param row - `data-row-key="session:<id>"` element.
		* @returns The clock span, or undefined when the row has no clock (blank row).
		*/
		function findTimeSpan(row) {
			for (const child of row.children) {
				if (isTimeSpan(child)) return child;
			}
			// Fallback for a build whose CSS-module local no longer ends in `_time`:
			// the row renders slot, title, clock, [pin], actions as direct spans.
			const spans = [];
			for (const child of row.children) {
				if (child.tagName === "SPAN") spans.push(child);
			}
			const candidate = spans[2];
			if (candidate === undefined) return undefined;
			if (candidate.querySelector("button, svg") !== null) return undefined;
			const text = (candidate.textContent ?? "").trim();
			return text.length <= 12 ? candidate : undefined;
		}

		/** Session id carried by one row. @param row - session row. @returns id or undefined. */
		function sessionIdOf(row) {
			const key = row.getAttribute("data-row-key") ?? "";
			return key.startsWith(SESSION_KEY_PREFIX) ? key.slice(SESSION_KEY_PREFIX.length) : undefined;
		}
		//#endregion

		//#region plugin
		/** Required service: the public sessions store this plugin reads timestamps from. */
		const inject = ["sessions"];

		/**
		* Install the date labels and the date-view panel.
		* @param ctx - Client root context with `sessions` injected.
		*/
		function apply(ctx) {
			if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
			const sessions = ctx.get("sessions");
			if (sessions === undefined || sessions.list === undefined) return;

			const state = loadState();
			let frame = 0;
			let fetching = false;
			let lastAppliedKey = "";
			let panel = null;
			let trigger = null;
			let triggerHolder = null;
			let emptyHint = null;
			let sortedParents = new Set();
			let disposed = false;
			let quotaBanner = null;
			let quotaShown = false;
			let lastProvider;

			/** Current dictionary. @returns the panel strings for the active language. */
			const t = () => (activeLanguage(ctx).startsWith("zh") ? STRINGS.zh : STRINGS.en);

			/** Coalesce DOM work into one animation frame. */
			const schedule = () => {
				if (frame !== 0) return;
				frame = typeof requestAnimationFrame === "function"
					? requestAnimationFrame(() => {
						frame = 0;
						applyView();
					})
					: setTimeout(() => {
						frame = 0;
						applyView();
					}, 0);
			};

			//#region persistence
			/**
			* Read persisted preferences; unknown values fall back to defaults.
			* @returns Mutable view state (createdAt cache included).
			*/
			function loadState() {
				const next = { source: "updated", sort: "default", range: "all", from: "", to: "", createdAt: new Map(), createdAtAt: 0 };
				try {
					const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
					if (raw !== null && typeof raw === "object") {
						if (raw.source === "created") next.source = "created";
						if (raw.sort === "desc" || raw.sort === "asc") next.sort = raw.sort;
						if (raw.range === "today" || raw.range === "week" || raw.range === "month" || raw.range === "custom") next.range = raw.range;
						if (typeof raw.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.from)) next.from = raw.from;
						if (typeof raw.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.to)) next.to = raw.to;
					}
				} catch {
					// Storage may be unavailable; defaults still work.
				}
				if (next.range === "custom" && next.from === "" && next.to === "") next.range = "all";
				return next;
			}

			/** Persist the preference slice (never the transient caches). */
			function saveState() {
				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify({
						source: state.source,
						sort: state.sort,
						range: state.range,
						from: state.from,
						to: state.to,
					}));
				} catch {
					// Persistence is best-effort.
				}
			}
			//#endregion

			//#region own-quota alert
			/**
			* Provider id selected for the conversation on screen. The composer's model
			* trigger is the live source (its label carries `data-provider-id`); when no
			* composer is mounted (entry pages, plugin manager) the selected Session's
			* durable model-selection projection stands in.
			* @returns provider id, or undefined when neither source knows one.
			*/
			function providerIdNow() {
				const trigger = document.querySelector('button[aria-haspopup="menu"] [data-provider-id]')
					?? document.querySelector('[class*="_triggerLabel"] [data-provider-id]');
				if (trigger !== null) {
					const id = trigger.getAttribute("data-provider-id");
					if (typeof id === "string" && id !== "") return id;
				}
				const snapshot = sessions.list.getSnapshot();
				for (const row of Object.values(snapshot.byId ?? {})) {
					if ((row.retainedBy?.mainView ?? 0) <= 0) continue;
					const selection = row.projectionValues?.modelSelection;
					const provider = selection?.next?.provider ?? selection?.lastUsed?.provider;
					if (typeof provider === "string" && provider !== "") return provider;
				}
				return undefined;
			}

			/**
			* Create the fixed top strip once. Its text is filled in by
			* {@link updateQuotaBanner}; the stylesheet owns its appearance.
			* @returns the banner element.
			*/
			function ensureQuotaBanner() {
				if (quotaBanner !== null && quotaBanner.isConnected) return quotaBanner;
				quotaBanner = document.createElement("div");
				quotaBanner.setAttribute(QUOTA_ATTRIBUTE, "");
				quotaBanner.setAttribute("role", "alert");
				const icon = document.createElement("span");
				icon.className = "dsh-sdq-icon";
				icon.innerHTML = WARNING_SVG;
				const text = document.createElement("span");
				text.className = "dsh-sdq-text";
				quotaBanner.append(icon, text);
				document.body.appendChild(quotaBanner);
				return quotaBanner;
			}

			/**
			* Show or hide the own-quota strip from the last known provider. The last
			* provider is retained while no composer or projection is available, so
			* opening the plugin manager does not dismiss the warning.
			*/
			function updateQuotaBanner() {
				if (disposed) return;
				const provider = providerIdNow();
				if (provider !== undefined) lastProvider = provider;
				const own = lastProvider !== undefined && OWN_QUOTA_PROVIDERS.has(lastProvider);
				if (own) {
					const strings = t();
					const banner = ensureQuotaBanner();
					if (banner.hidden) banner.hidden = false;
					const text = banner.querySelector(".dsh-sdq-text");
					if (text !== null && text.textContent !== strings.ownQuota) text.textContent = strings.ownQuota;
					if (banner.getAttribute("aria-label") !== strings.ownQuota) banner.setAttribute("aria-label", strings.ownQuota);
					const root = document.getElementById("root");
					if (root !== null && !root.hasAttribute(QUOTA_ROOT_ATTRIBUTE)) root.setAttribute(QUOTA_ROOT_ATTRIBUTE, "");
					quotaShown = true;
					return;
				}
				if (!quotaShown) return;
				quotaShown = false;
				if (quotaBanner !== null) quotaBanner.hidden = true;
				document.getElementById("root")?.removeAttribute(QUOTA_ROOT_ATTRIBUTE);
			}
			//#endregion

			//#region creation times
			/**
			* Fetch the id → createdAt map from the Host half (throttled unless forced).
			* @param force - ignore the throttle interval.
			*/
			async function refreshCreatedAt(force = false) {
				const now = Date.now();
				if (fetching) return;
				if (!force && now - state.createdAtAt < 15000) return;
				fetching = true;
				try {
					const response = await fetch(ROUTE, { credentials: "same-origin", headers: { accept: "application/json" } });
					if (!response.ok) return;
					const body = await response.json();
					if (body === null || typeof body !== "object" || body.sessions === null || typeof body.sessions !== "object") return;
					const next = new Map();
					for (const [id, value] of Object.entries(body.sessions)) {
						if (typeof value === "number" && Number.isFinite(value)) next.set(id, value);
					}
					state.createdAt = next;
					schedule();
				} catch {
					// The Host route appears after the plugin's Host half reloads; retry later.
				} finally {
					state.createdAtAt = Date.now();
					fetching = false;
				}
			}

			/**
			* The instant this row's selected source names.
			* @param id - Session id.
			* @param summary - current session summary, when listed.
			* @returns epoch ms, or undefined when unavailable.
			*/
			function dateFor(id, summary) {
				if (id !== undefined && state.source === "created") {
					const created = state.createdAt.get(id);
					if (typeof created === "number") return created;
				}
				return summary?.updatedAt;
			}
			//#endregion

			//#region view application
			/**
			* Bounds of the active range, or undefined when no filter applies.
			* @returns inclusive epoch-ms bounds.
			*/
			function rangeBounds() {
				const now = Date.now();
				const today = startOfDay(now);
				if (state.range === "today") return { from: today, to: endOfDay(now) };
				if (state.range === "week") return { from: startOfDay(today - 6 * DAY_MS), to: endOfDay(now) };
				if (state.range === "month") return { from: startOfDay(today - 29 * DAY_MS), to: endOfDay(now) };
				if (state.range === "custom") {
					const from = parseDay(state.from);
					const to = parseDay(state.to);
					if (from === undefined && to === undefined) return undefined;
					return { from: from ?? -Infinity, to: to === undefined ? Infinity : endOfDay(to) };
				}
				return undefined;
			}

			/**
			* Order one row's sort bucket: blank draft, pinned, then ordinary rows.
			* @param row - session row.
			* @param blank - whether the row has no clock.
			* @returns bucket index.
			*/
			function bucketOf(row, blank) {
				if (blank) return 0;
				return row.querySelector('[class*="_pinIndicator"]') === null ? 2 : 1;
			}

			/**
			* Stamp every rendered row, apply the range, and order each container.
			*/
			function applyView() {
				if (disposed) return;
				ensureTrigger();
				if (state.open && (trigger === null || !trigger.isConnected)) closePanel();
				if (state.open) positionPanel();
				const snapshot = sessions.list.getSnapshot();
				const bounds = rangeBounds();
				const language = activeLanguage(ctx);
				const now = Date.now();
				const containers = new Map();
				const sections = new Map();
				let visible = 0;
				let index = 0;

				for (const row of document.querySelectorAll(ROW_SELECTOR)) {
					const span = findTimeSpan(row);
					const id = sessionIdOf(row);
					const summary = id === undefined ? undefined : snapshot.byId[id];
					const blank = span === undefined;
					const dateMs = blank ? undefined : dateFor(id, summary);
					if (span !== undefined) {
						const label = dateMs !== undefined && Number.isFinite(dateMs) ? formatDay(dateMs, now, language) : "";
						if (label === "") {
							if (span.hasAttribute(DATE_ATTRIBUTE)) span.removeAttribute(DATE_ATTRIBUTE);
						} else if (span.getAttribute(DATE_ATTRIBUTE) !== label) {
							span.setAttribute(DATE_ATTRIBUTE, label);
						}
					}
					const wrapper = row.parentElement;
					if (wrapper === null) continue;
					const hidden = !blank && bounds !== undefined && dateMs !== undefined && Number.isFinite(dateMs) && !(dateMs >= bounds.from && dateMs <= bounds.to);
					if (hidden) wrapper.setAttribute(HIDDEN_ATTRIBUTE, "");
					else wrapper.removeAttribute(HIDDEN_ATTRIBUTE);
					if (!hidden && !blank) visible += 1;

					const container = wrapper.parentElement;
					if (container === null) continue;
					const entry = {
						wrapper,
						bucket: bucketOf(row, blank),
						dateMs: dateMs !== undefined && Number.isFinite(dateMs) ? dateMs : (summary?.updatedAt ?? 0),
						index: index++,
					};
					const list = containers.get(container);
					if (list === undefined) containers.set(container, [entry]);
					else list.push(entry);

					const section = container.closest?.('[class*="_groupSection"]');
					if (section !== null && section !== undefined) {
						const record = sections.get(section) ?? { rows: 0, visible: 0 };
						record.rows += 1;
						if (!hidden) record.visible += 1;
						sections.set(section, record);
					}
				}

				applySorting(containers);
				applySectionVisibility(sections, bounds !== undefined);
				applyEmptyHint(visible, bounds !== undefined);

				const key = `${state.source}|${state.sort}|${state.range}|${state.from}|${state.to}`;
				if (key !== lastAppliedKey) {
					lastAppliedKey = key;
					if (state.sort !== "default" || bounds !== undefined) scrollListTop();
				}
				updateQuotaBanner();
			}

			/**
			* Order every container by the active sort, or restore document order.
			* @param containers - wrapper-parent → entries map from {@link applyView}.
			*/
			function applySorting(containers) {
				if (state.sort === "default") {
					for (const parent of sortedParents) clearSorting(parent);
					sortedParents = new Set();
					return;
				}
				const next = new Set();
				for (const [parent, entries] of containers) {
					next.add(parent);
					parent.setAttribute(SORTED_ATTRIBUTE, "");
					entries.sort((left, right) => {
						if (left.bucket !== right.bucket) return left.bucket - right.bucket;
						if (state.sort === "asc") return left.dateMs - right.dateMs || left.index - right.index;
						return right.dateMs - left.dateMs || left.index - right.index;
					});
					const ordered = new Set(entries.map((entry) => entry.wrapper));
					for (const child of parent.children) {
						if (ordered.has(child)) continue;
						if (child.hasAttribute(EMPTY_ATTRIBUTE)) child.style.order = "-2";
						else if (child.querySelector?.('[data-row-key^="workspace:"]') !== null) child.style.order = "-1";
						else if (child.tagName === "BUTTON") child.style.order = "10000";
						else child.style.order = "0";
					}
					entries.forEach((entry, order) => {
						const value = String(order);
						if (entry.wrapper.style.order !== value) entry.wrapper.style.order = value;
					});
				}
				for (const parent of sortedParents) if (!next.has(parent)) clearSorting(parent);
				sortedParents = next;
			}

			/** Restore one container's document order. @param parent - flex column container. */
			function clearSorting(parent) {
				parent.removeAttribute(SORTED_ATTRIBUTE);
				for (const child of parent.children) {
					if (child.style.order !== "") child.style.order = "";
				}
			}

			/**
			* Hide workspace sections whose sessions all fell outside the range.
			* @param sections - section → counts map from {@link applyView}.
			* @param filtered - whether a range is active.
			*/
			function applySectionVisibility(sections, filtered) {
				for (const section of document.querySelectorAll('[class*="_groupSection"]')) {
					const record = sections.get(section);
					const hide = filtered && record !== undefined && record.rows > 0 && record.visible === 0;
					if (hide) section.setAttribute(GROUP_HIDDEN_ATTRIBUTE, "");
					else section.removeAttribute(GROUP_HIDDEN_ATTRIBUTE);
				}
			}

			/**
			* Show a notice when the range excluded every dated session.
			* @param visible - visible non-blank rows.
			* @param filtered - whether a range is active.
			*/
			function applyEmptyHint(visible, filtered) {
				const list = document.querySelector(ROW_SELECTOR)?.closest?.('[class*="_list"]');
				if (list === null || list === undefined) return;
				if (!filtered || visible > 0) {
					if (emptyHint !== null) emptyHint.hidden = true;
					return;
				}
				if (emptyHint === null || !emptyHint.isConnected) {
					emptyHint = document.createElement("div");
					emptyHint.setAttribute(EMPTY_ATTRIBUTE, "");
					emptyHint.className = "dsh-sd-empty";
					list.insertBefore(emptyHint, list.firstChild);
				}
				emptyHint.textContent = t().empty;
				emptyHint.hidden = false;
			}

			/** Put the session list back at its top after an order/filter change. */
			function scrollListTop() {
				const list = document.querySelector(ROW_SELECTOR)?.closest?.('[class*="_list"]');
				if (list !== null && list !== undefined) list.scrollTop = 0;
			}
			//#endregion

			//#region trigger + panel
			/** Clone the native view-options button into a date-view trigger. */
			function ensureTrigger() {
				const strings = t();
				if (trigger !== null && trigger.isConnected) {
					if (trigger.getAttribute("aria-label") !== strings.trigger) {
						trigger.setAttribute("aria-label", strings.trigger);
						trigger.setAttribute("title", strings.trigger);
					}
					return;
				}
				trigger = null;
				triggerHolder = null;
				const actions = document.querySelector('[class*="_headerActions"]');
				if (actions === null) return;
				const native = actions.querySelector("button");
				if (native === null) return;
				const holder = native.parentElement?.tagName === "SPAN" ? native.parentElement : native;
				const clone = holder.cloneNode(true);
				const button = clone.tagName === "BUTTON" ? clone : clone.querySelector("button");
				if (button === null) return;
				button.removeAttribute("aria-keyshortcuts");
				button.removeAttribute("aria-describedby");
				button.setAttribute(TRIGGER_ATTRIBUTE, "");
				button.setAttribute("aria-label", strings.trigger);
				button.setAttribute("title", strings.trigger);
				button.innerHTML = CALENDAR_SVG;
				button.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					if (state.open) closePanel();
					else openPanel();
				});
				actions.insertBefore(clone, holder);
				trigger = button;
				triggerHolder = clone;
			}

			/** Create the floating panel once and bind its delegated controls. */
			function ensurePanel() {
				if (panel !== null && panel.isConnected) return;
				panel = document.createElement("div");
				panel.setAttribute(PANEL_ATTRIBUTE, "");
				panel.className = "dsh-sd-panel";
				panel.setAttribute("role", "dialog");
				panel.hidden = true;
				panel.addEventListener("click", (event) => {
					const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
					if (target === null || !panel.contains(target)) return;
					const action = target.dataset.action;
					const value = target.dataset.value;
					if (action === "close") return closePanel();
					if (action === "source" && (value === "updated" || value === "created")) state.source = value;
					else if (action === "sort" && (value === "default" || value === "desc" || value === "asc")) state.sort = value;
					else if (action === "range") {
						state.range = value ?? "all";
						if (state.range !== "custom") {
							state.from = "";
							state.to = "";
						}
					} else if (action === "clear") {
						state.range = "all";
						state.from = "";
						state.to = "";
					}
					saveState();
					applyView();
					renderPanel();
					positionPanel();
				});
				panel.addEventListener("change", (event) => {
					const input = event.target;
					if (!(input instanceof HTMLInputElement) || input.dataset.field === undefined) return;
					if (input.dataset.field === "from") state.from = input.value;
					else state.to = input.value;
					state.range = state.from === "" && state.to === "" ? "all" : "custom";
					saveState();
					applyView();
					syncPanelState();
					positionPanel();
				});
				document.body.appendChild(panel);
			}

			/** Rebuild the panel's controls from the current state. */
			function renderPanel() {
				if (panel === null) return;
				const strings = t();
				panel.setAttribute("aria-label", strings.title);
				const head = document.createElement("div");
				head.className = "dsh-sd-head";
				const title = document.createElement("span");
				title.className = "dsh-sd-title";
				title.textContent = strings.title;
				const close = document.createElement("button");
				close.type = "button";
				close.className = "dsh-sd-icon";
				close.dataset.action = "close";
				close.setAttribute("aria-label", strings.close);
				close.textContent = "×";
				head.append(title, close);

				const body = document.createElement("div");
				body.append(labelRow(strings.show));
				body.append(optionRow("source", "updated", strings.updated, state.source === "updated"));
				body.append(optionRow("source", "created", strings.created, state.source === "created"));
				body.append(separator());
				body.append(labelRow(strings.sort));
				body.append(optionRow("sort", "default", strings.def, state.sort === "default"));
				body.append(optionRow("sort", "desc", strings.desc, state.sort === "desc"));
				body.append(optionRow("sort", "asc", strings.asc, state.sort === "asc"));
				body.append(separator());
				body.append(labelRow(strings.filter));
				const chips = document.createElement("div");
				chips.className = "dsh-sd-chips";
				for (const [range, label] of [["all", strings.all], ["today", strings.today], ["week", strings.week], ["month", strings.month]]) {
					const chip = document.createElement("button");
					chip.type = "button";
					chip.className = "dsh-sd-chip";
					chip.dataset.action = "range";
					chip.dataset.value = range;
					chip.setAttribute("aria-pressed", String(state.range === range));
					chip.textContent = label;
					chips.append(chip);
				}
				body.append(chips);
				const rangeRow = document.createElement("div");
				rangeRow.className = "dsh-sd-range";
				rangeRow.append(dateField(strings.from, "from", state.from), dateField(strings.to, "to", state.to));
				body.append(rangeRow);
				const clear = document.createElement("button");
				clear.type = "button";
				clear.className = "dsh-sd-clear";
				clear.dataset.action = "clear";
				clear.textContent = strings.clear;
				body.append(clear);
				panel.replaceChildren(head, body);
			}

			/** Reflect state changes in the existing controls without replacing focused inputs. */
			function syncPanelState() {
				if (panel === null) return;
				for (const button of panel.querySelectorAll("[data-action='source'], [data-action='sort']")) {
					const current = button.dataset.action === "source" ? state.source : state.sort;
					const active = button.dataset.value === current;
					button.setAttribute("aria-pressed", String(active));
					const check = button.querySelector(".dsh-sd-check");
					if (check !== null) check.textContent = active ? "✓" : "";
				}
				for (const chip of panel.querySelectorAll("[data-action='range']")) {
					chip.setAttribute("aria-pressed", String(chip.dataset.value === state.range));
				}
			}

			/** One section label. @param text - label copy. @returns the element. */
			function labelRow(text) {
				const element = document.createElement("div");
				element.className = "dsh-sd-label";
				element.textContent = text;
				return element;
			}

			/** One hairline separator. @returns the element. */
			function separator() {
				const element = document.createElement("div");
				element.className = "dsh-sd-sep";
				return element;
			}

			/**
			* One radio row.
			* @param action - dataset action (`source` or `sort`).
			* @param value - option value.
			* @param label - visible copy.
			* @param checked - whether the option is active.
			* @returns the button.
			*/
			function optionRow(action, value, label, checked) {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "dsh-sd-item";
				button.dataset.action = action;
				button.dataset.value = value;
				button.setAttribute("aria-pressed", String(checked));
				const check = document.createElement("span");
				check.className = "dsh-sd-check";
				check.textContent = checked ? "✓" : "";
				const text = document.createElement("span");
				text.className = "dsh-sd-item-label";
				text.textContent = label;
				button.append(check, text);
				return button;
			}

			/**
			* One date input.
			* @param label - field label.
			* @param field - `from` or `to`.
			* @param value - current `YYYY-MM-DD` value.
			* @returns the label element.
			*/
			function dateField(label, field, value) {
				const wrapper = document.createElement("label");
				wrapper.className = "dsh-sd-field";
				const text = document.createElement("span");
				text.textContent = label;
				const input = document.createElement("input");
				input.type = "date";
				input.dataset.field = field;
				input.value = value;
				wrapper.append(text, input);
				return wrapper;
			}

			/** Open the panel next to the trigger. */
			function openPanel() {
				if (trigger === null) return;
				ensurePanel();
				state.open = true;
				renderPanel();
				panel.hidden = false;
				positionPanel();
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown, true);
				window.addEventListener("resize", closePanel);
				void refreshCreatedAt(true);
			}

			/** Close the panel and release its global listeners. */
			function closePanel() {
				state.open = false;
				if (panel !== null) panel.hidden = true;
				document.removeEventListener("pointerdown", onPointerDown, true);
				document.removeEventListener("keydown", onKeyDown, true);
				window.removeEventListener("resize", closePanel);
			}

			/** Close on a pointer press outside the trigger and panel. @param event - pointer event. */
			function onPointerDown(event) {
				const target = event.target;
				if (!(target instanceof Node)) return;
				if (panel !== null && panel.contains(target)) return;
				if (trigger !== null && trigger.contains(target)) return;
				closePanel();
			}

			/** Close on Escape. @param event - key event. */
			function onKeyDown(event) {
				if (event.key === "Escape") closePanel();
			}

			/** Place the panel under the trigger, flipping and clamping at the viewport edges. */
			function positionPanel() {
				if (panel === null || trigger === null || panel.hidden) return;
				const rect = trigger.getBoundingClientRect();
				const width = panel.offsetWidth;
				const height = panel.offsetHeight;
				const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
				const below = rect.bottom + 6;
				const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 6);
				panel.style.left = `${Math.round(left)}px`;
				panel.style.top = `${Math.round(top)}px`;
			}
			//#endregion

			//#region lifecycle
			ctx.effect(() => {
				const style = document.createElement("style");
				style.setAttribute(STYLE_ATTRIBUTE, "");
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => style.remove();
			}, "dsh-raindrop-plugin: inject stylesheet");

			ctx.effect(() => {
				// Only mutations that can change the sidebar matter: chat streaming must
				// not re-run the scan on every token. Header mutations matter because
				// React may drop the injected trigger on a re-render.
				const touchesSidebar = (records) => {
					for (const record of records) {
						const target = record.target instanceof Element ? record.target : record.target.parentElement;
						if (target !== null) {
							if (target.closest(ROW_SELECTOR) !== null) return true;
							if (target.closest('[class*="_headerActions"]') !== null) return true;
						}
						if (record.type !== "childList") continue;
						for (const node of record.addedNodes) {
							if (node instanceof Element && (node.matches(ROW_SELECTOR) || node.querySelector(ROW_SELECTOR) !== null)) return true;
						}
						for (const node of record.removedNodes) {
							if (!(node instanceof Element)) continue;
							if (node.matches(`[${TRIGGER_ATTRIBUTE}]`) || node.querySelector(`[${TRIGGER_ATTRIBUTE}]`) !== null) return true;
						}
					}
					return false;
				};
				// The composer's model trigger carries `data-provider-id`; watch it (and
				// its mount/unmount) so a model switch updates the own-quota strip at once.
				const touchesComposer = (records) => {
					for (const record of records) {
						const target = record.target instanceof Element ? record.target : record.target.parentElement;
						if (target !== null && (target.closest("[data-provider-id]") !== null || target.closest('button[aria-haspopup="menu"]') !== null)) return true;
						if (record.type !== "childList") continue;
						for (const node of record.addedNodes) {
							if (!(node instanceof Element)) continue;
							if (node.matches('[data-provider-id], button[aria-haspopup="menu"]')) return true;
							if (node.querySelector('[data-provider-id], button[aria-haspopup="menu"]') !== null) return true;
						}
						for (const node of record.removedNodes) {
							if (!(node instanceof Element)) continue;
							if (node.matches('[data-provider-id], button[aria-haspopup="menu"]')) return true;
							if (node.querySelector('[data-provider-id], button[aria-haspopup="menu"]') !== null) return true;
						}
					}
					return false;
				};
				const observer = new MutationObserver((records) => {
					if (touchesSidebar(records)) schedule();
					if (touchesComposer(records)) updateQuotaBanner();
				});
				observer.observe(document.body, {
					childList: true,
					subtree: true,
					characterData: true,
					attributes: true,
					attributeFilter: ["aria-hidden", "data-row-key", "data-provider-id", "data-model-id"],
				});
				const unsubscribe = sessions.list.subscribe(() => {
					schedule();
					updateQuotaBanner();
					void refreshCreatedAt(false);
				});
				const offLocale = ctx.on("locale/change", () => {
					if (state.open) renderPanel();
					updateQuotaBanner();
					schedule();
				});
				schedule();
				updateQuotaBanner();
				void refreshCreatedAt(true);
				return () => {
					disposed = true;
					observer.disconnect();
					unsubscribe();
					offLocale?.();
					if (frame !== 0) {
						if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
						else clearTimeout(frame);
					}
					closePanel();
					if (panel !== null) panel.remove();
					panel = null;
					if (triggerHolder !== null) triggerHolder.remove();
					triggerHolder = null;
					trigger = null;
					if (emptyHint !== null) emptyHint.remove();
					emptyHint = null;
					if (quotaBanner !== null) quotaBanner.remove();
					quotaBanner = null;
					quotaShown = false;
					document.getElementById("root")?.removeAttribute(QUOTA_ROOT_ATTRIBUTE);
					for (const parent of sortedParents) clearSorting(parent);
					sortedParents = new Set();
					for (const element of document.querySelectorAll(`[${DATE_ATTRIBUTE}], [${HIDDEN_ATTRIBUTE}], [${GROUP_HIDDEN_ATTRIBUTE}]`)) {
						element.removeAttribute(DATE_ATTRIBUTE);
						element.removeAttribute(HIDDEN_ATTRIBUTE);
						element.removeAttribute(GROUP_HIDDEN_ATTRIBUTE);
					}
				};
			}, "dsh-raindrop-plugin: sidebar dates and date view");

			ctx.effect(() => {
				const queries = new WeakMap();

				/**
				* Whether one portal menu is the workspace picker (its footer carries the
				* localized "Add workspace…" entry; no other menu has that footer).
				* @param menu - candidate `[role="menu"]` element.
				* @returns true for the workspace picker menu.
				*/
				const isPickerMenu = (menu) => {
					if (!(menu instanceof Element) || menu.getAttribute("role") !== "menu") return false;
					const footer = menu.querySelector(':scope > [class*="_footer"]');
					return footer !== null && /添加工作区|Add workspace/i.test(footer.textContent ?? "");
				};

				/**
				* Filter the picker to workspace labels containing the typed text.
				* Only row attributes change; never add a foreign child to the menu root
				* (that trips React's reconcile and freezes the page). The no-match
				* feedback rides on the input's own attributes instead.
				* @param menu - the enhanced picker menu.
				*/
				const filterMenu = (menu) => {
					const viewport = menu.querySelector(':scope > [class*="_viewport"]');
					if (viewport === null) return;
					const input = viewport.querySelector(`[${WS_INPUT_ATTRIBUTE}]`);
					if (!(input instanceof HTMLInputElement)) return;
					const query = (queries.get(menu) ?? input.value).trim().toLowerCase();
					const entries = [];
					for (const child of viewport.children) {
						if (child === input) continue;
						const button = child.querySelector?.('button[role="menuitem"]');
						if (button === null || button === undefined) continue;
						const label = button.querySelector('[class*="_itemLabel"]')?.textContent ?? button.textContent ?? "";
						entries.push({ child, button, label });
					}
					let matches = 0;
					let firstMatch;
					for (const entry of entries) {
						const hit = query === "" || entry.label.toLowerCase().includes(query);
						if (hit) matches += 1;
						if (query === "") {
							entry.child.removeAttribute(WS_HIDDEN_ATTRIBUTE);
							entry.button.removeAttribute(WS_MATCH_ATTRIBUTE);
						} else if (hit) {
							entry.child.removeAttribute(WS_HIDDEN_ATTRIBUTE);
							entry.button.setAttribute(WS_MATCH_ATTRIBUTE, "");
							if (firstMatch === undefined) firstMatch = entry;
						} else {
							entry.child.setAttribute(WS_HIDDEN_ATTRIBUTE, "");
							entry.button.removeAttribute(WS_MATCH_ATTRIBUTE);
							entry.button.removeAttribute(WS_ACTIVE_ATTRIBUTE);
						}
					}
					const noMatch = query !== "" && matches === 0;
					if (noMatch) {
						input.setAttribute("data-dsh-ws-nomatch", "");
						input.setAttribute("aria-invalid", "true");
						input.title = t().wsEmpty;
					} else {
						input.removeAttribute("data-dsh-ws-nomatch");
						input.removeAttribute("aria-invalid");
						input.removeAttribute("title");
					}
					if (firstMatch !== undefined) {
						const menuRect = menu.getBoundingClientRect();
						const buttonRect = firstMatch.button.getBoundingClientRect();
						if (buttonRect.top < menuRect.top || buttonRect.bottom > menuRect.bottom) {
							firstMatch.button.scrollIntoView({ block: "nearest" });
						}
					}
					fitMenuHeight(menu, matches, input);
				};

				/**
				* Cap the picker at five workspace rows and let the viewport scroll; the
				* search field stays sticky at the top and the add footer stays put.
				* @param menu - the enhanced picker menu.
				* @param matches - number of visible workspaces.
				* @param input - the injected search field.
				*/
				const fitMenuHeight = (menu, matches, input) => {
					const viewport = menu.querySelector(':scope > [class*="_viewport"]');
					if (viewport === null) return;
					const footer = menu.querySelector(':scope > [class*="_footer"]');
					const menuStyle = getComputedStyle(menu);
					const inputStyle = getComputedStyle(input);
					const footerStyle = footer === null ? null : getComputedStyle(footer);
					const padding = (parseFloat(menuStyle.paddingTop) || 0) + (parseFloat(menuStyle.paddingBottom) || 0);
					const inputHeight = input.getBoundingClientRect().height + (parseFloat(inputStyle.marginBottom) || 0);
					const footerHeight = footer === null ? 0 : footer.getBoundingClientRect().height + (parseFloat(footerStyle?.marginTop ?? "0") || 0);
					const rows = Math.min(5, Math.max(0, matches));
					const desired = Math.ceil(padding + inputHeight + rows * 34 + footerHeight + 2);
					const height = Math.max(48, Math.min(desired, window.innerHeight - 24));
					menu.style.height = `${height}px`;
					menu.style.maxHeight = `${height}px`;
					menu.style.overflow = "hidden";
				};

				/**
				* Insert the search field into one picker menu and keep its filter applied.
				* Re-runs after React re-renders the menu; the query survives in the WeakMap.
				* @param menu - candidate `[role="menu"]` element.
				*/
				const ensureMenu = (menu) => {
					if (!isPickerMenu(menu)) return;
					const viewport = menu.querySelector(':scope > [class*="_viewport"]');
					if (viewport === null) return;
					let input = viewport.querySelector(`[${WS_INPUT_ATTRIBUTE}]`);
					if (input === null) {
						input = document.createElement("input");
						input.setAttribute(WS_INPUT_ATTRIBUTE, "");
						input.type = "text";
						input.className = "dsh-ws-search";
						input.placeholder = t().wsPlaceholder;
						input.setAttribute("aria-label", t().wsPlaceholder);
						input.value = queries.get(menu) ?? "";
						viewport.prepend(input);

						const matchButtons = () => [...viewport.querySelectorAll(`button[${WS_MATCH_ATTRIBUTE}]`)];
						const setActive = (button) => {
							for (const active of viewport.querySelectorAll(`button[${WS_ACTIVE_ATTRIBUTE}]`)) active.removeAttribute(WS_ACTIVE_ATTRIBUTE);
							if (button instanceof HTMLElement) {
								button.setAttribute(WS_ACTIVE_ATTRIBUTE, "");
								button.scrollIntoView({ block: "nearest" });
							}
						};
						const moveActive = (delta) => {
							const buttons = matchButtons();
							if (buttons.length === 0) return;
							const current = buttons.findIndex((button) => button.hasAttribute(WS_ACTIVE_ATTRIBUTE));
							const next = current < 0 ? (delta > 0 ? 0 : buttons.length - 1) : Math.min(Math.max(current + delta, 0), buttons.length - 1);
							setActive(buttons[next]);
						};
						// The menu's own document-capture handler would focus the first
						// button and then walk into hidden rows. Intercept arrows at the
						// window capture phase, before that handler, and keep focus in the
						// input so typing can continue.
						const onWindowKeyDown = (event) => {
							if (!input.isConnected) {
								window.removeEventListener("keydown", onWindowKeyDown, true);
								return;
							}
							if (document.activeElement !== input) return;
							if (event.isComposing) return;
							if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
							if (input.value.trim() === "") return;
							event.preventDefault();
							event.stopImmediatePropagation();
							if (event.key === "Home") setActive(matchButtons()[0]);
							else if (event.key === "End") setActive(matchButtons().at(-1));
							else moveActive(event.key === "ArrowDown" ? 1 : -1);
						};
						const addWindowKeyDown = () => window.addEventListener("keydown", onWindowKeyDown, true);
						const removeWindowKeyDown = () => window.removeEventListener("keydown", onWindowKeyDown, true);
						input.addEventListener("focus", addWindowKeyDown);
						input.addEventListener("blur", removeWindowKeyDown);
						input.addEventListener("input", () => {
							queries.set(menu, input.value);
							setActive(null);
							filterMenu(menu);
							viewport.scrollTop = 0;
						});
						input.addEventListener("keydown", (event) => {
							const query = input.value.trim().toLowerCase();
							if (event.key === "Enter" && !event.isComposing) {
								if (query === "") return;
								event.preventDefault();
								const buttons = matchButtons();
								const exact = buttons.find((button) => {
									const label = button.querySelector('[class*="_itemLabel"]')?.textContent ?? button.textContent ?? "";
									return label.trim().toLowerCase() === query;
								});
								const active = viewport.querySelector(`button[${WS_ACTIVE_ATTRIBUTE}]`);
								(active ?? exact ?? buttons[0])?.click();
							}
						});
						requestAnimationFrame(() => {
							if (input.isConnected) input.focus();
							if (document.activeElement === input) addWindowKeyDown();
						});
					} else {
						input.placeholder = t().wsPlaceholder;
					}
					filterMenu(menu);
				};

				const observer = new MutationObserver((records) => {
					for (const record of records) {
						if (record.type !== "childList") continue;
						const target = record.target instanceof Element ? record.target : record.target.parentElement;
						const current = target?.closest?.('[role="menu"]');
						if (current !== null && current !== undefined) ensureMenu(current);
						for (const node of record.addedNodes) {
							if (!(node instanceof Element)) continue;
							if (node.matches?.('[role="menu"]')) ensureMenu(node);
							for (const nested of node.querySelectorAll?.('[role="menu"]') ?? []) ensureMenu(nested);
						}
					}
				});
				observer.observe(document.body, { childList: true, subtree: true });
				return () => {
					observer.disconnect();
					for (const input of document.querySelectorAll(`[${WS_INPUT_ATTRIBUTE}]`)) input.remove();
					for (const row of document.querySelectorAll(`[${WS_HIDDEN_ATTRIBUTE}], [${WS_MATCH_ATTRIBUTE}], [${WS_ACTIVE_ATTRIBUTE}]`)) {
						row.removeAttribute(WS_HIDDEN_ATTRIBUTE);
						row.removeAttribute(WS_MATCH_ATTRIBUTE);
						row.removeAttribute(WS_ACTIVE_ATTRIBUTE);
					}
				};
			}, "dsh-raindrop-plugin: workspace picker search");
		}

		exports.apply = apply;
		exports.inject = inject;
		//#endregion
		return module.exports;
	},
});
