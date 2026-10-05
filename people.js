// People: a light contact book for clients, partners and contacts. Each person can belong to a company or project,
// has a log of conversations (logging one sets "last spoke"), and a follow-up date that shows on Today, in the
// Calendar and as a reminder. Also: the People and Calendar items in the menu, and a People section on project pages.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, el, state, toast, refresh, today, addDays, fmt, timeAgo } = DS;
  const P = { list: [], search: '', filter: '' };
  const clean = s => String(s || '').replace(/[%_,()*\\]/g, ' ').trim();
  const nice = d => fmt(d, { weekday: 'short', day: 'numeric', month: 'short' });
  const rel = d => { const n = Math.round((new Date(d + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 864e5); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n < 0 ? `${-n} days ago` : n < 7 ? fmt(d, { weekday: 'long' }) : nice(d); };
  const initials = n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

  async function load() { P.list = await q(sb.from('people').select('*').order('name')); return P.list; }

  /* ---------- the People page ---------- */
  async function viewPeople() {
    await Promise.all([load(), DS.proj.ensure()]);
    const t0 = today();
    const due = P.list.filter(p => p.follow_up_on && p.follow_up_on <= addDays(t0, 7)).sort((a, b) => (a.follow_up_on < b.follow_up_on ? -1 : 1));
    const listBox = el('div', { class: 'pp-grid' });
    const draw = () => {
      const s = P.search.toLowerCase();
      const shown = P.list.filter(p => (!s || [p.name, p.company, p.role, p.email, p.notes].some(v => (v || '').toLowerCase().includes(s)))
        && (!P.filter || (P.filter === 'none' ? !p.project_id : (DS.proj.byId(p.project_id) && (p.project_id === P.filter || DS.proj.byId(p.project_id).parent_id === P.filter)))));
      listBox.replaceChildren(...(shown.length ? shown.map(card) : [el('p', { class: 'meta' }, P.list.length ? 'No one matches.' : 'No one here yet. Add the people you work with: clients, partners, suppliers.')]));
    };
    const search = el('input', { class: 'field pp-search', type: 'search', placeholder: 'Search people', value: P.search, 'aria-label': 'Search people', oninput: e => { P.search = e.target.value; draw(); } });
    const filt = el('select', { class: 'field pp-filter', 'aria-label': 'Company or project', onchange: e => { P.filter = e.target.value; draw(); } },
      el('option', { value: '' }, 'Everyone'), ...DS.proj.roots().map(r => el('option', { value: r.id }, r.name)), el('option', { value: 'none' }, 'No company or project'));
    filt.value = P.filter;
    draw();
    return el('div', { class: 'pp' },
      el('div', { class: 'head' }, el('h1', {}, 'People'), el('button', { class: 'btn primary pp-add', onclick: () => editPerson({}) }, '+ Add person')),
      el('p', { class: 'meta' }, 'Clients, partners and contacts. Log when you speak and set a follow-up: it shows on Today, in the Calendar and as a reminder.'),
      due.length ? el('section', { class: 'pp-due' }, el('h2', {}, 'Follow-ups'),
        el('ul', {}, due.map(p => el('li', { class: p.follow_up_on < t0 ? 'late' : p.follow_up_on === t0 ? 'now' : '' },
          el('button', { class: 'linkish', onclick: () => open(p.id) }, p.name),
          el('span', { class: 'pp-when' }, p.follow_up_on < t0 ? `overdue · ${rel(p.follow_up_on)}` : rel(p.follow_up_on)))))) : null,
      el('div', { class: 'pp-tools' }, search, filt), listBox);
  }
  function card(p) {
    const proj = p.project_id && DS.proj.byId(p.project_id);
    const t0 = today();
    return el('button', { type: 'button', class: 'pp-card', style: proj ? `--pj:${DS.proj.color(p.project_id)}` : '', onclick: () => open(p.id) },
      el('span', { class: 'pp-av', 'aria-hidden': 'true' }, initials(p.name)),
      el('span', { class: 'pp-main' }, el('b', {}, p.name), el('small', {}, [p.role, p.company].filter(Boolean).join(' · ') || (proj ? proj.name : ''))),
      el('span', { class: 'pp-side' },
        proj ? el('span', { class: 'pp-proj' }, proj.name) : null,
        p.follow_up_on ? el('span', { class: 'pp-fu' + (p.follow_up_on < t0 ? ' late' : p.follow_up_on === t0 ? ' now' : '') }, 'Follow up ' + rel(p.follow_up_on)) : null,
        p.last_contact_on ? el('small', {}, 'Spoke ' + rel(p.last_contact_on)) : null));
  }

  /* ---------- add / edit ---------- */
  function editPerson(p, onDone) {
    const isNew = !p.id;
    const dlg = el('dialog', { class: 'pp-dlg', 'aria-label': isNew ? 'Add person' : 'Edit person' });
    const f = (name, label, value, attrs = {}) => el('label', { class: 'pp-f' }, el('span', {}, label), el(attrs.tag || 'input', { class: 'field', name, value: value || '', ...attrs }));
    const proj = DS.proj.picker({ value: p.project_id || '', className: 'field', ariaLabel: 'Company or project', noneLabel: 'None' });
    const form = el('form', { class: 'dlg pp-form', onsubmit: async e => {
      e.preventDefault();
      const fd = new FormData(form), v = k => (fd.get(k) || '').toString().trim() || null;
      if (!v('name')) return form.querySelector('[name=name]').focus();
      const row = { name: v('name').slice(0, 120), role: v('role'), company: v('company'), email: v('email'), phone: v('phone'), notes: v('notes'), project_id: proj.value || null, follow_up_on: v('follow_up_on') };
      try {
        if (isNew) { const r = await q(sb.from('people').insert({ user_id: DS.uid(), ...row }).select().single()); toast(`${r.name} added.`); dlg.close(); onDone ? onDone(r) : open(r.id); }
        else { await q(sb.from('people').update(row).eq('id', p.id)); Object.assign(p, row); toast('Saved.'); dlg.close(); onDone && onDone(p); }
        if (state.view === 'people') refresh();
      } catch (er) {}
    } },
      el('h2', {}, isNew ? 'Add person' : 'Edit ' + p.name),
      f('name', 'Name', p.name, { required: true, maxlength: '120', autocomplete: 'off' }),
      el('div', { class: 'row2' }, f('role', 'Role', p.role, { maxlength: '120', placeholder: 'e.g. Finance director' }), f('company', 'Their company', p.company, { maxlength: '120' })),
      el('label', { class: 'pp-f' }, el('span', {}, 'Your company or project'), proj),
      el('div', { class: 'row2' }, f('email', 'Email', p.email, { type: 'email', maxlength: '200' }), f('phone', 'Phone', p.phone, { type: 'tel', maxlength: '60' })),
      f('follow_up_on', 'Follow up on', p.follow_up_on, { type: 'date' }),
      f('notes', 'Notes', p.notes, { tag: 'textarea', rows: '3', maxlength: '5000' }),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, isNew ? 'Add' : 'Save'), el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel')));
    dlg.append(form); dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal(); form.querySelector('[name=name]').focus();
  }

  /* ---------- one person ---------- */
  async function open(id) {
    document.querySelector('dialog.pp-dlg')?.close();
    const [rows, notes] = await Promise.all([q(sb.from('people').select('*').eq('id', id)), q(sb.from('people_notes').select('*').eq('person_id', id).order('on_date', { ascending: false }).order('created_at', { ascending: false }))]);
    const p = rows[0]; if (!p) return toast('That person isn’t here any more.');
    await DS.proj.ensure();
    const t0 = today();
    const dlg = el('dialog', { class: 'pp-dlg pp-person', 'aria-label': p.name });
    const changed = () => { if (['people', 'today', 'calendar', 'projects'].includes(state.view)) refresh(); };
    const setFollow = async d => { await q(sb.from('people').update({ follow_up_on: d }).eq('id', p.id)); p.follow_up_on = d; toast(d ? `Follow up ${rel(d)}.` : 'Follow-up cleared.'); paint(); changed(); };
    const noteIn = el('textarea', { class: 'field', rows: '2', maxlength: '5000', placeholder: 'What did you talk about?' });
    const noteDate = el('input', { class: 'field pp-date', type: 'date', value: t0, max: t0, 'aria-label': 'When' });
    const body = el('div', { class: 'pp-body' });
    function paint() {
      const proj = p.project_id && DS.proj.byId(p.project_id);
      body.replaceChildren(
        el('div', { class: 'pp-head' }, el('span', { class: 'pp-av big', 'aria-hidden': 'true' }, initials(p.name)),
          el('div', {}, el('h2', {}, p.name), el('p', { class: 'meta' }, [p.role, p.company].filter(Boolean).join(' · '))),
          el('button', { class: 'pp-x', 'aria-label': 'Close', onclick: () => dlg.close() }, '×')),
        el('div', { class: 'pp-facts' },
          proj ? el('button', { class: 'pill', onclick: () => { dlg.close(); DS.proj.open(proj.id); } }, proj.name) : null,
          p.email ? el('a', { class: 'pill', href: 'mailto:' + p.email }, '✉ ' + p.email) : null,
          p.phone ? el('a', { class: 'pill', href: 'tel:' + p.phone.replace(/\s+/g, '') }, '☎ ' + p.phone) : null,
          p.last_contact_on ? el('span', { class: 'pill' }, 'Spoke ' + rel(p.last_contact_on)) : null),
        p.notes ? el('p', { class: 'pp-notes' }, p.notes) : null,
        el('section', { class: 'pp-sec' }, el('h3', {}, 'Follow up'),
          el('div', { class: 'pp-fus' },
            p.follow_up_on ? el('span', { class: 'pp-fu' + (p.follow_up_on < t0 ? ' late' : p.follow_up_on === t0 ? ' now' : '') }, (p.follow_up_on < t0 ? 'Overdue · ' : '') + rel(p.follow_up_on)) : el('span', { class: 'meta' }, 'None set'),
            ...[['Tomorrow', 1], ['Next week', 7], ['In 2 weeks', 14], ['In a month', 30]].map(([l, n]) => el('button', { type: 'button', class: 'btn cr-small', onclick: () => setFollow(addDays(t0, n)) }, l)),
            el('input', { type: 'date', class: 'field pp-date', 'aria-label': 'Follow up on a date', value: p.follow_up_on || '', onchange: e => setFollow(e.target.value || null) }),
            p.follow_up_on ? el('button', { type: 'button', class: 'btn cr-small', onclick: () => setFollow(null) }, p.follow_up_on <= t0 ? 'Done' : 'Clear') : null)),
        el('section', { class: 'pp-sec' }, el('h3', {}, 'Conversations'),
          el('form', { class: 'pp-log', onsubmit: async e => {
            e.preventDefault(); const b = noteIn.value.trim(); if (!b) return noteIn.focus();
            const d = noteDate.value || t0;
            const n = await q(sb.from('people_notes').insert({ user_id: DS.uid(), person_id: p.id, on_date: d, body: b.slice(0, 5000) }).select().single());
            notes.unshift(n); notes.sort((a, c) => (a.on_date < c.on_date ? 1 : -1));
            if (!p.last_contact_on || d > p.last_contact_on) { await q(sb.from('people').update({ last_contact_on: d }).eq('id', p.id)); p.last_contact_on = d; }
            noteIn.value = ''; toast('Logged.'); paint(); changed();
          } }, noteIn, el('div', { class: 'pp-logrow' }, noteDate, el('button', { class: 'btn primary', type: 'submit' }, 'Log conversation'))),
          notes.length ? el('ul', { class: 'pp-tl' }, notes.map(n => el('li', {}, el('time', {}, nice(n.on_date)), el('p', {}, n.body),
            el('button', { class: 'pp-del', 'aria-label': 'Delete this entry', onclick: async () => { if (!confirm('Delete this entry?')) return; await q(sb.from('people_notes').delete().eq('id', n.id)); notes.splice(notes.indexOf(n), 1); paint(); } }, '×')))) : el('p', { class: 'meta' }, 'Nothing logged yet.')),
        el('div', { class: 'actions pp-acts' },
          el('button', { class: 'btn', onclick: () => editPerson(p, () => { paint(); changed(); }) }, 'Edit'),
          el('button', { class: 'btn danger', onclick: async () => { if (!confirm(`Delete ${p.name} and their conversation log?`)) return; await q(sb.from('people').delete().eq('id', p.id)); toast('Deleted.'); dlg.close(); changed(); } }, 'Delete')));
    }
    paint();
    dlg.append(el('div', { class: 'dlg' }, body));
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  /* ---------- on a project page ---------- */
  function forProject(ids, mainId) {
    const box = el('section', { class: 'section pp-pj' }, el('h2', {}, 'People'), el('p', { class: 'meta' }, 'Loading…'));
    q(sb.from('people').select('*').in('project_id', ids).order('name')).then(rows => {
      box.replaceChildren(el('div', { class: 'pp-pjh' }, el('h2', {}, 'People'), el('button', { class: 'btn cr-small', onclick: () => editPerson({ project_id: mainId }, () => refresh()) }, '+ Add person')),
        rows.length ? el('div', { class: 'pp-grid' }, rows.map(card)) : el('p', { class: 'meta' }, 'No one linked to this yet.'));
    }, () => box.remove());
    return box;
  }

  /* ---------- follow-ups on Today ---------- */
  const baseToday = DS.views.today;
  if (baseToday) DS.views.today = async () => {
    const node = await baseToday();
    if (state.cursor !== today()) return node;
    const due = await q(sb.from('people').select('id,name,company,follow_up_on').lte('follow_up_on', today()).order('follow_up_on')).catch(() => []);
    if (!due.length) return node;
    const strip = el('section', { class: 'pp-today' }, el('h2', {}, 'Follow up'),
      el('ul', {}, due.map(p => el('li', {}, el('button', { class: 'linkish', onclick: () => open(p.id) }, p.name), p.company ? el('span', { class: 'meta' }, ' · ' + p.company) : null,
        p.follow_up_on < today() ? el('span', { class: 'pp-fu late' }, 'overdue') : null))));
    const list = node.querySelector('.td-list');
    if (list) list.before(strip); else node.prepend(strip);
    return node;
  };

  /* ---------- menu items: Calendar (after Month) and People (after Projects) ---------- */
  function ensureNav() {
    const nav = document.querySelector('#app nav.nav'); if (!nav) return;
    const add = (key, label, view, after) => {
      let b = nav.querySelector(`[data-${key}]`);
      if (!b) {
        b = el('button', { [`data-${key}`]: '', onclick: () => DS.go(view) }, label);
        const a = after(); if (a) a.after(b); else nav.append(b);
      }
      if (state.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    };
    add('calendar', 'Calendar', 'calendar', () => [...nav.querySelectorAll('button')].find(x => x.textContent.trim() === 'Month'));
    add('people', 'People', 'people', () => nav.querySelector('[data-projects]'));
  }
  let pending = false;
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; ensureNav(); }); }).observe(app, { childList: true, subtree: true });
  for (const v of ['people', 'calendar']) if (location.hash.slice(1) === v) { state.view = v; if (state.user && document.getElementById('main')) DS.go(v); }

  DS.views.people = viewPeople;
  DS.people = { open, edit: editPerson, forProject, load };
})();
