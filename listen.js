// Listen tab: YouTube videos and playlists to play while you work (long mixes, lo-fi, ambient), plus sounds made
// right here (rain, brown noise and more). The player lives outside the page, at the bottom left, so the music
// keeps going while you move around the app. Long mixes resume where you left them. Focus blocks can start your
// focus music and fade it out when they end, and there is a sleep timer.
// YouTube embeds are free and need no account; YouTube may show its usual ads.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, el, state, toast, refresh } = DS;

  const DEFAULT_CATS = ['Focus', 'Lo-fi', 'Ambient', 'Rain', 'Sleep', 'Watch later'];
  const WATCH = 'Watch later';
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
  const desktop = () => window.matchMedia('(min-width:901px)').matches;

  const PATHS = {
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>',
    shuffle: '<path d="M3 7h3.5c3 0 4.5 10 8 10H21M3 17h3.5c1.4 0 2.4-2 3.3-4.3M14.5 7H21M18 4l3 3-3 3M18 14l3 3-3 3"/>',
    loop: '<path d="M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="m3 5 3 2-3 2zM3 15l3 2-3 2z" fill="currentColor"/>'
  };
  function icon(name, size = 18) {
    const s = document.createElement('span');
    s.className = 'ls-i';
    s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
    return s;
  }
  const fmtTime = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

  /* =====================================================================
     Data
     ===================================================================== */
  const L = { items: [], loaded: false, loading: null, cat: store('ls_cat') || 'All', search: '' };
  async function load() {
    L.items = await q(sb.from('listen_items').select('*').order('position').order('created_at'));
    L.loaded = true;
  }
  const ensure = () => (L.loaded ? Promise.resolve() : (L.loading = L.loading || load().finally(() => { L.loading = null; })));
  const byId = id => L.items.find(x => x.id === id) || null;
  const cats = () => { const s = new Set(DEFAULT_CATS); L.items.forEach(x => s.add(x.category)); return [...s]; };
  async function patch(it, row) { Object.assign(it, row); await q(sb.from('listen_items').update(row).eq('id', it.id)); }

  // Any kind of YouTube link: watch?v=, youtu.be, shorts, live, embed, music.youtube, or a playlist.
  function parseYT(raw) {
    const s = String(raw || '').trim();
    if (/^[\w-]{11}$/.test(s)) return { kind: 'video', id: s };
    let u; try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch (e) { return null; }
    const h = u.hostname.replace(/^(www|m|music)\./, '');
    let vid = null;
    if (h === 'youtu.be') vid = u.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') vid = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/) || [])[1] || null;
    else return null;
    const list = u.searchParams.get('list');
    if (list && (u.pathname === '/playlist' || !vid) && /^[\w-]{6,64}$/.test(list)) return { kind: 'playlist', id: list };
    if (vid && /^[\w-]{11}$/.test(vid)) return { kind: 'video', id: vid };
    return null;
  }
  const watchUrl = it => it.kind === 'playlist' ? `https://www.youtube.com/playlist?list=${it.youtube_id}` : `https://www.youtube.com/watch?v=${it.youtube_id}`;
  const thumbOf = it => it.thumb || (it.kind === 'video' ? `https://i.ytimg.com/vi/${it.youtube_id}/hqdefault.jpg` : '');
  async function oembed(p) {
    const url = p.kind === 'playlist' ? `https://www.youtube.com/playlist?list=${p.id}` : `https://www.youtube.com/watch?v=${p.id}`;
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url));
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'private' : 'notfound');
    return r.json();
  }

  /* =====================================================================
     The player: a YouTube embed in a dock at the bottom left, outside the page
     ===================================================================== */
  const P = { item: null, yt: null, playing: false, ended: false, loop: store('ls_loop') === '1', shuffleCat: null, byFocus: false,
    volume: Math.max(0, Math.min(100, Number(store('ls_volume') || 70))), big: false, min: store('ls_min') === '1', sleepAt: 0, sleepFocus: false, saveTimer: null, duck: false, error: null };
  let api = null;
  const loadApi = () => api || (api = new Promise((ok, bad) => {
    if (window.YT && window.YT.Player) return ok(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); ok(window.YT); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { api = null; bad(new Error('Couldn’t reach YouTube.')); };
    document.head.append(s);
  }));

  let dock = null, card = null, soundsPill = null;
  function ensureDock() {
    if (dock && dock.isConnected) return dock;
    dock = el('div', { class: 'ls-dock', id: 'ls-dock' });
    document.body.append(dock);
    return dock;
  }
  function buildCard() {
    ensureDock();
    if (card && card.isConnected) return card;
    const b = (cls, label, ic, fn) => el('button', { type: 'button', class: 'ls-b ' + cls, 'aria-label': label, title: label, onclick: fn }, icon(ic, cls.includes('ls-main') ? 20 : 17));
    const vol = el('input', { type: 'range', class: 'ls-vol', min: '0', max: '100', value: String(P.volume), 'aria-label': 'Volume',
      oninput: () => { P.volume = +vol.value; store('ls_volume', String(P.volume)); applyVolume(); } });
    const sleepMenu = el('div', { class: 'ls-menu', hidden: true, role: 'menu' },
      [['Off', 0], ['In 30 minutes', 30], ['In 60 minutes', 60], ['In 90 minutes', 90], ['When the focus block ends', 'focus']].map(([l, v]) =>
        el('button', { type: 'button', role: 'menuitem', onclick: () => { sleepMenu.hidden = true; setSleep(v); } }, l)));
    lastPaint = '';
    card = el('div', { class: 'ls-card', role: 'region', 'aria-label': 'Now playing' },
      el('div', { class: 'ls-vid' }, el('div', { class: 'ls-frame' }), el('div', { class: 'ls-err', hidden: true })),
      el('div', { class: 'ls-info' },
        el('b', { class: 'ls-title' }),
        el('small', { class: 'ls-sub' })),
      el('div', { class: 'ls-ctl' },
        b('ls-main', 'Pause', 'pause', () => toggle()),
        b('ls-next', 'Play something else from this category', 'shuffle', () => shuffleNext()),
        b('ls-loop' + (P.loop ? ' on' : ''), 'Repeat when it ends', 'loop', e => { P.loop = !P.loop; store('ls_loop', P.loop ? '1' : '0'); e.currentTarget.classList.toggle('on', P.loop); }),
        el('span', { class: 'ls-volw' }, icon('volume', 15), vol),
        el('span', { class: 'ls-mw' }, b('ls-sleep', 'Sleep timer', 'moon', e => { e.stopPropagation(); sleepMenu.hidden = !sleepMenu.hidden; }), sleepMenu),
        b('ls-mini', 'Minimise', 'down', () => setMin(!P.min)),
        b('ls-size', 'Bigger', 'expand', () => setBig(!P.big)),
        b('ls-x', 'Stop and close', 'close', () => closePlayer())));
    document.addEventListener('click', e => { if (!e.target.closest('.ls-mw')) sleepMenu.hidden = true; });
    dock.append(card);
    return card;
  }
  let lastPaint = '';
  function paintCard() {
    if (!card) return;
    const it = P.item;
    // only touch the page when something shown has changed (this runs whenever the app redraws)
    const sig = [it && it.id, it && it.title, it && it.category, P.playing, P.big, P.min, P.byFocus, P.shuffleCat, P.sleepFocus, P.sleepAt && Math.round((P.sleepAt - Date.now()) / 60000), P.error, state.view === 'listen' && document.querySelectorAll('.ls-tile.playing').length].join('|');
    if (sig === lastPaint) return;
    lastPaint = sig;
    card.classList.toggle('big', P.big);
    card.classList.toggle('min', P.min && !P.big);
    const mini = card.querySelector('.ls-mini');
    mini.replaceChildren(icon(P.min ? 'up' : 'down', 17)); mini.title = P.min ? 'Show the player' : 'Minimise'; mini.setAttribute('aria-label', mini.title);
    document.body.classList.toggle('ls-big', P.big);
    card.querySelector('.ls-title').textContent = it ? (it.title || 'YouTube') : '';
    const bits = [it && it.category];
    if (P.byFocus) bits.push('focus music');
    if (P.shuffleCat) bits.push('shuffling ' + P.shuffleCat);
    if (P.sleepFocus) bits.push('stops with the focus block');
    else if (P.sleepAt) bits.push('sleep in ' + Math.max(1, Math.round((P.sleepAt - Date.now()) / 60000)) + 'm');
    card.querySelector('.ls-sub').textContent = bits.filter(Boolean).join(' · ');
    const main = card.querySelector('.ls-main');
    main.replaceChildren(icon(P.playing ? 'pause' : 'play', 20));
    main.setAttribute('aria-label', P.playing ? 'Pause' : 'Play'); main.title = main.getAttribute('aria-label');
    const size = card.querySelector('.ls-size');
    size.replaceChildren(icon(P.big ? 'shrink' : 'expand', 17)); size.title = P.big ? 'Smaller' : 'Bigger'; size.setAttribute('aria-label', size.title);
    card.querySelector('.ls-sleep').classList.toggle('on', !!(P.sleepAt || P.sleepFocus));
    const err = card.querySelector('.ls-err');
    err.hidden = !P.error;
    if (P.error && it) err.replaceChildren(el('p', {}, P.error), el('a', { class: 'btn', href: watchUrl(it), target: '_blank', rel: 'noopener noreferrer' }, 'Open on YouTube'));
    document.querySelectorAll('.ls-tile').forEach(t => t.classList.toggle('playing', !!it && t.dataset.id === it.id));
  }
  function setBig(on) { P.big = on; if (on) P.min = false; paintCard(); }
  // Minimised: just a slim bar with play / pause, the title, next, show and close. The video keeps playing, unseen.
  function setMin(on) { P.min = on; store('ls_min', on ? '1' : '0'); if (on) P.big = false; paintCard(); }

  async function play(it, opts = {}) {
    if (!it) return;
    const fromStart = !!opts.fromStart;
    P.item = it; P.ended = false; P.error = null; P.byFocus = !!opts.byFocus;
    if (opts.shuffleCat !== undefined) P.shuffleCat = opts.shuffleCat;
    if (it.category === WATCH && opts.big !== false) P.big = true;
    buildCard(); paintCard();
    saveProgress(); // the one we are leaving
    let YT;
    try { YT = await loadApi(); } catch (e) { P.error = e.message; paintCard(); return; }
    if (P.item !== it) return;
    if (P.yt) { try { P.yt.destroy(); } catch (e) {} P.yt = null; }
    // our own iframe, so it can send YouTube a referrer (this site sends none by default, and embeds need one)
    const start = !fromStart && it.duration > 0 && it.last_seconds > 30 && it.last_seconds < it.duration - 30 ? Math.floor(it.last_seconds) : 0;
    const params = new URLSearchParams({ enablejsapi: '1', autoplay: '1', playsinline: '1', rel: '0', origin: location.origin });
    if (start) params.set('start', String(start));
    let src;
    if (it.kind === 'playlist') { params.set('list', it.youtube_id); if (!fromStart && it.last_index > 0) params.set('index', String(it.last_index)); src = 'https://www.youtube.com/embed/videoseries?' + params; }
    else src = `https://www.youtube.com/embed/${it.youtube_id}?` + params;
    const frame = el('iframe', { src, title: it.title || 'YouTube video', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
    card.querySelector('.ls-frame').replaceChildren(frame);
    P.yt = new YT.Player(frame, { events: {
      onReady: e => { applyVolume(); try { e.target.playVideo(); } catch (er) {} },
      onStateChange: e => onState(it, e.data),
      onError: e => {
        P.error = [101, 150, 153].includes(e.data) ? 'The owner doesn’t allow this video to play outside YouTube.' : e.data === 100 ? 'This video was removed or made private.' : 'This video can’t play here.';
        P.playing = false; paintCard();
      } } });
    // played: count it and move it to "Recently played"
    patch(it, { plays: (it.plays || 0) + 1, last_played_at: new Date().toISOString() }).catch(() => {});
    if (state.view === 'listen') drawPage();
  }
  function onState(it, s) {
    if (P.item !== it) return;
    const YT = window.YT;
    if (s === YT.PlayerState.PLAYING) {
      P.playing = true; P.ended = false;
      const d = P.yt.getDuration && P.yt.getDuration();
      if (d && Math.abs(d - (it.duration || 0)) > 2) patch(it, { duration: d }).catch(() => {});
      clearInterval(P.saveTimer); P.saveTimer = setInterval(saveProgress, 20000);
    } else if (s === YT.PlayerState.PAUSED) { P.playing = false; saveProgress(); clearInterval(P.saveTimer); }
    else if (s === YT.PlayerState.ENDED) {
      P.playing = false; clearInterval(P.saveTimer);
      if (it.kind === 'video') patch(it, { last_seconds: 0 }).catch(() => {});
      if (P.loop) { try { P.yt.seekTo(0, true); P.yt.playVideo(); } catch (e) {} return; }
      if (P.shuffleCat) { shuffleNext(); return; }
      P.ended = true;
    }
    paintCard();
  }
  // Long mixes: remember where we are, so next time it carries on from there.
  function saveProgress() {
    const it = P.item, y = P.yt;
    if (!it || !y || !y.getCurrentTime) return;
    try {
      const t = y.getCurrentTime(), d = y.getDuration ? y.getDuration() : 0;
      const row = {};
      if (d > 0 && t > 0) row.last_seconds = t > d - 30 ? 0 : Math.floor(t);
      if (it.kind === 'playlist' && y.getPlaylistIndex) { const i = y.getPlaylistIndex(); if (i >= 0) row.last_index = i; }
      if (Object.keys(row).length && (row.last_seconds !== it.last_seconds || row.last_index !== it.last_index)) patch(it, row).catch(() => {});
    } catch (e) {}
  }
  function toggle() {
    if (!P.yt || !P.yt.getPlayerState) return;
    if (P.playing) P.yt.pauseVideo(); else { if (P.ended) { P.yt.seekTo(0, true); } P.yt.playVideo(); }
  }
  function applyVolume() { try { P.yt && P.yt.setVolume && P.yt.setVolume(P.duck ? Math.round(P.volume * 0.25) : P.volume); } catch (e) {} }
  function pick(cat, not) {
    const pool = L.items.filter(x => (cat === 'Favourites' ? x.favourite : x.category === cat) && x.id !== (not && not.id));
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }
  function shuffleNext() {
    const cat = P.shuffleCat || (P.item && P.item.category);
    const next = pick(cat, P.item);
    if (!next) { toast(`Nothing else in ${cat} yet.`); return; }
    play(next, { shuffleCat: cat, big: false });
  }
  function fadeOut(ms, then) {
    if (!P.yt || !P.playing) { then && then(); return; }
    const steps = 20, start = P.volume; let i = 0;
    const t = setInterval(() => {
      i++;
      try { P.yt.setVolume(Math.round(start * (1 - i / steps))); } catch (e) {}
      if (i >= steps) { clearInterval(t); try { P.yt.pauseVideo(); } catch (e) {} applyVolume(); then && then(); }
    }, ms / steps);
  }
  function closePlayer() {
    saveProgress(); clearInterval(P.saveTimer);
    if (P.yt) { try { P.yt.destroy(); } catch (e) {} }
    Object.assign(P, { item: null, yt: null, playing: false, shuffleCat: null, byFocus: false, big: false, sleepAt: 0, sleepFocus: false, error: null });
    document.body.classList.remove('ls-big');
    card && card.remove(); card = null;
    if (state.view === 'listen') drawPage();
  }

  /* ---------- sleep timer ---------- */
  let sleepTick = null;
  function setSleep(v) {
    P.sleepAt = 0; P.sleepFocus = false; clearInterval(sleepTick);
    if (v === 'focus') { P.sleepFocus = true; toast('The music will fade out when the focus block ends.'); }
    else if (v) {
      P.sleepAt = Date.now() + v * 60000;
      toast(`The music will fade out in ${v} minutes.`);
      sleepTick = setInterval(() => {
        if (!P.sleepAt) return clearInterval(sleepTick);
        if (Date.now() >= P.sleepAt) { clearInterval(sleepTick); P.sleepAt = 0; fadeOut(10000, () => { sounds.stopAll(); paintCard(); }); }
        paintCard();
      }, 30000);
    }
    paintCard();
  }

  /* =====================================================================
     Built-in sounds, made live with Web Audio: no YouTube, no ads, no internet needed
     ===================================================================== */
  const SOUNDS = [['rain', 'Rain'], ['brown', 'Brown noise'], ['pink', 'Pink noise'], ['waves', 'Ocean waves'], ['fire', 'Fireplace'], ['wind', 'Wind']];
  const sounds = (() => {
    let ac = null, master = null;
    const on = {};
    const vols = (() => { try { return JSON.parse(store('ls_sound_vols') || '{}'); } catch (e) { return {}; } })();
    const ctx = () => {
      if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; ac = new AC(); master = ac.createGain(); master.gain.value = 1; master.connect(ac.destination); }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    };
    function noise(kind, secs = 6) {
      const n = ac.sampleRate * secs, buf = ac.createBuffer(2, n, ac.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
        for (let i = 0; i < n; i++) {
          const w = Math.random() * 2 - 1;
          if (kind === 'white') d[i] = w * 0.5;
          else if (kind === 'pink') { b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852; b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926; }
          else { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
        }
      }
      return buf;
    }
    function loopSrc(buf) { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; }
    const build = {
      rain() { const g = ac.createGain(), hp = ac.createBiquadFilter(), lp = ac.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 600; lp.type = 'lowpass'; lp.frequency.value = 7000;
        const s = loopSrc(noise('pink')); s.connect(hp); hp.connect(lp); lp.connect(g);
        const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = .15; lg.gain.value = .12; lfo.connect(lg); lg.connect(g.gain); lfo.start();
        g.gain.value = .9; return { out: g, stop: () => { s.stop(); lfo.stop(); } }; },
      brown() { const g = ac.createGain(), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
        const s = loopSrc(noise('brown')); s.connect(lp); lp.connect(g); g.gain.value = .9; return { out: g, stop: () => s.stop() }; },
      pink() { const g = ac.createGain(); const s = loopSrc(noise('pink')); s.connect(g); g.gain.value = .6; return { out: g, stop: () => s.stop() }; },
      waves() { const g = ac.createGain(), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
        const s = loopSrc(noise('pink', 8)); s.connect(lp); lp.connect(g); g.gain.value = .35;
        const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = .09; lg.gain.value = .33; lfo.connect(lg); lg.connect(g.gain); lfo.start();
        return { out: g, stop: () => { s.stop(); lfo.stop(); } }; },
      fire() { const g = ac.createGain(), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
        const s = loopSrc(noise('brown')); s.connect(lp); lp.connect(g); g.gain.value = .7;
        // crackles: short bright clicks at random moments
        const click = ac.createBuffer(1, Math.floor(ac.sampleRate * .03), ac.sampleRate), cd = click.getChannelData(0);
        for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / cd.length, 6);
        const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500; hp.connect(g);
        let alive = true;
        const pop = () => { if (!alive) return; const c = ac.createBufferSource(), cg = ac.createGain(); c.buffer = click; cg.gain.value = .3 + Math.random() * .9; c.connect(cg); cg.connect(hp); c.start(); setTimeout(pop, 60 + Math.random() * (Math.random() < .2 ? 900 : 260)); };
        pop();
        return { out: g, stop: () => { alive = false; s.stop(); } }; },
      wind() { const g = ac.createGain(), bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = .8;
        const s = loopSrc(noise('pink', 8)); s.connect(bp); bp.connect(g); g.gain.value = .7;
        const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = .05; lg.gain.value = 350; lfo.connect(lg); lg.connect(bp.frequency); lfo.start();
        return { out: g, stop: () => { s.stop(); lfo.stop(); } }; }
    };
    const vol = k => (vols[k] != null ? vols[k] : 50) / 100;
    function start(k) {
      if (on[k]) return;
      ctx();
      const node = build[k](), lvl = ac.createGain();
      lvl.gain.setValueAtTime(0, ac.currentTime); lvl.gain.linearRampToValueAtTime(vol(k), ac.currentTime + 1.5);
      node.out.connect(lvl); lvl.connect(master);
      on[k] = { node, lvl };
      paintSounds();
    }
    function stop(k) {
      const s = on[k]; if (!s) return;
      delete on[k];
      s.lvl.gain.cancelScheduledValues(ac.currentTime); s.lvl.gain.setValueAtTime(s.lvl.gain.value, ac.currentTime); s.lvl.gain.linearRampToValueAtTime(0, ac.currentTime + 1);
      setTimeout(() => { try { s.node.stop(); s.lvl.disconnect(); } catch (e) {} }, 1200);
      paintSounds();
    }
    function setVol(k, v) { vols[k] = v; store('ls_sound_vols', JSON.stringify(vols)); if (on[k]) on[k].lvl.gain.setTargetAtTime(v / 100, ac.currentTime, .1); }
    const stopAll = () => Object.keys(on).forEach(stop);
    const active = () => Object.keys(on);
    return { start, stop, setVol, stopAll, active, vol: k => (vols[k] != null ? vols[k] : 50), isOn: k => !!on[k] };
  })();
  function paintSounds() {
    const act = sounds.active();
    document.querySelectorAll('.ls-snd').forEach(t => { const on = sounds.isOn(t.dataset.k); t.classList.toggle('on', on); t.querySelector('.ls-snd-b').setAttribute('aria-pressed', String(on)); });
    // a small pill in the dock while any sound is on, so it can be stopped from anywhere
    ensureDock();
    if (act.length) {
      if (!soundsPill || !soundsPill.isConnected) { soundsPill = el('div', { class: 'ls-pill' }); dock.prepend(soundsPill); }
      soundsPill.replaceChildren(el('span', {}, '♪ ' + act.map(k => SOUNDS.find(s => s[0] === k)[1]).join(' + ')),
        el('button', { type: 'button', class: 'ls-pill-x', onclick: () => sounds.stopAll(), 'aria-label': 'Stop the sounds', title: 'Stop the sounds' }, 'Stop'));
    } else if (soundsPill) { soundsPill.remove(); soundsPill = null; }
  }

  /* =====================================================================
     Focus blocks: start your focus music when one starts, pause with it, fade out when it ends
     ===================================================================== */
  const focusMusicOn = () => { const v = store('ls_focus_music'); return v ? v === 'on' : desktop(); };
  let timerState = null; // null = no focus block, 'run' or 'paused'
  function readTimer() { const b = document.getElementById('timerbar'); return b ? (b.classList.contains('paused') ? 'paused' : 'run') : null; }
  function onTimerChange() {
    const now = readTimer(), was = timerState;
    if (now === was) return;
    timerState = now;
    if (was === null && now === 'run') {
      if (!focusMusicOn() || (P.item && P.playing)) return;
      ensure().then(() => {
        const flagged = L.items.filter(x => x.focus);
        const pool = flagged.length ? flagged : L.items.filter(x => x.category === 'Focus');
        if (!pool.length) return;
        play(pool[Math.floor(Math.random() * pool.length)], { byFocus: true, shuffleCat: null, big: false });
        toast('Focus music on. It fades out when the block ends.');
      }).catch(() => {});
    } else if (now === 'paused' && P.byFocus && P.playing) { try { P.yt.pauseVideo(); } catch (e) {} }
    else if (was === 'paused' && now === 'run' && P.byFocus && !P.playing) { try { P.yt.playVideo(); } catch (e) {} }
    else if (now === null) {
      if ((P.byFocus || P.sleepFocus) && P.item) { P.sleepFocus = false; fadeOut(8000, () => { P.byFocus = false; paintCard(); }); }
    }
  }
  timerState = readTimer(); // a block already running when the app opens doesn't start music by itself
  new MutationObserver(onTimerChange).observe(document.body, { childList: true });
  // read-aloud (Voice) turns the music down while it speaks
  new MutationObserver(() => { const d = document.body.classList.contains('vx-playing'); if (d !== P.duck) { P.duck = d; applyVolume(); } })
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });

  /* =====================================================================
     The page
     ===================================================================== */
  let pageEl = null;
  function tile(it) {
    const playing = P.item && P.item.id === it.id;
    const resume = it.kind === 'video' && it.duration > 0 && it.last_seconds > 30 && it.last_seconds < it.duration - 30;
    const menu = el('div', { class: 'ls-menu', hidden: true, role: 'menu' },
      el('button', { type: 'button', role: 'menuitem', onclick: () => moveDialog(it) }, 'Move to another category…'),
      resume ? el('button', { type: 'button', role: 'menuitem', onclick: () => play(it, { fromStart: true }) }, 'Play from the start') : null,
      el('a', { role: 'menuitem', href: watchUrl(it), target: '_blank', rel: 'noopener noreferrer' }, 'Open on YouTube'),
      el('button', { type: 'button', role: 'menuitem', class: 'danger', onclick: () => remove(it) }, it.category === WATCH ? 'Watched — remove' : 'Remove'));
    const t = el('article', { class: 'ls-tile' + (playing ? ' playing' : ''), 'data-id': it.id },
      el('button', { type: 'button', class: 'ls-thumb', 'aria-label': 'Play ' + (it.title || 'video'), onclick: () => play(it, { shuffleCat: null }) },
        thumbOf(it) ? el('img', { src: thumbOf(it), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'ls-noimg' }, icon('list', 30)),
        el('span', { class: 'ls-playover', 'aria-hidden': 'true' }, icon('play', 26)),
        it.kind === 'playlist' ? el('span', { class: 'ls-badge' }, icon('list', 13), 'Playlist') : null,
        resume ? el('span', { class: 'ls-badge ls-resume' }, 'Resume ' + fmtTime(it.last_seconds)) : it.kind === 'video' && it.duration > 0 ? el('span', { class: 'ls-badge ls-dur' }, fmtTime(it.duration)) : null),
      el('div', { class: 'ls-tbody' },
        el('h3', { title: it.title || '' }, it.title || 'YouTube video'),
        el('p', {}, [it.channel, it.plays ? `played ${it.plays}×` : null].filter(Boolean).join(' · ')),
        el('div', { class: 'ls-tacts' },
          el('button', { type: 'button', class: 'ls-ic' + (it.favourite ? ' fav' : ''), title: it.favourite ? 'Remove from favourites' : 'Add to favourites', 'aria-pressed': String(it.favourite),
            onclick: async () => { await patch(it, { favourite: !it.favourite }); drawPage(); } }, icon('star', 16)),
          el('button', { type: 'button', class: 'ls-ic' + (it.focus ? ' foc' : ''), title: it.focus ? 'Don’t play during focus blocks' : 'Play during focus blocks', 'aria-pressed': String(it.focus),
            onclick: async () => { await patch(it, { focus: !it.focus }); toast(it.focus ? 'It may play when a focus block starts.' : 'Removed from focus music.'); drawPage(); } }, icon('target', 16)),
          el('span', { class: 'ls-mw' }, el('button', { type: 'button', class: 'ls-ic', title: 'More', 'aria-label': 'More', onclick: e => { e.stopPropagation(); document.querySelectorAll('.ls-tile .ls-menu').forEach(m => { if (m !== menu) m.hidden = true; }); menu.hidden = !menu.hidden; } }, icon('more', 16)), menu))));
    return t;
  }
  document.addEventListener('click', e => { if (!e.target.closest('.ls-tile .ls-mw')) document.querySelectorAll('.ls-tile .ls-menu').forEach(m => { m.hidden = true; }); });

  async function remove(it) {
    if (!confirm(`Remove “${it.title || 'this video'}” from Listen?`)) return;
    await q(sb.from('listen_items').delete().eq('id', it.id));
    L.items = L.items.filter(x => x !== it);
    if (P.item === it) closePlayer();
    toast('Removed.'); drawPage();
  }
  function moveDialog(it) {
    const dlg = el('dialog', { class: 'ls-dlg', 'aria-label': 'Move' });
    const sel = catSelect(it.category);
    dlg.append(el('form', { class: 'dlg', onsubmit: async e => { e.preventDefault(); const c = await catValue(sel); if (!c) return; await patch(it, { category: c }); dlg.close(); toast('Moved to ' + c + '.'); drawPage(); } },
      el('h2', {}, 'Move to'), sel,
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Move'), el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }
  function catSelect(value) {
    const s = el('select', { class: 'field', 'aria-label': 'Category' }, cats().map(c => el('option', { value: c }, c)), el('option', { value: '__new' }, 'New category…'));
    s.value = cats().includes(value) ? value : 'Focus';
    return s;
  }
  async function catValue(sel) {
    if (sel.value !== '__new') return sel.value;
    const n = (prompt('Name the new category', '') || '').trim().slice(0, 40);
    return n || null;
  }

  function addDialog() {
    const dlg = el('dialog', { class: 'ls-dlg', 'aria-label': 'Add to Listen' });
    const input = el('input', { class: 'field', type: 'url', inputmode: 'url', placeholder: 'Paste a YouTube link (video or playlist)', 'aria-label': 'YouTube link' });
    const preview = el('div', { class: 'ls-prev' });
    const sel = catSelect(L.cat !== 'All' && L.cat !== 'Favourites' && L.cat !== 'Recent' ? L.cat : 'Focus');
    const focusBox = el('input', { type: 'checkbox', id: 'ls-addfocus' });
    const addBtn = el('button', { class: 'btn primary', type: 'submit', disabled: true }, 'Add');
    let found = null, seq = 0;
    async function look() {
      const p = parseYT(input.value), my = ++seq;
      found = null; addBtn.disabled = true;
      if (!input.value.trim()) { preview.replaceChildren(); return; }
      if (!p) { preview.replaceChildren(el('p', { class: 'ls-warn' }, 'That doesn’t look like a YouTube link.')); return; }
      const dup = L.items.find(x => x.kind === p.kind && x.youtube_id === p.id);
      preview.replaceChildren(el('p', { class: 'meta' }, 'Looking it up…'));
      let info = null;
      try { info = await oembed(p); } catch (e) { if (my !== seq) return; preview.replaceChildren(el('p', { class: 'ls-warn' }, e.message === 'private' ? 'That video is private, so it can’t be added.' : 'Couldn’t find that video. Check the link.')); return; }
      if (my !== seq) return;
      found = { ...p, title: (info.title || '').slice(0, 300), channel: (info.author_name || '').slice(0, 120), thumb: p.kind === 'playlist' ? (info.thumbnail_url || null) : null };
      preview.replaceChildren(el('div', { class: 'ls-prevcard' },
        el('img', { src: found.thumb || `https://i.ytimg.com/vi/${p.id}/hqdefault.jpg`, alt: '', referrerpolicy: 'no-referrer' }),
        el('div', {}, el('b', {}, found.title || 'YouTube'), el('small', {}, [found.channel, p.kind === 'playlist' ? 'Playlist' : null].filter(Boolean).join(' · ')),
          dup ? el('small', { class: 'ls-warn' }, `Already in ${dup.category}.`) : null)));
      addBtn.disabled = false;
    }
    let tmo; input.addEventListener('input', () => { clearTimeout(tmo); tmo = setTimeout(look, 250); });
    const form = el('form', { class: 'dlg', onsubmit: async e => {
      e.preventDefault(); if (!found) return;
      const c = await catValue(sel); if (!c) return;
      addBtn.disabled = true;
      try {
        const row = await q(sb.from('listen_items').insert({ user_id: DS.uid(), kind: found.kind, youtube_id: found.id, title: found.title || null, channel: found.channel || null,
          thumb: found.thumb && /^https:\/\//.test(found.thumb) ? found.thumb : null, category: c, focus: focusBox.checked, position: Date.now() / 1000 }).select().single());
        L.items.push(row);
        toast(`Added to ${c}.`);
        input.value = ''; preview.replaceChildren(); found = null; focusBox.checked = false; input.focus();
        drawPage();
      } catch (er) { addBtn.disabled = false; }
    } },
      el('h2', {}, 'Add to Listen'),
      el('p', { class: 'meta', style: 'margin:-8px 0 0' }, 'Copy the link from YouTube (Share → Copy link, or the address bar) and paste it here. Playlists work too.'),
      input, preview,
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Category'), sel),
      el('label', { class: 'ls-check', for: 'ls-addfocus' }, focusBox, el('span', {}, 'Play this during focus blocks')),
      el('div', { class: 'actions' }, addBtn, el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Done')));
    dlg.append(form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal(); input.focus();
  }

  function drawPage() {
    if (!pageEl) return;
    const s = L.search.trim().toLowerCase();
    const match = it => !s || (it.title || '').toLowerCase().includes(s) || (it.channel || '').toLowerCase().includes(s) || it.category.toLowerCase().includes(s);
    const items = L.items.filter(match);
    const chips = ['All', 'Favourites', 'Recent', ...cats()];
    if (!chips.includes(L.cat)) L.cat = 'All';
    const sec = (title, list, opts = {}) => list.length || opts.always ? el('section', { class: 'ls-sec' },
      el('div', { class: 'ls-sech' }, el('h2', {}, title), el('span', { class: 'ls-n' }, String(list.length)),
        opts.cat && list.length > 1 ? el('button', { type: 'button', class: 'btn ls-small', onclick: () => { const it = pick(opts.cat); if (it) play(it, { shuffleCat: opts.cat, big: false }); } }, icon('shuffle', 15), ' Shuffle') : null),
      list.length ? el('div', { class: 'ls-grid' }, list.map(tile)) : el('p', { class: 'ls-empty' }, opts.empty || 'Nothing here yet.')) : null;
    let body;
    if (!L.items.length) {
      body = el('div', { class: 'ls-start' }, el('h2', {}, 'Your music, one tap away'),
        el('p', {}, 'Add the long mixes and playlists you play while you work: lo-fi, ambient, rain, piano. Paste a YouTube link and it appears here with its picture. Tap to play; it keeps playing while you use the rest of the app.'),
        el('button', { type: 'button', class: 'btn primary', onclick: addDialog }, '+ Add your first video'));
    } else if (L.cat === 'All') {
      const favs = items.filter(x => x.favourite);
      const recent = items.filter(x => x.last_played_at).sort((a, b) => (b.last_played_at > a.last_played_at ? 1 : -1)).slice(0, 4);
      body = [sec('Favourites', favs, { cat: 'Favourites' }), !s ? sec('Recently played', recent) : null,
        ...cats().map(c => sec(c, items.filter(x => x.category === c), { cat: c }))];
    } else if (L.cat === 'Favourites') body = sec('Favourites', items.filter(x => x.favourite), { cat: 'Favourites', always: true, empty: 'Tap the star on anything to keep it here.' });
    else if (L.cat === 'Recent') body = sec('Recently played', items.filter(x => x.last_played_at).sort((a, b) => (b.last_played_at > a.last_played_at ? 1 : -1)).slice(0, 4), { always: true, empty: 'Nothing played yet.' });
    else body = sec(L.cat, items.filter(x => x.category === L.cat), { cat: L.cat, always: true, empty: `Nothing in ${L.cat} yet. Add a video and pick ${L.cat}.` });
    pageEl.querySelector('.ls-chips').replaceChildren(...chips.map(c => el('button', { type: 'button', class: 'ls-chip' + (L.cat === c ? ' on' : ''), 'aria-pressed': String(L.cat === c),
      onclick: () => { L.cat = c; store('ls_cat', c); drawPage(); } }, c)));
    pageEl.querySelector('.ls-body').replaceChildren(...[body].flat().filter(Boolean));
  }

  function soundsPanel() {
    return el('section', { class: 'ls-sounds' },
      el('div', { class: 'ls-sech' }, el('h2', {}, 'Built-in sounds'), el('span', { class: 'ls-hint' }, 'Made right here: no ads, no internet. Mix them, or play them under a video.')),
      el('div', { class: 'ls-sgrid' }, SOUNDS.map(([k, name]) => {
        const r = el('input', { type: 'range', min: '0', max: '100', value: String(sounds.vol(k)), 'aria-label': name + ' volume', oninput: () => sounds.setVol(k, +r.value) });
        return el('div', { class: 'ls-snd' + (sounds.isOn(k) ? ' on' : ''), 'data-k': k },
          el('button', { type: 'button', class: 'ls-snd-b', 'aria-pressed': String(sounds.isOn(k)), onclick: () => (sounds.isOn(k) ? sounds.stop(k) : sounds.start(k)) },
            el('span', { class: 'ls-snd-dot', 'aria-hidden': 'true' }), name), r);
      })));
  }

  async function viewListen() {
    await ensure();
    const search = el('input', { class: 'field ls-search', type: 'search', placeholder: 'Search', 'aria-label': 'Search Listen', value: L.search, oninput: e => { L.search = e.target.value; drawPage(); } });
    const fm = el('input', { type: 'checkbox', id: 'ls-fm', checked: focusMusicOn(), onchange: () => { store('ls_focus_music', fm.checked ? 'on' : 'off'); toast(fm.checked ? 'Focus blocks will start your focus music on this device.' : 'Focus blocks won’t start music on this device.'); } });
    pageEl = el('div', { class: 'ls' },
      el('div', { class: 'head' }, el('h1', {}, 'Listen'), el('button', { type: 'button', class: 'btn primary ls-add', onclick: addDialog }, icon('plus', 16), ' Add a video')),
      el('p', { class: 'meta' }, 'Your background music and videos. Playing carries on while you use the rest of the app.'),
      el('div', { class: 'ls-tools' }, el('div', { class: 'ls-chips', role: 'toolbar', 'aria-label': 'Categories' }), search),
      el('label', { class: 'ls-check ls-fm', for: 'ls-fm' }, fm, el('span', {}, 'When I start a focus block, play my focus music (', icon('target', 13), ' marked, or the Focus category) and fade it out when the block ends. On this device.')),
      soundsPanel(),
      el('div', { class: 'ls-body' }));
    drawPage();
    return pageEl;
  }

  /* ---------- wiring ---------- */
  DS.views.listen = viewListen;
  DS.listen = { play, closePlayer, parseYT, sounds };
  function ensureNav() {
    const nav = document.querySelector('#app nav.nav');
    if (!nav) return;
    let b = nav.querySelector('[data-listen]');
    if (!b) {
      b = el('button', { 'data-listen': '', onclick: () => DS.go('listen') }, 'Listen');
      const after = nav.querySelector('[data-create]') || nav.querySelector('[data-projects]');
      if (after) after.after(b); else nav.append(b);
    }
    if (state.view === 'listen') b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  let pending = false;
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; ensureNav(); paintCard(); });
  }).observe(app, { childList: true, subtree: true });
  window.addEventListener('beforeunload', saveProgress);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(); });
  if (location.hash.slice(1) === 'listen') {
    state.view = 'listen';
    if (state.user && document.getElementById('main')) DS.go('listen');
  }
})();
