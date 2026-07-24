package com.claudecontainers.android

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var containerStore: ContainerStore
    private lateinit var settingsStore: SettingsStore

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        containerStore = ContainerStore(filesDir)
        settingsStore = SettingsStore(filesDir)

        webView = findViewById(R.id.web_view)
        configureWebView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        loadActiveContainer()
    }

    private fun loadActiveContainer() {
        val active = settingsStore.load().activeId
        val containers = containerStore.load()
        // If no active container yet, bootstrap one so first launch shows Claude.
        if (active == null || containers.none { it.id == active }) {
            if (containers.isEmpty()) {
                val c = containerStore.add("Claude", "#D97757")
                settingsStore.setActiveId(c.id)
                Phoenix.restart(this)
                return
            }
            settingsStore.setActiveId(containers.first().id)
            Phoenix.restart(this)
            return
        }
        webView.loadUrl("https://claude.ai/")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(wv: WebView) {
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            javaScriptCanOpenWindowsAutomatically = true
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(wv, true)
        }
        wv.webViewClient = object : ContainerWebViewClient(this) {
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // Reload the container rather than letting the app crash.
                view.loadUrl("https://claude.ai/")
                return true
            }
        }
        wv.setDownloadListener { url, _, _, mimeType, _ ->
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mimeType)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            }
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
        }
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }
}
