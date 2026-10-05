// HTML pages in Create (loaded when needed by create.js).
//   - bundle(): a folder or .zip (an .html file plus its images, styles, scripts and fonts) becomes ONE self-contained
//     page: styles and scripts are written into it and pictures/fonts become data: links. So a page is always a single
//     file to keep, version, view and hand to Claude.
//   - frame(): shows a page in a sealed frame (sandboxed, no same-origin): its own code runs (charts, buttons), but it
//     can't see Hamid OS, your sign-in or your data. "Safe view" turns its code off completely.
//   - textOf(): the words on the page, so it can be searched and read by Claude.
//   - editable(): the page's text and layout as a normal document (headings, lists, tables, links; not its code).
(function () {
  'use strict';
  const MIME = { html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', txt: 'text/plain', csv: 'text/csv', vtt: 'text/vtt' };
  const ext = p => ((p || '').match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  const isExternal = r => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(r) || !r.trim();

  // a path inside the upload, relative to the file that mentions it
  function resolve(fromFile, ref) {
    let r = ref.trim().split('#')[0].split('?')[0];
    try { r = decodeURI(r); } catch (e) {}
    const parts = r.startsWith('/') ? [] : fromFile.split('/').slice(0, -1);
    for (const seg of r.replace(/^\/+/, '').split('/')) {
      if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  }

  /* ---------- bundling ---------- */
  // files: [{ path: 'site/index.html', blob }]. Returns { html, entry, inlined, missing, pages }.
  async function bundle(files) {
    // drop the common top folder ("my-site/…") and junk like __MACOSX
    files = files.filter(f => !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(f.path));
    const tops = new Set(files.map(f => f.path.split('/')[0]));
    if (tops.size === 1 && files.every(f => f.path.includes('/'))) files = files.map(f => ({ ...f, path: f.path.split('/').slice(1).join('/') }));
    const map = new Map(), lower = new Map();
    files.forEach(f => { map.set(f.path, f.blob); lower.set(f.path.toLowerCase(), f.path); });
    const find = p => (map.has(p) ? p : lower.get(p.toLowerCase()) || null);
    const pages = files.map(f => f.path).filter(p => /\.html?$/i.test(p)).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    if (!pages.length) throw new Error('There’s no .html file in it.');
    const entry = pages.find(p => /(^|\/)index\.html?$/i.test(p) && p.split('/').length === pages[0].split('/').length) || pages[0];

    const missing = new Set(); let inlined = 0;
    const cacheData = new Map(), cacheText = new Map();
    const dataUrl = async p => {
      if (cacheData.has(p)) return cacheData.get(p);
      const b = map.get(p), type = MIME[ext(p)] || b.type || 'application/octet-stream';
      const url = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^;,]*/, 'data:' + type)); r.onerror = bad; r.readAsDataURL(b); });
      cacheData.set(p, url); return url;
    };
    const text = async p => { if (!cacheText.has(p)) cacheText.set(p, await map.get(p).text()); return cacheText.get(p); };
    // a reference from one file to another → its data: link (or left alone if it's on the web or not in the upload)
    const asData = async (from, ref) => {
      if (isExternal(ref)) return ref;
      const p = find(resolve(from, ref));
      if (!p) { missing.add(resolve(from, ref)); return ref; }
      inlined++;
      return dataUrl(p);
    };
    const css = async (from, src, depth = 0) => {
      let out = src;
      // @import of local stylesheets: written in place
      const imports = [...out.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?([^;]*);/gi)];
      for (const m of imports) {
        if (isExternal(m[1]) || depth > 4) continue;
        const p = find(resolve(from, m[1]));
        if (!p) { missing.add(resolve(from, m[1])); continue; }
        inlined++;
        const inner = await css(p, await text(p), depth + 1);
        out = out.replace(m[0], m[2] && m[2].trim() ? `@media ${m[2].trim()}{${inner}}` : inner);
      }
      const urls = [...out.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)];
      for (const m of urls) {
        if (isExternal(m[2])) continue;
        out = out.split(m[0]).join(`url("${await asData(from, m[2])}")`);
      }
      return out;
    };
    const srcset = async (from, v) => (await Promise.all(v.split(',').map(async part => {
      const [u, ...rest] = part.trim().split(/\s+/); return u ? [await asData(from, u), ...rest].join(' ') : '';
    }))).filter(Boolean).join(', ');

    const doc = new DOMParser().parseFromString(await text(entry), 'text/html');
    for (const l of [...doc.querySelectorAll('link[rel~="stylesheet"][href]')]) {
      const href = l.getAttribute('href');
      if (isExternal(href)) continue;
      const p = find(resolve(entry, href));
      if (!p) { missing.add(resolve(entry, href)); continue; }
      inlined++;
      const st = doc.createElement('style');
      if (l.getAttribute('media')) st.setAttribute('media', l.getAttribute('media'));
      st.textContent = await css(p, await text(p));
      l.replaceWith(st);
    }
    for (const st of doc.querySelectorAll('style')) st.textContent = await css(entry, st.textContent);
    for (const s of doc.querySelectorAll('script[src]')) {
      const src = s.getAttribute('src');
      if (isExternal(src)) continue;
      const p = find(resolve(entry, src));
      if (!p) { missing.add(resolve(entry, src)); continue; }
      inlined++;
      s.removeAttribute('src');
      s.textContent = (await text(p)).replace(/<\/(script)/gi, '<\\/$1');
    }
    const ATTRS = [['img', 'src'], ['source', 'src'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'], ['track', 'src'], ['embed', 'src'],
      ['object', 'data'], ['input[type="image"]', 'src'], ['link[rel~="icon"]', 'href'], ['link[rel="apple-touch-icon"]', 'href'], ['image', 'href'], ['image', 'xlink:href']];
    for (const [sel, attr] of ATTRS) {
      for (const n of doc.querySelectorAll(`${sel}[${attr.replace(':', '\\:')}]`)) n.setAttribute(attr, await asData(entry, n.getAttribute(attr)));
    }
    for (const n of doc.querySelectorAll('img[srcset], source[srcset]')) n.setAttribute('srcset', await srcset(entry, n.getAttribute('srcset')));
    for (const n of doc.querySelectorAll('[style*="url("]')) n.setAttribute('style', await css(entry, n.getAttribute('style')));
    // other pages in the upload can't be linked to from one page; note them
    const others = pages.filter(p => p !== entry);
    const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    return { html, entry, inlined, missing: [...missing].slice(0, 20), pages: others };
  }

  /* ---------- reading ---------- */
  function textOf(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    doc.querySelectorAll('script,style,noscript,template,svg').forEach(n => n.remove());
    const t = (doc.body ? doc.body.innerText || doc.body.textContent : '') || '';
    return t.replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  const titleIn = html => { const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || ''); return m ? new DOMParser().parseFromString(m[1], 'text/html').documentElement.textContent.trim().slice(0, 200) : ''; };

  // the page as a normal document: text, headings, lists, tables, links (no code, styles or pictures)
  function editable(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    doc.querySelectorAll('script,style,noscript,template,link,meta,iframe,object,embed,canvas,svg,video,audio,form,input,button,select,textarea,img,picture,nav,footer').forEach(n => n.remove());
    const keep = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'STRONG', 'B', 'EM', 'I', 'U', 'BR', 'BLOCKQUOTE', 'HR', 'CODE', 'PRE']);
    const walk = n => {
      for (const c of [...n.children]) {
        walk(c);
        if (!keep.has(c.tagName)) {
          // a box (div, section…) becomes its contents; a box holding only text becomes a paragraph
          const onlyText = ![...c.children].some(k => /^(P|H\d|UL|OL|TABLE|BLOCKQUOTE|PRE|HR)$/.test(k.tagName));
          if (onlyText && c.textContent.trim() && /^(DIV|SECTION|ARTICLE|HEADER|MAIN|ASIDE|FIGURE|FIGCAPTION|LABEL|DD|DT)$/.test(c.tagName)) {
            const p = doc.createElement('p'); p.append(...c.childNodes); c.replaceWith(p);
          } else c.replaceWith(...c.childNodes);
        } else {
          for (const a of [...c.attributes]) if (!(c.tagName === 'A' && a.name === 'href')) c.removeAttribute(a.name);
          if (c.tagName === 'A' && !/^https?:|^mailto:/i.test(c.getAttribute('href') || '')) c.replaceWith(...c.childNodes);
        }
      }
    };
    if (!doc.body) return '<p></p>';
    walk(doc.body);
    return doc.body.innerHTML.replace(/\n\s*\n/g, '\n').trim() || '<p></p>';
  }

  /* ---------- showing ---------- */
  const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock allow-presentation';
  // runs first inside the page: storage that works in the sealed frame (kept while it's open), and web links open in a new tab
  const SHIM = '<script>(function(){function m(){var s={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(s,k)?s[k]:null},setItem:function(k,v){s[k]=String(v)},removeItem:function(k){delete s[k]},clear:function(){s={}},key:function(i){return Object.keys(s)[i]||null},get length(){return Object.keys(s).length}}}'
    + 'try{window.localStorage.getItem("_")}catch(e){try{Object.defineProperty(window,"localStorage",{value:m(),configurable:true})}catch(_){}}'
    + 'try{window.sessionStorage.getItem("_")}catch(e){try{Object.defineProperty(window,"sessionStorage",{value:m(),configurable:true})}catch(_){}}'
    + 'document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(a&&/^https?:/i.test(a.getAttribute("href"))&&!a.target)a.target="_blank"},true)})();<\/script>';
  function prepared(html, safe) {
    if (safe) return html;
    // put the shim at the very start of <head> (or of the page)
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + SHIM);
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, m => m + SHIM);
    return SHIM + html;
  }
  function frame(html, { safe = false, title = 'HTML page' } = {}) {
    const f = document.createElement('iframe');
    f.className = 'cr-hframe';
    f.setAttribute('sandbox', safe ? '' : SANDBOX);
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('allow', 'fullscreen; clipboard-write');
    f.title = title;
    f.srcdoc = prepared(html, safe);
    return f;
  }
  // a new tab holding just a sealed frame (the tab itself has none of the page's code)
  function openTab(html, title, safe) {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const wrap = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>`
      + '<style>html,body{margin:0;height:100%;background:#fff}iframe{border:0;width:100%;height:100%;display:block}</style></head><body>'
      + `<iframe sandbox="${safe ? '' : SANDBOX}" allow="fullscreen; clipboard-write" title="${esc(title)}" srcdoc="${esc(prepared(html, safe))}"></iframe></body></html>`;
    const url = URL.createObjectURL(new Blob([wrap], { type: 'text/html' }));
    const w = window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return !!w || true;
  }

  // a zip → [{ path, blob }]
  async function unzip(file, loadScript) {
    if (!window.JSZip) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    const zip = await window.JSZip.loadAsync(file);
    const out = [];
    for (const e of Object.values(zip.files)) if (!e.dir) out.push({ path: e.name, blob: await e.async('blob') });
    return out;
  }

  window.CreateHTML = { bundle, unzip, textOf, titleIn, editable, frame, openTab, SANDBOX };
})();
