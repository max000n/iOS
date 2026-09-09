// ==UserScript==
// @name         Magnet Links → Webtor.io
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Красивое меню для magnet-ссылок: открыть в Webtor.io или скопировать ссылку.
// @author       canary_in_a_coleslaw-ChatGPT
// @match        *://*/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // СТИЛИ МЕНЮ
    // =========================================================

    GM_addStyle(`
        #webtor-magnet-menu {
            position: fixed;
            z-index: 2147483647;
            min-width: 300px;
            padding: 8px;
            background: rgba(25, 25, 28, 0.98);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 14px;
            box-shadow:
                0 12px 40px rgba(0, 0, 0, 0.45),
                0 4px 12px rgba(0, 0, 0, 0.25);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                Roboto,
                Arial,
                sans-serif;
            color: #fff;
            animation: webtorMenuIn 0.15s ease-out;
        }

        @keyframes webtorMenuIn {
            from {
                opacity: 0;
                transform: translateY(-5px) scale(0.98);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }

        #webtor-magnet-menu .webtor-menu-title {
            padding: 8px 12px 7px;
            font-size: 13px;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.5);
        }

        #webtor-magnet-menu button {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 11px 12px;
            margin: 2px 0;
            border: 0;
            border-radius: 10px;
            background: transparent;
            color: #fff;
            cursor: pointer;
            text-align: left;
            font-size: 14px;
            transition:
                background 0.12s ease,
                transform 0.12s ease;
        }

        #webtor-magnet-menu button:hover {
            background: rgba(255, 255, 255, 0.10);
        }

        #webtor-magnet-menu button:active {
            transform: scale(0.98);
        }

        #webtor-magnet-menu .webtor-icon {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            border-radius: 9px;
            background: rgba(255, 255, 255, 0.08);
            font-size: 17px;
        }

        #webtor-magnet-menu .webtor-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        #webtor-magnet-menu .webtor-main {
            font-weight: 600;
            font-size: 14px;
        }

        #webtor-magnet-menu .webtor-sub {
            font-size: 11px;
            color: rgba(255, 255, 255, 0.45);
        }

        #webtor-magnet-toast {
            position: fixed;
            z-index: 2147483647;
            left: 50%;
            bottom: 25px;
            transform: translateX(-50%);
            padding: 11px 17px;
            background: rgba(25, 25, 28, 0.97);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 12px;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                Roboto,
                Arial,
                sans-serif;
            font-size: 13px;
            font-weight: 500;
            pointer-events: none;
            animation: webtorToastIn 0.18s ease-out;
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
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // =========================================================

    function removeMenu() {
        const menu = document.getElementById('webtor-magnet-menu');

        if (menu) {
            menu.remove();
        }
    }

    function showToast(message) {
        const oldToast = document.getElementById('webtor-magnet-toast');

        if (oldToast) {
            oldToast.remove();
        }

        const toast = document.createElement('div');
        toast.id = 'webtor-magnet-toast';
        toast.textContent = message;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 1800);
    }

    // =========================================================
    // КОПИРОВАНИЕ MAGNET-ССЫЛКИ
    // =========================================================

    async function copyMagnet(magnetHref) {
        try {
            // Предпочтительно используем GM_setClipboard,
            // потому что он не зависит от clipboard permission сайта.
            GM_setClipboard(magnetHref, 'text');

            showToast('📋 Magnet-ссылка скопирована');
        } catch (error) {
            // Запасной вариант
            try {
                await navigator.clipboard.writeText(magnetHref);
                showToast('📋 Magnet-ссылка скопирована');
            } catch (clipboardError) {
                console.error(
                    '[Webtor] Не удалось скопировать ссылку:',
                    clipboardError
                );

                showToast('❌ Не удалось скопировать ссылку');
            }
        }
    }

    // =========================================================
    // ОТКРЫТИЕ WEBTOR
    // =========================================================

    function openWebtor(magnetHref) {
        /*
         * ВАЖНО:
         *
         * Раньше здесь из magnet-ссылки вырезался 40-символьный hash:
         *
         *     https://webtor.io/HASH
         *
         * Теперь передаём ПОЛНЫЙ magnet URI.
         *
         * Webtor официально умеет открывать magnet-ссылки напрямую.
         * Это сохраняет:
         *   - btih
         *   - dn
         *   - трекеры (tr)
         *   - другие параметры magnet-ссылки
         *
         * Именно это должно устранить проблему "ресурс не найден".
         */

        const webtorUrl =
            'https://webtor.io/' + encodeURIComponent(magnetHref);

        // Открываем в новой вкладке.
        const newWin = window.open(webtorUrl, '_blank');

        // Если браузер заблокировал popup — открываем в текущей вкладке.
        if (!newWin) {
            window.location.href = webtorUrl;
        }
    }

    // =========================================================
    // ПОКАЗ МЕНЮ
    // =========================================================

    function showMenu(magnetHref, x, y) {
        removeMenu();

        const menu = document.createElement('div');
        menu.id = 'webtor-magnet-menu';

        menu.innerHTML = `
            <div class="webtor-menu-title">
                🔗 Magnet-ссылка
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
                        Скопировать magnet-ссылку
                    </span>
                    <span class="webtor-sub">
                        Скопировать ссылку в буфер обмена
                    </span>
                </span>
            </button>
        `;

        document.body.appendChild(menu);

        // =====================================================
        // ПОЗИЦИОНИРОВАНИЕ
        // =====================================================

        const menuWidth = menu.offsetWidth;
        const menuHeight = menu.offsetHeight;

        let left = x;
        let top = y;

        // Не даём меню выйти за правый край
        if (left + menuWidth > window.innerWidth - 10) {
            left = window.innerWidth - menuWidth - 10;
        }

        // Не даём меню выйти за нижний край
        if (top + menuHeight > window.innerHeight - 10) {
            top = window.innerHeight - menuHeight - 10;
        }

        // Защита от отрицательных координат
        left = Math.max(10, left);
        top = Math.max(10, top);

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;

        // =====================================================
        // КНОПКА "ОТКРЫТЬ"
        // =====================================================

        menu.querySelector('[data-action="open"]')
            .addEventListener('click', function () {
                removeMenu();
                openWebtor(magnetHref);
            });

        // =====================================================
        // КНОПКА "КОПИРОВАТЬ"
        // =====================================================

        menu.querySelector('[data-action="copy"]')
            .addEventListener('click', function () {
                removeMenu();
                copyMagnet(magnetHref);
            });
    }

    // =========================================================
    // ОБРАБОТКА КЛИКА ПО MAGNET
    // =========================================================

    document.addEventListener(
        'click',
        function (e) {
            const link = e.target.closest('a');

            if (!link) {
                return;
            }

            /*
             * Берём именно исходный href из HTML,
             * а не link.href.
             *
             * Это важно: link.href может быть преобразован браузером
             * в абсолютный URL.
             */
            const href = link.getAttribute('href');

            if (!href) {
                return;
            }

            // Учитываем возможные пробелы и регистр MAGNET:
            const magnetHref = href.trim();

            if (!/^magnet:/i.test(magnetHref)) {
                return;
            }

            // Останавливаем стандартное открытие magnet-ссылки.
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            // Показываем меню рядом с курсором.
            showMenu(
                magnetHref,
                e.clientX,
                e.clientY
            );
        },
        true
    );

    // =========================================================
    // ЗАКРЫТИЕ МЕНЮ ПРИ КЛИКЕ СНАРУЖУ
    // =========================================================

    document.addEventListener(
        'click',
        function (e) {
            const menu = document.getElementById('webtor-magnet-menu');

            if (!menu) {
                return;
            }

            if (!menu.contains(e.target)) {
                removeMenu();
            }
        },
        false
    );

    // =========================================================
    // ESC — ЗАКРЫТЬ МЕНЮ
    // =========================================================

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            removeMenu();
        }
    });

})();
