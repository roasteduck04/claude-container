package com.claudecontainers.android

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
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

/**
 * Hosts one container's claude.ai session in a WebView, plus the switcher rail.
 *
 * There is one concrete subclass per pool slot, each pinned to its own process
 * in the manifest ([ContainerActivity0]…[ContainerActivity3]). The process this
 * runs in was already pinned to this slot's container storage by
 * [ClaudeApp.onCreate] — which is why this class must never be reached in a
 * process whose slot binding doesn't match, and bails to [MainActivity] if so.
 *
 * Switching to another *warm* container is just an Activity reorder: this
 * instance keeps its live WebView in the background, so switching back is
 * instant and no page reloads.
 */
abstract class ContainerActivity : AppCompatActivity() {

    /** Which pool slot (and therefore which process) this subclass runs in. */
    abstract val slotIndex: Int

    private lateinit var webView: WebView
    private lateinit var containerStore: ContainerStore
    private lateinit var settingsStore: SettingsStore
    private lateinit var slotStore: SlotStore

    /** The container this process's WebView storage is pinned to. */
    private var containerId: String? = null

    /** Set once the user actually touches the page, so keyboard suppression
     *  never fights a deliberate tap on the composer. */
    private var userTouchedPage = false

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        containerStore = ContainerStore(filesDir)
        settingsStore = SettingsStore(filesDir)
        slotStore = SlotStore(filesDir)

        // Resolve this slot's container BEFORE inflating any WebView, and refuse
        // to show it unless this process is actually pinned to that container's
        // storage.
        //
        // The two can disagree: a switch rebinds the slot on disk and then kills
        // the host process so it respawns against the new storage, and the
        // Activity start can still land in the old, not-yet-dead process. Showing
        // the page anyway would render one account's UI against another's
        // cookies. Instead, force this process to die and come back correctly
        // pinned — Phoenix, not startActivity, because only a separate process
        // can reliably outlive this one.
        val id = slotStore.containerForSlot(slotIndex)
        val pinned = ClaudeApp.pinnedContainerId
        if (pinned == null) {
            // This process never pinned any storage, so a WebView here would
            // fall back to the app's *shared* storage — no isolation at all.
            // Restarting cannot fix that, so fail loudly instead of looping.
            AlertDialog.Builder(this)
                .setTitle("Could not open container")
                .setMessage(
                    "This container's private storage could not be prepared, so " +
                        "it was not opened. Reopening the app usually clears this."
                )
                .setCancelable(false)
                .setPositiveButton("Close") { _, _ -> finishAffinity() }
                .show()
            return
        }
        if (id == null || pinned != id || containerStore.load().none { it.id == id }) {
            // Stale process: the slot was rebound to another container after this
            // process pinned its storage. Die and come back correctly pinned.
            Phoenix.restart(this)
            return
        }
        containerId = id

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
            try { drawer.closeDrawers() } catch (e: Exception) { /* docked tablet */ }
            switchTo(c)
        }
        rail.onAdd = { showAddDialog() }
        rail.onLongPress = { c -> showContextDialog(c) }
        rail.onSettings = {
            try { drawer.closeDrawers() } catch (e: Exception) { /* docked tablet */ }
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // isDrawerOpen throws if the rail is docked (tablet) rather than a drawer.
                val drawerOpen = try { drawer.isDrawerOpen(rail) } catch (e: Exception) { false }
                when {
                    drawerOpen -> drawer.closeDrawers()
                    webView.canGoBack() -> webView.goBack()
                    // Don't finish(): keeping this activity alive is what keeps the
                    // container warm for the next launch.
                    else -> moveTaskToBack(true)
                }
            }
        })

        renderRail()
        webView.loadUrl("https://claude.ai/")
    }

    override fun onResume() {
        super.onResume()
        val id = containerId ?: return
        // Fronting this activity is what makes its container "active" — record it
        // so a cold start resumes here, and mark the slot most-recently-used so
        // eviction picks the genuinely stale one.
        settingsStore.setActiveId(id)
        slotStore.touch(slotIndex, System.currentTimeMillis())
        renderRail()
        applySettings()

        // Wipe storage for containers removed while their host process was alive.
        // Off the UI thread: a large WebView cache can take seconds to delete.
        Thread {
            StorageCleaner.processPending(filesDir, slotStore.boundContainerIds())
        }.start()
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    // ---- switching ---------------------------------------------------------

    private fun switchTo(target: Container) {
        if (target.id == containerId) return

        settingsStore.setActiveId(target.id)
        val capacity = settingsStore.load().warmSlots
        val binding = slotStore.bind(
            containerId = target.id,
            capacity = capacity,
            // Never evict ourselves: we cannot kill our own process and then
            // display the activity that lives in it.
            protectSlot = slotIndex,
            now = System.currentTimeMillis(),
        )

        // A slot whose binding changed must have its process killed first — the
        // WebView storage suffix is pinned for the life of a process, so the
        // container can only take effect in a freshly spawned one.
        if (binding.needsRestart) ProcessPool.killSlot(this, binding.slot)

        startActivity(
            Intent(this, ProcessPool.activityForSlot(binding.slot))
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        )
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
    }

    /** Full teardown + relaunch through the router. Only for the rare cases where
     *  *this* process's pinned container is going away. */
    private fun rebootThroughRouter() {
        Phoenix.restart(this)
    }

    // ---- rail actions ------------------------------------------------------

    private fun renderRail() {
        findViewById<RailView>(R.id.rail)
            ?.render(containerStore.load(), containerId)
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
                renderRail()
                switchTo(c)
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
            val wasOurs = c.id == containerId
            containerStore.remove(c.id)
            val freedSlot = slotStore.unbind(c.id)
            // Queue the storage wipe; it runs once no process holds the directory.
            StorageCleaner.enqueue(filesDir, c.id)

            if (wasOurs) {
                // Our own process is pinned to the storage being deleted, so it has
                // to go. Reboot through the router, which picks the next container.
                val remaining = containerStore.load()
                val next = remaining.firstOrNull() ?: containerStore.add("Claude", "#D97757")
                settingsStore.setActiveId(next.id)
                rebootThroughRouter()
            } else {
                // Kill the (possibly live) host process so it releases the directory,
                // then let the queued wipe run on the next resume.
                if (freedSlot != null) ProcessPool.killSlot(this, freedSlot)
                Thread {
                    StorageCleaner.processPending(filesDir, slotStore.boundContainerIds())
                }.start()
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

    // ---- WebView -----------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
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

        // Any real touch on the page counts as intent to interact — from then on
        // the keyboard is the page's business, not ours.
        wv.setOnTouchListener { _, event ->
            if (event.actionMasked == MotionEvent.ACTION_DOWN) userTouchedPage = true
            false
        }

        wv.webViewClient = object : ContainerWebViewClient(this) {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                suppressAutoKeyboard(view)
                // claude.ai focuses its composer asynchronously after hydration,
                // so one pass at onPageFinished isn't enough.
                view.postDelayed({ suppressAutoKeyboard(view) }, 400)
                view.postDelayed({ suppressAutoKeyboard(view) }, 1200)
            }

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
                val popup = WebView(this@ContainerActivity)
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

        applySettings()
    }

    private fun applySettings() {
        if (!::webView.isInitialized) return
        webView.settings.textZoom = settingsStore.load().textZoom
    }

    /**
     * claude.ai auto-focuses its message composer on load, which makes Android
     * raise the soft keyboard every single time the app opens or switches
     * containers. Blur the focused element (the manifest's `stateAlwaysHidden`
     * alone can't stop a focus request the page makes after the window is up).
     */
    private fun suppressAutoKeyboard(view: WebView) {
        if (userTouchedPage) return
        if (settingsStore.load().focusComposerOnOpen) return
        view.evaluateJavascript(
            "(function(){var e=document.activeElement;" +
                "if(e&&e!==document.body&&typeof e.blur==='function'){e.blur();}})();",
            null,
        )
        view.clearFocus()
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(view.windowToken, 0)
    }
}

class ContainerActivity0 : ContainerActivity() { override val slotIndex = 0 }
class ContainerActivity1 : ContainerActivity() { override val slotIndex = 1 }
class ContainerActivity2 : ContainerActivity() { override val slotIndex = 2 }
class ContainerActivity3 : ContainerActivity() { override val slotIndex = 3 }
