/* Wide background art from TMDB for titles whose provider sends none, so the billboard and
   title pages show a full picture instead of a small poster. Needs a free TMDB API key
   (Settings → Background art). Movies are looked up by the TMDB id most Xtream providers
   include; everything else is searched by name and year. Results, including titles TMDB
   doesn't have, are remembered on the device. */

Nova.artwork = (function () {
  var API = 'https://api.themoviedb.org/3';
  // Originals are often 4K (around 750 KB, slow for a TV to decode while scrolling); the
  // 1280-wide copy is about a fifth of that and the background is only ~1500 px wide.
  var IMG = 'https://image.tmdb.org/t/p/' + (Nova.isTizen ? 'w1280' : 'original');
  var MISS_DAYS = 14;
  var found = {};     // 'movie:123' -> TMDB image path, or the time a lookup found nothing
  var pending = {};
  var cacheKey = null;
  var save = Nova.debounce(function () { if (cacheKey) Nova.cache.set(cacheKey, found); }, 2000);

  // A key saved in Settings (or turned off there) wins over one built into the app
  // in js/local-config.js, which is kept out of git.
  function key() {
    var k = Nova.prefs.get('tmdbKey', null);
    if (k == null) k = (Nova.localConfig && Nova.localConfig.tmdbKey) || '';
    return String(k).trim();
  }

  // A v3 "API key" goes in the URL; the longer v4 "Read Access Token" goes in a header.
  function request(path, params) {
    var k = key(), bearer = k.length > 40;
    var url = API + path + '?' + (params || '') + (bearer ? '' : '&api_key=' + encodeURIComponent(k));
    // TMDB allows cross-site requests, so the browser doesn't need the dev-server proxy.
    return Nova.http(url, { json: true, direct: true, timeout: 15000, headers: bearer ? { Authorization: 'Bearer ' + k } : null });
  }

  function fold(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.replace(/[\u064b-\u065f\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, '');
  }

  // Provider names carry extras TMDB doesn't know: "KIDS-…", "K-2024", "(2012)", "4K", "S01".
  function query(name) {
    return String(name || '').replace(/^[A-Z]{2,5}\s*[-|:]\s*/, '').replace(/\b[A-Z]-(?=(19|20)\d\d\b)/g, '').replace(/\(?\b(19|20)\d\d\b\)?/g, '')
      .replace(/\b(4K|UHD|FHD|HD|SD|S\d\d)\b/gi, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Only trust a search result whose title is this one, ignoring case, accents and punctuation
  // ("Spider-Man No Way Home" = "Spider-Man: No Way Home"). A sequel or spin-off must not match.
  function matches(r, q) {
    var want = fold(q);
    if (want.length < 2) return false;
    return [r.title, r.name, r.original_title, r.original_name].some(function (t) { return fold(t) === want; });
  }

  function search(item, info) {
    var tv = item.type === 'series', q = query(item.name), year = parseInt((info && info.year) || item.year, 10);
    if (!q) return Promise.resolve('');
    // Arabic names are compared against TMDB's Arabic titles.
    var lang = /[\u0600-\u06ff]/.test(q) ? '&language=ar' : '';
    function go(withYear) {
      var params = 'query=' + encodeURIComponent(q) + lang + (withYear ? (tv ? '&first_air_date_year=' : '&year=') + year : '');
      return request(tv ? '/search/tv' : '/search/movie', params).then(function (r) {
        var hit = null;
        ((r && r.results) || []).some(function (x) { if (x.backdrop_path && matches(x, q)) { hit = x; return true; } });
        if (hit) return hit.backdrop_path;
        return withYear ? go(false) : '';
      });
    }
    return go(!!year);
  }

  function lookup(item, info) {
    var id = info && info.tmdb;
    if (!id) return search(item, info);
    return request((item.type === 'series' ? '/tv/' : '/movie/') + id, '').then(function (r) {
      return (r && r.backdrop_path) || search(item, info);
    }, function (e) {
      // A wrong id from the provider: fall back to searching by name.
      if (e.status === 404) return search(item, info);
      throw e;
    });
  }

  return {
    load: function () {
      cacheKey = 'artwork:' + Nova.api.cacheKey();
      return Nova.cache.get(cacheKey).then(function (c) { found = c || {}; });
    },

    enabled: function () { return !!key(); },

    // Already-known art, without waiting ('' if none).
    now: function (item) {
      var p = found[item.type + ':' + item.id];
      return typeof p === 'string' ? IMG + p : '';
    },

    // Resolves to a backdrop URL, or '' when there's no key or TMDB has nothing for the title.
    find: function (item, info) {
      var k = item.type + ':' + item.id, p = found[k];
      if (!key() || (item.type !== 'movie' && item.type !== 'series')) return Promise.resolve('');
      if (typeof p === 'string') return Promise.resolve(IMG + p);
      if (p && Date.now() - p < MISS_DAYS * 86400000) return Promise.resolve('');
      if (!pending[k]) {
        pending[k] = lookup(item, info).then(function (path) {
          delete pending[k];
          found[k] = path || Date.now();
          save();
          return path ? IMG + path : '';
        }, function () {
          // Network trouble or a bad key: try again next time rather than remembering a miss.
          delete pending[k];
          return '';
        });
      }
      return pending[k];
    },

    // Saves a new key and checks it with TMDB. Resolves true when TMDB accepts it.
    setKey: function (k) {
      Nova.prefs.set('tmdbKey', String(k || '').trim());
      // Titles TMDB "didn't have" may only have failed for the old key.
      for (var x in found) if (typeof found[x] !== 'string') delete found[x];
      save();
      if (!key()) return Promise.resolve(false);
      return request('/configuration', '').then(function () { return true; }, function () { return false; });
    }
  };
})();
