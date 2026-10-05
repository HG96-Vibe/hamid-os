// The bell in the top bar, next to search: the last 20 notifications you were sent (heads-ups, reminders, reports,
// Claude's briefs), newest first. Five show at a time and the rest scroll. A count shows how many are new; opening
// the list marks them read. Click one to go where it points.
(function () {
  'use strict';
  const DS = window.DS; if (!DS) return;
  const { sb, q, el, state, timeAgo } = DS;
  let items = [], panel = null, loading = null, lastLoad = 0;

  const BELL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  // a small sign for each kind of notification (from its tag)
  const kindOf = tag => {
    const t = String(tag || '');
    if (/^(dd|bud|debt)-/.test(t)) return ['money', '£'];
    if (/^ms-/.test(t)) return ['milestone', '◆'];
    if (/^fu-/.test(t)) return ['person', '👤'];
    if (/^streak-/.test(t)) return ['streak', '🔥'];
    if (/^brief-/.test(t)) return ['brief', '✦'];
    if (/^report-/.test(t)) return ['report', '▤'];
    if (/^task-/.test(t)) return ['task', '⏰'];
    return ['other', '•'];
  };
  // '/#capital' → the Capital tab, '/' → Home
  function goTo(url) {
    const h = String(url || '').split('#')[1] || '';
    const view = { capital: 'money', '': 'home' }[h] ?? h;
    if (DS.views[view]) DS.go(view); else DS.go('home');
  }

  async function load(force) {
    if (!state.user) return;
    if (!force && Date.now() - lastLoad < 20000) return;
    if (loading) return loading;
    loading = (async () => {
      try { items = await q(sb.from('notifications').select('id,title,body,url,tag,created_at,read_at').order('created_at', { ascending: false }).limit(20)); lastLoad = Date.now(); }
      catch (e) { /* keep what we had */ }
      loading = null; paintBadge(); if (panel) paintList();
    })();
    return loading;
  }
  const unread = () => items.filter(n => !n.read_at).length;

  function paintBadge() {
    const btn = document.querySelector('#app .nt-btn'); if (!btn) return;
    const n = unread();
    let b = btn.querySelector('.nt-badge');
    if (!n) { b && b.remove(); btn.setAttribute('aria-label', 'Notifications'); return; }
    if (!b) { b = el('span', { class: 'nt-badge', 'aria-hidden': 'true' }); btn.append(b); }
    b.textContent = n > 9 ? '9+' : String(n);
    btn.setAttribute('aria-label', `Notifications, ${n} new`);
  }

  function paintList() {
    const list = panel.querySelector('.nt-list'), fresh = panel._fresh || new Set();
    list.replaceChildren(...(items.length ? items.map(n => {
      const [k, sign] = kindOf(n.tag);
      return el('li', {}, el('button', { type: 'button', class: `nt-it k-${k}${fresh.has(n.id) ? ' new' : ''}`, title: n.body ? `${n.title}\n${n.body}` : n.title, onclick: () => { close(); goTo(n.url); } },
        el('span', { class: 'nt-ic', 'aria-hidden': 'true' }, sign),
        el('span', { class: 'nt-tx' }, el('b', {}, n.title), n.body ? el('span', { class: 'nt-body' }, n.body) : null,
          el('small', {}, timeAgo ? timeAgo(n.created_at) : new Date(n.created_at).toLocaleString('en-GB'))),
        fresh.has(n.id) ? el('i', { class: 'nt-dot', 'aria-label': 'New' }) : null));
    }) : [el('li', { class: 'nt-empty' }, el('b', {}, 'Nothing yet'),
      el('span', {}, 'Heads-ups land here: direct debits due tomorrow, budgets nearly used, milestones and follow-ups due, reminders, reports and Claude’s briefs.'))]));
    panel.querySelector('.nt-count').textContent = items.length ? `Last ${items.length}` : '';
  }

  function place() {
    const btn = document.querySelector('#app .nt-btn'); if (!btn || !panel) return;
    const r = btn.getBoundingClientRect(), w = Math.min(400, window.innerWidth - 32);
    panel.style.width = w + 'px';
    panel.style.top = Math.round(r.bottom + 10) + 'px';
    panel.style.left = Math.round(Math.max(16, Math.min(window.innerWidth - w - 16, r.right - w))) + 'px';
  }

  async function open() {
    if (panel) return close();
    panel = el('div', { class: 'nt-panel', role: 'dialog', 'aria-label': 'Notifications' },
      el('div', { class: 'nt-head' }, el('h2', {}, 'Notifications'), el('span', { class: 'nt-count' }),
        el('button', { type: 'button', class: 'nt-x', 'aria-label': 'Close', onclick: () => close() }, '×')),
      el('ul', { class: 'nt-list', tabindex: '0', 'aria-label': 'Your last 20 notifications' }));
    document.body.append(panel); place(); paintList();
    document.querySelector('#app .nt-btn')?.setAttribute('aria-expanded', 'true');
    await load(true);
    // what was new stays marked while the list is open; the count clears
    const ids = items.filter(n => !n.read_at).map(n => n.id);
    panel._fresh = new Set(ids); paintList();
    if (ids.length) {
      const now = new Date().toISOString();
      items.forEach(n => { if (ids.includes(n.id)) n.read_at = now; });
      paintBadge();
      q(sb.from('notifications').update({ read_at: now }).in('id', ids)).catch(() => {});
    }
    setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc, true); }, 0);
  }
  function close() {
    if (!panel) return;
    panel.remove(); panel = null;
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true);
    document.querySelector('#app .nt-btn')?.setAttribute('aria-expanded', 'false');
  }
  const outside = e => { if (panel && !panel.contains(e.target) && !e.target.closest('.nt-btn')) close(); };
  const esc = e => { if (e.key === 'Escape') { close(); document.querySelector('#app .nt-btn')?.focus(); } };
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });

  // the bell sits just after the magnifier (search)
  function ensureButton() {
    const acts = document.querySelector('#app header.bar .baractions');
    if (!acts || acts.querySelector('.nt-btn') || !state.user) return;
    const btn = el('button', { type: 'button', class: 'nt-btn', title: 'Notifications', 'aria-label': 'Notifications', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => open() },
      Object.assign(el('span', { 'aria-hidden': 'true' }), { innerHTML: BELL }));
    const search = acts.querySelector('.kp-btn');
    if (search) search.after(btn); else acts.prepend(btn);
    paintBadge(); load();
  }
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => ensureButton()).observe(app, { childList: true, subtree: true });
  ensureButton();
  // keep the count fresh
  setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 120000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
  // a push arriving while the app is open
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', () => load(true));

  DS.notify = { open, close, load };
})();
