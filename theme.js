// Hamid OS theme: the drifting constellation background, plus the outlined date in headings.
(function () {
  // Background: "Constellation". Loose points drift slowly and join with faint lines when they pass close;
  // the cursor or a finger draws nearby points towards it with lines. Same dot colour as before.
  var canvas = document.createElement('canvas');
  canvas.className = 'signal-bg';
  canvas.setAttribute('aria-hidden', 'true');
  var c = canvas.getContext('2d');
  if (c) {
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var W = 0, H = 0, dpr = 1, px = 0, py = 0, target = 0, near = 0, pts = [], LINK = 120, running = false;
    var seed = function () {
      var n = Math.round(W * H / 11000), i;
      for (i = pts.length; i < n; i++) pts.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .18, vy: (Math.random() - .5) * .18 });
      pts.length = n;
    };
    var resize = function () {
      dpr = Math.min(window.devicePixelRatio || 1, 2); W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      LINK = W < 760 ? 100 : 120;
      seed();
    };
    var draw = function () {
      c.clearRect(0, 0, W, H);
      c.fillStyle = c.strokeStyle = '#a5b4fc'; c.lineWidth = 1;
      var i, j, a, b, d, reach = LINK * 1.6;
      for (i = 0; i < pts.length; i++) {
        a = pts[i];
        for (j = i + 1; j < pts.length; j++) {
          b = pts[j]; d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
          if (d < LINK) { c.globalAlpha = (1 - d / LINK) * .22; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
        }
        if (near > .01) {
          d = Math.sqrt((a.x - px) * (a.x - px) + (a.y - py) * (a.y - py));
          if (d < reach) { c.globalAlpha = (1 - d / reach) * .4 * near; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(px, py); c.stroke(); }
        }
        c.globalAlpha = .5; c.beginPath(); c.arc(a.x, a.y, 1.5, 0, 6.2832); c.fill();
      }
      c.globalAlpha = 1;
    };
    var step = function () {
      near += (target - near) * .18;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i]; p.x += p.vx; p.y += p.vy;
        if (p.x < -10) p.x = W + 10; else if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H + 10; else if (p.y > H + 10) p.y = -10;
      }
    };
    var frame = function () {
      if (document.hidden) { running = false; return; }
      step(); draw(); requestAnimationFrame(frame);
    };
    var start = function () { if (reduced) { draw(); return; } if (!running) { running = true; requestAnimationFrame(frame); } };
    window.addEventListener('resize', function () { resize(); if (reduced) draw(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) start(); });
    var follow = function (e) { px = e.clientX; py = e.clientY; target = 1; if (reduced) { near = 1; draw(); } };
    window.addEventListener('pointermove', follow, { passive: true });
    window.addEventListener('pointerdown', follow, { passive: true });
    window.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') { target = 0; if (reduced) { near = 0; draw(); } } }, { passive: true });
    document.documentElement.addEventListener('pointerleave', function () { target = 0; if (reduced) { near = 0; draw(); } });
    resize();
    document.body.insertBefore(canvas, document.body.firstChild);
    start();
  }

  // Headings: "Friday 2 October" becomes "Friday" + outlined "2 October.", "Week of 28 September" outlines the date.
  var DAY = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) (.+)$/;
  var WEEK = /^(Week of) (.+)$/;
  var styleHeadings = function () {
    var hs = document.querySelectorAll('.head h1');
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (h.querySelector('em') || h.children.length) continue;
      var t = h.textContent, m = t.match(DAY) || t.match(WEEK);
      if (!m) continue;
      var em = document.createElement('em');
      em.textContent = m[2] + '.';
      h.textContent = m[1] + ' ';
      h.appendChild(em);
      h.setAttribute('aria-label', t);
    }
  };
  var app = document.getElementById('app');
  if (app) new MutationObserver(styleHeadings).observe(app, { childList: true, subtree: true });
})();
