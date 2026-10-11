// Goals: your overall goals, on their own (not tied to projects, money or tasks), to read every day.
// Each goal has a title, why it matters, and a timeline of steps you set yourself (each with an optional date).
// Goals you reach move to Achieved. Reorder with Move up / Move down.
(function () {
  'use strict';
  const DS = window.DS; if (!DS) return;
  const { sb, q, el, state, toast, refresh, today, fmt } = DS;

  async function load() {
    const [goals, steps] = await Promise.all([
      q(sb.from('life_goals').select('*').order('position')),
      q(sb.from('life_goal_steps').select('*').order('position'))]);
    return { goals, steps };
  }
  const stepOrder = (a, b) => (a.due_on || '9999') < (b.due_on || '9999') ? -1 : (a.due_on || '9999') > (b.due_on || '9999') ? 1 : a.position - b.position;
  const when = d => {
    const t0 = today(), days = Math.round((Date.parse(d) - Date.parse(t0)) / 864e5);
    const label = fmt(d, { day: 'numeric', month: 'short', ...(d.slice(0, 4) !== t0.slice(0, 4) ? { year: 'numeric' } : {}) });
    return { label, cls: days < 0 ? 'late' : days <= 14 ? 'soon' : '' };
  };

  /* ---------- add / edit a goal ---------- */
  function editGoal(g = {}) {
    const isNew = !g.id;
    const dlg = el('dialog', { class: 'pp-dlg gl-dlg', 'aria-label': isNew ? 'Add a goal' : 'Edit goal' });
    const title = el('input', { class: 'field', maxlength: '200', value: g.title || '', placeholder: 'e.g. Build a business that runs without me', 'aria-label': 'Goal', required: true });
    const why = el('textarea', { class: 'field', rows: '4', maxlength: '2000', placeholder: 'Why it matters to you (optional)', 'aria-label': 'Why it matters' }, g.why || '');
    const form = el('form', { class: 'dlg', onsubmit: async e => {
      e.preventDefault();
      const t = title.value.trim(); if (!t) return title.focus();
      const row = { title: t.slice(0, 200), why: why.value.trim().slice(0, 2000) || null, updated_at: new Date().toISOString() };
      try {
        if (isNew) await q(sb.from('life_goals').insert({ user_id: DS.uid(), ...row, position: Date.now() / 1000 }));
        else await q(sb.from('life_goals').update(row).eq('id', g.id));
        dlg.close(); toast(isNew ? 'Goal added.' : 'Saved.'); refresh();
      } catch (er) {}
    } },
      el('h2', {}, isNew ? 'Add a goal' : 'Edit goal'),
      el('label', { class: 'pp-f' }, el('span', {}, 'Goal'), title),
      el('label', { class: 'pp-f' }, el('span', {}, 'Why it matters'), why),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, isNew ? 'Add goal' : 'Save'), el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel')));
    dlg.append(form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal(); title.focus();
  }

  /* ---------- one goal ---------- */
  function card(g, steps, i, list) {
    const mine = steps.filter(s => s.goal_id === g.id).sort(stepOrder);
    const done = mine.filter(s => s.done_at).length;
    const menu = el('div', { class: 'gl-menu', role: 'menu', hidden: true });
    const close = () => { menu.hidden = true; document.removeEventListener('pointerdown', outside, true); };
    const outside = e => { if (!menu.contains(e.target) && !e.target.closest('.gl-more')) close(); };
    const item = (label, fn) => el('button', { type: 'button', role: 'menuitem', onclick: () => { close(); fn(); } }, label);
    const swap = async dir => {
      const other = list[i + dir]; if (!other) return;
      await q(sb.from('life_goals').update({ position: other.position }).eq('id', g.id));
      await q(sb.from('life_goals').update({ position: g.position }).eq('id', other.id));
      refresh();
    };
    menu.append(
      item('Edit', () => editGoal(g)),
      !g.achieved_at && i > 0 ? item('Move up', () => swap(-1)) : null,
      !g.achieved_at && i < list.length - 1 ? item('Move down', () => swap(1)) : null,
      g.achieved_at ? item('Not achieved yet', async () => { await q(sb.from('life_goals').update({ achieved_at: null }).eq('id', g.id)); refresh(); })
        : item('Mark as achieved 🎉', async () => { await q(sb.from('life_goals').update({ achieved_at: new Date().toISOString() }).eq('id', g.id)); toast('Goal achieved. Well done.'); refresh(); }),
      item('Delete', async () => { if (!confirm(`Delete “${g.title}” and its timeline?`)) return; await q(sb.from('life_goals').delete().eq('id', g.id)); toast('Deleted.'); refresh(); }));
    const more = el('button', { type: 'button', class: 'gl-more', 'aria-label': `More for ${g.title}`, 'aria-haspopup': 'menu', onclick: () => {
      menu.hidden = !menu.hidden; if (!menu.hidden) { document.addEventListener('pointerdown', outside, true); menu.querySelector('button').focus(); }
    } }, '⋯');
    menu.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); more.focus(); } });

    // the timeline
    const stepRow = s => {
      const w = s.due_on ? when(s.due_on) : null;
      const date = el('input', { type: 'date', class: 'gl-date' + (w && !s.done_at ? ' ' + w.cls : ''), value: s.due_on || '', 'aria-label': `Date for ${s.title}`, title: 'Change the date',
        onchange: async e => { await q(sb.from('life_goal_steps').update({ due_on: e.target.value || null }).eq('id', s.id)); refresh(); } });
      return el('li', { class: 'gl-step' + (s.done_at ? ' done' : '') },
        el('input', { type: 'checkbox', checked: !!s.done_at, 'aria-label': `Done: ${s.title}`, onchange: async e => {
          await q(sb.from('life_goal_steps').update({ done_at: e.target.checked ? new Date().toISOString() : null }).eq('id', s.id)); refresh(); } }),
        el('button', { type: 'button', class: 'gl-st', title: 'Rename', onclick: async () => {
          const t = prompt('Step', s.title); if (t == null || !t.trim()) return;
          await q(sb.from('life_goal_steps').update({ title: t.trim().slice(0, 300) }).eq('id', s.id)); refresh(); } }, s.title),
        w ? el('span', { class: 'gl-when ' + (s.done_at ? '' : w.cls) }, w.label) : null,
        date,
        el('button', { type: 'button', class: 'gl-x', 'aria-label': `Remove ${s.title}`, title: 'Remove', onclick: async () => {
          await q(sb.from('life_goal_steps').delete().eq('id', s.id)); refresh(); } }, '×'));
    };
    const stepIn = el('input', { class: 'field', maxlength: '300', placeholder: 'A step on the way', 'aria-label': 'New step' });
    const stepDate = el('input', { class: 'field gl-newdate', type: 'date', 'aria-label': 'Its date (optional)' });
    const addForm = el('form', { class: 'gl-add', hidden: true, onsubmit: async e => {
      e.preventDefault(); const t = stepIn.value.trim(); if (!t) return stepIn.focus();
      await q(sb.from('life_goal_steps').insert({ user_id: DS.uid(), goal_id: g.id, title: t.slice(0, 300), due_on: stepDate.value || null, position: Date.now() / 1000 }));
      refresh();
    } }, stepIn, stepDate, el('button', { class: 'btn primary cr-small', type: 'submit' }, 'Add'));
    const addBtn = el('button', { type: 'button', class: 'linkish gl-addbtn', onclick: () => { addForm.hidden = false; addBtn.hidden = true; stepIn.focus(); } }, '+ Add a step');

    return el('article', { class: 'gl-card' + (g.achieved_at ? ' achieved' : '') },
      el('div', { class: 'gl-head' },
        el('span', { class: 'gl-n', 'aria-hidden': 'true' }, g.achieved_at ? '✓' : String(i + 1)),
        el('div', { class: 'gl-tt' }, el('h2', {}, g.title),
          g.achieved_at ? el('small', { class: 'gl-ach' }, 'Achieved ' + fmt(g.achieved_at.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })) : null),
        el('div', { class: 'gl-morewrap' }, more, menu)),
      g.why ? el('p', { class: 'gl-why' }, g.why) : null,
      mine.length ? el('div', { class: 'gl-tl' },
        el('div', { class: 'gl-tlh' }, el('span', {}, 'Timeline'), el('small', {}, `${done} of ${mine.length} done`),
          el('span', { class: 'gl-prog', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.round(done / mine.length * 100)}%` }))),
        el('ol', { class: 'gl-steps' }, mine.map(stepRow))) : null,
      g.achieved_at ? null : el('div', { class: 'gl-foot' }, addBtn, addForm));
  }

  /* ---------- the tab ---------- */
  async function viewGoals() {
    const { goals, steps } = await load();
    const active = goals.filter(g => !g.achieved_at), done = goals.filter(g => g.achieved_at).sort((a, b) => (a.achieved_at < b.achieved_at ? 1 : -1));
    return el('div', { class: 'gl' },
      el('div', { class: 'head gl-top' },
        el('div', {}, el('h1', {}, 'Goals'), el('p', { class: 'meta' }, 'What you’re working towards. Read them every day.')),
        el('button', { class: 'btn primary', onclick: () => editGoal() }, '+ Add a goal')),
      active.length ? el('div', { class: 'gl-list' }, active.map((g, i, l) => card(g, steps, i, l)))
        : el('div', { class: 'gl-empty' }, el('p', {}, goals.length ? 'Every goal is achieved. Time to set the next one.' : 'Write down the few things you really want: for your work, your health, your family, yourself. Add steps with dates when you’re ready.'),
          el('button', { class: 'btn primary', onclick: () => editGoal() }, '+ Add your first goal')),
      done.length ? el('details', { class: 'gl-done' }, el('summary', {}, `Achieved (${done.length})`), el('div', { class: 'gl-list' }, done.map((g, i, l) => card(g, steps, i, l)))) : null);
  }
  DS.views.goals = viewGoals;

  /* ---------- in the menu: right after Home ---------- */
  function ensureNav() {
    const nav = document.querySelector('#app nav.nav'); if (!nav) return;
    let b = nav.querySelector('[data-goals]');
    if (!b) {
      b = el('button', { 'data-goals': '', onclick: () => DS.go('goals') }, 'Goals');
      const home = [...nav.querySelectorAll('button')].find(x => x.textContent.trim() === 'Home');
      if (home) home.after(b); else nav.prepend(b);
    }
    if (state.view === 'goals') b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  let pending = false;
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; ensureNav(); }); }).observe(app, { childList: true, subtree: true });
  if (location.hash.slice(1) === 'goals') { state.view = 'goals'; if (state.user && document.getElementById('main')) DS.go('goals'); }

  DS.goals = { load, edit: editGoal };
})();
