// Opening screen (desktop only): aurora photo, "Hamid OS", the signature, and the motto looping underneath.
// "Parade": each word sweeps in from the left to the centre, holds, then sweeps out to the right as the next arrives.
// It stays until you click, tap or press a key. Phones skip it entirely.
(function () {
  var el = document.getElementById('intro');
  if (!el) return;
  var phone = window.matchMedia && matchMedia('(max-width: 900px)').matches;
  if (phone) { el.parentNode.removeChild(el); return; }
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
  function end() {
    if (done) return;
    done = true; clearTimeout(timer);
    el.classList.add('in-out');
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

  el.addEventListener('click', end);
  el.addEventListener('touchend', end, { passive: true });
  document.addEventListener('keydown', end, { once: true });
})();
