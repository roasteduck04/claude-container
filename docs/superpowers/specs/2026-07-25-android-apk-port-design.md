# Android APK Port — Design

**Date:** 2026-07-25
**Status:** Approved (design), pending implementation plan
**Approach:** A — one-active-container, isolate by process restart

## Goal

Deliver an installable Android app (APK) usable on a phone or tablet that
recreates the desktop Electron app's core value: **several fully isolated
claude.ai sessions with a switcher rail**. It is a native rewrite that
reuses the *concept*, not the Electron code — Electron does not run on
Android.

The user has a full local Android build chain (Java 21, Android SDK
platform 34, build-tools 34/35, Android Studio, adb), so the deliverable is
both the source project and a sideloadable debug APK.

## The core problem: storage isolation

On desktop, Electron gives each container its own cookie jar / localStorage
/ IndexedDB for free via `partition: persist:container-<id>`.

Android's built-in WebView is different: by default **all WebViews in a
process share one cookie store and one storage area**. The only supported
isolation primitive is `WebView.setDataDirectorySuffix(suffix)`, which:

- pins the calling process to one on-disk data directory for its entire
  lifetime, and
- **must be called once, before the first WebView is created in the
  process.**

On API 28+ that data directory contains cookies, localStorage, IndexedDB,
and cache. Therefore **true isolation on Android = one process per data
directory**, and a running process can host exactly one container's
storage.

A WebView (a `View`) can only be displayed by an `Activity` in its own
process. So the on-screen Activity must live in the process that owns the
active container's storage.

## Architecture (Approach A)

Run the app as **one main process pinned to the active container's
storage**, plus a tiny **`:phoenix` trampoline process** that cleanly
relaunches the main process (the ProcessPhoenix technique, hand-rolled to
avoid a dependency and match the project's low-dependency ethos).

### Processes & components

- **main process**
  - `ClaudeApp` (`Application`): in `onCreate`, read persisted `activeId`
    and call `WebView.setDataDirectorySuffix("container_" + activeId)`
    before any WebView is created.
  - `MainActivity`: hosts the switcher rail (a `DrawerLayout`) and a
    full-screen `WebView` that loads the active container's claude.ai.
- **`:phoenix` process** (`android:process=":phoenix"`)
  - `PhoenixActivity`: started to relaunch the main process, then finishes
    itself. Its separate process guarantees the main process is fully torn
    down (and its data-dir suffix released) before the new main process
    starts with a different suffix.

### Switch flow

1. User taps a container badge in the rail.
2. `MainActivity` writes the new `activeId` via `ContainerStore`.
3. App relaunches through `PhoenixActivity`: main process dies, a fresh
   main process starts, `ClaudeApp` sets the new suffix, `MainActivity`
   loads the newly-active container.

Net effect: tapping a container swaps to its fully isolated session with a
quick reload — the right trade on a device where you view one session at a
time.

### Add / rename / remove flows

- **Add**: append `{id, name, color}` to `containers.json`, set it active,
  relaunch (so the new container's suffix takes effect).
- **Rename**: update `name` only; no relaunch (rail rerenders).
- **Remove**: delete from `containers.json`; if it was active, pick another
  (or a placeholder empty state) and relaunch. Best-effort delete of the
  container's `app_webview_container_<id>` data directory to reclaim
  storage. Guard with `confirmBeforeDelete`.

## Data & persistence

`ContainerStore` — pure Kotlin, no Android UI deps, unit-testable:

- `containers.json` in `filesDir`: `[{ id, name, color }]` — same shape as
  the desktop app. **Never** stores session/auth data (that lives in the
  partitioned WebView storage, managed by the system).
- `settings.json` in `filesDir`: `{ activeId, confirmBeforeDelete,
  resumeLastActive }`. Minimal for v1.

Reads/writes are synchronous JSON via `org.json` (bundled in Android, no
dependency). Writes are atomic (write temp, rename).

## UI

Plain Android **Views + XML layouts** — no Jetpack Compose. This keeps the
APK small and honors the project's "no framework, keep it plain" ethos.

- Root `DrawerLayout`:
  - **Phone** (narrow): rail is a slide-in drawer (hamburger button + edge
    swipe).
  - **Tablet** (width ≥ 600dp): rail is docked always-visible on the left,
    closest to the desktop feel. Achieved with a `sw600dp` layout variant.
- Rail contents (ported design tokens from `renderer/style.css`):
  - background `--rail-bg` charcoal, accent `--accent` terracotta.
  - **Squircle badges**: rounded-rect drawable filled with the container's
    color, showing the name's first letter. Active badge shows the accent
    ring.
  - A "+" badge at the bottom to add a container.
  - Long-press a badge → context menu: Rename, Remove.
- Dialogs (`AlertDialog`) for add/rename/remove.

Colors and dimensions live in `colors.xml` / `dimens.xml` so the design
tokens have a single source of truth (the Android analog of the CSS custom
properties).

## WebView behavior (mirrors desktop security boundaries)

- Enable: JavaScript, DOM storage, database/IndexedDB, media playback.
- Use the **default mobile user-agent** so claude.ai serves its mobile web
  layout.
- `CookieManager`: accept cookies (incl. third-party for the WebView) and
  `flush()` on `onPause`.
- **External-link boundary** (analog of desktop `shell.openExternal`): a
  `WebViewClient.shouldOverrideUrlLoading` sends any navigation whose host
  is not `claude.ai` (or its known subdomains/auth hosts) to the system
  browser via an `ACTION_VIEW` `Intent`, instead of loading it in-app.
- **Downloads**: a `DownloadListener` routes downloads to Android's
  `DownloadManager`.
- **Back button**: `webView.goBack()` when `canGoBack()`, else default
  (close drawer if open, otherwise exit).
- **Crash recovery**: `WebViewClient.onRenderProcessGone` reloads the
  active container (the analog of the desktop `crashedIds` handling); a
  lightweight loading/error indicator is shown in the rail.

## Build & packaging

- New `android/` folder at the repo root, separate from the Electron app.
  The existing project layout (`main.js`, `renderer/`, etc.) is untouched.
- Gradle project, single `:app` module, Kotlin, **Views** (no Compose).
- `compileSdk 34`, `targetSdk 34`, `minSdk 28` (Android 9 — required by
  `setDataDirectorySuffix`, covers the large majority of devices in 2026).
- `applicationId "com.claudecontainers.android"`.
- Gradle wrapper committed so `./gradlew assembleDebug` works without
  Android Studio. Output: `android/app/build/outputs/apk/debug/app-debug.apk`.
- Install via `adb install -r app-debug.apk` or by copying the APK to the
  device and tapping it (debug APK is auto-signed with the debug key).
- **Release signing** (real keystore + `assembleRelease`) is documented as
  a later step, not part of v1.
- A short `android/README.md` documents build + install + the on-device
  verification checklist.

## Scope (YAGNI for v1)

**In scope**

- Add / rename / remove / switch fully isolated containers
- Persistence of container list + active container
- External-link handoff to system browser
- Hardware back navigation
- WebView crash reload
- Phone drawer vs tablet docked rail
- Ported design tokens (charcoal rail, terracotta accent, squircle badges)

**Deferred**

- Auto-unload timers, usage overlay, always-on-top, GPU/heap/Chromium
  flags, zoom persistence — desktop-only concerns or low value on mobile
- Warm multi-session (Approach B: process pool)
- Full settings modal (v1 keeps a minimal settings file only)
- Release-signed / Play-Store packaging

## Testing

- **JVM unit tests** for `ContainerStore` (JUnit): add, rename, remove,
  active-id selection, atomic persistence round-trip, empty/corrupt-file
  handling. These run without a device.
- **On-device manual checklist** (documented in `android/README.md`) for
  the parts that require a real WebView and multiple processes:
  1. Create two containers, sign into a different Claude account in each.
  2. Switch between them; confirm each retains its own logged-in session
     (isolation holds — the central risk of Approach A).
  3. Kill and reopen the app; confirm it resumes the last active container.
  4. Tap an external link; confirm it opens in the system browser, not
     in-app.
  5. Remove a container; confirm its storage is gone (re-adding a
     same-named container starts logged out).

This mirrors the desktop project, which has no automated test suite; the
testable pure logic is covered by unit tests, and the process/WebView
behavior by a repeatable manual script.

## Future path to Approach B

Structuring `ContainerStore` and the rail independently of the WebView host
leaves room to grow into Approach B (a pool of `:c0…:cN` per-process
Activities for warm background sessions and a desktop-style load/unload +
`maxLoadedContainers` cap) if warm switching ever proves worth the
multi-process complexity. Not planned for v1.
