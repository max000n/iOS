// ==UserScript==
// @name         ChatGPT Auto Register
// @namespace    http://tampermonkey.net/
// @version      80.0
// @description  Авторегистрация ChatGPT через AgentMail.to / SimpleLogin + диагностика + авто-запуск verify
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

const C = {
    amKey: '', amBase: 'https://api.agentmail.to/v0',
    slKey: '', slBase: 'https://app.simplelogin.io',
    slRelay: '',   // email постоянного ящика, привязанного в SimpleLogin
    mode: 'agentmail',
    interval: 3000, maxTries: 120, tolMs: 60000,
    fast: true, delInbox: true, retries: 3, shift: true,
    debug: false,
};

let codeDone = false, profileDone = false, regDone = false,
    running = false, loginTried = false, verifyDone = false,
    pwdDone = false, inited = false, inbox = null, polling = false,
    codeReqAt = null, usedIds = new Set(), urlTimer = null,
    helpModal = null, settingsModal = null, ctx = null,
    notifyDone = false, canContinue = false;

const verifyStats = {
    attempts: 0, lastReason: null, lastMsgCount: 0,
    lastCode: null, lastCodeAge: null,
    fillAttempts: 0, fillSuccess: 0,
    lastApiStatus: null, lastApiError: null,
    inboxId: null, inboxEmail: null,
    firstMsgTime: null, codeReqTime: null,
};

// ═══════════════════ ДИАГНОСТИКА ═══════════════════
const LOG_MAX = 500;
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
        if (diagErrors.length > 100) diagErrors.shift();
    }
    if (logBuf.length % 10 === 0 || level === 'ERROR') {
        GM.setValue('cg_logs', logBuf.slice(-200)).catch(() => {});
    }
    console.log(line);
}

addEventListener('error', e => {
    log('ERROR', 'window', e.message + ' at ' + e.filename + ':' + e.lineno + ':' + e.colno);
});
addEventListener('unhandledrejection', e => {
    log('ERROR', 'promise', e.reason?.message || String(e.reason));
});

async function buildReport() {
    const p = [];
    p.push('═══ CHATGPT AUTO REGISTER — ОТЧЁТ ═══');
    p.push('Дата: ' + new Date().toISOString());
    p.push('Версия скрипта: 80.0');
    p.push('URL: ' + location.href);
    p.push('Host: ' + location.hostname);
    p.push('Path: ' + location.pathname);
    p.push('User Agent: ' + navigator.userAgent);
    p.push('Платформа: ' + navigator.platform + ' | Mobile: ' + (innerWidth < 768));
    p.push('Окно: ' + innerWidth + '×' + innerHeight);
    p.push('');
    p.push('─── СОСТОЯНИЕ ───');
    p.push('running: ' + running);
    p.push('regDone: ' + regDone);
    p.push('verifyDone: ' + verifyDone);
    p.push('codeDone: ' + codeDone);
    p.push('pwdDone: ' + pwdDone);
    p.push('profileDone: ' + profileDone);
    p.push('polling: ' + polling);
    p.push('canContinue: ' + canContinue);
    p.push('notifyDone: ' + notifyDone);
    p.push('loginTried: ' + loginTried);
    p.push('inbox: ' + JSON.stringify(inbox));
    p.push('codeReqAt: ' + (codeReqAt ? new Date(codeReqAt).toISOString() : null));
    p.push('usedIds: ' + usedIds.size);
    p.push('');
    p.push('─── ПРОВЕРКА ПОЧТЫ ───');
    p.push('inboxId: ' + verifyStats.inboxId);
    p.push('inboxEmail: ' + verifyStats.inboxEmail);
    p.push('attempts: ' + verifyStats.attempts);
    p.push('lastReason: ' + verifyStats.lastReason);
    p.push('lastMsgCount: ' + verifyStats.lastMsgCount);
    p.push('lastCode: ' + verifyStats.lastCode);
    p.push('lastCodeAge: ' + verifyStats.lastCodeAge);
    p.push('fillAttempts: ' + verifyStats.fillAttempts);
    p.push('fillSuccess: ' + verifyStats.fillSuccess);
    p.push('lastApiStatus: ' + verifyStats.lastApiStatus);
    p.push('lastApiError: ' + verifyStats.lastApiError);
    p.push('codeReqTime: ' + (verifyStats.codeReqTime ? new Date(verifyStats.codeReqTime).toISOString() : null));
    p.push('firstMsgTime: ' + (verifyStats.firstMsgTime ? new Date(verifyStats.firstMsgTime).toISOString() : null));
    p.push('');
    p.push('─── КОНФИГ ───');
    p.push('mode: ' + C.mode);
    p.push('slRelay: ' + (C.slRelay || 'не задан'));
    p.push('debug: ' + C.debug);
    p.push('fast: ' + C.fast);
    p.push('shift: ' + C.shift);
    p.push('amKey: ' + (C.amKey ? C.amKey.slice(0, 8) + '…(' + C.amKey.length + ')' : 'нет'));
    p.push('slKey: ' + (C.slKey ? C.slKey.slice(0, 8) + '…(' + C.slKey.length + ')' : 'нет'));
    p.push('');
    p.push('─── DOM ───');
    p.push('findEmail(): ' + (findEmail() ? 'есть' : 'нет'));
    p.push('findPwd(): ' + (findPwd() ? 'есть' : 'нет'));
    p.push('findCodeInp(): ' + (findCodeInp() ? 'есть' : 'нет'));
    const codes = findCodes();
    p.push('findCodes(): ' + (codes ? (codes.type === 'otp' ? 'OTP (' + codes.inputs.length + ' полей)' : 'single') : 'нет'));
    p.push('hasVerifyText(): ' + hasVerifyText());
    const prof = findProfile();
    p.push('findProfile().name: ' + (prof.name ? 'есть' : 'нет'));
    p.push('findProfile().age: ' + (prof.age ? 'есть' : 'нет'));
    p.push('detect(): ' + detect());
    p.push('hasLoginBtn: ' + hasLoginBtn());
    p.push('loggedIn: ' + loggedIn());
    p.push('menuBtn.left: ' + (menuBtn ? menuBtn.style.left : 'нет'));
    p.push('account: ' + currentAccountId());
    p.push('');
    p.push('─── ОШИБКИ (' + diagErrors.length + ') ───');
    if (!diagErrors.length) p.push('(нет)');
    else diagErrors.slice(-20).forEach(e => p.push(e));
    p.push('');
    p.push('─── ЛОГ (' + logBuf.length + ') ───');
    if (!logBuf.length) p.push('(пусто)');
    else logBuf.slice(-200).forEach(l => p.push(l));
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
    m.style.cssText = 'padding:20px;border-radius:20px;max-width:720px;width:92%;max-height:85vh;display:flex;flex-direction:column;color:var(--gfg);animation:gIn .3s var(--gease) both';
    m.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
<h2 style="margin:0;font-size:17px;font-weight:600">Отчёт диагностики</h2>
<button id="grmc" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gmut);padding:0 5px">×</button></div>
<p style="margin:0 0 10px 0;font-size:12px;color:var(--gmut)">${copied ? '✓ Скопировано в буфер.' : '⚠ Буфер недоступен.'}</p>
<textarea id="grmt" readonly style="flex:1;min-height:400px;width:100%;padding:12px;border-radius:10px;border:1px solid var(--gbd);background:var(--gelev);color:var(--gfg);font-family:ui-monospace,monospace;font-size:11px;line-height:1.4;resize:vertical;box-sizing:border-box">${report.replace(/</g, '&lt;')}</textarea>
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
.gpt-seg{display:flex;background:var(--gelev);border-radius:12px;padding:3px;gap:2px;margin-bottom:18px}
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
        d.style.cssText = 'padding:24px;border-radius:20px;max-width:480px;width:90%;max-height:90vh;overflow-y:auto;color:var(--gfg);animation:gIn .3s var(--gease) both';
        d.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
<h2 style="margin:0;font-size:18px;font-weight:600">Настройки</h2>
<button id="gcs" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gmut);padding:0 5px">×</button></div>
<p style="color:var(--gmut);font-size:12px;margin:0 0 20px 0">Ключи сохраняются в Tampermonkey.</p>
<label class="gpt-lbl">Режим</label>
<div class="gpt-seg" id="gm">
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
<p class="gpt-hint">Адрес постоянного inbox, привязанного в SimpleLogin → Mailboxes.<br>
<span style="opacity:.8">Не удаляйте этот ящик — иначе алиасы SimpleLogin перестанут работать.</span></p></div>
<div style="height:16px"></div>
<div style="border-top:1px solid var(--gbd);padding-top:16px">
<label class="gpt-lbl">Диагностика</label>
<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--gelev);border-radius:12px;margin-bottom:10px">
<span style="font-size:13px;color:var(--gfg)">Подробный лог</span>
<span id="gsw" style="position:relative;width:38px;height:22px;background:${C.debug ? 'var(--gfg)' : '#8e8e8e'};border-radius:999px;flex-shrink:0;cursor:pointer;transition:background .2s var(--gease)">
<span style="position:absolute;top:3px;left:3px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s var(--gease);box-shadow:0 1px 3px rgba(0,0,0,.3);transform:translateX(${C.debug ? '16px' : '0'})"></span></span></div>
<button id="grepBtn" style="width:100%;padding:12px;background:var(--gelev);color:var(--gfg);border:1px solid var(--gbd);border-radius:999px;font-size:13px;cursor:pointer;font-family:inherit">Скопировать отчёт</button>
</div>
<div style="height:20px"></div>
<div style="display:flex;flex-direction:column;gap:10px">
<button id="gsave" class="gpt-btn">Сохранить</button>
<button id="gclr" style="padding:10px;background:transparent;color:var(--gdngr);border:1px solid var(--gbd);border-radius:999px;font-size:13px;cursor:pointer;font-family:inherit">Удалить ключи</button>
<button id="gcancel" class="gpt-ghost">Отмена</button></div>`;
        settingsModal.appendChild(d);
        document.body.appendChild(settingsModal);

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
            amH.innerHTML = isS
                ? 'console.agentmail.to → API Keys'
                : 'console.agentmail.to → API Keys → Create';
        };
        upd();
        btns.forEach(b => b.onclick = () => { mode = b.dataset.m; upd(); });

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
            log('INFO', 'settings', 'saved mode=' + mode + ' relay=' + relay);
            notify('Настройки сохранены', 'ok', 3000);
            close(true);
        };
        d.querySelector('#gclr').onclick = async () => {
            await save('amKey', null); await save('slKey', null); await save('slRelay', null); await save('mode', null);
            C.amKey = ''; C.slKey = ''; C.slRelay = ''; C.mode = 'agentmail';
            am.value = ''; sl.value = ''; sle.value = ''; mode = 'agentmail'; upd();
            notify('Ключи удалены', 'ok', 3000);
        };

        const sw = d.querySelector('#gsw');
        sw.onclick = async () => {
            C.debug = !C.debug;
            await save('debug', C.debug);
            const dot = sw.firstElementChild;
            sw.style.background = C.debug ? 'var(--gfg)' : '#8e8e8e';
            dot.style.transform = 'translateX(' + (C.debug ? '16px' : '0') + ')';
            log('INFO', 'debug', 'diagnostics ' + (C.debug ? 'ENABLED' : 'disabled'));
            notify('Диагностика ' + (C.debug ? 'включена' : 'выключена'), 'info', 2500);
        };
        d.querySelector('#grepBtn').onclick = () => {
            settingsModal.remove();
            settingsModal = null;
            copyReport();
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
        data: JSON.stringify({ username, displayName: 'ChatGPT Auto' }),
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
        log('INFO', 'inbox', 'created: ' + JSON.stringify(inboxObj));
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
        data: JSON.stringify({ note: 'ChatGPT Auto' }),
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
        .filter(Boolean).join('\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ');
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
    if (!msgs) { log('ERROR', 'findCode', 'listMsgs null (API error)'); return { found: false, reason: 'api_error' }; }
    if (!msgs.length) { log('DEBUG', 'findCode', 'no messages yet'); return { found: false, reason: 'no_messages' }; }

    msgs.sort((a, b) => msgTime(b) - msgTime(a));
    if (!verifyStats.firstMsgTime) verifyStats.firstMsgTime = msgTime(msgs[0]);
    verifyStats.lastMsgCount = msgs.length;

    const fresh = msgs.filter(isFresh);
    log('DEBUG', 'findCode', `msgs=${msgs.length} fresh=${fresh.length} usedIds=${usedIds.size} codeReqAt=${codeReqAt ? new Date(codeReqAt).toISOString() : 'null'}`);

    if (!fresh.length) {
        const newest = msgTime(msgs[0]);
        log('DEBUG', 'findCode', `no fresh. newest=${new Date(newest).toISOString()} codeReqAt=${new Date(codeReqAt).toISOString()} diff=${(newest - codeReqAt)/1000}s`);
        return { found: false, reason: 'waiting', count: msgs.length };
    }

    for (const m of fresh) {
        if (usedIds.has(m.message_id)) {
            log('DEBUG', 'findCode', `skip used: ${m.message_id}`);
            continue;
        }
        const full = (await getMsg(inbox.id, m.message_id)) || m;
        const code = extractCode(full);
        if (code) {
            log('INFO', 'findCode', `FOUND code=${code} msgId=${m.message_id} subject="${(full.subject||'').slice(0,50)}"`);
            return { found: true, code, msgId: m.message_id, age: Math.max(0, Math.round((Date.now() - msgTime(m)) / 1000)) };
        }
        log('DEBUG', 'findCode', `msg ${m.message_id}: no code. subject="${(full.subject||'').slice(0,80)}"`);
    }
    log('DEBUG', 'findCode', `no code in ${fresh.length} fresh msgs`);
    return { found: false, reason: 'no_code', count: fresh.length };
}

// ═══════════════════ ПОЛЯ ═══════════════════
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
function fill(el, v) {
    if (!el) return false;
    focusEl(el); setVal(el, ''); setVal(el, v);
    fireInput(el, v); el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
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
    for (const el of document.querySelectorAll('input[type="text"],input[type="tel"],input:not([type])')) {
        const max = +(el.getAttribute('maxlength') || 0);
        if (max === 6 || max === 0) return el;
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
    if (!t) {
        log('ERROR', 'fillCode', 'поле для кода НЕ найдено');
        log('DEBUG', 'fillCode', 'inputs: ' + [...document.querySelectorAll('input')].map(i => ({
            id: i.id, name: i.name, type: i.type, max: i.getAttribute('maxlength'),
            placeholder: i.placeholder, visible: i.offsetParent !== null
        })).map(o => JSON.stringify(o)).join(' | '));
        return false;
    }
    log('INFO', 'fillCode', 'type=' + t.type + ' code=' + code);
    try {
        if (t.type === 'single') {
            await typeHuman(t.input, code);
            log('INFO', 'fillCode', 'single filled, value=' + t.input.value);
        } else {
            for (let i = 0; i < t.inputs.length && i < code.length; i++) {
                await focusEl(t.inputs[i]);
                setVal(t.inputs[i], code[i]);
                fireInput(t.inputs[i], code[i]);
            }
            log('INFO', 'fillCode', 'otp filled, values=' + t.inputs.map(i => i.value).join(''));
        }
        verifyStats.fillSuccess++;
        return true;
    } catch (e) {
        log('ERROR', 'fillCode', e);
        return false;
    }
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
            log('DEBUG', 'clickCont', 'found: "' + b.textContent.trim() + '"');
            return click(b);
        }
    }
    log('WARN', 'clickCont', 'кнопка Continue не найдена');
    return false;
}

// ═══════════════════ ПРОВЕРКИ ═══════════════════
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

function currentAccountId() {
    const el = document.querySelector('[data-testid="user-menu"]') ||
               document.querySelector('button[aria-label*="меню" i]') ||
               document.querySelector('nav[aria-label="Боковая панель"] button[aria-label*="аккаунт" i]');
    return el ? (el.textContent || '').trim().slice(0, 40) : 'unknown';
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
<h2 style="margin:0 0 8px;font-size:18px;font-weight:600">Регистрация ChatGPT</h2>
<p style="color:var(--gmut);font-size:13px;margin:0 0 18px 0">Режим: <b style="color:var(--gfg)">${C.mode === 'simplelogin' ? 'SimpleLogin → AgentMail' : 'AgentMail'}</b></p>
<p style="color:var(--gmut);font-size:12px;margin:0 0 16px 0" id="oldEm"></p>
<div style="display:flex;flex-direction:column;gap:10px">
<button id="bn" class="gpt-btn">Новая регистрация</button>
<button id="bo" style="padding:14px;background:var(--gelev);color:var(--gfg);border:1px solid var(--gbd);border-radius:999px;font-size:15px;cursor:pointer;display:none;font-family:inherit">Продолжить прошлую</button>
<button id="bc" class="gpt-ghost">Отмена</button></div>`;
        ov.appendChild(d); document.body.appendChild(ov);
        const old = await load('inbox');
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
<h2 style="margin:0;font-size:20px;font-weight:600">Помощь — ChatGPT Auto Register</h2>
<button id="ch" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--gmut);padding:0 5px">×</button></div>
<div style="line-height:1.6;font-size:14px">

<div style="margin-bottom:22px">
<h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gfg)">⚙️ Шаг 1. Настройка</h3>
<p style="margin:0 0 10px 0;color:var(--gmut);font-size:13px">Откройте <b style="color:var(--gfg)">☰ → Настройки</b> и заполните:</p>
<p style="margin:0 0 6px 0"><b>Режим «AgentMail»</b> (по умолчанию):</p>
<ul style="margin:0 0 12px 0;padding-left:20px;color:var(--gmut);font-size:13px">
<li><b style="color:var(--gfg)">AgentMail API Key</b> — console.agentmail.to → API Keys → Create</li>
</ul>
<p style="margin:0 0 6px 0"><b>Режим «SimpleLogin»</b>:</p>
<ul style="margin:0;padding-left:20px;color:var(--gmut);font-size:13px">
<li><b style="color:var(--gfg)">AgentMail API Key</b> — тот же, что выше (используется как relay)</li>
<li><b style="color:var(--gfg)">SimpleLogin API Key</b> — app.simplelogin.io/dashboard/api_key</li>
<li><b style="color:var(--gfg)">AgentMail email для проверки</b> — адрес постоянного ящика, привязанного в SimpleLogin</li>
</ul>
</div>

<div style="margin-bottom:22px">
<h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gfg)">📧 Шаг 2. Режим SimpleLogin (одноразово)</h3>
<p style="margin:0 0 10px 0;color:var(--gmut);font-size:13px">Перед использованием SimpleLogin нужно вручную связать его с AgentMail:</p>
<ol style="margin:0;padding-left:20px;color:var(--gmut);font-size:13px;line-height:1.7">
<li>Войдите в <b style="color:var(--gfg)">console.agentmail.to</b>.</li>
<li>Создайте <b style="color:var(--gfg)">постоянный</b> inbox (например, <code>relay@agentmail.to</code>). <b style="color:var(--gfg)">Не удаляйте его</b>.</li>
<li>В <b style="color:var(--gfg)">app.simplelogin.io → Mailboxes</b> нажмите <b style="color:var(--gfg)">Add Mailbox</b> и укажите этот адрес.</li>
<li>Подтвердите письмо, сделайте mailbox <b style="color:var(--gfg)">дефолтным</b>.</li>
<li>В настройках скрипта введите этот адрес в поле <b style="color:var(--gfg)">«AgentMail email для проверки»</b>.</li>
</ol>
<p style="margin:10px 0 0 0;color:var(--gdngr);font-size:12px">⚠ Не удаляйте указанный ящик в AgentMail — алиасы SimpleLogin перестанут работать.</p>
</div>

<div style="margin-bottom:22px">
<h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gfg)">🚀 Шаг 3. Регистрация</h3>
<ol style="margin:0;padding-left:20px;color:var(--gmut);font-size:13px;line-height:1.7">
<li>Откройте <b style="color:var(--gfg)">chatgpt.com</b> и убедитесь, что вы <b style="color:var(--gfg)">не авторизованы</b>.</li>
<li>Нажмите <b style="color:var(--gfg)">☰ → Регистрация</b> (кнопка слева от логотипа).</li>
<li>В диалоге выберите <b style="color:var(--gfg)">«Новая регистрация»</b>.</li>
<li>Скрипт автоматически: создаст почту → введёт email → дождётся письма → введёт код → заполнит профиль.</li>
<li>Пароль (если потребуется) показывается в уведомлении — сохраните его.</li>
<li>После успеха временный ящик AgentMail удаляется автоматически (кроме SimpleLogin).</li>
</ol>
</div>

<div style="margin-bottom:22px">
<h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gfg)">⏸ Кнопка «Продолжить»</h3>
<p style="margin:0;color:var(--gmut);font-size:13px">
Если авто-переход после ввода кода не сработал, в меню <b style="color:var(--gfg)">☰ → Продолжить</b> появится кнопка с пульсацией. Нажмите её — скрипт вручную перейдёт к следующему шагу. Также автозапуск срабатывает при обновлении страницы <code>auth.openai.com/email-verification</code>.
</p>
</div>

<div style="margin-bottom:22px">
<h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gfg)">📋 Перенос контекста чата</h3>
<ol style="margin:0;padding-left:20px;color:var(--gmut);font-size:13px;line-height:1.7">
<li>В старом аккаунте: <b style="color:var(--gfg)">☰ → Копировать контекст</b>.</li>
<li>Выйдите из аккаунта (Avatar → Log out).</li>
<li>Зарегистрируйте новый аккаунт через <b style="color:var(--gfg)">☰ → Регистрация</b>.</li>
<li>В новом чате: <b style="color:var(--gfg)">☰ → Вставить контекст</b>.</li>
</ol>
</div>

<div style="margin-bottom:22px">
<h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gfg)">🔧 Диагностика</h3>
<p style="margin:0 0 8px 0;color:var(--gmut);font-size:13px">
<b style="color:var(--gfg)">☰ → Настройки → Подробный лог</b> — включает расширенное логирование всех HTTP-запросов, шагов проверки почты, извлечения кода и заполнения полей.<br>
<b style="color:var(--gfg)">☰ → Настройки → Скопировать отчёт</b> — собирает в один текст: версию скрипта, URL, состояние всех флагов, конфиг (ключи замаскированы), DOM-проверки и последние 200 строк лога. Отчёт вставляется в чат для разбора проблемы.
</p>
<p style="margin:0;color:var(--gmut);font-size:12px">Рекомендуется включать диагностику перед разбором любой проблемы с регистрацией.</p>
</div>

<div style="margin-bottom:22px">
<h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gfg)">⚠️ Лимиты и ограничения</h3>
<ul style="margin:0;padding-left:20px;color:var(--gmut);font-size:13px;line-height:1.7">
<li><b style="color:var(--gfg)">AgentMail</b> — 3 ящика на бесплатном тарифе. При превышении скрипт автоматически удалит 2 самых старых и создаст новый.</li>
<li><b style="color:var(--gfg)">SimpleLogin</b> — привязанный вручную relay-ящик <b style="color:var(--gfg)">не удаляется</b> после регистрации.</li>
<li>Публичные временные почты (mail.tm и др.) <b style="color:var(--gfg)">не используются</b> — OpenAI их блокирует.</li>
</ul>
</div>

<div>
<h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:var(--gfg)">🛠 Управление ключами</h3>
<ul style="margin:0;padding-left:20px;color:var(--gmut);font-size:13px;line-height:1.7">
<li><b style="color:var(--gfg)">Изменить</b> — ☰ → Настройки → ввести новые → Сохранить.</li>
<li><b style="color:var(--gfg)">Удалить</b> — ☰ → Настройки → «Удалить ключи».</li>
<li><b style="color:var(--gfg)">Вручную</b> — Tampermonkey Dashboard → ChatGPT Auto Register → Storage.</li>
</ul>
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

function posMenu() {
    if (!menuBtn) return;
    const isMob = innerWidth < 768;
    const host = location.hostname;
    const left = host.includes('auth.openai.com') ? (isMob ? 8 : 12) : (isMob ? 52 : 56);
    if (menuBtn.style.left === left + 'px') return;
    menuBtn.style.left = left + 'px';
    if (menuPnl) menuPnl.style.left = left + 'px';
    if (statusLbl) statusLbl.style.left = left + 'px';
    log('DEBUG', 'posMenu', 'left=' + left + ' host=' + host);
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
    menuBtn.title = 'ChatGPT Auto Register';
    menuBtn.innerHTML = ICO_MENU;
    menuBtn.style.cssText = `position:fixed;top:8px;left:56px;z-index:99999;width:36px;height:36px;padding:0;background:transparent;color:var(--gfg);border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s var(--gease)`;
    menuBtn.onmouseenter = () => menuBtn.style.background = 'var(--ghov)';
    menuBtn.onmouseleave = () => menuBtn.style.background = 'transparent';
    menuBtn.onclick = e => { e.stopPropagation(); toggleMenu(); };

    statusLbl = document.createElement('div');
    statusLbl.id = 'gpt-status';
    statusLbl.style.cssText = 'position:fixed;top:44px;left:56px;font-size:10px;font-weight:600;color:var(--gfg);text-align:center;width:36px;pointer-events:none';

    menuPnl = document.createElement('div');
    menuPnl.className = 'gpt-gl gpt-pnl';
    menuPnl.style.cssText = 'position:fixed;top:52px;left:56px;z-index:99999;display:none;flex-direction:column;gap:4px;padding:8px;border-radius:var(--grad);min-width:230px;max-width:calc(100vw - 32px)';

    const mkBtn = (id, ico, txt, fn, d = 0, cls = '') => {
        const b = document.createElement('button');
        b.id = id;
        b.className = 'gpt-mi' + (cls ? ' ' + cls : '');
        b.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-right:8px;opacity:.85">${ico}</span><span style="font-size:14px">${txt}</span>`;
        b.style.cssText = `display:flex;align-items:center;padding:10px 12px;background:transparent;color:var(--gfg);border:none;border-radius:10px;cursor:pointer;font-weight:500;text-align:left;animation-delay:${d}ms`;
        b.onclick = e => { e.stopPropagation(); fn(); };
        return b;
    };
    menuPnl.appendChild(mkBtn('gr', ICO_REG, 'Регистрация', () => { closeMenu(); startReg(); }, 0));
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
    setInterval(posMenu, 3000);

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
        if (location.href !== last) { stopUrl(); log('INFO', 'urlWatch', last + ' → ' + location.href); cb(); }
        else if ((el += 300) >= timeout) { stopUrl(); log('WARN', 'urlWatch', 'timeout ' + timeout + 'ms'); cb(true); }
    }, 300);
}
function stopUrl() { if (urlTimer) { clearInterval(urlTimer); urlTimer = null; } }

// ═══════════════════ ЭТАПЫ ═══════════════════
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
            // ⚡ Используем email ящика, привязанного в SimpleLogin
            if (!C.slRelay) {
                notify('Не указан AgentMail email для SimpleLogin. Откройте Настройки.', 'err', 10000);
                return setStatus('');
            }
            const ib = await listInboxes();
            if (!ib.length) { notify('AgentMail: нет inbox', 'err', 12000); return setStatus(''); }
            const relay = ib.find(i => (i.inbox_id || i.email) === C.slRelay);
            if (!relay) {
                notify(`AgentMail: ящик ${C.slRelay} не найден. Проверьте настройки.`, 'err', 10000);
                log('ERROR', 'stageLogin', 'relay inbox not found. Available: ' + ib.map(i => i.inbox_id || i.email).join(', '));
                return setStatus('');
            }
            inbox = { id: relay.inbox_id, email: relay.inbox_id || relay.email };
            log('INFO', 'stageLogin', 'using relay inbox: ' + inbox.email);
            notify('SimpleLogin: создаю алиас…', 'info', 4000);
            const alias = await createAlias();
            if (!alias) return setStatus('');
            email = alias;
            notify(`Алиас: ${alias} → ${inbox.email}`, 'info', 6000);
        } else {
            // ⚡ Обработка лимита ящиков
            let ib = await createInbox();
            if (!ib) {
                const list = await listInboxes();
                log('WARN', 'stageLogin', 'inbox create failed, existing: ' + list.length);
                if (list.length >= 3) {
                    notify('AgentMail: лимит ящиков. Удаляю старые…', 'warn', 5000);
                    const sorted = list.sort((a, b) => {
                        const ta = new Date(a.created_at || a.createdAt || 0).getTime();
                        const tb = new Date(b.created_at || b.createdAt || 0).getTime();
                        return ta - tb;
                    });
                    const toDelete = sorted.slice(0, 2);
                    for (const old of toDelete) {
                        const id = old.inbox_id || old.email;
                        log('INFO', 'stageLogin', 'deleting old inbox: ' + id);
                        await delInbox(id);
                    }
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
        log('INFO', 'stageLogin', 'created inbox: ' + JSON.stringify(inbox) + ' codeReqAt=' + new Date(codeReqAt).toISOString());
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
    log('INFO', 'watchCode', 'started');
    while (Date.now() - start < 120000) {
        await sleep(1500);
        if (regDone) { setCanContinue(false); log('INFO', 'watchCode', 'regDone'); return; }
        if (onProfile() || findPwd() || onAboutYou()) {
            log('INFO', 'watchCode', 'next stage detected');
            setCanContinue(false); running = false; return runStage();
        }
        if (!findCodes()) {
            await sleep(1000);
            if (!findCodes()) {
                log('INFO', 'watchCode', 'code field disappeared');
                setCanContinue(false); running = false; return runStage();
            }
        }
    }
    log('WARN', 'watchCode', 'timeout 120s');
    notify('Авто-переход не сработал. Нажмите «Продолжить».', 'warn', 12000);
}

async function stageVerify() {
    if (verifyDone || regDone || polling) return;
    log('INFO', 'stageVerify', 'ENTER. host=' + location.hostname + ' path=' + location.pathname);
    log('INFO', 'stageVerify', 'findCodes=' + (findCodes() ? 'yes' : 'no') + ' hasVerifyText=' + hasVerifyText());
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
    if (!inbox?.id) {
        notify('Нет ящика. Создайте новую регистрацию.', 'err', 10000);
        polling = false; return;
    }
    verifyStats.inboxId = inbox.id;
    verifyStats.inboxEmail = inbox.email;
    log('INFO', 'stageVerify', 'start inbox=' + inbox.email + ' codeReqAt=' + new Date(codeReqAt).toISOString());
    notify(`Проверка: ${inbox.email}`, 'info', 4000);

    for (let i = 0; i < C.maxTries; i++) {
        const at = i + 1;
        verifyStats.attempts = at;
        if (at <= 3 || at % 5 === 0) { notify(`Проверка #${at}/${C.maxTries}`, 'dbg', 2000); setStatus(`#${at}`); }
        const r = await findCode();
        verifyStats.lastReason = r.reason;
        if (r.count) verifyStats.lastMsgCount = r.count;

        if (r.found && r.code) {
            verifyStats.lastCode = r.code;
            verifyStats.lastCodeAge = r.age;
            notify(`Код: ${r.code} (${r.age}с)`, 'info', 8000);
            setStatus('Код…');
            const filled = await fillCode(r.code);
            if (filled) {
                codeDone = true; verifyDone = true;
                usedIds.add(r.msgId);
                await save('usedIds', [...usedIds]);
                await delay(200, 500);
                log('INFO', 'stageVerify', 'clicking Continue after code');
                await clickCont();
                log('INFO', 'stageVerify', 'waiting for URL change after code');
                urlWatch(() => { if (!regDone) { running = false; runStage(); } }, 25000);
                watchCode();
                break;
            } else {
                log('ERROR', 'stageVerify', 'fillCode returned false');
                notify(`Код: ${r.code} (введите вручную)`, 'info', 10000);
                polling = false; return;
            }
        }
        if (r.reason === 'waiting' && (at === 1 || at % 6 === 0)) notify(`Ждём письмо (старых: ${r.count})`, 'info', 3000);
        else if (r.reason === 'rate_limited') { notify('Лимит, пауза 10с…', 'warn', 11000); await sleep(10000); continue; }
        else if (r.reason === 'api_error' && (at === 2 || at % 10 === 0)) notify('Ошибка API, повтор…', 'err', 5000);
        else if (r.reason === 'no_messages' && at === 5) notify('Ящик пуст, ждём…', 'warn', 5000);
        await sleep(C.interval);
    }
    polling = false;
    log('WARN', 'stageVerify', 'loop ended, attempts=' + verifyStats.attempts);
    setTimeout(() => { if (!regDone) { running = false; runStage(); } }, 1000);
}

async function stageProfile() {
    if (profileDone || regDone) return;
    const f = findProfile();
    if (!f.name || !f.age) return setTimeout(() => { if (!profileDone && !regDone) stageProfile(); }, 1000);
    const n = genName(), a = genAge();
    notify(`Имя: ${n}, Возраст: ${a}`, 'info');
    await typeHuman(f.name, n);
    await delay(200, 500);
    fill(f.age, String(a));
    profileDone = true;
    await delay(500, 1500);
    if (await clickCont()) {
        regDone = true;
        await save('complete', true);
        if (!notifyDone) { notifyDone = true; notify('Регистрация завершена!', 'info', 8000); }
        setStatus('✓');
        setCanContinue(false);
        await save('inbox', null); await save('email', null);
        await save('codeReqAt', null); await save('pwd', null);
        if (C.delInbox && C.mode !== 'simplelogin' && inbox?.id) {
            if (await delInbox(inbox.id)) notify('Ящик удалён', 'info', 3000);
        }
        stopUrl();
        if (window.urlTimer) { clearInterval(window.urlTimer); window.urlTimer = null; }
    }
}

function detect() {
    const host = location.hostname;
    const path = location.pathname;

    if (host.includes('auth.openai.com') || path.includes('email-verification')) {
        if (onProfile()) return 'profile';
        if (findCodes() || hasVerifyText()) return 'verify';
        if (findPwd() && !findEmail()) return 'pwd';
        if (findEmail()) return 'login';
    }
    if (hasLoginBtn() && host.includes('chatgpt.com')) return 'main';
    if (onAboutYou()) {
        if (onProfile()) return 'profile';
        if (findCodes()) return 'verify';
        if (findPwd() && !findEmail()) return 'pwd';
    }
    return 'unknown';
}

async function runStage() {
    if (running || regDone) return;
    running = true;
    const s = detect();
    log('INFO', 'stage', '→ ' + s + ' (host=' + location.hostname + ')');
    try {
        if (s === 'main') await stageMain();
        else if (s === 'login') await stageLogin();
        else if (s === 'verify') await stageVerify();
        else if (s === 'pwd') await stagePwd();
        else if (s === 'profile') await stageProfile();
    } catch (e) {
        log('ERROR', 'stage', s + ': ' + e.message);
        notify(`Ошибка: ${e.message}`, 'err');
    }
    running = false;
    log('DEBUG', 'stage', '← ' + s + ' done');
}

async function startReg() {
    log('INFO', 'startReg', 'called');
    if (running) { log('WARN', 'startReg', 'already running'); return; }
    if (loggedIn()) { log('WARN', 'startReg', 'user logged in'); return notify('Вы авторизованы. Выйдите.', 'warn', 6000); }

    if (regDone) {
        log('INFO', 'startReg', 'resetting regDone flag');
        regDone = false;
        notifyDone = false;
        await save('complete', null);
    }

    if (!await ensureKeys()) { log('WARN', 'startReg', 'no keys'); return notify('Настройка отменена', 'warn', 4000); }

    if (C.mode === 'simplelogin' && !C.slRelay) {
        log('WARN', 'startReg', 'simplelogin mode without relay');
        return notify('Укажите AgentMail email в Настройках для SimpleLogin', 'err', 8000);
    }

    setStatus('Старт');
    loginTried = false; verifyDone = false; codeDone = false; pwdDone = false;
    notifyDone = false; setCanContinue(false);
    verifyStats.attempts = 0;
    verifyStats.lastReason = null;
    verifyStats.lastCode = null;
    verifyStats.fillAttempts = 0;
    verifyStats.fillSuccess = 0;
    verifyStats.firstMsgTime = null;
    verifyStats.lastApiError = null;
    running = false;
    try { await runStage(); }
    finally { setTimeout(() => setStatus(''), 1500); }
}

// ═══════════════════ INIT ═══════════════════
function waitBody() {
    return new Promise(r => {
        if (document.body) return r();
        const o = new MutationObserver(() => { if (document.body) { o.disconnect(); r(); } });
        o.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => { o.disconnect(); r(); }, 10000);
    });
}

async function init() {
    if (inited) return;
    try {
        await waitBody();
        injectCSS();
        log('INFO', 'init', 'started, url=' + location.href);

        C.amKey = (await load('amKey')) || '';
        C.slKey = (await load('slKey')) || '';
        C.slRelay = (await load('slRelay')) || '';
        C.mode = (await load('mode')) || 'agentmail';
        C.debug = (await load('debug')) || false;
        codeReqAt = await load('codeReqAt');
        ((await load('usedIds')) || []).forEach(id => usedIds.add(id));
        ctx = await load('ctx');
        inbox = await load('inbox');
        if (inbox?.id) { verifyStats.inboxId = inbox.id; verifyStats.inboxEmail = inbox.email; }
        log('INFO', 'init', 'loaded: mode=' + C.mode + ' relay=' + (C.slRelay || 'нет') + ' debug=' + C.debug);

        const comp = await load('complete');
        const pendingCode = await load('codeReqAt');
        const prevAcc = await load('account');
        const currAcc = currentAccountId();
        log('INFO', 'init', 'complete=' + comp + ' pendingCode=' + !!pendingCode + ' prevAcc=' + prevAcc + ' currAcc=' + currAcc);

        if (comp && loggedIn() && prevAcc && prevAcc === currAcc && !pendingCode) {
            regDone = true;
            notifyDone = true;
            log('INFO', 'init', 'regDone restored');
        } else if (comp) {
            await save('complete', null);
            regDone = false;
            notifyDone = false;
            log('INFO', 'init', 'regDone reset');
        }

        if (prevAcc && currAcc && prevAcc !== currAcc) {
            log('INFO', 'init', 'account changed: ' + prevAcc + ' → ' + currAcc + ', resetting');
            await save('complete', null);
            await save('inbox', null);
            await save('email', null);
            await save('codeReqAt', null);
            regDone = false;
            notifyDone = false;
            inbox = null;
            codeReqAt = null;
        }
        await save('account', currAcc);

        createMenu();
        log('INFO', 'init', 'menu created at left=' + menuBtn.style.left);

        // ⚡ АВТО-ЗАПУСК: verify/pwd/profile без клика
        setTimeout(async () => {
            const stage = detect();
            log('INFO', 'init', 'auto-check stage=' + stage + ' running=' + running + ' regDone=' + regDone + ' codeReqAt=' + (codeReqAt ? 'yes' : 'no'));
            if (stage === 'verify' && !regDone && !running && codeReqAt) {
                log('INFO', 'init', 'auto-runStage verify');
                await runStage();
            } else if (stage === 'pwd' && !regDone && !running) {
                log('INFO', 'init', 'auto-runStage pwd');
                await runStage();
            } else if (stage === 'profile' && !regDone && !running) {
                log('INFO', 'init', 'auto-runStage profile');
                await runStage();
            }
        }, 800);

        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                log('INFO', 'url', lastUrl + ' → ' + location.href);
                lastUrl = location.href;
                if (menuVis) updateMenu();
                if (!regDone && !running && (codeReqAt || inbox)) {
                    log('INFO', 'url', 'auto-runStage on URL change');
                    setTimeout(() => runStage(), 500);
                }
            }
        }, 1000);

        inited = true;
        log('INFO', 'init', 'done');
    } catch (e) {
        log('ERROR', 'init', e);
        notify(`Ошибка init: ${e.message}`, 'err', 10000);
    }
}

if (document.readyState === 'complete') init();
else addEventListener('load', init);

})();
