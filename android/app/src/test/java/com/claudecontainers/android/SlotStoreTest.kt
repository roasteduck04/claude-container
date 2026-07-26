package com.claudecontainers.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SlotStoreTest {

    @get:Rule val tmp = TemporaryFolder()

    private fun store() = SlotStore(tmp.root)

    @Test fun emptyPoolStartsWithAllSlotsUnbound() {
        val slots = store().load()
        assertEquals(SlotStore.MAX_SLOTS, slots.size)
        assertTrue(slots.all { it.containerId == null })
    }

    @Test fun firstBindTakesSlotZeroAndNeedsARestart() {
        // A "free" slot still needs a fresh process: nothing has pinned the
        // storage suffix yet, and a previously-used process cannot be repinned.
        val b = store().bind("a", capacity = 3, protectSlot = null, now = 100)
        assertEquals(0, b.slot)
        assertTrue(b.needsRestart)
        assertEquals("a", store().containerForSlot(0))
    }

    @Test fun rebindingTheSameContainerReusesItsWarmProcess() {
        val s = store()
        s.bind("a", capacity = 3, protectSlot = null, now = 100)
        val again = s.bind("a", capacity = 3, protectSlot = null, now = 200)
        assertEquals(0, again.slot)
        assertFalse(again.needsRestart)
    }

    @Test fun distinctContainersFillDistinctSlots() {
        val s = store()
        assertEquals(0, s.bind("a", 3, null, 100).slot)
        assertEquals(1, s.bind("b", 3, null, 200).slot)
        assertEquals(2, s.bind("c", 3, null, 300).slot)
        assertEquals(setOf("a", "b", "c"), s.boundContainerIds())
    }

    @Test fun aFullPoolEvictsTheLeastRecentlyUsedSlot() {
        val s = store()
        s.bind("a", 2, null, 100)
        s.bind("b", 2, null, 200)
        // "a" is older, so it loses its slot.
        val b = s.bind("c", 2, protectSlot = null, now = 300)
        assertEquals(0, b.slot)
        assertTrue(b.needsRestart)
        assertEquals(setOf("b", "c"), s.boundContainerIds())
    }

    @Test fun touchProtectsASlotFromBeingTheNextVictim() {
        val s = store()
        s.bind("a", 2, null, 100)
        s.bind("b", 2, null, 200)
        s.touch(0, 500) // "a" is now the most recent
        assertEquals(1, s.bind("c", 2, protectSlot = null, now = 600).slot)
    }

    @Test fun theCallersOwnSlotIsNeverEvicted() {
        val s = store()
        s.bind("a", 2, null, 100) // slot 0, and the oldest
        s.bind("b", 2, null, 200) // slot 1
        // Slot 0 would normally be the victim, but it is the caller's own
        // process — which cannot kill itself to make room.
        val b = s.bind("c", 2, protectSlot = 0, now = 300)
        assertEquals(1, b.slot)
    }

    @Test fun capacityBoundsWhichSlotsAreUsable() {
        val s = store()
        assertEquals(0, s.bind("a", capacity = 1, protectSlot = null, now = 100).slot)
        // Capacity 1 means every new container recycles slot 0.
        assertEquals(0, s.bind("b", capacity = 1, protectSlot = null, now = 200).slot)
        assertEquals(setOf("b"), s.boundContainerIds())
    }

    @Test fun shrinkingCapacityReleasesNowUnreachableSlots() {
        val s = store()
        s.bind("a", 4, null, 100)
        s.bind("b", 4, null, 200)
        s.bind("c", 4, null, 300)
        // Dropping to 2 warm slots must not strand "c" on process :c2.
        s.bind("a", capacity = 2, protectSlot = null, now = 400)
        assertNull(s.containerForSlot(2))
        assertNull(s.slotFor("c"))
    }

    @Test fun unbindFreesTheSlotAndReportsIt() {
        val s = store()
        s.bind("a", 3, null, 100)
        assertEquals(0, s.unbind("a"))
        assertNull(s.containerForSlot(0))
        assertNull(s.unbind("a"))
    }

    @Test fun bindingsSurviveAcrossStoreInstances() {
        store().bind("a", 3, null, 100)
        assertEquals(0, SlotStore(tmp.root).slotFor("a"))
    }

    @Test fun aCorruptSlotFileFallsBackToAnEmptyPool() {
        java.io.File(tmp.root, "slots.json").writeText("{ not json")
        val slots = store().load()
        assertEquals(SlotStore.MAX_SLOTS, slots.size)
        assertTrue(slots.all { it.containerId == null })
    }

    // --- process-name gating: the guard that decides whether a process pins
    // WebView storage at all. Wrong answers here silently break isolation.

    @Test fun slotIsParsedFromAHostProcessName() {
        assertEquals(0, SlotStore.slotFromProcessName("com.pkg:c0", "com.pkg"))
        assertEquals(3, SlotStore.slotFromProcessName("com.pkg:c3", "com.pkg"))
    }

    @Test fun nonHostProcessesResolveToNoSlot() {
        assertNull(SlotStore.slotFromProcessName("com.pkg", "com.pkg"))
        assertNull(SlotStore.slotFromProcessName("com.pkg:phoenix", "com.pkg"))
        assertNull(SlotStore.slotFromProcessName(null, "com.pkg"))
        assertNull(SlotStore.slotFromProcessName("com.other:c0", "com.pkg"))
    }

    @Test fun outOfRangeSlotSuffixesAreRejected() {
        assertNull(SlotStore.slotFromProcessName("com.pkg:c9", "com.pkg"))
        assertNull(SlotStore.slotFromProcessName("com.pkg:cx", "com.pkg"))
        assertNull(SlotStore.slotFromProcessName("com.pkg:c", "com.pkg"))
    }
}
