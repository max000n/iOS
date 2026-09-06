// ==UserScript==
// @name         ChatGPT Auto Register v59 (Help Menu)
// @namespace    http://tampermonkey.net/
// @version      59.0
// @description  Авторегистрация ChatGPT + контекст + справка
// @author       You
// @match        https://chatgpt.com/*
// @match        https://auth.openai.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_setClipboard
// @connect      api.mail.tm
// @connect      mail.tm
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        gmailAddress: 'wotblitzmaxon@gmail.com',
        forwardEmail: 'max@uberip.com',
        forwardPassword: '440884',
        mailApi: 'https://api.mail.tm',
        checkInterval: 3000,
        maxAttempts: 120,
        timeToleranceMs: 60000,
        fastMode: true,
    };

    let codeInserted = false, profileFilled = false, registrationComplete = false,
        isRunning = false, loginAttempted = false, verifyCompleted = false,
        initDone = false, currentGmailAlias = null, mailTmToken = null, pollingActive = false;

    let codeRequestedAt = null, usedMessageIds = new Set(), serverTimeOffset = 0, urlWatcher = null;
    let authObserver = null, helpModal = null;

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

    async function clearAllData() {
        for (const k of ['tempEmail', 'tempToken', 'gmailAlias', 'complete', 'codeRequestedAt', 'usedMsgIds', 'savedContext']) {
            await GM.setValue('chatgpt_helper_' + k, null);
        }
        codeInserted = profileFilled = registrationComplete = verifyCompleted = loginAttempted = false;
        currentGmailAlias = null; mailTmToken = null;
        usedMessageIds = new Set(); codeRequestedAt = null; savedContext = null;
        showNotification('Данные очищены. Обновите страницу.', 'info');
        setTimeout(() => window.location.reload(), 1000);
    }

    // ============================================
    // УВЕДОМЛЕНИЯ
    // ============================================
    let notificationContainer = null;
    const getTheme = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

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
        console.log(`[${(type || 'info').toUpperCase()}] ${text}`);
        return el;
    }

    // ============================================
    // GMAIL АЛИАС
    // ============================================
    function generateGmailAlias() {
        const tag = 'gpt_' + Math.random().toString(36).substring(2, 8);
        const alias = CONFIG.gmailAddress.replace('@', '+' + tag + '@');
        return { alias, tag };
    }

    // ============================================
    // ПОЧТА
    // ============================================
    function apiRequest(method, url, token, data) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method, url,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/ld+json, application/json, */*',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                data: data ? JSON.stringify(data) : null,
                onload: (resp) => {
                    try {
                        const m = (resp.responseHeaders || '').match(/^Date:\s*(.+)$/im);
                        if (m) serverTimeOffset = Date.parse(m[1].trim()) - Date.now();
                    } catch (e) {}
                    resolve(resp);
                },
                onerror: (e) => resolve({ status: 0, responseText: '', error: e }),
                ontimeout: () => resolve({ status: 0, responseText: 'timeout' })
            });
        });
    }

    async function authenticateMailTm(force = false) {
        if (mailTmToken && !force) return mailTmToken;
        if (CONFIG.forwardEmail.includes('yourname') || CONFIG.forwardPassword.includes('YourPassword')) {
            showNotification('CONFIG не заполнен', 'error', 10000);
            return null;
        }
        const resp = await apiRequest('POST', `${CONFIG.mailApi}/token`, null, {
            address: CONFIG.forwardEmail, password: CONFIG.forwardPassword
        });
        if (resp.status !== 200) {
            showNotification(`Mail.tm: /token → ${resp.status}`, 'error', 12000);
            return null;
        }
        try { mailTmToken = JSON.parse(resp.responseText).token; } catch (e) { return null; }
        return mailTmToken;
    }

    async function getAllMessages() {
        let token = await authenticateMailTm();
        if (!token) return null;
        let resp = await apiRequest('GET', `${CONFIG.mailApi}/messages?page=1`, token);
        if (resp.status === 401) {
            mailTmToken = null; token = await authenticateMailTm(true);
            if (!token) return null;
            resp = await apiRequest('GET', `${CONFIG.mailApi}/messages?page=1`, token);
        }
        if (resp.status !== 200) return null;
        let data = {};
        try { data = JSON.parse(resp.responseText); } catch (e) { return null; }
        return data['hydra:member'] || data.member || (Array.isArray(data) ? data : []);
    }

    async function getFullMessage(id) {
        const token = await authenticateMailTm();
        if (!token) return null;
        const resp = await apiRequest('GET', `${CONFIG.mailApi}/messages/${id}`, token);
        if (resp.status !== 200) return null;
        try { return JSON.parse(resp.responseText); } catch (e) { return null; }
    }

    function extractCode(emailData) {
        if (!emailData) return null;
        const raw = [emailData.text, emailData.html, emailData.subject].filter(Boolean).join('\n')
            .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ');
        const glued = raw.replace(/(\d)[\s\u00a0]+(?=\d)/g, '$1');
        const m = glued.match(/(?:код|code|verification)[^\d\n]{0,40}(\d{6})/i) || glued.match(/\b(\d{6})\b/);
        if (m && !/^(19|20)\d{2}$/.test(m[1])) return m[1];
        return null;
    }

    const msgTime = (m) => new Date(m.createdAt || m.updatedAt || 0).getTime();
    const msgTimeLocal = (m) => msgTime(m) - serverTimeOffset;
    function isFresh(msg) {
        if (!codeRequestedAt) return true;
        return msgTimeLocal(msg) >= codeRequestedAt - CONFIG.timeToleranceMs;
    }

    async function findVerificationCode() {
        const messages = await getAllMessages();
        if (!messages) return { found: false, reason: 'api_error' };
        if (!messages.length) return { found: false, reason: 'no_messages' };

        messages.sort((a, b) => msgTime(b) - msgTime(a));
        const fresh = messages.filter(isFresh);
        if (!fresh.length) return { found: false, reason: 'waiting_new_email', count: messages.length };

        for (const msg of fresh) {
            if (usedMessageIds.has(msg.id)) continue;
            const full = (await getFullMessage(msg.id)) || msg;
            const code = extractCode(full);
            if (code) return {
                found: true, code, messageId: msg.id,
                ageSec: Math.max(0, Math.round((Date.now() - msgTimeLocal(msg)) / 1000))
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
    async function clickLogin() {
        for (const b of document.querySelectorAll('button, a, div[role="button"]')) {
            const t = b.textContent.trim();
            if (['Войти', 'Sign in', 'Log in', 'Login'].includes(t)) return await humanClick(b);
        }
        return false;
    }

    // ============================================
    // РАЗДЕЛЁННАЯ ПРОВЕРКА АВТОРИЗАЦИИ
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

    function showEmailChoiceDialog() {
        return new Promise(async (resolve) => {
            const isDark = getTheme() === 'dark';
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:999999;display:flex;align-items:center;justify-content:center;';
            const dialog = document.createElement('div');
            dialog.style.cssText = `background:${isDark ? '#1e1e1e' : '#fff'};padding:28px;border-radius:20px;max-width:400px;width:90%;text-align:center;`;
            dialog.innerHTML = `
                <h2 style="margin:0 0 16px;color:${isDark ? '#fff' : '#1a1a1a'};">Gmail + автопересылка</h2>
                <p style="color:${isDark ? '#777' : '#999'};font-size:13px;margin-bottom:16px;">📧 Gmail: <b>${CONFIG.gmailAddress}</b><br>Пересылка: <b>${CONFIG.forwardEmail}</b></p>
                <p style="color:${isDark ? '#777' : '#999'};" id="oldEmailDisplay"></p>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <button id="newEmailBtn" style="padding:14px;background:#10a37f;color:white;border:none;border-radius:12px;font-size:15px;cursor:pointer;">Новая регистрация</button>
                    <button id="oldEmailBtn" style="padding:14px;background:${isDark ? '#2d2d2d' : '#f0f0f0'};color:${isDark ? '#eee' : '#222'};border:1px solid ${isDark ? '#444' : '#ddd'};border-radius:12px;font-size:15px;cursor:pointer;display:none;">Продолжить старую</button>
                    <button id="cancelBtn" style="padding:12px;background:transparent;color:${isDark ? '#666' : '#999'};border:none;font-size:14px;cursor:pointer;">Отмена</button>
                </div>`;
            overlay.appendChild(dialog); document.body.appendChild(overlay);
            const oldAlias = await getData('gmailAlias');
            dialog.querySelector('#oldEmailDisplay').textContent = oldAlias ? `📧 ${oldAlias}` : 'Нет сохранённой регистрации';
            if (oldAlias) dialog.querySelector('#oldEmailBtn').style.display = 'block';
            dialog.querySelector('#newEmailBtn').onclick = async () => { overlay.remove(); await GM.setValue('chatgpt_helper_gmailAlias', null); resolve('new'); };
            dialog.querySelector('#oldEmailBtn').onclick = () => { overlay.remove(); resolve('old'); };
            dialog.querySelector('#cancelBtn').onclick = () => { overlay.remove(); resolve('cancel'); };
            overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve('cancel'); } };
        });
    }

    // ============================================
    // МОДАЛЬНОЕ ОКНО ПОМОЩИ
    // ============================================
    function showHelpModal() {
        if (helpModal) helpModal.remove();
        
        const isDark = getTheme() === 'dark';
        helpModal = document.createElement('div');
        helpModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:999999;display:flex;align-items:center;justify-content:center;';
        
        const modal = document.createElement('div');
        modal.style.cssText = `background:${isDark ? '#1e1e1e' : '#fff'};padding:24px;border-radius:16px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.4);`;
        
        modal.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h2 style="margin:0;color:${isDark ? '#fff' : '#1a1a1a'};font-size:20px;"> Помощь — ChatGPT Auto Register</h2>
                <button id="closeHelp" style="background:none;border:none;font-size:24px;cursor:pointer;color:${isDark ? '#999' : '#666'};padding:0 5px;">×</button>
            </div>
            
            <div style="color:${isDark ? '#ddd' : '#333'};line-height:1.6;font-size:14px;">
                <div style="margin-bottom:20px;">
                    <h3 style="margin:0 0 12px 0;color:${isDark ? '#fff' : '#1a1a1a'};font-size:16px;border-bottom:2px solid ${isDark ? '#333' : '#e0e0e0'};padding-bottom:8px;">⚙️ Настройка</h3>
                    <p style="margin:0 0 12px 0;"><b>Заполните CONFIG:</b></p>
                    <div style="background:${isDark ? '#2d2d2d' : '#f5f5f5'};padding:12px;border-radius:8px;font-family:monospace;font-size:13px;margin-bottom:16px;">
                        gmailAddress: 'ваш@gmail.com',<br>
                        forwardEmail: 'ваш@mail.tm',<br>
                        forwardPassword: 'пароль'
                    </div>
                </div>
                
                <div style="margin-bottom:20px;">
                    <h3 style="margin:0 0 12px 0;color:${isDark ? '#fff' : '#1a1a1a'};font-size:16px;border-bottom:2px solid ${isDark ? '#333' : '#e0e0e0'};padding-bottom:8px;">📧 Пересылка Gmail</h3>
                    <ol style="margin:0;padding-left:20px;">
                        <li style="margin-bottom:8px;">Зайти на сайт Gmail → ⚙️ Настройки → «Все настройки» → «Пересылка и POP/IMAP» → «Добавить адрес» → введите ваш адрес <b>mail.tm</b> → подтвердите код из письма.</li>
                        <li><b>Фильтр:</b> Gmail → ️ → «Фильтры и заблокированные адреса» → «Создать» → В поле <b>«От кого»</b>:<br>
                            <div style="background:${isDark ? '#2d2d2d' : '#f5f5f5'};padding:8px;border-radius:6px;font-family:monospace;font-size:12px;margin:8px 0;">
                                @openai.com OR @chatgpt.com OR no-reply@openai.com
                            </div>
                            → «Создать фильтр» → ✅ <b>«Никогда не отправлять в спам»</b>.
                        </li>
                    </ol>
                </div>
                
                <div>
                    <h3 style="margin:0 0 12px 0;color:${isDark ? '#fff' : '#1a1a1a'};font-size:16px;border-bottom:2px solid ${isDark ? '#333' : '#e0e0e0'};padding-bottom:8px;">🚀 Использование</h3>
                    <ul style="margin:0;padding-left:20px;">
                        <li style="margin-bottom:8px;"><b>Регистрация:</b> На chatgpt.com → выберите «Новая регистрация». Скрипт сам введёт email, заберёт код из почты и заполнит профиль.</li>
                        <li><b>Перенос чата:</b> Нажмите 📋 «Копировать контекст» → выйдите из аккаунта → зарегистрируйте новый → нажмите 📋 «Вставить контекст».</li>
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
    // МЕНЕДЖЕР КОНТЕКСТА
    // ============================================
    let contextMenuWrapper = null;
    let contextMenuPanel = null;
    let savedContext = null;
    let menuVisible = false;

    const ICON_HAMBURGER = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
    const ICON_COPY = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const ICON_PASTE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`;
    const ICON_HELP = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

    function findChatMessages() {
        const selectors = [
            '[data-message-author-role]',
            '[data-testid^="conversation-turn-"]',
            '.message',
            'div[class*="message"]',
            'div[class*="markdown"]'
        ];
        const messages = [];
        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) {
                els.forEach(el => {
                    const role = el.getAttribute('data-message-author-role') ||
                                (el.closest('[data-message-author-role]')?.getAttribute('data-message-author-role')) ||
                                (el.textContent.trim().length > 10 ? 'unknown' : null);
                    const text = el.innerText.trim();
                    if (text && text.length > 5) {
                        messages.push({ role: role || 'unknown', text });
                    }
                });
                break;
            }
        }
        return messages;
    }

    function findChatInput() {
        const selectors = [
            'textarea#prompt-textarea',
            'textarea[placeholder*="Message"]',
            'textarea[placeholder*="Спросите"]',
            'textarea[placeholder*="Ask"]',
            'textarea',
            'div[contenteditable="true"]'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) return el;
        }
        return null;
    }

    async function copyContext() {
        const messages = findChatMessages();
        if (messages.length === 0) {
            showNotification('Не найдено сообщений в чате', 'error', 5000);
            return;
        }
        const formatted = messages.map(m => `[${m.role === 'user' ? 'Пользователь' : m.role === 'assistant' ? 'Ассистент' : 'Неизвестно'}]: ${m.text}`).join('\n\n');
        savedContext = formatted;
        await saveData('savedContext', formatted);
        try {
            if (typeof GM_setClipboard !== 'undefined') {
                GM_setClipboard(formatted, 'text');
            } else {
                await navigator.clipboard.writeText(formatted);
            }
            showNotification(`Контекст скопирован (${messages.length} сообщ., ${formatted.length} симв.)`, 'success', 4000);
        } catch (e) {
            showNotification('Ошибка копирования', 'error', 5000);
        }
        closeContextMenu();
    }

    async function pasteContext() {
        if (!savedContext) {
            savedContext = await getData('savedContext');
        }
        if (!savedContext) {
            showNotification('Сначала скопируйте контекст', 'warning', 5000);
            return;
        }
        const input = findChatInput();
        if (!input) {
            showNotification('Поле ввода не найдено', 'error', 5000);
            return;
        }
        if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            await typeLikeHuman(input, savedContext);
        } else if (input.isContentEditable) {
            input.focus();
            input.innerText = savedContext;
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
        contextMenuWrapper = null;
        contextMenuPanel = null;
        menuVisible = false;

        if (!canShowContextMenu()) return;

        const isDark = getTheme() === 'dark';
        const bg = isDark ? '#2d2d2d' : '#ffffff';
        const fg = isDark ? '#eee' : '#222';
        const border = isDark ? '#444' : '#e0e0e0';
        const hover = isDark ? '#3a3a3a' : '#f5f5f5';

        contextMenuWrapper = document.createElement('div');
        contextMenuWrapper.style.cssText = `position:fixed;top:50px;right:20px;z-index:99999;display:flex;flex-direction:column;align-items:flex-end;gap:8px;`;

        const trigger = document.createElement('button');
        trigger.innerHTML = ICON_HAMBURGER;
        trigger.title = 'Менеджер контекста';
        trigger.style.cssText = `width:44px;height:44px;border-radius:12px;background:${bg};color:${fg};border:1px solid ${border};cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,${isDark ? '0.4' : '0.15'});transition:background 0.2s;`;
        trigger.addEventListener('mouseenter', () => { trigger.style.background = hover; });
        trigger.addEventListener('mouseleave', () => { trigger.style.background = bg; });

        contextMenuPanel = document.createElement('div');
        contextMenuPanel.style.cssText = `display:none;flex-direction:column;gap:6px;background:${bg};padding:10px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,${isDark ? '0.5' : '0.2'});border:1px solid ${border};min-width:220px;`;

        const makeBtn = (icon, text, onClick) => {
            const b = document.createElement('button');
            b.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-right:8px;">${icon}</span><span>${text}</span>`;
            b.style.cssText = `display:flex;align-items:center;padding:10px 12px;background:transparent;color:${fg};border:1px solid ${border};border-radius:8px;font-size:13px;cursor:pointer;font-weight:500;text-align:left;transition:background 0.2s;`;
            b.addEventListener('mouseenter', () => { b.style.background = hover; });
            b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
            b.onclick = (e) => { e.stopPropagation(); onClick(); };
            return b;
        };

        contextMenuPanel.appendChild(makeBtn(ICON_COPY, 'Копировать контекст', copyContext));
        contextMenuPanel.appendChild(makeBtn(ICON_PASTE, 'Вставить контекст', pasteContext));
        contextMenuPanel.appendChild(makeBtn(ICON_HELP, 'Помощь', showHelpModal));

        trigger.onclick = (e) => { e.stopPropagation(); toggleContextMenu(); };

        contextMenuWrapper.appendChild(trigger);
        contextMenuWrapper.appendChild(contextMenuPanel);
        document.body.appendChild(contextMenuWrapper);

        setTimeout(() => {
            document.addEventListener('click', (e) => {
                if (contextMenuWrapper && !contextMenuWrapper.contains(e.target)) {
                    closeContextMenu();
                }
            });
        }, 100);
    }

    // ============================================
    // НАБЛЮДАТЕЛЬ ЗА ПОЯВЛЕНИЕМ АВТОРИЗАЦИИ
    // ============================================
    function startAuthObserver() {
        if (authObserver) authObserver.disconnect();
        
        if (canShowContextMenu()) {
            createContextMenu();
            return;
        }

        authObserver = new MutationObserver(() => {
            if (canShowContextMenu()) {
                createContextMenu();
                authObserver.disconnect();
                authObserver = null;
            }
        });
        
        authObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'data-testid']
        });

        setTimeout(() => {
            if (authObserver) {
                authObserver.disconnect();
                authObserver = null;
            }
        }, 15000);
    }

    // ============================================
    // НАБЛЮДАТЕЛЬ URL
    // ============================================
    function startUrlWatcher(callback, timeout = 15000) {
        stopUrlWatcher();
        let lastUrl = window.location.href;
        let elapsed = 0;
        urlWatcher = setInterval(() => {
            if (window.location.href !== lastUrl) {
                stopUrlWatcher();
                callback();
            } else {
                elapsed += 500;
                if (elapsed >= timeout) {
                    stopUrlWatcher();
                    callback(true);
                }
            }
        }, 500);
    }
    function stopUrlWatcher() {
        if (urlWatcher) { clearInterval(urlWatcher); urlWatcher = null; }
    }

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
            startUrlWatcher((timeout) => {
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
            emailToUse = generateGmailAlias().alias;
            codeRequestedAt = Date.now();
            usedMessageIds = new Set();
            await saveData('usedMsgIds', []);
        } else {
            emailToUse = (await getData('gmailAlias')) || generateGmailAlias().alias;
            codeRequestedAt = null;
        }
        currentGmailAlias = emailToUse;
        await saveData('gmailAlias', emailToUse);
        await saveData('codeRequestedAt', codeRequestedAt);

        let input = null;
        for (let i = 0; i < 8 && !input; i++) {
            input = findEmailInput();
            if (!input) await new Promise(r => setTimeout(r, 300));
        }
        if (!input) { showNotification('Поле email не найдено', 'error'); return; }

        await typeLikeHuman(input, emailToUse);
        showNotification(`Email: ${emailToUse}`, 'success');
        await humanDelay(100, 300);
        await clickContinue();

        startUrlWatcher((timeout) => {
            if (!registrationComplete) runStage();
        }, 12000);
    }

    async function watchCodeResult() {
        const start = Date.now();
        while (Date.now() - start < 60000) {
            await new Promise(r => setTimeout(r, 3000));
            if (registrationComplete) return;
            if (!findCodeInputs()) return;
        }
        showNotification('Код не подошёл. Нажмите «Resend code», я подхвачу НОВОЕ письмо.', 'warning', 12000);
        codeInserted = false; verifyCompleted = false;
        setTimeout(runStage, 1000);
    }

    async function stageVerify() {
        if (verifyCompleted || registrationComplete || pollingActive) return;
        if (codeInserted) { verifyCompleted = true; await stageProfile(); return; }
        pollingActive = true;
        if (codeRequestedAt == null) codeRequestedAt = await getData('codeRequestedAt');
        const authOk = await authenticateMailTm();
        if (!authOk) { pollingActive = false; return; }

        for (let i = 0; i < CONFIG.maxAttempts; i++) {
            const attempt = i + 1;
            if (attempt <= 3 || attempt % 10 === 0)
                showNotification(`Проверка #${attempt}/${CONFIG.maxAttempts}`, 'debug', 2000);
            const result = await findVerificationCode();

            if (result.found && result.code) {
                showNotification(`Код: ${result.code} (письму ${result.ageSec}с)`, 'success', 8000);
                if (await fillCode(result.code)) {
                    codeInserted = true; verifyCompleted = true;
                    usedMessageIds.add(result.messageId);
                    await saveData('usedMsgIds', [...usedMessageIds]);
                    await humanDelay(200, 500); await clickContinue();
                    watchCodeResult();
                    break;
                } else {
                    showNotification(`Код: ${result.code} (введите вручную)`, 'info', 10000);
                    pollingActive = false; return;
                }
            }

            if (result.reason === 'waiting_new_email') {
                if (attempt === 1 || attempt % 6 === 0)
                    showNotification(`Новое письмо ещё не пришло (старых: ${result.count})`, 'info', 2000);
            } else if (result.reason === 'api_error' && attempt === 2) {
                showNotification('Ошибка API mail.tm', 'error', 6000);
            } else if (result.reason === 'no_messages' && attempt === 5) {
                showNotification('Ящик пуст', 'warning', 5000);
            } else if (result.reason === 'no_code_in_fresh' && attempt % 6 === 0) {
                showNotification('Свежее письмо есть, но кода нет', 'warning', 3000);
            }
            await new Promise(r => setTimeout(r, CONFIG.checkInterval));
        }
        pollingActive = false;
        setTimeout(() => { if (!registrationComplete) runStage(); }, 1000);
    }

    async function stageProfile() {
        if (profileFilled || registrationComplete) return;
        const fields = findProfileFields();
        if (!fields.nameInput || !fields.ageInput) { setTimeout(() => { if (!profileFilled && !registrationComplete) stageProfile(); }, 1000); return; }
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
            stopUrlWatcher();
            if (window.urlCheckInterval) { clearInterval(window.urlCheckInterval); window.urlCheckInterval = null; }
        }
    }

    function detectStage() {
        if (hasLoginButton() && window.location.hostname.includes('chatgpt.com')) {
            return 'main';
        }
        
        if (window.location.hostname.includes('auth.openai.com')) {
            if (isOnProfilePage()) return 'profile';
            if (findCodeInputs()) return 'verify';
            if (findEmailInput()) return 'login';
        }
        if (window.location.hostname.includes('chatgpt.com')) {
            if (isUserLoggedIn()) return 'unknown';
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
            else if (stage === 'profile') await stageProfile();
        } catch (e) { showNotification(`Ошибка: ${e.message}`, 'error'); }
        isRunning = false;
    }

    async function init() {
        if (initDone) return;
        initDone = true;

        codeRequestedAt = await getData('codeRequestedAt');
        ((await getData('usedMsgIds')) || []).forEach(id => usedMessageIds.add(id));
        savedContext = await getData('savedContext');
        if (savedContext) console.log('Загружен контекст:', savedContext.length, 'символов');

        if (await getData('complete') && isUserLoggedIn()) { registrationComplete = true; }

        startAuthObserver();

        await new Promise(r => setTimeout(r, CONFIG.fastMode ? 300 : 1500));
        if (!registrationComplete) runStage();

        let lastUrl = window.location.href;
        window.urlCheckInterval = setInterval(() => {
            if (registrationComplete) { clearInterval(window.urlCheckInterval); return; }
            if (window.location.href !== lastUrl) {
                lastUrl = window.location.href;
                startAuthObserver();
                if (!isRunning) setTimeout(runStage, 500);
            }
        }, 1000);
    }

    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();
