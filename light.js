// Light mode ("Paper"). Dark is the default; the sun / moon button on the Home profile strip switches.
// Also the app refresh (reload with the latest version): click the logo / "Hamid OS" in the header, or press Cmd+R / Ctrl+R.
// The choice is kept per device. Loaded in <head> so the page never flashes the wrong theme.
(function () {
  'use strict';
  var KEY = 'ds_theme';
  var root = document.documentElement;
  var read = function () { try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; } };
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.8 6.8 0 0 0 10.7 10.7z"/></svg>';

  function apply(mode) {
    var light = mode === 'light';
    root.classList.toggle('light', light);
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', light ? '#f6f4ef' : '#1e1b4b');
    var cs = document.querySelector('meta[name="color-scheme"]'); if (cs) cs.setAttribute('content', light ? 'light' : 'dark');
    var b = document.querySelector('.lt-toggle');
    if (b) {
      b.innerHTML = light ? MOON : SUN;
      b.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
      b.title = b.getAttribute('aria-label');
    }
    window.dispatchEvent(new Event('ds-theme'));
  }
  apply(read());

  function toggle() {
    var next = read() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply(next);
  }

  // Fetch the newest copy of the page (skipping the browser cache), check for a new service worker, then reload.
  var refreshing = false;
  function refresh() {
    if (refreshing) return;
    refreshing = true;
    var brand = document.querySelector('#app .brand'); if (brand) brand.classList.add('br-spin');
    var done = function () { location.reload(); };
    var jobs = [fetch('/', { cache: 'reload' }).catch(function () {})];
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      jobs.push(navigator.serviceWorker.getRegistration().then(function (r) { return r && r.update(); }).catch(function () {}));
    }
    Promise.all(jobs).then(done, done);
    setTimeout(done, 4000);
  }
  window.DS_refresh = refresh;

  // Cmd+R (Mac) / Ctrl+R: the full app refresh instead of a plain reload. Shift+Cmd+R is left to the browser.
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); refresh(); }
  }, true);
  // The logo and "Hamid OS" in the header refresh the app.
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#app .brand')) { e.preventDefault(); refresh(); }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#app .brand')) { e.preventDefault(); refresh(); }
  });

  // Put the sun / moon button on the Home profile strip whenever it is drawn.
  function inject() {
    var pf = document.querySelector('#app .pf');
    if (!pf || pf.querySelector('.lt-toggle')) return;
    var box = document.createElement('div'); box.className = 'lt-stack';
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'lt-toggle';
    b.addEventListener('click', toggle);
    box.appendChild(b);
    pf.appendChild(box);
    apply(read());
  }
  var pending = false;
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; inject(); });
  }).observe(root, { childList: true, subtree: true });
})();
