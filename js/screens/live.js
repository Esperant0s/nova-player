/* Vertical list that only renders the rows on screen. Used by the guide and the in-player channel list. */
Nova.VList = function (container, cfg) {
  this.cfg = cfg;
  this.el = Nova.el('div', 'vlist ' + (cfg.cls || ''));
  this.inner = Nova.el('div', 'vlist-inner');
  this.el.appendChild(this.inner);
  container.appendChild(this.el);
  this.setItems(cfg.items || [], cfg.index || 0);
  // cfg.onClick(index) for clicks; the wheel scrolls and reports through cfg.onMove().
  var self = this;
  Nova.onClick(this.el, '.vlist-inner > *', function (e) { if (cfg.onClick) cfg.onClick(e._i); });
  Nova.onWheel(this.el, function (dir) {
    if (dir !== 'up' && dir !== 'down') return;
    if (self.move(dir === 'up' ? -1 : 1) && cfg.onMove) cfg.onMove();
  });
};
Nova.VList.prototype = {
  setItems: function (items, index) {
    this.items = items;
    this.index = Nova.clamp(index || 0, 0, Math.max(0, items.length - 1));
    this.inner.innerHTML = '';
    this.els = {};
    this.render();
  },
  current: function () { return this.items[this.index]; },
  move: function (d) {
    var n = Nova.clamp(this.index + d, 0, this.items.length - 1);
    if (n === this.index) return false;
    this.index = n;
    this.render();
    return true;
  },
  render: function () {
    var h = this.cfg.height, vis = this.cfg.visible, n = this.items.length;
    var top = Nova.clamp(this.index - Math.floor(vis / 2), 0, Math.max(0, n - vis));
    var lo = Math.max(0, top - 2), hi = Math.min(n - 1, top + vis + 2);
    for (var k in this.els) if (k < lo || k > hi) { this.inner.removeChild(this.els[k]); delete this.els[k]; }
    for (var i = lo; i <= hi; i++) {
      var e = this.els[i];
      if (!e) {
        e = this.els[i] = this.cfg.render(this.items[i], i);
        e.style.top = i * h + 'px';
        e._i = i;
        this.inner.appendChild(e);
      }
      e.classList.toggle('focused', i === this.index);
    }
    this.inner.style.transform = 'translate3d(0,' + (-top * h) + 'px,0)';
  },
  refresh: function () { this.inner.innerHTML = ''; this.els = {}; this.render(); }
};

Nova.channelRow = function (ch) {
  var e = Nova.el('div', 'ch-row');
  e.innerHTML = '<span class="ch-num">' + (ch.num || '') + '</span><span class="ch-logo"></span>' +
    '<span class="ch-name">' + Nova.esc(ch.name) + '</span>' + (Nova.favs.has(ch) ? Nova.icon('starFill', 'ch-fav') : '');
  var img = Nova.ui.img(ch.img, '');
  if (img) e.querySelector('.ch-logo').appendChild(img);
  else e.querySelector('.ch-logo').textContent = ch.name.slice(0, 2).toUpperCase();
  return e;
};

Nova.epgHtml = function (epg) {
  if (!epg || !epg.length) return '<p class="epg-none">No programme information</p>';
  var now = Date.now(), cur = epg[0], html = '';
  var pct = Nova.clamp((now - cur.start) / (cur.end - cur.start), 0, 1);
  html += '<div class="epg-now"><small>NOW · ' + Nova.fmtClock(new Date(cur.start)) + ' – ' + Nova.fmtClock(new Date(cur.end)) + '</small>' +
    '<h3>' + Nova.esc(cur.title) + '</h3><i class="epg-bar"><b style="width:' + Math.round(pct * 100) + '%"></b></i>' +
    (cur.desc ? '<p>' + Nova.esc(cur.desc) + '</p>' : '') + '</div>';
  epg.slice(1, 3).forEach(function (e) {
    html += '<div class="epg-next"><small>' + Nova.fmtClock(new Date(e.start)) + '</small><span>' + Nova.esc(e.title) + '</span></div>';
  });
  return html;
};

Nova.liveCategories = function () {
  var lib = Nova.api.lib;
  var favs = Nova.favs.list('live').map(function (f) { return Nova.api.get('live', f.id); }).filter(Boolean);
  return [{ id: '_fav', name: 'Favourites', items: favs }, { id: '_all', name: 'All Channels', items: lib.live.items }].concat(lib.live.cats);
};

Nova.router.register('live', function () {
  var el = Nova.el('div', 'screen live');
  el.innerHTML = '<div class="live-head"><h1>Live TV</h1></div><span class="live-clock"></span>' +
    '<div class="live-cats"></div><div class="live-chans"></div>' +
    '<div class="live-info"><div class="li-logo"></div><h2 class="li-name"></h2><div class="li-epg"></div></div>' +
    '<div class="hints"><span><b>OK</b> Watch</span><span><b class="k-yellow"></b> Favourite</span></div>';
  // With a region/topic filter: favourites in that region, "All <region>", then its categories.
  function catsFor(tag) {
    var base = Nova.liveCategories();
    if (tag === 'all') return base;
    var favs = base[0].items.filter(function (it) { return it.tags && it.tags.indexOf(tag) >= 0; });
    return [{ id: '_fav', name: 'Favourites', items: favs }].concat(Nova.regions.liveCats(tag));
  }
  var region = Nova.prefs.get('region.live', 'all');
  if (!Nova.regions.chips('live').some(function (c) { return c.id === region; })) region = 'all';
  var cats = catsFor(region), zone = 'chans', epgTimer = null;
  var lastCat = Nova.prefs.get('liveCat', '_all'), catIdx = 1;
  cats.forEach(function (c, i) { if (c.id === lastCat) catIdx = i; });
  if (!cats[catIdx].items.length) catIdx = 1;

  var catList = new Nova.VList(el.querySelector('.live-cats'), {
    items: cats, index: catIdx, height: 72, visible: 12, cls: 'cats',
    render: function (c) { return Nova.el('div', 'cat-row', '<span>' + Nova.esc(c.name) + '</span><small>' + c.items.length + '</small>'); },
    onClick: function (i) { Nova.menu.blur(); zone = 'cats'; catList.index = i; catList.render(); pickCatSoon.cancel(); pickCat(); mark(); },
    onMove: function () { pickCatSoon(); }
  });
  var chList = new Nova.VList(el.querySelector('.live-chans'), {
    items: cats[catIdx].items, height: 88, visible: 9, cls: 'chans', render: Nova.channelRow,
    onClick: function (i) {
      Nova.menu.blur();
      zone = 'chans';
      chList.index = i;
      chList.render();
      mark();
      showInfo();
      Nova.router.push('player', { item: chList.current(), list: chList.items });
    },
    onMove: function () { showInfo(); }
  });

  var chips = new Nova.Chips(el, {
    items: Nova.regions.chips('live'),
    value: region,
    onChange: function (id) {
      Nova.prefs.set('region.live', id);
      cats = catsFor(id);
      catList.setItems(cats, 1);
      pickCat();
    },
    onExit: function (dir) {
      chips.blur();
      if (dir === 'down') { zone = 'cats'; mark(); }
      else { zone = 'cats'; Nova.menu.focus(); }
    }
  });

  function mark() {
    catList.el.classList.toggle('active', zone === 'cats');
    chList.el.classList.toggle('active', zone === 'chans');
    if (zone === 'chips') chips.focus(); else chips.blur();
    el.querySelector('.hints').style.visibility = zone === 'chans' ? '' : 'hidden';
  }

  function showInfo() {
    var ch = chList.current();
    var logo = el.querySelector('.li-logo');
    logo.innerHTML = '';
    el.querySelector('.li-epg').innerHTML = '';
    if (!ch) { el.querySelector('.li-name').textContent = 'No channels in this category'; return; }
    var img = Nova.ui.img(ch.img, '');
    if (img) logo.appendChild(img); else logo.textContent = ch.name.slice(0, 2).toUpperCase();
    el.querySelector('.li-name').innerHTML = '<span>' + ch.num + '</span> ' + Nova.esc(ch.name);
    clearTimeout(epgTimer);
    epgTimer = setTimeout(function () {
      Nova.api.epg(ch).then(function (epg) { if (chList.current() === ch) el.querySelector('.li-epg').innerHTML = Nova.epgHtml(epg); });
    }, 300);
  }

  function pickCat() {
    var c = catList.current();
    Nova.prefs.set('liveCat', c.id);
    chList.setItems(c.items, 0);
    showInfo();
  }
  var pickCatSoon = Nova.debounce(pickCat, 150);

  function tick() { el.querySelector('.live-clock').textContent = Nova.fmtClock(); }
  tick();
  var clock = setInterval(tick, 15000);

  mark();
  showInfo();

  return {
    el: el,
    menu: true,
    menuName: 'live',
    focusIn: function () { mark(); },
    show: function (fresh) {
      if (fresh) return;
      // Favourites may have changed in the player.
      var cur = catList.current().id, idx = chList.index;
      cats = catsFor(chips.value);
      var ci = 1;
      cats.forEach(function (c, i) { if (c.id === cur) ci = i; });
      catList.setItems(cats, ci);
      chList.setItems(cats[ci].items, idx);
      showInfo();
    },
    destroy: function () { clearInterval(clock); clearTimeout(epgTimer); pickCatSoon.cancel(); chips.applySoon.cancel(); },
    onKey: function (act) {
      if (zone === 'chips') { chips.onKey(act); return; }
      // Up from the top of either list reaches the filter bar.
      if (act === 'up' && ((zone === 'cats' && catList.index === 0) || (zone === 'chans' && chList.index === 0))) {
        zone = 'chips';
        mark();
        return;
      }
      if (zone === 'cats') {
        if (act === 'up' || act === 'down') { if (catList.move(act === 'up' ? -1 : 1)) pickCatSoon(); }
        else if (act === 'right' || act === 'ok') { pickCatSoon.cancel(); if (chList.items !== catList.current().items) pickCat(); if (chList.items.length) { zone = 'chans'; mark(); } }
        else if (act === 'left' || act === 'back') { catList.el.classList.remove('active'); Nova.menu.focus(); }
      } else {
        if (act === 'up' || act === 'down') { if (chList.move(act === 'up' ? -1 : 1)) showInfo(); }
        else if (act === 'chup' || act === 'chdown') { if (chList.move(act === 'chup' ? -10 : 10)) showInfo(); }
        else if (act === 'left' || act === 'back') { zone = 'cats'; mark(); }
        else if (act === 'ok') { var ch = chList.current(); if (ch) Nova.router.push('player', { item: ch, list: chList.items }); }
        else if (act === 'yellow') {
          var c = chList.current();
          if (!c) return;
          Nova.ui.toast(Nova.favs.toggle(c) ? c.name + ' added to favourites' : c.name + ' removed from favourites');
          chList.refresh();
        }
      }
    }
  };
});
