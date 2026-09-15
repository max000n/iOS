// ==UserScript==
// @name         ChatGPT + Grok Auto Register
// @namespace    http://tampermonkey.net/
// @version      82.2
// @description  Авторегистрация ChatGPT и Grok через AgentMail.to / SimpleLogin + расширенная диагностика Grok
// @author       You
// @match        https://chatgpt.com/*
// @match        https://auth.openai.com/*
// @match        https://accounts.x.ai/*
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

const C = {
    amKey: '', amBase: 'https://api.agentmail.to/v0',
    slKey: '', slBase: 'https://app.simplelogin.io',
    slRelay: '',
    mode: 'agentmail',
    interval: 3000, maxTries: 120, tolMs: 60000,
    fast: true, delInbox: true, retries: 3, shift: true,
    debug: false,
    grokEnabled: true,
};

let codeDone = false, profileDone = false, regDone = false,
    running = false, loginTried = false, verifyDone = false,
    pwdDone = false, inited = false, inbox = null, polling = false,
    codeReqAt = null, usedIds = new Set(), urlTimer = null,
    helpModal = null, settingsModal = null, ctx = null,
    notifyDone = false, canContinue = false, profileNotified = false;

const GS = {
    emailDone: false, codeDone: false, profileDone: false, regDone: false,
    running: false, polling: false,
    inbox: null, codeReqAt: null, usedIds: new Set(),
    attempts: 0, lastReason: null, lastCode: null,
    turnstileSolved: false, turnstileWaitStart: 0,
    detectedStage: null,
};

const verifyStats = {
    attempts: 0, lastReason: null, lastMsgCount: 0,
    lastCode: null, lastCodeAge: null,
    fillAttempts: 0, fillSuccess: 0,
    lastApiStatus: null, lastApiError: null,
    inboxId: null, inboxEmail: null,
    firstMsgTime: null, codeReqTime: null,
};

// ═══════════════════ САЙТ ═══════════════════
const isGrok = () => location.hostname.includes('accounts.x.ai');
const isChatGPT = () => !isGrok();

// ═══════════════════ ДИАГНОСТИКА ═══════════════════
const LOG_MAX = 800;
const logBuf = [];
let diagErrors = [];

function ts() {
    const d = new Date();
    return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function log(level, tag, ...args) {
    if (!C.debug && level !== 'ERROR') return;
    const msg = args.map(a => {
        if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
        if (typeof a === 'object') {
            try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
    }).join(' ');
    const line = `[${ts()}] [${level}] [${tag}] ${msg}`;
    logBuf.push(line);
    if (logBuf.length > LOG_MAX) logBuf.shift();
    if (level === 'ERROR') {
        diagErrors.push(line);
        if (diagErrors.length > 150) diagErrors.shift();
    }
    if (logBuf.length % 10 === 0 || level === 'ERROR') {
        GM.setValue('cg_logs', logBuf.slice(-300)).catch(() => {});
    }
    console.log(line);
}

addEventListener('error', e => {
    log('ERROR', 'window', e.message + ' at ' + e.filename + ':' + e.lineno + ':' + e.colno);
});
addEventListener('unhandledrejection', e => {
    log('ERROR', 'promise', e.reason?.message || String(e.reason));
});

// ─── Расширенный дамп DOM для Grok ───
function dumpGrokDOM() {
    const out = [];
    const push = (label, val) => out.push(label + ': ' + val);

    push('--- GROK DOM DUMP ---', '');
    push('URL', location.href);
    push('readyState', document.readyState);
    push('body.childElementCount', document.body ? document.body.childElementCount : 'no body');
    push('html.lang', document.documentElement.lang);
    push('html.class', document.documentElement.className);

    // Видимые input'ы
    const inputs = [...document.querySelectorAll('input')];
    push('inputs.total', inputs.length);
    inputs.slice(0, 30).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const vis = el.offsetParent !== null || (r.width > 0 && r.height > 0);
        push(`input[${i}]`, JSON.stringify({
            id: el.id, name: el.name, type: el.type,
            maxlength: el.getAttribute('maxlength'),
            autocomplete: el.getAttribute('autocomplete'),
            placeholder: el.placeholder,
            inputmode: el.getAttribute('inputmode'),
            ariaLabel: el.getAttribute('aria-label'),
            visible: vis, value: (el.value || '').slice(0, 20),
            rect: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }
        }));
    });

    // Видимые кнопки
    const btns = [...document.querySelectorAll('button, a[role="button"], div[role="button"], input[type="submit"]')];
    push('buttons.total', btns.length);
    btns.slice(0, 40).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const vis = el.offsetParent !== null || (r.width > 0 && r.height > 0);
        push(`button[${i}]`, JSON.stringify({
            tag: el.tagName, type: el.type || null,
            text: (el.textContent || '').trim().slice(0, 60),
            ariaLabel: el.getAttribute('aria-label'),
            dataTestId: el.getAttribute('data-testid'),
            visible: vis,
            rect: { w: Math.round(r.width), h: Math.round(r.height) }
        }));
    });

    // Формы
    const forms = [...document.querySelectorAll('form')];
    push('forms.total', forms.length);
    forms.slice(0, 10).forEach((el, i) => {
        push(`form[${i}]`, JSON.stringify({
            action: el.action, method: el.method,
            inputs: el.querySelectorAll('input').length,
            buttons: el.querySelectorAll('button').length
        }));
    });

    // iframe (Turnstile)
    const iframes = [...document.querySelectorAll('iframe')];
    push('iframes.total', iframes.length);
    iframes.slice(0, 10).forEach((el, i) => {
        push(`iframe[${i}]`, JSON.stringify({
            src: (el.src || '').slice(0, 120),
            id: el.id, name: el.name,
            visible: el.offsetParent !== null
        }));
    });

    // Turnstile-специфика
    push('turnstile.response input', !!document.querySelector('input[name="cf-turnstile-response"]'));
    push('turnstile.div[data-sitekey]', !!document.querySelector('div[data-sitekey]'));
    push('turnstile.iframe', !!document.querySelector('iframe[src*="challenges.cloudflare.com"]'));

    // Текст body (первые 600 символов, склеенный)
    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    push('body.innerText (600)', bodyText);

    // Заголовки h1/h2
    [...document.querySelectorAll('h1, h2')].slice(0, 5).forEach((el, i) => {
        push(`heading[${i}]`, (el.textContent || '').trim().slice(0, 100));
    });

    // Shadow roots (если есть)
    const all = [...document.querySelectorAll('*')];
    const withShadow = all.filter(el => el.shadowRoot).slice(0, 5);
    push('shadowRoots.total', withShadow.length);
    withShadow.forEach((el, i) => {
        push(`shadow[${i}]`, el.tagName + '#' + el.id + '.' + (el.className || '').slice(0, 40));
    });

    push('--- END DUMP ---', '');
    return out.join('\n');
}

async function buildReport() {
    const p = [];
    p.push('═══ AUTO REGISTER — ОТЧЁТ (ChatGPT + Grok) ═══');
    p.push('Дата: ' + new Date().toISOString());
    p.push('Версия скрипта: 82.2');
    p.push('URL: ' + location.href);
    p.push('Host: ' + location.hostname);
    p.push('Path: ' + location.pathname);
    p.push('Сайт: ' + (isGrok() ? 'Grok (accounts.x.ai)' : 'ChatGPT'));
    p.push('readyState: ' + document.readyState);
    p.push('User Agent: ' + navigator.userAgent);
    p.push('Платформа: ' + navigator.platform + ' | Mobile: ' + (innerWidth < 768));
    p.push('Окно: ' + innerWidth + '×' + innerHeight);
    p.push('');

    p.push('─── СОСТОЯНИЕ CHATGPT ───');
    p.push('running: ' + running);
    p.push('regDone: ' + regDone);
    p.push('verifyDone: ' + verifyDone);
    p.push('codeDone: ' + codeDone);
    p.push('pwdDone: ' + pwdDone);
    p.push('profileDone: ' + profileDone);
    p.push('polling: ' + polling);
    p.push('canContinue: ' + canContinue);
    p.push('loginTried: ' + loginTried);
    p.push('inbox: ' + JSON.stringify(inbox));
    p.push('codeReqAt: ' + (codeReqAt ? new Date(codeReqAt).toISOString() : null));
    p.push('');

    p.push('─── ПРОВЕРКА ПОЧТЫ (ChatGPT) ───');
    p.push('inboxId: ' + verifyStats.inboxId);
    p.push('inboxEmail: ' + verifyStats.inboxEmail);
    p.push('attempts: ' + verifyStats.attempts);
    p.push('lastReason: ' + verifyStats.lastReason);
    p.push('lastCode: ' + verifyStats.lastCode);
    p.push('lastApiStatus: ' + verifyStats.lastApiStatus);
    p.push('lastApiError: ' + verifyStats.lastApiError);
    p.push('');

    p.push('─── СОСТОЯНИЕ GROK ───');
    p.push('grokEnabled: ' + C.grokEnabled);
    p.push('GS.running: ' + GS.running);
    p.push('GS.emailDone: ' + GS.emailDone);
    p.push('GS.codeDone: ' + GS.codeDone);
    p.push('GS.profileDone: ' + GS.profileDone);
    p.push('GS.regDone: ' + GS.regDone);
    p.push('GS.polling: ' + GS.polling);
    p.push('GS.attempts: ' + GS.attempts);
    p.push('GS.lastReason: ' + GS.lastReason);
    p.push('GS.lastCode: ' + GS.lastCode);
    p.push('GS.detectedStage: ' + GS.detectedStage);
    p.push('GS.turnstileSolved: ' + GS.turnstileSolved);
    p.push('GS.inbox: ' + JSON.stringify(GS.inbox));
    p.push('GS.codeReqAt: ' + (GS.codeReqAt ? new Date(GS.codeReqAt).toISOString() : null));
    p.push('');

    p.push('─── КОНФИГ ───');
    p.push('mode: ' + C.mode);
    p.push('slRelay: ' + (C.slRelay || 'не задан'));
    p.push('debug: ' + C.debug);
    p.push('amKey: ' + (C.amKey ? C.amKey.slice(0, 8) + '…(' + C.amKey.length + ')' : 'нет'));
    p.push('slKey: ' + (C.slKey ? C.slKey.slice(0, 8) + '…(' + C.slKey.length + ')' : 'нет'));
    p.push('');

    p.push('─── DOM (общий) ───');
    p.push('detect(): ' + detect());
    p.push('menuBtn.left: ' + (menuBtn ? menuBtn.style.left : 'нет'));
    p.push('menuBtn.right: ' + (menuBtn ? menuBtn.style.right : 'нет'));
    p.push('');

    if (isGrok()) {
        p.push('─── DOM (Grok, ручная проверка селекторов) ───');
        p.push('GR.findEmail(): ' + (GR.findEmail() ? 'есть' : 'нет'));
        p.push('GR.findCode(): ' + (GR.findCode() ? 'есть' : 'нет'));
        p.push('GR.findGivenName(): ' + (GR.findGivenName() ? 'есть' : 'нет'));
        p.push('GR.findFamilyName(): ' + (GR.findFamilyName() ? 'есть' : 'нет'));
        p.push('GR.findPwd(): ' + (GR.findPwd() ? 'есть' : 'нет'));
        p.push('GR.findSubmit(): ' + (GR.findSubmit() ? 'есть' : 'нет'));
        p.push('GR.hasTurnstile(): ' + GR.hasTurnstile());
        p.push('GR.turnstileSolved(): ' + GR.turnstileSolved());
        p.push('GR.hasEmailText(): ' + GR.hasEmailText());
        p.push('GR.hasCodeText(): ' + GR.hasCodeText());
        p.push('GR.hasProfileText(): ' + GR.hasProfileText());
        p.push('GR.detectStage(): ' + GR.detectStage());
        p.push('');
        p.push('─── GROK DOM DUMP ───');
        p.push(dumpGrokDOM());
        p.push('');
    } else {
        p.push('─── DOM (ChatGPT) ───');
        p.push('findEmail(): ' + (findEmail() ? 'есть' : 'нет'));
        p.push('findPwd(): ' + (findPwd() ? 'есть' : 'нет'));
        p.push('findCodes(): ' + (findCodes() ? 'есть' : 'нет'));
        p.push('hasVerifyText(): ' + hasVerifyText());
        p.push('loggedIn(): ' + loggedIn());
        p.push('');
    }

    p.push('─── ОШИБКИ (' + diagErrors.length + ') ───');
    if (!diagErrors.length) p.push('(нет)');
    else diagErrors.slice(-30).forEach(e => p.push(e));
    p.push('');
    p.push('─── ЛОГ (' + logBuf.length + ') ───');
    if (!logBuf.length) p.push('(пусто)');
    else logBuf.slice(-300).forEach(l => p.push(l));
    p.push('');
    p.push('═══ КОНЕЦ ОТЧЁТА ═══');
    return p.join('\n');
}

async function copyReport() {
    const report = await buildReport();
    let ok = false;
    try {
        if (typeof GM_setClipboard !== 'undefined') { GM_setClipboard(report, 'text'); ok = true; }
        else if (navigator.clipboard) { await navigator.clipboard.writeText(report); ok = true; }
    } catch (e) { log('ERROR', 'copyReport', e); }
    showReportModal(report, ok);
}

function showReportModal(report, copied) {
    document.getElementById('gpt-report-modal')?.remove();
    const ov = document.createElement('div');
    ov.id = 'gpt-report-modal';
    ov.style.cssText = 'position:fixed;inset:0;background:var(--govl);z-index:9999999;display:flex;align-items:center;justify-content:center;animation:gFd .2s var(--gease) both';
    const m = document.createElement('div');
    m.className = 'gpt-gl';
    m.style.cssText = 'padding:20px;border-radius:20px;max-width:820px;width:94%;max-height:90vh;display:flex;flex-direction:column;color:var(--gfg);animation:gIn .3s var(--gease) both';
    m.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
<h2 style="margin:0;font-size:17px;font-weight:600">Отчёт диагностики</h2>
<button id="grmc" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gmut);padding:0 5px">×</button></div>
<p style="margin:0 0 10px 0;font-size:12px;color:var(--gmut)">${copied ? '✓ Скопировано в буфер.' : '⚠ Буфер недоступен.'} Размер: ${report.length} симв.</p>
<textarea id="grmt" readonly style="flex:1;min-height:480px;width:100%;padding:12px;border-radius:10px;border:1px solid var(--gbd);background:var(--gelev);color:var(--gfg);font-family:ui-monospace,monospace;font-size:11px;line-height:1.4;resize:vertical;box-sizing:border-box">${report.replace(/</g, '<')}</textarea>
<div style="display:flex;gap:10px;margin-top:12px">
<button id="grmc2" style="flex:1;padding:12px;background:var(--gacc);color:var(--gaccf);border:none;border-radius:999px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Скопировать снова</button>
<button id="grmclr" style="padding:12px 20px;background:transparent;color:var(--gdngr);border:1px solid var(--gbd);border-radius:999px;font-size:14px;cursor:pointer;font-family:inherit">Очистить логи</button>
</div>`;
    ov.appendChild(m);
    document.body.appendChild(ov);

    const txt = m.querySelector('#grmt');
    const copyAgain = async () => {
        try {
            if (typeof GM_setClipboard !== 'undefined') GM_setClipboard(report, 'text');
            else { txt.focus(); txt.select(); document.execCommand('copy'); }
            notify('Скопировано', 'ok', 2000);
        } catch { notify('Не удалось', 'err', 3000); }
    };
    m.querySelector('#grmc').onclick = () => ov.remove();
    m.querySelector('#grmc2').onclick = copyAgain;
    m.querySelector('#grmclr').onclick = async () => {
        logBuf.length = 0; diagErrors.length = 0;
        await GM.setValue('cg_logs', []).catch(() => {});
        notify('Логи очищены', 'ok', 2000);
    };
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    setTimeout(() => { txt.focus(); txt.setSelectionRange(0, 0); }, 100);
}

// ═══════════════════ CSS ═══════════════════
function injectCSS() {
    if (document.getElementById('gpt-css')) return;
    const s = document.createElement('style');
    s.id = 'gpt-css';
    s.textContent = `
:root{--gbg:#fff;--gelev:#f4f4f4;--gfg:#0d0d0d;--gmut:#8e8e8e;--gbd:rgba(0,0,0,.1);
--ghov:#ececec;--gshd:rgba(0,0,0,.1);--govl:rgba(0,0,0,.45);--gacc:#0d0d0d;--gaccf:#fff;--gdngr:#ef4146;
--grad:12px;--gease:cubic-bezier(.16,1,.3,1)}
@media(prefers-color-scheme:dark){:root{--gbg:#212121;--gelev:#2f2f2f;--gfg:#ececec;--gmut:#8e8e8e;
--gbd:rgba(255,255,255,.1);--ghov:#2f2f2f;--gshd:rgba(0,0,0,.5);--govl:rgba(0,0,0,.65);
--gacc:#ececec;--gaccf:#0d0d0d}}
html.dark{--gbg:#212121;--gelev:#2f2f2f;--gfg:#ececec;--gmut:#8e8e8e;--gbd:rgba(255,255,255,.1);
--ghov:#2f2f2f;--gshd:rgba(0,0,0,.5);--govl:rgba(0,0,0,.65);--gacc:#ececec;--gaccf:#0d0d0d}
.gpt-gl{background:var(--gbg);border:1px solid var(--gbd);box-shadow:0 8px 32px var(--gshd)}
.gpt-in{width:100%;padding:11px 14px;border-radius:12px;border:1px solid var(--gbd);background:var(--gelev);
color:var(--gfg);font-size:14px;box-sizing:border-box;font-family:inherit;transition:border-color .2s var(--gease)}
.gpt-in:focus{outline:none;border-color:var(--gfg)}
.gpt-lbl{display:block;margin-bottom:8px;color:var(--gfg);font-size:13px;font-weight:600}
.gpt-hint{color:var(--gmut);font-size:12px;margin-top:6px;line-height:1.5}
.gpt-seg{display:flex;background:var(--gelev);border-radius:12px;padding:3px;gap:2px}
.gpt-seg button{flex:1;padding:10px;background:transparent;color:var(--gmut);border:none;border-radius:9px;
cursor:pointer;font-size:13px;font-weight:500;font-family:inherit;transition:.18s var(--gease)}
.gpt-seg button.active{background:var(--gbg);color:var(--gfg);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.gpt-btn{padding:14px;background:var(--gacc);color:var(--gaccf);border:none;border-radius:999px;
font-size:15px;cursor:pointer;font-weight:600;font-family:inherit;transition:opacity .15s var(--gease)}
.gpt-btn:hover{opacity:.9}
.gpt-ghost{padding:12px;background:transparent;color:var(--gmut);border:none;font-size:14px;cursor:pointer;font-family:inherit}
@keyframes gIn{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes gFd{from{opacity:0}to{opacity:1}}
@keyframes gIt{from{opacity:0;transform:translateX(-4px)}to{opacity:1;transform:translateX(0)}}
@keyframes gPls{0%,100%{opacity:1}50%{opacity:.5}}
.gpt-pnl{animation:gIn .25s var(--gease) both}
.gpt-mi{animation:gIt .3s var(--gease) both;transition:background .15s var(--gease),transform .1s var(--gease)}
.gpt-mi:hover{background:var(--ghov)!important}
.gpt-mi:active{transform:scale(.98)}
.gpt-cont{animation:gPls 1.6s ease-in-out infinite}`;
    document.head.appendChild(s);
}

// ═══════════════════ УТИЛИТЫ ═══════════════════
const sleep = ms => new Promise(r => setTimeout(r, ms));
const delay = (a, b) => { if (C.fast) { a = Math.min(a, 100); b = Math.min(b, 250); } return sleep(a + Math.random() * (b - a)); };

function setVal(el, v) {
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    setter ? setter.call(el, v) : el.value = v;
    el._valueTracker?.setValue('');
}
function fireInput(el, v) {
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: v })); }
    catch { el.dispatchEvent(new Event('input', { bubbles: true })); }
}
async function click(el) {
    if (!el) { log('DEBUG', 'click', 'null'); return false; }
    log('DEBUG', 'click', (el.tagName || '?') + ' "' + (el.textContent || '').trim().slice(0, 30) + '"');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(50, 150);
    try {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0 }));
    } catch {}
    await delay(30, 80);
    try {
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0 }));
    } catch {}
    el.click();
    return true;
}
async function focusEl(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(50, 150);
    el.focus();
    try {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }));
    } catch {}
    await delay(50, 150);
}
const save = (k, v) => GM.setValue('cg_' + k, v).catch(() => false);
const load = k => GM.getValue('cg_' + k, null).catch(() => null);

// ═══════════════════ HTTP ═══════════════════
function req(opts) {
    const short = (opts.url || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 80);
    log('DEBUG', 'http', (opts.method || 'GET') + ' ' + short);
    return new Promise(res => GM_xmlhttpRequest({
        ...opts,
        onload: r => {
            log('DEBUG', 'http', '← ' + r.status + ' ' + short + (r.status >= 400 ? ' BODY=' + (r.responseText || '').slice(0, 300) : ''));
            verifyStats.lastApiStatus = r.status;
            res(r);
        },
        onerror: e => {
            log('ERROR', 'http', 'net error: ' + short);
            verifyStats.lastApiError = 'net error';
            res({ status: 0, responseText: '', error: e });
        },
        ontimeout: () => {
            log('ERROR', 'http', 'timeout: ' + short);
            verifyStats.lastApiError = 'timeout';
            res({ status: 0, responseText: 'timeout' });
        },
    }));
}
async function reqRetry(opts, label = 'API') {
    for (let i = 1; i <= C.retries; i++) {
        const r = await req(opts);
        if (r.status === 429) {
            const m = (r.responseHeaders || '').match(/retry-after:\s*(\d+)/i);
            const w = m ? parseInt(m[1]) : 5;
            if (i < C.retries) { notify(`${label}: лимит, ждём ${w}с…`, 'warn', w * 1000 + 1000); await sleep(w * 1000); continue; }
            return r;
        }
        if (r.status >= 500 && r.status < 600 && i < C.retries) { await sleep(2000 * i); continue; }
        if (r.status === 0 && i < C.retries) { await sleep(2000); continue; }
        return r;
    }
    return { status: 0 };
}

// ═══════════════════ УВЕДОМЛЕНИЯ ═══════════════════
let ntfCont = null;
function notify(text, type = 'info', dur = 5000) {
    log(type === 'err' ? 'ERROR' : 'INFO', 'notify', '[' + type + '] ' + text);
    if (!ntfCont) {
        ntfCont = document.createElement('div');
        ntfCont.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:999999;display:flex;flex-direction:column;gap:8px;max-width:90%;width:480px;pointer-events:none';
        document.body.appendChild(ntfCont);
    }
    const colors = { info: '#3498db', ok: '#8e8e8e', warn: '#f39c12', err: '#ef4146', dbg: '#8e8e8e' };
    const el = document.createElement('div');
    el.className = 'gpt-gl';
    el.style.cssText = `padding:12px 16px;border-radius:12px;font-size:14px;border-left:4px solid ${colors[type] || '#8e8e8e'};pointer-events:auto;color:var(--gfg);animation:gFd .25s var(--gease) both`;
    el.textContent = text;
    ntfCont.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity .4s';
        setTimeout(() => el.remove(), 400);
    }, dur);
}

// ═══════════════════ НАСТРОЙКИ ═══════════════════
function openSettings() {
    return new Promise(res => {
        settingsModal?.remove();
        settingsModal = document.createElement('div');
        settingsModal.style.cssText = 'position:fixed;inset:0;background:var(--govl);z-index:999999;display:flex;align-items:center;justify-content:center;animation:gFd .2s var(--gease) both';
        const d = document.createElement('div');
        d.className = 'gpt-gl';
        d.style.cssText = 'padding:24px;border-radius:20px;max-width:520px;width:92%;max-height:90vh;display:flex;flex-direction:column;color:var(--gfg);animation:gIn .3s var(--gease) both';
        d.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
<h2 style="margin:0;font-size:18px;font-weight:600">Настройки</h2>
<button id="gcs" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gmut);padding:0 5px">×</button></div>

<div class="gpt-seg" id="gtabs" style="margin-bottom:18px">
<button data-t="general" class="active">Общее</button>
<button data-t="diag">Диагностика</button>
</div>

<div id="pane-general" style="overflow-y:auto;max-height:60vh;padding-right:4px">
<p style="color:var(--gmut);font-size:12px;margin:0 0 16px 0">Ключи сохраняются в Tampermonkey.</p>
<label class="gpt-lbl">Режим</label>
<div class="gpt-seg" id="gm" style="margin-bottom:18px">
<button data-m="agentmail">AgentMail</button>
<button data-m="simplelogin">SimpleLogin</button></div>
<div id="amBlock">
<label class="gpt-lbl" id="amlbl">AgentMail API Key <span style="color:var(--gmut)">*</span></label>
<input id="amin" class="gpt-in" type="password" placeholder="am_..." autocomplete="off">
<p class="gpt-hint" id="amhint">console.agentmail.to → API Keys</p></div>
<div style="height:14px"></div>
<div id="slBlock" style="display:none">
<label class="gpt-lbl">SimpleLogin API Key <span style="color:var(--gmut)">*</span></label>
<input id="slin" class="gpt-in" type="password" placeholder="sl_..." autocomplete="off">
<p class="gpt-hint">app.simplelogin.io/dashboard/api_key</p>
<div style="height:12px"></div>
<label class="gpt-lbl">AgentMail email для проверки <span style="color:var(--gmut)">*</span></label>
<input id="slemail" class="gpt-in" type="email" placeholder="relay@agentmail.to" autocomplete="off">
<p class="gpt-hint">Адрес постоянного inbox, привязанного в SimpleLogin → Mailboxes.</p></div>
<div style="height:14px"></div>
<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--gelev);border-radius:12px">
<span style="font-size:13px;color:var(--gfg)">Включить Grok (accounts.x.ai)</span>
<span id="ggrok" style="position:relative;width:38px;height:22px;background:${C.grokEnabled ? 'var(--gfg)' : '#8e8e8e'};border-radius:999px;flex-shrink:0;cursor:pointer;transition:background .2s var(--gease)">
<span style="position:absolute;top:3px;left:3px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s var(--gease);box-shadow:0 1px 3px rgba(0,0,0,.3);transform:translateX(${C.grokEnabled ? '16px' : '0'})"></span></span></div>
</div>

<div id="pane-diag" style="display:none;overflow-y:auto;max-height:60vh;padding-right:4px">
<label class="gpt-lbl">Диагностика</label>
<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--gelev);border-radius:12px;margin-bottom:12px">
<span style="font-size:13px;color:var(--gfg)">Подробный лог</span>
<span id="gsw" style="position:relative;width:38px;height:22px;background:${C.debug ? 'var(--gfg)' : '#8e8e8e'};border-radius:999px;flex-shrink:0;cursor:pointer;transition:background .2s var(--gease)">
<span style="position:absolute;top:3px;left:3px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s var(--gease);box-shadow:0 1px 3px rgba(0,0,0,.3);transform:translateX(${C.debug ? '16px' : '0'})"></span></span></div>
<button id="grepBtn" style="width:100%;padding:12px;background:var(--gelev);color:var(--gfg);border:1px solid var(--gbd);border-radius:999px;font-size:13px;cursor:pointer;font-family:inherit;margin-bottom:12px">Скопировать отчёт</button>
<button id="gdumpBtn" style="width:100%;padding:12px;background:var(--gelev);color:var(--gfg);border:1px solid var(--gbd);border-radius:999px;font-size:13px;cursor:pointer;font-family:inherit;margin-bottom:12px">Дамп Grok DOM в консоль</button>
<p style="color:var(--gmut);font-size:12px;margin:0 0 8px 0">Live-состояние:</p>
<div style="background:var(--gelev);padding:10px 12px;border-radius:10px;font-family:ui-monospace,monospace;font-size:11px;color:var(--gmut);line-height:1.6;white-space:pre-wrap">сайт: ${isGrok() ? 'Grok' : 'ChatGPT'}
stage: ${detect()}

— Grok —
GS.running: ${GS.running}
GS.emailDone: ${GS.emailDone}
GS.codeDone: ${GS.codeDone}
GS.profileDone: ${GS.profileDone}
GS.regDone: ${GS.regDone}
GS.attempts: ${GS.attempts}
GS.lastReason: ${GS.lastReason || '—'}
GS.detectedStage: ${GS.detectedStage}
GS.turnstileSolved: ${GS.turnstileSolved}
inputs: ${document.querySelectorAll('input').length}
buttons: ${document.querySelectorAll('button').length}
forms: ${document.querySelectorAll('form').length}
iframes: ${document.querySelectorAll('iframe').length}</div>
<p style="color:var(--gmut);font-size:11px;margin:12px 0 0 0">Логи также видны в консоли браузера.</p>
</div>

<div style="height:16px"></div>
<div style="display:flex;flex-direction:column;gap:10px">
<button id="gsave" class="gpt-btn">Сохранить</button>
<button id="gclr" style="padding:10px;background:transparent;color:var(--gdngr);border:1px solid var(--gbd);border-radius:999px;font-size:13px;cursor:pointer;font-family:inherit">Удалить ключи</button>
<button id="gcancel" class="gpt-ghost">Отмена</button></div>`;
        settingsModal.appendChild(d);
        document.body.appendChild(settingsModal);

        const tabsEl = d.querySelector('#gtabs'), tabBtns = tabsEl.querySelectorAll('button');
        const paneGen = d.querySelector('#pane-general'), paneDiag = d.querySelector('#pane-diag');
        tabBtns.forEach(b => b.onclick = () => {
            const t = b.dataset.t;
            tabBtns.forEach(x => x.classList.toggle('active', x.dataset.t === t));
            paneGen.style.display = t === 'general' ? 'block' : 'none';
            paneDiag.style.display = t === 'diag' ? 'block' : 'none';
        });

        const am = d.querySelector('#amin'), sl = d.querySelector('#slin'),
              sle = d.querySelector('#slemail'),
              amL = d.querySelector('#amlbl'), amH = d.querySelector('#amhint'),
              slB = d.querySelector('#slBlock');
        if (C.amKey) am.value = C.amKey;
        if (C.slKey) sl.value = C.slKey;
        if (C.slRelay) sle.value = C.slRelay;

        let mode = C.mode;
        const seg = d.querySelector('#gm'), btns = seg.querySelectorAll('button');
        const upd = () => {
            btns.forEach(b => b.classList.toggle('active', b.dataset.m === mode));
            const isS = mode === 'simplelogin';
            slB.style.display = isS ? 'block' : 'none';
            amL.innerHTML = isS
                ? 'AgentMail API Key <span style="color:var(--gmut)">* (relay)</span>'
                : 'AgentMail API Key <span style="color:var(--gmut)">*</span>';
        };
        upd();
        btns.forEach(b => b.onclick = () => { mode = b.dataset.m; upd(); });

        const sw = d.querySelector('#gsw');
        sw.onclick = async () => {
            C.debug = !C.debug;
            await save('debug', C.debug);
            const dot = sw.firstElementChild;
            sw.style.background = C.debug ? 'var(--gfg)' : '#8e8e8e';
            dot.style.transform = 'translateX(' + (C.debug ? '16px' : '0') + ')';
            notify('Диагностика ' + (C.debug ? 'включена' : 'выключена'), 'info', 2500);
        };

        const swGrok = d.querySelector('#ggrok');
        swGrok.onclick = async () => {
            C.grokEnabled = !C.grokEnabled;
            await save('grokEnabled', C.grokEnabled);
            const dot = swGrok.firstElementChild;
            swGrok.style.background = C.grokEnabled ? 'var(--gfg)' : '#8e8e8e';
            dot.style.transform = 'translateX(' + (C.grokEnabled ? '16px' : '0') + ')';
            notify('Grok ' + (C.grokEnabled ? 'включён' : 'выключен'), 'info', 2500);
        };

        const close = r => { settingsModal.remove(); settingsModal = null; res(r); };
        d.querySelector('#gcs').onclick = () => close(null);
        d.querySelector('#gcancel').onclick = () => close(null);
        settingsModal.onclick = e => { if (e.target === settingsModal) close(null); };
        d.querySelector('#gsave').onclick = async () => {
            const ak = am.value.trim(), sk = sl.value.trim(), relay = sle.value.trim();
            if (!ak) return notify('Укажите AgentMail API Key', 'err', 4000);
            if (mode === 'simplelogin' && !sk) return notify('Для SimpleLogin укажите API Key', 'err', 5000);
            if (mode === 'simplelogin' && !relay) return notify('Укажите AgentMail email для SimpleLogin', 'err', 5000);
            await save('amKey', ak);
            await save('slKey', sk || null);
            await save('slRelay', relay || null);
            await save('mode', mode);
            C.amKey = ak; C.slKey = sk; C.slRelay = relay; C.mode = mode;
            notify('Настройки сохранены', 'ok', 3000);
            close(true);
        };
        d.querySelector('#gclr').onclick = async () => {
            await save('amKey', null); await save('slKey', null); await save('slRelay', null); await save('mode', null);
            C.amKey = ''; C.slKey = ''; C.slRelay = ''; C.mode = 'agentmail';
            am.value = ''; sl.value = ''; sle.value = ''; mode = 'agentmail'; upd();
            notify('Ключи удалены', 'ok', 3000);
        };
        d.querySelector('#grepBtn').onclick = () => {
            settingsModal.remove();
            settingsModal = null;
            copyReport();
        };
        d.querySelector('#gdumpBtn').onclick = () => {
            const dump = dumpGrokDOM();
            console.log(dump);
            try {
                if (typeof GM_setClipboard !== 'undefined') GM_setClipboard(dump, 'text');
            } catch {}
            notify('Дамп Grok DOM скопирован (см. консоль)', 'ok', 4000);
        };

        setTimeout(() => am.focus(), 100);
    });
}

async function ensureKeys() {
    const k = await load('amKey');
    if (k) {
        C.amKey = k;
        C.slKey = (await load('slKey')) || '';
        C.slRelay = (await load('slRelay')) || '';
        C.mode = (await load('mode')) || 'agentmail';
        const ge = await load('grokEnabled');
        if (ge === false) C.grokEnabled = false;
        return true;
    }
    return !!(await openSettings());
}

// ═══════════════════ AGENTMAIL ═══════════════════
function genUser() {
    const a = ['swift','bright','calm','bold','keen','pure','warm','cool','fast','clear'],
          n = ['fox','hawk','wolf','bear','lion','tiger','eagle','shark','puma','owl'];
    return `${a[~~(Math.random()*a.length)]}-${n[~~(Math.random()*n.length)]}-${Date.now().toString(36)}`;
}
async function createInbox() {
    if (!C.amKey) { notify('AgentMail: ключ не задан', 'err'); return null; }
    const username = genUser();
    log('INFO', 'inbox', 'create ' + username);
    const r = await reqRetry({
        method: 'POST', url: `${C.amBase}/inboxes`,
        headers: { Authorization: `Bearer ${C.amKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        data: JSON.stringify({ username, displayName: 'Auto Register' }),
    }, 'AgentMail');
    if (r.status !== 200 && r.status !== 201) {
        notify(`AgentMail: ${r.status} ${(r.responseText || '').slice(0, 150)}`, 'err', 12000);
        return null;
    }
    try {
        const d = JSON.parse(r.responseText);
        const inboxObj = { id: d.inbox_id, email: d.inbox_id || d.email, username };
        verifyStats.inboxId = inboxObj.id;
        verifyStats.inboxEmail = inboxObj.email;
        return inboxObj;
    } catch { return null; }
}
async function delInbox(id) {
    if (!id) return false;
    const r = await reqRetry({
        method: 'DELETE', url: `${C.amBase}/inboxes/${encodeURIComponent(id)}`,
        headers: { Authorization: `Bearer ${C.amKey}` },
    }, 'AgentMail del');
    return r.status === 200 || r.status === 204;
}
async function listInboxes() {
    const r = await reqRetry({
        method: 'GET', url: `${C.amBase}/inboxes`,
        headers: { Authorization: `Bearer ${C.amKey}`, Accept: 'application/json' },
    }, 'AgentMail list');
    if (r.status !== 200) return [];
    try { return JSON.parse(r.responseText).inboxes || []; } catch { return []; }
}
async function listMsgs(id) {
    const r = await req({ method: 'GET', url: `${C.amBase}/inboxes/${encodeURIComponent(id)}/messages?limit=10`,
        headers: { Authorization: `Bearer ${C.amKey}`, Accept: 'application/json' } });
    if (r.status === 429) return { __rate: true };
    if (r.status !== 200) return null;
    try { return JSON.parse(r.responseText).messages || []; } catch { return null; }
}
async function getMsg(id, mid) {
    const r = await req({ method: 'GET', url: `${C.amBase}/inboxes/${encodeURIComponent(id)}/messages/${encodeURIComponent(mid)}`,
        headers: { Authorization: `Bearer ${C.amKey}`, Accept: 'application/json' } });
    if (r.status !== 200) return null;
    try { return JSON.parse(r.responseText); } catch { return null; }
}

// ═══════════════════ SIMPLELOGIN ═══════════════════
async function createAlias() {
    if (!C.slKey) { notify('SimpleLogin: ключ не задан', 'err'); return null; }
    const r = await reqRetry({
        method: 'POST', url: `${C.slBase}/api/alias/random/new`,
        headers: { Authentication: C.slKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        data: JSON.stringify({ note: 'Auto Register' }),
    }, 'SimpleLogin');
    if (r.status !== 200 && r.status !== 201) {
        notify(`SimpleLogin: ${r.status}`, 'err', 12000);
        return null;
    }
    try { const d = JSON.parse(r.responseText); return d.alias || d.email; } catch { return null; }
}

// ═══════════════════ КОД ═══════════════════
function extractCode(data) {
    if (!data) return null;
    const raw = [data.extracted_text, data.extracted_html, data.text, data.html, data.subject]
        .filter(Boolean).join('\n').replace(/<[^>]*>/g, ' ').replace(/ | /g, ' ');
    const glued = raw.replace(/(\d)[\s\u00a0]+(?=\d)/g, '$1');
    const m = glued.match(/(?:код|code|verification)[^\d\n]{0,40}(\d{6})/i) || glued.match(/\b(\d{6})\b/);
    if (!m) {
        log('DEBUG', 'extractCode', 'no match. raw=' + raw.slice(0, 200).replace(/\s+/g, ' '));
        return null;
    }
    return m[1];
}
const msgTime = m => new Date(m.timestamp || m.created_at || 0).getTime();
const isFresh = m => !codeReqAt || msgTime(m) >= codeReqAt - C.tolMs;

async function findCode() {
    if (!inbox?.id) { log('WARN', 'findCode', 'no inbox.id'); return { found: false, reason: 'no_inbox' }; }
    const msgs = await listMsgs(inbox.id);
    if (msgs?.__rate) { log('WARN', 'findCode', 'rate limited'); return { found: false, reason: 'rate_limited' }; }
    if (!msgs) { return { found: false, reason: 'api_error' }; }
    if (!msgs.length) { return { found: false, reason: 'no_messages' }; }

    msgs.sort((a, b) => msgTime(b) - msgTime(a));
    if (!verifyStats.firstMsgTime) verifyStats.firstMsgTime = msgTime(msgs[0]);
    verifyStats.lastMsgCount = msgs.length;

    const fresh = msgs.filter(isFresh);
    if (!fresh.length) return { found: false, reason: 'waiting', count: msgs.length };

    for (const m of fresh) {
        if (usedIds.has(m.message_id)) continue;
        const full = (await getMsg(inbox.id, m.message_id)) || m;
        const code = extractCode(full);
        if (code) {
            return { found: true, code, msgId: m.message_id, age: Math.max(0, Math.round((Date.now() - msgTime(m)) / 1000)) };
        }
    }
    return { found: false, reason: 'no_code', count: fresh.length };
}

// ═══════════════════ ПОЛЯ (ChatGPT) ═══════════════════
async function typeHuman(el, txt) {
    if (!el) return;
    await focusEl(el);
    setVal(el, '');
    const mn = C.fast ? 20 : 80, mx = C.fast ? 60 : 180;
    for (const ch of txt) {
        setVal(el, el.value + ch);
        fireInput(el, ch);
        await sleep(mn + Math.random() * (mx - mn));
    }
    await delay(50, 150);
    el.dispatchEvent(new Event('change', { bubbles: true }));
}
function findEmail() {
    const sels = ['#mobile-auth-email', 'input[type="email"]', 'input[name="login_hint"]',
                  'input[autocomplete="email"]', 'input[placeholder*="email" i]'];
    for (const s of sels) {
        const el = document.querySelector(s);
        if (el && el.offsetParent !== null) return el;
    }
    return document.querySelector('input[type="email"]');
}
const findPwd = () => [...document.querySelectorAll('input[type="password"]')].find(el => el.offsetParent !== null) || null;

function findCodeInp() {
    for (const s of ['input[id*="-code"]', 'input[name="code"]',
                     'input[placeholder*="код" i]', 'input[placeholder*="code" i]',
                     'input[inputmode="numeric"]', 'input[autocomplete="one-time-code"]']) {
        const el = document.querySelector(s);
        if (el && el.offsetParent !== null) return el;
    }
    return null;
}
function findCodes() {
    const single = [...document.querySelectorAll('input[maxlength="1"]')].filter(el => el.offsetParent !== null);
    if (single.length >= 6) return { type: 'otp', inputs: single.slice(0, 6) };
    const one = findCodeInp();
    return one ? { type: 'single', input: one } : null;
}
async function fillCode(code) {
    verifyStats.fillAttempts++;
    const t = findCodes();
    if (!t) return false;
    try {
        if (t.type === 'single') {
            await typeHuman(t.input, code);
        } else {
            for (let i = 0; i < t.inputs.length && i < code.length; i++) {
                await focusEl(t.inputs[i]);
                setVal(t.inputs[i], code[i]);
                fireInput(t.inputs[i], code[i]);
            }
        }
        verifyStats.fillSuccess++;
        return true;
    } catch (e) { return false; }
}
function findProfile() {
    const all = [...document.querySelectorAll('input')];
    let name = null, age = null;
    for (const i of all) {
        const s = ((i.placeholder || '') + (i.getAttribute('aria-label') || '') + (i.name || '')).toLowerCase();
        if (s.includes('name') || s.includes('имя')) { name = i; break; }
    }
    for (const i of all) {
        if (i === name) continue;
        const s = ((i.placeholder || '') + (i.getAttribute('aria-label') || '')).toLowerCase();
        if (s.includes('age') || s.includes('возраст') || i.type === 'number') { age = i; break; }
    }
    return { name, age };
}
const genAge = () => Math.floor(Math.random() * 21) + 25;
const genName = () => ['Alex','Emma','James','Sophia','Michael','Olivia'][~~(Math.random()*6)];
function genPwd() {
    const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '!@#$%&*';
    let p = '';
    for (let i = 0; i < 14; i++) p += c[~~(Math.random() * c.length)];
    return p + s[~~(Math.random()*s.length)] + ~~(Math.random()*10);
}
async function clickCont() {
    for (const b of document.querySelectorAll('button,a,div[role="button"]')) {
        const t = b.textContent.trim().toLowerCase();
        if (['continue','продолжить','next','далее','create','создать'].includes(t)) {
            return click(b);
        }
    }
    return false;
}

// ═══════════════════ ПРОВЕРКИ (ChatGPT) ═══════════════════
const loggedIn = () => !!document.querySelector('[data-testid="user-menu"],.user-menu') ||
    location.href.includes('/c/') ||
    (location.hostname.includes('chatgpt.com') && !hasLoginBtn() && !findEmail());
const hasLoginBtn = () => [...document.querySelectorAll('button,a,div[role="button"]')]
    .some(b => ['Войти','Sign in','Log in','Login'].includes(b.textContent.trim()));
const onLogin = () => location.hostname.includes('auth.openai.com') || !!findEmail();
const onProfile = () => { const f = findProfile(); return !!(f.name && f.age); };
const onAboutYou = () => /about-you|profile|onboarding/i.test(location.href);

function hasVerifyText() {
    const body = document.body?.innerText || '';
    return /Проверьте свою почту|Введите код подтверждения|Check your email|Enter the code|Enter verification/i.test(body);
}

// ═══════════════════ GROK MODULE ═══════════════════
const GR = {
    findEmail() {
        return document.querySelector('#email') ||
               document.querySelector('input[type="email"][name="email"]') ||
               [...document.querySelectorAll('input[type="email"]')].find(el => el.offsetParent !== null) ||
               null;
    },
    findCode() {
        return document.querySelector('input[autocomplete="one-time-code"]') ||
               document.querySelector('input[name="code"]') ||
               document.querySelector('input[inputmode="numeric"][maxlength="6"]') ||
               document.querySelector('input[inputmode="numeric"]') ||
               null;
    },
    findGivenName() {
        return document.querySelector('#givenName') ||
               document.querySelector('input[name="givenName"]') ||
               null;
    },
    findFamilyName() {
        return document.querySelector('#familyName') ||
               document.querySelector('input[name="familyName"]') ||
               null;
    },
    findPwd() {
        return document.querySelector('#password') ||
               document.querySelector('input[name="password"]') ||
               [...document.querySelectorAll('input[type="password"]')].find(el => el.offsetParent !== null) ||
               null;
    },
    findSubmit() {
        const btns = [...document.querySelectorAll('button[type="submit"]')];
        const priority = ['зарегистрироваться', 'подтвердить email', 'завершить регистрацию', 'продолжить', 'далее'];
        for (const p of priority) {
            const b = btns.find(b => b.textContent.trim().toLowerCase().includes(p));
            if (b && b.offsetParent !== null) return b;
        }
        // Fallback: любая видимая submit-кнопка
        return btns.find(b => b.offsetParent !== null) || null;
    },
    hasTurnstile() {
        return !!document.querySelector('input[name="cf-turnstile-response"]') ||
               !!document.querySelector('div[data-sitekey]') ||
               !!document.querySelector('iframe[src*="challenges.cloudflare.com"]');
    },
    turnstileSolved() {
        const inp = document.querySelector('input[name="cf-turnstile-response"]');
        return !!(inp && inp.value && inp.value.length > 10);
    },
    hasGrokLogo() {
        return !!document.querySelector('a[title*="SpaceXAI"]') || !!document.querySelector('svg[data-namespace="@xai/icons"]');
    },
    hasEmailText() {
        const t = document.body?.innerText || '';
        return /Зарегистрироваться с помощью email|Create.*account|Sign up with email/i.test(t) ||
               (!!this.findEmail() && !this.findCode() && !this.findGivenName());
    },
    hasCodeText() {
        const t = document.body?.innerText || '';
        return /Подтвердите ваш email|Verify your email|Enter the code|одноразовый код|введите код/i.test(t) || !!this.findCode();
    },
    hasProfileText() {
        const t = document.body?.innerText || '';
        return /Завершить регистрацию|Complete.*registration/i.test(t) ||
               (!!this.findGivenName() && !!this.findFamilyName() && !!this.findPwd());
    },

    detectStage() {
        if (this.hasProfileText()) return 'profile';
        if (this.hasCodeText()) return 'code';
        if (this.hasEmailText()) return 'email';
        return 'unknown';
    },

    async submitEmail(email) {
        const inp = this.findEmail();
        if (!inp) { notify('[GR] Поле email не найдено', 'err'); return false; }
        notify('[GR] Ввожу email: ' + email, 'info', 4000);
        await typeHuman(inp, email);
        await delay(200, 500);
        const btn = this.findSubmit();
        if (!btn) { notify('[GR] Кнопка не найдена', 'err'); return false; }
        await click(btn);
        GS.emailDone = true;
        GS.codeReqAt = Date.now();
        await save('gr_inbox', GS.inbox);
        await save('gr_email', email);
        await save('gr_codeReqAt', GS.codeReqAt);
        await save('gr_emailDone', true);
        return true;
    },

    async submitCode(code) {
        const inp = this.findCode();
        if (!inp) { notify('[GR] Поле для кода не найдено', 'err'); return false; }
        notify('[GR] Ввожу код: ' + code, 'info', 4000);
        await typeHuman(inp, code);
        await delay(200, 500);
        const btn = this.findSubmit();
        if (!btn) { notify('[GR] Кнопка не найдена', 'err'); return false; }
        await click(btn);
        GS.codeDone = true;
        await save('gr_codeDone', true);
        return true;
    },

    async submitProfile(data) {
        const { givenName, familyName, password } = data;
        const gi = this.findGivenName(), fi = this.findFamilyName(), pi = this.findPwd();
        if (!gi || !fi || !pi) { notify('[GR] Поля профиля не найдены', 'err'); return false; }
        notify('[GR] Заполняю профиль…', 'info', 4000);
        await typeHuman(gi, givenName);
        await typeHuman(fi, familyName);
        await typeHuman(pi, password);
        await delay(200, 500);

        if (this.hasTurnstile()) {
            if (!this.turnstileSolved()) {
                notify('[GR] ⚠ Пройдите капчу Cloudflare Turnstile вручную', 'warn', 15000);
                GS.turnstileWaitStart = Date.now();
                for (let i = 0; i < 60; i++) {
                    await sleep(2000);
                    if (this.turnstileSolved()) {
                        GS.turnstileSolved = true;
                        notify('[GR] ✓ Капча пройдена', 'ok', 3000);
                        break;
                    }
                    if (i === 29) notify('[GR] Всё ещё ждём капчу…', 'warn', 5000);
                }
                if (!this.turnstileSolved()) {
                    notify('[GR] Капча не пройдена, пропускаю шаг', 'err', 8000);
                    return false;
                }
            } else {
                GS.turnstileSolved = true;
            }
        }

        const btn = this.findSubmit();
        if (!btn) { notify('[GR] Кнопка не найдена', 'err'); return false; }
        await click(btn);
        GS.profileDone = true;
        await save('gr_profileDone', true);
        notify('[GR] Регистрация завершена!', 'ok', 10000);
        GS.regDone = true;
        return true;
    },

    async run() {
        if (!C.grokEnabled) return;
        if (GS.running) return;
        const stage = this.detectStage();
        GS.detectedStage = stage;
        log('INFO', 'GR', 'run() stage=' + stage);

        if (stage === 'unknown') {
            // Диагностируем подробно, чтобы понять, что за страница
            const dump = dumpGrokDOM();
            log('WARN', 'GR', 'unknown stage. DOM dump:\n' + dump);
            console.log('=== GROK UNKNOWN STAGE — DOM DUMP ===\n' + dump);
            notify('[GR] Не понял этап. Скинь отчёт: ☰ → Настройки → Диагностика → Скопировать отчёт', 'warn', 12000);
            // Покажем модалку с дампом
            showReportModal(dump, false);
            return;
        }
        GS.running = true;
        try {
            if (stage === 'email' && !GS.emailDone) {
                const email = await this.prepareEmail();
                if (!email) { GS.running = false; return; }
                await this.submitEmail(email);
            } else if (stage === 'code' && !GS.codeDone) {
                await this.pollCode();
            } else if (stage === 'profile' && !GS.profileDone) {
                const pwd = genPwd();
                const data = {
                    givenName: ['Alex','Emma','James','Sophia','Michael','Olivia'][~~(Math.random()*6)],
                    familyName: ['Smith','Johnson','Brown','Davis','Miller','Wilson'][~~(Math.random()*6)],
                    password: pwd,
                };
                await save('gr_pwd', pwd);
                notify('[GR] 🔑 Пароль: ' + pwd, 'warn', 20000);
                try { GM_setClipboard(pwd, 'text'); } catch {}
                await this.submitProfile(data);
            } else {
                log('INFO', 'GR', 'stage=' + stage + ' already done or skipped. emailDone=' + GS.emailDone + ' codeDone=' + GS.codeDone + ' profileDone=' + GS.profileDone);
            }
        } catch (e) {
            log('ERROR', 'GR', e);
        }
        GS.running = false;
    },

    async prepareEmail() {
        if (GS.inbox?.email) {
            notify('[GR] Использую почту: ' + GS.inbox.email, 'info', 4000);
            return GS.inbox.email;
        }
        setStatus('Почта GR…');
        let email;
        if (C.mode === 'simplelogin') {
            if (!C.slRelay) { notify('[GR] Не указан AgentMail email для SimpleLogin', 'err', 10000); return null; }
            const ib = await listInboxes();
            if (!ib.length) { notify('[GR] AgentMail: нет inbox', 'err', 12000); return null; }
            const relay = ib.find(i => (i.inbox_id || i.email) === C.slRelay);
            if (!relay) { notify('[GR] AgentMail: ящик ' + C.slRelay + ' не найден', 'err', 10000); return null; }
            GS.inbox = { id: relay.inbox_id, email: relay.inbox_id || relay.email };
            const alias = await createAlias();
            if (!alias) return null;
            email = alias;
            notify('[GR] Алиас: ' + alias + ' → ' + GS.inbox.email, 'info', 6000);
        } else {
            let ib = await createInbox();
            if (!ib) {
                const list = await listInboxes();
                if (list.length >= 3) {
                    notify('[GR] AgentMail: лимит ящиков. Удаляю старые…', 'warn', 5000);
                    const sorted = list.sort((a, b) => {
                        const ta = new Date(a.created_at || a.createdAt || 0).getTime();
                        const tb = new Date(b.created_at || b.createdAt || 0).getTime();
                        return ta - tb;
                    });
                    for (const old of sorted.slice(0, 2)) {
                        await delInbox(old.inbox_id || old.email);
                    }
                    ib = await createInbox();
                }
            }
            if (!ib) return null;
            GS.inbox = ib; email = ib.email;
            notify('[GR] Почта: ' + email, 'info', 6000);
        }
        GS.usedIds = new Set();
        await save('gr_inbox', GS.inbox);
        await save('gr_email', email);
        return email;
    },

    async pollCode() {
        if (GS.polling) return;
        GS.polling = true;
        GS.attempts = 0;
        if (!GS.inbox?.id) GS.inbox = await load('gr_inbox');
        if (!GS.inbox?.id) {
            notify('[GR] Нет ящика. Начните с этапа email.', 'err', 8000);
            GS.polling = false;
            return;
        }
        if (GS.codeReqAt == null) GS.codeReqAt = (await load('gr_codeReqAt')) || Date.now();
        notify('[GR] Жду код на ' + GS.inbox.email, 'info', 5000);

        for (let i = 0; i < C.maxTries; i++) {
            GS.attempts = i + 1;
            if (GS.attempts <= 3 || GS.attempts % 5 === 0) {
                setStatus('#GR' + GS.attempts);
            }
            const r = await findCodeFor(GS);
            GS.lastReason = r.reason || null;
            if (r.found) {
                GS.lastCode = r.code;
                notify('[GR] Код найден: ' + r.code, 'ok', 6000);
                await this.submitCode(r.code);
                GS.polling = false;
                setStatus('');
                return;
            }
            await sleep(C.interval);
        }
        notify('[GR] Код не найден за ' + C.maxTries + ' попыток', 'err', 12000);
        GS.polling = false;
        setStatus('');
    },
};

async function findCodeFor(gs) {
    if (!gs.inbox?.id) return { found: false, reason: 'no_inbox' };
    const msgs = await listMsgs(gs.inbox.id);
    if (msgs?.__rate) return { found: false, reason: 'rate_limited' };
    if (!msgs) return { found: false, reason: 'api_error' };
    if (!msgs.length) return { found: false, reason: 'no_messages' };
    msgs.sort((a, b) => msgTime(b) - msgTime(a));
    const fresh = msgs.filter(m => !gs.codeReqAt || msgTime(m) >= gs.codeReqAt - C.tolMs);
    if (!fresh.length) return { found: false, reason: 'waiting', count: msgs.length };
    for (const m of fresh) {
        if (gs.usedIds.has(m.message_id)) continue;
        const full = (await getMsg(gs.inbox.id, m.message_id)) || m;
        const code = extractCode(full);
        if (code) {
            gs.usedIds.add(m.message_id);
            return { found: true, code, msgId: m.message_id };
        }
    }
    return { found: false, reason: 'no_code', count: fresh.length };
}

// ═══════════════════ ДИАЛОГ ═══════════════════
function emailDialog() {
    return new Promise(async res => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:var(--govl);z-index:999999;display:flex;align-items:center;justify-content:center;animation:gFd .2s var(--gease) both';
        const d = document.createElement('div');
        d.className = 'gpt-gl';
        d.style.cssText = 'padding:28px;border-radius:20px;max-width:420px;width:90%;text-align:center;color:var(--gfg);animation:gIn .3s var(--gease) both';
        d.innerHTML = `
<h2 style="margin:0 0 8px;font-size:18px;font-weight:600">Регистрация ${isGrok() ? 'Grok' : 'ChatGPT'}</h2>
<p style="color:var(--gmut);font-size:13px;margin:0 0 18px 0">Режим: <b style="color:var(--gfg)">${C.mode === 'simplelogin' ? 'SimpleLogin → AgentMail' : 'AgentMail'}</b></p>
<p style="color:var(--gmut);font-size:12px;margin:0 0 16px 0" id="oldEm"></p>
<div style="display:flex;flex-direction:column;gap:10px">
<button id="bn" class="gpt-btn">Новая регистрация</button>
<button id="bo" style="padding:14px;background:var(--gelev);color:var(--gfg);border:1px solid var(--gbd);border-radius:999px;font-size:15px;cursor:pointer;display:none;font-family:inherit">Продолжить прошлую</button>
<button id="bc" class="gpt-ghost">Отмена</button></div>`;
        ov.appendChild(d); document.body.appendChild(ov);
        const old = await load(isGrok() ? 'gr_inbox' : 'inbox');
        d.querySelector('#oldEm').textContent = old ? `📧 ${old.email}` : '';
        if (old) d.querySelector('#bo').style.display = 'block';
        const close = r => { ov.remove(); res(r); };
        d.querySelector('#bn').onclick = () => close('new');
        d.querySelector('#bo').onclick = () => close('old');
        d.querySelector('#bc').onclick = () => close('cancel');
        ov.onclick = e => { if (e.target === ov) close('cancel'); };
    });
}

// ═══════════════════ HELP ═══════════════════
function showHelp() {
    helpModal?.remove();
    helpModal = document.createElement('div');
    helpModal.style.cssText = 'position:fixed;inset:0;background:var(--govl);z-index:999999;display:flex;align-items:center;justify-content:center;animation:gFd .2s var(--gease) both';
    const m = document.createElement('div');
    m.className = 'gpt-gl';
    m.style.cssText = 'padding:24px;border-radius:20px;max-width:680px;width:92%;max-height:85vh;overflow-y:auto;color:var(--gfg);animation:gIn .3s var(--gease) both';
    m.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
<h2 style="margin:0;font-size:20px;font-weight:600">Помощь — Auto Register</h2>
<button id="ch" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--gmut);padding:0 5px">×</button></div>
<div style="line-height:1.6;font-size:14px">
<div style="margin-bottom:22px">
<h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gfg)">⚙️ Шаг 1. Настройка</h3>
<p style="margin:0 0 10px 0;color:var(--gmut);font-size:13px">Откройте <b style="color:var(--gfg)">☰ → Настройки → Общее</b> и заполните ключи.</p>
</div>
<div style="margin-bottom:22px">
<h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gfg)">🚀 Шаг 2. Grok</h3>
<ol style="margin:0;padding-left:20px;color:var(--gmut);font-size:13px;line-height:1.7">
<li>Откройте <b style="color:var(--gfg)">accounts.x.ai/sign-up</b>.</li>
<li>Нажмите <b style="color:var(--gfg)">☰ → Регистрация Grok</b>.</li>
<li>Если скрипт пишет «Не понял этап» — жмите <b style="color:var(--gfg)">☰ → Настройки → Диагностика → Скопировать отчёт</b> и пришлите мне.</li>
<li>Капчу Cloudflare Turnstile проходите вручную — скрипт ждёт до 2 минут.</li>
</ol>
</div>
<div>
<h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gfg)">🔧 Диагностика</h3>
<p style="margin:0;color:var(--gmut);font-size:13px">Кнопка <b style="color:var(--gfg)">«Дамп Grok DOM в консоль»</b> — если нужно посмотреть сырой DOM.</p>
</div>
</div>`;
    helpModal.appendChild(m);
    document.body.appendChild(helpModal);
    m.querySelector('#ch').onclick = () => { helpModal.remove(); helpModal = null; };
    helpModal.onclick = e => { if (e.target === helpModal) { helpModal.remove(); helpModal = null; } };
}

// ═══════════════════ МЕНЮ ═══════════════════
let menuBtn = null, menuPnl = null, menuVis = false, statusLbl = null;

const ICO_MENU = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
const ICO_COPY = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICO_PASTE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`;
const ICO_REG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
const ICO_CONT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
const ICO_SET = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const ICO_HELP = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

function setStatus(t, c) {
    if (!statusLbl) return;
    statusLbl.textContent = t || '';
    statusLbl.style.color = c || 'var(--gfg)';
}

// ВСЕГДА СЛЕВА, для всех сайтов
function posMenu() {
    if (!menuBtn) return;
    const isMob = innerWidth < 768;
    const left = isMob ? 8 : 12;
    menuBtn.style.left = left + 'px';
    menuBtn.style.right = 'auto';
    menuBtn.style.top = '8px';
    if (menuPnl) {
        menuPnl.style.left = left + 'px';
        menuPnl.style.right = 'auto';
        menuPnl.style.top = '52px';
    }
    if (statusLbl) {
        statusLbl.style.left = left + 'px';
        statusLbl.style.right = 'auto';
        statusLbl.style.top = '44px';
    }
}

function setCanContinue(v) { canContinue = v; if (menuVis) updateMenu(); }
function updateMenu() {
    if (!menuPnl) return;
    const li = loggedIn();
    const r = menuPnl.querySelector('#gr'), cc = menuPnl.querySelector('#gc'),
          cp = menuPnl.querySelector('#gcp'), ps = menuPnl.querySelector('#gps');
    if (r) r.style.display = !li ? 'flex' : 'none';
    if (cc) cc.style.display = canContinue ? 'flex' : 'none';
    if (cp) cp.style.display = li ? 'flex' : 'none';
    if (ps) ps.style.display = li ? 'flex' : 'none';
}
function closeMenu() { if (menuPnl) { menuPnl.style.animation = 'none'; menuPnl.style.display = 'none'; } menuVis = false; }
function toggleMenu() {
    if (!menuPnl) return;
    menuVis = !menuVis;
    if (menuVis) {
        updateMenu();
        menuPnl.style.display = 'flex';
        menuPnl.style.animation = 'none';
        void menuPnl.offsetWidth;
        menuPnl.style.animation = 'gIn .25s var(--gease) both';
    } else closeMenu();
}

async function copyCtx() {
    const msgs = [];
    for (const sel of ['[data-message-author-role]','[data-testid^="conversation-turn-"]','.message','div[class*="markdown"]']) {
        const els = document.querySelectorAll(sel);
        if (!els.length) continue;
        els.forEach(el => {
            const role = el.getAttribute('data-message-author-role') ||
                el.closest('[data-message-author-role]')?.getAttribute('data-message-author-role') || 'unknown';
            const t = el.innerText.trim();
            if (t.length > 5) msgs.push({ role, text: t });
        });
        break;
    }
    if (!msgs.length) return notify('Не найдено сообщений', 'err');
    const text = msgs.map(m => `[${m.role === 'user' ? 'Пользователь' : m.role === 'assistant' ? 'Ассистент' : '?'}]: ${m.text}`).join('\n\n');
    ctx = text;
    await save('ctx', text);
    try {
        if (typeof GM_setClipboard !== 'undefined') GM_setClipboard(text, 'text');
        else await navigator.clipboard.writeText(text);
        notify(`Скопировано (${msgs.length} сообщ., ${text.length} симв.)`, 'ok');
    } catch { notify('Ошибка копирования', 'err'); }
    closeMenu();
}
async function pasteCtx() {
    if (!ctx) ctx = await load('ctx');
    if (!ctx) return notify('Сначала скопируйте контекст', 'warn');
    const inp = document.querySelector('textarea#prompt-textarea,textarea[placeholder*="Message"],textarea[placeholder*="Спросите"],textarea,div[contenteditable="true"]');
    if (!inp) return notify('Поле ввода не найдено', 'err');
    if (inp.tagName === 'TEXTAREA' || inp.tagName === 'INPUT') await typeHuman(inp, ctx);
    else if (inp.isContentEditable) { inp.focus(); inp.innerText = ctx; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    notify(`Вставлено (${ctx.length} симв.)`, 'ok');
    closeMenu();
}

function createMenu() {
    if (menuBtn || !document.body) return;
    menuBtn = document.createElement('button');
    menuBtn.id = 'gpt-menu';
    menuBtn.title = 'Auto Register';
    menuBtn.innerHTML = ICO_MENU;
    menuBtn.style.cssText = `position:fixed;top:8px;left:12px;z-index:99999;width:36px;height:36px;padding:0;background:transparent;color:var(--gfg);border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s var(--gease)`;
    menuBtn.onmouseenter = () => menuBtn.style.background = 'var(--ghov)';
    menuBtn.onmouseleave = () => menuBtn.style.background = 'transparent';
    menuBtn.onclick = e => { e.stopPropagation(); toggleMenu(); };

    statusLbl = document.createElement('div');
    statusLbl.id = 'gpt-status';
    statusLbl.style.cssText = 'position:fixed;top:44px;left:12px;font-size:10px;font-weight:600;color:var(--gfg);text-align:center;width:36px;pointer-events:none';

    menuPnl = document.createElement('div');
    menuPnl.className = 'gpt-gl gpt-pnl';
    menuPnl.style.cssText = 'position:fixed;top:52px;left:12px;z-index:99999;display:none;flex-direction:column;gap:4px;padding:8px;border-radius:var(--grad);min-width:230px;max-width:calc(100vw - 32px)';

    const mkBtn = (id, ico, txt, fn, d = 0, cls = '') => {
        const b = document.createElement('button');
        b.id = id;
        b.className = 'gpt-mi' + (cls ? ' ' + cls : '');
        b.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-right:8px;opacity:.85">${ico}</span><span style="font-size:14px">${txt}</span>`;
        b.style.cssText = `display:flex;align-items:center;padding:10px 12px;background:transparent;color:var(--gfg);border:none;border-radius:10px;cursor:pointer;font-weight:500;text-align:left;animation-delay:${d}ms`;
        b.onclick = e => { e.stopPropagation(); fn(); };
        return b;
    };
    menuPnl.appendChild(mkBtn('gr', ICO_REG, isGrok() ? 'Регистрация Grok' : 'Регистрация', () => { closeMenu(); startReg(); }, 0));
    menuPnl.appendChild(mkBtn('gc', ICO_CONT, 'Продолжить', () => { closeMenu(); setCanContinue(false); running = false; runStage(); }, 40, 'gpt-cont'));
    menuPnl.appendChild(mkBtn('gcp', ICO_COPY, 'Копировать контекст', copyCtx, 80));
    menuPnl.appendChild(mkBtn('gps', ICO_PASTE, 'Вставить контекст', pasteCtx, 120));
    menuPnl.appendChild(mkBtn('gset', ICO_SET, 'Настройки', () => { closeMenu(); openSettings(); }, 160));
    menuPnl.appendChild(mkBtn('ghlp', ICO_HELP, 'Помощь', () => { closeMenu(); showHelp(); }, 200));

    document.body.appendChild(menuBtn);
    document.body.appendChild(menuPnl);
    document.body.appendChild(statusLbl);

    posMenu();
    addEventListener('resize', posMenu);
    try {
        const obs = new MutationObserver(() => posMenu());
        obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}

    document.addEventListener('click', e => {
        if (menuPnl && menuPnl.style.display === 'flex' &&
            !menuPnl.contains(e.target) && !menuBtn.contains(e.target)) closeMenu();
    });
}

// ═══════════════════ WATCHERS ═══════════════════
function urlWatch(cb, timeout = 15000) {
    stopUrl();
    const last = location.href;
    let el = 0;
    urlTimer = setInterval(() => {
        if (location.href !== last) { stopUrl(); cb(); }
        else if ((el += 300) >= timeout) { stopUrl(); cb(true); }
    }, 300);
}
function stopUrl() { if (urlTimer) { clearInterval(urlTimer); urlTimer = null; } }

// ═══════════════════ ЭТАПЫ (ChatGPT) ═══════════════════
async function stageMain() {
    if (loginTried || regDone) return;
    if (onLogin()) return stageLogin();
    notify('Нажимаю "Войти"', 'info');
    loginTried = true;
    let btn = null;
    for (let i = 0; i < 10 && !btn; i++) {
        for (const b of document.querySelectorAll('button,a,div[role="button"]')) {
            if (['Войти','Sign in','Log in','Login'].includes(b.textContent.trim())) { btn = b; break; }
        }
        if (!btn) await sleep(300);
    }
    if (btn) {
        await click(btn);
        urlWatch(() => { loginTried = false; if (!regDone) runStage(); }, 10000);
    } else {
        notify('Кнопка "Войти" не найдена', 'err');
        loginTried = false;
    }
}

async function stageLogin() {
    if (regDone) return;
    const choice = await emailDialog();
    if (choice === 'cancel') return;

    let email;
    if (choice === 'new') {
        setStatus('Почта…');
        if (C.mode === 'simplelogin') {
            if (!C.slRelay) {
                notify('Не указан AgentMail email для SimpleLogin', 'err', 10000);
                return setStatus('');
            }
            const ib = await listInboxes();
            if (!ib.length) { notify('AgentMail: нет inbox', 'err', 12000); return setStatus(''); }
            const relay = ib.find(i => (i.inbox_id || i.email) === C.slRelay);
            if (!relay) { notify(`AgentMail: ящик ${C.slRelay} не найден`, 'err', 10000); return setStatus(''); }
            inbox = { id: relay.inbox_id, email: relay.inbox_id || relay.email };
            const alias = await createAlias();
            if (!alias) return setStatus('');
            email = alias;
            notify(`Алиас: ${alias} → ${inbox.email}`, 'info', 6000);
        } else {
            let ib = await createInbox();
            if (!ib) {
                const list = await listInboxes();
                if (list.length >= 3) {
                    const sorted = list.sort((a, b) => {
                        const ta = new Date(a.created_at || a.createdAt || 0).getTime();
                        const tb = new Date(b.created_at || b.createdAt || 0).getTime();
                        return ta - tb;
                    });
                    for (const old of sorted.slice(0, 2)) await delInbox(old.inbox_id || old.email);
                    ib = await createInbox();
                }
            }
            if (!ib) return setStatus('');
            inbox = ib; email = ib.email;
            notify(`Почта: ${email}`, 'info', 6000);
        }
        codeReqAt = Date.now();
        verifyStats.codeReqTime = codeReqAt;
        verifyStats.inboxId = inbox.id;
        verifyStats.inboxEmail = inbox.email;
        usedIds = new Set();
        await save('usedIds', []);
        await save('codeReqAt', codeReqAt);
        await save('inbox', inbox);
        await save('email', email);
    } else {
        const saved = await load('inbox');
        if (!saved?.id) { notify('Нет сохранённой почты', 'warn', 6000); return setStatus(''); }
        setStatus('Проверка…');
        const ib = await listInboxes();
        const ok = ib.some(i => (i.inbox_id || i.email) === saved.id || (i.inbox_id || i.email) === saved.email);
        if (!ok) {
            notify('Прошлый ящик удалён. Создайте новый.', 'warn', 8000);
            await save('inbox', null); await save('email', null);
            return setStatus('');
        }
        inbox = saved;
        email = (await load('email')) || saved.email;
        codeReqAt = (await load('codeReqAt')) || Date.now();
        notify(`Продолжаю с ${email}`, 'info', 4000);
    }

    let inp = null;
    for (let i = 0; i < 8 && !inp; i++) { inp = findEmail(); if (!inp) await sleep(300); }
    if (!inp) { notify('Поле email не найдено', 'err'); return setStatus(''); }
    await typeHuman(inp, email);
    await delay(100, 300);
    await clickCont();
    urlWatch(() => { if (!regDone) runStage(); }, 12000);
}

async function stagePwd() {
    if (pwdDone || regDone) return;
    const inp = findPwd();
    if (!inp) { running = false; return runStage(); }
    let pwd = await load('pwd');
    if (!pwd) {
        pwd = genPwd();
        await save('pwd', pwd);
        notify(`🔑 Пароль: ${pwd}`, 'warn', 20000);
        try { GM_setClipboard(pwd, 'text'); } catch {}
    }
    setStatus('Пароль…');
    await typeHuman(inp, pwd);
    pwdDone = true;
    await delay(200, 500);
    await clickCont();
    urlWatch(() => { if (!regDone) { running = false; runStage(); } }, 15000);
}

async function watchCode() {
    const start = Date.now();
    setCanContinue(true);
    while (Date.now() - start < 120000) {
        await sleep(1500);
        if (regDone) { setCanContinue(false); return; }
        if (onProfile() || findPwd() || onAboutYou()) {
            setCanContinue(false); running = false; return runStage();
        }
        if (!findCodes()) {
            await sleep(1000);
            if (!findCodes()) {
                setCanContinue(false); running = false; return runStage();
            }
        }
    }
    notify('Авто-переход не сработал. Нажмите «Продолжить».', 'warn', 12000);
}

async function stageVerify() {
    if (verifyDone || regDone || polling) return;
    if (codeDone) { verifyDone = true; return stageProfile(); }
    polling = true;
    verifyStats.attempts = 0;

    if (codeReqAt == null) codeReqAt = (await load('codeReqAt')) || Date.now();
    if (!inbox?.id) inbox = await load('inbox');
    if (!inbox?.id) {
        const em = await load('email');
        if (em) {
            const ib = await listInboxes();
            const f = ib.find(i => (i.inbox_id || i.email) === em);
            if (f) { inbox = { id: f.inbox_id, email: f.inbox_id || f.email }; await save('inbox', inbox); }
        }
    }
    if (!inbox?.id) { notify('Нет ящика. Создайте новую регистрацию.', 'err', 10000); polling = false; return; }
    verifyStats.inboxId = inbox.id;
    verifyStats.inboxEmail = inbox.email;
    notify(`Проверка: ${inbox.email}`, 'info', 4000);

    for (let i = 0; i < C.maxTries; i++) {
        const at = i + 1;
        verifyStats.attempts = at;
        if (at <= 3 || at % 5 === 0) { notify(`Проверка #${at}/${C.maxTries}`, 'dbg', 2000); setStatus(`#${at}`); }
        const r = await findCode();
        verifyStats.lastReason = r.reason || null;
        if (r.found) {
            verifyStats.lastCode = r.code;
            notify(`Код: ${r.code}`, 'ok', 5000);
            const ok = await fillCode(r.code);
            if (ok) {
                codeDone = true;
                usedIds.add(r.msgId);
                await save('usedIds', [...usedIds]);
                await delay(300, 600);
                await clickCont();
                setCanContinue(true);
                polling = false;
                watchCode();
                return;
            }
        }
        await sleep(C.interval);
    }
    notify('Код не найден. Проверьте почту вручную.', 'err', 15000);
    polling = false;
}

async function stageProfile() {
    if (profileDone || regDone) return;
    const { name, age } = findProfile();
    if (name || age) {
        setStatus('Профиль…');
        if (name && !name.value) { const n = genName(); await typeHuman(name, n); notify(`Имя: ${n}`, 'info', 3000); }
        if (age && !age.value) { const a = genAge(); await typeHuman(age, String(a)); notify(`Возраст: ${a}`, 'info', 3000); }
        await delay(200, 500);
        await clickCont();
        profileDone = true;
        urlWatch(() => { if (!regDone) runStage(); }, 15000);
    } else {
        running = false;
        runStage();
    }
}

function runStage() {
    if (isGrok()) {
        if (C.grokEnabled) GR.run();
        return;
    }
    if (!running || regDone) return;
    if (regDone) return;
    if (findPwd() && !pwdDone) return stagePwd();
    if (onProfile() && !profileDone) return stageProfile();
    if (findCodes() || hasVerifyText()) return stageVerify();
    if (onLogin() && !codeDone) return stageLogin();
    if (!loggedIn() && !regDone) return stageMain();
}

function detect() {
    if (isGrok()) return 'grok-' + GR.detectStage();
    if (location.hostname.includes('auth.openai.com')) return 'auth';
    if (loggedIn()) return 'logged';
    if (onLogin()) return 'login';
    if (findPwd()) return 'pwd';
    if (onProfile()) return 'profile';
    if (findCodes() || hasVerifyText()) return 'verify';
    return 'main';
}

async function startReg() {
    if (isGrok()) {
        if (!C.grokEnabled) { notify('Grok выключен в настройках', 'warn', 5000); return; }
        log('INFO', 'startReg', 'Grok registration');
        GS.emailDone = false; GS.codeDone = false; GS.profileDone = false; GS.regDone = false;
        GS.turnstileSolved = false; GS.detectedStage = null;
        await save('gr_codeDone', false);
        await save('gr_profileDone', false);
        await save('gr_emailDone', false);
        const ok = await ensureKeys();
        if (!ok) { notify('Ключи не заданы', 'warn', 5000); return; }
        // Небольшая задержка: даём странице дорендериться
        await sleep(500);
        await GR.run();
        return;
    }
    codeDone = false; profileDone = false; regDone = false; running = false;
    loginTried = false; verifyDone = false; pwdDone = false;
    canContinue = false; profileNotified = false;
    const ok = await ensureKeys();
    if (!ok) { notify('Ключи не заданы', 'warn', 5000); return; }
    running = true;
    runStage();
}

// ═══════════════════ INIT ═══════════════════
async function init() {
    if (inited) return;
    inited = true;
    log('INFO', 'init', 'start. host=' + location.hostname + ' path=' + location.pathname);
    injectCSS();

    const dbg = await load('debug');
    if (dbg === true) C.debug = true;
    const ge = await load('grokEnabled');
    if (ge === false) C.grokEnabled = false;

    createMenu();
    updateMenu();

    await sleep(300);

    if (isGrok()) {
        const codeDoneSaved = await load('gr_codeDone');
        const profileDoneSaved = await load('gr_profileDone');
        const emailDoneSaved = await load('gr_emailDone');
        if (codeDoneSaved) GS.codeDone = true;
        if (profileDoneSaved) GS.profileDone = true;
        if (emailDoneSaved) GS.emailDone = true;
        GS.inbox = await load('gr_inbox');
        GS.codeReqAt = await load('gr_codeReqAt');

        const stage = GR.detectStage();
        log('INFO', 'init', 'Grok stage=' + stage);
        // Автозапуск только если регистрация уже начата (есть сохранённый inbox)
        if (C.grokEnabled && GS.inbox?.id && stage !== 'unknown' && !GS.regDone) {
            if (stage === 'code' || stage === 'profile') {
                setTimeout(() => GR.run(), 1500);
            }
        }
        return;
    }

    if (!loggedIn() && !onLogin() && !regDone && !running) {
        setTimeout(() => { if (!running) { running = true; runStage(); } }, 1000);
    } else if (findCodes() || hasVerifyText()) {
        running = true;
        setTimeout(runStage, 500);
    }
}

init();

})();
