/* Idle screen: after a few minutes without a key press or mouse move, a slow slideshow of titles
   worth watching takes over the screen (what you were watching, My List, and Top Picks), each with
   its background art, year, rating and plot. OK opens the title on screen; any other key, a click
   or moving the mouse returns to where you were. Settings → Idle screen changes the wait or turns
   it off.
   It never starts over the sign-in screen, live TV or a playing video. A movie or episode left
   paused gets it after ten minutes; there, every key just returns to the paused picture. */

Nova.idle = (function () {
  var SLIDE_MS = 12000, CHECK_MS = 5000, MAX_SLIDES = 30, PAUSED_MS = 10 * 60000;
  var el = null, bd = null, slides = [], at = 0, cur = null;
  var lastAct = Date.now(), shownAt = 0, slideTimer = null, token = 0;

  // Minutes of no input before it starts; 0 is off.
  function wait() { return Nova.prefs.get('idleMin', 3) * 60000; }

  // The player says when it is sitting on a paused movie or episode.
  function overPlayer() { var top = Nova.router.top(); return !!top && top.name === 'player'; }

  function blocked() {
    var top = Nova.router.top(), a = document.activeElement;
    return !top || (top.name === 'player' && !(top.idleOk && top.idleOk())) || top.name === 'login' || !Nova.api.lib || document.hidden ||
      !!document.querySelector('.splash') || (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'));
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // What to show: a few titles in progress and from My List among the suggestions, in random order.
  function build() {
    var out = [], seen = {};
    function add(it, kicker) {
      var k = it && it.type + ':' + it.id;
      if (!it || seen[k] || (!it.img && !it.backdrop)) return;
      seen[k] = 1;
      out.push({ item: it, kicker: kicker });
    }
    Nova.progress.continueList().slice(0, 5).forEach(function (p) { add(Nova.api.get(p.type, p.id), 'Continue watching'); });
    shuffle(Nova.favs.list().filter(function (f) { return f.type !== 'live'; })).slice(0, 5)
      .forEach(function (f) { add(Nova.api.get(f.type, f.id), 'From My List'); });
    Nova.recommend.picks().forEach(function (it) { add(it, 'Top pick for you'); });
    return shuffle(out).slice(0, MAX_SLIDES);
  }

  function create() {
    el = Nova.el('div', 'idle',
      '<div class="idle-bg"></div><div class="idle-shade"></div>' +
      '<div class="idle-logo login-logo"><b>N</b>NOVA</div><div class="idle-clock"></div>' +
      '<div class="idle-info"><div class="bb-kicker"></div><h1 class="bb-title"></h1><div class="bb-meta"></div><p class="bb-plot"></p></div>' +
      '<div class="hints idle-hints">' + (overPlayer() ? '<span>Press any key to go back to what you were watching</span>'
        : '<span><b>OK</b> Open this title</span><span>Any other key to go back</span>') + '</div>');
    bd = new Nova.Backdrop(el.querySelector('.idle-bg'));
    el.addEventListener('click', function () { hide(); });
  }

  // The title's details (plot, backdrop) need a request; the slide changes once they are in.
  function next() {
    clearTimeout(slideTimer);
    if (!el || !slides.length) return;
    var s = slides[at++ % slides.length], tk = ++token;
    var go = function (info) {
      if (tk !== token || !el) return;
      draw(s, info);
      // A single slide has nothing to move on to.
      if (slides.length > 1) slideTimer = setTimeout(next, SLIDE_MS);
    };
    Nova.api.info(s.item).then(go, function () { go({}); });
  }

  function draw(s, info) {
    var it = s.item, box = el.querySelector('.idle-info');
    cur = it;
    el.querySelector('.idle-clock').textContent = Nova.fmtClock();
    // The text fades out, changes, and fades back in with the new picture.
    box.classList.remove('on');
    setTimeout(function () {
      if (cur !== it || !el) return;
      box.querySelector('.bb-kicker').textContent = s.kicker;
      box.querySelector('.bb-title').textContent = it.name;
      box.querySelector('.bb-title').classList.toggle('long', it.name.length > 28);
      box.querySelector('.bb-meta').innerHTML = Nova.Billboard.meta(it, info);
      box.querySelector('.bb-plot').textContent = info.plot || it.plot || '';
      box.classList.add('on');
    }, 450);
    Nova.Billboard.art(bd, it, info);
  }

  // The TV's own screensaver would otherwise cover the slideshow after a while.
  function tvSaver(on) {
    try { webapis.appcommon.setScreenSaver(webapis.appcommon.AppCommonScreenSaverState[on ? 'SCREEN_SAVER_ON' : 'SCREEN_SAVER_OFF']); } catch (e) {}
  }

  function show() {
    if (el || blocked()) return false;
    slides = build();
    if (!slides.length) return false;
    at = 0;
    create();
    document.getElementById('overlay').appendChild(el);
    shownAt = Date.now();
    setTimeout(function () { if (el) el.classList.add('on'); }, 20);
    tvSaver(false);
    next();
    return true;
  }

  function hide() {
    if (!el) return;
    var old = el;
    el = bd = cur = null;
    token++;
    clearTimeout(slideTimer);
    lastAct = Date.now();
    tvSaver(true);
    old.classList.remove('on');
    setTimeout(function () { old.parentNode && old.parentNode.removeChild(old); }, 400);
  }

  function open() {
    var it = cur;
    hide();
    // Behind a dialog the title would open underneath it, and a paused video stays where it is.
    if (!it || Nova.ui.modals.length || overPlayer()) return;
    if (Nova.menu.focused) Nova.menu.blur();
    Nova.router.push('details', { item: it });
  }

  function init() {
    // Capture phase: while the slideshow is up, the key that ends it must not reach the screen below.
    document.addEventListener('keydown', function (e) {
      lastAct = Date.now();
      if (!el) return;
      e.stopPropagation();
      e.preventDefault();
      if (e.keyCode === 13 || e.keyCode === 65376) open(); else hide();
    }, true);
    ['mousemove', 'mousedown', 'wheel'].forEach(function (ev) {
      document.addEventListener(ev, function () {
        lastAct = Date.now();
        // The slideshow appearing under a resting mouse can fire a stray move; ignore the first moment.
        if (el && ev === 'mousemove' && Date.now() - shownAt > 800) hide();
      }, true);
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden) hide(); else lastAct = Date.now(); });
    setInterval(function () {
      // Time spent watching doesn't count as idling: the wait starts when the video is paused or closed.
      if (blocked()) { lastAct = Date.now(); return; }
      var w = wait();
      if (w && overPlayer()) w = PAUSED_MS;
      if (!el && w && Date.now() - lastAct >= w) show();
    }, CHECK_MS);
  }

  return { init: init, show: show, hide: hide, active: function () { return !!el; } };
})();
