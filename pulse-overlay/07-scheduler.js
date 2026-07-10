(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	const STORAGE_KEY     = 'cc_scheduled_prompts';
	const PENDING_KEY     = 'cc_pending_fire';
	const SEND_DELAY_MS   = 60 * 1000;  // mirrors background.js constant (for countdown display only)
	const BETWEEN_DELAY_MS = 15 * 1000; // 15s gap between queued prompts

	// ── Storage ──────────────────────────────────────────────────────────────

	async function loadQueue() {
		try {
			const result = await chrome.storage.local.get(STORAGE_KEY);
			return JSON.parse(result[STORAGE_KEY] || '[]');
		} catch {
			try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
		}
	}

	async function saveQueue(queue) {
		try {
			await chrome.storage.local.set({ [STORAGE_KEY]: JSON.stringify(queue) });
		} catch {
			try { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue)); } catch {}
		}
	}

	// ── DOM helpers ──────────────────────────────────────────────────────────

	function getTextarea() {
		return (
			document.querySelector('[data-testid="chat-input"]') ||
			document.querySelector('div[contenteditable="true"][data-placeholder]') ||
			document.querySelector('textarea[placeholder]') ||
			null
		);
	}

	function getSendButton() {
		return (
			document.querySelector('button[aria-label="Send message"]') ||
			document.querySelector('button[data-testid="send-button"]') ||
			null
		);
	}

	async function sendPrompt(text) {
		const el = getTextarea();
		if (!el) throw new Error('Chat input not found');
		el.focus();
		if (el.isContentEditable) {
			document.execCommand('selectAll', false, null);
			document.execCommand('insertText', false, text);
		} else {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
			setter ? setter.call(el, text) : (el.value = text);
			el.dispatchEvent(new Event('input', { bubbles: true }));
		}
		await new Promise(r => setTimeout(r, 150));
		const btn = getSendButton();
		if (!btn) throw new Error('Send button not found');
		if (btn.disabled) throw new Error('Send button is disabled');
		btn.click();
	}

	// ── Scheduler ────────────────────────────────────────────────────────────

	class PromptScheduler {
		constructor() {
			this._onChangeCallbacks = new Set();
			this._nextResetMs       = null;
			this._scheduledForResetMs = null;
			this._firing            = false;
		}

		onChange(fn) { this._onChangeCallbacks.add(fn); return () => this._onChangeCallbacks.delete(fn); }
		_notify() { for (const fn of this._onChangeCallbacks) fn(); }

		async getQueue() { return loadQueue(); }

		getCountdown() {
			if (!this._nextResetMs) return null;
			const ms = (this._nextResetMs + SEND_DELAY_MS) - Date.now();
			return ms > 0 ? Math.ceil(ms / 1000) : 0;
		}

		getNextResetMs() { return this._nextResetMs; }

		async add(prompt) {
			const queue = await loadQueue();
			const entry = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, prompt: prompt.trim(), addedAt: Date.now() };
			queue.push(entry);
			await saveQueue(queue);
			this._notify();
			return entry;
		}

		async remove(id) {
			const queue = (await loadQueue()).filter(e => e.id !== id);
			await saveQueue(queue);
			this._notify();
		}

		updateUsage(usage) {
			let earliest = null;
			for (const win of ['five_hour', 'seven_day']) {
				const t = usage?.[win]?.resets_at ? Date.parse(usage[win].resets_at) : null;
				if (t && (!earliest || t < earliest)) earliest = t;
			}
			if (!earliest || earliest === this._nextResetMs) return;
			this._nextResetMs = earliest;
			if (this._scheduledForResetMs === earliest) return;
			this._scheduledForResetMs = earliest;

			// Hand off to the background service worker via chrome.alarms —
			// this survives tab sleep, system sleep, and browser restarts.
			chrome.runtime.sendMessage({ type: 'CC_SCHEDULE_RESET', resetMs: earliest })
				.catch(() => {}); // silently ignore if background isn't ready yet
		}

		async _sendWithRetry(entry) {
			const RETRY_DELAYS = [30_000, 60_000, 120_000]; // 30s → 1min → 2min
			for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
				try {
					await sendPrompt(entry.prompt);
					return true; // success
				} catch (err) {
					if (attempt < RETRY_DELAYS.length) {
						const wait = RETRY_DELAYS[attempt];
						console.log(
							`[Claude Pulse] Send failed (attempt ${attempt + 1}/${RETRY_DELAYS.length + 1}), ` +
							`retrying in ${wait / 1000}s — ${err.message}`
						);
						await new Promise(r => setTimeout(r, wait));
					} else {
						console.warn(`[Claude Pulse] All retries exhausted — leaving prompt in queue: "${entry.prompt.slice(0, 60)}"`);
						return false;
					}
				}
			}
			return false;
		}

		async _fireAll() {
			if (this._firing) return;
			this._firing = true;
			try {
				let queue = await loadQueue();
				while (queue.length > 0) {
					const entry = queue[0];
					console.log(`[Claude Pulse] Sending queued prompt: "${entry.prompt.slice(0, 60)}"`);
					const sent = await this._sendWithRetry(entry);
					if (!sent) break; // retries exhausted, leave remaining in queue
					await saveQueue(queue.slice(1));
					this._notify();
					queue = await loadQueue();
					if (queue.length > 0) {
						await new Promise(r => setTimeout(r, BETWEEN_DELAY_MS));
					}
				}
			} finally {
				this._firing = false;
			}
		}

		async testSend(text) {
			try {
				await sendPrompt(text);
				return 'sent';
			} catch (err) {
				return 'error: ' + err.message;
			}
		}

		tick() {}
	}

	CC.scheduler = new PromptScheduler();

	// ── Pending fire check ───────────────────────────────────────────────────
	// Background sets cc_pending_fire when the alarm fires but no tab was open.
	// Background inject script sets globalThis.__ccPendingFire when the tab
	// existed but the content script wasn't initialised yet.

	async function checkPendingFire() {
		try {
			const result = await chrome.storage.local.get(PENDING_KEY);
			if (result[PENDING_KEY]) {
				await chrome.storage.local.remove(PENDING_KEY);
				console.log('[Claude Pulse] Pending fire detected — firing queued prompts');
				CC.scheduler._fireAll();
				return;
			}
		} catch {}
		if (globalThis.__ccPendingFire) {
			delete globalThis.__ccPendingFire;
			console.log('[Claude Pulse] In-page pending fire detected — firing queued prompts');
			CC.scheduler._fireAll();
		}
	}

	checkPendingFire();
	loadQueue().then(q => {
		if (q.length) console.log(`[Claude Pulse] ${q.length} prompt(s) queued`);
	});
})();
