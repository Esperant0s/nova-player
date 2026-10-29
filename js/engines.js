/* Playback engines behind one interface (times in seconds):
     open(url, {live, startAt}), play(), pause(), isPaused(), seek(sec), time(), duration(), buffered()
     tracks() -> {audio, text, quality: [{id, label}], cur: {audio, text, quality}}
     setAudio(id), setText(id|-1), setQuality(id|-1), rates(), setRate(r), aspects(), setAspect(id), info(), close()
     preview() -> frame grabber for seek thumbnails, or null when the engine can't make them
   Events through engine.on(name, fn): state ('buffering'|'playing'|'paused'), time, ended, error, subtitle, tracks.

   AVEngine drives Samsung's hardware player (webapis.avplay) on the TV.
   HtmlEngine uses <video> + hls.js so the whole app can be developed in a desktop browser. */

(function () {
  var HLS_JS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';

  function Emitter() { this._h = {}; }
  Emitter.prototype.on = function (ev, fn) { this._h[ev] = fn; };
  Emitter.prototype.emit = function (ev, a, b) { var f = this._h[ev]; if (f) f(a, b); };

  function lang(code) {
    var names = { eng: 'English', en: 'English', fre: 'French', fra: 'French', fr: 'French', ger: 'German', deu: 'German', de: 'German',
      spa: 'Spanish', es: 'Spanish', ita: 'Italian', it: 'Italian', por: 'Portuguese', pt: 'Portuguese', ara: 'Arabic', ar: 'Arabic',
      tur: 'Turkish', tr: 'Turkish', dut: 'Dutch', nld: 'Dutch', nl: 'Dutch', rus: 'Russian', ru: 'Russian', pol: 'Polish', pl: 'Polish',
      jpn: 'Japanese', ja: 'Japanese', chi: 'Chinese', zho: 'Chinese', zh: 'Chinese', kor: 'Korean', ko: 'Korean', hin: 'Hindi', hi: 'Hindi',
      swe: 'Swedish', sv: 'Swedish', gre: 'Greek', ell: 'Greek', heb: 'Hebrew', he: 'Hebrew', per: 'Persian', fas: 'Persian', urd: 'Urdu' };
    names.el = 'Greek';
    if (!code) return '';
    var parts = String(code).toLowerCase().split(/[-_]/);
    var base = names[parts[0]];
    if (!base) return String(code).toUpperCase();
    return parts[1] ? base + ' (' + parts[1].toUpperCase() + ')' : base;
  }

  // Streams often name tracks "stream_5" or "Track 1"; the language is more useful then.
  function trackLabel(name, code, fallback) {
    var generic = !name || /^(stream|track|audio|subs?|subtitles?|text|und)[\s_-]?\d*$/i.test(name);
    return (generic ? lang(code) : name) || name || fallback;
  }
  function channelLabel(ch) {
    ch = parseInt(ch, 10);
    return ch > 2 ? (ch - 1) + '.1 Surround' : ch === 2 ? 'Stereo' : ch === 1 ? 'Mono' : '';
  }

  /* ---------------- Samsung AVPlay ---------------- */

  function AVEngine(layer) {
    Emitter.call(this);
    var obj = document.createElement('object');
    obj.type = 'application/avplayer';
    obj.className = 'av-object';
    layer.appendChild(obj);
    this.av = webapis.avplay;
    this.token = 0;
    this.aspect = 'fit';
    this.seeking = false;
    this.pendingSeek = null;
    this.cur = 0;
  }
  AVEngine.prototype = Object.create(Emitter.prototype);
  AVEngine.prototype.name = 'AVPlay';

  AVEngine.prototype.open = function (url, opts) {
    var self = this, av = this.av, tk = ++this.token;
    this.close(true);
    this.cur = opts.startAt || 0;
    this.dur = 0;
    this.textOn = false;
    this.paused = false;
    this.started = false;
    this.buffering = true;
    try {
      av.open(url);
      av.setDisplayRect(0, 0, 1920, 1080);
      this.setAspect(this.aspect);
      av.setListener({
        onbufferingstart: function () { if (tk === self.token) { self.buffering = true; self.emit('state', 'buffering'); } },
        onbufferingcomplete: function () {
          if (tk !== self.token) return;
          self.buffering = false;
          self.sync();
          self.emit('state', self.paused ? 'paused' : 'playing');
        },
        // While a seek runs, AVPlay still reports the old position; showing it makes the bar jump back.
        oncurrentplaytime: function (ms) { if (tk === self.token && !self.seeking) { self.cur = ms / 1000; self.emit('time', self.cur); } },
        onstreamcompleted: function () { if (tk === self.token) self.emit('ended'); },
        onerror: function (e) { if (tk === self.token) self.emit('error', String(e)); },
        onsubtitlechange: function (duration, text) { if (tk === self.token && self.textOn) self.emit('subtitle', text, duration); },
        onevent: function () {}
      });
      // A small start buffer makes channels start noticeably faster. The resume buffer (after a
      // stall) stays large: a small one on a connection barely faster than the stream drains in
      // seconds and stalls again, over and over.
      try {
        av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', opts.live ? 2 : 4);
        av.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', opts.live ? 15 : 20);
      } catch (e) {}
      try { av.setTimeoutForBuffering(20); } catch (e) {}
      this.emit('state', 'buffering');
      av.prepareAsync(function () {
        if (tk !== self.token) return;
        try { av.setSilentSubtitle(true); } catch (e) {}
        var go = function () {
          if (tk !== self.token) return;
          self.started = true;
          self.buffering = false;
          try { av.play(); } catch (e) {}
          self.sync();
          self.emit('state', self.paused ? 'paused' : 'playing');
          self.emit('tracks');
        };
        if (opts.startAt > 0) av.seekTo(Math.floor(opts.startAt * 1000), go, go); else go();
      }, function (e) { if (tk === self.token) self.emit('error', String(e && e.name || e)); });
    } catch (e) {
      this.emit('error', e.message || String(e));
    }
  };
  /* play() and pause() record what the viewer wants; sync() makes AVPlay match whenever it can take
     the command. AVPlay throws on play/pause while it is preparing, buffering or seeking, which used
     to leave the picture playing under a "paused" UI (or the reverse). */
  AVEngine.prototype.sync = function () {
    if (!this.started || this.seeking) return;
    try {
      var s = this.av.getState();
      if (this.paused && s === 'PLAYING') this.av.pause();
      else if (!this.paused && (s === 'PAUSED' || s === 'READY')) this.av.play();
    } catch (e) {}
  };
  AVEngine.prototype.play = function () {
    this.paused = false;
    this.sync();
    this.emit('state', this.buffering ? 'buffering' : 'playing');
  };
  AVEngine.prototype.pause = function () {
    this.paused = true;
    this.sync();
    this.emit('state', 'paused');
  };
  AVEngine.prototype.isPaused = function () { return !!this.paused; };
  // AVPlay rejects a seek while another is running, so the latest request waits its turn.
  // The position updates at once so quick repeated skips add up instead of being lost.
  AVEngine.prototype.seek = function (sec) {
    var self = this, tk = this.token;
    this.cur = sec;
    if (this.seeking) { this.pendingSeek = sec; return; }
    this.seeking = true;
    var done = function () {
      if (tk !== self.token) return;
      self.seeking = false;
      if (self.pendingSeek != null) { var s = self.pendingSeek; self.pendingSeek = null; return self.seek(s); }
      self.sync();
    };
    try { this.av.seekTo(Math.floor(sec * 1000), done, done); } catch (e) { done(); }
  };
  AVEngine.prototype.time = function () { return this.cur; };
  // getDuration() is a call into the platform; the player asks several times a second.
  AVEngine.prototype.duration = function () {
    if (!this.dur) try { this.dur = (this.av.getDuration() || 0) / 1000; } catch (e) {}
    return this.dur || 0;
  };
  AVEngine.prototype.buffered = function () { return 0; };
  AVEngine.prototype.tracks = function () {
    var out = { audio: [], text: [], quality: [], cur: { audio: -1, text: this.textOn ? this.textIdx : -1, quality: -1 } };
    try {
      this.av.getTotalTrackInfo().forEach(function (t) {
        var x = {};
        try { x = JSON.parse(t.extra_info); } catch (e) {}
        if (t.type === 'AUDIO') out.audio.push({ id: t.index, label: lang(x.language) || 'Track ' + (out.audio.length + 1), sub: [channelLabel(x.channels), x.fourCC].filter(Boolean).join(' · ') });
        if (t.type === 'TEXT') out.text.push({ id: t.index, label: lang(x.track_lang) || 'Subtitle ' + (out.text.length + 1) });
      });
      this.av.getCurrentStreamInfo().forEach(function (s) { if (s.type === 'AUDIO') out.cur.audio = s.index; });
    } catch (e) {}
    return out;
  };
  AVEngine.prototype.setAudio = function (id) { try { this.av.setSelectTrack('AUDIO', id); } catch (e) {} };
  AVEngine.prototype.setText = function (id) {
    try {
      if (id < 0) { this.av.setSilentSubtitle(true); this.textOn = false; this.emit('subtitle', '', 0); return; }
      this.av.setSelectTrack('TEXT', id);
      this.av.setSilentSubtitle(false);
      this.textOn = true;
      this.textIdx = id;
    } catch (e) {}
  };
  AVEngine.prototype.setQuality = function () {};
  AVEngine.prototype.rates = function () { return [1, 2, 4]; };
  AVEngine.prototype.setRate = function (r) { try { this.av.setSpeed(r); } catch (e) {} };
  AVEngine.prototype.aspects = function () { return [['fit', 'Fit to screen'], ['auto', 'Original'], ['stretch', 'Stretch']]; };
  AVEngine.prototype.setAspect = function (id) {
    this.aspect = id;
    var m = { fit: 'PLAYER_DISPLAY_MODE_LETTER_BOX', auto: 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO', stretch: 'PLAYER_DISPLAY_MODE_FULL_SCREEN' }[id];
    try { this.av.setDisplayMethod(m); } catch (e) {}
  };
  AVEngine.prototype.info = function () {
    var out = {};
    try {
      this.av.getCurrentStreamInfo().forEach(function (s) {
        var x = {};
        try { x = JSON.parse(s.extra_info); } catch (e) {}
        if (s.type === 'VIDEO') { out.width = +x.Width; out.height = +x.Height; out.codec = x.fourCC; out.bitrate = +x.Bit_rate; }
        if (s.type === 'AUDIO') out.audio = x.fourCC;
      });
    } catch (e) {}
    // How fast AVPlay is downloading right now, to compare with the stream's own bitrate.
    try { out.download = parseInt(this.av.getStreamingProperty('CURRENT_BANDWIDTH'), 10) || 0; } catch (e) {}
    return out;
  };
  // AVPlay is the TV's only video decoder, so there is no second player to grab thumbnails with.
  AVEngine.prototype.preview = function () { return null; };
  AVEngine.prototype.close = function (keepToken) {
    if (!keepToken) this.token++;
    this.started = false;
    this.seeking = false;
    this.pendingSeek = null;
    try { this.av.stop(); } catch (e) {}
    try { this.av.close(); } catch (e) {}
  };

  /* ---------------- HTML5 video + hls.js ---------------- */

  var hlsReady = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve();
    if (!hlsReady) hlsReady = Nova.loadScript(HLS_JS).catch(function (e) { hlsReady = null; throw e; });
    return hlsReady;
  }

  function HtmlEngine(layer) {
    Emitter.call(this);
    var self = this, v = this.video = document.createElement('video');
    v.className = 'html-video';
    v.setAttribute('playsinline', '');
    layer.appendChild(v);
    this.aspect = 'fit';
    this.token = 0;
    v.addEventListener('waiting', function () { self.emit('state', 'buffering'); });
    v.addEventListener('playing', function () { self.emit('state', 'playing'); });
    // Pauses from outside the app (the browser's media keys) count as the viewer's choice too.
    v.addEventListener('play', function () { self.userPaused = false; });
    v.addEventListener('pause', function () { if (!v.ended) { self.userPaused = true; self.emit('state', 'paused'); } });
    // A seek while paused fires "waiting" in some browsers but never "playing" afterwards.
    v.addEventListener('seeked', function () { if (self.userPaused && !v.ended) self.emit('state', 'paused'); });
    v.addEventListener('timeupdate', function () { self.emit('time', self.time()); });
    v.addEventListener('ended', function () { self.emit('ended'); });
    v.addEventListener('loadedmetadata', function () { self.emit('tracks'); });
    v.addEventListener('error', function () {
      if (!v.getAttribute('src') && !self.hls) return;
      var err = v.error;
      self.emit('error', err ? 'Media error ' + err.code + (err.code === 4 ? ': this format is not supported by the browser' : '') : 'Playback error');
    });
    // Subtitle cues are drawn by the player UI so their size can be configured.
    v.textTracks.addEventListener('addtrack', function (e) {
      e.track.addEventListener('cuechange', function () {
        if (e.track.mode === 'disabled') return;
        var cues = e.track.activeCues, text = [];
        for (var i = 0; cues && i < cues.length; i++) text.push(cues[i].text);
        self.emit('subtitle', text.join('\n'));
      });
    });
  }
  HtmlEngine.prototype = Object.create(Emitter.prototype);
  HtmlEngine.prototype.name = 'HTML5';

  HtmlEngine.prototype.open = function (url, opts) {
    var self = this, v = this.video, tk = ++this.token;
    this.close(true);
    this.userPaused = false;
    this.emit('state', 'buffering');
    var isHls = /\.m3u8(\?|$)/i.test(url) || /\/live\//.test(url) && !/\.ts(\?|$)/i.test(url);
    var native = !!v.canPlayType('application/vnd.apple.mpegurl');
    this.remux = null;
    this.src = { url: url, hls: isHls };
    // Firefox drops MKV/AVI audio, so the dev server repackages those files as MP4.
    if (Nova.useProxy && /firefox/i.test(navigator.userAgent) && /\.(mkv|avi)(\?|$)/i.test(url)) {
      this.remux = { url: url, offset: 0, dur: 0 };
      Nova.http('/probe?url=' + encodeURIComponent(url), { direct: true, json: true }).then(function (r) {
        if (tk !== self.token) return;
        self.remux.dur = r.duration || 0;
        self.emit('tracks');
      }, function () {});
      this.seek(opts.startAt > 0 ? opts.startAt : 0);
      return;
    }
    var plain = function () {
      v.src = Nova.useProxy && isHls ? '/proxy?url=' + encodeURIComponent(url) : url;
      if (opts.startAt > 0) {
        var once = function () { v.removeEventListener('loadedmetadata', once); v.currentTime = opts.startAt; };
        v.addEventListener('loadedmetadata', once);
      }
      if (!self.userPaused) self.play();
    };
    // hls.js is preferred even where HLS plays natively: it exposes audio, subtitle and quality tracks.
    if (isHls) {
      loadHls().then(function () {
        if (tk !== self.token) return;
        if (!Hls.isSupported()) return native ? plain() : self.emit('error', 'HLS is not supported in this browser');
        var hls = self.hls = new Hls({ startPosition: opts.startAt > 0 ? opts.startAt : -1, capLevelToPlayerSize: true, maxBufferLength: 30, enableWorker: true });
        hls.subtitleDisplay = false;
        var recovered = 0;
        hls.on(Hls.Events.MANIFEST_PARSED, function () { hls.subtitleTrack = -1; if (!self.userPaused) self.play(); self.emit('tracks'); });
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function () { self.emit('tracks'); });
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, function () { self.emit('tracks'); });
        hls.on(Hls.Events.ERROR, function (ev, d) {
          if (!d.fatal) return;
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR && recovered++ < 2) hls.recoverMediaError();
          else self.emit('error', d.details || 'Stream error');
        });
        hls.loadSource(Nova.useProxy ? '/proxy?url=' + encodeURIComponent(url) : url);
        hls.attachMedia(v);
      }, function () {
        if (tk !== self.token) return;
        if (native) plain(); else self.emit('error', 'Could not load the HLS library (no internet?)');
      });
    } else plain();
  };
  /* Firefox blocks autoplay with sound until the page has been clicked or a key pressed. When that
     happens, play muted and turn the sound on at the first click or key press. */
  HtmlEngine.prototype.play = function () {
    this.userPaused = false;
    if (this.thumbs) this.thumbs.release();
    var v = this.video, p = v.play();
    if (!p || !p.catch) return;
    p.catch(function (e) {
      if (!e || e.name !== 'NotAllowedError') return;
      v.muted = true;
      v.play().catch(function () {});
      Nova.ui.toast('Click or press any key to turn on sound');
      var unmute = function () {
        document.removeEventListener('click', unmute, true);
        document.removeEventListener('keydown', unmute, true);
        v.muted = false;
        v.play().catch(function () {});
      };
      document.addEventListener('click', unmute, true);
      document.addEventListener('keydown', unmute, true);
    });
  };
  HtmlEngine.prototype.pause = function () { this.userPaused = true; this.video.pause(); };
  HtmlEngine.prototype.isPaused = function () { return !!this.userPaused; };
  HtmlEngine.prototype.seek = function (sec) {
    if (this.thumbs) this.thumbs.release();
    var r = this.remux;
    if (!r) { this.video.currentTime = sec; return; }
    // A repackaged stream can't jump, so seeking restarts it from the new position.
    r.offset = Math.max(0, r.dur ? Math.min(sec, r.dur - 1) : sec);
    this.video.src = '/remux?t=' + Math.floor(r.offset) + '&url=' + encodeURIComponent(r.url);
    if (!this.userPaused) this.play();
  };
  HtmlEngine.prototype.time = function () { return (this.remux ? this.remux.offset : 0) + (this.video.currentTime || 0); };
  HtmlEngine.prototype.duration = function () {
    if (this.remux) return this.remux.dur;
    var d = this.video.duration; return isFinite(d) ? d : 0;
  };
  HtmlEngine.prototype.buffered = function () {
    var b = this.video.buffered, t = this.video.currentTime;
    for (var i = 0; i < b.length; i++) if (b.start(i) <= t + 1 && b.end(i) >= t) return b.end(i) + (this.remux ? this.remux.offset : 0);
    return 0;
  };
  HtmlEngine.prototype.tracks = function () {
    var h = this.hls, out = { audio: [], text: [], quality: [], cur: { audio: -1, text: -1, quality: -1 } };
    if (!h) return out;
    out.audio = (h.audioTracks || []).map(function (t, i) {
      return { id: i, label: trackLabel(t.name, t.lang, 'Track ' + (i + 1)), sub: channelLabel(t.attrs && t.attrs.CHANNELS) };
    });
    out.text = (h.subtitleTracks || []).map(function (t, i) {
      return { id: i, label: trackLabel(t.name, t.lang, 'Subtitle ' + (i + 1)), sub: t.forced ? 'Forced' : '' };
    });
    var seen = {};
    (h.levels || []).forEach(function (l, i) {
      var label = l.height ? l.height + 'p' : Math.round(l.bitrate / 1000) + ' kbps';
      if (seen[label]) return;
      seen[label] = 1;
      out.quality.push({ id: i, label: label, sub: l.bitrate ? (l.bitrate / 1e6).toFixed(1) + ' Mbps' : '', h: l.height || 0 });
    });
    out.quality.sort(function (a, b) { return b.h - a.h; });
    out.cur = { audio: h.audioTrack, text: h.subtitleTrack, quality: h.autoLevelEnabled ? -1 : h.currentLevel };
    return out;
  };
  HtmlEngine.prototype.setAudio = function (id) { if (this.hls) this.hls.audioTrack = id; };
  HtmlEngine.prototype.setText = function (id) {
    if (this.hls) this.hls.subtitleTrack = id;
    if (id < 0) this.emit('subtitle', '');
  };
  HtmlEngine.prototype.setQuality = function (id) { if (this.hls) this.hls.currentLevel = id; };
  HtmlEngine.prototype.rates = function () { return [0.5, 0.75, 1, 1.25, 1.5, 2]; };
  HtmlEngine.prototype.setRate = function (r) { this.video.playbackRate = r; };
  HtmlEngine.prototype.aspects = function () { return [['fit', 'Fit to screen'], ['zoom', 'Zoom to fill'], ['stretch', 'Stretch']]; };
  HtmlEngine.prototype.setAspect = function (id) {
    this.aspect = id;
    this.video.style.objectFit = { fit: 'contain', zoom: 'cover', stretch: 'fill' }[id] || 'contain';
  };
  HtmlEngine.prototype.info = function () {
    var v = this.video, out = { width: v.videoWidth, height: v.videoHeight };
    if (this.hls && this.hls.levels && this.hls.levels[this.hls.currentLevel]) {
      var l = this.hls.levels[this.hls.currentLevel];
      out.bitrate = l.bitrate;
      out.codec = (l.videoCodec || '').split('.')[0];
      out.audio = (l.audioCodec || '').split('.')[0];
    }
    return out;
  };
  HtmlEngine.prototype.preview = function () {
    if (!this.src) return null;
    var v = this.video;
    if (!this.thumbs) this.thumbs = new Thumbs(this.src.url, this.src.hls, function () { return v.networkState !== v.NETWORK_LOADING; });
    return this.thumbs.failed ? null : this.thumbs;
  };
  HtmlEngine.prototype.close = function (keepToken) {
    if (!keepToken) this.token++;
    if (this.thumbs) { this.thumbs.close(); this.thumbs = null; }
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    this.remux = null;
    var v = this.video;
    v.pause();
    v.removeAttribute('src');
    try { v.load(); } catch (e) {}
    v.playbackRate = 1;
  };

  /* ---------------- seek thumbnails ---------------- */

  /* A hidden, muted second <video> on the same stream. get(t, cb) seeks it and draws that frame
     into a small canvas; only the newest request is kept while a seek is running, so holding an
     arrow key never queues up a backlog.
     Many IPTV accounts allow one connection at a time: while the preview holds one, the main video's
     next request is refused, and a new connection can cut off one that is still downloading. So the
     preview only connects during a scrub, once the main video has stopped downloading (idle() says
     so), and release() drops the connection (keeping the frames) before the main video seeks or
     plays again. */
  var THUMB_W = 320, THUMB_STEP = 4, THUMB_KEEP = 60;

  function Thumbs(url, isHls, idle) {
    var self = this, v = this.v = document.createElement('video');
    this.idle = idle;
    v.muted = true;
    v.preload = 'metadata';
    v.setAttribute('playsinline', '');
    this.url = url;
    this.isHls = isHls;
    this.cache = {};
    this.order = [];
    this.busy = null;
    this.want = null;
    this.ready = false;
    this.attached = false;
    this.failed = isHls && !(window.Hls && Hls.isSupported()) && !v.canPlayType('application/vnd.apple.mpegurl');
    v.addEventListener('loadedmetadata', function () { self.ready = true; self.kick(); });
    v.addEventListener('seeked', function () { requestAnimationFrame(function () { self.grab(); }); });
    v.addEventListener('error', function () { if (self.attached) self.fail(); });
  }
  Thumbs.prototype.attach = function () {
    var self = this, v = this.v, url = this.url;
    this.attached = true;
    if (this.isHls && window.Hls && Hls.isSupported()) {
      // The lowest quality is plenty for a 320-pixel picture and loads fastest.
      var hls = this.hls = new Hls({ startLevel: 0, maxBufferLength: 2, maxMaxBufferLength: 4, enableWorker: true, autoStartLoad: true });
      hls.on(Hls.Events.MANIFEST_PARSED, function () { hls.autoLevelCapping = 0; hls.currentLevel = 0; });
      hls.on(Hls.Events.ERROR, function (ev, d) { if (d.fatal) self.fail(); });
      hls.loadSource(Nova.useProxy ? '/proxy?url=' + encodeURIComponent(url) : url);
      hls.attachMedia(v);
    } else {
      v.src = this.isHls && Nova.useProxy ? '/proxy?url=' + encodeURIComponent(url) : url;
    }
  };
  Thumbs.prototype.release = function () {
    clearTimeout(this.wait);
    if (!this.attached) return;
    clearTimeout(this.guard);
    this.attached = this.ready = false;
    this.busy = this.want = null;
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    this.v.removeAttribute('src');
    try { this.v.load(); } catch (e) {}
  };
  Thumbs.prototype.key = function (t) { return Math.round(t / THUMB_STEP) * THUMB_STEP; };
  // cb(canvas, t) runs with the cached frame at once, or later when it has been drawn.
  Thumbs.prototype.get = function (t, cb) {
    var k = this.key(t);
    if (this.cache[k]) return cb(this.cache[k], k);
    this.want = { k: k, cb: cb };
    if (!this.attached) this.connect();
    this.kick();
  };
  Thumbs.prototype.connect = function () {
    var self = this;
    clearTimeout(this.wait);
    if (this.attached || !this.want || this.failed) return;
    if (this.idle()) this.attach();
    else this.wait = setTimeout(function () { self.connect(); }, 250);
  };
  Thumbs.prototype.kick = function () {
    if (this.busy || !this.want || !this.ready || this.failed) return;
    var self = this, job = this.busy = this.want, v = this.v;
    this.want = null;
    clearTimeout(this.guard);
    // A seek that never finishes (stalled network) mustn't block every later thumbnail.
    this.guard = setTimeout(function () { if (self.busy === job) { self.busy = null; self.kick(); } }, 6000);
    var t = Math.min(job.k, (v.duration || 1e9) - 0.5);
    // fastSeek lands on the nearest keyframe, which is much quicker and close enough here.
    if (v.fastSeek) v.fastSeek(t); else v.currentTime = t;
  };
  Thumbs.prototype.grab = function () {
    var job = this.busy, v = this.v;
    if (!job || !v.videoWidth) return;
    clearTimeout(this.guard);
    this.busy = null;
    var c = document.createElement('canvas');
    c.width = THUMB_W;
    c.height = Math.round(THUMB_W * v.videoHeight / v.videoWidth);
    try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch (e) { return this.fail(); }
    this.cache[job.k] = c;
    this.order.push(job.k);
    if (this.order.length > THUMB_KEEP) delete this.cache[this.order.shift()];
    job.cb(c, job.k);
    this.kick();
  };
  Thumbs.prototype.fail = function () { this.failed = true; this.busy = this.want = null; };
  Thumbs.prototype.close = function () {
    this.release();
    this.failed = true;
    this.cache = {};
  };

  var instance = null;
  Nova.engine = function () {
    if (!instance) {
      var layer = document.getElementById('video-layer');
      instance = Nova.hasAVPlay() ? new AVEngine(layer) : new HtmlEngine(layer);
    }
    return instance;
  };
})();
