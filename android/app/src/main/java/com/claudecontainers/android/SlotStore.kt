package com.claudecontainers.android

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Maps containers onto the fixed pool of WebView host processes (`:c0`…`:c3`).
 *
 * `WebView.setDataDirectorySuffix` pins a process to one container's storage for
 * the process's whole lifetime, so a *warm* container is really a live process.
 * A slot is one such process; the binding is sticky until the process is killed.
 * Switching between two bound containers is just an Activity reorder (instant);
 * switching to an unbound one evicts the least-recently-used slot, which costs
 * that slot's process a restart.
 *
 * Pure Kotlin (no Android deps) so it is unit-testable on the JVM.
 */
class SlotStore(private val dir: File) {

    data class Slot(val index: Int, val containerId: String?, val lastUsed: Long)

    /**
     * Result of [bind]: which slot to use, and whether its host process must be
     * killed before the container can be shown there.
     *
     * [needsRestart] is true for *any* binding change, not only eviction of a
     * still-warm container. A slot that looks free may still have a live process
     * pinned to its previous container's storage, and that pin cannot be undone
     * without killing the process.
     */
    data class Binding(val slot: Int, val needsRestart: Boolean)

    private val file: File get() = File(dir, "slots.json")

    fun load(): MutableList<Slot> {
        val out = MutableList(MAX_SLOTS) { Slot(it, null, 0L) }
        if (!file.exists()) return out
        try {
            val arr = JSONArray(file.readText())
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val index = o.getInt("index")
                if (index !in 0 until MAX_SLOTS) continue
                out[index] = Slot(
                    index = index,
                    containerId = if (o.isNull("containerId")) null else o.getString("containerId"),
                    lastUsed = o.optLong("lastUsed", 0L),
                )
            }
        } catch (e: org.json.JSONException) {
            // Corrupt file: fall back to an empty pool rather than failing to start.
        }
        return out
    }

    fun save(slots: List<Slot>) {
        val arr = JSONArray()
        for (s in slots) {
            arr.put(
                JSONObject()
                    .put("index", s.index)
                    .put("containerId", s.containerId ?: JSONObject.NULL)
                    .put("lastUsed", s.lastUsed)
            )
        }
        writeAtomic(arr.toString())
    }

    fun containerForSlot(index: Int): String? =
        load().firstOrNull { it.index == index }?.containerId

    fun slotFor(containerId: String): Int? =
        load().firstOrNull { it.containerId == containerId }?.index

    /**
     * Ensure [containerId] has a slot within [capacity] warm slots.
     *
     * [protectSlot] is the caller's own slot; it is never chosen for eviction
     * (a process cannot usefully kill itself to make room for the view it is
     * about to show). [now] is injected so tests are deterministic.
     */
    fun bind(containerId: String, capacity: Int, protectSlot: Int?, now: Long): Binding {
        val cap = capacity.coerceIn(1, MAX_SLOTS)
        val slots = load()

        // Slots beyond the current capacity are not usable; release their bindings
        // so a shrunken pool doesn't strand containers on unreachable processes.
        for (i in cap until MAX_SLOTS) {
            if (slots[i].containerId != null) slots[i] = slots[i].copy(containerId = null)
        }

        // Already warm here: reuse the process as-is. The only no-restart case.
        val existing = slots.firstOrNull { it.index < cap && it.containerId == containerId }
        if (existing != null) {
            slots[existing.index] = existing.copy(lastUsed = now)
            save(slots)
            return Binding(existing.index, needsRestart = false)
        }

        val free = slots.firstOrNull { it.index < cap && it.containerId == null }
        if (free != null) {
            slots[free.index] = free.copy(containerId = containerId, lastUsed = now)
            save(slots)
            return Binding(free.index, needsRestart = true)
        }

        val victim = slots
            .filter { it.index < cap && it.index != protectSlot }
            .minByOrNull { it.lastUsed }
            ?: slots.first { it.index < cap }
        slots[victim.index] = victim.copy(containerId = containerId, lastUsed = now)
        save(slots)
        return Binding(victim.index, needsRestart = true)
    }

    fun touch(index: Int, now: Long) {
        val slots = load()
        if (index !in 0 until MAX_SLOTS) return
        slots[index] = slots[index].copy(lastUsed = now)
        save(slots)
    }

    /** Release whatever slot holds [containerId]. Returns the freed slot, if any. */
    fun unbind(containerId: String): Int? {
        val slots = load()
        val s = slots.firstOrNull { it.containerId == containerId } ?: return null
        slots[s.index] = s.copy(containerId = null, lastUsed = 0L)
        save(slots)
        return s.index
    }

    /** Container ids currently bound to a live-or-pending slot. */
    fun boundContainerIds(): Set<String> =
        load().mapNotNull { it.containerId }.toSet()

    private fun writeAtomic(text: String) {
        // The slot map is a cache of process bindings, not user data. Losing a
        // write costs at most one cold switch, so the boolean result is ignored.
        AtomicWrite.write(dir, "slots.json", text)
    }

    companion object {
        /** Number of `:cN` host processes declared in AndroidManifest.xml. */
        const val MAX_SLOTS = 4

        /** Parse the slot index out of a process name like `com.pkg:c2`. */
        fun slotFromProcessName(processName: String?, packageName: String): Int? {
            if (processName == null) return null
            val prefix = "$packageName:c"
            if (!processName.startsWith(prefix)) return null
            return processName.removePrefix(prefix).toIntOrNull()
                ?.takeIf { it in 0 until MAX_SLOTS }
        }
    }
}
