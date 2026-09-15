// ==UserScript==
// @name         ChatGPT Auto Register (AgentMail)
// @namespace    http://tampermonkey.net/
// @version      62.0
// @description  Авторегистрация ChatGPT через AgentMail.to + настройки + авто-тема
// @author       You
// @match        https://chatgpt.com/*
// @match        https://auth.openai.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_setClipboard
// @connect      api.agentmail.to
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ============================================
    // CONFIG
    // ============================================
    const CONFIG = {
        agentMailApiKey: '',            // заполняется через форму настроек
        agentMailBase: 'https://api.agentmail.to/v0',
        checkInterval: 3000,
        maxAttempts: 120,
        timeToleranceMs: 60000,
        fastMode: true,
    };

    let codeInserted = false, profileFilled = false, registrationComplete = false,
        isRunning = false, loginAttempted = false, verifyCompleted = false,
        initDone = false, currentInbox = null, pollingActive = false;

    let codeRequestedAt = null, usedMessageIds = new Set(), urlWatcher = null;
    let authObserver = null, helpModal = null, settingsModal = null;
    let savedContext = null;

    // ============================================
    // ТЕМА: CSS-переменные
    // ============================================
    function injectThemeStyles() {
        if (document.getElementById('gpt-auto-theme-styles')) return;
        const s = document.createElement('style');
        s.id = 'gpt-auto-theme-styles';
        s.textContent = `
            :root {
                --gpt-bg: #ffffff;
                --gpt-fg: #222222;
                --gpt-fg-muted: #999999;
                --gpt-border: #e0e0e0;
                --gpt-hover: #f5f5f5;
                --gpt-shadow: rgba(0,0,0,0.15);
                --gpt-overlay: rgba(0,0,0,0.7);
                --gpt-accent: #10a37f;
                --gpt-danger: #e74c3c;
            }
            @media (prefers-color-scheme: dark) {
                :root {
                    --gpt-bg: #1e1e1e;
                    --gpt-fg: #eeeeee;
                    --gpt-fg-muted: #777777;
                    --gpt-border: #444444;
                    --gpt-hover: #3a3a3a;
                    --gpt-shadow: rgba(0,0,0,0.5);
                    --gpt-overlay: rgba(0,0,0,0.75);
                }
            }
            html.dark {
                --gpt-bg: #1e1e1e;
                --gpt-fg: #eeeeee;
                --gpt-fg-muted: #777777;
                --gpt-border: #444444;
                --gpt-hover: #3a3a3a;
                --gpt-shadow: rgba(0,0,0,0.5);
                --gpt-overlay: rgba(0,0,0,0.75);
            }
            .gpt-input {
                width: 100%; padding: 10px 12px; border-radius: 8px;
                border: 1px solid var(--gpt-border);
                background: var(--gpt-hover); color: var(--gpt-fg);
                font-size: 14px; box-sizing: border-box;
                font-family: inherit;
            }
            .gpt-input:focus { outline: 2px solid var(--gpt-accent); outline-offset: -1px; }
            .gpt-label { display: block; margin-bottom: 6px; color: var(--gpt-fg); font-size: 13px; font-weight: 600; }
            .gpt-hint { color: var(--gpt-fg-muted); font-size: 12px; margin-top: 4px; line-height: 1.4; }
        `;
        document.head.appendChild(s);
    }

    // ============================================
    // БАЗОВЫЕ УТИЛИТЫ
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

    async function saveData(key, value) {
        try { await GM.setValue('chatgpt_helper_' + key, value); return true; } catch (e) { return false; }
    }
    async function getData(key) {
        try { return await GM.getValue('chatgpt_helper_' + key, null); } catch (e) { return null; }
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
        const colors = { info: '#3498db', success: '#10a37f', warning: '#f39c12', error: '#e74c3c', debug: '#7f8c8d' };
        const el = document.createElement('div');
        el.style.cssText = `background:var(--gpt-bg);color:var(--gpt-fg);padding:12px 16px;border-radius:12px;font-size:14px;box-shadow:0 4px 20px var(--gpt-shadow);border-left:4px solid ${colors[type] || '#333'};pointer-events:auto;display:flex;align-items:center;gap:10px;word-break:break-word;`;
        el.innerHTML = `<span>${text}</span>`;
        notificationContainer.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.4s'; setTimeout(() => { if (el.parentNode) el.remove(); }, 400); }, duration);
        console.log(`[${(type || 'info').toUpperCase()}] ${text}`);
        return el;
    }

    // ============================================
    // НАСТРОЙКИ (форма ввода ключей)
    // ============================================
    function showSettingsDialog(opts = {}) {
        return new Promise((resolve) => {
            if (settingsModal) settingsModal.remove();
            settingsModal = document.createElement('div');
            settingsModal.style.cssText = 'position:fixed;inset:0;background:var(--gpt-overlay);z-index:999999;display:flex;align-items:center;justify-content:center;';

            const dialog = document.createElement('div');
            dialog.style.cssText = `background:var(--gpt-bg);color:var(--gpt-fg);padding:24px;border-radius:16px;max-width:460px;width:90%;box-shadow:0 10px 40px var(--gpt-shadow);`;

            dialog.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <h2 style="margin:0;color:var(--gpt-fg);font-size:18px;">Настройки скрипта</h2>
                    <button id="closeSettings" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gpt-fg-muted);padding:0 5px;">×</button>
                </div>
                <p style="color:var(--gpt-fg-muted);font-size:12px;margin:0 0 20px 0;">
                    Ключи сохраняются в хранилище Tampermonkey и используются автоматически при следующих запусках.
                </p>

                <label class="gpt-label">AgentMail API Key <span style="color:var(--gpt-accent);">*</span></label>
                <input id="agentmail-input" class="gpt-input" type="password" placeholder="am_..." autocomplete="off">
                <p class="gpt-hint">Получить: console.agentmail.to → API Keys → Create New API Key</p>

                <div style="height:18px;"></div>

                <label class="gpt-label">SimpleLogin API Key <span style="color:var(--gpt-fg-muted);font-weight:400;">(опционально)</span></label>
                <input id="simplelogin-input" class="gpt-input" type="password" placeholder="sl_..." autocomplete="off">
                <p class="gpt-hint">Если оставить пустым — не используется.</p>

                <div style="height:22px;"></div>

                <div style="display:flex;flex-direction:column;gap:10px;">
                    <button id="saveSettings" style="padding:14px;background:var(--gpt-accent);color:white;border:none;border-radius:12px;font-size:15px;cursor:pointer;font-weight:600;">
                        Сохранить
                    </button>
                    <button id="clearSettings" style="padding:10px;background:transparent;color:var(--gpt-danger);border:1px solid var(--gpt-border);border-radius:10px;font-size:13px;cursor:pointer;">
                        Удалить сохранённые ключи
                    </button>
                    <button id="cancelSettings" style="padding:12px;background:transparent;color:var(--gpt-fg-muted);border:none;font-size:14px;cursor:pointer;">
                        Отмена
                    </button>
                </div>
            `;

            settingsModal.appendChild(dialog);
            document.body.appendChild(settingsModal);

            const agentInput = dialog.querySelector('#agentmail-input');
            const slInput = dialog.querySelector('#simplelogin-input');

            // Предзаполняем существующими значениями
            if (CONFIG.agentMailApiKey) agentInput.value = CONFIG.agentMailApiKey;

            const close = (result) => {
                settingsModal.remove();
                settingsModal = null;
                resolve(result);
            };

            dialog.querySelector('#closeSettings').onclick = () => close(null);
            dialog.querySelector('#cancelSettings').onclick = () => close(null);
            settingsModal.onclick = (e) => { if (e.target === settingsModal) close(null); };

            dialog.querySelector('#saveSettings').onclick = async () => {
                const agentMail = agentInput.value.trim();
                const simpleLogin = slInput.value.trim();

                if (!agentMail) {
                    showNotification('Укажите AgentMail API Key', 'error', 4000);
                    return;
                }
                if (!agentMail.startsWith('am_')) {
                    showNotification('AgentMail ключ обычно начинается с "am_"', 'warning', 5000);
                }

                await saveData('agentMailApiKey', agentMail);
                await saveData('simpleLoginApiKey', simpleLogin || null);

                CONFIG.agentMailApiKey = agentMail;

                showNotification('Настройки сохранены', 'success', 3000);
                close({ agentMail, simpleLogin });
            };

            dialog.querySelector('#clearSettings').onclick = async () => {
                await saveData('agentMailApiKey', null);
                await saveData('simpleLoginApiKey', null);
                CONFIG.agentMailApiKey = '';
                agentInput.value = '';
                slInput.value = '';
                showNotification('Ключи удалены', 'info', 3000);
            };

            setTimeout(() => agentInput.focus(), 100);
        });
    }

    async function ensureApiKeys() {
        const saved = await getData('agentMailApiKey');
        if (saved) {
            CONFIG.agentMailApiKey = saved;
            return true;
        }
        const result = await showSettingsDialog();
        if (!result) return false;
        return true;
    }

    // ============================================
    // AGENTMAIL: создание ящика
    // ============================================
    function createAgentMailInbox() {
        return new Promise((resolve) => {
            if (!CONFIG.agentMailApiKey) {
                showNotification('AgentMail: ключ не задан (откройте Настройки)', 'error', 10000);
                resolve(null); return;
            }
            GM_xmlhttpRequest({
                method: 'POST',
                url: `${CONFIG.agentMailBase}/inboxes`,
                headers: {
                    'Authorization': `Bearer ${CONFIG.agentMailApiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                data: JSON.stringify({ displayName: 'ChatGPT Auto' }),
                onload: (resp) => {
                    if (resp.status !== 200 && resp.status !== 201) {
                        showNotification(`AgentMail: ${resp.status} ${resp.responseText.slice(0, 150)}`, 'error', 12000);
                        resolve(null); return;
                    }
                    try {
                        const data = JSON.parse(resp.responseText);
                        resolve({
                            inboxId: data.inbox_id,
                            email: data.inbox_id || data.email || data.address
                        });
                    } catch (e) { resolve(null); }
                },
                onerror: () => { showNotification('AgentMail: сетевая ошибка', 'error'); resolve(null); },
                ontimeout: () => { showNotification('AgentMail: таймаут', 'error'); resolve(null); }
            });
        });
    }

    function listAgentMailMessages(inboxId) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${CONFIG.agentMailBase}/inboxes/${encodeURIComponent(inboxId)}/messages?limit=10`,
                headers: {
                    'Authorization': `Bearer ${CONFIG.agentMailApiKey}`,
                    'Accept': 'application/json'
                },
                onload: (resp) => {
                    if (resp.status !== 200) { resolve(null); return; }
                    try { resolve(JSON.parse(resp.responseText).messages || []); }
                    catch (e) { resolve(null); }
                },
                onerror: () => resolve(null),
                ontimeout: () => resolve(null)
            });
        });
    }

    function getAgentMailMessage(inboxId, messageId) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${CONFIG.agentMailBase}/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
                headers: {
                    'Authorization': `Bearer ${CONFIG.agentMailApiKey}`,
                    'Accept': 'application/json'
                },
                onload: (resp) => {
                    if (resp.status !== 200) { resolve(null); return; }
                    try { resolve(JSON.parse(resp.responseText)); }
                    catch (e) { resolve(null); }
                },
                onerror: () => resolve(null),
                ontimeout: () => resolve(null)
            });
        });
    }

    // ============================================
    // ИЗВЛЕЧЕНИЕ КОДА
    // ============================================
    function extractCode(emailData) {
        if (!emailData) return null;
        const raw = [
            emailData.extracted_text,
            emailData.extracted_html,
            emailData.text,
            emailData.html,
            emailData.subject
        ].filter(Boolean).join('\n')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;|&#160;/g, ' ');
        const glued = raw.replace(/(\d)[\s\u00a0]+(?=\d)/g, '$1');
        const m = glued.match(/(?:код|code|verification)[^\d\n]{0,40}(\d{6})/i) || glued.match(/\b(\d{6})\b/);
        if (m && !/^(19|20)\d{2}$/.test(m[1])) return m[1];
        return null;
    }

    const msgTime = (m) => new Date(m.timestamp || m.created_at || 0).getTime();
    function isFresh(msg) {
        if (!codeRequestedAt) return true;
        return msgTime(msg) >= codeRequestedAt - CONFIG.timeToleranceMs;
    }

    async function findVerificationCode() {
        if (!currentInbox || !currentInbox.inboxId) return { found: false, reason: 'no_inbox' };
        const messages = await listAgentMailMessages(currentInbox.inboxId);
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
    // ПРОВЕРКИ СОСТОЯНИЯ
    // ============================================
    function isUserLoggedIn() {
        if (document.querySelector('[data-testid="user-menu"], .user-menu')) return true;
        if (window.location.href.includes('/c/')) return true;
        return false;
    }

    function hasLoginButton() {
        return [...document.querySelectorAll('button, a, div[role="button"]')].some(b =>
            ['Войти', 'Sign in', 'Log in', 'Login'].includes(b.textContent.trim())
        );
    }

    function canShowContextMenu() {
        if (hasLoginButton()) return false;
        if (window.location.hostname.includes('auth.openai.com')) return false;
        if (findEmailInput()) return false;
        if (isUserLoggedIn()) return true;
        const hasNewChat = [...document.querySelectorAll('a, button')].some(el =>
            ['Новый чат', 'New chat'].includes(el.textContent.trim())
        );
        const hasPromptInput = document.querySelector('textarea[placeholder*="Спросите"], textarea[placeholder*="Message"]');
        return hasNewChat && hasPromptInput;
    }

    const isOnLoginPage = () => window.location.hostname.includes('auth.openai.com') || findEmailInput() !== null;
    const isOnProfilePage = () => { const f = findProfileFields(); return !!(f.nameInput && f.ageInput); };

    // ============================================
    // ДИАЛОГ ВЫБОРА
    // ============================================
    function showEmailChoiceDialog() {
        return new Promise(async (resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:var(--gpt-overlay);z-index:999999;display:flex;align-items:center;justify-content:center;';
            const dialog = document.createElement('div');
            dialog.style.cssText = `background:var(--gpt-bg);color:var(--gpt-fg);padding:28px;border-radius:20px;max-width:420px;width:90%;text-align:center;box-shadow:0 10px 40px var(--gpt-shadow);`;
            dialog.innerHTML = `
                <h2 style="margin:0 0 16px;color:var(--gpt-fg);">Регистрация ChatGPT</h2>
                <p style="color:var(--gpt-fg-muted);font-size:13px;margin-bottom:16px;">
                    Почта: <b>AgentMail.to</b>
                </p>
                <p style="color:var(--gpt-fg-muted);font-size:12px;" id="oldEmailDisplay"></p>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <button id="newEmailBtn" style="padding:14px;background:var(--gpt-accent);color:white;border:none;border-radius:12px;font-size:15px;cursor:pointer;">Создать новый inbox</button>
                    <button id="oldEmailBtn" style="padding:14px;background:var(--gpt-hover);color:var(--gpt-fg);border:1px solid var(--gpt-border);border-radius:12px;font-size:15px;cursor:pointer;display:none;">Продолжить прошлый</button>
                    <button id="cancelBtn" style="padding:12px;background:transparent;color:var(--gpt-fg-muted);border:none;font-size:14px;cursor:pointer;">Отмена</button>
                </div>`;
            overlay.appendChild(dialog); document.body.appendChild(overlay);
            const oldInbox = await getData('currentInbox');
            dialog.querySelector('#oldEmailDisplay').textContent = oldInbox ? `📧 ${oldInbox.email}` : '';
            if (oldInbox) dialog.querySelector('#oldEmailBtn').style.display = 'block';
            dialog.querySelector('#newEmailBtn').onclick = async () => { overlay.remove(); await saveData('currentInbox', null); resolve('new'); };
            dialog.querySelector('#oldEmailBtn').onclick = () => { overlay.remove(); resolve('old'); };
            dialog.querySelector('#cancelBtn').onclick = () => { overlay.remove(); resolve('cancel'); };
            overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve('cancel'); } };
        });
    }

    // ============================================
    // МОДАЛКА ПОМОЩИ
    // ============================================
    function showHelpModal() {
        if (helpModal) helpModal.remove();
        helpModal = document.createElement('div');
        helpModal.style.cssText = 'position:fixed;inset:0;background:var(--gpt-overlay);z-index:999999;display:flex;align-items:center;justify-content:center;';

        const modal = document.createElement('div');
        modal.style.cssText = `background:var(--gpt-bg);color:var(--gpt-fg);padding:24px;border-radius:16px;max-width:620px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 10px 40px var(--gpt-shadow);`;

        modal.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h2 style="margin:0;color:var(--gpt-fg);font-size:20px;">Помощь — ChatGPT Auto Register</h2>
                <button id="closeHelp" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--gpt-fg-muted);padding:0 5px;">×</button>
            </div>

            <div style="color:var(--gpt-fg);line-height:1.6;font-size:14px;">

                <div style="margin-bottom:22px;">
                    <h3 style="margin:0 0 12px 0;color:var(--gpt-fg);font-size:16px;border-bottom:2px solid var(--gpt-border);padding-bottom:8px;">🔑 Шаг 1. Настройка ключа</h3>
                    <ol style="margin:0;padding-left:20px;">
                        <li style="margin-bottom:6px;">Откройте <b>console.agentmail.to</b> и войдите в аккаунт.</li>
                        <li style="margin-bottom:6px;">Перейдите в <b>API Keys</b> → <b>Create New API Key</b>.</li>
                        <li style="margin-bottom:6px;">Скопируйте ключ (начинается с <code>am_</code>).</li>
                        <li>В скрипте нажмите <b>☰ → Настройки</b> и вставьте ключ. Нажмите <b>Сохранить</b>.</li>
                    </ol>
                    <p style="margin:10px 0 0 0;color:var(--gpt-fg-muted);font-size:13px;">
                        Ключ сохраняется один раз и используется автоматически при следующих запусках.
                    </p>
                </div>

                <div style="margin-bottom:22px;">
                    <h3 style="margin:0 0 12px 0;color:var(--gpt-fg);font-size:16px;border-bottom:2px solid var(--gpt-border);padding-bottom:8px;">🚀 Шаг 2. Регистрация</h3>
                    <ol style="margin:0;padding-left:20px;">
                        <li style="margin-bottom:6px;">Откройте <b>chatgpt.com</b>. Убедитесь, что вы <b>не авторизованы</b>.</li>
                        <li style="margin-bottom:6px;">Нажмите кнопку <b>⚡ Регистрация</b> в левом верхнем углу.</li>
                        <li style="margin-bottom:6px;">В диалоге выберите <b>«Создать новый inbox»</b>.</li>
                        <li style="margin-bottom:6px;">Скрипт сам: создаст ящик AgentMail → введёт email → дождётся письма → подставит код → заполнит профиль.</li>
                        <li>Дождитесь сообщения <b>«Регистрация завершена!»</b>.</li>
                    </ol>
                </div>

                <div style="margin-bottom:22px;">
                    <h3 style="margin:0 0 12px 0;color:var(--gpt-fg);font-size:16px;border-bottom:2px solid var(--gpt-border);padding-bottom:8px;">📋 Шаг 3. Перенос контекста чата</h3>
                    <ol style="margin:0;padding-left:20px;">
                        <li style="margin-bottom:6px;">В старом аккаунте нажмите <b>☰ → Копировать контекст</b>.</li>
                        <li style="margin-bottom:6px;">Выйдите из аккаунта (Avatar → Log out).</li>
                        <li style="margin-bottom:6px;">Зарегистрируйте новый аккаунт через <b>⚡ Регистрация</b>.</li>
                        <li>В новом чате нажмите <b>☰ → Вставить контекст</b>.</li>
                    </ol>
                </div>

                <div>
                    <h3 style="margin:0 0 12px 0;color:var(--gpt-fg);font-size:16px;border-bottom:2px solid var(--gpt-border);padding-bottom:8px;">⚙️ Управление ключами</h3>
                    <ul style="margin:0;padding-left:20px;">
                        <li style="margin-bottom:6px;"><b>Изменить ключ:</b> ☰ → Настройки → введите новый → Сохранить.</li>
                        <li style="margin-bottom:6px;"><b>Удалить ключ:</b> ☰ → Настройки → «Удалить сохранённые ключи».</li>
                        <li><b>Или вручную:</b> Tampermonkey Dashboard → ваш скрипт → Storage → удалить <code>chatgpt_helper_agentMailApiKey</code>.</li>
                    </ul>
                </div>

            </div>
        `;
        helpModal.appendChild(modal);
        document.body.appendChild(helpModal);
        modal.querySelector('#closeHelp').onclick = () => { helpModal.remove(); helpModal = null; };
        helpModal.onclick = (e) => { if (e.target === helpModal) { helpModal.remove(); helpModal = null; } };
    }

    // ============================================
    // КОНТЕКСТНОЕ МЕНЮ
    // ============================================
    let contextMenuWrapper = null;
    let contextMenuPanel = null;
    let menuVisible = false;

    const ICON_HAMBURGER = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
    const ICON_COPY = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const ICON_PASTE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`;
    const ICON_SETTINGS = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    const ICON_HELP = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

    function findChatMessages() {
        const selectors = ['[data-message-author-role]', '[data-testid^="conversation-turn-"]', '.message', 'div[class*="message"]', 'div[class*="markdown"]'];
        const messages = [];
        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) {
                els.forEach(el => {
                    const role = el.getAttribute('data-message-author-role') ||
                                (el.closest('[data-message-author-role]')?.getAttribute('data-message-author-role')) ||
                                (el.textContent.trim().length > 10 ? 'unknown' : null);
                    const text = el.innerText.trim();
                    if (text && text.length > 5) messages.push({ role: role || 'unknown', text });
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
        if (messages.length === 0) { showNotification('Не найдено сообщений в чате', 'error', 5000); return; }
        const formatted = messages.map(m => `[${m.role === 'user' ? 'Пользователь' : m.role === 'assistant' ? 'Ассистент' : 'Неизвестно'}]: ${m.text}`).join('\n\n');
        savedContext = formatted;
        await saveData('savedContext', formatted);
        try {
            if (typeof GM_setClipboard !== 'undefined') GM_setClipboard(formatted, 'text');
            else await navigator.clipboard.writeText(formatted);
            showNotification(`Контекст скопирован (${messages.length} сообщ., ${formatted.length} симв.)`, 'success', 4000);
        } catch (e) { showNotification('Ошибка копирования', 'error', 5000); }
        closeContextMenu();
    }

    async function pasteContext() {
        if (!savedContext) savedContext = await getData('savedContext');
        if (!savedContext) { showNotification('Сначала скопируйте контекст', 'warning', 5000); return; }
        const input = findChatInput();
        if (!input) { showNotification('Поле ввода не найдено', 'error', 5000); return; }
        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') await typeLikeHuman(input, savedContext);
        else if (input.isContentEditable) {
            input.focus(); input.innerText = savedContext;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        showNotification(`Контекст вставлен (${savedContext.length} симв.)`, 'success', 4000);
        closeContextMenu();
    }

    function closeContextMenu() {
        if (contextMenuPanel) contextMenuPanel.style.display = 'none';
        menuVisible = false;
    }
    function toggleContextMenu() {
        if (!contextMenuPanel) return;
        menuVisible = !menuVisible;
        contextMenuPanel.style.display = menuVisible ? 'flex' : 'none';
    }

    function createContextMenu() {
        if (contextMenuWrapper) contextMenuWrapper.remove();
        contextMenuWrapper = null; contextMenuPanel = null; menuVisible = false;
        if (!canShowContextMenu()) return;

        contextMenuWrapper = document.createElement('div');
        contextMenuWrapper.style.cssText = `position:fixed;top:50px;right:20px;z-index:99999;display:flex;flex-direction:column;align-items:flex-end;gap:8px;`;

        const trigger = document.createElement('button');
        trigger.innerHTML = ICON_HAMBURGER;
        trigger.title = 'Менеджер контекста';
        trigger.style.cssText = `width:44px;height:44px;border-radius:12px;background:var(--gpt-bg);color:var(--gpt-fg);border:1px solid var(--gpt-border);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px var(--gpt-shadow);transition:background 0.2s;`;
        trigger.addEventListener('mouseenter', () => { trigger.style.background = 'var(--gpt-hover)'; });
        trigger.addEventListener('mouseleave', () => { trigger.style.background = 'var(--gpt-bg)'; });

        contextMenuPanel = document.createElement('div');
        contextMenuPanel.style.cssText = `display:none;flex-direction:column;gap:6px;background:var(--gpt-bg);padding:10px;border-radius:12px;box-shadow:0 4px 20px var(--gpt-shadow);border:1px solid var(--gpt-border);min-width:230px;`;

        const makeBtn = (icon, text, onClick) => {
            const b = document.createElement('button');
            b.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-right:8px;">${icon}</span><span>${text}</span>`;
            b.style.cssText = `display:flex;align-items:center;padding:10px 12px;background:transparent;color:var(--gpt-fg);border:1px solid var(--gpt-border);border-radius:8px;font-size:13px;cursor:pointer;font-weight:500;text-align:left;transition:background 0.2s;`;
            b.addEventListener('mouseenter', () => { b.style.background = 'var(--gpt-hover)'; });
            b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
            b.onclick = (e) => { e.stopPropagation(); onClick(); };
            return b;
        };

        contextMenuPanel.appendChild(makeBtn(ICON_COPY, 'Копировать контекст', copyContext));
        contextMenuPanel.appendChild(makeBtn(ICON_PASTE, 'Вставить контекст', pasteContext));
        contextMenuPanel.appendChild(makeBtn(ICON_SETTINGS, 'Настройки', () => { closeContextMenu(); showSettingsDialog(); }));
        contextMenuPanel.appendChild(makeBtn(ICON_HELP, 'Помощь', () => { closeContextMenu(); showHelpModal(); }));

        trigger.onclick = (e) => { e.stopPropagation(); toggleContextMenu(); };
        contextMenuWrapper.appendChild(trigger);
        contextMenuWrapper.appendChild(contextMenuPanel);
        document.body.appendChild(contextMenuWrapper);

        setTimeout(() => {
            document.addEventListener('click', (e) => {
                if (contextMenuWrapper && !contextMenuWrapper.contains(e.target)) closeContextMenu();
            });
        }, 100);
    }

    // ============================================
    // КНОПКА ЗАПУСКА РЕГИСТРАЦИИ
    // ============================================
    let regButton = null;

    function createRegisterButton() {
        if (regButton) return;
        if (!window.location.hostname.includes('chatgpt.com') && !window.location.hostname.includes('auth.openai.com')) return;

        regButton = document.createElement('button');
        regButton.id = 'gpt-auto-register-btn';
        regButton.title = 'Запустить регистрацию ChatGPT';
        regButton.innerHTML = `
            <span style="display:inline-flex;align-items:center;gap:6px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
                <span id="gpt-auto-register-label" style="font-weight:600;">Регистрация</span>
            </span>`;
        regButton.style.cssText = `
            position:fixed; top:8px; left:8px; z-index:99998;
            height:36px; padding:0 14px; border-radius:10px;
            background:var(--gpt-bg); color:var(--gpt-fg);
            border:1px solid var(--gpt-border);
            cursor:pointer; font-size:13px; font-family:inherit;
            display:flex; align-items:center; justify-content:center;
            box-shadow:0 2px 10px var(--gpt-shadow);
            transition:background 0.15s, transform 0.1s;
            opacity:0.95;
        `;
        regButton.addEventListener('mouseenter', () => { regButton.style.background = 'var(--gpt-hover)'; });
        regButton.addEventListener('mouseleave', () => { regButton.style.background = 'var(--gpt-bg)'; });
        regButton.addEventListener('mousedown', () => { regButton.style.transform = 'scale(0.97)'; });
        regButton.addEventListener('mouseup', () => { regButton.style.transform = 'scale(1)'; });

        regButton.onclick = (e) => {
            e.stopPropagation();
            startRegistrationManual();
        };
        document.body.appendChild(regButton);
    }

    function setRegisterButtonLabel(text, state = 'idle') {
        if (!regButton) return;
        const label = regButton.querySelector('#gpt-auto-register-label');
        if (label) label.textContent = text;
        const colors = { idle: 'var(--gpt-fg)', running: '#10a37f', error: '#e74c3c' };
        regButton.style.color = colors[state] || colors.idle;
    }

    async function startRegistrationManual() {
        if (isRunning || registrationComplete) {
            if (registrationComplete) showNotification('Регистрация уже завершена', 'info', 3000);
            return;
        }

        // Проверяем ключи перед запуском
        const hasKeys = await ensureApiKeys();
        if (!hasKeys) {
            showNotification('Настройка отменена', 'warning', 4000);
            return;
        }

        setRegisterButtonLabel('Запуск…', 'running');
        try {
            loginAttempted = false; verifyCompleted = false; codeInserted = false;
            await runStage();
        } finally {
            setTimeout(() => setRegisterButtonLabel('Регистрация', 'idle'), 1500);
        }
    }

    // ============================================
    // НАБЛЮДАТЕЛИ
    // ============================================
    function startAuthObserver() {
        if (authObserver) authObserver.disconnect();
        if (canShowContextMenu()) { createContextMenu(); return; }
        authObserver = new MutationObserver(() => {
            if (canShowContextMenu()) {
                createContextMenu();
                authObserver.disconnect();
                authObserver = null;
            }
        });
        authObserver.observe(document.body, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-testid']
        });
        setTimeout(() => { if (authObserver) { authObserver.disconnect(); authObserver = null; } }, 15000);
    }

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
                const t = b.textContent.trim();
                if (['Войти', 'Sign in', 'Log in', 'Login'].includes(t)) { btn = b; break; }
            }
            if (!btn) await new Promise(r => setTimeout(r, 300));
        }
        if (btn) {
            await humanClick(btn);
            startUrlWatcher(() => {
                loginAttempted = false;
                if (!registrationComplete) runStage();
            }, 10000);
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
            setRegisterButtonLabel('Создаю inbox…', 'running');
            showNotification('AgentMail: создаю inbox…', 'info', 4000);
            const inbox = await createAgentMailInbox();
            if (!inbox) { setRegisterButtonLabel('Регистрация', 'error'); return; }
            currentInbox = inbox;
            emailToUse = inbox.email;
            codeRequestedAt = Date.now();
            usedMessageIds = new Set();
            await saveData('usedMessageIds', []);
            await saveData('codeRequestedAt', codeRequestedAt);
            await saveData('currentInbox', inbox);
            showNotification(`Inbox: ${emailToUse}`, 'success', 6000);
        } else {
            const saved = await getData('currentInbox');
            if (!saved) { showNotification('Нет сохранённого inbox', 'error'); return; }
            currentInbox = saved;
            emailToUse = saved.email;
            codeRequestedAt = await getData('codeRequestedAt');
        }

        let input = null;
        for (let i = 0; i < 8 && !input; i++) {
            input = findEmailInput();
            if (!input) await new Promise(r => setTimeout(r, 300));
        }
        if (!input) { showNotification('Поле email не найдено', 'error'); return; }

        await typeLikeHuman(input, emailToUse);
        await humanDelay(100, 300);
        await clickContinue();

        startUrlWatcher(() => { if (!registrationComplete) runStage(); }, 12000);
    }

    async function watchCodeResult() {
        const start = Date.now();
        while (Date.now() - start < 60000) {
            await new Promise(r => setTimeout(r, 3000));
            if (registrationComplete) return;
            if (!findCodeInputs()) return;
        }
        showNotification('Код не подошёл. Нажмите «Resend code» — поймаю новое письмо.', 'warning', 12000);
        codeInserted = false; verifyCompleted = false;
        setTimeout(runStage, 1000);
    }

    async function stageVerify() {
        if (verifyCompleted || registrationComplete || pollingActive) return;
        if (codeInserted) { verifyCompleted = true; await stageProfile(); return; }
        pollingActive = true;
        if (codeRequestedAt == null) codeRequestedAt = await getData('codeRequestedAt');
        if (!currentInbox) currentInbox = await getData('currentInbox');
        if (!currentInbox || !currentInbox.inboxId) {
            showNotification('Нет inbox для проверки', 'error'); pollingActive = false; return;
        }

        for (let i = 0; i < CONFIG.maxAttempts; i++) {
            const attempt = i + 1;
            if (attempt <= 3 || attempt % 10 === 0)
                setRegisterButtonLabel(`Проверка #${attempt}`, 'running');
            const result = await findVerificationCode();
            if (result.found && result.code) {
                showNotification(`Код: ${result.code} (письму ${result.ageSec}с)`, 'success', 8000);
                setRegisterButtonLabel('Ввожу код…', 'running');
                if (await fillCode(result.code)) {
                    codeInserted = true; verifyCompleted = true;
                    usedMessageIds.add(result.messageId);
                    await saveData('usedMessageIds', [...usedMessageIds]);
                    await humanDelay(200, 500); await clickContinue();
                    watchCodeResult();
                    break;
                } else {
                    showNotification(`Код: ${result.code} (введите вручную)`, 'info', 10000);
                    pollingActive = false; return;
                }
            }
            if (result.reason === 'waiting_new_email' && (attempt === 1 || attempt % 6 === 0))
                showNotification(`Ждём письмо (старых: ${result.count})`, 'info', 2000);
            else if (result.reason === 'api_error' && attempt === 2)
                showNotification('Ошибка API AgentMail', 'error', 6000);
            else if (result.reason === 'no_messages' && attempt === 5)
                showNotification('Inbox пуст', 'warning', 5000);
            await new Promise(r => setTimeout(r, CONFIG.checkInterval));
        }
        pollingActive = false;
        setTimeout(() => { if (!registrationComplete) runStage(); }, 1000);
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
            showNotification('Регистрация завершена!', 'success', 8000);
            setRegisterButtonLabel('Готово', 'running');
            stopUrlWatcher();
            if (window.urlCheckInterval) { clearInterval(window.urlCheckInterval); window.urlCheckInterval = null; }
        }
    }

    function detectStage() {
        if (hasLoginButton() && window.location.hostname.includes('chatgpt.com')) return 'main';
        if (window.location.hostname.includes('auth.openai.com')) {
            if (isOnProfilePage()) return 'profile';
            if (findCodeInputs()) return 'verify';
            if (findEmailInput()) return 'login';
        }
        if (window.location.hostname.includes('chatgpt.com') && isUserLoggedIn()) return 'unknown';
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
            else if (stage === 'profile') await stageProfile();
        } catch (e) { showNotification(`Ошибка: ${e.message}`, 'error'); }
        isRunning = false;
    }

    // ============================================
    // INIT
    // ============================================
    async function init() {
        if (initDone) return;
        initDone = true;
        injectThemeStyles();

        // Загружаем сохранённый ключ
        const savedKey = await getData('agentMailApiKey');
        if (savedKey) CONFIG.agentMailApiKey = savedKey;

        codeRequestedAt = await getData('codeRequestedAt');
        ((await getData('usedMessageIds')) || []).forEach(id => usedMessageIds.add(id));
        savedContext = await getData('savedContext');
        currentInbox = await getData('currentInbox');

        if (await getData('complete') && isUserLoggedIn()) registrationComplete = true;

        startAuthObserver();
        createRegisterButton();

        let lastUrl = window.location.href;
        window.urlCheckInterval = setInterval(() => {
            if (window.location.href !== lastUrl) {
                lastUrl = window.location.href;
                startAuthObserver();
            }
        }, 1000);
    }

    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();
