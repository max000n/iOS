// ==UserScript==
// @name         iOS Safari — Native Player v9.7
// @namespace    ios-native-player-button
// @version      9.7.0
// @description  Native iOS fullscreen + Skip + Ускорение при удержании + Настройки
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    // ============================================================
    // НАСТРОЙКИ ПО УМОЛЧАНИЮ
    // ============================================================

    const DEFAULTS = {
        FULLSCREEN_ENABLED: true,
        SKIP_ENABLED: true,
        HOLD_ENABLED: true,
        BUTTON_SIZE: 42,
        BUTTON_MARGIN: 8,
        BUTTON_GAP: 10,
        SCAN_INTERVAL: 2000,
        POSITION_UPDATE_INTERVAL: 1000,
        DEBOUNCE_TIME: 400,
        NOTIFICATION_DURATION: 2000,
        ERROR_DURATION: 3000,
        SKIP_OFFSET: 0.1,
        SKIP_FALLBACK: 30,
        HOLD_DELAY: 600,
        HOLD_SPEED: 2.0,
        HOLD_MOVE_TOLERANCE: 15,
        HOLD_CHECK_INTERVAL: 300,
        HOLD_SAFETY_TIMEOUT: 30000,
        BUTTON_CLASS: 'ios-native-player-button'
    };

    // ============================================================
    // Конфигурация (localStorage)
    // ============================================================

    const STORAGE_KEY = 'ios-native-player-config-v1';

    const loadConfig = () => {
        const config = { ...DEFAULTS };
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (saved) {
                for (const key of Object.keys(DEFAULTS)) {
                    if (saved[key] !== undefined) config[key] = saved[key];
                }
            }
        } catch (e) {}
        return config;
    };

    const CONFIG = loadConfig();

    const saveConfig = () => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(CONFIG)); } catch (e) {}
    };

    const resetConfig = () => {
        Object.assign(CONFIG, DEFAULTS);
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    };

    // ============================================================
    // Состояние
    // ============================================================

    const videoButtons = new Map();
    const observedShadows = new WeakSet();
    let settingsPanel = null;
    let layer = null;

    // ============================================================
    // Иконки
    // ============================================================

    const ICONS = {
        fullscreen: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3H5C3.9 3 3 3.9 3 5V8M16 3H19C20.1 3 21 3.9 21 5V8M8 21H5C3.9 21 3 20.1 3 19V16M16 21H19C20.1 21 21 20.1 21 19V16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
        skip: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 5.2V18.8L15.5 12L4.5 5.2Z" fill="currentColor"/><path d="M19 5V19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
        settings: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    };

    // ============================================================
    // CSS
    // ============================================================

    const style = document.createElement('style');

    const buildCSS = () => {
        const C = CONFIG.BUTTON_CLASS;
        return `
        /* Кнопки: absolute в координатах документа —
           всегда внутри видео, скроллятся вместе со страницей */
        .${C} {
            position: absolute !important;
            width: ${CONFIG.BUTTON_SIZE}px !important;
            height: ${CONFIG.BUTTON_SIZE}px !important;
            padding: 0 !important;
            margin: 0 !important;
            box-sizing: border-box !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            border: 1px solid rgba(255,255,255,.32) !important;
            border-radius: 50% !important;
            background: rgba(20,20,22,0.85) !important;
            color: #fff !important;
            opacity: 1 !important;
            z-index: 2147483647 !important;
            backdrop-filter: blur(7px) !important;
            -webkit-backdrop-filter: blur(7px) !important;
            -webkit-appearance: none !important;
            appearance: none !important;
            outline: none !important;
            box-shadow: 0 2px 10px rgba(0,0,0,.35) !important;
            touch-action: manipulation !important;
            -webkit-tap-highlight-color: transparent !important;
            cursor: pointer !important;
            pointer-events: auto !important;
        }
        .${C}:active { transform: scale(.9) !important; opacity: .9 !important; }
        .${C} svg { width: 19px !important; height: 19px !important; display: block !important; pointer-events: none !important; }

        /* Слой-контейнер для кнопок */
        .${C}-layer {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 0 !important;
            height: 0 !important;
            z-index: 2147483647 !important;
            pointer-events: none !important;
        }

        /* Общие свойства оверлеев */
        .${C}-speed, .${C}-notification, .${C}-error {
            position: fixed !important;
            background: rgba(0,0,0,0.85) !important;
            color: #fff !important;
            z-index: 2147483647 !important;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
            pointer-events: none !important;
        }

        .${C}-speed {
            top: 8%;
            left: 50%;
            transform: translateX(-50%) !important;
            padding: 10px 20px !important;
            border-radius: 20px !important;
            font-size: 16px !important;
            font-weight: 600 !important;
            animation: npFadeSpeed 1.5s ease-in-out !important;
        }

        .${C}-notification {
            top: 50% !important;
            left: 50% !important;
            transform: translate(-50%, -50%) !important;
            padding: 12px 24px !important;
            border-radius: 8px !important;
            font-size: 14px !important;
            animation: npFade 2s ease-in-out !important;
        }

        .${C}-error {
            top: 50% !important;
            left: 50% !important;
            transform: translate(-50%, -50%) !important;
            background: rgba(255,0,0,.8) !important;
            padding: 10px 20px !important;
            border-radius: 5px !important;
            font-size: 14px !important;
        }

        @keyframes npFade {
            0%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
            15%, 85% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes npFadeSpeed {
            0%, 100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
            15%, 85% { opacity: 1; transform: translateX(-50%) translateY(0); }
        }

        /* Панель настроек */
        .${C}-panel-backdrop {
            position: fixed !important;
            inset: 0 !important;
            background: rgba(0,0,0,0.5) !important;
            backdrop-filter: blur(4px) !important;
            -webkit-backdrop-filter: blur(4px) !important;
            z-index: 2147483646 !important;
            opacity: 0 !important;
            transition: opacity .25s ease !important;
            pointer-events: none !important;
        }
        .${C}-panel-backdrop.open { opacity: 1 !important; pointer-events: auto !important; }

        .${C}-panel {
            position: fixed !important;
            top: 50% !important; left: 50% !important;
            transform: translate(-50%, -50%) scale(0.95) !important;
            width: 92% !important;
            max-width: 420px !important;
            max-height: 85vh !important;
            background: rgba(28,28,30,0.95) !important;
            backdrop-filter: blur(20px) !important;
            -webkit-backdrop-filter: blur(20px) !important;
            border: 1px solid rgba(255,255,255,0.1) !important;
            border-radius: 16px !important;
            color: #fff !important;
            z-index: 2147483647 !important;
            opacity: 0 !important;
            transition: opacity .25s ease, transform .25s ease !important;
            pointer-events: none !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            font-size: 14px !important;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5) !important;
            overflow: hidden !important;
            display: flex !important;
            flex-direction: column !important;
        }
        .${C}-panel.open {
            opacity: 1 !important;
            transform: translate(-50%, -50%) scale(1) !important;
            pointer-events: auto !important;
        }

        .${C}-panel-header {
            padding: 16px 20px !important;
            border-bottom: 1px solid rgba(255,255,255,0.1) !important;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            flex-shrink: 0 !important;
        }
        .${C}-panel-title { font-size: 17px !important; font-weight: 600 !important; }
        .${C}-panel-close {
            background: rgba(255,255,255,0.1) !important;
            border: none !important;
            color: #fff !important;
            width: 28px !important; height: 28px !important;
            border-radius: 50% !important;
            cursor: pointer !important;
            display: flex !important; align-items: center !important; justify-content: center !important;
            font-size: 16px !important;
            padding: 0 !important;
        }
        .${C}-panel-close:active { opacity: 0.7 !important; }

        .${C}-panel-body {
            padding: 16px 20px !important;
            overflow-y: auto !important;
            flex: 1 !important;
            -webkit-overflow-scrolling: touch !important;
        }

        .${C}-panel-section { margin-bottom: 20px !important; }
        .${C}-panel-section:last-child { margin-bottom: 0 !important; }
        .${C}-panel-section-title {
            font-size: 11px !important;
            font-weight: 600 !important;
            color: rgba(255,255,255,0.5) !important;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
            margin-bottom: 10px !important;
            padding-left: 4px !important;
        }

        .${C}-panel-row {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            padding: 10px 12px !important;
            background: rgba(255,255,255,0.04) !important;
            border-radius: 10px !important;
            margin-bottom: 6px !important;
            gap: 10px !important;
        }
        .${C}-panel-label { font-size: 14px !important; color: #fff !important; flex: 1 !important; min-width: 0 !important; }
        .${C}-panel-value {
            font-size: 13px !important;
            color: rgba(255,255,255,0.6) !important;
            font-variant-numeric: tabular-nums !important;
            min-width: 48px !important;
            text-align: right !important;
        }

        .${C}-toggle {
            position: relative !important;
            width: 44px !important; height: 26px !important;
            background: rgba(120,120,128,0.32) !important;
            border-radius: 13px !important;
            cursor: pointer !important;
            transition: background .2s ease !important;
            flex-shrink: 0 !important;
            border: none !important;
            padding: 0 !important;
        }
        .${C}-toggle.on { background: #34c759 !important; }
        .${C}-toggle::after {
            content: '' !important;
            position: absolute !important;
            top: 2px !important; left: 2px !important;
            width: 22px !important; height: 22px !important;
            background: #fff !important;
            border-radius: 50% !important;
            transition: transform .2s ease !important;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
        }
        .${C}-toggle.on::after { transform: translateX(18px) !important; }

        .${C}-slider {
            -webkit-appearance: none !important;
            appearance: none !important;
            width: 100% !important; height: 4px !important;
            background: rgba(255,255,255,0.2) !important;
            border-radius: 2px !important;
            outline: none !important;
            flex: 1 !important;
            min-width: 100px !important;
        }
        .${C}-slider::-webkit-slider-thumb {
            -webkit-appearance: none !important;
            appearance: none !important;
            width: 20px !important; height: 20px !important;
            background: #fff !important;
            border-radius: 50% !important;
            cursor: pointer !important;
            box-shadow: 0 1px 4px rgba(0,0,0,0.4) !important;
        }

        .${C}-panel-footer {
            padding: 12px 20px 16px !important;
            border-top: 1px solid rgba(255,255,255,0.1) !important;
            display: flex !important;
            gap: 8px !important;
            flex-shrink: 0 !important;
        }
        .${C}-panel-btn {
            flex: 1 !important;
            padding: 10px !important;
            border-radius: 10px !important;
            border: none !important;
            font-size: 14px !important;
            font-weight: 500 !important;
            cursor: pointer !important;
            transition: opacity .15s ease !important;
            font-family: inherit !important;
        }
        .${C}-panel-btn:active { opacity: 0.7 !important; }
        .${C}-panel-btn-secondary { background: rgba(255,255,255,0.1) !important; color: #fff !important; }
        .${C}-panel-btn-danger { background: rgba(255,59,48,0.2) !important; color: #ff453a !important; }
    `;
    };

    const applyStyle = () => {
        style.textContent = buildCSS();
        if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
    };

    // ============================================================
    // Слой для кнопок (absolute в координатах документа)
    // ============================================================

    const getLayer = () => {
        if (layer && layer.isConnected) return layer;
        layer = document.createElement('div');
        layer.className = CONFIG.BUTTON_CLASS + '-layer';
        (document.body || document.documentElement).appendChild(layer);
        return layer;
    };

    // ============================================================
    // Утилиты
    // ============================================================

    const isLiveVideo = (video) => video instanceof HTMLVideoElement && video.isConnected;

    const showOverlay = (message, type, duration, video) => {
        if (!document.body) return;
        const el = document.createElement('div');
        el.className = `${CONFIG.BUTTON_CLASS}-${type}`;
        el.textContent = message;

        if (type === 'speed' && video && isLiveVideo(video)) {
            const r = video.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                el.style.left = `${r.left + r.width / 2}px`;
                el.style.top = `${Math.max(8, r.top + 12)}px`;
            }
        }

        document.body.appendChild(el);
        setTimeout(() => el.remove(), duration);
    };

    const showNotification = (m) => showOverlay(m, 'notification', CONFIG.NOTIFICATION_DURATION);
    const showSpeedNotification = (m, v) => showOverlay(m, 'speed', 1500, v);
    const showError = (m) => showOverlay(m, 'error', CONFIG.ERROR_DURATION);

    const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return h > 0
            ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
            : `${m}:${String(s).padStart(2, '0')}`;
    };

    const findLiveVideo = (video) => {
        if (isLiveVideo(video)) return video;
        for (const candidate of document.querySelectorAll('video')) {
            if (isLiveVideo(candidate) && candidate.offsetWidth > 0) return candidate;
        }
        return null;
    };

    const guardAction = (video, event) => {
        event.preventDefault();
        event.stopPropagation();
        return findLiveVideo(video);
    };

    // ============================================================
    // Ускорение при удержании
    // ============================================================

    function setupHoldToSpeed(video) {
        if (!CONFIG.HOLD_ENABLED) return null;

        const listeners = [];
        const on = (target, type, fn, opts) => {
            target.addEventListener(type, fn, opts);
            listeners.push([target, type, fn, opts]);
        };

        let holdTimer = null, safetyTimer = null, checkInterval = null;
        let originalSpeed = 1, isHolding = false, suppressClick = false;
        let startX = 0, startY = 0;

        const getCoords = (event) => {
            if (event.touches?.length) return { x: event.touches[0].clientX, y: event.touches[0].clientY };
            if (event.changedTouches?.length) return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
            return { x: event.clientX || 0, y: event.clientY || 0 };
        };

        const clearHoldTimers = () => {
            if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
            if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
            if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
        };

        const resetHold = (notify = false) => {
            clearHoldTimers();
            if (!isHolding) return false;
            video.playbackRate = originalSpeed;
            isHolding = false;
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 500);
            if (notify) showSpeedNotification(`▶ ${originalSpeed}x`, video);
            return true;
        };

        const startHold = (event) => {
            if (event.target?.closest?.(`.${CONFIG.BUTTON_CLASS}`)) return;
            if (video.paused || video.ended || isHolding || holdTimer) return;

            const coords = getCoords(event);
            startX = coords.x;
            startY = coords.y;
            originalSpeed = video.playbackRate || 1;

            holdTimer = setTimeout(() => {
                holdTimer = null;
                if (isHolding || video.paused || video.ended || !isLiveVideo(video)) return;

                video.playbackRate = CONFIG.HOLD_SPEED;
                isHolding = true;
                showSpeedNotification(`⚡ ${CONFIG.HOLD_SPEED}x`, video);

                safetyTimer = setTimeout(() => resetHold(true), CONFIG.HOLD_SAFETY_TIMEOUT);

                checkInterval = setInterval(() => {
                    if (!isLiveVideo(video) || video.ended) { resetHold(true); return; }
                    if (isHolding && video.playbackRate !== CONFIG.HOLD_SPEED) {
                        video.playbackRate = CONFIG.HOLD_SPEED;
                    }
                }, CONFIG.HOLD_CHECK_INTERVAL);
            }, CONFIG.HOLD_DELAY);
        };

        const checkMove = (event) => {
            const coords = getCoords(event);

            if (!isHolding) {
                if (!holdTimer) return;
                if (Math.hypot(coords.x - startX, coords.y - startY) > CONFIG.HOLD_MOVE_TOLERANCE) {
                    clearTimeout(holdTimer);
                    holdTimer = null;
                }
                return;
            }

            const rect = video.getBoundingClientRect();
            const margin = 20;
            if (
                coords.x < rect.left - margin || coords.x > rect.right + margin ||
                coords.y < rect.top - margin || coords.y > rect.bottom + margin
            ) {
                resetHold(true);
            }
        };

        const endHold = (event) => {
            const wasHolding = resetHold(true);
            if (wasHolding && event?.cancelable) event.preventDefault();
        };

        const suppressClickHandler = (event) => {
            if (!suppressClick) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            suppressClick = false;
        };

        const onScroll = () => {
            if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
            if (isHolding) resetHold(true);
        };

        const onWindowEnd = () => {
            if (isHolding) { resetHold(true); return; }
            if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        };

        on(video, 'pointerdown', startHold, true);
        on(video, 'pointermove', checkMove, true);
        on(video, 'pointerup', endHold, true);
        on(video, 'pointercancel', endHold, true);

        on(video, 'touchstart', startHold, { passive: true, capture: true });
        on(video, 'touchmove', checkMove, { passive: true, capture: true });
        on(video, 'touchend', endHold, { capture: true });
        on(video, 'touchcancel', endHold, { capture: true });

        on(video, 'click', suppressClickHandler, true);
        on(video, 'contextmenu', (e) => { if (isHolding) e.preventDefault(); }, true);

        on(window, 'scroll', onScroll, { passive: true, capture: true });
        for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) {
            on(window, type, onWindowEnd, true);
        }
        on(window, 'blur', () => resetHold(true), true);

        return () => {
            clearHoldTimers();
            for (const [target, type, fn, opts] of listeners) {
                target.removeEventListener(type, fn, opts);
            }
        };
    }

    // ============================================================
    // Fullscreen / Skip
    // ============================================================

    const tryFullscreen = (video) => {
        if (!isLiveVideo(video)) return;

        const attempt = (method, arg) => {
            if (typeof video[method] !== 'function') return false;
            try { video[method](arg); return true; } catch (e) { return false; }
        };

        if (
            attempt('webkitEnterFullscreen') ||
            attempt('webkitSetPresentationMode', 'fullscreen') ||
            attempt('requestFullscreen')
        ) return;

        showError('Полноэкранный режим не поддерживается');
    };

    const activateFullscreen = (video, event) => {
        const liveVideo = guardAction(video, event);
        if (!liveVideo) return;

        if (liveVideo.readyState >= 1) {
            if (liveVideo.paused) liveVideo.play().catch(() => {});
            tryFullscreen(liveVideo);
            return;
        }

        const onReady = () => {
            liveVideo.removeEventListener('loadedmetadata', onReady);
            liveVideo.removeEventListener('canplay', onReady);
            if (isLiveVideo(liveVideo)) tryFullscreen(liveVideo);
        };
        liveVideo.addEventListener('loadedmetadata', onReady, { once: true });
        liveVideo.addEventListener('canplay', onReady, { once: true });
        if (liveVideo.paused) liveVideo.play().catch(() => {});
    };

    const skipVideo = (video, event) => {
        const liveVideo = guardAction(video, event);
        if (!liveVideo) return;

        const applySkip = (t) => {
            liveVideo.currentTime = Math.max(0, t);
            showNotification(`Пропущено до ${formatTime(t)}`);
        };

        if (Number.isFinite(liveVideo.duration) && liveVideo.duration > 0) {
            try { applySkip(liveVideo.duration - CONFIG.SKIP_OFFSET); return; } catch (e) {}
        }

        if (liveVideo.seekable.length) {
            try {
                applySkip(liveVideo.seekable.end(liveVideo.seekable.length - 1) - CONFIG.SKIP_OFFSET);
                return;
            } catch (e) {}
        }

        try {
            applySkip(liveVideo.currentTime + CONFIG.SKIP_FALLBACK);
        } catch (e) {
            showError('Не удалось пропустить видео');
        }
    };

    // ============================================================
    // Кнопки
    // ============================================================

    const BUTTON_LABELS = {
        fullscreen: 'Полноэкранный режим',
        skip: 'Пропустить видео',
        settings: 'Настройки плеера'
    };

    const createButton = (video, type, action) => {
        const button = document.createElement('button');
        button.className = CONFIG.BUTTON_CLASS;
        button.type = 'button';
        button.innerHTML = ICONS[type];
        button.setAttribute('aria-label', BUTTON_LABELS[type]);

        let lastAction = 0;
        const handler = event => {
            const now = Date.now();
            if (now - lastAction < CONFIG.DEBOUNCE_TIME) return;
            lastAction = now;
            action(video, event);
        };

        button.addEventListener('pointerup', handler, true);
        button.addEventListener('touchend', handler, true);
        button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); }, true);
        button.addEventListener('touchstart', event => event.stopPropagation(), true);

        return button;
    };

    // ============================================================
    // Позиционирование (координаты ДОКУМЕНТА — кнопки скроллятся
    // вместе со страницей и всегда остаются внутри видео)
    // ============================================================

    const positionButtons = (video, buttons) => {
        if (!buttons?.length) return;

        if (!isLiveVideo(video)) {
            buttons.forEach(btn => btn.remove());
            return;
        }

        const r = video.getBoundingClientRect();

        // Видео скрыто или слишком маленькое — прячем кнопки
        if (r.width < 40 || r.height < 40) {
            buttons.forEach(btn => { btn.style.display = 'none'; });
            return;
        }

        buttons.forEach(btn => { btn.style.display = 'flex'; });

        // Начало координат слоя (учитывает любые offset-предки)
        const host = getLayer();
        const hr = host.getBoundingClientRect();
        const baseX = hr.left + scrollX;
        const baseY = hr.top + scrollY;

        // Границы видео в координатах документа
        const docLeft = r.left + scrollX;
        const docTop = r.top + scrollY;

        const count = buttons.length;
        const top = docTop + CONFIG.BUTTON_MARGIN;
        const rightMost = docLeft + r.width - CONFIG.BUTTON_SIZE - CONFIG.BUTTON_MARGIN;

        for (let i = 0; i < count; i++) {
            const left = rightMost - (count - 1 - i) * (CONFIG.BUTTON_SIZE + CONFIG.BUTTON_GAP);
            buttons[i].style.left = `${Math.round(Math.max(docLeft + 4, left) - baseX)}px`;
            buttons[i].style.top = `${Math.round(top - baseY)}px`;
        }
    };

    // ============================================================
    // Привязка к видео
    // ============================================================

    const attachVideo = (video) => {
        if (!(video instanceof HTMLVideoElement) || !video.isConnected || videoButtons.has(video)) return;

        const buttons = [];
        const entry = { buttons };

        const addBtn = (type, action) => {
            const btn = createButton(video, type, action);
            getLayer().appendChild(btn);
            buttons.push(btn);
            return btn;
        };

        entry.settings = addBtn('settings', () => openSettings());
        if (CONFIG.SKIP_ENABLED) entry.skip = addBtn('skip', skipVideo);
        if (CONFIG.FULLSCREEN_ENABLED) entry.fullscreen = addBtn('fullscreen', activateFullscreen);

        entry.cleanupHold = CONFIG.HOLD_ENABLED ? setupHoldToSpeed(video) : null;

        videoButtons.set(video, entry);
        positionButtons(video, buttons);
    };

    const detachVideo = (video) => {
        const entry = videoButtons.get(video);
        if (!entry) return;
        entry.buttons.forEach(btn => btn.remove());
        if (entry.cleanupHold) entry.cleanupHold();
        videoButtons.delete(video);
    };

    // ============================================================
    // Панель настроек
    // ============================================================

    const SETTINGS_SCHEMA = [
        {
            title: 'Функции',
            items: [
                { key: 'FULLSCREEN_ENABLED', label: 'Полноэкранный режим', type: 'toggle' },
                { key: 'SKIP_ENABLED', label: 'Кнопка пропуска', type: 'toggle' },
                { key: 'HOLD_ENABLED', label: 'Ускорение при удержании', type: 'toggle' }
            ]
        },
        {
            title: 'Кнопки',
            items: [
                { key: 'BUTTON_SIZE', label: 'Размер кнопки', type: 'range', min: 30, max: 60, step: 1, suffix: 'px' },
                { key: 'BUTTON_MARGIN', label: 'Отступ от края', type: 'range', min: 4, max: 30, step: 1, suffix: 'px' },
                { key: 'BUTTON_GAP', label: 'Расстояние между кнопками', type: 'range', min: 4, max: 30, step: 1, suffix: 'px' }
            ]
        },
        {
            title: 'Ускорение (удержание)',
            items: [
                { key: 'HOLD_DELAY', label: 'Задержка активации', type: 'range', min: 300, max: 2000, step: 50, suffix: 'мс' },
                { key: 'HOLD_SPEED', label: 'Скорость', type: 'range', min: 1.5, max: 4.0, step: 0.1, suffix: 'x', decimals: 1 },
                { key: 'HOLD_MOVE_TOLERANCE', label: 'Допустимое смещение', type: 'range', min: 5, max: 50, step: 1, suffix: 'px' }
            ]
        },
        {
            title: 'Пропуск',
            items: [
                { key: 'SKIP_OFFSET', label: 'Отступ от конца', type: 'range', min: 0, max: 1.0, step: 0.1, suffix: 'сек', decimals: 1 },
                { key: 'SKIP_FALLBACK', label: 'Перемотка вперёд (fallback)', type: 'range', min: 5, max: 120, step: 1, suffix: 'сек' }
            ]
        }
    ];

    const applySettings = () => {
        saveConfig();
        applyStyle();
        rebuildAllVideoButtons();
    };

    const rebuildAllVideoButtons = () => {
        const videos = [];
        videoButtons.forEach((entry, video) => {
            if (isLiveVideo(video)) videos.push(video);
            entry.buttons.forEach(btn => btn.remove());
            if (entry.cleanupHold) entry.cleanupHold();
        });
        videoButtons.clear();
        videos.forEach(attachVideo);
    };

    const createSettingsPanel = () => {
        if (settingsPanel) return;

        const el = (tag, className, text) => {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text) node.textContent = text;
            return node;
        };
        const P = (name) => `${CONFIG.BUTTON_CLASS}-${name}`;

        const backdrop = el('div', P('panel-backdrop'));
        backdrop.addEventListener('click', closeSettings);

        const panel = el('div', P('panel'));

        const closeBtn = el('button', P('panel-close'), '✕');
        closeBtn.addEventListener('click', closeSettings);
        const header = el('div', P('panel-header'));
        header.append(el('div', P('panel-title'), 'Настройки плеера'), closeBtn);

        const body = el('div', P('panel-body'));
        const controls = {};

        SETTINGS_SCHEMA.forEach(section => {
            const sectionEl = el('div', P('panel-section'));
            sectionEl.appendChild(el('div', P('panel-section-title'), section.title));

            section.items.forEach(item => {
                const row = el('div', P('panel-row'));
                row.appendChild(el('div', P('panel-label'), item.label));

                if (item.type === 'toggle') {
                    const toggle = el('button', P('toggle'));
                    toggle.type = 'button';
                    if (CONFIG[item.key]) toggle.classList.add('on');

                    toggle.addEventListener('click', () => {
                        CONFIG[item.key] = !CONFIG[item.key];
                        toggle.classList.toggle('on', CONFIG[item.key]);
                        applySettings();
                    });

                    controls[item.key] = { type: 'toggle', el: toggle };
                    row.appendChild(toggle);
                } else {
                    const decimals = item.decimals || 0;
                    const value = el('div', P('panel-value'), Number(CONFIG[item.key]).toFixed(decimals) + (item.suffix || ''));

                    const slider = document.createElement('input');
                    slider.type = 'range';
                    slider.className = P('slider');
                    slider.min = item.min;
                    slider.max = item.max;
                    slider.step = item.step;
                    slider.value = CONFIG[item.key];

                    slider.addEventListener('input', () => {
                        CONFIG[item.key] = parseFloat(slider.value);
                        value.textContent = Number(CONFIG[item.key]).toFixed(decimals) + (item.suffix || '');
                    });
                    slider.addEventListener('change', applySettings);

                    controls[item.key] = { type: 'range', el: value, slider, suffix: item.suffix || '', decimals };
                    row.append(slider, value);
                }

                sectionEl.appendChild(row);
            });

            body.appendChild(sectionEl);
        });

        const resetBtn = el('button', P('panel-btn') + ' ' + P('panel-btn-danger'), 'Сбросить');
        resetBtn.type = 'button';
        resetBtn.addEventListener('click', () => {
            resetConfig();
            applyStyle();
            syncPanelControls();
            rebuildAllVideoButtons();
            showNotification('Настройки сброшены');
        });

        const closeBtn2 = el('button', P('panel-btn') + ' ' + P('panel-btn-secondary'), 'Закрыть');
        closeBtn2.type = 'button';
        closeBtn2.addEventListener('click', closeSettings);

        const footer = el('div', P('panel-footer'));
        footer.append(resetBtn, closeBtn2);

        panel.append(header, body, footer);
        document.body.append(backdrop, panel);

        settingsPanel = { backdrop, panel, controls };
    };

    const syncPanelControls = () => {
        if (!settingsPanel) return;
        SETTINGS_SCHEMA.forEach(section => {
            section.items.forEach(item => {
                const control = settingsPanel.controls[item.key];
                if (!control) return;
                if (control.type === 'toggle') {
                    control.el.classList.toggle('on', !!CONFIG[item.key]);
                } else {
                    control.el.textContent = Number(CONFIG[item.key]).toFixed(control.decimals) + control.suffix;
                    control.slider.value = CONFIG[item.key];
                }
            });
        });
    };

    const openSettings = () => {
        createSettingsPanel();
        syncPanelControls();
        settingsPanel.backdrop.classList.add('open');
        settingsPanel.panel.classList.add('open');
    };

    const closeSettings = () => {
        if (!settingsPanel) return;
        settingsPanel.backdrop.classList.remove('open');
        settingsPanel.panel.classList.remove('open');
    };

    // ============================================================
    // Shadow DOM
    // ============================================================

    const processShadow = (shadow) => {
        if (!shadow || observedShadows.has(shadow)) return;
        observedShadows.add(shadow);
        const process = () => shadow.querySelectorAll('video').forEach(attachVideo);
        process();
        new MutationObserver(process).observe(shadow, { childList: true, subtree: true });
    };

    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
        const shadow = originalAttachShadow.call(this, init);
        try { processShadow(shadow); } catch (e) {}
        return shadow;
    };

    const scanShadows = (root = document) => {
        if (!root.querySelectorAll) return;
        root.querySelectorAll('*').forEach(el => {
            if (el.shadowRoot) {
                processShadow(el.shadowRoot);
                scanShadows(el.shadowRoot);
            }
        });
    };

    // ============================================================
    // Сканирование и обновление
    // ============================================================

    const scanVideos = (root = document) => {
        if (!root.querySelectorAll) return;
        root.querySelectorAll('video').forEach(video => { if (video.isConnected) attachVideo(video); });
    };

    let scheduled = false;
    const updatePositions = () => {
        if (scheduled) return;
        scheduled = true;

        requestAnimationFrame(() => {
            scheduled = false;
            videoButtons.forEach((entry, video) => {
                if (!isLiveVideo(video)) { detachVideo(video); return; }
                positionButtons(video, entry.buttons);
            });
        });
    };

    const startPeriodicTasks = () => {
        const scanEvery = Math.max(1, Math.round(CONFIG.SCAN_INTERVAL / CONFIG.POSITION_UPDATE_INTERVAL));
        let tick = 0;

        setInterval(() => {
            updatePositions();
            if (++tick % scanEvery === 0) scanVideos();
        }, CONFIG.POSITION_UPDATE_INTERVAL);
    };

    // ============================================================
    // DOM Observer
    // ============================================================

    new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.removedNodes.forEach(node => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                if (node instanceof HTMLVideoElement) detachVideo(node);
                if (node.querySelectorAll) node.querySelectorAll('video').forEach(detachVideo);
            });
            mutation.addedNodes.forEach(node => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                if (node instanceof HTMLVideoElement) attachVideo(node);
                scanVideos(node);
                scanShadows(node);
            });
        });
    }).observe(document.documentElement, { childList: true, subtree: true });

    // ============================================================
    // Запуск
    // ============================================================

    // Скролл больше не нужен для позиций: кнопки скроллятся сами.
    // Оставляем только resize/orientation (меняется раскладка страницы).
    addEventListener('resize', updatePositions, { passive: true });
    addEventListener('orientationchange', updatePositions, { passive: true });

    applyStyle();
    scanVideos();
    scanShadows();
    startPeriodicTasks();

})();
