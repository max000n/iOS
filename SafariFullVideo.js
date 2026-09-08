// ==UserScript==
// @name         iOS Safari — Native Player
// @namespace    ios-native-player-button
// @version      9.14.1
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
        BUTTON_RADIUS: 30,      // 0% = квадрат, 50% = круг
        BUTTON_OPACITY: 50,     // прозрачность кнопок и индикатора (%)
        BUTTON_BG_ALPHA: 50,    // плотность серого фона (%)
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

    // Минимальный размер видео, для которого создаются кнопки
    // (защищает от служебных/скрытых/крошечных video-элементов)
    const MIN_VIDEO_W = 140;
    const MIN_VIDEO_H = 100;

    // ============================================================
    // Конфигурация (localStorage)
    // ============================================================

    const STORAGE_KEY = 'ios-native-player-config-v2';

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
    const shadowProcessors = [];
    let settingsPanel = null;
    let layer = null;

    // ============================================================
    // Иконки
    // ============================================================

    const ICONS = {
        fullscreen: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3H5C3.9 3 3 3.9 3 5V8M16 3H19C20.1 3 21 3.9 21 5V8M8 21H5C3.9 21 3 20.1 3 19V16M16 21H19C20.1 21 21 20.1 21 19V16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        skip: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 5.2V18.8L15.5 12L4.5 5.2Z" fill="currentColor"/><path d="M19 5V19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
        settings: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    const SPEED_ICONS = {
        fast: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 5.5v13L13 12 3 5.5z" fill="currentColor"/><path d="M13 5.5v13L23 12 13 5.5z" fill="currentColor"/></svg>',
        normal: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 4.5v15L19 12 7 4.5z" fill="currentColor"/></svg>'
    };

    // ============================================================
    // CSS (минифицированный, генерируется из CONFIG)
    // ============================================================

    const style = document.createElement('style');

    const buildCSS = () => {
        const C = CONFIG.BUTTON_CLASS;
        const R = CONFIG.BUTTON_RADIUS;
        const OP = CONFIG.BUTTON_OPACITY / 100;
        const BG = CONFIG.BUTTON_BG_ALPHA / 100;
        // Радиус в пикселях: та же кривизна угла, что и у кнопок
        const RPX = Math.round(CONFIG.BUTTON_SIZE * R / 100);
        return '.' + C + '{position:absolute!important;width:' + CONFIG.BUTTON_SIZE + 'px!important;height:' + CONFIG.BUTTON_SIZE + 'px!important;padding:0!important;margin:0!important;box-sizing:border-box!important;display:flex!important;align-items:center!important;justify-content:center!important;border:1px solid rgba(255,255,255,.32)!important;border-radius:' + R + '%!important;background:rgba(20,20,22,' + BG + ')!important;color:#fff!important;opacity:' + OP + '!important;z-index:2147483647!important;backdrop-filter:blur(7px)!important;-webkit-backdrop-filter:blur(7px)!important;-webkit-appearance:none!important;appearance:none!important;outline:none!important;box-shadow:0 2px 10px rgba(0,0,0,.35)!important;touch-action:manipulation!important;-webkit-tap-highlight-color:transparent!important;cursor:pointer!important;pointer-events:auto!important}'
        + '.' + C + ':active{transform:scale(.9)!important;filter:brightness(1.3)!important}'
        + '.' + C + ' svg{width:19px!important;height:19px!important;display:block!important;pointer-events:none!important}'
        + '.' + C + '-layer{position:absolute!important;top:0!important;left:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important}'
        // Бейдж скорости: высота как у кнопки, радиус в px (не даёт эллипсов на широкой пилюле)
        + '.' + C + '-speed{position:absolute!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;white-space:nowrap!important;line-height:1!important;height:' + CONFIG.BUTTON_SIZE + 'px!important;box-sizing:border-box!important;border:1px solid rgba(255,255,255,.32)!important;background:rgba(20,20,22,' + BG + ')!important;color:#fff!important;opacity:' + OP + '!important;border-radius:' + RPX + 'px!important;z-index:2147483647!important;font-family:-apple-system,BlinkMacSystemFont,sans-serif!important;pointer-events:none!important;transform:translateX(-50%)!important;padding:0 14px!important;font-size:16px!important;font-weight:600!important;backdrop-filter:blur(7px)!important;-webkit-backdrop-filter:blur(7px)!important;box-shadow:0 2px 10px rgba(0,0,0,.35)!important;animation:npFadeSpeed 1.5s ease-in-out!important}'
        + '.' + C + '-speed svg{width:18px!important;height:18px!important;flex-shrink:0!important;display:block!important}'
        + '.' + C + '-notification,.' + C + '-error{position:fixed!important;top:50%!important;left:50%!important;transform:translate(-50%,-50%)!important;background:rgba(0,0,0,.85)!important;color:#fff!important;z-index:2147483647!important;font-family:-apple-system,BlinkMacSystemFont,sans-serif!important;pointer-events:none!important;padding:12px 24px!important;border-radius:8px!important;font-size:14px!important}'
        + '.' + C + '-notification{animation:npFade 2s ease-in-out!important}'
        + '.' + C + '-error{background:rgba(255,0,0,.8)!important;padding:10px 20px!important;border-radius:5px!important}'
        + '@keyframes npFade{0%,100%{opacity:0;transform:translate(-50%,-50%) scale(.9)}15%,85%{opacity:1;transform:translate(-50%,-50%) scale(1)}}'
        + '@keyframes npFadeSpeed{0%,100%{opacity:0;transform:translateX(-50%) translateY(-10px)}15%,85%{opacity:1;transform:translateX(-50%) translateY(0)}}'
        + '.' + C + '-panel-backdrop{position:fixed!important;inset:0!important;background:rgba(0,0,0,.5)!important;backdrop-filter:blur(4px)!important;-webkit-backdrop-filter:blur(4px)!important;z-index:2147483646!important;opacity:0!important;transition:opacity .25s ease!important;pointer-events:none!important}'
        + '.' + C + '-panel-backdrop.open{opacity:1!important;pointer-events:auto!important}'
        + '.' + C + '-panel{position:fixed!important;top:50%!important;left:50%!important;transform:translate(-50%,-50%) scale(.95)!important;width:92%!important;max-width:420px!important;max-height:85vh!important;background:rgba(28,28,30,.95)!important;backdrop-filter:blur(20px)!important;-webkit-backdrop-filter:blur(20px)!important;border:1px solid rgba(255,255,255,.1)!important;border-radius:16px!important;color:#fff!important;z-index:2147483647!important;opacity:0!important;transition:opacity .25s ease,transform .25s ease!important;pointer-events:none!important;font-family:-apple-system,BlinkMacSystemFont,sans-serif!important;font-size:14px!important;box-shadow:0 20px 60px rgba(0,0,0,.5)!important;overflow:hidden!important;display:flex!important;flex-direction:column!important}'
        + '.' + C + '-panel.open{opacity:1!important;transform:translate(-50%,-50%) scale(1)!important;pointer-events:auto!important}'
        + '.' + C + '-panel-header{padding:16px 20px!important;border-bottom:1px solid rgba(255,255,255,.1)!important;display:flex!important;justify-content:space-between!important;align-items:center!important;flex-shrink:0!important}'
        + '.' + C + '-panel-title{font-size:17px!important;font-weight:600!important}'
        + '.' + C + '-panel-close{background:rgba(255,255,255,.1)!important;border:none!important;color:#fff!important;width:28px!important;height:28px!important;border-radius:50%!important;cursor:pointer!important;display:flex!important;align-items:center!important;justify-content:center!important;font-size:16px!important;padding:0!important}'
        + '.' + C + '-panel-close:active{opacity:.7!important}'
        + '.' + C + '-panel-body{padding:16px 20px!important;overflow-y:auto!important;flex:1!important;-webkit-overflow-scrolling:touch!important}'
        + '.' + C + '-panel-section{margin-bottom:20px!important}'
        + '.' + C + '-panel-section:last-child{margin-bottom:0!important}'
        + '.' + C + '-panel-section-title{font-size:11px!important;font-weight:600!important;color:rgba(255,255,255,.5)!important;text-transform:uppercase!important;letter-spacing:.5px!important;margin-bottom:10px!important;padding-left:4px!important}'
        + '.' + C + '-panel-row{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:10px 12px!important;background:rgba(255,255,255,.04)!important;border-radius:10px!important;margin-bottom:6px!important;gap:10px!important}'
        + '.' + C + '-panel-label{font-size:14px!important;color:#fff!important;flex:1!important;min-width:0!important}'
        + '.' + C + '-panel-value{font-size:13px!important;color:rgba(255,255,255,.6)!important;font-variant-numeric:tabular-nums!important;min-width:48px!important;text-align:right!important}'
        + '.' + C + '-toggle{position:relative!important;width:44px!important;height:26px!important;background:rgba(120,120,128,.32)!important;border-radius:13px!important;cursor:pointer!important;transition:background .2s ease!important;flex-shrink:0!important;border:none!important;padding:0!important}'
        + '.' + C + '-toggle.on{background:#34c759!important}'
        + '.' + C + '-toggle::after{content:""!important;position:absolute!important;top:2px!important;left:2px!important;width:22px!important;height:22px!important;background:#fff!important;border-radius:50%!important;transition:transform .2s ease!important;box-shadow:0 1px 3px rgba(0,0,0,.3)!important}'
        + '.' + C + '-toggle.on::after{transform:translateX(18px)!important}'
        + '.' + C + '-slider{-webkit-appearance:none!important;appearance:none!important;width:100%!important;height:4px!important;background:rgba(255,255,255,.2)!important;border-radius:2px!important;outline:none!important;flex:1!important;min-width:100px!important}'
        + '.' + C + '-slider::-webkit-slider-thumb{-webkit-appearance:none!important;appearance:none!important;width:20px!important;height:20px!important;background:#fff!important;border-radius:50%!important;cursor:pointer!important;box-shadow:0 1px 4px rgba(0,0,0,.4)!important}'
        + '.' + C + '-panel-footer{padding:12px 20px 16px!important;border-top:1px solid rgba(255,255,255,.1)!important;display:flex!important;gap:8px!important;flex-shrink:0!important}'
        + '.' + C + '-panel-btn{flex:1!important;padding:10px!important;border-radius:10px!important;border:none!important;font-size:14px!important;font-weight:500!important;cursor:pointer!important;transition:opacity .15s ease!important;font-family:inherit!important}'
        + '.' + C + '-panel-btn:active{opacity:.7!important}'
        + '.' + C + '-panel-btn-secondary{background:rgba(255,255,255,.1)!important;color:#fff!important}'
        + '.' + C + '-panel-btn-danger{background:rgba(255,59,48,.2)!important;color:#ff453a!important}';
    };

    const applyStyle = () => {
        style.textContent = buildCSS();
        if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
    };

    // ============================================================
    // Слой для кнопок и индикатора скорости
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

    // Видео достаточно большое и не скрыто стилями
    const isMeaningfulVideo = (video) => {
        const r = video.getBoundingClientRect();
        if (r.width < MIN_VIDEO_W || r.height < MIN_VIDEO_H) return false;
        const cs = window.getComputedStyle(video);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
        return true;
    };

    const showOverlay = (message, type, duration) => {
        if (!document.body) return;
        const el = document.createElement('div');
        el.className = CONFIG.BUTTON_CLASS + '-' + type;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), duration);
    };

    const showNotification = (m) => showOverlay(m, 'notification', CONFIG.NOTIFICATION_DURATION);
    const showError = (m) => showOverlay(m, 'error', CONFIG.ERROR_DURATION);

    const formatSpeed = (v) => parseFloat(Number(v).toFixed(2)) + 'x';

    const showSpeedNotification = (speed, video, fast) => {
        if (!document.body || !video || !isLiveVideo(video)) return;
        const r = video.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;

        const el = document.createElement('div');
        el.className = CONFIG.BUTTON_CLASS + '-speed';
        el.innerHTML = '<span>' + formatSpeed(speed) + '</span>' + (fast ? SPEED_ICONS.fast : SPEED_ICONS.normal);

        const host = getLayer();
        const hr = host.getBoundingClientRect();
        el.style.left = (r.left + r.width / 2 - hr.left) + 'px';
        el.style.top = (r.top + 12 - hr.top) + 'px';
        host.appendChild(el);

        setTimeout(() => el.remove(), 1500);
    };

    const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return h > 0
            ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
            : m + ':' + String(s).padStart(2, '0');
    };

    const findLiveVideo = (video) => {
        if (isLiveVideo(video)) return video;
        const all = document.querySelectorAll('video');
        for (const candidate of all) {
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
            if (event.touches && event.touches.length) return { x: event.touches[0].clientX, y: event.touches[0].clientY };
            if (event.changedTouches && event.changedTouches.length) return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
            return { x: event.clientX || 0, y: event.clientY || 0 };
        };

        const clearHoldTimers = () => {
            if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
            if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
            if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
        };

        const resetHold = (notify) => {
            clearHoldTimers();
            if (!isHolding) return false;
            video.playbackRate = originalSpeed;
            isHolding = false;
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 500);
            if (notify) showSpeedNotification(originalSpeed, video, false);
            return true;
        };

        const startHold = (event) => {
            if (event.target && event.target.closest && event.target.closest('.' + CONFIG.BUTTON_CLASS)) return;
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
                showSpeedNotification(CONFIG.HOLD_SPEED, video, true);

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
            if (wasHolding && event && event.cancelable) event.preventDefault();
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
        on(window, 'pointerup', onWindowEnd, true);
        on(window, 'pointercancel', onWindowEnd, true);
        on(window, 'touchend', onWindowEnd, true);
        on(window, 'touchcancel', onWindowEnd, true);
        on(window, 'blur', () => resetHold(true), true);

        return () => {
            clearHoldTimers();
            for (const item of listeners) {
                item[0].removeEventListener(item[1], item[2], item[3]);
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
            showNotification('Пропущено до ' + formatTime(t));
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
        const handler = (event) => {
            const now = Date.now();
            if (now - lastAction < CONFIG.DEBOUNCE_TIME) return;
            lastAction = now;
            action(video, event);
        };

        button.addEventListener('pointerup', handler, true);
        button.addEventListener('touchend', handler, true);
        button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); }, true);
        button.addEventListener('touchstart', (event) => event.stopPropagation(), true);

        return button;
    };

    // ============================================================
    // Позиционирование
    // ============================================================

    const positionButtons = (video, buttons) => {
        if (!buttons || !buttons.length) return;

        if (!isLiveVideo(video)) {
            buttons.forEach((btn) => btn.remove());
            return;
        }

        // Скрываем кнопки для служебных/скрытых/мелких видео
        if (!isMeaningfulVideo(video)) {
            buttons.forEach((btn) => { btn.style.display = 'none'; });
            return;
        }

        buttons.forEach((btn) => { btn.style.display = 'flex'; });

        const r = video.getBoundingClientRect();
        const hr = getLayer().getBoundingClientRect();
        const offX = hr.left;
        const offY = hr.top;

        const count = buttons.length;
        const top = r.top + CONFIG.BUTTON_MARGIN - offY;
        const rightMost = r.right - CONFIG.BUTTON_SIZE - CONFIG.BUTTON_MARGIN - offX;

        for (let i = 0; i < count; i++) {
            const left = rightMost - (count - 1 - i) * (CONFIG.BUTTON_SIZE + CONFIG.BUTTON_GAP);
            buttons[i].style.left = Math.round(Math.max(r.left + 4 - offX, left)) + 'px';
            buttons[i].style.top = Math.round(top) + 'px';
        }
    };

    // ============================================================
    // Привязка к видео
    // ============================================================

    const attachVideo = (video) => {
        if (!(video instanceof HTMLVideoElement) || !video.isConnected || videoButtons.has(video)) return;

        // Не создаём кнопки для служебных/скрытых/мелких video
        // (повторная попытка произойдёт при периодическом сканировании)
        if (!isMeaningfulVideo(video)) return;

        const buttons = [];
        const entry = { buttons: buttons };

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

        try {
            positionButtons(video, buttons);
        } catch (e) {
            console.error('[iOS Native Player] position error:', e);
        }
    };

    const detachVideo = (video) => {
        const entry = videoButtons.get(video);
        if (!entry) return;
        entry.buttons.forEach((btn) => btn.remove());
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
            title: 'Вид кнопок и индикатора',
            items: [
                { key: 'BUTTON_RADIUS', label: 'Форма (квадрат-круг)', type: 'range', min: 0, max: 50, step: 1, suffix: '%' },
                { key: 'BUTTON_OPACITY', label: 'Прозрачность кнопок', type: 'range', min: 10, max: 100, step: 5, suffix: '%' },
                { key: 'BUTTON_BG_ALPHA', label: 'Плотность серого фона', type: 'range', min: 0, max: 100, step: 5, suffix: '%' },
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
            entry.buttons.forEach((btn) => btn.remove());
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
        const P = (name) => CONFIG.BUTTON_CLASS + '-' + name;

        const backdrop = el('div', P('panel-backdrop'));
        backdrop.addEventListener('click', closeSettings);

        const panel = el('div', P('panel'));

        const closeBtn = el('button', P('panel-close'), 'X');
        closeBtn.addEventListener('click', closeSettings);
        const header = el('div', P('panel-header'));
        header.append(el('div', P('panel-title'), 'Настройки плеера'), closeBtn);

        const body = el('div', P('panel-body'));
        const controls = {};

        SETTINGS_SCHEMA.forEach((section) => {
            const sectionEl = el('div', P('panel-section'));
            sectionEl.appendChild(el('div', P('panel-section-title'), section.title));

            section.items.forEach((item) => {
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

                    controls[item.key] = { type: 'range', el: value, slider: slider, suffix: item.suffix || '', decimals: decimals };
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

        settingsPanel = { backdrop: backdrop, panel: panel, controls: controls };
    };

    const syncPanelControls = () => {
        if (!settingsPanel) return;
        SETTINGS_SCHEMA.forEach((section) => {
            section.items.forEach((item) => {
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
        shadowProcessors.push(process);
        process();
        new MutationObserver(process).observe(shadow, { childList: true, subtree: true });
    };

    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
        const shadow = originalAttachShadow.call(this, init);
        try { processShadow(shadow); } catch (e) {}
        return shadow;
    };

    const scanShadows = (root) => {
        const doc = root || document;
        if (!doc.querySelectorAll) return;
        doc.querySelectorAll('*').forEach((el) => {
            if (el.shadowRoot) {
                processShadow(el.shadowRoot);
                scanShadows(el.shadowRoot);
            }
        });
    };

    // ============================================================
    // Сканирование, зачистка дублей, обновление позиций
    // ============================================================

    const scanVideos = (root) => {
        const doc = root || document;
        if (!doc.querySelectorAll) return;
        doc.querySelectorAll('video').forEach((video) => { if (video.isConnected) attachVideo(video); });
    };

    const sweepOrphanButtons = () => {
        const known = new Set();
        videoButtons.forEach((entry) => {
            for (const btn of entry.buttons) known.add(btn);
        });

        const nodes = document.getElementsByClassName(CONFIG.BUTTON_CLASS);
        if (!nodes.length) return;

        const list = Array.from(nodes);
        for (const node of list) {
            if (!known.has(node)) node.remove();
        }
    };

    let scheduled = false;
    const updatePositions = () => {
        if (scheduled) return;
        scheduled = true;

        requestAnimationFrame(() => {
            scheduled = false;

            videoButtons.forEach((entry, video) => {
                if (!isLiveVideo(video) || entry.buttons.some((btn) => !btn.isConnected)) {
                    detachVideo(video);
                    return;
                }
                positionButtons(video, entry.buttons);
            });

            sweepOrphanButtons();
        });
    };

    const startPeriodicTasks = () => {
        const scanEvery = Math.max(1, Math.round(CONFIG.SCAN_INTERVAL / CONFIG.POSITION_UPDATE_INTERVAL));
        let tick = 0;

        setInterval(() => {
            updatePositions();
            tick++;
            if (tick % scanEvery === 0) {
                scanVideos();
                // Повторно проверяем Shadow-корни: видео могло стать видимым
                for (const process of shadowProcessors) {
                    try { process(); } catch (e) {}
                }
            }
        }, CONFIG.POSITION_UPDATE_INTERVAL);
    };

    // ============================================================
    // DOM Observer
    // ============================================================

    new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.removedNodes.forEach((node) => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                if (node instanceof HTMLVideoElement) detachVideo(node);
                if (node.querySelectorAll) node.querySelectorAll('video').forEach(detachVideo);
            });
            mutation.addedNodes.forEach((node) => {
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

    addEventListener('resize', updatePositions, { passive: true });
    addEventListener('orientationchange', updatePositions, { passive: true });

    try {
        applyStyle();
        scanVideos();
        scanShadows();
        startPeriodicTasks();
        console.log('[iOS Native Player] v9.14 loaded OK');
    } catch (e) {
        console.error('[iOS Native Player] start error:', e);
    }

})();
