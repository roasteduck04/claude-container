# CLAUDE.md

Context for Claude (or any AI coding agent) working in this repository.

## What this is

An Electron desktop shell that puts a workspace-style rail on the left of
claude.ai, so a user can run several **fully isolated** Claude sessions
(different accounts/orgs) in one window and switch between them by clicking
a badge — similar to Slack's server switcher, or Firefox Multi-Account
Containers but as a standalone app instead of a browser extension.

There is no build step, no bundler, no framework. It's plain Node.js +
Electron + vanilla HTML/CSS/JS. Keep it that way unless there's a strong
reason not to — this project is small enough that a bundler would add more
friction than value.

## Architecture

Three processes/contexts, standard Electron split:

- **`main.js`** — the main (Node) process. Owns the `BrowserWindow`, creates
  one `BrowserView` per container, positions/resizes them, persists the
  container list to disk, and answers IPC calls from the renderer. This is
  the only file with filesystem/Node access.
- **`preload.js`** — runs in an isolated context with access to both Node
  and the renderer's `window`. Its only job is exposing a narrow
  `window.containerAPI` surface via `contextBridge`. Never widen this to
  expose raw `ipcRenderer` or Node APIs directly to the renderer.
- **`renderer/`** — the rail UI (`index.html`, `style.css`, `renderer.js`).
  Sandboxed, `contextIsolation: true`, `nodeIntegration: false`. Only talks
  to the outside world through `window.containerAPI`.

Each container's actual claude.ai page is **not** part of the renderer DOM —
it's a separate `BrowserView` that Electron composites into the same
window, positioned to the right of the rail (`x: RAIL_WIDTH`). This is what
gives real storage isolation: each `BrowserView` is constructed with a
different `partition: persist:container-<id>`, so Chromium gives each one
its own cookie jar / localStorage / IndexedDB, persisted to disk under
Electron's `userData/Partitions/`.

### IPC contract (`preload.js` ↔ `main.js`)

All calls are `ipcRenderer.invoke` / `ipcMain.handle` (request/response),
plus one push event:

| Channel | Direction | Purpose |
|---|---|---|
| `get-state` | renderer → main | fetch `{ containers, activeId, loadedIds, loadingIds, crashedIds }` on boot |
| `switch-container` | renderer → main | show a given container's BrowserView |
| `add-container` | renderer → main | create container + BrowserView, switch to it |
| `rename-container` | renderer → main | update name only |
| `remove-container` | renderer → main | delete container, clear its partition's storage |
| `unload-container` | renderer → main | destroy a background container's BrowserView to free RAM, keep it in the list |
| `get-settings` | renderer → main | fetch the current settings object on boot / opening the Settings modal |
| `save-settings` | renderer → main | merge a partial patch into settings, persist, apply side effects (e.g. `alwaysOnTop`) |
| `reload-active` | renderer → main | `webContents.reload()` on the active BrowserView |
| `overlay-open` / `overlay-close` | renderer → main | detach/reattach the active BrowserView so in-rail modals aren't painted over |
| `state-changed` | main → renderer (push) | keeps the rail in sync whenever main changes container/load state internally (auto-unload, menu actions, etc.) |
| `open-settings` | main → renderer (push) | the `Settings…` menu item (Cmd/Ctrl+,) asking the rail to open its Settings modal |

If you add a new IPC channel, add it to this table.

### Settings (`settings.json`)

Same plain-JSON pattern as `containers.json`, written to
`userData/settings.json`. Holds user-editable preferences
(`autoUnloadEnabled`, `autoUnloadSeconds`, `confirmBeforeDelete`,
`resumeLastActiveContainer`, `alwaysOnTop`, `showUsageOverlay`) plus a
**Performance & memory** group (`disableGpu`, `capRendererHeap` +
`rendererHeapMb`, `extraChromiumFlags`, `maxLoadedContainers` +
`maxLoadedCount`, `ecoMode`) and main-process-managed fields
(`lastActiveId`, `windowBounds`, `windowMaximized`, `containerZoom`)
updated automatically so the app restores where you left off. Defaults live
in `DEFAULT_SETTINGS` in `main.js` — add new settings there, not just in the
renderer form.

The first three Performance & memory settings are **startup flags** — they
map to `app.disableHardwareAcceleration()` / `--max-old-space-size` /
Chromium `appendSwitch` calls that must run *before* `app.whenReady()`.
That's why `loadSettings()` + `applyStartupFlags()` run synchronously at the
top of `main.js`, and why toggling them in the UI only takes effect after a
restart (the renderer labels them accordingly). `ecoMode` /
`maxLoadedContainers` are runtime instead: `enforceLoadedLimit()` LRU-evicts
background views (using the `inactiveSince` map as the recency order) after
every switch and whenever the cap changes.

The auto-unload feature itself is a `setInterval` in `main.js`
(`startAutoUnloadScheduler`) that ticks every 2s and checks an in-memory
`inactiveSince` map (`containerId -> timestamp it was backgrounded`) against
`settings.autoUnloadSeconds`. It shares the same `unloadContainerById()`
helper as the manual "Unload (free RAM)" action and the "Unload All
Inactive Containers" menu item, so all three paths stay consistent.

### State that must stay in sync

- `RAIL_WIDTH` is defined in **two places**: `main.js` (used for
  `BrowserView.setBounds`) and `renderer/style.css` (`#rail { width }`).
  Change both together or the rail and the BrowserView will visually
  overlap/gap.
- The rail rerenders from whatever `main.js` returns after every IPC call —
  the renderer never mutates `state.containers` locally except through a
  response from main. Don't add optimistic local updates without also
  reconciling against the next `get-state`/response, or the two can drift.

## Commands

```bash
npm install     # pulls electron + electron-builder (electron's postinstall
                 # downloads a prebuilt Chromium binary from GitHub releases —
                 # if this fails behind a corporate proxy/firewall, set
                 # ELECTRON_MIRROR or ELECTRON_GET_USE_PROXY)
npm start         # launch in dev mode
npm run make-icon # regenerate assets/icon.png + icon.ico (zero-dep, scripts/make-icon.js)
npm run dist      # package with electron-builder (see package.json "build")
```

For end users there are one-click wrappers — `start.bat` (Windows) and
`start.sh` (macOS/Linux) — that auto-install Node if missing, `npm install`
on first run, then `npm start`. The icon under `assets/` is generated (not
hand-authored); rerun `npm run make-icon` if the design changes. Note
`package.json` `build.files` must include `pulse-overlay/**` and `assets/**`,
since main.js reads the overlay source and the window icon at runtime.

There is no test suite and no linter configured yet (see README "What's
needed").

## Conventions / constraints to preserve

- **Never** set `nodeIntegration: true` or `contextIsolation: false` on the
  renderer `BrowserWindow`, and never set them on the per-container
  `BrowserView`s either — those load arbitrary remote content
  (claude.ai and whatever it links to), so they must stay sandboxed.
- Keep `setWindowOpenHandler` sending external links to `shell.openExternal`
  rather than letting new Electron windows spawn — this is a security
  boundary, not just a UX choice.
- Container config (`containers.json`) only ever stores `{ id, name, color
  }`. Never write session/auth data into it — that belongs in the
  partitioned session storage, which Electron manages for us.
- Same rule for `settings.json`: user preferences and `lastActiveId` only,
  never session/auth data.
- The rail's visual language (dark charcoal `--rail-bg`, terracotta
  `--accent`, squircle badges) is an intentional, restrained design — see
  the CSS custom properties at the top of `style.css` before introducing new
  colors.

## Known gaps

See the "Current limitations" and "What's needed" sections in `README.md` —
keep that document current when you close one of those items or discover a
new one; it's the source of truth for project status, not this file.
