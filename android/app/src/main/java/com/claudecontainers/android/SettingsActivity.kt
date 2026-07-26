package com.claudecontainers.android

import android.os.Bundle
import android.widget.Button
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat

/**
 * The mobile counterpart to the desktop app's Settings modal — trimmed to the
 * preferences that actually mean something on a phone or tablet.
 *
 * Runs in whichever container process opened it, and only touches
 * `settings.json`; every host process reads that file back on resume, so
 * changes apply without a restart. The exception is [Settings.warmSlots]: a
 * lowered cap has to free the now-unreachable host processes, which is done
 * here on save.
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var store: SettingsStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        store = SettingsStore(filesDir)

        val settings = store.load()

        // --- warm containers (1..MAX_SLOTS, seekbar is 0-based) ---
        val warmLabel = findViewById<TextView>(R.id.warm_slots_label)
        val warmSeek = findViewById<SeekBar>(R.id.warm_slots_seek)
        warmSeek.max = SlotStore.MAX_SLOTS - 1
        warmSeek.progress = settings.warmSlots - 1
        fun renderWarm(value: Int) {
            warmLabel.text = getString(R.string.settings_warm_slots_value, value)
        }
        renderWarm(settings.warmSlots)
        warmSeek.setOnSeekBarChangeListener(object : SimpleSeekBarListener() {
            override fun onProgressChanged(sb: SeekBar, progress: Int, fromUser: Boolean) {
                renderWarm(progress + 1)
            }

            override fun onStopTrackingTouch(sb: SeekBar) {
                val value = sb.progress + 1
                store.save(store.load().copy(warmSlots = value))
                // Slots above the new cap can no longer be reached by the
                // switcher; free their memory instead of leaking the processes.
                for (slot in value until SlotStore.MAX_SLOTS) {
                    ProcessPool.killSlot(this@SettingsActivity, slot)
                }
            }
        })

        // --- text zoom (MIN..MAX in steps of 5) ---
        val zoomLabel = findViewById<TextView>(R.id.text_zoom_label)
        val zoomSeek = findViewById<SeekBar>(R.id.text_zoom_seek)
        zoomSeek.max = (Settings.MAX_TEXT_ZOOM - Settings.MIN_TEXT_ZOOM) / ZOOM_STEP
        zoomSeek.progress = (settings.textZoom - Settings.MIN_TEXT_ZOOM) / ZOOM_STEP
        fun renderZoom(value: Int) {
            zoomLabel.text = getString(R.string.settings_text_zoom_value, value)
        }
        renderZoom(settings.textZoom)
        zoomSeek.setOnSeekBarChangeListener(object : SimpleSeekBarListener() {
            override fun onProgressChanged(sb: SeekBar, progress: Int, fromUser: Boolean) {
                renderZoom(Settings.MIN_TEXT_ZOOM + progress * ZOOM_STEP)
            }

            override fun onStopTrackingTouch(sb: SeekBar) {
                store.save(
                    store.load().copy(
                        textZoom = Settings.MIN_TEXT_ZOOM + sb.progress * ZOOM_STEP
                    )
                )
            }
        })

        // --- switches ---
        // Shown as "keep the keyboard closed", which is the inverse of the
        // stored flag — the setting reads better as the thing it prevents.
        val keyboard = findViewById<SwitchCompat>(R.id.keyboard_switch)
        keyboard.isChecked = !settings.focusComposerOnOpen
        keyboard.setOnCheckedChangeListener { _, checked ->
            store.save(store.load().copy(focusComposerOnOpen = !checked))
        }

        val resume = findViewById<SwitchCompat>(R.id.resume_switch)
        resume.isChecked = settings.resumeLastActive
        resume.setOnCheckedChangeListener { _, checked ->
            store.save(store.load().copy(resumeLastActive = checked))
        }

        val confirm = findViewById<SwitchCompat>(R.id.confirm_switch)
        confirm.isChecked = settings.confirmBeforeDelete
        confirm.setOnCheckedChangeListener { _, checked ->
            store.save(store.load().copy(confirmBeforeDelete = checked))
        }

        findViewById<Button>(R.id.done_button).setOnClickListener { finish() }
    }

    private abstract class SimpleSeekBarListener : SeekBar.OnSeekBarChangeListener {
        override fun onStartTrackingTouch(sb: SeekBar) {}
    }

    private companion object {
        const val ZOOM_STEP = 5
    }
}
