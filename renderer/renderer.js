// ---------- Boot-time sanity check ----------
// If the preload bridge failed for any reason, window.containerAPI won't
// exist. Everything below depends on it, so fail loudly and visibly (via
// the window title) instead of silently doing nothing.
if (!window.containerAPI) {
  document.title = 'Claude Containers — PRELOAD BRIDGE MISSING (containerAPI undefined)';
  document.body.innerHTML =
    '<div style="color:#f2ede6;font-family:sans-serif;padding:24px;">' +
    '<h2>window.containerAPI is undefined</h2>' +
    '<p>The preload script did not expose the bridge. Check the main-process ' +
    'console output for preload errors.</p></div>';
  throw new Error('containerAPI missing — aborting renderer.js');
}

const PALETTE = [
  '#D97757', // clay (default accent)
  '#7C9885', // sage
  '#6C93B8', // dusty blue
  '#9B7EBD', // plum
  '#C9A227', // gold
  '#C97C8B', // rose
  '#6B7280', // slate
  '#4F9C93', // teal
];

const railList = document.getElementById('rail-list');
const addBtn = document.getElementById('add-btn');
const overlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const nameInput = document.getElementById('name-input');
const swatchWrap = document.getElementById('color-swatches');
const confirmBtn = document.getElementById('modal-confirm');
const cancelBtn = document.getElementById('modal-cancel');
const contextMenu = document.getElementById('context-menu');
const settingsBtn = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsClose = document.getElementById('settings-close');
const autoUnloadToggle = document.getElementById('setting-auto-unload');
const autoUnloadSecondsRow = document.getElementById('auto-unload-seconds-row');
const autoUnloadSecondsInput = document.getElementById('setting-auto-unload-seconds');
const resumeToggle = document.getElementById('setting-resume');
const confirmDeleteToggle = document.getElementById('setting-confirm-delete');
const usageOverlayToggle = document.getElementById('setting-usage-overlay');
const alwaysOnTopToggle = document.getElementById('setting-always-on-top');
// Performance & memory
const ecoModeToggle = document.getElementById('setting-eco-mode');
const limitLoadedToggle = document.getElementById('setting-limit-loaded');
const maxLoadedRow = document.getElementById('max-loaded-row');
const maxLoadedInput = document.getElementById('setting-max-loaded');
const disableGpuToggle = document.getElementById('setting-disable-gpu');
const capHeapToggle = document.getElementById('setting-cap-heap');
const heapMbRow = document.getElementById('heap-mb-row');
const heapMbInput = document.getElementById('setting-heap-mb');
const extraFlagsToggle = document.getElementById('setting-extra-flags');
// Generic confirm / info dialog
const confirmOverlay = document.getElementById('confirm-overlay');
const confirmMessage = document.getElementById('confirm-message');
const confirmOk = document.getElementById('confirm-ok');
const confirmCancel = document.getElementById('confirm-cancel');

let state = { containers: [], activeId: null, loadedIds: [], loadingIds: [], crashedIds: [] };
let modalMode = 'add'; // 'add' | 'rename'
let modalTargetId = null;
let selectedColor = PALETTE[0];
let contextTargetId = null;
let settings = {
  autoUnloadEnabled: true,
  autoUnloadSeconds: 20,
  confirmBeforeDelete: true,
  resumeLastActiveContainer: true,
  alwaysOnTop: false,
  showUsageOverlay: true,
  disableGpu: false,
  capRendererHeap: false,
  rendererHeapMb: 512,
  extraChromiumFlags: false,
  maxLoadedContainers: false,
  maxLoadedCount: 3,
  ecoMode: false,
};

// ---------- Overlay detach ref-counting ----------
// Any rail overlay (context menu, add/rename modal, settings, confirm
// dialog) needs the active BrowserView detached so it isn't painted over.
// Since these can nest (e.g. a confirm dialog opened while the add modal is
// up), ref-count the detach so the view only reattaches once the *last*
// overlay closes.
let overlayDepth = 0;
function showOverlay() {
  overlayDepth += 1;
  if (overlayDepth === 1) containerAPI['openOverlay']();
}
function hideOverlay() {
  overlayDepth = Math.max(0, overlayDepth - 1);
  if (overlayDepth === 0) containerAPI['closeOverlay']();
}

function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function render() {
  railList.innerHTML = '';
  state.containers.forEach((c) => {
    const isLoaded = state.loadedIds.includes(c.id);
    const isLoading = state.loadingIds.includes(c.id);
    const isCrashed = state.crashedIds.includes(c.id);
    const wrap = document.createElement('div');
    wrap.className =
      'badge-wrap' +
      (c.id === state.activeId ? ' active' : '') +
      (isLoaded ? '' : ' unloaded') +
      (isLoading ? ' loading' : '') +
      (isCrashed ? ' crashed' : '');
    wrap.dataset.id = c.id;

    const flyoutSuffix = isCrashed
      ? ' · crashed — click to reload'
      : isLoading
      ? ' · loading…'
      : isLoaded
      ? ''
      : ' · unloaded';

    wrap.innerHTML = `
      <div class="active-indicator"></div>
      <div class="badge" style="background:${c.color}">${initials(c.name)}</div>
      <div class="badge-flyout">${escapeHtml(c.name)}${flyoutSuffix}</div>
      <button class="kebab" title="Options">&#8942;</button>
    `;

    wrap.querySelector('.badge').addEventListener('click', () => {
      containerAPI.switchContainer(c.id).then((s) => setState(s));
    });

    wrap.querySelector('.kebab').addEventListener('click', (e) => {
      e.stopPropagation();
      openContextMenu(e.currentTarget, c.id);
    });

    railList.appendChild(wrap);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function setState(s) {
  state = {
    containers: s.containers,
    activeId: s.activeId,
    loadedIds: s.loadedIds || [],
    loadingIds: s.loadingIds || [],
    crashedIds: s.crashedIds || [],
  };
  render();
}

// ---------- Generic confirm / info dialog ----------
// Replaces native alert()/confirm(), which are blocking and paint
// inconsistently against the rail's theme. Routed through openOverlay so
// the active BrowserView doesn't hide it.

let confirmResolver = null;

function openDialog(message, { okLabel = 'OK', showCancel = true, danger = false } = {}) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    confirmMessage.textContent = message;
    confirmOk.textContent = okLabel;
    confirmOk.classList.toggle('danger', !!danger);
    confirmCancel.style.display = showCancel ? '' : 'none';
    showOverlay();
    confirmOverlay.classList.remove('hidden');
    setTimeout(() => confirmOk.focus(), 0);
  });
}

function closeDialog(result) {
  confirmOverlay.classList.add('hidden');
  hideOverlay();
  const resolve = confirmResolver;
  confirmResolver = null;
  if (resolve) resolve(result);
}

function confirmDialog(message, opts = {}) {
  return openDialog(message, { okLabel: 'Confirm', showCancel: true, ...opts });
}

function infoDialog(message) {
  return openDialog(message, { okLabel: 'OK', showCancel: false });
}

confirmOk.addEventListener('click', () => closeDialog(true));
confirmCancel.addEventListener('click', () => closeDialog(false));
confirmOverlay.addEventListener('click', (e) => {
  if (e.target === confirmOverlay) closeDialog(false);
});

// ---------- Context menu ----------

function openContextMenu(anchorEl, id) {
  contextTargetId = id;
  const rect = anchorEl.getBoundingClientRect();
  contextMenu.style.left = `${rect.right + 6}px`;
  contextMenu.style.top = `${rect.top}px`;
  showOverlay();
  contextMenu.classList.remove('hidden');
}

function closeContextMenu() {
  contextMenu.classList.add('hidden');
  contextTargetId = null;
  hideOverlay();
}

document.addEventListener('click', (e) => {
  if (contextMenu.classList.contains('hidden')) return; // nothing open, nothing to do
  if (!contextMenu.contains(e.target)) closeContextMenu();
});

contextMenu.addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action || !contextTargetId) return;
  const id = contextTargetId;
  closeContextMenu();

  if (action === 'rename') {
    const c = state.containers.find((c) => c.id === id);
    openModal('rename', id, c);
  } else if (action === 'reload') {
    if (id === state.activeId) {
      containerAPI.reloadActive();
    } else {
      await containerAPI.switchContainer(id);
      containerAPI.reloadActive();
    }
  } else if (action === 'unload') {
    if (id === state.activeId) {
      await infoDialog("Can't unload the active container — switch to another one first.");
      return;
    }
    const s = await containerAPI.unloadContainer(id);
    setState(s);
    if (s.error) await infoDialog(s.error);
  } else if (action === 'delete') {
    const c = state.containers.find((c) => c.id === id);
    if (state.containers.length <= 1) {
      await infoDialog('At least one container must remain.');
      return;
    }
    const proceed = settings.confirmBeforeDelete
      ? await confirmDialog(`Delete "${c.name}"? This clears its login and local data.`, { danger: true })
      : true;
    if (proceed) {
      containerAPI.removeContainer(id).then((s) => setState(s));
    }
  }
});

// ---------- Modal ----------

function buildSwatches() {
  swatchWrap.innerHTML = '';
  PALETTE.forEach((color) => {
    const el = document.createElement('div');
    el.className = 'swatch' + (color === selectedColor ? ' selected' : '');
    el.style.background = color;
    el.addEventListener('click', () => {
      selectedColor = color;
      buildSwatches();
    });
    swatchWrap.appendChild(el);
  });
}

function openModal(mode, id = null, existing = null) {
  modalMode = mode;
  modalTargetId = id;
  modalTitle.textContent = mode === 'add' ? 'New container' : 'Rename container';
  confirmBtn.textContent = mode === 'add' ? 'Create' : 'Save';
  nameInput.value = existing ? existing.name : '';
  selectedColor = existing ? existing.color : PALETTE[state.containers.length % PALETTE.length];
  buildSwatches();
  showOverlay();
  overlay.classList.remove('hidden');
  setTimeout(() => nameInput.focus(), 0);
}

function closeModal() {
  overlay.classList.add('hidden');
  hideOverlay();
}

addBtn.addEventListener('click', () => openModal('add'));
cancelBtn.addEventListener('click', () => closeModal());
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeModal();
});

confirmBtn.addEventListener('click', async () => {
  try {
    const name = nameInput.value.trim() || (modalMode === 'add' ? 'New profile' : null);
    if (!name) return;

    const s =
      modalMode === 'add'
        ? await containerAPI.addContainer({ name, color: selectedColor })
        : await containerAPI.renameContainer({ id: modalTargetId, name });

    setState(s);
    if (s && s.error) {
      await infoDialog(`Couldn't save that container: ${s.error}`);
      return; // leave the modal open so the user doesn't lose their input
    }
    closeModal();
  } catch (err) {
    await infoDialog(`Something went wrong adding the container: ${err.message || err}`);
  }
});

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmBtn.click();
  if (e.key === 'Escape') closeModal();
});

// ---------- Settings modal ----------

function applySettingsToForm() {
  autoUnloadToggle.checked = !!settings.autoUnloadEnabled;
  autoUnloadSecondsInput.value = settings.autoUnloadSeconds;
  autoUnloadSecondsRow.classList.toggle('disabled', !settings.autoUnloadEnabled);
  resumeToggle.checked = !!settings.resumeLastActiveContainer;
  confirmDeleteToggle.checked = !!settings.confirmBeforeDelete;
  usageOverlayToggle.checked = !!settings.showUsageOverlay;
  alwaysOnTopToggle.checked = !!settings.alwaysOnTop;

  // Performance & memory
  ecoModeToggle.checked = !!settings.ecoMode;
  limitLoadedToggle.checked = !!settings.maxLoadedContainers;
  maxLoadedInput.value = settings.maxLoadedCount;
  // Eco mode makes the loaded-count limit moot (it caps to exactly 1).
  limitLoadedToggle.disabled = !!settings.ecoMode;
  maxLoadedRow.classList.toggle('disabled', settings.ecoMode || !settings.maxLoadedContainers);
  disableGpuToggle.checked = !!settings.disableGpu;
  capHeapToggle.checked = !!settings.capRendererHeap;
  heapMbInput.value = settings.rendererHeapMb;
  heapMbRow.classList.toggle('disabled', !settings.capRendererHeap);
  extraFlagsToggle.checked = !!settings.extraChromiumFlags;
}

async function openSettings() {
  try {
    settings = await containerAPI.getSettings();
    applySettingsToForm();
  } catch (err) {
    console.error('getSettings failed:', err);
  }
  showOverlay();
  settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
  hideOverlay();
}

async function persistSettingsPatch(patch) {
  try {
    settings = await containerAPI.saveSettings(patch);
    applySettingsToForm(); // reflect any server-side clamping (e.g. seconds/MB bounds)
  } catch (err) {
    console.error('saveSettings failed:', err);
  }
}

settingsBtn.addEventListener('click', () => openSettings());
settingsClose.addEventListener('click', () => closeSettings());
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

autoUnloadToggle.addEventListener('change', () => {
  autoUnloadSecondsRow.classList.toggle('disabled', !autoUnloadToggle.checked);
  persistSettingsPatch({ autoUnloadEnabled: autoUnloadToggle.checked });
});
autoUnloadSecondsInput.addEventListener('change', () => {
  const seconds = Math.min(3600, Math.max(5, Number(autoUnloadSecondsInput.value) || 20));
  persistSettingsPatch({ autoUnloadSeconds: seconds });
});
resumeToggle.addEventListener('change', () => {
  persistSettingsPatch({ resumeLastActiveContainer: resumeToggle.checked });
});
confirmDeleteToggle.addEventListener('change', () => {
  persistSettingsPatch({ confirmBeforeDelete: confirmDeleteToggle.checked });
});
usageOverlayToggle.addEventListener('change', () => {
  persistSettingsPatch({ showUsageOverlay: usageOverlayToggle.checked });
});
alwaysOnTopToggle.addEventListener('change', () => {
  persistSettingsPatch({ alwaysOnTop: alwaysOnTopToggle.checked });
});

// Performance & memory handlers
ecoModeToggle.addEventListener('change', () => {
  persistSettingsPatch({ ecoMode: ecoModeToggle.checked });
});
limitLoadedToggle.addEventListener('change', () => {
  maxLoadedRow.classList.toggle('disabled', !limitLoadedToggle.checked);
  persistSettingsPatch({ maxLoadedContainers: limitLoadedToggle.checked });
});
maxLoadedInput.addEventListener('change', () => {
  const n = Math.max(1, Number(maxLoadedInput.value) || 3);
  persistSettingsPatch({ maxLoadedCount: n });
});
disableGpuToggle.addEventListener('change', () => {
  persistSettingsPatch({ disableGpu: disableGpuToggle.checked });
});
capHeapToggle.addEventListener('change', () => {
  heapMbRow.classList.toggle('disabled', !capHeapToggle.checked);
  persistSettingsPatch({ capRendererHeap: capHeapToggle.checked });
});
heapMbInput.addEventListener('change', () => {
  const mb = Math.min(4096, Math.max(256, Number(heapMbInput.value) || 512));
  persistSettingsPatch({ rendererHeapMb: mb });
});
extraFlagsToggle.addEventListener('change', () => {
  persistSettingsPatch({ extraChromiumFlags: extraFlagsToggle.checked });
});

if (containerAPI.onOpenSettings) {
  containerAPI.onOpenSettings(() => openSettings());
}

// ---------- Boot ----------

containerAPI
  .getState()
  .then((s) => setState(s))
  .catch((err) => console.error('initial getState failed:', err));

containerAPI
  .getSettings()
  .then((s) => {
    settings = s;
  })
  .catch((err) => console.error('initial getSettings failed:', err));

containerAPI.onStateChanged((s) => setState(s));
