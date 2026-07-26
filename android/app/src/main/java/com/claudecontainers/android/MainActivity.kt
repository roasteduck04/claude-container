package com.claudecontainers.android

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * The launcher entry point — a router, not a screen.
 *
 * It runs in the main process, which is deliberately never pinned to any
 * container's WebView storage and must therefore never create a WebView. Its
 * whole job is to decide which container should be showing and hand off to that
 * container's slot Activity (which lives in its own process).
 *
 * Note this only runs on a *cold* launch. Tapping the launcher icon while the
 * app's task already exists brings the fronted [ContainerActivity] back
 * directly, with its session still warm.
 */
class MainActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val containerStore = ContainerStore(filesDir)
        val settingsStore = SettingsStore(filesDir)
        val slotStore = SlotStore(filesDir)

        val settings = settingsStore.load()
        val containers = containerStore.load()

        // Resolve the container to show: the last active one, unless the user
        // turned that off or it no longer exists. Bootstrap one if the list is
        // empty (first run, or the last container was just removed).
        val remembered = if (settings.resumeLastActive) settings.activeId else null
        val target = containers.firstOrNull { it.id == remembered }
            ?: containers.firstOrNull()
            ?: containerStore.add("Claude", "#D97757")
        settingsStore.setActiveId(target.id)

        val binding = slotStore.bind(
            containerId = target.id,
            capacity = settings.warmSlots,
            // This process hosts no slot, so nothing is off-limits for eviction.
            protectSlot = null,
            now = System.currentTimeMillis(),
        )
        if (binding.needsRestart) ProcessPool.killSlot(this, binding.slot)

        startActivity(
            Intent(this, ProcessPool.activityForSlot(binding.slot))
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        )
        finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
    }
}
