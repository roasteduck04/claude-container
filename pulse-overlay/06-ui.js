(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	// ── Formatting helpers ──

	function formatSeconds(totalSeconds) {
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${String(seconds).padStart(2, '0')}`;
	}

	function formatResetCountdown(timestampMs) {
		const diffMs = timestampMs - Date.now();
		if (diffMs <= 0) return '0s';

		const totalSeconds = Math.floor(diffMs / 1000);
		if (totalSeconds < 60) return `${totalSeconds}s`;

		const totalMinutes = Math.round(totalSeconds / 60);
		if (totalMinutes < 60) return `${totalMinutes}m`;

		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		if (hours < 24) return `${hours}h ${minutes}m`;

		const days = Math.floor(hours / 24);
		const remHours = hours % 24;
		return `${days}d ${remHours}h`;
	}

	function formatTokens(count) {
		if (count >= 1000) {
			const k = count / 1000;
			const formatted = k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '');
			return `~${formatted}k`;
		}
		return `~${count}`;
	}

	const LENGTH_TOOLTIP_DEFAULT = 'Estimated tokens (~)';

	function formatUsageStripText(rawPct, resetMs) {
		const used = Math.round(rawPct * 10) / 10;
		const parts = [`${used}% used`];
		if (resetMs != null && Number.isFinite(resetMs)) {
			parts.push(`resets in ${formatResetCountdown(resetMs)}`);
		}
		return parts.join(' · ');
	}

	// ── Tooltip system ──

	function setupTooltip(element, tooltip, { topOffset = 10 } = {}) {
		if (!element || !tooltip) return;
		if (element.hasAttribute('data-tooltip-setup')) return;
		element.setAttribute('data-tooltip-setup', 'true');
		element.classList.add('cc-tooltipTrigger');

		let pressTimer;
		let hideTimer;

		const show = () => {
			const rect = element.getBoundingClientRect();
			tooltip.classList.add('cc-tooltip--visible');
			// Force reflow so we can measure
			tooltip.style.opacity = '1';
			const tipRect = tooltip.getBoundingClientRect();

			let left = rect.left + rect.width / 2;
			if (left + tipRect.width / 2 > window.innerWidth) left = window.innerWidth - tipRect.width / 2 - 10;
			if (left - tipRect.width / 2 < 0) left = tipRect.width / 2 + 10;

			let top = rect.top - tipRect.height - topOffset;
			if (top < 10) top = rect.bottom + 10;

			tooltip.style.left = `${left}px`;
			tooltip.style.top = `${top}px`;
			tooltip.style.transform = 'translateX(-50%)';
		};

		const hide = () => {
			tooltip.classList.remove('cc-tooltip--visible');
			tooltip.style.opacity = '0';
			tooltip.style.transform = 'translateX(-50%) translateY(4px)';
			clearTimeout(hideTimer);
		};

		element.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'touch' || e.pointerType === 'pen') {
				pressTimer = setTimeout(() => {
					show();
					hideTimer = setTimeout(hide, 3000);
				}, 500);
			}
		});

		element.addEventListener('pointerup', () => clearTimeout(pressTimer));
		element.addEventListener('pointercancel', () => {
			clearTimeout(pressTimer);
			hide();
		});

		element.addEventListener('pointerenter', (e) => {
			if (e.pointerType === 'mouse') show();
		});

		element.addEventListener('pointerleave', (e) => {
			if (e.pointerType === 'mouse') hide();
		});
	}

	function makeTooltip(text) {
		const tip = document.createElement('div');
		tip.className = 'cc-tooltip';
		tip.textContent = text;
		document.body.appendChild(tip);
		return tip;
	}

	// ── Main UI class ──

	class CounterUI {
		constructor({ onUsageRefresh, onCopyChat } = {}) {
			this.onUsageRefresh = onUsageRefresh || null;
			this.onCopyChat = onCopyChat || null;

			this.headerContainer = null;
			this.headerDisplay = null;
			this.lengthGroup = null;
			this.lengthDisplay = null;
			this.cachedDisplay = null;
			this.lengthBar = null;
			this.lengthTooltip = null;
			this.lastCachedUntilMs = null;
			this.pendingCache = false;

			this.usageLine = null;
			this.sessionTitleSpan = null;
			this.sessionInlineSpan = null;
			this.weeklyTitleSpan = null;
			this.weeklyInlineSpan = null;
			this._sessionUtilPct = null;
			this._weeklyUtilPct = null;
			this.sessionBar = null;
			this.sessionBarFill = null;
			this.weeklyBar = null;
			this.weeklyBarFill = null;
			this.sessionResetMs = null;
			this.weeklyResetMs = null;
			this.refreshingUsage = false;

			this.usageMetaGroup = null;
			this.usageRefreshBtn = null;

			this._burnHistory = []; // { t: timestamp, util: pct } samples for burn rate
			this.domObserver = null;
		}

		_isDark() {
			const root = document.documentElement;
			return root.dataset?.mode === 'dark';
		}

		getProgressChrome() {
			const isDark = this._isDark();

			return {
				strokeColor: isDark ? CC.COLORS.PROGRESS_OUTLINE_DARK : CC.COLORS.PROGRESS_OUTLINE_LIGHT,
				trackColor: isDark ? CC.COLORS.PROGRESS_TRACK_DARK : CC.COLORS.PROGRESS_TRACK_LIGHT,
				fillColor: isDark ? CC.COLORS.PROGRESS_FILL_DARK : CC.COLORS.PROGRESS_FILL_LIGHT,
				markerColor: isDark ? CC.COLORS.PROGRESS_MARKER_DARK : CC.COLORS.PROGRESS_MARKER_LIGHT,
				boldColor: isDark ? CC.COLORS.BOLD_DARK : CC.COLORS.BOLD_LIGHT,
				cacheColor: isDark ? CC.COLORS.CACHE_ACTIVE_DARK : CC.COLORS.CACHE_ACTIVE_LIGHT
			};
		}

		refreshProgressChrome() {
			const { strokeColor, trackColor, fillColor, markerColor } = this.getProgressChrome();

			const applyBarChrome = (bar, { fillWarn, fillCritical } = {}) => {
				if (!bar) return;
				bar.style.setProperty('--cc-stroke', strokeColor);
				bar.style.setProperty('--cc-track', trackColor);
				bar.style.setProperty('--cc-fill', fillColor);
				bar.style.setProperty('--cc-fill-warn', fillWarn ?? fillColor);
				bar.style.setProperty('--cc-fill-critical', fillCritical ?? fillWarn ?? fillColor);
				bar.style.setProperty('--cc-marker', markerColor);
			};

			applyBarChrome(this.lengthBar, { fillWarn: fillColor });
			applyBarChrome(this.sessionBar, { fillWarn: CC.COLORS.AMBER_WARNING, fillCritical: CC.COLORS.CRITICAL_WARNING });
			applyBarChrome(this.weeklyBar, { fillWarn: CC.COLORS.AMBER_WARNING, fillCritical: CC.COLORS.CRITICAL_WARNING });
		}

		initialize() {
			this.headerContainer = document.createElement('div');
			this.headerContainer.className = 'text-text-500 text-xs !px-1 cc-header';

			this.headerDisplay = document.createElement('span');
			this.headerDisplay.className = 'cc-headerItem';

			this.logoContainer = document.createElement('span');
			this.logoContainer.className = 'cc-logo';
			this.logoContainer.innerHTML = `
				<svg width="13" height="13" viewBox="0 0 300 300" fill="none" xmlns="http://www.w3.org/2000/svg">
					<rect x="40" y="38" width="210" height="210" rx="48" fill="currentColor" fill-opacity="0.1"/>
					<path d="M64 143 L112 143 L132 88 L152 198 L167 143 L226 143" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
				</svg>
			`;

			this.lengthGroup = document.createElement('span');
			this.lengthGroup.className = 'cc-tooltipTrigger';
			this.lengthDisplay = document.createElement('span');
			this.cachedDisplay = document.createElement('span');
			this.cacheTimeSpan = null;

			this.lengthGroup.appendChild(this.lengthDisplay);
			this.headerDisplay.appendChild(this.lengthGroup);

			this._initCopyButton();
			this._initUsageLine();
			this._setupTooltips();
			this._observeDom();
			this._observeTheme();
		}

		_observeTheme() {
			const observer = new MutationObserver(() => this.refreshProgressChrome());
			observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
		}

		_observeDom() {
			let usageReattachPending = false;
			let headerReattachPending = false;

			this.domObserver = new MutationObserver(() => {
				const usageMissing = this.usageLine && !document.contains(this.usageLine);
				const headerMissing = !document.contains(this.headerContainer);

				if (usageMissing && !usageReattachPending) {
					usageReattachPending = true;
					CC.waitForElement(CC.DOM.MODEL_SELECTOR_DROPDOWN, 60000).then((el) => {
						usageReattachPending = false;
						if (el) this.attachUsageLine();
					});
				}

				if (headerMissing && !headerReattachPending) {
					headerReattachPending = true;
					CC.waitForElement(CC.DOM.CHAT_MENU_TRIGGER, 60000).then((el) => {
						headerReattachPending = false;
						if (el) this.attachHeader();
					});
				}
			});
			this.domObserver.observe(document.body, { childList: true, subtree: true });
		}

		_initUsageLine() {
			this.usageLine = document.createElement('div');
			this.usageLine.className =
				'text-text-400 text-[14px] cc-usageRow cc-hidden flex flex-row flex-nowrap items-center gap-3 w-full';

			this.sessionGroup = document.createElement('div');
			this.sessionGroup.className = 'cc-usageGroup cc-usageStrip';

			this.sessionTitleSpan = document.createElement('span');
			this.sessionTitleSpan.className = 'cc-usageStrip__label';
			this.sessionTitleSpan.textContent = '5h';

			this.sessionBar = document.createElement('div');
			this.sessionBar.className = 'cc-bar cc-bar--mini cc-usageStrip__bar';
			this.sessionBarFill = document.createElement('div');
			this.sessionBarFill.className = 'cc-bar__fill';
			this.sessionBar.appendChild(this.sessionBarFill);

			this.sessionInlineSpan = document.createElement('span');
			this.sessionInlineSpan.className = 'cc-usageStrip__meta';

			this.sessionGroup.appendChild(this.sessionTitleSpan);
			this.sessionGroup.appendChild(this.sessionBar);
			this.sessionGroup.appendChild(this.sessionInlineSpan);

			this.weeklyGroup = document.createElement('div');
			this.weeklyGroup.className = 'cc-usageGroup cc-usageStrip cc-usageStrip--end';

			this.weeklyTitleSpan = document.createElement('span');
			this.weeklyTitleSpan.className = 'cc-usageStrip__label';
			this.weeklyTitleSpan.textContent = '7d';

			this.weeklyBar = document.createElement('div');
			this.weeklyBar.className = 'cc-bar cc-bar--mini cc-usageStrip__bar';
			this.weeklyBarFill = document.createElement('div');
			this.weeklyBarFill.className = 'cc-bar__fill';
			this.weeklyBar.appendChild(this.weeklyBarFill);

			this.weeklyInlineSpan = document.createElement('span');
			this.weeklyInlineSpan.className = 'cc-usageStrip__meta';

			this.weeklyGroup.appendChild(this.weeklyTitleSpan);
			this.weeklyGroup.appendChild(this.weeklyBar);
			this.weeklyGroup.appendChild(this.weeklyInlineSpan);

			this.usageLine.appendChild(this.sessionGroup);
			this.usageLine.appendChild(this.weeklyGroup);

			this.usageMetaGroup = document.createElement('div');
			this.usageMetaGroup.className = 'cc-usageMeta';

			this.usageRefreshBtn = document.createElement('button');
			this.usageRefreshBtn.type = 'button';
			this.usageRefreshBtn.className = 'cc-usageRefresh cc-tooltipTrigger';
			this.usageRefreshBtn.setAttribute('aria-label', 'Refresh usage');
			this.usageRefreshBtn.innerHTML = `
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M23 4v6h-6"></path>
					<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
				</svg>
			`;
			this.usageRefreshBtn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this._refreshUsage();
			});

			this.usageMetaGroup.appendChild(this.usageRefreshBtn);
			this.usageLine.appendChild(this.usageMetaGroup);

			this.refreshProgressChrome();
		}

		async _refreshUsage() {
			if (!this.onUsageRefresh || this.refreshingUsage) return;
			this.refreshingUsage = true;
			this.usageRefreshBtn.disabled = true;
			this.usageRefreshBtn.classList.add('cc-usageRefresh--busy');
			this.usageMetaGroup?.classList.add('cc-usageMeta--busy');
			try {
				await this.onUsageRefresh();
			} finally {
				this.usageRefreshBtn.disabled = false;
				this.usageRefreshBtn.classList.remove('cc-usageRefresh--busy');
				this.usageMetaGroup?.classList.remove('cc-usageMeta--busy');
				this.refreshingUsage = false;
			}
		}

		_setupTooltips() {
			this.lengthTooltip = makeTooltip(LENGTH_TOOLTIP_DEFAULT);
			setupTooltip(this.lengthGroup, this.lengthTooltip, { topOffset: 8 });

			setupTooltip(this.cachedDisplay, makeTooltip('Prompt cache'), { topOffset: 8 });

			this._copyTooltip = makeTooltip('Copy chat');
			setupTooltip(this.copyButton, this._copyTooltip, { topOffset: 8 });

			this._sessionTooltip = makeTooltip('5-hour session limit');
			setupTooltip(this.sessionGroup, this._sessionTooltip, { topOffset: 8 });

			this._weeklyTooltip = makeTooltip('7-day limit');
			setupTooltip(this.weeklyGroup, this._weeklyTooltip, { topOffset: 8 });

			this._usageRefreshTooltip = makeTooltip('Refresh usage');
			setupTooltip(this.usageRefreshBtn, this._usageRefreshTooltip, { topOffset: 8 });
		}

		attach() {
			this.attachHeader();
			this.attachUsageLine();
			this.refreshProgressChrome();
		}

		attachHeader() {
			const chatMenu = document.querySelector(CC.DOM.CHAT_MENU_TRIGGER);
			if (!chatMenu) return;
			const anchor = chatMenu.closest(CC.DOM.CHAT_PROJECT_WRAPPER) || chatMenu.parentElement;
			if (!anchor) return;
			if (anchor.nextElementSibling !== this.headerContainer) {
				anchor.after(this.headerContainer);
			}
			this._renderHeader();
			this.refreshProgressChrome();
		}

		attachUsageLine() {
			if (!this.usageLine) return;
			const modelSelector = document.querySelector(CC.DOM.MODEL_SELECTOR_DROPDOWN);
			if (!modelSelector) return;

			const gridContainer = modelSelector.closest('[data-testid="chat-input-grid-container"]');
			const gridArea = modelSelector.closest('[data-testid="chat-input-grid-area"]');

			const findToolbarRow = (el, stopAt) => {
				let cur = el;
				while (cur && cur !== document.body) {
					if (stopAt && cur === stopAt) break;
					if (cur !== el && cur.nodeType === 1) {
						const style = window.getComputedStyle(cur);
						if (style.display === 'flex' && style.flexDirection === 'row') {
							const buttons = cur.querySelectorAll('button').length;
							if (buttons > 1) return cur;
						}
					}
					cur = cur.parentElement;
				}
				return null;
			};

			const toolbarRow =
				(gridContainer ? findToolbarRow(modelSelector, gridArea || gridContainer) : null) ||
				findToolbarRow(modelSelector) ||
				modelSelector.parentElement?.parentElement?.parentElement;
			if (!toolbarRow) return;

			if (toolbarRow.nextElementSibling !== this.usageLine) {
				toolbarRow.after(this.usageLine);
			}
			this.refreshProgressChrome();
		}

		setPendingCache(pending) {
			this.pendingCache = pending;
			if (this.cacheTimeSpan) {
				if (pending) {
					this.cacheTimeSpan.style.color = '';
				} else {
					const { cacheColor } = this.getProgressChrome();
					this.cacheTimeSpan.style.color = cacheColor;
				}
			}
		}

		setConversationMetrics({ totalTokens, cachedUntil } = {}) {
			this.pendingCache = false;

			if (typeof totalTokens !== 'number') {
				this.lengthDisplay.textContent = '';
				this.cachedDisplay.textContent = '';
				this.lastCachedUntilMs = null;
				this._renderHeader();
				return;
			}

			const pct = Math.max(0, Math.min(100, (totalTokens / CC.CONST.CONTEXT_LIMIT_TOKENS) * 100));
			this.lengthDisplay.textContent = `${formatTokens(totalTokens)} tokens`;

			const isFull = pct >= 99.5;
			if (isFull) {
				this.lengthDisplay.style.opacity = '0.5';
				this.lengthBar = null;
				this.lengthGroup.replaceChildren(this.lengthDisplay);
				if (this.lengthTooltip) {
					this.lengthTooltip.textContent = 'Unavailable after compaction';
				}
			} else {
				this.lengthDisplay.style.opacity = '';
				if (this.lengthTooltip) this.lengthTooltip.textContent = LENGTH_TOOLTIP_DEFAULT;
				const bar = document.createElement('div');
				bar.className = 'cc-bar cc-bar--mini';
				this.lengthBar = bar;
				const fill = document.createElement('div');
				fill.className = 'cc-bar__fill';
				fill.style.width = `${pct}%`;
				bar.appendChild(fill);
				this.refreshProgressChrome();

				const barContainer = document.createElement('span');
				barContainer.className = 'inline-flex items-center';
				barContainer.appendChild(bar);

				this.lengthGroup.replaceChildren(
					this.lengthDisplay,
					document.createTextNode('  '),
					barContainer
				);
			}

			const now = Date.now();
			if (typeof cachedUntil === 'number' && cachedUntil > now) {
				this.lastCachedUntilMs = cachedUntil;
				const secondsLeft = Math.max(0, Math.ceil((cachedUntil - now) / 1000));
				const { cacheColor } = this.getProgressChrome();
				this.cacheTimeSpan = Object.assign(document.createElement('span'), {
					className: 'cc-cacheTime',
					textContent: formatSeconds(secondsLeft)
				});
				this.cacheTimeSpan.style.color = cacheColor;

				const cacheWrapper = document.createElement('span');
				cacheWrapper.className = 'cc-cacheActive';
				cacheWrapper.appendChild(document.createTextNode('cached '));
				cacheWrapper.appendChild(this.cacheTimeSpan);
				this.cachedDisplay.replaceChildren(cacheWrapper);
			} else {
				this.lastCachedUntilMs = null;
				this.cacheTimeSpan = null;
				this.cachedDisplay.textContent = '';
			}

			this._renderHeader();
		}

		_renderHeader() {
			this.headerContainer.replaceChildren();

			const hasTokens = !!this.lengthDisplay.textContent;
			const hasCache = !!this.cachedDisplay.textContent;

			if (!hasTokens) return;

			const items = [this.logoContainer, this.lengthGroup];
			if (hasCache) {
				const sep = document.createElement('span');
				sep.className = 'cc-sep';
				sep.textContent = '·';
				items.push(sep, this.cachedDisplay);
			}

			this.headerDisplay.replaceChildren(...items);
			this.headerContainer.appendChild(this.headerDisplay);
		}

		setUsage(usage) {
			this.refreshProgressChrome();
			const session = usage?.five_hour || null;
			const weekly = usage?.seven_day || null;
			const hasAnyUsage =
				!!(session && typeof session.utilization === 'number') ||
				!!(weekly && typeof weekly.utilization === 'number');
			this.usageLine?.classList.toggle('cc-hidden', !hasAnyUsage);

			if (session && typeof session.utilization === 'number') {
				const rawPct = session.utilization;
				this._sessionUtilPct = rawPct;
				this.sessionResetMs = session.resets_at ? Date.parse(session.resets_at) : null;
				// Record sample for burn rate calculation
				this._burnHistory.push({ t: Date.now(), util: rawPct });

				const width = Math.max(0, Math.min(100, rawPct));
				this.sessionBarFill.style.width = `${width}%`;
				this.sessionBarFill.classList.toggle('cc-warn', width >= 80 && width < 95);
				this.sessionBarFill.classList.toggle('cc-critical', width >= 95);
				this.sessionBarFill.classList.remove('cc-full');
				if (width >= 99.5) this.sessionBarFill.classList.add('cc-full');
			} else {
				this._sessionUtilPct = null;
				if (this.sessionInlineSpan) this.sessionInlineSpan.textContent = '';
				this.sessionBarFill.style.width = '0%';
				this.sessionBarFill.classList.remove('cc-warn', 'cc-critical', 'cc-full');
				this.sessionResetMs = null;
			}

			const hasWeekly = weekly && typeof weekly.utilization === 'number';
			this.weeklyGroup?.classList.toggle('cc-hidden', !hasWeekly);
			this.sessionGroup?.classList.toggle('cc-usageGroup--single', !hasWeekly);

			if (hasWeekly) {
				const rawPct = weekly.utilization;
				this._weeklyUtilPct = rawPct;
				this.weeklyResetMs = weekly.resets_at ? Date.parse(weekly.resets_at) : null;

				const width = Math.max(0, Math.min(100, rawPct));
				this.weeklyBarFill.style.width = `${width}%`;
				this.weeklyBarFill.classList.toggle('cc-warn', width >= 80 && width < 95);
				this.weeklyBarFill.classList.toggle('cc-critical', width >= 95);
				this.weeklyBarFill.classList.remove('cc-full');
				if (width >= 99.5) this.weeklyBarFill.classList.add('cc-full');
			} else {
				this._weeklyUtilPct = null;
				if (this.weeklyInlineSpan) this.weeklyInlineSpan.textContent = '';
				this.weeklyResetMs = null;
				this.weeklyBarFill.style.width = '0%';
				this.weeklyBarFill.classList.remove('cc-warn', 'cc-critical', 'cc-full');
			}

			this._renderUsageStripText();
		}

		_computeBurnRate() {
			const now = Date.now();
			const WINDOW_MS  = 30 * 60 * 1000; // use last 30 min of samples
			const MIN_GAP_MS =  2 * 60 * 1000; // need at least 2 min spread to be meaningful

			// Trim stale samples in-place
			this._burnHistory = this._burnHistory.filter(s => now - s.t <= WINDOW_MS);

			if (this._burnHistory.length < 2) return null;
			const oldest = this._burnHistory[0];
			const newest = this._burnHistory[this._burnHistory.length - 1];
			const gapMs = newest.t - oldest.t;
			if (gapMs < MIN_GAP_MS) return null;

			const deltaUtil = newest.util - oldest.util;
			if (deltaUtil <= 0) return null; // recovering or flat — no ETA needed

			return deltaUtil / (gapMs / 60_000); // % per minute
		}

		_renderUsageStripText() {
			if (this.sessionInlineSpan) {
				if (typeof this._sessionUtilPct === 'number') {
					let text = formatUsageStripText(this._sessionUtilPct, this.sessionResetMs);
					// Append burn-rate ETA when we have enough data
					const ratePerMin = this._computeBurnRate();
					if (ratePerMin) {
						const remaining = 100 - this._sessionUtilPct;
						const etaMin = Math.round(remaining / ratePerMin);
						if (etaMin > 0 && etaMin < 300) {
							text += ` · ~${etaMin}m to limit`;
						}
					}
					this.sessionInlineSpan.textContent = text;
				} else {
					this.sessionInlineSpan.textContent = '';
				}
			}
			if (this.weeklyInlineSpan) {
				if (typeof this._weeklyUtilPct === 'number') {
					this.weeklyInlineSpan.textContent = formatUsageStripText(
						this._weeklyUtilPct,
						this.weeklyResetMs
					);
				} else {
					this.weeklyInlineSpan.textContent = '';
				}
			}
		}

		tick() {
			const now = Date.now();

			if (this.lastCachedUntilMs && this.lastCachedUntilMs > now) {
				const secondsLeft = Math.max(0, Math.ceil((this.lastCachedUntilMs - now) / 1000));
				if (this.cacheTimeSpan) {
					this.cacheTimeSpan.textContent = formatSeconds(secondsLeft);
				}
			} else if (this.lastCachedUntilMs && this.lastCachedUntilMs <= now) {
				this.lastCachedUntilMs = null;
				this.cacheTimeSpan = null;
				this.pendingCache = false;
				this.cachedDisplay.textContent = '';
				this._renderHeader();
			}

			this._renderUsageStripText();
		}

		// ── Copy button + dropdown ──

		_initCopyButton() {
			this.copyButton = document.createElement('span');
			this.copyButton.className = 'cc-copyBtn cc-tooltipTrigger';
			this.copyButton.innerHTML = `
				<svg class="cc-copyBtn__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
					<polyline points="16 6 12 2 8 6"></polyline>
					<line x1="12" y1="2" x2="12" y2="15"></line>
				</svg>
				<svg class="cc-copyBtn__check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="20 6 9 17 4 12"></polyline>
				</svg>
			`;

			// Dropdown
			this.copyDropdown = document.createElement('div');
			this.copyDropdown.className = 'cc-copyDropdown';

			const makeOption = (label, format) => {
				const btn = document.createElement('button');
				btn.className = 'cc-copyDropdown__item';
				btn.textContent = label;
				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					this._doCopy(format);
				});
				return btn;
			};

			this.copyDropdown.appendChild(makeOption('Copy as Text', 'text'));
			this.copyDropdown.appendChild(makeOption('Copy as Markdown', 'markdown'));
			document.body.appendChild(this.copyDropdown);

			// Toggle dropdown on button click
			this.copyButton.addEventListener('click', async (e) => {
				e.stopPropagation();
				await this._doCopy('markdown');
			});


		}

		_toggleCopyDropdown() {
			const isOpen = this.copyDropdown.classList.contains('cc-copyDropdown--open');
			if (isOpen) {
				this._closeCopyDropdown();
				return;
			}

			const rect = this.copyButton.getBoundingClientRect();
			this.copyDropdown.style.top = `${rect.bottom + 6}px`;
			this.copyDropdown.style.left = `${rect.left}px`;
			this.copyDropdown.classList.add('cc-copyDropdown--open');
		}

		_closeCopyDropdown() {
			this.copyDropdown.classList.remove('cc-copyDropdown--open');
		}

		async _doCopy(format) {
			this._closeCopyDropdown();
			if (!this.onCopyChat) return;

			try {
				const text = await this.onCopyChat(format);
				if (!text) return;
				await navigator.clipboard.writeText(text);
				this._showCopySuccess();
			} catch (err) {
				console.warn('[Claude Pulse] Copy failed:', err);
			}
		}

		_showCopySuccess() {
			this.copyButton.classList.add('cc-copyBtn--done');
			setTimeout(() => {
				this.copyButton.classList.remove('cc-copyBtn--done');
			}, 1500);
		}
	}

	CC.ui = { CounterUI };
})();


// ── Scheduler Panel ──

;(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	class SchedulerPanel {
		constructor() {
			this._panel = null;
			this._isOpen = false;
			this._unsubscribe = null;
			this._countdownInterval = null;
		}

		initialize() {
			this._buildTriggerButton();
			this._buildPanel();

			if (CC.scheduler) {
				this._unsubscribe = CC.scheduler.onChange(() => this._renderQueue());
			}
		}

		_buildTriggerButton() {
			this.triggerBtn = document.createElement('button');
			this.triggerBtn.type = 'button';
			this.triggerBtn.className = 'cc-schedBtn cc-tooltipTrigger';
			this.triggerBtn.setAttribute('aria-label', 'Schedule prompt on reset');
			this.triggerBtn.innerHTML = `
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="10"></circle>
					<polyline points="12 6 12 12 16 14"></polyline>
				</svg>
			`;
			this.triggerBtn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this._toggle();
			});

			// Simple tooltip
			const tip = document.createElement('div');
			tip.className = 'cc-tooltip';
			tip.textContent = 'Schedule prompt on reset';
			document.body.appendChild(tip);
			this.triggerBtn.addEventListener('pointerenter', (ev) => {
				if (ev.pointerType !== 'mouse') return;
				const r = this.triggerBtn.getBoundingClientRect();
				tip.classList.add('cc-tooltip--visible');
				tip.style.left = `${r.left + r.width / 2}px`;
				tip.style.top = `${r.top - 30}px`;
				tip.style.transform = 'translateX(-50%)';
			});
			this.triggerBtn.addEventListener('pointerleave', () => {
				tip.classList.remove('cc-tooltip--visible');
			});
		}

		_buildPanel() {
			this._panel = document.createElement('div');
			this._panel.className = 'cc-schedPanel cc-hidden';

			// Header
			const header = document.createElement('div');
			header.className = 'cc-schedPanel__header';

			const title = document.createElement('span');
			title.className = 'cc-schedPanel__title';
			title.innerHTML = `
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="10"></circle>
					<polyline points="12 6 12 12 16 14"></polyline>
				</svg>
				Send on Reset
			`;

			const closeBtn = document.createElement('button');
			closeBtn.type = 'button';
			closeBtn.className = 'cc-schedPanel__close';
			closeBtn.setAttribute('aria-label', 'Close');
			closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
			closeBtn.addEventListener('click', () => this.close());

			header.appendChild(title);
			header.appendChild(closeBtn);

			// Status bar — shows countdown when armed
			this._statusBar = document.createElement('div');
			this._statusBar.className = 'cc-schedPanel__status cc-hidden';

			// Textarea
			const textareaWrapper = document.createElement('div');
			textareaWrapper.className = 'cc-schedPanel__textWrap';

			this._textarea = document.createElement('textarea');
			this._textarea.className = 'cc-schedPanel__textarea';
			this._textarea.placeholder = 'Type the prompt to send when the limit resets…';
			this._textarea.rows = 4;

			// Send on Enter (Shift+Enter for newline)
			this._textarea.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					this._addPrompt();
				}
			});

			textareaWrapper.appendChild(this._textarea);

			// Add button
			const addBtn = document.createElement('button');
			addBtn.type = 'button';
			addBtn.className = 'cc-schedPanel__addBtn';
			addBtn.textContent = 'Queue for reset';
			addBtn.addEventListener('click', () => this._addPrompt());

			// Test send button
			const testBtn = document.createElement('button');
			testBtn.type = 'button';
			testBtn.className = 'cc-schedPanel__testBtn';
			testBtn.textContent = 'Send now (test)';
			testBtn.addEventListener('click', () => this._testSend(testBtn));

			const btnRow = document.createElement('div');
			btnRow.className = 'cc-schedPanel__btnRow';
			btnRow.appendChild(addBtn);
			btnRow.appendChild(testBtn);

			this._feedback = document.createElement('div');
			this._feedback.className = 'cc-schedPanel__feedback cc-hidden';

			// Queue list
			const queueSection = document.createElement('div');
			queueSection.className = 'cc-schedPanel__queueSection';

			this._queueTitle = document.createElement('div');
			this._queueTitle.className = 'cc-schedPanel__queueTitle cc-hidden';
			this._queueTitle.textContent = 'Queued';

			this._queueList = document.createElement('div');
			this._queueList.className = 'cc-schedPanel__queueList';

			this._emptyState = document.createElement('div');
			this._emptyState.className = 'cc-schedPanel__empty';
			this._emptyState.textContent = "No prompts queued. Add one above and it\u2019ll send 1 minute after your limit resets.";

			queueSection.appendChild(this._queueTitle);
			queueSection.appendChild(this._queueList);

			this._panel.appendChild(header);
			this._panel.appendChild(this._statusBar);
			this._panel.appendChild(textareaWrapper);
			this._panel.appendChild(btnRow);
			this._panel.appendChild(this._feedback);
			this._panel.appendChild(queueSection);

			document.body.appendChild(this._panel);

			document.addEventListener('click', (e) => {
				if (this._isOpen && !this._panel.contains(e.target) && e.target !== this.triggerBtn && !this.triggerBtn.contains(e.target)) {
					this.close();
				}
			});

			// Tick the countdown display every second
			this._countdownInterval = setInterval(() => this._updateStatus(), 1000);
		}

		_formatCountdown(seconds) {
			if (seconds <= 0) return 'Sending…';
			if (seconds < 60) return `${seconds}s`;
			const m = Math.floor(seconds / 60);
			const s = seconds % 60;
			return `${m}m ${String(s).padStart(2, '0')}s`;
		}

		_updateStatus() {
			if (!CC.scheduler || !this._statusBar) return;
			const queue = CC.scheduler.getQueue();
			const countdown = CC.scheduler.getCountdown();
			const resetMs = CC.scheduler.getNextResetMs();

			if (!queue.length || countdown === null) {
				this._statusBar.classList.add('cc-hidden');
				return;
			}

			this._statusBar.classList.remove('cc-hidden');

			if (countdown <= 0) {
				this._statusBar.textContent = '⚡ Sending now…';
				this._statusBar.className = 'cc-schedPanel__status cc-schedPanel__status--sending';
			} else {
				const resetLabel = resetMs ? new Date(resetMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
				this._statusBar.innerHTML = `⏳ Sending in <strong>${this._formatCountdown(countdown)}</strong>${resetLabel ? ` · resets at ${resetLabel}` : ''}`;
				this._statusBar.className = 'cc-schedPanel__status cc-schedPanel__status--armed';
			}
		}

		async _addPrompt() {
			const text = this._textarea.value.trim();
			if (!text || !CC.scheduler) { this._textarea.focus(); return; }
			await CC.scheduler.add(text);
			this._textarea.value = '';
			await this._renderQueue();
			this._updateStatus();
		}

		async _testSend(btn) {
			const text = this._textarea.value.trim();
			if (!text) { this._textarea.focus(); return; }

			btn.disabled = true;
			btn.textContent = 'Sending…';
			this._showFeedback('', '');

			const result = await CC.scheduler.testSend(text);

			if (result === 'sent') {
				btn.textContent = 'Sent!';
				this._showFeedback('✓ Sent successfully — sending works!', 'success');
				this._textarea.value = '';
				setTimeout(() => { btn.textContent = 'Send now (test)'; btn.disabled = false; }, 2000);
			} else {
				btn.textContent = 'Send now (test)';
				btn.disabled = false;
				this._showFeedback('✗ ' + result, 'error');
			}
		}

		_showFeedback(msg, type) {
			if (!this._feedback) return;
			if (!msg) { this._feedback.classList.add('cc-hidden'); return; }
			this._feedback.textContent = msg;
			this._feedback.className = 'cc-schedPanel__feedback cc-schedPanel__feedback--' + type;
		}

		async _renderQueue() {
			if (!this._queueList || !CC.scheduler) return;
			const queue = await CC.scheduler.getQueue();
			this._queueList.replaceChildren();

			const hasItems = queue.length > 0;
			this._queueTitle.classList.toggle('cc-hidden', !hasItems);

			if (!hasItems) {
				this._queueList.appendChild(this._emptyState);
				return;
			}

			queue.forEach((entry, i) => {
				const item = document.createElement('div');
				item.className = 'cc-schedPanel__queueItem';

				const order = document.createElement('span');
				order.className = 'cc-schedPanel__order';
				order.textContent = i + 1;

				const text = document.createElement('span');
				text.className = 'cc-schedPanel__queueText';
				text.textContent = entry.prompt.length > 80 ? entry.prompt.slice(0, 80) + '…' : entry.prompt;
				text.title = entry.prompt;

				const delBtn = document.createElement('button');
				delBtn.type = 'button';
				delBtn.className = 'cc-schedPanel__delBtn';
				delBtn.setAttribute('aria-label', 'Remove');
				delBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
				delBtn.addEventListener('click', async (e) => {
					e.stopPropagation();
					await CC.scheduler.remove(entry.id);
					await this._renderQueue();
				});

				item.appendChild(order);
				item.appendChild(text);
				item.appendChild(delBtn);
				this._queueList.appendChild(item);
			});
		}

		_toggle() {
			if (this._isOpen) this.close(); else this.open();
		}

		open() {
			if (this._isOpen) return;
			this._isOpen = true;
			this._renderQueue(); // async, fine to fire-and-forget
			this._updateStatus();
			this._panel.classList.remove('cc-hidden');
			this._panel.classList.add('cc-schedPanel--open');
			this._positionPanel();
			this.triggerBtn.classList.add('cc-schedBtn--active');
			setTimeout(() => this._textarea?.focus(), 60);
		}

		close() {
			if (!this._isOpen) return;
			this._isOpen = false;
			this._panel.classList.remove('cc-schedPanel--open');
			this._panel.classList.add('cc-hidden');
			this.triggerBtn.classList.remove('cc-schedBtn--active');
		}

		_positionPanel() {
			if (!this.triggerBtn || !this._panel) return;
			const r = this.triggerBtn.getBoundingClientRect();
			const panelW = 300;
			const panelH = 380;
			let left = r.right - panelW;
			let top = r.bottom + 8;
			if (left < 8) left = 8;
			if (top + panelH > window.innerHeight - 8) top = r.top - panelH - 8;
			this._panel.style.left = `${left}px`;
			this._panel.style.top = `${top}px`;
		}

		attachToUsageMeta(metaGroup) {
			if (!metaGroup || !this.triggerBtn) return;
			metaGroup.insertBefore(this.triggerBtn, metaGroup.firstChild);
		}
	}

	CC.ui = CC.ui || {};
	CC.ui.SchedulerPanel = SchedulerPanel;
})();
