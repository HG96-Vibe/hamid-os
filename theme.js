// Daily Sheet theme: the calm dot grid from the AI Engineer site, plus the outlined date in headings.
(function () {
  // Background: a grid of dots that swells around the cursor or a finger. Nothing moves on its own.
  var canvas = document.createElement('canvas');
  canvas.className = 'signal-bg';
  canvas.setAttribute('aria-hidden', 'true');
  var c = canvas.getContext('2d');
  if (c) {
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var W = 0, H = 0, dpr = 1, gap = 24, px = 0, py = 0, target = 0, swell = 0, queued = false;
    var resize = function () {
      dpr = Math.min(window.devicePixelRatio || 1, 2); W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      gap = W < 760 ? 22 : Math.max(24, W / 60);
    };
    var draw = function () {
      c.clearRect(0, 0, W, H);
      var oy = -(window.scrollY * 0.15) % gap, reach = gap * gap * 16;
      c.fillStyle = '#a5b4fc';
      for (var y = gap / 2 + oy; y < H + gap; y += gap) {
        for (var x = gap / 2; x < W; x += gap) {
          var dx = x - px, dy = y - py, lift = swell * Math.exp(-(dx * dx + dy * dy) / reach);
          c.globalAlpha = .16 + lift * .6;
          c.beginPath(); c.arc(x, y, 1.1 + lift * 2.6, 0, 6.2832); c.fill();
        }
      }
      c.globalAlpha = 1;
    };
    var request = function () { if (!queued) { queued = true; requestAnimationFrame(frame); } };
    var frame = function () {
      queued = false;
      swell += (target - swell) * 0.18;
      if (Math.abs(target - swell) < 0.01) swell = target;
      draw();
      if (swell !== target) request();
    };
    window.addEventListener('resize', function () { resize(); request(); });
    window.addEventListener('scroll', request, { passive: true });
    if (!reduced) {
      window.addEventListener('pointermove', function (e) { px = e.clientX; py = e.clientY; target = 1; request(); }, { passive: true });
      window.addEventListener('pointerdown', function (e) { px = e.clientX; py = e.clientY; target = 1; request(); }, { passive: true });
      window.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') { target = 0; request(); } }, { passive: true });
      document.documentElement.addEventListener('pointerleave', function () { target = 0; request(); });
    }
    resize();
    document.body.insertBefore(canvas, document.body.firstChild);
    request();
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
