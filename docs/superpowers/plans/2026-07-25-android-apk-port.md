# Android APK Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable native Android app that runs several fully isolated claude.ai sessions with a switcher rail, sideloadable as a debug APK.

**Architecture:** One main process pinned to the active container's WebView storage via `WebView.setDataDirectorySuffix`. Switching containers persists a new `activeId` and cleanly relaunches the process through a tiny `:phoenix` trampoline (hand-rolled ProcessPhoenix), so the new process picks up the new storage suffix. Container list and settings persist as JSON in `filesDir`, same shape as the desktop app.

**Tech Stack:** Kotlin, Android SDK (compileSdk 34 / minSdk 28), Gradle 8.7 + AGP 8.5.2, classic Views + XML (no Compose), `org.json` for persistence, JUnit for unit tests.

## Global Constraints

- New code lives under `android/` at the repo root. The existing Electron files (`main.js`, `preload.js`, `renderer/`, etc.) are **not** modified.
- `applicationId` = `com.claudecontainers.android`.
- `compileSdk 34`, `targetSdk 34`, `minSdk 28`, `buildToolsVersion "34.0.0"`.
- AGP `8.5.2`, Gradle `8.7`, Kotlin `1.9.24`.
- No Jetpack Compose. Views + XML only.
- `containers.json` stores only `[{ id, name, color }]`. `settings.json` stores only `{ activeId, confirmBeforeDelete, resumeLastActive }`. **Never** persist session/auth data in either — that belongs to the partitioned WebView storage.
- External links (host not `claude.ai` / `*.claude.ai` / `*.anthropic.com`) open in the system browser, never in-app — this is a security boundary, not just UX.
- Design tokens (single source of truth in `colors.xml` / `dimens.xml`): rail background charcoal `#1F1E1D`, accent terracotta `#D97757`, badge text `#EDEAE5`.
- Package for all Kotlin: `com.claudecontainers.android`.

---

### Task 1: Gradle project scaffold that builds an empty debug APK

**Files:**
- Create: `android/settings.gradle.kts`
- Create: `android/build.gradle.kts`
- Create: `android/gradle.properties`
- Create: `android/app/build.gradle.kts`
- Create: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/res/values/strings.xml`
- Create: `android/app/src/main/java/com/claudecontainers/android/MainActivity.kt`
- Create: `android/app/src/main/res/layout/activity_main.xml`
- Create: `android/.gitignore`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a buildable Gradle project; `MainActivity` (empty shell, replaced in Task 5).

- [ ] **Step 1: Create `android/settings.gradle.kts`**

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "ClaudeContainers"
include(":app")
```

- [ ] **Step 2: Create `android/build.gradle.kts`**

```kotlin
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
```

- [ ] **Step 3: Create `android/gradle.properties`**

```properties
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
```

- [ ] **Step 4: Create `android/app/build.gradle.kts`**

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.claudecontainers.android"
    compileSdk = 34
    buildToolsVersion = "34.0.0"

    defaultConfig {
        applicationId = "com.claudecontainers.android"
        minSdk = 28
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.drawerlayout:drawerlayout:1.2.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
```

- [ ] **Step 5: Create `android/app/src/main/res/values/strings.xml`**

```xml
<resources>
    <string name="app_name">Claude Containers</string>
</resources>
```

- [ ] **Step 6: Create `android/app/src/main/AndroidManifest.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:allowBackup="false"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.Material3.DayNight.NoActionBar">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

- [ ] **Step 7: Create `android/app/src/main/res/layout/activity_main.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent" />
```

- [ ] **Step 8: Create `android/app/src/main/java/com/claudecontainers/android/MainActivity.kt`**

```kotlin
package com.claudecontainers.android

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
    }
}
```

- [ ] **Step 9: Create `android/.gitignore`**

```gitignore
.gradle/
build/
local.properties
*.iml
.idea/
.kotlin/
```

- [ ] **Step 10: Generate the Gradle wrapper**

The user has Android Studio (bundled Gradle). Generate the wrapper so CLI builds work:

Run (from `android/`): `gradle wrapper --gradle-version 8.7`
Expected: creates `android/gradlew`, `android/gradlew.bat`, `android/gradle/wrapper/gradle-wrapper.jar`, `android/gradle/wrapper/gradle-wrapper.properties`.

If no system `gradle` is on PATH, open `android/` in Android Studio once and let it sync — that generates the wrapper — then continue on the CLI. Do **not** add `gradle-wrapper.jar` to `.gitignore`; it must be committed.

- [ ] **Step 11: Build the empty APK to verify the toolchain**

Run (from `android/`): `./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL`, and `android/app/build/outputs/apk/debug/app-debug.apk` exists.

- [ ] **Step 12: Commit**

```bash
git add android/
git commit -m "feat(android): scaffold Gradle project that builds an empty debug APK"
```

---

### Task 2: ContainerStore — container list persistence (TDD)

**Files:**
- Create: `android/app/src/main/java/com/claudecontainers/android/Container.kt`
- Create: `android/app/src/main/java/com/claudecontainers/android/ContainerStore.kt`
- Test: `android/app/src/test/java/com/claudecontainers/android/ContainerStoreTest.kt`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `data class Container(val id: String, val name: String, val color: String)`
  - `class ContainerStore(private val dir: File)` with:
    - `fun load(): MutableList<Container>`
    - `fun save(containers: List<Container>)`
    - `fun add(name: String, color: String): Container` (generates id, appends, saves, returns it)
    - `fun rename(id: String, name: String)`
    - `fun remove(id: String)`
  - IDs are generated as `"c" + System.currentTimeMillis() + "_" + counter`; tests pass explicit lists to avoid time dependence where possible.

- [ ] **Step 1: Write the failing test**

`android/app/src/test/java/com/claudecontainers/android/ContainerStoreTest.kt`:

```kotlin
package com.claudecontainers.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ContainerStoreTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test fun loadOnEmptyDirReturnsEmptyList() {
        val store = ContainerStore(tmp.root)
        assertTrue(store.load().isEmpty())
    }

    @Test fun saveThenLoadRoundTrips() {
        val store = ContainerStore(tmp.root)
        val items = listOf(
            Container("a", "Work", "#D97757"),
            Container("b", "Personal", "#6B8E7B")
        )
        store.save(items)
        val loaded = store.load()
        assertEquals(items, loaded)
    }

    @Test fun addAppendsAndPersists() {
        val store = ContainerStore(tmp.root)
        val c = store.add("Work", "#D97757")
        assertEquals("Work", c.name)
        val loaded = store.load()
        assertEquals(1, loaded.size)
        assertEquals(c, loaded[0])
    }

    @Test fun renameUpdatesNameOnly() {
        val store = ContainerStore(tmp.root)
        val c = store.add("Work", "#D97757")
        store.rename(c.id, "Job")
        val loaded = store.load()
        assertEquals("Job", loaded[0].name)
        assertEquals(c.color, loaded[0].color)
    }

    @Test fun removeDeletesById() {
        val store = ContainerStore(tmp.root)
        val a = store.add("Work", "#D97757")
        store.add("Personal", "#6B8E7B")
        store.remove(a.id)
        val loaded = store.load()
        assertEquals(1, loaded.size)
        assertEquals("Personal", loaded[0].name)
    }

    @Test fun loadOnCorruptFileReturnsEmptyList() {
        tmp.root.resolve("containers.json").writeText("{ not valid json")
        val store = ContainerStore(tmp.root)
        assertTrue(store.load().isEmpty())
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `android/`): `./gradlew :app:testDebugUnitTest --tests "com.claudecontainers.android.ContainerStoreTest"`
Expected: FAIL — `Container` / `ContainerStore` unresolved.

- [ ] **Step 3: Create `Container.kt`**

```kotlin
package com.claudecontainers.android

data class Container(
    val id: String,
    val name: String,
    val color: String,
)
```

- [ ] **Step 4: Create `ContainerStore.kt`**

```kotlin
package com.claudecontainers.android

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class ContainerStore(private val dir: File) {

    private val file: File get() = File(dir, "containers.json")
    private var counter = 0

    fun load(): MutableList<Container> {
        if (!file.exists()) return mutableListOf()
        return try {
            val arr = JSONArray(file.readText())
            val out = mutableListOf<Container>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                out.add(
                    Container(
                        id = o.getString("id"),
                        name = o.getString("name"),
                        color = o.getString("color"),
                    )
                )
            }
            out
        } catch (e: Exception) {
            mutableListOf()
        }
    }

    fun save(containers: List<Container>) {
        val arr = JSONArray()
        for (c in containers) {
            arr.put(
                JSONObject()
                    .put("id", c.id)
                    .put("name", c.name)
                    .put("color", c.color)
            )
        }
        writeAtomic(arr.toString())
    }

    fun add(name: String, color: String): Container {
        val c = Container(id = newId(), name = name, color = color)
        val list = load()
        list.add(c)
        save(list)
        return c
    }

    fun rename(id: String, name: String) {
        val list = load()
        val i = list.indexOfFirst { it.id == id }
        if (i >= 0) {
            list[i] = list[i].copy(name = name)
            save(list)
        }
    }

    fun remove(id: String) {
        val list = load()
        list.removeAll { it.id == id }
        save(list)
    }

    private fun newId(): String {
        counter += 1
        return "c${System.currentTimeMillis()}_$counter"
    }

    private fun writeAtomic(text: String) {
        if (!dir.exists()) dir.mkdirs()
        val tmp = File(dir, "containers.json.tmp")
        tmp.writeText(text)
        val target = file
        if (target.exists()) target.delete()
        tmp.renameTo(target)
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `android/`): `./gradlew :app:testDebugUnitTest --tests "com.claudecontainers.android.ContainerStoreTest"`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/claudecontainers/android/Container.kt \
        android/app/src/main/java/com/claudecontainers/android/ContainerStore.kt \
        android/app/src/test/java/com/claudecontainers/android/ContainerStoreTest.kt
git commit -m "feat(android): add ContainerStore with JSON persistence + unit tests"
```

---

### Task 3: SettingsStore — active id + prefs (TDD)

**Files:**
- Create: `android/app/src/main/java/com/claudecontainers/android/SettingsStore.kt`
- Test: `android/app/src/test/java/com/claudecontainers/android/SettingsStoreTest.kt`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `data class Settings(val activeId: String? = null, val confirmBeforeDelete: Boolean = true, val resumeLastActive: Boolean = true)`
  - `class SettingsStore(private val dir: File)` with:
    - `fun load(): Settings`
    - `fun save(settings: Settings)`
    - `fun setActiveId(id: String?)` (load, copy, save)

- [ ] **Step 1: Write the failing test**

`android/app/src/test/java/com/claudecontainers/android/SettingsStoreTest.kt`:

```kotlin
package com.claudecontainers.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SettingsStoreTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test fun loadOnEmptyDirReturnsDefaults() {
        val s = SettingsStore(tmp.root).load()
        assertNull(s.activeId)
        assertTrue(s.confirmBeforeDelete)
        assertTrue(s.resumeLastActive)
    }

    @Test fun saveThenLoadRoundTrips() {
        val store = SettingsStore(tmp.root)
        store.save(Settings(activeId = "abc", confirmBeforeDelete = false, resumeLastActive = false))
        val s = store.load()
        assertEquals("abc", s.activeId)
        assertEquals(false, s.confirmBeforeDelete)
        assertEquals(false, s.resumeLastActive)
    }

    @Test fun setActiveIdUpdatesOnlyActiveId() {
        val store = SettingsStore(tmp.root)
        store.save(Settings(activeId = "a", confirmBeforeDelete = false))
        store.setActiveId("b")
        val s = store.load()
        assertEquals("b", s.activeId)
        assertEquals(false, s.confirmBeforeDelete)
    }

    @Test fun loadOnCorruptFileReturnsDefaults() {
        tmp.root.resolve("settings.json").writeText("nope")
        val s = SettingsStore(tmp.root).load()
        assertNull(s.activeId)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `android/`): `./gradlew :app:testDebugUnitTest --tests "com.claudecontainers.android.SettingsStoreTest"`
Expected: FAIL — `Settings` / `SettingsStore` unresolved.

- [ ] **Step 3: Create `SettingsStore.kt`**

```kotlin
package com.claudecontainers.android

import org.json.JSONObject
import java.io.File

data class Settings(
    val activeId: String? = null,
    val confirmBeforeDelete: Boolean = true,
    val resumeLastActive: Boolean = true,
)

class SettingsStore(private val dir: File) {

    private val file: File get() = File(dir, "settings.json")

    fun load(): Settings {
        if (!file.exists()) return Settings()
        return try {
            val o = JSONObject(file.readText())
            Settings(
                activeId = if (o.isNull("activeId")) null else o.optString("activeId", null),
                confirmBeforeDelete = o.optBoolean("confirmBeforeDelete", true),
                resumeLastActive = o.optBoolean("resumeLastActive", true),
            )
        } catch (e: Exception) {
            Settings()
        }
    }

    fun save(settings: Settings) {
        val o = JSONObject()
            .put("activeId", settings.activeId ?: JSONObject.NULL)
            .put("confirmBeforeDelete", settings.confirmBeforeDelete)
            .put("resumeLastActive", settings.resumeLastActive)
        writeAtomic(o.toString())
    }

    fun setActiveId(id: String?) {
        save(load().copy(activeId = id))
    }

    private fun writeAtomic(text: String) {
        if (!dir.exists()) dir.mkdirs()
        val tmp = File(dir, "settings.json.tmp")
        tmp.writeText(text)
        if (file.exists()) file.delete()
        tmp.renameTo(file)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `android/`): `./gradlew :app:testDebugUnitTest --tests "com.claudecontainers.android.SettingsStoreTest"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/claudecontainers/android/SettingsStore.kt \
        android/app/src/test/java/com/claudecontainers/android/SettingsStoreTest.kt
git commit -m "feat(android): add SettingsStore for active id + prefs"
```

---

### Task 4: Isolation core — Application suffix + Phoenix relaunch

**Files:**
- Create: `android/app/src/main/java/com/claudecontainers/android/ClaudeApp.kt`
- Create: `android/app/src/main/java/com/claudecontainers/android/Phoenix.kt`
- Create: `android/app/src/main/java/com/claudecontainers/android/PhoenixActivity.kt`
- Modify: `android/app/src/main/AndroidManifest.xml` (register `ClaudeApp` + `PhoenixActivity`)

**Interfaces:**
- Consumes: `SettingsStore` (Task 3).
- Produces:
  - `ClaudeApp : Application` — in `onCreate`, reads `activeId` and calls `WebView.setDataDirectorySuffix("container_" + activeId)` when an id exists.
  - `object Phoenix { fun restart(context: Context) }` — relaunches the app via `PhoenixActivity` in the `:phoenix` process.
  - `PhoenixActivity` — launches `MainActivity` in a fresh main process, then kills the old main process.

**Note:** This task has no unit test (multi-process/WebView behavior needs a device). It is verified on-device in Task 7's checklist. The deliverable is that the app still builds and launches.

- [ ] **Step 1: Create `ClaudeApp.kt`**

```kotlin
package com.claudecontainers.android

import android.app.Application
import android.webkit.WebView

class ClaudeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Pin THIS process to the active container's isolated storage.
        // Must happen before any WebView is created in the process.
        val activeId = SettingsStore(filesDir).load().activeId
        if (activeId != null) {
            try {
                WebView.setDataDirectorySuffix("container_$activeId")
            } catch (e: IllegalStateException) {
                // Already set this process — safe to ignore.
            }
        }
    }
}
```

- [ ] **Step 2: Create `Phoenix.kt`**

```kotlin
package com.claudecontainers.android

import android.content.Context
import android.content.Intent

/**
 * Cleanly restarts the app's main process so a new data-directory suffix
 * (set in ClaudeApp.onCreate) takes effect. PhoenixActivity runs in the
 * :phoenix process, so it survives the death of the main process.
 */
object Phoenix {
    fun restart(context: Context) {
        val intent = Intent(context, PhoenixActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra(PhoenixActivity.EXTRA_MAIN_PID, android.os.Process.myPid())
        }
        context.startActivity(intent)
    }
}
```

- [ ] **Step 3: Create `PhoenixActivity.kt`**

```kotlin
package com.claudecontainers.android

import android.content.Intent
import android.os.Bundle
import android.os.Process
import androidx.appcompat.app.AppCompatActivity

class PhoenixActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val mainPid = intent.getIntExtra(EXTRA_MAIN_PID, -1)
        if (mainPid > 0 && mainPid != Process.myPid()) {
            Process.killProcess(mainPid)
        }

        val launch = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        }
        startActivity(launch)
        finish()
        // Ensure the :phoenix process itself doesn't linger.
        Runtime.getRuntime().exit(0)
    }

    companion object {
        const val EXTRA_MAIN_PID = "main_pid"
    }
}
```

- [ ] **Step 4: Register `ClaudeApp` and `PhoenixActivity` in the manifest**

In `android/app/src/main/AndroidManifest.xml`, set `android:name` on `<application>` and add the phoenix activity. The `<application>` open tag becomes:

```xml
    <application
        android:name=".ClaudeApp"
        android:allowBackup="false"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.Material3.DayNight.NoActionBar">
```

And add this activity inside `<application>`, after `MainActivity`:

```xml
        <activity
            android:name=".PhoenixActivity"
            android:exported="false"
            android:process=":phoenix"
            android:theme="@android:style/Theme.NoDisplay" />
```

- [ ] **Step 5: Build to verify it still compiles**

Run (from `android/`): `./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/claudecontainers/android/ClaudeApp.kt \
        android/app/src/main/java/com/claudecontainers/android/Phoenix.kt \
        android/app/src/main/java/com/claudecontainers/android/PhoenixActivity.kt \
        android/app/src/main/AndroidManifest.xml
git commit -m "feat(android): add per-process storage suffix + Phoenix relaunch"
```

---

### Task 5: WebView host in MainActivity

**Files:**
- Modify: `android/app/src/main/java/com/claudecontainers/android/MainActivity.kt`
- Create: `android/app/src/main/java/com/claudecontainers/android/ContainerWebViewClient.kt`
- Modify: `android/app/src/main/res/layout/activity_main.xml`
- Create: `android/app/src/main/res/values/colors.xml`
- Test: `android/app/src/test/java/com/claudecontainers/android/ExternalLinkTest.kt`

**Interfaces:**
- Consumes: `ContainerStore`, `SettingsStore` (Tasks 2–3).
- Produces:
  - `object ExternalLink { fun isInternal(host: String?): Boolean }` — true for `claude.ai`, any `*.claude.ai`, and `*.anthropic.com`.
  - `MainActivity` that loads `https://claude.ai` for the active container into a full-screen WebView, routes external links out, handles downloads, back navigation, and render-process crashes.

- [ ] **Step 1: Write the failing test for external-link classification**

`android/app/src/test/java/com/claudecontainers/android/ExternalLinkTest.kt`:

```kotlin
package com.claudecontainers.android

import org.junit.Assert.assertEquals
import org.junit.Test

class ExternalLinkTest {
    @Test fun claudeHostsAreInternal() {
        assertEquals(true, ExternalLink.isInternal("claude.ai"))
        assertEquals(true, ExternalLink.isInternal("www.claude.ai"))
        assertEquals(true, ExternalLink.isInternal("api.claude.ai"))
        assertEquals(true, ExternalLink.isInternal("console.anthropic.com"))
    }

    @Test fun otherHostsAreExternal() {
        assertEquals(false, ExternalLink.isInternal("google.com"))
        assertEquals(false, ExternalLink.isInternal("evil-claude.ai.example.com"))
        assertEquals(false, ExternalLink.isInternal(null))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `android/`): `./gradlew :app:testDebugUnitTest --tests "com.claudecontainers.android.ExternalLinkTest"`
Expected: FAIL — `ExternalLink` unresolved.

- [ ] **Step 3: Create `ContainerWebViewClient.kt` with `ExternalLink` + client**

```kotlin
package com.claudecontainers.android

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

object ExternalLink {
    private val internalSuffixes = listOf(".claude.ai", ".anthropic.com")
    private val internalExact = listOf("claude.ai", "anthropic.com")

    fun isInternal(host: String?): Boolean {
        if (host == null) return false
        val h = host.lowercase()
        if (internalExact.contains(h)) return true
        return internalSuffixes.any { h.endsWith(it) }
    }
}

class ContainerWebViewClient(private val context: Context) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") {
            // mailto:, intent:, tel: etc. — hand to the system.
            openExternally(uri)
            return true
        }
        if (ExternalLink.isInternal(uri.host)) {
            return false // load in-app
        }
        openExternally(uri)
        return true
    }

    private fun openExternally(uri: Uri) {
        try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(context, "No app to open link", Toast.LENGTH_SHORT).show()
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `android/`): `./gradlew :app:testDebugUnitTest --tests "com.claudecontainers.android.ExternalLinkTest"`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `android/app/src/main/res/values/colors.xml`**

```xml
<resources>
    <color name="rail_bg">#FF1F1E1D</color>
    <color name="accent">#FFD97757</color>
    <color name="badge_text">#FFEDEAE5</color>
    <color name="content_bg">#FF262624</color>
</resources>
```

- [ ] **Step 6: Replace `activity_main.xml` with a WebView container**

```xml
<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/content_frame"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/content_bg">

    <WebView
        android:id="@+id/web_view"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />
</FrameLayout>
```

- [ ] **Step 7: Rewrite `MainActivity.kt` to host the WebView**

```kotlin
package com.claudecontainers.android

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var containerStore: ContainerStore
    private lateinit var settingsStore: SettingsStore

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        containerStore = ContainerStore(filesDir)
        settingsStore = SettingsStore(filesDir)

        webView = findViewById(R.id.web_view)
        configureWebView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        loadActiveContainer()
    }

    private fun loadActiveContainer() {
        val active = settingsStore.load().activeId
        val containers = containerStore.load()
        // If no active container yet, bootstrap one so first launch shows Claude.
        if (active == null || containers.none { it.id == active }) {
            if (containers.isEmpty()) {
                val c = containerStore.add("Claude", "@color/accent".let { "#D97757" })
                settingsStore.setActiveId(c.id)
                Phoenix.restart(this)
                return
            }
            settingsStore.setActiveId(containers.first().id)
            Phoenix.restart(this)
            return
        }
        webView.loadUrl("https://claude.ai/")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(wv: WebView) {
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            javaScriptCanOpenWindowsAutomatically = true
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(wv, true)
        }
        wv.webViewClient = object : ContainerWebViewClient(this) {
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // Reload the container rather than letting the app crash.
                view.loadUrl("https://claude.ai/")
                return true
            }
        }
        wv.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mimeType)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            }
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
        }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }
}
```

Note: `ContainerWebViewClient` is subclassed inline to override `onRenderProcessGone`; make its methods open by keeping the class `open`. Update the class declaration in `ContainerWebViewClient.kt` to `open class ContainerWebViewClient(...)`.

- [ ] **Step 8: Make `ContainerWebViewClient` open**

In `ContainerWebViewClient.kt`, change `class ContainerWebViewClient` to `open class ContainerWebViewClient` and `override fun shouldOverrideUrlLoading` to `override fun shouldOverrideUrlLoading` inside an `open` class (already override of the framework method — just ensure the class is `open`).

- [ ] **Step 9: Add INTERNET permission (already added in Task 1) and grant cleartext off**

No change needed — Task 1 added `INTERNET`. claude.ai is HTTPS, so no cleartext config required.

- [ ] **Step 10: Build + install + smoke test on device/emulator**

Run (from `android/`): `./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL`.

Run: `adb install -r app/build/outputs/apk/debug/app-debug.apk`
Then launch the app. Expected: claude.ai loads and is usable; you can log in.

- [ ] **Step 11: Commit**

```bash
git add android/app/src/main/java/com/claudecontainers/android/MainActivity.kt \
        android/app/src/main/java/com/claudecontainers/android/ContainerWebViewClient.kt \
        android/app/src/main/res/layout/activity_main.xml \
        android/app/src/main/res/values/colors.xml \
        android/app/src/test/java/com/claudecontainers/android/ExternalLinkTest.kt
git commit -m "feat(android): load active container in isolated WebView with external-link + download handling"
```

---

### Task 6: Switcher rail — drawer, badges, add/rename/remove/switch

**Files:**
- Modify: `android/app/src/main/res/layout/activity_main.xml` (wrap in `DrawerLayout`)
- Create: `android/app/src/main/res/layout/rail.xml`
- Create: `android/app/src/main/res/layout/badge_item.xml`
- Create: `android/app/src/main/res/drawable/badge_bg.xml`
- Create: `android/app/src/main/res/values/dimens.xml`
- Create: `android/app/src/main/java/com/claudecontainers/android/RailView.kt`
- Modify: `android/app/src/main/java/com/claudecontainers/android/MainActivity.kt`

**Interfaces:**
- Consumes: `ContainerStore`, `SettingsStore`, `Phoenix` (Tasks 2–4).
- Produces:
  - `class RailView(context, attrs)` — renders badges from a `List<Container>` with the active one highlighted; exposes callbacks:
    - `var onSelect: (Container) -> Unit`
    - `var onLongPress: (Container) -> Unit`
    - `var onAdd: () -> Unit`
    - `fun render(containers: List<Container>, activeId: String?)`
  - Switch = `settingsStore.setActiveId(id)` then `Phoenix.restart(this)`.

- [ ] **Step 1: Create `android/app/src/main/res/values/dimens.xml`**

```xml
<resources>
    <dimen name="rail_width">72dp</dimen>
    <dimen name="badge_size">48dp</dimen>
    <dimen name="badge_margin">12dp</dimen>
    <dimen name="badge_radius">16dp</dimen>
</resources>
```

- [ ] **Step 2: Create `android/app/src/main/res/drawable/badge_bg.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <corners android:radius="@dimen/badge_radius" />
    <solid android:color="#D97757" />
</shape>
```

- [ ] **Step 3: Create `android/app/src/main/res/layout/badge_item.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="@dimen/badge_size"
    android:layout_height="@dimen/badge_size"
    android:layout_marginBottom="@dimen/badge_margin"
    android:background="@drawable/badge_bg"
    android:foreground="?android:attr/selectableItemBackground">

    <TextView
        android:id="@+id/badge_letter"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_gravity="center"
        android:textColor="@color/badge_text"
        android:textSize="20sp"
        android:textStyle="bold" />
</FrameLayout>
```

- [ ] **Step 4: Create `android/app/src/main/res/layout/rail.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/rail_root"
    android:layout_width="@dimen/rail_width"
    android:layout_height="match_parent"
    android:layout_gravity="start"
    android:orientation="vertical"
    android:background="@color/rail_bg"
    android:gravity="center_horizontal"
    android:paddingTop="@dimen/badge_margin">

    <LinearLayout
        android:id="@+id/badge_container"
        android:layout_width="wrap_content"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:orientation="vertical"
        android:gravity="center_horizontal" />

    <FrameLayout
        android:id="@+id/add_badge"
        android:layout_width="@dimen/badge_size"
        android:layout_height="@dimen/badge_size"
        android:layout_marginBottom="@dimen/badge_margin"
        android:background="@drawable/badge_bg"
        android:foreground="?android:attr/selectableItemBackground">

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_gravity="center"
            android:text="+"
            android:textColor="@color/badge_text"
            android:textSize="26sp" />
    </FrameLayout>
</LinearLayout>
```

- [ ] **Step 5: Create `RailView.kt`**

```kotlin
package com.claudecontainers.android

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.AttributeSet
import android.view.LayoutInflater
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

class RailView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : LinearLayout(context) {

    var onSelect: (Container) -> Unit = {}
    var onLongPress: (Container) -> Unit = {}
    var onAdd: () -> Unit = {}

    private val badgeContainer: LinearLayout
    private val addBadge: FrameLayout

    init {
        LayoutInflater.from(context).inflate(R.layout.rail, this, true)
        badgeContainer = findViewById(R.id.badge_container)
        addBadge = findViewById(R.id.add_badge)
        addBadge.setOnClickListener { onAdd() }
    }

    fun render(containers: List<Container>, activeId: String?) {
        badgeContainer.removeAllViews()
        for (c in containers) {
            val view = LayoutInflater.from(context)
                .inflate(R.layout.badge_item, badgeContainer, false)
            val letter = view.findViewById<TextView>(R.id.badge_letter)
            letter.text = c.name.trim().take(1).uppercase().ifEmpty { "?" }

            val bg = GradientDrawable().apply {
                cornerRadius = resources.getDimension(R.dimen.badge_radius)
                setColor(parseColor(c.color))
                if (c.id == activeId) {
                    setStroke(6, resources.getColor(R.color.accent, null))
                }
            }
            view.background = bg

            view.setOnClickListener { onSelect(c) }
            view.setOnLongClickListener { onLongPress(c); true }
            badgeContainer.addView(view)
        }
    }

    private fun parseColor(hex: String): Int =
        try { Color.parseColor(hex) } catch (e: Exception) { Color.parseColor("#D97757") }
}
```

- [ ] **Step 6: Wrap the content in a `DrawerLayout` in `activity_main.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<androidx.drawerlayout.widget.DrawerLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/drawer_layout"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <FrameLayout
        android:id="@+id/content_frame"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:background="@color/content_bg">

        <WebView
            android:id="@+id/web_view"
            android:layout_width="match_parent"
            android:layout_height="match_parent" />

        <ImageButton
            android:id="@+id/menu_button"
            android:layout_width="44dp"
            android:layout_height="44dp"
            android:layout_margin="8dp"
            android:background="@drawable/badge_bg"
            android:src="@android:drawable/ic_menu_sort_by_size"
            android:contentDescription="Containers" />
    </FrameLayout>

    <com.claudecontainers.android.RailView
        android:id="@+id/rail"
        android:layout_width="@dimen/rail_width"
        android:layout_height="match_parent"
        android:layout_gravity="start" />
</androidx.drawerlayout.widget.DrawerLayout>
```

- [ ] **Step 7: Wire the rail into `MainActivity.kt`**

Add these members and calls. Insert after `webView = findViewById(...)` / `configureWebView(...)` in `onCreate`:

```kotlin
        val drawer = findViewById<androidx.drawerlayout.widget.DrawerLayout>(R.id.drawer_layout)
        val rail = findViewById<RailView>(R.id.rail)
        findViewById<android.widget.ImageButton>(R.id.menu_button).setOnClickListener {
            drawer.openDrawer(rail)
        }

        rail.onSelect = { c ->
            drawer.closeDrawers()
            if (c.id != settingsStore.load().activeId) {
                settingsStore.setActiveId(c.id)
                Phoenix.restart(this)
            }
        }
        rail.onAdd = { showAddDialog() }
        rail.onLongPress = { c -> showContextDialog(c) }

        renderRail()
```

Add a helper `renderRail()` and dialog helpers to `MainActivity`:

```kotlin
    private fun renderRail() {
        val rail = findViewById<RailView>(R.id.rail)
        rail.render(containerStore.load(), settingsStore.load().activeId)
    }

    private fun showAddDialog() {
        val input = android.widget.EditText(this).apply { hint = "Name" }
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Add container")
            .setView(input)
            .setPositiveButton("Add") { _, _ ->
                val name = input.text.toString().trim().ifEmpty { "Claude" }
                val colors = listOf("#D97757", "#6B8E7B", "#7B8FA1", "#B07BA1", "#C2A15A")
                val color = colors[containerStore.load().size % colors.size]
                val c = containerStore.add(name, color)
                settingsStore.setActiveId(c.id)
                Phoenix.restart(this)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showContextDialog(c: Container) {
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle(c.name)
            .setItems(arrayOf("Rename", "Remove")) { _, which ->
                when (which) {
                    0 -> showRenameDialog(c)
                    1 -> confirmRemove(c)
                }
            }
            .show()
    }

    private fun showRenameDialog(c: Container) {
        val input = android.widget.EditText(this).apply { setText(c.name) }
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Rename")
            .setView(input)
            .setPositiveButton("Save") { _, _ ->
                val name = input.text.toString().trim()
                if (name.isNotEmpty()) {
                    containerStore.rename(c.id, name)
                    renderRail()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun confirmRemove(c: Container) {
        val doRemove = {
            containerStore.remove(c.id)
            // Best-effort wipe of this container's isolated storage.
            deleteContainerStorage(c.id)
            val remaining = containerStore.load()
            if (settingsStore.load().activeId == c.id) {
                settingsStore.setActiveId(remaining.firstOrNull()?.id)
                Phoenix.restart(this)
            } else {
                renderRail()
            }
        }
        if (settingsStore.load().confirmBeforeDelete) {
            androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("Remove ${c.name}?")
                .setMessage("This deletes its session and data on this device.")
                .setPositiveButton("Remove") { _, _ -> doRemove() }
                .setNegativeButton("Cancel", null)
                .show()
        } else doRemove()
    }

    private fun deleteContainerStorage(id: String) {
        try {
            val base = filesDir.parentFile ?: return
            val dir = java.io.File(base, "app_webview_container_$id")
            if (dir.exists()) dir.deleteRecursively()
        } catch (e: Exception) { /* best effort */ }
    }
```

- [ ] **Step 8: Build + install + verify the rail**

Run (from `android/`): `./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk`
Expected: `BUILD SUCCESSFUL`; menu button opens the rail; "+" adds a container and relaunches into it; long-press offers Rename/Remove.

- [ ] **Step 9: Commit**

```bash
git add android/app/src/main/res android/app/src/main/java/com/claudecontainers/android/RailView.kt \
        android/app/src/main/java/com/claudecontainers/android/MainActivity.kt
git commit -m "feat(android): add switcher rail with add/rename/remove/switch"
```

---

### Task 7: Tablet layout, README, and on-device verification

**Files:**
- Create: `android/app/src/main/res/layout-sw600dp/activity_main.xml`
- Create: `android/README.md`
- Modify: `README.md` (repo root — add an Android section pointer)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: a tablet variant where the rail is docked (non-modal), plus build/install/verify docs.

- [ ] **Step 1: Create the tablet layout `android/app/src/main/res/layout-sw600dp/activity_main.xml`**

On tablets, dock the rail beside the content instead of over it. Use a horizontal `LinearLayout` as the root; keep the same ids so `MainActivity` code is unchanged. The `DrawerLayout` id is reused but the rail sits inline; opening the drawer is a no-op because it is already visible, and the menu button is hidden.

```xml
<?xml version="1.0" encoding="utf-8"?>
<androidx.drawerlayout.widget.DrawerLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/drawer_layout"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:orientation="horizontal">

        <com.claudecontainers.android.RailView
            android:id="@+id/rail"
            android:layout_width="@dimen/rail_width"
            android:layout_height="match_parent" />

        <FrameLayout
            android:id="@+id/content_frame"
            android:layout_width="0dp"
            android:layout_height="match_parent"
            android:layout_weight="1"
            android:background="@color/content_bg">

            <WebView
                android:id="@+id/web_view"
                android:layout_width="match_parent"
                android:layout_height="match_parent" />

            <ImageButton
                android:id="@+id/menu_button"
                android:layout_width="0dp"
                android:layout_height="0dp"
                android:visibility="gone"
                android:src="@android:drawable/ic_menu_sort_by_size"
                android:contentDescription="Containers" />
        </FrameLayout>
    </LinearLayout>
</androidx.drawerlayout.widget.DrawerLayout>
```

Note: in this variant `RailView` is a direct child of the horizontal `LinearLayout` (a non-drawer child), so it renders docked. The `menu_button` still exists (gone) so `findViewById` in `MainActivity` never returns null. `drawer.openDrawer(rail)` would throw because `rail` is not a drawer child here — guard it in the next step.

- [ ] **Step 2: Guard the menu button for the docked case in `MainActivity.kt`**

Replace the menu-button click wiring from Task 6 Step 7 with a guarded version:

```kotlin
        val menuButton = findViewById<android.widget.ImageButton>(R.id.menu_button)
        menuButton.setOnClickListener {
            try { drawer.openDrawer(rail) } catch (e: Exception) { /* docked tablet */ }
        }
```

- [ ] **Step 3: Build to confirm both layouts compile**

Run (from `android/`): `./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Create `android/README.md`**

````markdown
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
````

- [ ] **Step 5: Add an Android pointer to the root `README.md`**

Add this section near the top of the root `README.md` (after the intro), without altering existing content:

```markdown
## Android

An experimental native Android port lives in [`android/`](android/). It
recreates the isolated multi-session concept using per-process WebView
storage. See [`android/README.md`](android/README.md) to build and install
the APK.
```

- [ ] **Step 6: Run the full unit-test suite**

Run (from `android/`): `./gradlew testDebugUnitTest`
Expected: PASS (ContainerStore + Settings + ExternalLink tests).

- [ ] **Step 7: Final build of the shippable APK**

Run (from `android/`): `./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL`; APK at `app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 8: Commit**

```bash
git add android/app/src/main/res/layout-sw600dp android/README.md README.md \
        android/app/src/main/java/com/claudecontainers/android/MainActivity.kt
git commit -m "feat(android): tablet docked-rail layout + build/verify docs"
```

---

## Self-Review Notes

- **Spec coverage:** isolation (Task 4), persistence (Tasks 2–3), WebView + external links + downloads + crash reload + back nav (Task 5), rail + add/rename/remove/switch (Task 6), phone drawer vs tablet dock (Tasks 6–7), design tokens (Tasks 5–6), build/install/test docs (Task 7). Deferred items remain deferred.
- **Isolation caveat carried into code:** `ClaudeApp` sets the suffix before any WebView; switching always routes through `Phoenix.restart`.
- **Type consistency:** `ContainerStore` / `SettingsStore` / `RailView` / `ExternalLink` signatures are referenced identically across tasks.
- **Known device-only gaps:** the process-restart isolation and WebView behavior are validated by the Task 7 checklist, not unit tests — mirrors the desktop project's testing posture.
