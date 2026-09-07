// ==UserScript==
// @name         Redirect Magnet Links to Webtor.io (new tab)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Opens magnet links on webtor.io in a new tab.
// @author       canary_in_a_coleslaw-ChatGPT
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    document.addEventListener('click', function(e) {
        const clickedEl = e.target.closest('a');
        if (!clickedEl) return;
        const href = clickedEl.href;
        if (!href.startsWith('magnet:')) return;

        e.preventDefault(); // отменяем стандартное поведение

        // Ищем хеш (40 символов A-F0-9)
        const match = href.match(/[A-F0-9]{40}/i);
        if (!match) {
            // если хеш не найден, просто открываем magnet как есть (бесполезно)
            window.open(href, '_blank');
            return;
        }
        const hash = match[0].toLowerCase();
        const webtorUrl = 'https://webtor.io/' + hash;
        window.open(webtorUrl, '_blank');
    }, true);
})();