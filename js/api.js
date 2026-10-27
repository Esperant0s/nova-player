/* Content providers. Every provider produces the same normalized library:
   { live|movie|series: { cats: [{id, name}], items: [item] } }
   so the screens never care whether data came from Xtream Codes, an M3U playlist or the demo. */

(function () {
  var LIB_MAX_AGE = 4 * 3600 * 1000;
  // Bump when the normalized item shape changes, so cached libraries are refetched.
  var LIB_VERSION = 3;

  function yearOf(s) {
    var m = /\b(19[2-9]\d|20[0-4]\d)\b/.exec(s || '');
    return m ? m[1] : '';
  }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function ensureHttp(s) {
    s = String(s || '').trim().replace(/\/+$/, '');
    if (s && !/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
  }

  /* ---------------- Xtream Codes ---------------- */

  function Xtream(acc) {
    this.acc = acc;
    this.base = ensureHttp(acc.server);
  }
  Xtream.prototype.call = function (action, extra) {
    var url = this.base + '/player_api.php?username=' + encodeURIComponent(this.acc.user) +
      '&password=' + encodeURIComponent(this.acc.pass) + (action ? '&action=' + action : '') + (extra || '');
    return Nova.http(url, { json: true, timeout: action ? 60000 : 20000 });
  };
  Xtream.prototype.login = function () {
    return this.call('').then(function (r) {
      if (!r || !r.user_info || String(r.user_info.auth) !== '1') throw new Error('Wrong username or password.');
      if (r.user_info.status && r.user_info.status !== 'Active') throw new Error('This account is ' + r.user_info.status.toLowerCase() + '.');
      return {
        expires: r.user_info.exp_date ? new Date(num(r.user_info.exp_date) * 1000) : null,
        maxConnections: r.user_info.max_connections,
        status: r.user_info.status
      };
    });
  };
  Xtream.prototype.library = function () {
    var self = this;
    function cats(list) {
      return (list || []).map(function (c) { return { id: String(c.category_id), name: c.category_name }; });
    }
    return Promise.all([
      this.call('get_live_categories'), this.call('get_live_streams'),
      this.call('get_vod_categories'), this.call('get_vod_streams'),
      this.call('get_series_categories'), this.call('get_series')
    ]).then(function (r) {
      return {
        live: {
          cats: cats(r[0]),
          items: (r[1] || []).map(function (s) {
            return { type: 'live', id: String(s.stream_id), name: s.name || '', img: s.stream_icon || '', cat: String(s.category_id), num: num(s.num), epg: s.epg_channel_id || '' };
          })
        },
        movie: {
          cats: cats(r[2]),
          items: (r[3] || []).map(function (s) {
            return { type: 'movie', id: String(s.stream_id), name: s.name || '', img: s.stream_icon || '', cat: String(s.category_id), added: num(s.added), rating: num(s.rating), ext: s.container_extension || 'mp4', year: s.year || yearOf(s.name) };
          })
        },
        series: {
          cats: cats(r[4]),
          items: (r[5] || []).map(function (s) {
            var bd = s.backdrop_path;
            return {
              type: 'series', id: String(s.series_id), name: s.name || '', img: s.cover || '', cat: String(s.category_id),
              added: num(s.last_modified), rating: num(s.rating), plot: s.plot || '', genre: s.genre || '',
              cast: String(s.cast || '').slice(0, 160),
              backdrop: (bd && bd.length ? bd[0] : '') || '', year: yearOf(s.releaseDate || s.release_date || s.name)
            };
          })
        }
      };
    }).then(function (lib) { lib.server = self.base; return lib; });
  };
  Xtream.prototype.vodInfo = function (item) {
    return this.call('get_vod_info', '&vod_id=' + item.id).then(function (r) {
      var i = (r && r.info) || {};
      var bd = i.backdrop_path;
      return {
        plot: i.plot || i.description || '', cast: i.cast || i.actors || '', director: i.director || '', country: i.country || '',
        genre: i.genre || '', year: yearOf(i.releasedate || i.release_date) || item.year,
        duration: num(i.duration_secs) || 0, rating: num(i.rating) || item.rating,
        backdrop: (bd && bd.length ? bd[0] : '') || '', poster: i.movie_image || ''
      };
    });
  };
  Xtream.prototype.seriesInfo = function (item) {
    return this.call('get_series_info', '&series_id=' + item.id).then(function (r) {
      r = r || {};
      var info = r.info || {};
      var eps = r.episodes || {};
      var bySeason = {};
      // Some panels return episodes as an object keyed by season, others as a flat array.
      var flat = [];
      if (Array.isArray(eps)) eps.forEach(function (a) { flat = flat.concat(Array.isArray(a) ? a : [a]); });
      else for (var k in eps) flat = flat.concat(eps[k] || []);
      flat.forEach(function (e) {
        var s = num(e.season) || 1;
        var ei = e.info || {};
        (bySeason[s] = bySeason[s] || []).push({
          id: String(e.id), season: s, num: num(e.episode_num), title: e.title || '', ext: e.container_extension || 'mp4',
          plot: ei.plot || ei.overview || '', img: ei.movie_image || ei.cover_big || '', duration: num(ei.duration_secs)
        });
      });
      var seasonMeta = {};
      (r.seasons || []).forEach(function (s) { seasonMeta[num(s.season_number)] = s; });
      var seasons = Object.keys(bySeason).map(Number).sort(function (a, b) { return a - b; }).map(function (n) {
        var list = bySeason[n].sort(function (a, b) { return a.num - b.num; });
        return { num: n, name: (seasonMeta[n] && seasonMeta[n].name) || 'Season ' + n, episodes: list };
      });
      var bd = info.backdrop_path;
      return {
        plot: info.plot || item.plot || '', cast: info.cast || '', director: info.director || '', genre: info.genre || item.genre || '',
        year: yearOf(info.releaseDate || info.release_date) || item.year, rating: num(info.rating) || item.rating,
        backdrop: (bd && bd.length ? bd[0] : '') || item.backdrop || '', seasons: seasons
      };
    });
  };
  Xtream.prototype.epg = function (item) {
    return this.call('get_short_epg', '&stream_id=' + item.id + '&limit=6').then(function (r) {
      return ((r && r.epg_listings) || []).map(function (e) {
        return {
          title: Nova.b64(e.title), desc: Nova.b64(e.description),
          start: num(e.start_timestamp) * 1000 || Date.parse(e.start), end: num(e.stop_timestamp) * 1000 || Date.parse(e.end)
        };
      }).filter(function (e) { return e.end > Date.now(); });
    });
  };
  Xtream.prototype.streamUrl = function (item, ep) {
    var a = this.acc, auth = encodeURIComponent(a.user) + '/' + encodeURIComponent(a.pass) + '/';
    if (item.type === 'live') {
      var fmt = Nova.prefs.get('liveFormat', 'auto');
      // MPEG-TS starts faster on the TV's hardware player; browsers can only play HLS.
      var ext = fmt === 'auto' ? (Nova.hasAVPlay() ? 'ts' : 'm3u8') : fmt;
      return this.base + '/live/' + auth + item.id + '.' + ext;
    }
    if (item.type === 'movie') return this.base + '/movie/' + auth + item.id + '.' + item.ext;
    return this.base + '/series/' + auth + ep.id + '.' + ep.ext;
  };

  /* ---------------- M3U playlist ---------------- */

  function M3U(acc) { this.acc = acc; this.series = {}; }
  M3U.prototype.login = function () { return this.library().then(function () { return {}; }); };
  M3U.prototype.library = function () {
    var self = this;
    return Nova.http(this.acc.url, { timeout: 90000 }).then(function (text) {
      if (text.indexOf('#EXTINF') < 0) throw new Error('That link is not an M3U playlist.');
      return self.parse(text);
    });
  };
  M3U.prototype.parse = function (text) {
    var lines = text.split(/\r?\n/);
    var out = { live: { cats: [], items: [] }, movie: { cats: [], items: [] }, series: { cats: [], items: [] } };
    var catIds = { live: {}, movie: {}, series: {} };
    var shows = {};
    var attrRe = /([\w-]+)="([^"]*)"/g;
    var cur = null, n = 0;
    function cat(type, name) {
      name = name || 'Uncategorized';
      if (!catIds[type][name]) { catIds[type][name] = String(out[type].cats.length + 1); out[type].cats.push({ id: catIds[type][name], name: name }); }
      return catIds[type][name];
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('#EXTINF') === 0) {
        var attrs = {}, m;
        attrRe.lastIndex = 0;
        while ((m = attrRe.exec(line))) attrs[m[1].toLowerCase()] = m[2];
        var rest = line.replace(attrRe, '');
        cur = { name: (rest.substring(rest.indexOf(',') + 1) || attrs['tvg-name'] || '').trim(), logo: attrs['tvg-logo'] || '', group: attrs['group-title'] || '', epg: attrs['tvg-id'] || '' };
      } else if (line[0] !== '#' && cur) {
        var url = line, id = String(++n);
        var path = url.split('?')[0].toLowerCase();
        var se = /^(.*?)[\s._-]*s(\d{1,2})[\s._-]*e(\d{1,3})/i.exec(cur.name);
        if (path.indexOf('/series/') >= 0 && se) {
          var showName = se[1].trim() || cur.name;
          var show = shows[showName];
          if (!show) {
            show = shows[showName] = { type: 'series', id: 's' + id, name: showName, img: cur.logo, cat: cat('series', cur.group), added: 0, rating: 0, plot: '', genre: '', backdrop: '', year: yearOf(showName) };
            out.series.items.push(show);
            this.series[show.id] = {};
          }
          var s = parseInt(se[2], 10);
          (this.series[show.id][s] = this.series[show.id][s] || []).push({ id: id, season: s, num: parseInt(se[3], 10), title: cur.name, url: url, img: cur.logo, plot: '', duration: 0 });
        } else if (path.indexOf('/movie/') >= 0 || /\.(mp4|mkv|avi|mov|m4v)$/.test(path)) {
          out.movie.items.push({ type: 'movie', id: id, name: cur.name, img: cur.logo, cat: cat('movie', cur.group), added: n, rating: 0, url: url, year: yearOf(cur.name) });
        } else {
          out.live.items.push({ type: 'live', id: id, name: cur.name, img: cur.logo, cat: cat('live', cur.group), num: out.live.items.length + 1, epg: cur.epg, url: url });
        }
        cur = null;
      }
    }
    out.m3uSeries = this.series;
    return out;
  };
  M3U.prototype.vodInfo = function (item) { return Promise.resolve({ year: item.year }); };
  M3U.prototype.seriesInfo = function (item) {
    var seasons = (Nova.api.lib.m3uSeries || {})[item.id] || {};
    return Promise.resolve({
      plot: '', year: item.year,
      seasons: Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; }).map(function (n) {
        return { num: n, name: 'Season ' + n, episodes: seasons[n].slice().sort(function (a, b) { return a.num - b.num; }) };
      })
    });
  };
  M3U.prototype.epg = function () { return Promise.resolve([]); };
  M3U.prototype.streamUrl = function (item, ep) { return ep ? ep.url : item.url; };

  /* ---------------- Demo (public test streams) ---------------- */

  var CLIP = 'https://test-videos.co.uk/vids/';
  var DEMO_MOVIES = [
    { name: 'Tears of Steel', year: '2012', url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8', img: 'https://mango.blender.org/wp-content/uploads/2013/05/01_thom_celia_bridge.jpg', plot: 'Warriors and scientists gather in Amsterdam to rescue the world from destructive robots. Adaptive HLS with several qualities and subtitle languages.', genre: 'Sci-Fi', rating: 6.8, duration: 734 },
    { name: 'Big Buck Bunny', year: '2008', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', img: 'https://peach.blender.org/wp-content/uploads/bbb-splash.png', plot: 'A giant rabbit takes revenge on three bullying rodents. Adaptive HLS with many quality levels.', genre: 'Comedy, Animation', rating: 6.4, duration: 596 },
    { name: 'Sintel', year: '2010', url: 'https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4', img: 'https://durian.blender.org/wp-content/uploads/2010/06/05.8b_comp_000272.jpg', plot: 'A lonely young woman searches for the baby dragon she once rescued. Plain MP4 file.', genre: 'Fantasy, Animation', rating: 7.5, duration: 52 },
    { name: 'Angel One', year: '2016', url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8', img: '', plot: 'Short test film with several audio languages and subtitle tracks, good for trying the Audio and Subtitles menus.', genre: 'Test', rating: 6.0, duration: 60 },
    { name: 'BipBop Advanced', year: '2017', url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8', img: '', plot: 'Apple\'s HLS reference stream: many qualities, alternate audio and subtitles.', genre: 'Test', rating: 5.0, duration: 1800 },
    { name: 'Jellyfish', year: '2018', url: CLIP + 'jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4', img: '', plot: 'A ten-second clip, useful for watching the next-episode countdown.', genre: 'Short', rating: 5.5, duration: 10 },
    { name: 'Bunny Clip', year: '2018', url: CLIP + 'bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4', img: 'https://peach.blender.org/wp-content/uploads/bbb-splash.png', plot: 'A ten-second clip.', genre: 'Short', rating: 5.5, duration: 10 },
    { name: 'Sintel Clip', year: '2018', url: CLIP + 'sintel/mp4/h264/720/Sintel_720_10s_1MB.mp4', img: 'https://durian.blender.org/wp-content/uploads/2010/06/05.8b_comp_000272.jpg', plot: 'A ten-second clip.', genre: 'Short', rating: 5.5, duration: 10 }
  ];
  var DEMO_LIVE = [
    { name: 'Unified Live', url: 'https://demo.unified-streaming.com/k8s/live/stable/live.isml/.m3u8' },
    { name: 'Unified Live 2', url: 'https://demo.unified-streaming.com/k8s/live/scte35.isml/.m3u8' },
    { name: 'Steel Channel', url: DEMO_MOVIES[0].url },
    { name: 'Bunny TV', url: DEMO_MOVIES[1].url },
    { name: 'Angel One', url: DEMO_MOVIES[3].url },
    { name: 'BipBop 24/7', url: DEMO_MOVIES[4].url }
  ];

  function Demo() {}
  Demo.prototype.login = function () { return Promise.resolve({}); };
  Demo.prototype.library = function () {
    var lib = { live: { cats: [], items: [] }, movie: { cats: [], items: [] }, series: { cats: [], items: [] } };
    lib.live.cats = [{ id: '1', name: 'Demo Channels' }, { id: '2', name: 'Lots of Channels' }];
    DEMO_LIVE.forEach(function (c, i) { lib.live.items.push({ type: 'live', id: 'l' + i, name: c.name, img: '', cat: '1', num: i + 1, epg: '', url: c.url }); });
    for (var i = 0; i < 300; i++) {
      var src = DEMO_LIVE[i % DEMO_LIVE.length];
      lib.live.items.push({ type: 'live', id: 'lx' + i, name: 'Channel ' + (i + 100), img: '', cat: '2', num: i + 100, epg: '', url: src.url });
    }
    lib.movie.cats = [{ id: '1', name: 'Open Movies' }, { id: '2', name: 'Short Clips' }, { id: '3', name: 'Big Catalog (2,000 titles)' }];
    DEMO_MOVIES.forEach(function (m, i) {
      lib.movie.items.push({ type: 'movie', id: 'm' + i, name: m.name, img: m.img, cat: m.duration < 60 ? '2' : '1', added: 2000 - i, rating: m.rating, url: m.url, year: m.year, demo: i });
    });
    // A large category to show that browsing stays fast with big provider catalogs.
    for (var j = 0; j < 2000; j++) {
      var mm = DEMO_MOVIES[j % DEMO_MOVIES.length];
      lib.movie.items.push({ type: 'movie', id: 'mx' + j, name: 'Catalog Title ' + (j + 1), img: j % 3 ? '' : mm.img, cat: '3', added: j, rating: 5 + (j % 40) / 10, url: mm.url, year: String(1990 + j % 35), demo: j % DEMO_MOVIES.length });
    }
    lib.series.cats = [{ id: '1', name: 'Demo Series' }];
    lib.series.items.push({ type: 'series', id: 's1', name: 'Open Movie Collection', img: DEMO_MOVIES[1].img, cat: '1', added: 10, rating: 7.1, plot: 'Open movies and test streams as episodes, so you can try season switching, resume and auto-play of the next episode.', genre: 'Animation', backdrop: DEMO_MOVIES[0].img, year: '2008' });
    lib.series.items.push({ type: 'series', id: 's2', name: 'Shorts', img: DEMO_MOVIES[7].img, cat: '1', added: 9, rating: 5.8, plot: 'Ten-second clips. Handy for watching the next-episode countdown kick in.', genre: 'Short', backdrop: DEMO_MOVIES[6].img, year: '2018' });
    return Promise.resolve(lib);
  };
  Demo.prototype.vodInfo = function (item) {
    var m = DEMO_MOVIES[item.demo] || {};
    return Promise.resolve({ plot: m.plot, genre: m.genre, year: item.year, rating: item.rating, duration: m.duration, backdrop: m.img, cast: 'Blender Foundation' });
  };
  Demo.prototype.seriesInfo = function (item) {
    function ep(m, s, n) { return { id: item.id + 'e' + s + n, season: s, num: n, title: m.name, url: m.url, img: m.img, plot: m.plot, duration: m.duration }; }
    var seasons = item.id === 's1'
      ? [{ num: 1, name: 'Season 1', episodes: [ep(DEMO_MOVIES[1], 1, 1), ep(DEMO_MOVIES[2], 1, 2), ep(DEMO_MOVIES[0], 1, 3)] },
         { num: 2, name: 'Season 2', episodes: [ep(DEMO_MOVIES[3], 2, 1), ep(DEMO_MOVIES[4], 2, 2)] }]
      : [{ num: 1, name: 'Season 1', episodes: [ep(DEMO_MOVIES[5], 1, 1), ep(DEMO_MOVIES[6], 1, 2), ep(DEMO_MOVIES[7], 1, 3)] }];
    return Promise.resolve({ plot: item.plot, genre: item.genre, year: item.year, rating: item.rating, backdrop: item.backdrop, seasons: seasons });
  };
  Demo.prototype.epg = function (item) {
    // Fake half-hour slots so the guide UI has something to show.
    var slot = 30 * 60000, now = Date.now(), start = now - now % slot;
    var shows = ['Morning Report', 'Open Studio', 'The Long Take', 'Night Desk', 'Documentary Hour', 'Live Session'];
    var out = [];
    for (var i = 0; i < 4; i++) {
      out.push({ title: shows[(Nova.hue(item.name) + i) % shows.length], desc: 'Sample programme information for ' + item.name + '.', start: start + i * slot, end: start + (i + 1) * slot });
    }
    return Promise.resolve(out);
  };
  Demo.prototype.streamUrl = function (item, ep) { return ep ? ep.url : item.url; };

  /* ---------------- Public API ---------------- */

  /* Search ignores case, accents, spaces and punctuation ("spiderman" finds "Spider-Man"), Arabic
     diacritics and tatweel, and the Arabic spellings people use interchangeably (أ إ آ ا, ة ه, ى ي). */
  function fold(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD');
    return s.replace(/[̀-ًͯ-ٰٟـ]/g, '')
      .replace(/[آأإٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و')
      .replace(/[\u0000-/:-@[-`{-¿ -⁯،؛؟]/g, '');
  }

  var memo = {}, infoDone = {}, folded = {};

  Nova.api = {
    account: null,
    provider: null,
    lib: null,
    byKey: {},

    make: function (acc) {
      if (acc.type === 'xtream') return new Xtream(acc);
      if (acc.type === 'm3u') return new M3U(acc);
      return new Demo();
    },

    // M3U links generated by Xtream panels carry the credentials, and the Xtream API is far richer.
    normalizeAccount: function (acc) {
      if (acc.type === 'm3u') {
        var m = /^(https?:\/\/[^\/]+)\/get\.php\?(.*)$/i.exec(acc.url.trim());
        if (m) {
          var q = {};
          // Passwords can contain "=" or a stray "%", so split on the first "=" only and keep undecodable values as typed.
          m[2].split('&').forEach(function (p) {
            var i = p.indexOf('='), v = i < 0 ? '' : p.slice(i + 1);
            try { v = decodeURIComponent(v); } catch (e) {}
            q[i < 0 ? p : p.slice(0, i)] = v;
          });
          if (q.username && q.password) return { type: 'xtream', server: m[1], user: q.username, pass: q.password };
        }
      }
      return acc;
    },

    login: function (acc) {
      acc = this.normalizeAccount(acc);
      var p = this.make(acc);
      return p.login().then(function (info) {
        acc.info = info;
        Nova.prefs.set('account', acc);
        Nova.api.use(acc);
        return acc;
      });
    },

    use: function (acc) {
      this.account = acc;
      this.provider = this.make(acc);
      memo = {};
      infoDone = {};
    },

    logout: function () {
      Nova.prefs.remove('account');
      this.account = this.provider = this.lib = null;
      this.byKey = {};
      return Nova.cache.clear();
    },

    cacheKey: function () {
      var a = this.account;
      return 'lib:' + a.type + ':' + (a.server || a.url || 'demo') + ':' + (a.user || '');
    },

    // Shows the cached library instantly; refreshes from the network when missing, stale or forced.
    load: function (force) {
      var self = this, key = this.cacheKey();
      return Nova.cache.get(key).then(function (cached) {
        if (cached && cached.v === LIB_VERSION && !force) {
          self.setLib(cached.lib);
          if (Date.now() - cached.at > LIB_MAX_AGE) self.refresh();
          return self.lib;
        }
        // If the provider can't be reached (or is rate-limiting), an older saved library beats an error screen.
        return self.fetch().catch(function (e) {
          if (!cached) throw e;
          self.setLib(cached.lib);
          return self.lib;
        });
      });
    },

    fetch: function () {
      var self = this, key = this.cacheKey();
      return this.provider.library().then(function (lib) {
        self.setLib(lib);
        Nova.cache.set(key, { v: LIB_VERSION, at: Date.now(), lib: lib });
        return lib;
      });
    },

    // Resolves true when the library was updated, false when it failed but the saved one is still in use.
    refresh: function () {
      var self = this;
      return this.fetch().then(function () { Nova.bus.emit('library'); return true; }, function (e) {
        Nova.ui && Nova.ui.toast('Could not refresh the library: ' + e.message);
        if (!self.lib) throw e;
        return false;
      });
    },

    // Builds an indexed view without touching the raw library, which is what gets cached.
    setLib: function (lib) {
      var byKey = {}, view = { m3uSeries: lib.m3uSeries };
      ['live', 'movie', 'series'].forEach(function (t) {
        var sec = lib[t], byCat = {}, known = {};
        var items = t === 'live' ? sec.items.slice().sort(function (a, b) { return a.num - b.num; }) : sec.items;
        items.forEach(function (it) {
          // Keep the provider's tag (e.g. "ANM" = anime) before it is stripped from the display name.
          if (it.nameTag == null) { var m = Nova.NAME_TAG.exec(it.name); it.nameTag = m ? m[1].trim() : ''; }
          it.name = Nova.cleanName(it.name);
          byKey[t + ':' + it.id] = it;
          (byCat[it.cat] = byCat[it.cat] || []).push(it);
        });
        var cats = sec.cats.map(function (c) { known[c.id] = 1; return { id: c.id, name: c.name, items: byCat[c.id] || [] }; });
        // Items whose category is missing from the category list still deserve a home.
        var orphans = items.filter(function (it) { return !known[it.cat]; });
        if (orphans.length) cats.push({ id: '_other', name: 'Other', items: orphans });
        view[t] = { cats: cats.filter(function (c) { return c.items.length; }), items: items };
      });
      Nova.regions.tagAll(view);
      this.lib = view;
      this.byKey = byKey;
      folded = {};
    },

    get: function (type, id) { return this.byKey[type + ':' + id] || null; },

    info: function (item) {
      var k = item.type + ':' + item.id;
      if (!memo[k]) {
        memo[k] = (item.type === 'series' ? this.provider.seriesInfo(item) : this.provider.vodInfo(item))
          .then(function (info) {
            if (item.type === 'movie' && info.country) Nova.regions.remember(item, info.country, info.genre);
            infoDone[k] = info;
            return info;
          })
          .catch(function (e) { delete memo[k]; throw e; });
      }
      return memo[k];
    },

    // Already-loaded info, without waiting (null if it hasn't been fetched yet).
    infoNow: function (item) { return infoDone[item.type + ':' + item.id] || null; },

    epg: function (item) {
      var k = 'epg:' + item.id, m = memo[k];
      if (m && Date.now() - m.at < 5 * 60000) return m.p;
      var p = this.provider.epg(item).catch(function () { return []; });
      memo[k] = { at: Date.now(), p: p };
      return p;
    },

    streamUrl: function (item, ep) { return this.provider.streamUrl(item, ep); },

    recent: function (type, n) {
      return this.lib[type].items.slice().sort(function (a, b) { return b.added - a.added; }).slice(0, n || 40);
    },

    search: function (q, type, limit) {
      q = fold(q);
      if (!q) return [];
      var starts = [], contains = [];
      var items = this.lib[type].items;
      // Folded names are worked out once per library, on the first search.
      var names = folded[type] || (folded[type] = items.map(function (it) { return fold(it.name); }));
      for (var i = 0; i < items.length && starts.length < limit; i++) {
        var n = names[i], at = n.indexOf(q);
        if (at === 0) starts.push(items[i]);
        else if (at > 0 && contains.length < limit) contains.push(items[i]);
      }
      return starts.concat(contains).slice(0, limit);
    }
  };
})();
