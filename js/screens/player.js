/* The player.
   Movies/episodes: accelerating scrub with preview, ±10 s skips, resume, audio/subtitle/quality/speed/aspect menus,
   next-episode countdown and auto-play, remembered audio and subtitle languages, "ends at" time, stream stats.
   Live: instant zapping (up/down, CH+/-), number entry, previous channel, channel list overlay, now/next EPG banner,
   favourites. Both: automatic reconnect on stream errors. */

Nova.applySubSize = function () {
  document.body.setAttribute('data-sub', Nova.prefs.get('subSize', 'm'));
};

Nova.router.register('player', function (params) {
  var engine = Nova.engine();
  var live = params.item.type === 'live';
  var item = params.item, ep = params.ep || null;
  var episodes = params.episodes || [];
  var list = params.list || [item];
  var chIndex = Math.max(0, list.indexOf(item));
  var prevChannel = null;

  var el = Nova.el('div', 'screen player' + (live ? ' is-live' : ''));
  el.innerHTML =
    '<div class="p-subs"><span></span></div>' +
    '<div class="p-center"><div class="spinner big"></div><div class="p-flash"></div><div class="p-msg"></div></div>' +
    '<div class="p-top"><div class="p-back">' + Nova.icon('arrowLeft') + '</div><div class="p-titles"><div class="p-kicker"></div><h2 class="p-title"></h2><div class="p-sub"></div></div><div class="p-clock"></div></div>' +
    '<div class="p-bottom">' +
      (live ? '<div class="p-banner"></div>' :
        '<div class="p-bar"><i class="p-buf"></i><i class="p-fill"></i><i class="p-thumb"><span class="p-tip"></span></i></div>' +
        '<div class="p-times"><span class="p-elapsed"></span><span class="p-ends"></span><span class="p-remaining"></span></div>') +
      '<div class="p-btns"></div>' +
    '</div>' +
    '<div class="p-chlist"><h3></h3><div class="p-chlist-body"></div></div>' +
    '<div class="p-num"></div>' +
    '<div class="p-next"></div>' +
    '<div class="p-stats"></div>';
  var $ = function (s) { return el.querySelector(s); };

  var state = 'buffering', controls = false, zone = 'bar', btnIdx = 0, buttons = [];
  var hideTimer = null, msgTimer = null, subTimer = null, statsTimer = null, zapTimer = null, numTimer = null, retryTimer = null;
  var scrub = null, scrubTimer = null, scrubCount = 0, scrubLast = 0;
  var retries = 0, lastSave = 0, rate = 1, numBuf = '';
  var nextDismissed = false, nextShown = false, chList = null, chOpen = false, exiting = false;
  var aspect = Nova.prefs.get('aspect', 'fit');

  /* ---------- opening streams ---------- */

  function open(startAt) {
    var url = Nova.api.streamUrl(item, ep);
    nextDismissed = false;
    nextShown = false;
    $('.p-next').classList.remove('show');
    setSub('');
    setState('buffering');
    engine.setAspect(aspect);
    engine.open(url, { live: live, startAt: startAt || 0 });
    if (rate !== 1) engine.setRate(rate);
    renderTitles();
  }

  function renderTitles() {
    if (live) {
      $('.p-kicker').textContent = 'Live · Channel ' + item.num;
      $('.p-title').textContent = item.name;
      $('.p-sub').textContent = '';
      renderBanner();
    } else if (ep) {
      $('.p-kicker').textContent = item.name;
      $('.p-title').textContent = 'S' + ep.season + ':E' + ep.num + '  ' + Nova.epTitle(item, ep);
      $('.p-sub').textContent = '';
    } else {
      $('.p-kicker').textContent = 'Movie';
      $('.p-title').textContent = item.name;
      $('.p-sub').textContent = item.year || '';
    }
  }

  /* ---------- engine events ---------- */

  engine.on('state', function (s) {
    setState(s);
    if (s === 'playing') retries = 0;
  });
  engine.on('time', function (t) {
    if (!live) {
      if (!scrub) renderProgress();
      if (Date.now() - lastSave > 10000) saveProgress();
      checkNext(t);
    }
  });
  engine.on('ended', function () {
    if (live) return onError('The stream ended');
    saveProgress(true);
    var next = nextEpisode();
    if (next && !nextDismissed && Nova.prefs.get('autoNext', true)) playEpisode(next);
    else exit();
  });
  engine.on('error', onError);
  engine.on('subtitle', function (text, dur) { setSub(text, dur); });
  engine.on('tracks', function () { applyTrackPrefs(); buildButtons(); });

  function onError(msg) {
    if (exiting) return;
    if (retries < 3) {
      retries++;
      showMsg('Reconnecting… (' + retries + '/3)');
      var pos = live ? 0 : engine.time();
      clearTimeout(retryTimer);
      retryTimer = setTimeout(function () { if (!exiting) open(pos); }, 1200 * retries);
      return;
    }
    setState('error');
    Nova.ui.dialog({
      title: live ? 'This channel isn’t playing' : 'This title couldn’t be played',
      text: (msg || 'Unknown error') + '. The stream may be offline, or your provider may be limiting connections.',
      buttons: [
        { label: 'Try again', fn: function () { retries = 0; open(live ? 0 : engine.time()); } },
        live && list.length > 1 ? { label: 'Next channel', fn: function () { retries = 0; zap(1); } } : null,
        { label: 'Go back', fn: exit }
      ].filter(Boolean),
      onCancel: exit
    });
  }

  function setState(s) {
    state = s;
    el.classList.toggle('buffering', s === 'buffering');
    el.classList.toggle('paused', s === 'paused');
    if (s === 'paused') showControls(true);
    else if (s === 'playing') { clearMsg(); scheduleHide(); }
    buildButtonsSoon();
  }

  // Re-pick the audio and subtitle languages the viewer chose last time.
  function applyTrackPrefs() {
    var t = engine.tracks(), want;
    want = Nova.prefs.get('audioLang', '');
    if (want && t.audio.length > 1) t.audio.forEach(function (a) { if (a.label === want && a.id !== t.cur.audio) engine.setAudio(a.id); });
    want = Nova.prefs.get('subLang', '');
    if (want && t.text.length && t.cur.text < 0) t.text.forEach(function (s) { if (s.label === want) engine.setText(s.id); });
  }

  /* ---------- subtitles, messages ---------- */

  function setSub(text, durMs) {
    var span = $('.p-subs span');
    // AVPlay sends HTML-ish markup and \n; keep line breaks, drop tags.
    span.innerHTML = Nova.esc(String(text || '').replace(/<[^>]+>/g, '')).replace(/\n/g, '<br>');
    span.style.display = text ? '' : 'none';
    clearTimeout(subTimer);
    if (text && durMs) subTimer = setTimeout(function () { setSub(''); }, durMs);
  }

  function showMsg(text) {
    clearTimeout(msgTimer);
    $('.p-msg').textContent = text;
    $('.p-msg').classList.add('show');
  }
  function clearMsg() { $('.p-msg').classList.remove('show'); }

  function flash(icon) {
    var f = $('.p-flash');
    f.innerHTML = Nova.icon(icon);
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  /* ---------- controls ---------- */

  function showControls(stay) {
    controls = true;
    el.classList.add('controls');
    if (live) renderBanner();
    renderProgress();
    tickClock();
    buildButtons();
    if (stay) clearTimeout(hideTimer); else scheduleHide();
  }
  function hideControls() {
    if (state === 'paused' && !live) return;
    controls = false;
    el.classList.remove('controls');
    zone = live ? 'btns' : 'bar';
    markButtons();
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    if (!controls) return;
    hideTimer = setTimeout(function () { if (!scrub && !Nova.ui.modals.length) hideControls(); }, live ? 4500 : 5000);
  }

  function tickClock() {
    $('.p-clock').textContent = Nova.fmtClock();
  }

  function renderProgress() {
    if (live) return;
    var dur = engine.duration() || (ep && ep.duration) || 0;
    var t = scrub != null ? scrub : engine.time();
    var pct = dur ? Nova.clamp(t / dur, 0, 1) : 0;
    $('.p-fill').style.width = pct * 100 + '%';
    $('.p-thumb').style.left = pct * 100 + '%';
    $('.p-buf').style.width = (dur ? Nova.clamp(engine.buffered() / dur, 0, 1) * 100 : 0) + '%';
    $('.p-tip').textContent = Nova.fmtTime(t);
    $('.p-elapsed').textContent = Nova.fmtTime(t);
    $('.p-remaining').textContent = dur ? '-' + Nova.fmtTime(dur - t) : '';
    $('.p-ends').textContent = dur ? 'Ends at ' + Nova.fmtClock(new Date(Date.now() + (dur - t) * 1000 / rate)) : '';
    el.classList.toggle('scrubbing', scrub != null);
  }

  function renderBanner() {
    var b = $('.p-banner');
    if (!b) return;
    var fav = Nova.favs.has(item);
    b.innerHTML = '<div class="pb-logo"></div><div class="pb-main"><div class="pb-name"><span class="pb-num">' + item.num + '</span>' +
      Nova.esc(item.name) + (fav ? Nova.icon('starFill', 'pb-fav') : '') + '</div><div class="pb-epg">' + Nova.ui.spinner() + '</div></div>';
    var img = Nova.ui.img(item.img, '');
    if (img) b.querySelector('.pb-logo').appendChild(img); else b.querySelector('.pb-logo').textContent = item.name.slice(0, 2).toUpperCase();
    var shown = item;
    Nova.api.epg(item).then(function (epg) {
      if (shown !== item) return;
      var e = b.querySelector('.pb-epg');
      if (e) e.innerHTML = Nova.epgHtml(epg);
      $('.p-sub').textContent = epg.length ? 'Now: ' + epg[0].title : '';
    });
  }

  function buildButtons() {
    var t = engine.tracks(), b = [];
    if (live) {
      b.push({ icon: 'list', label: 'Channels', fn: openChannelList });
    } else {
      b.push({ icon: 'back10', label: 'Back 10 s', fn: function () { skip(-10); } });
      b.push({ icon: state === 'paused' ? 'play' : 'pause', label: state === 'paused' ? 'Play' : 'Pause', fn: togglePlay, main: true });
      b.push({ icon: 'fwd10', label: 'Forward 10 s', fn: function () { skip(10); } });
      b.push({ spacer: true });
    }
    if (t.audio.length > 1) b.push({ icon: 'audio', label: 'Audio', fn: function () { trackPanel('audio'); } });
    if (t.text.length) b.push({ icon: 'subtitles', label: 'Subtitles', fn: function () { trackPanel('text'); } });
    if (t.quality.length > 1) b.push({ icon: 'quality', label: 'Quality', fn: function () { trackPanel('quality'); } });
    if (!live) b.push({ icon: 'speed', label: 'Speed' + (rate !== 1 ? ' ' + rate + '×' : ''), fn: speedPanel });
    b.push({ icon: 'aspect', label: 'Picture', fn: aspectPanel });
    if (ep && episodes.length > 1) b.push({ icon: 'list', label: 'Episodes', fn: episodesPanel });
    if (ep && nextEpisode()) b.push({ icon: 'next', label: 'Next episode', fn: function () { playEpisode(nextEpisode()); } });
    if (live) b.push({ icon: Nova.favs.has(item) ? 'starFill' : 'star', label: 'Favourite', fn: toggleFav });
    b.push({ icon: 'info', label: 'Stream info', fn: toggleStats });
    var sig = b.map(function (x) { return x.icon + (x.label || ''); }).join('|');
    buttons = b.filter(function (x) { return !x.spacer; });
    btnIdx = Math.min(btnIdx, buttons.length - 1);
    if (sig !== buildButtons.sig) {
      buildButtons.sig = sig;
      var n = 0;
      $('.p-btns').innerHTML = b.map(function (x) {
        if (x.spacer) return '<span class="p-spacer"></span>';
        return '<div class="pbtn' + (x.main ? ' main' : '') + '" data-i="' + (n++) + '">' + Nova.icon(x.icon) + '<span class="pbtn-label">' + Nova.esc(x.label) + '</span></div>';
      }).join('');
    }
    markButtons();
  }
  var buildButtonsSoon = Nova.debounce(buildButtons, 50);

  function markButtons() {
    Array.prototype.forEach.call(el.querySelectorAll('.pbtn'), function (e, i) { e.classList.toggle('focused', controls && zone === 'btns' && i === btnIdx); });
    var bar = $('.p-bar');
    if (bar) bar.classList.toggle('focused', controls && zone === 'bar');
  }

  /* ---------- menus ---------- */

  function trackPanel(kind) {
    var t = engine.tracks(), items = t[kind], cur = t.cur[kind];
    var opts = items.map(function (x) { return { label: x.label, sub: x.sub, checked: x.id === cur }; });
    if (kind === 'text') opts.unshift({ label: 'Off', checked: cur < 0 });
    if (kind === 'quality') opts.unshift({ label: 'Automatic', sub: 'Adjusts to your connection', checked: cur < 0 });
    clearTimeout(hideTimer);
    Nova.ui.panel({
      title: { audio: 'Audio', text: 'Subtitles', quality: 'Quality' }[kind],
      items: opts,
      onSelect: function (i) {
        if (kind === 'audio') { engine.setAudio(items[i].id); Nova.prefs.set('audioLang', items[i].label); }
        else if (kind === 'text') {
          if (i === 0) { engine.setText(-1); Nova.prefs.set('subLang', ''); }
          else { engine.setText(items[i - 1].id); Nova.prefs.set('subLang', items[i - 1].label); }
        } else engine.setQuality(i === 0 ? -1 : items[i - 1].id);
        buildButtons();
      },
      onClose: scheduleHide
    });
  }

  function speedPanel() {
    var rates = engine.rates();
    clearTimeout(hideTimer);
    Nova.ui.panel({
      title: 'Playback speed',
      items: rates.map(function (r) { return { label: r === 1 ? 'Normal' : r + '×', checked: r === rate }; }),
      onSelect: function (i) { rate = rates[i]; engine.setRate(rate); buildButtons(); renderProgress(); },
      onClose: scheduleHide
    });
  }

  function aspectPanel() {
    var modes = engine.aspects();
    clearTimeout(hideTimer);
    Nova.ui.panel({
      title: 'Picture',
      items: modes.map(function (m) { return { label: m[1], checked: m[0] === aspect }; }),
      onSelect: function (i) { aspect = modes[i][0]; Nova.prefs.set('aspect', aspect); engine.setAspect(aspect); },
      onClose: scheduleHide
    });
  }

  function episodesPanel() {
    var idx = episodes.indexOf(currentEpisodeRef());
    clearTimeout(hideTimer);
    Nova.ui.panel({
      title: item.name,
      index: Math.max(0, idx),
      items: episodes.map(function (e) {
        var p = Nova.progress.get('ep:' + e.id);
        return { label: 'S' + e.season + ':E' + e.num + '  ' + Nova.epTitle(item, e), sub: p && p.done ? 'Watched' : p && p.pos ? Nova.fmtTime(p.pos) + ' watched' : (e.duration ? Nova.fmtDuration(e.duration) : ''), checked: e === episodes[idx] };
      }),
      onSelect: function (i) {
        var e = episodes[i], p = Nova.progress.get('ep:' + e.id);
        playEpisode(e, p && !p.done && p.pos > 30 ? p.pos : 0);
      },
      onClose: scheduleHide
    });
  }

  function toggleStats() {
    var s = $('.p-stats');
    if (s.classList.contains('show')) { s.classList.remove('show'); clearInterval(statsTimer); return; }
    s.classList.add('show');
    var draw = function () {
      var i = engine.info(), parts = [];
      if (i.width) parts.push(i.width + '×' + i.height);
      if (i.codec) parts.push(i.codec.toUpperCase());
      if (i.audio) parts.push(i.audio.toUpperCase());
      if (i.bitrate) parts.push((i.bitrate / 1e6).toFixed(1) + ' Mbps');
      parts.push(engine.name + ' engine');
      s.textContent = parts.join('  ·  ');
    };
    draw();
    statsTimer = setInterval(draw, 2000);
  }

  function toggleFav() {
    Nova.ui.toast(Nova.favs.toggle(item) ? item.name + ' added to favourites' : item.name + ' removed from favourites');
    buildButtons();
    renderBanner();
  }

  /* ---------- VOD actions ---------- */

  function togglePlay() {
    if (state === 'paused') { engine.play(); flash('play'); scheduleHide(); }
    else { engine.pause(); flash('pause'); saveProgress(); }
    buildButtons();
  }

  function skip(sec) {
    var dur = engine.duration();
    var t = Nova.clamp(engine.time() + sec, 0, dur ? dur - 1 : 1e9);
    engine.seek(t);
    flash(sec < 0 ? 'back10' : 'fwd10');
    renderProgress();
    scheduleHide();
  }

  // Holding left/right speeds up: 10 s steps, then 30 s, then 60 s.
  function scrubBy(dir, big) {
    var dur = engine.duration();
    if (!dur) return;
    var now = Date.now();
    scrubCount = now - scrubLast < 450 ? scrubCount + 1 : 0;
    scrubLast = now;
    var step = big ? 30 : scrubCount < 5 ? 10 : scrubCount < 15 ? 30 : 60;
    if (scrub == null) scrub = engine.time();
    scrub = Nova.clamp(scrub + dir * step, 0, dur - 1);
    showControls();
    zone = 'bar';
    markButtons();
    renderProgress();
    clearTimeout(scrubTimer);
    scrubTimer = setTimeout(commitScrub, 900);
  }
  function commitScrub() {
    clearTimeout(scrubTimer);
    if (scrub == null) return;
    engine.seek(scrub);
    scrub = null;
    if (state === 'paused') engine.play();
    renderProgress();
    scheduleHide();
  }
  function cancelScrub() {
    clearTimeout(scrubTimer);
    scrub = null;
    renderProgress();
  }

  function currentEpisodeRef() {
    var found = null;
    episodes.forEach(function (e) { if (ep && e.id === ep.id) found = e; });
    return found;
  }
  function nextEpisode() {
    if (!ep) return null;
    var i = episodes.indexOf(currentEpisodeRef());
    return i >= 0 ? episodes[i + 1] || null : null;
  }

  function checkNext(t) {
    var next = nextEpisode(), dur = engine.duration();
    if (!next || !dur || nextDismissed) return;
    var left = dur - t, threshold = Math.min(25, dur * 0.3);
    var card = $('.p-next');
    if (left <= threshold && left > 0) {
      if (!nextShown) {
        nextShown = true;
        card.innerHTML = '<div class="pn-thumb"></div><div class="pn-text"><small>Next episode</small><b>S' + next.season + ':E' + next.num + '  ' + Nova.esc(Nova.epTitle(item, next)) + '</b>' +
          '<div class="pn-btns"><span class="btn primary focused">' + Nova.icon('play') + 'Play now</span><span class="pn-count"></span></div></div>';
        var img = Nova.ui.img(next.img || item.backdrop || item.img, '');
        if (img) card.querySelector('.pn-thumb').appendChild(img);
        card.classList.add('show');
      }
      var auto = Nova.prefs.get('autoNext', true);
      card.querySelector('.pn-count').textContent = auto ? 'Starts in ' + Math.ceil(left) + ' s · Back to dismiss' : 'Back to dismiss';
    }
  }

  function playEpisode(next, startAt) {
    saveProgress();
    ep = next;
    retries = 0;
    open(startAt || 0);
    buildButtons();
  }

  function saveProgress(ended) {
    if (live) return;
    lastSave = Date.now();
    var pos = engine.time(), dur = engine.duration() || (ep && ep.duration) || 0;
    if (!dur || (pos < 5 && !ended)) return;
    var done = ended || pos / dur > 0.95;
    if (!ep) {
      Nova.progress.set('resume:movie:' + item.id, done ? null : { type: 'movie', id: item.id, pos: pos, dur: dur, at: Date.now() });
      return;
    }
    Nova.progress.set('ep:' + ep.id, { pos: done ? 0 : pos, dur: dur, done: done });
    var target = ep, tpos = pos, next = nextEpisode();
    if (done) { target = next; tpos = 0; }
    Nova.progress.set('resume:series:' + item.id, target ? {
      type: 'series', id: item.id, pos: tpos, dur: done ? 0 : dur, at: Date.now(),
      ep: { id: target.id, season: target.season, num: target.num, title: target.title }
    } : null);
  }

  /* ---------- live actions ---------- */

  function setChannel(i) {
    if (!list.length) return;
    i = (i + list.length) % list.length;
    if (list[i] !== item) prevChannel = item;
    chIndex = i;
    item = list[i];
    Nova.prefs.set('lastChannel', item.id);
    // A retry still pending for the previous channel must not fire on this one.
    clearTimeout(retryTimer);
    clearMsg();
    renderTitles();
    showControls();
    // Rapid presses only tune the channel the viewer lands on.
    clearTimeout(zapTimer);
    zapTimer = setTimeout(function () { retries = 0; open(0); }, 350);
  }
  function zap(d) { setChannel(chIndex + d); }

  function openChannelList() {
    chOpen = true;
    hideControls();
    el.classList.add('chlist');
    $('.p-chlist h3').textContent = list.length + ' channels';
    var body = $('.p-chlist-body');
    if (!chList) {
      chList = new Nova.VList(body, {
        items: list, index: chIndex, height: 88, visible: 10, cls: 'chans active', render: Nova.channelRow,
        onClick: function (i) { closeChannelList(); if (i !== chIndex) setChannel(i); }
      });
    }
    else chList.setItems(list, chIndex);
  }
  function closeChannelList() { chOpen = false; el.classList.remove('chlist'); }

  function numKey(d) {
    numBuf = (numBuf + d).slice(-4);
    var box = $('.p-num');
    box.textContent = numBuf;
    box.classList.add('show');
    clearTimeout(numTimer);
    numTimer = setTimeout(function () {
      var n = parseInt(numBuf, 10), found = -1;
      numBuf = '';
      box.classList.remove('show');
      list.forEach(function (c, i) { if (c.num === n && found < 0) found = i; });
      if (found < 0) {
        var all = Nova.api.lib.live.items;
        all.forEach(function (c, i) { if (c.num === n && found < 0) found = i; });
        if (found >= 0) list = all;
      }
      if (found >= 0) setChannel(found);
      else Nova.ui.toast('No channel ' + n);
    }, 1400);
  }

  /* ---------- lifecycle ---------- */

  function exit() {
    if (exiting) return;
    exiting = true;
    saveProgress();
    Nova.router.back();
  }

  /* ---------- mouse ---------- */

  // Moving the mouse shows the controls (and the cursor); they hide again after a few idle seconds.
  el.addEventListener('mousemove', function () {
    if (chOpen) return;
    if (!controls) showControls(); else scheduleHide();
  });
  el.addEventListener('click', function (e) {
    var t = e.target;
    var btn = t.closest('.pbtn');
    if (btn) {
      zone = 'btns';
      btnIdx = +btn.getAttribute('data-i');
      markButtons();
      buttons[btnIdx].fn();
      scheduleHide();
      return;
    }
    if (t.closest('.p-back')) return exit();
    var bar = t.closest('.p-bar');
    if (bar) {
      var dur = engine.duration();
      if (!dur) return;
      var r = bar.getBoundingClientRect();
      cancelScrub();
      engine.seek(Nova.clamp((e.clientX - r.left) / r.width, 0, 1) * dur);
      zone = 'bar';
      markButtons();
      renderProgress();
      scheduleHide();
      return;
    }
    if (t.closest('.p-next')) return playEpisode(nextEpisode());
    if (t.closest('.p-chlist')) return;
    // Anything else is the picture itself.
    if (chOpen) return closeChannelList();
    if (live) { if (controls) hideControls(); else showControls(); }
    else { togglePlay(); showControls(state === 'paused'); }
  });
  // Double-click toggles browser full screen, like other web video players.
  el.addEventListener('dblclick', function (e) {
    if (e.target.closest('.p-bottom, .p-top, .p-chlist, .p-next')) return;
    var d = document;
    if (d.fullscreenElement) d.exitFullscreen();
    else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(function () {});
  });

  var hiddenAt = null;
  function onVisibility() {
    if (document.hidden) { saveProgress(); hiddenAt = live ? 0 : engine.time(); engine.close(); }
    else if (hiddenAt != null) { var t = hiddenAt; hiddenAt = null; open(t); }
  }
  document.addEventListener('visibilitychange', onVisibility);
  var clock = setInterval(function () { tickClock(); if (controls) renderProgress(); }, 1000);

  Nova.applySubSize();
  open(params.startAt || 0);
  showControls();

  return {
    el: el,
    destroy: function () {
      exiting = true;
      saveProgress();
      engine.close();
      [hideTimer, msgTimer, subTimer, zapTimer, numTimer, scrubTimer, retryTimer].forEach(clearTimeout);
      clearInterval(clock);
      clearInterval(statsTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      ['state', 'time', 'ended', 'error', 'subtitle', 'tracks'].forEach(function (e) { engine.on(e, null); });
    },
    onKey: function (act, e) {
      if (act === 'stop') return exit();

      if (live) {
        if (chOpen) {
          if (act === 'up' || act === 'down') chList.move(act === 'up' ? -1 : 1);
          else if (act === 'chup' || act === 'chdown') chList.move(act === 'chup' ? -10 : 10);
          else if (act === 'ok') { closeChannelList(); if (chList.index !== chIndex) setChannel(chList.index); }
          else if (act === 'yellow') { Nova.favs.toggle(chList.current()); chList.refresh(); }
          else if (act === 'back' || act === 'left') closeChannelList();
          return;
        }
        if (act === 'digit') return numKey(e.digit);
        if (act === 'chup' || act === 'up') return zap(1);
        if (act === 'chdown' || act === 'down') return zap(-1);
        if (act === 'prech' || act === 'green') { if (prevChannel) { var pi = list.indexOf(prevChannel); if (pi < 0) { list = [prevChannel]; pi = 0; } setChannel(pi); } return; }
        if (act === 'yellow') return toggleFav();
        if (act === 'info') { if (controls) toggleStats(); else showControls(); return; }
        if (!controls) {
          if (act === 'ok') return openChannelList();
          if (act === 'left' || act === 'right') { zone = 'btns'; showControls(); return; }
          if (act === 'back') return exit();
          return;
        }
        zone = 'btns';
        if (act === 'left') btnIdx = Math.max(0, btnIdx - 1);
        else if (act === 'right') btnIdx = Math.min(buttons.length - 1, btnIdx + 1);
        else if (act === 'ok') buttons[btnIdx].fn();
        else if (act === 'back') { hideControls(); return; }
        markButtons();
        scheduleHide();
        return;
      }

      // Next-episode card takes OK/Back while the controls are hidden.
      if ($('.p-next').classList.contains('show') && !controls) {
        if (act === 'ok') return playEpisode(nextEpisode());
        if (act === 'back') { nextDismissed = true; $('.p-next').classList.remove('show'); return; }
      }

      if (act === 'play') { if (state === 'paused') togglePlay(); return; }
      if (act === 'pause') { if (state !== 'paused') togglePlay(); showControls(true); return; }
      if (act === 'playpause') { togglePlay(); showControls(state === 'paused'); return; }
      if (act === 'ff' || act === 'rw') return scrubBy(act === 'ff' ? 1 : -1, true);
      if (act === 'info') return toggleStats();

      if (!controls) {
        if (act === 'left' || act === 'right') return scrubBy(act === 'right' ? 1 : -1);
        if (act === 'back') return exit();
        zone = 'bar';
        showControls();
        return;
      }

      if (zone === 'bar') {
        if (act === 'left' || act === 'right') return scrubBy(act === 'right' ? 1 : -1);
        if (act === 'ok') { if (scrub != null) commitScrub(); else togglePlay(); return; }
        if (act === 'down') { zone = 'btns'; btnIdx = 1; }
        else if (act === 'up') { if (scrub == null) { hideControls(); return; } }
        else if (act === 'back') { if (scrub != null) cancelScrub(); else if (state === 'paused') exit(); else hideControls(); return; }
      } else {
        if (act === 'left') btnIdx = Math.max(0, btnIdx - 1);
        else if (act === 'right') btnIdx = Math.min(buttons.length - 1, btnIdx + 1);
        else if (act === 'up') zone = 'bar';
        else if (act === 'ok') { buttons[btnIdx].fn(); }
        else if (act === 'back') { if (state === 'paused') exit(); else hideControls(); return; }
      }
      markButtons();
      scheduleHide();
    }
  };
});
