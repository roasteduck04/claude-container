(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});
	if (CC.__started) return;
	CC.__started = true;

	// ── Auto-continue ─────────────────────────────────────────────────────────
	// Watches for Claude's "Continue generating" button (shown when the output
	// limit is hit mid-response) and clicks it automatically.

	let _autoContinuePending = false;
	let _autoContinueDebounce = null;

	function findContinueBtn() {
		const byLabel = document.querySelector(CC.DOM.CONTINUE_BTN);
		if (byLabel && !byLabel.disabled) return byLabel;
		// Text-content fallback for selector drift
		for (const b of document.querySelectorAll('button')) {
			if (!b.disabled && b.textContent.trim().toLowerCase() === 'continue generating') return b;
		}
		return null;
	}

	function checkAndContinue() {
		if (_autoContinuePending) return;
		const btn = findContinueBtn();
		if (!btn) return;
		_autoContinuePending = true;
		// Short delay: confirm the button is still there after DOM settles
		setTimeout(() => {
			_autoContinuePending = false;
			const still = findContinueBtn();
			if (!still) return;
			still.click();
			console.log('[Claude Pulse] Auto-continued generation');
		}, 1200);
	}

	const _autoContinueObserver = new MutationObserver(() => {
		if (_autoContinueDebounce) return;
		_autoContinueDebounce = setTimeout(() => {
			_autoContinueDebounce = null;
			checkAndContinue();
		}, 400);
	});
	_autoContinueObserver.observe(document.body, { childList: true, subtree: true });

	// ── End auto-continue ──────────────────────────────────────────────────────

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function getOrgIdFromCookie() {
		try {
			return (
				document.cookie
					.split('; ')
					.find((row) => row.startsWith('lastActiveOrg='))
					?.split('=')[1] || null
			);
		} catch {
			return null;
		}
	}

	function waitForElement(selector, timeoutMs) {
		return new Promise((resolve) => {
			const existing = document.querySelector(selector);
			if (existing) {
				resolve(existing);
				return;
			}

			let timeoutId;
			const observer = new MutationObserver(() => {
				const el = document.querySelector(selector);
				if (el) {
					if (timeoutId) clearTimeout(timeoutId);
					observer.disconnect();
					resolve(el);
				}
			});

			observer.observe(document.body, { childList: true, subtree: true });

			if (timeoutMs) {
				timeoutId = setTimeout(() => {
					observer.disconnect();
					resolve(null);
				}, timeoutMs);
			}
		});
	}

	CC.waitForElement = waitForElement;

	function observeUrlChanges(callback) {
		let lastPath = window.location.pathname;

		const fireIfChanged = () => {
			const current = window.location.pathname;
			if (current !== lastPath) {
				lastPath = current;
				callback();
			}
		};

		window.addEventListener('cc:urlchange', fireIfChanged);
		window.addEventListener('popstate', fireIfChanged);

		return () => {
			window.removeEventListener('cc:urlchange', fireIfChanged);
			window.removeEventListener('popstate', fireIfChanged);
		};
	}

	function parseUsageFromUsageEndpoint(raw) {
		if (!raw || typeof raw !== 'object') return null;

		const normalizeWindow = (w) => {
			if (!w || typeof w !== 'object') return null;
			if (typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
			const utilization = Math.max(0, Math.min(100, w.utilization));
			const resets_at = typeof w.resets_at === 'string' ? w.resets_at : null;
			return { utilization, resets_at };
		};

		const fiveHour = normalizeWindow(raw.five_hour);
		const sevenDay = normalizeWindow(raw.seven_day);

		if (!fiveHour && !sevenDay) return null;
		return { five_hour: fiveHour, seven_day: sevenDay };
	}

	function parseUsageFromMessageLimit(raw) {
		if (!raw?.windows || typeof raw.windows !== 'object') return null;

		const normalizeWindow = (w) => {
			if (!w || typeof w !== 'object') return null;
			if (typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
			const utilization = Math.max(0, Math.min(100, w.utilization * 100));
			const resets_at =
				typeof w.resets_at === 'number' && Number.isFinite(w.resets_at)
					? new Date(w.resets_at * 1000).toISOString()
					: null;
			return { utilization, resets_at };
		};

		const fiveHour = normalizeWindow(raw.windows['5h']);
		const sevenDay = normalizeWindow(raw.windows['7d']);

		if (!fiveHour && !sevenDay) return null;
		return { five_hour: fiveHour, seven_day: sevenDay };
	}

	let currentConversationId = null;
	let currentOrgId = null;
	let latestConversationData = null;

	let usageState = null;
	let usageResetMs = { five_hour: null, seven_day: null };
	let lastUsageSseMs = 0;
	let usageFetchInFlight = false;
	let lastUsageUpdateMs = 0;
	const rolloverHandledForResetMs = { five_hour: null, seven_day: null };
	let lastPeriodicUsageRefreshMs = Date.now();

	const ui = new CC.ui.CounterUI({
		onUsageRefresh: async () => {
			await refreshUsage();
		},
		onCopyChat: (format) => {
			if (!latestConversationData) return null;
			const trunk = CC.tokens.buildTrunk(latestConversationData);
			if (!trunk.length) return null;
			if (format === 'markdown') return CC.tokens.formatTrunkAsMarkdown(trunk);
			return CC.tokens.formatTrunkAsText(trunk);
		}
	});
	ui.initialize();

	// Scheduler panel
	const schedulerPanel = CC.ui.SchedulerPanel ? new CC.ui.SchedulerPanel() : null;
	if (schedulerPanel) {
		schedulerPanel.initialize();
		// Patch attachUsageLine to also attach the schedule button
		const origAttachUsageLine = ui.attachUsageLine.bind(ui);
		ui.attachUsageLine = function () {
			origAttachUsageLine();
			if (ui.usageMetaGroup) {
				// scheduler clock button (inserts at front)
				if (schedulerPanel.triggerBtn && !ui.usageMetaGroup.contains(schedulerPanel.triggerBtn)) {
					schedulerPanel.attachToUsageMeta(ui.usageMetaGroup);
				}
				// copy button — append after scheduler button
				if (ui.copyButton && !ui.usageMetaGroup.contains(ui.copyButton)) {
					const sep = document.createElement('span');
					sep.className = 'cc-sep';
					sep.textContent = '·';
					ui.usageMetaGroup.appendChild(sep);
					ui.usageMetaGroup.appendChild(ui.copyButton);
				}
			}
		};
		// Attach once immediately after initialize in case attachUsageLine already ran
		if (ui.usageMetaGroup) {
			if (schedulerPanel.triggerBtn && !ui.usageMetaGroup.contains(schedulerPanel.triggerBtn)) {
				schedulerPanel.attachToUsageMeta(ui.usageMetaGroup);
			}
			if (ui.copyButton && !ui.usageMetaGroup.contains(ui.copyButton)) {
				const sep = document.createElement('span');
				sep.className = 'cc-sep';
				sep.textContent = '·';
				ui.usageMetaGroup.appendChild(sep);
				ui.usageMetaGroup.appendChild(ui.copyButton);
			}
		}
	}

	const bridgeReady = CC.injectBridgeOnce();

	function applyUsageUpdate(normalized, source) {
		if (!normalized) return;
		const now = Date.now();
		usageState = normalized;
		lastUsageUpdateMs = now;
		if (source === 'sse') lastUsageSseMs = now;
		usageResetMs.five_hour = normalized.five_hour?.resets_at ? Date.parse(normalized.five_hour.resets_at) : null;
		usageResetMs.seven_day = normalized.seven_day?.resets_at ? Date.parse(normalized.seven_day.resets_at) : null;
		ui.setUsage(normalized);
		if (CC.scheduler) CC.scheduler.updateUsage(normalized);
	}

	function updateOrgIdIfNeeded(newOrgId) {
		if (newOrgId && typeof newOrgId === 'string' && newOrgId !== currentOrgId) {
			currentOrgId = newOrgId;
		}
	}

	async function refreshUsage() {
		await bridgeReady;
		const orgId = currentOrgId || getOrgIdFromCookie();
		if (!orgId) return;
		updateOrgIdIfNeeded(orgId);

		if (usageFetchInFlight) return;
		usageFetchInFlight = true;
		let raw;
		try {
			raw = await CC.bridge.requestUsage(orgId);
		} catch {
			return;
		} finally {
			usageFetchInFlight = false;
		}

		const parsed = parseUsageFromUsageEndpoint(raw);
		applyUsageUpdate(parsed, 'usage');
		lastPeriodicUsageRefreshMs = Date.now();
	}

	async function refreshConversation() {
		await bridgeReady;
		if (!currentConversationId) {
			ui.setConversationMetrics();
			return;
		}

		const orgId = currentOrgId || getOrgIdFromCookie();
		if (!orgId) return;
		updateOrgIdIfNeeded(orgId);

		try {
			await CC.bridge.requestConversation(orgId, currentConversationId);
		} catch {
			// ignore
		}
	}

	function handleGenerationStart() {
		if (!currentConversationId) return;
		ui.setPendingCache(true);
	}

	async function handleConversationPayload({ orgId, conversationId, data }) {
		if (!conversationId || conversationId !== currentConversationId) return;
		updateOrgIdIfNeeded(orgId);
		if (!data) return;

		latestConversationData = data;
		const metrics = await CC.tokens.computeConversationMetrics(data);
		ui.setConversationMetrics({ totalTokens: metrics.totalTokens, cachedUntil: metrics.cachedUntil });
	}

	function handleMessageLimit(messageLimit) {
		const parsed = parseUsageFromMessageLimit(messageLimit);
		applyUsageUpdate(parsed, 'sse');
	}

	CC.bridge.on('cc:generation_start', handleGenerationStart);
	CC.bridge.on('cc:conversation', handleConversationPayload);
	CC.bridge.on('cc:message_limit', handleMessageLimit);

	async function handleUrlChange() {
		currentConversationId = getConversationId();

		waitForElement(CC.DOM.MODEL_SELECTOR_DROPDOWN, 60000).then((el) => {
			if (el) ui.attachUsageLine();
		});
		waitForElement(CC.DOM.CHAT_MENU_TRIGGER, 60000).then((el) => {
			if (el) ui.attachHeader();
		});

		if (!currentConversationId) {
			latestConversationData = null;
			ui.setConversationMetrics();
			return;
		}

		updateOrgIdIfNeeded(getOrgIdFromCookie());

		await refreshConversation();

		if (!usageState) await refreshUsage();
	}

	const unobserveUrl = observeUrlChanges(handleUrlChange);
	window.addEventListener('beforeunload', () => {
		unobserveUrl();
		_autoContinueObserver.disconnect();
	});

	// Branch navigation: watch Previous/Next buttons for branch indicator change
	let branchObserver = null;
	document.addEventListener('click', (e) => {
		if (!currentConversationId) return;
		const btn = e.target.closest('button[aria-label="Previous"], button[aria-label="Next"]');
		if (!btn) return;

		const container = btn.closest('.inline-flex');
		const spans = container?.querySelectorAll('span') || [];
		const indicator = Array.from(spans).find((s) => /^\d+\s*\/\s*\d+$/.test(s.textContent.trim()));
		if (!indicator) return;

		const originalText = indicator.textContent;

		if (branchObserver) branchObserver.disconnect();

		branchObserver = new MutationObserver(() => {
			if (indicator.textContent !== originalText) {
				branchObserver.disconnect();
				branchObserver = null;
				refreshConversation();
			}
		});

		branchObserver.observe(indicator, { childList: true, characterData: true, subtree: true });

		setTimeout(() => {
			if (branchObserver) {
				branchObserver.disconnect();
				branchObserver = null;
			}
		}, 60000);
	});

	handleUrlChange();

	function tick() {
		ui.tick();
		if (CC.scheduler) CC.scheduler.tick();

		const now = Date.now();

		if (
			usageResetMs.five_hour &&
			now >= usageResetMs.five_hour &&
			rolloverHandledForResetMs.five_hour !== usageResetMs.five_hour
		) {
			rolloverHandledForResetMs.five_hour = usageResetMs.five_hour;
			refreshUsage();
		}
		if (
			usageResetMs.seven_day &&
			now >= usageResetMs.seven_day &&
			rolloverHandledForResetMs.seven_day !== usageResetMs.seven_day
		) {
			rolloverHandledForResetMs.seven_day = usageResetMs.seven_day;
			refreshUsage();
		}

		// Hourly safety refresh if SSE has been silent
		const ONE_HOUR_MS = 60 * 60 * 1000;
		if (
			!document.hidden &&
			now - lastUsageSseMs > ONE_HOUR_MS &&
			now - lastUsageUpdateMs > ONE_HOUR_MS
		) {
			refreshUsage();
		}

		// Periodic usage refresh every 2 minutes while tab is visible (no on-screen “last updated” label)
		const TWO_MIN_MS = 2 * 60 * 1000;
		if (!document.hidden && now - lastPeriodicUsageRefreshMs >= TWO_MIN_MS) {
			lastPeriodicUsageRefreshMs = now;
			refreshUsage();
		}
	}

	setInterval(tick, 1000);
})();
