// ==UserScript==
// @name         Magnet → Webtor.io
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Красивое меню для magnet-ссылок: открыть в Webtor.io или скопировать. Автоматически передаёт magnet в Webtor.
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

    const WEBTOR_URL = 'https://webtor.io/ru/';
    const STORAGE_KEY = 'webtor_pending_magnet';

    // =========================================================
    // ОБЩИЕ ФУНКЦИИ
    // =========================================================

    function isWebtor() {
        return location.hostname === 'webtor.io' ||
               location.hostname.endsWith('.webtor.io');
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // =========================================================
    // ПОЛУЧЕНИЕ MAGNET ИЗ ЭЛЕМЕНТА
    // =========================================================

    function extractMagnet(value) {
        if (!value) {
            return null;
        }

        let text = String(value).trim();

        // HTML entity
        text = text
            .replace(/&amp;/gi, '&')
            .replace(/&#38;/gi, '&');

        // Если строка сама является magnet
        if (/^magnet:\?/i.test(text)) {
            return text;
        }

        // Если magnet спрятан внутри onclick / data-* и т.п.
        const match = text.match(
            /magnet:\?[^"'<>\\\s]+/i
        );

        return match ? match[0] : null;
    }

    function getMagnetFromElement(element) {
        if (!element) {
            return null;
        }

        // -----------------------------------------------------
        // href
        // -----------------------------------------------------

        if (element.hasAttribute &&
            element.hasAttribute('href')) {

            const magnet = extractMagnet(
                element.getAttribute('href')
            );

            if (magnet) {
                return magnet;
            }
        }

        // -----------------------------------------------------
        // data-* атрибуты
        // -----------------------------------------------------

        if (element.attributes) {
            for (const attr of element.attributes) {
                const name = attr.name.toLowerCase();

                if (
                    name.startsWith('data-') ||
                    name === 'onclick' ||
                    name === 'onmousedown'
                ) {
                    const magnet = extractMagnet(attr.value);

                    if (magnet) {
                        return magnet;
                    }
                }
            }
        }

        // -----------------------------------------------------
        // onclick как свойство
        // -----------------------------------------------------

        try {
            if (element.onclick) {
                const magnet = extractMagnet(
                    element.onclick.toString()
                );

                if (magnet) {
                    return magnet;
                }
            }
        } catch (e) {}

        return null;
    }

    // =========================================================
    // ИЩЕМ MAGNET РЯДОМ С НАЖАТЫМ ЭЛЕМЕНТОМ
    // =========================================================

    function findMagnetFromEventTarget(target) {
        if (!target) {
            return null;
        }

        let element = target;

        // Идём вверх по DOM.
        for (let i = 0; element && i < 12; i++) {

            const magnet = getMagnetFromElement(element);

            if (magnet) {
                return magnet;
            }

            if (element.parentElement) {
                element = element.parentElement;
            } else {
                break;
            }
        }

        // На случай обычной ссылки.
        try {
            const link = target.closest?.('a');

            if (link) {
                const magnet = getMagnetFromElement(link);

                if (magnet) {
                    return magnet;
                }
            }
        } catch (e) {}

        return null;
    }

    // =========================================================
    // CSS МЕНЮ
    // =========================================================

    GM_addStyle(`
        #webtor-magnet-menu {
            position: fixed;
            z-index: 2147483647;

            width: 320px;
            max-width: calc(100vw - 20px);

            box-sizing: border-box;

            padding: 8px;

            background:
                rgba(28, 28, 30, 0.98);

            border:
                1px solid rgba(255,255,255,.12);

            border-radius: 16px;

            box-shadow:
                0 18px 55px rgba(0,0,0,.48),
                0 5px 18px rgba(0,0,0,.28);

            backdrop-filter: blur(18px);
            -webkit-backdrop-filter: blur(18px);

            color: #fff;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "SF Pro Display",
                "SF Pro Text",
                "Segoe UI",
                sans-serif;

            animation:
                webtorMenuIn .16s ease-out;
        }

        @keyframes webtorMenuIn {
            from {
                opacity: 0;
                transform: translateY(-6px) scale(.97);
            }

            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }

        #webtor-magnet-menu .webtor-title {
            padding:
                9px 12px 8px;

            color:
                rgba(255,255,255,.42);

            font-size: 12px;
            font-weight: 600;
        }

        #webtor-magnet-menu button {
            appearance: none;
            -webkit-appearance: none;

            width: 100%;

            display: flex;
            align-items: center;

            gap: 12px;

            box-sizing: border-box;

            padding: 11px 10px;
            margin: 2px 0;

            border: 0;
            outline: 0;

            border-radius: 11px;

            background: transparent;

            color: #fff;

            text-align: left;

            cursor: pointer;

            -webkit-tap-highlight-color:
                transparent;

            transition:
                background .12s ease,
                transform .12s ease;
        }

        #webtor-magnet-menu button:hover {
            background:
                rgba(255,255,255,.09);
        }

        #webtor-magnet-menu button:active {
            background:
                rgba(255,255,255,.14);

            transform:
                scale(.985);
        }

        #webtor-magnet-menu .webtor-icon {
            width: 38px;
            height: 38px;

            flex: 0 0 38px;

            display: flex;
            align-items: center;
            justify-content: center;

            border-radius: 11px;

            background:
                rgba(255,255,255,.09);

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
            line-height: 18px;

            font-weight: 600;
        }

        #webtor-magnet-menu .webtor-sub {
            font-size: 11px;
            line-height: 14px;

            color:
                rgba(255,255,255,.43);
        }

        #webtor-magnet-toast {
            position: fixed;
            z-index: 2147483647;

            left: 50%;
            bottom: 28px;

            transform:
                translateX(-50%);

            padding:
                12px 18px;

            background:
                rgba(28,28,30,.98);

            border:
                1px solid rgba(255,255,255,.12);

            border-radius: 13px;

            box-shadow:
                0 8px 30px rgba(0,0,0,.4);

            color: #fff;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "SF Pro Text",
                "Segoe UI",
                sans-serif;

            font-size: 13px;
            font-weight: 500;

            white-space: nowrap;

            animation:
                webtorToastIn .18s ease-out;
        }

        @keyframes webtorToastIn {
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
    // TOAST
    // =========================================================

    function showToast(message) {
        const old =
            document.getElementById(
                'webtor-magnet-toast'
            );

        if (old) {
            old.remove();
        }

        const toast =
            document.createElement('div');

        toast.id =
            'webtor-magnet-toast';

        toast.textContent =
            message;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 1900);
    }

    // =========================================================
    // ЗАКРЫТЬ МЕНЮ
    // =========================================================

    function closeMenu() {
        const menu =
            document.getElementById(
                'webtor-magnet-menu'
            );

        if (menu) {
            menu.remove();
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
        } catch (e) {}

        if (navigator.clipboard) {
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

            return;
        }

        showToast(
            '❌ Буфер обмена недоступен'
        );
    }

    // =========================================================
    // ПЕРЕДАЧА MAGNET В WEBTOR
    //
    // Используем hash URL.
    //
    // Пример:
    //
    // https://webtor.io/ru/#webtor-magnet=...
    //
    // Это обычный HTTPS URL.
    // Safari его нормально открывает.
    //
    // Сам Webtor hash не отправляется серверу.
    // Его считывает наш userscript уже внутри Webtor.
    // =========================================================

    function createWebtorUrl(magnet) {
        return (
            WEBTOR_URL +
            '#webtor-magnet=' +
            encodeURIComponent(magnet)
        );
    }

    // =========================================================
    // ОТКРЫТЬ WEBTOR В НОВОЙ ВКЛАДКЕ
    // =========================================================

    function openWebtor(magnet) {

        // Дополнительно сохраняем magnet.
        // Это запасной канал передачи.
        try {
            GM_setValue(
                STORAGE_KEY,
                magnet
            );
        } catch (e) {}

        const url =
            createWebtorUrl(magnet);

        /*
         * ВАЖНО:
         *
         * window.open вызывается непосредственно
         * внутри клика пользователя.
         *
         * Поэтому iOS Safari должен разрешить
         * открытие новой вкладки.
         */

        const newTab =
            window.open(
                url,
                '_blank'
            );

        // Popup заблокирован.
        if (!newTab) {
            window.location.href =
                url;
        }
    }

    // =========================================================
    // МЕНЮ
    // =========================================================

    function showMenu(magnet, x, y) {
        closeMenu();

        const menu =
            document.createElement('div');

        menu.id =
            'webtor-magnet-menu';

        menu.innerHTML = `
            <div class="webtor-title">
                🔗 Действие с magnet-ссылкой
            </div>

            <button
                type="button"
                data-action="open"
            >
                <span class="webtor-icon">
                    🌐
                </span>

                <span class="webtor-text">
                    <span class="webtor-main">
                        Открыть на Webtor.io
                    </span>

                    <span class="webtor-sub">
                        Открыть в новой вкладке
                    </span>
                </span>
            </button>

            <button
                type="button"
                data-action="copy"
            >
                <span class="webtor-icon">
                    📋
                </span>

                <span class="webtor-text">
                    <span class="webtor-main">
                        Скопировать magnet-ссылку
                    </span>

                    <span class="webtor-sub">
                        Скопировать оригинальную ссылку
                    </span>
                </span>
            </button>
        `;

        document.body.appendChild(menu);

        // -----------------------------------------------------
        // Позиционирование
        // -----------------------------------------------------

        const menuWidth =
            menu.offsetWidth;

        const menuHeight =
            menu.offsetHeight;

        let left = x;
        let top = y;

        if (
            left + menuWidth >
            window.innerWidth - 10
        ) {
            left =
                window.innerWidth -
                menuWidth -
                10;
        }

        if (
            top + menuHeight >
            window.innerHeight - 10
        ) {
            top =
                window.innerHeight -
                menuHeight -
                10;
        }

        left = Math.max(10, left);
        top = Math.max(10, top);

        menu.style.left =
            `${left}px`;

        menu.style.top =
            `${top}px`;

        // -----------------------------------------------------
        // Открыть
        // -----------------------------------------------------

        menu
            .querySelector(
                '[data-action="open"]'
            )
            .addEventListener(
                'click',
                function (e) {

                    e.preventDefault();
                    e.stopPropagation();

                    closeMenu();

                    openWebtor(magnet);
                }
            );

        // -----------------------------------------------------
        // Копировать
        // -----------------------------------------------------

        menu
            .querySelector(
                '[data-action="copy"]'
            )
            .addEventListener(
                'click',
                function (e) {

                    e.preventDefault();
                    e.stopPropagation();

                    closeMenu();

                    copyMagnet(magnet);
                }
            );
    }

    // =========================================================
    // ПЕРЕХВАТ КЛИКА
    // =========================================================

    let lastMagnet = null;
    let lastMagnetTime = 0;

    function handleMagnetEvent(e) {

        const magnet =
            findMagnetFromEventTarget(
                e.target
            );

        if (!magnet) {
            return;
        }

        /*
         * Защита от ситуации, когда iOS
         * вызывает несколько событий подряд.
         */

        const now =
            Date.now();

        if (
            magnet === lastMagnet &&
            now - lastMagnetTime < 500
        ) {
            return;
        }

        lastMagnet =
            magnet;

        lastMagnetTime =
            now;

        e.preventDefault();
        e.stopPropagation();

        if (
            typeof e.stopImmediatePropagation ===
            'function'
        ) {
            e.stopImmediatePropagation();
        }

        showMenu(
            magnet,
            e.clientX || 20,
            e.clientY || 20
        );
    }

    /*
     * click — основной вариант.
     */
    document.addEventListener(
        'click',
        handleMagnetEvent,
        true
    );

    /*
     * auxclick — мышь / трекпад.
     */
    document.addEventListener(
        'auxclick',
        handleMagnetEvent,
        true
    );

    /*
     * pointerup — помогает на некоторых
     * мобильных сайтах.
     */
    document.addEventListener(
        'pointerup',
        function (e) {

            /*
             * На обычном left-click click тоже
             * сработает, поэтому здесь используем
             * только touch/pen.
             */

            if (
                e.pointerType !== 'touch' &&
                e.pointerType !== 'pen'
            ) {
                return;
            }

            handleMagnetEvent(e);
        },
        true
    );

    // =========================================================
    // ЗАКРЫТИЕ МЕНЮ
    // =========================================================

    document.addEventListener(
        'click',
        function (e) {

            const menu =
                document.getElementById(
                    'webtor-magnet-menu'
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

            if (e.key === 'Escape') {
                closeMenu();
            }
        }
    );

    // =========================================================
    // ДОПОЛНИТЕЛЬНАЯ ЗАЩИТА ДЛЯ ДИНАМИЧЕСКИХ СТРАНИЦ
    // =========================================================

    /*
     * Некоторые сайты добавляют magnet-ссылки
     * уже после загрузки страницы.
     *
     * Мы их заранее "помечаем" и вешаем
     * отдельный обработчик непосредственно
     * на ссылку.
     */

    function scanRoot(root) {

        if (!root ||
            !root.querySelectorAll) {
            return;
        }

        const links =
            root.querySelectorAll(
                'a, [data-href], [data-url]'
            );

        for (const link of links) {

            if (
                link.dataset &&
                link.dataset.webtorHandled
            ) {
                continue;
            }

            const magnet =
                getMagnetFromElement(
                    link
                );

            if (!magnet) {
                continue;
            }

            if (link.dataset) {
                link.dataset.webtorHandled =
                    '1';
            }

            link.addEventListener(
                'click',
                function (e) {

                    e.preventDefault();
                    e.stopPropagation();

                    if (
                        typeof e.stopImmediatePropagation ===
                        'function'
                    ) {
                        e.stopImmediatePropagation();
                    }

                    showMenu(
                        magnet,
                        e.clientX || 20,
                        e.clientY || 20
                    );
                },
                true
            );
        }
    }

    function startObserver() {

        scanRoot(document);

        const observer =
            new MutationObserver(
                function (mutations) {

                    for (
                        const mutation
                        of mutations
                    ) {
                        for (
                            const node
                            of mutation.addedNodes
                        ) {
                            if (
                                node.nodeType ===
                                Node.ELEMENT_NODE
                            ) {
                                scanRoot(node);
                            }
                        }
                    }
                }
            );

        if (document.documentElement) {

            observer.observe(
                document.documentElement,
                {
                    childList: true,
                    subtree: true
                }
            );
        }
    }

    if (
        document.readyState ===
        'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            startObserver,
            {
                once: true
            }
        );
    } else {
        startObserver();
    }

    // =========================================================
    // WEBTOR: ПОЛУЧЕНИЕ MAGNET
    // =========================================================

    async function getPendingMagnet() {

        /*
         * Сначала берём из hash.
         * Это самый надёжный способ для iOS:
         * новая вкладка получает его сразу.
         */

        try {
            const hash =
                location.hash;

            const prefix =
                '#webtor-magnet=';

            if (
                hash.startsWith(prefix)
            ) {
                const value =
                    hash.substring(
                        prefix.length
                    );

                const magnet =
                    decodeURIComponent(
                        value
                    );

                if (
                    /^magnet:/i.test(
                        magnet
                    )
                ) {
                    return magnet;
                }
            }
        } catch (e) {}

        /*
         * Запасной вариант — GM storage.
         */

        try {
            const magnet =
                await GM_getValue(
                    STORAGE_KEY,
                    ''
                );

            if (
                magnet &&
                /^magnet:/i.test(
                    magnet
                )
            ) {
                return magnet;
            }
        } catch (e) {}

        return null;
    }

    // =========================================================
    // WEBTOR: НАЙТИ INPUT
    // =========================================================

    function findWebtorInput() {

        const inputs =
            document.querySelectorAll(
                'input'
            );

        for (const input of inputs) {

            const placeholder =
                (
                    input.placeholder ||
                    ''
                ).toLowerCase();

            const aria =
                (
                    input.getAttribute(
                        'aria-label'
                    ) || ''
                ).toLowerCase();

            const type =
                (
                    input.type || ''
                ).toLowerCase();

            if (
                type === 'text' ||
                type === 'search' ||
                type === ''
            ) {
                if (
                    placeholder.includes('magnet') ||
                    placeholder.includes('магнет') ||
                    placeholder.includes('infohash') ||
                    aria.includes('magnet') ||
                    aria.includes('магнет')
                ) {
                    return input;
                }
            }
        }

        /*
         * Запасной вариант:
         * на главной странице Webtor это,
         * как правило, единственный текстовый input.
         */

        for (const input of inputs) {

            if (
                input.offsetParent !== null &&
                !input.disabled &&
                !input.readOnly
            ) {
                return input;
            }
        }

        return null;
    }

    // =========================================================
    // WEBTOR: НАЙТИ КНОПКУ SEARCH
    // =========================================================

    function findWebtorButton(input) {

        if (!input) {
            return null;
        }

        /*
         * Сначала ищем кнопку рядом с input.
         */

        const parent =
            input.parentElement;

        if (parent) {

            const buttons =
                parent.querySelectorAll(
                    'button'
                );

            if (buttons.length) {

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
            }
        }

        /*
         * Затем ищем кнопку по тексту.
         */

        const buttons =
            document.querySelectorAll(
                'button'
            );

        for (const button of buttons) {

            const text =
                (
                    button.innerText ||
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
    // WEBTOR: УСТАНОВИТЬ VALUE В REACT/VUE INPUT
    // =========================================================

    function setNativeInputValue(
        input,
        value
    ) {

        const prototype =
            Object.getPrototypeOf(
                input
            );

        const descriptor =
            Object.getOwnPropertyDescriptor(
                prototype,
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

        /*
         * React/Vue должны получить
         * настоящее событие input.
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
    // WEBTOR: ВСТАВИТЬ И ЗАПУСТИТЬ
    // =========================================================

    async function injectMagnetIntoWebtor() {

        if (!isWebtor()) {
            return;
        }

        const magnet =
            await getPendingMagnet();

        if (!magnet) {
            return;
        }

        let attempts = 0;

        const timer =
            setInterval(
                function () {

                    attempts++;

                    const input =
                        findWebtorInput();

                    if (!input) {

                        if (
                            attempts > 80
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
                    // Вставляем настоящий magnet.
                    // -----------------------------------------

                    setNativeInputValue(
                        input,
                        magnet
                    );

                    // -----------------------------------------
                    // Небольшая пауза, чтобы React/Vue
                    // обновил состояние кнопки.
                    // -----------------------------------------

                    setTimeout(
                        function () {

                            const button =
                                findWebtorButton(
                                    input
                                );

                            if (button) {

                                button.click();

                            } else {

                                /*
                                 * Если кнопку не нашли,
                                 * пробуем Enter.
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

                            // ---------------------------------
                            // После передачи очищаем hash,
                            // чтобы при обновлении страницы
                            // magnet повторно не запускался.
                            // ---------------------------------

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
                        350
                    );

                },
                150
            );
    }

    // =========================================================
    // ЗАПУСК WEBTOR-ЧАСТИ
    // =========================================================

    if (isWebtor()) {

        if (
            document.readyState ===
            'loading'
        ) {
            document.addEventListener(
                'DOMContentLoaded',
                function () {
                    injectMagnetIntoWebtor();
                },
                {
                    once: true
                }
            );
        } else {
            injectMagnetIntoWebtor();
        }
    }

})();
