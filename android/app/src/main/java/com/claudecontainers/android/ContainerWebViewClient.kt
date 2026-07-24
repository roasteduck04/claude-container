package com.claudecontainers.android

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

object ExternalLink {
    private val internalSuffixes = listOf(".claude.ai", ".anthropic.com")
    private val internalExact = listOf("claude.ai", "anthropic.com")

    fun isInternal(host: String?): Boolean {
        if (host == null) return false
        val h = host.lowercase()
        if (internalExact.contains(h)) return true
        return internalSuffixes.any { h.endsWith(it) }
    }
}

open class ContainerWebViewClient(private val context: Context) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
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
