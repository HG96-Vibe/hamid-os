// Display size for computers: scales the whole app down so more fits on one screen.
// Defaults to 80%. The choice is kept per device (localStorage); phones are unaffected.
// Also an option to shrink the quote banner on Home. Adds a "Display size" section to Settings.
(function () {
  'use strict';
  const KEY = 'ds_display_size';
  const HERO = 'ds_hero_size';
  const SIZES = [['auto', 'Auto'], ['100', '100%'], ['90', '90%'], ['80', '80%'], ['70', '70%']];
  const root = document.documentElement;
  const desktop = window.matchMedia('(min-width:901px)');

  const read = () => { try { return localStorage.getItem(KEY) || '80'; } catch (e) { return '80'; } };
  const write = v => { try { localStorage.setItem(KEY, v); } catch (e) {} };
  const readHero = () => { try { return localStorage.getItem(HERO) || 'full'; } catch (e) { return 'full'; } };
  const writeHero = v => { try { localStorage.setItem(HERO, v); } catch (e) {} };
  // Auto: shrink to fit the window's height, between 70% and 100%.
  const autoZoom = () => Math.min(1, Math.max(0.7, Math.round(window.innerHeight / 1050 * 100) / 100));
  const zoomFor = v => v === 'auto' ? autoZoom() : Number(v) / 100 || 1;

  function apply() {
    const z = desktop.matches ? zoomFor(read()) : 1;
    root.style.setProperty('--ds-zoom', String(z));
    root.classList.toggle('ds-zoomed', z !== 1);
    root.classList.toggle('ds-hero-compact', readHero() === 'compact');
  }
  apply();
  window.addEventListener('resize', () => { if (read() === 'auto') apply(); });
  if (desktop.addEventListener) desktop.addEventListener('change', apply);

  const DS = window.DS;
  if (!DS) return;
  const { el, state } = DS;

  function injectSettings(main) {
    const wrap = main.firstElementChild;
    if (!wrap || wrap.querySelector('#ds-display') || wrap.querySelector('h1')?.textContent !== 'Settings') return;
    const cur = read();
    const sec = el('section', { class: 'section', id: 'ds-display' }, el('h2', {}, 'Display size'),
      el('p', { class: 'meta' }, 'Make everything smaller so more fits on the screen. Auto fits the size to your window. This only changes this computer; phones keep their own layout.'),
      el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Display size' },
        SIZES.map(([v, l]) => el('label', {}, el('input', { type: 'radio', name: 'ds-size', value: v, checked: v === cur,
          onchange: () => { write(v); apply(); } }), el('span', {}, l)))),
      desktop.matches ? null : el('p', { class: 'meta', style: 'margin:10px 0 0' }, 'You are on a small screen, so this has no effect here.'),
      el('p', { class: 'meta', style: 'margin:18px 0 10px' }, 'Quote banner on Home. Compact keeps the quote but takes about a third of the height.'),
      el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Quote banner' },
        [['full', 'Full'], ['compact', 'Compact']].map(([v, l]) => el('label', {}, el('input', { type: 'radio', name: 'ds-hero', value: v, checked: v === readHero(),
          onchange: () => { writeHero(v); apply(); } }), el('span', {}, l)))));
    const home = wrap.querySelector('#hm-settings');
    if (home) home.after(sec);
    else { const secs = wrap.querySelectorAll(':scope > section'); if (secs.length >= 2) secs[1].after(sec); else wrap.append(sec); }
  }

  let pending = false;
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const main = document.getElementById('main');
      if (state.view === 'settings' && main && main.firstElementChild) injectSettings(main);
    });
  }).observe(app, { childList: true, subtree: true });
})();
