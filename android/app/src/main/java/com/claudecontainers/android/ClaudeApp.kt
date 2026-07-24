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
