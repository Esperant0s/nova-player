/* Search with an on-screen keyboard (English or Arabic letters; a real keyboard works too). Searches the cached
   library locally, so results are instant. */

Nova.router.register('search', function () {
  var LAYOUTS = {
    en: 'abcdefghijklmnopqrstuvwxyz1234567890'.split(''),
    ar: '\u0627\u0628\u062a\u062b\u062c\u062d\u062e\u062f\u0630\u0631\u0632\u0633\u0634\u0635\u0636\u0637\u0638\u0639\u063a\u0641\u0642\u0643\u0644\u0645\u0646\u0647\u0648\u064a\u0621\u0629\u0649\u0626'.split('').concat('1234567890'.split(''))
  };
  // The bottom row of wide keys; the first switches between the English and Arabic letters.
  var WIDE = ['lang', 'space', 'del', 'clear'];
  var COLS = 6;
  var el = Nova.el('div', 'screen search');
  el.innerHTML = '<div class="search-left"><div class="search-q"><span class="q"></span><i class="caret"></i></div><div class="kb"></div></div>' +
    '<div class="search-results"></div><div class="empty"></div>';
  var kb = el.querySelector('.kb'), keyEls = [];
  var lang = Nova.prefs.get('kbLang', 'en'), keys = [], ROWS = 0;
  // kr is the row (ROWS = the wide-key row), kc the column in the letter grid, kw the wide key.
  var q = '', kr = 0, kc = 0, kw = 0, zone = 'kb';

  function renderKb() {
    keys = LAYOUTS[lang] || LAYOUTS.en;
    ROWS = Math.ceil(keys.length / COLS);
    var labels = { lang: lang === 'ar' ? 'ABC' : '\u0639\u0631\u0628\u064a', space: 'Space', del: 'Delete', clear: 'Clear' };
    kb.className = 'kb kb-' + lang;
    kb.innerHTML = keys.map(function (k, i) { return '<div class="key" data-i="' + i + '">' + k + '</div>'; }).join('') +
      WIDE.map(function (a, i) { return '<div class="key wide" data-i="' + (keys.length + i) + '">' + labels[a] + '</div>'; }).join('');
    keyEls = kb.querySelectorAll('.key');
  }
  renderKb();

  function keyIndex() { return kr < ROWS ? Math.min(keys.length - 1, kr * COLS + kc) : keys.length + kw; }

  function mark() {
    var ki = keyIndex();
    Array.prototype.forEach.call(keyEls, function (k, i) { k.classList.toggle('focused', zone === 'kb' && i === ki); });
    if (zone === 'rows') rows.focusIn(); else rows.blur();
  }

  function buildRows() {
    var api = Nova.api, out;
    if (!q.trim()) {
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
    onEdge: function (dir) { if (dir === 'left') { zone = 'kb'; if (kr === ROWS) kw = WIDE.length - 1; else kc = COLS - 1; mark(); } return true; },
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
    var ki = keyIndex();
    if (ki < keys.length) return setQ(q + keys[ki]);
    var a = WIDE[ki - keys.length];
    if (a === 'lang') { lang = lang === 'ar' ? 'en' : 'ar'; Nova.prefs.set('kbLang', lang); renderKb(); kr = ROWS; }
    else if (a === 'space') setQ(q + ' ');
    else if (a === 'del') setQ(q.slice(0, -1));
    else if (a === 'clear') setQ('');
  }

  Nova.onClick(kb, '.key', function (k) {
    var i = +k.getAttribute('data-i');
    Nova.menu.blur();
    zone = 'kb';
    if (i < keys.length) { kr = Math.floor(i / COLS); kc = i % COLS; } else { kr = ROWS; kw = i - keys.length; }
    press();
    mark();
  });

  mark();

  return {
    el: el,
    menu: true,
    menuName: 'search',
    focusIn: function () { zone = 'kb'; mark(); },
    destroy: function () { update.cancel(); },
    onKey: function (act, e) {
      // Physical keyboard: letters (in any language) arrive as "char", or as shortcut actions like I/F; Backspace as "back".
      if (e && e.keyCode === 8) { setQ(q.slice(0, -1)); return; }
      if (e && e.key && e.key.length === 1 && act !== 'ok' && !/[\x00-\x1f\[\]]/.test(e.key)) { setQ(q + e.key.toLowerCase()); return; }
      if (zone === 'rows') {
        if (act === 'back') { zone = 'kb'; mark(); return; }
        rows.onKey(act);
        return;
      }
      var wide = kr === ROWS;
      if (act === 'up') {
        if (wide) { kr = ROWS - 1; kc = Math.floor(kw * COLS / WIDE.length); }
        else if (kr > 0) kr--;
      } else if (act === 'down') {
        if (kr === ROWS - 1) { kr = ROWS; kw = Math.min(WIDE.length - 1, Math.floor(kc * WIDE.length / COLS)); }
        else if (!wide) kr++;
      } else if (act === 'left') {
        if (wide ? kw > 0 : kc > 0) { if (wide) kw--; else kc--; }
        else { Array.prototype.forEach.call(keyEls, function (k) { k.classList.remove('focused'); }); Nova.menu.focus(); return; }
      } else if (act === 'right') {
        if (wide ? kw < WIDE.length - 1 : kc < COLS - 1) { if (wide) kw++; else kc++; }
        else if (rows.rows.length) { zone = 'rows'; }
      } else if (act === 'ok') press();
      else if (act === 'back') { if (q) setQ(q.slice(0, -1)); else Nova.menu.focus(); }
      mark();
    }
  };
});
