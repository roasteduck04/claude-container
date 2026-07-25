# Claude Containers

A small desktop shell that puts a container/profile switcher on the left of
claude.ai — like Slack's workspace rail — so you can run several **fully
isolated** Claude sessions (different accounts, different orgs) in one
window, instead of juggling separate browser profiles or windows.

Each container gets its own cookie jar, localStorage, and IndexedDB via
Electron's session partitioning. Logging into a different account in one
container never touches another. All containers stay loaded in the
background when you switch, so drafts and scroll position are preserved.

<br>

## Android

An experimental native Android port lives in [`android/`](android/). It
recreates the isolated multi-session concept using per-process WebView
storage (each container gets its own `setDataDirectorySuffix`, switched via a
process relaunch). See [`android/README.md`](android/README.md) to build and
install the APK.

<br>

## Features

- Icon rail on the left (badges with initials + a color you pick), claude.ai
  filling the rest of the window with its own sidebar intact.
- Click a badge to switch instantly — no page reload, the other container
  keeps running in the background.
- Hover a badge → **⋯** to rename, reload, or delete a container.
- Deleting a container clears its cookies/storage too — a real "forget this
  account," not just hiding it.
- Sessions persist across app restarts automatically.
- External links (e.g. something clicked inside a chat) open in your normal
  default browser instead of spawning stray in-app windows.
- **Usage limits overlay** — each container shows the same 5h/7d usage bars,
  token estimate, and cache countdown as the Claude Pulse browser extension
  (ported in, computed locally, no extra permissions).
- **Unload inactive containers** to free RAM — right-click a badge →
  "Unload (free RAM)", **View → Unload All Inactive Containers**, or let it
  happen automatically (see Settings below).
- **Keyboard shortcuts** — **Ctrl/Cmd+1..9** jumps straight to a container;
  **Ctrl/Cmd+ +/−/0** zooms the active container in/out/reset (zoom is
  remembered per container).
- **Loading & crash feedback** — a badge shows a spinner ring while its
  container is still loading, and a red `!` with "click to reload" if that
  container's renderer ever crashes.
- **Remembers your window** — size, position, and maximized state are
  restored on the next launch.
- **Settings panel** (gear icon at the bottom of the rail, or
  **View → Settings…** / Cmd/Ctrl+,):
  - **Auto-unload inactive containers** — on by default, unloads a
    backgrounded container after **20 seconds** to keep RAM use low. The
    threshold is editable (5–3600s), and the whole feature can be turned
    off if you'd rather every container stay loaded.
  - Resume last active container on launch (vs. always opening the first
    one in your list).
  - Confirm before deleting a container.
  - Show/hide the usage limits overlay.
  - Keep the window always on top.
  - **Performance & memory** group with the RAM-saving controls:
    - **Eco mode** — the absolute minimum: only the active container is ever
      loaded (every switch reloads, ~2–5s, losing scroll/draft).
    - **Limit loaded containers** — keep at most *N* in memory; switching
      beyond that auto-unloads your least-recently-used one (LRU).
    - **Disable GPU acceleration** — drops the separate GPU process
      (~100–150MB). *Restart required.*
    - **Cap renderer memory** — hard-caps each container's JS heap via
      `--max-old-space-size` (MB configurable). *Restart required.*
    - **Extra memory-saving Chromium flags** — turns off background
      networking, sync, default-apps, and component updates. *Restart
      required.*

<br>

## Quickest: one-click setup

If you just want it running, use the bundled setup-and-launch script — it
installs Node.js (if you don't have it), installs the app's dependencies the
first time, and launches the app. Every run after that, it just launches.

- **Windows:** double-click **`start.bat`**. (If Node isn't installed it uses
  `winget` to install it, then asks you to reopen and double-click again.)
- **macOS / Linux:** run **`./start.sh`** (first time: `chmod +x start.sh`,
  or just `bash start.sh`). On macOS it installs Node via Homebrew if you have
  it; otherwise it points you at nodejs.org.

That's it — skip the rest of this section unless something goes wrong or you
want to know what the script does under the hood.

<br>

## Install from scratch (manual)

This walks through everything the one-click script does, step by step, in case
you'd rather run it yourself or need to troubleshoot.

### 1. Install Node.js

The app runs on Electron, which needs Node.js (18 or newer) and its bundled
package manager, `npm`.

**Check if you already have it:**

```bash
node -v
npm -v
```

If both print a version number (and the Node version is 18.x or higher),
skip to step 2.

**Windows:**
1. Go to [nodejs.org](https://nodejs.org).
2. Download the **LTS** installer (`.msi`) — not "Current."
3. Run it, accepting the defaults (this also installs npm).
4. Open a **new** Command Prompt or PowerShell window (must be new, so it
   picks up the updated PATH) and confirm with `node -v`.

**macOS:**
- Easiest: download the **LTS** `.pkg` installer from
  [nodejs.org](https://nodejs.org) and run it.
- Or, if you use [Homebrew](https://brew.sh): `brew install node`.
- Confirm with `node -v` in a new Terminal window.

**Linux (Debian/Ubuntu):**
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```
Other distros: use your package manager (`dnf`, `pacman`, etc.) or the
[NodeSource](https://github.com/nodesource/distributions) instructions for
your distro. Confirm with `node -v`.

### 2. Get the project onto your machine

If you have the project as a `.zip` (e.g. downloaded from this
conversation), extract it anywhere convenient:

```bash
# macOS/Linux
unzip claude-containers.zip -d ~/claude-containers-app
cd ~/claude-containers-app/claude-containers
```

```powershell
# Windows (PowerShell)
Expand-Archive claude-containers.zip -DestinationPath $HOME\claude-containers-app
cd $HOME\claude-containers-app\claude-containers
```

Or on Windows, just right-click the `.zip` → **Extract All…**, then open
the extracted `claude-containers` folder in a terminal (Shift+right-click
inside the folder → "Open PowerShell window here", or `cd` to it manually).

If instead you're cloning from a git repository:

```bash
git clone <repo-url>
cd claude-containers
```

Either way, you should end up inside the folder that contains
`package.json` — running `ls` (or `dir` on Windows) here should show
`main.js`, `package.json`, `renderer/`, etc.

### 3. Install dependencies

```bash
npm install
```

This pulls down `electron` and `electron-builder` from npm — and, as part
of installing `electron`, downloads a prebuilt Chromium binary directly
from GitHub releases (separate from the npm registry itself). On a normal
connection this takes anywhere from ~30 seconds to a couple of minutes.

> **If `npm install` fails on the `electron` package specifically**
> (an HTTP 403/timeout on `node_modules/electron/install.js`):
> some corporate networks/proxies/sandboxes block GitHub's release-download
> host even when the npm registry itself is reachable. Either run
> `npm install` from a network without that restriction, or point Electron
> at a mirror with `ELECTRON_MIRROR` (see the
> [electron/get docs](https://github.com/electron/get)) before reinstalling.
> This is unrelated to your claude.ai login — it's purely a one-time
> download of the Electron runtime.

### 4. Run it

```bash
npm start
```

A window should open with a narrow dark rail on the left and claude.ai
filling the rest. The first launch creates one container called
**Personal** — log into claude.ai as you normally would inside it. Click
the `+` button at the bottom of the rail to add more containers (e.g. one
per account/org), and the gear icon below it to open **Settings**.

### 5. (Optional) Build a standalone app

If you want a double-clickable `.app` / `.exe` / `.AppImage` instead of
running `npm start` every time:

```bash
npm run dist
```

This uses `electron-builder` to produce an installer/binary in `dist/`,
matching whatever platform you build on (build on macOS for a `.dmg`, on
Windows for an `.exe`, on Linux for an `.AppImage`). This hasn't been
verified end-to-end and isn't code-signed — see "Current limitations"
below — so expect a Gatekeeper/SmartScreen warning on first launch of the
built app.

### Quick reference

```bash
cd claude-containers   # the folder containing package.json

# Easiest — does install + launch for you:
start.bat              # Windows (double-click, or run in a terminal)
./start.sh             # macOS/Linux (bash start.sh)

# ...or the underlying steps by hand:
npm install            # one-time setup
npm start               # run in development mode
npm run dist            # (optional) package a standalone app
```

<br>

## How it works

```
┌─────────────────────────────────────────────────────┐
│  BrowserWindow                                       │
│  ┌────────┐┌───────────────────────────────────────┐ │
│  │  rail  ││   active BrowserView (claude.ai)       │ │
│  │ (HTML  ││   partition: persist:container-<id>    │ │
│  │ render ││                                         │ │
│  │  -er)  ││   (other containers' BrowserViews are  │ │
│  │        ││    detached but still alive in memory) │ │
│  └────────┘└───────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

- **The rail is a normal renderer** (`renderer/index.html` + `style.css` +
  `renderer.js`), sandboxed with `contextIsolation: true` and
  `nodeIntegration: false`. It only talks to the main process through
  `window.containerAPI`, a narrow bridge exposed by `preload.js`.
- **Each container's claude.ai page is a separate `BrowserView`**, not an
  iframe inside the rail's HTML. This distinction is what makes real
  isolation possible: a `BrowserView` can be constructed with its own
  session `partition`, so Chromium gives it a completely separate storage
  bucket. Plain iframes on a page share the origin's single cookie jar, so
  they can't do this — see the note on why a browser extension couldn't
  cleanly do what this app does.
- `persist:` partitions are written to disk automatically under Electron's
  `userData/Partitions/<name>/`, so logins survive restarts with no extra
  code.
- Switching containers detaches the previous `BrowserView` from the window
  (so it stops rendering) but does **not** destroy it — it keeps running in
  memory, so switching back is instant and nothing is lost. This does mean
  memory usage scales with the number of containers you've opened in a
  session; see limitations below.
- The container list itself (id, name, color — never session data) lives in
  `userData/containers.json`, and user preferences (auto-unload, etc.) live
  in `userData/settings.json` — both plain JSON files main.js reads/writes
  directly, no database.

<br>

## Project layout

```
main.js               Electron main process: window, BrowserViews, IPC, persistence, settings, auto-unload scheduler
preload.js             Safe bridge exposing window.containerAPI to the renderer
renderer/index.html    Rail UI shell + add/rename modal + settings modal + context menu markup
renderer/style.css     Rail, badge, modal, settings, and context menu styling
renderer/renderer.js   Rail rendering + click handlers + settings form, talks to main via IPC
pulse-overlay/         Ported Claude Pulse usage-limits overlay, injected into each container
scripts/make-icon.js   Zero-dep generator for the app icon (assets/icon.png + .ico)
assets/                Generated app icon (window + electron-builder)
start.bat              One-click setup + launch for Windows
start.sh               One-click setup + launch for macOS/Linux
CLAUDE.md              Architecture notes for AI-assisted development
```

<br>

## Current limitations

This is a working app, not yet a polished/distributable product. Remaining
gaps, roughly grouped:

**Reliability / error handling**
- No offline/DNS-failure UI — a failed load just shows Chromium's default
  error page inside the BrowserView. (Loading spinners, `render-process-gone`
  crash recovery, and in-rail confirm/alert dialogs are now handled.)

**Features not built yet**
- No drag-to-reorder containers in the rail.
- No unread/activity indicator on background containers.
- No way to pin a container to a specific URL other than `https://claude.ai`
  (e.g. a specific project or org subpath).
- No start-minimized option (window bounds, per-container zoom, and the
  Performance & memory controls are covered by Settings now).
- No import/export of the container list for backup or moving machines.
- No tray icon / minimize-to-tray.

**Packaging / distribution**
- `npm run dist` has never been run/verified end-to-end — the
  `electron-builder` config in `package.json` is a starting point only.
- No code signing or notarization configured for macOS/Windows, so a built
  app will trigger Gatekeeper/SmartScreen warnings on other machines.
- No auto-update wiring (`electron-updater` or similar).
- No app icon — builds will use Electron's default icon.

**Project hygiene**
- No automated tests (unit or end-to-end).
- No linter/formatter config (ESLint/Prettier).
- No CI (GitHub Actions or similar) for build verification across
  platforms.

<br>

## What's needed (roughly prioritized)

The daily-use correctness gaps have been closed — macOS Edit menu &
copy/paste, per-badge loading state, in-rail confirm/alert, remembered
window bounds, Ctrl/Cmd+1..9 switching, `render-process-gone` recovery,
deliberate permission handling, and per-container zoom are all in. What's
left, roughly prioritized:

1. **App icon + basic code signing setup** before treating `npm run dist`
   as a real deliverable — right now a built app isn't something you'd hand
   to a non-technical user without security warnings.
2. **Unread indicators** — this needs a bit of design thought (what counts
   as "new activity" from inside claude.ai without deep DOM inspection —
   possibly just "container had network activity while backgrounded").
3. **Tests + CI** — at minimum, a smoke test that boots the app headlessly
   (`xvfb` on Linux CI) and asserts the rail renders and IPC round-trips
   work, plus a lint step.

Longer-term/optional ideas: drag-to-reorder, per-container pinned URLs,
tray icon, auto-update.

<br>

## Notes / things you may want to tweak

- The rail is fixed at 76px. Change `RAIL_WIDTH` in `main.js` **and** the
  matching `#rail { width }` in `renderer/style.css` if you want it wider
  or narrower — see `CLAUDE.md` for why both need to change together.
- Every container currently loads `https://claude.ai`. Pinning a container
  to a different URL (listed under "Features not built yet" above) is a
  one-line change in `getOrCreateView()` in `main.js`.
