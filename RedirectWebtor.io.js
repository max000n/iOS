// ==UserScript==
// @name         Magnet → Webtor.io
// @namespace    http://tampermonkey.net/
// @version      8.1
// @description  Перехват magnet-ссылок, меню Webtor и копирование
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @match        *://*/*
// @run-at       document-start
// @sandbox      raw
// ==/UserScript==

(function(){
'use strict';

const WT='https://webtor.io/ru/',KEY='__wt_magnet__',ID='__wt_',MAXD=6;
const $=(s,p=document)=>p.querySelector(s);
const isWT=/(\.|^)webtor\.io$/i.test(location.hostname);
let bypass=false,captured=null;

function getMagnet(v){
    if(typeof v!=='string')return null;
    v=v.trim();
    if(!/^magnet:/i.test(v))return null;
    try{v=decodeURIComponent(v)}catch(_){}
    return /^magnet:/i.test(v)?v:null;
}

function scan(o,d=0,seen=new Set()){
    if(!o||d>MAXD)return null;
    if(typeof o==='string')return getMagnet(o);
    if(typeof o!=='object'&&typeof o!=='function'||seen.has(o))return null;

    seen.add(o);
    let n=0;

    for(const k of Object.keys(o)){
        if(++n>300)break;
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
    let n=el,steps=0;

    while(n&&n!==document.documentElement&&steps++<8){
        for(const k of Object.keys(n)){
            if(!k.startsWith('__react'))continue;

            try{
                const r=n[k];
                const m=scan(r?.memoizedProps)||scan(r?.pendingProps)||scan(r);
                if(m)return m;
            }catch(_){}
        }

        n=n.parentElement;
    }

    return null;
}

function domMagnet(el){
    let n=el,steps=0;

    while(n&&steps++<8){
        for(const a of n.attributes||[]){
            const m=getMagnet(a.value);
            if(m)return m;
        }

        for(const k of [
            'value','href','src','data-href','data-url',
            'data-magnet','data-link','data-magnet-url'
        ]){
            const m=getMagnet(n.getAttribute?.(k));
            if(m)return m;
        }

        const m=getMagnet(n.getAttribute?.('onclick'));
        if(m)return m;

        n=n.parentElement;
    }

    return null;
}

function parseColor(v){
    if(!v)return null;

    v=String(v).trim();

    let m=v.match(/^#([0-9a-f]{3,8})$/i);

    if(m){
        let x=m[1];

        if(x.length===3||x.length===4)
            x=x.split('').map(c=>c+c).join('');

        if(x.length===6)x+='ff';
        if(x.length!==8)return null;

        return[
            parseInt(x.slice(0,2),16),
            parseInt(x.slice(2,4),16),
            parseInt(x.slice(4,6),16),
            parseInt(x.slice(6,8),16)/255
        ];
    }

    m=v.match(
        /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,\/]\s*([\d.]+))?\s*\)$/i
    );

    if(m){
        return[
            +m[1],
            +m[2],
            +m[3],
            m[4]===undefined?1:+m[4]
        ];
    }

    m=v.match(
        /^hsla?\(\s*([\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%(?:\s*[,\/]\s*([\d.]+))?\s*\)$/i
    );

    if(m){
        let h=(+m[1]%360)/360;
        let s=+m[2]/100;
        let l=+m[3]/100;

        const f=n=>{
            const k=(n+h*12)%12;
            return l-s*Math.min(l,1-l)*Math.max(-1,Math.min(k-3,9-k,1));
        };

        return[
            Math.round(f(0)*255),
            Math.round(f(8)*255),
            Math.round(f(4)*255),
            m[4]===undefined?1:+m[4]
        ];
    }

    return null;
}

function lum(c){
    return c?.[0]*.299+c?.[1]*.587+c?.[2]*.114;
}

function themeToken(v){
    if(!v)return null;

    const s=String(v).toLowerCase();

    if(
        /(?:^|[\s_-])(?:dark|darkmode|dark-mode|theme-dark|dark-theme|is-dark|night|night-mode)(?:$|[\s_-])/.test(s)
    )return'dark';

    if(
        /(?:^|[\s_-])(?:light|lightmode|light-mode|theme-light|light-theme|is-light)(?:$|[\s_-])/.test(s)
    )return'light';

    return null;
}

function explicitTheme(){
    const els=[document.documentElement,document.body].filter(Boolean);

    const attrs=[
        'data-theme',
        'data-bs-theme',
        'data-color-scheme',
        'data-colorscheme',
        'data-mode',
        'data-color-mode',
        'data-theme-mode',
        'theme'
    ];

    for(const el of els){
        for(const a of attrs){
            const t=themeToken(el.getAttribute(a));
            if(t)return t;
        }

        const t=themeToken(el.className);
        if(t)return t;
    }

    const metas=document.querySelectorAll(
        'meta[name="color-scheme"],meta[name="theme-color"]'
    );

    for(const m of metas){
        const t=themeToken(m.content);

        if(t)return t;
    }

    return null;
}

function cssTheme(){
    const els=[document.documentElement,document.body].filter(Boolean);

    const vars=[
        '--background',
        '--bg',
        '--body-bg',
        '--page-bg',
        '--color-bg',
        '--color-background',
        '--surface',
        '--surface-color',
        '--background-color',
        '--main-bg',
        '--theme-background'
    ];

    for(const el of els){
        try{
            const cs=getComputedStyle(el);

            for(const v of vars){
                let raw=cs.getPropertyValue(v).trim();

                if(!raw)continue;

                let c=parseColor(raw);

                if(!c){
                    const z=document.createElement('span');

                    z.style.cssText=
                        `position:absolute!important;width:1px!important;height:1px!important;background:${raw}!important`;

                    el.appendChild(z);

                    c=parseColor(getComputedStyle(z).backgroundColor);

                    z.remove();
                }

                if(c&&c[3]>.5)
                    return lum(c)<128?'dark':'light';
            }
        }catch(_){}
    }

    return null;
}

function rootBackground(){
    const roots=[
        document.documentElement,
        document.body
    ].filter(Boolean);

    for(const el of roots){
        try{
            const c=parseColor(getComputedStyle(el).backgroundColor);

            if(c&&c[3]>.5)
                return c;
        }catch(_){}
    }

    return null;
}

function largeVisibleBackground(){
    const found=[];

    for(const el of document.querySelectorAll('body *')){
        try{
            const r=el.getBoundingClientRect();

            if(r.width<innerWidth*.7||r.height<innerHeight*.7)
                continue;

            const s=getComputedStyle(el);

            if(
                s.display==='none'||
                s.visibility==='hidden'||
                +s.opacity===0
            )continue;

            const c=parseColor(s.backgroundColor);

            if(!c||c[3]<.5)continue;

            const area=r.width*r.height;

            found.push({
                c,
                area,
                z:+s.zIndex||0
            });
        }catch(_){}
    }

    found.sort((a,b)=>b.area-a.area);

    if(found.length)
        return found[0].c;

    return null;
}

function cornerBackground(){
    const pts=[
        [2,2],
        [innerWidth-2,2],
        [2,innerHeight-2],
        [innerWidth-2,innerHeight-2]
    ];

    const ls=[];

    for(const p of pts){
        try{
            let e=document.elementFromPoint(...p);

            while(e){
                const s=getComputedStyle(e);
                const c=parseColor(s.backgroundColor);

                if(c&&c[3]>.5){
                    ls.push(lum(c));
                    break;
                }

                e=e.parentElement;
            }
        }catch(_){}
    }

    if(ls.length){
        ls.sort((a,b)=>a-b);
        return ls[ls.length>>1];
    }

    return null;
}

function theme(){
    const t=explicitTheme();

    if(t)return t;

    const c=cssTheme();

    if(c)return c;

    const r=rootBackground();

    if(r){
        const l=lum(r);

        if(l<115)return'dark';
        if(l>175)return'light';
    }

    const b=largeVisibleBackground();

    if(b){
        const l=lum(b);

        if(l<115)return'dark';
        if(l>175)return'light';
    }

    const q=cornerBackground();

    if(q!==null){
        if(q<115)return'dark';
        if(q>175)return'light';
    }

    try{
        const cs=getComputedStyle(document.documentElement);
        const scheme=(cs.colorScheme||'').toLowerCase();

        if(scheme.includes('dark')&&!scheme.includes('light'))
            return'dark';

        if(scheme.includes('light')&&!scheme.includes('dark'))
            return'light';
    }catch(_){}

    try{
        const m=document.querySelector('meta[name="color-scheme"]');

        if(m){
            const s=m.content.toLowerCase();

            if(s.includes('dark')&&!s.includes('light'))
                return'dark';

            if(s.includes('light')&&!s.includes('dark'))
                return'light';
        }
    }catch(_){}

    return matchMedia('(prefers-color-scheme:dark)').matches
        ?'dark'
        :'light';
}

function styles(){
    if($('#'+ID+'style'))return;

    const s=document.createElement('style');

    s.id=ID+'style';

    s.textContent=`
#${ID}overlay{
position:fixed;
inset:0;
z-index:2147483646;
background:rgba(0,0,0,.12);
backdrop-filter:blur(2px);
-webkit-backdrop-filter:blur(2px)
}
#${ID}menu{
position:fixed;
z-index:2147483647;
width:min(360px,calc(100vw - 24px));
box-sizing:border-box;
padding:8px;
border-radius:18px;
font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
box-shadow:0 14px 45px rgba(0,0,0,.25);
border:1px solid transparent;
animation:${ID}in .15s ease-out
}
#${ID}menu[data-theme=light],
#${ID}toast[data-theme=light]{
background:rgba(255,255,255,.97);
color:#171717;
border-color:rgba(0,0,0,.1);
color-scheme:light
}
#${ID}menu[data-theme=dark],
#${ID}toast[data-theme=dark]{
background:rgba(32,32,36,.97);
color:#fff;
border-color:rgba(255,255,255,.12);
color-scheme:dark
}
#${ID}title{
padding:9px 12px 7px;
font-weight:700
}
#${ID}sub{
padding:0 12px 9px;
font-size:12px;
opacity:.6
}
.${ID}btn{
width:100%;
display:flex;
align-items:center;
gap:10px;
padding:12px;
border:0;
border-radius:12px;
background:transparent;
color:inherit;
font:600 14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
text-align:left;
cursor:pointer
}
.${ID}btn:hover{
background:rgba(127,127,127,.14)
}
.${ID}btn:active{
transform:scale(.985)
}
.${ID}icon{
width:27px;
height:27px;
display:grid;
place-items:center;
flex:none;
font-size:18px
}
.${ID}txt{
flex:1
}
.${ID}desc{
display:block;
margin-top:2px;
font-size:11px;
font-weight:400;
opacity:.55
}
#${ID}toast{
position:fixed;
left:50%;
bottom:24px;
transform:translate(-50%,20px);
z-index:2147483647;
max-width:90vw;
padding:11px 16px;
border-radius:12px;
font:500 14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
text-align:center;
opacity:0;
pointer-events:none;
box-shadow:0 8px 30px rgba(0,0,0,.2);
transition:.2s
}
@keyframes ${ID}in{
from{opacity:0;transform:scale(.96) translateY(-4px)}
to{opacity:1;transform:scale(1) translateY(0)}
}`;

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

    requestAnimationFrame(()=>{
        t.style.opacity=1;
        t.style.transform='translate(-50%,0)';
    });

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

        (document.body||document.documentElement).appendChild(x);

        x.select();

        const ok=document.execCommand('copy');

        x.remove();

        return ok;
    }catch(_){
        return false;
    }
}

function button(icon,title,desc,fn){
    const b=document.createElement('button');

    b.type='button';
    b.className=ID+'btn';

    b.innerHTML=
        `<span class="${ID}icon">${icon}</span>`+
        `<span class="${ID}txt">${title}`+
        `<span class="${ID}desc">${desc}</span></span>`;

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

    m.append(
        t,
        sub,
        button(
            '🌐',
            'Открыть на Webtor.io',
            'Откроется в новой вкладке',
            ()=>openWebtor(mag)
        ),
        button(
            '📋',
            'Скопировать magnet-ссылку',
            'Скопировать в буфер обмена',
            async()=>{
                close();

                toast(
                    await copy(mag)
                    ?'Magnet-ссылка скопирована 📋'
                    :'Не удалось скопировать ссылку'
                );
            }
        )
    );

    const o=document.createElement('div');

    o.id=ID+'overlay';
    o.onclick=close;

    m.onclick=e=>e.stopPropagation();

    (document.body||document.documentElement).append(o,m);

    const r=a.getBoundingClientRect();
    const w=Math.min(360,innerWidth-24);
    const h=180;

    let x=r.left+r.width/2-w/2;
    let y=r.bottom+8;

    if(y+h>innerHeight-10)
        y=r.top-h-8;

    m.style.left=
        Math.max(12,Math.min(x,innerWidth-w-12))+'px';

    m.style.top=
        Math.max(12,y)+'px';
}

function openWebtor(mag){
    try{
        GM_setValue(KEY,mag);
    }catch(_){}

    let w=null;

    try{
        w=window.open(WT,'_blank');
    }catch(_){}

    if(!w||w.closed||typeof w.closed==='undefined')
        location.href=WT;
}

function clickable(x){
    if(!x?.tagName)return false;

    return(
        x.tagName==='BUTTON'||
        x.tagName==='A'||
        x.getAttribute?.('role')==='button'||
        x.hasAttribute?.('onclick')||
        x.hasAttribute?.('data-slot')
    );
}

function eventLink(e){
    const path=e.composedPath?.()||[];

    for(const x of path){
        if(x?.nodeType!==1)continue;

        const m=getMagnet(x.getAttribute?.('href'));

        if(m)return[x,m];

        if(!clickable(x))continue;

        const z=reactMagnet(x)||domMagnet(x);

        if(z)return[x,z];

        const s=(
            (x.title||'')+' '+
            (x.getAttribute?.('aria-label')||'')+' '+
            (x.getAttribute?.('data-testid')||'')
        ).toLowerCase();

        if(/magnet|torrent|download|скачать|магнит/.test(s))
            return[x,null];
    }

    return null;
}

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

    try{
        const ac=HTMLAnchorElement.prototype.click;

        HTMLAnchorElement.prototype.click=function(){
            const m=
                getMagnet(this.href)||
                getMagnet(this.getAttribute('href'));

            if(m){
                captured=m;
                return;
            }

            return ac.call(this);
        };
    }catch(_){}

    try{
        const lp=Location.prototype;

        for(const k of ['assign','replace']){
            const f=lp[k];

            if(typeof f!=='function')continue;

            lp[k]=function(url){
                const m=getMagnet(url);

                if(m){
                    captured=m;
                    return;
                }

                return f.call(this,url);
            };
        }
    }catch(_){}

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

        if(
            x[0].tagName!=='BUTTON'&&
            x[0].tagName!=='A'&&
            x[0].getAttribute?.('role')!=='button'&&
            !x[0].hasAttribute?.('onclick')&&
            !x[0].hasAttribute?.('data-slot')
        )return;

        captured=null;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();

        bypass=true;

        try{
            x[0].click();
        }catch(_){}

        bypass=false;

        const started=Date.now();

        const wait=setInterval(()=>{
            if(captured){
                clearInterval(wait);

                const m=captured;

                captured=null;

                showMenu(m,x[0]);
            }else if(Date.now()-started>1500){
                clearInterval(wait);
                captured=null;
            }
        },50);
    },true);

    document.addEventListener('keydown',e=>{
        if(e.key==='Escape')close();
    },true);

    addEventListener('resize',close,true);
}

if(isWT){

    let done=false;

    function pending(){
        try{
            return GM_getValue(KEY,'');
        }catch(_){
            return'';
        }
    }

    function findInput(){
        for(const x of document.querySelectorAll('input,textarea')){
            const s=(
                (x.placeholder||'')+' '+
                (x.getAttribute('aria-label')||'')+' '+
                (x.name||'')
            ).toLowerCase();

            if(/magnet|infohash/.test(s)&&x.offsetParent!==null)
                return x;
        }

        return null;
    }

    function setValue(x,v){
        const d=
            Object.getOwnPropertyDescriptor(
                Object.getPrototypeOf(x),
                'value'
            );

        d?.set?d.set.call(x,v):x.value=v;
    }

    function inject(){
        if(done)return true;

        const mag=pending();
        const x=findInput();

        if(!mag||!x)return false;

        setValue(x,mag);

        x.dispatchEvent(
            new Event('input',{bubbles:true})
        );

        x.dispatchEvent(
            new Event('change',{bubbles:true})
        );

        const form=x.closest('form');

        const bs=
            form?.querySelectorAll(
                'button,input[type=submit]'
            )||[];

        let b=null;

        for(const z of bs){
            const s=(
                z.textContent||
                z.value||
                z.getAttribute('aria-label')||
                ''
            ).toLowerCase();

            if(/найти|search|find|go|открыть/.test(s)){
                b=z;
                break;
            }
        }

        if(!b&&bs.length===1)
            b=bs[0];

        if(b){
            setTimeout(()=>b.click(),100);
        }else if(form?.requestSubmit){
            setTimeout(()=>{
                try{form.requestSubmit()}catch(_){}
            },100);
        }else{
            setTimeout(()=>{
                x.dispatchEvent(
                    new KeyboardEvent('keydown',{
                        key:'Enter',
                        code:'Enter',
                        keyCode:13,
                        which:13,
                        bubbles:true
                    })
                );
            },100);
        }

        done=true;

        try{
            GM_setValue(KEY,'');
        }catch(_){}

        return true;
    }

    let n=0;

    const timer=setInterval(()=>{
        if(inject()||++n>=100)
            clearInterval(timer);
    },250);

    addEventListener(
        'load',
        ()=>setTimeout(inject,300),
        true
    );
}

styles();

})();
