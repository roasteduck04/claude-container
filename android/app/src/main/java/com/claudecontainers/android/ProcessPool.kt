package com.claudecontainers.android

import android.app.ActivityManager
import android.content.Context

/**
 * The fixed pool of WebView host processes.
 *
 * Each slot `N` is the pair (`ContainerActivityN`, process `:cN`). The manifest
 * declares them statically because `android:process` cannot be assigned at
 * runtime — this is why the pool has a compile-time maximum
 * ([SlotStore.MAX_SLOTS]) that the `warmSlots` setting can only cap, not raise.
 */
object ProcessPool {

    fun activityForSlot(slot: Int): Class<*> = when (slot) {
        0 -> ContainerActivity0::class.java
        1 -> ContainerActivity1::class.java
        2 -> ContainerActivity2::class.java
        else -> ContainerActivity3::class.java
    }

    private fun processNameForSlot(context: Context, slot: Int) = "${context.packageName}:c$slot"

    /**
     * Kill the process hosting [slot] so it can be respawned against a different
     * container's storage. Same-UID, so this is permitted without any
     * permission. Returns false if the process isn't running, or if it is *our*
     * process (a caller must never kill itself here — see
     * [ContainerActivity.switchTo]).
     *
     * `getRunningAppProcesses` returns only this app's own processes on API 26+,
     * which is exactly the scope needed.
     */
    fun killSlot(context: Context, slot: Int): Boolean {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            ?: return false
        val target = processNameForSlot(context, slot)
        val pid = try {
            am.runningAppProcesses?.firstOrNull { it.processName == target }?.pid
        } catch (e: Exception) {
            null
        } ?: return false
        if (pid == android.os.Process.myPid()) return false
        return try {
            android.os.Process.killProcess(pid)
            true
        } catch (e: Exception) {
            false
        }
    }
}
