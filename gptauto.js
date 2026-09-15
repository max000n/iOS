// ==UserScript==
// @name         ChatGPT Auto Register (AgentMail + SimpleLogin)
// @namespace    http://tampermonkey.net/
// @version      60.0
// @description  Авторегистрация ChatGPT с использованием AgentMail.to и SimpleLogin
// @author       You
// @match        https://chatgpt.com/*
// @match        https://auth.openai.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @connect      api.agentmail.to
// @connect      app.simplelogin.io
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        checkInterval: 3000,
        maxAttempts: 120,
        timeToleranceMs: 60000,
        fastMode: true,
    };

    // Состояние
    let isRunning = false;
    let registrationComplete = false;
    let codeInserted = false;
    let verifyCompleted = false;
    let currentInboxId = null;
    let currentEmailAddress = null;
    let codeRequestedAt = null;
    let usedMessageIds = new Set();
    let savedContext = null;

    // ============================================
    // УТИЛИТЫ И ТЕМЫ
    // ============================================
    function getTheme() {
        // Проверяем системную тему или тему сайта
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
        if (document.documentElement.classList.contains('dark') || document.body.classList.contains('dark')) return 'dark';
        return 'light';
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
        const isDark = getTheme() === 'dark';
        const colors = { info: isDark ? '#2d6b9b' : '#3498db', success: '#10a37f', warning: isDark ? '#b8860b' : '#f39c12', error: isDark ? '#8b1a1a' : '#e74c3c', debug: isDark ? '#555' : '#7f8c8d' };
        const el = document.createElement('div');
        el.style.cssText = `background:${isDark ? '#1e1e1e' : '#fff'};color:${isDark ? '#eee' : '#222'};padding:12px 16px;border-radius:12px;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,${isDark ? '0.4' : '0.15'});border-left:4px solid ${colors[type] || '#333'};pointer-events:auto;display:flex;align-items:center;gap:10px;word-break:break-word;`;
        el.innerHTML = `<span>${text}</span>`;
        notificationContainer.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.4s'; setTimeout(() => { if (el.parentNode) el.remove(); }, 400); }, duration);
        console.log(`[AUTO-REG ${type.toUpperCase()}] ${text}`);
    }

    // ============================================
    // API: AgentMail.to
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
        if (!apiKey) {
            showNotification('Не указан API ключ AgentMail.to в настройках!', 'error', 8000);
            return null;
        }
        const resp = await apiRequest('POST', 'https://api.agentmail.to/v0/inboxes', apiKey, {});
        if (resp.status !== 200 && resp.status !== 201) {
            showNotification(`AgentMail: ошибка создания inbox (${resp.status})`, 'error', 8000);
            return null;
        }
        try {
            const data = JSON.parse(resp.responseText);
            const inboxId = data.id || data.inbox_id;
            const email = data.email_address || data.email || data.address;
            if (inboxId && email) return { id: inboxId, email: email };
        } catch (e) {
            showNotification('AgentMail: ошибка парсинга ответа', 'error', 8000);
        }
        return null;
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
        const encodedId = encodeURIComponent(messageId);
        const resp = await apiRequest('GET', `https://api.agentmail.to/v0/inboxes/${inboxId}/messages/${encodedId}`, apiKey);
        if (resp.status !== 200) return null;
        try { return JSON.parse(resp.responseText); } catch (e) { return null; }
    }

    // ============================================
    // API: SimpleLogin (Опционально)
    // ============================================
    async function createSimpleLoginAlias() {
        const apiKey = await getData('simpleLoginApiKey');
        if (!apiKey) return null; // Не критично, если не указан
        
        const prefix = 'gpt_' + Math.random().toString(36).substring(2, 8);
        const resp = await apiRequest('POST', 'https://app.simplelogin.io/api/aliases', apiKey, {
            alias_prefix: prefix,
            note: 'ChatGPT Auto Register'
        });
        
        if (resp.status === 200 || resp.status === 201) {
            try {
                const data = JSON.parse(resp.responseText);
                return data.alias || data.email;
            } catch (e) {}
        }
        return null;
    }

    // ============================================
    // ПОИСК КОДА
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
        if (!currentInboxId) return { found: false, reason: 'no_inbox' };
        const messages = await getAgentMailMessages(currentInboxId);
        if (!messages) return { found: false, reason: 'api_error' };
        if (!Array.isArray(messages) || messages.length === 0) return { found: false, reason: 'no_messages' };

        messages.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        
        for (const msg of messages) {
            if (usedMessageIds.has(msg.id)) continue;
            const msgTime = new Date(msg.created_at || 0).getTime();
            if (codeRequestedAt && msgTime < codeRequestedAt - CONFIG.timeToleranceMs) continue;

            const fullMsg = (await getAgentMailMessageDetail(currentInboxId, msg.id)) || msg;
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
        const minDelay = CONFIG.fastMode ? 20 : 80;
        const maxDelay = CONFIG.fastMode ? 60 : 180;
        for (let i = 0; i < text.length; i++) {
            setReactValue(input, input.value + text[i]);
            dispatchInputEvent(input, text[i]);
            let d = minDelay + Math.random() * (maxDelay - minDelay);
            if (!CONFIG.fastMode) {
                if (i < 3 || i > text.length - 3) d += 50;
                if (Math.random() < 0.08) await humanDelay(500, 1200);
            }
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

    async function clickContinue() {
        for (const b of document.querySelectorAll('button, a, div[role="button"]')) {
            const t = b.textContent.trim().toLowerCase();
            if (t === 'continue' || t === 'продолжить' || t === 'next' || t === 'далее') return await humanClick(b);
        }
        return false;
    }

    // ============================================
    // ПРОВЕРКА СОСТОЯНИЯ
    // ============================================
    function isUserLoggedIn() {
        if (document.querySelector('[data-testid="user-menu"], .user-menu')) return true;
        if (window.location.href.includes('/c/')) return true;
        return false;
    }

    const isOnProfilePage = () => { const f = findProfileFields(); return !!(f.nameInput && f.ageInput); };

    // ============================================
    // МОДАЛЬНЫЕ ОКНА И МЕНЮ
    // ============================================
    function openSettingsModal() {
        const existing = document.getElementById('ar-settings-modal');
        if (existing) existing.remove();

        const isDark = getTheme() === 'dark';
        const overlay = document.createElement('div');
        overlay.id = 'ar-settings-modal';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:999999;display:flex;align-items:center;justify-content:center;';
        
        const modal = document.createElement('div');
        modal.style.cssText = `background:${isDark ? '#1e1e1e' : '#fff'};padding:28px;border-radius:20px;max-width:500px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,${isDark ? '0.5' : '0.2'});`;
        
        modal.innerHTML = `
            <h2 style="margin:0 0 20px;color:${isDark ? '#fff' : '#1a1a1a'};font-size:20px;">⚙️ Настройки API</h2>
            <div style="margin-bottom:16px;">
                <label style="display:block;color:${isDark ? '#ccc' : '#555'};font-size:13px;margin-bottom:6px;">AgentMail.to API Key (обязательно)</label>
                <input id="ar-agentmail-key" type="password" placeholder="am_..." style="width:100%;padding:10px;border-radius:8px;border:1px solid ${isDark ? '#444' : '#ddd'};background:${isDark ? '#2d2d2d' : '#f9f9f9'};color:${isDark ? '#fff' : '#222'};font-size:14px;">
            </div>
            <div style="margin-bottom:24px;">
                <label style="display:block;color:${isDark ? '#ccc' : '#555'};font-size:13px;margin-bottom:6px;">SimpleLogin API Key (опционально)</label>
                <input id="ar-simplelogin-key" type="password" placeholder="sl_..." style="width:100%;padding:10px;border-radius:8px;border:1px solid ${isDark ? '#444' : '#ddd'};background:${isDark ? '#2d2d2d' : '#f9f9f9'};color:${isDark ? '#fff' : '#222'};font-size:14px;">
                <p style="color:${isDark ? '#888' : '#999'};font-size:12px;margin-top:6px;">Если указан, будет создан алиас для дополнительной изоляции.</p>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button id="ar-cancel-settings" style="padding:10px 20px;background:transparent;color:${isDark ? '#aaa' : '#666'};border:1px solid ${isDark ? '#444' : '#ddd'};border-radius:8px;cursor:pointer;font-size:14px;">Отмена</button>
                <button id="ar-save-settings" style="padding:10px 20px;background:#10a37f;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;">Сохранить</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        Promise.all([getData('agentMailApiKey'), getData('simpleLoginApiKey')]).then(([amKey, slKey]) => {
            document.getElementById('ar-agentmail-key').value = amKey || '';
            document.getElementById('ar-simplelogin-key').value = slKey || '';
        });

        document.getElementById('ar-cancel-settings').onclick = () => overlay.remove();
        document.getElementById('ar-save-settings').onclick = async () => {
            const amKey = document.getElementById('ar-agentmail-key').value.trim();
            const slKey = document.getElementById('ar-simplelogin-key').value.trim();
            await saveData('agentMailApiKey', amKey);
            await saveData('simpleLoginApiKey', slKey);
            showNotification('Настройки сохранены', 'success', 3000);
            overlay.remove();
        };
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }

    function showRegistrationDialog() {
        return new Promise(async (resolve) => {
            const isDark = getTheme() === 'dark';
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:999999;display:flex;align-items:center;justify-content:center;';
            
            const modal = document.createElement('div');
            modal.style.cssText = `background:${isDark ? '#1e1e1e' : '#fff'};padding:28px;border-radius:20px;max-width:400px;width:90%;text-align:center;`;
            
            const amKey = await getData('agentMailApiKey');
            const hasKey = !!amKey;
            
            modal.innerHTML = `
                <h2 style="margin:0 0 16px;color:${isDark ? '#fff' : '#1a1a1a'};">🚀 Регистрация ChatGPT</h2>
                <p style="color:${isDark ? '#aaa' : '#666'};font-size:14px;margin-bottom:20px;">
                    ${hasKey ? 'API ключ AgentMail.to найден. Готов к созданию временного ящика.' : '⚠️ API ключ AgentMail.to не найден! Добавьте его в настройках.'}
                </p>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <button id="ar-start-reg" style="padding:14px;background:#10a37f;color:white;border:none;border-radius:12px;font-size:15px;cursor:pointer;font-weight:600;${!hasKey ? 'opacity:0.5;cursor:not-allowed;' : ''}" ${!hasKey ? 'disabled' : ''}>Начать регистрацию</button>
                    <button id="ar-open-settings" style="padding:14px;background:${isDark ? '#2d2d2d' : '#f0f0f0'};color:${isDark ? '#eee' : '#222'};border:1px solid ${isDark ? '#444' : '#ddd'};border-radius:12px;font-size:15px;cursor:pointer;">⚙️ Настройки API</button>
                    <button id="ar-cancel-reg" style="padding:12px;background:transparent;color:${isDark ? '#666' : '#999'};border:none;font-size:14px;cursor:pointer;">Отмена</button>
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

    // ============================================
    // ПЛАВАЮЩЕЕ МЕНЮ
    // ============================================
    let floatingMenu = null;
    let menuExpanded = false;

    const ICON_SETTINGS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    const ICON_PLAY = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    const ICON_COPY = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const ICON_PASTE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`;
    const ICON_HELP = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

    function createFloatingMenu() {
        if (floatingMenu) floatingMenu.remove();
        const isDark = getTheme() === 'dark';
        const bg = isDark ? '#2d2d2d' : '#ffffff';
        const fg = isDark ? '#eee' : '#222';
        const border = isDark ? '#444' : '#e0e0e0';
        const hover = isDark ? '#3a3a3a' : '#f5f5f5';

        floatingMenu = document.createElement('div');
        floatingMenu.style.cssText = `position:fixed;bottom:30px;right:30px;z-index:99999;display:flex;flex-direction:column;align-items:flex-end;gap:10px;`;

        const makeBtn = (icon, title, onClick, primary = false) => {
            const b = document.createElement('button');
            b.innerHTML = icon;
            b.title = title;
            b.style.cssText = `width:48px;height:48px;border-radius:50%;background:${primary ? '#10a37f' : bg};color:${primary ? '#fff' : fg};border:1px solid ${primary ? '#10a37f' : border};cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,${isDark ? '0.4' : '0.15'});transition:all 0.2s;`;
            b.addEventListener('mouseenter', () => { if (!primary) b.style.background = hover; });
            b.addEventListener('mouseleave', () => { if (!primary) b.style.background = bg; });
            b.onclick = (e) => { e.stopPropagation(); onClick(); };
            return b;
        };

        const mainBtn = makeBtn(ICON_SETTINGS, 'Меню', () => {
            menuExpanded = !menuExpanded;
            subMenu.style.display = menuExpanded ? 'flex' : 'none';
        }, true);

        const subMenu = document.createElement('div');
        subMenu.style.cssText = `display:none;flex-direction:column;gap:10px;`;
        
        subMenu.appendChild(makeBtn(ICON_PLAY, 'Начать регистрацию', async () => {
            menuExpanded = false; subMenu.style.display = 'none';
            const action = await showRegistrationDialog();
            if (action === 'start') {
                isRunning = true;
                await runStage();
                isRunning = false;
            }
        }));
        subMenu.appendChild(makeBtn(ICON_COPY, 'Копировать контекст', copyContext));
        subMenu.appendChild(makeBtn(ICON_PASTE, 'Вставить контекст', pasteContext));
        subMenu.appendChild(makeBtn(ICON_HELP, 'Помощь и справка', showHelpModal));
        subMenu.appendChild(makeBtn(ICON_SETTINGS, 'Настройки API', openSettingsModal));

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
    // КОНТЕКСТ И ПОМОЩЬ
    // ============================================
    function showHelpModal() {
        const existing = document.getElementById('ar-help-modal');
        if (existing) existing.remove();

        const isDark = getTheme() === 'dark';
        const overlay = document.createElement('div');
        overlay.id = 'ar-help-modal';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:999999;display:flex;align-items:center;justify-content:center;';
        
        const modal = document.createElement('div');
        modal.style.cssText = `background:${isDark ? '#1e1e1e' : '#fff'};padding:24px;border-radius:16px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.4);`;
        
        modal.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h2 style="margin:0;color:${isDark ? '#fff' : '#1a1a1a'};font-size:20px;">Помощь — ChatGPT Auto Register</h2>
                <button id="ar-close-help" style="background:none;border:none;font-size:24px;cursor:pointer;color:${isDark ? '#999' : '#666'};padding:0 5px;">×</button>
            </div>
            <div style="color:${isDark ? '#ddd' : '#333'};line-height:1.6;font-size:14px;">
                <div style="margin-bottom:20px;">
                    <h3 style="margin:0 0 12px 0;color:${isDark ? '#fff' : '#1a1a1a'};font-size:16px;border-bottom:2px solid ${isDark ? '#333' : '#e0e0e0'};padding-bottom:8px;">⚙️ Настройка API</h3>
                    <p style="margin:0 0 12px 0;">1. Получите API ключ на <a href="https://agentmail.to" target="_blank" style="color:#10a37f;">agentmail.to</a></p>
                    <p style="margin:0 0 12px 0;">2. Откройте <b>Настройки API</b> в плавающем меню и вставьте ключ (начинается с <code>am_</code>).</p>
                    <p style="margin:0;">3. (Опционально) Добавьте ключ SimpleLogin для создания алиасов.</p>
                </div>
                <div>
                    <h3 style="margin:0 0 12px 0;color:${isDark ? '#fff' : '#1a1a1a'};font-size:16px;border-bottom:2px solid ${isDark ? '#333' : '#e0e0e0'};padding-bottom:8px;">🚀 Использование</h3>
                    <ul style="margin:0;padding-left:20px;">
                        <li style="margin-bottom:8px;">Нажмите <b>Начать регистрацию</b> в меню.</li>
                        <li>Скрипт автоматически создаст ящик, введёт email и извлечёт код из письма.</li>
                    </ul>
                </div>
            </div>
        `;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        document.getElementById('ar-close-help').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }

    function findChatMessages() {
        const selectors = ['[data-message-author-role]', '[data-testid^="conversation-turn-"]', '.message', 'div[class*="message"]', 'div[class*="markdown"]'];
        const messages = [];
        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) {
                els.forEach(el => {
                    const role = el.getAttribute('data-message-author-role') || (el.closest('[data-message-author-role]')?.getAttribute('data-message-author-role')) || 'unknown';
                    const text = el.innerText.trim();
                    if (text && text.length > 5) messages.push({ role, text });
                });
                break;
            }
        }
        return messages;
    }

    function findChatInput() {
        const selectors = ['textarea#prompt-textarea', 'textarea[placeholder*="Message"]', 'textarea[placeholder*="Спросите"]', 'textarea', 'div[contenteditable="true"]'];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) return el;
        }
        return null;
    }

    async function copyContext() {
        const messages = findChatMessages();
        if (messages.length === 0) { showNotification('Не найдено сообщений в чате', 'error', 5000); return; }
        const formatted = messages.map(m => `[${m.role === 'user' ? 'Пользователь' : m.role === 'assistant' ? 'Ассистент' : 'Неизвестно'}]: ${m.text}`).join('\n\n');
        savedContext = formatted;
        await saveData('savedContext', formatted);
        try {
            if (typeof GM_setClipboard !== 'undefined') GM_setClipboard(formatted, 'text');
            else await navigator.clipboard.writeText(formatted);
            showNotification(`Контекст скопирован (${messages.length} сообщ.)`, 'success', 4000);
        } catch (e) { showNotification('Ошибка копирования', 'error', 5000); }
    }

    async function pasteContext() {
        if (!savedContext) savedContext = await getData('savedContext');
        if (!savedContext) { showNotification('Сначала скопируйте контекст', 'warning', 5000); return; }
        const input = findChatInput();
        if (!input) { showNotification('Поле ввода не найдено', 'error', 5000); return; }
        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            await typeLikeHuman(input, savedContext);
        } else if (input.isContentEditable) {
            input.focus(); input.innerText = savedContext; input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        showNotification(`Контекст вставлен`, 'success', 4000);
    }

    // ============================================
    // ЭТАПЫ РЕГИСТРАЦИИ
    // ============================================
    async function stageLogin() {
        if (registrationComplete) return;
        
        showNotification('Создание временного ящика...', 'info', 3000);
        const inboxData = await createAgentMailInbox();
        if (!inboxData) {
            showNotification('Не удалось создать ящик. Проверьте API ключ.', 'error', 8000);
            return;
        }
        currentInboxId = inboxData.id;
        currentEmailAddress = inboxData.email;
        
        const slKey = await getData('simpleLoginApiKey');
        if (slKey) {
            showNotification('Создание алиаса SimpleLogin...', 'info', 3000);
            const aliasEmail = await createSimpleLoginAlias();
            if (aliasEmail) {
                currentEmailAddress = aliasEmail;
                showNotification(`Алиас создан: ${aliasEmail}`, 'success', 4000);
            }
        }

        codeRequestedAt = Date.now();
        usedMessageIds = new Set();
        await saveData('currentInboxId', currentInboxId);
        await saveData('currentEmailAddress', currentEmailAddress);
        await saveData('codeRequestedAt', codeRequestedAt);

        let input = null;
        for (let i = 0; i < 8 && !input; i++) {
            input = findEmailInput();
            if (!input) await new Promise(r => setTimeout(r, 300));
        }
        if (!input) { showNotification('Поле email не найдено', 'error'); return; }

        await typeLikeHuman(input, currentEmailAddress);
        showNotification(`Email введён: ${currentEmailAddress}`, 'success');
        await humanDelay(100, 300);
        await clickContinue();
    }

    async function stageVerify() {
        if (verifyCompleted || registrationComplete || isRunning) return;
        if (codeInserted) { verifyCompleted = true; await stageProfile(); return; }
        
        if (!currentInboxId) currentInboxId = await getData('currentInboxId');
        if (!currentInboxId) { showNotification('Нет активного inbox ID', 'error'); return; }

        for (let i = 0; i < CONFIG.maxAttempts; i++) {
            if (registrationComplete) return;
            const attempt = i + 1;
            if (attempt <= 3 || attempt % 10 === 0) showNotification(`Проверка почты #${attempt}/${CONFIG.maxAttempts}`, 'debug', 2000);
            
            const result = await findVerificationCode();
            if (result.found && result.code) {
                showNotification(`Код найден: ${result.code} (письму ${result.ageSec}с)`, 'success', 8000);
                if (await fillCode(result.code)) {
                    codeInserted = true; verifyCompleted = true;
                    usedMessageIds.add(result.messageId);
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
        setTimeout(() => { if (!registrationComplete) runStage(); }, 1000);
    }

    async function stageProfile() {
        if (registrationComplete) return;
        const fields = findProfileFields();
        if (!fields.nameInput || !fields.ageInput) { 
            setTimeout(() => { if (!registrationComplete) stageProfile(); }, 1000); 
            return; 
        }
        const name = generateUserData().firstName, age = generateAge();
        showNotification(`Заполнение профиля: ${name}, ${age}`, 'info');
        await typeLikeHuman(fields.nameInput, name);
        await humanDelay(200, 500);
        fillInput(fields.ageInput, String(age));
        await humanDelay(500, 1500);
        if (await clickContinue()) {
            registrationComplete = true;
            await saveData('registrationComplete', true);
            showNotification('Регистрация успешно завершена!', 'success', 8000);
        }
    }

    function detectStage() {
        if (window.location.hostname.includes('auth.openai.com')) {
            if (isOnProfilePage()) return 'profile';
            if (findCodeInputs()) return 'verify';
            if (findEmailInput()) return 'login';
        }
        if (window.location.hostname.includes('chatgpt.com') && isUserLoggedIn()) {
            return 'logged_in';
        }
        return 'unknown';
    }

    async function runStage() {
        if (isRunning || registrationComplete) return;
        isRunning = true;
        try {
            const stage = detectStage();
            if (stage === 'login') await stageLogin();
            else if (stage === 'verify') await stageVerify();
            else if (stage === 'profile') await stageProfile();
            else if (stage === 'logged_in') {
                showNotification('Вы уже авторизованы!', 'success', 5000);
                registrationComplete = true;
            } else {
                showNotification('Ожидание страницы входа...', 'info', 3000);
            }
        } catch (e) { 
            showNotification(`Ошибка: ${e.message}`, 'error'); 
            console.error(e);
        }
        isRunning = false;
    }

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    async function init() {
        registrationComplete = (await getData('registrationComplete')) === true;
        currentInboxId = await getData('currentInboxId');
        currentEmailAddress = await getData('currentEmailAddress');
        codeRequestedAt = await getData('codeRequestedAt');
        savedContext = await getData('savedContext');

        // Создаём плавающее меню (автоматический запуск отключён)
        createFloatingMenu();
        
        // Регистрируем команды в меню Tampermonkey
        GM_registerMenuCommand("🚀 Начать регистрацию", async () => {
            const action = await showRegistrationDialog();
            if (action === 'start') {
                isRunning = true;
                await runStage();
                isRunning = false;
            }
        });
        GM_registerMenuCommand("⚙️ Настройки API", openSettingsModal);
        GM_registerMenuCommand("❓ Помощь", showHelpModal);

        // Наблюдатель за изменением темы
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            createFloatingMenu(); // Пересоздаём меню для обновления цветов
        });

        // Если скрипт перезагружен на странице верификации, можно продолжить
        if (detectStage() === 'verify' && currentInboxId) {
            showNotification('Обнаружена страница верификации. Продолжаю...', 'info', 3000);
            setTimeout(() => {
                isRunning = true;
                runStage();
                isRunning = false;
            }, 1500);
        }
    }

    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();
