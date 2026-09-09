// ==UserScript==
// @name         Magnet → Webtor.io
// @namespace    http://tampermonkey.net/
// @version      7.2
// @description  Magnet menu, Webtor and clipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @match        *://*/*
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const WT = 'https://webtor.io/ru/';
    const KEY = '__wt_magnet__';
    const $ = (s, p = document) => p.querySelector(s);
    const isWT = /(^|\.)webtor\.io$/i.test(location.hostname);

    /* ---------- Theme ---------- */

    function getRGB(s) {
        const m = String(s || '').match(
            /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i
        );
        if (!m || (m[4] !== undefined && +m[4] === 0)) return null;
        return [+m[1], +m[2], +m[3]];
    }

    function light(c) {
        return c ? c[0] * .299 + c[1] * .587 + c[2] * .114 : null;
    }

    function explicitTheme() {
        const h = document.documentElement, b = document.body;
        const a = [
            h?.dataset.theme, h?.dataset.colorScheme,
            h?.getAttribute('data-theme'),
            h?.getAttribute('data-color-scheme'),
            b?.dataset.theme, b?.dataset.colorScheme
        ].filter(Boolean).join(' ').toLowerCase();

        if (/dark|black/.test(a)) return 'dark';
        if (/light|white/.test(a)) return 'light';

        const c = (
            String(h?.className || '') + ' ' +
            String(b?.className || '')
        ).toLowerCase();

        if (/\bdark\b|dark-mode|theme[-_]dark/.test(c)) return 'dark';
        if (/\blight\b|light-mode|theme[-_]light/.test(c)) return 'light';

        return null;
    }

    function pageLightness() {
        const pts = [
            [1,1],
            [innerWidth / 2,1],
            [innerWidth - 2,1],
            [1,innerHeight / 2],
            [innerWidth - 2,innerHeight / 2],
            [1,innerHeight - 2],
            [innerWidth / 2,innerHeight - 2]
        ];

        const vals = [];

        for (const p of pts) {
            try {
                let e = document.elementFromPoint(...p);

                while (e && e !== document) {
                    const c = getRGB(
                        getComputedStyle(e).backgroundColor
                    );

                    if (c) {
                        const n = light(c);
                        if (n != null) {
                            vals.push(n);
                            break;
                        }
                    }

                    e = e.parentElement;
                }
            } catch (_) {}
        }

        if (!vals.length) return null;

        vals.sort((a, b) => a - b);
        return vals[(vals.length / 2) | 0];
    }

    function theme() {
        const e = explicitTheme();
        if (e) return e;

        const bg = pageLightness();

        if (bg != null) {
            if (bg > 165) return 'light';
            if (bg < 115) return 'dark';
            return bg < 145 ? 'dark' : 'light';
        }

        try {
            const cs = getComputedStyle(
                document.documentElement
            ).getPropertyValue('color-scheme').toLowerCase();

            if (cs.includes('light') && !cs.includes('dark'))
                return 'light';

            if (cs.includes('dark') && !cs.includes('light'))
                return 'dark';
        } catch (_) {}

        try {
            if (matchMedia('(prefers-color-scheme:dark)').matches)
                return 'dark';
        } catch (_) {}

        return 'light';
    }

    /* ---------- Styles ---------- */

    function styles() {
        if ($('#__wt_style')) return;

        const s = document.createElement('style');
        s.id = '__wt_style';

        s.textContent = `
#__wt_overlay{
 position:fixed;inset:0;z-index:2147483646;
 background:rgba(0,0,0,.16);
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
#__wt_title{
 padding:9px 12px 7px;
 font-weight:700
}
#__wt_sub{
 padding:0 12px 9px;
 font-size:12px;
 opacity:.6
}
.__wt_btn{
 width:100%;display:flex;align-items:center;gap:10px;
 padding:12px;border:0;border-radius:12px;
 background:transparent;color:inherit;
 font:600 14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
 text-align:left;cursor:pointer;
 transition:background .12s,transform .08s
}
.__wt_btn:hover{background:rgba(127,127,127,.14)}
.__wt_btn:active{transform:scale(.985)}
.__wt_icon{
 width:27px;height:27px;display:grid;place-items:center;
 flex:0 0 27px;font-size:18px
}
.__wt_txt{flex:1;min-width:0}
.__wt_desc{
 display:block;margin-top:2px;
 font-size:11px;font-weight:400;opacity:.55
}
#__wt_toast{
 position:fixed;left:50%;bottom:24px;
 transform:translate(-50%,20px);
 z-index:2147483647;
 width:max-content;max-width:min(90vw,420px);
 box-sizing:border-box;padding:11px 16px;
 border-radius:12px;
 font:500 14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
 text-align:center;opacity:0;pointer-events:none;
 box-shadow:0 8px 30px rgba(0,0,0,.2);
 backdrop-filter:blur(12px);
 -webkit-backdrop-filter:blur(12px);
 transition:opacity .2s,transform .2s
}
@keyframes __wt_in{
 from{opacity:0;transform:scale(.96) translateY(-4px)}
 to{opacity:1;transform:scale(1) translateY(0)}
}`;

        (document.head || document.documentElement).appendChild(s);
    }

    /* ---------- Toast ---------- */

    function toast(text) {
        $('#' + '__wt_toast')?.remove();

        const t = document.createElement('div');
        t.id = '__wt_toast';
        t.dataset.theme = theme();
        t.textContent = text;

        (document.body || document.documentElement).appendChild(t);

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

    async function copy(text) {
        try {
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(text, 'text');
                return true;
            }
        } catch (_) {}

        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) {}

        try {
            const x = document.createElement('textarea');
            x.value = text;
            x.style.cssText = 'position:fixed;left:-9999px;top:0';
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
        $('#__wt_menu')?.remove();
        $('#__wt_overlay')?.remove();
    }

    function button(icon, title, desc, fn) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = '__wt_btn';

        b.innerHTML =
            `<span class="__wt_icon">${icon}</span>` +
            `<span class="__wt_txt"><span>${title}</span>` +
            `<span class="__wt_desc">${desc}</span></span>`;

        b.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            fn();
        };

        return b;
    }

    function showMenu(mag, anchor) {
        closeMenu();
        styles();

        const m = document.createElement('div');
        m.id = '__wt_menu';
        m.dataset.theme = theme();

        const title = document.createElement('div');
        title.id = '__wt_title';
        title.textContent = 'Magnet-ссылка';

        const sub = document.createElement('div');
        sub.id = '__wt_sub';
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

        const o = document.createElement('div');
        o.id = '__wt_overlay';
        o.onclick = closeMenu;

        m.onclick = e => e.stopPropagation();

        const p =
            document.body ||
            document.documentElement;

        p.append(o, m);

        const r = anchor.getBoundingClientRect();
        const w = Math.min(360, innerWidth - 24);
        const h = 180;

        let x = r.left + r.width / 2 - w / 2;
        let y = r.bottom + 8;

        if (y + h > innerHeight - 10)
            y = r.top - h - 8;

        m.style.left =
            Math.max(12, Math.min(x, innerWidth - w - 12)) + 'px';

        m.style.top =
            Math.max(12, y) + 'px';
    }

    /* ---------- Webtor ---------- */

    function openWebtor(mag) {
        try {
            GM_setValue(KEY, mag);
        } catch (_) {}

        let w = null;

        try {
            w = window.open(WT, '_blank');
        } catch (_) {}

        if (!w || w.closed || typeof w.closed === 'undefined')
            location.href = WT;
    }

    /* ---------- Magnet interception ---------- */

    function getLink(e) {
        if (e.composedPath) {
            for (const x of e.composedPath()) {
                if (x?.nodeType === 1 && x.tagName === 'A') {
                    const m = getMagnet(x.getAttribute('href'));
                    if (m) return [x, m];
                }
            }
        }

        let x = e.target;
        if (x?.nodeType !== 1) x = x?.parentElement;

        const a = x?.closest?.('a');
        if (!a) return null;

        const m = getMagnet(a.getAttribute('href'));
        return m ? [a, m] : null;
    }

    if (!isWT) {
        document.addEventListener('click', e => {
            const x = getLink(e);
            if (!x) return;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();

            showMenu(x[1], x[0]);
        }, true);

        document.addEventListener(
            'keydown',
            e => e.key === 'Escape' && closeMenu(),
            true
        );

        addEventListener('resize', closeMenu, true);
    }

    /* ---------- Webtor input ---------- */

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
            for (const x of document.querySelectorAll(
                'input,textarea'
            )) {
                const s = (
                    (x.placeholder || '') + ' ' +
                    (x.getAttribute('aria-label') || '') + ' ' +
                    (x.name || '')
                ).toLowerCase();

                if (
                    /magnet|infohash/.test(s) &&
                    x.offsetParent !== null
                ) return x;
            }

            return null;
        }

        function setValue(x, v) {
            const d = Object.getOwnPropertyDescriptor(
                Object.getPrototypeOf(x),
                'value'
            );

            d?.set ? d.set.call(x, v) : x.value = v;
        }

        function submit(x, mag) {
            setValue(x, mag);

            x.dispatchEvent(
                new Event('input', { bubbles: true })
            );

            x.dispatchEvent(
                new Event('change', { bubbles: true })
            );

            const form = x.closest('form');
            const bs = form?.querySelectorAll(
                'button,input[type=submit]'
            ) || [];

            let b = null;

            for (const z of bs) {
                const s = (
                    z.textContent ||
                    z.value ||
                    z.getAttribute('aria-label') ||
                    ''
                ).toLowerCase();

                if (/найти|search|find|go|открыть/.test(s)) {
                    b = z;
                    break;
                }
            }

            if (!b && bs.length === 1)
                b = bs[0];

            if (b) {
                setTimeout(() => b.click(), 100);
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
            const x = input();

            if (!mag || !x) return false;

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
