/* Netflix-style rows of cards with remote navigation.

   Only the rows and cards near the focus exist in the DOM, so a category with
   thousands of titles costs the same as one with ten. Each row remembers its own
   column, and the focused card always slides to the left edge.

   rows: [{ title, shape: 'portrait'|'landscape', items: [...], opts: fn(item) -> card opts }] */

Nova.Rows = function (container, cfg) {
  this.cfg = cfg;
  this.el = Nova.el('div', 'rows');
  this.inner = Nova.el('div', 'rows-inner');
  this.el.appendChild(this.inner);
  container.appendChild(this.el);
  this.width = cfg.width || 1700;
  this.setRows(cfg.rows || []);

  var self = this;
  Nova.onClick(this.el, '.row-arrow', function (a) { self.pointer(); self.page(a._r, a.classList.contains('next') ? 1 : -1); });
  Nova.onClick(this.el, '.card', function (c) { self.pointer(); self.clickCard(c._r, c._c); });
  Nova.onWheel(this.el, function (dir) {
    self.pointer();
    // Past the first row the wheel would hand focus elsewhere; keep it inside the rows.
    if ((dir === 'up' && self.row === 0) || (dir === 'left' && self.cols[self.row] === 0)) return;
    self.onKey(dir);
  });
};

Nova.Rows.SHAPES = {
  portrait: { step: 216, height: 392 },
  landscape: { step: 336, height: 316 }
};

Nova.Rows.prototype = {
  setRows: function (rows, keepFocus) {
    var prevRow = this.row || 0, prevCols = this.cols || [];
    var prevTitles = (this.rows || []).map(function (r) { return r.title; });
    this.rows = rows;
    this.tops = [];
    var y = 0;
    for (var i = 0; i < rows.length; i++) {
      this.tops.push(y);
      y += Nova.Rows.SHAPES[rows[i].shape].height;
    }
    this.cols = rows.map(function (r, i) {
      // Keep the column when a row with the same title survives a refresh.
      var j = keepFocus ? prevTitles.indexOf(r.title) : -1;
      return j >= 0 ? Math.min(prevCols[j] || 0, r.items.length - 1) : 0;
    });
    this.row = keepFocus ? Math.min(prevRow, Math.max(0, rows.length - 1)) : 0;
    this.inner.innerHTML = '';
    this.rowEls = {};
    this.render();
  },

  current: function () {
    var r = this.rows[this.row];
    return r ? r.items[this.cols[this.row]] : null;
  },

  // Mouse interaction takes focus away from the menu or another zone of the screen.
  pointer: function () {
    if (Nova.menu.focused) Nova.menu.blur();
    if (this.cfg.onPointer) this.cfg.onPointer();
    if (!this.isActive()) this.focusIn();
  },

  clickCard: function (r, c) {
    this.row = r;
    this.cols[r] = c;
    this.render();
    var row = this.rows[r];
    if (this.cfg.onFocus) this.cfg.onFocus(this.current(), row);
    if (this.cfg.onSelect) this.cfg.onSelect(this.current(), row);
  },

  // Row arrows move a screenful at a time.
  page: function (r, dir) {
    var row = this.rows[r], visible = Math.floor(this.width / Nova.Rows.SHAPES[row.shape].step);
    this.row = r;
    this.cols[r] = Nova.clamp(this.cols[r] + dir * Math.max(1, visible - 1), 0, row.items.length - 1);
    this.render();
    if (this.cfg.onFocus) this.cfg.onFocus(this.current(), row);
  },

  focusIn: function () { this.el.classList.add('active'); this.render(); },
  blur: function () { this.el.classList.remove('active'); },
  isActive: function () { return this.el.classList.contains('active'); },

  render: function () {
    var cur = this.row, want = {};
    for (var r = cur - 1; r <= cur + 2; r++) if (r >= 0 && r < this.rows.length) want[r] = 1;
    for (var k in this.rowEls) {
      if (!want[k]) { this.inner.removeChild(this.rowEls[k]); delete this.rowEls[k]; }
    }
    for (var w in want) this.renderRow(+w);
    this.inner.style.transform = 'translate3d(0,' + (-(this.tops[cur] || 0)) + 'px,0)';
  },

  renderRow: function (r) {
    var row = this.rows[r], shape = Nova.Rows.SHAPES[row.shape];
    var el = this.rowEls[r];
    if (!el) {
      el = this.rowEls[r] = Nova.el('div', 'row row-' + row.shape);
      el.style.top = this.tops[r] + 'px';
      el.innerHTML = '<div class="row-title">' + Nova.esc(row.title) + (row.count ? '<small>' + row.items.length + '</small>' : '') + '</div>';
      el._track = Nova.el('div', 'row-track');
      el.appendChild(el._track);
      el._cards = {};
      el._prev = Nova.el('div', 'row-arrow prev', Nova.icon('chevL'));
      el._next = Nova.el('div', 'row-arrow next', Nova.icon('chevR'));
      el._prev._r = el._next._r = r;
      el._prev.style.top = el._next.style.top = (56 + (row.shape === 'portrait' ? 300 : 180) / 2) + 'px';
      el.appendChild(el._prev);
      el.appendChild(el._next);
      this.inner.appendChild(el);
    }
    el.classList.toggle('above', r < this.row);
    el.classList.toggle('current', r === this.row);
    var col = this.cols[r], visible = Math.ceil(this.width / shape.step);
    el._prev.style.display = col > 0 ? '' : 'none';
    el._next.style.display = col < row.items.length - Math.floor(this.width / shape.step) ? '' : 'none';
    var lo = Math.max(0, col - 3), hi = Math.min(row.items.length - 1, col + visible + 2);
    for (var c in el._cards) {
      if (c < lo || c > hi) { el._track.removeChild(el._cards[c]); delete el._cards[c]; }
    }
    for (var i = lo; i <= hi; i++) {
      var card = el._cards[i];
      if (!card) {
        var item = row.items[i];
        card = el._cards[i] = Nova.ui.card(item, row.shape, row.opts ? row.opts(item) : null);
        card.style.left = i * shape.step + 'px';
        card._r = r;
        card._c = i;
        el._track.appendChild(card);
      }
      card.classList.toggle('focused', r === this.row && i === col);
    }
    el._track.style.transform = 'translate3d(' + (-col * shape.step) + 'px,0,0)';
  },

  onKey: function (act) {
    var row = this.rows[this.row];
    if (!row) return false;
    if (act === 'left') {
      if (this.cols[this.row] > 0) { this.cols[this.row]--; this.renderRow(this.row); }
      else return this.cfg.onEdge ? this.cfg.onEdge('left') : false;
    } else if (act === 'right') {
      if (this.cols[this.row] < row.items.length - 1) { this.cols[this.row]++; this.renderRow(this.row); }
      else return true;
    } else if (act === 'up') {
      if (this.row > 0) { this.row--; this.render(); }
      else return this.cfg.onEdge ? this.cfg.onEdge('up') : false;
    } else if (act === 'down') {
      if (this.row < this.rows.length - 1) { this.row++; this.render(); }
      else return this.cfg.onEdge ? this.cfg.onEdge('down') : false;
    } else if (act === 'ok') {
      if (this.cfg.onSelect) this.cfg.onSelect(this.current(), row);
      return true;
    } else return false;
    if (this.cfg.onFocus) this.cfg.onFocus(this.current(), row);
    return true;
  }
};
