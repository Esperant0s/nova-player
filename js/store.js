/* Persistence: small settings in localStorage, the (possibly huge) library in IndexedDB. */

Nova.prefs = {
  get: function (key, def) {
    try {
      var v = localStorage.getItem('nova.' + key);
      return v == null ? def : JSON.parse(v);
    } catch (e) { return def; }
  },
  set: function (key, val) {
    try { localStorage.setItem('nova.' + key, JSON.stringify(val)); } catch (e) { /* storage full or blocked */ }
  },
  remove: function (key) {
    try { localStorage.removeItem('nova.' + key); } catch (e) {}
  }
};

// Key/value store on IndexedDB, falling back to memory if it is unavailable.
Nova.cache = (function () {
  var dbp = null, mem = {};
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      try {
        var req = indexedDB.open('nova', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  return {
    get: function (key) {
      return db().then(function (d) {
        if (!d) return mem[key];
        return new Promise(function (resolve) {
          var r = d.transaction('kv').objectStore('kv').get(key);
          r.onsuccess = function () { resolve(r.result); };
          r.onerror = function () { resolve(undefined); };
        });
      });
    },
    set: function (key, val) {
      return db().then(function (d) {
        if (!d) { mem[key] = val; return; }
        return new Promise(function (resolve) {
          var tx = d.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(val, key);
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
      });
    },
    clear: function () {
      mem = {};
      return db().then(function (d) {
        if (!d) return;
        return new Promise(function (resolve) {
          var tx = d.transaction('kv', 'readwrite');
          tx.objectStore('kv').clear();
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        });
      });
    }
  };
})();

/* Watch progress.
   "resume" entries drive the Continue Watching row: one per movie and one per series
   (pointing at the episode in progress). Per-episode positions live under "ep:<id>". */
Nova.progress = {
  _all: null,
  _load: function () {
    if (!this._all) this._all = Nova.prefs.get('progress', {});
    return this._all;
  },
  _save: Nova.debounce(function () { Nova.prefs.set('progress', Nova.progress._all); }, 500),
  get: function (key) { return this._load()[key] || null; },
  set: function (key, val) {
    var all = this._load();
    if (val) all[key] = val; else delete all[key];
    this._save();
  },
  // Most recent first, only things that still need finishing.
  continueList: function () {
    var all = this._load(), out = [];
    for (var k in all) if (k.indexOf('resume:') === 0) out.push(all[k]);
    out.sort(function (a, b) { return b.at - a.at; });
    return out.slice(0, 30);
  },
  clear: function () { this._all = {}; Nova.prefs.set('progress', {}); }
};

Nova.favs = {
  _all: null,
  _load: function () {
    if (!this._all) this._all = Nova.prefs.get('favs', []);
    return this._all;
  },
  key: function (item) { return item.type + ':' + item.id; },
  has: function (item) {
    var k = this.key(item);
    return this._load().some(function (f) { return f.key === k; });
  },
  toggle: function (item) {
    var all = this._load(), k = this.key(item);
    var i = -1;
    all.forEach(function (f, j) { if (f.key === k) i = j; });
    if (i >= 0) all.splice(i, 1);
    else all.unshift({ key: k, type: item.type, id: item.id, at: Date.now() });
    Nova.prefs.set('favs', all);
    Nova.bus.emit('favs');
    return i < 0;
  },
  list: function (type) {
    return this._load().filter(function (f) { return !type || f.type === type; });
  }
};
