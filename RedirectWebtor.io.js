// ==UserScript==
// @name         Magnet → Webtor.io
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  Magnet menu with Webtor and clipboard support
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @match        *://*/*
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const WT = 'https://webtor.io/ru/';
    const KEY = '__webtor_magnet__';
    const STYLE_ID = '__wt_style';
    const MENU_ID = '__wt_menu';
    const OVERLAY_ID = '__wt_overlay';
    const TOAST_ID = '__wt_toast';

    const isWT =
        location.hostname === 'webtor.io' ||
        location.hostname.endsWith('.webtor.io');

    /* ---------- Common ---------- */

    const $ = (s, p = document) => p.querySelector(s);

    function magnet(v) {
        if (!v) return null;
        v = String(v).trim();

        if (/^magnet:/i.test(v)) return v;

        try {
            v = decodeURIComponent(v);
            return /^magnet:/i.test(v) ? v : null;
        } catch (_) {
            return null;
        }
    }

    function theme() {
        const h = document.documentElement;
        const b = document.body;

        const attrs = [
            h?.dataset.theme,
            h?.dataset.colorScheme,
            b?.dataset.theme,
            b?.dataset.colorScheme
        ].filter(Boolean).join(' ').toLowerCase();

        if (/dark|black/.test(attrs)) return 'dark';
        if (/light|white/.test(attrs)) return 'light';

        const cls = (
            String(h?.className || '') + ' ' +
            String(b?.className || '')
        ).toLowerCase();

        if (/\bdark\b|dark-mode|theme[-_]dark/.test(cls))
            return 'dark';

        if (/\blight\b|light-mode|theme[-_]light/.test(cls))
            return 'light';

        try {
            const cs = getComputedStyle(h)
                .getPropertyValue('color-scheme')
                .toLowerCase();

            if (cs.includes('dark')) return 'dark';
            if (cs.includes('light')) return 'light';
        } catch (_) {}

        try {
            const bg = getComputedStyle(b || h).backgroundColor;
            const m = bg.match(
                /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/
            );

            if (m) {
                const n =
                    +m[1] * .299 +
                    +m[2] * .587 +
                    +m[3] * .114;

                return n < 145 ? 'dark' : 'light';
            }
        } catch (_) {}

        try {
            if (matchMedia('(prefers-color-scheme: dark)').matches)
                return 'dark';
        } catch (_) {}

        return 'light';
    }

    /* ---------- Styles ---------- */

    function styles() {
        if ($( '#' + STYLE_ID )) return;

        const s = document.createElement('style');
        s.id = STYLE_ID;

        s.textContent = `
#__wt_overlay{
 position:fixed;inset:0;z-index:2147483646;
 background:rgba(0,0,0,.18);
 backdrop-filter:blur(2px);
 -webkit-backdrop-filter:blur(2px)
}
#__wt_menu{
 position:fixed;z-index:2147483647;
 width:min(360px,calc(100vw - 24px));
 box-sizing:border-box;padding:8px;
 border-radius:18px;
 font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
 box-shadow:0 14px 45px rgba(0,0,0,.25);
 border:1px solid transparent;
 animation:__wt_in .15s ease-out
}
#__wt_menu[data-theme=light],#__wt_toast[data-theme=light]{
 background:rgba(255,255,255,.97);
 color:#171717;
 border-color:rgba(0,0,0,.1);
 color-scheme:light
}
#__wt_menu[data-theme=dark],#__wt_toast[data-theme=dark]{
 background:rgba(32,32,36,.97);
 color:#fff;
 border-color:rgba(255,255,255,.12);
 color-scheme:dark
}
#__wt_menu_title{
 padding:9px 12px 7px;
 font-weight:700
}
#__wt_menu_sub{
 padding:0 12px 9px;
 font-size:12px;
 opacity:.6
}
.__wt_btn{
 width:100%;
 display:flex;
 align-items:center;
 gap:10px;
 padding:12px;
 border:0;
 border-radius:12px;
 background:transparent;
 color:inherit;
 font:600 14px inherit;
 text-align:left;
 cursor:pointer;
 transition:background .12s,transform .08s
}
.__wt_btn:hover{background:rgba(127,127,127,.14)}
.__wt_btn:active{transform:scale(.985)}
.__wt_icon{
 width:27px;height:27px;
 display:grid;place-items:center;
 flex:0 0 27px;font-size:18px
}
.__wt_txt{flex:1;min-width:0}
.__wt_desc{
 display:block;
 margin-top:2px;
 font-size:11px;
 font-weight:400;
 opacity:.55
}
#__wt_toast{
 position:fixed;
 left:50%;bottom:24px;
 transform:translate(-50%,20px);
 z-index:2147483647;
 width:max-content;
 max-width:min(90vw,420px);
 box-sizing:border-box;
 padding:11px 16px;
 border-radius:12px;
 font:500 14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
 text-align:center;
 opacity:0;
 pointer-events:none;
 box-shadow:0 8px 30px rgba(0,0,0,.2);
 backdrop-filter:blur(12px);
 -webkit-backdrop-filter:blur(12px);
 transition:opacity .2s,transform .2s
}
@keyframes __wt_in{
 from{opacity:0;transform:scale(.96) translateY(-4px)}
 to{opacity:1;transform:scale(1) translateY(0)}
}
@media(prefers-reduced-motion:reduce){
 #__wt_menu,#__wt_toast{animation:none!important;transition:none!important}
}`;

        (document.head || document.documentElement)?.appendChild(s);
    }

    /* ---------- Toast ---------- */

    function toast(text) {
        $('#' + TOAST_ID)?.remove();

        const t = document.createElement('div');
        t.id = TOAST_ID;
        t.dataset.theme = theme();
        t.textContent = text;

        (document.body || document.documentElement)?.appendChild(t);

        requestAnimationFrame(() => {
            t.style.opacity = '1';
            t.style.transform = 'translate(-50%,0)';
        });

        setTimeout(() => {
            if (!t.isConnected) return;

            t.style.opacity = '0';
            t.style.transform = 'translate(-50%,20px)';

            setTimeout(() => t.remove(), 220);
        }, 2200);
    }

    /* ---------- Clipboard ---------- */

    async function copy(v) {
        try {
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(v, 'text');
                return true;
            }
        } catch (_) {}

        try {
            await navigator.clipboard.writeText(v);
            return true;
        } catch (_) {}

        try {
            const x = document.createElement('textarea');
            x.value = v;
            x.style.cssText =
                'position:fixed;left:-9999px;top:0';
            document.body.appendChild(x);
            x.select();
            const ok = document.execCommand('copy');
            x.remove();
            return ok;
        } catch (_) {
            return false;
        }
    }

    /* ---------- Menu ---------- */

    function closeMenu() {
        $('#' + MENU_ID)?.remove();
        $('#' + OVERLAY_ID)?.remove();
    }

    function position(menu, anchor) {
        const r = anchor.getBoundingClientRect();
        const w = Math.min(360, innerWidth - 24);
        const h = 180;

        let x = r.left + r.width / 2 - w / 2;
        let y = r.bottom + 8;

        if (y + h > innerHeight - 10)
            y = r.top - h - 8;

        x = Math.max(12, Math.min(x, innerWidth - w - 12));
        y = Math.max(12, y);

        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
    }

    function button(icon, title, desc, handler) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = '__wt_btn';

        b.innerHTML = `
            <span class="__wt_icon">${icon}</span>
            <span class="__wt_txt">
                <span>${title}</span>
                <span class="__wt_desc">${desc}</span>
            </span>`;

        b.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            handler();
        }, true);

        return b;
    }

    function menu(mag, anchor) {
        closeMenu();
        styles();

        const t = theme();

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.onclick = closeMenu;

        const m = document.createElement('div');
        m.id = MENU_ID;
        m.dataset.theme = t;
        m.setAttribute('role', 'dialog');

        const title = document.createElement('div');
        title.id = '__wt_menu_title';
        title.textContent = 'Magnet-ссылка';

        const sub = document.createElement('div');
        sub.id = '__wt_menu_sub';
        sub.textContent = 'Что сделать с этой ссылкой?';

        m.append(title, sub);

        m.appendChild(button(
            '🌐',
            'Открыть на Webtor.io',
            'Откроется в новой вкладке',
            () => openWebtor(mag)
        ));

        m.appendChild(button(
            '📋',
            'Скопировать magnet-ссылку',
            'Скопировать в буфер обмена',
            async () => {
                closeMenu();
                toast(
                    await copy(mag)
                        ? 'Magnet-ссылка скопирована 📋'
                        : 'Не удалось скопировать ссылку'
                );
            }
        ));

        m.onclick = e => e.stopPropagation();

        const p = document.body || document.documentElement;
        p.append(overlay, m);

        position(m, anchor);
    }

    /* ---------- Open Webtor ---------- */

    function openWebtor(mag) {
        try {
            GM_setValue(KEY, mag);
        } catch (_) {}

        let w = null;

        try {
            w = window.open(WT, '_blank');
        } catch (_) {}

        if (!w || w.closed || typeof w.closed === 'undefined') {
            location.href = WT;
        }
    }

    /* ---------- Find magnet anchor ---------- */

    function getAnchor(e) {
        if (typeof e.composedPath === 'function') {
            for (const x of e.composedPath()) {
                if (
                    x?.nodeType === 1 &&
                    x.tagName === 'A'
                ) {
                    const m = magnet(x.getAttribute('href'));
                    if (m) return [x, m];
                }
            }
        }

        let x = e.target;

        if (x?.nodeType !== 1)
            x = x?.parentElement;

        const a = x?.closest?.('a');

        if (a) {
            const m = magnet(a.getAttribute('href'));
            if (m) return [a, m];
        }

        return null;
    }

    /* ---------- Intercept magnets ---------- */

    if (!isWT) {
        document.addEventListener('click', e => {
            const x = getAnchor(e);
            if (!x) return;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();

            menu(x[1], x[0]);
        }, true);

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape')
                closeMenu();
        }, true);

        addEventListener('resize', closeMenu, true);
    }

    /* ---------- Webtor auto input ---------- */

    if (isWT) {
        let done = false;

        function pending() {
            try {
                return GM_getValue(KEY, '');
            } catch (_) {
                return '';
            }
        }

        function input() {
            const els = document.querySelectorAll(
                'input,textarea'
            );

            for (const x of els) {
                const s = (
                    (x.placeholder || '') + ' ' +
                    (x.getAttribute('aria-label') || '') + ' ' +
                    (x.name || '')
                ).toLowerCase();

                if (
                    /magnet|infohash/.test(s) &&
                    x.offsetParent !== null
                ) {
                    return x;
                }
            }

            return null;
        }

        function value(x, v) {
            const p = Object.getPrototypeOf(x);
            const d = Object.getOwnPropertyDescriptor(p, 'value');

            if (d?.set)
                d.set.call(x, v);
            else
                x.value = v;
        }

        function submit(x, mag) {
            value(x, mag);

            x.dispatchEvent(
                new Event('input', { bubbles: true })
            );

            x.dispatchEvent(
                new Event('change', { bubbles: true })
            );

            const form = x.closest('form');
            const buttons = form?.querySelectorAll(
                'button,input[type=submit]'
            ) || [];

            let btn = null;

            for (const b of buttons) {
                const s = (
                    b.textContent ||
                    b.value ||
                    b.getAttribute('aria-label') ||
                    ''
                ).toLowerCase();

                if (/найти|search|find|go|открыть/.test(s)) {
                    btn = b;
                    break;
                }
            }

            if (!btn && buttons.length === 1)
                btn = buttons[0];

            if (btn) {
                setTimeout(() => btn.click(), 100);
                return true;
            }

            if (form?.requestSubmit) {
                setTimeout(() => {
                    try { form.requestSubmit(); } catch (_) {}
                }, 100);
                return true;
            }

            setTimeout(() => {
                x.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true
                }));
            }, 100);

            return true;
        }

        function inject() {
            if (done) return true;

            const mag = pending();
            if (!mag) return false;

            const x = input();
            if (!x) return false;

            if (!submit(x, mag)) return false;

            done = true;

            try {
                GM_setValue(KEY, '');
            } catch (_) {}

            return true;
        }

        let n = 0;

        const timer = setInterval(() => {
            if (inject() || ++n >= 80)
                clearInterval(timer);
        }, 250);

        addEventListener(
            'load',
            () => setTimeout(inject, 300),
            true
        );
    }

    styles();

})();
