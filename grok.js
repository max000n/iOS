// ==UserScript==
// @name         Grok Auto Register
// @namespace    http://tampermonkey.net/
// @version      84.0
// @description  Авторегистрация Grok + копирование/вставка контекста + удаление алиасов
// @author       You
// @match        https://accounts.x.ai/*
// @match        https://grok.com/*
// @match        https://*.grok.com/*
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

// ═══════════════════ КОНФИГ ═══════════════════
const C = {
    amKey: '', amBase: 'https://api.agentmail.to/v0',
    slKey: '', slBase: 'https://app.simplelogin.io',
    slRelay: '', slDomain: '', slPrefix: '', slAlias: '',
    mode: 'agentmail',
    interval: 3000, maxTries: 120, tolMs: 60000,
    fast: true, retries: 3,
    debug: false,
};

// ═══════════════════ СОСТОЯНИЕ ═══════════════════
const GS = {
    methodDone: false, emailDone: false, codeDone: false, profileDone: false, regDone: false,
    running: false, polling: false,
    inbox: null, codeReqAt: null, usedIds: new Set(),
    attempts: 0, lastReason: null, lastCode: null,
    turnstileSolved: false,
    detectedStage: null,
    consecutiveNoCode: 0,
    lastError: null,
    forceNewInbox: false,
    // SimpleLogin alias, созданный в текущем сеансе
    slAliasId: null,
    slAliasEmail: null,
};

let inited = false,
    helpModal = null,
    settingsModal = null,
    ctx = null;

const isAccounts = () => location.hostname === 'accounts.x.ai';
const isGrokChat = () => location.hostname === 'grok.com' || location.hostname.endsWith('.grok.com');

// ═══════════════════ ЛОГИ ═══════════════════
const LOG_MAX = 800;
const logBuf = [];
let diagErrors = [];

function ts() {
    const d = new Date();
    return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function logAlways(tag, ...args) {
    const msg = args.map(a => {
        if (a instanceof Error) return a.message;
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
        return String(a);
    }).join(' ');
    const line = `[${ts()}] [INFO] [${tag}] ${msg}`;
    logBuf.push(line);
    if (logBuf.length > LOG_MAX) logBuf.shift();
    if (logBuf.length % 5 === 0) GM.setValue('cg_logs', logBuf.slice(-300)).catch(() => {});
    console.log(line);
}

function logError(tag, ...args) {
    const msg = args.map(a => {
        if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
        return String(a);
    }).join(' ');
    const line = `[${ts()}] [ERROR] [${tag}] ${msg}`;
    logBuf.push(line);
    if (logBuf.length > LOG_MAX) logBuf.shift();
    diagErrors.push(line);
    if (diagErrors.length > 150) diagErrors.shift();
    console.log(line);
}

addEventListener('error', e => logError('window', e.message + ' at ' + e.filename + ':' + e.lineno));
addEventListener('unhandledrejection', e => logError('promise', e.reason?.message || String(e.reason)));

// ═══════════════════ STORAGE ═══════════════════
async function save(k, v) {
    try { await GM.setValue('cg_' + k, v); return true; }
    catch (e) { logError('save', k + ': ' + (e.message || e)); return false; }
}
async function load(k) {
    try { return await GM.getValue('cg_' + k, null); }
    catch (e) { logError('load', k + ': ' + (e.message || e)); return null; }
}
async function loadKeys() {
    C.amKey = (await load('amKey')) || '';
    C.slKey = (await load('slKey')) || '';
    C.slRelay = (await load('slRelay')) || '';
    C.slDomain = (await load('slDomain')) || '';
    C.slPrefix = (await load('slPrefix')) || '';
    C.slAlias = (await load('slAlias')) || '';
    C.mode = (await load('mode')) || 'agentmail';
    const dbg = await load('debug');
    if (dbg === true) C.debug = true;
    logAlways('loadKeys', 'mode=' + C.mode +
        ' am=' + (C.amKey ? 'да' : 'нет') +
        ' sl=' + (C.slKey ? 'да' : 'нет') +
        ' relay=' + (C.slRelay || '—') +
        ' domain=' + (C.slDomain || '—') +
        ' alias=' + (C.slAlias || '—'));
}

// ═══════════════════ ДАМП DOM ═══════════════════
function dumpGrokDOM() {
    const out = [];
    const push = (label, val) => out.push(label + ': ' + val);
    push('--- DOM DUMP ---', '');
    push('URL', location.href);
    push('readyState', document.readyState);
    push('html.lang', document.documentElement.lang);
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
            rect: { w: Math.round(r.width), h: Math.round(r.height) }
        }));
    });
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
    push('forms.total', document.querySelectorAll('form').length);
    const iframes = [...document.querySelectorAll('iframe')];
    push('iframes.total', iframes.length);
    iframes.slice(0, 10).forEach((el, i) => {
        push(`iframe[${i}]`, JSON.stringify({ src: (el.src || '').slice(0, 120), id: el.id, name: el.name, visible: el.offsetParent !== null }));
    });
    push('turnstile.response input', !!document.querySelector('input[name="cf-turnstile-response"]'));
    push('turnstile.div[data-sitekey]', !!document.querySelector('div[data-sitekey]'));
    push('turnstile.iframe', !!document.querySelector('iframe[src*="challenges.cloudflare.com"]'));
    push('turnstile checkbox input', !!document.querySelector('input[type="checkbox"]'));
    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800);
    push('body.innerText (800)', bodyText);
    [...document.querySelectorAll('h1, h2')].slice(0, 5).forEach((el, i) => {
        push(`heading[${i}]`, (el.textContent || '').trim().slice(0, 100));
    });
    push('--- END DUMP ---', '');
    return out.join('\n');
}

// ═══════════════════ ОТЧЁТ ═══════════════════
async function buildReport() {
    const p = [];
    p.push('═══ GROK AUTO REGISTER — ОТЧЁТ ═══');
    p.push('Дата: ' + new Date().toISOString());
    p.push('Версия: 84.0');
    p.push('URL: ' + location.href);
    p.push('Хост: ' + location.hostname);
    p.push('Сайт: ' + (isAccounts() ? 'accounts.x.ai' : isGrokChat() ? 'grok.com (только меню)' : 'неизвестный'));
    p.push('readyState: ' + document.readyState);
    p.push('Окно: ' + innerWidth + '×' + innerHeight);
    p.push('');
    p.push('─── СОСТОЯНИЕ ───');
    p.push('GS.methodDone: ' + GS.methodDone);
    p.push('GS.emailDone: ' + GS.emailDone);
    p.push('GS.codeDone: ' + GS.codeDone);
    p.push('GS.profileDone: ' + GS.profileDone);
    p.push('GS.regDone: ' + GS.regDone);
    p.push('GS.running: ' + GS.running);
    p.push('GS.polling: ' + GS.polling);
    p.push('GS.attempts: ' + GS.attempts);
    p.push('GS.consecutiveNoCode: ' + GS.consecutiveNoCode);
    p.push('GS.lastReason: ' + GS.lastReason);
    p.push('GS.lastCode: ' + GS.lastCode);
    p.push('GS.lastError: ' + GS.lastError);
    p.push('GS.detectedStage: ' + GS.detectedStage);
    p.push('GS.turnstileSolved: ' + GS.turnstileSolved);
    p.push('GS.forceNewInbox: ' + GS.forceNewInbox);
    p.push('GS.inbox: ' + JSON.stringify(GS.inbox));
    p.push('GS.codeReqAt: ' + (GS.codeReqAt ? new Date(GS.codeReqAt).toISOString() : null));
    p.push('GS.usedIds.size: ' + GS.usedIds.size);
    p.push('GS.slAliasId: ' + (GS.slAliasId || '—'));
    p.push('GS.slAliasEmail: ' + (GS.slAliasEmail || '—'));
    p.push('');
    p.push('─── КОНФИГ ───');
    p.push('mode: ' + C.mode + ' | slDomain: ' + (C.slDomain || '—') + ' | slPrefix: ' + (C.slPrefix || '—') + ' | slRelay: ' + (C.slRelay || '—'));
    p.push('slAlias: ' + (C.slAlias || '—'));
    p.push('amKey: ' + (C.amKey ? 'да' : 'нет') + ' | slKey: ' + (C.slKey ? 'да' : 'нет'));
    p.push('debug: ' + C.debug);
    p.push('');
    if (isAccounts()) {
        p.push('detect(): ' + GR.detectStage());
        p.push('menuBtn.left: ' + (menuBtn ? menuBtn.style.left : '—'));
        p.push('');
        p.push('─── DOM ───');
        p.push('GR.hasMethodChoice(): ' + GR.hasMethodChoice());
        p.push('GR.findMethodEmailBtn(): ' + (GR.findMethodEmailBtn() ? 'есть' : 'нет'));
        p.push('GR.findEmail(): ' + (GR.findEmail() ? 'есть' : 'нет'));
        p.push('GR.findCode(): ' + (GR.findCode() ? 'есть' : 'нет'));
        p.push('GR.findGivenName(): ' + (GR.findGivenName() ? 'есть' : 'нет'));
        p.push('GR.findFamilyName(): ' + (GR.findFamilyName() ? 'есть' : 'нет'));
        p.push('GR.findPwd(): ' + (GR.findPwd() ? 'есть' : 'нет'));
        p.push('GR.hasCodeError(): ' + GR.hasCodeError());
        p.push('GR.findResendBtn(): ' + (GR.findResendBtn() ? 'есть' : 'нет'));
        const sbE = GR.findSubmit('email');
        const sbC = GR.findSubmit('code');
        const sbP = GR.findSubmit('profile');
        p.push('GR.findSubmit(email): ' + (sbE ? `"${(sbE.textContent||'').trim().slice(0,40)}"` : 'нет'));
        p.push('GR.findSubmit(code): ' + (sbC ? `"${(sbC.textContent||'').trim().slice(0,40)}"` : 'нет'));
        p.push('GR.findSubmit(profile): ' + (sbP ? `"${(sbP.textContent||'').trim().slice(0,40)}"` : 'нет'));
        p.push('GR.hasTurnstile(): ' + GR.hasTurnstile());
        p.push('GR.turnstileSolved(): ' + GR.turnstileSolved());
        p.push('GR.detectStage(): ' + GR.detectStage());
    } else {
        p.push('Режим: только меню (grok.com)');
    }
    p.push('inputs.total: ' + document.querySelectorAll('input').length);
    p.push('buttons.total: ' + document.querySelectorAll('button').length);
    p.push('');
    p.push('─── DOM DUMP ───');
    p.push(dumpGrokDOM());
    p.push('');
    p.push('─── ОШИБКИ (' + diagErrors.length + ') ───');
    if (!diagErrors.length) p.push('(нет)');
    else diagErrors.slice(-30).forEach(e => p.push(e));
    p.push('');
    p.push('─── ЛОГ (' + logBuf.length + ') ───');
    if (!logBuf.length) p.push('(пусто)');
    else logBuf.slice(-300).forEach(l => p.push(l));
    p.push('═══ КОНЕЦ ═══');
    return p.join('\n');
}

async function copyReport() {
    const report = await buildReport();
    let ok = false;
    try {
        if (typeof GM_setClipboard !== 'undefined') { GM_setClipboard(report, 'text'); ok = true; }
        else if (navigator.clipboard) { await navigator.clipboard.writeText(report); ok = true; }
    } catch (e) { logError('copyReport', e); }
    showReportModal(report, ok);
}

function showReportModal(report, copied) {
    document.getElementById('grok-report-modal')?.remove();
    const ov = document.createElement('div');
    ov.id = 'grok-report-modal';
    ov.style.cssText = 'position:fixed;inset:0;background:var(--govl);z-index:9999999;display:flex;align-items:center;justify-content:center;animation:gFd .2s var(--gease) both';
    const m = document.createElement('div');
    m.className = 'grok-gl';
    m.style.cssText = 'padding:20px;border-radius:20px;max-width:820px;width:94%;max-height:90vh;display:flex;flex-direction:column;color:var(--gfg);animation:gIn .3s var(--gease) both';
    m.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
<h2 style="margin:0;font-size:17px;font-weight:600">Отчёт</h2>
<button id="grmc" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gmut);padding:0 5px">×</button></div>
<p style="margin:0 0 10px 0;font-size:12px;color:var(--gmut)">${copied ? '✓ Скопировано.' : '⚠ Буфер недоступен.'} Размер: ${report.length}</p>
<textarea id="grmt" readonly style="flex:1;min-height:480px;width:100%;padding:12px;border-radius:10px;border:1px solid var(--gbd);background:var(--gelev);color:var(--gfg);font-family:ui-monospace,monospace;font-size:11px;resize:vertical;box-sizing:border-box"></textarea>
<div style="display:flex;gap:10px;margin-top:12px">
<button id="grmc2" style="flex:1;padding:12px;background:var(--gacc);color:var(--gaccf);border:none;border-radius:999px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Скопировать снова</button>
<button id="grmclr" style="padding:12px 20px;background:transparent;color:var(--gdngr);border:1px solid var(--gbd);border-radius:999px;font-size:14px;cursor:pointer;font-family:inherit">Очистить логи</button>
</div>`;
    ov.appendChild(m); document.body.appendChild(ov);
    const txt = m.querySelector('#grmt');
    txt.value = report;
    m.querySelector('#grmc').onclick = () => ov.remove();
    m.querySelector('#grmc2').onclick = async () => {
        try {
            if (typeof GM_setClipboard !== 'undefined') GM_setClipboard(report, 'text');
            else { txt.focus(); txt.select(); document.execCommand('copy'); }
            notify('Скопировано', 'ok', 2000);
        } catch { notify('Не удалось', 'err', 3000); }
    };
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
    if (document.getElementById('grok-css')) return;
    const s = document.createElement('style');
    s.id = 'grok-css';
    s.textContent = `
:root{--gbg:#fff;--gelev:#f4f4f4;--gfg:#0d0d0d;--gmut:#8e8e8e;--gbd:rgba(0,0,0,.1);
--ghov:#ececec;--gshd:rgba(0,0,0,.1);--govl:rgba(0,0,0,.45);--gacc:#0d0d0d;--gaccf:#fff;--gdngr:#ef4146;
--grad:12px;--gease:cubic-bezier(.16,1,.3,1)}
@media(prefers-color-scheme:dark){:root{--gbg:#212121;--gelev:#2f2f2f;--gfg:#ececec;--gmut:#8e8e8e;
--gbd:rgba(255,255,255,.1);--ghov:#2f2f2f;--gshd:rgba(0,0,0,.5);--govl:rgba(0,0,0,.65);
--gacc:#ececec;--gaccf:#0d0d0d}}
html.dark{--gbg:#212121;--gelev:#2f2f2f;--gfg:#ececec;--gmut:#8e8e8e;--gbd:rgba(255,255,255,.1);
--ghov:#2f2f2f;--gshd:rgba(0,0,0,.5);--govl:rgba(0,0,0,.65);--gacc:#ececec;--gaccf:#0d0d0d}
.grok-gl{background:var(--gbg);border:1px solid var(--gbd);box-shadow:0 8px 32px var(--gshd)}
.grok-in{width:100%;padding:11px 14px;border-radius:12px;border:1px solid var(--gbd);background:var(--gelev);
color:var(--gfg);font-size:14px;box-sizing:border-box;font-family:inherit;transition:border-color .2s var(--gease)}
.grok-in:focus{outline:none;border-color:var(--gfg)}
.grok-lbl{display:block;margin-bottom:8px;color:var(--gfg);font-size:13px;font-weight:600}
.grok-hint{color:var(--gmut);font-size:12px;margin-top:6px;line-height:1.5}
.grok-seg{display:flex;background:var(--gelev);border-radius:12px;padding:3px;gap:2px}
.grok-seg button{flex:1;padding:10px;background:transparent;color:var(--gmut);border:none;border-radius:9px;
cursor:pointer;font-size:13px;font-weight:500;font-family:inherit;transition:.18s var(--gease)}
.grok-seg button.active{background:var(--gbg);color:var(--gfg);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.grok-btn{padding:14px;background:var(--gacc);color:var(--gaccf);border:none;border-radius:999px;
font-size:15px;cursor:pointer;font-weight:600;font-family:inherit;transition:opacity .15s var(--gease)}
.grok-btn:hover{opacity:.9}
.grok-ghost{padding:12px;background:transparent;color:var(--gmut);border:none;font-size:14px;cursor:pointer;font-family:inherit}
@keyframes gIn{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes gFd{from{opacity:0}to{opacity:1}}
@keyframes gIt{from{opacity:0;transform:translateX(-4px)}to{opacity:1;transform:translateX(0)}}
.grok-pnl{animation:gIn .25s var(--gease) both}
.grok-mi{animation:gIt .3s var(--gease) both;transition:background .15s var(--gease),transform .1s var(--gease)}
.grok-mi:hover{background:var(--ghov)!important}
.grok-mi:active{transform:scale(.98)}`;
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
    if (!el) return false;
    logAlways('click', (el.tagName || '?') + ' "' + (el.textContent || '').trim().slice(0, 40) + '"');
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

// ═══════════════════ HTTP ═══════════════════
function req(opts) {
    const short = (opts.url || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 80);
    logAlways('http', (opts.method || 'GET') + ' ' + short);
    return new Promise(res => GM_xmlhttpRequest({
        ...opts,
        onload: r => {
            logAlways('http', '← ' + r.status + ' ' + short + (r.status >= 400 ? ' BODY=' + (r.responseText || '').slice(0, 200) : ''));
            res(r);
        },
        onerror: e => { logAlways('http', 'net error: ' + short); res({ status: 0, responseText: '', error: e }); },
        ontimeout: () => { logAlways('http', 'timeout: ' + short); res({ status: 0, responseText: 'timeout' }); },
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
    logAlways('notify', '[' + type + '] ' + text);
    if (!ntfCont) {
        ntfCont = document.createElement('div');
        ntfCont.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:999999;display:flex;flex-direction:column;gap:8px;max-width:90%;width:480px;pointer-events:none';
        document.body.appendChild(ntfCont);
    }
    const colors = { info: '#3498db', ok: '#8e8e8e', warn: '#f39c12', err: '#ef4146', dbg: '#8e8e8e' };
    const el = document.createElement('div');
    el.className = 'grok-gl';
    el.style.cssText = `padding:12px 16px;border-radius:12px;font-size:14px;border-left:4px solid ${colors[type] || '#8e8e8e'};pointer-events:auto;color:var(--gfg);animation:gFd .25s var(--gease) both`;
    el.textContent = text;
    ntfCont.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity .4s';
        setTimeout(() => el.remove(), 400);
    }, dur);
}

// ═══════════════════ SIMPLELOGIN: ДОМЕНЫ ═══════════════════
async function loadSimpleLoginDomains(selectEl, btnEl) {
    if (!C.slKey) { notify('Сначала укажите SimpleLogin API Key', 'warn', 4000); return; }
    btnEl.disabled = true;
    btnEl.textContent = 'Загрузка…';
    try {
        const r = await reqRetry({
            method: 'GET',
            url: `${C.slBase}/api/v5/alias/options`,
            headers: { Authentication: C.slKey, Accept: 'application/json' },
        }, 'SimpleLogin');
        if (r.status !== 200) { notify(`SimpleLogin: ${r.status} — не удалось загрузить домены`, 'err', 8000); return; }
        let data;
        try { data = JSON.parse(r.responseText); } catch { notify('SimpleLogin: некорректный ответ', 'err', 6000); return; }
        const suffixes = Array.isArray(data.suffixes) ? data.suffixes : [];
        const free = suffixes.filter(s => s && s.is_premium === false && !s.is_custom);
        const domains = [];
        for (const s of free) {
            const raw = String(s.suffix || '');
            const at = raw.lastIndexOf('@');
            const dom = (at >= 0 ? raw.slice(at + 1) : raw).replace(/^\.+/, '').trim();
            if (dom && !domains.includes(dom)) domains.push(dom);
        }
        selectEl.innerHTML = '';
        if (!domains.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '— нет бесплатных доменов —';
            selectEl.appendChild(opt);
            notify('SimpleLogin: бесплатных доменов не найдено', 'warn', 6000);
            return;
        }
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '— выберите домен —';
        selectEl.appendChild(blank);
        for (const d of domains) {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            selectEl.appendChild(opt);
        }
        if (C.slDomain && domains.includes(C.slDomain)) selectEl.value = C.slDomain;
        notify(`Загружено доменов: ${domains.length}`, 'ok', 4000);
    } catch (e) {
        logError('loadSLDomains', e);
        notify('SimpleLogin: ошибка загрузки доменов', 'err', 8000);
    } finally {
        btnEl.disabled = false;
        btnEl.textContent = 'Загрузить домены';
    }
}

// ═══════════════════ SIMPLELOGIN: УДАЛЕНИЕ АЛИАСА ═══════════════════
async function deleteSimpleLoginAlias(aliasId) {
    if (!aliasId) return false;
    if (!C.slKey) return false;
    logAlways('slDelete', 'удаляю алиас id=' + aliasId);
    const r = await req({
        method: 'DELETE',
        url: `${C.slBase}/api/aliases/${aliasId}`,
        headers: { Authentication: C.slKey, Accept: 'application/json' },
    });
    if (r.status === 200 || r.status === 204) {
        logAlways('slDelete', 'успешно удалён id=' + aliasId);
        return true;
    }
    // Иногда SimpleLogin использует 404 если уже удалён — считаем успехом
    if (r.status === 404) {
        logAlways('slDelete', 'алиас уже удалён id=' + aliasId);
        return true;
    }
    logError('slDelete', `не удалось удалить id=${aliasId} status=${r.status} body=${(r.responseText||'').slice(0,120)}`);
    return false;
}

// ═══════════════════ НАСТРОЙКИ ═══════════════════
async function openSettings() {
    await loadKeys();

    return new Promise(res => {
        settingsModal?.remove();
        settingsModal = document.createElement('div');
        settingsModal.style.cssText = 'position:fixed;inset:0;background:var(--govl);z-index:999999;display:flex;align-items:center;justify-content:center;animation:gFd .2s var(--gease) both';
        const d = document.createElement('div');
        d.className = 'grok-gl';
        d.style.cssText = 'padding:24px;border-radius:20px;max-width:560px;width:92%;max-height:92vh;display:flex;flex-direction:column;color:var(--gfg);animation:gIn .3s var(--gease) both';
        d.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
<h2 style="margin:0;font-size:18px;font-weight:600">Настройки</h2>
<button id="gcs" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gmut);padding:0 5px">×</button></div>
<div class="grok-seg" id="gtabs" style="margin-bottom:18px">
<button data-t="general" class="active">Общее</button>
<button data-t="diag">Диагностика</button>
</div>
<div id="pane-general" style="overflow-y:auto;max-height:65vh;padding-right:4px">
<p style="color:var(--gmut);font-size:12px;margin:0 0 16px 0">Ключи сохраняются в Tampermonkey.</p>
<label class="grok-lbl">Режим</label>
<div class="grok-seg" id="gm" style="margin-bottom:18px">
<button data-m="agentmail">AgentMail</button>
<button data-m="simplelogin">SimpleLogin</button></div>
<div id="amBlock">
<label class="grok-lbl">AgentMail API Key *</label>
<input id="amin" class="grok-in" type="password" placeholder="am_..." autocomplete="off">
<p class="grok-hint">console.agentmail.to → API Keys.</p></div>
<div style="height:14px"></div>
<div id="slBlock" style="display:none">
<label class="grok-lbl">SimpleLogin API Key *</label>
<input id="slin" class="grok-in" type="password" placeholder="sl_..." autocomplete="off">
<div style="height:12px"></div>
<label class="grok-lbl">AgentMail relay email *</label>
<input id="slemail" class="grok-in" type="email" placeholder="relay@agentmail.to" autocomplete="off">
<div style="height:12px"></div>
<label class="grok-lbl">Домен SimpleLogin (только бесплатные)</label>
<div style="display:flex;gap:8px;align-items:stretch">
<select id="sldomain" class="grok-in" style="flex:1;cursor:pointer">
<option value="">— не выбрано —</option>
</select>
<button type="button" id="slload" style="padding:0 16px;border-radius:12px;border:1px solid var(--gbd);background:var(--gelev);color:var(--gfg);cursor:pointer;font-family:inherit;font-size:13px;white-space:nowrap">Загрузить домены</button>
</div>
<div style="height:12px"></div>
<label class="grok-lbl">Готовый SimpleLogin alias (опционально)</label>
<input id="slalias" class="grok-in" type="email" placeholder="например: myalias@slmail.me" autocomplete="off">
<p class="grok-hint">Если указан — скрипт возьмёт его напрямую (без API). <b>Не удаляется автоматически</b> после регистрации (это ваш алиас).</p>
<div style="height:12px"></div>
<label class="grok-lbl">Префикс алиаса (опционально)</label>
<input id="slprefix" class="grok-in" type="text" placeholder="оставьте пустым" autocomplete="off">
<p class="grok-hint">Авто-созданные алиасы удаляются после успешной регистрации.</p>
</div>
</div>
<div id="pane-diag" style="display:none;overflow-y:auto;max-height:65vh;padding-right:4px">
<label class="grok-lbl">Диагностика</label>
<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--gelev);border-radius:12px;margin-bottom:12px">
<span style="font-size:13px;color:var(--gfg)">Подробный лог</span>
<span id="gsw" style="position:relative;width:38px;height:22px;background:${C.debug ? 'var(--gfg)' : '#8e8e8e'};border-radius:999px;flex-shrink:0;cursor:pointer;transition:background .2s var(--gease)">
<span style="position:absolute;top:3px;left:3px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s var(--gease);box-shadow:0 1px 3px rgba(0,0,0,.3);transform:translateX(${C.debug ? '16px' : '0'})"></span></span></div>
<button id="grepBtn" style="width:100%;padding:12px;background:var(--gelev);color:var(--gfg);border:1px solid var(--gbd);border-radius:999px;font-size:13px;cursor:pointer;font-family:inherit;margin-bottom:12px">Скопировать отчёт</button>
<button id="gdumpBtn" style="width:100%;padding:12px;background:var(--gelev);color:var(--gfg);border:1px solid var(--gbd);border-radius:999px;font-size:13px;cursor:pointer;font-family:inherit;margin-bottom:12px">Дамп DOM в консоль</button>
<p style="color:var(--gmut);font-size:12px;margin:0 0 8px 0">Live-состояние:</p>
<div style="background:var(--gelev);padding:10px 12px;border-radius:10px;font-family:ui-monospace,monospace;font-size:11px;color:var(--gmut);line-height:1.6;white-space:pre-wrap">host: ${location.hostname}
stage: ${isAccounts() ? GR.detectStage() : '—'}
GS.running: ${GS.running}
GS.polling: ${GS.polling}
GS.methodDone: ${GS.methodDone}
GS.emailDone: ${GS.emailDone}
GS.codeDone: ${GS.codeDone}
GS.profileDone: ${GS.profileDone}
GS.attempts: ${GS.attempts}
GS.consecutiveNoCode: ${GS.consecutiveNoCode}
GS.slAliasId: ${GS.slAliasId || '—'}</div>
</div>
<div style="height:16px"></div>
<div style="display:flex;flex-direction:column;gap:10px">
<button id="gsave" class="grok-btn">Сохранить</button>
<button id="gclr" style="padding:10px;background:transparent;color:var(--gdngr);border:1px solid var(--gbd);border-radius:999px;font-size:13px;cursor:pointer;font-family:inherit">Удалить ключи</button>
<button id="gcancel" class="grok-ghost">Отмена</button></div>`;
        settingsModal.appendChild(d); document.body.appendChild(settingsModal);
        const tabsEl = d.querySelector('#gtabs'), tabBtns = tabsEl.querySelectorAll('button');
        const paneGen = d.querySelector('#pane-general'), paneDiag = d.querySelector('#pane-diag');
        tabBtns.forEach(b => b.onclick = () => {
            const t = b.dataset.t;
            tabBtns.forEach(x => x.classList.toggle('active', x.dataset.t === t));
            paneGen.style.display = t === 'general' ? 'block' : 'none';
            paneDiag.style.display = t === 'diag' ? 'block' : 'none';
        });
        const am = d.querySelector('#amin'), sl = d.querySelector('#slin'),
              sle = d.querySelector('#slemail'), sld = d.querySelector('#sldomain'),
              sla = d.querySelector('#slalias'), slp = d.querySelector('#slprefix'),
              sll = d.querySelector('#slload'), slB = d.querySelector('#slBlock');

        if (C.amKey) am.value = C.amKey;
        if (C.slKey) sl.value = C.slKey;
        if (C.slRelay) sle.value = C.slRelay;
        if (C.slPrefix) slp.value = C.slPrefix;
        if (C.slAlias) sla.value = C.slAlias;
        if (C.slDomain) {
            const opt = document.createElement('option');
            opt.value = C.slDomain;
            opt.textContent = C.slDomain + ' (сохранён)';
            sld.appendChild(opt);
            sld.value = C.slDomain;
        }

        sll.onclick = () => loadSimpleLoginDomains(sld, sll);

        let mode = C.mode;
        const seg = d.querySelector('#gm'), btns = seg.querySelectorAll('button');
        const upd = () => {
            btns.forEach(b => b.classList.toggle('active', b.dataset.m === mode));
            slB.style.display = mode === 'simplelogin' ? 'block' : 'none';
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

        const close = r => { settingsModal.remove(); settingsModal = null; res(r); };
        d.querySelector('#gcs').onclick = () => close(null);
        d.querySelector('#gcancel').onclick = () => close(null);
        settingsModal.onclick = e => { if (e.target === settingsModal) close(null); };

        d.querySelector('#gsave').onclick = async () => {
            const ak = am.value.trim();
            const sk = sl.value.trim();
            const relay = sle.value.trim();
            const domain = sld.value.trim();
            const prefix = slp.value.trim();
            const alias = sla.value.trim();

            if (!ak) return notify('Укажите AgentMail API Key', 'err', 4000);
            if (mode === 'simplelogin' && !sk) return notify('Для SimpleLogin укажите API Key', 'err', 5000);
            if (mode === 'simplelogin' && !relay) return notify('Укажите AgentMail relay email для SimpleLogin', 'err', 5000);
            if (alias && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alias)) return notify('Alias должен быть email-адресом', 'err', 5000);

            const okAm = await save('amKey', ak);
            const okSl = await save('slKey', sk || '');
            const okRelay = await save('slRelay', relay || '');
            const okDomain = await save('slDomain', domain || '');
            const okPrefix = await save('slPrefix', prefix || '');
            const okAlias = await save('slAlias', alias || '');
            const okMode = await save('mode', mode);

            if (!okAm || !okSl || !okRelay || !okDomain || !okPrefix || !okAlias || !okMode) {
                notify('Не все данные сохранились. Попробуйте ещё раз.', 'err', 6000);
                return;
            }

            C.amKey = ak; C.slKey = sk; C.slRelay = relay;
            C.slDomain = domain; C.slPrefix = prefix; C.slAlias = alias;
            C.mode = mode;

            await loadKeys();

            notify('Настройки сохранены', 'ok', 3000);
            logAlways('settings', 'saved: mode=' + C.mode +
                ' am=' + (C.amKey ? 'да' : 'нет') +
                ' sl=' + (C.slKey ? 'да' : 'нет') +
                ' relay=' + (C.slRelay || '—') +
                ' domain=' + (C.slDomain || '—') +
                ' alias=' + (C.slAlias || '—'));
            close(true);
        };

        d.querySelector('#gclr').onclick = async () => {
            await save('amKey', ''); await save('slKey', ''); await save('slRelay', '');
            await save('slDomain', ''); await save('slPrefix', ''); await save('slAlias', '');
            await save('mode', 'agentmail');
            C.amKey = ''; C.slKey = ''; C.slRelay = ''; C.slDomain = ''; C.slPrefix = ''; C.slAlias = ''; C.mode = 'agentmail';
            am.value = ''; sl.value = ''; sle.value = ''; slp.value = ''; sla.value = '';
            sld.innerHTML = '<option value="">— не выбрано —</option>';
            mode = 'agentmail'; upd();
            notify('Ключи удалены', 'ok', 3000);
        };

        d.querySelector('#grepBtn').onclick = () => { settingsModal.remove(); settingsModal = null; copyReport(); };
        d.querySelector('#gdumpBtn').onclick = () => {
            const dump = dumpGrokDOM();
            console.log(dump);
            try { if (typeof GM_setClipboard !== 'undefined') GM_setClipboard(dump, 'text'); } catch {}
            notify('Дамп DOM скопирован (см. консоль)', 'ok', 4000);
        };
        setTimeout(() => am.focus(), 100);
    });
}

async function ensureKeys() {
    await loadKeys();
    if (C.amKey) return true;
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
    logAlways('inbox', 'create ' + username);
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
        notify('AgentMail inbox создан: ' + inboxObj.email, 'ok', 5000);
        return inboxObj;
    } catch { return null; }
}
async function delInbox(id) {
    if (!id) return false;
    const r = await reqRetry({ method: 'DELETE', url: `${C.amBase}/inboxes/${encodeURIComponent(id)}`,
        headers: { Authorization: `Bearer ${C.amKey}` } }, 'AgentMail del');
    return r.status === 200 || r.status === 204 || r.status === 202;
}
async function listInboxes() {
    const r = await reqRetry({ method: 'GET', url: `${C.amBase}/inboxes`,
        headers: { Authorization: `Bearer ${C.amKey}`, Accept: 'application/json' } }, 'AgentMail list');
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

// ═══════════════════ SIMPLELOGIN: СОЗДАНИЕ АЛИАСА ═══════════════════
// Возвращает { email, id } либо null. id нужен для последующего удаления.
async function createAlias() {
    if (!C.slKey) { notify('SimpleLogin: ключ не задан', 'err'); return null; }

    // 1) Ручной alias — не удаляем, id = null
    if (C.slAlias) {
        logAlways('createAlias', 'использую ручной alias: ' + C.slAlias + ' (без удаления)');
        notify('[SL] Использую готовый alias: ' + C.slAlias, 'info', 5000);
        return { email: C.slAlias, id: null };
    }

    // 2) Автосоздание через API с ретраем для 429
    const body = { note: 'Auto Register' };
    if (C.slDomain) body.domain = C.slDomain;
    if (C.slPrefix) body.alias_prefix = C.slPrefix;

    const SL_RETRIES = 5;
    for (let i = 1; i <= SL_RETRIES; i++) {
        const r = await req({
            method: 'POST', url: `${C.slBase}/api/alias/random/new`,
            headers: { Authentication: C.slKey, 'Content-Type': 'application/json', Accept: 'application/json' },
            data: JSON.stringify(body),
        });
        if (r.status === 200 || r.status === 201) {
            try {
                const d = JSON.parse(r.responseText);
                // SimpleLogin возвращает { alias: "xxx@domain", id: 12345, ... } или { email, id }
                const email = d.alias || d.email;
                const id = d.id || d.alias_id || null;
                logAlways('createAlias', `создан: email=${email} id=${id}`);
                return { email, id };
            } catch { return null; }
        }
        if (r.status === 429) {
            const m = (r.responseHeaders || '').match(/retry-after:\s*(\d+)/i);
            const wait = m ? parseInt(m[1]) : 60;
            if (i < SL_RETRIES) {
                notify(`[SL] Лимит API. Ждём ${wait}с (попытка ${i}/${SL_RETRIES})…`, 'warn', wait * 1000 + 1000);
                await sleep(wait * 1000);
                continue;
            }
            logError('createAlias', 'SL rate limit исчерпан после ' + SL_RETRIES + ' попыток');
            notify(
                '[SL] Лимит API исчерпан. Откройте app.simplelogin.io → Aliases → New Custom Alias, ' +
                'создайте алиас вручную и вставьте его в настройках скрипта в поле «Готовый SimpleLogin alias».',
                'err', 20000
            );
            return null;
        }
        notify(`SimpleLogin: ${r.status} ${(r.responseText || '').slice(0, 120)}`, 'err', 12000);
        return null;
    }
    return null;
}

// ═══════════════════ ИЗВЛЕЧЕНИЕ КОДА ═══════════════════
function extractCode(data) {
    if (!data) return null;
    const parts = [data.subject, data.extracted_text, data.extracted_html, data.text, data.html, data.body, data.preview].filter(Boolean);
    const raw = parts.join('\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&zwnj;/g, ' ').replace(/[\u00a0\u200b\u2028\u2029]/g, ' ');

    const dashed = raw.match(/\b(\d{3})[\s-](\d{3})\b/);
    if (dashed) {
        const code = dashed[1] + dashed[2];
        logAlways('extractCode', `dashed XXX-XXX → ${code}`);
        return code;
    }
    const contextual = raw.match(/(?:confirmation code|verification code|security code|ваш код|код подтверждения)[^\d]{0,60}(\d{6})/i)
                    || raw.match(/(\d{6})[^\d]{0,60}(?:is your|код)/i);
    if (contextual) {
        const code = contextual[1] || contextual[0].match(/\d{6}/)[0];
        logAlways('extractCode', `contextual → ${code}`);
        return code;
    }
    const allSix = [...raw.matchAll(/\b(\d{6})\b/g)].map(m => m[1]);
    const filtered = allSix.filter(c => !/^(\d)\1{5}$/.test(c));
    if (filtered.length) {
        logAlways('extractCode', `fallback digits → ${filtered[0]} (из ${allSix.length} найд.)`);
        return filtered[0];
    }
    if (allSix.length) {
        logAlways('extractCode', `WARN: только репдижиты, берём ${allSix[0]}`);
        return allSix[0];
    }
    logAlways('extractCode', 'no code. raw[0..200]=' + raw.slice(0, 200).replace(/\s+/g, ' '));
    return null;
}
const msgTime = m => new Date(m.timestamp || m.created_at || 0).getTime();

async function findCodeFor(gs) {
    if (!gs.inbox?.id) return { found: false, reason: 'no_inbox' };
    const msgs = await listMsgs(gs.inbox.id);
    if (msgs?.__rate) return { found: false, reason: 'rate_limited' };
    if (!msgs) return { found: false, reason: 'api_error' };
    if (!msgs.length) return { found: false, reason: 'no_messages' };
    msgs.sort((a, b) => msgTime(b) - msgTime(a));
    const fresh = msgs.filter(m => !gs.codeReqAt || msgTime(m) >= gs.codeReqAt - C.tolMs);
    if (!fresh.length) {
        const newest = msgTime(msgs[0]);
        logAlways('findCode', `no fresh. newest=${new Date(newest).toISOString()} codeReqAt=${new Date(gs.codeReqAt).toISOString()} diff=${((newest - gs.codeReqAt)/1000).toFixed(0)}s`);
        return { found: false, reason: 'waiting', count: msgs.length };
    }
    logAlways('findCode', `msgs=${msgs.length} fresh=${fresh.length} usedIds=${gs.usedIds.size}`);
    for (const m of fresh) {
        if (gs.usedIds.has(m.message_id)) continue;
        const full = (await getMsg(gs.inbox.id, m.message_id)) || m;
        const preview = [full.subject, full.extracted_text, full.text, full.preview].filter(Boolean).join(' | ').slice(0, 300).replace(/\s+/g, ' ');
        logAlways('findCode', `msg ${m.message_id}: subject="${(full.subject||'').slice(0,80)}" preview="${preview}"`);
        const code = extractCode(full);
        if (code) {
            gs.usedIds.add(m.message_id);
            logAlways('findCode', 'FOUND code=' + code);
            return { found: true, code, msgId: m.message_id };
        }
    }
    return { found: false, reason: 'no_code', count: fresh.length };
}

// ═══════════════════ GROK MODULE ═══════════════════
const GR = {
    _ourIds: ['grok-menu', 'gr', 'gc', 'gcp', 'gps', 'gset', 'ghlp'],

    findMethodEmailBtn() {
        const btns = [...document.querySelectorAll('button, a[role="button"], div[role="button"]')];
        return btns.find(b => {
            const t = (b.textContent || '').trim().toLowerCase();
            const visible = b.offsetParent !== null || (b.getBoundingClientRect().width > 0);
            return visible && /зарегистрироваться через email|sign up with email/i.test(t);
        }) || null;
    },
    hasMethodChoice() {
        const t = document.body?.innerText || '';
        return /Зарегистрироваться через X|Зарегистрироваться через Apple|Зарегистрироваться через Google/i.test(t)
            && !!this.findMethodEmailBtn();
    },
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
    findGivenName() { return document.querySelector('#givenName') || document.querySelector('input[name="givenName"]') || null; },
    findFamilyName() { return document.querySelector('#familyName') || document.querySelector('input[name="familyName"]') || null; },
    findPwd() {
        return document.querySelector('#password') ||
               document.querySelector('input[name="password"]') ||
               [...document.querySelectorAll('input[type="password"]')].find(el => el.offsetParent !== null) ||
               null;
    },
    findSubmit(kind) {
        const btns = [...document.querySelectorAll('button[type="submit"]')];
        const filtered = btns.filter(b => {
            if (this._ourIds.includes(b.id)) return false;
            if (b.closest('.grok-pnl, #grok-menu, #grok-status, #grok-report-modal')) return false;
            return b.offsetParent !== null;
        });
        let patterns;
        if (kind === 'email') patterns = ['зарегистрироваться', 'sign up', 'continue', 'продолжить', 'далее'];
        else if (kind === 'code') patterns = ['подтвердить email', 'verify email', 'confirm email'];
        else if (kind === 'profile') patterns = ['завершить регистрацию', 'complete registration', 'create account'];
        else patterns = ['зарегистрироваться', 'подтвердить email', 'завершить регистрацию', 'продолжить', 'далее'];
        for (const p of patterns) {
            const b = filtered.find(b => b.textContent.trim().toLowerCase().includes(p));
            if (b) return b;
        }
        if (kind === 'email') return filtered[0] || null;
        return null;
    },
    findResendBtn() {
        const btns = [...document.querySelectorAll('button, a[role="button"]')];
        return btns.find(b => {
            const t = (b.textContent || '').trim().toLowerCase();
            return b.offsetParent !== null && /отправить повторно|resend|request a new/i.test(t);
        }) || null;
    },
    hasCodeError() {
        const t = document.body?.innerText || '';
        return /That code is invalid|code is invalid or has expired|Неверный код|Код истёк|expired/i.test(t);
    },
    hasTurnstile() {
        return !!document.querySelector('input[name="cf-turnstile-response"]') ||
               !!document.querySelector('div[data-sitekey]') ||
               !!document.querySelector('iframe[src*="challenges.cloudflare.com"]');
    },
    turnstileSolved() {
        const inp = document.querySelector('input[name="cf-turnstile-response"]');
        if (inp && inp.value && inp.value.length > 10) return true;
        const widget = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
        if (widget) {
            const t = document.body?.innerText || '';
            if (!/Подтвердите, что вы человек|Verify you are human/i.test(t)) return true;
        }
        return false;
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
        if (this.hasMethodChoice()) return 'method';
        return 'unknown';
    },
    async waitFor(predicate, timeoutMs, label) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (predicate.call(this)) { logAlways('waitFor', label + ' появился за ' + (Date.now() - start) + 'ms'); return true; }
            await sleep(200);
        }
        logAlways('waitFor', label + ' НЕ появился за ' + timeoutMs + 'ms');
        return false;
    },
    async submitMethod() {
        const btn = this.findMethodEmailBtn();
        if (!btn) { notify('[GR] Кнопка "через email" не найдена', 'err'); return false; }
        notify('[GR] Выбираю "Зарегистрироваться через email"…', 'info', 4000);
        await click(btn);
        GS.methodDone = true;
        await save('gr_methodDone', true);
        return await this.waitFor(() => !!this.findEmail(), 10000, 'email-input');
    },
    async submitEmail(email) {
        const inp = this.findEmail();
        if (!inp) { notify('[GR] Поле email не найдено', 'err'); return false; }
        notify('[GR] Ввожу email: ' + email, 'info', 4000);
        await typeHuman(inp, email);
        await delay(200, 500);
        const btn = this.findSubmit('email');
        if (!btn) { notify('[GR] Кнопка "Зарегистрироваться" не найдена', 'err'); return false; }
        logAlways('submitEmail', 'жму submit: "' + (btn.textContent || '').trim() + '"');
        await click(btn);
        GS.emailDone = true;
        GS.codeReqAt = Date.now();
        await save('gr_inbox', GS.inbox);
        await save('gr_email', email);
        await save('gr_codeReqAt', GS.codeReqAt);
        await save('gr_emailDone', true);
        return await this.waitFor(() => !!this.findCode(), 15000, 'code-input');
    },
    async submitCode(code) {
        const inp = this.findCode();
        if (!inp) { notify('[GR] Поле для кода не найдено', 'err'); return false; }
        notify('[GR] Ввожу код: ' + code, 'info', 4000);
        await focusEl(inp);
        setVal(inp, '');
        fireInput(inp, '');
        await sleep(200);
        await typeHuman(inp, code);
        logAlways('submitCode', 'после ввода value="' + inp.value + '"');
        await delay(200, 500);

        const btn = this.findSubmit('code');
        if (!btn) logAlways('submitCode', 'кнопка "Подтвердить email" отсутствует — возможно авто-переход');
        else { logAlways('submitCode', 'жму submit: "' + (btn.textContent || '').trim() + '"'); await click(btn); }

        const start = Date.now();
        while (Date.now() - start < 5000) {
            if (this.hasCodeError()) { GS.lastError = 'code_invalid'; logAlways('submitCode', 'Grok отверг код'); return false; }
            if (this.hasProfileText()) {
                logAlways('submitCode', 'profile-форма появилась');
                GS.codeDone = true;
                await save('gr_codeDone', true);
                return true;
            }
            await sleep(200);
        }
        if (!this.hasCodeError()) { GS.codeDone = true; await save('gr_codeDone', true); return true; }
        return false;
    },
    async submitProfile(data) {
        const { givenName, familyName, password } = data;
        const gi = this.findGivenName(), fi = this.findFamilyName(), pi = this.findPwd();
        logAlways('submitProfile', 'gi=' + (gi ? 'есть' : 'нет') + ' fi=' + (fi ? 'есть' : 'нет') + ' pi=' + (pi ? 'есть' : 'нет'));
        if (!gi || !fi || !pi) { notify('[GR] Поля профиля не найдены', 'err'); return false; }
        notify('[GR] Заполняю профиль…', 'info', 4000);

        await typeHuman(gi, givenName); await delay(150, 300);
        await typeHuman(fi, familyName); await delay(150, 300);
        await typeHuman(pi, password); await delay(200, 500);

        logAlways('submitProfile', 'gi.value="' + gi.value + '" fi.value="' + fi.value + '" pi.len=' + pi.value.length);

        if (!gi.value || !fi.value || !pi.value) {
            notify('[GR] Поля не заполнены, пробую force-set', 'warn', 5000);
            setVal(gi, givenName); fireInput(gi, givenName); gi.dispatchEvent(new Event('change', { bubbles: true }));
            setVal(fi, familyName); fireInput(fi, familyName); fi.dispatchEvent(new Event('change', { bubbles: true }));
            setVal(pi, password); fireInput(pi, password); pi.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(300);
        }

        if (this.hasTurnstile()) {
            if (!this.turnstileSolved()) {
                notify('[GR] ⚠ Пройдите капчу Cloudflare Turnstile вручную', 'warn', 15000);
                for (let i = 0; i < 60; i++) {
                    await sleep(2000);
                    if (this.turnstileSolved()) { GS.turnstileSolved = true; notify('[GR] ✓ Капча пройдена', 'ok', 3000); break; }
                    if (i === 29) notify('[GR] Всё ещё ждём капчу…', 'warn', 5000);
                }
                if (!this.turnstileSolved()) { notify('[GR] Капча не пройдена', 'err', 8000); return false; }
            } else GS.turnstileSolved = true;
        }

        const btn = this.findSubmit('profile');
        if (!btn) { notify('[GR] Кнопка "Завершить регистрацию" не найдена', 'err'); return false; }
        logAlways('submitProfile', 'жму submit: "' + (btn.textContent || '').trim() + '"');
        await click(btn);
        await sleep(3000);

        if (this.hasProfileText()) {
            logAlways('submitProfile', 'форма осталась — повторная попытка');
            const gi2 = this.findGivenName(), fi2 = this.findFamilyName(), pi2 = this.findPwd();
            if (gi2 && !gi2.value) { setVal(gi2, givenName); fireInput(gi2, givenName); }
            if (fi2 && !fi2.value) { setVal(fi2, familyName); fireInput(fi2, familyName); }
            if (pi2 && !pi2.value) { setVal(pi2, password); fireInput(pi2, password); }
            await sleep(500);
            const btn2 = this.findSubmit('profile');
            if (btn2) { logAlways('submitProfile', 'повторный submit'); await click(btn2); await sleep(3000); }
        }

        if (!this.hasProfileText()) {
            GS.profileDone = true;
            await save('gr_profileDone', true);
            notify('[GR] Регистрация завершена!', 'ok', 10000);
            GS.regDone = true;
            return true;
        }
        notify('[GR] Профиль не принят, проверь вручную', 'warn', 10000);
        return false;
    },
    // ─── УДАЛЕНИЕ АЛИАСА после успешной регистрации ───
    async cleanupAfterSuccess() {
        if (C.mode !== 'simplelogin') return;
        // Удаляем только автосозданный алиас, ручной — не трогаем
        if (GS.slAliasId) {
            notify('[SL] Удаляю использованный алиас…', 'info', 3000);
            const ok = await deleteSimpleLoginAlias(GS.slAliasId);
            if (ok) {
                logAlways('cleanup', 'алиас удалён: id=' + GS.slAliasId + ' (' + (GS.slAliasEmail || '') + ')');
                notify('[SL] Алиас удалён', 'ok', 3000);
            } else {
                notify('[SL] Не удалось удалить алиас (см. лог)', 'warn', 5000);
            }
            GS.slAliasId = null;
            GS.slAliasEmail = null;
            await save('gr_slAliasId', null);
            await save('gr_slAliasEmail', null);
        }
    },
    async run() {
        if (GS.running) { logAlways('GR', 'run() уже запущен'); return; }
        const stage = this.detectStage();
        GS.detectedStage = stage;
        logAlways('GR', 'run() stage=' + stage);
        if (stage === 'unknown') { notify('[GR] Не понял этап. Скинь отчёт.', 'warn', 12000); return; }
        GS.running = true;
        try {
            if (stage === 'method') {
                if (!await this.submitMethod()) { GS.running = false; return; }
                const email = await this.prepareEmail();
                if (!email) { GS.running = false; return; }
                if (!await this.submitEmail(email)) { GS.running = false; return; }
                await this.pollCode();
            } else if (stage === 'email' && !GS.emailDone) {
                const email = await this.prepareEmail();
                if (!email) { GS.running = false; return; }
                if (!await this.submitEmail(email)) { GS.running = false; return; }
                await this.pollCode();
            } else if (stage === 'code' && !GS.codeDone) {
                if (GS.codeReqAt == null) GS.codeReqAt = (await load('gr_codeReqAt')) || Date.now();
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
                logAlways('GR', 'stage=' + stage + ' уже выполнен');
            }
        } catch (e) { logError('GR', e.message || e); }
        GS.running = false;
    },
    async prepareEmail() {
        if (GS.inbox?.email && !GS.forceNewInbox) {
            notify('[GR] Использую почту: ' + GS.inbox.email, 'info', 4000);
            return GS.inbox.email;
        }
        GS.forceNewInbox = false;
        let email;
        if (C.mode === 'simplelogin') {
            if (!C.slRelay) { notify('[GR] Не указан AgentMail relay', 'err', 10000); return null; }
            const ib = await listInboxes();
            if (!ib.length) { notify('[GR] AgentMail: нет inbox', 'err', 12000); return null; }
            const relay = ib.find(i => (i.inbox_id || i.email) === C.slRelay);
            if (!relay) { notify('[GR] AgentMail: relay не найден: ' + C.slRelay, 'err', 10000); return null; }
            GS.inbox = { id: relay.inbox_id, email: relay.inbox_id || relay.email };
            const res = await createAlias();
            if (!res || !res.email) return null;
            email = res.email;
            GS.slAliasId = res.id || null;
            GS.slAliasEmail = res.email;
            await save('gr_slAliasId', GS.slAliasId);
            await save('gr_slAliasEmail', GS.slAliasEmail);
            logAlways('prepareEmail', 'alias=' + email + ' id=' + (GS.slAliasId || '—'));
            notify('[GR] Алиас: ' + email + ' → ' + GS.inbox.email, 'info', 6000);
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
                    for (const old of sorted.slice(0, 2)) await delInbox(old.inbox_id || old.email);
                    ib = await createInbox();
                }
            }
            if (!ib) return null;
            GS.inbox = ib; email = ib.email;
            notify('[GR] Почта: ' + email, 'info', 6000);
        }
        GS.usedIds = new Set();
        GS.consecutiveNoCode = 0;
        await save('gr_inbox', GS.inbox);
        await save('gr_email', email);
        return email;
    },
    async pollCode() {
        if (GS.polling) { logAlways('GR', 'pollCode уже идёт'); return; }
        GS.polling = true;
        GS.attempts = 0;
        GS.consecutiveNoCode = 0;
        if (!GS.inbox?.id) GS.inbox = await load('gr_inbox');
        if (!GS.inbox?.id) { notify('[GR] Нет ящика.', 'err', 8000); GS.polling = false; return; }
        if (GS.codeReqAt == null) GS.codeReqAt = (await load('gr_codeReqAt')) || Date.now();
        logAlways('GR', 'pollCode start. inbox=' + GS.inbox.email + ' codeReqAt=' + new Date(GS.codeReqAt).toISOString());
        notify('[GR] Жду код на ' + GS.inbox.email, 'info', 5000);

        for (let i = 0; i < C.maxTries; i++) {
            GS.attempts = i + 1;
            const r = await findCodeFor(GS);
            GS.lastReason = r.reason || null;
            if (r.found) {
                GS.lastCode = r.code;
                GS.consecutiveNoCode = 0;
                notify('[GR] Код найден: ' + r.code, 'ok', 6000);
                const ok = await this.submitCode(r.code);
                if (!ok && GS.lastError === 'code_invalid') {
                    notify('[GR] Код отвергнут. Жму "Отправить повторно"…', 'warn', 6000);
                    const resend = this.findResendBtn();
                    if (resend) {
                        await click(resend);
                        GS.codeReqAt = Date.now();
                        await save('gr_codeReqAt', GS.codeReqAt);
                        GS.lastError = null;
                        GS.attempts = 0;
                        notify('[GR] Жду повторное письмо…', 'info', 5000);
                        let newCount = 0;
                        for (let k = 0; k < 30; k++) {
                            await sleep(1000);
                            const check = await listMsgs(GS.inbox.id);
                            if (check && !check.__rate) { newCount = check.length; if (newCount > 1) break; }
                        }
                        if (newCount <= 1) notify('[GR] Повторное письмо не пришло. Проверь вручную.', 'err', 10000);
                        continue;
                    } else { notify('[GR] Кнопка "Отправить повторно" не найдена', 'err', 6000); break; }
                }
                if (ok) {
                    GS.polling = false;
                    await this.waitFor(() => this.hasProfileText(), 10000, 'profile-form');
                    if (this.hasProfileText() && !GS.profileDone) {
                        logAlways('GR', 'после кода → заполняю profile');
                        const pwd = genPwd();
                        const data = {
                            givenName: ['Alex','Emma','James','Sophia','Michael','Olivia'][~~(Math.random()*6)],
                            familyName: ['Smith','Johnson','Brown','Davis','Miller','Wilson'][~~(Math.random()*6)],
                            password: pwd,
                        };
                        await save('gr_pwd', pwd);
                        notify('[GR] 🔑 Пароль: ' + pwd, 'warn', 20000);
                        try { GM_setClipboard(pwd, 'text'); } catch {}
                        const profileOk = await this.submitProfile(data);
                        if (profileOk) {
                            // УСПЕХ — удаляем использованный алиас
                            await this.cleanupAfterSuccess();
                        }
                    }
                    return;
                }
            } else {
                if (r.reason === 'no_code') GS.consecutiveNoCode++;
                else GS.consecutiveNoCode = 0;
                if (GS.consecutiveNoCode >= 10) {
                    notify('[GR] 10 попыток без валидного кода — стоп.', 'err', 15000);
                    GS.polling = false; return;
                }
            }
            await sleep(C.interval);
        }
        notify('[GR] Код не найден за ' + C.maxTries + ' попыток', 'err', 12000);
        GS.polling = false;
    },
};

function genPwd() {
    const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '!@#$%&*';
    let p = '';
    for (let i = 0; i < 14; i++) p += c[~~(Math.random() * c.length)];
    return p + s[~~(Math.random()*s.length)] + ~~(Math.random()*10);
}

// ═══════════════════ ДИАЛОГ СТАРТА ═══════════════════
function startDialog() {
    return new Promise(async res => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:var(--govl);z-index:999999;display:flex;align-items:center;justify-content:center;animation:gFd .2s var(--gease) both';
        const d = document.createElement('div');
        d.className = 'grok-gl';
        d.style.cssText = 'padding:28px;border-radius:20px;max-width:420px;width:90%;text-align:center;color:var(--gfg);animation:gIn .3s var(--gease) both';
        d.innerHTML = `
<h2 style="margin:0 0 8px;font-size:18px;font-weight:600">Регистрация Grok</h2>
<p style="color:var(--gmut);font-size:13px;margin:0 0 18px 0">Режим: <b style="color:var(--gfg)">${C.mode === 'simplelogin' ? 'SimpleLogin → AgentMail' : 'AgentMail'}</b></p>
<p style="color:var(--gmut);font-size:12px;margin:0 0 16px 0" id="oldEm"></p>
<div style="display:flex;flex-direction:column;gap:10px">
<button id="bn" class="grok-btn">Новая регистрация</button>
<button id="bo" style="padding:14px;background:var(--gelev);color:var(--gfg);border:1px solid var(--gbd);border-radius:999px;font-size:15px;cursor:pointer;display:none;font-family:inherit">Продолжить прошлую</button>
<button id="bc" class="grok-ghost">Отмена</button></div>`;
        ov.appendChild(d); document.body.appendChild(ov);
        const old = await load('gr_inbox');
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
    m.className = 'grok-gl';
    m.style.cssText = 'padding:24px;border-radius:20px;max-width:680px;width:92%;max-height:85vh;overflow-y:auto;color:var(--gfg);animation:gIn .3s var(--gease) both';
    m.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
<h2 style="margin:0;font-size:20px;font-weight:600">Помощь</h2>
<button id="ch" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--gmut);padding:0 5px">×</button></div>
<div style="line-height:1.6;font-size:14px">
<h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600">🚀 Регистрация Grok</h3>
<ol style="margin:0 0 20px 0;padding-left:20px;color:var(--gmut);font-size:13px;line-height:1.7">
<li>Откройте <b style="color:var(--gfg)">accounts.x.ai/sign-up</b>.</li>
<li>☰ → <b style="color:var(--gfg)">Регистрация Grok</b>.</li>
<li>«Новая регистрация» — создаст новый inbox.</li>
<li>Скрипт: method → email → код → профиль.</li>
<li>Капчу Cloudflare проходите вручную.</li>
<li><b style="color:var(--gfg)">После успешной регистрации авто-созданный SimpleLogin-алиас удаляется.</b></li>
</ol>
<h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600">📧 SimpleLogin и rate limit (429)</h3>
<p style="margin:0 0 8px 0;color:var(--gmut);font-size:13px">SimpleLogin имеет жёсткий лимит на создание random-алиасов через API. Если постоянно <code>429 Rate limit</code>:</p>
<ol style="margin:0 0 12px 0;padding-left:20px;color:var(--gmut);font-size:13px;line-height:1.7">
<li>Откройте <b style="color:var(--gfg)">app.simplelogin.io → Aliases → New Custom Alias</b>.</li>
<li>Создайте алиас вручную (например <code>grok1@slmail.me</code>).</li>
<li>Вставьте его в настройках в поле <b>«Готовый SimpleLogin alias»</b>.</li>
<li>Сохраните. Скрипт больше не будет дёргать API и не будет удалять этот алиас.</li>
</ol>
</div>`;
    helpModal.appendChild(m);
    document.body.appendChild(helpModal);
    m.querySelector('#ch').onclick = () => { helpModal.remove(); helpModal = null; };
    helpModal.onclick = e => { if (e.target === helpModal) { helpModal.remove(); helpModal = null; } };
}

// ═══════════════════ КОНТЕКСТ: КОПИРОВАТЬ ═══════════════════
async function copyCtx() {
    const msgs = [];
    for (const sel of ['[data-message-author-role]','[data-message-role]','[data-role]','[data-author-role]']) {
        const els = document.querySelectorAll(sel);
        if (!els.length) continue;
        els.forEach(el => {
            let role = el.getAttribute('data-message-author-role')
                    || el.getAttribute('data-message-role')
                    || el.getAttribute('data-role')
                    || el.getAttribute('data-author-role') || 'unknown';
            role = role.toLowerCase();
            if (/^(user|human|пользователь)$/.test(role)) role = 'user';
            else if (/^(assistant|bot|grok|ai|ассистент)$/.test(role)) role = 'assistant';
            const t = (el.innerText || '').trim();
            if (t.length > 3) msgs.push({ role, text: t });
        });
        if (msgs.length) break;
    }
    if (!msgs.length) {
        for (const sel of ['[class*="message-bubble"]','[class*="MessageBubble"]','[data-testid*="message"]','[data-testid*="Message"]']) {
            const els = document.querySelectorAll(sel);
            if (!els.length) continue;
            els.forEach((el, idx) => {
                let role = null;
                for (const attr of ['data-role','data-message-role','data-author-role','data-testid']) {
                    const v = el.getAttribute(attr);
                    if (!v) continue;
                    const vv = v.toLowerCase();
                    if (/user|human/.test(vv)) { role = 'user'; break; }
                    if (/assistant|bot|grok|response|ai/.test(vv)) { role = 'assistant'; break; }
                }
                if (!role) {
                    const cls = (el.className || '').toString().toLowerCase();
                    if (/user|human|from-user|outgoing|right/.test(cls)) role = 'user';
                    else if (/assistant|bot|grok|response|incoming|left/.test(cls)) role = 'assistant';
                }
                if (!role) role = (idx % 2 === 0) ? 'user' : 'assistant';
                const t = (el.innerText || '').trim();
                if (t.length > 3) msgs.push({ role, text: t });
            });
            if (msgs.length) break;
        }
    }
    if (!msgs.length) {
        let container = null;
        for (const sel of ['main [class*="conversation"]','main [class*="chat"]','[role="log"]','main']) {
            const c = document.querySelector(sel);
            if (c && (c.innerText || '').length > 100) { container = c; break; }
        }
        if (container) {
            const nodes = [...container.querySelectorAll('article, [class*="message"], [class*="turn"], div[role="group"]')];
            nodes.forEach((el, idx) => {
                const t = (el.innerText || '').trim();
                if (t.length < 5 || t.length > 4000) return;
                msgs.push({ role: idx % 2 === 0 ? 'user' : 'assistant', text: t });
            });
        }
    }
    if (!msgs.length) return notify('Не найдено сообщений', 'err');
    const seen = new Set();
    const uniq = [];
    for (const m of msgs) {
        const key = m.role + '|' + m.text.slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push(m);
    }
    const text = uniq.map(m => {
        const label = m.role === 'user' ? 'Пользователь' : m.role === 'assistant' ? 'Grok' : '?';
        return `[${label}]: ${m.text}`;
    }).join('\n\n');
    ctx = text;
    await save('ctx', text);
    try {
        if (typeof GM_setClipboard !== 'undefined') GM_setClipboard(text, 'text');
        else await navigator.clipboard.writeText(text);
        notify(`Скопировано (${uniq.length} сообщ., ${text.length} симв.)`, 'ok');
    } catch { notify('Ошибка копирования', 'err'); }
    closeMenu();
}

// ═══════════════════ КОНТЕКСТ: ВСТАВИТЬ ═══════════════════
async function pasteCtx() {
    if (!ctx) ctx = await load('ctx');
    if (!ctx) return notify('Сначала скопируйте контекст', 'warn');
    const inp = document.querySelector(
        'textarea#prompt-textarea,textarea[placeholder*="Message"],textarea[placeholder*="Спросите"],' +
        'div[contenteditable="true"],textarea,[contenteditable="true"]'
    );
    if (!inp) return notify('Поле ввода не найдено', 'err');
    inp.focus();
    await sleep(100);
    if (inp.tagName === 'TEXTAREA' || inp.tagName === 'INPUT') {
        setVal(inp, ctx); fireInput(inp, ctx);
        inp.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (inp.isContentEditable) {
        try {
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, ctx);
        } catch {
            inp.innerText = ctx;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
    notify(`Вставлено (${ctx.length} симв.)`, 'ok');
    closeMenu();
}

// ═══════════════════ МЕНЮ ═══════════════════
let menuBtn = null, menuPnl = null, menuVis = false;

const ICO_MENU = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
const ICO_COPY = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICO_PASTE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`;
const ICO_REG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
const ICO_SET = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const ICO_HELP = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

function closeMenu() {
    if (menuPnl) { menuPnl.style.animation = 'none'; menuPnl.style.display = 'none'; }
    menuVis = false;
}
function toggleMenu() {
    if (!menuPnl) return;
    menuVis = !menuVis;
    if (menuVis) {
        menuPnl.style.display = 'flex';
        menuPnl.style.animation = 'none';
        void menuPnl.offsetWidth;
        menuPnl.style.animation = 'gIn .25s var(--gease) both';
    } else closeMenu();
}

function createMenu() {
    if (menuBtn || !document.body) return;
    const left = innerWidth < 768 ? 52 : 56;

    menuBtn = document.createElement('button');
    menuBtn.id = 'grok-menu';
    menuBtn.title = 'Grok Auto Register';
    menuBtn.innerHTML = ICO_MENU;
    menuBtn.style.cssText = `position:fixed;top:8px;left:${left}px;z-index:99999;width:36px;height:36px;padding:0;background:transparent;color:var(--gfg);border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s var(--gease)`;
    menuBtn.onmouseenter = () => menuBtn.style.background = 'var(--ghov)';
    menuBtn.onmouseleave = () => menuBtn.style.background = 'transparent';
    menuBtn.onclick = e => { e.stopPropagation(); toggleMenu(); };

    menuPnl = document.createElement('div');
    menuPnl.className = 'grok-gl grok-pnl';
    menuPnl.style.cssText = `position:fixed;top:52px;left:${left}px;z-index:99999;display:none;flex-direction:column;gap:4px;padding:8px;border-radius:var(--grad);min-width:230px;max-width:calc(100vw - 32px)`;

    const mkBtn = (id, ico, txt, fn, d = 0) => {
        const b = document.createElement('button');
        b.id = id;
        b.className = 'grok-mi';
        b.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-right:8px;opacity:.85">${ico}</span><span style="font-size:14px">${txt}</span>`;
        b.style.cssText = `display:flex;align-items:center;padding:10px 12px;background:transparent;color:var(--gfg);border:none;border-radius:10px;cursor:pointer;font-weight:500;text-align:left;animation-delay:${d}ms`;
        b.onclick = e => { e.stopPropagation(); fn(); };
        return b;
    };

    if (isAccounts()) {
        menuPnl.appendChild(mkBtn('gr', ICO_REG, 'Регистрация Grok', () => { closeMenu(); startReg(); }, 0));
    }
    menuPnl.appendChild(mkBtn('gcp', ICO_COPY, 'Копировать контекст', copyCtx, 40));
    menuPnl.appendChild(mkBtn('gps', ICO_PASTE, 'Вставить контекст', pasteCtx, 80));
    menuPnl.appendChild(mkBtn('gset', ICO_SET, 'Настройки', () => { closeMenu(); openSettings(); }, 120));
    menuPnl.appendChild(mkBtn('ghlp', ICO_HELP, 'Помощь', () => { closeMenu(); showHelp(); }, 160));

    document.body.appendChild(menuBtn);
    document.body.appendChild(menuPnl);

    addEventListener('resize', () => {
        const l = innerWidth < 768 ? 52 : 56;
        menuBtn.style.left = l + 'px';
        menuPnl.style.left = l + 'px';
    });

    document.addEventListener('click', e => {
        if (menuPnl && menuPnl.style.display === 'flex' &&
            !menuPnl.contains(e.target) && !menuBtn.contains(e.target)) closeMenu();
    });
}

// ═══════════════════ СТАРТ ═══════════════════
async function startReg() {
    logAlways('startReg', 'Grok');
    await loadKeys();

    GS.methodDone = false; GS.emailDone = false; GS.codeDone = false; GS.profileDone = false; GS.regDone = false;
    GS.turnstileSolved = false; GS.detectedStage = null; GS.lastError = null;
    const choice = await startDialog();
    if (choice === 'cancel') return;
    if (choice === 'new') {
        // Перед новой регистрацией — удаляем прошлый алиас, если он был
        const oldAliasId = await load('gr_slAliasId');
        if (oldAliasId && C.mode === 'simplelogin') {
            notify('[SL] Удаляю алиас от прошлого запуска…', 'info', 4000);
            await deleteSimpleLoginAlias(oldAliasId);
        }
        GS.slAliasId = null;
        GS.slAliasEmail = null;
        await save('gr_slAliasId', null);
        await save('gr_slAliasEmail', null);

        GS.inbox = null; GS.forceNewInbox = true;
        await save('gr_inbox', null);
        await save('gr_codeDone', false);
        await save('gr_profileDone', false);
        await save('gr_emailDone', false);
        await save('gr_methodDone', false);
    } else {
        GS.inbox = await load('gr_inbox');
        GS.codeReqAt = await load('gr_codeReqAt');
        GS.slAliasId = await load('gr_slAliasId');
        GS.slAliasEmail = await load('gr_slAliasEmail');
        if (await load('gr_codeDone')) GS.codeDone = true;
        if (await load('gr_profileDone')) GS.profileDone = true;
        if (await load('gr_emailDone')) GS.emailDone = true;
        if (await load('gr_methodDone')) GS.methodDone = true;
    }
    const ok = await ensureKeys();
    if (!ok) { notify('Ключи не заданы', 'warn', 5000); return; }
    await sleep(300);
    await GR.run();
}

// ═══════════════════ INIT ═══════════════════
async function init() {
    if (inited) return;
    inited = true;
    logAlways('init', 'start host=' + location.hostname + ' path=' + location.pathname);
    injectCSS();
    await loadKeys();
    createMenu();
    await sleep(300);

    if (!isAccounts()) {
        logAlways('init', 'не accounts.x.ai — только меню');
        return;
    }

    const savedInbox = await load('gr_inbox');
    if (savedInbox?.id) {
        GS.inbox = savedInbox;
        GS.codeReqAt = await load('gr_codeReqAt');
        GS.slAliasId = await load('gr_slAliasId');
        GS.slAliasEmail = await load('gr_slAliasEmail');
        if (await load('gr_codeDone')) GS.codeDone = true;
        if (await load('gr_profileDone')) GS.profileDone = true;
        if (await load('gr_emailDone')) GS.emailDone = true;
        if (await load('gr_methodDone')) GS.methodDone = true;
    }
    const stage = GR.detectStage();
    logAlways('init', 'Grok stage=' + stage + ' savedInbox=' + (savedInbox?.email || 'нет'));

    if (savedInbox?.id && !GS.regDone) {
        if (stage === 'code' && !GS.codeDone) {
            logAlways('init', 'Автозапуск pollCode (восстановление)');
            setTimeout(() => GR.pollCode(), 1500);
        } else if (stage === 'profile' && !GS.profileDone) {
            logAlways('init', 'Автозапуск profile (восстановление)');
            setTimeout(() => GR.run(), 1500);
        }
    }
}

init();

})();
