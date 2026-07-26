package com.claudecontainers.android

import org.json.JSONObject
import java.io.File

data class Settings(
    val activeId: String? = null,
    val confirmBeforeDelete: Boolean = true,
    val resumeLastActive: Boolean = true,
    /**
     * How many containers stay warm (one live host process each). More warm
     * containers means instant switching but real memory cost — each one is a
     * full Chromium renderer. Clamped to [SlotStore.MAX_SLOTS].
     */
    val warmSlots: Int = DEFAULT_WARM_SLOTS,
    /**
     * When false (the default) the app suppresses the soft keyboard that
     * claude.ai's auto-focused composer would otherwise pop up on every load.
     * Tapping the composer still opens it.
     */
    val focusComposerOnOpen: Boolean = false,
    /** WebView text zoom, percent. */
    val textZoom: Int = 100,
) {
    companion object {
        const val DEFAULT_WARM_SLOTS = 3
        const val MIN_TEXT_ZOOM = 70
        const val MAX_TEXT_ZOOM = 180
    }
}

class SettingsStore(private val dir: File) {

    private val file: File get() = File(dir, "settings.json")

    fun load(): Settings {
        if (!file.exists()) return Settings()
        return try {
            val o = JSONObject(file.readText())
            Settings(
                activeId = if (o.isNull("activeId")) null else o.getString("activeId"),
                confirmBeforeDelete = o.optBoolean("confirmBeforeDelete", true),
                resumeLastActive = o.optBoolean("resumeLastActive", true),
                warmSlots = o.optInt("warmSlots", Settings.DEFAULT_WARM_SLOTS)
                    .coerceIn(1, SlotStore.MAX_SLOTS),
                focusComposerOnOpen = o.optBoolean("focusComposerOnOpen", false),
                textZoom = o.optInt("textZoom", 100)
                    .coerceIn(Settings.MIN_TEXT_ZOOM, Settings.MAX_TEXT_ZOOM),
            )
        } catch (e: org.json.JSONException) {
            Settings()
        }
    }

    fun save(settings: Settings) {
        val o = JSONObject()
            .put("activeId", settings.activeId ?: JSONObject.NULL)
            .put("confirmBeforeDelete", settings.confirmBeforeDelete)
            .put("resumeLastActive", settings.resumeLastActive)
            .put("warmSlots", settings.warmSlots.coerceIn(1, SlotStore.MAX_SLOTS))
            .put("focusComposerOnOpen", settings.focusComposerOnOpen)
            .put(
                "textZoom",
                settings.textZoom.coerceIn(Settings.MIN_TEXT_ZOOM, Settings.MAX_TEXT_ZOOM)
            )
        AtomicWrite.write(dir, "settings.json", o.toString())
    }

    fun setActiveId(id: String?) {
        save(load().copy(activeId = id))
    }
}
