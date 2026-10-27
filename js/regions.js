/* Region and topic filters (Arabic, Western, Korean, Anime, Sports…).

   Most tags come from category names. Providers lump East Asian titles into one "Asian" category,
   so those are split further: series by their cast names (the series list includes the cast),
   movies by the country in their info, looked up gently in the background and cached forever. */

Nova.regions = (function () {
  var DEFS = [
    { id: 'arabic', label: 'Arabic' }, { id: 'western', label: 'Western' }, { id: 'turkish', label: 'Turkish' },
    { id: 'indian', label: 'Indian' }, { id: 'korean', label: 'Korean' }, { id: 'japanese', label: 'Japanese' },
    { id: 'chinese', label: 'Chinese' }, { id: 'asian', label: 'Other Asian' }, { id: 'anime', label: 'Anime' },
    { id: 'european', label: 'European' }, { id: 'kids', label: 'Kids' }, { id: 'sports', label: 'Sports' },
    { id: 'news', label: 'News' }, { id: 'religious', label: 'Religious' }, { id: 'other', label: 'Other' }
  ];
  var REGIONS = ['arabic', 'western', 'turkish', 'indian', 'korean', 'japanese', 'chinese', 'asian', 'anime', 'european'];
  var EAST_ASIAN = ['korean', 'japanese', 'chinese', 'asian'];

  // Matched against lower-cased category names; a category can get several tags.
  var RULES = [
    ['anime', /anime|conan/],
    ['arabic', /arab|عرب|masr|egypt|مصر|hafalat|ramez|talk show|islam|quran|saudi|kuwait|dubai|iraq|algeria|libya|leban|moroc|tunis|syria|sudan|jordan|qatar|yemen|yenen|oman|bahrain|palestin|\bmbc\b|rotana|shahid|\bosn\b|\bart channels|thmanayah|alwan|speedtv channels|nilesat|bein|alkass|\bafc\b|\bar sports/],
    ['western', /english|netflix|boxoffice|highest revenue|imdb top ?250|top imdb english|marvel|\bdc\b|tom and jerry|wwe|\buk\b|\bu ?s ?a\b|canada|austr|james bond|dwayne|vin diesel|tom crui|scott adkins|arnold|van damme|jim carrey|leonardo|chaplin|starzplay/],
    ['turkish', /turk/],
    ['indian', /hend|hindi|amitabh|shah ?rukh|bollywood|\bindia/],
    ['asian', /asian|\basn\b|jackie chan|korea|japan|chin(a|ese)|thai/],
    ['european', /france|french|german|espan|spain|ital|rusia|russia|poland|netherland|belgium|portugal|albania|switzerland|ukrain/],
    ['kids', /kids|disney|tom and jerry|cartoon|animation/],
    ['sports', /sport|bein(?! movies)|wwe|alkass|\bafc\b|alwan|thmanayah/],
    ['news', /news/],
    ['religious', /islam|quran|christian/]
  ];

  function catTags(name) {
    var n = String(name || '').toLowerCase(), tags = [];
    RULES.forEach(function (r) { if (r[1].test(n)) tags.push(r[0]); });
    if (tags.indexOf('anime') >= 0) tags = tags.filter(function (t) { return t !== 'western'; });
    var hasRegion = tags.some(function (t) { return REGIONS.indexOf(t) >= 0; });
    // e.g. "ADEL EMAM | عادل امام": Arabic script and no other region.
    if (!hasRegion && /[؀-ۿ]/.test(name)) { tags.push('arabic'); hasRegion = true; }
    if (!tags.length) tags.push('other');
    return tags;
  }

  /* ---------- telling Korean, Japanese and Chinese casts apart ---------- */

  var ZH_SUR = ('wang li zhang liu chen yang huang zhao wu zhou xu sun ma zhu hu guo he lin luo gao zheng xiao xie song tang ' +
    'han feng deng cao peng zeng tian dong pan yuan cai jiang yu du ye cheng wei su lu ding ren shen yao fan jin tan liao zou xiong ' +
    'qin bai ning jia yan fu hou shi qi gu mao jing qiao lai wen fang kong bao zhong meng long dai xue lei hao gong yin ' +
    // Cantonese and Taiwanese spellings
    'chan wong cheung leung lau yeung ng ho lam tsang chow fung kwok yip mak au poon tse yuen siu chu law kwan tam hui ' +
    'tseng hsu hsieh chang chiang chou kuo tsai liang yeh hsiao').split(' ');
  var ZH_IDX = {};
  ZH_SUR.forEach(function (s) { ZH_IDX[s] = 1; });
  var KO_IDX = {};
  ('kim lee park choi jung jeong kang cho jo yoon yun jang lim im han oh seo shin kwon hwang ahn song yoo yu hong jeon ko go ' +
    'moon son bae baek heo nam shim noh ha kwak sung seong cha joo ju woo min ryu na jin eom chae won cheon bang gong hyun ' +
    'byun yeom yang choo chu do ji kong tak pyo ok so lim gil').split(' ').forEach(function (s) { KO_IDX[s] = 1; });
  var JAPONIC = /^(?:(?:[kgsztdnhbpmr]y?|sh|ch|j|ts|f|w|y)?[aeiou]|n)+$/;

  function person(name) {
    name = name.trim();
    var t = name.split(/\s+/);
    if (t.length !== 2) return t.length === 1 ? null : (t.some(function (x) { return x.length >= 10; }) ? 'asian' : null);
    var a = t[0].toLowerCase(), b = t[1].toLowerCase();
    // Hyphenated given names, but only after a real surname ("Debnam-Carey" is not Asian).
    if (KO_IDX[a] && /^[A-Z][a-z]+-[a-z]+$/.test(t[1])) return 'korean';           // Kim Ji-won
    if (ZH_IDX[a] && /^[A-Z][a-z]+-[A-Za-z][a-z]+$/.test(t[1])) return 'chinese';  // Yeung Lok-Man, Tseng Jing-Hua
    if (/-/.test(b)) return null;
    if (ZH_IDX[a] && /^[a-z]+$/.test(b)) return 'chinese';            // Zhang Wanying (surname first)
    if (JAPONIC.test(a) && JAPONIC.test(b) && (a.length >= 5 || b.length >= 5)) return 'japanese'; // Taiki Sato
    // Long Thai surnames: Tilapornput, Kitcharit, Dechaphatthanakun.
    if (b.length >= 8 && /(porn|pong|wong|sak|chai|kul|phan|thana|siri|phat|kit|anan|chot|suk|rat)/.test(b) && !/(z|sch|ck|ff|ll|w$)/.test(b)) return 'asian';
    return null;
  }

  // Vote over the first cast members. A clear share of the cast must agree, so one or two
  // Asian-sounding names in a Western cast don't flip the whole show. Japanese needs half,
  // because many Italian and Spanish names also fit Japanese sound patterns.
  function fromCast(cast) {
    if (!cast) return null;
    var votes = {}, people = String(cast).split(',').filter(function (p) { return p.trim(); }).slice(0, 8), best = null, n = 0;
    people.forEach(function (p) { var o = person(p); if (o) votes[o] = (votes[o] || 0) + 1; });
    for (var k in votes) if (votes[k] > n) { n = votes[k]; best = k; }
    if (!best) return null;
    var minCount = people.length <= 2 ? 1 : 2;
    var minShare = best === 'japanese' ? 0.5 : 0.4;
    return n >= minCount && n / people.length >= minShare ? best : null;
  }

  // The first listed country is the main production country ("United States of America, South Korea" is American).
  function fromCountry(c) {
    c = String(c || '').split(',')[0].trim().toLowerCase();
    if (!c) return null;
    if (/korea/.test(c)) return 'korean';
    if (/japan/.test(c)) return 'japanese';
    if (/china|hong kong|taiwan/.test(c)) return 'chinese';
    if (/thai|philippin|indonesia|vietnam|malaysia|singapore|cambodia|myanmar/.test(c)) return 'asian';
    if (/india/.test(c)) return 'indian';
    if (/turk/.test(c)) return 'turkish';
    return 'known';
  }

  /* ---------- tagging the library ---------- */

  var countries = {};   // movie id -> [country, genre], from get_vod_info
  var catTagMap = {};   // type -> cat id -> tags
  var cacheKey = null;

  function itemTags(it, ct) {
    var tags = ct.slice(), origin = null;
    var trusted = tags.indexOf('arabic') >= 0 || tags.indexOf('turkish') >= 0 || tags.indexOf('indian') >= 0;
    if (!trusted) {
      if (it.type === 'series') origin = fromCast(it.cast);
      else if (it.type === 'movie' && countries[it.id]) origin = fromCountry(countries[it.id][0]);
    }
    if (origin && EAST_ASIAN.indexOf(origin) >= 0) {
      tags = tags.filter(function (t) { return t !== 'western' && t !== 'asian' && t !== 'other'; });
      tags.push(origin);
      if (origin === 'japanese' && /anim/i.test(it.genre || '')) tags.push('anime');
    } else if ((origin === 'indian' || origin === 'turkish') && tags.indexOf('asian') >= 0) {
      tags = tags.filter(function (t) { return t !== 'asian'; });
      tags.push(origin);
    }
    // The provider marks anime series with "(ANM …)" in the title.
    if (it.type === 'series' && /^ANM\b/.test(it.nameTag || '') && tags.indexOf('anime') < 0) {
      tags = tags.filter(function (t) { return t !== 'western' && t !== 'other'; });
      tags.push('anime');
    }
    return tags;
  }

  /* Each title gets one category so filters barely overlap: the most specific tag wins
     (anime over Japanese, kids over Arabic, Korean over Western, and so on). */
  var PRIORITY = ['anime', 'kids', 'korean', 'japanese', 'chinese', 'asian', 'turkish', 'indian',
    'religious', 'sports', 'news', 'arabic', 'european', 'western', 'other'];
  function primary(tags) {
    for (var i = 0; i < PRIORITY.length; i++) if (tags.indexOf(PRIORITY[i]) >= 0) return [PRIORITY[i]];
    return tags.slice(0, 1);
  }

  function tagAll(lib) {
    ['live', 'movie', 'series'].forEach(function (type) {
      var map = catTagMap[type] = {};
      lib[type].cats.forEach(function (c) {
        c.tags = catTags(c.name);
        map[c.id] = c.tags;
        c.items.forEach(function (it) {
          if (it.type === 'movie' && countries[it.id] && countries[it.id][1] && !it.genre) it.genre = countries[it.id][1];
          it.tags = primary(itemTags(it, c.tags));
        });
      });
    });
  }

  // Saved every 20 new results (a running scan never pauses long enough for a debounce alone), plus shortly after the last one.
  var unsaved = 0;
  function saveNow() { saveSoon.cancel(); unsaved = 0; if (cacheKey) Nova.cache.set(cacheKey, countries); }
  var saveSoon = Nova.debounce(saveNow, 2000);

  function remember(item, country, genre) {
    if (!item || item.type !== 'movie') return;
    countries[item.id] = [country || '', genre || ''];
    if (genre && !item.genre) item.genre = genre;
    var ct = (catTagMap.movie || {})[item.cat];
    if (ct) item.tags = itemTags(item, ct);
    if (++unsaved >= 20) saveNow(); else saveSoon();
  }

  /* ---------- background country lookup for Asian movies ---------- */

  /* One request every 1.5 s. Providers rate-limit (HTTP 429); this one refused ~1 request a second.
     On a 429 the scan waits 1, 2, then 5 minutes; after five refusals in a row it stops until the
     next app start. Results are saved as they arrive, so an interrupted scan resumes where it stopped. */
  var scan = { running: false, done: 0, total: 0 };
  var GAP_MS = 1500, BACKOFF_MS = [60000, 120000, 300000, 300000];

  function startScan() {
    var p = Nova.api.provider, lib = Nova.api.lib;
    if (scan.running || scan.gaveUp || !lib || !p || Nova.api.account.type !== 'xtream') return;
    var todo = lib.movie.items.filter(function (m) { return m.tags && m.tags.indexOf('asian') >= 0 && !countries[m.id]; });
    if (!todo.length) return;
    scan = { running: true, done: 0, total: todo.length };
    var i = 0, limited = 0, acct = Nova.api.account;
    Nova.bus.emit('regions');
    function finish(gaveUp) {
      scan.running = false;
      scan.gaveUp = !!gaveUp;
      saveNow();
      Nova.bus.emit('regions');
    }
    function next() {
      // Stop if the user signed out or switched accounts mid-scan.
      if (Nova.api.account !== acct) return finish();
      if (i >= todo.length) return finish();
      var m = todo[i];
      p.call('get_vod_info', '&vod_id=' + m.id).then(function (r) {
        var inf = (r && r.info) || {};
        remember(m, inf.country, inf.genre);
        limited = 0;
        i++;
        scan.done++;
        if (scan.done % 25 === 0) Nova.bus.emit('regions');
        setTimeout(next, GAP_MS);
      }, function (e) {
        if (e && e.status === 429) {
          if (++limited >= 5) return finish(true);
          scan.waiting = true;
          Nova.bus.emit('regions');
          return setTimeout(function () { scan.waiting = false; next(); }, BACKOFF_MS[limited - 1]);
        }
        // Any other failure: skip this title (remembered as unknown) and carry on.
        remember(m, '', '');
        i++;
        scan.done++;
        setTimeout(next, GAP_MS);
      });
    }
    next();
  }

  /* ---------- views ---------- */

  function has(tag) { return function (it) { return it.tags && it.tags.indexOf(tag) >= 0; }; }

  function chips(type) {
    var counts = {}, lib = Nova.api.lib[type];
    lib.items.forEach(function (it) { (it.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var out = [{ id: 'all', label: 'All', count: lib.items.length }];
    DEFS.forEach(function (d) { if (counts[d.id]) out.push({ id: d.id, label: d.label, count: counts[d.id] }); });
    return out;
  }

  function label(id) {
    var l = 'All';
    DEFS.forEach(function (d) { if (d.id === id) l = d.label; });
    return l;
  }

  // Rows for Movies/Series filtered to one tag: recent, then each category's matching titles, then genres.
  function rows(type, tag) {
    var lib = Nova.api.lib[type], match = has(tag), shape = type === 'live' ? 'landscape' : 'portrait';
    var all = lib.items.filter(match);
    if (!all.length) return [];
    var out = [{ title: 'Recently Added · ' + label(tag), shape: shape, items: all.slice().sort(function (a, b) { return b.added - a.added; }).slice(0, 40) }];
    lib.cats.forEach(function (c) {
      var its = c.items.filter(match);
      if (its.length) out.push({ title: c.name, shape: shape, items: its, count: true });
    });
    // Big mixed categories (like one "Asian" category) are easier to browse by genre.
    var byGenre = {};
    all.forEach(function (it) {
      String(it.genre || '').split(/\s*[,\/&|]\s*/).forEach(function (g) {
        g = g.trim();
        if (!g || g.length > 24) return;
        g = g.charAt(0).toUpperCase() + g.slice(1).toLowerCase();
        (byGenre[g] = byGenre[g] || []).push(it);
      });
    });
    Object.keys(byGenre).sort(function (a, b) { return byGenre[b].length - byGenre[a].length; })
      .filter(function (g) { return byGenre[g].length >= 4 && byGenre[g].length < all.length; })
      .slice(0, 10)
      .forEach(function (g) { out.push({ title: g, shape: shape, items: byGenre[g], count: true }); });
    return out;
  }

  // Live TV: the categories carrying the tag, plus one combined list.
  function liveCats(tag) {
    var lib = Nova.api.lib.live, match = has(tag);
    var cats = [];
    lib.cats.forEach(function (c) {
      var its = c.items.filter(match);
      if (its.length) cats.push({ id: c.id, name: c.name, items: its });
    });
    return [{ id: '_all_' + tag, name: 'All ' + label(tag), items: lib.items.filter(match) }].concat(cats);
  }

  return {
    DEFS: DEFS,
    load: function () {
      cacheKey = 'countries:' + Nova.api.cacheKey();
      return Nova.cache.get(cacheKey).then(function (c) { countries = c || {}; });
    },
    tagAll: tagAll,
    remember: remember,
    startScan: startScan,
    scanState: function () { return scan; },
    chips: chips,
    rows: rows,
    liveCats: liveCats,
    label: label,
    _fromCast: fromCast
  };
})();
