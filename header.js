// Header, option B: a floating capsule on desktop and a bottom dock on phones, with the bulb as the logo.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { el, state } = DS;
  const PATHS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    today: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'
  };
  function icon(name, size) {
    const s = document.createElement('span');
    s.className = 'hd-i';
    s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
    return s;
  }

  /* desktop capsule: swap the text buttons for icon buttons */
  function decorate() {
    const bar = document.querySelector('#app header.bar');
    if (!bar) return false;
    if (bar.dataset.hd) return true;
    bar.dataset.hd = '1';
    const [cap, foc] = bar.querySelectorAll('.baractions .btn');
    if (cap) { cap.classList.add('hd-cap'); cap.setAttribute('aria-label', 'Capture a thought'); cap.replaceChildren(icon('plus', 18), el('span', { class: 'hd-l' }, 'Capture')); }
    if (foc) { foc.classList.add('hd-foc'); foc.setAttribute('aria-label', 'Start a focus block'); foc.replaceChildren(icon('timer', 18), el('span', { class: 'hd-l' }, 'Focus')); }
    return true;
  }

  /* phone dock */
  const MORE = [['month', 'Month'], ['projects', 'Projects'], ['create', 'Create'], ['listen', 'Listen'], ['inbox', 'Inbox'], ['insights', 'Insights'], ['history', 'History'], ['wins', 'Wins'], ['settings', 'Settings']];
  const inboxCount = () => +(document.getElementById('inbox-count')?.textContent || 0);
  function openMore() {
    if (document.querySelector('dialog.dk-sheet')) return;
    const n = inboxCount();
    const dlg = el('dialog', { class: 'dk-sheet', 'aria-label': 'More sections' });
    dlg.append(
      el('div', { class: 'dk-grid' }, MORE.map(([v, label]) => el('button', { class: 'dk-item' + (state.view === v ? ' on' : ''), onclick: () => { dlg.close(); DS.go(v); } },
        label, v === 'inbox' && n ? el('span', { class: 'count' }, String(n)) : null))),
      el('button', { class: 'btn dk-close', onclick: () => dlg.close() }, 'Close'));
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }
  const tab = (view, label, name) => el('button', { class: 'dk', 'data-v': view, onclick: () => DS.go(view, view === 'home' ? undefined : DS.today()) }, icon(name, 22), el('span', {}, label));
  let dock = null, badge = null;
  function buildDock() {
    badge = el('span', { class: 'dk-badge' });
    dock = el('nav', { class: 'dock', 'aria-label': 'Sections' },
      tab('home', 'Home', 'home'), tab('today', 'Today', 'today'),
      el('button', { class: 'dk-cap', 'aria-label': 'Capture a thought', onclick: () => document.querySelector('#app .hd-cap')?.click() }, icon('plus', 26)),
      tab('week', 'Week', 'week'),
      el('button', { class: 'dk', 'data-v': 'more', onclick: openMore }, icon('more', 22), el('span', {}, 'More'), badge));
  }

  function sync() {
    const on = decorate();
    document.body.classList.toggle('has-dock', on);
    if (!on) { dock?.remove(); return; }
    if (!dock) buildDock();
    if (!dock.isConnected) document.body.append(dock);
    const cur = ['home', 'today', 'week'].includes(state.view) ? state.view : 'more';
    dock.querySelectorAll('[data-v]').forEach(b => { if (b.dataset.v === cur) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const n = inboxCount();
    badge.textContent = n ? String(n) : '';
  }

  let pending = false;
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; sync(); });
  }).observe(app, { childList: true, subtree: true });
  sync();
})();
