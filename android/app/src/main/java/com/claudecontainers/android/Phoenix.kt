package com.claudecontainers.android

import android.content.Context
import android.content.Intent

/**
 * Cleanly restarts the app's main process so a new data-directory suffix
 * (set in ClaudeApp.onCreate) takes effect. PhoenixActivity runs in the
 * :phoenix process, so it survives the death of the main process.
 */
object Phoenix {
    fun restart(context: Context) {
        val intent = Intent(context, PhoenixActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra(PhoenixActivity.EXTRA_MAIN_PID, android.os.Process.myPid())
        }
        context.startActivity(intent)
    }
}
