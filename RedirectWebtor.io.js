// ==UserScript==
// @name         Redirect Magnet Links to Webtor.io (new tab)
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Opens magnet links on webtor.io in a new tab (fallback to same tab if popup blocked).
// @author       canary_in_a_coleslaw-ChatGPT
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function openWebtor(magnetHref) {
        // Ищем 40-символьный хеш (регистронезависимо)
        const match = magnetHref.match(/[A-F0-9]{40}/i);
        if (!match) {
            // Если хеша нет – не делаем ничего, чтобы не вызвать ошибку
            return;
        }
        const hash = match[0].toLowerCase();
        const webtorUrl = 'https://webtor.io/' + hash;

        // Пытаемся открыть в новой вкладке
        const newWin = window.open(webtorUrl, '_blank');
        if (!newWin || newWin.closed || typeof newWin.closed === 'undefined') {
            // Если всплывающее окно заблокировано – открываем в текущей вкладке
            location.href = webtorUrl;
        }
    }

    document.addEventListener('click', function(e) {
        const link = e.target.closest('a');
        if (!link) return;
        const href = link.getAttribute('href'); // используем getAttribute, чтобы получить原始ный href
        if (!href || !href.startsWith('magnet:')) return;

        e.preventDefault();
        e.stopPropagation(); // предотвращаем другие обработчики
        openWebtor(href);
    }, true); // true – перехват на фазе захвата
})();
