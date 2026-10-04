// Put tasks in your own order by dragging (mouse or trackpad):
//   Today: drag a task up or down. Starred tasks stay above the rest, and finished ones below, so a task
//          moves within its own group.
//   Week:  drag a priority card left or right (or between rows); the 01, 02, 03 numbers follow the new order.
// While you drag, the task follows the pointer and the others slide aside to open a gap; on release it glides
// into the gap and the new order is saved (as each task's position). The page is not redrawn, so nothing jumps.
(function () {
  'use strict';
  const DS = window.DS;
  if (!DS) return;
  const { sb, q, toast } = DS;
  const ITEM = '.td-list > .td-row[data-oid], .outcomes > .wk-card[data-oid]';
  const NOT_HANDLE = 'button.ocheck, .hm-star, input, select, textarea, a, .ls-mw';
  const calm = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pad2 = n => String(n).padStart(2, '0');

  // which tasks may swap places with which
  const groupOf = it => {
    if (!it.classList.contains('td-row')) return 'week';
    if (it.classList.contains('s-done') || it.classList.contains('s-dropped')) return 'finished';
    return it.querySelector('.hm-star.on') ? 'starred' : 'open';
  };
  const peers = d => [...d.box.querySelectorAll(':scope > [data-oid]')].filter(x => groupOf(x) === d.group);
  const zoomOf = e => (e.offsetWidth ? e.getBoundingClientRect().width / e.offsetWidth : 1) || 1;

  let drag = null, swallowClick = false;
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.pointerType === 'touch' || !e.target.closest) return;
    const it = e.target.closest(ITEM);
    if (!it || e.target.closest(NOT_HANDLE)) return;
    drag = { it, x0: e.clientX, y0: e.clientY, live: false };
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.live) { if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return; start(e); if (!drag) return; }
    e.preventDefault();
    drag.px = e.clientX; drag.py = e.clientY;
    follow(); reorder();
  });
  document.addEventListener('pointerup', () => { if (drag) (drag.live ? finish(true) : (drag = null)); });
  document.addEventListener('pointercancel', () => { if (drag) (drag.live ? finish(false) : (drag = null)); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && drag && drag.live) finish(false); });
  // a drag shouldn't also count as a click (which would open the task)
  document.addEventListener('click', e => { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } }, true);

  function start(e) {
    const it = drag.it, box = it.parentElement, r = it.getBoundingClientRect();
    Object.assign(drag, { live: true, box, group: groupOf(it), axis: it.classList.contains('td-row') ? 'y' : 'xy',
      dx: e.clientX - r.left, dy: e.clientY - r.top, startNext: it.nextSibling });
    if (peers(drag).length < 2) { drag = null; return; } // nothing to reorder against
    window.getSelection && window.getSelection().removeAllRanges();
    drag.ghost = it.cloneNode(true);
    drag.ghost.classList.add('ro-ghost'); drag.ghost.removeAttribute('data-oid'); drag.ghost.setAttribute('aria-hidden', 'true');
    document.body.append(drag.ghost);
    drag.z = zoomOf(drag.ghost);
    Object.assign(drag.ghost.style, { width: r.width / drag.z + 'px', height: r.height / drag.z + 'px' });
    it.classList.add('ro-hole'); box.classList.add('ro-box'); document.body.classList.add('ro-dragging');
    drag.px = e.clientX; drag.py = e.clientY;
    follow();
    autoScroll();
  }
  function follow() {
    const g = drag.ghost;
    g.style.transform = `translate(${(drag.px - drag.dx) / drag.z}px, ${(drag.py - drag.dy) / drag.z}px) rotate(${drag.axis === 'y' ? 0.6 : 1.2}deg) scale(1.02)`;
  }

  // Where would the dragged task go? Uses layout positions (not the sliding animations), so it never jitters.
  function centres(d) {
    const b = d.box.getBoundingClientRect(), z = zoomOf(d.box);
    return peers(d).map(x => ({ x, cx: b.left + (x.offsetLeft + x.offsetWidth / 2) * z, cy: b.top + (x.offsetTop + x.offsetHeight / 2) * z, h: x.offsetHeight * z }));
  }
  function reorder() {
    const d = drag, list = centres(d), others = list.filter(c => c.x !== d.it);
    let before = null;
    if (d.axis === 'y') before = (others.find(c => d.py < c.cy) || {}).x || null;
    else {
      // cards in a wrapping grid: the nearest card, then before or after it depending on the pointer
      let best = null, bd = Infinity;
      for (const c of others) { const dist = Math.hypot(d.px - c.cx, (d.py - c.cy) * 1.4); if (dist < bd) { bd = dist; best = c; } }
      if (best) {
        const sameRow = Math.abs(d.py - best.cy) < best.h / 2;
        const after = sameRow ? d.px > best.cx : d.py > best.cy;
        before = after ? (others[others.indexOf(best) + 1] || {}).x || null : best.x;
      }
    }
    const curNext = nextPeer(d);
    if (before === curNext) return;
    if (!before && !curNext) return;
    slide(d, () => {
      if (before) d.box.insertBefore(d.it, before);
      else { const last = others[others.length - 1].x; last.after(d.it); }
    });
  }
  const nextPeer = d => { const p = peers(d), i = p.indexOf(d.it); return p[i + 1] || null; };

  // move in the page, and let the others glide from where they were to where they now are
  function slide(d, change) {
    const items = peers(d).filter(x => x !== d.it);
    const was = new Map(items.map(x => [x, x.getBoundingClientRect()]));
    items.forEach(x => x.getAnimations().forEach(a => a.cancel()));
    change();
    if (calm()) return;
    const z = d.z;
    items.forEach(x => {
      const a = was.get(x), now = x.getBoundingClientRect(), dx = (a.left - now.left) / z, dy = (a.top - now.top) / z;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      x.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.7,.2,1)' });
    });
  }

  // keep the page scrolling when you drag near the top or bottom of the window
  function autoScroll() {
    if (!drag || !drag.live) return;
    const edge = 70, h = window.innerHeight;
    const v = drag.py < edge ? -(edge - drag.py) / 4 : drag.py > h - edge ? (drag.py - (h - edge)) / 4 : 0;
    if (v) { window.scrollBy(0, v); reorder(); }
    requestAnimationFrame(autoScroll);
  }

  function finish(keep) {
    const d = drag; drag = null;
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 0);
    if (!keep) slide(d, () => d.box.insertBefore(d.it, d.startNext && d.startNext.parentNode === d.box ? d.startNext : null));
    d.box.classList.remove('ro-box'); document.body.classList.remove('ro-dragging');
    const r = d.it.getBoundingClientRect(), from = d.ghost.style.transform;
    const end = () => { d.ghost.remove(); d.it.classList.remove('ro-hole'); };
    if (calm() || !d.ghost.animate) end();
    else d.ghost.animate([{ transform: from }, { transform: `translate(${r.left / d.z}px, ${r.top / d.z}px)` }],
      { duration: 200, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' }).onfinish = end;
    if (keep) save(d.box);
  }

  // save the order: each task's position becomes its place in the list (only the ones that changed)
  async function save(box) {
    const items = [...box.querySelectorAll(':scope > [data-oid]')];
    items.forEach((x, i) => { const n = x.querySelector('.onum'); if (n && x.classList.contains('wk-card')) n.textContent = pad2(i + 1); });
    const jobs = [];
    items.forEach((x, i) => {
      const pos = i + 1;
      if (Number(x.dataset.pos) === pos) return;
      x.dataset.pos = String(pos);
      jobs.push(q(sb.from('tasks').update({ position: pos }).eq('id', x.dataset.oid)));
    });
    if (!jobs.length) return;
    try { await Promise.all(jobs); } catch (e) { toast('Couldn’t save the new order. Try again.'); }
  }
})();
