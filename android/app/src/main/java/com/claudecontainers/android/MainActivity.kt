package com.claudecontainers.android

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.ImageButton
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.drawerlayout.widget.DrawerLayout

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var containerStore: ContainerStore
    private lateinit var settingsStore: SettingsStore

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        containerStore = ContainerStore(filesDir)
        settingsStore = SettingsStore(filesDir)

        // Resolve the active container BEFORE inflating any WebView. The WebView
        // storage directory is locked when the WebView is constructed, and
        // ClaudeApp only set a suffix for a valid persisted activeId — so if we
        // need to bootstrap or repair the active id, relaunch first and never
        // construct a WebView in this (wrong-suffix) process.
        val active = settingsStore.load().activeId
        val containers = containerStore.load()
        if (active == null || containers.none { it.id == active }) {
            val next = containers.firstOrNull() ?: containerStore.add("Claude", "#D97757")
            settingsStore.setActiveId(next.id)
            Phoenix.restart(this)
            return
        }

        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.web_view)
        configureWebView(webView)

        val drawer = findViewById<DrawerLayout>(R.id.drawer_layout)
        val rail = findViewById<RailView>(R.id.rail)
        findViewById<ImageButton>(R.id.menu_button).setOnClickListener {
            // On a tablet the rail is docked (not a drawer child), so openDrawer throws.
            try { drawer.openDrawer(rail) } catch (e: Exception) { /* docked tablet */ }
        }

        rail.onSelect = { c ->
            drawer.closeDrawers()
            if (c.id != settingsStore.load().activeId) {
                settingsStore.setActiveId(c.id)
                Phoenix.restart(this)
            }
        }
        rail.onAdd = { showAddDialog() }
        rail.onLongPress = { c -> showContextDialog(c) }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // isDrawerOpen throws if the rail is docked (tablet) rather than a drawer.
                val drawerOpen = try { drawer.isDrawerOpen(rail) } catch (e: Exception) { false }
                if (drawerOpen) drawer.closeDrawers()
                else if (webView.canGoBack()) webView.goBack()
                else finish()
            }
        })

        renderRail()
        webView.loadUrl("https://claude.ai/")
    }

    private fun renderRail() {
        val rail = findViewById<RailView>(R.id.rail)
        rail.render(containerStore.load(), settingsStore.load().activeId)
    }

    private fun showAddDialog() {
        val input = EditText(this).apply { hint = "Name" }
        AlertDialog.Builder(this)
            .setTitle("Add container")
            .setView(input)
            .setPositiveButton("Add") { _, _ ->
                val name = input.text.toString().trim().ifEmpty { "Claude" }
                val colors = listOf("#D97757", "#6B8E7B", "#7B8FA1", "#B07BA1", "#C2A15A")
                val color = colors[containerStore.load().size % colors.size]
                val c = containerStore.add(name, color)
                settingsStore.setActiveId(c.id)
                Phoenix.restart(this)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showContextDialog(c: Container) {
        AlertDialog.Builder(this)
            .setTitle(c.name)
            .setItems(arrayOf("Rename", "Remove")) { _, which ->
                when (which) {
                    0 -> showRenameDialog(c)
                    1 -> confirmRemove(c)
                }
            }
            .show()
    }

    private fun showRenameDialog(c: Container) {
        val input = EditText(this).apply { setText(c.name) }
        AlertDialog.Builder(this)
            .setTitle("Rename")
            .setView(input)
            .setPositiveButton("Save") { _, _ ->
                val name = input.text.toString().trim()
                if (name.isNotEmpty()) {
                    containerStore.rename(c.id, name)
                    renderRail()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun confirmRemove(c: Container) {
        val doRemove = {
            val wasActive = settingsStore.load().activeId == c.id
            containerStore.remove(c.id)
            if (wasActive) {
                // This container's WebView is live in this process; defer the
                // storage wipe to the next cold start (before any WebView exists).
                StorageCleaner.enqueue(filesDir, c.id)
                val remaining = containerStore.load()
                // Recreate a default if that was the last one, so we relaunch once.
                val next = remaining.firstOrNull() ?: containerStore.add("Claude", "#D97757")
                settingsStore.setActiveId(next.id)
                Phoenix.restart(this)
            } else {
                // Not open in any process — safe to wipe off the UI thread now.
                Thread { StorageCleaner.deleteNow(filesDir, c.id) }.start()
                renderRail()
            }
        }
        if (settingsStore.load().confirmBeforeDelete) {
            AlertDialog.Builder(this)
                .setTitle("Remove ${c.name}?")
                .setMessage("This deletes its session and data on this device.")
                .setPositiveButton("Remove") { _, _ -> doRemove() }
                .setNegativeButton("Cancel", null)
                .show()
        } else doRemove()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(wv: WebView) {
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true)
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
        // Handle window.open()/target=_blank (e.g. OAuth sign-in popups): capture
        // the popup's target and route it — in-app for Claude/identity hosts, to
        // the system browser otherwise — so sign-in isn't silently swallowed.
        wv.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(
                view: WebView,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: Message,
            ): Boolean {
                val popup = WebView(this@MainActivity)
                popup.settings.javaScriptEnabled = true
                popup.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, req: WebResourceRequest): Boolean {
                        val url = req.url
                        if (ExternalLink.isInternal(url.host)) {
                            webView.loadUrl(url.toString())
                        } else {
                            try {
                                startActivity(
                                    Intent(Intent.ACTION_VIEW, url)
                                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                )
                            } catch (e: Exception) { /* no handler */ }
                        }
                        v.post { v.destroy() }
                        return true
                    }
                }
                (resultMsg.obj as WebView.WebViewTransport).webView = popup
                resultMsg.sendToTarget()
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
