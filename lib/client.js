/**
 * dsh-session-date — browser half.
 *
 * The sidebar's session rows print a compact *relative* age ("刚刚", "5分钟",
 * "3天", "2个月"). This plugin replaces that label with the session's actual
 * calendar day ("10月29日", "2025年10月29日" for other years), so the sidebar
 * answers "which day was this?" without opening the hover card or doing
 * mental arithmetic.
 *
 * Why this shape:
 * - src for ui-workspace is not shipped, and the row's time label is not a
 *   slot: the only stable seam a plugin has is the row's DOM. The built row
 *   carries `data-row-key="session:<id>"` and one CSS-module span whose local
 *   name ends in `_time`, so this plugin locates that span and stamps it with
 *   a `data-dsh-session-date` attribute. A small injected stylesheet hides the
 *   relative text (`font-size: 0`) and renders the stamped date from
 *   `attr()` — React can keep re-rendering its own text underneath without
 *   fighting us, and no text node is ever replaced or removed.
 * - The date itself comes from the public `ctx.sessions` store
 *   (`list.getSnapshot().byId[id].updatedAt`), the same field the row formats,
 *   so a session that gets a new message refreshes its date immediately.
 * - Pending-activity rows replace the clock with a status label
 *   ("待审批"/"Plan review"). Those spans carry `aria-hidden="true"`; the
 *   plugin leaves them untouched and lifts its stamp when the row returns to
 *   the clock.
 *
 * Tuning: the date style is the two constants below. Edit them in place (the
 * package is installed as a link, so a browser refresh picks a change up):
 *   localised words ("10月29日" / "Oct 29")  or "numeric" ("10-29") or "iso".
 *   "auto" adds the year only for sessions outside the displayed year.
 */

window.__ModuleLoader__.load({
	id: "dsh-session-date",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		//#region constants and formatting
		/** Attribute carrying the rendered day; also the stylesheet's hook. */
		const DATE_ATTRIBUTE = "data-dsh-session-date";
		/** Marker distinguishing this plugin's injected stylesheet. */
		const STYLE_ATTRIBUTE = "data-dsh-session-date-style";
		/** Every top-level session row in the sidebar tree (search rows have no key). */
		const ROW_SELECTOR = "[data-row-key^='session:']";
		/** Prefix of the row key that addresses one Session id. */
		const SESSION_KEY_PREFIX = "session:";

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
`;

		/** Tuning knobs: localized | numeric | iso, and when the year appears. */
		const FORMAT = "localized";
		const SHOW_YEAR = "auto"; // auto | always | never

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
		//#endregion

		//#region DOM patching
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

		/**
		* Stamp one row with its day, or lift the stamp when the row shows something
		* other than a clock (pending activity, unknown Session summary).
		* @param row - Session row element.
		* @param snapshot - Current sessions list snapshot.
		* @param language - Active language id.
		* @param now - Current instant in epoch milliseconds.
		*/
		function stampRow(row, snapshot, language, now) {
			const span = findTimeSpan(row);
			if (span === undefined) return;
			const key = row.getAttribute("data-row-key") ?? "";
			const id = key.startsWith(SESSION_KEY_PREFIX) ? key.slice(SESSION_KEY_PREFIX.length) : "";
			const summary = id === "" ? undefined : snapshot.byId[id];
			// Pending rows print a status label where the clock normally sits; leave it alone.
			const label = summary === undefined || span.getAttribute("aria-hidden") === "true" ? "" : formatDay(summary.updatedAt, now, language);
			if (label === "") {
				if (span.hasAttribute(DATE_ATTRIBUTE)) span.removeAttribute(DATE_ATTRIBUTE);
				return;
			}
			if (span.getAttribute(DATE_ATTRIBUTE) !== label) span.setAttribute(DATE_ATTRIBUTE, label);
		}
		//#endregion

		//#region plugin
		/** Required service: the public sessions store this plugin reads timestamps from. */
		const inject = ["sessions"];

		/**
		* Install the stylesheet and keep every rendered session row stamped.
		* @param ctx - Client root context with `sessions` injected.
		*/
		function apply(ctx) {
			if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
			const sessions = ctx.get("sessions");
			if (sessions === undefined || sessions.list === undefined) return;

			ctx.effect(() => {
				const style = document.createElement("style");
				style.setAttribute(STYLE_ATTRIBUTE, "");
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => style.remove();
			}, "dsh-session-date: inject stylesheet");

			ctx.effect(() => {
				const read = () => ({
					snapshot: sessions.list.getSnapshot(),
					language: activeLanguage(ctx),
					now: Date.now(),
				});
				const scan = () => {
					const state = read();
					for (const row of document.querySelectorAll(ROW_SELECTOR)) stampRow(row, state.snapshot, state.language, state.now);
				};
				let frame = 0;
				const run = () => {
					frame = 0;
					scan();
				};
				const schedule = () => {
					if (frame !== 0) return;
					frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : setTimeout(run, 0);
				};
				// Only mutations that touch a session row matter: chat streaming must not
				// re-run the scan on every token.
				const touchesRows = (records) => {
					for (const record of records) {
						const target = record.target instanceof Element ? record.target : record.target.parentElement;
						if (target !== null && target.closest(ROW_SELECTOR) !== null) return true;
						if (record.type !== "childList") continue;
						for (const node of record.addedNodes) {
							if (node instanceof Element && (node.matches(ROW_SELECTOR) || node.querySelector(ROW_SELECTOR) !== null)) return true;
						}
					}
					return false;
				};
				const observer = new MutationObserver((records) => {
					if (touchesRows(records)) schedule();
				});
				observer.observe(document.body, {
					childList: true,
					subtree: true,
					characterData: true,
					attributes: true,
					attributeFilter: ["aria-hidden", "data-row-key"],
				});
				const unsubscribe = sessions.list.subscribe(schedule);
				const offLocale = ctx.on("locale/change", schedule);
				schedule();
				return () => {
					observer.disconnect();
					unsubscribe();
					offLocale?.();
					if (frame !== 0) {
						if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
						else clearTimeout(frame);
					}
					for (const span of document.querySelectorAll(`[${DATE_ATTRIBUTE}]`)) span.removeAttribute(DATE_ATTRIBUTE);
				};
			}, "dsh-session-date: sidebar session dates");
		}

		exports.apply = apply;
		exports.inject = inject;
		//#endregion
		return module.exports;
	},
});
