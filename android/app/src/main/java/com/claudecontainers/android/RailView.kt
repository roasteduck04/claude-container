package com.claudecontainers.android

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.AttributeSet
import android.view.LayoutInflater
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

class RailView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : LinearLayout(context, attrs) {

    var onSelect: (Container) -> Unit = {}
    var onLongPress: (Container) -> Unit = {}
    var onAdd: () -> Unit = {}
    var onSettings: () -> Unit = {}

    private val badgeContainer: LinearLayout
    private val addBadge: FrameLayout
    private val settingsBadge: FrameLayout

    init {
        LayoutInflater.from(context).inflate(R.layout.rail, this, true)
        badgeContainer = findViewById(R.id.badge_container)
        addBadge = findViewById(R.id.add_badge)
        addBadge.setOnClickListener { onAdd() }
        settingsBadge = findViewById(R.id.settings_badge)
        settingsBadge.setOnClickListener { onSettings() }
    }

    fun render(containers: List<Container>, activeId: String?) {
        badgeContainer.removeAllViews()
        for (c in containers) {
            val view = LayoutInflater.from(context)
                .inflate(R.layout.badge_item, badgeContainer, false)
            val letter = view.findViewById<TextView>(R.id.badge_letter)
            letter.text = c.name.trim().take(1).uppercase().ifEmpty { "?" }

            val bg = GradientDrawable().apply {
                cornerRadius = resources.getDimension(R.dimen.badge_radius)
                setColor(parseColor(c.color))
                if (c.id == activeId) {
                    setStroke(6, resources.getColor(R.color.accent, null))
                }
            }
            view.background = bg

            view.setOnClickListener { onSelect(c) }
            view.setOnLongClickListener { onLongPress(c); true }
            badgeContainer.addView(view)
        }
    }

    private fun parseColor(hex: String): Int =
        try { Color.parseColor(hex) } catch (e: Exception) { Color.parseColor("#D97757") }
}
