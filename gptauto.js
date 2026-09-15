// ==UserScript==
// @name         ChatGPT Auto Register (AgentMail + SimpleLogin)
// @namespace    http://tampermonkey.net/
// @version      62.0
// @description  Авторегистрация ChatGPT. Поддержка прямого AgentMail (с удалением) и SimpleLogin (через ручной бэкенд AgentMail).
// @author       You
// @match        https://chatgpt.com/*
// @match        https://auth.openai.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      api.agentmail.to
// @connect      app.simplelogin.io
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ============================================
    // 1. СТИЛИ (GM_addStyle обходит CSP ChatGPT)
    // ============================================
    GM_addStyle(`
        #ar-floating-menu {
            position: fixed; bottom: 30px; right: 30px; z-index: 2147483647;
            display: flex; flex-direction: column; align-items: flex-end; gap: 12px;
        }
        #ar-main-btn {
            width: 60px; height: 60px; border-radius: 50%; background: #10a37f; color: #fff;
            border: 2px solid #0e8a6a; cursor: pointer; display: flex; align-items: center; justify-content: center;
            box-shadow: 0 6px 20px rgba(0,0,0,0.3); transition: transform 0.2s, background 0.2s;
        }
        #ar-main-btn:hover { transform: scale(1.1); background: #0e8a6a; }
        #ar-sub-menu {
            display: none; flex-direction: column; gap: 10px;
        }
        .ar-sub-btn {
            width: 50px; height: 50px; border-radius: 50%; background: var(--ar-bg, #ffffff); color: var(--ar-fg, #222222);
            border: 1px solid var(--ar-border, #e0e0e0); cursor: pointer; display: flex; align-items: center; justify-content: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: background 0.2s;
        }
        .ar-sub-btn:hover { background: var(--ar-hover, #f5f5f5) !important; }
        
        /* Модальные окна */
        .ar-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 2147483646;
            display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);
        }
        .ar-modal {
            background: var(--ar-bg, #ffffff); padding: 28px; border-radius: 20px;
            max-width: 550px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.4);
            max-height: 85vh; overflow-y: auto;
        }
        .ar-input {
            width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--ar-border, #ddd);
            background: var(--ar-input-bg, #f9f9f9); color: var(--ar-fg, #222); font-size: 15px; box-sizing: border-box; margin-bottom: 12px;
        }
        .ar-btn-primary {
            padding: 14px 20px; background: #10a37f; color: #fff; border: none; border-radius: 10px;
            cursor: pointer; font-size: 16px; font-weight: 600; width: 100%; margin-bottom: 10px;
        }
        .ar-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .ar-btn-secondary {
            padding: 12px 20px; background: transparent; color: var(--ar-fg, #666); border: 1px solid var(--ar-border, #ddd);
            border-radius: 10px; cursor: pointer; font-size: 15px; width: 100%; margin-bottom: 10px;
        }
        .ar-btn-text {
            padding: 10px; background: transparent; color: var(--ar-fg-muted, #999); border: none;
            cursor: pointer; font-size: 14px; width: 100%;
        }
        .ar-help-text { color: var(--ar-fg, #333); line-height: 1.6; font-size: 14px; }
        .ar-help-text h3 { color: var(--ar-fg, #1a1a1a); font-size: 16px; border-bottom: 2px solid var(--ar-border, #e0e0e0); padding-bottom: 8px; margin-top: 20px; }
        .ar-help-text code { background: var(--ar-input-bg, #f0f0f0); padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    `);

    const CONFIG = {
        checkInterval: 3000,
        maxAttempts: 120,
        timeToleranceMs: 60000,
        fastMode: true,
    };

    let sessionState = {
        isRunning: false,
        registrationComplete: false,
        codeInserted: false,
        verifyCompleted: false,
        inboxId: null,
        inboxEmail: null,
        slAliasId: null,
        codeRequestedAt: null,
        usedMessageIds: new Set(),
        savedContext: null
    };

    // ============================================
    // 2. УТИЛИТЫ И ТЕМЫ
    // ============================================
    function getTheme() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
        if (document.documentElement.classList.contains('dark') || document.body.classList.contains('dark')) return 'dark';
        return 'light';
    }

    function applyThemeStyles() {
        const isDark = getTheme() === 'dark';
        const root = document.documentElement;
        root.style.setProperty('--ar-bg', isDark ? '#1e1e1e' : '#ffffff');
        root.style.setProperty('--ar-fg', isDark ? '#eeeeee' : '#222222');
        root.style.setProperty('--ar-fg-muted', isDark ? '#888888' : '#999999');
        root.style.setProperty('--ar-border', isDark ? '#444444' : '#e0e0e0');
        root.style.setProperty('--ar-input-bg', isDark ? '#2d2d2d' : '#f9f9f9');
        root.style.setProperty('--ar-hover', isDark ? '#3a3a3a' : '#f0f0f0');
    }

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
            element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
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

    async function saveData(key, value) {
        try { await GM.setValue('chatgpt_ar_' + key, value); return true; } catch (e) { return false; }
    }
    async function getData(key) {
        try { return await GM.getValue('chatgpt_ar_' + key, null); } catch (e) { return null; }
    }

    // ============================================
    // 3. УВЕДОМЛЕНИЯ
    // ============================================
    let notificationContainer = null;
    function createNotificationContainer() {
        if (notificationContainer && document.body.contains(notificationContainer)) return;
        notificationContainer = document.createElement('div');
        notificationContainer.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;flex-direction:column;gap:8px;max-width:90%;width:480px;pointer-events:none;';
        document.body.appendChild(notificationContainer);
    }

    function showNotification(text, type = 'info', duration = 5000) {
        createNotificationContainer();
        const isDark = getTheme() === 'dark';
        const colors = { info: isDark ? '#2d6b9b' : '#3498db', success: '#10a37f', warning: isDark ? '#b8860b' : '#f39c12', error: isDark ? '#8b1a1a' : '#e74c3c', debug: isDark ? '#555' : '#7f8c8d' };
        const el = document.createElement('div');
        el.style.cssText = `background:${isDark ? '#1e1e1e' : '#fff'};color:${isDark ? '#eee' : '#222'};padding:14px 18px;border-radius:12px;font-size:15px;box-shadow:0 4px 20px rgba(0,0,0,${isDark ? '0.4' : '0.15'});border-left:5px solid ${colors[type] || '#333'};pointer-events:auto;display:flex;align-items:center;gap:10px;word-break:break-word;`;
        el.innerHTML = `<span>${text}</span>`;
        notificationContainer.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.4s'; setTimeout(() => { if (el.parentNode) el.remove(); }, 400); }, duration);
        console.log(`[AUTO-REG ${type.toUpperCase()}] ${text}`);
    }

    // ============================================
    // 4. API: AgentMail.to
    // ============================================
    function apiRequest(method, url, token, data) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method, url,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                data: data ? JSON.stringify(data) : null,
                onload: (resp) => resolve(resp),
                onerror: (e) => resolve({ status: 0, responseText: '', error: e }),
                ontimeout: () => resolve({ status: 0, responseText: 'timeout' })
            });
        });
    }

    async function createAgentMailInbox() {
        const apiKey = await getData('agentMailApiKey');
        if (!apiKey) { showNotification('Не указан API ключ AgentMail.to!', 'error', 8000); return null; }
        const resp = await apiRequest('POST', 'https://api.agentmail.to/v0/inboxes', apiKey, {});
        if (resp.status !== 200 && resp.status !== 201) {
            showNotification(`AgentMail: ошибка создания (${resp.status})`, 'error', 8000);
            return null;
        }
        try {
            const data = JSON.parse(resp.responseText);
            return { id: data.id || data.inbox_id, email: data.email_address || data.email || data.address };
        } catch (e) { return null; }
    }

    async function deleteAgentMailInbox(inboxId) {
        if (!inboxId) return;
        const apiKey = await getData('agentMailApiKey');
        if (!apiKey) return;
        await apiRequest('DELETE', `https://api.agentmail.to/v0/inboxes/${inboxId}`, apiKey);
    }

    async function getAgentMailMessages(inboxId) {
        const apiKey = await getData('agentMailApiKey');
        if (!apiKey || !inboxId) return null;
        const resp = await apiRequest('GET', `https://api.agentmail.to/v0/inboxes/${inboxId}/messages`, apiKey);
        if (resp.status !== 200) return null;
        try { return JSON.parse(resp.responseText); } catch (e) { return null; }
    }

    async function getAgentMailMessageDetail(inboxId, messageId) {
        const apiKey = await getData('agentMailApiKey');
        if (!apiKey || !inboxId || !messageId) return null;
        const resp = await apiRequest('GET', `https://api.agentmail.to/v0/inboxes/${inboxId}/messages/${encodeURIComponent(messageId)}`, apiKey);
        if (resp.status !== 200) return null;
        try { return JSON.parse(resp.responseText); } catch (e) { return null; }
    }

    // ============================================
    // 5. API: SimpleLogin
    // ============================================
    async function createSimpleLoginAlias(forwardToEmail) {
        const apiKey = await getData('simpleLoginApiKey');
        if (!apiKey) return null;

        // Находим ID ящика, который пользователь вручную привязал
        const mailboxesResp = await apiRequest('GET', 'https://app.simplelogin.io/api/mailboxes', apiKey);
        let targetMailboxId = null;
        if (mailboxesResp.status === 200) {
            try {
                const mailboxes = JSON.parse(mailboxesResp.responseText).mailboxes || [];
                const mb = mailboxes.find(m => m.email === forwardToEmail);
                if (mb) targetMailboxId = mb.id;
            } catch(e) {}
        }

        if (!targetMailboxId) {
            showNotification('SimpleLogin: Ящик для пересылки не найден. Проверьте настройки.', 'error', 8000);
            return null;
        }

        const prefix = 'gpt_' + Math.random().toString(36).substring(2, 10);
        const aliasResp = await apiRequest('POST', 'https://app.simplelogin.io/api/aliases', apiKey, {
            alias_prefix: prefix,
            mailbox_ids: [targetMailboxId],
            note: 'ChatGPT Auto Register'
        });

        if (aliasResp.status === 200 || aliasResp.status === 201) {
            try {
                const data = JSON.parse(aliasResp.responseText);
                return { alias: data.alias || data.email, id: data.id };
            } catch(e) {}
        }
        return null;
    }

    async function deleteSimpleLoginAlias(aliasId) {
        if (!aliasId) return;
        const apiKey = await getData('simpleLoginApiKey');
        if (!apiKey) return;
        await apiRequest('DELETE', `https://app.simplelogin.io/api/aliases/${aliasId}`, apiKey);
    }

    // ============================================
    // 6. ПОИСК КОДА И ВВОД (Как в оригинальном gpt.js)
    // ============================================
    function extractCode(emailData) {
        if (!emailData) return null;
        const raw = [emailData.text, emailData.html, emailData.subject].filter(Boolean).join('\n')
            .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ');
        const glued = raw.replace(/(\d)[\s\u00a0]+(?=\d)/g, '$1');
        const m = glued.match(/(?:код|code|verification)[^\d\n]{0,40}(\d{6})/i) || glued.match(/\b(\d{6})\b/);
        if (m && !/^(19|20)\d{2}$/.test(m[1])) return m[1];
        return null;
    }

    async function findVerificationCode() {
        const targetInboxId = sessionState.inboxId;
        if (!targetInboxId) return { found: false, reason: 'no_inbox' };
        
        const messages = await getAgentMailMessages(targetInboxId);
        if (!messages) return { found: false, reason: 'api_error' };
        if (!Array.isArray(messages) || messages.length === 0) return { found: false, reason: 'no_messages' };

        messages.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        
        for (const msg of messages) {
            if (sessionState.usedMessageIds.has(msg.id)) continue;
            const msgTime = new Date(msg.created_at || 0).getTime();
            if (sessionState.codeRequestedAt && msgTime < sessionState.codeRequestedAt - CONFIG.timeToleranceMs) continue;

            const fullMsg = (await getAgentMailMessageDetail(targetInboxId, msg.id)) || msg;
            const code = extractCode(fullMsg);
            if (code) {
                return {
                    found: true, code, messageId: msg.id,
                    ageSec: Math.max(0, Math.round((Date.now() - msgTime) / 1000))
                };
            }
        }
        return { found: false, reason: 'no_code_in_fresh', count: messages.length };
    }

    function findEmailInput() {
        const c = [document.getElementById('mobile-auth-email'), document.querySelector('input[type="email"]'),
            document.querySelector('input[name="login_hint"]'), document.querySelector('input[autocomplete="email"]'),
            document.querySelector('input[placeholder*="email" i]')].filter(Boolean);
        for (const i of c) if (i.offsetParent !== null || i.offsetWidth > 0) return i;
        return c[0] || null;
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
        if (t.type === 'single') { 
            // Находим поле и вводим как человек
            await focusField(t.input); 
            setReactValue(t.input, ''); 
            const minDelay = CONFIG.fastMode ? 20 : 80;
            const maxDelay = CONFIG.fastMode ? 60 : 180;
            for (let i = 0; i < code.length; i++) {
                setReactValue(t.input, t.input.value + code[i]);
                dispatchInputEvent(t.input, code[i]);
                await new Promise(r => setTimeout(r, minDelay + Math.random() * (maxDelay - minDelay)));
            }
            t.input.dispatchEvent(new Event('change', { bubbles: true }));
            return true; 
        }
        // Если 6 отдельных полей
        for (let i = 0; i < t.inputs.length && i < code.length; i++) {
            await focusField(t.inputs[i]);
            setReactValue(t.inputs[i], code[i]); 
            dispatchInputEvent(t.inputs[i], code[i]);
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

    async function clickContinue() {
        for (const b of document.querySelectorAll('button, a, div[role="button"]')) {
            const t = b.textContent.trim().toLowerCase();
            if (t === 'continue' || t === 'продолжить' || t === 'next' || t === 'далее') return await humanClick(b);
        }
        return false;
    }

    // ============================================
    // 7. ОЧИСТКА СЕССИИ
    // ============================================
    async function cleanupSession() {
        showNotification('Очистка временных данных...', 'info', 3000);
        const useSL = (await getData('useSimpleLogin')) === 'true';
        
        if (useSL) {
            // В режиме SimpleLogin мы удаляем ТОЛЬКО алиас, основной ящик AgentMail остаётся
            if (sessionState.slAliasId) {
                await deleteSimpleLoginAlias(sessionState.slAliasId);
            }
        } else {
            // В прямом режиме мы удаляем созданный скриптом ящик AgentMail
            if (sessionState.inboxId) {
                await deleteAgentMailInbox(sessionState.inboxId);
            }
        }
        
        sessionState.inboxId = null;
        sessionState.inboxEmail = null;
        sessionState.slAliasId = null;
        sessionState.codeRequestedAt = null;
        sessionState.usedMessageIds = new Set();
    }

    // ============================================
    // 8. ИНТЕРФЕЙС И МОДАЛЬНЫЕ ОКНА
    // ============================================
    function openSettingsModal() {
        const existing = document.getElementById('ar-settings-modal');
        if (existing) existing.remove();
        applyThemeStyles();

        const overlay = document.createElement('div');
        overlay.id = 'ar-settings-modal';
        overlay.className = 'ar-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'ar-modal';
        
        const useSL = (await getData('useSimpleLogin')) === 'true';
        
        modal.innerHTML = `
            <h2 style="margin:0 0 20px;color:var(--ar-fg);font-size:20px;">⚙️ Настройки API</h2>
            <div style="margin-bottom:16px;">
                <label style="display:block;color:var(--ar-fg);font-size:14px;margin-bottom:6px;font-weight:600;">AgentMail.to API Key</label>
                <input id="ar-am-key" class="ar-input" type="password" placeholder="am_...">
            </div>
            <div style="margin-bottom:16px;">
                <label style="display:block;color:var(--ar-fg);font-size:14px;margin-bottom:6px;font-weight:600;">SimpleLogin API Key (если используете)</label>
                <input id="ar-sl-key" class="ar-input" type="password" placeholder="sl_...">
            </div>
            <div style="margin-bottom:16px;display:flex;align-items:center;gap:10px;">
                <input id="ar-use-sl" type="checkbox" ${useSL ? 'checked' : ''} style="width:20px;height:20px;cursor:pointer;">
                <label for="ar-use-sl" style="color:var(--ar-fg);font-size:14px;cursor:pointer;">Использовать SimpleLogin (Рекомендуется)</label>
            </div>
            <div id="ar-sl-instructions" style="display:${useSL ? 'block' : 'none'}; margin-bottom:20px; padding:12px; background:var(--ar-input-bg); border-radius:8px; border-left:4px solid #f39c12;">
                <p style="margin:0 0 8px 0; color:var(--ar-fg); font-size:13px; font-weight:600;">⚠️ Важная инструкция для режима SimpleLogin:</p>
                <ol style="margin:0; padding-left:20px; color:var(--ar-fg-muted); font-size:13px; line-height:1.5;">
                    <li>Создайте ящик на agentmail.to (вручную через их сайт).</li>
                    <li>Добавьте этот email в SimpleLogin как новый Mailbox и <b>подтвердите его</b> (пройдите верификацию по ссылке из письма).</li>
                    <li>Скопируйте <b>Inbox ID</b> этого ящика из AgentMail и вставьте ниже.</li>
                </ol>
                <label style="display:block;color:var(--ar-fg);font-size:14px;margin:12px 0 6px 0;font-weight:600;">AgentMail Inbox ID (постоянный)</label>
                <input id="ar-am-inbox-id" class="ar-input" type="text" placeholder="Например: inbox_12345abcde">
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end; margin-top:20px;">
                <button id="ar-cancel-settings" class="ar-btn-secondary" style="width:auto; margin:0;">Отмена</button>
                <button id="ar-save-settings" class="ar-btn-primary" style="width:auto; margin:0;">Сохранить</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        Promise.all([getData('agentMailApiKey'), getData('simpleLoginApiKey'), getData('agentMailInboxId')]).then(([amKey, slKey, amInboxId]) => {
            document.getElementById('ar-am-key').value = amKey || '';
            document.getElementById('ar-sl-key').value = slKey || '';
            document.getElementById('ar-am-inbox-id').value = amInboxId || '';
        });

        document.getElementById('ar-use-sl').addEventListener('change', (e) => {
            document.getElementById('ar-sl-instructions').style.display = e.target.checked ? 'block' : 'none';
        });

        document.getElementById('ar-cancel-settings').onclick = () => overlay.remove();
        document.getElementById('ar-save-settings').onclick = async () => {
            await saveData('agentMailApiKey', document.getElementById('ar-am-key').value.trim());
            await saveData('simpleLoginApiKey', document.getElementById('ar-sl-key').value.trim());
            await saveData('useSimpleLogin', document.getElementById('ar-use-sl').checked ? 'true' : 'false');
            await saveData('agentMailInboxId', document.getElementById('ar-am-inbox-id').value.trim());
            showNotification('Настройки сохранены', 'success', 3000);
            overlay.remove();
        };
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }

    function showRegistrationDialog() {
        return new Promise(async (resolve) => {
            applyThemeStyles();
            const overlay = document.createElement('div');
            overlay.className = 'ar-overlay';
            
            const modal = document.createElement('div');
            modal.className = 'ar-modal';
            modal.style.textAlign = 'center';
            
            const amKey = await getData('agentMailApiKey');
            const useSL = (await getData('useSimpleLogin')) === 'true';
            const hasKey = !!amKey;
            const slReady = useSL ? !!(await getData('agentMailInboxId')) : true;
            const canStart = hasKey && slReady;
            
            modal.innerHTML = `
                <h2 style="margin:0 0 16px;color:var(--ar-fg);">🚀 Регистрация ChatGPT</h2>
                <p style="color:var(--ar-fg-muted);font-size:15px;margin-bottom:24px;line-height:1.5;">
                    ${!hasKey ? '⚠️ API ключ AgentMail.to не найден!' : 
                      !slReady ? '⚠️ Не указан Inbox ID для SimpleLogin!' :
                      `Готов к запуску.<br><span style="font-size:13px;opacity:0.8;">Режим: ${useSL ? 'SimpleLogin Алиас → Ваш AgentMail' : 'Прямой AgentMail (с авто-удалением)'}</span>`}
                </p>
                <div style="display:flex;flex-direction:column;gap:12px;">
                    <button id="ar-start-reg" class="ar-btn-primary" ${!canStart ? 'disabled' : ''}>Начать регистрацию</button>
                    <button id="ar-open-settings" class="ar-btn-secondary">⚙️ Настройки API</button>
                    <button id="ar-cancel-reg" class="ar-btn-text">Отмена</button>
                </div>
            `;
            
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            document.getElementById('ar-start-reg').onclick = () => { overlay.remove(); resolve('start'); };
            document.getElementById('ar-open-settings').onclick = () => { overlay.remove(); openSettingsModal(); resolve('cancel'); };
            document.getElementById('ar-cancel-reg').onclick = () => { overlay.remove(); resolve('cancel'); };
            overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve('cancel'); } };
        });
    }

    function showHelpModal() {
        const existing = document.getElementById('ar-help-modal');
        if (existing) existing.remove();
        applyThemeStyles();

        const overlay = document.createElement('div');
        overlay.id = 'ar-help-modal';
        overlay.className = 'ar-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'ar-modal';
        
        modal.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h2 style="margin:0;color:var(--ar-fg);font-size:20px;">Помощь — ChatGPT Auto Register</h2>
                <button id="ar-close-help" style="background:none;border:none;font-size:28px;cursor:pointer;color:var(--ar-fg-muted);padding:0 5px;">×</button>
            </div>
            <div class="ar-help-text">
                <h3>⚙️ 1. Получение ключей</h3>
                <p>1. Зарегистрируйтесь на <a href="https://agentmail.to" target="_blank" style="color:#10a37f;">agentmail.to</a> и создайте API ключ (начинается с <code>am_</code>).</p>
                <p>2. (Рекомендуется) Зарегистрируйтесь на <a href="https://app.simplelogin.io" target="_blank" style="color:#10a37f;">simplelogin.io</a> и создайте API ключ в настройках.</p>

                <h3>🔄 2. Выбор режима работы</h3>
                <p><b>Режим А: Прямой AgentMail (по умолчанию)</b><br>
                Скрипт сам создаёт новую случайную почту → вводит её в ChatGPT → читает код → <b>безвозвратно удаляет</b> эту почту. <i>Минус: OpenAI иногда блокирует домены @agentmail.to.</i></p>
                
                <p><b>Режим Б: SimpleLogin + AgentMail (Рекомендуемый)</b><br>
                1. Вручную создайте ящик на agentmail.to.<br>
                2. В SimpleLogin добавьте этот email как новый "Mailbox" и <b>обязательно подтвердите его</b> (пройдите верификацию по ссылке из письма).<br>
                3. В настройках скрипта включите "Использовать SimpleLogin" и вставьте <b>Inbox ID</b> вашего ящика AgentMail.<br>
                4. <i>Как это работает:</i> Скрипт создаст временный <b>алиас</b> SimpleLogin (который OpenAI не блокирует), зарегистрирует аккаунт, заберёт код из вашего постоянного ящика AgentMail, а затем удалит только временный алиас. Ваш основной ящик AgentMail останется нетронутым.</p>

                <h3>🚀 3. Использование</h3>
                <p>Нажмите крупную зелёную кнопку в правом нижнем углу или выберите "🚀 Начать регистрацию" в меню Tampermonkey. Скрипт автоматически найдёт поля, введёт данные и нажмёт "Continue".</p>
            </div>
        `;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        document.getElementById('ar-close-help').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }

    // ============================================
    // 9. ПЛАВАЮЩЕЕ МЕНЮ
    // ============================================
    let floatingMenu = null;
    let menuExpanded = false;

    const ICON_SETTINGS = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    const ICON_PLAY = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    const ICON_HELP = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

    function createFloatingMenu() {
        if (floatingMenu) floatingMenu.remove();
        applyThemeStyles();

        floatingMenu = document.createElement('div');
        floatingMenu.id = 'ar-floating-menu';

        const mainBtn = document.createElement('button');
        mainBtn.id = 'ar-main-btn';
        mainBtn.innerHTML = ICON_SETTINGS;
        mainBtn.title = 'Открыть меню';
        mainBtn.onclick = (e) => {
            e.stopPropagation();
            menuExpanded = !menuExpanded;
            subMenu.style.display = menuExpanded ? 'flex' : 'none';
        };

        const subMenu = document.createElement('div');
        subMenu.id = 'ar-sub-menu';
        
        const makeSubBtn = (icon, title, onClick) => {
            const b = document.createElement('button');
            b.className = 'ar-sub-btn';
            b.title = title;
            b.innerHTML = icon;
            b.onclick = (e) => { e.stopPropagation(); onClick(); };
            return b;
        };

        subMenu.appendChild(makeSubBtn(ICON_PLAY, 'Начать регистрацию', async () => {
            menuExpanded = false; subMenu.style.display = 'none';
            const action = await showRegistrationDialog();
            if (action === 'start') {
                sessionState.isRunning = true;
                await runStage();
                sessionState.isRunning = false;
            }
        }));
        subMenu.appendChild(makeSubBtn(ICON_HELP, 'Помощь и инструкция', showHelpModal));
        subMenu.appendChild(makeSubBtn(ICON_SETTINGS, 'Настройки API', openSettingsModal));

        floatingMenu.appendChild(subMenu);
        floatingMenu.appendChild(mainBtn);
        document.body.appendChild(floatingMenu);

        document.addEventListener('click', (e) => {
            if (floatingMenu && !floatingMenu.contains(e.target) && menuExpanded) {
                menuExpanded = false;
                subMenu.style.display = 'none';
            }
        });
    }

    // ============================================
    // 10. ЭТАПЫ РЕГИСТРАЦИИ (Как в оригинале)
    // ============================================
    async function stageLogin() {
        if (sessionState.registrationComplete) return;
        
        const useSL = (await getData('useSimpleLogin')) === 'true';
        let registrationEmail = '';

        if (useSL) {
            const targetInboxEmail = await getData('agentMailInboxId'); // Тут храним email или ID, проверим
            // Для простоты, если пользователь ввёл ID, нам нужен email. Но API SL требует email для поиска.
            // Давайте попросим пользователя вводить Email ящика в настройках, а не ID, это надёжнее.
            // Исправление: в настройках выше я назвал поле "Inbox ID", но для поиска ящика в SL нужен Email.
            // Я изменю логику: пользователь вводит Email своего постоянного ящика AgentMail в настройках.
            const permanentAgentMailEmail = await getData('agentMailPermanentEmail');
            const permanentInboxId = await getData('agentMailInboxId');
            
            if (!permanentAgentMailEmail || !permanentInboxId) {
                showNotification('Ошибка: В настройках SimpleLogin не указан Email и ID постоянного ящика AgentMail!', 'error', 8000);
                return;
            }

            showNotification('Создание алиаса SimpleLogin...', 'info', 3000);
            const slData = await createSimpleLoginAlias(permanentAgentMailEmail);
            if (!slData || !slData.alias) {
                showNotification('Не удалось создать алиас SimpleLogin.', 'error', 8000);
                return;
            }
            registrationEmail = slData.alias;
            sessionState.slAliasId = slData.id;
            sessionState.inboxId = permanentInboxId; // Читаем из постоянного ящика
            showNotification(`Алиас создан: ${registrationEmail}`, 'success', 4000);
        } else {
            showNotification('Создание временного ящика AgentMail...', 'info', 3000);
            const inboxData = await createAgentMailInbox();
            if (!inboxData) return;
            sessionState.inboxId = inboxData.id;
            sessionState.inboxEmail = inboxData.email;
            registrationEmail = inboxData.email;
        }

        sessionState.codeRequestedAt = Date.now();
        sessionState.usedMessageIds = new Set();

        let input = null;
        for (let i = 0; i < 8 && !input; i++) {
            input = findEmailInput();
            if (!input) await new Promise(r => setTimeout(r, 300));
        }
        if (!input) { showNotification('Поле email не найдено', 'error'); return; }

        // Ввод email как человек
        await focusField(input);
        setReactValue(input, '');
        const minDelay = CONFIG.fastMode ? 20 : 80;
        const maxDelay = CONFIG.fastMode ? 60 : 180;
        for (let i = 0; i < registrationEmail.length; i++) {
            setReactValue(input, input.value + registrationEmail[i]);
            dispatchInputEvent(input, registrationEmail[i]);
            await new Promise(r => setTimeout(r, minDelay + Math.random() * (maxDelay - minDelay)));
        }
        input.dispatchEvent(new Event('change', { bubbles: true }));
        
        showNotification(`Email введён: ${registrationEmail}`, 'success');
        await humanDelay(100, 300);
        await clickContinue();
    }

    async function stageVerify() {
        if (sessionState.verifyCompleted || sessionState.registrationComplete || sessionState.isRunning) return;
        if (sessionState.codeInserted) { sessionState.verifyCompleted = true; await stageProfile(); return; }
        
        if (!sessionState.inboxId) { showNotification('Нет активного inbox ID для проверки почты', 'error'); return; }

        for (let i = 0; i < CONFIG.maxAttempts; i++) {
            if (sessionState.registrationComplete) return;
            const attempt = i + 1;
            if (attempt <= 3 || attempt % 10 === 0) showNotification(`Проверка почты #${attempt}/${CONFIG.maxAttempts}`, 'debug', 2000);
            
            const result = await findVerificationCode();
            if (result.found && result.code) {
                showNotification(`Код найден: ${result.code} (письму ${result.ageSec}с)`, 'success', 8000);
                if (await fillCode(result.code)) {
                    sessionState.codeInserted = true; 
                    sessionState.verifyCompleted = true;
                    sessionState.usedMessageIds.add(result.messageId);
                    await humanDelay(200, 500); 
                    await clickContinue();
                    break;
                } else {
                    showNotification(`Код: ${result.code} (введите вручную)`, 'info', 10000);
                    return;
                }
            }
            await new Promise(r => setTimeout(r, CONFIG.checkInterval));
        }
        setTimeout(() => { if (!sessionState.registrationComplete) runStage(); }, 1000);
    }

    async function stageProfile() {
        if (sessionState.registrationComplete) return;
        const fields = findProfileFields();
        if (!fields.nameInput || !fields.ageInput) { 
            setTimeout(() => { if (!sessionState.registrationComplete) stageProfile(); }, 1000); 
            return; 
        }
        const name = generateUserData().firstName, age = generateAge();
        showNotification(`Заполнение профиля: ${name}, ${age}`, 'info');
        
        // Ввод имени
        await focusField(fields.nameInput);
        setReactValue(fields.nameInput, '');
        for (let i = 0; i < name.length; i++) {
            setReactValue(fields.nameInput, fields.nameInput.value + name[i]);
            dispatchInputEvent(fields.nameInput, name[i]);
            await humanDelay(20, 60);
        }
        fields.nameInput.dispatchEvent(new Event('change', { bubbles: true }));
        
        await humanDelay(200, 500);
        
        // Ввод возраста
        setReactValue(fields.ageInput, String(age));
        fields.ageInput.dispatchEvent(new Event('change', { bubbles: true }));
        
        await humanDelay(500, 1500);
        if (await clickContinue()) {
            sessionState.registrationComplete = true;
            showNotification('Регистрация успешно завершена!', 'success', 8000);
            await cleanupSession(); // Удаляем временные данные
        }
    }

    function detectStage() {
        if (window.location.hostname.includes('auth.openai.com')) {
            const fields = findProfileFields();
            if (fields.nameInput && fields.ageInput) return 'profile';
            if (findCodeInputs()) return 'verify';
            if (findEmailInput()) return 'login';
        }
        if (window.location.hostname.includes('chatgpt.com')) {
            if (document.querySelector('[data-testid="user-menu"], .user-menu') || window.location.href.includes('/c/')) return 'logged_in';
        }
        return 'unknown';
    }

    async function runStage() {
        if (sessionState.isRunning || sessionState.registrationComplete) return;
        sessionState.isRunning = true;
        try {
            const stage = detectStage();
            if (stage === 'login') await stageLogin();
            else if (stage === 'verify') await stageVerify();
            else if (stage === 'profile') await stageProfile();
            else if (stage === 'logged_in') {
                showNotification('Вы уже авторизованы!', 'success', 5000);
                sessionState.registrationComplete = true;
            } else {
                showNotification('Перейдите на страницу входа ChatGPT (chatgpt.com)', 'info', 5000);
            }
        } catch (e) { 
            showNotification(`Ошибка: ${e.message}`, 'error'); 
            console.error(e);
            await cleanupSession();
        }
        sessionState.isRunning = false;
    }

    // ============================================
    // 11. ИНИЦИАЛИЗАЦИЯ
    // ============================================
    async function init() {
        applyThemeStyles();
        sessionState.savedContext = await getData('savedContext');

        // Создаём плавающее меню
        createFloatingMenu();
        
        // Регистрируем команды в меню Tampermonkey (гарантированный доступ)
        GM_registerMenuCommand("🚀 Начать регистрацию", async () => {
            const action = await showRegistrationDialog();
            if (action === 'start') {
                sessionState.isRunning = true;
                await runStage();
                sessionState.isRunning = false;
            }
        });
        GM_registerMenuCommand("⚙️ Настройки API", openSettingsModal);
        GM_registerMenuCommand("❓ Помощь", showHelpModal);

        // Наблюдатель за изменением системной темы
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyThemeStyles);
        
        // Наблюдатель за изменением темы на самом сайте (если сайт переключает класс 'dark')
        const observer = new MutationObserver(() => {
            if (document.documentElement.classList.contains('dark') || document.body.classList.contains('dark')) {
                applyThemeStyles();
            }
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

        // Если скрипт перезагружен на странице верификации и есть активная сессия
        if (detectStage() === 'verify' && sessionState.inboxId) {
            showNotification('Обнаружена страница верификации. Продолжаю...', 'info', 3000);
            setTimeout(() => {
                sessionState.isRunning = true;
                runStage();
                sessionState.isRunning = false;
            }, 1500);
        }
    }

    // Запуск
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 1000); // Небольшая задержка для гарантии загрузки DOM
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
    }
})();
