/* Screen router, side menu, dialogs, option panels, toasts and cards. */

Nova.router = {
  stack: [],
  factories: {},
  register: function (name, factory) { this.factories[name] = factory; },
  top: function () { return this.stack[this.stack.length - 1]; },

  push: function (name, params) {
    var prev = this.top();
    var s = this.factories[name](params || {});
    s.name = name;
    document.getElementById('screens').appendChild(s.el);
    this.stack.push(s);
    if (prev) { prev.el.style.display = 'none'; if (prev.hide) prev.hide(); }
    this._apply(s);
    if (s.show) s.show(true);
    return s;
  },

  back: function () {
    if (this.stack.length < 2) return false;
    var s = this.stack.pop();
    if (s.destroy) s.destroy();
    s.el.parentNode && s.el.parentNode.removeChild(s.el);
    var t = this.top();
    t.el.style.display = '';
    this._apply(t);
    if (t.show) t.show(false);
    return true;
  },

  // Replaces the whole stack, used by the side menu.
  root: function (name, params) {
    while (this.stack.length) {
      var s = this.stack.pop();
      if (s.destroy) s.destroy();
      s.el.parentNode && s.el.parentNode.removeChild(s.el);
    }
    return this.push(name, params);
  },

  _apply: function (s) {
    Nova.menu.setVisible(!!s.menu, s.menuName || s.name);
    // On-screen back arrow for mouse users; the player has its own.
    document.getElementById('backbtn').classList.toggle('show', this.stack.length > 1 && s.name !== 'player');
    document.body.classList.toggle('playing', s.name === 'player');
  }
};

Nova.menu = {
  items: [
    { id: 'search', label: 'Search', icon: 'search', screen: 'search' },
    { id: 'home', label: 'Home', icon: 'home', screen: 'browse', params: { section: 'home' } },
    { id: 'live', label: 'Live TV', icon: 'live', screen: 'live' },
    { id: 'movie', label: 'Movies', icon: 'movie', screen: 'browse', params: { section: 'movie' } },
    { id: 'series', label: 'Series', icon: 'series', screen: 'browse', params: { section: 'series' } },
    { id: 'mylist', label: 'My List', icon: 'mylist', screen: 'browse', params: { section: 'mylist' } },
    { id: 'settings', label: 'Settings', icon: 'settings', screen: 'settings' }
  ],
  focused: false,
  index: 1,
  init: function () {
    var root = document.getElementById('menu');
    var html = '<div class="menu-logo"><b>N</b><span>NOVA</span></div><div class="menu-items">';
    this.items.forEach(function (it, i) {
      html += '<div class="menu-item" data-i="' + i + '">' + Nova.icon(it.icon) + '<span>' + it.label + '</span></div>';
    });
    root.innerHTML = html + '</div>';
    this.root = root;
    this.els = root.querySelectorAll('.menu-item');
    var self = this;
    Nova.onClick(root, '.menu-item', function (el) { self.go(+el.getAttribute('data-i')); });
    Nova.onClick(root, '.menu-logo', function () { self.go(1); });
  },
  go: function (i) {
    this.blur();
    if (i === this.active) { var top = Nova.router.top(); if (top.focusIn) top.focusIn(); return; }
    Nova.router.root(this.items[i].screen, this.items[i].params);
  },
  setVisible: function (v, active) {
    this.root.classList.toggle('show', v);
    var self = this;
    this.items.forEach(function (it, i) {
      var on = it.id === active || !!(it.params && it.params.section === active);
      self.els[i].classList.toggle('active', on);
      if (on) self.active = i;
    });
    if (!v) this.blur();
  },
  focus: function () {
    this.focused = true;
    this.index = this.active != null ? this.active : 1;
    this.root.classList.add('open');
    this._mark();
  },
  blur: function () {
    this.focused = false;
    this.root.classList.remove('open');
    this._mark();
  },
  _mark: function () {
    var self = this;
    Array.prototype.forEach.call(this.els, function (e, i) { e.classList.toggle('focused', self.focused && i === self.index); });
  },
  onKey: function (act) {
    if (act === 'up') { this.index = Math.max(0, this.index - 1); this._mark(); }
    else if (act === 'down') { this.index = Math.min(this.items.length - 1, this.index + 1); this._mark(); }
    else if (act === 'right' || act === 'back') {
      this.blur();
      var t = Nova.router.top();
      if (t && t.focusIn) t.focusIn();
    } else if (act === 'ok') this.go(this.index);
  }
};

/* A horizontal bar of filter chips ("All · Arabic · Korean …").
   cfg: { items: [{id, label, count}], value, onChange(id), onExit(dir) } — onExit is called for down/back/left-at-start. */
Nova.Chips = function (container, cfg) {
  var self = this;
  this.cfg = cfg;
  this.el = Nova.el('div', 'chips');
  this.list = Nova.el('div', 'chips-list');
  this.note = Nova.el('div', 'chips-note');
  this.el.appendChild(this.list);
  this.el.appendChild(this.note);
  container.appendChild(this.el);
  this.value = cfg.value || 'all';
  this.focused = false;
  this.setItems(cfg.items);
  // Applying waits for the remote to settle, so skimming across chips doesn't rebuild rows each step.
  this.applySoon = Nova.debounce(function () { self.apply(); }, 450);
  Nova.onClick(this.list, '.chip', function (c) {
    self.index = +c.getAttribute('data-i');
    self.render();
    self.apply();
  });
};
Nova.Chips.prototype = {
  setItems: function (items) {
    this.items = items;
    var self = this;
    this.index = 0;
    items.forEach(function (c, i) { if (c.id === self.value) self.index = i; });
    if (items[this.index] && items[this.index].id !== this.value) this.value = items[this.index].id;
    this.list.innerHTML = items.map(function (c, i) {
      return '<div class="chip" data-i="' + i + '">' + Nova.esc(c.label) + (c.id !== 'all' ? '<small>' + c.count + '</small>' : '') + '</div>';
    }).join('');
    this.render();
  },
  setNote: function (text) { this.note.textContent = text || ''; },
  focus: function () { this.focused = true; this.render(); },
  blur: function () { this.focused = false; this.render(); },
  render: function () {
    var els = this.list.children;
    for (var i = 0; i < els.length; i++) {
      els[i].classList.toggle('on', this.items[i].id === this.value);
      els[i].classList.toggle('focused', this.focused && i === this.index);
    }
    // Keep the focused chip in view.
    var f = els[this.index];
    if (f) {
      var left = f.offsetLeft, right = left + f.offsetWidth, w = this.list.clientWidth, x = this.scrollX || 0;
      if (left < x) x = left; else if (right > x + w) x = right - w + 40;
      this.scrollX = Math.max(0, x);
      for (var j = 0; j < els.length; j++) els[j].style.transform = 'translateX(' + (-this.scrollX) + 'px)';
    }
  },
  apply: function () {
    this.applySoon.cancel();
    var id = this.items[this.index].id;
    if (id === this.value) return;
    this.value = id;
    this.render();
    this.cfg.onChange(id);
  },
  onKey: function (act) {
    if (act === 'left') {
      if (this.index > 0) { this.index--; this.render(); this.applySoon(); }
      else this.cfg.onExit('left');
    } else if (act === 'right') {
      if (this.index < this.items.length - 1) { this.index++; this.render(); this.applySoon(); }
    } else if (act === 'ok' || act === 'down') { this.apply(); this.cfg.onExit('down'); }
    else if (act === 'back') { this.apply(); this.cfg.onExit('back'); }
  }
};

// Provider posters are small (342px wide). When the filename is a TMDB image id, TMDB serves the same poster at 780px.
Nova.hiResPoster = function (url) {
  var m = /\/([A-Za-z0-9]{20,40})(?:_big)?\.jpg$/.exec(url || '');
  return m ? 'https://image.tmdb.org/t/p/w780/' + m[1] + '.jpg' : url;
};

/* Big background art for the billboard and title pages. Modes:
   'wide'   a real backdrop, filling the area
   'poster' no backdrop: the poster uncropped on the right, over a blurred copy of itself
   'logo'   channel logos, shown small and uncropped
   Each change cross-fades; stale images that arrive late are dropped. */
Nova.Backdrop = function (container) {
  this.el = container;
  this.key = null;
};
Nova.Backdrop.prototype = {
  clear: function () { this.key = null; this._swap(null); },
  show: function (src, mode) {
    var key = mode + '|' + src;
    if (!src) return this.clear();
    if (key === this.key) return;
    this.key = key;
    var self = this, layer = Nova.el('div', 'bd-layer bd-' + mode), main = new Image();
    main.className = 'bd-main';
    if (mode === 'poster') {
      var blur = new Image();
      blur.className = 'bd-blur';
      blur.src = src;
      layer.appendChild(blur);
      main.src = Nova.hiResPoster(src);
      // Fall back to the provider's own copy if TMDB doesn't have it.
      main.onerror = function () { if (main.src !== src) main.src = src; else self._drop(layer); };
    } else {
      main.src = src;
      main.onerror = function () { self._drop(layer); };
    }
    main.onload = function () {
      if (self.key !== key) return self._drop(layer);
      self._swap(layer);
    };
    layer.appendChild(main);
    this.el.appendChild(layer);
  },
  _swap: function (layer) {
    Array.prototype.forEach.call(this.el.querySelectorAll('.bd-layer.on'), function (old) {
      if (old === layer) return;
      old.classList.remove('on');
      setTimeout(function () { old.parentNode && old.parentNode.removeChild(old); }, 600);
    });
    if (layer) setTimeout(function () { layer.classList.add('on'); }, 20);
  },
  _drop: function (layer) { layer.parentNode && layer.parentNode.removeChild(layer); }
};

Nova.ui = {
  modals: [],

  pushModal: function (m) { this.modals.push(m); document.getElementById('overlay').appendChild(m.el); },
  popModal: function (m) {
    var i = this.modals.indexOf(m);
    if (i >= 0) this.modals.splice(i, 1);
    if (m.el.parentNode) m.el.parentNode.removeChild(m.el);
  },

  // Buttons laid out horizontally; the first is focused.
  dialog: function (opts) {
    var self = this;
    var el = Nova.el('div', 'dialog-wrap');
    var html = '<div class="dialog">';
    if (opts.title) html += '<h2>' + Nova.esc(opts.title) + '</h2>';
    if (opts.text) html += '<p>' + Nova.esc(opts.text) + '</p>';
    html += '<div class="dialog-btns">';
    opts.buttons.forEach(function (b, i) { html += '<div class="btn" data-i="' + i + '">' + Nova.esc(b.label) + '</div>'; });
    el.innerHTML = html + '</div></div>';
    var btns = el.querySelectorAll('.btn'), idx = opts.focus || 0;
    function mark() { Array.prototype.forEach.call(btns, function (b, i) { b.classList.toggle('focused', i === idx); }); }
    mark();
    var m = {
      el: el,
      close: function () { self.popModal(m); },
      onKey: function (act) {
        if (act === 'left') { idx = Math.max(0, idx - 1); mark(); }
        else if (act === 'right') { idx = Math.min(btns.length - 1, idx + 1); mark(); }
        else if (act === 'ok') { m.close(); var b = opts.buttons[idx]; if (b.fn) b.fn(); }
        else if (act === 'back') { m.close(); if (opts.onCancel) opts.onCancel(); }
      }
    };
    Nova.onClick(el, '.btn', function (b) { idx = +b.getAttribute('data-i'); m.onKey('ok'); });
    el.addEventListener('click', function (e) { if (e.target === el) m.onKey('back'); });
    this.pushModal(m);
    return m;
  },

  /* Right-hand drawer with a vertical list, used by the player menus.
     items: [{label, sub, checked}] */
  panel: function (opts) {
    var self = this;
    var el = Nova.el('div', 'panel-wrap');
    var html = '<div class="panel"><h3>' + Nova.esc(opts.title) + '</h3><div class="panel-list">';
    opts.items.forEach(function (it, i) {
      html += '<div class="panel-item' + (it.checked ? ' checked' : '') + '" data-i="' + i + '">' +
        '<span class="panel-check">' + (it.checked ? Nova.icon('check') : '') + '</span>' +
        '<span class="panel-label">' + Nova.esc(it.label) + (it.sub ? '<small>' + Nova.esc(it.sub) + '</small>' : '') + '</span></div>';
    });
    el.innerHTML = html + '</div></div>';
    var list = el.querySelector('.panel-list'), rows = list.children;
    var idx = opts.index != null ? opts.index : Math.max(0, opts.items.map(function (i) { return !!i.checked; }).indexOf(true));
    function mark() {
      Array.prototype.forEach.call(rows, function (r, i) { r.classList.toggle('focused', i === idx); });
      var r = rows[idx];
      if (r) {
        if (r.offsetTop < list.scrollTop) list.scrollTop = r.offsetTop;
        else if (r.offsetTop + r.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = r.offsetTop + r.offsetHeight - list.clientHeight;
      }
    }
    var m = {
      el: el,
      close: function () { self.popModal(m); if (opts.onClose) opts.onClose(); },
      onKey: function (act) {
        if (act === 'up') { idx = Math.max(0, idx - 1); mark(); }
        else if (act === 'down') { idx = Math.min(rows.length - 1, idx + 1); mark(); }
        else if (act === 'ok') { var keep = opts.onSelect(idx); if (!keep) m.close(); }
        else if (act === 'back' || act === 'left') m.close();
      }
    };
    Nova.onClick(el, '.panel-item', function (r) { idx = +r.getAttribute('data-i'); mark(); m.onKey('ok'); });
    el.addEventListener('click', function (e) { if (e.target === el) m.close(); });
    Nova.onWheel(list, function (dir) { if (dir === 'up' || dir === 'down') m.onKey(dir); });
    this.pushModal(m);
    mark();
    return m;
  },

  toast: function (text, ms) {
    var el = Nova.el('div', 'toast', Nova.esc(text));
    document.getElementById('overlay').appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 20);
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.parentNode && el.parentNode.removeChild(el); }, 400);
    }, ms || 3000);
  },

  spinner: function () { return '<span class="spinner"></span>'; },

  // Images fade in once decoded and are dropped on error, leaving the coloured title placeholder.
  img: function (src, cls) {
    if (!src) return null;
    var img = new Image();
    img.className = cls || '';
    img.onload = function () { img.classList.add('loaded'); };
    img.onerror = function () { img.parentNode && img.parentNode.removeChild(img); };
    img.src = src;
    return img;
  },

  card: function (item, shape, opts) {
    opts = opts || {};
    var el = Nova.el('div', 'card ' + shape + (item.type === 'live' ? ' is-live' : ''));
    var h = Nova.hue(item.name);
    var title = opts.title || item.name;
    var ph = Nova.el('div', 'card-ph', '<span>' + Nova.esc(title) + '</span>');
    ph.style.background = 'linear-gradient(135deg, hsl(' + h + ',38%,26%), hsl(' + ((h + 40) % 360) + ',45%,12%))';
    el.appendChild(ph);
    var img = this.img(opts.img || item.img, 'card-img');
    if (img) el.appendChild(img);
    if (opts.progress) el.appendChild(Nova.el('div', 'card-prog', '<i style="width:' + Math.round(opts.progress * 100) + '%"></i>'));
    if (opts.badge) el.appendChild(Nova.el('div', 'card-badge', Nova.esc(opts.badge)));
    if (shape === 'landscape') el.appendChild(Nova.el('div', 'card-label', Nova.esc(opts.label || title)));
    return el;
  }
};
