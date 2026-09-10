// ==UserScript==
// @name         Magnet → Webtor.io
// @namespace    http://tampermonkey.net/
// @version      10.2
// @description  Magnet → Webtor + copy (Fixed theme detection & React injection)
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @match        *://*/*
// @run-at       document-start
// @sandbox      raw
// ==/UserScript==

(function(){
'use strict';

const WT='https://webtor.io/ru/', KEY='__wt_magnet__', ID='__wt_';
const $=(s,p=document)=>p.querySelector(s);
const webtor=/(\.|^)webtor\.io$/i.test(location.hostname);
let bypass=0, captured=null;

const magnet=v=>{
    if(typeof v!=='string') return null;
    v=v.trim();
    if(!/^magnet:/i.test(v)) return null;
    try{v=decodeURIComponent(v)}catch(_){}
    return /^magnet:/i.test(v)?v:null;
};

function scan(o,d=0,seen=new Set()){
    if(!o||d>6) return null;
    if(typeof o==='string') return magnet(o);
    if(typeof o!=='object'&&typeof o!=='function'||seen.has(o)) return null;
    seen.add(o);
    let n=0;
    for(const k of Object.keys(o)){
        if(++n>200) break;
        try{
            const v=o[k], m=magnet(v);
            if(m) return m;
            const x=scan(v,d+1,seen);
            if(x) return x;
        }catch(_){}
    }
}

function react(el){
    for(let n=el,i=0;n&&i++<8;n=n.parentElement){
        for(const k of Object.keys(n)){
            if(k.startsWith('__react')){
                try{
                    const r=n[k];
                    const m=scan(r.memoizedProps)||scan(r.pendingProps)||scan(r.memoizedState);
                    if(m) return m;
                }catch(_){}
            }
        }
    }
}

function dom(el){
    for(let n=el,i=0;n&&i++<8;n=n.parentElement){
        for(const a of n.attributes||[]){
            const m=magnet(a.value);
            if(m) return m;
        }
        for(const k of ['href','value','data-href','data-url','data-magnet','data-link','data-magnet-url']){
            const m=magnet(n.getAttribute?.(k));
            if(m) return m;
        }
    }
}

function rgb(v){
    if(!v) return null;
    v=v.trim().toLowerCase();
    if(v==='transparent') return [0,0,0,0];
    
    let m=v.match(/^#([0-9a-f]{3,8})$/i);
    if(m){
        let x=m[1];
        if(x.length<5) x=x.split('').map(c=>c+c).join('');
        if(x.length===6) x+='ff';
        if(x.length!==8) return null;
        return [
            parseInt(x.slice(0,2),16),
            parseInt(x.slice(2,4),16),
            parseInt(x.slice(4,6),16),
            parseInt(x.slice(6),16)/255
        ];
    }
    m=v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?\s*\)$/i);
    return m ? [+m[1], +m[2], +m[3], m[4]===undefined?1:+m[4]] : null;
}

function lum(c){ return c[0]*.299 + c[1]*.587 + c[2]*.114; }

function theme(targetEl){
    const h=document.documentElement, b=document.body;

    for(const e of [h,b].filter(Boolean)){
        for(const a of ['data-theme','data-bs-theme','data-color-scheme','data-color-mode','data-mode','data-theme-mode','data-scheme']){
            const val=e.getAttribute(a);
            if(val){
                const v=val.toLowerCase();
                if(v.includes('dark')) return 'dark';
                if(v.includes('light')) return 'light';
            }
        }
    }

    for(const e of [h,b].filter(Boolean)){
        if(!e.className) continue;
        const cls=e.className.toLowerCase();
        const hasDark=/\b(dark|dark-mode|theme-dark)\b/.test(cls);
        const hasLight=/\b(light|light-mode|theme-light)\b/.test(cls);
        if(hasDark && !hasLight) return 'dark';
        if(hasLight && !hasDark) return 'light';
    }

    try{
        const cs=getComputedStyle(h).colorScheme.toLowerCase();
        if(cs.includes('dark')) return 'dark';
        if(cs.includes('light')) return 'light';
    }catch(_){}

    const elementsToCheck=[h,b];
    if(targetEl){
        let curr=targetEl;
        for(let i=0;i<6 && curr;i++){
            elementsToCheck.push(curr);
            curr=curr.parentElement;
        }
    }

    const vars=['--background','--bg','--body-bg','--page-bg','--color-bg','--color-background','--background-color','--surface','--main-bg','--color-surface'];

    for(const e of elementsToCheck){
        try{
            const style=getComputedStyle(e);
            for(const v of vars){
                const val=style.getPropertyValue(v).trim();
                if(val){
                    const c=rgb(val);
                    if(c && c[3]>0.5) return lum(c)<128?'dark':'light';
                }
            }
            const bgColor=style.backgroundColor;
            if(bgColor && bgColor!=='rgba(0, 0, 0, 0)' && bgColor!=='transparent'){
                const c=rgb(bgColor);
                if(c && c[3]>0.5){
                    const l=lum(c);
                    if(l<128) return 'dark';
                    if(l>128) return 'light';
                }
            }
        }catch(_){}
    }

    return matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
}

function styles(){
    if($('#'+ID+'style')) return;
    const s=document.createElement('style');
    s.id=ID+'style';
    s.textContent=`
#${ID}overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.12);backdrop-filter:blur(2px)}
#${ID}menu{position:fixed;z-index:2147483647;width:min(360px,calc(100vw - 24px));box-sizing:border-box;padding:8px;border-radius:18px;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 14px 45px #0004;border:1px solid transparent;animation:${ID}in .15s ease-out}
#${ID}menu[data-theme=light],#${ID}toast[data-theme=light]{background:#fffffff7;color:#171717;border-color:#0002;color-scheme:light}
#${ID}menu[data-theme=dark],#${ID}toast[data-theme=dark]{background:#202024f7;color:#fff;border-color:#fff2;color-scheme:dark}
#${ID}title{padding:9px 12px 7px;font-weight:700}
#${ID}sub{padding:0 12px 9px;font-size:12px;opacity:.6}
.${ID}btn{width:100%;display:flex;align-items:center;gap:10px;padding:12px;border:0;border-radius:12px;background:transparent;color:inherit;font:600 14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:left;cursor:pointer}
.${ID}btn:hover{background:#8882}.${ID}btn:active{transform:scale(.985)}
.${ID}icon{width:27px;height:27px;display:grid;place-items:center;flex:none;font-size:18px}
.${ID}txt{flex:1}.${ID}desc{display:block;margin-top:2px;font-size:11px;font-weight:400;opacity:.55}
#${ID}toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);z-index:2147483647;max-width:90vw;padding:11px 16px;border-radius:12px;font:500 14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;opacity:0;pointer-events:none;box-shadow:0 8px 30px #0003;transition:.2s}
@keyframes ${ID}in{from{opacity:0;transform:scale(.96) translateY(-4px)}to{opacity:1;transform:scale(1) translateY(0)}}`;
    (document.head||document.documentElement).appendChild(s);
}

function close(){
    $('#'+ID+'menu')?.remove();
    $('#'+ID+'overlay')?.remove();
}

async function copy(v){
    try{
        if(typeof GM_setClipboard==='function'){
            GM_setClipboard(v,'text');
            return true;
        }
        await navigator.clipboard.writeText(v);
        return true;
    }catch(_){
        try{
            const x=document.createElement('textarea');
            x.value=v;
            x.style.cssText='position:fixed;left:-9999px';
            document.body.appendChild(x);
            x.select();
            const ok=document.execCommand('copy');
            x.remove();
            return ok;
        }catch(_){return false}
    }
}

function toast(text){
    $('#'+ID+'toast')?.remove();
    const t=document.createElement('div');
    t.id=ID+'toast';
    t.dataset.theme=theme(document.body);
    t.textContent=text;
    document.body.appendChild(t);
    requestAnimationFrame(()=>{t.style.opacity=1;t.style.transform='translate(-50%,0)'});
    setTimeout(()=>{if(t.isConnected){t.style.opacity=0;t.style.transform='translate(-50%,20px)';setTimeout(()=>t.remove(),220)}},2200);
}

function btn(icon,title,desc,fn){
    const b=document.createElement('button');
    b.type='button';
    b.className=ID+'btn';
    b.innerHTML=`<span class="${ID}icon">${icon}</span><span class="${ID}txt">${title}<span class="${ID}desc">${desc}</span></span>`;
    b.onclick=e=>{e.preventDefault();e.stopPropagation();fn()};
    return b;
}

function menu(mag,a){
    close();
    const m=document.createElement('div');
    m.id=ID+'menu';
    m.dataset.theme=theme(a);

    const t=document.createElement('div');
    t.id=ID+'title';
    t.textContent='Magnet-ссылка';

    const sub=document.createElement('div');
    sub.id=ID+'sub';
    sub.textContent='Что сделать с этой ссылкой?';

    m.append(
        t,sub,
        btn('🌐','Открыть на Webtor.io','Откроется в новой вкладке',()=>openWT(mag)),
        btn('📋','Скопировать magnet-ссылку','Скопировать в буфер обмена',async()=>{close();toast(await copy(mag)?'Magnet-ссылка скопирована 📋':'Не удалось скопировать ссылку')})
    );

    const o=document.createElement('div');
    o.id=ID+'overlay';
    o.onclick=close;
    m.onclick=e=>e.stopPropagation();

    document.body.append(o,m);

    const rect=m.getBoundingClientRect();
    const h=rect.height;
    const w=rect.width;
    const r=a.getBoundingClientRect();
    
    let x=r.left+r.width/2-w/2;
    let y=r.bottom+8;
    
    if(y+h>innerHeight-10) y=r.top-h-8;

    m.style.left=Math.max(12,Math.min(x,innerWidth-w-12))+'px';
    m.style.top=Math.max(12,y)+'px';
}

function openWT(mag){
    try{GM_setValue(KEY,mag)}catch(_){}
    let w=null;
    try{w=window.open(WT,'_blank')}catch(_){}
    if(!w||w.closed||typeof w.closed==='undefined') location.href=WT;
}

function event(e){
    for(const x of e.composedPath?.()||[]){
        if(x?.nodeType!==1) continue;

        const m=magnet(x.getAttribute?.('href'));
        if(m) return [x,m];

        if(
            x.tagName!=='BUTTON'&&
            x.tagName!=='A'&&
            x.getAttribute?.('role')!=='button'&&
            !x.hasAttribute?.('onclick')&&
            !x.hasAttribute?.('data-slot')
        ) continue;

        const z=react(x)||dom(x);
        if(z) return [x,z];

        const s=((x.title||'')+' '+(x.getAttribute?.('aria-label')||'')).toLowerCase();
        if(/magnet|магнит|torrent|скачать|download/.test(s)) return [x,null];
    }
}

if(!webtor){
    const ow=window.open;
    window.open=function(url,...args){
        const m=magnet(url);
        if(m){captured=m;return null}
        return ow.call(this,url,...args);
    };

    try{
        const ac=HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click=function(){
            const m=magnet(this.href)||magnet(this.getAttribute('href'));
            if(m){captured=m;return}
            return ac.call(this);
        };
    }catch(_){}

    document.addEventListener('click',e=>{
        if(bypass) return;
        const x=event(e);
        if(!x) return;

        if(x[1]){
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            menu(x[1],x[0]);
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();

        captured=null;
        bypass=1;
        try{x[0].click()}catch(_){}
        bypass=0;

        const start=Date.now();
        const timer=setInterval(()=>{
            if(captured){
                clearInterval(timer);
                const m=captured;
                captured=null;
                menu(m,x[0]);
            }else if(Date.now()-start>1500){
                clearInterval(timer);
            }
        },50);
    },true);

    document.addEventListener('keydown',e=>{
        if(e.key==='Escape') close();
    },true);

    addEventListener('resize',close,true);
}

if(webtor){
    function getInput(){
        // 1. Ищем по ключевым словам в атрибутах
        const inputs = document.querySelectorAll('input[type="text"], input:not([type]), textarea');
        for(const x of inputs){
            if(x.offsetParent !== null && !x.disabled && !x.readOnly){
                const s = ((x.placeholder||'') + ' ' + (x.getAttribute('aria-label')||'') + ' ' + (x.name||'') + ' ' + (x.id||'')).toLowerCase();
                if(/magnet|infohash|torrent|url|link|search|встав|paste/.test(s)) return x;
            }
        }
        // 2. Фоллбэк: первое видимое текстовое поле (если страница простая)
        for(const x of inputs){
            if(x.offsetParent !== null && !x.disabled && !x.readOnly) return x;
        }
        return null;
    }

    function inject(){
        const mag = (() => { try { return GM_getValue(KEY, ''); } catch(_) { return ''; } })();
        if (!mag) return false; // Нет ссылки в хранилище, останавливаем попытки

        const x = getInput();
        if (!x) return false; // Поле ввода еще не отрисовано, ждем следующей итерации

        // 1. Надежный способ установки значения для React/Vue (обход контроля состояния)
        const tracker = x._valueTracker;
        if (tracker) tracker.setValue(mag);
        
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(x, mag);
        } else {
            x.value = mag;
        }

        // 2. Генерация событий для активации фреймворков
        x.dispatchEvent(new Event('focus', { bubbles: true }));
        x.dispatchEvent(new Event('input', { bubbles: true }));
        x.dispatchEvent(new Event('change', { bubbles: true }));

        // 3. Поиск кнопки отправки
        const form = x.closest('form');
        const bs = form?.querySelectorAll('button, input[type=submit], div[role="button"]') || [];
        let b = null;

        for(const z of bs){
            const s = (z.textContent || z.value || z.getAttribute('aria-label') || '').toLowerCase();
            if(/найти|search|find|go|открыть|start|download|скачать/.test(s)){
                b = z;
                break;
            }
        }

        if(!b && bs.length === 1) b = bs[0];

        // 4. Задержка перед кликом для гарантии обработки событий фреймворком (увеличена до 300мс)
        setTimeout(() => {
            if(b) {
                b.click();
            } else if(form?.requestSubmit) {
                try { form.requestSubmit(); } catch(_) {}
            } else {
                x.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            }
        }, 300);

        // 5. Очистка хранилища, чтобы не повторять действие
        try { GM_setValue(KEY, ''); } catch(_) {}
        
        return true; // Успех, останавливаем таймер
    }

    let n = 0;
    const timer = setInterval(() => {
        if(inject() || ++n >= 100) { // 100 попыток * 250мс = 25 секунд макс.
            clearInterval(timer);
        }
    }, 250);

    // Дополнительный триггер при полной загрузке страницы
    addEventListener('load', () => {
        setTimeout(inject, 500);
    }, true);
}

styles();
})();
