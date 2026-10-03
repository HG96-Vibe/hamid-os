// Opening screen (computers and phones): aurora photo, "Hamid OS", the signature, and the motto looping underneath.
// "Parade": each word sweeps in from the left to the centre, holds, then sweeps out to the right as the next arrives.
// It stays until you click, tap or press a key. With sound on (the default), the first tap starts the "Aurora pad"
// music while the screen stays up, and the second tap goes to Home as the music fades. The speaker button in the
// corner mutes it (remembered per device); muted, one tap goes straight to Home. Browsers only allow sound after a tap.
(function () {
  var el = document.getElementById('intro');
  if (!el) return;
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stage = el.querySelector('.in-stage');
  var WORDS = [['plan', 'Plan.'], ['focus', 'Focus.'], ['do', 'Do.'], ['reflect', 'Reflect.'], ['win', 'Win.']];
  var done = false, started = false, timer = null;

  // The motto's own typefaces are only needed here, so they load only when this screen shows.
  var fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2?family=Archivo+Black&family=Bebas+Neue&family=DM+Serif+Display:ital@1&family=Playfair+Display:ital,wght@1,900&display=swap';
  document.head.appendChild(fonts);

  function word(k, t) { var s = document.createElement('span'); s.className = 'in-w'; s.setAttribute('data-k', k); s.textContent = t; return s; }
  function move(e, from, to, ms, ease) {
    if (!e.animate) { e.style.transform = to.transform; e.style.opacity = to.opacity; return; }
    e.animate([from, to], { duration: ms, easing: ease, fill: 'forwards' });
  }

  var i = 0;
  function next() {
    if (done) return;
    var w = WORDS[i % WORDS.length]; i++;
    var e = word(w[0], w[1]);
    stage.appendChild(e);
    var off = stage.clientWidth / 2 + e.offsetWidth;
    move(e, { transform: 'translate(calc(-50% - ' + off + 'px),-50%) skewX(12deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) skewX(0deg)', opacity: 1 }, 750, 'cubic-bezier(.2,.7,.2,1)');
    timer = setTimeout(function () {
      move(e, { transform: 'translate(-50%,-50%) skewX(0deg)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + off + 'px),-50%) skewX(-12deg)', opacity: 0 }, 650, 'cubic-bezier(.6,0,.8,.4)');
      setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 700);
      timer = setTimeout(next, 250);
    }, 750 + 900);
  }

  // While this screen shows, tint the phone's status bar to match it (light mode would otherwise make it off-white).
  var meta = document.querySelector('meta[name="theme-color"]'), tint = meta && meta.getAttribute('content');
  if (meta) meta.setAttribute('content', '#07051a');

  function start() {
    if (started || done) return;
    started = true;
    el.classList.add('in-on');
    if (reduced) {
      var line = document.createElement('div'); line.className = 'in-line';
      WORDS.forEach(function (w) { line.appendChild(word(w[0], w[1])); });
      stage.appendChild(line);
    } else next();
  }
  /* ---------- "Aurora pad": a slow, warm chord made live with Web Audio (nothing is downloaded) ---------- */
  var SOUND_KEY = 'ds_intro_sound';
  var soundOn = function () { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { return true; } };
  var AC = window.AudioContext || window.webkitAudioContext, ac = null, out = null, playing = false;
  function music() {
    if (!AC || playing) return false;
    try {
      ac = ac || new AC(); if (ac.state === 'suspended') ac.resume();
      var t = ac.currentTime + .05, mtof = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };
      out = ac.createGain(); out.gain.value = .9;
      var comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      var verb = ac.createConvolver(), len = ac.sampleRate * 3.2, ir = ac.createBuffer(2, len, ac.sampleRate);
      for (var ch = 0; ch < 2; ch++) { var d = ir.getChannelData(ch); for (var k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / len, 2.6); }
      verb.buffer = ir; var wet = ac.createGain(); wet.gain.value = .55;
      var bus = ac.createGain(); bus.connect(out); bus.connect(verb); verb.connect(wet); wet.connect(out); out.connect(comp); comp.connect(ac.destination);
      var pad = function (notes, attack, level, cutoff, type) {
        var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = .6; f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(cutoff, t + attack * 1.4);
        var lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = .08; lg.gain.value = cutoff * .25; lfo.connect(lg); lg.connect(f.frequency); lfo.start(t);
        var g = ac.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(level, t + attack);
        notes.forEach(function (m) { [-7, 0, 7].forEach(function (c) { var o = ac.createOscillator(); o.type = type; o.frequency.value = mtof(m); o.detune.value = c; o.connect(f); o.start(t); }); });
        f.connect(g); g.connect(bus);
      };
      pad([48, 55, 59, 62, 64], 3.5, .045, 1600, 'sawtooth'); // C major 9
      pad([36], 4, .05, 500, 'triangle');                     // low C underneath
      playing = true; el.classList.add('in-music');
      return true;
    } catch (e) { return false; }
  }
  function fadeMusic(sec) {
    if (!playing || !ac) return;
    playing = false; el.classList.remove('in-music');
    out.gain.setTargetAtTime(.0001, ac.currentTime, sec / 4);
    var a = ac; setTimeout(function () { try { a.close(); } catch (e) {} }, sec * 1000 + 400);
    ac = null;
  }

  // Speaker button in the corner: mute / unmute, remembered on this device.
  var SPK_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  var SPK_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>';
  var spk = document.createElement('button');
  spk.type = 'button'; spk.className = 'in-spk';
  function paintSpk() { var on = soundOn(); spk.innerHTML = on ? SPK_ON : SPK_OFF; spk.setAttribute('aria-label', on ? 'Mute opening music' : 'Turn on opening music'); spk.title = spk.getAttribute('aria-label'); }
  spk.addEventListener('click', function (e) {
    e.stopPropagation();
    var on = !soundOn();
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch (er) {}
    paintSpk();
    if (on) music(); else fadeMusic(1.2);
  });
  paintSpk();
  el.appendChild(spk);

  // First tap starts the music (if it is on and not playing yet); otherwise the tap goes to Home.
  function tap() {
    if (done) return;
    if (soundOn() && !playing && !heard && music()) { heard = true; return; }
    end();
  }
  var heard = false;

  function end() {
    if (done) return;
    done = true; clearTimeout(timer);
    fadeMusic(2.5);
    el.classList.add('in-out');
    if (meta) meta.setAttribute('content', document.documentElement.classList.contains('light') ? '#f6f4ef' : (tint === '#07051a' ? '#1e1b4b' : tint || '#1e1b4b'));
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 600);
  }

  // Wait (at most 1s) for the fonts and photo so nothing pops in mid-animation.
  var waits = [];
  if (window.Promise) waits.push(new Promise(function (ok) { fonts.onload = ok; fonts.onerror = ok; }).then(function () {
    if (!document.fonts || !document.fonts.load) return;
    return Promise.all(['400 40px "Bebas Neue"', '400 40px "Archivo Black"', 'italic 400 40px "DM Serif Display"', 'italic 900 40px "Playfair Display"', '800 40px "Bricolage Grotesque"', '400 40px "Mrs Saint Delafield"']
      .map(function (f) { return document.fonts.load(f).catch(function () {}); }));
  }));
  try { var bg = new Image(); bg.src = '/intro-aurora.webp'; if (bg.decode) waits.push(bg.decode().catch(function () {})); } catch (e) {}
  if (window.Promise && waits.length) Promise.all(waits).then(start, start); else start();
  setTimeout(start, 1000);

  el.addEventListener('click', tap);
  document.addEventListener('keydown', function onKey(e) { if (done) { document.removeEventListener('keydown', onKey); return; } if (e.target === spk || e.key === 'Tab') return; tap(); });
})();
