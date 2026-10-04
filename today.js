// Today tab: white task strips (gold edge), the close-out card in the emerald container, and white side tiles.
// Clicking a task opens the shared side panel from outcomes.js (DS.openItem).
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, el, state, uid, toast, refresh, setTask, carry, fetchTasks, fetchReview,
    pad, today, addDays, weekStart, monthStart, fmt, dayName, CONTEXTS } = DS;

  const mins = m => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`;
  const hm = v => { const x = new Date(v); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
  let draft = null; // latest typed notes, so a page refresh mid-save never shows an older copy
  const toggle = async t => {
    const done = t.status !== 'done';
    const before = rowTops(); // where each task sat, so the list can glide into its new order
    await setTask(t.id, { status: done ? 'done' : 'open', completed_at: done ? new Date().toISOString() : null });
    await refresh();
    slide(before, t.id);
  };
  // Finished tasks (done or dropped) sit at the bottom, so what still needs doing stays at the top.
  const finished = t => t.status === 'done' || t.status === 'dropped';
  const rowTops = () => new Map([...document.querySelectorAll('.td-list > .td-row[data-oid]')].map(r => [r.dataset.oid, r.getBoundingClientRect().top]));
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function slide(before, movedId) {
    if (calm) return;
    document.querySelectorAll('.td-list > .td-row[data-oid]').forEach(r => {
      const was = before.get(r.dataset.oid); if (was == null || !r.animate) return;
      const z = r.offsetHeight ? r.getBoundingClientRect().height / r.offsetHeight : 1; // page zoom
      const dy = (was - r.getBoundingClientRect().top) / (z || 1);
      if (Math.abs(dy) < 1) return;
      r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: r.dataset.oid === movedId ? 650 : 450, easing: 'cubic-bezier(.2,.7,.2,1)' });
    });
  }

  async function viewToday() {
    const d = state.cursor, ws = weekStart(d), ms = monthStart(addDays(ws, 3));
    const [tasks, weekT, monthT, wins, rv] = await Promise.all([
      fetchTasks('day', d), fetchTasks('week', ws), fetchTasks('month', ms),
      q(sb.from('wins').select('*').eq('day', d).order('created_at')), fetchReview('day', d)]);
    const isToday = d === today();
    const live = tasks.filter(t => t.status !== 'carried');
    const done = live.filter(t => t.status === 'done').length;
    const weekTitle = Object.fromEntries(weekT.map(w => [w.id, w.title]));

    /* task strips */
    const list = el('div', { class: 'td-list' });
    // Still to do first, finished at the bottom; within each, starred (top 5) tasks lead; otherwise the usual order is kept.
    tasks.sort((a, b) => (finished(a) ? 1 : 0) - (finished(b) ? 1 : 0) || (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    tasks.forEach(t => {
      const parent = t.parent_id && weekTitle[t.parent_id];
      const focus = (t.focus_sessions || []).reduce((a, x) => a + (x.minutes || 0), 0);
      const notes = t.task_notes?.[0]?.count || 0, links = t.task_links?.[0]?.count || 0;
      const chips = [
        parent ? el('span', { class: 'td-up', title: 'Supports this week\u2019s priority' }, `\u2191 ${parent}`) : null,
        DS.proj ? DS.proj.chip(t) : (t.context ? el('span', { class: 'otag' }, t.context) : null),
        t.carry_count >= 1 ? el('span', { class: 'td-chip' + (t.carry_count >= 3 ? ' warn' : ''), title: 'Times this has been carried over' }, `carried \u00d7${t.carry_count}`) : null,
        t.status === 'carried' ? el('span', { class: 'td-chip' }, 'moved on') : null,
        t.remind_at && !t.reminded_at && t.status === 'open' ? el('span', { class: 'td-chip', title: 'Reminder set' }, `\ud83d\udd14 ${hm(t.remind_at)}`) : null,
        focus ? el('span', { class: 'td-chip', title: 'Focus time logged' }, `\u23f1 ${mins(focus)}`) : null,
        notes ? el('span', { class: 'td-chip', title: 'Updates' }, `\u270e ${notes}`) : null,
        links ? el('span', { class: 'td-chip', title: 'Links' }, `\ud83d\udd17 ${links}`) : null
      ].filter(Boolean);
      list.append(el('article', { class: `td-row s-${t.status}`, 'data-oid': t.id, 'data-pid': t.project_id || '', 'data-pos': String(t.position ?? ''),
        onclick: e => { if (!e.target.closest('button,a,input')) DS.openItem(t.id); } },
        el('button', { class: 'ocheck', disabled: t.status === 'carried',
          'aria-label': t.status === 'done' ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`,
          onclick: () => toggle(t) }, t.status === 'done' ? '\u2713' : t.status === 'carried' ? '\u2192' : t.status === 'dropped' ? '\u2013' : ''),
        el('div', { class: 'td-main' },
          el('button', { class: 'td-title', title: 'Open details', onclick: () => DS.openItem(t.id) }, t.title),
          chips.length ? el('div', { class: 'td-chips' }, chips) : null)));
    });
    if (!tasks.length) list.append(el('p', { class: 'td-empty' }, isToday ? 'Nothing written yet. What has to happen today?' : 'Nothing was written for this day.'));

    /* add strip */
    const ctx = DS.proj.picker({ value: DS.proj.lastPid(), ariaLabel: 'Project for new task' });
    const input = el('input', { class: 'onew', 'data-add': 'day', placeholder: 'Write a task and press Enter', 'aria-label': 'Add a task', maxlength: '500',
      onkeydown: async e => {
        if (e.key !== 'Enter' || !input.value.trim()) return;
        e.preventDefault();
        const title = input.value.trim(); input.value = '';
        DS.proj.saveLast(ctx.value);
        await q(sb.from('tasks').insert({ user_id: uid(), horizon: 'day', period_start: d, title, project_id: ctx.value || null, position: Date.now() / 1000 }));
        state.focusAdd = 'day';
        refresh();
      } });
    list.append(el('div', { class: 'td-add' }, el('span', { class: 'td-plus', 'aria-hidden': 'true' }, '+'), input, ctx));

    /* close-out card */
    const openTasks = tasks.filter(t => t.status === 'open');
    // Daily notes: saved automatically as you type (stored on the day's review, without closing the day).
    const noteStatus = el('span', { class: 'td-note-status', 'aria-live': 'polite' }, rv?.notes ? 'Saved' : '');
    let noteTimer = null, lastSaved = rv?.notes || '';
    const startNotes = draft && draft.d === d ? draft.v : (rv?.notes || '');
    const saveNotes = async () => {
      clearTimeout(noteTimer);
      const v = notes.value.trim();
      if (v === lastSaved) return;
      noteStatus.textContent = 'Saving\u2026';
      try {
        await q(sb.from('reviews').upsert({ user_id: uid(), horizon: 'day', period_start: d, notes: v || null, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,horizon,period_start' }));
        lastSaved = v; noteStatus.textContent = 'Saved';
        if (draft && draft.d === d && draft.v.trim() === v) draft = null;
      } catch (e) { noteStatus.textContent = 'Not saved. Check your connection.'; }
    };
    const notes = el('textarea', { class: 'td-notes', name: 'day-notes', rows: '4', maxlength: '20000', value: startNotes,
      placeholder: 'Anything worth remembering about today: calls, ideas, decisions, how it went\u2026',
      oninput: () => { draft = { d, v: notes.value }; noteStatus.textContent = ''; clearTimeout(noteTimer); noteTimer = setTimeout(saveNotes, 900); },
      onblur: saveNotes });
    const closeout = el('section', { class: 'mr-box td-close', 'aria-labelledby': 'co-card' },
      el('div', { class: 'mr-head' }, el('h2', { id: 'co-card' }, rv?.closed_at ? 'Day closed' : 'Close out the day'), el('small', {}, fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }))),
      el('label', { class: 'td-note-wrap' },
        el('span', { class: 'td-note-h' }, el('span', { class: 'td-note-lbl' }, 'Notes'), noteStatus),
        el('div', { class: 'td-pad' }, notes)),
      el('div', { class: 'td-close-row' },
        rv?.closed_at
          ? el('div', { class: 'td-scores' },
              el('div', { class: 'mr-tile' }, el('span', { class: 'mr-lbl' }, 'Energy'), el('b', { class: 'td-score' }, rv.energy ?? '\u2013')),
              el('div', { class: 'mr-tile' }, el('span', { class: 'mr-lbl' }, 'Focus'), el('b', { class: 'td-score' }, rv.focus ?? '\u2013')))
          : el('p', { class: 'td-close-note' }, openTasks.length ? `${openTasks.length} still open. Decide what carries over, log wins and rate the day.` : 'Everything\u2019s ticked off. Log your wins and rate the day.'),
        el('button', { class: 'mr-save', onclick: () => openCloseout(d, openTasks, rv) }, rv?.closed_at ? 'Edit day review' : 'Close out the day')));

    /* side tiles */
    const mini = (items, title, view, empty) => el('section', { class: 'td-tile' },
      el('div', { class: 'td-tile-h' }, el('h2', {}, title), el('button', { class: 'td-open', onclick: () => DS.go(view) }, 'Open \u2192')),
      items.length ? el('ul', { class: 'td-mini' }, items.map(t => el('li', { class: t.status === 'done' ? 'done' : '' },
        el('input', { type: 'checkbox', checked: t.status === 'done', 'aria-label': t.title, onchange: () => toggle(t) }),
        el('button', { class: 'td-mini-t', onclick: () => DS.openItem(t.id) }, t.title)))) : el('p', { class: 'td-none' }, empty));
    const winIn = el('input', { class: 'td-field', placeholder: 'Log a win and press Enter', maxlength: '1000', 'aria-label': 'Log a win',
      onkeydown: async e => {
        if (e.key !== 'Enter' || !winIn.value.trim()) return;
        e.preventDefault();
        await q(sb.from('wins').insert({ user_id: uid(), day: d, body: winIn.value.trim() }));
        refresh();
      } });
    const winsTile = el('section', { class: 'td-tile' },
      el('div', { class: 'td-tile-h' }, el('h2', {}, isToday ? 'Wins today' : 'Wins'), el('button', { class: 'td-open', onclick: () => DS.go('wins') }, 'All \u2192')),
      wins.length ? el('ul', { class: 'td-wins' }, wins.map(w => el('li', {}, el('span', {}, w.body),
        el('button', { class: 'op-x', 'aria-label': 'Remove win', onclick: async () => { await q(sb.from('wins').delete().eq('id', w.id)); refresh(); } }, '\u00d7')))) : null,
      winIn);

    return el('div', { class: 'td-cols' },
      el('div', {},
        el('div', { class: 'head' }, el('h1', {}, dayName(d)),
          el('button', { class: 'arrow', 'aria-label': 'Previous day', onclick: () => DS.go('today', addDays(d, -1)) }, '\u2039'),
          el('button', { class: 'arrow', 'aria-label': 'Next day', onclick: () => DS.go('today', addDays(d, 1)) }, '\u203a'),
          !isToday ? el('button', { class: 'pill', onclick: () => DS.go('today', today()) }, 'Back to today') : null),
        el('p', { class: 'meta' }, live.length ? `${done} of ${live.length} done${rv?.closed_at ? ' \u00b7 day closed' : ''}. Click a task to open it.` : 'A blank page.'),
        list, closeout),
      el('aside', { class: 'td-side' },
        mini(weekT.filter(t => t.status !== 'carried'), 'This week', 'week', 'No priorities set for this week yet.'),
        mini(monthT.filter(t => t.status !== 'carried'), 'This month', 'month', 'No outcomes set for this month yet.'),
        winsTile));
  }

  /* close-out dialog: carry or drop what's open, rate the day, log wins */
  function scale(name, val, legend) {
    return el('fieldset', { style: 'border:0;padding:0;margin:0' }, el('legend', { class: 'lbl' }, legend),
      el('div', { class: 'scale' }, [1, 2, 3, 4, 5].map(n => el('label', { style: 'position:relative' },
        el('input', { type: 'radio', name, value: String(n), checked: val === n }), el('span', {}, n)))));
  }
  function openCloseout(d, openTasks, rv) {
    const next = addDays(d, 1); // always the very next day, weekends included, matching the 4am rollover
    const dlg = el('dialog', { 'aria-labelledby': 'co-h' });
    const form = el('form', { class: 'dlg', onsubmit: async e => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const fd = new FormData(form);
        for (const t of openTasks) {
          const choice = fd.get('c-' + t.id);
          if (choice === 'carry') await carry(t, next);
          else if (choice === 'drop') await setTask(t.id, { status: 'dropped' });
        }
        const lines = (fd.get('wins') || '').split('\n').map(s => s.trim()).filter(Boolean);
        if (lines.length) await q(sb.from('wins').insert(lines.map(body => ({ user_id: uid(), day: d, body }))));
        await q(sb.from('reviews').upsert({ user_id: uid(), horizon: 'day', period_start: d,
          energy: fd.get('energy') ? +fd.get('energy') : null, focus: fd.get('focus') ? +fd.get('focus') : null,
          reflection: (fd.get('reflection') || '').trim() || null, closed_at: rv?.closed_at || new Date().toISOString(), updated_at: new Date().toISOString() },
          { onConflict: 'user_id,horizon,period_start' }));
        dlg.close(); toast('Day closed.'); refresh();
      } catch (err) { btn.disabled = false; }
    } },
      el('h2', { id: 'co-h' }, rv?.closed_at ? 'Day review' : 'Close out the day'),
      openTasks.length ? el('div', {}, el('span', { class: 'lbl' }, 'Still open'),
        el('ul', { class: 'carrylist' }, openTasks.map(t => el('li', {}, el('span', { class: 't' }, t.title),
          el('div', { class: 'seg', role: 'radiogroup', 'aria-label': t.title },
            [['carry', `Carry to ${fmt(next, { weekday: 'short' })}`], ['drop', 'Drop']].map(([v, l]) =>
              el('label', {}, el('input', { type: 'radio', name: 'c-' + t.id, value: v, checked: v === 'carry' }), el('span', {}, l)))))))) :
        el('p', { class: 'meta', style: 'margin:0' }, 'Nothing left open. Good day.'),
      openTasks.length ? el('p', { class: 'meta', style: 'margin:0' }, 'Anything you don\u2019t drop moves forward automatically at 4am.') : null,
      el('div', { class: 'row2' }, scale('energy', rv?.energy, 'Energy'), scale('focus', rv?.focus, 'Focus')),
      el('label', {}, el('span', { class: 'lbl' }, 'What helped or got in the way today?'), el('textarea', { class: 'field', name: 'reflection', rows: '3', value: rv?.reflection || '' })),
      el('label', {}, el('span', { class: 'lbl' }, 'Wins to log (one per line)'), el('textarea', { class: 'field', name: 'wins', rows: '3' })),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, rv?.closed_at ? 'Save review' : 'Close out the day'),
        el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel')));
    dlg.append(form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  DS.views.today = viewToday;
  if (state.user && state.view === 'today') refresh();
})();
