// ==UserScript==
// @name         Magnet → Webtor.io
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  Меню для magnet-ссылок: Webtor или копирование. Автоматическая светлая/тёмная тема.
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

    const isWebtor =
        location.hostname === WEBTOR_HOST ||
        location.hostname.endsWith('.' + WEBTOR_HOST);

    // =========================================================
    // СТИЛИ
    // =========================================================

    GM_addStyle(`
        /* =====================================================
           ОСНОВНОЕ МЕНЮ
           ===================================================== */

        #wt-magnet-menu {
            --wt-bg: rgba(255, 255, 255, 0.98);
            --wt-border: rgba(0, 0, 0, 0.10);
            --wt-text: #1c1c1e;
            --wt-secondary: rgba(0, 0, 0, 0.48);
            --wt-icon-bg: rgba(0, 0, 0, 0.055);
            --wt-hover: rgba(0, 0, 0, 0.065);
            --wt-active: rgba(0, 0, 0, 0.10);

            position: fixed;
            z-index: 2147483647;

            width: 320px;
            max-width: calc(100vw - 20px);

            padding: 8px;

            box-sizing: border-box;

            background: var(--wt-bg);
            border: 1px solid var(--wt-border);
            border-radius: 16px;

            box-shadow:
                0 18px 50px rgba(0,0,0,.20),
                0 5px 18px rgba(0,0,0,.12);

            color: var(--wt-text);

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "SF Pro Text",
                "SF Pro Display",
                "Segoe UI",
                sans-serif;

            backdrop-filter: blur(18px);
            -webkit-backdrop-filter: blur(18px);

            animation:
                wtMenuShow .15s ease-out;
        }


        /* =====================================================
           ТЁМНАЯ ТЕМА
           ===================================================== */

        #wt-magnet-menu.wt-dark {
            --wt-bg: rgba(30, 30, 32, 0.98);
            --wt-border: rgba(255,255,255,.13);
            --wt-text: #ffffff;
            --wt-secondary: rgba(255,255,255,.43);
            --wt-icon-bg: rgba(255,255,255,.09);
            --wt-hover: rgba(255,255,255,.09);
            --wt-active: rgba(255,255,255,.15);

            box-shadow:
                0 18px 50px rgba(0,0,0,.50),
                0 5px 18px rgba(0,0,0,.30);
        }


        /* =====================================================
           ЗАГОЛОВОК
           ===================================================== */

        #wt-magnet-menu .wt-title {
            padding:
                9px 12px 8px;

            font-size: 12px;
            font-weight: 600;

            color: var(--wt-secondary);
        }


        /* =====================================================
           КНОПКИ
           ===================================================== */

        #wt-magnet-menu .wt-button {
            width: 100%;

            display: flex;
            align-items: center;

            padding: 11px 10px;
            margin: 2px 0;

            border: 0;
            border-radius: 11px;

            background: transparent;
            color: var(--wt-text);

            text-align: left;

            cursor: pointer;

            font-family: inherit;

            -webkit-tap-highlight-color: transparent;

            transition:
                background .12s ease,
                transform .12s ease;
        }

        #wt-magnet-menu .wt-button:hover {
            background: var(--wt-hover);
        }

        #wt-magnet-menu .wt-button:active {
            background: var(--wt-active);
            transform: scale(.985);
        }


        /* =====================================================
           ИКОНКИ
           ===================================================== */

        #wt-magnet-menu .wt-icon {
            width: 38px;
            height: 38px;

            flex: 0 0 38px;

            display: flex;
            align-items: center;
            justify-content: center;

            margin-right: 12px;

            border-radius: 11px;

            background: var(--wt-icon-bg);

            font-size: 18px;
        }


        /* =====================================================
           ТЕКСТ
           ===================================================== */

        #wt-magnet-menu .wt-text {
            display: flex;
            flex-direction: column;

            gap: 3px;
        }

        #wt-magnet-menu .wt-main {
            font-size: 14px;
            font-weight: 600;
            line-height: 18px;

            color: var(--wt-text);
        }

        #wt-magnet-menu .wt-sub {
            font-size: 11px;
            line-height: 14px;

            color: var(--wt-secondary);
        }


        /* =====================================================
           АНИМАЦИЯ МЕНЮ
           ===================================================== */

        @keyframes wtMenuShow {
            from {
                opacity: 0;
                transform:
                    scale(.96)
                    translateY(-5px);
            }

            to {
                opacity: 1;
                transform:
                    scale(1)
                    translateY(0);
            }
        }


        /* =====================================================
           TOAST
           ===================================================== */

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

            animation:
                wtToastShow .18s ease-out;
        }

        @keyframes wtToastShow {
            from {
                opacity: 0;
                transform:
                    translate(-50%, 8px);
            }

            to {
                opacity: 1;
                transform:
                    translate(-50%, 0);
            }
        }
    `);


    // =========================================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // =========================================================

    function closeMenu() {
        const menu =
            document.getElementById(
                'wt-magnet-menu'
            );

        if (menu) {
            menu.remove();
        }
    }


    function showToast(text) {

        const old =
            document.getElementById(
                'wt-toast'
            );

        if (old) {
            old.remove();
        }

        const toast =
            document.createElement('div');

        toast.id =
            'wt-toast';

        toast.textContent =
            text;

        document.body.appendChild(
            toast
        );

        setTimeout(() => {

            if (toast.parentNode) {
                toast.remove();
            }

        }, 1800);
    }


    // =========================================================
    // ОПРЕДЕЛЕНИЕ RGB
    // =========================================================

    function parseColor(color) {

        if (!color) {
            return null;
        }

        color =
            color.trim().toLowerCase();

        // -----------------------------------------------------
        // rgb() / rgba()
        // -----------------------------------------------------

        const rgbMatch =
            color.match(
                /^rgba?\\(\\s*
                    ([\\d.]+)
                    \\s*,\\s*
                    ([\\d.]+)
                    \\s*,\\s*
                    ([\\d.]+)
                    (?:\\s*,\\s*
                    ([\\d.]+))?
                    \\s*\\)$/x
            );

        if (rgbMatch) {

            return {
                r: Number(rgbMatch[1]),
                g: Number(rgbMatch[2]),
                b: Number(rgbMatch[3]),
                a:
                    rgbMatch[4] !== undefined
                        ? Number(rgbMatch[4])
                        : 1
            };
        }

        // -----------------------------------------------------
        // HEX
        // -----------------------------------------------------

        const hex =
            color.match(
                /^#([0-9a-f]{3,8})$/i
            );

        if (hex) {

            let value =
                hex[1];

            if (value.length === 3) {

                value =
                    value
                        .split('')
                        .map(x => x + x)
                        .join('');
            }

            if (
                value.length === 6 ||
                value.length === 8
            ) {

                return {
                    r: parseInt(
                        value.substring(0, 2),
                        16
                    ),

                    g: parseInt(
                        value.substring(2, 4),
                        16
                    ),

                    b: parseInt(
                        value.substring(4, 6),
                        16
                    ),

                    a:
                        value.length === 8
                            ? parseInt(
                                value.substring(6, 8),
                                16
                            ) / 255
                            : 1
                };
            }
        }

        return null;
    }


    // =========================================================
    // СМЕШИВАНИЕ ЦВЕТА С БЕЛЫМ
    // =========================================================

    function blendWithWhite(color) {

        if (!color) {
            return null;
        }

        if (color.a >= 0.99) {
            return color;
        }

        return {
            r:
                color.r * color.a +
                255 * (1 - color.a),

            g:
                color.g * color.a +
                255 * (1 - color.a),

            b:
                color.b * color.a +
                255 * (1 - color.a),

            a: 1
        };
    }


    // =========================================================
    // АНАЛИЗ ФОНА
    // =========================================================

    function getBackgroundBrightness() {

        const html =
            document.documentElement;

        const body =
            document.body;

        if (!html) {
            return null;
        }

        const htmlStyle =
            getComputedStyle(html);

        const bodyStyle =
            body
                ? getComputedStyle(body)
                : null;

        // -----------------------------------------------------
        // Сначала body
        // -----------------------------------------------------

        let bg =
            bodyStyle
                ? parseColor(
                    bodyStyle.backgroundColor
                )
                : null;

        // -----------------------------------------------------
        // Если body прозрачный — html
        // -----------------------------------------------------

        if (
            !bg ||
            bg.a < 0.05
        ) {

            bg =
                parseColor(
                    htmlStyle.backgroundColor
                );
        }

        // -----------------------------------------------------
        // Если цвет найден
        // -----------------------------------------------------

        if (bg) {

            bg =
                blendWithWhite(bg);

            /*
             * Формула относительной яркости.
             *
             * Не идеальная цветометрия,
             * но для определения светлая/тёмная
             * подходит очень хорошо.
             */

            const brightness =
                (
                    bg.r * 299 +
                    bg.g * 587 +
                    bg.b * 114
                ) / 1000;

            return brightness;
        }

        return null;
    }


    // =========================================================
    // ОПРЕДЕЛЕНИЕ ТЕМЫ САЙТА
    // =========================================================

    function detectSiteTheme() {

        const html =
            document.documentElement;

        const body =
            document.body;

        if (!html) {
            return 'light';
        }


        // =====================================================
        // 1. CSS color-scheme
        // =====================================================

        const htmlStyle =
            getComputedStyle(html);

        const bodyStyle =
            body
                ? getComputedStyle(body)
                : null;

        const colorScheme =
            (
                htmlStyle.colorScheme ||
                bodyStyle?.colorScheme ||
                ''
            ).toLowerCase();

        /*
         * Если сайт явно говорит dark,
         * доверяем ему.
         */

        if (
            colorScheme.includes('dark') &&
            !colorScheme.includes('light')
        ) {
            return 'dark';
        }

        /*
         * Если сайт явно говорит light,
         * доверяем ему.
         */

        if (
            colorScheme.includes('light') &&
            !colorScheme.includes('dark')
        ) {
            return 'light';
        }


        // =====================================================
        // 2. data-theme
        // =====================================================

        const themeValues = [

            html.getAttribute(
                'data-theme'
            ),

            html.getAttribute(
                'data-color-scheme'
            ),

            body?.getAttribute(
                'data-theme'
            ),

            body?.getAttribute(
                'data-color-scheme'
            )

        ]
            .filter(Boolean)
            .map(
                value =>
                    value.toLowerCase()
            );


        for (
            const theme
            of themeValues
        ) {

            if (
                theme.includes('dark')
            ) {
                return 'dark';
            }

            if (
                theme.includes('light')
            ) {
                return 'light';
            }
        }


        // =====================================================
        // 3. CSS-классы dark/light
        // =====================================================

        const classes = [

            ...html.classList,

            ...(body
                ? [...body.classList]
                : [])

        ]
            .map(
                value =>
                    value.toLowerCase()
            );


        if (
            classes.some(
                value =>
                    value === 'dark' ||
                    value.includes('dark-mode') ||
                    value.includes('theme-dark')
            )
        ) {
            return 'dark';
        }


        if (
            classes.some(
                value =>
                    value === 'light' ||
                    value.includes('light-mode') ||
                    value.includes('theme-light')
            )
        ) {
            return 'light';
        }


        // =====================================================
        // 4. Анализ реального цвета фона
        // =====================================================

        const brightness =
            getBackgroundBrightness();

        if (
            brightness !== null
        ) {

            /*
             * < 110 = явно тёмный
             *
             * > 170 = явно светлый
             *
             * Между ними считаем неопределённым
             * и идём дальше.
             */

            if (
                brightness < 110
            ) {
                return 'dark';
            }

            if (
                brightness > 170
            ) {
                return 'light';
            }
        }


        // =====================================================
        // 5. Системная тема
        // =====================================================

        if (
            window.matchMedia &&
            window.matchMedia(
                '(prefers-color-scheme: dark)'
            ).matches
        ) {
            return 'dark';
        }


        // =====================================================
        // 6. По умолчанию
        // =====================================================

        return 'light';
    }


    // =========================================================
    // ПОЛУЧЕНИЕ MAGNET
    // =========================================================

    function getMagnetFromTarget(target) {

        let element =
            target;

        if (
            element &&
            element.nodeType !== 1
        ) {
            element =
                element.parentElement;
        }

        if (!element) {
            return null;
        }

        const link =
            element.closest
                ? element.closest('a')
                : null;

        if (!link) {
            return null;
        }

        const href =
            link.getAttribute(
                'href'
            );

        if (!href) {
            return null;
        }

        const magnet =
            href.trim();

        if (
            magnet
                .toLowerCase()
                .startsWith('magnet:')
        ) {
            return magnet;
        }

        return null;
    }


    // =========================================================
    // WEBTOR URL
    // =========================================================

    function makeWebtorUrl(magnet) {

        return (
            'https://webtor.io/ru/' +
            '#wt-magnet=' +
            encodeURIComponent(
                magnet
            )
        );
    }


    // =========================================================
    // ОТКРЫТЬ WEBTOR В НОВОЙ ВКЛАДКЕ
    // =========================================================

    function openWebtor(magnet) {

        try {

            GM_setValue(
                STORAGE_KEY,
                magnet
            );

        } catch (e) {

            console.warn(
                '[Webtor] Storage error',
                e
            );
        }

        const url =
            makeWebtorUrl(
                magnet
            );

        /*
         * Открываем непосредственно
         * по нажатию пользователя.
         *
         * Это важно для Safari/iOS.
         */

        const tab =
            window.open(
                url,
                '_blank'
            );

        /*
         * Если Safari заблокировал
         * открытие новой вкладки —
         * переходим в текущей.
         */

        if (!tab) {
            location.href =
                url;
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

    function showMenu(
        magnet,
        x,
        y
    ) {

        closeMenu();

        const menu =
            document.createElement(
                'div'
            );

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


        // =====================================================
        // ПРИМЕНЯЕМ ТЕМУ САЙТА
        // =====================================================

        const theme =
            detectSiteTheme();

        if (
            theme === 'dark'
        ) {
            menu.classList.add(
                'wt-dark'
            );
        }


        document.body.appendChild(
            menu
        );


        // =====================================================
        // ПОЗИЦИОНИРОВАНИЕ
        // =====================================================

        const width =
            menu.offsetWidth;

        const height =
            menu.offsetHeight;

        let left =
            x;

        let top =
            y;


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
            Math.max(
                10,
                left
            );

        top =
            Math.max(
                10,
                top
            );


        menu.style.left =
            left + 'px';

        menu.style.top =
            top + 'px';


        // =====================================================
        // ОТКРЫТЬ WEBTOR
        // =====================================================

        document
            .getElementById(
                'wt-open-button'
            )
            .addEventListener(
                'click',
                function (e) {

                    e.preventDefault();
                    e.stopPropagation();

                    /*
                     * Сначала открываем новую вкладку,
                     * пока Safari ещё считает это
                     * пользовательским действием.
                     */

                    openWebtor(
                        magnet
                    );

                    closeMenu();
                }
            );


        // =====================================================
        // КОПИРОВАТЬ
        // =====================================================

        document
            .getElementById(
                'wt-copy-button'
            )
            .addEventListener(
                'click',
                function (e) {

                    e.preventDefault();
                    e.stopPropagation();

                    copyMagnet(
                        magnet
                    );

                    closeMenu();
                }
            );
    }


    // =========================================================
    // ПЕРЕХВАТ MAGNET
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
                 * Safari не должен пытаться
                 * открыть magnet самостоятельно.
                 */

                e.preventDefault();
                e.stopPropagation();

                if (
                    e.stopImmediatePropagation
                ) {
                    e.stopImmediatePropagation();
                }


                let x =
                    typeof e.clientX === 'number'
                        ? e.clientX
                        : 20;

                let y =
                    typeof e.clientY === 'number'
                        ? e.clientY
                        : 20;


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
    // ЗАКРЫТЬ МЕНЮ ПРИ КЛИКЕ СНАРУЖИ
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
                !menu.contains(
                    e.target
                )
            ) {
                closeMenu();
            }

        },
        false
    );


    // =========================================================
    // ESC
    // =========================================================

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

        // -----------------------------------------------------
        // Сначала hash.
        // -----------------------------------------------------

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
                        .startsWith(
                            'magnet:'
                        )
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


        // -----------------------------------------------------
        // Потом storage.
        // -----------------------------------------------------

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
                    .startsWith(
                        'magnet:'
                    )
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
                    button.offsetParent !==
                    null
                ) {

                    return button;
                }
            }


            parent =
                parent.parentElement;
        }


        // -----------------------------------------------------
        // Запасной поиск по тексту.
        // -----------------------------------------------------

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
    // WEBTOR — ПЕРЕДАТЬ MAGNET
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


        let attempts =
            0;


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


                    // -------------------------------------------------
                    // Вставляем оригинальный magnet.
                    // -------------------------------------------------

                    setInputValue(
                        input,
                        magnet
                    );


                    // -------------------------------------------------
                    // Даём Webtor обновить состояние.
                    // -------------------------------------------------

                    setTimeout(
                        function () {

                            const button =
                                findSearchButton(
                                    input
                                );


                            if (button) {

                                button.click();

                            } else {

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


                            // -------------------------------------------------
                            // Убираем hash.
                            // -------------------------------------------------

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
