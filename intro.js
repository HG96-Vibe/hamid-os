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
  function go() {
    if (started || done) return;
    started = true;
    el.classList.add('in-go');
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
