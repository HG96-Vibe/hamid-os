// Hamid OS branding: the name and motto in the header, a profile strip at the top of Home,
// and "Hamid OS" in the tab title and sign-in screen. Photo and signature are placeholders until the real ones arrive.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, el, state, parse, today, addDays } = DS;
  const NAME = 'Hamid OS';
  const MOTTO = 'Plan. Focus. Do. Reflect. Win.';
  const PERSON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';

  /* header name + motto */
  function decorate() {
    const brand = document.querySelector('#app .brand');
    if (brand && !brand.dataset.br) {
      brand.dataset.br = '1';
      brand.replaceChildren(el('span', { class: 'br-txt' }, el('span', { class: 'br-name' }, NAME), el('span', { class: 'br-tag' }, MOTTO)));
      brand.setAttribute('aria-label', NAME + ', go to Home');
    }
    const h1 = document.querySelector('#app .authcard h1');
    if (h1 && h1.textContent === 'Daily Sheet') h1.textContent = NAME;
  }
  /* tab title: the app writes "Daily Sheet" there; swap it for the new name */
  function fixTitle() { if (document.title.includes('Daily Sheet')) document.title = document.title.replace('Daily Sheet', NAME); }
  const titleEl = document.querySelector('title');
  if (titleEl) new MutationObserver(fixTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });
  fixTitle();

  /* close-out streak, same rule as Home: weekends with nothing written don't break it */
  async function streak() {
    const d = new Date().getHours() < 6 ? addDays(today(), -1) : today(), from = addDays(d, -90);
    const [rvs, ts] = await Promise.all([
      q(sb.from('reviews').select('period_start,closed_at').eq('horizon', 'day').gte('period_start', from).lte('period_start', d)),
      q(sb.from('tasks').select('period_start').eq('horizon', 'day').gte('period_start', from).lte('period_start', d).limit(5000))]);
    const closed = new Set(rvs.filter(r => r.closed_at).map(r => r.period_start));
    const worked = new Set(ts.map(t => t.period_start));
    let n = 0;
    for (let x = closed.has(d) ? d : addDays(d, -1), i = 0; i < 90; i++, x = addDays(x, -1)) {
      const g = parse(x).getDay();
      if (closed.has(x)) n++;
      else if ((g === 0 || g === 6) && !worked.has(x)) continue;
      else break;
    }
    return n;
  }

  /* profile strip at the top of Home */
  function strip(n) {
    const sigName = (state.settings && state.settings.display_name) || 'Hamid';
    const av = el('span', { class: 'pf-av', 'aria-hidden': 'true' });
    av.innerHTML = PERSON;
    return el('section', { class: 'pf', 'aria-label': 'Profile' },
      av,
      el('div', { class: 'pf-main' },
        el('span', { class: 'pf-sig' }, sigName),
        el('span', { class: 'pf-motto' }, MOTTO)),
      el('div', { class: 'pf-streak' }, el('b', {}, n ? `Day ${n}` : 'Day 0'), el('small', {}, 'close-out streak')));
  }
  if (DS.views.home) {
    const base = DS.views.home;
    DS.views.home = async () => {
      const [node, n] = await Promise.all([base(), streak().catch(() => 0)]);
      node.prepend(strip(n));
      return node;
    };
    if (state.user && state.view === 'home' && document.getElementById('main')) DS.refresh();
  }

  let pending = false;
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; decorate(); });
  }).observe(app, { childList: true, subtree: true });
  decorate();
})();
