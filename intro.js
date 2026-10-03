// Opening animation: waits (at most 0.8s) for the font and bulb image so nothing pops in mid-animation,
// then plays and holds on the "Hamid OS" name until you click, tap or press a key. Not shown at all on phones.
(function () {
  var el = document.getElementById('intro');
  if (!el) return;
  var done = false, started = false;
  var phone = window.matchMedia && matchMedia('(max-width: 900px)').matches;
  if (phone) { el.parentNode.removeChild(el); return; }
  function end() {
    if (done) return;
    done = true;
    el.classList.add('in-out');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 600);
  }
  // Slide the name to the exact middle of the screen once the bulb fades out (and keep it there on resize).
  var stage = el.querySelector('.in-stage'), name = el.querySelector('.in-name'), shift = 0, held = false;
  function centre(pending) {
    if (!stage || !name || done) return;
    var r = name.getBoundingClientRect();
    shift += window.innerHeight / 2 - (r.top - (pending || 0) + r.height / 2);
    stage.style.transform = 'translateY(' + Math.round(shift) + 'px)';
  }
  window.addEventListener('resize', function () { if (held) centre(0); });
  function go() {
    if (started || done) return;
    started = true;
    el.classList.add('in-go');
    var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(function () { held = true; centre(still ? 0 : 16); }, still ? 50 : 2700); // the name is still 16px low until its own animation runs
  }
  var waits = [];
  try { if (document.fonts && document.fonts.load) waits.push(document.fonts.load('800 40px "Bricolage Grotesque"')); } catch (e) {}
  try { var bg = new Image(); bg.src = '/intro-aurora.webp'; if (bg.decode) waits.push(bg.decode().catch(function () {})); } catch (e) {}
  var img = el.querySelector('.in-bulb');
  if (img && img.decode) waits.push(img.decode().catch(function () {}));
  if (window.Promise && waits.length) Promise.all(waits).then(go, go);
  else go();
  setTimeout(go, 800);
  el.addEventListener('click', end);
  el.addEventListener('touchend', end, { passive: true });
  document.addEventListener('keydown', end, { once: true });
})();
