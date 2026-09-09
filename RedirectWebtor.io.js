// ==UserScript==
// @name         Magnet Links → Webtor.io
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Показывает меню для magnet-ссылок: открыть в Webtor.io или скопировать.
// @author       canary_in_a_coleslaw-ChatGPT
// @match        *://*/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // СТИЛИ
    // =========================================================

    GM_addStyle(`
        #webtor-magnet-menu {
            position: fixed;
            z-index: 2147483647;
            width: 310px;
            box-sizing: border-box;
            padding: 8px;
            background: rgba(28, 28, 30, 0.98);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 16px;
            box-shadow:
                0 15px 45px rgba(0, 0, 0, 0.45),
                0 5px 15px rgba(0, 0, 0, 0.25);
            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "SF Pro Display",
                "SF Pro Text",
                "Segoe UI",
                sans-serif;
            color: #fff;
            overflow: hidden;
            animation: webtorMenuIn .16s ease-out;
        }

        @keyframes webtorMenuIn {
            from {
                opacity: 0;
                transform: scale(.96) translateY(-5px);
            }

            to {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
        }

        #webtor-magnet-menu .webtor-title {
            padding: 9px 12px 8px;
            color: rgba(255,255,255,.45);
            font-size: 12px;
            font-weight: 600;
        }

        #webtor-magnet-menu button {
            width: 100%;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 11px 10px;
            margin: 2px 0;
            border: 0;
            border-radius: 11px;
            background: transparent;
            color: white;
            text-align: left;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
        }

        #webtor-magnet-menu button:active {
            background: rgba(255,255,255,.12);
        }

        #webtor-magnet-menu .webtor-icon {
            width: 36px;
            height: 36px;
            flex: 0 0 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 10px;
            background: rgba(255,255,255,.09);
            font-size: 18px;
        }

        #webtor-magnet-menu .webtor-text {
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 3px;
        }

        #webtor-magnet-menu .webtor-main {
            font-size: 14px;
            font-weight: 600;
            line-height: 18px;
        }

        #webtor-magnet-menu .webtor-sub {
            font-size: 11px;
            line-height: 14px;
            color: rgba(255,255,255,.43);
        }

        #webtor-magnet-toast {
            position: fixed;
            z-index: 2147483647;
            left: 50%;
            bottom: 28px;
            transform: translateX(-50%);
            padding: 12px 18px;
            background: rgba(28,28,30,.98);
            color: #fff;
            border: 1px solid rgba(255,255,255,.12);
            border-radius: 13px;
            box-shadow: 0 8px 30px rgba(0,0,0,.4);
            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "SF Pro Text",
                "Segoe UI",
                sans-serif;
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            animation: webtorToastIn .18s ease-out;
        }

        @keyframes webtorToastIn {
            from {
                opacity: 0;
                transform: translate(-50%, 8px);
            }

            to {
                opacity: 1;
                transform: translate(-50%, 0);
            }
        }
    `);

    // =========================================================
    // УДАЛИТЬ МЕНЮ
    // =========================================================

    function closeMenu() {
        const menu = document.getElementById('webtor-magnet-menu');

        if (menu) {
            menu.remove();
        }
    }

    // =========================================================
    // TOAST
    // =========================================================

    function showToast(text) {
        const old = document.getElementById('webtor-magnet-toast');

        if (old) {
            old.remove();
        }

        const toast = document.createElement('div');

        toast.id = 'webtor-magnet-toast';
        toast.textContent = text;

        document.body.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 1800);
    }

    // =========================================================
    // BASE32 → HEX
    // Нужно для magnet-ссылок с btih в base32.
    // =========================================================

    function base32ToHex(base32) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

        let bits = '';
        let result = '';

        base32 = base32
            .toUpperCase()
            .replace(/[^A-Z2-7]/g, '');

        for (const char of base32) {
            const value = alphabet.indexOf(char);

            if (value === -1) {
                return null;
            }

            bits += value.toString(2).padStart(5, '0');
        }

        // SHA1 = 20 байт = 160 бит.
        bits = bits.substring(0, 160);

        for (let i = 0; i + 8 <= bits.length; i += 8) {
            result += parseInt(bits.substring(i, i + 8), 2)
                .toString(16)
                .padStart(2, '0');
        }

        return result.length === 40 ? result : null;
    }

    // =========================================================
    // ПОЛУЧИТЬ INFOHASH ИЗ MAGNET
    // =========================================================

    function getInfoHash(magnet) {
        const match = magnet.match(
            /(?:^|[?&])xt=urn:btih:([^&]+)/i
        );

        if (!match) {
            return null;
        }

        let hash = match[1];

        // Иногда значение URL-encoded.
        try {
            hash = decodeURIComponent(hash);
        } catch (e) {
            // Оставляем как есть.
        }

        // Вариант 1:
        // обычный 40-символьный SHA1 в HEX.
        if (/^[a-f0-9]{40}$/i.test(hash)) {
            return hash.toLowerCase();
        }

        // Вариант 2:
        // старый magnet с Base32 infohash.
        if (/^[a-z2-7]{32}$/i.test(hash)) {
            return base32ToHex(hash);
        }

        return null;
    }

    // =========================================================
    // ОТКРЫТЬ WEBTOR
    // =========================================================

    function openWebtor(magnet) {
        const hash = getInfoHash(magnet);

        if (!hash) {
            showToast('⚠️ Не удалось определить infohash');

            // Не отправляем некорректный URL в Safari.
            return;
        }

        /*
         * Используем только обычный HTTPS URL.
         *
         * НИКАКОГО:
         *
         * https://webtor.io/magnet%3A...
         *
         * Здесь больше нет.
         *
         * Safari получает нормальный HTTPS-адрес:
         *
         * https://webtor.io/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
         */

        const webtorUrl = 'https://webtor.io/' + hash;

        /*
         * ВАЖНО ДЛЯ iOS:
         *
         * window.open() может считаться popup.
         * Поэтому вызываем его непосредственно внутри
         * обработчика пользовательского нажатия.
         */

        const opened = window.open(webtorUrl, '_blank');

        if (!opened) {
            window.location.assign(webtorUrl);
        }
    }

    // =========================================================
    // СКОПИРОВАТЬ MAGNET
    // =========================================================

    function copyMagnet(magnet) {
        try {
            GM_setClipboard(magnet, 'text');
            showToast('📋 Magnet-ссылка скопирована');
            return;
        } catch (e) {
            console.warn('[Webtor] GM_setClipboard failed:', e);
        }

        // Запасной вариант.
        if (navigator.clipboard) {
            navigator.clipboard.writeText(magnet)
                .then(() => {
                    showToast('📋 Magnet-ссылка скопирована');
                })
                .catch(() => {
                    showToast('❌ Не удалось скопировать ссылку');
                });

            return;
        }

        showToast('❌ Буфер обмена недоступен');
    }

    // =========================================================
    // ПОКАЗАТЬ МЕНЮ
    // =========================================================

    function showMenu(magnet, x, y) {
        closeMenu();

        const menu = document.createElement('div');

        menu.id = 'webtor-magnet-menu';

        menu.innerHTML = `
            <div class="webtor-title">
                🔗 Что сделать с magnet-ссылкой?
            </div>

            <button type="button" data-action="open">
                <span class="webtor-icon">🌐</span>

                <span class="webtor-text">
                    <span class="webtor-main">
                        Открыть на Webtor.io
                    </span>

                    <span class="webtor-sub">
                        Открыть торрент в новой вкладке
                    </span>
                </span>
            </button>

            <button type="button" data-action="copy">
                <span class="webtor-icon">📋</span>

                <span class="webtor-text">
                    <span class="webtor-main">
                        Скопировать ссылку
                    </span>

                    <span class="webtor-sub">
                        Сохранить оригинальный magnet в буфер
                    </span>
                </span>
            </button>
        `;

        document.body.appendChild(menu);

        // =====================================================
        // ПОЗИЦИЯ МЕНЮ
        // =====================================================

        const width = menu.offsetWidth;
        const height = menu.offsetHeight;

        let left = x;
        let top = y;

        // Справа
        if (left + width > window.innerWidth - 10) {
            left = window.innerWidth - width - 10;
        }

        // Снизу
        if (top + height > window.innerHeight - 10) {
            top = window.innerHeight - height - 10;
        }

        // Защита от выхода за экран
        left = Math.max(10, left);
        top = Math.max(10, top);

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;

        // =====================================================
        // ОТКРЫТЬ
        // =====================================================

        menu.querySelector('[data-action="open"]')
            .addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();

                closeMenu();

                openWebtor(magnet);
            });

        // =====================================================
        // КОПИРОВАТЬ
        // =====================================================

        menu.querySelector('[data-action="copy"]')
            .addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();

                closeMenu();

                copyMagnet(magnet);
            });
    }

    // =========================================================
    // ПЕРЕХВАТ MAGNET
    // =========================================================

    document.addEventListener(
        'click',
        function (e) {
            const link = e.target.closest('a');

            if (!link) {
                return;
            }

            /*
             * Берём оригинальный href из HTML.
             *
             * Не используем link.href,
             * потому что браузер может преобразовать значение.
             */

            const href = link.getAttribute('href');

            if (!href) {
                return;
            }

            const magnet = href.trim();

            if (!/^magnet:/i.test(magnet)) {
                return;
            }

            /*
             * Полностью блокируем стандартную обработку
             * magnet-ссылки браузером/iOS.
             */

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            // Показываем наше меню.
            showMenu(
                magnet,
                e.clientX,
                e.clientY
            );
        },
        true
    );

    // =========================================================
    // КЛИК СНАРУЖИ → ЗАКРЫТЬ
    // =========================================================

    document.addEventListener(
        'click',
        function (e) {
            const menu = document.getElementById(
                'webtor-magnet-menu'
            );

            if (!menu) {
                return;
            }

            if (!menu.contains(e.target)) {
                closeMenu();
            }
        },
        false
    );

    // =========================================================
    // ESC → ЗАКРЫТЬ
    // =========================================================

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeMenu();
        }
    });

})();
