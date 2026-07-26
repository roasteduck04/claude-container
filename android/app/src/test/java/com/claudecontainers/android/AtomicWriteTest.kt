package com.claudecontainers.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class AtomicWriteTest {

    @get:Rule val tmp = TemporaryFolder()

    @Test fun writesTheFileAndLeavesNoTempBehind() {
        assertTrue(AtomicWrite.write(tmp.root, "x.json", "[1]"))
        assertEquals("[1]", File(tmp.root, "x.json").readText())
        assertFalse(File(tmp.root, "x.json.tmp").exists())
    }

    @Test fun overwritesAnExistingFile() {
        AtomicWrite.write(tmp.root, "x.json", "old")
        AtomicWrite.write(tmp.root, "x.json", "new")
        assertEquals("new", File(tmp.root, "x.json").readText())
    }

    @Test fun createsTheDirectoryIfItIsMissing() {
        val nested = File(tmp.root, "a/b/c")
        assertTrue(AtomicWrite.write(nested, "x.json", "{}"))
        assertEquals("{}", File(nested, "x.json").readText())
    }

    @Test fun reportsFailureRatherThanThrowingWhenTheTargetIsUnwritable() {
        // A directory where the file should be: the write cannot succeed, and
        // the container-switch path must survive that without crashing.
        File(tmp.root, "x.json").mkdirs()
        assertFalse(AtomicWrite.write(tmp.root, "x.json", "data"))
    }
}
