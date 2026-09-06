
// ==UserScript==
// @name         Pornhub — кнопка предпросмотра видео
// @namespace    pornhub-preview-button
// @version      1.4.1
// @description  Добавляет кнопку ▶ для предпросмотра видео прямо в каталоге
// @match        https://rt.pornhub.org/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const CARD_SELECTOR =
        'a.latestThumb.videoPreviewBg[data-video-id]';

    const BUTTON_CLASS =
        'userscript-preview-button';

    const VIDEO_CLASS =
        'userscript-preview-video';

    const ERROR_CLASS =
        'userscript-preview-error';


    // ============================================================
    // СТИЛИ
    // ============================================================

    const style = document.createElement('style');

    style.textContent = `
        .${BUTTON_CLASS} {
            position: absolute !important;

            top: 10px !important;
            left: 10px !important;

            width: 38px !important;
            height: 38px !important;

            padding: 0 !important;
            margin: 0 !important;

            border: 0 !important;
            border-radius: 50% !important;

            background: rgba(0, 0, 0, .35) !important;
            color: rgba(255, 255, 255, .85) !important;

            display: flex !important;
            align-items: center !important;
            justify-content: center !important;

            font-size: 18px !important;
            line-height: 1 !important;
            text-align: center !important;

            cursor: pointer !important;

            z-index: 9999 !important;

            box-shadow:
                0 2px 8px rgba(0, 0, 0, .25) !important;

            transition:
                transform .12s ease !important;
        }


        /* --------------------------------------------------------
           PLAY ▶
           -------------------------------------------------------- */

        .${BUTTON_CLASS}:not(.playing) {
            padding-left: 2px !important;
        }


        /* --------------------------------------------------------
           PAUSE ❚❚
           -------------------------------------------------------- */

        .${BUTTON_CLASS}.playing {
            font-size: 15px !important;

            display: flex !important;
            align-items: center !important;
            justify-content: center !important;

            line-height: 1 !important;

            /*
             * Поднимаем ❚❚ немного вверх.
             */
            padding-bottom: 2px !important;
        }


        /* --------------------------------------------------------
           HOVER
           -------------------------------------------------------- */

        .${BUTTON_CLASS}:hover {
            transform: scale(1.08) !important;

            /*
             * Прозрачность остаётся одинаковой.
             */
            background: rgba(0, 0, 0, .35) !important;
            color: rgba(255, 255, 255, .85) !important;
        }


        /* --------------------------------------------------------
           VIDEO
           -------------------------------------------------------- */

        .${VIDEO_CLASS} {
            position: absolute !important;
            inset: 0 !important;

            width: 100% !important;
            height: 100% !important;

            object-fit: cover !important;

            background: #000 !important;

            z-index: 5000 !important;

            display: block !important;
        }


        /* --------------------------------------------------------
           ERROR
           -------------------------------------------------------- */

        .${ERROR_CLASS} {
            position: absolute !important;

            left: 50% !important;
            top: 50% !important;

            transform: translate(-50%, -50%) !important;

            z-index: 10000 !important;

            padding: 7px 10px !important;

            border-radius: 5px !important;

            background: rgba(0, 0, 0, .8) !important;
            color: #fff !important;

            font: 12px Arial, sans-serif !important;
        }
    `;

    document.head.appendChild(style);


    // ============================================================
    // ТЕКУЩЕЕ ВИДЕО
    // ============================================================

    let activeCard = null;
    let activeVideo = null;


    // ============================================================
    // ОСТАНОВКА ПРЕДПРОСМОТРА
    // ============================================================

    function stopPreview() {

        if (!activeCard)
            return;

        const card = activeCard;
        const video = activeVideo;


        if (video) {
            try {
                video.pause();
            } catch (_) {}

            video.removeAttribute('src');

            try {
                video.load();
            } catch (_) {}

            video.remove();
        }


        const button =
            card.querySelector(`.${BUTTON_CLASS}`);

        if (button) {
            button.textContent = '▶';
            button.classList.remove('playing');
        }


        activeCard = null;
        activeVideo = null;
    }


    // ============================================================
    // ПОЛУЧЕНИЕ MP4
    // ============================================================

    function getPreviewURL(card) {

        const img =
            card.querySelector('img[data-mediabook]');

        if (!img)
            return null;

        return img.dataset.mediabook || null;
    }


    // ============================================================
    // ЗАПУСК ПРЕДПРОСМОТРА
    // ============================================================

    function startPreview(card, button) {

        const url = getPreviewURL(card);


        if (!url) {
            showError(
                card,
                'Предпросмотр недоступен'
            );

            return;
        }


        // Если играет другая карточка —
        // останавливаем её.

        if (
            activeCard &&
            activeCard !== card
        ) {
            stopPreview();
        }


        // Если нажали на уже активную карточку —
        // выключаем предпросмотр.

        if (activeCard === card) {
            stopPreview();
            return;
        }


        // ========================================================
        // СОЗДАЁМ VIDEO
        // ========================================================

        const video =
            document.createElement('video');

        video.className =
            VIDEO_CLASS;

        video.src = url;

        video.muted = true;
        video.defaultMuted = true;

        video.autoplay = true;
        video.loop = true;
        video.playsInline = true;

        video.preload = 'auto';

        video.controls = false;


        // ========================================================
        // ОШИБКА VIDEO
        // ========================================================

        video.addEventListener(
            'error',
            () => {

                video.remove();

                if (activeCard === card) {

                    activeCard = null;
                    activeVideo = null;

                    button.textContent = '▶';
                    button.classList.remove('playing');
                }

                showError(
                    card,
                    'Не удалось загрузить предпросмотр'
                );
            }
        );


        // ========================================================
        // ДОБАВЛЯЕМ VIDEO
        // ========================================================

        card.appendChild(video);

        activeCard = card;
        activeVideo = video;


        // ========================================================
        // PLAY → PAUSE
        // ========================================================

        button.textContent = '❚❚';
        button.classList.add('playing');


        // ========================================================
        // ЗАПУСК
        // ========================================================

        const promise =
            video.play();

        if (promise) {

            promise.catch(() => {
                /*
                 * Автовоспроизведение может быть
                 * заблокировано браузером.
                 */
            });
        }
    }


    // ============================================================
    // ОШИБКА
    // ============================================================

    function showError(card, message) {

        const old =
            card.querySelector(`.${ERROR_CLASS}`);

        if (old)
            old.remove();


        const error =
            document.createElement('div');

        error.className =
            ERROR_CLASS;

        error.textContent =
            message;

        card.appendChild(error);


        setTimeout(() => {

            if (error.isConnected) {
                error.remove();
            }

        }, 2000);
    }


    // ============================================================
    // СОЗДАНИЕ КНОПКИ
    // ============================================================

    function setupCard(card) {

        /*
         * Проверяем не только dataset-флаг,
         * но и наличие самой кнопки.
         *
         * Если Pornhub удалил кнопку,
         * она будет создана заново.
         */

        const existingButton =
            card.querySelector(`.${BUTTON_CLASS}`);


        if (
            card.dataset.previewButtonAdded === '1' &&
            existingButton
        ) {
            return;
        }


        /*
         * Кнопка была удалена сайтом,
         * поэтому сбрасываем флаг.
         */

        card.dataset.previewButtonAdded = '0';


        const previewURL =
            getPreviewURL(card);


        /*
         * MP4 может появиться немного позже.
         * Следующее сканирование попробует снова.
         */

        if (!previewURL)
            return;


        // ========================================================
        // POSITION
        // ========================================================

        const computed =
            window.getComputedStyle(card);

        if (computed.position === 'static') {
            card.style.position = 'relative';
        }


        // ========================================================
        // BUTTON
        // ========================================================

        const button =
            document.createElement('button');

        button.type = 'button';

        button.className =
            BUTTON_CLASS;

        /*
         * Оригинальный значок Play.
         */
        button.textContent =
            '▶';

        button.setAttribute(
            'aria-label',
            'Предпросмотр видео'
        );


        // ========================================================
        // CLICK
        // ========================================================

        button.addEventListener(
            'click',
            event => {

                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                startPreview(
                    card,
                    button
                );

            },
            true
        );


        /*
         * Оставляем только проверенный mousedown.
         *
         * pointerdown/touchstart НЕ используем,
         * чтобы не ломать обычный click.
         */

        button.addEventListener(
            'mousedown',
            event => {

                event.preventDefault();
                event.stopPropagation();

            },
            true
        );


        // ========================================================
        // ДОБАВЛЯЕМ
        // ========================================================

        card.appendChild(button);

        card.dataset.previewButtonAdded = '1';
    }


    // ============================================================
    // СКАНИРОВАНИЕ КАРТОЧЕК
    // ============================================================

    function scan() {

        const cards =
            document.querySelectorAll(
                CARD_SELECTOR
            );


        cards.forEach(card => {

            try {

                setupCard(card);

            } catch (error) {

                /*
                 * Ошибка одной карточки
                 * не должна ломать остальные.
                 */

                console.warn(
                    '[Preview] Ошибка карточки:',
                    error
                );
            }

        });
    }


    // ============================================================
    // MUTATION OBSERVER
    // ============================================================

    let timer = null;

    function scheduleScan() {

        if (timer)
            return;


        timer = setTimeout(() => {

            timer = null;

            scan();

        }, 100);
    }


    const observer =
        new MutationObserver(
            scheduleScan
        );


    observer.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true
        }
    );


    // ============================================================
    // ПЕРИОДИЧЕСКОЕ СКАНИРОВАНИЕ
    // ============================================================

    /*
     * Дополнительная страховка для:
     * - поиска
     * - фильтров
     * - бесконечной прокрутки
     * - AJAX-подгрузки
     * - динамической замены карточек
     */

    setInterval(() => {

        scan();

    }, 1000);


    // ============================================================
    // ПРОВЕРКА АКТИВНОЙ КАРТОЧКИ
    // ============================================================

    setInterval(() => {

        if (
            activeCard &&
            !document.documentElement.contains(
                activeCard
            )
        ) {
            stopPreview();
        }

    }, 1000);


    // ============================================================
    // ПЕРВЫЙ ЗАПУСК
    // ============================================================

    scan();

})();

