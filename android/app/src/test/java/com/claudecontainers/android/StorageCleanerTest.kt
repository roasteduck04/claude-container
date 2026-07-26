package com.claudecontainers.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class StorageCleanerTest {

    @get:Rule val tmp = TemporaryFolder()

    /** Mirrors the on-device layout: filesDir is `<appDir>/files`, and the
     *  WebView storage directories are its siblings. */
    private fun filesDir(): File = File(tmp.root, "files").apply { mkdirs() }

    private fun makeStorage(id: String): File =
        File(tmp.root, "app_webview_container_$id").apply {
            mkdirs()
            File(this, "Cookies").writeText("session")
        }

    @Test fun deleteNowRemovesTheContainersStorage() {
        val files = filesDir()
        val dir = makeStorage("a")
        StorageCleaner.deleteNow(files, "a")
        assertFalse(dir.exists())
    }

    @Test fun deleteNowIsSilentWhenThereIsNothingToDelete() {
        StorageCleaner.deleteNow(filesDir(), "never-existed")
    }

    @Test fun pendingDeletionsAreProcessedOnALaterPass() {
        val files = filesDir()
        val dir = makeStorage("a")
        StorageCleaner.enqueue(files, "a")
        assertTrue("queuing must not delete immediately", dir.exists())

        StorageCleaner.processPending(files)
        assertFalse(dir.exists())
    }

    @Test fun aContainerStillBoundToALiveProcessIsSkippedAndStaysQueued() {
        val files = filesDir()
        val live = makeStorage("live")
        val dead = makeStorage("dead")
        StorageCleaner.enqueue(files, "live")
        StorageCleaner.enqueue(files, "dead")

        StorageCleaner.processPending(files, protectedIds = setOf("live"))
        assertFalse("unbound container should be wiped", dead.exists())
        assertTrue("a bound container's storage may be open — never touch it", live.exists())

        // Still queued, so it is wiped once its host process is gone.
        StorageCleaner.processPending(files, protectedIds = emptySet())
        assertFalse(live.exists())
    }

    @Test fun processPendingClearsTheQueueOnceEverythingIsGone() {
        val files = filesDir()
        makeStorage("a")
        StorageCleaner.enqueue(files, "a")
        StorageCleaner.processPending(files)

        // A second container created later must not be caught by a stale queue.
        val fresh = makeStorage("a")
        StorageCleaner.processPending(files)
        assertTrue(fresh.exists())
    }
}
