package com.claudecontainers.android

import org.junit.Assert.assertEquals
import org.junit.Test

class ExternalLinkTest {
    @Test fun claudeHostsAreInternal() {
        assertEquals(true, ExternalLink.isInternal("claude.ai"))
        assertEquals(true, ExternalLink.isInternal("www.claude.ai"))
        assertEquals(true, ExternalLink.isInternal("api.claude.ai"))
        assertEquals(true, ExternalLink.isInternal("console.anthropic.com"))
    }

    @Test fun otherHostsAreExternal() {
        assertEquals(false, ExternalLink.isInternal("google.com"))
        assertEquals(false, ExternalLink.isInternal("evil-claude.ai.example.com"))
        assertEquals(false, ExternalLink.isInternal(null))
    }
}
