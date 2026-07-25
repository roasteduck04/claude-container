package com.claudecontainers.android

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

/**
 * Classifies a host as "load in-app" (internal) vs "hand to the system
 * browser" (external). Internal covers Claude/Anthropic plus the identity
 * providers used for sign-in — those are different hosts than claude.ai but
 * must render in-app so an OAuth redirect/popup can complete and return.
 */
object ExternalLink {
    private val internalSuffixes = listOf(
        ".claude.ai", ".anthropic.com",
        // Identity providers (sign-in must complete in-app):
        ".google.com", ".googleusercontent.com", ".gstatic.com",
        ".apple.com", ".microsoftonline.com", ".live.com",
    )
    private val internalExact = listOf(
        "claude.ai", "anthropic.com",
        "accounts.google.com", "appleid.apple.com",
        "login.microsoftonline.com", "login.live.com",
    )

    fun isInternal(host: String?): Boolean {
        if (host == null) return false
        val h = host.lowercase()
        if (internalExact.contains(h)) return true
        return internalSuffixes.any { h.endsWith(it) }
    }
}

open class ContainerWebViewClient(private val context: Context) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        // Never hijack sub-frame/iframe loads (payment, CAPTCHA, embedded auth);
        // only main-frame navigations are candidates for the external handoff.
        if (!request.isForMainFrame) return false

        val uri = request.url
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") {
            // mailto:, intent:, tel: etc. — hand to the system.
            openExternally(uri)
            return true
        }
        if (ExternalLink.isInternal(uri.host)) {
            return false // load in-app
        }
        openExternally(uri)
        return true
    }

    private fun openExternally(uri: Uri) {
        try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(context, "No app to open link", Toast.LENGTH_SHORT).show()
        }
    }
}
