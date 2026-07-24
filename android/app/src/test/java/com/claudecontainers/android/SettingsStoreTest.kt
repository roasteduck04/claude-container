package com.claudecontainers.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SettingsStoreTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test fun loadOnEmptyDirReturnsDefaults() {
        val s = SettingsStore(tmp.root).load()
        assertNull(s.activeId)
        assertTrue(s.confirmBeforeDelete)
        assertTrue(s.resumeLastActive)
    }

    @Test fun saveThenLoadRoundTrips() {
        val store = SettingsStore(tmp.root)
        store.save(Settings(activeId = "abc", confirmBeforeDelete = false, resumeLastActive = false))
        val s = store.load()
        assertEquals("abc", s.activeId)
        assertEquals(false, s.confirmBeforeDelete)
        assertEquals(false, s.resumeLastActive)
    }

    @Test fun setActiveIdUpdatesOnlyActiveId() {
        val store = SettingsStore(tmp.root)
        store.save(Settings(activeId = "a", confirmBeforeDelete = false))
        store.setActiveId("b")
        val s = store.load()
        assertEquals("b", s.activeId)
        assertEquals(false, s.confirmBeforeDelete)
    }

    @Test fun loadOnCorruptFileReturnsDefaults() {
        tmp.root.resolve("settings.json").writeText("nope")
        val s = SettingsStore(tmp.root).load()
        assertNull(s.activeId)
    }
}
