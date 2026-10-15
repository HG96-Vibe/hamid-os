// The app refresh (reload with the latest version): click the logo / "Hamid OS" in the header, or press Cmd+R / Ctrl+R,
// and Cmd+Left / Cmd+Right to move between tabs.
// (Themes, including light mode, are in themes.js.)
(function () {
  'use strict';
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
  // Cmd+Left / Cmd+Right (Ctrl on Windows): the previous / next tab in the menu, wrapping round at the ends.
  // Left alone while typing (there it moves the cursor to the start / end of the line) or with a dialog open.
  document.addEventListener('keydown', function (e) {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    var t = e.target;
    if (t && t.closest && t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return;
    if (document.querySelector('dialog[open]')) return;
    var tabs = Array.prototype.slice.call(document.querySelectorAll('#app nav.nav > button'));
    if (tabs.length < 2) return;
    var i = tabs.findIndex(function (b) { return b.getAttribute('aria-current') === 'page'; });
    var n = tabs.length, next = i < 0 ? 0 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    e.preventDefault();
    tabs[next].click();
  }, true);
  // The logo and "Hamid OS" in the header refresh the app.
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#app .brand')) { e.preventDefault(); refresh(); }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#app .brand')) { e.preventDefault(); refresh(); }
  });

})();
