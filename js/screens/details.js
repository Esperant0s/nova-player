/* Title page for a movie or series: backdrop, info, play/resume, My List, your rating, seasons and episodes. */

Nova.router.register('details', function (params) {
  var item = params.item, isSeries = item.type === 'series';
  var el = Nova.el('div', 'screen details' + (isSeries ? ' is-series' : ''));
  el.innerHTML = '<div class="det-bg"></div><div class="det-shade"></div>' +
    '<div class="det-info"><div class="bb-kicker">' + (isSeries ? 'Series' : 'Movie') + '</div>' +
    '<h1 class="bb-title">' + Nova.esc(item.name) + '</h1><div class="bb-meta"></div>' +
    '<p class="det-plot">' + Nova.ui.spinner() + '</p><p class="det-credits"></p>' +
    '<div class="det-btns"></div></div>' +
    (isSeries ? '<div class="det-seasons"></div><div class="det-eps"></div>' : '');
  el.querySelector('.bb-title').classList.toggle('long', item.name.length > 28);
  var art = new Nova.Backdrop(el.querySelector('.det-bg'));
  Nova.Billboard.art(art, item, Nova.api.infoNow(item));

  // Zones: 'btn', 'rate', 'season', 'eps', 'back' (the on-screen back arrow) and 'menu' (side menu open).
  var info = null, zone = 'btn', btnIdx = 0, starIdx = 0, seasonIdx = 0, buttons = [], epRows = null;
  var fromZone = 'btn', menuFrom = 'btn', backBtn = document.getElementById('backbtn');

  function epProgress(ep) { return Nova.progress.get('ep:' + ep.id); }

  function allEpisodes() {
    var out = [];
    (info.seasons || []).forEach(function (s) { out = out.concat(s.episodes); });
    return out;
  }

  function play(ep, startAt) {
    Nova.router.push('player', { item: item, ep: ep, episodes: ep ? allEpisodes() : null, startAt: startAt || 0 });
  }

  function renderButtons() {
    buttons = [];
    if (!isSeries) {
      var p = Nova.progress.get('resume:movie:' + item.id);
      if (p && p.pos > 30) {
        buttons.push({ icon: 'play', label: 'Resume ' + Nova.fmtTime(p.pos), fn: function () { play(null, p.pos); }, progress: p.dur ? p.pos / p.dur : 0 });
        buttons.push({ icon: 'restart', label: 'Start over', fn: function () { play(null, 0); } });
      } else buttons.push({ icon: 'play', label: 'Play', fn: function () { play(null, 0); } });
    } else if (info && info.seasons && info.seasons.length) {
      var r = Nova.progress.get('resume:series:' + item.id), target = null, pos = 0;
      if (r && r.ep) {
        allEpisodes().forEach(function (e) { if (e.id === r.ep.id) target = e; });
        pos = r.pos || 0;
      }
      if (target) {
        buttons.push({ icon: 'play', label: (pos > 30 ? 'Resume ' : 'Play ') + 'S' + target.season + ':E' + target.num, fn: function () { play(target, pos > 30 ? pos : 0); }, progress: r.dur ? pos / r.dur : 0 });
      } else {
        var first = info.seasons[0].episodes[0];
        buttons.push({ icon: 'play', label: 'Play S' + first.season + ':E' + first.num, fn: function () { play(first, 0); } });
      }
    }
    var fav = Nova.favs.has(item);
    buttons.push({ icon: fav ? 'check' : 'plus', label: 'My List', fn: function () {
      Nova.ui.toast(Nova.favs.toggle(item) ? 'Added to My List' : 'Removed from My List');
      renderButtons();
    } });
    var box = el.querySelector('.det-btns');
    box.innerHTML = buttons.map(function (b, i) {
      return '<div class="btn' + (i === 0 ? ' primary' : '') + '" data-i="' + i + '">' + Nova.icon(b.icon) + '<span>' + Nova.esc(b.label) + '</span>' +
        (b.progress ? '<i class="btn-prog"><b style="width:' + Math.round(b.progress * 100) + '%"></b></i>' : '') + '</div>';
    }).join('') + '<div class="det-rate"><span class="rate-label"></span>' +
      [1, 2, 3, 4, 5].map(function (n) { return '<i class="rate-star" data-s="' + n + '"></i>'; }).join('') + '</div>';
    btnIdx = Math.min(btnIdx, buttons.length - 1);
    mark();
  }

  function renderSeasons() {
    var box = el.querySelector('.det-seasons');
    box.innerHTML = info.seasons.map(function (s, i) {
      return '<div class="tab' + (i === seasonIdx ? ' on' : '') + '" data-i="' + i + '">' + Nova.esc(s.name) + '<small>' + s.episodes.length + '</small></div>';
    }).join('');
    var season = info.seasons[seasonIdx];
    var row = {
      title: '', shape: 'landscape', items: season.episodes,
      opts: function (ep) {
        var p = epProgress(ep);
        return {
          img: ep.img || info.backdrop || item.img, title: Nova.epTitle(item, ep),
          label: ep.num + '. ' + Nova.epTitle(item, ep),
          progress: p ? (p.done ? 1 : p.dur ? p.pos / p.dur : 0) : 0,
          badge: ep.duration ? Nova.fmtDuration(ep.duration) : null
        };
      }
    };
    if (!epRows) {
      epRows = new Nova.Rows(el.querySelector('.det-eps'), {
        rows: [row], width: 1760,
        onSelect: function (ep) {
          var p = epProgress(ep);
          play(ep, p && !p.done && p.pos > 30 ? p.pos : 0);
        },
        onEdge: function (dir) {
          if (dir === 'up') { zone = 'season'; mark(); }
          else if (dir === 'left') openMenu();
          return true;
        },
        onPointer: function () { zone = 'eps'; mark(); }
      });
    } else epRows.setRows([row]);
    mark();
  }

  // Stars after the buttons. While focused they preview the rating OK would give.
  function renderRating() {
    var box = el.querySelector('.det-rate'), stars = Nova.ratings.get(item), on = zone === 'rate';
    var shown = on ? starIdx + 1 : stars;
    box.classList.toggle('focused', on);
    box.querySelector('.rate-label').textContent = shown ? Nova.ratings.LABELS[shown] : 'Rate this';
    Array.prototype.forEach.call(box.querySelectorAll('.rate-star'), function (s, i) {
      s.innerHTML = Nova.icon(i < shown ? 'starFill' : 'star');
      s.classList.toggle('on', i < shown);
      s.classList.toggle('cur', on && i === starIdx);
    });
  }

  function rate(n) {
    var was = Nova.ratings.get(item);
    if (n === was) n = 0;
    Nova.ratings.set(item, n);
    Nova.ui.toast(!n ? 'Rating removed' : n >= 4 ? Nova.ratings.LABELS[n] + ': you’ll see more like this'
      : n <= 2 ? Nova.ratings.LABELS[n] + ': you’ll see fewer like this' : 'Rated: ' + Nova.ratings.LABELS[n]);
    renderRating();
  }

  // Up from the top row reaches the back arrow; Down returns to where it came from.
  function toBack() { fromZone = zone; zone = 'back'; mark(); }

  // Left from the left edge opens the side menu, as on Browse; Right or Back from it returns here.
  function openMenu() { menuFrom = zone; zone = 'menu'; mark(); Nova.menu.focus(); }

  function mark() {
    backBtn.classList.toggle('focused', zone === 'back');
    Array.prototype.forEach.call(el.querySelectorAll('.det-btns .btn'), function (b, i) { b.classList.toggle('focused', zone === 'btn' && i === btnIdx); });
    renderRating();
    if (isSeries) {
      Array.prototype.forEach.call(el.querySelectorAll('.det-seasons .tab'), function (t, i) { t.classList.toggle('focused', zone === 'season' && i === seasonIdx); });
      if (epRows) { if (zone === 'eps') epRows.focusIn(); else epRows.blur(); }
      var low = zone === 'menu' ? menuFrom : zone;
      el.classList.toggle('eps-focus', low === 'season' || low === 'eps');
    }
  }

  Nova.onClick(el, '.det-btns .btn', function (b) { zone = 'btn'; btnIdx = +b.getAttribute('data-i'); mark(); buttons[btnIdx].fn(); });
  Nova.onClick(el, '.det-rate .rate-star', function (s) { zone = 'rate'; starIdx = +s.getAttribute('data-s') - 1; mark(); rate(starIdx + 1); });
  Nova.onClick(el, '.det-seasons .tab', function (t) { zone = 'season'; seasonIdx = +t.getAttribute('data-i'); renderSeasons(); });

  renderButtons();
  Nova.api.info(item).then(function (i) {
    info = i;
    el.querySelector('.bb-meta').innerHTML = Nova.Billboard.meta(item, info);
    el.querySelector('.det-plot').textContent = info.plot || item.plot || '';
    var credits = [];
    if (info.cast) credits.push('<b>Cast:</b> ' + Nova.esc(String(info.cast).split(',').slice(0, 4).join(', ')));
    if (info.director) credits.push('<b>Director:</b> ' + Nova.esc(info.director));
    el.querySelector('.det-credits').innerHTML = credits.join('<br>');
    Nova.Billboard.art(art, item, info);
    if (isSeries) {
      if (!info.seasons.length) { el.querySelector('.det-plot').textContent = 'No episodes are available for this series yet.'; }
      else {
        var r = Nova.progress.get('resume:series:' + item.id);
        if (r && r.ep) info.seasons.forEach(function (s, i) { if (s.num === r.ep.season) seasonIdx = i; });
        renderSeasons();
      }
    }
    renderButtons();
  }, function (e) {
    Nova.Billboard.art(art, item, {});
    el.querySelector('.det-plot').textContent = 'Could not load details: ' + e.message;
  });

  return {
    el: el,
    focusIn: function () { if (zone === 'menu') { zone = menuFrom; mark(); } },
    hide: function () { backBtn.classList.remove('focused'); },
    destroy: function () { backBtn.classList.remove('focused'); },
    show: function (fresh) {
      if (fresh) return;
      // Returning from the player: progress has changed.
      renderButtons();
      if (isSeries && info && info.seasons.length) renderSeasons();
    },
    onKey: function (act, e) {
      if (act === 'back' || (zone === 'back' && act === 'ok')) { Nova.router.back(); return; }
      if (act === 'yellow') { buttons[buttons.length - 1].fn(); return; }
      // Number keys rate directly: 1 to 5 stars, 0 removes the rating.
      if (act === 'digit' && e.digit <= 5) { rate(e.digit); return; }
      var hasEps = isSeries && info && info.seasons.length;
      if (zone === 'back') {
        if (act === 'down') { zone = fromZone; mark(); }
        else if (act === 'left') openMenu();
      } else if (zone === 'btn') {
        if (act === 'left' && btnIdx === 0) { openMenu(); return; }
        if (act === 'left') btnIdx--;
        else if (act === 'up') { toBack(); return; }
        else if (act === 'right' && btnIdx < buttons.length - 1) btnIdx++;
        else if (act === 'right') { zone = 'rate'; starIdx = Math.max(0, Nova.ratings.get(item) - 1); }
        else if (act === 'down' && hasEps) zone = 'season';
        else if (act === 'ok' || act === 'play' || act === 'playpause') buttons[btnIdx].fn();
        mark();
      } else if (zone === 'rate') {
        if (act === 'left' && starIdx > 0) starIdx--;
        else if (act === 'left') zone = 'btn';
        else if (act === 'right') starIdx = Math.min(4, starIdx + 1);
        else if (act === 'up') { toBack(); return; }
        else if (act === 'down' && hasEps) zone = 'season';
        else if (act === 'ok') { rate(starIdx + 1); return; }
        mark();
      } else if (zone === 'season') {
        if (act === 'left' && seasonIdx > 0) { seasonIdx--; renderSeasons(); }
        else if (act === 'left') openMenu();
        else if (act === 'right' && seasonIdx < info.seasons.length - 1) { seasonIdx++; renderSeasons(); }
        else if (act === 'up') { zone = 'btn'; mark(); }
        else if (act === 'down' || act === 'ok') { zone = 'eps'; mark(); }
      } else if (zone === 'eps') {
        epRows.onKey(act);
      }
    }
  };
});
