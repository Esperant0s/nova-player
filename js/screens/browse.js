/* Home, Movies, Series and My List: a billboard for the focused title above rows of cards. */

Nova.Billboard = function (root) {
  root.innerHTML = '<div class="bb-bg"></div><div class="bb-shade"></div>' +
    '<div class="bb-info"><div class="bb-kicker"></div><h1 class="bb-title"></h1><div class="bb-meta"></div><p class="bb-plot"></p></div>';
  this.bg = root.querySelector('.bb-bg');
  this.kicker = root.querySelector('.bb-kicker');
  this.title = root.querySelector('.bb-title');
  this.meta = root.querySelector('.bb-meta');
  this.plot = root.querySelector('.bb-plot');
  this.bd = new Nova.Backdrop(this.bg);
};

/* Picks the background art: a real backdrop when there is one, otherwise the uncropped poster
   (or channel logo). Movies only get their backdrop from the info request, so until it arrives
   the background stays empty instead of flashing a stretched poster. */
Nova.Billboard.art = function (bd, item, info) {
  var backdrop = (info && info.backdrop) || item.backdrop;
  if (backdrop) bd.show(backdrop, 'wide');
  else if (item.type === 'live') bd.show(item.img, 'logo');
  else if (info || item.type !== 'movie') bd.show(item.img || (info && info.poster), 'poster');
  else bd.clear();
};

Nova.Billboard.meta = function (item, info) {
  info = info || {};
  var parts = [];
  var year = info.year || item.year, rating = info.rating || item.rating, genre = info.genre || item.genre;
  if (item.type === 'live') parts.push('<span class="pill">LIVE</span>', 'Channel ' + item.num);
  if (year) parts.push(Nova.esc(year));
  if (rating) parts.push('<span class="star">★</span> ' + (Math.round(rating * 10) / 10));
  if (info.duration) parts.push(Nova.fmtDuration(info.duration));
  if (info.seasons) parts.push(info.seasons.length + (info.seasons.length === 1 ? ' Season' : ' Seasons'));
  if (genre) parts.push(Nova.esc(String(genre).split(/[,\/]/).slice(0, 2).join(', ')));
  return parts.join('<i class="dot"></i>');
};

Nova.Billboard.prototype = {
  set: function (item, info, extra) {
    info = info || Nova.api.infoNow(item);
    var kick = { movie: 'Movie', series: 'Series', live: 'Live TV' }[item.type] || '';
    this.kicker.textContent = extra && extra.kicker ? extra.kicker : kick;
    this.title.textContent = item.name;
    this.title.classList.toggle('long', item.name.length > 28);
    this.meta.innerHTML = Nova.Billboard.meta(item, info);
    this.plot.textContent = (extra && extra.plot) || (info && info.plot) || item.plot || '';
    Nova.Billboard.art(this.bd, item, info);
  }
};

// Builds a "Continue Watching" row from saved progress.
Nova.continueRow = function () {
  var entries = Nova.progress.continueList(), items = [], meta = {};
  entries.forEach(function (p) {
    var it = Nova.api.get(p.type, p.id);
    if (!it) return;
    items.push(it);
    meta[p.type + ':' + p.id] = p;
  });
  return {
    title: 'Continue Watching', shape: 'portrait', items: items,
    opts: function (it) {
      var p = meta[it.type + ':' + it.id];
      return { progress: p.dur ? p.pos / p.dur : 0, badge: p.ep ? 'S' + p.ep.season + ':E' + p.ep.num : null };
    }
  };
};

Nova.openItem = function (item, list) {
  if (item.type === 'live') {
    Nova.router.push('player', { item: item, list: list || [item] });
  } else {
    Nova.router.push('details', { item: item });
  }
};

Nova.router.register('browse', function (params) {
  var section = params.section || 'home';
  var el = Nova.el('div', 'screen browse');
  el.innerHTML = '<div class="billboard"></div><div class="browse-rows"></div><div class="empty"></div>';
  var bb = new Nova.Billboard(el.querySelector('.billboard'));
  var api = Nova.api, lib = api.lib;
  var infoTimer = null;

  function favItems(type) {
    return Nova.favs.list(type).map(function (f) { return api.get(f.type, f.id); }).filter(Boolean);
  }

  function catRows(type, max) {
    return lib[type].cats.slice(0, max || 1000).map(function (c) {
      return { title: c.name, shape: type === 'live' ? 'landscape' : 'portrait', items: c.items, count: true };
    });
  }

  function liveOpts(it) { return { img: it.img, label: it.num + '  ' + it.name }; }

  function buildRows() {
    lib = api.lib;
    var rows = [];
    if (section === 'home') {
      rows.push(Nova.continueRow());
      rows.push({ title: 'My List', shape: 'portrait', items: favItems('movie').concat(favItems('series')) });
      rows.push({ title: 'Favourite Channels', shape: 'landscape', items: favItems('live'), opts: liveOpts });
      rows.push({ title: 'Recently Added Movies', shape: 'portrait', items: api.recent('movie') });
      rows.push({ title: 'New in Series', shape: 'portrait', items: api.recent('series') });
      var mc = catRows('movie', 8), sc = catRows('series', 8);
      for (var i = 0; i < Math.max(mc.length, sc.length); i++) {
        if (mc[i]) { mc[i].title += ' · Movies'; rows.push(mc[i]); }
        if (sc[i]) { sc[i].title += ' · Series'; rows.push(sc[i]); }
      }
    } else if (section === 'mylist') {
      rows.push({ title: 'Movies', shape: 'portrait', items: favItems('movie') });
      rows.push({ title: 'Series', shape: 'portrait', items: favItems('series') });
      rows.push({ title: 'Channels', shape: 'landscape', items: favItems('live'), opts: liveOpts });
    } else if (chips && chips.value !== 'all') {
      rows = Nova.regions.rows(section, chips.value);
    } else {
      rows.push({ title: 'Recently Added', shape: 'portrait', items: api.recent(section) });
      rows = rows.concat(catRows(section));
    }
    rows = rows.filter(function (r) { return r.items.length; });
    var empty = el.querySelector('.empty');
    var scanning = chips && /^(korean|japanese|chinese|asian)$/.test(chips.value) && Nova.regions.scanState().running;
    empty.innerHTML = rows.length ? '' : '<h2>Nothing here yet</h2><p>' +
      (section === 'mylist' ? 'Add movies, series and channels to My List from their pages, or press the yellow button on a channel.'
        : scanning ? 'Still sorting Asian movies by country. Titles appear here as they are found.'
        : 'Your provider has no content in this section.') + '</p>';
    return rows;
  }

  // Region/topic filter for Movies and Series.
  var chips = null, chipsFocused = false;
  if (section === 'movie' || section === 'series') {
    el.classList.add('has-chips');
    chips = new Nova.Chips(el, {
      items: Nova.regions.chips(section),
      value: Nova.prefs.get('region.' + section, 'all'),
      onChange: function (id) {
        Nova.prefs.set('region.' + section, id);
        rows.setRows(buildRows());
        showFocused();
      },
      onExit: function (dir) {
        chipsFocused = false;
        chips.blur();
        if (dir === 'left' || dir === 'back') Nova.menu.focus();
        else if (rows.rows.length) rows.focusIn();
        else chipsFocused = true, chips.focus();
      }
    });
    if (section === 'movie') Nova.regions.startScan();
  }

  function focusChips() {
    rows.blur();
    chipsFocused = true;
    chips.focus();
  }

  function updateChips() {
    if (!chips) return;
    chips.setItems(Nova.regions.chips(section));
    var s = Nova.regions.scanState();
    chips.setNote(section !== 'movie' ? '' :
      s.waiting ? 'Provider is busy, sorting Asian movies resumes shortly…' :
      s.running ? 'Sorting Asian movies by country… ' + s.done + ' / ' + s.total : '');
  }
  updateChips();

  function showFocused() {
    var it = rows.current();
    if (!it) return;
    var row = rows.rows[rows.row];
    var extra = { kicker: row.title };
    bb.set(it, null, extra);
    clearTimeout(infoTimer);
    if (it.type === 'live') {
      infoTimer = setTimeout(function () {
        api.epg(it).then(function (epg) {
          if (rows.current() !== it || !epg.length) return;
          bb.plot.textContent = 'Now: ' + epg[0].title + (epg[1] ? '   ·   Next: ' + epg[1].title : '');
        });
      }, 400);
    } else if (!api.infoNow(it) && (it.type === 'movie' || (it.type === 'series' && (!it.plot || !it.backdrop)))) {
      // Plot and backdrop need a request per title; only fetch once the user settles on it.
      infoTimer = setTimeout(function () {
        api.info(it).then(function (info) { if (rows.current() === it) bb.set(it, info, extra); }, function () {
          // No info at all: fall back to the poster rather than an empty background.
          if (rows.current() === it) bb.set(it, {}, extra);
        });
      }, 300);
    }
  }
  var showFocusedSoon = Nova.debounce(showFocused, 120);

  var rows = new Nova.Rows(el.querySelector('.browse-rows'), {
    rows: buildRows(),
    width: 1720,
    onFocus: showFocusedSoon,
    onSelect: function (item, row) { Nova.openItem(item, row.items); },
    onEdge: function (dir) {
      if (dir === 'left') { rows.blur(); Nova.menu.focus(); }
      else if (dir === 'up' && chips) focusChips();
      return true;
    },
    onPointer: function () { if (chipsFocused) { chipsFocused = false; chips.blur(); } }
  });
  if (rows.rows.length || !chips) rows.focusIn(); else focusChips();
  showFocused();

  function refresh() {
    updateChips();
    rows.setRows(buildRows(), true);
    if (rows.isActive()) rows.focusIn();
    showFocused();
  }
  Nova.bus.on('library', refresh);

  // Country lookups for Asian movies arrive in batches; refresh counts, and rows when an Asian filter is showing.
  function onRegions() {
    updateChips();
    if (chips && /^(korean|japanese|chinese|asian)$/.test(chips.value)) {
      rows.setRows(buildRows(), true);
      if (rows.isActive()) rows.focusIn();
    }
  }
  if (chips) Nova.bus.on('regions', onRegions);

  return {
    el: el,
    menu: true,
    menuName: section,
    show: function (fresh) { if (!fresh) refresh(); },
    focusIn: function () { if (chipsFocused) chips.focus(); else rows.focusIn(); },
    destroy: function () {
      Nova.bus.off('library', refresh);
      Nova.bus.off('regions', onRegions);
      clearTimeout(infoTimer);
      showFocusedSoon.cancel();
      if (chips) chips.applySoon.cancel();
    },
    onKey: function (act) {
      if (chipsFocused) { chips.onKey(act); return; }
      if (act === 'back') {
        if (rows.row > 0) { rows.row = 0; rows.render(); showFocused(); }
        else { rows.blur(); Nova.menu.focus(); }
        return;
      }
      if (act === 'yellow') {
        var it = rows.current();
        if (it) Nova.ui.toast(Nova.favs.toggle(it) ? 'Added to My List' : 'Removed from My List');
        return;
      }
      rows.onKey(act);
    }
  };
});
