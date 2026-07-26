# Claude Containers — Android

Native Android port of the desktop multi-container app. Runs several fully
isolated claude.ai sessions with a switcher rail.

## How isolation works

Each container gets its own WebView storage directory via
`WebView.setDataDirectorySuffix("container_<id>")`. That call pins a process
to one directory for the process's entire lifetime, and must happen before
any WebView is created in it. So on Android, **one isolated container = one
process**. Cookies, localStorage, and IndexedDB are all isolated per
container.

That constraint shapes the whole app:

| Process | Component | Role |
|---|---|---|
| main | `MainActivity` | Router. Picks the container to show and hands off. Never creates a WebView, so it is never pinned. |
| `:c0`…`:c3` | `ContainerActivity0`…`3` | One warm container each: a pinned WebView plus the rail. |
| `:phoenix` | `PhoenixActivity` | Trampoline that kills and relaunches another process. |

`SlotStore` (`slots.json`) maps containers onto those host processes and is
the source of truth for which process holds which container.

### Warm switching

Up to **`warmSlots`** containers (default 3, max 4) stay loaded, one live
process each. Switching between two warm containers is just an Activity
reorder — instant, with no reload and no page state lost. Switching to a
container that has no process evicts the least-recently-used slot, which
costs that one slot a restart.

Activity transition animations are suppressed app-wide
(`Theme.ClaudeContainers` → `NoTransition`) and the window background matches
the WebView surface, so a slot respawn does not read as the whole app
restarting.

More warm containers means more memory — each one is a full Chromium
renderer. Lower `warmSlots` in Settings if Android keeps killing the app in
the background.

### The safety check that matters

A slot's binding on disk can change after its process has already pinned its
storage (a switch rebinds the slot, then kills the process so it respawns).
`ClaudeApp.pinnedContainerId` records what the process *actually* pinned, and
every `ContainerActivity` refuses to render unless that matches the current
binding — otherwise one account's page could be shown against another's
cookies. On mismatch the process restarts through `:phoenix`; if it never
pinned at all, the container is not opened.

## Settings

Reachable from the gear badge at the bottom of the rail. Stored in
`settings.json`; host processes re-read it on resume, so changes apply
without a restart (lowering `warmSlots` also frees the now-unreachable
processes immediately).

- **Warm containers** (1–4) — how many stay loaded for instant switching.
- **Text size** (70–180%) — WebView text zoom.
- **Keep the keyboard closed on open** — claude.ai auto-focuses its composer
  on every load, which otherwise pops the soft keyboard up each time you open
  the app or switch containers. On by default; tapping the composer still
  opens the keyboard normally.
- **Reopen the last container on launch**
- **Ask before removing a container**

## Build

Requires JDK 17+ and the Android SDK (platform 34, build-tools 34.0.0).
Create `android/local.properties` pointing at your SDK if it is not
autodetected:

```properties
sdk.dir=/absolute/path/to/Android/Sdk
```

Then:

```bash
cd android
./gradlew assembleDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`

## Install on a device

Enable "Install unknown apps" / USB debugging, then:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or copy the APK to the device and tap it.

## Run unit tests

```bash
cd android
./gradlew testDebugUnitTest
```

## On-device verification checklist

1. Launch — claude.ai loads; sign in. The keyboard should **not** pop up.
2. Open the rail (menu button on phone; docked on tablet), tap "+", add a
   second container. It opens logged out.
3. Sign into a **different** Claude account in the second container.
4. Switch back to the first container — it is still signed into the first
   account (**isolation holds — the core guarantee**), and the switch is
   instant, with no reload and no app-restart animation.
5. Add containers until you exceed **Warm containers** in Settings, then
   switch to the oldest one — it reloads (its slot was evicted) but is still
   signed into the right account.
6. Fully close and reopen the app — it resumes the last active container.
7. Tap an external (non-claude.ai) link — it opens in the system browser.
   Sign-in pages (Google/Apple/Microsoft) stay in-app.
8. Long-press a container → Remove — its session is gone; re-adding a
   container with the same name starts logged out. Removing the container you
   are currently viewing also works (it reboots into another one).
9. Lower **Warm containers** to 1, switch twice, and confirm the app is still
   correct (every switch now reloads).

Inspect the isolation directly with:

```bash
adb shell run-as com.claudecontainers.android ls -d app_webview_container_*
```

There should be one directory per container, and `adb shell ps | grep
claudecontainers` should show one `:cN` process per warm container.

## Not yet implemented

Release signing / Play Store packaging.

Auto-unload timers, the usage overlay, always-on-top, and the GPU/heap/
Chromium flags from the desktop app are deliberately not ported — they are
desktop-only concerns. Android reclaims background container processes
itself, which is what auto-unload existed to do.
