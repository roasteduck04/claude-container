package com.claudecontainers.android

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Write-temp-then-rename, so a crash or a kill mid-write can never leave a
 * half-written config file behind. Every store in this app persists through
 * here.
 *
 * If the atomic rename fails (disk full, or a filesystem that rejects
 * ATOMIC_MOVE), fall back to writing the destination directly: a torn file is
 * still better than losing the write, and both stores already treat an
 * unparseable file as "defaults". A total failure returns false rather than
 * throwing — these writes sit on the container-switch path, which relaunches
 * the process, and an exception there would surface as a crash on tap.
 */
object AtomicWrite {

    fun write(dir: File, name: String, text: String): Boolean {
        try {
            if (!dir.exists()) dir.mkdirs()
            val tmp = File(dir, "$name.tmp")
            tmp.writeText(text)
            Files.move(
                tmp.toPath(), File(dir, name).toPath(),
                StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE,
            )
            return true
        } catch (e: IOException) {
            return fallback(dir, name, text)
        } catch (e: UnsupportedOperationException) {
            return fallback(dir, name, text)
        }
    }

    private fun fallback(dir: File, name: String, text: String): Boolean = try {
        File(dir, name).writeText(text)
        true
    } catch (e: IOException) {
        false
    }
}
