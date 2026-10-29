# dsh-session-date

A DSH web GUI plugin that shows each sidebar session's **calendar date** instead of a relative age ("刚刚 / 5分钟 / 3天 / 2个月").

![Sidebar session dates](docs/preview.png)

```
before:  刚刚   5分钟   3小时   3天   2个月
after:   10月29日 10月29日 10月29日 10月26日 8月30日
```

Other-year sessions include the year (`2025年10月29日`); English UI renders `Oct 29` / `Oct 29, 2025`.

## What it touches

- The row clock in the left sidebar session tree (all grouping modes: by workspace, workspace tree, flat).
- Nothing else: titles, hover cards, search results, ordering, and the session store are untouched.

## Install

```bash
# from this directory (a local, unbuilt package)
dsh plugin --profile web add /absolute/path/to/dsh-session-date
```

The package declares `dsh.bundle.patch`, so the plugin manager installs it as a profile bundle, inserts the `ui-session-date` row, and records it in `dsh.profile.bundles`. Refresh the browser tab after installing. No rebuild is needed — `lib/client.js` is hand-written in the same module format as the shipped client bundles.

To remove it:

```bash
dsh plugin --profile web remove dsh-session-date
```

## Changing the date style

The style is two constants at the top of [`lib/client.js`](lib/client.js):

```js
const FORMAT = "localized"; // localized | numeric | iso
const SHOW_YEAR = "auto";   // auto | always | never
```

| FORMAT | example |
| --- | --- |
| `localized` (default) | `10月29日` / `Oct 29` |
| `numeric` | `10-29` (year prefix per `SHOW_YEAR`) |
| `iso` | `2026-10-29` |

`SHOW_YEAR` controls when the year is included: `auto` (only outside the current year), `always`, or `never`. The package is installed as a link, so save the file and refresh the tab — no reinstall, no rebuild.

The plugin can also be switched off entirely from the GUI's plugin settings, like any profile bundle.

## How it works

`@deepseek-ai/dsh-client-ui-workspace` ships only a bundled `lib/client.js`; the row's clock is not a slot, so there is no declarative seam to replace it. This plugin therefore uses the row's own DOM contract:

1. `ctx.sessions` (the public session store) supplies `byId[id].updatedAt` — the exact timestamp the row formats.
2. Each `[data-row-key="session:<id>"]` row's clock span (CSS-module local `_time`) gets a `data-dsh-session-date` attribute with the formatted day.
3. An injected stylesheet hides the relative text on that span (`font-size: 0`) and paints the stamped day through `::after { content: attr(...) }`. React keeps owning its text nodes; the plugin never rewrites them, so re-renders cannot desync.
4. A filtered `MutationObserver` (only mutations inside session rows) and a `ctx.sessions.list` subscription re-stamp rows on list changes, new rows, and pending-activity transitions. Pending rows (`aria-hidden="true"`, e.g. "待审批") keep their status label.

If a future DSH build renames the CSS-module local, the plugin falls back to the row's third direct `<span>`; if the row structure changes entirely, it becomes a no-op rather than mangling the row.

## Compatibility

Written against DSH `0.2.1-rc.4` (web profile). Requires the `sessions` client service, present in every web profile.
