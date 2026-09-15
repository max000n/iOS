// ==UserScript==
// @name         ChatGPT Auto Register (AgentMail + SimpleLogin)
// @namespace    http://tampermonkey.net/
// @version      71.0
// @description  Авторегистрация ChatGPT + стиль ChatGPT + настройки с динамическими блоками
// @author       You
// @match        https://chatgpt.com/*
// @match        https://auth.openai.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_setClipboard
// @connect      api.agentmail.to
// @connect      app.simplelogin.io
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        agentMailApiKey: '',
        agentMailBase: 'https://api.agentmail.to/v0',
        simpleLoginApiKey: '',
        simpleLoginBase: 'https://app.simplelogin.io',
        emailMode: 'agentmail',
        checkInterval: 3000,
        maxAttempts: 120,
        timeToleranceMs: 60000,
        fastMode: true,
        deleteInboxAfterUse: true,
        maxRetries: 3,
    };

    let codeInserted = false, profileFilled = false, registrationComplete = false,
        isRunning = false, loginAttempted = false, verifyCompleted = false,
        passwordFilled = false, initDone = false, currentInbox = null, pollingActive = false;

    let codeRequestedAt = null, usedMessageIds = new Set(), urlWatcher = null;
    let helpModal = null, settingsModal = null, savedContext = null;

    // ============================================
    // CSS: палитра ChatGPT
    // ============================================
    function injectThemeStyles() {
        if (document.getElementById('gpt-auto-theme-styles')) return;
        const s = document.createElement('style');
        s.id = 'gpt-auto-theme-styles';
        s.textContent = `
            :root {
                --gpt-bg: #ffffff;
                --gpt-bg-solid: #ffffff;
                --gpt-bg-elevated: #f4f4f4;
                --gpt-fg: #0d0d0d;
                --gpt-fg-muted: #8e8e8e;
                --gpt-border: rgba(0,0,0,0.10);
                --gpt-hover: #ececec;
                --gpt-shadow: rgba(0,0,0,0.10);
                --gpt-overlay: rgba(0,0,0,0.45);
                --gpt-accent: #0d0d0d;
                --gpt-accent-fg: #ffffff;
                --gpt-danger: #ef4146;
                --gpt-radius: 12px;
                --gpt-ease: cubic-bezier(0.16, 1, 0.3, 1);
            }
            @media (prefers-color-scheme: dark) {
                :root {
                    --gpt-bg: #212121;
                    --gpt-bg-solid: #212121;
                    --gpt-bg-elevated: #2f2f2f;
                    --gpt-fg: #ececec;
                    --gpt-fg-muted: #8e8e8e;
                    --gpt-border: rgba(255,255,255,0.10);
                    --gpt-hover: #2f2f2f;
                    --gpt-shadow: rgba(0,0,0,0.5);
                    --gpt-overlay: rgba(0,0,0,0.65);
                    --gpt-accent: #ececec;
                    --gpt-accent-fg: #0d0d0d;
                }
            }
            html.dark {
                --gpt-bg: #212121;
                --gpt-bg-solid: #212121;
                --gpt-bg-elevated: #2f2f2f;
                --gpt-fg: #ececec;
                --gpt-fg-muted: #8e8e8e;
                --gpt-border: rgba(255,255,255,0.10);
                --gpt-hover: #2f2f2f;
                --gpt-shadow: rgba(0,0,0,0.5);
                --gpt-overlay: rgba(0,0,0,0.65);
                --gpt-accent: #ececec;
                --gpt-accent-fg: #0d0d0d;
            }

            .gpt-glass {
                background: var(--gpt-bg-solid);
                border: 1px solid var(--gpt-border);
                box-shadow: 0 8px 32px var(--gpt-shadow);
            }

            .gpt-input {
                width: 100%; padding: 11px 14px; border-radius: 12px;
                border: 1px solid var(--gpt-border);
                background: var(--gpt-bg-elevated); color: var(--gpt-fg);
                font-size: 14px; box-sizing: border-box; font-family: inherit;
                transition: border-color .2s var(--gpt-ease), background .2s var(--gpt-ease);
            }
            .gpt-input:focus { outline: none; border-color: var(--gpt-fg); }
            .gpt-label { display: block; margin-bottom: 8px; color: var(--gpt-fg); font-size: 13px; font-weight: 600; }
            .gpt-hint { color: var(--gpt-fg-muted); font-size: 12px; margin-top: 6px; line-height: 1.5; }

            .gpt-segment {
                display: flex; background: var(--gpt-bg-elevated);
                border-radius: 12px; padding: 3px; gap: 2px; margin-bottom: 18px;
            }
            .gpt-segment button {
                flex: 1; padding: 10px 12px; background: transparent;
                color: var(--gpt-fg-muted); border: none; border-radius: 9px;
                cursor: pointer; font-size: 13px; font-weight: 500; font-family: inherit;
                transition: background .18s var(--gpt-ease), color .18s var(--gpt-ease);
            }
            .gpt-segment button.active {
                background: var(--gpt-bg); color: var(--gpt-fg);
                box-shadow: 0 1px 2px rgba(0,0,0,0.08);
            }

            .gpt-btn-primary {
                padding: 14px;
                background: var(--gpt-accent); color: var(--gpt-accent-fg);
                border: none; border-radius: 999px;
                font-size: 15px; cursor: pointer; font-weight: 600;
                font-family: inherit;
                transition: opacity .15s var(--gpt-ease);
            }
            .gpt-btn-primary:hover { opacity: 0.9; }
            .gpt-btn-ghost {
                padding: 12px; background: transparent;
                color: var(--gpt-fg-muted); border: none;
                font-size: 14px; cursor: pointer; font-family: inherit;
            }

            @keyframes gptMenuIn {
                from { opacity: 0; transform: translateY(-6px) scale(0.97); }
                to   { opacity: 1; transform: translateY(0) scale(1); }
            }
            @keyframes gptFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes gptItemIn {
                from { opacity: 0; transform: translateX(-4px); }
                to   { opacity: 1; transform: translateX(0); }
            }
            @keyframes gptSlideDown {
                from { opacity: 0; transform: translateY(-4px); }
                to   { opacity: 1; transform: translateY(0); }
            }

            .gpt-menu-panel { animation: gptMenuIn .25s var(--gpt-ease) both; }
            .gpt-menu-item {
                animation: gptItemIn .3s var(--gpt-ease) both;
                transition: background .15s var(--gpt-ease), transform .1s var(--gpt-ease);
            }
            .gpt-menu-item:hover { background: var(--gpt-hover) !important; }
            .gpt-menu-item:active { transform: scale(0.98); }

            .gpt-field-block {
                animation: gptSlideDown .25s var(--gpt-ease) both;
            }
        `;
        document.head.appendChild(s);
    }

    // ============================================
    // УТИЛИТЫ
    // ============================================
    function humanDelay(min, max) {
        if (CONFIG.fastMode) { min = Math.min(min, 100); max = Math.min(max, 250); }
        const base = min + Math.random() * (max - min);
        const pause = Math.random() < 0.1 ? 800 + Math.random() * 1500 : 0;
        return new Promise(r => setTimeout(r, base + pause));
    }

    function setReactValue(element, value) {
        if (!element) return false;
        const proto = Object.getPrototypeOf(element);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(element, value); else element.value = value;
        if (element._valueTracker) element._valueTracker.setValue('');
        return true;
    }

    function dispatchInputEvent(element, value) {
        if (!element) return;
        try {
            element.dispatchEvent(new InputEvent('input', {
                bubbles: true, cancelable: true, inputType: 'insertText', data: value
            }));
        } catch (e) { element.dispatchEvent(new Event('input', { bubbles: true })); }
    }

    async function humanClick(element) {
        if (!element) return false;
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await humanDelay(50, 150);
        try {
            element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0 }));
        } catch (e) {}
        await humanDelay(30, 80);
        try {
            element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0 }));
        } catch (e) {}
        element.click();
        return true;
    }

    async function focusField(element) {
        if (!element) return;
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await humanDelay(50, 150);
        element.focus();
        try {
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
            element.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }));
        } catch (e) {}
        await humanDelay(50, 150);
    }

    const saveData = async (k, v) => { try { await GM.setValue('chatgpt_helper_' + k, v); return true; } catch { return false; } };
    const getData  = async (k)    => { try { return await GM.getValue('chatgpt_helper_' + k, null); } catch { return null; } };

    // ============================================
    // HTTP
    // ============================================
    function httpRequest(opts) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                ...opts,
                onload: (resp) => resolve(resp),
                onerror: (e) => resolve({ status: 0, responseText: '', error: e }),
                ontimeout: () => resolve({ status: 0, responseText: 'timeout' })
            });
        });
    }

    async function httpRequestWithRetry(opts, label = 'API') {
        for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
            const resp = await httpRequest(opts);

            if (resp.status === 429) {
                let wait = 5;
                const m = (resp.responseHeaders || '').match(/retry-after:\s*(\d+)/i);
                if (m) wait = parseInt(m[1]) || 5;
                if (attempt < CONFIG.maxRetries) {
                    showNotification(`${label}: лимит, ждём ${wait}с…`, 'warning', wait * 1000 + 1000);
                    await new Promise(r => setTimeout(r, wait * 1000));
                    continue;
                }
                return resp;
            }
            if (resp.status >= 500 && resp.status < 600) {
                if (attempt < CONFIG.maxRetries) {
                    const wait = 2 * attempt;
                    showNotification(`${label}: ${resp.status}, повтор…`, 'warning', wait * 1000 + 1000);
                    await new Promise(r => setTimeout(r, wait * 1000));
                    continue;
                }
                return resp;
            }
            if (resp.status === 0) {
                if (attempt < CONFIG.maxRetries) {
                    showNotification(`${label}: сеть, повтор…`, 'warning', 3000);
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                return resp;
            }
            return resp;
        }
        return { status: 0, responseText: 'max_retries' };
    }

    // ============================================
    // УВЕДОМЛЕНИЯ
    // ============================================
    let notificationContainer = null;

    function createNotificationContainer() {
        if (notificationContainer) return;
        notificationContainer = document.createElement('div');
        notificationContainer.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:999999;display:flex;flex-direction:column;gap:8px;max-width:90%;width:480px;pointer-events:none;';
        document.body.appendChild(notificationContainer);
    }

    function showNotification(text, type = 'info', duration = 5000) {
        createNotificationContainer();
        const colors = {
            info: '#3498db', success: '#8e8e8e',
            warning: '#f39c12', error: '#ef4146', debug: '#8e8e8e'
        };
        const el = document.createElement('div');
        el.className = 'gpt-glass';
        el.style.cssText = `padding:12px 16px;border-radius:12px;font-size:14px;border-left:4px solid ${colors[type] || '#8e8e8e'};pointer-events:auto;display:flex;align-items:center;gap:10px;word-break:break-word;color:var(--gpt-fg);animation:gptFadeIn .25s var(--gpt-ease) both;`;
        el.innerHTML = `<span>${text}</span>`;
        notificationContainer.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => { if (el.parentNode) el.remove(); }, 400); }, duration);
        console.log(`[${(type || 'info').toUpperCase()}] ${text}`);
        return el;
    }

    // ============================================
    // НАСТРОЙКИ
    // ============================================
    function showSettingsDialog() {
        return new Promise((resolve) => {
            if (settingsModal) settingsModal.remove();
            settingsModal = document.createElement('div');
            settingsModal.style.cssText = 'position:fixed;inset:0;background:var(--gpt-overlay);z-index:999999;display:flex;align-items:center;justify-content:center;animation:gptFadeIn .2s var(--gpt-ease) both;';

            const dialog = document.createElement('div');
            dialog.className = 'gpt-glass';
            dialog.style.cssText = `padding:24px;border-radius:20px;max-width:480px;width:90%;color:var(--gpt-fg);animation:gptMenuIn .3s var(--gpt-ease) both;`;

            dialog.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <h2 style="margin:0;font-size:18px;font-weight:600;">Настройки скрипта</h2>
                    <button id="closeSettings" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gpt-fg-muted);padding:0 5px;">×</button>
                </div>
                <p style="color:var(--gpt-fg-muted);font-size:12px;margin:0 0 20px 0;">
                    Ключи сохраняются в хранилище Tampermonkey.
                </p>

                <label class="gpt-label">Режим работы</label>
                <div class="gpt-segment" id="gpt-mode-segment">
                    <button type="button" data-mode="agentmail">AgentMail</button>
                    <button type="button" data-mode="simplelogin">SimpleLogin</button>
                </div>

                <div id="gpt-agentmail-block" class="gpt-field-block">
                    <label class="gpt-label" id="gpt-agentmail-label">
                        AgentMail API Key <span style="color:var(--gpt-fg-muted);">*</span>
                    </label>
                    <input id="agentmail-input" class="gpt-input" type="password" placeholder="am_..." autocomplete="off">
                    <p class="gpt-hint" id="gpt-agentmail-hint">
                        console.agentmail.to → API Keys → Create New API Key
                    </p>
                </div>

                <div style="height:14px;"></div>

                <div id="gpt-simplelogin-block" class="gpt-field-block" style="display:none;">
                    <label class="gpt-label">SimpleLogin API Key <span style="color:var(--gpt-fg-muted);">*</span></label>
                    <input id="simplelogin-input" class="gpt-input" type="password" placeholder="sl_..." autocomplete="off">
                    <p class="gpt-hint">
                        app.simplelogin.io/dashboard/api_key<br>
                        <span style="opacity:.8;">SimpleLogin создаёт алиас, который пересылает письма на AgentMail. Постоянный inbox в AgentMail нужно привязать как mailbox в SimpleLogin вручную.</span>
                    </p>
                </div>

                <div style="height:20px;"></div>

                <div style="display:flex;flex-direction:column;gap:10px;">
                    <button id="saveSettings" class="gpt-btn-primary">Сохранить</button>
                    <button id="clearSettings" style="padding:10px;background:transparent;color:var(--gpt-danger);border:1px solid var(--gpt-border);border-radius:999px;font-size:13px;cursor:pointer;font-family:inherit;">Удалить ключи</button>
                    <button id="cancelSettings" class="gpt-btn-ghost">Отмена</button>
                </div>
            `;

            settingsModal.appendChild(dialog);
            document.body.appendChild(settingsModal);

            const agentInput = dialog.querySelector('#agentmail-input');
            const slInput = dialog.querySelector('#simplelogin-input');
            const agentLabel = dialog.querySelector('#gpt-agentmail-label');
            const agentHint = dialog.querySelector('#gpt-agentmail-hint');
            const slBlock = dialog.querySelector('#gpt-simplelogin-block');

            if (CONFIG.agentMailApiKey) agentInput.value = CONFIG.agentMailApiKey;
            if (CONFIG.simpleLoginApiKey) slInput.value = CONFIG.simpleLoginApiKey;

            let selectedMode = CONFIG.emailMode;

            const applyMode = () => {
                const isSimple = selectedMode === 'simplelogin';
                slBlock.style.display = isSimple ? 'block' : 'none';
                agentLabel.innerHTML = isSimple
                    ? 'AgentMail API Key <span style="color:var(--gpt-fg-muted);">* (relay для писем)</span>'
                    : 'AgentMail API Key <span style="color:var(--gpt-fg-muted);">*</span>';
                agentHint.innerHTML = isSimple
                    ? 'console.agentmail.to → API Keys. Письма будут приходить в этот ящик.'
                    : 'console.agentmail.to → API Keys → Create New API Key';
            };

            const segment = dialog.querySelector('#gpt-mode-segment');
            const segButtons = segment.querySelectorAll('button');
            const updateSegment = () => {
                segButtons.forEach(b => b.classList.toggle('active', b.dataset.mode === selectedMode));
                applyMode();
            };
            updateSegment();
            segButtons.forEach(b => {
                b.onclick = () => { selectedMode = b.dataset.mode; updateSegment(); };
            });

            const close = (r) => { settingsModal.remove(); settingsModal = null; resolve(r); };

            dialog.querySelector('#closeSettings').onclick = () => close(null);
            dialog.querySelector('#cancelSettings').onclick = () => close(null);
            settingsModal.onclick = (e) => { if (e.target === settingsModal) close(null); };

            dialog.querySelector('#saveSettings').onclick = async () => {
                const mode = selectedMode;
                const agentMail = agentInput.value.trim();
                const simpleLogin = slInput.value.trim();
                if (!agentMail) { showNotification('Укажите AgentMail API Key', 'error', 4000); return; }
                if (mode === 'simplelogin' && !simpleLogin) { showNotification('Для SimpleLogin укажите API Key', 'error', 5000); return; }

                await saveData('agentMailApiKey', agentMail);
                await saveData('simpleLoginApiKey', simpleLogin || null);
                await saveData('emailMode', mode);
                CONFIG.agentMailApiKey = agentMail;
                CONFIG.simpleLoginApiKey = simpleLogin;
                CONFIG.emailMode = mode;
                showNotification('Настройки сохранены', 'info', 3000);
                close({ agentMail, simpleLogin, mode });
            };

            dialog.querySelector('#clearSettings').onclick = async () => {
                await saveData('agentMailApiKey', null);
                await saveData('simpleLoginApiKey', null);
                await saveData('emailMode', null);
                CONFIG.agentMailApiKey = ''; CONFIG.simpleLoginApiKey = ''; CONFIG.emailMode = 'agentmail';
                agentInput.value = ''; slInput.value = '';
                selectedMode = 'agentmail'; updateSegment();
                showNotification('Ключи удалены', 'info', 3000);
            };

            setTimeout(() => agentInput.focus(), 100);
        });
    }

    async function ensureApiKeys() {
        const saved = await getData('agentMailApiKey');
        if (saved) {
            CONFIG.agentMailApiKey = saved;
            CONFIG.simpleLoginApiKey = (await getData('simpleLoginApiKey')) || '';
            CONFIG.emailMode = (await getData('emailMode')) || 'agentmail';
            return true;
        }
        return !!(await showSettingsDialog());
    }

    // ============================================
    // AGENTMAIL API
    // ============================================
    function generateInboxUsername() {
        const adj = ['swift', 'bright', 'calm', 'bold', 'keen', 'pure', 'warm', 'cool', 'fast', 'clear'];
        const noun = ['fox', 'hawk', 'wolf', 'bear', 'lion', 'tiger', 'eagle', 'shark', 'puma', 'owl'];
        return adj[Math.floor(Math.random() * adj.length)] + '-' +
               noun[Math.floor(Math.random() * noun.length)] + '-' +
               Date.now().toString(36);
    }

    async function createAgentMailInbox() {
        if (!CONFIG.agentMailApiKey) { showNotification('AgentMail: ключ не задан', 'error'); return null; }
        const username = generateInboxUsername();
        const resp = await httpRequestWithRetry({
            method: 'POST',
            url: `${CONFIG.agentMailBase}/inboxes`,
            headers: {
                'Authorization': `Bearer ${CONFIG.agentMailApiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            data: JSON.stringify({ username, displayName: 'ChatGPT Auto' })
        }, 'AgentMail');

        if (resp.status !== 200 && resp.status !== 201) {
            showNotification(`AgentMail: ${resp.status} ${resp.responseText.slice(0, 150)}`, 'error', 12000);
            return null;
        }
        try {
            const d = JSON.parse(resp.responseText);
            return { inboxId: d.inbox_id, email: d.inbox_id || d.email, username };
        } catch { return null; }
    }

    async function deleteAgentMailInbox(inboxId) {
        if (!inboxId) return false;
        const resp = await httpRequestWithRetry({
            method: 'DELETE',
            url: `${CONFIG.agentMailBase}/inboxes/${encodeURIComponent(inboxId)}`,
            headers: { 'Authorization': `Bearer ${CONFIG.agentMailApiKey}` }
        }, 'AgentMail delete');
        return resp.status === 200 || resp.status === 204;
    }

    async function listAgentMailInboxes() {
        const resp = await httpRequestWithRetry({
            method: 'GET',
            url: `${CONFIG.agentMailBase}/inboxes`,
            headers: { 'Authorization': `Bearer ${CONFIG.agentMailApiKey}`, 'Accept': 'application/json' }
        }, 'AgentMail list');
        if (resp.status !== 200) return [];
        try { return JSON.parse(resp.responseText).inboxes || []; } catch { return []; }
    }

    async function listAgentMailMessages(inboxId) {
        const resp = await httpRequest({
            method: 'GET',
            url: `${CONFIG.agentMailBase}/inboxes/${encodeURIComponent(inboxId)}/messages?limit=10`,
            headers: { 'Authorization': `Bearer ${CONFIG.agentMailApiKey}`, 'Accept': 'application/json' }
        });
        if (resp.status === 429) return { __rateLimited: true };
        if (resp.status !== 200) return null;
        try { return JSON.parse(resp.responseText).messages || []; } catch { return null; }
    }

    async function getAgentMailMessage(inboxId, messageId) {
        const resp = await httpRequest({
            method: 'GET',
            url: `${CONFIG.agentMailBase}/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
            headers: { 'Authorization': `Bearer ${CONFIG.agentMailApiKey}`, 'Accept': 'application/json' }
        });
        if (resp.status !== 200) return null;
        try { return JSON.parse(resp.responseText); } catch { return null; }
    }

    // ============================================
    // SIMPLELOGIN API
    // ============================================
    async function createSimpleLoginAlias() {
        if (!CONFIG.simpleLoginApiKey) { showNotification('SimpleLogin: ключ не задан', 'error'); return null; }
        const resp = await httpRequestWithRetry({
            method: 'POST',
            url: `${CONFIG.simpleLoginBase}/api/alias/random/new`,
            headers: {
                'Authentication': CONFIG.simpleLoginApiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            data: JSON.stringify({ note: 'ChatGPT Auto' })
        }, 'SimpleLogin');

        if (resp.status !== 200 && resp.status !== 201) {
            showNotification(`SimpleLogin: ${resp.status} ${resp.responseText.slice(0, 150)}`, 'error', 12000);
            return null;
        }
        try {
            const d = JSON.parse(resp.responseText);
            return d.alias || d.email;
        } catch { return null; }
    }

    // ============================================
    // ИЗВЛЕЧЕНИЕ КОДА
    // ============================================
    function extractCode(emailData) {
        if (!emailData) return null;
        const raw = [emailData.extracted_text, emailData.extracted_html, emailData.text, emailData.html, emailData.subject]
            .filter(Boolean).join('\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ');
        const glued = raw.replace(/(\d)[\s\u00a0]+(?=\d)/g, '$1');
        const m = glued.match(/(?:код|code|verification)[^\d\n]{0,40}(\d{6})/i) || glued.match(/\b(\d{6})\b/);
        return m ? m[1] : null;
    }

    const msgTime = (m) => new Date(m.timestamp || m.created_at || 0).getTime();
    const isFresh = (m) => !codeRequestedAt || msgTime(m) >= codeRequestedAt - CONFIG.timeToleranceMs;

    async function findVerificationCode() {
        if (!currentInbox?.inboxId) return { found: false, reason: 'no_inbox' };
        const messages = await listAgentMailMessages(currentInbox.inboxId);
        if (messages?.__rateLimited) return { found: false, reason: 'rate_limited' };
        if (!messages) return { found: false, reason: 'api_error' };
        if (!messages.length) return { found: false, reason: 'no_messages' };

        messages.sort((a, b) => msgTime(b) - msgTime(a));
        const fresh = messages.filter(isFresh);
        if (!fresh.length) return { found: false, reason: 'waiting_new_email', count: messages.length };

        for (const msg of fresh) {
            if (usedMessageIds.has(msg.message_id)) continue;
            const full = (await getAgentMailMessage(currentInbox.inboxId, msg.message_id)) || msg;
            const code = extractCode(full);
            if (code) return {
                found: true, code, messageId: msg.message_id,
                ageSec: Math.max(0, Math.round((Date.now() - msgTime(msg)) / 1000))
            };
        }
        return { found: false, reason: 'no_code_in_fresh', count: fresh.length };
    }

    // ============================================
    // ВВОД В ПОЛЯ
    // ============================================
    function fillInput(input, value) {
        if (!input) return false;
        focusField(input); setReactValue(input, ''); setReactValue(input, value);
        dispatchInputEvent(input, value); input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    async function typeLikeHuman(input, text) {
        if (!input) return;
        await focusField(input); setReactValue(input, '');
        const minD = CONFIG.fastMode ? 20 : 80, maxD = CONFIG.fastMode ? 60 : 180;
        for (let i = 0; i < text.length; i++) {
            setReactValue(input, input.value + text[i]);
            dispatchInputEvent(input, text[i]);
            let d = minD + Math.random() * (maxD - minD);
            if (!CONFIG.fastMode && (i < 3 || i > text.length - 3)) d += 50;
            await new Promise(r => setTimeout(r, d));
        }
        await humanDelay(50, 150);
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function findEmailInput() {
        const c = [document.getElementById('mobile-auth-email'), document.querySelector('input[type="email"]'),
            document.querySelector('input[name="login_hint"]'), document.querySelector('input[autocomplete="email"]'),
            document.querySelector('input[placeholder*="email" i]')].filter(Boolean);
        for (const i of c) if (i.offsetParent !== null || i.offsetWidth > 0) return i;
        return c[0] || null;
    }

    function findPasswordInput() {
        const all = [...document.querySelectorAll('input[type="password"]')];
        for (const el of all) if (el.offsetParent !== null || el.offsetWidth > 0) return el;
        return null;
    }

    function findCodeInput() {
        for (const sel of ['input[placeholder*="код" i]', 'input[placeholder*="code" i]', 'input[inputmode="numeric"]', 'input[autocomplete="one-time-code"]']) {
            const i = document.querySelector(sel);
            if (i && i.offsetParent !== null) return i;
        }
        for (const el of document.querySelectorAll('input[type="text"], input[type="tel"], input:not([type])')) {
            if (parseInt(el.getAttribute('maxlength') || '0') === 6) return el;
        }
        return null;
    }

    function findCodeInputs() {
        const single = [...document.querySelectorAll('input[maxlength="1"]')].filter(el => el.offsetParent !== null);
        if (single.length >= 6) return { type: 'otp', inputs: single.slice(0, 6) };
        const one = findCodeInput();
        return one ? { type: 'single', input: one } : null;
    }

    async function fillCode(code) {
        const t = findCodeInputs();
        if (!t) return false;
        if (t.type === 'single') { await typeLikeHuman(t.input, code); return true; }
        for (let i = 0; i < t.inputs.length && i < code.length; i++) {
            await focusField(t.inputs[i]);
            setReactValue(t.inputs[i], code[i]); dispatchInputEvent(t.inputs[i], code[i]);
        }
        return true;
    }

    function findProfileFields() {
        const all = document.querySelectorAll('input');
        let nameInput = null, ageInput = null;
        for (const i of all) {
            const s = ((i.placeholder || '') + (i.getAttribute('aria-label') || '') + (i.name || '')).toLowerCase();
            if (s.includes('name') || s.includes('имя')) { nameInput = i; break; }
        }
        for (const i of all) {
            if (i === nameInput) continue;
            const s = ((i.placeholder || '') + (i.getAttribute('aria-label') || '')).toLowerCase();
            if (s.includes('age') || s.includes('возраст') || i.type === 'number') { ageInput = i; break; }
        }
        return { nameInput, ageInput };
    }

    const generateAge = () => Math.floor(Math.random() * 21) + 25;
    const generateUserData = () => ({ firstName: ['Alex', 'Emma', 'James', 'Sophia', 'Michael', 'Olivia'][Math.floor(Math.random() * 6)] });

    function generatePassword() {
        const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const special = '!@#$%&*';
        let pwd = '';
        for (let i = 0; i < 14; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
        pwd += special[Math.floor(Math.random() * special.length)];
        pwd += Math.floor(Math.random() * 10);
        return pwd;
    }

    async function clickContinue() {
        for (const b of document.querySelectorAll('button, a, div[role="button"]')) {
            const t = b.textContent.trim().toLowerCase();
            if (t === 'continue' || t === 'продолжить' || t === 'next' || t === 'далее' || t === 'create' || t === 'создать') return await humanClick(b);
        }
        return false;
    }

    function isUserLoggedIn() {
        if (document.querySelector('[data-testid="user-menu"], .user-menu')) return true;
        if (window.location.href.includes('/c/')) return true;
        if (window.location.hostname.includes('chatgpt.com') && !hasLoginButton() && !findEmailInput()) return true;
        return false;
    }

    function hasLoginButton() {
        return [...document.querySelectorAll('button, a, div[role="button"]')].some(b =>
            ['Войти', 'Sign in', 'Log in', 'Login'].includes(b.textContent.trim())
        );
    }

    const isOnLoginPage = () => window.location.hostname.includes('auth.openai.com') || findEmailInput() !== null;
    const isOnProfilePage = () => { const f = findProfileFields(); return !!(f.nameInput && f.ageInput); };
    const isOnAboutYouPage = () => /about-you|profile|onboarding/i.test(window.location.href);

    // ============================================
    // ДИАЛОГ ВЫБОРА
    // ============================================
    function showEmailChoiceDialog() {
        return new Promise(async (resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:var(--gpt-overlay);z-index:999999;display:flex;align-items:center;justify-content:center;animation:gptFadeIn .2s var(--gpt-ease) both;';
            const dialog = document.createElement('div');
            dialog.className = 'gpt-glass';
            dialog.style.cssText = `padding:28px;border-radius:20px;max-width:420px;width:90%;text-align:center;color:var(--gpt-fg);animation:gptMenuIn .3s var(--gpt-ease) both;`;
            dialog.innerHTML = `
                <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;">Регистрация ChatGPT</h2>
                <p style="color:var(--gpt-fg-muted);font-size:13px;margin:0 0 18px 0;">
                    Режим: <b style="color:var(--gpt-fg);">${CONFIG.emailMode === 'simplelogin' ? 'SimpleLogin → AgentMail' : 'AgentMail (прямой)'}</b>
                </p>
                <p style="color:var(--gpt-fg-muted);font-size:12px;margin:0 0 16px 0;" id="oldEmailDisplay"></p>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <button id="newEmailBtn" class="gpt-btn-primary">Новая регистрация</button>
                    <button id="oldEmailBtn" style="padding:14px;background:var(--gpt-bg-elevated);color:var(--gpt-fg);border:1px solid var(--gpt-border);border-radius:999px;font-size:15px;cursor:pointer;display:none;font-family:inherit;">Продолжить прошлую</button>
                    <button id="cancelBtn" class="gpt-btn-ghost">Отмена</button>
                </div>`;
            overlay.appendChild(dialog); document.body.appendChild(overlay);
            const old = await getData('currentInbox');
            dialog.querySelector('#oldEmailDisplay').textContent = old ? `📧 ${old.email}` : '';
            if (old) dialog.querySelector('#oldEmailBtn').style.display = 'block';

            dialog.querySelector('#newEmailBtn').onclick = () => { overlay.remove(); resolve('new'); };
            dialog.querySelector('#oldEmailBtn').onclick = () => { overlay.remove(); resolve('old'); };
            dialog.querySelector('#cancelBtn').onclick = () => { overlay.remove(); resolve('cancel'); };
            overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve('cancel'); } };
        });
    }

    // ============================================
    // ПОМОЩЬ
    // ============================================
    function showHelpModal() {
        if (helpModal) helpModal.remove();
        helpModal = document.createElement('div');
        helpModal.style.cssText = 'position:fixed;inset:0;background:var(--gpt-overlay);z-index:999999;display:flex;align-items:center;justify-content:center;animation:gptFadeIn .2s var(--gpt-ease) both;';
        const modal = document.createElement('div');
        modal.className = 'gpt-glass';
        modal.style.cssText = `padding:24px;border-radius:20px;max-width:640px;width:90%;max-height:80vh;overflow-y:auto;color:var(--gpt-fg);animation:gptMenuIn .3s var(--gpt-ease) both;`;

        modal.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h2 style="margin:0;font-size:20px;font-weight:600;">Помощь — ChatGPT Auto Register</h2>
                <button id="closeHelp" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--gpt-fg-muted);padding:0 5px;">×</button>
            </div>
            <div style="line-height:1.6;font-size:14px;">
                <div style="margin-bottom:22px;">
                    <h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gpt-fg);">🔑 Шаг 1. Ключи</h3>
                    <p style="margin:0 0 10px 0;"><b>AgentMail:</b> console.agentmail.to → API Keys → Create</p>
                    <p style="margin:0;"><b>SimpleLogin:</b> app.simplelogin.io/dashboard/api_key</p>
                </div>
                <div style="margin-bottom:22px;">
                    <h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gpt-fg);">📧 SimpleLogin → AgentMail</h3>
                    <ol style="margin:0;padding-left:20px;color:var(--gpt-fg-muted);font-size:13px;line-height:1.7;">
                        <li>Создайте <b style="color:var(--gpt-fg);">постоянный</b> inbox в AgentMail (не удаляйте его).</li>
                        <li>В SimpleLogin → <b style="color:var(--gpt-fg);">Mailboxes</b> → Add Mailbox → укажите адрес AgentMail.</li>
                        <li>Подтвердите письмо, сделайте mailbox дефолтным.</li>
                        <li>Скрипт будет создавать новый алиас SimpleLogin на каждую регистрацию, а письма будут идти в AgentMail.</li>
                    </ol>
                </div>
                <div style="margin-bottom:22px;">
                    <h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gpt-fg);">🚀 Регистрация</h3>
                    <ol style="margin:0;padding-left:20px;color:var(--gpt-fg-muted);font-size:13px;line-height:1.7;">
                        <li>Откройте chatgpt.com (не авторизованы).</li>
                        <li>☰ → Регистрация → «Новая регистрация».</li>
                        <li>Скрипт сам создаст почту, введёт email, дождётся кода, вставит код, при необходимости создаст пароль и заполнит профиль.</li>
                        <li>Пароль будет показан в уведомлении — сохраните его.</li>
                    </ol>
                </div>
                <div>
                    <h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gpt-fg);">📋 Контекст</h3>
                    <p style="margin:0;color:var(--gpt-fg-muted);font-size:13px;">☰ → Копировать контекст → выход → новая регистрация → ☰ → Вставить контекст.</p>
                </div>
            </div>
        `;
        helpModal.appendChild(modal);
        document.body.appendChild(helpModal);
        modal.querySelector('#closeHelp').onclick = () => { helpModal.remove(); helpModal = null; };
        helpModal.onclick = (e) => { if (e.target === helpModal) { helpModal.remove(); helpModal = null; } };
    }

    // ============================================
    // МЕНЮ
    // ============================================
    let menuButton = null, menuPanel = null, menuVisible = false;
    let statusLabel = null;

    const ICON_HAMBURGER = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
    const ICON_COPY = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const ICON_PASTE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`;
    const ICON_REGISTER = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
    const ICON_SETTINGS = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    const ICON_HELP = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

    function setMenuStatus(text, color) {
        if (!statusLabel) return;
        statusLabel.textContent = text || '';
        statusLabel.style.color = color || 'var(--gpt-fg)';
    }

    function findChatMessages() {
        const selectors = ['[data-message-author-role]', '[data-testid^="conversation-turn-"]', '.message', 'div[class*="message"]', 'div[class*="markdown"]'];
        const messages = [];
        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) {
                els.forEach(el => {
                    const role = el.getAttribute('data-message-author-role') ||
                                (el.closest('[data-message-author-role]')?.getAttribute('data-message-author-role')) ||
                                'unknown';
                    const text = el.innerText.trim();
                    if (text && text.length > 5) messages.push({ role, text });
                });
                break;
            }
        }
        return messages;
    }

    function findChatInput() {
        const selectors = ['textarea#prompt-textarea', 'textarea[placeholder*="Message"]', 'textarea[placeholder*="Спросите"]', 'textarea[placeholder*="Ask"]', 'textarea', 'div[contenteditable="true"]'];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) return el;
        }
        return null;
    }

    async function copyContext() {
        const messages = findChatMessages();
        if (messages.length === 0) { showNotification('Не найдено сообщений в чате', 'error'); return; }
        const formatted = messages.map(m => `[${m.role === 'user' ? 'Пользователь' : m.role === 'assistant' ? 'Ассистент' : 'Неизвестно'}]: ${m.text}`).join('\n\n');
        savedContext = formatted;
        await saveData('savedContext', formatted);
        try {
            if (typeof GM_setClipboard !== 'undefined') GM_setClipboard(formatted, 'text');
            else await navigator.clipboard.writeText(formatted);
            showNotification(`Контекст скопирован (${messages.length} сообщ., ${formatted.length} симв.)`, 'info');
        } catch { showNotification('Ошибка копирования', 'error'); }
        closeMenu();
    }

    async function pasteContext() {
        if (!savedContext) savedContext = await getData('savedContext');
        if (!savedContext) { showNotification('Сначала скопируйте контекст', 'warning'); return; }
        const input = findChatInput();
        if (!input) { showNotification('Поле ввода не найдено', 'error'); return; }
        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') await typeLikeHuman(input, savedContext);
        else if (input.isContentEditable) {
            input.focus(); input.innerText = savedContext;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        showNotification(`Контекст вставлен (${savedContext.length} симв.)`, 'info');
        closeMenu();
    }

    function closeMenu() {
        if (!menuPanel) return;
        menuPanel.style.animation = 'none';
        menuPanel.style.display = 'none';
        menuVisible = false;
    }

    function toggleMenu() {
        if (!menuPanel) return;
        menuVisible = !menuVisible;
        if (menuVisible) {
            updateMenuItems();
            menuPanel.style.display = 'flex';
            menuPanel.style.animation = 'none';
            void menuPanel.offsetWidth;
            menuPanel.style.animation = 'gptMenuIn .25s var(--gpt-ease) both';
        } else {
            closeMenu();
        }
    }

    function updateMenuItems() {
        if (!menuPanel) return;
        const loggedIn = isUserLoggedIn();
        const register = menuPanel.querySelector('#gpt-register-btn');
        const copy = menuPanel.querySelector('#gpt-copy-btn');
        const paste = menuPanel.querySelector('#gpt-paste-btn');

        if (register) register.style.display = loggedIn ? 'none' : 'flex';
        if (copy) copy.style.display = loggedIn ? 'flex' : 'none';
        if (paste) paste.style.display = loggedIn ? 'flex' : 'none';
    }

    function createMenu() {
        if (menuButton) return;
        if (!document.body) return;

        const isMobile = window.innerWidth < 768;
        const leftPos = isMobile ? '56px' : '64px';

        menuButton = document.createElement('button');
        menuButton.id = 'gpt-menu-btn';
        menuButton.title = 'Меню ChatGPT Auto Register';
        menuButton.innerHTML = ICON_HAMBURGER;
        menuButton.style.cssText = `
            position:fixed; top:8px; left:${leftPos}; z-index:99999;
            width:36px; height:36px;
            padding:0;
            background:transparent; color:var(--gpt-fg);
            border:none; border-radius:8px;
            cursor:pointer;
            display:flex; align-items:center; justify-content:center;
            transition: background .15s var(--gpt-ease);
        `;
        menuButton.addEventListener('mouseenter', () => { menuButton.style.background = 'var(--gpt-hover)'; });
        menuButton.addEventListener('mouseleave', () => { menuButton.style.background = 'transparent'; });
        menuButton.onclick = (e) => { e.stopPropagation(); toggleMenu(); };

        statusLabel = document.createElement('div');
        statusLabel.id = 'gpt-menu-status';
        statusLabel.style.cssText = `
            position:fixed; top:44px; left:${leftPos};
            font-size:10px; font-weight:600;
            color:var(--gpt-fg); text-align:center; width:36px;
            pointer-events:none;
        `;
        document.body.appendChild(statusLabel);

        menuPanel = document.createElement('div');
        menuPanel.className = 'gpt-glass gpt-menu-panel';
        menuPanel.style.cssText = `
            position:fixed; top:52px; left:${leftPos}; z-index:99999;
            display:none; flex-direction:column; gap:4px;
            padding:8px; border-radius:var(--gpt-radius);
            min-width:${isMobile ? '200px' : '230px'};
            max-width:calc(100vw - 32px);
        `;

        const makeBtn = (id, icon, text, onClick, delay = 0) => {
            const b = document.createElement('button');
            b.id = id;
            b.className = 'gpt-menu-item';
            b.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-right:8px;opacity:.85;">${icon}</span><span style="font-size:14px;">${text}</span>`;
            b.style.cssText = `display:flex;align-items:center;padding:10px 12px;background:transparent;color:var(--gpt-fg);border:none;border-radius:10px;cursor:pointer;font-weight:500;text-align:left;animation-delay:${delay}ms;`;
            b.onclick = (e) => { e.stopPropagation(); onClick(); };
            return b;
        };

        menuPanel.appendChild(makeBtn('gpt-register-btn', ICON_REGISTER, 'Регистрация', () => { closeMenu(); startRegistration(); }, 0));
        menuPanel.appendChild(makeBtn('gpt-copy-btn', ICON_COPY, 'Копировать контекст', copyContext, 40));
        menuPanel.appendChild(makeBtn('gpt-paste-btn', ICON_PASTE, 'Вставить контекст', pasteContext, 80));
        menuPanel.appendChild(makeBtn('gpt-settings-btn', ICON_SETTINGS, 'Настройки', () => { closeMenu(); showSettingsDialog(); }, 120));
        menuPanel.appendChild(makeBtn('gpt-help-btn', ICON_HELP, 'Помощь', () => { closeMenu(); showHelpModal(); }, 160));

        document.body.appendChild(menuButton);
        document.body.appendChild(menuPanel);

        document.addEventListener('click', (e) => {
            if (menuPanel && menuPanel.style.display === 'flex' &&
                !menuPanel.contains(e.target) && !menuButton.contains(e.target)) {
                closeMenu();
            }
        });

        window.addEventListener('resize', () => {
            const newLeft = window.innerWidth < 768 ? '56px' : '64px';
            if (menuButton) menuButton.style.left = newLeft;
            if (menuPanel) menuPanel.style.left = newLeft;
            if (statusLabel) statusLabel.style.left = newLeft;
        });
    }

    // ============================================
    // WATCHERS
    // ============================================
    function startUrlWatcher(callback, timeout = 15000) {
        stopUrlWatcher();
        let lastUrl = window.location.href;
        let elapsed = 0;
        urlWatcher = setInterval(() => {
            if (window.location.href !== lastUrl) { stopUrlWatcher(); callback(); }
            else {
                elapsed += 500;
                if (elapsed >= timeout) { stopUrlWatcher(); callback(true); }
            }
        }, 500);
    }
    function stopUrlWatcher() { if (urlWatcher) { clearInterval(urlWatcher); urlWatcher = null; } }

    // ============================================
    // ЭТАПЫ
    // ============================================
    async function stageMain() {
        if (loginAttempted || registrationComplete) return;
        if (isOnLoginPage()) { await stageLogin(); return; }
        showNotification('Нажимаю "Войти"', 'info');
        loginAttempted = true;
        let btn = null;
        for (let i = 0; i < 10 && !btn; i++) {
            for (const b of document.querySelectorAll('button, a, div[role="button"]')) {
                if (['Войти', 'Sign in', 'Log in', 'Login'].includes(b.textContent.trim())) { btn = b; break; }
            }
            if (!btn) await new Promise(r => setTimeout(r, 300));
        }
        if (btn) {
            await humanClick(btn);
            startUrlWatcher(() => { loginAttempted = false; if (!registrationComplete) runStage(); }, 10000);
        } else {
            showNotification('Кнопка "Войти" не найдена', 'error');
            loginAttempted = false;
        }
    }

    async function stageLogin() {
        if (registrationComplete) return;
        const choice = await showEmailChoiceDialog();
        if (choice === 'cancel') return;

        let emailToUse;

        if (choice === 'new') {
            setMenuStatus('Почта…', 'var(--gpt-fg)');

            if (CONFIG.emailMode === 'simplelogin') {
                const inboxes = await listAgentMailInboxes();
                if (!inboxes.length) {
                    showNotification('AgentMail: нет ни одного inbox. Создайте вручную.', 'error', 12000);
                    setMenuStatus('', '');
                    return;
                }
                const relay = inboxes[0];
                currentInbox = { inboxId: relay.inbox_id, email: relay.inbox_id || relay.email };

                showNotification('SimpleLogin: создаю алиас…', 'info', 4000);
                const alias = await createSimpleLoginAlias();
                if (!alias) { setMenuStatus('', ''); return; }
                emailToUse = alias;
                showNotification(`Алиас: ${alias} → ${currentInbox.email}`, 'info', 6000);
            } else {
                const inbox = await createAgentMailInbox();
                if (!inbox) { setMenuStatus('', ''); return; }
                currentInbox = inbox;
                emailToUse = inbox.email;
                showNotification(`Почта: ${emailToUse}`, 'info', 6000);
            }

            codeRequestedAt = Date.now();
            usedMessageIds = new Set();
            await saveData('usedMessageIds', []);
            await saveData('codeRequestedAt', codeRequestedAt);
            await saveData('currentInbox', currentInbox);
            await saveData('currentEmail', emailToUse);
        } else {
            let saved = await getData('currentInbox');
            if (!saved?.inboxId) {
                showNotification('Нет сохранённой почты. Создайте новую.', 'warning', 6000);
                setMenuStatus('', '');
                return;
            }

            setMenuStatus('Проверка…', 'var(--gpt-fg)');
            const inboxes = await listAgentMailInboxes();
            const exists = inboxes.some(i =>
                (i.inbox_id || i.email) === saved.inboxId ||
                (i.inbox_id || i.email) === saved.email
            );

            if (!exists) {
                showNotification('Прошлый ящик удалён. Создайте новую регистрацию.', 'warning', 8000);
                await saveData('currentInbox', null);
                await saveData('currentEmail', null);
                setMenuStatus('', '');
                return;
            }

            currentInbox = saved;
            emailToUse = (await getData('currentEmail')) || saved.email;
            codeRequestedAt = await getData('codeRequestedAt') || Date.now();
            showNotification(`Продолжаю с ${emailToUse}`, 'info', 4000);
        }

        let input = null;
        for (let i = 0; i < 8 && !input; i++) {
            input = findEmailInput();
            if (!input) await new Promise(r => setTimeout(r, 300));
        }
        if (!input) { showNotification('Поле email не найдено', 'error'); setMenuStatus('', ''); return; }

        await typeLikeHuman(input, emailToUse);
        await humanDelay(100, 300);
        await clickContinue();

        startUrlWatcher(() => { if (!registrationComplete) runStage(); }, 12000);
    }

    async function stagePassword() {
        if (passwordFilled || registrationComplete) return;
        const input = findPasswordInput();
        if (!input) {
            if (!isRunning) { isRunning = false; runStage(); }
            return;
        }

        let password = await getData('registrationPassword');
        if (!password) {
            password = generatePassword();
            await saveData('registrationPassword', password);
            showNotification(`🔑 Пароль: ${password}`, 'warning', 20000);
            try {
                if (typeof GM_setClipboard !== 'undefined') GM_setClipboard(password, 'text');
            } catch (e) {}
        } else {
            showNotification('Использую ранее сгенерированный пароль', 'info', 3000);
        }

        setMenuStatus('Пароль…', 'var(--gpt-fg)');
        await typeLikeHuman(input, password);
        passwordFilled = true;
        await humanDelay(200, 500);
        await clickContinue();

        startUrlWatcher(() => { if (!registrationComplete) { isRunning = false; runStage(); } }, 15000);
    }

    async function watchCodeResult() {
        const start = Date.now();
        const maxWait = 120000;

        while (Date.now() - start < maxWait) {
            await new Promise(r => setTimeout(r, 1500));
            if (registrationComplete) return;

            if (isOnProfilePage()) {
                showNotification('Код принят. Заполняю профиль…', 'info', 4000);
                isRunning = false;
                runStage();
                return;
            }
            if (findPasswordInput()) {
                showNotification('Код принят. Переход к паролю…', 'info', 4000);
                isRunning = false;
                runStage();
                return;
            }
            if (isOnAboutYouPage()) {
                isRunning = false;
                runStage();
                return;
            }
            if (!findCodeInputs()) {
                await new Promise(r => setTimeout(r, 1000));
                if (!findCodeInputs()) {
                    isRunning = false;
                    runStage();
                    return;
                }
            }
        }

        showNotification('Таймаут ожидания. Продолжаю…', 'warning', 5000);
        isRunning = false;
        runStage();
    }

    async function stageVerify() {
        if (verifyCompleted || registrationComplete || pollingActive) return;
        if (codeInserted) { verifyCompleted = true; await stageProfile(); return; }
        pollingActive = true;

        if (codeRequestedAt == null) codeRequestedAt = await getData('codeRequestedAt') || Date.now();

        if (!currentInbox?.inboxId) {
            currentInbox = await getData('currentInbox');
        }
        if (!currentInbox?.inboxId) {
            const email = await getData('currentEmail');
            if (email) {
                const inboxes = await listAgentMailInboxes();
                const found = inboxes.find(i => (i.inbox_id || i.email) === email);
                if (found) {
                    currentInbox = { inboxId: found.inbox_id, email: found.inbox_id || found.email };
                    await saveData('currentInbox', currentInbox);
                    showNotification('Ящик восстановлен из API', 'info', 4000);
                }
            }
        }
        if (!currentInbox?.inboxId) {
            showNotification('Нет ящика для проверки. Создайте новую регистрацию.', 'error', 10000);
            pollingActive = false;
            return;
        }

        showNotification(`Начинаю проверку (${currentInbox.email})`, 'info', 4000);

        for (let i = 0; i < CONFIG.maxAttempts; i++) {
            const attempt = i + 1;

            if (attempt <= 3 || attempt % 5 === 0) {
                showNotification(`Проверка #${attempt}/${CONFIG.maxAttempts}`, 'debug', 2000);
                setMenuStatus(`#${attempt}`, 'var(--gpt-fg)');
            }

            const result = await findVerificationCode();

            if (result.found && result.code) {
                showNotification(`Код: ${result.code} (письму ${result.ageSec}с)`, 'info', 8000);
                setMenuStatus('Код…', 'var(--gpt-fg)');

                if (await fillCode(result.code)) {
                    codeInserted = true; verifyCompleted = true;
                    usedMessageIds.add(result.messageId);
                    await saveData('usedMessageIds', [...usedMessageIds]);
                    await humanDelay(200, 500);
                    await clickContinue();

                    startUrlWatcher(() => { if (!registrationComplete) { isRunning = false; runStage(); } }, 25000);
                    watchCodeResult();
                    break;
                } else {
                    showNotification(`Код: ${result.code} (введите вручную)`, 'info', 10000);
                    pollingActive = false; return;
                }
            }

            if (result.reason === 'waiting_new_email') {
                if (attempt === 1 || attempt % 6 === 0)
                    showNotification(`Ждём письмо (старых: ${result.count})`, 'info', 3000);
            } else if (result.reason === 'rate_limited') {
                showNotification('AgentMail: лимит, пауза 10с…', 'warning', 11000);
                await new Promise(r => setTimeout(r, 10000));
                continue;
            } else if (result.reason === 'api_error') {
                if (attempt === 2 || attempt % 10 === 0)
                    showNotification('AgentMail: ошибка API, повтор…', 'error', 5000);
            } else if (result.reason === 'no_messages') {
                if (attempt === 5)
                    showNotification('Ящик пуст, ждём письмо…', 'warning', 5000);
            } else if (result.reason === 'no_code_in_fresh') {
                if (attempt % 6 === 0)
                    showNotification('Письмо есть, кода нет — ждём следующее', 'warning', 3000);
            }

            await new Promise(r => setTimeout(r, CONFIG.checkInterval));
        }

        pollingActive = false;
        setTimeout(() => { if (!registrationComplete) { isRunning = false; runStage(); } }, 1000);
    }

    async function stageProfile() {
        if (profileFilled || registrationComplete) return;
        const fields = findProfileFields();
        if (!fields.nameInput || !fields.ageInput) {
            setTimeout(() => { if (!profileFilled && !registrationComplete) stageProfile(); }, 1000);
            return;
        }
        const name = generateUserData().firstName, age = generateAge();
        showNotification(`Имя: ${name}, Возраст: ${age}`, 'info');
        await typeLikeHuman(fields.nameInput, name);
        await humanDelay(200, 500);
        fillInput(fields.ageInput, String(age));
        profileFilled = true;
        await humanDelay(500, 1500);
        if (await clickContinue()) {
            registrationComplete = true;
            await saveData('complete', true);
            showNotification('Регистрация завершена!', 'info', 8000);
            setMenuStatus('✓', 'var(--gpt-fg)');

            if (menuPanel) {
                const register = menuPanel.querySelector('#gpt-register-btn');
                if (register) register.style.display = 'none';
            }

            await saveData('currentInbox', null);
            await saveData('currentEmail', null);
            await saveData('codeRequestedAt', null);
            await saveData('registrationPassword', null);

            if (CONFIG.deleteInboxAfterUse && CONFIG.emailMode !== 'simplelogin' && currentInbox?.inboxId) {
                const deleted = await deleteAgentMailInbox(currentInbox.inboxId);
                if (deleted) showNotification('Временный ящик удалён', 'info', 3000);
            }
            stopUrlWatcher();
            if (window.urlCheckInterval) { clearInterval(window.urlCheckInterval); window.urlCheckInterval = null; }
        }
    }

    function detectStage() {
        if (hasLoginButton() && window.location.hostname.includes('chatgpt.com')) return 'main';
        if (window.location.hostname.includes('auth.openai.com') || isOnAboutYouPage()) {
            if (isOnProfilePage()) return 'profile';
            if (findCodeInputs()) return 'verify';
            if (findPasswordInput() && !findEmailInput()) return 'password';
            if (findEmailInput()) return 'login';
        }
        return 'unknown';
    }

    async function runStage() {
        if (isRunning || registrationComplete) return;
        isRunning = true;
        try {
            const stage = detectStage();
            if (stage === 'main') await stageMain();
            else if (stage === 'login') await stageLogin();
            else if (stage === 'verify') await stageVerify();
            else if (stage === 'password') await stagePassword();
            else if (stage === 'profile') await stageProfile();
        } catch (e) {
            showNotification(`Ошибка: ${e.message}`, 'error');
        }
        isRunning = false;
    }

    async function startRegistration() {
        if (isRunning) return;
        if (registrationComplete) {
            showNotification('Регистрация уже завершена', 'info', 3000);
            return;
        }
        if (isUserLoggedIn()) {
            showNotification('Вы авторизованы. Сначала выйдите из аккаунта.', 'warning', 6000);
            return;
        }
        const hasKeys = await ensureApiKeys();
        if (!hasKeys) { showNotification('Настройка отменена', 'warning', 4000); return; }

        setMenuStatus('Старт', 'var(--gpt-fg)');
        loginAttempted = false; verifyCompleted = false; codeInserted = false; passwordFilled = false;
        isRunning = false;
        try {
            await runStage();
        } finally {
            setTimeout(() => setMenuStatus('', ''), 1500);
        }
    }

    // ============================================
    // INIT
    // ============================================
    function waitForBody() {
        return new Promise(resolve => {
            if (document.body) { resolve(); return; }
            const observer = new MutationObserver(() => {
                if (document.body) { observer.disconnect(); resolve(); }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(() => { observer.disconnect(); resolve(); }, 10000);
        });
    }

    async function init() {
        if (initDone) return;
        try {
            await waitForBody();
            injectThemeStyles();

            const saved = await getData('agentMailApiKey');
            if (saved) CONFIG.agentMailApiKey = saved;
            CONFIG.simpleLoginApiKey = (await getData('simpleLoginApiKey')) || '';
            CONFIG.emailMode = (await getData('emailMode')) || 'agentmail';

            codeRequestedAt = await getData('codeRequestedAt');
            ((await getData('usedMessageIds')) || []).forEach(id => usedMessageIds.add(id));
            savedContext = await getData('savedContext');
            currentInbox = await getData('currentInbox');

            const wasComplete = await getData('complete');
            if (wasComplete && isUserLoggedIn()) {
                registrationComplete = true;
            } else if (wasComplete && !isUserLoggedIn()) {
                await saveData('complete', null);
                registrationComplete = false;
            }

            createMenu();

            let lastUrl = window.location.href;
            window.urlCheckInterval = setInterval(() => {
                if (window.location.href !== lastUrl) {
                    lastUrl = window.location.href;
                    if (menuVisible) updateMenuItems();
                }
            }, 1000);

            initDone = true;
        } catch (e) {
            console.error('[ChatGPT Auto Register] Ошибка инициализации:', e);
            showNotification(`Ошибка инициализации: ${e.message}`, 'error', 10000);
        }
    }

    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();
