package com.claudecontainers.android

import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

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
        } catch (e: org.json.JSONException) {
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
        Files.move(
            tmp.toPath(), file.toPath(),
            StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE,
        )
    }
}
