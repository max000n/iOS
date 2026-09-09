// ==UserScript==
// @name         Magnet → Webtor.io
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Красивое меню для magnet-ссылок: Webtor или копирование. Автоматическая тема сайта.
// @author       canary_in_a_coleslaw-ChatGPT
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // НАСТРОЙКИ
    // =========================================================

    const STORAGE_KEY = 'wt_pending_magnet';

    const WEBTOR_URL = 'https://webtor.io/ru/';

    const MENU_ID = 'wt-magnet-menu';

    const TOAST_ID = 'wt-magnet-toast';


    // =========================================================
    // ОПРЕДЕЛЯЕМ WEBTOR
    // =========================================================

    const hostname =
        window.location.hostname.toLowerCase();

    const isWebtor =
        hostname === 'webtor.io' ||
        hostname.endsWith('.webtor.io');


    // =========================================================
    // CSS
    // =========================================================

    GM_addStyle(`
        /* =====================================================
           MENU
           ===================================================== */

        #${MENU_ID} {
            --wt-bg: rgba(255,255,255,.97);
            --wt-border: rgba(0,0,0,.10);
            --wt-text: #1c1c1e;
            --wt-secondary: rgba(0,0,0,.48);
            --wt-hover: rgba(0,0,0,.055);
            --wt-active: rgba(0,0,0,.10);
            --wt-icon-bg: rgba(0,0,0,.055);

            position: fixed;

            z-index: 2147483647;

            width: 320px;
            max-width: calc(100vw - 20px);

            box-sizing: border-box;

            padding: 8px;

            background: var(--wt-bg);

            border:
                1px solid var(--wt-border);

            border-radius: 17px;

            color: var(--wt-text);

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "SF Pro Display",
                "SF Pro Text",
                "Segoe UI",
                sans-serif;

            box-shadow:
                0 20px 55px rgba(0,0,0,.20),
                0 5px 18px rgba(0,0,0,.10);

            backdrop-filter:
                blur(22px)
                saturate(180%);

            -webkit-backdrop-filter:
                blur(22px)
                saturate(180%);

            animation:
                wt-menu-in .14s
                cubic-bezier(.2,.8,.2,1);

            user-select: none;
            -webkit-user-select: none;
        }


        /* =====================================================
           DARK
           ===================================================== */

        #${MENU_ID}.wt-dark {
            --wt-bg: rgba(30,30,32,.97);
            --wt-border: rgba(255,255,255,.13);
            --wt-text: #fff;
            --wt-secondary: rgba(255,255,255,.48);
            --wt-hover: rgba(255,255,255,.075);
            --wt-active: rgba(255,255,255,.13);
            --wt-icon-bg: rgba(255,255,255,.09);

            box-shadow:
                0 20px 55px rgba(0,0,0,.50),
                0 5px 20px rgba(0,0,0,.35);
        }


        /* =====================================================
           TITLE
           ===================================================== */

        #${MENU_ID} .wt-title {
            padding:
                9px 12px 8px;

            font-size: 12px;
            line-height: 16px;

            font-weight: 600;

            color: var(--wt-secondary);
        }


        /* =====================================================
           BUTTON
           ===================================================== */

        #${MENU_ID} .wt-button {
            display: flex;

            width: 100%;

            box-sizing: border-box;

            align-items: center;

            padding:
                10px;

            margin:
                2px 0;

            border: 0;

            border-radius: 12px;

            outline: none;

            background: transparent;

            color: var(--wt-text);

            font-family: inherit;

            text-align: left;

            cursor: pointer;

            -webkit-tap-highlight-color:
                transparent;

            transition:
                background .12s ease,
                transform .12s ease;
        }


        #${MENU_ID} .wt-button:hover {
            background:
                var(--wt-hover);
        }


        #${MENU_ID} .wt-button:active {
            background:
                var(--wt-active);

            transform:
                scale(.985);
        }


        /* =====================================================
           ICON
           ===================================================== */

        #${MENU_ID} .wt-icon {
            display: flex;

            align-items: center;
            justify-content: center;

            flex: 0 0 40px;

            width: 40px;
            height: 40px;

            margin-right: 12px;

            border-radius: 12px;

            background:
                var(--wt-icon-bg);

            font-size: 19px;
        }


        /* =====================================================
           TEXT
           ===================================================== */

        #${MENU_ID} .wt-text {
            display: flex;

            min-width: 0;

            flex-direction: column;

            gap: 2px;
        }


        #${MENU_ID} .wt-main {
            font-size: 14px;
            line-height: 18px;

            font-weight: 600;

            color:
                var(--wt-text);
        }


        #${MENU_ID} .wt-sub {
            font-size: 11px;
            line-height: 15px;

            color:
                var(--wt-secondary);
        }


        /* =====================================================
           MENU ANIMATION
           ===================================================== */

        @keyframes wt-menu-in {
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

        #${TOAST_ID} {
            position: fixed;

            z-index: 2147483647;

            left: 50%;
            bottom: 28px;

            transform:
                translateX(-50%);

            padding:
                11px 17px;

            border:
                1px solid
                rgba(255,255,255,.13);

            border-radius: 13px;

            background:
                rgba(30,30,32,.97);

            color: #fff;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "SF Pro Text",
                sans-serif;

            font-size: 13px;
            font-weight: 500;

            white-space: nowrap;

            box-shadow:
                0 10px 35px
                rgba(0,0,0,.35);

            pointer-events: none;

            animation:
                wt-toast-in .16s ease-out;
        }


        @keyframes wt-toast-in {
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
    // ОБЩИЕ ФУНКЦИИ
    // =========================================================

    function closeMenu() {

        const menu =
            document.getElementById(
                MENU_ID
            );

        if (menu) {
            menu.remove();
        }
    }


    function showToast(text) {

        const oldToast =
            document.getElementById(
                TOAST_ID
            );

        if (oldToast) {
            oldToast.remove();
        }

        const toast =
            document.createElement('div');

        toast.id =
            TOAST_ID;

        toast.textContent =
            text;

        document.body.appendChild(
            toast
        );

        window.setTimeout(
            function () {

                if (toast.isConnected) {
                    toast.remove();
                }

            },
            1800
        );
    }


    // =========================================================
    // ПОЛУЧЕНИЕ ССЫЛКИ ИЗ CLICK EVENT
    //
    // composedPath() лучше обычного target.closest(),
    // особенно для динамических элементов.
    // =========================================================

    function findMagnetFromEvent(event) {

        const path =
            typeof event.composedPath === 'function'
                ? event.composedPath()
                : [event.target];


        for (
            let i = 0;
            i < path.length;
            i++
        ) {

            const element =
                path[i];


            if (
                !element ||
                element.nodeType !== 1
            ) {
                continue;
            }


            if (
                element.tagName !== 'A'
            ) {
                continue;
            }


            const href =
                element.getAttribute(
                    'href'
                );


            if (!href) {
                continue;
            }


            const value =
                href.trim();


            if (
                value
                    .toLowerCase()
                    .startsWith('magnet:')
            ) {
                return value;
            }
        }


        return null;
    }


    // =========================================================
    // ЦВЕТ
    // =========================================================

    function parseRGB(value) {

        if (!value) {
            return null;
        }

        const match =
            value.match(
                /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i
            );


        if (!match) {
            return null;
        }


        return {
            r: Number(match[1]),
            g: Number(match[2]),
            b: Number(match[3]),
            a:
                match[4] !== undefined
                    ? Number(match[4])
                    : 1
        };
    }


    function parseHex(value) {

        if (!value) {
            return null;
        }


        const match =
            value.match(
                /^#([0-9a-f]{3,8})$/i
            );


        if (!match) {
            return null;
        }


        let hex =
            match[1];


        if (hex.length === 3) {

            hex =
                hex
                    .split('')
                    .map(
                        function (x) {
                            return x + x;
                        }
                    )
                    .join('');
        }


        if (
            hex.length !== 6 &&
            hex.length !== 8
        ) {
            return null;
        }


        return {
            r:
                parseInt(
                    hex.substring(0, 2),
                    16
                ),

            g:
                parseInt(
                    hex.substring(2, 4),
                    16
                ),

            b:
                parseInt(
                    hex.substring(4, 6),
                    16
                ),

            a:
                hex.length === 8
                    ? parseInt(
                        hex.substring(6, 8),
                        16
                    ) / 255
                    : 1
        };
    }


    function parseColor(value) {

        if (!value) {
            return null;
        }


        const rgb =
            parseRGB(value);


        if (rgb) {
            return rgb;
        }


        return parseHex(value);
    }


    // =========================================================
    // ЯРКОСТЬ ФОНА
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
            window.getComputedStyle(
                html
            );


        const bodyStyle =
            body
                ? window.getComputedStyle(body)
                : null;


        let color = null;


        if (bodyStyle) {

            color =
                parseColor(
                    bodyStyle.backgroundColor
                );
        }


        /*
         * Если body прозрачный,
         * смотрим html.
         */

        if (
            !color ||
            color.a < 0.05
        ) {

            color =
                parseColor(
                    htmlStyle.backgroundColor
                );
        }


        if (!color) {
            return null;
        }


        /*
         * Учитываем прозрачность:
         * прозрачный цвет смешиваем
         * с белым фоном.
         */

        if (color.a < 1) {

            color = {

                r:
                    color.r * color.a +
                    255 * (1 - color.a),

                g:
                    color.g * color.a +
                    255 * (1 - color.a),

                b:
                    color.b * color.a +
                    255 * (1 - color.a)
            };
        }


        return (
            color.r * 299 +
            color.g * 587 +
            color.b * 114
        ) / 1000;
    }


    // =========================================================
    // ОПРЕДЕЛЕНИЕ ТЕМЫ
    // =========================================================

    function detectTheme() {

        const html =
            document.documentElement;

        const body =
            document.body;


        if (!html) {
            return 'light';
        }


        const htmlStyle =
            window.getComputedStyle(
                html
            );


        const bodyStyle =
            body
                ? window.getComputedStyle(body)
                : null;


        // =====================================================
        // 1. ЯВНЫЙ color-scheme
        // =====================================================

        const colorScheme =
            (
                htmlStyle.colorScheme ||
                (
                    bodyStyle
                        ? bodyStyle.colorScheme
                        : ''
                ) ||
                ''
            )
                .trim()
                .toLowerCase();


        /*
         * Важно:
         *
         * "dark light" означает, что сайт поддерживает
         * обе темы, а не что сейчас используется dark.
         *
         * Поэтому принимаем только однозначные значения.
         */

        if (
            colorScheme === 'dark' ||
            colorScheme === 'only dark'
        ) {
            return 'dark';
        }


        if (
            colorScheme === 'light' ||
            colorScheme === 'only light'
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

            body
                ? body.getAttribute(
                    'data-theme'
                )
                : null,

            body
                ? body.getAttribute(
                    'data-color-scheme'
                )
                : null

        ];


        for (
            let i = 0;
            i < themeValues.length;
            i++
        ) {

            const value =
                themeValues[i];


            if (!value) {
                continue;
            }


            const theme =
                value
                    .trim()
                    .toLowerCase();


            if (
                theme === 'dark' ||
                theme.includes('dark')
            ) {
                return 'dark';
            }


            if (
                theme === 'light' ||
                theme.includes('light')
            ) {
                return 'light';
            }
        }


        // =====================================================
        // 3. КЛАССЫ
        // =====================================================

        const classNames = [];


        for (
            let i = 0;
            i < html.classList.length;
            i++
        ) {

            classNames.push(
                html.classList[i]
                    .toLowerCase()
            );
        }


        if (body) {

            for (
                let i = 0;
                i < body.classList.length;
                i++
            ) {

                classNames.push(
                    body.classList[i]
                        .toLowerCase()
                );
            }
        }


        if (
            classNames.some(
                function (name) {

                    return (
                        name === 'dark' ||
                        name === 'dark-mode' ||
                        name === 'theme-dark'
                    );
                }
            )
        ) {
            return 'dark';
        }


        if (
            classNames.some(
                function (name) {

                    return (
                        name === 'light' ||
                        name === 'light-mode' ||
                        name === 'theme-light'
                    );
                }
            )
        ) {
            return 'light';
        }


        // =====================================================
        // 4. РЕАЛЬНЫЙ ФОН
        // =====================================================

        const brightness =
            getBackgroundBrightness();


        if (
            brightness !== null
        ) {

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
        // 5. СИСТЕМНАЯ ТЕМА
        // =====================================================

        if (
            window.matchMedia &&
            window.matchMedia(
                '(prefers-color-scheme: dark)'
            ).matches
        ) {
            return 'dark';
        }


        return 'light';
    }


    // =========================================================
    // ПОЗИЦИЯ МЕНЮ
    // =========================================================

    function positionMenu(
        menu,
        x,
        y
    ) {

        /*
         * Сначала делаем его видимым,
         * чтобы получить размеры.
         */

        const rect =
            menu.getBoundingClientRect();


        const margin = 10;


        let left =
            Number(x) || margin;


        let top =
            Number(y) || margin;


        /*
         * Справа не хватает места.
         */

        if (
            left + rect.width >
            window.innerWidth - margin
        ) {

            left =
                window.innerWidth -
                rect.width -
                margin;
        }


        /*
         * Снизу не хватает места.
         */

        if (
            top + rect.height >
            window.innerHeight - margin
        ) {

            top =
                window.innerHeight -
                rect.height -
                margin;
        }


        left =
            Math.max(
                margin,
                left
            );


        top =
            Math.max(
                margin,
                top
            );


        menu.style.left =
            left + 'px';


        menu.style.top =
            top + 'px';
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


        if (!document.body) {
            return;
        }


        const menu =
            document.createElement(
                'div'
            );


        menu.id =
            MENU_ID;


        menu.innerHTML = `

            <div class="wt-title">
                🔗 Что сделать с magnet-ссылкой?
            </div>

            <button
                type="button"
                class="wt-button"
                data-action="webtor"
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
                type="button"
                class="wt-button"
                data-action="copy"
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
        // ТЕМА
        // =====================================================

        if (
            detectTheme() === 'dark'
        ) {

            menu.classList.add(
                'wt-dark'
            );
        }


        document.body.appendChild(
            menu
        );


        positionMenu(
            menu,
            x,
            y
        );


        // =====================================================
        // ЕДИНСТВЕННЫЙ ОБРАБОТЧИК МЕНЮ
        // =====================================================

        menu.addEventListener(
            'click',
            function (event) {

                const button =
                    event.target.closest(
                        'button[data-action]'
                    );


                if (!button) {
                    return;
                }


                event.preventDefault();
                event.stopPropagation();


                const action =
                    button.getAttribute(
                        'data-action'
                    );


                closeMenu();


                if (
                    action === 'webtor'
                ) {

                    openWebtor(
                        magnet
                    );

                    return;
                }


                if (
                    action === 'copy'
                ) {

                    copyMagnet(
                        magnet
                    );
                }
            }
        );
    }


    // =========================================================
    // ОТКРЫТИЕ WEBTOR
    // =========================================================

    function openWebtor(magnet) {

        /*
         * Сохраняем ПОЛНУЮ оригинальную magnet-ссылку.
         *
         * Никакого hash,
         * никакого infohash,
         * никакого обрезания параметров.
         */

        try {

            GM_setValue(
                STORAGE_KEY,
                magnet
            );

        } catch (error) {

            console.error(
                '[Magnet → Webtor] Не удалось сохранить magnet:',
                error
            );
        }


        /*
         * ВАЖНО:
         *
         * Открываем обычную страницу Webtor.
         *
         * Раньше здесь использовался специальный URL
         * вида /hash или #wt-magnet=...
         *
         * Именно это могло приводить к
         * "Ресурс не найден".
         */

        const newWindow =
            window.open(
                WEBTOR_URL,
                '_blank'
            );


        /*
         * Safari может заблокировать новую вкладку.
         *
         * В таком случае открываем Webtor
         * в текущей вкладке.
         */

        if (
            !newWindow ||
            newWindow.closed
        ) {

            window.location.href =
                WEBTOR_URL;
        }
    }


    // =========================================================
    // КОПИРОВАНИЕ MAGNET
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

        } catch (error) {

            console.warn(
                '[Magnet → Webtor] GM clipboard error:',
                error
            );
        }


        /*
         * Резервный вариант.
         */

        if (
            navigator.clipboard &&
            typeof navigator.clipboard.writeText ===
                'function'
        ) {

            navigator.clipboard
                .writeText(magnet)
                .then(
                    function () {

                        showToast(
                            '📋 Magnet-ссылка скопирована'
                        );
                    }
                )
                .catch(
                    function () {

                        showToast(
                            '❌ Не удалось скопировать ссылку'
                        );
                    }
                );

            return;
        }


        showToast(
            '❌ Буфер обмена недоступен'
        );
    }


    // =========================================================
    // ПЕРЕХВАТ MAGNET
    // =========================================================

    function installMagnetHandler() {

        document.addEventListener(
            'click',
            function (event) {

                /*
                 * Уже открыто наше меню —
                 * ничего не перехватываем.
                 */

                if (
                    event.target &&
                    event.target.closest &&
                    event.target.closest(
                        '#' + MENU_ID
                    )
                ) {
                    return;
                }


                const magnet =
                    findMagnetFromEvent(
                        event
                    );


                if (!magnet) {
                    return;
                }


                /*
                 * Полностью блокируем штатную обработку
                 * magnet-ссылки браузером/сайтом.
                 */

                event.preventDefault();
                event.stopPropagation();


                if (
                    typeof event.stopImmediatePropagation ===
                    'function'
                ) {

                    event.stopImmediatePropagation();
                }


                /*
                 * Координаты клика.
                 */

                let x =
                    Number(event.clientX);


                let y =
                    Number(event.clientY);


                /*
                 * Если событие пришло без координат,
                 * показываем меню сверху по центру.
                 */

                if (
                    !Number.isFinite(x) ||
                    x <= 0
                ) {

                    x =
                        Math.round(
                            window.innerWidth / 2
                        ) - 160;
                }


                if (
                    !Number.isFinite(y) ||
                    y <= 0
                ) {

                    y = 80;
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

    function installMenuCloseHandler() {

        document.addEventListener(
            'click',
            function (event) {

                const menu =
                    document.getElementById(
                        MENU_ID
                    );


                if (!menu) {
                    return;
                }


                if (
                    !menu.contains(
                        event.target
                    )
                ) {

                    closeMenu();
                }

            },
            false
        );


        document.addEventListener(
            'keydown',
            function (event) {

                if (
                    event.key === 'Escape'
                ) {

                    closeMenu();
                }
            }
        );
    }


    // =========================================================
    // WEBTOR: ПОИСК MAGNET
    // =========================================================

    function getPendingMagnet() {

        try {

            const magnet =
                GM_getValue(
                    STORAGE_KEY,
                    ''
                );


            if (
                typeof magnet === 'string' &&
                magnet
                    .trim()
                    .toLowerCase()
                    .startsWith('magnet:')
            ) {

                return magnet.trim();
            }

        } catch (error) {

            console.error(
                '[Magnet → Webtor] GM_getValue error:',
                error
            );
        }


        return '';
    }


    // =========================================================
    // WEBTOR: НАЙТИ INPUT
    // =========================================================

    function findWebtorInput() {

        const inputs =
            document.querySelectorAll(
                'input'
            );


        for (
            let i = 0;
            i < inputs.length;
            i++
        ) {

            const input =
                inputs[i];


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


            const name =
                (
                    input.getAttribute(
                        'name'
                    ) || ''
                )
                    .toLowerCase();


            if (
                placeholder.includes('magnet') ||
                placeholder.includes('infohash') ||
                placeholder.includes('магнет') ||
                aria.includes('magnet') ||
                aria.includes('infohash') ||
                name.includes('magnet') ||
                name.includes('infohash')
            ) {

                return input;
            }
        }


        return null;
    }


    // =========================================================
    // WEBTOR: НАЙТИ КНОПКУ
    // =========================================================

    function findWebtorButton(input) {

        if (!input) {
            return null;
        }


        /*
         * Сначала ищем кнопку рядом с input.
         */

        let parent =
            input.parentElement;


        for (
            let level = 0;
            level < 6 && parent;
            level++
        ) {

            const buttons =
                parent.querySelectorAll(
                    'button'
                );


            for (
                let i = 0;
                i < buttons.length;
                i++
            ) {

                const button =
                    buttons[i];


                if (
                    button.offsetParent !== null
                ) {

                    return button;
                }
            }


            parent =
                parent.parentElement;
        }


        /*
         * Если рядом ничего нет,
         * ищем кнопку по тексту.
         */

        const allButtons =
            document.querySelectorAll(
                'button'
            );


        for (
            let i = 0;
            i < allButtons.length;
            i++
        ) {

            const button =
                allButtons[i];


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
                text === 'suchen' ||
                text.includes('найти') ||
                text.includes('search')
            ) {

                return button;
            }
        }


        return null;
    }


    // =========================================================
    // WEBTOR: ПРАВИЛЬНО УСТАНОВИТЬ VALUE
    // =========================================================

    function setNativeInputValue(
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
            typeof descriptor.set ===
                'function'
        ) {

            descriptor.set.call(
                input,
                value
            );

        } else {

            input.value =
                value;
        }


        /*
         * React / Vue / другие фреймворки
         * должны увидеть изменение.
         */

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
    // WEBTOR: ОТПРАВКА MAGNET
    // =========================================================

    function submitWebtorMagnet(
        input,
        magnet
    ) {

        setNativeInputValue(
            input,
            magnet
        );


        /*
         * Небольшая задержка нужна,
         * чтобы React/Vue/Webtor успел
         * обновить внутреннее состояние.
         */

        window.setTimeout(
            function () {

                const button =
                    findWebtorButton(
                        input
                    );


                if (button) {

                    button.click();

                    return;
                }


                /*
                 * Если кнопку найти не удалось —
                 * используем Enter.
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


                input.dispatchEvent(
                    new KeyboardEvent(
                        'keyup',
                        {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true
                        }
                    )
                );

            },
            350
        );
    }


    // =========================================================
    // WEBTOR: ЗАПУСК
    // =========================================================

    function processWebtor() {

        if (!isWebtor) {
            return;
        }


        const magnet =
            getPendingMagnet();


        if (!magnet) {
            return;
        }


        let attempts = 0;


        const maxAttempts = 120;


        const timer =
            window.setInterval(
                function () {

                    attempts++;


                    const input =
                        findWebtorInput();


                    if (input) {

                        window.clearInterval(
                            timer
                        );


                        submitWebtorMagnet(
                            input,
                            magnet
                        );


                        /*
                         * Удаляем сохранённую ссылку
                         * только после того, как она
                         * реально передана Webtor.
                         */

                        window.setTimeout(
                            function () {

                                try {

                                    GM_setValue(
                                        STORAGE_KEY,
                                        ''
                                    );

                                } catch (error) {}

                            },
                            2000
                        );


                        return;
                    }


                    if (
                        attempts >= maxAttempts
                    ) {

                        window.clearInterval(
                            timer
                        );
                    }

                },
                150
            );
    }


    // =========================================================
    // ИНИЦИАЛИЗАЦИЯ
    // =========================================================

    if (!isWebtor) {

        /*
         * На обычных сайтах только один
         * обработчик magnet-ссылок.
         */

        installMagnetHandler();

        installMenuCloseHandler();

    } else {

        /*
         * На Webtor никакого обработчика magnet
         * не устанавливаем — только принимаем
         * сохранённую ссылку.
         */

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
