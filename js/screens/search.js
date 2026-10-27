/* Search with an on-screen keyboard (also accepts a real keyboard). Searches the cached library locally, so results are instant. */

Nova.router.register('search', function () {
  var KEYS = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');
  var COLS = 6, ROWS = 6;
  var el = Nova.el('div', 'screen search');
  var html = '<div class="search-left"><div class="search-q"><span class="q"></span><i class="caret"></i></div><div class="kb">';
  KEYS.forEach(function (k) { html += '<div class="key">' + k + '</div>'; });
  html += '<div class="key wide" data-a="space">Space</div><div class="key wide" data-a="del">Delete</div><div class="key wide" data-a="clear">Clear</div></div></div>' +
    '<div class="search-results"></div><div class="empty"></div>';
  el.innerHTML = html;
  var keyEls = el.querySelectorAll('.key');
  var q = '', kr = 0, kc = 0, zone = 'kb';

  function keyIndex() { return kr < ROWS ? kr * COLS + kc : KEYS.length + Math.floor(kc / 2); }

  function mark() {
    var ki = keyIndex();
    Array.prototype.forEach.call(keyEls, function (k, i) { k.classList.toggle('focused', zone === 'kb' && i === ki); });
    if (zone === 'rows') rows.focusIn(); else rows.blur();
  }

  function buildRows() {
    var api = Nova.api, out;
    if (!q) {
      out = [{ title: 'Recently Added Movies', shape: 'portrait', items: api.recent('movie', 30) },
             { title: 'New in Series', shape: 'portrait', items: api.recent('series', 30) }];
    } else {
      out = [{ title: 'Movies', shape: 'portrait', items: api.search(q, 'movie', 60), count: true },
             { title: 'Series', shape: 'portrait', items: api.search(q, 'series', 60), count: true },
             { title: 'Channels', shape: 'landscape', items: api.search(q, 'live', 60), count: true, opts: function (it) { return { label: it.num + '  ' + it.name }; } }];
    }
    out = out.filter(function (r) { return r.items.length; });
    el.querySelector('.empty').innerHTML = out.length ? '' : '<h2>No results for “' + Nova.esc(q) + '”</h2><p>Try a different spelling or fewer letters.</p>';
    return out;
  }

  var rows = new Nova.Rows(el.querySelector('.search-results'), {
    rows: buildRows(), width: 1160,
    onSelect: function (item, row) { Nova.openItem(item, row.items); },
    onEdge: function (dir) { if (dir === 'left') { zone = 'kb'; kc = COLS - 1; mark(); } return true; },
    onPointer: function () { zone = 'rows'; mark(); }
  });

  var update = Nova.debounce(function () { rows.setRows(buildRows()); mark(); }, 150);

  function setQ(v) {
    q = v.slice(0, 40);
    el.querySelector('.q').textContent = q || '';
    el.querySelector('.search-q').classList.toggle('placeholder', !q);
    update();
  }
  setQ('');

  function press() {
    var ki = keyIndex(), k = keyEls[ki], a = k.getAttribute('data-a');
    if (a === 'space') setQ(q + ' ');
    else if (a === 'del') setQ(q.slice(0, -1));
    else if (a === 'clear') setQ('');
    else setQ(q + KEYS[ki]);
  }

  Array.prototype.forEach.call(keyEls, function (k, i) {
    k.addEventListener('click', function () {
      Nova.menu.blur();
      zone = 'kb';
      if (i < KEYS.length) { kr = Math.floor(i / COLS); kc = i % COLS; } else { kr = ROWS; kc = (i - KEYS.length) * 2; }
      press();
      mark();
    });
  });

  mark();

  return {
    el: el,
    menu: true,
    menuName: 'search',
    focusIn: function () { zone = 'kb'; mark(); },
    destroy: function () { update.cancel(); },
    onKey: function (act, e) {
      // Physical keyboard: letters arrive as "char" (or as shortcut actions like I/F), Backspace as "back".
      if (e && e.keyCode === 8) { setQ(q.slice(0, -1)); return; }
      if (e && e.key && e.key.length === 1 && act !== 'ok' && /[\w ]/.test(e.key)) { setQ(q + e.key.toLowerCase()); return; }
      if (zone === 'rows') {
        if (act === 'back') { zone = 'kb'; mark(); return; }
        rows.onKey(act);
        return;
      }
      var lastRow = kr === ROWS;
      if (act === 'up') { if (kr > 0) kr--; }
      else if (act === 'down') { if (kr < ROWS) kr++; }
      else if (act === 'left') {
        if (kc > (lastRow ? 1 : 0)) kc -= lastRow ? 2 : 1;
        else { Array.prototype.forEach.call(keyEls, function (k) { k.classList.remove('focused'); }); Nova.menu.focus(); return; }
      } else if (act === 'right') {
        if (kc < COLS - (lastRow ? 2 : 1)) kc += lastRow ? 2 : 1;
        else if (rows.rows.length) { zone = 'rows'; }
      } else if (act === 'ok') press();
      else if (act === 'back') { if (q) setQ(q.slice(0, -1)); else Nova.menu.focus(); }
      if (kr === ROWS) kc = Math.floor(kc / 2) * 2;
      mark();
    }
  };
});
