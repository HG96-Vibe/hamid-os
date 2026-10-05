// Search everything and quick add: Ctrl/⌘ + K anywhere (or the magnifier in the top bar).
// Type to find tasks, documents, payments, thoughts, projects, people, repeating tasks and music, or type a command:
//   £12 lunch / +2,500 salary / 49 figma #augustova   → a payment (money out unless it's income or starts with +)
//   task call Sam tomorrow / task plan Q4 this week    → a task (today, tomorrow, a weekday, a date, this week, this month)
//   thought newsletter idea                           → the Inbox
//   follow up Sam friday                              → a follow-up on a person (People)
//   open PCTR / go capital                            → jump to a project, person, document or section
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, el, state, toast, today, addDays, weekStart, monthStart, fmt } = DS;
  const SECTIONS = [['home', 'Home'], ['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['calendar', 'Calendar'], ['projects', 'Projects'], ['people', 'People'],
    ['create', 'Create'], ['listen', 'Listen'], ['capital', 'Capital'], ['inbox', 'Inbox'], ['insights', 'Insights'], ['history', 'History'], ['wins', 'Wins'], ['reports', 'Reports'], ['settings', 'Settings']];
  const clean = s => String(s || '').replace(/[%_,()*\\]/g, ' ').trim();
  const money = p => (p < 0 ? '−' : '+') + '£' + (Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ---------- "tomorrow", "friday", "12 oct", "2026-10-12", "this week", "this month" ---------- */
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const pad = n => String(n).padStart(2, '0');
  // finds a date phrase at the end (or start) of text; returns { text (without it), when: {horizon, period} | null, day }
  function parseWhen(text) {
    let s = ' ' + String(text || '').trim() + ' ';
    const t0 = today();
    const found = (re, fn) => { const m = re.exec(s); if (!m) return null; const v = fn(m); if (!v) return null; s = s.replace(m[0], ' '); return v; };
    const day = d => ({ horizon: 'day', period: d, day: d });
    const r = found(/\s(?:on\s+|for\s+)?(today|tonight)\s/i, () => day(t0))
      || found(/\s(?:on\s+|for\s+)?(tomorrow|tmrw|tmr)\s/i, () => day(addDays(t0, 1)))
      || found(/\s(?:for\s+)?(this|next)\s+week\s/i, m => ({ horizon: 'week', period: m[1].toLowerCase() === 'next' ? addDays(weekStart(t0), 7) : weekStart(t0) }))
      || found(/\s(?:for\s+)?(this|next)\s+month\s/i, m => { const ms = monthStart(t0); const d = new Date(ms + 'T12:00:00'); if (m[1].toLowerCase() === 'next') d.setMonth(d.getMonth() + 1); return { horizon: 'month', period: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01` }; })
      || found(/\s(?:on\s+|by\s+)?(next\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday|rsday)?\s/i, m => {
        const i = DAYS.findIndex(d => d.startsWith(m[2].toLowerCase().slice(0, 3)));
        const now = new Date(t0 + 'T12:00:00'); let diff = (i - now.getDay() + 7) % 7; if (diff === 0) diff = 7; if (m[1]) diff += diff < 7 ? 7 : 0;
        return day(addDays(t0, diff)); })
      || found(/\s(?:on\s+|by\s+)?(\d{4})-(\d{2})-(\d{2})\s/, m => day(`${m[1]}-${m[2]}-${m[3]}`))
      || found(/\s(?:on\s+|by\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?\s/i, m => {
        const y0 = +t0.slice(0, 4), mo = MON[m[2].toLowerCase()], d = +m[1]; let y = m[3] ? +m[3] : y0;
        let iso = `${y}-${pad(mo + 1)}-${pad(d)}`; if (!m[3] && iso < t0) iso = `${y + 1}-${pad(mo + 1)}-${pad(d)}`;
        return isNaN(Date.parse(iso)) ? null : day(iso); })
      || found(/\s(?:on\s+|by\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s/, m => {
        const y0 = +t0.slice(0, 4); let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : y0;
        let iso = `${y}-${pad(+m[2])}-${pad(+m[1])}`; if (!m[3] && iso < t0) iso = `${y + 1}-${pad(+m[2])}-${pad(+m[1])}`;
        return isNaN(Date.parse(iso)) ? null : day(iso); });
    return { text: s.replace(/\s+/g, ' ').trim(), when: r || null };
  }
  const whenLabel = w => !w ? 'today' : w.horizon === 'week' ? (w.period === weekStart(today()) ? 'this week' : 'week of ' + fmt(w.period, { day: 'numeric', month: 'short' }))
    : w.horizon === 'month' ? (w.period === monthStart(today()) ? 'this month' : fmt(w.period, { month: 'long' }))
    : w.period === today() ? 'today' : w.period === addDays(today(), 1) ? 'tomorrow' : fmt(w.period, { weekday: 'long', day: 'numeric', month: 'short' });

  /* ---------- commands ---------- */
  async function books() { await DS.proj.ensure(); const r = DS.proj.roots().filter(p => p.status === 'active'); return [...r.filter(p => p.kind === 'personal'), ...r.filter(p => p.kind !== 'personal')]; }
  function parse(raw) {
    const s = raw.trim(); let m;
    if (!s) return null;
    if ((m = /^(?:task|todo|to do|t)\s*[:\s]\s*(.+)$/i.exec(s))) { const w = parseWhen(m[1]); return w.text ? { kind: 'task', title: w.text, when: w.when } : null; }
    if ((m = /^(?:thought|idea|note|inbox|capture)\s*[:\s]\s*(.+)$/i.exec(s))) return { kind: 'thought', body: m[1].trim() };
    if ((m = /^follow[\s-]?up(?:\s+with)?\s+(.+)$/i.exec(s))) { const w = parseWhen(m[1]); return { kind: 'follow', name: w.text, when: w.when && w.when.day ? w.when.day : addDays(today(), 1) }; }
    if ((m = /^(?:open|go(?:\s+to)?)\s+(.+)$/i.exec(s))) return { kind: 'open', what: m[1].trim() };
    // money: an amount with £ or +/-, or "spent/paid … 12.50"
    if (window.MoneyCore && (/^[+\-]?\s*£\s*\d|^[+\-]\s*\d|^(spent|paid|bought|got paid|received)\b/i.test(s) || /^\d+(?:\.\d{1,2})?\s+[a-z]/i.test(s))) {
      let book = null, txt = s;
      const b = /\s#([\w&-]+)\s*$/.exec(' ' + s); if (b) { book = b[1]; txt = s.replace(/\s*#[\w&-]+\s*$/, ''); }
      const r = window.MoneyCore.quick(txt);
      if (r.pence) return { kind: 'money', pence: r.pence, desc: r.desc || 'Payment', income: r.income, book };
    }
    return null;
  }
  async function run(cmd) {
    if (cmd.kind === 'task') {
      const w = cmd.when || { horizon: 'day', period: today() };
      await q(sb.from('tasks').insert({ user_id: DS.uid(), horizon: w.horizon, period_start: w.period, title: cmd.title.slice(0, 500), position: Date.now() / 1000 }));
      toast(`Added to ${whenLabel(cmd.when)}: ${cmd.title}`);
    } else if (cmd.kind === 'thought') {
      await q(sb.from('inbox').insert({ user_id: DS.uid(), body: cmd.body.slice(0, 5000) }));
      toast('Saved to your Inbox.');
    } else if (cmd.kind === 'money') {
      const bs = await books(); if (!bs.length) return toast('Open Capital once to set up your books.');
      const n = (cmd.book || '').toLowerCase();
      const bk = n ? bs.find(b => b.name.toLowerCase().startsWith(n)) : bs[0];
      if (!bk) return toast(`No book called “${cmd.book}”.`);
      const [cats, rules] = await Promise.all([q(sb.from('money_categories').select('name,kind').eq('book_id', bk.id)), q(sb.from('money_rules').select('pattern,category').eq('book_id', bk.id))]);
      const kind = cmd.income ? 'in' : 'out', names = cats.filter(c => c.kind === kind).map(c => c.name);
      const key = window.MoneyCore.merchantKey(cmd.desc), rule = key && rules.find(r => r.pattern === key);
      const category = rule && names.includes(rule.category) ? rule.category : window.MoneyCore.guess(cmd.desc, names);
      await q(sb.from('money_tx').insert({ user_id: DS.uid(), book_id: bk.id, occurred_on: today(), amount_pence: cmd.income ? cmd.pence : -cmd.pence,
        description: cmd.desc.slice(0, 300), category, source: 'manual' }));
      toast(`${bk.name}: ${money(cmd.income ? cmd.pence : -cmd.pence)} ${cmd.desc}${category ? ' · ' + category : ''}`);
    } else if (cmd.kind === 'follow') {
      const ps = await q(sb.from('people').select('id,name').ilike('name', `%${clean(cmd.name)}%`).limit(5));
      if (!ps.length) { toast(`No one called “${cmd.name}” in People.`); return false; }
      await q(sb.from('people').update({ follow_up_on: cmd.when }).eq('id', ps[0].id));
      toast(`Follow up with ${ps[0].name}: ${fmt(cmd.when, { weekday: 'long', day: 'numeric', month: 'short' })}.`);
    }
    if (['today', 'week', 'month', 'home', 'inbox', 'capital', 'people', 'calendar'].includes(state.view)) DS.refresh();
    return true;
  }

  /* ---------- search ---------- */
  async function search(term) {
    const t = clean(term); if (t.length < 2) return [];
    const w = `%${t}%`, low = t.toLowerCase();
    const safe = p => p.then(r => r, () => []);
    const [tasks, docs, pays, thoughts, people, reps, listen] = await Promise.all([
      safe(q(sb.from('tasks').select('id,title,horizon,period_start,status').ilike('title', w).neq('status', 'carried').order('period_start', { ascending: false }).limit(6))),
      safe(q(sb.from('documents').select('id,title,file,updated_at').is('deleted_at', null).or(`title.ilike.${w},plain.ilike.${w}`).order('updated_at', { ascending: false }).limit(5))),
      safe(q(sb.from('money_tx').select('*').ilike('description', w).order('occurred_on', { ascending: false }).limit(5))),
      safe(q(sb.from('inbox').select('id,body,created_at').is('done_at', null).ilike('body', w).limit(4))),
      safe(q(sb.from('people').select('id,name,company,role').or(`name.ilike.${w},company.ilike.${w}`).limit(5))),
      safe(q(sb.from('task_repeats').select('id,title,days').ilike('title', w).limit(3))),
      safe(q(sb.from('listen_items').select('id,title,category').ilike('title', w).limit(3)))]);
    await DS.proj.ensure();
    const projs = (DS.proj.roots().flatMap(r => [r, ...DS.proj.kids(r.id)])).filter(p => p.name.toLowerCase().includes(low)).slice(0, 5);
    const secs = SECTIONS.filter(([, l]) => l.toLowerCase().startsWith(low));
    const out = [];
    const add = (group, items) => items.forEach(it => out.push({ group, ...it }));
    add('Go to', secs.map(([v, l]) => ({ label: l, sub: 'Section', go: () => DS.go(v, v === 'today' ? today() : undefined) })));
    add('Projects', projs.map(p => ({ label: p.name, sub: p.parent_id ? (DS.proj.byId(p.parent_id) || {}).name : p.kind === 'personal' ? 'Personal' : 'Company', go: () => DS.proj.open(p.id) })));
    add('People', people.map(p => ({ label: p.name, sub: [p.role, p.company].filter(Boolean).join(' · ') || 'Person', go: () => DS.people ? DS.people.open(p.id) : DS.go('people') })));
    add('Tasks', tasks.map(x => ({ label: x.title, sub: `${{ day: 'Task', week: 'Priority', month: 'Outcome' }[x.horizon]} · ${fmt(x.period_start, { day: 'numeric', month: 'short' })}${x.status === 'done' ? ' · done' : ''}`,
      go: () => { DS.go(x.horizon === 'day' ? 'today' : x.horizon, x.period_start); if (DS.openItem) setTimeout(() => DS.openItem(x.id), 250); } })));
    add('Repeating', reps.map(r => ({ label: '↻ ' + r.title, sub: DS.repeats ? DS.repeats.label(r.days) : 'Repeats', go: () => DS.repeats && DS.repeats.open({ focus: r.id }) })));
    add('Documents', docs.map(d => ({ label: d.title, sub: d.file ? (d.file.ext === 'html' ? 'HTML page' : 'File') : 'Document', go: () => DS.create && DS.create.open(d.id) })));
    add('Payments', pays.map(p => ({ label: p.description, sub: `${money(p.amount_pence)} · ${fmt(p.occurred_on, { day: 'numeric', month: 'short', year: '2-digit' })}`,
      go: () => { if (DS.money && DS.money.show) DS.money.show(p); else DS.go('capital'); } })));
    add('Inbox', thoughts.map(i => ({ label: i.body.slice(0, 120), sub: 'Thought', go: () => DS.go('inbox') })));
    add('Listen', listen.map(l => ({ label: l.title || 'Untitled', sub: l.category, go: () => DS.go('listen') })));
    return out;
  }

  /* ---------- the window ---------- */
  function open(prefill = '') {
    if (document.querySelector('dialog.kp-dlg')) return;
    const dlg = el('dialog', { class: 'kp-dlg', 'aria-label': 'Search and quick add' });
    const input = el('input', { class: 'kp-in', type: 'text', autocomplete: 'off', spellcheck: 'false', value: prefill, 'aria-label': 'Search or type a command',
      placeholder: 'Search, or: £12 lunch · task call Sam tomorrow · thought … · open PCTR', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'kp-list' });
    const list = el('div', { class: 'kp-list', id: 'kp-list', role: 'listbox' });
    let items = [], sel = 0, seq = 0, timer = null;
    const pick = async i => {
      const it = items[i]; if (!it) return;
      if (it.cmd) { const ok = await run(it.cmd).catch(() => false); if (ok === false) return; dlg.close(); return; }
      dlg.close(); it.go();
    };
    const paint = () => {
      list.replaceChildren();
      let g = null;
      items.forEach((it, i) => {
        if (it.group !== g) { g = it.group; list.append(el('div', { class: 'kp-g' }, g)); }
        list.append(el('button', { type: 'button', role: 'option', class: 'kp-it' + (i === sel ? ' on' : '') + (it.cmd ? ' cmd' : ''), 'aria-selected': String(i === sel), id: 'kp-' + i,
          onmousemove: () => { if (sel !== i) { sel = i; mark(); } }, onclick: () => pick(i) },
          el('span', { class: 'kp-l' }, it.label), it.sub ? el('span', { class: 'kp-s' }, it.sub) : null));
      });
      if (!items.length) list.append(el('div', { class: 'kp-empty' }, input.value.trim().length < 2 ? hints() : 'Nothing found. Press Enter to save it as a thought.'));
      input.setAttribute('aria-activedescendant', items.length ? 'kp-' + sel : '');
    };
    const mark = () => { list.querySelectorAll('.kp-it').forEach((b, i) => { b.classList.toggle('on', i === sel); b.setAttribute('aria-selected', String(i === sel)); }); input.setAttribute('aria-activedescendant', 'kp-' + sel); list.querySelector('.kp-it.on')?.scrollIntoView({ block: 'nearest' }); };
    const hints = () => el('div', { class: 'kp-hints' },
      el('b', {}, 'Try'),
      ...[['£12.50 lunch', 'add a payment (Personal; add #augustova for a company)'], ['task call Sam tomorrow', 'add a task (today, friday, 12 oct, this week, this month)'],
        ['thought newsletter idea', 'save to the Inbox'], ['follow up Sam friday', 'a follow-up in People'], ['open PCTR', 'jump to a project, person or section']]
        .map(([c, d]) => el('button', { type: 'button', class: 'kp-hint', onclick: () => { input.value = c.replace(/ .*$/, ' '); input.focus(); update(); } }, el('code', {}, c), el('span', {}, d))));
    async function update() {
      const v = input.value, my = ++seq;
      const cmd = parse(v);
      const top = [];
      if (cmd) {
        const label = cmd.kind === 'task' ? `Add task “${cmd.title}” · ${whenLabel(cmd.when)}` : cmd.kind === 'thought' ? `Save to Inbox: “${cmd.body}”`
          : cmd.kind === 'money' ? `Add ${money(cmd.income ? cmd.pence : -cmd.pence)} “${cmd.desc}”${cmd.book ? ' to ' + cmd.book : ''}` : cmd.kind === 'follow' ? `Follow up with ${cmd.name} · ${fmt(cmd.when, { weekday: 'short', day: 'numeric', month: 'short' })}` : null;
        if (label) top.push({ group: 'Do it', label, sub: 'Enter', cmd });
      }
      const term = cmd && cmd.kind === 'open' ? cmd.what : v;
      items = top; sel = 0; paint();
      if (term.trim().length < 2) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const found = await search(term).catch(() => []);
        if (my !== seq) return;
        items = top.concat(found);
        if (!cmd && v.trim().length >= 2) items.push({ group: 'Quick add', label: `Add task “${v.trim()}” for today`, sub: '', cmd: { kind: 'task', title: v.trim(), when: null } },
          { group: 'Quick add', label: `Save “${v.trim()}” to Inbox`, sub: '', cmd: { kind: 'thought', body: v.trim() } });
        sel = 0; paint();
      }, 160);
    }
    input.addEventListener('input', update);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) { sel = (sel + 1) % items.length; mark(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { sel = (sel - 1 + items.length) % items.length; mark(); } }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (items.length) pick(sel);
        else if (input.value.trim().length >= 2) run({ kind: 'thought', body: input.value.trim() }).then(() => dlg.close());
      }
    });
    dlg.append(el('div', { class: 'kp-box' }, el('div', { class: 'kp-top' }, el('span', { class: 'kp-ic', 'aria-hidden': 'true' }, '⌕'), input, el('kbd', { class: 'kp-esc' }, 'Esc')), list));
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal(); input.focus(); input.select();
    update();
  }

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k' && state.user) { e.preventDefault(); open(); }
  });
  // a magnifier in the top bar, on every page
  function ensureButton() {
    const acts = document.querySelector('#app header.bar .baractions');
    if (!acts || acts.querySelector('.kp-btn')) return;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    acts.prepend(el('button', { type: 'button', class: 'kp-btn', title: `Search and quick add (${mac ? '⌘' : 'Ctrl'} K)`, 'aria-label': 'Search and quick add', onclick: () => open() },
      Object.assign(el('span', { 'aria-hidden': 'true' }), { innerHTML: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' })));
  }
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => ensureButton()).observe(app, { childList: true, subtree: true });
  ensureButton();
  DS.palette = { open, parse, parseWhen, search };
  DS.parseWhen = parseWhen;
})();
