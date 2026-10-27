Nova.router.register('settings', function () {
  var el = Nova.el('div', 'screen settings');
  var idx = 0;

  function cycle(key, values, def) {
    return function () {
      var cur = Nova.prefs.get(key, def), i = 0;
      values.forEach(function (v, j) { if (v[0] === cur) i = j; });
      Nova.prefs.set(key, values[(i + 1) % values.length][0]);
    };
  }
  function label(key, values, def) {
    var cur = Nova.prefs.get(key, def), out = values[0][1];
    values.forEach(function (v) { if (v[0] === cur) out = v[1]; });
    return out;
  }

  var LIVE_FMT = [['auto', 'Automatic'], ['ts', 'MPEG-TS'], ['m3u8', 'HLS']];
  var SUB_SIZE = [['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large'], ['s', 'Small']];
  var ON_OFF = [[true, 'On'], [false, 'Off']];

  function items() {
    var a = Nova.api.account, info = a.info || {};
    var who = a.type === 'demo' ? 'Demo library' : a.type === 'xtream' ? a.user + ' @ ' + a.server.replace(/^https?:\/\//, '') : 'M3U playlist';
    var exp = info.expires ? 'Expires ' + new Date(info.expires).toLocaleDateString() : '';
    return [
      { icon: 'user', label: 'Account', value: who, sub: exp },
      { icon: 'refresh', label: 'Refresh library', value: 'Fetch the latest channels, movies and series', fn: function () {
        Nova.ui.toast('Refreshing library…');
        Nova.api.refresh().then(function () { Nova.ui.toast('Library is up to date'); });
      } },
      { icon: 'live', label: 'Live stream format', value: label('liveFormat', LIVE_FMT, 'auto'), sub: 'Try HLS if channels fail to start', fn: cycle('liveFormat', LIVE_FMT, 'auto') },
      { icon: 'subtitles', label: 'Subtitle size', value: label('subSize', SUB_SIZE, 'm'), fn: function () { cycle('subSize', SUB_SIZE, 'm')(); Nova.applySubSize(); } },
      { icon: 'next', label: 'Auto-play next episode', value: label('autoNext', ON_OFF, true), fn: cycle('autoNext', ON_OFF, true) },
      { icon: 'trash', label: 'Clear watch history', value: 'Empties Continue Watching', fn: function () {
        Nova.ui.dialog({ title: 'Clear watch history?', text: 'Continue Watching and resume points will be removed.', buttons: [
          { label: 'Clear', fn: function () { Nova.progress.clear(); Nova.ui.toast('Watch history cleared'); } }, { label: 'Cancel' }] });
      } },
      { icon: 'logout', label: 'Sign out', value: 'Remove this account from the TV', fn: function () {
        Nova.ui.dialog({ title: 'Sign out?', text: 'Your favourites and watch history stay on this TV.', buttons: [
          { label: 'Sign out', fn: function () { Nova.api.logout().then(function () { Nova.router.root('login'); }); } }, { label: 'Cancel' }] });
      } }
    ];
  }

  var list = items();
  function render() {
    list = items();
    el.innerHTML = '<h1 class="page-title">Settings</h1><div class="set-list">' + list.map(function (it, i) {
      return '<div class="set-item' + (i === idx ? ' focused' : '') + '">' + Nova.icon(it.icon) +
        '<div class="set-text"><b>' + Nova.esc(it.label) + '</b>' + (it.sub ? '<small>' + Nova.esc(it.sub) + '</small>' : '') + '</div>' +
        '<span class="set-val">' + Nova.esc(it.value) + '</span></div>';
    }).join('') + '</div><p class="set-foot">Nova Player 1.0 · ' + (Nova.hasAVPlay() ? 'Samsung AVPlay engine' : 'Browser engine') + '</p>';
  }
  render();
  Nova.onClick(el, '.set-item', function (s) {
    Nova.menu.blur();
    idx = Array.prototype.indexOf.call(el.querySelectorAll('.set-item'), s);
    if (list[idx].fn) list[idx].fn();
    render();
  });

  return {
    el: el,
    menu: true,
    menuName: 'settings',
    focusIn: render,
    onKey: function (act) {
      if (act === 'up') idx = Math.max(0, idx - 1);
      else if (act === 'down') idx = Math.min(list.length - 1, idx + 1);
      else if (act === 'ok' && list[idx].fn) list[idx].fn();
      else if (act === 'left' || act === 'back') { el.querySelector('.set-item.focused').classList.remove('focused'); Nova.menu.focus(); return; }
      render();
    }
  };
});
