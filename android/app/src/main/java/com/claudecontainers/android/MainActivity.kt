package com.claudecontainers.android

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
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
        setContentView(R.layout.activity_main)

        containerStore = ContainerStore(filesDir)
        settingsStore = SettingsStore(filesDir)

        webView = findViewById(R.id.web_view)
        configureWebView(webView)

        val drawer = findViewById<DrawerLayout>(R.id.drawer_layout)
        val rail = findViewById<RailView>(R.id.rail)
        findViewById<ImageButton>(R.id.menu_button).setOnClickListener {
            drawer.openDrawer(rail)
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
                if (drawer.isDrawerOpen(rail)) drawer.closeDrawers()
                else if (webView.canGoBack()) webView.goBack()
                else finish()
            }
        })

        renderRail()
        loadActiveContainer()
    }

    private fun renderRail() {
        val rail = findViewById<RailView>(R.id.rail)
        rail.render(containerStore.load(), settingsStore.load().activeId)
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
            containerStore.remove(c.id)
            // Best-effort wipe of this container's isolated storage.
            deleteContainerStorage(c.id)
            val remaining = containerStore.load()
            if (settingsStore.load().activeId == c.id) {
                settingsStore.setActiveId(remaining.firstOrNull()?.id)
                Phoenix.restart(this)
            } else {
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

    private fun deleteContainerStorage(id: String) {
        try {
            val base = filesDir.parentFile ?: return
            val dir = java.io.File(base, "app_webview_container_$id")
            if (dir.exists()) dir.deleteRecursively()
        } catch (e: Exception) { /* best effort */ }
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
