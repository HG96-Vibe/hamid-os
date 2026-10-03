// Home tab: the page the sheet opens on.
// A quote hero that changes every hour, today at a glance, top 5, week and month progress,
// things that need attention, close-out streak, last note, wins from a month ago and quick capture.
// Morning (6am-6pm) leads with planning; evening (6pm-6am) leads with closing out the day.
// Also adds: the Home nav button, a star on Today's task rows for the top 5 (starred rows glide to the top), and a Home section in Settings.
(function () {
  'use strict';
  const DS = window.DS;
  const TOP = 5; // how many tasks can be starred as the day's top tasks
  if (!DS) return;
  const { sb, q, el, state, uid, toast, refresh, setTask, fetchTasks, parse, today, addDays,
    weekStart, monthStart, addMonths, fmt, dayName, shortDay, monthName } = DS;

  /* ---------- starter quotes: 50 from Marcus Aurelius and Seneca (also used by "Restore starter quotes") ---------- */
  const STARTER = [
    ["Waste no more time arguing about what a good man should be. Be one.", "Marcus Aurelius", 'any'],
    ["The impediment to action advances action. What stands in the way becomes the way.", "Marcus Aurelius", 'any'],
    ["Very little is needed to make a happy life; it is all within yourself, in your way of thinking.", "Marcus Aurelius", 'any'],
    ["If it is not right, do not do it; if it is not true, do not say it.", "Marcus Aurelius", 'any'],
    ["At dawn, when you have trouble getting out of bed, tell yourself: I have to go to work, as a human being.", "Marcus Aurelius", 'any'],
    ["Confine yourself to the present.", "Marcus Aurelius", 'any'],
    ["Do every act of your life as though it were the very last act of your life.", "Marcus Aurelius", 'any'],
    ["The soul becomes dyed with the colour of its thoughts.", "Marcus Aurelius", 'any'],
    ["The best revenge is not to be like your enemy.", "Marcus Aurelius", 'any'],
    ["How much more harmful are the consequences of anger than the causes of it.", "Marcus Aurelius", 'any'],
    ["Loss is nothing else but change, and change is Nature's delight.", "Marcus Aurelius", 'any'],
    ["Never let the future disturb you. You will meet it, if you have to, with the same weapons of reason which today arm you against the present.", "Marcus Aurelius", 'any'],
    ["Dwell on the beauty of life. Watch the stars, and see yourself running with them.", "Marcus Aurelius", 'any'],
    ["Accept the things to which fate binds you, and love the people with whom fate brings you together, but do so with all your heart.", "Marcus Aurelius", 'any'],
    ["Look within. Within is the fountain of good, and it will ever bubble up, if you will ever dig.", "Marcus Aurelius", 'any'],
    ["Do not act as if you were going to live ten thousand years. While you live, while it is in your power, be good.", "Marcus Aurelius", 'any'],
    ["Reject your sense of injury and the injury itself disappears.", "Marcus Aurelius", 'any'],
    ["The universe is change; our life is what our thoughts make it.", "Marcus Aurelius", 'any'],
    ["Let not your mind run on what you lack as much as on what you have already.", "Marcus Aurelius", 'any'],
    ["Be like the rocky headland on which the waves constantly break. It stands firm, and round it the seething waters are laid to rest.", "Marcus Aurelius", 'any'],
    ["Never esteem anything as of advantage to you that will make you break your word or lose your self-respect.", "Marcus Aurelius", 'any'],
    ["Nowhere can a man find a quieter or more untroubled retreat than in his own soul.", "Marcus Aurelius", 'any'],
    ["The art of living is more like wrestling than dancing.", "Marcus Aurelius", 'any'],
    ["Think of yourself as dead. You have lived your life. Now take what's left and live it properly.", "Marcus Aurelius", 'any'],
    ["Whatever happens at all happens as it should.", "Marcus Aurelius", 'any'],
    ["We suffer more often in imagination than in reality.", "Seneca", 'any'],
    ["It is not that we have a short time to live, but that we waste a lot of it.", "Seneca", 'any'],
    ["Begin at once to live, and count each separate day as a separate life.", "Seneca", 'any'],
    ["While we are postponing, life speeds by.", "Seneca", 'any'],
    ["Hold every hour in your grasp. Lay hold of today's task, and you will not need to depend so much upon tomorrow's.", "Seneca", 'any'],
    ["If a man does not know to which port he is sailing, no wind is favourable.", "Seneca", 'any'],
    ["It is not because things are difficult that we do not dare; it is because we do not dare that they are difficult.", "Seneca", 'any'],
    ["No man was ever wise by chance.", "Seneca", 'any'],
    ["As long as you live, keep learning how to live.", "Seneca", 'any'],
    ["Wherever there is a human being, there is an opportunity for a kindness.", "Seneca", 'any'],
    ["Associate with those who will make a better man of you.", "Seneca", 'any'],
    ["The primary sign of a well-ordered mind is a man's ability to remain in one place and linger in his own company.", "Seneca", 'any'],
    ["Life is long if you know how to use it.", "Seneca", 'any'],
    ["Every day should be regulated as if it closed the series.", "Seneca", 'any'],
    ["He suffers more than is necessary, who suffers before it is necessary.", "Seneca", 'any'],
    ["Whatever can happen at any time can happen today.", "Seneca", 'any'],
    ["No man is more unhappy than he who never faces adversity, for he is not permitted to prove himself.", "Seneca", 'any'],
    ["Fire tests gold, misfortune tests brave men.", "Seneca", 'any'],
    ["The greatest obstacle to living is expectancy, which hangs upon tomorrow and loses today.", "Seneca", 'any'],
    ["Putting things off is the biggest waste of life: it snatches away each day as it comes, and denies us the present by promising the future.", "Seneca", 'any'],
    ["Most powerful is he who has himself in his own power.", "Seneca", 'any'],
    ["It is quality rather than quantity that matters.", "Seneca", 'any'],
    ["Treat your inferiors as you would be treated by your betters.", "Seneca", 'any'],
    ["The mind must be given relaxation. It will rise improved and sharper after a good break.", "Seneca", 'any'],
    ["Until we have begun to go without them, we fail to realise how unnecessary many things are.", "Seneca", 'any']
  ];
  const SLOTS = [['morning', 'Morning'], ['evening', 'Evening'], ['any', 'Either']];

  /* ---------- time helpers ---------- */
  const hour = () => new Date().getHours();
  const modeNow = () => (hour() >= 6 && hour() < 18 ? 'morning' : 'evening');
  // Before 6am you're still finishing yesterday, so Home keeps showing yesterday's sheet.
  const workDay = () => (hour() < 6 ? addDays(today(), -1) : today());
  const dayNum = s => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5);
  const dow = s => parse(s).getDay();
  const isWeekend = s => dow(s) === 0 || dow(s) === 6;
  const mins = m => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const weekday = s => fmt(s, { weekday: 'long' });
  function lastMonthDay(s) {
    const d = parse(s), y = d.getFullYear(), m = d.getMonth() - 1;
    const last = new Date(y, m + 1, 0).getDate();
    const x = new Date(y, m, Math.min(d.getDate(), last));
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }

  const SPEAKER = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  /* ---------- the quote's note: shown only when it fits inside the banner as it is ---------- */
  function fitNote(hero) {
    const note = hero && hero.querySelector('.hm-qnote');
    if (!note || !hero.isConnected) return;
    hero.classList.remove('qn-on');
    const base = hero.offsetHeight;
    hero.classList.add('qn-on');
    if (getComputedStyle(note).display === 'none') return hero.classList.remove('qn-on'); // phone / narrow window
    // start the note just past the widest line of the quote (the banner may be zoomed, so convert to its own units)
    const range = document.createRange(); range.selectNodeContents(hero.querySelector('blockquote'));
    let h = hero.getBoundingClientRect(), q = range.getBoundingClientRect();
    const k = h.width / hero.offsetWidth || 1;
    note.style.left = Math.round(Math.max(hero.offsetWidth * .5, (q.right - h.left) / k + 56)) + 'px';
    h = hero.getBoundingClientRect();
    const n = note.getBoundingClientRect(), pad = 6 * k;
    const fits = hero.offsetHeight <= base + 1 && n.top >= h.top + pad && n.bottom <= h.bottom - pad && q.right <= n.left && n.width >= 260 * k;
    if (!fits) hero.classList.remove('qn-on');
  }
  const fitAll = () => document.querySelectorAll('.hm-hero').forEach(fitNote);
  let fitTimer = 0;
  const fitSoon = () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitAll, 120); };
  window.addEventListener('resize', fitSoon);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSoon);
  new MutationObserver(fitSoon).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }); // Display size changes

  /* ---------- quote rotation: a new quote every hour; every quote shows once before any repeats ---------- */
  const hourNum = () => dayNum(today()) * 24 + hour();
  const nextHour = () => { const h = (hour() + 1) % 24; return h === 0 ? 'midnight' : h === 12 ? 'noon' : (h % 12) + (h < 12 ? 'am' : 'pm'); };
  function rng(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function perm(n, seed) {
    const a = [...Array(n).keys()], r = rng(seed);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function pickQuote(quotes, mode, k) {
    let pool = quotes.filter(x => x.slot === mode || x.slot === 'any');
    if (!pool.length) pool = quotes;
    if (!pool.length) return { body: 'Confine yourself to the present.', author: 'Marcus Aurelius' };
    const n = pool.length, cyc = Math.floor(k / n), salt = 104729;
    const p = perm(n, cyc * 31 + salt);
    if (n > 1 && cyc > 0 && k % n === 0) {
      const prev = perm(n, (cyc - 1) * 31 + salt);
      if (p[0] === prev[n - 1]) [p[0], p[1]] = [p[1], p[0]];
    }
    return pool[p[k % n]];
  }

  let seeding = null;
  async function ensureSeed(settings, quotes) {
    if (!settings || settings.quotes_seeded) return quotes;
    if (!seeding) seeding = (async () => {
      let rows = quotes;
      if (!quotes.length) rows = await q(sb.from('quotes').insert(STARTER.map(([body, author, slot]) => ({ user_id: uid(), body, author, slot }))).select());
      await q(sb.from('settings').update({ quotes_seeded: true }).eq('user_id', uid()));
      settings.quotes_seeded = true;
      if (state.settings) state.settings.quotes_seeded = true;
      return rows;
    })();
    try { return await seeding; } catch (e) { seeding = null; return quotes; }
  }

  /* ---------- navigation helpers ---------- */
  function openCloseout(day) {
    DS.go('today', day);
    let tries = 0;
    const t = setInterval(() => {
      const b = document.querySelector('main .td-close .mr-save');
      if (b && state.view === 'today' && state.cursor === day) { clearInterval(t); b.click(); }
      else if (++tries > 60 || state.view !== 'today') clearInterval(t);
    }, 100);
  }
  function openTask(t) {
    DS.go(t.horizon === 'day' ? 'today' : t.horizon, t.period_start);
    if (DS.openItem && t.horizon === 'day') setTimeout(() => DS.openItem(t.id), 150);
  }

  /* ---------- small builders ---------- */
  const tile = (cls, title, action, ...kids) => el('section', { class: 'td-tile ' + cls },
    el('div', { class: 'td-tile-h' }, el('h2', {}, title), action || null), ...kids);
  const linkBtn = (label, onclick) => el('button', { class: 'td-open', onclick }, label);

  function ring(done, total, label, sub, cls, onclick) {
    const C = 2 * Math.PI * 32, frac = total ? Math.min(1, done / total) : 0;
    const art = el('span', { class: 'hm-ring-art', 'aria-hidden': 'true' });
    art.innerHTML = `<svg viewBox="0 0 80 80"><circle class="bg" cx="40" cy="40" r="32"/>` +
      (frac ? `<circle class="fg" cx="40" cy="40" r="32" stroke-dasharray="${(frac * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)"/>` : '') +
      `</svg><b>${Number(done)}/${Number(total)}</b>`;
    return el('button', { class: 'hm-ring ' + cls, onclick, 'aria-label': `${label}: ${done} of ${total} done. Open.` },
      art, el('span', { class: 'hm-ring-t' }, el('strong', {}, label), el('small', {}, sub)));
  }

  /* ---------- the view ---------- */
  let rendered = null;
  async function viewHome() {
    const mode = modeNow(), d = workDay(), now = today();
    const ws = weekStart(d), ms = monthStart(d), from = addDays(d, -59), lm = lastMonthDay(d);
    const dayStartIso = parse(d).toISOString(), dayEndIso = parse(addDays(d, 1)).toISOString();
    const [tasks, weekT, monthT, rvs, recentT, winsToday, winsLM, stuck, inboxRes, quotesRaw, settingsRows, focusRows, nextWeekRes, nextMonthRes] = await Promise.all([
      fetchTasks('day', d), fetchTasks('week', ws), fetchTasks('month', ms),
      q(sb.from('reviews').select('period_start,closed_at,notes,reflection,energy,focus').eq('horizon', 'day').gte('period_start', from).lte('period_start', d)),
      q(sb.from('tasks').select('period_start,status').eq('horizon', 'day').gte('period_start', from).lte('period_start', d).limit(5000)),
      q(sb.from('wins').select('*').eq('day', d).order('created_at')),
      q(sb.from('wins').select('id,day,body').gte('day', addDays(lm, -3)).lte('day', addDays(lm, 3)).order('day')),
      q(sb.from('tasks').select('id,title,period_start,horizon,carry_count').eq('status', 'open').gte('carry_count', 3).order('carry_count', { ascending: false }).limit(10)),
      sb.from('inbox').select('id', { count: 'exact', head: true }).is('done_at', null),
      q(sb.from('quotes').select('*').order('created_at').order('id')),
      q(sb.from('settings').select('*').limit(1)),
      q(sb.from('focus_sessions').select('minutes').gte('started_at', dayStartIso).lt('started_at', dayEndIso)),
      sb.from('tasks').select('id', { count: 'exact', head: true }).eq('horizon', 'week').eq('period_start', addDays(ws, 7)).neq('status', 'carried'),
      sb.from('tasks').select('id', { count: 'exact', head: true }).eq('horizon', 'month').eq('period_start', addMonths(ms, 1)).neq('status', 'carried')]);
    const settings = settingsRows[0] || null;
    const quotes = await ensureSeed(settings, quotesRaw);
    rendered = { mode, d, h: hourNum() };

    /* numbers */
    const live = tasks.filter(t => t.status !== 'carried');
    const done = live.filter(t => t.status === 'done').length;
    const carriedIn = live.filter(t => t.carried_from).length;
    const focusTotal = focusRows.reduce((a, r) => a + (r.minutes || 0), 0);
    const weekLive = weekT.filter(t => t.status !== 'carried' && t.status !== 'dropped');
    const monthLive = monthT.filter(t => t.status !== 'carried' && t.status !== 'dropped');
    const rv = rvs.find(r => r.period_start === d) || null;
    const closed = new Set(rvs.filter(r => r.closed_at).map(r => r.period_start));
    const worked = new Set(recentT.map(t => t.period_start));
    const inboxCount = inboxRes.count || 0;
    const wdLeft = 7 - (dow(d) + 6) % 7; // days left in the week (Mon–Sun), including today; weekends are working days
    const monthEnd = addDays(addMonths(ms, 1), -1);
    const daysLeft = dayNum(monthEnd) - dayNum(d);
    const monthWord = fmt(d, { month: 'long' });
    const weekSub = wdLeft === 1 ? 'Last day of the week' : `${wdLeft} days left`;
    const monthSub = daysLeft === 0 ? 'Last day of the month' : `${plural(daysLeft, 'day')} left in ${monthWord}`;
    const isSunday = dow(d) === 0, isMonthEnd = daysLeft === 0;
    const reportNote = isSunday
      ? (mode === 'evening' ? 'Your weekly report should be in your email. Use it to plan next week.' : 'Your weekly report goes out at 6pm today.')
      : isMonthEnd ? (mode === 'evening' ? 'Your monthly report should be in your email. Use it to set next month’s outcomes.' : 'Your monthly report goes out at 6pm today.')
      : null;

    /* ---- hero ---- */
    const name = settings?.display_name ? `, ${settings.display_name}` : '';
    const h = hour();
    const hello = h < 6 ? `Working late${name}?` : h < 12 ? `Good morning${name}.` : h < 18 ? `Good afternoon${name}.` : `Good evening${name}.`;
    const pick = pickQuote(quotes, mode, hourNum());
    const qText = pick.body;
    const note = window.DS_QUOTE_NOTES && window.DS_QUOTE_NOTES.get(pick.body);
    // Listen: Ollie (or the device voice) reads the quote, who said it and what it means
    const listenQuote = el('button', { type: 'button', class: 'hm-qlisten', 'aria-label': 'Listen to this quote and what it means', title: 'Listen to this quote and what it means',
      onclick: () => {
        const v = DS.voice; if (!v) return toast('Read-aloud isn’t available in this browser.');
        if (v.unlock) v.unlock();
        v.play([`“${pick.body}”`, [pick.author, note && note[0]].filter(Boolean).join(', ') + '.', note ? note[1] : null].filter(x => x && x !== '.'), 'Quote');
      } }, Object.assign(el('span', { class: 'hm-qli', 'aria-hidden': 'true' }), { innerHTML: SPEAKER }), el('span', {}, 'Listen'));
    const quoteNote = () => note ? el('div', { class: 'hm-qnote' }, el('span', { class: 'hm-qsrc' }, note[0]), el('p', {}, note[1])) : null;
    const hero = el('section', { class: `hm-hero ${mode}`, 'aria-label': 'Quote' },
      el('div', { class: 'hm-hero-top' },
        el('p', { class: 'hm-hello' }, hello),
        el('p', { class: 'hm-next' }, (mode === 'morning' ? 'Plan the day.' : 'Wind down.') + ` Next quote at ${nextHour()}.`)),
      el('figure', { class: 'hm-quote' + (qText.length > 120 ? ' long' : '') },
        el('blockquote', {}, qText),
        el('figcaption', {}, pick.author || null, listenQuote)),
      quoteNote(),
      el('button', { class: 'hm-qedit', onclick: openQuotes }, 'Edit quotes'));

    /* ---- today's shape ---- */
    const shapeLine = (d === now ? '' : 'Still on ') + dayName(d) + '. ' + (live.length
      ? `${plural(live.length, 'task')} on the sheet${carriedIn ? `, ${carriedIn} carried in` : ''}${done ? `, ${done} done` : ''}.`
      : 'Nothing on the sheet yet.');
    const countdown = (wdLeft === 1 ? 'Last day of the week.' : `${wdLeft} days left this week, including today.`) +
      ' ' + (daysLeft === 0 ? `Last day of ${monthWord}.` : `${plural(daysLeft, 'day')} left in ${monthWord}.`);
    const shape = el('div', { class: 'hm-shape' }, el('p', {}, shapeLine), el('p', { class: 'hm-sub' }, countdown, reportNote && mode === 'morning' ? ' ' + reportNote : ''),
      el('button', { class: 'btn primary', onclick: () => DS.go('today', d) }, d === now ? 'Open today’s sheet' : `Open ${weekday(d)}’s sheet`));

    /* ---- top 5 ---- */
    const pinned = live.filter(t => t.pinned).slice(0, TOP);
    const candidates = live.filter(t => !t.pinned && t.status === 'open');
    const pinnedDone = pinned.filter(t => t.status === 'done').length;
    const setPin = async (t, on) => {
      if (on && pinned.length >= TOP) return toast(`Your top ${TOP} is full. Unstar one first.`);
      await setTask(t.id, { pinned: on }); refresh();
    };
    const toggleDone = async t => {
      const on = t.status !== 'done';
      await setTask(t.id, { status: on ? 'done' : 'open', completed_at: on ? new Date().toISOString() : null }); refresh();
    };
    const firstOpen = pinned.find(t => t.status === 'open');
    const topList = pinned.length ? el('ul', { class: 'hm-top3' }, pinned.map(t => el('li', { class: 's-' + t.status },
      el('button', { class: 'ocheck', disabled: t.status === 'dropped', 'aria-label': t.status === 'done' ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`, onclick: () => toggleDone(t) },
        t.status === 'done' ? '✓' : t.status === 'dropped' ? '–' : ''),
      el('button', { class: 'hm-top-t', title: 'Open on Today', onclick: () => openTask(t) }, t.title),
      t.status === 'open' ? el('button', { class: 'hm-ic', title: 'Start a focus block on this', 'aria-label': `Start a focus block on "${t.title}"`, onclick: () => DS.startFocus(t) }, '⏱') : null,
      el('button', { class: 'hm-ic star', title: `Remove from top ${TOP}`, 'aria-label': `Remove "${t.title}" from top ${TOP}`, onclick: () => setPin(t, false) }, '★')))) : null;
    const picker = pinned.length < TOP && candidates.length ? el('div', { class: 'hm-pick' },
      el('p', {}, pinned.length ? `Pick up to ${TOP - pinned.length} more from today’s list:` : `Star the ${TOP} that matter most today:`),
      el('div', { class: 'hm-chips' }, candidates.slice(0, 10).map(t => el('button', { class: 'hm-chip', onclick: () => setPin(t, true), 'aria-label': `Add "${t.title}" to top ${TOP}` },
        '☆ ', t.title, t.carried_from ? el('small', {}, ' carried') : null)))) : null;
    const top3 = tile('hm-top', mode === 'evening' && pinned.length ? `Top ${TOP}: ${pinnedDone} of ${pinned.length} done` : `Top ${TOP} today`, null,
      topList, picker,
      !live.length ? el('p', { class: 'td-none' }, `Nothing on today’s sheet yet. Add a few tasks, then star the ${TOP} that matter most.`) : null,
      live.length && !pinned.length && !candidates.length ? el('p', { class: 'td-none' }, 'Everything on today’s sheet is done.') : null,
      el('div', { class: 'hm-foc' },
        el('button', { class: 'hm-btn main', onclick: () => DS.startFocus(firstOpen || null) },
          firstOpen ? `⏱ Focus on “${firstOpen.title.length > 28 ? firstOpen.title.slice(0, 26) + '…' : firstOpen.title}”` : '⏱ Start a focus block'),
        el('small', {}, focusTotal ? `${mins(focusTotal)} focused today` : 'No focus time yet today')));

    /* ---- progress ---- */
    const wDone = weekLive.filter(t => t.status === 'done').length, mDone = monthLive.filter(t => t.status === 'done').length;
    const progress = tile('hm-prog', 'Week and month', null,
      el('div', { class: 'hm-rings' },
        ring(wDone, weekLive.length, 'This week', weekLive.length ? weekSub : 'No priorities yet', 'wk', () => DS.go('week', d)),
        ring(mDone, monthLive.length, monthWord, monthLive.length ? monthSub : 'No outcomes yet', 'mo', () => DS.go('month', d))));

    /* ---- needs attention (only when something does) ---- */
    const att = [];
    const unclosed = [];
    for (let x = addDays(d, -1), i = 0; i < 7 && unclosed.length < 2; i++, x = addDays(x, -1))
      if (worked.has(x) && !closed.has(x)) unclosed.push(x);
    for (const x of unclosed) att.push([`${dayNum(d) - dayNum(x) < 7 ? weekday(x) : shortDay(x)} wasn’t closed out.`, 'Close it now', () => openCloseout(x)]);
    for (const t of stuck.slice(0, 3)) att.push([`“${t.title}” has been carried ${t.carry_count} times. Schedule it, break it down or drop it.`, 'Open', () => openTask(t)]);
    if (stuck.length > 3) att.push([`${plural(stuck.length - 3, 'more task')} stuck the same way.`, 'See all', () => DS.go('insights')]);
    if (!weekLive.length && weekT.filter(t => t.status !== 'carried').length === 0) att.push(['No priorities set for this week.', 'Plan the week', () => DS.go('week', d)]);
    if (!monthT.filter(t => t.status !== 'carried').length) att.push([`No outcomes set for ${monthWord}.`, 'Set outcomes', () => DS.go('month', d)]);
    const nearWeekEnd = dow(d) === 0 || dow(d) === 6 || (dow(d) === 5 && mode === 'evening');
    if (nearWeekEnd && !nextWeekRes.count) att.push(['Next week has no priorities yet.', 'Plan next week', () => DS.go('week', addDays(ws, 7))]);
    if (daysLeft <= 2 && !nextMonthRes.count) att.push([`${monthName(addMonths(ms, 1))} has no outcomes yet.`, 'Set them', () => DS.go('month', addMonths(ms, 1))]);
    if (inboxCount) att.push([`${plural(inboxCount, 'thought')} waiting in your inbox.`, 'Sort them', () => DS.go('inbox')]);
    const attention = att.length ? tile('hm-alert', 'Needs attention', null,
      el('ul', { class: 'hm-att' }, att.map(([text, label, fn]) => el('li', {}, el('span', {}, text), el('button', { class: 'hm-btn', onclick: fn }, label))))) : null;

    /* ---- close-out streak ---- */
    let streak = 0;
    for (let x = closed.has(d) ? d : addDays(d, -1), i = 0; i < 59; i++, x = addDays(x, -1)) {
      if (closed.has(x)) streak++;
      else if (isWeekend(x) && !worked.has(x)) continue;
      else break;
    }
    const calStart = addDays(weekStart(d), -21);
    let workdays = 0, closedCount = 0;
    const cells = Array.from({ length: 28 }, (_, i) => {
      const x = addDays(calStart, i);
      const future = x > d, isClosed = closed.has(x), hasWork = worked.has(x);
      if (!future && !(x === d && !isClosed) && !(isWeekend(x) && !hasWork && !isClosed)) { workdays++; if (isClosed) closedCount++; }
      const st = future ? 'future' : isClosed ? 'closed' : hasWork ? (x === d ? 'pending' : 'open') : 'empty';
      const label = { future: 'still to come', closed: 'closed out', pending: 'not closed yet', open: 'not closed out', empty: 'nothing written' }[st];
      return el('button', { class: `hm-cell c-${st}${x === d ? ' c-today' : ''}`, disabled: future, title: `${shortDay(x)}: ${label}`, 'aria-label': `${shortDay(x)}: ${label}`, onclick: () => DS.go('today', x) });
    });
    const consistency = tile('hm-cons', 'Close-outs', null,
      el('p', { class: 'hm-streak' }, el('b', {}, streak ? `${streak}-day streak` : 'No streak yet'),
        el('small', {}, workdays ? `Closed ${closedCount} of your last ${plural(workdays, 'working day')}.` : 'Close out each day to start a streak.')),
      el('div', { class: 'hm-cal' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => el('span', { class: 'hm-dow', 'aria-hidden': 'true' }, x)), cells),
      el('p', { class: 'hm-legend' }, el('i', { class: 'c-closed' }), 'closed ', el('i', { class: 'c-open' }), 'not closed ', el('i', { class: 'c-empty' }), 'nothing written'));

    /* ---- last note ---- */
    const prevNote = rvs.filter(r => r.period_start < d && (r.notes || r.reflection)).sort((a, b) => (a.period_start < b.period_start ? 1 : -1))[0];
    const noteCard = prevNote ? tile('hm-note', `${dayNum(d) - dayNum(prevNote.period_start) < 7 ? weekday(prevNote.period_start) : shortDay(prevNote.period_start)}’s note`,
      linkBtn('Open that day', () => DS.go('today', prevNote.period_start)),
      prevNote.notes ? el('p', { class: 'hm-notetext' }, prevNote.notes) : null,
      prevNote.reflection ? el('p', { class: 'hm-refl' }, el('b', {}, 'Reflection: '), prevNote.reflection) : null) : null;

    /* ---- a month ago ---- */
    const exact = winsLM.filter(w => w.day === lm);
    const lmWins = (exact.length ? exact : winsLM).slice(0, 5);
    const monthAgo = lmWins.length ? tile('hm-ago', 'A month ago', linkBtn('All wins', () => DS.go('wins')),
      el('ul', { class: 'td-wins' }, lmWins.map(w => el('li', {}, el('span', {}, w.body, w.day !== lm ? el('small', { class: 'hm-day' }, ` ${shortDay(w.day)}`) : null))))) : null;

    /* ---- quick capture ---- */
    const capIn = el('input', { class: 'td-field', maxlength: '500', 'data-add': 'home', placeholder: 'A task for today, or a thought to park', 'aria-label': 'Quick capture' });
    const addTask = async () => {
      const v = capIn.value.trim(); if (!v) return capIn.focus();
      capIn.value = '';
      await q(sb.from('tasks').insert({ user_id: uid(), horizon: 'day', period_start: today(), title: v, position: Date.now() / 1000 }));
      toast('Added to today.'); state.focusAdd = 'home'; refresh();
    };
    const addThought = async () => {
      const v = capIn.value.trim(); if (!v) return capIn.focus();
      capIn.value = '';
      await q(sb.from('inbox').insert({ user_id: uid(), body: v }));
      const c = document.getElementById('inbox-count'); if (c) c.textContent = String((+c.textContent || 0) + 1);
      toast('Saved to inbox.'); state.focusAdd = 'home'; refresh();
    };
    capIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } });
    const capture = tile('hm-cap', 'Quick capture', null, capIn,
      el('div', { class: 'hm-capbtns' },
        el('button', { class: 'hm-btn main', onclick: addTask }, 'Add to today'),
        el('button', { class: 'hm-btn', onclick: addThought }, 'Send to inbox'),
        el('small', {}, 'Enter adds to today')));

    /* ---- wins today (+ close-out in the evening) ---- */
    const winIn = el('input', { maxlength: '1000', placeholder: 'Log a win and press Enter', 'aria-label': 'Log a win',
      onkeydown: async e => {
        if (e.key !== 'Enter' || !winIn.value.trim()) return;
        e.preventDefault();
        await q(sb.from('wins').insert({ user_id: uid(), day: d, body: winIn.value.trim() }));
        refresh();
      } });
    const winItems = winsToday.length ? el('ul', { class: mode === 'evening' ? 'winlist' : 'td-wins' }, winsToday.map(w => el('li', {}, el('span', {}, w.body)))) : null;
    let winsCard = null, closeCard = null;
    if (mode === 'morning') {
      winIn.className = 'td-field';
      winsCard = tile('hm-wins', d === now ? 'Wins today' : 'Wins', linkBtn('All wins', () => DS.go('wins')), winItems, winIn);
    } else {
      winIn.className = 'field';
      const stat = (v, l) => el('div', { class: 'hm-stat' }, el('b', {}, v), el('span', {}, l));
      const openLeft = live.filter(t => t.status === 'open').length;
      closeCard = el('section', { class: 'mr-box hm-close', 'aria-labelledby': 'hm-close-h' },
        el('div', { class: 'mr-head' }, el('h2', { id: 'hm-close-h' }, rv?.closed_at ? 'Day closed' : `Close out ${weekday(d)}`), el('small', {}, shortDay(d))),
        el('div', { class: 'hm-stats' },
          stat(live.length ? `${done}/${live.length}` : '0', 'tasks done'),
          stat(focusTotal ? mins(focusTotal) : '0m', 'focus'),
          stat(String(winsToday.length), winsToday.length === 1 ? 'win' : 'wins')),
        el('div', { class: 'hm-closewins' }, el('span', { class: 'lbl' }, 'Wins today'), winItems, winIn),
        reportNote ? el('p', { class: 'hm-report' }, reportNote) : null,
        el('div', { class: 'td-close-row' },
          rv?.closed_at
            ? el('p', { class: 'td-close-note' }, `Energy ${rv.energy ?? '–'}, focus ${rv.focus ?? '–'}. Nicely done.`)
            : el('p', { class: 'td-close-note' }, openLeft ? `${plural(openLeft, 'task')} still open. Decide what carries over, log wins and rate the day.` : 'Everything’s ticked off. Log your wins and rate the day.'),
          el('button', { class: 'mr-save', onclick: () => openCloseout(d) }, rv?.closed_at ? 'Edit day review' : 'Close out the day')));
    }

    const main = mode === 'morning' ? [attention, top3, capture, winsCard] : [closeCard, top3, attention];
    const side = mode === 'morning' ? [progress, consistency, noteCard, monthAgo] : [progress, consistency, capture, monthAgo, noteCard];
    requestAnimationFrame(() => requestAnimationFrame(() => fitNote(hero)));
    return el('div', { class: `hm hm-${mode}` }, hero, shape,
      el('div', { class: 'hm-cols' }, el('div', { class: 'hm-col' }, main), el('aside', { class: 'hm-col' }, side)));
  }

  /* ---------- quotes editor ---------- */
  async function openQuotes() {
    if (document.querySelector('dialog.hm-qdlg')) return;
    const dlg = el('dialog', { class: 'hm-qdlg', 'aria-labelledby': 'hm-q-h' });
    const listEl = el('ul', { class: 'hm-qlist' }, el('li', { class: 'meta' }, 'Loading…'));
    const countEl = el('p', { class: 'meta', style: 'margin:0' });
    const slotSelect = (val, onchange) => el('select', { class: 'field hm-slot', 'aria-label': 'When to show it', onchange },
      SLOTS.map(([v, l]) => { const o = el('option', { value: v }, l); if (v === val) o.selected = true; return o; }));
    let rows = [];
    const load = async () => {
      rows = await q(sb.from('quotes').select('*').order('created_at').order('id'));
      const m = rows.filter(r => r.slot !== 'evening').length, e = rows.filter(r => r.slot !== 'morning').length;
      countEl.textContent = rows.length ? `${plural(rows.length, 'quote')}: ${m} can show in the morning, ${e} in the evening. Each one shows before any repeats.` : 'No quotes yet. Add one below.';
      listEl.replaceChildren(...rows.map(r => el('li', {},
        el('div', { class: 'hm-qtext' }, el('p', {}, r.body), r.author ? el('small', {}, r.author) : null),
        slotSelect(r.slot, async ev => { await q(sb.from('quotes').update({ slot: ev.target.value }).eq('id', r.id)); toast('Saved.'); load(); }),
        el('button', { class: 'x', 'aria-label': 'Delete quote', title: 'Delete', onclick: async () => { await q(sb.from('quotes').delete().eq('id', r.id)); load(); } }, '×'))));
    };
    const body = el('textarea', { class: 'field', rows: '2', maxlength: '600', placeholder: 'A line that gets you moving' });
    const author = el('input', { class: 'field', maxlength: '120', placeholder: 'Who said it (optional)' });
    const newSlot = slotSelect('any');
    const form = el('form', { class: 'dlg', onsubmit: async e => {
      e.preventDefault();
      if (!body.value.trim()) return body.focus();
      await q(sb.from('quotes').insert({ user_id: uid(), body: body.value.trim(), author: author.value.trim() || null, slot: newSlot.value }));
      body.value = ''; author.value = ''; toast('Quote added.'); load(); body.focus();
    } },
      el('h2', { id: 'hm-q-h' }, 'Your quotes'),
      countEl, listEl,
      el('div', { class: 'hm-qadd' }, el('span', { class: 'lbl' }, 'Add a quote'), body,
        el('div', { class: 'hm-qrow' }, author, newSlot)),
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', type: 'submit' }, 'Add quote'),
        el('button', { class: 'btn', type: 'button', onclick: async () => {
          const have = new Set(rows.map(r => r.body.trim().toLowerCase()));
          const missing = STARTER.filter(([b]) => !have.has(b.toLowerCase()));
          if (!missing.length) return toast('All the starter quotes are already in your list.');
          await q(sb.from('quotes').insert(missing.map(([b, a, s]) => ({ user_id: uid(), body: b, author: a, slot: s }))));
          toast(`${plural(missing.length, 'starter quote')} added back.`); load();
        } }, 'Restore starter quotes'),
        el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Done')));
    dlg.append(form);
    dlg.addEventListener('close', () => { dlg.remove(); if (state.view === 'home') refresh(); });
    document.body.append(dlg);
    dlg.showModal();
    load().catch(() => listEl.replaceChildren(el('li', { class: 'meta' }, 'Couldn’t load your quotes. Close and try again.')));
  }

  /* ---------- extras on other pages ---------- */
  function ensureNav() {
    const nav = document.querySelector('#app nav.nav');
    if (!nav) return;
    let b = nav.querySelector('[data-home]');
    if (!b) { b = el('button', { 'data-home': '', onclick: () => DS.go('home') }, 'Home'); nav.prepend(b); }
    if (state.view === 'home') b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }

  // Re-sort Today's rows in place (starred first, then the usual order) and let each row glide to its new spot.
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function glide(moved) {
    const list = moved.parentNode; if (!list) return;
    const rows = [...list.querySelectorAll(':scope > .td-row')];
    const before = new Map(rows.map(r => [r, r.getBoundingClientRect().top]));
    const starred = r => (r.querySelector('.hm-star.on') ? 1 : 0), pos = r => parseFloat(r.dataset.pos) || 0;
    const sorted = rows.slice().sort((a, b) => starred(b) - starred(a) || pos(a) - pos(b) || rows.indexOf(a) - rows.indexOf(b));
    const after = rows[rows.length - 1].nextSibling;
    sorted.forEach(r => list.insertBefore(r, after));
    if (calm || !moved.animate) return;
    // screen distances include the page zoom; transforms are in unzoomed pixels
    const z = moved.offsetHeight ? moved.getBoundingClientRect().height / moved.offsetHeight : 1;
    sorted.forEach(r => {
      const dy = (before.get(r) - r.getBoundingClientRect().top) / (z || 1);
      if (Math.abs(dy) < 1) return;
      const self = r === moved;
      r.animate([{ transform: `translateY(${dy}px)${self ? ' scale(1.02)' : ''}` }, { transform: self ? 'scale(1.02)' : 'none', offset: self ? .85 : 1 }, { transform: 'none' }],
        { duration: self ? 700 : 480, easing: 'cubic-bezier(.2,.7,.2,1)' });
    });
    moved.classList.add('td-lift'); setTimeout(() => moved.classList.remove('td-lift'), 900);
  }

  let starSeq = 0;
  async function injectStars(main) {
    const rows = [...main.querySelectorAll('.td-row[data-oid]:not([data-star])')];
    if (!rows.length) return;
    rows.forEach(r => r.setAttribute('data-star', ''));
    const seq = ++starSeq, day = state.cursor;
    let data;
    try { data = await q(sb.from('tasks').select('id,pinned,status').eq('horizon', 'day').eq('period_start', day)); } catch (e) { return; }
    if (seq !== starSeq && !rows[0].isConnected) return;
    const byId = Object.fromEntries(data.map(t => [t.id, t]));
    for (const r of rows) {
      const t = byId[r.dataset.oid];
      if (!t || t.status === 'carried' || !r.isConnected) continue;
      const b = el('button', { class: 'hm-star' + (t.pinned ? ' on' : ''), 'aria-pressed': String(!!t.pinned),
        'aria-label': `Top ${TOP}`, title: t.pinned ? `In your top ${TOP}. Click to remove.` : `Add to your top ${TOP}`,
        onclick: async e => {
          e.stopPropagation();
          const on = !t.pinned;
          if (on && data.filter(x => x.pinned && x.status !== 'carried').length >= TOP) return toast(`Your top ${TOP} is full. Unstar one first.`);
          t.pinned = on; // update at once so the row can glide straight away; undo if saving fails
          b.classList.toggle('on', on); b.textContent = on ? '★' : '☆'; b.setAttribute('aria-pressed', String(on));
          b.title = on ? `In your top ${TOP}. Click to remove.` : `Add to your top ${TOP}`;
          glide(r);
          try { await setTask(t.id, { pinned: on }); toast(on ? `Added to your top ${TOP}.` : `Removed from your top ${TOP}.`); }
          catch (err) { t.pinned = !on; b.classList.toggle('on', !on); b.textContent = !on ? '★' : '☆'; b.setAttribute('aria-pressed', String(!on)); glide(r); }
        } }, t.pinned ? '★' : '☆');
      r.append(b);
    }
  }

  function injectSettings(main) {
    const wrap = main.firstElementChild;
    if (!wrap || wrap.querySelector('#hm-settings') || wrap.querySelector('h1')?.textContent !== 'Settings') return;
    const nameIn = el('input', { class: 'field', maxlength: '60', value: state.settings?.display_name || '', placeholder: 'Your first name', style: 'max-width:240px', 'aria-label': 'Greet me as' });
    const sec = el('section', { class: 'section', id: 'hm-settings' }, el('h2', {}, 'Home page'),
      el('form', { class: 'settingsform', onsubmit: async e => {
        e.preventDefault();
        const v = nameIn.value.trim() || null;
        await q(sb.from('settings').update({ display_name: v }).eq('user_id', uid()));
        if (state.settings) state.settings.display_name = v;
        toast('Name saved.');
      } },
        el('div', { class: 'line' }, el('span', {}, 'Greet me as'), nameIn, el('button', { class: 'btn', type: 'submit' }, 'Save name'))),
      el('p', { class: 'meta', style: 'margin:14px 0 10px' }, 'The quote at the top of Home changes every hour. Every quote shows once before any repeat.'),
      el('button', { class: 'btn', onclick: openQuotes }, 'Edit quotes'));
    const secs = wrap.querySelectorAll(':scope > section');
    if (secs.length >= 2) secs[1].after(sec); else wrap.append(sec);
  }

  function tick() {
    ensureNav();
    const main = document.getElementById('main');
    if (!main || !main.firstElementChild) return;
    if (state.view === 'today') injectStars(main);
    else if (state.view === 'settings') injectSettings(main);
  }
  let pending = false;
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; tick(); });
  }).observe(app, { childList: true, subtree: true });

  // Switch between morning and evening (and roll the day over) without a reload.
  const stale = () => state.user && state.view === 'home' && rendered && (rendered.mode !== modeNow() || rendered.d !== workDay() || rendered.h !== hourNum()) && !document.querySelector('dialog[open]');
  setInterval(() => { if (stale()) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && stale()) refresh(); });

  /* ---------- register and make Home the landing page ---------- */
  DS.views.home = viewHome;
  DS.home = { pickQuote, modeNow, workDay, STARTER, fitNote }; // exposed for testing
  const h = location.hash.slice(1);
  if (!h || h === 'home') {
    state.view = 'home';
    if (state.user && document.getElementById('main')) DS.go('home');
  }
  tick();
})();
