// ==UserScript==
// @name         Dzen — Remove AdTune ads + empty space
// @namespace    dzen-adtune-blocker
// @version      4.1.0
// @description  Удаляет рекламу Dzen вместе с оставшимся пустым местом
// @match        https://dzen.ru/*
// @match        https://www.dzen.ru/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const HIDDEN = 'dzen-adtune-hidden';

    // ---------------------------------------------------------
    // CSS
    // ---------------------------------------------------------

    const style = document.createElement('style');

    style.id = 'dzen-adtune-style';

    style.textContent = `
        .${HIDDEN} {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;

            width: 0 !important;
            height: 0 !important;

            min-width: 0 !important;
            min-height: 0 !important;

            max-width: 0 !important;
            max-height: 0 !important;

            margin: 0 !important;
            padding: 0 !important;

            border: 0 !important;
            gap: 0 !important;

            overflow: hidden !important;
            flex: 0 0 0 !important;
        }
    `;


    function installStyle() {
        if (!document.getElementById(style.id)) {
            (document.head || document.documentElement)
                .appendChild(style);
        }
    }


    // ---------------------------------------------------------
    // Получаем размеры
    // ---------------------------------------------------------

    function getRect(el) {
        return el.getBoundingClientRect();
    }


    // ---------------------------------------------------------
    // Ищем рекламный контейнер
    // ---------------------------------------------------------

    function findAdContainer(marker) {

        let current = marker;
        let best = null;

        /*
         * Поднимаемся по DOM.
         *
         * Ищем самый подходящий контейнер рекламы:
         * - достаточно широкий
         * - не слишком высокий
         * - находится в верхней части страницы
         */

        for (let level = 0; level < 15; level++) {

            const parent = current.parentElement;

            if (!parent)
                break;

            current = parent;

            const r = getRect(current);

            // Слишком маленький — это ещё внутренний элемент
            if (r.width < 300 || r.height < 30)
                continue;

            // Слишком большой — это уже общий layout
            if (
                r.width > window.innerWidth * 1.15 ||
                r.height > 600
            ) {
                continue;
            }

            // Интересует верхняя часть страницы
            if (r.top > 900)
                continue;

            /*
             * Хороший кандидат.
             */
            if (
                r.width >= 500 &&
                r.height >= 50 &&
                r.height <= 500
            ) {
                best = current;
            }
        }

        return best;
    }


    // ---------------------------------------------------------
    // Удаляем пустое место
    // ---------------------------------------------------------

    function collapseParents(element) {

        /*
         * После скрытия рекламы Dzen иногда оставляет
         * родительский wrapper с фиксированной высотой.
         *
         * Проверяем несколько уровней родителей.
         */

        let current = element;

        for (let i = 0; i < 6; i++) {

            if (!current.parentElement)
                break;

            const parent = current.parentElement;

            /*
             * Если внутри больше нет видимого содержимого,
             * родитель тоже можно схлопнуть.
             */

            const children = Array.from(parent.children);

            const visibleChildren = children.filter(child => {

                if (child.classList.contains(HIDDEN))
                    return false;

                const r = getRect(child);

                return (
                    r.width > 0 &&
                    r.height > 0
                );
            });


            if (visibleChildren.length === 0) {

                parent.classList.add(HIDDEN);

            } else {

                /*
                 * Если родитель практически состоит
                 * только из нашего рекламного элемента,
                 * тоже схлопываем его.
                 */

                const nonHidden = children.filter(
                    child => !child.classList.contains(HIDDEN)
                );

                if (
                    nonHidden.length === 1 &&
                    nonHidden[0] === current
                ) {
                    parent.classList.add(HIDDEN);
                } else {
                    break;
                }
            }

            current = parent;
        }
    }


    // ---------------------------------------------------------
    // Скрываем рекламу
    // ---------------------------------------------------------

    function hideAd(marker) {

        const container = findAdContainer(marker);

        if (!container)
            return;

        /*
         * Скрываем найденный рекламный контейнер.
         */
        container.classList.add(HIDDEN);

        /*
         * И дополнительно схлопываем его родителей,
         * если они остались пустыми.
         */
        collapseParents(container);
    }


    // ---------------------------------------------------------
    // Главный поиск
    // ---------------------------------------------------------

    function scan() {

        installStyle();

        const markers = document.querySelectorAll(
            '[data-new-adtune="true"]'
        );

        markers.forEach(hideAd);
    }


    // ---------------------------------------------------------
    // Наблюдение за Dzen
    // ---------------------------------------------------------

    let timer = null;

    function scheduleScan() {

        if (timer)
            return;

        timer = setTimeout(() => {

            timer = null;

            scan();

        }, 50);
    }


    function startObserver() {

        if (!document.body) {
            setTimeout(startObserver, 50);
            return;
        }

        const observer = new MutationObserver(() => {
            scheduleScan();
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        scan();

        /*
         * Dzen может дорисовать layout с задержкой.
         */
        setTimeout(scan, 100);
        setTimeout(scan, 300);
        setTimeout(scan, 700);
        setTimeout(scan, 1500);
        setTimeout(scan, 3000);
    }


    // ---------------------------------------------------------
    // Запуск
    // ---------------------------------------------------------

    installStyle();

    if (document.readyState === 'loading') {

        document.addEventListener(
            'DOMContentLoaded',
            startObserver,
            { once: true }
        );

    } else {

        startObserver();

    }

})();