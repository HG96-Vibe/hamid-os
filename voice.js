// Voice: speak instead of typing, and listen to your day, your week and your documents.
// Both use what the browser and phone already have built in (free, nothing to sign up for):
// - Speaking uses the browser's speech recognition. Safari sends it to Apple, Chrome to Google. A mic button
//   appears above the keyboard whenever you are typing; tap it, talk, tap again to stop.
// - Listening uses the device's own voices (speechSynthesis). Pick the voice and speed in Settings → Voice.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { el, state, toast } = DS;

  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TTS = window.speechSynthesis && window.SpeechSynthesisUtterance ? window.speechSynthesis : null;
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  const standalone = window.matchMedia && matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  const ICON = {
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>',
    back: '<path d="M11 6 5 12l6 6M19 6l-6 6 6 6"/>',
    fwd: '<path d="m13 6 6 6-6 6M5 6l6 6-6 6"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    speaker: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'
  };
  function icon(name, size = 20) {
    const s = document.createElement('span');
    s.className = 'vx-i';
    s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
    return s;
  }

  /* =====================================================================
     Listening
     ===================================================================== */
  const RATES = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2];
  const P = { parts: [], i: 0, playing: false, label: '', cur: null, bar: null, keepAlive: null };
  const rate = () => { const r = parseFloat(store('ds_voice_rate')); return r >= 0.5 && r <= 2 ? r : 1; };

  // The voice to read with: the one picked in Settings, else the best British English voice on the device.
  let voicesCache = [];
  const loadVoices = () => { voicesCache = TTS ? TTS.getVoices() : []; return voicesCache; };
  if (TTS) { loadVoices(); TTS.addEventListener && TTS.addEventListener('voiceschanged', loadVoices); }
  function englishVoices() {
    return (voicesCache.length ? voicesCache : loadVoices()).filter(v => /^en[-_]/i.test(v.lang) || v.lang === 'en');
  }
  // On iPhone and Mac the Enhanced / Premium download of a voice has the same name as the basic one
  // ("Daniel"); only its voiceURI says which it is (com.apple.voice.enhanced.en-GB.Daniel). So voices are
  // told apart, labelled and remembered by voiceURI.
  const vid = v => v.voiceURI || v.name;
  const quality = v => { const k = vid(v) + ' ' + v.name; return /premium/i.test(k) ? 'Premium' : /enhanced|neural|natural/i.test(k) ? 'Enhanced' : ''; };
  const vlabel = v => { const q = quality(v); return v.name + (q && !new RegExp(q, 'i').test(v.name) ? ` (${q})` : ''); };
  function bestVoice() {
    const all = englishVoices(), want = store('ds_voice_uri'), old = store('ds_voice_name');
    if (want) { const v = all.find(x => vid(x) === want); if (v) return v; }
    const score = v => (/^en[-_]GB/i.test(v.lang) ? 40 : /^en[-_](IE|AU|NZ)/i.test(v.lang) ? 15 : /^en[-_]US/i.test(v.lang) ? 10 : 0)
      + (quality(v) === 'Premium' ? 30 : quality(v) === 'Enhanced' ? 22 : 0) + (old && v.name === old ? 6 : 0)
      + (/Daniel|Serena|Kate|Arthur|Martha|Stephanie|Jamie|Oliver/i.test(v.name) ? 8 : 0)
      + (/Google UK English/i.test(v.name) ? 12 : 0) + (/Natural|Neural|Online/i.test(v.name) ? 14 : 0)
      + (v.localService ? 2 : 0) - (/eloquence|grandma|grandpa|bubbles|bad news|bells|boing|cellos|jester|organ|trinoids|whisper|zarvox|superstar|wobble|albert|fred|junior|ralph|kathy/i.test(v.name) ? 50 : 0);
    return all.slice().sort((a, b) => score(b) - score(a))[0] || null;
  }

  // Short pieces read one after another: phones and Chrome cut off long speech, and it makes skipping possible.
  function chunk(text) {
    const out = [];
    for (const para of String(text || '').split(/\n+/)) {
      const t = para.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const sentences = t.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g) || [t];
      for (let s of sentences) {
        s = s.trim();
        while (s.length > 220) {
          let cut = s.lastIndexOf(', ', 220); if (cut < 80) cut = s.lastIndexOf(' ', 220); if (cut < 40) cut = 220;
          out.push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1).trim();
        }
        if (s) out.push(s);
      }
    }
    return out;
  }

  /* ---------- Kokoro: natural voices that run on this device (kokoro.js, loaded only when picked) ---------- */
  const KOKORO = [['bf_emma', 'Emma', 'British'], ['bm_george', 'George', 'British'], ['bf_isabella', 'Isabella', 'British'], ['bm_fable', 'Fable', 'British'],
    ['bm_lewis', 'Lewis', 'British'], ['bf_alice', 'Alice', 'British'], ['bf_lily', 'Lily', 'British'], ['bm_daniel', 'Daniel', 'British'],
    ['af_heart', 'Heart', 'American'], ['af_bella', 'Bella', 'American']];
  const kokoroId = () => { const u = store('ds_voice_uri') || ''; return u.startsWith('kokoro:') ? u.slice(7) : null; };
  const kokoroName = id => (KOKORO.find(k => k[0] === id) || [id, id])[1];
  let kScript = null;
  const loadKokoro = () => kScript || (kScript = new Promise((ok, bad) => {
    if (window.HKokoro) return ok(window.HKokoro);
    const sc = document.createElement('script'); sc.src = '/kokoro.js?v=1';
    sc.onload = () => ok(window.HKokoro); sc.onerror = () => { kScript = null; bad(new Error('Couldn’t load the natural voice.')); };
    document.head.append(sc);
  }));
  // One audio element for Kokoro: unlike Web Audio it still plays with the iPhone's ring switch on silent.
  const KA = typeof Audio !== 'undefined' ? new Audio() : null;
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

  // iPhone only lets a page speak if the first speech starts straight from a tap; this does that, silently.
  function unlock() {
    if (KA && kokoroId()) { try { KA.src = SILENT; KA.play().catch(() => {}); } catch (e) {} }
    if (!TTS) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; TTS.speak(u); } catch (e) {}
  }

  P.kc = new Map(); P.ktok = 0; P.engine = 'device';
  function kClear() { P.kc.forEach(pr => pr.then(u => URL.revokeObjectURL(u), () => {})); P.kc = new Map(); }
  function kGet(i) {
    if (!P.kc.has(i)) { const pr = window.HKokoro.gen(P.parts[i], P.kvoice).then(r => r.url); pr.catch(() => {}); P.kc.set(i, pr); }
    return P.kc.get(i);
  }
  async function kSpeak() {
    const tok = ++P.ktok, i = P.i;
    if (i >= P.parts.length) { finish(); return; }
    paintBar();
    let url;
    try { url = await kGet(i); }
    catch (e) {
      if (tok !== P.ktok) return;
      toast('The natural voice stopped working, so your device voice will read instead.');
      P.engine = 'device'; speakCurrent(); return;
    }
    if (tok !== P.ktok || !P.playing) return;
    for (let k = 1; k <= 2; k++) if (i + k < P.parts.length) kGet(i + k); // get the next sentences ready while this one plays
    KA.src = url; KA.playbackRate = rate(); KA.preservesPitch = true;
    KA.onended = () => { if (tok === P.ktok && P.playing) { P.i++; kSpeak(); } };
    KA.play().catch(() => { if (tok === P.ktok) { pause(); toast('Tap play to listen.'); } });
  }
  function halt() { P.cur = null; P.ktok++; if (TTS) TTS.cancel(); if (KA) KA.pause(); }

  function speakCurrent() {
    if (P.engine === 'kokoro') return kSpeak();
    if (!TTS) return;
    if (P.i >= P.parts.length) { finish(); return; }
    const u = new SpeechSynthesisUtterance(P.parts[P.i]);
    const v = bestVoice();
    u.lang = 'en-GB';
    if (v) { try { u.voice = v; u.lang = v.lang; } catch (e) {} }
    u.rate = rate();
    u.onend = () => { if (P.cur !== u || !P.playing) return; P.i++; speakCurrent(); };
    u.onerror = e => { if (P.cur !== u || !P.playing || e.error === 'interrupted' || e.error === 'canceled') return; P.i++; speakCurrent(); };
    P.cur = u;
    TTS.speak(u);
    paintBar();
  }
  async function play(text, label) {
    const kv = KA && kokoroId();
    if (!TTS && !kv) { toast('This browser can’t read aloud.'); return; }
    const parts = Array.isArray(text) ? text.flatMap(chunk) : chunk(text);
    if (!parts.length) { toast('There’s nothing to read here yet.'); return; }
    stopDictation();
    halt(); kClear();
    Object.assign(P, { parts, i: 0, playing: true, label: label || 'Reading', engine: 'device', kvoice: kv });
    showBar();
    if (kv) {
      // the natural voice: download it the first time (shown in the bar), then read with it
      const tok = P.ktok;
      try {
        const K = await loadKokoro();
        if (!K || !K.supported) throw new Error('not supported');
        if (!K.isReady()) {
          setNow(K.wasReady() ? 'Getting ' + kokoroName(kv) + '’s voice ready…' : 'Downloading ' + kokoroName(kv) + '’s voice (once only)…');
          await K.load((loaded, total) => { if (total && P.ktok === tok) setNow(`Downloading ${kokoroName(kv)}’s voice (once only)… ${Math.min(100, Math.round(loaded / total * 100))}%`); });
        }
        if (P.ktok !== tok || !P.playing) return;
        P.engine = 'kokoro';
      } catch (e) {
        if (P.ktok !== tok) return;
        toast('The natural voice couldn’t load, so your device voice will read instead.');
      }
    }
    speakCurrent();
    // Chrome on computers stops speaking after ~15s unless nudged
    clearInterval(P.keepAlive);
    if (!isApple) P.keepAlive = setInterval(() => { if (P.playing && TTS.speaking && !TTS.paused) { TTS.pause(); TTS.resume(); } }, 10000);
  }
  // Pausing restarts the current sentence on resume: pause / resume in phone browsers is unreliable.
  function pause() { P.playing = false; halt(); paintBar(); }
  function resume() { if (P.i >= P.parts.length) P.i = 0; P.playing = true; speakCurrent(); }
  function skip(n) { P.i = Math.max(0, Math.min(P.parts.length - 1, P.i + n)); halt(); if (P.playing) speakCurrent(); else paintBar(); }
  function stop() { P.playing = false; halt(); kClear(); clearInterval(P.keepAlive); P.bar && P.bar.remove(); P.bar = null; document.body.classList.remove('vx-playing'); }
  function finish() { P.playing = false; P.cur = null; clearInterval(P.keepAlive); paintBar(true); setTimeout(() => { if (!P.playing) stop(); }, 2500); }
  function setNow(t) { const n = P.bar && P.bar.querySelector('.vx-now'); if (n) n.textContent = t; }

  function showBar() {
    if (P.bar && P.bar.isConnected) return paintBar();
    const b = (cls, label, ic, fn) => el('button', { type: 'button', class: 'vx-b ' + cls, 'aria-label': label, title: label, onclick: fn }, icon(ic, cls === 'vx-main' ? 22 : 18));
    P.bar = el('div', { class: 'vx-bar', role: 'region', 'aria-label': 'Read aloud' },
      el('div', { class: 'vx-txt' }, el('b', { class: 'vx-label' }), el('span', { class: 'vx-now' })),
      el('div', { class: 'vx-ctl' },
        b('vx-back', 'Previous sentence', 'back', () => skip(-1)),
        b('vx-main', 'Pause', 'pause', () => (P.playing ? pause() : resume())),
        b('vx-fwd', 'Next sentence', 'fwd', () => skip(1)),
        el('button', { type: 'button', class: 'vx-rate', 'aria-label': 'Reading speed', title: 'Reading speed', onclick: () => {
          const r = rate(), next = RATES[(RATES.findIndex(x => x >= r - 0.001) + 1) % RATES.length];
          store('ds_voice_rate', String(next)); paintBar();
          if (P.engine === 'kokoro') { if (KA) KA.playbackRate = next; } else if (P.playing) { halt(); speakCurrent(); }
        } }),
        b('vx-x', 'Stop reading', 'close', stop)),
      el('div', { class: 'vx-prog' }, el('i')));
    document.body.append(P.bar);
    document.body.classList.add('vx-playing');
    paintBar();
  }
  function paintBar(done) {
    const bar = P.bar; if (!bar) return;
    bar.querySelector('.vx-label').textContent = P.label;
    bar.querySelector('.vx-now').textContent = done ? 'Finished' : (P.parts[P.i] || '');
    const main = bar.querySelector('.vx-main');
    main.replaceChildren(icon(P.playing ? 'pause' : 'play', 22));
    main.setAttribute('aria-label', P.playing ? 'Pause' : 'Play'); main.title = main.getAttribute('aria-label');
    bar.querySelector('.vx-rate').textContent = (Math.round(rate() * 100) / 100) + '×';
    bar.querySelector('.vx-prog i').style.width = (P.parts.length ? Math.round(((done ? P.parts.length : P.i) / P.parts.length) * 100) : 0) + '%';
  }

  /* ---------- what to read ---------- */
  const listOf = arr => arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
  const tt = t => String(t.title || '').trim().replace(/[.!?]+$/, '');
  const live = ts => ts.filter(t => t.status === 'open' || t.status === 'done');
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  async function readMyDay() {
    unlock();
    const d = DS.today(), ws = DS.weekStart(d), ms = DS.monthStart(d);
    toast('Getting your day…');
    let day = [], week = [], month = [];
    try { [day, week, month] = await Promise.all([DS.fetchTasks('day', d), DS.fetchTasks('week', ws), DS.fetchTasks('month', ms)]); } catch (e) { return; }
    day = live(day); week = live(week); month = live(month);
    const h = new Date().getHours();
    const hello = (document.querySelector('.hm-hello')?.textContent || '').trim() || (h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.');
    const out = [hello, `It’s ${DS.dayName(d)}.`];
    const open = day.filter(t => t.status === 'open'), done = day.filter(t => t.status === 'done');
    if (!day.length) out.push('Nothing is on today’s sheet yet.');
    else {
      out.push(`You have ${n(day.length, 'task')} today` + (done.length ? `, and ${done.length} ${done.length === 1 ? 'is' : 'are'} done.` : '.'));
      const top = open.filter(t => t.pinned);
      if (top.length) out.push(`Your top ${top.length === 1 ? 'task is' : top.length + ' are'}: ` + listOf(top.map(tt)) + '.');
      const rest = open.filter(t => !t.pinned);
      if (rest.length) out.push((top.length ? 'Also on the list: ' : 'Still to do: ') + listOf(rest.slice(0, 8).map(tt)) + (rest.length > 8 ? `, and ${rest.length - 8} more.` : '.'));
      if (!open.length) out.push('Everything on today’s sheet is done. Well done.');
    }
    if (week.length) {
      const wo = week.filter(t => t.status === 'open');
      out.push(`This week: ${week.length - wo.length} of ${n(week.length, 'priority').replace('prioritys', 'priorities')} done.` + (wo.length ? ' Still open: ' + listOf(wo.slice(0, 5).map(tt)) + '.' : ''));
    }
    if (month.length) {
      const mo = month.filter(t => t.status === 'done').length;
      out.push(`This month, ${mo} of ${n(month.length, 'outcome')} ${mo === 1 ? 'is' : 'are'} done.`);
    }
    out.push(h < 17 ? 'Have a good day.' : 'Time to close out the day when you’re ready.');
    play(out, 'Your day');
  }
  async function readToday() {
    unlock();
    const d = state.cursor || DS.today();
    let day = [];
    try { day = live(await DS.fetchTasks('day', d)); } catch (e) { return; }
    const open = day.filter(t => t.status === 'open'), done = day.filter(t => t.status === 'done');
    const out = [DS.dayName(d) + '.'];
    if (!day.length) out.push('Nothing on the sheet.');
    else {
      out.push(`${n(day.length, 'task')}, ${done.length} done.`);
      const top = open.filter(t => t.pinned), rest = open.filter(t => !t.pinned);
      if (top.length) out.push('Starred: ' + listOf(top.map(tt)) + '.');
      if (rest.length) out.push((top.length ? 'Then: ' : 'To do: ') + listOf(rest.map(tt)) + '.');
      if (done.length) out.push('Done: ' + listOf(done.map(tt)) + '.');
    }
    play(out, DS.dayName(d));
  }
  async function readWeek() {
    unlock();
    const ws = DS.weekStart(state.cursor || DS.today());
    let week = [];
    try { week = live(await DS.fetchTasks('week', ws)); } catch (e) { return; }
    const open = week.filter(t => t.status === 'open'), done = week.filter(t => t.status === 'done');
    const label = 'Week of ' + DS.fmt(ws, { day: 'numeric', month: 'long' });
    const out = [label + '.'];
    if (!week.length) out.push('No priorities set for this week.');
    else {
      out.push(`${week.length} ${week.length === 1 ? 'priority' : 'priorities'}, ${done.length} done.`);
      if (open.length) out.push('Still open: ' + listOf(open.map(tt)) + '.');
      if (done.length) out.push('Done: ' + listOf(done.map(tt)) + '.');
    }
    play(out, label);
  }
  // A document: from the cursor to the end (or from the top when the cursor is at the start or the end).
  function readDocument() {
    unlock();
    const ed = DS.create && DS.create.editor && DS.create.editor();
    if (!ed) return;
    const doc = ed.state.doc, end = doc.content.size;
    let from = ed.state.selection.from;
    if (from <= 2 || from >= end - 2) from = 0;
    const text = doc.textBetween(from, end, '\n', ' ');
    const title = document.querySelector('.cr-title')?.value || 'Document';
    play(from === 0 ? [title + '.', text] : text, title);
  }

  /* =====================================================================
     Speaking
     ===================================================================== */
  const D = { rec: null, on: false, target: null, btn: null, bubble: null, heard: '', restarts: 0 };
  const micOn = () => store('ds_voice_mic') !== 'off';
  const lang = () => store('ds_voice_lang') || 'en-GB';

  // Spoken punctuation, and capitals at the start of sentences.
  const SPOKEN = [
    [/\s*\b(new paragraph)\b\s*/gi, '\n\n'], [/\s*\b(new line|next line)\b\s*/gi, '\n'],
    [/\s*\bfull stop\b/gi, '.'], [/\s*\bcomma\b/gi, ','], [/\s*\bquestion mark\b/gi, '?'],
    [/\s*\b(exclamation mark|exclamation point)\b/gi, '!'], [/\s*\bsemicolon\b/gi, ';'], [/\s*\bcolon\b/gi, ':'],
    [/\b(open bracket)\b\s*/gi, '('], [/\s*\b(close bracket)\b/gi, ')'], [/\s*\b(dash)\b\s*/gi, ' – ']
  ];
  function polish(raw, before) {
    let t = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    for (const [re, rep] of SPOKEN) t = t.replace(re, rep);
    t = t.replace(/\bi\b/g, 'I').replace(/\bi'(m|ll|ve|d)\b/gi, (m, x) => "I'" + x.toLowerCase());
    t = t.replace(/ +([.,;:?!)])/g, '$1').replace(/([.,;:?!])(?=[A-Za-z])/g, '$1 ').replace(/[ \t]*\n[ \t]*/g, '\n');
    const prev = String(before || '');
    const startSentence = !prev.trim() || /[.!?]["'”’)]?\s*$/.test(prev) || /\n\s*$/.test(prev);
    if (startSentence) t = t.replace(/^(\s*)([a-z])/, (m, s, c) => s + c.toUpperCase());
    t = t.replace(/([.!?]\s+|\n)([a-z])/g, (m, a, c) => a + c.toUpperCase());
    if (prev && !/[\s(\n]$/.test(prev) && !/^[.,;:?!)\n]/.test(t)) t = ' ' + t;
    return t;
  }

  const TEXTISH = /^(text|search|url|email|tel)$/i;
  const editable = n => n && n.isConnected && !n.disabled && !n.readOnly && (
    (n.tagName === 'TEXTAREA') || (n.tagName === 'INPUT' && TEXTISH.test(n.type || 'text')) || n.isContentEditable);
  const inEditor = n => !!(n && n.closest && n.closest('.cr-body'));

  function insert(raw) {
    const n = D.target;
    if (!editable(n)) return;
    if (inEditor(n) && DS.create && DS.create.editor && DS.create.editor()) {
      const ed = DS.create.editor(), { from } = ed.state.selection;
      const text = polish(raw, ed.state.doc.textBetween(Math.max(0, from - 80), from, '\n', ' '));
      if (!text) return;
      const parts = text.split(/\n+/);
      const ch = ed.chain().focus();
      parts.forEach((p, i) => { if (i) ch.splitBlock(); if (p.trim()) ch.insertContent(i ? p.replace(/^\s+/, '') : p); });
      ch.run();
      return;
    }
    if (n.isContentEditable) { document.execCommand('insertText', false, polish(raw, '')); return; }
    const s = n.selectionStart ?? n.value.length, e = n.selectionEnd ?? n.value.length;
    let text = polish(raw, n.value.slice(0, s));
    if (n.tagName === 'INPUT') text = text.replace(/\n+/g, ' ');
    const max = n.maxLength > 0 ? n.maxLength - (n.value.length - (e - s)) : Infinity;
    if (max <= 0) return;
    if (text.length > max) text = text.slice(0, max);
    n.setRangeText(text, s, e, 'end');
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setInterim(t) {
    if (!D.bubble) return;
    D.bubble.textContent = t || (D.on ? 'Listening…' : '');
    D.bubble.hidden = !D.on;
  }
  function startDictation() {
    if (!SR) {
      toast(isApple ? 'Speaking isn’t available here. Use the mic on your iPhone keyboard, or turn on Dictation in Settings → General → Keyboard.' : 'This browser can’t take dictation. Try Chrome, Edge or Safari.');
      return;
    }
    if (P.playing) pause();
    const rec = new SR();
    rec.lang = lang(); rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onresult = e => {
      let fin = '', mid = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript + ' '; else mid += r[0].transcript;
      }
      if (fin.trim()) insert(fin);
      setInterim(mid);
    };
    rec.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      const msg = {
        'not-allowed': isApple ? 'The microphone is blocked. On iPhone: Settings → Apps → Safari → Microphone → Allow (or Ask), then try again.' : 'The microphone is blocked. Allow it for this site in the address bar, then try again.',
        'service-not-allowed': isApple ? (standalone ? 'Speaking isn’t allowed in the home-screen app on this iPhone. Use the mic on the keyboard, or open the app in Safari.' : 'Turn on Dictation (Settings → General → Keyboard → Enable Dictation), then try again.') : 'Speech recognition isn’t available in this browser.',
        'network': 'Speaking needs an internet connection.',
        'audio-capture': 'No microphone was found.'
      }[e.error] || 'Speaking stopped (' + e.error + ').';
      toast(msg);
      stopDictation();
    };
    rec.onend = () => {
      // browsers stop after a pause or a minute; carry on until you tap stop
      if (D.on && D.rec === rec && D.restarts < 50) { D.restarts++; try { rec.start(); return; } catch (err) {} }
      if (D.rec === rec) stopDictation();
    };
    try { rec.start(); } catch (e) { toast('Couldn’t start the microphone.'); return; }
    D.rec = rec; D.on = true; D.restarts = 0;
    paintMic();
    setInterim('');
  }
  function stopDictation() {
    if (!D.on && !D.rec) return;
    D.on = false;
    const rec = D.rec; D.rec = null;
    try { rec && rec.stop(); } catch (e) {}
    setInterim('');
    paintMic();
  }

  /* ---------- the mic button: appears above the keyboard while you type ---------- */
  function buildMic() {
    D.bubble = el('div', { class: 'vx-heard', 'aria-live': 'polite', hidden: true });
    D.btn = el('button', { type: 'button', class: 'vx-mic', 'aria-label': 'Speak instead of typing', title: 'Speak instead of typing',
      onpointerdown: e => e.preventDefault(), onmousedown: e => e.preventDefault(),
      onclick: () => { if (D.on) stopDictation(); else { if (!editable(D.target)) return; D.target.focus({ preventScroll: true }); startDictation(); } } }, icon('mic', 22));
    D.wrap = el('div', { class: 'vx-micwrap', hidden: true }, D.bubble, D.btn);
    document.body.append(D.wrap);
  }
  function paintMic() {
    if (!D.btn) return;
    D.btn.classList.toggle('on', D.on);
    D.btn.setAttribute('aria-label', D.on ? 'Stop speaking' : 'Speak instead of typing');
    D.btn.title = D.btn.getAttribute('aria-label');
    D.btn.setAttribute('aria-pressed', String(D.on));
  }
  // Sit just above the keyboard on phones (the visual viewport shrinks when it opens), bottom right on computers.
  function placeMic() {
    if (!D.wrap || D.wrap.hidden) return;
    const vv = window.visualViewport;
    const gap = vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
    D.wrap.style.bottom = (gap + 14) + 'px';
  }
  function showMicFor(n) {
    if (!micOn() || !editable(n) || n.closest('#intro, .auth, .vx-bar')) return hideMic();
    if (!D.btn) buildMic();
    if (D.on && D.target !== n) stopDictation();
    D.target = n;
    D.wrap.hidden = false;
    D.wrap.classList.toggle('vx-unsupported', !SR);
    placeMic();
  }
  function hideMic() { if (D.wrap) D.wrap.hidden = true; stopDictation(); }
  document.addEventListener('focusin', e => showMicFor(e.target));
  document.addEventListener('focusout', () => setTimeout(() => {
    const a = document.activeElement;
    if (editable(a)) showMicFor(a); else hideMic();
  }, 120));
  if (window.visualViewport) { visualViewport.addEventListener('resize', placeMic); visualViewport.addEventListener('scroll', placeMic); }
  window.addEventListener('resize', placeMic);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopDictation(); if (P.playing) pause(); } });

  /* =====================================================================
     Buttons in the app, and the Voice section in Settings
     ===================================================================== */
  const listenBtn = (label, fn, cls) => el('button', { type: 'button', class: 'vx-listen ' + (cls || 'pill'), 'data-vx': '1', onclick: fn, 'aria-label': label, title: label }, icon('speaker', 16), el('span', {}, label));
  function inject() {
    if (!TTS) return;
    const main = document.getElementById('main');
    if (!main || !main.firstElementChild) return;
    if (state.view === 'home') {
      const shape = main.querySelector('.hm-shape');
      if (shape && !shape.querySelector('[data-vx]')) shape.append(listenBtn('Read my day', readMyDay, 'pill vx-day'));
    }
    if (state.view === 'today' || state.view === 'week') {
      const head = main.querySelector('.head');
      if (head && !head.querySelector('[data-vx]')) head.append(listenBtn('Listen', state.view === 'today' ? readToday : readWeek));
    }
    if (state.view === 'create') {
      const acts = main.querySelector('.cr-top-acts');
      if (acts && !acts.querySelector('[data-vx]')) {
        const b = el('button', { type: 'button', class: 'cr-ic', 'data-vx': '1', title: 'Listen (reads from the cursor)', 'aria-label': 'Listen to this document', onclick: readDocument }, icon('speaker', 18));
        acts.insertBefore(b, acts.firstChild);
      }
    }
    if (state.view === 'settings') injectSettings(main);
  }

  function injectSettings(main) {
    const wrap = main.firstElementChild;
    if (!wrap || wrap.querySelector('#vx-settings') || wrap.querySelector('h1')?.textContent !== 'Settings') return;
    const micBox = el('input', { type: 'checkbox', id: 'vx-mic', checked: micOn(), onchange: () => { store('ds_voice_mic', micBox.checked ? 'on' : 'off'); if (!micBox.checked) hideMic(); } });
    const langSel = el('select', { class: 'field vx-sel', 'aria-label': 'Language you speak', onchange: () => store('ds_voice_lang', langSel.value) },
      [['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['en-IN', 'English (India)'], ['en-AU', 'English (Australia)'], ['ur-PK', 'Urdu'], ['ar-SA', 'Arabic']].map(([v, l]) => el('option', { value: v }, l)));
    langSel.value = lang();
    const voiceSel = el('select', { class: 'field vx-sel', 'aria-label': 'Reading voice', onchange: () => { store('ds_voice_uri', voiceSel.value); fillVoices(); } });
    const found = el('p', { class: 'meta vx-tip' });
    const kNote = el('p', { class: 'meta vx-tip vx-knote', hidden: true }, 'Natural voices run on this device, for free and in private. The first time you listen it downloads about 90 MB, then it’s kept. It takes a moment to start, and if it ever fails your device voice reads instead.');
    const rank = v => (quality(v) === 'Premium' ? 0 : quality(v) === 'Enhanced' ? 1 : 2);
    const fillVoices = () => {
      const vs = englishVoices().slice().sort((a, b) => (/^en[-_]GB/i.test(b.lang) - /^en[-_]GB/i.test(a.lang)) || rank(a) - rank(b) || a.name.localeCompare(b.name));
      const best = bestVoice(), auto = !store('ds_voice_uri') || !vs.some(v => vid(v) === store('ds_voice_uri'));
      const kv = kokoroId();
      voiceSel.replaceChildren(el('option', { value: '' }, 'Automatic' + (best && auto && !kv ? ` (${vlabel(best)})` : '')),
        KA ? el('optgroup', { label: 'Natural voices (Kokoro, downloads once)' }, KOKORO.map(([id, name, acc]) => el('option', { value: 'kokoro:' + id }, `${name} · ${acc}`))) : null,
        el('optgroup', { label: 'Built into this device' }, vs.map(v => el('option', { value: vid(v) }, `${vlabel(v)} · ${v.lang.replace('_', '-')}`))));
      voiceSel.value = kv ? 'kokoro:' + kv : auto ? '' : store('ds_voice_uri');
      kNote.hidden = !kv;
      const good = vs.filter(v => quality(v)).length;
      found.textContent = `This device offers ${vs.length} English voice${vs.length === 1 ? '' : 's'}` + (good ? `, ${good} of them Enhanced or Premium.` : ', none of them Enhanced or Premium.')
        + (isApple && !good ? ' If you have downloaded Enhanced voices and they don’t show here, iOS isn’t sharing them with web apps on this version.' : '');
    };
    fillVoices();
    if (TTS && TTS.addEventListener) TTS.addEventListener('voiceschanged', fillVoices);
    const out = el('output', { class: 'ds-val' }, rate() + '×');
    const speed = el('input', { type: 'range', class: 'ds-range', min: '0.6', max: '2', step: '0.05', value: String(rate()), 'aria-label': 'Reading speed',
      oninput: () => { out.textContent = (+speed.value).toFixed(2).replace(/0$/, '') + '×'; }, onchange: () => store('ds_voice_rate', speed.value) });
    const sec = el('section', { class: 'section', id: 'vx-settings' }, el('h2', {}, 'Voice'),
      el('p', { class: 'meta' }, 'Speak instead of typing, and have your day or a document read to you. It uses your phone’s and browser’s own voice features, so it’s free. Saved on this device.'),
      el('h3', { class: 'vx-h' }, 'Speaking'),
      SR ? el('label', { class: 'ds-auto', for: 'vx-mic' }, micBox, el('span', {}, 'Show the mic button while I type')) : el('p', { class: 'meta vx-warn' },
        isApple ? 'Speaking isn’t available in this view on your iPhone. You can still use the mic key on the keyboard. If you have the app on your home screen, try opening it in Safari, and check Dictation is on (Settings → General → Keyboard).' : 'This browser can’t take dictation. Chrome, Edge and Safari can.'),
      SR ? el('label', { class: 'pj-lbl vx-row' }, el('span', { class: 'lbl' }, 'I speak'), langSel) : null,
      SR ? el('p', { class: 'meta vx-tip' }, 'Say “comma”, “full stop”, “question mark”, “new line” or “new paragraph” for punctuation. Tap the mic again to stop.') : null,
      el('h3', { class: 'vx-h' }, 'Listening'),
      TTS ? [
        el('label', { class: 'pj-lbl vx-row' }, el('span', { class: 'lbl' }, 'Voice'), voiceSel), kNote, found,
        el('p', { class: 'meta vx-tip' }, el('a', { href: '/voice-lab.html' }, 'Compare the voices in the Voice lab →'), ' Hear each one and see how fast it is on this device.'),
        el('div', { class: 'ds-row vx-row' }, el('span', { class: 'lbl', style: 'margin:0' }, 'Speed'), speed, out),
        el('div', { class: 'ds-row' }, el('button', { type: 'button', class: 'btn', onclick: () => { unlock(); play('Good morning, Hamid. This is how your day and your documents will sound.', 'Voice test'); } }, 'Test the voice')),
        isApple ? el('p', { class: 'meta vx-tip' }, 'For a more natural voice on iPhone: Settings → Accessibility → Read & Speak (or Spoken Content) → Voices → English, and download an “Enhanced” or “Premium” voice such as Daniel or Serena. Then pick it here.') : null
      ] : el('p', { class: 'meta vx-warn' }, 'This browser can’t read aloud.'));
    const after = wrap.querySelector('#ds-display') || wrap.querySelector('#hm-settings');
    if (after) after.after(sec); else wrap.append(sec);
  }

  let pending = false;
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; inject(); if (D.wrap && !D.wrap.hidden && !editable(D.target)) hideMic(); });
  }).observe(app, { childList: true, subtree: true });

  DS.voice = { play, stop, readMyDay, readToday, readWeek, readDocument, polish, chunk, startDictation, stopDictation };
})();
