package com.claudecontainers.android

import android.app.Application
import android.webkit.WebView

/**
 * Process entry point. What happens here depends entirely on *which* process
 * this is:
 *
 * - `:cN` (a WebView host) — pin the process to slot N's container storage.
 *   This must happen before any WebView exists in the process, and can never be
 *   undone for the process's lifetime. This is the whole isolation mechanism.
 * - the main process — the router ([MainActivity]). It never hosts a WebView,
 *   so it stays unpinned and is a safe place to run deferred storage wipes.
 * - `:phoenix` — a trampoline that only restarts other processes. Do nothing.
 */
class ClaudeApp : Application() {

    override fun onCreate() {
        super.onCreate()
        val processName = getProcessName()

        val slot = SlotStore.slotFromProcessName(processName, packageName)
        if (slot != null) {
            val containerId = try {
                SlotStore(filesDir).containerForSlot(slot)
            } catch (e: Exception) {
                // A transient read failure should degrade to default storage,
                // not crash the app at launch. ContainerActivity re-checks the
                // binding and routes away rather than showing a wrong session.
                null
            }
            if (containerId != null) {
                try {
                    WebView.setDataDirectorySuffix("container_$containerId")
                    pinnedContainerId = containerId
                } catch (e: RuntimeException) {
                    // Already set for this process, or an unusable suffix. Leave
                    // pinnedContainerId null: ContainerActivity treats an
                    // unpinned host process as unopenable rather than silently
                    // falling back to the app's shared, unisolated storage.
                }
            }
            return
        }

        if (processName != packageName) return // :phoenix

        // Router process: no WebView will ever be created here, so it is the
        // safest place to wipe storage for removed containers. Off the main
        // thread — deleting a large WebView cache can take seconds.
        Thread {
            StorageCleaner.processPending(filesDir, SlotStore(filesDir).boundContainerIds())
        }.start()
    }

    companion object {
        /**
         * The container this process's WebView storage is actually pinned to,
         * or null if it was never pinned.
         *
         * The slot binding on disk can change after a process starts (a switch
         * rebinds the slot, then kills the process to respawn it) — but the
         * pin cannot. If those two ever disagree, this process would render one
         * container's page against another's cookies, which is exactly the
         * isolation failure the whole design exists to prevent. Every
         * [ContainerActivity] checks them against each other before showing
         * anything.
         */
        @Volatile
        var pinnedContainerId: String? = null
            private set
    }
}
