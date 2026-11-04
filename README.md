# dsh-raindrop-plugin

A DSH web GUI plugin that shows each sidebar session's **calendar day** instead of a relative age ("just now / 5 min / 3 days"), plus a **Date view** panel in the sidebar header (pick which date the row shows, sort by date, filter by date range), a **search field in the new-session workspace picker**, a **project label above each sidebar Session title**, a **per-session git branch badge that restores the session's branch when it is opened again**, a **top alert while the selected model spends your own DeepSeek quota**, a **sidebar footer with the running and latest DSH versions**, and a **remembered sidebar width that survives refresh**.

![Sidebar date view](docs/preview.png)

```
before:  刚刚   5分钟   3小时   3天   2个月
after:   10月29日 10月29日 10月29日 10月26日 8月30日
```

Sessions outside the current year include the year (`2025年10月29日`); the English UI renders `Oct 29` / `Oct 29, 2025`.

## Features

- **Inline dates**: every session row ends with a calendar day (last activity by default, switchable to first conversation).
- **Workspace picker search**: opening the new-session workspace menu adds a search field at the top. The picker shows at most five workspaces at a time; the rest scroll, with the search field and the add-workspace footer staying visible. Typing filters the list to matching workspaces. `↑`/`↓` move the highlight, `Home`/`End` jump to the first/last match, and `Enter` switches to the highlighted row (or, when nothing is highlighted, the exact label, then the first match). With no match the field's underline turns orange and `Enter` does nothing.
- **Own-quota alert**: while the model selected for the conversation on screen is served by your own DeepSeek account (`deepseek-account` login route or `deepseek-official` API-key route), a fixed amber strip at the top of the window reads **“正在使用自己的额度！”** / **“You are using your own quota!”**. It disappears as soon as another provider is selected and never blocks the UI. Third-party gateways such as `qz` keep their own billing and do not trigger it.
- **DSH versions**: the sidebar footer's bottom row shows the **running** release (`当前` / `Current`) and npm's **latest** `@deepseek-ai/dsh` release (`最新` / `Latest`) beside the account, with a green `已是最新` / `Up to date` or amber `可更新` / `Update` badge. It refreshes every 15 minutes and hides when the sidebar is collapsed.
- **Sidebar width memory**: drag the left sidebar to any width between 264px and 420px; the plugin saves it and restores it after a refresh, so the session list keeps the column size you chose. Collapsed or narrow-mode widths are ignored, and the app's default remains the fallback.
- **Project label**: each Session row shows its workspace/project name above the title as a small light-blue label (light-blue text on a soft blue fill), so a flat session list reads `dsh-raindrop-plugin` / `DeepseekChatBack` / `SuperFish` at a glance. The full directory path is the hover title. The label sits on its own compact line, so it does not steal horizontal room from the Session title.
- **Session git version**: each Session records the git branch of its working directory when it is created, and its row shows a small light-green branch badge (the mismatch warning stays amber). Opening the Session again switches the directory back to that branch when the tree is clean; with uncommitted changes it only warns and leaves the working tree alone.
- **Date view panel**: the calendar button in the sidebar header, left of the native view-options sliders.
  - Show date: `Last activity` / `First message`
  - Sort by date: `Default (sidebar order)` / `Date: newest first` / `Date: oldest first`
  - Filter by date: `All` / `Today` / `Last 7 days` / `Last 30 days` + a custom `from`/`to` range
  - `Clear filter`
- Preferences persist in `localStorage` across reloads.
- Sorting and filtering apply to the rows currently rendered. In workspace-grouped mode, each expanded workspace is sorted internally; collapsed workspaces are not expanded automatically.
- "First message" is the Session header's `createdAt` (read on the Host). If a blank draft is left unused for days before its first prompt, that day can precede the first message. Exact first-user-message time would require scanning the full log and is not implemented.

## Own-quota alert

![Own-quota alert](docs/own-quota.png)

The alert follows the **model selected for the conversation on screen**, not a global account state: switch the model to a third-party provider and it goes away; switch back to a `DeepSeek 账号` model and it returns. The same strip stays visible while you visit the plugin manager or other entry pages, so navigating around the app does not hide the fact that the next request will spend your own balance.

The providers that count as “own quota” are one constant at the top of [`lib/client.js`](lib/client.js):

```js
const OWN_QUOTA_PROVIDERS = new Set(["deepseek-account", "deepseek-official"]);
```

`deepseek-account` is the DeepSeek account-login route and `deepseek-official` is the official API-key route. Add a provider id (for example `"qz"`) to warn about a third-party account as well, or remove one to stop warning about it. The ids are the same `data-provider-id` values the model picker exposes; the plugin never reads an API key, an account token, or the account balance.

## DSH versions

![DSH versions](docs/dsh-versions.png)

The sidebar footer's bottom row shows both releases beside the account (on a narrow sidebar the block stacks below the account):

- **Current** comes from the open page's boot manifest (`window.__DSH_BOOT__.release`), so it names exactly the build the tab is running, including its commit in the hover title.
- **Latest** comes from npm's `latest` dist-tag. The Host half serves it at `GET /dsh-version/latest` with a 10-minute cache and reuses a stale successful read when npm is temporarily unreachable; if that route is absent, the browser falls back to the public npm manifest.
- A green `已是最新` / `Up to date` badge means the two strings match; amber `可更新` / `Update` means they differ; `检查中…` / `Checking…` is the first request; `获取失败` / `Failed` means neither source answered. The row refreshes every 15 minutes while the page stays open and follows the interface language.
- The block is hidden while the sidebar is collapsed. It only reads version strings — it never installs, updates, or touches account data.

## Sidebar width

The left sidebar can be dragged between 264px and 420px, but the app's layout store starts at 280px on every load. The plugin remembers the width you last dragged in `localStorage` (`dsh-raindrop-plugin:sidebar-width`) and restores it after the frame mounts, so a refresh does not squeeze the session list back to the default.

- A drag saves the clamped width after a 200ms debounce. Values outside 264–420 (collapsed or narrow mode) are ignored, so a saved width never forces the sidebar open.
- The restore uses the layout frame's `setSidebar` action; the public `ctx.layout` service only exposes the collapse toggle. If the frame shape changes, the feature no-ops and the app keeps its default width.
- Clearing site storage forgets the remembered width.

## Project label

![Session project label](docs/session-project.png)

Every Session row carries a small light-blue project label directly above its title: light-blue text on a soft blue fill. The label answers the question a flat, cross-workspace session list cannot: which project does this conversation belong to?

- **Name source**: the Session's workspace title first (workspace membership in the public `workspaces` store), then the longest matching workspace path for the Session's `cwd`, then the workspace group header already around the row, then the final segment of `cwd`.
- **Full path**: hover the title line; its native tooltip is the workspace (or session) directory. The label never exposes prompts, messages, or credentials.
- **Layout**: the label and a slightly tighter title line share the row's existing 32px height (a 9px label line plus a 17px title line). The title keeps its full width; the label does not compete with the date or the git branch badge on the right.
- **Updates**: the label is re-stamped when the sessions list or the workspaces list changes, and on locale or layout re-render. A session without a workspace or a usable `cwd` simply has no label; nothing else changes.

## Session git version

When a Session is created, the Host half reads the branch of its `cwd` and stores it in `$DSH_HOME/storages/raindrop-plugin-session-git.json`. The file only maps `sessionId → { branch, directory }`; it holds no commits, files, or prompts.

- **Badge**: a small light-green branch pill (for example `dev-20261011`) sits left of the clock cell in the Session row; hovering shows the full name. While the row is hovered the cell makes way for the native action buttons.
- **Mismatch**: when the directory's current branch differs from the recorded one, the pill turns amber and its tooltip names both branches.
- **Automatic restore**: opening (or switching to) a Session re-reads the real branch:
  - same → nothing happens;
  - different and the tree is clean → `git switch <recorded branch>`, a green notice appears at the bottom, and the badge refreshes;
  - different with a dirty tree (untracked files included) → no switch, an amber notice explains why; clean up and switch back to the Session to retry;
  - deleted branch, non-repository directory, or detached HEAD → notice only, no switch.
- Restores only address Sessions this plugin recorded: the request carries just a `sessionId`, and both the directory and branch come from the Host's own store, so it cannot be used to check out an arbitrary directory or ref.
- Recording happens at creation time. Sessions that predate the plugin are backfilled on first sight and flagged `inferred`.

## Install

From npm (recommended):

```bash
dsh plugin --profile web add dsh-raindrop-plugin
```

From a local checkout (link, for development):

```bash
dsh plugin --profile web add /absolute/path/to/dsh-raindrop-plugin
```

The package declares `dsh.bundle.patch`, so the plugin manager installs it as a profile bundle, inserts the `ui-raindrop-plugin` row, and records it in `dsh.profile.bundles`. Refresh the browser tab after installing. No rebuild is needed — `lib/client.js` is hand-written in the same module format as the shipped client bundles.

After editing the **Host half** (`lib/index.js`) of an installed link package, `dsh web` replaces it on the next profile reload — edit `~/.dsh/profiles/<name>/cordis.patch.yml` once (for example add and remove a comment), or restart `dsh web`. Client-only changes just need a page refresh. Registry installs are plain copies, so reinstall to pick up edits.

To remove it:

```bash
dsh plugin --profile web remove dsh-raindrop-plugin
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

`SHOW_YEAR` controls when the year is included: `auto` (only outside the current year), `always`, or `never`. With a link install, save the file and refresh the tab — no reinstall, no rebuild. A registry install is a copy, so reinstall the package after editing.

The plugin can also be switched off entirely from the GUI's plugin settings, like any profile bundle.

## How it works

`@deepseek-ai/dsh-client-ui-workspace` ships only a bundled `lib/client.js`; neither the row clock nor the header action list is a slot, so there is no declarative seam. The plugin uses the UI's own stable contracts:

**Inline dates**

1. `ctx.sessions` supplies `byId[id].updatedAt`; the first-conversation day comes from this package's Host route (`createdAt`).
2. Each `[data-row-key="session:<id>"]` row's clock span (CSS-module local `_time`) gets a `data-dsh-session-date` attribute with the formatted day.
3. An injected stylesheet hides the relative text (`font-size: 0`) and paints the stamped day through `::after { content: attr(...) }`. React keeps owning its text nodes; the plugin never rewrites them.
4. A filtered `MutationObserver` (session rows and the sidebar header only) plus a `ctx.sessions.list` subscription re-stamp rows on list changes, new rows, pending-activity transitions, and locale switches. Pending rows (`aria-hidden="true"`) keep their status label.

**Sorting and filtering**

5. While date sorting is on, the rows' direct parent temporarily becomes a flex column and each row wrapper gets a CSS `order`. React keeps owning document order; no node is moved.
6. Rows outside the range get one hidden attribute; a workspace section whose sessions are all filtered out is hidden, and an empty-range notice appears at the top of the list.

**Host routes**

7. The browser cannot see `createdAt` (`session.list` only carries `updatedAt`), so the Host half reads durable headers through the public `sessionQuery.listSessions()` and serves `GET /session-date/dates` as `{ sessions: { [id]: createdAt }, fetchedAt }`. The route passes `connection.authorizeIndex` (401 without the browser session cookie) and exposes only ids and creation instants — no titles, prompts, or paths — with a 15 s cache.
8. The second authenticated route, `GET /dsh-version/latest`, returns `{ latest, checkedAt, stale? }` from npm's `@deepseek-ai/dsh/latest` manifest. It uses an 8 s deadline, caches success for 10 minutes and failure for 60 s, and prefers a stale successful read over an error so an offline page keeps the last known version.

**Own-quota alert**

9. The composer's model label carries `data-provider-id` (the documented `conversation.input.model.label` contract), which is the live source. When no composer is mounted (plugin manager, settings), the selected Session's durable `projectionValues.modelSelection.next` / `lastUsed` from `ctx.sessions.list` stands in, and the last known provider bridges the gap while navigating.
10. The warning is a body-level fixed strip. Showing it adds a `data-dsh-own-quota` attribute to `#root`, whose stylesheet rule reserves the 32px top band while the strip is fixed over that band; hiding it removes the attribute and the frame returns to its previous height. No React-owned node is moved or replaced.

**DSH versions**

11. The current release comes from `window.__DSH_BOOT__.release` (version plus optional commit) — the same identity the module system uses, so it follows the build actually running in the tab rather than a package path.
12. The latest release comes from the Host route above, with the public npm manifest as a browser fallback. The footer block is inserted before `sidebar.settings` in the footer DOM; the stylesheet places it in the bottom grid to the right of the account (below it on a narrow sidebar). It is re-ensured when the footer re-renders, hidden under the sidebar's collapsed class, and refreshed every 15 minutes.

**Session git version**

13. The Host half listens to the public `session/created` event and records `git -C <header.cwd> rev-parse --abbrev-ref HEAD`; Sessions that predate the plugin are backfilled the first time `GET /session-git/branches` sees them, and a directory that is not a repository is not retried for ten minutes.
14. `GET /session-git/branches` returns `{ sessions: { [id]: { branch, cwd, inferred, detached } }, current: { [cwd]: branch }, fetchedAt }`. `current` lets the browser mark mismatches without running git; the body is cached for five seconds.
15. `POST /session-git/restore` accepts only `{ sessionId }`: it re-reads the real branch and runs `git switch` (or `checkout` on older git) only when `git status --porcelain` is clean and the branch still exists. Requests for the same directory are serialized so two opens cannot race one checkout. The light-green badge and the date share the row's clock `<span>` (`::before` for the branch, `::after` for the date); no React-managed node is inserted or moved.

**Session project label**

16. The public `ctx.get("workspaces")` store lists workspaces with `title`, `path`, and `sessionIds`. The plugin first resolves a Session by membership, then by the longest workspace `path` that prefixes `cwd`, then by the workspace group header around the row, then by the final `cwd` segment. The full resolved path becomes the title span's native tooltip.
17. The title span (CSS-module local `_title`) gets `data-dsh-session-project`; a stylesheet paints the name as a light-blue 9px label line above the title and tightens that row's title line to 17px, so the existing 32px row fits both. No React-managed text node or child is inserted, and the label re-stamps with the sessions and workspaces stores.

**Sidebar width**

18. The layout store does not persist `layoutInfo.sidebar`. The plugin stores the last valid width (264–420) in localStorage and, once the frame mounts, finds the `actions` bag on the frame's React fiber (the public `ctx.layout` service only exposes `toggleSidebar`, not `setSidebar`) and calls `actions.setSidebar(saved)`. A `MutationObserver` on the frame's inline `grid-template-columns` saves later drag widths after a 200ms debounce; collapsed/narrow widths are ignored. No React nodes are moved; if the fiber/action shape is unavailable, the feature no-ops.

If a future DSH build renames the CSS-module local, the plugin falls back to the row's third direct `<span>` for the clock and its second direct `<span>` for the title; if the row structure changes entirely, it becomes a no-op rather than mangling the row. Sorting/filtering likewise only engages when the structure matches.

## Compatibility

Written against DSH `0.2.1-rc.5` (web profile). The client half needs the `sessions` service; the Host half needs `webServer`, `connection`, and optionally `sessionQuery` (when absent, the dates route returns an empty map and dates fall back to last activity). The project label optionally reads the public `workspaces` service; without it, the workspace group header or the Session `cwd` still supplies a name. The own-quota alert uses the model label's `data-provider-id` or the Session `modelSelection` projection; when neither exists it stays out of the way. The version row uses `window.__DSH_BOOT__.release` and the npm-backed Host route; an offline Host shows the failure state rather than blocking the UI. The sidebar width memory uses the layout frame's internal action bag; if absent, the sidebar keeps the app's default width. The session git version relies on the public `session/created` event, `sessionQuery`, and a working `git` executable; a non-repository directory, a missing git, or a missing event just means no badge and no automatic switch.
