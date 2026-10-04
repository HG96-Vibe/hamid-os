// Capital tab (opens at #capital; the files keep the name money): where your money goes, budgets, and net worth.
// - Three separate books: Personal, Augustova and PCTR (the top-level companies in Projects, in their colours).
// - Add as you go ("12.50 lunch", "+2,500 salary") and import your bank's statement file each week.
// - Categories with monthly budgets; it learns your categories from the shops and payees you sort.
// - Net worth: investments and accounts you add yourself, with their value over time.
// - "Hide amounts" blurs every figure (remembered on this device).
// The careful parsing (amounts, dates, statement files) lives in money-core.js.
(function () {
  'use strict';
  const DS = window.DS, C = window.MoneyCore;
  if (!DS || !C) return;
  const { sb, q, el, state, toast, today, addDays, monthStart, addMonths, fmt } = DS;
  const { gbp } = C;
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };

  const M = { books: [], book: store('mn_book'), view: store('mn_view') === 'worth' ? 'worth' : 'book', month: monthStart(today()),
    hide: store('mn_hide') === '1', cats: [], rules: [], tx: [], filter: null, search: '', holdings: [], values: [] };
  let page = null;

  const ICONS = {
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 3.9M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    report: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'
  };
  const icon = (n, s = 16) => Object.assign(el('span', { class: 'mn-ic', 'aria-hidden': 'true' }),
    { innerHTML: `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>` });
  // every figure wears .mn-amt, so "Hide amounts" can blur them all at once
  const amt = (p, opts, cls) => el('span', { class: 'mn-amt' + (cls ? ' ' + cls : '') }, gbp(p, opts));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const monthEnd = ms => addDays(addMonths(ms, 1), -1);
  const monthName = ms => fmt(ms, { month: 'long', year: 'numeric' });
  const book = () => M.books.find(b => b.id === M.book);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const isPersonal = id => { const b = M.books.find(x => x.id === id); return !!b && b.kind === 'personal'; };
  const isBiz = () => !!book() && book().kind !== 'personal';

  /* =====================================================================
     Data
     ===================================================================== */
  async function loadBooks() {
    await DS.proj.ensure();
    const r = DS.proj.roots().filter(p => p.status === 'active');
    M.books = [...r.filter(p => p.kind === 'personal'), ...r.filter(p => p.kind !== 'personal')];
    if (!M.books.some(b => b.id === M.book)) M.book = M.books[0] ? M.books[0].id : null;
  }
  async function loadBook() {
    const id = M.book; if (!id) return;
    const from = addMonths(M.month, -5), to = monthEnd(M.month);
    let [cats, rules, tx] = await Promise.all([
      q(sb.from('money_categories').select('*').eq('book_id', id).order('position')),
      q(sb.from('money_rules').select('pattern,category').eq('book_id', id)),
      q(sb.from('money_tx').select('*').eq('book_id', id).gte('occurred_on', from).lte('occurred_on', to)
        .order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(10000))]);
    if (!cats.length) cats = await seedCats(id);
    // your own list of direct debits and bills (Personal); a record only, never counted in money in / out
    // ... and loans / lending with their repayments (also a record only)
    let planned = [], debts = [], debtPays = [], ticked = [];
    if (isPersonal(id)) {
      [planned, debts, debtPays, ticked] = await Promise.all([
        q(sb.from('money_planned').select('*').eq('book_id', id).order('next_on')).catch(() => []),
        q(sb.from('money_debts').select('*').eq('book_id', id).order('started_on')).catch(() => []),
        q(sb.from('money_debt_payments').select('*').order('paid_on').limit(20000)).catch(() => []),
        // direct debits ticked as paid: each is a money-out entry tagged dd|<debit id>|<date it was due>
        q(sb.from('money_tx').select('*').eq('book_id', id).like('import_key', 'dd|%').gte('occurred_on', addDays(today(), -800)).limit(20000)).catch(() => [])]);
      debtPays = debtPays.filter(x => debts.some(d => d.id === x.debt_id));
    }
    if (M.book !== id) return;
    Object.assign(M, { cats, rules, tx, planned, debts, debtPays, ddPaid: new Map(ticked.map(t => [t.import_key, t])) });
  }
  // a new book starts with sensible categories (yours to rename, budget or delete)
  async function seedCats(id) {
    const b = M.books.find(x => x.id === id), d = C.DEFAULTS[b && b.kind === 'personal' ? 'personal' : 'business'];
    const rows = []; let n = 0;
    for (const kind of ['out', 'in']) for (const name of d[kind]) rows.push({ user_id: DS.uid(), book_id: id, name, kind, position: ++n });
    await q(sb.from('money_categories').upsert(rows, { onConflict: 'user_id,book_id,kind,name', ignoreDuplicates: true }));
    return q(sb.from('money_categories').select('*').eq('book_id', id).order('position'));
  }
  async function loadWorth() {
    const [holdings, values] = await Promise.all([
      q(sb.from('money_holdings').select('*').eq('archived', false).order('position')),
      q(sb.from('money_values').select('id,holding_id,valued_on,value_pence').order('valued_on').limit(20000))]);
    Object.assign(M, { holdings, values });
  }

  const inMonth = t => t.occurred_on >= M.month && t.occurred_on <= monthEnd(M.month);
  const catsOf = kind => M.cats.filter(c => c.kind === kind);
  const kindOf = name => (M.cats.find(c => c.name === name) || {}).kind || null;
  function guessCat(desc, income) {
    const key = C.merchantKey(desc), rule = key && M.rules.find(r => r.pattern === key);
    if (rule && M.cats.some(c => c.name === rule.category && c.kind === (income ? 'in' : 'out'))) return rule.category;
    return C.guess(desc, catsOf(income ? 'in' : 'out').map(c => c.name));
  }
  // remember: payments to this shop / from this payee go in this category
  async function learn(desc, cat) {
    const key = C.merchantKey(desc); if (!key || !cat) return;
    try { await q(sb.from('money_rules').upsert({ user_id: DS.uid(), book_id: M.book, pattern: key, category: cat }, { onConflict: 'user_id,book_id,pattern' })); } catch (e) { return; }
    const r = M.rules.find(x => x.pattern === key); if (r) r.category = cat; else M.rules.push({ pattern: key, category: cat });
  }
  const sortTx = () => M.tx.sort((a, b) => (b.occurred_on > a.occurred_on ? 1 : b.occurred_on < a.occurred_on ? -1 : (b.created_at > a.created_at ? 1 : -1)));

  /* =====================================================================
     The page
     ===================================================================== */
  async function viewMoney() {
    await loadBooks();
    page = el('div', { class: 'mn' + (M.hide ? ' mn-hide' : '') });
    if (!M.books.length) {
      page.append(el('div', { class: 'head' }, el('h1', {}, 'Capital')),
        el('p', { class: 'meta' }, 'Add your companies and Personal area in Projects first. Each one gets its own book here.'));
      return page;
    }
    if (M.view === 'book') await loadBook(); else await loadWorth();
    draw();
    // the page is put on screen after this returns: measure the long lists once it's there
    let tries = 0;
    (function whenShown() { if (page.isConnected) capLists(); else if (++tries < 120) requestAnimationFrame(whenShown); })();
    return page;
  }
  // redraw in place: keep the scroll position, and the focus on the quick-add box if it was there
  // keep: an element already on the page (the direct debits card) to put back as it is instead of rebuilding it;
  // only its totals line is refreshed
  function draw(focusId, keep) {
    if (!page) return;
    const y = window.scrollY, active = focusId || (document.activeElement && document.activeElement.id);
    page.classList.toggle('mn-hide', M.hide);
    const scrolled = new Map([...page.querySelectorAll('.mn-cap')].map(c => [c.dataset.cap, c.scrollTop]));
    page.replaceChildren(header(), ...(M.view === 'book' ? bookView() : worthView()));
    const fresh = keep && page.querySelector('.' + keep.classList[1]);
    if (fresh && fresh !== keep) {
      for (const sel of ['.mn-ch', '.mn-total']) { const a = keep.querySelector(sel), b = fresh.querySelector(sel); if (a && b) a.replaceWith(b); }
      keep.dataset.sum = fresh.dataset.sum || ''; // the side list reads the up-to-date summary
      fresh.replaceWith(keep);
    }
    layoutCards();
    capLists(scrolled);
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
    if (active && active.startsWith('mn-')) { const f = document.getElementById(active); if (f) f.focus({ preventScroll: true }); }
  }
  // Cards start folded (just their heading and a short summary); the arrow opens one at a time to work in it.
  // What's open is remembered while the app is open (this browser tab), so redraws don't fold them again.
  const FOLD = { 'mn-spend': 'spend', 'mn-income': 'income', 'mn-trend': 'trend', 'mn-planned': 'planned', 'mn-debt-borrowed': 'loans',
    'mn-debt-lent': 'lending', 'mn-list': 'payments', 'mn-worthchart': 'worth', 'mn-holdings': 'holdings' };
  const opened = new Set((() => { try { return JSON.parse(sessionStorage.getItem('mn_open') || '[]'); } catch (e) { return []; } })());
  const CHEV = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  // On a wide screen the cards are listed on the left (title and summary) and the chosen one fills the right;
  // the list stays in view as you scroll. Your last choice is remembered on this device. On a phone they stack
  // as fold-down cards instead.
  const split = (...cards) => el('div', { class: 'mn-md' }, el('nav', { class: 'mn-side', 'aria-label': 'Capital sections' }), el('div', { class: 'mn-main' }, cards));
  const isWide = () => !window.matchMedia || matchMedia('(min-width: 901px)').matches;
  const keyOf = card => FOLD[Object.keys(FOLD).find(c => card.classList.contains(c))];
  function layoutCards() {
    const cards = [...page.querySelectorAll('.mn-main > .mn-card')], side = page.querySelector('.mn-side');
    if (!cards.length) return;
    const keys = cards.map(keyOf);
    let sel = store('mn_sel_' + M.view);
    if (!keys.includes(sel)) sel = keys.includes('planned') ? 'planned' : keys[0];
    M.sel = sel;
    foldCards(cards);
    const wide = isWide();
    cards.forEach(c => { const on = keyOf(c) === sel; c.classList.toggle('sel', wide && on); if (wide) c.classList.remove('folded'); });
    if (side) side.replaceChildren(...cards.map(c => {
      const id = keyOf(c), title = (c.querySelector(':scope > .mn-ch h3') || {}).textContent || '';
      return el('button', { type: 'button', class: 'mn-sbtn', 'data-k': id, 'aria-current': String(id === sel), onclick: () => selectCard(id) },
        el('b', {}, title), c.dataset.sum ? el('small', { class: 'mn-amt' }, c.dataset.sum) : null);
    }));
  }
  function selectCard(id) {
    if (!page) return;
    M.sel = id; store('mn_sel_' + M.view, id);
    page.querySelectorAll('.mn-main > .mn-card').forEach(c => c.classList.toggle('sel', keyOf(c) === id));
    page.querySelectorAll('.mn-sbtn').forEach(b => b.setAttribute('aria-current', String(b.dataset.k === id)));
    const card = page.querySelector('.mn-main > .mn-card.sel');
    if (card) { card.classList.add('opening'); setTimeout(() => card.classList.remove('opening'), 320); }
    capLists(); // its lists can only be measured once it's showing
    // if you'd scrolled down a long card, bring the top of the new one into view
    const main = page.querySelector('.mn-main'), top = main ? main.getBoundingClientRect().top : 0;
    if (top < 90) window.scrollBy({ top: top - 110, behavior: 'smooth' });
  }
  function foldCards(cards) {
    cards.forEach(card => {
      const key = Object.keys(FOLD).find(c => card.classList.contains(c)); if (!key) return;
      const head = card.querySelector(':scope > .mn-ch'); if (!head) return;
      const id = FOLD[key], open = opened.has(id), title = (head.querySelector('h3') || {}).textContent || 'this section';
      card.classList.toggle('folded', !open);
      if (card.dataset.sum && !head.querySelector('.mn-chsum,.mn-psum,.mn-count')) head.querySelector('h3').after(el('span', { class: 'mn-chsum' }, card.dataset.sum));
      let b = head.querySelector('.mn-fold');
      if (!b) { b = Object.assign(el('button', { type: 'button', class: 'mn-fold' }), { innerHTML: CHEV }); head.append(b); }
      b.setAttribute('aria-expanded', String(open)); b.setAttribute('aria-label', (open ? 'Fold away ' : 'Open ') + title); b.title = open ? 'Fold away' : 'Open';
      b.onclick = e => { e.stopPropagation(); toggleFold(card, id); };
      head.onclick = e => { if (!e.target.closest('button,a,input,select,textarea,label,summary')) toggleFold(card, id); };
    });
  }
  function toggleFold(card, id) {
    const open = !opened.has(id);
    if (open) opened.add(id); else opened.delete(id);
    try { sessionStorage.setItem('mn_open', JSON.stringify([...opened])); } catch (e) {}
    card.classList.toggle('folded', !open);
    const b = card.querySelector(':scope > .mn-ch .mn-fold'), title = (card.querySelector(':scope > .mn-ch h3') || {}).textContent || '';
    if (b) { b.setAttribute('aria-expanded', String(open)); b.setAttribute('aria-label', (open ? 'Fold away ' : 'Open ') + title); b.title = open ? 'Fold away' : 'Open'; }
    if (open) {
      card.classList.add('opening'); setTimeout(() => card.classList.remove('opening'), 320);
      capLists(); // lists inside can only be measured once they're showing
    }
  }

  // Long lists show 10 at a time and scroll for the rest, so no card grows without end.
  const CAP = 10;
  function capLists(scrolled) {
    if (!page) return;
    scrolled = scrolled || new Map([...page.querySelectorAll('.mn-cap')].map(c => [c.dataset.cap, c.scrollTop]));
    page.querySelectorAll('.mn-cap').forEach(c => {
      const items = c.querySelectorAll(c.dataset.items);
      if (items.length <= CAP) { c.classList.remove('capped'); c.style.maxHeight = ''; return; }
      if (!c.offsetWidth) return; // hidden (a closed "Paid off" section): measured when it opens
      // room for the scrollbar first (it narrows the rows, and on a phone some then wrap), then measure 10 rows
      c.classList.add('capped'); c.style.maxHeight = '';
      const z = c.getBoundingClientRect().width / c.offsetWidth || 1;
      const bottom = (items[CAP - 1].getBoundingClientRect().bottom - c.getBoundingClientRect().top) / z + c.scrollTop;
      c.style.maxHeight = Math.ceil(bottom + 2) + 'px';
      c.setAttribute('tabindex', '0'); c.setAttribute('aria-label', `${items.length} items, scroll to see them all`);
      if (scrolled && scrolled.has(c.dataset.cap)) c.scrollTop = scrolled.get(c.dataset.cap);
    });
  }
  document.addEventListener('toggle', e => { if (page && page.contains(e.target)) capLists(); }, true);
  async function switchBook(id) {
    M.view = 'book'; M.book = id; M.filter = null; M.search = ''; store('mn_book', id); store('mn_view', 'book');
    await loadBook(); draw();
  }
  async function switchWorth() { M.view = 'worth'; store('mn_view', 'worth'); await loadWorth(); draw(); }
  async function changeMonth(ms) { M.month = ms; M.filter = null; await loadBook(); draw(); }

  function header() {
    const eye = el('button', { type: 'button', class: 'btn mn-eye', 'aria-pressed': String(M.hide), title: M.hide ? 'Show amounts' : 'Hide amounts',
      onclick: () => { M.hide = !M.hide; store('mn_hide', M.hide ? '1' : '0'); draw(); } }, icon(M.hide ? 'eyeOff' : 'eye'), el('span', {}, M.hide ? 'Show amounts' : 'Hide amounts'));
    return el('div', { class: 'mn-top' },
      el('div', { class: 'head mn-head' }, el('h1', {}, 'Capital'),
        el('div', { class: 'mn-actions' },
          window.MoneyReport ? el('button', { type: 'button', class: 'btn', onclick: exportDialog }, icon('report'), el('span', {}, 'Export report')) : null,
          M.view === 'book' ? [
            el('button', { type: 'button', class: 'btn', onclick: importDialog }, icon('upload'), el('span', {}, 'Import statement')),
            el('button', { type: 'button', class: 'btn', onclick: catsDialog }, icon('sliders'), el('span', {}, 'Categories & budgets'))] : null,
          eye)),
      el('div', { class: 'mn-books', role: 'tablist', 'aria-label': 'Books' },
        M.books.map(b => el('button', { type: 'button', role: 'tab', class: 'mn-book' + (M.view === 'book' && M.book === b.id ? ' on' : ''),
          'aria-selected': String(M.view === 'book' && M.book === b.id), style: `--pj:${DS.proj.color(b.id)}`, onclick: () => switchBook(b.id) },
          el('span', { class: 'mn-dot', 'aria-hidden': 'true' }), b.name)),
        el('button', { type: 'button', role: 'tab', class: 'mn-book mn-worth' + (M.view === 'worth' ? ' on' : ''), 'aria-selected': String(M.view === 'worth'), onclick: switchWorth }, 'Net worth')));
  }

  /* ---------- a book: one month at a time ---------- */
  function bookView() {
    const mtx = M.tx.filter(inMonth);
    const isNow = M.month === monthStart(today());
    const nav = el('div', { class: 'mn-month' },
      el('button', { type: 'button', class: 'arrow', 'aria-label': 'Previous month', onclick: () => changeMonth(addMonths(M.month, -1)) }, '‹'),
      el('h2', {}, monthName(M.month)),
      el('button', { type: 'button', class: 'arrow', 'aria-label': 'Next month', onclick: () => changeMonth(addMonths(M.month, 1)) }, '›'),
      isNow ? null : el('button', { type: 'button', class: 'pill', onclick: () => changeMonth(monthStart(today())) }, 'This month'));
    const P = isPersonal(M.book);
    return [nav, quickAdd(), kpis(mtx), split(spending(mtx), income(mtx), trend(), P ? plannedCard() : null, P ? debtCard('borrowed') : null, P ? debtCard('lent') : null, txList(mtx))];
  }

  function catSelect(value, { kind, id, label } = {}) {
    const opt = c => el('option', { value: c.name }, c.name);
    const s = el('select', { class: 'mn-cat', id, 'aria-label': label || 'Category' },
      el('option', { value: '' }, 'Uncategorised'),
      !kind || kind === 'out' ? el('optgroup', { label: 'Spending' }, catsOf('out').map(opt)) : null,
      !kind || kind === 'in' ? el('optgroup', { label: 'Money in' }, catsOf('in').map(opt)) : null);
    s.value = value || '';
    return s;
  }

  // add as you go: "12.50 lunch", "lunch £12.50", "+2,500 salary"
  function quickAdd() {
    const input = el('input', { class: 'mn-qin', id: 'mn-qin', autocomplete: 'off', maxlength: '320', 'aria-label': 'Add money in or out',
      placeholder: isBiz() ? 'e.g. 49 Figma, or +1,250 client invoice' : 'e.g. 12.50 lunch, or +2,500 salary' });
    const sel = catSelect('', { id: 'mn-qcat', label: 'Category for the new entry' });
    const isNow = M.month === monthStart(today());
    const date = el('input', { type: 'date', class: 'mn-qdate', id: 'mn-qdate', 'aria-label': 'Date', value: isNow ? today() : monthEnd(M.month) });
    const hint = el('span', { class: 'mn-qhint', 'aria-live': 'polite' });
    let manual = false;
    const incomeOf = (r, cat) => (cat ? kindOf(cat) === 'in' : r.income);
    const update = () => {
      const r = C.quick(input.value);
      if (!manual) sel.value = (r.desc && guessCat(r.desc, r.income)) || '';
      hint.replaceChildren(r.pence ? amt(incomeOf(r, sel.value) ? r.pence : -r.pence, { plus: true }, incomeOf(r, sel.value) ? 'in' : 'out') : '');
    };
    sel.addEventListener('change', () => { manual = true; update(); });
    input.addEventListener('input', update);
    const add = async () => {
      const r = C.quick(input.value);
      if (!r.pence) { toast('Start with an amount, e.g. 12.50 lunch.'); input.focus(); return; }
      const cat = sel.value || null, income = incomeOf(r, cat);
      const row = { user_id: DS.uid(), book_id: M.book, occurred_on: date.value || today(), amount_pence: income ? r.pence : -r.pence,
        description: (r.desc || cat || (income ? 'Money in' : 'Money out')).slice(0, 300), category: cat, source: 'manual' };
      let saved; try { saved = await q(sb.from('money_tx').insert(row).select().single()); } catch (e) { return; }
      if (cat && r.desc && manual) learn(r.desc, cat);
      M.tx.push(saved); sortTx();
      if (saved.occurred_on < M.month || saved.occurred_on > monthEnd(M.month)) toast(`Added to ${monthName(monthStart(saved.occurred_on))}.`);
      else toast(`Added ${gbp(saved.amount_pence, { plus: true })}${cat ? ' · ' + cat : ''}.`);
      draw('mn-qin');
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return el('div', { class: 'mn-quick' },
      el('span', { class: 'mn-qplus', 'aria-hidden': 'true' }, '+'), input, hint, sel, date,
      el('button', { type: 'button', class: 'btn primary', onclick: add }, 'Add'));
  }

  function kpis(mtx) {
    const inn = mtx.filter(t => t.amount_pence > 0).reduce((a, t) => a + t.amount_pence, 0);
    const out = -mtx.filter(t => t.amount_pence < 0).reduce((a, t) => a + t.amount_pence, 0);
    const net = inn - out, rate = inn ? Math.round(net / inn * 100) : null;
    const k = (label, value, note, cls) => el('div', { class: 'mn-kpi' + (cls ? ' ' + cls : '') }, el('span', {}, label), el('b', {}, value), note ? el('small', {}, note) : null);
    return el('div', { class: 'mn-kpis' },
      k('Money in', amt(inn), plural(mtx.filter(t => t.amount_pence > 0).length, 'payment'), 'in'),
      k('Money out', amt(out), plural(mtx.filter(t => t.amount_pence < 0).length, 'payment'), 'out'),
      k(isBiz() ? 'Profit' : 'Left over', amt(net, { plus: true }), net < 0 ? 'more out than in' : 'in minus out', net < 0 ? 'neg' : 'pos'),
      k(isBiz() ? 'Margin' : 'Saved', rate == null ? '–' : rate + '%', isBiz() ? 'profit as a share of money in' : 'of what came in'),
      playTile(net));
  }
  // To play with: money in, minus money out, minus the direct debits still expected this month (not yet ticked
  // as paid). Personal, this month only.
  function playTile(net) {
    if (!isPersonal(M.book) || M.month !== monthStart(today())) return null;
    const expected = (M.planned || []).reduce((a, p) => a + expectedThisMonth(p), 0), play = net - expected;
    return el('div', { class: 'mn-kpi play' + (play < 0 ? ' neg' : '') }, el('span', {}, 'To play with'), el('b', {}, amt(play, { plus: play > 0 })),
      el('small', {}, expected ? ['after ', amt(expected), ' of direct debits still to go'] : 'no direct debits left this month'));
  }

  // where it went, against each category's monthly budget
  function spending(mtx) {
    const spent = {};
    mtx.filter(t => t.amount_pence < 0).forEach(t => { const k = t.category && kindOf(t.category) === 'out' ? t.category : '__none'; spent[k] = (spent[k] || 0) - t.amount_pence; });
    const budgeted = catsOf('out').filter(c => c.budget_pence != null);
    const free = catsOf('out').filter(c => c.budget_pence == null && spent[c.name]);
    const totalB = budgeted.reduce((a, c) => a + c.budget_pence, 0), totalS = budgeted.reduce((a, c) => a + (spent[c.name] || 0), 0);
    const maxFree = Math.max(1, ...free.map(c => spent[c.name]), spent.__none || 0);
    const row = (name, s, budget, key) => {
      const over = budget != null && s > budget, warn = budget != null && !over && budget > 0 && s >= budget * .85;
      const pct = budget != null ? (budget ? Math.min(100, s / budget * 100) : (s ? 100 : 0)) : s / maxFree * 100;
      const note = budget == null ? (key === '__none' ? 'not sorted yet' : 'no budget')
        : over ? [amt(s - budget), ' over'] : [amt(budget - s), ' left'];
      return el('button', { type: 'button', class: 'mn-brow' + (M.filter === key ? ' on' : '') + (over ? ' over' : warn ? ' warn' : '') + (budget == null ? ' free' : ''),
        'aria-pressed': String(M.filter === key), title: 'Show these payments', onclick: () => { M.filter = M.filter === key ? null : key; draw(); } },
        el('span', { class: 'mn-bname' }, name),
        el('span', { class: 'mn-bnum' }, amt(s), budget != null ? [' of ', amt(budget, { whole: true })] : null),
        el('span', { class: 'mn-bar', 'aria-hidden': 'true' }, el('i', { style: `width:${pct.toFixed(1)}%` })),
        el('span', { class: 'mn-bnote' }, over ? '⚠ ' : '', note));
    };
    const rows = [...budgeted.map(c => row(c.name, spent[c.name] || 0, c.budget_pence, c.name)),
      ...free.sort((a, b) => spent[b.name] - spent[a.name]).map(c => row(c.name, spent[c.name], null, c.name)),
      spent.__none ? row('Uncategorised', spent.__none, null, '__none') : null].filter(Boolean);
    const spentAll = Object.values(spent).reduce((a, v) => a + v, 0), overN = budgeted.filter(c => (spent[c.name] || 0) > c.budget_pence).length;
    return el('section', { class: 'mn-card mn-spend', 'data-sum': gbp(spentAll) + ' spent' + (overN ? ` · ${overN} over budget` : '') },
      el('div', { class: 'mn-ch' }, el('h3', {}, 'Where it went'),
        el('button', { type: 'button', class: 'linkish', onclick: catsDialog }, budgeted.length ? 'Edit budgets' : 'Set budgets')),
      budgeted.length ? el('p', { class: 'mn-total' }, amt(totalS), ' spent of ', amt(totalB, { whole: true }), ' budgeted · ',
        totalS > totalB ? [amt(totalS - totalB), ' over'] : [amt(totalB - totalS), ' left']) : null,
      rows.length ? el('div', { class: 'mn-brows mn-cap', 'data-cap': 'spend', 'data-items': '.mn-brow' }, rows) : el('p', { class: 'mn-empty' }, 'No spending this month yet.'),
      !budgeted.length ? el('p', { class: 'mn-tip' }, 'Give categories a monthly budget and each bar shows how much is left.') : null);
  }

  function income(mtx) {
    const got = {};
    mtx.filter(t => t.amount_pence > 0).forEach(t => { const k = t.category && kindOf(t.category) === 'in' ? t.category : '__none'; got[k] = (got[k] || 0) + t.amount_pence; });
    const keys = Object.keys(got).sort((a, b) => got[b] - got[a]), max = Math.max(1, ...Object.values(got));
    return el('section', { class: 'mn-card mn-income', 'data-sum': gbp(Object.values(got).reduce((a, v) => a + v, 0)) + ' in' },
      el('div', { class: 'mn-ch' }, el('h3', {}, 'Money in')),
      keys.length ? el('div', { class: 'mn-brows mn-cap', 'data-cap': 'income', 'data-items': '.mn-brow' }, keys.map(k => el('button', { type: 'button', class: 'mn-brow inrow' + (M.filter === k ? ' on' : ''),
        'aria-pressed': String(M.filter === k), title: 'Show these payments', onclick: () => { M.filter = M.filter === k ? null : k; draw(); } },
        el('span', { class: 'mn-bname' }, k === '__none' ? 'Uncategorised' : k),
        el('span', { class: 'mn-bnum' }, amt(got[k])),
        el('span', { class: 'mn-bar', 'aria-hidden': 'true' }, el('i', { style: `width:${(got[k] / max * 100).toFixed(1)}%` }))))) :
        el('p', { class: 'mn-empty' }, 'Nothing in yet this month.'));
  }

  // the chart's width in page pixels: the card's share of the page (a whole row on narrow screens)
  function chartWidth(share) {
    const main = document.getElementById('main'), w = (main && main.clientWidth) || window.innerWidth - 32;
    return Math.round(Math.max(300, Math.min(1400, (w > 900 ? w - 316 : w) - 36))); // the right-hand panel beside the list
  }
  // the last six months, money in beside money out (one scale; hover a bar for its figure)
  function trend() {
    const months = Array.from({ length: 6 }, (_, i) => addMonths(M.month, i - 5));
    const data = months.map(ms => {
      const t = M.tx.filter(x => x.occurred_on >= ms && x.occurred_on <= monthEnd(ms));
      return { ms, in: t.filter(x => x.amount_pence > 0).reduce((a, x) => a + x.amount_pence, 0), out: -t.filter(x => x.amount_pence < 0).reduce((a, x) => a + x.amount_pence, 0) };
    });
    const max = Math.max(...data.map(d => Math.max(d.in, d.out)));
    const W = chartWidth(.45), H = 210, L = 58, B = 26, T = 10, plot = H - B - T, gw = (W - L - 8) / 6, bw = Math.min(26, gw / 3);
    const nice = v => { if (v <= 0) return 10000; const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p / (v / p > 5 ? 2 : .5)) * p * (v / p > 5 ? 2 : .5); };
    const top = nice(max), y = v => T + plot - v / top * plot;
    let svg = '';
    for (let i = 0; i <= 3; i++) {
      const v = top * i / 3, yy = y(v).toFixed(1);
      svg += `<line x1="${L}" x2="${W - 4}" y1="${yy}" y2="${yy}" class="mn-grid-l"/><text x="${L - 8}" y="${(+yy + 4).toFixed(1)}" text-anchor="end" class="mn-axis mn-amt">${esc(gbp(v, { whole: true }).replace(/\.\d\d$/, ''))}</text>`;
    }
    data.forEach((d, i) => {
      const cx = L + gw * i + gw / 2, label = fmt(d.ms, { month: 'short' });
      [['in', d.in, cx - bw - 1], ['out', d.out, cx + 1]].forEach(([k, v, x]) => {
        const h = Math.max(v ? 2 : 0, v / top * plot), r = Math.min(4, bw / 2, h);
        const tip = `${monthName(d.ms)} · ${k === 'in' ? 'Money in' : 'Money out'} ${gbp(v)}`;
        if (h) svg += `<path class="mn-b ${k}" d="M${x},${T + plot} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z" data-tip="${esc(tip)}"><title>${esc(tip)}</title></path>`;
        svg += `<rect x="${x - 2}" y="${T}" width="${bw + 4}" height="${plot}" class="mn-hit" data-tip="${esc(tip)}"/>`;
      });
      svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="mn-axis${d.ms === M.month ? ' cur' : ''}">${esc(label)}</text>`;
    });
    const fig = el('figure', { class: 'mn-chart' });
    fig.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Money in and out, last six months">${svg}</svg>`;
    const tipEl = el('div', { class: 'mn-tip-pop mn-amt', hidden: true });
    fig.append(tipEl);
    fig.addEventListener('pointermove', e => {
      const t = e.target.closest('[data-tip]');
      if (!t) { tipEl.hidden = true; return; }
      tipEl.textContent = t.dataset.tip; tipEl.hidden = false;
      const r = fig.getBoundingClientRect(), z = fig.offsetWidth ? r.width / fig.offsetWidth : 1;
      tipEl.style.left = Math.min(r.width - 10, Math.max(10, e.clientX - r.left)) / z + 'px'; tipEl.style.top = (e.clientY - r.top) / z - 12 + 'px';
    });
    fig.addEventListener('pointerleave', () => { tipEl.hidden = true; });
    const table = el('details', { class: 'mn-table' }, el('summary', {}, 'Show as a table'),
      el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Month'), el('th', {}, 'Money in'), el('th', {}, 'Money out'))),
        el('tbody', {}, data.map(d => el('tr', {}, el('td', {}, monthName(d.ms)), el('td', {}, amt(d.in)), el('td', {}, amt(d.out)))))));
    return el('section', { class: 'mn-card mn-trend', 'data-sum': max ? `${gbp(data[5].in)} in · ${gbp(data[5].out)} out this month` : '' },
      el('div', { class: 'mn-ch' }, el('h3', {}, 'Last six months'),
        el('span', { class: 'mn-legend' }, el('i', { class: 'in' }), 'Money in', el('i', { class: 'out' }), 'Money out')),
      max ? fig : el('p', { class: 'mn-empty' }, 'Your chart fills in as you add money in and out.'), max ? table : null);
  }

  // this month's payments, newest first, grouped by day
  function txList(mtx) {
    const s = M.search.trim().toLowerCase();
    const shown = mtx.filter(t => {
      if (M.filter === '__none' ? (t.category && kindOf(t.category)) : M.filter && t.category !== M.filter) return false;
      return !s || t.description.toLowerCase().includes(s) || (t.category || '').toLowerCase().includes(s) || (t.note || '').toLowerCase().includes(s);
    });
    const search = el('input', { type: 'search', class: 'field mn-search', id: 'mn-search', placeholder: 'Search payments', 'aria-label': 'Search payments', value: M.search,
      oninput: e => { M.search = e.target.value; draw('mn-search'); } });
    const days = [];
    shown.forEach(t => { const d = days[days.length - 1]; if (d && d.date === t.occurred_on) d.items.push(t); else days.push({ date: t.occurred_on, items: [t] }); });
    return el('section', { class: 'mn-card mn-list', 'data-sum': plural(mtx.length, 'payment') + (mtx.filter(t => !t.category).length ? ` · ${mtx.filter(t => !t.category).length} to sort` : '') },
      el('div', { class: 'mn-ch' }, el('h3', {}, 'Payments'),
        M.filter ? el('button', { type: 'button', class: 'pill mn-fpill', onclick: () => { M.filter = null; draw(); } }, `Showing ${M.filter === '__none' ? 'uncategorised' : M.filter} ×`) : null,
        el('span', { class: 'mn-count' }, `${shown.length} of ${mtx.length}`), search),
      days.length ? el('div', { class: 'mn-cap', 'data-cap': 'tx', 'data-items': '.mn-tx' }, days.map(d => el('div', { class: 'mn-day' },
        el('div', { class: 'mn-dayh' }, el('span', {}, fmt(d.date, { weekday: 'short', day: 'numeric', month: 'short' })),
          amt(d.items.reduce((a, t) => a + t.amount_pence, 0), { plus: true }, 'mn-daysum')),
        d.items.map(txRow)))) :
        el('p', { class: 'mn-empty' }, mtx.length ? 'Nothing matches.' : `No payments in ${monthName(M.month)} yet. Add one above, or import your bank statement.`));
  }
  function txRow(t) {
    const sel = catSelect(t.category, { kind: t.amount_pence > 0 ? 'in' : 'out', label: `Category for ${t.description}` });
    sel.addEventListener('change', () => setCat(t, sel.value || null));
    return el('div', { class: 'mn-tx' + (t.category ? '' : ' uncat') },
      el('button', { type: 'button', class: 'mn-txd', title: 'Edit', onclick: () => editDialog(t) }, t.description,
        t.note ? el('small', {}, t.note) : null, t.source === 'import' ? el('span', { class: 'mn-src' }, 'imported') : null),
      sel,
      amt(t.amount_pence, { plus: true }, 'mn-txa ' + (t.amount_pence > 0 ? 'in' : 'out')),
      el('button', { type: 'button', class: 'mn-del', title: 'Delete', 'aria-label': `Delete ${t.description}`, onclick: () => del(t) }, icon('trash', 15)));
  }
  async function setCat(t, cat) {
    try { await q(sb.from('money_tx').update({ category: cat }).eq('id', t.id)); } catch (e) { draw(); return; }
    t.category = cat;
    if (cat) {
      await learn(t.description, cat);
      // the same shop's other unsorted payments follow
      const key = C.merchantKey(t.description);
      const others = key ? M.tx.filter(x => x !== t && !x.category && Math.sign(x.amount_pence) === Math.sign(t.amount_pence) && C.merchantKey(x.description) === key) : [];
      if (others.length) {
        try { await q(sb.from('money_tx').update({ category: cat }).in('id', others.map(o => o.id))); others.forEach(o => { o.category = cat; }); } catch (e) {}
        toast(`${cat}: this and ${others.length} more from the same place. Future ones will be sorted too.`);
      } else toast(`${cat}. Future payments like this will be sorted the same way.`);
    }
    draw();
  }
  async function del(t) {
    if (!confirm(`Delete “${t.description}” (${gbp(t.amount_pence, { plus: true })})?`)) return;
    try { await q(sb.from('money_tx').delete().eq('id', t.id)); } catch (e) { return; }
    M.tx = M.tx.filter(x => x !== t);
    if (t.import_key && M.ddPaid && M.ddPaid.has(t.import_key)) M.ddPaid.delete(t.import_key);
    toast('Deleted.'); draw();
  }

  /* ---------- direct debits & bills: a list you keep, separate from money in and out ---------- */
  const CADENCE = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly', once: 'One-off' };
  const PER_MONTH = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12, once: 0 };
  // the same day n months on (31 Jan + 1 month = 28/29 Feb)
  function plusMonths(d, n) {
    const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + n, day = +d.slice(8, 10);
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12, last = new Date(yy, mm + 1, 0).getDate();
    return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  }
  const nth = (p, k) => p.cadence === 'weekly' ? addDays(p.next_on, 7 * k) : plusMonths(p.next_on, k * ({ monthly: 1, quarterly: 3, yearly: 12 }[p.cadence] || 0));
  // the next time it goes out, from today (a one-off keeps its date)
  function nextDue(p) {
    if (p.cadence === 'once') return p.next_on;
    const t0 = today(); let k = 0;
    while (nth(p, k) < t0 && k < 2000) k++;
    return nth(p, k);
  }
  // the payment the tick is for: the latest one on or before today (it stays ticked until the next one
  // comes round), or the first one if none has come yet
  function cycleOf(p) {
    const t0 = today();
    if (p.cadence === 'once' || nth(p, 0) > t0) return p.next_on;
    let k = 0;
    while (nth(p, k + 1) <= t0 && k < 2000) k++;
    return nth(p, k);
  }
  const afterCycle = p => { if (p.cadence === 'once') return null; const c = cycleOf(p); let k = 0; while (nth(p, k) <= c && k < 2000) k++; return nth(p, k); };
  const ddKey = (p, d) => `dd|${p.id}|${d}`;
  const isPaid = (p, d) => !!(M.ddPaid && M.ddPaid.has(ddKey(p, d)));
  // how much of it still goes out between today and the end of this month (leaving out ones ticked as paid)
  function leftThisMonth(p) {
    const t0 = today(), end = monthEnd(monthStart(t0)); let n = 0;
    if (p.cadence === 'once') return p.next_on >= t0 && p.next_on <= end && !isPaid(p, p.next_on) ? p.amount_pence : 0;
    for (let k = 0, d = nth(p, 0); d <= end && k < 2000; d = nth(p, ++k)) if (d >= t0 && !isPaid(p, d)) n += p.amount_pence;
    return n;
  }
  // this month's payments of it that haven't been ticked as paid yet (including any whose date has passed)
  function expectedThisMonth(p) {
    const ms = monthStart(today()), end = monthEnd(ms); let n = 0;
    if (p.cadence === 'once') return p.next_on >= ms && p.next_on <= end && !isPaid(p, p.next_on) ? p.amount_pence : 0;
    for (let k = 0, d = nth(p, 0); d <= end && k < 2000; d = nth(p, ++k)) if (d >= ms && !isPaid(p, d)) n += p.amount_pence;
    return n;
  }
  // tick: it's been paid, so it goes into money out (on the day it was due, or today if paid early); untick takes it out again
  // The line changes the moment you click (tick, green fades in), then glides to its new place; the save
  // happens meanwhile, and the rest of the page (money out, budgets, payments) updates once it's done.
  const busy = new Set();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function togglePaid(p, rowEl) {
    if (busy.has(p.id)) return;
    busy.add(p.id);
    const d = cycleOf(p), key = ddKey(p, d), had = M.ddPaid.get(key), nowPaid = !had;
    const card = rowEl && rowEl.closest('.mn-planned');
    if (rowEl) paintRow(rowEl, p, d, nowPaid);
    const save = (async () => {
      if (had) { await q(sb.from('money_tx').delete().eq('id', had.id)); return null; }
      const outCats = catsOf('out').map(c => c.name);
      const category = guessCat(p.name, false) || ['Bills', 'Subscriptions'].find(c => outCats.includes(c)) || null;
      return q(sb.from('money_tx').insert({ user_id: DS.uid(), book_id: M.book, occurred_on: d <= today() ? d : today(), amount_pence: -p.amount_pence,
        description: p.name.slice(0, 300), category, note: 'Direct debit, ticked as paid', source: 'manual', import_key: key }).select().single());
    })();
    let row, failed = false;
    try { [row] = await Promise.all([save, wait(calm() ? 0 : 260)]); } catch (e) { failed = true; }
    if (failed) { busy.delete(p.id); if (rowEl) paintRow(rowEl, p, d, !nowPaid); return; }
    if (had) { M.ddPaid.delete(key); M.tx = M.tx.filter(x => x.id !== had.id); }
    else {
      M.ddPaid.set(key, row);
      if (row.occurred_on >= addMonths(M.month, -5) && row.occurred_on <= monthEnd(M.month)) { M.tx.push(row); sortTx(); }
    }
    if (rowEl && rowEl.isConnected) await glide(rowEl.parentElement);
    busy.delete(p.id);
    toast(had ? `${p.name}: unticked and taken out of money out.` : `${p.name} paid: ${gbp(-p.amount_pence)} added to money out${row.category ? ' · ' + row.category : ''}.`);
    draw(null, card && card.isConnected ? card : null);
  }
  const calm = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // what a line shows, paid or not
  function whenText(p, due, paid) {
    if (paid) return `Paid ${fmt(due, { day: 'numeric', month: 'short' })}` + (afterCycle(p) ? ` · next ${fmt(afterCycle(p), { day: 'numeric', month: 'short' })}` : '');
    return due < today() ? `Was due ${fmt(due, { day: 'numeric', month: 'short' })} · not ticked` : dueLabel(due);
  }
  function paintRow(r, p, due, paid) {
    r.classList.toggle('paid', paid); r.classList.toggle('late', !paid && due < today());
    const t = r.querySelector('.mn-ptick');
    t.setAttribute('aria-pressed', String(paid)); t.textContent = paid ? '✓' : '';
    t.title = paid ? 'Paid. Click to untick' : 'Tick when it’s been paid';
    t.setAttribute('aria-label', paid ? `${p.name} is paid. Untick` : `Mark ${p.name} as paid`);
    r.querySelector('.mn-pwhen small').textContent = whenText(p, due, paid);
  }
  // put the lines in order (still to pay by date, then paid), sliding each from where it was to where it goes
  function glide(list) {
    const rows = [...list.children], byId = new Map(rows.map(r => [r.dataset.pid, r]));
    const order = plannedOrder().map(x => byId.get(x.p.id)).filter(Boolean);
    if (order.every((r, i) => r === rows[i])) return Promise.resolve();
    const was = new Map(rows.map(r => [r, r.getBoundingClientRect()])), focused = document.activeElement, st = list.scrollTop;
    order.forEach(r => list.append(r));
    if (list.scrollTop !== st) list.scrollTop = st; // moving the focused line can reset a scrolling list
    if (focused && list.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true }); // moving a line drops focus
    if (calm() || !list.animate) return Promise.resolve();
    const z = list.offsetWidth ? list.getBoundingClientRect().width / list.offsetWidth : 1;
    const anims = rows.map(r => {
      const a = was.get(r), b = r.getBoundingClientRect(), dy = (a.top - b.top) / z;
      if (Math.abs(dy) < 1) return null;
      return r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.2,.7,.2,1)' }).finished.catch(() => {});
    }).filter(Boolean);
    return Promise.all(anims);
  }
  // still to pay first (by date), then the ones ticked as paid, like finished tasks on Today
  const plannedOrder = () => (M.planned || []).map(p => { const due = cycleOf(p); return { p, due, paid: isPaid(p, due) }; })
    .sort((a, b) => (a.paid - b.paid) || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  function dueLabel(d) {
    const t0 = today(), days = Math.round((Date.parse(d) - Date.parse(t0)) / 864e5);
    if (days < 0) return 'Went out ' + fmt(d, { day: 'numeric', month: 'short' });
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }) + (days <= 14 ? ` · in ${days} days` : '');
  }
  function plannedCard() {
    const list = plannedOrder();
    const monthly = M.planned.reduce((a, p) => a + p.amount_pence * PER_MONTH[p.cadence], 0);
    const left = M.planned.reduce((a, p) => a + leftThisMonth(p), 0);
    const name = el('input', { class: 'field', id: 'mn-pname', maxlength: '80', placeholder: 'e.g. Council tax, Gym, Phone', 'aria-label': 'Name' });
    const amount = el('input', { class: 'field', id: 'mn-pamt', inputmode: 'decimal', placeholder: '£ amount', 'aria-label': 'Amount in pounds' });
    const cad = el('select', { class: 'field', id: 'mn-pcad', 'aria-label': 'How often' }, Object.entries(CADENCE).map(([k, v]) => el('option', { value: k }, v)));
    cad.value = 'monthly';
    const date = el('input', { class: 'field', id: 'mn-pdate', type: 'date', value: today(), 'aria-label': 'Date it goes out' });
    const note = el('input', { class: 'field', id: 'mn-pnote', maxlength: '300', placeholder: 'Note (optional)', 'aria-label': 'Note' });
    const add = async e => {
      e.preventDefault();
      const n = name.value.trim(), a = C.parseAmount(amount.value);
      if (!n) { name.focus(); return; }
      if (!a) { toast('Enter the amount in pounds, e.g. 45.99.'); amount.focus(); return; }
      let row;
      try { row = await q(sb.from('money_planned').insert({ user_id: DS.uid(), book_id: M.book, name: n, amount_pence: Math.abs(a), cadence: cad.value, next_on: date.value || today(), note: note.value.trim() || null }).select().single()); } catch (er) { return; }
      M.planned.push(row); toast(`Added ${n}.`); draw('mn-pname');
    };
    return el('section', { class: 'mn-card mn-planned', 'data-sum': M.planned.length ? `${gbp(Math.round(monthly), { whole: true })} a month` + (left ? ` · ${gbp(left)} to go` : '') : 'none added yet' },
      el('div', { class: 'mn-ch' }, el('h3', {}, 'Direct debits & bills'),
        M.planned.length ? el('span', { class: 'mn-psum' }, amt(Math.round(monthly), { whole: true }), ' a month') : null),
      el('p', { class: 'mn-pnote' }, 'Tick one when it’s been paid and it’s added to money out.'),
      M.planned.length ? el('p', { class: 'mn-total' }, left ? [amt(left), ' still to go out this month'] : 'Nothing more to go out this month.') : null,
      list.length ? el('div', { class: 'mn-plist mn-cap', 'data-cap': 'dd', 'data-items': '.mn-prow' }, list.map(({ p, due, paid }) => el('div', { class: 'mn-prow' + (paid ? ' paid' : due < today() ? ' late' : ''), 'data-pid': p.id },
        el('button', { type: 'button', class: 'mn-ptick', id: 'mn-tick-' + p.id, 'aria-pressed': String(paid), title: paid ? 'Paid. Click to untick' : 'Tick when it’s been paid',
          'aria-label': paid ? `${p.name} is paid. Untick` : `Mark ${p.name} as paid`, onclick: e => togglePaid(p, e.currentTarget.closest('.mn-prow')) }, paid ? '✓' : ''),
        el('button', { type: 'button', class: 'mn-pn', title: 'Edit', onclick: () => plannedDialog(p) }, el('b', {}, p.name), p.note ? el('small', {}, p.note) : null),
        el('span', { class: 'mn-pwhen' }, el('span', { class: 'mn-kind' }, CADENCE[p.cadence]),
          el('small', {}, whenText(p, due, paid))),
        amt(p.amount_pence, {}, 'mn-pamt'),
        el('button', { type: 'button', class: 'mn-del', title: 'Delete', 'aria-label': `Delete ${p.name} from direct debits`, onclick: () => removePlanned(p) }, icon('trash', 15))))) :
        el('p', { class: 'mn-empty' }, 'Note down your direct debits, standing orders and bills, with how much and when they go out.'),
      el('form', { class: 'mn-padd', onsubmit: add }, name, amount, cad, date, note, el('button', { type: 'submit', class: 'btn primary' }, icon('plus', 14), ' Add')));
  }
  function plannedDialog(p) {
    const name = el('input', { class: 'field', maxlength: '80', value: p.name, 'aria-label': 'Name' });
    const amount = el('input', { class: 'field', inputmode: 'decimal', value: (p.amount_pence / 100).toFixed(2), 'aria-label': 'Amount in pounds' });
    const cad = el('select', { class: 'field', 'aria-label': 'How often' }, Object.entries(CADENCE).map(([k, v]) => el('option', { value: k }, v))); cad.value = p.cadence;
    const date = el('input', { class: 'field', type: 'date', value: nextDue(p), 'aria-label': 'Next date it goes out' });
    const note = el('textarea', { class: 'field', rows: '2', maxlength: '300', value: p.note || '', placeholder: 'A note (optional)', 'aria-label': 'Note' });
    const form = el('form', { class: 'mn-form', onsubmit: async e => {
      e.preventDefault();
      const a = C.parseAmount(amount.value);
      if (!name.value.trim()) { name.focus(); return; }
      if (!a) { toast('Enter the amount in pounds, e.g. 45.99.'); amount.focus(); return; }
      const row = { name: name.value.trim(), amount_pence: Math.abs(a), cadence: cad.value, next_on: date.value || p.next_on, note: note.value.trim() || null };
      try { await q(sb.from('money_planned').update(row).eq('id', p.id)); } catch (er) { return; }
      Object.assign(p, row); dlg.close(); toast('Saved.'); draw();
    } },
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Name'), name),
      el('div', { class: 'mn-two' }, el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Amount (£)'), amount), el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'How often'), cad)),
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Next date it goes out'), date),
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Note'), note),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Save'),
        el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
        el('button', { class: 'btn danger mn-right', type: 'button', onclick: async () => { dlg.close(); await removePlanned(p); } }, 'Delete')));
    const dlg = dialog('Edit ' + p.name, form);
  }
  async function removePlanned(p) {
    if (!confirm(`Delete “${p.name}” from your direct debits & bills?`)) return;
    try { await q(sb.from('money_planned').delete().eq('id', p.id)); } catch (e) { return; }
    M.planned = M.planned.filter(x => x !== p); toast('Deleted.'); draw();
  }

  /* ---------- loans (you owe) and lending (owed to you): records you keep, with repayments ---------- */
  const DEBT_TEXT = {
    borrowed: { title: 'Loans', sub: 'Money you owe. A record only, separate from money in and out.', who: 'Who you borrowed from, e.g. Barclays, Dad',
      left: 'left to pay', log: 'Log a payment', paid: 'paid back', done: 'Paid off', empty: 'Add money you’ve borrowed (a loan, a card, from family) and log what you pay back.' },
    lent: { title: 'Lending', sub: 'Money owed to you. A record only, separate from money in and out.', who: 'Who you lent to, e.g. Ali',
      left: 'to come back', log: 'Log money back', paid: 'paid back', done: 'Paid back', empty: 'Add money you’ve lent and log it as it comes back.' }
  };
  const paysOf = d => M.debtPays.filter(x => x.debt_id === d.id);
  const paidOf = d => paysOf(d).reduce((a, x) => a + x.amount_pence, 0);
  const leftOf = d => Math.max(0, d.amount_pence - paidOf(d));
  const shortDate = d => fmt(d, { day: 'numeric', month: 'short', year: d.slice(0, 4) !== today().slice(0, 4) ? 'numeric' : undefined });
  function dueText(d) {
    if (!d.due_on) return null;
    const days = Math.round((Date.parse(d.due_on) - Date.parse(today())) / 864e5);
    if (days < 0) return el('span', { class: 'mn-overdue' }, `⚠ Overdue since ${shortDate(d.due_on)}`);
    if (days === 0) return el('span', { class: 'mn-soon' }, 'Due today');
    return el('span', { class: days <= 14 ? 'mn-soon' : '' }, `Due ${shortDate(d.due_on)}` + (days <= 14 ? ` · in ${days} day${days === 1 ? '' : 's'}` : ''));
  }
  function debtCard(dir) {
    const T = DEBT_TEXT[dir], all = M.debts.filter(d => d.direction === dir);
    const open = all.filter(d => leftOf(d) > 0), closed = all.filter(d => leftOf(d) <= 0);
    open.sort((a, b) => (a.due_on || '9999') < (b.due_on || '9999') ? -1 : (a.due_on || '9999') > (b.due_on || '9999') ? 1 : (a.started_on < b.started_on ? -1 : 1));
    const total = open.reduce((a, d) => a + leftOf(d), 0);
    const row = d => {
      const paid = paidOf(d), left = leftOf(d), pct = Math.min(100, paid / d.amount_pence * 100);
      const inp = el('input', { class: 'field mn-dpay', inputmode: 'decimal', placeholder: '£ amount', 'aria-label': `${T.log} for ${d.name}` });
      const log = async () => {
        const a = C.parseAmount(inp.value);
        if (!a || a < 0) { toast('Enter the amount in pounds, e.g. 50.'); inp.focus(); return; }
        if (a > left && !confirm(`That’s more than what’s left (${gbp(left)}). Log ${gbp(a)} anyway?`)) return;
        let row; try { row = await q(sb.from('money_debt_payments').insert({ user_id: DS.uid(), debt_id: d.id, paid_on: today(), amount_pence: a }).select().single()); } catch (e) { return; }
        M.debtPays.push(row);
        toast(leftOf(d) ? `${gbp(a)} logged. ${gbp(leftOf(d))} ${T.left}.` : `${d.name}: all ${dir === 'borrowed' ? 'paid off' : 'paid back'}. Nice.`);
        draw();
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); log(); } });
      return el('div', { class: 'mn-drow' + (left ? '' : ' done') },
        el('div', { class: 'mn-dtop' },
          el('button', { type: 'button', class: 'mn-pn', title: 'Edit and see payments', onclick: () => debtDialog(d) }, el('b', {}, d.name), d.note ? el('small', {}, d.note) : null),
          el('span', { class: 'mn-dleft' }, left ? [amt(left), el('small', {}, T.left)] : el('span', { class: 'mn-donetag' }, '✓ ' + T.done))),
        el('span', { class: 'mn-bar', 'aria-hidden': 'true' }, el('i', { style: `width:${pct.toFixed(1)}%` })),
        el('div', { class: 'mn-dmeta' },
          el('span', {}, amt(paid), ` ${T.paid} of `, amt(d.amount_pence), ` · since ${shortDate(d.started_on)}`),
          left ? dueText(d) : null),
        left ? el('div', { class: 'mn-dlog' }, inp, el('button', { type: 'button', class: 'btn', onclick: log }, T.log)) : null);
    };
    const name = el('input', { class: 'field', id: `mn-d${dir}-name`, maxlength: '80', placeholder: T.who, 'aria-label': 'Who' });
    const amount = el('input', { class: 'field', id: `mn-d${dir}-amt`, inputmode: 'decimal', placeholder: '£ amount', 'aria-label': 'Amount in pounds' });
    const started = el('input', { class: 'field', type: 'date', value: today(), 'aria-label': dir === 'borrowed' ? 'Date borrowed' : 'Date lent', title: dir === 'borrowed' ? 'Date borrowed' : 'Date lent' });
    const due = el('input', { class: 'field', type: 'date', 'aria-label': 'Due date (optional)', title: 'Due date (optional)' });
    const note = el('input', { class: 'field', maxlength: '300', placeholder: 'Note (optional)', 'aria-label': 'Note' });
    const add = async e => {
      e.preventDefault();
      const n = name.value.trim(), a = C.parseAmount(amount.value);
      if (!n) { name.focus(); return; }
      if (!a || a < 0) { toast('Enter the amount in pounds, e.g. 2,000.'); amount.focus(); return; }
      let row;
      try { row = await q(sb.from('money_debts').insert({ user_id: DS.uid(), book_id: M.book, direction: dir, name: n, amount_pence: a, started_on: started.value || today(), due_on: due.value || null, note: note.value.trim() || null }).select().single()); } catch (er) { return; }
      M.debts.push(row); toast(`Added ${n}.`); draw(`mn-d${dir}-name`);
    };
    return el('section', { class: 'mn-card mn-debt mn-debt-' + dir, 'data-sum': open.length ? `${gbp(total)} ${T.left}` : (dir === 'borrowed' ? 'nothing owed' : 'nothing owed to you') },
      el('div', { class: 'mn-ch' }, el('h3', {}, T.title),
        open.length ? el('span', { class: 'mn-psum' }, amt(total), ' ' + T.left) : null),
      el('p', { class: 'mn-pnote' }, T.sub),
      open.length ? el('div', { class: 'mn-dlist mn-cap', 'data-cap': 'debt-' + dir, 'data-items': '.mn-drow' }, open.map(row)) : el('p', { class: 'mn-empty' }, closed.length ? `Nothing ${dir === 'borrowed' ? 'owed' : 'owed to you'} right now.` : T.empty),
      closed.length ? el('details', { class: 'mn-table mn-dclosed' }, el('summary', {}, `${T.done} (${closed.length})`), el('div', { class: 'mn-dlist mn-cap', 'data-cap': 'done-' + dir, 'data-items': '.mn-drow' }, closed.map(row))) : null,
      el('form', { class: 'mn-dadd', onsubmit: add }, name, amount,
        el('label', { class: 'mn-dl' }, el('span', {}, dir === 'borrowed' ? 'Borrowed on' : 'Lent on'), started),
        el('label', { class: 'mn-dl' }, el('span', {}, 'Due (optional)'), due),
        note, el('button', { type: 'submit', class: 'btn primary' }, icon('plus', 14), ' Add')));
  }
  function debtDialog(d) {
    const T = DEBT_TEXT[d.direction];
    const name = el('input', { class: 'field', maxlength: '80', value: d.name, 'aria-label': 'Who' });
    const amount = el('input', { class: 'field', inputmode: 'decimal', value: (d.amount_pence / 100).toFixed(2), 'aria-label': 'Amount in pounds' });
    const started = el('input', { class: 'field', type: 'date', value: d.started_on, 'aria-label': 'Started' });
    const due = el('input', { class: 'field', type: 'date', value: d.due_on || '', 'aria-label': 'Due date (optional)' });
    const note = el('textarea', { class: 'field', rows: '2', maxlength: '300', value: d.note || '', placeholder: 'A note (optional)', 'aria-label': 'Note' });
    const pays = el('div', { class: 'mn-dpays' });
    const paintPays = () => {
      const list = paysOf(d).slice().reverse();
      pays.replaceChildren(el('h3', {}, `Payments (${list.length})`),
        list.length ? el('table', {}, el('tbody', {}, list.map(x => el('tr', {},
          el('td', {}, shortDate(x.paid_on)), el('td', { class: 'num' }, amt(x.amount_pence)),
          el('td', {}, el('button', { type: 'button', class: 'mn-del', 'aria-label': `Delete payment of ${gbp(x.amount_pence)} on ${shortDate(x.paid_on)}`, onclick: async () => {
            if (!confirm(`Delete the ${gbp(x.amount_pence)} payment from ${shortDate(x.paid_on)}?`)) return;
            try { await q(sb.from('money_debt_payments').delete().eq('id', x.id)); } catch (e) { return; }
            M.debtPays = M.debtPays.filter(y => y !== x); paintPays(); draw();
          } }, icon('trash', 14))))))) : el('p', { class: 'meta' }, 'None logged yet.'));
    };
    paintPays();
    const form = el('form', { class: 'mn-form', onsubmit: async e => {
      e.preventDefault();
      const a = C.parseAmount(amount.value);
      if (!name.value.trim()) { name.focus(); return; }
      if (!a || a < 0) { toast('Enter the amount in pounds.'); amount.focus(); return; }
      const row = { name: name.value.trim(), amount_pence: a, started_on: started.value || d.started_on, due_on: due.value || null, note: note.value.trim() || null };
      try { await q(sb.from('money_debts').update(row).eq('id', d.id)); } catch (er) { return; }
      Object.assign(d, row); dlg.close(); toast('Saved.'); draw();
    } },
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, d.direction === 'borrowed' ? 'Borrowed from' : 'Lent to'), name),
      el('div', { class: 'mn-two' }, el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Full amount (£)'), amount),
        el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, d.direction === 'borrowed' ? 'Borrowed on' : 'Lent on'), started)),
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Due date (optional)'), due),
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Note'), note),
      pays,
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Save'),
        el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
        el('button', { class: 'btn danger mn-right', type: 'button', onclick: async () => { if (await removeDebt(d)) dlg.close(); } }, 'Delete')));
    const dlg = dialog(`${T.title}: ${d.name}`, form);
  }
  async function removeDebt(d) {
    if (!confirm(`Delete “${d.name}” and its payments?`)) return false;
    try { await q(sb.from('money_debts').delete().eq('id', d.id)); } catch (e) { return false; }
    M.debts = M.debts.filter(x => x !== d); M.debtPays = M.debtPays.filter(x => x.debt_id !== d.id);
    toast('Deleted.'); draw(); return true;
  }

  /* ---------- export: this month so far, every book (the same report that's emailed on the 30th) ---------- */
  async function reportData(start, end) {
    const prev = addMonths(start, -1);
    const [cats, tx, planned, debts, debtPays, holdings, values] = await Promise.all([
      q(sb.from('money_categories').select('book_id,name,kind,budget_pence')),
      q(sb.from('money_tx').select('book_id,occurred_on,amount_pence,description,category,note,source,import_key').gte('occurred_on', prev).lte('occurred_on', end).limit(50000)),
      q(sb.from('money_planned').select('id,book_id,name,amount_pence,cadence,next_on')).catch(() => []),
      q(sb.from('money_debts').select('id,book_id,direction,name,amount_pence,due_on')).catch(() => []),
      q(sb.from('money_debt_payments').select('debt_id,paid_on,amount_pence')).catch(() => []),
      q(sb.from('money_holdings').select('id,name,archived')),
      q(sb.from('money_values').select('holding_id,valued_on,value_pence').order('valued_on'))]);
    return { books: M.books.map(b => ({ id: b.id, name: b.name, kind: b.kind })), cats, tx, planned, debts, debtPays, holdings, values };
  }
  async function exportDialog() {
    const R = window.MoneyReport, t0 = today(), start = monthStart(t0);
    const body = el('div', { class: 'mn-exp' }, el('p', { class: 'meta' }, 'Putting your report together…'));
    const dlg = dialog('Export report', body, 'mn-expdlg');
    let data;
    try { data = await reportData(start, t0); } catch (e) { body.replaceChildren(el('p', { class: 'meta' }, 'Couldn’t load your figures. Check your connection and try again.')); return; }
    const report = R.build(data, { start, end: t0, made: new Date().toISOString() });
    const frame = el('iframe', { class: 'mn-expframe', title: 'Report preview' });
    frame.srcdoc = R.html(report);
    const file = `Capital report ${start} to ${t0}`;
    const pdf = () => { const w = frame.contentWindow; if (!w) return; w.document.title = file; w.focus(); w.print(); };
    const sheet = () => {
      const url = URL.createObjectURL(new Blob([R.csv(data, { start, end: t0 })], { type: 'text/csv;charset=utf-8' }));
      const a = el('a', { href: url, download: file + '.csv' }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Spreadsheet downloaded.');
    };
    const mail = el('button', { type: 'button', class: 'btn', onclick: async () => {
      mail.disabled = true; mail.textContent = 'Sending…';
      let res = null;
      try { res = await sb.functions.invoke('capital-report', { body: { send: true } }); } catch (e) {}
      const sent = res && !res.error && res.data && res.data.emailed;
      mail.disabled = false; mail.textContent = sent ? 'Sent ✓' : 'Email it to me';
      toast(sent ? `Report emailed to ${(state.user && state.user.email) || 'you'}.` : 'Couldn’t send the email just now. Try again in a minute.');
    } }, 'Email it to me');
    body.replaceChildren(
      el('p', { class: 'meta mn-expwhat' }, el('b', {}, `${fmt(start, { day: 'numeric' })}–${fmt(t0, { day: 'numeric', month: 'long', year: 'numeric' })}`),
        ` · ${report.books.map(b => b.name).join(', ')} · ${gbp(report.all.in)} in, ${gbp(report.all.out)} out`),
      frame,
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn primary', onclick: pdf }, 'Save as PDF'),
        el('button', { type: 'button', class: 'btn', onclick: sheet }, 'Download spreadsheet'),
        mail,
        el('button', { type: 'button', class: 'btn mn-right', onclick: () => dlg.close() }, 'Close')),
      el('p', { class: 'mn-exptip' }, 'This report is emailed to you automatically on the 30th of every month at 6pm (on the last day in February). “Save as PDF” opens the print window: choose “Save as PDF” there.'));
  }

  /* ---------- dialogs ---------- */
  function dialog(title, body, cls) {
    const dlg = el('dialog', { class: 'mn-dlg ' + (cls || ''), 'aria-label': title });
    // a ✕ in the corner, and a click on the dimmed background outside it, close it (as well as Escape)
    const x = el('button', { type: 'button', class: 'mn-x', 'aria-label': 'Close', title: 'Close', onclick: () => dlg.close() }, '✕');
    dlg.append(el('div', { class: 'dlg' }, el('div', { class: 'mn-dlghead' }, el('h2', {}, title), x), body));
    let downOutside = false;
    dlg.addEventListener('pointerdown', e => { downOutside = e.target === dlg; });
    dlg.addEventListener('click', e => { if (e.target === dlg && downOutside) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
    return dlg;
  }
  function editDialog(t) {
    const desc = el('input', { class: 'field', maxlength: '300', value: t.description, 'aria-label': 'Description' });
    const amount = el('input', { class: 'field', inputmode: 'decimal', value: (Math.abs(t.amount_pence) / 100).toFixed(2), 'aria-label': 'Amount in pounds' });
    let dir = t.amount_pence > 0 ? 'in' : 'out';
    const seg = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Money in or out' },
      ['out', 'in'].map(k => el('button', { type: 'button', role: 'radio', 'aria-checked': String(dir === k), class: dir === k ? 'on' : '',
        onclick: e => { dir = k; seg.querySelectorAll('button').forEach(b => { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); } }, k === 'out' ? 'Money out' : 'Money in')));
    const date = el('input', { class: 'field', type: 'date', value: t.occurred_on, 'aria-label': 'Date' });
    const cat = catSelect(t.category, { label: 'Category' });
    const note = el('textarea', { class: 'field', rows: '2', maxlength: '1000', value: t.note || '', placeholder: 'A note (optional)', 'aria-label': 'Note' });
    const form = el('form', { class: 'mn-form', onsubmit: async e => {
      e.preventDefault();
      const p = C.parseAmount(amount.value);
      if (!p) { toast('Enter an amount, e.g. 12.50.'); amount.focus(); return; }
      if (!desc.value.trim()) { desc.focus(); return; }
      const row = { description: desc.value.trim().slice(0, 300), amount_pence: (dir === 'in' ? 1 : -1) * Math.abs(p), occurred_on: date.value || t.occurred_on, category: cat.value || null, note: note.value.trim() || null };
      try { await q(sb.from('money_tx').update(row).eq('id', t.id)); } catch (er) { return; }
      if (row.category && row.category !== t.category) learn(row.description, row.category);
      Object.assign(t, row); sortTx(); dlg.close(); toast('Saved.'); draw();
    } },
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Description'), desc),
      el('div', { class: 'mn-two' }, el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Amount (£)'), amount), el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Date'), date)),
      seg,
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Category'), cat),
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Note'), note),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Save'),
        el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
        el('button', { class: 'btn danger mn-right', type: 'button', onclick: async () => { dlg.close(); await del(t); } }, 'Delete')));
    const dlg = dialog('Edit payment', form);
  }

  // categories for this book: rename, give a monthly budget, add or remove
  function catsDialog() {
    const body = el('div', { class: 'mn-cats' });
    const paint = () => body.replaceChildren(
      el('p', { class: 'meta' }, `Categories for ${book().name}. A budget is per month; leave it empty for no budget.`),
      ...['out', 'in'].map(kind => el('section', {},
        el('h3', {}, kind === 'out' ? 'Spending' : 'Money in'),
        catsOf(kind).map(c => {
          const name = el('input', { class: 'field', maxlength: '60', value: c.name, 'aria-label': 'Category name' });
          name.addEventListener('change', () => rename(c, name.value.trim()));
          const budget = kind === 'out' ? el('input', { class: 'field mn-budget', inputmode: 'decimal', placeholder: 'No budget', 'aria-label': `Monthly budget for ${c.name}`,
            value: c.budget_pence != null ? (c.budget_pence / 100).toFixed(c.budget_pence % 100 ? 2 : 0) : '' }) : null;
          if (budget) budget.addEventListener('change', async () => {
            const v = budget.value.trim() ? C.parseAmount(budget.value) : null;
            if (budget.value.trim() && (v == null || v < 0)) { toast('Enter a budget in pounds, e.g. 300.'); return; }
            try { await q(sb.from('money_categories').update({ budget_pence: v == null ? null : Math.abs(v) }).eq('id', c.id)); } catch (e) { return; }
            c.budget_pence = v == null ? null : Math.abs(v); toast(v == null ? `${c.name}: no budget.` : `${c.name}: ${gbp(Math.abs(v), { whole: true })} a month.`); draw();
          });
          return el('div', { class: 'mn-crow' }, name, budget ? el('span', { class: 'mn-pound' }, '£', budget, el('small', {}, '/month')) : null,
            el('button', { type: 'button', class: 'mn-del', title: 'Delete category', 'aria-label': `Delete ${c.name}`, onclick: () => remove(c) }, icon('trash', 15)));
        }),
        addRow(kind))));
    const addRow = kind => {
      const n = el('input', { class: 'field', maxlength: '60', placeholder: kind === 'out' ? 'New spending category' : 'New money-in category', 'aria-label': 'New category name' });
      const go = async () => {
        const v = n.value.trim(); if (!v) return;
        if (M.cats.some(c => c.kind === kind && c.name.toLowerCase() === v.toLowerCase())) { toast('That category is already there.'); return; }
        try { const row = await q(sb.from('money_categories').insert({ user_id: DS.uid(), book_id: M.book, name: v, kind, position: Date.now() / 1000 }).select().single()); M.cats.push(row); } catch (e) { return; }
        paint(); draw();
      };
      n.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      return el('div', { class: 'mn-crow add' }, n, el('button', { type: 'button', class: 'btn', onclick: go }, icon('plus', 14), ' Add'));
    };
    async function rename(c, v) {
      if (!v || v === c.name) return;
      if (M.cats.some(x => x !== c && x.kind === c.kind && x.name.toLowerCase() === v.toLowerCase())) { toast('That name is already used.'); paint(); return; }
      const old = c.name;
      try {
        await q(sb.from('money_categories').update({ name: v }).eq('id', c.id));
        await q(sb.from('money_tx').update({ category: v }).eq('book_id', M.book).eq('category', old));
        await q(sb.from('money_rules').update({ category: v }).eq('book_id', M.book).eq('category', old));
      } catch (e) { paint(); return; }
      c.name = v; M.tx.forEach(t => { if (t.category === old) t.category = v; }); M.rules.forEach(r => { if (r.category === old) r.category = v; });
      if (M.filter === old) M.filter = v;
      toast(`Renamed to ${v}.`); draw();
    }
    async function remove(c) {
      const n = M.tx.filter(t => t.category === c.name).length;
      if (!confirm(`Delete the category “${c.name}”?${n ? ` Payments in it become uncategorised.` : ''}`)) return;
      try {
        await q(sb.from('money_tx').update({ category: null }).eq('book_id', M.book).eq('category', c.name));
        await q(sb.from('money_rules').delete().eq('book_id', M.book).eq('category', c.name));
        await q(sb.from('money_categories').delete().eq('id', c.id));
      } catch (e) { return; }
      M.cats = M.cats.filter(x => x !== c); M.tx.forEach(t => { if (t.category === c.name) t.category = null; }); M.rules = M.rules.filter(r => r.category !== c.name);
      if (M.filter === c.name) M.filter = null;
      paint(); draw();
    }
    paint();
    const dlg = dialog('Categories & budgets', el('div', {}, body, el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'button', onclick: () => dlg.close() }, 'Done'))), 'mn-catdlg');
  }

  /* ---------- import a bank statement (CSV) ---------- */
  function importDialog() {
    const body = el('div', { class: 'mn-imp' });
    const file = el('input', { type: 'file', id: 'mn-file', class: 'mn-file', accept: '.csv,text/csv,text/plain' });
    let rows = null, map = null, into = M.book;
    const pickFile = () => body.replaceChildren(
      el('p', { class: 'meta' }, 'Download your statement as a CSV file from your bank’s app or website (Monzo, Starling, Revolut, HSBC, Barclays, Lloyds, Nationwide and others all offer it), then choose it here. Importing the same statement twice is safe: lines already in are skipped.'),
      el('label', { class: 'mn-drop', for: 'mn-file' }, icon('upload', 22), el('b', {}, 'Choose a statement file'), el('small', {}, 'or drop it here')), file,
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel')));
    const read = async f => {
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast('That file is too big for a statement (over 5 MB).'); return; }
      const text = await f.text();
      rows = C.parseCSV(text);
      if (rows.length < 2) { toast('That file doesn’t look like a statement. Choose the CSV export from your bank.'); return; }
      map = { ...C.detect(rows), flip: false };
      preview();
    };
    file.addEventListener('change', () => read(file.files[0]));
    body.addEventListener('dragover', e => { e.preventDefault(); body.classList.add('drag'); });
    body.addEventListener('dragleave', () => body.classList.remove('drag'));
    body.addEventListener('drop', e => { e.preventDefault(); body.classList.remove('drag'); read(e.dataTransfer.files[0]); });

    async function preview() {
      const { tx, skipped } = C.toTx(rows, map);
      const colSel = (key, label, allowNone) => {
        const s = el('select', { class: 'field', 'aria-label': label },
          allowNone ? el('option', { value: '-1' }, '—') : null,
          map.names.map((n, i) => el('option', { value: String(i) }, n)));
        s.value = String(map[key]);
        s.addEventListener('change', () => { map[key] = +s.value; if (key === 'amount' && map.amount >= 0) { map.out = -1; map.inn = -1; } if ((key === 'out' || key === 'inn') && map[key] >= 0) map.amount = -1; preview(); });
        return el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, label), s);
      };
      const two = map.amount < 0;
      const flip = el('input', { type: 'checkbox', id: 'mn-flip', checked: map.flip, onchange: e => { map.flip = e.target.checked; preview(); } });
      const order = el('select', { class: 'field', 'aria-label': 'Date order', onchange: e => { map.order = e.target.value; preview(); } },
        el('option', { value: 'dmy' }, 'Day first (UK, 04/10/2026)'), el('option', { value: 'mdy' }, 'Month first (US, 10/04/2026)'));
      order.value = map.order;
      const bookSel = el('select', { class: 'field', 'aria-label': 'Import into', onchange: e => { into = e.target.value; } }, M.books.map(b => el('option', { value: b.id }, b.name)));
      bookSel.value = into;
      // how many of these are already in (matching lines from an earlier import)
      let existing = new Set();
      if (tx.length) {
        const dates = tx.map(t => t.occurred_on).sort();
        try {
          const have = await q(sb.from('money_tx').select('import_key').eq('book_id', into).not('import_key', 'is', null).gte('occurred_on', dates[0]).lte('occurred_on', dates[dates.length - 1]).limit(20000));
          existing = new Set(have.map(h => h.import_key));
        } catch (e) {}
      }
      const dates = tx.map(t => t.occurred_on).sort();
      // a direct debit you ticked as paid is already in money out: the same amount within 5 days on the statement is that payment
      const dupDD = new Set();
      if (tx.length) {
        let ticked = [];
        try { ticked = await q(sb.from('money_tx').select('id,occurred_on,amount_pence').eq('book_id', into).like('import_key', 'dd|%').gte('occurred_on', addDays(dates[0], -5)).lte('occurred_on', addDays(dates[dates.length - 1], 5)).limit(5000)); } catch (e) {}
        const used = new Set();
        for (const t of tx) {
          if (existing.has(t.import_key)) continue;
          const m = ticked.find(x => !used.has(x.id) && x.amount_pence === t.amount_pence && Math.abs(Date.parse(x.occurred_on) - Date.parse(t.occurred_on)) <= 5 * 864e5);
          if (m) { used.add(m.id); dupDD.add(t.import_key); }
        }
      }
      const fresh = tx.filter(t => !existing.has(t.import_key) && !dupDD.has(t.import_key));
      const ins = tx.filter(t => t.amount_pence > 0).length, outs = tx.length - ins;
      body.replaceChildren(...[
        el('div', { class: 'mn-map' },
          colSel('date', 'Date column'), colSel('desc', 'Description column'),
          two ? [colSel('out', 'Money out column', true), colSel('inn', 'Money in column', true)] : colSel('amount', 'Amount column', true),
          el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Dates are written'), order),
          el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Import into'), bookSel)),
        two ? null : el('label', { class: 'ls-check', for: 'mn-flip' }, flip, el('span', {}, 'My bank shows spending as positive numbers (swap money in and out)')),
        tx.length ? el('p', { class: 'mn-sum' }, el('b', {}, `${tx.length} payments`), ` from ${fmt(dates[0], { day: 'numeric', month: 'short', year: 'numeric' })} to ${fmt(dates[dates.length - 1], { day: 'numeric', month: 'short', year: 'numeric' })}: ${outs} out, ${ins} in. `,
          existing.size > 0 && fresh.length < tx.length ? el('span', {}, `${tx.length - fresh.length} already imported, so `, el('b', {}, `${fresh.length} new`), '. ') : null,
          dupDD.size ? el('span', {}, `${dupDD.size} already ticked off as direct debit${dupDD.size === 1 ? '' : 's'}, so left out. `) : null,
          skipped.length ? el('span', { class: 'mn-warn' }, `${skipped.length} line${skipped.length === 1 ? '' : 's'} skipped (no date or amount).`) : null)
          : el('p', { class: 'mn-warn' }, 'No payments found with these columns. Check the columns above match your file.'),
        tx.length ? el('div', { class: 'mn-prev' }, el('table', {},
          el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Description'), el('th', {}, 'Category'), el('th', { class: 'num' }, 'Amount'))),
          el('tbody', {}, tx.slice(0, 8).map(t => el('tr', { class: existing.has(t.import_key) || dupDD.has(t.import_key) ? 'dup' : '' },
            el('td', {}, fmt(t.occurred_on, { day: 'numeric', month: 'short' })), el('td', {}, t.description),
            el('td', {}, guessCat(t.description, t.amount_pence > 0) || '—'), el('td', { class: 'num' }, amt(t.amount_pence, { plus: true }, t.amount_pence > 0 ? 'in' : 'out'))))))) : null,
        tx.length > 8 ? el('p', { class: 'meta' }, `…and ${tx.length - 8} more.`) : null,
        el('div', { class: 'actions' },
          el('button', { type: 'button', class: 'btn primary', disabled: !fresh.length, onclick: () => doImport(fresh) }, fresh.length ? `Import ${fresh.length} payment${fresh.length === 1 ? '' : 's'}` : 'Nothing new to import'),
          el('button', { type: 'button', class: 'btn', onclick: () => { rows = null; file.value = ''; pickFile(); } }, 'Choose another file'),
          el('button', { type: 'button', class: 'btn mn-right', onclick: () => dlg.close() }, 'Cancel'))].filter(Boolean));
    }
    async function doImport(list) {
      const btn = body.querySelector('.btn.primary'); btn.disabled = true; btn.textContent = 'Importing…';
      // categories: what you've taught it for this book first, then a sensible guess
      const target = into;
      if (target !== M.book) { M.book = target; store('mn_book', target); M.view = 'book'; await loadBook(); }
      const rowsOut = list.map(t => ({ user_id: DS.uid(), book_id: target, occurred_on: t.occurred_on, amount_pence: t.amount_pence, description: t.description,
        category: guessCat(t.description, t.amount_pence > 0) || null, source: 'import', import_key: t.import_key }));
      let done = 0;
      try {
        for (let i = 0; i < rowsOut.length; i += 400) {
          await q(sb.from('money_tx').upsert(rowsOut.slice(i, i + 400), { onConflict: 'user_id,book_id,import_key', ignoreDuplicates: true }));
          done += Math.min(400, rowsOut.length - i);
        }
      } catch (e) { btn.disabled = false; btn.textContent = 'Try again'; return; }
      const sorted = rowsOut.filter(r => r.category).length;
      // show the month the statement ends in, if this month has none of it
      const latest = rowsOut.map(r => r.occurred_on).sort().pop();
      if (!rowsOut.some(r => r.occurred_on >= M.month && r.occurred_on <= monthEnd(M.month))) M.month = monthStart(latest);
      await loadBook();
      dlg.close();
      toast(`Imported ${done} payment${done === 1 ? '' : 's'}${sorted ? `, ${sorted} sorted into categories` : ''}.${done - sorted ? ' Sort the rest in the list; it learns as you go.' : ''}`);
      draw();
    }
    pickFile();
    const dlg = dialog('Import a bank statement', body, 'mn-impdlg');
  }

  /* =====================================================================
     Net worth: things you own (and owe), added by you, with their value over time
     ===================================================================== */
  const KINDS = ['Stocks & shares ISA', 'Cash ISA', 'Lifetime ISA', 'Pension', 'Shares', 'Funds', 'Crypto', 'Savings', 'Current account', 'Premium Bonds', 'Property', 'Business stake', 'Other', 'Mortgage', 'Loan', 'Credit card'];
  const DEBT = new Set(['Mortgage', 'Loan', 'Credit card']);
  const valuesOf = h => M.values.filter(v => v.holding_id === h.id);
  const valueAt = (h, d) => { let v = null; for (const x of valuesOf(h)) if (x.valued_on <= d) v = x; else break; return v; };

  function worthView() {
    const t0 = today(), month0 = monthStart(t0);
    const total = d => M.holdings.reduce((a, h) => a + ((valueAt(h, d) || {}).value_pence || 0), 0);
    const now = total(t0), ago = total(addDays(t0, -30)), owned = M.holdings.filter(h => !DEBT.has(h.kind)).reduce((a, h) => a + Math.max(0, (valueAt(h, t0) || {}).value_pence || 0), 0);
    const owe = -M.holdings.filter(h => DEBT.has(h.kind)).reduce((a, h) => a + ((valueAt(h, t0) || {}).value_pence || 0), 0);
    const first = M.values.length ? monthStart(M.values[0].valued_on) : month0;
    const months = []; for (let m = first; m <= month0 && months.length < 60; m = addMonths(m, 1)) months.push(m);
    const points = months.slice(-24).map(m => ({ m, v: total(m === month0 ? t0 : monthEnd(m)) }));
    const k = (label, value, note, cls) => el('div', { class: 'mn-kpi' + (cls ? ' ' + cls : '') }, el('span', {}, label), el('b', {}, value), note ? el('small', {}, note) : null);
    return [
      el('div', { class: 'mn-kpis' },
        k('Net worth', amt(now), 'everything you own, minus what you owe', now < 0 ? 'neg' : ''),
        k('Last 30 days', amt(now - ago, { plus: true }), now - ago >= 0 ? 'up' : 'down', now - ago < 0 ? 'neg' : 'pos'),
        k('You own', amt(owned), `${M.holdings.filter(h => !DEBT.has(h.kind)).length} investments & accounts`),
        k('You owe', amt(owe), owe ? plural(M.holdings.filter(h => DEBT.has(h.kind)).length, 'debt') : 'nothing added')),
      split(worthChart(points), holdingsCard())];
  }
  function worthChart(points) {
    const card = el('section', { class: 'mn-card mn-worthchart', 'data-sum': points.length > 1 ? `${gbp(points[points.length - 1].v, { whole: true })} now` : '' }, el('div', { class: 'mn-ch' }, el('h3', {}, 'Net worth over time')));
    if (points.length < 2 || !M.values.length) { card.append(el('p', { class: 'mn-empty' }, 'Your net worth line starts once values have been updated in two different months. Update them every month or so.')); return card; }
    const W = chartWidth(1), H = 220, L = 64, B = 26, T = 12, R = 10, plot = H - B - T;
    // round steps for the axis (£10,000, £20,000…), starting from £0 unless it dips below
    const vs = points.map(p => p.v), rawLo = Math.min(0, ...vs), rawHi = Math.max(...vs, 100);
    const rough = (rawHi - rawLo) / 3, mag = Math.pow(10, Math.floor(Math.log10(rough))), stepV = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= rough);
    const lo = Math.floor(rawLo / stepV) * stepV, hi = Math.ceil(rawHi / stepV) * stepV, span = hi - lo || 1;
    const x = i => L + (W - L - R) * (points.length === 1 ? 0 : i / (points.length - 1)), y = v => T + plot - (v - lo) / span * plot;
    let svg = '';
    for (let v = lo; v <= hi + 1; v += stepV) { const yy = y(v).toFixed(1); svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="mn-grid-l"/><text x="${L - 8}" y="${(+yy + 4).toFixed(1)}" text-anchor="end" class="mn-axis mn-amt">${esc(gbp(v, { whole: true }))}</text>`; }
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    svg += `<path d="${line} L${x(points.length - 1).toFixed(1)},${(T + plot).toFixed(1)} L${x(0).toFixed(1)},${(T + plot).toFixed(1)} Z" class="mn-area"/><path d="${line}" class="mn-line"/>`;
    const step = Math.ceil(points.length / 8);
    points.forEach((p, i) => { if (i % step === 0 || i === points.length - 1) svg += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="mn-axis">${esc(fmt(p.m, { month: 'short' }) + (p.m.slice(5, 7) === '01' || i === 0 ? ' ’' + p.m.slice(2, 4) : ''))}</text>`; });
    const lp = points[points.length - 1];
    svg += `<circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(lp.v).toFixed(1)}" r="4.5" class="mn-dotend"/>`;
    svg += `<line class="mn-cross" x1="0" x2="0" y1="${T}" y2="${T + plot}" visibility="hidden"/><circle class="mn-crossdot" r="4.5" visibility="hidden"/>`;
    const fig = el('figure', { class: 'mn-chart' });
    fig.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net worth by month">${svg}</svg>`;
    const tipEl = el('div', { class: 'mn-tip-pop mn-amt', hidden: true }); fig.append(tipEl);
    const svgEl = fig.querySelector('svg'), cross = fig.querySelector('.mn-cross'), dot = fig.querySelector('.mn-crossdot');
    fig.addEventListener('pointermove', e => {
      const r = svgEl.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(points.length - 1, Math.round((px - L) / ((W - L - R) / Math.max(1, points.length - 1)))));
      const cx = x(i), cy = y(points[i].v);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
      tipEl.textContent = `${monthName(points[i].m)} · ${gbp(points[i].v)}`; tipEl.hidden = false;
      const fr = fig.getBoundingClientRect(), z = fig.offsetWidth ? fr.width / fig.offsetWidth : 1;
      tipEl.style.left = (cx / W * r.width + r.left - fr.left) / z + 'px'; tipEl.style.top = (cy / H * r.height + r.top - fr.top) / z - 14 + 'px';
    });
    fig.addEventListener('pointerleave', () => { tipEl.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
    card.append(fig, el('details', { class: 'mn-table' }, el('summary', {}, 'Show as a table'),
      el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Month'), el('th', {}, 'Net worth'))),
        el('tbody', {}, points.map(p => el('tr', {}, el('td', {}, monthName(p.m)), el('td', {}, amt(p.v))))))));
    return card;
  }
  function holdingsCard() {
    const t0 = today();
    const name = el('input', { class: 'field', id: 'mn-hname', maxlength: '80', placeholder: 'e.g. Vanguard ISA, Workplace pension, Bitcoin', 'aria-label': 'Name' });
    const kind = el('select', { class: 'field', id: 'mn-hkind', 'aria-label': 'Type' }, KINDS.map(k => el('option', { value: k }, k)));
    const value = el('input', { class: 'field', id: 'mn-hval', inputmode: 'decimal', placeholder: 'Value today, e.g. 12,500', 'aria-label': 'Value in pounds' });
    const add = async e => {
      e.preventDefault();
      const n = name.value.trim(), p = C.parseAmount(value.value);
      if (!n) { name.focus(); return; }
      if (p == null) { toast('Enter its value in pounds, e.g. 12,500.'); value.focus(); return; }
      try {
        const h = await q(sb.from('money_holdings').insert({ user_id: DS.uid(), name: n, kind: kind.value, position: Date.now() / 1000 }).select().single());
        const v = await q(sb.from('money_values').insert({ user_id: DS.uid(), holding_id: h.id, valued_on: t0, value_pence: DEBT.has(kind.value) ? -Math.abs(p) : p }).select().single());
        M.holdings.push(h); M.values.push(v);
      } catch (er) { return; }
      toast(`Added ${n}.`); draw('mn-hname');
    };
    const rows = M.holdings.map(h => {
      const vs = valuesOf(h), cur = vs[vs.length - 1], prev = vs[vs.length - 2];
      const upd = el('input', { class: 'field mn-hupd', inputmode: 'decimal', placeholder: 'New value', 'aria-label': `New value for ${h.name}` });
      const save = async () => {
        const p = C.parseAmount(upd.value); if (p == null) { toast('Enter the value in pounds.'); upd.focus(); return; }
        const vp = DEBT.has(h.kind) ? -Math.abs(p) : p;
        try {
          const v = await q(sb.from('money_values').upsert({ user_id: DS.uid(), holding_id: h.id, valued_on: t0, value_pence: vp }, { onConflict: 'holding_id,valued_on' }).select().single());
          M.values = M.values.filter(x => !(x.holding_id === h.id && x.valued_on === t0)); M.values.push(v); M.values.sort((a, b) => (a.valued_on < b.valued_on ? -1 : a.valued_on > b.valued_on ? 1 : 0));
        } catch (er) { return; }
        toast(`${h.name}: ${gbp(vp)}.`); draw();
      };
      upd.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      const change = cur && prev ? cur.value_pence - prev.value_pence : null;
      return el('div', { class: 'mn-hold' + (DEBT.has(h.kind) ? ' debt' : '') },
        el('div', { class: 'mn-hn' }, el('b', {}, h.name), el('span', { class: 'mn-kind' }, h.kind), h.note ? el('small', {}, h.note) : null),
        el('div', { class: 'mn-hv' }, cur ? amt(cur.value_pence) : el('span', { class: 'mn-empty' }, 'no value yet'),
          el('small', {}, cur ? `updated ${fmt(cur.valued_on, { day: 'numeric', month: 'short', year: cur.valued_on.slice(0, 4) !== t0.slice(0, 4) ? 'numeric' : undefined })}` : '',
            change ? [' · ', amt(change, { plus: true }, change > 0 ? 'in' : 'out')] : null)),
        el('div', { class: 'mn-hu' }, upd, el('button', { type: 'button', class: 'btn', onclick: save }, 'Update')),
        el('div', { class: 'mn-hm' },
          el('button', { type: 'button', class: 'linkish', onclick: () => holdingDialog(h) }, 'Edit'),
          el('button', { type: 'button', class: 'mn-del', title: 'Delete', 'aria-label': `Delete ${h.name}`, onclick: () => removeHolding(h) }, icon('trash', 15))));
    });
    return el('section', { class: 'mn-card mn-holdings', 'data-sum': M.holdings.length ? plural(M.holdings.length, 'account') : '' },
      el('div', { class: 'mn-ch' }, el('h3', {}, 'Investments & accounts')),
      rows.length ? el('div', { class: 'mn-holdlist mn-cap', 'data-cap': 'hold', 'data-items': '.mn-hold' }, rows) : el('p', { class: 'mn-empty' }, 'Add what you own: ISAs, pensions, shares, crypto, savings, property. Add debts too (mortgage, loans, cards) and they count against your net worth.'),
      el('form', { class: 'mn-hadd', onsubmit: add }, name, kind, value, el('button', { type: 'submit', class: 'btn primary' }, icon('plus', 14), ' Add')),
      el('p', { class: 'mn-tip' }, 'Update values whenever you check them (monthly is plenty). Each update is kept, so the chart shows how your net worth grows.'));
  }
  function holdingDialog(h) {
    const name = el('input', { class: 'field', maxlength: '80', value: h.name, 'aria-label': 'Name' });
    const kind = el('select', { class: 'field', 'aria-label': 'Type' }, KINDS.map(k => el('option', { value: k }, k))); kind.value = KINDS.includes(h.kind) ? h.kind : 'Other';
    const note = el('textarea', { class: 'field', rows: '2', maxlength: '500', value: h.note || '', placeholder: 'A note (optional), e.g. provider or account ending', 'aria-label': 'Note' });
    const form = el('form', { class: 'mn-form', onsubmit: async e => {
      e.preventDefault(); if (!name.value.trim()) return;
      const row = { name: name.value.trim(), kind: kind.value, note: note.value.trim() || null };
      try { await q(sb.from('money_holdings').update(row).eq('id', h.id)); } catch (er) { return; }
      // a debt's values are kept negative
      if (DEBT.has(row.kind) !== DEBT.has(h.kind)) {
        const flipIds = valuesOf(h).filter(v => (DEBT.has(row.kind) ? v.value_pence > 0 : v.value_pence < 0));
        for (const v of flipIds) { try { await q(sb.from('money_values').update({ value_pence: -v.value_pence }).eq('id', v.id)); v.value_pence = -v.value_pence; } catch (er) {} }
      }
      Object.assign(h, row); dlg.close(); toast('Saved.'); draw();
    } },
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Name'), name),
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Type'), kind),
      el('label', { class: 'pj-lbl' }, el('span', { class: 'lbl' }, 'Note'), note),
      valuesOf(h).length ? el('details', { class: 'mn-table' }, el('summary', {}, `Value history (${valuesOf(h).length})`),
        el('table', {}, el('tbody', {}, valuesOf(h).slice().reverse().map(v => el('tr', {}, el('td', {}, fmt(v.valued_on, { day: 'numeric', month: 'short', year: 'numeric' })), el('td', {}, amt(v.value_pence))))))) : null,
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'submit' }, 'Save'), el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel')));
    const dlg = dialog('Edit ' + h.name, form);
  }
  async function removeHolding(h) {
    if (!confirm(`Delete “${h.name}” and its value history? It comes off your net worth.`)) return;
    try { await q(sb.from('money_holdings').delete().eq('id', h.id)); } catch (e) { return; }
    M.holdings = M.holdings.filter(x => x !== h); M.values = M.values.filter(v => v.holding_id !== h.id);
    toast('Deleted.'); draw();
  }

  let resizeT = 0, lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    requestAnimationFrame(() => { if (state.view === 'capital' && page && page.isConnected) { layoutCards(); capLists(); } });
    resizeT = setTimeout(() => { if (state.view === 'capital' && page && page.isConnected && Math.abs(window.innerWidth - lastW) > 40 && !document.querySelector('dialog.mn-dlg')) { lastW = window.innerWidth; draw(); } }, 250);
  });

  /* ---------- wiring: the Capital tab in the menu ---------- */
  DS.views.capital = viewMoney;
  DS.views.money = viewMoney;
  DS.money = { core: C, state: M };
  function ensureNav() {
    const nav = document.querySelector('#app nav.nav');
    if (!nav) return;
    let b = nav.querySelector('[data-money]');
    if (!b) {
      b = el('button', { 'data-money': '', onclick: () => DS.go('capital') }, 'Capital');
      const after = nav.querySelector('[data-listen]') || nav.querySelector('[data-create]');
      if (after) after.after(b); else nav.append(b);
    }
    if (state.view === 'capital') b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  let pending = false;
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; ensureNav(); });
  }).observe(app, { childList: true, subtree: true });
  // the tab is called Capital (#capital); old #money links still open it
  if (location.hash.slice(1) === 'capital' || location.hash.slice(1) === 'money') {
    state.view = 'capital';
    try { history.replaceState(null, '', '#capital'); } catch (e) {}
    if (state.user && document.getElementById('main')) DS.go('capital');
  }
})();
