# Claude Containers — Android

Native Android port of the desktop multi-container app. Runs several fully
isolated claude.ai sessions with a switcher rail.

## How isolation works

Each container gets its own WebView storage directory via
`WebView.setDataDirectorySuffix("container_<id>")`, which must be set once
per process before any WebView is created. The app runs one container at a
time; switching persists the new active id and relaunches the process
through a small `:phoenix` trampoline so the new storage suffix takes
effect. Cookies, localStorage, and IndexedDB are all isolated per container.

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

1. Launch — claude.ai loads; sign in.
2. Open the rail (menu button on phone; docked on tablet), tap "+", add a
   second container. The app relaunches into the new, logged-out container.
3. Sign into a **different** Claude account in the second container.
4. Switch back to the first container — it is still signed into the first
   account (**isolation holds — the core guarantee**).
5. Fully close and reopen the app — it resumes the last active container.
6. Tap an external (non-claude.ai) link — it opens in the system browser.
7. Long-press a container → Remove — its session is gone; re-adding a
   container with the same name starts logged out.

## Not yet implemented (see the desktop app)

Auto-unload timers, usage overlay, warm multi-session switching, release
signing / Play Store packaging.
