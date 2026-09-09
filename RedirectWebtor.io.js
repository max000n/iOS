// ==UserScript==
// @name         Magnet → Webtor.io
// @namespace    http://tampermonkey.net/
// @version      7.5
// @description  Magnet menu, Webtor and clipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @match        *://*/*
// @run-at       document-start
// ==/UserScript==

(function(){
'use strict';

const WT='https://webtor.io/ru/',KEY='__wt_magnet__',ID='__wt_';
const $=(s,p=document)=>p.querySelector(s);
const isWT=/(\.|^)webtor\.io$/i.test(location.hostname);
let bypass=false,captured=null;

function getMagnet(v){
    if(typeof v!=='string')return null;
    try{v=decodeURIComponent(v)}catch(_){}
    return /^magnet:/i.test(v.trim())?v.trim():null;
}

function scan(o,d=0,seen=new Set()){
    if(!o||d>7)return null;
    if(typeof o==='string')return getMagnet(o);
    if(typeof o!=='object'&&typeof o!=='function')return null;
    if(seen.has(o))return null;
    seen.add(o);

    for(const k of Object.keys(o)){
        try{
            const v=o[k],m=getMagnet(v);
            if(m)return m;
            const x=scan(v,d+1,seen);
            if(x)return x;
        }catch(_){}
    }
    return null;
}

function reactMagnet(el){
    let n=el;
    while(n&&n!==document.body){
        for(const k of Object.keys(n)){
            if(k.startsWith('__reactProps$')||k.startsWith('__reactFiber$')){
                try{
                    const m=scan(n[k]);
                    if(m)return m;
                }catch(_){}
            }
        }
        n=n.parentElement;
    }
    return null;
}

function domMagnet(el){
    let n=el;
    for(let i=0;n&&i<6;i++,n=n.parentElement){
        for(const a of n.attributes||[]){
            const m=getMagnet(a.value);
            if(m)return m;
        }
        const m=getMagnet(n.textContent);
        if(m)return m;
    }
    return null;
}

function color(s){
    const m=String(s||'').match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?/i);
    return m?[+m[1],+m[2],+m[3],m[4]===undefined?1:+m[4]]:null;
}

function lum(c){return c?.[0]*.299+c?.[1]*.587+c?.[2]*.114}

function bg(e){
    try{
        const s=getComputedStyle(e);
        const c=color(s.backgroundColor);
        if(c&&c[3]>.05)return c;
    }catch(_){}
    return null;
}

function theme(){
    const h=document.documentElement,b=document.body;
    const a=[
        h?.getAttribute('data-theme'),
        h?.getAttribute('data-color-scheme'),
        b?.getAttribute('data-theme'),
        b?.getAttribute('data-color-scheme')
    ].filter(Boolean).join(' ').toLowerCase();

    if(/\bdark\b/.test(a)&&!/\blight\b/.test(a))return'dark';
    if(/\blight\b/.test(a)&&!/\bdark\b/.test(a))return'light';

    const c=(String(h?.className||'')+' '+String(b?.className||'')).toLowerCase();

    if(/(?:^|\s)(?:dark|theme-dark|dark-mode)(?:\s|$)/.test(c))return'dark';
    if(/(?:^|\s)(?:light|theme-light|light-mode)(?:\s|$)/.test(c))return'light';

    let x=bg(b)||bg(h);
    if(x){
        const l=lum(x);
        if(l>160)return'light';
        if(l<100)return'dark';
    }

    const p=[
        [innerWidth/2,20],
        [20,innerHeight/2],
        [innerWidth-20,innerHeight/2],
        [innerWidth/2,innerHeight-20],
        [innerWidth/2,innerHeight/2]
    ],v=[];

    for(const q of p){
        try{
            let e=document.elementFromPoint(...q);
            while(e){
                x=bg(e);
                if(x){v.push(lum(x));break}
                e=e.parentElement;
            }
        }catch(_){}
    }

    if(v.length){
        v.sort((a,b)=>a-b);
        const l=v[v.length>>1];
        if(l>160)return'light';
        if(l<100)return'dark';
    }

    return'matchMedia'in window&&matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';
}

function styles(){
    if($('#'+ID+'style'))return;
    const s=document.createElement('style');
    s.id=ID+'style';
    s.textContent=`
#${ID}overlay{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.14);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
#${ID}menu{position:fixed;z-index:2147483647;width:min(360px,calc(100vw - 24px));box-sizing:border-box;padding:8px;border-radius:18px;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 14px 45px rgba(0,0,0,.25);border:1px solid transparent;animation:${ID}in .15s ease-out}
#${ID}menu[data-theme=light],#${ID}toast[data-theme=light]{background:rgba(255,255,255,.97);color:#171717;border-color:rgba(0,0,0,.1);color-scheme:light}
#${ID}menu[data-theme=dark],#${ID}toast[data-theme=dark]{background:rgba(32,32,36,.97);color:#fff;border-color:rgba(255,255,255,.12);color-scheme:dark}
#${ID}title{padding:9px 12px 7px;font-weight:700}
#${ID}sub{padding:0 12px 9px;font-size:12px;opacity:.6}
.${ID}btn{width:100%;display:flex;align-items:center;gap:10px;padding:12px;border:0;border-radius:12px;background:transparent;color:inherit;font:600 14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:left;cursor:pointer}
.${ID}btn:hover{background:rgba(127,127,127,.14)}
.${ID}btn:active{transform:scale(.985)}
.${ID}icon{width:27px;height:27px;display:grid;place-items:center;flex:none;font-size:18px}
.${ID}txt{flex:1}
.${ID}desc{display:block;margin-top:2px;font-size:11px;font-weight:400;opacity:.55}
#${ID}toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);z-index:2147483647;max-width:90vw;padding:11px 16px;border-radius:12px;font:500 14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;opacity:0;pointer-events:none;box-shadow:0 8px 30px rgba(0,0,0,.2);transition:.2s}
@keyframes ${ID}in{from{opacity:0;transform:scale(.96) translateY(-4px)}to{opacity:1;transform:scale(1) translateY(0)}}`;
    (document.head||document.documentElement).appendChild(s);
}

function close(){
    $('#'+ID+'menu')?.remove();
    $('#'+ID+'overlay')?.remove();
}

function toast(text){
    $('#'+ID+'toast')?.remove();
    const t=document.createElement('div');
    t.id=ID+'toast';
    t.dataset.theme=theme();
    t.textContent=text;
    (document.body||document.documentElement).appendChild(t);
    requestAnimationFrame(()=>{t.style.opacity=1;t.style.transform='translate(-50%,0)'});
    setTimeout(()=>{
        if(!t.isConnected)return;
        t.style.opacity=0;
        t.style.transform='translate(-50%,20px)';
        setTimeout(()=>t.remove(),220);
    },2200);
}

async function copy(text){
    try{
        if(typeof GM_setClipboard==='function'){
            GM_setClipboard(text,'text');
            return true;
        }
    }catch(_){}
    try{
        await navigator.clipboard.writeText(text);
        return true;
    }catch(_){}
    try{
        const x=document.createElement('textarea');
        x.value=text;
        x.style.cssText='position:fixed;left:-9999px';
        document.body.appendChild(x);
        x.select();
        const ok=document.execCommand('copy');
        x.remove();
        return ok;
    }catch(_){return false}
}

function button(icon,title,desc,fn){
    const b=document.createElement('button');
    b.type='button';
    b.className=ID+'btn';
    b.innerHTML=`<span class="${ID}icon">${icon}</span><span class="${ID}txt">${title}<span class="${ID}desc">${desc}</span></span>`;
    b.onclick=e=>{
        e.preventDefault();
        e.stopPropagation();
        fn();
    };
    return b;
}

function showMenu(mag,a){
    if(!mag)return;
    close();
    styles();

    const m=document.createElement('div');
    m.id=ID+'menu';
    m.dataset.theme=theme();

    const t=document.createElement('div');
    t.id=ID+'title';
    t.textContent='Magnet-ссылка';

    const sub=document.createElement('div');
    sub.id=ID+'sub';
    sub.textContent='Что сделать с этой ссылкой?';

    m.append(t,sub);

    m.appendChild(button(
        '🌐',
        'Открыть на Webtor.io',
        'Откроется в новой вкладке',
        ()=>openWebtor(mag)
    ));

    m.appendChild(button(
        '📋',
        'Скопировать magnet-ссылку',
        'Скопировать в буфер обмена',
        async()=>{
            close();
            toast(await copy(mag)?'Magnet-ссылка скопирована 📋':'Не удалось скопировать ссылку');
        }
    ));

    const o=document.createElement('div');
    o.id=ID+'overlay';
    o.onclick=close;

    m.onclick=e=>e.stopPropagation();

    (document.body||document.documentElement).append(o,m);

    const r=a.getBoundingClientRect(),w=Math.min(360,innerWidth-24),h=180;
    let x=r.left+r.width/2-w/2,y=r.bottom+8;

    if(y+h>innerHeight-10)y=r.top-h-8;

    m.style.left=Math.max(12,Math.min(x,innerWidth-w-12))+'px';
    m.style.top=Math.max(12,y)+'px';
}

function openWebtor(mag){
    try{GM_setValue(KEY,mag)}catch(_){}
    let w=null;
    try{w=window.open(WT,'_blank')}catch(_){}
    if(!w||w.closed||typeof w.closed==='undefined')location.href=WT;
}

function eventLink(e){
    if(e.composedPath){
        for(const x of e.composedPath()){
            if(x?.nodeType!==1)continue;

            const m=getMagnet(x.getAttribute?.('href'));
            if(m)return[x,m];

            if(x.tagName==='BUTTON'){
                const z=reactMagnet(x)||domMagnet(x);
                if(z)return[x,z];

                if(
                    x.title?.toLowerCase().includes('magnet')||
                    /magnet/i.test(x.getAttribute?.('aria-label')||'')
                )return[x,null];
            }
        }
    }

    return null;
}

/* Перехват magnet, если сайт открывает его через JS */
if(!isWT){
    const ow=window.open;
    window.open=function(url,...args){
        const m=getMagnet(url);
        if(m){
            captured=m;
            return null;
        }
        return ow.call(this,url,...args);
    };

    document.addEventListener('click',e=>{
        if(bypass)return;

        const x=eventLink(e);
        if(!x)return;

        if(x[1]){
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            showMenu(x[1],x[0]);
            return;
        }

        if(x[0].tagName!=='BUTTON')return;

        captured=null;

        setTimeout(()=>{
            if(captured){
                showMenu(captured,x[0]);
                captured=null;
            }
        },0);

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();

        bypass=true;
        try{x[0].click()}catch(_){}
        bypass=false;
    },true);

    document.addEventListener('keydown',e=>{
        if(e.key==='Escape')close();
    },true);

    addEventListener('resize',close,true);
}

/* Webtor */
if(isWT){
    let done=false;

    function pending(){
        try{return GM_getValue(KEY,'')}catch(_){return''}
    }

    function findInput(){
        for(const x of document.querySelectorAll('input,textarea')){
            const s=((x.placeholder||'')+' '+(x.getAttribute('aria-label')||'')+' '+(x.name||'')).toLowerCase();
            if(/magnet|infohash/.test(s)&&x.offsetParent!==null)return x;
        }
        return null;
    }

    function setValue(x,v){
        const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(x),'value');
        d?.set?d.set.call(x,v):x.value=v;
    }

    function inject(){
        if(done)return true;

        const mag=pending(),x=findInput();
        if(!mag||!x)return false;

        setValue(x,mag);
        x.dispatchEvent(new Event('input',{bubbles:true}));
        x.dispatchEvent(new Event('change',{bubbles:true}));

        const form=x.closest('form');
        const bs=form?.querySelectorAll('button,input[type=submit]')||[];
        let b=null;

        for(const z of bs){
            const s=(z.textContent||z.value||z.getAttribute('aria-label')||'').toLowerCase();
            if(/найти|search|find|go|открыть/.test(s)){b=z;break}
        }

        if(!b&&bs.length===1)b=bs[0];

        if(b)setTimeout(()=>b.click(),100);
        else if(form?.requestSubmit)setTimeout(()=>{try{form.requestSubmit()}catch(_){}},100);
        else setTimeout(()=>x.dispatchEvent(new KeyboardEvent('keydown',{
            key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true
        })),100);

        done=true;
        try{GM_setValue(KEY,'')}catch(_){}
        return true;
    }

    let n=0;
    const timer=setInterval(()=>{
        if(inject()||++n>=100)clearInterval(timer);
    },250);

    addEventListener('load',()=>setTimeout(inject,300),true);
}

styles();

})();
