const { app, BrowserWindow, BrowserView, ipcMain, session, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const RAIL_WIDTH = 76;
const CLAUDE_URL = 'https://claude.ai';

let mainWindow = null;
const views = new Map(); // containerId -> BrowserView
let containers = [];
let activeId = null;

// Transient per-container UI state, surfaced to the rail via the state
// snapshot so badges can show a spinner / crashed affordance.
const loadingIds = new Set();
const crashedIds = new Set();

const configPath = path.join(app.getPath('userData'), 'containers.json');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_CONTAINERS = [
  { id: 'default', name: 'Personal', color: '#D97757' },
];

// ---- Settings ------------------------------------------------------------
// Plain JSON file, same pattern as containers.json. `lastActiveId`,
// `windowBounds`, `windowMaximized` and `containerZoom` are written
// automatically (not user-editable in the form) so the app can restore
// where you left off.
const DEFAULT_SETTINGS = {
  autoUnloadEnabled: true,
  autoUnloadSeconds: 20,
  confirmBeforeDelete: true,
  resumeLastActiveContainer: true,
  alwaysOnTop: false,
  showUsageOverlay: true,
  // Performance & memory (see the "Performance & memory" settings group).
  // The first three only take effect at startup — the renderer shows a
  // "takes effect after restart" hint for them.
  disableGpu: false,        // app.disableHardwareAcceleration()
  capRendererHeap: false,   // --max-old-space-size on renderer V8
  rendererHeapMb: 512,
  extraChromiumFlags: false, // background-networking/sync/default-apps/component-update off
  maxLoadedContainers: false, // LRU-evict down to maxLoadedCount loaded views
  maxLoadedCount: 3,
  ecoMode: false,            // only the active container is ever loaded
  // Main-process-managed fields (persisted, not shown as form controls):
  lastActiveId: null,
  windowBounds: null,        // { x, y, width, height }
  windowMaximized: false,
  containerZoom: {},         // { [containerId]: zoomLevel }
};
const AUTO_UNLOAD_MIN_SECONDS = 5;
const AUTO_UNLOAD_MAX_SECONDS = 3600;
const HEAP_MIN_MB = 256;
const HEAP_MAX_MB = 4096;

let settings = { ...DEFAULT_SETTINGS };
// containerId -> timestamp it became inactive (backgrounded). Cleared when
// it becomes active again or is unloaded (manually or automatically). Also
// doubles as the LRU ordering used by enforceLoadedLimit().
const inactiveSince = new Map();
let autoUnloadTimer = null;

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    settings = { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

function clampAutoUnloadSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.autoUnloadSeconds;
  return Math.min(AUTO_UNLOAD_MAX_SECONDS, Math.max(AUTO_UNLOAD_MIN_SECONDS, Math.round(n)));
}

function clampHeapMb(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.rendererHeapMb;
  return Math.min(HEAP_MAX_MB, Math.max(HEAP_MIN_MB, Math.round(n)));
}

function clampMaxLoaded(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.maxLoadedCount;
  return Math.max(1, Math.round(n));
}

// ---- Startup flags -------------------------------------------------------
// GPU/heap/Chromium-flag settings can only be applied before the app is
// ready, so settings are loaded synchronously at module load (below) and
// these switches are appended before app.whenReady(). Changing them in the
// UI therefore requires an app restart to take effect.
function applyStartupFlags() {
  if (settings.disableGpu) {
    app.disableHardwareAcceleration();
  }
  if (settings.capRendererHeap) {
    app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${clampHeapMb(settings.rendererHeapMb)}`);
  }
  if (settings.extraChromiumFlags) {
    app.commandLine.appendSwitch('disable-background-networking');
    app.commandLine.appendSwitch('disable-sync');
    app.commandLine.appendSwitch('disable-default-apps');
    app.commandLine.appendSwitch('disable-component-update');
  }
}

// Load settings and apply startup flags immediately — this runs before
// app.whenReady() so the GPU/heap/flag switches take effect this launch.
loadSettings();
applyStartupFlags();

function startAutoUnloadScheduler() {
  if (autoUnloadTimer) return;
  // Checks every 2s regardless of the configured threshold — cheap, and
  // means a 20s default fires within ~2s of actually crossing the line
  // instead of waiting for some longer fixed tick.
  autoUnloadTimer = setInterval(() => {
    if (!settings.autoUnloadEnabled) return;
    const thresholdMs = settings.autoUnloadSeconds * 1000;
    const now = Date.now();
    for (const [id, since] of Array.from(inactiveSince.entries())) {
      if (id === activeId) {
        inactiveSince.delete(id); // shouldn't happen, but don't ever unload the active one
        continue;
      }
      if (now - since >= thresholdMs) {
        unloadContainerById(id);
      }
    }
  }, 2000);
}

// ---- Loaded-container limit (LRU) ---------------------------------------
// Enforces the eco-mode / "limit loaded containers" settings by unloading
// the least-recently-used *background* container until the loaded count is
// within the cap. Called after every switch and whenever the cap changes.
function enforceLoadedLimit() {
  const cap = settings.ecoMode
    ? 1
    : (settings.maxLoadedContainers ? clampMaxLoaded(settings.maxLoadedCount) : Infinity);
  if (!Number.isFinite(cap)) return;

  while (views.size > cap) {
    let victim = null;
    let oldest = Infinity;
    for (const id of views.keys()) {
      if (id === activeId) continue;
      const since = inactiveSince.has(id) ? inactiveSince.get(id) : 0;
      if (since < oldest) {
        oldest = since;
        victim = id;
      }
    }
    if (victim == null) break; // only the active view remains — can't go lower
    unloadContainerById(victim);
  }
}

function getStateSnapshot(extra) {
  return {
    containers,
    activeId,
    loadedIds: Array.from(views.keys()),
    loadingIds: Array.from(loadingIds),
    crashedIds: Array.from(crashedIds),
    ...extra,
  };
}

function pushState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-changed', getStateSnapshot());
  }
}

// ---- Claude Pulse overlay ----------------------------------------------
// Ported from a browser extension the user already used to see usage
// limits (5h/7d bars, token estimate, cache countdown). Only the
// content-script display logic is ported — it doesn't use any chrome.*
// extension APIs, just DOM + page fetch/XHR interception, so it runs fine
// via plain executeJavaScript. The extension's auto-scheduler feature
// (queue a message to auto-send after your limit resets) depended on the
// background service worker + chrome.tabs and was NOT ported — it's
// written defensively enough (`if (CC.scheduler) ...`) that leaving it out
// doesn't break the rest.
const PULSE_DIR = path.join(__dirname, 'pulse-overlay');
const PULSE_FILES = [
  '01-bridge.js',
  '02-constants.js',
  '03-bridge-client.js',
  '04-o200k_base.js',
  '05-tokens.js',
  '06-ui.js',
  '07-scheduler.js',
  '08-main.js',
];
let pulseCss = null;
let pulseScripts = null;

function loadPulseSource() {
  try {
    pulseCss = fs.readFileSync(path.join(PULSE_DIR, 'styles.css'), 'utf-8');
    pulseScripts = PULSE_FILES.map((f) => fs.readFileSync(path.join(PULSE_DIR, f), 'utf-8'));
  } catch (err) {
    console.error('Pulse overlay source failed to load — overlay disabled:', err);
    pulseCss = null;
    pulseScripts = null;
  }
}

async function injectPulseOverlay(view, id) {
  if (!pulseScripts) return;
  try {
    await view.webContents.insertCSS(pulseCss);
    for (const src of pulseScripts) {
      await view.webContents.executeJavaScript(src);
    }
  } catch (err) {
    console.error('Pulse overlay injection failed for', id, err);
  }
}

function loadContainers() {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    containers = Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_CONTAINERS;
  } catch {
    containers = DEFAULT_CONTAINERS;
  }
}

function saveContainers() {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(containers, null, 2));
  } catch (err) {
    console.error('Failed to save containers:', err);
  }
}

// ---- Window bounds persistence ------------------------------------------
let saveBoundsTimer = null;

function scheduleSaveBounds() {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveWindowBounds, 400);
}

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  settings.windowMaximized = mainWindow.isMaximized();
  // Only capture a concrete rectangle while un-maximized, so restoring
  // doesn't clamp a maximized window to a stale small size.
  if (!settings.windowMaximized) {
    settings.windowBounds = mainWindow.getBounds();
  }
  saveSettings();
}

function createWindow() {
  const b = settings.windowBounds;
  const opts = {
    width: b && Number.isFinite(b.width) ? b.width : 1440,
    height: b && Number.isFinite(b.height) ? b.height : 920,
    minWidth: 760,
    minHeight: 480,
    title: 'Claude Containers',
    backgroundColor: '#1b1a19',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) {
    opts.x = b.x;
    opts.y = b.y;
  }
  if (process.platform === 'darwin') {
    // Inset traffic-lights so the native title bar doesn't clash with the
    // rail's fixed dark theme.
    opts.titleBarStyle = 'hiddenInset';
  }

  mainWindow = new BrowserWindow(opts);
  if (settings.windowMaximized) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.on('render-process-gone', (_e, details) =>
    console.error('rail render-process-gone', details)
  );

  mainWindow.on('resize', () => { layoutActiveView(); scheduleSaveBounds(); });
  mainWindow.on('move', () => scheduleSaveBounds());
  mainWindow.on('maximize', () => { layoutActiveView(); saveWindowBounds(); });
  mainWindow.on('unmaximize', () => { layoutActiveView(); saveWindowBounds(); });
  mainWindow.on('restore', () => layoutActiveView());
  mainWindow.on('close', () => saveWindowBounds());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.setAlwaysOnTop(!!settings.alwaysOnTop);

  if (containers.length) {
    const wantsResume =
      settings.resumeLastActiveContainer &&
      settings.lastActiveId &&
      containers.some((c) => c.id === settings.lastActiveId);
    switchToContainer(wantsResume ? settings.lastActiveId : containers[0].id);
  }
}

// Hosts that legitimately need a real popup window during login (OAuth /
// SSO handshakes). Anything NOT matching this list gets sent to the OS
// default browser instead of opening inside the app.
const AUTH_POPUP_HOSTS = [
  /(^|\.)google\.com$/i,
  /(^|\.)googleusercontent\.com$/i,
  /(^|\.)github\.com$/i,
  /(^|\.)microsoftonline\.com$/i,
  /(^|\.)microsoft\.com$/i,
  /(^|\.)okta\.com$/i,
  /(^|\.)claude\.ai$/i,
  /(^|\.)anthropic\.com$/i,
];

function isAuthPopupUrl(url) {
  try {
    const { hostname } = new URL(url);
    return AUTH_POPUP_HOSTS.some((re) => re.test(hostname));
  } catch {
    return false;
  }
}

function applyZoom(view, id) {
  const map = settings.containerZoom || {};
  const z = map[id];
  if (typeof z === 'number' && z !== 0) {
    view.webContents.setZoomLevel(z);
  }
}

function getOrCreateView(id) {
  if (views.has(id)) return views.get(id);

  const partition = `persist:container-${id}`;
  const view = new BrowserView({
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Deliberate permission policy instead of falling through to Electron's
  // defaults: allow the handful claude.ai legitimately uses (mic for voice
  // input, notifications, clipboard read), deny everything else.
  const PERMISSION_ALLOW = new Set([
    'media',
    'notifications',
    'clipboard-read',
    'clipboard-sanitized-write',
  ]);
  view.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(PERMISSION_ALLOW.has(permission));
  });

  // Electron's default UA includes an "Electron/x.y.z" token. Many sites'
  // bot/fraud detection (claude.ai included) will silently block or hang
  // logins from a UA that announces itself as an embedded browser, so we
  // present as a normal desktop Chrome instead.
  const strippedUA = view.webContents
    .getUserAgent()
    .replace(/\s*Claude-Containers\/\S+/i, '')
    .replace(/\s*Electron\/\S+/i, '')
    .trim();
  view.webContents.setUserAgent(strippedUA);

  view.webContents.on('did-start-loading', () => {
    loadingIds.add(id);
    pushState();
  });
  view.webContents.on('did-stop-loading', () => {
    loadingIds.delete(id);
    pushState();
  });
  view.webContents.on('did-finish-load', () => {
    crashedIds.delete(id);
    applyZoom(view, id);
    if (settings.showUsageOverlay) injectPulseOverlay(view, id);
  });
  view.webContents.on('did-fail-load', (_e, code, desc, url) => {
    // -3 is ERR_ABORTED, a normal by-product of redirects/navigations.
    if (code !== -3) console.error('container load failed', { id, code, desc, url });
  });
  view.webContents.on('render-process-gone', (_e, details) => {
    console.error('container render-process-gone', { id, details });
    crashedIds.add(id);
    loadingIds.delete(id);
    pushState();
  });

  // OAuth/SSO popups (e.g. "Continue with Google") need to open as a real
  // popup window sharing this container's session partition, or the
  // resulting login cookies never make it back into the app. Everything
  // else (regular links clicked inside a chat, etc.) goes to the OS
  // default browser instead of spawning an uncontrolled Electron window.
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isAuthPopupUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 480,
          height: 680,
          autoHideMenuBar: true,
          webPreferences: {
            partition,
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // The popup created by setWindowOpenHandler above gets its own fresh
  // webContents with the default (Electron-flagged) UA, so fix that too.
  view.webContents.on('did-create-window', (popupWindow) => {
    popupWindow.webContents.setUserAgent(strippedUA);
  });

  view.webContents.loadURL(CLAUDE_URL);
  views.set(id, view);
  return view;
}

function layoutActiveView() {
  if (!mainWindow || !activeId) return;
  const view = views.get(activeId);
  if (!view) return;
  const [w, h] = mainWindow.getContentSize();
  const bounds = { x: RAIL_WIDTH, y: 0, width: Math.max(w - RAIL_WIDTH, 0), height: h };
  view.setBounds(bounds);
}

function switchToContainer(id) {
  if (!containers.find((c) => c.id === id)) return;
  const previousActiveId = activeId;
  const view = getOrCreateView(id);

  // Detach every other view but keep them alive in memory so their
  // sessions / scroll position / in-progress drafts are preserved.
  mainWindow.getBrowserViews().forEach((v) => {
    if (v !== view) mainWindow.removeBrowserView(v);
  });
  if (!mainWindow.getBrowserViews().includes(view)) {
    mainWindow.addBrowserView(view);
  }

  activeId = id;
  inactiveSince.delete(id); // becoming active — not eligible for auto-unload
  if (previousActiveId && previousActiveId !== id && views.has(previousActiveId)) {
    // Starts (or restarts) this container's auto-unload countdown now that
    // it's backgrounded. See DEFAULT_SETTINGS.autoUnloadSeconds.
    inactiveSince.set(previousActiveId, Date.now());
  }

  // If this container's renderer had crashed, switching to it should recover
  // it rather than show a blank view.
  if (crashedIds.has(id)) {
    crashedIds.delete(id);
    view.webContents.reload();
  }

  if (settings.lastActiveId !== id) {
    settings.lastActiveId = id;
    saveSettings();
  }

  layoutActiveView();
  enforceLoadedLimit(); // eco mode / loaded-count cap
  pushState();
}

function unloadContainerById(id) {
  // Shared by the manual "Unload" IPC handler, the "Unload All Inactive"
  // menu action, the auto-unload scheduler, and the loaded-count limiter.
  const view = views.get(id);
  inactiveSince.delete(id);
  loadingIds.delete(id);
  crashedIds.delete(id);
  if (!view) return false;
  if (mainWindow && mainWindow.getBrowserViews().includes(view)) {
    mainWindow.removeBrowserView(view);
  }
  view.webContents.destroy?.();
  views.delete(id);
  pushState();
  return true;
}

function zoomActive(delta) {
  const view = views.get(activeId);
  if (!view) return;
  const level = delta === 0 ? 0 : view.webContents.getZoomLevel() + delta;
  view.webContents.setZoomLevel(level);
  settings.containerZoom = { ...(settings.containerZoom || {}), [activeId]: level };
  saveSettings();
}

// ---- IPC handlers used by the renderer sidebar ----

ipcMain.handle('overlay-open', async () => {
  // Detach (but don't destroy) the active BrowserView so HTML overlays in
  // the rail's own window — the add/rename modal, the context menu — are
  // actually visible. A BrowserView always paints above the host window's
  // own page content, so it would otherwise hide any modal underneath it.
  if (!mainWindow || !activeId) return;
  const view = views.get(activeId);
  const wasAttached = view && mainWindow.getBrowserViews().includes(view);
  if (wasAttached) {
    mainWindow.removeBrowserView(view);
  }
});

ipcMain.handle('overlay-close', async () => {
  if (!mainWindow || !activeId) return;
  const view = views.get(activeId);
  const wasAttached = view && mainWindow.getBrowserViews().includes(view);
  if (view && !wasAttached) {
    mainWindow.addBrowserView(view);
    layoutActiveView();
  }
});

ipcMain.handle('get-state', () => getStateSnapshot());

ipcMain.handle('switch-container', (_e, id) => {
  try {
    switchToContainer(id);
    return getStateSnapshot();
  } catch (err) {
    console.error('[switch-container] failed:', err);
    return getStateSnapshot({ error: String(err && err.message ? err.message : err) });
  }
});

ipcMain.handle('add-container', async (_e, { name, color }) => {
  try {
    const id = Date.now().toString(36);
    containers.push({ id, name: name || 'New profile', color: color || '#7C9885' });
    saveContainers();
    buildMenu(); // refresh the Containers menu / 1..9 accelerators
    switchToContainer(id);
    return getStateSnapshot();
  } catch (err) {
    console.error('[add-container] failed:', err);
    return getStateSnapshot({ error: String(err && err.message ? err.message : err) });
  }
});

ipcMain.handle('rename-container', (_e, { id, name }) => {
  try {
    const c = containers.find((c) => c.id === id);
    if (c && name && name.trim()) {
      c.name = name.trim();
      saveContainers();
      buildMenu(); // labels in the Containers menu
    }
    return getStateSnapshot();
  } catch (err) {
    console.error('[rename-container] failed:', err);
    return getStateSnapshot({ error: String(err && err.message ? err.message : err) });
  }
});

ipcMain.handle('remove-container', async (_e, id) => {
  try {
    if (containers.length <= 1) {
      return getStateSnapshot({ error: 'At least one container must remain.' });
    }
    containers = containers.filter((c) => c.id !== id);
    saveContainers();
    inactiveSince.delete(id);
    loadingIds.delete(id);
    crashedIds.delete(id);
    if (settings.containerZoom && settings.containerZoom[id] !== undefined) {
      const { [id]: _drop, ...rest } = settings.containerZoom;
      settings.containerZoom = rest;
    }
    if (settings.lastActiveId === id) {
      settings.lastActiveId = null;
    }
    saveSettings();

    const view = views.get(id);
    if (view) {
      try {
        await session.fromPartition(`persist:container-${id}`).clearStorageData();
      } catch (err) {
        console.error('Failed to clear storage for', id, err);
      }
      mainWindow.removeBrowserView(view);
      view.webContents.destroy?.();
      views.delete(id);
    }

    buildMenu();
    if (activeId === id) {
      activeId = null;
      if (containers.length) switchToContainer(containers[0].id);
    }
    return getStateSnapshot();
  } catch (err) {
    console.error('[remove-container] failed:', err);
    return getStateSnapshot({ error: String(err && err.message ? err.message : err) });
  }
});

ipcMain.handle('unload-container', (_e, id) => {
  // Frees the RAM of a background container's Chromium renderer process
  // without forgetting it — the container stays in the list, just with no
  // live BrowserView, and reloads fresh next time it's switched to.
  try {
    if (id === activeId) {
      return getStateSnapshot({ error: "Can't unload the active container — switch to another one first." });
    }
    unloadContainerById(id);
    return getStateSnapshot();
  } catch (err) {
    console.error('[unload-container] failed:', err);
    return getStateSnapshot({ error: String(err && err.message ? err.message : err) });
  }
});

ipcMain.handle('get-settings', () => settings);

ipcMain.handle('save-settings', (_e, patch) => {
  try {
    const next = { ...settings, ...patch };
    next.autoUnloadSeconds = clampAutoUnloadSeconds(next.autoUnloadSeconds);
    next.rendererHeapMb = clampHeapMb(next.rendererHeapMb);
    next.maxLoadedCount = clampMaxLoaded(next.maxLoadedCount);
    settings = next;
    saveSettings();
    if (mainWindow) mainWindow.setAlwaysOnTop(!!settings.alwaysOnTop);
    enforceLoadedLimit(); // turning eco/limit on should free RAM immediately
    return settings;
  } catch (err) {
    console.error('[save-settings] failed:', err);
    return settings;
  }
});

ipcMain.handle('reload-active', () => {
  const view = views.get(activeId);
  if (view) view.webContents.reload();
});

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const containerItems = containers.slice(0, 9).map((c, i) => ({
    label: `${i + 1}  ${c.name}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: () => switchToContainer(c.id),
  }));

  const template = [
    // Standard app menu on macOS (about/hide/quit/etc.).
    ...(isMac ? [{ role: 'appMenu' }] : []),
    // Standard Edit menu — without these roles, Cmd+C/V/A silently stop
    // working inside text fields on macOS (including claude.ai's message box).
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Active Container',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const view = views.get(activeId);
            if (view) view.webContents.reload();
          },
        },
        {
          label: 'Unload All Inactive Containers (Free RAM)',
          click: () => {
            for (const id of Array.from(views.keys())) {
              if (id === activeId) continue;
              unloadContainerById(id);
            }
          },
        },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => zoomActive(0.5) },
        // Alternate accelerator so Ctrl/Cmd+= (no Shift) also zooms in.
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', visible: false, click: () => zoomActive(0.5) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoomActive(-0.5) },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => zoomActive(0) },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('open-settings');
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    ...(containerItems.length ? [{ label: 'Containers', submenu: containerItems }] : []),
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

process.on('uncaughtException', (err) => {
  console.error('MAIN PROCESS uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('MAIN PROCESS unhandledRejection:', reason);
});

app.whenReady().then(() => {
  loadContainers();
  loadPulseSource();
  buildMenu();
  createWindow();
  startAutoUnloadScheduler();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
