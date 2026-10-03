// Display size for computers: scales the whole app down so more fits on one screen.
// Defaults to 88%. The choice is kept per device (localStorage); phones are unaffected.
// Also an option to shrink the quote banner on Home. Adds a "Display size" section to Settings.
(function () {
  'use strict';
  const KEY = 'ds_display_size';
  const HERO = 'ds_hero_size';
  const root = document.documentElement;
  const desktop = window.matchMedia('(min-width:901px)');

  const read = () => { try { return localStorage.getItem(KEY) || '88'; } catch (e) { return '88'; } };
  // 3 Oct 2026: the default went from 80% to 88%; move anyone still on the old default along with it.
  try { if (!localStorage.getItem('ds_display_v2')) { if (localStorage.getItem(KEY) === '80') localStorage.setItem(KEY, '88'); localStorage.setItem('ds_display_v2', '1'); } } catch (e) {}
  const write = v => { try { localStorage.setItem(KEY, v); } catch (e) {} };
  const readHero = () => { try { return localStorage.getItem(HERO) || 'smaller'; } catch (e) { return 'smaller'; } };
  const writeHero = v => { try { localStorage.setItem(HERO, v); } catch (e) {} };
  // Auto: shrink to fit the window's height, between 70% and 100%.
  const autoZoom = () => Math.min(1, Math.max(0.7, Math.round(window.innerHeight / 1050 * 100) / 100));
  const zoomFor = v => v === 'auto' ? autoZoom() : Math.min(1.2, Math.max(.6, Number(v) / 100 || .88));

  function apply() {
    const z = desktop.matches ? zoomFor(read()) : 1;
    root.style.setProperty('--ds-zoom', String(z));
    root.classList.toggle('ds-zoomed', z !== 1);
    root.classList.toggle('ds-hero-compact', readHero() === 'compact');
    root.classList.toggle('ds-hero-smaller', readHero() === 'smaller');
  }
  apply();
  window.addEventListener('resize', () => { if (read() === 'auto') apply(); });
  if (desktop.addEventListener) desktop.addEventListener('change', apply);

  const DS = window.DS;
  if (!DS) return;
  const { el, state } = DS;

  // Slider from 60% to 120% in 1% steps. The size is applied when the slider is released (Settings itself resizes,
  // so applying while dragging would move the slider under your finger). "Fit to my window" is the old Auto.
  const MIN = 60, MAX = 120, DEF = 88;
  function sizeControl(cur) {
    const isAuto = cur === 'auto';
    const pct = () => Math.round((isAutoNow() ? autoZoom() : zoomFor(read())) * 100);
    const isAutoNow = () => read() === 'auto';
    const out = el('output', { class: 'ds-val', for: 'ds-range' }, pct() + '%');
    const range = el('input', { type: 'range', id: 'ds-range', class: 'ds-range', min: String(MIN), max: String(MAX), step: '1', value: String(pct()),
      disabled: isAuto, 'aria-label': 'Display size, percent',
      oninput: () => { out.textContent = range.value + '%'; },
      onchange: () => { write(String(range.value)); apply(); out.textContent = range.value + '%'; } });
    const auto = el('input', { type: 'checkbox', id: 'ds-auto', checked: isAuto,
      onchange: () => { write(auto.checked ? 'auto' : String(range.value)); range.disabled = auto.checked; apply(); range.value = String(pct()); out.textContent = pct() + '%'; } });
    const reset = el('button', { type: 'button', class: 'btn ds-reset', onclick: () => { auto.checked = false; range.disabled = false; write(String(DEF)); apply(); range.value = String(DEF); out.textContent = DEF + '%'; } }, `Reset to ${DEF}%`);
    return el('div', { class: 'ds-size' },
      el('div', { class: 'ds-row' }, el('span', { class: 'ds-end', 'aria-hidden': 'true' }, 'A'), range, el('span', { class: 'ds-end big', 'aria-hidden': 'true' }, 'A'), out),
      el('div', { class: 'ds-row' }, el('label', { class: 'ds-auto', for: 'ds-auto' }, auto, el('span', {}, 'Fit to my window automatically')), reset));
  }

  function injectSettings(main) {
    const wrap = main.firstElementChild;
    if (!wrap || wrap.querySelector('#ds-display') || wrap.querySelector('h1')?.textContent !== 'Settings') return;
    const cur = read();
    const sec = el('section', { class: 'section', id: 'ds-display' }, el('h2', {}, 'Display size'),
      el('p', { class: 'meta' }, 'Slide to make everything smaller or bigger; the new size applies when you let go. This only changes this computer; phones keep their own layout.'),
      sizeControl(cur),
      desktop.matches ? null : el('p', { class: 'meta', style: 'margin:10px 0 0' }, 'You are on a small screen, so this has no effect here.'),
      el('p', { class: 'meta', style: 'margin:18px 0 10px' }, 'Quote banner on Home. Smaller is the full banner at 70%. Compact keeps the quote on one or two lines.'),
      el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Quote banner' },
        [['full', 'Full'], ['smaller', 'Smaller'], ['compact', 'Compact']].map(([v, l]) => el('label', {}, el('input', { type: 'radio', name: 'ds-hero', value: v, checked: v === readHero(),
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
