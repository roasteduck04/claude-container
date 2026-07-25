package com.claudecontainers.android

import android.app.Application
import android.webkit.WebView

class ClaudeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // The :phoenix trampoline process runs this too but never hosts a WebView.
        // Only pin storage in the main process.
        if (getProcessName() != packageName) return

        // Wipe any containers queued for deletion while no WebView is open yet.
        StorageCleaner.processPending(filesDir)

        // Pin THIS process to the active container's isolated storage.
        // Must happen before any WebView is created in the process.
        val activeId = try {
            SettingsStore(filesDir).load().activeId
        } catch (e: Exception) {
            // A transient read failure should degrade to default storage,
            // not crash the app at launch.
            null
        }
        if (activeId != null) {
            try {
                WebView.setDataDirectorySuffix("container_$activeId")
            } catch (e: IllegalStateException) {
                // Already set for this process — safe to ignore.
            }
        }
    }
}
