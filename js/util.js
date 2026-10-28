/* Shared helpers. Written for the oldest Chromium found on Samsung TVs we support
   (Tizen 4 / Chrome 56): no optional chaining, no object spread, no padStart. */
var Nova = window.Nova = {};

Nova.isTizen = typeof window.tizen !== 'undefined';
if (Nova.isTizen) document.documentElement.className = 'tv';
Nova.hasAVPlay = function () { return !!(window.webapis && window.webapis.avplay); };
// In a desktop browser on localhost we route network calls through dev-server.js to get around CORS.
Nova.useProxy = !Nova.isTizen && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

Nova.$ = function (sel, root) { return (root || document).querySelector(sel); };

Nova.el = function (tag, cls, html) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

Nova.esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};

Nova.pad2 = function (n) { n = Math.floor(n); return n < 10 ? '0' + n : '' + n; };

// 3725 -> "1:02:05", 125 -> "2:05"
Nova.fmtTime = function (sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? h + ':' + Nova.pad2(m) + ':' + Nova.pad2(s) : m + ':' + Nova.pad2(s);
};

// 5400 -> "1h 30m"
Nova.fmtDuration = function (sec) {
  sec = Math.floor(sec || 0);
  if (!sec) return '';
  var h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60);
  return h ? h + 'h ' + m + 'm' : m + 'm';
};

Nova.fmtClock = function (d) {
  d = d || new Date();
  return Nova.pad2(d.getHours()) + ':' + Nova.pad2(d.getMinutes());
};

Nova.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

Nova.debounce = function (fn, ms) {
  var t;
  var d = function () {
    var args = arguments, self = this;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(self, args); }, ms);
  };
  d.cancel = function () { clearTimeout(t); };
  return d;
};

Nova.assign = function (target) {
  for (var i = 1; i < arguments.length; i++) {
    var src = arguments[i];
    if (src) for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
  }
  return target;
};

// Stable colour per title, used for poster placeholders.
Nova.hue = function (str) {
  var h = 0;
  str = String(str || '');
  for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
};

// Provider tags at the end of titles: "(AS Series 2026)", "[EN2026]", "[ASN.2026]", "(ENTOP)", "(2009)".
Nova.NAME_TAG = /\s*[\(\[]\s*((?:[A-Z][A-Za-z]{0,5}(?:-Series| Series)?|box|IMDB)?[\s.\-–]*(?:(?:19|20)\d{2}(?:\s*[-–]\s*(?:(?:19|20)\d{2})?)?)?[\s.\-–]*)[\)\]]\s*$/;

// Providers often prefix titles with the year ("2026-Title") and suffix them with tags; the year is shown separately.
Nova.cleanName = function (s) {
  s = String(s || '').trim();
  return s.replace(/^(19|20)\d{2}\s*[-–:|]\s*/, '').replace(Nova.NAME_TAG, '').trim() || s;
};

// Episode titles are often just "S01E01" or "Show S01E01"; fall back to "Episode N".
Nova.epTitle = function (item, ep) {
  var t = String(ep.title || '');
  if (item.name) t = t.split(item.name).join('');
  t = t.replace(/\bS\d{1,2}\s*E\d{1,3}\b/ig, '').replace(/^[\s\-–:|.]*(19|20)\d{2}\b/, '').replace(/^[\s\-–:|.]+|[\s\-–:|.]+$/g, '');
  return t || 'Episode ' + ep.num;
};

Nova.b64 = function (s) {
  if (!s) return '';
  try { return decodeURIComponent(escape(atob(s))); } catch (e) { return s; }
};

// XHR rather than fetch: Tizen 4 has no AbortController, and we need timeouts.
Nova.http = function (url, opts) {
  opts = opts || {};
  var target = Nova.useProxy && !opts.direct ? '/proxy?url=' + encodeURIComponent(url) : url;
  return new Promise(function (resolve, reject) {
    var x = new XMLHttpRequest();
    x.open('GET', target, true);
    if (opts.headers) for (var h in opts.headers) x.setRequestHeader(h, opts.headers[h]);
    x.timeout = opts.timeout || 30000;
    x.onload = function () {
      if (x.status >= 200 && x.status < 300) {
        if (!opts.json) return resolve(x.responseText);
        try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(new Error('The server sent an invalid response.')); }
      } else {
        var err = new Error(x.status === 429 ? 'Your provider is limiting requests right now. Wait a minute and try again.' : 'Server error ' + x.status);
        err.status = x.status;
        reject(err);
      }
    };
    x.onerror = function () { reject(new Error('Could not reach the server.')); };
    x.ontimeout = function () { reject(new Error('The server took too long to respond.')); };
    x.send();
  });
};

Nova.loadScript = function (src) {
  return new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
};

/* Mouse support. The app is driven by the remote; clicks and the wheel are mapped onto the same actions. */

// Delegated click: fn(matchedElement, event) for clicks on `sel` inside root.
Nova.onClick = function (root, sel, fn) {
  root.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest(sel) : null;
    if (t && root.contains(t)) { e.stopPropagation(); fn(t, e); }
  });
};

// Wheel/trackpad scrolling as arrow presses, throttled so one flick moves one step.
Nova.onWheel = function (el, fn) {
  var last = 0;
  el.addEventListener('wheel', function (e) {
    e.preventDefault();
    var dx = e.deltaX, dy = e.deltaY, now = Date.now();
    if (now - last < 140 || (Math.abs(dx) < 4 && Math.abs(dy) < 4)) return;
    last = now;
    fn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  }, { passive: false });
};

// Tiny event bus.
Nova.bus = {
  _h: {},
  on: function (ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); },
  off: function (ev, fn) { var a = this._h[ev] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
  emit: function (ev, data) { (this._h[ev] || []).slice().forEach(function (fn) { fn(data); }); }
};

// Feather-style line icons, 24x24.
Nova.ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  live: '<rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8M12 18v3"/>',
  movie: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M3 12h18"/>',
  series: '<path d="M12 3 2 8l10 5 10-5z"/><path d="m2 13 10 5 10-5"/><path d="m2 18 10 5 10-5" opacity=".5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  mylist: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6.5 4h3.5v16H6.5zM14 4h3.5v16H14z" fill="currentColor" stroke="none"/>',
  back10: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 3.5v5h5"/><text x="12.5" y="15.6" font-size="7.5" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">10</text>',
  fwd10: '<path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5"/><path d="M20 3.5v5h-5"/><text x="11.5" y="15.6" font-size="7.5" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">10</text>',
  next: '<path d="M5 4v16l11-8z" fill="currentColor" stroke="none"/><path d="M19 4v16" stroke-width="3"/>',
  audio: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8.5a5 5 0 0 1 0 7M19 5.5a9 9 0 0 1 0 13"/>',
  subtitles: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 12h4M12 12h6M6 15.5h8M16 15.5h2"/>',
  speed: '<path d="M12 14l4-6"/><path d="M3.5 18a9.5 9.5 0 1 1 17 0"/>',
  aspect: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 11V8h3M18 13v3h-3"/>',
  quality: '<rect x="2" y="5" width="20" height="14" rx="2"/><text x="12" y="15" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">HD</text>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 3.5v5h5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  starFill: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" fill="currentColor"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>'
};

Nova.icon = function (name, cls) {
  return '<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (Nova.ICONS[name] || '') + '</svg>';
};
