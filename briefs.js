// Claude's briefs on Home: the morning brief (weekdays) and the weekly review (Sundays) that Claude writes through the
// connector (post_brief). The newest one shows at the top of Home with its suggestions; "Add" puts a suggestion on
// today's sheet or this week's priorities. "Open full brief" opens its HTML page; "Done reading" folds the card to one
// line (it stays until a newer brief arrives); "Earlier briefs" lists the last 20.
(function () {
  'use strict';
  const DS = window.DS; if (!DS) return;
  const { sb, q, el, uid, toast, today, weekStart, timeAgo } = DS;

  // A small, safe markdown reader: headings, bullet / numbered lists, **bold**, paragraphs. Text only (no HTML).
  function inline(text) {
    const out = []; const re = /\*\*([^*]+)\*\*/g; let i = 0, m;
    while ((m = re.exec(text))) { if (m.index > i) out.push(text.slice(i, m.index)); out.push(el('b', {}, m[1])); i = re.lastIndex; }
    if (i < text.length) out.push(text.slice(i));
    return out;
  }
  function md(src) {
    const box = el('div', { class: 'bf-body' }); let list = null, para = [];
    const flush = () => { if (para.length) { box.append(el('p', {}, inline(para.join(' ')))); para = []; } };
    for (const raw of String(src || '').split(/\r?\n/)) {
      const line = raw.trim();
      let m;
      if (!line) { flush(); list = null; continue; }
      if ((m = /^#{1,4}\s+(.*)$/.exec(line))) { flush(); list = null; box.append(el('h3', {}, inline(m[1]))); continue; }
      if ((m = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line))) {
        flush();
        if (!list) { list = el(/^\d/.test(line) ? 'ol' : 'ul', {}); box.append(list); }
        list.append(el('li', {}, inline(m[1]))); continue;
      }
      list = null; para.push(line);
    }
    flush();
    return box;
  }

  async function addSuggestion(b, i, btn) {
    const s = b.suggestions[i]; if (!s || s.added) return;
    btn.disabled = true;
    try {
      const day = s.when === 'today';
      await q(sb.from('tasks').insert({ user_id: uid(), horizon: day ? 'day' : 'week', period_start: day ? today() : weekStart(today()), title: String(s.title).slice(0, 300), position: Date.now() / 1000 }));
      b.suggestions = b.suggestions.map((x, j) => j === i ? { ...x, added: true } : x);
      await q(sb.from('briefs').update({ suggestions: b.suggestions }).eq('id', b.id));
      btn.textContent = day ? 'Added to today ✓' : 'Added to this week ✓';
      toast(day ? 'Added to today.' : 'Added to this week’s priorities.');
    } catch (e) { btn.disabled = false; toast(e.message || 'Couldn’t add that.'); }
  }
  function suggestionList(b) {
    const sg = Array.isArray(b.suggestions) ? b.suggestions.filter(s => s && s.title) : [];
    if (!sg.length) return null;
    b.suggestions = sg;
    const open = sg.map((s, i) => [s, i]).filter(([s]) => !s.added);
    const allBtn = open.length > 1 ? el('button', { class: 'btn cr-small', onclick: async e => {
      e.target.disabled = true;
      for (const btn of [...e.target.closest('.bf-sug').querySelectorAll('[data-i]')]) if (!btn.disabled) await addSuggestion(b, +btn.dataset.i, btn);
    } }, 'Add them all') : null;
    return el('div', { class: 'bf-sug' }, el('div', { class: 'bf-sugh' }, el('b', {}, 'Suggested'), allBtn),
      el('ul', {}, sg.map((s, i) => el('li', {}, el('span', {}, s.title, el('small', { class: 'meta' }, s.when === 'today' ? ' · today' : ' · this week')),
        el('button', { class: 'btn cr-small', 'data-i': String(i), disabled: !!s.added, onclick: e => addSuggestion(b, i, e.target) },
          s.added ? (s.when === 'today' ? 'Added to today ✓' : 'Added to this week ✓') : 'Add')))));
  }
  const kindName = k => k === 'weekly' ? 'Weekly review' : k === 'morning' ? 'Morning brief' : 'From Claude';

  // The brief on Home. "Done reading" folds it down to one line (it stays on Home until a newer brief arrives);
  // "Show" opens it out again.
  function card(b) {
    const box = el('section', { class: 'bf-card', 'aria-label': kindName(b.kind) });
    const pageBtn = cls => b.document_id ? el('button', { class: cls, onclick: () => openPage(b) }, 'Open full brief') : null;
    const when = el('small', { class: 'meta' }, timeAgo ? timeAgo(b.created_at) : '');
    const setRead = async on => {
      b.read_at = on ? new Date().toISOString() : null;
      paint();
      try { await q(sb.from('briefs').update({ read_at: b.read_at }).eq('id', b.id)); } catch (e) {}
    };
    function paint() {
      box.classList.toggle('min', !!b.read_at);
      if (b.read_at) {
        box.replaceChildren(el('div', { class: 'bf-mini' },
          el('div', { class: 'bf-minit' }, el('span', { class: 'bf-kind' }, kindName(b.kind)), el('b', { title: b.title }, b.title)),
          el('div', { class: 'bf-miniacts' }, pageBtn('btn primary cr-small'),
            el('button', { class: 'btn cr-small', 'aria-label': 'Show the brief', onclick: () => setRead(false) }, 'Show'),
            el('button', { class: 'linkish', onclick: earlier }, 'Earlier briefs'))));
        return;
      }
      const body = md(b.body), long = b.body.length > 900;
      if (long) body.classList.add('clip');
      box.replaceChildren(
        el('div', { class: 'bf-head' }, el('div', {}, el('span', { class: 'bf-kind' }, kindName(b.kind)), el('h2', {}, b.title)), when),
        body,
        long ? el('button', { class: 'linkish bf-more', onclick: e => { body.classList.toggle('clip'); e.target.textContent = body.classList.contains('clip') ? 'Read all' : 'Show less'; } }, 'Read all') : null,
        suggestionList(b),
        el('div', { class: 'bf-actions' }, pageBtn('btn primary'),
          el('button', { class: 'btn', onclick: () => setRead(true) }, 'Done reading'),
          el('button', { class: 'linkish', onclick: earlier }, 'Earlier briefs')));
    }
    paint();
    return box;
  }

  // the full brief (an HTML page in Create) opens full screen over Home and closes back to Home
  function openPage(b) {
    document.querySelector('dialog.bf-dlg[open]')?.close();
    if (DS.create && DS.create.open) DS.create.open(b.document_id, { from: 'home' });
  }

  async function earlier() {
    const rows = await q(sb.from('briefs').select('*').order('created_at', { ascending: false }).limit(20));
    const dlg = el('dialog', { class: 'bf-dlg' });
    const list = el('div', {}, rows.length ? rows.map(b => el('details', { class: 'bf-old' },
      el('summary', {}, el('b', {}, b.title), el('small', { class: 'meta' }, ` · ${kindName(b.kind)} · ${new Date(b.created_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`)),
      md(b.body), b.document_id ? el('button', { class: 'btn primary cr-small', onclick: () => openPage(b) }, 'Open full brief') : null, suggestionList(b))) : el('p', { class: 'meta' }, 'No briefs yet. Claude writes one each weekday morning and a review on Sunday.'));
    dlg.append(el('div', { class: 'bf-dlgh' }, el('h2', {}, 'Briefs from Claude'), el('button', { class: 'btn', onclick: () => dlg.close() }, 'Close')), list);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  // the newest brief from the last 3 days (read or not: a read one shows folded)
  async function latest() {
    const rows = await q(sb.from('briefs').select('*').order('created_at', { ascending: false }).limit(1)).catch(() => []);
    const b = rows[0];
    // a brief older than 3 days is stale on Home (still under Earlier briefs)
    return b && Date.now() - new Date(b.created_at).getTime() < 3 * 864e5 ? b : null;
  }

  const baseHome = DS.views.home;
  if (baseHome) DS.views.home = async () => {
    const [node, b] = await Promise.all([baseHome(), latest()]);
    if (!b) return node;
    const c = card(b);
    const col = node.querySelector('.hm-cols');
    if (col) col.before(c); else node.append(c);
    return node;
  };

  DS.briefs = { md, card, earlier, latest };
})();
