package com.claudecontainers.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ContainerStoreTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test fun loadOnEmptyDirReturnsEmptyList() {
        val store = ContainerStore(tmp.root)
        assertTrue(store.load().isEmpty())
    }

    @Test fun saveThenLoadRoundTrips() {
        val store = ContainerStore(tmp.root)
        val items = listOf(
            Container("a", "Work", "#D97757"),
            Container("b", "Personal", "#6B8E7B")
        )
        store.save(items)
        val loaded = store.load()
        assertEquals(items, loaded)
    }

    @Test fun addAppendsAndPersists() {
        val store = ContainerStore(tmp.root)
        val c = store.add("Work", "#D97757")
        assertEquals("Work", c.name)
        val loaded = store.load()
        assertEquals(1, loaded.size)
        assertEquals(c, loaded[0])
    }

    @Test fun renameUpdatesNameOnly() {
        val store = ContainerStore(tmp.root)
        val c = store.add("Work", "#D97757")
        store.rename(c.id, "Job")
        val loaded = store.load()
        assertEquals("Job", loaded[0].name)
        assertEquals(c.color, loaded[0].color)
    }

    @Test fun removeDeletesById() {
        val store = ContainerStore(tmp.root)
        val a = store.add("Work", "#D97757")
        store.add("Personal", "#6B8E7B")
        store.remove(a.id)
        val loaded = store.load()
        assertEquals(1, loaded.size)
        assertEquals("Personal", loaded[0].name)
    }

    @Test fun loadOnCorruptFileReturnsEmptyList() {
        tmp.root.resolve("containers.json").writeText("{ not valid json")
        val store = ContainerStore(tmp.root)
        assertTrue(store.load().isEmpty())
    }
}
