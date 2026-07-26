# Android — Warm Switching + Settings (addendum)

**Date:** 2026-07-26
**Status:** Implemented
**Amends:** `2026-07-25-android-apk-port-design.md`

Supersedes that design's **Approach A** (one live container, process relaunch
on every switch) and closes most of its **Deferred** list. Written after using
the v1 APK on a device.

## What prompted it

Two things showed up in real use:

1. **Every switch looked like the app restarting.** Approach A killed and
   relaunched the process on each switch, so Android played its task-launch
   animation. Correct, but it felt broken — and it was not a memory problem,
   which was the first guess.
2. **The keyboard popped up constantly.** claude.ai auto-focuses its message
   composer on load, so every launch and every switch raised the soft keyboard.

## Approach B: a pool of host processes

The isolation constraint is unchanged and non-negotiable:
`WebView.setDataDirectorySuffix` pins a process to one container's storage,
before any WebView exists, for the process's whole life. So a warm container
is a live process, and "keep N warm" means "declare N processes".

- `:c0`…`:c3` each host one `ContainerActivity` subclass (`MAX_SLOTS = 4`,
  fixed at compile time because `android:process` is static).
- `SlotStore` (`slots.json`) owns the container↔slot mapping, with `lastUsed`
  per slot for LRU eviction.
- `MainActivity` becomes a router in the unpinned main process: resolve the
  container, bind a slot, hand off, finish. It never creates a WebView.
- Switching = `startActivity(FLAG_ACTIVITY_REORDER_TO_FRONT)`. If the target
  is already warm, its live WebView is simply brought forward: instant, no
  reload, page state intact.
- A binding change requires killing that slot's process first
  (`ProcessPool.killSlot`, same-UID so no permission needed) — the storage pin
  cannot be changed in a living process. `Binding.needsRestart` is therefore
  true for *any* binding change, including onto a slot that merely *looks*
  free but still has a live process pinned to its previous container.
- `:phoenix` survives, narrowed to the one case warm switching cannot cover:
  tearing down the process whose own container is being removed.

### The isolation hazard this introduces, and the guard

Rebinding a slot then killing its process leaves a window where the Activity
start can land in the old, not-yet-dead process. That process is pinned to the
*previous* container, so it would render one account's page against another's
cookies — the exact failure the design exists to prevent.

`ClaudeApp.pinnedContainerId` records what the process actually pinned.
`ContainerActivity.onCreate` refuses to render unless it matches the current
slot binding:

- mismatch → restart through `:phoenix` (converges: a fresh process reads the
  same `slots.json` the check uses)
- never pinned at all → do not open the container; a WebView there would fall
  back to shared, unisolated storage. Fails visibly instead of looping.

### Trade-offs accepted

- **Memory.** Each warm container is a full Chromium renderer. Mitigated by
  the `warmSlots` setting (default 3) and by Android reclaiming background
  processes on its own — which is what the desktop app's auto-unload timer
  existed to do, so that feature stays unported.
- **Eviction still restarts one slot.** Switching to a cold container reloads
  it. Unavoidable without an unbounded process pool.
- **Back never finishes the activity** (`moveTaskToBack` instead), because
  finishing would throw away the warm session.

## Keyboard suppression

`stateAlwaysHidden` alone is not enough — it governs window focus gain, not a
focus request the page makes after hydration. So: blur the focused element via
JS at `onPageFinished` plus two delayed retries, and stop entirely once the
user has actually touched the page (`userTouchedPage`), so it never fights a
deliberate tap on the composer. Behind the `focusComposerOnOpen` setting,
default off.

## Settings

`SettingsActivity` (main process, no WebView) editing `settings.json`, reached
from a gear badge in the rail: `warmSlots`, `textZoom`,
`focusComposerOnOpen`, `resumeLastActive`, `confirmBeforeDelete`. Host
processes re-read on resume, so no restart is needed; lowering `warmSlots`
additionally kills the now-unreachable slot processes.

## Also closed

- `AtomicWrite` — shared write-temp-then-rename with an IOException fallback
  and a boolean result, replacing three copies that could throw on the
  switch path (deferred minor #6).
- `SlotStore.slotFromProcessName` — process gating is now pure and unit-tested
  (deferred minor #8).
- `proguard-rules.pro` created (Task 1 minor).
- `StorageCleaner.processPending` takes `protectedIds` and re-queues what it
  skips, so a wipe can never race a live host process.
- Rail badge list scrolls; settings badge added.

## Still deferred

Release signing / Play Store packaging — explicitly out of scope.

## Testing

37 JVM unit tests (`SlotStore` 15, `ContainerStore` 6, `StorageCleaner` 5,
`SettingsStore` 4, `AtomicWrite` 4, `ExternalLink` 3). The multi-process
behavior is not JVM-testable; the on-device checklist in `android/README.md`
grew steps for warm switching, eviction, and removing the container currently
on screen.
