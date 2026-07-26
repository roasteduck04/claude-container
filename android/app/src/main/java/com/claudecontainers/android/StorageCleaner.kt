package com.claudecontainers.android

import org.json.JSONArray
import java.io.File

/**
 * Best-effort cleanup of a container's isolated WebView storage directory
 * (`app_webview_container_<id>`, the directory `setDataDirectorySuffix`
 * creates). Deleting the *active* container's directory while its WebView is
 * live is racy and can ANR on a large cache, so removal of the active
 * container is deferred: the id is queued and wiped at the next cold start,
 * in the main process, before any WebView exists. Non-active containers are
 * not held by any live WebView and can be wiped off the UI thread directly.
 */
object StorageCleaner {

    private fun pendingFile(filesDir: File) = File(filesDir, "pending_deletes.json")

    private fun webViewDir(filesDir: File, id: String) =
        File(filesDir.parentFile, "app_webview_container_$id")

    /** Queue a container id for deletion at next startup. */
    fun enqueue(filesDir: File, id: String) {
        val ids = load(filesDir).toMutableSet()
        ids.add(id)
        save(filesDir, ids)
    }

    /** Delete a container's storage now, on the calling thread. Safe only for
     *  a container that is not currently open. */
    fun deleteNow(filesDir: File, id: String) {
        try {
            val dir = webViewDir(filesDir, id)
            if (dir.exists()) dir.deleteRecursively()
        } catch (e: Exception) {
            // best effort
        }
    }

    /**
     * Process any queued deletions.
     *
     * [protectedIds] are containers currently bound to a warm host process —
     * their storage directory may be open, so skip them and leave them queued
     * for a later pass (they are unbound before being enqueued, so this is a
     * belt-and-braces guard against a stale queue entry).
     *
     * Safe to call from any process, but never on the UI thread: wiping a large
     * WebView cache can take seconds.
     */
    fun processPending(filesDir: File, protectedIds: Set<String> = emptySet()) {
        val ids = load(filesDir)
        if (ids.isEmpty()) return
        val deletable = ids.filter { it !in protectedIds }
        if (deletable.isEmpty()) return
        for (id in deletable) deleteNow(filesDir, id)
        val remaining = ids.filter { it in protectedIds }.toSet()
        if (remaining.isEmpty()) {
            try {
                pendingFile(filesDir).delete()
            } catch (e: Exception) {
                // best effort
            }
        } else {
            save(filesDir, remaining)
        }
    }

    private fun load(filesDir: File): List<String> {
        val f = pendingFile(filesDir)
        if (!f.exists()) return emptyList()
        return try {
            val arr = JSONArray(f.readText())
            (0 until arr.length()).map { arr.getString(it) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun save(filesDir: File, ids: Set<String>) {
        try {
            val arr = JSONArray()
            ids.forEach { arr.put(it) }
            pendingFile(filesDir).writeText(arr.toString())
        } catch (e: Exception) {
            // best effort
        }
    }
}
