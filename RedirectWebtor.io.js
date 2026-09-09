// ==UserScript==
// @name         Magnet → Webtor.io
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Меню для magnet-ссылок: Webtor или копирование.
// @author       canary_in_a_coleslaw-ChatGPT
// @match        *://*/*
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const WEBTOR_HOST = 'webtor.io';
    const STORAGE_KEY = 'webtor_magnet';

    // =========================================================
    // WEBTOR
    // =========================================================

    const isWebtor =
        location.hostname === WEBTOR_HOST ||
        location.hostname.endsWith('.' + WEBTOR_HOST);

    // =========================================================
    // СТИЛИ
    // =========================================================

    GM_addStyle(`
        #wt-magnet-menu {
            position: fixed;
            z-index: 2147483647;

            width: 320px;
            max-width: calc(100vw - 20px);

            padding: 8px;

            box-sizing: border-box;

            background: rgba(30, 30, 32, 0.98);
            border: 1px solid rgba(255,255,255,.13);
            border-radius: 16px;

            box-shadow:
                0 18px 50px rgba(0,0,0,.50),
                0 5px 18px rgba(0,0,0,.30);

            color: white;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "SF Pro Text",
                "SF Pro Display",
                "Segoe UI",
                sans-serif;

            animation: wtMenuShow .15s ease-out;
        }

        @keyframes wtMenuShow {
            from {
                opacity: 0;
                transform: scale(.96) translateY(-5px);
            }

            to {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
        }

        #wt-magnet-menu .wt-title {
            padding: 9px 12px 8px;

            font-size: 12px;
            font-weight: 600;

            color: rgba(255,255,255,.45);
        }

        #wt-magnet-menu .wt-button {
            width: 100%;

            display: flex;
            align-items: center;

            padding: 11px 10px;
            margin: 2px 0;

            border: 0;
            border-radius: 11px;

            background: transparent;
            color: white;

            text-align: left;

            cursor: pointer;

            font-family: inherit;

            -webkit-tap-highlight-color: transparent;
        }

        #wt-magnet-menu .wt-button:hover {
            background: rgba(255,255,255,.09);
        }

        #wt-magnet-menu .wt-button:active {
            background: rgba(255,255,255,.15);
            transform: scale(.985);
        }

        #wt-magnet-menu .wt-icon {
            width: 38px;
            height: 38px;

            flex: 0 0 38px;

            display: flex;
            align-items: center;
            justify-content: center;

            margin-right: 12px;

            border-radius: 11px;

            background: rgba(255,255,255,.09);

            font-size: 18px;
        }

        #wt-magnet-menu .wt-text {
            display: flex;
            flex-direction: column;

            gap: 3px;
        }

        #wt-magnet-menu .wt-main {
            font-size: 14px;
            font-weight: 600;
            line-height: 18px;
        }

        #wt-magnet-menu .wt-sub {
            font-size: 11px;
            line-height: 14px;

            color: rgba(255,255,255,.43);
        }

        #wt-toast {
            position: fixed;
            z-index: 2147483647;

            left: 50%;
            bottom: 28px;

            transform: translateX(-50%);

            padding: 12px 18px;

            background: rgba(30,30,32,.98);
            border: 1px solid rgba(255,255,255,.13);
            border-radius: 13px;

            box-shadow:
                0 8px 30px rgba(0,0,0,.4);

            color: white;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "SF Pro Text",
                sans-serif;

            font-size: 13px;
            font-weight: 500;

            white-space: nowrap;

            pointer-events: none;

            animation: wtToastShow .18s ease-out;
        }

        @keyframes wtToastShow {
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

    function closeMenu() {
        const menu =
            document.getElementById('wt-magnet-menu');

        if (menu) {
            menu.remove();
        }
    }

    function showToast(text) {
        const old =
            document.getElementById('wt-toast');

        if (old) {
            old.remove();
        }

        const toast =
            document.createElement('div');

        toast.id = 'wt-toast';
        toast.textContent = text;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 1800);
    }

    // =========================================================
    // ПОЛУЧЕНИЕ MAGNET
    // =========================================================

    function getMagnetFromTarget(target) {

        // Иногда target может быть SVG/текстовым узлом.
        let element = target;

        if (
            element &&
            element.nodeType !== 1
        ) {
            element = element.parentElement;
        }

        if (!element) {
            return null;
        }

        // Ищем ближайшую ссылку.
        const link =
            element.closest
                ? element.closest('a')
                : null;

        if (!link) {
            return null;
        }

        // Берём ИСХОДНЫЙ href.
        const href =
            link.getAttribute('href');

        if (!href) {
            return null;
        }

        const magnet =
            href.trim();

        if (
            magnet.toLowerCase()
                .startsWith('magnet:')
        ) {
            return magnet;
        }

        return null;
    }

    // =========================================================
    // СОЗДАНИЕ WEBTOR URL
    // =========================================================

    function makeWebtorUrl(magnet) {

        /*
         * Magnet находится в HASH.
         *
         * Hash не отправляется Webtor серверу.
         *
         * Его прочитает наш userscript
         * после загрузки Webtor.
         */

        return (
            'https://webtor.io/ru/' +
            '#wt-magnet=' +
            encodeURIComponent(magnet)
        );
    }

    // =========================================================
    // ОТКРЫТЬ WEBTOR
    // =========================================================

    function openWebtor(magnet) {

        try {
            GM_setValue(
                STORAGE_KEY,
                magnet
            );
        } catch (e) {
            console.warn(
                '[Webtor] GM_setValue error',
                e
            );
        }

        const url =
            makeWebtorUrl(magnet);

        /*
         * КРИТИЧЕСКИ ВАЖНО:
         *
         * window.open вызывается прямо
         * внутри пользовательского клика.
         *
         * Поэтому Safari должен открыть
         * НОВУЮ ВКЛАДКУ.
         */

        const tab =
            window.open(
                url,
                '_blank'
            );

        /*
         * Если Safari заблокировал новую вкладку,
         * используем текущую.
         */

        if (!tab) {
            location.href = url;
        }
    }

    // =========================================================
    // КОПИРОВАНИЕ
    // =========================================================

    function copyMagnet(magnet) {

        try {

            GM_setClipboard(
                magnet,
                'text'
            );

            showToast(
                '📋 Magnet-ссылка скопирована'
            );

            return;

        } catch (e) {
            console.warn(
                '[Webtor] Clipboard error',
                e
            );
        }

        // Запасной вариант
        if (
            navigator.clipboard &&
            navigator.clipboard.writeText
        ) {

            navigator.clipboard
                .writeText(magnet)
                .then(() => {

                    showToast(
                        '📋 Magnet-ссылка скопирована'
                    );

                })
                .catch(() => {

                    showToast(
                        '❌ Не удалось скопировать'
                    );

                });

        } else {

            showToast(
                '❌ Буфер обмена недоступен'
            );
        }
    }

    // =========================================================
    // ПОКАЗ МЕНЮ
    // =========================================================

    function showMenu(magnet, x, y) {

        closeMenu();

        const menu =
            document.createElement('div');

        menu.id =
            'wt-magnet-menu';

        menu.innerHTML = `

            <div class="wt-title">
                🔗 Что сделать с magnet-ссылкой?
            </div>

            <button
                class="wt-button"
                type="button"
                id="wt-open-button"
            >

                <span class="wt-icon">
                    🌐
                </span>

                <span class="wt-text">

                    <span class="wt-main">
                        Открыть на Webtor.io
                    </span>

                    <span class="wt-sub">
                        Открыть в новой вкладке
                    </span>

                </span>

            </button>

            <button
                class="wt-button"
                type="button"
                id="wt-copy-button"
            >

                <span class="wt-icon">
                    📋
                </span>

                <span class="wt-text">

                    <span class="wt-main">
                        Скопировать magnet-ссылку
                    </span>

                    <span class="wt-sub">
                        Скопировать оригинальную ссылку
                    </span>

                </span>

            </button>
        `;

        document.body.appendChild(menu);

        // =====================================================
        // ПОЗИЦИЯ
        // =====================================================

        const width =
            menu.offsetWidth;

        const height =
            menu.offsetHeight;

        let left = x;
        let top = y;

        if (
            left + width >
            window.innerWidth - 10
        ) {
            left =
                window.innerWidth -
                width -
                10;
        }

        if (
            top + height >
            window.innerHeight - 10
        ) {
            top =
                window.innerHeight -
                height -
                10;
        }

        left =
            Math.max(10, left);

        top =
            Math.max(10, top);

        menu.style.left =
            left + 'px';

        menu.style.top =
            top + 'px';

        // =====================================================
        // WEBTOR
        // =====================================================

        document
            .getElementById('wt-open-button')
            .addEventListener(
                'click',
                function (e) {

                    e.preventDefault();
                    e.stopPropagation();

                    /*
                     * Сначала открываем вкладку,
                     * потом убираем меню.
                     */

                    openWebtor(magnet);

                    closeMenu();
                }
            );

        // =====================================================
        // COPY
        // =====================================================

        document
            .getElementById('wt-copy-button')
            .addEventListener(
                'click',
                function (e) {

                    e.preventDefault();
                    e.stopPropagation();

                    copyMagnet(magnet);

                    closeMenu();
                }
            );
    }

    // =========================================================
    // ГЛАВНЫЙ ПЕРЕХВАТ MAGNET
    // =========================================================

    if (!isWebtor) {

        document.addEventListener(
            'click',
            function (e) {

                const magnet =
                    getMagnetFromTarget(
                        e.target
                    );

                if (!magnet) {
                    return;
                }

                /*
                 * Полностью запрещаем Safari
                 * открывать magnet самостоятельно.
                 */

                e.preventDefault();
                e.stopPropagation();

                if (
                    e.stopImmediatePropagation
                ) {
                    e.stopImmediatePropagation();
                }

                /*
                 * Координаты клика.
                 *
                 * На iOS clientX/clientY могут
                 * иногда быть 0 — это нормально.
                 */

                let x =
                    typeof e.clientX === 'number'
                        ? e.clientX
                        : 20;

                let y =
                    typeof e.clientY === 'number'
                        ? e.clientY
                        : 20;

                /*
                 * Если координаты нулевые,
                 * показываем меню сверху.
                 */

                if (x === 0) {
                    x = 20;
                }

                if (y === 0) {
                    y = 20;
                }

                showMenu(
                    magnet,
                    x,
                    y
                );

            },
            true
        );

    }

    // =========================================================
    // ЗАКРЫТИЕ МЕНЮ
    // =========================================================

    document.addEventListener(
        'click',
        function (e) {

            const menu =
                document.getElementById(
                    'wt-magnet-menu'
                );

            if (!menu) {
                return;
            }

            if (
                !menu.contains(e.target)
            ) {
                closeMenu();
            }

        },
        false
    );

    document.addEventListener(
        'keydown',
        function (e) {

            if (
                e.key === 'Escape'
            ) {
                closeMenu();
            }

        }
    );

    // =========================================================
    // WEBTOR — ПОЛУЧИТЬ MAGNET
    // =========================================================

    async function getWebtorMagnet() {

        /*
         * Вариант №1 — hash.
         */

        try {

            const prefix =
                '#wt-magnet=';

            if (
                location.hash
                    .startsWith(prefix)
            ) {

                const encoded =
                    location.hash.substring(
                        prefix.length
                    );

                const magnet =
                    decodeURIComponent(
                        encoded
                    );

                if (
                    magnet
                        .toLowerCase()
                        .startsWith('magnet:')
                ) {
                    return magnet;
                }
            }

        } catch (e) {
            console.warn(
                '[Webtor] Hash error',
                e
            );
        }

        /*
         * Вариант №2 — Tampermonkey storage.
         */

        try {

            const magnet =
                await GM_getValue(
                    STORAGE_KEY,
                    ''
                );

            if (
                magnet &&
                magnet
                    .toLowerCase()
                    .startsWith('magnet:')
            ) {
                return magnet;
            }

        } catch (e) {
            console.warn(
                '[Webtor] Storage error',
                e
            );
        }

        return null;
    }

    // =========================================================
    // WEBTOR — НАЙТИ INPUT
    // =========================================================

    function findWebtorInput() {

        const inputs =
            document.querySelectorAll(
                'input'
            );

        // Сначала ищем по placeholder.
        for (
            const input
            of inputs
        ) {

            const placeholder =
                (
                    input.getAttribute(
                        'placeholder'
                    ) || ''
                )
                    .toLowerCase();

            const aria =
                (
                    input.getAttribute(
                        'aria-label'
                    ) || ''
                )
                    .toLowerCase();

            if (
                placeholder.includes(
                    'magnet'
                ) ||
                placeholder.includes(
                    'infohash'
                ) ||
                placeholder.includes(
                    'магнет'
                ) ||
                aria.includes(
                    'magnet'
                ) ||
                aria.includes(
                    'infohash'
                )
            ) {
                return input;
            }
        }

        return null;
    }

    // =========================================================
    // WEBTOR — НАЙТИ КНОПКУ
    // =========================================================

    function findSearchButton(input) {

        if (!input) {
            return null;
        }

        // Ищем кнопку в ближайшем контейнере.
        let parent =
            input.parentElement;

        for (
            let i = 0;
            i < 5 && parent;
            i++
        ) {

            const buttons =
                parent.querySelectorAll(
                    'button'
                );

            for (
                const button
                of buttons
            ) {

                if (
                    button.offsetParent !== null
                ) {
                    return button;
                }
            }

            parent =
                parent.parentElement;
        }

        // Запасной поиск по тексту.
        const buttons =
            document.querySelectorAll(
                'button'
            );

        for (
            const button
            of buttons
        ) {

            const text =
                (
                    button.textContent ||
                    ''
                )
                    .trim()
                    .toLowerCase();

            if (
                text === 'найти' ||
                text === 'search' ||
                text.includes('найти')
            ) {
                return button;
            }
        }

        return null;
    }

    // =========================================================
    // WEBTOR — УСТАНОВИТЬ VALUE
    // =========================================================

    function setInputValue(
        input,
        value
    ) {

        /*
         * Это важно для React/Vue.
         * Простого input.value = ... иногда
         * недостаточно.
         */

        const descriptor =
            Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value'
            );

        if (
            descriptor &&
            descriptor.set
        ) {

            descriptor.set.call(
                input,
                value
            );

        } else {

            input.value =
                value;
        }

        input.dispatchEvent(
            new Event(
                'input',
                {
                    bubbles: true
                }
            )
        );

        input.dispatchEvent(
            new Event(
                'change',
                {
                    bubbles: true
                }
            )
        );
    }

    // =========================================================
    // WEBTOR — АВТОМАТИЧЕСКИ ВСТАВИТЬ MAGNET
    // =========================================================

    async function processWebtor() {

        if (!isWebtor) {
            return;
        }

        const magnet =
            await getWebtorMagnet();

        if (!magnet) {
            return;
        }

        /*
         * Ждём пока Webtor отрисует
         * своё поле.
         */

        let attempts = 0;

        const timer =
            setInterval(
                function () {

                    attempts++;

                    const input =
                        findWebtorInput();

                    if (!input) {

                        if (
                            attempts >= 100
                        ) {
                            clearInterval(
                                timer
                            );
                        }

                        return;
                    }

                    clearInterval(
                        timer
                    );

                    // -----------------------------------------
                    // Вставляем полный magnet.
                    // -----------------------------------------

                    setInputValue(
                        input,
                        magnet
                    );

                    // -----------------------------------------
                    // Небольшая задержка для React/Vue.
                    // -----------------------------------------

                    setTimeout(
                        function () {

                            const button =
                                findSearchButton(
                                    input
                                );

                            if (button) {

                                button.click();

                            } else {

                                /*
                                 * Если кнопку почему-то
                                 * не нашли — Enter.
                                 */

                                input.dispatchEvent(
                                    new KeyboardEvent(
                                        'keydown',
                                        {
                                            key: 'Enter',
                                            code: 'Enter',
                                            keyCode: 13,
                                            which: 13,
                                            bubbles: true
                                        }
                                    )
                                );
                            }

                            // Убираем hash,
                            // чтобы F5 не запускал повторно.

                            try {

                                history.replaceState(
                                    null,
                                    '',
                                    location.pathname +
                                    location.search
                                );

                            } catch (e) {}

                            try {

                                GM_deleteValue(
                                    STORAGE_KEY
                                );

                            } catch (e) {}

                        },
                        500
                    );

                },
                150
            );
    }

    // =========================================================
    // ЗАПУСК WEBTOR
    // =========================================================

    if (isWebtor) {

        if (
            document.readyState ===
            'loading'
        ) {

            document.addEventListener(
                'DOMContentLoaded',
                processWebtor,
                {
                    once: true
                }
            );

        } else {

            processWebtor();
        }
    }

})();
