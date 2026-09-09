 // ==UserScript==
 // @name         Magnet → Webtor.io
 // @namespace    http://tampermonkey.net/
 // @version      10.0
 // @description  Magnet → Webtor + copy
 // @grant        GM_setValue
 // @grant        GM_getValue
 // @grant        GM_setClipboard
 // @match        *://*/*
 // @run-at       document-start
 // @sandbox      raw
 // ==/UserScript==

(function(){
'use strict';

const WT='https://webtor.io/ru/',KEY='__wt_magnet__',ID='__wt_';
const $=(s,p=document)=>p.querySelector(s),webtor=/(\.|^)webtor\.io$/i.test(location.hostname);
let bypass=0,captured=null;

const magnet=v=>{
    if(typeof v!=='string')return null;
    v=v.trim();
    if(!/^magnet:/i.test(v))return null;
    try{v=decodeURIComponent(v)}catch(_){}
    return /^magnet:/i.test(v)?v:null;
};

function scan(o,d=0,seen=new Set()){
    if(!o||d>6)return null;
    if(typeof o==='string')return magnet(o);
    if(typeof o!=='object'&&typeof o!=='function'||seen.has(o))return null;
    seen.add(o);
    let n=0;
    for(const k of Object.keys(o)){
        if(++n>200)break;
        try{
            const v=o[k],m=magnet(v);
            if(m)return m;
            const x=scan(v,d+1,seen);
            if(x)return x;
        }catch(_){}
    }
}

function react(el){
    for(let n=el,i=0;n&&i++<8;n=n.parentElement)
        for(const k of Object.keys(n))
            if(k.startsWith('__react'))
                try{
                    const r=n[k],m=scan(r.memoizedProps)||scan(r.pendingProps)||scan(r.memoizedState);
                    if(m)return m;
                }catch(_){}
}

function dom(el){
    for(let n=el,i=0;n&&i++<8;n=n.parentElement){
        for(const a of n.attributes||[]){
            const m=magnet(a.value);
            if(m)return m;
        }
        for(const k of ['href','value','data-href','data-url','data-magnet','data-link','data-magnet-url']){
            const m=magnet(n.getAttribute?.(k));
            if(m)return m;
        }
    }
}

function rgb(v){
    if(!v)return null;
    let m=v.match(/^#([0-9a-f]{3,8})$/i);
    if(m){
        let x=m[1];
        if(x.length<5)x=x.split('').map(c=>c+c).join('');
        if(x.length===6)x+='ff';
        if(x.length!==8)return null;
        return[parseInt(x.slice(0,2),16),parseInt(x.slice(2,4),16),parseInt(x.slice(4,6),16),parseInt(x.slice(6),16)/255];
    }
    m=v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?\s*\)$/i);
    return m?[+m[1],+m[2],+m[3],m[4]===undefined?1:+m[4]]:null;
}

function lum(c){return c[0]*.299+c[1]*.587+c[2]*.114}

function word(v){
    v=String(v||'').toLowerCase();
    if(/\b(dark|dark-mode|darkmode|theme-dark|dark-theme|is-dark|night)\b/.test(v))return'dark';
    if(/\b(light|light-mode|lightmode|theme-light|light-theme|is-light)\b/.test(v))return'light';
}

function theme(){
    const h=document.documentElement,b=document.body;

    for(const e of [h,b].filter(Boolean)){
        for(const a of ['data-theme','data-bs-theme','data-color-scheme','data-color-mode','data-mode','data-theme-mode','data-scheme']){
            const t=word(e.getAttribute(a));
            if(t)return t;
        }
        const t=word(e.className);
        if(t)return t;
    }

    try{
        const c=getComputedStyle(h).colorScheme.toLowerCase();
        if(c==='dark'||c==='only dark')return'dark';
        if(c==='light'||c==='only light')return'light';
    }catch(_){}

    const vars=['--background','--bg','--body-bg','--page-bg','--color-bg','--color-background','--background-color','--surface','--main-bg'];

    for(const e of [h,b].filter(Boolean)){
        try{
            const s=getComputedStyle(e);
            for(const v of vars){
                const c=rgb(s.getPropertyValue(v).trim());
                if(c&&c[3]>.5)return lum(c)<128?'dark':'light';
            }
        }catch(_){}
    }

    for(const e of [h,b].filter(Boolean)){
        try{
            const c=rgb(getComputedStyle(e).backgroundColor);
            if(c&&c[3]>.5){
                const l=lum(c);
                if(l<110)return'dark';
                if(l>180)return'light';
            }
        }catch(_){}
    }

    return matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';
}

function styles(){
    if($('#'+ID+'style'))return;
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
    t.dataset.theme=theme();
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
    m.dataset.theme=theme();

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

    const r=a.getBoundingClientRect(),w=Math.min(360,innerWidth-24),h=180;
    let x=r.left+r.width/2-w/2,y=r.bottom+8;
    if(y+h>innerHeight-10)y=r.top-h-8;

    m.style.left=Math.max(12,Math.min(x,innerWidth-w-12))+'px';
    m.style.top=Math.max(12,y)+'px';
}

function openWT(mag){
    try{GM_setValue(KEY,mag)}catch(_){}
    let w=null;
    try{w=window.open(WT,'_blank')}catch(_){}
    if(!w||w.closed||typeof w.closed==='undefined')location.href=WT;
}

function event(e){
    for(const x of e.composedPath?.()||[]){
        if(x?.nodeType!==1)continue;

        const m=magnet(x.getAttribute?.('href'));
        if(m)return[x,m];

        if(
            x.tagName!=='BUTTON'&&
            x.tagName!=='A'&&
            x.getAttribute?.('role')!=='button'&&
            !x.hasAttribute?.('onclick')&&
            !x.hasAttribute?.('data-slot')
        )continue;

        const z=react(x)||dom(x);
        if(z)return[x,z];

        const s=((x.title||'')+' '+(x.getAttribute?.('aria-label')||'')).toLowerCase();
        if(/magnet|магнит|torrent|скачать|download/.test(s))return[x,null];
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
        if(bypass)return;

        const x=event(e);
        if(!x)return;

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
        if(e.key==='Escape')close();
    },true);

    addEventListener('resize',close,true);
}

if(webtor){

    let done=false;

    function input(){
        for(const x of document.querySelectorAll('input,textarea')){
            const s=((x.placeholder||'')+' '+(x.getAttribute('aria-label')||'')+' '+(x.name||'')).toLowerCase();
            if(/magnet|infohash/.test(s)&&x.offsetParent!==null)return x;
        }
    }

    function inject(){
        if(done)return true;

        const mag=(()=>{try{return GM_getValue(KEY,'')}catch(_){return''}})();
        const x=input();

        if(!mag||!x)return false;

        const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(x),'value');

        d?.set?d.set.call(x,mag):x.value=mag;

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
        else setTimeout(()=>x.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true})),100);

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
