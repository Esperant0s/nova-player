/* Suggestions: what was watched, how it was rated, and rows of titles picked from both.

   Every movie and series is described by a few features: its category, region tag, genres,
   cast, director and decade. Watching or rating a title adds its features to a taste profile
   (rated titles count by their stars, watched ones by how much was watched, recent ones more),
   and every unwatched title is scored by how many profile features it shares. Low ratings
   subtract, so titles like the ones you disliked sink out of the suggestions. */

(function () {
  var DAY = 86400000;
  // How much each kind of feature counts towards a match.
  var WEIGHT = { c: 1, t: 0.5, g: 1, p: 0.6, d: 0.8, y: 0.25 };
  var STARS = { 1: -1.5, 2: -0.6, 3: 0.3, 4: 1.2, 5: 2 };
  var LABELS = { 1: 'Disliked it', 2: 'Not for me', 3: 'It was OK', 4: 'Liked it', 5: 'Loved it' };
  var STOP = { the: 1, and: 1, with: 1, from: 1, part: 1, season: 1, movie: 1, film: 1, series: 1, episode: 1, this: 1, that: 1, what: 1, when: 1, your: 1 };

  function list(s, re) {
    var out = [];
    String(s || '').split(re).forEach(function (x) {
      x = x.trim().toLowerCase();
      if (x.length > 1 && x.length <= 40 && out.indexOf(x) < 0) out.push(x);
    });
    return out;
  }

  // Worked out once per title and cached on it, and again once its info has loaded.
  function features(it) {
    var info = Nova.api.infoNow(it), hasInfo = !!info;
    if (it._feat && it._featInfo === hasInfo) return it._feat;
    info = info || {};
    var f = ['c:' + it.type + ':' + it.cat];
    (it.tags || []).forEach(function (t) { f.push('t:' + t); });
    list(info.genre || it.genre, /\s*[,\/&|]\s*/).forEach(function (g) { f.push('g:' + g); });
    list(info.cast || it.cast, /\s*,\s*/).slice(0, 6).forEach(function (p) { f.push('p:' + p); });
    list(info.director, /\s*,\s*/).slice(0, 2).forEach(function (d) { f.push('d:' + d); });
    var y = parseInt(info.year || it.year, 10);
    if (y) f.push('y:' + Math.floor(y / 10));
    it._feat = f;
    it._featInfo = hasInfo;
    return f;
  }

  // Distinctive title words, so "Spider-Man" leads to "Spider-Man 2".
  function titleWords(it) {
    return list(it.name, /[\s\-:.,!?()'"&\/]+/).filter(function (w) { return w.length > 3 && !STOP[w] && !/^\d+$/.test(w); });
  }

  /* ---------------- Watch history ---------------- */

  /* One entry per movie or series, kept after Continue Watching forgets it. Its features are
     saved with it, so a title still shapes suggestions after it leaves the provider. */
  Nova.history = {
    _all: null,
    _load: function () {
      if (!this._all) this._all = Nova.prefs.get('history', {});
      return this._all;
    },
    _save: Nova.debounce(function () { Nova.prefs.set('history', Nova.history._all); }, 1000),
    // Called by the player each time it saves progress.
    saw: function (item, ep, pos, dur, done) {
      var all = this._load(), k = item.type + ':' + item.id, h = all[k];
      var frac = done ? 1 : dur ? pos / dur : 0;
      // A minute or two of a title isn't a signal yet (short clips count once mostly watched).
      if (!h && !done && pos < 120 && frac < 0.5) return;
      if (!h) h = all[k] = { type: item.type, id: item.id, frac: 0, eps: [] };
      h.name = item.name;
      h.at = Date.now();
      h.f = features(item);
      if (ep) { if (done && h.eps.indexOf(ep.id) < 0) h.eps.push(ep.id); }
      else h.frac = Math.max(h.frac, frac);
      // Keep the newest 300.
      var keys = Object.keys(all);
      if (keys.length > 300) {
        keys.sort(function (a, b) { return all[a].at - all[b].at; });
        keys.slice(0, keys.length - 300).forEach(function (x) { delete all[x]; });
      }
      this._save();
      Nova.recommend.reset();
    },
    // 0..1.5: a finished movie is 1, a series grows with the episodes watched.
    weight: function (h) {
      if (h.type === 'series') return Math.min(1.5, 0.4 + 0.2 * h.eps.length);
      return h.frac >= 0.9 ? 1 : 0.3 + 0.6 * h.frac;
    },
    clear: function () { this._all = {}; Nova.prefs.set('history', {}); Nova.recommend.reset(); }
  };

  /* ---------------- Ratings ---------------- */

  Nova.ratings = {
    LABELS: LABELS,
    _all: null,
    _load: function () {
      if (!this._all) this._all = Nova.prefs.get('ratings', {});
      return this._all;
    },
    get: function (item) {
      var r = this._load()[item.type + ':' + item.id];
      return r ? r.stars : 0;
    },
    // 1 to 5 stars, or 0 to remove the rating.
    set: function (item, stars) {
      var all = this._load(), k = item.type + ':' + item.id;
      if (stars) all[k] = { type: item.type, id: item.id, name: item.name, stars: stars, at: Date.now(), f: features(item) };
      else delete all[k];
      Nova.prefs.set('ratings', all);
      Nova.recommend.reset();
      Nova.bus.emit('ratings');
    },
    count: function () { return Object.keys(this._load()).length; },
    clear: function () { this._all = {}; Nova.prefs.set('ratings', {}); Nova.recommend.reset(); Nova.bus.emit('ratings'); }
  };

  /* ---------------- Suggestions ---------------- */

  var memo = {};

  function decay(at, days) { return Math.pow(0.5, Math.max(0, Date.now() - (at || 0)) / (days * DAY)); }

  // Features of a remembered entry: the title's current ones when it is still in the library.
  function entryFeatures(e) {
    var it = Nova.api.get(e.type, e.id);
    if (!it) return e.f || [];
    var f = features(it);
    // The saved list may carry genres or cast from info that hasn't been loaded this session.
    (e.f || []).forEach(function (x) { if (f.indexOf(x) < 0) f = f.concat(x); });
    return f;
  }

  // The taste profile (feature -> score) plus every title that shouldn't be suggested again.
  function taste() {
    if (memo.taste) return memo.taste;
    var prof = {}, skip = {}, signals = 0;
    function add(f, w) { f.forEach(function (x) { prof[x] = (prof[x] || 0) + w; }); signals++; }
    var hist = Nova.history._load(), rated = Nova.ratings._load(), k;
    for (k in rated) { skip[k] = 1; add(entryFeatures(rated[k]), STARS[rated[k].stars] * decay(rated[k].at, 365)); }
    for (k in hist) {
      skip[k] = 1;
      if (!rated[k]) add(entryFeatures(hist[k]), Nova.history.weight(hist[k]) * decay(hist[k].at, 90));
    }
    // My List is a gentler hint: wanted, not yet watched.
    Nova.favs.list().forEach(function (f) {
      if (f.type === 'live') return;
      skip[f.key] = 1;
      var it = Nova.api.get(f.type, f.id);
      if (it && !rated[f.key]) add(features(it), 0.5 * decay(f.at, 180));
    });
    Nova.progress.continueList().forEach(function (p) { skip[p.type + ':' + p.id] = 1; });
    return (memo.taste = { prof: prof, skip: skip, signals: signals });
  }

  // The provider's own rating nudges ties: 0 → ×0.85, 10 → ×1.15.
  function prior(it) { return 0.85 + 0.03 * Math.min(10, it.rating || 0); }

  // Ranks scored titles, letting each category fill only part of the row.
  function diverse(scored, n) {
    scored.sort(function (a, b) { return b.s - a.s; });
    var perCat = {};
    scored = scored.slice(0, n * 6).map(function (x) {
      var c = x.it.type + ':' + x.it.cat;
      perCat[c] = (perCat[c] || 0) + 1;
      return { it: x.it, s: x.s * Math.pow(0.85, perCat[c] - 1) };
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    return scored.slice(0, n).map(function (x) { return x.it; });
  }

  function each(type, fn) {
    var lib = Nova.api.lib;
    (type ? [type] : ['movie', 'series']).forEach(function (t) { lib[t].items.forEach(fn); });
  }

  Nova.recommend = {
    features: features,
    reset: function () { memo = {}; },

    /* Best matches for the whole taste profile; `type` and region `tag` narrow it. Until there is
       enough to go on (nothing watched, rated or in My List yet), the row is topped up with
       well-rated titles, newer ones first, so the feed is never empty. */
    picks: function (type, tag, n) {
      var key = 'picks:' + (type || '') + ':' + (tag || '');
      if (memo[key]) return memo[key];
      n = n || 40;
      var t = taste(), prof = t.prof, scored = [], starters = [];
      each(type, function (it) {
        if (t.skip[it.type + ':' + it.id] || (tag && (!it.tags || it.tags.indexOf(tag) < 0))) return;
        if (t.signals) {
          var f = features(it), s = 0;
          for (var i = 0; i < f.length; i++) { var v = prof[f[i]]; if (v) s += v * WEIGHT[f[i].charAt(0)]; }
          if (s > 0) return scored.push({ it: it, s: s * prior(it) });
          if (s < 0) return;
        }
        // A perfect 10 is almost always a title with a handful of votes, so those are left out, as are titles with no poster.
        if (it.rating > 0 && it.rating < 9.8 && it.img) starters.push({ it: it, s: it.rating * (0.5 + 0.5 * decay(it.added * 1000, 365)) });
      });
      var out = diverse(scored, n);
      if (out.length < n / 2) {
        var need = n - out.length;
        // On Home, movies and series take turns; series alone would fill it, their dates are fresher.
        var mv = diverse(starters.filter(function (x) { return x.it.type === 'movie'; }), need);
        var sr = diverse(starters.filter(function (x) { return x.it.type === 'series'; }), need);
        for (var j = 0; out.length < n && (j < mv.length || j < sr.length); j++) {
          if (j < mv.length) out.push(mv[j]);
          if (j < sr.length && out.length < n) out.push(sr[j]);
        }
      }
      return (memo[key] = out);
    },

    // Titles like one particular title.
    similar: function (item, n) {
      var key = 'like:' + item.type + ':' + item.id;
      if (memo[key]) return memo[key];
      var t = taste(), self = item.type + ':' + item.id, mine = {}, words = {}, scored = [];
      var hist = Nova.history._load()[self], rated = Nova.ratings._load()[self];
      features(item).concat((hist && hist.f) || [], (rated && rated.f) || []).forEach(function (x) { mine[x] = 1; });
      titleWords(item).forEach(function (w) { words[w] = 1; });
      each(null, function (it) {
        var k = it.type + ':' + it.id;
        if (k === self || t.skip[k]) return;
        var f = features(it), s = 0, w = titleWords(it);
        for (var i = 0; i < f.length; i++) if (mine[f[i]]) s += WEIGHT[f[i].charAt(0)];
        for (var j = 0; j < w.length; j++) if (words[w[j]]) s += 1.5;
        // A shared category alone is too loose; it needs a genre, person, tag or title word too.
        if (s <= 1.25) return;
        var p = 0;
        for (var x = 0; x < f.length; x++) p += t.prof[f[x]] || 0;
        if (p < 0) return;
        scored.push({ it: it, s: s * prior(it) });
      });
      return (memo[key] = diverse(scored, n || 30));
    },

    // "Because you watched …" rows: the latest titles that were liked or watched through.
    becauseRows: function (max) {
      var hist = Nova.history._load(), rated = Nova.ratings._load(), seeds = [], k;
      for (k in rated) if (rated[k].stars >= 4) seeds.push({ e: rated[k], verb: 'Liked' });
      for (k in hist) if (!rated[k] && Nova.history.weight(hist[k]) >= 0.8) seeds.push({ e: hist[k], verb: 'Watched' });
      seeds.sort(function (a, b) { return b.e.at - a.e.at; });
      var rows = [];
      for (var i = 0; i < seeds.length && rows.length < (max || 2); i++) {
        var it = Nova.api.get(seeds[i].e.type, seeds[i].e.id);
        if (!it) continue;
        var items = this.similar(it);
        if (items.length >= 4) rows.push({ title: 'Because You ' + seeds[i].verb + ' ' + it.name, shape: 'portrait', items: items });
      }
      return rows;
    }
  };

  Nova.bus.on('library', function () { memo = {}; });
  Nova.bus.on('favs', function () { memo = {}; });
})();
